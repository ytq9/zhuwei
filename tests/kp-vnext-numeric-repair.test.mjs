import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJsonWithNumberTokens, parseJsonWithUniqueMembers, completeJsonObjectSyntaxEvidence, canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { invokeSubmitKpProposalBundleWithOneCorrection, invokeSubmitKpProposalBundleFirstPass, invokeCorrectKpProposalBundle,
  parseSubmitKpProposalBundleCandidateArguments, assertRepairTicket } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME, VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { vnextProposalRepairPlan, applyVNextProposalBundleCorrection } from '../app/_runtime/lib/kp/vnext/proposal-correction.ts';

const request = { modelId: 'scripted-test', message: '按原意图等待。', requiredContext: { entries: [],
  references: { citations: { authorityBasisRefs: [], viewerEvidenceRefs: [], npcKnowledge: [] } }, binding: { contextHash: 'sha256:numeric-repair' } } };
const raw = token => `{"decision":{"kind":"passTime","durationMicros":${token}}}`;
const path = ['terminal', 'durationMicros'];
const response = (value, name = SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) => ({ choices: [{ message: { tool_calls: [
  { type: 'function', function: { name, arguments: value } },
] } }] });
const confirmation = summaries => response(JSON.stringify({ confirm: 'server-plan', summaries }), CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);

async function first(source) {
  return invokeSubmitKpProposalBundleFirstPass({ ...request, binding: { async run() { return response(source); } } });
}

test('the same unique-member parser retains exact numeric lexemes and offsets before rounding', () => {
  const source = '{"decision":{"durationMicros":60000000.000000001},"items":[6e7,15000000]}';
  const parsed = parseJsonWithNumberTokens(source);
  assert.deepEqual(parsed.value, parseJsonWithUniqueMembers(source));
  assert.equal(parsed.value.decision.durationMicros, 60000000);
  assert.deepEqual(parsed.numberTokens.map(token => [token.path, token.raw]), [
    [['decision', 'durationMicros'], '60000000.000000001'], [['items', 0], '6e7'], [['items', 1], '15000000'],
  ]);
  for (const token of parsed.numberTokens) assert.equal(source.slice(token.startOffset, token.endOffset), token.raw);
  assert.ok(Object.isFrozen(parsed.numberTokens[0].path));
  assert.throws(() => parseJsonWithNumberTokens('{"n":1,"n":2}'), /json:duplicate-object-member/);
  assert.throws(() => parseJsonWithNumberTokens('{"n":1'), /json:object-delimiter-expected/);
  assert.equal(completeJsonObjectSyntaxEvidence('{"n":15000000').numberTokens[0].raw, '15000000');
});

for (const token of ['60000000', '15000000']) {
  test(`the exact original integer ${token} is repaired only by one fixed confirmation`, async () => {
    const source = raw(token); let calls = 0, ticket;
    const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...request,
      persistRepairTicket(value) { ticket = value; }, binding: { async run(_model, input) {
        calls++;
        if (calls === 1) return response(source);
        const prompt = JSON.parse(input.messages[1].content);
        assert.equal(prompt.originalArguments, source); assert.equal(prompt.argumentSource, 'rawString');
        assert.deepEqual(prompt.summaryPaths, []); assert.deepEqual(prompt.allowedPaths, [path]);
        assert.deepEqual(prompt.repairPlan, [{ path, operation: 'replace', value: token, reason: 'exact-integer-token-to-string' }]);
        assert.ok(prompt.diagnostics.some(d => d.code === 'TYPE_MISMATCH' && d.repair.allowed));
        return confirmation([]);
      } } });
    assert.equal(calls, 2); assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result));
    assert.equal(result.repairUsed, true); assert.equal(result.bundle.terminal.durationMicros, token);
    assert.equal(ticket.draft.terminal.durationMicros, Number(token)); assert.equal(ticket.originalArguments, source);
    assert.equal(ticket.bundleHash, canonicalHash(ticket.draft)); assertRepairTicket(ticket, request.requiredContext.binding.contextHash);
  });
}

test('missing, rounded, noncanonical, invalid and unavailable numeric source remain rejected without a correction call', async () => {
  const values = ['6e7', '60000000.000000001', '9007199254740992', '-1', '0', '1.5', '60000000.0', '1e0', '1e-9999'];
  const sources = [...values.map(raw), '{"decision":{"kind":"passTime"}}', { decision: { kind: 'passTime', durationMicros: 60000000 } }];
  for (const source of sources) {
    let calls = 0;
    const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...request,
      persistRepairTicket() { assert.fail('no safe representation proof'); }, binding: { async run() { calls++; return response(source); } } });
    assert.equal(result.kind, 'rejected', JSON.stringify(source)); assert.equal(result.repairUsed, false);
    assert.equal(calls, 1); assert.ok(result.diagnostics.every(d => !d.repair.allowed));
  }
});

