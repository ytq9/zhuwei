import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_SOURCE as SOURCE, PROBE_SCENE as SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { encodeVNextStrictToolBundle } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { stepActionToDecision, committedActionRange } from './fixtures/vnext-action-lifecycle.mjs';
import { atomicCompletionInput } from './fixtures/vnext-action-duration.mjs';
import { createDefinitionSnapshot, storedSemanticDefinition } from '../app/_runtime/lib/rules/v2/semantic-definitions.ts';
import { createEventTransition } from '../app/_runtime/lib/rules/v2/events.ts';

function proposal(description, observableState = 'none', ref = SOURCE) {
  return { mode: 'adjudication', basisRefs: [ref], terminal: { kind: 'none' },
    adjudication: { kind: 'directSuccess', durationMicros: '300000000', risk: '仅观察，不接触对象。',
      successOutcome: '看清对象当前的外观和状态。' },
    proposals: [{ kind: 'completeObject', definitionRef: ref, description, observableState,
      basisRefs: [ref], consumes: [], produces: [], outcomeBinding: 'always',
      summary: 'KP 确定尚未定义的对象细节，玩家没有操作对象。' },
    { kind: 'observe', sceneRef: SCENE, basisRefs: [ref], consumes: [], produces: [], outcomeBinding: 'always',
      inquiry: '它现在是什么样子？', method: '原地观察，不接触或转动对象。', focusRefs: [ref], existingFactRefs: [],
      branches: { success: { outcomeCode: 'outcome:observed', summary: '看清对象的当前状态。',
        sensoryEvidence: [{ observerRef: ACTOR, subjectRef: ref, sense: 'sight', evidence: description.replace('发出细微嘶鸣', '表面锈蚀'), basisRefs: [ref] }],
        characterInferences: [] }, failure: { kind: 'none' } } }] };
}

function lower(f, value) {
  const candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(value)));
  assert.equal(candidate.kind, 'accepted', JSON.stringify(candidate));
  return lowerVNext2ProposalBundle({ ...f, value: candidate.bundle });
}

test('KP completes existing object details before observation without a player manipulation or replacement object', () => {
  for (const [description, state] of [
    ['生锈阀门发出细微嘶鸣。阀柄位于约一人高处，指针朝向供气开启标记。', 'supply-open'],
    ['生锈阀门发出细微嘶鸣。外壳上能看见几道浅色铸造纹路。', 'none'],
  ]) {
    const f = createAuthoredProbeFixture(`object-completion-${state}`), before = structuredClone(f.state);
    const value = proposal(description, state);
    // An explicitly cited exact creation grant and an omitted grant have the
    // same authorization; neither may turn into a public content source.
    if (state === 'none') value.proposals[0].basisRefs.push('profile-context:module:authored-probe');
    const lowered = lower(f, value);
    assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
    const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
    assert.equal(result.kind, 'committed', JSON.stringify(result));
    const definition = result.state.campaignRuntime.definitions[SOURCE];
    assert.equal(definition.content.description, description);
    assert.equal(definition.content.observableState, state === 'none' ? before.campaignRuntime.definitions[SOURCE].content.observableState : state);
    assert.equal(Object.keys(result.state.campaignRuntime.definitions).length, Object.keys(before.campaignRuntime.definitions).length);
    assert.deepEqual(result.state.entities, before.entities);
    assert.deepEqual(result.state.combatRuntime, before.combatRuntime);
    assert.deepEqual(result.state.campaignRuntime.itemSystem, before.campaignRuntime.itemSystem);
    const interactions = result.events.filter(event => event.eventType === 'WorldInteractionResolved');
    assert.equal(interactions.length, 1);
    assert.equal(interactions[0].payload.observation, true);
    const view = f.runtime.project(f.profiles, result.state, f.viewer, { channel: 'realtime',
      committedRange: committedActionRange(result.state, { receiptId: result.receipt.receiptId,
        actorCharacterId: ACTOR, priorState: before, events: result.events }) });
    assert.equal(view.kind, 'projected', JSON.stringify(view));
    assert.ok(view.renderableClaims.claims.some(claim => claim.kind === 'sceneFeature' && claim.description.includes(description)), JSON.stringify(view.renderableClaims));
    assert.ok(!view.renderableClaims.claims.some(claim => claim.kind === 'definitionRevised'), 'completion must not claim the object changed in the world');
    const restored = f.runtime.replay(f.genesis, result.events);
    assert.equal(restored.kind, 'replayed', JSON.stringify(restored));
    assert.deepEqual(restored.state, result.state);
    const duplicate = f.runtime.step(f.profiles, result.state, lowered.command.rulesInput);
    assert.equal(duplicate.kind, 'rejected');
    assert.equal(duplicate.rejection.code, 'duplicateRootAction');
    assert.deepEqual(duplicate.events, []);
    const context = freezeAuthoredProbeContext(f, restored.state, { rootActionId: `${f.rootActionId}:next`, focusRefs: [SOURCE] }).context;
    assert.ok(JSON.stringify(context).includes(description));
  }
});

