import assert from 'node:assert/strict';
import test from 'node:test';
import { buildModelInvocationTelemetryEvent, buildRoomTelemetryEvent, buildVNextInvocationTelemetryEvent } from '../../../app/_runtime/lib/room/telemetry.ts';
import { withRoomAuthorityTelemetry } from '../../../app/_runtime/lib/room/authority-telemetry.ts';
import { diagnoseFailure, diagnosticError } from '../../../app/_runtime/lib/platform/failure-diagnostics.ts';

// SPEC 0011 §§1、4、5: same outer category, different actual causes; all unknown
// causes remain explicit and no arbitrary error text can enter telemetry.
test('model telemetry distinguishes timeout, rate limit, authentication, quota, network and journal blocks', () => {
  for (const [error, reason, stage, retryability] of [
    [{ name: 'TimeoutError' }, 'providerTimeout', 'modelRequest', 'unknown'],
    [{ status: 429 }, 'providerRateLimited', 'modelRequest', 'retryable'],
    [{ status: 401 }, 'providerAuthentication', 'modelRequest', 'blocked'],
    [{ status: 402 }, 'providerQuotaExhausted', 'modelRequest', 'blocked'],
    [{ status: 503 }, 'providerCapacity', 'modelRequest', 'retryable'],
    [new Error('private', { cause: { code: 'ECONNRESET' } }), 'providerNetwork', 'modelRequest', 'unknown'],
    [new Error('STORY_INVOCATION_UNKNOWN'), 'invocationOutcomeUnknown', 'invocationJournal', 'blocked'],
  ]) {
    const event = buildModelInvocationTelemetryEvent({ receipt: { task: 'narration', result: 'modelTransient',
      startedAt: 1, endedAt: 2, failureDiagnostic: diagnoseFailure(error, 'modelRequest') } });
    assert.equal(event.failureReason, reason);
    assert.equal(event.failureStage, stage);
    assert.equal(event.failureRetryability, retryability);
  }
});

test('all generic categories carry an explicit unknown reason instead of silently inventing a diagnosis', () => {
  for (const code of ['authentication', 'authorization', 'validation', 'scopeConflict', 'mechanicalDiagnostic',
    'worldInfeasible', 'modelTransient', 'modelPermanent', 'authorityTransient', 'archiveFailure',
    'projectionIntegrity', 'correctionRequired', 'quotaExhausted']) {
    const event = buildRoomTelemetryEvent({ failure: { code, error: new Error('PRIVATE_UNCLASSIFIED') } });
    assert.equal(event.failureReason, 'unclassified', code);
    assert.equal(event.failureRetryability, 'unknown', code);
    assert.ok(event.failureStage, code);
    assert.doesNotMatch(JSON.stringify(event), /PRIVATE_UNCLASSIFIED/);
  }
});

test('archive and authority failures preserve their source evidence through the common serializer', async () => {
  const archive = buildRoomTelemetryEvent({ failure: { code: 'ARCHIVE_APPEND_FAILED' },
    archive: { failureStage: 'buildEnvelope', error: new TypeError('STORY_ARCHIVE_BINDING_INVALID') } });
  assert.equal(archive.failureReason, 'archiveBindingInvalid');
  assert.equal(archive.failureStage, 'buildEnvelope');
  const events = [], error = Object.assign(new Error('PRIVATE_RPC_MESSAGE'), { overloaded: true });
  const authority = withRoomAuthorityTelemetry({ async observe() { throw error; } },
    { roomId: 'private', principalId: 'private', emit: e => events.push(e) });
  await assert.rejects(authority.observe({}), e => e === error);
  assert.equal(events[0].failureReason, 'authorityOverloaded');
  assert.equal(events[0].failureStage, 'authorityObserve');
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE_RPC_MESSAGE/);
});

test('RPC diagnostics survive message-only serialization and reject forged text, fields and cyclic causes', () => {
  const original = diagnoseFailure({ status: 403 }, 'modelRequest');
  const transported = new Error(diagnosticError(original).message);
  assert.deepEqual(diagnoseFailure(transported), original);
  for (const message of [transported.message + ':PRIVATE', 'STORY_INVOCATION_UNKNOWN PRIVATE', 'ZHUWEI_FAILURE:PRIVATE:modelRequest:none']) {
    const event = buildRoomTelemetryEvent({ failure: { code: 'authorityTransient', error: new Error(message),
      failureDiagnostic: { reason: 'PRIVATE', stage: 'PRIVATE', retryability: 'retryable' } } });
    assert.equal(event.failureReason, 'unclassified');
    assert.doesNotMatch(JSON.stringify(event), /PRIVATE/);
  }
  const cyclic = new Error('PRIVATE'); cyclic.cause = cyclic;
  assert.equal(diagnoseFailure(cyclic).reason, 'unclassified');
  const success = buildModelInvocationTelemetryEvent({ receipt: { task: 'narration', result: 'success',
    failureDiagnostic: original } });
  assert.equal(success.failureReason, undefined);
});

test('vNext diagnostics retain the actual Provider cause while excluding private selection and request payloads', () => {
  const event = buildVNextInvocationTelemetryEvent({ roomId: 'PRIVATE_ROOM', principalId: 'PRIVATE_PRINCIPAL',
    event: { eventName: 'kp.vnext.invocation', rootActionId: 'PRIVATE_ACTION', ordinal: 2, stage: 'expandedProposal',
      result: 'PROPOSAL_PROVIDER_TIMEOUT', failureDiagnostic: diagnoseFailure({ status: 429 }, 'modelRequest'),
      providerRequest: 'PRIVATE_PROMPT', durationMs: 123 } });
  assert.equal(event.failureReason, 'providerRateLimited');
  assert.equal(event.providerStatus, 429);
  assert.equal(event.modelStage, 'expandedProposal');
  assert.equal(event.durationMs, 123);
  const selection = buildVNextInvocationTelemetryEvent({ event: { eventName: 'kp.vnext.selection',
    npcRefs: ['PRIVATE_NPC'], npcRecall: 'PRIVATE_RECALL', knowledgeRefs: ['PRIVATE_KNOWLEDGE'] } });
  assert.equal(selection.failureReason, undefined);
  assert.doesNotMatch(JSON.stringify([event, selection]), /PRIVATE/);
});
