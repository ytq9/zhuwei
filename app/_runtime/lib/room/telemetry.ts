import { canonicalSha256 } from "../rules/profiles/canonical";
import {
  MODEL_INVOCATION_FAILURE_STAGES,
  type ModelInvocationFailureStage,
} from "../kp/authoritative-types";

type UnknownRecord = Record<string, unknown>;

export type RoomFailureClass =
  | "authentication"
  | "authorization"
  | "validation"
  | "scopeConflict"
  | "mechanicalDiagnostic"
  | "worldInfeasible"
  | "modelTransient"
  | "modelPermanent"
  | "authorityTransient"
  | "archiveFailure"
  | "projectionIntegrity"
  | "correctionRequired"
  | "quotaExhausted";

export type RoomTelemetryEvent = {
  schemaVersion: "zhuwei.room-telemetry/v1";
  occurredAt: string | undefined;
  severity: string | undefined;
  eventName: string | undefined;
  requestId: string | undefined;
  roomHash: string | undefined;
  principalHash: string | undefined;
  rootActionHash: string | undefined;
  submissionHash: string | undefined;
  receiptHash: string | undefined;
  eventRange: { from: number; to: number } | undefined;
  runtimeProfileId: string | undefined;
  rulesetProfileId: string | undefined;
  eventSchemaProfileId: string | undefined;
  modelProvider: string | undefined;
  modelId: string | undefined;
  modelRevision: string | undefined;
  modelProfileVersion: string | undefined;
  promptPolicyVersion: string | undefined;
  modelSchemaVersion: string | undefined;
  modelTask: "proposal" | "narration" | undefined;
  modelAttempt: number | undefined;
  modelStartedAt: number | undefined;
  modelEndedAt: number | undefined;
  modelResult: "success" | "modelTransient" | "modelPermanent" | "quotaExhausted" | undefined;
  modelInputTokens: number | undefined;
  modelOutputTokens: number | undefined;
  modelTotalTokens: number | undefined;
  modelResponseHash: string | undefined;
  authorityOperation: "prepare" | "observe" | "commit" | "ack" | undefined;
  authorityResult: "completed" | "retryableFailure" | "exception" | undefined;
  outcomeKind: string | undefined;
  failureClass: RoomFailureClass | undefined;
  errorCode: string | undefined;
  durationMs: number | undefined;
  latencyBucket: "withinBudget" | "overBudget" | undefined;
  costBucket: "withinFreeBudget" | "overFreeBudget" | undefined;
  archiveLagBucket: "withinTarget" | "lagging" | "alert" | undefined;
  retryCount: number | undefined;
  archiveStatus: string | undefined;
  replayIntegrity: string | undefined;
  correctionIntegrity: string | undefined;
};

const FAILURE_CODES: Readonly<Record<string, readonly [RoomFailureClass, string]>> = {
  SESSION_EXPIRED: ["authentication", "authenticationRequired"],
  NOT_CONTROLLER: ["authorization", "notAuthorized"],
  INVALID_ACTION_SCHEMA: ["validation", "invalidRequest"],
  SCOPE_VERSION_CHANGED: ["scopeConflict", "scopeConflict"],
  AI_TIMEOUT: ["modelTransient", "modelTransient"],
  AI_CAPACITY: ["modelTransient", "modelTransient"],
  AI_RATE_LIMITED: ["modelTransient", "modelTransient"],
  AI_MODEL_UNAVAILABLE: ["modelPermanent", "modelUnavailable"],
  AI_NOT_CONFIGURED: ["modelPermanent", "modelUnavailable"],
  AI_FREE_QUOTA_EXHAUSTED: ["quotaExhausted", "quotaExhausted"],
  AUTHORITY_UNAVAILABLE: ["authorityTransient", "authorityTransient"],
  ARCHIVE_APPEND_FAILED: ["archiveFailure", "archiveFailure"],
  PROJECTION_HASH_MISMATCH: ["projectionIntegrity", "projectionIntegrity"],
  CORRECTION_REQUIRED: ["correctionRequired", "correctionRequired"],
  MECHANICAL_DIAGNOSTIC: ["mechanicalDiagnostic", "mechanicalDiagnostic"],
  WORLD_INFEASIBLE: ["worldInfeasible", "worldInfeasible"],
  unauthenticated: ["authentication", "authenticationRequired"],
  viewerUnauthorized: ["authorization", "notAuthorized"],
  notController: ["authorization", "notAuthorized"],
  validation: ["validation", "invalidRequest"],
  invalidActionInput: ["validation", "invalidRequest"],
  invalidRulesInput: ["validation", "invalidRequest"],
  scopeConflict: ["scopeConflict", "scopeConflict"],
  mechanicalDiagnostic: ["mechanicalDiagnostic", "mechanicalDiagnostic"],
  worldInfeasible: ["worldInfeasible", "worldInfeasible"],
  missingPrerequisite: ["worldInfeasible", "worldInfeasible"],
  worldLawViolation: ["worldInfeasible", "worldInfeasible"],
  modelTransient: ["modelTransient", "modelTransient"],
  modelPermanent: ["modelPermanent", "modelUnavailable"],
  authorityTransient: ["authorityTransient", "authorityTransient"],
  archiveFailure: ["archiveFailure", "archiveFailure"],
  projectionIntegrity: ["projectionIntegrity", "projectionIntegrity"],
  projectionFailure: ["projectionIntegrity", "projectionIntegrity"],
  correctionRequired: ["correctionRequired", "correctionRequired"],
  quotaExhausted: ["quotaExhausted", "quotaExhausted"],
  structuredOutput: ["modelPermanent", "structuredOutput"],
  proposalSchema: ["modelPermanent", "proposalSchema"],
  projectionBinding: ["modelPermanent", "projectionBinding"],
  seatInactive: ["authentication", "authenticationRequired"],
} as const;

