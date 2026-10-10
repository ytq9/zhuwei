import { noObjectCompletionOffered } from "../kp/vnext/proposal-capabilities";
import { isNpcReviewTicket, npcReviewModelInput, settleNpcConversation, NPC_REVIEW_FIRST_ORDINAL, NPC_REVIEW_LAST_ORDINAL,
  type NpcReviewContextView, type NpcReviewSaved, type NpcReviewTicket } from "../kp/vnext/npc-reply-review";
import { kpRequestBody } from "../kp/model-request";
import { storyContextBindingMatches, type StoryPreparationBinding } from "./story-action-context";
import { vnextRetryAnswerTask, type VNextRetryQuestion } from "../kp/vnext/retry-question";
import type { JsonRecord } from "../kp/vnext/canonical-json";
import type { VNextProposalBundleRepairTicket } from "../kp/vnext/proposal-provider";
import { assertRepairTicket,
  parseVNextProposalOfferResponse, vnextProposalDraftIsEmpty, vnextProposalHasExecutionRepairBudget, vnextProposalHasThirdCallBudget,
  vnextProposalUnparsedArguments, createVNextUnparsedRevisionTicket, createRepairTicket,
  vnextProposalAmendmentRequest, VNextProposalBundleOutputError, vnextProposalRevisionCandidate, createVNextProposalRevisionModelInput,
  createVNextAuthorityRevisionTicket, vnextProposalCalledSelectionTool, evaluateVNextProposalRevisionResponse, vnextProposalTicketWithSavedPreflight,
  vnextProposalCorrectionAdmitted, vnextProposalDraftReply } from "../kp/vnext/proposal-provider";
import { authorityProposalDiagnostics, type ProposalDiagnostic } from "../kp/vnext/proposal-diagnostics";
import type { VNextProposalBundle } from "../kp/vnext/proposal-schema";
import { createVNextProposalOfferModelInput, createSubmitKpProposalBundleModelInput, VNEXT_INITIAL_PROPOSAL_DECISION_KINDS, vnextProposalSystemParts } from "../kp/vnext/proposal-schema";
import { proposalContextView, proposalCreatureTargetRefs, proposalItemDefinitionRefs, proposalItemEntryRefs, proposalInventoryEntryRefs, proposalRequestableKnowledgeHandles, proposalNpcRecall, proposalObservationSubjectRefs, proposalNpcSourceChoices, proposalPossessionRecall, proposalUnofferedCapabilities, vnextProposalContextBody } from "../kp/vnext/proposal-context";
import { requiredContextBasisReferences } from "../kp/vnext/required-context-runtime";
import type { VNextRequiredContext } from "../kp/vnext/required-context";
import { isPlainRecord, sameCanonical } from "../kp/vnext/canonical-json";
import { proposalWireReferences } from "../kp/vnext/proposal-reference-dialect";
import { vnextProposalReferenceRules, vnextProposalTaskInstruction, type VNextProposalStage } from "../kp/vnext/proposal-guidance";
import type { VNextProposalCapabilityId } from "../kp/vnext/proposal-capabilities";
import { deriveEntryRef } from "../kp/vnext/proposal-graph";
import { isNpcReplyTicket, npcReplyModelInput, NPC_REPLY_FIRST_ORDINAL, NPC_REPLY_LAST_ORDINAL,
  type NpcReplySaved, type NpcReplyTicket } from "../kp/vnext/npc-reply";

/** Pure selection (1), its proposal (2), and after an amendment or a repeated
 * selection the refilled proposal (3). Every later call is a round of the one
 * correction conversation of that filling, up to three rounds; Room derives
 * each from the saved replies and the tickets it saved with earlier rounds. */
export type VNextInvocationOrdinal = 1 | 2 | 3 | 4 | 5 | 6;

/** Whether an ordinal is one of the ruling's own calls. */
export function isVNextInvocationOrdinal(ordinal: number): ordinal is VNextInvocationOrdinal {
  return [1, 2, 3, 4, 5, 6].includes(ordinal);
}
/** SPEC 0016 §7.2 (ADR 0073): the calls that ask an NPC for its own reply
 * are saved with the prepared action they answer, after the ruling's calls. */
export function isVNextNpcReplyOrdinal(ordinal: number): boolean {
  return Number.isSafeInteger(ordinal) && ordinal >= NPC_REPLY_FIRST_ORDINAL && ordinal <= NPC_REPLY_LAST_ORDINAL;
}

