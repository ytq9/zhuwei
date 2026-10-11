import assert from 'node:assert/strict';
import test from 'node:test';
import { conditionMechanics } from '../../../app/_runtime/lib/rules/v2/condition-mechanics.ts';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as PEER, PROBE_SCENE as SCENE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';

// SPEC 0012 §10.1 (SRD Fog Cloud, Silence): a zone fills a sphere around
// where it was cast, for the spell's duration and while its caster
// concentrates. Real catalog spells, stepped and replayed.

const ENCOUNTER = 'encounter:spell-zones';
const SPELLS = ['fog', 'silence', 'thunderwave'];
const CANTRIPS = ['fire-bolt'];

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
const caster = { classId: 'wizard', level: 3, cantripIds: CANTRIPS, preparedSpellIds: SPELLS,
  resources: { slot1: 4, slot2: 2 }, resourceMaximums: { slot1: 4, slot2: 2 },
  characterBuild: { classId: 'wizard', raceId: 'human', cantrips: CANTRIPS, prepared: SPELLS } };
function fixture(name, peerX, peer = {}) {
  const f = createAuthoredProbeFixture(name, { spawnPoints: [{ x: '100', y: '100', elevation: '0' }, { x: String(peerX), y: '100', elevation: '0' }],
    characterOverrides: { [ACTOR]: caster, [PEER]: peer } });
  f.events = [];
  const participants = [ACTOR, PEER];
  const opened = settle(f, apply(f, { kind: 'startEncounter', rootActionId: `root:${name}:encounter`, proposalAttemptId: `proposal:${name}:encounter`,
    encounterId: ENCOUNTER, sceneId: SCENE, participantEntityIds: participants, dynamicEntities: [], battlefieldFactIds: [],
    initiativeGroups: participants.map((id) => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [PEER] }, { fromEntityIds: [PEER], toEntityIds: [ACTOR] }] }));
  assert.equal(opened.kind, 'committed', JSON.stringify(opened));
  return f;
}
const spell = (f, spellId, level) => Object.values(f.state.combatRuntime.definitions)
  .find((definition) => definition.sourceSpellId === spellId && definition.activation.spellLevel === String(level)).definitionId;
function cast(f, spellId, level, parameters, faces) {
  return settle(f, apply(f, { kind: 'invokeAbility', rootActionId: `root:cast:${f.events.length}`, sourceEntityId: ACTOR,
    abilityRef: spell(f, spellId, level), parameters }), faces);
}
const zones = (f) => Object.values(f.state.combatRuntime.effects).filter((effect) => effect.kind === 'zone');
const point = (x) => ({ x: String(x), y: '100', elevation: '0' });

test('Fog Cloud fills a 20-foot sphere that blocks sight both ways, so attacks through it are even and no opportunity attack is drawn', () => {
  const armed = { loadout: { equipped: { main: 'mace' }, backpack: [], armorClass: 10, speedFeet: 30 } };
  // Without the fog, the armed peer is offered its opportunity attack.
  const plain = fixture('fog-cloud-control', 160, armed);
  const offered = apply(plain, { kind: 'moveCombatant', rootActionId: 'root:leave-control', encounterId: ENCOUNTER, sourceEntityId: ACTOR,
    movementMode: 'walk', path: [point(100), point(20)] });
  assert.equal(offered.kind, 'awaitingInput', JSON.stringify(offered));
  const f = fixture('fog-cloud', 160, armed);
  const fogged = cast(f, 'fog', 1, { areaOrigin: point(130) });
  assert.equal(fogged.kind, 'committed', JSON.stringify(fogged));
  const [fog] = zones(f);
  assert.deepEqual([fog.zone, fog.origin, fog.radiusInches, fog.lifecycle, fog.sourceRef],
    [{ kind: 'heavilyObscured' }, point(130), '240', { concentration: true }, ACTOR]);
  assert.equal(f.state.combatRuntime.entities[ACTOR].concentration.linkedEffects, true);
  // The map draws it from the same record (SPEC 0014 §§6、9.3).
  const [drawn] = f.runtime.project(f.profiles, f.state, f.viewer).tacticalProjection.knownZones;
  assert.deepEqual([drawn.id, drawn.effectTags, drawn.geometry.points.length, drawn.geometry.points[0], drawn.geometry.height],
    [fog.effectId, ['heavilyObscured'], 16, { x: '370', y: '100' }, '480']);
  // The armed peer cannot see the caster leave its reach.
  const left = apply(f, { kind: 'moveCombatant', rootActionId: 'root:leave-fog', encounterId: ENCOUNTER, sourceEntityId: ACTOR,
    movementMode: 'walk', path: [point(100), point(20)] });
  assert.equal(left.kind, 'committed', JSON.stringify(left));
  // Neither sees the other: the unseen attacker's advantage and the unseen
  // target's disadvantage cancel.
  settle(f, apply(f, { kind: 'endTurn', rootActionId: 'root:fog:end-1', encounterId: ENCOUNTER, sourceEntityId: ACTOR }));
  settle(f, apply(f, { kind: 'endTurn', rootActionId: 'root:fog:end-2', encounterId: ENCOUNTER, sourceEntityId: PEER }));
  const bolt = cast(f, 'fire-bolt', 0, { targetEntityId: PEER }, { 'attack:': 15 });
  assert.equal(bolt.kind, 'committed', JSON.stringify(bolt).slice(0, 600));
  const attack = bolt.events.find((event) => event.eventType === 'AbilityInvoked').payload.mechanicalResult.attack;
  assert.deepEqual([attack.mode, attack.advantageReasons.includes('attackerUnseenInObscurement2014'),
    attack.disadvantageReasons.includes('targetUnseenInObscurement2014')], ['normal', true, true]);
  // Ending the concentration clears the fog.
  const ended = apply(f, { kind: 'endConcentration', rootActionId: 'root:end-fog', sourceEntityId: ACTOR });
  assert.equal(ended.kind, 'committed', JSON.stringify(ended));
  assert.deepEqual(zones(f), []);
});

