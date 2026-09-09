import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoritativeKpAdapter } from '../app/_runtime/lib/kp/authoritative.ts';
import { freezeNarrationContext } from '../app/_runtime/lib/kp/narration-context.ts';
import { frozenNarrationReviewContext } from '../app/_runtime/lib/kp/narration-vnext.ts';
import { handleRoomAction, handleViewerNarrationRecovery } from '../app/_runtime/lib/room/action.ts';
import { deriveAuthorityClaims, projectRenderableClaims } from '../app/_runtime/lib/rules/v2/claims.ts';
import { INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE } from '../app/_runtime/lib/rules/profiles/manifests.ts';
import { publicNarrationFailureReason, publicNarrationRecoveryReason, publicV3FailureCode, publicAuthoritativeOutcomeError } from '../app/_runtime/lib/table/authoritative.ts';
import { buildRoomTelemetryEvent, failureCodeIsRetryable } from '../app/_runtime/lib/room/telemetry.ts';

const principal = { id: 'principal:reader', sessionVersion: 1 }, actor = 'character:reader';
const BODY = '你把两面玻璃镜放在桌上。', SECRET = 'PRIVATE_PROVIDER_REQUEST_CANARY';
test('vNext follow-up failures expose closed categories without disclosing private decision context', () => {
  for (const [internal, visible] of [['DUE_DECISION_INVALID', 'FOLLOWUP_DECISION_INVALID'],
    ['ACTOR_PLAN_DECISION_INVALID', 'FOLLOWUP_DECISION_INVALID'],
    ['ACTOR_PLAN_DECISION_OUTCOME_UNKNOWN', 'FOLLOWUP_DECISION_OUTCOME_UNKNOWN']]) {
    assert.equal(publicV3FailureCode(internal), visible);
    const event = buildRoomTelemetryEvent({ failure: { code: internal, message: SECRET } });
    assert.equal(event.errorCode, visible);
    const message = publicAuthoritativeOutcomeError({ kind: 'rejected', code: internal, message: SECRET });
    assert.match(message, /已暂停|执行已暂停/);
    assert.doesNotMatch(JSON.stringify({ event, message }), new RegExp(SECRET));
  }
  assert.equal(publicV3FailureCode(SECRET), undefined);
});
function fixture() {
  const receipt = { rootActionId: 'root:provider-failure', receiptId: 'receipt:provider-failure', status: 'committed' };
  const renderableClaims = projectRenderableClaims(deriveAuthorityClaims({ ...receipt, materials: [{
    claimRef: 'claim:release', basis: { authorityRefs: [], viewerRefs: [] }, visibility: { kind: 'public' },
    kind: 'inventoryOutcome', itemRef: 'item:mirror', change: 'updated',
    operation: { kind: 'release', actorRef: actor, quantity: 2, releaseKind: 'placement' }, summary: '放下两面玻璃镜。',
  }] }), { viewerKey: `${principal.id}\u001f${actor}`, refs: [actor, 'item:mirror'], displayNames: { [actor]: '远行者', 'item:mirror': '玻璃镜' } });
  const narrationContext = freezeNarrationContext(renderableClaims, { viewer: { characterRef: actor, name: '远行者' },
    actor: { characterRef: actor, name: '远行者' }, actorIntent: '放下两面玻璃镜。', scene: { name: '会客室', tone: '平静' },
    characters: [], establishedDetails: [], recentDialogue: [] });
  return { ...receipt, receipt, narrationInputMode: 'frozenRenderableClaims-vnext-1',
    viewerKey: renderableClaims.viewerKey, renderableClaims, narrationContext };
}
function model(request, mode = 'success') {
  const calls = [], receipts = [];
  const reviewContext = frozenNarrationReviewContext(request, BODY);
  const report = { reviewId: reviewContext.reviewId,
    checks: { results: 'pass', continuity: 'pass', attribution: 'pass', agency: 'pass', presentation: 'pass' },
    resultChecks: Object.fromEntries(reviewContext.mechanicalResults.map(result => [result.key, 'complete'])), issues: [] };
  if (mode === 'grounding') {
    report.checks.results = 'fail';
    const result = reviewContext.mechanicalResults[0];
    report.resultChecks[result.key] = 'changed';
    report.issues.push({ code: 'RESULT_CHANGED', check: 'results', constraintRef: result.constraintRef,
      quote: BODY, occurrence: 0, reason: '报告明确指出实际结算数量与正文不符。' });
  }
  const adapter = createAuthoritativeKpAdapter({ onInvocationReceipt: receipt => receipts.push(receipt), ai: { async run(_model, input) {
    calls.push(input); assert.ok(calls.length <= 2, 'publication never repairs or adds a provider call');
    if ((mode === 'generationRejected' && calls.length === 1) || (mode === 'reviewRejected' && calls.length === 2))
      throw Object.assign(new Error(SECRET), { status: 400 });
    if (mode === 'rateLimited' && calls.length === 2) throw Object.assign(new Error(SECRET), { status: 429 });
    if (calls.length === 1) return { choices: [{ message: { content: JSON.stringify(mode === 'malformed' ? { body: BODY, extra: SECRET } : { body: BODY }) }, finish_reason: 'stop' }] };
    return { choices: [{ message: { tool_calls: [{ type: 'function', function: {
      name: 'review_frozen_narration', arguments: JSON.stringify(report),
    } }] }, finish_reason: 'tool_calls' }] };
  } } });
  return { calls, receipts, adapter };
}
function room(request, adapter) {
  let failure, publishedBody;
  const counts = { propose: 0, commit: 0, publish: 0, recoverPublish: 0 };
  const deliveryPlan = { deliveryProtocol: INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE,
    rootActionId: request.rootActionId, receiptId: request.receipt.receiptId, publishCapability: 'publication:capability',
    audiences: [{ audienceId: 'audience:reader', principalId: principal.id, characterId: actor,
      narrationInputMode: request.narrationInputMode, projectionHash: request.renderableClaims.projectionHash,
      kpProjection: { renderableClaims: request.renderableClaims, narrationContext: request.narrationContext } }] };
  const authority = {
    async prepare() { return { kind: 'prepared', preparedActionId: 'prepared:release', rootActionId: request.rootActionId, kpProjection: {} }; },
    async commit() { counts.commit++; return { kind: 'committed', receipt: request.receipt, deliveryPlan }; },
    async observe() { return { readModel: {}, ...(failure ? { narrationRecovery: { kind: 'available', capability: 'recovery:capability', state: failure.state } } : {}) }; },
    async beginDeliveryAudiencePublication() { return { kind: 'pending', deliveryGeneration: 1 }; },
    async failDeliveryAudiencePublication(_capability, value) { failure = value; return { kind: value.state }; },
    async publishDelivery(_capability, value) { counts.publish++; publishedBody = value.frames[0].narration.body; return { kind: 'published' }; },
    async beginViewerNarrationRecovery() { return { ...request, kind: 'pending', deliveryGeneration: 2, deliveryProtocol: INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE }; },
    async failViewerNarrationRecovery(_principal, _capability, value) { failure = value; return { kind: value.state }; },
    async publishViewerNarrationRecovery(_principal, _capability, value) { counts.recoverPublish++; publishedBody = value.body; failure = undefined; return { kind: 'published', receipt: request.receipt }; },
  };
  const context = { principal, authority, kp: { ...adapter, async propose() { counts.propose++; return { kind: 'directSuccess' }; } } };
  return { context, counts, failure: () => failure, body: () => publishedBody };
}

