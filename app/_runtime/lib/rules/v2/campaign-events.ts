import type {
  AuthoritativeWorldState,
  EventEnvelope,
  EventPayloadByType,
  EventType,
  JsonRecord,
  KnowledgeRecord,
} from "./model";
import { itemById } from "../../dnd/gear";
import { endCharacterTenure } from "./character-lifecycle";
import { actorPlanNpcIsAvailable, actorPlanPremiseIsAvailable } from "./actor-plans";
import {
  isDefinitionRegisteredAbilityPayload,
  registeredAbilityRecord,
} from "../profiles/ability-compiler";
import {
  isNpcMechanicalItemDefinition,
  isNpcMechanicalTemplateDefinition,
  NPC_MECHANICAL_ITEM_KIND,
  NPC_MECHANICAL_TEMPLATE_KIND,
  synchronizeCombatItemResources,
  transferredNpcMechanicalItemId,
} from "./npc-mechanics";
import { MAX_EXPERIENCE_AWARD } from "./character-progression";
import {
  campaignContinuityManifestForSchema,
  continuityManifestsEqual,
  isCampaignContinuityManifest,
} from "./campaign-continuity";
import {
  hasExactKeys,
  isNonEmptyString,
  isProfileRef,
  isRecord,
  isSha256,
} from "./validation";

export const CAMPAIGN_EVENT_TYPES = [
  "FeasibilityRuled",
  "AdjudicationPrecedentRecorded",
  "AdjudicationPrecedentSuperseded",
  "ResourceReserved",
  "CheckFrozen",
  "FictionTimeAdvanced",
  "ContestFrozen",
  "ContestResolved",
  "SaveFrozen",
  "ResourceUsed",
  "ResourceChanged",
  "ItemUsed",
  "ItemTransferred",
  "ArtifactMaterialized",
  "ArtifactAcquired",
  "ArtifactUsed",
  "ArtifactTransferred",
  "ActivityStarted",
  "RestStarted",
  "GroupRestOffered",
  "GroupRestConsentRecorded",
  "ActivityInterrupted",
  "ActivityCompleted",
  "RestCompleted",
  "DefinitionRegistered",
  "HazardTriggered",
  "DamagePacketResolved",
  "HitPointsChanged",
  "CreatureDied",
  "CanonicalFactDeclared",
  "SensoryEvidenceAcquired",
  "SourceClaimCreated",
  "CharacterInferenceFormed",
  "RelationshipChanged",
  "RelationshipEstablished",
  "PromiseMade",
  "PromiseAssumed",
  "DebtIncurred",
  "DebtAssumed",
  "NpcPlanFormed",
  "NpcActionCommitted",
  "NpcPlanCancelled",
  "NpcPlanRevised",
  "FactionPlanFormed",
  "FactionActionCommitted",
  "FactionPlanAdvanced",
  "SceneQuestionOpened",
  "MeaningfulFailureCommitted",
  "RetryConditionChanged",
  "SceneQuestionAnswered",
  "EndingCandidateRaised",
  "StoryConcluded",
  "EpilogueChoiceRecorded",
  "SequelStarted",
  "ExperienceAwarded",
  "AdvancementAvailable",
  "CharacterAdvanced",
  "ChapterConcluded",
  "ChapterContinuityRecorded",
  "ModuleVersionMigrated",
  "ChapterStarted",
  "InheritanceSourceEstablished",
  "InheritanceTransferred",
] as const satisfies readonly EventType[];

function synchronizeMechanicalNpcResource(
  state: AuthoritativeWorldState,
  characterId: string,
  resourceId: string,
  before: number,
  after: number,
): void {
  const combatEntity = state.combatRuntime.entities[characterId];
  if (!isRecord(combatEntity)
    || !isNonEmptyString(combatEntity.mechanicalDefinitionRef)) return;
  const pool = isRecord(combatEntity.resources)
    ? combatEntity.resources[resourceId]
    : undefined;
  if (!isRecord(pool) || Number(pool.current) !== before) {
    throw new TypeError("combat NPC resource cache mismatch");
  }
  pool.current = String(after);
}

type CampaignEventType = typeof CAMPAIGN_EVENT_TYPES[number];

const PAYLOAD_KEYS: Record<CampaignEventType, readonly string[]> = {
  FeasibilityRuled: ["characterId", "feasibilityKind", "goal", "method", "publicBasis"],
  AdjudicationPrecedentRecorded: [
    "applicabilityScope",
    "canonicalContextFingerprint",
    "mechanics",
    "precedentId",
    "privateBasisRefs",
    "publicBasisRefs",
    "publicExplanation",
    "publicRuleBasis",
    "rulesetProfile",
    "runtimeManifestProfile",
  ],
  AdjudicationPrecedentSuperseded: [
    "applicabilityScope",
    "canonicalContextFingerprint",
    "materialDifferences",
    "mechanics",
    "precedentId",
    "privateBasisRefs",
    "publicBasisRefs",
    "publicExplanation",
    "publicRuleBasis",
    "rulesetProfile",
    "runtimeManifestProfile",
    "supersededPrecedentId",
  ],
  ResourceReserved: ["amount", "characterId", "purpose", "resourceId"],
  CheckFrozen: ["ability", "characterId", "checkKind", "dc", "failure", "mode", "skill", "success"],
  FictionTimeAdvanced: ["durationMicros", "reason"],
  ContestFrozen: ["defenderCheck", "defenderId", "initiatorCheck", "initiatorId", "tieResult"],
  ContestResolved: [
    "continuationIds",
    "defenderId",
    "defenderRolls",
    "defenderTotal",
    "initiatorId",
    "initiatorRolls",
    "initiatorTotal",
    "outcome",
    "winnerId",
  ],
  SaveFrozen: ["ability", "dc", "failure", "sourceDefinitionId", "success", "targetId"],
  ResourceUsed: ["amount", "characterId", "purpose", "resourceId"],
  ResourceChanged: ["after", "before", "characterId", "delta", "reason", "resourceId"],
  ItemUsed: ["characterId", "itemId", "purpose", "quantity", "remaining"],
  ItemTransferred: [
    "fromCharacterId",
    "itemId",
    "method",
    "quantity",
    "targetItemId",
    "toCharacterId",
  ],
  ArtifactMaterialized: [
    "artifactId",
    "definitionRef",
    "name",
    "quantity",
    "sceneId",
    "status",
    "visibilityPolicyId",
  ],
  ArtifactAcquired: [
    "afterStatus",
    "artifactId",
    "beforeStatus",
    "characterId",
    "fromSceneId",
    "remainingQuantity",
  ],
  ArtifactUsed: [
    "afterStatus",
    "artifactId",
    "beforeStatus",
    "characterId",
    "purpose",
    "remainingQuantity",
  ],
  ArtifactTransferred: ["artifactId", "fromCharacterId", "method", "toCharacterId"],
  ActivityStarted: ["activityId", "activityKind", "characterId", "completion", "intendedDurationMicros"],
  RestStarted: ["activityId", "characterId", "intendedDurationMicros", "recoveryChoice", "restKind"],
  GroupRestOffered: [
    "initiatorCharacterId",
    "intendedDurationMicros",
    "invitedCharacterIds",
    "pendingInputIds",
    "restKind",
  ],
  GroupRestConsentRecorded: [
    "accepted",
    "invitedCharacterId",
    "pendingInputId",
    "recoveryChoice",
    "remainingPendingInputIds",
  ],
  ActivityInterrupted: ["activityId", "cause"],
  ActivityCompleted: ["activityId"],
  RestCompleted: [
    "activityId",
    "characterId",
    "completedAtFictionMicros",
    "continuationId",
    "recovery",
    "restKind",
    "resultingCharacter",
  ],
  DefinitionRegistered: ["definition"],
  HazardTriggered: ["causeFactIds", "definitionId", "triggeringEntityId", "zoneId"],
  DamagePacketResolved: ["amount", "damageType", "sourceDefinitionId", "targetId"],
  HitPointsChanged: ["after", "before", "causeId", "characterId", "maximum"],
  CreatureDied: ["causeId", "characterId"],
  CanonicalFactDeclared: ["fact"],
  SensoryEvidenceAcquired: ["characterId", "clarity", "factId", "publicEvidence", "sense"],
  SourceClaimCreated: ["claimId", "formedAtFictionMicros", "motive", "semanticContent", "sourceBasis", "speakerId"],
  CharacterInferenceFormed: ["characterId", "confidence", "conclusion", "evidenceRefs", "inferenceId"],
  RelationshipChanged: ["basisFactIds", "change", "relationshipId", "subjectIds"],
  RelationshipEstablished: ["authorizationId", "basisFactIds", "relationshipId", "sourceFactId", "sourceRelationshipId", "subjectIds", "value"],
  PromiseMade: ["condition", "content", "promiseeId", "promiseId", "promisorId"],
  PromiseAssumed: ["authorizationId", "condition", "content", "promiseeId", "promiseId", "promisorId", "sourceFactId", "sourcePromiseId"],
  DebtIncurred: ["basisFactIds", "condition", "creditorId", "debtId", "debtorId", "obligation"],
  DebtAssumed: ["authorizationId", "basisFactIds", "condition", "creditorId", "debtId", "debtorId", "obligation", "sourceDebtId", "sourceFactId"],
  NpcPlanFormed: ["goal", "knowledgeRefs", "nextAction", "npcId", "planId", "resourceRefs"],
  NpcActionCommitted: [
    "causedByRootActionId",
    "decision",
    "nextStep",
    "npcId",
    "planId",
    "targetRef",
    "traceFactRef",
  ],
  NpcPlanCancelled: [
    "causedByRootActionId",
    "npcId",
    "planId",
    "priorRevision",
    "reason",
  ],
  NpcPlanRevised: [
    "alternateTarget",
    "causedByRootActionId",
    "decision",
    "due",
    "nextStep",
    "npcId",
    "planId",
    "premiseRefs",
    "priorRevision",
    "reason",
    "resourceRefs",
    "revision",
    "trace",
    "trigger",
  ],
  FactionPlanFormed: [
    "actingNpcId",
    "factionId",
    "planId",
    "premiseRefs",
    "resourceRefs",
    "revision",
    "status",
  ],
  FactionActionCommitted: [
    "actingNpcId",
    "causedByRootActionId",
    "decision",
    "factionId",
    "nextStep",
    "planId",
    "resourceRefs",
    "targetRef",
    "traceFactRef",
  ],
  FactionPlanAdvanced: ["action", "actingNpcId", "causeFactIds", "factionId", "planId"],
  SceneQuestionOpened: ["question", "sceneQuestionId"],
  MeaningfulFailureCommitted: ["characterId", "consequences", "factualCause", "goalId", "methodFingerprint"],
  RetryConditionChanged: ["change", "characterId", "evidence", "goalId"],
  SceneQuestionAnswered: ["answerFactIds", "sceneQuestionId"],
  EndingCandidateRaised: ["basisFactIds", "endingCandidateId", "unresolvedConsequences"],
  StoryConcluded: ["endingCandidateId", "longTermConsequences", "outcome", "storyId"],
  EpilogueChoiceRecorded: ["characterId", "choice", "storyId"],
  SequelStarted: ["anchorFactIds", "chapterId", "priorStoryId", "sceneQuestion", "sequelStoryId"],
  ExperienceAwarded: ["amount", "campaignId", "characterId", "sourceFactIds", "total"],
  AdvancementAvailable: ["campaignId", "characterId", "options", "pendingInputId", "sourceFactIds"],
  CharacterAdvanced: ["characterId", "choice", "pendingInputId", "resultingCharacter"],
  ChapterConcluded: ["campaignId", "chapterId", "continuityPolicy", "reason"],
  ChapterContinuityRecorded: ["campaignId", "fromChapterId", "manifest", "toChapterId"],
  ModuleVersionMigrated: ["campaignId", "fromModuleRef", "migrationRef", "toModuleRef"],
  ChapterStarted: ["campaignId", "chapterId", "moduleRef", "ordinal", "sceneQuestion", "storyAnchorRefs"],
  InheritanceSourceEstablished: ["factId", "predecessorCharacterId", "source", "successorCharacterId"],
  InheritanceTransferred: [
    "authorizationId",
    "kind",
    "predecessorCharacterId",
    "scope",
    "sourceFactId",
    "sourceRef",
    "subjectCharacterId",
    "successorCharacterId",
    "targetCharacterId",
    "targetRef",
  ],
};

