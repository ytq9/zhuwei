import { synthesizeProposalRevision, proposalSourceDraftVersion, ProposalRevisionError, type ProposalRevisionSource, type ProposalRevisionSynthesis } from "./proposal-revision";
import { ProposalFillingError, socialResultArgumentDiagnostics, proposalIntentEchoArgumentDiagnostics, proposalFillingDiagnostics,
  proposalFillingSteps, VNEXT_FILLING_STEP_KEYS, PROPOSAL_RULING_KINDS } from "./proposal-filling-interface";
import { diagnosticsFromIssues, proposalDiagnostic, diagnosticActual, type ProposalDiagnostic } from "./proposal-diagnostics";
import type { AuthoritativeModelBinding } from "../authoritative-types";
import {
  ModelOutputValidationError,
  extractSingleToolCall,
} from "../authoritative-helpers";
import { RETRY_QUESTION_MAX_CHARACTERS, RETRY_QUESTION_TOOL_NAME, vnextRetryQuestionTargets, withRetryAnswer,
  type VNextRetryQuestion } from "./retry-question";

/** The proposal pipeline reads the first tool call of a reply. DeepSeek's
 * strict beta sometimes returns two complete alternative form calls in one
 * reply (rounds 111 and 117), with `parallel_tool_calls: false` sent; the
 * first is the reply and the rest are surplus, and Room reads the same
 * saved bytes the same way. A reply with no call is still an error. */
function extractProposalToolCall(response: unknown): ReturnType<typeof extractSingleToolCall> {
  if (isPlainRecord(response) && Array.isArray(response.choices) && response.choices.length === 1) {
    const choice = response.choices[0];
    const calls = isPlainRecord(choice) && isPlainRecord(choice.message) ? choice.message.tool_calls : undefined;
    if (Array.isArray(calls) && calls.length > 1) return extractSingleToolCall({ choices: [{ message: { tool_calls: [calls[0]] } }] });
  }
  return extractSingleToolCall(response);
}
import {
  assertCanonical,
  canonicalClone,
  canonicalHash,
  compareCodeUnits,
  deepFreeze,
  isPlainRecord,
  parseJsonObjectIgnoringTrailingClosers,
  JsonSyntaxError,
  type JsonRecord,
  sameCanonical,
} from "./canonical-json";
import {
  CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA,
  CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  VNEXT_PROPOSAL_SCHEMA_REQUEST_IDS, VNEXT_INITIAL_PROPOSAL_DECISION_KINDS, VNEXT_COMMON_ACTION_KINDS,
  vnextProposalSchemaRequestIds,
  closeVNextProposalSchemaRequest, type VNextProposalSchemaSelection,
  vnextSelectedProposalDecisionKinds,
  VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
  VNEXT_PROPOSAL_REVISION_PROTOCOL,
  createCorrectKpProposalBundleModelInput,
  createSubmitKpProposalBundleModelInput,
  createVNextProposalOfferModelInput,
  decodeVNextStrictToolBundleForDiagnostics,
  type VNextProposalBundle,
} from "./proposal-schema";
import type { VNextRequiredContext } from "./required-context";
import { proposalCreatureTargetRefs, proposalItemDefinitionRefs, proposalItemEntryRefs, proposalInventoryEntryRefs, proposalObservationSubjectRefs, proposalNpcSourceChoices, proposalModelContext, proposalContextView, proposalNpcRecall, proposalKnowledgeRecall, proposalPossessionRecall, proposalRequestableKnowledgeHandles, proposalKnowledgeRequest, proposalUnofferedCapabilities, vnextProposalContextBody, proposalDraftContext, proposalKnowledgeRecallPending, type ProposalKnowledgeHandle } from "./proposal-context";
import { VNEXT_PROPOSAL_GUIDANCE_POLICY } from "./proposal-guidance";
import { vnextProposalDanglingHandles, vnextProposalProducerCompletion } from "./proposal-producer-completion";

/** Diagnostics describe the rejected draft; permission to revise is not a proof
 * that a replacement will pass. The complete replacement is always revalidated. */
export function vnextProposalModelRepairDiagnostics(bundle: unknown, diagnostics: readonly ProposalDiagnostic[],
  originalArguments?: string) {
  const raw = originalArguments === undefined ? undefined : readProposalArguments(originalArguments, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME).raw;
  return deepFreeze(proposalIntentEchoArgumentDiagnostics(bundle, socialResultArgumentDiagnostics(bundle, diagnostics, raw))
    .map(detail => ({ ...detail, repair: { allowed: true, reason: "uncommitted-proposal-may-be-revised-once" } })));
}
import { validateVNextProposalBundle } from "./proposal-validator";
import { requiredContextBasisReferences } from "./required-context-runtime";
import { closeVNextProposalCapabilities, VNEXT_PROPOSAL_CAPABILITIES, VNEXT_PROPOSAL_CAPABILITY_IDS,
  UnknownVNextProposalCapabilityError, vnextProposalCapabilityForEntry, type VNextProposalCapabilityId } from "./proposal-capabilities";
import { draftCommonActionDiagnostics } from "./common-actions";
import { bindProposalWire, proposalWireReferences, proposalWireDiagnosticReferences, proposalUsesTypedReplacement } from "./proposal-reference-dialect";
import { expandContainerTransferWire, ContainerTransferWireError, containerTransferDiagnostics } from "./container-transfer-wire";
import { frozenRecords, inventoryEntryCandidates } from "./inventory-reference-candidates";
import { npcReplySteps } from "./npc-reply";

// Ephemeral proof derived solely from the original wire and frozen context.
// Re-parsing by Room derives it again; no model field can claim this exemption.
const scriptedCandidatePaths = new WeakMap<VNextProposalBundleCandidate, ReadonlySet<string>>();

function wireFillingDiagnostics(draft: unknown, diagnostics: readonly ProposalDiagnostic[], wire: unknown, context?: VNextRequiredContext) {
  if (!context || wire === null || wire === undefined) return proposalFillingDiagnostics(draft, diagnostics, wire);
  try {
    const expanded = expandContainerTransferWire(bindProposalWire(wire, context), context);
    return containerTransferDiagnostics(proposalFillingDiagnostics(draft, diagnostics, expanded.value), expanded.origins);
  } catch (error) {
    if (!(error instanceof ContainerTransferWireError)) throw error;
    return proposalFillingDiagnostics(draft, diagnostics, wire);
  }
}

/** ADR 0133: the rows of the carried-item directory a draft names. A draft
 * may name an item the freeze only listed, as a revision told the loose
 * piece it should put back does; Room reads it before the draft is checked,
 * as it reads one a selection names in requestedItemRefs. */
function draftNamedPossessions(context: VNextRequiredContext, wire: unknown): readonly string[] {
  const rows = new Set((context.references.possessionRecall ?? []).map(row => row.entryRef));
  if (rows.size === 0 || !isPlainRecord(wire)) return [];
  let bound: unknown;
  try { bound = bindProposalWire(wire, context); } catch { return []; }
  const named = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") { if (rows.has(value)) named.add(value); }
    else if (Array.isArray(value)) value.forEach(visit);
    else if (isPlainRecord(value)) Object.values(value).forEach(visit);
  };
  visit(bound);
  return Object.freeze([...named].sort(compareCodeUnits));
}

/** The directory rows a form or correction reply names in its arguments. */
function vnextProposalNamedPossessions(context: VNextRequiredContext, response: unknown): readonly string[] {
  try {
    const call = extractProposalToolCall(response);
    if (call.name === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME) return [];
    return draftNamedPossessions(context, typeof call.arguments === "string" ? parseJsonObjectIgnoringTrailingClosers(call.arguments) : call.arguments);
  } catch { return []; }
}

/** The context a reply is checked against once Room has read what it named:
 * Room reads the rows still unread, then the reply is checked with them. */
async function contextForNamedPossessions(context: VNextRequiredContext, response: unknown,
  readNamedItems: ((refs: readonly string[]) => Promise<VNextRequiredContext>) | undefined): Promise<VNextRequiredContext> {
  const named = vnextProposalNamedPossessions(context, response);
  if (named.length === 0 || readNamedItems === undefined || !proposalKnowledgeRecallPending(context, named)) return context;
  const read = await readNamedItems(named);
  if (read.binding.contextHash !== context.binding.contextHash) throw new TypeError("KNOWLEDGE_RECALL_CONFLICT");
  return deepFreeze(canonicalClone(read)) as VNextRequiredContext;
}

/** Corrections one filling may spend. Each is its own call, sent as the next
 * turn of the conversation that produced the reply it corrects, and each must
 * change what is diagnosed: a round that repeats an earlier round's
 * diagnostics has made no progress and ends the action. */
export const VNEXT_PROPOSAL_CORRECTION_ROUNDS = 3;

export const VNEXT_PROPOSAL_BUNDLE_PARSER_CONTRACT = Object.freeze({
  version: "kp-vnext2-proposal-parser-v93",
  // SPEC 0016 §7.2 (ADR 0138): a locally refused filling's ticket also tells
  // what lowering and Rules find in the rest of it, proved by Room.
  standInPreflight: "rest-of-a-locally-refused-filling-less-related-rows-preflighted-by-room-and-appended-to-its-ticket-v1",
  // ADR 0132, ADR 0133: a selection may name carried items the freeze only
  // listed; so may a filling or correction, read before that reply is checked.
  possessionRecall: "requested-item-refs-ride-the-recall-request-and-read-at-the-listed-version-an-item-already-held-by-the-forms-reads-as-not-requested-v2",
  draftNamedPossessions: "a-reply-naming-a-listed-carried-item-has-it-read-first-and-each-round-is-checked-with-its-own-named-items-v1",
  // SPEC 0016 §7.2: every declaration problem in one revision; a kindless
  // declaration is named; its own container is no put-in source.
  containerTransferDiagnostics: "all-declaration-problems-one-revision-at-their-fields-kindless-declaration-named-container-and-holders-excluded-listed-sources-offered-rest-of-filling-checked-v2",
  // ADR 0135: a Rules refusal of an item reference offers the items the
  // revision may name instead, from what the stage was sent.
  rulesRefusalCandidates: "inventory-entry-refusals-offer-carried-loose-items-read-or-listed-v1",
  // SPEC 0016 §7.3: the opening and closing a declaration expands to cite
  // what the declaration cites less the moved item, else the container.
  containerAccessBasis: "generated-access-steps-never-cite-the-moved-item-v1",
  containerState: "frozen-item-mechanism-and-shared-geometry-before-semantic-state-v1",
  // ADR 0096: a selection asking for an NPC view already loaded is read without it.
  loadedNpcSelection: "a-requested-view-already-loaded-reads-as-not-requested-v1",
  // ADR 0095: one revision is told every problem found, not the first stage's.
  revisionCompleteness: "every-step-lowered-each-common-action-and-each-independent-field-of-one-object-reported-in-the-same-revision-v2",
  // ADR 0085: a refusal that leaves out basisRefs is read with [].
  refusalBasis: "an-absent-refusal-basis-reads-as-empty-v1",
  correctionRounds: VNEXT_PROPOSAL_CORRECTION_ROUNDS,
  revisionFailure: "a-reply-that-is-no-revision-keeps-the-draft-and-spends-a-round-with-its-own-diagnostics-appended-v1",
  correctionConversation: "each-round-appends-the-reply-as-an-assistant-tool-call-and-its-ticket-as-the-tool-result-until-progress-stops-v1",
  argumentDecoding: "unique-member-json-accepting-a-complete-root-object-before-trailing-closing-delimiters-v1",
  producerCompletion: "dangling-same-bundle-handle-loads-its-producer-type-retained-by-later-room-proved-revisions-v2",
  amendableRepeatPolicy: "selection-repeated-without-amendment-refills-once-without-the-selection-tool-v1",
  fillingLayout: "a-check-names-the-key-of-the-step-it-decides-check-holds-that-step-with-required-success-and-failure-steps-grouped-by-loaded-type-with-one-result-continuations-same-v6",
  executionDependencies: "typed-handles-execution-snapshot-versions-and-frozen-container-access-paths-no-group-precedence-v2",
  // SPEC 0016 §7.3, SPEC 0006 §7 (ADR 0073): the ruling writes what the actor
  // undertakes; the reply and what the NPC undertakes come from that NPC's
  // own call and are merged into the decoded plan before lowering.
  socialResults: "the-ruling-writes-the-actors-newPromises-and-promiseChanges-as-required-tables-the-reply-and-the-npcs-four-tables-come-from-the-npcs-own-call-v2",
  responseBasis: "closed-enum-on-a-plain-array-item-player-expression-as-a-member-anyof-only-with-a-producer-in-the-npcs-own-form-v2",
  actorSpeech: "social-steps-name-what-listeners-hear-and-keep-every-quoted-player-phrase-verbatim-v1",
  branchCompleteness: "a-present-branch-never-uses-the-none-sentinel-for-its-outcome-summary-or-social-motive-v1",
  socialPerNpc: "one-conversation-step-per-npc-per-action-v1",
  socialPerception: "a-conversation-branch-records-what-its-npc-sees-the-actor-do-as-that-npc-private-evidence-v1",
  offerToolName: OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  schemaRetrieval: "full-filling-boundaries-at-selection-then-selected-forms-amendable-once-v5",
  actionDuration: "shared-ruling-duration-tier-none-5min-10min-30min-1h-halfDay-mapped-to-exact-microseconds-none-inside-encounter-v3",
  promiseDue: "independent-obligation-deadline-bound-delivery-and-identity-action-promises-queue-deliberation-v3",
  toolName: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  bundleSchema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
  correctionToolName: CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  correctionSchema: CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA,
  sentinelVersion: "decision-v2-server-assembled-results-typed-dependencies-and-uniform-none-sentinel-bare-none-on-every-kind-none-field-v4",
  requiresExactToolCall: true,
  allowsTextFallback: false,
  rejectsDuplicateJsonMembersAtEveryDepth: true,
  injectsBundleEnvelopeForInitialAndRevisedProposal: true,
  diagnosticDecoding: "reject-all-selection-keys-before-isolating-extra-keys-groups-and-result-collections-map-step-shell-and-body-diagnostics-v3",
  inventoryAdmission: "stamp-new-physical-acquisition-policy-preserve-unversioned-frozen-plans-v1",
  concealmentEvidence: "freeze-primary-failure-policy-and-exact-authored-source-across-the-failure-path-legacy-plans-retain-their-policy-v1",
  localValidation: "closed-domain-with-ruling-owned-conversation-checks-before-npc-calls-v7",
  referenceSelection: "frozen-authorized-read-bound-basis-classed-subjects-and-item-definitions-v4",
  correctionPolicy: "version-bound-atomic-json-patch-with-extra-root-removal-or-full-replacement-through-the-filling-form-sent-first-up-to-three-rounds-with-progress-v14",
  unparsedOutputPolicy: "journal-proved-replacement-only-with-shared-revision-allowance-v5",
  correctionResponseProtocol: VNEXT_PROPOSAL_REVISION_PROTOCOL,
});

