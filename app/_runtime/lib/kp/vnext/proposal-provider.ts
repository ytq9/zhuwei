import { ProposalFillingError, socialSourceArgumentDiagnostics, proposalIntentEchoArgumentDiagnostics, proposalDecisionFieldArgumentPath } from "./proposal-filling-interface";
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
  completeJsonObjectSyntaxEvidence,
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
  VNEXT_PROPOSAL_SCHEMA_REQUEST_IDS,
  closeVNextProposalSchemaRequest, type VNextProposalSchemaSelection,
  vnextSelectedProposalDecisionKinds,
  VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
  VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA,
  VNEXT_PROPOSAL_PLAN_CONFIRMATION_PROTOCOL,
  createCorrectKpProposalBundleModelInput,
  createSubmitKpProposalBundleModelInput,
  createVNextProposalOfferModelInput,
  decodeVNextStrictToolBundle,
  type VNextBundleCorrection,
  type VNextProposalBundle,
} from "./proposal-schema";
import {
  applyVNextProposalBundleCorrection,
  repairableVNextProposalBundlePaths,
  vnextProposalRepairPlan, vnextProposalRepairDiagnostics, type VNextProposalRepair,
} from "./proposal-correction";
import type { VNextRequiredContext } from "./required-context";
import { proposalCreatureTargetRefs, proposalItemEntryRefs, proposalObservationSubjectRefs, proposalNpcSourceChoices } from "./proposal-context";

/** The canonical repair proof is unchanged; source diagnostics retain the
 * model's exact choice location after the representation transform. */
export function vnextProposalModelRepairDiagnostics(...args: Parameters<typeof vnextProposalRepairDiagnostics>) {
  return proposalIntentEchoArgumentDiagnostics(args[0], socialSourceArgumentDiagnostics(args[0], vnextProposalRepairDiagnostics(...args)));
}
import { validateVNextProposalBundle } from "./proposal-validator";
import { requiredContextBasisReferences } from "./required-context-runtime";
import { closeVNextProposalCapabilities, VNEXT_PROPOSAL_CAPABILITIES, VNEXT_PROPOSAL_CAPABILITY_IDS,
  UnknownVNextProposalCapabilityError, vnextProposalCapabilityForEntry, type VNextProposalCapabilityId } from "./proposal-capabilities";

export const VNEXT_PROPOSAL_BUNDLE_PARSER_CONTRACT = Object.freeze({
  version: "kp-vnext2-proposal-parser-v41",
  offerToolName: OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  schemaRetrieval: "full-filling-boundaries-at-selection-then-selected-forms-amendable-once-v5",
  toolName: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  bundleSchema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
  correctionToolName: CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  correctionSchema: CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA,
  sentinelVersion: "decision-v2-server-assembled-results-and-typed-dependencies",
  requiresExactToolCall: true,
  allowsTextFallback: false,
  rejectsDuplicateJsonMembersAtEveryDepth: true,
  injectsBundleAndCorrectionEnvelopes: true,
  localValidation: "closed-domain-typed-authored-canonical-time-passage-and-npc-plans-v6",
  referenceSelection: "frozen-authorized-read-bound-basis-and-classed-visible-subjects-v3",
  correctionPolicy: "server-proven-plan-confirmation-exact-number-and-frozen-intent-echo-once-v9",
  unparsedOutputPolicy: "journal-proved-single-reemit-of-the-same-question-no-server-content-v1",
  correctionResponseProtocol: VNEXT_PROPOSAL_PLAN_CONFIRMATION_PROTOCOL,
});

export const VNEXT_PROPOSAL_BUNDLE_REPAIR_TICKET_SCHEMA =
  "zhuwei.kp-proposal-bundle-repair-ticket/vnext-5" as const;

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
      syntaxEvidence?: VNextProposalSyntaxEvidence;
      originalArguments: string;
      argumentSource: "rawString" | "decodedObject";
    }>;

