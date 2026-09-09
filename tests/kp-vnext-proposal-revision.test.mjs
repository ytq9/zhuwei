import assert from 'node:assert/strict';
import test from 'node:test';
import { invokeSubmitKpProposalBundleWithOneCorrection, invokeSubmitKpProposalBundleFirstPass,
  invokeCorrectKpProposalBundle, assertRepairTicket } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { encodeVNextStrictToolBundle, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { synthesizeProposalRevision } from '../app/_runtime/lib/kp/vnext/proposal-revision.ts';
import { proposalFillingDiagnostics } from '../app/_runtime/lib/kp/vnext/proposal-filling-interface.ts';
import { proposalModelContext } from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { assertDeepSeekStrictToolModelInput } from '../app/_runtime/lib/kp/deepseek.ts';
import { sharedCheckBundle } from './fixtures/vnext-shared-check.mjs';

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
      const body = JSON.parse(request.messages[1].content);
      assert.deepEqual(body.requiredContext, proposalModelContext(context));
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
      assert.deepEqual(body.sourceDraft, original);
      assert.ok(body.diagnostics.some(d => d.path.join('/') === 'decision/ability' && ['FIELD_MISSING', 'TYPE_MISMATCH'].includes(d.code)));
      assert.ok(JSON.stringify(request.tools).length < 1500, 'patch schema stays small');
      assert.match(request.messages[0].content, /所选填写表单/);
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

test('repeated draft and a newly exposed error stop at the existing single revision limit', async () => {
  const invalid = wire(); delete invalid.decision.ability; invalid.decision.dc = '14';
  for (const document of [replace(invalid), patch([{ op: 'add', path: '/decision/ability', value: 'wis' }])]) {
    const { result, calls } = await revise(invalid, document);
    assert.equal(calls, 2); assert.equal(result.kind, 'rejected'); assert.equal(result.code, 'PROPOSAL_REPAIR_EXHAUSTED');
    assert.ok(result.diagnostics.some(d => d.constraint === 'revision:unchanged-draft' || d.path.at(-1) === 'dc'));
  }
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
  const result = await invokeCorrectKpProposalBundle({ ...input, repairTicket: ticket, binding: { async run(_model, request) {
    return response({ sourceDraftVersion: JSON.parse(request.messages[1].content).sourceDraftVersion,
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
