import { isNpcMaterializedPayload, applyNpcMaterializedEvent } from "./npc-materialization";
import { isStoryKnowledgeAdmissionMetadata, storyKnowledgeAdmissionIssue } from "./story-facts-admission";
import { actionActivityForRoot } from "./activity-progress";
import { applyPromiseLifecycleEvent, recordPromiseEvidence, promiseTermsConform, promiseJudgmentConform, promiseChangeConform } from "./promise-lifecycle";
import { applyNpcWorkEvent, recordNpcWorkActivityOutcome, npcWorkDecisionConform } from "./npc-work";
import { frozenPlayerChoiceIssue, activityCompletionInputIssue } from "./world-interactions";
import { applyDynamicLocation, dynamicMaterializationIssue, passageActivityBinding } from "./dynamic-locations";
import { atomicContinuationCanResume } from "./atomic-world-input";
import { frozenChoiceForRoot, frozenChoiceReadSet, frozenChoiceReadSetMatches, frozenChoicePublicBindingMatches,
  isFrozenPlayerChoiceRecord, isFrozenPlayerChoiceContinuationInput, selectedFrozenContinuation } from "./frozen-player-choice";
import { isWorldFactPointer, worldFactDefinition, worldFactPointer, worldFactRef, authoredWorldFactConform } from "./world-facts";
import { legacySocialThread } from "./social-model";
import { publicExpressionConform } from "./public-expression";
import { verifySocialSettlement, socialConversationRecord, hasCommittedSocialExpression } from "./social-interaction";
import { socialCommitmentFromPayload, socialCommitmentParticipants } from "./social-commitments";
import { heldKnowledgeRecord, knowledgeLayerCanBeShared } from "./knowledge-records";
import { authorityRevisionOrHash, authoritySpatialRefVisibleTo } from "./authority-bindings";
import { emptyVNextItemAuthority, isItemUniquenessBoundPayload, isItemIdentifiedPayload, uniqueItemEntryRef } from "./item-authority-vnext";
import { worldInteractionEffectiveCheck } from "./world-interaction-conditions";
import { bindNarrativeMaterialization, committedNarrativeFact, isNarrativeDetailCommittedPayload,
  isNarrativeDetailMaterializedPayload, narrativeDetailRef } from "./narrative-commitments";
import { isAtomicWorldContinuation } from "./atomic-world-input";
import { isConditionImmunities } from "./world-effects";
import { isWorldInteractionRandomnessRequest, worldInteractionDiceEventValid, worldInteractionDiceValid } from "./world-interaction-randomness";
import { isKnowledgeReviewedPayload, validateKnowledgeReviewedEvent } from "./knowledge-review";
import { canonicalSha256 } from "../profiles/canonical";
import {
  ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
  V5_EVENT_SCHEMA_PROFILE,
} from "../profiles/manifests";
import {
  VNEXT_STAGE3_EVENT_SCHEMA_PROFILE,
  VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST,
  worldInteractionProfileEnabled,
} from "../profiles/vnext-world-interaction";
import { causalActionInterpreterEnabled } from "../profiles/causal-action-interpreter";
import { environmentProfileEnabled } from "../profiles/environment";
import { itemSystemProfileEnabled } from "../profiles/item-system";
import { isRuntimeProfileManifest } from "../profiles/registry";
import {
  DYNAMIC_NPC_DEFAULT_SOCIAL_ARCHETYPE_REF,
  socialResolutionProfileEnabled,
} from "../profiles/social-resolution";
import { npcMechanicsProfileEnabled } from "../profiles/npc-mechanics";
import type { ProfileRef, RuntimeProfileManifest, Sha256Ref } from "../profiles/types";
import type {
  AuthoritativeWorldState,
  AuthorityContinuation,
  CanonicalFactRecord,
  CharacterRecord,
  EventEnvelope,
  EventPayloadByType,
  EventType,
  FrozenCheck,
  JsonRecord,
  KnowledgeRecord,
  PublicReceipt,
  RandomnessRequest,
  ScopeProof,
} from "./model";
import {
  capSocialDegree,
  currentSocialTrust,
  isNpcSocialMechanics,
  isSocialRandomnessEventBinding,
  isSocialResolutionPlan,
  isSocialClaimSemantics,
  socialCheckReactionSpeech,
  socialCheckResponseAllowed,
  socialMethodFingerprint,
  socialParticipantsCoPresent,
  socialPositionFingerprint,
  socialResistanceFingerprint,
  socialUtteranceFingerprint,
  socialResolutionPlanMatchesState,
  socialDegreeForMargin,
  dynamicNpcSocialMechanics,
} from "./social-model";
import {
  NPC_MECHANICAL_TEMPLATE_KIND,
} from "./npc-mechanics";
import { isItemDefinitionV1 } from "./items";
import {
  CANONICAL_POSITIVE_INTEGER_PATTERN,
  CANONICAL_SIGNED_INTEGER_PATTERN,
  CANONICAL_UNSIGNED_INTEGER_PATTERN,
  canonicalFactVisibleToCharacter,
  hasExactKeys,
  hashWorldState,
  isAuthoritativeWorldState,
  isCharacterLoadout,
  isNonEmptyString,
  isRecord,
  isSha256,
  hasOnlyKeys,
} from "./validation";
import {
  applyCampaignEvent,
  CAMPAIGN_EVENT_TYPES,
  validateCampaignEventPayload,
} from "./campaign-events";
import {
  applyCombatEvent,
  COMBAT_EVENT_TYPES,
  validateCombatEventPayload,
  validateCombatRandomnessResolution,
} from "./combat-events";
import {
  applyCorrectionEvent,
  correctionEffectsBefore,
  isCanonicalCorrectionStringArray,
  recordCorrectionAudit,
  validateCorrectionEffects,
} from "./correction";
import {
  applyCharacterMechanicsSnapshot,
  applyMultiplayerEvent,
  MULTIPLAYER_EVENT_TYPES,
  validCharacterMechanicsSnapshot,
  validateMultiplayerEventPayload,
} from "./multiplayer-events";
import {
  eventFictionTimelineId,
  recordCausalFrontier,
  recordSpotlightDecision,
} from "./timeline";
import { isCompoundResolutionPlan } from "./compound-model";
import {
  isCausalActionResolutionPlan,
  isCausalProgramFactValue,
  isCausalRandomnessEventBinding,
} from "./causal-model";
import { endCharacterTenure } from "./character-lifecycle";
import { fictionTimelineIdForScene } from "./multiplayer-model";
import {
  applySafetyEvent,
  SAFETY_EVENT_TYPES,
  validateSafetyEventPayload,
} from "./safety";
import {
  applyEnvironmentEvent,
  ENVIRONMENT_EVENT_TYPES,
  validateEnvironmentEventPayload,
} from "./environment";
import {
  atomicWorldInteractionCheckPlan,
  atomicWorldInteractionStepsPlanHash,
  isAtomicWorldInteractionStepsPlan,
  isAtomicWorldInteractionStepsResolvedPayload,
  isSemanticDefinitionRevisedPayload,
  isWorldInteractionFeasibilityRuledPayload,
  isWorldInteractionResolutionPlan,
  isWorldInteractionResolvedPayload,
  type AppliedWorldInteractionEffect,
  worldInteractionPlanHash,
} from "./world-interaction-model";
import {
  materializedSemanticDefinition,
  isSemanticDefinitionMaterializedPayload,
  semanticDefinitionSnapshot,
  type StoredSemanticDefinition,
} from "./semantic-definitions";

const EVENT_KEYS = [
  "branchId",
  "causalParentEventIds",
  "eventHash",
  "eventId",
  "eventSeq",
  "eventType",
  "eventTypeVersion",
  "fictionInstantMicros",
  "fictionTimelineId",
  "parentEventId",
  "payload",
  "payloadHash",
  "previousEventHash",
  "profiles",
  "resolutionId",
  "roomId",
  "rootActionId",
  "runtimeEpochId",
  "schema",
  "scopeProofHash",
  "secrecy",
  "stateHashAfter",
  "stateBeforeHash",
  "visibilityPolicyId",
] as const;

const SOCIAL_SUCCESS_RANK = {
  limitedSuccess: 0,
  fullSuccess: 1,
  strongSuccess: 2,
} as const;

const SOCIAL_REACTIONS = new Set([
  "acknowledge", "decline", "askClarification", "redirect", "silence",
]);

function socialResponseMetadataValid(
  mode: unknown,
  reaction: unknown,
  refs: unknown,
): boolean {
  if (!Array.isArray(refs)
    || refs.length > 4
    || !refs.every(isNonEmptyString)
    || refs.length !== new Set(refs).size) return false;
  if (mode === "reaction") return SOCIAL_REACTIONS.has(String(reaction)) && refs.length === 0;
  if (mode === "sourceBacked" || mode === "commitment") {
    return reaction === null && refs.length >= 1;
  }
  return false;
}

function directSocialThreadDisposition(
  mode: unknown,
  reaction: unknown,
): "active" | "deemphasized" | "dormant" | "closed" | undefined {
  if (mode === "sourceBacked" || mode === "commitment") return "closed";
  if (mode !== "reaction") return undefined;
  if (reaction === "askClarification") return "active";
  if (reaction === "redirect") return "deemphasized";
  if (reaction === "decline") return "closed";
  if (reaction === "acknowledge" || reaction === "silence") return "dormant";
  return undefined;
}

const PROFILED_ENVIRONMENT_EVENT_TYPES = new Set<EventType>([
  "EnvironmentFeatureMaterialized",
  "EnvironmentStuntRefused",
  "EnvironmentHazardTriggered",
  "EnvironmentAreaTargetResolved",
  "EnvironmentAreaFeatureDamaged",
]);

function eventRequiresEnvironmentProfile(eventType: EventType, payload: unknown): boolean {
  return PROFILED_ENVIRONMENT_EVENT_TYPES.has(eventType)
    || (eventType === "EnvironmentFeatureStateChanged"
      && isRecord(payload)
      && (payload.intent === "applyStunt"
        || payload.intent === "triggerHazard"
        || payload.intent === "resolveHazard"));
}

function payloadEnvironmentProfile(
  eventType: EventType,
  payload: unknown,
): ProfileRef | undefined {
  if (eventType !== "EnvironmentFeatureMaterialized"
    && eventType !== "EnvironmentHazardTriggered") return undefined;
  if (!isRecord(payload)
    || !isRecord(payload.environmentProfile)
    || !hasExactKeys(payload.environmentProfile, ["profileHash", "profileId"])
    || !isNonEmptyString(payload.environmentProfile.profileId)
    || !isSha256(payload.environmentProfile.profileHash)) return undefined;
  return payload.environmentProfile as ProfileRef;
}

function envelopeEnvironmentProfileEnabled(
  profiles: JsonRecord,
  expected?: ProfileRef,
): boolean {
  return Array.isArray(profiles.extensions)
    && profiles.extensions.every((extension): extension is ProfileRef =>
      isRecord(extension)
      && hasExactKeys(extension, ["profileHash", "profileId"])
      && isNonEmptyString(extension.profileId)
      && isSha256(extension.profileHash))
    && environmentProfileEnabled(profiles.extensions, expected);
}

function eventRequiresCausalActionProfile(eventType: EventType, payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (eventType === "EnvironmentFeatureMaterialized") {
    return isNonEmptyString(payload.causalProgramFactRef)
      && isNonEmptyString(payload.causalProgramHash);
  }
  if (eventType === "RandomnessRequested") {
    return isRecord(payload.resolutionPlan)
      && [
        "zhuwei.causal-action-resolution-plan/v4",
        "zhuwei.social-resolution-plan/v1",
      ].includes(String(payload.resolutionPlan.schema));
  }
  return eventType === "ImprovisedActionResolved"
    && isRecord(payload.fact)
    && payload.fact.kind === "causalActionProgram"
    && isCausalProgramFactValue(payload.fact.value);
}

function eventRequiresSocialResolutionProfile(eventType: EventType, payload: unknown): boolean {
  if ([
    "SocialResolutionOffered",
    "SocialResolutionDeclined",
    "SocialDirectResolved",
    "SocialCheckResolved",
    "DynamicEntityMaterialized",
    "NpcMaterialized",
  ].includes(eventType)) return true;
  if (eventType === "ImprovisedActionResolved") {
    return isRecord(payload)
      && isRecord(payload.fact)
      && (payload.fact.kind === "characterPremise"
        || payload.fact.kind === "dynamicEntityKnowledgeGrant"
        || payload.fact.kind === "typedAssertionFact");
  }
  if (eventType === "DefinitionRegistered") {
    return isRecord(payload)
      && isRecord(payload.definition)
      && isRecord(payload.definition.content)
      && payload.definition.content.sourceKind === "characterPremiseOpenBlank";
  }
  return eventType === "RandomnessRequested"
    && isRecord(payload)
    && isRecord(payload.resolutionPlan)
    && payload.resolutionPlan.schema === "zhuwei.social-resolution-plan/v1";
}

function eventRequiresNpcMechanicsProfile(eventType: EventType, payload: unknown): boolean {
  if (eventType === "NpcMaterialized") return true;
  if ([
    "ItemTransferred",
    "NpcGearChanged",
    "NpcMechanicalItemStateChanged",
  ].includes(eventType)) return true;
  if (!isRecord(payload)) return false;
  if (eventType === "DefinitionRegistered") {
    return isRecord(payload.definition)
      && payload.definition.definitionKind === NPC_MECHANICAL_TEMPLATE_KIND;
  }
  return eventType === "EntityMaterialized"
    && isRecord(payload.entity)
    && isNonEmptyString(payload.entity.mechanicalDefinitionRef);
}

function eventRequiresItemSystemProfile(eventType: EventType, payload: unknown): boolean {
  if (eventType === "NpcMaterialized") return true;
  if ([
    "ConditionStateSynchronized",
  "AuthoredMaterializationResolved",
  "InventoryOperationApplied",
  "ItemAssemblyChanged",
    "ItemDefinitionRegistered",
    "ItemMaterialized",
    "ItemAcquired",
    "ItemTransferred",
    "ItemUsed",
  ].includes(eventType)) return true;
  return eventType === "DefinitionRegistered"
    && isRecord(payload)
    && isItemDefinitionV1(payload.definition);
}

function eventRequiresWorldInteractionProfile(eventType: EventType, payload: unknown): boolean {
  return eventType === "NpcMaterialized" || eventType === "FrozenPlayerChoicePrepared" || eventType === "FrozenPlayerChoiceInputRecorded" || eventType === "ActivityCompletionInputRecorded" || eventType === "KnowledgeReviewed" || eventType === "NarrativeDetailCommitted" || eventType === "NarrativeDetailMaterialized"
    || eventType === "ItemUniquenessBound" || eventType === "ItemIdentified"
    || eventType === "AuthoredMaterializationResolved"
    || eventType === "InventoryOperationApplied" || eventType === "ItemAssemblyChanged"
    || eventType === "AtomicWorldInteractionStepsResolved"
    || eventType === "AtomicWorldInteractionSuspended"
    || eventType === "AtomicWorldInteractionResumed"
    || eventType === "SemanticDefinitionRevised"
    || eventType === "SemanticDefinitionMaterialized"
    || eventType === "WorldInteractionResolved"
    || eventType === "WorldInteractionFeasibilityRuled"
    || (eventType === "RandomnessRequested"
      && isRecord(payload)
      && isRecord(payload.resolutionPlan)
      && [
        "zhuwei.world-interaction-resolution-plan/v1",
        "zhuwei.atomic-world-interaction-steps-plan/v1",
      ].includes(String(payload.resolutionPlan.schema)));
}

function envelopeCausalActionProfileEnabled(profiles: JsonRecord): boolean {
  return Array.isArray(profiles.extensions)
    && profiles.extensions.every((extension): extension is ProfileRef =>
      isRecord(extension)
      && hasExactKeys(extension, ["profileHash", "profileId"])
      && isNonEmptyString(extension.profileId)
      && isSha256(extension.profileHash))
    && causalActionInterpreterEnabled(profiles.extensions);
}

function envelopeSocialResolutionProfileEnabled(profiles: JsonRecord): boolean {
  return Array.isArray(profiles.extensions)
    && profiles.extensions.every((extension): extension is ProfileRef =>
      isRecord(extension)
      && hasExactKeys(extension, ["profileHash", "profileId"])
      && isNonEmptyString(extension.profileId)
      && isSha256(extension.profileHash))
    && socialResolutionProfileEnabled(profiles.extensions);
}

function envelopeNpcMechanicsProfileEnabled(profiles: JsonRecord): boolean {
  return Array.isArray(profiles.extensions)
    && profiles.extensions.every((extension): extension is ProfileRef =>
      isRecord(extension)
      && hasExactKeys(extension, ["profileHash", "profileId"])
      && isNonEmptyString(extension.profileId)
      && isSha256(extension.profileHash))
    && npcMechanicsProfileEnabled(profiles.extensions);
}

function envelopeItemSystemProfileEnabled(profiles: JsonRecord): boolean {
  return Array.isArray(profiles.extensions)
    && profiles.extensions.every((extension): extension is ProfileRef =>
      isRecord(extension)
      && hasExactKeys(extension, ["profileHash", "profileId"])
      && isNonEmptyString(extension.profileId)
      && isSha256(extension.profileHash))
    && itemSystemProfileEnabled(profiles.extensions);
}

function envelopeWorldInteractionProfileEnabled(profiles: JsonRecord): boolean {
  return Array.isArray(profiles.extensions)
    && profiles.extensions.every((extension): extension is ProfileRef =>
      isRecord(extension)
      && hasExactKeys(extension, ["profileHash", "profileId"])
      && isNonEmptyString(extension.profileId)
      && isSha256(extension.profileHash))
    && worldInteractionProfileEnabled(profiles.extensions);
}

function exactProfileRef(value: unknown, expected: ProfileRef): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["profileHash", "profileId"])
    && value.profileId === expected.profileId
    && value.profileHash === expected.profileHash;
}

function knownRuntimeManifestClosureIsExact(profiles: JsonRecord): boolean {
  if (!isRuntimeProfileManifest(profiles)) return false;
  try {
    if (profiles.manifest.profileId === ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST.manifest.profileId) {
      return canonicalSha256(profiles) === canonicalSha256(ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST);
    }
    if (profiles.manifest.profileId === VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST.manifest.profileId) {
      return canonicalSha256(profiles) === canonicalSha256(VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST);
    }
    return false;
  } catch {
    return false;
  }
}

function expectedEventTypeVersion(
  profiles: JsonRecord | RuntimeProfileManifest,
  eventType: EventType,
  payload: unknown,
): "1" | "2" | "3" | "4" | undefined {
  if (exactProfileRef(profiles.eventSchema, V5_EVENT_SCHEMA_PROFILE)) {
    if (eventType === "ItemUsed") return "4";
    return eventType === "ResourceSpent" ? "2" : "1";
  }
  if (exactProfileRef(profiles.eventSchema, VNEXT_STAGE3_EVENT_SCHEMA_PROFILE)) {
    if (eventType === "ItemUsed") return "4";
    return eventType === "ResourceSpent" ? "2" : "1";
  }
  return undefined;
}