/** Private RPC vocabulary. Public HTTP accepts only the normal RoomActionInput. */
export type VNextInvocationRequest = Readonly<{
  /** Explicit player recovery only; Room still owns admission and its limit. */
  recoverUnknown?: true;
  /** One of the ruling's six, or an NPC reply's. */
  ordinal: number;
  contextHash: string;
  bindingHash: string;
  requestHash: string;
  request: JsonRecord;
  repairTicket?: VNextProposalBundleRepairTicket;
  /** Present exactly on the call of an NPC's own reply. */
  npcReply?: NpcReplyTicket;
  npcReview?: NpcReviewTicket;
}>;

export type VNextInvocationStart =
  | { kind: "ready"; capability: string }
  | { kind: "completed"; response: unknown }
  | { kind: "rejected" | "retryableFailure"; code: string; retryAfter?: number };

export type VNextInvocationCompletion = Readonly<{
  ordinal: number;
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
  presentation: "exact" | "canonical" = "exact",
  /** The question this action asked the player and the answer (ADR 0081):
   * before it, the selection may offer the question tool; after it, every
   * task carries the answer. */
  retryQuestion?: VNextRetryQuestion,
  /** SPEC 0016 §7.2 (ADR 0138): the ticket of a locally refused draft with
   * what Room's preflight of the rest finds now, for the round being sent.
   * Without it nothing is added. */
  preflightLocalTicket?: (ticket: VNextProposalBundleRepairTicket) => VNextProposalBundleRepairTicket): void {
  const invalid = (): never => { throw new TypeError("PROPOSAL_REPAIR_EXHAUSTED"); };
  if (!isVNextInvocationOrdinal(input.ordinal) || input.npcReply !== undefined || input.npcReview !== undefined) invalid();
  if (storyBinding !== undefined && !storyContextBindingMatches(requiredContext, storyBinding)) invalid();
  const selectionContext = storyBinding?.selectionContext ?? requiredContext;
  const surfaceContext = input.ordinal === 1 ? selectionContext : requiredContext;
  /** Under `exact` the saved request must print exactly as it was built. Under
   * `canonical` the same values may arrive in the store's member order, and a
   * body carried as one JSON string is compared by what it parses to. */
  const samePresentation = (saved: unknown, rebuilt: unknown): boolean => {
    if (JSON.stringify(saved) === JSON.stringify(rebuilt)) return true;
    if (presentation === "exact") return false;
    if (sameCanonical(saved, rebuilt)) return true;
    if (typeof saved === "string" && typeof rebuilt === "string") {
      // A system message carries the context body between the guide and the
      // rules; the body is compared by value, the rest byte for byte.
      const savedParts = vnextProposalSystemParts(saved), rebuiltParts = vnextProposalSystemParts(rebuilt);
      if (savedParts !== undefined && rebuiltParts !== undefined) return savedParts.objectCompletion === rebuiltParts.objectCompletion
        && savedParts.referenceRules === rebuiltParts.referenceRules
        && samePresentation(savedParts.contextBody, rebuiltParts.contextBody);
      try { return sameCanonical(JSON.parse(saved), JSON.parse(rebuilt)); } catch { return false; }
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
  /** This action's frozen context, which every call of the action sends byte
   * for byte. Under `canonical` the stored body may print its members in
   * another order, so there only the values have to match. */
  const sameContextBody = (content: unknown, npcRefs: readonly string[], knowledgeRefs: readonly string[]): boolean => {
    if (typeof content !== "string") return false;
    // Mapping uses the original frozen authority, not a filtered view: an
    // unread NPC fact may still be referenced by a visible pending plan.
    const rebuilt = JSON.stringify(proposalWireReferences(JSON.parse(vnextProposalContextBody(surfaceContext, npcRefs, knowledgeRefs)),
      surfaceContext));
    return content === rebuilt || (presentation !== "exact" && samePresentation(content, rebuilt));
  };
  const shapedMessage = (message: unknown, role: string): boolean => isPlainRecord(message)
    && message.role === role && typeof message.content === "string" && message.content.trim().length > 0
    && Object.keys(message).sort().join(",") === "content,role";
  /** The reading guide, this action's context and the stage's rules in the
   * system message, then the task -- the exact two messages
   * `vnextProposalRequestMessages` builds. */
  const assertSurface = (tools: unknown, stage: VNextProposalStage, capabilities?: readonly VNextProposalCapabilityId[],
    terminalKinds?: readonly string[], amendable = false, npcRefs: readonly string[] = [], knowledgeRefs: readonly string[] = []) => {
    if (!samePresentation(input.request.tools, kpRequestBody(String(input.request.model), { tools }).tools)) invalid();
    const messages = input.request.messages;
    if (!Array.isArray(messages) || messages.length !== 2 || !shapedMessage(messages[0], "system") || !shapedMessage(messages[1], "user")) return invalid();
    const system = vnextProposalSystemParts(messages[0].content);
    const unoffered = proposalUnofferedCapabilities(surfaceContext);
    if (system === undefined || system.objectCompletion === noObjectCompletionOffered(unoffered)
      || system.referenceRules !== vnextProposalReferenceRules(stage, capabilities, terminalKinds, unoffered)
      || !sameContextBody(system.contextBody, npcRefs, knowledgeRefs)
      || !samePresentation(messages[1].content, vnextRetryAnswerTask(vnextProposalTaskInstruction(stage, amendable), retryQuestion))) invalid();
  };
  if (input.ordinal === 1) {
    if (input.repairTicket !== undefined) invalid();
    assertSurface(createVNextProposalOfferModelInput(vnextProposalContextBody(selectionContext), selectionContext, retryQuestion).tools, "offer", [], VNEXT_INITIAL_PROPOSAL_DECISION_KINDS);
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
    const handles = proposalRequestableKnowledgeHandles(requiredContext, npcRefs, knowledgeRefs);
    const carried = proposalPossessionRecall(requiredContext, knowledgeRefs).map(row => row.entryRef);
    return createSubmitKpProposalBundleModelInput(vnextProposalContextBody(requiredContext, npcRefs, knowledgeRefs), capabilities,
      proposalItemEntryRefs(view), proposalObservationSubjectRefs(view), terminalKinds,
      proposalNpcSourceChoices(view), requiredContextBasisReferences(view),
      proposalCreatureTargetRefs(view), amendable, proposalItemDefinitionRefs(view), amendable ? requestable : [], amendable ? handles : [],
      undefined, proposalUnofferedCapabilities(requiredContext), proposalInventoryEntryRefs(view), requiredContext, amendable ? carried : []).tools;
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
        || !sameCanonical(createVNextAuthorityRevisionTicket(reply, requiredContext, loaded, terminalKinds, saved.diagnostics, npcRefs, knowledgeRefs, round), saved)) return invalid();
      return saved;
    };
    /** A locally refused draft's ticket: preflighted now for the round being
     * sent, or with the preflight Room proved when it sent an earlier one. */
    const localTicket = (ticket: VNextProposalBundleRepairTicket, ordinal: number): VNextProposalBundleRepairTicket =>
      ordinal === input.ordinal ? preflightLocalTicket?.(ticket) ?? ticket : vnextProposalTicketWithSavedPreflight(ticket, savedTicket(ordinal));
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
          const candidate = vnextProposalRevisionCandidate(reply, capabilities, terminalKinds, requiredContext, knowledgeRefs);
          const draft = candidate.kind === "accepted" ? candidate.bundle as unknown as JsonRecord : candidate.draft;
          if (!(vnextProposalDraftIsEmpty(draft) ? vnextProposalHasThirdCallBudget(capabilities)
            : vnextProposalHasExecutionRepairBudget(draft, capabilities))) return invalid();
          expected = candidate.kind === "accepted" ? rulesTicket(reply, candidate.bundle, candidate.bundleHash, round, ordinal, capabilities)
            : localTicket(createRepairTicket(candidate, requiredContext, capabilities, terminalKinds, npcRefs, knowledgeRefs, round), ordinal);
        }
      } else {
        // A correction reply, read against the ticket it answered: the next
        // round's ticket, or an accepted draft whose Rules rejection is the
        // ticket. A re-emit's reply is read as a fresh filling by the same call.
        const evaluated = evaluateVNextProposalRevisionResponse(reply, previous, requiredContext, chain.slice(0, -1));
        if (evaluated.result.kind === "repairRequired") expected = localTicket(evaluated.result.repairTicket, ordinal);
        else if (evaluated.result.kind === "locallyAccepted") {
          const accepted = evaluated.synthesis === undefined ? reply : vnextProposalDraftReply(evaluated.synthesis.draft);
          // Inherit only the ticket already re-proved in this loop, never the
          // loaded types asserted by the incoming or persisted next ticket.
          expected = rulesTicket(accepted, evaluated.result.bundle, evaluated.result.bundleHash, round, ordinal, previous.capabilities);
        } else return invalid();
      }
      if (!vnextProposalCorrectionAdmitted([...chain, expected])) return invalid();
      if (!sameCanonical(expected, ordinal === input.ordinal ? input.repairTicket : savedTicket(ordinal))) return invalid();
      chain.push(expected);
    }
    const modelInput = createVNextProposalRevisionModelInput(chain, requiredContext, retryQuestion);
    if (!samePresentation(input.request.tools, kpRequestBody(String(input.request.model), modelInput).tools)
      || !samePresentation(input.request.messages, modelInput.messages)) invalid();
  };
  // An amendment at the proposal call is a union of types, derived here from
  // the saved response and the original selection alone.
  let amendment: ReturnType<typeof vnextProposalAmendmentRequest>;
  try { amendment = vnextProposalAmendmentRequest(response(2), first.capabilities, first.terminalKinds, first.npcRefs, requiredContext, first.knowledgeRefs); }
  catch (error) {
    // The Provider ended that call as a form failure; no later call is admitted on it.
    if (!(error instanceof VNextProposalBundleOutputError)) throw error;
    return invalid();
  }
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

