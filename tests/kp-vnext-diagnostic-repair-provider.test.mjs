import { encodeVNextStrictToolBundle } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { assertRepairTicket, invokeCorrectKpProposalBundle, invokeSubmitKpProposalBundleFirstPass,
  invokeSubmitKpProposalBundleWithOneCorrection, invokeVNextProposalOffer } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { applyVNextProposalBundleCorrection } from '../app/_runtime/lib/kp/vnext/proposal-correction.ts';
import { CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { createVNextKpAdapter } from '../app/_runtime/lib/kp/vnext/adapter.ts';
import { assertDeepSeekStrictToolModelInput } from '../app/_runtime/lib/kp/deepseek.ts';
import { sharedCheckBundle } from './fixtures/vnext-shared-check.mjs';
import { itemBundle } from './fixtures/vnext-authored-bundles.mjs';
import { worldFactSocialBundle } from './fixtures/vnext-world-facts.mjs';
import { VNEXT_INITIAL_PROPOSAL_CAPABILITIES } from '../app/_runtime/lib/kp/vnext/proposal-capabilities.ts';
const context = { entries: [], references: { citations: { authorityBasisRefs: [], viewerEvidenceRefs: [], npcKnowledge: [] } }, binding: { contextHash: 'sha256:repair-context', preparedActionId: 'prepared:repair', rootActionId: 'root:repair' } };
const input = { modelId: 'scripted-test', message: '冻结的玩家意图', requiredContext: context };
function response(value, name = SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, raw = false) {
  return { choices: [{ message: { tool_calls: [{ type: 'function', function: { name, arguments: raw ? value : JSON.stringify(encodeVNextStrictToolBundle(value)) } }] } }] };
}
function modelSummaries(plan) {
  return plan.filter(change => !Object.hasOwn(change, 'value'))
    .map(change => ({ path: change.path, value: '原有分支的摘要。' }));
}

async function first(wire) {
  return invokeSubmitKpProposalBundleFirstPass({ ...input, binding: { async run() { return response(wire); } } });
}
function correction(ticket, changes) {
  return { schema: VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA, baseBundleHash: ticket.bundleHash,
    contextHash: ticket.contextHash, attempt: 1, changes };
}

function clarificationWire(inner = sharedCheckBundle()) {
  const { basisRefs, adjudication, proposals } = inner;
  return { mode: 'terminal', basisRefs: [], adjudication: { kind: 'none' }, proposals: [],
    terminal: { kind: 'clarification', intent: '确认实际方案。', method: '先询问再行动。', question: '选择哪个方案？',
      choices: ['first', 'second'].map(choiceId => ({ choiceId, label: choiceId, publicRisk: '按已说明的风险执行。',
        basisRefs: [], continuation: structuredClone({ kind: 'adjudication', basisRefs, adjudication, proposals }) })) } };
}

test('clarification branches share complete diagnostics and one repair while all other decisions stay frozen', async () => {
  for (const kind of ['observe', 'worldInteraction']) {
    const wire = clarificationWire(sharedCheckBundle(kind)), original = await first(wire);
    assert.equal(original.kind, 'locallyAccepted', JSON.stringify(original));
    const continuation = wire.terminal.choices[1].continuation;
    continuation.proposals[1].method = ` ${continuation.proposals[1].method} `;
    continuation.proposals[1].basisRefs = [...continuation.proposals[1].basisRefs, continuation.proposals[1].basisRefs[0]];
    delete continuation.proposals[0].branches.failure;
    const submitted = structuredClone(wire);
    let ticket, calls = 0;
    const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...input,
      persistRepairTicket(value) { ticket = value; },
      binding: { async run(_model, request) {
        calls++;
        if (calls === 1) return response(wire);
        const prompt = JSON.parse(request.messages[1].content);
        assert.deepEqual(prompt.diagnostics, ticket.diagnostics);
        assert.deepEqual(prompt.rejectedBundle, ticket.draft);
        assert.equal(prompt.repairPlan.length, 3);
        for (const detail of prompt.diagnostics) {
          assert.deepEqual(detail.path.slice(0, 4), ['terminal', 'choices', 1, 'continuation']);
          assert.equal(detail.repair.allowed, true);
        }
        return response({ confirm: 'server-plan', summaries: modelSummaries(prompt.repairPlan) }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
      } } });
    assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result));
    assert.equal(calls, 2);
    assert.deepEqual(result.bundle, original.bundle);
    assert.deepEqual(wire, submitted);
    assert.ok(Object.isFrozen(ticket.draft.terminal.choices[0].continuation));
    for (const path of [
      ['terminal', 'choices', 0, 'continuation', 'adjudication', 'dc'],
      ['terminal', 'choices', 1, 'continuation', 'adjudication', 'failureOutcome'],
      ['terminal', 'choices', 0, 'continuation', 'proposals', 0, 'targetRefs'],
    ]) {
      const denied = applyVNextProposalBundleCorrection({ bundle: ticket.draft, requiredContext: context,
        allowedPaths: ticket.allowedPaths, correction: correction(ticket, [{ path, value: 'changed' }]) });
      assert.equal(denied.kind, 'rejected');
      assert.equal(denied.diagnostics[0].code, 'REPAIR_OUT_OF_SCOPE');
      assert.deepEqual(denied.diagnostics[0].path, path);
    }
  }
});

