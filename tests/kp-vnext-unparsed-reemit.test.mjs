import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_SCENE as SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { encodeVNextStrictToolBundle, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { invokeSubmitKpProposalBundleFirstPass, invokeSubmitKpProposalBundleWithOneCorrection,
  vnextProposalUnparsedArguments, vnextProposalReemitPrompt,
  vnextProposalHasThirdCallBudget } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { assertVNextInvocationTransition } from '../app/_runtime/lib/room/vnext-proposal-invocation.ts';
import { proposalModelContext } from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { createSubmitKpProposalBundleModelInput } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { proposalItemEntryRefs, proposalObservationSubjectRefs, proposalCreatureTargetRefs,
  proposalNpcSourceChoices } from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { requiredContextBasisReferences } from '../app/_runtime/lib/kp/vnext/required-context-runtime.ts';
import { assertDeepSeekStrictToolModelInput } from '../app/_runtime/lib/kp/deepseek.ts';

// Round 74's second call returned arguments with an unescaped ASCII quote
// inside a prose field, so nothing parsed and no draft existed to repair. The
// contract here: exactly one re-emit of the same question, proved from the
// journal, with no server-supplied content -- and never for a draft that did
// parse, because guessing what a malformed decision meant is fabrication.
const NPC = 'npc:reemit:archivist';
function fixture(name) {
  const f = createAuthoredProbeFixture(`reemit:${name}`, { npcCharacters: [{ id: NPC, name: '档案员' }] });
  f.requiredContext = freezeAuthoredProbeContext(f, f.state,
    { rootActionId: f.rootActionId, focusRefs: [NPC], intentText: '我向对方说明来意。' }).context;
  return f;
}
function validBundle() {
  return { mode: 'adjudication', basisRefs: [NPC], terminal: null,
    adjudication: { kind: 'directSuccess', durationMicros: '300000000', risk: '普通交谈。', successOutcome: '作出回应。' },
    proposals: [{ kind: 'social', basisRefs: [NPC], consumes: [], produces: [], outcomeBinding: 'always', sceneRef: SCENE,
      npcRef: NPC, addressedThreadRef: null, goal: '说明来意。', method: '当面交谈。', communication: 'spokenConversation',
      audience: 'participants', retryChange: null,
      branches: { success: { outcomeCode: 'answered', summary: '对方作出回应。',
        response: { kind: 'speech', text: '我听到了。', motive: '回应本人刚听到的话。', basis: [{ kind: 'playerExpression' }] },
        consequences: [] }, failure: null } }] };
}
const toolResponse = (args, finish_reason = 'tool_calls') => ({ choices: [{ finish_reason, message: { tool_calls: [{
  type: 'function', function: { name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: args },
}] } }] });
// Two shapes seen in real batches: round 74's raw quote inside a string, and
// round 64's unterminated string. Neither can be recovered as a root object.
const RAW_QUOTE = '{"decision": {"kind": "directSuccess", "risk": "玩家报号"旅行守卫"，请求半分钟。", "steps": []}}';
const UNTERMINATED = '{"decision": {"kind": "directSuccess", "risk": "对方仍在等待';

test('an unparsed draft is re-emitted once and the server contributes no content', async () => {
  for (const malformed of [RAW_QUOTE, UNTERMINATED]) {
    const f = fixture('accepted'), calls = [];
    const result = await invokeSubmitKpProposalBundleWithOneCorrection({
      modelId: 'test', message: '冻结上下文', requiredContext: f.requiredContext,
      capabilities: ['social'], terminalKinds: [],
      persistRepairTicket: () => assert.fail('an unparsed draft has no ticket to persist'),
      binding: { async run(_model, request) {
        // Hold every stubbed request to the transport contract: a surface the
        // transport refuses never reaches the model, and round 76 proved a
        // green suite can hide exactly that.
        assertDeepSeekStrictToolModelInput(request); calls.push(request);
        return toolResponse(calls.length === 1 ? malformed : JSON.stringify(encodeVNextStrictToolBundle(validBundle())));
      } },
    });
    assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result));
    assert.equal(calls.length, 2);
    assert.equal(result.invocationCount, 2);
    assert.equal(result.repairUsed, false, 'a re-emit carries nothing over, so it is not a repair');

    // The second call asks the same question: same tool surface, and a body
    // that names only where the bytes stopped being JSON.
    assert.deepEqual(calls[1].tools, calls[0].tools);
    const body = JSON.parse(calls[1].messages[1].content);
    assert.deepEqual(Object.keys(body).sort(), ['instruction', 'originalArguments', 'syntaxError']);
    assert.equal(body.originalArguments, malformed);
    assert.equal(typeof body.syntaxError.reason, 'string');
    assert.ok(Number.isSafeInteger(body.syntaxError.location.offset));
    // Nothing from the eventual decision may originate on the server.
    for (const invented of ['social', 'directSuccess', NPC, SCENE, 'answered']) {
      assert.equal(body.instruction.includes(invented), false, `${invented} must not be supplied by the server`);
    }
  }
});

