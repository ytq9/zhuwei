import assert from "node:assert/strict";
import test from "node:test";
import {
  conditionActionPermission, conditionAbilityCheck, conditionAttack,
  conditionSavingThrow, conditionSpeed, conditionHitPointLimits, conditionMovementPermission,
  conditionDamageDefense, applyConditionDamageDefense, conditionMechanics,
} from "../app/_runtime/lib/rules/v2/condition-mechanics.ts";
import { WORLD_EFFECT_SCHEMA, dueWorldEffectDrafts, isWorldEffectRecord, synchronizeWorldEffectSuspensions } from "../app/_runtime/lib/rules/v2/world-effects.ts";
import { combatPhaseExpiryAnchor, remainingCombatPhaseDuration } from "../app/_runtime/lib/rules/v2/effect-phase.ts";

function world(conditions = {}, targetConditions = {}, damageDefenses = {}) {
  return { entities: { actor: { tenureStatus: "active" }, target: { tenureStatus: "active" } },
    combatRuntime: { entities: {
      actor: { id: "actor", lifeState: "alive", conditions },
      target: { id: "target", lifeState: "alive", conditions: targetConditions, damageDefenses },
    }, effects: {} } };
}
function grant(state, condition, sourceRef, targetEntityId = "actor", level) {
  const effectId = `effect:${condition}:${sourceRef}:${targetEntityId}`;
  state.combatRuntime.effects[effectId] = {
    schema: WORLD_EFFECT_SCHEMA, effectId, kind: "condition", sourceRef,
    sourceDefinitionRef: "ability:condition", targetEntityId, condition,
    level: level ?? null, duration: { kind: "untilEnded" }, startedAtFictionMicros: "0",
    expiresAt: null, pausedMicros: "0", suspension: null, visibilityPolicyId: "visibility:scene-observers", visibilityFactId: null,
  };
}

test("frightened uses actual sources and line of sight; every voluntary path segment must not approach", () => {
  const state = world();
  grant(state, "frightened", "target");
  assert.equal(conditionAbilityCheck(state, "actor", { visibleFearSourceRefs: ["target"] }).mode, "disadvantage");
  assert.equal(conditionAbilityCheck(state, "actor", { visibleFearSourceRefs: [] }).mode, "normal");
  assert.equal(conditionAbilityCheck(state, "actor").requiredContext.length, 1);
  assert.equal(conditionAttack(state, "actor", "target", { withinFiveFeet: false, visibleFearSourceRefs: ["target"] }).mode, "disadvantage");
  assert.equal(conditionSavingThrow(state, "actor", "wis").mode, "normal");
  assert.equal(conditionActionPermission(state, "actor", { kind: "movement", fearSourceApproaches: { target: false } }).allowed, true);
  assert.equal(conditionActionPermission(state, "actor", { kind: "movement", fearSourceApproaches: { target: true } }).allowed, false);
  assert.equal(conditionActionPermission(state, "actor", { kind: "movement", voluntary: false }).allowed, true);
  assert.equal(conditionActionPermission(state, "actor", { kind: "movement" }).requiredContext[0], "movementDistance:target");
});

test("charmed restricts harming each charmer and grants only the charmer social advantage", () => {
  const state = world();
  grant(state, "charmed", "target");
  grant(state, "charmed", "another-charmer");
  assert.equal(conditionActionPermission(state, "actor", { kind: "action", harmful: true, targetEntityIds: ["target"] }).allowed, false);
  assert.equal(conditionActionPermission(state, "actor", { kind: "action", attack: true, targetEntityIds: ["another-charmer"] }).allowed, false);
  assert.equal(conditionActionPermission(state, "actor", { kind: "action", harmful: true, targetEntityIds: ["unrelated"] }).allowed, true);
  assert.equal(conditionActionPermission(state, "actor", { kind: "action", harmful: false, targetEntityIds: ["target"] }).allowed, true);
  assert.equal(conditionAbilityCheck(state, "target", { socialTargetId: "actor" }).mode, "advantage");
  assert.equal(conditionAbilityCheck(state, "target").mode, "normal");
  assert.equal(conditionAbilityCheck(state, "actor", { socialTargetId: "target" }).mode, "normal");
});

