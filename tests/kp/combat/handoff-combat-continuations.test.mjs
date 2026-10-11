import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as PEER, PROBE_SCENE as SCENE, PROBE_SOURCE as SOURCE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { authoritativeModuleProfile } from '../../../app/_runtime/lib/module/authoritative.ts';
import { combatDepartureOptions } from '../../../app/_runtime/lib/rules/v2/places.ts';

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
function settle(f, result, face = request => request.purposeKey.startsWith('initiative:')
  ? request.purposeKey.includes(ACTOR) ? 20 : 2 : request.purposeKey.startsWith('attack:') ? 1 : 2) {
  while (result.kind === 'awaitingRandomness') result = apply(f, { kind: 'authoritativeRandomness',
    resolutionId: result.resolutionId, responseId: `authority:${result.resolutionId}`,
    continuationCapability: result.continuationCapability,
    randomnessResults: result.randomnessRequests.map(request => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
      draws: request.dice.map(term => ({ sides: Number(term.sides), faces: Array(Number(term.count)).fill(Math.min(Number(term.sides), face(request))) })) })),
  });
  return result;
}
function open(f, sceneId = SCENE) {
  f.events ??= [];
  const participants = [ACTOR, PEER];
  const result = settle(f, apply(f, { kind: 'startEncounter', rootActionId: 'root:handoff:encounter', proposalAttemptId: 'proposal:handoff:encounter',
    encounterId: 'encounter:handoff', sceneId, participantEntityIds: participants, dynamicEntities: [], battlefieldFactIds: [],
    initiativeGroups: participants.map(id => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [PEER] }, { fromEntityIds: [PEER], toEntityIds: [ACTOR] }] }));
  assert.equal(result.kind, 'committed', JSON.stringify(result));
  assert.equal(f.state.combatRuntime.encounters['encounter:handoff'].activeEntityId, ACTOR);
}
function invoke(f, abilityRef, parameters = {}, id = ACTOR) {
  return apply(f, { kind: 'invokeAbility', rootActionId: `root:handoff:ability:${f.events.length}`, sourceEntityId: id, abilityRef, parameters });
}
const definition = (f, predicate) => Object.values(f.state.combatRuntime.definitions).find(predicate);

// SPEC 0012 §§6.3、9; SPEC 0001 §16: actual step, inventory fold and replay.
test('a missed thrown main-hand attack releases the real entry at the aim point and enables the other light weapon once', () => {
  const f = createAuthoredProbeFixture('handoff-real-throw', { characterOverrides: { [ACTOR]: {
    loadout: { equipped: { main: 'dagger', off: 'handaxe' }, backpack: [], armorClass: 10, speedFeet: 30 },
  } } });
  open(f);
  const thrown = definition(f, d => d.weaponUse?.slot === 'main' && d.weaponUse?.mode === 'thrown' && !d.weaponUse?.bonusAttack);
  const bonus = definition(f, d => d.weaponUse?.slot === 'off' && d.weaponUse?.mode === 'melee' && d.weaponUse?.bonusAttack);
  assert.ok(thrown && bonus);
  assert.equal(invoke(f, bonus.definitionId, { targetEntityId: PEER }).kind, 'rejected');
  const aim = structuredClone(f.state.combatRuntime.entities[PEER].position);
  const done = settle(f, invoke(f, thrown.definitionId, { targetEntityId: PEER }));
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  const entry = f.state.campaignRuntime.itemSystem.entries[thrown.weaponUse.entryId];
  assert.equal(entry.disposition, 'scene'); assert.deepEqual(entry.position, aim);
  assert.equal(entry.quantity, 1); assert.equal(f.state.entities[ACTOR].loadout.equipped.main, undefined);
  assert.equal(invoke(f, thrown.definitionId, { targetEntityId: PEER }).kind, 'rejected');
  // The remaining axe is out of melee reach here: a thrown bonus still uses
  // that very same earned weapon, costs the bonus action, and leaves it too.
  const bonusThrow = definition(f, d => d.weaponUse?.slot === 'off' && d.weaponUse?.mode === 'thrown' && d.weaponUse?.bonusAttack);
  assert.equal(settle(f, invoke(f, bonusThrow.definitionId, { targetEntityId: PEER })).kind, 'committed');
  assert.equal(f.state.combatRuntime.entities[ACTOR].turn.bonusAction, '0');
  assert.equal(Object.values(f.state.campaignRuntime.itemSystem.entries).filter(e => e.disposition === 'scene').length, 2);
});

