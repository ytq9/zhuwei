import { readFileSync } from 'node:fs';
import { createVersionedRulesRuntime } from '../../../app/_runtime/lib/rules/v2-runtime.ts';
import { actionActivityCompletionRoot } from '../../../app/_runtime/lib/rules/v2/activity-progress.ts';
import { atomicCompletionInput } from '../../support/fixtures/vnext-action-duration.mjs';
import { stepActionToDecision } from '../../support/fixtures/vnext-action-lifecycle.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as TARGET, PROBE_ZONE as BASIS } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { lowerVNext2ProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { canonicalSha256 } from '../../../app/_runtime/lib/rules/profiles/canonical.ts';
import { itemBundle } from '../../support/fixtures/vnext-authored-bundles.mjs';
import { ATOMIC_WORLD_INTERACTION_STEPS_PLAN_SCHEMA } from '../../../app/_runtime/lib/rules/v2/world-interaction-model.ts';
import { authorityRevisionOrHash } from '../../../app/_runtime/lib/rules/v2/authority-bindings.ts';
import { worldInteractionFeasibilityDependencyRefs } from '../../../app/_runtime/lib/rules/v2/world-interaction-model.ts';
import { createEventTransition } from '../../../app/_runtime/lib/rules/v2/events.ts';
import { createDefinitionSnapshot, storedSemanticDefinition } from '../../../app/_runtime/lib/rules/v2/semantic-definitions.ts';

function fixture(name, use = false, authorOnly = false) {
  const f = createAuthoredProbeFixture(name), bundle = itemBundle();
  if (!use) bundle.proposals.pop();
  if (authorOnly) bundle.proposals = bundle.proposals.slice(0, 1);
  const lower = lowerVNext2ProposalBundle({ value: bundle, rootActionId: f.rootActionId,
    actorCharacterId: ACTOR, requiredContext: f.requiredContext, state: f.state });
  assert.equal(lower.kind, 'accepted', JSON.stringify(lower));
  const loweredInput = atomicCompletionInput(lower.command.rulesInput);
  const atomic = loweredInput.kind === "applyAtomicWorldInteractionSteps" ? (({kind, ...plan}) => plan)(loweredInput) : { rootActionId: f.rootActionId, actorCharacterId: ACTOR, bundleHash: canonicalSha256(bundle), contextHash: f.requiredContext.binding.contextHash, sharedRuling: "directSuccess", steps: [{ formId: lower.command.formId, proposalRef: lower.command.proposalRef, ruling: "directSuccess", rulesInput: loweredInput, dependsOn: [], consumes: bundle.proposals[0].consumes, produces: bundle.proposals[0].produces, outcomeBinding: "always" }] };
  const plan = { schema: 'zhuwei.frozen-player-choice/vnext-1', rootActionId: f.rootActionId,
    actorCharacterId: ACTOR, pendingInputId: `pending:${f.rootActionId}`, contextHash: f.requiredContext.binding.contextHash,
    bundleHash: canonicalSha256(bundle), profilesHash: canonicalSha256(f.profiles), readSet: [], question: '要执行这个方案还是取消？',
    choices: [
      { choiceId: 'proceed', label: '执行方案', publicRisk: '执行已经说明的效果。',
        continuation: { kind: 'adjudication', plan: { schema: ATOMIC_WORLD_INTERACTION_STEPS_PLAN_SCHEMA, ...atomic } } },
      { choiceId: 'cancel', label: '取消', publicRisk: '不执行这个方案。', continuation: { kind: 'cancel' } },
    ] };
  return { ...f, plan };
}
function open(f, plan = f.plan) {
  return f.runtime.step(f.profiles, f.state, { kind: 'openFrozenPlayerChoice', rootActionId: f.rootActionId, actorCharacterId: ACTOR, plan });
}
function answer(f, state, choiceId, extra = {}) {
  return stepActionToDecision(f.runtime, f.profiles, state, { kind: 'answerFrozenPlayerChoice', rootActionId: f.rootActionId,
    controllerCharacterId: ACTOR, pendingInputId: f.plan.pendingInputId, choiceId, ...extra });
}
function replay(f, events, state) {
  const rebuilt = f.runtime.replay(f.genesis, events);
  assert.equal(rebuilt.kind, 'replayed', JSON.stringify(rebuilt));
  assert.deepEqual(rebuilt.state, state);
}

