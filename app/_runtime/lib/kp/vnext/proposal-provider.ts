import { synthesizeProposalRevision, proposalSourceDraftVersion, ProposalRevisionError, type ProposalRevisionSource, type ProposalRevisionSynthesis } from "./proposal-revision";
import { ProposalFillingError, socialResultArgumentDiagnostics, proposalIntentEchoArgumentDiagnostics, proposalFillingDiagnostics } from "./proposal-filling-interface";
import { diagnosticsFromIssues, proposalDiagnostic, diagnosticActual, type ProposalDiagnostic } from "./proposal-diagnostics";
import type { AuthoritativeModelBinding } from "../authoritative-types";
import {
  ModelOutputValidationError,
  extractSingleToolCall,
} from "../authoritative-helpers";
import {
  canonicalClone,
  canonicalHash,
  compareCodeUnits,
  deepFreeze,
  isPlainRecord,
  parseJsonWithUniqueMembers,
  JsonSyntaxError,
  type JsonRecord,
} from "./canonical-json";
import {
  CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA,
  CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  VNEXT_PROPOSAL_SCHEMA_REQUEST_IDS, VNEXT_INITIAL_PROPOSAL_DECISION_KINDS,
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
import { proposalCreatureTargetRefs, proposalItemDefinitionRefs, proposalItemEntryRefs, proposalObservationSubjectRefs, proposalNpcSourceChoices, proposalModelContext } from "./proposal-context";
import { VNEXT_PROPOSAL_GUIDANCE_POLICY } from "./proposal-guidance";

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

export const VNEXT_PROPOSAL_BUNDLE_PARSER_CONTRACT = Object.freeze({
  version: "kp-vnext2-proposal-parser-v57",
  fillingLayout: "three-flat-tables-decision-steps-results-social-four-typed-tables-continuations-same-tables-v3",
  socialResults: "required-relationshipChanges-newPromises-promiseChanges-newDebts-explicit-empty-arrays-no-mixed-consequences-v1",
  responseBasis: "closed-enum-on-a-plain-array-item-player-expression-as-a-member-anyof-only-with-a-producer-v1",
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
  correctionPolicy: "version-bound-atomic-json-patch-or-full-replacement-once-v11",
  unparsedOutputPolicy: "journal-proved-replacement-only-with-shared-revision-allowance-v5",
  correctionResponseProtocol: VNEXT_PROPOSAL_REVISION_PROTOCOL,
});

export const VNEXT_PROPOSAL_BUNDLE_REPAIR_TICKET_SCHEMA =
  "zhuwei.kp-proposal-bundle-repair-ticket/vnext-7" as const;

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
      validationCode: "PROPOSAL_BUNDLE_INVALID" | "BUNDLE_DEPENDENCY_INVALID" | "PROPOSAL_JSON_INVALID" | "PROPOSAL_WIRE_INVALID";
      issues: readonly string[];
      diagnostics: readonly ProposalDiagnostic[];
      originalArguments: string;
      argumentSource: "rawString" | "decodedObject";
    }>;

export type VNextProposalSchemaRequest = Readonly<{ kind: "schemaRequested" }> & VNextProposalSchemaSelection;

/** The first stage selects schemas only. Never reinterpret or salvage a draft
 * as a selection, including a syntactically repairable former offer shape. */
