import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSha256 } from '../app/_runtime/lib/rules/profiles/canonical.ts';
import { compileAbilityDefinition, registeredAbilityRecord } from '../app/_runtime/lib/rules/profiles/ability-compiler.ts';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_TARGET as TARGET, PROBE_SCENE as SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { parseSubmitKpProposalBundleCandidateArguments, assertVNextProposalCandidateCapabilities,
  invokeSubmitKpProposalBundleWithOneCorrection } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { createVNextProposalBundleSchema, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE as bridge, vnext2CommandToRoomLowering } from '../app/_runtime/lib/kp/vnext/room-bridge.ts';
import { deepSeekStrictToolSchemaIssues } from '../app/_runtime/lib/kp/deepseek-strict-tool.ts';
import { frozenRenderableClaimsConform } from '../app/_runtime/lib/rules/v2/claims.ts';

// Registered definitions exercise the generic protocol, not production spell
// catalog completeness. Production registered-spell tests cover that boundary.
function fixture(name, source = {}, configure = () => {}) {
  const f = createAuthoredProbeFixture(`native-ability:${name}`), abilityRef = `ability:registered:${name}`;
  const compiled = compileAbilityDefinition(JSON.parse(JSON.stringify({ definitionId: abilityRef, revision: '1', rulesBasis: 'srd5.1-2014',
    activation: { kind: 'actionSpell', spellLevel: '1' },
    target: { kind: 'creature', count: '1', rangeInches: '600', requiresSight: true },
    costs: [{ kind: 'spellSlot', level: '1', amount: '1' }], healing: { formula: '1d4+1' }, ...source })));
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  const state = structuredClone(f.state), caster = state.combatRuntime.entities[ACTOR];
  state.combatRuntime.definitions[abilityRef] = registeredAbilityRecord(compiled.artifact);
  caster.abilityRefs = [abilityRef]; caster.resources = { 'spellSlot:1': { current: '2', maximum: '2' } };
  state.entities[ACTOR].resources = { ...state.entities[ACTOR].resources, slot1: 2 };
  state.entities[ACTOR].resourceMaximums = { ...state.entities[ACTOR].resourceMaximums, slot1: 2 };
  caster.spellcasting = { ability: 'wis', spellAttackBonus: '4', spellSaveDc: '12' }; delete caster.turn;
  configure(state);
  const body = { ...state }; delete body.eventHeadHash; delete body.lastEventId;
  const initialStateHash = canonicalSha256(body); state.eventHeadHash = initialStateHash;
  const genesis = { ...structuredClone(f.genesis), initialState: state, initialStateHash }; delete genesis.genesisHash;
  genesis.genesisHash = canonicalSha256(genesis);
  const replayed = f.runtime.replay(genesis, []); assert.equal(replayed.kind, 'replayed', JSON.stringify(replayed));
  const result = { ...f, genesis, state: replayed.state, abilityRef, events: [] };
  freeze(result); return result;
}
function freeze(f, root = f.rootActionId) {
  f.rootActionId = root;
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: root,
    focusRefs: [ACTOR, TARGET], intentText: '按本人已掌握的能力对明确目标施法。' }).context;
}
function wire(f, kind = 'invoke', extra = {}) {
  return { decision: { kind: 'abilityOperation', operation: kind === 'invoke'
    ? { kind, abilityRef: f.abilityRef, castingMode: 'normal', target: { kind: 'creatures', refs: [ACTOR] }, ...extra }
    : { kind, ...extra } } };
}
function lower(f, value = wire(f)) {
  const candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(value));
  assert.equal(candidate.kind, 'accepted', JSON.stringify(candidate));
  assert.doesNotThrow(() => assertVNextProposalCandidateCapabilities(candidate, ['abilityOperation']));
  return lowerVNext2ProposalBundle({ value: candidate.bundle, rootActionId: f.rootActionId, actorCharacterId: ACTOR,
    profiles: f.profiles, requiredContext: f.requiredContext, state: f.state });
}
function apply(f, input) {
  const result = f.runtime.step(f.profiles, f.state, input);
  if (result.events?.length) {
    f.events.push(...result.events);
    const replayed = f.runtime.replay(f.genesis, f.events);
    assert.equal(replayed.kind, 'replayed', JSON.stringify(replayed));
    assert.deepEqual(replayed.state, result.state); f.state = replayed.state;
  }
  return result;
}
function perform(f, value = wire(f)) {
  const lowered = lower(f, value); assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  const room = vnext2CommandToRoomLowering(lowered.command); assert.equal(room.kind, 'accepted');
  assert.equal(bridge.validateReadSet({ profiles: f.profiles, state: f.state, requiredContext: f.requiredContext,
    rulesInput: room.input }).kind, 'valid');
  return apply(f, room.input);
}
function fulfill(f, waiting) {
  assert.equal(waiting.kind, 'awaitingRandomness', JSON.stringify(waiting));
  const rolls = waiting.randomnessRequest.hazardRolls.flatMap(spec => spec.dice.flatMap(die => Array(Number(die.count)).fill(2)));
  return apply(f, { kind: 'fulfillAuthoritativeRandomness', continuation: waiting.continuation, rolls });
}
function configureCombat(state, encounterId) {
  for (const actor of [ACTOR, TARGET]) state.combatRuntime.entities[actor].turn = {
    action: '1', bonusAction: '1', reaction: '1', attacksRemaining: '1', leveledBonusActionSpell: false };
  state.combatRuntime.encounters[encounterId] = { encounterId, sceneId: SCENE, status: 'active',
    participantEntityIds: [ACTOR, TARGET], initiativeGroups: [ACTOR, TARGET].map(id => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [], battlefieldFactIds: [], surprisedEntityIds: [], initiative: { ordered: true,
      entries: [ACTOR, TARGET].map((id, index) => ({ entryId: `initiative:${id}`, combatantEntityIds: [id], total: 20 - index })) },
    round: 1, turnCursor: 0, activeEntityId: ACTOR, turnOrderEntityIds: [ACTOR, TARGET], roundClosed: false };
}

test('selected native schema and runtime admission share the same selected capability', () => {
  const f = fixture('selection'), candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wire(f)));
  assert.equal(candidate.kind, 'accepted');
  assert.deepEqual(deepSeekStrictToolSchemaIssues(createVNextProposalBundleSchema(['abilityOperation'])), []);
  for (const capabilities of [[], ['observe'], ['authorAbility']]) {
    assert.throws(() => assertVNextProposalCandidateCapabilities(candidate, capabilities), error =>
      error.diagnostics?.some(detail => detail.constraint === 'proposal:capability-not-loaded'));
  }
  assert.doesNotThrow(() => assertVNextProposalCandidateCapabilities(candidate, ['abilityOperation']));
  const context = JSON.stringify(f.requiredContext);
  assert.ok(context.includes(`ability-catalog:${ACTOR}`));
  assert.ok(context.includes(f.abilityRef));
  assert.ok(!context.includes('mechanicGraph'));
  const catalog = f.requiredContext.entries.find(entry => entry.entryRef === `ability-catalog:${ACTOR}`);
  assert.equal(catalog.kind, 'known');
});

