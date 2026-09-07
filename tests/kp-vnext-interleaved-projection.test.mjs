import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_TARGET as OTHER, PROBE_SCENE as SCENE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { createEventTransition, createScopeProof, validateEventEnvelope } from "../app/_runtime/lib/rules/v2/events.ts";
import { frozenRenderableClaimsConform } from "../app/_runtime/lib/rules/v2/claims.ts";

const HOUR = "3600000000";
function step(fixture, state, input, kind = "committed") {
  const result = fixture.runtime.step(fixture.profiles, state, input);
  assert.equal(result.kind, kind, JSON.stringify(result));
  return result;
}
function pendingRest(id) {
  const fixture = createAuthoredProbeFixture(id);
  fixture.state.entities[ACTOR].resources.hitDice = 2;
  fixture.state.entities[ACTOR].resourceMaximums.hitDice = 2;
  fixture.state.combatRuntime.entities[ACTOR].resources.hitDice = { current: "2", maximum: "2" };
  const started = step(fixture, fixture.state, { kind: "startRest", proposalId: `root:${id}:start`, characterId: ACTOR,
    restKind: "short", intendedDurationMicros: HOUR, hitDiceToSpend: 1, arcaneRecoverySlotLevels: [] });
  const waited = step(fixture, started.state, { kind: "resolveFreeAction", proposalId: `root:${id}:wait`, characterId: OTHER,
    goal: "等待", method: "原地等待", feasibility: { kind: "directSuccess", publicBasis: "无中断" },
    outcome: { publicResult: "等待结束。", fictionTimeCostMicros: HOUR } });
  const activityId = started.events.find(event => event.eventType === "RestStarted").payload.activityId;
  const pending = step(fixture, waited.state, { kind: "completeActivity", proposalId: `activity-due:${activityId}:${HOUR}`, activityId }, "awaitingRandomness");
  return { fixture, priorState: waited.state, pending };
}
function review(fixture, state) {
  const rootActionId = "root:intervening-knowledge-review";
  const value = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify({ decision: { kind: "knowledgeReview", inquiry: "我知道些什么？", scope: "allKnown", knowledgeRefs: [] } })).bundle;
  const frozen = freezeAuthoredProbeContext(fixture, state, { rootActionId, focusRefs: [], intentText: "我知道些什么？" });
  const lowered = lowerVNext2ProposalBundle({ ...fixture, state, rootActionId, requiredContext: frozen.context, value });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  return step(fixture, state, lowered.command.rulesInput);
}
function project(fixture, priorState, result, events, viewer = fixture.viewer) {
  return fixture.runtime.project(fixture.profiles, result.state, viewer, { channel: "realtime", committedRange: {
    receiptId: result.receipt.receiptId, actorCharacterId: ACTOR, priorState, events,
  } });
}
function transition(fixture, state, rootActionId, eventType, payload, visibilityPolicyId = "visibility:scene-observers") {
  return createEventTransition(state, fixture.profiles, { rootActionId, eventType, payload,
    scopeProof: createScopeProof(state, [], [], []), visibilityPolicyId, secrecy: "public" });
}

test("a real knowledge review can interleave with rest randomness without entering the rest Claims", () => {
  const { fixture, priorState, pending } = pendingRest("interleaved-review");
  const reviewed = review(fixture, pending.state);
  const completed = step(fixture, reviewed.state, { kind: "fulfillAuthoritativeRandomness", continuation: pending.continuation, rolls: [6] });
  const journal = [...pending.events, ...reviewed.events, ...completed.events];
  const result = project(fixture, priorState, completed, journal);
  assert.equal(result.kind, "projected", JSON.stringify(result));
  assert.equal(frozenRenderableClaimsConform(result.renderableClaims), true);
  assert.ok(result.renderableClaims.claims.some(claim => claim.outcomeCode === "restCompleted"));
  assert.equal(result.renderableClaims.claims.some(claim => claim.kind === "knowledgeReview"), false);
  assert.doesNotMatch(JSON.stringify(result.renderableClaims), /已有知识目录为空|intervening-knowledge-review/u);
  assert.deepEqual(project(fixture, priorState, completed, journal).renderableClaims, result.renderableClaims);

  const variants = [
    [...pending.events, ...completed.events],
    [...reviewed.events, ...completed.events],
    [...pending.events, ...reviewed.events, ...reviewed.events, ...completed.events],
    structuredClone(journal),
  ];
  variants[3][pending.events.length].payload.inquiry = "TAMPERED_INTERVENING_EVENT";
  for (const events of variants) {
    const invalid = project(fixture, priorState, completed, events);
    assert.equal(invalid.kind, "rejected");
    assert.equal(invalid.rejection.code, "projectionIntegrity");
  }
});

