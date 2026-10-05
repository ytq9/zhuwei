import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_SCENE, PROBE_TARGET as PEER } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { encodeVNextStrictToolBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { mergeNpcReplies, npcReplyModelInput, npcReplySteps, readNpcReply, NPC_REPLY_TOOL_NAME } from '../../../app/_runtime/lib/kp/vnext/npc-reply.ts';
import { encodeNpcReplyResult } from '../../../app/_runtime/lib/kp/vnext/proposal-filling-interface.ts';
import { validateVNextProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-validator.ts';
import { toolCallResponse } from '../../support/fixtures/vnext-npc-replies.mjs';
import { lowerVNext2ProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { parseSubmitKpProposalBundleCandidateArguments, assertVNextProposalCandidateCapabilities } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE as bridge, vnext2CommandToRoomLowering } from '../../../app/_runtime/lib/kp/vnext/room-bridge.ts';
import { npcCombatTurnOptions, npcCombatTurnPlanIssues } from '../../../app/_runtime/lib/rules/authority-read.ts';
import { NPC_FIGHT_SO_FAR_ITEMS, npcFightSoFar } from '../../../app/_runtime/lib/room/npc-combat-turn-host.ts';

// SPEC 0006 §7, SPEC 0012 §§3.3、13 (ADR 0117): an NPC in a fight decides from
// its own view whether to keep fighting, yield to some or all of those it
// fights, accept a surrender, or turn on someone again. Rules records each
// as a hostility change the NPC makes, and the players still decide whether
// the fight ends: Rules asks them once no one hostile to them can still
// fight, a foe that yielded counting as no longer hostile. SPEC 0006 §12
// item 8: some foes may yield while others fight on, and one that yielded
// may fight again; the players still answer the end.
const GUARD = 'npc:probe-guard', SECOND = 'npc:probe-second';
const SCORES = { str: 14, dex: 12, con: 12, int: 10, wis: 11, cha: 10 };
const npc = (id, name) => ({ id, name, mechanical: false, abilityScores: SCORES, proficiencyBonus: 2,
  loadout: { armorClass: 12, speedFeet: 30, equipped: {}, backpack: [] } });
const statistics = (npcRef, hitPointsMaximum) => ({ npcRef, armorClass: 11, speedFeet: 30, hitPointsMaximum, deathPolicy: 'deadAtZero',
  attacks: [{ kind: 'meleeAttack', label: '短剑', ability: 'str', reachFeet: 5, damage: '1d6+2', damageType: 'piercing' }] });

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
function act(f, name, intentText) {
  f.rootActionId = `root:npc-stance:${name}`;
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId,
    focusRefs: [ACTOR, PEER, ...f.foes], intentText }).context;
}
function lowerAndRun(f, decision, loaded) {
  const candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify({ decision }));
  assert.equal(candidate.kind, 'accepted', JSON.stringify(candidate));
  assert.doesNotThrow(() => assertVNextProposalCandidateCapabilities(candidate, [loaded]));
  const lowered = lowerVNext2ProposalBundle({ value: candidate.bundle, rootActionId: f.rootActionId, actorCharacterId: ACTOR,
    profiles: f.profiles, requiredContext: f.requiredContext, state: f.state });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered).slice(0, 2000));
  const room = vnext2CommandToRoomLowering(lowered.command); assert.equal(room.kind, 'accepted');
  assert.equal(bridge.validateReadSet({ profiles: f.profiles, state: f.state, requiredContext: f.requiredContext, rulesInput: room.input }).kind, 'valid');
  return apply(f, room.input);
}
/** Every die of a native combat request shows its largest face, or `face`
 * when that is smaller. */
function fulfil(f, waiting, face = Infinity) {
  assert.equal(waiting.kind, 'awaitingRandomness', JSON.stringify(waiting).slice(0, 2000));
  return apply(f, { kind: 'authoritativeRandomness', resolutionId: waiting.resolutionId, responseId: `authority:${waiting.resolutionId}`,
    continuationCapability: waiting.continuationCapability,
    randomnessResults: waiting.randomnessRequests.map(request => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
      draws: request.dice.map(term => ({ sides: Number(term.sides), faces: Array(Number(term.count)).fill(Math.min(face, Number(term.sides))) })) })) });
}
const encounterOf = f => Object.values(f.state.combatRuntime.encounters)[0];
/** Why the end was put to the players, as the open choice holds it. */
const reasonOf = (f, pending) => f.state.combatRuntime.pendingInputs[pending.pendingInputId]?.proposal?.reason;
const answer = (f, pending, kind, name) => apply(f, { kind: 'answerPendingInput', pendingInputId: pending.pendingInputId,
  responseId: `response:${name}`, answer: { kind } });

