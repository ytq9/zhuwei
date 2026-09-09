import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it, vi, afterEach } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../app/_runtime/lib/kp/vnext/adapter";
import { encodeVNextStrictToolBundle } from "../app/_runtime/lib/kp/vnext/proposal-schema";
import { createVNextModelCallScope } from "../app/_runtime/lib/kp/vnext/model-call-scope";
import { ActorPlanTransportCapability } from "../app/_runtime/lib/room/actor-plan-transport";
import { AuthoritativeRoomStore } from "../app/_runtime/lib/room/authority-store";
import type { AuthoritativeKpAdapter, AuthoritativeModelBinding } from "../app/_runtime/lib/kp/authoritative-types";
import { objectBundle, ACTOR } from "./fixtures/vnext-promise-lifecycle.mjs";
import { authoritativeNpcDecisionContext } from "../app/_runtime/lib/rules/v2/npc-decision-context";

// This test exercises the real Room Action/DO boundary with deterministic
// provider replies and authoritative initialization.
type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Data = Record<string, any>;
type Invocation = { ordinal: number; status: string; request_json: string; response_json: string | null; repair_ticket_json: string | null };
const ALICE = { principal: { id: "principal:promise:alice", sessionVersion: 1 } };
const NPC = "npc:black-oak-will:lian", SCENE = "wake", PRIVATE = "PLAYER_ONLY_PROMISE_CANARY", VERDICT = "HOST_ONLY_PROMISE_VERDICT";
const result = (name: string, value: unknown) => ({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(value) } }] } }] });
const capture = () => ({ calls: [] as string[], requests: [] as Data[], narrations: [] as Data[], crashAt: "", fail: false, failNarration: false, emptyNpcResponses: 0, callLimit: "7" });
type Capture = ReturnType<typeof capture>;
afterEach(() => vi.restoreAllMocks());
async function readInvocations(stub: Stub, root: string): Promise<Invocation[]> {
  return runInDurableObject(stub, instance => {
    const target = instance as unknown as { vnextInvocation(root: string, ordinal: number): Invocation | undefined };
    return [1, 2, 3].flatMap(ordinal => {
      const row = target.vnextInvocation(root, ordinal);
      return row === undefined ? [] : [{ ordinal: row.ordinal, status: row.status,
        request_json: row.request_json, response_json: row.response_json, repair_ticket_json: row.repair_ticket_json }];
    });
  });
}
async function initialize(name: string) {
  const stub = env.VNEXT_ROOMS.getByName(name);
  const character = (characterId: string, principal: typeof ALICE) => ({ characterId, controllerPrincipalId: principal.principal.id,
    staticCard: { name: characterId === NPC ? "文书员" : "阿莱莎", sceneId: SCENE, level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
      scores: { str: 12, dex: 14, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: ["perception"],
      resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [] } });
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [character(ACTOR, ALICE)],
    fixtureFacts: [{ knowledgeRef: "knowledge:promise:npc", holderEntityId: NPC, holderName: "文书员", sceneId: SCENE, content: "自己掌握纸笔与抄写方法。" },
      { knowledgeRef: "knowledge:promise:player", holderEntityId: ACTOR, content: PRIVATE }],
  } as never)).toMatchObject({ created: true });
  return stub;
}
function install(target: Data, c: Capture) {
  target.authorityRecoveryCheckpoint = (name: string) => {
    if (name === c.crashAt) { c.crashAt = ""; throw new Error(`interrupted:${name}`); }
  };
}
function decisionBinding(c: Capture): AuthoritativeModelBinding {
  return { async run(_model, input) {
    const request = input as Data, frame = JSON.parse(request.messages.find((m: Data) => m.role === "user").content);
    const name = request.tools[0].function.name;
    c.requests.push(structuredClone(frame)); c.calls.push(name);
    if (name === "select_npc_work_schema") {
      expect(request.tools).toHaveLength(1);
      expect(JSON.stringify(frame)).not.toContain(PRIVATE);
      return result(name, { requestedCapabilities: ["authorItem", "materializeItem", "inventoryOperation"] });
    }
    if (name === "submit_kp_proposal_bundle") {
      expect(frame.requiredContext.intent.actorRef).toBe(NPC);
      expect(JSON.stringify(frame)).not.toContain(PRIVATE);
      expect(frame.plan.knownPromise.terms.delivery.sourceRef).toBeTruthy();
      if (c.fail) throw new Error("provider response was lost after dispatch");
      if (c.emptyNpcResponses > 0) { c.emptyNpcResponses--; return result(name, {}); }
      return result(name, encodeVNextStrictToolBundle(objectBundle({ actor: NPC, scene: SCENE, sourceRef: frame.plan.knownPromise.terms.delivery.sourceRef })));
    }
    if (name === "submit_promise_review_batch") {
      expect(frame.schema).toBe("zhuwei.promise-review-batch/vnext-1");
      return result(name, { reviews: frame.frames.map((f: Data) => ({ promiseId: f.promiseId, judgment: {
        outcome: "unchanged", reason: "缺少决定性期间依据，保留待裁定。", evidenceRefs: [], completedParts: [], remaining: true } })) });
    }
    expect(frame.schema).toBe("zhuwei.promise-review-context/vnext-1");
    const delivery = frame.evidence.flatMap((e: Data) => e.itemsAfter.filter((i: Data) => i.holderRef === ACTOR).map((item: Data) => ({ event: e, item })))[0];
    return result(name, delivery ? { outcome: "fulfilled", reason: `${VERDICT}：真实物件已经依原约转交。`, evidenceRefs: [delivery.event.eventId, delivery.item.entryId], remaining: false }
      : { outcome: "unchanged", reason: "当前没有决定性结果。", evidenceRefs: [], remaining: true });
  } };
}
function promiseBundle(sourceRef: string) { return { mode: "adjudication", basisRefs: [NPC], terminal: null,
  adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "当面确定约定。", successOutcome: "NPC答应了自己的义务。" },
  proposals: [{ kind: "social", basisRefs: [NPC], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE, npcRef: NPC,
    addressedThreadRef: null, goal: "约定抄写与交付。", method: "当面商量。", communication: "spokenConversation", audience: "participants", retryChange: null,
    branches: { success: { outcomeCode: "promise:agreed", summary: "NPC作出约定。", response: { kind: "speech", text: "我会在一小时内抄好一份交给你。",
      motive: "答应自己能做的事。", basis: [{ kind: "npcContext", ref: NPC }] }, consequences: [{ kind: "promise", content: "一小时内抄好完整副本交到对方手里。",
      condition: "即刻生效。", authorityRefs: [NPC], due: "1h", terms: { kind: "result", subjectRefs: [NPC, sourceRef],
        delivery: { sourceRef, itemRef: null, quantity: 1, destinationKind: "holder", destinationRef: ACTOR } }, nextStep: "用原件抄写并交付副本。" }] }, failure: null } }],
}; }
async function run(stub: Stub, input: RoomActionInput, c: Capture, proposal?: unknown) {
  await runInDurableObject(stub, instance => install(instance as unknown as Data, c));
  const target = stub as unknown as Data;
  const scope = createVNextModelCallScope({ roomId: "promise-room-test", limit: c.callLimit, emit() {} });
  const transport = new ActorPlanTransportCapability(scope.bind(decisionBinding(c)));
  const authority = { prepare: (context: unknown, action: unknown) => target.prepare(context, action, transport),
    commit: (context: unknown, id: string, value: unknown) => target.commit(context, id, value, transport),
    observe: (...args: unknown[]) => target.observe(...args), acknowledge: (...args: unknown[]) => target.acknowledge(...args),
    publishDelivery: (...args: unknown[]) => target.publishDelivery(...args),
    deliveryPublicationStatus: (...args: unknown[]) => target.deliveryPublicationStatus(...args),
    beginDeliveryAudiencePublication: (...args: unknown[]) => target.beginDeliveryAudiencePublication(...args),
    failDeliveryAudiencePublication: (...args: unknown[]) => target.failDeliveryAudiencePublication(...args),
  } as RoomAuthorityCapability;
  const narrationAdapter = { async narrate(request: Data) {
    c.narrations.push(structuredClone(request));
    if (c.failNarration) throw new Error("deterministic narration response loss");
    return { body: "已记录当前可见的行动。" };
  }, async propose() { throw new Error("unused"); } } as unknown as AuthoritativeKpAdapter;
  const kp = createVNextKpAdapter({ narrationAdapter, journal: {
    begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
    complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
  }, proposalBinding: scope.bind({ async run(_model, request) {
    c.calls.push("playerProposal"); if (proposal === undefined) throw new Error("saved player proposal must be reused");
    const name = (request as Data).tools[0].function.name;
    return result(name, name === "offer_kp_proposal_bundle" ? { requestedCapabilities: ["authorItem", "materializeItem", "inventoryOperation", "social"] }
      : encodeVNextStrictToolBundle(proposal));
  } }) });
  return handleRoomAction({ principal: ALICE, authority, kp }, input);
}
async function snapshot(stub: Stub) { return runInDurableObject(stub, instance => {
  const t = instance as unknown as Data, replay = t.authoritativeReplay();
  return { state: structuredClone(replay.state) as Data, events: structuredClone(t.authorityStore.events()) as Data[],
    due: structuredClone(t.authorityStore.pendingDueWork()) as Data[] };
}); }
async function setup(name: string, c: Capture) {
  const stub = await initialize(name);
  const seeded = await run(stub, { kind: "intent", submissionId: "original", text: "拿出这份原件。" }, c, objectBundle({ original: true, scene: SCENE, label: "原件" }));
  expect(seeded.kind, JSON.stringify(seeded)).toBe("committed");
  const original = Object.values((await snapshot(stub)).state.campaignRuntime.itemSystem.entries)[0] as Data;
  await runInDurableObject(stub, instance => {
    const t = instance as unknown as Data, { state, profiles } = t.authoritativeReplay();
    expect(authoritativeNpcDecisionContext(state, profiles, NPC), JSON.stringify({ npc: state.entities[NPC] })).toBeTruthy();
  });
  const input: RoomActionInput = { kind: "intent", submissionId: "promise", text: "我对莉安说：请在一小时内把这份原件抄成一份完整副本，交给我。" };
  return { stub, original, input };
}
async function resume(stub: Stub, root: string, c: Capture) {
  const transport = new ActorPlanTransportCapability(createVNextModelCallScope({ roomId: "promise-resume", limit: "7", emit() {} }).bind(decisionBinding(c)));
  return runInDurableObject(stub, instance => {
    const t = instance as unknown as Data; install(t, c); return t.commitDueActivity(root, transport);
  });
}

