import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it, vi, afterEach } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import { createVNextModelCallScope } from "../../../app/_runtime/lib/kp/vnext/model-call-scope";
import { ActorPlanTransportCapability } from "../../../app/_runtime/lib/room/actor-plan-transport";
import type { AuthoritativeKpAdapter, AuthoritativeModelBinding } from "../../../app/_runtime/lib/kp/authoritative-types";
import { sentBody } from "../../support/fixtures/vnext-request-layout.mjs";
import { projectAuthoritativeTableObservation } from "../../../app/_runtime/lib/table/authoritative";
import { scriptedNpcReply, scriptedNpcReview } from "../../support/fixtures/vnext-npc-replies.mjs";

// SPEC 0006 §7: an NPC carrying out its promise to go somewhere moves for
// real, through the ordinary NPC work decision of the next request.
type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Data = Record<string, any>;
const ALICE = { principal: { id: "principal:npc-move:alice", sessionVersion: 1 } };
const ACTOR = "character:npc-move:alice", LIAN = "npc:black-oak-will:lian", VARO = "npc:black-oak-will:varo";
const HALL = "wake", YARD = "yard";
const result = (name: string, value: unknown) => ({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(value) } }] } }] });
const capture = () => ({ calls: [] as string[], npcFrames: [] as Data[], npcTools: [] as Data[], narrations: [] as Data[] });
type Capture = ReturnType<typeof capture>;
afterEach(() => vi.restoreAllMocks());

async function initialize(name: string) {
  const stub = env.VNEXT_ROOMS.getByName(name);
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{ characterId: ACTOR, controllerPrincipalId: ALICE.principal.id,
      staticCard: { name: "1", sceneId: HALL, level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
        scores: { str: 12, dex: 14, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: ["perception"],
        resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [] } }],
  } as never)).toMatchObject({ created: true });
  return stub;
}

/** Lian agrees to go and look at the cellar door in the yard. */
function askLian() {
  return { mode: "adjudication", basisRefs: [LIAN], terminal: null,
    adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "托她跑一趟，没有额外代价。", successOutcome: "莉安答应去后院看一眼。" },
    proposals: [{ kind: "social", basisRefs: [LIAN], consumes: [], produces: [], outcomeBinding: "always", sceneRef: HALL, npcRef: LIAN,
      actorSpeech: "莉安，能帮我去后院看看酒窖门上的钉子吗？", goal: "请莉安去后院看酒窖门。",
      method: "当面请她跑一趟。", communication: "spokenConversation", audience: "participants",
      branches: { success: { outcomeCode: "lian-agrees-to-look", summary: "莉安答应去后院看看。", npcPerceives: null,
        response: { kind: "speech", text: "行，我去后院看一眼，你在这儿等着。", motive: "她也想知道是谁钉的门。", basis: [{ kind: "npcContext", ref: LIAN }] },
        consequences: [{ kind: "promise", content: "我去后院看一眼酒窖门，回来告诉你。", condition: "无额外条件。", promisor: "npc", promiseeRef: ACTOR,
          authorityRefs: [LIAN], due: "none",
          terms: { kind: "attempt", subjectRefs: [LIAN, ACTOR], delivery: null, parts: [], activation: null },
          nextStep: "起身去后院，看酒窖门上的钉子。" }] }, failure: null } }] };
}
/** The player's own next act does not involve Lian. */
function askVaro() {
  return { mode: "adjudication", basisRefs: [VARO], terminal: null,
    adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "只是问一句话。", successOutcome: "瓦罗回答了。" },
    proposals: [{ kind: "social", basisRefs: [VARO], consumes: [], produces: [], outcomeBinding: "always", sceneRef: HALL, npcRef: VARO,
      actorSpeech: "瓦罗先生，今晚的宣读什么时候开始？", goal: "问宣读的时间。", method: "当面询问。",
      communication: "spokenConversation", audience: "participants",
      branches: { success: { outcomeCode: "varo-answers", summary: "瓦罗回答了宣读时间。", npcPerceives: null,
        response: { kind: "speech", text: "等守灵的人到齐就念。", motive: "他想尽快把备案念完。", basis: [{ kind: "npcContext", ref: VARO }] },
        consequences: [] }, failure: null } }] };
}
/** Lian's own decision: she walks out to the yard, seen by the actor. With
 * `forceDoor` the back door sticks and she has to shove it open (a check). */