function waitingWithOuterBasis(name) {
  const f = fixture(name, true);
  assert.ok(f.plan.choices[0].continuation.plan.steps.every(step => !step.rulesInput.plan.readSet.some(read => read.ref === BASIS)));
  f.plan.readSet = [{ ref: BASIS, revisionOrHash: authorityRevisionOrHash(f.state, BASIS) }];
  const opened = open(f); assert.equal(opened.kind, 'awaitingInput', JSON.stringify(opened));
  const selected = answer(f, opened.state, 'proceed');
  assert.equal(selected.kind, 'awaitingRandomness', JSON.stringify(selected));
  assert.equal(selected.state.atomicWorldInteractions?.[f.rootActionId], undefined, 'first randomness has no atomic suspension');
  const changed = structuredClone(selected.state), prior = changed.campaignRuntime.definitions[BASIS];
  changed.campaignRuntime.definitions[BASIS] = storedSemanticDefinition(prior.semanticKind, prior.visibilityPolicyRef,
    createDefinitionSnapshot(BASIS, '2', { ...prior.content, observableState: 'closed' }),
    { templateRef: prior.templateRef, templateHash: prior.templateHash });
  assert.equal(f.runtime.project(f.profiles, changed, f.viewer).kind, 'projected', 'changed basis is still a valid authority state');
  const rolls = selected.randomnessRequest.hazardRolls.flatMap(spec => spec.dice.flatMap(die => Array(Number(die.count)).fill(2)));
  return { f, opened, selected, changed, rolls };
}

test('first frozen randomness rechecks decision-only basis before any effect or input marker', () => {
  const { f, selected, changed, rolls } = waitingWithOuterBasis('frozen-first-randomness-basis');
  const before = structuredClone(changed);
  const rejected = f.runtime.step(f.profiles, changed, { kind: 'fulfillAuthoritativeRandomness', continuation: selected.continuation, rolls });
  assert.equal(rejected.kind, 'rejected', JSON.stringify(rejected));
  assert.equal(rejected.rejection.code, 'causalFrontierConflict');
  assert.deepEqual(rejected.events, []);
  assert.deepEqual(changed, before);
  const unchanged = f.runtime.step(f.profiles, selected.state, { kind: 'fulfillAuthoritativeRandomness', continuation: selected.continuation, rolls });
  assert.equal(unchanged.kind, 'committed', JSON.stringify(unchanged));
  assert.ok(unchanged.scope.reads.includes(BASIS));
});

test('frozen input reducer rejects a stale outer basis even with a valid saved random input', () => {
  const { f, opened, selected, changed, rolls } = waitingWithOuterBasis('frozen-input-reducer-basis');
  const done = f.runtime.step(f.profiles, selected.state, { kind: 'fulfillAuthoritativeRandomness', continuation: selected.continuation, rolls });
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  const marker = done.events.find(event => event.eventType === 'ActivityCompleted');
  assert.ok(marker);
  assert.throws(() => createEventTransition(changed, f.profiles, {
    rootActionId: marker.rootActionId, eventType: marker.eventType, payload: marker.payload,
    secrecy: marker.secrecy, visibilityPolicyId: marker.visibilityPolicyId,
  }), /action completion/);
  replay(f, [...opened.events, ...selected.events, ...done.events], done.state);
});