test('unselected clarification branches cannot bypass loaded capabilities or ruling gates by requesting repair', async () => {
  for (const gate of ['capability', 'ruling']) for (const damage of ['none', 'whitespace', 'syntax']) {
    const wire = clarificationWire(), continuation = wire.terminal.choices[1].continuation;
    if (gate === 'capability') {
      const authored = itemBundle();
      Object.assign(continuation, { basisRefs: authored.basisRefs, adjudication: authored.adjudication, proposals: authored.proposals });
    } else {
      const { kind: _kind, risk, successOutcome, failureOutcome, ...check } = continuation.adjudication;
      continuation.adjudication = { kind: 'highRisk', risk, successOutcome, failureOutcome,
        confirmationQuestion: '继续吗？', check, acceptedCosts: [] };
    }
    if (damage === 'whitespace') wire.terminal.choices[0].continuation.proposals[1].method = ' 原方法。 ';
    for (const offer of [true, false]) {
      let calls = 0;
      const raw = JSON.stringify(encodeVNextStrictToolBundle(offer ? { ...wire, requestedCapabilities: [] } : wire));
      const options = { ...input, capabilities: VNEXT_INITIAL_PROPOSAL_CAPABILITIES, binding: { async run() {
        calls++;
        return response(damage === 'syntax' ? raw.slice(0, -1) : raw,
          offer ? OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME : SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, true);
      } } };
      const result = await (offer ? invokeVNextProposalOffer(options) : invokeSubmitKpProposalBundleFirstPass(options));
      assert.equal(result.kind, 'rejected', JSON.stringify(result));
      assert.equal(result.repairUsed, false);
      assert.equal(calls, 1);
      if (offer) {
        assert.equal(result.diagnostics[0].code, damage === 'syntax' ? 'JSON_SYNTAX' : 'FIELD_MISSING');
      } else {
        assert.equal(result.diagnostics[0].constraint, gate === 'capability' ? 'proposal:capability-not-loaded' : 'filling:decision-kind');
        assert.deepEqual(result.diagnostics[0].path.slice(0, 4), gate === 'capability' ? ['terminal', 'kind'] : ['decision', 'choices', 1, 'continuation']);
      }
      assert.equal(result.diagnostics[0].repair.allowed, false);
    }
  }
});

test('one incomplete clarification decision refuses repair even when another branch has fixable formatting', async () => {
  for (const missing of ['adjudication', 'failure']) {
    const wire = clarificationWire();
    wire.terminal.choices[0].continuation.proposals[1].method = ' 原方法。 ';
    const incomplete = wire.terminal.choices[1].continuation;
    if (missing === 'adjudication') delete incomplete.adjudication;
    else delete incomplete.proposals[1].branches.failure;
    const result = await first(wire);
    assert.equal(result.kind, 'rejected', JSON.stringify(result));
    assert.equal(result.repairUsed, false);
    assert.ok(result.diagnostics.every(detail => !detail.repair.allowed));
  }
});

