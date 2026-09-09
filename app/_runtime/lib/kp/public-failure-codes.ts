/** Stable, value-free failure codes safe for a player-facing response. */
export const PROPOSAL_PUBLIC_FAILURE_CODES = [
  "PROPOSAL_PROVIDER_TIMEOUT",
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
  "NARRATION_CONTEXT_BUDGET_EXCEEDED",
  "NARRATION_PUBLICATION_FAILED",
] as const;

export type ProposalPublicFailureCode = typeof PROPOSAL_PUBLIC_FAILURE_CODES[number];
export type NarrationPublicFailureCode = typeof NARRATION_PUBLIC_FAILURE_CODES[number];

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
