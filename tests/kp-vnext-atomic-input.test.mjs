import { soleFormId, soleProposalRef, mergeExecutionCosts } from './fixtures/vnext-action-duration.mjs';
import { authoritativeNpcDecisionContext } from '../app/_runtime/lib/rules/v2/npc-decision-context.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_TARGET as TARGET, PROBE_SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { canonicalSha256 } from '../app/_runtime/lib/rules/profiles/canonical.ts';
import { itemBundle, hazardBundle } from './fixtures/vnext-authored-bundles.mjs';
import { ATOMIC_WORLD_INTERACTION_STEPS_PLAN_SCHEMA, worldInteractionPlanHash } from '../app/_runtime/lib/rules/v2/world-interaction-model.ts';
import { createCandidateEventTransition, createEventTransition, validateEventEnvelope } from '../app/_runtime/lib/rules/v2/events.ts';
import { authorityRevisionOrHash } from '../app/_runtime/lib/rules/v2/authority-bindings.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { encodeVNextStrictToolBundle } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { sharedCheckBundle } from './fixtures/vnext-shared-check.mjs';
import { worldFactSocialBundle } from './fixtures/vnext-world-facts.mjs';

function parseBundle(value) {
  return parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(value)));
}

function fixture(name, { shield = false, knockout = false, npc = false, resourceBalance, includeThird = false } = {}) {
  const f = createAuthoredProbeFixture(name);
  const state = structuredClone(f.state);
  if (resourceBalance !== undefined) {
    state.entities[ACTOR].resources.focus = resourceBalance;
    state.entities[ACTOR].resourceMaximums.focus = 3;
    state.combatRuntime.entities[ACTOR].resources.focus = { current: String(resourceBalance), maximum: '3' };
  }
  if (shield === 'both' || includeThird) {
    const third = 'character:probe-third';
    state.entities[third] = { ...structuredClone(state.entities[TARGET]), id: third, name: '第三位法师', entityOrdinal: '3' };
    state.combatRuntime.entities[third] = { ...structuredClone(state.combatRuntime.entities[TARGET]), id: third, entityId: third, entityOrdinal: '3', controllerPrincipalId: 'principal:probe-third', position: { x: '300', y: '100', elevation: '0' } };
    state.principals['principal:probe-third'] = { id: 'principal:probe-third', sessionVersion: 1, role: 'player' };
    state.seats['seat:probe-third'] = { id: 'seat:probe-third', principalId: 'principal:probe-third', status: 'active' };
    state.characterControls[third] = { characterId: third, seatId: 'seat:probe-third' };
    state.multiplayerRuntime.members['principal:probe-third'] = { principalId: 'principal:probe-third', role: 'player', status: 'active' };
    state.knowledge[third] = {};
    state.multiplayerRuntime.characterTimelineIds[third] = state.multiplayerRuntime.characterTimelineIds[TARGET];
  }
  if (shield) {
    const registered = f.runtime.step(f.profiles, state, { kind: 'registerDynamicDefinition', proposalId: 'root:shield-definition', definition: {
      definitionId: 'spell:shield', definitionKind: 'ability', revision: '1', rulesBasis: 'srd5.1-2014', mechanicalKey: 'shield',
      activation: { kind: 'reactionSpell', spellLevel: '1' }, costs: [{ kind: 'spellSlot', level: '1', amount: '1' }],
      effect: { kind: 'shield', duration: 'untilOwnNextTurnStart', armorClassBonus: '5', magicMissileImmunity: true },
    } });
    assert.equal(registered.kind, 'committed', JSON.stringify(registered));
    state.combatRuntime.definitions['spell:shield'] = registered.state.combatRuntime.definitions['spell:shield'];
    state.campaignRuntime.definitions['spell:shield'] = registered.state.campaignRuntime.definitions['spell:shield'];
    for (const target of (shield === 'both' ? ['character:probe-third', TARGET] : [TARGET])) {
    if(shield!=='slots')state.combatRuntime.entities[target].abilityRefs.push('spell:shield');
    state.combatRuntime.entities[target].resources['spellSlot:1'] = { current: '2', maximum: '2' };
    state.entities[target].resources['spellSlot:1'] = 2;
    state.entities[target].resourceMaximums['spellSlot:1'] = 2;
    }
  }
  if (knockout) {
    state.entities[TARGET].hitPoints.current = 1;
    state.combatRuntime.entities[TARGET].hitPoints.current = '1';
  }
  if (npc) {
    state.entities[TARGET].kind='npc';delete state.entities[TARGET].experiencePoints;
    state.combatRuntime.entities[TARGET].kind='npc';
    delete state.characterControls[TARGET];
  }
  const { eventHeadHash, lastEventId, ...domain } = state;
  const initialStateHash = canonicalSha256(domain);
  state.eventHeadHash = initialStateHash;
  const unsigned = { ...f.genesis, initialState: state, initialStateHash }; delete unsigned.genesisHash;
  f.genesis = { ...unsigned, genesisHash: canonicalSha256(unsigned) };
  const rebuilt = f.runtime.replay(f.genesis, []);
  assert.equal(rebuilt.kind, 'replayed', JSON.stringify(rebuilt));
  f.state = rebuilt.state;
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [TARGET, ...(shield === 'both' || includeThird ? ['character:probe-third'] : []), "definition:probe-valve", "definition:probe-steam-zone"] }).context;
  return f;
}
function attackBundle({ melee = false, invalidSuffix = false } = {}) {
  const value = itemBundle();
  Object.assign(value.proposals[0].source.content, {
    healing: null, target: { kind: 'creature', count: '1', [melee ? 'reachInches' : 'rangeInches']: '900', requiresSight: false },
    attack: { ability: 'str', proficiency: true }, damage: [{ type: 'force', formula: '1d4', sharedAcrossTargets: false }],
  });
  value.proposals[4].operation.targetRefs = [TARGET];
  if (invalidSuffix) value.proposals.push({ ...structuredClone(value.proposals[3]), operation: { kind: 'release', entryRef: 'prospective:item-entry', quantity: 3,
    sceneRef: 'scene:probe-gallery', releaseKind: 'placement' } });
  return value;
}
function begin(f, value, executionCosts) {
  const lowered = lowerVNext2ProposalBundle({ value, rootActionId: f.rootActionId, actorCharacterId: ACTOR, requiredContext: f.requiredContext, state: f.state });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  const result = f.runtime.step(f.profiles, f.state, { ...lowered.command.rulesInput,
    ...(executionCosts === undefined ? {} : { executionCosts }) });
  assert.equal(result.kind, 'awaitingRandomness', JSON.stringify(result));
  return result;
}
function dice(f, waiting, attack = 10, damage = 2) {
  const rolls = waiting.randomnessRequest.hazardRolls.flatMap(spec => spec.dice.flatMap(die =>
    Array(Number(die.count)).fill(spec.purposeKey.includes(':attack:') ? attack : damage)));
  return f.runtime.step(f.profiles, waiting.state, { kind: 'fulfillAuthoritativeRandomness', continuation: waiting.continuation, rolls });
}
function answer(f, waiting, value, responseId = 'answer:one') {
  return f.runtime.step(f.profiles, waiting.state, { kind: 'answerPendingInput', pendingInputId: waiting.pending.pendingInputId, responseId, answer: value });
}
function unpublished(f, result) {
  assert.deepEqual(result.state.campaignRuntime.itemSystem, f.state.campaignRuntime.itemSystem);
  assert.deepEqual(result.state.entities, f.state.entities);
  assert.deepEqual(result.state.combatRuntime.definitions, f.state.combatRuntime.definitions);
  assert.equal(result.events.some(event => ['DefinitionRegistered', 'ItemUsed', 'ItemMaterialized', 'DamagePacketResolved'].includes(event.eventType)), false);
  const projection = f.runtime.project(f.profiles, result.state, f.viewer);
  assert.equal(projection.kind, 'projected', JSON.stringify(projection));
  assert.equal(/candidateState|nativePendingInputId|frozenDamageFaces|ownerFrame|lethalDamagePayload/.test(JSON.stringify(projection)), false);
  assert.equal(/candidateState|nativePendingInputId|frozenDamageFaces|ownerFrame|lethalDamagePayload/.test(JSON.stringify(result.pending)), false);
}
function replay(f, events, expected) {
  const rebuilt = f.runtime.replay(f.genesis, events);
  assert.equal(rebuilt.kind, 'replayed', JSON.stringify(rebuilt));
  assert.deepEqual(rebuilt.state, expected);
}

function atomicInput(f, lower, bundle) {
  if (lower.command.rulesInput.kind === 'applyAtomicWorldInteractionSteps') return lower.command.rulesInput;
  const ruling = bundle.adjudication.kind;
  return { kind: 'applyAtomicWorldInteractionSteps', rootActionId: f.rootActionId, actorCharacterId: ACTOR,
    bundleHash: canonicalSha256(bundle), contextHash: f.requiredContext.binding.contextHash, sharedRuling: ruling,
    steps: [{ formId: soleFormId(lower.command), proposalRef: soleProposalRef(lower.command), ruling,
      rulesInput: lower.command.rulesInput, dependsOn: [], consumes: [], produces: [], outcomeBinding: 'always' }] };
}

function socialOnlyBundle(check = false) {
  const wire = worldFactSocialBundle({ sceneRef: 'scene:probe-gallery', npcRef: TARGET, check });
  const social = wire.proposals[1];
  social.consumes = [];
  for (const branch of Object.values(social.branches)) if (branch.response) {
    branch.response.text = '我现在不想谈自己的事情。';
    branch.response.basis = [{ kind: 'npcContext', ref: TARGET }];
  }
  wire.proposals = [social];
  const parsed = parseBundle(wire);
  assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
  return parsed.bundle;
}