test('declared production, inventory quantity and NPC motives cannot be invented or removed by format repair', async () => {
  for (const [factory, mutate, path, code] of [
    ...['observe', 'worldInteraction'].map(kind => [() => sharedCheckBundle(kind),
      wire => { wire.proposals[1].produces = [{ kind: 'semanticDefinition', handle: 'prospective:unintended', outcomeBinding: 'always' }]; },
      ['decision', 'steps', 1, 'handle'], 'CONSTRAINT_CONFLICT']),
    [itemBundle, wire => { wire.proposals[2].quantity = '2'; }, ['proposals', 2, 'quantity'], 'TYPE_MISMATCH'],
    [() => worldFactSocialBundle({ sceneRef: 'scene:shared', npcRef: 'npc:speaker' }),
      wire => { delete wire.proposals[1].branches.success.response.motive; },
      ['proposals', 1, 'branches', 'success', 'response', 'motive'], 'FIELD_MISSING'],
  ]) {
    for (const extraFormatting of [false, true]) {
      const { schema: _schema, kind: _kind, ...wire } = factory(); mutate(wire);
      if (extraFormatting) wire.adjudication.risk = ` ${wire.adjudication.risk} `;
      const original = structuredClone(wire);
      let calls = 0;
      const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...input,
        persistRepairTicket() { assert.fail('unsafe repair must not receive a ticket'); }, binding: { async run() {
        calls++; return response(wire);
      } } });
      assert.equal(result.kind, 'rejected', JSON.stringify(result));
      assert.equal(result.repairUsed, false);
      assert.equal(calls, 1);
      assert.ok(result.diagnostics.every(detail => detail.repair.allowed === false));
      assert.ok(result.diagnostics.some(detail => detail.code === code
        && JSON.stringify(detail.path) === JSON.stringify(path)), JSON.stringify(result));
      assert.deepEqual(wire, original);
    }
  }
});

test('unknown proposal kinds and malformed authored references retain their refused paths through repair admission', async () => {
  for (const [factory, mutate, path] of [
    ...['observe', 'worldInteraction'].map(kind => [() => sharedCheckBundle(kind),
      wire => { wire.proposals[1].kind = 'unregisteredProposal'; }, ['proposals', 1, 'kind']]),
    [itemBundle, wire => { wire.proposals[2].definitionRef = 'definition:bad reference'; },
      ['proposals', 2, 'definitionRef']],
    [itemBundle, wire => { wire.proposals[4].operation.targetRefs[0] = 'character:bad reference'; },
      ['proposals', 4, 'operation', 'targetRefs', 0]],
  ]) {
    for (const extraFormatting of [false, true]) {
      const { schema: _schema, kind: _kind, ...wire } = factory();
      mutate(wire);
      if (extraFormatting) wire.adjudication.risk = ` ${wire.adjudication.risk} `;
      const original = structuredClone(wire);
      let calls = 0;
      const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...input,
        persistRepairTicket() { assert.fail('a semantic replacement must not receive a repair ticket'); },
        binding: { async run() { calls++; return response(wire); } },
      });
      assert.equal(result.kind, 'rejected', JSON.stringify(result));
      assert.equal(result.repairUsed, false);
      assert.equal(calls, 1);
      const detail = result.diagnostics.find(d => JSON.stringify(d.path) === JSON.stringify(path));
      assert.ok(detail, JSON.stringify(result));
      assert.equal(detail.code, 'VALUE_INVALID');
      assert.ok(detail.expected !== undefined && detail.actual !== undefined);
      assert.equal(detail.repair.allowed, false);
      assert.deepEqual(wire, original);
    }
  }
});

test('refused repair reports original locations without shifted dependency indices or summary placeholders', async () => {
  const shifted = sharedCheckBundle();
  shifted.proposals[1].basisRefs = ['definition:loaded', 'definition:loaded', 'prospective:unknown'];
  const placeholder = sharedCheckBundle();
  placeholder.proposals[1].branches.success.summary = '';
  placeholder.proposals[1].produces = [{ kind: 'semanticDefinition', handle: 'prospective:unintended', outcomeBinding: 'always' }];
  for (const wire of [shifted, placeholder]) {
    const original = structuredClone(wire), result = await first(wire);
    assert.equal(result.kind, 'rejected', JSON.stringify(result));
    assert.equal(result.repairUsed, false);
    assert.ok(result.diagnostics.every(detail => detail.repair.allowed === false));
    assert.doesNotMatch(JSON.stringify(result.diagnostics), /修正后的摘要。/);
    if (wire === shifted) {
      const detail = result.diagnostics.find(detail => detail.constraint === 'reference-array-unique');
      assert.deepEqual(detail.path, ['proposals', 1, 'basisRefs', 1]);
      assert.deepEqual(detail.actual, { type: 'string', value: 'definition:loaded' });
    }
    assert.deepEqual(wire, original);
  }
});

