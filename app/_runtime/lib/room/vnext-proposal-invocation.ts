import type { JsonRecord } from "../kp/vnext/canonical-json";
import type { VNextProposalBundleRepairTicket } from "../kp/vnext/proposal-provider";
import { assertRepairTicket, assertVNextProposalCandidateCapabilities, parseSubmitKpProposalBundleCandidateResponse,
  parseVNextProposalOfferResponse, vnextProposalCorrectionPrompt, numericRepairSource, vnextProposalHasExecutionRepairBudget, vnextProposalModelRepairDiagnostics } from "../kp/vnext/proposal-provider";
import { createVNextProposalOfferModelInput, CORRECT_KP_PROPOSAL_BUNDLE_TOOL, createSubmitKpProposalBundleModelInput, VNEXT_INITIAL_PROPOSAL_DECISION_KINDS } from "../kp/vnext/proposal-schema";
import { proposalCreatureTargetRefs, proposalItemEntryRefs, proposalObservationSubjectRefs, proposalModelContext, proposalNpcSourceChoices } from "../kp/vnext/proposal-context";
import { requiredContextBasisReferences } from "../kp/vnext/required-context-runtime";
import type { VNextRequiredContext } from "../kp/vnext/required-context";
import { canonicalHash, isPlainRecord } from "../kp/vnext/canonical-json";
import { vnextProposalSystemPrompt, type VNextProposalStage } from "../kp/vnext/proposal-guidance";
import type { VNextProposalCapabilityId } from "../kp/vnext/proposal-capabilities";

/** Private RPC vocabulary. Public HTTP accepts only the normal RoomActionInput. */
export type VNextInvocationRequest = Readonly<{
  /** Pure selection, then its proposal; a third call requires an actual
   * selected step-bearing draft and the existing narrow repair proof. */
  ordinal: 1 | 2 | 3;
  contextHash: string;
  bindingHash: string;
  requestHash: string;
  request: JsonRecord;
  repairTicket?: VNextProposalBundleRepairTicket;
}>;

export type VNextInvocationStart =
  | { kind: "ready"; capability: string }
  | { kind: "completed"; response: unknown }
  | { kind: "rejected" | "retryableFailure"; code: string; retryAfter?: number };

export type VNextInvocationCompletion = Readonly<{
  ordinal: 1 | 2 | 3;
  capability: string;
  requestHash: string;
  result: { kind: "completed"; response: unknown }
    | { kind: "retryable" | "rejected"; code: string; retryAfter?: number };
}>;

type SavedInvocation = Readonly<{ status: string; context_hash: string; binding_hash: string; response_json: string | null }>;

/** Proves the next stage from saved responses, never from an ordinal or ticket
 * asserted by the caller. A schema lookup cannot become a second decision. */
export function assertVNextInvocationTransition(input: VNextInvocationRequest,
  prior: (ordinal: number) => SavedInvocation | undefined,
  requiredContext: VNextRequiredContext): void {
  const invalid = (): never => { throw new TypeError("PROPOSAL_REPAIR_EXHAUSTED"); };
  const assertSurface = (tools: unknown, stage: VNextProposalStage, capabilities?: readonly VNextProposalCapabilityId[], terminalKinds?: readonly string[]) => {
    // Keep property presentation pinned as well as structural meaning.
    if (JSON.stringify(input.request.tools) !== JSON.stringify(tools)) invalid();
    const messages = input.request.messages;
    if (!Array.isArray(messages) || messages.length !== 2
      || !isPlainRecord(messages[1]) || messages[1].role !== "user"
      || typeof messages[1].content !== "string" || !messages[1].content.trim()
      || Object.keys(messages[1]).sort().join(",") !== "content,role"
      || canonicalHash(messages[0]) !== canonicalHash({ role: "system", content: vnextProposalSystemPrompt(stage, capabilities, terminalKinds) })
      || (stage !== "correction" && messages[1].content !== JSON.stringify({ requiredContext: proposalModelContext(requiredContext) }))) invalid();
  };
  if (input.ordinal === 1) {
    if (input.repairTicket !== undefined) invalid();
    assertSurface(createVNextProposalOfferModelInput("bound").tools, "offer", [], VNEXT_INITIAL_PROPOSAL_DECISION_KINDS);
    return;
  }
  function response(ordinal: number): unknown {
    const row = prior(ordinal);
    if (!row || row.status !== "completed" || row.context_hash !== input.contextHash
      || row.binding_hash !== input.bindingHash || row.response_json === null) return invalid();
    return JSON.parse(row.response_json);
  }
  const first = parseVNextProposalOfferResponse(response(1));
  if (input.ordinal === 2) {
    if (input.repairTicket !== undefined) invalid();
    assertSurface(createSubmitKpProposalBundleModelInput("bound", first.capabilities,
      proposalItemEntryRefs(requiredContext), proposalObservationSubjectRefs(requiredContext), first.terminalKinds, proposalNpcSourceChoices(requiredContext), requiredContextBasisReferences(requiredContext), proposalCreatureTargetRefs(requiredContext)).tools,
      "expandedProposal", first.capabilities, first.terminalKinds);
    return;
  }
  if (input.ordinal !== 3) return invalid();
  const candidate = parseSubmitKpProposalBundleCandidateResponse(response(2));
  assertVNextProposalCandidateCapabilities(candidate, first.capabilities, first.terminalKinds);
  if (candidate.kind !== "locallyRejected" || !vnextProposalHasExecutionRepairBudget(candidate.draft, first.capabilities)) return invalid();
  assertRepairTicket(input.repairTicket, input.contextHash, requiredContext);
  if (candidate.bundleHash !== input.repairTicket.bundleHash
    || canonicalHash(candidate.syntaxEvidence ?? null) !== canonicalHash(input.repairTicket.syntaxEvidence ?? null)
    || candidate.originalArguments !== input.repairTicket.originalArguments
    || candidate.argumentSource !== input.repairTicket.argumentSource
    || candidate.validationCode !== input.repairTicket.validationCode
    || canonicalHash(candidate.issues) !== canonicalHash(input.repairTicket.issues)
    || canonicalHash(vnextProposalModelRepairDiagnostics(candidate.draft, candidate.diagnostics, candidate.syntaxEvidence !== undefined, numericRepairSource(candidate), requiredContext)) !== canonicalHash(input.repairTicket.diagnostics)) invalid();
  assertSurface([CORRECT_KP_PROPOSAL_BUNDLE_TOOL], "correction");
  const messages = input.request.messages as readonly Record<string, unknown>[];
  if (messages[1]?.content !== vnextProposalCorrectionPrompt(input.repairTicket)) invalid();
}

/** Provider delays are seconds. Persist only a finite, representable deadline. */
export function vnextInvocationRetryAfter(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  const seconds = Math.ceil(value);
  return Number.isSafeInteger(seconds * 1_000)
    && seconds * 1_000 <= Number.MAX_SAFE_INTEGER - Date.now() ? seconds : undefined;
}
