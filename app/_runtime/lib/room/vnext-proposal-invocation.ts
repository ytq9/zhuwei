import type { JsonRecord } from "../kp/vnext/canonical-json";
import type { VNextProposalBundleRepairTicket } from "../kp/vnext/proposal-provider";
import { assertRepairTicket, assertVNextProposalCandidateCapabilities, parseSubmitKpProposalBundleCandidateResponse,
  parseVNextProposalOfferResponse, vnextProposalCorrectionPrompt, numericRepairSource, vnextProposalHasExecutionRepairBudget, vnextProposalHasThirdCallBudget,
  vnextProposalModelRepairDiagnostics, vnextProposalReemitPrompt, vnextProposalUnparsedArguments,
  vnextProposalAmendmentRequest } from "../kp/vnext/proposal-provider";
import { createVNextProposalOfferModelInput, CORRECT_KP_PROPOSAL_BUNDLE_TOOL, createSubmitKpProposalBundleModelInput, VNEXT_INITIAL_PROPOSAL_DECISION_KINDS } from "../kp/vnext/proposal-schema";
import { proposalCreatureTargetRefs, proposalItemEntryRefs, proposalObservationSubjectRefs, proposalModelContext, proposalNpcSourceChoices } from "../kp/vnext/proposal-context";
import { requiredContextBasisReferences } from "../kp/vnext/required-context-runtime";
import type { VNextRequiredContext } from "../kp/vnext/required-context";
import { canonicalHash, isPlainRecord } from "../kp/vnext/canonical-json";
import { vnextProposalSystemPrompt, type VNextProposalStage } from "../kp/vnext/proposal-guidance";
import type { VNextProposalCapabilityId } from "../kp/vnext/proposal-capabilities";

/** Private RPC vocabulary. Public HTTP accepts only the normal RoomActionInput. */
export type VNextInvocationRequest = Readonly<{
  /** Pure selection, then its proposal. A third call requires one of three
   * facts Room derives from the saved proposal itself: an amendment request, an
   * unparsed draft, or a repairable one. A fourth exists only after an
   * amendment, and settles the amended proposal the same way. */
  ordinal: 1 | 2 | 3 | 4;
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
  ordinal: 1 | 2 | 3 | 4;
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
  const assertSurface = (tools: unknown, stage: VNextProposalStage, capabilities?: readonly VNextProposalCapabilityId[],
    terminalKinds?: readonly string[], expectedUserBody?: string, amendable = false) => {
    // Keep property presentation pinned as well as structural meaning.
    if (JSON.stringify(input.request.tools) !== JSON.stringify(tools)) invalid();
    const messages = input.request.messages;
    if (!Array.isArray(messages) || messages.length !== 2
      || !isPlainRecord(messages[1]) || messages[1].role !== "user"
      || typeof messages[1].content !== "string" || !messages[1].content.trim()
      || Object.keys(messages[1]).sort().join(",") !== "content,role"
      || canonicalHash(messages[0]) !== canonicalHash({ role: "system", content: vnextProposalSystemPrompt(stage, capabilities, terminalKinds, amendable) })
      || (expectedUserBody !== undefined
        ? messages[1].content !== expectedUserBody
        : stage !== "correction" && messages[1].content !== JSON.stringify({ requiredContext: proposalModelContext(requiredContext) }))) invalid();
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
  const submitTools = (capabilities: readonly VNextProposalCapabilityId[],
    terminalKinds: readonly string[], amendable: boolean) =>
    createSubmitKpProposalBundleModelInput("bound", capabilities,
      proposalItemEntryRefs(requiredContext), proposalObservationSubjectRefs(requiredContext), terminalKinds,
      proposalNpcSourceChoices(requiredContext), requiredContextBasisReferences(requiredContext),
      proposalCreatureTargetRefs(requiredContext), amendable).tools;
  if (input.ordinal === 2) {
    if (input.repairTicket !== undefined) invalid();
    assertSurface(submitTools(first.capabilities, first.terminalKinds, true), "expandedProposal", first.capabilities, first.terminalKinds, undefined, true);
    return;
  }
  /** Settles one saved proposal response: the only legal continuations are one
   * re-emit of a draft that never parsed, or one correction of a repairable
   * one. Both are proved from the saved bytes, never asserted by the caller. */
  const settle = (saved: unknown, capabilities: readonly VNextProposalCapabilityId[],
    terminalKinds: readonly string[]): void => {
    const unparsed = vnextProposalUnparsedArguments(saved);
    if (unparsed !== undefined) {
      if (input.repairTicket !== undefined) invalid();
      if (!vnextProposalHasThirdCallBudget(capabilities)) invalid();
      assertSurface(submitTools(capabilities, terminalKinds, false), "expandedProposal", capabilities, terminalKinds,
        vnextProposalReemitPrompt(unparsed));
      return;
    }
    const candidate = parseSubmitKpProposalBundleCandidateResponse(saved);
    assertVNextProposalCandidateCapabilities(candidate, capabilities, terminalKinds);
    if (candidate.kind !== "locallyRejected" || !vnextProposalHasExecutionRepairBudget(candidate.draft, capabilities)) return invalid();
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
  };
  // An amendment at the proposal call is a union of types, derived here from
  // the saved response and the original selection alone.
  const amendment = vnextProposalAmendmentRequest(response(2), first.capabilities, first.terminalKinds);
  if (input.ordinal === 3) {
    if (amendment === undefined) return settle(response(2), first.capabilities, first.terminalKinds);
    if (input.repairTicket !== undefined) invalid();
    // The amended round fills the same frozen context and cannot amend again.
    assertSurface(submitTools(amendment.amendedCapabilities, amendment.amendedTerminalKinds, false), "expandedProposal",
      amendment.amendedCapabilities, amendment.amendedTerminalKinds);
    return;
  }
  if (input.ordinal !== 4 || amendment === undefined) return invalid();
  settle(response(3), amendment.amendedCapabilities, amendment.amendedTerminalKinds);
}

/** Provider delays are seconds. Persist only a finite, representable deadline. */
export function vnextInvocationRetryAfter(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  const seconds = Math.ceil(value);
  return Number.isSafeInteger(seconds * 1_000)
    && seconds * 1_000 <= Number.MAX_SAFE_INTEGER - Date.now() ? seconds : undefined;
}
