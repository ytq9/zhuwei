import {
  ALTERNATIVE_AUTHORITATIVE_KP_MODEL,
  AUTHORITATIVE_KP_MODEL,
} from "./models";
import { canonicalJson } from "./authoritative-helpers";
import { CAUSAL_ACTION_LANGUAGE_PROFILE, stableStructuralHash } from "./causal-action-program";
import { KP_FORM_CATALOG_REGISTRATION } from "./form-catalog";
import {
  ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
  ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
  INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE,
} from "../rules/profiles/manifests";
import type { RuntimeProfileManifest } from "../rules/profiles/types";
import {
  ACTION_PLAN_ABILITIES,
  ACTION_PLAN_CHECK_MODES,
  ACTION_PLAN_OPERATIONS,
  CAMPAIGN_LIFECYCLE_ACTIONS,
  NARRATION_AGENCY_CLAIM_KINDS,
  type KpNarrationRequest,
  type KpProposalRequest,
  type AuthoritativeKpProfile,
} from "./authoritative-types";

const BASE_AUTHORITATIVE_KP_POLICY = Object.freeze({
  promptPolicyVersion: "authoritative-kp-prompt-policy-v8",
  proposalSchemaVersion: "authoritative-kp-proposal-v2",
  actionPlanSchemaVersion: "authoritative-kp-action-plan-v1",
  narrationSchemaVersion: "authoritative-kp-narration-v3",
});

const V3_PRIVATE_FORM_KP_POLICY = Object.freeze({
  promptPolicyVersion: "authoritative-kp-private-form-context-policy-v1",
  proposalSchemaVersion: "authoritative-kp-private-form-envelope-v1",
  actionPlanSchemaVersion: CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef,
  narrationSchemaVersion: "authoritative-kp-body-only-narration-v1",
});

const V3_WORKFLOW_REGISTRATION = Object.freeze({
  workflowRef: "authoritative-kp-private-form-context-workflow-v1",
  formCatalogRef: KP_FORM_CATALOG_REGISTRATION.catalogRef,
  formCatalogHash: KP_FORM_CATALOG_REGISTRATION.catalogHash,
  actionLanguageRef: CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef,
  actionLanguageHash: CAUSAL_ACTION_LANGUAGE_PROFILE.languageHash,
  contextProfileRef: "kp-three-layer-context-pack-v1",
  retrievalProfileRef: "kp-static-structure-d1-fts-v1",
  narrationSchemaVersion: "authoritative-kp-body-only-narration-v1",
  publicationProtocolRef: INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE.profileId,
  publicationProtocolHash: INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE.profileHash,
  runtimeManifestRef: ENVIRONMENT_RUNTIME_PROFILE_MANIFEST.manifest.profileId,
  runtimeManifestHash: ENVIRONMENT_RUNTIME_PROFILE_MANIFEST.manifest.profileHash,
  defaultExperimentGroup: "G2",
});

export const V3_KP_WORKFLOW_MANIFEST = Object.freeze({
  ...V3_WORKFLOW_REGISTRATION,
  workflowHash: stableStructuralHash(V3_WORKFLOW_REGISTRATION),
});

/** Exact persisted binding for rooms created on the V3 product generation. */
export const V3_KP_WORKFLOW_MANIFEST_JSON = JSON.stringify(V3_KP_WORKFLOW_MANIFEST);

const V4_WORKFLOW_REGISTRATION = Object.freeze({
  ...V3_WORKFLOW_REGISTRATION,
  workflowRef: "authoritative-kp-private-form-context-workflow-v2",
  runtimeManifestRef: ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST.manifest.profileId,
  runtimeManifestHash: ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST.manifest.profileHash,
});

export const V4_KP_WORKFLOW_MANIFEST = Object.freeze({
  ...V4_WORKFLOW_REGISTRATION,
  workflowHash: stableStructuralHash(V4_WORKFLOW_REGISTRATION),
});

/** Latest persisted V3-product binding. The v1 value above remains immutable
 * so existing environment-v3 rooms replay under their original semantics. */
export const V4_KP_WORKFLOW_MANIFEST_JSON = JSON.stringify(V4_KP_WORKFLOW_MANIFEST);

