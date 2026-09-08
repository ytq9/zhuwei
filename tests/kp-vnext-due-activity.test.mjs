import { stepActionToDecision } from './fixtures/vnext-action-lifecycle.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_TARGET as OTHER, PROBE_SOURCE as SOURCE, PROBE_SCENE as SCENE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { VNEXT2_PROPOSAL_BUNDLE_SCHEMA } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { parseSubmitKpProposalBundleCandidateArguments } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";

const HOUR = 3_600_000_000n;
const KP = { kind: "kp", capability: "internal:kp-spatial-evidence" };
const micros = hours => (BigInt(hours) * HOUR).toString();
const nextInput = (root, actor = ACTOR, hours = 0) => ({
  kind: "resolveFreeAction", proposalId: root, characterId: actor,
  goal: "继续观察已有对象", method: "保持当前安排并观察",
  feasibility: { kind: "directSuccess", publicBasis: "没有新的中断事件。" },
  outcome: { publicResult: "完成观察。", ...(hours ? { fictionTimeCostMicros: micros(hours) } : {}) },
});
function step(fixture, state, input, expected = "committed") {
  const result = stepActionToDecision(fixture.runtime, fixture.profiles, state, input);
  assert.equal(result.kind, expected, JSON.stringify(result));
  return result;
}
function startRest(fixture, state, { owner = ACTOR, kind = "long", id = "rest", dice = 0 } = {}) {
  const result = step(fixture, state, {
    kind: "startRest", proposalId: `root:${id}:start`, characterId: owner,
    restKind: kind, intendedDurationMicros: micros(kind === "long" ? 8 : 1),
    hitDiceToSpend: dice, arcaneRecoverySlotLevels: [],
  });
  return { result, activityId: result.events.find(event => event.eventType === "RestStarted").payload.activityId };
}
function dueView(fixture, state) {
  const result = fixture.runtime.project(fixture.profiles, state, KP, { dueActivities: true });
  assert.equal(result.kind, "projected", JSON.stringify(result));
  assert.ok(Array.isArray(result.dueActivities));
  return result;
}
function vnextInput(fixture, state, rootActionId) {
  const frozen = freezeAuthoredProbeContext(fixture, state, { rootActionId, focusRefs: [SOURCE] });
  const value = {
    schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: "proposalBundle", mode: "adjudication", basisRefs: [SOURCE],
    adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "观察已有对象的表面。", successOutcome: "看清对象。" }, terminal: null,
    proposals: [{ kind: "worldInteraction", basisRefs: [SOURCE], consumes: [], produces: [], outcomeBinding: "always",
      sceneRef: SCENE, targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: null,
      intent: "观察阀门。", method: "查看当前可见表面。", branches: { success: {
        outcomeCode: "outcome:observed", summary: "阀门保持当前状态。", effects: [], sensoryEvidence: [], pressures: [], opportunities: [],
      }, failure: null } }],
  };
  const lowered = lowerVNext2ProposalBundle({ ...fixture, state, rootActionId, requiredContext: frozen.context, value });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  return lowered.command.rulesInput;
}
function shortPending(id = "late-short", owner = ACTOR) {
  const fixture = createAuthoredProbeFixture(id);
  fixture.state.entities[owner].hitPoints.current = 4;
  fixture.state.entities[owner].resources.hitDice = 2;
  fixture.state.entities[owner].resourceMaximums.hitDice = 2;
  const started = startRest(fixture, fixture.state, { owner, kind: "short", id, dice: 1 });
  const waited = step(fixture, started.result.state, nextInput(`root:${id}:wait`, ACTOR, 2));
  // Simulate a delayed dispatcher after another authority clock update.
  // The scheduler itself stops at 1h; lateness must not be manufactured by waiting through it.
  waited.state = structuredClone(waited.state);
  waited.state.fictionTimelines["branch:probe"].nowMicros = micros(2);
  const pending = step(fixture, waited.state, nextInput(`root:${id}:next`), "awaitingRandomness");
  return { fixture, activityId: started.activityId, waited, pending };
}
function fulfill(fixture, state, pending, rolls = [6], expected = "committed") {
  return step(fixture, state, { kind: "fulfillAuthoritativeRandomness", continuation: pending.continuation, rolls }, expected);
}

