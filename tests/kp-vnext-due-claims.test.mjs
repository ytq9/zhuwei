import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as OTHER,
  PROBE_SCENE as SCENE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { committedRangeUsesFrozenRenderableClaims, deriveAuthorityClaimsFromCommittedRange,
  projectRenderableClaims, frozenRenderableClaimsConform } from "../app/_runtime/lib/rules/v2/claims.ts";
import { buildFrozenNarrationMaterial, reuseFrozenNarrationMaterialForRetry } from "../app/_runtime/lib/kp/vnext/narration.ts";
import { buildPlayerCombatEntity, compileStaticCharacterCombat, synchronizePlayerCombatEntity } from "../app/_runtime/lib/rules/v2/character-abilities.ts";
import { characterBuildSnapshot } from "../app/_runtime/lib/rules/v2/character-progression.ts";

const HOUR = 3_600_000_000n;
function step(fixture, state, input, kind = "committed") {
  const result = fixture.runtime.step(fixture.profiles, state, input);
  assert.equal(result.kind, kind, JSON.stringify(result));
  return result;
}
function wait(fixture, state, hours) {
  return step(fixture, state, { kind: "resolveFreeAction", proposalId: `root:wait:${hours}`, characterId: OTHER,
    goal: "等待已安排的活动", method: "在原地等待", feasibility: { kind: "directSuccess", publicBasis: "没有中断。" },
    outcome: { publicResult: "等待结束。", fictionTimeCostMicros: (BigInt(hours) * HOUR).toString() } });
}
function project(fixture, priorState, result, characterId = ACTOR) {
  const viewer = characterId === ACTOR ? fixture.viewer : { kind: "player", principalId: "principal:probe-target",
    seatId: "seat:probe-target", sessionVersion: 1, characterId: OTHER };
  const projected = fixture.runtime.project(fixture.profiles, result.state, viewer, { channel: "realtime", committedRange: {
    receiptId: result.receipt.receiptId, actorCharacterId: ACTOR, priorState, events: result.events,
  } });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  assert.ok(projected.renderableClaims, "the due receipt must freeze Claims at its original committed range");
  assert.equal(frozenRenderableClaimsConform(projected.renderableClaims), true);
  return projected.renderableClaims;
}
function restFixture(id, { kind = "long", dice = 0, arcane = [] } = {}) {
  const fixture = createAuthoredProbeFixture(id);
  const actor = fixture.state.entities[ACTOR];
  Object.assign(actor, { classId: "wizard", level: 3, name: "艾莉丝", hitPoints: { current: 4, maximum: 20 },
    resources: { hitDice: kind === "long" ? 0 : 2, slot1: 0, slot2: 0, arcaneRecovery: kind === "long" ? 0 : 1, secondWind: 0 },
    resourceMaximums: { hitDice: 3, slot1: 4, slot2: 2, arcaneRecovery: 1, secondWind: 1 },
    characterBuild: { classId: "wizard", raceId: "human", cantrips: [], prepared: [] } });
  fixture.state.entities[OTHER].name = "布兰";
  const compiled = compileStaticCharacterCombat(actor, characterBuildSnapshot(actor),
    fixture.state.campaignRuntime.itemSystem, fixture.state.combatRuntime.definitions);
  fixture.state.combatRuntime.entities[ACTOR] = synchronizePlayerCombatEntity(fixture.state.combatRuntime.entities[ACTOR],
    buildPlayerCombatEntity(fixture.profiles, actor, compiled, "principal:probe-actor", undefined, fixture.state.campaignRuntime.itemSystem));
  fixture.state.combatRuntime.entities[ACTOR].hitPoints.temporary = "5";
  const start = step(fixture, fixture.state, { kind: "startRest", proposalId: `root:${id}:start`, characterId: ACTOR,
    restKind: kind, intendedDurationMicros: (HOUR * BigInt(kind === "long" ? 8 : 1)).toString(),
    hitDiceToSpend: dice, arcaneRecoverySlotLevels: arcane });
  const activityId = start.events.find(event => event.eventType === "RestStarted").payload.activityId;
  const waited = wait(fixture, start.state, kind === "long" ? 8 : 1);
  return { fixture, activityId, waited };
}

