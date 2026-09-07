import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as OTHER,
  PROBE_SCENE as SCENE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { committedRangeUsesFrozenRenderableClaims, deriveAuthorityClaimsFromCommittedRange,
  frozenRenderableClaimsConform, projectRenderableClaims } from "../app/_runtime/lib/rules/v2/claims.ts";
import { dueActorPlanChildRoot } from "../app/_runtime/lib/rules/v2/actor-plans.ts";
import { safeReceipt } from "../app/_runtime/lib/rules/v2/observer-delta.ts";
import { buildFrozenNarrationMaterial, reuseFrozenNarrationMaterialForRetry } from "../app/_runtime/lib/kp/vnext/narration.ts";

const NPC = "npc:scheduled-actor", PLAN = "plan:existing", ACTIVITY = "activity:existing";
const PREMISE = "knowledge:private-premise", TRACE = "fact:observable-trace";
const DESCRIPTION = "门框上多了一条刚系好的蓝色布带。";
const PRIVATE = /PRIVATE_[A-Z_]+/u;

// A pre-existing finite plan is a fixture input. Formation is outside this
// vertical slice; due resolution and projection use the public Rules runtime.
function fixture(name, { faction = false, hiddenTrace = false, remoteViewer = false } = {}) {
  const f = createAuthoredProbeFixture(`actor-plan-claims:${name}`, {
    npcCharacters: [{ id: NPC, name: "值班人" }],
    initialKnowledge: [{ characterId: NPC, knowledgeRef: PREMISE, content: "PRIVATE_PREMISE",
      kind: "sourceClaim", layer: "partial", visibility: "private", provenanceChain: ["genesis:private-premise"] }],
  });
  const factionRef = faction ? "faction:scheduled" : null;
  f.state.campaignRuntime.npcPlans[PLAN] = {
    npcId: NPC, actorKind: "npc", actorRef: NPC, decisionNpcId: NPC, planId: PLAN,
    revision: "1", status: "scheduled", factionRef, goal: "PRIVATE_GOAL", premiseRefs: [PREMISE],
    nextStep: "PRIVATE_NEXT_STEP", resourceRefs: faction ? [factionRef] : [],
    activity: { activityId: ACTIVITY, activityKind: "PRIVATE_ACTIVITY_KIND", intendedDurationMicros: "1" },
    due: { kind: "fictionTime", atFictionMicros: "0" }, trigger: null,
    trace: { factRef: TRACE, description: DESCRIPTION,
      visibilityPolicyRef: hiddenTrace ? "visibility:room-authority-only" : "visibility:scene-observers" },
    alternateTarget: { targetRef: SCENE, reason: "PRIVATE_ALTERNATE_REASON" },
  };
  f.state.campaignRuntime.activities[ACTIVITY] = {
    activityId: ACTIVITY, characterId: NPC, activityKind: "PRIVATE_ACTIVITY_KIND", status: "active",
    startedAtFictionMicros: "0", intendedDurationMicros: "1",
    completion: { kind: "actorPlan", planId: PLAN },
  };
  if (faction) {
    f.state.campaignRuntime.factions[factionRef] = { factionId: factionRef, memberRefs: [NPC], resourceRefs: [] };
    f.state.campaignRuntime.factionPlans[PLAN] = { ...structuredClone(f.state.campaignRuntime.npcPlans[PLAN]),
      factionId: factionRef, actingNpcId: NPC };
  }
  if (remoteViewer) {
    const remote = "scene:other";
    f.state.scenes[remote] = { id: remote, name: "远处房间" };
    f.state.combatRuntime.scenes[remote] = { ...structuredClone(f.state.combatRuntime.scenes[SCENE]), sceneId: remote };
    f.state.entities[OTHER].sceneId = remote;
    f.state.combatRuntime.entities[OTHER].sceneId = remote;
  }
  return f;
}

function resolve(f, decision = "execute", extra = {}, expectedKind = "committed") {
  const result = f.runtime.step(f.profiles, f.state, {
    kind: "resolveDueActorPlan", proposalId: dueActorPlanChildRoot(f.state.campaignRuntime.npcPlans[PLAN]),
    affectedCharacterId: NPC, causedByRootActionId: "root:committed-cause", planId: PLAN,
    decision, mechanicalProposal: null, ...extra,
  });
  assert.equal(result.kind, expectedKind, JSON.stringify(result));
  return result;
}

