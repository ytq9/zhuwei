import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { handleRoomAction, handleViewerNarrationRecovery, type RoomActionInput, type RoomAuthorityCapability } from "../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../app/_runtime/lib/kp/vnext/adapter";
import type { AuthoritativeKpAdapter, AuthoritativeModelBinding } from "../app/_runtime/lib/kp/authoritative-types";
import type { VNextInvocationRequest, VNextInvocationStart, VNextInvocationCompletion } from "../app/_runtime/lib/room/vnext-proposal-invocation";
import { encodeVNextStrictToolBundle } from "../app/_runtime/lib/kp/vnext/proposal-schema";
import { createDefinitionSnapshot, storedSemanticDefinition } from "../app/_runtime/lib/rules/v2/semantic-definitions";
import { dueActorPlanChildRoot } from "../app/_runtime/lib/rules/v2/actor-plans";
import { continueCompoundRoot } from "../app/_runtime/lib/rules/v2/internal-compound";
import { characterTimelineId } from "../app/_runtime/lib/rules/v2/timeline";
import { frozenRenderableClaimsConform } from "../app/_runtime/lib/rules/v2/claims";
import { createVNextModelCallScope } from "../app/_runtime/lib/kp/vnext/model-call-scope";
import { ActorPlanTransportCapability } from "../app/_runtime/lib/room/actor-plan-transport";
import type { ActorPlanTransport } from "../app/_runtime/lib/room/actor-plan-transport-types";
import type { AuthoritativeWorldState, EventEnvelope, RuntimeGenesis, RuntimeProfileManifest, step as rulesStep, replay as rulesReplay } from "../app/_runtime/lib/rules";

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
  rulesRuntime: { step: typeof rulesStep; replay: typeof rulesReplay };
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
  callLimit?: string; countNarrationCalls?: boolean; httpCalls: string[][] };
const capture = (): Capture => ({ playerRequests: [], actorRequests: [], narration: [], actorCalls: {}, draws: 0, httpCalls: [] });
function record(value: unknown): RecordValue { return value as RecordValue; }
afterEach(() => vi.restoreAllMocks());
function actorPlanTelemetry(calls: unknown[][]): RecordValue[] {
  return calls.flatMap(([line]) => {
    try {
      const event = JSON.parse(String(line));
      return event.eventName === "room.model.invocation.completed" && event.modelInvocationPurpose === "actorPlan" ? [event] : [];
    } catch { return []; }
  });
}

async function initialize(name: string, mechanicalNpc = false): Promise<Stub> {
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
  if (mechanicalNpc) await runInDurableObject(stub, instance => {
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
    return { usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
      choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify({ decision: c.decision ?? {
      decision: "execute", planId: plan.planId, mechanicalProposal: { kind: "none" }, targetRef: { kind: "none" },
    } }) } }] } }] };
  } }; }

const timeInput = (id: string): RoomActionInput => ({ kind: "intent", submissionId: id, text: "我花一分钟尝试徒手拆开固定外壳。" });
function timedAttempt() { return { mode: "terminal", basisRefs: [SOURCE], adjudication: null, proposals: [], terminal: {
  kind: "inWorldRefusal", intent: "花一分钟尝试拆开固定外壳。", method: "检查固定件并尝试徒手拆卸。",
  ruling: { kind: "missingPrerequisite", publicBasis: "一分钟尝试后确认需要合适的工具。",
    prerequisites: [{ kind: "tool", ref: "none", description: "拆卸固定件的工具" }], nextActions: [{ description: "准备工具", basisRefs: [SOURCE] }],
    attemptCosts: [{ kind: "fictionTime", durationMicros: "60000000" }] } } }; }

async function run(stub: Stub, input: RoomActionInput, c: Capture, response?: unknown, recoveryCapability?: string) {
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
        arguments: JSON.stringify(encodeVNextStrictToolBundle(response)) } }] } }] };
    } }) });
    return recoveryCapability === undefined
      ? handleRoomAction({ principal: ALICE, authority, kp }, input)
      : handleViewerNarrationRecovery({ principal: ALICE, authority, kp }, recoveryCapability);
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

