import type {
  AuthoritativeWorldState,
  CharacterRecord,
  JsonRecord,
  RuntimeGenesis,
} from "./model";
import { cloneJsonRecords, emptyCombatRuntime } from "./combat-model";
import { emptyCorrectionRuntime } from "./correction";
import { emptyMultiplayerRuntime, initialMultiplayerFictionTimelines } from "./multiplayer-model";
import {
  CANONICAL_UNSIGNED_INTEGER_PATTERN,
  hasExactKeys,
  isNonEmptyString,
  isRecord,
} from "./validation";

const COMBAT_GENESIS_KEYS = [
  "activeBranchId",
  "definitions",
  "effects",
  "encounters",
  "entities",
  "fictionTimelines",
  "pendingInputs",
  "scenes",
  "story",
  "version",
] as const;

function combatGenesis(value: unknown): value is JsonRecord {
  return isRecord(value)
    && hasExactKeys(value, COMBAT_GENESIS_KEYS)
    && value.version === "0"
    && isNonEmptyString(value.activeBranchId)
    && isRecord(value.fictionTimelines)
    && isRecord(value.story)
    && isRecord(value.scenes)
    && isRecord(value.entities)
    && isRecord(value.definitions)
    && isRecord(value.encounters)
    && isRecord(value.effects)
    && isRecord(value.pendingInputs);
}

function coreCharacter(entry: JsonRecord, id: string, ordinal: number): CharacterRecord | undefined {
  if (entry.id !== id || (entry.kind !== "player" && entry.kind !== "npc")
    || !isNonEmptyString(entry.name) || !isNonEmptyString(entry.sceneId)) {
    return undefined;
  }
  return {
    id,
    kind: entry.kind,
    name: entry.name,
    sceneId: entry.sceneId,
    tenureStatus: "active",
    entityOrdinal: isNonEmptyString(entry.entityOrdinal) ? entry.entityOrdinal : String(ordinal),
    ...(isNonEmptyString(entry.controllerPrincipalId)
      ? { controllerPrincipalId: entry.controllerPrincipalId }
      : {}),
  };
}

/** Adapts the SPEC 0013 combat fixture dialect once, before the first event. */
export function normalizeCombatGenesis(value: JsonRecord, genesis: RuntimeGenesis): JsonRecord {
  if (!combatGenesis(value)) return value;
  const branchId = value.activeBranchId as string;
  const timelines = structuredClone(value.fictionTimelines) as Record<string, { branchId: string; nowMicros: string }>;
  const timeline = timelines[branchId];
  if (timeline?.branchId !== branchId
    || typeof timeline.nowMicros !== "string"
    || !CANONICAL_UNSIGNED_INTEGER_PATTERN.test(timeline.nowMicros)) {
    throw new TypeError("combat fiction timeline is malformed");
  }

  const combatEntities = cloneJsonRecords(value.entities);
  const coreEntities: Record<string, CharacterRecord> = {};
  let ordinal = 1;
  for (const [id, entry] of Object.entries(combatEntities)) {
    const core = coreCharacter(entry, id, ordinal++);
    if (core !== undefined) coreEntities[id] = core;
  }
  const principalIds = [...new Set(Object.values(coreEntities)
    .map(({ controllerPrincipalId }) => controllerPrincipalId)
    .filter(isNonEmptyString))].sort();
  const principals = Object.fromEntries(principalIds.map((id) => [id, { id, sessionVersion: 1 }]));
  const seats = Object.fromEntries(principalIds.map((principalId) => {
    const id = `seat:auto:${principalId}`;
    return [id, { id, principalId, status: "active" as const }];
  }));
  const controls = Object.fromEntries(Object.values(coreEntities)
    .filter((entity) => entity.kind === "player" && entity.controllerPrincipalId !== undefined)
    .map((entity) => [entity.id, {
      characterId: entity.id,
      seatId: `seat:auto:${entity.controllerPrincipalId}`,
    }]));
  const rawScenes = cloneJsonRecords(value.scenes);
  const scenes = Object.fromEntries(Object.keys(rawScenes).sort().map((id) => [id, { id, name: id }]));
  const knowledge = Object.fromEntries(Object.keys(coreEntities).sort().map((id) => [id, {}]));

  return {
    schema: "zhuwei.authoritative-world-state/v2",
    version: "0",
    roomId: genesis.roomId,
    runtimeEpochId: genesis.runtimeEpochId,
    runtimeManifestRef: structuredClone(genesis.profiles.manifest),
    activeBranchId: branchId,
    fictionTimelines: initialMultiplayerFictionTimelines(branchId, coreEntities, timeline.nowMicros),
    scenes,
    principals,
    seats,
    entities: coreEntities,
    characterControls: controls,
    canonicalFacts: {},
    knowledge,
    receipts: {},
    pendingInputs: {},
    internalContinuations: {},
    campaignRuntime: {
      campaign: null,
      chapters: {},
      artifacts: {},
      relationships: {},
      promises: {},
      debts: {},
      factions: {},
      activities: {},
      unresolvedThreats: [],
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
    combatRuntime: {
      ...emptyCombatRuntime(),
      story: structuredClone(value.story as JsonRecord),
      scenes: rawScenes,
      entities: combatEntities,
      definitions: cloneJsonRecords(value.definitions),
      encounters: cloneJsonRecords(value.encounters),
      effects: cloneJsonRecords(value.effects),
      pendingInputs: cloneJsonRecords(value.pendingInputs),
    },
    correctionRuntime: emptyCorrectionRuntime(genesis.roomId, genesis.runtimeEpochId),
    multiplayerRuntime: emptyMultiplayerRuntime(
      genesis.roomId,
      genesis.runtimeEpochId,
      principals,
      seats,
      coreEntities,
      controls,
      branchId,
      scenes,
      timeline.nowMicros,
    ),
    eventHeadHash: genesis.initialStateHash,
    lastEventId: null,
  } satisfies AuthoritativeWorldState;
}
