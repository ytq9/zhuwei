import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_TARGET as PEER } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { lowerVNext2ProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { parseSubmitKpProposalBundleCandidateArguments, assertVNextProposalCandidateCapabilities } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { createVNextProposalBundleSchema } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { proposalUnofferedCapabilities } from '../../../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE as bridge, vnext2CommandToRoomLowering } from '../../../app/_runtime/lib/kp/vnext/room-bridge.ts';
import { deepSeekStrictToolSchemaIssues } from '../../../app/_runtime/lib/kp/deepseek-strict-tool.ts';
import { planPlaceRoute } from '../../../app/_runtime/lib/rules/v2/places.ts';

// SPEC 0012 §§3.3、13 (ADR 0112): inside an encounter the KP rules that the
// fighting stops -- a foe surrenders, the actor surrenders and is accepted,
// a truce, the actor got away, the foes are beaten or the fight no longer
// needs initiative. Those who stop are no longer hostile; when no one hostile
// to the players can still fight the end is put to every living player, who
// accept or decline it. When no one hostile can still fight, Rules itself
// puts the end to the players as a turn ends. Nothing ends without them.
const GUARD = 'npc:probe-guard';
const GUARD_SCORES = { str: 14, dex: 12, con: 12, int: 10, wis: 11, cha: 10 };

function fixture(name) {
  const f = createAuthoredProbeFixture(`combat-end:${name}`, { npcCharacters: [{ id: GUARD, name: '守卫', mechanical: false,
    abilityScores: GUARD_SCORES, proficiencyBonus: 2, loadout: { armorClass: 12, speedFeet: 30, equipped: {}, backpack: [] } }],
    // The other player is slower, so equal faces never tie the two players.
    characterOverrides: { [PEER]: { abilityScores: { str: 10, dex: 8, con: 10, int: 10, wis: 10, cha: 10 } } } });
  const result = { ...f, events: [] };
  freeze(result, '我拔出长剑，冲向守卫并挥剑攻击他。');
  return result;
}
function freeze(f, intentText) {
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId,
    focusRefs: [ACTOR, GUARD, PEER], intentText }).context;
}
function apply(f, input) {
  const result = f.runtime.step(f.profiles, f.state, input);
  if (result.events?.length) {
    f.events.push(...result.events);
    const replayed = f.runtime.replay(f.genesis, f.events);
    assert.equal(replayed.kind, 'replayed', JSON.stringify(replayed).slice(0, 2000));
    assert.deepEqual(replayed.state, result.state); f.state = replayed.state;
  }
  return result;
}
function lower(f, decision, loaded) {
  const candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify({ decision }));
  assert.equal(candidate.kind, 'accepted', JSON.stringify(candidate));
  assert.doesNotThrow(() => assertVNextProposalCandidateCapabilities(candidate, [loaded]));
  return lowerVNext2ProposalBundle({ value: candidate.bundle, rootActionId: f.rootActionId, actorCharacterId: ACTOR,
    profiles: f.profiles, requiredContext: f.requiredContext, state: f.state });
}
function run(f, lowered) {
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered).slice(0, 2000));
  const room = vnext2CommandToRoomLowering(lowered.command); assert.equal(room.kind, 'accepted');
  assert.equal(bridge.validateReadSet({ profiles: f.profiles, state: f.state, requiredContext: f.requiredContext,
    rulesInput: room.input }).kind, 'valid');
  return apply(f, room.input);
}
const constraints = lowered => (lowered.diagnostics ?? []).map(diagnostic => diagnostic.constraint);
const encounterOf = f => Object.values(f.state.combatRuntime.encounters)[0];

/** The actor attacks the guard in the open; the guard (Dexterity 12) acts
 * first, ends its turn, and it is the actor's turn. `hostile` false: the
 * guard does not fight back. */