/** The actor attacks the foes in the open; each foe fights back. Every
 * initiative die shows 10: the foes (Dexterity 12) act before the actor. */
function fight(name, { foes = [[GUARD, 11]] } = {}) {
  const f = createAuthoredProbeFixture(`npc-stance:${name}`, { npcCharacters: foes.map(([id], index) => npc(id, index === 0 ? '守卫' : '帮手')),
    characterOverrides: { [PEER]: { abilityScores: { str: 10, dex: 8, con: 10, int: 10, wis: 10, cha: 10 } } } });
  f.events = []; f.foes = foes.map(([id]) => id);
  act(f, 'start', '我拔出长剑，冲向守卫并挥剑攻击他。');
  const refs = [ACTOR, ...f.foes];
  const waiting = lowerAndRun(f, { kind: 'startCombat', participants: refs.map(creatureRef => ({ creatureRef, surprise: { kind: 'aware' } })),
    hostilities: [{ fromRefs: [ACTOR], toRefs: f.foes }, { fromRefs: f.foes, toRefs: [ACTOR] }],
    combatStatistics: foes.map(([id, hitPoints]) => statistics(id, hitPoints)),
    description: '长剑出鞘的一瞬，守卫后退半步，手按上了剑柄。' }, 'startCombat');
  assert.equal(waiting.kind, 'awaitingRandomness', JSON.stringify(waiting).slice(0, 2000));
  const rolls = waiting.randomnessRequest.hazardRolls.flatMap(spec => spec.dice.flatMap(die => Array(Number(die.count)).fill(10)));
  assert.equal(apply(f, { kind: 'fulfillAuthoritativeRandomness', continuation: waiting.continuation, rolls }).kind, 'committed');
  return f;
}
let ended = 0;
/** Ends turns as they come until `who` is the active combatant. */
function passUntil(f, who) {
  for (let guard = 0; encounterOf(f).activeEntityId !== who && guard < 8; guard++) {
    const encounter = encounterOf(f);
    const passed = apply(f, { kind: 'endTurn', rootActionId: `root:npc-stance:pass:${ended++}`, encounterId: encounter.encounterId,
      sourceEntityId: encounter.activeEntityId });
    assert.equal(passed.kind, 'committed', JSON.stringify(passed).slice(0, 2000));
  }
  assert.equal(encounterOf(f).activeEntityId, who);
}
/** The NPC whose turn it is takes the given plan, as the Room hands it over. */
function npcTurn(f, npcId, steps) {
  const encounter = encounterOf(f);
  assert.equal(encounter.activeEntityId, npcId);
  const prefix = `npc-turn:${encounter.encounterId}:${encounter.round}:${encounter.turnCursor}:${npcId}:`;
  const segment = Object.keys(f.state.receipts).filter(root => root.startsWith(prefix)).length;
  const root = `${prefix}${segment}`;
  const result = apply(f, { kind: 'takeNpcCombatTurn', proposalId: root, encounterId: encounter.encounterId, sourceEntityId: npcId, steps });
  return { result, root, own: f.events.filter(event => event.rootActionId === root) };
}
const hostilityChanges = own => own.filter(event => event.eventType === 'HostilityChanged').map(event => event.payload);
const strikeRef = (f, npcId) => npcCombatTurnOptions(f.profiles, f.state, npcId).abilities.find(entry => entry.name === '短剑')?.abilityRef;

