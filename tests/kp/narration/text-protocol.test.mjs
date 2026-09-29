import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoritativeKpAdapter } from '../../../app/_runtime/lib/kp/authoritative.ts';
import { narrationStageModelInput, reviewedNarrationBody, narrationCanContinue } from '../../../app/_runtime/lib/kp/narration-publication.ts';
import { transfer, requestFor, response } from '../../support/fixtures/narration.mjs';
import { textNarrationReviewInput, TEXT_NARRATION_POLICY } from '../../../app/_runtime/lib/kp/narration-text.ts';
import { assertDeepSeekStrictToolModelInput } from '../../../app/_runtime/lib/kp/deepseek.ts';
import { assertOpenAIStrictToolModelInput } from '../../../app/_runtime/lib/kp/openai.ts';
import { kpRequestBody } from '../../../app/_runtime/lib/kp/model-request.ts';
import { DEFAULT_KP_MODEL, GPT_6_LUNA_MODEL } from '../../../app/_runtime/lib/kp/models.ts';

const text = body => ({ choices: [{ finish_reason: 'stop', message: { content: body } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
const report = (status, reasons = [], body = '') => response('review_frozen_narration', { status, issues: reasons.map(reason => ({ reason })), body });
const run = responses => {
  const calls = [];
  const adapter = createAuthoritativeKpAdapter({ ai: { async run(model, input, options) {
    calls.push({ model, input, timeoutMs: options.timeoutMs });
    assert.ok(calls.length <= responses.length);
    return responses[calls.length - 1];
  } } });
  return { adapter, calls };
};

// SPEC 0015 §7 / SPEC 0016 §8.3: mechanical transfer and NPC speech use the
// same plain-text generation and compact exception report.
test('plain text and a passing report publish in two exactly bound calls', async () => {
  for (const [source, body] of [[transfer(), '远行者把两面玻璃镜交给药师。'],
    [requestFor([{ kind: 'sourceClaim', speakerRef: 'npc:a', statement: '不用你们给钱。' }]), '林说：“不用你们给钱。”']]) {
    const request = { ...source, narrationPolicy: 'plainText-v1' };
    const responses = [text(body), report('pass')], { adapter, calls } = run(responses);
    assert.equal((await adapter.narrate(request)).body, body);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].input.tools, undefined);
    assert.equal(calls[0].input.response_format, undefined);
    const properties = calls[1].input.tools[0].function.parameters.properties;
    assert.deepEqual(Object.keys(properties), ['status', 'issues', 'body']);
    const material = JSON.parse(calls[1].input.messages[1].content);
    for (const key of ['reviewId', 'mechanicalResults', 'constraintRefs']) assert.equal(material[key], undefined);
    assert.equal(material.candidateBody, body);
    assert.equal(reviewedNarrationBody(request, ordinal => responses[ordinal - 1]), body);
    for (const ordinal of [1, 2]) assert.deepEqual(calls[ordinal - 1].input,
      narrationStageModelInput(request, ordinal, i => responses[i - 1], calls[0].model));
  }
});

// SPEC 0016 §8.3, ADR 0070: the refusing review writes the corrected body.
test('a refusal carries the corrected body; when its review passes it is published in three calls', async () => {
  const request = { ...transfer(), narrationPolicy: 'plainText-v1' };
  const bad = '远行者给了药师三面镜子。', good = '远行者把两面玻璃镜交给药师。';
  const responses = [text(bad), report('revise', ['实际转交两面，正文写成三面。'], good), report('pass')];
  const { adapter, calls } = run(responses);
  assert.equal((await adapter.narrate(request)).body, good);
  assert.equal(calls.length, 3);
  for (const ordinal of [1, 2, 3]) assert.deepEqual(calls[ordinal - 1].input,
    narrationStageModelInput(request, ordinal, i => responses[i - 1], calls[0].model));
  assert.throws(() => narrationStageModelInput(request, 4, i => responses[i - 1], calls[0].model));
  // Both reviews judge the same frozen material; only the candidate differs.
  const [first, second] = [calls[1], calls[2]].map(call => JSON.parse(call.input.messages[1].content));
  assert.equal(first.candidateBody, bad);
  assert.equal(second.candidateBody, good);
  assert.deepEqual({ ...first, candidateBody: null }, { ...second, candidateBody: null });
  assert.equal(calls[2].input.messages[0].content, calls[1].input.messages[0].content);
  assert.equal(reviewedNarrationBody(request, ordinal => responses[ordinal - 1]), good);
  assert.equal(narrationCanContinue(request, i => responses.slice(0, 2)[i - 1], calls[0].model), true);
  assert.equal(narrationCanContinue(request, i => responses[i - 1], calls[0].model), true);
});

// SPEC 0016 §8.3, ADR 0071: the second review may correct once more.
test('the second review may correct once more; the final review only judges, in four calls', async () => {
  const request = { ...transfer(), narrationPolicy: 'plainText-v1' };
  const bad = '远行者给了药师三面镜子。', partly = '远行者把两面镜子借给了药师。', good = '远行者把两面玻璃镜交给药师。';
  const refusals = [report('revise', ['实际转交两面，正文写成三面。'], partly), report('revise', ['实际是交给，正文写成借给。'], good)];
  const responses = [text(bad), ...refusals, report('pass')];
  const { adapter, calls } = run(responses);
  assert.equal((await adapter.narrate(request)).body, good);
  assert.equal(calls.length, 4);
  for (const ordinal of [1, 2, 3, 4]) assert.deepEqual(calls[ordinal - 1].input,
    narrationStageModelInput(request, ordinal, i => responses[i - 1], calls[0].model));
  assert.deepEqual([calls[1], calls[2], calls[3]].map(call => JSON.parse(call.input.messages[1].content).candidateBody), [bad, partly, good]);
  assert.equal(reviewedNarrationBody(request, ordinal => responses[ordinal - 1]), good);
  for (const saved of [2, 3, 4]) assert.equal(narrationCanContinue(request, i => responses.slice(0, saved)[i - 1], calls[0].model), true);

  // A refusal by the final review ends the reply: its body is never published
  // and there is no fifth call.
  const refused = [text(bad), ...refusals, report('revise', ['仍有问题。'], '远行者把两面镜子交给了药师。')];
  const last = run(refused);
  await assert.rejects(last.adapter.narrate(request));
  assert.equal(last.calls.length, 4);
  assert.throws(() => reviewedNarrationBody(request, i => refused[i - 1]));
  assert.equal(narrationCanContinue(request, i => refused[i - 1], calls[0].model), false);
});

test('truncation, empty prose, uncertain or malformed final reviews never authorize publication', async () => {
  const request = { ...transfer(), narrationPolicy: 'plainText-v1' };
  const body = '远行者把两面玻璃镜交给药师。';
  for (const responses of [[text('')], [{ choices: [{ finish_reason: 'length', message: { content: body } }] }],
    [text(body), report('uncertain', ['冻结材料存在无法解释的矛盾。'])],
    [text(body), report('pass', ['报告自相矛盾。'])],
    [text(body), report('pass', [], body)],
    [text(body), report('uncertain', ['冻结材料存在无法解释的矛盾。'], body)],
    // A refusal without a corrected body, or with the refused body unchanged.
    [text(body), report('revise', ['实际是两面。'])],
    [text(body), report('revise', ['实际是两面。'], body)],
    [text(body), response('review_frozen_narration', { status: 'pass', issues: [] })],
    [text(body), report('revise', ['实际是两面。'], '远行者交出了两面玻璃镜。'), response('review_frozen_narration', { wrong: true })]]) {
    const { adapter, calls } = run(responses);
    await assert.rejects(adapter.narrate(request));
    assert.equal(calls.length, responses.length);
    assert.throws(() => reviewedNarrationBody(request, i => responses[i - 1]));
  }
});

// SPEC 0016 §8.3, ADR 0070, ADR 0072: writer and reviewer are told the same two
// things the material alone does not say: what a voice note is for, and that
// a question the material cannot answer is answered with what is not known.
test('generation and review carry the voice rule and the not-known rule', () => {
  const request = { ...transfer(), narrationPolicy: 'plainText-v1' };
  const prompts = [narrationStageModelInput(request, 1, () => undefined, DEFAULT_KP_MODEL),
    textNarrationReviewInput(request, '远行者把两面玻璃镜交给药师。', DEFAULT_KP_MODEL)].map(input => input.messages[0].content);
  for (const prompt of prompts) {
    assert.ok(prompt.includes('声口里列出的话题，这次台词没有说到的不写'));
    assert.ok(prompt.includes('冻结资料里没有答案时，如实说角色目前不知道'));
    assert.ok(prompt.includes('资料没有写明是同一个的人或物，不说成同一个'));
  }
});

// SPEC 0016 §8.3, ADR 0069: the DeepSeek review reasons before it reports.
test('the DeepSeek review reasons with an offered tool; another provider keeps the forced direct call', () => {
  const request = { ...transfer(), narrationPolicy: 'plainText-v1' };
  const body = '远行者把两面玻璃镜交给药师。';
  const deepseek = textNarrationReviewInput(request, body, DEFAULT_KP_MODEL);
  const luna = textNarrationReviewInput(request, body, GPT_6_LUNA_MODEL);
  const transport = input => ({ tool_choice: input.tool_choice, thinking: input.thinking,
    reasoning_effort: input.reasoning_effort, max_completion_tokens: input.max_completion_tokens });
  assert.deepEqual(transport(deepseek), { tool_choice: 'auto', thinking: { type: 'enabled' },
    reasoning_effort: 'low', max_completion_tokens: 16_384 });
  assert.deepEqual(transport(luna), { tool_choice: 'required', thinking: { type: 'disabled' },
    reasoning_effort: undefined, max_completion_tokens: 2_048 });
  assert.equal(Object.hasOwn(luna, 'reasoning_effort'), false);
  // Prompt, report structure and material are the same for both.
  for (const key of ['messages', 'tools', 'parallel_tool_calls']) assert.deepEqual(deepseek[key], luna[key]);
  assert.deepEqual(Object.keys(deepseek.tools[0].function.parameters.properties), ['status', 'issues', 'body']);
  assert.doesNotThrow(() => assertDeepSeekStrictToolModelInput(deepseek));
  assert.doesNotThrow(() => assertOpenAIStrictToolModelInput(kpRequestBody(GPT_6_LUNA_MODEL, luna)));
  assert.deepEqual(TEXT_NARRATION_POLICY.reviewTransport.deepseek, transport(deepseek));
  assert.equal(TEXT_NARRATION_POLICY.version, 'zhuwei.text-narration/v6');
  assert.equal(TEXT_NARRATION_POLICY.maximumCalls, 4);
});

test('a reasoning review that answers in text, runs out of output or adds text beside its report never publishes', async () => {
  const request = { ...transfer(), narrationPolicy: 'plainText-v1' };
  const body = '远行者把两面玻璃镜交给药师。';
  const passing = report('pass');
  const reasoned = { ...passing, choices: [{ ...passing.choices[0],
    message: { ...passing.choices[0].message, reasoning_content: '逐项核对人物、数量和来源。' } }] };
  const { adapter, calls } = run([text(body), reasoned]);
  assert.equal((await adapter.narrate(request)).body, body);
  assert.equal(calls[1].input.tool_choice, 'auto');
  for (const review of [
    { choices: [{ finish_reason: 'stop', message: { content: '没有问题。', reasoning_content: '核对完毕。' } }] },
    { choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: '核对到一半。' } }] },
    { ...passing, choices: [{ ...passing.choices[0], message: { ...passing.choices[0].message, content: '没有问题。' } }] }]) {
    const attempt = run([text(body), review]);
    await assert.rejects(attempt.adapter.narrate(request));
    assert.equal(attempt.calls.length, 2);
    assert.throws(() => reviewedNarrationBody(request, i => [text(body), review][i - 1]));
  }
});
