import { canonicalHash } from "../app/_runtime/lib/kp/vnext/canonical-json";
import { projectAuthoritativeTableObservation } from "../app/_runtime/lib/table/authoritative";
import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../app/_runtime/lib/kp/vnext/adapter";
import type { AuthoritativeKpAdapter, AuthoritativeModelBinding } from "../app/_runtime/lib/kp/authoritative-types";
import type { VNextInvocationRequest, VNextInvocationStart, VNextInvocationCompletion } from "../app/_runtime/lib/room/vnext-proposal-invocation";
import { encodeVNextStrictToolBundle, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME } from "../app/_runtime/lib/kp/vnext/proposal-schema";
import { createDefinitionSnapshot, storedSemanticDefinition } from "../app/_runtime/lib/rules/v2/semantic-definitions";
import { dueActorPlanChildRoot } from "../app/_runtime/lib/rules/v2/actor-plans";
import { continueCompoundRoot } from "../app/_runtime/lib/rules/v2/internal-compound";
import { characterTimelineId } from "../app/_runtime/lib/rules/v2/timeline";
import { frozenRenderableClaimsConform } from "../app/_runtime/lib/rules/v2/claims";
import { createVNextModelCallScope } from "../app/_runtime/lib/kp/vnext/model-call-scope";
import { ActorPlanTransportCapability } from "../app/_runtime/lib/room/actor-plan-transport";
import type { ActorPlanTransport } from "../app/_runtime/lib/room/actor-plan-transport-types";
import type { AuthoritativeWorldState, EventEnvelope, RuntimeGenesis, RuntimeProfileManifest, step as rulesStep, replay as rulesReplay, project as rulesProject } from "../app/_runtime/lib/rules";

type RecordValue = Record<string, unknown>;
type Principal = { principal: { id: string; sessionVersion: number } };
type Invocation = { ordinal: number; status: string; request_json: string; response_json: string | null; request_hash: string; context_hash: string; binding_hash: string; lease_until: number };
type Internals = RoomAuthorityCapability & {
  authorityRecoveryCheckpoint?: (name: string) => void;
  authorityRoll(sides: number): number;
  prepare(context: Parameters<RoomAuthorityCapability["prepare"]>[0], input: Parameters<RoomAuthorityCapability["prepare"]>[1], transport?: ActorPlanTransport): ReturnType<RoomAuthorityCapability["prepare"]>;
  commit(context: Parameters<RoomAuthorityCapability["commit"]>[0], id: string, proposal: Parameters<RoomAuthorityCapability["commit"]>[2], transport?: ActorPlanTransport): ReturnType<RoomAuthorityCapability["commit"]>;
  resumePlayerRandomness(context: Parameters<NonNullable<RoomAuthorityCapability["resumePlayerRandomness"]>>[0], id: string, transport?: ActorPlanTransport): ReturnType<NonNullable<RoomAuthorityCapability["resumePlayerRandomness"]>>;
  beginVNextProposalInvocation(principal: Principal, id: string, input: VNextInvocationRequest): Promise<VNextInvocationStart>;
  completeVNextProposalInvocation(principal: Principal, id: string, input: VNextInvocationCompletion): Promise<{ kind: string }>;
  authoritativeReplay(): { state: AuthoritativeWorldState; genesis: RuntimeGenesis; profiles: RuntimeProfileManifest };
  appendAuthorityTransition(state: AuthoritativeWorldState, events: EventEnvelope[]): void;
  authorityStore: { transaction<T>(fn: () => T): T; events(): EventEnvelope[]; pendingDueWork(): RecordValue[];
    dueWorkByRoot(root: string): RecordValue | undefined; vnextInvocation(root: string, ordinal: number): Invocation | undefined };
  rulesRuntime: { step: typeof rulesStep; replay: typeof rulesReplay; project: typeof rulesProject };
  commitDueActivity(root: string, transport?: ActorPlanTransport): Promise<unknown>;
};
const ALICE: Principal = { principal: { id: "principal:vnext-plan:alice", sessionVersion: 1 } };
const BOB: Principal = { principal: { id: "principal:vnext-plan:bob", sessionVersion: 1 } };
const ACTOR = "character:vnext-plan:alice", NPC = "npc:vnext-plan:watcher", SCENE = "wake";
const SOURCE = "definition:vnext-plan:control", PREMISE = "knowledge:vnext-plan:npc-order";
const PRIVATE_REF = "knowledge:vnext-plan:player-private", PRIVATE = "PLAYER_PRIVATE_ROUTE_CANARY";
const PLAN = "actor-plan:vnext-room:existing", ACTIVITY = "activity:vnext-room:existing", TRACE = "fact:vnext-room:trace";
const DESCRIPTION = "门框上多了一条刚系好的蓝色布带。";
type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Capture = { playerRequests: RecordValue[]; actorRequests: RecordValue[]; narration: RecordValue[];
  actorCalls: Record<string, number>; draws: number; crashAt?: string; decision?: RecordValue; failActor?: boolean;
  afterStart?: (target: Internals) => void; callLimit?: string; countNarrationCalls?: boolean; httpCalls: string[][] };
const capture = (): Capture => ({ playerRequests: [], actorRequests: [], narration: [], actorCalls: {}, draws: 0, httpCalls: [] });
function record(value: unknown): RecordValue { return value as RecordValue; }
afterEach(() => vi.restoreAllMocks());
function timePassageTelemetry(calls: unknown[][]): RecordValue[] {
  return calls.flatMap(([line]) => {
    try {
      const event = JSON.parse(String(line));
      return event.eventName === "room.time-passage.advanced" ? [event] : [];
    } catch { return []; }
  });
}