test('the guard yields on its own turn: its words are heard, it stops fighting, and as its turn ends the player is asked; accepted, the fight ends', () => {
  const f = fight('yield');
  passUntil(f, ACTOR); passUntil(f, GUARD);
  const options = npcCombatTurnOptions(f.profiles, f.state, GUARD);
  // The guard sees whom it fights, who fights it, and whether each can still fight.
  assert.deepEqual(options.stance.fighting, [{ ref: ACTOR, name: ACTOR, canFight: true }]);
  assert.deepEqual(options.stance.fightingYou, [{ ref: ACTOR, name: ACTOR, canFight: true }]);
  assert.deepEqual(options.stance.others, []);
  assert.deepEqual([options.stance.yieldRefs, options.stance.turnOnRefs, options.speak], [[ACTOR], [], true]);

  const { result, own } = npcTurn(f, GUARD, [{ kind: 'speak', words: '别打了，我投降！' }, { kind: 'yield', fromRefs: [ACTOR] }, { kind: 'endTurn' }]);
  assert.equal(result.kind, 'awaitingInput', JSON.stringify(result).slice(0, 2000));
  // Its words are its own claim, and every creature present that can hear holds them.
  const said = own.find(event => event.eventType === 'SourceClaimCreated');
  assert.deepEqual([said.payload.speakerId, said.payload.semanticContent], [GUARD, '别打了，我投降！']);
  assert.deepEqual(own.filter(event => event.eventType === 'KnowledgeAcquired').map(event => event.payload.characterId).sort(), [ACTOR, PEER]);
  assert.equal(f.state.knowledge[ACTOR][said.payload.claimId].content, '别打了，我投降！');
  // The guard itself stops fighting; the player's side is the player's own.
  assert.deepEqual(hostilityChanges(own), [{ encounterId: encounterOf(f).encounterId, sourceEntityId: GUARD,
    previousTargetEntityIds: [ACTOR], targetEntityIds: [], reason: 'npcSurrendered' }]);
  assert.deepEqual(encounterOf(f).hostilities, [{ fromEntityIds: [ACTOR], toEntityIds: [GUARD] }]);
  // The player's anger at a foe that yielded does not keep the question back.
  assert.deepEqual([result.pending.choiceKind, result.pending.controllerEntityId, reasonOf(f, result.pending)],
    ['encounterConclusion', ACTOR, 'npcSurrendered']);
  const accepted = answer(f, result.pending, 'acceptEncounterConclusion', 'yield-accept');
  assert.equal(accepted.kind, 'committed', JSON.stringify(accepted).slice(0, 2000));
  assert.equal(encounterOf(f).status, 'concluded');
  assert.equal(f.events.find(event => event.eventType === 'EncounterConcluded').payload.reason, 'npcSurrendered');
  // The plan ends with the fight.
  assert.equal(f.events.filter(event => event.eventType === 'NpcCombatTurnSettled').at(-1).payload.outcome, 'completed');
});

test('declined, the fight goes on: the player may still strike the guard, and the guard may turn on the player again, which asks the rest of its turn anew', () => {
  const f = fight('turn-on');
  passUntil(f, ACTOR); passUntil(f, GUARD);
  const { result } = npcTurn(f, GUARD, [{ kind: 'yield', fromRefs: [ACTOR] }, { kind: 'endTurn' }]);
  const declined = answer(f, result.pending, 'rejectEncounterConclusion', 'turn-on-decline');
  assert.equal(declined.kind, 'committed', JSON.stringify(declined).slice(0, 2000));
  assert.equal(encounterOf(f).activeEntityId, ACTOR);
  // The player is still hostile to the guard and may strike it.
  const strike = f.state.combatRuntime.entities[ACTOR].abilityRefs.find(ref => ref.includes('unarmed-strike'));
  const swing = apply(f, { kind: 'invokeAbility', rootActionId: 'root:npc-stance:player-strike', sourceEntityId: ACTOR,
    abilityRef: strike, parameters: { targetEntityId: GUARD } });
  assert.equal(swing.kind, 'awaitingRandomness', JSON.stringify(swing).slice(0, 2000));
  let struck = fulfil(f, swing);
  while (struck.kind === 'awaitingRandomness') struck = fulfil(f, struck);
  assert.equal(struck.kind, 'committed', JSON.stringify(struck).slice(0, 2000));
  passUntil(f, GUARD);

  // The yielded guard has no one to strike; it may turn on the player.
  const before = npcCombatTurnOptions(f.profiles, f.state, GUARD);
  assert.deepEqual([before.stance.fighting, before.stance.yieldRefs, before.stance.turnOnRefs], [[], [], [ACTOR]]);
  assert.equal(before.abilities.some(entry => entry.targets.some(target => target.ref === ACTOR)), false);
  const turned = npcTurn(f, GUARD, [{ kind: 'speak', words: '你还敢打？' }, { kind: 'turnOn', targetRefs: [ACTOR] }, { kind: 'endTurn' }]);
  assert.equal(turned.result.kind, 'committed', JSON.stringify(turned.result).slice(0, 2000));
  assert.deepEqual(hostilityChanges(turned.own).map(change => [change.previousTargetEntityIds, change.targetEntityIds, change.reason]),
    [[[], [ACTOR], 'npcTurnedHostile']]);
  // The plan stops after the turn; the turn is still the guard's and is asked again.
  assert.deepEqual(turned.own.find(event => event.eventType === 'NpcCombatTurnSettled').payload,
    { rootActionId: turned.root, npcCharacterId: GUARD, outcome: 'stopped', stoppedAtStep: 2, reason: 'turnOn:asked-again' });
  assert.equal(turned.own.some(event => event.eventType === 'TurnEnded'), false);
  assert.equal(encounterOf(f).activeEntityId, GUARD);
  assert.equal(encounterOf(f).conclusionProposedWhileAble, undefined, 'turning on the player again clears the refused end');
  const again = npcCombatTurnOptions(f.profiles, f.state, GUARD);
  assert.deepEqual(again.stance.fighting.map(entry => entry.ref), [ACTOR]);
  const knife = strikeRef(f, GUARD);
  assert.ok(knife);
  const attacked = npcTurn(f, GUARD, [{ kind: 'ability', abilityRef: knife, target: { kind: 'creature', ref: ACTOR } }, { kind: 'endTurn' }]);
  assert.match(attacked.root, /:1$/u);
  assert.notEqual(attacked.result.kind, 'rejected', JSON.stringify(attacked.result).slice(0, 2000));
  // Not a critical: the actor stays on its feet.
  let next = attacked.result;
  while (next.kind === 'awaitingRandomness') next = fulfil(f, next, 10);
  assert.ok(f.events.some(event => event.rootActionId === attacked.root && event.eventType === 'AbilityInvoked' && event.payload.sourceEntityId === GUARD));

  // Yielding again after the turn asks the end again.
  passUntil(f, ACTOR); passUntil(f, GUARD);
  const yieldedAgain = npcTurn(f, GUARD, [{ kind: 'yield', fromRefs: [ACTOR] }, { kind: 'endTurn' }]);
  assert.equal(yieldedAgain.result.kind, 'awaitingInput', JSON.stringify(yieldedAgain.result).slice(0, 2000));
  assert.equal(reasonOf(f, yieldedAgain.result.pending), 'npcSurrendered');
});