/** The plan the ruling's saved calls ended on: the reply of the last completed
 * call, read exactly as the transition above reads it, with the views its
 * filling call was sent. Undefined when that reply was not accepted, or a
 * later call of the ruling is still open. */
export function vnextSavedAcceptedProposal(prior: (ordinal: number) => SavedInvocation | undefined,
  requiredContext: VNextRequiredContext, storyBinding: StoryPreparationBinding | undefined,
  binding: Readonly<{ contextHash: string; bindingHash: string }>): Readonly<{ bundle: VNextProposalBundle; bundleHash: string; ordinal: number } & NpcReviewContextView> | undefined {
  const selectionContext = storyBinding?.selectionContext ?? requiredContext;
  const response = (ordinal: number): unknown => {
    const row = prior(ordinal);
    if (!row || row.status !== "completed" || row.context_hash !== (ordinal === 1 ? selectionContext.binding.contextHash : binding.contextHash)
      || row.binding_hash !== binding.bindingHash || row.response_json === null) return undefined;
    return JSON.parse(row.response_json);
  };
  try {
    if (storyBinding !== undefined && !storyContextBindingMatches(requiredContext, storyBinding)) return undefined;
    const offer = response(1), second = response(2);
    if (offer === undefined || second === undefined) return undefined;
    const first = parseVNextProposalOfferResponse(offer, selectionContext);
    if ((first.story !== undefined) !== (storyBinding !== undefined)) return undefined;
    const amendment = vnextProposalAmendmentRequest(second, first.capabilities, first.terminalKinds, first.npcRefs, requiredContext, first.knowledgeRefs);
    const fillOrdinal = amendment === undefined && !vnextProposalCalledSelectionTool(second) ? 2 : 3;
    const filling = amendment === undefined
      ? { capabilities: first.capabilities, terminalKinds: first.terminalKinds, npcRefs: first.npcRefs, knowledgeRefs: first.knowledgeRefs }
      : { capabilities: amendment.amendedCapabilities, terminalKinds: amendment.amendedTerminalKinds,
        npcRefs: amendment.amendedNpcRefs, knowledgeRefs: amendment.amendedKnowledgeRefs };
    const view = { npcRefs: filling.npcRefs, knowledgeRefs: filling.knowledgeRefs };
    let last = fillOrdinal;
    if (response(last) === undefined) return undefined;
    while (last < 6 && response(last + 1) !== undefined) last += 1;
    if (last < 6 && prior(last + 1) !== undefined) return undefined;
    if (last === fillOrdinal) {
      const candidate = vnextProposalRevisionCandidate(response(last), filling.capabilities, filling.terminalKinds, requiredContext, filling.knowledgeRefs);
      return candidate.kind === "accepted" ? { bundle: candidate.bundle, bundleHash: candidate.bundleHash, ordinal: last, ...view } : undefined;
    }
    const chain: VNextProposalBundleRepairTicket[] = [];
    for (let ordinal = fillOrdinal + 1; ordinal <= last; ordinal += 1) {
      const saved = prior(ordinal)?.repair_ticket_json;
      if (typeof saved !== "string") return undefined;
      const ticket: unknown = JSON.parse(saved);
      assertRepairTicket(ticket, binding.contextHash, requiredContext);
      chain.push(ticket);
    }
    const evaluated = evaluateVNextProposalRevisionResponse(response(last), chain.at(-1)!, requiredContext, chain.slice(0, -1));
    return evaluated.result.kind === "locallyAccepted"
      ? { bundle: evaluated.result.bundle, bundleHash: evaluated.result.bundleHash, ordinal: last, ...view } : undefined;
  } catch { return undefined; }
}

