import { canonicalSha256 } from "../profiles/canonical";
import { environmentProfileEnabled } from "../profiles/environment";
import type { ProfileRef, RuntimeProfileManifest, Sha256Ref } from "../profiles/types";
import type {
  AuthoritativeWorldState,
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
  CANONICAL_POSITIVE_INTEGER_PATTERN,
  CANONICAL_SIGNED_INTEGER_PATTERN,
  CANONICAL_UNSIGNED_INTEGER_PATTERN,
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
  applyMultiplayerEvent,
  MULTIPLAYER_EVENT_TYPES,
  validateMultiplayerEventPayload,
} from "./multiplayer-events";
import {
  eventFictionTimelineId,
  recordCausalFrontier,
  recordSpotlightDecision,
} from "./timeline";
import { isCompoundResolutionPlan } from "./compound-model";
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
      && payload.intent === "resolveHazard");
}

function envelopeEnvironmentProfileEnabled(profiles: JsonRecord): boolean {
  return Array.isArray(profiles.extensions)
    && profiles.extensions.every((extension): extension is ProfileRef =>
      isRecord(extension)
      && hasExactKeys(extension, ["profileHash", "profileId"])
      && isNonEmptyString(extension.profileId)
      && isSha256(extension.profileHash))
    && environmentProfileEnabled(profiles.extensions);
}

const EVENT_TYPES = new Set<EventType>([
  "ImprovisedActionResolved",
  "ClarificationRequested",
  "PlayerChoiceRequested",
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
    && ["improvisedCheck", "abilityCheck", "contestCheck", "savingThrow"].includes(String(value.purpose))
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

function isAuthorityContinuation(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["capability", "continuationId", "kind"])
    && value.kind === "roomAuthorityRandomness"
    && isNonEmptyString(value.continuationId)
    && isSha256(value.capability);
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
      "featureIds",
      "hitPoints",
      "lastLongRestCompletedAtMicros",
      "lastControllerSeatId",
      "level",
      "loadout",
      "preparedSpellIds",
      "proficiencyBonus",
      "proficientSkills",
      "raceId",
      "resourceMaximums",
      "resources",
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
    && (value.lastLongRestCompletedAtMicros === undefined
      || (typeof value.lastLongRestCompletedAtMicros === "string"
        && CANONICAL_UNSIGNED_INTEGER_PATTERN.test(value.lastLongRestCompletedAtMicros)))
    && [value.cantripIds, value.preparedSpellIds, value.featureIds]
      .every((entry) => entry === undefined || isCanonicalStringArray(entry))
    && (value.resourceMaximums === undefined || (isRecord(value.resourceMaximums)
      && Object.entries(value.resourceMaximums).every(([resourceId, maximum]) =>
        isNonEmptyString(resourceId) && Number.isSafeInteger(maximum) && Number(maximum) >= 0)));
}

function isTypedPayload(eventType: EventType, value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  switch (eventType) {
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
            || isContestResolutionPlan(value.resolutionPlan)
            || isHiddenRealityResolutionPlan(value.resolutionPlan));
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
      if (["1d20", "2d20kh1", "2d20kl1"].includes(String(value.formula))) {
        return Array.isArray(value.faces)
          && value.faces.length >= 1
          && value.faces.length <= 2
          && value.faces.every((face) => Number.isInteger(face) && face >= 1 && face <= 20)
          && Number.isInteger(value.selectedFace)
          && value.faces.includes(value.selectedFace);
      }
      const restFormula = /^([1-9][0-9]*)d(6|8|10|12)$/.exec(String(value.formula));
      if (restFormula !== null) return Array.isArray(value.faces)
        && value.faces.length === Number(restFormula[1])
        && value.faces.length <= 20
        && value.faces.every((face) => Number.isInteger(face)
          && face >= 1 && face <= Number(restFormula[2]))
        && value.selectedFace === null;
      const hiddenFormula = /^1d([1-9][0-9]*)$/.exec(String(value.formula));
      return hiddenFormula !== null && Array.isArray(value.faces) && value.faces.length === 1
        && Number.isInteger(value.faces[0]) && value.faces[0] >= 1
        && value.faces[0] <= Number(hiddenFormula[1]) && value.selectedFace === value.faces[0];
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
      ], ["sourceCharacterId"])
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
      return hasOnlyKeys(value, ["controllerSeatId", "predecessorCharacterId", "successor"], ["worldEntry"])
        && isNonEmptyString(value.controllerSeatId)
        && isNonEmptyString(value.predecessorCharacterId)
        && isCharacterRecord(value.successor);
    default:
      return validateEnvironmentEventPayload(eventType, value)
        || validateSafetyEventPayload(eventType, value)
        || validateCombatEventPayload(eventType, value)
        || validateCampaignEventPayload(eventType, value)
        || validateMultiplayerEventPayload(eventType, value);
  }
}