test("due long rest freezes actual HP, hit dice, slots and class recovery only for its controller", () => {
  const { fixture, activityId, waited } = restFixture("due-claims-long");
  const root = `activity-due:${activityId}:${8n * HOUR}`;
  const completed = step(fixture, waited.state, { kind: "completeActivity", proposalId: root, activityId });
  assert.equal(completed.state.combatRuntime.entities[ACTOR].hitPoints.temporary, "0");
  assert.equal(committedRangeUsesFrozenRenderableClaims(completed.events), true);
  const owner = project(fixture, waited.state, completed);
  const observer = project(fixture, waited.state, completed, OTHER);
  assert.ok(observer.claims.some(claim => claim.outcomeCode === "activityCompleted"));
  assert.deepEqual(observer.claims.map(claim => claim.outcomeCode), ["activityCompleted"]);
  const text = owner.claims.flatMap(claim => claim.narrationFacts).join("\n");
  for (const expected of [/长休已完成/u, /4\/20 变为 20\/20/u, /生命骰的可用数量由 0 变为 1/u,
    /1 环法术位的可用数量由 0 变为 4/u, /2 环法术位的可用数量由 0 变为 2/u, /奥术回想的可用数量由 0 变为 1/u,
    /回气的可用数量由 0 变为 1/u, /临时生命值由 5 变为 0/u]) assert.match(text, expected);
  assert.doesNotMatch(JSON.stringify(observer), /slot|生命骰|生命值|法术位|奥术回想|回气|resultingCharacter|definitions/u);
  const material = buildFrozenNarrationMaterial(completed.receipt, owner.viewerKey, owner);
  const retry = reuseFrozenNarrationMaterialForRetry(material);
  assert.deepEqual(retry, material);
  assert.deepEqual(project(fixture, waited.state, completed), owner);
});

test("short rest Claims report capped healing, frozen owner dice and arcane recovery consumption", () => {
  const { fixture, activityId, waited } = restFixture("due-claims-short", { kind: "short", dice: 1, arcane: [1, 1] });
  waited.state.entities[ACTOR].hitPoints.current = 19;
  waited.state.combatRuntime.entities[ACTOR].hitPoints.current = "19";
  const pending = step(fixture, waited.state, { kind: "completeActivity", proposalId: `activity-due:${activityId}:${HOUR}`, activityId }, "awaitingRandomness");
  const fulfilled = step(fixture, pending.state, { kind: "fulfillAuthoritativeRandomness", continuation: pending.continuation, rolls: [6] });
  const completed = { ...fulfilled, events: [...pending.events, ...fulfilled.events] };
  assert.equal(completed.state.combatRuntime.entities[ACTOR].hitPoints.temporary, "5", "a short rest preserves temporary HP");
  const owner = project(fixture, waited.state, completed);
  const text = owner.claims.flatMap(claim => claim.narrationFacts).join("\n");
  assert.match(text, /19\/20 变为 20\/20/u);
  assert.match(text, /1 枚 d6 生命骰，骰面为 6/u);
  assert.match(text, /生命骰的可用数量由 2 变为 1/u);
  assert.match(text, /1 环法术位的可用数量由 0 变为 2/u);
  assert.match(text, /奥术回想的可用数量由 1 变为 0/u);
  assert.doesNotMatch(text, /恢复了 6|变为 25/u);
  assert.doesNotMatch(text, /临时生命值由/u);
  assert.deepEqual(project(fixture, waited.state, completed, OTHER).claims.map(claim => claim.outcomeCode), ["activityCompleted"]);
});