test('partial surrender: of two foes one yields and the other fights on; nothing is asked until the other is down, then the end is asked for the one that yielded', () => {
  // The guard (1 hit point) stands next to the actor; the second foe a little farther off.
  const f = fight('partial', { foes: [[GUARD, 1], [SECOND, 11]] });
  passUntil(f, SECOND);
  const yielded = npcTurn(f, SECOND, [{ kind: 'yield', fromRefs: [ACTOR] }, { kind: 'endTurn' }]);
  assert.equal(yielded.result.kind, 'committed', JSON.stringify(yielded.result).slice(0, 2000));
  assert.equal(yielded.own.some(event => event.eventType === 'EncounterConclusionProposed'), false, 'the second foe still fights');
  passUntil(f, ACTOR);
  assert.equal(f.events.some(event => event.eventType === 'EncounterConclusionProposed'), false);
  // The actor knocks the guard, who fought on, out.
  const strike = f.state.combatRuntime.entities[ACTOR].abilityRefs.find(ref => ref.includes('unarmed-strike'));
  let struck = fulfil(f, apply(f, { kind: 'invokeAbility', rootActionId: 'root:npc-stance:partial-strike', sourceEntityId: ACTOR,
    abilityRef: strike, parameters: { targetEntityId: GUARD } }));
  while (struck.kind === 'awaitingRandomness') struck = fulfil(f, struck);
  assert.equal(struck.kind, 'awaitingInput', JSON.stringify(struck).slice(0, 2000));
  let knocked = answer(f, struck.pending, 'knockOut', 'partial-knock-out');
  while (knocked.kind === 'awaitingRandomness') knocked = fulfil(f, knocked);
  assert.equal(f.state.combatRuntime.entities[GUARD].lifeState, 'unconscious');
  const encounterId = encounterOf(f).encounterId;
  const offered = apply(f, { kind: 'endTurn', rootActionId: 'root:npc-stance:partial-end-turn', encounterId, sourceEntityId: ACTOR });
  assert.equal(offered.kind, 'awaitingInput', JSON.stringify(offered).slice(0, 2000));
  // The one still standing yielded: the reason is its surrender.
  assert.equal(reasonOf(f, offered.pending), 'npcSurrendered');
});