test("Claims use the state immediately before recovery and do not attribute another root's healing to rest", () => {
  const { fixture, priorState, pending } = pendingRest("interleaved-healing");
  // Build an independently valid authority journal event; this test exercises
  // the public projector's provenance contract, not an alternate Rules action.
  const other = transition(fixture, pending.state, "root:other-healing", "HealingResolved",
    { entityId: ACTOR, before: "10", after: "13" });
  const completed = step(fixture, other.state, { kind: "fulfillAuthoritativeRandomness", continuation: pending.continuation, rolls: [6] });
  const result = project(fixture, priorState, completed, [...pending.events, other.event, ...completed.events]);
  assert.equal(result.kind, "projected", JSON.stringify(result));
  const claims = result.renderableClaims.claims;
  assert.match(JSON.stringify(claims), /13\/20 变为 19\/20/u);
  assert.doesNotMatch(JSON.stringify(claims), /10\/20 变为 19\/20|other-healing/u);
  assert.equal(claims.some(claim => claim.outcomeCode === "healed"), false);
  const healthTransitions = result.committedDelta.changes.filter(change => change.kind === "projectionFieldChanged"
    && change.field === "controlledCharacter" && change.before?.hitPoints?.current !== change.after?.hitPoints?.current);
  assert.equal(healthTransitions.length, 1);
  assert.equal(healthTransitions[0].before.hitPoints.current, 13);
  assert.equal(healthTransitions[0].after.hitPoints.current, 19);
  assert.equal(healthTransitions.some(change => change.before.hitPoints.current === 10), false);
});

test("an observer arriving between root events does not retroactively receive an earlier private scene result", () => {
  const fixture = createAuthoredProbeFixture("interleaved-arrival");
  const elsewhere = "scene:elsewhere";
  fixture.state.scenes[elsewhere] = { id: elsewhere, name: "外廊" };
  fixture.state.combatRuntime.scenes[elsewhere] = { ...structuredClone(fixture.state.combatRuntime.scenes[SCENE]), sceneId: elsewhere };
  fixture.state.entities[OTHER].sceneId = elsewhere;
  fixture.state.combatRuntime.entities[OTHER].sceneId = elsewhere;
  const activityId = "activity:spanning-scenes";
  fixture.state.campaignRuntime.activities[activityId] = { activityId, characterId: ACTOR, activityKind: "inspection",
    startedAtFictionMicros: "0", intendedDurationMicros: HOUR, status: "active" };
  const root = `activity-due:${activityId}:${HOUR}`;
  const first = transition(fixture, fixture.state, root, "TemporaryHitPointsGranted", { entityId: ACTOR,
    before: "0", after: "4", sourceDefinitionId: "ability:temporary-ward" });
  const arrival = transition(fixture, first.state, "root:observer-arrives", "CharacterMoved", { characterId: OTHER,
    destinationSceneId: SCENE, sourceTimelineId: "branch:probe", destinationTimelineId: "branch:probe",
    departureMicros: "0", arrivalMicros: "0" });
  const completion = transition(fixture, arrival.state, root, "HealingResolved", { entityId: ACTOR, before: "10", after: "12" });
  const last = transition(fixture, completion.state, root, "ActivityCompleted", { activityId });
  for (const entry of [first, arrival, completion, last]) assert.equal(validateEventEnvelope(entry.event).ok, true, JSON.stringify(entry.event));
  const viewer = { kind: "player", principalId: "principal:probe-target", seatId: "seat:probe-target", sessionVersion: 1, characterId: OTHER };
  const result = project(fixture, fixture.state, last, [first.event, arrival.event, completion.event, last.event], viewer);
  assert.equal(result.kind, "projected", JSON.stringify(result));
  assert.ok(result.renderableClaims.claims.some(claim => claim.outcomeCode === "healed"));
  assert.equal(result.renderableClaims.claims.some(claim => claim.outcomeCode === "temporaryHitPointsGranted"), false);
});
