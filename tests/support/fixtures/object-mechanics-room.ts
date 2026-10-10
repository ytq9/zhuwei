import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect } from "vitest";
import { handleRoomAction, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import { vnextProposalCapabilityForEntry } from "../../../app/_runtime/lib/kp/vnext/proposal-capabilities";
import type { AuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative-types";
type Data = Record<string, any>;
export const OBJECT_ROOM_PRINCIPAL = { principal: { id: "principal:object-mechanics:alice", sessionVersion: 1 } };
export const OBJECT_ROOM_ACTOR = "character:object-mechanics:alice";
const ALICE = OBJECT_ROOM_PRINCIPAL, ACTOR = OBJECT_ROOM_ACTOR;

export async function initializeObjectRoom(name: string) {
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

export async function withObjectRoomScenario<T>(stub: ReturnType<typeof env.VNEXT_ROOMS.getByName>, body: (act: (id: string, text: string, proposals: Data[], duration?: string, filling?: (wire: Data) => Data, expectedKind?: string, selection?: (wire: Data) => Data) => Promise<Data>, target: Data, calls: Data[]) => Promise<T>) {
  return runInDurableObject(stub, async instance => {
    const target = instance as unknown as Data, calls: Data[] = [];
    const authority = Object.fromEntries(["prepare", "commit", "observe", "acknowledge", "publishDelivery", "deliveryPublicationStatus",
      "beginDeliveryAudiencePublication", "failDeliveryAudiencePublication", "beginViewerNarrationRecovery", "publishViewerNarrationRecovery", "failViewerNarrationRecovery"]
      .map(name => [name, (...args: unknown[]) => target[name](...args)])) as unknown as RoomAuthorityCapability;
    const act = async (id: string, text: string, proposals: Data[], duration = "300000000", filling?: (wire: Data) => Data, expectedKind = "committed", selection?: (wire: Data) => Data) => {
      const kp = createVNextKpAdapter({ narrationAdapter: { async narrate() { return { body: "你完成了眼前的操作。" }; },
        async propose() { throw new Error("unused"); } } as unknown as AuthoritativeKpAdapter,
        journal: { begin: (key, request) => target.beginVNextProposalInvocation(ALICE, key, request), complete: (key, completion) => target.completeVNextProposalInvocation(ALICE, key, completion) },
        // As the Room server wires it: a stage that names a memory or a
        // carried item has Room read it (ADR 0051, ADR 0132), and a refused
        // filling has Room preflight the rest of it (ADR 0138).
        recallKnowledge: (preparedActionId, refs) => target.recallKnowledgeForAction(ALICE, preparedActionId, [...refs]),
        preflightStandIn: (preparedActionId, bundle) => target.preflightStandInForAction(ALICE, preparedActionId, bundle),
        proposalBinding: { async run(_model: string, value: unknown) {
          const request = value as Data, name = String(request.tools[0].function.name); calls.push(request);
          const wire = name === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME ? { requestedCapabilities: [...new Set(proposals.map(p => { const capability = vnextProposalCapabilityForEntry(p); if (!capability) throw new Error(`Unknown capability for ${p.kind}`); return capability; }))] }
            : encodeVNextStrictToolBundle({ mode: "adjudication", basisRefs: [...new Set(proposals.flatMap(p => p.basisRefs))], terminal: null,
              adjudication: { kind: "directSuccess", durationMicros: duration, risk: "按实际条件操作。", successOutcome: "操作完成。" }, proposals } as never);
          const scripted = name === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME ? selection ? selection(wire) : wire : filling ? filling(wire) : wire;
          return { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(scripted) } }] } }] };
        } } });
      const result = await handleRoomAction({ principal: ALICE, authority, kp }, { kind: "intent", submissionId: id, text }) as Data;
      expect(result.kind, JSON.stringify({ result, last: calls.at(-1)?.messages.at(-1)?.content })).toBe(expectedKind);
      return result;
    };
    return body(act, target, calls);
  });
}