const EVENT_TYPES = new Set<EventType>([
  "PromiseTermsEstablished", "PromiseReviewed", "PromiseChanged",
  "NpcWorkProposed", "NpcWorkStarted", "NpcWorkDecision",
  "KnowledgeReviewed",
  "NarrativeDetailCommitted", "NarrativeDetailMaterialized",
  "ItemUniquenessBound", "ItemIdentified",
  "AuthoredMaterializationResolved",
  "InventoryOperationApplied",
  "ItemAssemblyChanged",
  "AtomicWorldInteractionStepsResolved",
  "AtomicWorldInteractionSuspended",
  "AtomicWorldInteractionResumed",
  "SemanticDefinitionRevised",
  "SemanticDefinitionMaterialized",
  "WorldInteractionResolved",
  "WorldInteractionFeasibilityRuled",
  "ImprovisedActionResolved",
  "ClarificationRequested",
  "PlayerChoiceRequested",
  "FrozenPlayerChoicePrepared",
  "FrozenPlayerChoiceInputRecorded",
  "ActivityCompletionInputRecorded",
    "SocialResolutionOffered",
    "SocialResolutionDeclined",
    "SocialDirectResolved",
    "SocialCheckResolved",
    "DynamicEntityMaterialized",
    "NpcMaterialized",
  "PendingInputAnswered",
  "CorrectionApplied",
  "CorrectionBranchOpened",
  "BranchActivated",
  "RandomnessRequested",
  "DiceRolled",
  "HiddenRealityCandidatesFrozen",
  "HiddenRealityMaterialized",
  "ImprovisedCheckResolved",
  "KnowledgeAcquired",
  "KnowledgeShared",
  "CharacterControlTransferred",
  "CharacterRetired",
  "SuccessorIntroduced",
  ...ENVIRONMENT_EVENT_TYPES,
  ...SAFETY_EVENT_TYPES,
  ...MULTIPLAYER_EVENT_TYPES,
  ...CAMPAIGN_EVENT_TYPES,
  ...COMBAT_EVENT_TYPES,
]);

const ZERO_HASH = `sha256:${"0".repeat(64)}` as Sha256Ref;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isCanonicalStringArray(value: unknown): value is string[] {
  return isStringArray(value)
    && new Set(value).size === value.length
    && value.every((entry, index) => index === 0 || value[index - 1] < entry);
}

function isFactSource(value: unknown): value is CanonicalFactRecord["source"] {
  return [
    "moduleAnchor",
    "dynamicMaterialization",
    "observedEvent",
    "mechanicalResolution",
    "characterAction",
    "npcOrFactionAction",
    "correction",
  ].includes(String(value));
}

function isFactDraft(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, [
      "id",
      "kind",
      "source",
      "subjectRefs",
      "value",
      "visibilityPolicyId",
    ])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.kind)
    && isCanonicalStringArray(value.subjectRefs)
    && isNonEmptyString(value.visibilityPolicyId)
    && isFactSource(value.source);
}

function isFrozenCheck(value: unknown): value is FrozenCheck {
  return isRecord(value)
    && hasExactKeys(value, [
      "ability",
      "costs",
      "dc",
      "failureOutcome",
      "goal",
      "kind",
      "method",
      "mode",
      "modifier",
      "risk",
      "skill",
      "successOutcome",
    ])
    && ["ability", "skill", "tool", "savingThrow"].includes(String(value.kind))
    && ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]
      .includes(String(value.ability))
    && (value.skill === null || isNonEmptyString(value.skill))
    && typeof value.dc === "string"
    && CANONICAL_UNSIGNED_INTEGER_PATTERN.test(value.dc)
    && typeof value.modifier === "string"
    && CANONICAL_SIGNED_INTEGER_PATTERN.test(value.modifier)
    && ["normal", "advantage", "disadvantage"].includes(String(value.mode))
    && isNonEmptyString(value.goal)
    && isNonEmptyString(value.method)
    && isNonEmptyString(value.risk)
    && isNonEmptyString(value.successOutcome)
    && isNonEmptyString(value.failureOutcome)
    && isCanonicalStringArray(value.costs);
}

function isRandomnessRequest(value: unknown): value is RandomnessRequest {
  if (!isRecord(value)) return false;
  if (value.purpose === "restHitDice" || value.purpose === "hiddenRealitySelection") {
    if (!hasExactKeys(value, [
      "actorCharacterId",
      "dice",
      "diceExpression",
      "frozenParameters",
      "purpose",
      "purposeKey",
      "randomnessId",
      "requestHash",
      "resolutionId",
    ])
      || ![value.randomnessId, value.resolutionId, value.actorCharacterId, value.purposeKey]
        .every(isNonEmptyString)
      || !isNonEmptyString(value.diceExpression)
      || !Array.isArray(value.dice) || value.dice.length !== 1
      || !isRecord(value.dice[0])
      || !hasExactKeys(value.dice[0], ["count", "sides"])
      || typeof value.dice[0].count !== "string"
      || !CANONICAL_POSITIVE_INTEGER_PATTERN.test(value.dice[0].count)
      || !(value.purpose === "restHitDice"
        ? ["6", "8", "10", "12"].includes(String(value.dice[0].sides))
        : CANONICAL_POSITIVE_INTEGER_PATTERN.test(String(value.dice[0].sides)))
      || value.diceExpression !== `${value.dice[0].count}d${value.dice[0].sides}`
      || !isRecord(value.frozenParameters)
      || !isSha256(value.requestHash)) return false;
    const { requestHash: _requestHash, ...core } = value;
    return canonicalSha256(core) === value.requestHash;
  }
  if (value.purpose === "worldInteractionCheck") return isWorldInteractionRandomnessRequest(value,isFrozenCheck);
  return hasExactKeys(value, [
      "actorCharacterId",
      "diceExpression",
      "frozenCheck",
      "purpose",
      "randomnessId",
      "resolutionId",
    ])
    && isNonEmptyString(value.randomnessId)
    && isNonEmptyString(value.resolutionId)
    && isNonEmptyString(value.actorCharacterId)
    && ["improvisedCheck", "abilityCheck", "contestCheck", "savingThrow"]
      .includes(String(value.purpose))
    && ["1d20", "2d20kh1", "2d20kl1"].includes(String(value.diceExpression))
    && isFrozenCheck(value.frozenCheck);
}

function isHiddenRealityResolutionPlan(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["actionPlan", "candidateSetId", "candidates", "kind"])
    && value.kind === "hiddenRealitySelection"
    && isNonEmptyString(value.candidateSetId)
    && Array.isArray(value.candidates)
    && value.candidates.length >= 2
    && isRecord(value.actionPlan);
}

function isAuthorityContinuation(value: unknown): value is AuthorityContinuation {
  return isRecord(value)
    && hasExactKeys(value, ["capability", "continuationId", "kind"])
    && value.kind === "roomAuthorityRandomness"
    && isNonEmptyString(value.continuationId)
    && isSha256(value.capability);
}

function isWorldInteractionRandomnessEventBinding(
  state: AuthoritativeWorldState,
  rootActionId: string,
  value: unknown,
): boolean {
  if (!isRecord(value)
    || !hasExactKeys(value, ["continuation", "formula", "purpose", "request", "resolutionPlan"])
    || !isRandomnessRequest(value.request)
    || value.request.purpose !== "worldInteractionCheck"
    || value.purpose !== value.request.purpose
    || value.formula !== value.request.diceExpression
    || !isAuthorityContinuation(value.continuation)
    || value.continuation.continuationId !== `continuation:${value.request.resolutionId}`) return false;
  const atomic=isAtomicWorldInteractionStepsPlan(value.resolutionPlan)?value.resolutionPlan:undefined;
  const resolutionPlan = isWorldInteractionResolutionPlan(value.resolutionPlan)?value.resolutionPlan
    :atomic===undefined?undefined:atomicWorldInteractionCheckPlan(atomic)
      ??atomic.steps.flatMap(step=>step.rulesInput.kind==="resolveWorldInteraction"?[step.rulesInput.plan]:[])[0];
  if(atomic===undefined&&resolutionPlan===undefined)return false;
  if(atomic!==undefined&&atomic.rootActionId!==rootActionId)return false;
  const expectedResolution=resolutionPlan===undefined?`resolution:atomic:${atomic!.rootActionId}`:resolutionPlan.resolutionId;
  const effective = atomic === undefined && resolutionPlan !== undefined ? worldInteractionEffectiveCheck(state,resolutionPlan) : undefined;
  if (effective?.kind === "rejected") return false;
  const check=effective?.check ?? (resolutionPlan?.ruling.kind==="check"?resolutionPlan.ruling.check:null);
  // Atomic prefixes may alter conditions before their shared check. The
  // capability freezes its exact mode; execution revalidates that mode at
  // the candidate prefix, before any effects can become authoritative.
  const boundCheck = atomic !== undefined && check !== null && value.request.frozenCheck !== null
    ? {...check,mode:value.request.frozenCheck.mode} : check;
  if(value.request.actorCharacterId!==(resolutionPlan?.actorCharacterId??atomic!.actorCharacterId)
    ||value.request.resolutionId!==expectedResolution
    ||value.request.randomnessId!==(resolutionPlan?.ruling.kind==="check"?resolutionPlan.ruling.randomnessId:`randomness:${expectedResolution}`)
    ||canonicalSha256(value.request.frozenCheck)!==canonicalSha256(boundCheck))return false;
  const resolutionPlanHash = isAtomicWorldInteractionStepsPlan(value.resolutionPlan)
    ? atomicWorldInteractionStepsPlanHash(value.resolutionPlan)
    : isWorldInteractionResolutionPlan(value.resolutionPlan)
      ? worldInteractionPlanHash(value.resolutionPlan)
      : undefined;
  if (resolutionPlanHash === undefined) return false;
  return value.continuation.capability === canonicalSha256({
    kind: "roomAuthorityRandomness",
    roomId: state.roomId,
    runtimeEpochId: state.runtimeEpochId,
    stateHash: hashWorldState(state),
    rootActionId,
    request: value.request,
    resolutionPlanHash,
  });
}

function isContestResolutionPlan(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["defenderId", "initiatorId", "schema", "tieResult"])
    && value.schema === "zhuwei.contest-resolution-plan/v1"
    && [value.initiatorId, value.defenderId, value.tieResult].every(isNonEmptyString)
    && value.initiatorId !== value.defenderId;
}

function isCharacterRecord(value: unknown): value is CharacterRecord {
  return isRecord(value)
    && hasOnlyKeys(value, [
      "entityOrdinal",
      "id",
      "kind",
      "name",
      "sceneId",
      "tenureStatus",
    ], [
      "abilityScores",
      "cantripIds",
      "classId",
      "controllerPrincipalId",
      "experiencePoints",
      "expertiseSkills",
      "featureIds",
      "hitPoints",
      "lastLongRestCompletedAtMicros",
      "lastControllerSeatId",
      "level",
      "loadout",
      "preparedSpellIds",
      "proficiencyBonus",
      "proficientSkills",
      "proficientSaves",
      "conditionImmunities",
      "raceId",
      "resourceMaximums",
      "resources",
      "semanticDefinitionRef",
      "semanticDefinitionRevision",
      "socialMechanics",
      "publicExpression",
      "subclassId",
    ])
    && isNonEmptyString(value.id)
    && (value.kind === "player" || value.kind === "npc")
    && isNonEmptyString(value.name)
    && isNonEmptyString(value.sceneId)
    && ["active", "dead", "retired", "missing", "npcTransitioned"].includes(String(value.tenureStatus))
    && typeof value.entityOrdinal === "string"
    && CANONICAL_POSITIVE_INTEGER_PATTERN.test(value.entityOrdinal)
    && (value.loadout === undefined || isCharacterLoadout(value.loadout))
    && (value.experiencePoints === undefined
      || (value.kind === "player"
        && Number.isSafeInteger(value.experiencePoints)
        && Number(value.experiencePoints) >= 0))
    && [value.classId, value.raceId, value.subclassId, value.controllerPrincipalId, value.lastControllerSeatId]
      .every((entry) => entry === undefined || isNonEmptyString(entry))
    && [value.semanticDefinitionRef, value.semanticDefinitionRevision]
      .every((entry) => entry === undefined || isNonEmptyString(entry))
    && (value.lastLongRestCompletedAtMicros === undefined
      || (typeof value.lastLongRestCompletedAtMicros === "string"
        && CANONICAL_UNSIGNED_INTEGER_PATTERN.test(value.lastLongRestCompletedAtMicros)))
    && [value.cantripIds, value.preparedSpellIds, value.featureIds]
      .every((entry) => entry === undefined || isCanonicalStringArray(entry))
    && [value.proficientSkills, value.expertiseSkills, value.proficientSaves]
      .every((entry) => entry === undefined || isCanonicalStringArray(entry))
    && (value.conditionImmunities === undefined || isConditionImmunities(value.conditionImmunities))
    && (value.proficientSaves === undefined
      || (Array.isArray(value.proficientSaves) && value.proficientSaves.every((ability) =>
        ["str", "dex", "con", "int", "wis", "cha"].includes(ability))))
    && (value.expertiseSkills === undefined
      || (Array.isArray(value.expertiseSkills)
        && Array.isArray(value.proficientSkills)
        && value.expertiseSkills.every((skill) =>
          (value.proficientSkills as string[]).includes(skill))))
    && (value.resourceMaximums === undefined || (isRecord(value.resourceMaximums)
      && Object.entries(value.resourceMaximums).every(([resourceId, maximum]) =>
        isNonEmptyString(resourceId) && Number.isSafeInteger(maximum) && Number(maximum) >= 0)))
    && (value.publicExpression === undefined || (value.kind === "npc" && publicExpressionConform(value.publicExpression)))
    && (value.socialMechanics === undefined
      || (value.kind === "npc" && isNpcSocialMechanics(value.socialMechanics)));
}