export function runtimeManifestForExactV3KpWorkflow(
  value: unknown,
): RuntimeProfileManifest | undefined {
  if (value === V3_KP_WORKFLOW_MANIFEST_JSON) return ENVIRONMENT_RUNTIME_PROFILE_MANIFEST;
  if (value === V4_KP_WORKFLOW_MANIFEST_JSON) return ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST;
  return undefined;
}

export function hasExactV3KpWorkflowManifest(value: unknown): value is string {
  return runtimeManifestForExactV3KpWorkflow(value) !== undefined;
}

const HISTORICAL_WORKERS_AI_MODEL = "@cf/zai-org/glm-4.7-flash";
const HISTORICAL_ALTERNATIVE_WORKERS_AI_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const HISTORICAL_WORKERS_AI_POLICY = Object.freeze({
  promptPolicyVersion: "authoritative-kp-prompt-policy-v8",
  proposalSchemaVersion: "authoritative-kp-proposal-v2",
  actionPlanSchemaVersion: "authoritative-kp-action-plan-v1",
  narrationSchemaVersion: "authoritative-kp-narration-v3",
});

export const AUTHORITATIVE_KP_PROFILES = Object.freeze([
  Object.freeze({
    ...BASE_AUTHORITATIVE_KP_POLICY,
    provider: "deepseek" as const,
    modelId: AUTHORITATIVE_KP_MODEL,
    modelRevision: "deepseek-v4-flash-0731",
    modelProfileVersion: "authoritative-kp-deepseek-v4-flash-v1",
  }),
  Object.freeze({
    ...BASE_AUTHORITATIVE_KP_POLICY,
    provider: "deepseek" as const,
    modelId: ALTERNATIVE_AUTHORITATIVE_KP_MODEL,
    modelRevision: "deepseek-v4-pro",
    modelProfileVersion: "authoritative-kp-deepseek-v4-pro-v1",
  }),
  // Only rooms explicitly created with the workflow manifest below use the
  // private Form/Context/Body-only protocol. Existing bindings stay byte-for-
  // byte on their historical profile and ActionPlan semantics.
  Object.freeze({
    ...V3_PRIVATE_FORM_KP_POLICY,
    provider: "deepseek" as const,
    modelId: AUTHORITATIVE_KP_MODEL,
    modelRevision: "deepseek-v4-flash-0731",
    modelProfileVersion: "authoritative-kp-deepseek-v4-flash-private-forms-v1",
  }),
  Object.freeze({
    ...V3_PRIVATE_FORM_KP_POLICY,
    provider: "deepseek" as const,
    modelId: ALTERNATIVE_AUTHORITATIVE_KP_MODEL,
    modelRevision: "deepseek-v4-pro",
    modelProfileVersion: "authoritative-kp-deepseek-v4-pro-private-forms-v1",
  }),
  // Existing authoritative rooms remain bound to their original server-only profiles.
  Object.freeze({
    ...HISTORICAL_WORKERS_AI_POLICY,
    provider: "cloudflare-workers-ai" as const,
    modelId: HISTORICAL_WORKERS_AI_MODEL,
    modelRevision: "cloudflare-managed",
    modelProfileVersion: "authoritative-kp-profile-v1",
  }),
  Object.freeze({
    ...HISTORICAL_WORKERS_AI_POLICY,
    provider: "cloudflare-workers-ai" as const,
    modelId: HISTORICAL_ALTERNATIVE_WORKERS_AI_MODEL,
    modelRevision: "cloudflare-managed",
    modelProfileVersion: "authoritative-kp-model-gemma-4-26b-a4b-it-v1",
  }),
] satisfies readonly AuthoritativeKpProfile[]);

export const AUTHORITATIVE_KP_PROFILE = AUTHORITATIVE_KP_PROFILES[0];

export const V3_AUTHORITATIVE_KP_PROFILES = Object.freeze(
  AUTHORITATIVE_KP_PROFILES.filter((profile) =>
    profile.actionPlanSchemaVersion === CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef),
);

export function isV3AuthoritativeKpProfile(
  profile: AuthoritativeKpProfile,
): boolean {
  return profile.actionPlanSchemaVersion === CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef
    && profile.proposalSchemaVersion === V3_PRIVATE_FORM_KP_POLICY.proposalSchemaVersion
    && profile.narrationSchemaVersion === "authoritative-kp-body-only-narration-v1";
}