test('frozen choice preflights all options, keeps plans private, and executes or cancels the original root', () => {
  for (const choice of ['proceed', 'cancel']) {
    const f = fixture(`frozen-${choice}`), waiting = open(f);
    assert.equal(waiting.kind, 'awaitingInput', JSON.stringify(waiting));
    assert.equal(waiting.receipt.status, 'awaitingInput');
    assert.deepEqual(waiting.state.entities, f.state.entities);
    assert.deepEqual(waiting.state.campaignRuntime.itemSystem, f.state.campaignRuntime.itemSystem);
    const projected = f.runtime.project(f.profiles, waiting.state, f.viewer);
    assert.equal(projected.kind, 'projected');
    assert.equal(/frozenPlayerChoices|profilesHash|rulesInput|authorAbility/.test(JSON.stringify(projected)), false);
    assert.equal(/continuation|rulesInput|contextHash/.test(JSON.stringify(waiting.pending)), false);
    replay(f, waiting.events, waiting.state);
    const done = answer(f, waiting.state, choice);
    assert.equal(done.kind, 'committed', JSON.stringify(done));
    assert.equal(done.receipt.rootActionId, choice === 'cancel' ? f.rootActionId : `activity-result:${f.rootActionId}`);
    assert.equal(done.state.pendingInputs[f.plan.pendingInputId], undefined);
    assert.equal(done.state.frozenPlayerChoices[f.plan.pendingInputId], undefined);
    if (choice === 'cancel') assert.deepEqual(done.state.campaignRuntime.itemSystem, f.state.campaignRuntime.itemSystem);
    else assert.equal(done.events.filter(event => event.eventType === 'ItemMaterialized').length, 1);
    assert.equal(answer(f, done.state, choice).kind, 'rejected');
    replay(f, [...waiting.events, ...done.events], done.state);
  }
});

test('frozen choice rejects invalid unselected plans, changed dependencies, foreign answers and proposal injection', () => {
  const f = fixture('frozen-rejections');
  const invalid = structuredClone(f.plan);
  invalid.choices[0].continuation.plan.steps.at(-1).rulesInput.plan.operation.quantity = 999;
  assert.equal(open(f, invalid).kind, 'rejected');
  const waiting = open(f); assert.equal(waiting.kind, 'awaitingInput', JSON.stringify(waiting));
  for (const [choice, extra] of [['unknown', {}], ['proceed', { controllerCharacterId: TARGET }],
    ['proceed', { proposal: {} }]]) {
    const rejected = answer(f, waiting.state, choice, extra);
    assert.equal(rejected.kind, 'rejected'); assert.deepEqual(rejected.events, []);
  }
  const changed = structuredClone(waiting.state); changed.entities[ACTOR].hitPoints.current--;
  const conflict = answer(f, changed, 'proceed');
  assert.equal(conflict.kind, 'rejected'); assert.equal(conflict.rejection.code, 'causalFrontierConflict');
  assert.ok(changed.pendingInputs[f.plan.pendingInputId]);
  const bypass = f.runtime.step(f.profiles, waiting.state, { kind: 'answerPendingInput', rootActionId: f.rootActionId,
    controllerCharacterId: ACTOR, pendingInputId: f.plan.pendingInputId, answer: { choiceId: 'proceed' },
    proposal: { kind: 'resolveImprovisedAction',
      ruling: { kind: 'directSuccess', summary: 'Injected replacement.' } } });
  assert.equal(bypass.kind, 'rejected');
});

test('a stale frozen plan cannot execute but its controller can cancel without costs or randomness', () => {
  const f = fixture('frozen-stale-cancel', true), waiting = open(f);
  assert.equal(waiting.kind, 'awaitingInput');
  const changed = structuredClone(waiting.state); changed.entities[ACTOR].hitPoints.current--;
  const before = structuredClone(changed);
  assert.equal(answer(f, changed, 'proceed').rejection.code, 'causalFrontierConflict');
  assert.equal(answer(f, changed, 'cancel', { controllerCharacterId: TARGET }).kind, 'rejected');
  const cancelled = answer(f, changed, 'cancel');
  assert.equal(cancelled.kind, 'committed', JSON.stringify(cancelled));
  assert.equal(cancelled.state.frozenPlayerChoices[f.plan.pendingInputId], undefined);
  assert.equal(cancelled.state.pendingInputs[f.plan.pendingInputId], undefined);
  assert.deepEqual(cancelled.events.map(event => event.eventType), ['PendingInputAnswered']);
  assert.deepEqual(cancelled.state.entities, before.entities);
  assert.deepEqual(cancelled.state.campaignRuntime.itemSystem, before.campaignRuntime.itemSystem);
  assert.deepEqual(cancelled.state.internalContinuations, before.internalContinuations);
  assert.deepEqual(cancelled.state.fictionTimelines, before.fictionTimelines);
});

