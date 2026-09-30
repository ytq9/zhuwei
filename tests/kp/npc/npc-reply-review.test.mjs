import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_SCENE as SCENE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { worldFactSocialBundle } from '../../support/fixtures/vnext-world-facts.mjs';
import { encodeVNextStrictToolBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { npcOwnModelView } from '../../../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { npcReplyModelInput, NPC_REPLY_TOOL_NAME } from '../../../app/_runtime/lib/kp/vnext/npc-reply.ts';
import { settleNpcConversation, npcReviewModelInput, NPC_REPLY_REVIEW_TOOL, NPC_REVIEW_FIRST_ORDINAL } from '../../../app/_runtime/lib/kp/vnext/npc-reply-review.ts';
import { assertVNextNpcReviewTransition, assertVNextNpcReplyTransition } from '../../../app/_runtime/lib/room/vnext-proposal-invocation.ts';
import { npcReplyArguments, toolCallResponse } from '../../support/fixtures/vnext-npc-replies.mjs';
import { lowerVNext2ProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { stepActionToDecision } from '../../support/fixtures/vnext-action-lifecycle.mjs';
import { canonicalHash } from '../../../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { kpRequestBody } from '../../../app/_runtime/lib/kp/model-request.ts';
import { DEFAULT_KP_MODEL } from '../../../app/_runtime/lib/kp/models.ts';
import { assertDeepSeekStrictToolModelInput } from '../../../app/_runtime/lib/kp/deepseek.ts';

// SPEC 0006 §7, SPEC 0016 §§7.2, 7.3: reviewed authoring is a candidate until
// the same Rules transaction records both the fact and legitimate knowledge.
const NPC = 'npc:review:lian', OTHER = 'npc:review:varo', SECRET = 'HOST_ONLY_神龛石座夹层', SOURCE = 'PRIVATE_ORIGIN_亲自陪父亲来过';
const introduction = { id: 'visits', label: '父亲的习惯', content: '父亲每周来守灵厅两次。', occurrence: '父亲生前。', attitude: 'believed', source: SOURCE };
function fixture(check = false) {
  const f = createAuthoredProbeFixture(`review:${check}`, { npcCharacters: [{ id: NPC, name: '莉安' }, { id: OTHER, name: '瓦罗' }],
    canonicalFacts: [{ id: 'fact:host-secret', kind: 'worldFact', source: 'moduleAnchor', subjectRefs: [SCENE], value: SECRET, visibilityPolicyId: 'visibility:room-authority-only' }] });
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [NPC, OTHER], intentText: '父亲以前常来吗？' }).context;
  const domain = worldFactSocialBundle({ sceneRef: SCENE, npcRef: NPC, check });
  domain.proposals = domain.proposals.slice(1); domain.proposals[0].consumes = [];
  for (const branch of Object.values(domain.proposals[0].branches)) if (branch.response) branch.response.basis = [{ kind: 'npcContext', ref: NPC }];
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(domain)));
  assert.equal(parsed.kind, 'accepted');
  return { ...f, domain, bundle: parsed.bundle, saved: [], reviews: [], rejected: () => [] };
}
function settle(f) { return settleNpcConversation({ bundle: f.bundle, context: f.requiredContext, saved: f.saved, reviews: f.reviews, rejected: f.rejected }); }
function answer(f, introductions = [], text = '父亲每周来守灵厅两次。') {
  const next = settle(f); assert.equal(next.kind, 'ask', JSON.stringify(next));
  const args = npcReplyArguments(f.domain, f.requiredContext).find(row => row.step.hearingHash === next.ticket.hearingHash).arguments;
  for (const branch of Object.values(args)) { branch.introducedContent = structuredClone(introductions); branch.text = text; }
  f.saved.push({ ticket: next.ticket, response: toolCallResponse(NPC_REPLY_TOOL_NAME, args) }); return next;
}
function review(f, decision = 'approve', change = value => value) {
  const next = settle(f); assert.equal(next.kind, 'review', JSON.stringify(next));
  const request = npcReviewModelInput(f.bundle, f.requiredContext, f.saved, next.ticket);
  const body = JSON.parse(request.messages[1].content);
  const response = { status: 'pass', findings: [], privateReason: SECRET, verdicts: body.candidates.map(c => ({ hearingHash: c.hearingHash, outcome: c.outcome,
    introductionId: c.introduction.id, decision, existingRef: 'none', explanation: '符合已授权生活留白，本人曾亲历。' })) };
  f.reviews.push({ ticket: next.ticket, response: toolCallResponse(NPC_REPLY_REVIEW_TOOL, change(response, body)) });
  return { request, next };
}