export function authoritativeKpProfileByModelId(
  modelId: unknown,
): AuthoritativeKpProfile | undefined {
  return V3_AUTHORITATIVE_KP_PROFILES.find((profile) => profile.modelId === modelId);
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

export const PROPOSAL_TOOL_NAME = "submit_kp_proposal";
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
  !STRICT_RESOLUTION_OPERATIONS.has(operation) && operation !== "advanceFactionPlan");
const npcReservedActionPlanOperations = ACTION_PLAN_OPERATIONS.filter((operation) =>
  !STRICT_RESOLUTION_OPERATIONS.has(operation)
  && operation !== "resolveNoncombatContest"
  && operation !== "advanceCampaignLifecycle");

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

const actionPlanSchema = {
  anyOf: [
    { $ref: "#/$def/directConsequencesActionPlan" },
    { $ref: "#/$def/noncombatCheckActionPlan" },
    { $ref: "#/$def/noncombatSaveActionPlan" },
    { $ref: "#/$def/unchangedRetryFailedActionPlan" },
    { $ref: "#/$def/retryFailedActionPlan" },
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

const actorPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    factionRef: { type: "string", minLength: 1, maxLength: 240 },
    planId: { type: "string", minLength: 1, maxLength: 240 },
    premiseRefs: {
      type: "array",
      minItems: 1,
      maxItems: 40,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 240 },
    },
    nextStep: { type: "string", minLength: 1, maxLength: 480 },
    resourceRefs: stringArray,
    activity: {
      type: "object",
      additionalProperties: false,
      properties: {
        activityId: { type: "string", minLength: 1, maxLength: 240 },
        activityKind: { type: "string", minLength: 1, maxLength: 120 },
        intendedDurationMicros: { type: "string", pattern: "^[1-9][0-9]*$", maxLength: 40 },
      },
      required: ["activityId", "activityKind", "intendedDurationMicros"],
    },
    due: {
      anyOf: [{ type: "null" }, {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { const: "fictionTime" },
          atFictionMicros: { type: "string", pattern: "^(0|[1-9][0-9]*)$", maxLength: 40 },
        },
        required: ["kind", "atFictionMicros"],
      }],
    },
    trigger: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { const: "committedEvent" },
            eventRef: { type: "string", minLength: 1, maxLength: 240 },
          },
          required: ["kind", "eventRef"],
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { const: "knowledgeAcquired" },
            knowledgeRef: { type: "string", minLength: 1, maxLength: 240 },
          },
          required: ["kind", "knowledgeRef"],
        },
      ],
    },
    trace: {
      type: "object",
      additionalProperties: false,
      properties: {
        factRef: { type: "string", minLength: 1, maxLength: 240 },
        description: { type: "string", minLength: 1, maxLength: 480 },
        visibilityPolicyRef: { type: "string", minLength: 1, maxLength: 240 },
      },
      required: ["factRef", "description", "visibilityPolicyRef"],
    },
    alternateTarget: {
      type: "object",
      additionalProperties: false,
      properties: {
        targetRef: { type: "string", minLength: 1, maxLength: 240 },
        reason: { type: "string", minLength: 1, maxLength: 480 },
      },
      required: ["targetRef", "reason"],
    },
  },
  required: [
    "planId",
    "premiseRefs",
    "nextStep",
    "resourceRefs",
    "activity",
    "due",
    "trigger",
    "trace",
    "alternateTarget",
  ],
};