it("ActorPlan telemetry records one physical invocation with usage and no NPC content, including after recovery", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const stub = await initialize("vnext-actor-plan-telemetry-success"), c = capture(), root = await seedPlan(stub, true);
  c.crashAt = "afterActorPlanResponseSaved";
  await expect(resume(stub, root, c)).rejects.toThrow("interrupted:afterActorPlanResponseSaved");
  const saved = await snapshot(stub, root);
  expect(c.actorRequests).toHaveLength(1);
  expect(saved.invocations[0].status).toBe("completed");
  const telemetry = actorPlanTelemetry(log.mock.calls);
  expect(telemetry).toHaveLength(1);
  expect(telemetry[0]).toMatchObject({ modelResult: "success", modelTask: "proposal", modelAttempt: 1,
    modelInputTokens: 123, modelOutputTokens: 45, modelTotalTokens: 168 });
  expect(telemetry[0].rootActionHash).toBeTruthy();
  expect(JSON.stringify(telemetry)).not.toMatch(/NPC_PRIVATE_|PLAYER_PRIVATE_|tool_calls|prompt_tokens/);
  for (const secret of [root, PLAN, NPC, PREMISE, PRIVATE_REF, "vnext-actor-plan-telemetry-success"]) {
    expect(JSON.stringify(telemetry)).not.toContain(secret);
  }
  await evictDurableObject(stub);
  expect(await resume(stub, root, c)).toMatchObject({ kind: "committed" });
  expect(c.actorRequests).toHaveLength(1);
  expect(actorPlanTelemetry(log.mock.calls)).toEqual(telemetry);
  expect((await snapshot(stub, root)).state.campaignRuntime.npcPlans[PLAN].status).toBe("resolved");
});

it("ActorPlan telemetry reports an unknown dispatched outcome once without inventing usage or resampling", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const stub = await initialize("vnext-actor-plan-telemetry-failure"), c = capture(), root = await seedPlan(stub, true);
  c.failActor = true;
  expect(await resume(stub, root, c)).toMatchObject({ kind: "rejected", code: "ACTOR_PLAN_DECISION_OUTCOME_UNKNOWN" });
  expect(c.actorRequests).toHaveLength(1);
  const telemetry = actorPlanTelemetry(log.mock.calls);
  expect(telemetry).toHaveLength(1);
  expect(telemetry[0]).toMatchObject({ modelResult: "modelTransient", modelAttempt: 1 });
  expect(telemetry[0].modelInputTokens).toBeUndefined();
  expect(telemetry[0].modelOutputTokens).toBeUndefined();
  const before = await snapshot(stub, root);
  await evictDurableObject(stub);
  expect(await resume(stub, root, c)).toMatchObject({ kind: "rejected", code: "ACTOR_PLAN_DECISION_OUTCOME_UNKNOWN" });
  expect(c.actorRequests).toHaveLength(1);
  expect(actorPlanTelemetry(log.mock.calls)).toEqual(telemetry);
  expect((await snapshot(stub, root)).events).toEqual(before.events);
});

it("ActorPlan telemetry excludes a shared-budget refusal and records the later actual dispatch", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const stub = await initialize("vnext-actor-plan-telemetry-budget"), c = capture(), root = await seedPlan(stub, true);
  const scope = createVNextModelCallScope({ roomId: "vnext-actor-plan-telemetry-budget", limit: "1", emit() {} });
  await scope.bind({ async run() { return {}; } }).run("test", {});
  const transport = new ActorPlanTransportCapability(scope.bind(actorBinding(c)));
  const blocked = await runInDurableObject(stub, instance => (instance as unknown as Internals).commitDueActivity(root, transport));
  expect(blocked).toMatchObject({ kind: "retryableFailure", code: "ACTOR_PLAN_DECISION_CALL_BUDGET_EXHAUSTED" });
  expect(c.actorRequests).toHaveLength(0);
  expect(actorPlanTelemetry(log.mock.calls)).toEqual([]);
  expect((await snapshot(stub, root)).invocations[0].status).toBe("prepared");
  await evictDurableObject(stub);
  expect(await resume(stub, root, c)).toMatchObject({ kind: "committed" });
  expect(c.actorRequests).toHaveLength(1);
  expect(actorPlanTelemetry(log.mock.calls)).toHaveLength(1);
});