test("petrified disables action and motion, automatically fails physical saves, and suspends poison", () => {
  const state = world({ petrified: true, poisoned: true });
  const facts = conditionMechanics(state, "actor");
  assert.equal(facts.canAct, false);
  assert.equal(facts.canReact, false);
  assert.equal(facts.canMove, false);
  assert.equal(facts.canSpeak, false);
  assert.equal(facts.weightMultiplier, 10);
  assert.equal(facts.agingSuspended, true);
  assert.equal(facts.poisonAndDiseaseSuspended, true);
  assert.deepEqual(facts.conditionImmunities, ["poisoned"]);
  assert.equal(conditionAbilityCheck(state, "actor").mode, "normal");
  assert.equal(conditionAbilityCheck(state, "actor", { requiresSight: true }).automaticFailure, true);
  for (const ability of ["str", "dex"]) assert.equal(conditionSavingThrow(state, "actor", ability).automaticFailure, true);
  for (const ability of ["con", "int", "wis", "cha"]) assert.equal(conditionSavingThrow(state, "actor", ability).automaticFailure, false);
  assert.equal(conditionAttack(state, "target", "actor", { withinFiveFeet: true }).mode, "advantage");
  assert.equal(conditionAttack(state, "target", "actor", { withinFiveFeet: true }).criticalIfHit, false);
});

test("petrification grants all-damage resistance once and poison immunity while preserving vulnerability", () => {
  const state = world({}, { petrified: true }, { resistant: ["fire"], vulnerable: ["fire"] });
  const fire = conditionDamageDefense(state, "target", "fire");
  assert.deepEqual(fire, { immune: false, resistant: true, vulnerable: true });
  assert.equal(applyConditionDamageDefense(9, fire), 8);
  assert.equal(applyConditionDamageDefense(9, conditionDamageDefense(state, "target", "force")), 4);
  assert.equal(applyConditionDamageDefense(9, conditionDamageDefense(state, "target", "poison")), 0);
  state.combatRuntime.entities.target.conditions = {};
  assert.equal(applyConditionDamageDefense(9, conditionDamageDefense(state, "target", "force")), 9);
});

test("2014 exhaustion is cumulative, uses thresholds instead of flat penalties, and never compounds base values", () => {
  for (let level = 0; level <= 6; level++) {
    const state = world();
    if (level > 0) grant(state, "exhaustion", "hazard", "actor", level);
    assert.equal(conditionAbilityCheck(state, "actor").mode, level >= 1 ? "disadvantage" : "normal");
    assert.equal(conditionSavingThrow(state, "actor", "con").mode, level >= 3 ? "disadvantage" : "normal");
    assert.equal(conditionAttack(state, "actor", "target", { withinFiveFeet: false }).mode, level >= 3 ? "disadvantage" : "normal");
    assert.equal(conditionSpeed(state, "actor", "361").speed, level >= 5 ? "0" : level >= 2 ? "180" : "361");
    assert.deepEqual(conditionHitPointLimits(state, "actor", 21, 18), {
      maximum: level >= 4 ? 10 : 21, current: level >= 4 ? 10 : 18, diesFromExhaustion: level === 6,
    });
    assert.equal(conditionMechanics(state, "actor").dead, level === 6);
  }
});

test("all advantage and disadvantage sources cancel once; prone and paralyzed use distance independent of attack type", () => {
  const state = world({ poisoned: true, exhaustion: "3", invisible: true }, { prone: true });
  const near = conditionAttack(state, "actor", "target", { withinFiveFeet: true });
  assert.equal(near.mode, "normal");
  assert.ok(near.advantageReasons.length >= 2);
  assert.ok(near.disadvantageReasons.length >= 2);
  state.combatRuntime.entities.target.conditions = { paralyzed: true };
  assert.equal(conditionAttack(state, "actor", "target", { withinFiveFeet: true }).criticalIfHit, true);
  assert.equal(conditionAttack(state, "actor", "target", { withinFiveFeet: false }).criticalIfHit, false);
  assert.equal(conditionSavingThrow(world({ poisoned: true }), "actor", "dex").mode, "normal");
});


test("fear movement uses the existing Geometry measurement core over whole segments", () => {
  const state = world();
  const point = (x,y) => ({x:String(x),y:String(y),elevation:"0"});
  for (const [id,position] of [["actor",point(-120,120)],["target",point(0,0)]]) {
    Object.assign(state.combatRuntime.entities[id], {sceneId:"scene",position,
      footprint:{width:"60",depth:"60",height:"60"}});
  }
  grant(state,"frightened","target");
  assert.equal(conditionMovementPermission(state,"actor",[point(-120,120),point(120,120)]).allowed,false);
  assert.equal(conditionMovementPermission(state,"actor",[point(-120,120),point(-180,180)]).allowed,true);
  assert.equal(conditionMovementPermission(state,"actor",[point(-120,120),point(120,120)],false).allowed,true);
});