const proposalParameters = {
  type: "object",
  additionalProperties: false,
  $def: proposalSchemaDefinitions,
  properties: {
    kind: {
      enum: [
        "directSuccess",
        "checkRequired",
        "highRiskFeasible",
        "missingPrerequisite",
        "worldLawViolation",
      ],
    },
    goal: { type: "string", minLength: 1, maxLength: 480 },
    method: { type: "string", minLength: 1, maxLength: 480 },
    publicBasisRefs: projectionBasisRefArray,
    privateBasisRefs: projectionBasisRefArray,
    adjudicationPrecedent: adjudicationPrecedentSchema,
    estimatedFictionTime: fictionDurationSchema,
    risk: riskSchema,
    pendingInput: pendingInputSchema,
    dynamicMaterializations: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: {
            enum: ["fact", "location", "passage", "npc", "enemy", "item", "faction", "hazard", "opportunity", "ability"],
          },
          factRef: { type: "string", minLength: 1, maxLength: 160 },
          causalBasisRefs: causalBasisRefArray,
          visibilityPolicyRef: { type: "string", minLength: 1, maxLength: 160 },
          definition: openWorldDefinition,
        },
        required: ["kind", "factRef", "causalBasisRefs", "visibilityPolicyRef", "definition"],
      },
    },
    hiddenRealityCandidateSet: {
      anyOf: [{ type: "null" }, {
        type: "object",
        additionalProperties: false,
        properties: {
          candidateSetId: { type: "string", minLength: 1, maxLength: 160 },
          candidates: {
            type: "array", minItems: 2, maxItems: 12,
            items: {
              type: "object", additionalProperties: false,
              properties: {
                candidateId: { type: "string", minLength: 1, maxLength: 160 },
                hiddenWeight: { type: "integer", minimum: 1, maximum: 1000000 },
                kind: { enum: ["fact", "location", "passage", "npc", "enemy", "item", "faction", "hazard", "opportunity", "ability"] },
                factRef: { type: "string", minLength: 1, maxLength: 160 },
                causalBasisRefs: causalBasisRefArray,
                visibilityPolicyRef: { type: "string", minLength: 1, maxLength: 160 },
                definition: openWorldDefinition,
              },
              required: ["candidateId", "hiddenWeight", "kind", "factRef", "causalBasisRefs", "visibilityPolicyRef", "definition"],
            },
          },
        },
        required: ["candidateSetId", "candidates"],
      }],
    },
    npcActions: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          npcId: {
            type: "string",
            minLength: 1,
            maxLength: 160,
            description: "必须逐字复制 kpProjection.npcViewers 中一个现有 NPC 条目的标识；不得使用姓名、JSON 路径或新造 ID。",
          },
          goal: { type: "string", minLength: 1, maxLength: 480 },
          method: { type: "string", minLength: 1, maxLength: 480 },
          knowledgeRefs: npcKnowledgeRefArray,
          actorPlan: actorPlanSchema,
          mechanicalProposal: { anyOf: [{ type: "null" }, npcActionPlanSchema] },
        },
        required: ["npcId", "goal", "method", "knowledgeRefs", "mechanicalProposal"],
      },
    },
    mechanicalProposal: { anyOf: [{ type: "null" }, actionPlanSchema] },
    scene: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string", minLength: 1, maxLength: 480 },
        pressure: { type: "string", maxLength: 480 },
        opportunities: stringArray,
        conclusionCandidate: { anyOf: [{ type: "null" }, { type: "string", minLength: 1, maxLength: 320 }] },
      },
      required: ["question", "pressure", "opportunities", "conclusionCandidate"],
    },
  },
  required: [
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
};

const narrationRefSchema = {
  type: "string",
  minLength: 1,
  maxLength: 240,
  pattern: "\\S",
};

const narrationBasisRefsSchema = {
  type: "array",
  minItems: 1,
  maxItems: 12,
  uniqueItems: true,
  items: narrationRefSchema,
  description: "每一项都必须从 audienceProjection 中已有的字符串值逐字复制，并同时列入顶层 referencedProjectionRefs。",
};

const narrationPlayerAgencyClaimSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    subjectKind: { const: "playerCharacter" },
    subjectRef: {
      ...narrationRefSchema,
      description: "必须逐字复制 audienceProjection 中该玩家角色的现有标识。",
    },
    claimKind: { enum: ["committedObservableAction", "sensoryConsequence"] },
    basisRefs: narrationBasisRefsSchema,
  },
  required: ["subjectKind", "subjectRef", "claimKind", "basisRefs"],
};

const narrationNpcAgencyClaimSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    subjectKind: { const: "npc" },
    subjectRef: {
      ...narrationRefSchema,
      description: "必须逐字复制 audienceProjection 中该 NPC 的现有标识。",
    },
    claimKind: { enum: [...NARRATION_AGENCY_CLAIM_KINDS] },
    basisRefs: narrationBasisRefsSchema,
  },
  required: ["subjectKind", "subjectRef", "claimKind", "basisRefs"],
};

const narrationWorldAgencyClaimSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    subjectKind: { const: "world" },
    subjectRef: { type: "null" },
    claimKind: { const: "sensoryConsequence" },
    basisRefs: narrationBasisRefsSchema,
  },
  required: ["subjectKind", "subjectRef", "claimKind", "basisRefs"],
};

const narrationParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    body: { type: "string", minLength: 1, maxLength: 1_600, pattern: "\\S" },
    tts: { type: "string", minLength: 1, maxLength: 900, pattern: "\\S" },
    decisionPrompt: { type: "string", minLength: 1, maxLength: 480, pattern: "\\S" },
    referencedProjectionRefs: {
      type: "array",
      maxItems: 40,
      uniqueItems: true,
      items: narrationRefSchema,
      description: "回应引用的每个标识都必须从 audienceProjection 中已有字符串逐字复制；每个 agencyClaims[].basisRefs 也必须在此列出。",
    },
    agencyClaims: {
      type: "array",
      maxItems: 24,
      uniqueItems: true,
      items: {
        anyOf: [
          narrationPlayerAgencyClaimSchema,
          narrationNpcAgencyClaimSchema,
          narrationWorldAgencyClaimSchema,
        ],
      },
    },
  },
  required: ["body", "tts", "decisionPrompt", "referencedProjectionRefs", "agencyClaims"],
};

export const PROPOSAL_TOOL = Object.freeze({
  type: "function",
  function: {
    name: PROPOSAL_TOOL_NAME,
    description: "Submit one authoritative KP feasibility ruling and semantic mechanical proposal.",
    parameters: proposalParameters,
  },
});

export const NARRATION_TOOL = Object.freeze({
  type: "function",
  function: {
    name: NARRATION_TOOL_NAME,
    description: "Submit one current, non-reviewable narration for exactly one committed audience projection.",
    parameters: narrationParameters,
  },
});

