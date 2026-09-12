import assert from 'node:assert/strict';
import test from 'node:test';
import { invokeSubmitKpProposalBundleWithOneCorrection, invokeSubmitKpProposalBundleFirstPass,
  invokeCorrectKpProposalBundle, assertRepairTicket } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { encodeVNextStrictToolBundle, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { synthesizeProposalRevision } from '../app/_runtime/lib/kp/vnext/proposal-revision.ts';
import { proposalFillingDiagnostics } from '../app/_runtime/lib/kp/vnext/proposal-filling-interface.ts';
import { proposalModelContext, vnextProposalContextBody } from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { assertDeepSeekStrictToolModelInput } from '../app/_runtime/lib/kp/deepseek.ts';
import { sharedCheckBundle } from './fixtures/vnext-shared-check.mjs';
import { sentContext, sentInstructions, sentRevision, sentTurns } from './fixtures/vnext-request-layout.mjs';

const context = { intent: { actorRef: 'character:probe-actor', submissionRef: 'submission:revision', text: '倾听并转动阀门。' },
  entries: [], references: { citations: { authorityBasisRefs: [], viewerEvidenceRefs: [], npcKnowledge: [] } },
  binding: { contextHash: 'sha256:revision-context', preparedActionId: 'prepared:revision', rootActionId: 'root:revision' } };
const input = { modelId: 'scripted-test', message: JSON.stringify({ requiredContext: context }),
  requiredContext: context, capabilities: ['observe', 'worldInteraction'], terminalKinds: [] };
const response = (value, name = SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) => ({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{
  type: 'function', function: { name, arguments: typeof value === 'string' ? value : JSON.stringify(value) },
}] } }] });
const wire = () => encodeVNextStrictToolBundle(sharedCheckBundle());
async function revise(original, document, inspect = () => {}) {
  let calls = 0, ticket;
  const before = structuredClone(original);
  const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...input,
    persistRepairTicket(value) { ticket = value; }, binding: { async run(_model, request) {
      assertDeepSeekStrictToolModelInput(request);
      if (++calls === 1) return response(original);
      const body = sentRevision(request);
      assert.deepEqual(sentContext(request).requiredContext, proposalModelContext(context));
      assert.ok(ticket); assert.equal(body.sourceDraftVersion, ticket.sourceDraftVersion);
      assert.equal(body.originalArguments, undefined); assert.equal(body.rejectedBundle, undefined);
      assert.equal(body.diagnostics.every(d => d.pathBase === 'arguments'), true);
      inspect(body, request, ticket);
      return response({ sourceDraftVersion: body.sourceDraftVersion,
        revisionJson: JSON.stringify(typeof document === 'function' ? document(body) : document) }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
    } } });
  assert.deepEqual(original, before, 'no mutation of the source');
  return { result, calls, ticket };
}
const patch = operations => ({ mode: 'patch', operations });
const replace = draft => ({ mode: 'replaceDraft', draft });

test('null or missing ability plus an existing DC can be revised by one small patch', async () => {
  for (const missing of [false, true]) {
    const original = wire(); original.decision.ability = { kind: 'none' };
    if (missing) delete original.decision.ability;
    const { result, calls } = await revise(original, patch([
      { op: missing ? 'add' : 'replace', path: '/decision/ability', value: 'int' },
      { op: 'replace', path: '/decision/skill', value: 'investigation' },
      { op: 'replace', path: '/decision/dc', value: 14 },
    ]), (body, request) => {
      // The draft a round revises is the assistant turn before the ticket.
      assert.equal(body.sourceDraft, 'asReplied'); assert.deepEqual(JSON.parse(sentTurns(request).at(-1).call.function.arguments), original);
      assert.ok(body.diagnostics.some(d => d.path.join('/') === 'decision/ability' && ['FIELD_MISSING', 'TYPE_MISMATCH'].includes(d.code)));
      // The form rides as the first tool for the cached prefix; the correction
      // tool follows it, and the form is no longer copied into the text.
      assert.deepEqual(request.tools.map(t => t.function.name), [SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME]);
      assert.doesNotMatch(sentInstructions(request), /所选填写表单/);
    });
    assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result)); assert.equal(calls, 2);
    assert.equal(result.bundle.adjudication.ability, 'int'); assert.equal(result.bundle.adjudication.dc, 14);
  }
});

