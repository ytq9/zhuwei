import {
  AUTHORITATIVE_KP_PROFILE,
  authoritativeKpProfileByBinding,
  isSocialResolutionKpProfile,
  isV3AuthoritativeKpProfile,
  NARRATION_TOOL_NAME,
} from "./authoritative-policy";
import {
  compileKpFormDraft,
  lowerCausalActionProgram,
  stableStructuralHash,
} from "./causal-action-program";
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
  validateBodyOnlyNarrationOutput,
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
import { HEALING_POTION_ITEM_DEFINITION_ID } from "../rules/v2/items";
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
import type {
  AuthoritativeKpAdapter,
  AuthoritativeKpAdapterOptions,
  AuthoritativeKpProfile,
  DueActorPlanDecisionRequest,
  V3AuthoritativeKpProposal,
  KpNarrationRequest,
  KpProposalRequest,
  ModelInvocationFailureStage,
  ModelInvocationReceipt,
  ModelInvocationResult,
} from "./authoritative-types";

export { AUTHORITATIVE_KP_PROFILE } from "./authoritative-policy";
export type {
  AuthoritativeKpAdapter,
  AuthoritativeKpAdapterOptions,
  AuthoritativeKpProfile,
  AuthoritativeKpProposal,
  DueActorPlanDecision,
  DueActorPlanDecisionRequest,
  V3AuthoritativeKpProposal,
  CurrentNarration,
  KpNarrationRequest,
  KpProposalRequest,
  ModelInvocationReceipt,
  ModelInvocationResult,
  AuthoritativeModelBinding,
} from "./authoritative-types";

const DEFAULT_INVOCATION_TIMEOUT_MS = 45_000;

type InvocationTask = "proposal" | "narration";

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
  now: () => number,
): AuthoritativeKpModelError {
  const at = now();
  return new AuthoritativeKpModelError(
    "modelPermanent",
    receipt(profile, task, rootActionId, attempt, at, at, "modelPermanent"),
  );
}

function validateV3ProposalRequest(request: KpProposalRequest): void {
  requiredString(request.preparedActionId);
  requiredString(request.rootActionId);
  if (!Number.isInteger(request.attempt) || request.attempt < 1 || request.attempt > 2) {
    throw new ModelOutputValidationError();
  }
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

function narrowToolDraft(
  formId: KpFormId,
  argumentsValue: unknown,
): Record<string, unknown> {
  if (isRecord(argumentsValue)) return structuredClone(argumentsValue);
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
    if (isRecord(parsed)) return structuredClone(parsed);
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
  const draft = narrowToolDraft(formId, toolCall.arguments);
  const validation = validateKpFormDraft(formId, draft);
  if (!validation.ok) {
    throw new PrivateFormEnvelopeError({ formId, draft }, validation.errors);
  }
  return { formId, draft };
}

function validateNarrowToolRepair(
  selectedForm: KpFormId,
  response: unknown,
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
  const draft = narrowToolDraft(selectedForm, toolCall.arguments);
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
  if (draft.method !== "establishCharacterPremise"
    && draft.method !== "materializeDynamicNpc"
    && draft.method !== "materializeItem") return [];
  const errors: string[] = [];
  const basisRefs = new Set(Array.isArray(draft.basisRefs)
    ? draft.basisRefs.filter((entry): entry is string => typeof entry === "string")
    : []);
  const finiteRefs = new Set(finiteReferences.basisRefs);
  const value = parsedJsonRecord(draft.proposedFact);
  const cited = (reference: unknown): reference is string =>
    typeof reference === "string" && basisRefs.has(reference) && finiteRefs.has(reference);
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
  "compound.v1": Object.freeze(["goal", "method", "intendedOutcome", "stages"]),
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
  "ref", "sourceRef", "profileRef", "dependencyRefs", "structuralRefs",
  "submissionRef", "characterRef", "controllerRef", "controlProofRef", "sceneRef",
  "sceneId", "entityId", "characterId", "encounterId", "definitionId", "factRef",
  "factRefs", "precedentId", "precedentRefs", "dynamicDefinitionRefs", "rulesRef",
  "geometryRef", "moduleRef", "eventRef", "truthConstraintRefs", "npcRef",
  "knowledgeRef", "knowledgeRefs", "planId", "planRefs", "pendingRefs", "activityRefs",
  "messageRef", "speakerRef", "fictionalTimeRef", "chapterId", "clueId", "receiptId",
  "entityRef", "entityRefs", "threadRef", "threadRefs", "mechanicalDefinitionRef",
]);
const ABILITY_REFERENCE_KEYS = new Set(["abilityRef", "abilityRefs", "dynamicDefinitionRefs"]);
const RESOURCE_REFERENCE_KEYS = new Set(["resourceRef", "resourceRefs"]);
const ARTIFACT_REFERENCE_KEYS = new Set(["artifactRef", "artifactRefs", "itemRef", "itemRefs"]);