function phaseWorld() {
  const state = world();
  state.activeBranchId = "branch";
  state.fictionTimelines = { branch: { nowMicros: "0" } };
  state.multiplayerRuntime = { characterTimelineIds: { actor: "branch", target: "branch" } };
  state.combatRuntime.encounters = { encounter: {
    encounterId: "encounter", status: "active", round: 1, roundClosed: false,
    participantEntityIds: ["actor", "target"], turnOrderEntityIds: ["actor", "target"],
    activeEntityId: "actor", combatMoment: { edge: "turnStart" },
    initiative: { entries: [
      { entryId: "entry:actor", combatantEntityIds: ["actor"] },
      { entryId: "entry:target", combatantEntityIds: ["target"] },
    ] },
  } };
  return state;
}

test("phase anchors distinguish the remaining current turn end from the next start and a completed end", () => {
  const state = phaseWorld();
  assert.equal(combatPhaseExpiryAnchor(state, "actor", "turnStart", "root").targetRound, 2);
  assert.equal(combatPhaseExpiryAnchor(state, "actor", "turnEnd", "root").targetRound, 1);
  assert.equal(combatPhaseExpiryAnchor(state, "target", "turnStart", "root").targetRound, 1);
  state.combatRuntime.encounters.encounter.combatMoment.edge = "turnEnd";
  assert.equal(combatPhaseExpiryAnchor(state, "actor", "turnEnd", "root").targetRound, 2);
  state.combatRuntime.encounters.encounter.roundClosed = true;
  assert.equal(combatPhaseExpiryAnchor(state, "target", "turnEnd", "root").targetRound, 2);
});

test("phase poison ignores boundaries while stone and resumes at its next remaining subject boundary", () => {
  const state = phaseWorld();
  grant(state, "poisoned", "target");
  const effect = Object.values(state.combatRuntime.effects)[0];
  effect.duration = { kind: "turnBoundary", subject: "source", edge: "turnEnd" };
  effect.expiresAt = { ...combatPhaseExpiryAnchor(state, "target", "turnEnd", "root"), encounterId: "encounter" };
  assert.equal(isWorldEffectRecord(effect), true);
  assert.deepEqual(remainingCombatPhaseDuration(state, effect.expiresAt), {
    remainingMicros: "6000000", remainingBoundaries: 1,
  });
  state.combatRuntime.entities.actor.conditions.petrified = true;
  synchronizeWorldEffectSuspensions(state, "actor");
  assert.equal(effect.suspension.remainingBoundaries, 1);
  state.combatRuntime.encounters.encounter.round = 3;
  state.combatRuntime.encounters.encounter.activeEntityId = "target";
  state.combatRuntime.encounters.encounter.combatMoment.edge = "turnEnd";
  state.fictionTimelines.branch.nowMicros = "12000000";
  assert.deepEqual(dueWorldEffectDrafts(state), []);
  delete state.combatRuntime.entities.actor.conditions.petrified;
  synchronizeWorldEffectSuspensions(state, "actor");
  assert.equal(effect.expiresAt.targetRound, 4);
  assert.equal(isWorldEffectRecord(effect), true);
  assert.deepEqual(dueWorldEffectDrafts(state), []);
  state.combatRuntime.encounters.encounter.round = 4;
  assert.equal(dueWorldEffectDrafts(state)[0].payload.effectId, effect.effectId);
});

test("a suspended phase poison survives encounter conclusion and resumes its saved remainder in fiction time", () => {
  const state = phaseWorld();
  grant(state, "poisoned", "target");
  const effect = Object.values(state.combatRuntime.effects)[0];
  effect.duration = { kind: "turnBoundary", subject: "target", edge: "turnEnd" };
  effect.expiresAt = { ...combatPhaseExpiryAnchor(state, "actor", "turnEnd", "root"), encounterId: "encounter" };
  state.combatRuntime.entities.actor.conditions.petrified = true;
  synchronizeWorldEffectSuspensions(state, "actor");
  assert.equal(effect.suspension.remainingMicros, "3000000");
  state.combatRuntime.encounters.encounter.status = "concluded";
  state.fictionTimelines.branch.nowMicros = "20000000";
  assert.deepEqual(dueWorldEffectDrafts(state), []);
  delete state.combatRuntime.entities.actor.conditions.petrified;
  synchronizeWorldEffectSuspensions(state, "actor");
  assert.deepEqual(effect.expiresAt, { kind: "fictionTime", entityId: "actor", dueMicros: "23000000" });
  assert.equal(isWorldEffectRecord(effect), true);
  state.fictionTimelines.branch.nowMicros = "22999999";
  assert.deepEqual(dueWorldEffectDrafts(state), []);
  state.fictionTimelines.branch.nowMicros = "23000000";
  assert.equal(dueWorldEffectDrafts(state).length, 1);
});
