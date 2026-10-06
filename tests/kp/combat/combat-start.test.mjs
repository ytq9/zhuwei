import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_TARGET as PEER, PROBE_SCENE as SCENE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { lowerVNext2ProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { parseSubmitKpProposalBundleCandidateArguments, assertVNextProposalCandidateCapabilities } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { createVNextProposalBundleSchema } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { proposalCreatureTargetRefs } from '../../../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE as bridge, vnext2CommandToRoomLowering } from '../../../app/_runtime/lib/kp/vnext/room-bridge.ts';
import { deepSeekStrictToolSchemaIssues } from '../../../app/_runtime/lib/kp/deepseek-strict-tool.ts';
import { createEventTransition } from '../../../app/_runtime/lib/rules/v2/events.ts';
import { npcCombatTurnOptions } from '../../../app/_runtime/lib/rules/authority-read.ts';
import { geometry } from '../../support/fixtures/historical-world.mjs';

// SPEC 0012 §§3、5: a hostile act against a creature present, outside an
// encounter, starts one. The KP names the participants, the directed
// hostility and, creature by creature, who is surprised; an NPC fighting for
// the first time gets its combat statistics; Rules opens the encounter and
// requests initiative. The attack itself waits for the attacker's turn.
const GUARD = 'npc:probe-guard';
const GUARD_SCORES = { str: 14, dex: 12, con: 12, int: 10, wis: 11, cha: 10 };

function fixture(name, { npcScene, characterOverrides, spawnPoints } = {}) {
  const f = createAuthoredProbeFixture(`combat-start:${name}`, { characterOverrides, spawnPoints, npcCharacters: [{ id: GUARD, name: '守卫', mechanical: false,
    abilityScores: GUARD_SCORES, proficiencyBonus: 2, loadout: { armorClass: 12, speedFeet: 30, equipped: {}, backpack: [] } }],
    ...(npcScene === undefined ? {} : { characterScenes: { [GUARD]: npcScene },
      additionalScenes: [{ id: npcScene, name: '隔壁', geometry: geometry() }] }) });
  const result = { ...f, events: [] };
  freeze(result);
  return result;
}
function freeze(f) {
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId,
    focusRefs: [ACTOR, GUARD, PEER], intentText: '我拔出长剑，冲向守卫并挥剑攻击他。' }).context;
}
/** A stored precondition through the public event transition. */
function record(f, eventType, payload) {
  const transition = createEventTransition(f.state, f.profiles, { rootActionId: `fixture:${eventType}:${f.events.length}`, eventType, payload,
    visibilityPolicyId: 'visibility:room-authority-only', secrecy: 'internal' });
  f.events.push(transition.event); f.state = transition.state;
  assert.equal(f.runtime.replay(f.genesis, f.events).kind, 'replayed');
}
const guardStatistics = (overrides = {}) => ({ npcRef: GUARD, armorClass: 11, speedFeet: 30, hitPointsMaximum: 11, deathPolicy: 'deadAtZero',
  attacks: [{ kind: 'meleeAttack', label: '短剑', ability: 'str', reachFeet: 5, damage: '1d6+2', damageType: 'piercing' }], ...overrides });
