import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoritativeKpAdapter } from '../../../app/_runtime/lib/kp/authoritative.ts';
import { narrationReviewDecision, narrationStageModelInput, reviewedNarrationBody } from '../../../app/_runtime/lib/kp/narration-publication.ts';
import { naturalNarrationModelInput, narrationReviewModelInput } from '../../../app/_runtime/lib/kp/narration-vnext.ts';
import { VNEXT_KP_WORKFLOW_HASH, VNEXT_KP_PROFILE } from '../../../app/_runtime/lib/kp/vnext/runtime-policy.ts';
import { requestFor, transfer, reviewFor, problem, response } from '../../support/fixtures/narration.mjs';

// SPEC 0016 §8.3: same factual input, bounded rewrite, no substitute adjudication.
const modelId = VNEXT_KP_PROFILE.modelId;
const generation = body => response('submit_frozen_narration', { body });
const review = report => response('review_frozen_narration', report);
function runWith(responses, options = {}) {
  const calls = [], receipts = [];
  const adapter = createAuthoritativeKpAdapter({ ...options, onInvocationReceipt: r => receipts.push(r),
    ai: { async run(_model, input, runOptions) {
      calls.push({ input, timeoutMs: runOptions?.timeoutMs });
      assert.ok(calls.length <= responses.length, 'no fifth or unproven call');
      return responses[calls.length - 1];
    } } });
  return { adapter, calls, receipts };
}

test('pure wording feedback publishes the exact original for NPC speech and mechanical outcomes', async () => {
  for (const [request, body] of [[requestFor([{ kind: 'sourceClaim', speakerRef: 'npc:a', statement: '不用你们给钱。' }]),
    '林说：“不用你们给钱。”'], [transfer(), '远行者把两面玻璃镜交给药师。']]) {
    for (const uncertain of [false, true]) {
      const report = problem(request, body, uncertain ? 'REVIEW_UNCERTAIN' : 'PRESENTATION',
        'presentation', 'policy:presentation', body, uncertain ? 'uncertain' : 'fail');
      const run = runWith([generation(body), review(report)]);
      assert.equal((await run.adapter.narrate(request)).body, body);
      assert.equal(run.calls.length, 2);
      assert.deepEqual(narrationReviewDecision(review(report), request, body).issues[0].reason, report.issues[0].reason);
    }
  }
});

for (const [code, check, ref, bad] of [
  ['RESULT_CHANGED', 'results', '/payloads/0', '远行者把三面玻璃镜交给药师。'],
  ['PLAYER_AGENCY', 'agency', 'policy:agency', '你决定从此追随远行者。'],
  ['SECRET_DISCLOSURE', 'attribution', 'policy:attribution', '远行者暗中杀死了守卫。'],
]) test(`${code} rewrites once using frozen facts and reviews only the repaired body`, async () => {
  const request = transfer(), good = '远行者把两面玻璃镜交给药师。';
  const report = problem(request, bad, code, check, ref);
  // A soft issue first must never mask the material issue later in the report.
  report.checks.presentation = 'fail';
  report.issues.unshift(problem(request, bad, 'PRESENTATION', 'presentation', 'policy:presentation').issues[0]);
  const responses = [generation(bad), review(report), generation(good), review(reviewFor(request, good))];
  const run = runWith(responses);
  assert.equal((await run.adapter.narrate(request)).body, good);
  assert.equal(run.calls.length, 4); assert.equal(run.receipts.length, 4);
  assert.deepEqual(run.calls[0].input, naturalNarrationModelInput(request, modelId));
  assert.deepEqual(run.calls[1].input, narrationReviewModelInput(request, bad, modelId));
  assert.equal(run.calls[2].input.messages[1].content, run.calls[0].input.messages[1].content);
  assert.equal(JSON.parse(run.calls[3].input.messages[1].content).candidateBody, good);
  assert.equal(reviewedNarrationBody(request, ordinal => responses[ordinal - 1]), good);
  for (const ordinal of [1, 2, 3, 4]) assert.deepEqual(run.calls[ordinal - 1].input,
    narrationStageModelInput(request, ordinal, stage => responses[stage - 1], modelId));
  assert.equal(run.receipts[1].result, 'modelPermanent');
  assert.equal(run.receipts[3].invocationPurpose, 'narrationRepairReview');
});