function beginFrozen(f, bundle, executionCosts, expectedKind = 'awaitingRandomness') {
  const lower = lowerVNext2ProposalBundle({ value: bundle, rootActionId: f.rootActionId,
    actorCharacterId: ACTOR, requiredContext: f.requiredContext, state: f.state });
  assert.equal(lower.kind, 'accepted');
  const { kind: _kind, ...atomic } = atomicInput(f, lower, bundle);
  if (executionCosts !== undefined) atomic.executionCosts = executionCosts;
  const pendingInputId = `pending:${f.rootActionId}`;
  const opened = f.runtime.step(f.profiles, f.state, { kind: 'openFrozenPlayerChoice', rootActionId: f.rootActionId,
    actorCharacterId: ACTOR, plan: { schema: 'zhuwei.frozen-player-choice/vnext-1', rootActionId: f.rootActionId,
      actorCharacterId: ACTOR, pendingInputId, contextHash: f.requiredContext.binding.contextHash,
      bundleHash: canonicalSha256(bundle), profilesHash: canonicalSha256(f.profiles), readSet: [], question: '执行已说明的攻击还是取消？',
      choices: [
        { choiceId: 'proceed', label: '执行', publicRisk: '攻击可能造成伤害。', continuation: { kind: 'adjudication',
          plan: { schema: ATOMIC_WORLD_INTERACTION_STEPS_PLAN_SCHEMA, ...atomic } } },
        { choiceId: 'cancel', label: '取消', publicRisk: '不执行。', continuation: { kind: 'cancel' } },
      ] } });
  assert.equal(opened.kind, 'awaitingInput');
  const selected = f.runtime.step(f.profiles, opened.state, { kind: 'answerFrozenPlayerChoice', rootActionId: f.rootActionId,
    controllerCharacterId: ACTOR, pendingInputId, choiceId: 'proceed' });
  assert.equal(selected.kind, expectedKind, JSON.stringify(selected));
  return { selected, events: [...opened.events, ...selected.events] };
}

test('frozen execution proves native reaction and choice-dependent randomness without exposing or replacing its candidate', () => {
  for (const mode of ['shield', 'knockOut']) {
    const f = fixture(`frozen-native-${mode}`, mode === 'shield' ? { shield: true } : { knockout: true });
    const begun = beginFrozen(f, attackBundle({ melee: mode === 'knockOut' }));
    const pending = dice(f, begun.selected, mode === 'shield' ? 10 : 15);
    assert.equal(pending.kind, 'awaitingInput', JSON.stringify(pending));
    assert.equal(pending.events[0].eventType, 'FrozenPlayerChoiceInputRecorded');
    const events = [...begun.events, ...pending.events];
    replay(f, events, pending.state);
    unpublished(f, pending);
    const prefix = f.runtime.replay(f.genesis, [...begun.events, pending.events[0]]);
    assert.equal(prefix.kind, 'replayed');
    assert.equal(prefix.state.receipts[f.rootActionId].status, begun.selected.state.receipts[f.rootActionId].status);
    assert.deepEqual(prefix.state.multiplayerRuntime.spotlightLedger, begun.selected.state.multiplayerRuntime.spotlightLedger);
    assert.equal(dice(f, { ...begun.selected, state: prefix.state }, 1).kind, 'rejected');

    const marker = pending.events.at(-1);
    assert.equal(marker.eventType, 'AtomicWorldInteractionSuspended');
    const before = f.runtime.replay(f.genesis, events.slice(0, -1));
    assert.equal(before.kind, 'replayed');
    for (const mutate of [
      value => { value.continuation.candidateState.entities[TARGET].name = 'changed candidate'; },
      value => { value.continuation.stepIndex = 0; value.continuation.ledger = []; },
      value => { value.continuation.events = []; },
      value => { value.continuation.tapes[0].rolls[0] = 1; },
    ]) {
      const payload = structuredClone(marker.payload); mutate(payload);
      const forged = createEventTransition(before.state, f.profiles, { rootActionId: f.rootActionId,
        eventType: marker.eventType, payload, scopeProof: pending.scopeProof,
        visibilityPolicyId: marker.visibilityPolicyId, secrecy: marker.secrecy });
      assert.equal(f.runtime.replay(f.genesis, [...events.slice(0, -1), forged.event]).kind, 'rejected');
    }
    let done = answer(f, pending, mode === 'shield'
      ? { kind: 'useReaction', abilityRef: 'spell:shield', slotLevel: '1' } : { kind: 'knockOut' });
    assert.equal(done.events[0]?.eventType, 'FrozenPlayerChoiceInputRecorded', JSON.stringify(done));
    events.push(...done.events);
    if (mode === 'knockOut') {
      assert.equal(done.kind, 'awaitingRandomness', JSON.stringify(done));
      replay(f, events, done.state);
      unpublished(f, done);
      const next = dice(f, done, 15, 3); events.push(...next.events); done = next;
    }
    assert.equal(done.kind, 'committed', JSON.stringify(done));
    assert.equal(events.filter(event => event.eventType === 'ItemUsed').length, 1);
    assert.equal(Object.keys(done.state.frozenPlayerChoices).length, 0);
    assert.equal(Object.keys(done.state.atomicWorldInteractions).length, 0);
    assert.equal(Object.values(done.state.campaignRuntime.itemSystem.entries)[0].quantity, 1);
    if (mode === 'shield') assert.equal(done.state.entities[TARGET].resources['spellSlot:1'], 1);
    replay(f, events, done.state);
    assert.equal(answer(f, { ...pending, state: done.state }, { kind: 'decline' }).kind, 'rejected');
  }
});

// Every in-world act now spends its frozen duration ahead of its results, so
// an overriding cost set has to carry that spend too, with the actor's
// timeline bound; otherwise Rules refuses the act for declaring no duration.
const ACT_DURATION_MICROS = '300000000';
function fictionTimeCost(f, durationMicros = ACT_DURATION_MICROS) {
  return { cost: { kind: 'fictionTime', durationMicros },
    binding: { ref: `character-timeline:${ACTOR}`, revisionOrHash: authorityRevisionOrHash(f.state, `character-timeline:${ACTOR}`) } };
}
const byRef = (left, right) => left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0;
function acceptedCosts(f, amount = 1) {
  const time = fictionTimeCost(f);
  return { costs: [{ kind: 'resource', resourceId: 'focus', amount }, time.cost],
    readSet: [{ ref: ACTOR, revisionOrHash: authorityRevisionOrHash(f.state, ACTOR) }, time.binding].sort(byRef) };
}

test('additional accepted costs share direct and check execution without changing Ability costs or charging before settlement', () => {
  for (const kind of ['item', 'observe', 'worldInteraction']) for (const roll of [1, 20]) {
    const f = fixture(`accepted-cost-${kind}-${roll}`, { resourceBalance: 3 });
    const value = kind === 'item' ? itemBundle()
      : parseBundle(sharedCheckBundle(kind)).bundle;
    const waiting = begin(f, value, acceptedCosts(f));
    assert.equal(waiting.state.entities[ACTOR].resources.focus, 3);
    assert.equal(waiting.events.some(event => event.eventType === 'ResourceUsed'), false);
    assert.ok(waiting.scopeProof.reads.includes(ACTOR));
    replay(f, waiting.events, waiting.state);
    const result = kind === 'item' ? dice(f, waiting)
      : f.runtime.step(f.profiles, waiting.state, { kind: 'fulfillAuthoritativeRandomness', continuation: waiting.continuation, rolls: [roll] });
    assert.equal(result.kind, 'committed', `${kind}/${roll}: ${JSON.stringify(result)}`);
    assert.equal(result.state.entities[ACTOR].resources.focus, 2);
    assert.equal(result.events.filter(event => event.eventType === 'ResourceUsed' && event.payload.resourceId === 'focus').length, 1);
    if (kind !== 'item') {
      const frozen = Object.values(waiting.state.internalContinuations).find(entry => entry.rootActionId === f.rootActionId).resolutionPlan;
      const checkPlan = frozen.steps.find(step => step.rulesInput.kind === 'resolveWorldInteraction' && step.rulesInput.plan.ruling.kind === 'check').rulesInput.plan;
      const settled = result.events.find(event => event.eventType === 'WorldInteractionResolved' && event.payload.check !== null);
      assert.equal(settled.payload.planHash, worldInteractionPlanHash(checkPlan));
      assert.equal(checkPlan.readSet.find(binding => binding.ref === ACTOR).revisionOrHash, authorityRevisionOrHash(f.state, ACTOR));
    }
    if (kind === 'item') {
      assert.equal(result.events.filter(event => event.eventType === 'ItemUsed').length, 1);
      assert.equal(Object.values(result.state.campaignRuntime.itemSystem.entries)[0].quantity, 1);
    }
    replay(f, [...waiting.events, ...result.events], result.state);
    assert.equal(f.runtime.step(f.profiles, result.state,
      { kind: 'fulfillAuthoritativeRandomness', continuation: waiting.continuation, rolls: [roll] }).kind, 'rejected');
  }
});

test('a direct atomic action pays accepted item and resource costs once without requesting randomness', () => {
  const f = fixture('accepted-cost-direct-items', { resourceBalance: 3 });
  const creation = itemBundle(); creation.proposals.pop();
  const first = lowerVNext2ProposalBundle({ value: creation, rootActionId: f.rootActionId,
    actorCharacterId: ACTOR, requiredContext: f.requiredContext, state: f.state });
  assert.equal(first.kind, 'accepted');
  const acquired = f.runtime.step(f.profiles, f.state, first.command.rulesInput);
  assert.equal(acquired.kind, 'committed', JSON.stringify(acquired));
  const entry = Object.values(acquired.state.campaignRuntime.itemSystem.entries)[0];
  const rootActionId = `${f.rootActionId}:direct`;
  const context = freezeAuthoredProbeContext(f, acquired.state, { rootActionId,
    focusRefs: [TARGET, 'definition:probe-valve'] }).context;
  const value = sharedCheckBundle('worldInteraction');
  value.adjudication = { kind: 'directSuccess', durationMicros: '300000000', risk: '消耗一份材料。', successOutcome: '完成观察。' };
  value.proposals = [value.proposals[1]];
  value.proposals[0].branches.failure = { kind: 'none' };
  const parsed = parseBundle(value);
  assert.equal(parsed.kind, 'accepted');
  const lower = lowerVNext2ProposalBundle({ value: parsed.bundle, rootActionId,
    actorCharacterId: ACTOR, requiredContext: context, state: acquired.state });
  assert.equal(lower.kind, 'accepted');
  const cost = { costs: [{ kind: 'resource', resourceId: 'focus', amount: 1 },
    { kind: 'item', entryRef: entry.entryId, quantity: 1, charges: 0, durability: 0 }],
    readSet: [ACTOR, entry.entryId].sort().map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(acquired.state, ref) })) };
  // Lowering already produced the one-step atomic plan carrying the act's duration; the test adds its item and resource costs to it.
  const base = lower.command.rulesInput.executionCosts;
  const input = { ...lower.command.rulesInput, executionCosts: mergeExecutionCosts(base, cost) };
  const before = structuredClone(acquired.state);
  for (const executionCosts of [mergeExecutionCosts(base, { ...cost, readSet: cost.readSet.filter(binding => binding.ref !== entry.entryId) }),
    mergeExecutionCosts(base, { ...cost, costs: [cost.costs[0], { ...cost.costs[1], quantity: 3 }] })]) {
    const denied = f.runtime.step(f.profiles, acquired.state, { ...input, executionCosts });
    assert.equal(denied.kind, 'rejected', JSON.stringify(denied));
    assert.deepEqual(denied.events, []);
    assert.deepEqual(acquired.state, before);
  }
  const done = f.runtime.step(f.profiles, acquired.state, input);
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.equal(done.events.some(event => event.eventType === 'RandomnessRequested'), false);
  assert.equal(done.state.entities[ACTOR].resources.focus, 2);
  assert.equal(done.state.campaignRuntime.itemSystem.entries[entry.entryId].quantity, 1);
  assert.equal(done.events.filter(event => event.eventType === 'ItemUsed').length, 1);
  replay(f, [...acquired.events, ...done.events], done.state);
  assert.equal(f.runtime.step(f.profiles, done.state, input).kind, 'rejected');
});

