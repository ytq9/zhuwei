import { canonicalSha256 } from "../rules/profiles/canonical";
import { diagnoseFailure, failureStage as diagnosticStage,
  type FailureRetryability, type FailureStage } from "../platform/failure-diagnostics";
import {
  kpProposalFailureTelemetry,
  type KpDiagnosticField,
} from "../kp/diagnostic-telemetry";
import {
  MODEL_INVOCATION_FAILURE_STAGES,
  MODEL_INVOCATION_PURPOSES,
  NARRATION_GROUNDING_REASONS,
  type NarrationGroundingReason,
  type ModelInvocationFailureStage,
  type ModelInvocationPurpose,
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
  modelInvocationPurpose: ModelInvocationPurpose | undefined;
  modelAttempt: number | undefined;
  modelStartedAt: number | undefined;
  modelEndedAt: number | undefined;
  modelResult: "success" | "modelTransient" | "modelPermanent" | "quotaExhausted" | undefined;
  modelInputTokens: number | undefined;
  modelOutputTokens: number | undefined;
  modelTotalTokens: number | undefined;
  modelResponseHash: string | undefined;
  modelGroundingReason?: NarrationGroundingReason;
  authorityOperation: "prepare" | "observe" | "commit" | "ack" | undefined;
  authorityResult: "completed" | "retryableFailure" | "exception" | undefined;
  outcomeKind: string | undefined;
  failureClass: RoomFailureClass | undefined;
  errorCode: string | undefined;
  failureReason?: string;
  failureStage?: FailureStage;
  failureRetryability?: FailureRetryability;
  providerStatus?: number;
  modelStage?: "offer" | "expandedProposal" | "reemit" | "correction";
  modelRequestHash?: string;
  modelContextHash?: string;
  httpStatus?: number;
  durationMs: number | undefined;
  latencyBucket: "withinBudget" | "overBudget" | undefined;
  costBucket: "withinFreeBudget" | "overFreeBudget" | undefined;
  archiveLagBucket: "withinTarget" | "lagging" | "alert" | undefined;
  retryCount: number | undefined;
  /** Fictional time the committed action itself spent, and how many scheduled
   * deadlines it crossed. Counts and microseconds only; never a world reference. */
  fictionTimeMicros: string | undefined;
  crossedDeadlineCount: number | undefined;
  archiveStatus: string | undefined;
  archiveFailureStage?: "verifyHostBindings" | "buildEnvelope" | "appendD1" | "saveProgress";
  archiveFailureCode?: "STORY_ARCHIVE_INVALID" | "STORY_ARCHIVE_WORLD_INVALID"
    | "STORY_ARCHIVE_BINDING_INVALID" | "STORY_ARCHIVE_MATERIALS_MISSING"
    | "STORY_ARCHIVE_HOST_BINDING_INVALID" | "unclassified";
  replayIntegrity: string | undefined;
  correctionIntegrity: string | undefined;
  contextProfileRef: string | undefined;
  plannerMode: "disabled" | "deterministic" | "model" | undefined;
  plannerStatus: "disabled" | "suggested" | "fallback" | undefined;
  plannerFallbackUsed: boolean | undefined;
  retrievalMode: "d1-fts" | "deterministic" | undefined;
  retrievalStatus: "selected" | "fallback" | undefined;
  retrievalFallbackUsed: boolean | undefined;
  retrievalHitCountBucket: string | undefined;
  // Which Form was being filled, whether the one narrow repair had already
  // been spent, and which fields broke which rules. Without these a failed
  // proposal is only ever "the repair was exhausted", and the most frequent
  // cause cannot be named from production data. Every value here comes from a
  // closed server-owned vocabulary; see `kp/diagnostic-telemetry`.
  proposalFormId: string | undefined;
  proposalRepairUsed: boolean | undefined;
  proposalDiagnosticFields: readonly KpDiagnosticField[] | undefined;
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
  PROPOSAL_PROVIDER_TIMEOUT: ["modelTransient", "PROPOSAL_PROVIDER_TIMEOUT"],
  PROPOSAL_RECOVERY_REQUIRED: ["modelTransient", "PROPOSAL_RECOVERY_REQUIRED"],
  PROPOSAL_RECOVERY_EXHAUSTED: ["modelPermanent", "PROPOSAL_RECOVERY_EXHAUSTED"],
  PROPOSAL_RECOVERY_UNAVAILABLE: ["modelPermanent", "PROPOSAL_RECOVERY_UNAVAILABLE"],
  PROPOSAL_INVOCATION_SUPERSEDED: ["modelPermanent", "PROPOSAL_INVOCATION_SUPERSEDED"],
  PROPOSAL_FORM_INVALID: ["modelPermanent", "PROPOSAL_FORM_INVALID"],
  PROPOSAL_REFERENCE_INVALID: ["modelPermanent", "PROPOSAL_REFERENCE_INVALID"],
  PROPOSAL_RULES_DIAGNOSTIC: ["mechanicalDiagnostic", "PROPOSAL_RULES_DIAGNOSTIC"],
  PROPOSAL_REPAIR_EXHAUSTED: ["modelPermanent", "PROPOSAL_REPAIR_EXHAUSTED"],
  DUE_DECISION_INVALID: ["modelPermanent", "FOLLOWUP_DECISION_INVALID"],
  ACTOR_PLAN_DECISION_INVALID: ["modelPermanent", "FOLLOWUP_DECISION_INVALID"],
  ACTOR_PLAN_DECISION_OUTCOME_UNKNOWN: ["modelPermanent", "FOLLOWUP_DECISION_OUTCOME_UNKNOWN"],
  CONTEXT_INSUFFICIENT: ["validation", "CONTEXT_INSUFFICIENT"],
  NARRATION_PROVIDER_TIMEOUT: ["modelTransient", "NARRATION_PROVIDER_TIMEOUT"],
  NARRATION_PROVIDER_REJECTED: ["modelPermanent", "NARRATION_PROVIDER_REJECTED"],
  NARRATION_BODY_INVALID: ["modelPermanent", "NARRATION_BODY_INVALID"],
  NARRATION_CONTEXT_BUDGET_EXCEEDED: ["modelPermanent", "NARRATION_CONTEXT_BUDGET_EXCEEDED"],
  NARRATION_GROUNDING_REJECTED: ["modelPermanent", "NARRATION_GROUNDING_REJECTED"],
  NARRATION_PRESENTATION_REJECTED: ["modelPermanent", "NARRATION_PRESENTATION_REJECTED"],
  NARRATION_REVIEW_UNCERTAIN: ["modelPermanent", "NARRATION_REVIEW_UNCERTAIN"],
  NARRATION_PUBLICATION_FAILED: ["authorityTransient", "NARRATION_PUBLICATION_FAILED"],
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
  proposalReference: ["modelPermanent", "proposalReference"],
  contextPack: ["validation", "contextPack"],
  narrationSchema: ["modelPermanent", "narrationSchema"],
  narrationGrounding: ["modelPermanent", "narrationGrounding"],
  projectionBinding: ["modelPermanent", "projectionBinding"],
  seatInactive: ["authentication", "authenticationRequired"],
} as const;

