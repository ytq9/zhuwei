import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { handleRoomAction, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import type { AuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative-types";
import { VNEXT_SEMANTIC_TEMPLATES } from "../../../app/_runtime/lib/rules/profiles/semantic-templates";

// SPEC 0014 §§2.3、4: a non-door object reaches real Room state and map
// projection through the ordinary selection/filling path. Model replies are
// scripted; this is not a real-provider or literary-quality test.
type Data = Record<string, any>;
const ALICE = { principal: { id: "principal:object-mechanics:alice", sessionVersion: 1 } };
const ACTOR = "character:object-mechanics:alice", CHEST = "feature:room:brass-chest";
vi.spyOn(console, "info").mockImplementation(() => {});
const outcome = { outcomeCode: "outcome:operated", summary: "操作完成。", effects: [], sensoryEvidence: [], pressures: [], opportunities: [] };
const points = (x0: string, y0: string, x1: string, y1: string) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const geometry = { schema: "zhuwei.tactical-geometry/v1", unit: "inch", boundary: { kind: "polygon", points: points("0", "0", "480", "480") },
  spawnPoints: [{ x: "100", y: "100", elevation: "0" }], clearanceZones: [], obstacles: [{
    featureId: CHEST, kind: "destructible", label: "铜箱", state: "locked", polygon: points("145", "95", "155", "105"),
    elevation: "0", height: "24", opaque: true, impassable: true, cover: "half", propagation: "blocks", visibilityPolicyId: "visibility:scene-observers",
  }] };
const base = { basisRefs: ["wake"], consumes: [], produces: [], outcomeBinding: "always" };
const operation = (sceneRef: string, targetRef: string, kind: string, option: string) => ({ ...base, kind: "worldInteraction", basisRefs: [sceneRef], sceneRef,
  intent: "按原意图操作对象。", method: "走近后使用把手或钥匙。", targetRefs: [], directTargetRefs: [], instrumentRefs: [], abilityRef: null,
  commonAction: { kind, targetRef, destinationRef: null, option }, branches: { success: outcome, failure: null } });

function newObject(kind: "location" | "passage", handle: string, definition: Data, consumes: Data[] = []) {
  const template = VNEXT_SEMANTIC_TEMPLATES[kind];
  return { ...base, kind: "materializeObject", semanticKind: kind, templateRef: template.templateRef, templateHash: template.templateHash,
    visibilityPolicyRef: "visibility:scene-observers", produces: [{ handle, kind: "semanticDefinition", outcomeBinding: "always" }], consumes,
    definition: { sceneRef: "wake", label: kind === "location" ? "侧室" : "侧室通路", description: "门边通向一间侧室。", visibilityFactId: null,
      observableState: kind === "passage" ? "open" : null, affordances: null, mechanicDefinitionRefs: [], ...definition }, summary: "确定侧室与连接。" };
}

async function initialize(name: string) {
  const stub = env.VNEXT_ROOMS.getByName(name);
  const result = await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }], characters: [{ characterId: ACTOR, controllerPrincipalId: ALICE.principal.id,
      staticCard: { name: "阿莱莎", sceneId: "wake", level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
        scores: { str: 16, dex: 12, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: [],
        resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30,
        equipped: { main: "longsword" }, backpack: [] } }],
  } as never) as Data;
  expect(result).toMatchObject({ created: true });
  return { stub, capabilities: result.serviceCapabilities };
}

async function scenario<T>(stub: ReturnType<typeof env.VNEXT_ROOMS.getByName>, body: (act: (id: string, text: string, proposals: Data[], duration?: string) => Promise<Data>, target: Data, calls: Data[]) => Promise<T>) {
  return runInDurableObject(stub, async instance => {
    const target = instance as unknown as Data, calls: Data[] = [];
    const authority = Object.fromEntries(["prepare", "commit", "observe", "acknowledge", "publishDelivery", "deliveryPublicationStatus",
      "beginDeliveryAudiencePublication", "failDeliveryAudiencePublication", "beginViewerNarrationRecovery", "publishViewerNarrationRecovery", "failViewerNarrationRecovery"]
      .map(name => [name, (...args: unknown[]) => target[name](...args)])) as unknown as RoomAuthorityCapability;
    const act = async (id: string, text: string, proposals: Data[], duration = "300000000") => {
      const kp = createVNextKpAdapter({ narrationAdapter: { async narrate() { return { body: "你完成了眼前的操作。" }; },
        async propose() { throw new Error("unused"); } } as unknown as AuthoritativeKpAdapter,
        journal: { begin: (key, request) => target.beginVNextProposalInvocation(ALICE, key, request), complete: (key, completion) => target.completeVNextProposalInvocation(ALICE, key, completion) },
        proposalBinding: { async run(_model: string, value: unknown) {
          const request = value as Data, name = String(request.tools[0].function.name); calls.push(request);
          const wire = name === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME ? { requestedCapabilities: [...new Set(proposals.map(p => p.kind))] }
            : encodeVNextStrictToolBundle({ mode: "adjudication", basisRefs: [...new Set(proposals.flatMap(p => p.basisRefs))], terminal: null,
              adjudication: { kind: "directSuccess", durationMicros: duration, risk: "按实际条件操作。", successOutcome: "操作完成。" }, proposals } as never);
          return { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(wire) } }] } }] };
        } } });
      const result = await handleRoomAction({ principal: ALICE, authority, kp }, { kind: "intent", submissionId: id, text }) as Data;
      expect(result.kind, JSON.stringify({ result, last: calls.at(-1)?.messages.at(-1)?.content })).toBe("committed");
      return result;
    };
    return body(act, target, calls);
  });
}