type VNextProposalSyntaxEvidence = Readonly<{
  toolName: typeof SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME;
  originalArguments: string;
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
 * native operations still need the same separately proved narrow repair. */
export function vnextProposalHasExecutionRepairBudget(draft: Readonly<JsonRecord>, capabilities: readonly VNextProposalCapabilityId[]): boolean {
  const selected = (entry: unknown) => {
    const id = vnextProposalCapabilityForEntry(entry);
    return id !== undefined && capabilities.includes(id);
  };
  return proposalFrames(draft).some(({ value }) => selected(value) || selected(value.terminal)
    || (Array.isArray(value.proposals) && value.proposals.some(selected)));
}

/** Whether this selection carries the third call at all. A terminal-only
 * selection spends its two calls on the selection and the proposal, so it has
 * no slot for a correction and none for a re-emit either. Unlike the repair
 * budget this reads the selection, because an unparsed response leaves no
 * draft to read. */
export function vnextProposalHasThirdCallBudget(capabilities: readonly VNextProposalCapabilityId[]): boolean {
  return capabilities.some(id => {
    const capability = VNEXT_PROPOSAL_CAPABILITIES.find(entry => entry.id === id);
    return capability !== undefined && !("surface" in capability && capability.surface === "native");
  });
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
  // Check every saved branch even if another field needs a narrow repair.
  for (const { value, path } of proposalFrames(bundle)) {
    if (isPlainRecord(value.adjudication) && value.adjudication.kind === "highRisk")
      fieldOutput("CONSTRAINT_CONFLICT", "proposal:adjudication-outside-runtime-surface", [...path, "adjudication", "kind"],
        ["directSuccess", "check"], value.adjudication.kind);
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
  validationCode: "PROPOSAL_BUNDLE_INVALID" | "BUNDLE_DEPENDENCY_INVALID" | "PROPOSAL_JSON_INVALID" | "PROPOSAL_WIRE_INVALID";
  issues: readonly string[];
  diagnostics: readonly ProposalDiagnostic[];
  allowedPaths: readonly (readonly (string | number)[])[];
  repairPlan: readonly VNextProposalRepair[];
  syntaxEvidence?: VNextProposalSyntaxEvidence;
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
      /** Nothing parsed, so there is no draft to repair and nothing to keep.
       * The only bounded continuation is asking the model to restate its own
       * decision as valid JSON; the server contributes no content. */
      kind: "reemitRequired";
      unparsed: VNextProposalUnparsedArguments;
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
  return candidateForArguments(parsed.raw, parsed.syntaxEvidence, value);
}

function readProposalArguments(value: unknown, toolName: VNextProposalSyntaxEvidence["toolName"]): {
  raw: unknown; syntaxEvidence?: VNextProposalSyntaxEvidence;
} {
  if (typeof value !== "string") return { raw: value };
  try { return { raw: parseJsonWithUniqueMembers(value) }; }
  catch (error) {
    try {
      const evidence = completeJsonObjectSyntaxEvidence(value);
      return { raw: evidence.value, syntaxEvidence: { toolName, originalArguments: value } };
    } catch { return invalidOutput(error); }
  }
}

function candidateForArguments(raw: unknown, syntaxEvidence?: VNextProposalSyntaxEvidence, originalArguments?: unknown): VNextProposalBundleCandidate {
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
  if (validated.kind === "accepted" && syntaxEvidence === undefined) {
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
    validationCode: syntaxEvidence !== undefined ? "PROPOSAL_JSON_INVALID"
      : validated.kind === "rejected" ? validated.code : "PROPOSAL_WIRE_INVALID",
    diagnostics: [
      ...(syntaxEvidence === undefined ? [] : [syntaxDiagnostic(completeJsonObjectSyntaxEvidence(syntaxEvidence.originalArguments).diagnostic)]),
      ...(validated.kind === "rejected" ? socialSourceArgumentDiagnostics(draft, validated.diagnostics ?? diagnosticsFromIssues(validated.code, validated.issues)) : []),
    ],
    issues: [...(syntaxEvidence === undefined ? [] : [completeJsonObjectSyntaxEvidence(syntaxEvidence.originalArguments).issue]),
      ...(validated.kind === "rejected" ? validated.issues : [])],
    ...(syntaxEvidence === undefined ? {} : { syntaxEvidence }),
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

/** The saved response carried the right tool but arguments that are not JSON
 * and cannot be recovered as a complete root object, so no draft exists at all.
 *
 * This is deliberately derived from the response alone: the Provider and Room
 * reach the identical conclusion from the same saved bytes, so a re-emit is
 * proved by the journal rather than asserted by whoever asks for it. A draft
 * that did parse is never in scope here — that is a repair ticket's business,
 * and the server must not guess what a malformed one meant. */
export function vnextProposalUnparsedArguments(response: unknown): VNextProposalUnparsedArguments | undefined {
  let call: ReturnType<typeof extractSingleToolCall>;
  try { call = extractSingleToolCall(response); } catch { return undefined; }
  if (call.name !== SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME || typeof call.arguments !== "string") return undefined;
  // A re-emit spends a real call, so it needs positive evidence that one can
  // help: the model must have finished on its own. `length` means the output
  // hit the cap and the same request would hit it again, and an envelope with
  // no stated reason is not the documented shape -- neither earns the call.
  const choice = isPlainRecord(response) && Array.isArray(response.choices) ? response.choices[0] : undefined;
  const finished = isPlainRecord(choice) ? choice.finish_reason : undefined;
  if (typeof finished !== "string" || finished === "length") return undefined;
  try { parseJsonWithUniqueMembers(call.arguments); return undefined; } catch (error) {
    if (!(error instanceof JsonSyntaxError)) return undefined;
    // Well-formed JSON that this parser rejects on policy -- duplicate members
    // at any depth -- is a draft the server can see and must refuse, not an
    // absent one. Only bytes that are not JSON at all leave nothing to repair.
    try { JSON.parse(call.arguments); return undefined; } catch { /* not JSON */ }
    try { completeJsonObjectSyntaxEvidence(call.arguments); return undefined; } catch { /* unrecoverable */ }
    return deepFreeze({ toolName: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
      originalArguments: call.arguments, diagnostic: syntaxDiagnostic(error) });
  }
}

/** Both the Provider and Room bind this exact private body to the same saved
 * unparsed response. The server states only where the bytes stopped being JSON;
 * it never restates, guesses or repairs the decision, and the re-emitted draft
 * is validated from scratch like any first draft. */
export function vnextProposalReemitPrompt(evidence: VNextProposalUnparsedArguments): string {
  return JSON.stringify({
    instruction: "上一次工具调用的 arguments 不是合法 JSON，服务器无法解析出任何草稿，因此没有任何内容被保留或修复。请用同一个工具、同一份冻结上下文，重新完整提交你原本的决定，只需保证输出是合法 JSON：字符串内部的双引号和反斜杠必须转义，不要使用尾随逗号，不要截断。这不是让你改变裁决——重述你本来的决定，不要因为这次失败而换一个更容易写的方案。完整提案仍会从头重验。",
    syntaxError: { reason: evidence.diagnostic.constraint, ...(evidence.diagnostic.location === undefined ? {} : { location: evidence.diagnostic.location }) },
    originalArguments: evidence.originalArguments,
  });
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

export function parseCorrectKpProposalBundleResponse(
  response: unknown,
  binding: Readonly<{ baseBundleHash: string; contextHash: string }>,
): VNextBundleCorrection {
  let call: ReturnType<typeof extractSingleToolCall>;
  try { call = extractSingleToolCall(response); } catch (error) { return invalidOutput(error); }
  if (call.name !== CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME) return wrongTool(call.name, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  let raw: unknown = call.arguments;
  if (typeof raw === "string") {
    try { raw = parseJsonWithUniqueMembers(raw); } catch (error) { return invalidOutput(error); }
  }
  if (!isPlainRecord(raw)) return fieldOutput("TYPE_MISMATCH", "correction:object-required", [], "object", raw);
  // Legacy changes-only responses are not converted into confirmations.
  assertCorrectionKeys(raw, ["confirm", "summaries"], [], "correction:exact-envelope-keys");
  if (raw.confirm !== "server-plan") return fieldOutput("VALUE_INVALID", "correction:confirmation-required", ["confirm"], "server-plan", raw.confirm);
  if (!Array.isArray(raw.summaries)) return fieldOutput("TYPE_MISMATCH", "correction:summaries-array-required", ["summaries"], "array", raw.summaries);
  if (raw.summaries.length > 8) return fieldOutput("VALUE_INVALID", "correction:change-budget", ["summaries"], { maximumItems: 8 }, raw.summaries);
  const seen = new Set<string>();
  for (const [index, summary] of raw.summaries.entries()) {
    if (!isPlainRecord(summary)) return fieldOutput("TYPE_MISMATCH", "correction:summary-object-required", ["summaries", index], "object", summary);
    assertCorrectionKeys(summary, ["path", "value"], ["summaries", index], "correction:exact-summary-keys");
    if (!correctionPathConforms(summary.path)) return fieldOutput("VALUE_INVALID", "correction:path-shape", ["summaries", index, "path"], "1..16 string keys or nonnegative integer indices", summary.path);
    const identity = canonicalHash(summary.path);
    if (seen.has(identity)) throw new VNextProposalBundleOutputError([
      proposalDiagnostic("REPAIR_OUT_OF_SCOPE", "correction:path-not-allowed", { path: summary.path,
        repair: { allowed: false, reason: "summary-path-must-be-unique" } }),
    ]);
    seen.add(identity);
    if (typeof summary.value !== "string") return fieldOutput("TYPE_MISMATCH", "correction:summary-text-required", ["summaries", index, "value"], "string", summary.value);
  }
  try {
    return deepFreeze(canonicalClone({ schema: VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA,
      baseBundleHash: binding.baseBundleHash, contextHash: binding.contextHash, attempt: 1 as const,
      changes: raw.summaries,
    }) as VNextBundleCorrection);
  } catch (error) { return invalidOutput(error); }
}

/** Exact free-value coverage is checked before the immutable fixed plan is
 * combined with it. The original apply path re-proves every resulting edit. */
function confirmedPlanCorrection(candidate: VNextProposalBundleRepairTicket, correction: VNextBundleCorrection): VNextBundleCorrection {
  const summaryPaths = candidate.repairPlan.filter(change => change.operation !== "remove" && !Object.hasOwn(change, "value")).map(change => change.path);
  const allowed = new Set(summaryPaths.map(path => canonicalHash(path)));
  const supplied = new Set(correction.changes.map(change => canonicalHash(change.path)));
  const diagnostics: ProposalDiagnostic[] = [];
  for (const change of correction.changes) if (!allowed.has(canonicalHash(change.path))) diagnostics.push(
    proposalDiagnostic("REPAIR_OUT_OF_SCOPE", "correction:path-not-allowed", { path: change.path,
      expected: { summaryPaths }, repair: { allowed: false, reason: "only-free-summary-paths-may-be-supplied" } }));
  for (const path of summaryPaths) if (!supplied.has(canonicalHash(path))) diagnostics.push(
    proposalDiagnostic("FIELD_MISSING", "correction:summary-required", { path, expected: "one presentation summary of the frozen operations",
      repair: { allowed: false, reason: "all-free-summaries-required-in-the-single-confirmation" } }));
  if (diagnostics.length > 0) throw new VNextProposalBundleOutputError(diagnostics);
  const fixed = candidate.repairPlan.flatMap(change => Object.hasOwn(change, "value")
    ? [{ path: change.path, value: change.value as VNextBundleCorrection["changes"][number]["value"] }] : []);
  return deepFreeze({ ...correction, changes: [...fixed, ...correction.changes] });
}

function assertCorrectionKeys(value: Record<string, unknown>, keys: readonly string[],
  path: readonly (string | number)[], constraint: string): void {
  if (hasExactKeys(value, keys)) return;
  throw new VNextProposalBundleOutputError([
    ...keys.filter(key => !Object.hasOwn(value, key)).map(key => proposalDiagnostic("FIELD_MISSING", constraint,
      { path: [...path, key], expected: { required: true }, actual: diagnosticActual(undefined) })),
    ...Object.keys(value).filter(key => !keys.includes(key)).map(key => proposalDiagnostic("CONSTRAINT_CONFLICT", constraint,
      { path: [...path, key], expected: { allowedFields: keys }, actual: diagnosticActual(value[key]) })),
  ]);
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
    createSubmitKpProposalBundleModelInput(input.message, capabilities, proposalItemEntryRefs(requiredContext), proposalObservationSubjectRefs(requiredContext), input.terminalKinds, proposalNpcSourceChoices(requiredContext), requiredContextBasisReferences(requiredContext), proposalCreatureTargetRefs(requiredContext), input.amendable === true),
    runOptions,
  );
  if (input.amendable === true) {
    const amendment = vnextProposalAmendmentRequest(response, capabilities, input.terminalKinds);
    if (amendment !== undefined) return deepFreeze({ kind: "amendmentRequested", amendment, invocationCount: 1 });
  }
  let candidate: VNextProposalBundleCandidate;
  try {
    candidate = parseSubmitKpProposalBundleCandidateResponse(response);
    assertVNextProposalCandidateCapabilities(candidate, capabilities, input.terminalKinds);
  } catch (error) {
    if (!(error instanceof VNextProposalBundleOutputError)) throw error;
    const unparsed = vnextProposalUnparsedArguments(response);
    if (unparsed !== undefined) return deepFreeze({ kind: "reemitRequired", unparsed, invocationCount: 1 });
    return providerRejected(
      "PROPOSAL_FORM_INVALID",
      error.diagnostics.map(d => d.constraint),
      false,
      1,
      error.diagnostics,
    );
  }
  return firstPassForCandidate(candidate, requiredContext);
}

function firstPassForCandidate(candidate: VNextProposalBundleCandidate, requiredContext: VNextRequiredContext): VNextProposalBundleFirstPassResult {
  if (candidate.kind === "accepted") {
    return deepFreeze({
      kind: "locallyAccepted",
      bundle: candidate.bundle,
      bundleHash: candidate.bundleHash,
      repairUsed: false,
      invocationCount: 1,
    });
  }
  const proofDiagnostics: ProposalDiagnostic[] = [];
  const allowedPaths = vnextProposalRepairPlan(candidate.draft, proofDiagnostics, numericRepairSource(candidate), requiredContext).map(change => change.path);
  if (allowedPaths.length > 8) return providerRejected(
    "PROPOSAL_FORM_INVALID", [...candidate.issues, "repair:change-budget-exceeded"], false, 1,
    [...candidate.diagnostics, proposalDiagnostic("REPAIR_OUT_OF_SCOPE", "repair:change-budget-exceeded", {
      expected: { maximumChanges: 8 }, actual: { changes: allowedPaths.length },
      repair: { allowed: false, reason: "bounded-representation-repair-budget-exceeded" },
    })]);
  if (allowedPaths.length === 0 && !((candidate.syntaxEvidence !== undefined)
    && validateVNextProposalBundle(candidate.draft).kind === "accepted")) {
    const diagnostics = [...new Map(proposalIntentEchoArgumentDiagnostics(candidate.draft, socialSourceArgumentDiagnostics(candidate.draft, [...candidate.diagnostics, ...proofDiagnostics]))
      .map(detail => [canonicalHash(detail), detail])).values()];
    return providerRejected(
      "PROPOSAL_FORM_INVALID",
      [...new Set([...candidate.issues, ...proofDiagnostics.map(detail => detail.constraint)])],
      false,
      1,
      diagnostics,
    );
  }
  return deepFreeze({
    kind: "repairRequired",
    repairTicket: createRepairTicket(candidate, requiredContext, allowedPaths),
    invocationCount: 1,
  });
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
  // The request and its eventual confirmation share one immutable snapshot,
  // including when a resumed ticket came from a mutable JSON deserialization.
  const candidate = deepFreeze(canonicalClone(input.repairTicket)) as VNextProposalBundleRepairTicket;
  const correctionPrompt = vnextProposalCorrectionPrompt(candidate);
  const runOptions = input.signal === undefined ? undefined : { signal: input.signal };
  const correctionResponse = await input.binding.run(
    input.modelId,
    createCorrectKpProposalBundleModelInput(correctionPrompt),
    runOptions,
  );
  let correction: VNextBundleCorrection;
  try {
    correction = confirmedPlanCorrection(candidate, parseCorrectKpProposalBundleResponse(correctionResponse, {
      baseBundleHash: candidate.bundleHash,
      contextHash,
    }));
  } catch (error) {
    if (!(error instanceof VNextProposalBundleOutputError)) throw error;
    return providerRejected(
      "PROPOSAL_REPAIR_EXHAUSTED",
      error.diagnostics.map(d => d.constraint),
      true,
      2,
      error.diagnostics,
    );
  }
  // A transport-only acknowledgement consumes the same single correction call.
  // The ticket was re-proved above; still revalidate the entire frozen Bundle.
  if ((candidate.syntaxEvidence !== undefined) && candidate.allowedPaths.length === 0) {
    if (correction.changes.length > 0) return providerRejected("PROPOSAL_REPAIR_EXHAUSTED",
      ["correction:path-not-allowed"], true, 2, correction.changes.map(change =>
        proposalDiagnostic("REPAIR_OUT_OF_SCOPE", "correction:path-not-allowed", { path: change.path,
          expected: { allowedPaths: [] }, repair: { allowed: false, reason: "transport-confirmation-cannot-edit-frozen-decisions" } })));
    const validated = validateVNextProposalBundle(candidate.draft);
    if (validated.kind === "accepted") return deepFreeze({
      kind: "locallyAccepted", bundle: validated.bundle,
      bundleHash: canonicalHash(validated.bundle), repairUsed: true, invocationCount: 2,
    });
  }
  const repaired = applyVNextProposalBundleCorrection({
    bundle: candidate.draft,
    correction,
    requiredContext,
    allowedPaths: candidate.allowedPaths,
    ...(numericRepairSource(candidate) === undefined ? {} : { originalArguments: candidate.originalArguments }),
  });
  if (repaired.kind === "rejected") {
    return providerRejected(
      "PROPOSAL_REPAIR_EXHAUSTED",
      repaired.issues,
      true,
      2,
      repaired.diagnostics,
    );
  }
  return deepFreeze({
    kind: "locallyAccepted",
    bundle: repaired.bundle,
    bundleHash: repaired.bundleHash,
    repairUsed: true,
    invocationCount: 2,
  });
}

/** Both the Provider and Room bind this exact private body to a proved ticket. */
export function vnextProposalCorrectionPrompt(candidate: VNextProposalBundleRepairTicket): string {
  return JSON.stringify({
    responseProtocol: VNEXT_PROPOSAL_PLAN_CONFIRMATION_PROTOCOL,
    instruction: "审核当前冻结草稿、diagnostics、repairPlan及表示证据后，用confirm:'server-plan'明确同意本请求的完整固定修复计划。服务器按同一已重证计划执行所有固定value字段修复及已证明的remove删除，并确认syntaxEvidence，不要求你复制path/value。summaries必须完整且只包含summaryPaths中的每个路径一次；没有自由摘要时填[]。摘要只表达原稿中已有操作，不新增事实、裁决、目标、DC、成本、后果或玩家决定；结构校验不证明自由摘要文字的语义。不得返回changes、固定patch、新Proposal或schema请求。原草稿、冻结上下文和全部裁决保持绑定，完整提案仍会从头重验。",
    summaryPaths: candidate.repairPlan.filter(change => change.operation !== "remove" && !Object.hasOwn(change, "value")).map(change => change.path),
    baseBundleHash: candidate.bundleHash,
    contextHash: candidate.contextHash,
    issues: candidate.issues,
    diagnostics: candidate.diagnostics,
    repairPlan: candidate.repairPlan.map(change => change.operation === "remove"
      ? { ...change, path: proposalDecisionFieldArgumentPath(candidate.draft, change.path) ?? change.path } : change),
    allowedPaths: candidate.repairPlan.map(change => change.operation === "remove"
      ? proposalDecisionFieldArgumentPath(candidate.draft, change.path) ?? change.path : change.path),
    rejectedBundle: candidate.draft,
    ...(candidate.syntaxEvidence === undefined ? {} : { syntaxEvidence: candidate.syntaxEvidence }),
    originalArguments: candidate.originalArguments,
    argumentSource: candidate.argumentSource,
  });
}

/** Convenience orchestration that makes durable persistence an explicit gate
 * between the only main call and the optional correction call. */
/** One re-emit of a draft that never parsed. The tool surface is the same one
 * the first call carried, so the model answers the same question with the same
 * frozen context; only the user body differs, and it says nothing about the
 * decision. The result is validated from scratch and gets no further call. */
export async function invokeReemitKpProposalBundle(
  input: Readonly<{
    binding: AuthoritativeModelBinding;
    modelId: string;
    requiredContext: VNextRequiredContext;
    unparsed: VNextProposalUnparsedArguments;
    capabilities?: readonly VNextProposalCapabilityId[];
    terminalKinds?: readonly string[];
    signal?: AbortSignal;
  }>,
): Promise<VNextProposalBundleProviderResult> {
  const requiredContext = deepFreeze(canonicalClone(input.requiredContext)) as VNextRequiredContext;
  const capabilities = closeVNextProposalCapabilities(input.capabilities ?? VNEXT_PROPOSAL_CAPABILITY_IDS);
  const response = await input.binding.run(
    input.modelId,
    createSubmitKpProposalBundleModelInput(vnextProposalReemitPrompt(input.unparsed), capabilities,
      proposalItemEntryRefs(requiredContext), proposalObservationSubjectRefs(requiredContext), input.terminalKinds,
      proposalNpcSourceChoices(requiredContext), requiredContextBasisReferences(requiredContext),
      proposalCreatureTargetRefs(requiredContext)),
    input.signal === undefined ? undefined : { signal: input.signal },
  );
  let candidate: VNextProposalBundleCandidate;
  try {
    candidate = parseSubmitKpProposalBundleCandidateResponse(response);
    assertVNextProposalCandidateCapabilities(candidate, capabilities, input.terminalKinds);
  } catch (error) {
    if (!(error instanceof VNextProposalBundleOutputError)) throw error;
    return providerRejected("PROPOSAL_FORM_INVALID", error.diagnostics.map(d => d.constraint), false, 2, error.diagnostics);
  }
  if (candidate.kind !== "accepted") {
    return providerRejected("PROPOSAL_FORM_INVALID", candidate.issues, false, 2, candidate.diagnostics);
  }
  // A re-emit is not a repair: nothing was carried over, so `repairUsed` stays
  // false and only the invocation count records the extra call.
  return deepFreeze({ kind: "locallyAccepted", bundle: candidate.bundle,
    bundleHash: candidate.bundleHash, repairUsed: false, invocationCount: 2 });
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
  if (firstPass.kind === "reemitRequired") {
    return invokeReemitKpProposalBundle({ binding: input.binding, modelId: input.modelId,
      requiredContext: input.requiredContext, unparsed: firstPass.unparsed,
      capabilities: input.capabilities, terminalKinds: input.terminalKinds, signal: input.signal });
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

function createRepairTicket(
  candidate: Extract<VNextProposalBundleCandidate, { kind: "locallyRejected" }>,
  requiredContext: VNextRequiredContext,
  allowedPaths: readonly (readonly (string | number)[])[],
): VNextProposalBundleRepairTicket {
  const body = canonicalClone({
    schema: VNEXT_PROPOSAL_BUNDLE_REPAIR_TICKET_SCHEMA,
    draft: candidate.draft,
    bundleHash: candidate.bundleHash,
    contextHash: requiredContext.binding.contextHash,
    validationCode: candidate.validationCode,
    issues: candidate.issues,
    diagnostics: vnextProposalModelRepairDiagnostics(candidate.draft, candidate.diagnostics, candidate.syntaxEvidence !== undefined, numericRepairSource(candidate), requiredContext),
    repairPlan: vnextProposalRepairPlan(candidate.draft, undefined, numericRepairSource(candidate), requiredContext),
    allowedPaths,
    ...(candidate.syntaxEvidence === undefined ? {} : { syntaxEvidence: candidate.syntaxEvidence }),
    originalArguments: candidate.originalArguments,
    argumentSource: candidate.argumentSource,
  }) as Omit<VNextProposalBundleRepairTicket, "ticketHash">;
  return deepFreeze({ ...body, ticketHash: canonicalHash(body) });
}

export function assertRepairTicket(ticket: unknown, contextHash: string, requiredContext?: VNextRequiredContext): asserts ticket is VNextProposalBundleRepairTicket {
  if (!isPlainRecord(ticket)
    || !hasExactKeys(ticket, [
      "allowedPaths", "bundleHash", "contextHash", "draft", "issues", "diagnostics", "repairPlan", "schema", "originalArguments",
      "ticketHash", "validationCode", "argumentSource", ...(ticket.syntaxEvidence === undefined ? [] : ["syntaxEvidence"]),
    ])
    || ticket.schema !== VNEXT_PROPOSAL_BUNDLE_REPAIR_TICKET_SCHEMA
    || ticket.contextHash !== contextHash
    || (requiredContext !== undefined && requiredContext.binding?.contextHash !== contextHash)
    || typeof ticket.originalArguments !== "string"
    || (ticket.argumentSource !== "rawString" && ticket.argumentSource !== "decodedObject")
    || !isPlainRecord(ticket.draft)
    || ticket.bundleHash !== canonicalHash(ticket.draft)
    || (ticket.validationCode !== "PROPOSAL_BUNDLE_INVALID"
      && ticket.validationCode !== "BUNDLE_DEPENDENCY_INVALID"
      && ticket.validationCode !== "PROPOSAL_JSON_INVALID" && ticket.validationCode !== "PROPOSAL_WIRE_INVALID")
    || !Array.isArray(ticket.issues)
    || !ticket.issues.every((issue) => typeof issue === "string" && issue.length > 0)
    || !Array.isArray(ticket.allowedPaths) || !Array.isArray(ticket.diagnostics) || !Array.isArray(ticket.repairPlan)) {
    throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_INVALID");
  }
  try { assertRuntimeProposalSurface(ticket.draft); }
  catch { throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_INVALID"); }
  const allowedPaths = repairableVNextProposalBundlePaths(ticket.draft, numericRepairSource(ticket), requiredContext);
  if (canonicalHash(allowedPaths) !== canonicalHash(ticket.allowedPaths)
    || canonicalHash(vnextProposalRepairPlan(ticket.draft, undefined, numericRepairSource(ticket), requiredContext)) !== canonicalHash(ticket.repairPlan)) {
    throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_INVALID");
  }
  let proven: VNextProposalBundleCandidate;
  try {
    const evidence = ticket.syntaxEvidence;
    if (evidence !== undefined && (!isPlainRecord(evidence) || !hasExactKeys(evidence, ["toolName", "originalArguments"])
      || evidence.originalArguments !== ticket.originalArguments
      || evidence.toolName !== SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME)) {
      throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_INVALID");
    }
    const parsed = readProposalArguments(ticket.originalArguments,
      (isPlainRecord(evidence) ? evidence.toolName : SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) as VNextProposalSyntaxEvidence["toolName"]);
    proven = candidateForArguments(parsed.raw, parsed.syntaxEvidence, numericRepairSource(ticket));
  } catch { throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_INVALID"); }
  if (proven.kind !== "locallyRejected" || proven.bundleHash !== ticket.bundleHash
    || proven.argumentSource !== ticket.argumentSource
    || canonicalHash(proven.syntaxEvidence ?? null) !== canonicalHash(ticket.syntaxEvidence ?? null)
    || (allowedPaths.length === 0 && (proven.syntaxEvidence === undefined || validateVNextProposalBundle(proven.draft).kind !== "accepted"))) {
    throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_INVALID");
  }
  const validation = { code: proven.validationCode, issues: proven.issues, diagnostics: proven.diagnostics };
  if (validation.code !== ticket.validationCode
    || canonicalHash(validation.issues) !== canonicalHash(ticket.issues)
    || canonicalHash(vnextProposalModelRepairDiagnostics(ticket.draft, validation.diagnostics ?? diagnosticsFromIssues(validation.code, validation.issues), ticket.syntaxEvidence !== undefined, numericRepairSource(ticket), requiredContext)) !== canonicalHash(ticket.diagnostics)) {
    throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_INVALID");
  }
  const { ticketHash, ...body } = ticket;
  if (typeof ticketHash !== "string" || ticketHash !== canonicalHash(body)) {
    throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_INVALID");
  }
}

function correctionPathConforms(value: unknown): value is readonly (string | number)[] {
  return Array.isArray(value)
    && value.length >= 1
    && value.length <= 16
    && value.every((segment) => (typeof segment === "string"
      && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(segment))
      || (Number.isSafeInteger(segment) && Number(segment) >= 0));
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

/** JSON.stringify of an already-decoded argument cannot prove the original
 * numeric lexeme. Only a raw source saved before parsing may authorize it. */
export function numericRepairSource(candidate: Readonly<{ argumentSource?: unknown; originalArguments?: unknown }>): string | undefined {
  return candidate.argumentSource === "rawString" && typeof candidate.originalArguments === "string"
    ? candidate.originalArguments : undefined;
}
