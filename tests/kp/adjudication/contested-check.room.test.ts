import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import { createVNextModelCallScope } from "../../../app/_runtime/lib/kp/vnext/model-call-scope";
import { ActorPlanTransportCapability } from "../../../app/_runtime/lib/room/actor-plan-transport";
import type { AuthoritativeKpAdapter, AuthoritativeModelBinding } from "../../../app/_runtime/lib/kp/authoritative-types";
import { sentBody } from "../../support/fixtures/vnext-request-layout.mjs";

// SPEC 0004 §4 and SPEC 0006 §7 through the real Room: the KP rules the
// user's sample "把奈斯拦腰抱起，扛到炉边" as a contest, the Room rolls both
// sides, the win holds Naes, and Naes decides in the same request whether to
// break free.

type Data = Record<string, any>;
const ALICE = { principal: { id: "principal:contest:alice", sessionVersion: 1 } };
const ACTOR = "character:contest:alice", SCENE = "wake", NAES = "npc:black-oak-will:naes";
const result = (name: string, value: unknown) => ({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(value) } }] } }] });

async function initialize(name: string) {
  const stub = env.VNEXT_ROOMS.getByName(name);
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{ characterId: ACTOR, controllerPrincipalId: ALICE.principal.id,
      staticCard: { name: "爱丽丝", sceneId: SCENE, level: 3, classId: "fighter", raceId: "human",
        scores: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, proficiency: 2, skills: ["athletics"],
        resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 28, max: 28, temp: 0 }, ac: 16, speed: 30, equipped: {}, backpack: [] } }],
  } as never)).toMatchObject({ created: true });
  return stub;
}

/** The KP's ruling: Athletics against Naes's choice of Athletics or Acrobatics. */
function carryBundle() {
  const branch = (code: string, summary: string, extra: Data = {}) => ({ outcomeCode: code, summary, effects: [], sensoryEvidence: [],
    pressures: [], opportunities: [], ...extra });
  return { mode: "adjudication", basisRefs: [NAES], terminal: null,
    adjudication: { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "str", skill: "athletics", dc: null, mode: "normal",
      risk: "奈斯会挣扎，旁人会看见。", successOutcome: "奈斯被拦腰抱起。", failureOutcome: "奈斯扭身挣开。",
      opposition: { opponentRef: NAES, checks: [{ ability: "str", skill: "athletics" }, { ability: "dex", skill: "acrobatics" }] } },
    proposals: [{ kind: "worldInteraction", basisRefs: [NAES], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE,
      intent: "把奈斯拦腰抱起，扛到炉边。", method: "冲上去拦腰抱住他往上提。", targetRefs: [NAES], directTargetRefs: [NAES], instrumentRefs: [], abilityRef: null,
      branches: { success: branch("naes-held", "奈斯被拦腰抱起。", { effects: [{ kind: "grapple", targetRef: NAES }],
        sensoryEvidence: [{ observerRef: NAES, subjectRef: ACTOR, sense: "touch", evidence: "被爱丽丝拦腰抱起，双脚离了地。", basisRefs: [ACTOR] }] }),
        failure: branch("naes-slipped", "奈斯扭身挣开。") } }] };
}

type Capture = { calls: string[]; reactionTools: string[]; narrations: Data[] };
/** Naes tries to slip free with Acrobatics against Alice's Athletics. */
function naesBinding(c: Capture): AuthoritativeModelBinding {
  return { async run(_model, input) {
    const request = input as Data, frame = sentBody(request) as Data;
    c.calls.push(`reaction:${frame.npcId}`);
    c.reactionTools.push(JSON.stringify(request.tools));
    const evidenceRef = frame.requiredContext.entries.map((entry: Data) => entry.entryRef)
      .find((ref: string) => typeof ref === "string" && ref.startsWith(`knowledge:${NAES}:fact:world-interaction:`));
    const felt = { observerRef: ACTOR, subjectRef: NAES, sense: "touch", evidence: "奈斯在你臂弯里拧身。", basisRefs: [evidenceRef] };
    const bundle = { mode: "adjudication", basisRefs: [evidenceRef], terminal: null,
      adjudication: { kind: "check", durationMicros: "0", checkKind: "abilityCheck", ability: "dex", skill: "acrobatics", dc: null, mode: "normal",
        risk: "挣不开会被抱得更紧。", successOutcome: "奈斯挣脱。", failureOutcome: "奈斯仍被抱着。",
        opposition: { opponentRef: ACTOR, checks: [{ ability: "str", skill: "athletics" }] } },
      proposals: [{ kind: "worldInteraction", basisRefs: [evidenceRef], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE,
        intent: "从她手里挣脱。", method: "扭腰往下滑。", targetRefs: [ACTOR], directTargetRefs: [ACTOR], instrumentRefs: [], abilityRef: null,
        branches: { success: { outcomeCode: "naes-free", summary: "奈斯挣脱了。", effects: [{ kind: "escapeGrapple", grapplerRef: ACTOR }],
          sensoryEvidence: [felt], pressures: [], opportunities: [] },
          failure: { outcomeCode: "naes-still-held", summary: "奈斯没能挣开。", effects: [], sensoryEvidence: [felt], pressures: [], opportunities: [] } } }] };
    return result("submit_kp_proposal_bundle", encodeVNextStrictToolBundle(bundle as never));
  } };
}