test('registered immediate healing uses native dice and resource mechanics through filling, lowering, and replay', () => {
  const f = fixture('immediate');
  const waiting = perform(f), done = fulfill(f, waiting);
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.equal(f.state.combatRuntime.entities[ACTOR].hitPoints.current, '13');
  assert.equal(f.state.entities[ACTOR].resources.slot1, 1);
  assert.equal(Object.hasOwn(f.state.entities[ACTOR].resources, 'spellSlot:1'), false);
  assert.equal(f.state.combatRuntime.entities[ACTOR].resources['spellSlot:1'].current, '1');
  assert.equal(f.events.filter(event => event.eventType === 'ResourceSpent').length, 1);
  assert.equal(f.events.filter(event => event.eventType === 'HealingResolved').length, 1);
});

function precisionProjection(f, priorState, done, viewer = f.viewer) {
  const projected = f.runtime.project(f.profiles, f.state, viewer, { channel: 'realtime', committedRange: {
    receiptId: done.receipt.receiptId, actorCharacterId: ACTOR, priorState, events: f.events,
  } });
  assert.equal(projected.kind, 'projected', JSON.stringify(projected));
  assert.equal(frozenRenderableClaimsConform(projected.renderableClaims), true);
  return projected.renderableClaims;
}

for (const [name, hp, expectedHp] of [['full', 24, 24], ['injured', 10, 13], ['capped', 23, 24]]) {
  test(`narration precision preserves the named spell cost and actual ${name} healing through public Rules`, () => {
    const f = fixture(`precision-${name}`, { sourceSpellId: 'cure' }, state => {
      state.entities[ACTOR].hitPoints = { current: hp, maximum: 24, temporary: 0 };
      state.combatRuntime.entities[ACTOR].hitPoints = { current: String(hp), maximum: '24', temporary: '0' };
      state.entities[ACTOR].resources.slot1 = 4;
      state.entities[ACTOR].resourceMaximums.slot1 = 4;
      state.combatRuntime.entities[ACTOR].resources['spellSlot:1'] = { current: '4', maximum: '4' };
      state.entities[ACTOR].resources.slot2 = 2;
      state.entities[ACTOR].resourceMaximums.slot2 = 2;
      state.combatRuntime.entities[ACTOR].resources['spellSlot:2'] = { current: '2', maximum: '2' };
      // Full HP does not remove an independently established condition.
      state.combatRuntime.entities[ACTOR].conditions.poisoned = true;
    });
    const prior = structuredClone(f.state), done = fulfill(f, perform(f));
    assert.equal(done.kind, 'committed');
    const claims = precisionProjection(f, prior, done);
    const cost = claims.claims.find(claim => claim.outcomeCode === 'resourceChanged');
    assert.match(cost.summary, /1 环法术位.*消耗.*1.*剩余.*3/u);
    assert.doesNotMatch(cost.summary, /2 环|该资源/u);
    const healed = claims.claims.find(claim => claim.outcomeCode === 'healed');
    assert.match(healed.summary, new RegExp(`实际恢复了 ${expectedHp - hp} 点生命值`, 'u'));
    const capacity = claims.claims.find(claim => claim.outcomeCode === 'healingCapacity');
    assert.ok(capacity);
    assert.match(capacity.summary, new RegExp(`${expectedHp}/24`, 'u'));
    if (hp === 24) assert.match(capacity.summary, /治疗前.*已达.*上限/u);
    else assert.doesNotMatch(capacity.summary, /治疗前.*已达.*上限/u);
    assert.equal(claims.claims.find(claim => claim.kind === 'abilityEffectApplied').abilityName, '治愈伤口');
    assert.equal(f.state.combatRuntime.entities[ACTOR].conditions.poisoned, true);
    assert.equal(f.state.entities[ACTOR].resources.slot2, 2);
    assert.deepEqual(precisionProjection(f, prior, done), claims);
    const other = precisionProjection(f, prior, done, { kind: 'player', principalId: 'principal:probe-target',
      seatId: 'seat:probe-target', sessionVersion: 1, characterId: TARGET });
    assert.equal(other.claims.some(claim => claim.outcomeCode === 'healingCapacity'), false);
    assert.equal(other.claims.some(claim => claim.abilityName === '治愈伤口'), false,
      'The caster\'s private ability catalog is not another Viewer\'s name source.');
  });
}