export const VNEXT_PROPOSAL_BUNDLE_REPAIR_TICKET_SCHEMA =
  "zhuwei.kp-proposal-bundle-repair-ticket/vnext-8" as const;

export const VNEXT_PROPOSAL_BUNDLE_PARSER_HASH = canonicalHash(
  VNEXT_PROPOSAL_BUNDLE_PARSER_CONTRACT,
);

export class VNextProposalBundleOutputError extends ModelOutputValidationError {
  constructor(readonly diagnostics: readonly ProposalDiagnostic[] = [proposalDiagnostic("CONSTRAINT_CONFLICT", "strict-tool-output-contract")]) {
    super();
    this.name = "VNextProposalBundleOutputError";
  }
}

export type VNextProposalBundleCandidate =
  | Readonly<{
      kind: "accepted";
      bundle: VNextProposalBundle;
      bundleHash: string;
    }>
  | Readonly<{
      kind: "locallyRejected";
      draft: Readonly<JsonRecord>;
      bundleHash: string;
      validationCode: "PROPOSAL_BUNDLE_INVALID" | "BUNDLE_DEPENDENCY_INVALID" | "PROPOSAL_JSON_INVALID" | "PROPOSAL_WIRE_INVALID" | "PROPOSAL_REVISION_INVALID";
      issues: readonly string[];
      diagnostics: readonly ProposalDiagnostic[];
      originalArguments: string;
      argumentSource: "rawString" | "decodedObject";
    }>;

export type VNextProposalSchemaRequest = Readonly<{ kind: "schemaRequested" }> & VNextProposalSchemaSelection;

/** The first stage selects schemas only. Never reinterpret or salvage a draft
 * as a selection, including a syntactically repairable former offer shape. */
