import assert from 'node:assert/strict';
import test from 'node:test';
import { canSenseConcealment, concealmentAttentionIssue, concealmentCandidates, concealmentNoticers, concealmentThreshold,
  defaultConcealmentAttention, frozenConcealmentObservers, passivePerception } from '../../../app/_runtime/lib/rules/v2/concealment.ts';
import { promiseFixture } from '../../support/fixtures/vnext-promise-lifecycle.mjs';

const ACTOR = 'character:probe-actor', PEER = 'character:probe-target', NPC = 'npc:promise-worker';

/** The promise fixture's gallery holds the actor, a second player and one
 * NPC; each case edits a clone of it. */
function room(name, edit = () => {}) {
  const f = promiseFixture(name);
  const state = structuredClone(f.state);
  edit(state);
  return { state, profiles: f.profiles };
}

// SPEC 0005 §6.2: Rules picks who may notice from authoritative state: the
// NPCs present who can sense the act. Player characters are not compared.
test('the NPCs in the actor scene who are in tenure, aware and able to sense the act may notice; players and the actor never', () => {
  assert.deepEqual(concealmentCandidates(room('concealment-all').state, ACTOR, 'sight'), [NPC], 'the other player is not compared');
  const elsewhere = room('concealment-elsewhere', (s) => { s.entities[NPC].sceneId = 'scene:somewhere-else'; });
  assert.deepEqual(concealmentCandidates(elsewhere.state, ACTOR, 'sight'), [], 'another scene is not present');
  const missing = room('concealment-missing', (s) => { s.entities[NPC].tenureStatus = 'missing'; });
  assert.deepEqual(concealmentCandidates(missing.state, ACTOR, 'sight'), [], 'out of tenure is not present');
  const dead = room('concealment-dead', (s) => { s.combatRuntime.entities[NPC].lifeState = 'dead'; });
  assert.deepEqual(concealmentCandidates(dead.state, ACTOR, 'sight'), [], 'the dead notice nothing');
  const unconscious = room('concealment-unconscious', (s) => {
    s.combatRuntime.entities[NPC].conditions = { ...s.combatRuntime.entities[NPC].conditions, unconscious: true };
  });
  assert.deepEqual(concealmentCandidates(unconscious.state, ACTOR, 'sight'), [], 'the unconscious notice nothing');
  const blinded = room('concealment-blinded', (s) => {
    s.combatRuntime.entities[NPC].conditions = { ...s.combatRuntime.entities[NPC].conditions, blinded: true };
  });
  assert.deepEqual(concealmentCandidates(blinded.state, ACTOR, 'sight'), [], 'a blinded NPC is not listed for a seen act');
  assert.deepEqual(concealmentCandidates(blinded.state, ACTOR, 'hearing'), [NPC], 'but is for a heard one');
});

test('passive Perception is 10 plus an NPC stat block skill bonus, otherwise Wisdom and proficiency', () => {
  const { state, profiles } = room('concealment-passive', (s) => {
    s.entities[NPC].abilityScores = { ...s.entities[NPC].abilityScores, wis: 16 };
    s.entities[PEER].abilityScores = { ...s.entities[PEER].abilityScores, wis: 14 };
    s.entities[PEER].proficientSkills = ['perception'];
    s.entities[PEER].proficiencyBonus = 2;
  });
  assert.equal(passivePerception(profiles, state, NPC), 13, 'Wisdom 16');
  assert.equal(passivePerception(profiles, state, PEER), 14, 'Wisdom 14 (+2) and proficient (+2)');
  state.entities[NPC].socialMechanics = { abilityScores: state.entities[NPC].abilityScores, proficiencyBonus: 2,
    skillModifiers: { perception: 4 }, initialTrust: 0, authorityModifier: 0, stakesSensitivity: 1, maximumInfluenceDegree: 'fullSuccess' };
  assert.equal(passivePerception(profiles, state, NPC), 14, 'the stat block bonus wins');
});

test('attention moves the threshold by five either way and an unseen observer is not compared', () => {
  const threshold = (attention) => concealmentThreshold({ observerRef: NPC, attention, passivePerception: 12 });
  assert.deepEqual(['watching', 'unfocused', 'distracted', 'unseen'].map(threshold), [17, 12, 7, null]);
});

test('one total is compared with every observer but the primary, and meeting a threshold passes unnoticed', () => {
  const { state } = room('concealment-noticers');
  const observers = [
    { observerRef: 'primary', attention: 'watching', passivePerception: 20 },
    { observerRef: NPC, attention: 'unfocused', passivePerception: 14 },
    { observerRef: PEER, attention: 'unfocused', passivePerception: 15 },
  ];
  assert.deepEqual(concealmentNoticers(state, 14, observers, 'primary', 'sight'), [PEER],
    'the primary is decided by the check branches; 14 meets 14 and misses 15');
  assert.deepEqual(concealmentNoticers(state, 14, [{ observerRef: PEER, attention: 'unseen', passivePerception: 30 }], 'primary', 'sight'), []);
});

test('a blinded observer notices nothing seen and a deafened one nothing heard', () => {
  const { state } = room('concealment-senses', (s) => {
    s.combatRuntime.entities[NPC].conditions = { ...s.combatRuntime.entities[NPC].conditions, blinded: true };
    s.combatRuntime.entities[PEER].conditions = { ...s.combatRuntime.entities[PEER].conditions, deafened: true };
  });
  assert.equal(canSenseConcealment(state, NPC, 'sight'), false);
  assert.equal(canSenseConcealment(state, NPC, 'hearing'), true);
  assert.equal(canSenseConcealment(state, PEER, 'hearing'), false);
  const observers = [{ observerRef: NPC, attention: 'watching', passivePerception: 20 }];
  assert.deepEqual(concealmentNoticers(state, 1, observers, 'primary', 'sight'), []);
  assert.deepEqual(concealmentNoticers(state, 1, observers, 'primary', 'hearing'), [NPC]);
});

// SPEC 0005 §6.2 (ADR 0062): Rules assumes the tier from authoritative state;
// the KP changes it only on a cited record.
test('someone carrying out an Activity is distracted by default, everyone else unfocused, and a changed tier needs a record', () => {
  const { state, profiles } = room('concealment-default', (s) => {
    s.campaignRuntime.activities['activity:concealment-rest'] = { activityId: 'activity:concealment-rest', characterId: PEER, status: 'active' };
  });
  assert.equal(defaultConcealmentAttention(state, PEER), 'distracted');
  assert.equal(defaultConcealmentAttention(state, NPC), 'unfocused');
  const frozen = frozenConcealmentObservers(profiles, state, ACTOR, 'sight', [{ observerRef: NPC, attention: 'watching', basisRefs: ['scene:probe-gallery'] }]);
  assert.deepEqual(frozen.map(({ observerRef, attention }) => [observerRef, attention]), [[NPC, 'watching']]);
  assert.equal(defaultConcealmentAttention(state, PEER), 'distracted', 'the resting player has a default but is not compared');
  assert.equal(concealmentAttentionIssue(state, frozen), undefined);
  assert.equal(concealmentAttentionIssue(state, frozen.map(observer => ({ ...observer, basisRefs: [] }))),
    'concealment:attention-change-needs-a-cited-record', 'watching without a record');
  assert.equal(concealmentAttentionIssue(state, frozen.map(observer => ({ ...observer, attention: defaultConcealmentAttention(state, observer.observerRef), basisRefs: [] }))),
    undefined, 'the default needs no record');
});
