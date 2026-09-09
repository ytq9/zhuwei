import type { JsonRecord } from "../kp/vnext/canonical-json";
import type { VNextProposalBundleRepairTicket } from "../kp/vnext/proposal-provider";
import { assertRepairTicket,
  parseVNextProposalOfferResponse, vnextProposalCorrectionPrompt, vnextProposalHasExecutionRepairBudget, vnextProposalHasThirdCallBudget,
  vnextProposalUnparsedArguments, createVNextUnparsedRevisionTicket, createRepairTicket,
  vnextProposalAmendmentRequest, vnextProposalRevisionCandidate, createVNextProposalRevisionModelInput,
  createVNextAuthorityRevisionTicket } from "../kp/vnext/proposal-provider";
import { authorityProposalDiagnostics, type ProposalDiagnostic } from "../kp/vnext/proposal-diagnostics";
import type { VNextProposalBundle } from "../kp/vnext/proposal-schema";
import { createVNextProposalOfferModelInput, createSubmitKpProposalBundleModelInput, VNEXT_INITIAL_PROPOSAL_DECISION_KINDS } from "../kp/vnext/proposal-schema";
import { proposalCreatureTargetRefs, proposalItemDefinitionRefs, proposalItemEntryRefs, proposalObservationSubjectRefs, proposalModelContext, proposalNpcSourceChoices } from "../kp/vnext/proposal-context";
import { requiredContextBasisReferences } from "../kp/vnext/required-context-runtime";
import type { VNextRequiredContext } from "../kp/vnext/required-context";
import { canonicalHash, isPlainRecord } from "../kp/vnext/canonical-json";
import { vnextProposalSystemPrompt, type VNextProposalStage } from "../kp/vnext/proposal-guidance";
import type { VNextProposalCapabilityId } from "../kp/vnext/proposal-capabilities";
import { deriveEntryRef } from "../kp/vnext/proposal-graph";

