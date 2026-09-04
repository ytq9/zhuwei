import {
  AUTHORITATIVE_KP_PROFILE,
  authoritativeKpProfileByBinding,
  isSocialResolutionKpProfile,
  isV3AuthoritativeKpProfile,
  kpCallStructuredOutputMode,
  NARRATION_TOOL_NAME,
} from "./authoritative-policy";
import {
  decodeKpFormStrictDraft,
  strictDraftSentinelMisuse,
  type KpStructuredOutputMode,
} from "./form-strict-tool";
import {
  compileKpFormDraft,
  lowerCausalActionProgram,
  stableStructuralHash,
} from "./causal-action-program";
import {
  canonicalCompoundCompositionJson,
  parseCompoundCompositionJson,
  validateCompoundCompositionDraft,
  type CompoundCompositionDraft,
  type CompoundCompositionOperation,
  type CompoundWorldConsequence,
} from "./compound-composition";
import {
  KP_FORM_IDS,
  kpFormIdForToolName,
  kpFormToolName,
  selectAllowedKpForms,
  validateKpFormDraft,
  type KpFormId,
} from "./form-catalog";
import {
  bodyOnlyNarrationGroundingReplacementModelInput,
  bodyOnlyNarrationModelInput,
  frozenClaimsNarrationGroundingReplacementModelInput,
  frozenClaimsNarrationModelInput,
  validateBodyOnlyNarrationOutput,
  validateFrozenClaimsNarrationOutput,
} from "./narration-v3";
import {
  privateFormProposalModelInput,
  privateFormRepairModelInput,
  type FiniteReferenceCatalog,
} from "./private-form-policy";
import {
  ACTOR_PLAN_DECISION_TOOL_NAME,
  actorPlanDecisionModelInput,
  validateActorPlanDecisionOutput,
} from "./actor-plan-policy";
import { HEALING_POTION_ITEM_DEFINITION_ID } from "../rules/profiles/item-system";
import { isCanonicalTacticalGeometry } from "../rules/profiles/tactical-geometry";
import { frozenRenderableClaimsConform } from "../rules/authority-read";
import { buildV3ContextPack, v3FormSelectionSignals } from "./v3-context-runtime";
import {
  ModelInvocationTimeoutError,
  ModelOutputValidationError,
  NarrationGroundingValidationError,
  audienceIdentity,
  canonicalJson,
  classifyModelError,
  extractSingleToolCall,
  extractStructuredOutput,
  isRecord,
  responseHash,
  retryAfterFrom,
  usageFrom,
} from "./authoritative-helpers";
import {
  KP_NARRATION_REQUEST_PURPOSES,
  KP_PROPOSAL_REQUEST_PURPOSES,
} from "./authoritative-types";
import type {
  AuthoritativeKpAdapter,
  AuthoritativeKpAdapterOptions,
  AuthoritativeKpProfile,
  DueActorPlanDecisionRequest,
  FrozenClaimsNarrationRequest,
  V3AuthoritativeKpProposal,
  KpNarrationRequest,
  KpNarrationRequestPurpose,
  KpProposalRequest,
  KpProposalRequestPurpose,
  ModelInvocationFailureStage,
  ModelInvocationPurpose,
  ModelInvocationReceipt,
  ModelInvocationResult,
} from "./authoritative-types";

export { AUTHORITATIVE_KP_PROFILE } from "./authoritative-policy";
export type {
  AuthoritativeKpAdapter,
  AuthoritativeKpAdapterOptions,
  AuthoritativeKpProfile,
  DueActorPlanDecision,
  DueActorPlanDecisionRequest,
  V3AuthoritativeKpProposal,
  CurrentNarration,
  KpNarrationRequest,
  KpNarrationRequestPurpose,
  KpProposalRequest,
  KpProposalRequestPurpose,
  ModelInvocationPurpose,
  ModelInvocationReceipt,
  ModelInvocationResult,
  AuthoritativeModelBinding,
} from "./authoritative-types";

const DEFAULT_INVOCATION_TIMEOUT_MS = 45_000;

type InvocationTask = "proposal" | "narration";

const KP_PROPOSAL_REQUEST_PURPOSE_SET = new Set<string>(KP_PROPOSAL_REQUEST_PURPOSES);
const KP_NARRATION_REQUEST_PURPOSE_SET = new Set<string>(KP_NARRATION_REQUEST_PURPOSES);

function isKpProposalRequestPurpose(value: unknown): value is KpProposalRequestPurpose {
  return typeof value === "string" && KP_PROPOSAL_REQUEST_PURPOSE_SET.has(value);
}

function isKpNarrationRequestPurpose(value: unknown): value is KpNarrationRequestPurpose {
  return typeof value === "string" && KP_NARRATION_REQUEST_PURPOSE_SET.has(value);
}

function proposalInvocationPurpose(request: KpProposalRequest): ModelInvocationPurpose {
  if (request?.attempt === 2) return "semanticRepair";
  return isKpProposalRequestPurpose(request?.proposalPurpose)
    ? request.proposalPurpose
    : "initialProposal";
}

function narrationInvocationPurpose(request: KpNarrationRequest): KpNarrationRequestPurpose {
  return isKpNarrationRequestPurpose(request?.narrationPurpose)
    ? request.narrationPurpose
    : "initialNarration";
}

function narrationGroundingRepairPurpose(
  purpose: KpNarrationRequestPurpose,
): ModelInvocationPurpose {
  return purpose === "narrationRecovery"
    ? "narrationRecoveryGroundingRepair"
    : "narrationGroundingRepair";
}

type InvocationSuccess = {
  response: unknown;
  receipt: ModelInvocationReceipt;
};

function stableErrorMessage(code: ModelInvocationResult): string {
  if (code === "modelPermanent") return "权威 KP 模型配置或输出无效。";
  if (code === "quotaExhausted") return "权威 KP 模型额度已用尽。";
  return "权威 KP 模型暂时不可用。";
}

export class AuthoritativeKpModelError extends Error {
  readonly code: Exclude<ModelInvocationResult, "success">;
  readonly modelInvocationReceipt: ModelInvocationReceipt;
  readonly retryAfter?: number;

  constructor(
    code: Exclude<ModelInvocationResult, "success">,
    modelInvocationReceipt: ModelInvocationReceipt,
    retryAfter?: number,
  ) {
    super(stableErrorMessage(code));
    this.name = "AuthoritativeKpModelError";
    this.code = code;
    this.modelInvocationReceipt = modelInvocationReceipt;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      ...(this.retryAfter !== undefined ? { retryAfter: this.retryAfter } : {}),
      modelInvocationReceipt: this.modelInvocationReceipt,
    };
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ModelOutputValidationError();
  }
  return value;
}

function schemaVersion(profile: AuthoritativeKpProfile, task: InvocationTask): string {
  return task === "proposal"
    ? profile.proposalSchemaVersion
    : profile.narrationSchemaVersion;
}

function receipt(
  profile: AuthoritativeKpProfile,
  task: InvocationTask,
  rootActionId: string,
  attempt: number,
  invocationPurpose: ModelInvocationPurpose,
  startedAt: number,
  endedAt: number,
  result: ModelInvocationResult,
  additions: Partial<ModelInvocationReceipt> = {},
): ModelInvocationReceipt {
  return {
    provider: profile.provider,
    modelId: profile.modelId,
    modelRevision: profile.modelRevision,
    modelProfileVersion: profile.modelProfileVersion,
    promptPolicyVersion: profile.promptPolicyVersion,
    schemaVersion: schemaVersion(profile, task),
    task,
    invocationPurpose,
    rootActionId,
    attempt,
    startedAt,
    endedAt,
    result,
    ...additions,
  };
}

function permanentContractError(
  profile: AuthoritativeKpProfile,
  task: InvocationTask,
  rootActionId: string,
  attempt: number,
  invocationPurpose: ModelInvocationPurpose,
  now: () => number,
): AuthoritativeKpModelError {
  const at = now();
  return new AuthoritativeKpModelError(
    "modelPermanent",
    receipt(
      profile,
      task,
      rootActionId,
      attempt,
      invocationPurpose,
      at,
      at,
      "modelPermanent",
    ),
  );
}

function validateV3ProposalRequest(request: KpProposalRequest): void {
  requiredString(request.preparedActionId);
  requiredString(request.rootActionId);
  if (!Number.isInteger(request.attempt) || request.attempt < 1 || request.attempt > 2) {
    throw new ModelOutputValidationError();
  }
  if (
    request.proposalPurpose !== undefined
    && !isKpProposalRequestPurpose(request.proposalPurpose)
  ) throw new ModelOutputValidationError();
  if (!isRecord(request.input) || !isRecord(request.projection)) {
    throw new ModelOutputValidationError();
  }
  if (request.attempt === 2 && (request.diagnostics === undefined || !isRecord(request.priorProposal))) {
    throw new ModelOutputValidationError();
  }
}

type PrivateFormEnvelope = {
  formId: KpFormId;
  draft: Record<string, unknown>;
};

class PrivateFormEnvelopeError extends Error {
  readonly candidate: unknown;
  readonly errors: readonly string[];

  constructor(candidate: unknown, errors: readonly string[]) {
    super("Private KP Form output is invalid.");
    this.name = "PrivateFormEnvelopeError";
    this.candidate = candidate;
    this.errors = errors;
  }
}

function unwrapSingleEnvelope(value: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(value);
  const only = keys.length === 1 ? value[keys[0]] : undefined;
  return isRecord(only) ? only : value;
}

const MAX_REJECTED_RAW_ARGUMENTS_LENGTH = 4_000;

function boundedRejectedRawArguments(
  value: unknown,
  kind: "unparseableJson" | "nonObjectJson" | "invalidArgumentsType",
): Readonly<{
  kind: "unparseableJson" | "nonObjectJson" | "invalidArgumentsType";
  value: string;
  truncated: boolean;
  originalLength: number;
}> {
  let serialized: string;
  if (typeof value === "string") serialized = value;
  else {
    try {
      serialized = canonicalJson(value);
    } catch {
      serialized = Object.prototype.toString.call(value);
    }
  }
  return Object.freeze({
    kind,
    value: serialized.slice(0, MAX_REJECTED_RAW_ARGUMENTS_LENGTH),
    truncated: serialized.length > MAX_REJECTED_RAW_ARGUMENTS_LENGTH,
    originalLength: serialized.length,
  });
}

type RecoveredTopLevelJsonMembers = Readonly<{
  members: ReadonlyMap<string, unknown>;
  duplicateKeys: ReadonlySet<string>;
}>;

function skipJsonWhitespace(source: string, start: number): number {
  let cursor = start;
  while (cursor < source.length
    && [" ", "\t", "\n", "\r"].includes(source[cursor]!)) cursor += 1;
  return cursor;
}

function jsonStringTokenEnd(source: string, start: number): number | undefined {
  if (source[start] !== "\"") return undefined;
  let escaped = false;
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const character = source[cursor]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "\"") return cursor + 1;
  }
  return undefined;
}

function jsonCompositeTokenEnd(source: string, start: number): number | undefined {
  const first = source[start];
  if (first !== "{" && first !== "[") return undefined;
  const expectedClosers = [first === "{" ? "}" : "]"];
  let cursor = start + 1;
  while (cursor < source.length) {
    const character = source[cursor]!;
    if (character === "\"") {
      const end = jsonStringTokenEnd(source, cursor);
      if (end === undefined) return undefined;
      cursor = end;
      continue;
    }
    if (character === "{" || character === "[") {
      expectedClosers.push(character === "{" ? "}" : "]");
      cursor += 1;
      continue;
    }
    if (character === "}" || character === "]") {
      if (expectedClosers.at(-1) !== character) return undefined;
      expectedClosers.pop();
      cursor += 1;
      if (expectedClosers.length === 0) return cursor;
      continue;
    }
    cursor += 1;
  }
  return undefined;
}

function jsonValueTokenEnd(source: string, start: number): number | undefined {
  if (source[start] === "\"") return jsonStringTokenEnd(source, start);
  if (source[start] === "{" || source[start] === "[") {
    return jsonCompositeTokenEnd(source, start);
  }
  let cursor = start;
  while (cursor < source.length
    && ![",", "}", " ", "\t", "\n", "\r"].includes(source[cursor]!)) cursor += 1;
  return cursor > start ? cursor : undefined;
}

/** Recover only complete direct members from an otherwise unparseable JSON
 * object. Nested lookalike keys never become direct members; duplicate direct
 * keys remain ambiguous and cannot prove frozen semantics. */
