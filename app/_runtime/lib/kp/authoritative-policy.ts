import {
  ALTERNATIVE_AUTHORITATIVE_KP_MODEL,
  AUTHORITATIVE_KP_MODEL,
} from "./models";
import { CAUSAL_ACTION_LANGUAGE_PROFILE, stableStructuralHash } from "./causal-action-program";
import {
  KP_FORM_CATALOG_REGISTRATION,
  KP_FORM_IDS,
  KP_FORM_TOOL_NAMES,
  buildKpFormToolParameters,
} from "./form-catalog";
import {
  ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
  INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE,
} from "../rules/profiles/manifests";
import type { RuntimeProfileManifest } from "../rules/profiles/types";
import {
  ACTION_PLAN_ABILITIES,
  ACTION_PLAN_CHECK_MODES,
  ACTION_PLAN_GEAR_SLOTS,
  ACTION_PLAN_OPERATIONS,
  CAMPAIGN_LIFECYCLE_ACTIONS,
  type AuthoritativeKpProfile,
} from "./authoritative-types";

const PRIVATE_FORM_NARROW_TOOLS_KP_POLICY = Object.freeze({
  promptPolicyVersion: "authoritative-kp-private-form-narrow-tools-policy-v1",
  proposalSchemaVersion: "authoritative-kp-private-form-narrow-tools-v1",
  actionPlanSchemaVersion: CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef,
  narrationSchemaVersion: "authoritative-kp-body-only-narration-v2",
});

const PRIVATE_FORM_NARROW_TOOLS_PROTOCOL_REGISTRATION = Object.freeze({
  protocolRef: PRIVATE_FORM_NARROW_TOOLS_KP_POLICY.proposalSchemaVersion,
  selectionContract: "one-allowed-tool-name-selects-one-existing-form-v1",
  argumentContract: "direct-form-draft-without-envelope-v1",
  repairContract: "same-selected-tool-at-most-once-v1",
  formCatalogRef: KP_FORM_CATALOG_REGISTRATION.catalogRef,
  formCatalogHash: KP_FORM_CATALOG_REGISTRATION.catalogHash,
  forms: Object.freeze(KP_FORM_IDS.map((formId) => Object.freeze({
    formId,
    toolName: KP_FORM_TOOL_NAMES[formId],
    parameters: buildKpFormToolParameters(formId),
  }))),
});

export const PRIVATE_FORM_NARROW_TOOLS_PROTOCOL_PROFILE = Object.freeze({
  protocolRef: PRIVATE_FORM_NARROW_TOOLS_PROTOCOL_REGISTRATION.protocolRef,
  protocolHash: stableStructuralHash(PRIVATE_FORM_NARROW_TOOLS_PROTOCOL_REGISTRATION),
});

const PRIVATE_TOOLS_WORKFLOW_REGISTRATION = Object.freeze({
  workflowRef: "authoritative-kp-private-form-narrow-tools-workflow-v1",
  formCatalogRef: KP_FORM_CATALOG_REGISTRATION.catalogRef,
  formCatalogHash: KP_FORM_CATALOG_REGISTRATION.catalogHash,
  proposalProtocolRef: PRIVATE_FORM_NARROW_TOOLS_PROTOCOL_PROFILE.protocolRef,
  proposalProtocolHash: PRIVATE_FORM_NARROW_TOOLS_PROTOCOL_PROFILE.protocolHash,
  actionLanguageRef: CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef,
  actionLanguageHash: CAUSAL_ACTION_LANGUAGE_PROFILE.languageHash,
  contextProfileRef: "kp-three-layer-context-pack-v1",
  retrievalProfileRef: "kp-static-structure-d1-fts-v1",
  narrationSchemaVersion: PRIVATE_FORM_NARROW_TOOLS_KP_POLICY.narrationSchemaVersion,
  publicationProtocolRef: INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE.profileId,
  publicationProtocolHash: INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE.profileHash,
  runtimeManifestRef: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST.manifest.profileId,
  runtimeManifestHash: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST.manifest.profileHash,
  defaultExperimentGroup: "G2",
});