test('narration precision names a class resource through the same committed cost path', () => {
  const f = fixture('precision-class', { activation: { kind: 'action' },
    costs: [{ kind: 'classResource', resourceId: 'resource:channel-divinity', amount: '1' }] }, state => {
    state.entities[ACTOR].resources.channel = 2;
    state.entities[ACTOR].resourceMaximums.channel = 2;
    state.combatRuntime.entities[ACTOR].resources['resource:channel-divinity'] = { current: '2', maximum: '2' };
  });
  const prior = structuredClone(f.state), done = fulfill(f, perform(f));
  const cost = precisionProjection(f, prior, done).claims.find(claim => claim.outcomeCode === 'resourceChanged');
  assert.match(cost.summary, /引导神力.*消耗.*1.*剩余.*1/u);
  assert.doesNotMatch(cost.summary, /法术位|该资源/u);
});

test('long and ritual starts use the same native decision and exact Activity cancellation', () => {
  for (const castingMode of ['normal', 'ritual']) {
    const f = fixture(`long-${castingMode}`, { activation: { kind: 'actionSpell', spellLevel: '1', castingTimeMicros: '12000000', ritual: true } });
    const started = perform(f, wire(f, 'invoke', { castingMode }));
    assert.equal(started.kind, 'committed', JSON.stringify(started));
    const activity = Object.values(f.state.campaignRuntime.activities).find(value => value.activityKind === 'longSpellcasting');
    assert.ok(activity);
    assert.equal(activity.intendedDurationMicros, castingMode === 'ritual' ? '612000000' : '12000000');
    assert.equal(f.state.combatRuntime.entities[ACTOR].resources['spellSlot:1'].current, '2');
    freeze(f, `${f.rootActionId}:cancel`);
    assert.ok(f.requiredContext.entries.some(entry => entry.entryRef === `continuity:activities:${activity.activityId}`));
    const cancelled = perform(f, wire(f, 'cancel', { activityRef: activity.activityId }));
    assert.equal(cancelled.kind, 'committed', JSON.stringify(cancelled));
    assert.equal(f.state.campaignRuntime.activities[activity.activityId].status, 'interrupted', JSON.stringify({ events: cancelled.events.map(e => ({type:e.eventType,payload:e.payload})), operation: wire(f, 'cancel', { activityRef: activity.activityId }) }));
    assert.equal(f.state.combatRuntime.entities[ACTOR].concentration, null);
    assert.equal(f.events.some(event => event.eventType === 'ResourceSpent'), false);
  }
});