test('malformed, conflicting and materially uncertain review reports never authorize repair or publication', async () => {
  const request = transfer(), body = '你认定远行者值得信任。';
  const material = problem(request, body, 'PLAYER_AGENCY', 'agency', 'policy:agency');
  const conflicting = structuredClone(material); conflicting.checks.agency = 'pass';
  const malformed = structuredClone(material); malformed.issues.push({ code: 'PRESENTATION' });
  const uncertain = problem(request, body, 'REVIEW_UNCERTAIN', 'continuity', '/facts/0', body, 'uncertain');
  for (const report of [conflicting, malformed, uncertain, { ...material, reviewId: 'wrong-body' }]) {
    const run = runWith([generation(body), review(report)]);
    await assert.rejects(run.adapter.narrate(request));
    assert.equal(run.calls.length, 2);
    assert.throws(() => narrationStageModelInput(request, 3,
      ordinal => [generation(body), review(report)][ordinal - 1], modelId));
  }
});

test('failed second review ends the flow and the four calls share one shrinking deadline', async () => {
  const request = transfer(), body = '你认定远行者值得信任。';
  const refusal = review(problem(request, body, 'PLAYER_AGENCY', 'agency', 'policy:agency'));
  let at = 0;
  const run = runWith([generation(body), refusal, generation(body), refusal], { now: () => { at += 100; return at; } });
  await assert.rejects(run.adapter.narrate(request), error => error.modelInvocationReceipt.groundingReason === 'playerAgency');
  assert.equal(run.calls.length, 4); assert.equal(run.receipts.length, 4);
  assert.equal(run.calls[0].timeoutMs, 180_000);
  assert.ok(run.calls.every((call, i) => i === 0 || call.timeoutMs < run.calls[i - 1].timeoutMs));
  assert.throws(() => reviewedNarrationBody(request, ordinal => [generation(body), refusal, generation(body), refusal][ordinal - 1]));
});

test('the additive publication policy preserves the workflow pinned by existing online rooms', () => {
  // ADR 0027 (2026-09-18) issued event schema room-world-events-vnext-stage3-v2;
  // rooms pinned to the earlier workflow are not replayed, so the pin moves once.
  // 2026-09-21: proposal guidance v31 moved the action-independent rules ahead
  // of the frozen context, so a provider prefix cache covers them across
  // actions, and narration policy v18 made each prompt paragraph conditional on
  // the subject it constrains. Neither changed a word of guidance -- both
  // reproduce the previous text exactly when every subject is present -- but
  // the assembly did, so the pin moves with them. The rooms this leaves behind
  // already carried earlier hashes.
  // 2026-09-23: ADR 0037 changed guidance text (proposal guidance v32, narration
  // policy v19) so check branches stay within their summary; ADR 0039 then
  // withdrew its NPC-line wording rule; proposal guidance v34 asks observations
  // and world interactions to record what present NPCs plainly perceive; v35
  // adds actorSpeech, so listeners hear what was said, not the raw input; v36
  // counts hidden acts and relationship risk as meaningful risk; v37 records
  // a noticed hidden act on the failing side of its check; parser v68 refuses
  // an unwritten (none) branch; guidance v38 and parser v69 route noticeable
  // acts through observe and allow one conversation step per NPC; v39/v70 let
  // a conversation record what its NPC sees the actor do; v40 drops the
  // selection request for extra noticing forms.
  // 2026-09-24: context representation vnext-9 and guidance v41 stop sending
  // server hashes and bodies another entry carries, and the step forms name
  // the step that writes both check results instead of "owning" the check;
  // vnext-10 leaves out the server's reference domain index.
  // Unfinished work re-asks (ADR 0038).
  assert.equal(VNEXT_KP_WORKFLOW_HASH, 'sha256:1c535be37655b9bf0eb17e2f384d7f1502d7ddea4a89be1c3ab16e678847f741');
});