function wire(overrides = {}) {
  return { decision: { kind: 'startCombat',
    participants: [{ creatureRef: ACTOR, surprise: { kind: 'aware' } }, { creatureRef: GUARD, surprise: { kind: 'aware' } }],
    hostilities: [{ fromRefs: [ACTOR], toRefs: [GUARD] }, { fromRefs: [GUARD], toRefs: [ACTOR] }],
    combatStatistics: [guardStatistics()],
    description: '长剑出鞘的一瞬，守卫后退半步，手按上了剑柄。', ...overrides } };
}
function lower(f, value = wire()) {
  const candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(value));
  assert.equal(candidate.kind, 'accepted', JSON.stringify(candidate));
  assert.doesNotThrow(() => assertVNextProposalCandidateCapabilities(candidate, ['startCombat']));
  return lowerVNext2ProposalBundle({ value: candidate.bundle, rootActionId: f.rootActionId, actorCharacterId: ACTOR,
    profiles: f.profiles, requiredContext: f.requiredContext, state: f.state });
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
function start(f, value = wire()) {
  const lowered = lower(f, value); assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered).slice(0, 2000));
  const room = vnext2CommandToRoomLowering(lowered.command); assert.equal(room.kind, 'accepted');
  assert.equal(bridge.validateReadSet({ profiles: f.profiles, state: f.state, requiredContext: f.requiredContext,
    rulesInput: room.input }).kind, 'valid');
  return apply(f, room.input);
}
/** Every die of the request shows `face`, the player's and the NPC's alike. */
function roll(f, waiting, face = 10) {
  assert.equal(waiting.kind, 'awaitingRandomness', JSON.stringify(waiting).slice(0, 2000));
  const rolls = waiting.randomnessRequest.hazardRolls.flatMap(spec => spec.dice.flatMap(die => Array(Number(die.count)).fill(face)));
  return apply(f, { kind: 'fulfillAuthoritativeRandomness', continuation: waiting.continuation, rolls });
}
const constraints = lowered => (lowered.diagnostics ?? []).map(diagnostic => diagnostic.constraint);

test('the start form is a native decision with a strict schema whose creature slots are the frozen creatures', () => {
  const f = fixture('schema');
  const schema = createVNextProposalBundleSchema(['startCombat'], undefined, undefined, undefined, undefined, undefined, [ACTOR, GUARD]);
  assert.deepEqual(deepSeekStrictToolSchemaIssues(schema), []);
  assert.ok(JSON.stringify(schema).includes('"startCombat"'));
  assert.ok(JSON.stringify(schema).includes(GUARD));
  const candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wire()));
  assert.equal(candidate.kind, 'accepted', JSON.stringify(candidate));
  assert.throws(() => assertVNextProposalCandidateCapabilities(candidate, ['worldInteraction']), error =>
    error.diagnostics?.some(detail => detail.constraint === 'proposal:capability-not-loaded'));
  // SPEC 0016 §4.2: the frozen context names the creatures present that can
  // take part, and these are the start form's creature choices.
  assert.deepEqual([...proposalCreatureTargetRefs(f.requiredContext)].sort(), [ACTOR, PEER, GUARD].sort());
});

test('which creature the fight is with can be a frozen choice: a clarification continues with a start', () => {
  const f = fixture('clarification');
  const { decision } = wire();
  const { kind: _kind, ...start } = decision;
  const lowered = lower(f, { decision: { kind: 'clarification', basisRefs: [GUARD], intent: '攻击守卫。', method: '拔剑上前。', question: '你要现在就对守卫动手吗？',
    choices: [{ choiceId: 'fight', label: '动手', publicRisk: '会与守卫开战。', basisRefs: [], continuation: { kind: 'startCombat', ...start } },
      { choiceId: 'hold', label: '先不动手', publicRisk: '什么也不发生。', basisRefs: [], continuation: { kind: 'cancel' } }] } });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered).slice(0, 2000));
  assert.equal(lowered.command.kind, 'frozenPlayerChoice');
  const fight = lowered.command.plan.choices.find(choice => choice.choiceId === 'fight');
  assert.equal(fight.continuation.kind, 'adjudication');
  assert.equal(fight.continuation.plan.steps[0].rulesInput.kind, 'startCombat');
});