test('missing parameters and forbidden mechanics do not receive a semantic repair', async () => {
  const f = fixture('missing');
  for (const mutate of [value => delete value.decision.operation.target,
    value => delete value.decision.operation.castingMode,
    value => { value.decision.operation.dc = '10'; },
    value => { value.decision.operation.costs = []; }]) {
    const value = wire(f); mutate(value); let calls = 0;
    const result = await invokeSubmitKpProposalBundleWithOneCorrection({ modelId: 'scripted-local', message: '冻结原意图。',
      requiredContext: f.requiredContext, capabilities: ['abilityOperation'],
      binding: { async run() { calls++; return { choices: [{ message: { tool_calls: [{ type: 'function', function: {
        name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: JSON.stringify(value) } }] } }] }; } },
      persistRepairTicket() { assert.fail('mechanical operations cannot be reconstructed by repair'); } });
    assert.equal(result.kind, 'rejected', JSON.stringify(result)); assert.equal(calls, 1);
    assert.equal(result.repairUsed, false);
    assert.ok(result.diagnostics.every(detail => detail.repair.allowed === false));
    assert.ok(result.diagnostics.some(detail => detail.path?.[0] === 'terminal' && detail.path.includes('operation')));
  }
});

test('complete native JSON shell repair confirms the frozen operation once and cannot supply a replacement target', async () => {
  for (const injectTarget of [false, true]) {
    const f = fixture(`repair-${injectTarget}`), value = wire(f), originalArguments = JSON.stringify(value).slice(0, -1);
    let calls = 0;
    const result = await invokeSubmitKpProposalBundleWithOneCorrection({ modelId: 'scripted-local', message: '冻结原意图。',
      requiredContext: f.requiredContext, capabilities: ['abilityOperation'],
      persistRepairTicket(ticket) { assert.equal(ticket.originalArguments, originalArguments); assert.deepEqual(ticket.allowedPaths, []); },
      binding: { async run() { calls++; return { choices: [{ message: { tool_calls: [{ type: 'function', function: {
        name: calls === 1 ? SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME : CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
        arguments: calls === 1 ? originalArguments : JSON.stringify({ confirm: 'server-plan', summaries: injectTarget
          ? [{ path: ['terminal', 'operation', 'target'], value: TARGET }] : [] }) } }] } }] }; } } });
    assert.equal(calls, 2, JSON.stringify(result));
    assert.equal(result.kind, injectTarget ? 'rejected' : 'locallyAccepted', JSON.stringify(result));
    if (result.kind === 'locallyAccepted') assert.deepEqual(result.bundle.terminal.operation, value.decision.operation);
    assert.equal(f.state.combatRuntime.entities[ACTOR].resources['spellSlot:1'].current, '2');
  }
});

test('creature-or-feature definitions reuse native creature selection without inferring missing targets', () => {
  const f = fixture('mixed-target', { target: { kind: 'creatureOrEnvironmentFeature', count: '1', rangeInches: '600' },
    healing: undefined, damage: [{ type: 'force', formula: '1d4' }] });
  // Compile sources must omit absent members rather than retain JS undefined.
  const invalid = perform(f, wire(f, 'invoke', { target: { kind: 'none' } }));
  assert.equal(invalid.kind, 'rejected'); assert.deepEqual(invalid.events, []);
  const done = fulfill(f, perform(f, wire(f, 'invoke', { target: { kind: 'creatures', refs: [TARGET] } })));
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.equal(f.state.combatRuntime.entities[TARGET].hitPoints.current, '18');
});

