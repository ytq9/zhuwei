/** Stable, value-free failure codes safe for a player-facing response. */
export const PROPOSAL_PUBLIC_FAILURE_CODES = [
  "STORY_BUDGET_EXHAUSTED", "STORY_INVOCATION_PENDING", "STORY_INVOCATION_UNKNOWN",
  "STORY_CONTEXT_INSUFFICIENT", "STORY_CONTEXT_STALE", "STORY_REVIEW_REJECTED",
  "STORY_CAPABILITY_UNSUPPORTED", "STORY_OUTPUT_INVALID", "STORY_IDENTITY_CONFLICT",
  "STORY_CHECKPOINT_CONFLICT", "STORY_RETRY_EXHAUSTED", "STORY_PROVIDER_FAILED",
  "PROPOSAL_PROVIDER_TIMEOUT",
  "PROPOSAL_RECOVERY_REQUIRED",
  "PROPOSAL_RECOVERY_EXHAUSTED",
  "PROPOSAL_RECOVERY_UNAVAILABLE",
  "PROPOSAL_INVOCATION_SUPERSEDED",
  "PROPOSAL_FORM_INVALID",
  "PROPOSAL_REFERENCE_INVALID",
  "PROPOSAL_RULES_DIAGNOSTIC",
  "PROPOSAL_REPAIR_EXHAUSTED",
  "CONTEXT_INSUFFICIENT",
  "CONTEXT_BUDGET_EXCEEDED",
  "PROPOSAL_INPUT_BUDGET_EXCEEDED",
  "PROPOSAL_PROVIDER_CONFIGURATION",
  "PROPOSAL_INVOCATION_IN_PROGRESS",
  "FOLLOWUP_DECISION_INVALID",
  "FOLLOWUP_DECISION_OUTCOME_UNKNOWN",
] as const;

export const NARRATION_PUBLIC_FAILURE_CODES = [
  "NARRATION_PROVIDER_TIMEOUT",
  "NARRATION_PROVIDER_REJECTED",
  "NARRATION_BODY_INVALID",
  "NARRATION_GROUNDING_REJECTED",
  "NARRATION_PRESENTATION_REJECTED",
  "NARRATION_REVIEW_UNCERTAIN",
  "NARRATION_CONTEXT_BUDGET_EXCEEDED",
  "NARRATION_PUBLICATION_FAILED",
] as const;

export type ProposalPublicFailureCode = typeof PROPOSAL_PUBLIC_FAILURE_CODES[number];
export type NarrationPublicFailureCode = typeof NARRATION_PUBLIC_FAILURE_CODES[number];

/** SPEC 0011 §1 / SPEC 0016 §8.3: preserve the review's finding without
 * presenting language problems or uncertainty as proven factual conflicts. */
export function narrationGroundingPublicFailureCode(reason: unknown): NarrationPublicFailureCode {
  if (reason === "unnaturalNarration") return "NARRATION_PRESENTATION_REJECTED";
  if (reason === "reviewUncertain") return "NARRATION_REVIEW_UNCERTAIN";
  return "NARRATION_GROUNDING_REJECTED";
}

/** An unchanged request cannot fix these frozen output or material failures.
 * Unknown/provider failures still need their existing recovery policy; this
 * predicate does not authorize a new physical invocation. */
export function narrationFailureCanRetry(value: unknown): boolean {
  return value !== "NARRATION_GROUNDING_REJECTED"
    && value !== "NARRATION_PRESENTATION_REJECTED"
    && value !== "NARRATION_REVIEW_UNCERTAIN"
    && value !== "NARRATION_BODY_INVALID"
    && value !== "NARRATION_CONTEXT_BUDGET_EXCEEDED";
}

const PROPOSAL_PUBLIC_FAILURE_CODE_SET = new Set<string>(PROPOSAL_PUBLIC_FAILURE_CODES);
const NARRATION_PUBLIC_FAILURE_CODE_SET = new Set<string>(NARRATION_PUBLIC_FAILURE_CODES);

export function proposalPublicFailureCode(value: unknown): ProposalPublicFailureCode | undefined {
  return typeof value === "string" && PROPOSAL_PUBLIC_FAILURE_CODE_SET.has(value)
    ? value as ProposalPublicFailureCode
    : undefined;
}

export function narrationPublicFailureCode(value: unknown): NarrationPublicFailureCode | undefined {
  return typeof value === "string" && NARRATION_PUBLIC_FAILURE_CODE_SET.has(value)
    ? value as NarrationPublicFailureCode
    : undefined;
}
