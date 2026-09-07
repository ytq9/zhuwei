import assert from "node:assert/strict";
import test from "node:test";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import { registeredAbilityRecord } from "../app/_runtime/lib/rules/profiles/ability-compiler.ts";
import { buildPlayerCombatEntity, planPlayerAbilityCatalog, synchronizePlayerCombatEntity } from "../app/_runtime/lib/rules/v2/character-abilities.ts";
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as OTHER } from "../tools/lib/vnext-authored-probe-fixture.mjs";

function fixture(spellId, { cantrip = false } = {}) {
  const f = createAuthoredProbeFixture(`registered-execution:${spellId}`);
  const state = structuredClone(f.state), actor = state.entities[ACTOR];
  Object.assign(actor, { classId: "cleric", level: 3,
    preparedSpellIds: cantrip ? [] : [spellId], cantripIds: cantrip ? [spellId] : [],
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10 },
    resources: { slot1: 4, slot2: 2 }, resourceMaximums: { slot1: 4, slot2: 2 } });
  // The world is an isolated test fixture; every tested spell definition comes
  // from the actual character/catalog registration path, without effect edits.
  const plan = planPlayerAbilityCatalog({ character: actor,
    itemSystem: state.campaignRuntime.itemSystem, catalog: state.combatRuntime.definitions });
  assert.equal(plan.error, undefined, JSON.stringify(plan));
  for (const artifact of plan.registrations) {
    state.combatRuntime.definitions[artifact.definition.definitionId] = registeredAbilityRecord(artifact);
  }
  const abilityRef = plan.compiled.abilityRefs.find(ref => plan.compiled.definitions[ref]?.sourceSpellId === spellId);
  assert.ok(abilityRef, `The real ${spellId} catalog entry must be registered for this test.`);
  state.combatRuntime.entities[ACTOR] = synchronizePlayerCombatEntity(state.combatRuntime.entities[ACTOR],
    buildPlayerCombatEntity(f.profiles, actor, plan.compiled, "principal:probe-actor", undefined,
      state.campaignRuntime.itemSystem));
  delete state.combatRuntime.entities[ACTOR].turn;
  const body = { ...state };
  delete body.eventHeadHash;
  delete body.lastEventId;
  const initialStateHash = canonicalSha256(body);
  state.eventHeadHash = initialStateHash;
  const genesis = { ...f.genesis, initialState: state, initialStateHash };
  delete genesis.genesisHash;
  genesis.genesisHash = canonicalSha256(genesis);
  const replay = f.runtime.replay(genesis, []);
  assert.equal(replay.kind, "replayed");
  return { ...f, genesis, state: replay.state, abilityRef };
}

function invoke(f, parameters) {
  return f.runtime.step(f.profiles, f.state, { kind: "invokeAbility", rootActionId: f.rootActionId,
    sourceEntityId: ACTOR, abilityRef: f.abilityRef, parameters });
}

for (const scenario of [
  { spellId: "guidance", cantrip: true, parameters: { targetEntityId: ACTOR } },
  { spellId: "silence", parameters: { areaOrigin: { x: "100", y: "100", elevation: "0" } } },
  { spellId: "silence", ritual: true,
    parameters: { ritual: true, areaOrigin: { x: "100", y: "100", elevation: "0" } } },
  { spellId: "guiding-bolt", parameters: { targetEntityId: OTHER } },
]) {
  test(`registered ${scenario.spellId}${scenario.ritual ? " ritual" : ""} refuses missing effect execution before any cost, die, or success`, () => {
    const f = fixture(scenario.spellId, scenario), before = structuredClone(f.state);
    const result = invoke(f, scenario.parameters);
    assert.equal(result.kind, "rejected", JSON.stringify({ kind: result.kind, rejection: result.rejection }));
    assert.equal(result.rejection.code, "unsupportedOperation");
    assert.deepEqual(result.events, []);
    assert.equal(result.randomnessRequests, undefined);
    assert.equal(result.pending, undefined);
    assert.deepEqual(f.state, before, "No resources, concentration, activity, or authoritative state may change.");
  });
}

test("registered cure still pays one slot, rolls once, applies healing, and replays exactly", () => {
  const f = fixture("cure");
  const waiting = invoke(f, { targetEntityId: ACTOR });
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  assert.equal(waiting.randomnessRequests.length, 1);
  assert.equal(waiting.randomnessRequests[0].purposeKey, `healing:${f.abilityRef}`);
  assert.equal(waiting.state.combatRuntime.entities[ACTOR].resources["spellSlot:1"].current, "3");
  assert.equal(waiting.state.combatRuntime.entities[ACTOR].hitPoints.current, "10");
  const done = f.runtime.step(f.profiles, waiting.state, { kind: "authoritativeRandomness",
    resolutionId: waiting.resolutionId, responseId: `authority:${waiting.resolutionId}`,
    continuationCapability: waiting.continuationCapability,
    randomnessResults: waiting.randomnessRequests.map(request => ({ randomnessId: request.randomnessId,
      requestHash: request.requestHash, draws: request.dice.map(term => ({ sides: Number(term.sides),
        faces: Array.from({ length: Number(term.count) }, () => 4) })) })) });
  assert.equal(done.kind, "committed", JSON.stringify(done));
  assert.equal(done.state.combatRuntime.entities[ACTOR].hitPoints.current, "16");
  assert.equal(done.state.combatRuntime.entities[ACTOR].resources["spellSlot:1"].current, "3");
  const events = [...waiting.events, ...done.events];
  assert.equal(events.filter(event => event.eventType === "ResourceSpent").length, 1);
  assert.equal(events.filter(event => event.eventType === "HealingResolved").length, 1);
  assert.equal(events.filter(event => event.eventType === "SpellResolved").length, 1);
  const replay = f.runtime.replay(f.genesis, events);
  assert.equal(replay.kind, "replayed");
  assert.deepEqual(replay.state, done.state);
});
