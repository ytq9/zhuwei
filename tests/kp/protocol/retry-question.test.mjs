import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { createVNextProposalOfferModelInput } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseVNextProposalOfferStageResponse, VNextProposalBundleOutputError } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { isVNextRetryQuestion, retryQuestionPendingInputId, retryQuestionSubmissionId, vnextRetryAnswerTask, vnextRetryQuestionTargets,
  withRetryAnswer, RETRY_QUESTION_TOOL_NAME } from '../../../app/_runtime/lib/kp/vnext/retry-question.ts';
import { npcDecisionEntryRef } from '../../../app/_runtime/lib/kp/vnext/context/npc-decision.ts';
import { retryHistoryEntryRef } from '../../../app/_runtime/lib/kp/vnext/retry-history.ts';
import { proposalModelContext } from '../../../app/_runtime/lib/kp/vnext/proposal-context.ts';

// SPEC 0001 §19, SPEC 0016 §7.2 (ADR 0081, ADR 0083): which failed or refused
// rulings the selection may ask about, how the one question is read, and how
// the answer joins the task. The Room path is in
// tests/kp/npc/retry-question.room.test.ts.
const NPC = 'npc:retry:lian', OTHER = 'npc:retry:varo';
function contextWith(conversations) {
  const f = createAuthoredProbeFixture('retry-question', { npcCharacters: [{ id: NPC, name: '莉安' }, { id: OTHER, name: '瓦罗' }] });
  const context = structuredClone(freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [NPC], intentText: '我再试一次。' }).context);
  const entry = context.entries.find(candidate => candidate.entryRef === npcDecisionEntryRef(NPC));
  for (const value of conversations) entry.value.records.push({ ref: `continuity:conversationThreads:${value.threadRef}`, kind: 'conversation',
    value: { schema: 'zhuwei.social-conversation/vnext-1', actorCharacterId: context.intent.actorRef, npcCharacterId: NPC,
      playerExpression: '请告诉我。', addressedThreadRef: null, status: 'closed', ...value } });
  return context;
}
const call = (name, args) => ({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });

test('only a failure of this actor that no later conversation addresses is open to one question', () => {
  const context = contextWith([
    { threadRef: 'conversation:a-failed', outcome: 'failure' },
    { threadRef: 'conversation:b-answered', outcome: 'failure' },
    { threadRef: 'conversation:c-follow-up', outcome: 'success', addressedThreadRef: 'conversation:b-answered' },
    { threadRef: 'conversation:d-success', outcome: 'success' },
    { threadRef: 'conversation:e-someone-else', outcome: 'failure', actorCharacterId: 'character:someone-else' },
  ]);
  assert.deepEqual(vnextRetryQuestionTargets(context), [{ ref: 'conversation:a-failed', npcRef: NPC }]);
  const offer = createVNextProposalOfferModelInput('{}', context);
  assert.deepEqual(offer.tools.map(tool => tool.function.name), ['offer_kp_proposal_bundle', RETRY_QUESTION_TOOL_NAME]);
  assert.deepEqual(offer.tools[1].function.parameters.properties.ref.enum, ['conversation:a-failed']);
  // An action that already asked offers the selection alone.
  const asked = { pendingInputId: retryQuestionPendingInputId('press'), ref: 'conversation:a-failed', npcRef: NPC, question: '有什么不同？' };
  assert.deepEqual(createVNextProposalOfferModelInput('{}', context, asked).tools.map(tool => tool.function.name), ['offer_kp_proposal_bundle']);
  // Without a failure there is nothing to ask about.
  assert.deepEqual(createVNextProposalOfferModelInput('{}', contextWith([])).tools.map(tool => tool.function.name), ['offer_kp_proposal_bundle']);
});

test('the question names an open failure and asks in one short line; anything else is a form error', () => {
  const context = contextWith([{ threadRef: 'conversation:a-failed', outcome: 'failure' }]);
  assert.deepEqual(parseVNextProposalOfferStageResponse(call(RETRY_QUESTION_TOOL_NAME, { ref: 'conversation:a-failed', question: '  这次有什么不同？ ' }), context),
    { kind: 'retryQuestion', ref: 'conversation:a-failed', npcRef: NPC, question: '这次有什么不同？' });
  assert.equal(parseVNextProposalOfferStageResponse(call('offer_kp_proposal_bundle', { requestedCapabilities: ['social'] }), context).kind, 'schemaRequested');
  for (const args of [{ ref: 'conversation:unknown', question: '为什么？' }, { ref: 'conversation:a-failed', question: ' ' },
    { ref: 'conversation:a-failed', question: '问'.repeat(301) }, { ref: 'conversation:a-failed', question: '为什么？', options: [] },
    { threadRef: 'conversation:a-failed', question: '为什么？' }]) {
    assert.throws(() => parseVNextProposalOfferStageResponse(call(RETRY_QUESTION_TOOL_NAME, args), context), VNextProposalBundleOutputError, JSON.stringify(args));
  }
  // A selection that was not offered the tool cannot ask.
  const asked = { pendingInputId: retryQuestionPendingInputId('press'), ref: 'conversation:a-failed', npcRef: NPC, question: '有什么不同？' };
  assert.throws(() => parseVNextProposalOfferStageResponse(call(RETRY_QUESTION_TOOL_NAME, { ref: 'conversation:a-failed', question: '再问一次？' }), context, asked),
    VNextProposalBundleOutputError);
});

