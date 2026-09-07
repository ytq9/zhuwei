import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeVNextStrictToolBundle, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA, VNEXT_PROPOSAL_PLAN_CONFIRMATION_PROTOCOL } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { invokeSubmitKpProposalBundleWithOneCorrection, invokeSubmitKpProposalBundleFirstPass, invokeCorrectKpProposalBundle, parseSubmitKpProposalBundleCandidateArguments,
  parseCorrectKpProposalBundleResponse, assertRepairTicket } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { assertDeepSeekStrictToolModelInput } from '../app/_runtime/lib/kp/deepseek.ts';
import { matchesAuthoredSourceSchema } from '../app/_runtime/lib/rules/v2/authored-materialization.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { sharedCheckBundle } from './fixtures/vnext-shared-check.mjs';
const binding = { baseBundleHash: 'sha256:plan-test', contextHash: 'sha256:plan-context' };
const request = { modelId: 'scripted-test', message: '冻结原意图。', requiredContext: { entries: [], references: { citations: { authorityBasisRefs: [], viewerEvidenceRefs: [], npcKnowledge: [] } }, binding: { contextHash: binding.contextHash } } };
const goodSummary = { path: ['proposals', 1, 'branches', 'success', 'summary'], value: '听清了压力变化。' };
const secondSummary = { path: ['proposals', 1, 'branches', 'failure', 'summary'], value: '声音模糊，未能分辨压力变化。' };
function response(value, name = SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) {
  return { choices: [{ message: { tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(value) } }] } }] };
}
function fixture(summaries = true) {
  const original = sharedCheckBundle(), wire = encodeVNextStrictToolBundle(structuredClone(original));
  wire.decision.risk = ` ${wire.decision.risk} `;
  wire.decision.steps[1].method = ` ${wire.decision.steps[1].method} `;
  if (summaries) {
    wire.decision.steps[1].success.summary = '';
    wire.decision.steps[1].failure.summary = '';
  }
  return { original, wire };
}
async function invoke(wire, answer) {
  let calls = 0, ticket;
  const before = structuredClone(wire);
  const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...request,
    persistRepairTicket(value) { ticket = value; }, binding: { async run(_model, input) {
      calls++;
      if (calls === 1) return response(wire);
      assertDeepSeekStrictToolModelInput(input);
      const prompt = JSON.parse(input.messages[1].content);
      assert.equal(prompt.responseProtocol, VNEXT_PROPOSAL_PLAN_CONFIRMATION_PROTOCOL);
      assert.deepEqual(prompt.summaryPaths, ticket.repairPlan.filter(change => !Object.hasOwn(change, 'value')).map(change => change.path));
      assert.deepEqual(prompt.rejectedBundle, ticket.draft);
      assert.equal(prompt.originalArguments, JSON.stringify(before));
      assert.deepEqual(prompt.diagnostics, ticket.diagnostics);
      assert.deepEqual(prompt.repairPlan, ticket.repairPlan);
      assert.deepEqual(prompt.allowedPaths, ticket.allowedPaths);
      return response(typeof answer === 'function' ? answer(prompt) : answer, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
    } } });
  assert.equal(calls, 2); assert.deepEqual(wire, before);
  assert.equal(ticket.originalArguments, JSON.stringify(before));
  assert.deepEqual(JSON.parse(ticket.originalArguments), before);
  return { result, ticket };
}

test('one explicit confirmation executes all fixed repairs while only complete free summaries are supplied', async () => {
  for (const free of [false, true]) {
    const { original, wire } = fixture(free);
    const answer = { confirm: 'server-plan', summaries: free ? [secondSummary, goodSummary] : [] };
    assert.equal(matchesAuthoredSourceSchema(answer, CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA), true);
    const { result, ticket } = await invoke(wire, answer);
    assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result));
    assert.equal(result.invocationCount, 2);
    assert.deepEqual(result.bundle, parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(original))).bundle);
    assert.equal(ticket.repairPlan.length, free ? 4 : 2);
    assert.ok(ticket.repairPlan.some(change => JSON.stringify(change.path) === JSON.stringify(['adjudication', 'risk'])));
    assert.ok(ticket.repairPlan.some(change => JSON.stringify(change.path) === JSON.stringify(['proposals', 1, 'method'])));
    assert.ok(ticket.diagnostics.filter(d => d.repair.changes?.some(change => !Object.hasOwn(change, 'value')))
      .every(d => d.repair.reason === 'presentation-summary-only'));
  }
});