it("a real time commit executes one existing NPC plan through the durable queue and freezes only its observable trace", async () => {
  const stub = await initialize("vnext-actor-plan-time-room"), c = capture(), root = await seedPlan(stub);
  const before = await snapshot(stub, root);
  expect(before.due).toEqual([]);
  const input = timeInput("submission:vnext-plan:time");
  expect(await run(stub, input, c, timedAttempt())).toMatchObject({ kind: "committed" });
  const after = await snapshot(stub, root);
  expect(after.state.campaignRuntime.npcPlans[PLAN].status, JSON.stringify(after.work)).toBe("resolved");
  expect(after.state.campaignRuntime.activities[ACTIVITY].status).toBe("completed");
  expect(after.state.canonicalFacts[TRACE].value).toMatchObject({ description: DESCRIPTION });
  expect(after.events.filter(e => e.eventType === "NpcActionCommitted" && e.rootActionId === root)).toHaveLength(1);
  expect(after.events.filter(e => e.eventType === "CanonicalFactDeclared" && record(record(e.payload).fact).id === TRACE)).toHaveLength(1);
  expect(after.due).toEqual([]); expect(c.actorRequests).toHaveLength(1); expect(c.playerRequests).toHaveLength(1); expect(c.draws).toBe(0);
  expect(after.invocations).toHaveLength(1); expect(after.invocations[0]).toMatchObject({ ordinal: 1, status: "completed", lease_until: 0 });
  await runInDurableObject(stub, (_instance, context) => {
    expect(context.storage.sql.exec<{ principal_id: string | null; prepared_action_id: string }>(
      "SELECT principal_id, prepared_action_id FROM authority_submissions WHERE root_action_id = ?", root).one())
      .toEqual({ principal_id: null, prepared_action_id: root });
  });
  const observation = await stub.observe(ALICE as never);
  expect(JSON.stringify(observation)).toContain(DESCRIPTION);
  expect(JSON.stringify(observation)).not.toMatch(/NPC_PRIVATE_GOAL_CANARY|NPC_PRIVATE_ORDER_CANARY|NPC_PRIVATE_TARGET_REASON_CANARY/);
  await evictDurableObject(stub);
  expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
  expect((await snapshot(stub, root)).events).toEqual(after.events); expect(c.actorRequests).toHaveLength(1); expect(c.playerRequests).toHaveLength(1);
  await runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals, { genesis, state } = target.authoritativeReplay();
    const replayed = target.rulesRuntime.replay(genesis, target.authorityStore.events());
    expect(replayed.kind).toBe("replayed"); if (replayed.kind === "replayed") expect(replayed.state).toEqual(state);
  });
}, 30_000);

it("a held-knowledge trigger can defer privately and a later revision executes under a new durable root", async () => {
  const stub = await initialize("vnext-actor-plan-trigger-room"), c = capture(), root = await seedPlan(stub, true);
  const queued = await snapshot(stub, root);
  expect(queued.due).toHaveLength(1);
  c.decision = { decision: "defer", planId: PLAN, mechanicalProposal: { kind: "none" },
    reason: "NPC_PRIVATE_DEFER_REASON_CANARY", deferUntilFictionMicros: "10000000" };
  const outcome = await resume(stub, root, c);
  expect(outcome, JSON.stringify(outcome)).toMatchObject({ kind: "committed" });
  const deferred = await snapshot(stub, root);
  expect(deferred.state.campaignRuntime.npcPlans[PLAN]).toMatchObject({ revision: "2", status: "scheduled",
    due: { kind: "fictionTime", atFictionMicros: "10000000" }, trigger: null });
  expect(deferred.state.canonicalFacts[TRACE]).toBeUndefined();
  expect(deferred.events.filter(e => e.eventType === "NpcPlanRevised" && e.rootActionId === root)).toHaveLength(1);
  expect(record(record(outcome).deliveryPlan).audiences).toEqual([]);
  expect(deferred.due).toEqual([]); expect(c.actorRequests).toHaveLength(1);
  expect(JSON.stringify(await stub.observe(ALICE as never))).not.toContain("NPC_PRIVATE_DEFER_REASON_CANARY");
  const nextRoot = dueActorPlanChildRoot(deferred.state.campaignRuntime.npcPlans[PLAN])!;
  expect(nextRoot).not.toBe(root);
  await evictDurableObject(stub);
  c.decision = undefined;
  expect(await run(stub, timeInput("submission:vnext-plan:after-defer"), c, timedAttempt())).toMatchObject({ kind: "committed" });
  const completed = await snapshot(stub, nextRoot);
  expect(completed.state.campaignRuntime.npcPlans[PLAN].status, JSON.stringify(completed.work)).toBe("resolved");
  expect(completed.invocations).toHaveLength(1); expect(c.actorCalls).toEqual({ [root]: 1, [nextRoot]: 1 });
  expect(completed.events.filter(e => e.eventType === "CanonicalFactDeclared" && record(record(e.payload).fact).id === TRACE)).toHaveLength(1);
}, 30_000);