function lianLeaves(forceDoor = false) {
  const branch = { outcomeCode: "outcome:lian-left", summary: "莉安起身去了后院。", effects: [{ kind: "moveNpc", destination: { kind: "scene", sceneRef: YARD, travel: "none" } }],
    sensoryEvidence: [{ observerRef: ACTOR, subjectRef: LIAN, sense: "sight", evidence: "莉安放下汤勺，从后门出去了。", basisRefs: [LIAN] }],
    pressures: [], opportunities: [] };
  const stuck = { outcomeCode: "outcome:lian-door-stuck", summary: "后门卡死了，莉安没能出去。", effects: [],
    sensoryEvidence: [{ observerRef: ACTOR, subjectRef: LIAN, sense: "sight", evidence: "莉安用肩膀撞了两下后门，门没开。", basisRefs: [LIAN] }],
    pressures: [], opportunities: [] };
  return { mode: "adjudication", basisRefs: [LIAN], terminal: { kind: "none" },
    adjudication: forceDoor ? { kind: "check", durationMicros: "0", checkKind: "abilityCheck", ability: "str", skill: "athletics", dc: 10, mode: "normal",
      risk: "后门受潮卡住了，可能撞不开。", successOutcome: "莉安撞开后门到了后院。", failureOutcome: "后门没撞开，莉安还在大厅。" }
      : { kind: "directSuccess", durationMicros: "0", risk: "没有风险。", successOutcome: "莉安到了后院。" },
    proposals: [{ kind: "worldInteraction", basisRefs: [LIAN], consumes: [], produces: [], outcomeBinding: "always", sceneRef: HALL,
      intent: "去后院看酒窖门上的钉子。", method: forceDoor ? "用肩膀撞开卡住的后门走出去。" : "从后门走出去。", targetRefs: [YARD], directTargetRefs: [YARD], instrumentRefs: [],
      abilityRef: { kind: "none" }, branches: { success: branch, failure: forceDoor ? stuck : { kind: "none" } } }] };
}
function decisionBinding(c: Capture, forceDoor = false): AuthoritativeModelBinding {
  return { async run(_model, input) {
    const request = input as Data, frame = sentBody(request) as Data;
    const name = request.tools[0].function.name;
    c.calls.push(name);
    if (name === "select_npc_work_schema") return result(name, { requestedCapabilities: ["worldInteraction"] });
    if (name === "submit_kp_proposal_bundle") {
      c.npcFrames.push(structuredClone(frame));
      c.npcTools.push(structuredClone(request.tools[0]));
      return result(name, encodeVNextStrictToolBundle(lianLeaves(forceDoor) as never));
    }
    if (name.startsWith("submit_promise_review")) {
      const frames: Data[] = frame.schema === "zhuwei.promise-review-batch/vnext-1" ? frame.frames : [frame];
      const reviews = frames.map((f: Data) => ({ promiseId: f.promiseId,
        judgment: { outcome: "unchanged", reason: "她还没回来告诉结果。", evidenceRefs: [], remaining: true } }));
      return result(name, frame.schema === "zhuwei.promise-review-batch/vnext-1" ? { reviews } : reviews[0].judgment);
    }
    throw new Error(`unexpected tool ${name}`);
  } };
}
/** `target` is the Room stub, or the Room instance inside runInDurableObject
 * when the test fixes the Room's own dice. */