test("vNext and legacy real actions settle the same canonical due root before consuming their intent", () => {
  const fixture = createAuthoredProbeFixture("due-original-red");
  const started = startRest(fixture, fixture.state);
  const waited = step(fixture, started.result.state, nextInput("root:wait", ACTOR, 8));
  const dueRoot = `activity-due:${started.activityId}:${micros(8)}`;
  const original = vnextInput(fixture, waited.state, "root:vnext-next");
  for (const input of [original, nextInput("root:legacy-next")]) {
    const result = step(fixture, waited.state, input);
    assert.equal(result.mechanicalResult.retryOriginalIntent, true);
    assert.deepEqual([...new Set(result.events.map(event => event.rootActionId))], [dueRoot]);
    assert.equal(result.state.campaignRuntime.activities[started.activityId].status, "completed");
    assert.equal(result.state.entities[ACTOR].hitPoints.current, 20);
    assert.equal(result.state.receipts[input.rootActionId ?? input.proposalId], undefined);
  }
  const completed = step(fixture, waited.state, original);
  const next = step(fixture, completed.state, vnextInput(fixture, completed.state, "root:after-due"));
  // Starting, advancing and finishing retain their separate authoritative events.
  assert.deepEqual(next.events.map(event => event.eventType), ["ActivityStarted", "FictionTimeAdvanced", "ActivityCompleted", "WorldInteractionResolved"]);
  const replayed = fixture.runtime.replay(fixture.genesis, [...started.result.events, ...waited.events, ...completed.events, ...next.events]);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  assert.deepEqual(replayed.state, next.state);
});

test("late short-rest request and fulfillment keep the frozen due instant and use the activity owner's dice", () => {
  const { fixture, activityId, waited, pending } = shortPending("owner-short", OTHER);
  const request = pending.randomnessRequest;
  assert.equal(request.actorCharacterId, OTHER);
  assert.equal(request.frozenParameters.characterId, OTHER);
  assert.equal(request.frozenParameters.completionFictionMicros, micros(1));
  assert.equal(request.frozenParameters.timelineId, "branch:probe");
  assert.equal(waited.state.fictionTimelines["branch:probe"].nowMicros, micros(2));
  const outstanding = dueView(fixture, pending.state).dueActivities;
  assert.deepEqual(outstanding.map(entry => entry.activityId), [activityId], "the pending completion remains visible under its original root");
  assert.equal(step(fixture, pending.state, nextInput("root:blocked-by-rest"), "rejected").rejection.code, "pendingInputUnresolved");
  const completed = fulfill(fixture, pending.state, pending);
  assert.equal(completed.events.find(event => event.eventType === "RestCompleted").payload.completedAtFictionMicros, micros(1));
  assert.equal(completed.state.entities[OTHER].hitPoints.current, 10);
  assert.equal(completed.state.entities[OTHER].resources.hitDice, 1);
  assert.deepEqual(completed.state.entities[ACTOR], pending.state.entities[ACTOR]);
  assert.equal(completed.state.fictionTimelines["branch:probe"].nowMicros, micros(2));
  assert.deepEqual(dueView(fixture, completed.state).dueActivities, []);
  assert.equal(fulfill(fixture, completed.state, pending, [6], "rejected").rejection.code, "privateOrUnknownReference");
});

test("late long-rest completion preserves its due timestamp and the next legal 24-hour benefit", () => {
  const fixture = createAuthoredProbeFixture("late-long");
  const started = startRest(fixture, fixture.state);
  const waited = step(fixture, started.result.state, nextInput("root:late-long-wait", ACTOR, 25));
  waited.state = structuredClone(waited.state);
  waited.state.fictionTimelines["branch:probe"].nowMicros = micros(25);
  const completed = step(fixture, waited.state, { kind: "completeActivity", proposalId: "root:late-long-complete", activityId: started.activityId });
  assert.equal(completed.state.entities[ACTOR].lastLongRestCompletedAtMicros, micros(8));
  assert.equal(completed.events.find(event => event.eventType === "RestCompleted").payload.completedAtFictionMicros, micros(8));
  assert.equal(completed.state.fictionTimelines["branch:probe"].nowMicros, micros(25));
  const next = startRest(fixture, completed.state, { id: "next-long" });
  assert.equal(next.result.state.campaignRuntime.activities[next.activityId].startedAtFictionMicros, micros(25));

  const changed = structuredClone(waited.state);
  changed.entities[ACTOR].lastLongRestCompletedAtMicros = micros(1);
  const rejected = step(fixture, changed, { kind: "completeActivity", proposalId: "root:late-long-conflict", activityId: started.activityId }, "rejected");
  assert.equal(rejected.rejection.code, "missingPrerequisite", "processing at 25h cannot make an 8h completion satisfy a 1h + 24h interval");
});