export function parseVNextProposalOfferResponse(response: unknown): VNextProposalSchemaRequest {
  let call: ReturnType<typeof extractSingleToolCall>, raw: unknown;
  try {
    call = extractSingleToolCall(response);
    raw = typeof call.arguments === "string" ? parseJsonWithUniqueMembers(call.arguments) : call.arguments;
  } catch (error) { return invalidOutput(error); }
  if (call.name !== OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME) return wrongTool(call.name, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  if (!isPlainRecord(raw)) return fieldOutput("TYPE_MISMATCH", "offer:object-required", [], "object", raw);
  const keys = ["requestedCapabilities"];
  if (!hasExactKeys(raw, keys)) return invalidOutput(new VNextProposalBundleOutputError([
    ...keys.filter(key => !Object.hasOwn(raw, key)).map(key => proposalDiagnostic("FIELD_MISSING", "offer:schema-request-field-required",
      { path: [key], pathBase: "arguments", expected: { required: true }, actual: diagnosticActual(undefined) })),
    ...Object.keys(raw).filter(key => !keys.includes(key)).map(key => proposalDiagnostic("VALUE_INVALID", "offer:schema-request-additional-field",
      { path: [key], pathBase: "arguments", expected: { allowedFields: keys }, actual: diagnosticActual(raw[key]) })),
  ]));
  const requested = raw.requestedCapabilities;
  if (!Array.isArray(requested)) return fieldOutput(requested === undefined ? "FIELD_MISSING" : "TYPE_MISMATCH", "offer:requested-capabilities-array-required", ["requestedCapabilities"], "array", requested);
  if (requested.length === 0 || requested.length > VNEXT_PROPOSAL_SCHEMA_REQUEST_IDS.length) return fieldOutput("VALUE_INVALID", "offer:requested-capabilities-size",
    ["requestedCapabilities"], { minItems: 1, maxItems: VNEXT_PROPOSAL_SCHEMA_REQUEST_IDS.length }, requested);
  for (const [index, id] of requested.entries()) {
    if (typeof id !== "string") return fieldOutput("TYPE_MISMATCH", "offer:capability-id-string-required", ["requestedCapabilities", index], { type: "string" }, id);
    if (requested.indexOf(id) !== index) return fieldOutput("VALUE_INVALID", "offer:requested-capabilities-unique", ["requestedCapabilities", index], { uniqueItems: true }, id);
  }
  try { return deepFreeze({ kind: "schemaRequested", ...closeVNextProposalSchemaRequest(requested) }); }
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

/** A third call is reserved for an actual selected execution family.
 * Selecting an unused step cannot buy another call for a terminal decision;
 * native operations use the same proved, bounded revision. */
export function vnextProposalHasExecutionRepairBudget(draft: Readonly<JsonRecord>, capabilities: readonly VNextProposalCapabilityId[]): boolean {
  const selected = (entry: unknown) => {
    const id = vnextProposalCapabilityForEntry(entry);
    return id !== undefined && capabilities.includes(id);
  };
  return proposalFrames(draft).some(({ value }) => selected(value) || selected(value.terminal) || selected(value.decision)
    || (Array.isArray(value.proposals) && value.proposals.some(selected))
    || (Array.isArray(value.steps) && value.steps.some(selected)));
}

/** Whether this selection carries the third call at all. A terminal-only
 * selection spends its two calls on the selection and the proposal, so it has
 * no slot for a correction and none for a re-emit either. Unlike the repair
 * budget this reads the selection, because an unparsed response leaves no
 * draft to read. */
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
    createVNextProposalOfferModelInput(input.message));
  try {
    return parseVNextProposalOfferResponse(response);
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
  validationCode: "PROPOSAL_BUNDLE_INVALID" | "BUNDLE_DEPENDENCY_INVALID" | "PROPOSAL_JSON_INVALID" | "PROPOSAL_WIRE_INVALID" | "PROPOSAL_RULES_DIAGNOSTIC";
  issues: readonly string[];
  diagnostics: readonly ProposalDiagnostic[];
  capabilities: readonly VNextProposalCapabilityId[];
  terminalKinds: readonly string[];
  modelContextHash: string;
  sourceDraft: Readonly<JsonRecord> | null;
  sourceDraftVersion: string;
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
    }>;

export function parseSubmitKpProposalBundleCandidateArguments(
  value: unknown,
): VNextProposalBundleCandidate {
  const parsed = readProposalArguments(value, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  return candidateForArguments(parsed.raw, value);
}

function readProposalArguments(value: unknown, _toolName: string): { raw: unknown } {
  if (typeof value !== "string") return { raw: value };
  try { return { raw: parseJsonWithUniqueMembers(value) }; } catch (error) { return invalidOutput(error); }
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
    call = extractSingleToolCall(response);
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
  try { call = extractSingleToolCall(response); } catch { return undefined; }
  if (call.name !== SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME || typeof call.arguments !== "string") return undefined;
  const choice = isPlainRecord(response) && Array.isArray(response.choices) ? response.choices[0] : undefined;
  const finished = isPlainRecord(choice) ? choice.finish_reason : undefined;
  if (typeof finished !== "string" || finished === "length") return undefined;
  try { parseJsonWithUniqueMembers(call.arguments); return undefined; }
  catch (error) {
    if (!(error instanceof JsonSyntaxError)) return undefined;
    try { JSON.parse(call.arguments); return undefined; } catch { /* invalid syntax */ }
    return deepFreeze({ toolName: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
      originalArguments: call.arguments, diagnostic: syntaxDiagnostic(error) });
  }
}

export function createVNextUnparsedRevisionTicket(evidence: VNextProposalUnparsedArguments,
  requiredContext: VNextRequiredContext, capabilities: readonly VNextProposalCapabilityId[], terminalKinds: readonly string[]) {
  return createRepairTicket({ kind: "locallyRejected", draft: {}, bundleHash: canonicalHash(null),
    validationCode: "PROPOSAL_JSON_INVALID", issues: [evidence.diagnostic.constraint], diagnostics: [evidence.diagnostic],
    originalArguments: evidence.originalArguments, argumentSource: "rawString" }, requiredContext, capabilities, terminalKinds);
}

export type VNextProposalAmendment = Readonly<{
  requestedCapabilities: readonly VNextProposalCapabilityId[];
  requestedTerminalKinds: readonly string[];
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
  terminalKinds: readonly string[] = []): VNextProposalAmendment | undefined {
  let call: ReturnType<typeof extractSingleToolCall>;
  try { call = extractSingleToolCall(response); } catch { return undefined; }
  if (call.name !== OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME) return undefined;
  const requested = parseVNextProposalOfferResponse(response);
  const current = closeVNextProposalCapabilities(capabilities);
  const amended = closeVNextProposalCapabilities([...new Set([...current, ...requested.capabilities])]);
  const amendedTerminals = [...new Set([...terminalKinds, ...requested.terminalKinds])].sort(compareCodeUnits);
  // An amendment that adds nothing is a wasted call, not a continuation.
  if (amended.length === current.length && amendedTerminals.length === terminalKinds.length) return undefined;
  return deepFreeze({ requestedCapabilities: requested.capabilities, requestedTerminalKinds: requested.terminalKinds,
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
    const call = extractSingleToolCall(response);
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
export function evaluateVNextProposalRevisionResponse(response: unknown, ticket: VNextProposalBundleRepairTicket): Readonly<{
  synthesis?: ProposalRevisionSynthesis; result: VNextProposalBundleProviderResult;
}> {
  let synthesis: ProposalRevisionSynthesis | undefined;
  try {
    synthesis = revisionSynthesis(response, ticket);
    const candidate = vnextProposalRevisionCandidate({ choices: [{ message: { tool_calls: [{ type: "function",
      function: { name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: JSON.stringify(synthesis.draft) } }] } }] }, ticket.capabilities, ticket.terminalKinds);
    if (candidate.kind !== "accepted") return { synthesis, result: providerRejected("PROPOSAL_REPAIR_EXHAUSTED", candidate.issues, true, 2,
      proposalFillingDiagnostics(candidate.draft, candidate.diagnostics, synthesis.draft)) };
    return { synthesis, result: deepFreeze({ kind: "locallyAccepted", bundle: candidate.bundle, bundleHash: candidate.bundleHash,
      repairUsed: true, invocationCount: 2 }) };
  } catch (error) {
    if (!(error instanceof VNextProposalBundleOutputError)) throw error;
    return { ...(synthesis === undefined ? {} : { synthesis }),
      result: providerRejected("PROPOSAL_REPAIR_EXHAUSTED", error.diagnostics.map(d => d.constraint), true, 2, error.diagnostics) };
  }
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
    const call = extractSingleToolCall(response);
    if (call.name !== SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) throw error;
    let raw: unknown;
    try { raw = typeof call.arguments === "string" ? parseJsonWithUniqueMembers(call.arguments) : call.arguments; }
    catch { throw error; }
    if (!isPlainRecord(raw) || Object.hasOwn(raw, "requestedCapabilities")) throw error;
    let draft: JsonRecord;
    try { draft = canonicalClone(parsed === undefined ? raw : parsed.kind === "accepted" ? parsed.bundle : parsed.draft) as JsonRecord; } catch { throw error; }
    return deepFreeze({ kind: "locallyRejected", draft, bundleHash: canonicalHash(draft),
      validationCode: "PROPOSAL_WIRE_INVALID", issues: error.diagnostics.map(d => d.constraint), diagnostics: error.diagnostics,
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
  const response = await input.binding.run(
    input.modelId,
    createSubmitKpProposalBundleModelInput(input.message, capabilities, proposalItemEntryRefs(requiredContext), proposalObservationSubjectRefs(requiredContext), input.terminalKinds, proposalNpcSourceChoices(requiredContext), requiredContextBasisReferences(requiredContext), proposalCreatureTargetRefs(requiredContext), input.amendable === true, proposalItemDefinitionRefs(requiredContext)),
    runOptions,
  );
  if (input.amendable === true) {
    const amendment = vnextProposalAmendmentRequest(response, capabilities, input.terminalKinds);
    if (amendment !== undefined) return deepFreeze({ kind: "amendmentRequested", amendment, invocationCount: 1 });
  }
  let candidate: VNextProposalBundleCandidate;
  try {
    candidate = vnextProposalRevisionCandidate(response, capabilities, input.terminalKinds);
  } catch (error) {
    if (!(error instanceof VNextProposalBundleOutputError)) throw error;
    const unparsed = vnextProposalUnparsedArguments(response);
    if (unparsed !== undefined) return deepFreeze({ kind: "repairRequired", invocationCount: 1,
      repairTicket: createVNextUnparsedRevisionTicket(unparsed, requiredContext, capabilities, input.terminalKinds ?? VNEXT_INITIAL_PROPOSAL_DECISION_KINDS) });
    return providerRejected(
      "PROPOSAL_FORM_INVALID",
      error.diagnostics.map(d => d.constraint),
      false,
      1,
      error.diagnostics,
    );
  }
  return firstPassForCandidate(candidate, requiredContext, capabilities, input.terminalKinds);
}

function firstPassForCandidate(candidate: VNextProposalBundleCandidate, requiredContext: VNextRequiredContext,
  capabilities: readonly VNextProposalCapabilityId[], terminalKinds?: readonly string[]): VNextProposalBundleFirstPassResult {
  if (candidate.kind === "accepted") return deepFreeze({ kind: "locallyAccepted", bundle: candidate.bundle,
    bundleHash: candidate.bundleHash, repairUsed: false, invocationCount: 1 });
  return deepFreeze({ kind: "repairRequired",
    repairTicket: createRepairTicket(candidate, requiredContext, capabilities, terminalKinds), invocationCount: 1 });
}

/** Runs the one permitted correction against an already-persisted ticket. */
export async function invokeCorrectKpProposalBundle(input: Readonly<{
  binding: AuthoritativeModelBinding;
  modelId: string;
  requiredContext: VNextRequiredContext;
  repairTicket: VNextProposalBundleRepairTicket;
  signal?: AbortSignal;
}>): Promise<VNextProposalBundleProviderResult> {
  if (typeof input.modelId !== "string" || input.modelId.trim().length === 0) {
    throw new TypeError("VNEXT_PROPOSAL_MODEL_ID_REQUIRED");
  }
  const contextHash = input.requiredContext?.binding?.contextHash;
  if (typeof contextHash !== "string" || contextHash.length === 0) {
    throw new TypeError("VNEXT_PROPOSAL_CONTEXT_HASH_REQUIRED");
  }
  const requiredContext = deepFreeze(canonicalClone(input.requiredContext)) as VNextRequiredContext;
  assertRepairTicket(input.repairTicket, contextHash, requiredContext);
  const ticket = deepFreeze(canonicalClone(input.repairTicket)) as VNextProposalBundleRepairTicket;
  const response = await input.binding.run(input.modelId,
    createVNextProposalRevisionModelInput(ticket, requiredContext), input.signal === undefined ? undefined : { signal: input.signal });
  return evaluateVNextProposalRevisionResponse(response, ticket).result;
}

export function createVNextProposalRevisionModelInput(ticket: VNextProposalBundleRepairTicket, requiredContext: VNextRequiredContext) {
  return createCorrectKpProposalBundleModelInput(vnextProposalCorrectionPrompt(ticket, requiredContext), ticket.capabilities,
    proposalItemEntryRefs(requiredContext), proposalObservationSubjectRefs(requiredContext), ticket.terminalKinds,
    proposalNpcSourceChoices(requiredContext), requiredContextBasisReferences(requiredContext),
    proposalCreatureTargetRefs(requiredContext), false, proposalItemDefinitionRefs(requiredContext));
}

/** Both the Provider and Room bind this exact private body to a proved ticket. */
export function vnextProposalCorrectionPrompt(candidate: VNextProposalBundleRepairTicket, requiredContext: VNextRequiredContext): string {
  return JSON.stringify({ requiredContext: proposalModelContext(requiredContext),
    responseProtocol: VNEXT_PROPOSAL_REVISION_PROTOCOL,
    instruction: VNEXT_PROPOSAL_GUIDANCE_POLICY.recoveryInstructions.correction,
    sourceDraftVersion: candidate.sourceDraftVersion, sourceDraft: candidate.sourceDraft,
    diagnostics: proposalFillingDiagnostics(candidate.draft, candidate.diagnostics, candidate.sourceDraft),
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
  if (firstPass.kind === "amendmentRequested") {
    // Unreachable: this orchestration never offers the selection tool. Fail
    // closed rather than let an unexpected shape reach a caller as a bundle.
    return providerRejected("PROPOSAL_FORM_INVALID", ["selection:amendment-not-offered"], false, 1,
      [proposalDiagnostic("CONSTRAINT_CONFLICT", "selection:amendment-not-offered",
        { repair: { allowed: false, reason: "amendment-requires-the-room-orchestrated-path" } })]);
  }
  if (firstPass.kind !== "repairRequired") return firstPass;
  await input.persistRepairTicket(firstPass.repairTicket);
  return invokeCorrectKpProposalBundle({
    binding: input.binding,
    modelId: input.modelId,
    requiredContext: input.requiredContext,
    repairTicket: firstPass.repairTicket,
    signal: input.signal,
  });
}

/** The source passed local validation. Only Room can prove the later Rules
 * rejection and admit this ticket before any confirmation, dice or execution. */
export function createVNextAuthorityRevisionTicket(response: unknown, requiredContext: VNextRequiredContext,
  capabilities: readonly VNextProposalCapabilityId[], terminalKinds: readonly string[], diagnostics: readonly ProposalDiagnostic[]) {
  const candidate = vnextProposalRevisionCandidate(response, capabilities, terminalKinds);
  if (candidate.kind !== "accepted" || diagnostics.length === 0) throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_INVALID");
  const call = extractSingleToolCall(response);
  return createRepairTicket({ kind: "locallyRejected", draft: candidate.bundle as unknown as JsonRecord,
    bundleHash: candidate.bundleHash, validationCode: "PROPOSAL_RULES_DIAGNOSTIC",
    diagnostics, issues: diagnostics.map(detail => detail.constraint),
    originalArguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments),
    argumentSource: typeof call.arguments === "string" ? "rawString" : "decodedObject" }, requiredContext, capabilities, terminalKinds);
}

export function createRepairTicket(candidate: Omit<Extract<VNextProposalBundleCandidate, { kind: "locallyRejected" }>, "validationCode">
    & { validationCode: VNextProposalBundleRepairTicket["validationCode"] },
  requiredContext: VNextRequiredContext, capabilities: readonly VNextProposalCapabilityId[],
  terminalKinds: readonly string[] = VNEXT_INITIAL_PROPOSAL_DECISION_KINDS): VNextProposalBundleRepairTicket {
  const sourceDraft = candidate.validationCode === "PROPOSAL_JSON_INVALID" ? null
    : parseJsonWithUniqueMembers(candidate.originalArguments) as JsonRecord;
  const body = canonicalClone({ schema: VNEXT_PROPOSAL_BUNDLE_REPAIR_TICKET_SCHEMA,
    sourceDraft, sourceDraftVersion: proposalSourceDraftVersion(candidate.originalArguments, requiredContext.binding.contextHash),
    draft: candidate.draft, bundleHash: candidate.bundleHash, contextHash: requiredContext.binding.contextHash,
    modelContextHash: canonicalHash(proposalModelContext(requiredContext)), capabilities, terminalKinds,
    validationCode: candidate.validationCode, issues: candidate.issues,
    diagnostics: sourceDraft === null ? candidate.diagnostics.map(detail => ({ ...detail,
      repair: { allowed: true, reason: "uncommitted-proposal-may-be-revised-once" } }))
      : vnextProposalModelRepairDiagnostics(candidate.draft, candidate.diagnostics, candidate.originalArguments),
    originalArguments: candidate.originalArguments, argumentSource: candidate.argumentSource,
  }) as Omit<VNextProposalBundleRepairTicket, "ticketHash">;
  return deepFreeze({ ...body, ticketHash: canonicalHash(body) });
}

export function assertRepairTicket(ticket: unknown, contextHash: string, requiredContext?: VNextRequiredContext): asserts ticket is VNextProposalBundleRepairTicket {
  const invalid = (): never => { throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_INVALID"); };
  if (!isPlainRecord(ticket) || !hasExactKeys(ticket, ["schema", "draft", "bundleHash", "contextHash", "modelContextHash",
    "capabilities", "terminalKinds", "validationCode", "issues", "diagnostics", "originalArguments", "argumentSource", "ticketHash",
    "sourceDraft", "sourceDraftVersion"]) || ticket.schema !== VNEXT_PROPOSAL_BUNDLE_REPAIR_TICKET_SCHEMA
    || ticket.contextHash !== contextHash || typeof ticket.originalArguments !== "string" || !isPlainRecord(ticket.draft)
    || !Array.isArray(ticket.capabilities) || !Array.isArray(ticket.terminalKinds) || typeof ticket.modelContextHash !== "string"
    || (ticket.argumentSource !== "rawString" && ticket.argumentSource !== "decodedObject")
    || (requiredContext !== undefined && (requiredContext.binding.contextHash !== contextHash
      || canonicalHash(proposalModelContext(requiredContext)) !== ticket.modelContextHash))) return invalid();
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
    if (canonicalHash(ticket.sourceDraft) !== canonicalHash(parseJsonWithUniqueMembers(ticket.originalArguments))) return invalid();
    const proven = vnextProposalRevisionCandidate({ choices: [{ message: { tool_calls: [{ type: "function", function: {
      name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: ticket.argumentSource === "rawString"
        ? ticket.originalArguments : parseJsonWithUniqueMembers(ticket.originalArguments),
    } }] } }] }, ticket.capabilities as VNextProposalCapabilityId[], ticket.terminalKinds as string[]);
    if (ticket.validationCode === "PROPOSAL_RULES_DIAGNOSTIC") {
      // Hashes bind the supplied evidence; the Room journal must still prove
      // these diagnostics against Rules before granting a provider call.
      if (proven.kind !== "accepted" || proven.bundleHash !== ticket.bundleHash
        || canonicalHash(proven.bundle) !== canonicalHash(ticket.draft)
        || !Array.isArray(ticket.diagnostics) || ticket.diagnostics.length === 0
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