test('Silence deafens and protects from thunder a creature entirely inside, and stops a verbal spell cast from within', () => {
  // The peer stands 15 feet from the caster; the sphere is centred 15 feet
  // beyond it, so the peer is entirely inside and the caster is not.
  const f = fixture('silence', 280);
  const silenced = cast(f, 'silence', 2, { areaOrigin: point(460) });
  assert.equal(silenced.kind, 'committed', JSON.stringify(silenced));
  assert.deepEqual(zones(f).map((zone) => [zone.zone, zone.radiusInches]), [[{ kind: 'silence' }, '240']]);
  assert.equal(conditionMechanics(f.state, PEER).canHear, false);
  assert.equal(conditionMechanics(f.state, ACTOR).canHear, true);
  // Thunderwave catches the peer, which fails its save and takes nothing.
  const wave = settle(f, apply(f, { kind: 'endTurn', rootActionId: 'root:silence:end-1', encounterId: ENCOUNTER, sourceEntityId: ACTOR }));
  assert.equal(wave.kind, 'committed', JSON.stringify(wave));
  settle(f, apply(f, { kind: 'endTurn', rootActionId: 'root:silence:end-2', encounterId: ENCOUNTER, sourceEntityId: PEER }));
  const thunder = cast(f, 'thunderwave', 1, { areaOrigin: point(100), areaDirection: { x: '1', y: '0', elevation: '0' } }, { 'save:': 2, 'damage:': 8 });
  assert.equal(thunder.kind, 'committed', JSON.stringify(thunder));
  const packet = thunder.events.find((event) => event.eventType === 'DamagePacketResolved' && event.payload.targetEntityId === PEER).payload;
  assert.equal(packet.totalApplied, 0);
  assert.equal(f.state.entities[PEER].hitPoints.current, 20);
  // Standing in the sphere, the caster cannot cast a spell with a verbal component.
  const moved = apply(f, { kind: 'moveCombatant', rootActionId: 'root:silence:walk-in', encounterId: ENCOUNTER, sourceEntityId: ACTOR,
    movementMode: 'walk', path: [point(100), point(220)] });
  assert.equal(moved.kind, 'committed', JSON.stringify(moved));
  settle(f, apply(f, { kind: 'endTurn', rootActionId: 'root:silence:end-3', encounterId: ENCOUNTER, sourceEntityId: ACTOR }));
  settle(f, apply(f, { kind: 'endTurn', rootActionId: 'root:silence:end-4', encounterId: ENCOUNTER, sourceEntityId: PEER }));
  const refused = apply(f, { kind: 'invokeAbility', rootActionId: 'root:silence:bolt', sourceEntityId: ACTOR,
    abilityRef: spell(f, 'fire-bolt', 0), parameters: { targetEntityId: PEER } });
  assert.deepEqual([refused.kind, refused.rejection?.message], ['rejected', 'spell:verbal-component-silenced']);
});