test('empty registered immediate and long spells refuse before costs, dice, or an empty Activity', () => {
  for (const castingTimeMicros of [undefined, '12000000']) {
    const f = fixture(`empty-${castingTimeMicros ?? 'short'}`, { healing: undefined,
      activation: { kind: 'actionSpell', spellLevel: '1', ...(castingTimeMicros ? { castingTimeMicros } : {}) } });
    const before = structuredClone(f.state), refused = perform(f);
    assert.equal(refused.kind, 'rejected', JSON.stringify(refused));
    assert.equal(refused.rejection.code, 'unsupportedOperation'); assert.deepEqual(refused.events, []);
    assert.deepEqual(f.state, before);
  }
});

test('registered free healing reaches the same native recovery and unsupported free effects cannot commit an empty result', () => {
  const f = fixture('free-healing', { activation: { kind: 'free' } });
  const done = fulfill(f, perform(f)); assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.equal(f.state.combatRuntime.entities[ACTOR].hitPoints.current, '13');
  assert.equal(f.events.filter(event => event.eventType === 'HealingResolved').length, 1);
  assert.equal(f.state.combatRuntime.entities[ACTOR].resources['spellSlot:1'].current, '1');
  for (const effects of [undefined, [{ kind: 'modifier', tag: 'registered-free-effect' }]]) {
    const bad = fixture(`free-unsupported-${effects === undefined ? 'empty' : 'tag'}`, {
      activation: { kind: 'free' }, healing: undefined, effects });
    const before = structuredClone(bad.state), rejected = perform(bad);
    assert.equal(rejected.kind, 'rejected', JSON.stringify(rejected));
    assert.equal(rejected.rejection.code, 'unsupportedOperation'); assert.deepEqual(rejected.events, []);
    assert.deepEqual(bad.state, before);
  }
});

test('ordinary native execution rejects grants that its effect resolver cannot apply', () => {
  for (const activation of [{ kind: 'free' }, { kind: 'actionSpell', spellLevel: '1' },
    { kind: 'actionSpell', spellLevel: '1', castingTimeMicros: '12000000' }]) {
    const f = fixture(`mixed-grants-${activation.kind}-${activation.castingTimeMicros ?? 'immediate'}`, {
      activation, grants: [{ kind: 'normalAction', count: '1' }] });
    const before = structuredClone(f.state), result = perform(f);
    assert.equal(result.kind, 'rejected', JSON.stringify(result));
    assert.equal(result.rejection.code, 'unsupportedOperation');
    assert.deepEqual(result.events, []); assert.deepEqual(f.state, before);
  }
});

test('Action Surge preserves its actual one-action mechanic and cannot manufacture a noncombat turn or hide extra effects', () => {
  const source = { activation: { kind: 'free', timing: 'ownTurn' }, healing: undefined, target: undefined,
    mechanicalKey: 'action-surge', grants: [{ kind: 'normalAction', count: '1' }] };
  for (const inCombat of [false, true]) {
    const f = fixture(`action-surge-${inCombat}`, source, state => { if (inCombat) configureCombat(state, 'encounter:surge'); });
    const before = structuredClone(f.state);
    const result = perform(f, wire(f, 'invoke', { target: { kind: 'none' } }));
    assert.equal(result.kind, inCombat ? 'committed' : 'rejected', JSON.stringify(result));
    if (inCombat) {
      assert.equal(f.state.combatRuntime.entities[ACTOR].turn.action, '2');
      assert.equal(f.state.combatRuntime.entities[ACTOR].resources['spellSlot:1'].current, '1');
    } else { assert.deepEqual(result.events, []); assert.deepEqual(f.state, before); }
  }
  const extra = fixture('action-surge-extra', { ...source, effects: [{ kind: 'modifier', tag: 'unimplemented-extra' }] },
    state => configureCombat(state, 'encounter:surge-extra'));
  const refused = perform(extra, wire(extra, 'invoke', { target: { kind: 'none' } }));
  assert.equal(refused.kind, 'rejected', JSON.stringify(refused)); assert.deepEqual(refused.events, []);
});

test('native area filling freezes scene candidates and lets Rules derive targets and the shared damage', () => {
  const f = fixture('area', { healing: undefined,
    target: { kind: 'area', rangeInches: '600', shape: { kind: 'sphere', radiusInches: '180', propagation: 'straight' } },
    save: { ability: 'dex', dc: '12', halfOnSuccess: true }, damage: [{ type: 'cold', formula: '1d4' }] });
  const value = wire(f, 'invoke', { target: { kind: 'area', origin: { x: '200', y: '100', elevation: '0' } } });
  const lowered = lower(f, value); assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  assert.ok(lowered.command.rulesInput.steps[0].rulesInput.plan.readSet.some(entry => entry.ref === TARGET));
  const done = fulfill(f, perform(f, value)); assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.equal(f.state.combatRuntime.entities[TARGET].hitPoints.current, '18');
  assert.equal(f.state.combatRuntime.entities[ACTOR].hitPoints.current, '8');
});