const MODEL_FAILURE_STAGE_SET = new Set<string>(MODEL_INVOCATION_FAILURE_STAGES);

function modelFailureStage(value: unknown): ModelInvocationFailureStage | undefined {
  return typeof value === "string" && MODEL_FAILURE_STAGE_SET.has(value)
    ? value as ModelInvocationFailureStage
    : undefined;
}

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const candidate = finiteNumber(value);
  return candidate !== undefined && Number.isSafeInteger(candidate) && candidate >= 0
    ? candidate
    : undefined;
}

function modelTask(value: unknown): RoomTelemetryEvent["modelTask"] {
  return value === "proposal" || value === "narration" ? value : undefined;
}

function modelResult(value: unknown): RoomTelemetryEvent["modelResult"] {
  return value === "success"
    || value === "modelTransient"
    || value === "modelPermanent"
    || value === "quotaExhausted"
    ? value
    : undefined;
}

function authorityOperation(value: unknown): RoomTelemetryEvent["authorityOperation"] {
  return value === "prepare" || value === "observe" || value === "commit" || value === "ack"
    ? value
    : undefined;
}

function authorityResult(value: unknown): RoomTelemetryEvent["authorityResult"] {
  return value === "completed" || value === "retryableFailure" || value === "exception"
    ? value
    : undefined;
}

function sha256Value(value: unknown): string | undefined {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value)
    ? value
    : undefined;
}

function correlationHash(kind: string, value: unknown): string | undefined {
  const identifier = stringValue(value);
  if (identifier === undefined) return undefined;
  return canonicalSha256({
    namespace: `zhuwei.telemetry.${kind}/v1`,
    identifier,
  });
}

function eventRange(value: unknown): { from: number; to: number } | undefined {
  const range = record(value);
  const from = nonNegativeInteger(range?.from);
  const to = nonNegativeInteger(range?.to);
  return from !== undefined && to !== undefined && from <= to ? { from, to } : undefined;
}

function failure(value: unknown): {
  failureClass: RoomFailureClass | undefined;
  errorCode: string | undefined;
} {
  const code = stringValue(record(value)?.code);
  const classified = code === undefined ? undefined : FAILURE_CODES[code];
  return {
    failureClass: classified?.[0],
    errorCode: classified?.[1],
  };
}

function latencyBucket(measurements: UnknownRecord | undefined): RoomTelemetryEvent["latencyBucket"] {
  const durationMs = finiteNumber(measurements?.durationMs);
  if (durationMs === undefined) return undefined;
  const operationKind = stringValue(measurements?.operationKind);
  const limitMs = operationKind === "kpProposal"
    ? 20_000
    : operationKind === "kpNarration"
      ? 15_000
      : 750;
  return durationMs <= limitMs ? "withinBudget" : "overBudget";
}

function costBucket(measurements: UnknownRecord | undefined): RoomTelemetryEvent["costBucket"] {
  if (measurements === undefined) return undefined;
  const input = finiteNumber(measurements.aiInputTokens);
  const output = finiteNumber(measurements.aiOutputTokens);
  const narration = finiteNumber(measurements.narrationTokens);
  const neurons = finiteNumber(measurements.neuronsToday);
  const estimatedUsdMicros = finiteNumber(measurements.estimatedUsdMicros);
  if ([input, output, narration, neurons, estimatedUsdMicros].every((entry) => entry === undefined)) {
    return undefined;
  }
  const overBudget = (input ?? 0) > 16_000
    || (output ?? 0) > 2_000
    || (narration ?? 0) > 800
    || (neurons ?? 0) > 10_000
    || (estimatedUsdMicros ?? 0) > 0;
  return overBudget ? "overFreeBudget" : "withinFreeBudget";
}

function archiveLagBucket(
  measurements: UnknownRecord | undefined,
): RoomTelemetryEvent["archiveLagBucket"] {
  const lagMs = finiteNumber(measurements?.archiveLagMs);
  if (lagMs === undefined) return undefined;
  if (lagMs <= 60_000) return "withinTarget";
  return lagMs > 600_000 ? "alert" : "lagging";
}

