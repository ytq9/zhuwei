import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE,
  PROBE_SOURCE as SOURCE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { lowerVNext2ProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { encodeVNextStrictToolBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { vnext2CommandToRoomLowering } from '../../../app/_runtime/lib/kp/vnext/room-bridge.ts';
import { prepareNpcReactionRequest, npcReactionModelInput, npcReactionRulesInput } from '../../../app/_runtime/lib/kp/vnext/npc-reaction.ts';
import { prepareNpcWorkRequest, npcWorkModelInput, npcWorkRulesInput } from '../../../app/_runtime/lib/kp/vnext/npc-work.ts';
import { dueActivityDescriptors } from '../../../app/_runtime/lib/rules/v2/due-activities.ts';
import { encounterMemoryFactId } from '../../../app/_runtime/lib/rules/v2/combat-memory.ts';
import { stepActionToDecision } from '../../support/fixtures/vnext-action-lifecycle.mjs';
import { promiseFixture, makePromiseInput, dueWork, NPC as WORKER } from '../../support/fixtures/vnext-promise-lifecycle.mjs';

// SPEC 0012 §13, SPEC 0006 §7 (ADR 0118): after a fight, each NPC that took
// part remembers what it perceived of it; an NPC may start a new fight from
// its own view -- on the spot, or when its own work comes due -- and that is
// a new encounter, never the old one reopened.
const GUARD = 'npc:aftermath-guard', ALLY = 'npc:aftermath-ally', LIAN = 'npc:aftermath-lian';
const fighter = (id, name, dex) => ({ id, name, mechanical: false, abilityScores: { str: 14, dex, con: 12, int: 10, wis: 11, cha: 10 },
  proficiencyBonus: 2, loadout: { armorClass: 12, speedFeet: 30, equipped: {}, backpack: [] } });
const statistics = (npcRef, hitPointsMaximum, armorClass = 12) => ({ npcRef, armorClass, speedFeet: 30, hitPointsMaximum, deathPolicy: 'deathSaves',
  attacks: [{ kind: 'meleeAttack', label: '短剑', ability: 'str', reachFeet: 5, damage: '1d6+2', damageType: 'piercing' }] });

function fixture(name, { ally = false } = {}) {
  const f = createAuthoredProbeFixture(`combat-aftermath:${name}`, {
    npcCharacters: [fighter(GUARD, '守卫', 12), ...(ally ? [fighter(ALLY, '帮手 / 老帮', 14)] : []), { id: LIAN, name: '莉安' }],
    // The guard and its helper stand within the actor's reach.
    spawnPoints: [[100, 100], [300, 100], [100, 160], ...(ally ? [[40, 100]] : []), [220, 160]]
      .map(([x, y]) => ({ x: String(x), y: String(y), elevation: '0' })),
    characterOverrides: { [ACTOR]: { name: '爱丽丝' } } });
  return { ...f, events: [] };
}
function freeze(f, root, intentText, focusRefs) {
  f.rootActionId = root;
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: root, focusRefs, intentText }).context;
}
/** Steps authority; `replay` checks the whole journal rebuilds the state. */
function apply(f, input, { replay = true } = {}) {
  const result = f.runtime.step(f.profiles, f.state, input);
  if (result.events?.length) {
    f.events.push(...result.events);
    if (replay) {
      const replayed = f.runtime.replay(f.genesis, f.events);
      assert.equal(replayed.kind, 'replayed', JSON.stringify(replayed).slice(0, 2000));
      assert.deepEqual(replayed.state, result.state);
    }
    f.state = result.state;
  }
  return result;
}
function lowered(f, decision, actor = ACTOR) {
  const candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify({ decision }));
  assert.equal(candidate.kind, 'accepted', JSON.stringify(candidate));
  return lowerVNext2ProposalBundle({ value: candidate.bundle, rootActionId: f.rootActionId, actorCharacterId: actor,
    profiles: f.profiles, requiredContext: f.requiredContext, state: f.state });
}
function run(f, result, options) {
  assert.equal(result.kind, 'accepted', JSON.stringify(result).slice(0, 2000));
  const room = vnext2CommandToRoomLowering(result.command);
  assert.equal(room.kind, 'accepted');
  return apply(f, room.input, options);
}
/** Each die of a native combat request shows `d20` (an attack roll) or its largest face. */
function fulfil(f, waiting, d20, options) {
  assert.equal(waiting.kind, 'awaitingRandomness', JSON.stringify(waiting).slice(0, 2000));
  return apply(f, { kind: 'authoritativeRandomness', resolutionId: waiting.resolutionId, responseId: `authority:${waiting.resolutionId}`,
    continuationCapability: waiting.continuationCapability,
    randomnessResults: waiting.randomnessRequests.map(request => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
      draws: request.dice.map(term => ({ sides: Number(term.sides),
        faces: Array(Number(term.count)).fill(Number(term.sides) === 20 ? d20 : Number(term.sides)) })) })) }, options);
}
/** Initiative dice of an atomic act all show 10. */
function rollInitiative(f, waiting) {
  assert.equal(waiting.kind, 'awaitingRandomness', JSON.stringify(waiting).slice(0, 2000));
  const rolls = waiting.randomnessRequest.hazardRolls.flatMap(spec => spec.dice.flatMap(die => Array(Number(die.count)).fill(10)));
  return apply(f, { kind: 'fulfillAuthoritativeRandomness', continuation: waiting.continuation, rolls });
}
const encounterOf = (f, id) => f.state.combatRuntime.encounters[id];
const current = f => Object.values(f.state.combatRuntime.encounters).find(encounter => encounter.status !== 'concluded');