test('explicit untargeted native operation retains its tag through the shared sentinel decoder', () => {
  const f = fixture('untargeted', { target: undefined, healing: undefined, effect: { kind: 'concentration', durationMicros: '60000000' } });
  const done = perform(f, wire(f, 'invoke', { target: { kind: 'none' } }));
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.equal(f.state.combatRuntime.entities[ACTOR].concentration.abilityRef, f.abilityRef);
  assert.equal(f.state.combatRuntime.entities[ACTOR].resources['spellSlot:1'].current, '1');
});

test('another caster Activity cannot be observed, continued, or cancelled through the owned operation', () => {
  const f = fixture('foreign', { activation: { kind: 'actionSpell', spellLevel: '1', castingTimeMicros: '12000000' } }, state => {
    state.combatRuntime.entities[TARGET].abilityRefs = [...state.combatRuntime.entities[ACTOR].abilityRefs];
    state.combatRuntime.entities[TARGET].resources = { 'spellSlot:1': { current: '2', maximum: '2' } };
    state.entities[TARGET].resources = { ...state.entities[TARGET].resources, slot1: 2 };
    state.entities[TARGET].resourceMaximums = { ...state.entities[TARGET].resourceMaximums, slot1: 2 };
    delete state.combatRuntime.entities[TARGET].turn;
  });
  const started = apply(f, { kind: 'invokeAbility', rootActionId: `${f.rootActionId}:foreign`,
    sourceEntityId: TARGET, abilityRef: f.abilityRef, parameters: { targetEntityId: TARGET } });
  assert.equal(started.kind, 'committed', JSON.stringify(started));
  const activity = Object.values(f.state.campaignRuntime.activities).find(value => value.activityKind === 'longSpellcasting');
  freeze(f);
  assert.ok(!f.requiredContext.entries.some(entry => entry.entryRef === `ability-catalog:${TARGET}`));
  assert.ok(!f.requiredContext.entries.some(entry => entry.entryRef === `continuity:activities:${activity.activityId}`));
  for (const kind of ['continue', 'cancel']) {
    const rejected = lower(f, wire(f, kind, { activityRef: activity.activityId }));
    assert.equal(rejected.kind, 'rejected', JSON.stringify(rejected));
    assert.equal(rejected.code, 'PROPOSAL_REFERENCE_INVALID');
  }
});

test('saved native randomness rejects injected retargeting and changed registered costs before effects', () => {
  const f = fixture('frozen-random'), waiting = perform(f);
  assert.equal(waiting.kind, 'awaitingRandomness');
  const rolls = waiting.randomnessRequest.hazardRolls.flatMap(spec => spec.dice.flatMap(die => Array(Number(die.count)).fill(2)));
  const forged = f.runtime.step(f.profiles, f.state, { kind: 'fulfillAuthoritativeRandomness',
    continuation: waiting.continuation, rolls, operation: { ...wire(f).decision.operation, target: { kind: 'creatures', refs: [TARGET] } } });
  assert.equal(forged.kind, 'rejected'); assert.deepEqual(forged.events, []);
  const changed = structuredClone(f.state), previous = changed.combatRuntime.definitions[f.abilityRef];
  const source = Object.fromEntries(Object.entries(previous).filter(([key]) => !['mechanicGraph', 'referenceClosure', 'compilerProfile', 'compiledHash', 'definitionHash'].includes(key)));
  const compiled = compileAbilityDefinition({ ...source, costs: [{ kind: 'spellSlot', level: '1', amount: '2' }] });
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  changed.combatRuntime.definitions[f.abilityRef] = registeredAbilityRecord(compiled.artifact);
  const refused = f.runtime.step(f.profiles, changed, { kind: 'fulfillAuthoritativeRandomness', continuation: waiting.continuation, rolls });
  assert.equal(refused.kind, 'rejected', JSON.stringify(refused)); assert.deepEqual(refused.events, []);
  const done = fulfill(f, waiting); assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.equal(f.state.combatRuntime.entities[ACTOR].resources['spellSlot:1'].current, '1');
  assert.equal(f.state.combatRuntime.entities[TARGET].hitPoints.current, '20');
});