/** SPEC 0016 §7.2 (ADR 0073): admits the call of one NPC's own reply. What is
 * asked, of whom and with which diagnostics is decided from the ruling's
 * accepted plan and the replies saved before this call, never from what the
 * caller asserts; the request must be the one that decision builds. */
export function assertVNextNpcReplyTransition(input: VNextInvocationRequest, saved: readonly NpcReplySaved[],
  requiredContext: VNextRequiredContext, accepted: Readonly<{ bundle: VNextProposalBundle }> | undefined,
  rejected: (merged: VNextProposalBundle, mergedHash: string) => readonly ProposalDiagnostic[], reviews: readonly NpcReviewSaved[] = []): void {
  const invalid = (): never => { throw new TypeError("PROPOSAL_REPAIR_EXHAUSTED"); };
  if (!isVNextNpcReplyOrdinal(input.ordinal) || input.repairTicket !== undefined || input.npcReview !== undefined || !isNpcReplyTicket(input.npcReply)
    || accepted === undefined || input.ordinal !== NPC_REPLY_FIRST_ORDINAL + saved.length
    || input.npcReply.hearing.contextHash !== requiredContext.binding.contextHash) return invalid();
  const settled = settleNpcConversation({ bundle: accepted.bundle, context: requiredContext, saved, reviews, rejected });
  if (settled.kind !== "ask" || !sameCanonical(settled.ticket, input.npcReply)) return invalid();
  const built = kpRequestBody(String(input.request.model), npcReplyModelInput(requiredContext, settled.ticket.hearing, settled.ticket.retry));
  if (JSON.stringify(built) !== JSON.stringify(input.request)) invalid();
}

