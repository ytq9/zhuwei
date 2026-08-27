import type {
  AdjudicationPrecedentProposal,
  ActorPlanProposal,
  ActionPlanCost,
  ActionPlanEffect,
  CurrentNarrationDraft,
  DynamicMaterialization,
  FictionDuration,
  JsonObject,
  JsonValue,
  InheritanceAuthorizationProposal,
  KpProposalDraft,
  ModuleMigrationProposal,
  ModelInvocationResult,
  NarrationAgencyClaim,
  NpcActionProposal,
  ProposalPendingInput,
  ProposalRisk,
  SceneProposal,
  SemanticActionPlan,
} from "./authoritative-types";
import {
  ACTION_PLAN_ABILITIES,
  ACTION_PLAN_CHECK_MODES,
  ACTION_PLAN_COST_KINDS,
  ACTION_PLAN_EFFECT_KINDS,
  ACTION_PLAN_OPERATIONS,
  CAMPAIGN_LIFECYCLE_ACTIONS,
  NARRATION_AGENCY_CLAIM_KINDS,
  NARRATION_AGENCY_SUBJECT_KINDS,
} from "./authoritative-types";

type UnknownRecord = Record<string, unknown>;

const FEASIBILITY_KINDS = new Set([
  "directSuccess",
  "checkRequired",
  "highRiskFeasible",
  "missingPrerequisite",
  "worldLawViolation",
]);
const DURATION_UNITS = new Set(["round", "second", "minute", "hour", "day"]);
const RETRY_GATES = new Set([
  "methodChanged",
  "factsChanged",
  "costAccepted",
  "positionChanged",
  "materialAssistance",
  "situationAdvanced",
]);
const MATERIALIZATION_KINDS = new Set([
  "fact",
  "location",
  "passage",
  "npc",
  "enemy",
  "item",
  "faction",
  "hazard",
  "opportunity",
  "ability",
]);
const INHERITANCE_SOURCE_KINDS = new Set([
  "will",
  "explicitGift",
  "recovery",
  "publicRecord",
  "organizationGrant",
  "npcIntroduction",
  "knowledgePropagation",
]);
const INHERITANCE_SCOPE_BY_KIND = {
  artifact: "transferPossession",
  knowledge: "acquireExactKnowledge",
  relationship: "establishDerivedRelationship",
  debt: "assumeDebtObligation",
  promise: "assumePromiseObligation",
} as const;
const ACTION_PLAN_OPERATION_SET = new Set<string>(ACTION_PLAN_OPERATIONS);
const ACTION_PLAN_COST_KIND_SET = new Set<string>(ACTION_PLAN_COST_KINDS);
const ACTION_PLAN_EFFECT_KIND_SET = new Set<string>(ACTION_PLAN_EFFECT_KINDS);
const ACTION_PLAN_ABILITY_SET = new Set<string>(ACTION_PLAN_ABILITIES);
const ACTION_PLAN_CHECK_MODE_SET = new Set<string>(ACTION_PLAN_CHECK_MODES);
const UNCERTAINTY_BEARING_OPERATIONS = new Set<string>([
  "resolveNoncombatCheck",
  "resolveNoncombatContest",
  "resolveNoncombatSave",
  "retryFailedAction",
  "startCombat",
  "invokeCombatAction",
  "resolveReaction",
]);
function normalizeMechanicalKey(key: string): string {
  return key.toLowerCase().replaceAll("_", "").replaceAll("-", "");
}

const FORBIDDEN_MECHANICAL_KEYS = new Set([
  "principal_id",
  "principal",
  "principalId",
  "actor_id",
  "actor",
  "actorId",
  "state",
  "worldState",
  "state_patch",
  "statePatch",
  "worldStatePatch",
  "world_state",
  "world_state_patch",
  "event",
  "events",
  "eventLog",
  "event_log",
  "expectedRevision",
  "scopeVersion",
  "scopeVersions",
  "ruleset_version",
  "rulesetVersion",
  "profile_id",
  "profile",
  "profileId",
  "dice",
  "die",
  "face",
  "faces",
  "randomnessResult",
  "dieFace",
  "dieFaces",
  "d20Roll",
  "d20Rolls",
  "initiativeRolls",
  "damageRolls",
  "automaticPass",
  "autoPass",
  "autoTarget",
  "targetSelector",
  "mechanicOps",
  "mechanicGraph",
  "compiledGraph",
  "compiledHash",
  "compilerProfile",
  "definitionHash",
  "referenceClosure",
  "opId",
  "sourcePath",
  "setPath",
  "jsonPatch",
  "script",
  "callback",
  "emit",
  "eventPayload",
  "function",
  "sql",
].map(normalizeMechanicalKey));

export class ModelOutputValidationError extends Error {
  constructor() {
    super("模型返回的结构化结果不符合权威 KP 协议。");
    this.name = "ModelOutputValidationError";
  }
}

export class ModelInvocationTimeoutError extends Error {
  constructor() {
    super("权威 KP 模型调用超时。");
    this.name = "ModelInvocationTimeoutError";
  }
}

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalValue(value: unknown, seen: WeakSet<object>, depth: number): JsonValue {
  if (depth > 50) throw new TypeError("JSON value is too deeply nested");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON numbers must be finite");
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("JSON value contains a cycle");
    seen.add(value);
    const normalized = value.map((item) => canonicalValue(item, seen, depth + 1));
    seen.delete(value);
    return normalized;
  }
  if (isRecord(value)) {
    if (seen.has(value)) throw new TypeError("JSON value contains a cycle");
    seen.add(value);
    const normalized: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined) continue;
      normalized[key] = canonicalValue(item, seen, depth + 1);
    }
    seen.delete(value);
    return normalized;
  }
  throw new TypeError("Value is not JSON serializable");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, new WeakSet(), 0));
}

export async function responseHash(value: unknown): Promise<string> {
  let normalized: string;
  try {
    normalized = canonicalJson(value);
  } catch {
    normalized = "[unserializable-model-response]";
  }
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

function invalid(): never {
  throw new ModelOutputValidationError();
}

function exactKeys(record: UnknownRecord, allowed: readonly string[], required = allowed): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedSet.has(key))) invalid();
  if (required.some((key) => !(key in record))) invalid();
}