test('a one-step frozen selection completes its settlement and releases only its own plan', () => {
  const f = fixture('frozen-single', false, true);
  const plan = f.plan.choices[0].continuation.plan;
  plan.steps = [plan.steps[0]];
  // Only an authoring step remains, so the continuation spends no fictional time.
  if (!['world-interaction.vnext-1', 'observe.vnext-1', 'social.vnext-1', 'inventory-operation.vnext-1'].includes(plan.steps[0].formId)) delete plan.executionCosts;
  const waiting = open(f); assert.equal(waiting.kind, 'awaitingInput', JSON.stringify(waiting));
  const done = answer(f, waiting.state, 'proceed');
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.equal(done.events.filter(e => e.eventType === 'AtomicWorldInteractionStepsResolved').length, 1);
  assert.equal(done.state.frozenPlayerChoices[f.plan.pendingInputId], undefined);
  replay(f, [...waiting.events, ...done.events], done.state);
});

test('every committed prefix of a frozen execution replays', () => {
  const f = fixture('frozen-early-settlement'), waiting = open(f);
  assert.equal(waiting.kind, 'awaitingInput');
  const done = answer(f, waiting.state, 'proceed');
  assert.equal(done.kind, 'committed');
  // Valid cursor prefixes remain readable by Room's incremental projection.
  for (let count = 1; count <= done.events.length; count++)
    assert.equal(f.runtime.replay(f.genesis, [...waiting.events, ...done.events.slice(0, count)]).kind, 'replayed');
});

test('a frozen refusal preserves its actor and every original attempt cost through selection and replay', () => {
  for (const selection of ['proceed', 'cancel']) {
    const f = fixture(`frozen-refusal-${selection}`);
    const refusal = { schema: 'zhuwei.world-interaction-feasibility-ruling-plan/v1', actorCharacterId: ACTOR,
      contextHash: f.requiredContext.binding.contextHash, intent: '尝试开锁', method: '试用现有工具',
      rulingKind: 'missingPrerequisite', publicBasis: '缺少合适工具。',
      prerequisites: [{ kind: 'tool', ref: null, description: '需要合适工具。' }],
      nextActions: [{ description: '取得工具后再尝试。' }], basisRefs: [],
      costs: [{ kind: 'fictionTime', durationMicros: '60000000' }] };
    refusal.readSet = worldInteractionFeasibilityDependencyRefs(ACTOR, refusal).map(ref => ({ ref,
      revisionOrHash: authorityRevisionOrHash(f.state, ref) }));
    f.plan.choices[0].continuation = { kind: 'inWorldRefusal', plan: refusal };
    const waiting = open(f); assert.equal(waiting.kind, 'awaitingInput', JSON.stringify(waiting));
    const done = answer(f, waiting.state, selection); assert.equal(done.kind, 'committed', JSON.stringify(done));
    if (selection === 'cancel') assert.deepEqual(done.state.fictionTimelines, f.state.fictionTimelines);
    else {
      const event = done.events.find(e => e.eventType === 'WorldInteractionFeasibilityRuled');
      const answered = f.runtime.replay(f.genesis, [...waiting.events, done.events[0]]);
      assert.equal(answered.kind, 'replayed');
      const apply = (state, payload) => createEventTransition(state, f.profiles, { rootActionId: f.rootActionId,
        eventType: event.eventType, payload,
        visibilityPolicyId: event.visibilityPolicyId, secrecy: event.secrecy });
      assert.throws(() => apply(answered.state, { ...event.payload, appliedCosts: [] }), /frozen-choice:refusal-plan-changed/);
      const beforeMarker = f.runtime.replay(f.genesis, [...waiting.events, ...done.events.slice(0, -1)]);
      assert.equal(beforeMarker.kind, 'replayed');
      assert.throws(() => apply(beforeMarker.state, { ...event.payload, actorCharacterId: TARGET }), /frozen-choice:refusal-plan-changed/);
      assert.equal(done.events.filter(e => e.eventType === 'FictionTimeAdvanced').length, 1);
    }
    replay(f, [...waiting.events, ...done.events], done.state);
  }
});