function fight(name, { hostile = true, hitPoints = 11, participants = [ACTOR, GUARD] } = {}) {
  const f = fixture(name);
  const start = { kind: 'startCombat', participants: participants.map(creatureRef => ({ creatureRef, surprise: { kind: 'aware' } })),
    hostilities: [{ fromRefs: participants.filter(ref => ref !== GUARD), toRefs: [GUARD] },
      ...(hostile ? [{ fromRefs: [GUARD], toRefs: participants.filter(ref => ref !== GUARD) }] : [])],
    combatStatistics: [{ npcRef: GUARD, armorClass: 11, speedFeet: 30, hitPointsMaximum: hitPoints, deathPolicy: 'deadAtZero',
      attacks: [{ kind: 'meleeAttack', label: '短剑', ability: 'str', reachFeet: 5, damage: '1d6+2', damageType: 'piercing' }] }],
    description: '长剑出鞘的一瞬，守卫后退半步，手按上了剑柄。' };
  const waiting = run(f, lower(f, start, 'startCombat'));
  assert.equal(waiting.kind, 'awaitingRandomness', JSON.stringify(waiting).slice(0, 2000));
  const rolls = waiting.randomnessRequest.hazardRolls.flatMap(spec => spec.dice.flatMap(die => Array(Number(die.count)).fill(10)));
  assert.equal(apply(f, { kind: 'fulfillAuthoritativeRandomness', continuation: waiting.continuation, rolls }).kind, 'committed');
  const encounter = encounterOf(f);
  assert.equal(encounter.activeEntityId, GUARD);
  const passed = apply(f, { kind: 'endTurn', rootActionId: `root:${name}:guard-turn`, encounterId: encounter.encounterId, sourceEntityId: GUARD });
  return { f, encounterId: encounter.encounterId, passed };
}
/** The next act, frozen with its own root and words. */
function act(f, name, intentText) {
  f.rootActionId = `root:combat-end:${name}`;
  freeze(f, intentText);
}
function answer(f, pending, kind, name) {
  return apply(f, { kind: 'answerPendingInput', pendingInputId: pending.pendingInputId, responseId: `response:${name}`, answer: { kind } });
}
/** Every die of a native combat request shows its largest face. */
function fulfil(f, waiting) {
  assert.equal(waiting.kind, 'awaitingRandomness', JSON.stringify(waiting).slice(0, 2000));
  return apply(f, { kind: 'authoritativeRandomness', resolutionId: waiting.resolutionId, responseId: `authority:${waiting.resolutionId}`,
    continuationCapability: waiting.continuationCapability,
    randomnessResults: waiting.randomnessRequests.map(request => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
      draws: request.dice.map(term => ({ sides: Number(term.sides), faces: Array(Number(term.count)).fill(Number(term.sides)) })) })) });
}

test('the end form is a native decision offered only inside an encounter, its creature slots the frozen creatures', () => {
  const schema = createVNextProposalBundleSchema(['endCombat'], undefined, undefined, undefined, undefined, undefined, [ACTOR, GUARD]);
  assert.deepEqual(deepSeekStrictToolSchemaIssues(schema), []);
  assert.ok(JSON.stringify(schema).includes('"endCombat"'));
  assert.ok(JSON.stringify(schema).includes('"foesSurrender"'));
  const outside = fixture('offered');
  assert.ok(proposalUnofferedCapabilities(outside.requiredContext).includes('endCombat'));
  const { f } = fight('offered-inside');
  act(f, 'offered-inside', '我向守卫投降。');
  assert.equal(proposalUnofferedCapabilities(f.requiredContext).includes('endCombat'), false);
  // Outside an encounter there is no fight to end.
  const refused = lower(outside, { kind: 'endCombat', outcome: 'foesSurrender', stopFightingRefs: [GUARD], description: '守卫举起双手。' }, 'endCombat');
  assert.equal(refused.kind, 'rejected');
  assert.deepEqual(constraints(refused), ['combat-end:actor-not-in-encounter']);
});