function recoverTopLevelJsonMembers(source: string): RecoveredTopLevelJsonMembers | undefined {
  let cursor = skipJsonWhitespace(source, 0);
  if (source[cursor] !== "{") return undefined;
  cursor += 1;
  const members = new Map<string, unknown>();
  const duplicateKeys = new Set<string>();
  while (true) {
    cursor = skipJsonWhitespace(source, cursor);
    if (cursor === source.length) return { members, duplicateKeys };
    if (source[cursor] === "}") {
      cursor = skipJsonWhitespace(source, cursor + 1);
      return cursor === source.length ? { members, duplicateKeys } : undefined;
    }

    const keyEnd = jsonStringTokenEnd(source, cursor);
    if (keyEnd === undefined) return undefined;
    let key: unknown;
    try {
      key = JSON.parse(source.slice(cursor, keyEnd));
    } catch {
      return undefined;
    }
    if (typeof key !== "string") return undefined;
    cursor = skipJsonWhitespace(source, keyEnd);
    if (source[cursor] !== ":") return undefined;
    cursor = skipJsonWhitespace(source, cursor + 1);

    const valueEnd = jsonValueTokenEnd(source, cursor);
    if (valueEnd === undefined) return undefined;
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(source.slice(cursor, valueEnd));
    } catch {
      return undefined;
    }
    if (members.has(key)) duplicateKeys.add(key);
    else members.set(key, parsedValue);
    cursor = skipJsonWhitespace(source, valueEnd);
    if (cursor === source.length) return { members, duplicateKeys };
    if (source[cursor] === ",") {
      cursor += 1;
      continue;
    }
    if (source[cursor] === "}") {
      cursor = skipJsonWhitespace(source, cursor + 1);
      return cursor === source.length ? { members, duplicateKeys } : undefined;
    }
    return undefined;
  }
}

function recoveredRawSemanticMembers(value: unknown): RecoveredTopLevelJsonMembers | undefined {
  if (!isRecord(value)
    || value.kind !== "unparseableJson"
    || value.truncated !== false
    || typeof value.value !== "string") return undefined;
  return recoverTopLevelJsonMembers(value.value);
}

/**
 * A strict draft carries every property, using the omitted sentinel wherever
 * the field does not apply, so it has to be decoded back to the ordinary
 * shape before anything downstream sees it: `validateKpFormDraft` rejects a
 * check field that is merely present on a `direct` draft, and the semantic
 * freeze hashes the draft as written. Decoding here keeps every later stage —
 * validation, freeze, Rules — unaware of which transport produced the draft.
 */
function decodeStrictDraft(
  formId: KpFormId,
  parsed: Record<string, unknown>,
): Record<string, unknown> {
  // A sentinel standing where a value belongs (an array element, say) is not
  // an omitted field and must not be silently dropped.
  const misuse = strictDraftSentinelMisuse(parsed);
  if (misuse.length > 0) {
    throw new PrivateFormEnvelopeError({ formId, draft: parsed }, misuse);
  }
  return decodeKpFormStrictDraft(parsed) as Record<string, unknown>;
}

function narrowToolDraft(
  formId: KpFormId,
  argumentsValue: unknown,
  structuredOutputMode: KpStructuredOutputMode = "tool",
): Record<string, unknown> {
  const decode = (parsed: Record<string, unknown>): Record<string, unknown> =>
    structuredOutputMode === "strict-tool"
      ? decodeStrictDraft(formId, structuredClone(parsed))
      : structuredClone(parsed);
  if (isRecord(argumentsValue)) return decode(argumentsValue);
  if (typeof argumentsValue === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(argumentsValue);
    } catch {
      throw new PrivateFormEnvelopeError({
        formId,
        draft: {},
        rejectedRawArguments: boundedRejectedRawArguments(
          argumentsValue,
          "unparseableJson",
        ),
      }, ["draft:json-parse-failed"]);
    }
    if (isRecord(parsed)) return decode(parsed);
    throw new PrivateFormEnvelopeError({
      formId,
      draft: {},
      rejectedRawArguments: boundedRejectedRawArguments(argumentsValue, "nonObjectJson"),
    }, ["draft:object-required"]);
  }
  throw new PrivateFormEnvelopeError({
    formId,
    draft: {},
    rejectedRawArguments: boundedRejectedRawArguments(
      argumentsValue,
      "invalidArgumentsType",
    ),
  }, ["draft:arguments-invalid"]);
}

function privateFormNarrowToolEnvelope(
  response: unknown,
  allowedForms: readonly KpFormId[],
  structuredOutputMode: KpStructuredOutputMode = "tool",
): PrivateFormEnvelope {
  let toolCall: ReturnType<typeof extractSingleToolCall>;
  try {
    toolCall = extractSingleToolCall(response);
  } catch {
    throw new PrivateFormEnvelopeError(null, ["structured-output:single-tool-required"]);
  }
  const formId = kpFormIdForToolName(toolCall.name);
  if (formId === undefined || !allowedForms.includes(formId)) {
    throw new PrivateFormEnvelopeError(
      { toolName: toolCall.name },
      ["tool:not-allowed"],
    );
  }
  const draft = narrowToolDraft(formId, toolCall.arguments, structuredOutputMode);
  const validation = validateKpFormDraft(formId, draft);
  if (!validation.ok) {
    throw new PrivateFormEnvelopeError({ formId, draft }, validation.errors);
  }
  return { formId, draft };
}

function validateNarrowToolRepair(
  selectedForm: KpFormId,
  response: unknown,
  structuredOutputMode: KpStructuredOutputMode = "tool",
): PrivateFormEnvelope {
  let toolCall: ReturnType<typeof extractSingleToolCall>;
  try {
    toolCall = extractSingleToolCall(response);
  } catch {
    throw new PrivateFormEnvelopeError(null, ["structured-output:single-tool-required"]);
  }
  if (toolCall.name !== kpFormToolName(selectedForm)) {
    throw new PrivateFormEnvelopeError(
      { toolName: toolCall.name },
      ["repair:tool-switch-forbidden"],
    );
  }
  const draft = narrowToolDraft(selectedForm, toolCall.arguments, structuredOutputMode);
  const validation = validateKpFormDraft(selectedForm, draft);
  if (!validation.ok) {
    throw new PrivateFormEnvelopeError({ formId: selectedForm, draft }, validation.errors);
  }
  return { formId: selectedForm, draft };
}

function trustedPlayerUtterance(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  if (typeof input.text === "string" && input.text.trim().length > 0) return input.text;
  if (typeof input.displayText === "string" && input.displayText.trim().length > 0) {
    return input.displayText;
  }
  return isRecord(input.answer)
    && typeof input.answer.text === "string"
    && input.answer.text.trim().length > 0
    ? input.answer.text
    : undefined;
}

function withTrustedSocialUtterance(
  request: KpProposalRequest,
  envelope: PrivateFormEnvelope,
  enabled: boolean,
): PrivateFormEnvelope {
  if (!enabled || envelope.formId !== "npc-exchange.v1") return envelope;
  return {
    ...envelope,
    draft: {
      ...envelope.draft,
      utterance: trustedPlayerUtterance(request.input),
    },
  };
}

const SOCIAL_INTENT_GOALS = new Set([
  "beBelieved", "deemphasize", "cooperate", "disclose", "permit", "deter", "other",
]);
const SOCIAL_ASSERTION_PREDICATES = new Set([
  "isA", "affiliatedWith", "authorizedBy", "possesses", "knowsAbout",
  "performed", "intends", "relatedTo", "locatedAt",
]);

function exactObjectKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function parsedJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || value.length > 3_000) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Pure model-boundary validation. Rules repeats all reference, knowledge and
 * state checks; this earlier pass exists so one bounded Form repair can fix a
 * malformed typed social draft instead of surfacing a generic Rules error. */
function socialFormSemanticErrors(
  draft: Record<string, unknown>,
  finiteReferences: FiniteReferenceCatalog,
): readonly string[] {
  const errors: string[] = [];
  const basisRefs = new Set(Array.isArray(draft.basisRefs)
    ? draft.basisRefs.filter((entry): entry is string => typeof entry === "string")
    : []);
  const finiteRefs = new Set(finiteReferences.basisRefs);
  const intent = parsedJsonRecord(draft.desiredResponse);
  if (intent === undefined
    || !exactObjectKeys(intent, [
      "addressedThreadRef", "assertion", "desiredBehavior", "evidenceRefs", "influenceGoal",
      "npcRef", "schema",
    ])
    || intent.schema !== "zhuwei.social-intent-draft/v1"
    || typeof intent.npcRef !== "string"
    || !basisRefs.has(intent.npcRef)
    || !finiteRefs.has(intent.npcRef)
    || typeof intent.influenceGoal !== "string"
    || !SOCIAL_INTENT_GOALS.has(intent.influenceGoal)
    || typeof intent.desiredBehavior !== "string"
    || !intent.desiredBehavior.trim()
    || intent.desiredBehavior.length > 500
    || !Array.isArray(intent.evidenceRefs)
    || intent.evidenceRefs.length > 2
    || !intent.evidenceRefs.every((entry) => typeof entry === "string" && entry.length > 0)
    || intent.evidenceRefs.length !== new Set(intent.evidenceRefs).size) {
    errors.push("draft.desiredResponse:social-intent-schema-invalid");
  } else {
    if (intent.addressedThreadRef !== null
      && (typeof intent.addressedThreadRef !== "string"
        || !basisRefs.has(intent.addressedThreadRef)
        || !finiteRefs.has(intent.addressedThreadRef)
        || intent.influenceGoal !== "deemphasize")) {
      errors.push("draft.desiredResponse.addressedThreadRef:invalid");
    }
    for (const ref of intent.evidenceRefs as string[]) {
      if (!basisRefs.has(ref) || !finiteRefs.has(ref)) {
        errors.push(`draft.desiredResponse.evidenceRefs:${ref}:not-authoritative`);
      }
    }
    if (intent.assertion === null) {
      if (intent.influenceGoal === "beBelieved" || intent.evidenceRefs.length > 0) {
        errors.push("draft.desiredResponse.assertion:required-for-belief-or-evidence");
      }
    } else if (!isRecord(intent.assertion)
      || !exactObjectKeys(intent.assertion, ["object", "polarity", "predicate", "subjectRef"])
      || typeof intent.assertion.subjectRef !== "string"
      || !finiteRefs.has(intent.assertion.subjectRef)
      || typeof intent.assertion.predicate !== "string"
      || !SOCIAL_ASSERTION_PREDICATES.has(intent.assertion.predicate)
      || !["affirm", "deny", "question"].includes(String(intent.assertion.polarity))
      || !isRecord(intent.assertion.object)) {
      errors.push("draft.desiredResponse.assertion:invalid");
    } else if (intent.assertion.object.referenceKind === "existing") {
      const objectRef = intent.assertion.object.ref;
      if (!exactObjectKeys(intent.assertion.object, ["ref", "referenceKind"])
        || typeof objectRef !== "string"
        || !basisRefs.has(objectRef)
        || !finiteRefs.has(objectRef)) {
        errors.push("draft.desiredResponse.assertion.object:existing-ref-invalid");
      }
    } else if (intent.assertion.object.referenceKind !== "unresolvedLabel"
      || !exactObjectKeys(intent.assertion.object, ["label", "referenceKind"])
      || typeof intent.assertion.object.label !== "string"
      || !intent.assertion.object.label.trim()
      || intent.assertion.object.label.length > 160) {
      errors.push("draft.desiredResponse.assertion.object:unresolved-label-invalid");
    }
  }

  const response = parsedJsonRecord(draft.npcResponse);
  if (response === undefined
    || response.schema !== "zhuwei.npc-response-draft/v1"
    || typeof response.mode !== "string") {
    errors.push("draft.npcResponse:npc-response-schema-invalid");
  } else if (response.mode === "reaction") {
    if (!exactObjectKeys(response, ["mode", "reaction", "schema"])
      || !["acknowledge", "decline", "askClarification", "redirect", "silence"]
        .includes(String(response.reaction))) {
      errors.push("draft.npcResponse:reaction-invalid");
    }
  } else if (response.mode === "sourceBacked") {
    if (!exactObjectKeys(response, ["mode", "schema", "sourceRefs"])
      || !Array.isArray(response.sourceRefs)
      || response.sourceRefs.length < 1
      || response.sourceRefs.length > 4
      || !response.sourceRefs.every((entry) =>
        typeof entry === "string" && basisRefs.has(entry) && finiteRefs.has(entry))) {
      errors.push("draft.npcResponse:source-backed-invalid");
    }
  } else if (response.mode === "commitment") {
    if (!exactObjectKeys(response, ["mode", "schema", "scopeRefs", "speech"])
      || typeof response.speech !== "string"
      || !response.speech.trim()
      || response.speech.length > 800
      || !Array.isArray(response.scopeRefs)
      || response.scopeRefs.length < 1
      || response.scopeRefs.length > 4
      || !response.scopeRefs.every((entry) =>
        typeof entry === "string" && basisRefs.has(entry) && finiteRefs.has(entry))) {
      errors.push("draft.npcResponse:commitment-invalid");
    }
  } else {
    errors.push("draft.npcResponse:mode-invalid");
  }
  if (draft.resolution === "check" && intent !== undefined && response !== undefined) {
    if (intent.influenceGoal === "disclose" && response.mode !== "sourceBacked") {
      errors.push("draft.npcResponse:disclose-requires-source-backed");
    }
    if (["permit", "cooperate"].includes(String(intent.influenceGoal))
      && response.mode !== "commitment") {
      errors.push("draft.npcResponse:permit-or-cooperate-requires-commitment");
    }
  }
  return Object.freeze([...new Set(errors)].sort());
}

