import type {
  ActionPlanAbility,
  ActionPlanCheckMode,
  ActionPlanCost,
  ActionPlanEffect,
  ActionPlanOperation,
  CurrentNarrationDraft,
  FictionDuration,
  JsonObject,
  JsonValue,
  ModelInvocationResult,
  NarrationAgencyClaim,
  NpcSemanticActionPlan,
} from "./authoritative-types";
import {
  ACTION_PLAN_ABILITIES,
  ACTION_PLAN_CHECK_MODES,
  ACTION_PLAN_COST_KINDS,
  ACTION_PLAN_EFFECT_KINDS,
  ACTION_PLAN_GEAR_ACTIONS,
  ACTION_PLAN_GEAR_SLOTS,
  ACTION_PLAN_OPERATIONS,
  NARRATION_AGENCY_CLAIM_KINDS,
  NARRATION_AGENCY_SUBJECT_KINDS,
} from "./authoritative-types";

type UnknownRecord = Record<string, unknown>;

const DURATION_UNITS = new Set(["round", "second", "minute", "hour", "day"]);
const ACTION_PLAN_OPERATION_SET = new Set<string>(ACTION_PLAN_OPERATIONS);
const ACTION_PLAN_COST_KIND_SET = new Set<string>(ACTION_PLAN_COST_KINDS);
const ACTION_PLAN_EFFECT_KIND_SET = new Set<string>(ACTION_PLAN_EFFECT_KINDS);
const ACTION_PLAN_ABILITY_SET = new Set<string>(ACTION_PLAN_ABILITIES);
const ACTION_PLAN_CHECK_MODE_SET = new Set<string>(ACTION_PLAN_CHECK_MODES);
const ACTION_PLAN_GEAR_ACTION_SET = new Set<string>(ACTION_PLAN_GEAR_ACTIONS);
const ACTION_PLAN_GEAR_SLOT_SET = new Set<string>(ACTION_PLAN_GEAR_SLOTS);
const NPC_FORBIDDEN_OPERATIONS = new Set<string>([
  "resolveNoncombatContest",
  "retryFailedAction",
  "advanceCampaignLifecycle",
]);
export class ModelOutputValidationError extends Error {
  constructor() {
    super("模型返回的结构化结果不符合权威 KP 协议。");
    this.name = "ModelOutputValidationError";
  }
}