async function run(target: Stub | Data, input: RoomActionInput, c: Capture, proposal: unknown, forceDoor = false) {
  const room = target as unknown as Data;
  const scope = createVNextModelCallScope({ roomId: "npc-move-room-test", limit: "9", emit() {} });
  const transport = new ActorPlanTransportCapability(scope.bind(decisionBinding(c, forceDoor)));
  const authority = { prepare: (context: unknown, action: unknown) => room.prepare(context, action, transport),
    commit: (context: unknown, id: string, value: unknown) => room.commit(context, id, value, transport),
    observe: (...args: unknown[]) => room.observe(...args), acknowledge: (...args: unknown[]) => room.acknowledge(...args),
    publishDelivery: (...args: unknown[]) => room.publishDelivery(...args),
    deliveryPublicationStatus: (...args: unknown[]) => room.deliveryPublicationStatus(...args),
    beginDeliveryAudiencePublication: (...args: unknown[]) => room.beginDeliveryAudiencePublication(...args),
    failDeliveryAudiencePublication: (...args: unknown[]) => room.failDeliveryAudiencePublication(...args),
  } as RoomAuthorityCapability;
  const narrationAdapter = { async narrate(request: Data) { c.narrations.push(structuredClone(request)); return { body: "已记录当前可见的行动。" }; },
    async propose() { throw new Error("unused"); } } as unknown as AuthoritativeKpAdapter;
  const kp = createVNextKpAdapter({ narrationAdapter, journal: {
    begin: (id, request) => room.beginVNextProposalInvocation(ALICE, id, request),
    complete: (id, completion) => room.completeVNextProposalInvocation(ALICE, id, completion),
  }, proposalBinding: scope.bind({ async run(_model, request) {
    c.calls.push("playerProposal");
    const name = (request as Data).tools[0].function.name;
    if (name === "offer_kp_proposal_bundle") return result(name, { requestedCapabilities: ["social"] });
    // SPEC 0016 §7.3 (ADR 0073): the NPC answers in its own call.
    return scriptedNpcReview(request) ?? scriptedNpcReply(request, proposal) ?? result(name, encodeVNextStrictToolBundle(proposal as never));
  } }) });
  return handleRoomAction({ principal: ALICE, authority, kp }, input);
}
async function snapshot(stub: Stub) { return runInDurableObject(stub, (instance) => {
  const t = instance as unknown as Data, replay = t.authoritativeReplay();
  return { state: structuredClone(replay.state) as Data, events: structuredClone(t.authorityStore.events()) as Data[] };
}); }
async function observed(stub: Stub) {
  const target = stub as unknown as Data;
  return await target.observe(ALICE) as Data;
}

it("Lian's promise to look at the yard takes her out of the hall at the next request, and the hall sees her go", async () => {
  const c = capture();
  const stub = await initialize("npc-move-room");
  const first = await run(stub, { kind: "intent", submissionId: "ask-lian", text: "莉安，能帮我去后院看看酒窖门上的钉子吗？" }, c, askLian());
  expect(first.kind, JSON.stringify(first)).toBe("committed");
  // SPEC 0006 §7: agreeing to go at once is only a promise; the talk itself
  // leaves her in the hall.
  const afterFirst = await snapshot(stub);
  expect(afterFirst.state.entities[LIAN].sceneId).toBe(HALL);
  expect(afterFirst.events.some(event => event.eventType === "CharacterMoved")).toBe(false);

  const second = await run(stub, { kind: "intent", submissionId: "ask-varo", text: "瓦罗先生，今晚的宣读什么时候开始？" }, c, askVaro());
  const after = await snapshot(stub);
  const detail = JSON.stringify({ second, calls: c.calls, events: after.events.map(event => event.eventType) });
  expect(second.kind, detail).toBe("committed");
  expect(c.calls.filter(name => name === "select_npc_work_schema"), detail).toHaveLength(1);

  // The NPC's own request offers the move, to the scenes it can walk to.
  const tool = JSON.stringify(c.npcTools[0]);
  expect(tool, detail).toContain("moveNpc");
  expect(tool, detail).toContain(`"${YARD}"`);

  const moved = after.events.find(event => event.eventType === "CharacterMoved");
  expect(moved?.payload.characterId, detail).toBe(LIAN);
  // She leaves at the start of the player's next action, before its own activity.
  const playerActivity = after.events.findIndex((event, index) => index >= afterFirst.events.length && event.eventType === "ActivityStarted");
  expect(playerActivity, detail).toBeGreaterThan(after.events.indexOf(moved!));
  expect(after.state.entities[LIAN].sceneId, detail).toBe(YARD);
  expect(after.state.combatRuntime.entities[LIAN].sceneId, detail).toBe(YARD);
  const plan = Object.values(after.state.campaignRuntime.npcPlans)[0] as Data;
  expect(plan.status, detail).toBe("resolved");

  const departed = c.narrations.some(n => (n.renderableClaims?.claims ?? []).some((claim: Data) =>
    claim.outcomeCode === "departed" && claim.actorRef === LIAN));
  expect(departed, JSON.stringify(c.narrations.map(n => (n.renderableClaims?.claims ?? []).map((claim: Data) => claim.kind + ":" + (claim.outcomeCode ?? ""))))).toBe(true);

  const view = await observed(stub);
  const readModel = view.readModel ?? view;
  expect(Object.keys(readModel.entities ?? {}), detail).not.toContain(LIAN);
  // SPEC 0010 §7: the table's present list follows the same projection.
  const table = projectAuthoritativeTableObservation({ userId: ALICE.principal.id, members: [ALICE.principal.id],
    locationLabels: {}, observation: view }) as Data;
  expect(table.present.map((entry: Data) => entry.id), detail).not.toContain(LIAN);
  expect(table.present.find((entry: Data) => entry.id === VARO), detail).toMatchObject({ name: "书记官瓦罗", kind: "npc",
    tenureStatus: "active", alive: true, conscious: true });
}, 60_000);