function boundedString(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string") invalid();
  const text = value.trim();
  if ((!allowEmpty && text.length === 0) || text.length > maximum) invalid();
  return text;
}

function stringArray(value: unknown, maximumItems = 40, maximumLength = 240): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) invalid();
  const strings = value.map((item) => boundedString(item, maximumLength));
  if (new Set(strings).size !== strings.length) invalid();
  return strings;
}

function optionalFictionDuration(value: unknown): FictionDuration | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) invalid();
  exactKeys(value, ["unit", "value"]);
  if (typeof value.unit !== "string" || !DURATION_UNITS.has(value.unit)) invalid();
  if (typeof value.value !== "number" || !Number.isFinite(value.value) || value.value <= 0) invalid();
  return value as FictionDuration;
}

function proposalRisk(value: unknown): ProposalRisk | null {
  if (value === null) return null;
  if (!isRecord(value)) invalid();
  exactKeys(value, ["warning", "successConsequences", "failureConsequences", "retryGate"]);
  const retryGate = stringArray(value.retryGate, 6, 40);
  if (retryGate.some((entry) => !RETRY_GATES.has(entry))) invalid();
  return {
    warning: boundedString(value.warning, 480),
    successConsequences: stringArray(value.successConsequences),
    failureConsequences: stringArray(value.failureConsequences),
    retryGate: retryGate as ProposalRisk["retryGate"],
  };
}

function proposalPendingInput(value: unknown): ProposalPendingInput | null {
  if (value === null) return null;
  if (!isRecord(value)) invalid();
  exactKeys(value, ["kind", "prompt", "choices"]);
  if (value.kind !== "clarification" && value.kind !== "playerChoice") invalid();
  if (!Array.isArray(value.choices) || value.choices.length > 12) invalid();
  const choices = value.choices.map((choice) => {
    if (!isRecord(choice)) invalid();
    exactKeys(choice, ["id", "label", "consequence"]);
    return {
      id: boundedString(choice.id, 120),
      label: boundedString(choice.label, 160),
      consequence: boundedString(choice.consequence, 320),
    };
  });
  if (value.kind === "playerChoice" && choices.length < 2) invalid();
  return {
    kind: value.kind,
    prompt: boundedString(value.prompt, 480),
    choices,
  };
}

function adjudicationPrecedent(value: unknown): AdjudicationPrecedentProposal | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) invalid();
  if (value.kind !== "record" && value.kind !== "supersede") invalid();
  const supersede = value.kind === "supersede";
  exactKeys(
    value,
    supersede
      ? [
          "applicabilityScope",
          "kind",
          "materialDifferences",
          "publicRuleBasis",
          "supersededPrecedentId",
        ]
      : ["applicabilityScope", "kind", "publicRuleBasis"],
  );
  if (!isRecord(value.applicabilityScope)) invalid();
  exactKeys(value.applicabilityScope, ["kind", "ref"]);
  if (!["scene", "campaign", "module", "room"].includes(String(value.applicabilityScope.kind))) {
    invalid();
  }
  const publicRuleBasis = stringArray(value.publicRuleBasis, 12, 480);
  if (publicRuleBasis.length === 0) invalid();
  const common = {
    publicRuleBasis,
    applicabilityScope: {
      kind: value.applicabilityScope.kind as AdjudicationPrecedentProposal["applicabilityScope"]["kind"],
      ref: boundedString(value.applicabilityScope.ref, 240),
    },
  };
  if (!supersede) return { kind: "record", ...common };
  const materialDifferences = stringArray(value.materialDifferences, 12, 480);
  if (materialDifferences.length === 0) invalid();
  return {
    kind: "supersede",
    supersededPrecedentId: boundedString(value.supersededPrecedentId, 240),
    materialDifferences,
    ...common,
  };
}

function jsonObject(value: unknown, path: string, seen = new WeakSet<object>(), depth = 0): JsonObject {
  if (!isRecord(value) || depth > 40) invalid();
  if (seen.has(value)) invalid();
  seen.add(value);
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_MECHANICAL_KEYS.has(normalizeMechanicalKey(key))) invalid();
    if (item === null || typeof item === "string" || typeof item === "boolean") {
      result[key] = item;
      continue;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) invalid();
      result[key] = item;
      continue;
    }
    if (Array.isArray(item)) {
      if (item.length > 100) invalid();
      result[key] = item.map((entry, index) => {
        if (isRecord(entry)) return jsonObject(entry, `${path}.${key}[${index}]`, seen, depth + 1);
        if (Array.isArray(entry)) invalid();
        if (entry === null || typeof entry === "string" || typeof entry === "boolean") return entry;
        if (typeof entry === "number" && Number.isFinite(entry)) return entry;
        invalid();
      });
      continue;
    }
    if (isRecord(item)) {
      result[key] = jsonObject(item, `${path}.${key}`, seen, depth + 1);
      continue;
    }
    invalid();
  }
  seen.delete(value);
  void path;
  return result;
}

function optionalStringField(
  record: UnknownRecord,
  key: string,
  maximum = 240,
): string | undefined {
  return key in record ? boundedString(record[key], maximum) : undefined;
}

function optionalNullableStringField(
  record: UnknownRecord,
  key: string,
  maximum = 120,
): string | null | undefined {
  if (!(key in record)) return undefined;
  return record[key] === null ? null : boundedString(record[key], maximum);
}

function optionalFiniteNumber(
  record: UnknownRecord,
  key: string,
  options: { integer?: boolean; minimum?: number; maximum?: number } = {},
): number | undefined {
  if (!(key in record)) return undefined;
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (options.integer === true && !Number.isInteger(value)) ||
    (options.minimum !== undefined && value < options.minimum) ||
    (options.maximum !== undefined && value > options.maximum)
  ) {
    invalid();
  }
  return value;
}

function optionalStringArrayField(record: UnknownRecord, key: string): string[] | undefined {
  if (!(key in record)) return undefined;
  const value = record[key];
  if (!Array.isArray(value) || value.length > 40) invalid();
  return value.map((entry) => boundedString(entry, 240));
}