export function isVNextNpcReviewOrdinal(ordinal: number): boolean {
  return Number.isSafeInteger(ordinal) && ordinal >= NPC_REVIEW_FIRST_ORDINAL && ordinal <= NPC_REVIEW_LAST_ORDINAL;
}

export function assertVNextNpcReviewTransition(input: VNextInvocationRequest, saved: readonly NpcReplySaved[], reviews: readonly NpcReviewSaved[],
  context: VNextRequiredContext, accepted: Readonly<{ bundle: VNextProposalBundle } & NpcReviewContextView> | undefined,
  rejected: (bundle: VNextProposalBundle, hash: string) => readonly ProposalDiagnostic[]): void {
  const invalid = (): never => { throw new TypeError("PROPOSAL_REPAIR_EXHAUSTED"); };
  if (!accepted || !isNpcReviewTicket(input.npcReview) || input.npcReply !== undefined || input.repairTicket !== undefined
    || !isVNextNpcReviewOrdinal(input.ordinal) || input.ordinal !== NPC_REVIEW_FIRST_ORDINAL + reviews.length) return invalid();
  const settled = settleNpcConversation({ bundle: accepted.bundle, context, saved, reviews, rejected });
  if (settled.kind !== "review" || !sameCanonical(settled.ticket, input.npcReview)) return invalid();
  // SPEC 0016 §7.2 (ADR 0078): over the views the ruling's filling call was sent.
  const built = kpRequestBody(String(input.request.model), npcReviewModelInput(accepted.bundle, context, saved, settled.ticket, accepted, String(input.request.model)));
  if (JSON.stringify(built) !== JSON.stringify(input.request)) invalid();
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
    let ordinal: number | undefined, stepShell = false;
    if (remaining[0] === "steps" && /^\d+$/u.test(String(remaining[1])) && Array.isArray(input.steps)) {
      const step = input.steps[Number(remaining[1])];
      if (isPlainRecord(step) && typeof input.rootActionId === "string" && typeof input.contextHash === "string" && typeof input.bundleHash === "string") {
        const found = proposals.findIndex((entry, index) => isPlainRecord(entry) && typeof entry.kind === "string"
          && deriveEntryRef(input.rootActionId as string, input.contextHash as string, input.bundleHash as string, index, entry.kind as Parameters<typeof deriveEntryRef>[4]) === step.proposalRef);
        if (found >= 0) ordinal = found;
      }
      stepShell = remaining[2] !== "rulesInput";
      remaining = remaining.slice(stepShell ? 2 : 3);
    } else if (proposals.length === 1) ordinal = 0;
    let path: (string | number)[] = ordinal === undefined ? [] : ["proposals", ordinal];
    if (stepShell) {
      if (ordinal !== undefined && remaining.length === 1 && remaining[0] === "outcomeBinding") path.push("outcomeBinding");
      return { ...diagnostic, authorityPath: diagnostic.path, path, pathBase: "draft" as const };
    }
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