test('even an empty introduction table requires a saved whole-reply review before admission', () => {
  const f = fixture(); answer(f);
  const { request, next } = review(f);
  assert.match(JSON.stringify(request), new RegExp(SECRET));
  assert.deepEqual(request.tools[0].function.parameters.properties.findings.items.properties.outcome.enum, ['result']);
  assert.deepEqual(request.tools[0].function.parameters.properties.verdicts.items.properties.outcome.enum, ['result']);
  assertDeepSeekStrictToolModelInput(kpRequestBody(DEFAULT_KP_MODEL, request));
  assert.doesNotMatch(JSON.stringify(npcReplyModelInput(f.requiredContext, f.saved[0].ticket.hearing)), new RegExp(SECRET));
  assert.equal(settle(f).kind, 'merged');
  const input = { ordinal: NPC_REVIEW_FIRST_ORDINAL, contextHash: f.requiredContext.binding.contextHash, bindingHash: 'binding', requestHash: canonicalHash(request),
    request: kpRequestBody(DEFAULT_KP_MODEL, request), npcReview: next.ticket };
  assert.doesNotThrow(() => assertVNextNpcReviewTransition(input, f.saved, [], f.requiredContext, f, () => []));
  assert.throws(() => assertVNextNpcReviewTransition({ ...input, ordinal: 140 }, f.saved, [], f.requiredContext, f, () => []));
  // The first controlled real comparison invented introductionId=none for
  // a text finding. Empty candidates never authorize a phantom verdict.
  f.reviews[0].response = toolCallResponse(NPC_REPLY_REVIEW_TOOL, { status: 'revise', privateReason: 'Review the speech.',
    findings: [{ hearingHash: next.ticket.replies[0].hearingHash, outcome: 'result', field: 'text', reason: 'unsupportedKnowledge', ownRefs: [] }],
    verdicts: [{ hearingHash: next.ticket.replies[0].hearingHash, outcome: 'result', introductionId: 'none', decision: 'revise',
      existingRef: 'none', explanation: 'Review the speech.' }] });
  assert.equal(settle(f).kind, 'failed', 'reject a verdict that has no declared candidate');
  f.reviews[0].response = toolCallResponse(NPC_REPLY_REVIEW_TOOL, { status: 'revise', privateReason: 'Review the speech.',
    findings: [{ hearingHash: next.ticket.replies[0].hearingHash, outcome: 'result', field: 'text', reason: 'unsupportedKnowledge',
      ownRefs: [], note: SECRET }], verdicts: [] });
  assert.equal(settle(f).kind, 'failed', 'undeclared finding prose is a protocol failure, not an NPC correction');
  f.reviews[0].response = toolCallResponse(NPC_REPLY_REVIEW_TOOL, { status: 'pass' });
  assert.equal(settle(f).kind, 'failed');
});

test('a review represents an inapplicable existing reference as null, while reuse still requires an owned reference', () => {
  // SPEC 0006 §7: approving new history or retaining a claim needs no existing
  // fact. The local incident returned an approved verdict with existingRef:null.
  for (const decision of ['approve', 'claim']) {
    const f = fixture();
    answer(f, [{ ...introduction, attitude: decision === 'approve' ? 'believed' : 'deception' }]);
    review(f, decision, value => ({ ...value, verdicts: value.verdicts.map(v => ({ ...v, existingRef: null })) }));
    const savedHash = canonicalHash(f.reviews[0].response);
    assert.equal(settle(f).kind, 'merged', decision);
    assert.equal(canonicalHash(f.reviews[0].response), savedHash, 'decoding preserves the saved response identity');
  }
  for (const existingRef of [null, 'fact:host-secret']) {
    const f = fixture(); answer(f, [introduction]);
    review(f, 'existing', value => ({ ...value, verdicts: value.verdicts.map(v => ({ ...v, existingRef })) }));
    assert.equal(settle(f).kind, 'failed', 'reuse must still name a record the NPC owns');
  }
});