test('B29: the guard surrenders, the player accepts, and the encounter ends with its lasting state; time and places work again', () => {
  const { f, encounterId } = fight('surrender');
  assert.equal(planPlaceRoute(f.state, ACTOR, 'scene:elsewhere').reason, 'place:in-encounter');
  const before = structuredClone(f.state.combatRuntime.entities[ACTOR]);
  act(f, 'surrender', '放下武器，我饶你一命。');
  const proposed = run(f, lower(f, { kind: 'endCombat', outcome: 'foesSurrender', stopFightingRefs: [GUARD],
    description: '守卫扔下短剑，举起双手。' }, 'endCombat'));
  assert.equal(proposed.kind, 'awaitingInput', JSON.stringify(proposed).slice(0, 2000));
  assert.deepEqual([proposed.pending.choiceKind, proposed.pending.controllerEntityId, proposed.pending.conclusionReason],
    ['encounterConclusion', ACTOR, 'npcSurrendered']);
  // Nothing ends before the player answers.
  assert.notEqual(f.state.combatRuntime.encounters[encounterId].status, 'concluded');

  const accepted = answer(f, proposed.pending, 'acceptEncounterConclusion', 'surrender-accept');
  assert.equal(accepted.kind, 'committed', JSON.stringify(accepted).slice(0, 2000));
  const encounter = f.state.combatRuntime.encounters[encounterId];
  assert.equal(encounter.status, 'concluded');
  const own = f.events.filter(event => event.rootActionId === f.rootActionId);
  const hostility = own.find(event => event.eventType === 'HostilityChanged');
  assert.deepEqual([hostility.payload.sourceEntityId, hostility.payload.previousTargetEntityIds, hostility.payload.targetEntityIds,
    hostility.payload.description], [GUARD, [ACTOR], [], '守卫扔下短剑，举起双手。']);
  assert.equal(own.find(event => event.eventType === 'EncounterConcluded').payload.reason, 'npcSurrendered');
  // SPEC 0012 §13: the end keeps hit points, position and resources.
  const after = f.state.combatRuntime.entities[ACTOR];
  for (const key of ['hitPoints', 'position', 'resources']) assert.deepEqual(after[key], before[key], key);
  // The encounter no longer holds the actor: the place map answers on its own terms.
  assert.equal(planPlaceRoute(f.state, ACTOR, 'scene:elsewhere').reason, 'place:unknown-destination');
});

test('B30: the actor surrenders and the guard accepts, the player declines the end: the fight goes on, hostility stays changed and the turn end is not asked again', () => {
  const { f, encounterId } = fight('decline');
  act(f, 'decline', '我向守卫投降。');
  const proposed = run(f, lower(f, { kind: 'endCombat', outcome: 'actorSurrenders', stopFightingRefs: [GUARD],
    description: '你把剑丢在地上，守卫迟疑片刻，收起了短剑。' }, 'endCombat'));
  assert.equal(proposed.kind, 'awaitingInput', JSON.stringify(proposed).slice(0, 2000));
  assert.equal(proposed.pending.conclusionReason, 'playersSurrendered');
  const declined = answer(f, proposed.pending, 'rejectEncounterConclusion', 'decline');
  assert.equal(declined.kind, 'committed', JSON.stringify(declined).slice(0, 2000));
  const encounter = f.state.combatRuntime.encounters[encounterId];
  assert.notEqual(encounter.status, 'concluded');
  assert.deepEqual(encounter.hostilities, [], 'neither side is hostile to the other any more');
  assert.equal(f.events.some(event => event.eventType === 'EncounterConcluded'), false);
  // No one hostile can fight, but the players have just been asked: ending
  // the turn passes it without asking again.
  const ended = apply(f, { kind: 'endTurn', rootActionId: 'root:combat-end:decline-end-turn', encounterId, sourceEntityId: ACTOR });
  assert.equal(ended.kind, 'committed', JSON.stringify(ended).slice(0, 2000));
  assert.equal(ended.events.some(event => event.eventType === 'EncounterConclusionProposed'), false);
  assert.equal(f.state.combatRuntime.encounters[encounterId].activeEntityId, GUARD);
});