const PROPOSAL_SYSTEM = `你是烛帷中承担叙事权威的真正 KP，不是命令翻译器、候选白名单路由器或事后旁白。
你只能依据本次 Room Authority 提供的 KP 专属投影，在故事锚点和已固化事实内理解玩家的自由目标与做法，并提出结构化、可由 Rules Module 诊断的语义机械方案。

每次必须且只能作出五类可行性裁决之一：
- directSuccess：合理，且没有有意义不确定性或失败后果；
- checkRequired：成败都改变局面并存在真实不确定性；
- highRiskFeasible：勉强可行，需冻结更高风险、工具、时间、资源或阶段；
- missingPrerequisite：当前方法缺少明确前提，取得前提后可能可行；
- worldLawViolation：当前方法违反已成立世界规律，不得用虚高 DC 假装可能。

职责：接受未登记但合理的行动；依据因果在开放留白中创建场景、通路、人物、危险、物品、机会或空白结果；在首次证据、引用或机械影响前提出动态固化；区分隐藏真相、感官证据、角色推断与有来源主张；让失败产生相称变化和新选择；依据事实推动 NPC、势力、节奏与真实收束。

引用契约：publicBasisRefs、privateBasisRefs、causalBasisRefs、supersededPrecedentId、npcActions[].npcId 与 knowledgeRefs 不是说明文字，也不是 JSON 路径或字段名。它们必须从本次 kpProjection 对应范围中已有的字符串值逐字复制，不得改写、翻译、缩写或新造 ID；没有稳定依据时，数组必须为 []。causalBasisRefs 只能逐字引用 kpProjection 中已经固化的事实 ID，不得引用本次新建的 dynamicMaterializations[].factRef。无法逐字匹配 npcViewer 或引用越界知识的 NPC 行动必须省略。

机械边界：你可以提出 DC、能力/技能、优势劣势依据、时间、资源成本、风险与有限结果范围，但不得提供 dice/faces/骰面、随机结果、WorldEvent、WorldState/state patch、作用域版本、Principal、可信 actor 或运行 Profile。Rules Module 拥有机械权威，Room Authority 拥有随机与提交权。不得在看到诊断后改变玩家目标；若已有骰前冻结内容或骰面，也不得借修订改判或重掷。

mechanicalProposal 使用 authoritative-kp-action-plan-v1：必须是 schema 中 operation 枚举的一项及其闭合语义字段；frozenCosts、success、failure 也只能使用各自 kind 枚举和闭合字段，每个效果数组最多各有一个 moveEntity 和一个 changeHitPoints。不得添加未声明机械键、脚本、状态补丁或事件。开放世界定义只能放在 dynamicMaterializations[].definition，并仍不得携带 actor/principal/profile/state/events/dice/faces。NPC mechanicalProposal 也必须严格服从其独立 schema；NPC 不得替其他实体提交 save，也不得提交 retryFailedAction。缺少字段或组合不合法时必须按 schema 重做，不得自行伪造结果。
当门后内容、身份或其他隐藏现实需要随机决定时，不得先用 dynamicMaterializations 直接宣告结果。必须提交一个完整 hiddenRealityCandidateSet：每项含唯一 candidateId、正整数 hiddenWeight、因果依据、visibility 与可执行 definition；不得遗漏未选候选。Rules 会在请求随机数前整组验证，任一候选非法时整组退回修订。
重要即兴裁定可用 adjudicationPrecedent 形成可追溯先例：首次为 record；只有事实、做法或版本实质变化时才可用 supersede，并引用 KP 投影中的旧 precedentId 和逐项 materialDifferences。它只是同一 ActionPlan 的冻结注记，不是事件或状态补丁；不得在看到骰面后用它改写原裁定。
没有待决玩家输入时必须提交一个 mechanicalProposal：无不确定性的叙事与时间后果用 resolveDirectConsequences；确定且有意义的失败用 commitMeaningfulFailure；原样重试用 retryFailedAction；missingPrerequisite/worldLawViolation 若不提交失败后果则用 rejectInfeasibleAction。只有 pendingInput 非 null 时 mechanicalProposal 才必须为 null。directSuccess 可在确实没有风险时令 risk=null；场景暂时没有压力时 pressure 可为空字符串。只有做法与事实均未改变、应由 Rules 依据既有先例拒绝的原样重试，retryFailedAction 才使用仅含 operation/precedentRef 的精确最小形状；只要重试可能执行，就必须同时完整冻结 ability、skill、dc、mode、duration、frozenCosts、success、failure。
观察、查看、环顾或检查明显可见内容等没有真实不确定性的行动，使用精确的 resolveDirectConsequences 形状：operation、duration、frozenCosts、success、failure 五个字段缺一不可且不得添加其他字段；frozenCosts=[]、failure=[]。若填写 estimatedFictionTime，必须把完全相同的 unit/value 复制到 duration。没有结构化状态变化时 success=[]；不要为了填满数组虚构 effect，也不得使用 schema 未列出的 sensoryEvidence 等 kind。

玩家控制玩家角色，你不得代替玩家选择。重大歧义、目标、资源、反应、成长、继任与其他玩家选择必须形成 clarification/playerChoice；不得自动 pass、选择第一攻击、最近目标、最低 HP、目标、资源或反应。resolveRest 必须原样冻结发起玩家明确选择的 hitDiceToSpend 与 arcaneRecoverySlotLevels；选择缺失且会影响恢复时先澄清，不得替玩家花生命骰或选择奥术恢复环位。个人休整不得携带 memberRefs；队伍休整必须在 memberRefs 中精确列出投影里同一 PartyGroup 除发起者外的全部其他角色，且不得替这些角色选择恢复资源，他们会各自收到私人同意窗口。只有玩家明确同意退役角色继续成为 NPC 时，retireCharacter 才可提交 continueAsNpc=true；否则必须为 false。NPC 行动只能使用该 NPC 自己的 npcViewer 有限知识，不得从 KP 全知事实补全其视角。
changeParty 必须显式选择 partyAction：inviteMember/transferLeadership 各要求 memberRefs 中恰有一个目标；leave 不得带成员；cancelInvitation 必须带投影中的 pendingInputRef；proposeMove/moveIndividually 必须带 destinationRef 与 duration。resolveNoncombatSave 必须在骰前冻结 saveAbility、dc、mode、duration、frozenCosts、success 和 failure；不得自行计算职业豁免熟练或骰面。

输出只调用 submit_kp_proposal 一次。不要输出解释文字。`;

