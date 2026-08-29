import type {
  AuthoritativeWorldState,
  CanonicalFactRecord,
  CharacterRecord,
  JsonRecord,
  KnowledgeRecord,
  RuntimeGenesis,
} from "./model";
import {
  CANONICAL_UNSIGNED_INTEGER_PATTERN,
  hasExactKeys,
  isCharacterLoadout,
  isNonEmptyString,
  isProfileRef,
  isRecord,
} from "./validation";
import { emptyCombatRuntime } from "./combat-model";
import { emptyCorrectionRuntime } from "./correction";
import { emptyMultiplayerRuntime, initialMultiplayerFictionTimelines } from "./multiplayer-model";
import {
  ADVANCEMENT_PROFILES,
  experienceThresholdForLevel,
  type AdvancementProfile,
} from "./character-progression";

const CAMPAIGN_GENESIS_KEYS = [
  "activities",
  "activeBranchId",
  "artifacts",
  "campaign",
  "canonicalFacts",
  "chapters",
  "debts",
  "entities",
  "factions",
  "fictionTimelines",
  "knowledge",
  "promises",
  "relationships",
  "unresolvedThreats",
  "version",
] as const;

function isCampaignGenesisState(value: unknown): value is JsonRecord {
  return isRecord(value)
    && hasExactKeys(value, CAMPAIGN_GENESIS_KEYS)
    && typeof value.version === "string"
    && value.version === "0"
    && isNonEmptyString(value.activeBranchId)
    && isRecord(value.fictionTimelines)
    && isRecord(value.campaign)
    && isRecord(value.chapters)
    && isRecord(value.debts)
    && isRecord(value.entities)
    && isRecord(value.artifacts)
    && isRecord(value.canonicalFacts)
    && isRecord(value.knowledge)
    && isRecord(value.relationships)
    && isRecord(value.promises)
    && isRecord(value.factions)
    && isRecord(value.activities)
    && Array.isArray(value.unresolvedThreats)
    && value.unresolvedThreats.every(isNonEmptyString);
}

