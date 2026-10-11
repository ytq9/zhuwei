import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSha256 } from '../../../app/_runtime/lib/rules/profiles/canonical.ts';
import { registeredAbilityRecord } from '../../../app/_runtime/lib/rules/profiles/ability-compiler.ts';
import { buildPlayerCombatEntity, planPlayerAbilityCatalog, synchronizePlayerCombatEntity } from '../../../app/_runtime/lib/rules/v2/character-abilities.ts';
import { deriveAuthorityClaimsFromCommittedRange } from '../../../app/_runtime/lib/rules/v2/claims.ts';
import { hashWorldState } from '../../../app/_runtime/lib/rules/v2/validation.ts';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as PEER, PROBE_SCENE as SCENE, PROBE_SOURCE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';

// SPEC 0012 §10.1 (SRD Bless, Guidance): a bonus die from an effect is asked
// for with the d20 roll it adds to, under `<purpose>:bonus`, and counts in its
// total; a die that lasts one roll is spent as that roll is asked for.

const ENCOUNTER = 'encounter:bonus-dice';
const SPELLS = ['bless', 'charm'];
const CANTRIPS = ['fire-bolt', 'guidance'];

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
// Faces by purpose-key prefix; the longest matching prefix wins. Initiative
// puts the caster first unless a face is given for it.
function settle(f, result, faces = {}, requests = []) {
  const face = (request) => {
    const key = Object.keys(faces).filter((prefix) => request.purposeKey.startsWith(prefix)).sort((a, b) => b.length - a.length)[0];
    if (key !== undefined) return faces[key];
    if (request.purposeKey.startsWith('initiative:')) return request.purposeKey.includes(ACTOR) ? 20 : 2;
    return 2;
  };
  while (result.kind === 'awaitingRandomness') {
    requests.push(...result.randomnessRequests);
    result = apply(f, { kind: 'authoritativeRandomness',
      resolutionId: result.resolutionId, responseId: `authority:${result.resolutionId}`,
      continuationCapability: result.continuationCapability,
      randomnessResults: result.randomnessRequests.map((request) => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
        draws: request.dice.map((term) => ({ sides: Number(term.sides), faces: Array(Number(term.count)).fill(Math.min(Number(term.sides), face(request))) })) })) });
  }
  return result;
}
const caster = { classId: 'cleric', level: 3, cantripIds: CANTRIPS, preparedSpellIds: SPELLS,
  resources: { slot1: 4, slot2: 2 }, resourceMaximums: { slot1: 4, slot2: 2 },
  characterBuild: { classId: 'cleric', raceId: 'human', cantrips: CANTRIPS, prepared: SPELLS } };