/** The actor turns on the guard (and its helper); both sides hostile. */
function fight(f, { guardHitPoints = 40, allyHitPoints = 1 } = {}) {
  const npcs = [GUARD, ...(f.state.entities[ALLY] ? [ALLY] : [])];
  freeze(f, `root:${f.state.roomId}:start`, '我拔出长剑，冲向守卫。', [ACTOR, ...npcs]);
  const waiting = run(f, lowered(f, { kind: 'startCombat', participants: [ACTOR, ...npcs].map(creatureRef => ({ creatureRef, surprise: { kind: 'aware' } })),
    hostilities: [{ fromRefs: [ACTOR], toRefs: npcs }, { fromRefs: npcs, toRefs: [ACTOR] }],
    combatStatistics: npcs.map(ref => statistics(ref, ref === GUARD ? guardHitPoints : allyHitPoints, f.state.entities[ref].loadout.armorClass)),
    description: '长剑出鞘，守卫后退半步。' }));
  rollInitiative(f, waiting);
  return current(f).encounterId;
}
let turn = 0;
/** Ends the turn of whoever acts now. */
function endTurn(f, options) {
  const encounter = current(f);
  return apply(f, { kind: 'endTurn', rootActionId: `root:end-turn:${++turn}`, encounterId: encounter.encounterId,
    sourceEntityId: encounter.activeEntityId }, options);
}
/** Passes NPC turns until it is `who`'s turn. */
function untilTurnOf(f, who, options) {
  for (let guard = 0; current(f).activeEntityId !== who; guard++) {
    assert.ok(guard < 8, 'the turn order did not reach the creature');
    endTurn(f, options);
  }
}
/** `source` attacks `target` with its first ability; the d20 shows `d20`.
 * A downed NPC is knocked out. */