test('confirmation rejects missing, duplicate, fixed and unauthorized summary paths without inventing omitted inputs', async () => {
  for (const [name, summaries, expectedPath] of [
    ['missing one free summary', [goodSummary], secondSummary.path],
    ['missing all free summaries', [], goodSummary.path],
    ['duplicate free summary', [goodSummary, goodSummary, secondSummary], goodSummary.path],
    ['fixed risk cannot be edited as summary', [goodSummary, secondSummary, { path: ['adjudication', 'risk'], value: '没有风险。' }], ['adjudication', 'risk']],
    ['DC cannot be supplied', [goodSummary, secondSummary, { path: ['adjudication', 'dc'], value: '1' }], ['adjudication', 'dc']],
    ['target cannot be supplied', [goodSummary, secondSummary, { path: ['proposals', 1, 'focusRefs'], value: '["definition:different"]' }], ['proposals', 1, 'focusRefs']],
    ['failure consequences cannot be supplied', [goodSummary, secondSummary, { path: ['adjudication', 'failureOutcome'], value: '没有后果。' }], ['adjudication', 'failureOutcome']],
    ['resource costs cannot be supplied', [goodSummary, secondSummary, { path: ['proposals', 1, 'costs'], value: '[]' }], ['proposals', 1, 'costs']],
    ['wire declaration cannot be supplied', [goodSummary, secondSummary, { path: ['proposals', 1, 'produces'], value: 'none' }], ['proposals', 1, 'produces']],
    ['foreign summary cannot be supplied', [goodSummary, secondSummary, { path: ['proposals', 999, 'summary'], value: '新增结果。' }], ['proposals', 999, 'summary']],
  ]) {
    const { result } = await invoke(fixture().wire, { confirm: 'server-plan', summaries });
    assert.equal(result.kind, 'rejected', name);
    assert.equal(result.code, 'PROPOSAL_REPAIR_EXHAUSTED');
    assert.ok(result.diagnostics.some(d => JSON.stringify(d.path) === JSON.stringify(expectedPath)), `${name}: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.diagnostics.every(d => !d.repair.allowed));
  }
});

test('the new closed response never silently upgrades legacy or partial confirmation envelopes', async () => {
  for (const answer of [
    { changes: [] }, { changes: [{ path: ['terminal'], value: { kind: 'none' } }] },
    { summaries: [] }, { confirm: 'server-plan' }, { confirm: true, summaries: [] },
    { confirm: 'approved', summaries: [] }, { confirm: 'server-plan', summaries: [], changes: [] },
    { confirm: 'server-plan', summaries: [{ path: goodSummary.path, value: null }] },
    { confirm: 'server-plan', summaries: [{ ...goodSummary, operation: 'replace' }] },
    { confirm: 'server-plan', summaries: Array.from({ length: 9 }, () => goodSummary) },
  ]) {
    const { result } = await invoke(fixture(false).wire, answer);
    assert.equal(result.kind, 'rejected', JSON.stringify(answer));
    assert.equal(result.code, 'PROPOSAL_REPAIR_EXHAUSTED');
    assert.ok(result.diagnostics.length > 0); assert.ok(result.diagnostics.every(d => !d.repair.allowed));
    // The provider dialect has no array maximum; the parser enforces the ninth-row refusal.
    assert.equal(matchesAuthoredSourceSchema(answer, CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA),
      Array.isArray(answer.summaries) && answer.summaries.length === 9);
  }
});

test('confirmed free text still passes the original full validator and unique canonical JSON parser', async () => {
  const { result } = await invoke(fixture().wire, { confirm: 'server-plan', summaries: [{ ...goodSummary, value: '' }, secondSummary] });
  assert.equal(result.kind, 'rejected');
  assert.ok(result.diagnostics.some(d => JSON.stringify(d.path) === JSON.stringify(goodSummary.path)), JSON.stringify(result));
  for (const raw of [
    '{"confirm":"server-plan","confirm":"server-plan","summaries":[]}',
    '{"confirm":"server-plan","summaries":[],"summaries":[]}',
    '{"confirm":"server-plan","summaries":[{"path":["proposals",1,"summary"],"value":"a","value":"b"}]}',
    '{"confirm":"server-plan","summaries":[}',
  ]) {
    const envelope = response(null, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
    envelope.choices[0].message.tool_calls[0].function.arguments = raw;
    assert.throws(() => parseCorrectKpProposalBundleResponse(envelope, binding), error => error.diagnostics.some(d => d.code === 'JSON_SYNTAX' && d.location !== undefined));
  }
});

test('the confirmed plan uses the immutable ticket sent to the model even if the caller mutates its deserialized copy', async () => {
  const { wire } = fixture(false);
  const begun = await invokeSubmitKpProposalBundleFirstPass({ ...request, binding: { async run() { return response(wire); } } });
  assert.equal(begun.kind, 'repairRequired');
  const ticket = structuredClone(begun.repairTicket);
  let calls = 0;
  const result = await invokeCorrectKpProposalBundle({ ...request, repairTicket: ticket, binding: { async run(_model, input) {
    calls++;
    const sent = JSON.parse(input.messages[1].content);
    assert.equal(sent.rejectedBundle.adjudication.dc, 12);
    ticket.draft.adjudication.dc = 1;
    const originalArguments = JSON.parse(ticket.originalArguments);
    originalArguments.decision.dc = 1;
    ticket.originalArguments = JSON.stringify(originalArguments);
    ticket.bundleHash = canonicalHash(ticket.draft);
    return response({ confirm: 'server-plan', summaries: [] }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  } } });
  assert.equal(calls, 1);
  assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result));
  assert.equal(result.bundle.adjudication.dc, 12);
});


test('original arguments, frozen context and plan are re-proved even after an altered ticket is rehashed', async () => {
  const { wire } = fixture(false);
  const begun = await invokeSubmitKpProposalBundleFirstPass({ ...request, binding: { async run() { return response(wire); } } });
  assert.equal(begun.kind, 'repairRequired');
  assertRepairTicket(begun.repairTicket, binding.contextHash);
  for (const mutate of [
    ticket => { const raw = JSON.parse(ticket.originalArguments); raw.decision.dc = 1; ticket.originalArguments = JSON.stringify(raw); },
    ticket => { const raw = JSON.parse(ticket.originalArguments); raw.decision.steps[1].focusRefs = ['definition:replacement']; ticket.originalArguments = JSON.stringify(raw); },
    ticket => { ticket.draft.adjudication.dc = 1; ticket.bundleHash = canonicalHash(ticket.draft); },
    ticket => { ticket.draft.proposals[1].focusRefs = ['definition:replacement']; ticket.bundleHash = canonicalHash(ticket.draft); },
    ticket => { ticket.repairPlan[0].path = ['adjudication', 'dc']; },
    ticket => { ticket.allowedPaths.push(['adjudication', 'dc']); },
    ticket => { ticket.contextHash = 'sha256:foreign-context'; },
  ]) {
    const ticket = structuredClone(begun.repairTicket); mutate(ticket);
    const { ticketHash: _hash, ...body } = ticket; ticket.ticketHash = canonicalHash(body);
    assert.throws(() => assertRepairTicket(ticket, binding.contextHash), /TICKET_INVALID/);
  }
});