test('an open attack starts the encounter: participants and hostility frozen, no one surprised, initiative requested for both sides', () => {
  const f = fixture('open');
  const waiting = start(f);
  // The act that starts the fight resolves no attack; it asks for initiative.
  assert.equal(waiting.kind, 'awaitingRandomness', JSON.stringify(waiting).slice(0, 2000));
  const purposes = waiting.randomnessRequest.hazardRolls.map(spec => spec.purposeKey).sort();
  assert.deepEqual(purposes.map(key => key.replace(/^inventory:.+:\d+:/u, '')), [`initiative:${ACTOR}`, `initiative:${GUARD}`].sort());
  assert.equal(f.events.some(event => event.eventType === 'AbilityInvoked'), false);
  const done = roll(f, waiting);
  assert.equal(done.kind, 'committed', JSON.stringify(done).slice(0, 2000));
  const encounter = Object.values(f.state.combatRuntime.encounters)[0];
  assert.deepEqual([...encounter.participantEntityIds].sort(), [ACTOR, GUARD].sort());
  assert.deepEqual(encounter.surprisedEntityIds, []);
  assert.deepEqual(encounter.hostilities, [{ fromEntityIds: [ACTOR], toEntityIds: [GUARD] }, { fromEntityIds: [GUARD], toEntityIds: [ACTOR] }]);
  assert.equal(f.events.find(event => event.eventType === 'EncounterStarted').payload.description, wire().decision.description);
  // Equal faces: the guard's Dexterity 12 beats the actor's 10, so it acts first.
  assert.deepEqual(encounter.turnOrderEntityIds, [GUARD, ACTOR]);
  assert.equal(encounter.activeEntityId, GUARD);
  assert.equal(encounter.round, 1);
  // SPEC 0006 §§3、8: the guard's first statistics: established scores and
  // loadout, the KP's hit points and attack.
  const guard = f.state.combatRuntime.entities[GUARD];
  assert.deepEqual(guard.hitPoints, { current: '11', maximum: '11', temporary: '0' });
  assert.equal(guard.armorClass, '11');
  assert.equal(guard.stats.str, '14');
  assert.equal(guard.abilityRefs.length, 1);
  assert.equal(f.state.combatRuntime.definitions[guard.abilityRefs[0]].mechanicalKey, '短剑');
  assert.equal(f.events.some(event => event.eventType === 'AbilityInvoked'), false);
});

test('surprise is decided creature by creature: a hidden attacker surprises a guard that did not notice it, never one that did', () => {
  const hidden = fixture('hidden');
  record(hidden, 'ConditionChanged', { entityId: ACTOR, conditions: { hidden: { stealthTotal: '18' } } });
  freeze(hidden);
  const surprised = wire({ participants: [{ creatureRef: ACTOR, surprise: { kind: 'aware' } },
    { creatureRef: GUARD, surprise: { kind: 'surprised', basis: '行动者藏在阀门后，隐匿 18 高于守卫的被动察觉 10。' } }] });
  const done = roll(hidden, start(hidden, surprised));
  assert.equal(done.kind, 'committed', JSON.stringify(done).slice(0, 2000));
  const encounter = Object.values(hidden.state.combatRuntime.encounters)[0];
  assert.deepEqual(encounter.surprisedEntityIds, [GUARD]);

  // In plain sight nobody is surprised; the diagnostic says what would have to hold.
  const open = fixture('not-hidden');
  const refused = lower(open, surprised);
  assert.equal(refused.kind, 'rejected');
  const diagnostic = refused.diagnostics.find(entry => entry.constraint === 'combat-start:surprise-needs-unnoticed-threats');
  assert.deepEqual(diagnostic.path, ['terminal', 'participants', 1, 'surprise']);
  assert.deepEqual(diagnostic.expected.noticedThreatRefs, [ACTOR]);
  assert.equal(diagnostic.repair.allowed, true);
});