test('an upcast healing ability spends its exact higher slot and uses the same frozen higher healing formula', () => {
  const f = createAuthoredProbeFixture('handoff-real-upcast', { characterOverrides: { [ACTOR]: {
    classId: 'cleric', level: 3, preparedSpellIds: ['cure'], resources: { slot1: 2, slot2: 1 }, resourceMaximums: { slot1: 2, slot2: 1 },
    characterBuild: { classId: 'cleric', raceId: 'human', cantrips: [], prepared: ['cure'] },
  } } });
  open(f);
  const cure = definition(f, d => d.sourceSpellId === 'cure' && d.activation.spellLevel === '2');
  assert.ok(cure);
  assert.equal(invoke(f, cure.definitionId, { targetEntityId: ACTOR, slotLevel: '1' }).kind, 'rejected');
  const before = f.state.entities[ACTOR].hitPoints.current;
  const healed = settle(f, invoke(f, cure.definitionId, { targetEntityId: ACTOR }));
  assert.equal(healed.kind, 'committed', JSON.stringify(healed));
  assert.equal(f.state.entities[ACTOR].resources.slot2, 0);
  assert.equal(f.state.entities[ACTOR].resources.slot1, 2);
  assert.equal(f.state.entities[ACTOR].hitPoints.current, before + 4);
});

const module = await authoritativeModuleProfile('black-oak-will');
const scenes = module.storyBible.storyAnchors.locations.map(location => ({ id: location.sceneId, name: location.name, geometry: structuredClone(location.tacticalGeometry) }));
function exitFixture(name, actorHitPoints = 10) {
  const f = createAuthoredProbeFixture(name, { additionalScenes: scenes, placeMap: structuredClone(module.tacticalSite),
    characterScenes: { [ACTOR]: 'wake', [PEER]: 'wake' },
    characterOverrides: { [ACTOR]: { hitPoints: { current: actorHitPoints, maximum: 20 } },
      [PEER]: { loadout: { equipped: { main: 'mace' }, backpack: [], armorClass: 10, speedFeet: 30 } } } });
  f.events = [];
  const moved = apply(f, { kind: 'repositionCharacter', rootActionId: 'root:handoff:approach-exit', characterId: ACTOR,
    destination: { kind: 'nextTo', ref: 'feature:wake:yard-door' } });
  assert.equal(moved.kind, 'committed', JSON.stringify(moved));
  return f;
}
test('SPEC 0012 §§3.4,7,13: a real map exit moves only its actor and keeps the other living player in the encounter', () => {
  const f = exitFixture('handoff-depart'); open(f, 'wake');
  const before = structuredClone(f.state.combatRuntime.entities[ACTOR]);
  const exit = combatDepartureOptions(f.state, ACTOR).find(option => option.abilityRef.endsWith('yard'));
  assert.ok(exit);
  let result = invoke(f, exit.abilityRef);
  if (result.kind === 'awaitingInput') result = apply(f, { kind: 'answerPendingInput', pendingInputId: result.pending.pendingInputId,
    responseId: 'response:exit-no-reaction', answer: { kind: 'decline' } });
  assert.equal(result.kind, 'committed', JSON.stringify(result));
  assert.equal(f.state.entities[ACTOR].sceneId, 'yard');
  assert.equal(f.state.entities[PEER].sceneId, 'wake');
  assert.equal(f.state.combatRuntime.encounters['encounter:handoff'].activeEntityId, PEER);
  assert.notEqual(f.state.combatRuntime.encounters['encounter:handoff'].status, 'concluded');
  assert.deepEqual(f.state.combatRuntime.entities[ACTOR].hitPoints, before.hitPoints);
  assert.ok(result.events.some(event => event.eventType === 'CombatantDeparted'));
});


