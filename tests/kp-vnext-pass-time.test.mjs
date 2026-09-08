import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSubmitKpProposalBundleCandidateArguments, invokeSubmitKpProposalBundleWithOneCorrection } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { encodeVNextStrictToolBundle, SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA,
  SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { vnextProposalRepairPlan, applyVNextProposalBundleCorrection } from '../app/_runtime/lib/kp/vnext/proposal-correction.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { deepSeekStrictToolSchemaIssues } from '../app/_runtime/lib/kp/deepseek-strict-tool.ts';
import { expandDeepSeekSchema } from './fixtures/expand-deepseek-schema.mjs';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE } from '../app/_runtime/lib/kp/vnext/room-bridge.ts';

// A terminal decision still sends the two empty tables of the three-table wire.
const wire = durationMicros => ({ decision: { kind: 'passTime', durationMicros }, steps: [], results: [] });
const candidate = value => parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(value));
const clone = value => JSON.parse(JSON.stringify(value));
const request = { modelId: 'scripted-local', message: '保留原时间决定。', requiredContext: { entries: [],
  references: { citations: { authorityBasisRefs: [], viewerEvidenceRefs: [], npcKnowledge: [] } }, binding: { contextHash: 'sha256:pass-time-test' } } };

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

test('missing, invalid or additional time decisions cannot be repaired into a different ruling', async () => {
  for (const value of [
    { decision: { kind: 'passTime' } }, wire('0'), wire('-1'), wire('1.5'), wire('9007199254740992'),
    { decision: { kind: 'passTime', durationMicros: '60000000', steps: [] } },
    { decision: { kind: 'passTime', durationMicros: '60000000', basisRefs: [] } },
    { decision: { kind: 'passTime', durationMicros: '60000000', sensoryEvidence: ['未来发生的声音。'] } },
    { decision: { kind: 'passTime', durationMicros: '60000000', actorCharacterId: 'another:actor' } },
  ]) {
    const original = clone(value); let calls = 0;
    const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...request,
      persistRepairTicket() { assert.fail('a missing time decision is not a formatting repair'); },
      binding: { async run() { calls++; return { choices: [{ message: { tool_calls: [{ type: 'function', function: {
        name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: JSON.stringify(value),
      } }] } }] }; } },
    });
    assert.equal(result.kind, 'rejected'); assert.equal(calls, 1); assert.equal(result.repairUsed, false);
    assert.ok(result.diagnostics.length > 0); assert.ok(result.diagnostics.every(d => d.repair.allowed === false));
    assert.deepEqual(value, original);
  }
});

test('a repair caller cannot grant itself permission to change duration or append prewritten results', () => {
  const parsed = candidate(wire('60000000')); assert.equal(parsed.kind, 'accepted');
  assert.deepEqual(vnextProposalRepairPlan(parsed.bundle), []);
  for (const [path, value] of [[['terminal', 'durationMicros'], '1000000'], [['proposals'], [{ kind: 'observe' }]]]) {
    const repaired = applyVNextProposalBundleCorrection({ bundle: parsed.bundle, requiredContext: request.requiredContext,
      allowedPaths: [path], correction: { schema: VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA, attempt: 1,
        baseBundleHash: canonicalHash(parsed.bundle), contextHash: request.requiredContext.binding.contextHash,
        changes: [{ path, value }] } });
    assert.equal(repaired.kind, 'rejected');
    assert.deepEqual(repaired.issues, ['correction:allowlist-not-proven']);
  }
});