function publicReceipt(event: EventEnvelope): PublicReceipt {
  const status = event.eventType === "ClarificationRequested"
    || event.eventType === "PlayerChoiceRequested"
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

function eventSubjects(event: EventEnvelope): string[] {
  const payload = event.payload as JsonRecord;
  const candidates = [
    payload.actorCharacterId,
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
  return [...new Set(candidates)].sort();
}

function knowledgeFor(
  state: AuthoritativeWorldState,
  characterId: string,
): Record<string, KnowledgeRecord> {
  state.knowledge[characterId] ??= {};
  return state.knowledge[characterId];
}

/** Private fold: callers can only exercise it through step/replay. */
export function foldEvent(
  source: AuthoritativeWorldState,
  event: EventEnvelope,
): AuthoritativeWorldState {
  const correctionEffects = correctionEffectsBefore(source, event);
  const firstEventForRoot = !(event.rootActionId in source.receipts);
  const state = structuredClone(source);

  switch (event.eventType) {
    case "ImprovisedActionResolved": {
      const payload = event.payload as EventPayloadByType["ImprovisedActionResolved"];
      if (!(payload.actorCharacterId in state.entities)) {
        throw new TypeError("improvised action actor does not exist");
      }
      if (payload.fact !== null) {
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
    case "PendingInputAnswered": {
      const payload = event.payload as EventPayloadByType["PendingInputAnswered"];
      const pending = state.pendingInputs[payload.pendingInputId];
      if (
        pending === undefined
        || (pending.kind !== "clarification" && pending.kind !== "playerChoice")
        || pending.rootActionId !== event.rootActionId
        || pending.controllerCharacterId !== payload.actorCharacterId
        || pending.openedByEventId !== payload.openedByEventId
      ) {
        throw new TypeError("pending answer does not match the open clarification");
      }
      delete state.pendingInputs[payload.pendingInputId];
      break;
    }
    case "RandomnessRequested": {
      const payload = event.payload as EventPayloadByType["RandomnessRequested"];
      if ("resolution" in payload) {
        const resolution = payload.resolution;
        state.combatRuntime.randomnessResolutions[String(resolution.resolutionId)] = structuredClone(resolution);
        break;
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
    case "DiceRolled":
      break;
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
        provenanceChain: [payload.causeFactId, event.eventId],
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
        !applyEnvironmentEvent(state, event)
        && !applySafetyEvent(state, event)
        && !applyCorrectionEvent(state, event)
        && !applyMultiplayerEvent(state, event)
        && !applyCombatEvent(state, event)
        && !applyCampaignEvent(state, event)
      ) {
        throw new TypeError("unsupported event type");
      }
  }

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
      ...eventSubjects(event),
    ])].sort(),
  };
  recordCorrectionAudit(state, event, correctionEffects);
  recordCausalFrontier(state, event);
  recordSpotlightDecision(state, event, firstEventForRoot);
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
    || value.eventTypeVersion !== "1"
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
    && !envelopeEnvironmentProfileEnabled(value.profiles)) {
    return { ok: false, message: "Event requires the pinned dynamic environment Profile." };
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

export function createEventTransition<T extends EventType>(
  source: AuthoritativeWorldState,
  profiles: RuntimeProfileManifest,
  draft: TransitionDraft<T>,
): { event: EventEnvelope<T>; state: AuthoritativeWorldState; receipt: PublicReceipt } {
  if (!isAuthoritativeWorldState(source)) {
    throw new TypeError("event transition requires an authoritative v2 state");
  }
  if (eventRequiresEnvironmentProfile(draft.eventType, draft.payload)
    && !environmentProfileEnabled(profiles.extensions)) {
    throw new TypeError("event transition requires the dynamic environment Profile");
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
    eventTypeVersion: "1",
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

  const provisionalState = foldEvent(source, provisional as EventEnvelope);
  provisional.stateHashAfter = hashWorldState(provisionalState);
  provisional.eventHash = eventHash(provisional as EventEnvelope);
  provisionalState.eventHeadHash = provisional.eventHash;
  provisionalState.lastEventId = provisional.eventId;
  return {
    event: provisional,
    state: provisionalState,
    receipt: publicReceipt(provisional as EventEnvelope),
  };
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