export function parseVNextProposalOfferResponse(response: unknown, context?: VNextRequiredContext,
  shownNpcRefs: readonly string[] = [], stage: "selection" | "amendment" = "selection",
  priorKnowledgeRefs: readonly string[] = []): VNextProposalSchemaRequest {
  let call: ReturnType<typeof extractSingleToolCall>, raw: unknown;
  try {
    call = extractProposalToolCall(response);
    raw = typeof call.arguments === "string" ? parseJsonObjectIgnoringTrailingClosers(call.arguments) : call.arguments;
    if (context) raw = bindProposalWire(raw, context);
  } catch (error) { return invalidOutput(error); }
  if (call.name !== OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME) return wrongTool(call.name, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  if (!isPlainRecord(raw)) return fieldOutput("TYPE_MISMATCH", "offer:object-required", [], "object", raw);
  // The bystander views this selection may load are a second enumeration of
  // the same tool; a saved response is read by the same rule as a live one.
  const requestable = context === undefined ? [] : proposalNpcRecall(context).requestableRefs;
  const loadedNpcRefs = context === undefined ? [] : proposalNpcRecall(context).defaultRefs;
  // The handles the directory shows at this stage: a group's members once an
  // earlier stage asked for the group (ADR 0111).
  const handles = context === undefined ? [] : proposalKnowledgeRecall(context, shownNpcRefs, priorKnowledgeRefs);
  // ADR 0132: the carried items this stage may still name.
  const carried = context === undefined ? [] : proposalPossessionRecall(context, priorKnowledgeRefs).map(row => row.entryRef);
  const keys = ["requestedCapabilities", ...(requestable.length === 0 ? [] : ["requestedNpcRefs"]), ...(handles.length === 0 ? [] : ["requestedKnowledgeRefs"]),
    ...(carried.length === 0 ? [] : ["requestedItemRefs"])];
  if (!Object.hasOwn(raw, "requestedCapabilities") || Object.keys(raw).some(key => !keys.includes(key))) return invalidOutput(new VNextProposalBundleOutputError([
    ...(Object.hasOwn(raw, "requestedCapabilities") ? [] : [proposalDiagnostic("FIELD_MISSING", "offer:schema-request-field-required",
      { path: ["requestedCapabilities"], pathBase: "arguments", expected: { required: true }, actual: diagnosticActual(undefined) })]),
    ...Object.keys(raw).filter(key => !keys.includes(key)).map(key => proposalDiagnostic("VALUE_INVALID", "offer:schema-request-additional-field",
      { path: [key], pathBase: "arguments", expected: { allowedFields: keys }, actual: diagnosticActual(raw[key]) })),
  ]));
  const requested = raw.requestedCapabilities;
  if (!Array.isArray(requested)) return fieldOutput(requested === undefined ? "FIELD_MISSING" : "TYPE_MISMATCH", "offer:requested-capabilities-array-required", ["requestedCapabilities"], "array", requested);
  const allowed = vnextProposalSchemaRequestIds(context);
  // A first selection must select something; an amendment that lists nothing
  // adds nothing, which SPEC 0016 §7.2 answers by refilling the form (round 146
  // sent [] once the tool said to list only what to add).
  if ((requested.length === 0 && stage === "selection") || requested.length > allowed.length) return fieldOutput("VALUE_INVALID", "offer:requested-capabilities-size",
    ["requestedCapabilities"], { minItems: 1, maxItems: allowed.length }, requested);
  for (const [index, id] of requested.entries()) {
    if (typeof id !== "string") return fieldOutput("TYPE_MISMATCH", "offer:capability-id-string-required", ["requestedCapabilities", index], { type: "string" }, id);
    if (requested.indexOf(id) !== index) return fieldOutput("VALUE_INVALID", "offer:requested-capabilities-unique", ["requestedCapabilities", index], { uniqueItems: true }, id);
  }
  // SPEC 0016 §7.2 (ADR 0064): directSuccess, check and concealedCheck are
  // decision.kind values every form with a step already offers, not types to
  // load. A selection naming one is read without it; a first selection naming
  // only them selects nothing, while an amendment left empty adds nothing. A
  // type this context does not offer is read the same way (ADR 0089).
  const unoffered = context === undefined ? [] : proposalUnofferedCapabilities(context);
  // SPEC 0016 §7.2 (ADR 0107): goTo, climb and the other common actions are
  // values of a worldInteraction step's commonAction, so naming one names
  // that form; round 169 amended with "goTo" and lost the act.
  const named = [...new Set(requested.map(id => (VNEXT_COMMON_ACTION_KINDS as readonly string[]).includes(id) ? "worldInteraction" : id))];
  const selectable = named.filter(id => !PROPOSAL_RULING_KINDS.includes(id) && !unoffered.includes(id));
  if (selectable.length === 0 && stage === "selection") return fieldOutput("VALUE_INVALID", "offer:ruling-kinds-select-no-type",
    ["requestedCapabilities"], { minItems: 1, enum: allowed, decisionKinds: PROPOSAL_RULING_KINDS }, requested);
  const npcRefsRaw = raw.requestedNpcRefs;
  if (npcRefsRaw !== undefined) {
    if (!Array.isArray(npcRefsRaw)) return fieldOutput("TYPE_MISMATCH", "offer:requested-npc-refs-array-required", ["requestedNpcRefs"], "array", npcRefsRaw);
    for (const [index, ref] of npcRefsRaw.entries()) {
      if (typeof ref !== "string") return fieldOutput("TYPE_MISMATCH", "offer:npc-ref-string-required", ["requestedNpcRefs", index], { type: "string" }, ref);
      if (npcRefsRaw.indexOf(ref) !== index) return fieldOutput("VALUE_INVALID", "offer:requested-npc-refs-unique", ["requestedNpcRefs", index], { uniqueItems: true }, ref);
      // ADR 0096: a view already loaded (an NPC the player named) is read
      // without it, as a ruling kind is (ADR 0064); round 165 asked for Naes.
      if (!requestable.includes(ref) && !loadedNpcRefs.includes(ref)) return fieldOutput("VALUE_INVALID", "offer:requested-npc-ref-not-requestable", ["requestedNpcRefs", index], { enum: [...requestable] }, ref);
    }
  }
  const npcRefs = Array.isArray(npcRefsRaw) ? (npcRefsRaw as string[]).filter(ref => requestable.includes(ref)) : [];
  const knowledgeRaw = raw.requestedKnowledgeRefs;
  const namedHandles: ProposalKnowledgeHandle[] = [];
  if (knowledgeRaw !== undefined) {
    if (!Array.isArray(knowledgeRaw)) return fieldOutput("TYPE_MISMATCH", "offer:requested-knowledge-refs-array-required", ["requestedKnowledgeRefs"], "array", knowledgeRaw);
    for (const [index, handle] of knowledgeRaw.entries()) {
      if (typeof handle !== "string") return fieldOutput("TYPE_MISMATCH", "offer:knowledge-handle-string-required", ["requestedKnowledgeRefs", index], { type: "string" }, handle);
      if (knowledgeRaw.indexOf(handle) !== index) return fieldOutput("VALUE_INVALID", "offer:requested-knowledge-refs-unique", ["requestedKnowledgeRefs", index], { uniqueItems: true }, handle);
      const record = handles.find(entry => entry.handle === handle);
      if (record === undefined) return fieldOutput("VALUE_INVALID", "offer:requested-knowledge-handle-unknown", ["requestedKnowledgeRefs", index], { enum: handles.map(entry => entry.handle) }, handle);
      namedHandles.push(record);
    }
  }
  const itemsRaw = raw.requestedItemRefs;
  const items: string[] = [];
  if (itemsRaw !== undefined) {
    if (!Array.isArray(itemsRaw)) return fieldOutput("TYPE_MISMATCH", "offer:requested-item-refs-array-required", ["requestedItemRefs"], "array", itemsRaw);
    // As with an NPC view (ADR 0096), an item the forms already hold -- frozen
    // with the action or read by an earlier stage -- is read without it. A
    // live put-back named the box it targets, which the freeze had read.
    const loadedItemRefs = context === undefined ? [] : proposalInventoryEntryRefs(context);
    for (const [index, ref] of itemsRaw.entries()) {
      if (typeof ref !== "string") return fieldOutput("TYPE_MISMATCH", "offer:item-ref-string-required", ["requestedItemRefs", index], { type: "string" }, ref);
      if (itemsRaw.indexOf(ref) !== index) return fieldOutput("VALUE_INVALID", "offer:requested-item-refs-unique", ["requestedItemRefs", index], { uniqueItems: true }, ref);
      if (carried.includes(ref)) items.push(ref);
      else if (!priorKnowledgeRefs.includes(ref) && !loadedItemRefs.includes(ref)) return fieldOutput("VALUE_INVALID", "offer:requested-item-ref-not-requestable", ["requestedItemRefs", index], { enum: [...carried] }, ref);
    }
  }
  // SPEC 0016 §4.3 (ADR 0111): a group's handle asks for the group and its
  // newest members within the holder's loading limits. A carried item rides
  // the same request as its entry ref (ADR 0132).
  const knowledgeRefs = context === undefined ? [] : [...proposalKnowledgeRequest(context, namedHandles, priorKnowledgeRefs), ...items];
  try { return deepFreeze({ kind: "schemaRequested", ...closeVNextProposalSchemaRequest(selectable, context, npcRefs, knowledgeRefs, stage) }); }
  catch (error) {
    if (error instanceof UnknownVNextProposalCapabilityError) {
      const index = requested.indexOf(error.capabilityId);
      return invalidOutput(new VNextProposalBundleOutputError([proposalDiagnostic("VALUE_INVALID", error.message, {
        ...(index < 0 ? {} : { path: ["requestedCapabilities", index], pathBase: "arguments" as const }),
        expected: { enum: VNEXT_PROPOSAL_SCHEMA_REQUEST_IDS },
        // Internal dependency identities are not submitted values or authorized candidates.
        ...(index < 0 ? {} : { actual: diagnosticActual(requested[index]) }),
      })]));
    }
    return invalidOutput(error);
  }
}

/** Selection only removes whole registered variants. Keep the broad domain
 * validator, then additionally reject variants absent from this exact wire. */
export function assertVNextProposalCandidateCapabilities(candidate: VNextProposalBundleCandidate,
  capabilities: readonly VNextProposalCapabilityId[], terminalKinds?: readonly string[]): void {
  const bundle = candidate.kind === "accepted" ? candidate.bundle : candidate.draft;
  assertRuntimeProposalSurface(bundle);
  const decisionPath = bundle.mode === "adjudication" ? "adjudication" : "terminal";
  const decision = bundle[decisionPath];
  const allowedKinds = vnextSelectedProposalDecisionKinds(capabilities, terminalKinds);
  if (isPlainRecord(decision) && typeof decision.kind === "string" && !allowedKinds.includes(decision.kind)) {
    invalidOutput(new VNextProposalBundleOutputError([
      proposalDiagnostic("CONSTRAINT_CONFLICT", "proposal:capability-not-loaded", {
        path: [decisionPath, "kind"], expected: { enum: allowedKinds }, actual: diagnosticActual(decision.kind),
        repair: { allowed: false, reason: "schema-selection-must-precede-decision" },
      }),
    ]));
  }
  for (const { value, path } of proposalFrames(bundle)) {
    const nativeCapability = path.length > 0 ? vnextProposalCapabilityForEntry(value) : undefined;
    if (nativeCapability !== undefined && !capabilities.includes(nativeCapability)) invalidOutput(new VNextProposalBundleOutputError([
      proposalDiagnostic("CONSTRAINT_CONFLICT", "proposal:capability-not-loaded", { path: [...path, "kind"],
        expected: { enum: capabilities }, repair: { allowed: false, reason: "schema-selection-must-precede-decision" } }),
    ]));
    if (!Array.isArray(value.proposals)) continue; // The domain validator supplies shape diagnostics.
    for (const [index, entry] of value.proposals.entries()) {
      const capability = vnextProposalCapabilityForEntry(entry);
      if (capability === undefined && candidate.kind === "locallyRejected") continue;
      const scripted = capability === "worldInteraction" && capabilities.includes("inventoryOperation")
        && scriptedCandidatePaths.get(candidate)?.has(JSON.stringify([...path, "proposals", index]));
      if (!scripted && (capability === undefined || !capabilities.includes(capability))) invalidOutput(new VNextProposalBundleOutputError([
        proposalDiagnostic("CONSTRAINT_CONFLICT", "proposal:capability-not-loaded", { path: [...path, "proposals", index, "kind"],
          expected: "variant in the frozen loaded tool schema", repair: { allowed: false, reason: "schema-retrieval-must-precede-decision" } }),
      ]));
    }
  }
}

/** A correction round is reserved for a draft that fills steps or rules on
 * them, or a native decision the selection loaded. A pure terminal decision
 * cannot buy a round by selecting a step it never used. A step of a type the
 * selection did not load still counts as a filling: naming the unloaded type
 * is what the round is for, and round 112 was refused a round for exactly
 * that. A ruling with every group empty is a filling too: round 119 wrote a
 * directSuccess over no steps and was refused the round that would have
 * asked for them. */
export function vnextProposalHasExecutionRepairBudget(draft: Readonly<JsonRecord>, capabilities: readonly VNextProposalCapabilityId[]): boolean {
  const selected = (entry: unknown) => {
    const id = vnextProposalCapabilityForEntry(entry);
    return id !== undefined && capabilities.includes(id);
  };
  // SPEC 0016 §7.2: undecodable execution rulings retain their selected
  // correction allowance, including concealedCheck with misplaced groups.
  // Share the filling contract so wire variants cannot drift from this gate.
  const ruling = (value: Record<string, unknown>) => isPlainRecord(value.adjudication)
    || (isPlainRecord(value.decision) && typeof value.decision.kind === "string"
      && PROPOSAL_RULING_KINDS.includes(value.decision.kind));
  return proposalFrames(draft).some(({ value }) => selected(value) || selected(value.terminal) || selected(value.decision)
    || (ruling(value) && vnextProposalHasThirdCallBudget(capabilities))
    || (Array.isArray(value.proposals) && value.proposals.length > 0)
    || proposalFillingSteps(value).length > 0);
}

/** Whether this selection carries any correction round. A terminal-only
 * selection spends its calls on the selection and the proposal, so it has no
 * round for a correction and none for a re-emit either. This reads the
 * selection, not the draft: a draft that used a type the selection did not
 * load is exactly what a round is for (round 112), and an unparsed reply
 * leaves no draft to read at all. */
export function vnextProposalHasThirdCallBudget(capabilities: readonly VNextProposalCapabilityId[]): boolean {
  // Native Ability execution already shares the one revision allowance with
  // step execution; strict parse failure must not require punctuation salvage.
  return capabilities.some(id => VNEXT_PROPOSAL_CAPABILITIES.some(entry => entry.id === id));
}

/** The domain contract allows one nonrecursive level of complete choices. */
function proposalFrames(bundle: Record<string, unknown>): { value: Record<string, unknown>; path: (string | number)[] }[] {
  const frames = [{ value: bundle, path: [] as (string | number)[] }];
  if (isPlainRecord(bundle.terminal) && bundle.terminal.kind === "clarification" && Array.isArray(bundle.terminal.choices)) {
    bundle.terminal.choices.forEach((choice, index) => {
      if (isPlainRecord(choice) && isPlainRecord(choice.continuation))
        frames.push({ value: choice.continuation, path: ["terminal", "choices", index, "continuation"] });
    });
  }
  return frames;
}

function assertRuntimeProposalSurface(bundle: Record<string, unknown>): void {
  // Check every saved branch even if another field needs revision.
  for (const { value, path } of proposalFrames(bundle)) {
    if (isPlainRecord(value.adjudication) && value.adjudication.kind === "highRisk")
      invalidOutput(new VNextProposalBundleOutputError([proposalDiagnostic("CONSTRAINT_CONFLICT", "proposal:adjudication-outside-runtime-surface", {
        path: [...path, "adjudication", "kind"], expected: ["directSuccess", "check"], actual: diagnosticActual(value.adjudication.kind),
      })]));
  }
}

/** The player is asked once what changed since a failed or refused ruling. */
export type VNextRetryQuestionRequest = Readonly<{ kind: "retryQuestion"; ref: string; npcRef: string | null; question: string }>;

/** The first call of an action: a selection, or, when its request offered the
 * second tool, the one question to the player (SPEC 0016 §7.2, ADR 0081).
 * Room reads a saved first response with the same rule as a live one. */
export function parseVNextProposalOfferStageResponse(response: unknown, context: VNextRequiredContext,
  retryQuestion?: VNextRetryQuestion): VNextProposalSchemaRequest | VNextRetryQuestionRequest {
  const targets = retryQuestion !== undefined ? [] : vnextRetryQuestionTargets(context);
  let call: ReturnType<typeof extractSingleToolCall>;
  try { call = extractProposalToolCall(response); } catch (error) { return invalidOutput(error); }
  if (targets.length === 0 || call.name !== RETRY_QUESTION_TOOL_NAME) return parseVNextProposalOfferResponse(response, context);
  let raw: unknown;
  try { raw = typeof call.arguments === "string" ? parseJsonObjectIgnoringTrailingClosers(call.arguments) : call.arguments; }
  catch (error) { return invalidOutput(error); }
  raw = bindProposalWire(raw, context);
  if (!isPlainRecord(raw)) return fieldOutput("TYPE_MISMATCH", "retry-question:object-required", [], "object", raw);
  const extra = Object.keys(raw).filter(key => key !== "ref" && key !== "question");
  if (extra.length > 0) return fieldOutput("VALUE_INVALID", "retry-question:additional-field", [extra[0]!], { allowedFields: ["ref", "question"] }, raw[extra[0]!]);
  const target = targets.find(entry => entry.ref === raw.ref);
  if (target === undefined) return fieldOutput("VALUE_INVALID", "retry-question:ruling-not-open", ["ref"], { enum: targets.map(entry => entry.ref) }, raw.ref);
  const question = typeof raw.question === "string" ? raw.question.trim() : "";
  if (question.length === 0 || question.length > RETRY_QUESTION_MAX_CHARACTERS) return fieldOutput("VALUE_INVALID", "retry-question:question-length",
    ["question"], { minLength: 1, maxLength: RETRY_QUESTION_MAX_CHARACTERS }, raw.question);
  return deepFreeze({ kind: "retryQuestion", ref: target.ref, npcRef: target.npcRef, question });
}

export async function invokeVNextProposalOffer(input: Readonly<{
  binding: AuthoritativeModelBinding; modelId: string; message: string; requiredContext: VNextRequiredContext;
  /** The question this action asked, with the answer once given (ADR 0081). */
  retryQuestion?: VNextRetryQuestion;
}>): Promise<VNextProposalSchemaRequest | VNextRetryQuestionRequest | Extract<VNextProposalBundleProviderResult, { kind: "rejected" }>> {
  if (typeof input.modelId !== "string" || !input.modelId.trim()) throw new TypeError("VNEXT_PROPOSAL_MODEL_ID_REQUIRED");
  const contextHash = input.requiredContext?.binding?.contextHash;
  if (typeof contextHash !== "string" || !contextHash) throw new TypeError("VNEXT_PROPOSAL_CONTEXT_HASH_REQUIRED");
  const response = await input.binding.run(input.modelId,
    createVNextProposalOfferModelInput(input.message, input.requiredContext, input.retryQuestion));
  try {
    return parseVNextProposalOfferStageResponse(response, input.requiredContext, input.retryQuestion);
  } catch (error) {
    if (!(error instanceof VNextProposalBundleOutputError)) throw error;
    return providerRejected("PROPOSAL_FORM_INVALID", error.diagnostics.map(d => d.constraint), false, 1, error.diagnostics);
  }
}

export type VNextProposalBundleProviderResult =
  | Readonly<{
      /** The strict form and closed local domain checks passed. The Room-side
       * lowerer must still bind authority, preflight Rules and commit it. */
      kind: "locallyAccepted";
      bundle: VNextProposalBundle;
      bundleHash: string;
      repairUsed: boolean;
      invocationCount: 1 | 2;
    }>
  | Readonly<{
      kind: "rejected";
      code: "PROPOSAL_FORM_INVALID" | "PROPOSAL_REPAIR_EXHAUSTED";
      issues: readonly string[];
      diagnostics: readonly ProposalDiagnostic[];
      repairUsed: boolean;
      invocationCount: 1 | 2;
    }>;

export type VNextProposalBundleRepairTicket = Readonly<{
  schema: typeof VNEXT_PROPOSAL_BUNDLE_REPAIR_TICKET_SCHEMA;
  draft: Readonly<JsonRecord>;
  bundleHash: string;
  contextHash: string;
  /** PROPOSAL_REVISION_INVALID: the reply to an earlier round was no
   * revision at all (an invalid patch, a wrong tool, unreadable bytes), so
   * this round revises the same draft again; its diagnostics are that
   * round's, with the failed reply's own appended. */
  validationCode: "PROPOSAL_BUNDLE_INVALID" | "BUNDLE_DEPENDENCY_INVALID" | "PROPOSAL_JSON_INVALID" | "PROPOSAL_WIRE_INVALID" | "PROPOSAL_RULES_DIAGNOSTIC" | "PROPOSAL_REVISION_INVALID";
  issues: readonly string[];
  diagnostics: readonly ProposalDiagnostic[];
  capabilities: readonly VNextProposalCapabilityId[];
  terminalKinds: readonly string[];
  /** Bystander decision views the selection loaded; the model view hash below
   * and the revision request are built over exactly these. */
  npcRefs: readonly string[];
  /** Frozen memory bodies the selection read, as entry refs, sorted unique. */
  knowledgeRefs: readonly string[];
  modelContextHash: string;
  sourceDraft: Readonly<JsonRecord> | null;
  sourceDraftVersion: string;
  /** Which correction of this filling the ticket asks for, from 1. The
   * earlier rounds travel as the conversation the request replays. */
  round: number;
  originalArguments: string;
  argumentSource: "rawString" | "decodedObject";
  ticketHash: string;
}>;

export type VNextProposalBundleFirstPassResult =
  | Extract<VNextProposalBundleProviderResult, { kind: "locallyAccepted" }>
  | Extract<VNextProposalBundleProviderResult, { kind: "rejected" }>
  | Readonly<{
      kind: "repairRequired";
      repairTicket: VNextProposalBundleRepairTicket;
      invocationCount: 1;
    }>
  | Readonly<{
      /** The loaded types cannot express this intent. Selection is amended by
       * union once, and the same frozen context is filled again. */
      kind: "amendmentRequested";
      amendment: VNextProposalAmendment;
      invocationCount: 1;
    }>
  | Readonly<{
      /** The amendable round called the selection tool and added nothing: it
       * neither amended nor filled, and repeating a selection is not a
       * decision. The one call an amendment would have spent re-sends the
       * same request without the selection tool. */
      kind: "selectionRepeated";
      invocationCount: 1;
    }>;

export function parseSubmitKpProposalBundleCandidateArguments(
  value: unknown,
  context?: VNextRequiredContext,
): VNextProposalBundleCandidate {
  const parsed = readProposalArguments(value, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  if (!context) return candidateForArguments(parsed.raw, value);
  try {
    const expanded = expandContainerTransferWire(bindProposalWire(parsed.raw, context), context);
    const candidate = candidateForArguments(expanded.value, value);
    scriptedCandidatePaths.set(candidate, expanded.generatedDomainPaths);
    return candidate;
  } catch (error) {
    if (error instanceof ContainerTransferWireError) return invalidOutput(new VNextProposalBundleOutputError([
      ...error.diagnostics.map(detail => ({ ...detail, pathBase: "arguments" as const })),
      ...beyondRefusedDeclarations(parsed.raw, context, error.refused)]));
    return invalidOutput(error);
  }
}

/** SPEC 0016 §7.2 (ADR 0095): a refused containerTransfer declaration does not
 * hide what is wrong with the rest of the filling. The rest is checked with
 * each refused declaration standing as the plain operation it would expand
 * to, so no step moves; whatever that check says of those steps themselves
 * is dropped, their own diagnostics already stand. A declaration inside a
 * clarification choice keeps the old reading: nothing beyond it is checked. */
function beyondRefusedDeclarations(raw: unknown, context: VNextRequiredContext,
  refused: readonly (readonly (string | number)[])[]): readonly ProposalDiagnostic[] {
  if (refused.length === 0 || !refused.every(path => path.length === 4 && path[0] === "steps" && path[1] === "inventoryOperation"
    && typeof path[2] === "number" && path[3] === "operation")) return [];
  const rest = bindProposalWire(structuredClone(raw), context) as Record<string, unknown>;
  const rows = isPlainRecord(rest.steps) && Array.isArray(rest.steps.inventoryOperation) ? rest.steps.inventoryOperation : undefined;
  if (rows === undefined) return [];
  const indices = new Set(refused.map(path => Number(path[2])));
  for (const index of indices) {
    const row = rows[index], operation = isPlainRecord(row) ? row.operation : undefined;
    if (!isPlainRecord(row) || !isPlainRecord(operation)) return [];
    row.operation = operation.direction === "takeOut" ? { kind: "acquire", entryRef: operation.entryRef, quantity: operation.quantity }
      : { kind: "store", entryRef: operation.entryRef, quantity: operation.quantity, containerRef: operation.containerRef };
  }
  let expanded: ReturnType<typeof expandContainerTransferWire>, diagnostics: readonly ProposalDiagnostic[], draft: unknown;
  try {
    expanded = expandContainerTransferWire(rest, context);
    const candidate = candidateForArguments(expanded.value, JSON.stringify(rest));
    if (candidate.kind === "accepted") return [];
    diagnostics = candidate.diagnostics; draft = candidate.draft;
  } catch (error) {
    if (!(error instanceof VNextProposalBundleOutputError)) return [];
    diagnostics = error.diagnostics; draft = rest; expanded = { value: rest, origins: new Map(), generatedDomainPaths: new Set() };
  }
  return containerTransferDiagnostics(proposalFillingDiagnostics(draft, diagnostics, expanded.value), expanded.origins)
    .filter(detail => !(detail.path?.[0] === "steps" && detail.path[1] === "inventoryOperation" && indices.has(Number(detail.path[2]))));
}

/** SPEC 0016 §7.2 (ADR 0138): the part of a locally refused filling Room
 * preflights, so the faults only lowering or Rules finds in the other steps
 * reach the same revision. `rows` maps each kept row, at its place in
 * `wire`, back to its place in the reply. */
export type VNextProposalStandIn = Readonly<{ bundle: VNextProposalBundle; wire: JsonRecord;
  rows: ReadonlyMap<string, readonly [string, string, number]> }>;

const STAND_IN_VALIDATION_CODES: readonly string[] = ["PROPOSAL_BUNDLE_INVALID", "BUNDLE_DEPENDENCY_INVALID", "PROPOSAL_WIRE_INVALID"];
const FILLING_ROW_CONTAINERS = ["check", "steps"] as const;

/** The refs a filling row names. Read as what the row acts on, what it cites
 * (its basis), who observes and where it ends are left out. The actor is in
 * every row and is never shared; a sentinel such as "none" is no ref. */
function fillingRowRefs(row: unknown, actorRef: string, actsOn: boolean): ReadonlySet<string> {
  const refs = new Set<string>();
  const visit = (value: unknown, key: string): void => {
    if (typeof value === "string") {
      if ((/Refs?$/u.test(key) || key === "handle") && value.includes(":") && value !== actorRef) refs.add(value);
    } else if (Array.isArray(value)) value.forEach(member => visit(member, key));
    else if (isPlainRecord(value)) for (const [field, member] of Object.entries(value)) {
      if (field === "sceneRef" || (actsOn && (field === "basisRefs" || field === "observerRef" || field === "subjectRef"))) continue;
      visit(member, field);
    }
  };
  visit(row, "");
  return refs;
}

/** What a left-out row may change for the rows after it. A plain inventory
 * operation moves its item; containers hold any number of things, so the
 * container it names is unchanged. A declaration also opens or closes its
 * container, and a row of any other kind is taken to change all it names. */
function fillingRowChanges(family: string, row: unknown, actorRef: string): ReadonlySet<string> {
  const operation = isPlainRecord(row) ? row.operation : undefined;
  if (family !== "inventoryOperation" || !isPlainRecord(operation) || typeof operation.kind !== "string" || operation.kind === "containerTransfer")
    return fillingRowRefs(row, actorRef, true);
  const produced = fillingRowRefs(isPlainRecord(row) ? { produces: row.produces } : {}, actorRef, true);
  return new Set([...produced, ...(typeof operation.entryRef === "string" && operation.entryRef.includes(":") ? [operation.entryRef] : [])]);
}

/** SPEC 0016 §7.2 (ADR 0138): the reply less its locally refused rows and the
 * rows that touch what those would have changed, when that rest is itself a
 * whole plan. None when a problem is not in a row, when nothing is left, when
 * the rest fails local checks, or when it addresses an NPC, whose replies a
 * Rules preflight needs first. */
export function vnextProposalStandIn(ticket: VNextProposalBundleRepairTicket, requiredContext: VNextRequiredContext): VNextProposalStandIn | undefined {
  const source = ticket.sourceDraft;
  if (!STAND_IN_VALIDATION_CODES.includes(ticket.validationCode) || !isPlainRecord(source)
    || (isPlainRecord(source.decision) && source.decision.kind === "clarification")) return undefined;
  const checked = proposalDraftContext(requiredContext, ticket.knowledgeRefs, draftNamedPossessions(requiredContext, source));
  const key = (container: string, family: string, index: number) => JSON.stringify([container, family, index]);
  const removed = new Set<string>();
  for (const diagnostic of wireFillingDiagnostics(ticket.draft, ticket.diagnostics, source, checked)) {
    const [container, family, index] = diagnostic.path ?? [];
    if (!FILLING_ROW_CONTAINERS.includes(container as never) || typeof family !== "string" || typeof index !== "number") return undefined;
    removed.add(key(String(container), family, index));
  }
  let bound: unknown;
  try { bound = bindProposalWire(source, checked); } catch { return undefined; }
  const actorRef = requiredContext.intent.actorRef;
  const rows = FILLING_ROW_CONTAINERS.flatMap(container => {
    const groups = isPlainRecord(bound) && isPlainRecord(bound[container]) ? bound[container] : {};
    return Object.entries(groups).flatMap(([family, list]) => Array.isArray(list)
      ? list.map((row, index) => ({ key: key(container, family, index), family, row })) : []);
  });
  const changed = new Set<string>();
  const leaveOut = (row: typeof rows[number]) => { removed.add(row.key); fillingRowChanges(row.family, row.row, actorRef).forEach(ref => changed.add(ref)); };
  rows.filter(row => removed.has(row.key)).forEach(leaveOut);
  for (let grew = true; grew;) {
    grew = false;
    for (const row of rows) if (!removed.has(row.key) && [...fillingRowRefs(row.row, actorRef, false)].some(ref => changed.has(ref))) { leaveOut(row); grew = true; }
  }
  if (rows.every(row => removed.has(row.key))) return undefined;
  const wire = canonicalClone(source) as Record<string, unknown>;
  const kept = new Map<string, readonly [string, string, number]>();
  for (const container of FILLING_ROW_CONTAINERS) {
    if (!isPlainRecord(wire[container])) continue;
    const groups = wire[container] as Record<string, unknown>;
    for (const [family, list] of Object.entries(groups)) {
      if (!Array.isArray(list)) continue;
      const rest: unknown[] = [];
      list.forEach((row, index) => {
        if (removed.has(key(container, family, index))) return;
        kept.set(key(container, family, rest.length), [container, family, index]);
        rest.push(row);
      });
      groups[family] = rest;
    }
  }
  let candidate: VNextProposalBundleCandidate;
  try { candidate = vnextProposalRevisionCandidate(vnextProposalDraftReply(wire as JsonRecord), ticket.capabilities, ticket.terminalKinds, requiredContext, ticket.knowledgeRefs); }
  catch { return undefined; }
  if (candidate.kind !== "accepted" || npcReplySteps(candidate.bundle, requiredContext).length > 0) return undefined;
  return deepFreeze({ bundle: candidate.bundle, wire: wire as JsonRecord, rows: kept });
}

/** SPEC 0016 §7.2 (ADR 0138): the ticket with what lowering and Rules found in
 * the stand-in, each at its row in the reply and after the ticket's own. Only
 * problems of a kept row are added; the plan as a whole is judged again once
 * revised. */
export function vnextProposalStandInTicket(ticket: VNextProposalBundleRepairTicket, requiredContext: VNextRequiredContext,
  standIn: VNextProposalStandIn, diagnostics: readonly ProposalDiagnostic[]): VNextProposalBundleRepairTicket {
  const checked = proposalDraftContext(requiredContext, ticket.knowledgeRefs, draftNamedPossessions(requiredContext, standIn.wire));
  const located = wireFillingDiagnostics(standIn.bundle, withInventoryEntryCandidates(diagnostics, standIn.bundle, requiredContext), standIn.wire, checked);
  return withAppendedDiagnostics(ticket, located.flatMap(diagnostic => {
    const [container, family, index, ...rest] = diagnostic.path ?? [];
    const at = standIn.rows.get(JSON.stringify([container, family, index]));
    return at === undefined ? [] : [{ ...diagnostic, path: [...at, ...rest], pathBase: "arguments" as const,
      repair: { allowed: true, reason: "uncommitted-proposal-may-be-revised-once" } }];
  }));
}

/** The ticket with a preflight run now: by Room for the round it is about to
 * send, and by tests standing in for Room. */
export function vnextProposalTicketPreflight(ticket: VNextProposalBundleRepairTicket, requiredContext: VNextRequiredContext,
  preflight: (bundle: VNextProposalBundle) => readonly ProposalDiagnostic[]): VNextProposalBundleRepairTicket {
  const standIn = vnextProposalStandIn(ticket, requiredContext);
  return standIn === undefined ? ticket : vnextProposalStandInTicket(ticket, requiredContext, standIn, preflight(standIn.bundle));
}

/** The ticket with the preflight a saved one carried, re-derived from the
 * ticket's own diagnostics: Room proved what follows them when it sent that
 * round. A saved ticket that does not begin with them adds nothing, and the
 * comparison that follows fails. */
export function vnextProposalTicketWithSavedPreflight(ticket: VNextProposalBundleRepairTicket, saved: VNextProposalBundleRepairTicket): VNextProposalBundleRepairTicket {
  if (!STAND_IN_VALIDATION_CODES.includes(ticket.validationCode) || saved.diagnostics.length <= ticket.diagnostics.length
    || !sameCanonical(saved.diagnostics.slice(0, ticket.diagnostics.length), ticket.diagnostics)) return ticket;
  return withAppendedDiagnostics(ticket, saved.diagnostics.slice(ticket.diagnostics.length));
}

function withAppendedDiagnostics(ticket: VNextProposalBundleRepairTicket, appended: readonly ProposalDiagnostic[]): VNextProposalBundleRepairTicket {
  if (appended.length === 0) return ticket;
  const { ticketHash: _ticketHash, ...body } = ticket;
  const next = canonicalClone({ ...body, issues: [...ticket.issues, ...appended.map(detail => detail.constraint)],
    diagnostics: [...ticket.diagnostics, ...appended] }) as Omit<VNextProposalBundleRepairTicket, "ticketHash">;
  return deepFreeze({ ...next, ticketHash: canonicalHash(next) });
}

function readProposalArguments(value: unknown, _toolName: string): { raw: unknown } {
  if (typeof value !== "string") return { raw: value };
  try { return { raw: parseJsonObjectIgnoringTrailingClosers(value) }; } catch (error) { return invalidOutput(error); }
}

const SELECTION_ARGUMENT_KEYS = ["requestedCapabilities", "requestedNpcRefs", "requestedKnowledgeRefs", "requestedItemRefs"] as const;

function candidateForArguments(raw: unknown, originalArguments?: unknown): VNextProposalBundleCandidate {
  if (!isPlainRecord(raw)) return fieldOutput("TYPE_MISMATCH", "proposal:object-required", [], "object", raw);
  // SPEC 0016 §7.2: selection and filling cannot be mixed. Keep this outside
  // recoverable decoding so the selection intent is never silently discarded.
  const mixed = SELECTION_ARGUMENT_KEYS.filter(key => Object.hasOwn(raw, key));
  if (mixed.length > 0) return invalidOutput(new VNextProposalBundleOutputError(mixed.map(key =>
    proposalDiagnostic("CONSTRAINT_CONFLICT", "proposal:selection-mixed-with-filling", {
      pathBase: "arguments", path: [key], expected: "capability, NPC view and knowledge selection in the selection tool only",
      repair: { allowed: false, reason: "selection-and-filling-are-separate-stages" },
    }))));
  if ("schema" in raw || "kind" in raw) return invalidOutput(new VNextProposalBundleOutputError([
    ...["schema", "kind"].filter(key => Object.hasOwn(raw, key)).map(key => proposalDiagnostic("CONSTRAINT_CONFLICT", "proposal:server-owned-envelope", { pathBase: "arguments", path: [key], expected: "absent from model arguments" })),
  ]));
  let decoding: ReturnType<typeof decodeVNextStrictToolBundleForDiagnostics>;
  try { decoding = decodeVNextStrictToolBundleForDiagnostics(raw); }
  catch (error) { return invalidOutput(error); }
  const decoded = decoding.draft;
  if (!isPlainRecord(decoded)) {
    // ADR 0095: a draft whose steps could not be placed still has its common
    // actions read, so this revision hears of their problems too.
    const known = new Set(decoding.diagnostics.map(detail => JSON.stringify([detail.constraint, detail.path ?? null])));
    const scripted = isPlainRecord(decoding.partial) ? proposalFillingDiagnostics(decoding.partial, draftCommonActionDiagnostics(decoding.partial), raw)
      .map(detail => ({ ...detail, repair: { allowed: true, reason: "uncommitted-proposal-may-be-revised-once" } }))
      .filter(detail => !known.has(JSON.stringify([detail.constraint, detail.path ?? null]))) : [];
    return invalidOutput(new ProposalFillingError([...decoding.diagnostics, ...scripted]));
  }
  let draft: JsonRecord;
  try {
    // A diagnostic view can omit fields; the immutable repair source cannot.
    // Validate the entire original value before it can enter a repair ticket.
    assertCanonical(raw);
    draft = canonicalClone({
      ...decoded,
      schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
      kind: "proposalBundle",
    }) as JsonRecord;
  } catch (error) {
    return invalidOutput(error);
  }
  const validated = validateVNextProposalBundle(draft);
  if (validated.kind === "accepted" && decoding.diagnostics.length === 0) {
    return deepFreeze({
      kind: "accepted",
      bundle: validated.bundle,
      bundleHash: canonicalHash(validated.bundle),
    });
  }
  const found = [...decoding.diagnostics, ...(validated.kind === "rejected" ? socialResultArgumentDiagnostics(draft,
    validated.diagnostics ?? diagnosticsFromIssues(validated.code, validated.issues), raw) : [])];
  // SPEC 0016 §7.2 (ADR 0095): the same revision also hears of the common
  // actions the draft gets wrong, which Room would only report a round later.
  const known = new Set(found.map(detail => JSON.stringify([detail.constraint, detail.path ?? null])));
  const scripted = socialResultArgumentDiagnostics(draft, draftCommonActionDiagnostics(draft), raw)
    .filter(detail => !known.has(JSON.stringify([detail.constraint, detail.path ?? null])));
  return deepFreeze({
    kind: "locallyRejected",
    draft,
    bundleHash: canonicalHash(draft),
    validationCode: decoding.diagnostics.length > 0 ? "PROPOSAL_WIRE_INVALID" : validated.kind === "rejected" ? validated.code : "PROPOSAL_WIRE_INVALID",
    diagnostics: [...found, ...scripted],
    issues: [...decoding.diagnostics.map(detail => detail.constraint), ...(validated.kind === "rejected" ? validated.issues : []),
      ...scripted.map(detail => detail.constraint)],
    originalArguments: typeof originalArguments === "string" ? originalArguments : JSON.stringify(originalArguments ?? raw),
    argumentSource: typeof originalArguments === "string" ? "rawString" : "decodedObject",
  });
}

export function parseSubmitKpProposalBundleCandidateResponse(
  response: unknown,
  context?: VNextRequiredContext,
): VNextProposalBundleCandidate {
  let call: ReturnType<typeof extractSingleToolCall>;
  try {
    call = extractProposalToolCall(response);
  } catch (error) {
    return invalidOutput(error);
  }
  if (call.name !== SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) return wrongTool(call.name, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  return parseSubmitKpProposalBundleCandidateArguments(call.arguments, context);
}

export type VNextProposalUnparsedArguments = Readonly<{
  toolName: typeof SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME;
  originalArguments: string;
  diagnostic: ProposalDiagnostic;
}>;

/** Unparseable saved bytes permit replacement only. A truncated response or
 * duplicate-member policy failure keeps its existing technical failure path. */
export function vnextProposalUnparsedArguments(response: unknown): VNextProposalUnparsedArguments | undefined {
  let call: ReturnType<typeof extractSingleToolCall>;
  try { call = extractProposalToolCall(response); } catch { return undefined; }
  if (call.name !== SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME || typeof call.arguments !== "string") return undefined;
  const choice = isPlainRecord(response) && Array.isArray(response.choices) ? response.choices[0] : undefined;
  const finished = isPlainRecord(choice) ? choice.finish_reason : undefined;
  if (typeof finished !== "string" || finished === "length") return undefined;
  try { parseJsonObjectIgnoringTrailingClosers(call.arguments); return undefined; }
  catch (error) {
    if (!(error instanceof JsonSyntaxError)) return undefined;
    try { JSON.parse(call.arguments); return undefined; } catch { /* invalid syntax */ }
    return deepFreeze({ toolName: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
      originalArguments: call.arguments, diagnostic: syntaxDiagnostic(error) });
  }
}

/** True when the reply called the selection tool. Derived from the response
 * alone, so Room reaches the identical conclusion from the same saved bytes. */
export function vnextProposalCalledSelectionTool(response: unknown): boolean {
  try { return extractProposalToolCall(response).name === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME; } catch { return false; }
}

export function createVNextUnparsedRevisionTicket(evidence: VNextProposalUnparsedArguments,
  requiredContext: VNextRequiredContext, capabilities: readonly VNextProposalCapabilityId[], terminalKinds: readonly string[],
  npcRefs: readonly string[] = [], knowledgeRefs: readonly string[] = [], round = 1) {
  return createRepairTicket({ kind: "locallyRejected", draft: {}, bundleHash: canonicalHash(null),
    validationCode: "PROPOSAL_JSON_INVALID", issues: [evidence.diagnostic.constraint], diagnostics: [evidence.diagnostic],
    originalArguments: evidence.originalArguments, argumentSource: "rawString" }, requiredContext, capabilities, terminalKinds, npcRefs, knowledgeRefs, round);
}

export type VNextProposalAmendment = Readonly<{
  requestedCapabilities: readonly VNextProposalCapabilityId[];
  requestedTerminalKinds: readonly string[];
  requestedNpcRefs: readonly string[];
  /** Loaded bystander views plus the request, sorted unique; never a reduction. */
  amendedNpcRefs: readonly string[];
  requestedKnowledgeRefs: readonly string[];
  /** Read memory bodies plus the request, as entry refs, sorted unique. */
  amendedKnowledgeRefs: readonly string[];
  /** Selection plus the request, closed over dependencies. Never a reduction.
   * Terminals are amended alongside operations: one intent that needs to spend
   * time as well as speak needs both, and dropping either half would leave the
   * amended round unable to express the very thing it asked for. */
  amendedCapabilities: readonly VNextProposalCapabilityId[];
  amendedTerminalKinds: readonly string[];
}>;

/** The saved proposal response called the selection tool instead of submitting,
 * which is how one intent says the loaded types cannot express it.
 *
 * Derived from the response and the current selection alone, so Room reaches
 * the identical conclusion from the same saved bytes. The result is a union:
 * an amendment adds types and can never drop one, so it cannot become a way to
 * reopen a decision or escape a form the selection already accepted. */
export function vnextProposalAmendmentRequest(response: unknown,
  capabilities: readonly VNextProposalCapabilityId[],
  terminalKinds: readonly string[] = [], npcRefs: readonly string[] = [],
  context?: VNextRequiredContext, knowledgeRefs: readonly string[] = []): VNextProposalAmendment | undefined {
  let call: ReturnType<typeof extractSingleToolCall>;
  try { call = extractProposalToolCall(response); } catch { return undefined; }
  if (call.name !== OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME) return undefined;
  const requested = parseVNextProposalOfferResponse(response, context, npcRefs, "amendment", knowledgeRefs);
  if (requested.story !== undefined) throw new VNextProposalBundleOutputError([proposalDiagnostic("REPAIR_OUT_OF_SCOPE", "story:preparation-only-at-initial-selection")]);
  const current = closeVNextProposalCapabilities(capabilities);
  const amended = closeVNextProposalCapabilities([...new Set([...current, ...requested.capabilities])]);
  const amendedTerminals = [...new Set([...terminalKinds, ...requested.terminalKinds])].sort(compareCodeUnits);
  const amendedNpcRefs = [...new Set([...npcRefs, ...requested.npcRefs])].sort(compareCodeUnits);
  const amendedKnowledgeRefs = [...new Set([...knowledgeRefs, ...requested.knowledgeRefs])].sort(compareCodeUnits);
  // An amendment that adds nothing is a wasted call, not a continuation.
  if (amended.length === current.length && amendedTerminals.length === terminalKinds.length
    && amendedNpcRefs.length === npcRefs.length && amendedKnowledgeRefs.length === knowledgeRefs.length) return undefined;
  return deepFreeze({ requestedCapabilities: requested.capabilities, requestedTerminalKinds: requested.terminalKinds,
    requestedNpcRefs: requested.npcRefs, amendedNpcRefs, requestedKnowledgeRefs: requested.knowledgeRefs, amendedKnowledgeRefs,
    amendedCapabilities: amended, amendedTerminalKinds: amendedTerminals });
}

/** Parses only the selected strict tool's arguments; no text/JSON fallback. */
export function parseSubmitKpProposalBundleArguments(
  value: unknown,
): VNextProposalBundle {
  const candidate = parseSubmitKpProposalBundleCandidateArguments(value);
  return candidate.kind === "accepted" ? candidate.bundle : invalidOutput(new VNextProposalBundleOutputError(candidate.diagnostics));
}

export function parseSubmitKpProposalBundleResponse(
  response: unknown,
): VNextProposalBundle {
  const candidate = parseSubmitKpProposalBundleCandidateResponse(response);
  return candidate.kind === "accepted" ? candidate.bundle : invalidOutput(new VNextProposalBundleOutputError(candidate.diagnostics));
}

function revisionSynthesis(response: unknown, source: ProposalRevisionSource, typedOnly = false): ProposalRevisionSynthesis {
  try {
    const call = extractProposalToolCall(response);
    // The correction request carries the filling form as its first tool. A
    // reply through that form is a whole replacement under strict schema
    // enforcement, and takes the same synthesis path as an explicit
    // replaceDraft: version binding, content boundary, unchanged-draft check.
    // The form has no version field; the journal binds this reply to the one
    // request that was sent, so the ticket's own version stands in for the echo.
    if (call.name === SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) {
      const draft = typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments);
      return synthesizeProposalRevision({ sourceDraftVersion: source.sourceDraftVersion,
        revisionJson: `{"mode":"replaceDraft","draft":${draft}}` }, source);
    }
    if (typedOnly) return wrongTool(call.name, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
    if (call.name !== CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME) return wrongTool(call.name, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
    return synthesizeProposalRevision(call.arguments, source);
  } catch (error) {
    if (error instanceof ProposalRevisionError) throw new VNextProposalBundleOutputError(error.diagnostics);
    return invalidOutput(error);
  }
}

export function parseCorrectKpProposalBundleResponse(response: unknown, source: ProposalRevisionSource): VNextProposalBundleCandidate {
  return parseSubmitKpProposalBundleCandidateArguments(revisionSynthesis(response, source).draft);
}

/** Shared by the Adapter and Room audit: pure synthesis plus complete local
 * validation. Lowering/Rules still run through Room before any effect. */
/** An empty object is a reply that carries no draft. There is nothing to
 * revise, so the one remaining call re-sends the original filling request
 * instead of asking the model to author a whole draft inside an escaped JSON
 * string: rounds 95 and 97 both lost that draft to a delimiter slip. */
/** The members a filling draft is read by, current and earlier wire alike. */
const FILLING_DRAFT_MEMBERS = ["decision", "check", "steps", "adjudication", "proposals", "terminal"] as const;
/** SPEC 0016 §7.2: a filling reply with none of the form's members -- an
 * empty object, or only fields the form does not have (round156 refilled
 * the form and got {"decide": ""}) -- carries no draft. Like an empty reply
 * it keeps the original request's resend, and is never taken for a
 * terminal ruling that could not buy a correction. */
export function vnextProposalDraftIsEmpty(draft: Readonly<JsonRecord>): boolean {
  return !FILLING_DRAFT_MEMBERS.some(member => Object.hasOwn(draft, member));
}

export function vnextProposalTicketIsEmptyDraft(ticket: Pick<VNextProposalBundleRepairTicket, "sourceDraft">): boolean {
  return ticket.sourceDraft !== null && vnextProposalDraftIsEmpty(ticket.sourceDraft);
}

export type VNextProposalRevisionEvaluation = Readonly<{
  synthesis?: ProposalRevisionSynthesis;
  result: VNextProposalBundleProviderResult | Readonly<{
    kind: "repairRequired"; repairTicket: VNextProposalBundleRepairTicket; invocationCount: 2;
  }>;
}>;

/** What one round asked the model to fix, as an order-free identity of its
 * diagnostics. Two rounds with the same signature made no progress. */
export function vnextProposalDiagnosticSignature(ticket: Pick<VNextProposalBundleRepairTicket, "diagnostics">): string {
  return canonicalHash(ticket.diagnostics
    .map(detail => JSON.stringify({ code: detail.code, constraint: detail.constraint, path: detail.path ?? [], pathBase: detail.pathBase ?? null }))
    .sort(compareCodeUnits));
}

/** Whether the last of these tickets, in round order from the first, may be
 * sent: it is the next round, rounds remain, and its diagnostics differ from
 * every earlier round's. Provider and Room apply this to the same tickets. */
export function vnextProposalCorrectionAdmitted(tickets: readonly VNextProposalBundleRepairTicket[]): boolean {
  const last = tickets[tickets.length - 1];
  if (last === undefined || last.round !== tickets.length || last.round > VNEXT_PROPOSAL_CORRECTION_ROUNDS
    || tickets.some((ticket, index) => ticket.round !== index + 1)) return false;
  const signature = vnextProposalDiagnosticSignature(last);
  return tickets.slice(0, -1).every(ticket => vnextProposalDiagnosticSignature(ticket) !== signature);
}

/** Reads one correction reply against its ticket. Given the frozen context and
 * the earlier tickets of the same filling, a locally rejected revision becomes
 * the next round's ticket while a round remains and the diagnostics still
 * change; the Room's audit reads without them and only judges the reply. */
export function evaluateVNextProposalRevisionResponse(response: unknown, ticket: VNextProposalBundleRepairTicket,
  requiredContext?: VNextRequiredContext, priorTickets: readonly VNextProposalBundleRepairTicket[] = []): VNextProposalRevisionEvaluation {
  const accepted = (candidate: Extract<VNextProposalBundleCandidate, { kind: "accepted" }>, synthesis?: ProposalRevisionSynthesis): VNextProposalRevisionEvaluation =>
    ({ ...(synthesis === undefined ? {} : { synthesis }), result: deepFreeze({ kind: "locallyAccepted", bundle: candidate.bundle,
      bundleHash: candidate.bundleHash, repairUsed: true, invocationCount: 2 }) });
  const next = (candidate: Extract<VNextProposalBundleCandidate, { kind: "locallyRejected" }>, synthesis?: ProposalRevisionSynthesis): VNextProposalRevisionEvaluation => {
    const rejected = providerRejected("PROPOSAL_REPAIR_EXHAUSTED", candidate.issues, true, 2,
      synthesis === undefined ? candidate.diagnostics : wireFillingDiagnostics(candidate.draft, candidate.diagnostics, synthesis.draft,
        requiredContext && proposalDraftContext(requiredContext, ticket.knowledgeRefs, draftNamedPossessions(requiredContext, synthesis.draft))));
    if (requiredContext === undefined) return { ...(synthesis === undefined ? {} : { synthesis }), result: rejected };
    const repairTicket = createRepairTicket(candidate, requiredContext, ticket.capabilities, ticket.terminalKinds, ticket.npcRefs, ticket.knowledgeRefs, ticket.round + 1);
    if (!vnextProposalCorrectionAdmitted([...priorTickets, ticket, repairTicket])) return { ...(synthesis === undefined ? {} : { synthesis }), result: rejected };
    return { ...(synthesis === undefined ? {} : { synthesis }), result: deepFreeze({ kind: "repairRequired", repairTicket, invocationCount: 2 }) };
  };
  if (vnextProposalTicketIsEmptyDraft(ticket)) {
    try {
      const candidate = vnextProposalRevisionCandidate(response, ticket.capabilities, ticket.terminalKinds, requiredContext, ticket.knowledgeRefs);
      return candidate.kind === "accepted" ? accepted(candidate) : next(candidate);
    } catch (error) {
      if (!(error instanceof VNextProposalBundleOutputError)) throw error;
      return { result: providerRejected("PROPOSAL_REPAIR_EXHAUSTED", error.diagnostics.map(d => d.constraint), true, 2, error.diagnostics) };
    }
  }
  let synthesis: ProposalRevisionSynthesis | undefined;
  try {
    synthesis = revisionSynthesis(response, ticket, proposalUsesTypedReplacement(ticket.capabilities, requiredContext));
    const candidate = vnextProposalRevisionCandidate({ choices: [{ message: { tool_calls: [{ type: "function",
      function: { name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: JSON.stringify(synthesis.draft) } }] } }] }, ticket.capabilities, ticket.terminalKinds, requiredContext, ticket.knowledgeRefs);
    return candidate.kind === "accepted" ? accepted(candidate, synthesis) : next(candidate, synthesis);
  } catch (error) {
    if (!(error instanceof VNextProposalBundleOutputError)) throw error;
    const rejected = providerRejected("PROPOSAL_REPAIR_EXHAUSTED", error.diagnostics.map(d => d.constraint), true, 2, error.diagnostics);
    // The reply was no revision at all: the draft is unchanged, so while a
    // round remains the same draft is sent again, told why this reply did
    // not count beside what it still has to fix. An unparsed draft has no
    // draft to send again, and a reply that reproduced the draft it was
    // told to change has already shown it will not.
    // Only a failure of the revision protocol itself earns the round; a
    // reply whose content cannot be bound at all (non-canonical text) ends
    // the action as before.
    if (synthesis !== undefined || requiredContext === undefined || ticket.sourceDraft === null
      || error.diagnostics.some(detail => !isRevisionReplyDiagnostic(detail) || detail.constraint === "revision:unchanged-draft")) return { ...(synthesis === undefined ? {} : { synthesis }), result: rejected };
    const repairTicket = createVNextRevisionInvalidTicket(ticket, error.diagnostics, requiredContext);
    if (!vnextProposalCorrectionAdmitted([...priorTickets, ticket, repairTicket])) return { result: rejected };
    return { result: deepFreeze({ kind: "repairRequired", repairTicket, invocationCount: 2 }) };
  }
}

/** A diagnostic about the reply rather than the draft: an invalid patch, a
 * wrong tool, or revision bytes that did not parse. */
function isRevisionReplyDiagnostic(detail: ProposalDiagnostic): boolean {
  return detail.constraint.startsWith("revision:") || detail.constraint.startsWith("tool-response:") || detail.constraint.startsWith("json:");
}

/** The ticket that follows a reply which failed to revise: the same draft,
 * the same round diagnostics, and the failed reply's own appended. Room
 * derives it from the saved reply and the ticket it answered. */
export function createVNextRevisionInvalidTicket(previous: VNextProposalBundleRepairTicket, revisionDiagnostics: readonly ProposalDiagnostic[],
  requiredContext: VNextRequiredContext): VNextProposalBundleRepairTicket {
  if (previous.sourceDraft === null || revisionDiagnostics.length === 0) throw new TypeError("VNEXT_PROPOSAL_REVISION_INVALID_TICKET_REQUIRES_A_DRAFT");
  // The draft's own diagnostics lead; a failed reply's are appended after
  // them and never accumulate, so two identical failures make two identical
  // tickets and the progress rule ends the conversation.
  const base = previous.diagnostics.filter(detail => !isRevisionReplyDiagnostic(detail));
  const appended = revisionDiagnostics.map(detail => ({ ...detail, pathBase: "arguments" as const,
    repair: { allowed: true, reason: "uncommitted-proposal-may-be-revised-once" } }));
  const diagnostics = [...base, ...appended];
  return createRepairTicket({ kind: "locallyRejected", draft: previous.draft, bundleHash: previous.bundleHash,
    validationCode: "PROPOSAL_REVISION_INVALID", issues: diagnostics.map(detail => detail.constraint),
    diagnostics, originalArguments: previous.originalArguments, argumentSource: previous.argumentSource },
    requiredContext, previous.capabilities, previous.terminalKinds, previous.npcRefs, previous.knowledgeRefs, previous.round + 1);
}

/** A parseable but structurally incomplete filling still has exact source bytes
 * and diagnostics. Preserve it for the model; never invent a valid domain draft. */
export function vnextProposalRevisionCandidate(response: unknown, capabilities: readonly VNextProposalCapabilityId[],
  terminalKinds?: readonly string[], context?: VNextRequiredContext,
  /** What the stage asked for (ADR 0133): given, the reply is checked against
   * those carried items and the ones it names, not against every record any
   * later round read. */
  asked?: readonly string[]): VNextProposalBundleCandidate {
  if (context !== undefined && asked !== undefined) context = proposalDraftContext(context, asked, vnextProposalNamedPossessions(context, response));
  let parsed: VNextProposalBundleCandidate | undefined;
  try {
    const candidate = parsed = parseSubmitKpProposalBundleCandidateResponse(response, context);
    assertVNextProposalCandidateCapabilities(candidate, capabilities, terminalKinds);
    return candidate;
  } catch (error) {
    if (!(error instanceof VNextProposalBundleOutputError)) throw error;
    const call = extractProposalToolCall(response);
    if (call.name !== SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) throw error;
    let raw: unknown;
    try { raw = typeof call.arguments === "string" ? parseJsonObjectIgnoringTrailingClosers(call.arguments) : call.arguments; }
    catch { throw error; }
    if (!isPlainRecord(raw) || SELECTION_ARGUMENT_KEYS.some(key => Object.hasOwn(raw, key))) throw error;
    let draft: JsonRecord;
    try { draft = canonicalClone(parsed === undefined ? raw : parsed.kind === "accepted" ? parsed.bundle : parsed.draft) as JsonRecord; } catch { throw error; }
    // A step of a type the selection did not load is reported beside the
    // filling's other problems, not only once they are all fixed (round 115
    // spent its three rounds on those and then met this). The validator's
    // own diagnostics are kept beside the capability check that followed.
    const unloaded = parsed !== undefined ? [] : (["check", "steps"] as const).flatMap(container => !isPlainRecord(raw[container]) ? []
      : Object.entries(raw[container] as Record<string, unknown>).flatMap(([key, rows]) => {
        const capability = VNEXT_FILLING_STEP_KEYS.find(id => id === key);
        if (capability === undefined || !Array.isArray(rows) || rows.length === 0) return [];
        // SPEC 0016 §7.2 (ADR 0129): a shared wire group is not a selected
        // subtype. Keep genuine shape diagnostics without inventing an
        // unselected legacy completion when a native row was already loaded.
        const unloaded = key === "completeObject" ? rows.some(row => {
          const selected = vnextProposalCapabilityForEntry({ ...(isPlainRecord(row) ? row : {}), kind: "completeObject" });
          return selected !== undefined && !capabilities.includes(selected);
        }) : !capabilities.includes(capability);
        return !unloaded ? [] : [proposalDiagnostic("CONSTRAINT_CONFLICT", "proposal:capability-not-loaded",
            { path: [container, key], pathBase: "arguments", expected: { enum: capabilities }, actual: diagnosticActual(rows) })];
      }));
    const diagnostics = [...(parsed?.kind === "locallyRejected" ? parsed.diagnostics : []), ...error.diagnostics, ...unloaded];
    return deepFreeze({ kind: "locallyRejected", draft, bundleHash: canonicalHash(draft),
      validationCode: "PROPOSAL_WIRE_INVALID", issues: diagnostics.map(d => d.constraint), diagnostics,
      originalArguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(raw),
      argumentSource: typeof call.arguments === "string" ? "rawString" : "decodedObject" });
  }
}

export async function invokeSubmitKpProposalBundle(input: Readonly<{
  binding: AuthoritativeModelBinding;
  modelId: string;
  message: string;
  signal?: AbortSignal;
}>): Promise<VNextProposalBundle> {
  if (typeof input.modelId !== "string" || input.modelId.trim().length === 0) {
    throw new TypeError("VNEXT_PROPOSAL_MODEL_ID_REQUIRED");
  }
  const response = await input.binding.run(
    input.modelId,
    createSubmitKpProposalBundleModelInput(input.message),
    input.signal === undefined ? undefined : { signal: input.signal },
  );
  return parseSubmitKpProposalBundleResponse(response);
}

/** Runs only the main strict-tool invocation. A repairable rejection becomes
 * a self-validating ticket so the Room can persist it before any second call. */
export async function invokeSubmitKpProposalBundleFirstPass(
  input: Readonly<{
    binding: AuthoritativeModelBinding;
    modelId: string;
    message: string;
    requiredContext: VNextRequiredContext;
    capabilities?: readonly VNextProposalCapabilityId[];
    terminalKinds?: readonly string[];
    amendable?: boolean;
    /** Bystander decision views the selection asked to load. */
    npcRefs?: readonly string[];
    /** Frozen memory bodies the selection asked to read, as entry refs. */
    knowledgeRefs?: readonly string[];
    /** The question this action asked and its answer (ADR 0081). */
    retryQuestion?: VNextRetryQuestion;
    /** Room's read of carried items a reply names (ADR 0133). */
    readNamedItems?: (refs: readonly string[]) => Promise<VNextRequiredContext>;
    signal?: AbortSignal;
  }>,
): Promise<VNextProposalBundleFirstPassResult> {
  if (typeof input.modelId !== "string" || input.modelId.trim().length === 0) {
    throw new TypeError("VNEXT_PROPOSAL_MODEL_ID_REQUIRED");
  }
  if (typeof input.message !== "string" || input.message.trim().length === 0) {
    throw new TypeError("SUBMIT_KP_PROPOSAL_BUNDLE_MESSAGE_REQUIRED");
  }
  const contextHash = input.requiredContext?.binding?.contextHash;
  if (typeof contextHash !== "string" || contextHash.length === 0) {
    throw new TypeError("VNEXT_PROPOSAL_CONTEXT_HASH_REQUIRED");
  }
  const requiredContext = deepFreeze(canonicalClone(input.requiredContext)) as VNextRequiredContext;
  const runOptions = input.signal === undefined ? undefined : { signal: input.signal };
  const capabilities = closeVNextProposalCapabilities(input.capabilities ?? VNEXT_PROPOSAL_CAPABILITY_IDS);
  // The forms cite only what the model is sent: the frozen context less the
  // bystander views this selection did not name. Room reads the whole context.
  const npcRefs = Object.freeze([...new Set(input.npcRefs ?? [])].sort(compareCodeUnits));
  const knowledgeRefs = Object.freeze([...new Set(input.knowledgeRefs ?? [])].sort(compareCodeUnits));
  const view = proposalContextView(requiredContext, npcRefs, knowledgeRefs);
  const requestable = proposalNpcRecall(requiredContext).requestableRefs.filter(ref => !npcRefs.includes(ref));
  const handles = proposalRequestableKnowledgeHandles(requiredContext, npcRefs, knowledgeRefs);
  const carried = proposalPossessionRecall(requiredContext, knowledgeRefs).map(row => row.entryRef);
  const response = await input.binding.run(
    input.modelId,
    withRetryAnswer(createSubmitKpProposalBundleModelInput(input.message, capabilities, proposalItemEntryRefs(view), proposalObservationSubjectRefs(view), input.terminalKinds, proposalNpcSourceChoices(view), requiredContextBasisReferences(view), proposalCreatureTargetRefs(view), input.amendable === true, proposalItemDefinitionRefs(view), input.amendable === true ? requestable : [], input.amendable === true ? handles : [],
      undefined, proposalUnofferedCapabilities(requiredContext), proposalInventoryEntryRefs(view), requiredContext, input.amendable === true ? carried : []),
      input.retryQuestion),
    runOptions,
  );
  if (input.amendable === true) {
    let amendment: VNextProposalAmendment | undefined;
    try { amendment = vnextProposalAmendmentRequest(response, capabilities, input.terminalKinds, npcRefs, requiredContext, knowledgeRefs); }
    catch (error) {
      // An amendment that cannot be read ends this call as an unreadable first
      // selection does, never as a provider timeout (rounds 136 and 142 were
      // reported as one when this escaped).
      if (!(error instanceof VNextProposalBundleOutputError)) throw error;
      return providerRejected("PROPOSAL_FORM_INVALID", error.diagnostics.map(d => d.constraint), false, 1, error.diagnostics);
    }
    if (amendment !== undefined) return deepFreeze({ kind: "amendmentRequested", amendment, invocationCount: 1 });
    if (vnextProposalCalledSelectionTool(response)) return deepFreeze({ kind: "selectionRepeated", invocationCount: 1 });
  }
  // ADR 0133: a carried item the reply names is read before it is checked.
  const checked = await contextForNamedPossessions(requiredContext, response, input.readNamedItems);
  let candidate: VNextProposalBundleCandidate;
  try {
    candidate = vnextProposalRevisionCandidate(response, capabilities, input.terminalKinds, checked, knowledgeRefs);
  } catch (error) {
    // A reply without a readable tool call (none, or no function name) is
    // the model's own failure, permanent for these saved bytes; it must not
    // surface as a provider timeout the player is told to retry.
    if (error instanceof ModelOutputValidationError && !(error instanceof VNextProposalBundleOutputError)) {
      const constraint = typeof error.outputConstraint === "string" ? error.outputConstraint : "tool-response:invalid";
      return providerRejected("PROPOSAL_FORM_INVALID", [constraint], false, 1, [proposalDiagnostic("CONSTRAINT_CONFLICT", constraint,
        { repair: { allowed: false, reason: "reply-is-not-one-tool-call" } })]);
    }
    if (!(error instanceof VNextProposalBundleOutputError)) throw error;
    const unparsed = vnextProposalUnparsedArguments(response);
    if (unparsed !== undefined) return deepFreeze({ kind: "repairRequired", invocationCount: 1,
      repairTicket: createVNextUnparsedRevisionTicket(unparsed, checked, capabilities, input.terminalKinds ?? VNEXT_INITIAL_PROPOSAL_DECISION_KINDS, npcRefs, knowledgeRefs) });
    return providerRejected(
      "PROPOSAL_FORM_INVALID",
      error.diagnostics.map(d => d.constraint),
      false,
      1,
      error.diagnostics,
    );
  }
  return firstPassForCandidate(candidate, checked, capabilities, input.terminalKinds, npcRefs, knowledgeRefs);
}

function firstPassForCandidate(candidate: VNextProposalBundleCandidate, requiredContext: VNextRequiredContext,
  capabilities: readonly VNextProposalCapabilityId[], terminalKinds?: readonly string[], npcRefs: readonly string[] = [], knowledgeRefs: readonly string[] = []): VNextProposalBundleFirstPassResult {
  if (candidate.kind === "accepted") return deepFreeze({ kind: "locallyAccepted", bundle: candidate.bundle,
    bundleHash: candidate.bundleHash, repairUsed: false, invocationCount: 1 });
  return deepFreeze({ kind: "repairRequired",
    repairTicket: createRepairTicket(candidate, requiredContext, capabilities, terminalKinds, npcRefs, knowledgeRefs), invocationCount: 1 });
}

/** A wire draft presented as the form reply that would have carried it. A
 * bundle composed from a patch has no such reply of its own; the ticket that
 * revises it is derived from this one, on both sides, from the same bytes. */
export function vnextProposalDraftReply(draft: Readonly<JsonRecord>): unknown {
  return { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ type: "function",
    function: { name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: JSON.stringify(draft) } }] } }] };
}