test('a reviewed experience uses the normal fact/knowledge transaction, both dice branches keep the same past', () => {
  const f = fixture(true); answer(f, [introduction]);
  const { request } = review(f, 'approve', value => ({ ...value, verdicts: value.verdicts.map(v => ({ ...v, explanation: SECRET })) }));
  assert.deepEqual(request.tools[0].function.parameters.properties.findings.items.properties.outcome.enum, ['success', 'failure']);
  assert.deepEqual(request.tools[0].function.parameters.properties.verdicts.items.properties.outcome.enum, ['success', 'failure']);
  const merged = settle(f); assert.equal(merged.kind, 'merged', JSON.stringify(merged));
  assert.equal(merged.bundle.proposals.filter(p => p.semanticKind === 'worldFact').length, 1);
  const lowered = lowerVNext2ProposalBundle({ ...f, value: merged.bundle });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  const pending = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(pending.kind, 'awaitingRandomness', JSON.stringify(pending));
  assert.deepEqual(pending.state.canonicalFacts, f.state.canonicalFacts);
  const outcomes = [1, 20].map(roll => f.runtime.step(f.profiles, pending.state, { kind: 'fulfillAuthoritativeRandomness', continuation: pending.continuation, rolls: [roll] }));
  for (const result of outcomes) {
    assert.equal(result.kind, 'committed', JSON.stringify(result));
    const definitions = Object.values(result.state.campaignRuntime.definitions).filter(d => d.semanticKind === 'worldFact');
    assert.ok(definitions.some(d => d.content.description === introduction.content));
    assert.ok(Object.values(result.state.knowledge[NPC]).some(k => k.objectKind === 'canonicalFact'));
    const replay = f.runtime.replay(f.genesis, [...pending.events, ...result.events]);
    assert.equal(replay.kind, 'replayed'); assert.deepEqual(replay.state, result.state);
    const nextContext = freezeAuthoredProbeContext(f, result.state, { focusRefs: [NPC, OTHER], intentText: '继续谈刚才那段经历。' }).context;
    assert.doesNotMatch(JSON.stringify(npcOwnModelView(nextContext, NPC)), new RegExp(SECRET));
    assert.match(JSON.stringify(nextContext), /父亲每周来守灵厅两次/);
    const projected = f.runtime.project(f.profiles, result.state, f.viewer);
    assert.doesNotMatch(JSON.stringify(projected), new RegExp(SOURCE));
  }
  assert.deepEqual(outcomes[0].state.canonicalFacts, outcomes[1].state.canonicalFacts);
});

test('an attributed deception keeps its private source and actual speech, without making the claim world truth', () => {
  const f = fixture(); answer(f, [{ ...introduction, attitude: 'deception' }]); review(f, 'claim');
  const merged = settle(f); assert.equal(merged.kind, 'merged', JSON.stringify(merged));
  assert.equal(merged.bundle.proposals.length, 1);
  const l = lowerVNext2ProposalBundle({ ...f, value: merged.bundle }); assert.equal(l.kind, 'accepted', JSON.stringify(l));
  const done = stepActionToDecision(f.runtime, f.profiles, f.state, l.command.rulesInput);
  assert.equal(done.kind, 'committed', JSON.stringify(done));
  assert.deepEqual(done.state.canonicalFacts, f.state.canonicalFacts);
  assert.ok(Object.values(done.state.campaignRuntime.sourceClaims).some(c => c.speakerId === NPC && c.motive.includes(SOURCE)));
  assert.doesNotMatch(JSON.stringify(f.runtime.project(f.profiles, done.state, f.viewer)), new RegExp(SOURCE));
});