export const PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST = Object.freeze({
  ...PRIVATE_TOOLS_WORKFLOW_REGISTRATION,
  workflowHash: stableStructuralHash(PRIVATE_TOOLS_WORKFLOW_REGISTRATION),
});

/** Exact persisted binding for every room created by product version 0.4. */
export const PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON = JSON.stringify(
  PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST,
);

export function runtimeManifestForExactV3KpWorkflow(
  value: unknown,
): RuntimeProfileManifest | undefined {
  if (value === PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON) {
    return ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST;
  }
  return undefined;
}

export function hasExactV3KpWorkflowManifest(value: unknown): value is string {
  return runtimeManifestForExactV3KpWorkflow(value) !== undefined;
}

export const AUTHORITATIVE_KP_PROFILES = Object.freeze([
  Object.freeze({
    ...PRIVATE_FORM_NARROW_TOOLS_KP_POLICY,
    provider: "deepseek" as const,
    modelId: AUTHORITATIVE_KP_MODEL,
    modelRevision: "deepseek-v4-flash-0731",
    modelProfileVersion: "authoritative-kp-deepseek-v4-flash-private-tools-v1",
  }),
  Object.freeze({
    ...PRIVATE_FORM_NARROW_TOOLS_KP_POLICY,
    provider: "deepseek" as const,
    modelId: ALTERNATIVE_AUTHORITATIVE_KP_MODEL,
    modelRevision: "deepseek-v4-pro",
    modelProfileVersion: "authoritative-kp-deepseek-v4-pro-private-tools-v1",
  }),
] satisfies readonly AuthoritativeKpProfile[]);

export const AUTHORITATIVE_KP_PROFILE = AUTHORITATIVE_KP_PROFILES[0];

export function isV3AuthoritativeKpProfile(
  profile: AuthoritativeKpProfile,
): boolean {
  return profile.actionPlanSchemaVersion === CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef
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

const projectionBasisRefArray = {
  ...stringArray,
  description: "每一项都必须从本次输入 kpProjection 中已有的字符串值逐字复制；不得填写 JSON 路径、字段名、标签、释义或新造 ID。没有稳定依据时提交空数组 []。",
};

const causalBasisRefArray = {
  ...stringArray,
  description: "每一项都必须从本次输入 kpProjection 中已固化事实条目的 id 字符串值逐字复制；不得引用本次新建的 dynamicMaterializations[].factRef，不得填写 JSON 路径、字段名、释义或新造 ID。没有已固化因果依据时提交空数组 []。",
};

const npcKnowledgeRefArray = {
  ...stringArray,
  description: "每一项都必须从 npcId 对应的 kpProjection.npcViewers 条目中已有的字符串值逐字复制；不得借用 KP 全知信息、JSON 路径、释义或新造 ID。没有可引用知识时提交空数组 []。",
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

const riskSchema = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        warning: { type: "string", minLength: 1, maxLength: 480 },
        successConsequences: stringArray,
        failureConsequences: stringArray,
        retryGate: {
          type: "array",
          uniqueItems: true,
          maxItems: 6,
          items: {
            enum: [
              "methodChanged",
              "factsChanged",
              "costAccepted",
              "positionChanged",
              "materialAssistance",
              "situationAdvanced",
            ],
          },
        },
      },
      required: ["warning", "successConsequences", "failureConsequences", "retryGate"],
    },
  ],
};

const pendingInputSchema = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { enum: ["clarification", "playerChoice"] },
        prompt: { type: "string", minLength: 1, maxLength: 480 },
        choices: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1, maxLength: 120 },
              label: { type: "string", minLength: 1, maxLength: 160 },
              consequence: { type: "string", minLength: 1, maxLength: 320 },
            },
            required: ["id", "label", "consequence"],
          },
        },
      },
      required: ["kind", "prompt", "choices"],
    },
  ],
};

const precedentScopeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { enum: ["scene", "campaign", "module", "room"] },
    ref: { type: "string", minLength: 1, maxLength: 240 },
  },
  required: ["kind", "ref"],
};