const NARRATION_SYSTEM = `你是烛帷 KP。现在只能叙述一个已经提交的结果，并且只面向一个冻结的观察者受众。
输入包含安全 Receipt 元数据、该受众在本次提交中实际可见的 committedDelta，以及提交后的该受众专属投影；它不是完整世界、原始事件或其他人的投影，也不包含 experiencedTranscript 以外的聊天历史。必须以 committedDelta 的 success/failure 和结构化变化为本次回应依据，只能引用该投影中的已提交事实、知识、感官细节、压力与可行动机会。不得补写状态、改判机械、泄露未出现的信息、复述其他观察者私人叙述，或把文学旁白当成正史。

如果 audienceProjection 含 experiencedTranscript，它只用于延续该观察者已经历的对话与措辞、避免重复开场；它不是当前空间、状态、感官证据或新行动的依据。旧叙述与当前 committedDelta 或当前投影不一致时，必须服从后两者，不得把已被后续变化取代的描述当成现状。

当前回应应清楚、具体、可行动：先说明行动实际造成的变化；只在投影明确提供时，再选择最多两三个该观察者能感知的关键细节。细节不足时必须省略，不得为补齐画面而推测或润色。然后呈现当前压力或机会，并把决定权交还玩家。不得替玩家决定思想、情绪、台词或下一步；提示可以列明显方向，但必须允许其他合理方法。故事已真实收束时展示后果并允许尾声、续篇或结束，不为延长故事追加幕后黑手。

tacticalProjection 中的坐标、中心约距、高程、实体高度、feature 状态和 textualReadout 是规则与 UI 的机械数据，不是默认旁白稿。玩家没有明确询问距离、坐标或战术细节时，不得逐项复述若干尺、坐标、高度或掩护数据。没有明确 facing 或文字方位证据时，不得从 x/y 推断左右、前后、身后或视线方向。可见 NPC 的存在和位置不表示其正在注视谁、保持何种姿态或采取行动；没有已提交 NPC 行动或可见事实时，不得补写目光、转身、凝视或意图。feature 的 label/state 只证明该要素及其已投影状态：不得由“湿/带泥”扩写出脚下重合、一路脚印、痕迹来源、靴子或气味，不得由炉台/火炬/烛台扩写出未投影的火苗、声音、阴影或气味，不得由桌、床或台面扩写出白布、停灵用途或其他陈设。

引用契约：referencedProjectionRefs、agencyClaims[].subjectRef 与 basisRefs 都不是说明文字或 JSON 路径，必须从本次 audienceProjection 中已有的字符串值逐字复制，不得改写、翻译、缩写或新造 ID；每个 basisRef 还必须同时列入 referencedProjectionRefs。
agencyClaims 必须显式列出回应中涉及能动性归属的全部断言；没有此类断言时也必须提交空数组。每项都要声明 subjectKind、subjectRef、claimKind 和投影内 basisRefs。playerCharacter 或 npc 的 subjectKind/subjectRef 必须逐字复制 audienceProjection.agencySubjects 中同一完整条目；playerCharacter 只允许 committedObservableAction（已经提交且可观察的行动）或 sensoryConsequence（外界刺激、身体感觉或规则后果）；world 必须使用 subjectRef=null 且只允许 sensoryConsequence。thought、emotion、dialogue、nextAction 只可用于由 KP 控制且投影有依据的 NPC。不得漏报、伪装或用正文绕开这些声明。

这是单槽、不可回看的当前回应，不生成历史摘要。输出只调用 submit_current_narration 一次。不要输出解释文字。`;

function safeNarrationReceipt(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const receipt = value as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of ["receiptId", "rootActionId", "status", "runtimeEpochId", "activeBranchId"] as const) {
    if (typeof receipt[key] === "string" && receipt[key].length > 0) safe[key] = receipt[key];
  }
  if (receipt.eventRange === null) {
    safe.eventRange = null;
  } else if (receipt.eventRange !== null
    && typeof receipt.eventRange === "object"
    && !Array.isArray(receipt.eventRange)) {
    const source = receipt.eventRange as Record<string, unknown>;
    const eventRange: Record<string, unknown> = {};
    for (const key of ["first", "last"] as const) {
      if (typeof source[key] === "string" && source[key].length > 0) eventRange[key] = source[key];
    }
    for (const key of ["from", "to"] as const) {
      if (Number.isSafeInteger(source[key])) eventRange[key] = source[key];
    }
    if (Object.keys(eventRange).length > 0) safe.eventRange = eventRange;
  }
  if (typeof receipt.meaningfulFailure === "boolean") {
    safe.meaningfulFailure = receipt.meaningfulFailure;
  }
  return safe;
}

function proposalToolModelInput(
  userPayload: Record<string, unknown>,
  temperature = 0.2,
): Record<string, unknown> {
  return {
    messages: [
      { role: "system", content: PROPOSAL_SYSTEM },
      { role: "user", content: canonicalJson(userPayload) },
    ],
    tools: [PROPOSAL_TOOL],
    tool_choice: "required",
    parallel_tool_calls: false,
    temperature,
    max_completion_tokens: 2_000,
  };
}