test('undeclared or secret content is sent back once, without host prose or other holders; the second rejection fails closed', () => {
  const f = fixture(); answer(f, [], '没有登记的秘密。');
  const reject = (v, body) => ({ ...v, status: 'revise', findings: [{ hearingHash: body.replies[0].hearingHash, outcome: 'result', field: 'text', reason: 'undeclaredContent', ownRefs: [NPC] }] });
  review(f, 'approve', reject);
  const asked = settle(f); assert.equal(asked.kind, 'ask'); assert.equal(asked.ticket.attempt, 2);
  const request = npcReplyModelInput(f.requiredContext, asked.ticket.hearing, asked.ticket.retry);
  assert.doesNotMatch(JSON.stringify(request), new RegExp(SECRET)); assert.match(JSON.stringify(request), /npc-review:undeclaredContent/);
  answer(f, [], '改了措辞仍然越界。'); review(f, 'approve', reject);
  assert.equal(settle(f).kind, 'failed');
  const foreign = fixture(); answer(foreign); review(foreign, 'approve', (v, body) => ({ ...reject(v, body), findings: [{ ...reject(v, body).findings[0], ownRefs: ['fact:host-secret'] }] }));
  assert.equal(settle(foreign).kind, 'failed');
});

test('a successful one-time NPC correction is reviewed again, and incompatible branch histories cannot be admitted', () => {
  const f = fixture(); answer(f); review(f, 'approve', (v, body) => ({ ...v, status: 'revise', findings: [{ hearingHash: body.replies[0].hearingHash, outcome: 'result', field: 'text', reason: 'unsupportedKnowledge', ownRefs: [] }] }));
  answer(f, [], '这件事我不知道。'); review(f); assert.equal(settle(f).kind, 'merged');
  const conflict = fixture(true); answer(conflict, [introduction]);
  const args = JSON.parse(conflict.saved[0].response.choices[0].message.tool_calls[0].function.arguments);
  args.failure.introducedContent[0].content = '父亲从来没有来过。';
  conflict.saved[0].response = toolCallResponse(NPC_REPLY_TOOL_NAME, args); review(conflict);
  assert.equal(settle(conflict).kind, 'failed');
});

test('a whole group is reviewed together but only the rejected NPC is asked again', () => {
  const f = fixture();
  const second = structuredClone(f.domain.proposals[0]); second.npcRef = OTHER; second.basisRefs = [OTHER];
  second.branches.success.response.basis = [{ kind: 'npcContext', ref: OTHER }];
  f.domain.proposals.push(second);
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(f.domain)));
  assert.equal(parsed.kind, 'accepted'); f.bundle = parsed.bundle;
  answer(f); answer(f, [], 'I heard the question.');
  review(f, 'approve', (v, body) => {
    assert.equal(body.replies.length, 2);
    return { ...v, status: 'revise', findings: [{ hearingHash: body.replies[0].hearingHash, outcome: 'result', field: 'text', reason: 'unsupportedKnowledge', ownRefs: [] }] };
  });
  const otherResponse = f.saved[1];
  answer(f, [], 'I do not know.'); review(f);
  assert.equal(settle(f).kind, 'merged'); assert.equal(f.saved.length, 3); assert.deepEqual(f.saved[1], otherResponse);
});

test('a second review reuses the entire frozen-context prefix before changed replies and tickets', () => {
  // SPEC 0016 §7.2: changing the work ticket must not invalidate the long
  // model-readable context prefix. This verifies bytes, not a claimed hit rate.
  const f = fixture(); answer(f);
  const first = review(f, 'approve', (v, body) => ({ ...v, status: 'revise', findings: [{
    hearingHash: body.replies[0].hearingHash, outcome: 'result', field: 'text', reason: 'undeclaredContent', ownRefs: [] }] })).request;
  answer(f, [], '我不知道那件事。');
  const next = settle(f); assert.equal(next.kind, 'review');
  const second = npcReviewModelInput(f.bundle, f.requiredContext, f.saved, next.ticket);
  const left = first.messages[1].content, right = second.messages[1].content;
  const context = JSON.stringify(JSON.parse(left).context);
  let shared = 0; while (left[shared] === right[shared] && shared < Math.min(left.length, right.length)) shared++;
  assert.ok(shared >= left.indexOf(context) + context.length, 'the complete frozen context remains in the reusable prefix');
  assert.notEqual(left, right, 'the changed reply and ticket still reach the reviewer');
});

