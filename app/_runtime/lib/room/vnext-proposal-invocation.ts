import { storyContextBindingMatches, type StoryPreparationBinding } from "./story-action-context";
import type { JsonRecord } from "../kp/vnext/canonical-json";
import type { VNextProposalBundleRepairTicket } from "../kp/vnext/proposal-provider";
import { assertRepairTicket,
  parseVNextProposalOfferResponse, vnextProposalHasExecutionRepairBudget, vnextProposalHasThirdCallBudget,
  vnextProposalUnparsedArguments, createVNextUnparsedRevisionTicket, createRepairTicket,
  vnextProposalAmendmentRequest, vnextProposalRevisionCandidate, createVNextProposalRevisionModelInput,
  createVNextAuthorityRevisionTicket, vnextProposalCalledSelectionTool, evaluateVNextProposalRevisionResponse,
  vnextProposalCorrectionAdmitted, vnextProposalDraftReply } from "../kp/vnext/proposal-provider";
import { authorityProposalDiagnostics, type ProposalDiagnostic } from "../kp/vnext/proposal-diagnostics";
import type { VNextProposalBundle } from "../kp/vnext/proposal-schema";
import { createVNextProposalOfferModelInput, createSubmitKpProposalBundleModelInput, VNEXT_INITIAL_PROPOSAL_DECISION_KINDS } from "../kp/vnext/proposal-schema";
import { proposalContextView, proposalCreatureTargetRefs, proposalItemDefinitionRefs, proposalItemEntryRefs, proposalKnowledgeRecall, proposalNpcRecall, proposalObservationSubjectRefs, proposalNpcSourceChoices, vnextProposalContextBody } from "../kp/vnext/proposal-context";
import { requiredContextBasisReferences } from "../kp/vnext/required-context-runtime";
import type { VNextRequiredContext } from "../kp/vnext/required-context";
import { canonicalHash, isPlainRecord } from "../kp/vnext/canonical-json";
import { VNEXT_PROPOSAL_CONTEXT_GUIDE, vnextProposalStageInstructions, type VNextProposalStage } from "../kp/vnext/proposal-guidance";
import type { VNextProposalCapabilityId } from "../kp/vnext/proposal-capabilities";
import { deriveEntryRef } from "../kp/vnext/proposal-graph";

/** Pure selection (1), its proposal (2), and after an amendment or a repeated
 * selection the refilled proposal (3). Every later call is a round of the one
 * correction conversation of that filling, up to three rounds; Room derives
 * each from the saved replies and the tickets it saved with earlier rounds. */
export type VNextInvocationOrdinal = 1 | 2 | 3 | 4 | 5 | 6;

/** Private RPC vocabulary. Public HTTP accepts only the normal RoomActionInput. */
export type VNextInvocationRequest = Readonly<{
  /** Explicit player recovery only; Room still owns admission and its limit. */
  recoverUnknown?: true;
  ordinal: VNextInvocationOrdinal;
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
  ordinal: VNextInvocationOrdinal;
  capability: string;
  requestHash: string;
  result: { kind: "completed"; response: unknown }
    | { kind: "retryable" | "rejected"; code: string; retryAfter?: number };
}>;