// Diagnostic recognition does not change player recovery policy.
const LOG_FAILURE_CODES = { ...FAILURE_CODES,
  authentication: ["authentication", "authenticationRequired"],
  authorization: ["authorization", "notAuthorized"],
  NARRATION_RECOVERY_PENDING: ["authorityTransient", "NARRATION_RECOVERY_PENDING"],
  PROPOSAL_PROVIDER_CONFIGURATION: ["modelPermanent", "PROPOSAL_PROVIDER_CONFIGURATION"],
  CONTEXT_BUDGET_EXCEEDED: ["validation", "CONTEXT_BUDGET_EXCEEDED"],
  PROPOSAL_INPUT_BUDGET_EXCEEDED: ["validation", "PROPOSAL_INPUT_BUDGET_EXCEEDED"],
  STORY_INVOCATION_UNKNOWN: ["authorityTransient", "STORY_INVOCATION_UNKNOWN"],
  STORY_INVOCATION_PENDING: ["authorityTransient", "STORY_INVOCATION_PENDING"],
  STORY_BUDGET_EXHAUSTED: ["quotaExhausted", "STORY_BUDGET_EXHAUSTED"],
  STORY_IDENTITY_CONFLICT: ["validation", "STORY_IDENTITY_CONFLICT"],
  STORY_CHECKPOINT_CONFLICT: ["scopeConflict", "STORY_CHECKPOINT_CONFLICT"],
  STORY_CONTEXT_INSUFFICIENT: ["validation", "STORY_CONTEXT_INSUFFICIENT"],
  STORY_CONTEXT_STALE: ["scopeConflict", "STORY_CONTEXT_STALE"],
  STORY_REVIEW_REJECTED: ["validation", "STORY_REVIEW_REJECTED"],
  STORY_CAPABILITY_UNSUPPORTED: ["validation", "STORY_CAPABILITY_UNSUPPORTED"],
  STORY_OUTPUT_INVALID: ["validation", "STORY_OUTPUT_INVALID"],
  STORY_RETRY_EXHAUSTED: ["validation", "STORY_RETRY_EXHAUSTED"],
  STORY_PROVIDER_FAILED: [undefined, "STORY_PROVIDER_FAILED"],
  HTTP_AUTHENTICATION_REQUIRED: ["authentication", "HTTP_AUTHENTICATION_REQUIRED"],
  HTTP_FORBIDDEN: ["authorization", "HTTP_FORBIDDEN"],
  HTTP_REQUEST_INVALID: ["validation", "HTTP_REQUEST_INVALID"],
  HTTP_ROUTE_NOT_FOUND: ["validation", "HTTP_ROUTE_NOT_FOUND"],
  HTTP_CONTENT_TYPE_INVALID: ["validation", "HTTP_CONTENT_TYPE_INVALID"],
} as const;