test('selected item use resumes its frozen randomness without a second choice or duplicate resource use', () => {
  const f = fixture('frozen-dice', true), waiting = open(f);
  assert.equal(waiting.kind, 'awaitingInput', JSON.stringify(waiting));
  const selected = answer(f, waiting.state, 'proceed');
  assert.equal(selected.kind, 'awaitingRandomness', JSON.stringify(selected));
  assert.deepEqual(selected.state.campaignRuntime.itemSystem, f.state.campaignRuntime.itemSystem);
  replay(f, [...waiting.events, ...selected.events], selected.state);
  const rolls = selected.randomnessRequest.hazardRolls.flatMap(spec => spec.dice.flatMap(die => Array(Number(die.count)).fill(2)));
  const done = f.runtime.step(f.profiles, selected.state, { kind: 'fulfillAuthoritativeRandomness', continuation: selected.continuation, rolls });
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.equal(done.events.filter(event => event.eventType === 'ItemUsed').length, 1);
  assert.equal(done.state.frozenPlayerChoices[f.plan.pendingInputId], undefined);
  replay(f, [...waiting.events, ...selected.events, ...done.events], done.state);
});

test('whole-root correction removes frozen options and continuations together with their effects', () => {
  for (const phase of ['waiting', 'cancel', 'proceed', 'randomness']) {
    const f = fixture(`frozen-correction-${phase}`, phase === 'randomness'), waiting = open(f);
    assert.equal(waiting.kind, 'awaitingInput');
    const last = phase === 'waiting' ? waiting : answer(f, waiting.state, phase === 'cancel' ? 'cancel' : 'proceed');
    assert.ok(['committed', 'awaitingInput', 'awaitingRandomness'].includes(last.kind), JSON.stringify(last));
    const events = phase === 'waiting' ? waiting.events : [...waiting.events, ...last.events];
    // SPEC 0011 §7: the Room plans a correction on a replay that retains every audit record.
    const rebuilt = f.runtime.replay(f.genesis, events, { retainCorrectionAudit: true });
    assert.equal(rebuilt.kind, 'replayed');
    const corrected = f.runtime.step(f.profiles, rebuilt.state, { kind: 'applyServiceCorrection',
      correctionAuthority: { kind: 'roomCorrectionAuthority', capability: rebuilt.state.correctionRuntime.authorityCapability },
      correctionId: `correction:frozen-${phase}`, targetReceiptId: last.receipt.receiptId, actorCharacterId: ACTOR,
      errorKind: 'rulesMisapplication', publicExplanation: '撤销这次错误的待决行动。',
      basis: { eventSeq: rebuilt.head.eventSeq, lastEventId: rebuilt.head.lastEventId } });
    assert.equal(corrected.kind, 'committed', JSON.stringify(corrected));
    assert.equal(Object.keys(corrected.state.frozenPlayerChoices ?? {}).length, 0);
    assert.deepEqual(corrected.state.pendingInputs, f.state.pendingInputs);
    assert.deepEqual(corrected.state.internalContinuations, f.state.internalContinuations);
    assert.deepEqual(corrected.state.campaignRuntime.activities, f.state.campaignRuntime.activities);
    assert.deepEqual(corrected.state.campaignRuntime.itemSystem, f.state.campaignRuntime.itemSystem);
    assert.deepEqual(corrected.state.entities, f.state.entities);
    replay(f, [...events, ...corrected.events], corrected.state);
  }
});