it("knowledge review leaves a due plan untouched and eviction reuses its saved NPC response", async () => {
  const stub = await initialize("vnext-actor-plan-response-recovery"), c = capture(), root = await seedPlan(stub);
  c.crashAt = "afterActorPlanResponseSaved";
  const input = timeInput("submission:vnext-plan:response-recovery-time");
  expect(await run(stub, input, c, timedAttempt())).toMatchObject({ kind: "committed" });
  const saved = await snapshot(stub, root);
  expect(saved.state.campaignRuntime.npcPlans[PLAN].status).toBe("scheduled"); expect(saved.state.canonicalFacts[TRACE]).toBeUndefined();
  expect(saved.invocations).toHaveLength(1); expect(saved.invocations[0]).toMatchObject({ status: "completed" });
  expect(saved.invocations[0].response_json).not.toBeNull(); expect(c.actorRequests).toHaveLength(1);
  const inquiry: RoomActionInput = { kind: "intent", submissionId: "submission:vnext-plan:knowledge-review", text: "我目前知道哪些事情？" };
  expect(await run(stub, inquiry, c, knowledgeReview(inquiry.text))).toMatchObject({ kind: "committed" });
  const reviewed = await snapshot(stub, root);
  expect(reviewed.events.slice(saved.events.length).map(e => e.eventType)).toEqual(["KnowledgeReviewed"]);
  expect(reviewed.state.campaignRuntime).toEqual(saved.state.campaignRuntime);
  expect(reviewed.state.fictionTimelines).toEqual(saved.state.fictionTimelines);
  expect(reviewed.due).toEqual(saved.due); expect(reviewed.invocations).toEqual(saved.invocations); expect(c.actorRequests).toHaveLength(1);
  await evictDurableObject(stub);
  const resumed = await resume(stub, root, c);
  expect(resumed, JSON.stringify(resumed)).toMatchObject({ kind: "committed" });
  const settled = await snapshot(stub, root);
  expect(settled.invocations).toEqual(saved.invocations); expect(c.actorRequests).toHaveLength(1); expect(c.draws).toBe(0);
  expect(settled.state.campaignRuntime.activities[ACTIVITY].status).toBe("completed");
  expect(settled.events.filter(e => e.eventType === "CanonicalFactDeclared" && record(record(e.payload).fact).id === TRACE)).toHaveLength(1);
  expect(JSON.stringify(record(resumed).deliveryPlan)).toContain(DESCRIPTION);
  expect(JSON.stringify(record(resumed).deliveryPlan)).not.toMatch(/NPC_PRIVATE_GOAL_CANARY|NPC_PRIVATE_ORDER_CANARY|NPC_PRIVATE_TARGET_REASON_CANARY/);
  const audiences = record(record(resumed).deliveryPlan).audiences as RecordValue[];
  expect(audiences).toHaveLength(1); expect(audiences[0].narrationInputMode).toBe("frozenRenderableClaims-vnext-1");
  const claims = record(audiences[0].kpProjection).renderableClaims;
  expect(frozenRenderableClaimsConform(claims)).toBe(true);
  expect(record(claims).rootActionId).toBe(root);
  expect((record(claims).claims as RecordValue[]).map(claim => ({ kind: claim.kind, description: claim.description })))
    .toEqual([{ kind: "sceneFeature", description: DESCRIPTION }]);
  await evictDurableObject(stub);
  expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
  expect((await snapshot(stub, root)).events).toEqual(settled.events); expect(c.actorRequests).toHaveLength(1);
}, 30_000);