function isTypedPayload(eventType: EventType, value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  switch (eventType) {
    case "NpcWorkProposed": return hasExactKeys(value, ["planId", "promiseId", "npcId", "nextStep"])
      && [value.planId, value.promiseId, value.npcId, value.nextStep].every(isNonEmptyString);
    case "NpcWorkDecision": return hasExactKeys(value, ["planId", "planHash", "decision"]) && isNonEmptyString(value.planId) && isSha256(value.planHash) && npcWorkDecisionConform(value.decision);
    case "NpcWorkStarted": return hasExactKeys(value, ["planId", "planHash"]) && isNonEmptyString(value.planId) && isSha256(value.planHash);
    case "PromiseTermsEstablished": return hasExactKeys(value, ["promiseId", "originalExpressionRef", "terms", "timelineId", "fromFictionMicros", "deadlineFictionMicros"])
      && isNonEmptyString(value.promiseId) && promiseTermsConform(value.terms);
    case "PromiseReviewed": return hasExactKeys(value, ["promiseId", "frameHash", "judgment"])
      && isNonEmptyString(value.promiseId) && isSha256(value.frameHash) && promiseJudgmentConform(value.judgment);
    case "PromiseChanged": return hasExactKeys(value, ["promiseId", "revision", "expressionRef", "change"])
      && [value.promiseId, value.revision, value.expressionRef].every(isNonEmptyString) && promiseChangeConform(value.change);
    case "KnowledgeReviewed": return isKnowledgeReviewedPayload(value);
    case "NarrativeDetailCommitted": return isNarrativeDetailCommittedPayload(value);
    case "NarrativeDetailMaterialized": return isNarrativeDetailMaterializedPayload(value);
    case "ItemUniquenessBound": return isItemUniquenessBoundPayload(value);
    case "ItemIdentified": return isItemIdentifiedPayload(value);
    case "AtomicWorldInteractionSuspended":
      return hasExactKeys(value, ["continuation"]) && isAtomicWorldContinuation(value.continuation);
    case "AtomicWorldInteractionResumed":
      return hasExactKeys(value, ["rootActionId"]) && isNonEmptyString(value.rootActionId);
    case "AtomicWorldInteractionStepsResolved":
      return isAtomicWorldInteractionStepsResolvedPayload(value);
    case "SemanticDefinitionRevised":
      return isSemanticDefinitionRevisedPayload(value);
    case "SemanticDefinitionMaterialized":
      return isSemanticDefinitionMaterializedPayload(value);
    case "AuthoredMaterializationResolved":
      return isRecord(value)&&hasExactKeys(value,["actorCharacterId","contextHash","kind","ref","summary",...(Object.hasOwn(value,"sourceRefs")?["sourceRefs"]:[])])
        &&(value.sourceRefs===undefined || (Array.isArray(value.sourceRefs)&&value.sourceRefs.every(isNonEmptyString)&&new Set(value.sourceRefs).size===value.sourceRefs.length))
        &&isNonEmptyString(value.actorCharacterId)&&isSha256(value.contextHash)&&isNonEmptyString(value.ref)&&isNonEmptyString(value.summary)
        &&["abilityDefinition","hazardDefinition","itemDefinition","itemEntry"].includes(String(value.kind));
    case "WorldInteractionResolved":
      return isWorldInteractionResolvedPayload(value);
    case "WorldInteractionFeasibilityRuled":
      return isWorldInteractionFeasibilityRuledPayload(value);
    case "ImprovisedActionResolved":
      return hasExactKeys(value, ["actorCharacterId", "fact", "outcomeCode"])
        && isNonEmptyString(value.actorCharacterId)
        && isNonEmptyString(value.outcomeCode)
        && (value.fact === null || isFactDraft(value.fact));
    case "ClarificationRequested":
      return hasExactKeys(value, ["actorCharacterId", "pendingInputId", "question"])
        && isNonEmptyString(value.actorCharacterId)
        && isNonEmptyString(value.pendingInputId)
        && isNonEmptyString(value.question);
    case "FrozenPlayerChoicePrepared":
      return hasExactKeys(value, ["record"]) && isFrozenPlayerChoiceRecord(value.record)
        && value.record.selectedChoiceId === null && value.record.inFlightInput === null;
    case "ActivityCompletionInputRecorded":
      return hasExactKeys(value, ["activityId", "input"]) && isNonEmptyString(value.activityId) && isFrozenPlayerChoiceContinuationInput(value.input);
    case "FrozenPlayerChoiceInputRecorded":
      return hasExactKeys(value, ["input"]) && isFrozenPlayerChoiceContinuationInput(value.input);
    case "PlayerChoiceRequested":
      return hasExactKeys(value, ["actorCharacterId", "choices", "pendingInputId", "question"])
        && isNonEmptyString(value.actorCharacterId)
        && isNonEmptyString(value.pendingInputId)
        && isNonEmptyString(value.question)
        && Array.isArray(value.choices)
        && value.choices.length >= 2
        && value.choices.length <= 12
        && value.choices.every((choice) => isRecord(choice)
          && hasExactKeys(choice, ["choiceId", "consequence", "label"])
          && isNonEmptyString(choice.choiceId)
          && isNonEmptyString(choice.label)
          && isNonEmptyString(choice.consequence))
        && new Set(value.choices.map((choice) => (choice as JsonRecord).choiceId)).size
          === value.choices.length;
    case "SocialResolutionOffered":
      return hasExactKeys(value, [
        "actorCharacterId",
        "claimRef",
        "npcCharacterId",
        "pendingInputId",
        "plan",
        "planHash",
        "question",
        "threadRef",
      ])
        && [
          value.actorCharacterId,
          value.claimRef,
          value.npcCharacterId,
          value.pendingInputId,
          value.question,
          value.threadRef,
        ].every(isNonEmptyString)
        && isSha256(value.planHash)
        && isSocialResolutionPlan(value.plan)
        && value.planHash === canonicalSha256(value.plan)
        && value.actorCharacterId === value.plan.actorCharacterId
        && value.npcCharacterId === value.plan.npcCharacterId
        && value.pendingInputId === value.plan.pendingInputId
        && value.claimRef === value.plan.claimRef
        && value.threadRef === value.plan.threadRef;
    case "SocialResolutionDeclined":
      return hasExactKeys(value, [
        "actorCharacterId",
        "claimRef",
        "disposition",
        "npcCharacterId",
        "outcome",
        "pendingInputId",
        "reason",
        "threadRef",
      ])
        && [
          value.actorCharacterId,
          value.claimRef,
          value.npcCharacterId,
          value.outcome,
          value.pendingInputId,
          value.threadRef,
        ].every(isNonEmptyString)
        && ["acceptedStatusQuo", "reframed", "invalidated"].includes(String(value.reason))
        && ["active", "deemphasized", "dormant", "closed"].includes(String(value.disposition))
        && (value.reason === "invalidated"
          ? value.disposition === "dormant"
          : value.disposition === "active");
    case "SocialDirectResolved":
      return hasExactKeys(value, [
        "actorCharacterId",
        "addressedThreadRef",
        "claimSemantics",
        "claimRef",
        "immediateBehavior",
        "npcCharacterId",
        "outcome",
        "plan",
        "planHash",
        "responseClaimRef",
        "responseMinimumDegree",
        "responseMode",
        "responseReaction",
        "sourceRefs",
        "threadDisposition",
        "threadRef",
      ])
        && [
          value.actorCharacterId,
          value.claimRef,
          value.immediateBehavior,
          value.npcCharacterId,
          value.outcome,
          value.threadRef,
        ].every(isNonEmptyString)
        && (value.responseClaimRef === null
          ? value.responseMode === "reaction" && value.responseReaction === "silence"
          : isNonEmptyString(value.responseClaimRef))
        && isSocialClaimSemantics(value.claimSemantics)
        && isSha256(value.planHash)
        && isSocialResolutionPlan(value.plan)
        && value.planHash === canonicalSha256(value.plan)
        && value.actorCharacterId === value.plan.actorCharacterId
        && value.npcCharacterId === value.plan.npcCharacterId
        && value.claimRef === value.plan.claimRef
        && value.threadRef === value.plan.threadRef
        && (value.addressedThreadRef === null || isNonEmptyString(value.addressedThreadRef))
        && value.addressedThreadRef === value.claimSemantics.addressedThreadRef
        && socialResponseMetadataValid(
          value.responseMode,
          value.responseReaction,
          value.sourceRefs,
        )
        && ["limitedSuccess", "fullSuccess", "strongSuccess"]
          .includes(String(value.responseMinimumDegree))
        && ["active", "deemphasized", "dormant", "closed"]
          .includes(String(value.threadDisposition))
        && value.threadDisposition === directSocialThreadDisposition(
          value.responseMode,
          value.responseReaction,
        );
    case "SocialCheckResolved":
      return hasExactKeys(value, [
        "actorCharacterId",
        "addressedThreadDisposition",
        "addressedThreadRef",
        "boundary",
        "claimRef",
        "degree",
        "immediateBehavior",
        "margin",
        "marginDegree",
        "maximumInfluenceDegree",
        "npcCharacterId",
        "outcome",
        "relationshipBefore",
        "relationshipDelta",
        "relationshipScore",
        "responseClaimRef",
        "responseMinimumDegree",
        "responseMode",
        "responseReached",
        "responseReaction",
        "responseSourceRefs",
        "selectedRoll",
        "succeeded",
        "threadDisposition",
        "threadRef",
        "total",
      ])
        && [
          value.actorCharacterId,
          value.claimRef,
          value.immediateBehavior,
          value.npcCharacterId,
          value.outcome,
          value.threadRef,
        ].every(isNonEmptyString)
        && [
          value.boundary,
          value.margin,
          value.relationshipBefore,
          value.relationshipDelta,
          value.relationshipScore,
          value.selectedRoll,
          value.total,
        ].every(Number.isSafeInteger)
        && (value.addressedThreadRef === null
          ? value.addressedThreadDisposition === null
          : isNonEmptyString(value.addressedThreadRef)
            && ["active", "deemphasized", "dormant", "closed"]
              .includes(String(value.addressedThreadDisposition))
            && value.addressedThreadDisposition === (value.succeeded
              ? value.threadDisposition
              : "active"))
        && ["limitedSuccess", "fullSuccess", "strongSuccess"]
          .includes(String(value.responseMinimumDegree))
        && Array.isArray(value.responseSourceRefs)
        && value.responseSourceRefs.every(isNonEmptyString)
        && value.responseSourceRefs.length === new Set(value.responseSourceRefs).size
        && typeof value.responseReached === "boolean"
        && ((value.succeeded === true
          && ["limitedSuccess", "fullSuccess", "strongSuccess"].includes(String(value.degree))
          && SOCIAL_SUCCESS_RANK[value.degree as keyof typeof SOCIAL_SUCCESS_RANK]
            >= SOCIAL_SUCCESS_RANK[
              value.responseMinimumDegree as keyof typeof SOCIAL_SUCCESS_RANK
            ]) === value.responseReached)
        && (value.responseReached === false
          ? value.responseMode === null
            && value.responseReaction === null
            && value.responseSourceRefs.length === 0
            && value.responseClaimRef === null
          : socialResponseMetadataValid(
              value.responseMode,
              value.responseReaction,
              value.responseSourceRefs,
            )
            && value.succeeded === true
            && ["limitedSuccess", "fullSuccess", "strongSuccess"].includes(String(value.degree))
            && SOCIAL_SUCCESS_RANK[value.degree as keyof typeof SOCIAL_SUCCESS_RANK]
              >= SOCIAL_SUCCESS_RANK[
              value.responseMinimumDegree as keyof typeof SOCIAL_SUCCESS_RANK
              ]
            && (value.responseReaction === "silence"
              ? value.responseClaimRef === null
              : isNonEmptyString(value.responseClaimRef)))
        && Number(value.boundary) >= 5
        && Number(value.boundary) <= 30
        && Number(value.selectedRoll) >= 1
        && Number(value.selectedRoll) <= 20
        && Number(value.relationshipBefore) >= -5
        && Number(value.relationshipBefore) <= 5
        && Number(value.relationshipDelta) >= -1
        && Number(value.relationshipDelta) <= 1
        && Number(value.relationshipScore) >= -5
        && Number(value.relationshipScore) <= 5
        && Number(value.relationshipScore)
          === Number(value.relationshipBefore) + Number(value.relationshipDelta)
        && (Number(value.relationshipDelta) >= 0 || value.marginDegree === "strongFailure")
        && (Number(value.relationshipDelta) <= 0 || value.marginDegree === "strongSuccess")
        && value.margin === Number(value.total) - Number(value.boundary)
        && typeof value.succeeded === "boolean"
        && value.succeeded === (Number(value.margin) >= 0)
        && [
          "strongFailure", "failure", "limitedSuccess", "fullSuccess", "strongSuccess",
        ].includes(String(value.degree))
        && [
          "strongFailure", "failure", "limitedSuccess", "fullSuccess", "strongSuccess",
        ].includes(String(value.marginDegree))
        && ["limitedSuccess", "fullSuccess", "strongSuccess"]
          .includes(String(value.maximumInfluenceDegree))
        && value.marginDegree === socialDegreeForMargin(Number(value.margin))
        && value.degree === capSocialDegree(
          value.marginDegree as EventPayloadByType["SocialCheckResolved"]["marginDegree"],
          value.maximumInfluenceDegree as EventPayloadByType["SocialCheckResolved"]["maximumInfluenceDegree"],
        )
        && ["active", "deemphasized", "dormant", "closed"]
          .includes(String(value.threadDisposition))
        && value.threadDisposition === (value.degree === "strongFailure" || value.degree === "failure"
          ? "active"
          : value.degree === "limitedSuccess"
            ? "deemphasized"
            : value.degree === "fullSuccess" ? "dormant" : "closed");
    case "NpcMaterialized": return isNpcMaterializedPayload(value);
    case "DynamicEntityMaterialized": {
      const sourceFactIds = Array.isArray(value.sourceFactIds)
        ? value.sourceFactIds
        : [];
      return hasExactKeys(value, [
        "definitionId",
        "entityId",
        "entityKind",
        "initialKnowledgeFactIds",
        "sceneId",
        "socialArchetypeRef",
        "socialMechanicsHash",
        "sourceFactIds",
        "sourceTimelineId",
      ])
        && [
          value.definitionId,
          value.entityId,
          value.sceneId,
          value.socialArchetypeRef,
          value.sourceTimelineId,
        ].every(isNonEmptyString)
        && value.entityKind === "npc"
        && Array.isArray(value.sourceFactIds)
        && value.sourceFactIds.length >= 1
        && value.sourceFactIds.length <= 8
        && value.sourceFactIds.every(isNonEmptyString)
        && new Set(value.sourceFactIds).size === value.sourceFactIds.length
        && Array.isArray(value.initialKnowledgeFactIds)
        && value.initialKnowledgeFactIds.length <= 8
        && value.initialKnowledgeFactIds.every(isNonEmptyString)
        && new Set(value.initialKnowledgeFactIds).size === value.initialKnowledgeFactIds.length
        && value.initialKnowledgeFactIds.every((factId) => sourceFactIds.includes(factId))
        && isSha256(value.socialMechanicsHash)
        && dynamicNpcSocialMechanics(value.socialArchetypeRef) !== undefined
        && canonicalSha256(dynamicNpcSocialMechanics(value.socialArchetypeRef))
          === value.socialMechanicsHash;
    }
    case "PendingInputAnswered":
      return hasExactKeys(value, ["actorCharacterId", "answer", "openedByEventId", "pendingInputId"])
        && isNonEmptyString(value.actorCharacterId)
        && isRecord(value.answer)
        && isNonEmptyString(value.openedByEventId)
        && isNonEmptyString(value.pendingInputId);
    case "CorrectionApplied":
      return hasExactKeys(value, [
        "actorCharacterId",
        "compensatedEventIds",
        "correctionId",
        "effects",
        "errorKind",
        "publicExplanation",
        "targetReceiptId",
        "targetRootActionId",
      ])
        && [
          value.actorCharacterId,
          value.correctionId,
          value.errorKind,
          value.publicExplanation,
          value.targetReceiptId,
          value.targetRootActionId,
        ].every(isNonEmptyString)
        && isCanonicalCorrectionStringArray(value.compensatedEventIds)
        && validateCorrectionEffects(value.effects);
    case "CorrectionBranchOpened":
      return hasExactKeys(value, [
        "actorCharacterId",
        "branchId",
        "correctionId",
        "cutoffEventSeq",
        "errorKind",
        "parentBranchId",
        "publicExplanation",
        "supersededRootActionIds",
        "targetReceiptId",
        "targetRootActionId",
      ])
        && [
          value.actorCharacterId,
          value.branchId,
          value.correctionId,
          value.errorKind,
          value.parentBranchId,
          value.publicExplanation,
          value.targetReceiptId,
          value.targetRootActionId,
        ].every(isNonEmptyString)
        && typeof value.cutoffEventSeq === "string"
        && CANONICAL_POSITIVE_INTEGER_PATTERN.test(value.cutoffEventSeq)
        && isCanonicalCorrectionStringArray(value.supersededRootActionIds);
    case "BranchActivated":
      return hasExactKeys(value, [
        "branchId",
        "correctionId",
        "effects",
        "parentBranchId",
        "supersededRootActionIds",
      ])
        && [value.branchId, value.correctionId, value.parentBranchId].every(isNonEmptyString)
        && validateCorrectionEffects(value.effects)
        && isCanonicalCorrectionStringArray(value.supersededRootActionIds);
    case "RandomnessRequested":
      if (hasExactKeys(value, ["resolution"])) {
        return validateCombatRandomnessResolution(value.resolution);
      }
      if (hasExactKeys(value, ["continuation", "formula", "purpose", "request", "resolutionPlan"])) {
        return isRandomnessRequest(value.request)
          && isAuthorityContinuation(value.continuation)
          && value.purpose === value.request.purpose
          && value.formula === value.request.diceExpression
          && (isCompoundResolutionPlan(value.resolutionPlan)
            || isCausalActionResolutionPlan(value.resolutionPlan)
            || isSocialResolutionPlan(value.resolutionPlan)
            || isContestResolutionPlan(value.resolutionPlan)
            || isHiddenRealityResolutionPlan(value.resolutionPlan)
            || isWorldInteractionResolutionPlan(value.resolutionPlan)
            || isAtomicWorldInteractionStepsPlan(value.resolutionPlan));
      }
      return hasExactKeys(value, ["continuation", "formula", "purpose", "request"])
        && isRandomnessRequest(value.request)
        && isAuthorityContinuation(value.continuation)
        && value.purpose === value.request.purpose
        && value.formula === value.request.diceExpression;
    case "DiceRolled":
      if (!hasExactKeys(value, [
        "faces",
        "formula",
        "frozenParametersHash",
        "randomnessId",
        "requestHash",
        "resolutionId",
        "selectedFace",
      ])
        || !isNonEmptyString(value.randomnessId)
        || !isNonEmptyString(value.resolutionId)
        || !isSha256(value.requestHash)
        || !isSha256(value.frozenParametersHash)) return false;
      return worldInteractionDiceEventValid(value);
    case "HiddenRealityCandidatesFrozen":
      return hasExactKeys(value, ["candidateSetId", "candidates"])
        && isNonEmptyString(value.candidateSetId) && Array.isArray(value.candidates) && value.candidates.length >= 2;
    case "HiddenRealityMaterialized":
      return hasExactKeys(value, ["candidateId", "candidateSetId", "factRef", "selectedFace"])
        && [value.candidateId, value.candidateSetId, value.factRef].every(isNonEmptyString)
        && Number.isSafeInteger(value.selectedFace) && Number(value.selectedFace) > 0;
    case "ImprovisedCheckResolved":
      return hasExactKeys(value, [
        "outcome",
        "request",
        "rolls",
        "selectedRoll",
        "succeeded",
        "total",
      ])
        && isRandomnessRequest(value.request)
        && value.request.purpose !== "restHitDice"
        && Array.isArray(value.rolls)
        && value.rolls.every((roll) => Number.isInteger(roll) && roll >= 1 && roll <= 20)
        && Number.isInteger(value.selectedRoll)
        && Number.isInteger(value.total)
        && typeof value.succeeded === "boolean"
        && isNonEmptyString(value.outcome);
    case "KnowledgeAcquired":
      if (hasExactKeys(value, ["characterId", "contentLayer", "items", "medium", "sourceCharacterId"])) {
        return isNonEmptyString(value.characterId)
          && isNonEmptyString(value.sourceCharacterId)
          && isNonEmptyString(value.medium)
          && ["hint", "partial", "full"].includes(String(value.contentLayer))
          && Array.isArray(value.items)
          && value.items.length > 0
          && value.items.every((item) => isRecord(item)
            && hasExactKeys(item, ["content", "knowledgeRef", "objectKind", "provenanceChain"])
            && isNonEmptyString(item.knowledgeRef)
            && ["sensoryEvidence", "sourceClaim", "characterInference", "canonicalFact"].includes(String(item.objectKind))
            && isCanonicalStringArray(item.provenanceChain));
      }
      return hasOnlyKeys(value, [
        "acquisition",
        "causeFactId",
        "characterId",
        "content",
        "knowledgeRef",
        "layer",
        "objectKind",
        "visibility",
      ], ["sourceCharacterId", "storyAdmission"])
        && (value.storyAdmission === undefined || isStoryKnowledgeAdmissionMetadata(value.storyAdmission))
        && isNonEmptyString(value.characterId)
        && isNonEmptyString(value.knowledgeRef)
        && ["sensoryEvidence", "sourceClaim", "characterInference", "canonicalFact"]
          .includes(String(value.objectKind))
        && ["hint", "partial", "full"].includes(String(value.layer))
        && isNonEmptyString(value.causeFactId)
        && isRecord(value.acquisition)
        && hasExactKeys(value.acquisition, ["method", "sceneId", "sense"])
        && isNonEmptyString(value.acquisition.sense)
        && isNonEmptyString(value.acquisition.sceneId)
        && isNonEmptyString(value.acquisition.method)
        && ["private", "shared", "publiclyObservable"].includes(String(value.visibility));
    case "KnowledgeShared":
      return hasExactKeys(value, [
        "contentKind",
        "medium",
        "recipientCharacterIds",
        "sharedContent",
        "sourceCharacterId",
        "sourceKnowledgeRef",
      ])
        && isNonEmptyString(value.sourceCharacterId)
        && isNonEmptyString(value.sourceKnowledgeRef)
        && isCanonicalStringArray(value.recipientCharacterIds)
        && value.recipientCharacterIds.length > 0
        && value.contentKind === "exact"
        && isRecord(value.medium)
        && hasExactKeys(value.medium, ["factId", "kind"])
        && value.medium.kind === "establishedChannel"
        && isNonEmptyString(value.medium.factId);
    case "CharacterControlTransferred":
      return hasExactKeys(value, ["characterId", "fromSeatId", "toSeatId"])
        && isNonEmptyString(value.characterId)
        && isNonEmptyString(value.fromSeatId)
        && isNonEmptyString(value.toSeatId);
    case "CharacterRetired":
      return hasOnlyKeys(value, ["characterId", "controllingSeatId"], ["continueAsNpc", "reason"])
        && isNonEmptyString(value.characterId)
        && isNonEmptyString(value.controllingSeatId);
    case "SuccessorIntroduced":
      return hasOnlyKeys(value, [
        "combatEntity",
        "controllerSeatId",
        "definitions",
        "predecessorCharacterId",
        "successor",
      ], ["worldEntry"])
        && isNonEmptyString(value.controllerSeatId)
        && isNonEmptyString(value.predecessorCharacterId)
        && isCharacterRecord(value.successor)
        && validCharacterMechanicsSnapshot(
          value.successor.id,
          value.combatEntity,
          value.definitions,
        );
    default:
      return validateEnvironmentEventPayload(eventType, value)
        || validateSafetyEventPayload(eventType, value)
        || validateCombatEventPayload(eventType, value)
        || validateCampaignEventPayload(eventType, value)
        || validateMultiplayerEventPayload(eventType, value);
  }
}

function publicReceipt(event: EventEnvelope): PublicReceipt {
  const status = event.eventType === "AtomicWorldInteractionSuspended"
    ? ((event.payload as EventPayloadByType["AtomicWorldInteractionSuspended"]).continuation.waiting.kind === "input" ? "awaitingInput" : "awaitingRandomness")
    : event.eventType === "ClarificationRequested"
    || event.eventType === "PlayerChoiceRequested"
    || event.eventType === "SocialResolutionOffered"
    || event.eventType === "AdvancementAvailable"
    || event.eventType === "CombatPendingOpened"
    || event.eventType === "ReactionOpportunityOpened"
    || event.eventType === "ReactionOffered"
    || event.eventType === "PartyMemberInvited"
    || event.eventType === "PartyMoveProposed"
    || event.eventType === "GroupRestOffered"
    || event.eventType === "EncounterConclusionProposed"
    ? "awaitingInput"
    : event.eventType === "GroupRestConsentRecorded"
      && (event.payload as EventPayloadByType["GroupRestConsentRecorded"]).remainingPendingInputIds.length > 0
      ? "awaitingInput"
    : event.eventType === "RandomnessRequested"
      ? "awaitingRandomness"
    : event.eventType === "StoryConcluded"
      ? "concluded"
      : "committed";
  return {
    receiptId: `receipt:${event.rootActionId}:${event.eventSeq}`,
    rootActionId: event.rootActionId,
    status,
    branchId: event.eventType === "BranchActivated"
      ? (event.payload as EventPayloadByType["BranchActivated"]).branchId
      : event.branchId,
    eventRange: {
      fromEventSeq: event.eventSeq,
      toEventSeq: event.eventSeq,
    },
    rulesetVersion: event.profiles.ruleset.profileId,
    eventSchemaVersion: event.profiles.eventSchema.profileId,
    scopeProofHash: event.scopeProofHash,
  };
}