// SPEC 0006 §7, §6: an NPC's promised act that needs a roll is settled by
// `step` like a player's: the Room rolls its dice and the act commits in the
// same request. Before, the journaled dice moved the replay head past the
// NPC's frozen frame (dueDecisionContextChanged), the Room could not resume
// the work's act, and the plan stayed due.
it("Lian's promised act that needs a roll is rolled by the Room and committed in the next request", async () => {
  const c = capture();
  const stub = await initialize("npc-move-room-check");
  const first = await run(stub, { kind: "intent", submissionId: "ask-lian", text: "莉安，能帮我去后院看看酒窖门上的钉子吗？" }, c, askLian());
  expect(first.kind, JSON.stringify(first)).toBe("committed");
  const after = await runInDurableObject(stub, async (instance) => {
    const room = instance as unknown as Data, rolls: number[] = [];
    room.authorityRoll = (sides: number) => { rolls.push(sides); return 20; };
    const second = await run(room, { kind: "intent", submissionId: "ask-varo", text: "瓦罗先生，今晚的宣读什么时候开始？" }, c, askVaro(), true) as Data;
    const rows = (sql: string) => room.ctx.storage.sql.exec(sql).toArray() as Data[];
    return { second, rolls, state: structuredClone(room.authoritativeReplay().state) as Data, events: structuredClone(room.authorityStore.events()) as Data[],
      due: rows("SELECT child_root_action_id, work_kind, status FROM authority_due_work") };
  });
  await runInDurableObject(stub, async (_instance, state) => { await state.storage.deleteAlarm(); });
  const detail = JSON.stringify({ second: { kind: after.second.kind, code: after.second.code, explanation: after.second.explanation,
    due: after.second.dueOutcomes?.map((d: Data) => [d.kind, d.code]) }, rolls: after.rolls, calls: c.calls, due: after.due,
    events: after.events.map(event => `${event.eventType}:${String(event.rootActionId).slice(0, 40)}`) });
  expect(after.second.kind, detail).toBe("committed");
  expect(after.rolls, detail).toEqual([20]);
  // Her one decision is asked once and settled once.
  expect(c.calls.filter(name => name === "select_npc_work_schema"), detail).toHaveLength(1);
  const acts = after.events.filter(event => event.eventType === "WorldInteractionResolved" && event.payload.actorCharacterId === LIAN);
  expect(acts.map(event => [event.payload.rulingKind, event.payload.branch]), detail).toEqual([["check", "success"]]);
  expect(after.events.find(event => event.eventType === "CharacterMoved")?.payload.characterId, detail).toBe(LIAN);
  expect(after.state.entities[LIAN].sceneId, detail).toBe(YARD);
  const started = after.events.filter(event => event.eventType === "NpcWorkStarted");
  expect(started.map(event => event.rootActionId), detail).toEqual([acts[0]?.rootActionId]);
  const plan = Object.values(after.state.campaignRuntime.npcPlans)[0] as Data;
  expect(plan.status, detail).toBe("resolved");
  expect(after.due.filter(row => row.work_kind === "npcWork").map(row => row.status), detail).toEqual(["committed"]);
}, 60_000);
