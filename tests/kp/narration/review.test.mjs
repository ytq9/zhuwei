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
import { frozenNarrationFacts, frozenNarrationReviewContext, narrationReviewModelInput, decodeNarrationReview } from "../../../app/_runtime/lib/kp/narration-vnext.ts";
import { actor, requestFor, transfer, reviewFor, problem, binding } from '../../support/fixtures/narration.mjs';




// These responses are deliberate doubles. They verify contract enforcement,
// not that a real model detects semantic conflicts; live evidence is separate.
test('passing reviews carry no per-fragment or per-fact proof for distinct creation and result types', () => {
  const cases = [transfer(), requestFor([
    { kind: 'sourceClaim', speakerRef: 'npc:a', statement: '我从没见过海。' },
  ]), requestFor([{ kind: 'sceneFeature', featureRef: 'feature:door', description: '门旁放着一把旧椅子。' }])];
  for (const request of cases) {
    const body = frozenNarrationFacts(request).map(f => f.text).join('。');
    const review = reviewFor(request, body);
    assert.deepEqual(decodeNarrationReview(review, request, body).issues, []);
    if (!request.renderableClaims.claims.some(c => ['mechanicalOutcome', 'inventoryOutcome', 'abilityEffectApplied'].includes(c.kind)))
      assert.equal(Object.hasOwn(review, 'resultChecks'), false);
    const input = narrationReviewModelInput(request, body);
    assert.equal(input.tools[0].function.parameters.properties.issues.items.type, 'object');
    assert.deepEqual(Object.keys(input.tools[0].function.parameters.properties),
      frozenNarrationReviewContext(request, body).mechanicalResults.length ? ['reviewId', 'checks', 'resultChecks', 'issues'] : ['reviewId', 'checks', 'issues']);
    assert.equal(input.tools[0].function.parameters.properties.segments, undefined);
    assert.equal(JSON.parse(input.messages[1].content).payloads.length, request.renderableClaims.claims.length);
  }
});


test('zero-mechanical reviews omit resultChecks across schema, response and bounded adapter calls', async () => {
  for (const request of [requestFor([{ kind: 'sourceClaim', speakerRef: 'npc:a', statement: '我从没见过海。' }]),
    requestFor([{ kind: 'sceneFeature', featureRef: 'feature:door', description: '门旁放着一把旧椅子。' }])]) {
    const body = frozenNarrationFacts(request).map(f => f.text).join('。');
    const input = narrationReviewModelInput(request, body), schema = input.tools[0].function.parameters;
    assert.equal(Object.hasOwn(schema.properties, 'resultChecks'), false);
    assert.equal(schema.required.includes('resultChecks'), false);
    assert.equal(input.messages[0].content.includes('resultChecks'), false);
    const valid = reviewFor(request, body), decoded = decodeNarrationReview(valid, request, body);
    assert.equal(Object.hasOwn(decoded, 'resultChecks'), false);
    for (const resultChecks of [{}, { m0: 'complete' }])
      assert.throws(() => decodeNarrationReview({ ...valid, resultChecks }, request, body));
    const run = binding(request, body, valid);
    assert.equal((await run.adapter.narrate(request)).body, body);
    assert.equal(run.calls.length, 2);
  }
});


test('exact candidate body, frozen context, identity and receipt bind each review', () => {
  const request = transfer(), body = '远行者把两面玻璃镜交给药师。';
  const review = reviewFor(request, body);
  assert.throws(() => decodeNarrationReview(review, request, body.replace('两', '三')));
  for (const mutate of [r => r.receipt.receiptId = 'other', r => r.viewerKey = 'other',
    r => r.narrationContext.expression.scene.tone = 'other']) {
    const changed = structuredClone(request); mutate(changed);
    assert.throws(() => decodeNarrationReview(review, changed, body));
  }
  const copy = JSON.parse(JSON.stringify(request));
  assert.deepEqual(frozenNarrationReviewContext(copy, body), frozenNarrationReviewContext(request, body));
});