async function initialize(name: string, mechanicalNpc = false, keepSecondPlayer = false): Promise<Stub> {
  const stub = env.VNEXT_ROOMS.getByName(name);
  const feature = storedSemanticDefinition("sceneFeature", "visibility:scene-observers", createDefinitionSnapshot(SOURCE, "1", {
    sceneRef: SCENE, label: "固定外壳", description: "一件需要合适工具才能拆开的固定外壳。", observableState: "closed", affordances: ["inspect"], mechanicDefinitionRefs: [] }));
  const character = (characterId: string, principal: Principal) => ({ characterId, controllerPrincipalId: principal.principal.id,
      staticCard: { name: characterId === NPC ? "值班人" : "阿莱莎", sceneId: SCENE, level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
        scores: { str: 12, dex: 14, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: ["perception"],
        resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [] } });
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }, ...(mechanicalNpc ? [{ principalId: BOB.principal.id, role: "player" }] : [])],
    characters: [character(ACTOR, ALICE), ...(mechanicalNpc ? [character(NPC, BOB)] : [])],
    fixtureFacts: [{ knowledgeRef: PREMISE, holderEntityId: NPC, holderName: "值班人", sceneId: SCENE, content: "NPC_PRIVATE_ORDER_CANARY：交接后系上蓝色布带。" },
      { knowledgeRef: PRIVATE_REF, holderEntityId: ACTOR, content: PRIVATE }],
    vNextSeed: { semanticDefinitions: [feature], itemDefinitions: [], itemEntries: [], entityDefinitionBindings: [] },
  } as never)).toMatchObject({ created: true });
  if (mechanicalNpc && !keepSecondPlayer) await runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals, { profiles, state } = target.authoritativeReplay();
    const retired = target.rulesRuntime.step(profiles, state, { kind: "retireCharacter", proposalId: "root:fixture:retire-npc",
      characterId: NPC, reason: "交还角色控制权后留在世界中", continueAsNpc: true });
    expect(retired.kind, JSON.stringify(retired)).toBe("committed");
    if (retired.kind !== "committed") throw new Error("mechanical NPC fixture did not retire");
    target.authorityStore.transaction(() => target.appendAuthorityTransition(retired.state as AuthoritativeWorldState, retired.events));
  });
  return stub;
}

// Test-only trusted seeding of an already-existing plan through Rules and the
// Room journal. The marker is internal and cannot be sent by a client/model.
// This does not exercise a product entrypoint for generating new ActorPlans.
async function seedPlan(stub: Stub, trigger = false, resourceRefs: string[] = []) {
  return runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals, { profiles, state } = target.authoritativeReplay();
    const root = `root:fixture:plan:${trigger}`, now = state.fictionTimelines[characterTimelineId(state, NPC)!].nowMicros;
    const result = target.rulesRuntime.step(profiles, state, continueCompoundRoot({ kind: "formNpcActorPlan", proposalId: root,
      npcId: NPC, factionRef: null, planId: PLAN, goal: "NPC_PRIVATE_GOAL_CANARY", premiseRefs: [PREMISE],
      nextStep: "在门框系上蓝色布带", resourceRefs,
      activity: { activityId: ACTIVITY, activityKind: "watchDuty", intendedDurationMicros: "2000000" },
      due: trigger ? null : { kind: "fictionTime", atFictionMicros: (BigInt(now) + 2000000n).toString() },
      trigger: trigger ? { kind: "knowledgeAcquired", knowledgeRef: PREMISE } : null,
      trace: { factRef: TRACE, description: DESCRIPTION, visibilityPolicyRef: "visibility:scene-observers" },
      alternateTarget: { targetRef: SCENE, reason: "NPC_PRIVATE_TARGET_REASON_CANARY" },
    }, root));
    expect(result.kind, JSON.stringify(result)).toBe("committed");
    if (result.kind !== "committed") throw new Error("the existing ActorPlan fixture did not commit");
    target.authorityStore.transaction(() => target.appendAuthorityTransition(result.state as AuthoritativeWorldState, result.events));
    return dueActorPlanChildRoot((result.state as AuthoritativeWorldState).campaignRuntime.npcPlans[PLAN])!;
  });
}

function install(target: Internals, c: Capture) {
  target.authorityRecoveryCheckpoint = name => {
    if (name === "afterCauseCommitBeforeDueTail" && c.afterStart !== undefined) {
      const fn = c.afterStart; c.afterStart = undefined; fn(target);
    }
    if (c.crashAt === name) { c.crashAt = undefined; throw new Error(`interrupted:${name}`); }
  };
  target.authorityRoll = () => { c.draws += 1; return 12; };
}
function actorBinding(c: Capture): AuthoritativeModelBinding { return { async run(_model, input) {
    const userMessage = (input.messages as RecordValue[]).find(message => message.role === "user")!;
    const plan = JSON.parse(String(userMessage.content)).actorPlan as RecordValue;
    const root = dueActorPlanChildRoot(plan)!;
    c.actorCalls[root] = (c.actorCalls[root] ?? 0) + 1;
    expect(c.actorCalls[root], "a saved ActorPlan response must never be sampled again").toBe(1);
    c.actorRequests.push(structuredClone(input));
    expect(JSON.stringify(input)).not.toContain(PRIVATE);
    expect(JSON.stringify(input)).not.toContain(PRIVATE_REF);
    if (c.failActor) throw new Error("the ActorPlan provider response was lost after dispatch");
    const name = String(record(record((input.tools as RecordValue[])[0]).function).name);
    return { choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify({ decision: c.decision ?? {
      decision: "execute", planId: plan.planId, mechanicalProposal: { kind: "none" }, targetRef: { kind: "none" },
    } }) } }] } }] };
  } }; }

const timeInput = (id: string): RoomActionInput => ({ kind: "intent", submissionId: id, text: "我等待并留意周围的动静。" });

function requestedCapabilities(value: unknown): string[] {
  const bundle = record(value), terminal = record(bundle.terminal);
  if (bundle.mode !== "terminal") return [...new Set((bundle.proposals as RecordValue[]).map(entry => String(entry.kind)))];
  if (terminal.kind !== "clarification") return [String(terminal.kind)];
  return [...new Set((terminal.choices as RecordValue[]).flatMap(choice => {
    const next = record(choice.continuation);
    return next.kind === "adjudication" ? requestedCapabilities({ mode: "adjudication", proposals: next.proposals }) : [];
  }))];
}