test('root syntax and exact numeric representation share the same single confirmation budget', async () => {
  const source = raw('15000000').slice(0, -1); let calls = 0;
  const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...request, persistRepairTicket() {},
    binding: { async run() { calls++; return calls === 1 ? response(source) : confirmation([]); } } });
  assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result)); assert.equal(calls, 2);
  assert.equal(result.bundle.terminal.durationMicros, '15000000');
});

test('recovery reproves exact original source even when rounded draft hashes coincide', async () => {
  const begun = await first(raw('60000000')); assert.equal(begun.kind, 'repairRequired');
  for (const mutate of [
    ticket => { ticket.originalArguments = raw('60000000.000000001'); },
    ticket => { ticket.originalArguments = raw('6e7'); },
    ticket => { ticket.originalArguments = raw('15000000'); },
    ticket => { ticket.argumentSource = 'decodedObject'; },
    ticket => { delete ticket.argumentSource; },
    ticket => { ticket.repairPlan[0].value = '15000000'; },
  ]) {
    const ticket = structuredClone(begun.repairTicket); mutate(ticket);
    const { ticketHash: _hash, ...body } = ticket; ticket.ticketHash = canonicalHash(body);
    assert.throws(() => assertRepairTicket(ticket, request.requiredContext.binding.contextHash), /VNEXT_PROPOSAL_REPAIR_TICKET_INVALID/);
  }
  const ticket = structuredClone(begun.repairTicket); let calls = 0;
  const result = await invokeCorrectKpProposalBundle({ ...request, repairTicket: ticket, binding: { async run() {
    calls++; ticket.originalArguments = raw('15000000'); ticket.repairPlan[0].value = '15000000';
    return confirmation([]);
  } } });
  assert.equal(result.kind, 'locallyAccepted'); assert.equal(result.bundle.terminal.durationMicros, '60000000'); assert.equal(calls, 1);
});

test('caller allowlists and correction summaries cannot alter duration or provide missing source evidence', async () => {
  const source = raw('60000000'), candidate = parseSubmitKpProposalBundleCandidateArguments(source);
  assert.equal(candidate.kind, 'locallyRejected'); assert.deepEqual(vnextProposalRepairPlan(candidate.draft), []);
  for (const [originalArguments, value] of [[undefined, '60000000'], [source, '15000000'], [raw('60000000.000000001'), '60000000']]) {
    const result = applyVNextProposalBundleCorrection({ bundle: candidate.draft, allowedPaths: [path],
      ...(originalArguments === undefined ? {} : { originalArguments }), requiredContext: request.requiredContext,
      correction: { schema: VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA, attempt: 1,
        baseBundleHash: candidate.bundleHash, contextHash: request.requiredContext.binding.contextHash, changes: [{ path, value }] } });
    assert.equal(result.kind, 'rejected');
  }
  const begun = await first(source); let calls = 0;
  const result = await invokeCorrectKpProposalBundle({ ...request, repairTicket: begun.repairTicket,
    binding: { async run() { calls++; return confirmation([{ path, value: '15000000' }]); } } });
  assert.equal(result.kind, 'rejected'); assert.equal(result.code, 'PROPOSAL_REPAIR_EXHAUSTED'); assert.equal(calls, 1);
});

test('a numeric token in another field never receives this mechanical representation permission', async () => {
  const source = '{"decision":{"kind":"knowledgeReview","inquiry":15000000,"scope":"allKnown","knowledgeRefs":[]}}';
  const result = await first(source); assert.equal(result.kind, 'rejected'); assert.equal(result.repairUsed, false);
});


test('another mechanical duration field keeps its existing acceptance boundary', async () => {
  const decision = { kind: 'inWorldRefusal', basisRefs: ['scene:known'], intent: '按原方法尝试。', method: '继续原方法。',
    ruling: { kind: 'missingPrerequisite', publicBasis: '缺少已有条件。',
      prerequisites: [{ kind: 'tool', ref: 'none', description: '需要合适工具。' }],
      nextActions: [{ description: '寻找工具。', basisRefs: ['scene:known'] }],
      attemptCosts: [{ kind: 'fictionTime', durationMicros: 15000000 }] } };
  const invalid = await first(JSON.stringify({ decision })); assert.equal(invalid.kind, 'rejected');
  assert.equal(invalid.repairUsed, false);
  decision.ruling.attemptCosts[0].durationMicros = '15000000';
  const valid = await first(JSON.stringify({ decision })); assert.equal(valid.kind, 'locallyAccepted', JSON.stringify(valid));
  assert.equal(valid.repairUsed, false);
});