test('SPEC 0012 §7: a guarded exit offers its opportunity attack and a downed mover does not leave or lose its items', () => {
  const f = exitFixture('handoff-exit-interrupted', 1);
  const near = apply(f, { kind: 'repositionCharacter', rootActionId: 'root:handoff:guard-exit', characterId: PEER,
    destination: { kind: 'nextTo', ref: ACTOR } });
  assert.equal(near.kind, 'committed', JSON.stringify(near));
  open(f, 'wake');
  const exit = combatDepartureOptions(f.state, ACTOR).find(option => option.abilityRef.endsWith('yard'));
  assert.ok(exit);
  const beforeItems = structuredClone(f.state.campaignRuntime.itemSystem);
  const waiting = invoke(f, exit.abilityRef);
  assert.equal(waiting.kind, 'awaitingInput', JSON.stringify(waiting));
  assert.deepEqual([waiting.pending.controllerEntityId, waiting.pending.choiceKind], [PEER, 'reaction']);
  const struck = settle(f, apply(f, { kind: 'answerPendingInput', pendingInputId: waiting.pending.pendingInputId,
    responseId: 'response:guarded-exit-strike', answer: { kind: 'useReaction', abilityRef: 'action:opportunity-attack', targetEntityId: ACTOR } }),
    request => request.purposeKey.startsWith('attack:') ? 15 : 2);
  assert.equal(struck.kind, 'committed', JSON.stringify(struck));
  assert.equal(f.state.entities[ACTOR].sceneId, 'wake');
  assert.equal(f.state.combatRuntime.entities[ACTOR].hitPoints.current, '0');
  assert.equal(f.events.some(event => event.eventType === 'CombatantDeparted'), false);
  assert.deepEqual(f.state.campaignRuntime.itemSystem, beforeItems);
});


test('SPEC 0012 §§12,13: all players down retain their death saves; actual deaths conclude only the encounter once', () => {
  const f = createAuthoredProbeFixture('handoff-all-dying', { characterOverrides: {
    [ACTOR]: { hitPoints: { current: 0, maximum: 20 } }, [PEER]: { hitPoints: { current: 0, maximum: 20 } },
  } });
  open(f);
  const turn = id => settle(f, apply(f, { kind: 'endTurn', encounterId: 'encounter:handoff', sourceEntityId: id,
    rootActionId: `root:dying-turn:${f.events.length}` }), () => 1);
  assert.equal(turn(ACTOR).kind, 'committed');
  assert.equal(turn(PEER).kind, 'committed');
  assert.notEqual(f.state.combatRuntime.encounters['encounter:handoff'].status, 'concluded');
  assert.equal(f.state.combatRuntime.entities[ACTOR].deathSaves.failures, 2);
  assert.equal(turn(ACTOR).kind, 'committed');
  assert.equal(turn(PEER).kind, 'committed');
  assert.equal(f.state.combatRuntime.entities[ACTOR].lifeState, 'dead');
  assert.equal(f.state.combatRuntime.entities[PEER].lifeState, 'dead');
  assert.equal(f.state.combatRuntime.encounters['encounter:handoff'].status, 'concluded');
  assert.equal(f.events.filter(event => event.eventType === 'EncounterConcluded').length, 1);
  assert.equal(f.events.find(event => event.eventType === 'EncounterConcluded').payload.fictionAdvanceMicros, '0');
  assert.equal(f.events.some(event => /StoryConcluded|ChapterConcluded/u.test(event.eventType)), false);
});

