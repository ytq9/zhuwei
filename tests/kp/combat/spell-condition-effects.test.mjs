import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as PEER, PROBE_SCENE as SCENE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';

// SPEC 0012 §§10.1、10.2: the conditions the spell catalog grants are carried
// out by Rules -- held by concentration, repeated saves at the end of the
// target's turn, and the acts that end them early. Real catalog spells,
// compiled and registered by the encounter, stepped and replayed.

const ENCOUNTER = 'encounter:spell-conditions';

function apply(f, input) {
  const result = f.runtime.step(f.profiles, f.state, input);
  if (result.events?.length) {
    f.events.push(...result.events);
    const replay = f.runtime.replay(f.genesis, f.events);
    assert.equal(replay.kind, 'replayed', JSON.stringify(replay));
    assert.deepEqual(replay.state, result.state);
    f.state = result.state;
  }
  return result;
}
// Initiative puts the caster first; every other die shows `faces[purpose]`
// for the first purpose key prefix that matches, else 2.
function settle(f, result, faces = {}) {
  const face = (request) => {
    if (request.purposeKey.startsWith('initiative:')) return request.purposeKey.includes(ACTOR) ? 20 : 2;
    const key = Object.keys(faces).find((prefix) => request.purposeKey.startsWith(prefix));
    return key === undefined ? 2 : faces[key];
  };
  while (result.kind === 'awaitingRandomness') result = apply(f, { kind: 'authoritativeRandomness',
    resolutionId: result.resolutionId, responseId: `authority:${result.resolutionId}`,
    continuationCapability: result.continuationCapability,
    randomnessResults: result.randomnessRequests.map((request) => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
      draws: request.dice.map((term) => ({ sides: Number(term.sides), faces: Array(Number(term.count)).fill(Math.min(Number(term.sides), face(request))) })) })),
  });
  return result;
}
function fixture(name) {
  const f = createAuthoredProbeFixture(name, { characterOverrides: { [ACTOR]: {
    classId: 'wizard', level: 3, cantripIds: ['fire-bolt'], preparedSpellIds: ['charm', 'hold-person', 'invisibility'],
    resources: { slot1: 4, slot2: 2 }, resourceMaximums: { slot1: 4, slot2: 2 },
    characterBuild: { classId: 'wizard', raceId: 'human', cantrips: ['fire-bolt'], prepared: ['charm', 'hold-person', 'invisibility'] },
  } } });
  f.events = [];
  const participants = [ACTOR, PEER];
  const opened = settle(f, apply(f, { kind: 'startEncounter', rootActionId: `root:${name}:encounter`, proposalAttemptId: `proposal:${name}:encounter`,
    encounterId: ENCOUNTER, sceneId: SCENE, participantEntityIds: participants, dynamicEntities: [], battlefieldFactIds: [],
    initiativeGroups: participants.map((id) => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [PEER] }, { fromEntityIds: [PEER], toEntityIds: [ACTOR] }] }));
  assert.equal(opened.kind, 'committed', JSON.stringify(opened));
  assert.equal(f.state.combatRuntime.encounters[ENCOUNTER].activeEntityId, ACTOR);
  return f;
}
const spell = (f, spellId, level) => Object.values(f.state.combatRuntime.definitions)
  .find((definition) => definition.sourceSpellId === spellId && definition.activation.spellLevel === String(level)).definitionId;
function cast(f, spellId, level, parameters, faces) {
  return settle(f, apply(f, { kind: 'invokeAbility', rootActionId: `root:cast:${f.events.length}`, sourceEntityId: ACTOR,
    abilityRef: spell(f, spellId, level), parameters }), faces);
}
function endTurn(f, id, faces) {
  return settle(f, apply(f, { kind: 'endTurn', rootActionId: `root:end-turn:${f.events.length}`, encounterId: ENCOUNTER, sourceEntityId: id }), faces);
}
const effectsOn = (f, id) => Object.values(f.state.combatRuntime.effects).filter((effect) => effect.targetEntityId === id);
const types = (result) => result.events.map((event) => event.eventType);

test('Hold Person paralyzes a target that fails, holds it by concentration, and the target saves again at the end of each of its turns', () => {
  const f = fixture('hold-person');
  const held = cast(f, 'hold-person', 2, { targetEntityId: PEER });
  assert.equal(held.kind, 'committed', JSON.stringify(held));
  const [paralysis] = effectsOn(f, PEER);
  assert.equal(paralysis.condition, 'paralyzed');
  assert.deepEqual(paralysis.lifecycle, { concentration: true, repeatSave: { edge: 'turnEnd', ability: 'wis', dc: 10 } });
  assert.equal(f.state.combatRuntime.entities[ACTOR].concentration.linkedEffects, true);
  assert.equal(f.state.entities[ACTOR].resources.slot2, 1);

  // The caster's turn ending asks nothing; the target's turn ending rolls its
  // Wisdom save once. A 2 fails and the paralysis holds.
  assert.deepEqual(types(endTurn(f, ACTOR)).filter((type) => type === 'EffectSaveRepeated'), []);
  const failed = endTurn(f, PEER, { 'save:repeat:': 2 });
  assert.equal(failed.kind, 'committed', JSON.stringify(failed));
  const [roll] = failed.events.filter((event) => event.eventType === 'EffectSaveRepeated').map((event) => event.payload);
  assert.deepEqual([roll.effectId, roll.ability, roll.dc, roll.total, roll.succeeded], [paralysis.effectId, 'wis', 10, 2, false]);
  assert.ok(f.state.combatRuntime.effects[paralysis.effectId]);
  assert.ok(types(failed).indexOf('TurnEnded') < types(failed).indexOf('EffectSaveRepeated'));
  assert.ok(types(failed).indexOf('EffectSaveRepeated') < types(failed).indexOf('RoundStarted'));
  assert.equal(f.state.combatRuntime.encounters[ENCOUNTER].activeEntityId, ACTOR);

  // A 20 succeeds: the paralysis ends, and with nothing left to hold the
  // caster's concentration ends too.
  endTurn(f, ACTOR);
  const freed = endTurn(f, PEER, { 'save:repeat:': 20 });
  assert.equal(freed.kind, 'committed', JSON.stringify(freed));
  assert.equal(f.state.combatRuntime.effects[paralysis.effectId], undefined);
  assert.deepEqual(freed.events.filter((event) => ['EffectEnded', 'ConcentrationEnded'].includes(event.eventType)).map((event) => event.payload.reason),
    ['repeatSaveSucceeded', 'spellEnded']);
  assert.equal(f.state.combatRuntime.entities[ACTOR].concentration, null);
});