const GENERIC_CODES = new Set(["authentication", "authorization", "validation", "scopeConflict",
  "mechanicalDiagnostic", "worldInfeasible", "modelTransient", "modelPermanent", "authorityTransient",
  "archiveFailure", "projectionIntegrity", "projectionFailure", "correctionRequired", "quotaExhausted",
  "AUTHORITY_UNAVAILABLE", "ARCHIVE_APPEND_FAILED", "NARRATION_PUBLICATION_FAILED", "NARRATION_RECOVERY_PENDING",
  "NARRATION_PROVIDER_TIMEOUT", "PROPOSAL_PROVIDER_TIMEOUT", "NARRATION_PROVIDER_REJECTED"]);
const CLASS_STAGES: Readonly<Record<RoomFailureClass, FailureStage>> = {
  authentication: "authentication", authorization: "authorization", validation: "validation",
  scopeConflict: "rules", mechanicalDiagnostic: "rules", worldInfeasible: "rules",
  modelTransient: "modelRequest", modelPermanent: "modelRequest", authorityTransient: "unknown",
  archiveFailure: "unknown", projectionIntegrity: "projection", correctionRequired: "rules", quotaExhausted: "unknown",
};

/**
 * Transient failures are the only ones an unchanged resubmission can clear.
 * A `modelPermanent` failure such as `PROPOSAL_REPAIR_EXHAUSTED` is a
 * structural rejection of this exact draft, so offering "retry the same
 * action" walks the player back into the identical failure. Callers that
 * shape player-facing recovery derive it from this table rather than
 * restating the classification.
 */
export function roomFailureClassForCode(value: unknown): RoomFailureClass | undefined {
  if (typeof value !== "string") return undefined;
  return FAILURE_CODES[value]?.[0];
}

export function failureCodeIsRetryable(value: unknown): boolean {
  const failureClass = roomFailureClassForCode(value);
  // Only a structural rejection of this exact submission survives an
  // unchanged retry. Transient provider, quota, authority, archive,
  // projection and correction failures are all cleared by resubmitting the
  // same action, and an unclassified code keeps that existing affordance
  // rather than silently losing its recovery path.
  return failureClass !== "modelPermanent" && failureClass !== "mechanicalDiagnostic";
}

const MODEL_FAILURE_STAGE_SET = new Set<string>(MODEL_INVOCATION_FAILURE_STAGES);
const GROUNDING_REASON_SET = new Set<string>(NARRATION_GROUNDING_REASONS);

function groundingReason(value: unknown): NarrationGroundingReason | undefined {
  return typeof value === "string" && GROUNDING_REASON_SET.has(value) ? value as NarrationGroundingReason : undefined;
}

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

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
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

const MODEL_INVOCATION_PURPOSE_SET = new Set<string>(MODEL_INVOCATION_PURPOSES);

function modelInvocationPurpose(
  value: unknown,
): RoomTelemetryEvent["modelInvocationPurpose"] {
  return typeof value === "string" && MODEL_INVOCATION_PURPOSE_SET.has(value)
    ? value as ModelInvocationPurpose
    : undefined;
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
  const classified = code === undefined || !Object.hasOwn(LOG_FAILURE_CODES, code) ? undefined : LOG_FAILURE_CODES[code as keyof typeof LOG_FAILURE_CODES];
  return {
    failureClass: classified?.[0],
    errorCode: classified?.[1],
  };
}