test('frozen state pins its profile, root and public choice while replay keeps legitimate cursor prefixes', () => {
  const f = fixture('frozen-state-binding'), waiting = open(f);
  assert.equal(waiting.kind, 'awaitingInput');
  for (const mutate of [
    state => { state.frozenPlayerChoices[f.plan.pendingInputId].plan.profilesHash = `sha256:${'1'.repeat(64)}`; },
    state => { state.pendingInputs[f.plan.pendingInputId].options.choices[0].label = 'different choice'; },
    state => {
      const duplicate = structuredClone(state.frozenPlayerChoices[f.plan.pendingInputId]);
      duplicate.plan.pendingInputId += ':duplicate';
      state.frozenPlayerChoices[duplicate.plan.pendingInputId] = duplicate;
    },
  ]) {
    const state = structuredClone(waiting.state); mutate(state);
    assert.equal(f.runtime.project(f.profiles, state, f.viewer).kind, 'rejected');
    assert.equal(answer(f, state, 'proceed').kind, 'rejected');
  }
  const prepared = f.runtime.replay(f.genesis, [waiting.events[0]]);
  assert.equal(prepared.kind, 'replayed');
  const incomplete = answer(f, prepared.state, 'proceed');
  assert.equal(incomplete.kind, 'rejected');
  assert.equal(incomplete.rejection.code, 'profileIntegrityMismatch');
  assert.equal(answer(f, waiting.state, 'proceed').kind, 'committed');
});

test('frozen opening rejects repeated pending records and changed private audiences at replay', () => {
  const f = fixture('frozen-opening-audience'), waiting = open(f);
  assert.equal(waiting.kind, 'awaitingInput');
  const [prepared, requested] = waiting.events;
  const prefix = f.runtime.replay(f.genesis, [prepared]);
  assert.equal(prefix.kind, 'replayed');
  const cases = [
    { source: f.state, before: [], event: prepared, patch: { secrecy: 'public' } },
    { source: f.state, before: [], event: prepared, patch: { visibilityPolicyId: 'visibility:room-members' } },
    { source: prefix.state, before: [prepared], event: requested, patch: { secrecy: 'public' } },
    { source: prefix.state, before: [prepared], event: requested,
      patch: { visibilityPolicyId: `visibility:character-controller:${TARGET}` } },
    { source: waiting.state, before: waiting.events, event: requested, patch: {} },
  ];
  for (const { source, before, event, patch } of cases) {
    assert.throws(() => createEventTransition(source, f.profiles, {
      rootActionId: f.rootActionId, eventType: event.eventType, payload: event.payload,
      secrecy: event.secrecy, visibilityPolicyId: event.visibilityPolicyId, ...patch,
    }), /frozen-choice:/);
    const seq = (BigInt(source.version) + 1n).toString();
    const forged = { ...structuredClone(event), ...patch, eventSeq: seq,
      eventId: `event:${source.runtimeEpochId}:${seq}`, parentEventId: source.lastEventId,
      causalParentEventIds: source.lastEventId === null ? [] : [source.lastEventId] };
    const rejected = f.runtime.replay(f.genesis, [...before, forged]);
    assert.equal(rejected.kind, 'rejected');
    // The reducer rejects the event itself.
    assert.equal(rejected.rejection.code, 'invalidEventEnvelope');
  }
  replay(f, waiting.events, waiting.state);
  assert.equal(answer(f, waiting.state, 'cancel').kind, 'committed');
});


// Real pre-c885793 events and result hashes; never regenerate from current Rules.
const legacyInventoryFixtures = JSON.parse(readFileSync(
  new URL('../../support/fixtures/frozen-inventory-legacy-events.json', import.meta.url), 'utf8')).cases;