const ACTOR_PLAN_FORMED_KEYS = [
  "activity",
  "actorKind",
  "actorRef",
  "alternateTarget",
  "chapterId",
  "decisionNpcId",
  "due",
  "goal",
  "knowledgeRefs",
  "moduleRef",
  "nextAction",
  "nextStep",
  "npcId",
  "planId",
  "premiseRefs",
  "resourceRefs",
  "revision",
  "status",
  "trace",
  "trigger",
] as const;

function strings(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(isNonEmptyString)
    && value.length === new Set(value).size;
}

function allRequiredStrings(value: JsonRecord, keys: readonly string[]): boolean {
  return keys.every((key) => isNonEmptyString(value[key]));
}

function validNpcPlanFormed(value: JsonRecord): boolean {
  const legacyKeys = PAYLOAD_KEYS.NpcPlanFormed;
  if (hasExactKeys(value, legacyKeys)) {
    return allRequiredStrings(value, ["goal", "nextAction", "npcId", "planId"])
      && strings(value.knowledgeRefs)
      && strings(value.resourceRefs);
  }
  if (
    !hasExactKeys(value, ACTOR_PLAN_FORMED_KEYS)
    || !allRequiredStrings(value, [
      "actorRef",
      "chapterId",
      "decisionNpcId",
      "goal",
      "nextAction",
      "nextStep",
      "npcId",
      "planId",
    ])
    || value.actorKind !== "npc"
    || value.actorRef !== value.npcId
    || value.decisionNpcId !== value.npcId
    || value.revision !== "1"
    || value.status !== "scheduled"
    || value.nextAction !== value.nextStep
    || !strings(value.knowledgeRefs)
    || !strings(value.premiseRefs)
    || value.premiseRefs.length === 0
    || !strings(value.resourceRefs)
    || !isProfileRef(value.moduleRef)
    || !isRecord(value.activity)
    || !hasExactKeys(value.activity, ["activityId", "activityKind", "intendedDurationMicros"])
    || !allRequiredStrings(value.activity, ["activityId", "activityKind"])
    || typeof value.activity.intendedDurationMicros !== "string"
    || !/^[1-9][0-9]*$/.test(value.activity.intendedDurationMicros)
    || !isRecord(value.trace)
    || !hasExactKeys(value.trace, ["description", "factRef", "visibilityPolicyRef"])
    || !allRequiredStrings(value.trace, ["description", "factRef", "visibilityPolicyRef"])
    || !isRecord(value.alternateTarget)
    || !hasExactKeys(value.alternateTarget, ["reason", "targetRef"])
    || !allRequiredStrings(value.alternateTarget, ["reason", "targetRef"])
  ) return false;

  const dueValid = value.due === null || (
    isRecord(value.due)
    && hasExactKeys(value.due, ["atFictionMicros", "kind"])
    && value.due.kind === "fictionTime"
    && typeof value.due.atFictionMicros === "string"
    && /^(0|[1-9][0-9]*)$/.test(value.due.atFictionMicros)
  );
  const triggerValid = value.trigger === null || (
    isRecord(value.trigger)
    && (
      (hasExactKeys(value.trigger, ["eventRef", "kind"])
        && value.trigger.kind === "committedEvent"
        && isNonEmptyString(value.trigger.eventRef))
      || (hasExactKeys(value.trigger, ["kind", "knowledgeRef"])
        && value.trigger.kind === "knowledgeAcquired"
        && isNonEmptyString(value.trigger.knowledgeRef)
        && value.knowledgeRefs.includes(value.trigger.knowledgeRef))
    )
  );
  return dueValid && triggerValid && ((value.due === null) !== (value.trigger === null));
}

function validAdjudicationPrecedent(value: JsonRecord): boolean {
  if (
    !allRequiredStrings(value, [
      "precedentId",
      "canonicalContextFingerprint",
      "publicExplanation",
    ])
    || !isSha256(value.canonicalContextFingerprint)
    || !strings(value.publicRuleBasis)
    || value.publicRuleBasis.length === 0
    || !strings(value.publicBasisRefs)
    || !strings(value.privateBasisRefs)
    || !isRecord(value.applicabilityScope)
    || !hasExactKeys(value.applicabilityScope, ["kind", "ref"])
    || !["scene", "campaign", "module", "room"].includes(String(value.applicabilityScope.kind))
    || !isNonEmptyString(value.applicabilityScope.ref)
    || !isProfileRef(value.rulesetProfile)
    || !isProfileRef(value.runtimeManifestProfile)
    || !isRecord(value.mechanics)
    || !hasExactKeys(value.mechanics, [
      "ability",
      "dc",
      "duration",
      "operation",
      "outcomeRange",
      "skill",
    ])
    || !isNonEmptyString(value.mechanics.operation)
    || !(value.mechanics.ability === null || isNonEmptyString(value.mechanics.ability))
    || !(value.mechanics.skill === null || isNonEmptyString(value.mechanics.skill))
    || !(value.mechanics.dc === null || Number.isSafeInteger(value.mechanics.dc))
    || !isRecord(value.mechanics.outcomeRange)
    || !hasExactKeys(value.mechanics.outcomeRange, ["failure", "success"])
    || !strings(value.mechanics.outcomeRange.success)
    || !strings(value.mechanics.outcomeRange.failure)
  ) return false;
  const duration = value.mechanics.duration;
  return duration === null || (
    isRecord(duration)
    && hasExactKeys(duration, ["unit", "value"])
    && ["round", "second", "minute", "hour", "day"].includes(String(duration.unit))
    && Number.isSafeInteger(duration.value)
    && Number(duration.value) > 0
  );
}