test('the answer, or the decline, follows the task as data; before an answer the task is unchanged', () => {
  const question = { pendingInputId: retryQuestionPendingInputId('press'), ref: 'conversation:a-failed', npcRef: NPC, question: '有什么不同？' };
  assert.equal(retryQuestionSubmissionId(question.pendingInputId), 'press');
  assert.equal(retryQuestionSubmissionId('pending:other'), undefined);
  assert.ok(isVNextRetryQuestion(question));
  assert.equal(vnextRetryAnswerTask('TASK', question), 'TASK');
  const answered = { ...question, answer: { submissionId: 'press:answer', text: '我带来了她父亲的信。"}' } };
  const declined = { ...question, answer: { submissionId: 'press:answer', text: null } };
  assert.ok(isVNextRetryQuestion(answered) && isVNextRetryQuestion(declined));
  assert.ok(!isVNextRetryQuestion({ ...answered, answer: { submissionId: 'x', text: '' } }));
  assert.ok(!isVNextRetryQuestion({ ...question, extra: true }));
  const task = vnextRetryAnswerTask('TASK', answered);
  assert.ok(task.startsWith('TASK\n'));
  // The player's words are quoted as JSON, so they cannot close the block.
  assert.ok(task.includes(JSON.stringify({ ref: 'conversation:a-failed', question: '有什么不同？', answer: '我带来了她父亲的信。"}' })));
  assert.ok(vnextRetryAnswerTask('TASK', declined).includes('"answer":null'));
  // A request keeps every message but the task byte for byte.
  const request = Object.freeze({ messages: Object.freeze([{ role: 'system', content: 'SYSTEM' }, { role: 'user', content: 'TASK' },
    { role: 'assistant', content: '' }]), tools: [] });
  const sent = withRetryAnswer(request, answered);
  assert.equal(sent.messages[0], request.messages[0]);
  assert.equal(sent.messages[2], request.messages[2]);
  assert.equal(sent.messages[1].content, task);
  assert.equal(withRetryAnswer(request, question), request);
});

// ADR 0083: a check and a refusal are recorded as precedents; the actor's
// latest one here is open while it failed or refused.
function ruling(actor, seq, outcome, extra = {}) {
  const precedentId = `precedent:${String(seq).padStart(24, '0')}`;
  return { kind: 'known', entryRef: `continuity:adjudicationPrecedents:${precedentId}`, revisionOrHash: `revision:${seq}`,
    value: { schema: 'zhuwei.ruling-precedent/vnext-1', precedentId, rulingEventId: `event:${seq}`, actorCharacterId: actor,
      conditionSignature: { schema: 'zhuwei.precedent-condition-signature/vnext-1', scope: { kind: 'scene', ref: 'scene:gate' },
        formId: outcome === 'refused' ? 'in-world-refusal.vnext-1' : 'world-interaction.vnext-1', targetRefs: ['feature:iron-door'], instrumentRefs: [] },
      canonicalContextFingerprint: `sha256:${'c'.repeat(64)}`, intent: '打开铁门的锁', method: '用撬锁工具撬锁',
      publicExplanation: outcome === 'refused' ? '徒手掰不断铁栏。' : '锁芯卡住了。', privateBasisRefs: ['fact:gate-warded'],
      rulesetProfile: { profileId: 'ruleset:test', profileHash: `sha256:${'d'.repeat(64)}` },
      ruling: outcome === 'refused' ? { kind: 'refusal', rulingKind: 'worldLawViolation', prerequisites: [], nextActions: [] }
        : { kind: 'check', resolutionId: `resolution:${seq}`, abilityRef: null, checkKind: 'tool', ability: 'dexterity', skill: null, dc: 15,
          durationMicros: '300000000', outcomeRange: { success: '锁开了。', failure: '锁没开。' }, outcome },
      status: 'active', rootActionId: `root-action:${seq}`, recordedEventSeq: String(seq), ...extra } };
}
function withEntries(context, ...entries) {
  context.entries.push(...entries);
  return context;
}
const history = (actor, askedRefs, answeredRootActionIds = []) => ({ kind: 'known', entryRef: retryHistoryEntryRef(actor), revisionOrHash: 'revision:history',
  value: { schema: 'zhuwei.retry-question-history/v1', actorRef: actor, askedRefs, answeredRootActionIds } });
