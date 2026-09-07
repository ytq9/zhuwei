import assert from "node:assert/strict";
import test from "node:test";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import { compileAbilityDefinition, registeredAbilityRecord } from "../app/_runtime/lib/rules/profiles/ability-compiler.ts";
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as TARGET } from "../tools/lib/vnext-authored-probe-fixture.mjs";

function fixture(id, mechanics, configure = () => {}) {
  const f = createAuthoredProbeFixture(`sustained:${id}`);
  const abilityRef = `ability:sustained:${id}`;
  const compiled = compileAbilityDefinition({ definitionId: abilityRef, revision: "1", rulesBasis: "srd5.1-2014",
    activation: { kind: "actionSpell", spellLevel: "1", castingTimeMicros: "12000000", ritual: true },
    target: { kind: "creature", count: "1", rangeInches: "600", requiresSight: true },
    costs: [{ kind: "spellSlot", level: "1", amount: "1" }], ...mechanics });
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  // This is an isolated registered-definition genesis fixture. Model authoring
  // and Room scheduling are exercised by their separate consumer tests.
  const state = structuredClone(f.state);
  state.combatRuntime.definitions[abilityRef] = registeredAbilityRecord(compiled.artifact);
  const caster = state.combatRuntime.entities[ACTOR];
  caster.abilityRefs = [abilityRef];
  caster.resources = { "spellSlot:1": { current: "1", maximum: "1" } };
  caster.spellcasting = { ability: "int", spellAttackBonus: "4", spellSaveDc: "12" };
  delete caster.turn;
  configure(state);
  const body = { ...state };
  delete body.eventHeadHash;
  delete body.lastEventId;
  const initialStateHash = canonicalSha256(body);
  state.eventHeadHash = initialStateHash;
  const genesis = { ...structuredClone(f.genesis), initialState: state, initialStateHash };
  delete genesis.genesisHash;
  genesis.genesisHash = canonicalSha256(genesis);
  const replayed = f.runtime.replay(genesis, []);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return { ...f, genesis, state: replayed.state, abilityRef, events: [] };
}
function apply(f, input) {
  const result = f.runtime.step(f.profiles, f.state, input);
  if (result.events?.length) {
    f.events.push(...result.events);
    const replayed = f.runtime.replay(f.genesis, f.events);
    assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
    assert.deepEqual(replayed.state, result.state);
    f.state = replayed.state;
  }
  return result;
}
function begin(f, parameters = { targetEntityId: TARGET }) {
  const result = apply(f, { kind: "invokeAbility", rootActionId: `${f.rootActionId}:begin`, sourceEntityId: ACTOR,
    abilityRef: f.abilityRef, parameters });
  assert.equal(result.kind, "committed", JSON.stringify({ kind: result.kind, rejection: result.rejection }));
  assert.equal(result.events.some(event => ["ResourceSpent", "SpellCastingStarted", "DamageApplied"].includes(event.eventType)), false);
  assert.equal(f.state.combatRuntime.entities[ACTOR].resources["spellSlot:1"].current, "1");
  return f.state.campaignRuntime.activities[result.mechanicalResult.activityId];
}
function elapse(f, duration) {
  const result = apply(f, { kind: "resolveFreeAction", proposalId: `${f.rootActionId}:fixture-time`, characterId: ACTOR,
    goal: "continue the uninterrupted casting work", method: "remain focused while fictional time passes",
    feasibility: { kind: "directSuccess", publicBasis: "The isolated fixture contains no intervening work." },
    outcome: { publicResult: "The casting time passes.", fictionTimeCostMicros: duration } });
  assert.equal(result.kind, "committed", JSON.stringify({ kind: result.kind, rejection: result.rejection }));
}
function completionInput(activity) {
  return { kind: "completeLongSpellcasting", proposalId: `long-spell-due:${activity.activityId}:${BigInt(activity.startedAtFictionMicros) + BigInt(activity.intendedDurationMicros)}`,
    activityId: activity.activityId };
}
function fulfill(f, result, face = () => 4) {
  assert.equal(result.kind, "awaitingRandomness", JSON.stringify({ kind: result.kind, rejection: result.rejection }));
  return apply(f, { kind: "authoritativeRandomness", resolutionId: result.resolutionId,
    responseId: `authority:${result.resolutionId}`, continuationCapability: result.continuationCapability,
    randomnessResults: result.randomnessRequests.map(request => ({ randomnessId: request.randomnessId,
      requestHash: request.requestHash, draws: request.dice.map(term => ({ sides: Number(term.sides),
        faces: Array.from({ length: Number(term.count) }, () => Math.min(Number(term.sides), face(request.purposeKey))) })) })) });
}

