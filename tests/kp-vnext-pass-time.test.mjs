import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSubmitKpProposalBundleCandidateArguments } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { encodeVNextStrictToolBundle, SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';

import { deepSeekStrictToolSchemaIssues } from '../app/_runtime/lib/kp/deepseek-strict-tool.ts';
import { expandDeepSeekSchema } from './fixtures/expand-deepseek-schema.mjs';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE } from '../app/_runtime/lib/kp/vnext/room-bridge.ts';

// A terminal decision still sends the two empty tables of the three-table wire.
const wire = durationMicros => ({ decision: { kind: 'passTime', durationMicros }, steps: [], results: [] });
const candidate = value => parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(value));
const clone = value => JSON.parse(JSON.stringify(value));

for (const [durationMicros, intent] of [['60000000', '我留在原地安静等待，留意周围。'], ['15000000', '我停留片刻，保持守望。']]) {
  test(`passTime ${durationMicros} derives one Activity command from the same minimal filling contract`, () => {
    const parsed = candidate(wire(durationMicros));
    assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
    assert.equal(parsed.bundle.mode, 'terminal'); assert.deepEqual(parsed.bundle.proposals, []);
    assert.deepEqual(parsed.bundle.basisRefs, []); assert.equal(parsed.bundle.adjudication, null);
    assert.deepEqual(parsed.bundle.terminal, { kind: 'passTime', durationMicros });
    assert.deepEqual(encodeVNextStrictToolBundle(parsed.bundle), wire(durationMicros));
    const fixture = createAuthoredProbeFixture('pass-time-'+durationMicros);
    const context = freezeAuthoredProbeContext(fixture, fixture.state,
      { rootActionId: fixture.rootActionId, intentText: intent, focusRefs: [] }).context;
    const lowered = lowerVNext2ProposalBundle({ ...fixture, value: parsed.bundle, requiredContext: context });
    assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
    const input = lowered.command.rulesInput;
    assert.equal(input.kind, 'startTimePassage'); assert.equal(input.actorCharacterId, context.intent.actorRef);
    assert.equal(input.rootActionId, fixture.rootActionId); assert.equal(input.plan.method, intent);
    assert.equal(input.plan.intendedDurationMicros, durationMicros);
    assert.equal(input.plan.activityId, 'activity:time-passage:'+fixture.rootActionId);
    assert.deepEqual(VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE.validateReadSet({ profiles: fixture.profiles,
      state: fixture.state, requiredContext: context, rulesInput: input }), { kind: 'valid' });
    const result = fixture.runtime.step(fixture.profiles, fixture.state, input);
    assert.equal(result.kind, 'committed', JSON.stringify(result));
    assert.equal(result.state.campaignRuntime.activities[input.plan.activityId].status, 'active');
    assert.deepEqual(result.state.knowledge, fixture.state.knowledge, 'beginning a wait cannot author future observations');
    assert.deepEqual(result.state.fictionTimelines, fixture.state.fictionTimelines, 'start commits no elapsed time');
  });
}

test('passTime is always present in the actual strict tool schema without a redundant decision or outcome shell', () => {
  assert.deepEqual(deepSeekStrictToolSchemaIssues(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA), []);
  const schema = expandDeepSeekSchema(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA);
  const variant = schema.properties.decision.anyOf.find(v => v.properties.kind.enum.includes('passTime'));
  assert.ok(variant);
  assert.deepEqual(Object.keys(variant.properties).sort(), ['durationMicros', 'kind']);
});

test('passTime refuses an unfrozen timeline and detects authority changes before Activity submission', () => {
  const fixture = createAuthoredProbeFixture('pass-time-read-set');
  const context = freezeAuthoredProbeContext(fixture, fixture.state,
    { rootActionId: fixture.rootActionId, intentText: '我在原地等候十五秒。', focusRefs: [] }).context;
  const parsed = candidate(wire('15000000')); assert.equal(parsed.kind, 'accepted');
  const timelineRef = 'character-timeline:' + context.intent.actorRef;
  assert.ok(context.entries.some(entry => entry.entryRef === timelineRef));
  const missing = { ...context, entries: context.entries.filter(entry => entry.entryRef !== timelineRef) };
  const rejected = lowerVNext2ProposalBundle({ ...fixture, value: parsed.bundle, requiredContext: missing });
  assert.equal(rejected.kind, 'rejected', JSON.stringify(rejected));
  const lowered = lowerVNext2ProposalBundle({ ...fixture, value: parsed.bundle, requiredContext: context });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  const changed = clone(fixture.state);
  changed.entities[context.intent.actorRef].name += '（已变更）';
  const checked = VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE.validateReadSet({ profiles: fixture.profiles,
    state: changed, requiredContext: context, rulesInput: lowered.command.rulesInput });
  assert.equal(checked.kind, 'conflict', JSON.stringify(checked));
  assert.ok(checked.changedRefs.includes(context.intent.actorRef));
  assert.equal(fixture.runtime.step(fixture.profiles, changed, lowered.command.rulesInput).kind, 'rejected');
  assert.equal(Object.keys(changed.campaignRuntime.activities).length, Object.keys(fixture.state.campaignRuntime.activities).length);
});