function finiteReferenceCatalog(contextPack: unknown): FiniteReferenceCatalog {
  const basisRefs = new Set<string>();
  const abilityRefs = new Set<string>();
  const resourceRefs = new Set<string>();
  const artifactRefs = new Set<string>();
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
      if (ARTIFACT_REFERENCE_KEYS.has(key)) add(artifactRefs, value);
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
  for (const ref of [...abilityRefs, ...resourceRefs, ...artifactRefs]) basisRefs.add(ref);
  return Object.freeze({
    basisRefs: Object.freeze([...basisRefs].sort().slice(0, 192)),
    abilityRefs: Object.freeze([...abilityRefs].sort().slice(0, 96)),
    resourceRefs: Object.freeze([...resourceRefs].sort().slice(0, 96)),
    artifactRefs: Object.freeze([...artifactRefs].sort().slice(0, 96)),
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
    artifactRef: new Set(finiteReferences.artifactRefs),
  };
  const errors: string[] = [];
  const visit = (value: unknown, key = "", path = "draft"): void => {
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
    if (key === "abilityRef" || key === "resourceRef" || key === "artifactRef") {
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
  if (!isRecord(request.receipt)) throw new ModelOutputValidationError();
  const status = request.receipt.status ?? request.receipt.kind;
  if (status !== "committed" && status !== "concluded") throw new ModelOutputValidationError();
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
        receipt: receipt(profile, task, rootActionId, attempt, startedAt, endedAt, "success", {
          ...usageFrom(response),
          responseHash: await responseHash(response),
        }),
      };
    } catch (error) {
      const endedAt = now();
      const result = classifyModelError(error);
      throw new AuthoritativeKpModelError(
        result,
        receipt(profile, task, rootActionId, attempt, startedAt, endedAt, result),
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
        receipt(profile, "proposal", request.rootActionId, request.attempt, at, at, "modelPermanent"),
        "contextPack",
      );
    }
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
        receipt(profile, "proposal", input.request.rootActionId, 2, at, at, "modelPermanent"),
        "proposalSchema",
      );
    }
    const remainingInvocationMs = invocationTimeoutMs - Math.max(0, now() - input.startedAt);
    if (remainingInvocationMs < 1) {
      const at = now();
      throw v3Failure(
        "PROPOSAL_REPAIR_EXHAUSTED",
        receipt(profile, "proposal", input.request.rootActionId, 2, at, at, "modelPermanent"),
        "proposalSchema",
      );
    }
    const repairInvocation = await invoke(
      "proposal",
      input.request.rootActionId,
      2,
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
      }),
      remainingInvocationMs,
    );
    let repaired: PrivateFormEnvelope;
    let trustedRepaired: PrivateFormEnvelope;
    try {
      repaired = validateNarrowToolRepair(input.selectedForm, repairInvocation.response);
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
      if (referenceErrors.length > 0
        || socialErrors.length > 0
        || materializationErrors.length > 0) {
        throw new PrivateFormEnvelopeError(
          trustedRepaired,
          [...referenceErrors, ...socialErrors, ...materializationErrors],
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
    } catch {
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
            throw permanentContractError(profile, "proposal", rootActionId, attempt, now);
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
                receipt(profile, "proposal", request.rootActionId, 2, at, at, "modelPermanent"),
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
            privateFormProposalModelInput({
              request,
              allowedForms: preparedContext.orderedForms,
              contextPack: preparedContext.contextPack,
            }),
          );
          try {
            const envelope = withTrustedSocialUtterance(request, privateFormNarrowToolEnvelope(
              invocation.response,
              preparedContext.orderedForms,
            ), socialResolution);
            const referenceErrors = formReferenceErrors(envelope.draft, finiteReferences);
            const socialErrors = envelope.formId === "npc-exchange.v1" && socialResolution
              ? socialFormSemanticErrors(envelope.draft, finiteReferences)
              : [];
            const materializationErrors = envelope.formId === "materialization.v1" && socialResolution
              ? materializationFormSemanticErrors(envelope.draft, finiteReferences)
              : [];
            if (referenceErrors.length > 0
              || socialErrors.length > 0
              || materializationErrors.length > 0) {
              throw new PrivateFormEnvelopeError(
                envelope,
                [...referenceErrors, ...socialErrors, ...materializationErrors],
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
            throw permanentContractError(profile, "proposal", rootActionId, 1, now);
          }
          const invocation = await invoke(
            "proposal",
            request.rootActionId,
            1,
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
          try {
            validateNarrationRequest(request);
          } catch {
            throw permanentContractError(profile, "narration", rootActionId, attempt, now);
          }
          let invocation = await invoke(
            "narration",
            request.rootActionId,
            attempt,
            bodyOnlyNarrationModelInput(request, {
              socialResolution: isSocialResolutionKpProfile(profile),
            }),
          );
          try {
            const structured = extractStructuredOutput(invocation.response, NARRATION_TOOL_NAME);
            const candidate = unwrapSingleEnvelope(structured);
            const narration = validateBodyOnlyNarrationOutput(candidate, request.projection, {
              socialResolution: isSocialResolutionKpProfile(profile),
            });
            return {
              ...narration,
              audience: audienceIdentity(request.projection),
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
              || !isSocialResolutionKpProfile(profile)
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
              bodyOnlyNarrationGroundingReplacementModelInput(request, {
                socialResolution: isSocialResolutionKpProfile(profile),
              }),
              remainingInvocationMs,
            );
            try {
              const structured = extractStructuredOutput(invocation.response, NARRATION_TOOL_NAME);
              const candidate = unwrapSingleEnvelope(structured);
              const narration = validateBodyOnlyNarrationOutput(candidate, request.projection, {
                socialResolution: isSocialResolutionKpProfile(profile),
              });
              return {
                ...narration,
                audience: audienceIdentity(request.projection),
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