function failureDetails(source: UnknownRecord | undefined, failureClass: RoomFailureClass | undefined):
  Pick<RoomTelemetryEvent, "failureReason" | "failureStage" | "failureRetryability" | "providerStatus"> {
  const input = record(source?.failure);
  if (!input) return {};
  const authority = record(source?.authority), archive = record(source?.archive);
  const operationStage = { prepare: "authorityPrepare", observe: "authorityObserve", commit: "authorityCommit", ack: "authorityAck" } as const;
  const operation = authorityOperation(authority?.operation);
  const stage = diagnosticStage(input.stage)
    ?? (failureClass === "archiveFailure" ? diagnosticStage(archive?.failureStage) : undefined)
    ?? (operation === undefined ? undefined : operationStage[operation])
    ?? (MODEL_FAILURE_STAGE_SET.has(String(input.code)) ? input.code === "contextPack" ? "validation"
      : input.code === "projectionBinding" ? "projection" : "modelResponse" : undefined)
    ?? (failureClass === undefined ? "unknown" : CLASS_STAGES[failureClass]);
  const detail = diagnoseFailure({ failureDiagnostic: input.failureDiagnostic,
    cause: input.error ?? (failureClass === "archiveFailure" ? archive?.error : undefined), code: input.code }, stage);
  const code = stringValue(input.code);
  const specificCode = code !== undefined && Object.hasOwn(LOG_FAILURE_CODES, code) && !GENERIC_CODES.has(code);
  return { failureReason: detail.reason === "unclassified" && specificCode ? code : detail.reason,
    failureStage: failureClass === "archiveFailure" ? stage : detail.stage,
    failureRetryability: detail.reason === "unclassified" && specificCode
      ? ["authentication", "authorization", "validation", "modelPermanent", "mechanicalDiagnostic"].includes(failureClass ?? "") ? "blocked" : "unknown"
      : detail.retryability,
    ...(detail.providerStatus === undefined ? {} : { providerStatus: detail.providerStatus }) };
}

function microsValue(value: unknown): string | undefined {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value) ? value : undefined;
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

/** SPEC 0011 §5: never serialize an exception or its free-form message. */
function archiveFailureFields(archive: UnknownRecord | undefined, failureClass: RoomFailureClass | undefined):
  Pick<RoomTelemetryEvent, "archiveFailureStage" | "archiveFailureCode"> {
  const stage = archive?.failureStage;
  if (failureClass !== "archiveFailure" || typeof stage !== "string"
    || !["verifyHostBindings", "buildEnvelope", "appendD1", "saveProgress"].includes(stage)) return {};
  const message = record(archive?.error)?.message;
  const known = typeof message === "string" && ["STORY_ARCHIVE_INVALID", "STORY_ARCHIVE_WORLD_INVALID",
    "STORY_ARCHIVE_BINDING_INVALID", "STORY_ARCHIVE_MATERIALS_MISSING", "STORY_ARCHIVE_HOST_BINDING_INVALID"].includes(message);
  return { archiveFailureStage: stage as RoomTelemetryEvent["archiveFailureStage"],
    archiveFailureCode: known ? message as RoomTelemetryEvent["archiveFailureCode"] : "unclassified" };
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
  const context = record(source?.context);
  const planner = record(context?.planner);
  const retrieval = record(context?.retrieval);
  const classification = failure(source?.failure);
  const proposal = record(source?.proposal);

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
    modelInvocationPurpose: modelInvocationPurpose(model?.invocationPurpose),
    modelAttempt: nonNegativeInteger(model?.attempt),
    modelStartedAt: nonNegativeInteger(model?.startedAt),
    modelEndedAt: nonNegativeInteger(model?.endedAt),
    modelResult: modelResult(model?.result),
    modelInputTokens: nonNegativeInteger(model?.inputTokens),
    modelOutputTokens: nonNegativeInteger(model?.outputTokens),
    modelTotalTokens: nonNegativeInteger(model?.totalTokens),
    modelResponseHash: sha256Value(model?.responseHash),
    ...(["offer", "expandedProposal", "reemit", "correction"].includes(String(model?.stage))
      ? { modelStage: model!.stage as RoomTelemetryEvent["modelStage"] } : {}),
    ...(sha256Value(model?.requestHash) ? { modelRequestHash: sha256Value(model?.requestHash) } : {}),
    ...(sha256Value(model?.contextHash) ? { modelContextHash: sha256Value(model?.contextHash) } : {}),
    ...(Number.isInteger(source?.httpStatus) && Number(source?.httpStatus) >= 400 && Number(source?.httpStatus) <= 599
      ? { httpStatus: Number(source?.httpStatus) } : {}),
    ...(model?.task === "narration" && model?.result === "modelPermanent" && model?.failureStage === "narrationGrounding" && groundingReason(model?.groundingReason)
      ? { modelGroundingReason: groundingReason(model?.groundingReason) } : {}),
    authorityOperation: authorityOperation(authority?.operation),
    authorityResult: authorityResult(authority?.result),
    outcomeKind: stringValue(outcome?.kind),
    failureClass: classification.failureClass,
    errorCode: classification.errorCode,
    ...failureDetails(source, classification.failureClass),
    durationMs: nonNegativeInteger(measurements?.durationMs),
    latencyBucket: latencyBucket(measurements),
    costBucket: costBucket(measurements),
    archiveLagBucket: archiveLagBucket(measurements),
    retryCount: nonNegativeInteger(measurements?.retryCount),
    fictionTimeMicros: microsValue(measurements?.fictionTimeMicros),
    crossedDeadlineCount: nonNegativeInteger(measurements?.crossedDeadlineCount),
    archiveStatus: stringValue(archive?.status),
    ...archiveFailureFields(archive, classification.failureClass),
    replayIntegrity: stringValue(archive?.replayIntegrity),
    correctionIntegrity: stringValue(archive?.correctionIntegrity),
    contextProfileRef: stringValue(context?.profileRef),
    plannerMode: ["disabled", "deterministic", "model"].includes(String(planner?.mode))
      ? planner?.mode as RoomTelemetryEvent["plannerMode"]
      : undefined,
    plannerStatus: ["disabled", "suggested", "fallback"].includes(String(planner?.status))
      ? planner?.status as RoomTelemetryEvent["plannerStatus"]
      : undefined,
    plannerFallbackUsed: booleanValue(planner?.fallbackUsed),
    retrievalMode: ["d1-fts", "deterministic"].includes(String(retrieval?.mode))
      ? retrieval?.mode as RoomTelemetryEvent["retrievalMode"]
      : undefined,
    retrievalStatus: ["selected", "fallback"].includes(String(retrieval?.status))
      ? retrieval?.status as RoomTelemetryEvent["retrievalStatus"]
      : undefined,
    retrievalFallbackUsed: booleanValue(retrieval?.fallbackUsed),
    retrievalHitCountBucket: stringValue(retrieval?.hitCountBucket),
    ...proposalFailureFields(proposal),
  };
}

