import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { vnextProposalUnparsedArguments, createVNextUnparsedRevisionTicket, createVNextProposalRevisionModelInput,
  invokeSubmitKpProposalBundleFirstPass } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { assertVNextInvocationTransition } from '../app/_runtime/lib/room/vnext-proposal-invocation.ts';
const raw = '{"decision":{"risk":"broken"quote"}}';
const response = (argumentsText, finish_reason = 'tool_calls') => ({ choices: [{ finish_reason, message: { tool_calls: [{ type: 'function',
  function: { name: 'submit_kp_proposal_bundle', arguments: argumentsText } }] } }] });
const f = createAuthoredProbeFixture('unparsed:revision');
const context = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, intentText: '检查周围。' }).context;
const evidence = vnextProposalUnparsedArguments(response(raw));

test('Room admits replacement from saved invalid bytes and rejects edited source, schema, or diagnostics', () => {
  const ticket = createVNextUnparsedRevisionTicket(evidence, context, ['observe'], []);
  const request = createVNextProposalRevisionModelInput(ticket, context);
  const prior = ordinal => ({ status: 'completed', context_hash: context.binding.contextHash, binding_hash: 'binding:test',
    response_json: JSON.stringify(ordinal === 1 ? { choices: [{ message: { tool_calls: [{ type: 'function', function: {
      name: 'offer_kp_proposal_bundle', arguments: '{"requestedCapabilities":["observe"]}' } }] } }] } : response(raw)) });
  const input = { ordinal: 3, contextHash: context.binding.contextHash, bindingHash: 'binding:test', requestHash: 'hash:test', request, repairTicket: ticket };
  assert.doesNotThrow(() => assertVNextInvocationTransition(input, prior, context));
  assert.throws(() => assertVNextInvocationTransition({ ...input, repairTicket: undefined }, prior, context));
  for (const mutate of [r => { r.messages[1].content = '{}'; }, r => { r.tools[0].function.parameters.properties.revisionJson.type = 'number'; },
    r => { r.messages[0].content += 'new instruction'; }]) {
    const altered = structuredClone(request); mutate(altered);
    assert.throws(() => assertVNextInvocationTransition({ ...input, request: altered }, prior, context));
  }
});

test('truncation and duplicate-member policy failures do not gain a replacement call', () => {
  assert.equal(vnextProposalUnparsedArguments(response(raw, 'length')), undefined);
  assert.equal(vnextProposalUnparsedArguments(response('{"decision":{},"decision":{}}')), undefined);
  const noReason = response(raw); delete noReason.choices[0].finish_reason;
  assert.equal(vnextProposalUnparsedArguments(noReason), undefined);
});

test('a parseable empty object receives the same durable revision ticket, with missing-field diagnostics', async () => {
  const result = await invokeSubmitKpProposalBundleFirstPass({ modelId: 'scripted', message: '检查周围。', requiredContext: context,
    capabilities: ['observe'], terminalKinds: [], binding: { async run() { return response('{}'); } } });
  assert.equal(result.kind, 'repairRequired'); assert.deepEqual(result.repairTicket.sourceDraft, {});
  assert.ok(result.repairTicket.diagnostics.some(d => d.code === 'FIELD_MISSING' && d.path[0] === 'decision'));
});