/** The tickets of one filling in round order, the last being the one to
 * send. A ticket's `originalArguments` is the draft its round revises -- the
 * reply's own bytes after a form reply, the composed draft after a patch --
 * so the conversation a correction replays is derived from the tickets
 * alone: each earlier ticket is one turn, the assistant's form call carrying
 * that draft and the ticket as the tool result. Both sides rebuild it from
 * the tickets Room saved. A re-emit ticket answers a fresh filling request,
 * and the tickets after it form a fresh conversation. */
export type VNextCorrectionChain = readonly VNextProposalBundleRepairTicket[];

/** The tickets of the conversation the last ticket belongs to: those after
 * the most recent re-emit, or the whole chain. */
export function vnextProposalCorrectionConversation(chain: VNextCorrectionChain): VNextCorrectionChain {
  let start = 0;
  chain.forEach((ticket, index) => { if (index < chain.length - 1 && vnextProposalTicketIsEmptyDraft(ticket)) start = index + 1; });
  return chain.slice(start);
}

/** Runs the next correction of one filling: the chain's last ticket is sent
 * as the newest turn of its conversation, and the reply is read against it. */
export async function invokeCorrectKpProposalBundle(input: Readonly<{
  binding: AuthoritativeModelBinding;
  modelId: string;
  requiredContext: VNextRequiredContext;
  /** Every ticket of this filling so far, in round order; `repairTicket`
   * alone names a chain of one. */
  chain?: VNextCorrectionChain;
  repairTicket?: VNextProposalBundleRepairTicket;
  /** The question this action asked and its answer (ADR 0081). */
  retryQuestion?: VNextRetryQuestion;
  /** Room's read of carried items a reply names (ADR 0133). */
  readNamedItems?: (refs: readonly string[]) => Promise<VNextRequiredContext>;
  signal?: AbortSignal;
}>): Promise<VNextProposalRevisionEvaluation> {
  if (typeof input.modelId !== "string" || input.modelId.trim().length === 0) {
    throw new TypeError("VNEXT_PROPOSAL_MODEL_ID_REQUIRED");
  }
  const contextHash = input.requiredContext?.binding?.contextHash;
  if (typeof contextHash !== "string" || contextHash.length === 0) {
    throw new TypeError("VNEXT_PROPOSAL_CONTEXT_HASH_REQUIRED");
  }
  const given = input.chain ?? (input.repairTicket === undefined ? [] : [input.repairTicket]);
  if (given.length === 0) throw new TypeError("VNEXT_PROPOSAL_CORRECTION_CHAIN_REQUIRED");
  const requiredContext = deepFreeze(canonicalClone(input.requiredContext)) as VNextRequiredContext;
  const chain = given.map(ticket => {
    assertRepairTicket(ticket, contextHash, requiredContext);
    return deepFreeze(canonicalClone(ticket)) as VNextProposalBundleRepairTicket;
  });
  if (!vnextProposalCorrectionAdmitted(chain)) throw new TypeError("VNEXT_PROPOSAL_CORRECTION_NOT_ADMITTED");
  const ticket = chain[chain.length - 1]!;
  const response = await input.binding.run(input.modelId,
    createVNextProposalRevisionModelInput(chain, requiredContext, input.retryQuestion), input.signal === undefined ? undefined : { signal: input.signal });
  return evaluateVNextProposalRevisionResponse(response, ticket,
    await contextForNamedPossessions(requiredContext, response, input.readNamedItems), chain.slice(0, -1));
}

