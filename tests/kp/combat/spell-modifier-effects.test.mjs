import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSha256 } from '../../../app/_runtime/lib/rules/profiles/canonical.ts';
import { registeredAbilityRecord } from '../../../app/_runtime/lib/rules/profiles/ability-compiler.ts';
import { buildPlayerCombatEntity, planPlayerAbilityCatalog, synchronizePlayerCombatEntity } from '../../../app/_runtime/lib/rules/v2/character-abilities.ts';
import { conditionSpeed } from '../../../app/_runtime/lib/rules/v2/condition-mechanics.ts';
import { hashWorldState } from '../../../app/_runtime/lib/rules/v2/validation.ts';
import { authorityRevisionOrHash } from '../../../app/_runtime/lib/rules/v2/authority-bindings.ts';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as PEER, PROBE_SCENE as SCENE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';

// SPEC 0012 §10.1: the modifiers the spell catalog grants change the target's
// effective values -- armor class, speed, reactions, the next attack against
// it, its hit point maximum -- through the same functions mechanics and
// projection read. Real catalog spells, stepped and replayed.

const ENCOUNTER = 'encounter:spell-modifiers';
const SPELLS = ['aid', 'guiding-bolt', 'mage-armor', 'shield-faith'];
const CANTRIPS = ['fire-bolt', 'ray-frost', 'shocking'];

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
// The two stand side by side, so a touch spell reaches; `apart` puts them
// 15 feet apart, so a ranged attack is not made within 5 feet of a foe.
function fixture(name, peer = {}, apart = false) {
  const f = createAuthoredProbeFixture(name, { spawnPoints: [{ x: '100', y: '100', elevation: '0' }, { x: apart ? '280' : '160', y: '100', elevation: '0' }],
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
function endTurn(f, id, faces) {
  return settle(f, apply(f, { kind: 'endTurn', rootActionId: `root:end-turn:${f.events.length}`, encounterId: ENCOUNTER, sourceEntityId: id }), faces);
}
const effectsOn = (f, id) => Object.values(f.state.combatRuntime.effects).filter((effect) => effect.targetEntityId === id);
const invoked = (result) => result.events.find((event) => event.eventType === 'AbilityInvoked').payload.mechanicalResult;

test('Shield of Faith adds 2 to the armor class an attack is rolled against while its caster concentrates', () => {
  const f = fixture('shield-of-faith');
  const shielded = cast(f, 'shield-faith', 1, { targetEntityId: PEER });
  assert.equal(shielded.kind, 'committed', JSON.stringify(shielded));
  assert.deepEqual(effectsOn(f, PEER).map((effect) => [effect.kind, effect.modifier, effect.lifecycle]),
    [['modifier', { kind: 'armorClassBonus', amount: 2 }, { concentration: true }]]);
  // A bonus-action spell still leaves the action for a cantrip: 9 + 2 = 11
  // reaches the bare armor class of 10 but not 12.
  const bolt = cast(f, 'fire-bolt', 0, { targetEntityId: PEER }, { 'attack:': 9 });
  assert.deepEqual([invoked(bolt).attack.effectiveArmorClass, invoked(bolt).attack.hit], [12, false]);
  const ended = apply(f, { kind: 'endConcentration', rootActionId: `root:end-concentration`, sourceEntityId: ACTOR });
  assert.equal(ended.kind, 'committed', JSON.stringify(ended));
  assert.deepEqual(effectsOn(f, PEER), []);
  endTurn(f, ACTOR);
  endTurn(f, PEER);
  const again = cast(f, 'fire-bolt', 0, { targetEntityId: PEER }, { 'attack:': 9 });
  assert.deepEqual([invoked(again).attack.effectiveArmorClass, invoked(again).attack.hit], [10, true]);
});

test('Mage Armor sets an unarmored target\'s base armor class to 13 plus Dexterity and is refused on one wearing armor', () => {
  const f = fixture('mage-armor');
  const armored = cast(f, 'mage-armor', 1, { targetEntityId: PEER });
  assert.equal(armored.kind, 'committed', JSON.stringify(armored));
  assert.deepEqual(effectsOn(f, PEER).map((effect) => [effect.modifier, effect.lifecycle]),
    [[{ kind: 'unarmoredArmorClass', base: 13 }, { endsWhen: ['targetDonsArmor'] }]]);
  // The target's own panel reads the same armor class (SPEC 0012 §10.1).
  const peerView = f.runtime.project(f.profiles, f.state, { kind: 'player', principalId: 'principal:probe-target',
    seatId: 'seat:probe-target', sessionVersion: 1, characterId: PEER });
  assert.equal(peerView.combatControls.vitals.armorClass, '13');
  endTurn(f, ACTOR);
  endTurn(f, PEER);
  const bolt = cast(f, 'fire-bolt', 0, { targetEntityId: PEER }, { 'attack:': 10 });
  assert.deepEqual([invoked(bolt).attack.effectiveArmorClass, invoked(bolt).attack.hit], [13, false]);

  const leather = fixture('mage-armor-on-leather', { loadout: { equipped: { armor: 'leather' }, backpack: [], armorClass: 11, speedFeet: 30 } });
  const refused = apply(leather, { kind: 'invokeAbility', rootActionId: 'root:mage-armor-on-leather', sourceEntityId: ACTOR,
    abilityRef: spell(leather, 'mage-armor', 1), parameters: { targetEntityId: PEER } });
  assert.deepEqual([refused.kind, refused.rejection?.message], ['rejected', 'The target wears armor.']);
  assert.equal(leather.state.entities[ACTOR].resources.slot1, 4);
});

test('Ray of Frost takes 10 feet off the target\'s speed until the caster\'s next turn starts', () => {
  const f = fixture('ray-of-frost');
  const walk = () => conditionSpeed(f.state, PEER, f.state.combatRuntime.entities[PEER].speedInches.walk).speed;
  assert.equal(walk(), '360');
  const frozen = cast(f, 'ray-frost', 0, { targetEntityId: PEER }, { 'attack:': 15 });
  assert.equal(invoked(frozen).attack.hit, true);
  assert.deepEqual(effectsOn(f, PEER).map((effect) => [effect.modifier, effect.duration]),
    [[{ kind: 'speedBonus', feet: -10 }, { kind: 'turnBoundary', subject: 'source', edge: 'turnStart' }]]);
  assert.equal(walk(), '240');
  endTurn(f, ACTOR);
  assert.equal(walk(), '240', 'it still holds on the target\'s own turn');
  endTurn(f, PEER);
  assert.deepEqual(effectsOn(f, PEER), []);
  assert.equal(walk(), '360');
});

test('Shocking Grasp leaves the target no reaction, so moving away from it draws no opportunity attack', () => {
  // Without the spell, the armed peer is offered its opportunity attack.
  const plain = fixture('shocking-grasp-control', { loadout: { equipped: { main: 'mace' }, backpack: [], armorClass: 10, speedFeet: 30 } });
  const offered = apply(plain, { kind: 'moveCombatant', rootActionId: 'root:leave-control', encounterId: ENCOUNTER, sourceEntityId: ACTOR,
    movementMode: 'walk', path: [{ x: '100', y: '100', elevation: '0' }, { x: '20', y: '100', elevation: '0' }] });
  assert.equal(offered.kind, 'awaitingInput', JSON.stringify(offered));

  const f = fixture('shocking-grasp', { loadout: { equipped: { main: 'mace' }, backpack: [], armorClass: 10, speedFeet: 30 } });
  const grasp = cast(f, 'shocking', 0, { targetEntityId: PEER }, { 'attack:': 15 });
  assert.equal(invoked(grasp).attack.hit, true);
  assert.deepEqual(effectsOn(f, PEER).map((effect) => [effect.modifier, effect.duration]),
    [[{ kind: 'noReactions' }, { kind: 'turnBoundary', subject: 'target', edge: 'turnStart' }]]);
  const left = apply(f, { kind: 'moveCombatant', rootActionId: 'root:leave', encounterId: ENCOUNTER, sourceEntityId: ACTOR,
    movementMode: 'walk', path: [{ x: '100', y: '100', elevation: '0' }, { x: '20', y: '100', elevation: '0' }] });
  assert.equal(left.kind, 'committed', JSON.stringify(left));
  // The target's own turn start ends it.
  endTurn(f, ACTOR);
  assert.deepEqual(effectsOn(f, PEER), []);
});

test('Guiding Bolt gives the next attack roll against the target advantage, and that roll uses it up', () => {
  const f = fixture('guiding-bolt', {}, true);
  const bolt = cast(f, 'guiding-bolt', 1, { targetEntityId: PEER }, { 'attack:': 15 });
  assert.equal(invoked(bolt).attack.hit, true);
  assert.deepEqual(effectsOn(f, PEER).map((effect) => [effect.modifier, effect.duration, effect.lifecycle]),
    [[{ kind: 'advantageOnNextAttackAgainst' }, { kind: 'turnBoundary', subject: 'source', edge: 'turnEnd' }, { endsWhen: ['targetAttacked'] }]]);
  endTurn(f, ACTOR);
  endTurn(f, PEER);
  const next = cast(f, 'fire-bolt', 0, { targetEntityId: PEER }, { 'attack:': 3 });
  assert.ok(invoked(next).attack.advantageReasons.includes('markedForNextAttack2014'), JSON.stringify(invoked(next).attack));
  assert.equal(invoked(next).attack.mode, 'advantage');
  assert.deepEqual(effectsOn(f, PEER), []);
  assert.deepEqual(next.events.filter((event) => event.eventType === 'EffectEnded').map((event) => event.payload.reason), ['targetAttacked']);
});

// Outside an encounter: the catalog registered as a character sheet sync
// would, then eight hours of fiction time.
function quietFixture(name, actorOverrides = {}) {
  const f = createAuthoredProbeFixture(name, { characterOverrides: { [ACTOR]: actorOverrides } });
  const state = structuredClone(f.state), actor = state.entities[ACTOR];
  Object.assign(actor, caster);
  const plan = planPlayerAbilityCatalog({ character: actor, itemSystem: state.campaignRuntime.itemSystem, catalog: state.combatRuntime.definitions });
  assert.equal(plan.error, undefined, JSON.stringify(plan));
  for (const artifact of plan.registrations) state.combatRuntime.definitions[artifact.definition.definitionId] = registeredAbilityRecord(artifact);
  state.combatRuntime.entities[ACTOR] = synchronizePlayerCombatEntity(state.combatRuntime.entities[ACTOR],
    buildPlayerCombatEntity(f.profiles, actor, plan.compiled, 'principal:probe-actor', undefined, state.campaignRuntime.itemSystem));
  delete state.combatRuntime.entities[ACTOR].turn;
  const genesis = { ...f.genesis, initialState: state, initialStateHash: hashWorldState(state) };
  delete genesis.genesisHash;
  genesis.genesisHash = canonicalSha256(genesis);
  const replay = f.runtime.replay(genesis, []);
  assert.equal(replay.kind, 'replayed');
  return { ...f, genesis, state: replay.state, events: [] };
}

test('Aid raises the hit point maximum and current hit points of each target, and its end takes the raise back', () => {
  const f = quietFixture('aid');
  const raised = cast(f, 'aid', 2, { targetEntityIds: [ACTOR, PEER] });
  assert.equal(raised.kind, 'committed', JSON.stringify(raised));
  assert.deepEqual([f.state.entities[ACTOR].hitPoints, f.state.entities[PEER].hitPoints],
    [{ current: 15, maximum: 25 }, { current: 25, maximum: 25 }]);
  assert.deepEqual([f.state.combatRuntime.entities[ACTOR].hitPoints.maximum, f.state.combatRuntime.entities[ACTOR].unconditionedHitPointMaximum],
    ['25', 20]);
  const waited = apply(f, { kind: 'resolveFreeAction', proposalId: 'root:aid:wait', characterId: PEER,
    goal: '等待援助术结束', method: '在原地等待', feasibility: { kind: 'directSuccess', publicBasis: '没有中断。' },
    outcome: { publicResult: '等待结束。', fictionTimeCostMicros: (8n * 3_600_000_000n).toString() } });
  assert.equal(waited.kind, 'committed', JSON.stringify(waited));
  assert.deepEqual([f.state.entities[ACTOR].hitPoints, f.state.entities[PEER].hitPoints],
    [{ current: 15, maximum: 20 }, { current: 20, maximum: 20 }]);
  assert.equal(f.state.combatRuntime.entities[ACTOR].unconditionedHitPointMaximum, undefined);
});

test('Mage Armor ends once its target puts on armor', () => {
  const f = quietFixture('mage-armor-donned', { loadout: { equipped: {}, backpack: [{ itemId: 'leather', quantity: 1 }], armorClass: 10, speedFeet: 30 } });
  const armored = cast(f, 'mage-armor', 1, { targetEntityId: ACTOR });
  assert.equal(armored.kind, 'committed', JSON.stringify(armored));
  const [mageArmor] = effectsOn(f, ACTOR);
  assert.deepEqual(mageArmor.modifier, { kind: 'unarmoredArmorClass', base: 13 });
  const entryRef = Object.values(f.state.campaignRuntime.itemSystem.entries).find((entry) => entry.holderRef === ACTOR
    && f.state.campaignRuntime.itemSystem.definitions[entry.definitionRef]?.content.equipment?.armor?.kind === 'light').entryId;
  const refs = [ACTOR, SCENE, entryRef];
  const worn = apply(f, { kind: 'inventoryOperation', rootActionId: 'root:mage-armor-donned:wear', actorCharacterId: ACTOR,
    plan: { schema: 'zhuwei.inventory-operation-plan/vnext-1', contextHash: canonicalSha256(refs),
      readSet: refs.map((ref) => ({ ref, revisionOrHash: authorityRevisionOrHash(f.state, ref) })),
      basisRefs: [entryRef], summary: '穿上皮甲。', operation: { kind: 'equip', entryRef, action: 'wear', slot: 'armor' } } });
  assert.equal(worn.kind, 'committed', JSON.stringify(worn));
  assert.equal(f.state.combatRuntime.effects[mageArmor.effectId], undefined);
  assert.deepEqual(worn.events.filter((event) => event.eventType === 'EffectEnded').map((event) => event.payload.reason), ['targetDonnedArmor']);
});