for (const checkpoint of ["afterRandomnessRequestCommit", "afterRandomnessCandidateCommit"]) {
  it(`an NPC check recovers ${checkpoint} without repeating its response, draw or resource cost`, async () => {
    const stub = await initialize(`vnext-actor-plan-${checkpoint}`, true), c = capture(), root = await seedPlan(stub, false, ["hitDice"]);
    const before = await snapshot(stub, root), resourceBefore = before.state.entities[NPC].resources!.hitDice;
    expect(resourceBefore).toBeGreaterThan(0);
    c.crashAt = checkpoint;
    c.decision = { decision: "execute", planId: PLAN, targetRef: { kind: "none" }, mechanicalProposal: {
      operation: "resolveNoncombatCheck", ability: "wis", skill: "perception", dc: 12, mode: "normal",
      duration: { unit: "second", value: 1 }, frozenCosts: [{ kind: "consumeResource", resourceRef: "hitDice", amount: 1 }], success: [], failure: [],
    } };
    expect(await run(stub, timeInput(`submission:vnext-plan:${checkpoint}`), c, timedAttempt())).toMatchObject({ kind: "committed" });
    const paused = await snapshot(stub, root);
    expect(paused.due, JSON.stringify(paused.work)).toHaveLength(1);
    expect(c.actorRequests).toHaveLength(1); expect(paused.invocations).toHaveLength(1);
    expect(paused.invocations[0].status).toBe("completed");
    expect(c.draws).toBe(checkpoint === "afterRandomnessRequestCommit" ? 0 : 1);
    await evictDurableObject(stub);
    const result = await resume(stub, root, c);
    expect(result, JSON.stringify(result)).toMatchObject({ kind: "committed" });
    const settled = await snapshot(stub, root);
    expect(settled.state.entities[NPC].resources!.hitDice).toBe(resourceBefore - 1);
    expect(c.draws).toBe(1); expect(c.actorRequests).toHaveLength(1); expect(settled.invocations).toEqual(paused.invocations);
    expect(settled.events.filter(e => e.rootActionId === root && e.eventType === "RandomnessRequested")).toHaveLength(1);
    expect(settled.events.filter(e => e.rootActionId === root && e.eventType === "DiceRolled")).toHaveLength(1);
    expect(settled.events.filter(e => e.rootActionId === root && e.eventType === "ResourceReserved")).toHaveLength(1);
    expect(settled.events.filter(e => e.eventType === "CanonicalFactDeclared" && record(record(e.payload).fact).id === TRACE)).toHaveLength(1);
    expect(settled.due).toEqual([]);
    await evictDurableObject(stub);
    expect(await run(stub, timeInput(`submission:vnext-plan:${checkpoint}`), c)).toMatchObject({ kind: "committed" });
    expect((await snapshot(stub, root)).events).toEqual(settled.events); expect(c.draws).toBe(1); expect(c.actorRequests).toHaveLength(1);
  }, 30_000);
}

for (const checkpoint of ["afterDueSubmissionBeforeCommit", "afterActorPlanInvocationPrepared"]) {
  it(`an unsent NPC invocation at ${checkpoint} resumes with one physical call`, async () => {
    const stub = await initialize(`vnext-actor-plan-unsent-${checkpoint}`), c = capture(), root = await seedPlan(stub);
    c.crashAt = checkpoint;
    expect(await run(stub, timeInput(`submission:vnext-plan:unsent:${checkpoint}`), c, timedAttempt())).toMatchObject({ kind: "committed" });
    const unsent = await snapshot(stub, root);
    expect(unsent.due).toHaveLength(1); expect(c.actorRequests).toEqual([]);
    expect(unsent.invocations).toHaveLength(checkpoint === "afterActorPlanInvocationPrepared" ? 1 : 0);
    expect(unsent.state.canonicalFacts[TRACE]).toBeUndefined();
    await evictDurableObject(stub);
    const result = await resume(stub, root, c);
    expect(result, JSON.stringify(result)).toMatchObject({ kind: "committed" });
    const settled = await snapshot(stub, root);
    expect(settled.invocations).toHaveLength(1); expect(settled.invocations[0]).toMatchObject({ ordinal: 1, status: "completed" });
    expect(c.actorRequests).toHaveLength(1); expect(c.draws).toBe(0);
    expect(settled.events.filter(e => e.eventType === "CanonicalFactDeclared" && record(record(e.payload).fact).id === TRACE)).toHaveLength(1);
  }, 30_000);
}