test('accepted costs survive a frozen choice, native pending and later randomness without duplicate payment', () => {
  const f = fixture('accepted-cost-native', { knockout: true, resourceBalance: 3 });
  const begun = beginFrozen(f, attackBundle({ melee: true }), acceptedCosts(f));
  const pending = dice(f, begun.selected, 15);
  assert.equal(pending.kind, 'awaitingInput', JSON.stringify(pending));
  unpublished(f, pending);
  const events = [...begun.events, ...pending.events];
  replay(f, events, pending.state);
  const next = answer(f, pending, { kind: 'knockOut' });
  assert.equal(next.kind, 'awaitingRandomness', JSON.stringify(next));
  events.push(...next.events);
  replay(f, events, next.state);
  unpublished(f, next);
  const done = dice(f, next, 15, 3);
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  events.push(...done.events);
  assert.equal(done.state.entities[ACTOR].resources.focus, 2);
  assert.equal(events.filter(event => event.eventType === 'ResourceUsed' && event.payload.resourceId === 'focus').length, 1);
  assert.equal(events.filter(event => event.eventType === 'ItemUsed').length, 1);
  replay(f, events, done.state);
});

test('social accepted costs preserve the verified source plan after new history expands the NPC context', () => {
  for (const roll of [null, 1, 20]) {
    const f = fixture(`accepted-cost-social-${roll}`, { npc: true, resourceBalance: 3 });
    const parsed = parseBundle(worldFactSocialBundle({
      sceneRef: 'scene:probe-gallery', npcRef: TARGET, check: roll !== null }));
    assert.equal(parsed.kind, 'accepted');
    const lower = lowerVNext2ProposalBundle({ value: parsed.bundle, rootActionId: f.rootActionId,
      actorCharacterId: ACTOR, requiredContext: f.requiredContext, state: f.state });
    assert.equal(lower.kind, 'accepted', JSON.stringify(lower));
    const frozen = structuredClone(lower.command.rulesInput);
    const first = f.runtime.step(f.profiles, f.state, { ...frozen, executionCosts: acceptedCosts(f) });
    assert.equal(first.kind, roll === null ? 'committed' : 'awaitingRandomness', JSON.stringify(first));
    const result = roll === null ? first : f.runtime.step(f.profiles, first.state,
      { kind: 'fulfillAuthoritativeRandomness', continuation: first.continuation, rolls: [roll] });
    assert.equal(result.kind, 'committed', JSON.stringify(result));
    const events = roll === null ? result.events : [...first.events, ...result.events];
    const settlement = result.events.find(event => event.eventType === 'WorldInteractionResolved' && event.payload.social);
    assert.ok(settlement);
    assert.equal(settlement.payload.planHash, worldInteractionPlanHash(settlement.payload.social.plan));
    assert.equal(result.state.entities[ACTOR].resources.focus, 2);
    assert.equal(events.filter(event => event.eventType === 'ResourceUsed').length, 1);
    assert.deepEqual(lower.command.rulesInput, frozen);
    replay(f, events, result.state);
    if (roll !== null) assert.equal(first.state.entities[ACTOR].resources.focus, 3);
  }
});

test('a direct frozen choice pays social costs once before creating history and speaking', () => {
  const f = fixture('accepted-cost-social-choice-direct', { npc: true, resourceBalance: 3 });
  const parsed = parseBundle(worldFactSocialBundle({ sceneRef: 'scene:probe-gallery', npcRef: TARGET }));
  assert.equal(parsed.kind, 'accepted');
  const { selected, events } = beginFrozen(f, parsed.bundle, acceptedCosts(f), 'committed');
  assert.equal(selected.state.entities[ACTOR].resources.focus, 2);
  assert.equal(events.filter(event => event.eventType === 'ResourceUsed').length, 1);
  assert.equal(events.some(event => event.eventType === 'DiceRolled'), false);
  replay(f, events, selected.state);
});

test('social without new history shares direct, check and frozen-choice cost settlement', () => {
  for (const choice of [false, true]) for (const roll of [null, 1, 20]) {
    const f = fixture(`accepted-cost-social-only-${choice}-${roll}`, { npc: true, resourceBalance: 3 });
    const bundle = socialOnlyBundle(roll !== null);
    const lower = lowerVNext2ProposalBundle({ value: bundle, rootActionId: f.rootActionId,
      actorCharacterId: ACTOR, requiredContext: f.requiredContext, state: f.state });
    assert.equal(lower.kind, 'accepted', JSON.stringify(lower));
    const first = choice ? beginFrozen(f, bundle, acceptedCosts(f), roll === null ? 'committed' : 'awaitingRandomness')
      : { selected: f.runtime.step(f.profiles, f.state, { ...atomicInput(f, lower, bundle), executionCosts: acceptedCosts(f) }), events: [] };
    if (!choice) first.events.push(...first.selected.events);
    assert.equal(first.selected.kind, roll === null ? 'committed' : 'awaitingRandomness', JSON.stringify(first.selected));
    const done = roll === null ? first.selected : f.runtime.step(f.profiles, first.selected.state,
      { kind: 'fulfillAuthoritativeRandomness', continuation: first.selected.continuation, rolls: [roll] });
    assert.equal(done.kind, 'committed', JSON.stringify(done));
    const events = roll === null ? first.events : [...first.events, ...done.events];
    assert.equal(done.state.entities[ACTOR].resources.focus, 2);
    assert.equal(events.filter(event => event.eventType === 'ResourceUsed').length, 1);
    replay(f, events, done.state);
  }
});

test('native reaction recovery preserves the paid prefix and unpublished social settlement', () => {
  for (const choice of [false, true]) {
    const f = fixture(`accepted-cost-native-social-${choice}`, { shield: 'both', npc: true, resourceBalance: 3 });
    const bundle = attackBundle();
    bundle.proposals[4].operation.targetRefs = ['character:probe-third'];
    bundle.proposals.unshift(socialOnlyBundle().proposals[0]);
    const first = choice ? beginFrozen(f, bundle, acceptedCosts(f)) : { selected: begin(f, bundle, acceptedCosts(f)), events: [] };
    if (!choice) first.events.push(...first.selected.events);
    const pending = dice(f, first.selected);
    assert.equal(pending.kind, 'awaitingInput', JSON.stringify(pending));
    assert.equal(pending.pending.controllerEntityId, 'character:probe-third');
    unpublished(f, pending);
    const prefix = [...first.events, ...pending.events];
    replay(f, prefix, pending.state);
    const done = answer(f, pending, { kind: 'decline' });
    assert.equal(done.kind, 'committed', JSON.stringify(done));
    const events = [...prefix, ...done.events];
    assert.equal(done.state.entities[ACTOR].resources.focus, 2);
    assert.equal(events.filter(event => event.eventType === 'ResourceUsed' && event.payload.resourceId === 'focus').length, 1);
    assert.equal(events.filter(event => event.eventType === 'ItemUsed').length, 1);
    assert.ok(events.some(event => event.eventType === 'WorldInteractionResolved' && event.payload.social));
    assert.equal(Object.keys(done.state.atomicWorldInteractions).length, 0);
    replay(f, events, done.state);
    assert.equal(answer(f, { ...pending, state: done.state }, { kind: 'decline' }).kind, 'rejected');
  }
});

test('social after item acquisition and use preserves frozen context through native recovery', () => {
  for (const withCosts of [false, true]) for (const native of [false, true]) for (const choice of [false, true])
    for (const reaction of native ? ['decline','useReaction'] : ['decline']) {
    const f = fixture(`post-item-social-${withCosts}-${native}-${choice}-${reaction}`, { shield: 'both', npc: true, resourceBalance: 3 });
    const bundle = attackBundle();
    bundle.proposals[4].operation.targetRefs = ['character:probe-third'];
    bundle.proposals.push(socialOnlyBundle().proposals[0]);
    const costs = withCosts ? acceptedCosts(f) : undefined;
    const first = choice ? beginFrozen(f, bundle, costs) : { selected: begin(f, bundle, costs), events: [] };
    if (!choice) first.events.push(...first.selected.events);
    const result = dice(f, first.selected, native ? 10 : 1, 1);
    assert.equal(result.kind, native ? 'awaitingInput' : 'committed', JSON.stringify(result));
    const prefix = [...first.events, ...result.events];
    if (native) { unpublished(f, result); replay(f, prefix, result.state); }
    const response = reaction === 'decline' ? {kind:'decline'} : {kind:'useReaction',abilityRef:'spell:shield',slotLevel:'1'};
    const done = native ? answer(f, result, response) : result;
    assert.equal(done.kind, 'committed', JSON.stringify(done));
    const events = native ? [...prefix, ...done.events] : prefix;
    assert.equal(done.state.entities[ACTOR].resources.focus, withCosts ? 2 : 3);
    assert.equal(events.filter(event => event.eventType === 'ResourceUsed' && event.payload.resourceId === 'focus').length, withCosts ? 1 : 0);
    assert.equal(events.filter(event => event.eventType === 'ItemUsed').length, 1);
    assert.equal(events.filter(event => event.eventType === 'ResourceSpent' && event.payload.resourceId === 'spellSlot:1').length,
      reaction === 'useReaction' ? 1 : 0);
    assert.equal(done.state.entities['character:probe-third'].resources['spellSlot:1'],reaction === 'useReaction' ? 1 : 2);
    // The item use's own Activity advance plus the act's frozen duration: two, and only two.
    assert.equal(events.filter(event => event.eventType === 'FictionTimeAdvanced').length, 2);
    const social = events.find(event => event.eventType === 'WorldInteractionResolved' && event.payload.social);
    assert.ok(social);
    // The NPC snapshot is rebound after the item Activity's six seconds and this act's own tier.
    assert.equal(social.payload.social.plan.social.npcContext.records.find(record => record.kind === 'timeline').value.nowMicros, '306000000');
    assert.equal(Object.keys(done.state.atomicWorldInteractions).length, 0);
    replay(f, events, done.state);
    if (native) assert.equal(answer(f, { ...result, state: done.state }, { kind: 'decline' }).kind, 'rejected');
  }
});