export function proposalModelInput(request: KpProposalRequest): Record<string, unknown> {
  return proposalToolModelInput({
    proposalAttempt: request.attempt,
    action: request.input,
    rulesDiagnostics: request.diagnostics ?? null,
    kpProjection: request.projection,
  });
}

export function proposalSchemaCorrectionModelInput(
  request: KpProposalRequest,
): Record<string, unknown> {
  return proposalToolModelInput({
    proposalAttempt: request.attempt,
    action: request.input,
    rulesDiagnostics: request.diagnostics ?? null,
    kpProjection: request.projection,
    proposalSchemaCorrection: {
      previousProposalStatus: "discardedBeforeCommit",
      reason: "closedSchemaValidationFailed",
      replacementAttempt: 1,
      instruction: "重新依据同一 action、rulesDiagnostics 和 kpProjection 作答，只调用一次 submit_kp_proposal，提交一个完整的替代提案。",
      requirements: [
        "不要复述、引用或局部修补先前模型输出；从本条消息中的原始输入重新生成完整对象。",
        "这次替代只能纠正输出结构；必须保持 action 的原始目标、做法、对象、风险、资源选择与语义范围，不得替换成更简单、更安全或不同的行动。",
        "严格遵守工具中的封闭 schema：必填字段全部提供，禁止额外字段，null 与数组形状必须精确匹配。",
        "若行动只是观察明显可见内容，resolveDirectConsequences 必须且只能包含 operation、duration、frozenCosts、success、failure；frozenCosts 和 failure 均为 []。",
      ],
    },
  }, 0);
}

function narrationUserPayload(request: KpNarrationRequest): Record<string, unknown> {
  const projection = request.projection !== null
    && typeof request.projection === "object"
    && !Array.isArray(request.projection)
    ? request.projection as Record<string, unknown>
    : {};
  return {
    committedReceipt: safeNarrationReceipt(request.receipt),
    ...(projection.committedDelta === undefined
      ? {}
      : { committedDelta: projection.committedDelta }),
    audienceProjection: projection,
  };
}

function narrationToolModelInput(userPayload: Record<string, unknown>): Record<string, unknown> {
  return {
    messages: [
      { role: "system", content: NARRATION_SYSTEM },
      { role: "user", content: canonicalJson(userPayload) },
    ],
    tools: [NARRATION_TOOL],
    tool_choice: "required",
    parallel_tool_calls: false,
    temperature: 0,
    max_completion_tokens: 800,
  };
}

export function narrationModelInput(request: KpNarrationRequest): Record<string, unknown> {
  return narrationToolModelInput(narrationUserPayload(request));
}

export function narrationSchemaCorrectionModelInput(
  request: KpNarrationRequest,
): Record<string, unknown> {
  return narrationToolModelInput({
    ...narrationUserPayload(request),
    narrationOutputCorrection: {
      previousNarrationStatus: "discardedBeforeDelivery",
      reason: "closedSchemaOrCurrentProjectionGroundingValidationFailed",
      replacementAttempt: 1,
      instruction: "重新只依据本条消息中的当前 committedReceipt、committedDelta 与 audienceProjection，调用一次 submit_current_narration，提交一个完整且有依据的替代回应。",
      requirements: [
        "不要复述、引用、解释或局部修补先前模型输出；先前无效正文不会提供，也不得猜测其内容。",
        "不得改判已提交结果、改变受众或添加新事件；只呈现当前投影明确支持的结果与可行动信息。",
        "experiencedTranscript 只可维持对话连续性，不是当前状态、空间或感官证据；与当前 committedDelta 或当前投影冲突时以后两者为准。",
        "body 与 tts 中每个具体感官、空间、姿态、目光、声音、气味或陈设细节都必须有当前投影中的明确文字证据；没有就省略，即使替代回应因此更短。",
        "tacticalProjection 的坐标、约距、feature 标签和 textualReadout 是机械/UI 数据，不得自行扩写成文学细节，也不得在玩家未询问时逐项报距离。",
        "严格遵守工具的封闭 schema、agencyClaims 与引用契约；必填字段全部提供，禁止额外字段。",
      ],
    },
  });
}