/** The request the chain's last ticket sends: the filling request its
 * conversation began with, then each ticket of that conversation as a turn.
 * A re-emit ticket sends the original filling request instead. A single
 * ticket is a chain of one. */
export function createVNextProposalRevisionModelInput(chain: VNextCorrectionChain | VNextProposalBundleRepairTicket, requiredContext: VNextRequiredContext,
  retryQuestion?: VNextRetryQuestion) {
  const tickets = Array.isArray(chain) ? chain as VNextCorrectionChain : [chain as VNextProposalBundleRepairTicket];
  const current = tickets[tickets.length - 1];
  if (current === undefined) throw new TypeError("VNEXT_PROPOSAL_CORRECTION_CHAIN_REQUIRED");
  const view = proposalContextView(requiredContext, current.npcRefs, current.knowledgeRefs);
  const contextBody = vnextProposalContextBody(requiredContext, current.npcRefs, current.knowledgeRefs);
  const selection = [current.capabilities, proposalItemEntryRefs(view), proposalObservationSubjectRefs(view), current.terminalKinds,
    proposalNpcSourceChoices(view), requiredContextBasisReferences(view), proposalCreatureTargetRefs(view), false, proposalItemDefinitionRefs(view),
    [], [], undefined, proposalUnofferedCapabilities(requiredContext), proposalInventoryEntryRefs(view), requiredContext] as const;
  if (vnextProposalTicketIsEmptyDraft(current)) return withRetryAnswer(createSubmitKpProposalBundleModelInput(contextBody, ...selection), retryQuestion);
  return withRetryAnswer(createCorrectKpProposalBundleModelInput(contextBody, vnextProposalCorrectionConversation(tickets).map(ticket => ({
    call: { id: `call_${ticket.round}`, name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: ticket.originalArguments },
    content: "", body: vnextProposalCorrectionPrompt(ticket, requiredContext) })), ...selection), retryQuestion);
}