function materializationFormSemanticErrors(
  draft: Record<string, unknown>,
  finiteReferences: FiniteReferenceCatalog,
): readonly string[] {
  const errors: string[] = [];
  const basisRefs = new Set(Array.isArray(draft.basisRefs)
    ? draft.basisRefs.filter((entry): entry is string => typeof entry === "string")
    : []);
  const finiteRefs = new Set(finiteReferences.basisRefs);
  const value = parsedJsonRecord(draft.proposedFact);
  const schema = typeof value?.schema === "string" ? value.schema : undefined;
  if (draft.method !== "establishCharacterPremise"
    && draft.method !== "materializeDynamicNpc"
    && draft.method !== "formActorPlan"
    && draft.method !== "materializeHiddenReality"
    && draft.method !== "materializePassageAndMove"
    && draft.method !== "resolveNoncombatContest"
    && draft.method !== "recordAdjudicationPrecedent"
    && draft.method !== "materializeItem"
    && schema !== "zhuwei.campaign-lifecycle-draft/v1") return [];
  const cited = (reference: unknown): reference is string =>
    typeof reference === "string" && basisRefs.has(reference) && finiteRefs.has(reference);
  if (draft.method === "materializePassageAndMove") {
    if (draft.resolution !== "direct"
      || value === undefined
      || !exactObjectKeys(value, [
        "destinationName",
        "destinationSceneRef",
        "geometry",
        "locationRef",
        "passageRef",
        "schema",
        "traversal",
      ])
      || value.schema !== "zhuwei.dynamic-passage-move-draft/v1"
      || typeof value.locationRef !== "string"
      || !value.locationRef.startsWith("location:")
      || value.locationRef.length > 240
      || typeof value.destinationSceneRef !== "string"
      || !value.destinationSceneRef.startsWith("scene:")
      || value.destinationSceneRef.length > 240
      || typeof value.destinationName !== "string"
      || !value.destinationName.trim()
      || value.destinationName.length > 240
      || typeof value.passageRef !== "string"
      || !value.passageRef.startsWith("passage:")
      || value.passageRef.length > 240
      || typeof value.traversal !== "string"
      || !value.traversal.trim()
      || value.traversal.length > 800
      || !isCanonicalTacticalGeometry(value.geometry)
      || new Set([
        value.locationRef,
        value.destinationSceneRef,
        value.passageRef,
      ]).size !== 3) {
      errors.push("draft.proposedFact:dynamic-passage-move-schema-invalid");
    }
    if (!Array.isArray(draft.basisRefs)
      || draft.basisRefs.length < 1
      || draft.basisRefs.length > 24
      || draft.basisRefs.length !== basisRefs.size
      || !draft.basisRefs.every((reference) =>
        typeof reference === "string" && finiteRefs.has(reference))) {
      errors.push("draft.basisRefs:dynamic-passage-move-basis-invalid");
    }
    return Object.freeze([...new Set(errors)].sort());
  }
  if (draft.method === "materializeHiddenReality") {
    if (draft.resolution !== "direct"
      || value === undefined
      || !exactObjectKeys(value, ["candidateSetId", "candidates", "schema"])
      || value.schema !== "zhuwei.hidden-reality-candidate-set-draft/v1"
      || typeof value.candidateSetId !== "string"
      || !value.candidateSetId.trim()
      || !Array.isArray(value.candidates)
      || value.candidates.length < 2
      || value.candidates.length > 20) {
      return ["draft.proposedFact:hidden-reality-schema-invalid"];
    }
    for (const candidate of value.candidates) {
      if (!isRecord(candidate)
        || !exactObjectKeys(candidate, [
          "candidateId", "causalBasisRefs", "definition", "factRef", "hiddenWeight", "kind",
          "visibilityPolicyRef",
        ])
        || typeof candidate.candidateId !== "string"
        || !candidate.candidateId.trim()
        || typeof candidate.factRef !== "string"
        || !candidate.factRef.trim()
        || !Number.isSafeInteger(candidate.hiddenWeight)
        || Number(candidate.hiddenWeight) < 1
        || Number(candidate.hiddenWeight) > 1_000_000
        || !["fact", "location", "passage", "hazard", "opportunity"].includes(
          String(candidate.kind),
        )
        || typeof candidate.visibilityPolicyRef !== "string"
        || !candidate.visibilityPolicyRef.startsWith("visibility:")
        || !isRecord(candidate.definition)
        || !Array.isArray(candidate.causalBasisRefs)
        || candidate.causalBasisRefs.length < 1
        || candidate.causalBasisRefs.length > 24
        || !candidate.causalBasisRefs.every(cited)
        || candidate.causalBasisRefs.length !== new Set(candidate.causalBasisRefs).size) {
        errors.push("draft.proposedFact:hidden-reality-candidate-invalid");
      }
    }
    return Object.freeze([...new Set(errors)].sort());
  }
  if (draft.method === "resolveNoncombatContest") {
    if (draft.resolution !== "direct"
      || value === undefined
      || !exactObjectKeys(value, [
        "defenderAbility", "defenderRef", "defenderSkill", "initiatorAbility",
        "initiatorSkill", "mode", "schema", "tieResult",
      ])
      || value.schema !== "zhuwei.noncombat-contest-draft/v1"
      || !cited(value.defenderRef)
      || ![value.initiatorAbility, value.defenderAbility].every((entry) =>
        ["str", "dex", "con", "int", "wis", "cha"].includes(String(entry)))
      || ![value.initiatorSkill, value.defenderSkill].every((entry) =>
        entry === null || (typeof entry === "string" && entry.length > 0 && entry.length <= 120))
      || !["normal", "advantage", "disadvantage"].includes(String(value.mode))
      || value.tieResult !== "statusQuo") {
      errors.push("draft.proposedFact:noncombat-contest-schema-invalid");
    }
    return Object.freeze(errors);
  }
  if (draft.method === "recordAdjudicationPrecedent") {
    const commonValid = draft.resolution === "check"
      && value !== undefined
      && value.schema === "zhuwei.adjudication-precedent-draft/v1"
      && (value.action === "record" || value.action === "supersede")
      && Array.isArray(value.publicRuleBasis)
      && value.publicRuleBasis.length > 0
      && value.publicRuleBasis.every((entry) => typeof entry === "string" && entry.length > 0)
      && Array.isArray(value.publicBasisRefs)
      && value.publicBasisRefs.every(cited)
      && Array.isArray(value.privateBasisRefs)
      && value.privateBasisRefs.every(cited)
      && isRecord(value.applicabilityScope)
      && exactObjectKeys(value.applicabilityScope, ["kind", "ref"])
      && ["scene", "campaign", "module", "room"].includes(
        String(value.applicabilityScope.kind),
      )
      && cited(value.applicabilityScope.ref);
    const actionValid = value?.action === "record"
      ? exactObjectKeys(value, [
          "action", "applicabilityScope", "privateBasisRefs", "publicBasisRefs",
          "publicRuleBasis", "schema",
        ])
      : value?.action === "supersede"
        && exactObjectKeys(value, [
          "action", "applicabilityScope", "materialDifferences", "privateBasisRefs",
          "publicBasisRefs", "publicRuleBasis", "schema", "supersededPrecedentId",
        ])
        && cited(value.supersededPrecedentId)
        && Array.isArray(value.materialDifferences)
        && value.materialDifferences.length > 0
        && value.materialDifferences.every((entry) =>
          typeof entry === "string" && entry.length > 0);
    if (!commonValid || !actionValid) {
      errors.push("draft.proposedFact:adjudication-precedent-schema-invalid");
    }
    return Object.freeze(errors);
  }
  if (schema === "zhuwei.campaign-lifecycle-draft/v1") {
    if (value === undefined || typeof value.action !== "string") {
      return ["draft.proposedFact:campaign-lifecycle-schema-invalid"];
    }
    const directRequired = value.action !== "retryFailedAction";
    if ((directRequired && draft.resolution !== "direct")
      || (!directRequired && draft.resolution !== "check")) {
      errors.push("draft.resolution:campaign-lifecycle-resolution-invalid");
    }
    const uniqueCited = (candidate: unknown): candidate is string[] =>
      Array.isArray(candidate)
      && candidate.length <= 40
      && candidate.every(cited)
      && candidate.length === new Set(candidate).size;
    if (value.action === "raiseEndingCandidate") {
      if (!exactObjectKeys(value, [
        "action", "basisRefs", "endingCandidateRef", "schema", "unresolvedRefs",
      ])
        || typeof value.endingCandidateRef !== "string"
        || !value.endingCandidateRef.trim()
        || !uniqueCited(value.basisRefs)
        || value.basisRefs.length === 0
        || !uniqueCited(value.unresolvedRefs)) {
        errors.push("draft.proposedFact:ending-candidate-schema-invalid");
      }
    } else if (value.action === "concludeStory") {
      if (!exactObjectKeys(value, [
        "action", "consequenceRefs", "endingCandidateRef", "outcome", "schema", "storyRef",
      ])
        || !cited(value.endingCandidateRef)
        || ![value.storyRef, value.outcome].every((entry) =>
          typeof entry === "string" && entry.length > 0)
        || !Array.isArray(value.consequenceRefs)
        || value.consequenceRefs.length > 40
        || !value.consequenceRefs.every((entry) =>
          typeof entry === "string" && entry.length > 0)) {
        errors.push("draft.proposedFact:story-conclusion-schema-invalid");
      }
    } else if (value.action === "transitionChapter") {
      if (!exactObjectKeys(value, [
        "action", "activityTransitions", "chapterRef", "sceneQuestion", "schema",
        "storyAnchorRefs",
      ])
        || ![value.chapterRef, value.sceneQuestion].every((entry) =>
          typeof entry === "string" && entry.length > 0)
        || !uniqueCited(value.storyAnchorRefs)
        || !Array.isArray(value.activityTransitions)
        || value.activityTransitions.length > 40
        || !value.activityTransitions.every((entry) => isRecord(entry)
          && exactObjectKeys(entry, ["activityId", "disposition"])
          && cited(entry.activityId)
          && ["continue", "summarize", "interrupt", "complete"].includes(
            String(entry.disposition),
          ))) {
        errors.push("draft.proposedFact:chapter-transition-schema-invalid");
      }
    } else if (value.action === "commitMeaningfulFailure") {
      if (!exactObjectKeys(value, [
        "action", "basisRefs", "consequenceRefs", "newOptions", "precedentRef", "schema",
      ])
        || typeof value.precedentRef !== "string"
        || !value.precedentRef.trim()
        || !uniqueCited(value.basisRefs)
        || value.basisRefs.length === 0
        || !Array.isArray(value.consequenceRefs)
        || !value.consequenceRefs.every((entry) =>
          typeof entry === "string" && entry.length > 0)
        || !Array.isArray(value.newOptions)
        || value.newOptions.length < 1
        || value.newOptions.length > 12
        || !value.newOptions.every((entry) => isRecord(entry)
          && exactObjectKeys(entry, ["optionId", "summary"])
          && cited(entry.optionId)
          && typeof entry.summary === "string"
          && entry.summary.length > 0)) {
        errors.push("draft.proposedFact:meaningful-failure-schema-invalid");
      }
    } else if (value.action === "retryFailedAction") {
      const changeKinds = [
        "methodChanged", "factsChanged", "costAccepted", "positionChanged",
        "materialAssistance", "situationAdvanced",
      ];
      if (!exactObjectKeys(value, [
        "action", "changeKind", "evidenceRefs", "precedentRef", "schema",
      ])
        || typeof value.precedentRef !== "string"
        || !value.precedentRef.trim()
        || !(value.changeKind === null || changeKinds.includes(String(value.changeKind)))
        || !uniqueCited(value.evidenceRefs)
        || (value.changeKind === null && value.evidenceRefs.length !== 0)
        || (value.changeKind !== null
          && value.changeKind !== "methodChanged"
          && value.evidenceRefs.length === 0)) {
        errors.push("draft.proposedFact:failed-action-retry-schema-invalid");
      }
    } else {
      errors.push("draft.proposedFact:campaign-lifecycle-action-invalid");
    }
    return Object.freeze([...new Set(errors)].sort());
  }
  if (draft.method === "formActorPlan") {
    const uniqueCitedRefs = (candidate: unknown, minimum: number): candidate is string[] =>
      Array.isArray(candidate)
      && candidate.length >= minimum
      && candidate.length <= 40
      && candidate.every(cited)
      && candidate.length === new Set(candidate).size;
    if (draft.resolution !== "direct") {
      errors.push("draft.resolution:actor-plan-direct-required");
    }
    if (value === undefined
      || !exactObjectKeys(value, [
        "activity",
        "alternateTarget",
        "due",
        "factionRef",
        "goal",
        "nextStep",
        "npcRef",
        "planId",
        "premiseRefs",
        "resourceRefs",
        "schema",
        "trace",
        "trigger",
      ])
      || value.schema !== "zhuwei.actor-plan-draft/v1"
      || !cited(value.npcRef)
      || !(value.factionRef === null || cited(value.factionRef))
      || typeof value.planId !== "string"
      || value.planId.length < 1
      || value.planId.length > 240
      || typeof value.goal !== "string"
      || value.goal.length < 1
      || value.goal.length > 480
      || !uniqueCitedRefs(value.premiseRefs, 1)
      || typeof value.nextStep !== "string"
      || value.nextStep.length < 1
      || value.nextStep.length > 480
      || !uniqueCitedRefs(value.resourceRefs, 0)
      || !isRecord(value.activity)
      || !exactObjectKeys(value.activity, ["activityId", "activityKind", "intendedDurationMicros"])
      || typeof value.activity.activityId !== "string"
      || value.activity.activityId.length < 1
      || value.activity.activityId.length > 240
      || typeof value.activity.activityKind !== "string"
      || value.activity.activityKind.length < 1
      || value.activity.activityKind.length > 120
      || typeof value.activity.intendedDurationMicros !== "string"
      || !/^[1-9][0-9]*$/u.test(value.activity.intendedDurationMicros)
      || !isRecord(value.trace)
      || !exactObjectKeys(value.trace, ["description", "factRef", "visibilityPolicyRef"])
      || typeof value.trace.factRef !== "string"
      || value.trace.factRef.length < 1
      || value.trace.factRef.length > 240
      || typeof value.trace.description !== "string"
      || value.trace.description.length < 1
      || value.trace.description.length > 480
      || value.trace.visibilityPolicyRef !== "visibility:scene-observers"
      || !isRecord(value.alternateTarget)
      || !exactObjectKeys(value.alternateTarget, ["reason", "targetRef"])
      || !cited(value.alternateTarget.targetRef)
      || typeof value.alternateTarget.reason !== "string"
      || value.alternateTarget.reason.length < 1
      || value.alternateTarget.reason.length > 480) {
      errors.push("draft.proposedFact:actor-plan-schema-invalid");
      return Object.freeze([...new Set(errors)].sort());
    }
    const dueValid = value.due === null || (
      isRecord(value.due)
      && exactObjectKeys(value.due, ["kind"])
      && value.due.kind === "activityCompletion"
    );
    const triggerValid = value.trigger === null || (
      isRecord(value.trigger)
      && ((value.trigger.kind === "knowledgeAcquired"
        && exactObjectKeys(value.trigger, ["kind", "knowledgeRef"])
        && cited(value.trigger.knowledgeRef))
        || (value.trigger.kind === "committedEvent"
          && exactObjectKeys(value.trigger, ["eventRef", "kind"])
          && cited(value.trigger.eventRef)))
    );
    if (!dueValid || !triggerValid || ((value.due === null) === (value.trigger === null))) {
      errors.push("draft.proposedFact:actor-plan-schedule-invalid");
    }
    return Object.freeze([...new Set(errors)].sort());
  }
  if (draft.method === "materializeItem") {
    if (draft.resolution !== "direct") {
      errors.push("draft.resolution:item-materialization-direct-required");
    }
    if (value === undefined
      || !exactObjectKeys(value, ["definitionRef", "quantity", "schema"])
      || value.schema !== "zhuwei.item-materialization-draft/v1"
      || value.definitionRef !== HEALING_POTION_ITEM_DEFINITION_ID
      || !Number.isSafeInteger(value.quantity)
      || Number(value.quantity) < 1
      || Number(value.quantity) > 1_000_000) {
      errors.push("draft.proposedFact:item-materialization-schema-invalid");
    }
    if (basisRefs.size < 2
      || !Array.isArray(draft.basisRefs)
      || basisRefs.size !== draft.basisRefs.length) {
      errors.push("draft.basisRefs:item-materialization-basis-invalid");
    }
    return Object.freeze([...new Set(errors)].sort());
  }
  if (draft.method === "establishCharacterPremise") {
    if (value === undefined
      || !exactObjectKeys(value, ["anchorRefs", "bindings", "policyRef", "predicate", "schema"])
      || value.schema !== "zhuwei.character-premise-draft/v2"
      || !cited(value.policyRef)
      || typeof value.predicate !== "string"
      || !["arrivalPurpose", "priorKnowledge", "priorRelationship", "obligation", "affiliation", "identityBackground"].includes(value.predicate)
      || !Array.isArray(value.anchorRefs)
      || value.anchorRefs.length < 1
      || value.anchorRefs.length > 4
      || !value.anchorRefs.every(cited)
      || !Array.isArray(value.bindings)
      || value.bindings.length < 1
      || value.bindings.length > 8) {
      return ["draft.proposedFact:character-premise-schema-invalid"];
    }
    for (const binding of value.bindings) {
      if (!isRecord(binding) || typeof binding.slotRef !== "string" || !binding.slotRef.trim()) {
        errors.push("draft.proposedFact.bindings:slot-invalid");
        continue;
      }
      if (binding.referenceKind === "existing") {
        if (!exactObjectKeys(binding, ["ref", "referenceKind", "slotRef"])
          || !cited(binding.ref)) errors.push("draft.proposedFact.bindings:existing-ref-invalid");
        continue;
      }
      if (binding.referenceKind !== "openArchetype"
        || !exactObjectKeys(binding, ["archetypeRef", "displayAlias", "referenceKind", "slotRef"])
        || !cited(binding.archetypeRef)
        || typeof binding.displayAlias !== "string"
        || !binding.displayAlias.trim()
        || binding.displayAlias.length > 120) {
        errors.push("draft.proposedFact.bindings:open-archetype-invalid");
      }
    }
    return Object.freeze([...new Set(errors)].sort());
  }
  if (value === undefined
    || !exactObjectKeys(value, [
      "definitionRef", "entityRef", "initialKnowledgeFactRefs", "sceneRef", "schema",
      "sourceFactRefs",
    ])
    || value.schema !== "zhuwei.dynamic-npc-materialization-draft/v2"
    || ![value.definitionRef, value.entityRef, value.sceneRef].every(cited)
    || !Array.isArray(value.sourceFactRefs)
    || value.sourceFactRefs.length < 1
    || value.sourceFactRefs.length > 8
    || !value.sourceFactRefs.every(cited)
    || value.sourceFactRefs.length !== new Set(value.sourceFactRefs).size
    || !Array.isArray(value.initialKnowledgeFactRefs)
    || value.initialKnowledgeFactRefs.length > 8
    || !value.initialKnowledgeFactRefs.every((reference) =>
      cited(reference) && (value.sourceFactRefs as unknown[]).includes(reference))
    || value.initialKnowledgeFactRefs.length !== new Set(value.initialKnowledgeFactRefs).size) {
    errors.push("draft.proposedFact:dynamic-npc-materialization-schema-invalid");
  }
  return Object.freeze(errors);
}