async function run(stub: Stub, input: RoomActionInput, c: Capture, response?: unknown) {
  await runInDurableObject(stub, instance => install(instance as unknown as Internals, c));
  const execute = async (target: Internals) => {
    const scope = createVNextModelCallScope({ roomId: "actor-plan-room-test", limit: c.callLimit, emit() {} });
    const calls: string[] = []; c.httpCalls.push(calls);
    const bind = (stage: string, binding: AuthoritativeModelBinding) => scope.bind({
      async run(model, request, options) { calls.push(stage); return binding.run(model, request, options); },
    });
    const transport = new ActorPlanTransportCapability(bind("actorPlan", actorBinding(c)));
    const authority: RoomAuthorityCapability = { prepare: (context, action) => target.prepare(context, action, transport),
      commit: (context, id, proposal) => target.commit(context, id, proposal, transport),
      observe: (...args) => target.observe!(...args), acknowledge: (...args) => target.acknowledge!(...args),
      resumePlayerRandomness: (context, id) => target.resumePlayerRandomness(context, id, transport),
      beginViewerNarrationRecovery: (...args) => target.beginViewerNarrationRecovery!(...args), publishViewerNarrationRecovery: (...args) => target.publishViewerNarrationRecovery!(...args),
      failViewerNarrationRecovery: (...args) => target.failViewerNarrationRecovery!(...args), deliveryPublicationStatus: (...args) => target.deliveryPublicationStatus!(...args),
      beginDeliveryAudiencePublication: (...args) => target.beginDeliveryAudiencePublication!(...args), failDeliveryAudiencePublication: (...args) => target.failDeliveryAudiencePublication!(...args),
      publishDelivery: (...args) => target.publishDelivery!(...args) };
    const narrationAdapter = { async narrate(request: RecordValue) { c.narration.push(structuredClone(request));
      // Represent the existing two provider stages while exercising their real
      // shared HTTP budget and durable Room publication/recovery boundaries.
      if (c.countNarrationCalls) for (const stage of ["narration", "audit"]) {
        await bind(stage, { async run() { return {}; } }).run("test-narration", { rootActionId: request.rootActionId });
      }
      const claims = record(request.renderableClaims ?? {}).claims as RecordValue[] | undefined;
      return { body: claims?.flatMap(claim => Array.isArray(claim.narrationFacts) ? claim.narrationFacts : typeof claim.description === "string" ? [claim.description] : []).join("\n") || "当前行动已记录。" };
    }, async propose() { throw new Error("the vNext proposal transport owns player proposals"); },
      async decideDueActorPlan() { throw new Error("the durable ActorPlan invocation owns NPC decisions"); } } as unknown as AuthoritativeKpAdapter;
    const kp = createVNextKpAdapter({ narrationAdapter, journal: {
      begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
      complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
    }, proposalBinding: bind("proposal", { async run(_model, request) {
      c.playerRequests.push(structuredClone(request));
      if (response === undefined) throw new Error("a durable player proposal must be reused");
      const name = String(record(record((request.tools as RecordValue[])[0]).function).name);
      return { choices: [{ message: { tool_calls: [{ type: "function", function: { name,
        arguments: JSON.stringify(name === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME
          ? { requestedCapabilities: requestedCapabilities(response) } : encodeVNextStrictToolBundle(response)) } }] } }] };
    } }) });
    return handleRoomAction({ principal: ALICE, authority, kp }, input);
  };
  return execute(stub as unknown as Internals);
}
async function snapshot(stub: Stub, root?: string) { return runInDurableObject(stub, instance => {
  const target = instance as unknown as Internals;
  return { state: structuredClone(target.authoritativeReplay().state), events: structuredClone(target.authorityStore.events()),
    due: structuredClone(target.authorityStore.pendingDueWork()), work: root ? structuredClone(target.authorityStore.dueWorkByRoot(root)) : undefined,
    invocations: root ? [1, 2, 3].map(i => target.authorityStore.vnextInvocation(root, i)).filter(Boolean).map(row => structuredClone(row!)) : [] };
}); }

async function resume(stub: Stub, root: string, c: Capture) {
  const scope = createVNextModelCallScope({ roomId: "actor-plan-room-resume", limit: c.callLimit, emit() {} });
  const transport = new ActorPlanTransportCapability(scope.bind(actorBinding(c)));
  return runInDurableObject(stub, async instance => {
  const target = instance as unknown as Internals;
  install(target, c);
  return target.commitDueActivity(root, transport);
}); }

function knowledgeReview(inquiry: string) { return { mode: "terminal", basisRefs: [], adjudication: null, proposals: [],
  terminal: { kind: "knowledgeReview", inquiry, scope: "allKnown", knowledgeRefs: [] } }; }

function passage(durationMicros: string) { return { mode: "terminal", basisRefs: [], adjudication: null, proposals: [],
  terminal: { kind: "passTime", durationMicros } }; }
function passageActivity(state: AuthoritativeWorldState) {
  return Object.values(state.campaignRuntime.activities).find(activity => record(activity.completion).kind === "timePassage")!;
}
function elapsedEvents(events: EventEnvelope[]) { return events.filter(event => event.eventType === "FictionTimeAdvanced"); }

it("a plain wait uses one selection, one proposal, and deterministic Activity delivery, with exact authority duration and replay", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const stub = await initialize("vnext-passage-plain"), c = capture();
  const before = await snapshot(stub), timeline = characterTimelineId(before.state, ACTOR)!;
  const input = timeInput("submission:passage:plain");
  const result = await run(stub, input, c, passage("17000000"));
  expect(result, JSON.stringify(result)).toMatchObject({ kind: "committed" });
  const after = await snapshot(stub), activity = passageActivity(after.state);
  expect(activity).toMatchObject({ status: "completed", intendedDurationMicros: "17000000",
    endedAtFictionMicros: (BigInt(before.state.fictionTimelines[timeline].nowMicros) + 17000000n).toString() });
  expect(elapsedEvents(after.events).map(event => record(event.payload).durationMicros)).toEqual(["17000000"]);
  const telemetry = timePassageTelemetry(log.mock.calls);
  expect(telemetry).toHaveLength(1);
  expect(telemetry[0]).toMatchObject({ fictionTimeMicros: "17000000", crossedDeadlineCount: 0 });
  expect(c.playerRequests).toHaveLength(2); expect(c.actorRequests).toHaveLength(0); expect(c.draws).toBe(0);
  // The completed wait is narrated once for its live owner; the deterministic Activity display stays.
  expect(c.narration).toHaveLength(1);
  expect(JSON.stringify(c.narration[0])).toContain("等待已结束，实际经过 17 秒");
  expect(c.httpCalls).toEqual([["proposal", "proposal"]]);
  const observed = await stub.observe(ALICE as never);
  expect(JSON.stringify(observed)).toContain('"kind":"timePassage"');
  expect(JSON.stringify(observed)).toContain('"endedAtFictionMicros"');
  await evictDurableObject(stub);
  expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
  expect((await snapshot(stub)).events).toEqual(after.events); expect(c.playerRequests).toHaveLength(2);
  expect(timePassageTelemetry(log.mock.calls)).toEqual(telemetry);
  await runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals, { genesis, state } = target.authoritativeReplay();
    const replayed = target.rulesRuntime.replay(genesis, target.authorityStore.events());
    expect(replayed.kind).toBe("replayed"); if (replayed.kind === "replayed") expect(replayed.state).toEqual(state);
  });
}, 30_000);