it("Room resumes saved NPC and review responses after eviction, delivers once during long rest, and keeps the secret verdict private", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), { stub, original, input } = await setup("promise-room-recovery", c);
  c.crashAt = "afterActorPlanResponseSaved";
  const promised = await run(stub, input, c, promiseBundle(original.entryId));
  expect(promised.kind, JSON.stringify(promised)).toBe("committed");
  let saved = await snapshot(stub);
  expect(saved.due.some(d => d.work_kind === "npcWork" && d.activity_id === null)).toBe(true);
  expect(Object.keys(saved.state.campaignRuntime.itemSystem.entries)).toHaveLength(1);
  const calls = [...c.calls]; await evictDurableObject(stub);
  expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
  expect(c.calls).toEqual(calls);
  saved = await snapshot(stub);
  expect(Object.values(saved.state.campaignRuntime.activities).some((a: any) => a.characterId === NPC && a.status === "active")).toBe(true);
  const rest: RoomActionInput = { kind: "restStart", submissionId: "rest", restKind: "long", mode: "personal", hitDiceToSpend: 0, arcaneRecoverySlotLevels: [] };
  c.crashAt = "afterActorPlanResponseSaved";
  expect(await run(stub, rest, c)).toMatchObject({ kind: "committed" });
  const delivered = await snapshot(stub);
  expect(Object.keys(delivered.state.campaignRuntime.itemSystem.entries)).toHaveLength(2);
  expect(delivered.state.campaignRuntime.itemSystem.entries[original.entryId]).toEqual(original);
  const copy = Object.values(delivered.state.campaignRuntime.itemSystem.entries).find((i: any) => i.entryId !== original.entryId) as Data;
  expect(copy).toMatchObject({ holderRef: ACTOR, quantity: 1 });
  expect(delivered.state.entities[NPC].loadout).toBeUndefined();
  expect(delivered.due.some(d => d.work_kind === "promiseReview" && d.activity_id === null)).toBe(true);
  const reviewCalls = [...c.calls]; await evictDurableObject(stub);
  const recovered = await run(stub, rest, c);
  expect(recovered).toMatchObject({ kind: "committed" }); expect(c.calls).toEqual(reviewCalls);
  expect(JSON.stringify(recovered)).not.toContain(VERDICT);
  expect(JSON.stringify(recovered)).not.toContain("promiseReviewResult");
  const finished = await snapshot(stub), promise = Object.values(finished.state.campaignRuntime.promises)[0] as Data;
  expect(promise.status).toBe("fulfilled");
  expect(finished.events.filter(e => e.eventType === "PromiseReviewed")).toHaveLength(1);
  const observation = await (stub as unknown as RoomAuthorityCapability).observe!(ALICE);
  expect(JSON.stringify(observation)).not.toContain("promiseReviewResult");
  expect((observation as Data).readModel.promises[0].status).toBe("active");
  const narrations = structuredClone(c.narrations);
  expect(JSON.stringify(narrations)).not.toContain(VERDICT);
  await evictDurableObject(stub);
  const repeatedResponse = await run(stub, rest, c);
  expect(repeatedResponse).toEqual(recovered);
  const duplicate = await snapshot(stub);
  expect(duplicate.state).toEqual(finished.state);
  expect(duplicate.events).toEqual(finished.events); expect(c.calls).toEqual(reviewCalls);
  expect(c.narrations).toEqual(narrations);
}, 30_000);