it("a dispatched NPC request without a reliable response fails explicitly and cannot spend a second provider call", async () => {
  const stub = await initialize("vnext-actor-plan-response-unknown"), c = capture(), root = await seedPlan(stub);
  c.failActor = true;
  expect(await run(stub, timeInput("submission:vnext-plan:unknown-response"), c, timedAttempt())).toMatchObject({ kind: "committed" });
  const failed = await snapshot(stub, root);
  expect(c.actorRequests).toHaveLength(1); expect(failed.invocations).toHaveLength(1);
  expect(failed.invocations[0].response_json).toBeNull();
  expect(failed.state.campaignRuntime.npcPlans[PLAN].status).toBe("scheduled"); expect(failed.state.canonicalFacts[TRACE]).toBeUndefined();
  await evictDurableObject(stub);
  const result = await resume(stub, root, c);
  expect(result, JSON.stringify(result)).toMatchObject({ kind: "rejected" });
  expect(record(result).code).toBe("ACTOR_PLAN_DECISION_OUTCOME_UNKNOWN");
  const unchanged = await snapshot(stub, root);
  expect(unchanged.invocations).toHaveLength(1); expect(c.actorRequests).toHaveLength(1); expect(c.draws).toBe(0);
  expect(unchanged.events).toEqual(failed.events); expect(unchanged.state.canonicalFacts[TRACE]).toBeUndefined();
}, 30_000);

it("a saved NPC decision refuses a corrupted frozen request without creating a new invocation", async () => {
  const stub = await initialize("vnext-actor-plan-corrupt-request"), c = capture(), root = await seedPlan(stub);
  c.crashAt = "afterActorPlanResponseSaved";
  expect(await run(stub, timeInput("submission:vnext-plan:corrupt-request"), c, timedAttempt())).toMatchObject({ kind: "committed" });
  const saved = await snapshot(stub, root);
  // Deliberately damage only this test's durable row to verify its integrity
  // check. This is not a product operation or a model's available capability.
  await runInDurableObject(stub, (_instance, context) => {
    const corrupted = { ...JSON.parse(saved.invocations[0].request_json), unauthorizedTarget: "target:unfrozen" };
    context.storage.sql.exec("UPDATE authority_vnext_invocations SET request_json = ? WHERE prepared_action_id = ? AND ordinal = 1", JSON.stringify(corrupted), root);
  });
  await evictDurableObject(stub);
  expect(await resume(stub, root, c)).toMatchObject({ kind: "rejected", code: "dueActorPlanInvocationIntegrityMismatch" });
  const rejected = await snapshot(stub, root);
  expect(rejected.events).toEqual(saved.events); expect(rejected.invocations).toHaveLength(1); expect(c.actorRequests).toHaveLength(1);
  expect(rejected.state.canonicalFacts[TRACE]).toBeUndefined(); expect(c.draws).toBe(0);
}, 30_000);

it("a dispatch journal with no saved response stays pending until expiry and then refuses resampling", async () => {
  const stub = await initialize("vnext-actor-plan-started-no-response"), c = capture(), root = await seedPlan(stub);
  c.crashAt = "afterActorPlanInvocationStarted";
  expect(await run(stub, timeInput("submission:vnext-plan:started-no-response"), c, timedAttempt())).toMatchObject({ kind: "committed" });
  const started = await snapshot(stub, root);
  expect(started.invocations).toHaveLength(1); expect(started.invocations[0]).toMatchObject({ ordinal: 1, status: "running", response_json: null });
  expect(c.actorRequests).toHaveLength(0);
  await evictDurableObject(stub);
  expect(await resume(stub, root, c)).toMatchObject({ kind: "retryableFailure", code: "ACTOR_PLAN_DECISION_PENDING" });
  // Simulate this isolated lease expiring without waiting for wall-clock time.
  await runInDurableObject(stub, (_instance, context) => {
    context.storage.sql.exec("UPDATE authority_vnext_invocations SET lease_until = 0 WHERE prepared_action_id = ? AND ordinal = 1", root);
  });
  await evictDurableObject(stub);
  expect(await resume(stub, root, c)).toMatchObject({ kind: "rejected", code: "ACTOR_PLAN_DECISION_OUTCOME_UNKNOWN" });
  const stopped = await snapshot(stub, root);
  expect(stopped.events).toEqual(started.events); expect(stopped.invocations).toHaveLength(1);
  expect(stopped.state.canonicalFacts[TRACE]).toBeUndefined(); expect(c.actorRequests).toHaveLength(0); expect(c.draws).toBe(0);
}, 30_000);