test('step insertion requires matching result row indices; the server never renumbers them', async () => {
  const original = wire(); delete original.decision.ability;
  const inserted = structuredClone(original.steps[0]);
  const results = original.results.map(row => ({ ...row, step: row.step + 1 }));
  results.unshift({ ...structuredClone(original.results[0]), step: 0 });
  for (const consistent of [false, true]) {
    const operations = [{ op: 'add', path: '/decision/ability', value: 'wis' }, { op: 'add', path: '/steps/0', value: inserted }];
    if (consistent) operations.push({ op: 'replace', path: '/results', value: results });
    const { result } = await revise(original, patch(operations));
    assert.equal(result.kind, consistent ? 'locallyAccepted' : 'rejected', JSON.stringify(result));
    if (consistent) assert.equal(result.bundle.proposals.length, 4);
  }
});

test('complete replacement, removal of invalid fields, and normal no-revision path', async () => {
  const valid = wire(); let calls = 0;
  const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...input, persistRepairTicket() { assert.fail(); },
    binding: { async run() { calls++; return response(valid); } } });
  assert.equal(result.kind, 'locallyAccepted'); assert.equal(calls, 1);
  const invalid = wire(); delete invalid.results;
  assert.equal((await revise(invalid, replace(valid))).result.kind, 'locallyAccepted');
  const extra = wire(); extra.decision.unexpected = 1;
  assert.equal((await revise(extra, patch([{ op: 'remove', path: '/decision/unexpected' }]))).result.kind, 'locallyAccepted');
});

test('unparseable JSON permits full replacement only and consumes the same one revision', async () => {
  for (const original of ['{"decision":{"risk":"broken"quote"}}', JSON.stringify(wire()).slice(0, -1), JSON.stringify(wire()).slice(0, -1) + ',}']) {
    const { result, calls, ticket } = await revise(original, replace(wire()), body => {
      assert.equal(body.sourceDraft, null); assert.deepEqual(body.allowedModes, ['replaceDraft']);
      assert.ok(body.diagnostics.some(d => d.code === 'JSON_SYNTAX'));
    });
    assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result)); assert.equal(result.repairUsed, true); assert.equal(calls, 2);
    assert.equal(ticket.originalArguments, original);
    assert.equal((await revise(original, patch([]))).result.kind, 'rejected');
  }
});

test('patch operations are atomic, closed, version bound, and cannot access server or prototype paths', () => {
  const source = { sourceDraft: wire(), sourceDraftVersion: 'version:1' }, saved = structuredClone(source);
  for (const operation of [
    { op: 'replace', path: '/decision/missing', value: 1 }, { op: 'add', path: '/steps/01', value: {} },
    { op: 'remove', path: '/steps/999' }, { op: 'add', path: '/steps/-/kind', value: 'observe' },
    { op: 'add', path: '/binding', value: {} }, { op: 'replace', path: '', value: {} },
    { op: 'add', path: '/decision/__proto__/owned', value: true }, { op: 'add', path: '/decision/a~2b', value: 1 },
    { op: 'copy', path: '/decision/ability', from: '/decision/skill' },
  ]) {
    assert.throws(() => synthesizeProposalRevision({ sourceDraftVersion: source.sourceDraftVersion,
      revisionJson: JSON.stringify(patch([{ op: 'replace', path: '/decision/dc', value: 14 }, operation])) }, source));
    assert.deepEqual(source, saved);
  }
  assert.throws(() => synthesizeProposalRevision({ sourceDraftVersion: 'version:wrong', revisionJson: JSON.stringify(replace(wire())) }, source));
  assert.throws(() => synthesizeProposalRevision({ sourceDraftVersion: source.sourceDraftVersion, revisionJson: '{"mode":"patch","mode":"replaceDraft"}' }, source));
  assert.equal({}.owned, undefined);
});

test('a repeated draft ends the conversation at once; a newly exposed error earns another round until the diagnostics repeat', async () => {
  const invalid = wire(); delete invalid.decision.ability; invalid.decision.dc = '14';
  // Replacing the draft with itself is no revision: rejected on the spot.
  const unchanged = await revise(invalid, replace(invalid));
  assert.equal(unchanged.calls, 2); assert.equal(unchanged.result.kind, 'rejected'); assert.equal(unchanged.result.code, 'PROPOSAL_REPAIR_EXHAUSTED');
  assert.ok(unchanged.result.diagnostics.some(d => d.constraint === 'revision:unchanged-draft'));
  // The patch fixes the ability and exposes the dc: a second round is sent
  // with the dc alone diagnosed. The double answers with the same patch,
  // which changes nothing of a draft that already has the ability, so the
  // conversation stops there as an unchanged draft.
  const rounds = [];
  const exposed = await revise(invalid, patch([{ op: 'add', path: '/decision/ability', value: 'wis' }]),
    body => rounds.push([body.round, body.diagnostics.map(d => d.path.at(-1))]));
  assert.deepEqual(rounds, [[1, ['ability']], [2, ['dc']]]);
  assert.equal(exposed.calls, 3); assert.equal(exposed.result.kind, 'rejected'); assert.equal(exposed.result.code, 'PROPOSAL_REPAIR_EXHAUSTED');
  assert.ok(exposed.result.diagnostics.some(d => d.constraint === 'revision:unchanged-draft'));
});

