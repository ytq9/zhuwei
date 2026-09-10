import { storyContextBindingMatches, type StoryPreparationBinding } from "./story-action-context";
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
import { proposalContextView, proposalCreatureTargetRefs, proposalItemDefinitionRefs, proposalItemEntryRefs, proposalKnowledgeRecall, proposalNpcRecall, proposalObservationSubjectRefs, proposalModelContext, proposalNpcSourceChoices } from "../kp/vnext/proposal-context";
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
  requiredContext: VNextRequiredContext, storyBinding?: StoryPreparationBinding,
  proveRulesRejection?: (bundle: VNextProposalBundle) => readonly ProposalDiagnostic[],
  /** How the saved request may present itself. The Room proves a request it is
   * about to send and pins its exact printing; the story archive proves one it
   * read back, which D1 stores canonically, so there only the values match. */
  presentation: "exact" | "canonical" = "exact"): void {
  const invalid = (): never => { throw new TypeError("PROPOSAL_REPAIR_EXHAUSTED"); };
  if (storyBinding !== undefined && !storyContextBindingMatches(requiredContext, storyBinding)) invalid();
  const selectionContext = storyBinding?.selectionContext ?? requiredContext;
  const surfaceContext = input.ordinal === 1 ? selectionContext : requiredContext;
  /** Under `exact` the saved request must print exactly as it was built. Under
   * `canonical` the same values may arrive in the store's member order, and a
   * body carried as one JSON string is compared by what it parses to. */
  const samePresentation = (saved: unknown, rebuilt: unknown): boolean => {
    if (JSON.stringify(saved) === JSON.stringify(rebuilt)) return true;
    if (presentation === "exact") return false;
    if (canonicalHash(saved) === canonicalHash(rebuilt)) return true;
    if (typeof saved === "string" && typeof rebuilt === "string") {
      try { return canonicalHash(JSON.parse(saved)) === canonicalHash(JSON.parse(rebuilt)); } catch { return false; }
    }
    if (Array.isArray(saved) && Array.isArray(rebuilt)) {
      return saved.length === rebuilt.length && saved.every((entry, index) => samePresentation(entry, rebuilt[index]));
    }
    if (isPlainRecord(saved) && isPlainRecord(rebuilt)) {
      const keys = Object.keys(saved).sort();
      return keys.join(",") === Object.keys(rebuilt).sort().join(",")
        && keys.every(key => samePresentation(saved[key], rebuilt[key]));
    }
    return false;
  };
  const sameUserBody = (content: string, stage: VNextProposalStage, expectedUserBody: string | undefined,
    npcRefs: readonly string[], knowledgeRefs: readonly string[]): boolean => {
    if (expectedUserBody !== undefined) return samePresentation(content, expectedUserBody);
    if (stage === "correction") return true;
    return samePresentation(content, JSON.stringify({ requiredContext: proposalModelContext(surfaceContext, npcRefs, knowledgeRefs) }));
  };
  const assertSurface = (tools: unknown, stage: VNextProposalStage, capabilities?: readonly VNextProposalCapabilityId[],
    terminalKinds?: readonly string[], expectedUserBody?: string, amendable = false, npcRefs: readonly string[] = [], knowledgeRefs: readonly string[] = []) => {
    if (!samePresentation(input.request.tools, tools)) invalid();
    const messages = input.request.messages;
    if (!Array.isArray(messages) || messages.length !== 2
      || !isPlainRecord(messages[1]) || messages[1].role !== "user"
      || typeof messages[1].content !== "string" || !messages[1].content.trim()
      || Object.keys(messages[1]).sort().join(",") !== "content,role"
      || canonicalHash(messages[0]) !== canonicalHash({ role: "system", content: vnextProposalSystemPrompt(stage, capabilities, terminalKinds, amendable) })
      || !sameUserBody(messages[1].content, stage, expectedUserBody, npcRefs, knowledgeRefs)) invalid();
  };
  if (input.ordinal === 1) {
    if (input.repairTicket !== undefined) invalid();
    assertSurface(createVNextProposalOfferModelInput("bound", selectionContext).tools, "offer", [], VNEXT_INITIAL_PROPOSAL_DECISION_KINDS);
    return;
  }
  function response(ordinal: number): unknown {
    const row = prior(ordinal);
    if (!row || row.status !== "completed" || row.context_hash !== (ordinal === 1 ? selectionContext.binding.contextHash : input.contextHash)
      || row.binding_hash !== input.bindingHash || row.response_json === null) return invalid();
    return JSON.parse(row.response_json);
  }
  const first = parseVNextProposalOfferResponse(response(1), selectionContext);
  if ((first.story !== undefined) !== (storyBinding !== undefined)) invalid();
  // The filling surface is built over the frozen context less the bystander
  // views the selection did not name, exactly as the Provider built it.
  const submitTools = (capabilities: readonly VNextProposalCapabilityId[],
    terminalKinds: readonly string[], amendable: boolean, npcRefs: readonly string[], knowledgeRefs: readonly string[]) => {
    const view = proposalContextView(requiredContext, npcRefs, knowledgeRefs);
    const requestable = proposalNpcRecall(requiredContext).requestableRefs.filter(ref => !npcRefs.includes(ref));
    const handles = proposalKnowledgeRecall(requiredContext, npcRefs).filter(record => !knowledgeRefs.includes(record.entryRef)).map(record => record.handle);
    return createSubmitKpProposalBundleModelInput("bound", capabilities,
      proposalItemEntryRefs(view), proposalObservationSubjectRefs(view), terminalKinds,
      proposalNpcSourceChoices(view), requiredContextBasisReferences(view),
      proposalCreatureTargetRefs(view), amendable, proposalItemDefinitionRefs(view), amendable ? requestable : [], amendable ? handles : []).tools;
  };
  if (input.ordinal === 2) {
    if (input.repairTicket !== undefined) invalid();
    assertSurface(submitTools(first.capabilities, first.terminalKinds, true, first.npcRefs, first.knowledgeRefs), "expandedProposal", first.capabilities, first.terminalKinds, undefined, true, first.npcRefs, first.knowledgeRefs);
    return;
  }
  /** Settles one saved proposal response: the only legal continuations are one
   * re-emit of a draft that never parsed, or one correction of a repairable
   * one. Both are proved from the saved bytes, never asserted by the caller. */
  const settle = (saved: unknown, capabilities: readonly VNextProposalCapabilityId[],
    terminalKinds: readonly string[], npcRefs: readonly string[], knowledgeRefs: readonly string[]): void => {
    assertRepairTicket(input.repairTicket, input.contextHash, requiredContext);
    const unparsed = vnextProposalUnparsedArguments(saved);
    let expected: VNextProposalBundleRepairTicket;
    if (unparsed !== undefined) {
      if (!vnextProposalHasThirdCallBudget(capabilities)) return invalid();
      expected = createVNextUnparsedRevisionTicket(unparsed, requiredContext, capabilities, terminalKinds, npcRefs, knowledgeRefs);
    } else {
      const candidate = vnextProposalRevisionCandidate(saved, capabilities, terminalKinds);
      const draft = candidate.kind === "accepted" ? candidate.bundle as unknown as JsonRecord : candidate.draft;
      if (!(Object.keys(draft).length === 0 ? vnextProposalHasThirdCallBudget(capabilities)
        : vnextProposalHasExecutionRepairBudget(draft, capabilities))) return invalid();
      if (candidate.kind === "accepted") {
        const diagnostics = proveRulesRejection?.(candidate.bundle);
        if (diagnostics === undefined || diagnostics.length === 0) return invalid();
        expected = createVNextAuthorityRevisionTicket(saved, requiredContext, capabilities, terminalKinds, diagnostics, npcRefs, knowledgeRefs);
      } else expected = createRepairTicket(candidate, requiredContext, capabilities, terminalKinds, npcRefs, knowledgeRefs);
    }
    if (canonicalHash(expected) !== canonicalHash(input.repairTicket)) return invalid();
    const modelInput = createVNextProposalRevisionModelInput(input.repairTicket, requiredContext);
    if (!samePresentation(input.request.tools, modelInput.tools)
      || !samePresentation(input.request.messages, modelInput.messages)) invalid();
  };
  // An amendment at the proposal call is a union of types, derived here from
  // the saved response and the original selection alone.
  const amendment = vnextProposalAmendmentRequest(response(2), first.capabilities, first.terminalKinds, first.npcRefs, requiredContext, first.knowledgeRefs);
  if (input.ordinal === 3) {
    if (amendment === undefined) return settle(response(2), first.capabilities, first.terminalKinds, first.npcRefs, first.knowledgeRefs);
    if (input.repairTicket !== undefined) invalid();
    // The amended round fills the same frozen context, sent with the enlarged
    // view, and cannot amend again.
    assertSurface(submitTools(amendment.amendedCapabilities, amendment.amendedTerminalKinds, false, amendment.amendedNpcRefs, amendment.amendedKnowledgeRefs), "expandedProposal",
      amendment.amendedCapabilities, amendment.amendedTerminalKinds, undefined, false, amendment.amendedNpcRefs, amendment.amendedKnowledgeRefs);
    return;
  }
  if (input.ordinal !== 4 || amendment === undefined) return invalid();
  settle(response(3), amendment.amendedCapabilities, amendment.amendedTerminalKinds, amendment.amendedNpcRefs, amendment.amendedKnowledgeRefs);
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