test('social after direct acquisition proves changed inventory without a dice or time boundary', () => {
  for (const withCosts of [false, true]) for (const choice of [false, true]) {
    const f = fixture(`direct-acquire-social-${withCosts}-${choice}`, { npc: true, resourceBalance: 3 });
    const bundle = itemBundle(); bundle.proposals.pop(); bundle.proposals.push(socialOnlyBundle().proposals[0]);
    const costs = withCosts ? acceptedCosts(f) : undefined;
    let done, events;
    if (choice) { const selected = beginFrozen(f,bundle,costs,'committed'); done=selected.selected; events=selected.events; }
    else {
      const lowered=lowerVNext2ProposalBundle({value:bundle,rootActionId:f.rootActionId,actorCharacterId:ACTOR,requiredContext:f.requiredContext,state:f.state});
      assert.equal(lowered.kind,'accepted');
      done=f.runtime.step(f.profiles,f.state,{...lowered.command.rulesInput,...(costs?{executionCosts:costs}:{})}); events=done.events;
    }
    assert.equal(done.kind,'committed',JSON.stringify(done));
    assert.equal(events.some(event=>event.eventType==='DiceRolled'),false);
    // No dice, and the only time that passed is the act's own frozen duration, paid ahead of everything else.
    assert.deepEqual(events.filter(event=>event.eventType==='FictionTimeAdvanced').map(event=>event.payload.durationMicros),['300000000']);
    assert.ok(events.findIndex(event=>event.eventType==='FictionTimeAdvanced')<events.findIndex(event=>event.eventType==='WorldInteractionResolved'),'the act pays its duration before its result');
    assert.equal(done.state.entities[ACTOR].resources.focus,withCosts?2:3);
    assert.ok(events.some(event=>event.eventType==='WorldInteractionResolved'&&event.payload.social));
    replay(f,events,done.state);
  }
});

test('item prefix composes with materialized NPC knowledge and silence', () => {
  for (const history of [false, true]) for (const silence of [false, true]) {
    const f = fixture(`post-item-memory-${history}-${silence}`, { npc: true, resourceBalance: 3, includeThird: true });
    const bundle = attackBundle(); bundle.proposals[4].operation.targetRefs = ['character:probe-third'];
    const socialBundle = structuredClone(history ? parseBundle(worldFactSocialBundle({ sceneRef: 'scene:probe-gallery', npcRef: TARGET })).bundle : socialOnlyBundle());
    if (silence) for (const branch of Object.values(socialBundle.proposals.at(-1).branches)) {
      if (branch?.response) branch.response = { ...branch.response, kind: 'silence', text: '' };
    }
    bundle.proposals.push(...socialBundle.proposals);
    const first = begin(f, bundle, acceptedCosts(f)), done = dice(f, first, 10, 1);
    assert.equal(done.kind, 'committed', JSON.stringify(done));
    const events = [...first.events, ...done.events];
    const social = events.find(event => event.eventType === 'WorldInteractionResolved' && event.payload.social);
    assert.ok(social); assert.equal(social.payload.appliedEffects.length, 0);
    assert.ok(events.some(event => event.eventType === 'DamagePacketResolved'));
    const context = social.payload.social.plan.social.npcContext;
    // The NPC snapshot is rebound to the clock after the item Activity and after this act's own duration.
    assert.equal(context.records.find(record => record.kind === 'timeline').value.nowMicros, '306000000');
    assert.equal(context.knowledge.length, history ? 1 : 0);
    const thread = done.state.campaignRuntime.conversationThreads[social.payload.social.plan.social.threadRef];
    assert.equal(thread.responseClaimRef === null, silence);
    assert.equal(done.state.entities[ACTOR].resources.focus, 2);
    replay(f, events, done.state);
  }
});

test('private social candidate cannot certify damage for a public fold with an unchanged or unbound plan', () => {
  for (const mode of ['direct','choice','beforeDice']) {
    const f = fixture(`social-candidate-proof-${mode}`, { npc: true, includeThird: true });
    const bundle = socialOnlyBundle(mode === 'beforeDice');
    let events, scopeProof;
    if (mode === 'choice') {
      const frozen=beginFrozen(f,bundle,undefined,'committed');
      events=frozen.events;scopeProof=frozen.selected.scopeProof;
    }
    else {
      const lowered = lowerVNext2ProposalBundle({ value: bundle, rootActionId: f.rootActionId,
        actorCharacterId: ACTOR, requiredContext: f.requiredContext, state: f.state });
      assert.equal(lowered.kind,'accepted');
      const first = f.runtime.step(f.profiles,f.state,mode === 'beforeDice' ? atomicInput(f,lowered,bundle) : lowered.command.rulesInput);
      const done = mode === 'beforeDice'
        ? f.runtime.step(f.profiles,first.state,{kind:'fulfillAuthoritativeRandomness',continuation:first.continuation,rolls:[20]}) : first;
      assert.equal(done.kind,'committed');
      events=mode === 'beforeDice' ? [...first.events,...done.events] : done.events;scopeProof=done.scopeProof;
    }
    let state=f.state, injected=false, reachedSettlement=false;
    const committed=[];
    const ids=new Map();
    const remap = value => typeof value === 'string' ? ids.get(value) ?? value
      : Array.isArray(value) ? value.map(remap) : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key,child]) => [key,remap(child)])) : value;
    for (const event of events) {
      const draft={ rootActionId:event.rootActionId, resolutionId:event.resolutionId, eventType:event.eventType,
        payload:remap(event.payload),scopeProof,
        visibilityPolicyId:event.visibilityPolicyId,secrecy:event.secrecy };
      if (!injected && event.eventType === (mode === 'beforeDice' ? 'DiceRolled' : 'SourceClaimCreated')) {
        const target=state.entities['character:probe-third'];
        const extra=createEventTransition(state,f.profiles,{...draft,eventType:'HitPointsChanged',
          payload:{characterId:target.id,before:target.hitPoints.current,after:target.hitPoints.current-1,
            maximum:target.hitPoints.maximum,causeId:'unapproved-prefix-damage'}});
        state=extra.state;committed.push(extra.event);injected=true;
      }
      if (event.eventType==='WorldInteractionResolved' && draft.payload.social) {
        reachedSettlement=true;
        const receipts=canonicalSha256(state.receipts);
        const candidate=createCandidateEventTransition(state,f.profiles,draft);
        assert.equal(validateEventEnvelope(candidate.event).ok,true);
        assert.equal(canonicalSha256(candidate.state.receipts),receipts);
        assert.throws(()=>createEventTransition(state,f.profiles,{...draft,candidate:true,planningSpecs:[]}),
          /social:accepted-cost-prefix-not-proven|damage effects were not committed/);
        assert.equal(f.runtime.replay(f.genesis,[...committed,candidate.event]).kind,'rejected');
        break;
      }
      const next=createEventTransition(state,f.profiles,draft);
      state=next.state;ids.set(event.eventId,next.event.eventId);committed.push(next.event);
    }
    assert.equal(reachedSettlement,true);
  }
});