it("a one minute wait stops at the NPC deadline, commits its real trace, then completes the remaining time", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const stub = await initialize("vnext-passage-npc"), c = capture(), root = await seedPlan(stub);
  const before = await snapshot(stub), timeline = characterTimelineId(before.state, ACTOR)!;
  const result = await run(stub, timeInput("submission:passage:npc"), c, passage("60000000"));
  expect(result, JSON.stringify(result)).toMatchObject({ kind: "committed" });
  const after = await snapshot(stub, root), activity = passageActivity(after.state);
  expect(activity.status, JSON.stringify(after.due)).toBe("completed");
  expect(BigInt(after.state.fictionTimelines[timeline].nowMicros) - BigInt(before.state.fictionTimelines[timeline].nowMicros)).toBe(60000000n);
  expect(elapsedEvents(after.events).map(event => record(event.payload).durationMicros)).toEqual(["2000000", "58000000"]);
  const telemetry = timePassageTelemetry(log.mock.calls);
  expect(telemetry.map(event => [event.fictionTimeMicros, event.crossedDeadlineCount]))
    .toEqual([["2000000", 1], ["58000000", 0]]);
  expect(new Set(telemetry.map(event => event.rootActionHash)).size).toBe(2);
  expect(JSON.stringify(telemetry)).not.toMatch(/NPC_PRIVATE_|PLAYER_PRIVATE_/);
  for (const secret of [ACTOR, NPC, PLAN, ACTIVITY, PREMISE, "vnext-passage-npc"]) {
    expect(JSON.stringify(telemetry)).not.toContain(secret);
  }
  const traceEvent = after.events.find(event => event.eventType === "CanonicalFactDeclared" && record(record(event.payload).fact).id === TRACE)!;
  expect(traceEvent.fictionInstantMicros).toBe((BigInt(before.state.fictionTimelines[timeline].nowMicros) + 2000000n).toString());
  expect(after.state.canonicalFacts[TRACE].value).toMatchObject({ description: DESCRIPTION });
  expect(c.actorRequests).toHaveLength(1); expect(c.playerRequests).toHaveLength(2); expect(c.draws).toBe(0);
  // The NPC's visible trace and the completed wait are separate roots, narrated in commit order.
  expect(c.narration).toHaveLength(2);
  expect(JSON.stringify(c.narration[0])).toContain(DESCRIPTION);
  expect(JSON.stringify(c.narration[1])).toContain("等待已结束，实际经过 60 秒");
  expect(JSON.stringify(c.narration)).not.toMatch(/NPC_PRIVATE_GOAL_CANARY|NPC_PRIVATE_ORDER_CANARY|NPC_PRIVATE_TARGET_REASON_CANARY/);
  expect(after.due).toEqual([]);
}, 30_000);

it("a failed due NPC decision leaves the wait at that deadline and cannot spend the remaining time", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const stub = await initialize("vnext-passage-npc-lost"), c = capture(), root = await seedPlan(stub);
  c.failActor = true;
  const before = await snapshot(stub), timeline = characterTimelineId(before.state, ACTOR)!;
  const input = timeInput("submission:passage:npc-lost");
  expect(await run(stub, input, c, passage("60000000"))).toMatchObject({ kind: "committed" });
  const failed = await snapshot(stub, root);
  expect(passageActivity(failed.state).status).toBe("active");
  expect(BigInt(failed.state.fictionTimelines[timeline].nowMicros) - BigInt(before.state.fictionTimelines[timeline].nowMicros)).toBe(2000000n);
  const telemetry = timePassageTelemetry(log.mock.calls);
  expect(telemetry).toHaveLength(1);
  expect(telemetry[0]).toMatchObject({ fictionTimeMicros: "2000000", crossedDeadlineCount: 1 });
  expect(failed.state.canonicalFacts[TRACE]).toBeUndefined(); expect(c.narration).toHaveLength(0);
  const observation = await stub.observe(ALICE as never);
  expect(JSON.stringify(observation)).toContain('"processingState":"cannotSafelyContinue"');
  expect(projectAuthoritativeTableObservation({ userId: ALICE.principal.id, members: [ALICE.principal.id], locationLabels: {}, observation }).activities)
    .toEqual(expect.arrayContaining([expect.objectContaining({ kind: "timePassage", status: "active", processingState: "cannotSafelyContinue" })]));
  expect(JSON.stringify(observation)).not.toMatch(/NPC_PRIVATE_|actor-plan:vnext-room|OUTCOME_UNKNOWN/);
  await evictDurableObject(stub);
  expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
  expect((await snapshot(stub, root)).events).toEqual(failed.events);
  expect(c.actorRequests).toHaveLength(1); expect(c.playerRequests).toHaveLength(2);
  expect(timePassageTelemetry(log.mock.calls)).toEqual(telemetry);
}, 30_000);

it("a saved due response resumes after eviction and the original wait finishes without resampling", async () => {
  const stub = await initialize("vnext-passage-response-recovery"), c = capture(), root = await seedPlan(stub);
  c.crashAt = "afterActorPlanResponseSaved";
  const input = timeInput("submission:passage:response-recovery");
  expect(await run(stub, input, c, passage("60000000"))).toMatchObject({ kind: "committed" });
  const saved = await snapshot(stub, root);
  expect(saved.state.canonicalFacts[TRACE]).toBeUndefined();
  expect(passageActivity(saved.state).status).toBe("active");
  await evictDurableObject(stub);
  expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
  const after = await snapshot(stub, root);
  expect(passageActivity(after.state).status, JSON.stringify(after.due)).toBe("completed");
  expect(c.actorRequests).toHaveLength(1); expect(c.playerRequests).toHaveLength(2); expect(c.draws).toBe(0);
  expect(after.events.filter(event => event.eventType === "NpcActionCommitted" && event.rootActionId === root)).toHaveLength(1);
}, 30_000);