test('Invisibility on the caster lasts until the caster attacks or casts a spell, and that attack is made unseen', () => {
  const f = fixture('invisibility');
  const hidden = cast(f, 'invisibility', 2, { targetEntityId: ACTOR });
  assert.equal(hidden.kind, 'committed', JSON.stringify(hidden));
  const [invisible] = effectsOn(f, ACTOR);
  assert.deepEqual([invisible.condition, invisible.lifecycle], ['invisible', { concentration: true, endsWhen: ['targetAttacksOrCasts'] }]);
  // No save, so nothing is repeated when the turns end.
  endTurn(f, ACTOR);
  assert.deepEqual(types(endTurn(f, PEER)).filter((type) => type === 'EffectSaveRepeated'), []);
  assert.ok(f.state.combatRuntime.effects[invisible.effectId]);

  const bolt = cast(f, 'fire-bolt', 0, { targetEntityId: PEER }, { 'attack:': 15 });
  assert.equal(bolt.kind, 'committed', JSON.stringify(bolt));
  const attack = bolt.events.find((event) => event.eventType === 'AbilityInvoked').payload.mechanicalResult.attack;
  assert.ok(attack.advantageReasons.includes('sourceInvisible2014'), JSON.stringify(attack));
  assert.equal(f.state.combatRuntime.effects[invisible.effectId], undefined);
  assert.deepEqual(bolt.events.filter((event) => ['EffectEnded', 'ConcentrationEnded'].includes(event.eventType)).map((event) => event.payload.reason),
    ['targetAttackedOrCast', 'spellEnded']);
});

test('a new concentration spell ends the conditions the earlier one held, and keeps its own', () => {
  const f = fixture('concentration-replaced');
  cast(f, 'hold-person', 2, { targetEntityId: PEER });
  const [paralysis] = effectsOn(f, PEER);
  endTurn(f, ACTOR);
  endTurn(f, PEER, { 'save:repeat:': 2 });
  const replaced = cast(f, 'invisibility', 2, { targetEntityId: ACTOR });
  assert.equal(replaced.kind, 'committed', JSON.stringify(replaced));
  assert.equal(f.state.combatRuntime.effects[paralysis.effectId], undefined);
  const ended = replaced.events.filter((event) => ['EffectEnded', 'ConcentrationEnded', 'ConcentrationStarted', 'EffectApplied'].includes(event.eventType))
    .map((event) => [event.eventType, event.payload.reason ?? event.payload.effect?.condition ?? event.payload.concentration?.abilityRef]);
  assert.deepEqual(ended, [['ConcentrationEnded', 'replacedByNewConcentration'], ['EffectEnded', 'concentrationEnded'],
    ['EffectApplied', 'invisible'], ['ConcentrationStarted', spell(f, 'invisibility', 2)]]);
  assert.deepEqual(effectsOn(f, ACTOR).map((effect) => effect.condition), ['invisible']);
  assert.equal(f.state.combatRuntime.entities[ACTOR].concentration.abilityRef, spell(f, 'invisibility', 2));
});

test('Charm Person is saved against with advantage in a fight and ends when the caster harms the charmed creature', () => {
  const f = fixture('charm-person');
  const charmed = cast(f, 'charm', 1, { targetEntityId: PEER });
  assert.equal(charmed.kind, 'committed', JSON.stringify(charmed));
  const save = charmed.events.find((event) => event.eventType === 'AbilityInvoked').payload.mechanicalResult.saves[PEER];
  assert.deepEqual([save.mode, save.rolls.length, save.success], ['advantage', 2, false]);
  const [charm] = effectsOn(f, PEER);
  assert.deepEqual([charm.condition, charm.sourceRef, charm.lifecycle], ['charmed', ACTOR, { endsWhen: ['harmedBySourceSide'] }]);
  assert.equal(f.state.combatRuntime.entities[ACTOR].concentration ?? null, null, 'Charm Person is not held by concentration');

  endTurn(f, ACTOR);
  endTurn(f, PEER);
  const bolt = cast(f, 'fire-bolt', 0, { targetEntityId: PEER }, { 'attack:': 15 });
  assert.equal(bolt.kind, 'committed', JSON.stringify(bolt));
  assert.equal(f.state.combatRuntime.effects[charm.effectId], undefined);
  assert.deepEqual(bolt.events.filter((event) => event.eventType === 'EffectEnded').map((event) => event.payload.reason), ['harmedBySourceSide']);
});
