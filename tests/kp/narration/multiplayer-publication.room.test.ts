import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { handleRoomAction, type RoomAuthorityCapability, type KpAdapterCapability } from "../../../app/_runtime/lib/room/action";
import type { RoomDurableObject } from "../../../app/_runtime/lib/room/durable-object";
import { createJournaledNarrationAdapter } from "../../../app/_runtime/lib/room/story-narration";
import { ActorPlanTransportCapability } from "../../../app/_runtime/lib/room/actor-plan-transport";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import { parseSubmitKpProposalBundleArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider";
import { sentBody } from "../../support/fixtures/vnext-request-layout.mjs";

const ALICE = { principal: { id: "multiplayer:alice", sessionVersion: 1 } };
const BOB = { principal: { id: "multiplayer:bob", sessionVersion: 1 } };
const CAROL = { principal: { id: "multiplayer:carol", sessionVersion: 1 } };
const ACTOR = "character:multiplayer:alice";
const PRIVATE_RESULT = "你看清了私人记号。";
const PUBLIC_RESULT = "调查员结束了对守灵厅的观察。";
type ProviderMaterial = {
  expression: { viewer: { characterRef: string; name: string }; actorIntent: string | null };
  facts: { claimIndex: number; required: boolean }[];
  payloads: Record<string, unknown>[];
  mechanicalResults: { key: string }[];
  reviewId: string;
};

it("publishes each present viewer's result through the production narration journal and preserves it after reconnect", async () => {
  // SPEC 0010 §1.1、SPEC 0016 §8.3: actual Room -> Claims -> narration
  // material -> journal -> publication -> transcript, with only model I/O scripted.
  const stub = env.VNEXT_ROOMS.getByName("multiplayer-publication");
  expect(await stub.initializeAuthoritative({
    roomId: "multiplayer-publication", moduleId: "black-oak-will",
    members: [ALICE, BOB, CAROL].map((p, i) => ({ principalId: p.principal.id, role: i === 0 ? "host" : "player" })),
    characters: [ALICE, BOB, CAROL].map((p, i) => ({
      characterId: `character:${p.principal.id}`, controllerPrincipalId: p.principal.id,
      staticCard: {
        name: ["调查员", "同伴", "院外同伴"][i], sceneId: i === 2 ? "yard" : "wake",
        level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
        scores: { str: 12, dex: 14, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2,
        skills: ["perception"], hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [],
      },
    })),
  })).toMatchObject({ created: true });
  const calls: string[] = [];
  const result = await runInDurableObject(stub, async instance => {
    const target = instance as unknown as RoomDurableObject;
    const ai = { async run(_model: string, input: Record<string, unknown>) {
      const tool = (input.tools as { function: { name: string } }[] | undefined)?.[0]?.function.name;
      const material = sentBody(input) as ProviderMaterial;
      const own = material.expression.viewer.characterRef === ACTOR;
      calls.push(`${tool}:${material.expression.viewer.name}`);
      if (!own) {
        expect(material.expression.actorIntent).toBeNull();
        expect(JSON.stringify(material)).not.toContain(PRIVATE_RESULT);
        expect(material.facts.length).toBeGreaterThan(0);
        for (const fact of material.facts.filter(fact => fact.required)) {
          expect(material.payloads[fact.claimIndex]).not.toHaveProperty("evidenceRole", "stepSettlement");
        }
      }
      if (!tool) return { choices: [{ finish_reason: "stop", message: { content: own ? PRIVATE_RESULT : PUBLIC_RESULT } }], usage: { prompt_tokens: 10, completion_tokens: 10 } };
      const body = { status: "pass", issues: [] };
      return { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{
        type: "function", function: { name: tool, arguments: JSON.stringify(body) },
      }] } }], usage: { prompt_tokens: 10, completion_tokens: 10 } };
    } };
    const transport = new ActorPlanTransportCapability(ai);
    const narrator = createJournaledNarrationAdapter({ ai },
      (authority, generation, ordinal, body) => target.runNarrationInvocation(ALICE, authority, generation, ordinal, body, transport),
      async () => { throw new Error("unexpected pending NPC"); });
    const kp = { ...narrator, async propose() {
      return parseSubmitKpProposalBundleArguments(JSON.stringify(encodeVNextStrictToolBundle({
        mode: "adjudication", basisRefs: ["wake"], terminal: { kind: "none" },
        adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "只查看眼前景象。", successOutcome: "看清眼前景象。" },
        proposals: [{
          kind: "observe", basisRefs: ["wake"], consumes: [], produces: [], outcomeBinding: "always", sceneRef: "wake",
          inquiry: "查看守灵厅。", method: "留在原地观察。", focusRefs: ["wake"], existingFactRefs: [],
          branches: { success: { outcomeCode: "outcome:observed", summary: "查看了守灵厅。",
            sensoryEvidence: [{ observerRef: ACTOR, subjectRef: "wake", sense: "sight", evidence: PRIVATE_RESULT, basisRefs: ["wake"] }],
            characterInferences: [],
          }, failure: { kind: "none" } },
        }],
      })));
    } };
    return handleRoomAction({ principal: ALICE, authority: target as unknown as RoomAuthorityCapability,
      kp: kp as unknown as KpAdapterCapability },
      { kind: "intent", submissionId: "multiplayer:observe", text: "我留在原地查看守灵厅。PRIVATE_INTENT_CANARY" });
  });
  expect(result, JSON.stringify({ result, calls })).toMatchObject({ kind: "committed", narration: "published" });
  const observed = await stub.observe(BOB);
  expect(JSON.stringify(observed)).toContain(PUBLIC_RESULT);
  expect(JSON.stringify(observed)).not.toContain(PRIVATE_RESULT);
  expect(JSON.stringify(observed)).not.toContain("PRIVATE_INTENT_CANARY");
  expect(JSON.stringify(await stub.observe(ALICE))).toContain(PRIVATE_RESULT);
  const outside = JSON.stringify(await stub.observe(CAROL));
  expect(outside).not.toContain(PUBLIC_RESULT);
  expect(outside).not.toContain(PRIVATE_RESULT);
  expect(calls).toHaveLength(4);
  const frame = (observed as { delivery: { frame: { deliveryId: string } } }).delivery.frame;
  await stub.acknowledge(BOB, frame.deliveryId);
  await evictDurableObject(stub);
  const reconnected = JSON.stringify(await stub.observe(BOB));
  expect(reconnected).toContain(PUBLIC_RESULT);
  expect(reconnected).not.toContain(PRIVATE_RESULT);
  await runInDurableObject(stub, async (_instance, state) => { await state.storage.deleteAlarm(); });
});