function eventSubjects(event: EventEnvelope, state: AuthoritativeWorldState): string[] {
  const payload = event.payload as JsonRecord;
  const candidates = [
    payload.actorCharacterId,
    payload.npcCharacterId,
    payload.characterId,
    payload.sourceCharacterId,
    payload.fromCharacterId,
    payload.inviterCharacterId,
    payload.invitedCharacterId,
    payload.leaderCharacterId,
    payload.predecessorCharacterId,
  ].filter(isNonEmptyString);
  if (Array.isArray(payload.recipientCharacterIds)) {
    candidates.push(...payload.recipientCharacterIds.filter(isNonEmptyString));
  }
  if (Array.isArray(payload.invitedCharacterIds)) {
    candidates.push(...payload.invitedCharacterIds.filter(isNonEmptyString));
  }
  if (isRecord(payload.successor) && isNonEmptyString(payload.successor.id)) {
    candidates.push(payload.successor.id);
  }
  if (isRecord(payload.request) && isNonEmptyString(payload.request.actorCharacterId)) {
    candidates.push(payload.request.actorCharacterId);
  }
  // Lifecycle events reference the existing Activity instead of repeating its
  // owner. Receipt subjects must come from that authoritative relationship,
  // not from a caller-supplied cause or the mere shape of an activity ID.
  if ((event.eventType === "ActivityInterrupted" || event.eventType === "ActivityCompleted" || event.eventType === "ActivityAttentionRequested" || event.eventType === "ActivityAttentionAcknowledged"
    || (event.eventType === "FictionTimeAdvanced" && ["timePassage", "longSpellcasting", "activityProgress"].includes(String(payload.reason))))
    && isNonEmptyString(payload.activityId)) {
    const owner = state.campaignRuntime.activities[payload.activityId]?.characterId;
    if (isNonEmptyString(owner)) candidates.push(owner);
  }
  // A private revision can be the entire due receipt. Bind its actor from
  // the plan already validated and folded by Rules, even without an Activity
  // completion event to carry that relationship into receipt subjects.
  if (["NpcActionCommitted", "NpcPlanRevised", "NpcPlanCancelled"].includes(event.eventType)
    && isNonEmptyString(payload.planId)) {
    const owner = state.campaignRuntime.npcPlans[payload.planId]?.npcId;
    if (isNonEmptyString(owner) && owner === payload.npcId) candidates.push(owner);
  }
  if (["FactionActionCommitted", "FactionPlanAdvanced"].includes(event.eventType)
    && isNonEmptyString(payload.planId)) {
    const owner = state.campaignRuntime.factionPlans[payload.planId]?.actingNpcId;
    if (isNonEmptyString(owner) && owner === payload.actingNpcId) candidates.push(owner);
  }
  if (["PromiseTermsEstablished", "PromiseReviewed", "PromiseChanged"].includes(event.eventType)
    && isNonEmptyString(payload.promiseId)) {
    const promise = state.campaignRuntime.promises[payload.promiseId];
    if (promise !== undefined) candidates.push(...[promise.promisorId, promise.promiseeId].filter(isNonEmptyString));
  }
  if (["NpcWorkProposed", "NpcWorkStarted", "NpcWorkDecision"].includes(event.eventType) && isNonEmptyString(payload.planId)) {
    const plan = state.campaignRuntime.npcPlans[payload.planId];
    if (plan?.schema === "zhuwei.npc-work/vnext-1" && isNonEmptyString(plan.npcId)) candidates.push(plan.npcId);
  }
  if (event.eventType === "RelationshipChanged" || event.eventType === "PromiseMade" || event.eventType === "DebtIncurred") {
    const commitment = socialCommitmentFromPayload(event.eventType, payload);
    if (commitment !== undefined) candidates.push(...socialCommitmentParticipants(commitment));
  }
  return [...new Set(candidates)].sort();
}

function knowledgeFor(
  state: AuthoritativeWorldState,
  characterId: string,
): Record<string, KnowledgeRecord> {
  state.knowledge[characterId] ??= {};
  return state.knowledge[characterId];
}

function socialResponseReferencesAvailable(
  state: AuthoritativeWorldState,
  npcCharacterId: string,
  mode: "reaction" | "sourceBacked" | "commitment",
  refs: readonly string[],
): boolean {
  if (mode === "reaction") return refs.length === 0;
  if (refs.length < 1 || refs.length > 4) return false;
  const npc = state.entities[npcCharacterId];
  if (npc?.kind !== "npc") return false;
  if (mode === "sourceBacked") {
    return refs.every((reference) => {
      const fact = state.canonicalFacts[reference];
      return state.knowledge[npcCharacterId]?.[reference] !== undefined
        || (fact !== undefined && canonicalFactVisibleToCharacter(state, fact, npc));
    });
  }
  return refs.every((reference) => {
    const entity = state.entities[reference];
    const fact = state.canonicalFacts[reference];
    return state.campaignRuntime.definitions[reference] !== undefined
      || (entity !== undefined && socialParticipantsCoPresent(state, npc, entity))
      || state.knowledge[npcCharacterId]?.[reference] !== undefined
      || (fact !== undefined && canonicalFactVisibleToCharacter(state, fact, npc));
  });
}

function moduleCatalogValue(
  state: AuthoritativeWorldState,
  reference: string,
  kind: string,
  schema: string,
): JsonRecord | undefined {
  const fact = state.canonicalFacts[reference];
  const campaign = state.campaignRuntime.campaign;
  const campaignRef = isRecord(campaign) && isRecord(campaign.moduleRef)
    ? campaign.moduleRef
    : undefined;
  const value = isRecord(fact?.value) ? fact.value : undefined;
  const valueModuleRef = isRecord(value?.moduleRef) ? value.moduleRef : undefined;
  return fact?.kind === kind
    && fact.source === "moduleAnchor"
    && fact.visibilityPolicyId === "visibility:room-authority-only"
    && value?.schema === schema
    && isNonEmptyString(campaignRef?.profileId)
    && isNonEmptyString(campaignRef?.profileHash)
    && valueModuleRef?.profileId === campaignRef?.profileId
    && valueModuleRef?.profileHash === campaignRef?.profileHash
    ? value
    : undefined;
}

function premiseEntityKind(
  state: AuthoritativeWorldState,
  reference: string,
): "person" | "organization" | "place" | "object" | "event" | "task" | undefined {
  if (state.entities[reference] !== undefined) return "person";
  if (state.scenes[reference] !== undefined) return "place";
  const definition = state.campaignRuntime.definitions[reference];
  const content = isRecord(definition?.content) ? definition.content : undefined;
  if (["person", "organization", "place", "object", "event", "task"]
    .includes(String(content?.entityKind))) {
    return content?.entityKind as ReturnType<typeof premiseEntityKind>;
  }
  if (definition?.definitionKind === "npc") return "person";
  if (definition?.definitionKind === "organization" || definition?.definitionKind === "faction") {
    return "organization";
  }
  if (definition?.definitionKind === "location") return "place";
  if (definition?.definitionKind === "item") return "object";
  if (definition?.definitionKind === "opportunity") return "task";
  return undefined;
}

function characterPremiseFactMatchesState(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  fact: EventPayloadByType["ImprovisedActionResolved"]["fact"],
): boolean {
  if (fact === null
    || fact.kind !== "characterPremise"
    || fact.subjectRefs.length !== 1
    || fact.subjectRefs[0] !== actorCharacterId
    || fact.source !== "dynamicMaterialization"
    || fact.visibilityPolicyId !== `visibility:knowledge-holder:${actorCharacterId}`
    || !isRecord(fact.value)
    || !hasExactKeys(fact.value, [
      "anchorRefs", "bindings", "characterId", "origin", "policyRef", "predicate", "scope",
      "schema", "sourceRefs", "statementTemplateRef", "truthStatus",
    ])
    || fact.value.schema !== "zhuwei.character-premise/v2"
    || fact.value.characterId !== actorCharacterId
    || !isNonEmptyString(fact.value.policyRef)
    || !isNonEmptyString(fact.value.predicate)
    || fact.value.scope !== "characterBackstory"
    || fact.value.truthStatus !== "canonical"
    || !["kpOpenBlankWithinModuleAnchor", "derivedFromEstablishedSources"]
      .includes(String(fact.value.origin))
    || !Array.isArray(fact.value.anchorRefs)
    || !fact.value.anchorRefs.every(isNonEmptyString)
    || !Array.isArray(fact.value.sourceRefs)
    || !fact.value.sourceRefs.every(isNonEmptyString)
    || !Array.isArray(fact.value.bindings)) return false;
  // schema is part of the closed fact payload; keep the check separate so a
  // free statement/role field cannot be smuggled in through exact-key drift.
  const value = fact.value as JsonRecord;
  const anchorRefs = value.anchorRefs as string[];
  const sourceRefs = value.sourceRefs as string[];
  const bindings = value.bindings as JsonRecord[];
  const policyValue = moduleCatalogValue(
    state,
    value.policyRef as string,
    "modulePremisePolicy",
    "zhuwei.module-premise-policy/v1",
  );
  const policy = isRecord(policyValue?.policy) ? policyValue.policy : undefined;
  if (policy === undefined
    || policy.policyRef !== value.policyRef
    || policy.predicate !== value.predicate
    || policy.scope !== value.scope
    || policy.statementTemplateRef !== value.statementTemplateRef
    || !Number.isSafeInteger(policy.minimumBindings)
    || !Number.isSafeInteger(policy.maximumBindings)
    || !Array.isArray(policy.allowedAnchorRefs)
    || !Array.isArray(policy.slots)
    || bindings.length < Number(policy.minimumBindings)
    || bindings.length > Number(policy.maximumBindings)
    || anchorRefs.some((anchorRef) =>
      !(policy.allowedAnchorRefs as unknown[]).includes(anchorRef)
      || moduleCatalogValue(state, anchorRef, "moduleAnchor", "zhuwei.module-anchor/v1") === undefined)
    || !sourceRefs.includes(value.policyRef as string)
    || anchorRefs.some((anchorRef) => !sourceRefs.includes(anchorRef))) return false;
  const slots = policy.slots as JsonRecord[];
  for (const slotValue of slots) {
    if (!isRecord(slotValue)
      || !isNonEmptyString(slotValue.slotRef)
      || !isNonEmptyString(slotValue.relationKind)
      || !Number.isSafeInteger(slotValue.minimum)
      || !Number.isSafeInteger(slotValue.maximum)
      || !Array.isArray(slotValue.allowedExistingKinds)
      || !Array.isArray(slotValue.allowedOpenArchetypeRefs)) return false;
    const slotBindings = bindings.filter((binding) =>
      isRecord(binding) && binding.slotRef === slotValue.slotRef);
    if (slotBindings.length < Number(slotValue.minimum)
      || slotBindings.length > Number(slotValue.maximum)) return false;
  }
  for (const binding of bindings) {
    if (!isRecord(binding)
      || !isNonEmptyString(binding.slotRef)
      || !isNonEmptyString(binding.relationKind)
      || !isNonEmptyString(binding.entityRef)
      || !isNonEmptyString(binding.entityKind)) return false;
    const slot = slots.find((candidate) =>
      isRecord(candidate) && candidate.slotRef === binding.slotRef);
    if (!isRecord(slot)
      || slot.relationKind !== binding.relationKind
      || (binding.referenceKind === "existing" && !sourceRefs.includes(binding.entityRef as string))
      || premiseEntityKind(state, binding.entityRef) !== binding.entityKind) return false;
    if (binding.referenceKind === "existing") {
      if (!hasExactKeys(binding, [
        "entityKind", "entityRef", "referenceKind", "relationKind", "slotRef",
      ]) || !Array.isArray(slot.allowedExistingKinds)
        || !slot.allowedExistingKinds.includes(binding.entityKind)) return false;
      continue;
    }
    if (binding.referenceKind !== "openArchetype"
      || !hasExactKeys(binding, [
        "archetypeRef", "entityKind", "entityRef", "referenceKind", "relationKind", "slotRef",
      ])
      || !isNonEmptyString(binding.archetypeRef)
      || !sourceRefs.includes(binding.archetypeRef as string)
      || !Array.isArray(slot.allowedOpenArchetypeRefs)
      || !slot.allowedOpenArchetypeRefs.includes(binding.archetypeRef)) return false;
    const archetypeValue = moduleCatalogValue(
      state,
      binding.archetypeRef,
      "modulePremiseArchetype",
      "zhuwei.module-premise-archetype/v1",
    );
    const archetype = isRecord(archetypeValue?.archetype) ? archetypeValue.archetype : undefined;
    const definition = state.campaignRuntime.definitions[binding.entityRef];
    const content = isRecord(definition?.content) ? definition.content : undefined;
    if (archetype?.entityKind !== binding.entityKind
      || definition?.definitionKind !== (binding.entityKind === "person"
        ? "npc"
        : binding.entityKind === "organization"
          ? "organization"
          : binding.entityKind === "place"
            ? "location"
            : binding.entityKind === "object" ? "item" : "opportunity")
      || content?.sourceKind !== "characterPremiseOpenBlank"
      || content.premiseArchetypeRef !== binding.archetypeRef
      || content.relationKind !== binding.relationKind
      || (binding.entityKind === "person"
        && content.socialArchetypeRef !== archetype.socialArchetypeRef)) return false;
  }
  return bindings.every((binding) => isRecord(binding)
    && slots.some((slot) => isRecord(slot) && slot.slotRef === binding.slotRef));
}

function dynamicKnowledgeGrantMatchesState(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  fact: EventPayloadByType["ImprovisedActionResolved"]["fact"],
): boolean {
  if (fact === null
    || fact.kind !== "dynamicEntityKnowledgeGrant"
    || fact.source !== "dynamicMaterialization"
    || !isRecord(fact.value)
    || fact.value.schema !== "zhuwei.dynamic-entity-knowledge-grant/v1"
    || fact.value.characterRef !== actorCharacterId
    || !isNonEmptyString(fact.value.recipientEntityRef)
    || !isNonEmptyString(fact.value.sourcePremiseFactRef)
    || !isNonEmptyString(fact.value.assertionFactRef)
    || fact.subjectRefs.length !== 2
    || fact.subjectRefs[0] !== actorCharacterId
    || fact.subjectRefs[1] !== fact.value.recipientEntityRef
    || fact.visibilityPolicyId !== `visibility:knowledge-holder:${actorCharacterId}`
    || !isRecord(fact.value.relationAtom)) return false;
  const value = fact.value as JsonRecord;
  const premise = state.canonicalFacts[value.sourcePremiseFactRef as string];
  const assertionFact = state.canonicalFacts[value.assertionFactRef as string];
  return assertionFact?.kind === "typedAssertionFact"
    && isRecord(assertionFact.value)
    && assertionFact.value.sourcePremiseFactRef === value.sourcePremiseFactRef
    && premise?.kind === "characterPremise"
    && isRecord(premise.value)
    && Array.isArray(premise.value.bindings)
    && premise.value.bindings.some((binding) => isRecord(binding)
      && canonicalSha256(binding) === canonicalSha256(value.relationAtom));
}

function typedAssertionFactMatchesState(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  fact: EventPayloadByType["ImprovisedActionResolved"]["fact"],
): boolean {
  if (fact === null
    || fact.kind !== "typedAssertionFact"
    || fact.source !== "dynamicMaterialization"
    || fact.visibilityPolicyId !== `visibility:knowledge-holder:${actorCharacterId}`
    || !isRecord(fact.value)
    || !hasExactKeys(fact.value, [
      "assertion", "relationKind", "schema", "sourcePremiseFactRef",
    ])
    || fact.value.schema !== "zhuwei.typed-assertion-fact/v1"
    || !isNonEmptyString(fact.value.sourcePremiseFactRef)
    || !isNonEmptyString(fact.value.relationKind)
    || !isRecord(fact.value.assertion)
    || !hasExactKeys(fact.value.assertion, ["object", "polarity", "predicate", "subjectRef"])
    || fact.value.assertion.subjectRef !== actorCharacterId
    || fact.value.assertion.polarity !== "affirm"
    || !isRecord(fact.value.assertion.object)
    || !hasExactKeys(fact.value.assertion.object, ["ref", "referenceKind"])
    || fact.value.assertion.object.referenceKind !== "existing"
    || !isNonEmptyString(fact.value.assertion.object.ref)
    || fact.subjectRefs.length !== 2
    || fact.subjectRefs[0] !== actorCharacterId
    || fact.subjectRefs[1] !== fact.value.assertion.object.ref) return false;
  const value = fact.value as JsonRecord;
  const assertion = value.assertion as JsonRecord;
  const object = assertion.object as JsonRecord;
  const premise = state.canonicalFacts[value.sourcePremiseFactRef as string];
  if (premise?.kind !== "characterPremise"
    || !isRecord(premise.value)
    || !Array.isArray(premise.value.bindings)) return false;
  return premise.value.bindings.some((binding) => {
    if (!isRecord(binding)
      || binding.entityRef !== object.ref
      || binding.relationKind !== value.relationKind
      || !isNonEmptyString(binding.relationKind)) return false;
    const expectedPredicate = binding.relationKind === "affiliatedWith"
      ? "affiliatedWith"
      : binding.relationKind === "boundFor" || binding.relationKind === "seeksOrAssists"
        ? "intends"
        : binding.relationKind === "originatedFrom" ? "locatedAt" : "relatedTo";
    return assertion.predicate === expectedPredicate;
  });
}

type AppliedWorldInteractionDamage = Extract<
  AppliedWorldInteractionEffect,
  { kind: "damage" }
>;

function worldInteractionDamageEffectsWereCommitted(
  state: AuthoritativeWorldState,
  event: EventEnvelope<"WorldInteractionResolved">,
  effects: readonly AppliedWorldInteractionDamage[],
  socialFirstEventSeq?: string,
): boolean {
  const priorResolutionSeq = Object.values(state.correctionRuntime.audit).filter(entry=>entry.rootActionId===event.rootActionId&&entry.eventType==="WorldInteractionResolved").reduce((seq,entry)=>BigInt(entry.eventSeq)>seq?BigInt(entry.eventSeq):seq,0n);
  const audits = Object.values(state.correctionRuntime.audit)
    .filter(entry=>BigInt(entry.eventSeq)>priorResolutionSeq
      && (socialFirstEventSeq === undefined || BigInt(entry.eventSeq) >= BigInt(socialFirstEventSeq)))
    .filter((entry) => entry.rootActionId === event.rootActionId
      && entry.branchId === event.branchId);
  const packets = audits.filter((entry) => entry.eventType === "DamagePacketResolved");
  const hitPointChanges = audits.filter((entry) => entry.eventType === "HitPointsChanged");
  const deaths = audits.filter((entry) => entry.eventType === "CreatureDied");
  if (packets.length !== effects.length
    || hitPointChanges.length !== effects.filter(effect=>effect.damagePacketHash===undefined).length
    || deaths.length < effects.filter((effect) => effect.died).length) return false;

  const usedAuditRefs = new Set<string>();
  const lastEffectByTarget = new Map<string, AppliedWorldInteractionDamage>();
  const lastEffectSeqByTarget = new Map<string,bigint>();
  let previousEffectEventSeq = 0n;
  for (const effect of effects) {
    const target = state.entities[effect.targetRef];
    const previousForTarget = lastEffectByTarget.get(effect.targetRef);
    if (target?.hitPoints === undefined
      || effect.hpBefore < 0
      || Math.max(0, effect.hpBefore - (effect.hitPointDamage ?? effect.amount)) !== effect.hpAfter
      || (effect.damagePacketHash === undefined && effect.died !== (effect.hpAfter === 0))
      || (previousForTarget !== undefined && previousForTarget.hpAfter !== effect.hpBefore)) {
      return false;
    }
    const packet = matchingAudit(packets, usedAuditRefs, previousEffectEventSeq, effect.damagePacketHash ?? canonicalSha256({
      targetId: effect.targetRef,
      amount: effect.amount,
      damageType: effect.damageType,
      sourceDefinitionId: effect.sourceDefinitionRef,
    }));
    if (packet === undefined) return false;
    usedAuditRefs.add(packet.eventId);
    const hitPointChange = effect.damagePacketHash !== undefined ? packet : matchingAudit(
      hitPointChanges,
      usedAuditRefs,
      BigInt(packet.eventSeq),
      canonicalSha256({
        characterId: effect.targetRef,
        before: effect.hpBefore,
        after: effect.hpAfter,
        maximum: target.hitPoints.maximum,
        causeId: effect.sourceDefinitionRef,
      }),
    );
    if (hitPointChange === undefined) return false;
    usedAuditRefs.add(hitPointChange.eventId);
    let finalEventSeq = BigInt(hitPointChange.eventSeq);
    if (effect.died) {
      const death = matchingAudit(
        deaths,
        usedAuditRefs,
        finalEventSeq,
        canonicalSha256({
          characterId: effect.targetRef,
          causeId: effect.sourceDefinitionRef,
        }),
      );
      if (death === undefined) return false;
      usedAuditRefs.add(death.eventId);
      finalEventSeq = BigInt(death.eventSeq);
    }
    previousEffectEventSeq = finalEventSeq;
    lastEffectByTarget.set(effect.targetRef, effect);
    lastEffectSeqByTarget.set(effect.targetRef,finalEventSeq);
  }

  return [...lastEffectByTarget].every(([targetRef, effect]) => {
    // A later condition consequence can clamp HP or kill after this packet.
    // The existing correction audit freezes the character immediately before
    // that next write, so the damage receipt is checked at its own boundary.
    const subsequent = audits.filter(audit=>BigInt(audit.eventSeq)>lastEffectSeqByTarget.get(targetRef)!)
      .sort((a,b)=>BigInt(a.eventSeq)<BigInt(b.eventSeq)?-1:1)
      .flatMap(audit=>audit.effects.filter(change=>change.kind==="restoreCharacter"&&change.characterId===targetRef));
    const first=subsequent[0];
    const target = first?.kind==="restoreCharacter"?first.before:state.entities[targetRef];
    return target?.hitPoints?.current === effect.hpAfter
      && (effect.died ? target.tenureStatus === "dead" : target.tenureStatus === "active");
  });
}

