import { AUTHORITATIVE_KP_MODEL } from "./models";
import { CAUSAL_ACTION_LANGUAGE_PROFILE } from "./causal-action-program";

import {
  ACTION_PLAN_ABILITIES,
  ACTION_PLAN_CHECK_MODES,
  ACTION_PLAN_GEAR_SLOTS,
  ACTION_PLAN_OPERATIONS,
  type AuthoritativeKpProfile,
} from "./authoritative-types";

const PRIVATE_FORM_NARROW_TOOLS_KP_POLICY = Object.freeze({
  promptPolicyVersion: "authoritative-kp-private-form-narrow-tools-policy-v2",
  proposalSchemaVersion: "authoritative-kp-private-form-narrow-tools-v2",
  // Frozen literal. This profile identifies the live narration adapter and
  // its value is carried in persisted invocation receipts, so it must not
  // move; the causal language it names was deleted with ADR 0034.
  actionLanguageVersion: "causal-action-program-v5",
  narrationSchemaVersion: "authoritative-kp-body-only-narration-v2",
});

export const AUTHORITATIVE_KP_PROFILES = Object.freeze([
  Object.freeze({
    ...PRIVATE_FORM_NARROW_TOOLS_KP_POLICY,
    provider: "deepseek" as const,
    modelId: AUTHORITATIVE_KP_MODEL,
    modelRevision: "deepseek-v4-flash-0731",
    modelProfileVersion: "authoritative-kp-deepseek-v4-flash-private-tools-v2",
  }),
] satisfies readonly AuthoritativeKpProfile[]);

export const AUTHORITATIVE_KP_PROFILE = AUTHORITATIVE_KP_PROFILES[0];

/**
 * Strict belongs to each request, including the vNext submit/selection pair.
 * Any strict declaration selects the strict transport; its validator rejects
 * malformed or mixed tool sets before fetch instead of silently downgrading.
 * Legacy ordinary Form selection carries no strict declaration.
 */
export function kpRequestDeclaresStrictTool(input: unknown): boolean {
  if (typeof input !== "object" || input === null) return false;
  const tools = (input as { tools?: unknown }).tools;
  return Array.isArray(tools) && tools.some(tool => {
    if (typeof tool !== "object" || tool === null) return false;
    const fn = (tool as { function?: unknown }).function;
    return typeof fn === "object" && fn !== null
      && (fn as { strict?: unknown }).strict === true;
  });
}

export function isV3AuthoritativeKpProfile(
  profile: AuthoritativeKpProfile,
): boolean {
  return profile.actionLanguageVersion === CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef
    && profile.proposalSchemaVersion
      === PRIVATE_FORM_NARROW_TOOLS_KP_POLICY.proposalSchemaVersion
    && profile.narrationSchemaVersion
      === PRIVATE_FORM_NARROW_TOOLS_KP_POLICY.narrationSchemaVersion;
}

export function isSocialResolutionKpProfile(
  profile: AuthoritativeKpProfile,
): boolean {
  return profile.promptPolicyVersion === PRIVATE_FORM_NARROW_TOOLS_KP_POLICY.promptPolicyVersion
    && profile.narrationSchemaVersion
      === PRIVATE_FORM_NARROW_TOOLS_KP_POLICY.narrationSchemaVersion
    && isV3AuthoritativeKpProfile(profile);
}

export function authoritativeKpProfileByModelId(
  modelId: unknown,
): AuthoritativeKpProfile | undefined {
  return AUTHORITATIVE_KP_PROFILES.find((profile) => profile.modelId === modelId);
}

export function authoritativeKpProfileByBinding(
  modelId: unknown,
  modelProfileVersion: unknown,
): AuthoritativeKpProfile | undefined {
  return AUTHORITATIVE_KP_PROFILES.find(
    (profile) => profile.modelId === modelId
      && profile.modelProfileVersion === modelProfileVersion,
  );
}

export const NARRATION_TOOL_NAME = "submit_current_narration";

const stringArray = {
  type: "array",
  items: { type: "string", minLength: 1, maxLength: 240 },
  maxItems: 40,
};

const fictionDurationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    unit: { enum: ["round", "second", "minute", "hour", "day"] },
    value: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  },
  required: ["unit", "value"],
};

const actionPlanCostSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "consumeResource" },
        resourceRef: { type: "string", minLength: 1, maxLength: 240 },
        amount: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      },
      required: ["kind", "resourceRef", "amount"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "consumeItem" },
        itemRef: { type: "string", pattern: "^item-entry:.+", maxLength: 240 },
        count: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      },
      required: ["kind", "itemRef"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "fictionTime" },
        duration: fictionDurationSchema,
      },
      required: ["kind", "duration"],
    },
  ],
};

const primitiveValueSchema = {
  anyOf: [
    { type: "string", maxLength: 480 },
    { type: "number" },
    { type: "boolean" },
  ],
};

const actionPlanEffectSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "acquireEvidence" },
        evidenceRef: { type: "string", minLength: 1, maxLength: 240 },
        definitionRef: { type: "string", minLength: 1, maxLength: 240 },
        evidence: { type: "string", minLength: 1, maxLength: 480 },
      },
      required: ["kind", "evidenceRef"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "acquireKnowledge" },
        knowledgeRef: { type: "string", minLength: 1, maxLength: 240 },
        definitionRef: { type: "string", minLength: 1, maxLength: 240 },
        value: primitiveValueSchema,
      },
      required: ["kind", "knowledgeRef"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "changeResource" },
        resourceRef: { type: "string", minLength: 1, maxLength: 240 },
        amount: {
          type: "integer",
          minimum: Number.MIN_SAFE_INTEGER,
          maximum: -1,
        },
        targetRef: { type: "string", minLength: 1, maxLength: 240 },
      },
      required: ["kind", "resourceRef", "amount"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "changeHitPoints" },
        amount: {
          anyOf: [
            { type: "integer", minimum: Number.MIN_SAFE_INTEGER, maximum: -1 },
            { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
          ],
        },
        targetRef: { type: "string", minLength: 1, maxLength: 240 },
      },
      required: ["kind", "amount"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "alertNpc" },
        npcId: { type: "string", minLength: 1, maxLength: 240 },
        status: { type: "string", minLength: 1, maxLength: 120 },
      },
      required: ["kind", "npcId"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "moveEntity" },
        sceneRef: { type: "string", minLength: 1, maxLength: 240 },
        entityRef: { type: "string", minLength: 1, maxLength: 240 },
      },
      required: ["kind", "sceneRef"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "advanceFictionTime" },
        duration: fictionDurationSchema,
      },
      required: ["kind", "duration"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "updateRelationship" },
        relationshipRef: { type: "string", minLength: 1, maxLength: 240 },
        recipientRefs: { ...stringArray, minItems: 1, uniqueItems: true },
        value: { type: "string", minLength: 1, maxLength: 480 },
        definitionRef: { type: "string", minLength: 1, maxLength: 240 },
      },
      required: ["kind", "relationshipRef", "recipientRefs", "value"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "recordCommitment" },
        commitmentRef: { type: "string", minLength: 1, maxLength: 240 },
        targetRef: { type: "string", minLength: 1, maxLength: 240 },
        value: { type: "string", minLength: 1, maxLength: 480 },
        status: { type: "string", minLength: 1, maxLength: 120 },
      },
      required: ["kind", "commitmentRef", "targetRef", "value", "status"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "recordDebt" },
        debtRef: { type: "string", minLength: 1, maxLength: 240 },
        targetRef: { type: "string", minLength: 1, maxLength: 240 },
        value: { type: "string", minLength: 1, maxLength: 480 },
        status: { type: "string", minLength: 1, maxLength: 120 },
        definitionRef: { type: "string", minLength: 1, maxLength: 240 },
      },
      required: ["kind", "debtRef", "targetRef", "value", "status"],
    },
  ],
};

const actionPlanCostRef = { $ref: "#/$def/actionPlanCost" };
const actionPlanEffectRef = { $ref: "#/$def/actionPlanEffect" };

const STRICT_RESOLUTION_OPERATIONS = new Set([
  "resolveDirectConsequences",
  "resolveNoncombatCheck",
  "resolveNoncombatSave",
  "retryFailedAction",
]);

const npcReservedActionPlanOperations = ACTION_PLAN_OPERATIONS.filter((operation) =>
  !STRICT_RESOLUTION_OPERATIONS.has(operation)
  && operation !== "resolveNoncombatContest"
  && operation !== "advanceCampaignLifecycle"
  && operation !== "acquireItem"
  && operation !== "useItem"
  && operation !== "transferItem"
  && operation !== "changeNpcGear");

const npcReservedActionPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { enum: npcReservedActionPlanOperations },
    ability: { enum: [...ACTION_PLAN_ABILITIES] },
    skill: { anyOf: [{ type: "null" }, { type: "string", minLength: 1, maxLength: 120 }] },
    opposedAbility: { enum: [...ACTION_PLAN_ABILITIES] },
    opposedSkill: { anyOf: [{ type: "null" }, { type: "string", minLength: 1, maxLength: 120 }] },
    saveAbility: { enum: [...ACTION_PLAN_ABILITIES] },
    dc: { type: "number" },
    mode: { enum: [...ACTION_PLAN_CHECK_MODES] },
    duration: fictionDurationSchema,
    frozenCosts: { type: "array", maxItems: 24, items: actionPlanCostRef },
    success: { type: "array", maxItems: 24, items: actionPlanEffectRef },
    failure: { type: "array", maxItems: 24, items: actionPlanEffectRef },
    sourceEntityRef: { type: "string", minLength: 1, maxLength: 240 },
    targetEntityRef: { type: "string", minLength: 1, maxLength: 240 },
    targetEntityRefs: stringArray,
    encounterRef: { type: "string", minLength: 1, maxLength: 240 },
    activityRef: { type: "string", minLength: 1, maxLength: 240 },
    activityTransitions: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          activityId: { type: "string", minLength: 1, maxLength: 240 },
          disposition: { enum: ["continue", "summarize", "interrupt", "complete"] },
        },
        required: ["activityId", "disposition"],
      },
    },
    abilityRef: { type: "string", minLength: 1, maxLength: 240 },
    reactionRef: { type: "string", minLength: 1, maxLength: 240 },
    destinationRef: { type: "string", minLength: 1, maxLength: 240 },
    destinationFeet: { type: "number" },
    restKind: { enum: ["short", "long"] },
    hitDiceToSpend: { type: "integer", minimum: 0, maximum: 20 },
    arcaneRecoverySlotLevels: {
      type: "array",
      maxItems: 20,
      items: { type: "integer", minimum: 1, maximum: 5 },
    },
    resourceRef: { type: "string", minLength: 1, maxLength: 240 },
    amount: { type: "number" },
    itemRef: { type: "string", pattern: "^item-entry:.+", maxLength: 240 },
    itemActivityId: { const: "use" },
    ownershipDisposition: { enum: ["retain", "transfer"] },
    knowledgeRef: { type: "string", minLength: 1, maxLength: 240 },
    mediumFactRef: { type: "string", minLength: 1, maxLength: 240 },
    recipientRefs: stringArray,
    partyRef: { type: "string", minLength: 1, maxLength: 240 },
    partyAction: {
      enum: [
        "inviteMember",
        "cancelInvitation",
        "leave",
        "transferLeadership",
        "proposeMove",
        "moveIndividually",
      ],
    },
    pendingInputRef: { type: "string", minLength: 1, maxLength: 240 },
    memberRefs: stringArray,
    outcome: { type: "string", minLength: 1, maxLength: 480 },
    choice: { type: "string", minLength: 1, maxLength: 480 },
    precedentRef: { type: "string", minLength: 1, maxLength: 240 },
    publicClause: { type: "string", minLength: 1, maxLength: 240 },
    newOptions: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1, maxLength: 120 },
          summary: { type: "string", minLength: 1, maxLength: 320 },
        },
        required: ["id", "summary"],
      },
    },
    basisRefs: stringArray,
    unresolvedRefs: stringArray,
    consequenceRefs: stringArray,
  },
  required: ["operation"],
};

const compoundOutcomeArraySchema = {
  type: "array",
  maxItems: 24,
  items: actionPlanEffectRef,
};

const compoundCostArraySchema = {
  type: "array",
  maxItems: 24,
  items: actionPlanCostRef,
};

const directConsequencesActionPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { const: "resolveDirectConsequences" },
    duration: fictionDurationSchema,
    frozenCosts: { ...compoundCostArraySchema, maxItems: 0 },
    success: compoundOutcomeArraySchema,
    failure: { ...compoundOutcomeArraySchema, maxItems: 0 },
  },
  required: ["operation", "duration", "frozenCosts", "success", "failure"],
};

const noncombatCheckActionPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { const: "resolveNoncombatCheck" },
    ability: { enum: [...ACTION_PLAN_ABILITIES] },
    skill: { anyOf: [{ type: "null" }, { type: "string", minLength: 1, maxLength: 120 }] },
    dc: { type: "integer", minimum: 0, maximum: 30 },
    mode: { enum: [...ACTION_PLAN_CHECK_MODES] },
    duration: fictionDurationSchema,
    frozenCosts: compoundCostArraySchema,
    success: compoundOutcomeArraySchema,
    failure: compoundOutcomeArraySchema,
  },
  required: [
    "operation",
    "ability",
    "skill",
    "dc",
    "mode",
    "duration",
    "frozenCosts",
    "success",
    "failure",
  ],
};

const npcNoncombatSaveActionPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { const: "resolveNoncombatSave" },
    saveAbility: { enum: [...ACTION_PLAN_ABILITIES] },
    dc: { type: "integer", minimum: 0, maximum: 30 },
    mode: { enum: [...ACTION_PLAN_CHECK_MODES] },
    duration: fictionDurationSchema,
    frozenCosts: compoundCostArraySchema,
    success: compoundOutcomeArraySchema,
    failure: compoundOutcomeArraySchema,
  },
  required: [
    "operation",
    "saveAbility",
    "dc",
    "mode",
    "duration",
    "frozenCosts",
    "success",
    "failure",
  ],
};

const acquireItemActionPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { const: "acquireItem" },
    itemRef: { type: "string", pattern: "^item-entry:.+", maxLength: 240 },
    amount: { type: "integer", minimum: 1, maximum: 1_000_000 },
  },
  required: ["operation", "itemRef", "amount"],
};

const useItemActionPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { const: "useItem" },
    itemRef: { type: "string", pattern: "^item-entry:.+", maxLength: 240 },
    itemActivityId: { const: "use" },
  },
  required: ["operation", "itemRef", "itemActivityId"],
};

const transferItemActionPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { const: "transferItem" },
    targetEntityRef: { type: "string", minLength: 1, maxLength: 240 },
    itemRef: { type: "string", pattern: "^item-entry:.+", maxLength: 240 },
    amount: { type: "integer", minimum: 1, maximum: 1_000_000 },
    ownershipDisposition: { enum: ["retain", "transfer"] },
  },
  required: [
    "operation",
    "targetEntityRef",
    "itemRef",
    "amount",
    "ownershipDisposition",
  ],
};

const changeNpcGearActionPlanSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        operation: { const: "changeNpcGear" },
        gearAction: { const: "wear" },
        slot: { enum: [...ACTION_PLAN_GEAR_SLOTS] },
        itemRef: { type: "string", pattern: "^item-entry:.+", maxLength: 240 },
      },
      required: ["operation", "gearAction", "slot", "itemRef"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        operation: { const: "changeNpcGear" },
        gearAction: { const: "stow" },
        slot: { enum: [...ACTION_PLAN_GEAR_SLOTS] },
      },
      required: ["operation", "gearAction", "slot"],
    },
  ],
};

const npcActionPlanSchema = {
  anyOf: [
    { $ref: "#/$def/directConsequencesActionPlan" },
    { $ref: "#/$def/noncombatCheckActionPlan" },
    { $ref: "#/$def/npcNoncombatSaveActionPlan" },
    { $ref: "#/$def/acquireItemActionPlan" },
    { $ref: "#/$def/useItemActionPlan" },
    { $ref: "#/$def/transferItemActionPlan" },
    { $ref: "#/$def/changeNpcGearActionPlan" },
    { $ref: "#/$def/npcReservedActionPlan" },
  ],
};

const npcMechanicalProposalSchemaDefinitions = {
  actionPlanCost: actionPlanCostSchema,
  actionPlanEffect: actionPlanEffectSchema,
  directConsequencesActionPlan: directConsequencesActionPlanSchema,
  noncombatCheckActionPlan: noncombatCheckActionPlanSchema,
  npcNoncombatSaveActionPlan: npcNoncombatSaveActionPlanSchema,
  acquireItemActionPlan: acquireItemActionPlanSchema,
  useItemActionPlan: useItemActionPlanSchema,
  transferItemActionPlan: transferItemActionPlanSchema,
  changeNpcGearActionPlan: changeNpcGearActionPlanSchema,
  npcReservedActionPlan: npcReservedActionPlanSchema,
};

/** Shared closed schema source for the server-private due ActorPlan boundary.
 * Keeping this on the same definitions as ordinary NPC mechanics prevents a
 * second, looser mechanical proposal dialect. */
export const DUE_NPC_MECHANICAL_PROPOSAL_SCHEMA = Object.freeze(npcActionPlanSchema);
export const DUE_NPC_MECHANICAL_PROPOSAL_SCHEMA_DEFINITIONS = Object.freeze(
  npcMechanicalProposalSchemaDefinitions,
);