// A cleric who knows Spiritual Weapon, 15 feet from the peer.
function clericFixture(name) {
  const cleric = { classId: 'cleric', level: 3, cantripIds: ['sacred-flame'], preparedSpellIds: ['spiritual'],
    resources: { slot1: 4, slot2: 2 }, resourceMaximums: { slot1: 4, slot2: 2 },
    characterBuild: { classId: 'cleric', raceId: 'human', cantrips: ['sacred-flame'], prepared: ['spiritual'] } };
  const f = createAuthoredProbeFixture(name, { spawnPoints: [{ x: '100', y: '100', elevation: '0' }, { x: '280', y: '100', elevation: '0' }],
    characterOverrides: { [ACTOR]: cleric } });
  f.events = [];
  const participants = [ACTOR, PEER];
  assert.equal(settle(f, apply(f, { kind: 'startEncounter', rootActionId: `root:${name}:encounter`, proposalAttemptId: `proposal:${name}:encounter`,
    encounterId: ENCOUNTER, sceneId: SCENE, participantEntityIds: participants, dynamicEntities: [], battlefieldFactIds: [],
    initiativeGroups: participants.map((id) => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [PEER] }, { fromEntityIds: [PEER], toEntityIds: [ACTOR] }] })).kind, 'committed');
  return f;
}
const listed = (f) => Object.keys(f.runtime.project(f.profiles, f.state, f.viewer).combatControls.abilities);

test('Spiritual Weapon strikes beside its target and grants a bonus-action strike from where the weapon is while it lasts', () => {
  const f = clericFixture('spiritual-weapon');
  const cast2 = spell(f, 'spiritual', 2);
  const strikeRef = `${cast2}:strike`;
  assert.equal(listed(f).includes(strikeRef), false, 'the strike is not offered before the weapon exists');
  const summoned = cast(f, 'spiritual', 2, { targetEntityId: PEER }, { 'attack:': 15 });
  assert.equal(summoned.kind, 'committed', JSON.stringify(summoned));
  const attack = summoned.events.find((event) => event.eventType === 'AbilityInvoked').payload.mechanicalResult.attack;
  // A melee spell attack from beside the target, not a ranged one.
  assert.equal(attack.disadvantageReasons.includes('hostileWithinFiveFeet2014'), false);
  const [weapon] = zones(f);
  assert.deepEqual([weapon.zone, weapon.origin, weapon.grants, weapon.lifecycle], [{ kind: 'spectralWeapon' }, point(280), [strikeRef], undefined]);
  assert.equal(listed(f).includes(strikeRef), true);

  // The peer steps 10 feet away; the weapon follows it and strikes again.
  settle(f, apply(f, { kind: 'endTurn', rootActionId: 'root:spiritual:end-1', encounterId: ENCOUNTER, sourceEntityId: ACTOR }));
  assert.equal(apply(f, { kind: 'moveCombatant', rootActionId: 'root:spiritual:peer-steps', encounterId: ENCOUNTER, sourceEntityId: PEER,
    movementMode: 'walk', path: [point(280), point(400)] }).kind, 'committed');
  settle(f, apply(f, { kind: 'endTurn', rootActionId: 'root:spiritual:end-2', encounterId: ENCOUNTER, sourceEntityId: PEER }));
  const strike = settle(f, apply(f, { kind: 'invokeAbility', rootActionId: 'root:spiritual:strike', sourceEntityId: ACTOR,
    abilityRef: strikeRef, parameters: { targetEntityId: PEER } }), { 'attack:': 15, 'damage:': 4 });
  assert.equal(strike.kind, 'committed', JSON.stringify(strike));
  assert.equal(f.state.combatRuntime.entities[ACTOR].turn.bonusAction, '0');
  assert.deepEqual(zones(f)[0].origin, point(400));
  assert.deepEqual(strike.events.filter((event) => event.eventType === 'EffectZoneMoved').map((event) => event.payload.origin), [point(400)]);

  // Ten rounds later the weapon is gone, and so is the strike.
  for (let round = 0; round < 10; round += 1) {
    settle(f, apply(f, { kind: 'endTurn', rootActionId: `root:spiritual:a${round}`, encounterId: ENCOUNTER, sourceEntityId: ACTOR }));
    settle(f, apply(f, { kind: 'endTurn', rootActionId: `root:spiritual:p${round}`, encounterId: ENCOUNTER, sourceEntityId: PEER }));
  }
  assert.deepEqual(zones(f), []);
  assert.equal(listed(f).includes(strikeRef), false);
  const refused = apply(f, { kind: 'invokeAbility', rootActionId: 'root:spiritual:late', sourceEntityId: ACTOR,
    abilityRef: strikeRef, parameters: { targetEntityId: PEER } });
  assert.equal(refused.kind, 'rejected');
});