function matchingAudit(
  audits: readonly AuthoritativeWorldState["correctionRuntime"]["audit"][string][],
  usedAuditRefs: ReadonlySet<string>,
  afterEventSeq: bigint,
  payloadHash: Sha256Ref,
): AuthoritativeWorldState["correctionRuntime"]["audit"][string] | undefined {
  return audits.find((entry) => !usedAuditRefs.has(entry.eventId)
    && BigInt(entry.eventSeq) > afterEventSeq
    && entry.payloadHash === payloadHash);
}

function clearAtomicSuspension(state: AuthoritativeWorldState, rootActionId: string): void {
  const prior = state.atomicWorldInteractions?.[rootActionId];
  if (prior?.waiting.kind === "input") delete state.combatRuntime.pendingInputs[String(prior.waiting.mirror.pendingInputId)];
  if (prior?.waiting.kind === "randomness") delete state.internalContinuations[prior.waiting.continuationId];
  if (state.atomicWorldInteractions !== undefined) delete state.atomicWorldInteractions[rootActionId];
}

/** Private fold: callers can only exercise it through step/replay. */
export function foldEvent(
  source: AuthoritativeWorldState,
  event: EventEnvelope,
): AuthoritativeWorldState {
  return foldEventInternal(source, event, false);
}

function frozenAtomicPlans(state: AuthoritativeWorldState, rootActionId: string) {
  const plans = Object.values(state.internalContinuations).filter(c => c.rootActionId === rootActionId)
    .flatMap(c => isAtomicWorldInteractionStepsPlan(c.resolutionPlan) ? [c.resolutionPlan] : []);
  const suspended = state.atomicWorldInteractions?.[rootActionId]?.plan;
  if (suspended) plans.push(suspended);
  const choice = frozenChoiceForRoot(state, rootActionId);
  const selected = choice === undefined ? undefined : selectedFrozenContinuation(choice);
  if (selected?.kind === "adjudication") plans.push(selected.plan);
  return plans;
}

/** The candidate mode uses the exact same domain reducer but deliberately
 * omits Receipt and spotlight publication. Its state and temporary events
 * never cross Rules.step; they exist only to prove a whole atomic branch
 * before the first authoritative random or committed effect. */