it("a knowledge review never starts passage or executes an already due NPC plan", async () => {
  const stub = await initialize("vnext-passage-review"), c = capture(), root = await seedPlan(stub, true);
  const before = await snapshot(stub, root);
  expect(await run(stub, { kind: "intent", submissionId: "submission:passage:review", text: "回顾我已经知道的信息。" }, c,
    knowledgeReview("回顾已知信息"))).toMatchObject({ kind: "committed" });
  const after = await snapshot(stub, root);
  expect(passageActivity(after.state)).toBeUndefined(); expect(c.actorRequests).toHaveLength(0);
  expect(after.state.fictionTimelines).toEqual(before.state.fictionTimelines);
}, 30_000);


it("a death at the current instant settles only the authorized wait and its original former Viewer receives the final Claim", async () => {
  const stub = await initialize("vnext-passage-death", true), c = capture();
  await runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals, { profiles, state } = target.authoritativeReplay();
    const registered = target.rulesRuntime.step(profiles, state, { kind: "registerDynamicDefinition", proposalId: "root:fixture:lethal-definition",
      definition: { definitionId: "ability:fixture:lethal", revision: "1", definitionKind: "environmentHazardMechanics",
        rulesBasis: "srd5.1-2014", effect: { kind: "fixedDamage", amount: 100, damageType: "fire" } } });
    expect(registered.kind, JSON.stringify(registered)).toBe("committed");
    if (registered.kind === "committed") target.authorityStore.transaction(() => target.appendAuthorityTransition(registered.state as AuthoritativeWorldState, registered.events));
  });
  c.afterStart = target => {
    const { profiles, state } = target.authoritativeReplay();
    const damage = target.rulesRuntime.step(profiles, state, { kind: "triggerHazard", proposalId: "root:fixture:lethal-trigger",
      definitionId: "ability:fixture:lethal", triggeringEntityId: ACTOR, zoneId: "zone:fixture:hazard", causeFactIds: [] });
    expect(damage.kind, JSON.stringify(damage)).toBe("committed");
    if (damage.kind === "committed") target.authorityStore.transaction(() => target.appendAuthorityTransition(damage.state as AuthoritativeWorldState, damage.events));
  };
  const result = await run(stub, timeInput("submission:passage:death"), c, passage("60000000"));
  expect(result, JSON.stringify(result)).toMatchObject({ kind: "committed" });
  const after = await snapshot(stub), activity = passageActivity(after.state);
  expect(after.state.entities[ACTOR].tenureStatus).toBe("dead");
  expect(after.state.characterControls[ACTOR]).toBeUndefined();
  expect(activity, JSON.stringify(after.due)).toMatchObject({ status: "interrupted", endedAtFictionMicros: activity.startedAtFictionMicros,
    interruptionCause: { kind: "timePassageInterrupted", reason: "actorUnavailable" } });
  expect(elapsedEvents(after.events)).toEqual([]); expect(after.due).toEqual([]);
  expect(c.narration).toHaveLength(0); expect(c.draws).toBe(0);
  const observation = await stub.observe(ALICE as never);
  expect(JSON.stringify(observation)).toContain('"kind":"timePassage"');
  expect(JSON.stringify(observation)).toContain('"endedAtFictionMicros"');
  expect(projectAuthoritativeTableObservation({ userId: ALICE.principal.id, members: [ALICE.principal.id], locationLabels: {}, observation }).activities)
    .toEqual(expect.arrayContaining([expect.objectContaining({ kind: "timePassage", status: "interrupted", interruptionReason: "actorUnavailable" })]));
  expect(JSON.stringify(await stub.observe(BOB as never))).not.toContain(String(activity.activityId));
  const end = after.events.find(event => event.eventType === "ActivityInterrupted" && record(event.payload).activityId === activity.activityId)!;
  await runInDurableObject(stub, async instance => {
    const target = instance as unknown as Internals, { profiles, state, genesis } = target.authoritativeReplay();
    expect(await target.commitDueActivity("time-passage-interrupt:activity:foreign:0")).toMatchObject({ kind: "rejected", code: "dueActivityUnavailable" });
    expect(await target.commit(ALICE as never, end.rootActionId, { kind: "advanceTimePassage", proposalId: end.rootActionId,
      activityId: activity.activityId })).toMatchObject({ kind: "rejected" });
    const priorEvents = after.events.filter(event => BigInt(event.eventSeq) < BigInt(end.eventSeq));
    const prior = target.rulesRuntime.replay(genesis, priorEvents);
    expect(prior.kind).toBe("replayed"); if (prior.kind !== "replayed") return;
    const seatId = state.entities[ACTOR].lastControllerSeatId!;
    const query = { committedRange: { receiptId: state.receipts[end.rootActionId].receiptId, actorCharacterId: ACTOR,
      priorState: prior.state, events: [end] } };
    const authorized = target.rulesRuntime.project(profiles, state, { kind: "player", purpose: "lifecycle", principalId: ALICE.principal.id,
      sessionVersion: 1, seatId, characterId: ACTOR }, query);
    expect(JSON.stringify(authorized)).toContain("timePassageInterrupted");
    expect(frozenRenderableClaimsConform(record(authorized).renderableClaims)).toBe(true);
    expect(JSON.stringify(record(authorized).renderableClaims)).toContain("等待已中断，实际经过 0 秒，原计划为 60 秒");
    for (const viewer of [
      { kind: "player", purpose: "lifecycle", principalId: BOB.principal.id, sessionVersion: 1, seatId, characterId: ACTOR },
      { kind: "player", purpose: "lifecycle", principalId: ALICE.principal.id, sessionVersion: 2, seatId, characterId: ACTOR },
      { kind: "player", purpose: "lifecycle", principalId: ALICE.principal.id, sessionVersion: 1, seatId, characterId: NPC },
    ]) expect(target.rulesRuntime.project(profiles, state, viewer, query)).toMatchObject({ kind: "rejected", rejection: { code: "viewerUnauthorized" } });
  });
}, 30_000);