type SavedInvocation = Readonly<{ status: string; context_hash: string; binding_hash: string; response_json: string | null;
  /** The ticket Room saved with this call, when the call was a correction. */
  repair_ticket_json?: string | null }>;

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
  /** The leading block: the guidance for reading a frozen context and the
   * context itself, which every call of this action sends byte for byte. */
  const sameContextBlock = (content: unknown, npcRefs: readonly string[], knowledgeRefs: readonly string[]): boolean => {
    if (typeof content !== "string") return false;
    const head = `${VNEXT_PROPOSAL_CONTEXT_GUIDE}\n`;
    const rebuilt = head + vnextProposalContextBody(surfaceContext, npcRefs, knowledgeRefs);
    if (content === rebuilt) return true;
    // Under `canonical` the stored body may print its members in another order;
    // the guidance ahead of it is plain text and still has to match exactly.
    return presentation !== "exact" && content.startsWith(head)
      && samePresentation(content.slice(head.length), rebuilt.slice(head.length));
  };
  const assertSurface = (tools: unknown, stage: VNextProposalStage, capabilities?: readonly VNextProposalCapabilityId[],
    terminalKinds?: readonly string[], amendable = false, npcRefs: readonly string[] = [], knowledgeRefs: readonly string[] = []) => {
    if (!samePresentation(input.request.tools, tools)) invalid();
    const messages = input.request.messages;
    if (!Array.isArray(messages) || messages.length !== 2
      || !isPlainRecord(messages[0]) || messages[0].role !== "system"
      || Object.keys(messages[0]).sort().join(",") !== "content,role"
      || !sameContextBlock(messages[0].content, npcRefs, knowledgeRefs)
      || !isPlainRecord(messages[1]) || messages[1].role !== "user"
      || typeof messages[1].content !== "string" || !messages[1].content.trim()
      || Object.keys(messages[1]).sort().join(",") !== "content,role"
      || !samePresentation(messages[1].content,
        vnextProposalStageInstructions(stage, capabilities, terminalKinds, amendable))) invalid();
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
    assertSurface(submitTools(first.capabilities, first.terminalKinds, true, first.npcRefs, first.knowledgeRefs), "expandedProposal", first.capabilities, first.terminalKinds, true, first.npcRefs, first.knowledgeRefs);
    return;
  }
  /** Settles one filling: the only legal continuations of its reply are the
   * rounds of one correction conversation, each proved from the saved replies
   * and the tickets Room saved with the earlier rounds, never asserted by the
   * caller. `fillOrdinal` is the call whose reply the first round answers. */
  const settle = (fillOrdinal: number, capabilities: readonly VNextProposalCapabilityId[],
    terminalKinds: readonly string[], npcRefs: readonly string[], knowledgeRefs: readonly string[]): void => {
    if (input.repairTicket === undefined || input.ordinal <= fillOrdinal) return invalid();
    assertRepairTicket(input.repairTicket, input.contextHash, requiredContext);
    const savedTicket = (ordinal: number): VNextProposalBundleRepairTicket => {
      const row = prior(ordinal);
      if (!row || row.status !== "completed" || typeof row.repair_ticket_json !== "string") return invalid();
      const ticket: unknown = JSON.parse(row.repair_ticket_json);
      assertRepairTicket(ticket, input.contextHash, requiredContext);
      return ticket;
    };
    /** The ticket that answers an accepted draft: the Rules rejection proved
     * now for the round being sent, or the one Room proved when it sent an
     * earlier round, re-derived from the diagnostics it saved then. */
    const rulesTicket = (reply: unknown, bundle: VNextProposalBundle, bundleHash: string, round: number, ordinal: number,
      loaded: readonly VNextProposalCapabilityId[]): VNextProposalBundleRepairTicket => {
      if (ordinal === input.ordinal) {
        const diagnostics = proveRulesRejection?.(bundle);
        if (diagnostics === undefined || diagnostics.length === 0) return invalid();
        return createVNextAuthorityRevisionTicket(reply, requiredContext, loaded, terminalKinds, diagnostics, npcRefs, knowledgeRefs, round);
      }
      const saved = savedTicket(ordinal);
      if (saved.validationCode !== "PROPOSAL_RULES_DIAGNOSTIC" || saved.bundleHash !== bundleHash || saved.round !== round
        || canonicalHash(createVNextAuthorityRevisionTicket(reply, requiredContext, loaded, terminalKinds, saved.diagnostics, npcRefs, knowledgeRefs, round))
          !== canonicalHash(saved)) return invalid();
      return saved;
    };
    const chain: VNextProposalBundleRepairTicket[] = [];
    for (let ordinal = fillOrdinal + 1; ordinal <= input.ordinal; ordinal += 1) {
      const reply = response(ordinal - 1);
      const previous = chain[chain.length - 1];
      const round = chain.length + 1;
      let expected: VNextProposalBundleRepairTicket;
      if (previous === undefined) {
        // The filling reply, read exactly as the Provider read it.
        const unparsed = vnextProposalUnparsedArguments(reply);
        if (unparsed !== undefined) {
          if (!vnextProposalHasThirdCallBudget(capabilities)) return invalid();
          expected = createVNextUnparsedRevisionTicket(unparsed, requiredContext, capabilities, terminalKinds, npcRefs, knowledgeRefs, round);
        } else {
          const candidate = vnextProposalRevisionCandidate(reply, capabilities, terminalKinds);
          const draft = candidate.kind === "accepted" ? candidate.bundle as unknown as JsonRecord : candidate.draft;
          if (!(Object.keys(draft).length === 0 ? vnextProposalHasThirdCallBudget(capabilities)
            : vnextProposalHasExecutionRepairBudget(draft, capabilities))) return invalid();
          expected = candidate.kind === "accepted" ? rulesTicket(reply, candidate.bundle, candidate.bundleHash, round, ordinal, capabilities)
            : createRepairTicket(candidate, requiredContext, capabilities, terminalKinds, npcRefs, knowledgeRefs, round);
        }
      } else {
        // A correction reply, read against the ticket it answered: the next
        // round's ticket, or an accepted draft whose Rules rejection is the
        // ticket. A re-emit's reply is read as a fresh filling by the same call.
        const evaluated = evaluateVNextProposalRevisionResponse(reply, previous, requiredContext, chain.slice(0, -1));
        if (evaluated.result.kind === "repairRequired") expected = evaluated.result.repairTicket;
        else if (evaluated.result.kind === "locallyAccepted") {
          const accepted = evaluated.synthesis === undefined ? reply : vnextProposalDraftReply(evaluated.synthesis.draft);
          // Inherit only the ticket already re-proved in this loop, never the
          // loaded types asserted by the incoming or persisted next ticket.
          expected = rulesTicket(accepted, evaluated.result.bundle, evaluated.result.bundleHash, round, ordinal, previous.capabilities);
        } else return invalid();
      }
      if (!vnextProposalCorrectionAdmitted([...chain, expected])) return invalid();
      if (canonicalHash(expected) !== canonicalHash(ordinal === input.ordinal ? input.repairTicket : savedTicket(ordinal))) return invalid();
      chain.push(expected);
    }
    const modelInput = createVNextProposalRevisionModelInput(chain, requiredContext);
    if (!samePresentation(input.request.tools, modelInput.tools)
      || !samePresentation(input.request.messages, modelInput.messages)) invalid();
  };
  // An amendment at the proposal call is a union of types, derived here from
  // the saved response and the original selection alone.
  const amendment = vnextProposalAmendmentRequest(response(2), first.capabilities, first.terminalKinds, first.npcRefs, requiredContext, first.knowledgeRefs);
  // The filling whose reply the corrections answer: the second call, unless
  // that call amended or merely repeated the selection, when it is the third.
  const refilled = amendment === undefined && vnextProposalCalledSelectionTool(response(2));
  const fillOrdinal = amendment === undefined && !refilled ? 2 : 3;
  const filling = amendment === undefined
    ? { capabilities: first.capabilities, terminalKinds: first.terminalKinds, npcRefs: first.npcRefs, knowledgeRefs: first.knowledgeRefs }
    : { capabilities: amendment.amendedCapabilities, terminalKinds: amendment.amendedTerminalKinds, npcRefs: amendment.amendedNpcRefs, knowledgeRefs: amendment.amendedKnowledgeRefs };
  if (input.ordinal === 3 && fillOrdinal === 3) {
    // A reply that called the selection tool and added nothing carries no
    // draft to settle: the original selection is filled once more, sent
    // without the selection tool, exactly as the amended round is sent.
    if (input.repairTicket !== undefined) invalid();
    assertSurface(submitTools(filling.capabilities, filling.terminalKinds, false, filling.npcRefs, filling.knowledgeRefs), "expandedProposal",
      filling.capabilities, filling.terminalKinds, false, filling.npcRefs, filling.knowledgeRefs);
    return;
  }
  settle(fillOrdinal, filling.capabilities, filling.terminalKinds, filling.npcRefs, filling.knowledgeRefs);
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
    const indexed = remaining.map(part => /^\d+$/u.test(String(part)) ? Number(part) : part);
    if (remaining[0] === "ruling") path = ["adjudication", ...indexed.slice(1)];
    else if (ordinal !== undefined && remaining[0] === "operation" && isPlainRecord(proposals[ordinal])
      && Object.hasOwn(proposals[ordinal], "operation")) path.push(...indexed);
    // A cited basis Rules could not resolve is reported at its position in
    // the step's own basisRefs, which the filling layout keeps in place.
    else if (ordinal !== undefined && remaining[0] === "basisRefs" && isPlainRecord(proposals[ordinal])
      && Array.isArray(proposals[ordinal].basisRefs)) path.push(...indexed);
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
