// Behavior assertions grouped by function; see README.md in this directory.
/**
 * Gate for SPEC 0016 §8.3: continuity review reports contradicting facts
 * instead of building a per-fragment evidence matrix.
 *
 * A passing review carries no per-fragment or per-fact proof; completeness is
 * checked once per committed mechanical group; a zero-mechanical review omits
 * resultChecks entirely, which is also the shape the real provider accepts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { freezeNarrationContext } from "../../../app/_runtime/lib/kp/narration-context.ts";
import { kpRequestDeclaresStrictTool } from "../../../app/_runtime/lib/kp/authoritative-policy.ts";
import { naturalNarrationContext, extractFrozenNarrationResponse, VNEXT_NARRATION_SCHEMA, NARRATION_REVIEW_SCHEMA } from "../../../app/_runtime/lib/kp/narration-vnext.ts";
import { actor, requestFor, transfer, reviewFor, response, jsonResponse, binding } from '../../support/fixtures/narration.mjs';


test('natural paraphrase is reviewed once, keeps actor identity, and returns the original body with two accurate receipts', async () => {
  const request = transfer(), body = '远行者把两面玻璃镜递给了药师。';
  const run = binding(request, body, reviewFor(request, body));
  const result = await run.adapter.narrate(request);
  assert.equal(result.body, body);
  assert.deepEqual(run.receipts.map(r => [r.invocationPurpose, r.schemaVersion, r.inputTokens, r.outputTokens]),
    [['initialNarration', VNEXT_NARRATION_SCHEMA, 101, 23], ['narrationReview', NARRATION_REVIEW_SCHEMA, 101, 23]]);
  assert.equal(naturalNarrationContext(request).expression.isActorViewer, false);
  assert.ok(!JSON.stringify(run.receipts).includes('玻璃镜'));
  assert.ok(!JSON.stringify(run.receipts).includes('segments'));
  assert.equal(JSON.parse(run.calls[1].input.messages[1].content).candidateBody, body);
  for (const [index, { input }] of run.calls.entries()) {
    // SPEC 0015 §7、SPEC 0016 §8.3: body-only generation and one review,
    // both with bounded strict output; no reasoning can consume the body budget.
    assert.deepEqual(input.thinking, { type: 'disabled' });
    assert.equal(input.reasoning_effort, undefined);
    assert.equal(input.tool_choice, 'required');
    assert.equal(kpRequestDeclaresStrictTool(input), true);
    assert.equal(input.tools[0].function.strict, true);
    assert.equal(input.parallel_tool_calls, false);
    assert.equal(input.response_format, undefined);
    if (index === 0) {
      assert.equal(input.tools[0].function.name, 'submit_frozen_narration');
      assert.deepEqual(input.tools[0].function.parameters, {
        type: 'object', additionalProperties: false, properties: { body: { type: 'string' } }, required: ['body'],
      });
    }
    assert.ok(input.max_completion_tokens > 4096 && input.max_completion_tokens <= 8192);
  }
});


test('ordinary action realization remains grounded without granting new mechanics or player intent', async () => {
  const request = requestFor([{ kind: 'inventoryOutcome', itemRef: 'item:bolts', change: 'updated',
    operation: { kind: 'release', actorRef: actor, quantity: 1, releaseKind: 'placement' }, summary: '放下一支弩矢。' }], true);
  const body = '你俯身将一支弩矢轻轻放下。';
  const run = binding(request, body, reviewFor(request, body));
  assert.equal((await run.adapter.narrate(request)).body, body);
  assert.equal(run.calls.length, 2);
});


test('invalid frozen binding and input capacity fail before provider without fabricated invocation receipt', async () => {
  const request = transfer(), body = '远行者把两面玻璃镜交给药师。';
  for (const bad of ['binding', 'budget']) {
    const changed = structuredClone(request);
    if (bad === 'binding') changed.narrationContext.expression.actor.name = '另一人';
    else changed.narrationContext = freezeNarrationContext(changed.renderableClaims, { ...changed.narrationContext.expression,
      actorIntent: null, actorIntentOrigin: null, establishedDetails: [{ detailRef: 'detail:long', description: '历史'.repeat(16000) }] });
    const run = binding(changed, body, reviewFor(changed, body));
    await assert.rejects(run.adapter.narrate(changed), e => e.publicCode === (bad === 'binding' ? 'NARRATION_BODY_INVALID' : 'NARRATION_CONTEXT_BUDGET_EXCEEDED'));
    assert.equal(run.calls.length, 0); assert.equal(run.receipts.length, 0);
  }
});


test('malformed generated body and leaked internal reference stop after the only real invocation', async () => {
  const request = transfer();
  for (const candidate of [{ body: '正常', approved: true }, { body: 'item:mirror 在这里。' }, { body: '' }]) {
    const run = binding(request, '', {}, { candidate });
    await assert.rejects(run.adapter.narrate(request));
    assert.equal(run.calls.length, 1); assert.equal(run.receipts.length, 1);
  }
});


test('vNext narration enforces its declared response mode, complete finish and unique JSON members at every depth', async () => {
  const request = transfer(), body = '远行者把两面玻璃镜交给了药师。';
  const duplicates = response('submit_frozen_narration', { body });
  duplicates.choices[0].message.tool_calls[0].function.arguments = '{"body":"前文","body":"后文"}';
  const incomplete = response('submit_frozen_narration', { body }); incomplete.choices[0].finish_reason = 'length';
  const trailing = response('submit_frozen_narration', { body });
  trailing.choices[0].message.tool_calls[0].function.arguments += "'}";
  const multiple = response('submit_frozen_narration', { body });
  multiple.choices[0].message.tool_calls.push(multiple.choices[0].message.tool_calls[0]);
  const mixed = response('submit_frozen_narration', { body }); mixed.choices[0].message.content = '另一份正文';
  const legacy = response('submit_frozen_narration', { body }); legacy.choices[0].message.function_call = { name: 'submit_frozen_narration', arguments: JSON.stringify({ body }) };
  // The actual reasoning-only truncation and invalid JSON tail remain failures,
  // even if a provider violates its strict-output declaration.
  const reasoningOnly = jsonResponse({ body }); reasoningOnly.choices[0].finish_reason = 'length';
  reasoningOnly.choices[0].message.content = '';
  for (const candidateResponse of [duplicates, incomplete, trailing, multiple, mixed, legacy, reasoningOnly,
    response('submit_current_narration', { body }), jsonResponse({ body }), response('submit_frozen_narration', { result: { body } })]) {
    const run = binding(request, body, reviewFor(request, body), { candidateResponse });
    await assert.rejects(run.adapter.narrate(request), e => e.publicCode === 'NARRATION_BODY_INVALID');
    assert.equal(run.calls.length, 1); assert.equal(run.receipts.length, 1);
  }
  const review = response('review_frozen_narration', reviewFor(request, body));
  review.choices[0].message.tool_calls[0].function.arguments = '{"segments":[{"index":0,"index":1}]}';
  assert.throws(() => extractFrozenNarrationResponse(review, 'review'));
  assert.throws(() => extractFrozenNarrationResponse(jsonResponse(reviewFor(request, body)), 'review'));
});