test('a rejected introduced fact goes back to its own author once, without private Rules expectations', () => {
  // SPEC 0016 §7.2: the ruling never wrote the fact added by review.
  const f = fixture(); answer(f, [introduction]); review(f);
  f.rejected = bundle => {
    const index = bundle.proposals.findIndex(p => p.semanticKind === 'worldFact' && p.definition.description === introduction.content);
    return index < 0 ? [] : [{ code: 'VALUE_INVALID', constraint: 'PRIVATE_RULE_REASON', path: ['proposals', index, 'definition', 'description'],
      actual: SECRET, expected: SECRET, repair: { allowed: true, reason: SECRET } }];
  };
  const next = settle(f);
  assert.equal(next.kind, 'ask'); assert.equal(next.ticket.attempt, 2);
  assert.deepEqual(next.ticket.retry.diagnostics[0].path, ['result', 'introducedContent', 0, 'content']);
  assert.doesNotMatch(JSON.stringify(next.ticket), /HOST_ONLY_|PRIVATE_RULE_REASON/);
  const request = npcReplyModelInput(f.requiredContext, next.ticket.hearing, next.ticket.retry);
  assert.doesNotThrow(() => assertVNextNpcReplyTransition({ ordinal: 12, contextHash: f.requiredContext.binding.contextHash,
    bindingHash: 'binding', requestHash: canonicalHash(request), request: kpRequestBody(DEFAULT_KP_MODEL, request), npcReply: next.ticket },
  f.saved, f.requiredContext, f, f.rejected, f.reviews));
  answer(f, [{ ...introduction, content: '父亲通常每周来守灵厅两次。' }]); review(f);
  assert.equal(settle(f).kind, 'merged');
  f.rejected = bundle => [{ code: 'VALUE_INVALID', constraint: SECRET,
    path: ['proposals', bundle.proposals.findIndex(p => p.semanticKind === 'worldFact'), 'definition', 'description'] }];
  assert.equal(settle(f).kind, 'failed', 'a generated fact cannot buy a third NPC reply');
});

test('a rejection of generated scaffolding fails technically, while the ruling still owns its original fields', () => {
  const f = fixture(); answer(f, [introduction]); review(f);
  f.rejected = bundle => [{ code: 'REFERENCE_UNAVAILABLE', constraint: SECRET,
    path: ['proposals', bundle.proposals.findIndex(p => p.semanticKind === 'worldFact'), 'visibilityPolicyRef'] }];
  assert.equal(settle(f).kind, 'failed', 'the ruling cannot revise a generated definition it never authored');
  f.rejected = () => [{ code: 'CONSTRAINT_CONFLICT', constraint: 'unlocated-rules-rejection' }];
  assert.equal(settle(f).kind, 'failed', 'an unlocated error in a generated plan cannot be attributed to the ruling');
  f.rejected = () => [{ code: 'VALUE_INVALID', constraint: 'ruling:method-invalid', path: ['proposals', 0, 'method'] }];
  const original = settle(f);
  assert.equal(original.kind, 'merged'); assert.equal(original.ruling[0].constraint, 'ruling:method-invalid');
});

test('an existing own source is reused without duplicate basis refs or a new world fact', () => {
  const f = fixture(); answer(f, [introduction]);
  review(f, 'existing', v => ({ ...v, verdicts: v.verdicts.map(row => ({ ...row, existingRef: NPC })) }));
  const merged = settle(f); assert.equal(merged.kind, 'merged', JSON.stringify(merged));
  assert.equal(merged.bundle.proposals.length, 1);
  assert.deepEqual(merged.bundle.proposals[0].branches.success.response.basis, [{ kind: 'npcContext', ref: NPC }]);
});
