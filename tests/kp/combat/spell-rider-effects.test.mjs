import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as PEER, PROBE_SCENE as SCENE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';

// SPEC 0012 §10.1 (ADR 0158, SRD Ensnaring Strike): a rider set off by the
// caster's next weapon hit, a condition that hurts as each of its target's
// turns starts, and the action's check that frees the target. Real catalog
// spell and weapon, stepped and replayed.

const ENCOUNTER = 'encounter:spell-riders';

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
function settle(f, result, faces = {}) {
  const face = (request) => {
    if (request.purposeKey.startsWith('initiative:')) return request.purposeKey.includes(ACTOR) ? 20 : 2;
    const key = Object.keys(faces).filter((prefix) => request.purposeKey.startsWith(prefix)).sort((a, b) => b.length - a.length)[0];
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
// A ranger who knows Ensnaring Strike, a dagger in hand, beside the peer.
function fixture(name) {
  const ranger = { classId: 'ranger', level: 3, cantripIds: [], preparedSpellIds: ['ensnaring'],
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10 },
    resources: { slot1: 3 }, resourceMaximums: { slot1: 3 },
    characterBuild: { classId: 'ranger', raceId: 'human', cantrips: [], prepared: ['ensnaring'] },
    loadout: { equipped: { main: 'dagger' }, backpack: [], armorClass: 10, speedFeet: 30 } };
  const f = createAuthoredProbeFixture(name, { spawnPoints: [{ x: '100', y: '100', elevation: '0' }, { x: '160', y: '100', elevation: '0' }],
    characterOverrides: { [ACTOR]: ranger } });
  f.events = [];
  const participants = [ACTOR, PEER];
  assert.equal(settle(f, apply(f, { kind: 'startEncounter', rootActionId: `root:${name}:encounter`, proposalAttemptId: `proposal:${name}:encounter`,
    encounterId: ENCOUNTER, sceneId: SCENE, participantEntityIds: participants, dynamicEntities: [], battlefieldFactIds: [],
    initiativeGroups: participants.map((id) => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [PEER] }, { fromEntityIds: [PEER], toEntityIds: [ACTOR] }] })).kind, 'committed');
  return f;
}
const definitionRef = (f, predicate) => Object.values(f.state.combatRuntime.definitions).find(predicate).definitionId;
const effects = (f) => Object.values(f.state.combatRuntime.effects);
function ensnare(f) {
  const ref = definitionRef(f, (definition) => definition.sourceSpellId === 'ensnaring');
  return settle(f, apply(f, { kind: 'invokeAbility', rootActionId: `root:ensnare:${f.events.length}`, sourceEntityId: ACTOR,
    abilityRef: ref, parameters: { targetEntityId: ACTOR } }));
}
function stab(f, faces) {
  const dagger = definitionRef(f, (definition) => definition.weaponUse?.slot === 'main' && definition.weaponUse?.mode === 'melee'
    && !definition.weaponUse?.bonusAttack);
  return settle(f, apply(f, { kind: 'invokeAbility', rootActionId: `root:stab:${f.events.length}`, sourceEntityId: ACTOR,
    abilityRef: dagger, parameters: { targetEntityId: PEER } }), faces);
}
const endTurn = (f, id, faces) => settle(f, apply(f, { kind: 'endTurn', rootActionId: `root:end-turn:${f.events.length}`,
  encounterId: ENCOUNTER, sourceEntityId: id }), faces);
const peerView = (f) => f.runtime.project(f.profiles, f.state, { kind: 'player', principalId: 'principal:probe-target',
  seatId: 'seat:probe-target', sessionVersion: 1, characterId: PEER });

test('Ensnaring Strike restrains the creature its next weapon hit catches, hurts it as its turns start, and an action frees it', () => {
  const f = fixture('ensnaring-strike');
  assert.equal(ensnare(f).kind, 'committed');
  const [rider] = effects(f);
  assert.deepEqual([rider.targetEntityId, rider.modifier, rider.lifecycle],
    [ACTOR, { kind: 'weaponHitRider', save: 'str', largerSaveAdvantage: true }, { concentration: true }]);
  // A miss leaves the rider for the next hit.
  stab(f, { 'attack:': 2 });
  assert.ok(f.state.combatRuntime.effects[rider.effectId]);
  endTurn(f, ACTOR);
  endTurn(f, PEER);
  // The hit sets it off; a Strength save of 2 fails against DC 12.
  const caught = stab(f, { 'attack:': 15, 'save:rider:': 2, 'damage:': 2 });
  assert.equal(caught.kind, 'committed', JSON.stringify(caught));
  assert.equal(f.state.combatRuntime.effects[rider.effectId], undefined);
  const [vines] = effects(f);
  assert.deepEqual([vines.targetEntityId, vines.condition, vines.lifecycle],
    [PEER, 'restrained', { concentration: true, turnStartDamage: { formula: '1d6', type: 'piercing' }, escape: { ability: 'str', dc: 12 } }]);
  assert.equal(f.state.combatRuntime.entities[ACTOR].concentration.linkedEffects, true);
  assert.equal(f.state.entities[PEER].hitPoints.current, 18);
  // Its turn starts with 1d6 piercing.
  const hurt = endTurn(f, ACTOR, { 'damage:turn-start:': 4 });
  assert.equal(hurt.kind, 'committed', JSON.stringify(hurt));
  assert.equal(f.state.entities[PEER].hitPoints.current, 14);
  assert.ok(hurt.events.findIndex((event) => event.eventType === 'TurnStarted') < hurt.events.findIndex((event) => event.eventType === 'DamagePacketResolved'));
  // The held creature is offered the action to free itself, and takes it.
  assert.deepEqual(peerView(f).combatControls.offers.breakFree, { targetRefs: [PEER] });
  const freed = settle(f, apply(f, { kind: 'invokeAbility', rootActionId: 'root:break-free', sourceEntityId: PEER,
    abilityRef: 'action:break-free', parameters: { targetEntityId: PEER } }), { 'check:break-free:': 15 });
  assert.equal(freed.kind, 'committed', JSON.stringify(freed));
  assert.deepEqual(effects(f), []);
  assert.equal(f.state.combatRuntime.entities[ACTOR].concentration, null);
  assert.deepEqual(freed.events.filter((event) => ['EffectEnded', 'ConcentrationEnded'].includes(event.eventType)).map((event) => event.payload.reason),
    ['brokenFree', 'spellEnded']);
  assert.equal(peerView(f).combatControls.offers.breakFree, null);
});

test('a target that makes its save against Ensnaring Strike shrugs off the vines and the spell ends', () => {
  const f = fixture('ensnaring-strike-saved');
  ensnare(f);
  const saved = stab(f, { 'attack:': 15, 'save:rider:': 20 });
  assert.equal(saved.kind, 'committed', JSON.stringify(saved));
  assert.deepEqual(effects(f), []);
  assert.equal(f.state.combatRuntime.entities[ACTOR].concentration, null);
  assert.deepEqual(saved.events.filter((event) => ['EffectEnded', 'ConcentrationEnded'].includes(event.eventType)).map((event) => event.payload.reason),
    ['riderTriggered', 'spellEnded']);
});