test('B29: the actor gets away; the escape is an established fact, and the end the player accepts lets it leave', () => {
  const { f, encounterId } = fight('escape');
  act(f, 'escape', '我冲出门，头也不回地跑了。');
  const proposed = run(f, lower(f, { kind: 'endCombat', outcome: 'escaped', stopFightingRefs: [],
    description: '你冲出门，身后的脚步声没有追上来。' }, 'endCombat'));
  assert.equal(proposed.kind, 'awaitingInput', JSON.stringify(proposed).slice(0, 2000));
  assert.equal(proposed.pending.conclusionReason, 'playersEscaped');
  const accepted = answer(f, proposed.pending, 'acceptEncounterConclusion', 'escape-accept');
  assert.equal(accepted.kind, 'committed', JSON.stringify(accepted).slice(0, 2000));
  const fact = Object.values(f.state.canonicalFacts).find(entry => entry.kind === 'encounterEscapeCompleted');
  assert.deepEqual([fact?.subjectRefs, fact?.value], [[ACTOR], { encounterId }]);
  const concluded = f.events.find(event => event.eventType === 'EncounterConcluded');
  assert.equal(concluded.payload.reason, 'playersEscaped');
  assert.equal(f.state.combatRuntime.encounters[encounterId].status, 'concluded');
  assert.equal(f.events.some(event => event.eventType === 'HostilityChanged'), false);
});

test('refused with a revision diagnostic: no one named for a surrender, someone named for another outcome, a player named, one character fleeing others', () => {
  const { f } = fight('refusals');
  act(f, 'refusals', '我向守卫投降。');
  const nobody = lower(f, { kind: 'endCombat', outcome: 'foesSurrender', stopFightingRefs: [], description: '守卫举起双手。' }, 'endCombat');
  assert.deepEqual(constraints(nobody), ['combat-end:who-stops-required']);
  const named = lower(f, { kind: 'endCombat', outcome: 'foesDefeated', stopFightingRefs: [GUARD], description: '守卫倒地不起。' }, 'endCombat');
  assert.deepEqual(constraints(named), ['combat-end:no-one-stops-for-this-outcome']);
  const player = lower(f, { kind: 'endCombat', outcome: 'truce', stopFightingRefs: [PEER], description: '双方住手。' }, 'endCombat');
  assert.deepEqual(constraints(player), ['combat-end:not-an-npc-in-the-encounter']);
  assert.equal(player.diagnostics[0].repair.allowed, true);

  // SPEC 0007: one character's flight does not end a fight others are in.
  const { f: shared } = fight('shared-escape', { participants: [ACTOR, PEER, GUARD] });
  act(shared, 'shared-escape', '我冲出门跑了。');
  const alone = lower(shared, { kind: 'endCombat', outcome: 'escaped', stopFightingRefs: [], description: '你冲出了门。' }, 'endCombat');
  assert.deepEqual(constraints(alone), ['combat-end:escape-leaves-other-players']);
});


/** The actor's strike drops the guard (1 hit point); the attacker knocks it
 * out, and the stable guard's 1d4 hours to come round are rolled now. */
function downed(name) {
  const { f, encounterId } = fight(name, { hitPoints: 1 });
  const strike = f.state.combatRuntime.entities[ACTOR].abilityRefs.find(ref => ref.includes('improvised-strike'));
  assert.ok(strike);
  const waiting = apply(f, { kind: 'invokeAbility', rootActionId: `root:combat-end:${name}-strike`, sourceEntityId: ACTOR,
    abilityRef: strike, parameters: { targetEntityId: GUARD } });
  let struck = fulfil(f, waiting);
  while (struck.kind === 'awaitingRandomness') struck = fulfil(f, struck);
  assert.equal(struck.kind, 'awaitingInput', JSON.stringify(struck).slice(0, 2000));
  assert.equal(struck.pending.choiceKind, 'knockOut');
  let knocked = answer(f, struck.pending, 'knockOut', `${name}-knock-out`);
  while (knocked.kind === 'awaitingRandomness') knocked = fulfil(f, knocked);
  assert.equal(knocked.kind, 'committed', JSON.stringify(knocked).slice(0, 2000));
  assert.equal(f.state.combatRuntime.entities[GUARD].lifeState, 'unconscious');
  return { f, encounterId };
}