function foldEventInternal(
  source: AuthoritativeWorldState,
  event: EventEnvelope,
  candidate: boolean,
): AuthoritativeWorldState {
  const correctionEffects = correctionEffectsBefore(source, event);
  const firstEventForRoot = !(event.rootActionId in source.receipts);
  const state = structuredClone(source);
  const frozenChoice = frozenChoiceForRoot(source, event.rootActionId);
  if (frozenChoice?.selectedChoiceId === null && !["PlayerChoiceRequested", "PendingInputAnswered"].includes(event.eventType)) {
    throw new TypeError("frozen-choice:selection-required-before-effects");
  }

  switch (event.eventType) {
    case "FrozenPlayerChoicePrepared": {
      const { record } = event.payload as EventPayloadByType["FrozenPlayerChoicePrepared"];
      const refusalCosts: typeof record.refusalCosts = {};
      if (record.plan.rootActionId !== event.rootActionId || record.plan.profilesHash !== canonicalSha256(event.profiles)
        || event.secrecy !== "internal" || event.visibilityPolicyId !== "visibility:room-authority-only"
        || record.plan.pendingInputId in state.pendingInputs || event.rootActionId in state.receipts
        || frozenChoiceForRoot(state, event.rootActionId) !== undefined
        || !frozenChoiceReadSetMatches(state, record)
        || canonicalSha256(record.readSet) !== canonicalSha256(frozenChoiceReadSet(state, record.plan))
        || frozenPlayerChoiceIssue(event.profiles, state, record.plan, refusalCosts) !== undefined
        || canonicalSha256(record.refusalCosts) !== canonicalSha256(refusalCosts)) throw new TypeError("frozen-choice:invalid-prepared-plan");
      state.frozenPlayerChoices ??= {};
      state.frozenPlayerChoices[record.plan.pendingInputId] = structuredClone(record);
      break;
    }
    case "ActivityCompletionInputRecorded": {
      const payload = event.payload as EventPayloadByType["ActivityCompletionInputRecorded"];
      const activity = actionActivityForRoot(state, event.rootActionId);
      const issue = activityCompletionInputIssue(event.profiles, source, event.rootActionId, payload.input);
      if (issue !== undefined || activity?.activityId !== payload.activityId || event.secrecy !== "internal"
        || event.visibilityPolicyId !== "visibility:room-authority-only") throw new TypeError(issue ?? "activity:completion-input-not-bound");
      activity.completionInputInFlight = structuredClone(payload.input) as unknown as JsonRecord;
      const atomic = state.atomicWorldInteractions?.[event.rootActionId];
      if (atomic !== undefined) atomic.resumeAtEventSeq = event.eventSeq;
      break;
    }
    case "FrozenPlayerChoiceInputRecorded": {
      const { input } = event.payload as EventPayloadByType["FrozenPlayerChoiceInputRecorded"];
      const selected = frozenChoice === undefined ? undefined : selectedFrozenContinuation(frozenChoice);
      if (selected?.kind !== "adjudication" || frozenChoice?.inFlightInput !== null || event.secrecy !== "internal"
        || event.visibilityPolicyId !== "visibility:room-authority-only") throw new TypeError("frozen-choice:continuation-input-unavailable");
      if (frozenChoice.plan.profilesHash !== canonicalSha256(event.profiles) || !frozenChoiceReadSetMatches(source, frozenChoice))
        throw new TypeError("frozen-choice:continuation-basis-changed");
      const atomic = state.atomicWorldInteractions?.[event.rootActionId];
      if (atomic !== undefined) {
        if (!atomicContinuationCanResume(event.profiles, source, atomic)
          || (input.kind === "randomness" ? atomic.waiting.kind !== "randomness" || atomic.waiting.continuationId !== input.continuationId
            : atomic.waiting.kind !== "input" || atomic.waiting.mirror.pendingInputId !== input.pendingInputId))
          throw new TypeError("frozen-choice:continuation-input-not-bound");
        // This private input event changes no authority dependency. Keep the
        // already checked checkpoint resumable at its new journal position.
        atomic.resumeAtEventSeq = event.eventSeq;
      } else if (input.kind !== "randomness"
        || state.internalContinuations[input.continuationId]?.rootActionId !== event.rootActionId
        || canonicalSha256(state.internalContinuations[input.continuationId]?.resolutionPlan ?? null) !== canonicalSha256(selected.plan)) {
        throw new TypeError("frozen-choice:continuation-input-not-bound");
      }
      state.frozenPlayerChoices![frozenChoice.plan.pendingInputId].inFlightInput = structuredClone(input);
      break;
    }
    case "AtomicWorldInteractionSuspended": {
      const { continuation } = event.payload as EventPayloadByType["AtomicWorldInteractionSuspended"];
      if (state.atomicWorldInteractions === undefined || continuation.rootActionId !== event.rootActionId
        || continuation.resumeAtEventSeq !== event.eventSeq) throw new TypeError("atomic suspension checkpoint is not canonical");
      const activity = actionActivityForRoot(state, event.rootActionId);
      if (activity !== undefined) delete activity.completionInputInFlight;
      clearAtomicSuspension(state, event.rootActionId);
      state.atomicWorldInteractions[event.rootActionId] = structuredClone(continuation);
      if (frozenChoice !== undefined) state.frozenPlayerChoices![frozenChoice.plan.pendingInputId].inFlightInput = null;
      if (continuation.waiting.kind === "input") {
        const mirror = continuation.waiting.mirror;
        state.combatRuntime.pendingInputs[String(mirror.pendingInputId)] = structuredClone(mirror);
      }
      break;
    }
    case "AtomicWorldInteractionResumed": {
      const payload = event.payload as EventPayloadByType["AtomicWorldInteractionResumed"];
      if (payload.rootActionId !== event.rootActionId || state.atomicWorldInteractions?.[event.rootActionId] === undefined)
        throw new TypeError("atomic suspension is unavailable");
      clearAtomicSuspension(state, event.rootActionId);
      break;
    }
    case "AtomicWorldInteractionStepsResolved": {
      const payload = event.payload as EventPayloadByType["AtomicWorldInteractionStepsResolved"];
      if (!(payload.actorCharacterId in state.entities)) {
        throw new TypeError("atomic world-interaction actor does not exist");
      }
      if (state.receipts[event.rootActionId]?.proposalBundleSettlement) {
        throw new TypeError("atomic world-interaction bundle is already settled");
      }
      const selected = frozenChoice === undefined ? undefined : selectedFrozenContinuation(frozenChoice);
      if (frozenChoice !== undefined && (selected?.kind !== "adjudication"
        || canonicalSha256(payload.steps.map(step => ({ proposalRef: step.proposalRef, outcomeBinding: step.outcomeBinding })))
          !== canonicalSha256(selected.plan.steps.map(step => ({ proposalRef: step.proposalRef, outcomeBinding: step.outcomeBinding }))))) {
        throw new TypeError("frozen-choice:settlement-does-not-match-selection");
      }
      // A completion marker cannot release the pre-roll plan while its
      // unconditional history or holder grants are still missing.
      for (const plan of frozenAtomicPlans(state, event.rootActionId)) {
        for (const step of plan.steps) {
          if (step.rulesInput.kind !== "materializeSemanticDefinition" || step.rulesInput.plan.semanticKind !== "worldFact") continue;
          const expected = materializedSemanticDefinition(event.rootActionId, step.rulesInput.plan);
          const stored = state.campaignRuntime.definitions[expected.definitionRef];
          const fact = state.canonicalFacts[worldFactRef(expected.definitionRef)];
          const authored = expected.definition.content.worldFact;
          if (step.outcomeBinding !== "always" || !stored || canonicalSha256(stored) !== canonicalSha256(expected.definition)
            || !fact || !worldFactDefinition(state, fact) || !authoredWorldFactConform(authored)
            || authored.initialKnowledge.some(grant => {
              const held = state.knowledge[grant.holderRef]?.[fact.id];
              return !held || held.objectKind !== "canonicalFact" || held.layer !== "full"
                || canonicalSha256(held.content) !== canonicalSha256(worldFactPointer(expected.definition));
            })) throw new TypeError("world-fact:frozen-producer-incomplete");
        }
      }
      for(const [key,stored] of Object.entries(state.internalContinuations)) {
        if(stored.rootActionId===event.rootActionId&&isAtomicWorldInteractionStepsPlan(stored.resolutionPlan))delete state.internalContinuations[key];
      }
      if (frozenChoice !== undefined) delete state.frozenPlayerChoices![frozenChoice.plan.pendingInputId];
      break;
    }
    case "SemanticDefinitionRevised": {
      const payload = event.payload as EventPayloadByType["SemanticDefinitionRevised"];
      if (!(payload.actorCharacterId in state.entities)) {
        throw new TypeError("semantic definition revision actor does not exist");
      }
      const current = state.campaignRuntime.definitions[payload.definitionRef];
      const currentSnapshot = semanticDefinitionSnapshot(current);
      const nextSnapshot = semanticDefinitionSnapshot(payload.nextDefinition);
      if (currentSnapshot === undefined
        || nextSnapshot === undefined
        || !isRecord(current)
        || current.semanticKind !== payload.semanticKind
        || currentSnapshot.revision !== payload.baseRevision
        || currentSnapshot.definitionHash !== payload.baseHash
        || current.templateRef !== payload.templateRef
        || current.templateHash !== payload.templateHash
        || nextSnapshot.revision !== (BigInt(payload.baseRevision) + 1n).toString()
        || payload.nextDefinition.visibilityPolicyRef !== current.visibilityPolicyRef) {
        throw new TypeError("semantic definition revision does not continue its exact base");
      }
      state.campaignRuntime.definitions[payload.definitionRef] =
        structuredClone(payload.nextDefinition) as JsonRecord;
      if (payload.semanticKind === "npc") {
        const content = payload.nextDefinition.content;
        const links = isRecord(content.links) ? content.links : undefined;
        const entityRef = links?.entityRef;
        const entity = isNonEmptyString(entityRef) ? state.entities[entityRef] : undefined;
        if (entity?.kind !== "npc") {
          throw new TypeError("NPC semantic definition does not bind an authoritative NPC");
        }
        entity.semanticDefinitionRef = payload.definitionRef;
        entity.semanticDefinitionRevision = payload.nextDefinition.revision;
      }
      break;
    }
    case "KnowledgeReviewed":
      validateKnowledgeReviewedEvent(state, event);
      break;
    case "NarrativeDetailCommitted": {
      const payload = event.payload as EventPayloadByType["NarrativeDetailCommitted"];
      const actor = state.entities[payload.actorCharacterId];
      if (actor?.sceneId !== payload.detail.sceneRef || actor.tenureStatus !== "active"
        || payload.commitmentRef !== narrativeDetailRef(event.rootActionId, payload.proposalRef)
        || state.canonicalFacts[payload.commitmentRef] !== undefined
        || !payload.detail.audienceCharacterIds.includes(actor.id)
        || payload.detail.audienceCharacterIds.some(ref => state.entities[ref]?.sceneId !== actor.sceneId)
        || (payload.detail.audience === "actorOnly" && payload.detail.audienceCharacterIds.length !== 1)) {
        throw new TypeError("narrative detail identity, scene or audience is invalid");
      }
      state.canonicalFacts[payload.commitmentRef] = committedNarrativeFact(payload, {
        branchId: event.branchId, eventSeq: event.eventSeq, eventId: event.eventId,
      });
      break;
    }
    case "NarrativeDetailMaterialized": {
      bindNarrativeMaterialization(state, event.payload as EventPayloadByType["NarrativeDetailMaterialized"], {
        branchId: event.branchId, eventSeq: event.eventSeq, eventId: event.eventId,
      });
      break;
    }
    case "SemanticDefinitionMaterialized": {
      const payload = event.payload as EventPayloadByType["SemanticDefinitionMaterialized"];
      if (!(payload.actorCharacterId in state.entities)) {
        throw new TypeError("semantic definition materialization actor does not exist");
      }
      if (state.campaignRuntime.definitions[payload.definitionRef] !== undefined) {
        throw new TypeError("semantic definition materialization ref already exists");
      }
      if (["worldFact", "location", "passage"].includes(payload.semanticKind)) {
        if (state.receipts[event.rootActionId]?.proposalBundleSettlement) throw new TypeError("world-fact:bundle-already-settled");
        for (const plan of frozenAtomicPlans(state, event.rootActionId)) {
          const candidates = plan.steps.flatMap(step => step.rulesInput.kind === "materializeSemanticDefinition"
            && step.rulesInput.plan.semanticKind === payload.semanticKind
            && (payload.semanticKind !== "worldFact" || step.outcomeBinding === "always")
              ? [materializedSemanticDefinition(event.rootActionId, step.rulesInput.plan)] : []);
          const expected = candidates.find(candidate => candidate.definitionRef === payload.definitionRef);
          if (!expected || canonicalSha256(expected.definition) !== canonicalSha256(payload.definition)
            || expected.prospectiveRef !== payload.prospectiveRef) throw new TypeError("world-fact:frozen-producer-changed");
        }
      }
      const snapshot = semanticDefinitionSnapshot(payload.definition);
      if (snapshot === undefined || snapshot.revision !== "1") {
        throw new TypeError("semantic definition materialization payload is not canonical");
      }
      const dynamicIssue = dynamicMaterializationIssue(state, payload.actorCharacterId, payload.semanticKind,
        payload.definition.content, payload.basisRefs, payload.basisRefs);
      if (dynamicIssue !== undefined) throw new TypeError(dynamicIssue);
      applyDynamicLocation(state, payload.definition);
      state.campaignRuntime.definitions[payload.definitionRef] =
        structuredClone(payload.definition) as JsonRecord;
      break;
    }
    case "WorldInteractionFeasibilityRuled": {
      const payload = event.payload as EventPayloadByType["WorldInteractionFeasibilityRuled"];
      const selected = frozenChoice === undefined ? undefined : selectedFrozenContinuation(frozenChoice);
      if (frozenChoice !== undefined && (selected?.kind !== "inWorldRefusal"
        || payload.actorCharacterId !== selected.plan.actorCharacterId
        || canonicalSha256(payload.appliedCosts) !== canonicalSha256(frozenChoice.refusalCosts[frozenChoice.selectedChoiceId!])
        || payload.intent !== selected.plan.intent || payload.method !== selected.plan.method
        || payload.rulingKind !== selected.plan.rulingKind || payload.publicBasis !== selected.plan.publicBasis
        || canonicalSha256(payload.prerequisites) !== canonicalSha256(selected.plan.prerequisites)
        || canonicalSha256(payload.nextActions) !== canonicalSha256(selected.plan.nextActions))) throw new TypeError("frozen-choice:refusal-plan-changed");
      if (!(payload.actorCharacterId in state.entities)) {
        throw new TypeError("world interaction feasibility actor does not exist");
      }
      if (frozenChoice !== undefined) delete state.frozenPlayerChoices![frozenChoice.plan.pendingInputId];
      // Each applied cost is checked against the state its own transition
      // left behind: this summary event never spends anything itself, so a
      // ruling that claims a cost no earlier event actually paid must not
      // replay.
      for (const effect of payload.appliedCosts) {
        if (effect.kind === "fictionTimeCost") {
          const timeline = state.fictionTimelines[event.fictionTimelineId];
          if (timeline === undefined || timeline.nowMicros !== effect.nowMicrosAfter) {
            throw new TypeError("world interaction feasibility fiction time cost was not committed");
          }
          continue;
        }
        if (effect.kind === "resourceCost") {
          const resources = state.entities[payload.actorCharacterId]?.resources;
          if (resources === undefined || (resources[effect.resourceId] ?? 0) !== effect.amountAfter) {
            throw new TypeError("world interaction feasibility resource cost was not committed");
          }
          continue;
        }
        const entry = state.campaignRuntime.itemSystem.entries[effect.entryRef];
        if (entry === undefined
          || entry.quantity !== effect.quantityAfter
          || (entry.charges?.current ?? null) !== effect.chargesAfter
          || (entry.durability?.current ?? null) !== effect.durabilityAfter) {
          throw new TypeError("world interaction feasibility item cost was not committed");
        }
      }
      break;
    }
    case "ItemUniquenessBound": {
      const payload = event.payload as EventPayloadByType["ItemUniquenessBound"];
      const entry = state.campaignRuntime.itemSystem.entries[payload.entryRef];
      if (state.canonicalFacts[payload.basisRef] === undefined || entry?.definitionRef !== payload.definitionRef
        || entry.quantity !== 1 || payload.entryRef !== uniqueItemEntryRef(payload.basisRef)
        || state.vNextItemAuthority?.uniqueItems[payload.basisRef] !== undefined) {
        throw new TypeError("Unique item identity must bind one unused canonical source and its exact entry.");
      }
      const metadata = state.vNextItemAuthority ??= emptyVNextItemAuthority();
      metadata.uniqueItems[payload.basisRef] = structuredClone(payload);
      break;
    }
    case "ItemIdentified": {
      const payload = event.payload as EventPayloadByType["ItemIdentified"];
      const actor = state.entities[payload.characterId];
      const entry = state.campaignRuntime.itemSystem.entries[payload.entryRef];
      const definition = state.campaignRuntime.itemSystem.definitions[payload.definitionRef];
      const sceneId = entry?.disposition === "scene" ? entry.sceneRef : entry?.holderRef === null ? null : state.entities[entry?.holderRef ?? ""]?.sceneId;
      if (actor?.tenureStatus !== "active" || entry?.definitionRef !== payload.definitionRef
        || sceneId !== actor.sceneId || definition === undefined || canonicalSha256(definition) !== payload.definitionHash
        || !authoritySpatialRefVisibleTo(state, payload.entryRef, actor.sceneId, actor.id)
        || payload.basisRefs.some(ref => authorityRevisionOrHash(state, ref) === null)) {
        throw new TypeError("Item identification must refer to an available exact definition and causal basis.");
      }
      const metadata = state.vNextItemAuthority ??= emptyVNextItemAuthority();
      const grants = metadata.identifications[payload.characterId] ??= {};
      grants[payload.entryRef] = structuredClone(payload);
      break;
    }
    case "AuthoredMaterializationResolved": {
      const payload=event.payload as EventPayloadByType["AuthoredMaterializationResolved"];
      const exists=payload.kind==="itemEntry"?state.campaignRuntime.itemSystem.entries[payload.ref]
        :payload.kind==="itemDefinition"?state.campaignRuntime.itemSystem.definitions[payload.ref]
        :state.campaignRuntime.definitions[payload.ref];
      if(state.entities[payload.actorCharacterId]===undefined||exists===undefined)throw new TypeError("Authored materialization summary has no registered authority.");
      break;
    }
    case "WorldInteractionResolved": {
      const payload = event.payload as EventPayloadByType["WorldInteractionResolved"];
      if (!payload.social && hasCommittedSocialExpression(state, event as EventEnvelope<"WorldInteractionResolved">)) {
        throw new TypeError("social:settlement-marker-missing");
      }
      let socialFirstEventSeq: string | undefined;
      if (payload.social) {
        const source = state.internalContinuations[`continuation:${payload.resolutionId}`]?.resolutionPlan;
        const atomicSources = frozenAtomicPlans(state, event.rootActionId).filter(plan => plan.steps.some(step =>
          step.rulesInput.kind === "resolveWorldInteraction" && step.rulesInput.plan.resolutionId === payload.resolutionId));
        if (new Set(atomicSources.map(canonicalSha256)).size > 1) throw new TypeError("social:frozen-source-plan-ambiguous");
        const atomicSource = atomicSources[0];
        const sourceStep = atomicSource?.steps.find(step => step.rulesInput.kind === "resolveWorldInteraction"
          && step.rulesInput.plan.resolutionId === payload.resolutionId);
        const sourcePlan = sourceStep?.rulesInput.kind === "resolveWorldInteraction" ? sourceStep.rulesInput.plan
          : isWorldInteractionResolutionPlan(source) ? source : undefined;
        const verified = verifySocialSettlement(state, event.profiles, event as EventEnvelope<"WorldInteractionResolved">,
          sourcePlan, atomicSource, candidate);
        if (typeof verified === "string") throw new TypeError(verified);
        // Private candidate folding is not a publication certificate. A public
        // fold may exclude earlier native damage only after the frozen prefix
        // is proven here; without an anchor the original damage check remains.
        if (candidate || verified.prefixProven) socialFirstEventSeq = verified.firstEventSeq;
        state.campaignRuntime.conversationThreads ??= {};
        state.campaignRuntime.conversationThreads[payload.social.plan.social!.threadRef] = socialConversationRecord(state, event as EventEnvelope<"WorldInteractionResolved">);
      }
      const actor = state.entities[payload.actorCharacterId];
      const damageEffects = payload.appliedEffects.filter(
        (effect): effect is AppliedWorldInteractionDamage => effect.kind === "damage",
      );
      const damageEffectsWereCommitted = worldInteractionDamageEffectsWereCommitted(
        state,
        event as EventEnvelope<"WorldInteractionResolved">,
        damageEffects,
        socialFirstEventSeq,
      );
      if (!damageEffectsWereCommitted) {
        throw new TypeError("world interaction damage effects were not committed by this root action");
      }
      const actorDiedFromThisResolution = actor?.tenureStatus === "dead"
        && actor.hitPoints?.current === 0
        && damageEffectsWereCommitted
        && (damageEffects.some((effect) =>
          effect.targetRef === payload.actorCharacterId
          && effect.hpBefore > 0
          && effect.hpAfter === 0
          && effect.died
          && Math.max(0, effect.hpBefore - effect.amount) === effect.hpAfter)
          || Object.values(state.correctionRuntime.audit).some(audit=>audit.rootActionId===event.rootActionId
            && audit.eventType==="CreatureDied"&&audit.payloadHash===canonicalSha256({
              characterId:payload.actorCharacterId,causeId:event.rootActionId})));
      if (actor === undefined
        || actor.sceneId !== payload.sceneRef
        || (actor.tenureStatus !== "active" && !actorDiedFromThisResolution)) {
        throw new TypeError("world interaction actor is unavailable from its frozen scene");
      }
      if (payload.rulingKind === "check" && !candidate) {
        const continuationId = `continuation:${payload.resolutionId}`;
        const stored = state.internalContinuations[continuationId];
        const continuedPlan = stored === undefined
          ? undefined
          : isWorldInteractionResolutionPlan(stored.resolutionPlan)
            ? stored.resolutionPlan
            : isAtomicWorldInteractionStepsPlan(stored.resolutionPlan)
              ? atomicWorldInteractionCheckPlan(stored.resolutionPlan)
              : undefined;
        if (stored === undefined
          || continuedPlan === undefined
          || (!payload.social && worldInteractionPlanHash(continuedPlan) !== payload.planHash)
          || Boolean(continuedPlan.social) !== Boolean(payload.social)
          || stored.request.purpose !== "worldInteractionCheck") {
          throw new TypeError("world interaction continuation does not exist");
        }
        if (continuedPlan.social) {
          const dice = stored.committedDice, check = payload.check;
          const audit = dice && state.correctionRuntime.audit[dice.eventId];
          const count = stored.request.frozenCheck?.mode === "normal" ? 1 : 2;
          if (!dice || !check || !audit || audit.eventType !== "DiceRolled" || audit.rootActionId !== event.rootActionId
            || audit.branchId !== event.branchId || audit.payloadHash !== canonicalSha256(dice.payload)
            || BigInt(audit.eventSeq) >= BigInt(event.eventSeq)
            || dice.payload.randomnessId !== check.randomnessId || dice.payload.resolutionId !== payload.resolutionId
            || canonicalSha256(dice.payload.faces.slice(0, count)) !== canonicalSha256(check.rolls)
            || dice.payload.selectedFace !== check.selectedRoll) throw new TypeError("social:check-does-not-match-committed-dice");
        }
        if (!isAtomicWorldInteractionStepsPlan(stored.resolutionPlan)) delete state.internalContinuations[continuationId];
      } else if(payload.rulingKind === "directSuccess") {
        const key=`continuation:${payload.resolutionId}`;
        if(isWorldInteractionResolutionPlan(state.internalContinuations[key]?.resolutionPlan))delete state.internalContinuations[key];
      }
      for (const effect of payload.appliedEffects) {
        if (effect.kind === "passageTraversalStarted") {
          const activity = state.campaignRuntime.activities[effect.activityId];
          if (activity?.status !== "active" || activity.characterId !== payload.actorCharacterId
            || canonicalSha256(passageActivityBinding(activity)) !== canonicalSha256(effect.passage)) throw new TypeError("passage:activity-not-committed");
        } else if (effect.kind === "definitionRevision" || effect.kind === "relationTransition") {
          const definition = state.campaignRuntime.definitions[effect.definitionRef];
          if (!isRecord(definition)
            || definition.revision !== effect.toRevision
            || (effect.kind === "relationTransition"
              && (!isRecord(definition.content)
                || definition.content.state !== effect.toState))) {
            throw new TypeError("world interaction definition effect was not committed");
          }
        } else if (effect.kind === "itemCost") {
          const entry = state.campaignRuntime.itemSystem.entries[effect.entryRef];
          if (entry === undefined
            || entry.quantity !== effect.quantityAfter
            || (entry.charges?.current ?? null) !== effect.chargesAfter
            || (entry.durability?.current ?? null) !== effect.durabilityAfter) {
            throw new TypeError("world interaction item cost was not committed");
          }
        }
      }
      break;
    }
    case "ImprovisedActionResolved": {
      const payload = event.payload as EventPayloadByType["ImprovisedActionResolved"];
      if (!(payload.actorCharacterId in state.entities)) {
        throw new TypeError("improvised action actor does not exist");
      }
      if (payload.fact !== null) {
        if (payload.fact.kind === "characterPremise"
          && !characterPremiseFactMatchesState(state, payload.actorCharacterId, payload.fact)) {
          throw new TypeError("character premise does not match its pinned module policy");
        }
        if (payload.fact.kind === "dynamicEntityKnowledgeGrant"
          && !dynamicKnowledgeGrantMatchesState(state, payload.actorCharacterId, payload.fact)) {
          throw new TypeError("dynamic entity knowledge grant is not premise-bound");
        }
        if (payload.fact.kind === "typedAssertionFact"
          && !typedAssertionFactMatchesState(state, payload.actorCharacterId, payload.fact)) {
          throw new TypeError("typed assertion fact is not premise-bound");
        }
        if (payload.fact.id in state.canonicalFacts) {
          throw new TypeError("canonical fact already exists");
        }
        state.canonicalFacts[payload.fact.id] = {
          ...structuredClone(payload.fact),
          branchId: event.branchId,
          validFromEventSeq: event.eventSeq,
          causalParentIds: [...event.causalParentEventIds],
        };
      }
      break;
    }
    case "ClarificationRequested": {
      const payload = event.payload as EventPayloadByType["ClarificationRequested"];
      if (!(payload.actorCharacterId in state.entities)) {
        throw new TypeError("clarification controller does not exist");
      }
      state.pendingInputs[payload.pendingInputId] = {
        pendingInputId: payload.pendingInputId,
        kind: "clarification",
        rootActionId: event.rootActionId,
        controllerCharacterId: payload.actorCharacterId,
        question: payload.question,
        openedByEventId: event.eventId,
        visibility: "private",
      };
      break;
    }
    case "PlayerChoiceRequested": {
      const payload = event.payload as EventPayloadByType["PlayerChoiceRequested"];
      if (frozenChoice !== undefined && (!frozenChoicePublicBindingMatches(frozenChoice, payload)
        || payload.pendingInputId in state.pendingInputs || event.secrecy !== "private"
        || event.visibilityPolicyId !== `visibility:character-controller:${frozenChoice.plan.actorCharacterId}`))
        throw new TypeError("frozen-choice:public-options-changed");
      if (!(payload.actorCharacterId in state.entities)) {
        throw new TypeError("player choice controller does not exist");
      }
      state.pendingInputs[payload.pendingInputId] = {
        pendingInputId: payload.pendingInputId,
        kind: "playerChoice",
        rootActionId: event.rootActionId,
        controllerCharacterId: payload.actorCharacterId,
        question: payload.question,
        options: { choices: structuredClone(payload.choices) },
        openedByEventId: event.eventId,
        visibility: "private",
      };
      break;
    }
    case "SocialResolutionOffered": {
      const payload = event.payload as EventPayloadByType["SocialResolutionOffered"];
      const claim = state.campaignRuntime.sourceClaims[payload.claimRef];
      const actor = state.entities[payload.actorCharacterId];
      const npc = state.entities[payload.npcCharacterId];
      if (
        actor?.kind !== "player"
        || npc?.kind !== "npc"
        || !socialParticipantsCoPresent(state, actor, npc)
        || canonicalSha256(payload.plan) !== payload.planHash
        || payload.plan.rootActionId !== event.rootActionId
        || !socialResolutionPlanMatchesState(event.profiles, state, event.rootActionId, payload.plan)
        || claim?.speakerId !== payload.actorCharacterId
        || !isNonEmptyString(claim.semanticContent)
        || state.canonicalFacts[payload.plan.programFactRef]?.kind !== "causalActionProgram"
        || payload.pendingInputId in state.pendingInputs
        || state.campaignRuntime.conversationThreads?.[payload.threadRef] !== undefined
        || state.campaignRuntime.conversationThreads === undefined
      ) throw new TypeError("social resolution offer is not bound to available participants");
      state.pendingInputs[payload.pendingInputId] = {
        pendingInputId: payload.pendingInputId,
        kind: "socialResolution",
        rootActionId: event.rootActionId,
        controllerCharacterId: payload.actorCharacterId,
        question: payload.question,
        options: {
          npcCharacterId: payload.npcCharacterId,
          npcName: state.entities[payload.npcCharacterId].name,
          claimRef: payload.claimRef,
          threadRef: payload.threadRef,
          utteranceFingerprint: socialUtteranceFingerprint(
            claim.semanticContent,
          ),
          planHash: payload.planHash,
          plan: structuredClone(payload.plan),
          goal: payload.plan.frozenCheck.goal,
          method: payload.plan.frozenCheck.method,
          risk: payload.plan.frozenCheck.risk,
          successOutcome: payload.plan.frozenCheck.successOutcome,
          failureOutcome: payload.plan.frozenCheck.failureOutcome,
          dc: Number(payload.plan.frozenCheck.dc),
          retryGate: [...payload.plan.retryGate],
        },
        openedByEventId: event.eventId,
        visibility: "private",
      };
      state.campaignRuntime.conversationThreads[payload.threadRef] = {
        threadRef: payload.threadRef,
        actorCharacterId: payload.actorCharacterId,
        npcCharacterId: payload.npcCharacterId,
        claimRef: payload.claimRef,
        claimSemantics: structuredClone(payload.plan.claimSemantics),
        topicFingerprint: payload.plan.claimSemantics.topicFingerprint,
        claimKind: "sourceClaim",
        claimTruthStatus: "unresolved",
        resolution: "check",
        goal: payload.plan.frozenCheck.goal,
        method: payload.plan.frozenCheck.method,
        methodFingerprint: socialMethodFingerprint(payload.plan.frozenCheck),
        utterance: claim.semanticContent,
        utteranceFingerprint: socialUtteranceFingerprint(
          claim.semanticContent,
        ),
        sourceSceneId: payload.plan.sourceSceneId,
        evidenceRefs: [...payload.plan.frozenBoundary.mutuallyKnownEvidenceRefs],
        successResponse: structuredClone(payload.plan.successResponse),
        resistanceFingerprint: canonicalSha256({
          npcInsightModifier: payload.plan.frozenBoundary.npcInsightModifier,
          authorityModifier: payload.plan.frozenBoundary.authorityModifier,
          relationshipModifier: payload.plan.frozenBoundary.relationshipModifier,
          evidenceRefs: payload.plan.frozenBoundary.mutuallyKnownEvidenceRefs,
        }),
        positionFingerprint: socialPositionFingerprint(state, payload.actorCharacterId),
        maximumInfluenceDegree: payload.plan.maximumInfluenceDegree,
        planHash: payload.planHash,
        retryBaselineFictionMicros: event.fictionInstantMicros,
        status: "active",
        pendingInputId: payload.pendingInputId,
        updatedByEventId: event.eventId,
      };
      break;
    }
    case "PendingInputAnswered": {
      const payload = event.payload as EventPayloadByType["PendingInputAnswered"];
      const pending = state.pendingInputs[payload.pendingInputId];
      if (
        pending === undefined
        || !["clarification", "playerChoice", "socialResolution"].includes(pending.kind)
        || pending.rootActionId !== event.rootActionId
        || pending.controllerCharacterId !== payload.actorCharacterId
        || pending.openedByEventId !== payload.openedByEventId
      ) {
        throw new TypeError("pending answer does not match the open clarification");
      }
      const choice = state.frozenPlayerChoices?.[payload.pendingInputId];
      if (choice !== undefined) {
        const option = choice.plan.choices.find(option => option.choiceId === payload.answer.choiceId);
        if (choice.selectedChoiceId !== null || !hasExactKeys(payload.answer, ["choiceId"])
          || option === undefined || (option.continuation.kind !== "cancel" && !frozenChoiceReadSetMatches(source, choice)))
          throw new TypeError("frozen-choice:answer-not-bound");
        choice.selectedChoiceId = String(payload.answer.choiceId);
        if (selectedFrozenContinuation(choice)?.kind === "cancel") delete state.frozenPlayerChoices![payload.pendingInputId];
      }
      delete state.pendingInputs[payload.pendingInputId];
      break;
    }
    case "SocialResolutionDeclined": {
      const payload = event.payload as EventPayloadByType["SocialResolutionDeclined"];
      const threads = state.campaignRuntime.conversationThreads;
      const prior = legacySocialThread(state, payload.threadRef);
      if (threads === undefined
        || prior?.actorCharacterId !== payload.actorCharacterId
        || prior.npcCharacterId !== payload.npcCharacterId
        || prior.claimRef !== payload.claimRef
        || prior.pendingInputId !== payload.pendingInputId) {
        throw new TypeError("social decline does not match its conversation thread");
      }
      threads[payload.threadRef] = {
        ...structuredClone(prior),
        status: payload.disposition,
        pendingInputId: null,
        ...(payload.reason === "acceptedStatusQuo"
          ? { retryBaselineFictionMicros: event.fictionInstantMicros }
          : {}),
        outcome: payload.outcome,
        updatedByEventId: event.eventId,
      };
      break;
    }
    case "SocialDirectResolved": {
      const payload = event.payload as EventPayloadByType["SocialDirectResolved"];
      const threads = state.campaignRuntime.conversationThreads;
      const claim = state.campaignRuntime.sourceClaims[payload.claimRef];
      const actor = state.entities[payload.actorCharacterId];
      const npc = state.entities[payload.npcCharacterId];
      const response = payload.plan.successResponse;
      const addressed = payload.addressedThreadRef === null
        ? undefined
        : legacySocialThread(state, payload.addressedThreadRef);
      if (threads === undefined
        || actor?.kind !== "player"
        || npc?.kind !== "npc"
        || !socialParticipantsCoPresent(state, actor, npc)
        || payload.planHash !== canonicalSha256(payload.plan)
        || !socialResolutionPlanMatchesState(
          event.profiles,
          state,
          event.rootActionId,
          payload.plan,
        )
        || canonicalSha256(payload.claimSemantics) !== canonicalSha256(payload.plan.claimSemantics)
        || payload.responseMode !== response.mode
        || payload.responseReaction !== response.reactionKind
        || payload.responseMinimumDegree !== response.minimumDegree
        || canonicalSha256(payload.sourceRefs) !== canonicalSha256(response.sourceRefs)
        || claim?.speakerId !== payload.actorCharacterId
        || !isNonEmptyString(claim.semanticContent)
        || (payload.responseClaimRef === null
          ? payload.responseMode !== "reaction" || payload.responseReaction !== "silence"
          : state.campaignRuntime.sourceClaims[payload.responseClaimRef]?.speakerId
              !== payload.npcCharacterId
            || state.campaignRuntime.sourceClaims[payload.responseClaimRef]?.semanticContent
              !== response.speech)
        || !socialResponseReferencesAvailable(
          state,
          payload.npcCharacterId,
          payload.responseMode,
          payload.sourceRefs,
        )
        || payload.threadDisposition !== directSocialThreadDisposition(
          payload.responseMode,
          payload.responseReaction,
        )
        || (payload.addressedThreadRef !== null
          && (payload.addressedThreadRef === payload.threadRef
            || addressed?.actorCharacterId !== payload.actorCharacterId
            || addressed.npcCharacterId !== payload.npcCharacterId
            || addressed.status !== "active"
            || addressed.topicFingerprint !== payload.claimSemantics.topicFingerprint))
        || payload.threadRef in threads) {
        throw new TypeError("direct social result requires available participants");
      }
      if (payload.addressedThreadRef !== null && addressed !== undefined) {
        const addressedStatus = payload.responseMode === "reaction"
          && (payload.responseReaction === "redirect"
            || payload.responseReaction === "acknowledge")
          ? "deemphasized" as const
          : "active" as const;
        threads[payload.addressedThreadRef] = {
          ...structuredClone(addressed),
          status: addressedStatus,
          pendingInputId: null,
          outcome: payload.immediateBehavior,
          updatedByEventId: event.eventId,
        };
      }
      threads[payload.threadRef] = {
        threadRef: payload.threadRef,
        actorCharacterId: payload.actorCharacterId,
        npcCharacterId: payload.npcCharacterId,
        claimRef: payload.claimRef,
        claimSemantics: structuredClone(payload.claimSemantics),
        topicFingerprint: payload.claimSemantics.topicFingerprint,
        responseClaimRef: payload.responseClaimRef,
        responseMode: payload.responseMode,
        responseReaction: payload.responseReaction,
        responseMinimumDegree: payload.responseMinimumDegree,
        responseSourceRefs: [...payload.sourceRefs],
        addressedThreadRef: payload.addressedThreadRef,
        sourceRefs: [...payload.sourceRefs],
        claimKind: "sourceClaim",
        claimTruthStatus: "unresolved",
        resolution: "direct",
        goal: payload.claimSemantics.desiredBehavior,
        utterance: claim.semanticContent,
        sourceSceneId: state.entities[payload.actorCharacterId].sceneId,
        status: payload.threadDisposition,
        pendingInputId: null,
        immediateBehavior: payload.immediateBehavior,
        outcome: payload.outcome,
        updatedByEventId: event.eventId,
      };
      break;
    }
    case "SocialCheckResolved": {
      const payload = event.payload as EventPayloadByType["SocialCheckResolved"];
      const threads = state.campaignRuntime.conversationThreads;
      const prior = legacySocialThread(state, payload.threadRef);
      const actor = state.entities[payload.actorCharacterId];
      const npc = state.entities[payload.npcCharacterId];
      const frozenResponse = isRecord(prior?.successResponse)
        ? prior.successResponse
        : undefined;
      const addressed = payload.addressedThreadRef === null
        ? undefined
        : legacySocialThread(state, payload.addressedThreadRef);
      if (threads === undefined
        || prior?.actorCharacterId !== payload.actorCharacterId
        || prior.npcCharacterId !== payload.npcCharacterId
        || prior.claimRef !== payload.claimRef
        || actor?.kind !== "player"
        || npc?.kind !== "npc"
        || !isNpcSocialMechanics(npc.socialMechanics)
        || !socialParticipantsCoPresent(state, actor, npc)
        || frozenResponse === undefined
        || payload.responseMinimumDegree !== frozenResponse.minimumDegree
        || payload.responseReaction !== (payload.responseReached === false
          ? null
          : frozenResponse.reactionKind)
        || (payload.responseReached === false
          ? payload.responseMode !== null || payload.responseSourceRefs.length !== 0
          : payload.responseMode !== frozenResponse.mode
            || canonicalSha256(payload.responseSourceRefs)
              !== canonicalSha256(frozenResponse.sourceRefs)
            || (payload.responseClaimRef === null
              ? frozenResponse.reactionKind !== "silence"
              : state.campaignRuntime.sourceClaims[payload.responseClaimRef]?.semanticContent
                !== (frozenResponse.mode === "reaction"
                  ? socialCheckReactionSpeech(
                      payload.degree as Extract<typeof payload.degree,
                      "limitedSuccess" | "fullSuccess" | "strongSuccess">,
                      prior.claimSemantics.influenceGoal,
                    )
                  : frozenResponse.speech)))
        || prior.claimSemantics?.addressedThreadRef !== payload.addressedThreadRef
        || (payload.responseClaimRef !== null
          && state.campaignRuntime.sourceClaims[payload.responseClaimRef]?.speakerId
            !== payload.npcCharacterId)
        || (payload.responseMode !== null
          && !socialResponseReferencesAvailable(
            state,
            payload.npcCharacterId,
            payload.responseMode,
            payload.responseSourceRefs,
          ))
        || (payload.responseMode !== null
          && !socialCheckResponseAllowed(prior.claimSemantics.influenceGoal, {
            mode: payload.responseMode,
            reactionKind: payload.responseReaction,
          }))
        || (payload.addressedThreadRef !== null
          && (payload.addressedThreadRef === payload.threadRef
            || addressed?.actorCharacterId !== payload.actorCharacterId
            || addressed.npcCharacterId !== payload.npcCharacterId
            || addressed.status !== "active"
            || addressed.topicFingerprint !== prior.topicFingerprint))
        || payload.relationshipScore
          !== payload.relationshipBefore + payload.relationshipDelta
        || currentSocialTrust(state, actor, {
          ...npc,
          socialMechanics: npc.socialMechanics,
        }) !== payload.relationshipScore) {
        throw new TypeError("social result does not match its conversation thread");
      }
      if (payload.addressedThreadRef !== null
        && payload.addressedThreadDisposition !== null
        && addressed !== undefined) {
        threads[payload.addressedThreadRef] = {
          ...structuredClone(addressed),
          status: payload.addressedThreadDisposition,
          pendingInputId: null,
          outcome: payload.immediateBehavior,
          updatedByEventId: event.eventId,
        };
      }
      threads[payload.threadRef] = {
        ...structuredClone(prior),
        status: payload.threadDisposition,
        pendingInputId: null,
        degree: payload.degree,
        marginDegree: payload.marginDegree,
        maximumInfluenceDegree: payload.maximumInfluenceDegree,
        margin: payload.margin,
        addressedThreadRef: payload.addressedThreadRef,
        responseClaimRef: payload.responseClaimRef,
        responseReached: payload.responseReached,
        responseMode: payload.responseMode,
        responseReaction: payload.responseReaction,
        responseMinimumDegree: payload.responseMinimumDegree,
        responseSourceRefs: [...payload.responseSourceRefs],
        resistanceFingerprint: socialResistanceFingerprint(
          state,
          actor,
          { ...npc, socialMechanics: npc.socialMechanics },
          Array.isArray(prior.evidenceRefs) ? prior.evidenceRefs.filter(isNonEmptyString) : [],
        ),
        positionFingerprint: socialPositionFingerprint(state, payload.actorCharacterId),
        immediateBehavior: payload.immediateBehavior,
        relationshipScore: payload.relationshipScore,
        retryBaselineFictionMicros: event.fictionInstantMicros,
        outcome: payload.outcome,
        updatedByEventId: event.eventId,
      };
      break;
    }
    case "NpcMaterialized": {
      applyNpcMaterializedEvent(state, event as EventEnvelope<"NpcMaterialized">);
      break;
    }
    case "DynamicEntityMaterialized": {
      const payload = event.payload as EventPayloadByType["DynamicEntityMaterialized"];
      const sourceFacts = payload.sourceFactIds.map((factId) => state.canonicalFacts[factId]);
      const definition = state.campaignRuntime.definitions[payload.definitionId];
      const content = isRecord(definition?.content) ? definition.content : undefined;
      const socialMechanics = dynamicNpcSocialMechanics(payload.socialArchetypeRef);
      const premiseBindsEntity = sourceFacts.some((fact) => {
        if (fact?.kind === "dynamicEntityKnowledgeGrant" && isRecord(fact.value)) {
          return fact.value.schema === "zhuwei.dynamic-entity-knowledge-grant/v1"
            && fact.value.recipientEntityRef === payload.entityId;
        }
        const bindings = fact?.kind === "characterPremise"
          && isRecord(fact.value)
          && fact.value.schema === "zhuwei.character-premise/v2"
          && Array.isArray(fact.value.bindings)
          ? fact.value.bindings
          : [];
        return bindings.some((entry) => isRecord(entry)
          && entry.referenceKind === "openArchetype"
          && entry.entityRef === payload.entityId);
      });
      const genericBindsEntity = payload.entityId === payload.definitionId
        && sourceFacts.some((fact) => fact?.kind === "dynamic:npc"
          && isRecord(fact.value)
          && fact.value.definitionRef === payload.definitionId
          && fact.value.kind === "npc");
      const premiseDefinitionValid = premiseBindsEntity
        && content?.schema === "zhuwei.dynamic-npc-definition/v1"
        && content.entityId === payload.entityId
        && isNonEmptyString(content.premiseArchetypeRef)
        && state.canonicalFacts[content.premiseArchetypeRef]?.kind === "modulePremiseArchetype"
        && content.socialArchetypeRef === payload.socialArchetypeRef
        && content.status === "definedOffstage";
      const genericDefinitionValid = genericBindsEntity
        && payload.socialArchetypeRef === DYNAMIC_NPC_DEFAULT_SOCIAL_ARCHETYPE_REF;
      const initialKnowledgeAuthorized = payload.initialKnowledgeFactIds.every((factId) => {
        const fact = state.canonicalFacts[factId];
        const assertionFactRef = isRecord(fact?.value) ? fact.value.assertionFactRef : undefined;
        const assertionFact = isNonEmptyString(assertionFactRef)
          ? state.canonicalFacts[assertionFactRef]
          : undefined;
        return fact?.kind === "dynamicEntityKnowledgeGrant"
          && isRecord(fact.value)
          && fact.value.schema === "zhuwei.dynamic-entity-knowledge-grant/v1"
          && fact.value.recipientEntityRef === payload.entityId
          && assertionFact?.kind === "typedAssertionFact"
          && isRecord(assertionFact.value)
          && assertionFact.value.schema === "zhuwei.typed-assertion-fact/v1";
      });
      if (state.scenes[payload.sceneId] === undefined
        || state.entities[payload.entityId] !== undefined
        || state.fictionTimelines[payload.sourceTimelineId] === undefined
        || event.fictionTimelineId !== payload.sourceTimelineId
        || sourceFacts.some((fact) => fact === undefined)
        || (!premiseDefinitionValid && !genericDefinitionValid)
        || !initialKnowledgeAuthorized
        || definition?.definitionKind !== "npc"
        || !isNonEmptyString(content?.name)
        || (content.publicExpression !== undefined && !publicExpressionConform(content.publicExpression))
        || socialMechanics === undefined
        || canonicalSha256(socialMechanics) !== payload.socialMechanicsHash) {
        throw new TypeError("dynamic NPC materialization is not bound to an established source");
      }
      const nextOrdinal = Object.values(state.entities)
        .reduce((maximum, entry) => Math.max(maximum, Number(entry.entityOrdinal)), 0) + 1;
      state.entities[payload.entityId] = {
        id: payload.entityId,
        kind: "npc",
        name: content.name,
        ...(publicExpressionConform(content.publicExpression) ? { publicExpression: structuredClone(content.publicExpression) } : {}),
        sceneId: payload.sceneId,
        tenureStatus: "active",
        entityOrdinal: String(nextOrdinal),
        abilityScores: structuredClone(socialMechanics.abilityScores),
        proficiencyBonus: socialMechanics.proficiencyBonus,
        socialMechanics,
      };
      state.knowledge[payload.entityId] = {};
      state.multiplayerRuntime.characterTimelineIds[payload.entityId] = payload.sourceTimelineId;
      break;
    }
    case "RandomnessRequested": {
      const payload = event.payload as EventPayloadByType["RandomnessRequested"];
      const selected = frozenChoice === undefined ? undefined : selectedFrozenContinuation(frozenChoice);
      // Native and choice-dependent random requests use their native schemas.
      // Replay proves their complete source segment with the same executor;
      // only an explicitly supplied top-level plan must match here.
      if (frozenChoice !== undefined && (selected?.kind !== "adjudication" || ("resolutionPlan" in payload
        && canonicalSha256(payload.resolutionPlan) !== canonicalSha256(selected.plan)))) throw new TypeError("frozen-choice:randomness-plan-changed");
      if ("resolution" in payload) {
        const resolution = payload.resolution;
        state.combatRuntime.randomnessResolutions[String(resolution.resolutionId)] = structuredClone(resolution);
        break;
      }
      if ("resolutionPlan" in payload
        && (isWorldInteractionResolutionPlan(payload.resolutionPlan)
          || isAtomicWorldInteractionStepsPlan(payload.resolutionPlan))
        && !isWorldInteractionRandomnessEventBinding(state, event.rootActionId, payload)) {
        throw new TypeError("world interaction randomness request is not bound to its frozen plan");
      }
      state.internalContinuations[payload.continuation.continuationId] = {
        continuation: structuredClone(payload.continuation),
        rootActionId: event.rootActionId,
        request: structuredClone(payload.request),
        ...(!("resolutionPlan" in payload)
          ? {}
          : { resolutionPlan: structuredClone(payload.resolutionPlan) }),
      };
      break;
    }
    case "DiceRolled": {
      const payload=event.payload as EventPayloadByType["DiceRolled"];
      const stored=state.internalContinuations[`continuation:${payload.resolutionId}`];
      if(stored?.request.purpose==="worldInteractionCheck") {
        const request=stored.request;
        if(payload.requestHash!==request.requestHash || payload.frozenParametersHash!==canonicalSha256(request.frozenParameters)
          || payload.formula!==request.diceExpression || !worldInteractionDiceValid(request.dice,payload.faces)) throw new TypeError("world interaction dice are not bound to the frozen authority request");
        const selected=request.frozenCheck===null?null:request.frozenCheck.mode==="advantage"?Math.max(...payload.faces.slice(0,2)):request.frozenCheck.mode==="disadvantage"?Math.min(...payload.faces.slice(0,2)):payload.faces[0];
        if(payload.selectedFace!==selected)throw new TypeError("world interaction selected a face outside its check");
        if (stored.committedDice) throw new TypeError("world interaction randomness was already committed");
        stored.committedDice = { eventId: event.eventId, payload: structuredClone(payload) };
      }
      break;
    }
    case "HiddenRealityCandidatesFrozen":
      break;
    case "HiddenRealityMaterialized": {
      const continuationId = `continuation:resolution:${event.rootActionId}:hidden-reality`;
      delete state.internalContinuations[continuationId];
      break;
    }
    case "ImprovisedCheckResolved": {
      const payload = event.payload as EventPayloadByType["ImprovisedCheckResolved"];
      const continuationId = `continuation:${payload.request.resolutionId}`;
      if (!(continuationId in state.internalContinuations)) {
        throw new TypeError("randomness continuation does not exist");
      }
      delete state.internalContinuations[continuationId];
      break;
    }
    case "ContestResolved": {
      const payload = event.payload as EventPayloadByType["ContestResolved"];
      for (const continuationId of payload.continuationIds) {
        if (!(continuationId in state.internalContinuations)) {
          throw new TypeError("contest randomness continuation does not exist");
        }
        delete state.internalContinuations[continuationId];
      }
      break;
    }
    case "KnowledgeAcquired": {
      const payload = event.payload as EventPayloadByType["KnowledgeAcquired"];
      if ("items" in payload) {
        if (!(payload.characterId in state.entities) || !(payload.sourceCharacterId in state.entities)) {
          throw new TypeError("knowledge batch recipient or source does not exist");
        }
        const entries = knowledgeFor(state, payload.characterId);
        if (worldInteractionProfileEnabled(event.profiles.extensions)) {
          const unique = new Set<string>();
          if (event.secrecy !== "private" || event.visibilityPolicyId !== `visibility:knowledge-holder:${payload.characterId}`
            || payload.items.some(item => {
              const source = heldKnowledgeRecord(state, payload.sourceCharacterId, item.knowledgeRef);
              if (!source || unique.has(item.knowledgeRef) || Object.hasOwn(entries, item.knowledgeRef)
                || source.objectKind !== item.objectKind || !knowledgeLayerCanBeShared(source.layer, payload.contentLayer)
                || canonicalSha256(source.content) !== canonicalSha256(item.content)
                || canonicalSha256([...source.provenanceChain].sort()) !== canonicalSha256([...item.provenanceChain].sort())) return true;
              unique.add(item.knowledgeRef); return false;
            })) throw new TypeError("Shared knowledge must preserve an actual holder's content, layer, provenance and private recipient.");
        }
        for (const item of payload.items) {
          entries[item.knowledgeRef] = {
            characterId: payload.characterId,
            knowledgeRef: item.knowledgeRef,
            objectKind: item.objectKind,
            layer: payload.contentLayer,
            content: structuredClone(item.content),
            visibility: "shared",
            acquiredByEventId: event.eventId,
            acquiredAtFictionMicros: event.fictionInstantMicros,
            sourceCharacterId: payload.sourceCharacterId,
            provenanceChain: [...item.provenanceChain, event.eventId],
          };
        }
        break;
      }
      if (!(payload.characterId in state.entities) || !(payload.causeFactId in state.canonicalFacts)) {
        throw new TypeError("knowledge acquisition reference is not available");
      }
      if (payload.storyAdmission !== undefined || isRecord(payload.content) && payload.content.schema === "zhuwei.story-knowledge-body/v1") {
        const issue = storyKnowledgeAdmissionIssue(state, payload, event.rootActionId);
        if (issue || event.secrecy !== "private" || event.visibilityPolicyId !== `visibility:knowledge-holder:${payload.characterId}`) {
          throw new TypeError(issue ?? "story-admission:private-holder-projection-required");
        }
      }
      if (isWorldFactPointer(payload.content)) {
        const fact = state.canonicalFacts[payload.causeFactId];
        const definition = fact && worldFactDefinition(state, fact);
        const authored = definition?.content.worldFact;
        const grant = authoredWorldFactConform(authored) && authored.initialKnowledge.find(k => k.holderRef === payload.characterId);
        if (!definition || !grant || payload.knowledgeRef !== fact.id || payload.objectKind !== "canonicalFact"
          || payload.layer !== "full" || payload.visibility !== "private" || event.secrecy !== "private"
          || event.visibilityPolicyId !== `visibility:knowledge-holder:${payload.characterId}`
          || canonicalSha256(payload.content) !== canonicalSha256(worldFactPointer(definition))
          || payload.acquisition.method !== grant.acquisitionExplanation) throw new TypeError("world-fact:knowledge-grant-mismatch");
      }
      const entries = knowledgeFor(state, payload.characterId);
      if (payload.knowledgeRef in entries) {
        throw new TypeError("knowledge is already held");
      }
      entries[payload.knowledgeRef] = {
        characterId: payload.characterId,
        knowledgeRef: payload.knowledgeRef,
        objectKind: payload.objectKind,
        layer: payload.layer,
        content: structuredClone(payload.content),
        visibility: payload.visibility,
        acquiredByEventId: event.eventId,
        acquiredAtFictionMicros: event.fictionInstantMicros,
        sourceCharacterId: payload.sourceCharacterId ?? null,
        provenanceChain: [...new Set([payload.causeFactId, ...(payload.storyAdmission ? [payload.storyAdmission.sourceRef] : []), event.eventId])],
      };
      break;
    }
    case "KnowledgeShared": {
      const payload = event.payload as EventPayloadByType["KnowledgeShared"];
      const source = state.knowledge[payload.sourceCharacterId]?.[payload.sourceKnowledgeRef];
      const channel = state.canonicalFacts[payload.medium.factId];
      if (source === undefined || channel === undefined) {
        throw new TypeError("knowledge share source or medium is not available");
      }
      for (const recipientCharacterId of payload.recipientCharacterIds) {
        if (!(recipientCharacterId in state.entities)) {
          throw new TypeError("knowledge share recipient does not exist");
        }
        const entries = knowledgeFor(state, recipientCharacterId);
        entries[payload.sourceKnowledgeRef] = {
          characterId: recipientCharacterId,
          knowledgeRef: payload.sourceKnowledgeRef,
          objectKind: source.objectKind,
          layer: source.layer,
          content: structuredClone(payload.sharedContent),
          visibility: "shared",
          acquiredByEventId: event.eventId,
          acquiredAtFictionMicros: event.fictionInstantMicros,
          sourceCharacterId: payload.sourceCharacterId,
          provenanceChain: [...source.provenanceChain, event.eventId],
        };
      }
      break;
    }
    case "CharacterControlTransferred": {
      const payload = event.payload as EventPayloadByType["CharacterControlTransferred"];
      const control = state.characterControls[payload.characterId];
      if (control?.seatId !== payload.fromSeatId || !(payload.toSeatId in state.seats)) {
        throw new TypeError("character control transfer is not legal");
      }
      state.characterControls[payload.characterId] = {
        characterId: payload.characterId,
        seatId: payload.toSeatId,
      };
      if (state.multiplayerRuntime.spotlightLedger[payload.characterId] !== undefined) {
        state.multiplayerRuntime.spotlightLedger[payload.characterId].seatId = payload.toSeatId;
      }
      break;
    }
    case "CharacterRetired": {
      const payload = event.payload as EventPayloadByType["CharacterRetired"];
      const character = state.entities[payload.characterId];
      const control = state.characterControls[payload.characterId];
      if (character === undefined || control?.seatId !== payload.controllingSeatId) {
        throw new TypeError("character retirement is not legal");
      }
      endCharacterTenure(
        state,
        payload.characterId,
        payload.continueAsNpc === true ? "npcTransitioned" : "retired",
        "characterTenureEnded",
      );
      break;
    }
    case "SuccessorIntroduced": {
      const payload = event.payload as EventPayloadByType["SuccessorIntroduced"];
      const predecessor = state.entities[payload.predecessorCharacterId];
      if (
        predecessor === undefined
        || !["dead", "retired", "missing", "npcTransitioned"].includes(predecessor.tenureStatus)
        || payload.successor.id in state.entities
        || state.seats[payload.controllerSeatId]?.status !== "active"
        || predecessor.lastControllerSeatId !== payload.controllerSeatId
        || Object.values(state.characterControls).some((control) =>
          control.seatId === payload.controllerSeatId)
      ) {
        throw new TypeError("successor introduction is not legal");
      }
      state.entities[payload.successor.id] = structuredClone(payload.successor);
      state.characterControls[payload.successor.id] = {
        characterId: payload.successor.id,
        seatId: payload.controllerSeatId,
      };
      state.knowledge[payload.successor.id] = {};
      const primarySceneId = String(
        state.multiplayerRuntime.causalFrontiers[state.activeBranchId]?.sceneId ?? "",
      );
      const timelineId = payload.successor.sceneId === primarySceneId
        ? state.activeBranchId
        : fictionTimelineIdForScene(state.activeBranchId, payload.successor.sceneId);
      const branchTimeline = state.fictionTimelines[state.activeBranchId];
      if (branchTimeline === undefined) throw new TypeError("successor branch timeline is unavailable");
      state.fictionTimelines[timelineId] ??= {
        branchId: state.activeBranchId,
        nowMicros: branchTimeline.nowMicros,
      };
      state.multiplayerRuntime.characterTimelineIds[payload.successor.id] = timelineId;
      state.multiplayerRuntime.causalFrontiers[timelineId] ??= {
        timelineId,
        sceneId: payload.successor.sceneId,
        branchId: state.activeBranchId,
        nowMicros: state.fictionTimelines[timelineId].nowMicros,
        eventHeadId: event.eventId,
        causalParentTimelineIds: [state.activeBranchId],
      };
      state.multiplayerRuntime.spotlightLedger[payload.successor.id] = {
        characterId: payload.successor.id,
        seatId: payload.controllerSeatId,
        decisionBeats: "0",
        invited: false,
        lastInvitedBeat: null,
        explicitSkips: "0",
        sceneId: payload.successor.sceneId,
      };
      applyCharacterMechanicsSnapshot(
        state,
        payload.successor.id,
        payload.combatEntity,
        payload.definitions,
      );
      break;
    }
    default:
      if (event.eventType === "DefinitionRegistered") {
        // Definition registration is deliberately shared: the campaign catalog
        // owns the canonical/dynamic definition and location materialization,
        // while combat keeps the exact frozen definition used by its compiler.
        // Short-circuit dispatch would otherwise leave one of those two
        // authority views stale and make replay diverge from the transaction.
        if (!applyCombatEvent(state, event) || !applyCampaignEvent(state, event)) {
          throw new TypeError("definition registration did not reach every authoritative catalog");
        }
        break;
      }
      if (
        !applyNpcWorkEvent(state, event)
        && !applyPromiseLifecycleEvent(state, event)
        && !applyEnvironmentEvent(state, event)
        && !applySafetyEvent(state, event)
        && !applyCorrectionEvent(state, event)
        && !applyMultiplayerEvent(state, event)
        && !applyCombatEvent(state, event)
        && !applyCampaignEvent(state, event)
      ) {
        throw new TypeError("unsupported event type");
      }
  }

  recordNpcWorkActivityOutcome(state, event);
  recordPromiseEvidence(state, event);
  if (!candidate && !["FrozenPlayerChoiceInputRecorded", "ActivityCompletionInputRecorded"].includes(event.eventType)) {
    const priorReceipt = state.receipts[event.rootActionId];
    const receipt = publicReceipt(event);
    if (
      priorReceipt !== undefined
      && (
        priorReceipt.branchId === receipt.branchId
        || event.eventType === "BranchActivated"
      )
    ) {
      receipt.eventRange.fromEventSeq = priorReceipt.eventRange.fromEventSeq;
    }
    state.receipts[event.rootActionId] = {
      ...receipt,
      inputHash: priorReceipt?.inputHash ?? event.payloadHash,
      subjectCharacterIds: [...new Set([
        ...(priorReceipt?.subjectCharacterIds ?? []),
        ...eventSubjects(event, state),
      ])].sort(),
      ...(event.eventType === "AtomicWorldInteractionStepsResolved"
        ? {
            proposalBundleSettlement: structuredClone(
              event.payload as EventPayloadByType["AtomicWorldInteractionStepsResolved"],
            ),
          }
        : priorReceipt?.proposalBundleSettlement === undefined
          ? {}
          : { proposalBundleSettlement: priorReceipt.proposalBundleSettlement }),
    };
  }
  recordCorrectionAudit(state, event, correctionEffects);
  recordCausalFrontier(state, event);
  if (!candidate && !["FrozenPlayerChoiceInputRecorded", "ActivityCompletionInputRecorded"].includes(event.eventType)) recordSpotlightDecision(state, event, firstEventForRoot);
  state.version = event.eventSeq;
  state.eventHeadHash = event.eventHash;
  state.lastEventId = event.eventId;
  return state;
}