async function carryNaes(name: string, faces: number[]) {
  const c: Capture = { calls: [], reactionTools: [], narrations: [] };
  const stub = await initialize(name);
  return { c, ...await runInDurableObject(stub, async (instance) => {
    const target = instance as unknown as Data;
    const rolls = [...faces];
    target.authorityRoll = () => rolls.shift() ?? 10;
    const scope = createVNextModelCallScope({ roomId: name, limit: "12", emit() {} });
    const transport = new ActorPlanTransportCapability(scope.bind(naesBinding(c)));
    const authority = { prepare: (context: unknown, action: unknown) => target.prepare(context, action, transport),
      commit: (context: unknown, id: string, value: unknown) => target.commit(context, id, value, transport),
      resumePlayerRandomness: (context: unknown, id: string) => target.resumePlayerRandomness(context, id, transport),
      observe: (...args: unknown[]) => target.observe(...args), acknowledge: (...args: unknown[]) => target.acknowledge(...args),
      publishDelivery: (...args: unknown[]) => target.publishDelivery(...args),
      deliveryPublicationStatus: (...args: unknown[]) => target.deliveryPublicationStatus(...args),
      beginDeliveryAudiencePublication: (...args: unknown[]) => target.beginDeliveryAudiencePublication(...args),
      failDeliveryAudiencePublication: (...args: unknown[]) => target.failDeliveryAudiencePublication(...args),
    } as RoomAuthorityCapability;
    const narrationAdapter = { async narrate(request: Data) { c.narrations.push(structuredClone(request)); return { body: "已记录当前可见的行动。" }; },
      async propose() { throw new Error("unused"); } } as unknown as AuthoritativeKpAdapter;
    const kp = createVNextKpAdapter({ narrationAdapter, journal: {
      begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
      complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
    }, proposalBinding: scope.bind({ async run(_model, request) {
      c.calls.push("playerProposal");
      const tool = (request as Data).tools[0].function.name;
      if (tool === "offer_kp_proposal_bundle") return result(tool, { requestedCapabilities: ["worldInteraction"] });
      return result(tool, encodeVNextStrictToolBundle(carryBundle() as never));
    } }) });
    const act = (input: RoomActionInput) => handleRoomAction({ principal: ALICE, authority, kp }, input);
    const first = await act({ kind: "intent", submissionId: "carry-naes", text: "把奈斯拦腰抱起，扛到炉边" }) as Data;
    const pending = (await target.observe(ALICE) as Data).pendingPlayerRolls ?? [];
    const rolled = pending.length === 0 ? undefined
      : await act({ kind: "roll", submissionId: "carry-naes:roll", randomnessId: String(pending[0].id) } as RoomActionInput) as Data;
    const rows = (sql: string) => target.ctx.storage.sql.exec(sql).toArray() as Data[];
    return { first, rolled, pending: structuredClone(pending), left: rolls,
      dueRows: rows("SELECT child_root_action_id, work_kind, status FROM authority_due_work"),
      state: structuredClone(target.authoritativeReplay().state) as Data, events: structuredClone(target.authorityStore.events()) as Data[] };
  }) };
}

const describe = (run: Awaited<ReturnType<typeof carryNaes>>) => JSON.stringify({ first: run.first?.kind, firstCode: run.first?.code,
  explanation: run.first?.explanation, rolled: run.rolled?.kind, rolledCode: run.rolled?.code, calls: run.c.calls, left: run.left,
  due: run.dueRows,
  events: run.events.map(e => e.eventType) });

it("the KP rules carrying a resisting NPC as a contest; the win holds Naes, who tries to break free in the same request", async () => {
  // Alice: Athletics +4. Naes resists with Acrobatics +1 (Dexterity 12).
  // Alice 9 + 4 = 13 against Naes 6 + 1 = 7; then Naes 8 + 1 = 9 against Alice 10 + 4 = 14.
  const run = await carryNaes("contest-room-carry", [9, 6, 8, 10]);
  const detail = describe(run);
  expect((run.rolled ?? run.first).kind, detail).toBe("committed");
  expect(run.pending.map((roll: Data) => roll.dice), detail).toEqual(["1d20"]);
  const resolutions = run.events.filter(e => e.eventType === "WorldInteractionResolved").map(e => e.payload);
  expect(resolutions.map(payload => [payload.actorCharacterId, payload.branch, payload.check?.total, payload.check?.opposition?.total]), detail)
    .toEqual([[ACTOR, "success", 13, 7], [NAES, "failure", 9, 14]]);
  expect(resolutions[0].check.opposition.skill, detail).toBe("acrobatics");
  expect(run.state.combatRuntime.entities[NAES].conditions.grappledBy, detail).toBe(ACTOR);
  expect(run.c.calls.filter(call => call.startsWith("reaction:")), detail).toEqual([`reaction:${NAES}`]);
  expect(run.c.reactionTools[0], detail).toContain("escapeGrapple");
  const settled = run.events.filter(e => e.eventType === "NpcReactionSettled").map(e => [e.payload.characterId, e.payload.outcome]);
  expect(settled, detail).toEqual([[NAES, "reacted"]]);
  expect(run.dueRows.filter((row: Data) => row.status === "pending"), detail).toEqual([]);
  expect(run.left, detail).toEqual([]);
  // The contests reach the narration material with both totals.
  expect(run.c.narrations.some(n => JSON.stringify(n).includes("对抗检定")), detail).toBe(true);
}, 60_000);