function strike(f, source, target, d20, options) {
  untilTurnOf(f, source, options);
  const abilityRef = f.state.combatRuntime.entities[source].abilityRefs
    .find(ref => source === ACTOR ? ref.includes('unarmed-strike') : !ref.startsWith('action:'));
  assert.ok(abilityRef, source);
  let result = apply(f, { kind: 'invokeAbility', rootActionId: `root:strike:${++turn}`, sourceEntityId: source, abilityRef,
    parameters: { targetEntityId: target } }, options);
  while (result.kind === 'awaitingRandomness') result = fulfil(f, result, d20, options);
  if (result.kind === 'awaitingInput' && result.pending.choiceKind === 'knockOut') {
    result = apply(f, { kind: 'answerPendingInput', pendingInputId: result.pending.pendingInputId, responseId: `response:${turn}`,
      answer: { kind: 'knockOut' } }, options);
    while (result.kind === 'awaitingRandomness') result = fulfil(f, result, d20, options);
  }
  assert.equal(result.kind, 'committed', JSON.stringify(result).slice(0, 2000));
  endTurn(f, options);
}
/** The KP rules the guard yields on the actor's turn; the player accepts. */
function guardYields(f) {
  untilTurnOf(f, ACTOR);
  freeze(f, `root:${f.state.roomId}:yield:${++turn}`, '放下武器，我饶你一命。', [ACTOR, GUARD]);
  const proposed = run(f, lowered(f, { kind: 'endCombat', outcome: 'foesSurrender', stopFightingRefs: [GUARD], description: '守卫扔下短剑。' }));
  assert.equal(proposed.kind, 'awaitingInput', JSON.stringify(proposed).slice(0, 2000));
  const accepted = apply(f, { kind: 'answerPendingInput', pendingInputId: proposed.pending.pendingInputId, responseId: `accept:${turn}`,
    answer: { kind: 'acceptEncounterConclusion' } });
  assert.equal(accepted.kind, 'committed', JSON.stringify(accepted).slice(0, 2000));
  return accepted;
}
const memoryOf = (f, npc, encounterId) => f.state.knowledge[npc]?.[encounterMemoryFactId(encounterId, npc)];

test('each living NPC that fought remembers the fight as it perceived it, privately, and replay rebuilds it', () => {
  const f = fixture('remembers');
  const encounterId = fight(f);
  strike(f, GUARD, ACTOR, 1);
  strike(f, ACTOR, GUARD, 20);
  const ended = guardYields(f);
  assert.equal(encounterOf(f, encounterId).status, 'concluded');
  const memory = memoryOf(f, GUARD, encounterId);
  assert.ok(memory, JSON.stringify(Object.keys(f.state.knowledge[GUARD] ?? {})));
  assert.equal(memory.content, '与爱丽丝在蒸汽廊道交战。爱丽丝对本人出手1次，得手1次。本人对爱丽丝出手1次，得手0次。'
    + '本人投降，不再与爱丽丝为敌。投降被接受，战斗结束。');
  assert.equal(memory.objectKind, 'sensoryEvidence');
  // The fact is authority's; the acquisition is the guard's alone.
  const fact = ended.events.find(event => event.eventType === 'CanonicalFactDeclared' && event.payload.fact.id === memory.knowledgeRef);
  assert.deepEqual([fact.secrecy, fact.visibilityPolicyId, fact.payload.fact.value.observerRef], ['internal', 'visibility:room-authority-only', GUARD]);
  const acquired = ended.events.find(event => event.eventType === 'SensoryEvidenceAcquired' && event.payload.characterId === GUARD);
  assert.deepEqual([acquired.secrecy, acquired.visibilityPolicyId], ['private', `visibility:knowledge-holder:${GUARD}`]);
  // Players get none; an NPC that did not take part gets none.
  for (const other of [ACTOR, LIAN]) assert.equal(Object.keys(f.state.knowledge[other] ?? {}).some(ref => ref.startsWith('fact:encounter-memory:')), false, other);
  // The player's reply for the end tells nothing of the guard's memory.
  const own = f.events.filter(event => event.rootActionId === ended.receipt.rootActionId);
  const range = { receiptId: ended.receipt.receiptId, actorCharacterId: ACTOR, priorState: f.runtime.replay(f.genesis,
    f.events.slice(0, f.events.indexOf(own[0]))).state, events: own };
  const projected = f.runtime.project(f.profiles, f.state, f.viewer, { committedRange: range });
  assert.equal(projected.kind, 'projected', JSON.stringify(projected.rejection));
  assert.doesNotMatch(JSON.stringify(projected.renderableClaims), /出手|本人投降/);
  // A player speaking to the guard later: the hosting KP's frozen view of the
  // guard, which its own reply is written from, carries the memory.
  freeze(f, 'root:combat-aftermath:asks', '守卫，你还记得刚才是谁饶了你吗？', [GUARD]);
  const held = f.requiredContext.entries.find(entry => entry.entryRef === `knowledge:${GUARD}:${memory.knowledgeRef}`);
  assert.match(JSON.stringify(held?.value), /本人投降，不再与爱丽丝为敌/, JSON.stringify(f.requiredContext.entries.map(entry => entry.entryRef)));
});