it("a saved NPC schema selection resumes the selected filling stage after eviction without selecting again", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), { stub, original, input } = await setup("promise-room-selection", c);
  c.crashAt = "afterNpcWorkSelectionSaved";
  await run(stub, input, c, promiseBundle(original.entryId));
  const before = await snapshot(stub), due = before.due.find(d => d.work_kind === "npcWork")!;
  expect(c.calls.filter(name => name === "select_npc_work_schema")).toHaveLength(1);
  expect(c.calls.filter(name => name === "submit_kp_proposal_bundle")).toHaveLength(0);
  await evictDurableObject(stub);
  expect(await resume(stub, due.child_root_action_id, c)).toMatchObject({ kind: "committed" });
  expect(c.calls.filter(name => name === "select_npc_work_schema")).toHaveLength(1);
  expect(c.calls.filter(name => name === "submit_kp_proposal_bundle")).toHaveLength(1);
}, 30_000);

it("HTTP exhaustion after NPC selection preserves the uninvoked filling stage for the next request", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), { stub, original, input } = await setup("promise-room-selection-budget", c);
  c.callLimit = "3"; // Two player calls and the one NPC selector exhaust this HTTP.
  await run(stub, input, c, promiseBundle(original.entryId));
  const before = await snapshot(stub), due = before.due.find(d => d.work_kind === "npcWork")!;
  expect(c.calls.filter(name => name === "select_npc_work_schema")).toHaveLength(1);
  expect(c.calls.filter(name => name === "submit_kp_proposal_bundle")).toHaveLength(0);
  const rows = await readInvocations(stub, due.child_root_action_id);
  expect(rows.map(row => ({ ordinal: row.ordinal, status: row.status })))
    .toEqual([{ ordinal: 1, status: "completed" }, { ordinal: 2, status: "notSent" }]);
  await evictDurableObject(stub);
  expect(await resume(stub, due.child_root_action_id, c)).toMatchObject({ kind: "committed" });
  expect(c.calls.filter(name => name === "select_npc_work_schema")).toHaveLength(1);
  expect(c.calls.filter(name => name === "submit_kp_proposal_bundle")).toHaveLength(1);
}, 30_000);