for (const [mode, code, callCount] of [
  ['generationRejected', 'NARRATION_PROVIDER_REJECTED', 1],
  ['reviewRejected', 'NARRATION_PROVIDER_REJECTED', 2],
  ['malformed', 'NARRATION_BODY_INVALID', 1],
  ['grounding', 'NARRATION_GROUNDING_REJECTED', 2],
  ['rateLimited', 'NARRATION_PROVIDER_TIMEOUT', 2],
]) test(`${mode} preserves the failure cause from the real adapter through Room publication`, async () => {
  const request = fixture(), run = model(request, mode), harness = room(request, run.adapter);
  const outcome = await handleRoomAction(harness.context, { kind: 'intent', submissionId: 'submission:release', text: '放下两面玻璃镜。' });
  assert.equal(outcome.action, 'committed'); assert.deepEqual(outcome.receipt, request.receipt);
  assert.equal(outcome.narrationFailureCode, code);
  assert.equal(harness.failure().errorCode, code);
  assert.equal(outcome.narration, mode === 'rateLimited' ? 'retryableFailure' : 'rejected');
  assert.deepEqual(harness.counts, { propose: 1, commit: 1, publish: 0, recoverPublish: 0 });
  assert.equal(run.calls.length, callCount); assert.equal(run.receipts.length, callCount);
  if (mode.endsWith('Rejected')) {
    assert.equal(run.receipts.at(-1).result, 'modelPermanent');
    assert.equal(run.receipts.at(-1).failureStage, undefined, 'no report means no fabricated schema or grounding finding');
  }
  const event = buildRoomTelemetryEvent({ failure: { code, message: SECRET } });
  assert.equal(event.errorCode, code);
  assert.equal(publicV3FailureCode(code), code);
  assert.doesNotMatch(JSON.stringify({ outcome, failure: harness.failure(), receipts: run.receipts, event }), new RegExp(SECRET));
});