test('completion uses the same existing identity for another object with nested semantics', () => {
  const ref = 'definition:wall-lamp', description = '壁灯泛着暖光，灯罩边缘有细密花纹。';
  const definition = storedSemanticDefinition('sceneFeature', 'visibility:scene-observers', createDefinitionSnapshot(ref, '1', {
    sceneRef: SCENE, label: '壁灯', mechanicDefinitionRefs: [], semantics: { description: '壁灯泛着暖光。', observableState: 'present' },
  }));
  const f = createAuthoredProbeFixture('nested-object', { semanticDefinitions: [definition] });
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [ref] }).context;
  const value = proposal(description, 'none', ref);
  value.proposals.reverse(); // KP need not calculate execution order.
  const lowered = lower(f, value);
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  assert.equal(atomicCompletionInput(lowered.command.rulesInput).steps[0].rulesInput.kind, 'reviseSemanticDefinition');
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(result.kind, 'committed', JSON.stringify(result));
  assert.deepEqual(result.state.campaignRuntime.definitions[ref].content, { ...definition.content,
    semantics: { ...definition.content.semantics, description } });
  assert.deepEqual(f.runtime.replay(f.genesis, result.events).state, result.state);
});

test('world completion is frozen before the perception roll and survives failure, recovery and replay', () => {
  for (const roll of [1, 20]) {
    const f = createAuthoredProbeFixture(`completion-roll-${roll}`), value = proposal('生锈阀门发出细微嘶鸣。外壳有铸造纹路。', '供气开启');
    value.adjudication = { kind: 'check', durationMicros: '300000000', checkKind: 'abilityCheck', ability: 'wis', skill: null,
      dc: 10, mode: 'normal', risk: '细微声音可能难以分辨。', successOutcome: '辨清细微声响。', failureOutcome: '未能辨清。' };
    value.proposals[1].branches.failure = { outcomeCode: 'outcome:uncertain', summary: '未能辨清。', sensoryEvidence: [], characterInferences: [] };
    const lowered = lower(f, value);
    assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
    const pending = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
    assert.equal(pending.kind, 'awaitingRandomness', JSON.stringify(pending));
    assert.deepEqual(pending.state.campaignRuntime.definitions[SOURCE], f.state.campaignRuntime.definitions[SOURCE]);
    const restored = f.runtime.replay(f.genesis, pending.events);
    assert.equal(restored.kind, 'replayed', JSON.stringify(restored));
    const result = f.runtime.step(f.profiles, restored.state, { kind: 'fulfillAuthoritativeRandomness', continuation: pending.continuation,
      rolls: pending.randomnessRequest.dice.flatMap(die => Array(Number(die.count)).fill(roll)) });
    assert.equal(result.kind, 'committed', JSON.stringify(result));
    assert.equal(result.state.campaignRuntime.definitions[SOURCE].content.observableState, '供气开启');
    assert.equal(result.events.filter(event => event.eventType === 'SemanticDefinitionRevised' && event.payload.completion).length, 1);
    assert.equal(result.events.find(event => event.eventType === 'WorldInteractionResolved').payload.branch, roll === 20 ? 'success' : 'failure');
    assert.deepEqual(f.runtime.replay(f.genesis, [...pending.events, ...result.events]).state, result.state);
    const beforeCompletion = result.events.findIndex(event => event.eventType === 'SemanticDefinitionRevised');
    const preceding = f.runtime.replay(f.genesis, [...pending.events, ...result.events.slice(0, beforeCompletion)]).state;
    const event = result.events[beforeCompletion], next = event.payload.nextDefinition;
    const changed = storedSemanticDefinition(next.semanticKind, next.visibilityPolicyRef,
      createDefinitionSnapshot(next.definitionId, next.revision, { ...next.content, observableState: '骰后另编的状态' }), next);
    assert.throws(() => createEventTransition(preceding, f.profiles, { rootActionId: event.rootActionId,
      resolutionId: event.resolutionId, eventType: event.eventType, payload: { ...event.payload, nextDefinition: changed }, scopeProof: result.scopeProof,
      visibilityPolicyId: event.visibilityPolicyId, secrecy: event.secrecy }), /object-completion:frozen-content-changed/);
    const { completion: _completion, ...withoutMarker } = event.payload;
    assert.throws(() => createEventTransition(preceding, f.profiles, { rootActionId: event.rootActionId,
      eventType: event.eventType, payload: withoutMarker, scopeProof: result.scopeProof,
      visibilityPolicyId: event.visibilityPolicyId, secrecy: event.secrecy }), /object-completion:marker-required/);
    const settlement = result.events.find(event => event.eventType === 'AtomicWorldInteractionStepsResolved');
    assert.throws(() => createEventTransition(preceding, f.profiles, { rootActionId: settlement.rootActionId,
      eventType: settlement.eventType, payload: settlement.payload, scopeProof: result.scopeProof,
      visibilityPolicyId: settlement.visibilityPolicyId, secrecy: settlement.secrecy }), /object-completion:frozen-step-incomplete/);
  }
});