test('no one hostile can still fight: Rules puts the end to the player as the turn ends; accepted, the encounter ends', () => {
  const { f, encounterId } = downed('downed');
  const offered = apply(f, { kind: 'endTurn', rootActionId: 'root:combat-end:downed-end-turn', encounterId, sourceEntityId: ACTOR });
  assert.equal(offered.kind, 'awaitingInput', JSON.stringify(offered).slice(0, 2000));
  assert.equal(offered.pending.choiceKind, 'encounterConclusion');
  assert.equal(offered.events.some(event => event.eventType === 'TurnEnded'), false, 'the turn waits on the answer');
  const accepted = answer(f, offered.pending, 'acceptEncounterConclusion', 'downed-accept');
  assert.equal(accepted.kind, 'committed', JSON.stringify(accepted).slice(0, 2000));
  assert.equal(f.state.combatRuntime.encounters[encounterId].status, 'concluded');
  assert.equal(f.events.find(event => event.eventType === 'EncounterConcluded').payload.reason, 'hostilesCannotContinue');
});

test('declined, the turn Rules held ends as asked and nothing is asked again until who can still fight changes', () => {
  const { f, encounterId } = downed('declined');
  const offered = apply(f, { kind: 'endTurn', rootActionId: 'root:combat-end:declined-end-turn', encounterId, sourceEntityId: ACTOR });
  assert.equal(offered.kind, 'awaitingInput', JSON.stringify(offered).slice(0, 2000));
  const declined = answer(f, offered.pending, 'rejectEncounterConclusion', 'declined');
  assert.equal(declined.kind, 'committed', JSON.stringify(declined).slice(0, 2000));
  // The refusal ended the actor's turn as it asked; the fight goes on.
  assert.deepEqual(declined.events.filter(event => event.eventType === 'TurnEnded').map(event => event.payload.sourceEntityId), [ACTOR]);
  assert.equal(f.state.combatRuntime.encounters[encounterId].activeEntityId, GUARD);
  assert.notEqual(f.state.combatRuntime.encounters[encounterId].status, 'concluded');
  // The guard's turn (it cannot act) ends without asking again.
  const guardTurn = apply(f, { kind: 'endTurn', rootActionId: 'root:combat-end:declined-guard-turn', encounterId, sourceEntityId: GUARD });
  assert.equal(guardTurn.kind, 'committed', JSON.stringify(guardTurn).slice(0, 2000));
  assert.equal(guardTurn.events.some(event => event.eventType === 'EncounterConclusionProposed'), false);
  assert.equal(f.state.combatRuntime.encounters[encounterId].activeEntityId, ACTOR);
});

test('a player still attacking a creature that can fight back is not asked, even if it does not fight back', () => {
  // The guard never turns on the actor, but the actor is hostile to it and it stands.
  const { f, encounterId, passed } = fight('passive', { hostile: false });
  assert.equal(passed.kind, 'committed', JSON.stringify(passed).slice(0, 2000));
  assert.equal(passed.events.some(event => event.eventType === 'EncounterConclusionProposed'), false);
  const ended = apply(f, { kind: 'endTurn', rootActionId: 'root:combat-end:passive-end-turn', encounterId, sourceEntityId: ACTOR });
  assert.equal(ended.kind, 'committed', JSON.stringify(ended).slice(0, 2000));
  assert.equal(ended.events.some(event => event.eventType === 'EncounterConclusionProposed'), false);
});
