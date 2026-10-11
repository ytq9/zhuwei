import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as PEER, PROBE_SCENE as SCENE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';

// SPEC 0012 §10.1 (ADR 0158, SRD Command; user ruling: Rules carries the
// command out): the caster speaks one of five words; a target that fails its
// save follows it as its next turn starts, and that turn ends. Real catalog
// spell, stepped and replayed.

const ENCOUNTER = 'encounter:spell-command';

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
// A cleric who knows Command, the peer 15 feet off; `peer` overrides it.
function fixture(name, peer = {}) {
  const cleric = { classId: 'cleric', level: 3, cantripIds: [], preparedSpellIds: ['command'],
    resources: { slot1: 4 }, resourceMaximums: { slot1: 4 },
    characterBuild: { classId: 'cleric', raceId: 'human', cantrips: [], prepared: ['command'] } };
  const f = createAuthoredProbeFixture(name, { spawnPoints: [{ x: '100', y: '100', elevation: '0' }, { x: '280', y: '100', elevation: '0' }],
    characterOverrides: { [ACTOR]: cleric, [PEER]: peer } });
  f.events = [];
  const participants = [ACTOR, PEER];
  assert.equal(settle(f, apply(f, { kind: 'startEncounter', rootActionId: `root:${name}:encounter`, proposalAttemptId: `proposal:${name}:encounter`,
    encounterId: ENCOUNTER, sceneId: SCENE, participantEntityIds: participants, dynamicEntities: [], battlefieldFactIds: [],
    initiativeGroups: participants.map((id) => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [PEER] }, { fromEntityIds: [PEER], toEntityIds: [ACTOR] }] })).kind, 'committed');
  return f;
}
const commandRef = (f) => Object.values(f.state.combatRuntime.definitions).find((definition) => definition.sourceSpellId === 'command').definitionId;
function command(f, word, faces = { 'save:': 2 }) {
  return settle(f, apply(f, { kind: 'invokeAbility', rootActionId: `root:command:${word}`, sourceEntityId: ACTOR,
    abilityRef: commandRef(f), parameters: { targetEntityId: PEER, command: word } }), faces);
}
const endTurn = (f, id) => settle(f, apply(f, { kind: 'endTurn', rootActionId: `root:end-turn:${f.events.length}`,
  encounterId: ENCOUNTER, sourceEntityId: id }));
const encounter = (f) => f.state.combatRuntime.encounters[ENCOUNTER];
const position = (f, id) => f.state.combatRuntime.entities[id].position;
const obeyed = (result) => result.events.filter((event) => event.eventType === 'AbilityInvoked' && event.payload.abilityRef === 'action:obey-command')
  .map((event) => event.payload.mechanicalResult.command);

test('Command asks its caster for the word, and a target that fails grovels as its turn starts and its turn ends', () => {
  const f = fixture('command-grovel');
  const asked = apply(f, { kind: 'invokeAbility', rootActionId: 'root:command:ask', sourceEntityId: ACTOR,
    abilityRef: commandRef(f), parameters: { targetEntityId: PEER } });
  assert.equal(asked.kind, 'awaitingInput', JSON.stringify(asked));
  // The caster is offered the five words, as the page lists them.
  const choice = f.runtime.project(f.profiles, f.state, f.viewer).pendingInputs.find((entry) => entry.choiceKind === 'commandWord');
  assert.deepEqual([choice.question, choice.answerOptions.map((option) => option.answer.command)],
    ['命令术要说出哪个命令？', ['approach', 'drop', 'flee', 'grovel', 'halt']]);
  assert.equal(f.state.entities[ACTOR].resources.slot1, 4, 'nothing is spent before the word is chosen');
  const cast = settle(f, apply(f, { kind: 'answerPendingInput', pendingInputId: asked.pending.pendingInputId, responseId: 'response:grovel',
    answer: { kind: 'commandWord', command: 'grovel' } }), { 'save:': 2 });
  assert.equal(cast.kind, 'committed', JSON.stringify(cast));
  const [effect] = Object.values(f.state.combatRuntime.effects);
  assert.deepEqual([effect.modifier, effect.command, effect.duration], [{ kind: 'commanded' }, 'grovel',
    { kind: 'turnBoundary', subject: 'target', edge: 'turnEnd' }]);
  const turn = endTurn(f, ACTOR);
  assert.equal(turn.kind, 'committed', JSON.stringify(turn));
  assert.deepEqual(obeyed(turn), ['grovel']);
  assert.equal(f.state.combatRuntime.entities[PEER].conditions.prone, true);
  assert.deepEqual(Object.values(f.state.combatRuntime.effects), []);
  // Its turn ended by itself: the caster's next turn has begun.
  assert.deepEqual([encounter(f).activeEntityId, encounter(f).round], [ACTOR, 2]);
});

test('"Approach" walks the target to within 5 feet of the caster, "Flee" Dashes it straight away, and each turn ends', () => {
  const near = fixture('command-approach');
  command(near, 'approach');
  const walked = endTurn(near, ACTOR);
  assert.deepEqual(obeyed(walked), ['approach']);
  assert.deepEqual(position(near, PEER), { x: '160', y: '100', elevation: '0' });
  assert.equal(encounter(near).activeEntityId, ACTOR);

  // Sixty feet of Dash, cut at the scene's edge 5-foot step by 5-foot step.
  const away = fixture('command-flee');
  command(away, 'flee');
  const fled = endTurn(away, ACTOR);
  assert.deepEqual(obeyed(fled), ['flee']);
  assert.deepEqual(position(away, PEER), { x: '520', y: '100', elevation: '0' });
  assert.equal(encounter(away).activeEntityId, ACTOR);
});

test('"Drop" lets go of what the target holds at its feet; a target that saves is not commanded', () => {
  const f = fixture('command-drop', { loadout: { equipped: { main: 'mace' }, backpack: [], armorClass: 10, speedFeet: 30 } });
  command(f, 'drop');
  const turn = endTurn(f, ACTOR);
  assert.deepEqual(obeyed(turn), ['drop']);
  const mace = Object.values(f.state.campaignRuntime.itemSystem.entries).find((entry) => entry.disposition === 'scene');
  assert.ok(mace, JSON.stringify(Object.values(f.state.campaignRuntime.itemSystem.entries)));
  assert.deepEqual(mace.position, { x: '280', y: '100', elevation: '0' });
  assert.equal(f.state.entities[PEER].loadout.equipped.main, undefined);

  const saved = fixture('command-saved');
  command(saved, 'halt', { 'save:': 20 });
  assert.deepEqual(Object.values(saved.state.combatRuntime.effects), []);
  const free = endTurn(saved, ACTOR);
  assert.deepEqual(obeyed(free), []);
  assert.equal(encounter(saved).activeEntityId, PEER, 'an uncommanded target takes its own turn');
});