const openRefs = context => vnextRetryQuestionTargets(context).map(target => target.ref);

test('of checks and refusals only the actor\'s latest one here is open, while it failed or refused', () => {
  const base = contextWith([]), actor = base.intent.actorRef;
  const failed = ruling(actor, 10, 'failure');
  assert.deepEqual(vnextRetryQuestionTargets(withEntries(contextWith([]), failed)), [{ ref: failed.value.precedentId, npcRef: null }]);
  // A later success, or a later refusal, is what is open now.
  assert.deepEqual(openRefs(withEntries(contextWith([]), failed, ruling(actor, 12, 'success'))), []);
  assert.deepEqual(openRefs(withEntries(contextWith([]), failed, ruling(actor, 12, 'refused'))), [ruling(actor, 12, 'refused').value.precedentId]);
  // Someone else's later ruling is theirs.
  assert.deepEqual(openRefs(withEntries(contextWith([]), failed, ruling('character:someone-else', 12, 'failure'))), [failed.value.precedentId]);
  // The selection offers it by the precedent it names, and the question names no NPC.
  const context = withEntries(contextWith([{ threadRef: 'conversation:a-failed', outcome: 'failure' }]), failed);
  assert.deepEqual(createVNextProposalOfferModelInput('{}', context).tools[1].function.parameters.properties.ref.enum,
    ['conversation:a-failed', failed.value.precedentId].sort());
  assert.deepEqual(parseVNextProposalOfferStageResponse(call(RETRY_QUESTION_TOOL_NAME, { ref: failed.value.precedentId, question: '这次换了什么办法？' }), context),
    { kind: 'retryQuestion', ref: failed.value.precedentId, npcRef: null, question: '这次换了什么办法？' });
  assert.ok(isVNextRetryQuestion({ pendingInputId: retryQuestionPendingInputId('press'), ref: failed.value.precedentId, npcRef: null, question: '有什么不同？' }));
});

test('a ruling already asked about, or made by the action that answered, is not open again', () => {
  const actor = contextWith([]).intent.actorRef, failed = ruling(actor, 10, 'failure');
  assert.deepEqual(openRefs(withEntries(contextWith([]), failed, history(actor, [failed.value.precedentId]))), []);
  // The refusal the answered action made is final, under its completion root too.
  const final = ruling(actor, 12, 'refused', { rootActionId: 'activity-result:root-action:answered' });
  assert.deepEqual(openRefs(withEntries(contextWith([]), failed, final, history(actor, [failed.value.precedentId], ['root-action:answered']))), []);
  // A conversation follows the same two rules.
  assert.deepEqual(openRefs(withEntries(contextWith([{ threadRef: 'conversation:a-failed', outcome: 'failure' }]), history(actor, ['conversation:a-failed']))), []);
  assert.deepEqual(openRefs(withEntries(contextWith([{ threadRef: 'conversation:b-final', outcome: 'failure', rootActionId: 'root-action:answered' }]),
    history(actor, ['conversation:a-failed'], ['root-action:answered']))), []);
  // Another character's history closes nothing for this one.
  assert.deepEqual(openRefs(withEntries(contextWith([]), failed, history('character:someone-else', [failed.value.precedentId]))), [failed.value.precedentId]);
});

test('the model reads a precedent without its server identities and never reads the question history', () => {
  const actor = contextWith([]).intent.actorRef, failed = ruling(actor, 10, 'failure');
  const sent = proposalModelContext(withEntries(contextWith([]), failed, history(actor, ['conversation:old'])));
  assert.ok(!sent.entries.some(entry => entry.entryRef.startsWith('retry-history:')));
  const precedent = sent.entries.find(entry => entry.entryRef === failed.entryRef);
  assert.deepEqual(Object.keys(precedent.value), ['precedentId', 'actorCharacterId', 'recordedEventSeq', 'intent', 'method',
    'targetRefs', 'instrumentRefs', 'publicExplanation', 'ruling']);
  assert.deepEqual(precedent.value.ruling, { kind: 'check', checkKind: 'tool', ability: 'dexterity', skill: null, dc: 15, outcome: 'failure' });
  // The KP-only basis and the frozen context's hash are not sent.
  assert.ok(!JSON.stringify(sent).includes('fact:gate-warded'));
});