it("an unknown dispatched NPC response is not sent again after eviction and never creates an item or a verdict", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), { stub, original, input } = await setup("promise-room-unknown", c);
  c.fail = true;
  const promised = await run(stub, input, c, promiseBundle(original.entryId));
  expect(promised.kind, JSON.stringify(promised)).toBe("committed");
  const before = await snapshot(stub), due = before.due.find(d => d.work_kind === "npcWork")!;
  const calls = [...c.calls]; await evictDurableObject(stub);
  expect(await resume(stub, due.child_root_action_id, c)).toMatchObject({ kind: "rejected", code: "ACTOR_PLAN_DECISION_OUTCOME_UNKNOWN" });
  const after = await snapshot(stub); expect(after.events).toEqual(before.events); expect(c.calls).toEqual(calls);
  expect(Object.keys(after.state.campaignRuntime.itemSystem.entries)).toHaveLength(1);
  expect(Object.values(after.state.campaignRuntime.promises).every((p: any) => p.status === "active")).toBe(true);
}, 30_000);

it("one saved empty NPC response permits one journaled re-emission after eviction, and a second empty response never loops", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  for (const emptyResponses of [1, 2]) {
    const c = capture(), { stub, original, input } = await setup(`promise-room-empty-${emptyResponses}`, c);
    c.emptyNpcResponses = emptyResponses; c.crashAt = "afterActorPlanResponseSaved";
    await run(stub, input, c, promiseBundle(original.entryId));
    const before = await snapshot(stub), due = before.due.find(d => d.work_kind === "npcWork")!;
    expect(c.calls.filter(name => name === "submit_kp_proposal_bundle")).toHaveLength(1);
    await evictDurableObject(stub);
    const resumed = await resume(stub, due.child_root_action_id, c);
    expect(resumed.kind).toBe(emptyResponses === 1 ? "committed" : "rejected");
    expect(c.calls.filter(name => name === "submit_kp_proposal_bundle")).toHaveLength(2);
    const rows = await readInvocations(stub, due.child_root_action_id);
    expect(rows.map(row => row.ordinal)).toEqual([1, 2, 3]);
    expect(JSON.parse(rows[1].repair_ticket_json!)).toMatchObject({ kind: "npcWorkSelection" });
    expect(JSON.parse(rows[1].response_json!).choices[0].message.tool_calls[0].function.arguments).toBe("{}");
    expect(JSON.parse(rows[2].repair_ticket_json!)).toMatchObject({ kind: "emptyNpcWorkResponse" });
    const initialRequest = JSON.parse(rows[1].request_json), repeatedRequest = JSON.parse(rows[2].request_json);
    const { messages: initialMessages, ...initialParameters } = initialRequest;
    const { messages: repeatedMessages, ...repeatedParameters } = repeatedRequest;
    expect(repeatedParameters).toEqual(initialParameters);
    expect(repeatedMessages.slice(0, -1)).toEqual(initialMessages);
    const after = await snapshot(stub), calls = [...c.calls]; await evictDurableObject(stub);
    await resume(stub, due.child_root_action_id, c);
    expect(c.calls).toEqual(calls); expect((await snapshot(stub)).state).toEqual(after.state);
  }
}, 30_000);

