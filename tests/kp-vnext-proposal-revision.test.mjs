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
import { decodedIndex, reordered } from './fixtures/vnext-wire-tables.mjs';
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

test('a step is inserted under its own group; the same step under another group is that group\'s kind and fails', async () => {
  const original = wire(); delete original.decision.ability;
  const inserted = structuredClone(original.steps.worldInteraction[0]);
  for (const group of ['worldInteraction', 'observe']) {
    const operations = [{ op: 'add', path: '/decision/ability', value: 'wis' }, { op: 'add', path: `/steps/${group}/0`, value: inserted }];
    const { result } = await revise(original, patch(operations));
    assert.equal(result.kind, group === 'worldInteraction' ? 'locallyAccepted' : 'rejected', JSON.stringify(result));
    if (group === 'worldInteraction') assert.equal(result.bundle.proposals.length, 4);
  }
});

test('complete replacement, removal of invalid fields, and normal no-revision path', async () => {
  const valid = wire(); let calls = 0;
  const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...input, persistRepairTicket() { assert.fail(); },
    binding: { async run() { calls++; return response(valid); } } });
  assert.equal(result.kind, 'locallyAccepted'); assert.equal(calls, 1);
  const invalid = wire(); delete invalid.steps;
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

test('an unparsed filling accepts a direct replacement but never unwraps an arguments string', async () => {
  // SPEC 0016 §7.2: reproduce the preview's malformed filling -> wrapped
  // replacement without repairing bytes or turning a rejected reply into effects.
  const original = JSON.stringify(wire()).slice(0, -1);
  const first = await invokeSubmitKpProposalBundleFirstPass({ ...input,
    binding: { async run() { return response(original); } } });
  assert.equal(first.kind, 'repairRequired');
  const saved = structuredClone(first.repairTicket);
  const normal = await invokeSubmitKpProposalBundleFirstPass({ ...input,
    binding: { async run() { return response(wire()); } } });
  assert.equal(normal.kind, 'locallyAccepted');
  for (const replacement of [{ arguments: original }, { arguments: JSON.stringify(wire()) }, wire()]) {
    let calls = 0;
    const { result } = await invokeCorrectKpProposalBundle({ ...input, repairTicket: saved,
      binding: { async run(_model, request) {
        calls++;
        assertDeepSeekStrictToolModelInput(request);
        assert.deepEqual(sentContext(request).requiredContext, proposalModelContext(context));
        assert.equal(sentRevision(request).sourceDraft, null);
        return response(replacement);
      } } });
    assert.equal(calls, 1);
    if (Object.hasOwn(replacement, 'arguments')) {
      assert.equal(result.kind, 'rejected');
      assert.equal(result.code, 'PROPOSAL_REPAIR_EXHAUSTED');
      assert.ok(result.diagnostics.some(d => d.constraint === 'revision:draft-outside-model-content'));
    } else {
      assert.equal(result.kind, 'locallyAccepted');
      assert.deepEqual(result.bundle, normal.bundle);
    }
    assert.deepEqual(first.repairTicket, saved);
  }
});

test('patch operations are atomic, closed, version bound, and cannot access server or prototype paths', () => {
  const source = { sourceDraft: wire(), sourceDraftVersion: 'version:1' }, saved = structuredClone(source);
  for (const operation of [
    { op: 'replace', path: '/decision/missing', value: 1 }, { op: 'add', path: '/steps/worldInteraction/01', value: {} },
    { op: 'remove', path: '/steps/worldInteraction/999' }, { op: 'add', path: '/steps/worldInteraction/-/kind', value: 'observe' },
    { op: 'add', path: '/results', value: [] },
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

test('diagnostic mapping follows the step group and grouped entry records', () => {
  // The decoded draft lists the observe owner after the two interactions,
  // in group order; the wire holds it as the one observe step.
  const source = sharedCheckBundle(), raw = encodeVNextStrictToolBundle(source), draft = reordered(source);
  const owner = decodedIndex(source, 1);
  assert.equal(draft.proposals[owner].kind, 'observe');
  const d = proposalFillingDiagnostics(draft, [{ code: 'VALUE_INVALID', constraint: 'bad-evidence',
    path: ['proposals', owner, 'branches', 'success', 'sensoryEvidence', 0, 'evidence'], repair: { allowed: true, reason: 'test' } }], raw)[0];
  assert.deepEqual(d.path, ['steps', 'observe', 0, 'success', 'entries', 0, 'evidence']);
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

test('a reply that is no revision spends a round: the same draft returns with the failed patch diagnosed beside what it still has to fix', async () => {
  const invalid = wire(); delete invalid.decision.ability;
  const bad = patch([{ op: 'remove', path: '/decision/nowhere' }]);
  const good = patch([{ op: 'add', path: '/decision/ability', value: 'wis' }]);
  const rounds = [];
  const { result, calls, ticket } = await revise(invalid, body => body.round === 1 ? bad : good,
    body => rounds.push([body.round, body.sourceDraft, body.diagnostics.map(d => d.constraint)]));
  assert.equal(calls, 3); assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result));
  assert.equal(rounds.length, 2);
  assert.deepEqual(rounds.map(([round, source]) => [round, source]), [[1, 'asReplied'], [2, 'asReplied']]);
  assert.ok(rounds[1][2].includes(rounds[0][2][0]), JSON.stringify(rounds));
  assert.ok(rounds[1][2].some(constraint => constraint === 'revision:path-missing'), JSON.stringify(rounds));
  assert.equal(ticket.validationCode, 'PROPOSAL_REVISION_INVALID'); assert.equal(ticket.round, 2);
  assert.doesNotThrow(() => assertRepairTicket(ticket, context.binding.contextHash, context));
  // The same failed patch twice makes the same ticket twice: no progress.
  const twice = await revise(invalid, bad);
  assert.equal(twice.calls, 3); assert.equal(twice.result.kind, 'rejected'); assert.equal(twice.result.code, 'PROPOSAL_REPAIR_EXHAUSTED');
});
