/** SPEC 0011 §§1、4、5: diagnostics are a closed vocabulary, never exception
 * text. They describe evidence; they do not grant retries or change outcomes. */
export const FAILURE_STAGES = ["unknown", "authentication", "authorization", "validation", "rules",
  "modelRequest", "modelResponse", "invocationJournal", "narrationPublication", "projection",
  "authorityPrepare", "authorityObserve", "authorityCommit", "authorityAck", "httpRequest", "directorySync",
  "verifyHostBindings", "buildEnvelope", "appendD1", "saveProgress", "archiveSchedule"] as const;
export type FailureStage = typeof FAILURE_STAGES[number];
export type FailureRetryability = "retryable" | "blocked" | "unknown";

const REASONS = {
  unclassified: ["unknown", "unknown"],
  providerTimeout: ["modelRequest", "unknown"],
  providerAborted: ["modelRequest", "unknown"],
  providerRateLimited: ["modelRequest", "retryable"],
  providerCapacity: ["modelRequest", "retryable"],
  providerUnavailable: ["modelRequest", "unknown"],
  providerQuotaExhausted: ["modelRequest", "blocked"],
  providerAuthentication: ["modelRequest", "blocked"],
  providerPermission: ["modelRequest", "blocked"],
  providerModelUnavailable: ["modelRequest", "blocked"],
  providerRequestInvalid: ["modelRequest", "blocked"],
  providerConfiguration: ["modelRequest", "blocked"],
  providerNetwork: ["modelRequest", "unknown"],
  providerResponseInvalid: ["modelResponse", "blocked"],
  requestContractInvalid: ["validation", "blocked"],
  narrationDeadlineExceeded: ["narrationPublication", "unknown"],
  networkFailure: ["unknown", "unknown"],
  operationTimeout: ["unknown", "unknown"],
  authorityOverloaded: ["unknown", "retryable"],
  authorityDisconnected: ["unknown", "unknown"],
  invocationOutcomeUnknown: ["invocationJournal", "blocked"],
  invocationPending: ["invocationJournal", "blocked"],
  invocationBudgetExhausted: ["invocationJournal", "blocked"],
  invocationIdentityConflict: ["invocationJournal", "blocked"],
  invocationCheckpointConflict: ["invocationJournal", "blocked"],
  invalidInvocation: ["invocationJournal", "blocked"],
  recoveryAuthorityUnavailable: ["narrationPublication", "blocked"],
  frozenAudienceUnavailable: ["narrationPublication", "blocked"],
  audienceGenerationMismatch: ["narrationPublication", "blocked"],
  publicationAttemptMismatch: ["narrationPublication", "blocked"],
  generationResponseUnavailable: ["invocationJournal", "blocked"],
  frozenRequestMismatch: ["invocationJournal", "blocked"],
  priorCallOutcomeUnknown: ["invocationJournal", "blocked"],
  priorCallPending: ["invocationJournal", "blocked"],
  callOutcomeUnknown: ["invocationJournal", "blocked"],
  callPending: ["invocationJournal", "blocked"],
  callBudgetExhausted: ["invocationJournal", "blocked"],
  callIdentityConflict: ["invocationJournal", "blocked"],
  callRejected: ["invocationJournal", "blocked"],
  transportOutcomeUnknown: ["modelRequest", "blocked"],
  transportNotSent: ["modelRequest", "blocked"],
  responseJournalRejected: ["invocationJournal", "blocked"],
  archiveInvalid: ["buildEnvelope", "blocked"],
  archiveWorldInvalid: ["buildEnvelope", "blocked"],
  archiveBindingInvalid: ["buildEnvelope", "blocked"],
  archiveMaterialsMissing: ["buildEnvelope", "blocked"],
  archiveHostBindingInvalid: ["verifyHostBindings", "blocked"],
} as const satisfies Record<string, readonly [FailureStage, FailureRetryability]>;
export type FailureReason = keyof typeof REASONS;
export type FailureDiagnostic = Readonly<{
  reason: FailureReason;
  stage: FailureStage;
  retryability: FailureRetryability;
  providerStatus?: number;
}>;