test('distinct check owners and terminal forms receive complete executable diagnostics and one bounded repair', async () => {
  for (const kind of ['observe', 'worldInteraction', 'knowledgeReview']) {
    const wire = kind === 'knowledgeReview'
      ? { mode: 'terminal', basisRefs: [], terminal: { kind: 'knowledgeReview', inquiry: ' 我记得什么？ ',
          scope: 'relevantKnown', knowledgeRefs: ['knowledge:known', 'knowledge:known'] } }
      : sharedCheckBundle(kind);
    if (kind !== 'knowledgeReview') {
      wire.proposals[1].method = ` ${wire.proposals[1].method} `;
      wire.basisRefs.push(wire.basisRefs[0]);
      wire.proposals[1].branches.success.summary = '';
      delete wire.terminal;
      delete wire.proposals[0].branches.failure;
      delete wire.proposals[2].branches.failure;
    }
    const original = structuredClone(wire), calls = [];
    let ticket;
    const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...input,
      persistRepairTicket(value) { ticket = value; assertRepairTicket(value, context.binding.contextHash); },
      binding: { async run(_model, request) {
        calls.push(request); assertDeepSeekStrictToolModelInput(request);
        if (calls.length === 1) return response(wire);
        assert.equal(request.tools[0].function.name, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
        const prompt = JSON.parse(request.messages[1].content);
        assert.deepEqual(prompt.diagnostics, ticket.diagnostics);
        assert.deepEqual(prompt.repairPlan, ticket.repairPlan);
        assert.deepEqual(prompt.rejectedBundle, ticket.draft);
        for (const change of prompt.repairPlan) assert.ok(prompt.diagnostics.some(d => d.repair.allowed
          && d.repair.changes.some(edit => JSON.stringify(edit.path) === JSON.stringify(change.path))), JSON.stringify(prompt));
        return response({ confirm: 'server-plan', summaries: modelSummaries(prompt.repairPlan) }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
      } },
    });
    assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result));
    assert.equal(result.repairUsed, true);
    assert.equal(result.invocationCount, 2);
    assert.equal(calls.length, 2);
    assert.deepEqual(wire, original);
    assert.ok(Object.isFrozen(ticket.draft));
    if (kind !== 'knowledgeReview') {
      assert.deepEqual(result.bundle.adjudication, original.adjudication);
      assert.deepEqual(result.bundle.proposals[0].branches, { ...original.proposals[0].branches, failure: null });
      assert.deepEqual(result.bundle.proposals[2].branches, { ...original.proposals[2].branches, failure: null });
      assert.deepEqual(result.bundle.proposals[1].branches.failure, original.proposals[1].branches.failure);
    } else { assert.equal(result.bundle.adjudication, null); assert.deepEqual(result.bundle.proposals, []); }
  }
});

