import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { proposalNpcSourceChoices, proposalModelContext } from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { npcDecisionContext, npcDecisionEvidenceRef, npcDecisionEntryRef } from '../app/_runtime/lib/rules/v2/npc-decision-context.ts';
import { encodeVNextStrictToolBundle, decodeVNextStrictToolBundle, createVNextProposalBundleSchema, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments, invokeSubmitKpProposalBundleWithOneCorrection } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { expandDeepSeekSchema } from './fixtures/expand-deepseek-schema.mjs';
import { worldFactSocialBundle } from './fixtures/vnext-world-facts.mjs';
import { deepSeekStrictToolSchemaIssues } from '../app/_runtime/lib/kp/deepseek-strict-tool.ts';

const A = 'npc:source:archivist', B = 'npc:source:herbalist', KNOWLEDGE = 'knowledge:shared-local-name';
const held = npc => `knowledge:${npc}:${KNOWLEDGE}`;
function fixture(name) {
  const f = createAuthoredProbeFixture(`source-choice:${name}`, { npcCharacters: [A, B].map(id => ({ id, name: id })),
    initialKnowledge: [A, B].map(characterId => ({ characterId, knowledgeRef: KNOWLEDGE, kind: 'sourceClaim', layer: 'full',
      content: characterId === A ? 'PRIVATE_SOURCE_A_CONTENT' : 'PRIVATE_SOURCE_B_CONTENT', visibility: 'private', provenanceChain: ['genesis:source'] })) });
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [A, B], intentText: '我向两人介绍了今天的来意。' }).context;
  return f;
}
function bundle(npcRef, basis, check = false) {
  const branch = outcomeCode => ({ outcomeCode, summary: '对方作出回应。', response: { kind: 'speech', text: '我听到了你的来意。', motive: '依据本人背景和当前听到的话作答。', basis }, consequences: [] });
  return { mode: 'adjudication', basisRefs: [npcRef], terminal: null,
    adjudication: check ? { kind: 'check', checkKind: 'abilityCheck', ability: 'cha', skill: 'persuasion', dc: 12, mode: 'normal', risk: '对方可能拒绝。', successOutcome: '作出回应。', failureOutcome: '拒绝回答。' }
      : { kind: 'directSuccess', risk: '普通交谈。', successOutcome: '作出回应。' },
    proposals: [{ kind: 'social', basisRefs: [npcRef], consumes: [{ kind: 'existing', ref: npcRef }], produces: [], outcomeBinding: 'always', sceneRef: SCENE,
      npcRef, addressedThreadRef: null, goal: '说明来意。', method: '当面交谈。', communication: 'spokenConversation', audience: 'participants', retryChange: null,
      branches: { success: branch('outcome:answered'), failure: check ? branch('outcome:declined') : null } }] };
}
const parse = wire => parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wire));
function lower(f, wire) { const result = parse(wire); return result.kind === 'accepted' ? lowerVNext2ProposalBundle({ ...f, value: result.bundle }) : result; }
function response(args, name = SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) {
  return { choices: [{ message: { tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] };
}

test('two NPCs and existing/player-expression sources share one frozen selector, codec and Rules path', () => {
  const f = fixture('holders'), before = structuredClone(f.requiredContext), choices = proposalNpcSourceChoices(f.requiredContext);
  assert.deepEqual(proposalModelContext(f.requiredContext).references.npcSourceChoices, choices);
  for (const npc of [A, B]) {
    const refs = choices.find(choice => choice.npcRef === npc).refs, context = npcDecisionContext(f.requiredContext.entries, npc);
    assert.ok(refs.includes(held(npc))); assert.ok(!refs.includes(npcDecisionEntryRef(npc)));
    assert.ok(refs.every(ref => npcDecisionEvidenceRef(context, ref) === ref));
  }
  for (const [npc, basis] of [[A, [{ kind: 'npcContext', ref: A }]], [B, [{ kind: 'npcContext', ref: held(B) }]], [A, [{ kind: 'playerExpression' }]]]) {
    const domain = bundle(npc, basis), wire = encodeVNextStrictToolBundle(domain), original = structuredClone(wire);
    assert.deepEqual(wire.decision.steps[0].result.response.basis, basis.map(source => source.kind === 'npcContext' ? source.ref : source));
    const candidate = parse(wire); assert.equal(candidate.kind, 'accepted'); assert.deepEqual(wire, original);
    const lowered = lowerVNext2ProposalBundle({ ...f, value: candidate.bundle }); assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
    const result = f.runtime.step(f.profiles, f.state, lowered.command.rulesInput); assert.equal(result.kind, 'committed', JSON.stringify(result));
    const replayed = f.runtime.replay(f.genesis, result.events); assert.equal(replayed.kind, 'replayed'); assert.deepEqual(replayed.state, result.state);
    assert.equal(lowered.command.rulesInput.plan.social.playerExpression, f.requiredContext.intent.text);
  }
  assert.deepEqual(f.requiredContext, before);
});

test('selected social schema offers frozen refs and only selected producer-backed new fact form', () => {
  const f = fixture('schema'), choices = proposalNpcSourceChoices(f.requiredContext);
  for (const materialize of [false, true]) {
    const schema = createVNextProposalBundleSchema(materialize ? ['social', 'materializeObject'] : ['social'], [], [], [], choices);
    assert.deepEqual(deepSeekStrictToolSchemaIssues(schema), []);
    const full = expandDeepSeekSchema(schema), decision = full.properties.decision.anyOf.find(value => value.properties.kind.enum.includes('directSuccess'));
    const social = decision.properties.steps.items.anyOf.find(value => value.properties.kind.enum.includes('social'));
    const basis = social.properties.result.properties.response.properties.basis.items.anyOf;
    assert.deepEqual(basis.find(value => value.type === 'string').enum, [...new Set(choices.flatMap(value => value.refs))].sort());
    assert.equal(basis.some(value => value.properties?.worldFactRef), materialize);
    assert.ok(basis.some(value => value.properties?.kind?.enum?.includes('playerExpression')));
    assert.ok(!JSON.stringify(basis).includes('holderRef')); assert.ok(!JSON.stringify(basis).includes('PRIVATE_SOURCE_'));
  }
});

test('other holder, wrapper and unknown refs reject at the exact original wire index with own candidates only', () => {
  const f = fixture('refusal');
  for (const ref of [held(B), npcDecisionEntryRef(A), 'knowledge:invented']) {
    const wire = encodeVNextStrictToolBundle(bundle(A, [{ kind: 'npcContext', ref }], true));
    const result = lower(f, wire); assert.equal(result.kind, 'rejected');
    for (const diagnostic of result.diagnostics) {
      assert.equal(diagnostic.pathBase, 'arguments'); assert.ok(['success', 'failure'].includes(diagnostic.path[3]));
      assert.deepEqual(diagnostic.path.slice(0, 3), ['decision', 'steps', 0]);
      assert.deepEqual(diagnostic.path.slice(4), ['response', 'basis', 0]);
      assert.equal(diagnostic.repair.allowed, false); assert.ok(!diagnostic.expected.refs.includes(held(B)));
    }
    assert.doesNotMatch(JSON.stringify(result.diagnostics), /PRIVATE_SOURCE_[AB]_CONTENT/);
  }
});

test('explicit prospective source keeps holder derivation and rejects missing producer and retired object wires', () => {
  const f = fixture('prospective'), domain = worldFactSocialBundle({ sceneRef: SCENE, npcRef: A });
  const wire = encodeVNextStrictToolBundle(domain), source = wire.decision.steps[1].result.response.basis[0];
  assert.deepEqual(source, { worldFactRef: domain.proposals[1].branches.success.response.basis[0].definitionRef });
  assert.equal(decodeVNextStrictToolBundle(wire).proposals[1].branches.success.response.basis[0].holderRef, A);
  const lowered = lower(f, wire); assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  assert.equal(f.runtime.step(f.profiles, f.state, lowered.command.rulesInput).kind, 'committed');
  const missing = structuredClone(wire); missing.decision.steps.shift();
  const missingResult = lower(f, missing); assert.notEqual(missingResult.kind, 'accepted');
  for (const detail of missingResult.diagnostics ?? []) {
    assert.equal(detail.pathBase, 'arguments'); assert.equal(detail.path.at(-1), 'worldFactRef');
  }
  for (const old of [{ kind: 'npcContext', ref: held(A) }, { kind: 'materializedKnowledge', definitionRef: 'prospective:x', holderRef: A }]) {
    const rejected = structuredClone(wire); rejected.decision.steps[1].result.response.basis = [old];
    assert.throws(() => parse(rejected), error => error.diagnostics?.some(d => d.pathBase === 'arguments'
      && JSON.stringify(d.path) === JSON.stringify(['decision', 'steps', 1, 'result', 'response', 'basis', 0])));
  }
  const invalid = structuredClone(wire); invalid.decision.steps[1].result.response.basis = [{ worldFactRef: held(A) }];
  const invalidResult = parse(invalid); assert.equal(invalidResult.kind, 'locallyRejected');
  assert.ok(invalidResult.diagnostics.some(d => d.path.at(-1) === 'worldFactRef' && d.repair.allowed === false));
  const wrongHolder = structuredClone(domain); wrongHolder.proposals[1].branches.success.response.basis[0].holderRef = B;
  assert.throws(() => encodeVNextStrictToolBundle(wrongHolder), /SOCIAL_SOURCE_HOLDER_CANNOT_BE_ENCODED/);
});

test('one bounded format correction cannot replace a frozen social source or NPC', async () => {
  const f = fixture('correction');
  for (const field of ['basis', 'npcRef']) {
    const wire = encodeVNextStrictToolBundle(bundle(A, [{ kind: 'npcContext', ref: held(A) }])); wire.decision.steps[0].result.summary = '';
    const original = structuredClone(wire); let calls = 0;
    const result = await invokeSubmitKpProposalBundleWithOneCorrection({ modelId: 'test', message: '冻结交谈', requiredContext: f.requiredContext,
      persistRepairTicket(ticket) { assert.equal(ticket.originalArguments, JSON.stringify(original)); },
      binding: { async run(_model, request) { calls++; if (calls === 1) return response(wire);
        const body = JSON.parse(request.messages[1].content); assert.deepEqual(body.originalArguments, JSON.stringify(original));
        return response({ confirm: 'server-plan', summaries: [{ path: field === 'basis'
          ? ['proposals', 0, 'branches', 'success', 'response', 'basis'] : ['proposals', 0, 'npcRef'], value: held(B) }] }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
      } } });
    assert.equal(result.kind, 'rejected'); assert.equal(calls, 2); assert.deepEqual(wire, original);
  }
});

test('missing, malformed and repeated sources preserve their actual selection path without authorizing a replacement', () => {
  for (const value of [undefined, {}, [], [A, A], [{ worldFactRef: 3 }]]) {
    const wire = encodeVNextStrictToolBundle(bundle(A, [{ kind: 'npcContext', ref: A }]));
    if (value === undefined) delete wire.decision.steps[0].result.response.basis;
    else wire.decision.steps[0].result.response.basis = value;
    const result = parse(wire); assert.equal(result.kind, 'locallyRejected', JSON.stringify(result));
    assert.ok(result.diagnostics.length > 0);
    for (const detail of result.diagnostics) {
      assert.equal(detail.pathBase, 'arguments');
      assert.deepEqual(detail.path.slice(0, 6), ['decision', 'steps', 0, 'result', 'response', 'basis']);
      assert.equal(detail.repair.allowed, false);
    }
  }
});