test('an NPC that went down remembers until it fell, and each NPC keeps only what concerned it', () => {
  const f = fixture('went-down', { ally: true });
  const encounterId = fight(f, { allyHitPoints: 1 });
  strike(f, ACTOR, ALLY, 20);
  assert.equal(f.state.combatRuntime.entities[ALLY].lifeState, 'unconscious');
  strike(f, ACTOR, GUARD, 20);
  guardYields(f);
  assert.equal(memoryOf(f, ALLY, encounterId).content, '与爱丽丝在蒸汽廊道交战。爱丽丝对本人出手1次，得手1次，把本人打倒了。本人倒下后的事不知道。');
  const guard = memoryOf(f, GUARD, encounterId).content;
  assert.equal(guard, '与爱丽丝在蒸汽廊道交战。爱丽丝对本人出手1次，得手1次。本人投降，不再与爱丽丝为敌。投降被接受，战斗结束。');
  assert.doesNotMatch(guard, /帮手/, 'the strike on its helper did not concern the guard');
  // Nothing of dice, hit points or damage figures travels.
  for (const text of [guard, memoryOf(f, ALLY, encounterId).content]) assert.doesNotMatch(text, /伤害|生命值|HP|AC|d20|骰/);
});

test('a long fight leaves a memory no longer than a short one', () => {
  const texts = [];
  for (const rounds of [2, 12]) {
    const f = fixture(`long-${rounds}`);
    const encounterId = fight(f, { guardHitPoints: 200 });
    for (let round = 0; round < rounds; round++) {
      strike(f, GUARD, ACTOR, 1, { replay: false });
      strike(f, ACTOR, GUARD, 20, { replay: false });
    }
    guardYields(f);
    const ledger = encounterOf(f, encounterId).fightMemory.npcs[GUARD];
    assert.deepEqual([Object.keys(ledger.struck), Object.keys(ledger.struckBy)], [[ACTOR], [ACTOR]]);
    texts.push(memoryOf(f, GUARD, encounterId).content);
  }
  assert.match(texts[1], /爱丽丝对本人出手12次，得手12次。本人对爱丽丝出手12次，得手0次。/);
  // Only the counts differ: one digit more for each of the three that grew.
  assert.equal(texts[0].replace(/\d+/g, 'N'), texts[1].replace(/\d+/g, 'N'));
  assert.equal(texts[1].length - texts[0].length, 3, JSON.stringify(texts));
});