it("an unfinished audience recovers once and rejects a late response from its previous generation", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const stub = await initialize("promise-room-publication-generation"), c = capture();
  const input: RoomActionInput = { kind: "intent", submissionId: "original", text: "拿出这份原件。" };
  c.failNarration = true;
  const first = await run(stub, input, c, objectBundle({ original: true, scene: SCENE, label: "原件" }));
  expect(first).toMatchObject({ kind: "committed", audienceNarrations: [{ state: "retryableFailure", deliveryGeneration: 1 }] });
  const plan = await runInDurableObject(stub, (_instance, context) => {
    const row = context.storage.sql.exec<{ result_json: string }>(
      "SELECT result_json FROM authority_submissions WHERE root_action_id = ?", (first as Data).receipt.rootActionId).toArray()[0];
    return JSON.parse(row.result_json).deliveryPlan;
  });
  const target = stub as unknown as Data, query = { publishCapability: plan.publishCapability };
  expect(await target.deliveryPublicationStatus(query)).toMatchObject({ kind: "open", audiences: [{ state: "retryableFailure", deliveryGeneration: 1 }] });
  const saved = await snapshot(stub), calls = [...c.calls];
  c.failNarration = false; await evictDurableObject(stub);
  const recovered = await run(stub, input, c);
  expect(recovered).toMatchObject({ kind: "committed", audienceNarrations: [{ state: "published", deliveryGeneration: 2 }] });
  const published = await target.deliveryPublicationStatus(query);
  expect(await target.publishDelivery(query, { frames: [{ audienceId: plan.audiences[0].audienceId,
    deliveryGeneration: 1, narration: { body: "LATE_OLD_GENERATION_CANARY" } }] }))
    .toMatchObject({ kind: "rejected", code: "deliveryGenerationMismatch" });
  expect(await target.deliveryPublicationStatus(query)).toEqual(published);
  expect(JSON.stringify(await target.observe(ALICE))).not.toContain("LATE_OLD_GENERATION_CANARY");
  expect(await run(stub, input, c)).toEqual(recovered);
  const after = await snapshot(stub);
  expect(after.state).toEqual(saved.state); expect(after.events).toEqual(saved.events);
  expect(c.calls).toEqual(calls); expect(c.narrations).toHaveLength(2);
}, 30_000);