function unsignedEvent(event: EventEnvelope): Omit<EventEnvelope, "eventHash"> {
  const { eventHash: _eventHash, ...unsigned } = event;
  return unsigned;
}

export function eventHash(event: EventEnvelope): Sha256Ref {
  return canonicalSha256(unsignedEvent(event));
}

export type EventValidation =
  | { ok: true; event: EventEnvelope }
  | { ok: false; message: string };

export function validateEventEnvelope(value: unknown): EventValidation {
  if (!isRecord(value) || !hasExactKeys(value, EVENT_KEYS)) {
    return { ok: false, message: "Event envelope has missing or additional fields." };
  }
  if (
    value.schema !== "zhuwei.room-world-event/v2"
    || !isNonEmptyString(value.eventId)
    || typeof value.eventSeq !== "string"
    || !CANONICAL_POSITIVE_INTEGER_PATTERN.test(value.eventSeq)
    || !isNonEmptyString(value.roomId)
    || !isNonEmptyString(value.runtimeEpochId)
    || !isRecord(value.profiles)
    || !isNonEmptyString(value.branchId)
    || !(value.parentEventId === null || isNonEmptyString(value.parentEventId))
    || !isStringArray(value.causalParentEventIds)
    || !isNonEmptyString(value.rootActionId)
    || !(value.resolutionId === null || isNonEmptyString(value.resolutionId))
    || typeof value.eventType !== "string"
    || !EVENT_TYPES.has(value.eventType as EventType)
    || value.eventTypeVersion !== expectedEventTypeVersion(
      value.profiles,
      value.eventType as EventType,
      value.payload,
    )
    || typeof value.fictionInstantMicros !== "string"
    || !CANONICAL_UNSIGNED_INTEGER_PATTERN.test(value.fictionInstantMicros)
    || !isNonEmptyString(value.fictionTimelineId)
    || !isSha256(value.payloadHash)
    || !isSha256(value.previousEventHash)
    || !isSha256(value.stateBeforeHash)
    || !isSha256(value.stateHashAfter)
    || !isSha256(value.scopeProofHash)
    || !isNonEmptyString(value.visibilityPolicyId)
    || !["public", "private", "internal"].includes(String(value.secrecy))
    || !isSha256(value.eventHash)
  ) {
    return { ok: false, message: "Event envelope contains a malformed canonical field." };
  }
  if (!isTypedPayload(value.eventType as EventType, value.payload)) {
    return { ok: false, message: "Event payload does not match its closed event type schema." };
  }
  if (eventRequiresEnvironmentProfile(value.eventType as EventType, value.payload)
    && !envelopeEnvironmentProfileEnabled(
      value.profiles,
      payloadEnvironmentProfile(value.eventType as EventType, value.payload),
    )) {
    return { ok: false, message: "Event requires the pinned dynamic environment Profile." };
  }
  if (eventRequiresCausalActionProfile(value.eventType as EventType, value.payload)
    && !envelopeCausalActionProfileEnabled(value.profiles)) {
    return { ok: false, message: "Event requires the pinned V3 causal action interpreter Profile." };
  }
  if (eventRequiresSocialResolutionProfile(value.eventType as EventType, value.payload)
    && !envelopeSocialResolutionProfileEnabled(value.profiles)) {
    return { ok: false, message: "Event requires the pinned social resolution Profile." };
  }
  if (eventRequiresNpcMechanicsProfile(value.eventType as EventType, value.payload)
    && !envelopeNpcMechanicsProfileEnabled(value.profiles)) {
    return { ok: false, message: "Event requires the pinned NPC mechanics Profile." };
  }
  if (eventRequiresItemSystemProfile(value.eventType as EventType, value.payload)
    && !envelopeItemSystemProfileEnabled(value.profiles)) {
    return { ok: false, message: "Event requires the pinned item system Profile." };
  }
  if (eventRequiresWorldInteractionProfile(value.eventType as EventType, value.payload)
    && !envelopeWorldInteractionProfileEnabled(value.profiles)) {
    return { ok: false, message: "Event requires the pinned world-interaction Profile." };
  }
  if (!knownRuntimeManifestClosureIsExact(value.profiles)) {
    return { ok: false, message: "Event runtime manifest does not match its exact registered Profile closure." };
  }
  const event = value as EventEnvelope;
  try {
    if (canonicalSha256(event.payload) !== event.payloadHash || eventHash(event) !== event.eventHash) {
      return { ok: false, message: "Event payload or envelope hash does not match canonical bytes." };
    }
  } catch {
    return { ok: false, message: "Event contains a non-canonical value." };
  }
  return { ok: true, event };
}