/** The actor fiddles with the valve behind Lian's back while the guard watches. */
function covertBundle() {
  const heard = (evidence) => ({ observerRef: ACTOR, subjectRef: SOURCE, sense: 'hearing', evidence, basisRefs: [SOURCE] });
  const branch = (suffix, summary) => ({ outcomeCode: `outcome:${suffix}`, summary, effects: [], sensoryEvidence: [heard(summary)], pressures: [], opportunities: [] });
  return { mode: 'adjudication', basisRefs: [SOURCE], terminal: { kind: 'none' },
    adjudication: { kind: 'check', durationMicros: '300000000', checkKind: 'abilityCheck', ability: 'dex', skill: 'sleight', dc: null, mode: 'normal',
      risk: '莉安会追问。', successOutcome: '阀门被悄悄拧松。', failureOutcome: '莉安看见了你的手。',
      concealment: { primaryObserverRef: LIAN, sense: 'sight', evidence: '看见爱丽丝背过身去，在阀门旁偷偷动手。', observers: [
        { observerRef: LIAN, attention: 'distracted', basisRefs: [SOURCE] }, { observerRef: GUARD, attention: 'watching', basisRefs: [SOURCE] }] } },
    proposals: [{ basisRefs: [SOURCE], consumes: [], produces: [], sceneRef: SCENE, kind: 'worldInteraction', outcomeBinding: 'always',
      intent: '背过身去拧松阀门。', method: '借身体挡住，悄悄转动阀门。',
      targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: { kind: 'none' },
      branches: { success: branch('unnoticed', '阀门松开了。'), failure: branch('noticed', '阀门松开了，莉安看向你的手。') } }] };
}
/** After the guard yielded and was spared, the actor turns its back on it. */
function sparedThenBackTurned(name) {
  const f = fixture(name);
  const first = fight(f);
  strike(f, ACTOR, GUARD, 20);
  guardYields(f);
  freeze(f, `root:${name}:back-turned`, '背过身去拧松阀门。', [SOURCE, LIAN, GUARD]);
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(covertBundle())));
  const lower = lowerVNext2ProposalBundle({ ...f, value: parsed.bundle });
  assert.equal(lower.kind, 'accepted', JSON.stringify(lower).slice(0, 2000));
  const pending = stepActionToDecision(f.runtime, f.profiles, f.state, vnext2CommandToRoomLowering(lower.command).input);
  assert.equal(pending.kind, 'awaitingRandomness', JSON.stringify(pending).slice(0, 2000));
  f.events.push(...pending.events); f.state = pending.state;
  apply(f, { kind: 'fulfillAuthoritativeRandomness', continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls: [1] });
  const due = dueActivityDescriptors(f.state).find(work => work.npcReaction?.reactionId !== undefined && work.ownerEntityId === GUARD);
  assert.ok(due, 'the guard noticed and may react');
  const request = prepareNpcReactionRequest(f.state, f.profiles, f.moduleProfile, due.childRootActionId, due.npcReaction);
  assert.ok(request);
  return { f, first, due, request };
}
const toolResponse = (name, args) => ({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
const npcStart = (npc, targets, extra = {}) => toolResponse('submit_kp_proposal_bundle', { decision: { kind: 'startCombat',
  participants: [npc, ...targets].map(creatureRef => ({ creatureRef, surprise: { kind: 'aware' } })),
  hostilities: [{ fromRefs: [npc], toRefs: targets }], combatStatistics: [], description: '守卫趁对方背过身，抄起短剑扑了上去。', ...extra } });

test('a spared NPC remembers it, and when the player turns its back it starts a new fight with a new encounter', () => {
  const { f, first, request } = sparedThenBackTurned('rebels');
  // Its memory of the fight is in the view this decision reads.
  const memoryRef = `knowledge:${GUARD}:${encounterMemoryFactId(first, GUARD)}`;
  const entry = request.context.entries.find(item => item.entryRef === memoryRef);
  assert.match(JSON.stringify(entry?.value), /本人投降，不再与爱丽丝为敌/);
  // The start form is offered, with the NPC's own guidance, not the hosting KP's.
  const input = npcReactionModelInput(request);
  assert.match(JSON.stringify(input.tools[1].function.parameters), /startCombat/);
  const sent = JSON.stringify(input.messages);
  assert.match(sent, /hostilities只写本人这一方/);
  assert.doesNotMatch(sent, /互相敌对写两条/);

  const rulesInput = npcReactionRulesInput(npcStart(GUARD, [ACTOR]), request, f.state, f.profiles);
  const waiting = apply(f, rulesInput);
  // The player rolls its own initiative; the guard's is drawn.
  const started = rollInitiative(f, waiting);
  assert.equal(started.kind, 'committed', JSON.stringify(started).slice(0, 2000));
  const renewed = current(f);
  assert.notEqual(renewed.encounterId, first, 'a new encounter');
  assert.equal(encounterOf(f, first).status, 'concluded', 'the old one stays ended');
  assert.deepEqual([...renewed.participantEntityIds].sort(), [ACTOR, GUARD].sort());
  assert.deepEqual(renewed.hostilities, [{ fromEntityIds: [GUARD], toEntityIds: [ACTOR] }], 'only the guard decided hostility');
  assert.equal(f.state.campaignRuntime.npcReactions[request.reactionId].status, 'reacted');
  assert.ok(f.events.some(event => event.eventType === 'EncounterStarted' && event.rootActionId === request.rootActionId));
});

test('an NPC that does not want to fight declines and nothing starts; it cannot decide others\' hostility or bring in bystanders', () => {
  const { f, first, request } = sparedThenBackTurned('declines');
  // It may not write the player's hostility, nor list a bystander.
  for (const response of [npcStart(GUARD, [ACTOR], { hostilities: [{ fromRefs: [GUARD], toRefs: [ACTOR] }, { fromRefs: [ACTOR], toRefs: [GUARD] }] }),
    npcStart(GUARD, [ACTOR], { participants: [GUARD, ACTOR, LIAN].map(creatureRef => ({ creatureRef, surprise: { kind: 'aware' } })) })]) {
    assert.throws(() => npcReactionRulesInput(response, request, f.state, f.profiles), /NPC_REACTION_INVALID/);
  }
  const before = Object.keys(f.state.combatRuntime.encounters);
  const declined = apply(f, npcReactionRulesInput(toolResponse('decline_npc_reaction', { reason: '已经投降过一次，不想再动手。' }), request, f.state, f.profiles));
  assert.equal(declined.kind, 'committed');
  assert.deepEqual(Object.keys(f.state.combatRuntime.encounters), before);
  assert.equal(encounterOf(f, first).status, 'concluded');
  assert.equal(f.state.campaignRuntime.npcReactions[request.reactionId].status, 'declined');
});

test('an NPC whose own work comes due starts a fight from its plan', () => {
  const f = { ...promiseFixture('aftermath-work'), events: [] };
  const formed = apply(f, makePromiseInput(f, f.state, { content: '我会让你为此付出代价。', expression: '你能拿我怎样？',
    terms: { kind: 'attempt', subjectRefs: [WORKER, ACTOR], delivery: null }, nextStep: '找到爱丽丝，动手教训她。' }));
  assert.equal(formed.kind, 'committed', JSON.stringify(formed).slice(0, 2000));
  const due = dueWork(f, f.state).find(work => work.npcWork);
  assert.ok(due);
  const request = prepareNpcWorkRequest(f.state, f.profiles, f.moduleProfile, due.childRootActionId, due.npcWork.planId);
  const selection = toolResponse('select_npc_work_schema', { requestedCapabilities: ['startCombat'] });
  const filling = npcWorkModelInput(request, selection);
  assert.match(JSON.stringify(filling.tools[0].function.parameters), /startCombat/);
  assert.match(JSON.stringify(filling.messages), /hostilities只写本人这一方/);
  assert.doesNotMatch(JSON.stringify(filling.messages), /互相敌对写两条/);
  // The worker has fought no one yet: it writes its own first statistics.
  const own = { npcRef: WORKER, armorClass: 10, speedFeet: 30, hitPointsMaximum: 20, deathPolicy: 'deathSaves',
    attacks: [{ kind: 'meleeAttack', label: '小刀', ability: 'dex', reachFeet: 5, damage: '1d4', damageType: 'piercing' }] };
  const rulesInput = npcWorkRulesInput(npcStart(WORKER, [ACTOR], { combatStatistics: [own] }), request, f.state, f.profiles, selection);
  const waiting = apply(f, rulesInput);
  const started = rollInitiative(f, waiting);
  assert.equal(started.kind, 'committed', JSON.stringify(started).slice(0, 2000));
  const encounter = current(f);
  assert.deepEqual([...encounter.participantEntityIds].sort(), [ACTOR, WORKER].sort());
  assert.deepEqual(encounter.hostilities, [{ fromEntityIds: [WORKER], toEntityIds: [ACTOR] }]);
  assert.equal(f.state.campaignRuntime.npcPlans[due.npcWork.planId].startedByRootActionId, request.rootActionId);
});