export function validateCampaignEventPayload(eventType: EventType, value: JsonRecord): boolean {
  if (!(CAMPAIGN_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return false;
  }
  const type = eventType as CampaignEventType;
  if (type === "DefinitionRegistered") {
    if (isDefinitionRegisteredAbilityPayload(value)) return true;
    if (!hasExactKeys(value, ["definition"]) || !isRecord(value.definition)) return false;
    if (value.definition.definitionKind === NPC_MECHANICAL_TEMPLATE_KIND) {
      return isNpcMechanicalTemplateDefinition(value.definition);
    }
    return value.definition.definitionKind === NPC_MECHANICAL_ITEM_KIND
      ? isNpcMechanicalItemDefinition(value.definition)
      : true;
  }
  if (type === "NpcPlanFormed") return validNpcPlanFormed(value);
  if (!hasExactKeys(value, PAYLOAD_KEYS[type])) {
    return false;
  }
  switch (type) {
    case "AdjudicationPrecedentRecorded":
      return validAdjudicationPrecedent(value);
    case "AdjudicationPrecedentSuperseded":
      return validAdjudicationPrecedent(value)
        && isNonEmptyString(value.supersededPrecedentId)
        && value.supersededPrecedentId !== value.precedentId
        && strings(value.materialDifferences)
        && value.materialDifferences.length > 0;
    case "ResourceReserved":
    case "ResourceUsed":
      return allRequiredStrings(value, ["characterId", "resourceId", "purpose"])
        && Number.isSafeInteger(value.amount) && Number(value.amount) > 0;
    case "ResourceChanged":
      return allRequiredStrings(value, ["characterId", "resourceId", "reason"])
        && [value.before, value.after, value.delta].every(Number.isSafeInteger)
        && Number(value.after) >= 0
        && Number(value.after) - Number(value.before) === Number(value.delta);
    case "NpcActionCommitted":
      return allRequiredStrings(value, [
        "causedByRootActionId",
        "nextStep",
        "npcId",
        "planId",
        "targetRef",
        "traceFactRef",
      ]) && value.decision === "execute";
    case "NpcPlanCancelled":
      return allRequiredStrings(value, [
        "causedByRootActionId",
        "npcId",
        "planId",
        "priorRevision",
        "reason",
      ]);
    case "NpcPlanRevised": {
      const dueValid = value.due === null || (
        isRecord(value.due)
        && hasExactKeys(value.due, ["atFictionMicros", "kind"])
        && value.due.kind === "fictionTime"
        && typeof value.due.atFictionMicros === "string"
        && /^(0|[1-9][0-9]*)$/.test(value.due.atFictionMicros)
      );
      const triggerValid = value.trigger === null || (
        isRecord(value.trigger)
        && (
          (hasExactKeys(value.trigger, ["kind", "knowledgeRef"])
            && value.trigger.kind === "knowledgeAcquired"
            && isNonEmptyString(value.trigger.knowledgeRef))
          || (hasExactKeys(value.trigger, ["eventRef", "kind"])
            && value.trigger.kind === "committedEvent"
            && isNonEmptyString(value.trigger.eventRef))
        )
      );
      return allRequiredStrings(value, [
        "causedByRootActionId",
        "nextStep",
        "npcId",
        "planId",
        "priorRevision",
        "reason",
        "revision",
      ])
        && (value.decision === "revise" || value.decision === "defer")
        && strings(value.premiseRefs)
        && value.premiseRefs.length > 0
        && strings(value.resourceRefs)
        && isRecord(value.trace)
        && hasExactKeys(value.trace, ["description", "factRef", "visibilityPolicyRef"])
        && allRequiredStrings(value.trace, ["description", "factRef", "visibilityPolicyRef"])
        && isRecord(value.alternateTarget)
        && hasExactKeys(value.alternateTarget, ["reason", "targetRef"])
        && allRequiredStrings(value.alternateTarget, ["reason", "targetRef"])
        && dueValid
        && triggerValid
        && ((value.due === null) !== (value.trigger === null));
    }
    case "FactionPlanFormed":
      return allRequiredStrings(value, [
        "actingNpcId",
        "factionId",
        "planId",
        "revision",
        "status",
      ])
        && value.revision === "1"
        && value.status === "scheduled"
        && strings(value.premiseRefs)
        && value.premiseRefs.length > 0
        && strings(value.resourceRefs)
        && value.resourceRefs.length > 0;
    case "FactionActionCommitted":
      return allRequiredStrings(value, [
        "actingNpcId",
        "causedByRootActionId",
        "factionId",
        "nextStep",
        "planId",
        "targetRef",
        "traceFactRef",
      ])
        && value.decision === "execute"
        && strings(value.resourceRefs)
        && value.resourceRefs.length > 0;
    case "ItemUsed":
      return allRequiredStrings(value, ["characterId", "itemId", "purpose"])
        && Number.isSafeInteger(value.quantity) && Number(value.quantity) > 0
        && Number.isSafeInteger(value.remaining) && Number(value.remaining) >= 0;
    case "ItemTransferred":
      return allRequiredStrings(value, [
        "fromCharacterId",
        "itemId",
        "method",
        "targetItemId",
        "toCharacterId",
      ])
        && value.fromCharacterId !== value.toCharacterId
        && Number.isSafeInteger(value.quantity)
        && Number(value.quantity) > 0;
    case "ArtifactMaterialized":
      return allRequiredStrings(value, [
        "artifactId",
        "definitionRef",
        "name",
        "sceneId",
        "visibilityPolicyId",
      ])
        && value.status === "placed"
        && value.quantity === 1;
    case "ArtifactAcquired":
      return allRequiredStrings(value, ["artifactId", "characterId", "fromSceneId"])
        && value.beforeStatus === "placed"
        && value.afterStatus === "held"
        && value.remainingQuantity === 1;
    case "ArtifactUsed":
      return allRequiredStrings(value, ["artifactId", "characterId", "purpose"])
        && value.beforeStatus === "held"
        && ["held", "consumed", "destroyed"].includes(String(value.afterStatus))
        && value.remainingQuantity === (value.afterStatus === "held" ? 1 : 0);
    case "CheckFrozen":
      return allRequiredStrings(value, ["characterId", "checkKind", "ability", "mode"])
        && (value.skill === null || isNonEmptyString(value.skill))
        && Number.isSafeInteger(value.dc)
        && isRecord(value.success) && isRecord(value.failure);
    case "FictionTimeAdvanced":
      return typeof value.durationMicros === "string" && /^[1-9][0-9]*$/.test(value.durationMicros)
        && isNonEmptyString(value.reason);
    case "ContestFrozen":
      return allRequiredStrings(value, ["initiatorId", "defenderId", "tieResult"])
        && isRecord(value.initiatorCheck) && isRecord(value.defenderCheck);
    case "ContestResolved":
      return allRequiredStrings(value, ["initiatorId", "defenderId", "outcome"])
        && (value.winnerId === null || isNonEmptyString(value.winnerId))
        && Array.isArray(value.initiatorRolls)
        && Array.isArray(value.defenderRolls)
        && [...value.initiatorRolls, ...value.defenderRolls].every((roll) =>
          Number.isInteger(roll) && Number(roll) >= 1 && Number(roll) <= 20)
        && Number.isInteger(value.initiatorTotal)
        && Number.isInteger(value.defenderTotal)
        && strings(value.continuationIds)
        && value.continuationIds.length === 2;
    case "SaveFrozen":
      return allRequiredStrings(value, ["targetId", "sourceDefinitionId", "ability"])
        && Number.isSafeInteger(value.dc) && isRecord(value.success) && isRecord(value.failure);
    case "HitPointsChanged":
      return allRequiredStrings(value, ["characterId", "causeId"])
        && [value.before, value.after, value.maximum].every(Number.isSafeInteger);
    case "DamagePacketResolved":
      return allRequiredStrings(value, ["targetId", "damageType", "sourceDefinitionId"])
        && Number.isSafeInteger(value.amount) && Number(value.amount) >= 0;
    case "CanonicalFactDeclared":
      return isRecord(value.fact);
    case "ActivityInterrupted":
      return isNonEmptyString(value.activityId) && isRecord(value.cause);
    case "ActivityStarted":
      return allRequiredStrings(value, ["activityId", "characterId", "activityKind"])
        && typeof value.intendedDurationMicros === "string"
        && /^[1-9][0-9]*$/.test(value.intendedDurationMicros)
        && isRecord(value.completion);
    case "RestStarted":
      return allRequiredStrings(value, ["activityId", "characterId"])
        && (value.restKind === "short" || value.restKind === "long")
        && typeof value.intendedDurationMicros === "string"
        && /^[1-9][0-9]*$/.test(value.intendedDurationMicros)
        && isRecord(value.recoveryChoice)
        && hasExactKeys(value.recoveryChoice, ["arcaneRecoverySlotLevels", "hitDiceToSpend"])
        && Number.isSafeInteger(value.recoveryChoice.hitDiceToSpend)
        && Number(value.recoveryChoice.hitDiceToSpend) >= 0
        && Array.isArray(value.recoveryChoice.arcaneRecoverySlotLevels)
        && value.recoveryChoice.arcaneRecoverySlotLevels.every((level) =>
          Number.isSafeInteger(level) && Number(level) >= 1 && Number(level) <= 5);
    case "GroupRestOffered":
      return isNonEmptyString(value.initiatorCharacterId)
        && strings(value.invitedCharacterIds)
        && strings(value.pendingInputIds)
        && value.invitedCharacterIds.length > 0
        && value.invitedCharacterIds.length === value.pendingInputIds.length
        && (value.restKind === "short" || value.restKind === "long")
        && typeof value.intendedDurationMicros === "string"
        && /^[1-9][0-9]*$/.test(value.intendedDurationMicros);
    case "GroupRestConsentRecorded":
      return isNonEmptyString(value.invitedCharacterId)
        && isNonEmptyString(value.pendingInputId)
        && typeof value.accepted === "boolean"
        && strings(value.remainingPendingInputIds)
        && (value.recoveryChoice === null
          || (isRecord(value.recoveryChoice)
            && hasExactKeys(value.recoveryChoice, ["arcaneRecoverySlotLevels", "hitDiceToSpend"])
            && Number.isSafeInteger(value.recoveryChoice.hitDiceToSpend)
            && Number(value.recoveryChoice.hitDiceToSpend) >= 0
            && Array.isArray(value.recoveryChoice.arcaneRecoverySlotLevels)
            && value.recoveryChoice.arcaneRecoverySlotLevels.every((level) =>
              Number.isSafeInteger(level) && Number(level) >= 1 && Number(level) <= 5)));
    case "RestCompleted":
      return allRequiredStrings(value, ["activityId", "characterId"])
        && (value.restKind === "short" || value.restKind === "long")
        && typeof value.completedAtFictionMicros === "string"
        && /^(0|[1-9][0-9]*)$/.test(value.completedAtFictionMicros)
        && (value.continuationId === null || isNonEmptyString(value.continuationId))
        && isRecord(value.resultingCharacter)
        && value.resultingCharacter.id === value.characterId
        && isRecord(value.recovery);
    case "CharacterAdvanced":
      return allRequiredStrings(value, ["pendingInputId", "characterId"])
        && isRecord(value.choice)
        && isRecord(value.resultingCharacter)
        && value.resultingCharacter.id === value.characterId;
    case "AdvancementAvailable":
      return allRequiredStrings(value, ["pendingInputId", "campaignId", "characterId"])
        && strings(value.sourceFactIds)
        && isRecord(value.options);
    case "ExperienceAwarded":
      return allRequiredStrings(value, ["campaignId", "characterId"])
        && Number.isSafeInteger(value.amount)
        && Number(value.amount) > 0
        && Number(value.amount) <= MAX_EXPERIENCE_AWARD
        && Number.isSafeInteger(value.total)
        && Number(value.total) >= Number(value.amount)
        && strings(value.sourceFactIds)
        && value.sourceFactIds.length > 0;
    case "ChapterContinuityRecorded":
      return allRequiredStrings(value, ["campaignId", "fromChapterId", "toChapterId"])
        && isCampaignContinuityManifest(value.manifest);
    case "ModuleVersionMigrated":
      return isNonEmptyString(value.campaignId)
        && isProfileRef(value.fromModuleRef)
        && isProfileRef(value.toModuleRef)
        && isProfileRef(value.migrationRef)
        && (value.fromModuleRef.profileId !== value.toModuleRef.profileId
          || value.fromModuleRef.profileHash !== value.toModuleRef.profileHash);
    case "ChapterStarted":
      return allRequiredStrings(value, ["campaignId", "chapterId", "ordinal", "sceneQuestion"])
        && isProfileRef(value.moduleRef)
        && strings(value.storyAnchorRefs);
    case "MeaningfulFailureCommitted":
      return allRequiredStrings(value, ["characterId", "goalId", "methodFingerprint", "factualCause"])
        && isRecord(value.consequences);
    case "DebtIncurred":
      return allRequiredStrings(value, [
        "condition",
        "creditorId",
        "debtId",
        "debtorId",
        "obligation",
      ])
        && strings(value.basisFactIds)
        && value.basisFactIds.length > 0;
    case "RelationshipEstablished":
      return allRequiredStrings(value, [
        "authorizationId",
        "relationshipId",
        "sourceFactId",
        "sourceRelationshipId",
        "value",
      ])
        && strings(value.subjectIds)
        && value.subjectIds.length >= 2
        && strings(value.basisFactIds)
        && value.basisFactIds.includes(value.sourceFactId as string);
    case "DebtAssumed":
      return allRequiredStrings(value, [
        "authorizationId",
        "condition",
        "creditorId",
        "debtId",
        "debtorId",
        "obligation",
        "sourceDebtId",
        "sourceFactId",
      ])
        && strings(value.basisFactIds)
        && value.basisFactIds.includes(value.sourceFactId as string);
    case "PromiseAssumed":
      return allRequiredStrings(value, [
        "authorizationId",
        "condition",
        "content",
        "promiseeId",
        "promiseId",
        "promisorId",
        "sourceFactId",
        "sourcePromiseId",
      ]);
    case "InheritanceSourceEstablished":
      return allRequiredStrings(value, ["predecessorCharacterId", "successorCharacterId", "factId"])
        && isRecord(value.source)
        && hasExactKeys(value.source, ["authorizations", "kind", "publicClause"])
        && isNonEmptyString(value.source.kind)
        && isNonEmptyString(value.source.publicClause)
        && Array.isArray(value.source.authorizations)
        && value.source.authorizations.length > 0
        && value.source.authorizations.every((authorization) => isRecord(authorization)
          && hasExactKeys(authorization, [
            "authorizationId",
            "kind",
            "scope",
            "sourceRef",
            "subjectCharacterId",
            "targetCharacterId",
            "targetRef",
          ])
          && allRequiredStrings(authorization, [
            "authorizationId",
            "kind",
            "scope",
            "sourceRef",
            "subjectCharacterId",
            "targetCharacterId",
            "targetRef",
          ]));
    case "InheritanceTransferred":
      return allRequiredStrings(value, [
        "authorizationId",
        "kind",
        "predecessorCharacterId",
        "scope",
        "sourceFactId",
        "sourceRef",
        "subjectCharacterId",
        "successorCharacterId",
        "targetCharacterId",
        "targetRef",
      ]);
    default:
      for (const [key, entry] of Object.entries(value)) {
        if (key.endsWith("Ids") || key.endsWith("Refs") || key.endsWith("Consequences")) {
          if (!strings(entry)) return false;
        } else if (typeof entry === "string" && !isNonEmptyString(entry)) {
          return false;
        }
      }
      return true;
  }
}

function knowledgeFor(state: AuthoritativeWorldState, characterId: string) {
  return state.knowledge[characterId] ??= {};
}

function consumedInheritanceAuthorization(
  state: AuthoritativeWorldState,
  sourceFactId: string,
  authorizationId: string,
  kind: string,
  targetRef: string,
): JsonRecord | undefined {
  const source = state.campaignRuntime.inheritanceSources[sourceFactId];
  const body = isRecord(source?.source) ? source.source : undefined;
  const authorizations = Array.isArray(body?.authorizations) ? body.authorizations : [];
  const authorization = authorizations.find((candidate) => isRecord(candidate)
    && candidate.authorizationId === authorizationId
    && candidate.kind === kind
    && candidate.targetRef === targetRef);
  const consumed = Array.isArray(source?.consumedAuthorizationIds)
    ? source.consumedAuthorizationIds
    : [];
  return isRecord(authorization) && consumed.includes(authorizationId)
    ? authorization
    : undefined;
}

function setKnowledge(
  state: AuthoritativeWorldState,
  event: EventEnvelope,
  characterId: string,
  knowledgeRef: string,
  objectKind: KnowledgeRecord["objectKind"],
  content: unknown,
  provenanceChain: string[],
  sourceCharacterId: string | null = null,
  visibility: KnowledgeRecord["visibility"] = sourceCharacterId === null ? "private" : "shared",
) {
  knowledgeFor(state, characterId)[knowledgeRef] = {
    characterId,
    knowledgeRef,
    objectKind,
    layer: "full",
    content: structuredClone(content),
    visibility,
    acquiredByEventId: event.eventId,
    acquiredAtFictionMicros: event.fictionInstantMicros,
    sourceCharacterId,
    provenanceChain: [...provenanceChain, event.eventId],
  };
}

/** Applies one closed campaign event; returns false for core event types. */
export function applyCampaignEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  const runtime = state.campaignRuntime;
  switch (event.eventType) {
    case "AdjudicationPrecedentRecorded": {
      const payload = event.payload as EventPayloadByType["AdjudicationPrecedentRecorded"];
      const precedents = runtime.adjudicationPrecedents ??= {};
      if (precedents[payload.precedentId] !== undefined) {
        throw new TypeError("adjudication precedent already exists");
      }
      precedents[payload.precedentId] = {
        ...structuredClone(payload),
        status: "active",
        recordedAtEventId: event.eventId,
        recordedByRootActionId: event.rootActionId,
      };
      return true;
    }
    case "AdjudicationPrecedentSuperseded": {
      const payload = event.payload as EventPayloadByType["AdjudicationPrecedentSuperseded"];
      const precedents = runtime.adjudicationPrecedents ??= {};
      const prior = precedents[payload.supersededPrecedentId];
      if (
        prior?.status !== "active"
        || precedents[payload.precedentId] !== undefined
        || prior.canonicalContextFingerprint === payload.canonicalContextFingerprint
      ) {
        throw new TypeError("adjudication precedent supersession precondition mismatch");
      }
      precedents[payload.supersededPrecedentId] = {
        ...structuredClone(prior),
        status: "superseded",
        supersededAtEventId: event.eventId,
        supersededByPrecedentId: payload.precedentId,
      };
      precedents[payload.precedentId] = {
        ...structuredClone(payload),
        status: "active",
        recordedAtEventId: event.eventId,
        recordedByRootActionId: event.rootActionId,
      };
      return true;
    }
    case "FeasibilityRuled":
    case "CheckFrozen":
    case "ContestFrozen":
    case "ContestResolved":
    case "SaveFrozen":
    case "HazardTriggered":
    case "DamagePacketResolved":
      return true;
    case "ResourceReserved":
    case "ResourceUsed": {
      const payload = event.payload as EventPayloadByType["ResourceUsed"];
      const resources = state.entities[payload.characterId]?.resources;
      if (resources === undefined || (resources[payload.resourceId] ?? 0) < payload.amount) throw new TypeError("resource unavailable");
      const before = resources[payload.resourceId];
      resources[payload.resourceId] -= payload.amount;
      synchronizeMechanicalNpcResource(
        state,
        payload.characterId,
        payload.resourceId,
        before,
        resources[payload.resourceId],
      );
      return true;
    }
    case "ResourceChanged": {
      const payload = event.payload as EventPayloadByType["ResourceChanged"];
      const resources = state.entities[payload.characterId]?.resources;
      if (resources === undefined || (resources[payload.resourceId] ?? 0) !== payload.before) {
        throw new TypeError("resource change precondition mismatch");
      }
      resources[payload.resourceId] = payload.after;
      synchronizeMechanicalNpcResource(
        state,
        payload.characterId,
        payload.resourceId,
        payload.before,
        payload.after,
      );
      return true;
    }
    case "ItemUsed": {
      const payload = event.payload as EventPayloadByType["ItemUsed"];
      const backpack = state.entities[payload.characterId]?.loadout?.backpack;
      if (state.entities[payload.characterId]?.loadout?.mechanicalItems?.[payload.itemId]
        !== undefined) {
        throw new TypeError("mechanical item instances require an explicit lifecycle transition");
      }
      const item = backpack?.find((entry) => entry.itemId === payload.itemId);
      if (item === undefined || item.quantity - payload.quantity !== payload.remaining) {
        throw new TypeError("item quantity precondition mismatch");
      }
      const combatEntity = state.combatRuntime.entities[payload.characterId];
      const combatResources = combatEntity !== undefined && isRecord(combatEntity.resources)
        ? combatEntity.resources
        : undefined;
      const combatItem = combatResources === undefined
        ? undefined
        : combatResources[`item:${payload.itemId}`];
      if (
        combatEntity !== undefined
        && (!isRecord(combatItem) || Number(combatItem.current) !== item.quantity)
      ) throw new TypeError("combat item cache does not match authoritative inventory");
      if (payload.remaining === 0) {
        backpack!.splice(backpack!.indexOf(item), 1);
        const loadout = state.entities[payload.characterId]!.loadout!;
        if (loadout.equipped.ammo === payload.itemId) delete loadout.equipped.ammo;
      } else {
        item.quantity = payload.remaining;
      }
      if (combatEntity !== undefined) {
        synchronizeCombatItemResources(
          combatEntity,
          state.entities[payload.characterId]!.loadout!,
        );
      }
      return true;
    }
    case "ItemTransferred": {
      const payload = event.payload as EventPayloadByType["ItemTransferred"];
      const from = state.entities[payload.fromCharacterId];
      const to = state.entities[payload.toCharacterId];
      const fromCombat = state.combatRuntime.entities[payload.fromCharacterId];
      const toCombat = state.combatRuntime.entities[payload.toCharacterId];
      const mechanicalNpcInvolved = (from?.kind === "npc"
        && isRecord(fromCombat)
        && isNonEmptyString(fromCombat.mechanicalDefinitionRef))
        || (to?.kind === "npc"
          && isRecord(toCombat)
          && isNonEmptyString(toCombat.mechanicalDefinitionRef));
      const activeEncounter = [from?.id, to?.id].some((characterId) => characterId !== undefined
        && Object.values(state.combatRuntime.encounters).some((encounter) =>
          encounter.status !== "concluded"
          && Array.isArray(encounter.participantEntityIds)
          && encounter.participantEntityIds.includes(characterId)));
      if (from?.tenureStatus !== "active"
        || to?.tenureStatus !== "active"
        || from.sceneId !== to.sceneId
        || from.loadout === undefined
        || to.loadout === undefined
        || !mechanicalNpcInvolved
        || activeEncounter) {
        throw new TypeError("item transfer participants are unavailable");
      }
      const sourceItem = from.loadout.backpack.find(({ itemId }) => itemId === payload.itemId);
      if (sourceItem === undefined || sourceItem.quantity < payload.quantity) {
        throw new TypeError("transferred item is unavailable");
      }
      const mechanicalItem = from.loadout.mechanicalItems?.[payload.itemId];
      const standardItem = itemById(payload.itemId);
      const instantiateStandardEquipment = mechanicalItem === undefined
        && to.kind === "npc"
        && isRecord(toCombat)
        && isNonEmptyString(toCombat.mechanicalDefinitionRef)
        && standardItem !== undefined
        && standardItem.wear !== "pack"
        && standardItem.wear !== "ammo";
      const expectedTargetItemId = instantiateStandardEquipment
        ? transferredNpcMechanicalItemId(
            to.id,
            payload.itemId,
            event.rootActionId,
          )
        : payload.itemId;
      if (payload.targetItemId !== expectedTargetItemId
        || (mechanicalItem !== undefined && !(to.kind === "npc"
          && isRecord(toCombat)
          && isNonEmptyString(toCombat.mechanicalDefinitionRef)))) {
        throw new TypeError("transferred item identity is not canonical");
      }
      if (mechanicalItem !== undefined && (
        payload.quantity !== 1
        || sourceItem.quantity !== 1
        || to.loadout.mechanicalItems?.[payload.targetItemId] !== undefined
      )) {
        throw new TypeError("mechanical item instances cannot be stacked or duplicated");
      }
      if (instantiateStandardEquipment && (
        payload.quantity !== 1
        || to.loadout.mechanicalItems?.[payload.targetItemId] !== undefined
        || to.loadout.backpack.some(({ itemId }) => itemId === payload.targetItemId)
        || Object.values(to.loadout.equipped).includes(payload.targetItemId)
      )) {
        throw new TypeError("standard equipment must enter a mechanical NPC as one instance");
      }
      sourceItem.quantity -= payload.quantity;
      if (sourceItem.quantity === 0) {
        from.loadout.backpack.splice(from.loadout.backpack.indexOf(sourceItem), 1);
        if (from.loadout.equipped.ammo === payload.itemId) delete from.loadout.equipped.ammo;
      }
      const targetItem = to.loadout.backpack.find(({ itemId }) =>
        itemId === payload.targetItemId);
      if (targetItem === undefined) {
        to.loadout.backpack.push({ itemId: payload.targetItemId, quantity: payload.quantity });
        to.loadout.backpack.sort((left, right) => left.itemId.localeCompare(right.itemId));
      } else {
        targetItem.quantity += payload.quantity;
      }
      if (mechanicalItem !== undefined) {
        delete from.loadout.mechanicalItems![payload.itemId];
        if (Object.keys(from.loadout.mechanicalItems!).length === 0) {
          delete from.loadout.mechanicalItems;
        }
        to.loadout.mechanicalItems ??= {};
        to.loadout.mechanicalItems[payload.targetItemId] = structuredClone(mechanicalItem);
      } else if (instantiateStandardEquipment) {
        to.loadout.mechanicalItems ??= {};
        to.loadout.mechanicalItems[payload.targetItemId] = {
          sourceKind: "standardGear",
          definitionRef: payload.itemId,
          status: "usable",
        };
      }
      synchronizeCombatItemResources(fromCombat, from.loadout);
      synchronizeCombatItemResources(toCombat, to.loadout);
      return true;
    }
    case "ArtifactMaterialized": {
      const payload = event.payload as EventPayloadByType["ArtifactMaterialized"];
      const definition = runtime.definitions[payload.definitionRef];
      if (
        runtime.artifacts[payload.artifactId] !== undefined
        || definition?.definitionKind !== "item"
        || !isRecord(definition.content)
        || definition.content.artifactId !== payload.artifactId
        || definition.content.name !== payload.name
        || definition.content.sceneRef !== payload.sceneId
        || !(payload.sceneId in state.scenes)
      ) throw new TypeError("materialized artifact definition is unavailable");
      runtime.artifacts[payload.artifactId] = {
        artifactId: payload.artifactId,
        definitionRef: payload.definitionRef,
        name: payload.name,
        status: payload.status,
        quantity: payload.quantity,
        sceneId: payload.sceneId,
        visibilityPolicyId: payload.visibilityPolicyId,
        materializedByEventId: event.eventId,
      };
      return true;
    }
    case "ArtifactAcquired": {
      const payload = event.payload as EventPayloadByType["ArtifactAcquired"];
      const artifact = runtime.artifacts[payload.artifactId];
      const holder = state.entities[payload.characterId];
      if (
        artifact?.status !== payload.beforeStatus
        || artifact.quantity !== payload.remainingQuantity
        || artifact.sceneId !== payload.fromSceneId
        || holder?.tenureStatus !== "active"
        || holder.sceneId !== payload.fromSceneId
      ) throw new TypeError("artifact acquisition precondition mismatch");
      artifact.status = payload.afterStatus;
      artifact.holderId = payload.characterId;
      artifact.acquiredByEventId = event.eventId;
      delete artifact.sceneId;
      return true;
    }
    case "ArtifactUsed": {
      const payload = event.payload as EventPayloadByType["ArtifactUsed"];
      const artifact = runtime.artifacts[payload.artifactId];
      if (
        artifact?.holderId !== payload.characterId
        || artifact.status !== payload.beforeStatus
        || artifact.quantity !== 1
      ) throw new TypeError("artifact use precondition mismatch");
      artifact.status = payload.afterStatus;
      artifact.quantity = payload.remainingQuantity;
      if (payload.afterStatus !== "held") delete artifact.holderId;
      return true;
    }
    case "FictionTimeAdvanced": {
      const payload = event.payload as EventPayloadByType["FictionTimeAdvanced"];
      const timeline = state.fictionTimelines[event.fictionTimelineId];
      if (timeline === undefined) throw new TypeError("fiction timeline is unavailable");
      timeline.nowMicros = (BigInt(timeline.nowMicros) + BigInt(payload.durationMicros)).toString();
      return true;
    }
    case "ArtifactTransferred": {
      const payload = event.payload as EventPayloadByType["ArtifactTransferred"];
      const artifact = runtime.artifacts[payload.artifactId];
      const from = state.entities[payload.fromCharacterId];
      const to = state.entities[payload.toCharacterId];
      if (
        artifact?.holderId !== payload.fromCharacterId
        || artifact.status !== "held"
        || (artifact.quantity ?? 1) !== 1
        || from?.sceneId !== to?.sceneId
      ) throw new TypeError("artifact holder mismatch");
      artifact.holderId = payload.toCharacterId;
      artifact.status = "held";
      return true;
    }
    case "RestStarted": {
      const payload = event.payload as EventPayloadByType["RestStarted"];
      if (runtime.activities[payload.activityId] !== undefined) throw new TypeError("activity already exists");
      runtime.activities[payload.activityId] = { ...structuredClone(payload), status: "active", startedAtFictionMicros: event.fictionInstantMicros };
      return true;
    }
    case "GroupRestOffered": {
      const payload = event.payload as EventPayloadByType["GroupRestOffered"];
      if (!(payload.initiatorCharacterId in state.entities)) throw new TypeError("group rest initiator is unavailable");
      for (let index = 0; index < payload.invitedCharacterIds.length; index += 1) {
        const characterId = payload.invitedCharacterIds[index];
        const pendingInputId = payload.pendingInputIds[index];
        if (!(characterId in state.entities) || pendingInputId in state.pendingInputs) {
          throw new TypeError("group rest invitation is unavailable");
        }
        state.pendingInputs[pendingInputId] = {
          pendingInputId,
          kind: "groupRestConsent",
          rootActionId: event.rootActionId,
          controllerCharacterId: characterId,
          question: `是否自愿加入${payload.restKind === "long" ? "长休" : "短休"}？请自行选择恢复资源。`,
          options: {
            initiatorCharacterId: payload.initiatorCharacterId,
            restKind: payload.restKind,
            intendedDurationMicros: payload.intendedDurationMicros,
            offeredAtFictionMicros: event.fictionInstantMicros,
          },
          openedByEventId: event.eventId,
          visibility: "private",
        };
      }
      return true;
    }
    case "GroupRestConsentRecorded": {
      const payload = event.payload as EventPayloadByType["GroupRestConsentRecorded"];
      const pending = state.pendingInputs[payload.pendingInputId];
      if (pending?.kind !== "groupRestConsent"
        || pending.rootActionId !== event.rootActionId
        || pending.controllerCharacterId !== payload.invitedCharacterId) {
        throw new TypeError("group rest answer does not match an invitation");
      }
      const expectedRemaining = Object.values(state.pendingInputs)
        .filter((entry) => entry.kind === "groupRestConsent"
          && entry.rootActionId === event.rootActionId
          && entry.pendingInputId !== payload.pendingInputId)
        .map(({ pendingInputId }) => pendingInputId)
        .sort();
      if (JSON.stringify(expectedRemaining) !== JSON.stringify(payload.remainingPendingInputIds)) {
        throw new TypeError("group rest remaining invitation set changed");
      }
      delete state.pendingInputs[payload.pendingInputId];
      return true;
    }
    case "ActivityStarted": {
      const payload = event.payload as EventPayloadByType["ActivityStarted"];
      if (runtime.activities[payload.activityId] !== undefined) throw new TypeError("activity already exists");
      if (isRecord(payload.completion) && payload.completion.kind === "actorPlan") {
        const planId = payload.completion.planId;
        const plan = isNonEmptyString(planId) ? runtime.npcPlans[planId] : undefined;
        const activity = isRecord(plan?.activity) ? plan.activity : undefined;
        if (
          plan?.npcId !== payload.characterId
          || activity?.activityId !== payload.activityId
          || activity.activityKind !== payload.activityKind
          || activity.intendedDurationMicros !== payload.intendedDurationMicros
        ) throw new TypeError("actor plan activity binding mismatch");
      }
      runtime.activities[payload.activityId] = {
        ...structuredClone(payload),
        status: "active",
        startedAtFictionMicros: event.fictionInstantMicros,
      };
      return true;
    }
    case "ActivityInterrupted": {
      const payload = event.payload as EventPayloadByType["ActivityInterrupted"];
      const activity = runtime.activities[payload.activityId];
      if (activity?.status !== "active") throw new TypeError("activity is not active");
      activity.status = "interrupted";
      activity.interruptionCause = structuredClone(payload.cause);
      return true;
    }
    case "ActivityCompleted": {
      const payload = event.payload as EventPayloadByType["ActivityCompleted"];
      const activity = runtime.activities[payload.activityId];
      if (activity?.status !== "active") throw new TypeError("activity is not active");
      activity.status = "completed";
      return true;
    }
    case "RestCompleted": {
      const payload = event.payload as EventPayloadByType["RestCompleted"];
      if (runtime.activities[payload.activityId]?.status !== "completed"
        || state.entities[payload.characterId] === undefined) {
        throw new TypeError("completed rest activity or character is unavailable");
      }
      state.entities[payload.characterId] = structuredClone(payload.resultingCharacter);
      if (payload.continuationId !== null) {
        if (!(payload.continuationId in state.internalContinuations)) {
          throw new TypeError("rest randomness continuation does not exist");
        }
        delete state.internalContinuations[payload.continuationId];
      }
      return true;
    }
    case "DefinitionRegistered": {
      const payload = event.payload as EventPayloadByType["DefinitionRegistered"];
      const definitionId = payload.definition.definitionId;
      if (!isNonEmptyString(definitionId)
        || definitionId in runtime.definitions
        || (payload.definition.definitionKind === NPC_MECHANICAL_TEMPLATE_KIND
          && !isNpcMechanicalTemplateDefinition(payload.definition))
        || (payload.definition.definitionKind === NPC_MECHANICAL_ITEM_KIND
          && !isNpcMechanicalItemDefinition(payload.definition))) {
        throw new TypeError("definition already registered or malformed");
      }
      runtime.definitions[definitionId] = isDefinitionRegisteredAbilityPayload(payload)
        ? registeredAbilityRecord(payload)
        : structuredClone(payload.definition);
      if (payload.definition.definitionKind === "location") {
        const content = payload.definition.content;
        // A generic location definition can remain lore-only.  A compound
        // ActionPlan materializes a traversable scene only when it freezes the
        // explicit sceneId/name pair before any movement consequence.
        if (isRecord(content) && isNonEmptyString(content.sceneId) && isNonEmptyString(content.name)) {
          const current = state.scenes[content.sceneId];
          if (current !== undefined && current.name !== content.name) {
            throw new TypeError("location definition conflicts with an existing scene");
          }
          state.scenes[content.sceneId] ??= { id: content.sceneId, name: content.name };
        }
      }
      if (payload.definition.definitionKind === "faction") {
        const content = payload.definition.content;
        if (
          !isRecord(content)
          || !isNonEmptyString(content.factionId)
          || !isNonEmptyString(content.name)
          || !isNonEmptyString(content.goal)
          || !strings(content.memberRefs)
          || !strings(content.resourceRefs)
          || content.memberRefs.some((memberId) =>
            state.entities[memberId]?.kind !== "npc"
            || state.entities[memberId]?.tenureStatus !== "active")
          || content.factionId in runtime.factions
          || !isNonEmptyString(payload.definition.visibilityPolicyRef)
        ) throw new TypeError("faction definition is not canonical");
        runtime.factions[content.factionId] = {
          factionId: content.factionId,
          definitionRef: definitionId,
          name: content.name,
          goal: content.goal,
          memberRefs: [...content.memberRefs].sort(),
          resourceRefs: [...content.resourceRefs].sort(),
          visibilityPolicyId: payload.definition.visibilityPolicyRef,
        };
      }
      return true;
    }
    case "HitPointsChanged": {
      const payload = event.payload as EventPayloadByType["HitPointsChanged"];
      const hitPoints = state.entities[payload.characterId]?.hitPoints;
      if (hitPoints === undefined || hitPoints.current !== payload.before || hitPoints.maximum !== payload.maximum) throw new TypeError("hit points mismatch");
      hitPoints.current = payload.after;
      const combatEntity = state.combatRuntime.entities[payload.characterId];
      if (combatEntity !== undefined) {
        if (!isRecord(combatEntity.hitPoints)
          || Number(combatEntity.hitPoints.current) !== payload.before
          || Number(combatEntity.hitPoints.maximum) !== payload.maximum) {
          throw new TypeError("combat hit points cache mismatch");
        }
        combatEntity.hitPoints.current = String(payload.after);
        if (payload.after === 0) combatEntity.lifeState = "unconscious";
      }
      return true;
    }
    case "CreatureDied": {
      const payload = event.payload as EventPayloadByType["CreatureDied"];
      const entity = state.entities[payload.characterId];
      if (entity?.hitPoints?.current !== 0) throw new TypeError("creature is not at zero hit points");
      endCharacterTenure(state, payload.characterId, "dead", "characterDied");
      return true;
    }
    case "CanonicalFactDeclared": {
      const payload = event.payload as EventPayloadByType["CanonicalFactDeclared"];
      if (payload.fact.id in state.canonicalFacts) throw new TypeError("fact already exists");
      state.canonicalFacts[payload.fact.id] = {
        ...structuredClone(payload.fact),
        branchId: event.branchId,
        validFromEventSeq: event.eventSeq,
      };
      return true;
    }
    case "SensoryEvidenceAcquired": {
      const payload = event.payload as EventPayloadByType["SensoryEvidenceAcquired"];
      const fact = state.canonicalFacts[payload.factId];
      if (fact === undefined) throw new TypeError("fact unavailable");
      setKnowledge(
        state,
        event,
        payload.characterId,
        payload.factId,
        "sensoryEvidence",
        payload.publicEvidence,
        [payload.factId],
        null,
        fact.visibilityPolicyId === "visibility:public" ? "publiclyObservable" : "private",
      );
      return true;
    }
    case "SourceClaimCreated": {
      const payload = event.payload as EventPayloadByType["SourceClaimCreated"];
      runtime.sourceClaims[payload.claimId] = structuredClone(payload);
      setKnowledge(state, event, payload.speakerId, payload.claimId, "sourceClaim", payload.semanticContent, [payload.claimId]);
      return true;
    }
    case "CharacterInferenceFormed": {
      const payload = event.payload as EventPayloadByType["CharacterInferenceFormed"];
      setKnowledge(state, event, payload.characterId, payload.inferenceId, "characterInference", payload.conclusion, payload.evidenceRefs);
      return true;
    }
    case "RelationshipChanged": {
      const payload = event.payload as EventPayloadByType["RelationshipChanged"];
      runtime.relationships[payload.relationshipId] = { relationshipId: payload.relationshipId, subjectIds: [...payload.subjectIds], value: payload.change, visibility: "participants", basisFactIds: [...payload.basisFactIds] };
      return true;
    }
    case "RelationshipEstablished": {
      const payload = event.payload as EventPayloadByType["RelationshipEstablished"];
      const authorization = consumedInheritanceAuthorization(
        state,
        payload.sourceFactId,
        payload.authorizationId,
        "relationship",
        payload.relationshipId,
      );
      const source = runtime.relationships[payload.sourceRelationshipId];
      if (authorization === undefined
        || source === undefined
        || payload.relationshipId in runtime.relationships
        || !payload.subjectIds.includes(String(authorization.targetCharacterId))
        || payload.subjectIds.some((subjectId) => !(subjectId in state.entities))) {
        throw new TypeError("inherited relationship is unavailable");
      }
      runtime.relationships[payload.relationshipId] = {
        relationshipId: payload.relationshipId,
        sourceRelationshipId: payload.sourceRelationshipId,
        subjectIds: [...payload.subjectIds],
        value: payload.value,
        visibility: "participants",
        basisFactIds: [...payload.basisFactIds],
        sourceFactId: payload.sourceFactId,
        authorizationId: payload.authorizationId,
      };
      return true;
    }
    case "PromiseMade": {
      const payload = event.payload as EventPayloadByType["PromiseMade"];
      runtime.promises[payload.promiseId] = { ...structuredClone(payload), status: "active" };
      return true;
    }
    case "PromiseAssumed": {
      const payload = event.payload as EventPayloadByType["PromiseAssumed"];
      const authorization = consumedInheritanceAuthorization(
        state,
        payload.sourceFactId,
        payload.authorizationId,
        "promise",
        payload.promiseId,
      );
      const source = runtime.promises[payload.sourcePromiseId];
      if (authorization === undefined
        || source?.promisorId !== authorization.subjectCharacterId
        || payload.promisorId !== authorization.targetCharacterId
        || source.promiseeId !== payload.promiseeId
        || source.content !== payload.content
        || source.condition !== payload.condition
        || payload.promiseId in runtime.promises) {
        throw new TypeError("inherited promise is unavailable");
      }
      runtime.promises[payload.promiseId] = {
        ...structuredClone(payload),
        status: "active",
      };
      return true;
    }
    case "DebtIncurred": {
      const payload = event.payload as EventPayloadByType["DebtIncurred"];
      if (payload.debtId in runtime.debts
        || !(payload.debtorId in state.entities)
        || !(payload.creditorId in state.entities)
        || payload.basisFactIds.some((factId) => !(factId in state.canonicalFacts))) {
        throw new TypeError("debt references are unavailable");
      }
      runtime.debts[payload.debtId] = { ...structuredClone(payload), status: "active" };
      return true;
    }
    case "DebtAssumed": {
      const payload = event.payload as EventPayloadByType["DebtAssumed"];
      const authorization = consumedInheritanceAuthorization(
        state,
        payload.sourceFactId,
        payload.authorizationId,
        "debt",
        payload.debtId,
      );
      const source = runtime.debts[payload.sourceDebtId];
      if (authorization === undefined
        || source?.debtorId !== authorization.subjectCharacterId
        || payload.debtorId !== authorization.targetCharacterId
        || source.creditorId !== payload.creditorId
        || source.obligation !== payload.obligation
        || source.condition !== payload.condition
        || payload.debtId in runtime.debts) {
        throw new TypeError("inherited debt is unavailable");
      }
      runtime.debts[payload.debtId] = {
        ...structuredClone(payload),
        status: "active",
      };
      return true;
    }
    case "NpcPlanFormed": {
      const payload = event.payload as EventPayloadByType["NpcPlanFormed"];
      if (payload.planId in runtime.npcPlans) throw new TypeError("NPC plan already exists");
      const npc = state.entities[payload.npcId];
      if (!actorPlanNpcIsAvailable(npc)) {
        throw new TypeError("NPC plan actor is unavailable");
      }
      if (payload.knowledgeRefs.some((knowledgeRef) =>
        !(knowledgeRef in (state.knowledge[payload.npcId] ?? {})))) {
        throw new TypeError("NPC plan cites unavailable knowledge");
      }
      if ("actorKind" in payload) {
        const chapter = runtime.chapters[payload.chapterId];
        if (
          chapter?.status !== "active"
          || !isProfileRef(chapter.moduleRef)
          || chapter.moduleRef.profileId !== payload.moduleRef.profileId
          || chapter.moduleRef.profileHash !== payload.moduleRef.profileHash
          || payload.trace.factRef in state.canonicalFacts
          || payload.premiseRefs.some((reference) =>
            !actorPlanPremiseIsAvailable(state, payload.npcId, reference))
        ) throw new TypeError("ActorPlan version pin or trace template is unavailable");
      }
      runtime.npcPlans[payload.planId] = {
        ...structuredClone(payload),
        formedAtEventId: event.eventId,
      };
      return true;
    }
    case "NpcActionCommitted": {
      const payload = event.payload as EventPayloadByType["NpcActionCommitted"];
      const plan = runtime.npcPlans[payload.planId];
      const activity = isRecord(plan?.activity) && isNonEmptyString(plan.activity.activityId)
        ? runtime.activities[plan.activity.activityId]
        : undefined;
      if (
        plan?.actorKind !== "npc"
        || plan.npcId !== payload.npcId
        || plan.status !== "scheduled"
        || plan.nextStep !== payload.nextStep
        || (!(payload.targetRef in state.entities) && !(payload.targetRef in state.scenes))
        || !isRecord(plan.trace)
        || plan.trace.factRef !== payload.traceFactRef
        || activity?.status !== "active"
        || !isRecord(activity.completion)
        || activity.completion.kind !== "actorPlan"
        || activity.completion.planId !== payload.planId
      ) throw new TypeError("due ActorPlan execution binding mismatch");
      plan.status = "resolved";
      plan.resolution = {
        decision: payload.decision,
        causedByRootActionId: payload.causedByRootActionId,
        committedAtEventId: event.eventId,
      };
      return true;
    }
    case "NpcPlanCancelled": {
      const payload = event.payload as EventPayloadByType["NpcPlanCancelled"];
      const plan = runtime.npcPlans[payload.planId];
      const activity = isRecord(plan?.activity) && isNonEmptyString(plan.activity.activityId)
        ? runtime.activities[plan.activity.activityId]
        : undefined;
      if (
        plan?.actorKind !== "npc"
        || plan.npcId !== payload.npcId
        || plan.status !== "scheduled"
        || plan.revision !== payload.priorRevision
        || activity?.status !== "active"
      ) throw new TypeError("due ActorPlan cancellation binding mismatch");
      plan.status = "cancelled";
      plan.resolution = {
        decision: "cancel",
        reason: payload.reason,
        causedByRootActionId: payload.causedByRootActionId,
        committedAtEventId: event.eventId,
      };
      const factionPlan = runtime.factionPlans[payload.planId];
      if (factionPlan !== undefined) {
        if (
          factionPlan.actingNpcId !== payload.npcId
          || factionPlan.status !== "scheduled"
          || factionPlan.revision !== payload.priorRevision
        ) throw new TypeError("FactionPlan cancellation binding mismatch");
        factionPlan.status = "cancelled";
        factionPlan.resolution = structuredClone(plan.resolution);
      }
      return true;
    }
    case "NpcPlanRevised": {
      const payload = event.payload as EventPayloadByType["NpcPlanRevised"];
      const plan = runtime.npcPlans[payload.planId];
      const activity = isRecord(plan?.activity) && isNonEmptyString(plan.activity.activityId)
        ? runtime.activities[plan.activity.activityId]
        : undefined;
      if (
        plan?.actorKind !== "npc"
        || plan.npcId !== payload.npcId
        || plan.status !== "scheduled"
        || plan.revision !== payload.priorRevision
        || activity?.status !== "active"
        || payload.trace.factRef in state.canonicalFacts
        || payload.premiseRefs.some((reference) =>
          !actorPlanPremiseIsAvailable(state, payload.npcId, reference))
      ) throw new TypeError("due ActorPlan revision binding mismatch");
      Object.assign(plan, {
        revision: payload.revision,
        premiseRefs: [...payload.premiseRefs],
        nextStep: payload.nextStep,
        nextAction: payload.nextStep,
        resourceRefs: [...payload.resourceRefs],
        due: structuredClone(payload.due),
        trigger: structuredClone(payload.trigger),
        trace: structuredClone(payload.trace),
        alternateTarget: structuredClone(payload.alternateTarget),
        revisedAtEventId: event.eventId,
        lastRevision: {
          decision: payload.decision,
          reason: payload.reason,
          causedByRootActionId: payload.causedByRootActionId,
        },
      });
      const factionPlan = runtime.factionPlans[payload.planId];
      if (factionPlan !== undefined) {
        if (
          factionPlan.actingNpcId !== payload.npcId
          || factionPlan.status !== "scheduled"
          || factionPlan.revision !== payload.priorRevision
        ) throw new TypeError("FactionPlan revision binding mismatch");
        Object.assign(factionPlan, {
          revision: payload.revision,
          premiseRefs: [...payload.premiseRefs],
          resourceRefs: [...payload.resourceRefs],
          revisedAtEventId: event.eventId,
          lastRevision: {
            decision: payload.decision,
            reason: payload.reason,
            causedByRootActionId: payload.causedByRootActionId,
          },
        });
      }
      return true;
    }
    case "FactionPlanFormed": {
      const payload = event.payload as EventPayloadByType["FactionPlanFormed"];
      const faction = runtime.factions[payload.factionId];
      const npcPlan = runtime.npcPlans[payload.planId];
      const memberRefs = Array.isArray(faction?.memberRefs) ? faction.memberRefs : [];
      const factionResources = Array.isArray(faction?.resourceRefs) ? faction.resourceRefs : [];
      if (
        runtime.factionPlans[payload.planId] !== undefined
        || faction === undefined
        || !memberRefs.includes(payload.actingNpcId)
        || npcPlan?.npcId !== payload.actingNpcId
        || npcPlan.status !== "scheduled"
        || !payload.resourceRefs.includes(payload.factionId)
        || factionResources.some((resourceRef) => !payload.resourceRefs.includes(resourceRef))
        || payload.premiseRefs.some((reference) =>
          !actorPlanPremiseIsAvailable(state, payload.actingNpcId, reference))
      ) throw new TypeError("FactionPlan formation binding mismatch");
      runtime.factionPlans[payload.planId] = {
        ...structuredClone(payload),
        formedAtEventId: event.eventId,
      };
      return true;
    }
    case "FactionActionCommitted": {
      const payload = event.payload as EventPayloadByType["FactionActionCommitted"];
      const plan = runtime.npcPlans[payload.planId];
      const factionPlan = runtime.factionPlans[payload.planId];
      const activity = isRecord(plan?.activity) && isNonEmptyString(plan.activity.activityId)
        ? runtime.activities[plan.activity.activityId]
        : undefined;
      if (
        plan?.npcId !== payload.actingNpcId
        || plan.status !== "scheduled"
        || plan.nextStep !== payload.nextStep
        || !isRecord(plan.trace)
        || plan.trace.factRef !== payload.traceFactRef
        || factionPlan?.factionId !== payload.factionId
        || factionPlan.actingNpcId !== payload.actingNpcId
        || factionPlan.status !== "scheduled"
        || JSON.stringify(factionPlan.resourceRefs) !== JSON.stringify(payload.resourceRefs)
        || (!(payload.targetRef in state.entities) && !(payload.targetRef in state.scenes))
        || activity?.status !== "active"
      ) throw new TypeError("due FactionPlan execution binding mismatch");
      const resolution = {
        decision: payload.decision,
        causedByRootActionId: payload.causedByRootActionId,
        committedAtEventId: event.eventId,
      };
      plan.status = "resolved";
      plan.resolution = structuredClone(resolution);
      factionPlan.status = "resolved";
      factionPlan.resolution = structuredClone(resolution);
      return true;
    }
    case "FactionPlanAdvanced": {
      const payload = event.payload as EventPayloadByType["FactionPlanAdvanced"];
      const faction = runtime.factions[payload.factionId];
      const npcPlan = runtime.npcPlans[payload.planId];
      const factionMemberRefs = strings(faction?.memberRefs) ? faction.memberRefs : [];
      const planResourceRefs = strings(npcPlan?.resourceRefs) ? npcPlan.resourceRefs : [];
      if (
        runtime.factionPlans[payload.planId] !== undefined
        || faction === undefined
        || (!factionMemberRefs.includes(payload.actingNpcId)
          && !planResourceRefs.includes(payload.factionId))
        || npcPlan?.npcId !== payload.actingNpcId
        || payload.causeFactIds.some((factId) =>
          !(factId in (state.knowledge[payload.actingNpcId] ?? {})))
      ) throw new TypeError("faction plan advance precondition mismatch");
      runtime.factionPlans[payload.planId] = { ...structuredClone(payload), status: "advanced", advancedAtEventId: event.eventId };
      return true;
    }
    case "SceneQuestionOpened": {
      const payload = event.payload as EventPayloadByType["SceneQuestionOpened"];
      if (payload.sceneQuestionId in runtime.sceneQuestions) {
        throw new TypeError("scene question already exists");
      }
      runtime.sceneQuestions[payload.sceneQuestionId] = { ...structuredClone(payload), status: "open" };
      return true;
    }
    case "MeaningfulFailureCommitted": {
      const payload = event.payload as EventPayloadByType["MeaningfulFailureCommitted"];
      runtime.meaningfulFailures[payload.goalId] = { ...structuredClone(payload), committedAtEventId: event.eventId };
      return true;
    }
    case "RetryConditionChanged": {
      const payload = event.payload as EventPayloadByType["RetryConditionChanged"];
      runtime.retryChanges[payload.goalId] = structuredClone(payload);
      return true;
    }
    case "SceneQuestionAnswered": {
      const payload = event.payload as EventPayloadByType["SceneQuestionAnswered"];
      const question = runtime.sceneQuestions[payload.sceneQuestionId];
      if (question?.status !== "open") throw new TypeError("scene question unavailable");
      question.status = "answered";
      question.answerFactIds = [...payload.answerFactIds];
      return true;
    }
    case "EndingCandidateRaised": {
      const payload = event.payload as EventPayloadByType["EndingCandidateRaised"];
      runtime.endingCandidates[payload.endingCandidateId] = structuredClone(payload);
      return true;
    }
    case "StoryConcluded": {
      const payload = event.payload as EventPayloadByType["StoryConcluded"];
      runtime.stories[payload.storyId] = { ...structuredClone(payload), status: "concluded" };
      return true;
    }
    case "EpilogueChoiceRecorded": {
      const payload = event.payload as EventPayloadByType["EpilogueChoiceRecorded"];
      runtime.epilogues[`${payload.storyId}:${payload.characterId}`] = structuredClone(payload);
      return true;
    }
    case "SequelStarted": {
      const payload = event.payload as EventPayloadByType["SequelStarted"];
      runtime.stories[payload.sequelStoryId] = { ...structuredClone(payload), status: "active" };
      runtime.chapters[payload.chapterId] = {
        chapterId: payload.chapterId,
        status: "active",
        sceneQuestion: payload.sceneQuestion,
        ...(runtime.campaign !== null && isProfileRef(runtime.campaign.moduleRef)
          ? { moduleRef: structuredClone(runtime.campaign.moduleRef) }
          : {}),
      };
      return true;
    }
    case "ExperienceAwarded": {
      const payload = event.payload as EventPayloadByType["ExperienceAwarded"];
      const character = state.entities[payload.characterId];
      const priorTotal = character?.experiencePoints ?? 0;
      if (
        runtime.campaign?.campaignId !== payload.campaignId
        || runtime.campaign.advancementProfile !== "srdXp2014"
        || character?.kind !== "player"
        || !Number.isSafeInteger(priorTotal)
        || !Number.isSafeInteger(payload.total)
        || priorTotal + payload.amount !== payload.total
      ) {
        throw new TypeError("experience award is not legal for the campaign profile");
      }
      character.experiencePoints = payload.total;
      return true;
    }
    case "AdvancementAvailable": {
      const payload = event.payload as EventPayloadByType["AdvancementAvailable"];
      state.pendingInputs[payload.pendingInputId] = {
        pendingInputId: payload.pendingInputId,
        kind: "advancementChoice",
        rootActionId: event.rootActionId,
        controllerCharacterId: payload.characterId,
        question: runtime.campaign?.advancementProfile === "srdXp2014"
          ? "选择本次经验值成长。"
          : "选择本次里程碑成长。",
        campaignId: payload.campaignId,
        sourceFactIds: [...payload.sourceFactIds],
        options: structuredClone(payload.options),
        openedByEventId: event.eventId,
        visibility: "private",
      };
      return true;
    }
    case "CharacterAdvanced": {
      const payload = event.payload as EventPayloadByType["CharacterAdvanced"];
      const entity = state.entities[payload.characterId];
      if (state.pendingInputs[payload.pendingInputId]?.kind !== "advancementChoice"
        || entity === undefined
        || payload.resultingCharacter.id !== entity.id
        || payload.resultingCharacter.entityOrdinal !== entity.entityOrdinal
        || payload.resultingCharacter.tenureStatus !== "active"
        || Number(payload.resultingCharacter.level) !== Number(entity.level) + 1) {
        throw new TypeError("advancement pending unavailable");
      }
      state.entities[payload.characterId] = structuredClone(payload.resultingCharacter);
      delete state.pendingInputs[payload.pendingInputId];
      return true;
    }
    case "ChapterConcluded": {
      const payload = event.payload as EventPayloadByType["ChapterConcluded"];
      const chapter = runtime.chapters[payload.chapterId];
      if (chapter === undefined) throw new TypeError("chapter unavailable");
      chapter.status = "concluded";
      chapter.reason = payload.reason;
      return true;
    }
    case "ChapterContinuityRecorded": {
      const payload = event.payload as EventPayloadByType["ChapterContinuityRecorded"];
      if (!isCampaignContinuityManifest(payload.manifest)) {
        throw new TypeError("chapter continuity manifest is malformed");
      }
      const chapter = runtime.chapters[payload.fromChapterId];
      const expected = campaignContinuityManifestForSchema(
        state,
        payload.manifest.activityTransitions,
        payload.manifest.schema,
      );
      if (runtime.campaign?.campaignId !== payload.campaignId
        || chapter?.status !== "concluded"
        || payload.toChapterId in runtime.chapters
        || !continuityManifestsEqual(payload.manifest, expected)) {
        throw new TypeError("chapter continuity manifest does not match authoritative state");
      }
      chapter.continuityManifestHash = payload.manifest.manifestHash;
      chapter.nextChapterId = payload.toChapterId;
      return true;
    }
    case "ModuleVersionMigrated": {
      const payload = event.payload as EventPayloadByType["ModuleVersionMigrated"];
      const campaignModuleRef = runtime.campaign?.moduleRef;
      if (
        runtime.campaign?.campaignId !== payload.campaignId
        || !isProfileRef(campaignModuleRef)
        || campaignModuleRef.profileId !== payload.fromModuleRef.profileId
        || campaignModuleRef.profileHash !== payload.fromModuleRef.profileHash
        || (payload.fromModuleRef.profileId === payload.toModuleRef.profileId
          && payload.fromModuleRef.profileHash === payload.toModuleRef.profileHash)
      ) throw new TypeError("module migration does not match the current Campaign binding");
      runtime.campaign.moduleRef = structuredClone(payload.toModuleRef);
      return true;
    }
    case "ChapterStarted": {
      const payload = event.payload as EventPayloadByType["ChapterStarted"];
      const campaignModuleRef = runtime.campaign?.moduleRef;
      if (
        runtime.campaign?.campaignId !== payload.campaignId
        || !isProfileRef(campaignModuleRef)
        || campaignModuleRef.profileId !== payload.moduleRef.profileId
        || campaignModuleRef.profileHash !== payload.moduleRef.profileHash
        || payload.chapterId in runtime.chapters
      ) throw new TypeError("chapter Module binding does not match the current Campaign");
      runtime.chapters[payload.chapterId] = { ...structuredClone(payload), status: "active" };
      if (runtime.campaign !== null) runtime.campaign.currentChapterId = payload.chapterId;
      return true;
    }
    case "InheritanceSourceEstablished": {
      const payload = event.payload as EventPayloadByType["InheritanceSourceEstablished"];
      if (payload.factId in runtime.inheritanceSources || payload.factId in state.canonicalFacts) {
        throw new TypeError("inheritance source already exists");
      }
      const authorizations = Array.isArray(payload.source.authorizations)
        ? payload.source.authorizations
        : [];
      if (authorizations.some((authorization) => !isRecord(authorization)
        || authorization.subjectCharacterId !== payload.predecessorCharacterId
        || authorization.targetCharacterId !== payload.successorCharacterId)) {
        throw new TypeError("inheritance authorization parties do not match the source");
      }
      runtime.inheritanceSources[payload.factId] = {
        ...structuredClone(payload),
        consumedAuthorizationIds: [],
      };
      state.canonicalFacts[payload.factId] = {
        id: payload.factId,
        kind: "inheritanceSource",
        subjectRefs: [payload.predecessorCharacterId, payload.successorCharacterId].sort(),
        value: {
          kind: payload.source.kind,
          publicClause: payload.source.publicClause,
        },
        visibilityPolicyId: "visibility:channel-participants",
        source: "characterAction",
        branchId: event.branchId,
        validFromEventSeq: event.eventSeq,
        causalParentIds: [],
      };
      return true;
    }
    case "InheritanceTransferred": {
      const payload = event.payload as EventPayloadByType["InheritanceTransferred"];
      const source = runtime.inheritanceSources[payload.sourceFactId];
      const sourceBody = isRecord(source?.source) ? source.source : undefined;
      const authorizations = Array.isArray(sourceBody?.authorizations)
        ? sourceBody.authorizations
        : [];
      const authorization = authorizations.find((candidate) =>
        isRecord(candidate) && candidate.authorizationId === payload.authorizationId);
      const consumed = Array.isArray(source?.consumedAuthorizationIds)
        && source.consumedAuthorizationIds.every(isNonEmptyString)
        ? source.consumedAuthorizationIds
        : [];
      if (source?.predecessorCharacterId !== payload.predecessorCharacterId
        || source?.successorCharacterId !== payload.successorCharacterId
        || !isRecord(authorization)
        || [
          "authorizationId",
          "kind",
          "scope",
          "sourceRef",
          "subjectCharacterId",
          "targetCharacterId",
          "targetRef",
        ].some((key) => authorization[key] !== payload[key as keyof typeof payload])
        || consumed.includes(payload.authorizationId)) {
        throw new TypeError("inheritance authorization is unavailable or consumed");
      }
      source.consumedAuthorizationIds = [...consumed, payload.authorizationId].sort();
      return true;
    }
    default:
      return false;
  }
}
