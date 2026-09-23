import { synthesizeProposalRevision, proposalSourceDraftVersion, ProposalRevisionError, type ProposalRevisionSource, type ProposalRevisionSynthesis } from "./proposal-revision";
import { ProposalFillingError, socialResultArgumentDiagnostics, proposalIntentEchoArgumentDiagnostics, proposalFillingDiagnostics,
  proposalFillingSteps, VNEXT_FILLING_STEP_KEYS } from "./proposal-filling-interface";
import { diagnosticsFromIssues, proposalDiagnostic, diagnosticActual, type ProposalDiagnostic } from "./proposal-diagnostics";
import type { AuthoritativeModelBinding } from "../authoritative-types";
import {
  ModelOutputValidationError,
  extractSingleToolCall,
} from "../authoritative-helpers";

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
  canonicalClone,
  canonicalHash,
  compareCodeUnits,
  deepFreeze,
  isPlainRecord,
  parseJsonObjectIgnoringTrailingClosers,
  JsonSyntaxError,
  type JsonRecord,
} from "./canonical-json";
import {
  CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA,
  CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  VNEXT_PROPOSAL_SCHEMA_REQUEST_IDS, VNEXT_INITIAL_PROPOSAL_DECISION_KINDS,
  vnextProposalSchemaRequestIds,
  closeVNextProposalSchemaRequest, type VNextProposalSchemaSelection,
  vnextSelectedProposalDecisionKinds,
  VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
  VNEXT_PROPOSAL_REVISION_PROTOCOL,
  createCorrectKpProposalBundleModelInput,
  createSubmitKpProposalBundleModelInput,
  createVNextProposalOfferModelInput,
  decodeVNextStrictToolBundle,
  type VNextProposalBundle,
} from "./proposal-schema";
import type { VNextRequiredContext } from "./required-context";
import { proposalCreatureTargetRefs, proposalItemDefinitionRefs, proposalItemEntryRefs, proposalObservationSubjectRefs, proposalNpcSourceChoices, proposalModelContext, proposalContextView, proposalNpcRecall, proposalKnowledgeRecall, vnextProposalContextBody } from "./proposal-context";
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

/** Corrections one filling may spend. Each is its own call, sent as the next
 * turn of the conversation that produced the reply it corrects, and each must
 * change what is diagnosed: a round that repeats an earlier round's
 * diagnostics has made no progress and ends the action. */
export const VNEXT_PROPOSAL_CORRECTION_ROUNDS = 3;