test("rest fulfillment revalidates frozen owner, timing, timeline, choice and request identity", () => {
  const { fixture, activityId, pending } = shortPending("frozen-rest");
  const mutations = [
    state => { state.campaignRuntime.activities[activityId].characterId = OTHER; },
    state => { state.campaignRuntime.activities[activityId].activityId = "activity:other"; },
    state => { state.campaignRuntime.activities[activityId].startedAtFictionMicros = "1"; },
    state => { state.campaignRuntime.activities[activityId].intendedDurationMicros = micros(2); },
    state => { state.campaignRuntime.activities[activityId].restKind = "long"; },
    state => { state.campaignRuntime.activities[activityId].recoveryChoice.hitDiceToSpend = 2; },
    state => { state.entities[ACTOR].classId = "wizard"; },
    state => { state.fictionTimelines["branch:probe"].nowMicros = "0"; },
    state => { state.fictionTimelines["branch:other"] = { branchId: "branch:other", nowMicros: micros(2) };
      state.multiplayerRuntime.characterTimelineIds[ACTOR] = "branch:other"; },
    state => { const stored = state.internalContinuations[pending.continuation.continuationId];
      stored.request.frozenParameters.completionFictionMicros = micros(2);
      const { requestHash: _, ...core } = stored.request; stored.request.requestHash = canonicalSha256(core); },
    state => { const stored = state.internalContinuations[pending.continuation.continuationId];
      stored.request.actorCharacterId = OTHER;
      const { requestHash: _, ...core } = stored.request; stored.request.requestHash = canonicalSha256(core); },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const state = structuredClone(pending.state);
    mutate(state);
    const result = fixture.runtime.step(fixture.profiles, state, { kind: "fulfillAuthoritativeRandomness", continuation: pending.continuation, rolls: [6] });
    assert.equal(result.kind, "rejected", `mutation ${index}: ${JSON.stringify(result)}`);
  }
  const later = structuredClone(pending.state);
  later.fictionTimelines["branch:probe"].nowMicros = micros(3);
  assert.equal(fulfill(fixture, later, pending).events.find(event => event.eventType === "RestCompleted").payload.completedAtFictionMicros, micros(1));
});

test("internal due projection enumerates sorted ordinary Activities across timelines with movement scopes", () => {
  const fixture = createAuthoredProbeFixture("due-descriptors");
  const started = startRest(fixture, fixture.state, { kind: "short" });
  const waited = step(fixture, started.result.state, nextInput("root:descriptor-wait", ACTOR, 2));
  const state = structuredClone(waited.state);
  state.fictionTimelines["branch:probe"].nowMicros = micros(2);
  const template = state.campaignRuntime.activities[started.activityId];
  state.campaignRuntime.activities = {
    "activity:z": { ...template, activityId: "activity:z", intendedDurationMicros: micros(2) },
    "activity:a": { ...template, activityId: "activity:a", characterId: OTHER, completion: {
      method: "go", sourceSceneId: "scene:source", success: [{ kind: "moveEntity", entityRef: OTHER, sceneRef: "scene:destination" }], failure: [],
    } },
    "activity:b": { ...template, activityId: "activity:b" },
    "activity:future": { ...template, activityId: "activity:future", intendedDurationMicros: micros(3) },
    "activity:interrupted": { ...template, activityId: "activity:interrupted", status: "interrupted" },
  };
  state.entities[OTHER].sceneId = "scene:other";
  state.fictionTimelines["branch:other"] = { branchId: "branch:other", nowMicros: micros(2) };
  state.multiplayerRuntime.characterTimelineIds[OTHER] = "branch:other";
  state.campaignRuntime.activities["activity:a"].progression = { ...template.progression, timelineId: "branch:other", sourceSceneId: "scene:other" };
  const before = structuredClone(state);
  const view = dueView(fixture, state);
  assert.deepEqual(view.dueActivities.map(entry => entry.activityId), ["activity:a", "activity:b"]);
  assert.deepEqual(view.dueActivities[0], {
    activityId: "activity:a", ownerEntityId: OTHER, timelineId: "branch:other", completionFictionMicros: micros(1),
    childRootActionId: `activity-due:activity:a:${micros(1)}`, activityHash: canonicalSha256({ ...state.campaignRuntime.activities["activity:a"], progression: (({ acknowledgedKnowledgeRefs, ...binding }) => binding)(state.campaignRuntime.activities["activity:a"].progression) }),
    activityProgress: { phase: "complete", completion: "activity", fromFictionMicros: micros(1), toFictionMicros: micros(1) },
    sceneIds: ["scene:destination", "scene:other", "scene:source"],
  });
  assert.deepEqual(state, before);
  const afterEarlier = structuredClone(state);
  afterEarlier.campaignRuntime.activities["activity:a"].status = "completed";
  afterEarlier.campaignRuntime.activities["activity:b"].status = "completed";
  assert.equal(dueView(fixture, afterEarlier).dueActivities[0].activityId, "activity:z", "later completion waits behind the earlier deadline");
  const { projectionHash, ...base } = view;
  assert.equal(projectionHash, canonicalSha256(base));
  const settled = step(fixture, state, nextInput("root:own-timeline"));
  assert.equal(settled.mechanicalResult.activityId, "activity:b", "another timeline's earlier descriptor cannot settle on this input");
  assert.equal(settled.state.campaignRuntime.activities["activity:a"].status, "active");
});