test('refused with a revision diagnostic: no hostility, a target not present, an actor already fighting, or statistics missing', () => {
  const f = fixture('refusals');
  const noHostility = lower(f, wire({ hostilities: [] }));
  assert.equal(noHostility.kind, 'rejected');
  assert.ok(constraints(noHostility).includes('combat-start:hostility-required'), JSON.stringify(noHostility));

  const elsewhere = fixture('absent', { npcScene: 'scene:probe-next-door' });
  const absent = lower(elsewhere);
  assert.equal(absent.kind, 'rejected');
  assert.ok(constraints(absent).includes('combat-start:participant-not-present'), JSON.stringify(absent));

  const noStatistics = lower(f, wire({ combatStatistics: [] }));
  assert.ok(constraints(noStatistics).includes('combat-start:combat-statistics-required'));
  const loadout = lower(f, wire({ combatStatistics: [guardStatistics({ armorClass: 15 })] }));
  const differs = loadout.diagnostics.find(entry => entry.constraint === 'combat-start:statistics-differ-from-established-loadout');
  assert.deepEqual([differs.expected.armorClass, differs.expected.speedFeet], [11, 30]);

  // An actor already in a running encounter attacks on its turn instead.
  const fighting = fixture('fighting');
  roll(fighting, start(fighting));
  fighting.rootActionId = `${fighting.rootActionId}:again`;
  freeze(fighting);
  const again = lower(fighting, wire({ combatStatistics: [] }));
  assert.equal(again.kind, 'rejected');
  assert.ok(constraints(again).includes('combat-start:actor-already-in-encounter'), JSON.stringify(again));
});

test('SPEC 0012 §3.4: turning on a creature already fighting joins its encounter, with an initiative entry placed by its total', () => {
  const f = fixture('join');
  // The peer and the guard are already fighting; the actor is not.
  const opening = lower(f, wire());
  assert.equal(opening.kind, 'accepted');
  const peerStart = structuredClone(vnext2CommandToRoomLowering(opening.command).input);
  peerStart.actorCharacterId = PEER;
  peerStart.steps[0].rulesInput.actorCharacterId = PEER;
  const startPlan = peerStart.steps[0].rulesInput.plan;
  startPlan.start.participants = [{ creatureRef: PEER, surprise: { kind: 'aware' } }, { creatureRef: GUARD, surprise: { kind: 'aware' } }];
  startPlan.start.hostilities = [{ fromRefs: [PEER], toRefs: [GUARD] }, { fromRefs: [GUARD], toRefs: [PEER] }];
  startPlan.readSet = startPlan.readSet.filter(binding => binding.ref !== ACTOR);
  const peerContext = freezeAuthoredProbeContext({ ...f, actorCharacterId: PEER }, f.state, { rootActionId: f.rootActionId, focusRefs: [PEER, GUARD] }).context;
  const peerTimeline = peerContext.entries.find(entry => entry.entryRef === `character-timeline:${PEER}`);
  startPlan.readSet = [...startPlan.readSet.filter(binding => !binding.ref.startsWith('character-timeline:')),
    { ref: PEER, revisionOrHash: peerContext.entries.find(entry => entry.entryRef === PEER).revisionOrHash },
    { ref: `character-timeline:${PEER}`, revisionOrHash: peerTimeline.revisionOrHash }].sort((a, b) => a.ref < b.ref ? -1 : 1);
  const begun = roll(f, apply(f, peerStart));
  assert.equal(begun.kind, 'committed', JSON.stringify(begun).slice(0, 2000));
  const encounterId = Object.keys(f.state.combatRuntime.encounters)[0];
  assert.deepEqual(f.state.combatRuntime.encounters[encounterId].turnOrderEntityIds, [GUARD, PEER]);

  f.rootActionId = `${f.rootActionId}:join`;
  freeze(f);
  // Surprise is decided when a fight begins; a newcomer surprises no one.
  const lateSurprise = lower(f, wire({ combatStatistics: [], participants: [{ creatureRef: ACTOR, surprise: { kind: 'aware' } },
    { creatureRef: GUARD, surprise: { kind: 'surprised', basis: '它在看别处。' } }] }));
  assert.ok(constraints(lateSurprise).includes('combat-start:surprise-only-when-the-fight-begins'), JSON.stringify(lateSurprise));
  const waiting = start(f, wire({ combatStatistics: [], description: '行动者冲进了已经打起来的战团。' }));
  assert.deepEqual(waiting.randomnessRequest.hazardRolls.map(spec => spec.purposeKey.replace(/^inventory:.+:\d+:/u, '')), [`initiative:${ACTOR}`]);
  const joined = roll(f, waiting, 20);
  assert.equal(joined.kind, 'committed', JSON.stringify(joined).slice(0, 2000));
  const encounter = f.state.combatRuntime.encounters[encounterId];
  assert.deepEqual([...encounter.participantEntityIds].sort(), [ACTOR, GUARD, PEER].sort());
  assert.equal(Object.keys(f.state.combatRuntime.encounters).length, 1);
  // A 20 puts the actor first, a place this round has passed: its first turn
  // is next round, and the guard keeps the turn it has.
  assert.deepEqual(encounter.turnOrderEntityIds, [ACTOR, GUARD, PEER]);
  assert.equal(encounter.activeEntityId, GUARD);
  assert.equal(encounter.turnCursor, 1);
  assert.equal(f.events.find(event => event.eventType === 'EncounterJoined').payload.description, '行动者冲进了已经打起来的战团。');
});