export function createScopeProof(
  state: AuthoritativeWorldState,
  reads: string[],
  writes: string[],
  creates: string[],
): ScopeProof {
  const core = {
    basisStateVersion: state.version,
    basisStateHash: hashWorldState(state),
    reads: [...new Set(reads)].sort(),
    writes: [...new Set(writes)].sort(),
    creates: [...new Set(creates)].sort(),
  };
  return { ...core, proofHash: canonicalSha256(core) };
}

export type TransitionDraft<T extends EventType> = {
  rootActionId: string;
  resolutionId?: string;
  eventType: T;
  payload: EventPayloadByType[T];
  scopeProof: ScopeProof;
  visibilityPolicyId: string;
  secrecy: EventEnvelope["secrecy"];
};

function buildEventTransition<T extends EventType>(
  source: AuthoritativeWorldState,
  profiles: RuntimeProfileManifest,
  draft: TransitionDraft<T>,
  candidate: boolean,
): { event: EventEnvelope<T>; state: AuthoritativeWorldState } {
  if (!isAuthoritativeWorldState(source)) {
    throw new TypeError("event transition requires an authoritative v2 state");
  }
  if (eventRequiresEnvironmentProfile(draft.eventType, draft.payload)
    && !environmentProfileEnabled(
      profiles.extensions,
      payloadEnvironmentProfile(draft.eventType, draft.payload),
    )) {
    throw new TypeError("event transition requires the dynamic environment Profile");
  }
  if (eventRequiresCausalActionProfile(draft.eventType, draft.payload)
    && !causalActionInterpreterEnabled(profiles.extensions)) {
    throw new TypeError("event transition requires the V3 causal action interpreter Profile");
  }
  if (eventRequiresSocialResolutionProfile(draft.eventType, draft.payload)
    && !socialResolutionProfileEnabled(profiles.extensions)) {
    throw new TypeError("event transition requires the social resolution Profile");
  }
  if (eventRequiresNpcMechanicsProfile(draft.eventType, draft.payload)
    && !npcMechanicsProfileEnabled(profiles.extensions)) {
    throw new TypeError("event transition requires the NPC mechanics Profile");
  }
  if (eventRequiresItemSystemProfile(draft.eventType, draft.payload)
    && !itemSystemProfileEnabled(profiles.extensions)) {
    throw new TypeError("event transition requires the item system Profile");
  }
  if (eventRequiresWorldInteractionProfile(draft.eventType, draft.payload)
    && !worldInteractionProfileEnabled(profiles.extensions)) {
    throw new TypeError("event transition requires the world-interaction Profile");
  }
  const eventTypeVersion = expectedEventTypeVersion(
    profiles,
    draft.eventType,
    draft.payload,
  );
  if (eventTypeVersion === undefined) {
    throw new TypeError("event transition is unavailable under the pinned event schema Profile");
  }
  const draftPayload = draft.payload as unknown;
  if (draft.eventType === "RandomnessRequested"
    && eventRequiresCausalActionProfile(draft.eventType, draftPayload)
    && isRecord(draftPayload)
    && isRecord(draftPayload.resolutionPlan)
    && draftPayload.resolutionPlan.schema === "zhuwei.causal-action-resolution-plan/v4"
    && !isCausalRandomnessEventBinding(profiles, source, draft.rootActionId, draftPayload)) {
    throw new TypeError("causal randomness request does not match its frozen program and actor");
  }
  if (draft.eventType === "RandomnessRequested"
    && eventRequiresSocialResolutionProfile(draft.eventType, draftPayload)
    && !isSocialRandomnessEventBinding(profiles, source, draft.rootActionId, draftPayload)) {
    throw new TypeError("social randomness request does not match its frozen offer and actor");
  }
  const nextEventSeq = (BigInt(source.version) + 1n).toString();
  const fictionTimelineId = eventFictionTimelineId(
    source,
    draft.eventType,
    draft.payload as EventPayloadByType[EventType],
    draft.rootActionId,
  );
  const timeline = source.fictionTimelines[fictionTimelineId];
  const eventId = `event:${source.runtimeEpochId}:${nextEventSeq}`;
  const payloadHash = canonicalSha256(draft.payload);
  const provisional = {
    schema: "zhuwei.room-world-event/v2",
    eventId,
    eventSeq: nextEventSeq,
    roomId: source.roomId,
    runtimeEpochId: source.runtimeEpochId,
    profiles: structuredClone(profiles),
    branchId: source.activeBranchId,
    parentEventId: source.lastEventId,
    causalParentEventIds: source.lastEventId === null ? [] : [source.lastEventId],
    rootActionId: draft.rootActionId,
    resolutionId: draft.resolutionId ?? null,
    eventType: draft.eventType,
    eventTypeVersion,
    fictionTimelineId,
    fictionInstantMicros: timeline.nowMicros,
    payload: structuredClone(draft.payload),
    payloadHash,
    previousEventHash: source.eventHeadHash,
    stateBeforeHash: hashWorldState(source),
    stateHashAfter: ZERO_HASH,
    scopeProofHash: draft.scopeProof.proofHash,
    visibilityPolicyId: draft.visibilityPolicyId,
    secrecy: draft.secrecy,
    eventHash: ZERO_HASH,
  } as EventEnvelope<T>;

  const provisionalState = foldEventInternal(source, provisional as EventEnvelope, candidate);
  provisional.stateHashAfter = hashWorldState(provisionalState);
  provisional.eventHash = eventHash(provisional as EventEnvelope);
  provisionalState.eventHeadHash = provisional.eventHash;
  provisionalState.lastEventId = provisional.eventId;
  return {
    event: provisional,
    state: provisionalState,
  };
}

export function createEventTransition<T extends EventType>(
  source: AuthoritativeWorldState,
  profiles: RuntimeProfileManifest,
  draft: TransitionDraft<T>,
): { event: EventEnvelope<T>; state: AuthoritativeWorldState; receipt: PublicReceipt } {
  const transition = buildEventTransition(source, profiles, draft, false);
  return {
    ...transition,
    receipt: publicReceipt(transition.event as EventEnvelope),
  };
}

/** Formal reducer transition for Rules-local branch preflight. The event and
 * state are discardable and no Receipt or spotlight publication is created. */
export function createCandidateEventTransition<T extends EventType>(
  source: AuthoritativeWorldState,
  profiles: RuntimeProfileManifest,
  draft: TransitionDraft<T>,
): { event: EventEnvelope<T>; state: AuthoritativeWorldState } {
  return buildEventTransition(source, profiles, draft, true);
}

export function createEventSequence(
  source: AuthoritativeWorldState,
  profiles: RuntimeProfileManifest,
  drafts: TransitionDraft<EventType>[],
): {
  events: EventEnvelope[];
  state: AuthoritativeWorldState;
  receipt: PublicReceipt;
  scopeProof: ScopeProof;
} {
  if (drafts.length === 0) throw new TypeError("event sequence cannot be empty");
  let state = source;
  const events: EventEnvelope[] = [];
  let receipt: PublicReceipt | undefined;
  for (const draft of drafts) {
    const transition = createEventTransition(state, profiles, draft);
    events.push(transition.event);
    state = transition.state;
    receipt = transition.receipt;
  }
  return {
    events,
    state,
    receipt: receipt!,
    scopeProof: drafts[drafts.length - 1].scopeProof,
  };
}