/**
 * The only runtime log serializer for authoritative room operations.
 *
 * It deliberately constructs a fixed non-content record instead of redacting
 * an arbitrary input object. Unknown fields and all request/model/world bodies
 * are therefore incapable of reaching logs or influencing an output hash.
 */
export function buildRoomTelemetryEvent(input: unknown): RoomTelemetryEvent {
  const source = record(input);
  const correlation = record(source?.correlation);
  const profiles = record(source?.profiles);
  const runtime = record(profiles?.runtime);
  const ruleset = record(profiles?.ruleset);
  const eventSchema = record(profiles?.eventSchema);
  const model = record(source?.model);
  const authority = record(source?.authority);
  const outcome = record(source?.outcome);
  const measurements = record(source?.measurements);
  const archive = record(source?.archive);
  const classification = failure(source?.failure);

  return {
    schemaVersion: "zhuwei.room-telemetry/v1",
    occurredAt: stringValue(source?.occurredAt),
    severity: stringValue(source?.severity),
    eventName: stringValue(source?.eventName),
    requestId: correlationHash("request", source?.requestId),
    roomHash: correlationHash("room", correlation?.roomId),
    principalHash: correlationHash("principal", correlation?.principalId),
    rootActionHash: correlationHash("root-action", correlation?.rootActionId),
    submissionHash: correlationHash("submission", correlation?.submissionId),
    receiptHash: correlationHash("receipt", correlation?.receiptId),
    eventRange: eventRange(correlation?.eventRange),
    runtimeProfileId: stringValue(runtime?.profileId),
    rulesetProfileId: stringValue(ruleset?.profileId),
    eventSchemaProfileId: stringValue(eventSchema?.profileId),
    modelProvider: stringValue(model?.provider),
    modelId: stringValue(model?.modelId),
    modelRevision: stringValue(model?.revision),
    modelProfileVersion: stringValue(model?.modelProfileVersion),
    promptPolicyVersion: stringValue(model?.promptPolicyVersion),
    modelSchemaVersion: stringValue(model?.schemaVersion),
    modelTask: modelTask(model?.task),
    modelAttempt: nonNegativeInteger(model?.attempt),
    modelStartedAt: nonNegativeInteger(model?.startedAt),
    modelEndedAt: nonNegativeInteger(model?.endedAt),
    modelResult: modelResult(model?.result),
    modelInputTokens: nonNegativeInteger(model?.inputTokens),
    modelOutputTokens: nonNegativeInteger(model?.outputTokens),
    modelTotalTokens: nonNegativeInteger(model?.totalTokens),
    modelResponseHash: sha256Value(model?.responseHash),
    authorityOperation: authorityOperation(authority?.operation),
    authorityResult: authorityResult(authority?.result),
    outcomeKind: stringValue(outcome?.kind),
    failureClass: classification.failureClass,
    errorCode: classification.errorCode,
    durationMs: nonNegativeInteger(measurements?.durationMs),
    latencyBucket: latencyBucket(measurements),
    costBucket: costBucket(measurements),
    archiveLagBucket: archiveLagBucket(measurements),
    retryCount: nonNegativeInteger(measurements?.retryCount),
    archiveStatus: stringValue(archive?.status),
    replayIntegrity: stringValue(archive?.replayIntegrity),
    correctionIntegrity: stringValue(archive?.correctionIntegrity),
  };
}


/**
 * Converts exactly one internal KP adapter receipt into the fixed telemetry
 * schema.  The receipt is treated as untrusted input: only the explicit
 * non-content fields above survive, while root actions are hashed and model
 * bodies/projections cannot become log fields.
 */
export function buildModelInvocationTelemetryEvent(input: unknown): RoomTelemetryEvent {
  const source = record(input);
  const receipt = record(source?.receipt);
  const task = modelTask(receipt?.task);
  const result = modelResult(receipt?.result);
  const startedAt = nonNegativeInteger(receipt?.startedAt);
  const endedAt = nonNegativeInteger(receipt?.endedAt);
  const failureStage = modelFailureStage(receipt?.failureStage);
  const durationMs = startedAt !== undefined && endedAt !== undefined && endedAt >= startedAt
    ? endedAt - startedAt
    : undefined;

  return buildRoomTelemetryEvent({
    occurredAt: endedAt === undefined ? undefined : new Date(endedAt).toISOString(),
    severity: result === "success" ? "info" : result === "modelPermanent" ? "error" : "warn",
    eventName: "room.model.invocation.completed",
    correlation: {
      roomId: source?.roomId,
      principalId: source?.principalId,
      rootActionId: receipt?.rootActionId,
    },
    model: receipt,
    outcome: { kind: result },
    failure: result === undefined || result === "success"
      ? undefined
      : { code: failureStage ?? result },
    measurements: {
      operationKind: task === "narration" ? "kpNarration" : "kpProposal",
      durationMs,
      aiInputTokens: receipt?.inputTokens,
      aiOutputTokens: receipt?.outputTokens,
    },
  });
}