function range(f, result) {
  return { receipt: safeReceipt(result.state.receipts[result.receipt.rootActionId]),
    actorCharacterId: NPC, priorState: f.state, state: result.state, events: result.events };
}

function project(f, result, characterId = ACTOR) {
  const viewer = characterId === ACTOR ? f.viewer : { kind: "player", principalId: "principal:probe-target",
    seatId: "seat:probe-target", sessionVersion: 1, characterId: OTHER };
  const projected = f.runtime.project(f.profiles, result.state, viewer, { channel: "realtime", committedRange: {
    receiptId: result.receipt.receiptId, actorCharacterId: NPC, priorState: f.state, events: result.events,
  } });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  assert.ok(projected.renderableClaims, "an ActorPlan due receipt must use FrozenRenderableClaims");
  assert.equal(frozenRenderableClaimsConform(projected.renderableClaims), true);
  assert.doesNotMatch(JSON.stringify(projected), PRIVATE);
  for (const fact of projected.visibleFacts.filter(fact => fact.kind === "npcPlanTrace")) {
    assert.deepEqual(fact.value, { description: DESCRIPTION });
  }
  return projected.renderableClaims;
}

test("existing NPC and faction plans render only their committed observable trace through the same Rules Claims seam", () => {
  for (const faction of [false, true]) {
    const f = fixture(faction ? "faction" : "npc", { faction }), result = resolve(f);
    assert.ok(result.events.some(event => event.eventType === (faction ? "FactionActionCommitted" : "NpcActionCommitted")));
    assert.equal(result.state.campaignRuntime.activities[ACTIVITY].status, "completed");
    assert.equal(committedRangeUsesFrozenRenderableClaims(result.events), true);
    const owner = project(f, result), observer = project(f, result, OTHER);
    for (const claims of [owner, observer]) {
      assert.deepEqual(claims.claims.map(claim => [claim.kind, claim.description]), [["sceneFeature", DESCRIPTION]]);
      assert.doesNotMatch(JSON.stringify(claims), PRIVATE);
      assert.doesNotMatch(JSON.stringify(claims.claims), /nextStep|premiseRefs|planId|causedByRootActionId|resourceRefs/u);
    }
    const frozen = buildFrozenNarrationMaterial(result.receipt, owner.viewerKey, owner);
    assert.deepEqual(reuseFrozenNarrationMaterialForRetry(frozen), frozen);
    assert.deepEqual(project(f, result), owner);
  }
});

test("defer, revise and cancel commit privately without inventing public outcomes or requiring narration", () => {
  for (const decision of ["defer", "revise", "cancel"]) {
    const f = fixture(decision);
    const extra = decision === "defer" ? { reason: "PRIVATE_DEFER_REASON", deferUntilFictionMicros: "2" }
      : decision === "cancel" ? { reason: "PRIVATE_CANCEL_REASON" }
      : { revision: { reason: "PRIVATE_REVISION_REASON", premiseRefs: [PREMISE], nextStep: "PRIVATE_REVISED_STEP",
          resourceRefs: [], due: { kind: "fictionTime", atFictionMicros: "2" }, trigger: null,
          trace: { ...f.state.campaignRuntime.npcPlans[PLAN].trace, description: "PRIVATE_FUTURE_TRACE" },
          alternateTarget: { targetRef: SCENE, reason: "PRIVATE_REVISED_TARGET_REASON" } } };
    const result = resolve(f, decision, extra);
    assert.equal(result.state.canonicalFacts[TRACE], undefined);
    assert.equal(committedRangeUsesFrozenRenderableClaims(result.events), true);
    assert.deepEqual(deriveAuthorityClaimsFromCommittedRange(range(f, result)).claims, [], decision);
    for (const characterId of [ACTOR, OTHER]) {
      const claims = project(f, result, characterId);
      assert.deepEqual(claims.claims, []);
      assert.doesNotMatch(JSON.stringify(claims), PRIVATE);
    }
  }
});