test('a proven reference-set replacement gives its duplicate member one consistent repair instruction', async () => {
  for (const [kind, path] of [
    ['observe', ['proposals', 1, 'basisRefs']],
    ['observe', ['proposals', 1, 'focusRefs']],
    ['worldInteraction', ['proposals', 1, 'directTargetRefs']],
    ['knowledgeReview', ['terminal', 'knowledgeRefs']],
  ]) {
    const wire = kind === 'knowledgeReview'
      ? { mode: 'terminal', basisRefs: [], adjudication: { kind: 'none' }, proposals: [],
          terminal: { kind: 'knowledgeReview', inquiry: '已知的信息。', scope: 'relevantKnown', knowledgeRefs: ['knowledge:known'] } }
      : sharedCheckBundle(kind);
    const original = await first(wire);
    assert.equal(original.kind, 'locallyAccepted');
    const parent = path.slice(0, -1).reduce((value, key) => value[key], wire), key = path.at(-1);
    const refs = [...parent[key]];
    parent[key] = [...refs, refs[0]];
    const begun = await first(wire);
    assert.equal(begun.kind, 'repairRequired', JSON.stringify(begun));
    const ticket = begun.repairTicket;
    assertRepairTicket(ticket, context.binding.contextHash);
    const duplicate = ticket.diagnostics.find(d => d.constraint === 'reference-array-unique');
    assert.deepEqual(duplicate.path, [...path, refs.length]);
    assert.equal(duplicate.repair.allowed, true, JSON.stringify(ticket.diagnostics));
    assert.deepEqual(duplicate.repair.changes.map(({ path, operation, value }) => ({ path, operation, value })),
      [{ path, operation: 'replace', value: refs }]);
    assert.ok(ticket.diagnostics.every(d => d.repair.allowed));
    let calls = 0;
    const corrected = await invokeCorrectKpProposalBundle({ ...input, repairTicket: ticket,
      binding: { async run(_model, request) {
        calls++;
        const prompt = JSON.parse(request.messages[1].content);
        assert.deepEqual(prompt.diagnostics, ticket.diagnostics);
        return response({ confirm: 'server-plan', summaries: modelSummaries(prompt.repairPlan) }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
      } } });
    assert.equal(corrected.kind, 'locallyAccepted', JSON.stringify(corrected));
    assert.equal(calls, 1);
    assert.deepEqual(corrected.bundle, original.bundle);
  }
});

test('the pure selector rejects complete terminal drafts and any mixed schema request', async () => {
  const wire = { mode: 'terminal', basisRefs: [], terminal: { kind: 'knowledgeReview', inquiry: '整理已有线索。', scope: 'allKnown', knowledgeRefs: [] } };
  const value = await invokeVNextProposalOffer({ ...input, binding: { async run() {
    return response(wire, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  } } });
  assert.equal(value.kind, 'rejected', JSON.stringify(value));
  assert.equal(value.repairUsed, false);
  const mixed = await invokeVNextProposalOffer({ ...input, binding: { async run() {
    return response({ requestedCapabilities: ['authorItem'], steps: [] }, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  } } });
  assert.equal(mixed.kind, 'rejected');
  assert.equal(mixed.repairUsed, false);
});

test('server dependencies are derived once while missing producers and supplied dependency tables refuse repair', async () => {
  for (const kind of ['observe', 'worldInteraction', 'authored']) {
    const clean = kind === 'authored' ? itemBundle() : sharedCheckBundle(kind);
    const source = encodeVNextStrictToolBundle(clean);
    const good = await first(source);
    assert.equal(good.kind, 'locallyAccepted');
    assert.equal(good.repairUsed, false);
    assert.ok(good.bundle.proposals.every(entry => new Set(entry.consumes.map(ref => JSON.stringify(ref))).size === entry.consumes.length));
    for (const mutate of [
      wire => { wire.decision.steps[0].consumes = []; },
      wire => { wire.decision.steps[0].produces = { kind: 'none' }; },
      wire => { wire.decision.steps[0].basisRefs.push('prospective:missing'); },
    ]) {
      const wire = structuredClone(source); mutate(wire); let calls = 0;
      const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...input,
        persistRepairTicket() { assert.fail('no complete equivalent repair'); },
        binding: { async run() { calls++; return response(wire); } } });
      assert.equal(result.kind, 'rejected', JSON.stringify(result));
      assert.equal(calls, 1);
      assert.ok(result.diagnostics.every(d => d.repair.allowed === false && d.repair.reason.length > 0));
    }
  }
});

test('missing decisions, nonnumeric DCs, incomplete effects and extra authority fields refuse repair with a reason', async () => {
  for (const mutate of [wire => { delete wire.adjudication; }, wire => { wire.adjudication.dc = '12'; },
    wire => { delete wire.proposals[1].branches.failure; },
    wire => { delete wire.proposals[0].branches.success.effects[0].operations; },
    wire => { wire.proposals[1].unexpectedAuthority = 'invented'; }]) {
    const wire = sharedCheckBundle(); mutate(wire); let calls = 0;
    const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...input,
      persistRepairTicket() { assert.fail('unsafe draft must not get a ticket'); },
      binding: { async run() { calls++; return response(wire); } } });
    assert.equal(result.kind, 'rejected', JSON.stringify(result)); assert.equal(calls, 1);
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.every(d => d.repair.allowed === false && d.repair.reason.length > 0));
  }
});

test('fixed-value repair rejects new targets, DCs, costs, consequences and changed prose even with caller allowlists', async () => {
  const wire = sharedCheckBundle('worldInteraction'); wire.proposals[1].method = ` ${wire.proposals[1].method} `;
  const begun = await first(wire); assert.equal(begun.kind, 'repairRequired');
  const ticket = begun.repairTicket, fixed = ticket.repairPlan.map(({ path, value }) => ({ path, value }));
  for (const edit of [
    { path: ['adjudication', 'dc'], value: 2 },
    { path: ['adjudication', 'failureOutcome'], value: '没有后果。' },
    { path: ['proposals', 1, 'targetRefs'], value: ['definition:other'] },
    { path: ['proposals', 0, 'branches', 'success', 'effects', 0, 'operations', 0, 'value'], value: 'destroyed' },
    { path: ['proposals', 1, 'method'], value: '采用另一种手段。' },
    { path: ['proposals', 0, 'cost', 'amount'], value: '0' },
  ]) {
    const result = applyVNextProposalBundleCorrection({ bundle: ticket.draft, requiredContext: context,
      allowedPaths: ticket.allowedPaths, correction: correction(ticket, [edit]) });
    assert.equal(result.kind, 'rejected'); assert.equal(result.diagnostics[0].code, 'REPAIR_OUT_OF_SCOPE');
    assert.deepEqual(result.diagnostics[0].path, edit.path);
    const forged = applyVNextProposalBundleCorrection({ bundle: ticket.draft, requiredContext: context,
      allowedPaths: [edit.path], correction: correction(ticket, [edit]) });
    assert.equal(forged.kind, 'rejected');
  }
  assert.equal(applyVNextProposalBundleCorrection({ bundle: ticket.draft, requiredContext: context,
    allowedPaths: ticket.allowedPaths, correction: correction(ticket, fixed) }).kind, 'accepted');
  let calls = 0;
  const exhausted = await invokeCorrectKpProposalBundle({ ...input, repairTicket: ticket,
    binding: { async run() { calls++; return response({ confirm: 'server-plan', summaries: [{ path: ['adjudication', 'risk'], value: '篡改风险。' }] }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME); } } });
  assert.equal(exhausted.kind, 'rejected'); assert.equal(exhausted.code, 'PROPOSAL_REPAIR_EXHAUSTED'); assert.equal(calls, 1);
});