test('social prefix rejects injected same-root changes and borrowed native damage', () => {
  for (const mutation of ['extraResource', 'extraTime', 'extraThirdDamage', 'extraNativePacket', 'changedNativeDamage',
    'missingNativeDamage', 'missingCommittedDice', 'missingCompletion', 'changedNativeTarget', 'forgedSocialDamage']) {
    const f = fixture(`social-prefix-forged-${mutation}`, { npc: true, resourceBalance: 3, includeThird: true });
    const bundle = attackBundle(); bundle.proposals[4].operation.targetRefs = ['character:probe-third'];
    bundle.proposals.push(socialOnlyBundle().proposals[0]);
    const first = begin(f,bundle), done = dice(f,first,10,1);
    assert.equal(done.kind,'committed');
    let state = first.state, beforeSocial, reachedSettlement = false;
    const remappedIds = new Map();
    const remap = value => typeof value === 'string' ? remappedIds.get(value) ?? value
      : Array.isArray(value) ? value.map(remap) : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remap(child)])) : value;
    for (const event of done.events) {
      const payload = remap(event.payload);
      if (event.eventType === 'ActivityCompleted' && mutation === 'missingCompletion') continue;
      if (event.eventType === 'DamagePacketResolved' && mutation === 'missingNativeDamage') continue;
      if (event.eventType === 'DiceRolled' && mutation === 'missingCommittedDice') continue;
      if (event.eventType === 'DamagePacketResolved' && mutation === 'changedNativeDamage') {
        payload.totalApplied++; payload.components[0].rolled++; payload.components[0].applied++;
        payload.targetPatch.hitPoints.current = String(Number(payload.targetPatch.hitPoints.current) - 1);
      }
      if (event.eventType === 'RandomnessRequested' && payload.resolution && mutation === 'changedNativeTarget') {
        payload.resolution.operation.targetEntityIds = [TARGET];
      }
      const input = { rootActionId: event.rootActionId, resolutionId: event.resolutionId, eventType: event.eventType,
        payload, scopeProof: done.scopeProof, visibilityPolicyId: event.visibilityPolicyId, secrecy: event.secrecy };
      if (event.eventType === 'SourceClaimCreated' && !beforeSocial) {
        if (mutation === 'extraThirdDamage') {
          const target = state.entities['character:probe-third'];
          const extra = createEventTransition(state, f.profiles, { ...input,
            resolutionId: done.events.find(candidate => candidate.eventType === 'DamagePacketResolved').resolutionId,
            eventType: 'HitPointsChanged', payload: { characterId: target.id, before: target.hitPoints.current,
              after: target.hitPoints.current - 1, maximum: target.hitPoints.maximum, causeId: 'unapproved prefix damage' } });
          assert.equal(validateEventEnvelope(extra.event).ok, true); state = extra.state;
        }
        if (mutation === 'extraNativePacket') {
          const native = done.events.find(candidate => candidate.eventType === 'DamagePacketResolved');
          const damage = structuredClone(native.payload);
          damage.targetPatch = structuredClone(state.combatRuntime.entities[damage.targetEntityId]);
          damage.targetPatch.hitPoints.current = String(Number(damage.targetPatch.hitPoints.current) - 1);
          const extra = createEventTransition(state,f.profiles,{ ...input, resolutionId: native.resolutionId,
            eventType: 'DamagePacketResolved', payload: damage });
          assert.equal(validateEventEnvelope(extra.event).ok,true); state=extra.state;
        }
        if (mutation === 'extraResource' || mutation === 'extraTime') {
          const extra = createEventTransition(state, f.profiles, { ...input,
            eventType: mutation === 'extraResource' ? 'ResourceChanged' : 'FictionTimeAdvanced',
            payload: mutation === 'extraResource' ? { characterId: ACTOR, resourceId: 'focus', before: 3, after: 2, delta: -1, reason: 'unapproved prefix change' }
              : { durationMicros: '1', reason: 'unapproved prefix change' } });
          assert.equal(validateEventEnvelope(extra.event).ok, true);
          state = extra.state;
        }
        beforeSocial = state;
      }
      if (event.eventType === 'SourceClaimCreated' && mutation === 'extraTime')
        payload.formedAtFictionMicros = authoritativeNpcDecisionContext(beforeSocial,f.profiles,TARGET).records.find(record => record.kind === 'timeline').value.nowMicros;
      if (event.eventType === 'WorldInteractionResolved' && payload.social) {
        reachedSettlement = true;
        payload.social.plan.readSet = payload.social.plan.readSet.map(binding => ({ ref: binding.ref,
          revisionOrHash: authorityRevisionOrHash(beforeSocial,binding.ref) ?? binding.revisionOrHash }));
        payload.social.plan.social.npcContext = authoritativeNpcDecisionContext(beforeSocial,f.profiles,TARGET);
        payload.planHash = worldInteractionPlanHash(payload.social.plan);
        if (mutation === 'forgedSocialDamage') {
          const packet = done.events.find(candidate => candidate.eventType === 'DamagePacketResolved');
          const ability = done.events.find(candidate => candidate.eventType === 'AbilityInvoked').payload.abilityRef;
          payload.appliedEffects.push({ kind: 'damage', sourceDefinitionRef: ability, targetRef: 'character:probe-third',
            amount: 1, damageType: 'force', hpBefore: 10, hpAfter: 9, died: false, hitPointDamage: 1, damagePacketHash: packet.payloadHash });
        }
        assert.throws(() => createEventTransition(state,f.profiles,input),
          /social:accepted-cost-prefix-not-proven|social:frozen-source-plan-changed|damage effects were not committed/, mutation);
        break;
      }
      const next = createEventTransition(state,f.profiles,input);
      assert.equal(validateEventEnvelope(next.event).ok,true);
      state=next.state;remappedIds.set(event.eventId,next.event.eventId);
    }
    assert.equal(reachedSettlement,true,mutation);
  }
});

test('social settlement rejects omitted or changed frozen costs even when the submitted plan is rebound', () => {
  for (const damage of ['omit', 'amount', 'laterResource', 'foreignRoot']) {
    const f = fixture(`accepted-cost-social-forged-${damage}`, { npc: true, resourceBalance: 3 });
    const bundle = socialOnlyBundle(true);
    const lower = lowerVNext2ProposalBundle({ value: bundle, rootActionId: f.rootActionId,
      actorCharacterId: ACTOR, requiredContext: f.requiredContext, state: f.state });
    assert.equal(lower.kind, 'accepted');
    const pending = f.runtime.step(f.profiles, f.state, { ...atomicInput(f, lower, bundle), executionCosts: acceptedCosts(f) });
    assert.equal(pending.kind, 'awaitingRandomness');
    const done = f.runtime.step(f.profiles, pending.state,
      { kind: 'fulfillAuthoritativeRandomness', continuation: pending.continuation, rolls: [20] });
    assert.equal(done.kind, 'committed');
    let state = pending.state, reachedSettlement = false;
    const remappedIds = new Map();
    const remap = value => typeof value === 'string' ? remappedIds.get(value) ?? value
      : Array.isArray(value) ? value.map(remap) : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remap(child)])) : value;
    for (const event of done.events) {
      const payload = remap(event.payload);
      if (event.eventType === 'ResourceUsed' && damage === 'omit') continue;
      if (event.eventType === 'ResourceUsed' && damage === 'amount') payload.amount = 2;
      const input = { rootActionId: event.rootActionId, resolutionId: event.resolutionId, eventType: event.eventType,
        payload, scopeProof: done.scopeProof, visibilityPolicyId: event.visibilityPolicyId, secrecy: event.secrecy };
      if (event.eventType === 'ResourceUsed' && damage === 'foreignRoot') input.rootActionId = 'root:foreign-cost';
      if (event.eventType === 'WorldInteractionResolved' && payload.social) {
        reachedSettlement = true;
        payload.social.plan.readSet = payload.social.plan.readSet.map(binding => ({ ref: binding.ref,
          revisionOrHash: authorityRevisionOrHash(state, binding.ref) ?? binding.revisionOrHash }));
        payload.planHash = worldInteractionPlanHash(payload.social.plan);
        assert.throws(() => createEventTransition(state, f.profiles, input),
          /social:accepted-cost-prefix-not-proven|social:frozen-source-plan-changed/, damage);
        break;
      }
      const next = createEventTransition(state, f.profiles, input);
      assert.equal(validateEventEnvelope(next.event).ok, true, JSON.stringify(next.event));
      state = next.state; remappedIds.set(event.eventId, next.event.eventId);
      if (event.eventType === 'ResourceUsed' && damage === 'laterResource') {
        const extra = createEventTransition(state, f.profiles, { ...input, eventType: 'ResourceChanged',
          payload: { characterId: ACTOR, resourceId: 'focus', before: 2, after: 1, delta: -1, reason: 'later mutation' } });
        assert.equal(validateEventEnvelope(extra.event).ok, true);
        state = extra.state;
      }
    }
    assert.equal(reachedSettlement, true);
  }
});

test('a single check with accepted costs closes its frozen continuation after either outcome', () => {
  for (const kind of ['observe', 'worldInteraction']) for (const roll of [1, 20]) {
    const f = fixture(`accepted-cost-single-${kind}-${roll}`, { resourceBalance: 3 });
    const wire = sharedCheckBundle(kind); wire.proposals = [wire.proposals[1]];
    const parsed = parseBundle(wire);
    assert.equal(parsed.kind, 'accepted');
    const lower = lowerVNext2ProposalBundle({ value: parsed.bundle, rootActionId: f.rootActionId,
      actorCharacterId: ACTOR, requiredContext: f.requiredContext, state: f.state });
    assert.equal(lower.kind, 'accepted');
    const pending = f.runtime.step(f.profiles, f.state, { ...lower.command.rulesInput, executionCosts: acceptedCosts(f) });
    assert.equal(pending.kind, 'awaitingRandomness', JSON.stringify(pending));
    const result = f.runtime.step(f.profiles, pending.state,
      { kind: 'fulfillAuthoritativeRandomness', continuation: pending.continuation, rolls: [roll] });
    assert.equal(result.kind, 'committed', JSON.stringify(result));
    assert.equal(result.state.entities[ACTOR].resources.focus, 2);
    assert.equal(Object.values(result.state.internalContinuations).some(entry => entry.rootActionId === f.rootActionId), false);
    replay(f, [...pending.events, ...result.events], result.state);
    assert.equal(f.runtime.step(f.profiles, result.state,
      { kind: 'fulfillAuthoritativeRandomness', continuation: pending.continuation, rolls: [roll] }).kind, 'rejected');
  }
});

test('accepted cost preflight refuses missing dependencies, insufficient resources, duplicates and an unbound or undeclared duration atomically', () => {
  const f = fixture('accepted-cost-invalid', { resourceBalance: 1 });
  const lower = lowerVNext2ProposalBundle({ value: itemBundle(), rootActionId: f.rootActionId,
    actorCharacterId: ACTOR, requiredContext: f.requiredContext, state: f.state });
  assert.equal(lower.kind, 'accepted');
  const snapshot = structuredClone(f.state);
  const time = fictionTimeCost(f);
  for (const executionCosts of [acceptedCosts(f, 2), { ...acceptedCosts(f), readSet: [] },
    // The act's duration must be bound to the actor's timeline like any other cost dependency.
    { ...acceptedCosts(f), readSet: acceptedCosts(f).readSet.filter(binding => binding.ref === ACTOR) },
    { ...acceptedCosts(f), costs: [...acceptedCosts(f).costs, ...acceptedCosts(f).costs] },
    { ...acceptedCosts(f), readSet: [{ ref: ACTOR, revisionOrHash: `sha256:${'0'.repeat(64)}` }, time.binding].sort(byRef) }]) {
    const rejected = f.runtime.step(f.profiles, f.state, { ...lower.command.rulesInput, executionCosts });
    assert.equal(rejected.kind, 'rejected', JSON.stringify(rejected));
    assert.deepEqual(f.state, snapshot);
    assert.deepEqual(rejected.events, []);
  }
});