test("an off-scene or ungranted Viewer gets no trace and a hidden trace stays private", () => {
  const f = fixture("remote", { remoteViewer: true }), result = resolve(f);
  assert.equal(project(f, result).claims.length, 1);
  assert.deepEqual(project(f, result, OTHER).claims, []);
  const authority = deriveAuthorityClaimsFromCommittedRange(range(f, result));
  const withoutGrants = projectRenderableClaims(authority, { viewerKey: "viewer:no-grants", refs: [] });
  assert.deepEqual(withoutGrants.claims, []);
  const broadPolicyOnly = projectRenderableClaims(authority, { viewerKey: "viewer:policy-only", refs: ["visibility:scene-observers"] });
  assert.deepEqual(broadPolicyOnly.claims, [], "a general scene policy is not evidence of seeing this trace");
  const hidden = fixture("hidden", { hiddenTrace: true }), hiddenResult = resolve(hidden);
  assert.deepEqual(project(hidden, hiddenResult).claims, []);
  const unattended = fixture("zero-audience", { remoteViewer: true });
  unattended.state.entities[ACTOR].sceneId = unattended.state.entities[OTHER].sceneId;
  unattended.state.combatRuntime.entities[ACTOR].sceneId = unattended.state.entities[OTHER].sceneId;
  const unattendedResult = resolve(unattended);
  assert.equal(unattendedResult.state.canonicalFacts[TRACE].value.description, DESCRIPTION);
  for (const characterId of [ACTOR, OTHER]) assert.deepEqual(project(unattended, unattendedResult, characterId).claims, []);
});

test("an entity-targeted trace follows its actual fact grants rather than broad co-presence", () => {
  const f = fixture("entity-target");
  f.state.campaignRuntime.npcPlans[PLAN].alternateTarget.targetRef = ACTOR;
  const result = resolve(f, "execute", { targetRef: ACTOR });
  assert.deepEqual(result.state.canonicalFacts[TRACE].subjectRefs, [ACTOR, NPC]);
  assert.equal(project(f, result).claims.length, 1);
  assert.deepEqual(project(f, result, OTHER).claims, []);
  assert.equal(result.state.canonicalFacts[TRACE].value.planId, PLAN, "projection does not mutate canonical trace metadata");
});

test("due mechanics reuse resource Claims and the NPC Activity policy without exposing the plan motive", () => {
  const f = fixture("resource");
  f.state.entities[NPC].resources.secondWind = 1;
  f.state.campaignRuntime.npcPlans[PLAN].resourceRefs = ["secondWind"];
  const result = resolve(f, "execute", { mechanicalProposal: { operation: "changeResource", resourceRef: "secondWind", amount: -1 } });
  assert.equal(result.state.entities[NPC].resources.secondWind, 0);
  assert.equal(result.events.filter(event => event.eventType === "ResourceChanged").length, 1);
  const claims = project(f, result);
  assert.deepEqual(claims.claims.map(claim => claim.kind), ["sceneFeature", "mechanicalOutcome"]);
  assert.ok(claims.claims.some(claim => claim.outcomeCode === "resourceChanged" && /剩余数量为 0/u.test(claim.summary)));
  assert.equal(claims.claims.some(claim => claim.outcomeCode === "activityCompleted"), false);
  const npc = f.runtime.project(f.profiles, result.state, { kind: "npc", npcId: NPC,
    purpose: "kpDecision", capability: "internal:npc-limited-knowledge" }, { channel: "realtime", committedRange: {
    receiptId: result.receipt.receiptId, actorCharacterId: NPC, priorState: f.state, events: result.events,
  } });
  assert.equal(npc.kind, "projected", JSON.stringify(npc));
  assert.ok(npc.renderableClaims.claims.some(claim => claim.outcomeCode === "activityCompleted"));
  assert.ok(npc.renderableClaims.claims.some(claim => claim.outcomeCode === "resourceChanged" && /剩余数量为 0/u.test(claim.summary)));
  assert.doesNotMatch(JSON.stringify(npc.renderableClaims), PRIVATE);
});