test("the KP's surrender records only the actor's side; the guard decides on its turn whether to accept (the end is asked) or strike (the fight goes on)", () => {
  for (const accepts of [true, false]) {
    const f = fight(`surrender-${accepts}`);
    passUntil(f, ACTOR);
    act(f, `surrender-${accepts}`, '我扔下长剑，向守卫投降。');
    const surrendered = lowerAndRun(f, { kind: 'endCombat', outcome: 'actorSurrenders', stopFightingRefs: [GUARD],
      description: '你把长剑丢在脚边，举起了双手。' }, 'endCombat');
    assert.equal(surrendered.kind, 'committed', JSON.stringify(surrendered).slice(0, 2000));
    assert.deepEqual(hostilityChanges(surrendered.events).map(change => [change.sourceEntityId, change.targetEntityIds, change.reason]),
      [[ACTOR, [], 'playersSurrendered']]);
    assert.equal(surrendered.events.some(event => event.eventType === 'EncounterConclusionProposed'), false, 'the guard has not answered');
    passUntil(f, GUARD);
    const options = npcCombatTurnOptions(f.profiles, f.state, GUARD);
    assert.deepEqual([options.stance.fighting.map(entry => entry.ref), options.stance.fightingYou], [[ACTOR], []]);
    if (accepts) {
      const { result, own } = npcTurn(f, GUARD, [{ kind: 'yield', fromRefs: [ACTOR] }, { kind: 'endTurn' }]);
      assert.equal(hostilityChanges(own)[0].reason, 'playersSurrendered');
      assert.equal(result.kind, 'awaitingInput', JSON.stringify(result).slice(0, 2000));
      assert.equal(reasonOf(f, result.pending), 'playersSurrendered');
      assert.equal(answer(f, result.pending, 'acceptEncounterConclusion', 'surrender-accept').kind, 'committed');
      assert.equal(encounterOf(f).status, 'concluded');
    } else {
      const { result, root } = npcTurn(f, GUARD, [{ kind: 'ability', abilityRef: strikeRef(f, GUARD), target: { kind: 'creature', ref: ACTOR } }, { kind: 'endTurn' }]);
      let next = result;
      while (next.kind === 'awaitingRandomness') next = fulfil(f, next, 10);
      assert.ok(f.events.some(event => event.rootActionId === root && event.eventType === 'AbilityInvoked' && event.payload.sourceEntityId === GUARD));
      assert.equal(f.events.some(event => event.eventType === 'EncounterConclusionProposed'), false);
      assert.notEqual(encounterOf(f).status, 'concluded');
    }
  }
});

test('refused plans: a strike after yielding to the same creature, a turn that is not last, two speeches, a yield to one not fought, a turn on one already fought', () => {
  const f = fight('issues');
  passUntil(f, GUARD);
  const options = npcCombatTurnOptions(f.profiles, f.state, GUARD);
  const knife = strikeRef(f, GUARD), end = { kind: 'endTurn' };
  const issues = steps => npcCombatTurnPlanIssues(options, steps);
  assert.deepEqual(issues([{ kind: 'yield', fromRefs: [ACTOR] }, { kind: 'ability', abilityRef: knife, target: { kind: 'creature', ref: ACTOR } }, end]),
    ['steps[1]:ability:target-yielded']);
  assert.deepEqual(issues([{ kind: 'speak', words: '站住！' }, { kind: 'speak', words: '我说站住！' }, end]), ['steps[1]:speak:once']);
  assert.deepEqual(issues([{ kind: 'yield', fromRefs: [PEER] }, end]), ['steps[0]:yield:not-fighting']);
  assert.deepEqual(issues([{ kind: 'turnOn', targetRefs: [ACTOR] }, end]), ['steps[0]:turnOn:unavailable']);
  assert.deepEqual(issues([{ kind: 'yield', fromRefs: [ACTOR] }, { kind: 'turnOn', targetRefs: [ACTOR] }, { kind: 'basic', action: 'dodge' }, end]),
    ['steps[1]:turnOn:unavailable', 'steps[1]:turnOn:must-precede-endTurn']);
  assert.deepEqual(issues([{ kind: 'speak', words: '投降吧。' }, { kind: 'yield', fromRefs: [ACTOR] }, end]), []);
});