function legacyInventoryRuntime(f) {
  const profiles = f.genesis.profiles;
  return createVersionedRulesRuntime({ registrations: [{ manifest: profiles, interpreterKind: 'authoritative-v2' }],
    defaultManifest: profiles.manifest });
}
function replayLegacyInventory(runtime, f, events, stateHash) {
  const result = runtime.replay(f.genesis, events);
  assert.equal(result.kind, 'replayed', JSON.stringify(result));
  if (stateHash !== undefined) assert.equal(canonicalSha256(result.state), stateHash, 'retain the historical Rules state');
  return result.state;
}
function legacyInventoryChoicePlan(f) {
  return f.choice.events.find(event => event.eventType === 'FrozenPlayerChoicePrepared').payload.record.plan;
}
// Exercise each public admission boundary using the same action. Duration belongs
// to the Activity form; the direct form has no time cost and reaches its own preflight.
function inventoryAdmissionInputs(choicePlan, state) {
  const source = choicePlan.choices.find(choice => choice.continuation.kind === 'adjudication').continuation.plan;
  const { schema: _schema, ...fields } = structuredClone(source);
  const direct = { kind: 'applyAtomicWorldInteractionSteps', ...fields };
  delete direct.executionCosts;
  const timed = structuredClone(direct), root = choicePlan.rootActionId;
  timed.rootActionId = actionActivityCompletionRoot(root);
  for (const step of timed.steps) step.rulesInput.rootActionId = timed.rootActionId;
  timed.executionCosts = { costs: [{ kind: 'fictionTime', durationMicros: '300000000' }],
    readSet: [`character-timeline:${timed.actorCharacterId}`, timed.actorCharacterId].sort()
      .map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(state, ref) })) };
  const choice = structuredClone(choicePlan);
  return [
    { name: 'direct', input: direct, plan: direct },
    { name: 'Activity', input: { kind: 'startActionActivity', rootActionId: root,
      actorCharacterId: timed.actorCharacterId, completionInput: timed }, plan: timed },
    { name: 'choice', input: { kind: 'openFrozenPlayerChoice', rootActionId: root,
      actorCharacterId: choice.actorCharacterId, plan: choice },
      plan: choice.choices.find(option => option.continuation.kind === 'adjudication').continuation.plan },
  ];
}
for (const f of legacyInventoryFixtures) {
  // SPEC 0016 §9.2: both previously frozen dice branches retain their old effects.
  test(`legacy pending ${f.name} resumes and replays the historical result`, () => {
    const runtime = legacyInventoryRuntime(f), profiles = f.genesis.profiles;
    const prefix = [...f.setupEvents, ...f.pending.events];
    const state = replayLegacyInventory(runtime, f, prefix, f.pending.stateHash);
    for (const expected of f.pending.completions) {
      const result = runtime.step(profiles, structuredClone(state), { kind: 'fulfillAuthoritativeRandomness',
        continuation: f.pending.continuation, rolls: expected.rolls });
      assert.equal(result.kind, 'committed', JSON.stringify(result));
      assert.equal(canonicalSha256(result.events), expected.eventsHash, 'compare against old runtime before replaying new output');
      assert.equal(canonicalSha256(result.state), expected.stateHash);
      replayLegacyInventory(runtime, f, [...prefix, ...result.events], expected.stateHash);
    }
  });
  // SPEC 0016 §9.2: an old visible confirmation retains its choices and saved execution.
  test(`legacy choice ${f.name} replays, selects and resumes both frozen branches`, () => {
    const runtime = legacyInventoryRuntime(f), profiles = f.genesis.profiles;
    const prefix = [...f.setupEvents, ...f.choice.events];
    const state = replayLegacyInventory(runtime, f, prefix, f.choice.stateHash);
    const selected = stepActionToDecision(runtime, profiles, state, f.choice.answerInput);
    assert.equal(selected.kind, 'awaitingRandomness', JSON.stringify(selected));
    assert.equal(canonicalSha256(selected.events), f.choice.selectedEventsHash);
    assert.equal(canonicalSha256(selected.state), f.choice.selectedStateHash);
    assert.deepEqual(selected.continuation, f.choice.continuation);
    replayLegacyInventory(runtime, f, [...prefix, ...selected.events], f.choice.selectedStateHash);
    for (const expected of f.choice.completions) {
      const result = runtime.step(profiles, structuredClone(selected.state), { kind: 'fulfillAuthoritativeRandomness',
        continuation: selected.continuation, rolls: expected.rolls });
      assert.equal(result.kind, 'committed', JSON.stringify(result));
      assert.equal(canonicalSha256(result.events), expected.eventsHash, 'compare against old runtime before replaying new output');
      assert.equal(canonicalSha256(result.state), expected.stateHash);
      replayLegacyInventory(runtime, f, [...prefix, ...selected.events, ...result.events], expected.stateHash);
    }
  });
  // A legacy-looking new input receives current semantics at all three admission boundaries.
  test(`new ${f.name} cannot omit inventory policy at direct, Activity or choice admission`, () => {
    const runtime = legacyInventoryRuntime(f), profiles = f.genesis.profiles;
    const state = replayLegacyInventory(runtime, f, f.setupEvents), before = structuredClone(state);
    const expected = f.name.startsWith('concealed') ? 'concealment:target-acquisition-requires-on-success'
      : 'inventory:physical-check-required-for-foreign-holder';
    for (const { name, input, plan } of inventoryAdmissionInputs(legacyInventoryChoicePlan(f), state)) {
      assert.equal(Object.hasOwn(plan, 'inventoryPolicy'), false);
      const result = runtime.step(profiles, state, input);
      assert.equal(result.kind, 'rejected', `${name}: ${JSON.stringify(result)}`);
      assert.equal(result.rejection.message, expected, `${name} must reach the current inventory policy`);
      assert.deepEqual(result.events, []);
      assert.deepEqual(state, before);
    }
  });
}

