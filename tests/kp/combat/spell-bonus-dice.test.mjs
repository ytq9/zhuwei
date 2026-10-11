import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSha256 } from '../../../app/_runtime/lib/rules/profiles/canonical.ts';
import { registeredAbilityRecord } from '../../../app/_runtime/lib/rules/profiles/ability-compiler.ts';
import { buildPlayerCombatEntity, planPlayerAbilityCatalog, synchronizePlayerCombatEntity } from '../../../app/_runtime/lib/rules/v2/character-abilities.ts';
import { hashWorldState } from '../../../app/_runtime/lib/rules/v2/validation.ts';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as PEER, PROBE_SCENE as SCENE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';

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