it("completes and unlocks a new room's chest, keeps it closed, then opens it after eviction; retries and archive restore keep one identity", async () => {
  const { stub, capabilities } = await initialize("object-mechanics-room-source");
  const saved = await scenario(stub, async (act, target, calls) => {
    await act("discover", "我留意大厅侧面的通路。", [newObject("location", "prospective:side-room", { geometry }),
      newObject("passage", "prospective:side-way", { passage: { fromLocationRef: "wake", toLocationRef: "prospective:side-room", bidirectional: true,
        traversal: "沿通路走进侧室", travelDurationMicros: "60000000" } }, [{ kind: "prospective", handle: "prospective:side-room" }])], "0");
    const location = Object.values(target.authoritativeReplay().state.campaignRuntime.definitions).find((d: any) => d.semanticKind === "location") as Data;
    await act("enter", "我沿通路走进侧室。", [operation("wake", location.definitionId, "goTo", "none")], "0");
    const sceneRef = target.authoritativeReplay().state.entities[ACTOR].sceneId;
    const proposals = [{ ...base, basisRefs: [sceneRef], kind: "completeObject", definitionRef: CHEST, description: "none", observableState: "locked",
      mechanics: { armorClass: 15, hitPoints: 18, opensPassage: false }, summary: "确定铜箱原本的锁与耐久。" }, operation(sceneRef, CHEST, "operateObject", "unlock")];
    const first = await act("unlock", "我解除铜箱的锁，暂不打开箱盖。", proposals);
    const count = target.authorityStore.events().length, beforeRetryCalls = calls.length;
    const duplicate = await act("unlock", "我解除铜箱的锁，暂不打开箱盖。", proposals);
    expect(duplicate.receipt).toEqual(first.receipt);
    expect(target.authorityStore.events()).toHaveLength(count);
    expect(calls).toHaveLength(beforeRetryCalls);
    const feature = target.authoritativeReplay().state.combatRuntime.scenes[sceneRef].geometry.obstacles.find((f: Data) => f.featureId === CHEST);
    expect(feature).toMatchObject({ state: "closed", impassable: true, cover: "half" });
    return { sceneRef, inventory: target.authoritativeReplay().state.campaignRuntime.itemSystem };
  });
  await evictDurableObject(stub);
  await scenario(stub, async (act, target) => {
    await act("open", "我现在把铜箱的箱盖打开。", [operation(saved.sceneRef, CHEST, "operateObject", "open")]);
    expect(target.authoritativeReplay().state.campaignRuntime.itemSystem).toEqual(saved.inventory);
  });
  const observed = await stub.observe(ALICE) as Data;
  expect(observed.readModel.tacticalProjection.knownFeatures).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: CHEST, state: "open", impassable: true, cover: "half" }),
  ]));
  const exported = await stub.exportAuthoritativeArchive(capabilities.archiveExport) as Data;
  expect(exported.kind).toBe("exported");
  const restored = env.VNEXT_ROOMS.getByName("object-mechanics-room-restored");
  const restoration = await restored.restoreAuthoritativeArchive(capabilities.disasterRecovery, exported.storyArchive);
  expect(restoration, JSON.stringify(restoration)).toMatchObject({ kind: "restored" });
  const recovered = await restored.observe(ALICE) as Data;
  expect(recovered.readModel.tacticalProjection.knownFeatures).toEqual(observed.readModel.tacticalProjection.knownFeatures);
}, 30_000);