function startEncounter(f, faces, requests) {
  const participants = [ACTOR, PEER];
  return settle(f, apply(f, { kind: 'startEncounter', rootActionId: 'root:bonus-dice:encounter', proposalAttemptId: 'proposal:bonus-dice:encounter',
    encounterId: ENCOUNTER, sceneId: SCENE, participantEntityIds: participants, dynamicEntities: [], battlefieldFactIds: [],
    initiativeGroups: participants.map((id) => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [PEER] }, { fromEntityIds: [PEER], toEntityIds: [ACTOR] }] }), faces, requests);
}
// Outside an encounter: the catalog registered as a character sheet sync would.
function quietFixture(name) {
  const f = createAuthoredProbeFixture(name, { spawnPoints: [{ x: '100', y: '100', elevation: '0' }, { x: '280', y: '100', elevation: '0' }] });
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
const spell = (f, spellId, level) => Object.values(f.state.combatRuntime.definitions)
  .find((definition) => definition.sourceSpellId === spellId && definition.activation.spellLevel === String(level)).definitionId;
function cast(f, spellId, level, parameters, faces, requests) {
  return settle(f, apply(f, { kind: 'invokeAbility', rootActionId: `root:cast:${f.events.length}`, sourceEntityId: ACTOR,
    abilityRef: spell(f, spellId, level), parameters }), faces, requests);
}
function endTurn(f, id) {
  return settle(f, apply(f, { kind: 'endTurn', rootActionId: `root:end-turn:${f.events.length}`, encounterId: ENCOUNTER, sourceEntityId: id }));
}
const invoked = (result) => result.events.find((event) => event.eventType === 'AbilityInvoked').payload.mechanicalResult;

test('Bless adds a d4 to its targets\' attack rolls and saving throws, so a miss by the bare roll can hit and a save can hold', () => {
  const f = quietFixture('bless');
  assert.equal(startEncounter(f).kind, 'committed');
  const blessed = cast(f, 'bless', 1, { targetEntityIds: [ACTOR, PEER] });
  assert.equal(blessed.kind, 'committed', JSON.stringify(blessed));
  assert.deepEqual(Object.values(f.state.combatRuntime.effects).map((effect) => [effect.targetEntityId, effect.modifier]).sort(),
    [[ACTOR, { kind: 'd20BonusDie', sides: 4, rolls: ['attack', 'save'] }], [PEER, { kind: 'd20BonusDie', sides: 4, rolls: ['attack', 'save'] }]]);
  endTurn(f, ACTOR);
  endTurn(f, PEER);
  // 7 + 2 misses armor class 10; the d4 showing 4 makes it 13.
  const requests = [];
  const bolt = cast(f, 'fire-bolt', 0, { targetEntityId: PEER }, { 'attack:': 7 }, requests);
  const attack = invoked(bolt).attack;
  assert.deepEqual([attack.selected, attack.bonusDie, attack.total, attack.hit], [7, 4, 13, true]);
  const bonus = requests.find((request) => request.purposeKey.endsWith(':bonus'));
  assert.deepEqual([bonus.diceExpression, bonus.frozenParameters.entityId, bonus.frozenParameters.roll], ['1d4', ACTOR, 'attack']);
  // The blessed peer's Wisdom save: 7 + 0 fails DC 10, the d4 makes it 11.
  endTurn(f, ACTOR);
  endTurn(f, PEER);
  const charm = cast(f, 'charm', 1, { targetEntityId: PEER }, { 'save:': 7 });
  const save = invoked(charm).saves[PEER];
  assert.deepEqual([save.roll, save.bonusDie, save.total, save.dc, save.success], [7, 4, 11, 10, true]);
  assert.deepEqual(Object.values(f.state.combatRuntime.effects).filter((effect) => effect.condition === 'charmed'), []);
});

test('Guidance adds a d4 to the target\'s next ability check -- here the initiative roll -- and is spent by it', () => {
  const f = quietFixture('guidance');
  const guided = cast(f, 'guidance', 0, { targetEntityId: ACTOR });
  assert.equal(guided.kind, 'committed', JSON.stringify(guided));
  const [guidance] = Object.values(f.state.combatRuntime.effects);
  assert.deepEqual([guidance.modifier, guidance.lifecycle], [{ kind: 'd20BonusDie', sides: 4, rolls: ['check'] }, { concentration: true, endsWhen: ['bonusDieUsed'] }]);
  const requests = [];
  const opened = startEncounter(f, { [`initiative:${ACTOR}`]: 10, [`initiative:${PEER}`]: 13 }, requests);
  assert.equal(opened.kind, 'committed', JSON.stringify(opened));
  assert.ok(requests.some((request) => request.purposeKey === `initiative:${ACTOR}:bonus`), JSON.stringify(requests.map((request) => request.purposeKey)));
  // 10 + 0 + 4 beats the peer's 13.
  assert.equal(f.state.combatRuntime.encounters[ENCOUNTER].activeEntityId, ACTOR);
  assert.equal(f.state.combatRuntime.effects[guidance.effectId], undefined);
  assert.equal(f.state.combatRuntime.entities[ACTOR].concentration, null);
  assert.deepEqual(f.events.filter((event) => ['EffectEnded', 'ConcentrationEnded'].includes(event.eventType)).map((event) => event.payload.reason),
    ['bonusDieUsed', 'spellEnded']);
});

// A ranger who knows Hunter's Mark, side by side with the peer, a dagger in hand.
function rangerFixture(name) {
  const ranger = { classId: 'ranger', level: 3, cantripIds: [], preparedSpellIds: ['hunters-mark'],
    resources: { slot1: 3 }, resourceMaximums: { slot1: 3 },
    characterBuild: { classId: 'ranger', raceId: 'human', cantrips: [], prepared: ['hunters-mark'] },
    loadout: { equipped: { main: 'dagger' }, backpack: [], armorClass: 10, speedFeet: 30 } };
  const f = createAuthoredProbeFixture(name, { spawnPoints: [{ x: '100', y: '100', elevation: '0' }, { x: '160', y: '100', elevation: '0' }],
    characterOverrides: { [ACTOR]: ranger } });
  f.events = [];
  assert.equal(startEncounter(f).kind, 'committed');
  return f;
}

test('Hunter\'s Mark adds a d6 of the weapon\'s damage type to the caster\'s weapon hits on the marked creature', () => {
  const f = rangerFixture('hunters-mark');
  const marked = cast(f, 'hunters-mark', 1, { targetEntityId: PEER });
  assert.equal(marked.kind, 'committed', JSON.stringify(marked));
  const [mark] = Object.values(f.state.combatRuntime.effects);
  assert.deepEqual([mark.targetEntityId, mark.sourceRef, mark.modifier, mark.lifecycle],
    [PEER, ACTOR, { kind: 'weaponDamageDieFromSource', sides: 6 }, { concentration: true }]);
  const dagger = Object.values(f.state.combatRuntime.definitions).find((definition) => definition.weaponUse?.slot === 'main'
    && definition.weaponUse?.mode === 'melee' && !definition.weaponUse?.bonusAttack).definitionId;
  const requests = [];
  const stab = settle(f, apply(f, { kind: 'invokeAbility', rootActionId: 'root:stab', sourceEntityId: ACTOR, abilityRef: dagger,
    parameters: { targetEntityId: PEER } }), { 'attack:': 15, 'damage:': 3 }, requests);
  assert.equal(stab.kind, 'committed', JSON.stringify(stab));
  const damage = requests.find((request) => request.purposeKey.startsWith('damage:'));
  // Each die is reserved twice over for a critical hit.
  assert.equal(damage.diceExpression, '2d4+2d6');
  assert.deepEqual(damage.frozenParameters.components.map((component) => component.formula), ['1d4', '1d6']);
  const packet = stab.events.find((event) => event.eventType === 'DamagePacketResolved').payload;
  assert.equal(packet.totalApplied, 6);
  assert.equal(f.state.entities[PEER].hitPoints.current, 14);
});

// SPEC 0012 §10.1 (ADR 0160, SRD Hunter's Mark): once the marked creature
// drops to 0 hit points, a bonus action on a later turn moves the mark to a
// new creature; the record keeps its time and its caster's concentration.
const GUARD = 'npc:hunters-mark-guard';
test('when the marked creature drops to 0 hit points, the caster may move the mark to another creature with a bonus action on a later turn', () => {
  const ranger = { classId: 'ranger', level: 3, cantripIds: [], preparedSpellIds: ['hunters-mark'],
    resources: { slot1: 3 }, resourceMaximums: { slot1: 3 },
    characterBuild: { classId: 'ranger', raceId: 'human', cantrips: [], prepared: ['hunters-mark'] },
    loadout: { equipped: { main: 'dagger' }, backpack: [], armorClass: 10, speedFeet: 30 } };
  const f = createAuthoredProbeFixture('hunters-mark-move', { npcCharacters: [{ id: GUARD, name: '守卫', mechanical: false }],
    spawnPoints: [[100, 100], [160, 100], [100, 160]].map(([x, y]) => ({ x: String(x), y: String(y), elevation: '0' })),
    characterOverrides: { [ACTOR]: ranger, [PEER]: { hitPoints: { current: 1, maximum: 20 } } } });
  f.events = [];
  // The guard joins with the stat block a KP would give it.
  const guard = f.state.combatRuntime.entities[GUARD];
  const template = { definitionId: 'npc-template:hunters-mark-move:guard', revision: '1', definitionKind: 'npcMechanicalTemplate',
    rulesBasis: 'srd5.1-2014', causalBasisRefs: [PROBE_SOURCE], visibilityPolicyRef: 'visibility:scene-observers',
    content: { schema: 'zhuwei.npc-mechanical-template/v1', label: '守卫', footprint: structuredClone(guard.footprint),
      stats: { str: '12', dex: '10', con: '10', int: '10', wis: '10', cha: '10' }, proficiencyBonus: '2',
      armorClass: '10', armorClassModel: { kind: 'higherOfBaseAndEquipment', baseArmorClass: '10', shieldBonus: '0' },
      hitPointsMaximum: '30', speedInches: { walk: '360' }, resourceMaximums: {}, deathPolicy: 'deadAtZero',
      intrinsicAbilities: [], itemDefinitions: [], itemDefinitionRefs: [], initialLoadout: { entries: [] } } };
  const participants = [ACTOR, PEER, GUARD];
  const opened = settle(f, apply(f, { kind: 'startEncounter', rootActionId: 'root:hunters-mark-move:encounter', proposalAttemptId: 'proposal:hunters-mark-move',
    encounterId: ENCOUNTER, sceneId: SCENE, participantEntityIds: [ACTOR, PEER], battlefieldFactIds: [],
    dynamicEntities: [{ entityId: GUARD, name: '守卫', placement: { position: structuredClone(guard.position) },
      mechanics: { kind: 'bespokeDefinition', definition: template } }],
    initiativeGroups: participants.map((id) => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [PEER, GUARD] }, { fromEntityIds: [PEER, GUARD], toEntityIds: [ACTOR] }] }));
  assert.equal(opened.kind, 'committed', JSON.stringify(opened).slice(0, 1500));
  const moveRef = `${spell(f, 'hunters-mark', 1)}:move`;
  const listed = () => Object.keys(f.runtime.project(f.profiles, f.state, f.viewer).combatControls.abilities);
  assert.ok(f.state.combatRuntime.definitions[moveRef], 'the move is registered with the spell');
  assert.equal(f.state.combatRuntime.entities[ACTOR].abilityRefs.includes(moveRef), false, 'it is not an ability of its own');
  cast(f, 'hunters-mark', 1, { targetEntityId: PEER });
  const [mark] = Object.values(f.state.combatRuntime.effects);
  assert.deepEqual(mark.grantsWhenTargetDown, [moveRef]);
  assert.equal(listed().includes(moveRef), false, 'nothing to move while the marked creature stands');
  assert.equal(apply(f, { kind: 'invokeAbility', rootActionId: 'root:hunters-mark:early', sourceEntityId: ACTOR,
    abilityRef: moveRef, parameters: { targetEntityId: GUARD } }).kind, 'rejected');
  const dagger = Object.values(f.state.combatRuntime.definitions).find((definition) => definition.weaponUse?.slot === 'main'
    && definition.weaponUse?.mode === 'melee' && !definition.weaponUse?.bonusAttack).definitionId;
  const stab = (target) => {
    const requests = [];
    let result = settle(f, apply(f, { kind: 'invokeAbility', rootActionId: `root:stab:${f.events.length}`, sourceEntityId: ACTOR,
      abilityRef: dagger, parameters: { targetEntityId: target } }), { 'attack:': 15, 'damage:': 3 }, requests);
    // A melee blow that would drop it may knock it out instead.
    if (result.kind === 'awaitingInput' && result.pending.choiceKind === 'knockOut') result = settle(f, apply(f, { kind: 'answerPendingInput',
      pendingInputId: result.pending.pendingInputId, responseId: `response:${result.pending.pendingInputId}`, answer: { kind: 'knockOut' } }));
    assert.equal(result.kind, 'committed', JSON.stringify(result).slice(0, 1500));
    return requests.find((request) => request.purposeKey.startsWith('damage:'));
  };
  stab(PEER);
  assert.equal(f.state.entities[PEER].hitPoints.current, 0);
  assert.ok(f.state.combatRuntime.effects[mark.effectId], 'the mark stays on the fallen creature until moved');
  // Each other creature's turn passes until the caster's next one.
  endTurn(f, ACTOR);
  while (f.state.combatRuntime.encounters[ENCOUNTER].activeEntityId !== ACTOR) {
    assert.equal(endTurn(f, f.state.combatRuntime.encounters[ENCOUNTER].activeEntityId).kind, 'committed');
  }
  assert.equal(listed().includes(moveRef), true);
  const priorState = f.state, firstEvent = f.events.length;
  const moved = settle(f, apply(f, { kind: 'invokeAbility', rootActionId: 'combat-act:hunters-mark-move', sourceEntityId: ACTOR,
    abilityRef: moveRef, parameters: { targetEntityId: GUARD } }));
  assert.equal(moved.kind, 'committed', JSON.stringify(moved));
  // A map act is told from claims, the move included (SPEC 0016 §§7、8).
  const rootEvents = f.events.slice(firstEvent);
  const receipt = { ...moved.receipt, eventRange: { fromEventSeq: rootEvents[0].eventSeq, toEventSeq: rootEvents.at(-1).eventSeq } };
  const told = deriveAuthorityClaimsFromCommittedRange({ receipt, actorCharacterId: ACTOR, priorState, state: f.state, events: rootEvents });
  assert.ok(told.claims.some((claim) => claim.outcomeCode === 'markMoved' && claim.targetRefs.includes(GUARD)), JSON.stringify(told.claims));
  assert.deepEqual(moved.events.filter((event) => event.eventType === 'EffectRetargeted').map((event) => event.payload),
    [{ effectId: mark.effectId, sourceRef: ACTOR, targetEntityId: GUARD }]);
  const after = f.state.combatRuntime.effects[mark.effectId];
  // The hour runs on as before, read on the new target's clock.
  assert.deepEqual([after.targetEntityId, after.expiresAt, after.lifecycle], [GUARD, { ...mark.expiresAt, entityId: GUARD }, mark.lifecycle]);
  assert.equal(f.state.entities[ACTOR].resources.slot1, 2, 'moving it spends no slot');
  assert.equal(f.state.combatRuntime.entities[ACTOR].concentration.linkedEffects, true);
  assert.equal(listed().includes(moveRef), false, 'the new target stands');
  // The guard now takes the d6.
  assert.equal(stab(GUARD).diceExpression, '2d4+2d6');
});