test("what the guard saw of the fight is its own Viewer claims, most recent first: its words as its own, the actor's blow on it, never a listener's private copy", () => {
  const f = fight('perceive');
  passUntil(f, ACTOR); passUntil(f, GUARD);
  npcTurn(f, GUARD, [{ kind: 'speak', words: '退后！' }, { kind: 'basic', action: 'dodge' }, { kind: 'endTurn' }]);
  passUntil(f, ACTOR);
  const strike = f.state.combatRuntime.entities[ACTOR].abilityRefs.find(ref => ref.includes('unarmed-strike'));
  let struck = apply(f, { kind: 'invokeAbility', rootActionId: 'combat-act:perceive-strike', sourceEntityId: ACTOR,
    abilityRef: strike, parameters: { targetEntityId: GUARD } });
  while (struck.kind === 'awaitingRandomness') struck = fulfil(f, struck, 10);
  passUntil(f, GUARD);
  const items = npcFightSoFar({ profiles: f.profiles, genesis: f.genesis, events: f.events, npcId: GUARD,
    encounterId: encounterOf(f).encounterId, actorOf: (_receipt, root, subjects) => root.startsWith('npc-turn:') ? GUARD
      : subjects.includes(ACTOR) ? ACTOR : subjects[0] }, f.runtime);
  assert.ok(items.length > 0 && items.length <= NPC_FIGHT_SO_FAR_ITEMS);
  // The latest act first: the actor's blow on the guard.
  assert.equal(items[0].by ?? items.find(item => item.by === ACTOR)?.by, ACTOR, JSON.stringify(items));
  const blowAt = items.findIndex(item => item.by === ACTOR), wordsAt = items.findIndex(item => item.what.includes('退后'));
  assert.ok(blowAt >= 0 && wordsAt > blowAt, JSON.stringify(items));
  // Its words once, as its own claim; the actor's and the peer's private copies are theirs.
  const words = items.filter(item => item.what.includes('退后'));
  assert.equal(words.length, 1, JSON.stringify(words));
  assert.equal(words[0].by, GUARD);
  assert.ok(!words[0].what.includes('传达'), words[0].what);
});

/** The KP's ruling of words said to an NPC in the fight: a plain
 * conversation in the actor's scene, no check, taking no time of its own. */
function wordsTo(npcRef, speech) {
  return { mode: 'adjudication', basisRefs: [npcRef], terminal: null,
    adjudication: { kind: 'directSuccess', durationMicros: '0', risk: '对方可能不理会。', successOutcome: '对方听到了这番话。' },
    proposals: [{ kind: 'social', basisRefs: [npcRef], consumes: [], produces: [], outcomeBinding: 'always', sceneRef: PROBE_SCENE, npcRef,
      actorSpeech: speech, goal: '让对方住手。', method: '当面喊话。', communication: 'spokenConversation', audience: 'participants',
      branches: { success: { outcomeCode: 'outcome:heard', summary: '对方听到了这番话。', npcPerceives: null,
        response: { kind: 'speech', text: '……', motive: '按自己的处境回答。', basis: [{ kind: 'npcContext', ref: npcRef }] }, consequences: [] },
      failure: null } }] };
}
/** The guard's own reply to `domain`, with the stance it takes. */
function guardReply(domain, text, combatStance) {
  return { ...encodeNpcReplyResult({ ...domain.proposals[0].branches.success,
    response: { kind: 'speech', text, motive: '按自己的伤势和目标决定。', basis: [{ kind: 'npcContext', ref: GUARD }] } }, GUARD),
    ...(combatStance === undefined ? {} : { combatStance }) };
}
/** Merges the reply into the ruling and runs the act. */
function sayAndReply(f, domain, written) {
  const candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(domain)));
  assert.equal(candidate.kind, 'accepted', JSON.stringify(candidate).slice(0, 2000));
  const [step] = npcReplySteps(candidate.bundle, f.requiredContext);
  const reading = readNpcReply(toolCallResponse(NPC_REPLY_TOOL_NAME, { result: written }), step.hearing);
  assert.equal(reading.kind, 'read', JSON.stringify(reading).slice(0, 2000));
  const merged = validateVNextProposalBundle(mergeNpcReplies(candidate.bundle, [{ step, reply: reading.reply }]));
  assert.equal(merged.kind, 'accepted', JSON.stringify(merged).slice(0, 2000));
  const lowered = lowerVNext2ProposalBundle({ value: merged.bundle, rootActionId: f.rootActionId, actorCharacterId: ACTOR,
    profiles: f.profiles, requiredContext: f.requiredContext, state: f.state });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered).slice(0, 2000));
  const room = vnext2CommandToRoomLowering(lowered.command); assert.equal(room.kind, 'accepted');
  return { step, result: apply(f, room.input), own: f.events.filter(event => event.rootActionId === f.rootActionId) };
}