test("ordinary due activity renders acquired evidence and a real resource cost without leaking its private knowledge", () => {
  const fixture = createAuthoredProbeFixture("due-claims-general");
  fixture.state.entities[ACTOR].resources.secondWind = 1;
  fixture.state.canonicalFacts["fact:activity-source"] = { id: "fact:activity-source", kind: "feature", subjectRefs: [],
    value: "CANARY_AUTHORITY_SOURCE", visibilityPolicyId: "visibility:room-authority-only", source: "moduleAnchor", causalParentIds: [],
    branchId: fixture.state.activeBranchId, validFromEventSeq: "0" };
  const activityId = "activity:inspect";
  const start = step(fixture, fixture.state, { kind: "startActivity", proposalId: "root:start-inspect", activityId,
    characterId: ACTOR, activityKind: "inspection", intendedDurationMicros: HOUR.toString(), completion: {
      method: "检查表面", primaryFactRef: "fact:activity-source", sourceSceneId: SCENE, failure: [], success: [
        { kind: "acquireEvidence", definitionRef: "fact:activity-source", evidenceRef: "knowledge:observed", evidence: "铜片背面刻有弯月。" },
        { kind: "acquireKnowledge", definitionRef: "fact:activity-source", knowledgeRef: "knowledge:learned", value: "这是一枚通行标记。" },
        { kind: "changeResource", targetRef: ACTOR, resourceRef: "secondWind", amount: -1 },
      ],
    } });
  const active = fixture.runtime.project(fixture.profiles, start.state, fixture.viewer, { channel: "realtime" });
  assert.equal(active.kind, "projected");
  assert.doesNotMatch(JSON.stringify(active), /CANARY_AUTHORITY_SOURCE|铜片背面刻有弯月|这是一枚通行标记/u);
  const waited = wait(fixture, start.state, 1);
  const completed = step(fixture, waited.state, { kind: "completeActivity", proposalId: `activity-due:${activityId}:${HOUR}`, activityId });
  assert.equal(committedRangeUsesFrozenRenderableClaims(completed.events), true);
  const owner = project(fixture, waited.state, completed);
  const observer = project(fixture, waited.state, completed, OTHER);
  assert.match(JSON.stringify(owner), /铜片背面刻有弯月/u);
  assert.match(JSON.stringify(owner), /这是一枚通行标记/u);
  assert.ok(owner.claims.some(claim => claim.outcomeCode === "resourceChanged"));
  assert.deepEqual(observer.claims.map(claim => claim.outcomeCode), ["activityCompleted"]);
  assert.doesNotMatch(JSON.stringify(owner), /CANARY_AUTHORITY_SOURCE/u);
  assert.doesNotMatch(JSON.stringify(observer), /铜片|弯月|通行标记|knowledge:observed|knowledge:learned/u);
});

test("Activity lifecycle projection keeps future outcomes and interruption causes private", () => {
  const f = createAuthoredProbeFixture("activity-lifecycle-projection");
  f.state.canonicalFacts["fact:private-source"] = { id: "fact:private-source", kind: "feature", subjectRefs: [],
    value: "PRIVATE-SOURCE-CANARY", visibilityPolicyId: "visibility:room-authority-only", source: "moduleAnchor",
    causalParentIds: [], branchId: f.state.activeBranchId, validFromEventSeq: "0" };
  const start = step(f, f.state, { kind: "startActivity", proposalId: "root:private-activity", activityId: "activity:private",
    activityKind: "PRIVATE-GOAL-CANARY", characterId: ACTOR, intendedDurationMicros: HOUR.toString(),
    completion: { method: "研究", primaryFactRef: "fact:private-source", sourceSceneId: SCENE, failure: [],
      success: [{ kind: "acquireKnowledge", definitionRef: "fact:private-source", knowledgeRef: "knowledge:future", value: "FUTURE-KNOWLEDGE-CANARY" }] } });
  const interrupted = step(f, start.state, { kind: "interruptActivity", proposalId: "root:interrupt-private",
    activityId: "activity:private", cause: { reason: "PRIVATE-INTERRUPTION-CANARY" } });
  for (const [status, result] of [["active", start], ["interrupted", interrupted]]) {
    assert.equal(result.state.knowledge[ACTOR]?.["knowledge:future"], undefined);
    assert.equal(result.state.fictionTimelines[result.state.activeBranchId].nowMicros, "0");
    const view = f.runtime.project(f.profiles, result.state, f.viewer, { channel: "realtime" });
    assert.equal(view.kind, "projected");
    assert.deepEqual(view.activities, [{ activityId: "activity:private", characterId: ACTOR, status,
      startedAtFictionMicros: "0", intendedDurationMicros: HOUR.toString() }]);
    assert.doesNotMatch(JSON.stringify(view), /CANARY/u);
  }
  const rest = step(f, interrupted.state, { kind: "startRest", proposalId: "root:safe-rest", characterId: ACTOR,
    restKind: "short", intendedDurationMicros: HOUR.toString(), hitDiceToSpend: 0, arcaneRecoverySlotLevels: [] });
  const view = f.runtime.project(f.profiles, rest.state, f.viewer, { channel: "realtime" });
  assert.equal(view.kind, "projected");
  assert.equal(view.activities.find(activity => activity.status === "active").restKind, "short");
  assert.ok(view.activities.every(activity => !Object.hasOwn(activity, "completion") && !Object.hasOwn(activity, "recoveryChoice")));
});

