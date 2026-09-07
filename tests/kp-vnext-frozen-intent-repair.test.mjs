import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { invokeSubmitKpProposalBundleFirstPass, invokeCorrectKpProposalBundle, assertRepairTicket,
  parseSubmitKpProposalBundleCandidateArguments, vnextProposalHasExecutionRepairBudget } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { encodeVNextStrictToolBundle, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { vnextProposalRepairPlan } from '../app/_runtime/lib/kp/vnext/proposal-correction.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { sharedCheckBundle } from './fixtures/vnext-shared-check.mjs';
const { requiredContext } = createAuthoredProbeFixture('frozen-intent-repair');
const request = { modelId: 'scripted', message: '按冻结输入填写。', requiredContext };
const ability = () => ({ decision: { kind: 'abilityOperation', operation: {
  kind: 'invoke', abilityRef: 'ability:registered:fixture', castingMode: 'normal',
  target: { kind: 'creatures', refs: [requiredContext.intent.actorRef] } } } });
const echo = wire => { wire.decision.intent = structuredClone(requiredContext.intent); return wire; };
const response = (wire, name = SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) => ({ choices: [{ message: { tool_calls: [{
  type: 'function', function: { name, arguments: typeof wire === 'string' ? wire : JSON.stringify(wire) },
}] } }] });
async function first(wire, context = requiredContext) {
  return invokeSubmitKpProposalBundleFirstPass({ ...request, requiredContext: context, binding: { async run() { return response(wire); } } });
}
test('exact frozen intent echo enters the existing bounded server confirmation', async () => {
  const original = ability(), wire = echo(ability()), before = structuredClone(wire), result = await first(wire);
  assert.equal(result.kind, 'repairRequired', JSON.stringify(result));
  const ticket = result.repairTicket;
  assert.deepEqual(ticket.repairPlan, [{ path: ['terminal', 'intent'], operation: 'remove', reason: 'exact-frozen-intent-echo' }]);
  assert.equal(ticket.originalArguments, JSON.stringify(before));
  let calls = 0;
  const repaired = await invokeCorrectKpProposalBundle({ ...request, repairTicket: ticket, binding: { async run(_model, input) {
    calls++;
    const prompt = JSON.parse(input.messages[1].content);
    assert.deepEqual(prompt.summaryPaths, []);
    assert.deepEqual(prompt.allowedPaths, [['decision', 'intent']]);
    assert.deepEqual(prompt.repairPlan[0].path, ['decision', 'intent']);
    const diagnostic = prompt.diagnostics.find(d => d.constraint === 'closed-object-additional-field');
    assert.equal(diagnostic.pathBase, 'arguments'); assert.deepEqual(diagnostic.path, ['decision', 'intent']);
    assert.equal(diagnostic.repair.allowed, true); assert.deepEqual(diagnostic.repair.changes[0].path, ['decision', 'intent']);
    assert.equal(diagnostic.repair.changes[0].operation, 'remove');
    return response({ confirm: 'server-plan', summaries: [] }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  } } });
  assert.equal(calls, 1); assert.equal(repaired.kind, 'locallyAccepted', JSON.stringify(repaired));
  assert.deepEqual(repaired.bundle, parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(original)).bundle);
  assert.deepEqual(wire, before); assert.deepEqual(ticket.draft.terminal.intent, requiredContext.intent);
});

function direct() {
  const bundle = sharedCheckBundle('worldInteraction');
  bundle.adjudication = { kind: 'directSuccess', risk: '操作的条件已满足。', successOutcome: '阀门发生预定变化。' };
  bundle.proposals = [bundle.proposals[1]]; bundle.proposals[0].branches.failure = { kind: 'none' };
  return encodeVNextStrictToolBundle(bundle);
}
function clarification(continuation = ability().decision) {
  return { decision: { kind: 'clarification', basisRefs: [], intent: '选择已经明确的行动。', method: '按所选方案操作。',
    question: '是否执行？', choices: [
      { choiceId: 'choice:execute', label: '执行', publicRisk: '承担原定成本。', basisRefs: [], continuation },
      { choiceId: 'choice:cancel', label: '取消', publicRisk: '不产生结果。', basisRefs: [], continuation: { kind: 'cancel' } },
    ] } };
}
const refusal = () => ({ decision: { kind: 'inWorldRefusal', basisRefs: [], intent: '执行当前行动。', method: '使用当前方法。',
  ruling: { kind: 'missingPrerequisite', publicBasis: '当前缺少所需工具。', prerequisites: [], nextActions: [], attemptCosts: [] } } });
async function confirm(ticket, answer = { confirm: 'server-plan', summaries: [] }, context = requiredContext) {
  return invokeCorrectKpProposalBundle({ ...request, requiredContext: context, repairTicket: ticket,
    binding: { async run() { return response(answer, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME); } } });
}
test('different ruling and continuation structures use one remove proof while the complete decisions stay identical', async () => {
  const samples = [direct(), encodeVNextStrictToolBundle(sharedCheckBundle()), clarification()];
  for (const original of samples) {
    const expected = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(original));
    assert.equal(expected.kind, 'accepted', JSON.stringify(expected));
    const wire = structuredClone(original);
    const decision = wire.decision.kind === 'clarification' ? wire.decision.choices[0].continuation : wire.decision;
    decision.intent = structuredClone(requiredContext.intent);
    const begun = await first(wire); assert.equal(begun.kind, 'repairRequired', JSON.stringify(begun));
    assert.equal(begun.repairTicket.repairPlan.length, 1);
    assert.equal(begun.repairTicket.repairPlan[0].operation, 'remove');
    const done = await confirm(begun.repairTicket); assert.equal(done.kind, 'locallyAccepted', JSON.stringify(done));
    assert.deepEqual(done.bundle, expected.bundle);
    if (wire.decision.kind === 'clarification') {
      assert.equal(done.bundle.terminal.intent, original.decision.intent);
      assert.deepEqual(begun.repairTicket.diagnostics.find(d => d.repair.allowed).path, ['decision', 'choices', 0, 'continuation', 'intent']);
    }
  }
});
test('legitimate narrative intent remains required and cannot be replaced by the frozen input object', async () => {
  for (const wire of [refusal(), clarification(), direct()]) {
    const accepted = await first(wire); assert.equal(accepted.kind, 'locallyAccepted', JSON.stringify(accepted));
    if (wire.decision.kind === 'directSuccess') wire.decision.steps[0].intent = structuredClone(requiredContext.intent);
    else wire.decision.intent = structuredClone(requiredContext.intent);
    const rejected = await first(wire); assert.equal(rejected.kind, 'rejected', JSON.stringify(rejected));
    assert.equal(rejected.repairUsed, false); assert.ok(rejected.diagnostics.every(d => !d.repair.allowed));
  }
});
test('wrong, partial, extended echoes and unrelated extra fields fail before correction', async () => {
  for (const mutate of [
    w => { w.decision.intent.actorRef = 'character:another'; },
    w => { w.decision.intent.submissionRef = 'submission:previous'; },
    w => { w.decision.intent.text += ' '; },
    w => { w.decision.intent.text = 42; },
    w => { delete w.decision.intent.text; },
    w => { w.decision.intent.dc = 1; },
    w => { w.decision.intent = requiredContext.intent.text; },
    w => { w.decision.dc = 1; },
    w => { delete w.decision.operation.target; },
  ]) {
    const wire = echo(ability()); mutate(wire);
    const result = await first(wire);
    assert.equal(result.kind, 'rejected', JSON.stringify(result)); assert.equal(result.repairUsed, false);
    assert.ok(result.diagnostics.every(d => !d.repair.allowed));
    assert.ok(result.diagnostics.some(d => d.pathBase === 'arguments' && JSON.stringify(d.path) === '["decision","intent"]'));
  }
  for (const field of ['dc', 'successOutcome', 'failureOutcome']) {
    const wire = echo(encodeVNextStrictToolBundle(sharedCheckBundle())); delete wire.decision[field];
    const result = await first(wire); assert.equal(result.kind, 'rejected', JSON.stringify(result));
    assert.ok(result.diagnostics.some(d => d.code === 'FIELD_MISSING' && d.path?.at(-1) === field), JSON.stringify(result));
  }
  const context = structuredClone(requiredContext); delete context.intent;
  const rejected = await first(echo(ability()), context); assert.equal(rejected.kind, 'rejected');
  assert.ok(rejected.diagnostics.some(d => d.repair.reason === 'trusted-frozen-intent-required'));
});
test('nonexecuting terminal proof does not grant the third execution call budget', async () => {
  for (const decision of [{ kind: 'passTime', durationMicros: '1000000' },
    { kind: 'knowledgeReview', inquiry: '回顾已知内容。', scope: 'allKnown', knowledgeRefs: [] }]) {
    const result = await first(echo({ decision })); assert.equal(result.kind, 'repairRequired', JSON.stringify(result));
    assert.equal(vnextProposalHasExecutionRepairBudget(result.repairTicket.draft, []), false);
    assert.equal(result.repairTicket.repairPlan[0].operation, 'remove');
  }
  const result = await first(echo(ability())); assert.equal(vnextProposalHasExecutionRepairBudget(result.repairTicket.draft, ['abilityOperation']), true);
});
test('remove composes with existing fixed and presentation repairs without accepting arbitrary empty changes', async () => {
  const wire = echo(encodeVNextStrictToolBundle(sharedCheckBundle()));
  wire.decision.risk = ` ${wire.decision.risk} `; wire.decision.steps[1].success.summary = '';
  const result = await first(wire); assert.equal(result.kind, 'repairRequired', JSON.stringify(result));
  assert.deepEqual(result.repairTicket.repairPlan.map(c => c.operation).sort(), ['remove', 'replace', 'replace']);
  const done = await confirm(result.repairTicket, { confirm: 'server-plan', summaries: [
    { path: ['proposals', 1, 'branches', 'success', 'summary'], value: '听清了压力变化。' },
  ] });
  assert.equal(done.kind, 'locallyAccepted', JSON.stringify(done));
  assert.equal(done.bundle.adjudication.dc, 12); assert.equal(done.bundle.proposals[1].branches.failure.summary, '声音模糊，未能分辨压力变化。');
  const denied = await confirm(result.repairTicket); assert.equal(denied.kind, 'rejected');
  assert.ok(denied.diagnostics.some(d => d.constraint === 'correction:summary-required'));
});
test('the actual context and original raw draft re-prove tickets; hash changes cannot grant new paths or repairs', async () => {
  const result = await first(echo(ability())), ticket = result.repairTicket;
  assert.doesNotThrow(() => assertRepairTicket(ticket, requiredContext.binding.contextHash, requiredContext));
  assert.throws(() => assertRepairTicket(ticket, requiredContext.binding.contextHash), /TICKET_INVALID/);
  const context = structuredClone(requiredContext); context.intent.text += 'changed';
  assert.throws(() => assertRepairTicket(ticket, context.binding.contextHash, context), /TICKET_INVALID/);
  for (const mutate of [
    t => { t.draft.terminal.operation.target.refs = ['character:other']; t.bundleHash = canonicalHash(t.draft); },
    t => { t.originalArguments = t.originalArguments.replace('ability:registered:fixture', 'ability:registered:other'); },
    t => { t.allowedPaths = [['terminal', 'operation']]; },
    t => { t.repairPlan[0].path = ['terminal', 'operation']; },
    t => { t.contextHash = 'sha256:changed'; },
  ]) {
    const changed = structuredClone(ticket); mutate(changed); const { ticketHash: _, ...body } = changed; changed.ticketHash = canonicalHash(body);
    assert.throws(() => assertRepairTicket(changed, requiredContext.binding.contextHash, requiredContext), /TICKET_INVALID/);
  }
  assert.deepEqual(vnextProposalRepairPlan(ticket.draft, undefined, ticket.originalArguments), []);
  for (const path of [['decision', 'intent'], ['terminal', 'intent'], ['terminal', 'operation']]) {
    const denied = await confirm(ticket, { confirm: 'server-plan', summaries: [{ path, value: 'new content' }] });
    assert.equal(denied.kind, 'rejected'); assert.ok(denied.diagnostics.some(d => d.code === 'REPAIR_OUT_OF_SCOPE'));
  }
  const mutable = structuredClone(requiredContext);
  const done = await invokeCorrectKpProposalBundle({ ...request, requiredContext: mutable, repairTicket: ticket,
    binding: { async run() { mutable.intent.text = 'changed during provider await'; return response({ confirm: 'server-plan', summaries: [] }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME); } } });
  assert.equal(done.kind, 'locallyAccepted', JSON.stringify(done));
});
test('duplicate JSON members and truncated nested decisions never gain echo deletion authority', async () => {
  const raw = JSON.stringify(echo(ability()));
  for (const malformed of [raw.replace('"intent":', '"intent":{},"intent":'), raw.slice(0, raw.indexOf('"target"') + 10)]) {
    const denied = await first(malformed); assert.equal(denied.kind, 'rejected');
    assert.ok(denied.diagnostics.some(d => d.code === 'JSON_SYNTAX' && d.location !== undefined), JSON.stringify(denied));
    assert.equal(denied.repairUsed, false);
  }
});