it("a shared one-call HTTP budget leaves NPC work unsent and the same submission resumes it with a fresh budget", async () => {
  const stub = await initialize("vnext-actor-plan-budget-one"), c = capture(), root = await seedPlan(stub);
  c.callLimit = "1";
  const input = timeInput("submission:vnext-plan:budget-one");
  expect(await run(stub, input, c, timedAttempt())).toMatchObject({ kind: "committed", action: "committed" });
  const paused = await snapshot(stub, root);
  expect(c.httpCalls).toEqual([["proposal"]]); expect(c.actorRequests).toHaveLength(0);
  expect(paused.invocations).toHaveLength(1);
  expect(paused.invocations[0]).toMatchObject({ ordinal: 1, status: "prepared", response_json: null, lease_until: 0 });
  expect(paused.due).toHaveLength(1); expect(paused.state.canonicalFacts[TRACE]).toBeUndefined();
  await evictDurableObject(stub);
  expect(await run(stub, input, c)).toMatchObject({ kind: "committed", action: "committed" });
  const settled = await snapshot(stub, root);
  expect(c.httpCalls).toEqual([["proposal"], ["actorPlan"]]);
  expect(c.playerRequests).toHaveLength(1); expect(c.actorRequests).toHaveLength(1); expect(c.draws).toBe(0);
  expect(settled.invocations).toHaveLength(1); expect(settled.invocations[0].status).toBe("completed");
  expect(settled.state.fictionTimelines).toEqual(paused.state.fictionTimelines);
  expect(settled.events.slice(paused.events.length).every(event => event.rootActionId === root)).toBe(true);
  expect(settled.events.filter(event => event.eventType === "NpcActionCommitted" && event.rootActionId === root)).toHaveLength(1);
  expect(settled.events.filter(event => event.eventType === "CanonicalFactDeclared" && record(record(event.payload).fact).id === TRACE)).toHaveLength(1);
  expect(settled.due).toEqual([]);
}, 30_000);

it("the sixth shared call leaves only NPC narration recoverable and a new HTTP request publishes the frozen child without rerunning mechanics", async () => {
  const stub = await initialize("vnext-actor-plan-budget-five"), c = capture(), root = await seedPlan(stub);
  c.callLimit = "5"; c.countNarrationCalls = true;
  const input = timeInput("submission:vnext-plan:budget-five");
  const result = await run(stub, input, c, timedAttempt());
  expect(result, JSON.stringify(result)).toMatchObject({ kind: "committed", action: "committed", narration: "retryableFailure", deliveryPending: true });
  expect(c.httpCalls).toEqual([["proposal", "actorPlan", "narration", "audit", "narration"]]);
  expect(c.narration).toHaveLength(2); expect(c.narration[1].rootActionId).toBe(root);
  const committed = await snapshot(stub, root);
  expect(committed.state.campaignRuntime.npcPlans[PLAN].status).toBe("resolved");
  expect(committed.state.canonicalFacts[TRACE].value).toMatchObject({ description: DESCRIPTION });
  expect(c.actorRequests).toHaveLength(1); expect(c.playerRequests).toHaveLength(1); expect(c.draws).toBe(0);
  const observation = record(await stub.observe(ALICE as never));
  const recovery = record(observation.narrationRecovery);
  expect(recovery, JSON.stringify(observation)).toMatchObject({ kind: "available" });
  expect(typeof recovery.capability).toBe("string");
  const frozenChildClaims = c.narration[1].renderableClaims;
  await evictDurableObject(stub);
  expect(await run(stub, input, c, undefined, String(recovery.capability))).toMatchObject({ kind: "committed", action: "committed", narration: "published" });
  expect(c.httpCalls).toEqual([["proposal", "actorPlan", "narration", "audit", "narration"], ["narration", "audit"]]);
  expect(c.narration).toHaveLength(3); expect(c.narration[2].rootActionId).toBe(root);
  expect(c.narration[2].renderableClaims).toEqual(frozenChildClaims);
  const recovered = await snapshot(stub, root);
  expect(recovered.events).toEqual(committed.events); expect(recovered.state).toEqual(committed.state);
  expect(recovered.invocations).toEqual(committed.invocations);
  expect(c.actorRequests).toHaveLength(1); expect(c.playerRequests).toHaveLength(1); expect(c.draws).toBe(0);
  expect(record(await stub.observe(ALICE as never)).narrationRecovery).toBeUndefined();
}, 30_000);