it("a seven-call budget completes the wait, the NPC narration and the wait narration with no recovery", async () => {
  const stub = await initialize("vnext-passage-budget-seven"), c = capture(), root = await seedPlan(stub);
  c.callLimit = "7"; c.countNarrationCalls = true;
  const input = timeInput("submission:passage:budget-seven");
  const result = await run(stub, input, c, passage("60000000"));
  expect(result, JSON.stringify(result)).toMatchObject({ kind: "committed", action: "committed" });
  expect(record(result).deliveryPending).not.toBe(true);
  // The visible NPC action and the completed wait are separate committed roots; each narrates once.
  expect(c.httpCalls).toEqual([["proposal", "proposal", "actorPlan", "narration", "audit", "narration", "audit"]]);
  const committed = await snapshot(stub, root);
  expect(passageActivity(committed.state).status).toBe("completed"); expect(committed.due).toEqual([]);
  const observation = record(await stub.observe(ALICE as never));
  expect(observation.narrationRecovery).toBeUndefined();
  expect(projectAuthoritativeTableObservation({ userId: ALICE.principal.id, members: [ALICE.principal.id], locationLabels: {}, observation }).activities)
    .toEqual(expect.arrayContaining([expect.objectContaining({ kind: "timePassage", status: "completed", intendedDurationMicros: "60000000" })]));
  await evictDurableObject(stub);
  expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
  expect((await snapshot(stub, root)).events).toEqual(committed.events);
  expect(c.actorRequests).toHaveLength(1); expect(c.playerRequests).toHaveLength(2); expect(c.draws).toBe(0);
}, 30_000);


it("starting a personal wait preserves the real party departure and leader change Claims", async () => {
  const stub = await initialize("vnext-passage-party", true, true), c = capture();
  await runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals;
    let { profiles, state } = target.authoritativeReplay();
    const invite = target.rulesRuntime.step(profiles, state, { kind: "invitePartyMember", rootActionId: "root:fixture:party-invite",
      inviterCharacterId: ACTOR, invitedCharacterId: NPC });
    expect(invite.kind, JSON.stringify(invite)).toBe("awaitingInput"); if (invite.kind !== "awaitingInput") return;
    target.authorityStore.transaction(() => target.appendAuthorityTransition(invite.state as AuthoritativeWorldState, invite.events));
    state = target.authoritativeReplay().state;
    const joined = target.rulesRuntime.step(profiles, state, { kind: "answerPartyInvitation", rootActionId: "root:fixture:party-invite",
      pendingInputId: invite.pending.pendingInputId, controllerCharacterId: NPC, accept: true });
    expect(joined.kind, JSON.stringify(joined)).toBe("committed");
    if (joined.kind === "committed") target.authorityStore.transaction(() => target.appendAuthorityTransition(joined.state as AuthoritativeWorldState, joined.events));
  });
  const result = await run(stub, timeInput("submission:passage:party"), c, passage("1000000"));
  expect(result, JSON.stringify(result)).toMatchObject({ kind: "committed" });
  const after = await snapshot(stub);
  expect(passageActivity(after.state).status).toBe("completed");
  expect(after.events.some(event => event.eventType === "PartyMemberLeft" && record(event.payload).characterId === ACTOR)).toBe(true);
  expect(after.events.some(event => event.eventType === "PartyLeaderTransferred" && record(event.payload).toCharacterId === NPC)).toBe(true);
  expect(JSON.stringify(c.narration)).toContain("PartyMemberLeft"); expect(JSON.stringify(c.narration)).toContain("PartyLeaderTransferred");
  expect(JSON.stringify(c.narration)).not.toContain("本次行动推进了");
}, 30_000);


it("the private due capability rejects a changed root or Activity before any time is spent", async () => {
  const stub = await initialize("vnext-passage-private-due"), c = capture();
  c.crashAt = "afterCauseCommitBeforeDueTail";
  const input = timeInput("submission:passage:private-due");
  await run(stub, input, c, passage("19000000")).catch(() => undefined);
  const pending = await snapshot(stub), activity = passageActivity(pending.state);
  expect(activity.status).toBe("active"); expect(elapsedEvents(pending.events)).toEqual([]);
  const root = String(pending.due.find(row => row.activity_id === activity.activityId)!.child_root_action_id);
  c.crashAt = "afterDueSubmissionBeforeCommit";
  await expect(resume(stub, root, c)).rejects.toThrow("afterDueSubmissionBeforeCommit");
  await runInDurableObject(stub, async instance => {
    const target = instance as unknown as Internals & { commitAuthoritative(context: unknown, id: string, source: unknown): Promise<unknown> };
    const original = { kind: "advanceTimePassage", proposalId: root, activityId: activity.activityId };
    const foreign = { ...original, activityId: "activity:foreign" };
    expect(await target.commitAuthoritative({ kind: "internalDueActivity", rootActionId: "root:foreign" }, root,
      { kind: "canonicalInput", input: original, proposalHash: canonicalHash(original) })).toMatchObject({ kind: "rejected" });
    expect(await target.commitAuthoritative({ kind: "internalDueActivity", rootActionId: root }, root,
      { kind: "canonicalInput", input: foreign, proposalHash: canonicalHash(foreign) })).toMatchObject({ kind: "retryableFailure", code: "proposalRecoveryIntegrityMismatch" });
    expect(await target.commit(ALICE as never, root, original)).toMatchObject({ kind: "rejected", code: "preparedActionUnauthorized" });
  });
  expect((await snapshot(stub)).events).toEqual(pending.events);
  expect(await resume(stub, root, c)).toMatchObject({ kind: "committed" });
  expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
  expect(passageActivity((await snapshot(stub)).state).status).toBe("completed");
  expect(c.playerRequests).toHaveLength(2); expect(c.draws).toBe(0);
}, 30_000);