test("standalone synchronization and unknown completion effects stay explicit Claims failures", () => {
  const { fixture, activityId, waited } = restFixture("due-claims-closed");
  const completed = step(fixture, waited.state, { kind: "completeActivity", proposalId: `activity-due:${activityId}:${8n * HOUR}`, activityId });
  const range = { receipt: completed.receipt, actorCharacterId: ACTOR, priorState: waited.state, state: completed.state, events: completed.events };
  const unknown = structuredClone(range);
  unknown.events[1].eventType = "UnknownRecoveryApplied";
  assert.throws(() => deriveAuthorityClaimsFromCommittedRange(unknown), /VNEXT_CLAIM_EVENT_UNKNOWN/u);
  const unpaired = structuredClone(range);
  unpaired.events[1] = { ...unpaired.events[1], eventType: "DiceRolled", payload: {} };
  assert.throws(() => deriveAuthorityClaimsFromCommittedRange(unpaired), /CHARACTER_MECHANICS_CLAIM_UNMAPPED/u);
  const mismatch = structuredClone(range);
  mismatch.events[2].payload.combatEntity.hitPoints.current = "1";
  assert.throws(() => deriveAuthorityClaimsFromCommittedRange(mismatch), /CHARACTER_MECHANICS_CLAIM_UNMAPPED/u);
  const unreported = structuredClone(range);
  unreported.events[2].payload.combatEntity.armorClass = "25";
  unreported.state.combatRuntime.entities[ACTOR].armorClass = "25";
  assert.throws(() => deriveAuthorityClaimsFromCommittedRange(unreported), /CHARACTER_MECHANICS_CLAIM_UNMAPPED/u);
  assert.equal(committedRangeUsesFrozenRenderableClaims([{ eventType: "ActivityCompleted", rootActionId: "root:actor-plan" }]), false);
});

test("a due movement gives the departing observer no arrival fact or destination name", () => {
  const fixture = createAuthoredProbeFixture("due-claims-movement");
  const destination = "scene:private-destination";
  fixture.state.scenes[destination] = { id: destination, name: "CANARY_DESTINATION" };
  fixture.state.combatRuntime.scenes[destination] = structuredClone(fixture.state.combatRuntime.scenes[SCENE]);
  fixture.state.combatRuntime.scenes[destination].sceneId = destination;
  fixture.state.canonicalFacts["fact:travel"] = { id: "fact:travel", kind: "route", subjectRefs: [], value: "已冻结的行程",
    visibilityPolicyId: "visibility:character-controller:character:probe-actor", source: "moduleAnchor",
    branchId: fixture.state.activeBranchId, validFromEventSeq: "0", causalParentIds: [] };
  const activityId = "activity:travel";
  const start = step(fixture, fixture.state, { kind: "startActivity", proposalId: "root:travel-start", activityId,
    characterId: ACTOR, activityKind: "travel", intendedDurationMicros: HOUR.toString(), completion: {
      method: "沿已确认的路线前行", primaryFactRef: "fact:travel", sourceSceneId: SCENE, failure: [],
      success: [{ kind: "moveEntity", entityRef: ACTOR, sceneRef: destination }],
    } });
  const waited = wait(fixture, start.state, 1);
  const completed = step(fixture, waited.state, { kind: "completeActivity", proposalId: `activity-due:${activityId}:${HOUR}`, activityId });
  const owner = project(fixture, waited.state, completed);
  const observer = project(fixture, waited.state, completed, OTHER);
  assert.ok(owner.claims.some(claim => claim.outcomeCode === "arrived"));
  assert.ok(observer.claims.some(claim => claim.outcomeCode === "departed"));
  assert.equal(observer.claims.some(claim => claim.outcomeCode === "arrived"), false);
  assert.doesNotMatch(JSON.stringify(observer), /CANARY_DESTINATION|private-destination/u);
});