export class NarrationGroundingValidationError extends ModelOutputValidationError {
  constructor() {
    super();
    this.name = "NarrationGroundingValidationError";
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

function groundingInvalid(): never {
  throw new NarrationGroundingValidationError();
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
  if (!Number.isSafeInteger(value.value) || Number(value.value) <= 0) invalid();
  return value as FictionDuration;
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

function actionPlanCost(value: unknown): ActionPlanCost {
  if (!isRecord(value)) invalid();
  if (typeof value.kind !== "string" || !ACTION_PLAN_COST_KIND_SET.has(value.kind)) invalid();
  switch (value.kind) {
    case "consumeResource": {
      exactKeys(value, ["amount", "kind", "resourceRef"]);
      const amount = optionalFiniteNumber(value, "amount", {
        integer: true,
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER,
      });
      return {
        kind: "consumeResource",
        resourceRef: boundedString(value.resourceRef, 240),
        amount: amount!,
      };
    }
    case "consumeItem": {
      exactKeys(value, ["count", "itemRef", "kind"], ["itemRef", "kind"]);
      const itemRef = boundedString(value.itemRef, 240);
      const count = optionalFiniteNumber(value, "count", {
        integer: true,
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER,
      });
      if (
        !itemRef.startsWith("item-entry:")
        || itemRef.length === "item-entry:".length
      ) invalid();
      return {
        kind: "consumeItem",
        itemRef,
        ...(count === undefined ? {} : { count }),
      };
    }
    case "fictionTime": {
      exactKeys(value, ["duration", "kind"]);
      return { kind: "fictionTime", duration: requiredDuration(value.duration) };
    }
    default:
      return invalid();
  }
}

function actionPlanEffect(value: unknown): ActionPlanEffect {
  if (!isRecord(value)) invalid();
  if (typeof value.kind !== "string" || !ACTION_PLAN_EFFECT_KIND_SET.has(value.kind)) invalid();
  switch (value.kind) {
    case "acquireEvidence": {
      exactKeys(value, ["definitionRef", "evidence", "evidenceRef", "kind"], ["evidenceRef", "kind"]);
      const definitionRef = optionalStringField(value, "definitionRef");
      const evidence = optionalStringField(value, "evidence", 480);
      return {
        kind: "acquireEvidence",
        evidenceRef: boundedString(value.evidenceRef, 240),
        ...(definitionRef === undefined ? {} : { definitionRef }),
        ...(evidence === undefined ? {} : { evidence }),
      };
    }
    case "acquireKnowledge": {
      exactKeys(value, ["definitionRef", "kind", "knowledgeRef", "value"], ["kind", "knowledgeRef"]);
      const definitionRef = optionalStringField(value, "definitionRef");
      const primitive = value.value;
      if (
        "value" in value
        && typeof primitive !== "string"
        && typeof primitive !== "number"
        && typeof primitive !== "boolean"
      ) invalid();
      if (typeof primitive === "number" && !Number.isFinite(primitive)) invalid();
      if (typeof primitive === "string" && primitive.length > 480) invalid();
      return {
        kind: "acquireKnowledge",
        knowledgeRef: boundedString(value.knowledgeRef, 240),
        ...(definitionRef === undefined ? {} : { definitionRef }),
        ...("value" in value ? { value: primitive as string | number | boolean } : {}),
      };
    }
    case "changeResource": {
      exactKeys(value, ["amount", "kind", "resourceRef", "targetRef"], ["amount", "kind", "resourceRef"]);
      const amount = optionalFiniteNumber(value, "amount", {
        integer: true,
        minimum: Number.MIN_SAFE_INTEGER,
        maximum: -1,
      });
      const targetRef = optionalStringField(value, "targetRef");
      return {
        kind: "changeResource",
        resourceRef: boundedString(value.resourceRef, 240),
        amount: amount!,
        ...(targetRef === undefined ? {} : { targetRef }),
      };
    }
    case "changeHitPoints": {
      exactKeys(value, ["amount", "kind", "targetRef"], ["amount", "kind"]);
      const amount = optionalFiniteNumber(value, "amount", {
        integer: true,
        minimum: Number.MIN_SAFE_INTEGER,
        maximum: Number.MAX_SAFE_INTEGER,
      });
      if (amount === 0) invalid();
      const targetRef = optionalStringField(value, "targetRef");
      return {
        kind: "changeHitPoints",
        amount: amount!,
        ...(targetRef === undefined ? {} : { targetRef }),
      };
    }
    case "alertNpc": {
      exactKeys(value, ["kind", "npcId", "status"], ["kind", "npcId"]);
      const status = optionalStringField(value, "status", 120);
      return {
        kind: "alertNpc",
        npcId: boundedString(value.npcId, 240),
        ...(status === undefined ? {} : { status }),
      };
    }
    case "moveEntity": {
      exactKeys(value, ["entityRef", "kind", "sceneRef"], ["kind", "sceneRef"]);
      const entityRef = optionalStringField(value, "entityRef");
      return {
        kind: "moveEntity",
        sceneRef: boundedString(value.sceneRef, 240),
        ...(entityRef === undefined ? {} : { entityRef }),
      };
    }
    case "advanceFictionTime": {
      exactKeys(value, ["duration", "kind"]);
      return { kind: "advanceFictionTime", duration: requiredDuration(value.duration) };
    }
    case "updateRelationship": {
      exactKeys(
        value,
        ["definitionRef", "kind", "recipientRefs", "relationshipRef", "value"],
        ["kind", "recipientRefs", "relationshipRef", "value"],
      );
      const definitionRef = optionalStringField(value, "definitionRef");
      const recipientRefs = stringArray(value.recipientRefs);
      if (recipientRefs.length === 0) invalid();
      return {
        kind: "updateRelationship",
        relationshipRef: boundedString(value.relationshipRef, 240),
        recipientRefs,
        value: boundedString(value.value, 480),
        ...(definitionRef === undefined ? {} : { definitionRef }),
      };
    }
    case "recordCommitment":
      exactKeys(value, ["commitmentRef", "kind", "status", "targetRef", "value"]);
      return {
        kind: "recordCommitment",
        commitmentRef: boundedString(value.commitmentRef, 240),
        targetRef: boundedString(value.targetRef, 240),
        value: boundedString(value.value, 480),
        status: boundedString(value.status, 120),
      };
    case "recordDebt": {
      exactKeys(
        value,
        ["debtRef", "definitionRef", "kind", "status", "targetRef", "value"],
        ["debtRef", "kind", "status", "targetRef", "value"],
      );
      const definitionRef = optionalStringField(value, "definitionRef");
      return {
        kind: "recordDebt",
        debtRef: boundedString(value.debtRef, 240),
        targetRef: boundedString(value.targetRef, 240),
        value: boundedString(value.value, 480),
        status: boundedString(value.status, 120),
        ...(definitionRef === undefined ? {} : { definitionRef }),
      };
    }
    default:
      return invalid();
  }
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
  "itemActivityId",
  "ownershipDisposition",
  "factionRef",
  "planRef",
  "knowledgeRef",
  "mediumFactRef",
  "recipientRefs",
  "partyRef",
  "partyAction",
  "pendingInputRef",
  "memberRefs",
  "outcome",
  "choice",
  "precedentRef",
  "publicClause",
  "newOptions",
  "basisRefs",
  "unresolvedRefs",
  "consequenceRefs",
] as const;

function requiredDuration(value: unknown): FictionDuration {
  const duration = optionalFictionDuration(value);
  if (duration === undefined) invalid();
  return duration;
}

function actionPlanCosts(value: unknown): ActionPlanCost[] {
  if (!Array.isArray(value) || value.length > 24) invalid();
  return value.map(actionPlanCost);
}

function actionPlanEffects(value: unknown): ActionPlanEffect[] {
  if (!Array.isArray(value) || value.length > 24) invalid();
  const effects = value.map(actionPlanEffect);
  if (effects.filter(({ kind }) => kind === "moveEntity").length > 1) invalid();
  if (effects.filter(({ kind }) => kind === "changeHitPoints").length > 1) invalid();
  return effects;
}

function strictResolutionActionPlan(
  value: UnknownRecord,
): NpcSemanticActionPlan | undefined {
  if (value.operation === "resolveDirectConsequences") {
    exactKeys(value, ["duration", "failure", "frozenCosts", "operation", "success"]);
    if (!Array.isArray(value.frozenCosts) || value.frozenCosts.length !== 0) invalid();
    if (!Array.isArray(value.failure) || value.failure.length !== 0) invalid();
    return {
      operation: "resolveDirectConsequences",
      duration: requiredDuration(value.duration),
      frozenCosts: [],
      success: actionPlanEffects(value.success),
      failure: [],
    };
  }

  if (
    value.operation !== "resolveNoncombatCheck"
    && value.operation !== "resolveNoncombatSave"
  ) return undefined;

  const savingThrow = value.operation === "resolveNoncombatSave";
  const required = savingThrow
    ? [
        "dc",
        "duration",
        "failure",
        "frozenCosts",
        "mode",
        "operation",
        "saveAbility",
        "success",
      ]
    : [
        "ability",
        "dc",
        "duration",
        "failure",
        "frozenCosts",
        "mode",
        "operation",
        "skill",
        "success",
      ];
  exactKeys(value, required);
  if (
    !Number.isSafeInteger(value.dc)
    || Number(value.dc) < 0
    || Number(value.dc) > 30
    || typeof value.mode !== "string"
    || !ACTION_PLAN_CHECK_MODE_SET.has(value.mode)
  ) invalid();
  const common = {
    dc: Number(value.dc),
    mode: value.mode as ActionPlanCheckMode,
    duration: requiredDuration(value.duration),
    frozenCosts: actionPlanCosts(value.frozenCosts),
    success: actionPlanEffects(value.success),
    failure: actionPlanEffects(value.failure),
  };
  if (savingThrow) {
    if (typeof value.saveAbility !== "string" || !ACTION_PLAN_ABILITY_SET.has(value.saveAbility)) invalid();
    return {
      operation: "resolveNoncombatSave",
      saveAbility: value.saveAbility as ActionPlanAbility,
      ...common,
    };
  }
  if (typeof value.ability !== "string" || !ACTION_PLAN_ABILITY_SET.has(value.ability)) invalid();
  const skill = optionalNullableStringField(value, "skill");
  if (skill === undefined) invalid();
  return {
    operation: "resolveNoncombatCheck",
    ability: value.ability as ActionPlanAbility,
    skill,
    ...common,
  };
}

function npcSemanticActionPlan(value: unknown): NpcSemanticActionPlan {
  if (!isRecord(value)) invalid();
  if (
    typeof value.operation !== "string"
    || !ACTION_PLAN_OPERATION_SET.has(value.operation)
    || NPC_FORBIDDEN_OPERATIONS.has(value.operation)
  ) {
    invalid();
  }
  const strictResolution = strictResolutionActionPlan(value);
  if (strictResolution !== undefined) return strictResolution;
  if (value.operation === "acquireItem") {
    exactKeys(value, ["amount", "itemRef", "operation"]);
    if (!Number.isSafeInteger(value.amount)
      || Number(value.amount) < 1
      || Number(value.amount) > 1_000_000) invalid();
    const itemRef = boundedString(value.itemRef, 240);
    if (!itemRef.startsWith("item-entry:")) invalid();
    return { operation: "acquireItem", itemRef, amount: Number(value.amount) };
  }
  if (value.operation === "useItem") {
    exactKeys(value, ["itemActivityId", "itemRef", "operation"]);
    const itemRef = boundedString(value.itemRef, 240);
    if (!itemRef.startsWith("item-entry:") || value.itemActivityId !== "use") invalid();
    return { operation: "useItem", itemRef, itemActivityId: "use" };
  }
  if (value.operation === "transferItem") {
    exactKeys(value, [
      "amount",
      "itemRef",
      "operation",
      "ownershipDisposition",
      "targetEntityRef",
    ]);
    const amount = value.amount;
    if (!Number.isSafeInteger(amount) || Number(amount) < 1 || Number(amount) > 1_000_000) {
      invalid();
    }
    const itemRef = boundedString(value.itemRef, 240);
    if (!itemRef.startsWith("item-entry:")) invalid();
    return {
      operation: "transferItem",
      targetEntityRef: boundedString(value.targetEntityRef, 240),
      itemRef,
      amount: Number(amount),
      ownershipDisposition: value.ownershipDisposition === "retain"
        || value.ownershipDisposition === "transfer"
        ? value.ownershipDisposition
        : invalid(),
    };
  }
  if (value.operation === "changeNpcGear") {
    if (
      typeof value.gearAction !== "string"
      || !ACTION_PLAN_GEAR_ACTION_SET.has(value.gearAction)
      || typeof value.slot !== "string"
      || !ACTION_PLAN_GEAR_SLOT_SET.has(value.slot)
    ) invalid();
    if (value.gearAction === "wear") {
      exactKeys(value, ["gearAction", "itemRef", "operation", "slot"]);
      const itemRef = boundedString(value.itemRef, 240);
      if (!itemRef.startsWith("item-entry:")) invalid();
      return {
        operation: "changeNpcGear",
        gearAction: "wear",
        slot: value.slot as typeof ACTION_PLAN_GEAR_SLOTS[number],
        itemRef,
      };
    }
    exactKeys(value, ["gearAction", "operation", "slot"]);
    return {
      operation: "changeNpcGear",
      gearAction: "stow",
      slot: value.slot as typeof ACTION_PLAN_GEAR_SLOTS[number],
    };
  }
  exactKeys(value, ACTION_PLAN_KEYS, ["operation"]);
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
  if (value.hitDiceToSpend !== undefined
    && (!Number.isSafeInteger(value.hitDiceToSpend) || Number(value.hitDiceToSpend) < 0)) invalid();
  if (value.arcaneRecoverySlotLevels !== undefined
    && (!Array.isArray(value.arcaneRecoverySlotLevels)
      || value.arcaneRecoverySlotLevels.length > 20
      || !value.arcaneRecoverySlotLevels.every((level) =>
        Number.isSafeInteger(level) && Number(level) >= 1 && Number(level) <= 5))) invalid();
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
  const frozenCosts = "frozenCosts" in value ? actionPlanCosts(value.frozenCosts) : undefined;
  const effects = (key: "success" | "failure") => key in value
    ? actionPlanEffects(value[key])
    : undefined;
  const success = effects("success");
  const failure = effects("failure");
  if (
    value.operation === "startActivity"
    && [...(success ?? []), ...(failure ?? [])].some(({ kind }) => kind === "advanceFictionTime")
  ) invalid();
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
    "itemActivityId",
    "ownershipDisposition",
    "factionRef",
    "planRef",
    "knowledgeRef",
    "mediumFactRef",
    "partyRef",
    "partyAction",
    "pendingInputRef",
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
        key === "outcome" || key === "choice" ? 480 : 240,
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
  const targetEntityRefs = optionalStringArrayField(value, "targetEntityRefs");
  const recipientRefs = optionalStringArrayField(value, "recipientRefs");
  const memberRefs = optionalStringArrayField(value, "memberRefs");
  const basisRefs = optionalStringArrayField(value, "basisRefs");
  const unresolvedRefs = optionalStringArrayField(value, "unresolvedRefs");
  const consequenceRefs = optionalStringArrayField(value, "consequenceRefs");
  const dc = optionalFiniteNumber(value, "dc");
  const destinationFeet = optionalFiniteNumber(value, "destinationFeet");
  const amount = optionalFiniteNumber(value, "amount");
  return {
    operation: value.operation as ActionPlanOperation,
    ...(value.ability !== undefined ? { ability: value.ability as ActionPlanAbility } : {}),
    ...(skill !== undefined ? { skill } : {}),
    ...(value.opposedAbility !== undefined
      ? { opposedAbility: value.opposedAbility as ActionPlanAbility }
      : {}),
    ...(opposedSkill !== undefined ? { opposedSkill } : {}),
    ...(value.saveAbility !== undefined
      ? { saveAbility: value.saveAbility as ActionPlanAbility }
      : {}),
    ...(dc !== undefined ? { dc } : {}),
    ...(value.mode !== undefined ? { mode: value.mode as ActionPlanCheckMode } : {}),
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
    ...(recipientRefs !== undefined ? { recipientRefs } : {}),
    ...(memberRefs !== undefined ? { memberRefs } : {}),
    ...(basisRefs !== undefined ? { basisRefs } : {}),
    ...(unresolvedRefs !== undefined ? { unresolvedRefs } : {}),
    ...(consequenceRefs !== undefined ? { consequenceRefs } : {}),
    ...(newOptions !== undefined ? { newOptions } : {}),
    ...(activityTransitions !== undefined ? { activityTransitions } : {}),
  } as NpcSemanticActionPlan;
}

/** Closed validator for the server-private Due NPC ActorPlan boundary. */
export function validateNpcMechanicalProposal(
  value: unknown,
): NpcSemanticActionPlan | null {
  return value === null ? null : npcSemanticActionPlan(value);
}

const NARRATION_AGENCY_SUBJECT_KIND_SET = new Set<string>(NARRATION_AGENCY_SUBJECT_KINDS);
const NARRATION_AGENCY_CLAIM_KIND_SET = new Set<string>(NARRATION_AGENCY_CLAIM_KINDS);
const PLAYER_OWNED_AGENCY_CLAIMS = new Set<string>([
  "thought",
  "emotion",
  "dialogue",
  "nextAction",
]);

function narrationSubjectRefs(projection: unknown): {
  playerRefs: Set<string>;
  npcRefs: Set<string>;
} {
  const playerRefs = new Set<string>();
  const npcRefs = new Set<string>();
  if (!isRecord(projection)) return { playerRefs, npcRefs };
  const add = (target: Set<string>, value: unknown) => {
    if (typeof value === "string" && value.trim().length > 0) target.add(value.trim());
  };
  const viewer = isRecord(projection.viewer) ? projection.viewer : undefined;
  if (viewer?.kind === "player") {
    add(playerRefs, viewer.characterId);
    add(playerRefs, viewer.subjectId);
  }
  const controlledCharacter = isRecord(projection.controlledCharacter)
    ? projection.controlledCharacter
    : undefined;
  add(playerRefs, controlledCharacter?.characterId);

  if (Array.isArray(projection.agencySubjects)) {
    for (const subject of projection.agencySubjects) {
      if (!isRecord(subject)) continue;
      if (subject.subjectKind === "playerCharacter") add(playerRefs, subject.subjectRef);
      if (subject.subjectKind === "npc") add(npcRefs, subject.subjectRef);
    }
  }

  const addEntity = (value: unknown, fallbackId?: string) => {
    if (!isRecord(value) || (value.kind !== "player" && value.kind !== "npc")) return;
    const target = value.kind === "player" ? playerRefs : npcRefs;
    add(target, value.id ?? value.characterId ?? value.entityId ?? fallbackId);
  };
  if (isRecord(projection.entities)) {
    for (const [entityId, entity] of Object.entries(projection.entities)) addEntity(entity, entityId);
  }
  const tacticalProjection = isRecord(projection.tacticalProjection)
    ? projection.tacticalProjection
    : undefined;
  addEntity(tacticalProjection?.self);
  if (Array.isArray(tacticalProjection?.visibleEntities)) {
    for (const entity of tacticalProjection.visibleEntities) addEntity(entity);
  }
  return { playerRefs, npcRefs };
}

export function validateNarrationAgencyClaims(
  value: unknown,
  projection: unknown,
): NarrationAgencyClaim[] {
  if (!isRecord(value) || !Array.isArray(value.agencyClaims) || value.agencyClaims.length > 24) {
    invalid();
  }
  const availableStrings = narrationReferenceStrings(projection);
  const { playerRefs, npcRefs } = narrationSubjectRefs(projection);
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
      || (claim.subjectKind === "playerCharacter"
        && (subjectRef === null || !playerRefs.has(subjectRef)))
      || (claim.subjectKind === "npc"
        && (subjectRef === null || !npcRefs.has(subjectRef)))
      || (claim.subjectKind === "world" && claim.claimKind !== "sensoryConsequence")
      || (claim.subjectKind === "playerCharacter"
        && PLAYER_OWNED_AGENCY_CLAIMS.has(claim.claimKind))
    ) invalid();
    const basisRefs = stringArray(claim.basisRefs, 12);
    if (
      basisRefs.length === 0
      || basisRefs.some((reference) => !availableStrings.has(reference))
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

const NARRATION_NON_EVIDENCE_KEYS = new Set([
  "decisionPrompt",
  "experiencedTranscript",
  "goal",
  "method",
  "narration",
  "nextAction",
  "opportunities",
  "prompt",
  "question",
  "sceneQuestion",
]);

function narrationReferenceStrings(projection: unknown): Set<string> {
  if (!isRecord(projection)) return collectStrings(projection);
  const { experiencedTranscript: _experiencedTranscript, ...currentProjection } = projection;
  const references = collectStrings(currentProjection);
  // The exact current player input is carried in the transcript envelope so
  // it can remain actor-only, but it is also a valid basis for narrating that
  // just-committed action. Older transcript text remains unavailable as a
  // projection reference and all transcript text stays excluded from current
  // sensory evidence below.
  for (const currentIntent of currentPlayerIntentStrings(projection)) {
    references.add(currentIntent);
  }
  return references;
}

function narrationEvidenceStrings(
  value: unknown,
  output = new Set<string>(),
  seen = new WeakSet<object>(),
): Set<string> {
  if (typeof value === "string") {
    const text = value.normalize("NFKC").trim();
    if (text.length > 0) output.add(text);
    return output;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return output;
    seen.add(value);
    for (const item of value) narrationEvidenceStrings(item, output, seen);
    return output;
  }
  if (!isRecord(value) || seen.has(value)) return output;
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    if (NARRATION_NON_EVIDENCE_KEYS.has(key)) continue;
    narrationEvidenceStrings(item, output, seen);
  }
  return output;
}

function hasNarrationEvidence(
  evidence: readonly string[],
  predicate: (text: string) => boolean,
): boolean {
  return evidence.some(predicate);
}

const UNDERFOOT_ASSERTION = /(?:脚下(?:的)?.{0,20}(?:有|是|出现|铺|积|湿|泥|水|血|痕|脚印|足迹)|(?:湿|泥|水|血|痕|脚印|足迹).{0,20}脚下)/u;
const UNDERFOOT_EVIDENCE = /(?:脚下|足下|脚边|所站(?:之处|位置)|站立位置|当前位置.{0,12}(?:湿|泥)|(?:湿|泥).{0,12}当前位置)/u;
const MUD_TRACE_ASSERTION = /(?:泥(?:土)?(?:的)?(?:痕迹|印迹|脚印|足迹|靴印)|泥痕|泥迹|带泥(?:的)?(?:脚印|足迹|靴印))/u;
const TRAIL_EXTENT_ASSERTION = /(?:一路|一串|一行|延伸|拖进|拖出|通向|从.{0,32}(?:到|向|进|出|延|拖))/u;
const GAZE_ASSERTION = /(?:目光|视线|注视|凝视|盯(?:着|住)?)/u;
const BEHIND_ASSERTION = /(?:身后|背后|肩后|越过.{0,8}肩)/u;
const WHITE_CLOTH_ASSERTION = /白布/u;
const WHITE_CLOTH_EVIDENCE = /(?:白布|白色.{0,8}(?:布|织物|罩布|桌布|裹尸布))/u;
const CANDLE_ASSERTION = /(?:蜡烛|烛台|烛火)/u;
const SHADOW_ASSERTION = /(?:暗影|阴影|影子|投下.{0,8}(?:影|黑影))/u;
const SMELL_ASSERTION = /(?:气味|味道|闻到|嗅到|霉味|泥土味|蜡味|腐臭|腥臭|芳香)/u;
const POSTURE_ASSERTION = /(?:姿态|姿势|站姿|坐姿|跪姿)/u;
const FIRE_ASSERTION = /(?:火苗|火焰|炉火|篝火|烛火|火堆|燃烧)/u;
const CRACKLING_ASSERTION = /(?:噼啪|劈啪|哔剥|爆裂声|燃烧声|(?:火|燃).{0,8}作响)/u;
const PRECISE_DISTANCE_ASSERTION = /(?:\d{1,3}|[零〇一二两三四五六七八九十百]+)\s*尺/gu;
const DISTANCE_REQUEST = /(?:距离|相距|间距|多远|几尺|多少尺|坐标|方位|高度|高程|战术位置)/u;

const RELATIVE_DIRECTION_EVIDENCE_GROUPS = [
  ["左前方"],
  ["右前方"],
  ["左后方"],
  ["右后方"],
  ["正前方"],
  ["身后", "背后", "正后方"],
] as const;

function assertsRelativePosition(body: string, alternatives: readonly string[]): boolean {
  return alternatives.some((phrase) => {
    const index = body.indexOf(phrase);
    if (index < 0) return false;
    const before = body.slice(Math.max(0, index - 16), index);
    const after = body.slice(index + phrase.length, index + phrase.length + 12);
    return /(?:位于|站在|处于|停在|出现在|就在|落在|靠在|目光|视线|注视|凝视|盯)/u.test(before)
      || /(?:位置|方向|之处|处)/u.test(after);
  });
}

function currentPlayerIntentStrings(projection: unknown): string[] {
  if (!isRecord(projection)) return [];
  const transcript = projection.experiencedTranscript;
  const messages = Array.isArray(transcript)
    ? transcript
    : isRecord(transcript) && Array.isArray(transcript.messages)
      ? transcript.messages
      : [];
  return messages.flatMap((message) => {
    if (!isRecord(message) || message.kind !== "player") return [];
    const isCurrent = message.sourceEventSeq === "current" || message.receiptId === "current";
    return isCurrent && typeof message.body === "string" ? [message.body] : [];
  });
}

/** Rejects a narrow set of concrete sensory/spatial assertions that the model
 * commonly extrapolates from map labels. This is evidence-aware rather than a
 * scene blacklist: the same wording remains valid when a current projected
 * fact actually states it. Historical transcript and intent/question fields
 * are deliberately excluded from current-state sensory evidence. */
function assertNarrationTextGrounded(body: string, projection: unknown): void {
  const evidence = [...narrationEvidenceStrings(projection)];
  const preciseDistances = [...body.matchAll(PRECISE_DISTANCE_ASSERTION)];
  if (preciseDistances.length >= 2
    && !currentPlayerIntentStrings(projection).some((text) => DISTANCE_REQUEST.test(text))) {
    groundingInvalid();
  }

  if (UNDERFOOT_ASSERTION.test(body)
    && !hasNarrationEvidence(evidence, (text) => UNDERFOOT_EVIDENCE.test(text))) groundingInvalid();

  if (MUD_TRACE_ASSERTION.test(body)
    && TRAIL_EXTENT_ASSERTION.test(body)
    && !hasNarrationEvidence(evidence, (text) =>
      MUD_TRACE_ASSERTION.test(text) && TRAIL_EXTENT_ASSERTION.test(text))) groundingInvalid();

  if (GAZE_ASSERTION.test(body)
    && BEHIND_ASSERTION.test(body)
    && !hasNarrationEvidence(evidence, (text) =>
      GAZE_ASSERTION.test(text) && BEHIND_ASSERTION.test(text))) groundingInvalid();

  if (WHITE_CLOTH_ASSERTION.test(body)
    && !hasNarrationEvidence(evidence, (text) => WHITE_CLOTH_EVIDENCE.test(text))) {
    groundingInvalid();
  }

  for (const sensoryAssertion of [
    CANDLE_ASSERTION,
    SHADOW_ASSERTION,
    SMELL_ASSERTION,
    POSTURE_ASSERTION,
  ]) {
    if (sensoryAssertion.test(body)
      && !hasNarrationEvidence(evidence, (text) => sensoryAssertion.test(text))) groundingInvalid();
  }

  if (FIRE_ASSERTION.test(body)
    && CRACKLING_ASSERTION.test(body)
    && !hasNarrationEvidence(evidence, (text) =>
      FIRE_ASSERTION.test(text) && CRACKLING_ASSERTION.test(text))) groundingInvalid();

  for (const alternatives of RELATIVE_DIRECTION_EVIDENCE_GROUPS) {
    if (!assertsRelativePosition(body, alternatives)) continue;
    if (!hasNarrationEvidence(evidence, (text) =>
      alternatives.some((phrase) => text.includes(phrase)))) groundingInvalid();
  }
}

export function validateNarration(value: unknown, projection: unknown): CurrentNarrationDraft {
  if (!isRecord(value)) invalid();
  exactKeys(value, ["body", "tts", "decisionPrompt", "referencedProjectionRefs", "agencyClaims"]);
  const body = boundedString(value.body, 1_600);
  const tts = boundedString(value.tts, 900);
  assertNarrationTextGrounded(body, projection);
  assertNarrationTextGrounded(tts, projection);
  const declaredProjectionRefs = stringArray(value.referencedProjectionRefs);
  const availableStrings = narrationReferenceStrings(projection);
  if (declaredProjectionRefs.some((reference) => !availableStrings.has(reference))) invalid();
  const agencyClaims = validateNarrationAgencyClaims(value, projection);
  const referencedProjectionRefs = stringArray([
    ...new Set([
      ...declaredProjectionRefs,
      ...agencyClaims.flatMap(({ basisRefs }) => basisRefs),
    ]),
  ]);
  return {
    body,
    tts,
    decisionPrompt: boundedString(value.decisionPrompt, 480),
    referencedProjectionRefs,
    agencyClaims,
  };
}

export function validateBodyOnlyNarration(
  value: unknown,
  projection: unknown,
  options: Readonly<{
    excludeActorActionFromGrounding?: boolean;
    skipGrounding?: boolean;
  }> = {},
): { body: string } {
  if (!isRecord(value)) invalid();
  exactKeys(value, ["body"]);
  const body = boundedString(value.body, 1_600);
  const groundingProjection = options.excludeActorActionFromGrounding === true
    && isRecord(projection)
    ? (({ actorAction: _actorAction, ...withoutActorAction }) => withoutActorAction)(projection)
    : projection;
  if (options.skipGrounding !== true) {
    assertNarrationTextGrounded(body, groundingProjection);
  }
  return { body };
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

/** Extracts exactly one function call without interpreting its arguments.
 * Selection encoded in the function name therefore survives malformed JSON
 * arguments and can enter the bounded same-tool repair path. */
export function extractSingleToolCall(response: unknown): Readonly<{
  name: string;
  arguments: unknown;
}> {
  if (!isRecord(response)) invalid();
  const calls = toolCalls(response);
  if (calls === undefined || calls.length !== 1 || !isRecord(calls[0])) invalid();
  const call = calls[0];
  const functionCall = isRecord(call.function) ? call.function : call;
  if (typeof functionCall.name !== "string" || functionCall.name.length === 0) invalid();
  return Object.freeze({
    name: functionCall.name,
    arguments: functionCall.arguments,
  });
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