/** Both the Provider and Room bind this exact private body to a proved ticket.
 * It carries the repair round's own material only; the frozen context is sent
 * once, by the shared context block this body follows. The draft a round
 * revises is the assistant turn just before it, so it is not spelled out;
 * null means that turn did not parse and only replacement is allowed. */
export function vnextProposalCorrectionPrompt(candidate: VNextProposalBundleRepairTicket, requiredContext: VNextRequiredContext): string {
  const view = requiredContext;
  const checked = proposalDraftContext(requiredContext, candidate.knowledgeRefs, draftNamedPossessions(requiredContext, candidate.sourceDraft));
  const diagnostics = wireFillingDiagnostics(candidate.draft, candidate.diagnostics, candidate.sourceDraft, checked).map(detail => ({ ...detail,
    ...(detail.actual === undefined ? {} : { actual: proposalWireDiagnosticReferences(detail.actual, view) }),
    ...(detail.expected === undefined ? {} : { expected: proposalWireDiagnosticReferences(detail.expected, view) }) }));
  return JSON.stringify(proposalWireReferences({ contextHash: proposalModelContext(requiredContext, candidate.npcRefs, candidate.knowledgeRefs).contextHash,
    responseProtocol: VNEXT_PROPOSAL_REVISION_PROTOCOL,
    round: candidate.round, roundsRemaining: VNEXT_PROPOSAL_CORRECTION_ROUNDS - candidate.round,
    sourceDraftVersion: candidate.sourceDraftVersion, sourceDraft: candidate.sourceDraft === null ? null : "asReplied",
    diagnostics,
    // Handles the draft used that no step produced, with the loaded type whose
    // step declares one. The model either adds that step (its form is in this
    // request) or replaces the handle with a listed existing reference.
    producerCompletion: vnextProposalDanglingHandles(candidate.draft)
      .filter(entry => candidate.capabilities.includes(entry.capability))
      .map(entry => ({ handle: entry.handle, producerKind: entry.kind, loadedType: entry.capability })),
    allowedModes: candidate.sourceDraft === null || proposalUsesTypedReplacement(candidate.capabilities, requiredContext)
      ? ["replaceDraft"] : ["patch", "replaceDraft"] }, view));
}