test('an empty-object arguments call is no draft: re-emitted once, and one member makes it a draft again', async () => {
  // Rounds 87 and 89 returned exactly "{}" from the beta strict endpoint with the root required list in place.
  for (const empty of ['{}', '{ }', ' {}\n']) {
    const f = fixture('empty'), calls = [];
    const result = await invokeSubmitKpProposalBundleWithOneCorrection({
      modelId: 'test', message: '冻结上下文', requiredContext: f.requiredContext, capabilities: ['social'], terminalKinds: [],
      persistRepairTicket: () => assert.fail('an empty call has no ticket to persist'),
      binding: { async run(_model, request) {
        assertDeepSeekStrictToolModelInput(request); calls.push(request);
        return toolResponse(calls.length === 1 ? empty : JSON.stringify(encodeVNextStrictToolBundle(validBundle())));
      } },
    });
    assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result));
    assert.equal(calls.length, 2); assert.equal(result.repairUsed, false);
    assert.deepEqual(calls[1].tools, calls[0].tools);
    const body = JSON.parse(calls[1].messages[1].content);
    assert.deepEqual(Object.keys(body).sort(), ['instruction', 'originalArguments', 'syntaxError']);
    assert.equal(body.originalArguments, empty);
    assert.deepEqual(body.syntaxError, { reason: 'json:empty-arguments' });
    for (const invented of ['social', 'directSuccess', NPC, SCENE, 'answered']) assert.equal(body.instruction.includes(invented), false, invented);
    // Room reaches the same conclusion from the saved bytes.
    const evidence = vnextProposalUnparsedArguments(toolResponse(empty));
    assert.equal(evidence.diagnostic.constraint, 'json:empty-arguments'); assert.equal(evidence.diagnostic.location, undefined);
  }
  // One member, however wrong, is a draft the validator must diagnose; an empty array is not an object at all.
  for (const draft of ['{"decision":{}}', '{"steps":[]}', '[]', 'null']) assert.equal(vnextProposalUnparsedArguments(toolResponse(draft)), undefined, draft);
});

test('a draft that parsed is never re-emitted, and a recoverable root issue keeps its repair ticket', async () => {
  const f = fixture('parsed');
  // Content-rejected but syntactically fine: this is a repair ticket's business.
  const rejected = encodeVNextStrictToolBundle({ ...validBundle(), basisRefs: ['definition:not-authorized'] });
  const first = await invokeSubmitKpProposalBundleFirstPass({
    modelId: 'test', message: '冻结上下文', requiredContext: f.requiredContext, capabilities: ['social'], terminalKinds: [],
    binding: { async run(_model, request) { assertDeepSeekStrictToolModelInput(request); return toolResponse(JSON.stringify(rejected)); } },
  });
  assert.notEqual(first.kind, 'reemitRequired');
  assert.equal(vnextProposalUnparsedArguments(toolResponse(JSON.stringify(rejected))), undefined);

  // A trailing comma at the root is recoverable as a complete object, so the
  // existing syntax-evidence repair still owns it.
  const trailing = JSON.stringify(encodeVNextStrictToolBundle(validBundle())).replace(/\}$/, ',}');
  assert.equal(vnextProposalUnparsedArguments(toolResponse(trailing)), undefined);
});