type CompoundReferenceEnvironment = {
  readonly finiteBasisRefs: ReadonlySet<string>;
  readonly finiteResourceRefs: ReadonlySet<string>;
  readonly identities: Set<string>;
  readonly availableNewFacts: Set<string>;
  readonly availableActorKnowledge: Set<string>;
};

function compoundCompositionValidationPath(error: string): string {
  return error === "$"
    ? "draft.composition"
    : error.startsWith("$.") || error.startsWith("$[")
      ? `draft.composition${error.slice(1)}`
      : `draft.composition:${error}`;
}

function compoundReferenceAvailable(
  environment: CompoundReferenceEnvironment,
  reference: string,
): boolean {
  return environment.finiteBasisRefs.has(reference)
    || environment.availableNewFacts.has(reference);
}

function compoundActorBasisAvailable(
  environment: CompoundReferenceEnvironment,
  reference: string,
): boolean {
  return compoundReferenceAvailable(environment, reference)
    || environment.availableActorKnowledge.has(reference);
}

function requireCompoundReference(
  environment: CompoundReferenceEnvironment,
  reference: string,
  path: string,
  errors: string[],
): void {
  if (!compoundReferenceAvailable(environment, reference)) {
    errors.push(`${path}:${reference}:not-authoritative`);
  }
}

function requireCompoundActorBasisReferences(
  environment: CompoundReferenceEnvironment,
  references: readonly string[],
  path: string,
  errors: string[],
): void {
  for (const [index, reference] of references.entries()) {
    if (!compoundActorBasisAvailable(environment, reference)) {
      errors.push(`${path}[${index}]:${reference}:not-authoritative`);
    }
  }
}

function requireCompoundReferences(
  environment: CompoundReferenceEnvironment,
  references: readonly string[],
  path: string,
  errors: string[],
): void {
  for (const [index, reference] of references.entries()) {
    requireCompoundReference(environment, reference, `${path}[${index}]`, errors);
  }
}

function requireCompoundResourceReference(
  environment: CompoundReferenceEnvironment,
  reference: string,
  path: string,
  errors: string[],
): void {
  if (!environment.finiteResourceRefs.has(reference)) {
    errors.push(`${path}:${reference}:not-authoritative`);
  }
}

function declareCompoundIdentity(
  environment: CompoundReferenceEnvironment,
  reference: string,
  path: string,
  errors: string[],
  availability: "identityOnly" | "fact" | "actorKnowledge",
): void {
  if (environment.finiteBasisRefs.has(reference)) {
    errors.push(`${path}:${reference}:identity-already-authoritative`);
    return;
  }
  if (environment.identities.has(reference)) {
    errors.push(`${path}:${reference}:duplicate-identity`);
    return;
  }
  environment.identities.add(reference);
  if (availability === "fact") environment.availableNewFacts.add(reference);
  if (availability === "actorKnowledge") {
    environment.availableActorKnowledge.add(reference);
  }
}

function validateCompoundWorldConsequenceReferences(
  environment: CompoundReferenceEnvironment,
  consequence: CompoundWorldConsequence,
  path: string,
  errors: string[],
): void {
  switch (consequence.kind) {
    case "spendResource":
      requireCompoundResourceReference(
        environment,
        consequence.resourceRef,
        `${path}.resourceRef`,
        errors,
      );
      return;
    case "acquireKnowledge":
      return;
    case "updateRelationship":
      requireCompoundReferences(
        environment,
        consequence.counterpartyRefs,
        `${path}.counterpartyRefs`,
        errors,
      );
      return;
    case "recordPromise":
    case "recordDebt":
      requireCompoundReference(
        environment,
        consequence.counterpartyRef,
        `${path}.counterpartyRef`,
        errors,
      );
      return;
  }
}