it("the local queue schema upgrade preserves old pending activity work and its retry state", async () => {
  const stub = await initialize("promise-room-queue-upgrade");
  await runInDurableObject(stub, (_instance, state) => {
    const sql = state.storage.sql;
    sql.exec("DROP TABLE authority_due_work");
    sql.exec(`CREATE TABLE authority_due_work (child_root_action_id TEXT PRIMARY KEY, cause_root_action_id TEXT NOT NULL,
      cause_event_id TEXT NOT NULL, descriptor_json TEXT NOT NULL, timeline_id TEXT NOT NULL, completion_fiction_micros TEXT NOT NULL,
      activity_id TEXT NOT NULL, next_attempt_at INTEGER, status TEXT NOT NULL)`);
    sql.exec("CREATE INDEX authority_due_work_pending_idx ON authority_due_work(status, timeline_id)");
    sql.exec("INSERT INTO authority_due_work VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", "old-root", "cause", "event", '{"activityId":"old-activity"}', "timeline", "100", "old-activity", 123, "pending");
    const store = new AuthoritativeRoomStore(state.storage); store.ensureSchema();
    expect(store.dueWorkByRoot("old-root")).toEqual({ child_root_action_id: "old-root", cause_root_action_id: "cause", cause_event_id: "event",
      descriptor_json: '{"activityId":"old-activity"}', timeline_id: "timeline", completion_fiction_micros: "100", activity_id: "old-activity",
      work_kind: "activity", work_ref: "old-activity", next_attempt_at: 123, status: "pending" });
  });
});