test('Room proves the third call from the saved response, not from the caller', () => {
  const f = fixture('room'), message = JSON.stringify({ requiredContext: proposalModelContext(f.requiredContext) });
  const unparsed = vnextProposalUnparsedArguments(toolResponse(RAW_QUOTE));
  assert.ok(unparsed, 'the saved response is provably unparsed');
  const surface = body => createSubmitKpProposalBundleModelInput(body, ['social'],
    proposalItemEntryRefs(f.requiredContext), proposalObservationSubjectRefs(f.requiredContext), [],
    proposalNpcSourceChoices(f.requiredContext), requiredContextBasisReferences(f.requiredContext),
    proposalCreatureTargetRefs(f.requiredContext));
  const saved = (ordinal, response) => ({ status: 'completed', context_hash: f.requiredContext.binding.contextHash,
    binding_hash: 'sha256:fixture', response_json: JSON.stringify(response) });
  const prior = ordinal => ordinal === 1
    ? saved(1, { choices: [{ message: { tool_calls: [{ type: 'function', function: {
        name: 'offer_kp_proposal_bundle', arguments: JSON.stringify({ requestedCapabilities: ['social'] }) } }] } }] })
    : saved(2, toolResponse(RAW_QUOTE));
  const request = surface(vnextProposalReemitPrompt(unparsed));
  const input = { ordinal: 3, contextHash: f.requiredContext.binding.contextHash,
    bindingHash: 'sha256:fixture', requestHash: 'sha256:fixture', request };
  assert.doesNotThrow(() => assertVNextInvocationTransition(input, prior, f.requiredContext));

  // A ticket cannot accompany a re-emit: no draft ever existed.
  assert.throws(() => assertVNextInvocationTransition({ ...input, repairTicket: { schema: 'x' } }, prior, f.requiredContext), /PROPOSAL_REPAIR_EXHAUSTED/);
  // The body is pinned: neither a plain context body nor an edited diagnostic passes.
  for (const body of [message, vnextProposalReemitPrompt({ ...unparsed, originalArguments: '{"decision":{}}' })]) {
    assert.throws(() => assertVNextInvocationTransition({ ...input, request: surface(body) }, prior, f.requiredContext), /PROPOSAL_REPAIR_EXHAUSTED/);
  }
});

test('a re-emit needs positive evidence that the model finished on its own', () => {
  // All three malformed drafts seen in real batches finished normally, so this
  // guard changes none of them; it refuses to spend a call where one cannot help.
  assert.ok(vnextProposalUnparsedArguments(toolResponse(RAW_QUOTE, 'tool_calls')));
  assert.ok(vnextProposalUnparsedArguments(toolResponse(RAW_QUOTE, 'stop')));
  assert.equal(vnextProposalUnparsedArguments(toolResponse(RAW_QUOTE, 'length')), undefined,
    'output that hit the token cap would hit it again');
  const noReason = { choices: [{ message: { tool_calls: [{ type: 'function', function: {
    name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: RAW_QUOTE } }] } }] };
  assert.equal(vnextProposalUnparsedArguments(noReason), undefined, 'an undocumented envelope fails closed');
});

test('a terminal-only selection has no third call, so an unparsed draft fails closed', () => {
  assert.equal(vnextProposalHasThirdCallBudget(['abilityOperation']), false);
  assert.equal(vnextProposalHasThirdCallBudget(['social']), true);
  assert.equal(vnextProposalHasThirdCallBudget(['abilityOperation', 'social']), true);
});