test('an act pays its frozen duration once, ahead of its results, on the actor timeline', () => {
  const f = fixture('accepted-cost-duration', { resourceBalance: 3 });
  const creation = itemBundle(); creation.proposals.pop();
  const first = lowerVNext2ProposalBundle({ value: creation, rootActionId: f.rootActionId,
    actorCharacterId: ACTOR, requiredContext: f.requiredContext, state: f.state });
  assert.equal(first.kind, 'accepted', JSON.stringify(first));
  // Acquiring the item is itself an act, so the creation Bundle carries the fixture's duration and spends it once.
  assert.deepEqual(first.command.rulesInput.executionCosts.costs, [{ kind: 'fictionTime', durationMicros: '300000000' }]);
  const acquired = f.runtime.step(f.profiles, f.state, first.command.rulesInput);
  assert.equal(acquired.kind, 'committed', JSON.stringify(acquired));
  assert.equal(acquired.events.filter(event => event.eventType === 'FictionTimeAdvanced').length, 1);
  const rootActionId = `${f.rootActionId}:direct`;
  const context = freezeAuthoredProbeContext(f, acquired.state, { rootActionId,
    focusRefs: [TARGET, 'definition:probe-valve'] }).context;
  const value = sharedCheckBundle('worldInteraction');
  value.adjudication = { kind: 'directSuccess', durationMicros: '600000000', risk: '转动阀门。', successOutcome: '阀门转动。' };
  value.proposals = [value.proposals[1]];
  value.proposals[0].branches.failure = { kind: 'none' };
  const parsed = parseBundle(value);
  assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
  const lower = lowerVNext2ProposalBundle({ value: parsed.bundle, rootActionId,
    actorCharacterId: ACTOR, requiredContext: context, state: acquired.state });
  assert.equal(lower.kind, 'accepted', JSON.stringify(lower));
  // Lowering owns the "must declare" half: an act in the world with a zero duration is refused there,
  // before Rules ever sees it, and a pure authoring Bundle with a positive one likewise.
  const zero = structuredClone(parsed.bundle); zero.adjudication = { ...zero.adjudication, durationMicros: '0' };
  assert.deepEqual(lowerVNext2ProposalBundle({ value: zero, rootActionId, actorCharacterId: ACTOR, requiredContext: context, state: acquired.state }).issues,
    ['bundle2:duration-required-for-in-world-act']);
  const authoring = itemBundle(); authoring.proposals = authoring.proposals.slice(0, 3); authoring.adjudication.durationMicros = '300000000';
  assert.deepEqual(lowerVNext2ProposalBundle({ value: authoring, rootActionId: f.rootActionId, actorCharacterId: ACTOR, requiredContext: f.requiredContext, state: f.state }).issues,
    ['bundle2:duration-forbidden-for-pure-authoring']);
  // A solo in-world act takes the atomic path, and lowering declared the ruling's duration as its execution cost.
  assert.equal(lower.command.rulesInput.kind, 'applyAtomicWorldInteractionSteps');
  assert.deepEqual(lower.command.rulesInput.executionCosts.costs, [{ kind: 'fictionTime', durationMicros: '600000000' }]);
  assert.ok(lower.command.rulesInput.executionCosts.readSet.some(binding => binding.ref === `character-timeline:${ACTOR}`));
  const timelineId = acquired.state.multiplayerRuntime.characterTimelineIds[ACTOR] ?? acquired.state.activeBranchId;
  const before = BigInt(acquired.state.fictionTimelines[timelineId].nowMicros);
  const done = f.runtime.step(f.profiles, acquired.state, lower.command.rulesInput);
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  const advances = done.events.filter(event => event.eventType === 'FictionTimeAdvanced');
  assert.equal(advances.length, 1);
  assert.equal(advances[0].payload.durationMicros, '600000000');
  // The advance precedes every result of the act.
  assert.equal(done.events.indexOf(advances[0]), 0);
  assert.equal(BigInt(done.state.fictionTimelines[timelineId].nowMicros) - before, 600000000n);
  assert.deepEqual(done.mechanicalResult.fictionTime, { durationMicros: '600000000', crossedDeadlines: [] });
  replay(f, [...acquired.events, ...done.events], done.state);
});


test('a frozen choice answer cannot invalidate another atomic action suspended for a native reaction', () => {
  const f = fixture('frozen-native-conflict', { shield: true });
  const bundle = itemBundle(); bundle.proposals.pop();
  const lower = lowerVNext2ProposalBundle({ value: bundle, rootActionId: f.rootActionId,
    actorCharacterId: ACTOR, requiredContext: f.requiredContext, state: f.state });
  assert.equal(lower.kind, 'accepted');
  const { kind: _kind, ...atomic } = lower.command.rulesInput;
  const pendingInputId = `pending:${f.rootActionId}`;
  const waiting = f.runtime.step(f.profiles, f.state, { kind: 'openFrozenPlayerChoice', rootActionId: f.rootActionId,
    actorCharacterId: ACTOR, plan: { schema: 'zhuwei.frozen-player-choice/vnext-1', rootActionId: f.rootActionId,
      actorCharacterId: ACTOR, pendingInputId, contextHash: f.requiredContext.binding.contextHash,
      bundleHash: canonicalSha256(bundle), profilesHash: canonicalSha256(f.profiles), readSet: [], question: '执行还是取消？',
      choices: [
        { choiceId: 'proceed', label: '执行', publicRisk: '取得物品。', continuation: { kind: 'adjudication',
          plan: { schema: ATOMIC_WORLD_INTERACTION_STEPS_PLAN_SCHEMA, ...atomic } } },
        { choiceId: 'cancel', label: '取消', publicRisk: '不执行。', continuation: { kind: 'cancel' } },
      ] } });
  assert.equal(waiting.kind, 'awaitingInput');
  const otherRoot = `${f.rootActionId}:other`;
  const other = { ...f, state: waiting.state, rootActionId: otherRoot,
    requiredContext: freezeAuthoredProbeContext(f, waiting.state, { rootActionId: otherRoot,
      focusRefs: [TARGET, 'definition:probe-valve', 'definition:probe-steam-zone'] }).context };
  const suspended = dice(other, begin(other, attackBundle()));
  assert.equal(suspended.kind, 'awaitingInput');
  assert.ok(suspended.state.atomicWorldInteractions[otherRoot]);
  const rejected = f.runtime.step(f.profiles, suspended.state, { kind: 'answerFrozenPlayerChoice',
    rootActionId: f.rootActionId, controllerCharacterId: ACTOR, pendingInputId, choiceId: 'proceed' });
  assert.equal(rejected.kind, 'rejected');
  assert.equal(rejected.rejection.code, 'causalFrontierConflict');
  assert.deepEqual(rejected.events, []);
  assert.ok(suspended.state.pendingInputs[pendingInputId]);
  const resumed = answer(other, suspended, { kind: 'decline' });
  assert.equal(resumed.kind, 'committed');
  assert.ok(resumed.state.pendingInputs[pendingInputId]);
});
for (const reaction of ['decline', 'useReaction']) test(`atomic authored Item resumes Shield ${reaction} without publishing candidate prefix`, () => {
  const f = fixture(`shield-${reaction}`, { shield: true });
  const waiting = begin(f, attackBundle());
  const pending = dice(f, waiting);
  assert.equal(pending.kind, 'awaitingInput', JSON.stringify(pending));
  assert.equal(pending.pending.controllerEntityId, TARGET);
  assert.match(pending.pending.pendingInputId, /^pending:atomic:/);
  unpublished(f, pending);
  replay(f, [...waiting.events, ...pending.events], pending.state);
  assert.equal(dice(f, { ...waiting, state: pending.state }).kind, 'rejected');
  const done = answer(f, pending, reaction === 'decline' ? { kind: 'decline' } : { kind: 'useReaction', abilityRef: 'spell:shield', slotLevel: '1' });
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.equal(done.state.entities[TARGET].hitPoints.current, reaction === 'decline' ? 18 : 20);
  assert.equal(done.state.entities[TARGET].resources['spellSlot:1'], reaction === 'decline' ? 2 : 1);
  assert.equal(done.events.filter(event => event.eventType === 'ItemUsed').length, 1);
  assert.equal(Object.values(done.state.campaignRuntime.itemSystem.entries)[0].quantity, 1);
  assert.equal(Object.keys(done.state.atomicWorldInteractions).length, 0);
  assert.equal(answer(f, { ...pending, state: done.state }, { kind: 'decline' }).kind, 'rejected');
  replay(f, [...waiting.events, ...pending.events, ...done.events], done.state);
});
for (const decision of ['dealLethalDamage', 'knockOut']) test(`atomic melee ${decision} holds the whole candidate through choice-dependent recovery dice`, () => {
  const f = fixture(`knockout-${decision}`, { knockout: true });
  const waiting = begin(f, attackBundle({ melee: true }));
  const pending = dice(f, waiting, 15);
  assert.equal(pending.kind, 'awaitingInput', JSON.stringify(pending));
  assert.equal(pending.pending.choiceKind, 'knockOut');
  assert.equal(pending.pending.controllerEntityId, ACTOR);
  unpublished(f, pending);
  let done = answer(f, pending, { kind: decision });
  const events = [...waiting.events, ...pending.events, ...done.events];
  if (decision === 'knockOut') {
    assert.equal(done.kind, 'awaitingRandomness', JSON.stringify(done));
    unpublished(f, done);
    assert.ok(done.events.some(event => event.eventType === 'RandomnessRequested' && event.payload.request));
    const next = dice(f, done, 15, 3); events.push(...next.events); done = next;
  }
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.equal(done.state.entities[TARGET].hitPoints.current, 0);
  assert.equal(events.filter(event => event.eventType === 'ItemUsed').length, 1);
  assert.equal(Object.values(done.state.campaignRuntime.itemSystem.entries)[0].quantity, 1);
  replay(f, events, done.state);
});

test('changed authority and malformed answers cannot commit an atomic candidate', () => {
  const f = fixture('shield-conflict', { shield: true });
  const pending = dice(f, begin(f, attackBundle()));
  assert.equal(pending.kind, 'awaitingInput', JSON.stringify(pending));
  for (const value of [{ kind: 'useReaction', abilityRef: 'spell:shield', slotLevel: '9' }, { kind: 'knockOut' }]) {
    const rejected = answer(f, pending, value);
    assert.equal(rejected.kind, 'rejected'); assert.deepEqual(rejected.events, []);
  }
  const changed = structuredClone(pending.state); changed.entities[TARGET].resources['spellSlot:1'] = 0;
  const rejected = answer(f, { ...pending, state: changed }, { kind: 'decline' });
  assert.equal(rejected.kind, 'rejected'); assert.equal(rejected.rejection.code, 'causalFrontierConflict');
  unpublished(f, pending);
});