/**
 * A proposal block is optional: most telemetry events are not a failed
 * proposal, and those keep all three fields undefined rather than carrying
 * empty rows.
 */
function proposalFailureFields(proposal: UnknownRecord | undefined): Readonly<{
  proposalFormId: string | undefined;
  proposalRepairUsed: boolean | undefined;
  proposalDiagnosticFields: readonly KpDiagnosticField[] | undefined;
}> {
  if (proposal === undefined) {
    return {
      proposalFormId: undefined,
      proposalRepairUsed: undefined,
      proposalDiagnosticFields: undefined,
    };
  }
  const desensitized = kpProposalFailureTelemetry({
    formId: proposal.formId,
    repairUsed: proposal.repairUsed,
    diagnostics: proposal.diagnostics,
  });
  return {
    proposalFormId: desensitized.proposalFormId,
    proposalRepairUsed: desensitized.repairUsed,
    proposalDiagnosticFields: desensitized.diagnosticFields.length === 0
      ? undefined
      : desensitized.diagnosticFields,
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
      : { code: failureStage ?? result, failureDiagnostic: receipt?.failureDiagnostic },
    measurements: {
      operationKind: task === "narration" ? "kpNarration" : "kpProposal",
      durationMs,
      aiInputTokens: receipt?.inputTokens,
      aiOutputTokens: receipt?.outputTokens,
    },
  });
}

/** vNext physical-call events use the same diagnostic and redaction boundary
 * as the ordinary Adapter. Selection payloads contain private NPC material. */
export function buildVNextInvocationTelemetryEvent(input: unknown): RoomTelemetryEvent {
  const source = record(input), event = record(source?.event);
  const selection = event?.eventName === "kp.vnext.selection";
  return buildRoomTelemetryEvent({
    occurredAt: new Date().toISOString(), eventName: selection ? "kp.vnext.selection" : "kp.vnext.invocation",
    severity: selection || event?.result === "success" ? "info" : "warn",
    correlation: { roomId: source?.roomId, principalId: source?.principalId, submissionId: source?.submissionId,
      rootActionId: event?.rootActionId },
    model: { task: "proposal", attempt: event?.ordinal, stage: event?.stage, requestHash: event?.requestHash,
      contextHash: event?.contextHash, inputTokens: event?.inputTokens, outputTokens: event?.outputTokens,
      responseHash: event?.responseHash },
    outcome: { kind: selection ? "selected" : event?.result === "success" ? "success" : "failed" },
    failure: selection || event?.result === "success" ? undefined
      : { code: event?.result, failureDiagnostic: event?.failureDiagnostic, stage: "modelRequest" },
    measurements: { operationKind: "kpProposal", durationMs: event?.durationMs, retryCount: event?.correctionRound },
  });
}