for (const [code, check, ref, reason] of [
  ['RESULT_CHANGED', 'results', '/payloads/0', 'unsupportedClause'],
  ['RESULT_OMITTED', 'results', '/facts/0', 'missingClaimFacts'],
  ['FACT_CONFLICT', 'continuity', '/facts/0', 'continuityMismatch'],
  ['UNRECORDED_CREATION', 'continuity', 'policy:persist-before-publish', 'unsupportedClause'],
  ['SOURCE_ATTRIBUTION', 'attribution', 'policy:attribution', 'unsupportedClause'],
  ['SECRET_DISCLOSURE', 'attribution', 'policy:attribution', 'unsupportedClause'],
  ['KNOWLEDGE_UPGRADE', 'attribution', 'policy:attribution', 'unsupportedClause'],
  ['PLAYER_AGENCY', 'agency', 'policy:agency', 'playerAgency'],
  ['VIEWER_ROLE', 'agency', '/expression', 'roleMismatch'],
  ['PRESENTATION', 'presentation', 'policy:presentation', 'unnaturalNarration'],
  ['REVIEW_UNCERTAIN', 'continuity', '/facts/0', 'reviewUncertain'],
]) test(`concrete ${code} retains its verified evidence and bounded publication decision`, async () => {
  const request = transfer(), body = '远行者把两面玻璃镜交给药师。';
  const review = problem(request, body, code, check, ref, code === 'RESULT_OMITTED' ? '' : body,
    code === 'REVIEW_UNCERTAIN' ? 'uncertain' : 'fail');
  assert.throws(() => decodeNarrationReview(review, request, body), error => {
    assert.equal(error.reason, reason);
    assert.equal(error.diagnostics[0].constraintRef, ref);
    assert.equal(error.diagnostics[0].start, code === 'RESULT_OMITTED' ? null : 0);
    return true;
  });
  const run = binding(request, body, review);
  if (code === 'PRESENTATION') {
    assert.equal((await run.adapter.narrate(request)).body, body);
    assert.equal(run.calls.length, 2);
    return;
  }
  await assert.rejects(run.adapter.narrate(request), error => {
    assert.equal(error.modelInvocationReceipt.groundingReason, reason);
    assert.equal(error.narrationDiagnostics[0].constraintRef, ref);
    assert.equal(error.narrationDiagnostics[0].reason, review.issues[0].reason);
    assert.doesNotMatch(JSON.stringify(error), /narrationDiagnostics|具体原文/);
    return true;
  });
  assert.equal(run.calls.length, code === 'REVIEW_UNCERTAIN' ? 2 : 4);
});


test('diagnostics reject fabricated quotes, references, assessments and conflicting or incomplete reports', () => {
  const request = transfer(), body = '远行者把两面玻璃镜交给药师。';
  const badReports = [
    r => r.issues.push({ code: 'RESULT_CHANGED', check: 'results', quote: body, occurrence: 0, constraintRef: '/facts/0', reason: '错误' }),
    r => r.checks.results = 'fail', r => delete r.checks.attribution, r => r.checks.newCheck = 'pass',
    r => r.reviewId = 'different', r => r.segments = [],
  ];
  for (const mutate of badReports) { const r = reviewFor(request, body); mutate(r); assert.throws(() => decodeNarrationReview(r, request, body)); }
  for (const mutate of [r => r.issues[0].quote = '不存在于原文', r => r.issues[0].constraintRef = '/facts/999',
    r => r.issues[0].constraintRef = 'secret:canary', r => r.issues[0].reason = '',
    r => r.issues[0].code = 'NAME_SPECIFIC_ERROR', r => r.issues[0].check = 'agency',
    r => r.issues[0].occurrence = 1, r => r.issues[0].quote = '',
    r => r.issues[0].constraintRef = 'policy:persist-before-publish']) {
    const r = problem(request, body, 'FACT_CONFLICT', 'continuity', '/facts/0'); mutate(r);
    assert.throws(() => decodeNarrationReview(r, request, body));
  }
  const repeated = body + body, r = problem(request, repeated, 'RESULT_CHANGED', 'results', '/facts/0', body);
  r.issues[0].occurrence = 1;
  assert.throws(() => decodeNarrationReview(r, request, repeated), e => e.diagnostics[0].start === body.length);
});


test('review keeps duplicate required material without requiring duplicated coverage attestations', () => {
  const request = requestFor([
    { kind: 'inventoryOutcome', itemRef: 'item:mirror', change: 'updated', operation: { kind: 'release', actorRef: actor, quantity: 1, releaseKind: 'placement' }, summary: '已放下。' },
    { kind: 'inventoryOutcome', itemRef: 'item:bolts', change: 'updated', operation: { kind: 'release', actorRef: actor, quantity: 1, releaseKind: 'placement' }, summary: '已放下。' },
    { kind: 'actionCommitted', actorRef: actor, status: 'committed', summary: '已提交。' },
  ], true);
  const body = '你把一面玻璃镜和一支弩矢放下。', context = frozenNarrationReviewContext(request, body);
  assert.equal(context.payloads.length, 3); // no same-text or name-based deduplication
  assert.deepEqual(context.facts, frozenNarrationFacts(request));
  decodeNarrationReview(reviewFor(request, body), request, body);
  // The committed-action receipt is not told beside results: its facts are
  // absent, every told fact is required, and an omission report pointing at
  // a fact that was never offered is a fabricated reference, not a finding.
  assert.equal(context.facts.some(f => f.claimIndex === 2), false);
  assert.ok(context.facts.every(f => f.required));
  const bad = problem(request, body, 'RESULT_OMITTED', 'results', `/facts/${context.facts.length}`, '');
  assert.throws(() => decodeNarrationReview(bad, request, body), e => !e.reason);
});