test('combat continuation invests the next current action into the exact saved casting Activity', () => {
  const encounterId = 'encounter:native-casting';
  const f = fixture('continue', { activation: { kind: 'actionSpell', spellLevel: '1', castingTimeMicros: '18000000' } }, state => {
    configureCombat(state, encounterId);
  });
  const started = perform(f); assert.equal(started.kind, 'committed', JSON.stringify(started));
  const activity = Object.values(f.state.campaignRuntime.activities).find(value => value.activityKind === 'longSpellcasting');
  assert.equal(f.state.combatRuntime.entities[ACTOR].turn.action, '0');
  for (const sourceEntityId of [ACTOR, TARGET]) {
    const ended = apply(f, { kind: 'endTurn', rootActionId: `${f.rootActionId}:end:${sourceEntityId}`, encounterId, sourceEntityId });
    assert.equal(ended.kind, 'committed', JSON.stringify(ended));
  }
  freeze(f, `${f.rootActionId}:continue`);
  const continued = perform(f, wire(f, 'continue', { activityRef: activity.activityId }));
  assert.equal(continued.kind, 'committed', JSON.stringify(continued));
  assert.equal(f.state.combatRuntime.entities[ACTOR].turn.action, '0');
  assert.equal(f.state.combatRuntime.entities[ACTOR].concentration.investedActionRounds, 2);
  assert.equal(f.state.combatRuntime.entities[ACTOR].resources['spellSlot:1'].current, '2');
  freeze(f, `${f.rootActionId}:twice`);
  const duplicate = perform(f, wire(f, 'continue', { activityRef: activity.activityId }));
  assert.equal(duplicate.kind, 'rejected'); assert.deepEqual(duplicate.events, []);
});

test('clarification freezes the exact native operation and executes it without another KP decision', () => {
  const f = fixture('clarification'), operation = wire(f).decision.operation;
  const value = { decision: { kind: 'clarification', intent: '确认实际目标。', method: '先确认再施法。', question: '是否对自己施法？', basisRefs: [],
    choices: [{ choiceId: 'cast', label: '对自己施法', publicRisk: '消耗法术位。', basisRefs: [],
      continuation: { kind: 'abilityOperation', operation } },
    { choiceId: 'cancel', label: '取消', publicRisk: '不施法。', basisRefs: [], continuation: { kind: 'cancel' } }] } };
  const lowered = lower(f, value); assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  const room = vnext2CommandToRoomLowering(lowered.command);
  assert.equal(room.kind, 'accepted'); const opened = apply(f, room.input);
  assert.equal(opened.kind, 'awaitingInput', JSON.stringify(opened));
  const waiting = apply(f, { kind: 'answerFrozenPlayerChoice', rootActionId: f.rootActionId,
    controllerCharacterId: ACTOR, pendingInputId: lowered.command.plan.pendingInputId, choiceId: 'cast' });
  const done = fulfill(f, waiting); assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.equal(f.state.combatRuntime.entities[ACTOR].hitPoints.current, '13');
  assert.equal(f.events.filter(event => event.eventType === 'ResourceSpent').length, 1);
});


test('multiple spell and class costs preserve the same unique player pools and public maxima', () => {
  const f = fixture('resource-pools', { costs: [
    { kind: 'spellSlot', level: '1', amount: '1' },
    { kind: 'spellSlot', level: '1', amount: '1' },
    { kind: 'classResource', resourceId: 'resource:action-surge', amount: '1' },
  ] }, state => {
    state.entities[ACTOR].resources.surge = 1;
    state.entities[ACTOR].resourceMaximums.surge = 1;
    state.combatRuntime.entities[ACTOR].resources['resource:action-surge'] = { current: '1', maximum: '1' };
  });
  const done = fulfill(f, perform(f)); assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.deepEqual(f.state.entities[ACTOR].resources, { slot1: 0, surge: 0 });
  assert.deepEqual(f.state.entities[ACTOR].resourceMaximums, { slot1: 2, surge: 1 });
  assert.deepEqual(f.events.filter(e => e.eventType === 'ResourceSpent').map(e => [e.payload.resourceId, e.payload.resourceAfter]),
    [['spellSlot:1', '1'], ['spellSlot:1', '0'], ['resource:action-surge', '0']]);
  const view = f.runtime.project(f.profiles, f.state, f.viewer);
  assert.equal(view.kind, 'projected', JSON.stringify(view));
  assert.equal(view.controlledCharacter.resources.slot1, 0);
  assert.equal(view.controlledCharacter.resources.surge, 0);
  assert.equal(Object.hasOwn(view.controlledCharacter.resources, 'spellSlot:1'), false);
  assert.equal(Object.hasOwn(view.controlledCharacter.resources, 'resource:action-surge'), false);
  assert.deepEqual(view.controlledCharacter.resourceMaximums, { slot1: 2, surge: 1 });
  assert.deepEqual(view.controlledCharacter.combat.resources['spellSlot:1'], { current: '0', maximum: '2' });
});