function cloneRecords(value: unknown): Record<string, JsonRecord> {
  if (!isRecord(value)) {
    throw new TypeError("campaign state collection must be a record");
  }
  const entries = Object.entries(value).map(([key, entry]) => {
    if (!isRecord(entry)) {
      throw new TypeError("campaign state entry must be a record");
    }
    return [key, structuredClone(entry)] as const;
  });
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeCharacter(
  entry: JsonRecord,
  id: string,
  ordinal: number,
  advancementProfile: AdvancementProfile,
): CharacterRecord {
  if (
    entry.id !== id
    || (entry.kind !== "player" && entry.kind !== "npc")
    || !isNonEmptyString(entry.name)
    || !isNonEmptyString(entry.sceneId)
  ) {
    throw new TypeError("campaign character is malformed");
  }
  const hitPoints = isRecord(entry.hitPoints)
    && Number.isInteger(entry.hitPoints.current)
    && Number.isInteger(entry.hitPoints.maximum)
    ? { current: Number(entry.hitPoints.current), maximum: Number(entry.hitPoints.maximum) }
    : undefined;
  const resources = isRecord(entry.resources)
    && Object.values(entry.resources).every(Number.isInteger)
    ? Object.fromEntries(Object.entries(entry.resources).map(([key, value]) => [key, Number(value)]))
    : undefined;
  const resourceMaximums = isRecord(entry.resourceMaximums)
    && Object.values(entry.resourceMaximums).every((value) => Number.isInteger(value) && Number(value) >= 0)
    ? Object.fromEntries(Object.entries(entry.resourceMaximums).map(([key, value]) => [key, Number(value)]))
    : undefined;
  const abilityScores = isRecord(entry.abilityScores)
    && hasExactKeys(entry.abilityScores, ["cha", "con", "dex", "int", "str", "wis"])
    && Object.values(entry.abilityScores).every((value) => Number.isInteger(value)
      && Number(value) >= 1 && Number(value) <= 30)
    ? Object.fromEntries(Object.entries(entry.abilityScores).map(([key, value]) => [key, Number(value)]))
    : undefined;
  const stringList = (value: unknown) => Array.isArray(value) && value.every(isNonEmptyString)
    ? [...new Set(value)].sort()
    : undefined;
  const level = Number.isSafeInteger(entry.level) ? Number(entry.level) : undefined;
  const minimumExperience = entry.kind === "player" && advancementProfile === "srdXp2014"
    ? experienceThresholdForLevel(level ?? 1)
    : undefined;
  const experiencePoints = Number.isSafeInteger(entry.experiencePoints)
    && Number(entry.experiencePoints) >= 0
    ? Number(entry.experiencePoints)
    : undefined;
  if (entry.experiencePoints !== undefined && experiencePoints === undefined) {
    throw new TypeError("campaign character experience is malformed");
  }
  if (minimumExperience !== undefined
    && experiencePoints !== undefined
    && experiencePoints < minimumExperience) {
    throw new TypeError("campaign character experience is below its SRD level threshold");
  }
  return {
    id,
    kind: entry.kind,
    name: entry.name,
    sceneId: entry.sceneId,
    tenureStatus: ["active", "dead", "retired", "missing", "npcTransitioned"]
      .includes(String(entry.tenureStatus))
      ? entry.tenureStatus as CharacterRecord["tenureStatus"]
      : "active",
    entityOrdinal: String(ordinal),
    ...(isNonEmptyString(entry.controllerPrincipalId)
      ? { controllerPrincipalId: entry.controllerPrincipalId }
      : {}),
    ...(level === undefined ? {} : { level }),
    ...(minimumExperience === undefined && experiencePoints === undefined
      ? {}
      : { experiencePoints: experiencePoints ?? minimumExperience }),
    ...(hitPoints === undefined ? {} : { hitPoints }),
    ...(resources === undefined ? {} : { resources }),
    ...(resourceMaximums === undefined ? {} : { resourceMaximums }),
    ...(abilityScores === undefined ? {} : { abilityScores }),
    ...(Number.isSafeInteger(entry.proficiencyBonus)
      ? { proficiencyBonus: Number(entry.proficiencyBonus) }
      : {}),
    ...(stringList(entry.proficientSkills) === undefined
      ? {}
      : { proficientSkills: stringList(entry.proficientSkills)! }),
    ...(stringList(entry.expertiseSkills) === undefined
      ? {}
      : { expertiseSkills: stringList(entry.expertiseSkills)! }),
    ...(stringList(entry.proficientSaves) === undefined
      ? {}
      : { proficientSaves: stringList(entry.proficientSaves)! }),
    ...(isNonEmptyString(entry.classId) ? { classId: entry.classId } : {}),
    ...(isNonEmptyString(entry.raceId) ? { raceId: entry.raceId } : {}),
    ...(isNonEmptyString(entry.subclassId) ? { subclassId: entry.subclassId } : {}),
    ...(isNonEmptyString(entry.lastControllerSeatId)
      ? { lastControllerSeatId: entry.lastControllerSeatId }
      : {}),
    ...(typeof entry.lastLongRestCompletedAtMicros === "string"
      && CANONICAL_UNSIGNED_INTEGER_PATTERN.test(entry.lastLongRestCompletedAtMicros)
      ? { lastLongRestCompletedAtMicros: entry.lastLongRestCompletedAtMicros }
      : {}),
    ...(stringList(entry.cantripIds) === undefined ? {} : { cantripIds: stringList(entry.cantripIds)! }),
    ...(stringList(entry.preparedSpellIds) === undefined
      ? {}
      : { preparedSpellIds: stringList(entry.preparedSpellIds)! }),
    ...(stringList(entry.featureIds) === undefined ? {} : { featureIds: stringList(entry.featureIds)! }),
    ...(isCharacterLoadout(entry.loadout)
      ? { loadout: structuredClone(entry.loadout) }
      : {}),
  };
}

function normalizeFact(
  entry: JsonRecord,
  id: string,
  branchId: string,
): CanonicalFactRecord {
  if (entry.factId !== id || !isNonEmptyString(entry.kind)) {
    throw new TypeError("campaign fact is malformed");
  }
  return {
    id,
    kind: entry.kind,
    subjectRefs: Array.isArray(entry.subjectRefs)
      ? [...new Set(entry.subjectRefs.filter(isNonEmptyString))].sort()
      : [],
    value: structuredClone(entry.value),
    visibilityPolicyId: entry.visibility === "public"
      ? "visibility:public"
      : "visibility:hidden-until-evidence",
    source: "moduleAnchor",
    branchId,
    validFromEventSeq: "0",
    causalParentIds: [],
  };
}

function normalizeKnowledge(
  value: JsonRecord,
  entities: Record<string, CharacterRecord>,
  fictionInstantMicros: string,
): Record<string, Record<string, KnowledgeRecord>> {
  const result: Record<string, Record<string, KnowledgeRecord>> = Object.fromEntries(
    Object.keys(entities).sort().map((characterId) => [characterId, {}]),
  );
  for (const [characterId, entries] of Object.entries(value)) {
    if (!(characterId in entities) || !Array.isArray(entries)) {
      throw new TypeError("campaign knowledge holder is malformed");
    }
    for (const item of entries) {
      if (!isRecord(item) || !isNonEmptyString(item.knowledgeId)) {
        throw new TypeError("campaign knowledge item is malformed");
      }
      const provenance = Array.isArray(item.provenance)
        ? item.provenance.filter(isNonEmptyString)
        : [];
      result[characterId][item.knowledgeId] = {
        characterId,
        knowledgeRef: item.knowledgeId,
        objectKind: "canonicalFact",
        layer: "full",
        content: structuredClone(item.value),
        visibility: item.visibility === "private" ? "private" : "shared",
        acquiredByEventId: provenance[0] ?? "genesis:campaign-knowledge",
        acquiredAtFictionMicros: fictionInstantMicros,
        sourceCharacterId: null,
        provenanceChain: provenance,
      };
    }
  }
  return result;
}

/** Deterministic adapter for the approved canonical campaign genesis dialect. */
export function normalizeCampaignGenesis(
  value: JsonRecord,
  genesis: RuntimeGenesis,
): JsonRecord {
  if (!isCampaignGenesisState(value)) {
    return value;
  }
  const activeBranchId = value.activeBranchId as string;
  const campaign = structuredClone(value.campaign as JsonRecord);
  if (!isProfileRef(genesis.moduleRef)) {
    throw new TypeError("campaign genesis module ref is malformed");
  }
  if (campaign.moduleRef === undefined) {
    campaign.moduleRef = structuredClone(genesis.moduleRef);
  } else if (
    !isProfileRef(campaign.moduleRef)
    || campaign.moduleRef.profileId !== genesis.moduleRef.profileId
    || campaign.moduleRef.profileHash !== genesis.moduleRef.profileHash
  ) {
    throw new TypeError("campaign module ref does not match genesis");
  }
  const chapters = cloneRecords(value.chapters);
  for (const chapter of Object.values(chapters)) {
    if (chapter.moduleRef === undefined) {
      chapter.moduleRef = structuredClone(genesis.moduleRef);
    } else if (
      !isProfileRef(chapter.moduleRef)
      || chapter.moduleRef.profileId !== genesis.moduleRef.profileId
      || chapter.moduleRef.profileHash !== genesis.moduleRef.profileHash
    ) {
      throw new TypeError("campaign chapter module ref does not match genesis");
    }
  }
  const advancementProfile = campaign.advancementProfile === undefined
    ? "milestone"
    : (ADVANCEMENT_PROFILES as readonly unknown[]).includes(campaign.advancementProfile)
      ? campaign.advancementProfile as AdvancementProfile
      : undefined;
  if (advancementProfile === undefined) {
    throw new TypeError("campaign advancement profile is unsupported");
  }
  campaign.advancementProfile = advancementProfile;
  const fictionTimelines = value.fictionTimelines as JsonRecord;
  const rawTimeline = fictionTimelines[activeBranchId];
  if (
    !isRecord(rawTimeline)
    || rawTimeline.branchId !== activeBranchId
    || typeof rawTimeline.nowMicros !== "string"
    || !CANONICAL_UNSIGNED_INTEGER_PATTERN.test(rawTimeline.nowMicros)
  ) {
    throw new TypeError("campaign fiction timeline is malformed");
  }

  const rawEntities = cloneRecords(value.entities);
  const entities = Object.fromEntries(
    Object.entries(rawEntities)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, entry], index) => [id, normalizeCharacter(
        entry,
        id,
        index + 1,
        advancementProfile,
      )]),
  );
  const principalIds = [...new Set(Object.values(entities)
    .map((entity) => entity.controllerPrincipalId)
    .filter(isNonEmptyString))].sort();
  const principals = Object.fromEntries(principalIds.map((id) => [id, { id, sessionVersion: 1 }]));
  const seats = Object.fromEntries(principalIds.map((principalId) => {
    const id = `seat:auto:${principalId}`;
    return [id, { id, principalId, status: "active" as const }];
  }));
  const characterControls = Object.fromEntries(Object.values(entities)
    .filter((entity) => entity.kind === "player" && entity.controllerPrincipalId !== undefined)
    .map((entity) => [entity.id, {
      characterId: entity.id,
      seatId: `seat:auto:${entity.controllerPrincipalId}`,
    }]));
  const sceneIds = [...new Set(Object.values(entities).map(({ sceneId }) => sceneId))].sort();
  const scenes = Object.fromEntries(sceneIds.map((id) => [id, { id, name: id }]));
  const canonicalFacts = Object.fromEntries(Object.entries(cloneRecords(value.canonicalFacts))
    .map(([id, entry]) => [id, normalizeFact(entry, id, activeBranchId)]));

  return {
    schema: "zhuwei.authoritative-world-state/v2",
    version: "0",
    roomId: genesis.roomId,
    runtimeEpochId: genesis.runtimeEpochId,
    runtimeManifestRef: structuredClone(genesis.profiles.manifest),
    activeBranchId,
    fictionTimelines: initialMultiplayerFictionTimelines(
      activeBranchId,
      entities,
      rawTimeline.nowMicros,
    ),
    scenes,
    principals,
    seats,
    entities,
    characterControls,
    canonicalFacts,
    knowledge: normalizeKnowledge(value.knowledge as JsonRecord, entities, rawTimeline.nowMicros),
    receipts: {},
    pendingInputs: {},
    internalContinuations: {},
    campaignRuntime: {
      campaign,
      chapters,
      artifacts: cloneRecords(value.artifacts),
      relationships: cloneRecords(value.relationships),
      promises: cloneRecords(value.promises),
      debts: cloneRecords(value.debts),
      factions: cloneRecords(value.factions),
      activities: cloneRecords(value.activities),
      unresolvedThreats: [...(value.unresolvedThreats as string[])],
      definitions: {},
      sourceClaims: {},
      npcPlans: {},
      factionPlans: {},
      meaningfulFailures: {},
      retryChanges: {},
      sceneQuestions: {},
      endingCandidates: {},
      stories: {},
      epilogues: {},
      inheritanceSources: {},
    },
    combatRuntime: emptyCombatRuntime(),
    correctionRuntime: emptyCorrectionRuntime(genesis.roomId, genesis.runtimeEpochId),
    multiplayerRuntime: emptyMultiplayerRuntime(
      genesis.roomId,
      genesis.runtimeEpochId,
      principals,
      seats,
      entities,
      characterControls,
      activeBranchId,
      scenes,
      rawTimeline.nowMicros,
    ),
    eventHeadHash: genesis.initialStateHash,
    lastEventId: null,
  } satisfies AuthoritativeWorldState;
}