export const VNEXT_PROPOSAL_BUNDLE_PARSER_CONTRACT = Object.freeze({
  version: "kp-vnext2-proposal-parser-v70",
  correctionRounds: VNEXT_PROPOSAL_CORRECTION_ROUNDS,
  revisionFailure: "a-reply-that-is-no-revision-keeps-the-draft-and-spends-a-round-with-its-own-diagnostics-appended-v1",
  correctionConversation: "each-round-appends-the-reply-as-an-assistant-tool-call-and-its-ticket-as-the-tool-result-until-progress-stops-v1",
  argumentDecoding: "unique-member-json-accepting-a-complete-root-object-before-trailing-closing-delimiters-v1",
  producerCompletion: "dangling-same-bundle-handle-loads-its-producer-type-retained-by-later-room-proved-revisions-v2",
  amendableRepeatPolicy: "selection-repeated-without-amendment-refills-once-without-the-selection-tool-v1",
  fillingLayout: "steps-grouped-by-loaded-type-each-step-with-its-own-success-and-failure-no-kind-step-or-branch-fields-continuations-same-v4",
  executionDependencies: "typed-handles-and-execution-snapshot-versions-with-proved-prefix-extensions-no-group-precedence-v1",
  socialResults: "required-relationshipChanges-newPromises-promiseChanges-newDebts-explicit-empty-arrays-no-mixed-consequences-v1",
  responseBasis: "closed-enum-on-a-plain-array-item-player-expression-as-a-member-anyof-only-with-a-producer-v1",
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
  localValidation: "closed-domain-typed-authored-canonical-time-passage-and-npc-plans-v6",
  referenceSelection: "frozen-authorized-read-bound-basis-classed-subjects-and-item-definitions-v4",
  correctionPolicy: "version-bound-atomic-json-patch-through-the-correction-tool-or-full-replacement-through-the-filling-form-sent-first-up-to-three-rounds-with-progress-v13",
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
  shownNpcRefs: readonly string[] = []): VNextProposalSchemaRequest {
  let call: ReturnType<typeof extractSingleToolCall>, raw: unknown;
  try {
    call = extractProposalToolCall(response);
    raw = typeof call.arguments === "string" ? parseJsonObjectIgnoringTrailingClosers(call.arguments) : call.arguments;
  } catch (error) { return invalidOutput(error); }
  if (call.name !== OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME) return wrongTool(call.name, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  if (!isPlainRecord(raw)) return fieldOutput("TYPE_MISMATCH", "offer:object-required", [], "object", raw);
  // The bystander views this selection may load are a second enumeration of
  // the same tool; a saved response is read by the same rule as a live one.
  const requestable = context === undefined ? [] : proposalNpcRecall(context).requestableRefs;
  const handles = context === undefined ? [] : proposalKnowledgeRecall(context, shownNpcRefs);
  const keys = ["requestedCapabilities", ...(requestable.length === 0 ? [] : ["requestedNpcRefs"]), ...(handles.length === 0 ? [] : ["requestedKnowledgeRefs"])];
  if (!Object.hasOwn(raw, "requestedCapabilities") || Object.keys(raw).some(key => !keys.includes(key))) return invalidOutput(new VNextProposalBundleOutputError([
    ...(Object.hasOwn(raw, "requestedCapabilities") ? [] : [proposalDiagnostic("FIELD_MISSING", "offer:schema-request-field-required",
      { path: ["requestedCapabilities"], pathBase: "arguments", expected: { required: true }, actual: diagnosticActual(undefined) })]),
    ...Object.keys(raw).filter(key => !keys.includes(key)).map(key => proposalDiagnostic("VALUE_INVALID", "offer:schema-request-additional-field",
      { path: [key], pathBase: "arguments", expected: { allowedFields: keys }, actual: diagnosticActual(raw[key]) })),
  ]));
  const requested = raw.requestedCapabilities;
  if (!Array.isArray(requested)) return fieldOutput(requested === undefined ? "FIELD_MISSING" : "TYPE_MISMATCH", "offer:requested-capabilities-array-required", ["requestedCapabilities"], "array", requested);
  const allowed = vnextProposalSchemaRequestIds(context);
  if (requested.length === 0 || requested.length > allowed.length) return fieldOutput("VALUE_INVALID", "offer:requested-capabilities-size",
    ["requestedCapabilities"], { minItems: 1, maxItems: allowed.length }, requested);
  for (const [index, id] of requested.entries()) {
    if (typeof id !== "string") return fieldOutput("TYPE_MISMATCH", "offer:capability-id-string-required", ["requestedCapabilities", index], { type: "string" }, id);
    if (requested.indexOf(id) !== index) return fieldOutput("VALUE_INVALID", "offer:requested-capabilities-unique", ["requestedCapabilities", index], { uniqueItems: true }, id);
  }
  const npcRefsRaw = raw.requestedNpcRefs;
  if (npcRefsRaw !== undefined) {
    if (!Array.isArray(npcRefsRaw)) return fieldOutput("TYPE_MISMATCH", "offer:requested-npc-refs-array-required", ["requestedNpcRefs"], "array", npcRefsRaw);
    for (const [index, ref] of npcRefsRaw.entries()) {
      if (typeof ref !== "string") return fieldOutput("TYPE_MISMATCH", "offer:npc-ref-string-required", ["requestedNpcRefs", index], { type: "string" }, ref);
      if (npcRefsRaw.indexOf(ref) !== index) return fieldOutput("VALUE_INVALID", "offer:requested-npc-refs-unique", ["requestedNpcRefs", index], { uniqueItems: true }, ref);
      if (!requestable.includes(ref)) return fieldOutput("VALUE_INVALID", "offer:requested-npc-ref-not-requestable", ["requestedNpcRefs", index], { enum: [...requestable] }, ref);
    }
  }
  const npcRefs = Array.isArray(npcRefsRaw) ? npcRefsRaw as string[] : [];
  const knowledgeRaw = raw.requestedKnowledgeRefs;
  const knowledgeRefs: string[] = [];
  if (knowledgeRaw !== undefined) {
    if (!Array.isArray(knowledgeRaw)) return fieldOutput("TYPE_MISMATCH", "offer:requested-knowledge-refs-array-required", ["requestedKnowledgeRefs"], "array", knowledgeRaw);
    for (const [index, handle] of knowledgeRaw.entries()) {
      if (typeof handle !== "string") return fieldOutput("TYPE_MISMATCH", "offer:knowledge-handle-string-required", ["requestedKnowledgeRefs", index], { type: "string" }, handle);
      if (knowledgeRaw.indexOf(handle) !== index) return fieldOutput("VALUE_INVALID", "offer:requested-knowledge-refs-unique", ["requestedKnowledgeRefs", index], { uniqueItems: true }, handle);
      const record = handles.find(entry => entry.handle === handle);
      if (record === undefined) return fieldOutput("VALUE_INVALID", "offer:requested-knowledge-handle-unknown", ["requestedKnowledgeRefs", index], { enum: handles.map(entry => entry.handle) }, handle);
      knowledgeRefs.push(record.entryRef);
    }
  }
  try { return deepFreeze({ kind: "schemaRequested", ...closeVNextProposalSchemaRequest(requested, context, npcRefs, knowledgeRefs) }); }
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
      if (capability === undefined || !capabilities.includes(capability)) invalidOutput(new VNextProposalBundleOutputError([
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
  const ruling = (value: Record<string, unknown>) => isPlainRecord(value.adjudication)
    || (isPlainRecord(value.decision) && (value.decision.kind === "directSuccess" || value.decision.kind === "check"));
  return proposalFrames(draft).some(({ value }) => selected(value) || selected(value.terminal) || selected(value.decision)
    || (ruling(value) && vnextProposalHasThirdCallBudget(capabilities))
    || (Array.isArray(value.proposals) && value.proposals.length > 0)
    || proposalFillingSteps(value.steps).length > 0);
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

export async function invokeVNextProposalOffer(input: Readonly<{
  binding: AuthoritativeModelBinding; modelId: string; message: string; requiredContext: VNextRequiredContext;
}>): Promise<VNextProposalSchemaRequest | Extract<VNextProposalBundleProviderResult, { kind: "rejected" }>> {
  if (typeof input.modelId !== "string" || !input.modelId.trim()) throw new TypeError("VNEXT_PROPOSAL_MODEL_ID_REQUIRED");
  const contextHash = input.requiredContext?.binding?.contextHash;
  if (typeof contextHash !== "string" || !contextHash) throw new TypeError("VNEXT_PROPOSAL_CONTEXT_HASH_REQUIRED");
  const response = await input.binding.run(input.modelId,
    createVNextProposalOfferModelInput(input.message, input.requiredContext));
  try {
    return parseVNextProposalOfferResponse(response, input.requiredContext);
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
): VNextProposalBundleCandidate {
  const parsed = readProposalArguments(value, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  return candidateForArguments(parsed.raw, value);
}

function readProposalArguments(value: unknown, _toolName: string): { raw: unknown } {
  if (typeof value !== "string") return { raw: value };
  try { return { raw: parseJsonObjectIgnoringTrailingClosers(value) }; } catch (error) { return invalidOutput(error); }
}

function candidateForArguments(raw: unknown, originalArguments?: unknown): VNextProposalBundleCandidate {
  if (!isPlainRecord(raw)) return fieldOutput("TYPE_MISMATCH", "proposal:object-required", [], "object", raw);
  if ("schema" in raw || "kind" in raw) return invalidOutput(new VNextProposalBundleOutputError([
    ...["schema", "kind"].filter(key => Object.hasOwn(raw, key)).map(key => proposalDiagnostic("CONSTRAINT_CONFLICT", "proposal:server-owned-envelope", { pathBase: "arguments", path: [key], expected: "absent from model arguments" })),
  ]));
  let decoded: unknown;
  try { decoded = decodeVNextStrictToolBundle(raw); }
  catch (error) { return invalidOutput(error); }
  if (!isPlainRecord(decoded)) return invalidOutput();
  let draft: JsonRecord;
  try {
    draft = canonicalClone({
      ...decoded,
      schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
      kind: "proposalBundle",
    }) as JsonRecord;
  } catch (error) {
    return invalidOutput(error);
  }
  const validated = validateVNextProposalBundle(draft);
  if (validated.kind === "accepted") {
    return deepFreeze({
      kind: "accepted",
      bundle: validated.bundle,
      bundleHash: canonicalHash(validated.bundle),
    });
  }
  return deepFreeze({
    kind: "locallyRejected",
    draft,
    bundleHash: canonicalHash(draft),
    validationCode: validated.kind === "rejected" ? validated.code : "PROPOSAL_WIRE_INVALID",
    diagnostics: validated.kind === "rejected" ? socialResultArgumentDiagnostics(draft,
      validated.diagnostics ?? diagnosticsFromIssues(validated.code, validated.issues), raw) : [],
    issues: validated.kind === "rejected" ? validated.issues : [],
    originalArguments: typeof originalArguments === "string" ? originalArguments : JSON.stringify(raw),
    argumentSource: typeof originalArguments === "string" ? "rawString" : "decodedObject",
  });
}

export function parseSubmitKpProposalBundleCandidateResponse(
  response: unknown,
): VNextProposalBundleCandidate {
  let call: ReturnType<typeof extractSingleToolCall>;
  try {
    call = extractProposalToolCall(response);
  } catch (error) {
    return invalidOutput(error);
  }
  if (call.name !== SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) return wrongTool(call.name, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  return parseSubmitKpProposalBundleCandidateArguments(call.arguments);
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
  const requested = parseVNextProposalOfferResponse(response, context, npcRefs);
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

function revisionSynthesis(response: unknown, source: ProposalRevisionSource): ProposalRevisionSynthesis {
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
export function vnextProposalTicketIsEmptyDraft(ticket: Pick<VNextProposalBundleRepairTicket, "sourceDraft">): boolean {
  return ticket.sourceDraft !== null && Object.keys(ticket.sourceDraft).length === 0;
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
      synthesis === undefined ? candidate.diagnostics : proposalFillingDiagnostics(candidate.draft, candidate.diagnostics, synthesis.draft));
    if (requiredContext === undefined) return { ...(synthesis === undefined ? {} : { synthesis }), result: rejected };
    const repairTicket = createRepairTicket(candidate, requiredContext, ticket.capabilities, ticket.terminalKinds, ticket.npcRefs, ticket.knowledgeRefs, ticket.round + 1);
    if (!vnextProposalCorrectionAdmitted([...priorTickets, ticket, repairTicket])) return { ...(synthesis === undefined ? {} : { synthesis }), result: rejected };
    return { ...(synthesis === undefined ? {} : { synthesis }), result: deepFreeze({ kind: "repairRequired", repairTicket, invocationCount: 2 }) };
  };
  if (vnextProposalTicketIsEmptyDraft(ticket)) {
    try {
      const candidate = vnextProposalRevisionCandidate(response, ticket.capabilities, ticket.terminalKinds);
      return candidate.kind === "accepted" ? accepted(candidate) : next(candidate);
    } catch (error) {
      if (!(error instanceof VNextProposalBundleOutputError)) throw error;
      return { result: providerRejected("PROPOSAL_REPAIR_EXHAUSTED", error.diagnostics.map(d => d.constraint), true, 2, error.diagnostics) };
    }
  }
  let synthesis: ProposalRevisionSynthesis | undefined;
  try {
    synthesis = revisionSynthesis(response, ticket);
    const candidate = vnextProposalRevisionCandidate({ choices: [{ message: { tool_calls: [{ type: "function",
      function: { name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: JSON.stringify(synthesis.draft) } }] } }] }, ticket.capabilities, ticket.terminalKinds);
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
  terminalKinds?: readonly string[]): VNextProposalBundleCandidate {
  let parsed: VNextProposalBundleCandidate | undefined;
  try {
    const candidate = parsed = parseSubmitKpProposalBundleCandidateResponse(response);
    assertVNextProposalCandidateCapabilities(candidate, capabilities, terminalKinds);
    return candidate;
  } catch (error) {
    if (!(error instanceof VNextProposalBundleOutputError)) throw error;
    const call = extractProposalToolCall(response);
    if (call.name !== SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) throw error;
    let raw: unknown;
    try { raw = typeof call.arguments === "string" ? parseJsonObjectIgnoringTrailingClosers(call.arguments) : call.arguments; }
    catch { throw error; }
    if (!isPlainRecord(raw) || Object.hasOwn(raw, "requestedCapabilities")) throw error;
    let draft: JsonRecord;
    try { draft = canonicalClone(parsed === undefined ? raw : parsed.kind === "accepted" ? parsed.bundle : parsed.draft) as JsonRecord; } catch { throw error; }
    // A step of a type the selection did not load is reported beside the
    // filling's other problems, not only once they are all fixed (round 115
    // spent its three rounds on those and then met this). The validator's
    // own diagnostics are kept beside the capability check that followed.
    const unloaded = parsed !== undefined || !isPlainRecord(raw.steps) ? [] : Object.entries(raw.steps).flatMap(([key, rows]) => {
      const capability = VNEXT_FILLING_STEP_KEYS.find(id => id === key);
      return capability === undefined || capabilities.includes(capability) || !(Array.isArray(rows) && rows.length > 0) ? []
        : [proposalDiagnostic("CONSTRAINT_CONFLICT", "proposal:capability-not-loaded",
          { path: ["steps", key], pathBase: "arguments", expected: { enum: capabilities }, actual: diagnosticActual(rows) })];
    });
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
  const handles = proposalKnowledgeRecall(requiredContext, npcRefs).filter(record => !knowledgeRefs.includes(record.entryRef)).map(record => record.handle);
  const response = await input.binding.run(
    input.modelId,
    createSubmitKpProposalBundleModelInput(input.message, capabilities, proposalItemEntryRefs(view), proposalObservationSubjectRefs(view), input.terminalKinds, proposalNpcSourceChoices(view), requiredContextBasisReferences(view), proposalCreatureTargetRefs(view), input.amendable === true, proposalItemDefinitionRefs(view), input.amendable === true ? requestable : [], input.amendable === true ? handles : []),
    runOptions,
  );
  if (input.amendable === true) {
    const amendment = vnextProposalAmendmentRequest(response, capabilities, input.terminalKinds, npcRefs, requiredContext, knowledgeRefs);
    if (amendment !== undefined) return deepFreeze({ kind: "amendmentRequested", amendment, invocationCount: 1 });
    if (vnextProposalCalledSelectionTool(response)) return deepFreeze({ kind: "selectionRepeated", invocationCount: 1 });
  }
  let candidate: VNextProposalBundleCandidate;
  try {
    candidate = vnextProposalRevisionCandidate(response, capabilities, input.terminalKinds);
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
      repairTicket: createVNextUnparsedRevisionTicket(unparsed, requiredContext, capabilities, input.terminalKinds ?? VNEXT_INITIAL_PROPOSAL_DECISION_KINDS, npcRefs, knowledgeRefs) });
    return providerRejected(
      "PROPOSAL_FORM_INVALID",
      error.diagnostics.map(d => d.constraint),
      false,
      1,
      error.diagnostics,
    );
  }
  return firstPassForCandidate(candidate, requiredContext, capabilities, input.terminalKinds, npcRefs, knowledgeRefs);
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
    createVNextProposalRevisionModelInput(chain, requiredContext), input.signal === undefined ? undefined : { signal: input.signal });
  return evaluateVNextProposalRevisionResponse(response, ticket, requiredContext, chain.slice(0, -1));
}

/** The request the chain's last ticket sends: the filling request its
 * conversation began with, then each ticket of that conversation as a turn.
 * A re-emit ticket sends the original filling request instead. A single
 * ticket is a chain of one. */
export function createVNextProposalRevisionModelInput(chain: VNextCorrectionChain | VNextProposalBundleRepairTicket, requiredContext: VNextRequiredContext) {
  const tickets = Array.isArray(chain) ? chain as VNextCorrectionChain : [chain as VNextProposalBundleRepairTicket];
  const current = tickets[tickets.length - 1];
  if (current === undefined) throw new TypeError("VNEXT_PROPOSAL_CORRECTION_CHAIN_REQUIRED");
  const view = proposalContextView(requiredContext, current.npcRefs, current.knowledgeRefs);
  const contextBody = vnextProposalContextBody(requiredContext, current.npcRefs, current.knowledgeRefs);
  const selection = [current.capabilities, proposalItemEntryRefs(view), proposalObservationSubjectRefs(view), current.terminalKinds,
    proposalNpcSourceChoices(view), requiredContextBasisReferences(view), proposalCreatureTargetRefs(view), false, proposalItemDefinitionRefs(view)] as const;
  if (vnextProposalTicketIsEmptyDraft(current)) return createSubmitKpProposalBundleModelInput(contextBody, ...selection);
  return createCorrectKpProposalBundleModelInput(contextBody, vnextProposalCorrectionConversation(tickets).map(ticket => ({
    call: { id: `call_${ticket.round}`, name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: ticket.originalArguments },
    content: "", body: vnextProposalCorrectionPrompt(ticket, requiredContext) })), ...selection);
}

/** Both the Provider and Room bind this exact private body to a proved ticket.
 * It carries the repair round's own material only; the frozen context is sent
 * once, by the shared context block this body follows. The draft a round
 * revises is the assistant turn just before it, so it is not spelled out;
 * null means that turn did not parse and only replacement is allowed. */
export function vnextProposalCorrectionPrompt(candidate: VNextProposalBundleRepairTicket, requiredContext: VNextRequiredContext): string {
  return JSON.stringify({ contextHash: proposalModelContext(requiredContext, candidate.npcRefs, candidate.knowledgeRefs).contextHash,
    responseProtocol: VNEXT_PROPOSAL_REVISION_PROTOCOL,
    round: candidate.round, roundsRemaining: VNEXT_PROPOSAL_CORRECTION_ROUNDS - candidate.round,
    instruction: VNEXT_PROPOSAL_GUIDANCE_POLICY.recoveryInstructions.correction,
    sourceDraftVersion: candidate.sourceDraftVersion, sourceDraft: candidate.sourceDraft === null ? null : "asReplied",
    diagnostics: proposalFillingDiagnostics(candidate.draft, candidate.diagnostics, candidate.sourceDraft),
    // Handles the draft used that no step produced, with the loaded type whose
    // step declares one. The model either adds that step (its form is in this
    // request) or replaces the handle with a listed existing reference.
    producerCompletion: vnextProposalDanglingHandles(candidate.draft)
      .filter(entry => candidate.capabilities.includes(entry.capability))
      .map(entry => ({ handle: entry.handle, producerKind: entry.kind, loadedType: entry.capability })),
    allowedModes: candidate.sourceDraft === null ? ["replaceDraft"] : ["patch", "replaceDraft"] });
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

/** The source passed local validation. Only Room can prove the later Rules
 * rejection and admit this ticket before any confirmation, dice or execution. */
export function createVNextAuthorityRevisionTicket(response: unknown, requiredContext: VNextRequiredContext,
  capabilities: readonly VNextProposalCapabilityId[], terminalKinds: readonly string[], diagnostics: readonly ProposalDiagnostic[],
  npcRefs: readonly string[] = [], knowledgeRefs: readonly string[] = [], round = 1) {
  const candidate = vnextProposalRevisionCandidate(response, capabilities, terminalKinds);
  if (candidate.kind !== "accepted" || diagnostics.length === 0) throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_INVALID");
  const call = extractProposalToolCall(response);
  return createRepairTicket({ kind: "locallyRejected", draft: candidate.bundle as unknown as JsonRecord,
    bundleHash: candidate.bundleHash, validationCode: "PROPOSAL_RULES_DIAGNOSTIC",
    diagnostics, issues: diagnostics.map(detail => detail.constraint),
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
    || canonicalHash([...new Set(ticket.npcRefs as string[])].sort(compareCodeUnits)) !== canonicalHash(ticket.npcRefs)
    || !Array.isArray(ticket.knowledgeRefs) || ticket.knowledgeRefs.some(ref => typeof ref !== "string")
    || canonicalHash([...new Set(ticket.knowledgeRefs as string[])].sort(compareCodeUnits)) !== canonicalHash(ticket.knowledgeRefs)
    || (ticket.argumentSource !== "rawString" && ticket.argumentSource !== "decodedObject")
    || (requiredContext !== undefined && (requiredContext.binding.contextHash !== contextHash
      || canonicalHash(proposalModelContext(requiredContext, ticket.npcRefs as string[], ticket.knowledgeRefs as string[])) !== ticket.modelContextHash))) return invalid();
  try {
    if (canonicalHash(closeVNextProposalCapabilities(ticket.capabilities)) !== canonicalHash(ticket.capabilities)
      || !ticket.terminalKinds.every(kind => typeof kind === "string" && VNEXT_INITIAL_PROPOSAL_DECISION_KINDS.includes(kind))) return invalid();
    if (ticket.sourceDraftVersion !== proposalSourceDraftVersion(ticket.originalArguments, contextHash)) return invalid();
    if (ticket.sourceDraft === null) {
      const evidence = vnextProposalUnparsedArguments({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ type: "function",
        function: { name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: ticket.originalArguments } }] } }] });
      if (!evidence || ticket.validationCode !== "PROPOSAL_JSON_INVALID" || ticket.argumentSource !== "rawString"
        || ticket.bundleHash !== canonicalHash(null) || canonicalHash(ticket.draft) !== canonicalHash({})
        || canonicalHash(ticket.issues) !== canonicalHash([evidence.diagnostic.constraint])
        || canonicalHash(ticket.diagnostics) !== canonicalHash([{ ...evidence.diagnostic,
          repair: { allowed: true, reason: "uncommitted-proposal-may-be-revised-once" } }])) return invalid();
      const { ticketHash, ...body } = ticket;
      if (ticketHash !== canonicalHash(body)) return invalid();
      return;
    }
    if (canonicalHash(ticket.sourceDraft) !== canonicalHash(parseJsonObjectIgnoringTrailingClosers(ticket.originalArguments))) return invalid();
    const proven = vnextProposalRevisionCandidate({ choices: [{ message: { tool_calls: [{ type: "function", function: {
      name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: ticket.argumentSource === "rawString"
        ? ticket.originalArguments : parseJsonObjectIgnoringTrailingClosers(ticket.originalArguments),
    } }] } }] }, ticket.capabilities as VNextProposalCapabilityId[], ticket.terminalKinds as string[]);
    if (ticket.validationCode === "PROPOSAL_RULES_DIAGNOSTIC") {
      // Hashes bind the supplied evidence; the Room journal must still prove
      // these diagnostics against Rules before granting a provider call.
      if (proven.kind !== "accepted" || proven.bundleHash !== ticket.bundleHash
        || canonicalHash(proven.bundle) !== canonicalHash(ticket.draft)
        || !Array.isArray(ticket.diagnostics) || ticket.diagnostics.length === 0
        || ticket.diagnostics.some(detail => !isPlainRecord(detail) || typeof detail.constraint !== "string")
        || canonicalHash(ticket.diagnostics.map(detail => detail.constraint)) !== canonicalHash(ticket.issues)) return invalid();
    } else if (ticket.validationCode === "PROPOSAL_REVISION_INVALID") {
      // The draft is the one an earlier round revised, unchanged, so its own
      // diagnostics lead and are re-derived here; the failed reply's are
      // appended, and only Room can prove them from the reply it saved.
      const derived = proven.kind === "accepted" ? [] : vnextProposalModelRepairDiagnostics(proven.draft, proven.diagnostics, proven.originalArguments);
      if (proven.bundleHash !== ticket.bundleHash
        || canonicalHash(proven.kind === "accepted" ? proven.bundle : proven.draft) !== canonicalHash(ticket.draft)
        || !Array.isArray(ticket.diagnostics) || ticket.diagnostics.length <= derived.length
        || canonicalHash(ticket.diagnostics.slice(0, derived.length)) !== canonicalHash(derived)
        || ticket.diagnostics.some(detail => !isPlainRecord(detail) || typeof detail.constraint !== "string")
        || canonicalHash(ticket.diagnostics.map(detail => detail.constraint)) !== canonicalHash(ticket.issues)) return invalid();
    } else if (proven.kind !== "locallyRejected" || proven.bundleHash !== ticket.bundleHash
      || canonicalHash(proven.draft) !== canonicalHash(ticket.draft) || proven.argumentSource !== ticket.argumentSource
      || proven.validationCode !== ticket.validationCode || canonicalHash(proven.issues) !== canonicalHash(ticket.issues)
      || canonicalHash(vnextProposalModelRepairDiagnostics(proven.draft, proven.diagnostics, proven.originalArguments)) !== canonicalHash(ticket.diagnostics)) return invalid();
    const { ticketHash, ...body } = ticket;
    if (ticketHash !== canonicalHash(body)) return invalid();
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
  if (error instanceof ProposalFillingError) throw new VNextProposalBundleOutputError(
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