test("same-timeline other-scene rest is due, while future other-timeline rest cannot block the action", () => {
  const fixture = createAuthoredProbeFixture("due-owner-scene");
  const started = startRest(fixture, fixture.state, { owner: OTHER });
  const waited = step(fixture, started.result.state, nextInput("root:owner-scene-wait", ACTOR, 8));
  const shared = structuredClone(waited.state);
  shared.scenes["scene:other"] = { ...shared.scenes[SCENE], id: "scene:other" };
  shared.entities[OTHER].sceneId = "scene:other";
  shared.campaignRuntime.activities[started.activityId].progression.sourceSceneId = "scene:other";
  assert.equal(step(fixture, shared, nextInput("root:shared-timeline")).mechanicalResult.activityId, started.activityId);
  const independent = structuredClone(shared);
  independent.fictionTimelines["branch:other"] = { branchId: "branch:other", nowMicros: "0" };
  independent.multiplayerRuntime.characterTimelineIds[OTHER] = "branch:other";
  const next = step(fixture, independent, vnextInput(fixture, independent, "root:independent-action"));
  assert.equal(next.state.campaignRuntime.activities[started.activityId].status, "active");
  assert.equal(next.mechanicalResult.kind, "worldInteraction");
});

test("due projection requires exact internal capability and rejects combined or malformed queries", () => {
  const fixture = createAuthoredProbeFixture("due-query-auth");
  assert.deepEqual(dueView(fixture, fixture.state).dueActivities, []);
  for (const viewer of [fixture.viewer, { kind: "kp" }, { ...KP, principalId: "forged" },
    { kind: "npc", npcId: OTHER, purpose: "kpDecision", capability: "internal:npc-limited-knowledge" }]) {
    assert.equal(fixture.runtime.project(fixture.profiles, fixture.state, viewer, { dueActivities: true }).kind, "rejected");
  }
  for (const query of [{ dueActivities: false }, { dueActivities: undefined }, { dueActivities: true, channel: "realtime" },
    { dueActivities: true, dueActorPlanFor: { affectedCharacterId: ACTOR } },
    { dueActivities: true, pendingNpcDecisionFor: { pendingInputId: "pending:unknown" } },
    { dueActivities: true, committedRange: {} }]) {
    assert.equal(fixture.runtime.project(fixture.profiles, fixture.state, KP, query).kind, "rejected", JSON.stringify(query));
  }
});

test("knowledge review can read held knowledge while due rest waits for another player's dice", () => {
  const { fixture, activityId, pending } = shortPending("query-during-due", OTHER);
  const rootActionId = "root:knowledge-during-due";
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify({ decision: { kind: "knowledgeReview", inquiry: "我知道什么？", scope: "allKnown", knowledgeRefs: [] } }));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  const frozen = freezeAuthoredProbeContext(fixture, pending.state, { rootActionId, intentText: "我知道什么？", focusRefs: [] });
  const lowered = lowerVNext2ProposalBundle({ ...fixture, state: pending.state, rootActionId, requiredContext: frozen.context, value: parsed.bundle });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const result = step(fixture, pending.state, lowered.command.rulesInput);
  assert.deepEqual(result.events.map(event => event.eventType), ["KnowledgeReviewed"]);
  for (const key of ["entities", "campaignRuntime", "combatRuntime", "fictionTimelines", "internalContinuations", "knowledge"]) {
    assert.deepEqual(result.state[key], pending.state[key], key);
  }
  assert.equal(result.state.campaignRuntime.activities[activityId].status, "active");
  fulfill(fixture, result.state, pending);
});

test("completion, interruption and frozen continuation inputs retain the scheduler bypass", () => {
  const { fixture, activityId, waited, pending } = shortPending("bypass-due");
  const interrupted = step(fixture, pending.state, { kind: "interruptActivity", proposalId: "root:interrupt-due", activityId, cause: { kind: "voluntaryStop" } });
  assert.deepEqual(interrupted.events.map(event => event.eventType), ["ActivityInterrupted"]);
  assert.equal(fulfill(fixture, interrupted.state, pending, [6], "rejected").rejection.code, "invalidRulesInput");
  const direct = step(fixture, waited.state, { kind: "completeActivity", proposalId: "root:explicit-due", activityId }, "awaitingRandomness");
  assert.equal(direct.events[0].rootActionId, "root:explicit-due");
  for (const kind of ["answerPendingInput", "answerGroupRestInvitation", "authoritativeRandomness",
    "fulfillAuthoritativeRandomnessBatch", "applyServiceCorrection", "resolveDueActorPlan"]) {
    const result = fixture.runtime.step(fixture.profiles, pending.state, { kind, characterId: ACTOR });
    assert.equal(result.kind, "rejected", kind);
    assert.notEqual(result.rejection.code, "pendingInputUnresolved", `${kind} must reach its own canonical validator`);
  }
});