const CODE_REASONS: Readonly<Record<string, FailureReason>> = {
  AI_TIMEOUT: "providerTimeout", AI_CAPACITY: "providerCapacity", AI_RATE_LIMITED: "providerRateLimited",
  AI_MODEL_UNAVAILABLE: "providerModelUnavailable", AI_NOT_CONFIGURED: "providerConfiguration",
  AI_FREE_QUOTA_EXHAUSTED: "providerQuotaExhausted",
  strict_tool_configuration_invalid: "providerConfiguration", quota_exhausted: "providerQuotaExhausted",
  rate_limit: "providerRateLimited", capacity: "providerCapacity", model_not_found: "providerModelUnavailable",
  ECONNRESET: "providerNetwork", ECONNREFUSED: "providerNetwork", ENOTFOUND: "providerNetwork",
  ETIMEDOUT: "providerTimeout", UND_ERR_CONNECT_TIMEOUT: "providerTimeout", UND_ERR_SOCKET: "providerNetwork",
  STORY_INVOCATION_UNKNOWN: "invocationOutcomeUnknown", STORY_INVOCATION_PENDING: "invocationPending",
  PROPOSAL_RECOVERY_REQUIRED: "invocationOutcomeUnknown",
  PROPOSAL_RECOVERY_EXHAUSTED: "invocationBudgetExhausted",
  PROPOSAL_RECOVERY_UNAVAILABLE: "invocationCheckpointConflict",
  PROPOSAL_INVOCATION_SUPERSEDED: "invocationCheckpointConflict",
  STORY_BUDGET_EXHAUSTED: "invocationBudgetExhausted", STORY_CALL_LIMIT_REACHED: "invocationBudgetExhausted",
  STORY_IDENTITY_CONFLICT: "invocationIdentityConflict", STORY_CHECKPOINT_CONFLICT: "invocationCheckpointConflict",
  PROPOSAL_INVOCATION_IDENTITY_CONFLICT: "invocationIdentityConflict",
  PROPOSAL_INVOCATION_IN_PROGRESS: "invocationPending",
  PROPOSAL_PROVIDER_CONFIGURATION: "providerConfiguration",
  STORY_ARCHIVE_INVALID: "archiveInvalid", STORY_ARCHIVE_WORLD_INVALID: "archiveWorldInvalid",
  STORY_ARCHIVE_BINDING_INVALID: "archiveBindingInvalid", STORY_ARCHIVE_MATERIALS_MISSING: "archiveMaterialsMissing",
  STORY_ARCHIVE_HOST_BINDING_INVALID: "archiveHostBindingInvalid",
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
export function failureStage(value: unknown): FailureStage | undefined {
  return typeof value === "string" && (FAILURE_STAGES as readonly string[]).includes(value)
    ? value as FailureStage : undefined;
}
function reason(value: unknown): FailureReason | undefined {
  return typeof value === "string" && Object.hasOwn(REASONS, value) ? value as FailureReason : undefined;
}
function status(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599 ? value : undefined;
}
export function fixedFailureDiagnostic(value: FailureReason, stage?: FailureStage): FailureDiagnostic {
  return { reason: value, stage: stage ?? REASONS[value][0], retryability: REASONS[value][1] };
}
export function sanitizeFailureDiagnostic(value: unknown): FailureDiagnostic | undefined {
  const candidate = record(value), code = reason(candidate?.reason), at = failureStage(candidate?.stage);
  if (code === undefined || at === undefined) return undefined;
  const providerStatus = status(candidate?.providerStatus);
  return { ...fixedFailureDiagnostic(code, at),
    // An owning journal can make a transport condition non-retryable; a
    // supplied field can never loosen a fixed blocked/unknown decision.
    ...(candidate?.retryability === "blocked" ? { retryability: "blocked" as const } : {}),
    ...(providerStatus === undefined ? {} : { providerStatus }) };
}

/** Error custom properties do not survive every Worker RPC hop. Only this
 * exact non-content message envelope crosses the private transport boundary. */
export function diagnosticError(diagnostic: FailureDiagnostic): Error {
  const safe = sanitizeFailureDiagnostic(diagnostic) ?? fixedFailureDiagnostic("unclassified");
  return new Error(`ZHUWEI_FAILURE:${safe.reason}:${safe.stage}:${safe.retryability}:${safe.providerStatus ?? "none"}`);
}
function rpcDiagnostic(message: unknown): FailureDiagnostic | undefined {
  if (typeof message !== "string") return undefined;
  const parts = message.split(":");
  if (parts.length !== 5 || parts[0] !== "ZHUWEI_FAILURE" || !["blocked", "retryable", "unknown"].includes(parts[3]!)) return undefined;
  if (parts[4] !== "none" && !/^[45][0-9]{2}$/.test(parts[4]!)) return undefined;
  return sanitizeFailureDiagnostic({ reason: parts[1], stage: parts[2], retryability: parts[3],
    ...(parts[4] === "none" ? {} : { providerStatus: Number(parts[4]) }) });
}

export function diagnoseFailure(error: unknown, stage: FailureStage = "unknown"): FailureDiagnostic {
  const seen = new Set<unknown>();
  function inspect(value: unknown, depth: number): FailureDiagnostic | undefined {
    if (depth > 3 || seen.has(value)) return undefined;
    seen.add(value);
    const candidate = record(value);
    if (!candidate) return undefined;
    const supplied = sanitizeFailureDiagnostic(candidate.failureDiagnostic) ?? rpcDiagnostic(candidate.message);
    if (supplied) return supplied;
    for (const code of [candidate.publicCode, candidate.code, candidate.message]) {
      if (typeof code === "string" && Object.hasOwn(CODE_REASONS, code)) {
        const at = status(candidate.status);
        // A numeric Provider status distinguishes e.g. 401 from generic request_rejected.
        if (at === undefined || stage !== "modelRequest" || code === "strict_tool_configuration_invalid") {
          const mapped = CODE_REASONS[code]!;
          if (stage !== "modelRequest" && mapped === "providerNetwork") return fixedFailureDiagnostic("networkFailure", stage);
          if (stage !== "modelRequest" && ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) return fixedFailureDiagnostic("operationTimeout", stage);
          return fixedFailureDiagnostic(mapped);
        }
      }
    }
    const at = status(candidate.status);
    if (at !== undefined && stage === "modelRequest") {
      const code: FailureReason = at === 401 ? "providerAuthentication" : at === 403 ? "providerPermission"
        : at === 402 ? "providerQuotaExhausted" : at === 404 ? "providerModelUnavailable"
          : at === 408 || at === 504 ? "providerTimeout" : at === 429 ? "providerRateLimited"
            : at === 503 ? "providerCapacity" : at >= 500 ? "providerUnavailable" : "providerRequestInvalid";
      return { ...fixedFailureDiagnostic(code), providerStatus: at };
    }
    if (stage === "modelRequest") {
      if (candidate.name === "ModelInvocationTimeoutError" || candidate.name === "TimeoutError") return fixedFailureDiagnostic("providerTimeout");
      if (candidate.name === "AbortError") return fixedFailureDiagnostic("providerAborted");
      if (candidate.name === "ModelOutputValidationError" || candidate.name === "SyntaxError") return fixedFailureDiagnostic("providerResponseInvalid");
    }
    if (stage.startsWith("authority")) {
      if (candidate.overloaded === true) return fixedFailureDiagnostic("authorityOverloaded", stage);
      if (candidate.name === "DisconnectedError") return fixedFailureDiagnostic("authorityDisconnected", stage);
    }
    return inspect(candidate.cause, depth + 1);
  }
  try { return inspect(error, 0) ?? fixedFailureDiagnostic("unclassified", stage); }
  catch { return fixedFailureDiagnostic("unclassified", stage); }
}