test('first-pass proof freezes trusted context before awaiting the model', async () => {
  const mutable = structuredClone(requiredContext), wire = echo(ability());
  const begun = await invokeSubmitKpProposalBundleFirstPass({ ...request, requiredContext: mutable,
    binding: { async run() { mutable.intent.text = 'changed during first pass'; return response(wire); } } });
  assert.equal(begun.kind, 'repairRequired', JSON.stringify(begun));
  assert.doesNotThrow(() => assertRepairTicket(begun.repairTicket, requiredContext.binding.contextHash, requiredContext));
});

test('an echo revealed after an earlier format repair still reports the exact continuation argument path', async () => {
  const wire = clarification(echo(ability()).decision); wire.decision.method = ` ${wire.decision.method} `;
  const begun = await first(wire); assert.equal(begun.kind, 'repairRequired', JSON.stringify(begun));
  const echoDiagnostic = begun.repairTicket.diagnostics.find(d => d.repair.changes?.some(c => c.operation === 'remove'));
  assert.equal(echoDiagnostic.pathBase, 'arguments');
  assert.deepEqual(echoDiagnostic.path, ['decision', 'choices', 0, 'continuation', 'intent']);
  const repaired = await confirm(begun.repairTicket); assert.equal(repaired.kind, 'locallyAccepted', JSON.stringify(repaired));
  assert.equal(repaired.bundle.terminal.intent, wire.decision.intent);
});