test("words in a fight: the guard's own reply decides -- it yields and the end is asked at once, or it fights on and nothing changes", () => {
  for (const stance of ['yield', 'keepFighting']) {
    const f = fight(`words-${stance}`);
    passUntil(f, ACTOR);
    act(f, `words-${stance}`, '“放下武器投降，我饶你一命。”');
    const domain = wordsTo(GUARD, '放下武器投降，我饶你一命。');
    const bundle = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(domain))).bundle;
    const [heard] = npcReplySteps(bundle, f.requiredContext);
    // The guard hears it in the fight with the actor, whom it is fighting.
    assert.deepEqual(heard.hearing.combat, { fightingSpeaker: true, stances: ['keepFighting', 'yield', 'acceptSurrender', 'truce'] });
    assert.ok(JSON.stringify(npcReplyModelInput(f.requiredContext, heard.hearing).tools[0].function.parameters).includes('"combatStance"'));
    // A reply in the fight must say what it does in it.
    assert.equal(readNpcReply(toolCallResponse(NPC_REPLY_TOOL_NAME, { result: guardReply(domain, '……') }), heard.hearing).kind, 'unreadable');
    const { result, own } = sayAndReply(f, domain, guardReply(domain, stance === 'yield' ? '我认输，别杀我！' : '想得美！', stance));
    if (stance === 'yield') {
      // The act waits on the player's answer before any of it commits (ADR 0112).
      assert.equal(result.kind, 'awaitingInput', JSON.stringify(result).slice(0, 2000));
      assert.equal(result.pending.conclusionReason, 'npcSurrendered');
      const accepted = answer(f, result.pending, 'acceptEncounterConclusion', `words-${stance}-accept`);
      assert.equal(accepted.kind, 'committed', JSON.stringify(accepted).slice(0, 2000));
      const done = f.events.filter(event => event.rootActionId === f.rootActionId);
      assert.deepEqual(hostilityChanges(done).map(change => [change.sourceEntityId, change.targetEntityIds, change.reason]),
        [[GUARD, [], 'npcSurrendered']]);
      // The words were said first, then the guard stopped.
      assert.ok(done.findIndex(event => event.eventType === 'SourceClaimCreated' && event.payload.speakerId === GUARD)
        < done.findIndex(event => event.eventType === 'HostilityChanged'));
      assert.equal(encounterOf(f).status, 'concluded');
      assert.equal(done.find(event => event.eventType === 'EncounterConcluded').payload.reason, 'npcSurrendered');
    } else {
      assert.equal(result.kind, 'committed', JSON.stringify(result).slice(0, 2000));
      assert.deepEqual(hostilityChanges(own), []);
      assert.deepEqual(encounterOf(f).hostilities, [{ fromEntityIds: [ACTOR], toEntityIds: [GUARD] }, { fromEntityIds: [GUARD], toEntityIds: [ACTOR] }]);
    }
  }
});

test('words to a guard that yielded: its reply may turn on the speaker again; out of any fight a reply carries no stance', () => {
  const f = fight('words-turn');
  passUntil(f, ACTOR); passUntil(f, GUARD);
  npcTurn(f, GUARD, [{ kind: 'yield', fromRefs: [ACTOR] }, { kind: 'endTurn' }]);
  const pending = Object.values(f.state.combatRuntime.pendingInputs)[0];
  answer(f, { pendingInputId: pending.pendingInputId }, 'rejectEncounterConclusion', 'words-turn-decline');
  assert.equal(encounterOf(f).activeEntityId, ACTOR);
  act(f, 'words-turn', '“懦夫！”');
  const domain = wordsTo(GUARD, '懦夫！');
  const { step, result, own } = sayAndReply(f, domain, guardReply(domain, '你说什么？！', 'turnOn'));
  assert.deepEqual(step.hearing.combat, { fightingSpeaker: false, stances: ['stayOut', 'turnOn'] });
  assert.equal(result.kind, 'committed', JSON.stringify(result).slice(0, 2000));
  assert.deepEqual(hostilityChanges(own).map(change => [change.targetEntityIds, change.reason]), [[[ACTOR], 'npcTurnedHostile']]);

  // Out of any fight, what is heard carries no stance and the form asks none.
  const calm = createAuthoredProbeFixture('npc-stance:calm', { npcCharacters: [npc(GUARD, '守卫')] });
  calm.requiredContext = freezeAuthoredProbeContext(calm, calm.state, { rootActionId: calm.rootActionId, focusRefs: [ACTOR, GUARD], intentText: '“你好。”' }).context;
  const calmBundle = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(wordsTo(GUARD, '你好。')))).bundle;
  const [calmStep] = npcReplySteps(calmBundle, calm.requiredContext);
  assert.equal(calmStep.hearing.combat, undefined);
  assert.ok(!JSON.stringify(npcReplyModelInput(calm.requiredContext, calmStep.hearing).tools[0].function.parameters).includes('combatStance'));
});