const adjudicationPrecedentSchema = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "record" },
        publicRuleBasis: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 480 },
        },
        applicabilityScope: precedentScopeSchema,
      },
      required: ["kind", "publicRuleBasis", "applicabilityScope"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "supersede" },
        supersededPrecedentId: {
          type: "string",
          minLength: 1,
          maxLength: 240,
          description: "必须从本次输入 kpProjection 中已有的旧 precedentId 字符串值逐字复制。",
        },
        materialDifferences: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 480 },
        },
        publicRuleBasis: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 480 },
        },
        applicabilityScope: precedentScopeSchema,
      },
      required: [
        "kind",
        "supersededPrecedentId",
        "materialDifferences",
        "publicRuleBasis",
        "applicabilityScope",
      ],
    },
  ],
};

const openWorldDefinition = {
  type: "object",
  maxProperties: 80,
  additionalProperties: true,
  description: "Open-world fiction definition only; authority, state, event, profile, dice, and face keys are forbidden by the protocol validator.",
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
        kind: { const: "consumeArtifact" },
        artifactRef: { type: "string", pattern: "^item:.+", maxLength: 240 },
        count: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      },
      required: ["kind", "artifactRef"],
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

const playerReservedActionPlanOperations = ACTION_PLAN_OPERATIONS.filter((operation) =>
  !STRICT_RESOLUTION_OPERATIONS.has(operation)
  && operation !== "advanceFactionPlan"
  && operation !== "transferItem"
  && operation !== "changeNpcGear");
const npcReservedActionPlanOperations = ACTION_PLAN_OPERATIONS.filter((operation) =>
  !STRICT_RESOLUTION_OPERATIONS.has(operation)
  && operation !== "resolveNoncombatContest"
  && operation !== "advanceCampaignLifecycle"
  && operation !== "transferItem"
  && operation !== "changeNpcGear");

const reservedActionPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { enum: playerReservedActionPlanOperations },
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
    moduleMigration: {
      type: "object",
      additionalProperties: false,
      properties: {
        fromModuleRef: {
          type: "object",
          additionalProperties: false,
          properties: {
            profileId: { type: "string", minLength: 1, maxLength: 240 },
            profileHash: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
          },
          required: ["profileId", "profileHash"],
        },
        toModuleRef: {
          type: "object",
          additionalProperties: false,
          properties: {
            profileId: { type: "string", minLength: 1, maxLength: 240 },
            profileHash: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
          },
          required: ["profileId", "profileHash"],
        },
        migrationRef: {
          type: "object",
          additionalProperties: false,
          properties: {
            profileId: { type: "string", minLength: 1, maxLength: 240 },
            profileHash: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
          },
          required: ["profileId", "profileHash"],
        },
      },
      required: ["fromModuleRef", "toModuleRef", "migrationRef"],
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
    itemRef: { type: "string", minLength: 1, maxLength: 240 },
    artifactRef: { type: "string", minLength: 1, maxLength: 240 },
    artifactUse: { enum: ["retain", "consume", "destroy"] },
    factionRef: { type: "string", minLength: 1, maxLength: 240 },
    planRef: { type: "string", minLength: 1, maxLength: 240 },
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
    campaignRef: { type: "string", minLength: 1, maxLength: 240 },
    chapterRef: { type: "string", minLength: 1, maxLength: 240 },
    inheritanceAuthorization: {
      type: "object",
      additionalProperties: false,
      properties: {
        authorizationId: { type: "string", minLength: 1, maxLength: 240 },
        kind: { enum: ["artifact", "knowledge", "relationship", "debt", "promise"] },
        sourceRef: { type: "string", minLength: 1, maxLength: 240 },
        targetRef: { type: "string", minLength: 1, maxLength: 240 },
        scope: {
          enum: [
            "transferPossession",
            "acquireExactKnowledge",
            "establishDerivedRelationship",
            "assumeDebtObligation",
            "assumePromiseObligation",
          ],
        },
      },
      required: ["authorizationId", "kind", "sourceRef", "targetRef", "scope"],
    },
    inheritanceAuthorizationRef: { type: "string", minLength: 1, maxLength: 240 },
    inheritanceSourceFactRef: { type: "string", minLength: 1, maxLength: 240 },
    inheritanceSourceKind: {
      enum: [
        "will",
        "explicitGift",
        "recovery",
        "publicRecord",
        "organizationGrant",
        "npcIntroduction",
        "knowledgePropagation",
      ],
    },
    lifecycleAction: { enum: CAMPAIGN_LIFECYCLE_ACTIONS },
    experienceAmount: { type: "integer", minimum: 1, maximum: 1_000_000 },
    continueAsNpc: { type: "boolean" },
    endingCandidateRef: { type: "string", minLength: 1, maxLength: 240 },
    storyRef: { type: "string", minLength: 1, maxLength: 240 },
    sequelStoryRef: { type: "string", minLength: 1, maxLength: 240 },
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

const npcReservedActionPlanSchema = {
  ...reservedActionPlanSchema,
  properties: {
    ...reservedActionPlanSchema.properties,
    operation: { enum: npcReservedActionPlanOperations },
  },
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

const noncombatSaveActionPlanSchema = {
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
    targetEntityRef: { type: "string", minLength: 1, maxLength: 240 },
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

const retryFailedActionPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...noncombatCheckActionPlanSchema.properties,
    operation: { const: "retryFailedAction" },
    precedentRef: { type: "string", minLength: 1, maxLength: 240 },
  },
  required: [...noncombatCheckActionPlanSchema.required, "precedentRef"],
};

const unchangedRetryFailedActionPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { const: "retryFailedAction" },
    precedentRef: { type: "string", minLength: 1, maxLength: 240 },
  },
  required: ["operation", "precedentRef"],
};

const transferItemActionPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { const: "transferItem" },
    targetEntityRef: { type: "string", minLength: 1, maxLength: 240 },
    itemRef: { type: "string", minLength: 1, maxLength: 240 },
    amount: { type: "integer", minimum: 1, maximum: 1_000_000 },
  },
  required: ["operation", "targetEntityRef", "itemRef", "amount"],
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
        itemRef: { type: "string", minLength: 1, maxLength: 240 },
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

const actionPlanSchema = {
  anyOf: [
    { $ref: "#/$def/directConsequencesActionPlan" },
    { $ref: "#/$def/noncombatCheckActionPlan" },
    { $ref: "#/$def/noncombatSaveActionPlan" },
    { $ref: "#/$def/unchangedRetryFailedActionPlan" },
    { $ref: "#/$def/retryFailedActionPlan" },
    { $ref: "#/$def/transferItemActionPlan" },
    { $ref: "#/$def/playerReservedActionPlan" },
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
  required: noncombatSaveActionPlanSchema.required,
};

const npcActionPlanSchema = {
  anyOf: [
    { $ref: "#/$def/directConsequencesActionPlan" },
    { $ref: "#/$def/noncombatCheckActionPlan" },
    { $ref: "#/$def/npcNoncombatSaveActionPlan" },
    { $ref: "#/$def/transferItemActionPlan" },
    { $ref: "#/$def/changeNpcGearActionPlan" },
    { $ref: "#/$def/npcReservedActionPlan" },
  ],
};

const proposalSchemaDefinitions = {
  actionPlanCost: actionPlanCostSchema,
  actionPlanEffect: actionPlanEffectSchema,
  directConsequencesActionPlan: directConsequencesActionPlanSchema,
  noncombatCheckActionPlan: noncombatCheckActionPlanSchema,
  noncombatSaveActionPlan: noncombatSaveActionPlanSchema,
  npcNoncombatSaveActionPlan: npcNoncombatSaveActionPlanSchema,
  unchangedRetryFailedActionPlan: unchangedRetryFailedActionPlanSchema,
  retryFailedActionPlan: retryFailedActionPlanSchema,
  transferItemActionPlan: transferItemActionPlanSchema,
  changeNpcGearActionPlan: changeNpcGearActionPlanSchema,
  playerReservedActionPlan: reservedActionPlanSchema,
  npcReservedActionPlan: npcReservedActionPlanSchema,
};

/** Shared closed schema source for the server-private due ActorPlan boundary.
 * Keeping this on the same definitions as ordinary NPC mechanics prevents a
 * second, looser mechanical proposal dialect. */
export const AUTHORITATIVE_NPC_ACTION_PLAN_SCHEMA = Object.freeze(npcActionPlanSchema);
export const AUTHORITATIVE_ACTION_PLAN_SCHEMA_DEFINITIONS = Object.freeze(
  proposalSchemaDefinitions,
);