test('ticket diagnostics and operations are re-proved even if their untrusted hash is recomputed', async () => {
  const wire = sharedCheckBundle(); wire.proposals[1].method = ' 有空白的既定方法。 ';
  const begun = await first(wire); assert.equal(begun.kind, 'repairRequired');
  for (const mutate of [ticket => { ticket.diagnostics[0].constraint = 'forged'; },
    ticket => { ticket.repairPlan[0].value = '另作裁决。'; }, ticket => { ticket.repairPlan[0].operation = 'add'; },
    ticket => { ticket.allowedPaths.push(['adjudication', 'dc']); }]) {
    const ticket = structuredClone(begun.repairTicket); mutate(ticket);
    const { ticketHash: _hash, ...body } = ticket; ticket.ticketHash = canonicalHash(body);
    assert.throws(() => assertRepairTicket(ticket, context.binding.contextHash), /TICKET_INVALID/);
  }
});

test('unrepairable syntax retains the real parser location; complete-root syntax and field repair share one call', async () => {
  const wire = sharedCheckBundle(); wire.proposals[1].method = ' 已确定的方法。 ';
  const raw = JSON.stringify(encodeVNextStrictToolBundle(wire));
  let ticket;
  const accepted = await invokeSubmitKpProposalBundleWithOneCorrection({ ...input,
    persistRepairTicket(value) { ticket = value; }, binding: { async run(_model, request) {
      if (request.tools[0].function.name === SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) return response(raw.slice(0, -1), undefined, true);
      return response({ confirm: 'server-plan', summaries: modelSummaries(ticket.repairPlan) }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
    } } });
  assert.equal(accepted.kind, 'locallyAccepted', JSON.stringify(accepted));
  assert.equal(ticket.diagnostics.find(d => d.code === 'JSON_SYNTAX').location.offset, raw.length - 1);
  const invalid = await invokeSubmitKpProposalBundleFirstPass({ ...input, binding: { async run() {
    return response('{\n"mode": invalid}', undefined, true);
  } } });
  assert.equal(invalid.kind, 'rejected');
  assert.equal(invalid.diagnostics[0].code, 'JSON_SYNTAX');
  assert.deepEqual(invalid.diagnostics[0].path, ['mode']);
  assert.equal(invalid.diagnostics[0].location.line, 2);
  assert.equal(invalid.diagnostics[0].repair.allowed, false);
});

test('noncanonical drafts remain explicitly refused until exact draft binding supports them', async () => {
  const wire = sharedCheckBundle(); wire.proposals[1].method = 'Cafe\u0301';
  const result = await first(wire);
  assert.equal(result.kind, 'rejected');
  assert.equal(result.diagnostics[0].constraint, 'canonical JSON strings must already use Unicode NFC');
  assert.equal(result.diagnostics[0].repair.reason, 'draft-cannot-use-current-canonical-binding');
});

test('correction envelope reports each missing or extra field without another repair call', async () => {
  const wire = sharedCheckBundle(); wire.proposals[1].branches.success.summary = '';
  const begun = await first(wire); assert.equal(begun.kind, 'repairRequired');
  const ticket = begun.repairTicket;
  for (const [payload, expected] of [
    [{}, [['FIELD_MISSING', ['confirm']], ['FIELD_MISSING', ['summaries']]]],
    [{ confirm: 'server-plan', summaries: [], extra: true }, [['CONSTRAINT_CONFLICT', ['extra']]]],
    [{ confirm: 'server-plan', summaries: [{}] }, [['FIELD_MISSING', ['summaries', 0, 'path']], ['FIELD_MISSING', ['summaries', 0, 'value']]]],
    [{ confirm: 'server-plan', summaries: [{ path: ticket.allowedPaths[0], extra: 'unapproved' }] },
      [['FIELD_MISSING', ['summaries', 0, 'value']], ['CONSTRAINT_CONFLICT', ['summaries', 0, 'extra']]]],
  ]) {
    let calls = 0;
    const result = await invokeCorrectKpProposalBundle({ ...input, repairTicket: ticket,
      binding: { async run() { calls++; return response(payload, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME); } } });
    assert.equal(result.kind, 'rejected');
    assert.equal(result.code, 'PROPOSAL_REPAIR_EXHAUSTED');
    assert.equal(calls, 1);
    assert.deepEqual(result.diagnostics.map(({ code, path }) => [code, path]), expected);
    assert.ok(result.diagnostics.every(d => d.repair.allowed === false && d.expected !== undefined));
  }
});

test('noncanonical correction retains the canonical rejection reason without guessing a field location', async () => {
  const wire = sharedCheckBundle(); wire.proposals[1].branches.success.summary = '';
  const begun = await first(wire); assert.equal(begun.kind, 'repairRequired');
  let calls = 0;
  const result = await invokeCorrectKpProposalBundle({ ...input, repairTicket: begun.repairTicket,
    binding: { async run() { calls++; return response({ confirm: 'server-plan', summaries: [{ path: begun.repairTicket.allowedPaths[0], value: 'Cafe\u0301' }] },
      CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME); } } });
  assert.equal(result.kind, 'rejected');
  assert.equal(result.code, 'PROPOSAL_REPAIR_EXHAUSTED');
  assert.equal(calls, 1);
  assert.equal(result.diagnostics[0].code, 'VALUE_INVALID');
  assert.equal(result.diagnostics[0].constraint, 'canonical JSON strings must already use Unicode NFC');
  assert.equal(result.diagnostics[0].repair.allowed, false);
  assert.equal(Object.hasOwn(result.diagnostics[0], 'path'), false);
});

test('authority diagnostic reentry is an explicit local refusal with no model invocation', async () => {
  const adapter = createVNextKpAdapter({ proposalBinding: { async run() { assert.fail('cannot redraft authority decision'); } },
    journal: { async begin() { assert.fail('cannot allocate another stage'); }, async complete() { assert.fail('unused'); } }, narrationAdapter: {} });
  const authorityDiagnostics = [{ code: 'costUnavailable', publicPath: 'PRIVATE-ORIGINAL-RULES-REASON' }];
  await assert.rejects(adapter.propose({ preparedActionId: context.binding.preparedActionId, rootActionId: context.binding.rootActionId,
    requiredContext: context, attempt: 2, diagnostics: authorityDiagnostics }), error => {
    assert.equal(error.publicCode, 'PROPOSAL_RULES_DIAGNOSTIC');
    assert.equal(error.proposalDiagnostics.diagnostics[0].constraint, 'PRIVATE-ORIGINAL-RULES-REASON');
    assert.equal(error.proposalDiagnostics.diagnostics.at(-1).code, 'REPAIR_OUT_OF_SCOPE');
    assert.deepEqual(error.proposalDiagnostics.authorityDiagnostics, authorityDiagnostics);
    assert.notEqual(error.proposalDiagnostics.authorityDiagnostics, authorityDiagnostics); return true;
  });
});

test('Rules reference diagnostics retain their real command path and never authorize a new target', async () => {
  const adapter = createVNextKpAdapter({ proposalBinding: { async run() { assert.fail('no redraft'); } },
    journal: { async begin() { assert.fail('no extra stage'); }, async complete() { assert.fail('unused'); } }, narrationAdapter: {} });
  const diagnostics = [{ code: 'REFERENCE_UNAVAILABLE', path: '/steps/1/rulesInput/plan/operation/entryRef',
    constraint: 'inventory:entry-ref-must-resolve-to-item-entry', expected: { referenceKind: 'itemEntry' },
    message: 'An ItemEntry is required.' }];
  await assert.rejects(adapter.propose({ preparedActionId: context.binding.preparedActionId,
    rootActionId: context.binding.rootActionId, requiredContext: context, attempt: 2, diagnostics }), error => {
    const detail = error.proposalDiagnostics.diagnostics[0];
    assert.equal(detail.code, 'REFERENCE_UNAVAILABLE');
    assert.equal(detail.pathBase, 'rulesInput');
    assert.deepEqual(detail.path, ['steps', '1', 'rulesInput', 'plan', 'operation', 'entryRef']);
    assert.deepEqual(detail.expected, { referenceKind: 'itemEntry' });
    assert.equal(detail.repair.allowed, false);
    assert.equal(Object.hasOwn(detail, 'actual'), false);
    assert.equal(Object.hasOwn(detail.repair, 'changes'), false);
    assert.deepEqual(error.proposalDiagnostics.authorityDiagnostics, diagnostics);
    return true;
  });
});


test('an unloaded ruling cannot gain repair admission through unrelated whitespace or complete-root syntax damage', async () => {
  for (const damage of ['none', 'whitespace', 'syntax']) {
    const wire = sharedCheckBundle('worldInteraction');
    const { kind: _kind, risk, successOutcome, failureOutcome, ...check } = wire.adjudication;
    wire.adjudication = { kind: 'highRisk', risk, successOutcome, failureOutcome,
      confirmationQuestion: '继续吗？', check, acceptedCosts: [] };
    if (damage === 'whitespace') wire.proposals[1].method = ` ${wire.proposals[1].method} `;
    let calls = 0;
    const raw = JSON.stringify(encodeVNextStrictToolBundle({ ...wire, requestedCapabilities: [] }));
    const result = await invokeVNextProposalOffer({ ...input, binding: { async run() { calls++;
      return response(damage === 'syntax' ? raw.slice(0, -1) : raw, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, true);
    } } });
    assert.equal(result.kind, 'rejected', JSON.stringify(result));
    assert.equal(result.repairUsed, false); assert.equal(calls, 1);
    assert.equal(result.diagnostics[0].code, damage === 'syntax' ? 'JSON_SYNTAX' : 'FIELD_MISSING');
  }
});

test('a refused action may trim existing public prose but cannot change its frozen resource cost', async () => {
  const wire = { mode: 'terminal', basisRefs: [], adjudication: { kind: 'none' }, proposals: [], terminal: { kind: 'inWorldRefusal', intent: '尝试开锁。', method: '按原方案尝试。',
    ruling: { kind: 'missingPrerequisite', publicBasis: ' 缺少工具。 ', prerequisites: [], nextActions: [],
      attemptCosts: [{ kind: 'resource', resourceId: 'spellSlot:1', amount: 1 }] } } };
  const begun = await first(wire); assert.equal(begun.kind, 'repairRequired', JSON.stringify(begun));
  const ticket = begun.repairTicket;
  const edited = applyVNextProposalBundleCorrection({ bundle: ticket.draft, requiredContext: context, allowedPaths: ticket.allowedPaths,
    correction: correction(ticket, [{ path: ['terminal', 'ruling', 'attemptCosts', 0, 'amount'], value: 0 }]) });
  assert.equal(edited.kind, 'rejected'); assert.equal(edited.diagnostics[0].code, 'REPAIR_OUT_OF_SCOPE');
  const accepted = applyVNextProposalBundleCorrection({ bundle: ticket.draft, requiredContext: context, allowedPaths: ticket.allowedPaths,
    correction: correction(ticket, ticket.repairPlan.map(({ path, value }) => ({ path, value }))) });
  assert.equal(accepted.kind, 'accepted');
  assert.deepEqual(accepted.bundle.terminal.ruling.attemptCosts, wire.terminal.ruling.attemptCosts);
});

test('the adapter records what the selection asked for and what the filled Bundle actually used', async () => {
  // Rounds 78, 80 and 81 selected observe next to passTime and filled only
  // passTime; nothing recorded the drop. The trace is telemetry only: it
  // never changes the accepted Bundle and never spends a call.
  const events = []; let calls = 0;
  const adapter = createVNextKpAdapter({ onInvocation: event => events.push(event),
    proposalBinding: { async run(_model, request) {
      calls += 1;
      assertDeepSeekStrictToolModelInput(request);
      return calls === 1 ? response({ requestedCapabilities: ['passTime', 'observe'] }, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME)
        : response({ mode: 'terminal', basisRefs: [], adjudication: null, terminal: { kind: 'passTime', durationMicros: '60000000' }, proposals: [] });
    } },
    journal: { async begin() { return { kind: 'ready', capability: 'journal:selection-trace' }; }, async complete() { return { kind: 'saved' }; } },
    narrationAdapter: {} });
  const bundle = await adapter.propose({ preparedActionId: context.binding.preparedActionId, rootActionId: context.binding.rootActionId,
    requiredContext: context, attempt: 1 });
  assert.equal(bundle.terminal.kind, 'passTime');
  assert.equal(calls, 2);
  const trace = events.filter(event => event.eventName === 'kp.vnext.selection');
  assert.equal(trace.length, 1);
  assert.deepEqual({ selected: trace[0].selected, used: trace[0].used, unused: trace[0].unused },
    { selected: ['observe', 'passTime'], used: ['passTime'], unused: ['observe'] });
  assert.equal(trace[0].rootActionId, context.binding.rootActionId);
  assert.equal(trace[0].contextHash, context.binding.contextHash);
});