// Unknown policies must fail on otherwise legal inputs, rather than hiding behind
// the inventory defect already exercised above. Missing policy is server-stamped.
test('fresh direct, Activity and choice admission stamp current policy and reject caller-selected unknown policies', () => {
  const f = fixture('inventory-policy-admission', true);
  for (const entry of inventoryAdmissionInputs(f.plan, f.state)) {
    assert.equal(Object.hasOwn(entry.plan, 'inventoryPolicy'), false);
    const accepted = f.runtime.step(f.profiles, f.state, entry.input);
    const frozen = entry.name === 'direct'
      ? accepted.state?.internalContinuations[accepted.continuation?.continuationId]?.resolutionPlan
      : entry.name === 'Activity'
        ? accepted.events.find(event => event.eventType === 'ActivityStarted')?.payload.completion.plan
        : accepted.state?.frozenPlayerChoices[f.plan.pendingInputId]?.plan.choices[0].continuation.plan;
    assert.equal(accepted.kind, entry.name === 'direct' ? 'awaitingRandomness' : entry.name === 'Activity' ? 'committed' : 'awaitingInput', JSON.stringify(accepted));
    assert.equal(frozen?.inventoryPolicy, 'physical-acquisition-v1', `${entry.name} must persist current semantics`);
    for (const policy of ['legacy', 'unknown-inventory-policy']) {
      const candidate = structuredClone(entry), before = structuredClone(f.state);
      candidate.plan.inventoryPolicy = policy;
      const result = f.runtime.step(f.profiles, f.state, candidate.input);
      assert.equal(result.kind, 'rejected', `${entry.name}/${policy}: ${JSON.stringify(result)}`);
      assert.equal(result.rejection.code, 'invalidRulesInput');
      assert.deepEqual(result.events, []);
      assert.deepEqual(f.state, before);
    }
  }
});