// ADR 0126 against ADR 0112: a foe at 0 HP cannot fight, but with the one
// player down too, no one is asked to end the fight; both keep making death
// saves. (With a player standing, the players are asked:
// combat-map-reply.room.test.ts.)
test('SPEC 0012 §§12,13: a downed player is not asked to end the fight while a downed foe still makes death saves', () => {
  const GUARD = 'npc:handoff:guard';
  const f = createAuthoredProbeFixture('handoff-both-dying', { npcCharacters: [{ id: GUARD, name: '守卫', mechanical: false }],
    characterOverrides: { [ACTOR]: { hitPoints: { current: 0, maximum: 20 } } } });
  f.events = [];
  const guard = f.state.combatRuntime.entities[GUARD];
  const started = settle(f, apply(f, { kind: 'startEncounter', rootActionId: 'root:handoff:both-dying', proposalAttemptId: 'proposal:handoff:both-dying',
    encounterId: 'encounter:both-dying', sceneId: guard.sceneId, participantEntityIds: [ACTOR], battlefieldFactIds: [],
    dynamicEntities: [{ entityId: GUARD, name: '守卫', placement: { position: structuredClone(guard.position) }, initialState: { hitPointsCurrent: '0' },
      mechanics: { kind: 'bespokeDefinition', definition: {
        definitionId: 'npc-template:handoff:guard', revision: '1', definitionKind: 'npcMechanicalTemplate',
        rulesBasis: 'srd5.1-2014', causalBasisRefs: [SOURCE], visibilityPolicyRef: 'visibility:scene-observers',
        content: { schema: 'zhuwei.npc-mechanical-template/v1', label: '守卫', footprint: structuredClone(guard.footprint),
          stats: { str: '12', dex: '12', con: '10', int: '10', wis: '10', cha: '10' }, proficiencyBonus: '2',
          armorClass: '12', armorClassModel: { kind: 'higherOfBaseAndEquipment', baseArmorClass: '12', shieldBonus: '0' },
          hitPointsMaximum: '11', speedInches: { walk: '360' }, resourceMaximums: {}, deathPolicy: 'deathSaves',
          intrinsicAbilities: [], itemDefinitions: [], itemDefinitionRefs: [], initialLoadout: { entries: [] } } } } }],
    initiativeGroups: [ACTOR, GUARD].map(id => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [GUARD] }, { fromEntityIds: [GUARD], toEntityIds: [ACTOR] }] }));
  assert.equal(started.kind, 'committed', JSON.stringify(started).slice(0, 1500));
  const encounter = () => f.state.combatRuntime.encounters['encounter:both-dying'];
  assert.equal(encounter().activeEntityId, ACTOR);
  for (const id of [ACTOR, GUARD]) {
    const ended = settle(f, apply(f, { kind: 'endTurn', encounterId: 'encounter:both-dying', sourceEntityId: id,
      rootActionId: `root:both-dying-turn:${f.events.length}` }), () => 2);
    assert.equal(ended.kind, 'committed', JSON.stringify(ended).slice(0, 1500));
  }
  assert.equal(f.events.some(event => event.eventType === 'EncounterConclusionProposed'), false);
  assert.notEqual(encounter().status, 'concluded');
  assert.deepEqual([ACTOR, GUARD].map(id => f.state.combatRuntime.entities[id].lifeState), ['unconscious', 'unconscious']);
  assert.deepEqual([ACTOR, GUARD].map(id => f.state.combatRuntime.entities[id].deathSaves.failures > 0), [true, true]);
});


test('SPEC 0012 §8.1: a readied throw releases its real item at the reaction target without granting a bonus attack', () => {
  const f = createAuthoredProbeFixture('handoff-ready-throw', { characterOverrides: { [ACTOR]: {
    loadout: { equipped: { main: 'dagger', off: 'handaxe' }, backpack: [], armorClass: 10, speedFeet: 30 },
  } } });
  open(f);
  const thrown = definition(f, d => d.weaponUse?.slot === 'main' && d.weaponUse?.mode === 'thrown' && !d.weaponUse?.bonusAttack);
  const ready = apply(f, { kind: 'readyAction', rootActionId: 'root:handoff:ready-throw', encounterId: 'encounter:handoff', sourceEntityId: ACTOR,
    trigger: { kind: 'perceivable', sourceEntityId: PEER, event: 'turnStarted' },
    response: { kind: 'invokeAbility', abilityRef: thrown.definitionId, parameters: { targetEntityId: PEER } } });
  assert.equal(ready.kind, 'committed', JSON.stringify(ready));
  const asked = apply(f, { kind: 'endTurn', rootActionId: 'root:handoff:ready-throw-end', encounterId: 'encounter:handoff', sourceEntityId: ACTOR });
  assert.equal(asked.kind, 'awaitingInput', JSON.stringify(asked));
  const done = settle(f, apply(f, { kind: 'answerPendingInput', pendingInputId: asked.pending.pendingInputId,
    responseId: 'response:ready-throw', answer: { kind: 'useReaction' } }));
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  const entry = f.state.campaignRuntime.itemSystem.entries[thrown.weaponUse.entryId];
  assert.equal(entry.disposition, 'scene');
  assert.deepEqual(entry.position, f.state.combatRuntime.entities[PEER].position);
  assert.equal(f.state.combatRuntime.entities[ACTOR].turn.twoWeaponBonusEntryIds, undefined);
  assert.equal(f.events.filter(event => event.eventType === 'InventoryOperationApplied').length, 1);
});
