import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoritativeKpAdapter } from '../../../app/_runtime/lib/kp/authoritative.ts';
import { narrationStageModelInput, reviewedNarrationBody } from '../../../app/_runtime/lib/kp/narration-publication.ts';
import { transfer, requestFor, response } from '../../support/fixtures/narration.mjs';

const text = body => ({ choices: [{ finish_reason: 'stop', message: { content: body } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
const report = (status, reasons = []) => response('review_frozen_narration', { status, issues: reasons.map(reason => ({ reason })) });
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
    assert.deepEqual(Object.keys(properties), ['status', 'issues']);
    const material = JSON.parse(calls[1].input.messages[1].content);
    for (const key of ['reviewId', 'mechanicalResults', 'constraintRefs']) assert.equal(material[key], undefined);
    assert.equal(material.candidateBody, body);
    assert.equal(reviewedNarrationBody(request, ordinal => responses[ordinal - 1]), body);
    for (const ordinal of [1, 2]) assert.deepEqual(calls[ordinal - 1].input,
      narrationStageModelInput(request, ordinal, i => responses[i - 1], calls[0].model));
  }
});

test('one concrete revision uses the same material and never exceeds four calls', async () => {
  const request = { ...transfer(), narrationPolicy: 'plainText-v1' };
  const bad = '远行者给了药师三面镜子。', good = '远行者把两面玻璃镜交给药师。';
  const responses = [text(bad), report('revise', ['实际转交两面，正文写成三面。']), text(good), report('pass')];
  const { adapter, calls } = run(responses);
  assert.equal((await adapter.narrate(request)).body, good);
  assert.equal(calls.length, 4);
  for (const ordinal of [1, 2, 3, 4]) assert.deepEqual(calls[ordinal - 1].input,
    narrationStageModelInput(request, ordinal, i => responses[i - 1], calls[0].model));
  assert.equal(calls[0].input.messages[1].content, calls[2].input.messages[1].content);
  assert.equal(reviewedNarrationBody(request, ordinal => responses[ordinal - 1]), good);
});

test('truncation, empty prose, uncertain or malformed final reviews never authorize publication', async () => {
  const request = { ...transfer(), narrationPolicy: 'plainText-v1' };
  const body = '远行者把两面玻璃镜交给药师。';
  for (const responses of [[text('')], [{ choices: [{ finish_reason: 'length', message: { content: body } }] }],
    [text(body), report('uncertain', ['冻结材料存在无法解释的矛盾。'])],
    [text(body), report('pass', ['报告自相矛盾。'])],
    [text(body), report('revise', ['实际是两面。']), text(body), response('review_frozen_narration', { wrong: true })]]) {
    const { adapter, calls } = run(responses);
    await assert.rejects(adapter.narrate(request));
    assert.equal(calls.length, responses.length);
    assert.throws(() => reviewedNarrationBody(request, i => responses[i - 1]));
  }
});

// SPEC 0009 §6: live rooms narrate through the plain-text policy, so its
// writing prompt is where an NPC line must become a direct quote.
test('the live plain-text narration writes an NPC line as a direct quote framed by narration', () => {
  const spoken = '叶子啊，含着它下葬，说是跟黑橡有关的物件。';
  const request = { ...requestFor([{ kind: 'sourceClaim', speakerRef: 'npc:a', statement: spoken }]), narrationPolicy: 'plainText-v1' };
  const input = narrationStageModelInput(request, 1, () => undefined, 'deepseek-v4-flash');
  const system = input.messages[0].content;
  assert.ok(system.includes('NPC本次说出的话用引号写成直接引语'), 'the line is quoted');
  assert.ok(system.includes('不改写成“某人说……她还说……”式的间接转述'), 'reported-speech lists are ruled out');
  assert.ok(system.includes('引语前后可以用旁白交代'), 'narration may frame the quote');
  assert.ok(system.includes('旁白不新增事实'), 'the framing adds no facts');
  assert.ok(input.messages[1].content.includes(spoken), 'the frozen line is the material being quoted');
});
