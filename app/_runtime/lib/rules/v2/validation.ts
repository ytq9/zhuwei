import { canonicalSha256 } from "../profiles/canonical";
import type { ProfileRef, Sha256Ref } from "../profiles/types";
import type {
  AuthoritativeWorldState,
  CanonicalFactRecord,
  CharacterRecord,
  CharacterLoadoutRecord,
  JsonRecord,
  RuntimeGenesis,
} from "./model";
import { isCorrectionRuntime } from "./correction";
import { isItemSystemStateV1 } from "./items";
import { isMultiplayerRuntime } from "./multiplayer-model";

const GENESIS_KEYS = [
  "genesisHash",
  "initialDefinitionCatalogRef",
  "initialState",
  "initialStateHash",
  "kind",
  "moduleRef",
  "profiles",
  "roomId",
  "runtimeEpochId",
] as const;

const PROFILE_REF_KEYS = ["profileHash", "profileId"] as const;
const CAMPAIGN_RUNTIME_KEYS = [
  "activities",
  "adjudicationPrecedents",
  "campaign",
  "chapters",
  "debts",
  "definitions",
  "endingCandidates",
  "epilogues",
  "factionPlans",
  "factions",
  "inheritanceSources",
  "itemSystem",
  "meaningfulFailures",
  "npcPlans",
  "promises",
  "relationships",
  "retryChanges",
  "sceneQuestions",
  "sourceClaims",
  "stories",
  "unresolvedThreats",
] as const;
const COMBAT_RUNTIME_KEYS = [
  "definitions",
  "effects",
  "encounters",
  "entities",
  "pendingInputs",
  "randomnessResolutions",
  "scenes",
  "story",
] as const;
const STATE_KEYS = [
  "activeBranchId",
  "canonicalFacts",
  "campaignRuntime",
  "combatRuntime",
  "correctionRuntime",
  "characterControls",
  "entities",
  "eventHeadHash",
  "fictionTimelines",
  "internalContinuations",
  "knowledge",
  "lastEventId",
  "multiplayerRuntime",
  "pendingInputs",
  "principals",
  "receipts",
  "roomId",
  "runtimeManifestRef",
  "runtimeEpochId",
  "scenes",
  "schema",
  "seats",
  "version",
] as const;

export const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const CANONICAL_UNSIGNED_INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;
export const CANONICAL_POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
export const CANONICAL_SIGNED_INTEGER_PATTERN = /^(0|-?[1-9][0-9]*)$/;

export function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** One shared authority predicate for both projection and Rules-side basis
 * validation. A private or scene-scoped fact is usable only when the same
 * character would receive it from the canonical projector. */
export function canonicalFactVisibleToCharacter(
  state: AuthoritativeWorldState,
  fact: CanonicalFactRecord,
  character: CharacterRecord,
): boolean {
  if (fact.visibilityPolicyId.startsWith("visibility:public")) return true;
  if (fact.visibilityPolicyId === "visibility:hidden-until-evidence") {
    return fact.id in (state.knowledge[character.id] ?? {});
  }
  if (
    fact.visibilityPolicyId === "visibility:channel-participants"
    || fact.visibilityPolicyId === "visibility:scene-observers"
  ) {
    return fact.subjectRefs.includes(character.id)
      || fact.subjectRefs.includes(character.sceneId)
      || (isRecord(fact.value) && fact.value.sceneId === character.sceneId);
  }
  return fact.visibilityPolicyId === `visibility:knowledge-holder:${character.id}`;
}

export function hasExactKeys(record: JsonRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

export function hasOnlyKeys(
  record: JsonRecord,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in record)
    && Object.keys(record).every((key) => allowed.has(key));
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.normalize("NFC") === value;
}

export function isCharacterLoadout(value: unknown): value is CharacterLoadoutRecord {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["armorClass", "backpack", "equipped", "speedFeet"])
    || !Number.isSafeInteger(value.armorClass)
    || Number(value.armorClass) < 1
    || Number(value.armorClass) > 99
    || !Number.isSafeInteger(value.speedFeet)
    || Number(value.speedFeet) <= 0
    || !isRecord(value.equipped)
    || !Object.entries(value.equipped).every(([slot, itemId]) =>
      isNonEmptyString(slot) && isNonEmptyString(itemId))
    || !Array.isArray(value.backpack)
  ) return false;
  const items = value.backpack;
  return items.every((entry) => isRecord(entry)
      && hasExactKeys(entry, ["itemId", "quantity"])
      && isNonEmptyString(entry.itemId)
      && Number.isSafeInteger(entry.quantity)
      && Number(entry.quantity) > 0)
    && items.every((entry, index) =>
      index === 0 || String(items[index - 1].itemId) < String(entry.itemId));
}

