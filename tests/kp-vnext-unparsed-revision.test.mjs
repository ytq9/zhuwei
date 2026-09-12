import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { vnextProposalUnparsedArguments, createVNextUnparsedRevisionTicket, createVNextProposalRevisionModelInput,
  invokeSubmitKpProposalBundleFirstPass } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { assertVNextInvocationTransition } from '../app/_runtime/lib/room/vnext-proposal-invocation.ts';
import { sentContextBody } from './fixtures/vnext-request-layout.mjs';
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
  for (const mutate of [r => { r.messages[0].content = '{}'; }, r => { r.tools.find(t => t.function.name === 'correct_kp_proposal_bundle').function.parameters.properties.revisionJson.type = 'number'; },
    r => { r.messages[1].content += 'new instruction'; }]) {
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

test('an empty object re-sends the original filling request once, and a full reply then fills the proposal', async () => {
  const { createVNextProposalRevisionModelInput, evaluateVNextProposalRevisionResponse, vnextProposalTicketIsEmptyDraft } = await import('../app/_runtime/lib/kp/vnext/proposal-provider.ts');
  const { createSubmitKpProposalBundleModelInput } = await import('../app/_runtime/lib/kp/vnext/proposal-schema.ts');
  const { proposalModelContext, proposalItemEntryRefs, proposalObservationSubjectRefs, proposalNpcSourceChoices, proposalCreatureTargetRefs, proposalItemDefinitionRefs } = await import('../app/_runtime/lib/kp/vnext/proposal-context.ts');
  const { requiredContextBasisReferences } = await import('../app/_runtime/lib/kp/vnext/required-context-runtime.ts');
  const result = await invokeSubmitKpProposalBundleFirstPass({ modelId: 'scripted', message: '检查周围。', requiredContext: context,
    capabilities: ['observe'], terminalKinds: [], binding: { async run() { return response('{}'); } } });
  assert.equal(result.kind, 'repairRequired'); assert.equal(vnextProposalTicketIsEmptyDraft(result.repairTicket), true);
  const reemit = createVNextProposalRevisionModelInput(result.repairTicket, context);
  assert.deepEqual(reemit.tools.map(tool => tool.function.name), ['submit_kp_proposal_bundle']);
  assert.equal(sentContextBody(reemit), JSON.stringify({ requiredContext: proposalModelContext(context) }));
  assert.deepEqual(reemit, createSubmitKpProposalBundleModelInput(sentContextBody(reemit), ['observe'], proposalItemEntryRefs(context), proposalObservationSubjectRefs(context), [],
    proposalNpcSourceChoices(context), requiredContextBasisReferences(context), proposalCreatureTargetRefs(context), false, proposalItemDefinitionRefs(context)));
  const again = evaluateVNextProposalRevisionResponse(response('{}'), result.repairTicket);
  assert.equal(again.result.kind, 'rejected'); assert.equal(again.result.code, 'PROPOSAL_REPAIR_EXHAUSTED'); assert.equal(again.synthesis, undefined);
});

test('a complete object before trailing closing delimiters decodes on both sides; other trailing content stays unparsed', async () => {
  const { vnextProposalTicketIsEmptyDraft } = await import('../app/_runtime/lib/kp/vnext/proposal-provider.ts');
  const offer = { choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'offer_kp_proposal_bundle', arguments: '{"requestedCapabilities":["observe"]}' } }] } }] };
  for (const slipped of ['{}}', '{} ]\n}', '{}\n}}']) {
    assert.equal(vnextProposalUnparsedArguments(response(slipped)), undefined, slipped);
    const result = await invokeSubmitKpProposalBundleFirstPass({ modelId: 'scripted', message: '检查周围。', requiredContext: context,
      capabilities: ['observe'], terminalKinds: [], binding: { async run() { return response(slipped); } } });
    assert.equal(result.kind, 'repairRequired'); assert.deepEqual(result.repairTicket.sourceDraft, {});
    assert.equal(result.repairTicket.originalArguments, slipped); assert.equal(vnextProposalTicketIsEmptyDraft(result.repairTicket), true);
    const request = createVNextProposalRevisionModelInput(result.repairTicket, context);
    const prior = ordinal => ({ status: 'completed', context_hash: context.binding.contextHash, binding_hash: 'binding:test',
      response_json: JSON.stringify(ordinal === 1 ? offer : response(slipped)) });
    assert.doesNotThrow(() => assertVNextInvocationTransition({ ordinal: 3, contextHash: context.binding.contextHash, bindingHash: 'binding:test',
      requestHash: 'hash:test', request, repairTicket: result.repairTicket }, prior, context), slipped);
  }
  for (const trailing of ['{} false', '{}} x', '{"decision":1]}', '[]]']) {
    assert.notEqual(vnextProposalUnparsedArguments(response(trailing)), undefined, trailing);
  }
});

test('a reply of two tool calls is a permanent form failure, never a provider timeout to retry', async () => {
  // Round 111: the filling came back as two complete alternative form calls.
  const two = response('{}'); two.choices[0].message.tool_calls.push(structuredClone(two.choices[0].message.tool_calls[0]));
  const result = await invokeSubmitKpProposalBundleFirstPass({ modelId: 'scripted', message: '检查周围。', requiredContext: context,
    capabilities: ['observe'], terminalKinds: [], binding: { async run() { return two; } } });
  assert.equal(result.kind, 'rejected'); assert.equal(result.code, 'PROPOSAL_FORM_INVALID');
  assert.deepEqual(result.issues, ['tool-response:exactly-one-call-required']);
  assert.equal(vnextProposalUnparsedArguments(two), undefined);
});