/** Private RPC vocabulary. Public HTTP accepts only the normal RoomActionInput. */
export type VNextInvocationRequest = Readonly<{
  /** Pure selection, then its proposal. A third call requires one of three
   * facts Room derives from the saved proposal: an amendment request, an
   * unparsed draft, or a rejected draft (local or Rules preflight). A fourth exists only after an
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
  requiredContext: VNextRequiredContext,
  proveRulesRejection?: (bundle: VNextProposalBundle) => readonly ProposalDiagnostic[]): void {
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
      proposalCreatureTargetRefs(requiredContext), amendable, proposalItemDefinitionRefs(requiredContext)).tools;
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
    assertRepairTicket(input.repairTicket, input.contextHash, requiredContext);
    const unparsed = vnextProposalUnparsedArguments(saved);
    let expected: VNextProposalBundleRepairTicket;
    if (unparsed !== undefined) {
      if (!vnextProposalHasThirdCallBudget(capabilities)) return invalid();
      expected = createVNextUnparsedRevisionTicket(unparsed, requiredContext, capabilities, terminalKinds);
    } else {
      const candidate = vnextProposalRevisionCandidate(saved, capabilities, terminalKinds);
      const draft = candidate.kind === "accepted" ? candidate.bundle as unknown as JsonRecord : candidate.draft;
      if (!(Object.keys(draft).length === 0 ? vnextProposalHasThirdCallBudget(capabilities)
        : vnextProposalHasExecutionRepairBudget(draft, capabilities))) return invalid();
      if (candidate.kind === "accepted") {
        const diagnostics = proveRulesRejection?.(candidate.bundle);
        if (diagnostics === undefined || diagnostics.length === 0) return invalid();
        expected = createVNextAuthorityRevisionTicket(saved, requiredContext, capabilities, terminalKinds, diagnostics);
      } else expected = createRepairTicket(candidate, requiredContext, capabilities, terminalKinds);
    }
    if (canonicalHash(expected) !== canonicalHash(input.repairTicket)) return invalid();
    const modelInput = createVNextProposalRevisionModelInput(input.repairTicket, requiredContext);
    if (JSON.stringify(input.request.tools) !== JSON.stringify(modelInput.tools)
      || JSON.stringify(input.request.messages) !== JSON.stringify(modelInput.messages)) invalid();
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

/** A pure Rules preflight may prove a technical rejection, never a successful
 * plan or a world ruling. It neither draws dice nor persists candidate events. */
export function vnextRulesRevisionDiagnostics(outcome: unknown, provenance?: Readonly<{ bundle: unknown; rulesInput: unknown }>): readonly ProposalDiagnostic[] {
  if (!isPlainRecord(outcome)) return [];
  if (outcome.kind === "needsKp") return mapRulesDiagnosticSources(authorityProposalDiagnostics(outcome.diagnostics), provenance);
  if (outcome.kind !== "rejected" || !isPlainRecord(outcome.rejection)
    || ["missingPrerequisite", "unchangedRetry", "worldLawViolation"].includes(String(outcome.rejection.code))) return [];
  const rejection = outcome.rejection;
  return mapRulesDiagnosticSources(authorityProposalDiagnostics(Array.isArray(rejection.diagnostics) && rejection.diagnostics.length > 0
    ? rejection.diagnostics : [{ code: rejection.code, rulesMessage: rejection.message }]), provenance);
}

/** Resolve Rules' execution order through the actual lowered proposalRef, not
 * its array index: dependency ordering can differ from the filling step order. */
function mapRulesDiagnosticSources(diagnostics: readonly ProposalDiagnostic[], provenance?: Readonly<{ bundle: unknown; rulesInput: unknown }>): readonly ProposalDiagnostic[] {
  const bundle = provenance?.bundle;
  if (!isPlainRecord(bundle) || !Array.isArray(bundle.proposals) || !isPlainRecord(provenance?.rulesInput)) return diagnostics;
  const originalInput = provenance.rulesInput, proposals = bundle.proposals;
  return diagnostics.map(diagnostic => {
    if (diagnostic.pathBase !== "rulesInput" || !diagnostic.path) return diagnostic;
    let input = originalInput, remaining = [...diagnostic.path];
    if (input.kind === "startActionActivity" && isPlainRecord(input.completionInput)) {
      input = input.completionInput;
      if (remaining[0] === "completionInput") remaining.shift();
    }
    let ordinal: number | undefined;
    if (remaining[0] === "steps" && /^\d+$/u.test(String(remaining[1])) && remaining[2] === "rulesInput" && Array.isArray(input.steps)) {
      const step = input.steps[Number(remaining[1])];
      if (isPlainRecord(step) && typeof input.rootActionId === "string" && typeof input.contextHash === "string" && typeof input.bundleHash === "string") {
        const found = proposals.findIndex((entry, index) => isPlainRecord(entry) && typeof entry.kind === "string"
          && deriveEntryRef(input.rootActionId as string, input.contextHash as string, input.bundleHash as string, index, entry.kind as Parameters<typeof deriveEntryRef>[4]) === step.proposalRef);
        if (found >= 0) ordinal = found;
      }
      remaining = remaining.slice(3);
    } else if (proposals.length === 1) ordinal = 0;
    let path: (string | number)[] = ordinal === undefined ? [] : ["proposals", ordinal];
    if (remaining[0] === "plan") remaining.shift();
    if (remaining[0] === "ruling") path = ["adjudication", ...remaining.slice(1)];
    else if (ordinal !== undefined && remaining[0] === "operation" && isPlainRecord(proposals[ordinal])
      && Object.hasOwn(proposals[ordinal], "operation")) path.push(...remaining);
    else if (bundle.mode === "terminal") path = ["terminal"];
    return { ...diagnostic, authorityPath: diagnostic.path, path, pathBase: "draft" as const };
  });
}

/** Provider delays are seconds. Persist only a finite, representable deadline. */
export function vnextInvocationRetryAfter(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  const seconds = Math.ceil(value);
  return Number.isSafeInteger(seconds * 1_000)
    && seconds * 1_000 <= Number.MAX_SAFE_INTEGER - Date.now() ? seconds : undefined;
}