function declareCompoundWorldConsequenceIdentity(
  environment: CompoundReferenceEnvironment,
  consequence: CompoundWorldConsequence,
  path: string,
  errors: string[],
): void {
  switch (consequence.kind) {
    case "spendResource":
      return;
    case "acquireKnowledge":
      declareCompoundIdentity(
        environment,
        consequence.knowledgeRef,
        `${path}.knowledgeRef`,
        errors,
        "actorKnowledge",
      );
      return;
    case "updateRelationship":
      declareCompoundIdentity(
        environment,
        consequence.relationshipRef,
        `${path}.relationshipRef`,
        errors,
        "identityOnly",
      );
      return;
    case "recordPromise":
      declareCompoundIdentity(
        environment,
        consequence.promiseRef,
        `${path}.promiseRef`,
        errors,
        "identityOnly",
      );
      return;
    case "recordDebt":
      declareCompoundIdentity(
        environment,
        consequence.debtRef,
        `${path}.debtRef`,
        errors,
        "identityOnly",
      );
      return;
  }
}

function validateCompoundOperationReferences(
  environment: CompoundReferenceEnvironment,
  operation: CompoundCompositionOperation,
  path: string,
  errors: string[],
): void {
  switch (operation.kind) {
    case "declareDynamicFact":
      requireCompoundReferences(
        environment,
        operation.subjectRefs,
        `${path}.subjectRefs`,
        errors,
      );
      requireCompoundActorBasisReferences(
        environment,
        operation.causalBasisRefs,
        `${path}.causalBasisRefs`,
        errors,
      );
      declareCompoundIdentity(
        environment,
        operation.factRef,
        `${path}.factRef`,
        errors,
        "fact",
      );
      return;
    case "formActorPlan": {
      const actorPlan = operation.draft;
      requireCompoundReferences(environment, operation.basisRefs, `${path}.basisRefs`, errors);
      requireCompoundReference(environment, actorPlan.npcRef, `${path}.draft.npcRef`, errors);
      if (actorPlan.factionRef !== null) {
        requireCompoundReference(
          environment,
          actorPlan.factionRef,
          `${path}.draft.factionRef`,
          errors,
        );
      }
      requireCompoundReferences(
        environment,
        actorPlan.premiseRefs,
        `${path}.draft.premiseRefs`,
        errors,
      );
      requireCompoundReferences(
        environment,
        actorPlan.resourceRefs,
        `${path}.draft.resourceRefs`,
        errors,
      );
      if (actorPlan.schedule.kind === "committedOccurrence") {
        requireCompoundReference(
          environment,
          actorPlan.schedule.occurrenceRef,
          `${path}.draft.schedule.occurrenceRef`,
          errors,
        );
      } else if (actorPlan.schedule.kind === "knowledgeAcquired") {
        requireCompoundReference(
          environment,
          actorPlan.schedule.knowledgeRef,
          `${path}.draft.schedule.knowledgeRef`,
          errors,
        );
      }
      requireCompoundReference(
        environment,
        actorPlan.alternate.referenceRef,
        `${path}.draft.alternate.referenceRef`,
        errors,
      );
      declareCompoundIdentity(
        environment,
        actorPlan.planRef,
        `${path}.draft.planRef`,
        errors,
        "identityOnly",
      );
      declareCompoundIdentity(
        environment,
        actorPlan.activity.activityRef,
        `${path}.draft.activity.activityRef`,
        errors,
        "identityOnly",
      );
      declareCompoundIdentity(
        environment,
        actorPlan.trace.factRef,
        `${path}.draft.trace.factRef`,
        errors,
        "identityOnly",
      );
      return;
    }
    case "openSceneQuestion":
      declareCompoundIdentity(
        environment,
        operation.sceneQuestionRef,
        `${path}.sceneQuestionRef`,
        errors,
        "identityOnly",
      );
      return;
    case "startActivity":
      requireCompoundReference(
        environment,
        operation.primaryFactRef,
        `${path}.primaryFactRef`,
        errors,
      );
      declareCompoundIdentity(
        environment,
        operation.activityRef,
        `${path}.activityRef`,
        errors,
        "identityOnly",
      );
      return;
    case "transitionEnvironment":
      requireCompoundReference(
        environment,
        operation.featureRef,
        `${path}.featureRef`,
        errors,
      );
      return;
    case "applyWorldEffects":
      requireCompoundActorBasisReferences(
        environment,
        operation.basisRefs,
        `${path}.basisRefs`,
        errors,
      );
      operation.draft.consequences.forEach((consequence, index) =>
        validateCompoundWorldConsequenceReferences(
          environment,
          consequence,
          `${path}.draft.consequences[${index}]`,
          errors,
        ));
      declareCompoundIdentity(
        environment,
        operation.draft.factRef,
        `${path}.draft.factRef`,
        errors,
        "fact",
      );
      operation.draft.consequences.forEach((consequence, index) =>
        declareCompoundWorldConsequenceIdentity(
          environment,
          consequence,
          `${path}.draft.consequences[${index}]`,
          errors,
        ));
      return;
  }
}

function compoundReferenceEnvironment(
  finiteReferences: FiniteReferenceCatalog,
): CompoundReferenceEnvironment {
  return {
    finiteBasisRefs: new Set(finiteReferences.basisRefs),
    finiteResourceRefs: new Set(finiteReferences.resourceRefs),
    identities: new Set(),
    availableNewFacts: new Set(),
    availableActorKnowledge: new Set(),
  };
}

function branchCompoundReferenceEnvironment(
  source: CompoundReferenceEnvironment,
): CompoundReferenceEnvironment {
  return {
    finiteBasisRefs: source.finiteBasisRefs,
    finiteResourceRefs: source.finiteResourceRefs,
    identities: new Set(source.identities),
    availableNewFacts: new Set(source.availableNewFacts),
    availableActorKnowledge: new Set(source.availableActorKnowledge),
  };
}

function validateCompoundPhaseReferences(
  environment: CompoundReferenceEnvironment,
  operations: readonly CompoundCompositionOperation[],
  phase: "before" | "onSuccess" | "onFailure",
  errors: string[],
): void {
  operations.forEach((operation, index) =>
    validateCompoundOperationReferences(
      environment,
      operation,
      `draft.composition.${phase}[${index}]`,
      errors,
    ));
}

function compoundCompositionSemanticErrors(
  draft: Record<string, unknown>,
  finiteReferences: FiniteReferenceCatalog,
): readonly string[] {
  const validation = validateCompoundCompositionDraft(draft.composition);
  if (!validation.ok) {
    return Object.freeze(validation.errors.map(compoundCompositionValidationPath));
  }
  let composition: CompoundCompositionDraft | undefined;
  try {
    composition = parseCompoundCompositionJson(
      canonicalCompoundCompositionJson(draft.composition),
    );
  } catch {
    composition = undefined;
  }
  if (composition === undefined) {
    return Object.freeze(["draft.composition:canonical-parse-failed"]);
  }

  const errors: string[] = [];
  const before = compoundReferenceEnvironment(finiteReferences);
  validateCompoundPhaseReferences(before, composition.before, "before", errors);
  validateCompoundPhaseReferences(
    branchCompoundReferenceEnvironment(before),
    composition.onSuccess,
    "onSuccess",
    errors,
  );
  validateCompoundPhaseReferences(
    branchCompoundReferenceEnvironment(before),
    composition.onFailure,
    "onFailure",
    errors,
  );
  return Object.freeze([...new Set(errors)].sort());
}

const FORM_SEMANTIC_FIELDS: Readonly<Record<KpFormId, readonly string[]>> = Object.freeze({
  "clarification.v1": Object.freeze(["goal", "question", "choices"]),
  "observe.v1": Object.freeze(["goal", "method", "focus", "desiredInformation"]),
  "npc-exchange.v1": Object.freeze([
    "goal", "method", "utterance", "desiredResponse", "npcResponse",
  ]),
  "ordinary-check.v1": Object.freeze(["goal", "method", "intendedOutcome"]),
  "high-risk-action.v1": Object.freeze(["goal", "method", "intendedOutcome", "stakes"]),
  "in-world-refusal.v1": Object.freeze(["goal", "method", "reason", "alternatives"]),
  "materialization.v1": Object.freeze(["goal", "method", "proposedFact"]),
  "combat-action.v1": Object.freeze([
    "goal", "method", "intendedOutcome", "combatApproach",
  ]),
  "environmental-stunt.v1": Object.freeze([
    "goal", "method", "featureDescription", "intendedOutcome", "featureDisposition",
  ]),
  "compound.v1": Object.freeze([
    "goal", "method", "intendedOutcome", "stages", "composition",
  ]),
});

function semanticDraftSource(
  formId: KpFormId,
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const source: Record<string, unknown> = {};
  for (const field of FORM_SEMANTIC_FIELDS[formId]) {
    if (!Object.hasOwn(draft, field)) continue;
    if (field !== "stages") {
      source[field] = structuredClone(draft[field]);
      continue;
    }
    if (!Array.isArray(draft.stages)) {
      source.stages = structuredClone(draft.stages);
      continue;
    }
    source.stages = draft.stages.map((stage) => {
      if (!isRecord(stage)) return structuredClone(stage);
      const semantics: Record<string, unknown> = {};
      for (const key of ["goal", "method", "intendedOutcome"] as const) {
        if (Object.hasOwn(stage, key)) semantics[key] = structuredClone(stage[key]);
      }
      return semantics;
    });
  }
  return source;
}

function semanticFreezeSource(
  request: KpProposalRequest,
  formId: KpFormId,
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const input = isRecord(request.input) ? request.input : {};
  const projection = isRecord(request.projection) ? request.projection : {};
  const actorProjection = isRecord(projection.actorProjection)
    ? projection.actorProjection
    : projection;
  return {
    preparedActionId: request.preparedActionId,
    rootActionId: request.rootActionId,
    playerInput: structuredClone(input),
    authorityBinding: {
      stateVersion: actorProjection.stateVersion ?? projection.stateVersion ?? null,
      activeBranchId: actorProjection.activeBranchId ?? projection.activeBranchId ?? null,
      projectionHash: actorProjection.projectionHash ?? projection.projectionHash ?? null,
      runtimeProfiles: structuredClone(actorProjection.runtimeProfiles ?? projection.runtimeProfiles ?? null),
      moduleRef: structuredClone(projection.moduleRef ?? actorProjection.moduleRef ?? null),
    },
    formId,
    semanticIntent: semanticDraftSource(formId, draft),
  };
}

function assertRepairSemantics(
  request: KpProposalRequest,
  previousForm: KpFormId,
  previousDraft: Record<string, unknown>,
  repairedForm: KpFormId,
  repairedDraft: Record<string, unknown>,
  expectedHash: string,
  repairErrors: readonly string[] = [],
  rejectedRawArguments?: unknown,
): void {
  const previousSource = semanticFreezeSource(request, previousForm, previousDraft);
  if (stableStructuralHash(previousSource) !== expectedHash) {
    throw new PrivateFormEnvelopeError(repairedDraft, ["semantic-freeze:hash-mismatch"]);
  }
  const previousSemantics = semanticDraftSource(previousForm, previousDraft);
  const repairedSemantics = semanticDraftSource(repairedForm, repairedDraft);
  if (previousForm === repairedForm) {
    const recoveredRawMembers = recoveredRawSemanticMembers(rejectedRawArguments);
    const rawArgumentsProve = (key: string, value: unknown): boolean => {
      if (recoveredRawMembers === undefined
        || recoveredRawMembers.duplicateKeys.has(key)
        || !recoveredRawMembers.members.has(key)) return false;
      return canonicalJson(recoveredRawMembers.members.get(key)) === canonicalJson(value);
    };
    const semanticKeys = new Set([
      ...Object.keys(previousSemantics),
      ...Object.keys(repairedSemantics),
    ]);
    for (const key of semanticKeys) {
      if (!Object.hasOwn(repairedSemantics, key)) {
        throw new PrivateFormEnvelopeError(repairedDraft, [`semantic-freeze:${key}:changed`]);
      }
      if (!Object.hasOwn(previousSemantics, key)) {
        // A malformed JSON string may enter repair, but a semantic value that
        // was not parsed is accepted only when the complete bounded raw input
        // proves that exact direct top-level key/value pair.
        if (rawArgumentsProve(key, repairedSemantics[key])) continue;
        throw new PrivateFormEnvelopeError(repairedDraft, [`semantic-freeze:${key}:unproven`]);
      }
      const value = previousSemantics[key];
      if (canonicalJson(value) === canonicalJson(repairedSemantics[key])) continue;
      if (key === "desiredResponse") {
        const priorIntent = parsedJsonRecord(value);
        const repairedIntent = parsedJsonRecord(repairedSemantics[key]);
        const invalidEvidenceRefs = new Set(repairErrors.flatMap((error) => {
          const match = /^draft\.desiredResponse\.evidenceRefs:(.+):not-authoritative$/u.exec(error);
          return match === null ? [] : [match[1]];
        }));
        const onlyEvidenceErrors = invalidEvidenceRefs.size > 0
          && repairErrors.filter((error) => error.startsWith("draft.desiredResponse"))
            .every((error) => /^draft\.desiredResponse\.evidenceRefs:.+:not-authoritative$/u.test(error));
        if (onlyEvidenceErrors
          && priorIntent !== undefined
          && repairedIntent !== undefined
          && Array.isArray(priorIntent.evidenceRefs)) {
          const expectedIntent = {
            ...structuredClone(priorIntent),
            evidenceRefs: priorIntent.evidenceRefs.filter((reference) =>
              typeof reference === "string" && !invalidEvidenceRefs.has(reference)),
          };
          if (canonicalJson(expectedIntent) === canonicalJson(repairedIntent)) continue;
        }
      }
      // A malformed or invalid typed object cannot be repaired by replacing
      // the whole JSON field. NPC, goal, response mode, assertions, entities,
      // and materialized facts remain byte-for-byte frozen.
      throw new PrivateFormEnvelopeError(repairedDraft, [`semantic-freeze:${key}:changed`]);
    }
    return;
  }
  if (repairedForm !== "compound.v1"
    || !["ordinary-check.v1", "high-risk-action.v1"].includes(previousForm)) {
    throw new PrivateFormEnvelopeError(repairedDraft, ["semantic-freeze:form-upgrade-forbidden"]);
  }
  for (const key of ["goal", "method", "intendedOutcome"] as const) {
    if (Object.hasOwn(previousSemantics, key)
      && canonicalJson(previousSemantics[key]) !== canonicalJson(repairedSemantics[key])) {
      throw new PrivateFormEnvelopeError(repairedDraft, [`semantic-freeze:${key}:changed`]);
    }
  }
}