// Real round50 accepted a cost omission under a single global result check.
// The bounded follow-up tests the model judgment; this test locks its report contract.
test('mechanical results require one explicit completeness decision per group, with concrete omission diagnostics', () => {
  const request = transfer(), body = '结束了。', value = reviewFor(request, body);
  for (const mutate of [r => r.resultChecks = {}, r => r.resultChecks.m0 = 'omitted',
    r => r.resultChecks.m999 = 'complete']) {
    const bad = structuredClone(value); mutate(bad); assert.throws(() => decodeNarrationReview(bad, request, body));
  }
  const omitted = problem(request, body, 'RESULT_OMITTED', 'results', '/facts/0', '');
  assert.throws(() => decodeNarrationReview(omitted, request, body), e => e.reason === 'missingClaimFacts');
});


test('an inconsistent rejection retains the concrete error and its conflicting summary without publishing', async () => {
  const request = transfer(), body = '结束了。';
  const report = problem(request, body, 'RESULT_OMITTED', 'results', '/facts/0', '');
  report.checks.results = 'pass'; report.resultChecks.m0 = 'changed';
  const run = binding(request, body, report);
  await assert.rejects(run.adapter.narrate(request), error => {
    assert.equal(error.modelInvocationReceipt.groundingReason, 'missingClaimFacts');
    assert.equal(error.narrationDiagnostics[0].code, 'RESULT_OMITTED');
    assert.deepEqual(error.narrationReportConflicts, ['checks.results', 'resultChecks.m0']);
    assert.doesNotMatch(JSON.stringify(error), /narrationReportConflicts|具体原文/); return true;
  });
  assert.equal(run.calls.length, 2);
});


test('SPEC 0016 §8.3: malformed issue locations invalidate the whole review while preserving every verified refusal', async () => {
  const request = transfer(), extra = '你也拿起一根蜡烛，装进了背包。', body = `远行者把两面玻璃镜递给了药师。${extra}`;
  const report = problem(request, body, 'RESULT_CHANGED', 'results', '/payloads/0', extra);
  report.checks.continuity = 'fail';
  const malformed = { code: 'UNRECORDED_CREATION', check: 'continuity', constraintRef: 'policy:persist-before-publish',
    quote: extra, occurrence: 1, reason: '这项独立行动没有本次结果支持。' };
  for (const invalidFirst of [false, true]) {
    const mixed = structuredClone(report);
    if (invalidFirst) mixed.issues.unshift(malformed); else mixed.issues.push(malformed);
    assert.throws(() => decodeNarrationReview(mixed, request, body), error => {
      assert.equal(error.name, 'ModelOutputValidationError', 'the malformed whole report is not a valid semantic review');
      assert.equal(error.diagnostics.length, 1);
      assert.equal(error.diagnostics[0].code, 'RESULT_CHANGED'); assert.equal(error.diagnostics[0].occurrence, 0);
      assert.ok(error.reportConflicts.includes(`issues[${invalidFirst ? 0 : 1}].occurrence`));
      return true;
    });
    const run = binding(request, body, mixed);
    await assert.rejects(run.adapter.narrate(request), error => {
      assert.equal(error.modelInvocationReceipt.failureStage, 'narrationSchema');
      assert.equal(error.narrationDiagnostics[0].code, 'RESULT_CHANGED');
      assert.ok(error.narrationReportConflicts.includes(`issues[${invalidFirst ? 0 : 1}].occurrence`));
      assert.doesNotMatch(JSON.stringify(error), /这项独立行动|RESULT_CHANGED|issues\[/); return true;
    });
    assert.equal(run.calls.length, 2);
  }
  const onlyInvalid = reviewFor(request, body); onlyInvalid.checks.continuity = 'fail'; onlyInvalid.issues.push(malformed);
  assert.throws(() => decodeNarrationReview(onlyInvalid, request, body), error => {
    assert.equal(error.name, 'ModelOutputValidationError'); assert.deepEqual(error.diagnostics, []);
    assert.ok(error.reportConflicts.includes('issues[0].occurrence')); return true;
  });
  const rejected = binding(request, body, onlyInvalid);
  await assert.rejects(rejected.adapter.narrate(request), error => {
    assert.equal(error.modelInvocationReceipt.failureStage, 'narrationSchema');
    assert.deepEqual(error.narrationDiagnostics, []); return true;
  });
  assert.equal(rejected.calls.length, 2);
  // A real second occurrence remains addressable; indices are never fixed or
  // blanket-rejected merely because the observed malformed example used 1.
  const repeatedBody = `${body}${extra}`, valid = problem(request, repeatedBody, 'RESULT_CHANGED', 'results', '/payloads/0', extra);
  valid.issues[0].occurrence = 1;
  assert.throws(() => decodeNarrationReview(valid, request, repeatedBody), error => {
    assert.equal(error.name, 'NarrationGroundingValidationError');
    assert.equal(error.diagnostics[0].start, repeatedBody.lastIndexOf(extra)); return true;
  });
});