test("registered long attacks compile the original attack and damage only at completion, then replay without duplicate cost", () => {
  const f = fixture("attack", { attack: { kind: "spellAttack" }, damage: [{ type: "force", formula: "1d4" }] });
  const activity = begin(f);
  elapse(f, activity.intendedDurationMicros);
  const waiting = apply(f, completionInput(activity));
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  assert.equal(waiting.randomnessRequests.some(request => request.purposeKey.startsWith("attack:")), true);
  assert.equal(waiting.randomnessRequests.some(request => request.purposeKey.startsWith("damage:")), true);
  const done = fulfill(f, waiting, purpose => purpose.startsWith("attack:") ? 15 : 4);
  assert.equal(done.kind, "committed", JSON.stringify(done));
  assert.equal(f.state.combatRuntime.entities[TARGET].hitPoints.current, "16");
  assert.equal(f.state.combatRuntime.entities[ACTOR].resources["spellSlot:1"].current, "0");
  assert.equal(f.events.filter(event => event.eventType === "ResourceSpent").length, 1);
  const repeated = apply(f, completionInput(activity));
  assert.equal(repeated.kind, "rejected");
  assert.deepEqual(repeated.events, []);
});

test("ritual healing uses the same execution preparation and preserves the spell slot", () => {
  const f = fixture("healing", { healing: { formula: "1d4+1" } });
  const activity = begin(f, { targetEntityId: ACTOR, ritual: true });
  assert.equal(activity.intendedDurationMicros, "612000000");
  assert.equal(f.state.combatRuntime.entities[ACTOR].turn, undefined);
  elapse(f, activity.intendedDurationMicros);
  const waiting = apply(f, completionInput(activity));
  const done = fulfill(f, waiting);
  assert.equal(done.kind, "committed", JSON.stringify(done));
  assert.equal(f.state.combatRuntime.entities[ACTOR].hitPoints.current, "15");
  assert.equal(f.state.combatRuntime.entities[ACTOR].turn, undefined);
  assert.equal(f.state.combatRuntime.entities[ACTOR].resources["spellSlot:1"].current, "1");
  assert.equal(f.events.some(event => event.eventType === "ResourceSpent"), false);
});

test("long area spells validate the frozen origin, derive targets, and request saves plus one shared damage roll", () => {
  const f = fixture("area", { target: { kind: "area", rangeInches: "600", shape: { kind: "sphere", radiusInches: "180", propagation: "straight" } },
    save: { ability: "dex", dc: "12", halfOnSuccess: true }, damage: [{ type: "cold", formula: "1d4" }] });
  const invalid = apply(f, { kind: "invokeAbility", rootActionId: `${f.rootActionId}:invalid`, sourceEntityId: ACTOR,
    abilityRef: f.abilityRef, parameters: { areaOrigin: { x: "9000", y: "100", elevation: "0" } } });
  assert.equal(invalid.kind, "rejected");
  assert.deepEqual(invalid.events, []);
  const activity = begin(f, { areaOrigin: { x: "200", y: "100", elevation: "0" } });
  elapse(f, activity.intendedDurationMicros);
  const waiting = apply(f, completionInput(activity));
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  assert.equal(waiting.randomnessRequests.filter(request => request.purposeKey.startsWith("save:")).length, 2);
  assert.equal(waiting.randomnessRequests.filter(request => request.purposeKey.startsWith("damage:")).length, 1);
  const done = fulfill(f, waiting, purpose => purpose.startsWith("save:") ? 1 : 4);
  assert.equal(done.kind, "committed", JSON.stringify(done));
  assert.equal(f.state.combatRuntime.entities[TARGET].hitPoints.current, "16");
  assert.equal(f.state.combatRuntime.entities[ACTOR].hitPoints.current, "6");
});

test("completion refuses early, forged, retargeted, and stale-target requests before costs or randomness", () => {
  const f = fixture("guard", { damage: [{ type: "force", formula: "1d4" }] });
  const activity = begin(f);
  for (const input of [completionInput(activity), { ...completionInput(activity), proposalId: "forged" },
    { ...completionInput(activity), targetEntityId: ACTOR }]) {
    const result = apply(f, input);
    assert.equal(result.kind, "rejected", JSON.stringify({ kind: result.kind, rejection: result.rejection }));
    assert.deepEqual(result.events, []);
  }
  const migrated = structuredClone(f.state);
  migrated.fictionTimelines["branch:migrated"] = { branchId: "branch:migrated", nowMicros: activity.intendedDurationMicros };
  migrated.multiplayerRuntime.characterTimelineIds[ACTOR] = "branch:migrated";
  const migrationResult = f.runtime.step(f.profiles, migrated, completionInput(activity));
  assert.equal(migrationResult.kind, "rejected");
  assert.deepEqual(migrationResult.events, []);
  elapse(f, activity.intendedDurationMicros);
  // Independent authority snapshots isolate the highest-risk completion guards.
  for (const mutate of [
    state => { state.combatRuntime.entities[TARGET].sceneId = "scene:elsewhere"; },
    state => { state.combatRuntime.entities[TARGET].position.x = "9000"; },
    state => { state.combatRuntime.entities[ACTOR].resources["spellSlot:1"].current = "0"; },
  ]) {
    const changed = structuredClone(f.state);
    mutate(changed);
    const result = f.runtime.step(f.profiles, changed, completionInput(activity));
    assert.equal(result.kind, "rejected", JSON.stringify({ kind: result.kind, rejection: result.rejection }));
    assert.deepEqual(result.events, []);
    assert.equal(changed.campaignRuntime.activities[activity.activityId].status, "active");
  }
});