export async function invokeSubmitKpProposalBundleWithOneCorrection(
  input: Readonly<{
    binding: AuthoritativeModelBinding;
    modelId: string;
    message: string;
    requiredContext: VNextRequiredContext;
    capabilities?: readonly VNextProposalCapabilityId[];
    terminalKinds?: readonly string[];
    persistRepairTicket: (ticket: VNextProposalBundleRepairTicket) => void | Promise<void>;
    signal?: AbortSignal;
  }>,
): Promise<VNextProposalBundleProviderResult> {
  if (typeof input.persistRepairTicket !== "function") {
    throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_PERSISTENCE_REQUIRED");
  }
  const firstPass = await invokeSubmitKpProposalBundleFirstPass({ ...input, amendable: false });
  if (firstPass.kind === "amendmentRequested" || firstPass.kind === "selectionRepeated") {
    // Unreachable: this orchestration never offers the selection tool. Fail
    // closed rather than let an unexpected shape reach a caller as a bundle.
    return providerRejected("PROPOSAL_FORM_INVALID", ["selection:amendment-not-offered"], false, 1,
      [proposalDiagnostic("CONSTRAINT_CONFLICT", "selection:amendment-not-offered",
        { repair: { allowed: false, reason: "amendment-requires-the-room-orchestrated-path" } })]);
  }
  if (firstPass.kind !== "repairRequired") return firstPass;
  // Each correction is the next turn of the conversation the filling began;
  // the chain of tickets is that conversation, and each is persisted before
  // the call it opens.
  const chain: VNextProposalBundleRepairTicket[] = [];
  let pending: VNextProposalBundleRepairTicket = firstPass.repairTicket;
  for (;;) {
    chain.push(pending);
    await input.persistRepairTicket(pending);
    const corrected = await invokeCorrectKpProposalBundle({
      binding: input.binding, modelId: input.modelId, requiredContext: input.requiredContext, chain, signal: input.signal,
    });
    if (corrected.result.kind !== "repairRequired") return corrected.result;
    pending = corrected.result.repairTicket;
  }
}

/** SPEC 0016 §7.2: a Rules refusal of an item an inventory step names is
 * answered with the items the revision may name instead. Rules carries no
 * candidate refs; they come from what the stage was sent, read and listed
 * alike, so the live round and Room's proof of it list the same. A refusal
 * whose fix is opening a container first offers none. */
function withInventoryEntryCandidates(diagnostics: readonly ProposalDiagnostic[], bundle: VNextProposalBundle,
  context: VNextRequiredContext): readonly ProposalDiagnostic[] {
  const records = frozenRecords(context);
  return diagnostics.map(diagnostic => {
    const path = diagnostic.path ?? [];
    const expected = diagnostic.expected;
    if (diagnostic.pathBase !== "draft" || path.length !== 4 || path[0] !== "proposals" || path[2] !== "operation" || path[3] !== "entryRef"
      || !isPlainRecord(expected) || expected.referenceKind !== "itemEntry" || expected.precedingContainerOperation !== undefined) return diagnostic;
    const step: unknown = bundle.proposals[Number(path[1])];
    if (!isPlainRecord(step) || step.kind !== "inventoryOperation" || !isPlainRecord(step.operation)) return diagnostic;
    const named = step.operation.entryRef;
    const candidates = inventoryEntryCandidates(context, step.operation, records)?.filter(ref => ref !== named);
    return candidates === undefined || candidates.length === 0 ? diagnostic : { ...diagnostic, expected: { ...expected, enum: candidates } };
  });
}