export function isSha256(value: unknown): value is Sha256Ref {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function isProfileRef(value: unknown): value is ProfileRef {
  return isRecord(value)
    && hasExactKeys(value, PROFILE_REF_KEYS)
    && isNonEmptyString(value.profileId)
    && isSha256(value.profileHash);
}

export function unsignedGenesis(genesis: RuntimeGenesis): Omit<RuntimeGenesis, "genesisHash"> {
  const { genesisHash: _genesisHash, ...unsigned } = genesis;
  return unsigned;
}

export function isRuntimeGenesis(value: unknown): value is RuntimeGenesis {
  if (!isRecord(value) || !hasExactKeys(value, GENESIS_KEYS)) {
    return false;
  }
  return value.kind === "roomGenesis"
    && isNonEmptyString(value.roomId)
    && isNonEmptyString(value.runtimeEpochId)
    && isRecord(value.profiles)
    && isProfileRef(value.moduleRef)
    && isProfileRef(value.initialDefinitionCatalogRef)
    && isRecord(value.initialState)
    && isSha256(value.initialStateHash)
    && isSha256(value.genesisHash);
}

function recordsSatisfy(
  value: unknown,
  predicate: (entry: JsonRecord, key: string) => boolean,
): value is Record<string, JsonRecord> {
  return isRecord(value)
    && Object.entries(value).every(([key, entry]) => isRecord(entry) && predicate(entry, key));
}

function isConversationThreadRecord(value: JsonRecord, threadRef: string): boolean {
  const claim = value.claimSemantics;
  if (!isRecord(claim)
    || !hasExactKeys(claim, [
      "addressedThreadRef", "assertion", "desiredBehavior", "evidenceRefs", "influenceGoal",
      "schema", "targetNpcRef", "topicFingerprint",
    ])
    || claim.schema !== "zhuwei.social-claim-semantics/v1"
    || !["beBelieved", "deemphasize", "cooperate", "disclose", "permit", "deter", "other"]
      .includes(String(claim.influenceGoal))
    || !isNonEmptyString(claim.desiredBehavior)
    || !isNonEmptyString(claim.targetNpcRef)
    || !Array.isArray(claim.evidenceRefs)
    || claim.evidenceRefs.length > 2
    || !claim.evidenceRefs.every(isNonEmptyString)
    || (claim.addressedThreadRef !== null && !isNonEmptyString(claim.addressedThreadRef))
    || !isSha256(claim.topicFingerprint)) return false;
  if (claim.assertion !== null) {
    if (!isRecord(claim.assertion)
      || !hasExactKeys(claim.assertion, ["object", "polarity", "predicate", "subjectRef"])
      || !isNonEmptyString(claim.assertion.subjectRef)
      || !isNonEmptyString(claim.assertion.predicate)
      || !["affirm", "deny", "question"].includes(String(claim.assertion.polarity))
      || !isRecord(claim.assertion.object)) return false;
    const object = claim.assertion.object;
    if (object.referenceKind === "existing") {
      if (!hasExactKeys(object, ["ref", "referenceKind"]) || !isNonEmptyString(object.ref)) {
        return false;
      }
    } else if (object.referenceKind !== "unresolvedLabel"
      || !hasExactKeys(object, ["label", "referenceKind"])
      || !isNonEmptyString(object.label)) return false;
  }
  return value.threadRef === threadRef
    && [value.actorCharacterId, value.npcCharacterId, value.claimRef, value.sourceSceneId,
      value.utterance, value.updatedByEventId].every(isNonEmptyString)
    && value.actorCharacterId !== value.npcCharacterId
    && claim.targetNpcRef === value.npcCharacterId
    && value.claimKind === "sourceClaim"
    && value.claimTruthStatus === "unresolved"
    && ["direct", "check"].includes(String(value.resolution))
    && ["active", "deemphasized", "dormant", "closed"].includes(String(value.status))
    && (value.pendingInputId === null || isNonEmptyString(value.pendingInputId))
    && isSha256(value.topicFingerprint)
    && value.topicFingerprint === claim.topicFingerprint
    && (value.planHash === undefined || isSha256(value.planHash))
    && (value.positionFingerprint === undefined || isSha256(value.positionFingerprint))
    && (value.responseClaimRef === undefined
      || value.responseClaimRef === null
      || isNonEmptyString(value.responseClaimRef))
    && (value.responseMode === undefined
      || value.responseMode === null
      || ["reaction", "sourceBacked", "commitment"].includes(String(value.responseMode)))
    && (value.responseReaction === undefined
      || value.responseReaction === null
      || ["acknowledge", "decline", "askClarification", "redirect", "silence"]
        .includes(String(value.responseReaction)))
    && (value.responseMinimumDegree === undefined
      || ["limitedSuccess", "fullSuccess", "strongSuccess"]
        .includes(String(value.responseMinimumDegree)))
    && (value.responseSourceRefs === undefined
      || (Array.isArray(value.responseSourceRefs)
        && value.responseSourceRefs.every(isNonEmptyString)));
}

export function isAuthoritativeWorldState(value: unknown): value is AuthoritativeWorldState {
  if (!isRecord(value) || !hasExactKeys(value, STATE_KEYS)) {
    return false;
  }
  if (
    value.schema !== "zhuwei.authoritative-world-state/v2"
    || !CANONICAL_UNSIGNED_INTEGER_PATTERN.test(String(value.version))
    || !isNonEmptyString(value.roomId)
    || !isNonEmptyString(value.runtimeEpochId)
    || !isProfileRef(value.runtimeManifestRef)
    || !isNonEmptyString(value.activeBranchId)
    || !isSha256(value.eventHeadHash)
    || !(value.lastEventId === null || isNonEmptyString(value.lastEventId))
  ) {
    return false;
  }

  const fictionTimelines = isRecord(value.fictionTimelines)
    ? value.fictionTimelines
    : undefined;
  if (fictionTimelines === undefined || !recordsSatisfy(fictionTimelines, (timeline, key) =>
    (timeline.branchId === key
      || timeline.branchId === value.activeBranchId
      || (isNonEmptyString(timeline.branchId) && timeline.branchId in fictionTimelines))
    && typeof timeline.nowMicros === "string"
    && CANONICAL_UNSIGNED_INTEGER_PATTERN.test(timeline.nowMicros))) {
    return false;
  }
  if (!(value.activeBranchId in fictionTimelines)) {
    return false;
  }

  if (!recordsSatisfy(value.scenes, (scene, key) =>
    scene.id === key && isNonEmptyString(scene.name))) {
    return false;
  }
  if (!recordsSatisfy(value.principals, (principal, key) =>
    principal.id === key
    && Number.isSafeInteger(principal.sessionVersion)
    && Number(principal.sessionVersion) > 0)) {
    return false;
  }
  if (!recordsSatisfy(value.seats, (seat, key) =>
    seat.id === key
    && isNonEmptyString(seat.principalId)
    && (seat.status === "active" || seat.status === "inactive"))) {
    return false;
  }
  if (!recordsSatisfy(value.entities, (entity, key) =>
    entity.id === key
    && (entity.kind === "player" || entity.kind === "npc")
    && isNonEmptyString(entity.name)
    && isNonEmptyString(entity.sceneId)
    && isNonEmptyString(entity.tenureStatus)
    && typeof entity.entityOrdinal === "string"
    && CANONICAL_POSITIVE_INTEGER_PATTERN.test(entity.entityOrdinal)
    && (entity.experiencePoints === undefined
      || (entity.kind === "player"
        && Number.isSafeInteger(entity.experiencePoints)
        && Number(entity.experiencePoints) >= 0)))) {
    return false;
  }
  if (!recordsSatisfy(value.characterControls, (control, key) =>
    control.characterId === key && isNonEmptyString(control.seatId))) {
    return false;
  }
  if (!recordsSatisfy(value.canonicalFacts, (fact, key) =>
    fact.id === key
    && isNonEmptyString(fact.kind)
    && Array.isArray(fact.subjectRefs)
    && fact.subjectRefs.every(isNonEmptyString)
    && isNonEmptyString(fact.visibilityPolicyId)
    && isNonEmptyString(fact.source)
    && fact.branchId === value.activeBranchId
    && typeof fact.validFromEventSeq === "string"
    && CANONICAL_UNSIGNED_INTEGER_PATTERN.test(fact.validFromEventSeq)
    && Array.isArray(fact.causalParentIds)
    && fact.causalParentIds.every(isNonEmptyString))) {
    return false;
  }
  if (!isRecord(value.knowledge)) {
    return false;
  }
  for (const [characterId, entries] of Object.entries(value.knowledge)) {
    if (!isRecord(entries)) {
      return false;
    }
    for (const [knowledgeRef, knowledge] of Object.entries(entries)) {
      if (
        !isRecord(knowledge)
        || knowledge.characterId !== characterId
        || knowledge.knowledgeRef !== knowledgeRef
        || !isNonEmptyString(knowledge.objectKind)
        || !isNonEmptyString(knowledge.layer)
        || !isNonEmptyString(knowledge.visibility)
        || !isNonEmptyString(knowledge.acquiredByEventId)
        || typeof knowledge.acquiredAtFictionMicros !== "string"
        || !CANONICAL_UNSIGNED_INTEGER_PATTERN.test(knowledge.acquiredAtFictionMicros)
        || !(knowledge.sourceCharacterId === null || isNonEmptyString(knowledge.sourceCharacterId))
        || !Array.isArray(knowledge.provenanceChain)
        || !knowledge.provenanceChain.every(isNonEmptyString)
      ) {
        return false;
      }
    }
  }

  if (!isRecord(value.campaignRuntime)
    || !hasOnlyKeys(
      value.campaignRuntime,
      CAMPAIGN_RUNTIME_KEYS,
      ["conversationThreads"],
    )
    || !(value.campaignRuntime.campaign === null || isRecord(value.campaignRuntime.campaign))
    || !Array.isArray(value.campaignRuntime.unresolvedThreats)
    || !value.campaignRuntime.unresolvedThreats.every(isNonEmptyString)) {
    return false;
  }
  const campaignRuntime = value.campaignRuntime;
  const campaignCollections = CAMPAIGN_RUNTIME_KEYS.filter((key) => !["campaign", "unresolvedThreats"].includes(key));
  if (!campaignCollections.every((key) => isRecord(campaignRuntime[key]))
    || (campaignRuntime.conversationThreads !== undefined
      && !recordsSatisfy(campaignRuntime.conversationThreads, isConversationThreadRecord))
    || !isItemSystemStateV1(campaignRuntime.itemSystem)) {
    return false;
  }

  const combatRuntime = value.combatRuntime;
  if (!isRecord(combatRuntime)
    || !hasExactKeys(combatRuntime, COMBAT_RUNTIME_KEYS)
    || !(combatRuntime.story === null || isRecord(combatRuntime.story))) {
    return false;
  }
  const combatCollections = COMBAT_RUNTIME_KEYS.filter((key) => key !== "story");
  if (!combatCollections.every((key) => isRecord(combatRuntime[key]))) {
    return false;
  }

  if (!isCorrectionRuntime(value.correctionRuntime)) {
    return false;
  }
  if (!isMultiplayerRuntime(value.multiplayerRuntime)) {
    return false;
  }

  return isRecord(value.receipts)
    && isRecord(value.pendingInputs)
    && isRecord(value.internalContinuations);
}

export function stateHashSource(state: JsonRecord): JsonRecord {
  if (!isAuthoritativeWorldState(state)) {
    return state;
  }
  const {
    eventHeadHash: _eventHeadHash,
    lastEventId: _lastEventId,
    ...domainState
  } = state;
  return domainState;
}

export function hashWorldState(state: JsonRecord): Sha256Ref {
  return canonicalSha256(stateHashSource(state));
}

export function isGenesisIntegrityValid(genesis: RuntimeGenesis): boolean {
  try {
    if (hashWorldState(genesis.initialState) !== genesis.initialStateHash) {
      return false;
    }
    if (canonicalSha256(unsignedGenesis(genesis)) !== genesis.genesisHash) {
      return false;
    }
    if (isAuthoritativeWorldState(genesis.initialState)) {
      return genesis.initialState.roomId === genesis.roomId
        && genesis.initialState.runtimeEpochId === genesis.runtimeEpochId
        && genesis.initialState.version === "0"
        && genesis.initialState.eventHeadHash === genesis.initialStateHash
        && genesis.initialState.lastEventId === null;
    }
    return true;
  } catch {
    return false;
  }
}