const BASIS_REFERENCE_KEYS = new Set([
  "ref", "referenceRef", "sourceRef", "profileRef", "dependencyRefs", "structuralRefs",
  "submissionRef", "characterRef", "controllerRef", "controlProofRef", "sceneRef",
  "sceneId", "entityId", "characterId", "encounterId", "definitionId", "factRef",
  "factRefs", "basisRef", "basisRefs", "primaryFactRef", "causalBasisRefs",
  "causalParentIds", "subjectRef",
  "subjectRefs", "precedentId", "precedentRefs", "dynamicDefinitionRefs", "rulesRef",
  "geometryRef", "featureId", "featureRef", "moduleRef", "eventRef", "occurrenceRef",
  "truthConstraintRefs", "npcRef",
  "knowledgeRef", "knowledgeRefs", "planId", "planRefs", "pendingRefs", "activityRefs",
  "planRef", "activityId", "activityRef", "premiseRef", "premiseRefs", "messageRef",
  "speakerRef", "fictionalTimeRef", "chapterId", "clueId", "receiptId", "entityRef",
  "entityRefs", "counterpartyRef", "counterpartyRefs", "relationshipId", "relationshipRef",
  "promiseId", "promiseRef", "debtId", "debtRef", "sceneQuestionId", "sceneQuestionRef",
  "threadRef", "threadRefs", "mechanicalDefinitionRef", "factionRef", "factionId",
]);
const ABILITY_REFERENCE_KEYS = new Set(["abilityRef", "abilityRefs", "dynamicDefinitionRefs"]);
const RESOURCE_REFERENCE_KEYS = new Set(["resourceRef", "resourceRefs"]);
const ITEM_REFERENCE_KEYS = new Set(["itemRef", "itemRefs", "itemEntryId", "itemEntryIds"]);