test("long casting cannot bypass the existing bonus-action spell restriction", () => {
  const f = fixture("bonus", { healing: { formula: "1d4" } }, state => {
    state.combatRuntime.entities[ACTOR].turn = { action: "1", bonusAction: "0", reaction: "1", bonusActionSpellCast: true };
    state.combatRuntime.encounters["encounter:bonus-spell"] = {
      encounterId: "encounter:bonus-spell", sceneId: state.entities[ACTOR].sceneId, status: "active",
      participantEntityIds: [ACTOR], initiativeGroups: [{ entryId: "initiative:caster", combatantEntityIds: [ACTOR] }],
      hostilities: [], battlefieldFactIds: [], surprisedEntityIds: [], initiative: { ordered: true,
        entries: [{ entryId: "initiative:caster", combatantEntityIds: [ACTOR], total: 20 }] },
      round: 1, turnCursor: 0, activeEntityId: ACTOR, turnOrderEntityIds: [ACTOR], roundClosed: false,
    };
  });
  const result = f.runtime.step(f.profiles, f.state, { kind: "invokeAbility", rootActionId: `${f.rootActionId}:forbidden`, sourceEntityId: ACTOR,
    abilityRef: f.abilityRef, parameters: { targetEntityId: ACTOR } });
  assert.equal(result.kind, "rejected", JSON.stringify({ kind: result.kind, rejection: result.rejection }));
  assert.equal(result.rejection.code, "bonusActionSpellRestriction2014");
  assert.deepEqual(result.events, []);
});


test("a registered Counterspell resumes the existing due root and does not refund or repeat its committed slot", () => {
  const reactionRef = "ability:sustained:registered-reaction";
  const f = fixture("countered", { damage: [{ type: "force", formula: "1d4" }] }, state => {
    const compiled = compileAbilityDefinition({ definitionId: reactionRef, revision: "1", rulesBasis: "srd5.1-2014",
      activation: { kind: "reactionSpell", spellLevel: "3" },
      costs: [{ kind: "spellSlot", level: "3", amount: "1" }], effect: { kind: "counterspell", rangeInches: "720" } });
    assert.equal(compiled.ok, true, JSON.stringify(compiled));
    state.combatRuntime.definitions[reactionRef] = registeredAbilityRecord(compiled.artifact);
    const reactor = state.combatRuntime.entities[TARGET];
    reactor.abilityRefs = [reactionRef];
    reactor.resources = { "spellSlot:3": { current: "1", maximum: "1" } };
    reactor.spellcasting = { ability: "int", spellAttackBonus: "2", spellSaveDc: "10" };
  });
  const activity = begin(f);
  elapse(f, activity.intendedDurationMicros);
  const waiting = apply(f, completionInput(activity));
  assert.equal(waiting.kind, "awaitingInput", JSON.stringify({ kind: waiting.kind, rejection: waiting.rejection }));
  assert.equal(waiting.pending.reactionKind, "counterspell");
  assert.equal(f.state.combatRuntime.entities[ACTOR].resources["spellSlot:1"].current, "0");
  assert.equal(f.state.combatRuntime.entities[TARGET].hitPoints.current, "20");
  const duplicate = apply(f, completionInput(activity));
  assert.equal(duplicate.kind, "rejected");
  assert.deepEqual(duplicate.events, []);
  const countered = apply(f, { kind: "answerPendingInput", pendingInputId: waiting.pending.pendingInputId,
    responseId: "response:sustained:counterspell", answer: { kind: "useReaction", abilityRef: reactionRef, slotLevel: "3" } });
  assert.equal(countered.kind, "committed", JSON.stringify({ kind: countered.kind, rejection: countered.rejection }));
  assert.equal(countered.events.some(event => event.eventType === "SpellCountered"), true);
  assert.equal(f.state.combatRuntime.entities[TARGET].hitPoints.current, "20");
  assert.equal(f.state.combatRuntime.entities[ACTOR].resources["spellSlot:1"].current, "0");
  assert.equal(f.state.combatRuntime.entities[TARGET].resources["spellSlot:3"].current, "0");
  assert.equal(f.events.filter(event => event.eventType === "ResourceSpent" && event.payload.entityId === ACTOR).length, 1);
});