test('a demand decided by an Intimidation check: the guard answers each outcome with its own stance, and the roll picks which one stands', () => {
  for (const [face, expected] of [[20, 'yield'], [1, 'keepFighting']]) {
    const f = fight(`intimidate-${face}`);
    passUntil(f, ACTOR);
    act(f, `intimidate-${face}`, '“投降，不然我砍了你！”');
    const domain = wordsTo(GUARD, '投降，不然我砍了你！');
    domain.adjudication = { kind: 'check', durationMicros: '0', checkKind: 'abilityCheck', ability: 'cha', skill: 'intimidation', dc: 13, mode: 'normal',
      risk: '对方可能被激怒。', successOutcome: '这番话镇住了对方。', failureOutcome: '这番话没有起作用。' };
    domain.proposals[0].branches.failure = { ...structuredClone(domain.proposals[0].branches.success), outcomeCode: 'outcome:unmoved', summary: '对方没有被镇住。' };
    const candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(domain)));
    assert.equal(candidate.kind, 'accepted', JSON.stringify(candidate).slice(0, 2000));
    const [step] = npcReplySteps(candidate.bundle, f.requiredContext);
    const reading = readNpcReply(toolCallResponse(NPC_REPLY_TOOL_NAME, { success: guardReply(domain, '好、好，我不打了。', 'yield'),
      failure: guardReply(domain, '吓唬谁呢！', 'keepFighting') }), step.hearing);
    assert.equal(reading.kind, 'read', JSON.stringify(reading).slice(0, 2000));
    const merged = validateVNextProposalBundle(mergeNpcReplies(candidate.bundle, [{ step, reply: reading.reply }]));
    assert.equal(merged.kind, 'accepted', JSON.stringify(merged).slice(0, 2000));
    const lowered = lowerVNext2ProposalBundle({ value: merged.bundle, rootActionId: f.rootActionId, actorCharacterId: ACTOR,
      profiles: f.profiles, requiredContext: f.requiredContext, state: f.state });
    assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered).slice(0, 2000));
    // Only the outcome whose reply changes the fight has a stance step, bound to it.
    const steps = lowered.command.rulesInput.steps ?? lowered.command.rulesInput.completionInput?.steps;
    assert.deepEqual(steps.filter(entry => entry.rulesInput.kind === 'npcCombatStance').map(entry => [entry.outcomeBinding, entry.rulesInput.plan.stance]),
      [['onSuccess', 'yield']]);
    let result = apply(f, vnext2CommandToRoomLowering(lowered.command).input);
    // The player rolls its Intimidation check.
    while (result.kind === 'awaitingRandomness' && result.continuation !== undefined) {
      const rolls = (result.randomnessRequest.hazardRolls ?? result.randomnessRequest.rolls ?? []).flatMap(spec => (spec.dice ?? [spec]).flatMap(die => Array(Number(die.count ?? 1)).fill(face)));
      result = apply(f, { kind: 'fulfillAuthoritativeRandomness', continuation: result.continuation, rolls: rolls.length > 0 ? rolls : [face] });
    }
    if (expected === 'yield') {
      assert.equal(result.kind, 'awaitingInput', JSON.stringify(result).slice(0, 2000));
      assert.equal(answer(f, result.pending, 'acceptEncounterConclusion', `intimidate-${face}-accept`).kind, 'committed');
      assert.equal(encounterOf(f).status, 'concluded');
    } else {
      assert.equal(result.kind, 'committed', JSON.stringify(result).slice(0, 2000));
      assert.deepEqual(hostilityChanges(f.events.filter(event => event.rootActionId === f.rootActionId)), []);
      assert.notEqual(encounterOf(f).status, 'concluded');
    }
  }
});