test('saved source versions and contexts are reproved before a revision request can resume', async () => {
  const original = wire(); delete original.decision.ability;
  const first = await invokeSubmitKpProposalBundleFirstPass({ ...input, binding: { async run() { return response(original); } } });
  assert.equal(first.kind, 'repairRequired'); const ticket = first.repairTicket;
  for (const mutate of [t => { t.sourceDraft.decision.dc = 20; }, t => { t.sourceDraftVersion = 'wrong'; },
    t => { t.originalArguments = JSON.stringify(wire()); }, t => { t.diagnostics[0].constraint = 'forged'; }]) {
    const changed = structuredClone(ticket); mutate(changed); const { ticketHash, ...body } = changed; changed.ticketHash = canonicalHash(body);
    assert.throws(() => assertRepairTicket(changed, context.binding.contextHash, context));
  }
  const changedContext = structuredClone(context); changedContext.intent.text = 'other';
  assert.throws(() => assertRepairTicket(ticket, context.binding.contextHash, changedContext));
  const { result } = await invokeCorrectKpProposalBundle({ ...input, repairTicket: ticket, binding: { async run(_model, request) {
    return response({ sourceDraftVersion: sentRevision(request).sourceDraftVersion,
      revisionJson: JSON.stringify(replace(wire())) }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  } } });
  assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result));
});

test('diagnostic mapping follows reordered results and grouped entry records', () => {
  const draft = sharedCheckBundle(), raw = encodeVNextStrictToolBundle(draft);
  raw.results.reverse();
  const d = proposalFillingDiagnostics(draft, [{ code: 'VALUE_INVALID', constraint: 'bad-evidence',
    path: ['proposals', 1, 'branches', 'success', 'sensoryEvidence', 0, 'evidence'], repair: { allowed: true, reason: 'test' } }], raw)[0];
  const index = raw.results.findIndex(row => row.step === 1 && row.branch === 'success');
  assert.deepEqual(d.path, ['results', index, 'entries', 0, 'evidence']);
});

test('the correction request repeats the filling round byte for byte up to the ticket, and a strict form reply replaces the draft', async () => {
  // The provider caches a byte-identical request prefix in rendered order:
  // system, then tools, then user. Everything before the correction's own
  // instructions must therefore equal the filling round exactly.
  const original = wire(); delete original.decision.ability;
  const requests = [];
  const bound = { ...input, message: vnextProposalContextBody(context, [], []) };
  const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...bound, persistRepairTicket() {},
    binding: { async run(_model, request) { assertDeepSeekStrictToolModelInput(request); requests.push(request);
      return requests.length === 1 ? response(original) : response(wire(), SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME); } } });
  assert.equal(requests.length, 2);
  const [filling, correction] = requests;
  assert.equal(JSON.stringify(correction.messages[0]), JSON.stringify(filling.messages[0]), 'same frozen context block');
  assert.equal(JSON.stringify(correction.tools[0]), JSON.stringify(filling.tools[0]), 'same filling form as the first tool');
  assert.deepEqual(correction.tools.map(t => t.function.name), [SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME]);
  // Answered through the form: a complete replacement, schema-enforced by the
  // provider and revalidated here like any replaceDraft.
  assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result));
  assert.equal(result.bundle.adjudication.ability, wire().decision.ability);

  // The same draft sent back through the form is still an unchanged draft.
  const again = await invokeSubmitKpProposalBundleWithOneCorrection({ ...bound, persistRepairTicket() {},
    binding: { async run(_model, request) { return request.tools.length === 1 ? response(original) : response(original, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME); } } });
  assert.equal(again.kind, 'rejected'); assert.equal(again.code, 'PROPOSAL_REPAIR_EXHAUSTED');
  assert.ok(again.diagnostics.some(d => d.constraint === 'revision:unchanged-draft'), JSON.stringify(again.diagnostics.map(d => d.constraint)));
});

test('a complete draft followed by one stray closing delimiter is accepted from the same bytes without a correction call', async () => {
  // Round 104 lost an otherwise valid filling to a single trailing brace.
  let calls = 0;
  const accept = raw => invokeSubmitKpProposalBundleWithOneCorrection({ ...input, persistRepairTicket() { assert.fail('no ticket'); },
    binding: { async run() { calls++; return response(raw); } } });
  const slipped = await accept(JSON.stringify(wire()) + '}');
  assert.equal(slipped.kind, 'locallyAccepted'); assert.equal(calls, 1);
  assert.equal(slipped.bundleHash, (await accept(wire())).bundleHash);
});