test('review rejection recovery only republishes the same frozen result after a successful new request', async () => {
  const request = fixture(), run = model(request, 'reviewRejected'), harness = room(request, run.adapter);
  const failed = await handleRoomAction(harness.context, { kind: 'intent', submissionId: 'submission:release', text: '放下两面玻璃镜。' });
  assert.equal(failed.narrationFailureCode, 'NARRATION_PROVIDER_REJECTED');
  const recovery = model({ ...request, narrationPurpose: 'narrationRecovery' });
  harness.context.kp.narrate = recovery.adapter.narrate;
  const recovered = await handleViewerNarrationRecovery(harness.context, 'recovery:capability');
  assert.equal(recovered.action, 'committed'); assert.equal(recovered.narration, 'published');
  assert.deepEqual(harness.counts, { propose: 1, commit: 1, publish: 0, recoverPublish: 1 });
  assert.equal(harness.body(), BODY); assert.equal(recovery.calls.length, 2);
  assert.deepEqual(recovery.receipts.map(receipt => receipt.invocationPurpose), ['narrationRecovery', 'narrationRecoveryReview']);
  assert.deepEqual(JSON.parse(recovery.calls[1].messages[1].content).candidateBody, BODY);
});

test('a successful response still publishes exactly once and public copy does not diagnose provider rejection as invalid output', async () => {
  const request = fixture(), run = model(request), harness = room(request, run.adapter);
  const outcome = await handleRoomAction(harness.context, { kind: 'intent', submissionId: 'submission:success', text: '放下两面玻璃镜。' });
  assert.equal(outcome.narration, 'published'); assert.equal(harness.body(), BODY); assert.equal(run.calls.length, 2);
  assert.deepEqual(harness.counts, { propose: 1, commit: 1, publish: 1, recoverPublish: 0 });
  assert.equal(failureCodeIsRetryable('NARRATION_PROVIDER_REJECTED'), false, 'provider rejection keeps its existing permanent classification');
  assert.equal(publicNarrationFailureReason('NARRATION_PROVIDER_REJECTED'), 'KP 服务拒绝了生成或审核请求，回复检查尚未完成');
  assert.equal(publicNarrationFailureReason('NARRATION_BODY_INVALID'), 'KP 返回的回复内容未通过格式检查');
  const recoveryMessage = publicNarrationRecoveryReason('rejected');
  assert.match(recoveryMessage, /KP 服务请求被拒绝，或回复未通过检查/);
  assert.match(recoveryMessage, /具体原因尚未确认/);
  assert.match(recoveryMessage, /重试 KP 回复/);
});