function finiteReferenceCatalog(contextPack: unknown): FiniteReferenceCatalog {
  const basisRefs = new Set<string>();
  const abilityRefs = new Set<string>();
  const resourceRefs = new Set<string>();
  const itemRefs = new Set<string>();
  const add = (target: Set<string>, value: unknown): void => {
    if (typeof value === "string" && value.trim().length > 0 && value.length <= 300) {
      target.add(value);
    }
  };
  const visit = (value: unknown, key = "", path = "", depth = 0): void => {
    if (depth > 14 || basisRefs.size >= 256) return;
    if (typeof value === "string") {
      if (BASIS_REFERENCE_KEYS.has(key)) add(basisRefs, value);
      if (ABILITY_REFERENCE_KEYS.has(key)
        || (/^(?:ability|spell|action|item):/u.test(value) && BASIS_REFERENCE_KEYS.has(key))) {
        add(abilityRefs, value);
      }
      if (RESOURCE_REFERENCE_KEYS.has(key)) add(resourceRefs, value);
      if (ITEM_REFERENCE_KEYS.has(key)) add(itemRefs, value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, key, path, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    if (path === "required.mechanics.resources") {
      for (const resourceRef of Object.keys(value)) add(resourceRefs, resourceRef);
    }
    for (const [childKey, child] of Object.entries(value)) {
      visit(child, childKey, path.length === 0 ? childKey : `${path}.${childKey}`, depth + 1);
    }
  };
  visit(contextPack);
  for (const ref of [...abilityRefs, ...resourceRefs, ...itemRefs]) basisRefs.add(ref);
  return Object.freeze({
    basisRefs: Object.freeze([...basisRefs].sort().slice(0, 192)),
    abilityRefs: Object.freeze([...abilityRefs].sort().slice(0, 96)),
    resourceRefs: Object.freeze([...resourceRefs].sort().slice(0, 96)),
    itemRefs: Object.freeze([...itemRefs].sort().slice(0, 96)),
  });
}

function formReferenceErrors(
  draft: Record<string, unknown>,
  finiteReferences: FiniteReferenceCatalog,
): readonly string[] {
  const allowedByField: Readonly<Record<string, Set<string>>> = {
    basisRefs: new Set(finiteReferences.basisRefs),
    abilityRef: new Set(finiteReferences.abilityRefs),
    resourceRef: new Set(finiteReferences.resourceRefs),
    itemRef: new Set(finiteReferences.itemRefs),
  };
  const errors: string[] = [];
  const visit = (value: unknown, key = "", path = "draft"): void => {
    // The compound composition owns a phase-aware reference environment: a
    // before-phase fact may be cited later, while mutually exclusive branches
    // must never lend identities to one another. The generic field-name walk
    // cannot represent that ordering and would reject legitimate new facts.
    if (key === "composition" && path === "draft.composition") return;
    if (key === "basisRefs") {
      if (!Array.isArray(value)) {
        errors.push(`${path}:array-required`);
        return;
      }
      for (const ref of value) {
        if (typeof ref !== "string" || !allowedByField.basisRefs.has(ref)) {
          errors.push(`${path}:${typeof ref === "string" ? ref : "invalid"}:not-authoritative`);
        }
      }
      return;
    }
    if (key === "abilityRef" || key === "resourceRef" || key === "itemRef") {
      if (typeof value !== "string" || !allowedByField[key].has(value)) {
        errors.push(`${path}:${typeof value === "string" ? value : "invalid"}:not-authoritative`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, "", `${path}[${index}]`));
      return;
    }
    if (!isRecord(value)) return;
    for (const [childKey, child] of Object.entries(value)) {
      visit(child, childKey, `${path}.${childKey}`);
    }
  };
  visit(draft);
  return Object.freeze([...new Set(errors)].sort());
}

function mechanicalDiagnosticErrors(value: unknown): readonly string[] {
  const diagnostics = Array.isArray(value) ? value : [value];
  const result: string[] = [];
  for (const diagnostic of diagnostics) {
    if (typeof diagnostic === "string" && diagnostic.trim().length > 0) {
      result.push(diagnostic.slice(0, 480));
      continue;
    }
    if (!isRecord(diagnostic)) continue;
    const fields = ["code", "path", "message", "expected", "actual"]
      .flatMap((key) => {
        const field = diagnostic[key];
        return typeof field === "string" || typeof field === "number" || typeof field === "boolean"
          ? [`${key}:${String(field).slice(0, 360)}`]
          : [];
      });
    if (fields.length > 0) result.push(fields.join("|"));
  }
  return Object.freeze([...new Set(result)].sort().slice(0, 40));
}

function shouldUpgradeRepairToCompound(errors: readonly string[]): boolean {
  return errors.some((error) => /(FORM_TOO_NARROW|formTooNarrow|requiresCompound)/u.test(error));
}

function priorPrivateProposal(value: unknown): V3AuthoritativeKpProposal | undefined {
  if (!isRecord(value)
    || value.kind !== "privateFormProposal"
    || typeof value.formId !== "string"
    || !(KP_FORM_IDS as readonly string[]).includes(value.formId)
    || !isRecord(value.draft)
    || typeof value.semanticFreezeHash !== "string"
    || typeof value.repairUsed !== "boolean") return undefined;
  return value as unknown as V3AuthoritativeKpProposal;
}

function validateNarrationRequest(request: KpNarrationRequest): void {
  requiredString(request.rootActionId);
  if (
    request.narrationPurpose !== undefined
    && !isKpNarrationRequestPurpose(request.narrationPurpose)
  ) throw new ModelOutputValidationError();
  if (!isRecord(request.receipt)) throw new ModelOutputValidationError();
  const status = request.receipt.status ?? request.receipt.kind;
  if (status !== "committed" && status !== "concluded") throw new ModelOutputValidationError();
  if (request.narrationInputMode === "frozenRenderableClaims-vnext-1") {
    const receiptId = requiredString(request.receipt.receiptId);
    if (
      !requiredString(request.viewerKey)
      || requiredString(request.receipt.rootActionId) !== request.rootActionId
      || !frozenRenderableClaimsConform(request.renderableClaims)
      || request.renderableClaims.claims.length === 0
      || request.renderableClaims.viewerKey !== request.viewerKey
      || request.renderableClaims.rootActionId !== request.rootActionId
      || request.renderableClaims.receiptId !== receiptId
    ) throw new ModelOutputValidationError();
    return;
  }
  if (request.narrationInputMode !== "observerProjection-v1") {
    throw new ModelOutputValidationError();
  }
  const audience = audienceIdentity(request.projection);
  if (!isRecord(request.projection) || !isRecord(request.projection.committedDelta)) {
    throw new ModelOutputValidationError();
  }
  const delta = request.projection.committedDelta;
  if (
    delta.schema !== "zhuwei.observer-committed-delta/v1"
    || requiredString(delta.viewerCharacterId) !== audience.viewerKey
    || !requiredString(delta.actorCharacterId)
    || !Array.isArray(delta.changes)
    || delta.changes.length === 0
    || delta.changes.some((change) => !isRecord(change) || !requiredString(change.kind))
    || !isRecord(delta.receipt)
    || requiredString(delta.receipt.rootActionId) !== request.rootActionId
    || requiredString(delta.receipt.receiptId) !== requiredString(request.receipt.receiptId)
    || delta.receipt.status !== status
  ) throw new ModelOutputValidationError();
}

/**
 * Creates the current KP boundary. It performs model I/O only; it owns no world state,
 * mechanics, randomness, delivery history, or authority to commit a proposal.
 */
export function createAuthoritativeKpAdapter(
  options: AuthoritativeKpAdapterOptions,
): AuthoritativeKpAdapter {
  if (!options?.ai || typeof options.ai.run !== "function") {
    throw new TypeError("A model binding is required for the authoritative KP adapter.");
  }
  const profile = options.profile ?? AUTHORITATIVE_KP_PROFILE;
  const registeredProfile = authoritativeKpProfileByBinding(
    profile.modelId,
    profile.modelProfileVersion,
  );
  if (
    registeredProfile === undefined
    || Object.keys(registeredProfile).length !== Object.keys(profile).length
    || Object.entries(registeredProfile).some(
      ([key, value]) => profile[key as keyof AuthoritativeKpProfile] !== value,
    )
  ) {
    throw new TypeError("A registered authoritative KP model profile is required.");
  }
  const now = options.now ?? Date.now;
  const invocationTimeoutMs = options.invocationTimeoutMs ?? DEFAULT_INVOCATION_TIMEOUT_MS;
  if (
    !Number.isFinite(invocationTimeoutMs) ||
    invocationTimeoutMs < 1 ||
    invocationTimeoutMs > DEFAULT_INVOCATION_TIMEOUT_MS
  ) {
    throw new TypeError("Authoritative KP timeout must be between 1 and 45000 milliseconds.");
  }

  async function invoke(
    task: InvocationTask,
    rootActionId: string,
    attempt: number,
    invocationPurpose: ModelInvocationPurpose,
    input: Record<string, unknown>,
    timeoutBudgetMs = invocationTimeoutMs,
  ): Promise<InvocationSuccess> {
    const startedAt = now();
    const abortController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          abortController.abort();
          reject(new ModelInvocationTimeoutError());
        }, timeoutBudgetMs);
      });
      const modelCall = options.ai.run(
        profile.modelId,
        input,
        { signal: abortController.signal },
      );
      const response = await Promise.race([modelCall, timeout]);
      const endedAt = now();
      return {
        response,
        receipt: receipt(
          profile,
          task,
          rootActionId,
          attempt,
          invocationPurpose,
          startedAt,
          endedAt,
          "success",
          {
            ...usageFrom(response),
            responseHash: await responseHash(response),
          },
        ),
      };
    } catch (error) {
      const endedAt = now();
      const result = classifyModelError(error);
      throw new AuthoritativeKpModelError(
        result,
        receipt(
          profile,
          task,
          rootActionId,
          attempt,
          invocationPurpose,
          startedAt,
          endedAt,
          result,
        ),
        retryAfterFrom(error),
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  function emitInvocationReceipt(value: ModelInvocationReceipt): void {
    try {
      options.onInvocationReceipt?.(structuredClone(value));
    } catch {
      // Observability must never change the model task's product outcome.
    }
  }

  async function withInvocationReceipt<T extends { modelInvocationReceipt: ModelInvocationReceipt }>(
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      const value = await operation();
      emitInvocationReceipt(value.modelInvocationReceipt);
      return value;
    } catch (error) {
      if (error instanceof AuthoritativeKpModelError) {
        emitInvocationReceipt(error.modelInvocationReceipt);
      }
      throw error;
    }
  }

  function v3Failure(
    publicCode: string,
    invocationReceipt: ModelInvocationReceipt,
    failureStage: ModelInvocationFailureStage,
  ): AuthoritativeKpModelError {
    return Object.assign(new AuthoritativeKpModelError(
      "modelPermanent",
      { ...invocationReceipt, result: "modelPermanent", failureStage },
    ), { publicCode });
  }

  async function prepareV3Context(
    request: KpProposalRequest,
    allowedForms: readonly KpFormId[],
  ): Promise<{
    contextPack: unknown;
    orderedForms: readonly KpFormId[];
    plannerReceipt?: unknown;
    retrievalReceipt?: unknown;
  }> {
    try {
      const prepared = options.prepareV3Context === undefined
        ? { contextPack: buildV3ContextPack(request, {
            includeDynamicAuthoritativeFacts: isSocialResolutionKpProfile(profile),
          }) }
        : await options.prepareV3Context(request, allowedForms);
      const ordered = prepared.orderedFormIds;
      const exactOrder = Array.isArray(ordered)
        && ordered.length === allowedForms.length
        && new Set(ordered).size === ordered.length
        && ordered.every((formId): formId is KpFormId =>
          typeof formId === "string" && allowedForms.includes(formId as KpFormId));
      return {
        contextPack: prepared.contextPack,
        orderedForms: exactOrder ? Object.freeze([...ordered]) : allowedForms,
        ...(prepared.plannerReceipt === undefined
          ? {}
          : { plannerReceipt: prepared.plannerReceipt }),
        ...(prepared.retrievalReceipt === undefined
          ? {}
          : { retrievalReceipt: prepared.retrievalReceipt }),
      };
    } catch (error) {
      const at = now();
      throw v3Failure(
        "CONTEXT_INSUFFICIENT",
        receipt(
          profile,
          "proposal",
          request.rootActionId,
          request.attempt,
          proposalInvocationPurpose(request),
          at,
          at,
          "modelPermanent",
        ),
        "contextPack",
      );
    }
  }

  /**
   * Player-facing names for the semantics a Form freezes, used only to ask
   * the player for the one thing the first draft never stated.
   */
  const SEMANTIC_FIELD_PROMPTS: Readonly<Record<string, string>> = Object.freeze({
    goal: "你想达成什么",
    method: "你具体打算怎么做",
    focus: "你想查看或回忆的具体对象",
    desiredInformation: "你想知道的具体是什么",
    intendedOutcome: "你希望的结果是什么",
    stakes: "失败会付出什么代价",
    utterance: "你想说的原话",
    desiredResponse: "你希望对方作何反应",
    proposedFact: "你想确立的具体事物",
    combatApproach: "你打算用什么方式攻击",
    featureDescription: "你想利用的环境细节",
    featureDisposition: "那个环境物件现在是什么状态",
    reason: "你不这么做的理由",
    alternatives: "你打算改做什么",
    question: "你想问的问题",
    choices: "可供选择的选项",
  });

  /**
   * The semantics a repair supplied that were never frozen, when that is the
   * *complete* reason the repair was rejected.
   *
   * Every Form lists its semantic fields as required, so a first draft that
   * validated always froze all of them. `unproven` can represent a genuine
   * omission, but it also represents invalid raw arguments. The caller checks
   * that provenance separately: only a parsed object with an exact missing
   * field becomes a question; all unparseable or non-object raw input stays
   * terminal because it cannot prove which top-level fields were omitted.
   */
  function omittedSemanticKeys(error: unknown): readonly string[] {
    if (!(error instanceof PrivateFormEnvelopeError)) return [];
    const errors = error.errors;
    if (!Array.isArray(errors) || errors.length === 0) return [];
    const keys: string[] = [];
    for (const entry of errors) {
      const match = typeof entry === "string"
        ? /^semantic-freeze:(.+):unproven$/u.exec(entry)
        : null;
      if (match === null) return [];
      keys.push(match[1]!);
    }
    return Object.freeze([...new Set(keys)].sort());
  }

  /**
   * Turns an omitted-semantics repair failure into one bounded question.
   *
   * This costs no model call, so it stays inside the two-invocation budget
   * SPEC 0015 6.1 freezes: the server writes the clarification itself from
   * the player's own frozen goal and the names of the missing fields, and
   * `requestClarification` lowers it to the existing `awaitingInput` path.
   * A clarification continuation is never converted again, so an answer that
   * still leaves a field unstated fails normally instead of looping.
   */
  function clarificationForOmittedSemantics(
    request: KpProposalRequest,
    rejectedDraft: unknown,
    omitted: readonly string[],
    invocationReceipt: ModelInvocationReceipt,
  ): V3AuthoritativeKpProposal {
    const prior = isRecord(rejectedDraft) ? rejectedDraft : {};
    // The rejected draft is usually empty here, so the player's own submitted
    // text is the best frozen statement of intent available. Both sources are
    // the player's; nothing is authored on their behalf.
    const playerText = trustedPlayerUtterance(request.input);
    const goal = typeof prior.goal === "string" && prior.goal.trim().length > 0
      ? prior.goal
      : playerText !== undefined && playerText.trim().length > 0
        ? playerText
        : "继续这项行动";
    const asked = omitted.map((key) => SEMANTIC_FIELD_PROMPTS[key] ?? key);
    return buildV3Proposal(
      request,
      {
        formId: "clarification.v1",
        draft: {
          goal,
          // Deliberately not phrased as "you left something out": the player
          // stated their intent, and it was this side that failed to turn it
          // into a readable draft. The question names what still has to be
          // pinned down without blaming them for it.
          // `assertRepairSemantics` throws on the first unprovable key, so
          // this is usually one aspect; the phrasing reads correctly either
          // way rather than assuming a plural.
          question: `为了裁定这项行动，请再具体说明：${asked.join("；")}。`,
          // `choices` is required by the Form but never reaches the player:
          // `ClarificationRequested` carries only the question and the client
          // renders a free-text answer. Naming the same aspects keeps the
          // value truthful instead of inventing options nobody will see.
          choices: asked,
        },
      },
      invocationReceipt,
      true,
    );
  }

  function buildV3Proposal(
    request: KpProposalRequest,
    envelope: PrivateFormEnvelope,
    invocationReceipt: ModelInvocationReceipt,
    repairUsed: boolean,
    semanticFreezeHash?: string,
  ): V3AuthoritativeKpProposal {
    const trustedDraft = envelope.formId === "npc-exchange.v1"
      && isSocialResolutionKpProfile(profile)
      ? {
          ...envelope.draft,
          utterance: trustedPlayerUtterance(request.input),
        }
      : envelope.draft;
    if (envelope.formId === "npc-exchange.v1"
      && isSocialResolutionKpProfile(profile)
      && typeof trustedDraft.utterance !== "string") {
      throw v3Failure("PROPOSAL_FORM_INVALID", invocationReceipt, "proposalSchema");
    }
    let causalActionProgram;
    try {
      causalActionProgram = compileKpFormDraft(envelope.formId, trustedDraft);
    } catch {
      throw v3Failure("PROPOSAL_FORM_INVALID", invocationReceipt, "proposalSchema");
    }
    const freezeHash = semanticFreezeHash
      ?? stableStructuralHash(semanticFreezeSource(request, envelope.formId, trustedDraft));
    return {
      kind: "privateFormProposal",
      formId: envelope.formId,
      draft: structuredClone(trustedDraft),
      causalActionProgram,
      loweredCausalProgram: lowerCausalActionProgram(causalActionProgram),
      finalSemanticHash: stableStructuralHash(
        semanticFreezeSource(request, envelope.formId, trustedDraft),
      ),
      semanticFreezeHash: freezeHash,
      repairUsed,
      proposalAttemptId: `${request.rootActionId}:kp:${request.attempt}`,
      modelInvocationReceipt: invocationReceipt,
    };
  }

  async function invokeV3Repair(input: Readonly<{
    request: KpProposalRequest;
    originalForm: KpFormId;
    selectedForm: KpFormId;
    rejectedDraft: Record<string, unknown>;
    rejectedRawArguments?: unknown;
    errors: readonly string[];
    finiteReferences: FiniteReferenceCatalog;
    semanticFreezeHash: string;
    startedAt: number;
  }>): Promise<V3AuthoritativeKpProposal> {
    if (stableStructuralHash(semanticFreezeSource(
      input.request,
      input.originalForm,
      input.rejectedDraft,
    )) !== input.semanticFreezeHash) {
      const at = now();
      throw v3Failure(
        "PROPOSAL_REPAIR_EXHAUSTED",
        receipt(
          profile,
          "proposal",
          input.request.rootActionId,
          2,
          "semanticRepair",
          at,
          at,
          "modelPermanent",
        ),
        "proposalSchema",
      );
    }
    const remainingInvocationMs = invocationTimeoutMs - Math.max(0, now() - input.startedAt);
    if (remainingInvocationMs < 1) {
      const at = now();
      throw v3Failure(
        "PROPOSAL_REPAIR_EXHAUSTED",
        receipt(
          profile,
          "proposal",
          input.request.rootActionId,
          2,
          "semanticRepair",
          at,
          at,
          "modelPermanent",
        ),
        "proposalSchema",
      );
    }
    const repairInvocation = await invoke(
      "proposal",
      input.request.rootActionId,
      2,
      "semanticRepair",
      privateFormRepairModelInput({
        rootActionRef: input.request.rootActionId,
        originalForm: input.originalForm,
        selectedForm: input.selectedForm,
        rejectedDraft: input.rejectedDraft,
        ...(input.rejectedRawArguments === undefined
          ? {}
          : { rejectedRawArguments: input.rejectedRawArguments }),
        errors: input.errors,
        finiteReferences: input.finiteReferences,
        semanticFreezeHash: input.semanticFreezeHash,
        // The repair carries the single Form the server already chose.
        structuredOutputMode: kpCallStructuredOutputMode(profile, 1),
      }),
      remainingInvocationMs,
    );
    let repaired: PrivateFormEnvelope;
    let trustedRepaired: PrivateFormEnvelope;
    try {
      repaired = validateNarrowToolRepair(
        input.selectedForm,
        repairInvocation.response,
        // Decode with the mode the repair request was actually sent in.
        kpCallStructuredOutputMode(profile, 1),
      );
      trustedRepaired = withTrustedSocialUtterance(
        input.request,
        repaired,
        isSocialResolutionKpProfile(profile),
      );
      const referenceErrors = formReferenceErrors(trustedRepaired.draft, input.finiteReferences);
      const socialErrors = trustedRepaired.formId === "npc-exchange.v1"
        && isSocialResolutionKpProfile(profile)
        ? socialFormSemanticErrors(trustedRepaired.draft, input.finiteReferences)
        : [];
      const materializationErrors = trustedRepaired.formId === "materialization.v1"
        && isSocialResolutionKpProfile(profile)
        ? materializationFormSemanticErrors(trustedRepaired.draft, input.finiteReferences)
        : [];
      const compoundErrors = trustedRepaired.formId === "compound.v1"
        ? compoundCompositionSemanticErrors(trustedRepaired.draft, input.finiteReferences)
        : [];
      if (referenceErrors.length > 0
        || socialErrors.length > 0
        || materializationErrors.length > 0
        || compoundErrors.length > 0) {
        throw new PrivateFormEnvelopeError(
          trustedRepaired,
          [...referenceErrors, ...socialErrors, ...materializationErrors, ...compoundErrors],
        );
      }
      assertRepairSemantics(
        input.request,
        input.originalForm,
        input.rejectedDraft,
        input.selectedForm,
        trustedRepaired.draft,
        input.semanticFreezeHash,
        input.errors,
        input.rejectedRawArguments,
      );
    } catch (error) {
      const omitted = omittedSemanticKeys(error);
      if (omitted.length > 0
        && input.request.proposalPurpose !== "clarificationContinuation"
        && input.rejectedRawArguments === undefined) {
        return clarificationForOmittedSemantics(
          input.request,
          input.rejectedDraft,
          omitted,
          repairInvocation.receipt,
        );
      }
      throw v3Failure(
        "PROPOSAL_REPAIR_EXHAUSTED",
        repairInvocation.receipt,
        "proposalSchema",
      );
    }
    return buildV3Proposal(
      input.request,
      trustedRepaired,
      repairInvocation.receipt,
      true,
      input.semanticFreezeHash,
    );
  }

  if (!isV3AuthoritativeKpProfile(profile)) {
    throw new TypeError("The current product accepts only the private narrow-tools KP profile.");
  }
  return {
      async propose(request) {
        return withInvocationReceipt(async () => {
          const rootActionId = typeof request?.rootActionId === "string"
            ? request.rootActionId
            : "invalid";
          const attempt = typeof request?.attempt === "number" ? request.attempt : 0;
          try {
            validateV3ProposalRequest(request);
          } catch {
            throw permanentContractError(
              profile,
              "proposal",
              rootActionId,
              attempt,
              proposalInvocationPurpose(request),
              now,
            );
          }

          const socialResolution = isSocialResolutionKpProfile(profile);
          const selected = selectAllowedKpForms(v3FormSelectionSignals(request, {
            socialResolution,
          }));
          const preparedContext = await prepareV3Context(request, selected);
          const finiteReferences = finiteReferenceCatalog(preparedContext.contextPack);

          if (request.attempt === 2) {
            const prior = priorPrivateProposal(request.priorProposal);
            if (prior === undefined || prior.repairUsed) {
              const at = now();
              throw v3Failure(
                "PROPOSAL_REPAIR_EXHAUSTED",
                receipt(
                  profile,
                  "proposal",
                  request.rootActionId,
                  2,
                  "semanticRepair",
                  at,
                  at,
                  "modelPermanent",
                ),
                "proposalSchema",
              );
            }
            const errors = mechanicalDiagnosticErrors(request.diagnostics);
            const upgrade = shouldUpgradeRepairToCompound(errors)
              && ["ordinary-check.v1", "high-risk-action.v1"].includes(prior.formId);
            const selectedForm = upgrade ? "compound.v1" : prior.formId as KpFormId;
            return invokeV3Repair({
              request,
              originalForm: prior.formId as KpFormId,
              selectedForm,
              rejectedDraft: prior.draft,
              errors: errors.length > 0 ? errors : ["PROPOSAL_RULES_DIAGNOSTIC"],
              finiteReferences,
              semanticFreezeHash: prior.semanticFreezeHash,
              startedAt: now(),
            });
          }

          const invocation = await invoke(
            "proposal",
            request.rootActionId,
            1,
            proposalInvocationPurpose(request),
            privateFormProposalModelInput({
              request,
              allowedForms: preparedContext.orderedForms,
              contextPack: preparedContext.contextPack,
              structuredOutputMode: kpCallStructuredOutputMode(
                profile,
                preparedContext.orderedForms.length,
              ),
            }),
          );
          try {
            const envelope = withTrustedSocialUtterance(request, privateFormNarrowToolEnvelope(
              invocation.response,
              preparedContext.orderedForms,
              // Decode with the mode the request was actually sent in.
              kpCallStructuredOutputMode(profile, preparedContext.orderedForms.length),
            ), socialResolution);
            const referenceErrors = formReferenceErrors(envelope.draft, finiteReferences);
            const socialErrors = envelope.formId === "npc-exchange.v1" && socialResolution
              ? socialFormSemanticErrors(envelope.draft, finiteReferences)
              : [];
            const materializationErrors = envelope.formId === "materialization.v1" && socialResolution
              ? materializationFormSemanticErrors(envelope.draft, finiteReferences)
              : [];
            const compoundErrors = envelope.formId === "compound.v1"
              ? compoundCompositionSemanticErrors(envelope.draft, finiteReferences)
              : [];
            if (referenceErrors.length > 0
              || socialErrors.length > 0
              || materializationErrors.length > 0
              || compoundErrors.length > 0) {
              throw new PrivateFormEnvelopeError(
                envelope,
                [...referenceErrors, ...socialErrors, ...materializationErrors, ...compoundErrors],
              );
            }
            return buildV3Proposal(request, envelope, invocation.receipt, false);
          } catch (error) {
            if (!(error instanceof PrivateFormEnvelopeError)) throw error;
            const failedReceipt: ModelInvocationReceipt = {
              ...invocation.receipt,
              result: "modelPermanent",
              failureStage: error.errors.some((entry) => entry.includes("not-authoritative"))
                ? "proposalReference"
                : "proposalSchema",
            };
            const candidate = isRecord(error.candidate) ? error.candidate : {};
            if (typeof candidate.formId !== "string"
              || !preparedContext.orderedForms.includes(candidate.formId as KpFormId)) {
              throw v3Failure("PROPOSAL_FORM_INVALID", failedReceipt, "proposalSchema");
            }
            emitInvocationReceipt(failedReceipt);
            const rejectedDraft = isRecord(candidate.draft) ? candidate.draft : {};
            const rejectedRawArguments = isRecord(candidate.rejectedRawArguments)
              ? candidate.rejectedRawArguments
              : undefined;
            const candidateForm = candidate.formId as KpFormId;
            const semanticFreezeHash = stableStructuralHash(
              semanticFreezeSource(request, candidateForm, rejectedDraft),
            );
            return invokeV3Repair({
              request,
              originalForm: candidateForm,
              selectedForm: candidateForm,
              rejectedDraft,
              ...(rejectedRawArguments === undefined
                ? {}
                : { rejectedRawArguments }),
              errors: error.errors,
              finiteReferences,
              semanticFreezeHash,
              startedAt: invocation.receipt.startedAt,
            });
          }
        });
      },

      async decideDueActorPlan(request: DueActorPlanDecisionRequest) {
        const rootActionId = typeof request?.rootActionId === "string"
          ? request.rootActionId
          : "invalid";
        try {
          let modelInput: Record<string, unknown>;
          try {
            modelInput = actorPlanDecisionModelInput(request);
          } catch {
            throw permanentContractError(
              profile,
              "proposal",
              rootActionId,
              1,
              "actorPlan",
              now,
            );
          }
          const invocation = await invoke(
            "proposal",
            request.rootActionId,
            1,
            "actorPlan",
            modelInput,
          );
          try {
            const structured = extractStructuredOutput(
              invocation.response,
              ACTOR_PLAN_DECISION_TOOL_NAME,
            );
            const candidate = unwrapSingleEnvelope(structured);
            const decision = validateActorPlanDecisionOutput(candidate, request, {
              npcEquipment: isSocialResolutionKpProfile(profile),
            });
            emitInvocationReceipt(invocation.receipt);
            return decision;
          } catch (error) {
            if (!(error instanceof ModelOutputValidationError)) throw error;
            throw v3Failure(
              "ACTOR_PLAN_DECISION_INVALID",
              invocation.receipt,
              "proposalSchema",
            );
          }
        } catch (error) {
          if (error instanceof AuthoritativeKpModelError) {
            emitInvocationReceipt(error.modelInvocationReceipt);
          }
          throw error;
        }
      },

      async narrate(request) {
        return withInvocationReceipt(async () => {
          const rootActionId = typeof request?.rootActionId === "string"
            ? request.rootActionId
            : "invalid";
          const attempt = Number.isInteger(request?.attempt) ? request.attempt as number : 1;
          const initialPurpose = narrationInvocationPurpose(request);
          try {
            validateNarrationRequest(request);
          } catch {
            throw permanentContractError(
              profile,
              "narration",
              rootActionId,
              attempt,
              initialPurpose,
              now,
            );
          }
          let invocation = await invoke(
            "narration",
            request.rootActionId,
            attempt,
            initialPurpose,
            request.narrationInputMode === "frozenRenderableClaims-vnext-1"
              ? frozenClaimsNarrationModelInput(request)
              : bodyOnlyNarrationModelInput(request, {
                  socialResolution: isSocialResolutionKpProfile(profile),
                }),
          );
          try {
            const structured = extractStructuredOutput(invocation.response, NARRATION_TOOL_NAME);
            const candidate = unwrapSingleEnvelope(structured);
            const narration = request.narrationInputMode
                === "frozenRenderableClaims-vnext-1"
              ? validateFrozenClaimsNarrationOutput(candidate, request)
              : validateBodyOnlyNarrationOutput(candidate, request.projection, {
                  socialResolution: isSocialResolutionKpProfile(profile),
                });
            return {
              ...narration,
              audience: request.narrationInputMode === "frozenRenderableClaims-vnext-1"
                ? {
                    viewerKey: request.viewerKey,
                    projectionHash: request.renderableClaims.projectionHash,
                  }
                : audienceIdentity(request.projection),
              modelInvocationReceipt: invocation.receipt,
            };
          } catch (error) {
            if (!(error instanceof ModelOutputValidationError)) throw error;
            const failed = v3Failure(
              error instanceof NarrationGroundingValidationError
                ? "NARRATION_GROUNDING_REJECTED"
                : "NARRATION_BODY_INVALID",
              invocation.receipt,
              error instanceof NarrationGroundingValidationError
                ? "narrationGrounding"
                : "narrationSchema",
            );
            if (
              !(error instanceof NarrationGroundingValidationError)
              || (request.narrationInputMode !== "frozenRenderableClaims-vnext-1"
                && !isSocialResolutionKpProfile(profile))
            ) throw failed;
            const remainingInvocationMs = invocationTimeoutMs - Math.max(
              0,
              now() - invocation.receipt.startedAt,
            );
            if (remainingInvocationMs < 1) throw failed;
            emitInvocationReceipt(failed.modelInvocationReceipt);
            invocation = await invoke(
              "narration",
              request.rootActionId,
              attempt,
              narrationGroundingRepairPurpose(initialPurpose),
              request.narrationInputMode === "frozenRenderableClaims-vnext-1"
                ? frozenClaimsNarrationGroundingReplacementModelInput(request)
                : bodyOnlyNarrationGroundingReplacementModelInput(request, {
                    socialResolution: isSocialResolutionKpProfile(profile),
                  }),
              remainingInvocationMs,
            );
            try {
              const structured = extractStructuredOutput(invocation.response, NARRATION_TOOL_NAME);
              const candidate = unwrapSingleEnvelope(structured);
              const narration = request.narrationInputMode
                  === "frozenRenderableClaims-vnext-1"
                ? validateFrozenClaimsNarrationOutput(candidate, request)
                : validateBodyOnlyNarrationOutput(candidate, request.projection, {
                    socialResolution: isSocialResolutionKpProfile(profile),
                  });
              return {
                ...narration,
                audience: request.narrationInputMode
                    === "frozenRenderableClaims-vnext-1"
                  ? {
                      viewerKey: request.viewerKey,
                      projectionHash: request.renderableClaims.projectionHash,
                    }
                  : audienceIdentity(request.projection),
                modelInvocationReceipt: invocation.receipt,
              };
            } catch (replacementError) {
              if (!(replacementError instanceof ModelOutputValidationError)) throw replacementError;
              throw v3Failure(
                replacementError instanceof NarrationGroundingValidationError
                  ? "NARRATION_GROUNDING_REJECTED"
                  : "NARRATION_BODY_INVALID",
                invocation.receipt,
                replacementError instanceof NarrationGroundingValidationError
                  ? "narrationGrounding"
                  : "narrationSchema",
              );
            }
          }
        });
      },
  };
}