function optionalDurationField(record: UnknownRecord, key: string): FictionDuration | undefined {
  return key in record ? optionalFictionDuration(record[key]) : undefined;
}

const ACTION_PLAN_COST_KEYS = [
  "kind",
  "artifactRef",
  "resourceRef",
  "amount",
  "distanceFeet",
  "slotLevel",
  "count",
  "duration",
] as const;

function actionPlanCost(value: unknown): ActionPlanCost {
  if (!isRecord(value)) invalid();
  exactKeys(value, ACTION_PLAN_COST_KEYS, ["kind"]);
  if (typeof value.kind !== "string" || !ACTION_PLAN_COST_KIND_SET.has(value.kind)) invalid();
  const artifactRef = optionalStringField(value, "artifactRef");
  const resourceRef = optionalStringField(value, "resourceRef");
  const amount = optionalFiniteNumber(value, "amount");
  const distanceFeet = optionalFiniteNumber(value, "distanceFeet");
  const slotLevel = optionalFiniteNumber(value, "slotLevel", {
    integer: true,
    minimum: 0,
    maximum: 9,
  });
  const count = optionalFiniteNumber(value, "count", { integer: true, minimum: 0 });
  const duration = optionalDurationField(value, "duration");
  return {
    kind: value.kind as ActionPlanCost["kind"],
    ...(artifactRef !== undefined ? { artifactRef } : {}),
    ...(resourceRef !== undefined ? { resourceRef } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(distanceFeet !== undefined ? { distanceFeet } : {}),
    ...(slotLevel !== undefined ? { slotLevel } : {}),
    ...(count !== undefined ? { count } : {}),
    ...(duration !== undefined ? { duration } : {}),
  };
}

const ACTION_PLAN_EFFECT_KEYS = [
  "kind",
  "artifactRef",
  "to",
  "observerRef",
  "evidence",
  "evidenceRef",
  "npcId",
  "entityRef",
  "targetRef",
  "resourceRef",
  "amount",
  "conditionRef",
  "sceneRef",
  "activityRef",
  "duration",
  "encounterRef",
  "knowledgeRef",
  "recipientRefs",
  "partyRef",
  "campaignRef",
  "chapterRef",
  "relationshipRef",
  "commitmentRef",
  "debtRef",
  "status",
  "value",
  "definitionRef",
] as const;

function actionPlanEffect(value: unknown): ActionPlanEffect {
  if (!isRecord(value)) invalid();
  exactKeys(value, ACTION_PLAN_EFFECT_KEYS, ["kind"]);
  if (typeof value.kind !== "string" || !ACTION_PLAN_EFFECT_KIND_SET.has(value.kind)) invalid();
  const strings = Object.fromEntries(
    [
      "artifactRef",
      "to",
      "observerRef",
      "evidenceRef",
      "npcId",
      "entityRef",
      "targetRef",
      "resourceRef",
      "conditionRef",
      "sceneRef",
      "activityRef",
      "encounterRef",
      "knowledgeRef",
      "partyRef",
      "campaignRef",
      "chapterRef",
      "relationshipRef",
      "commitmentRef",
      "debtRef",
      "definitionRef",
    ].flatMap((key) => {
      const field = optionalStringField(value, key);
      return field === undefined ? [] : [[key, field]];
    }),
  );
  const evidence = optionalStringField(value, "evidence", 480);
  const status = optionalStringField(value, "status", 120);
  const amount = optionalFiniteNumber(value, "amount");
  const duration = optionalDurationField(value, "duration");
  const recipientRefs = optionalStringArrayField(value, "recipientRefs");
  const primitiveValue = value.value;
  if (
    "value" in value &&
    primitiveValue !== null &&
    typeof primitiveValue !== "string" &&
    typeof primitiveValue !== "number" &&
    typeof primitiveValue !== "boolean"
  ) {
    invalid();
  }
  if (typeof primitiveValue === "number" && !Number.isFinite(primitiveValue)) invalid();
  return {
    kind: value.kind as ActionPlanEffect["kind"],
    ...strings,
    ...(evidence !== undefined ? { evidence } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(recipientRefs !== undefined ? { recipientRefs } : {}),
    ...("value" in value ? { value: primitiveValue as ActionPlanEffect["value"] } : {}),
  };
}

const ACTION_PLAN_KEYS = [
  "operation",
  "ability",
  "skill",
  "opposedAbility",
  "opposedSkill",
  "saveAbility",
  "dc",
  "mode",
  "duration",
  "frozenCosts",
  "success",
  "failure",
  "sourceEntityRef",
  "targetEntityRef",
  "targetEntityRefs",
  "encounterRef",
  "activityRef",
  "activityTransitions",
  "moduleMigration",
  "abilityRef",
  "reactionRef",
  "destinationRef",
  "destinationFeet",
  "restKind",
  "hitDiceToSpend",
  "arcaneRecoverySlotLevels",
  "resourceRef",
  "amount",
  "itemRef",
  "artifactRef",
  "artifactUse",
  "factionRef",
  "planRef",
  "knowledgeRef",
  "mediumFactRef",
  "recipientRefs",
  "partyRef",
  "partyAction",
  "pendingInputRef",
  "memberRefs",
  "campaignRef",
  "chapterRef",
  "inheritanceAuthorization",
  "inheritanceAuthorizationRef",
  "inheritanceSourceFactRef",
  "inheritanceSourceKind",
  "lifecycleAction",
  "experienceAmount",
  "continueAsNpc",
  "endingCandidateRef",
  "storyRef",
  "sequelStoryRef",
  "outcome",
  "choice",
  "precedentRef",
  "publicClause",
  "newOptions",
  "basisRefs",
  "unresolvedRefs",
  "consequenceRefs",
] as const;

function semanticActionPlan(value: unknown): SemanticActionPlan {
  if (!isRecord(value)) invalid();
  exactKeys(value, ACTION_PLAN_KEYS, ["operation"]);
  if (typeof value.operation !== "string" || !ACTION_PLAN_OPERATION_SET.has(value.operation)) {
    invalid();
  }
  for (const abilityKey of ["ability", "opposedAbility", "saveAbility"] as const) {
    const ability = value[abilityKey];
    if (ability !== undefined && (typeof ability !== "string" || !ACTION_PLAN_ABILITY_SET.has(ability))) {
      invalid();
    }
  }
  if (
    value.mode !== undefined &&
    (typeof value.mode !== "string" || !ACTION_PLAN_CHECK_MODE_SET.has(value.mode))
  ) {
    invalid();
  }
  if (value.restKind !== undefined && value.restKind !== "short" && value.restKind !== "long") {
    invalid();
  }
  if (
    value.artifactUse !== undefined
    && !["retain", "consume", "destroy"].includes(String(value.artifactUse))
  ) invalid();
  if (value.hitDiceToSpend !== undefined
    && (!Number.isSafeInteger(value.hitDiceToSpend) || Number(value.hitDiceToSpend) < 0)) invalid();
  if (value.arcaneRecoverySlotLevels !== undefined
    && (!Array.isArray(value.arcaneRecoverySlotLevels)
      || value.arcaneRecoverySlotLevels.length > 20
      || !value.arcaneRecoverySlotLevels.every((level) =>
        Number.isSafeInteger(level) && Number(level) >= 1 && Number(level) <= 5))) invalid();
  if (value.continueAsNpc !== undefined && typeof value.continueAsNpc !== "boolean") invalid();
  if (value.lifecycleAction !== undefined
    && !(CAMPAIGN_LIFECYCLE_ACTIONS as readonly unknown[]).includes(value.lifecycleAction)) invalid();
  if (value.inheritanceSourceKind !== undefined
    && (typeof value.inheritanceSourceKind !== "string"
      || !INHERITANCE_SOURCE_KINDS.has(value.inheritanceSourceKind))) invalid();
  if (value.experienceAmount !== undefined
    && (!Number.isSafeInteger(value.experienceAmount)
      || Number(value.experienceAmount) < 1
      || Number(value.experienceAmount) > 1_000_000)) invalid();
  if (
    value.partyAction !== undefined
    && ![
      "inviteMember",
      "cancelInvitation",
      "leave",
      "transferLeadership",
      "proposeMove",
      "moveIndividually",
    ].includes(String(value.partyAction))
  ) invalid();
  const skill = optionalNullableStringField(value, "skill");
  const opposedSkill = optionalNullableStringField(value, "opposedSkill");
  const duration = optionalDurationField(value, "duration");
  const frozenCosts = "frozenCosts" in value
    ? Array.isArray(value.frozenCosts) && value.frozenCosts.length <= 24
      ? value.frozenCosts.map(actionPlanCost)
      : invalid()
    : undefined;
  const effects = (key: "success" | "failure") => key in value
    ? Array.isArray(value[key]) && value[key].length <= 24
      ? value[key].map(actionPlanEffect)
      : invalid()
    : undefined;
  const success = effects("success");
  const failure = effects("failure");
  const stringKeys = [
    "sourceEntityRef",
    "targetEntityRef",
    "encounterRef",
    "activityRef",
    "abilityRef",
    "reactionRef",
    "destinationRef",
    "resourceRef",
    "itemRef",
    "artifactRef",
    "artifactUse",
    "factionRef",
    "planRef",
    "knowledgeRef",
    "mediumFactRef",
    "partyRef",
    "partyAction",
    "pendingInputRef",
    "campaignRef",
    "chapterRef",
    "inheritanceAuthorizationRef",
    "inheritanceSourceFactRef",
    "inheritanceSourceKind",
    "lifecycleAction",
    "endingCandidateRef",
    "storyRef",
    "sequelStoryRef",
    "outcome",
    "choice",
    "precedentRef",
    "publicClause",
  ] as const;
  const strings = Object.fromEntries(
    stringKeys.flatMap((key) => {
      const field = optionalStringField(
        value,
        key,
        key === "lifecycleAction" ? 120 : key === "outcome" || key === "choice" ? 480 : 240,
      );
      return field === undefined ? [] : [[key, field]];
    }),
  );
  const newOptions = "newOptions" in value
    ? Array.isArray(value.newOptions) && value.newOptions.length <= 12
      ? value.newOptions.map((entry) => {
          if (!isRecord(entry)) invalid();
          exactKeys(entry, ["id", "summary"]);
          return {
            id: boundedString(entry.id, 120),
            summary: boundedString(entry.summary, 320),
          };
        })
      : invalid()
    : undefined;
  const activityTransitions = "activityTransitions" in value
    ? Array.isArray(value.activityTransitions) && value.activityTransitions.length <= 24
      ? value.activityTransitions.map((entry) => {
          if (!isRecord(entry)) invalid();
          exactKeys(entry, ["activityId", "disposition"]);
          if (!["continue", "summarize", "interrupt", "complete"].includes(String(entry.disposition))) {
            invalid();
          }
          return {
            activityId: boundedString(entry.activityId, 240),
            disposition: entry.disposition as "continue" | "summarize" | "interrupt" | "complete",
          };
        })
      : invalid()
    : undefined;
  const moduleMigration = "moduleMigration" in value
    ? (() => {
        const entry = value.moduleMigration;
        if (!isRecord(entry)) invalid();
        exactKeys(entry, ["fromModuleRef", "migrationRef", "toModuleRef"]);
        const profileRef = (candidate: unknown): ModuleMigrationProposal["fromModuleRef"] => {
          if (!isRecord(candidate)) invalid();
          exactKeys(candidate, ["profileHash", "profileId"]);
          const profileId = boundedString(candidate.profileId, 240);
          const profileHash = boundedString(candidate.profileHash, 80);
          if (!/^sha256:[0-9a-f]{64}$/.test(profileHash)) invalid();
          return { profileId, profileHash };
        };
        return {
          fromModuleRef: profileRef(entry.fromModuleRef),
          toModuleRef: profileRef(entry.toModuleRef),
          migrationRef: profileRef(entry.migrationRef),
        };
      })()
    : undefined;
  const inheritanceAuthorization = "inheritanceAuthorization" in value
    ? (() => {
        const entry = value.inheritanceAuthorization;
        if (!isRecord(entry)) invalid();
        exactKeys(entry, ["authorizationId", "kind", "scope", "sourceRef", "targetRef"]);
        const kind = boundedString(entry.kind, 32) as InheritanceAuthorizationProposal["kind"];
        if (!Object.hasOwn(INHERITANCE_SCOPE_BY_KIND, kind)
          || INHERITANCE_SCOPE_BY_KIND[kind] !== entry.scope) invalid();
        return {
          authorizationId: boundedString(entry.authorizationId, 240),
          kind,
          sourceRef: boundedString(entry.sourceRef, 240),
          targetRef: boundedString(entry.targetRef, 240),
          scope: entry.scope as InheritanceAuthorizationProposal["scope"],
        };
      })()
    : undefined;
  const targetEntityRefs = optionalStringArrayField(value, "targetEntityRefs");
  const recipientRefs = optionalStringArrayField(value, "recipientRefs");
  const memberRefs = optionalStringArrayField(value, "memberRefs");
  const basisRefs = optionalStringArrayField(value, "basisRefs");
  const unresolvedRefs = optionalStringArrayField(value, "unresolvedRefs");
  const consequenceRefs = optionalStringArrayField(value, "consequenceRefs");
  const dc = optionalFiniteNumber(value, "dc");
  const destinationFeet = optionalFiniteNumber(value, "destinationFeet");
  const amount = optionalFiniteNumber(value, "amount");
  const experienceAmount = optionalFiniteNumber(value, "experienceAmount");
  return {
    operation: value.operation as SemanticActionPlan["operation"],
    ...(value.ability !== undefined ? { ability: value.ability as SemanticActionPlan["ability"] } : {}),
    ...(skill !== undefined ? { skill } : {}),
    ...(value.opposedAbility !== undefined
      ? { opposedAbility: value.opposedAbility as SemanticActionPlan["opposedAbility"] }
      : {}),
    ...(opposedSkill !== undefined ? { opposedSkill } : {}),
    ...(value.saveAbility !== undefined
      ? { saveAbility: value.saveAbility as SemanticActionPlan["saveAbility"] }
      : {}),
    ...(dc !== undefined ? { dc } : {}),
    ...(value.mode !== undefined ? { mode: value.mode as SemanticActionPlan["mode"] } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(frozenCosts !== undefined ? { frozenCosts } : {}),
    ...(success !== undefined ? { success } : {}),
    ...(failure !== undefined ? { failure } : {}),
    ...strings,
    ...(targetEntityRefs !== undefined ? { targetEntityRefs } : {}),
    ...(destinationFeet !== undefined ? { destinationFeet } : {}),
    ...(value.restKind !== undefined ? { restKind: value.restKind } : {}),
    ...(value.hitDiceToSpend === undefined ? {} : { hitDiceToSpend: Number(value.hitDiceToSpend) }),
    ...(value.arcaneRecoverySlotLevels === undefined
      ? {}
      : { arcaneRecoverySlotLevels: value.arcaneRecoverySlotLevels.map(Number).sort((left, right) => left - right) }),
    ...(amount !== undefined ? { amount } : {}),
    ...(experienceAmount !== undefined ? { experienceAmount } : {}),
    ...(recipientRefs !== undefined ? { recipientRefs } : {}),
    ...(memberRefs !== undefined ? { memberRefs } : {}),
    ...(basisRefs !== undefined ? { basisRefs } : {}),
    ...(unresolvedRefs !== undefined ? { unresolvedRefs } : {}),
    ...(consequenceRefs !== undefined ? { consequenceRefs } : {}),
    ...(newOptions !== undefined ? { newOptions } : {}),
    ...(activityTransitions !== undefined ? { activityTransitions } : {}),
    ...(moduleMigration !== undefined ? { moduleMigration } : {}),
    ...(inheritanceAuthorization !== undefined ? { inheritanceAuthorization } : {}),
    ...(value.continueAsNpc === undefined ? {} : { continueAsNpc: value.continueAsNpc }),
  } as SemanticActionPlan;
}

function nullableActionPlan(value: unknown): SemanticActionPlan | null {
  return value === null ? null : semanticActionPlan(value);
}

function dynamicMaterializations(value: unknown): DynamicMaterialization[] {
  if (!Array.isArray(value) || value.length > 12) invalid();
  return value.map((entry, index) => {
    if (!isRecord(entry)) invalid();
    exactKeys(entry, ["kind", "factRef", "causalBasisRefs", "visibilityPolicyRef", "definition"]);
    if (typeof entry.kind !== "string" || !MATERIALIZATION_KINDS.has(entry.kind)) invalid();
    return {
      kind: entry.kind as DynamicMaterialization["kind"],
      factRef: boundedString(entry.factRef, 160),
      causalBasisRefs: stringArray(entry.causalBasisRefs),
      visibilityPolicyRef: boundedString(entry.visibilityPolicyRef, 160),
      definition: jsonObject(entry.definition, `dynamicMaterializations[${index}].definition`),
    };
  });
}

function hiddenRealityCandidateSet(value: unknown): KpProposalDraft["hiddenRealityCandidateSet"] {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) invalid();
  exactKeys(value, ["candidateSetId", "candidates"]);
  if (!Array.isArray(value.candidates) || value.candidates.length < 2 || value.candidates.length > 12) invalid();
  const candidates = value.candidates.map((entry) => {
    if (!isRecord(entry)) invalid();
    exactKeys(entry, ["candidateId", "hiddenWeight", "kind", "factRef", "causalBasisRefs", "visibilityPolicyRef", "definition"]);
    if (!Number.isSafeInteger(entry.hiddenWeight) || Number(entry.hiddenWeight) <= 0) invalid();
    const [materialization] = dynamicMaterializations([{
      kind: entry.kind, factRef: entry.factRef, causalBasisRefs: entry.causalBasisRefs,
      visibilityPolicyRef: entry.visibilityPolicyRef, definition: entry.definition,
    }]);
    return { ...materialization, candidateId: boundedString(entry.candidateId, 160), hiddenWeight: Number(entry.hiddenWeight) };
  });
  if (new Set(candidates.map((candidate) => candidate.candidateId)).size !== candidates.length) invalid();
  return { candidateSetId: boundedString(value.candidateSetId, 160), candidates };
}

function actorPlan(value: unknown, knowledgeRefs: string[]): ActorPlanProposal {
  if (!isRecord(value)) invalid();
  exactKeys(value, [
    "activity",
    "alternateTarget",
    "due",
    "factionRef",
    "nextStep",
    "planId",
    "premiseRefs",
    "resourceRefs",
    "trace",
    "trigger",
  ], [
    "activity",
    "alternateTarget",
    "due",
    "nextStep",
    "planId",
    "premiseRefs",
    "resourceRefs",
    "trace",
    "trigger",
  ]);
  const premiseRefs = stringArray(value.premiseRefs, 40, 240);
  if (premiseRefs.length === 0 || premiseRefs.some((reference) => !knowledgeRefs.includes(reference))) {
    invalid();
  }
  if (!isRecord(value.activity)) invalid();
  exactKeys(value.activity, ["activityId", "activityKind", "intendedDurationMicros"]);
  const intendedDurationMicros = boundedString(value.activity.intendedDurationMicros, 40);
  if (!/^[1-9][0-9]*$/.test(intendedDurationMicros)) invalid();

  let due: ActorPlanProposal["due"] = null;
  if (value.due !== null) {
    if (!isRecord(value.due)) invalid();
    exactKeys(value.due, ["atFictionMicros", "kind"]);
    if (value.due.kind !== "fictionTime") invalid();
    const atFictionMicros = boundedString(value.due.atFictionMicros, 40);
    if (!/^(0|[1-9][0-9]*)$/.test(atFictionMicros)) invalid();
    due = { kind: "fictionTime", atFictionMicros };
  }

  let trigger: ActorPlanProposal["trigger"] = null;
  if (value.trigger !== null) {
    if (!isRecord(value.trigger) || typeof value.trigger.kind !== "string") invalid();
    if (value.trigger.kind === "committedEvent") {
      exactKeys(value.trigger, ["eventRef", "kind"]);
      trigger = { kind: "committedEvent", eventRef: boundedString(value.trigger.eventRef, 240) };
    } else if (value.trigger.kind === "knowledgeAcquired") {
      exactKeys(value.trigger, ["kind", "knowledgeRef"]);
      const knowledgeRef = boundedString(value.trigger.knowledgeRef, 240);
      if (!knowledgeRefs.includes(knowledgeRef)) invalid();
      trigger = { kind: "knowledgeAcquired", knowledgeRef };
    } else {
      invalid();
    }
  }
  if ((due === null) === (trigger === null)) invalid();

  if (!isRecord(value.trace)) invalid();
  exactKeys(value.trace, ["description", "factRef", "visibilityPolicyRef"]);
  if (!isRecord(value.alternateTarget)) invalid();
  exactKeys(value.alternateTarget, ["reason", "targetRef"]);
  return {
    ...(value.factionRef === undefined
      ? {}
      : { factionRef: boundedString(value.factionRef, 240) }),
    planId: boundedString(value.planId, 240),
    premiseRefs,
    nextStep: boundedString(value.nextStep, 480),
    resourceRefs: stringArray(value.resourceRefs, 40, 240),
    activity: {
      activityId: boundedString(value.activity.activityId, 240),
      activityKind: boundedString(value.activity.activityKind, 120),
      intendedDurationMicros,
    },
    due,
    trigger,
    trace: {
      factRef: boundedString(value.trace.factRef, 240),
      description: boundedString(value.trace.description, 480),
      visibilityPolicyRef: boundedString(value.trace.visibilityPolicyRef, 240),
    },
    alternateTarget: {
      targetRef: boundedString(value.alternateTarget.targetRef, 240),
      reason: boundedString(value.alternateTarget.reason, 480),
    },
  };
}

function npcActions(value: unknown): NpcActionProposal[] {
  if (!Array.isArray(value) || value.length > 12) invalid();
  return value.map((entry) => {
    if (!isRecord(entry)) invalid();
    exactKeys(
      entry,
      ["actorPlan", "goal", "knowledgeRefs", "mechanicalProposal", "method", "npcId"],
      ["goal", "knowledgeRefs", "mechanicalProposal", "method", "npcId"],
    );
    const knowledgeRefs = stringArray(entry.knowledgeRefs);
    return {
      npcId: boundedString(entry.npcId, 160),
      goal: boundedString(entry.goal, 480),
      method: boundedString(entry.method, 480),
      knowledgeRefs,
      ...(entry.actorPlan === undefined ? {} : { actorPlan: actorPlan(entry.actorPlan, knowledgeRefs) }),
      mechanicalProposal: nullableActionPlan(entry.mechanicalProposal),
    };
  });
}

function sceneProposal(value: unknown): SceneProposal {
  if (!isRecord(value)) invalid();
  exactKeys(value, ["question", "pressure", "opportunities", "conclusionCandidate"]);
  if (value.conclusionCandidate !== null && typeof value.conclusionCandidate !== "string") invalid();
  return {
    question: boundedString(value.question, 480),
    pressure: boundedString(value.pressure, 480, true),
    opportunities: stringArray(value.opportunities),
    conclusionCandidate:
      value.conclusionCandidate === null ? null : boundedString(value.conclusionCandidate, 320),
  };
}

export function validateProposal(value: unknown): KpProposalDraft {
  if (!isRecord(value)) invalid();
  exactKeys(
    value,
    [
      "kind",
      "goal",
      "method",
      "publicBasisRefs",
      "privateBasisRefs",
      "adjudicationPrecedent",
      "estimatedFictionTime",
      "risk",
      "pendingInput",
      "dynamicMaterializations",
      "hiddenRealityCandidateSet",
      "npcActions",
      "mechanicalProposal",
      "scene",
    ],
    [
      "kind",
      "goal",
      "method",
      "publicBasisRefs",
      "privateBasisRefs",
      "risk",
      "pendingInput",
      "dynamicMaterializations",
      "npcActions",
      "mechanicalProposal",
      "scene",
    ],
  );
  if (typeof value.kind !== "string" || !FEASIBILITY_KINDS.has(value.kind)) invalid();
  const risk = proposalRisk(value.risk);
  const pendingInput = proposalPendingInput(value.pendingInput);
  const precedent = adjudicationPrecedent(value.adjudicationPrecedent);
  const mechanicalProposal = nullableActionPlan(value.mechanicalProposal);
  if ((value.kind === "checkRequired" || value.kind === "highRiskFeasible") && (!risk || !mechanicalProposal)) {
    invalid();
  }
  if ((pendingInput === null) === (mechanicalProposal === null)) invalid();
  if (precedent !== null && mechanicalProposal === null) invalid();
  if (
    (value.kind === "missingPrerequisite" || value.kind === "worldLawViolation")
    && mechanicalProposal
    && !(value.kind === "missingPrerequisite"
      && mechanicalProposal.operation === "commitMeaningfulFailure")
    && mechanicalProposal.operation !== "rejectInfeasibleAction"
  ) {
    invalid();
  }
  if (
    mechanicalProposal?.operation === "rejectInfeasibleAction"
    && value.kind !== "missingPrerequisite"
    && value.kind !== "worldLawViolation"
  ) invalid();
  if (
    mechanicalProposal !== null
    && ((value.kind === "directSuccess"
      && UNCERTAINTY_BEARING_OPERATIONS.has(mechanicalProposal.operation))
      || (value.kind === "checkRequired"
        && !UNCERTAINTY_BEARING_OPERATIONS.has(mechanicalProposal.operation)))
  ) invalid();
  return {
    kind: value.kind as KpProposalDraft["kind"],
    goal: boundedString(value.goal, 480),
    method: boundedString(value.method, 480),
    publicBasisRefs: stringArray(value.publicBasisRefs),
    privateBasisRefs: stringArray(value.privateBasisRefs),
    adjudicationPrecedent: precedent,
    ...(value.estimatedFictionTime !== undefined
      ? { estimatedFictionTime: optionalFictionDuration(value.estimatedFictionTime) }
      : {}),
    risk,
    pendingInput,
    dynamicMaterializations: dynamicMaterializations(value.dynamicMaterializations),
    hiddenRealityCandidateSet: hiddenRealityCandidateSet(value.hiddenRealityCandidateSet),
    npcActions: npcActions(value.npcActions),
    mechanicalProposal,
    scene: sceneProposal(value.scene),
  };
}

export function assertProposalProjectionBound(
  proposal: KpProposalDraft,
  projection: unknown,
): void {
  const available = collectStrings(projection);
  const causalReferences = new Set([
    ...available,
    ...proposal.dynamicMaterializations.map((materialization) => materialization.factRef),
  ]);
  if (
    [...proposal.publicBasisRefs, ...proposal.privateBasisRefs].some(
      (reference) => !available.has(reference),
    ) ||
    (proposal.adjudicationPrecedent?.kind === "supersede"
      && !available.has(proposal.adjudicationPrecedent.supersededPrecedentId)) ||
    proposal.dynamicMaterializations.some((materialization) =>
      materialization.causalBasisRefs.some((reference) => !causalReferences.has(reference))
    ) || proposal.hiddenRealityCandidateSet?.candidates.some((candidate) =>
      candidate.causalBasisRefs.some((reference) => !causalReferences.has(reference))
    )
  ) {
    invalid();
  }

  const projectionRecord = isRecord(projection) ? projection : {};
  const npcViewerMap = isRecord(projectionRecord.npcViewers)
    ? projectionRecord.npcViewers
    : undefined;
  const legacyNpcViewers = Array.isArray(projectionRecord.npcViewers)
    ? projectionRecord.npcViewers.filter(isRecord)
    : [];
  for (const action of proposal.npcActions) {
    const keyedProjection = npcViewerMap?.[action.npcId];
    const npcProjection = isRecord(keyedProjection)
      ? keyedProjection
      : legacyNpcViewers.find((candidate) => {
          const viewer = isRecord(candidate.viewer) ? candidate.viewer : candidate;
          return viewer.npcId === action.npcId || viewer.id === action.npcId;
        });
    if (!npcProjection) invalid();
    const npcKnowledge = collectStrings(npcProjection);
    if (action.knowledgeRefs.some((reference) => !npcKnowledge.has(reference))) invalid();
  }
}

const NARRATION_AGENCY_SUBJECT_KIND_SET = new Set<string>(NARRATION_AGENCY_SUBJECT_KINDS);
const NARRATION_AGENCY_CLAIM_KIND_SET = new Set<string>(NARRATION_AGENCY_CLAIM_KINDS);
const PLAYER_OWNED_AGENCY_CLAIMS = new Set<string>([
  "thought",
  "emotion",
  "dialogue",
  "nextAction",
]);

export function validateNarrationAgencyClaims(
  value: unknown,
  projection: unknown,
): NarrationAgencyClaim[] {
  if (!isRecord(value) || !Array.isArray(value.agencyClaims) || value.agencyClaims.length > 24) {
    invalid();
  }
  const availableStrings = collectStrings(projection);
  const declaredProjectionRefs = Array.isArray(value.referencedProjectionRefs)
    ? new Set(stringArray(value.referencedProjectionRefs))
    : undefined;
  const claims = value.agencyClaims.map((claim) => {
    if (!isRecord(claim)) invalid();
    exactKeys(claim, ["subjectKind", "subjectRef", "claimKind", "basisRefs"]);
    if (
      typeof claim.subjectKind !== "string"
      || !NARRATION_AGENCY_SUBJECT_KIND_SET.has(claim.subjectKind)
      || typeof claim.claimKind !== "string"
      || !NARRATION_AGENCY_CLAIM_KIND_SET.has(claim.claimKind)
    ) invalid();
    const subjectRef = claim.subjectRef === null
      ? null
      : boundedString(claim.subjectRef, 240);
    if (
      (claim.subjectKind === "world" && subjectRef !== null)
      || (claim.subjectKind !== "world"
        && (subjectRef === null || !availableStrings.has(subjectRef)))
      || (claim.subjectKind === "world" && claim.claimKind !== "sensoryConsequence")
      || (claim.subjectKind === "playerCharacter"
        && PLAYER_OWNED_AGENCY_CLAIMS.has(claim.claimKind))
    ) invalid();
    const basisRefs = stringArray(claim.basisRefs, 12);
    if (
      basisRefs.length === 0
      || basisRefs.some((reference) => !availableStrings.has(reference))
      || (declaredProjectionRefs !== undefined
        && basisRefs.some((reference) => !declaredProjectionRefs.has(reference)))
    ) invalid();
    return {
      subjectKind: claim.subjectKind,
      subjectRef,
      claimKind: claim.claimKind,
      basisRefs,
    } as NarrationAgencyClaim;
  });
  const canonicalClaims = claims.map((claim) => canonicalJson(claim));
  if (new Set(canonicalClaims).size !== canonicalClaims.length) invalid();
  return claims;
}

export function validateNarration(value: unknown, projection: unknown): CurrentNarrationDraft {
  if (!isRecord(value)) invalid();
  exactKeys(value, ["body", "tts", "decisionPrompt", "referencedProjectionRefs", "agencyClaims"]);
  const referencedProjectionRefs = stringArray(value.referencedProjectionRefs);
  const availableStrings = collectStrings(projection);
  if (referencedProjectionRefs.some((reference) => !availableStrings.has(reference))) invalid();
  const agencyClaims = validateNarrationAgencyClaims(value, projection);
  return {
    body: boundedString(value.body, 1_600),
    tts: boundedString(value.tts, 900),
    decisionPrompt: boundedString(value.decisionPrompt, 480),
    referencedProjectionRefs,
    agencyClaims,
  };
}

function strictJsonObject(text: string): UnknownRecord {
  let value: unknown;
  try {
    value = JSON.parse(text.trim());
  } catch {
    invalid();
  }
  if (!isRecord(value)) invalid();
  return value;
}

function toolCalls(response: UnknownRecord): unknown[] | undefined {
  if (Array.isArray(response.tool_calls)) return response.tool_calls;
  if (!Array.isArray(response.choices) || response.choices.length !== 1) return undefined;
  const choice = response.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return undefined;
  return Array.isArray(choice.message.tool_calls) ? choice.message.tool_calls : undefined;
}

function responseText(response: UnknownRecord): string | undefined {
  if (typeof response.response === "string") return response.response;
  if (!Array.isArray(response.choices) || response.choices.length !== 1) return undefined;
  const choice = response.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return undefined;
  return typeof choice.message.content === "string" ? choice.message.content : undefined;
}

export function extractStructuredOutput(response: unknown, requiredToolName: string): UnknownRecord {
  if (!isRecord(response)) invalid();
  const calls = toolCalls(response);
  if (calls !== undefined) {
    if (calls.length !== 1 || !isRecord(calls[0])) invalid();
    const call = calls[0];
    const functionCall = isRecord(call.function) ? call.function : call;
    if (functionCall.name !== requiredToolName) invalid();
    if (typeof functionCall.arguments === "string") return strictJsonObject(functionCall.arguments);
    if (isRecord(functionCall.arguments)) return functionCall.arguments;
    invalid();
  }
  const text = responseText(response);
  if (text === undefined) invalid();
  return strictJsonObject(text);
}

export function collectStrings(value: unknown, output = new Set<string>(), seen = new WeakSet<object>()): Set<string> {
  if (typeof value === "string") {
    output.add(value);
    return output;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return output;
    seen.add(value);
    for (const item of value) collectStrings(item, output, seen);
    return output;
  }
  if (isRecord(value)) {
    if (seen.has(value)) return output;
    seen.add(value);
    for (const item of Object.values(value)) collectStrings(item, output, seen);
  }
  return output;
}

export function audienceIdentity(projection: unknown): { viewerKey: string; projectionHash: string } {
  if (!isRecord(projection)) invalid();
  const projectionHash = boundedString(projection.projectionHash, 240);
  const viewer = projection.viewer;
  let viewerKey: string | undefined;
  let viewerKind: string | undefined;
  if (isRecord(viewer)) {
    viewerKind = typeof viewer.kind === "string" ? viewer.kind : undefined;
    viewerKey = typeof viewer.viewerKey === "string"
      ? viewer.viewerKey
      : typeof viewer.id === "string"
        ? viewer.id
        : typeof viewer.characterId === "string"
          ? viewer.characterId
        : undefined;
  }
  if (!viewerKey && typeof projection.viewerKey === "string") viewerKey = projection.viewerKey;
  if (!viewerKey || viewerKind === "kp" || viewerKind === "npc" || viewerKind === "audit") invalid();
  return { viewerKey: boundedString(viewerKey, 240), projectionHash };
}

export function assertKpProjection(projection: unknown): void {
  if (!isRecord(projection)) invalid();
  const viewer = projection.viewer;
  const kind = viewer === "kp" ? viewer : isRecord(viewer) ? viewer.kind : undefined;
  if (kind !== "kp") invalid();
}

export function usageFrom(response: unknown): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} {
  if (!isRecord(response) || !isRecord(response.usage)) return {};
  const usage = response.usage;
  const inputTokens = numberField(usage, "prompt_tokens", "input_tokens");
  const outputTokens = numberField(usage, "completion_tokens", "output_tokens");
  const totalTokens = numberField(usage, "total_tokens");
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function numberField(record: UnknownRecord, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

export function classifyModelError(
  error: unknown,
): Exclude<ModelInvocationResult, "success"> {
  if (error instanceof ModelInvocationTimeoutError) return "modelTransient";
  if (error instanceof ModelOutputValidationError) return "modelPermanent";
  const record = isRecord(error) ? error : {};
  const status = typeof record.status === "number" ? record.status : undefined;
  const code = typeof record.code === "string" ? record.code.toLowerCase() : "";
  const name = error instanceof Error ? error.name.toLowerCase() : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    code.includes("quota_exhausted") ||
    code.includes("quotaexhausted") ||
    message.includes("quota exhausted") ||
    message.includes("neuron quota") ||
    status === 402
  ) {
    return "quotaExhausted";
  }
  if (
    name === "aborterror" ||
    name.includes("timeout") ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status !== undefined && status >= 500) ||
    code === "7505" ||
    code.includes("rate_limit") ||
    code.includes("capacity")
  ) {
    return "modelTransient";
  }
  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 422 ||
    code === "7502" ||
    code === "7504" ||
    code.includes("model_not_found") ||
    code.includes("permission")
  ) {
    return "modelPermanent";
  }
  return "modelTransient";
}

export function retryAfterFrom(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const value = error.retryAfter ?? error.retry_after;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