/** The source passed local validation. Only Room can prove the later Rules
 * rejection and admit this ticket before any confirmation, dice or execution. */
export function createVNextAuthorityRevisionTicket(response: unknown, requiredContext: VNextRequiredContext,
  capabilities: readonly VNextProposalCapabilityId[], terminalKinds: readonly string[], diagnostics: readonly ProposalDiagnostic[],
  npcRefs: readonly string[] = [], knowledgeRefs: readonly string[] = [], round = 1) {
  const candidate = vnextProposalRevisionCandidate(response, capabilities, terminalKinds, requiredContext, knowledgeRefs);
  if (candidate.kind !== "accepted" || diagnostics.length === 0) throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_INVALID");
  const call = extractProposalToolCall(response);
  const offered = withInventoryEntryCandidates(diagnostics, candidate.bundle, requiredContext);
  return createRepairTicket({ kind: "locallyRejected", draft: candidate.bundle as unknown as JsonRecord,
    bundleHash: candidate.bundleHash, validationCode: "PROPOSAL_RULES_DIAGNOSTIC",
    diagnostics: offered, issues: offered.map(detail => detail.constraint),
    originalArguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments),
    argumentSource: typeof call.arguments === "string" ? "rawString" : "decodedObject" }, requiredContext, capabilities, terminalKinds, npcRefs, knowledgeRefs, round);
}

export function createRepairTicket(candidate: Omit<Extract<VNextProposalBundleCandidate, { kind: "locallyRejected" }>, "validationCode">
    & { validationCode: VNextProposalBundleRepairTicket["validationCode"] },
  requiredContext: VNextRequiredContext, capabilities: readonly VNextProposalCapabilityId[],
  terminalKinds: readonly string[] = VNEXT_INITIAL_PROPOSAL_DECISION_KINDS, npcRefs: readonly string[] = [],
  knowledgeRefs: readonly string[] = [], round = 1): VNextProposalBundleRepairTicket {
  if (!Number.isInteger(round) || round < 1) throw new TypeError("VNEXT_PROPOSAL_REPAIR_ROUND_INVALID");
  const sourceDraft = candidate.validationCode === "PROPOSAL_JSON_INVALID" ? null
    : parseJsonObjectIgnoringTrailingClosers(candidate.originalArguments) as JsonRecord;
  const loadedNpcRefs = [...new Set(npcRefs)].sort(compareCodeUnits), readKnowledgeRefs = [...new Set(knowledgeRefs)].sort(compareCodeUnits);
  // A same-bundle handle nothing produces names a type the selection did not
  // load; the one correction is sent with that type's form as well, so the
  // model can declare it where it is used instead of failing on a reference
  // it had no way to satisfy. Derived from the draft alone: Room rebuilds the
  // identical ticket from the saved bytes.
  const loaded = vnextProposalProducerCompletion(candidate.draft, capabilities).loaded;
  const body = canonicalClone({ schema: VNEXT_PROPOSAL_BUNDLE_REPAIR_TICKET_SCHEMA,
    sourceDraft, sourceDraftVersion: proposalSourceDraftVersion(candidate.originalArguments, requiredContext.binding.contextHash), round,
    draft: candidate.draft, bundleHash: candidate.bundleHash, contextHash: requiredContext.binding.contextHash,
    modelContextHash: canonicalHash(proposalModelContext(requiredContext, loadedNpcRefs, readKnowledgeRefs)), capabilities: loaded, terminalKinds,
    npcRefs: loadedNpcRefs, knowledgeRefs: readKnowledgeRefs,
    validationCode: candidate.validationCode, issues: candidate.issues,
    diagnostics: sourceDraft === null ? candidate.diagnostics.map(detail => ({ ...detail,
      repair: { allowed: true, reason: "uncommitted-proposal-may-be-revised-once" } }))
      : candidate.validationCode === "PROPOSAL_REVISION_INVALID" ? candidate.diagnostics
      : vnextProposalModelRepairDiagnostics(candidate.draft, candidate.diagnostics, candidate.originalArguments),
    originalArguments: candidate.originalArguments, argumentSource: candidate.argumentSource,
  }) as Omit<VNextProposalBundleRepairTicket, "ticketHash">;
  return deepFreeze({ ...body, ticketHash: canonicalHash(body) });
}

export function assertRepairTicket(ticket: unknown, contextHash: string, requiredContext?: VNextRequiredContext): asserts ticket is VNextProposalBundleRepairTicket {
  const invalid = (): never => { throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_INVALID"); };
  if (!isPlainRecord(ticket) || !hasExactKeys(ticket, ["schema", "draft", "bundleHash", "contextHash", "modelContextHash",
    "capabilities", "terminalKinds", "npcRefs", "knowledgeRefs", "validationCode", "issues", "diagnostics", "originalArguments", "argumentSource", "ticketHash",
    "sourceDraft", "sourceDraftVersion", "round"]) || ticket.schema !== VNEXT_PROPOSAL_BUNDLE_REPAIR_TICKET_SCHEMA
    || !Number.isInteger(ticket.round) || (ticket.round as number) < 1 || (ticket.round as number) > VNEXT_PROPOSAL_CORRECTION_ROUNDS
    || ticket.contextHash !== contextHash || typeof ticket.originalArguments !== "string" || !isPlainRecord(ticket.draft)
    || !Array.isArray(ticket.capabilities) || !Array.isArray(ticket.terminalKinds) || typeof ticket.modelContextHash !== "string"
    || !Array.isArray(ticket.npcRefs) || ticket.npcRefs.some(ref => typeof ref !== "string")
    || !sameCanonical([...new Set(ticket.npcRefs as string[])].sort(compareCodeUnits), ticket.npcRefs)
    || !Array.isArray(ticket.knowledgeRefs) || ticket.knowledgeRefs.some(ref => typeof ref !== "string")
    || !sameCanonical([...new Set(ticket.knowledgeRefs as string[])].sort(compareCodeUnits), ticket.knowledgeRefs)
    || (ticket.argumentSource !== "rawString" && ticket.argumentSource !== "decodedObject")
    || (requiredContext !== undefined && (requiredContext.binding.contextHash !== contextHash
      || canonicalHash(proposalModelContext(requiredContext, ticket.npcRefs as string[], ticket.knowledgeRefs as string[])) !== ticket.modelContextHash))) return invalid();
  try {
    if (!sameCanonical(closeVNextProposalCapabilities(ticket.capabilities), ticket.capabilities)
      || !ticket.terminalKinds.every(kind => typeof kind === "string" && VNEXT_INITIAL_PROPOSAL_DECISION_KINDS.includes(kind))) return invalid();
    if (ticket.sourceDraftVersion !== proposalSourceDraftVersion(ticket.originalArguments, contextHash)) return invalid();
    if (ticket.sourceDraft === null) {
      const evidence = vnextProposalUnparsedArguments({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ type: "function",
        function: { name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: ticket.originalArguments } }] } }] });
      if (!evidence || ticket.validationCode !== "PROPOSAL_JSON_INVALID" || ticket.argumentSource !== "rawString"
        || ticket.bundleHash !== canonicalHash(null) || !sameCanonical(ticket.draft, {})
        || !sameCanonical(ticket.issues, [evidence.diagnostic.constraint])
        || !sameCanonical(ticket.diagnostics, [{ ...evidence.diagnostic,
          repair: { allowed: true, reason: "uncommitted-proposal-may-be-revised-once" } }])) return invalid();
      return;
    }
    if (!sameCanonical(ticket.sourceDraft, parseJsonObjectIgnoringTrailingClosers(ticket.originalArguments))) return invalid();
    const proven = vnextProposalRevisionCandidate({ choices: [{ message: { tool_calls: [{ type: "function", function: {
      name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: ticket.argumentSource === "rawString"
        ? ticket.originalArguments : parseJsonObjectIgnoringTrailingClosers(ticket.originalArguments),
    } }] } }] }, ticket.capabilities as VNextProposalCapabilityId[], ticket.terminalKinds as string[], requiredContext,
      ticket.knowledgeRefs as string[]);
    if (ticket.validationCode === "PROPOSAL_RULES_DIAGNOSTIC") {
      // Hashes bind the supplied evidence; the Room journal must still prove
      // these diagnostics against Rules before granting a provider call.
      if (proven.kind !== "accepted" || proven.bundleHash !== ticket.bundleHash
        || !sameCanonical(proven.bundle, ticket.draft)
        || !Array.isArray(ticket.diagnostics) || ticket.diagnostics.length === 0
        || ticket.diagnostics.some(detail => !isPlainRecord(detail) || typeof detail.constraint !== "string")
        || !sameCanonical(ticket.diagnostics.map(detail => detail.constraint), ticket.issues)) return invalid();
    } else if (ticket.validationCode === "PROPOSAL_REVISION_INVALID") {
      // The draft is the one an earlier round revised, unchanged, so its own
      // diagnostics lead and are re-derived here; the failed reply's are
      // appended, and only Room can prove them from the reply it saved.
      const derived = proven.kind === "accepted" ? [] : vnextProposalModelRepairDiagnostics(proven.draft, proven.diagnostics, proven.originalArguments);
      if (proven.bundleHash !== ticket.bundleHash
        || !sameCanonical(proven.kind === "accepted" ? proven.bundle : proven.draft, ticket.draft)
        || !Array.isArray(ticket.diagnostics) || ticket.diagnostics.length <= derived.length
        || !sameCanonical(ticket.diagnostics.slice(0, derived.length), derived)
        || ticket.diagnostics.some(detail => !isPlainRecord(detail) || typeof detail.constraint !== "string")
        || !sameCanonical(ticket.diagnostics.map(detail => detail.constraint), ticket.issues)) return invalid();
    } else {
      // ADR 0138: what Room's preflight of the rest found follows the draft's
      // own diagnostics, each at a row of the reply; only Room proves those.
      if (proven.kind !== "locallyRejected" || !Array.isArray(ticket.diagnostics)) return invalid();
      const derived = vnextProposalModelRepairDiagnostics(proven.draft, proven.diagnostics, proven.originalArguments);
      const appended = ticket.diagnostics.slice(derived.length) as unknown[];
      if (proven.bundleHash !== ticket.bundleHash
        || !sameCanonical(proven.draft, ticket.draft) || proven.argumentSource !== ticket.argumentSource
        || proven.validationCode !== ticket.validationCode
        || !sameCanonical(ticket.diagnostics.slice(0, derived.length), derived)
        || (appended.length > 0 && !STAND_IN_VALIDATION_CODES.includes(proven.validationCode))
        || appended.some(detail => !isPlainRecord(detail) || typeof detail.constraint !== "string" || detail.pathBase !== "arguments"
          || !Array.isArray(detail.path) || !FILLING_ROW_CONTAINERS.includes(detail.path[0] as never))
        || !sameCanonical([...proven.issues, ...appended.map(detail => (detail as ProposalDiagnostic).constraint)], ticket.issues)) return invalid();
    }
  } catch { return invalid(); }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length
    && actual.every((key, index) => key === sorted[index]);
}

function providerRejected(
  code: Extract<VNextProposalBundleProviderResult, { kind: "rejected" }>["code"],
  issues: readonly string[],
  repairUsed: boolean,
  invocationCount: 1 | 2,
  diagnostics: readonly ProposalDiagnostic[] = diagnosticsFromIssues(code, issues),
): Extract<VNextProposalBundleProviderResult, { kind: "rejected" }> {
  return deepFreeze({
    kind: "rejected",
    code,
    issues: [...new Set(issues)].sort(),
    diagnostics,
    repairUsed,
    invocationCount,
  });
}

function syntaxDiagnostic(error: { reason: string; path: readonly (string | number)[]; offset: number; line: number; column: number }): ProposalDiagnostic {
  return proposalDiagnostic("JSON_SYNTAX", error.reason, { path: error.path, pathBase: "arguments",
    location: { offset: error.offset, line: error.line, column: error.column } });
}

function invalidOutput(error?: unknown): never {
  if (error instanceof VNextProposalBundleOutputError) throw error;
  if (error instanceof ProposalFillingError || error instanceof ContainerTransferWireError) throw new VNextProposalBundleOutputError(
    error.diagnostics.map(detail => ({ ...detail, pathBase: "arguments" })));
  throw new VNextProposalBundleOutputError(error instanceof JsonSyntaxError ? [syntaxDiagnostic(error)]
    : error instanceof ModelOutputValidationError && error.outputConstraint !== undefined
      ? [proposalDiagnostic("CONSTRAINT_CONFLICT", error.outputConstraint)]
    : error instanceof TypeError && error.message.startsWith("canonical JSON")
      ? [proposalDiagnostic("VALUE_INVALID", error.message, { repair: { allowed: false, reason: "draft-cannot-use-current-canonical-binding" } })] : undefined);
}

function wrongTool(actual: string, expected: string): never {
  throw new VNextProposalBundleOutputError([proposalDiagnostic("VALUE_INVALID", "tool-response:wrong-function", { expected, actual })]);
}

function fieldOutput(code: ProposalDiagnostic["code"], constraint: string, path: readonly (string | number)[], expected: unknown, actual: unknown): never {
  throw new VNextProposalBundleOutputError([proposalDiagnostic(code, constraint, { path, pathBase: "arguments", expected, actual: diagnosticActual(actual) })]);
}
