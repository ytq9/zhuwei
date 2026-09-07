import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { itemBundle } from './fixtures/vnext-authored-bundles.mjs';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE as bridge, vnext2CommandToRoomLowering } from '../app/_runtime/lib/kp/vnext/room-bridge.ts';
import { canonicalSha256 } from '../app/_runtime/lib/rules/profiles/canonical.ts';

function clarification(inner = itemBundle()) {
  const { basisRefs, adjudication, proposals } = inner;
  const continuation = { kind: 'adjudication', basisRefs, adjudication, proposals };
  return { schema: inner.schema, kind: 'proposalBundle', mode: 'terminal', basisRefs: [], adjudication: null, proposals: [],
    terminal: { kind: 'clarification', intent: '选择实际执行的方案。', method: '先确认再执行。', question: '选择哪个方案？',
      choices: ['first', 'second'].map(choiceId => ({ choiceId, label: choiceId, publicRisk: '执行已说明的效果。', basisRefs: [],
        continuation: structuredClone(continuation) })).concat([{ choiceId: 'cancel', label: '取消', publicRisk: '不执行。', basisRefs: [], continuation: { kind: 'cancel' } }]) } };
}
function lower(f, value) {
  return lowerVNext2ProposalBundle({ value, rootActionId: f.rootActionId, actorCharacterId: ACTOR,
    profiles: f.profiles, requiredContext: f.requiredContext, state: f.state });
}

test('clarification lowers every branch through the atomic executor and pins distinct choice identities', () => {
  for (const selected of ['first', 'second', 'cancel']) {
    const f = createAuthoredProbeFixture(`clarification-${selected}`), inner = itemBundle();
    inner.proposals.pop();
    const lowered = lower(f, clarification(inner));
    assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
    assert.equal(lowered.command.kind, 'frozenPlayerChoice');
    const plan = lowered.command.plan;
    assert.equal(plan.profilesHash, canonicalSha256(f.profiles));
    assert.notEqual(plan.choices[0].continuation.plan.bundleHash, plan.choices[1].continuation.plan.bundleHash);
    const room = vnext2CommandToRoomLowering(lowered.command);
    assert.equal(room.kind, 'accepted');
    assert.equal(bridge.validateReadSet({ profiles: f.profiles, state: f.state,
      requiredContext: f.requiredContext, rulesInput: room.input }).kind, 'valid');
    const waiting = f.runtime.step(f.profiles, f.state, room.input);
    assert.equal(waiting.kind, 'awaitingInput', JSON.stringify(waiting));
    assert.equal(/continuation|readSet|profilesHash/.test(JSON.stringify(waiting.pending)), false);
    const done = f.runtime.step(f.profiles, waiting.state, { kind: 'answerFrozenPlayerChoice', rootActionId: f.rootActionId,
      controllerCharacterId: ACTOR, pendingInputId: plan.pendingInputId, choiceId: selected });
    assert.equal(done.kind, 'committed', JSON.stringify(done));
    const projected = f.runtime.project(f.profiles, done.state, f.viewer, { committedRange: {
      receiptId: done.receipt.receiptId, actorCharacterId: ACTOR, priorState: f.state, events: [...waiting.events, ...done.events],
    } });
    assert.equal(projected.kind, 'projected', JSON.stringify(projected));
    assert.equal(done.events.filter(e => e.eventType === 'ItemMaterialized').length, selected === 'cancel' ? 0 : 1);
    assert.equal(f.runtime.replay(f.genesis, [...waiting.events, ...done.events]).kind, 'replayed');
  }
});

test('a single-step option and a refusal keep their original effects and read bindings', () => {
  const f = createAuthoredProbeFixture('clarification-single-refusal'), inner = itemBundle();
  inner.proposals = [inner.proposals[0]];
  const value = clarification(inner);
  value.terminal.choices[1].continuation = { kind: 'inWorldRefusal', basisRefs: [], intent: '尝试开锁', method: '试用工具',
    ruling: { kind: 'missingPrerequisite', publicBasis: '缺少合适工具。',
      prerequisites: [{ kind: 'tool', ref: null, description: '需要合适工具。' }],
      nextActions: [{ description: '取得工具后再尝试。', basisRefs: [] }],
      attemptCosts: [{ kind: 'fictionTime', durationMicros: '60000000' }] } };
  const lowered = lower(f, value); assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  assert.equal(lowered.command.plan.choices[0].continuation.plan.steps.length, 1);
  const room = vnext2CommandToRoomLowering(lowered.command);
  assert.equal(bridge.validateReadSet({ profiles: f.profiles, state: f.state,
    requiredContext: f.requiredContext, rulesInput: room.input }).kind, 'valid');
  const stale = structuredClone(room.input);
  stale.plan.readSet[0].revisionOrHash = `sha256:${'1'.repeat(64)}`;
  assert.equal(bridge.validateReadSet({ profiles: f.profiles, state: f.state,
    requiredContext: f.requiredContext, rulesInput: stale }).kind, 'conflict');
  assert.equal(f.runtime.step(f.profiles, f.state, stale).kind, 'rejected');
  const waiting = f.runtime.step(f.profiles, f.state, room.input);
  assert.equal(waiting.kind, 'awaitingInput', JSON.stringify(waiting));
  const done = f.runtime.step(f.profiles, waiting.state, { kind: 'answerFrozenPlayerChoice', rootActionId: f.rootActionId,
    controllerCharacterId: ACTOR, pendingInputId: lowered.command.plan.pendingInputId, choiceId: 'second' });
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.equal(done.events.filter(e => e.eventType === 'FictionTimeAdvanced').length, 1);
  assert.equal(done.events.filter(e => e.eventType === 'DefinitionRegistered').length, 0);
  assert.equal(f.runtime.replay(f.genesis, [...waiting.events, ...done.events]).kind, 'replayed');
});