function settleNative(f, result, choose = request => request.purposeKey.startsWith('initiative:') ? 10
  : request.purposeKey.startsWith('attack:') ? 15 : request.purposeKey.startsWith('save:') ? 1 : 2) {
  while (result.kind === 'awaitingRandomness') {
    if (result.randomnessRequests === undefined) { result = roll(f, result); continue; }
    result = apply(f, {
    kind: 'authoritativeRandomness', resolutionId: result.resolutionId, responseId: `authority:${result.resolutionId}`,
    continuationCapability: result.continuationCapability,
    randomnessResults: result.randomnessRequests.map(request => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
      draws: request.dice.map(term => ({ sides: Number(term.sides), faces: Array(Number(term.count)).fill(Math.min(Number(term.sides), choose(request))) })) })),
  });
  }
  return result;
}
function guardAbility(f, abilityRef, parameters = {}) {
  return apply(f, { kind: 'invokeAbility', rootActionId: `root:guard-ability:${f.events.length}`, sourceEntityId: GUARD, abilityRef, parameters });
}

test('SPEC 0012 §§6.3,9,11: first NPC statistics execute restricted Multiattack, damage defences and on-hit effects', () => {
  const f = fixture('multiattack-effects');
  const stats = guardStatistics({ damageDefenses: { immune: ['poison'], resistant: ['fire'], vulnerable: ['cold'] },
    multiattack: [{ attackIndex: 0, count: 2 }], attacks: [{ kind: 'meleeAttack', label: '带毒短剑', ability: 'str',
      reachFeet: 5, damage: '1d4', damageType: 'piercing', effects: [{ kind: 'grantEffect', condition: 'poisoned',
        duration: { kind: 'turnBoundary', subject: 'target', edge: 'turnEnd' } }], effectSave: [{ ability: 'con', dc: 13 }] }] });
  assert.equal(settleNative(f, start(f, wire({ combatStatistics: [stats] }))).kind, 'committed');
  const body = f.state.combatRuntime.entities[GUARD];
  assert.deepEqual(body.damageDefenses, stats.damageDefenses);
  const multi = body.abilityRefs.find(ref => ref.endsWith(':multiattack'));
  const strike = body.abilityRefs.find(ref => ref.endsWith(':0'));
  assert.ok(multi && strike);
  assert.equal(guardAbility(f, multi).kind, 'committed');
  assert.equal(f.state.combatRuntime.entities[GUARD].turn.action, '0');
  assert.equal(guardAbility(f, 'action:grapple', { targetEntityId: ACTOR }).kind, 'rejected', 'Multiattack cannot buy an Attack-action replacement');
  const first = settleNative(f, guardAbility(f, strike, { targetEntityId: ACTOR }));
  assert.equal(first.kind, 'committed', JSON.stringify(first));
  assert.ok(Object.values(f.state.combatRuntime.effects).some(effect => effect.condition === 'poisoned' && effect.targetEntityId === ACTOR));
  const second = settleNative(f, guardAbility(f, strike, { targetEntityId: ACTOR }), request => request.purposeKey.startsWith('attack:') ? 1 : 2);
  assert.equal(second.kind, 'committed');
  assert.equal(second.events.some(event => event.eventType === 'EffectApplied'), false, 'miss adds no effect');
  assert.equal(guardAbility(f, strike, { targetEntityId: ACTOR }).kind, 'rejected');
  assert.equal(guardAbility(f, multi).kind, 'rejected', 'no self-replenishing attack grants');
});