test('successive Shield windows keep one frozen candidate and distinct opaque pending IDs', () => {
  const f = fixture('multiple-shield', { shield: 'both' });
  const value = attackBundle();
  value.proposals[0].source.content.target.count = '2';
  value.proposals[4].operation.targetRefs = ['character:probe-third', TARGET];
  const waiting = begin(f, value);
  const first = dice(f, waiting);
  assert.equal(first.kind, 'awaitingInput', JSON.stringify(first));
  const next = answer(f, first, { kind: 'decline' });
  assert.equal(next.kind, 'awaitingInput', JSON.stringify({kind:next.kind,rejection:next.rejection,pending:next.pending}));
  assert.notEqual(next.pending.pendingInputId, first.pending.pendingInputId);
  unpublished(f, next);
  assert.equal(answer(f, { ...first, state: next.state }, { kind: 'decline' }).kind, 'rejected');
  const done = answer(f, next, { kind: 'useReaction', abilityRef: 'spell:shield', slotLevel: '1' }, 'answer:two');
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.equal(done.state.entities['character:probe-third'].hitPoints.current, 18);
  assert.equal(done.state.entities[TARGET].hitPoints.current, 20);
  assert.equal(done.events.filter(event => event.eventType === 'ItemUsed').length, 1);
  assert.equal(Object.values(done.state.campaignRuntime.itemSystem.entries)[0].quantity, 1);
  replay(f, [...waiting.events, ...first.events, ...next.events, ...done.events], done.state);
});

test('a choice-dependent invalid suffix publishes no authored item or damage prefix', () => {
  const f = fixture('invalid-resumed-suffix', { knockout: true });
  // The actor is the melee target. Missing the attack leaves the later use
  // legal in preflight; taking damage to zero forbids that later action.
  const value = attackBundle({ melee: true });
  value.proposals[0].source.content.damage[0].formula = '20d4';
  value.proposals[4].operation.targetRefs = [ACTOR];
  value.proposals.push({ ...structuredClone(value.proposals[3]), operation: { kind: 'release', entryRef: 'prospective:item-entry', quantity: 1, sceneRef: 'scene:probe-gallery', releaseKind: 'placement' } });
  const waiting = begin(f, value);
  const pending = dice(f, waiting, 15, 1);
  assert.equal(pending.kind, 'awaitingInput', JSON.stringify(pending));
  unpublished(f, pending);
  const rejected = answer(f, pending, { kind: 'dealLethalDamage' });
  assert.equal(rejected.kind, 'rejected', JSON.stringify(rejected));
  assert.deepEqual(rejected.events, []);
  unpublished(f, pending);
  replay(f, [...waiting.events, ...pending.events], pending.state);
});


function attackHazard({ ordered = false } = {}) {
  const value=hazardBundle();
  Object.assign(value.proposals[0].source.content,{save:null,attack:{kind:'fixed',bonus:'2'},
    damage:[{type:'force',formula:'1d4',sharedAcrossTargets:false}],
    effects:ordered?[{kind:'grantEffect',condition:'incapacitated',duration:{kind:'untilEnded'}}]:[]});
  if(ordered)value.proposals[2].branches.success.effects.push(structuredClone(value.proposals[2].branches.success.effects[0]));
  return value;
}
for(const standalone of [false,true]) for(const reaction of ['decline','useReaction']) test(`ordered hazard ${standalone?'single interaction':'authored Bundle'} resumes native Shield ${reaction}`,()=>{
  const f=fixture(`hazard-shield-${standalone}-${reaction}`,{shield:true});
  const lowered=lowerVNext2ProposalBundle({value:attackHazard(),rootActionId:f.rootActionId,actorCharacterId:ACTOR,requiredContext:f.requiredContext,state:f.state});
  assert.equal(lowered.kind,'accepted',JSON.stringify(lowered));
  let input=lowered.command.rulesInput,pre=[];
  if(standalone){
    // Materializing only the authoring prefix is not the act, so it carries no duration.
    const materialized=f.runtime.step(f.profiles,f.state,(({executionCosts:_costs,...rest})=>({...rest,steps:input.steps.slice(0,2)}))(input));
    assert.equal(materialized.kind,'committed',JSON.stringify(materialized.rejection));
    pre=materialized.events;f.state=materialized.state;f.rootActionId+=':single';
    const hazard=Object.values(f.state.campaignRuntime.definitions).find(definition=>definition.definitionKind==='environmentHazard');
    const value=attackHazard();value.proposals=[value.proposals[2]];
    value.proposals[0].consumes=[];
    value.proposals[0].branches.success.effects[0].damage.hazardDefinitionRef=hazard.definitionId;
    f.requiredContext=freezeAuthoredProbeContext(f,f.state,{rootActionId:f.rootActionId,focusRefs:[TARGET,'definition:probe-valve','definition:probe-steam-zone',hazard.definitionId]}).context;
    const single=lowerVNext2ProposalBundle({value,rootActionId:f.rootActionId,actorCharacterId:ACTOR,requiredContext:f.requiredContext,state:f.state});
    assert.equal(single.kind,'accepted',JSON.stringify(single));
    // A lone in-world act now lowers as a one-step atomic Bundle so it can spend its duration.
    input=single.command.rulesInput;
    assert.equal(input.kind,'applyAtomicWorldInteractionSteps');assert.equal(input.steps.length,1);
  }
  const waiting=f.runtime.step(f.profiles,f.state,input);
  assert.equal(waiting.kind,'awaitingRandomness',JSON.stringify(waiting.rejection));
  const pending=dice(f,waiting,10,2);
  assert.equal(pending.kind,'awaitingInput',JSON.stringify(pending.rejection));
  assert.equal(pending.pending.controllerEntityId,TARGET);
  assert.equal(Object.values(pending.state.atomicWorldInteractions)[0].worldCursor.effectIndex,0);
  unpublished(f,pending);
  const done=answer(f,pending,reaction==='decline'?{kind:'decline'}:{kind:'useReaction',abilityRef:'spell:shield',slotLevel:'1'});
  assert.equal(done.kind,'committed',JSON.stringify(done.rejection));
  assert.equal(done.state.entities[TARGET].hitPoints.current,reaction==='decline'?18:20);
  assert.equal(done.state.entities[TARGET].resources['spellSlot:1'],reaction==='decline'?2:1);
  // A lone in-world act settles as a one-step atomic Bundle now; its single WorldInteractionResolved still owns the mechanical result.
  if(standalone){assert.equal(done.mechanicalResult.kind,'worldInteraction');assert.equal(done.events.filter(event=>event.eventType==='AtomicWorldInteractionStepsResolved').length,1);}
  replay(f,[...pre,...waiting.events,...pending.events,...done.events],done.state);
});

test('hazard reaction cursor applies the first effect before checking the next target window',()=>{
  const f=fixture('hazard-ordered-effects',{shield:true});
  const waiting=begin(f,attackHazard({ordered:true})),pending=dice(f,waiting,10,2);
  assert.equal(pending.kind,'awaitingInput',JSON.stringify(pending.rejection));
  unpublished(f,pending);
  const done=answer(f,pending,{kind:'decline'});
  assert.equal(done.kind,'committed',JSON.stringify(done.rejection));
  assert.equal(done.state.entities[TARGET].hitPoints.current,16);
  assert.equal(done.events.filter(event=>event.eventType==='ReactionOpportunityOpened').length,1,'the prior incapacitating effect prevents the second reaction');
  assert.equal(done.events.filter(event=>event.eventType==='DamagePacketResolved').length,2);
  replay(f,[...waiting.events,...pending.events,...done.events],done.state);
});

test('pending NPC query projects candidate self state with finite knowledge and keeps player projection on authority',()=>{
  const f=fixture('npc-hazard-candidate',{shield:true,npc:true});
  const value=attackHazard();
  value.proposals[2].branches.success.effects.push(structuredClone(value.proposals[2].branches.success.effects[0]));
  const waiting=begin(f,value),first=dice(f,waiting,10,2);
  assert.equal(first.kind,'awaitingInput',JSON.stringify(first.rejection));
  assert.equal(first.pending.kind,'kpDecision');
  const second=answer(f,first,{kind:'decline'});
  assert.equal(second.kind,'awaitingInput',JSON.stringify(second.rejection));
  const viewer={kind:'npc',npcId:TARGET,purpose:'kpDecision',capability:'internal:npc-limited-knowledge'};
  const query={pendingNpcDecisionFor:{pendingInputId:second.pending.pendingInputId}};
  const ordinary=f.runtime.project(f.profiles,second.state,viewer);
  assert.equal(ordinary.kind,'projected');assert.equal(ordinary.controlledCharacter.hitPoints.current,20);
  const projected=f.runtime.project(f.profiles,second.state,viewer,query);
  assert.equal(projected.kind,'projected',JSON.stringify(projected.rejection));
  assert.equal(projected.controlledCharacter.hitPoints.current,18);
  assert.equal(projected.pendingInputs.find(pending=>pending.pendingInputId===second.pending.pendingInputId)?.choiceKind,'reaction');
  assert.equal(/candidateState|nativePendingInputId|frozenDamageFaces|ownerFrame|lethalDamagePayload/.test(JSON.stringify(projected)),false);
  assert.equal(f.runtime.project(f.profiles,second.state,f.viewer,query).kind,'rejected');
  assert.equal(f.runtime.project(f.profiles,second.state,{...viewer,npcId:ACTOR},query).kind,'rejected');
  assert.equal(f.runtime.project(f.profiles,second.state,viewer,{pendingNpcDecisionFor:{pendingInputId:first.pending.pendingInputId}}).kind,'rejected');
  const changed=structuredClone(second.state);changed.entities[ACTOR].hitPoints.current--;
  assert.equal(f.runtime.project(f.profiles,changed,viewer,query).kind,'rejected');
  unpublished(f,second);
  const done=answer(f,second,{kind:'useReaction',abilityRef:'spell:shield',slotLevel:'1'});
  assert.equal(done.kind,'committed',JSON.stringify(done.rejection));
  assert.equal(done.state.entities[TARGET].hitPoints.current,18);
  replay(f,[...waiting.events,...first.events,...second.events,...done.events],done.state);
});