function investigation() { return { mode: "adjudication", basisRefs: [SOURCE], terminal: null,
  adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "逐项查验需要时间。", successOutcome: "完成检查。" },
  proposals: [{ kind: "worldInteraction", basisRefs: [SOURCE], consumes: [], produces: [], outcomeBinding: "always",
    sceneRef: SCENE, targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: null,
    intent: "检查固定外壳", method: "逐项查看表面", branches: { success: { outcomeCode: "outcome:inspected", summary: "完整检查已经完成。",
      effects: [], sensoryEvidence: [], pressures: [], opportunities: [] }, failure: null } }],
}; }
async function seedMessage(stub: Stub) {
  await runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals, current = target.authoritativeReplay();
    const sent = target.rulesRuntime.step(current.profiles, current.state, { kind: "shareKnowledge", proposalId: "root:fixture:message",
      senderCharacterId: NPC, recipientEntityIds: [ACTOR], knowledgeRefs: [PREMISE], medium: "当面告知", contentLayer: current.state.knowledge[NPC][PREMISE].layer });
    expect(sent.kind, JSON.stringify(sent)).toBe("committed");
    if (sent.kind !== "committed") throw new Error("fixture communication failed");
    target.authorityStore.transaction(() => target.appendAuthorityTransition(sent.state, sent.events));
  });
}
function activityInput(family: string, suffix: string): RoomActionInput {
  return family === "rest" ? { kind: "restStart", submissionId: `submission:activity:${suffix}`, restKind: "long", mode: "personal", hitDiceToSpend: 0, arcaneRecoverySlotLevels: [] }
    : { kind: "intent", submissionId: `submission:activity:${suffix}`, text: "我花些时间逐项检查固定外壳。" };
}

it("noncombat activity: rest and a real proposal complete through the Room interface without wait input", async () => {
  for (const family of ["rest", "investigation"]) {
    const stub = await initialize(`vnext-activity-normal-${family}`), c = capture();
    const input = activityInput(family, `normal-${family}`), before = await snapshot(stub);
    const result = await run(stub, input, c, family === "rest" ? undefined : investigation());
    expect(result, JSON.stringify(result)).toMatchObject({ kind: "committed" });
    const after = await snapshot(stub), activity = Object.values(after.state.campaignRuntime.activities).find(a => a.characterId === ACTOR)!;
    expect(activity, JSON.stringify(after.due)).toMatchObject({ status: "completed" });
    expect(after.events.filter(e => e.eventType === "ActivityCompleted" && record(e.payload).activityId === activity.activityId)).toHaveLength(1);
    expect(after.events.filter(e => e.eventType === (family === "rest" ? "RestCompleted" : "WorldInteractionResolved"))).toHaveLength(1);
    expect(after.state.fictionTimelines[characterTimelineId(after.state, ACTOR)!].nowMicros).toBe((BigInt(before.state.fictionTimelines[characterTimelineId(before.state, ACTOR)!].nowMicros) + BigInt(family === "rest" ? "28800000000" : "300000000")).toString());
    const saved = structuredClone(after.events);
    await evictDurableObject(stub);
    expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
    expect((await snapshot(stub)).events).toEqual(saved);
  }
}, 30_000);

it("noncombat activity: a committed message pauses rest and investigation, survives eviction and consumes one authorized continuation", async () => {
  for (const family of ["rest", "investigation"]) {
    const stub = await initialize(`vnext-activity-notice-${family}`), c = capture();
    const actorRoot = await seedPlan(stub), input = activityInput(family, `notice-${family}`);
    c.crashAt = "afterCauseCommitBeforeDueTail";
    await run(stub, input, c, family === "rest" ? undefined : investigation());
    const started = await snapshot(stub), activity = Object.values(started.state.campaignRuntime.activities).find(a => a.characterId === ACTOR)!;
    expect(activity).toMatchObject({ status: "active" });
    const first = started.due.find(d => String(d.child_root_action_id).startsWith("activity-advance:"))!;
    expect(first).toBeDefined();
    await runInDurableObject(stub, async instance => {
      const target = instance as unknown as Internals; install(target, c);
      expect(await target.commitDueActivity(String(first.child_root_action_id))).toMatchObject({ kind: "committed" });
    });
    expect(await resume(stub, actorRoot, c)).toMatchObject({ kind: "committed" });
    // Fixture world communication at the reached deadline: the existing Rules
    // sharing operation grants only the sender's real held knowledge. This is
    // not a claim that the NPC provider autonomously chose a delivery action.
    await seedMessage(stub);
    expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
    const paused = await snapshot(stub), own = paused.state.campaignRuntime.activities[String(activity.activityId)];
    expect(own).toMatchObject({ status: "active", attention: { atFictionMicros: "2000000" } });
    expect(paused.events.some(e => e.eventType === (family === "rest" ? "RestCompleted" : "WorldInteractionResolved"))).toBe(false);
    const control: RoomActionInput = { kind: "activityControl", submissionId: `submission:activity:continue:${family}`,
      activityId: String(own.activityId), attentionRootActionId: String(record(own.attention).rootActionId), decision: "continue" };
    await evictDurableObject(stub);
    expect(await stub.prepare(BOB as never, control as never)).toMatchObject({ kind: "rejected" });
    const observed = record(await stub.observe(ALICE as never)), projected = record(observed.readModel);
    expect((projected.activities as RecordValue[]).find(a => a.activityId === own.activityId)).toMatchObject({ attention: { rootActionId: control.attentionRootActionId } });
    const table = projectAuthoritativeTableObservation({ userId: ALICE.principal.id, members: [ALICE.principal.id], locationLabels: {}, observation: observed as never });
    expect(table.activities.find(a => a.activityId === own.activityId)).toMatchObject({ attention: { rootActionId: control.attentionRootActionId } });
    expect(JSON.stringify(table.activities)).not.toMatch(/completionReadSet|timelineAtStart|completionInput/);
    expect(await run(stub, control, c)).toMatchObject({ kind: "committed" });
    const completed = await snapshot(stub);
    expect(completed.state.campaignRuntime.activities[String(own.activityId)].status, JSON.stringify(completed.due)).toBe("completed");
    const beforeDuplicate = completed.events;
    expect(await run(stub, control, c)).toMatchObject({ kind: "committed" });
    expect((await snapshot(stub)).events).toEqual(beforeDuplicate);
    expect(Object.values(c.actorCalls)).toEqual([1]);
  }
}, 30_000);