function closeValve() {
  return { kind: 'worldInteraction', sceneRef: SCENE, basisRefs: [SOURCE], consumes: [], produces: [], outcomeBinding: 'always',
    targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: null, intent: '关闭阀门', method: '转动阀柄关闭供气。',
    branches: { success: { outcomeCode: 'outcome:closed', summary: '阀门供气被关闭。', sensoryEvidence: [], pressures: [], opportunities: [],
      effects: [{ kind: 'definitionRevision', definitionRef: SOURCE, summary: '关闭供气。',
        operations: [{ kind: 'set', path: ['observableState'], value: '供气关闭' }] }] }, failure: { kind: 'none' } } };
}

test('real manipulation retains its change event both alone and after completing the original state in one bundle', () => {
  for (const withCompletion of [false, true]) {
    const f = createAuthoredProbeFixture(`physical-${withCompletion}`), value = proposal('生锈阀门发出细微嘶鸣。阀柄约一人高。', '供气开启');
    value.proposals = withCompletion ? [closeValve(), value.proposals[0]] : [closeValve()];
    const lowered = lower(f, value);
    assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
    const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
    assert.equal(result.kind, 'committed', JSON.stringify(result));
    assert.equal(result.state.campaignRuntime.definitions[SOURCE].content.observableState, '供气关闭');
    assert.equal(result.state.campaignRuntime.definitions[SOURCE].revision, withCompletion ? '3' : '2');
    assert.deepEqual(f.runtime.replay(f.genesis, result.events).state, result.state);
    const view = f.runtime.project(f.profiles, result.state, f.viewer, { channel: 'realtime',
      committedRange: committedActionRange(result.state, { receiptId: result.receipt.receiptId, actorCharacterId: ACTOR,
        priorState: f.state, events: result.events }) });
    assert.equal(view.kind, 'projected');
    assert.equal(view.renderableClaims.claims.filter(claim => claim.kind === 'definitionRevised').length, 1);
    assert.match(view.renderableClaims.claims.find(claim => claim.kind === 'definitionRevised').summary, /供气关闭/);
    assert.equal(result.events.filter(event => event.eventType === 'WorldInteractionResolved' && !event.payload.observation).length, 1);
  }
});

test('completion rejects missing authority, unavailable objects, stale bases, conditional creation and mechanical fields without effects', () => {
  const f = createAuthoredProbeFixture('completion-rejections'), value = proposal('生锈阀门发出细微嘶鸣。阀柄约一人高。');
  const noGrant = { ...f, requiredContext: { ...f.requiredContext, entries: f.requiredContext.entries.filter(entry => entry.kind !== 'openBlank') } };
  assert.equal(lower(noGrant, value).code, 'CONTEXT_INSUFFICIENT');
  for (const ref of [ACTOR, 'feature:probe-valve', 'definition:missing']) assert.equal(lower(f, proposal('外观。', 'none', ref)).kind, 'rejected');
  const conditional = encodeVNextStrictToolBundle(value); conditional.steps[0].outcomeBinding = 'onSuccess';
  assert.throws(() => parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(conditional)),
    error => error.diagnostics?.some(diagnostic => diagnostic.constraint === 'filling:direct-outcome-binding-always'));
  const lowered = lower(f, value);
  assert.equal(lowered.kind, 'accepted');
  const before = structuredClone(f.state);
  for (const mutate of [
    plan => { plan.steps[0].rulesInput.plan.operations.push({ kind: 'set', path: ['mechanicDefinitionRefs'], value: [] }); },
    plan => { plan.steps[0].rulesInput.plan.baseHash = `sha256:${'0'.repeat(64)}`; },
    plan => { plan.steps[0].rulesInput.plan.readSet = []; },
    plan => { plan.steps[0].outcomeBinding = 'onSuccess'; },
    plan => { plan.steps.reverse(); plan.steps.forEach(step => { step.dependsOn = []; }); },
    plan => { plan.steps.push({ ...structuredClone(plan.steps[0]), proposalRef: 'proposal:duplicate-completion' }); },
  ]) {
    const input = structuredClone(lowered.command.rulesInput); mutate(atomicCompletionInput(input));
    const result = f.runtime.step(f.profiles, f.state, input);
    assert.equal(result.kind, 'rejected', JSON.stringify(result));
    assert.deepEqual(result.events, []); assert.deepEqual(f.state, before);
  }
});
