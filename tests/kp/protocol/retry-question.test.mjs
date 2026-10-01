import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { createVNextProposalOfferModelInput } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseVNextProposalOfferStageResponse, VNextProposalBundleOutputError } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { isVNextRetryQuestion, retryQuestionPendingInputId, retryQuestionSubmissionId, vnextRetryAnswerTask, vnextRetryQuestionThreads,
  withRetryAnswer, RETRY_QUESTION_TOOL_NAME } from '../../../app/_runtime/lib/kp/vnext/retry-question.ts';
import { npcDecisionEntryRef } from '../../../app/_runtime/lib/kp/vnext/context/npc-decision.ts';

// SPEC 0001 §19, SPEC 0016 §7.2 (ADR 0081): which failed conversations the
// selection may ask about, how the one question is read, and how the answer
// joins the task. The Room path is in tests/kp/npc/retry-question.room.test.ts.
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
  assert.deepEqual(vnextRetryQuestionThreads(context), [{ threadRef: 'conversation:a-failed', npcRef: NPC }]);
  const offer = createVNextProposalOfferModelInput('{}', context);
  assert.deepEqual(offer.tools.map(tool => tool.function.name), ['offer_kp_proposal_bundle', RETRY_QUESTION_TOOL_NAME]);
  assert.deepEqual(offer.tools[1].function.parameters.properties.threadRef.enum, ['conversation:a-failed']);
  // An action that already asked offers the selection alone.
  const asked = { pendingInputId: retryQuestionPendingInputId('press'), threadRef: 'conversation:a-failed', npcRef: NPC, question: '有什么不同？' };
  assert.deepEqual(createVNextProposalOfferModelInput('{}', context, asked).tools.map(tool => tool.function.name), ['offer_kp_proposal_bundle']);
  // Without a failure there is nothing to ask about.
  assert.deepEqual(createVNextProposalOfferModelInput('{}', contextWith([])).tools.map(tool => tool.function.name), ['offer_kp_proposal_bundle']);
});

test('the question names an open failure and asks in one short line; anything else is a form error', () => {
  const context = contextWith([{ threadRef: 'conversation:a-failed', outcome: 'failure' }]);
  assert.deepEqual(parseVNextProposalOfferStageResponse(call(RETRY_QUESTION_TOOL_NAME, { threadRef: 'conversation:a-failed', question: '  这次有什么不同？ ' }), context),
    { kind: 'retryQuestion', threadRef: 'conversation:a-failed', npcRef: NPC, question: '这次有什么不同？' });
  assert.equal(parseVNextProposalOfferStageResponse(call('offer_kp_proposal_bundle', { requestedCapabilities: ['social'] }), context).kind, 'schemaRequested');
  for (const args of [{ threadRef: 'conversation:unknown', question: '为什么？' }, { threadRef: 'conversation:a-failed', question: ' ' },
    { threadRef: 'conversation:a-failed', question: '问'.repeat(301) }, { threadRef: 'conversation:a-failed', question: '为什么？', options: [] }]) {
    assert.throws(() => parseVNextProposalOfferStageResponse(call(RETRY_QUESTION_TOOL_NAME, args), context), VNextProposalBundleOutputError, JSON.stringify(args));
  }
  // A selection that was not offered the tool cannot ask.
  const asked = { pendingInputId: retryQuestionPendingInputId('press'), threadRef: 'conversation:a-failed', npcRef: NPC, question: '有什么不同？' };
  assert.throws(() => parseVNextProposalOfferStageResponse(call(RETRY_QUESTION_TOOL_NAME, { threadRef: 'conversation:a-failed', question: '再问一次？' }), context, asked),
    VNextProposalBundleOutputError);
});

test('the answer, or the decline, follows the task as data; before an answer the task is unchanged', () => {
  const question = { pendingInputId: retryQuestionPendingInputId('press'), threadRef: 'conversation:a-failed', npcRef: NPC, question: '有什么不同？' };
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
  assert.ok(task.includes(JSON.stringify({ threadRef: 'conversation:a-failed', question: '有什么不同？', answer: '我带来了她父亲的信。"}' })));
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