for (const [abilityRef, skill] of [['action:grapple', 'athletics'], ['action:shove', 'acrobatics']]) {
  test(`SPEC 0012 §6.3: ${abilityRef} waits for the defending player to choose ${skill}, before cost or dice`, () => {
    const f = fixture(`defence-${skill}`);
    assert.equal(settleNative(f, start(f)).kind, 'committed');
    const before = structuredClone(f.state.combatRuntime.entities[GUARD].turn);
    const forged = guardAbility(f, abilityRef, { targetEntityId: ACTOR, defenderContestAbility: skill });
    assert.equal(forged.kind, 'rejected');
    const pending = guardAbility(f, abilityRef, { targetEntityId: ACTOR });
    assert.equal(pending.kind, 'awaitingInput', JSON.stringify(pending));
    assert.deepEqual([pending.pending.choiceKind, pending.pending.controllerEntityId], ['contestDefense', ACTOR]);
    assert.deepEqual(f.state.combatRuntime.entities[GUARD].turn, before);
    assert.equal(pending.events.some(event => event.eventType === 'RandomnessRequested'), false);
    const rolled = apply(f, { kind: 'answerPendingInput', pendingInputId: pending.pending.pendingInputId,
      responseId: `response:${skill}`, answer: { kind: 'contestDefense', skill } });
    assert.equal(rolled.kind, 'awaitingRandomness', JSON.stringify(rolled));
    assert.equal(rolled.randomnessRequests.find(request => request.frozenParameters.entityId === ACTOR).frozenParameters.ability, skill);
    assert.equal(settleNative(f, rolled).kind, 'committed');
    assert.equal(f.state.combatRuntime.entities[GUARD].turn.action, '0');
  });
}


test('SPEC 0012 §12.1: an NPC offers and executes the same Medicine first aid for a dying ally', () => {
  const f = fixture('npc-first-aid', { characterOverrides: { [PEER]: { hitPoints: { current: 0, maximum: 20 } } },
    spawnPoints: [{ x: '100', y: '100', elevation: '0' }, { x: '200', y: '100', elevation: '0' }, { x: '200', y: '160', elevation: '0' }] });
  assert.equal(settleNative(f, start(f)).kind, 'committed');
  const options = npcCombatTurnOptions(f.profiles, f.state, GUARD);
  assert.ok(options.abilities.find(ability => ability.abilityRef === 'action:stabilize')?.targets.some(target => target.ref === PEER));
  const aided = settleNative(f, guardAbility(f, 'action:stabilize', { targetEntityId: PEER }), request => request.purposeKey.startsWith('check:') ? 10 : 2);
  assert.equal(aided.kind, 'committed', JSON.stringify(aided));
  assert.equal(f.state.combatRuntime.entities[PEER].conditions.stable, true);
  assert.equal(f.state.combatRuntime.entities[PEER].hitPoints.current, '0');
  assert.equal(f.state.combatRuntime.entities[GUARD].turn.action, '0');
});