test('missing ambiguous and inconsistent player pools reject before cost or randomness admission', () => {
  for (const [name, change] of [
    ['missing', core => { delete core.resources.slot1; }],
    ['missing-container', core => { delete core.resources; }],
    ['ambiguous', core => { core.resources['spellSlot:1'] = 2; }],
    ['before-mismatch', core => { core.resources.slot1 = 1; }],
    ['maximum-mismatch', core => { core.resourceMaximums.slot1 = 3; }],
  ]) {
    const f = fixture(`invalid-pool-${name}`, {}, state => change(state.entities[ACTOR]));
    const before = structuredClone(f.state);
    const result = f.runtime.step(f.profiles, f.state, { kind: 'invokeAbility', rootActionId: f.rootActionId,
      sourceEntityId: ACTOR, abilityRef: f.abilityRef, parameters: { targetEntityId: ACTOR } });
    assert.equal(result.kind, 'rejected', `${name}: ${JSON.stringify(result)}`);
    assert.deepEqual(result.events, []); assert.deepEqual(f.state, before);
  }
});

test('reaction spell spending uses the same core pool admission and exact update', () => {
  for (const invalid of [false, true]) {
    const counterRef = 'ability:registered:resource-counterspell';
    const f = fixture(`reaction-resource-${invalid}`, {}, state => {
      const compiled = compileAbilityDefinition({ definitionId: counterRef, revision: '1', rulesBasis: 'srd5.1-2014',
        mechanicalKey: 'counterspell', activation: { kind: 'reactionSpell', spellLevel: '3' },
        target: { kind: 'creature', count: '1', rangeInches: '720' },
        costs: [{ kind: 'spellSlot', level: '3', amount: '1' }], effect: { kind: 'counterspell', rangeInches: '720' } });
      assert.equal(compiled.ok, true, JSON.stringify(compiled));
      state.combatRuntime.definitions[counterRef] = registeredAbilityRecord(compiled.artifact);
      const target = state.combatRuntime.entities[TARGET];
      target.abilityRefs = [counterRef]; target.resources = { 'spellSlot:3': { current: '1', maximum: '1' } }; delete target.turn;
      state.entities[TARGET].resources = { slot3: 1 }; state.entities[TARGET].resourceMaximums = { slot3: 1 };
    });
    const opened = apply(f, { kind: 'invokeAbility', rootActionId: f.rootActionId,
      sourceEntityId: ACTOR, abilityRef: f.abilityRef, parameters: { targetEntityId: ACTOR } });
    assert.equal(opened.kind, 'awaitingInput', JSON.stringify(opened));
    assert.equal(opened.pending.reactionKind, 'counterspell');
    const answer = { kind: 'answerPendingInput', pendingInputId: opened.pending.pendingInputId,
      responseId: `response:resource:${invalid}`, answer: { kind: 'useReaction', abilityRef: counterRef, slotLevel: '3' } };
    if (invalid) {
      const changed = structuredClone(f.state); changed.entities[TARGET].resources['spellSlot:3'] = 1;
      const before = structuredClone(changed), refused = f.runtime.step(f.profiles, changed, answer);
      assert.equal(refused.kind, 'rejected', JSON.stringify(refused)); assert.deepEqual(refused.events, []); assert.deepEqual(changed, before);
    } else {
      const done = apply(f, answer); assert.equal(done.kind, 'committed', JSON.stringify(done));
      assert.deepEqual(f.state.entities[TARGET].resources, { slot3: 0 });
      assert.deepEqual(f.state.entities[TARGET].resourceMaximums, { slot3: 1 });
      assert.deepEqual(f.state.combatRuntime.entities[TARGET].resources['spellSlot:3'], { current: '0', maximum: '1' });
      assert.equal(f.events.filter(e => e.eventType === 'ResourceSpent' && e.payload.entityId === TARGET).length, 1);
    }
  }
});