test("a due check or save freezes one cost and projects the settled roll and time without private purpose", () => {
  for (const [kind, face] of [["abilityCheck", 18], ["save", 2]]) {
    const f = fixture(`check-cost-time:${kind}`);
    f.state.entities[NPC].resources.hitDice = 3;
    f.state.campaignRuntime.npcPlans[PLAN].resourceRefs = ["hitDice"];
    const mechanicalProposal = { ...(kind === "save" ? { operation: "resolveNoncombatSave", saveAbility: "wis" }
      : { operation: "resolveNoncombatCheck", ability: "wis", skill: "perception" }),
      dc: 12, mode: "normal", duration: { unit: "second", value: 1 },
      frozenCosts: [{ kind: "consumeResource", resourceRef: "hitDice", amount: 1 }], success: [], failure: [] };
    const pending = resolve(f, "execute", { mechanicalProposal }, "awaitingRandomness");
    assert.equal(pending.state.entities[NPC].resources.hitDice, 2);
    const fulfilled = f.runtime.step(f.profiles, pending.state, {
      kind: "fulfillAuthoritativeRandomness", continuation: pending.continuation, rolls: [face],
    });
    assert.equal(fulfilled.kind, "committed", JSON.stringify(fulfilled));
    const result = { ...fulfilled, events: [...pending.events, ...fulfilled.events] };
    assert.equal(result.state.entities[NPC].resources.hitDice, 2);
    assert.equal(result.events.filter(event => event.eventType === "ResourceReserved").length, 1);
    assert.equal(result.events.filter(event => event.eventType === "DiceRolled").length, 1);
    const player = project(f, result);
    assert.deepEqual(player.claims.map(claim => claim.kind === "sceneFeature" ? claim.kind : claim.outcomeCode),
      ["sceneFeature", "fictionTimeAdvanced"]);
    assert.match(player.claims.find(claim => claim.outcomeCode === "fictionTimeAdvanced").summary, /1 秒/u);
    const npc = f.runtime.project(f.profiles, result.state, { kind: "npc", npcId: NPC,
      purpose: "kpDecision", capability: "internal:npc-limited-knowledge" }, { channel: "realtime", committedRange: {
      receiptId: result.receipt.receiptId, actorCharacterId: NPC, priorState: f.state, events: result.events,
    } });
    assert.equal(npc.kind, "projected", JSON.stringify(npc));
    const check = npc.renderableClaims.claims.find(claim => claim.check !== undefined);
    assert.deepEqual(check.check, { kind, result: face >= 12 ? "success" : "failure", total: face, dc: 12 });
    assert.match(npc.renderableClaims.claims.find(claim => claim.outcomeCode === "resourceChanged").summary, /生命骰消耗了 1/u);
    assert.doesNotMatch(JSON.stringify(npc.renderableClaims), PRIVATE);
    const bad = structuredClone(range(f, result));
    bad.events.find(event => event.eventType === "CheckFrozen").eventType = "UnknownCheckPreparation";
    assert.throws(() => deriveAuthorityClaimsFromCommittedRange(bad), /VNEXT_CLAIM_EVENT_UNKNOWN/u);
    if (face < 12) {
      const unmappedFailure = structuredClone(range(f, result));
      unmappedFailure.events.find(event => event.eventType === "MeaningfulFailureCommitted").payload.consequences = {
        additionalWorldResult: "PRIVATE_UNMAPPED_CONSEQUENCE",
      };
      assert.throws(() => deriveAuthorityClaimsFromCommittedRange(unmappedFailure), /VNEXT_CLAIM_EVENT_UNKNOWN/u);
    }
  }
});

test("ActorPlan trace claims fail closed on unknown events, absent descriptions and unbound canonical facts", () => {
  const f = fixture("closed"), result = resolve(f);
  for (const mutate of [
    value => { value.events[0].eventType = "UnknownNpcOutcome"; },
    value => { delete value.events.find(event => event.eventType === "CanonicalFactDeclared").payload.fact.value.description; },
    value => { value.state.canonicalFacts[TRACE].value.description = "UNCOMMITTED_DESCRIPTION"; },
  ]) {
    const malformed = structuredClone(range(f, result)); mutate(malformed);
    assert.throws(() => deriveAuthorityClaimsFromCommittedRange(malformed), /VNEXT_CLAIM_EVENT_UNKNOWN|ACTOR_PLAN_TRACE_CLAIM_INVALID/u);
  }
  const cancel = resolve(f, "cancel", { reason: "PRIVATE_CANCEL_REASON" });
  const unrelated = structuredClone(range(f, cancel));
  unrelated.events.find(event => event.eventType === "ActivityInterrupted").payload.cause.kind = "unmappedInterruption";
  assert.throws(() => deriveAuthorityClaimsFromCommittedRange(unrelated), /VNEXT_CLAIM_EVENT_UNKNOWN/u);
});