function equippedReactionBundle() {
  const value=itemBundle();
  Object.assign(value.proposals[0].source.content,{
    label:'Violet Reflection',activation:{kind:'reactionSpell',spellLevel:'1'},healing:null,
    costs:[{kind:'spellSlot',level:'1',amount:'1'}],
    effect:{kind:'shield',armorClassBonus:'5',duration:'untilOwnNextTurnStart',magicMissileImmunity:true},
  });
  Object.assign(value.proposals[1].source.content,{
    label:'Violet Torc',category:'equipment',stackable:false,use:null,equippedAbilityRefs:['prospective:mechanics'],
    equipment:{allowedSlots:['neck'],twoHanded:false,armor:null,weapon:null},
  });
  value.proposals[2].quantity=1;
  value.proposals[3].operation.quantity=1;
  value.proposals[4].operation={kind:'equip',entryRef:'prospective:item-entry',action:'wear',slot:'neck'};
  const danger=attackHazard();
  danger.proposals[0].produces[0].handle='prospective:danger-mechanics';
  danger.proposals[1].consumes[0].handle='prospective:danger-mechanics';
  danger.proposals[1].source.content.mechanicsRef='prospective:danger-mechanics';
  value.proposals.push(...danger.proposals);
  return value;
}
for(const reaction of ['decline','useReaction'])test(`player can ${reaction} with a newly authored equipped reaction through one private Bundle`,()=>{
  const f=fixture(`new-held-reaction-${reaction}`,{shield:'slots'});
  const otherViewer=f.viewer;
  f.actorCharacterId=TARGET;
  f.viewer={kind:'player',principalId:'principal:probe-target',seatId:'seat:probe-target',sessionVersion:1,characterId:TARGET};
  f.requiredContext=freezeAuthoredProbeContext(f,f.state,{rootActionId:f.rootActionId,focusRefs:[TARGET,'definition:probe-valve','definition:probe-steam-zone']}).context;
  const lowered=lowerVNext2ProposalBundle({value:equippedReactionBundle(),rootActionId:f.rootActionId,actorCharacterId:TARGET,requiredContext:f.requiredContext,state:f.state});
  assert.equal(lowered.kind,'accepted',JSON.stringify(lowered));
  const waiting=f.runtime.step(f.profiles,f.state,lowered.command.rulesInput);
  assert.equal(waiting.kind,'awaitingRandomness',JSON.stringify(waiting.rejection));
  const pending=dice(f,waiting,10,2);
  assert.equal(pending.kind,'awaitingInput',JSON.stringify(pending.rejection));
  assert.equal(pending.pending.controllerEntityId,TARGET);
  const use=pending.pending.answerOptions.find(option=>option.answer.kind==='useReaction');
  assert.ok(use,'the candidate-equipped typed Shield Ability supplies a legal native answer');
  assert.match(use.label,/Violet Reflection/);
  const abilityRef=use.answer.abilityRef;
  assert.equal(f.state.combatRuntime.definitions[abilityRef],undefined);
  const projected=f.runtime.project(f.profiles,pending.state,f.viewer);
  const choice=projected.pendingInputs.find(value=>value.pendingInputId===pending.pending.pendingInputId);
  assert.deepEqual(choice.answerOptions,pending.pending.answerOptions);
  assert.equal(projected.controlledCharacter.combat.definitions[abilityRef],undefined);
  assert.equal(projected.abilityDefinitions[abilityRef],undefined);
  assert.equal(JSON.stringify(projected).includes('Violet Torc'),false);
  const others=f.runtime.project(f.profiles,pending.state,otherViewer);
  assert.equal(others.pendingInputs.some(value=>value.pendingInputId===pending.pending.pendingInputId),false);
  assert.equal(JSON.stringify(others).includes(abilityRef),false);
  assert.equal(f.runtime.project(f.profiles,pending.state,{...f.viewer,principalId:'principal:probe-actor'}).kind,'rejected');
  for(const invalid of [{...use.answer,slotLevel:'9'},{...use.answer,abilityRef:'spell:shield'},{...use.answer,extra:'guess'}]) {
    const rejected=answer(f,pending,invalid);assert.equal(rejected.kind,'rejected');assert.deepEqual(rejected.events,[]);
  }
  unpublished(f,pending);
  const done=answer(f,pending,reaction==='decline'?{kind:'decline'}:use.answer);
  assert.equal(done.kind,'committed',JSON.stringify(done.rejection));
  const entry=Object.values(done.state.campaignRuntime.itemSystem.entries)[0];
  assert.equal(entry.holderRef,TARGET);assert.equal(entry.equippedSlot,'neck');
  assert.equal(done.state.entities[TARGET].hitPoints.current,reaction==='decline'?18:20);
  assert.equal(done.state.entities[TARGET].resources['spellSlot:1'],reaction==='decline'?2:1);
  replay(f,[...waiting.events,...pending.events,...done.events],done.state);
});


test('a single atomic inventory use releases its saved randomness after healing and exact-entry consumption', () => {
  const f = fixture('single-inventory-randomness'), creation = itemBundle(); creation.proposals.pop();
  const setup = lowerVNext2ProposalBundle({ value: creation, rootActionId: f.rootActionId,
    actorCharacterId: ACTOR, requiredContext: f.requiredContext, state: f.state });
  assert.equal(setup.kind, 'accepted', JSON.stringify(setup));
  const created = f.runtime.step(f.profiles, f.state, setup.command.rulesInput);
  assert.equal(created.kind, 'committed', JSON.stringify(created));
  f.state = created.state; f.rootActionId += ':use';
  const entry = Object.values(f.state.campaignRuntime.itemSystem.entries)
    .find(entry => entry.holderRef === ACTOR && entry.quantity === 2);
  assert.ok(entry);
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId,
    focusRefs: [ACTOR, entry.entryId] }).context;
  const use = itemBundle(), proposal = use.proposals.at(-1);
  use.basisRefs = [entry.entryId]; proposal.basisRefs = [entry.entryId];
  proposal.consumes = []; proposal.operation.entryRef = entry.entryId; use.proposals = [proposal];
  const lowered = lowerVNext2ProposalBundle({ value: use, rootActionId: f.rootActionId,
    actorCharacterId: ACTOR, requiredContext: f.requiredContext, state: f.state });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  const waiting = f.runtime.step(f.profiles, f.state, atomicInput(f, lowered, use));
  assert.equal(waiting.kind, 'awaitingRandomness', JSON.stringify(waiting));
  const done = dice(f, waiting);
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.deepEqual(done.state.internalContinuations, {});
  assert.deepEqual(done.state.combatRuntime.randomnessResolutions, {});
  assert.equal(done.state.campaignRuntime.itemSystem.entries[entry.entryId].quantity, 1);
  assert.equal(done.state.entities[ACTOR].hitPoints.current, 16);
  assert.equal(done.events.filter(event => event.eventType === 'ItemUsed').length, 1);
  assert.equal(done.events.filter(event => event.eventType === 'AtomicWorldInteractionStepsResolved').length, 1);
  replay(f, [...created.events, ...waiting.events, ...done.events], done.state);
  assert.equal(f.runtime.step(f.profiles, done.state, { kind: 'fulfillAuthoritativeRandomness',
    continuation: waiting.continuation, rolls: [2, 2] }).kind, 'rejected');
});

test('inside an Encounter an act declares no tier and spends no fictional time', () => {
  // Rounds carry the time in combat: the scene clock moves six seconds per round,
  // and timed effects are anchored to that. A frozen tier would jump the clock
  // mid-round, so the KP says "none" there and Rules refuses any fictionTime cost.
  const f = fixture('encounter-duration');
  const state = structuredClone(f.state);
  for (const id of [ACTOR, TARGET]) state.combatRuntime.entities[id].turn = {
    action: '1', bonusAction: '1', reaction: '1', attacksRemaining: '1', leveledBonusActionSpell: false };
  state.combatRuntime.encounters['encounter:duration'] = { encounterId: 'encounter:duration', sceneId: PROBE_SCENE, status: 'active',
    participantEntityIds: [ACTOR, TARGET], initiativeGroups: [ACTOR, TARGET].map(id => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [], battlefieldFactIds: [], surprisedEntityIds: [], initiative: { ordered: true,
      entries: [ACTOR, TARGET].map((id, index) => ({ entryId: `initiative:${id}`, combatantEntityIds: [id], total: 20 - index })) },
    round: 1, turnCursor: 0, activeEntityId: ACTOR, turnOrderEntityIds: [ACTOR, TARGET], roundClosed: false };
  const rootActionId = `${f.rootActionId}:encounter`;
  const context = freezeAuthoredProbeContext(f, state, { rootActionId, focusRefs: [TARGET, 'definition:probe-valve'] }).context;
  const draft = duration => {
    const value = sharedCheckBundle('worldInteraction');
    value.adjudication = { kind: 'directSuccess', durationMicros: duration, risk: '战斗中转动阀门。', successOutcome: '阀门转动。' };
    value.proposals = [value.proposals[1]];
    value.proposals[0].branches.failure = { kind: 'none' };
    const parsed = parseBundle(value);
    assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
    return lowerVNext2ProposalBundle({ value: parsed.bundle, rootActionId, actorCharacterId: ACTOR, requiredContext: context, state });
  };
  const tiered = draft('300000000');
  assert.equal(tiered.kind, 'rejected');
  assert.deepEqual(tiered.issues, ['bundle2:duration-forbidden-in-encounter']);
  const none = draft('0');
  assert.equal(none.kind, 'accepted', JSON.stringify(none));
  assert.equal(none.command.rulesInput.kind, 'applyAtomicWorldInteractionSteps');
  assert.equal(none.command.rulesInput.executionCosts, undefined);
  // Rules holds the same line on its own, whatever produced the plan.
  const spent = { ...none.command.rulesInput, executionCosts: { costs: [{ kind: 'fictionTime', durationMicros: '300000000' }],
    readSet: [{ ref: ACTOR, revisionOrHash: authorityRevisionOrHash(state, ACTOR) },
      { ref: `character-timeline:${ACTOR}`, revisionOrHash: authorityRevisionOrHash(state, `character-timeline:${ACTOR}`) }].sort(byRef) } };
  const refused = f.runtime.step(f.profiles, state, spent);
  assert.equal(refused.kind, 'rejected', JSON.stringify(refused));
  assert.match(refused.rejection.message, /spends turns, not a frozen duration/);
  assert.deepEqual(refused.events, []);
  const timelineId = state.multiplayerRuntime.characterTimelineIds[ACTOR] ?? state.activeBranchId;
  const before = state.fictionTimelines[timelineId].nowMicros;
  const done = f.runtime.step(f.profiles, state, none.command.rulesInput);
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.equal(done.events.filter(event => event.eventType === 'FictionTimeAdvanced').length, 0);
  assert.equal(done.state.fictionTimelines[timelineId].nowMicros, before);
});