it("noncombat activity: a notice at the exact completion boundary preserves and resumes the queued completion", async () => {
  for (const family of ["rest", "investigation"]) {
    const stub = await initialize(`vnext-activity-end-notice-${family}`), c = capture();
    const input = activityInput(family, `end-notice-${family}`);
    c.crashAt = "afterCauseCommitBeforeDueTail";
    await run(stub, input, c, family === "rest" ? undefined : investigation());
    const started = await snapshot(stub), activity = Object.values(started.state.campaignRuntime.activities).find(a => a.characterId === ACTOR)!;
    await resume(stub, String(started.due[0].child_root_action_id), c);
    const atEnd = await snapshot(stub), completionRoot = String(atEnd.due[0].child_root_action_id);
    expect(atEnd.state.campaignRuntime.activities[String(activity.activityId)].status).toBe("active");
    await seedMessage(stub);
    await run(stub, input, c);
    const paused = await snapshot(stub, completionRoot), own = paused.state.campaignRuntime.activities[String(activity.activityId)];
    expect(own.attention).toBeDefined();
    expect(paused.work).toMatchObject({ status: "pending", next_attempt_at: null });
    expect(paused.events.some(e => e.eventType === (family === "rest" ? "RestCompleted" : "WorldInteractionResolved"))).toBe(false);
    await evictDurableObject(stub);
    const control: RoomActionInput = { kind: "activityControl", submissionId: `submission:end-notice:continue:${family}`,
      activityId: String(own.activityId), attentionRootActionId: String(record(own.attention).rootActionId), decision: "continue" };
    expect(await run(stub, control, c)).toMatchObject({ kind: "committed" });
    const done = await snapshot(stub, completionRoot);
    expect(done.work, JSON.stringify(done.due)).toMatchObject({ status: "committed" });
    expect(done.state.campaignRuntime.activities[String(own.activityId)].status).toBe("completed");
    expect(elapsedEvents(done.events)).toEqual(elapsedEvents(paused.events));
    await run(stub, control, c);
    expect((await snapshot(stub)).events).toEqual(done.events);
  }
}, 30_000);

it("noncombat activity: timed checks and frozen choices recover either dice checkpoint without rerolling or premature effects", async () => {
  for (const clarification of [false, true]) for (const checkpoint of ["afterRandomnessRequestCommit", "afterRandomnessCandidateCommit"]) {
    const suffix = `${clarification}-${checkpoint}`, stub = await initialize(`vnext-activity-dice-${suffix}`), c = capture();
    const draft = investigation() as RecordValue, proposal = (draft.proposals as RecordValue[])[0];
    draft.adjudication = { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "wis", skill: "perception",
      dc: 10, mode: "normal", risk: "可能漏掉关键信息。", successOutcome: "检查完成。", failureOutcome: "没有发现线索。" };
    record(proposal.branches).failure = { outcomeCode: "outcome:missed", summary: "检查没有找到线索。", effects: [], sensoryEvidence: [], pressures: [], opportunities: [] };
    const response = clarification ? { mode: "terminal", basisRefs: [SOURCE], adjudication: null, proposals: [],
      terminal: { kind: "clarification", intent: "确认是否花时间检查。", method: "逐项检查。", question: "是否开始检查？",
        choices: [{ choiceId: "inspect", label: "开始检查", publicRisk: "检查可能没有收获。", basisRefs: [SOURCE], continuation: {
          kind: "adjudication", basisRefs: draft.basisRefs, adjudication: draft.adjudication, proposals: draft.proposals,
        } }, { choiceId: "cancel", label: "取消", publicRisk: "不花时间检查。", basisRefs: [], continuation: { kind: "cancel" } }] } } : draft;
    let input = activityInput("investigation", `dice-${suffix}`);
    if (clarification) {
      const opened = await run(stub, input, c, response);
      expect(opened, JSON.stringify(opened)).toMatchObject({ kind: "awaitingInput" });
      const waiting = await snapshot(stub), pendingInputId = Object.keys(waiting.state.frozenPlayerChoices ?? {})[0];
      expect(Object.values(waiting.state.campaignRuntime.activities)).toHaveLength(0);
      input = { kind: "answer", submissionId: `submission:activity:choice:${suffix}`, pendingInputId, answer: { choiceId: "inspect" } };
    }
    c.crashAt = checkpoint;
    await run(stub, input, c, clarification ? undefined : response);
    const saved = await snapshot(stub), activity = Object.values(saved.state.campaignRuntime.activities).find(a => a.characterId === ACTOR)!;
    expect(activity).toMatchObject({ status: "active" });
    const completionRoot = String(record(record(activity.completion).plan).rootActionId);
    expect(saved.state.receipts[completionRoot]?.status, JSON.stringify(saved.due)).toBe("awaitingRandomness");
    expect(saved.events.some(e => e.eventType === "WorldInteractionResolved" || e.eventType === "ActivityCompleted")).toBe(false);
    expect(Object.keys(saved.state.frozenPlayerChoices ?? {})).toHaveLength(0);
    expect(c.draws).toBe(checkpoint === "afterRandomnessRequestCommit" ? 0 : 1);
    await evictDurableObject(stub);
    expect(await resume(stub, completionRoot, c)).toMatchObject({ kind: "committed" });
    expect(c.draws).toBe(1);
    const done = await snapshot(stub, completionRoot);
    expect(done.work).toMatchObject({ status: "committed" });
    expect(done.state.campaignRuntime.activities[String(activity.activityId)].status).toBe("completed");
    expect(done.events.filter(e => e.eventType === "WorldInteractionResolved")).toHaveLength(1);
    expect(done.events.filter(e => e.eventType === "ActivityCompleted")).toHaveLength(1);
    await run(stub, input, c);
    expect((await snapshot(stub)).events).toEqual(done.events);
    expect(c.draws).toBe(1); expect(c.playerRequests).toHaveLength(2);
    await runInDurableObject(stub, instance => {
      const target = instance as unknown as Internals, current = target.authoritativeReplay();
      const replayed = target.rulesRuntime.replay(current.genesis, target.authorityStore.events());
      expect(replayed.kind, JSON.stringify(replayed)).toBe("replayed");
      if (replayed.kind === "replayed") expect(replayed.state).toEqual(current.state);
    });
  }
}, 30_000);