it("Room merges two obligations into one saved review response and resumes both exactly once", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), { stub, original, input } = await setup("promise-room-batch", c);
  const bundle = promiseBundle(original.entryId), branch = bundle.proposals[0].branches.success;
  const obligation = { kind: "promise", content: "这一小时保守约定中的消息。", condition: "立即生效。", authorityRefs: [NPC], due: "1h",
    terms: { kind: "ongoing", subjectRefs: [NPC], delivery: null }, nextStep: null };
  branch.consequences = [obligation, { ...structuredClone(obligation), content: "这一小时保守另一项消息。" }] as never;
  expect(await run(stub, input, c, bundle)).toMatchObject({ kind: "committed" });
  const rest: RoomActionInput = { kind: "restStart", submissionId: "rest-batch", restKind: "long", mode: "personal", hitDiceToSpend: 0, arcaneRecoverySlotLevels: [] };
  c.crashAt = "afterActorPlanResponseSaved";
  expect(await run(stub, rest, c)).toMatchObject({ kind: "committed" });
  const before = await snapshot(stub), calls = [...c.calls];
  expect(c.calls.filter(name => name === "submit_promise_review_batch")).toHaveLength(1);
  expect(before.due.filter(d => d.work_kind === "promiseReview")).toHaveLength(1);
  await evictDurableObject(stub);
  const recovered = await run(stub, rest, c), after = await snapshot(stub);
  expect(recovered).toMatchObject({ kind: "committed" }); expect(c.calls).toEqual(calls);
  expect(after.events.filter(e => e.eventType === "PromiseReviewed")).toHaveLength(2);
  expect(Object.values(after.state.campaignRuntime.promises).every((p: any) => p.lifecycle.obligation === "outstanding")).toBe(true);
  expect(await run(stub, rest, c)).toEqual(recovered);
  expect((await snapshot(stub)).events).toEqual(after.events); expect(c.calls).toEqual(calls);
}, 30_000);

it("a real player intent creates and extends only that player's promise through the shared filling and Room path", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), { stub, original } = await setup("promise-room-player", c);
  const input: RoomActionInput = { kind: "intent", submissionId: "player-promise", text: "我答应会试着把这份消息带到。" };
  const bundle = promiseBundle(original.entryId), branch = bundle.proposals[0].branches.success;
  branch.consequences = [{ kind: "promise", content: input.text, condition: "立即生效。", promisor: "actor", promiseeRef: NPC, authorityRefs: [ACTOR], due: "1h",
    terms: { kind: "attempt", subjectRefs: [ACTOR, NPC], delivery: null, parts: [], activation: null }, nextStep: null }] as never;
  expect(await run(stub, input, c, bundle)).toMatchObject({ kind: "committed" });
  const formed = await snapshot(stub), promise = Object.values(formed.state.campaignRuntime.promises)[0] as Data;
  expect(promise.promisorId).toBe(ACTOR); expect(formed.state.campaignRuntime.npcPlans).toEqual({});
  const changeInput: RoomActionInput = { kind: "intent", submissionId: "player-extension", text: "我申请将刚才的承诺延后一小时。" };
  const amendment = promiseBundle(original.entryId);
  amendment.proposals[0].goal = "商定延后的时间。";
  amendment.proposals[0].branches.success.consequences = [{ kind: "promiseChange", promiseRef: `continuity:promises:${promise.promiseId}`,
    revision: promise.lifecycle.revision, expressionSource: "actor", expressionQuote: changeInput.text, disclose: true,
    change: { kind: "amend", accepted: true, reason: "根据这次交流，同意延后。", content: promise.content, condition: promise.condition,
      terms: promise.lifecycle.terms, deadlineFictionMicros: String(BigInt(promise.lifecycle.deadlineFictionMicros) + 3600000000n), releasedParts: [], remaining: true } }] as never;
  const changeResult = await run(stub, changeInput, c, amendment);
  expect(changeResult).toMatchObject({ kind: "committed" });
  const changed = await snapshot(stub), final = changed.state.campaignRuntime.promises[promise.promiseId];
  expect(final.lifecycle.revision).toBe("2"); expect(final.lifecycle.versions).toHaveLength(2);
  const calls = [...c.calls]; await evictDurableObject(stub);
  expect(await run(stub, changeInput, c)).toMatchObject({ kind: "committed" });
  expect((await snapshot(stub)).events).toEqual(changed.events); expect(c.calls).toEqual(calls);
}, 30_000);
