import { DurableObject } from "cloudflare:workers";

import { validateNarrationAgencyClaims } from "../kp/authoritative-helpers";
import { validateCausalActionProgram } from "../kp/causal-action-program";
import { findModule } from "../module";
import {
  authoritativeModuleProfile,
  moduleInitializationFixtures,
  moduleKpProjection,
  type AuthoritativeModuleProfile,
} from "../module/authoritative";
import {
  legacyRulesAdapterFor,
  type LegacyInitialEntity,
} from "../rules/legacy-adapter";
import type { Command, Decision, WorldEvent, WorldState } from "../rules/model";
import { RULESET_VERSION } from "../rules/ruleset";
import { completeSpellCastRolls } from "../rules/spell-rolls";
import {
  isTacticalPosition,
  isTacticalSpatialRevision,
} from "../rules/tactical-projection";
import {
  project as projectAuthoritative,
  replay as replayAuthoritative,
  step as stepAuthoritative,
  type AuthoritativeWorldState,
  type EventEnvelope,
  type KpViewer,
  type NpcViewer,
  type PlayerViewer,
  type ProjectionQuery,
  type ReplayedRulesResult,
  type RuntimeGenesis,
  type RuntimeProfileManifest,
  type SafeReadModel,
} from "../rules";
import {
  buildCustomEnvironmentFeatureDefinition,
} from "../rules/profiles/environment-definition-builder";
import { customEnvironmentDefinitionInputFromDraft } from "../rules/profiles/environment-form-lowering";
import {
  compileEnvironmentFeature,
  ENVIRONMENT_PROFILE,
} from "../rules/profiles/environment";
import {
  DELIVERY_PROTOCOL_PROFILE,
  INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE,
} from "../rules/profiles/manifests";
import { characterProficiencyProfileEnabled } from "../rules/profiles/character-proficiency";
import type { ProfileRef } from "../rules/profiles/types";
import {
  TURN_TICKET_TTL_MS,
  UX_LEASE_TTL_MS,
  advanceScopeVersions,
  commandScopes,
  scopeConflict,
} from "./coordinator";
import type {
  CommitTurnInput,
  CommitTurnResult,
  InitializeRoomInput,
  PrepareTurnInput,
  RoomSnapshot,
  StoredRoomEvent,
  SynchronizePlayerLoadoutInput,
  TurnTicket,
  UpsertPlayerInput,
} from "./types";
import {
  AuthoritativeRoomStore,
  type AuthorityActionStageRow,
  type AuthorityDeliveryAudienceRow,
  type AuthorityDeliveryPlanRow,
  type AuthorityDeliverySlotRow,
  type AuthorityRandomnessBatchJournalRow,
  type AuthorityProposalRecoveryRow,
  type AuthoritySubmissionRow,
} from "./authority-store";
import { buildRoomTelemetryEvent } from "./telemetry";
import {
  appendAuthoritativeArchiveToD1,
  AuthoritativeArchiveCursorMismatchError,
  AuthoritativeArchiveD1ReadError,
  archiveSha256 as authorityHash,
  buildAuthoritativeArchive,
  hasRoomServiceCapability,
  readAuthoritativeArchiveFromD1,
  roomServiceCapabilities,
  validateAuthoritativeArchive,
  type ArchiveProjectionAudit,
  type ArchiveReceiptReference,
  type AuthoritativeRoomArchive,
} from "./archive";
import type {
  AuthoritativeActionInput,
  AuthoritativeCharacterSeed,
  AuthoritativeInitializationOutcome,
  AuthoritativeMemberSeed,
  AuthoritativeRoomObservation,
  AuthorityCommitOutcome,
  DeliveryAudienceBinding,
  DeliveryFrame,
  DeliveryPlan,
  InitializeAuthoritativeRoomInput,
  JsonObject,
  PreparedAuthoritativeAction,
  PublicReceipt,
  TrustedPrincipalContext,
} from "./authority-types";
import {
  bindRoomModuleMigration,
  isCanonicalV3CausalRulesInput,
  narrationProjection,
  normalizeRoomKpProposal,
  ownedEnvironmentAttackAbilityRef,
  projectInitializationFixtures,
  projectedStorySummary,
  roomPlayerProjection,
} from "./proposal-adapter";
import { authorityPendingBindings } from "./pending-bindings";

type RoomRow = {
  room_id: string;
  module_id: string;
  ruleset_version: string;
  state_json: string;
  scope_versions_json: string;
};

function exactProfileRef(value: unknown, expected: ProfileRef): value is ProfileRef {
  return isJsonRecord(value)
    && value.profileId === expected.profileId
    && value.profileHash === expected.profileHash
    && hasExactJsonKeys(value, ["profileHash", "profileId"]);
}

function deliveryProtocolForProfiles(profiles: RuntimeProfileManifest): ProfileRef {
  if (profiles.extensions.some((entry) =>
    exactProfileRef(entry, INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE))) {
    return INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE;
  }
  if (profiles.extensions.some((entry) => exactProfileRef(entry, DELIVERY_PROTOCOL_PROFILE))) {
    return DELIVERY_PROTOCOL_PROFILE;
  }
  throw new TypeError("The runtime manifest has no registered delivery protocol.");
}

function deliveryProtocolForPlan(plan: DeliveryPlan): ProfileRef | undefined {
  if (plan.deliveryProtocol === undefined) return DELIVERY_PROTOCOL_PROFILE;
  if (exactProfileRef(plan.deliveryProtocol, DELIVERY_PROTOCOL_PROFILE)) {
    return DELIVERY_PROTOCOL_PROFILE;
  }
  if (exactProfileRef(plan.deliveryProtocol, INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE)) {
    return INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE;
  }
  return undefined;
}

type TicketRow = {
  id: string;
  actor_id: string;
  state_version: number;
  scope_versions_json: string;
  projection_json: string;
  status: string;
  expires_at: number;
};

type UnstampedWorldEvent = WorldEvent extends infer Event
  ? Event extends WorldEvent
    ? Omit<Event, "id" | "commandId" | "version" | "atSeconds">
    : never
  : never;

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function isObserverProjection(value: ReturnType<typeof projectAuthoritative>): value is SafeReadModel {
  return value.kind === "projected" && value.viewer.kind !== "kp";
}

function uniqueSceneIds(values: unknown[]): string[] {
  return [...new Set(values.filter(nonEmptyString))]
    .sort((left, right) => left.localeCompare(right));
}

function pendingTranscriptBody(pending: unknown): string | undefined {
  if (!isJsonRecord(pending)) return undefined;
  return nonEmptyString(pending.question)
    ? pending.question
    : nonEmptyString(pending.prompt) ? pending.prompt : undefined;
}

function projectionTranscriptSceneIds(projection: unknown): string[] {
  if (!isJsonRecord(projection)) return [];
  const controlledCharacter = isJsonRecord(projection.controlledCharacter)
    ? projection.controlledCharacter
    : undefined;
  const committedDelta = isJsonRecord(projection.committedDelta)
    ? projection.committedDelta
    : undefined;
  const changes = Array.isArray(committedDelta?.changes)
    ? committedDelta.changes.filter(isJsonRecord)
    : [];
  return uniqueSceneIds([
    controlledCharacter?.sceneId,
    ...changes.flatMap((change) => [change.sceneId, change.fromSceneId, change.toSceneId]),
  ]);
}

function narrationPublicationMetadata(projection: unknown) {
  if (!isJsonRecord(projection)) {
    return { derivedEvidenceRefs: [], derivedAgencyClaims: [] };
  }
  const committedDelta = isJsonRecord(projection.committedDelta)
    ? projection.committedDelta
    : undefined;
  const changes = Array.isArray(committedDelta?.changes)
    ? committedDelta.changes.filter(isJsonRecord)
    : [];
  const references = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      if (
        /^(?:ability|activity|artifact|character|encounter|environment|event|fact|feature|hazard|item|knowledge|npc|receipt|scene):/.test(value)
        || /^sha256:[0-9a-f]{64}$/.test(value)
      ) references.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (isJsonRecord(value)) {
      for (const entry of Object.values(value)) visit(entry);
    }
  };
  visit(changes);
  const derivedEvidenceRefs = [...references].sort((left, right) => left.localeCompare(right));
  const actorCharacterId = nonEmptyString(committedDelta?.actorCharacterId)
    ? committedDelta.actorCharacterId
    : null;
  return {
    derivedEvidenceRefs,
    derivedAgencyClaims: changes.length === 0
      ? []
      : [
          ...(actorCharacterId === null
            ? []
            : [{
                subjectKind: "playerCharacter" as const,
                subjectRef: actorCharacterId,
                claimKind: "committedObservableAction" as const,
                basisRefs: derivedEvidenceRefs,
              }]),
          {
            subjectKind: "world" as const,
            subjectRef: null,
            claimKind: "sensoryConsequence" as const,
            basisRefs: derivedEvidenceRefs,
          },
        ],
  };
}

function staleDecision(commandId: string, message: string): Decision {
  return {
    kind: "rejected",
    rejection: { code: "stale_state", message },
    decisionId: `decision:${commandId}`,
    commandId,
  };
}

type JsonRecord = Record<string, unknown>;

type AuthorityCommitRecovery = {
  rulesInput: JsonRecord;
  answeredPendingInputId: string | null;
  receiptExtras: JsonObject | null;
  forceConcluded: boolean;
  initialRandomnessRootActionId?: string;
};

type AuthorityRandomnessJournalRequest = {
  randomnessId: string;
  requestHash: string;
  frozenParametersHash: string;
  request: JsonObject;
};

type AuthorityRandomnessCandidate = {
  randomnessId: string;
  faces: number[];
};

type AuthorityRandomnessFulfillment =
  | { kind: "singleContinuation"; continuation: JsonObject }
  | {
      kind: "combatBatch";
      resolutionId: string;
      continuationCapability: string;
    }
  | { kind: "continuationBatch"; continuations: JsonObject[] };

type AuthorityRandomnessWave = {
  requestCount: number;
  fulfillment: AuthorityRandomnessFulfillment;
};

type AuthorityRandomnessFulfillmentJournal = {
  kind: "multiWave";
  waves: AuthorityRandomnessWave[];
};

type AuthorityDiceTerm = { count: number; sides: number };

type AuthorityCommitSource =
  | { kind: "proposal"; value: unknown }
  | { kind: "recovery"; row: AuthorityProposalRecoveryRow }
  | {
      kind: "canonicalInput";
      proposalHash: string;
      input: JsonObject;
    };

type AuthorityReplay = {
  profiles: RuntimeProfileManifest;
  genesis: RuntimeGenesis;
  state: AuthoritativeWorldState;
  replay: ReplayedRulesResult;
};

type AuthenticatedAuthorityViewer = {
  principalId: string;
  sessionVersion: number;
  seatId: string;
  characterIds: string[];
};

type AuthoritativeMovementContext = {
  encounterId: string;
  spatialRevision: `sha256:${string}`;
};

const AUTHORITY_BRANCH_ID = "branch:main";
const PRESENTATION_POLICY_VERSION = "observer-single-slot/v1";
const NARRATION_POLICY_VERSION = "kp-current-response/v3";
const BODY_ONLY_NARRATION_POLICY_VERSION = "kp-body-only-independent-audience/v1";
const AUTHORITATIVE_ARCHIVE_RETRY_DELAY_MS = 1_000;
const MAX_AUTHORITY_RANDOMNESS_WAVES = 64;
const MAX_AUTHORITY_RANDOMNESS_REQUESTS = 64;
const AUTHORITATIVE_ARCHIVE_NEXT_PAGE_DELAY_MS = 1;
const ROOM_DELETION_RECONCILE_DELAY_MS = 30_000;
const AUTHORITATIVE_GEAR_SLOTS = new Set([
  "head",
  "neck",
  "cloak",
  "armor",
  "hands",
  "belt",
  "boots",
  "ring1",
  "ring2",
  "main",
  "off",
  "ammo",
]);

class AuthorityArchiveSettlementPendingError extends Error {
  constructor() {
    super("Authoritative randomness must settle before this head is recoverable.");
    this.name = "AuthorityArchiveSettlementPendingError";
  }
}

type RoomDirectoryRow = {
  id: string;
  host_user_id: string;
  status: string;
};

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function publicProjectionQuery(value: unknown): ProjectionQuery | undefined {
  if (!isJsonRecord(value)) return undefined;
  const channels = [
    "realtime",
    "history",
    "reconnect",
    "error",
    "candidates",
    "voice",
    "transcript",
  ] as const;
  const channel = channels.find((candidate) => candidate === value.channel);
  return {
    ...(channel === undefined ? {} : { channel }),
    ...(nonEmptyString(value.referenceId) ? { referenceId: value.referenceId } : {}),
    ...(nonEmptyString(value.observedAtUnixMs) ? { observedAtUnixMs: value.observedAtUnixMs } : {}),
  };
}

function incrementalProjectionRequested(value: unknown): boolean {
  return isJsonRecord(value) && [
    "sinceEventSeq",
    "sinceStateHash",
    "sinceEventHash",
    "sinceProjectionHash",
  ].some((key) => Object.hasOwn(value, key));
}

function canonicalPublicEventSeq(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
  }
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)
    ? value
    : undefined;
}

function publicSha256(value: unknown): `sha256:${string}` | undefined {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value)
    ? value as `sha256:${string}`
    : undefined;
}

function hasExactJsonKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function hasOnlyJsonKeys(
  value: JsonRecord,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value)
    && Object.keys(value).every((key) => allowed.has(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function environmentStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(nonEmptyString) : [];
}

function environmentFeatureCandidates(
  state: AuthoritativeWorldState,
  sceneId: string,
): JsonRecord[] {
  const scene = state.combatRuntime.scenes[sceneId];
  const geometry = isJsonRecord(scene) && isJsonRecord(scene.geometry)
    ? scene.geometry
    : undefined;
  if (!Array.isArray(geometry?.obstacles)) return [];
  return geometry.obstacles.filter(isJsonRecord).filter((feature) => {
    if (!isJsonRecord(feature.environment)
      || !isJsonRecord(feature.environment.featureDefinition)) return false;
    const compiled = compileEnvironmentFeature(feature.environment.featureDefinition);
    return compiled.ok
      && compiled.artifact.tacticalFeature.featureId === feature.featureId
      && compiled.artifact.tacticalFeature.environment.profile.profileId
        === ENVIRONMENT_PROFILE.profileId
      && compiled.artifact.tacticalFeature.environment.profile.profileHash
        === ENVIRONMENT_PROFILE.profileHash
      && compiled.artifact.tacticalFeature.environment.featureDefinition.sceneId === sceneId;
  });
}

function selectEstablishedEnvironmentFeature(
  state: AuthoritativeWorldState,
  sceneId: string,
  draft: JsonRecord,
): string | undefined {
  const candidates = environmentFeatureCandidates(state, sceneId);
  const basisRefs = new Set(environmentStringList(draft.basisRefs));
  const referenced = candidates.filter((feature) =>
    nonEmptyString(feature.featureId) && basisRefs.has(feature.featureId));
  if (referenced.length === 1) return referenced[0]!.featureId as string;
  return undefined;
}

function canonicalRestAnswerArcaneRecoverySlotLevels(
  value: unknown,
  restKind: unknown,
): number[] | null {
  if (value === undefined) return [];
  if (
    !Array.isArray(value)
    || value.length > 20
    || !value.every((level) =>
      Number.isSafeInteger(level) && Number(level) >= 1 && Number(level) <= 5)
  ) return null;
  const levels = value.map(Number).sort((left, right) => left - right);
  return restKind === "long" && levels.length > 0 ? null : levels;
}

function canonicalCharacterResources(value: unknown): Record<string, number> | undefined {
  if (!isJsonRecord(value)) return undefined;
  const resources: Record<string, number> = {};
  for (const [resourceId, candidate] of Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right))) {
    if (!nonEmptyString(resourceId)) return undefined;
    if (Number.isSafeInteger(candidate) && Number(candidate) >= 0) {
      resources[resourceId] = Number(candidate);
      continue;
    }
    if (
      isJsonRecord(candidate)
      && Number.isSafeInteger(candidate.max)
      && Number(candidate.max) >= 0
      && (candidate.used === undefined
        || (Number.isSafeInteger(candidate.used) && Number(candidate.used) >= 0))
    ) {
      resources[resourceId] = Math.max(0, Number(candidate.max) - Number(candidate.used ?? 0));
    }
  }
  return resources;
}

function canonicalCharacterResourceMaximums(value: unknown): Record<string, number> | undefined {
  if (!isJsonRecord(value)) return undefined;
  const maximums: Record<string, number> = {};
  for (const [resourceId, candidate] of Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right))) {
    if (!nonEmptyString(resourceId)) return undefined;
    if (Number.isSafeInteger(candidate) && Number(candidate) >= 0) {
      maximums[resourceId] = Number(candidate);
      continue;
    }
    if (isJsonRecord(candidate) && Number.isSafeInteger(candidate.max) && Number(candidate.max) >= 0) {
      maximums[resourceId] = Number(candidate.max);
    }
  }
  return maximums;
}

function canonicalStringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(nonEmptyString)
    ? [...new Set(value)].sort()
    : undefined;
}

function canonicalCharacterLoadout(staticCard: JsonRecord): JsonObject | undefined {
  const supplied = isJsonRecord(staticCard.loadout) ? staticCard.loadout : undefined;
  const armorClass = supplied?.armorClass ?? staticCard.ac;
  const speedFeet = supplied?.speedFeet ?? staticCard.speed;
  const equippedSource = isJsonRecord(supplied?.equipped)
    ? supplied.equipped
    : isJsonRecord(staticCard.equipped) ? staticCard.equipped : {};
  const backpackSource = Array.isArray(supplied?.backpack)
    ? supplied.backpack
    : Array.isArray(staticCard.backpack) ? staticCard.backpack : [];
  if (
    !Number.isSafeInteger(armorClass)
    || Number(armorClass) < 1
    || Number(armorClass) > 99
    || !Number.isSafeInteger(speedFeet)
    || Number(speedFeet) <= 0
  ) return undefined;
  const equipped: Record<string, string> = {};
  for (const [slot, itemId] of Object.entries(equippedSource).sort(([left], [right]) =>
    left.localeCompare(right))) {
    if (itemId === undefined || itemId === null) continue;
    if (!nonEmptyString(slot) || !nonEmptyString(itemId)) return undefined;
    equipped[slot] = itemId;
  }
  const quantities = new Map<string, number>();
  for (const entry of backpackSource) {
    if (!isJsonRecord(entry) || !nonEmptyString(entry.itemId)) return undefined;
    const quantity = entry.quantity ?? entry.qty;
    if (!Number.isSafeInteger(quantity) || Number(quantity) <= 0) return undefined;
    quantities.set(entry.itemId, (quantities.get(entry.itemId) ?? 0) + Number(quantity));
  }
  return {
    armorClass: Number(armorClass),
    speedFeet: Number(speedFeet),
    equipped,
    backpack: [...quantities.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([itemId, quantity]) => ({ itemId, quantity })),
  };
}

type RulesCharacterSeed = JsonObject & {
  id: string;
  kind: "player" | "npc";
  name: string;
  sceneId: string;
  tenureStatus: "active" | "dead" | "retired" | "missing" | "npcTransitioned";
  characterBuild?: JsonObject;
};

function rulesCharacterFromStaticSeed(
  seed: AuthoritativeCharacterSeed,
  includeCharacterBuild = false,
  profiles?: RuntimeProfileManifest,
): RulesCharacterSeed | undefined {
  const staticCard = seed.staticCard;
  if (!nonEmptyString(staticCard.name) || !nonEmptyString(staticCard.sceneId)) return undefined;
  const scores = isJsonRecord(staticCard.abilityScores)
    ? staticCard.abilityScores
    : isJsonRecord(staticCard.scores) ? staticCard.scores : undefined;
  const abilityScores = scores !== undefined
    && hasExactJsonKeys(scores, ["cha", "con", "dex", "int", "str", "wis"])
    && Object.values(scores).every((score) =>
      Number.isSafeInteger(score) && Number(score) >= 1 && Number(score) <= 30)
    ? Object.fromEntries(Object.entries(scores).map(([ability, score]) => [ability, Number(score)]))
    : undefined;
  const proficiency = staticCard.proficiencyBonus ?? staticCard.proficiency;
  const skillSource = Array.isArray(staticCard.proficientSkills)
    ? staticCard.proficientSkills
    : Array.isArray(staticCard.skills) ? staticCard.skills : undefined;
  const proficientSkills = skillSource !== undefined
    && skillSource.every(nonEmptyString)
    && skillSource.length === new Set(skillSource).size
    ? [...skillSource].sort()
    : undefined;
  const proficiencyProfileEnabled = profiles !== undefined
    && characterProficiencyProfileEnabled(profiles.extensions);
  const expertiseCanonicalSource = Array.isArray(staticCard.expertiseSkills)
    ? staticCard.expertiseSkills
    : undefined;
  const expertiseAliasSource = Array.isArray(staticCard.expertise)
    ? staticCard.expertise
    : undefined;
  const expertiseCanonical = expertiseCanonicalSource === undefined
    ? undefined
    : canonicalStringList(expertiseCanonicalSource);
  const expertiseAlias = expertiseAliasSource === undefined
    ? undefined
    : canonicalStringList(expertiseAliasSource);
  if (proficiencyProfileEnabled && ((staticCard.expertiseSkills !== undefined
      && (expertiseCanonical === undefined
        || expertiseCanonical.length !== expertiseCanonicalSource?.length))
    || (staticCard.expertise !== undefined
      && (expertiseAlias === undefined || expertiseAlias.length !== expertiseAliasSource?.length))
    || (expertiseCanonical !== undefined
      && expertiseAlias !== undefined
      && JSON.stringify(expertiseCanonical) !== JSON.stringify(expertiseAlias)))) return undefined;
  const expertiseSkills = expertiseCanonical ?? expertiseAlias;
  const proficientSaves = staticCard.proficientSaves === undefined
    ? undefined
    : canonicalStringList(staticCard.proficientSaves);
  if (proficiencyProfileEnabled && staticCard.proficientSaves !== undefined
    && (proficientSaves === undefined
      || proficientSaves.length !== (staticCard.proficientSaves as unknown[]).length
      || proficientSaves.some((ability) =>
        !["str", "dex", "con", "int", "wis", "cha"].includes(ability)))) return undefined;
  if (proficiencyProfileEnabled
    && expertiseSkills?.some((skill) => !proficientSkills?.includes(skill))) return undefined;
  const hpSource = isJsonRecord(staticCard.hitPoints)
    ? staticCard.hitPoints
    : isJsonRecord(staticCard.hp) ? staticCard.hp : undefined;
  const hpMaximum = hpSource?.maximum ?? hpSource?.max;
  const hitPoints = hpSource !== undefined
    && Number.isSafeInteger(hpSource.current)
    && Number.isSafeInteger(hpMaximum)
    && Number(hpSource.current) >= 0
    && Number(hpMaximum) > 0
    && Number(hpSource.current) <= Number(hpMaximum)
    ? { current: Number(hpSource.current), maximum: Number(hpMaximum) }
    : undefined;
  const resources = canonicalCharacterResources(staticCard.resources);
  const resourceMaximums = canonicalCharacterResourceMaximums(staticCard.resources);
  const loadout = canonicalCharacterLoadout(staticCard);
  const cantripIds = canonicalStringList(staticCard.cantrips);
  const preparedSpellIds = canonicalStringList(staticCard.prepared);
  const featureIds = canonicalStringList(staticCard.features);
  return {
    id: seed.characterId,
    kind: "player",
    name: staticCard.name,
    sceneId: staticCard.sceneId,
    tenureStatus: "active",
    ...(Number.isSafeInteger(staticCard.level) && Number(staticCard.level) > 0
      ? { level: Number(staticCard.level) }
      : {}),
    ...(hitPoints === undefined ? {} : { hitPoints }),
    ...(resources === undefined ? {} : { resources }),
    ...(resourceMaximums === undefined ? {} : { resourceMaximums }),
    ...(abilityScores === undefined ? {} : { abilityScores }),
    ...(nonEmptyString(staticCard.classId) ? { classId: staticCard.classId } : {}),
    ...(nonEmptyString(staticCard.raceId) ? { raceId: staticCard.raceId } : {}),
    ...(nonEmptyString(staticCard.subclassId) ? { subclassId: staticCard.subclassId } : {}),
    ...(cantripIds === undefined ? {} : { cantripIds }),
    ...(preparedSpellIds === undefined ? {} : { preparedSpellIds }),
    ...(featureIds === undefined ? {} : { featureIds }),
    ...(Number.isSafeInteger(proficiency)
      && Number(proficiency) >= 0
      && Number(proficiency) <= 12
      ? { proficiencyBonus: Number(proficiency) }
      : {}),
    ...(proficientSkills === undefined ? {} : { proficientSkills }),
    ...(proficiencyProfileEnabled && expertiseSkills !== undefined ? { expertiseSkills } : {}),
    ...(proficiencyProfileEnabled && proficientSaves !== undefined ? { proficientSaves } : {}),
    ...(loadout === undefined ? {} : { loadout }),
    ...(includeCharacterBuild ? { characterBuild: structuredClone(staticCard) } : {}),
  };
}

function randomId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function isCanonicalAuthorityRecoveryInput(value: unknown): value is JsonRecord {
  if (!isJsonRecord(value) || !nonEmptyString(value.kind)) return false;
  if (value.kind === "invokeEnvironmentalStunt") {
    if (!hasOnlyJsonKeys(value, [
      "actorCharacterId", "controllerPrincipalId", "featureId", "kind", "rootActionId",
      "actionLanguageHash", "actionPlanVersion", "causalActionProgram",
    ], ["abilityRef", "activation", "materialization", "resourceCost"])
      || ![
        value.actorCharacterId,
        value.controllerPrincipalId,
        value.featureId,
        value.rootActionId,
      ].every(nonEmptyString)
      || !isJsonRecord(value.activation)
      || !nonEmptyString(value.activation.kind)
      || !nonEmptyString(value.actionLanguageHash)
      || !nonEmptyString(value.actionPlanVersion)
      || !isJsonRecord(value.causalActionProgram)
      || !validateCausalActionProgram(value.causalActionProgram).ok
      || value.causalActionProgram.formRef !== "environmental-stunt.v1"
      || value.actionLanguageHash !== value.causalActionProgram.languageHash
      || value.actionPlanVersion !== value.causalActionProgram.languageRef) return false;
    if (value.activation.kind === "attack") {
      if (!hasExactJsonKeys(value.activation, ["kind"]) || !nonEmptyString(value.abilityRef)) {
        return false;
      }
    } else if (value.activation.kind === "direct") {
      if (!hasExactJsonKeys(value.activation, ["kind"]) || value.abilityRef !== undefined) return false;
    } else if (value.activation.kind === "check") {
      if (!hasExactJsonKeys(value.activation, ["ability", "dc", "kind", "mode", "skill"])
        || value.abilityRef !== undefined) return false;
    } else return false;
    if (value.materialization !== undefined) {
      if (!isJsonRecord(value.materialization)
        || !hasExactJsonKeys(value.materialization, ["featureDefinition"])
        || !compileEnvironmentFeature(value.materialization.featureDefinition).ok) return false;
    }
    if (value.resourceCost !== undefined && (
      !isJsonRecord(value.resourceCost)
      || !hasExactJsonKeys(value.resourceCost, ["amount", "resourceRef"])
      || !nonEmptyString(value.resourceCost.resourceRef)
      || !Number.isSafeInteger(value.resourceCost.amount)
      || Number(value.resourceCost.amount) <= 0
    )) return false;
    return true;
  }
  if (value.kind === "resolveCompoundActionPlan") {
    return value.actionPlanVersion === "authoritative-kp-action-plan-v1"
      || isCanonicalV3CausalRulesInput(value);
  }
  if (value.kind === "resolveDueActorPlan") {
    return value.decision === "execute"
      && nonEmptyString(value.proposalId)
      && nonEmptyString(value.planId)
      && isJsonRecord(value.mechanicalProposal);
  }
  if (value.kind !== "answerPendingInput") return false;
  if (value.proposal === undefined) return true;
  return isJsonRecord(value.proposal)
    && value.proposal.kind === "resolveCompoundActionPlan"
    && (value.proposal.actionPlanVersion === "authoritative-kp-action-plan-v1"
      || isCanonicalV3CausalRulesInput(value.proposal));
}

async function verifiedAuthorityCommitRecovery(
  row: AuthorityProposalRecoveryRow,
): Promise<AuthorityCommitRecovery | undefined> {
  let recovery: AuthorityCommitRecovery;
  try {
    recovery = parseJson<AuthorityCommitRecovery>(row.recovery_json);
  } catch {
    return undefined;
  }
  if (
    !isJsonRecord(recovery)
    || !hasOnlyJsonKeys(recovery, [
      "answeredPendingInputId",
      "forceConcluded",
      "receiptExtras",
      "rulesInput",
    ], ["initialRandomnessRootActionId"])
    || !isCanonicalAuthorityRecoveryInput(recovery.rulesInput)
    || !(recovery.answeredPendingInputId === null
      || nonEmptyString(recovery.answeredPendingInputId))
    || !(recovery.receiptExtras === null || isJsonRecord(recovery.receiptExtras))
    || typeof recovery.forceConcluded !== "boolean"
    || (recovery.initialRandomnessRootActionId !== undefined
      && !nonEmptyString(recovery.initialRandomnessRootActionId))
    || await authorityHash({ proposalHash: row.proposal_hash, recovery }) !== row.recovery_hash
  ) return undefined;
  return recovery;
}

function rejectedAuthority(
  code: string,
  explanation: string,
): Extract<AuthorityCommitOutcome, { kind: "rejected" }> {
  return { kind: "rejected", code, explanation };
}

function presentationUnavailable(): Extract<AuthorityCommitOutcome, { kind: "rejected" }> {
  return rejectedAuthority(
    "presentationUnavailable",
    "当前呈现不可用，请保持在已提交的稳定状态。",
  );
}

function narrationRecoveryUnavailable(): Extract<AuthorityCommitOutcome, { kind: "rejected" }> {
  return rejectedAuthority(
    "narrationRecoveryUnavailable",
    "The viewer-local narration recovery is unavailable.",
  );
}

function hasActiveSafetyPause(state: AuthoritativeWorldState): boolean {
  return Object.values(state.multiplayerRuntime.safetyPresentations)
    .some((entry) => entry.status === "paused");
}

function hasUnsettledAuthoritativeRandomness(state: AuthoritativeWorldState): boolean {
  return Object.keys(state.internalContinuations).length > 0
    || Object.keys(state.combatRuntime.randomnessResolutions).length > 0;
}

function compareEventSeq(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

export class RoomDurableObject extends DurableObject<Env> {
  private readonly bindings: Env;
  private readonly authorityStore: AuthoritativeRoomStore;
  private authorityArchiveDatabaseOverride: D1Database | undefined;
  private authorityDeletionDatabaseOverride: D1Database | undefined;
  private authorityArchiveFlight: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.bindings = env;
    this.authorityStore = new AuthoritativeRoomStore(ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          room_id TEXT NOT NULL UNIQUE,
          module_id TEXT NOT NULL,
          ruleset_version TEXT NOT NULL,
          state_json TEXT NOT NULL,
          scope_versions_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS world_events (
          version INTEGER PRIMARY KEY,
          event_id TEXT NOT NULL UNIQUE,
          command_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          fiction_seconds INTEGER NOT NULL,
          event_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS world_events_command_idx
          ON world_events(command_id, version);
        CREATE TABLE IF NOT EXISTS commands (
          command_id TEXT PRIMARY KEY,
          result_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS turn_tickets (
          id TEXT PRIMARY KEY,
          actor_id TEXT NOT NULL,
          state_version INTEGER NOT NULL,
          scope_versions_json TEXT NOT NULL,
          projection_json TEXT NOT NULL,
          status TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS turn_tickets_expiry_idx
          ON turn_tickets(status, expires_at);
        CREATE TABLE IF NOT EXISTS ux_status (
          scope_id TEXT PRIMARY KEY,
          phase TEXT NOT NULL,
          ticket_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ux_status_expiry_idx
          ON ux_status(expires_at);
      `);
      this.authorityStore.ensureSchema();
      // Alarm state is durable, but recomputing the minimum on construction
      // also repairs a crash between persisting an archive task and setAlarm.
      await this.scheduleExpiryAlarm();
    });
  }

  private roomRow(): RoomRow {
    const row = this.ctx.storage.sql
      .exec<RoomRow>(
        `SELECT room_id, module_id, ruleset_version, state_json, scope_versions_json
         FROM room_state WHERE singleton = 1`,
      )
      .toArray()[0];
    if (!row) throw new Error("房间尚未初始化");
    return row;
  }

  private definition(moduleId: string) {
    const mod = findModule(moduleId);
    if (!mod) throw new Error(`未知模组：${moduleId}`);
    return mod;
  }

  private cleanupExpired(nowMs: number) {
    this.ctx.storage.sql.exec(
      "UPDATE turn_tickets SET status = 'expired' WHERE status = 'open' AND expires_at <= ?",
      nowMs,
    );
    this.ctx.storage.sql.exec("DELETE FROM ux_status WHERE expires_at <= ?", nowMs);
  }

  private async scheduleExpiryAlarm() {
    if (this.authorityStore.roomDeletion() !== undefined) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_DELETION_RECONCILE_DELAY_MS);
      return;
    }
    const row = this.ctx.storage.sql
      .exec<{ expires_at: number | null }>(`
        SELECT MIN(expires_at) AS expires_at FROM (
          SELECT expires_at FROM turn_tickets WHERE status = 'open'
          UNION ALL
          SELECT expires_at FROM ux_status
        )
      `)
      .toArray()[0];
    const expiryAt = row?.expires_at ?? null;
    const archiveAt = this.authorityStore.archiveAlarmAt();
    const nextAlarmAt = expiryAt === null
      ? archiveAt
      : archiveAt === null
        ? expiryAt
        : Math.min(expiryAt, archiveAt);
    if (nextAlarmAt !== null) await this.ctx.storage.setAlarm(nextAlarmAt);
    else await this.ctx.storage.deleteAlarm();
  }

  private async archiveEvents(roomId: string, events: WorldEvent[]) {
    if (this.authorityStore.roomDeletion() !== undefined) return;
    const db = (this.bindings as unknown as { DB?: D1Database }).DB;
    if (!db || !events.length) return;
    await db.batch(
      events.map((event) =>
        db.prepare(
          `INSERT OR IGNORE INTO room_event_archive (
             room_id, version, event_id, command_id, event_type, fiction_seconds, event_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          roomId,
          event.version,
          event.id,
          event.commandId,
          event.type,
          event.atSeconds,
          JSON.stringify(event),
        ),
      ),
    );
  }

  private async archiveAllRoomEvents() {
    const row = this.roomRow();
    await this.archiveEvents(
      row.room_id,
      this.getEvents().map((entry) => entry.event),
    );
  }

  private authoritativeReplay(): AuthorityReplay {
    const room = this.authorityStore.room();
    if (room === undefined) throw new Error("authoritative-v2 room has not been initialized");
    const genesis = parseJson<RuntimeGenesis>(room.genesis_json);
    const replayed = replayAuthoritative(genesis, this.authorityStore.events());
    if (replayed.kind !== "replayed") {
      throw new Error(`authoritative-v2 replay rejected: ${replayed.rejection.code}`);
    }
    return {
      profiles: replayed.profiles,
      genesis,
      state: replayed.state as AuthoritativeWorldState,
      replay: replayed,
    };
  }

  private authorityStateBeforeEventRange(
    replay: AuthorityReplay,
    events: EventEnvelope[],
  ): AuthoritativeWorldState | undefined {
    const first = events[0];
    if (first === undefined) return undefined;
    if ((BigInt(replay.state.version) + 1n).toString() === first.eventSeq) {
      return replay.state;
    }
    const prefix = this.authorityStore.events()
      .filter((event) => BigInt(event.eventSeq) < BigInt(first.eventSeq));
    const reconstructed = replayAuthoritative(replay.genesis, prefix);
    return reconstructed.kind === "replayed"
      ? reconstructed.state as AuthoritativeWorldState
      : undefined;
  }

  private authoritySceneIdAtEventSeq(
    replay: AuthorityReplay,
    characterId: string,
    eventSeq: string,
  ): string | undefined {
    if (replay.replay.head.eventSeq === eventSeq) {
      return replay.state.entities[characterId]?.sceneId;
    }
    let cursor: bigint;
    try {
      cursor = BigInt(eventSeq);
    } catch {
      return undefined;
    }
    const prefix = this.authorityStore.events()
      .filter((event) => BigInt(event.eventSeq) <= cursor);
    if (cursor > 0n && prefix[prefix.length - 1]?.eventSeq !== eventSeq) return undefined;
    const reconstructed = replayAuthoritative(replay.genesis, prefix);
    return reconstructed.kind === "replayed"
      ? (reconstructed.state as AuthoritativeWorldState).entities[characterId]?.sceneId
      : undefined;
  }

  private authorityDeliveryFrameSceneIds(
    replay: AuthorityReplay,
    characterId: string,
    slot: AuthorityDeliverySlotRow,
    frame: DeliveryFrame,
  ): string[] {
    if (frame.sceneIds?.length) return uniqueSceneIds(frame.sceneIds);
    const receipt = this.authorityStore.receipt(frame.receiptId);
    if (receipt?.eventRange !== null && receipt?.eventRange !== undefined) {
      let priorEventSeq: string | undefined;
      try {
        const first = BigInt(receipt.eventRange.first);
        priorEventSeq = first > 0n ? (first - 1n).toString() : "0";
      } catch {
        priorEventSeq = undefined;
      }
      const receiptSceneIds = uniqueSceneIds([
        priorEventSeq === undefined
          ? undefined
          : this.authoritySceneIdAtEventSeq(replay, characterId, priorEventSeq),
        this.authoritySceneIdAtEventSeq(replay, characterId, receipt.eventRange.last),
      ]);
      if (receiptSceneIds.length > 0) return receiptSceneIds;
    }
    const sourceSceneId = this.authoritySceneIdAtEventSeq(
      replay,
      characterId,
      slot.source_event_seq,
    );
    return sourceSceneId === undefined ? [] : [sourceSceneId];
  }

  private authorityIncrementalProjectionQuery(
    replay: AuthorityReplay,
    query: unknown,
  ): ProjectionQuery | "invalid" | undefined {
    if (!incrementalProjectionRequested(query)) return publicProjectionQuery(query);
    if (!isJsonRecord(query)) return "invalid";
    const sinceEventSeq = canonicalPublicEventSeq(query.sinceEventSeq);
    if (sinceEventSeq === undefined) return "invalid";

    const optionalHashes = [
      ["sinceStateHash", query.sinceStateHash],
      ["sinceEventHash", query.sinceEventHash],
      ["sinceProjectionHash", query.sinceProjectionHash],
    ] as const;
    for (const [key, value] of optionalHashes) {
      if (Object.hasOwn(query, key) && publicSha256(value) === undefined) return "invalid";
    }

    const cursor = BigInt(sinceEventSeq);
    const head = BigInt(replay.replay.head.eventSeq);
    if (cursor > head) return "invalid";
    const allEvents = this.authorityStore.events();
    const prefix = allEvents.filter((event) => BigInt(event.eventSeq) <= cursor);
    if (
      cursor > 0n
      && prefix[prefix.length - 1]?.eventSeq !== sinceEventSeq
    ) return "invalid";
    const reconstructed = replayAuthoritative(replay.genesis, prefix);
    if (
      reconstructed.kind !== "replayed"
      || reconstructed.head.eventSeq !== sinceEventSeq
    ) return "invalid";

    return {
      ...publicProjectionQuery(query),
      incrementalRange: {
        priorState: reconstructed.state as AuthoritativeWorldState,
        events: allEvents.filter((event) => BigInt(event.eventSeq) > cursor),
        expectedFrom: {
          eventSeq: sinceEventSeq,
          ...(publicSha256(query.sinceStateHash) === undefined
            ? {}
            : { stateHash: publicSha256(query.sinceStateHash) }),
          ...(publicSha256(query.sinceEventHash) === undefined
            ? {}
            : { eventHash: publicSha256(query.sinceEventHash) }),
          ...(publicSha256(query.sinceProjectionHash) === undefined
            ? {}
            : { projectionHash: publicSha256(query.sinceProjectionHash) }),
        },
      },
    };
  }

  private authenticatedAuthorityViewer(
    context: unknown,
    state: AuthoritativeWorldState,
  ): AuthenticatedAuthorityViewer | undefined {
    if (
      !isJsonRecord(context)
      || !isJsonRecord(context.principal)
      || !nonEmptyString(context.principal.id)
      || !Number.isSafeInteger(context.principal.sessionVersion)
    ) {
      return undefined;
    }
    const principalId = context.principal.id;
    const sessionVersion = context.principal.sessionVersion as number;
    if (state.principals[principalId]?.sessionVersion !== sessionVersion) return undefined;
    const seats = Object.values(state.seats)
      .filter((seat) => seat.principalId === principalId && seat.status === "active")
      .sort((left, right) => left.id.localeCompare(right.id));
    if (seats.length === 0) return undefined;
    const seatIds = new Set(seats.map((seat) => seat.id));
    const characterIds = Object.values(state.characterControls)
      .filter((control) => seatIds.has(control.seatId))
      .map((control) => control.characterId)
      .filter((characterId) => state.entities[characterId]?.tenureStatus === "active")
      .sort();
    return { principalId, sessionVersion, seatId: seats[0].id, characterIds };
  }

  private authorityPlayerViewer(
    authenticated: AuthenticatedAuthorityViewer,
    state: AuthoritativeWorldState,
    characterId: string,
  ): PlayerViewer | undefined {
    if (!authenticated.characterIds.includes(characterId)) return undefined;
    const control = state.characterControls[characterId];
    if (control === undefined) return undefined;
    return {
      kind: "player",
      principalId: authenticated.principalId,
      sessionVersion: authenticated.sessionVersion,
      seatId: control.seatId,
      characterId,
    };
  }

  private formerCharactersForViewer(
    authenticated: AuthenticatedAuthorityViewer,
    state: AuthoritativeWorldState,
  ) {
    const seatIds = new Set(Object.values(state.seats)
      .filter((seat) => seat.principalId === authenticated.principalId && seat.status === "active")
      .map((seat) => seat.id));
    return Object.values(state.entities)
      .filter((character) => character.lastControllerSeatId !== undefined
        && seatIds.has(character.lastControllerSeatId)
        && ["dead", "retired", "missing", "npcTransitioned"].includes(character.tenureStatus))
      .sort((left, right) => Number(right.entityOrdinal) - Number(left.entityOrdinal));
  }

  private formerAuthorityPlayerViewer(
    authenticated: AuthenticatedAuthorityViewer,
    state: AuthoritativeWorldState,
    characterId: string,
  ): PlayerViewer | undefined {
    if (authenticated.characterIds.length !== 0) return undefined;
    const formerCharacter = this.formerCharactersForViewer(authenticated, state)
      .find((character) => character.id === characterId);
    const seatId = formerCharacter?.lastControllerSeatId;
    if (!nonEmptyString(seatId)) return undefined;
    const seat = state.seats[seatId];
    if (
      seat?.status !== "active"
      || seat.principalId !== authenticated.principalId
    ) return undefined;
    return {
      kind: "player",
      purpose: "lifecycle",
      principalId: authenticated.principalId,
      sessionVersion: authenticated.sessionVersion,
      seatId,
      characterId,
    };
  }

  private authorityViewerForCharacter(
    state: AuthoritativeWorldState,
    characterId: string,
  ): PlayerViewer | undefined {
    const control = state.characterControls[characterId];
    const seat = control === undefined ? undefined : state.seats[control.seatId];
    const principal = seat === undefined ? undefined : state.principals[seat.principalId];
    if (seat?.status !== "active" || principal === undefined) return undefined;
    return {
      kind: "player",
      principalId: principal.id,
      sessionVersion: principal.sessionVersion,
      seatId: seat.id,
      characterId,
    };
  }

  private projectAuthorityViewer(
    replay: AuthorityReplay,
    viewer: PlayerViewer,
    query?: ProjectionQuery,
  ): JsonObject | undefined {
    const projection = projectAuthoritative(replay.profiles, replay.state, viewer, query);
    return projection.kind === "rejected" ? undefined : projection as unknown as JsonObject;
  }

  private authoritativeMovementContext(
    replay: AuthorityReplay,
    authenticated: AuthenticatedAuthorityViewer,
    characterId: string,
  ): AuthoritativeMovementContext | undefined {
    const viewer = this.authorityPlayerViewer(authenticated, replay.state, characterId);
    const projection = viewer === undefined
      ? undefined
      : this.projectAuthorityViewer(replay, viewer);
    const tactical = isJsonRecord(projection?.tacticalProjection)
      ? projection.tacticalProjection
      : undefined;
    const self = isJsonRecord(tactical?.self) ? tactical.self : undefined;
    const encounter = isJsonRecord(tactical?.encounter) ? tactical.encounter : undefined;
    if (
      self?.id !== characterId
      || !isTacticalSpatialRevision(tactical?.spatialRevision)
      || !nonEmptyString(encounter?.id)
      || !Array.isArray(encounter.participantEntityIds)
      || !encounter.participantEntityIds.includes(characterId)
    ) return undefined;
    return {
      encounterId: encounter.id,
      spatialRevision: tactical.spatialRevision,
    };
  }

  /** Resolve an unfinished V3 narration solely from the current trusted
   * ViewerKey and the frozen private delivery journal. No caller-supplied
   * Audience, projection, Receipt, or generation participates in selection. */
  private viewerNarrationRecoveryRecord(
    replay: AuthorityReplay,
    viewer: PlayerViewer,
    capability?: string,
  ): {
    audience: AuthorityDeliveryAudienceRow;
    binding: DeliveryAudienceBinding;
    plan: DeliveryPlan;
    planRow: AuthorityDeliveryPlanRow;
    receipt: PublicReceipt;
    stale: boolean;
  } | undefined {
    const viewerKey = `${viewer.principalId}\u001f${viewer.characterId}`;
    const audience = capability === undefined
      ? this.authorityStore.recoverableDeliveryAudience(viewerKey)
      : this.authorityStore.deliveryAudiences(capability)
          .find((candidate) => candidate.viewer_key === viewerKey);
    if (audience === undefined) return undefined;
    const planRow = this.authorityStore.deliveryPlan(audience.publish_capability);
    if (planRow === undefined || planRow.status !== "open") return undefined;
    let plan: DeliveryPlan;
    try {
      plan = parseJson<DeliveryPlan>(planRow.plan_json);
    } catch {
      return undefined;
    }
    if (plan.publishCapability !== planRow.publish_capability) return undefined;
    if (!exactProfileRef(
      deliveryProtocolForPlan(plan),
      INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE,
    )) return undefined;
    const binding = plan.audiences.find((candidate) =>
      candidate.audienceId === audience.audience_id
      && candidate.principalId === viewer.principalId
      && candidate.characterId === viewer.characterId
      && candidate.sessionVersion === viewer.sessionVersion
      && candidate.seatId === viewer.seatId
      && candidate.projectionHash === audience.projection_hash
      && `${candidate.principalId}\u001f${candidate.characterId}` === audience.viewer_key);
    if (binding === undefined) return undefined;
    const receipt = this.authorityStore.receipt(plan.receiptId);
    if (
      receipt === undefined
      || receipt.rootActionId !== plan.rootActionId
      || (receipt.status !== "committed" && receipt.status !== "concluded")
    ) return undefined;
    const watermark = this.authorityStore.deliveryWatermark(viewerKey);
    return {
      audience,
      binding,
      plan,
      planRow,
      receipt,
      stale: watermark !== undefined
        && compareEventSeq(watermark, planRow.source_event_seq) > 0,
    };
  }

  private authenticatedViewerNarrationRecoveryRecord(
    replay: AuthorityReplay,
    authenticated: AuthenticatedAuthorityViewer,
    capability: string,
  ) {
    if (authenticated.characterIds.length === 1) {
      const viewer = this.authorityPlayerViewer(
        authenticated,
        replay.state,
        authenticated.characterIds[0],
      );
      return viewer === undefined
        ? undefined
        : this.viewerNarrationRecoveryRecord(replay, viewer, capability);
    }
    if (authenticated.characterIds.length !== 0) return undefined;
    return this.authenticatedFormerViewerNarrationRecovery(
      replay,
      authenticated,
      capability,
    )?.recovery;
  }

  private authenticatedFormerViewerNarrationRecovery(
    replay: AuthorityReplay,
    authenticated: AuthenticatedAuthorityViewer,
    capability?: string,
  ) {
    if (authenticated.characterIds.length !== 0) return undefined;
    const candidates = capability === undefined
      ? this.authorityStore.recoverableDeliveryAudiencesForPrincipal(
          authenticated.principalId,
        )
      : this.authorityStore.deliveryAudiences(capability);
    for (const audience of candidates) {
      const planRow = this.authorityStore.deliveryPlan(audience.publish_capability);
      if (planRow === undefined || planRow.status !== "open") continue;
      let plan: DeliveryPlan;
      try {
        plan = parseJson<DeliveryPlan>(planRow.plan_json);
      } catch {
        continue;
      }
      const binding = plan.audiences.find((candidate) =>
        candidate.audienceId === audience.audience_id
        && candidate.principalId === authenticated.principalId
        && candidate.sessionVersion === authenticated.sessionVersion
        && candidate.projectionHash === audience.projection_hash
        && `${candidate.principalId}\u001f${candidate.characterId}` === audience.viewer_key);
      if (binding === undefined) continue;
      const seat = replay.state.seats[binding.seatId];
      if (
        seat?.status !== "active"
        || seat.principalId !== authenticated.principalId
        || replay.state.entities[binding.characterId] === undefined
        || replay.state.characterControls[binding.characterId]?.seatId === binding.seatId
      ) continue;
      const viewer: PlayerViewer = {
        kind: "player",
        principalId: binding.principalId,
        sessionVersion: binding.sessionVersion,
        seatId: binding.seatId,
        characterId: binding.characterId,
      };
      const recovery = this.viewerNarrationRecoveryRecord(
        replay,
        viewer,
        audience.publish_capability,
      );
      if (
        recovery !== undefined
        && (capability !== undefined
          || (!recovery.stale
            && ["pending", "rejected", "retryableFailure"].includes(recovery.audience.status)))
      ) return { recovery, viewer };
    }
    return undefined;
  }

  private viewerNarrationRecovery(
    replay: AuthorityReplay,
    viewer: PlayerViewer,
  ) {
    const recovery = this.viewerNarrationRecoveryRecord(replay, viewer);
    return recovery === undefined
      || recovery.stale
      || !["pending", "rejected", "retryableFailure"].includes(recovery.audience.status)
      ? undefined
      : {
          kind: "available" as const,
          capability: recovery.plan.publishCapability,
          state: recovery.audience.status as "pending" | "rejected" | "retryableFailure",
        };
  }

  private experiencedTranscriptForViewer(
    viewer: PlayerViewer,
    state: AuthoritativeWorldState,
    currentActorMessage?: {
      messageId?: string;
      characterId: string;
      name: string;
      body: string;
      sceneIds: string[];
    },
  ): JsonObject {
    const viewerKey = `${viewer.principalId}\u001f${viewer.characterId}`;
    const currentSceneId = state.entities[viewer.characterId]?.sceneId;
    const messages = (currentSceneId === undefined
      ? this.authorityStore.experiencedMessages(viewerKey, 48)
      : this.authorityStore.experiencedMessagesForScene(viewerKey, currentSceneId, 48))
      .map((message) => ({
        messageId: message.messageId,
        kind: message.kind,
        speakerCharacterId: message.speakerCharacterId,
        speakerName: message.speakerName,
        body: message.body,
        sceneIds: [...message.sceneIds],
        sourceEventSeq: message.sourceEventSeq,
        receiptId: message.receiptId,
      } satisfies JsonObject));
    const seen = new Set(messages.map((message) => String(message.messageId)));
    const slot = this.authorityStore.deliverySlot(viewerKey);
    if (slot !== undefined) {
      const frame = parseJson<DeliveryFrame>(slot.frame_json);
      const sceneIds = frame.sceneIds?.length
        ? [...frame.sceneIds]
        : currentSceneId === undefined ? [] : [currentSceneId];
      if (
        !seen.has(frame.deliveryId)
        && (currentSceneId === undefined || sceneIds.includes(currentSceneId))
      ) {
        messages.push({
          messageId: frame.deliveryId,
          kind: "kp",
          speakerCharacterId: null,
          speakerName: "KP",
          body: frame.text,
          sceneIds,
          sourceEventSeq: slot.source_event_seq,
          receiptId: frame.receiptId,
        });
        seen.add(frame.deliveryId);
      }
    }
    if (
      currentActorMessage?.characterId === viewer.characterId
      && (currentSceneId === undefined || currentActorMessage.sceneIds.includes(currentSceneId))
    ) {
      const messageId = currentActorMessage.messageId
        ?? `action:current:${currentActorMessage.characterId}`;
      if (!seen.has(messageId)) {
        messages.push({
          messageId,
          kind: "player",
          speakerCharacterId: currentActorMessage.characterId,
          speakerName: currentActorMessage.name,
          body: currentActorMessage.body,
          sceneIds: [...currentActorMessage.sceneIds],
          sourceEventSeq: "current",
          receiptId: "current",
        });
      }
    }
    return {
      schema: "zhuwei.experienced-transcript/v1",
      sceneId: currentSceneId ?? "unknown",
      messages: messages.slice(-48),
    };
  }

  private experiencedObservationTranscript(viewerKey: string, sceneId?: string) {
    const latest = this.authorityStore.experiencedMessages(viewerKey, 120);
    if (!nonEmptyString(sceneId)) return latest;
    const currentScene = this.authorityStore.experiencedMessagesForScene(
      viewerKey,
      sceneId,
      120,
    );
    const merged = new Map(latest.map((message) => [message.messageId, message]));
    for (const message of currentScene) merged.set(message.messageId, message);
    return [...merged.values()].sort((left, right) => left.ordinal - right.ordinal);
  }

  private kpAuthorityProjection(
    replay: AuthorityReplay,
    actorViewer: PlayerViewer,
    moduleProjection: JsonObject,
  ): JsonObject | undefined {
    const actorProjection = this.projectAuthorityViewer(replay, actorViewer);
    if (actorProjection === undefined) return undefined;
    const kpViewer: KpViewer = {
      kind: "kp",
      capability: "internal:kp-spatial-evidence",
    };
    const kpProjection = projectAuthoritative(replay.profiles, replay.state, kpViewer);
    if (kpProjection.kind === "rejected" || !("spatialEvidence" in kpProjection)) return undefined;
    const npcViewers: Record<string, JsonObject> = {};
    for (const npc of Object.values(replay.state.entities)
      .filter((entry) => entry.kind === "npc" && entry.tenureStatus === "active")
      .sort((left, right) => left.id.localeCompare(right.id))) {
      const viewer: NpcViewer = {
        kind: "npc",
        npcId: npc.id,
        purpose: "kpDecision",
        capability: "internal:npc-limited-knowledge",
      };
      const projection = projectAuthoritative(replay.profiles, replay.state, viewer);
      if (projection.kind === "rejected") return undefined;
      npcViewers[npc.id] = projection as unknown as JsonObject;
    }
    return {
      ...moduleProjection,
      viewer: { kind: "kp" },
      actorProjection: roomPlayerProjection(actorProjection, actorViewer.characterId),
      npcViewers,
      ...(kpProjection.adjudicationPrecedents === undefined
        ? {}
        : { adjudicationPrecedents: kpProjection.adjudicationPrecedents }),
      spatialEvidence: kpProjection.spatialEvidence as unknown as JsonObject,
      experiencedTranscript: this.experiencedTranscriptForViewer(
        actorViewer,
        replay.state,
      ),
    };
  }

  private async pinnedAuthorityModule(replay: AuthorityReplay): Promise<AuthoritativeModuleProfile | undefined> {
    const row = this.authorityStore.room();
    if (row === undefined) return undefined;
    const currentModuleRef = replay.state.campaignRuntime.campaign?.moduleRef;
    if (!isJsonRecord(currentModuleRef)) return undefined;
    const profileId = nonEmptyString(currentModuleRef.profileId)
      ? currentModuleRef.profileId
      : undefined;
    if (profileId === undefined) return undefined;
    const prefix = `module:${row.module_id}:`;
    if (!profileId.startsWith(prefix)) return undefined;
    try {
      const profile = await authoritativeModuleProfile(row.module_id, profileId.slice(prefix.length));
      return profile.moduleRef.profileHash === currentModuleRef.profileHash
        ? profile
        : undefined;
    } catch {
      return undefined;
    }
  }

  private async authorityReceiptReferences(): Promise<ArchiveReceiptReference[]> {
    const references: ArchiveReceiptReference[] = [];
    for (const receipt of this.authorityStore.receipts()
      .sort((left, right) => left.receiptId.localeCompare(right.receiptId))) {
      const storedReference = receipt as unknown as JsonRecord;
      const commitments = Array.isArray(receipt.randomnessCommitments)
        ? receipt.randomnessCommitments
        : [];
      const randomnessCommitmentHash = nonEmptyString(storedReference.randomnessCommitmentHash)
        && /^sha256:[0-9a-f]{64}$/.test(storedReference.randomnessCommitmentHash)
        ? storedReference.randomnessCommitmentHash as `sha256:${string}`
        : await authorityHash(commitments);
      references.push({
        receiptId: receipt.receiptId,
        rootActionId: receipt.rootActionId,
        ...(receipt.actorCharacterId === undefined
          ? {}
          : { actorCharacterId: receipt.actorCharacterId }),
        status: receipt.status,
        activeBranchId: receipt.activeBranchId,
        eventRange: receipt.eventRange === null
          ? null
          : { first: receipt.eventRange.first, last: receipt.eventRange.last },
        scopeVersions: receipt.scopeVersions ?? {},
        randomnessCommitmentHash,
        ...(receipt.correctionId === undefined ? {} : { correctionId: receipt.correctionId }),
      });
    }
    return references;
  }

  private async authorityProjectionAudits(
    replay: AuthorityReplay,
  ): Promise<ArchiveProjectionAudit[]> {
    const audits: ArchiveProjectionAudit[] = [];
    for (const character of Object.values(replay.state.entities)
      .filter((entry) => entry.kind === "player" && entry.tenureStatus === "active")
      .sort((left, right) => left.id.localeCompare(right.id))) {
      const viewer = this.authorityViewerForCharacter(replay.state, character.id);
      if (viewer === undefined) continue;
      const projection = projectAuthoritative(replay.profiles, replay.state, viewer);
      if (!isObserverProjection(projection)) continue;
      audits.push({
        eventSeq: replay.replay.head.eventSeq,
        viewerHash: await authorityHash(viewer),
        projectionHash: projection.projectionHash,
      });
    }
    return audits;
  }

  private async currentAuthoritativeArchive(): Promise<AuthoritativeRoomArchive> {
    const replay = this.authoritativeReplay();
    if (hasUnsettledAuthoritativeRandomness(replay.state)) {
      throw new AuthorityArchiveSettlementPendingError();
    }
    const events = this.authorityStore.events();
    const receiptRefs = await this.authorityReceiptReferences();
    const projectionAudits = await this.authorityProjectionAudits(replay);
    const current = this.authoritativeReplay();
    if (
      hasUnsettledAuthoritativeRandomness(current.state)
      || current.replay.head.eventHash !== replay.replay.head.eventHash
      || current.replay.head.stateHash !== replay.replay.head.stateHash
    ) {
      throw new AuthorityArchiveSettlementPendingError();
    }
    return buildAuthoritativeArchive({
      roomId: replay.state.roomId,
      signedGenesis: replay.genesis,
      events,
      receiptRefs,
      projectionAudits,
    });
  }

  private authorityArchiveDatabase(): D1Database | undefined {
    return this.authorityArchiveDatabaseOverride
      ?? (this.bindings as unknown as { DB?: D1Database }).DB;
  }

  private async flushAuthoritativeD1ArchivePage(): Promise<void> {
    if (this.authorityArchiveFlight !== undefined) return this.authorityArchiveFlight;
    const flight = this.flushAuthoritativeD1ArchivePageOnce();
    const tracked = flight.finally(() => {
      if (this.authorityArchiveFlight === tracked) this.authorityArchiveFlight = undefined;
    });
    this.authorityArchiveFlight = tracked;
    return tracked;
  }

  private async flushAuthoritativeD1ArchivePageOnce(): Promise<void> {
    if (this.authorityStore.roomDeletion() !== undefined) {
      await this.scheduleExpiryAlarm();
      return;
    }
    const work = this.authorityStore.archiveProgress();
    if (work === undefined || !work.pending) {
      await this.scheduleExpiryAlarm();
      return;
    }
    const roomId = this.authorityStore.room()?.room_id;
    const db = this.authorityArchiveDatabase();
    if (db === undefined) {
      const now = Date.now();
      this.authorityStore.deferArchive(now + AUTHORITATIVE_ARCHIVE_RETRY_DELAY_MS, now);
      await this.scheduleExpiryAlarm();
      return;
    }
    const startedAt = Date.now();
    try {
      const archive = await this.currentAuthoritativeArchive();
      const result = await appendAuthoritativeArchiveToD1(db, archive, work.progress);
      if (this.authorityStore.roomDeletion() !== undefined) {
        await this.scheduleExpiryAlarm();
        return;
      }
      const now = Date.now();
      const saved = this.authorityStore.transaction(() => this.authorityStore.saveArchivePage({
        progress: result.progress,
        observedGeneration: work.generation,
        caughtUp: result.caughtUp,
        nowMs: now,
        nextPageAt: now + AUTHORITATIVE_ARCHIVE_NEXT_PAGE_DELAY_MS,
      }));
      const archiveLagMs = Math.max(0, now - (work.pendingSinceAt ?? now));
      console.info(JSON.stringify(buildRoomTelemetryEvent({
        occurredAt: new Date(now).toISOString(),
        severity: archiveLagMs > 60_000 ? "warn" : "info",
        eventName: "room.archive.page.completed",
        correlation: { roomId },
        outcome: { kind: saved.pending ? "catchingUp" : "caughtUp" },
        measurements: {
          operationKind: "roomArchive",
          durationMs: Math.max(0, now - startedAt),
          archiveLagMs,
        },
        archive: {
          status: saved.pending ? "catchingUp" : "caughtUp",
          replayIntegrity: "verified",
        },
      })));
    } catch (error) {
      if (this.authorityStore.roomDeletion() !== undefined) {
        await this.scheduleExpiryAlarm();
        return;
      }
      const now = Date.now();
      if (error instanceof AuthorityArchiveSettlementPendingError) {
        // This head cannot become portable without another authoritative
        // action settling the DO-local randomness journal. Keep the archive
        // dirty but do not spin alarms; the settlement transaction marks it
        // runnable again.
        this.authorityStore.pauseArchiveUntilAuthorityChanges(now);
        await this.scheduleExpiryAlarm();
        return;
      }
      if (error instanceof AuthoritativeArchiveCursorMismatchError) {
        this.authorityStore.transaction(() => {
          this.authorityStore.restartArchiveFromAuthority(now);
        });
        await this.scheduleExpiryAlarm();
        return;
      }
      this.authorityStore.deferArchive(now + AUTHORITATIVE_ARCHIVE_RETRY_DELAY_MS, now);
      console.error(JSON.stringify(buildRoomTelemetryEvent({
        occurredAt: new Date().toISOString(),
        severity: "error",
        eventName: "room.archive.failed",
        correlation: { roomId },
        outcome: { kind: "retryableFailure" },
        failure: { code: "ARCHIVE_APPEND_FAILED" },
        archive: { status: "failed", replayIntegrity: "notEvaluated" },
        measurements: {
          operationKind: "roomArchive",
          durationMs: Math.max(0, now - startedAt),
          archiveLagMs: Math.max(0, now - (work.pendingSinceAt ?? now)),
        },
      })));
    }
    await this.scheduleExpiryAlarm();
  }

  private async scheduleAuthoritativeD1Archive(): Promise<void> {
    try {
      if (this.authorityStore.roomDeletion() !== undefined) return;
      if (this.authorityStore.markArchivePending(Date.now()) === undefined) return;
      await this.resumeAuthoritativeD1Archive();
    } catch {
      // The caller has already persisted its business outcome. Archive work is
      // derived and retryable, so even failure to mark/schedule it cannot make
      // that outcome appear uncommitted.
      this.reportAuthoritativeArchiveSchedulingFailure();
    }
  }

  private async resumeAuthoritativeD1Archive(): Promise<void> {
    try {
      if (this.authorityStore.roomDeletion() !== undefined) return;
      if (this.authorityStore.archiveProgress()?.pending !== true) return;
      // Persist the merged archive/TTL alarm before returning the authoritative
      // result. Scheduling is best-effort after the Room transaction: pending
      // state remains durable and construction/alarm/request paths retry it.
      try {
        await this.scheduleExpiryAlarm();
      } catch {
        this.reportAuthoritativeArchiveSchedulingFailure();
      }
      const flight = this.flushAuthoritativeD1ArchivePage().catch(() => {
        this.reportAuthoritativeArchiveSchedulingFailure();
      });
      try {
        this.ctx.waitUntil(flight);
      } catch {
        this.reportAuthoritativeArchiveSchedulingFailure();
      }
    } catch {
      // This seam is called only after authoritative state may already have
      // committed. No archive scheduler failure may escape into the RPC.
      this.reportAuthoritativeArchiveSchedulingFailure();
    }
  }

  private reportAuthoritativeArchiveSchedulingFailure(): void {
    try {
      const now = Date.now();
      const work = this.authorityStore.archiveProgress();
      const roomId = this.authorityStore.room()?.room_id;
      console.error(JSON.stringify(buildRoomTelemetryEvent({
        occurredAt: new Date(now).toISOString(),
        severity: "error",
        eventName: "room.archive.schedule.failed",
        correlation: { roomId },
        outcome: { kind: "retryableFailure" },
        failure: { code: "ARCHIVE_APPEND_FAILED" },
        archive: { status: "pending", replayIntegrity: "notEvaluated" },
        measurements: {
          operationKind: "roomArchive",
          durationMs: 0,
          archiveLagMs: Math.max(0, now - (work?.pendingSinceAt ?? now)),
        },
      })));
    } catch {
      // Telemetry cannot become a second failure source for committed state.
    }
  }

  async initializeAuthoritative(
    input: InitializeAuthoritativeRoomInput,
  ): Promise<AuthoritativeInitializationOutcome> {
    const serviceCapabilities = roomServiceCapabilities();
    if (this.authorityStore.roomDeletion() !== undefined) {
      return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
    }
    if (
      !isJsonRecord(input)
      || !nonEmptyString(input.roomId)
      || !nonEmptyString(input.moduleId)
      || (input.moduleVersion !== undefined && !nonEmptyString(input.moduleVersion))
      || !Array.isArray(input.members)
      || !Array.isArray(input.characters)
      || (input.fixtureFacts !== undefined && !Array.isArray(input.fixtureFacts))
      || input.members.length === 0
      || input.characters.length === 0
    ) {
      return rejectedAuthority("invalidInitialization", "Room initialization is incomplete.");
    }
    const existing = this.authorityStore.room();
    if (existing !== undefined) {
      if (existing.room_id !== input.roomId || existing.module_id !== input.moduleId) {
        return rejectedAuthority(
          "roomAlreadyBound",
          "The Durable Object is already bound to a different authoritative room.",
        );
      }
      const genesis = parseJson<RuntimeGenesis>(existing.genesis_json);
      return {
        created: false,
        runtimeEpochId: genesis.runtimeEpochId,
        genesisHash: genesis.genesisHash,
        runtimeProfiles: parseJson(existing.profiles_json),
        serviceCapabilities,
      };
    }

    const memberIds = input.members.map((member) => member.principalId);
    const characterIds = input.characters.map((character) => character.characterId);
    if (
      new Set(memberIds).size !== memberIds.length
      || new Set(characterIds).size !== characterIds.length
      || input.members.some((member) =>
        !nonEmptyString(member.principalId)
        || !["host", "player", "observer"].includes(member.role))
      || input.characters.some((character) =>
        !nonEmptyString(character.characterId)
        || !nonEmptyString(character.controllerPrincipalId)
        || !memberIds.includes(character.controllerPrincipalId)
        || !isJsonRecord(character.staticCard)
        || !nonEmptyString(character.staticCard.name)
        || !nonEmptyString(character.staticCard.sceneId))
    ) {
      return rejectedAuthority(
        "invalidInitialization",
        "Members, characters, controllers, and scenes must be unique trusted initialization records.",
      );
    }

    let moduleProfile: AuthoritativeModuleProfile;
    try {
      moduleProfile = await authoritativeModuleProfile(input.moduleId, input.moduleVersion);
    } catch {
      return rejectedAuthority(
        "invalidInitialization",
        "The authoritative Module Bible id or version is unavailable.",
      );
    }
    const catalogHash = await authorityHash({
      kind: "initialDefinitionCatalog",
      moduleId: input.moduleId,
      version: "authoritative-v2",
    });
    const runtimeEpochId = randomId("runtime-epoch");
    const suppliedFixtures = input.fixtureFacts === undefined ? [] : input.fixtureFacts;
    const fixtures = projectInitializationFixtures([
      ...suppliedFixtures,
      ...moduleInitializationFixtures(moduleProfile),
    ], input.characters);
    if (fixtures === undefined) {
      return rejectedAuthority(
        "invalidInitialization",
        "Trusted fixture facts must be canonical communication or finite-knowledge seeds.",
      );
    }
    const locationBySceneId = new Map(
      moduleProfile.storyBible.storyAnchors.locations.map((location) => [location.sceneId, location]),
    );
    const sceneIds = [...new Set([
      ...input.characters.map((character) => character.staticCard.sceneId),
      ...fixtures.npcCharacters.map((character) => character.sceneId),
      ...moduleProfile.storyBible.importantNpcs.map((npc) => npc.startSceneId),
      ...moduleProfile.storyBible.storyAnchors.locations.map((location) => location.sceneId),
    ])].sort();
    if (moduleProfile.moduleVersion === "tactical-map-v1"
      && sceneIds.some((sceneId) => locationBySceneId.get(sceneId)?.tacticalGeometry === undefined)) {
      return rejectedAuthority(
        "invalidInitialization",
        "Every initial tactical scene must be defined by the pinned Module Profile.",
      );
    }
    const scenes = sceneIds.map((sceneId) => {
      const location = locationBySceneId.get(sceneId);
      return {
        id: sceneId,
        name: location?.name ?? sceneId,
        ...(location?.tacticalGeometry === undefined
          ? {}
          : { geometry: structuredClone(location.tacticalGeometry) }),
      };
    });
    const initialized = stepAuthoritative(input.runtimeProfiles, undefined, {
      kind: "initializeAuthoritativeWorld",
      roomId: input.roomId,
      runtimeEpochId,
      moduleRef: structuredClone(moduleProfile.moduleRef),
      initialDefinitionCatalogRef: {
        profileId: `definition-catalog:${input.moduleId}:authoritative-v2`,
        profileHash: catalogHash,
      },
      activeBranchId: AUTHORITY_BRANCH_ID,
      fictionInstantMicros: "0",
      scenes,
      principals: input.members
        .map((member) => ({
          id: member.principalId,
          sessionVersion: 1,
          role: member.role,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      seats: input.members
        .map((member) => ({
          id: `seat:${member.principalId}`,
          principalId: member.principalId,
          status: "active" as const,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      characters: [
        ...input.characters.map((character) =>
          rulesCharacterFromStaticSeed(character, true, input.runtimeProfiles)!),
        ...(Object.values(Object.fromEntries([
          ...fixtures.npcCharacters.map((npc) => [npc.id, npc] as const),
          ...moduleProfile.storyBible.importantNpcs.map((npc) => [npc.entityId, {
            id: npc.entityId,
            kind: "npc" as const,
            name: npc.name,
            sceneId: npc.startSceneId,
            tenureStatus: "active" as const,
            spatialVisibilityPolicyId: "visibility:scene-observers" as const,
          }] as const),
        ])) as RulesCharacterSeed[]),
      ]
        .sort((left, right) => left.id.localeCompare(right.id)),
      characterControls: input.characters
        .map((character) => ({
          characterId: character.characterId,
          seatId: `seat:${character.controllerPrincipalId}`,
        }))
        .sort((left, right) => left.characterId.localeCompare(right.characterId)),
      canonicalFacts: fixtures.canonicalFacts,
      initialKnowledge: fixtures.initialKnowledge,
    });
    if (initialized.kind !== "initialized") {
      return initialized.kind === "rejected"
        ? rejectedAuthority(initialized.rejection.code, initialized.rejection.message)
        : rejectedAuthority("invalidRulesResult", "Rules did not return an initialization result.");
    }
    const replayed = replayAuthoritative(initialized.genesis, []);
    if (replayed.kind !== "replayed") {
      return rejectedAuthority(replayed.rejection.code, replayed.rejection.message);
    }
    const initialState = replayed.state as AuthoritativeWorldState;

    const openingSceneId = moduleProfile.storyBible.storyAnchors.chapters[0]?.sceneIds[0];
    const openingLocation = openingSceneId === undefined
      ? undefined
      : moduleProfile.storyBible.storyAnchors.locations
          .find((location) => location.sceneId === openingSceneId);
    const openingPayloadHash = openingLocation === undefined
      ? undefined
      : await authorityHash({ text: openingLocation.publicOpening });
    const openingDeliveries: Array<{
      viewer: PlayerViewer;
      sourceEventSeq: string;
      frame: DeliveryFrame;
    }> = [];
    if (openingLocation !== undefined && openingPayloadHash !== undefined) {
      for (const character of input.characters
        .filter((entry) => entry.staticCard.sceneId === openingLocation.sceneId)
        .sort((left, right) => left.characterId.localeCompare(right.characterId))) {
        const viewer = this.authorityViewerForCharacter(initialState, character.characterId);
        if (viewer === undefined) continue;
        const projection = projectAuthoritative(initialized.profiles, initialState, viewer);
        if (projection.kind === "rejected") {
          return rejectedAuthority(
            projection.rejection.code,
            "The opening viewer projection could not be established.",
          );
        }
        const deliveryIdentity = await authorityHash({
          kind: "authoritativeModuleOpeningDelivery",
          roomId: input.roomId,
          moduleRef: moduleProfile.moduleRef,
          sceneId: openingLocation.sceneId,
          characterId: character.characterId,
        });
        openingDeliveries.push({
          viewer,
          sourceEventSeq: replayed.head.eventSeq,
          frame: {
            deliveryId: `delivery:opening:${deliveryIdentity.slice("sha256:".length)}`,
            receiptId: `presentation:opening:${deliveryIdentity.slice("sha256:".length)}`,
            activeBranchId: initialState.activeBranchId,
            projectionHash: projection.projectionHash,
            presentationPolicyVersion: PRESENTATION_POLICY_VERSION,
            narrationPolicyVersion: NARRATION_POLICY_VERSION,
            payloadHash: openingPayloadHash,
            text: openingLocation.publicOpening,
            sceneIds: [openingLocation.sceneId],
          },
        });
      }
    }

    const result = this.authorityStore.transaction(() => {
      if (this.authorityStore.roomDeletion() !== undefined) {
        return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
      }
      const raced = this.authorityStore.room();
      if (raced !== undefined) {
        if (raced.room_id !== input.roomId || raced.module_id !== input.moduleId) {
          return rejectedAuthority(
            "roomAlreadyBound",
            "The Durable Object is already bound to a different authoritative room.",
          );
        }
        const genesis = parseJson<RuntimeGenesis>(raced.genesis_json);
        return {
          created: false,
          runtimeEpochId: genesis.runtimeEpochId,
          genesisHash: genesis.genesisHash,
          runtimeProfiles: parseJson(raced.profiles_json),
          serviceCapabilities,
        };
      }
      this.authorityStore.createRoom({
        roomId: input.roomId,
        moduleId: input.moduleId,
        profiles: initialized.profiles,
        genesis: initialized.genesis,
        state: initialState,
        members: input.members,
        characters: input.characters,
      });
      for (const { viewer, sourceEventSeq, frame } of openingDeliveries) {
        const viewerKey = `${viewer.principalId}\u001f${viewer.characterId}`;
        this.authorityStore.replaceDeliverySlot({
          viewerKey,
          principalId: viewer.principalId,
          characterId: viewer.characterId,
          sourceEventSeq,
          frame,
        });
        this.authorityStore.advanceDeliveryWatermark(viewerKey, sourceEventSeq);
      }
      return {
        created: true,
        runtimeEpochId,
        genesisHash: initialized.genesis.genesisHash,
        runtimeProfiles: initialized.profiles,
        serviceCapabilities,
      };
    });
    if ("created" in result && result.created) await this.scheduleAuthoritativeD1Archive();
    return result;
  }

  private authorityDeletionDatabase(): D1Database | undefined {
    return this.authorityDeletionDatabaseOverride
      ?? (this.bindings as unknown as { DB?: D1Database }).DB;
  }

  private async directoryRoomForDeletion(roomId: string): Promise<RoomDirectoryRow | null> {
    const db = this.authorityDeletionDatabase();
    if (db === undefined) throw new Error("Room directory binding is unavailable.");
    return await db.prepare(
      "SELECT id, host_user_id, status FROM rooms WHERE id = ?",
    ).bind(roomId).first<RoomDirectoryRow>();
  }

  private deletionHost(
    context: unknown,
    replay: AuthorityReplay,
  ): AuthenticatedAuthorityViewer | undefined {
    const authenticated = this.authenticatedAuthorityViewer(context, replay.state);
    return authenticated?.principalId === replay.state.multiplayerRuntime.hostPrincipalId
      ? authenticated
      : undefined;
  }

  private clearAllRoomRowsForDeletion(): void {
    this.ctx.storage.transactionSync(() => {
      // Legacy tables are retained as empty schema for old ruleset replay, but
      // no row from the deleted room may survive this terminal transition.
      this.ctx.storage.sql.exec(`
        DELETE FROM ux_status;
        DELETE FROM turn_tickets;
        DELETE FROM commands;
        DELETE FROM world_events;
        DELETE FROM room_state;
      `);
      this.authorityStore.clearAllRowsForDeletion();
    });
  }

  private async armDeletionReconciliation(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + ROOM_DELETION_RECONCILE_DELAY_MS);
  }

  private async finalizePreparedDeletion(roomId: string) {
    let directoryRoom: RoomDirectoryRow | null;
    try {
      directoryRoom = await this.directoryRoomForDeletion(roomId);
    } catch {
      await this.armDeletionReconciliation();
      return {
        kind: "retryableFailure" as const,
        code: "roomDirectoryUnavailable",
      };
    }
    if (directoryRoom !== null) {
      await this.armDeletionReconciliation();
      return rejectedAuthority(
        "roomDirectoryStillPresent",
        "The room directory still contains this room.",
      );
    }
    this.clearAllRoomRowsForDeletion();
    await this.ctx.storage.deleteAlarm();
    return { kind: "deletionFinalized" as const, roomId };
  }

  private async reconcilePreparedDeletion(): Promise<void> {
    const marker = this.authorityStore.roomDeletion();
    if (marker === undefined) {
      await this.scheduleExpiryAlarm();
      return;
    }
    let directoryRoom: RoomDirectoryRow | null;
    try {
      directoryRoom = await this.directoryRoomForDeletion(marker.room_id);
    } catch {
      await this.armDeletionReconciliation();
      return;
    }
    if (directoryRoom === null) {
      this.clearAllRoomRowsForDeletion();
      await this.ctx.storage.deleteAlarm();
      return;
    }
    if (
      directoryRoom.status === "deleting"
      && directoryRoom.host_user_id === marker.principal_id
    ) {
      await this.armDeletionReconciliation();
      return;
    }
    this.authorityStore.transaction(() => {
      const current = this.authorityStore.roomDeletion();
      if (current?.room_id === marker.room_id && current.principal_id === marker.principal_id) {
        this.authorityStore.cancelRoomDeletion(marker.room_id, marker.principal_id);
      }
    });
    await this.scheduleExpiryAlarm();
  }

  async prepareDeletion(capability: unknown, context: unknown) {
    if (!hasRoomServiceCapability(capability, "roomDeletion")) {
      return rejectedAuthority(
        "roomDeletionUnauthorized",
        "Only the trusted Room deletion capability may seal a room.",
      );
    }
    if (this.authorityArchiveFlight !== undefined) {
      await this.authorityArchiveFlight.catch(() => undefined);
    }
    if (this.authorityStore.room() === undefined) {
      return rejectedAuthority("roomUninitialized", "The authoritative room is not initialized.");
    }
    const replay = this.authoritativeReplay();
    const host = this.deletionHost(context, replay);
    if (host === undefined) {
      return rejectedAuthority(
        "roomDeletionUnauthorized",
        "Only the canonical authenticated host may delete this room.",
      );
    }
    const outcome = this.authorityStore.transaction(() => {
      const existing = this.authorityStore.roomDeletion();
      if (existing !== undefined) {
        return existing.room_id === replay.state.roomId
          && existing.principal_id === host.principalId
          ? {
              kind: "deletionPrepared" as const,
              roomId: existing.room_id,
              principalId: existing.principal_id,
            }
          : rejectedAuthority(
              "roomDeletionUnauthorized",
              "Another canonical deletion is already in progress.",
            );
      }
      this.authorityStore.prepareRoomDeletion(
        replay.state.roomId,
        host.principalId,
        Date.now(),
      );
      return {
        kind: "deletionPrepared" as const,
        roomId: replay.state.roomId,
        principalId: host.principalId,
      };
    });
    if (outcome.kind === "deletionPrepared") await this.armDeletionReconciliation();
    return outcome;
  }

  async cancelDeletion(capability: unknown, context: unknown) {
    if (!hasRoomServiceCapability(capability, "roomDeletion")) {
      return rejectedAuthority(
        "roomDeletionUnauthorized",
        "Only the trusted Room deletion capability may unseal a room.",
      );
    }
    const marker = this.authorityStore.roomDeletion();
    if (marker === undefined) return { kind: "deletionCancelled" as const, alreadyCancelled: true };
    if (this.authorityStore.room() === undefined) {
      return rejectedAuthority("roomUninitialized", "The authoritative room is not initialized.");
    }
    const replay = this.authoritativeReplay();
    const host = this.deletionHost(context, replay);
    if (host === undefined || host.principalId !== marker.principal_id) {
      return rejectedAuthority(
        "roomDeletionUnauthorized",
        "Only the canonical authenticated host may cancel deletion.",
      );
    }
    this.authorityStore.transaction(() => {
      this.authorityStore.cancelRoomDeletion(marker.room_id, marker.principal_id);
    });
    await this.scheduleExpiryAlarm();
    return { kind: "deletionCancelled" as const, roomId: marker.room_id };
  }

  async finalizeDeletion(capability: unknown) {
    if (!hasRoomServiceCapability(capability, "roomDeletion")) {
      return rejectedAuthority(
        "roomDeletionUnauthorized",
        "Only the trusted Room deletion capability may finalize a room.",
      );
    }
    const marker = this.authorityStore.roomDeletion();
    if (marker === undefined) {
      if (this.authorityStore.isAuthorityEmpty()) {
        return { kind: "deletionFinalized" as const, alreadyFinalized: true };
      }
      return rejectedAuthority("roomDeletionNotPrepared", "Room deletion was not prepared.");
    }
    return this.finalizePreparedDeletion(marker.room_id);
  }

  private normalizeRoomAdministrationCommand(
    value: JsonRecord,
    profiles: RuntimeProfileManifest,
  ): {
      commandId: string;
      command: JsonObject;
      directRulesInput?: JsonObject;
      staticCharacter?: AuthoritativeCharacterSeed;
    }
    | { rejection: AuthorityCommitOutcome } {
    if (!nonEmptyString(value.commandId) || !nonEmptyString(value.kind)) {
      return {
        rejection: rejectedAuthority(
          "invalidRoomAdministration",
          "A closed room administration command and command id are required.",
        ),
      };
    }
    if (value.kind === "grantSeat") {
      const expectedKeys = value.character === undefined
        ? ["commandId", "kind", "principal", "role"]
        : ["character", "commandId", "kind", "principal", "role"];
      if (
        !hasExactJsonKeys(value, expectedKeys)
        || !isJsonRecord(value.principal)
        || !hasExactJsonKeys(value.principal, ["id", "sessionVersion"])
        || !nonEmptyString(value.principal.id)
        || !Number.isSafeInteger(value.principal.sessionVersion)
        || Number(value.principal.sessionVersion) <= 0
        || !["player", "observer"].includes(String(value.role))
      ) {
        return {
          rejection: rejectedAuthority(
            "invalidRoomAdministration",
            "The Seat grant is not a closed trusted service command.",
          ),
        };
      }
      let staticCharacter: AuthoritativeCharacterSeed | undefined;
      let rulesCharacter: JsonObject | undefined;
      if (value.character !== undefined) {
        if (
          !isJsonRecord(value.character)
          || !hasExactJsonKeys(value.character, ["characterId", "controllerPrincipalId", "staticCard"])
          || !nonEmptyString(value.character.characterId)
          || value.character.controllerPrincipalId !== value.principal.id
          || !isJsonRecord(value.character.staticCard)
          || !nonEmptyString(value.character.staticCard.name)
          || !nonEmptyString(value.character.staticCard.sceneId)
        ) {
          return {
            rejection: rejectedAuthority(
              "invalidRoomAdministration",
              "The granted controlled character seed is incomplete.",
            ),
          };
        }
        staticCharacter = structuredClone(value.character) as AuthoritativeCharacterSeed;
        rulesCharacter = rulesCharacterFromStaticSeed(staticCharacter, true, profiles);
        if (rulesCharacter === undefined) {
          return {
            rejection: rejectedAuthority(
              "invalidRoomAdministration",
              "The granted controlled character seed cannot initialize Rules state.",
            ),
          };
        }
      }
      return {
        commandId: value.commandId,
        command: {
          kind: "grantSeat",
          principal: structuredClone(value.principal),
          role: value.role,
          seatId: `seat:${value.principal.id}`,
          ...(rulesCharacter === undefined ? {} : { character: rulesCharacter }),
        },
        ...(staticCharacter === undefined ? {} : { staticCharacter }),
      };
    }
    if (value.kind === "materializeCharacter") {
      if (
        !hasExactJsonKeys(value, ["character", "commandId", "kind", "principalId", "seatId"])
        || !nonEmptyString(value.principalId)
        || value.seatId !== `seat:${value.principalId}`
        || !isJsonRecord(value.character)
        || !hasExactJsonKeys(value.character, ["characterId", "controllerPrincipalId", "staticCard"])
        || value.character.controllerPrincipalId !== value.principalId
        || !nonEmptyString(value.character.characterId)
        || !isJsonRecord(value.character.staticCard)
        || !nonEmptyString(value.character.staticCard.name)
        || !nonEmptyString(value.character.staticCard.sceneId)
      ) {
        return {
          rejection: rejectedAuthority(
            "invalidRoomAdministration",
            "Character materialization requires one trusted controller, Seat, and static card.",
          ),
        };
      }
      const staticCharacter = structuredClone(value.character) as AuthoritativeCharacterSeed;
      const character = rulesCharacterFromStaticSeed(staticCharacter, true, profiles);
      if (character === undefined) {
        return {
          rejection: rejectedAuthority(
            "invalidRoomAdministration",
            "The static character card cannot initialize Rules state.",
          ),
        };
      }
      return {
        commandId: value.commandId,
        command: {
          kind: "materializeCharacter",
          principalId: value.principalId,
          seatId: value.seatId,
          character,
        },
        staticCharacter,
      };
    }
    if (value.kind === "introduceSuccessor") {
      if (
        !hasExactJsonKeys(value, [
          "character",
          "commandId",
          "kind",
          "predecessorCharacterId",
          "principalId",
          "worldEntry",
        ])
        || !nonEmptyString(value.principalId)
        || !nonEmptyString(value.predecessorCharacterId)
        || !nonEmptyString(value.worldEntry)
        || !isJsonRecord(value.character)
        || !hasExactJsonKeys(value.character, ["characterId", "controllerPrincipalId", "staticCard"])
        || value.character.controllerPrincipalId !== value.principalId
        || !nonEmptyString(value.character.characterId)
        || !isJsonRecord(value.character.staticCard)
        || !nonEmptyString(value.character.staticCard.name)
        || !nonEmptyString(value.character.staticCard.sceneId)
      ) {
        return {
          rejection: rejectedAuthority(
            "invalidRoomAdministration",
            "A successor requires the authenticated predecessor, controller, world entry, and static card.",
          ),
        };
      }
      const staticCharacter = structuredClone(value.character) as AuthoritativeCharacterSeed;
      const successor = rulesCharacterFromStaticSeed(staticCharacter, true, profiles);
      if (successor === undefined) {
        return {
          rejection: rejectedAuthority(
            "invalidRoomAdministration",
            "The successor card cannot initialize Rules state.",
          ),
        };
      }
      return {
        commandId: value.commandId,
        command: { kind: "introduceSuccessor" },
        directRulesInput: {
          kind: "introduceSuccessor",
          proposalId: `room-administration:${value.commandId}`,
          controllerPrincipalId: value.principalId,
          predecessorCharacterId: value.predecessorCharacterId,
          successor,
          worldEntry: value.worldEntry,
        },
        staticCharacter,
      };
    }
    const { commandId: _commandId, ...command } = value;
    return { commandId: value.commandId, command: structuredClone(command) };
  }

  async applyRoomAdministration(capability: unknown, commandValue: unknown) {
    if (!hasRoomServiceCapability(capability, "roomAdministration")) {
      return rejectedAuthority(
        "roomAdministrationUnauthorized",
        "Only the trusted Room service capability may administer membership and control.",
      );
    }
    if (this.authorityStore.roomDeletion() !== undefined) {
      return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
    }
    if (!isJsonRecord(commandValue)) {
      return rejectedAuthority(
        "invalidRoomAdministration",
        "A canonical room administration command is required.",
      );
    }
    let payloadHash: string;
    try {
      payloadHash = await authorityHash(commandValue);
    } catch {
      return rejectedAuthority(
        "invalidRoomAdministration",
        "The room administration command must be canonical JSON.",
      );
    }
    if (nonEmptyString(commandValue.commandId)) {
      const existing = this.authorityStore.administration(commandValue.commandId);
      if (existing !== undefined) {
        return existing.payload_hash === payloadHash
          ? parseJson(existing.result_json)
          : rejectedAuthority(
              "idempotencyPayloadMismatch",
              "The room administration command id was already used with a different payload.",
            );
      }
    }
    if (this.authorityStore.room() === undefined) {
      return rejectedAuthority("roomUninitialized", "The authoritative room is not initialized.");
    }
    const replay = this.authoritativeReplay();
    const normalized = this.normalizeRoomAdministrationCommand(commandValue, replay.profiles);
    if ("rejection" in normalized) return normalized.rejection;
    const stepped = stepAuthoritative(
      replay.profiles,
      replay.state,
      normalized.directRulesInput ?? {
        kind: "applyRoomAdministration",
        roomAdministration: {
          kind: "roomAdministration",
          capability: replay.state.multiplayerRuntime.roomAdministrationCapability,
        },
        commandId: normalized.commandId,
        command: normalized.command,
      },
    );
    const rejected = stepped.kind === "rejected"
      ? rejectedAuthority(stepped.rejection.code, stepped.rejection.message)
      : stepped.kind !== "committed"
        ? rejectedAuthority(
            "invalidRulesResult",
            "Rules did not return a closed room administration result.",
          )
        : undefined;
    if (rejected !== undefined) {
      return this.authorityStore.transaction(() => {
        if (this.authorityStore.roomDeletion() !== undefined) {
          return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
        }
        const raced = this.authorityStore.administration(normalized.commandId);
        if (raced !== undefined) {
          return raced.payload_hash === payloadHash
            ? parseJson(raced.result_json)
            : rejectedAuthority(
                "idempotencyPayloadMismatch",
                "The room administration command id was already used with a different payload.",
              );
        }
        this.authorityStore.saveAdministration({
          commandId: normalized.commandId,
          payloadHash,
          result: rejected,
        });
        return rejected;
      });
    }
    if (stepped.kind !== "committed") {
      return rejectedAuthority(
        "invalidRulesResult",
        "Rules did not return a committed room administration result.",
      );
    }

    const changedControlCharacterIds = Object.keys({
      ...replay.state.characterControls,
      ...stepped.state.characterControls,
    }).filter((characterId) =>
      replay.state.characterControls[characterId]?.seatId
        !== stepped.state.characterControls[characterId]?.seatId);
    if (changedControlCharacterIds.length > 0
      && hasUnsettledAuthoritativeRandomness(replay.state)) {
      return {
        kind: "retryableFailure" as const,
        code: "roomAdministrationRandomnessSettlementPending",
      };
    }
    const scopeId = "room:administration";
    const changedControlSceneScopes = [...new Set(changedControlCharacterIds.flatMap(
      (characterId) => [
        replay.state.entities[characterId]?.sceneId,
        stepped.state.entities[characterId]?.sceneId,
      ].filter(nonEmptyString).map((sceneId) => `scene:${sceneId}`),
    ))].sort();
    const administrationScopeVersions = Object.fromEntries(
      [scopeId, ...changedControlSceneScopes].map((changedScopeId) => [
        changedScopeId,
        this.authorityStore.scopeVersion(changedScopeId),
      ]),
    );
    const receipt: PublicReceipt = {
      receiptId: stepped.receipt.receiptId,
      rootActionId: stepped.receipt.rootActionId,
      status: "committed",
      runtimeEpochId: stepped.state.runtimeEpochId,
      activeBranchId: stepped.state.activeBranchId,
      eventRange: {
        first: stepped.events[0].eventSeq,
        last: stepped.events[stepped.events.length - 1].eventSeq,
        from: Number(stepped.events[0].eventSeq),
        to: Number(stepped.events[stepped.events.length - 1].eventSeq),
      },
      scopeVersions: Object.fromEntries(
        Object.entries(administrationScopeVersions).map(([changedScopeId, version]) => [
          changedScopeId,
          String(version + 1),
        ]),
      ),
      randomnessCommitments: [],
    };
    const outcome = {
      kind: "committed" as const,
      receipt,
      administration: { commandId: normalized.commandId },
    };
    const persisted = this.authorityStore.transaction(() => {
      if (this.authorityStore.roomDeletion() !== undefined) {
        return {
          outcome: rejectedAuthority("roomDeleting", "The room is sealed for deletion."),
          committedHere: false,
        };
      }
      const raced = this.authorityStore.administration(normalized.commandId);
      if (raced !== undefined) {
        return {
          outcome: raced.payload_hash === payloadHash
            ? parseJson(raced.result_json)
            : rejectedAuthority(
                "idempotencyPayloadMismatch",
                "The room administration command id was already used with a different payload.",
              ),
          committedHere: false,
        };
      }
      if (Object.entries(administrationScopeVersions).some(
        ([changedScopeId, version]) => this.authorityStore.scopeVersion(changedScopeId) !== version,
      )) {
        return {
          outcome: rejectedAuthority(
            "scopeConflict",
            "Room control or a related scene changed before administration committed.",
          ),
          committedHere: false,
        };
      }
      this.authorityStore.appendEvents(stepped.events);
      this.authorityStore.updateState(stepped.state);
      this.authorityStore.invalidatePreparedActionStagesInScopes(changedControlSceneScopes);
      for (const changedScopeId of Object.keys(administrationScopeVersions)) {
        this.authorityStore.advanceScope(changedScopeId);
      }
      this.authorityStore.saveReceipt(receipt);
      if (normalized.staticCharacter !== undefined) {
        this.authorityStore.saveStaticCharacter(normalized.staticCharacter);
      }
      this.authorityStore.syncAuthorityIndex(stepped.state);
      this.authorityStore.syncPendingAuthority(stepped.state);
      if (!exactProfileRef(
        deliveryProtocolForProfiles(replay.profiles),
        INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE,
      )) {
        this.authorityStore.supersedeCharacterDeliveries(changedControlCharacterIds);
      }
      this.authorityStore.saveAdministration({
        commandId: normalized.commandId,
        payloadHash,
        result: outcome,
      });
      return { outcome, committedHere: true };
    });
    if (persisted.committedHere) await this.scheduleAuthoritativeD1Archive();
    return persisted.outcome;
  }

  async prepare(context: TrustedPrincipalContext, actionInput: AuthoritativeActionInput) {
    if (this.authorityStore.roomDeletion() !== undefined) {
      return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
    }
    if (!isJsonRecord(actionInput) || !nonEmptyString(actionInput.submissionId)) {
      return rejectedAuthority("invalidActionInput", "Action input is incomplete.");
    }
    const replay = this.authoritativeReplay();
    const authenticated = this.authenticatedAuthorityViewer(context, replay.state);
    if (authenticated === undefined) {
      return rejectedAuthority("unauthenticated", "The trusted principal session is unavailable.");
    }
    const existing = this.authorityStore.submission(actionInput.submissionId);
    if (actionInput.kind === "retry") {
      if (
        existing === undefined
        || !nonEmptyString(actionInput.rootActionId)
        || existing.root_action_id !== actionInput.rootActionId
      ) {
        return rejectedAuthority(
          "retryReferenceMismatch",
          "The retry does not reference the original authoritative action.",
        );
      }
      if (existing.principal_id !== authenticated.principalId) {
        return rejectedAuthority("submissionUnauthorized", "The submission belongs to another principal.");
      }
      if (existing.result_json !== null) {
        const result = parseJson<AuthorityCommitOutcome>(existing.result_json);
        if (
          (result.kind === "committed" || result.kind === "concluded")
          && result.deliveryPlan !== undefined
          && deliveryProtocolForPlan(result.deliveryPlan)?.profileId
            === INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE.profileId
        ) {
          return rejectedAuthority(
            "viewerNarrationRecoveryRequired",
            "Independent narration recovery belongs to the current frozen ViewerKey.",
          );
        }
        return result;
      }
      if (hasActiveSafetyPause(replay.state)
        && existing.input_kind !== "safetyPause"
        && existing.input_kind !== "safetyAdjust") {
        return presentationUnavailable();
      }
      const staged = this.authorityStore.actionStage(existing.prepared_action_id);
      if (existing.status === "prepared" && staged?.status === "committed") {
        return parseJson<PreparedAuthoritativeAction>(existing.prepared_json);
      }
      const recovery = this.authorityStore.proposalRecovery(
        staged?.status === "prepared"
          ? staged.child_root_action_id
          : existing.prepared_action_id,
      );
      if (recovery !== undefined) {
        return this.commitAuthoritative(
          context,
          existing.prepared_action_id,
          { kind: "recovery", row: recovery },
        );
      }
      if (existing.status === "prepared") {
        return parseJson<PreparedAuthoritativeAction>(existing.prepared_json);
      }
      return {
        kind: "retryableFailure",
        code: existing.status === "awaitingRandomness"
          ? "randomnessRecoveryInputMissing"
          : "commitInProgress",
      } satisfies AuthorityCommitOutcome;
    }

    let canonicalActionInput: JsonObject;
    if (actionInput.kind === "intent") {
      if (!nonEmptyString(actionInput.text)) {
        return rejectedAuthority("invalidActionInput", "An intent text is required.");
      }
      canonicalActionInput = {
        kind: "intent",
        submissionId: actionInput.submissionId,
        text: actionInput.text,
        ...(nonEmptyString(actionInput.acknowledgementId)
          ? { acknowledgementId: actionInput.acknowledgementId }
          : {}),
      };
    } else if (actionInput.kind === "answer") {
      canonicalActionInput = {
        kind: "answer",
        submissionId: actionInput.submissionId,
        pendingInputId: actionInput.pendingInputId,
        answer: structuredClone(actionInput.answer),
        ...(nonEmptyString(actionInput.displayText)
          ? { displayText: actionInput.displayText }
          : {}),
        ...(nonEmptyString(actionInput.acknowledgementId)
          ? { acknowledgementId: actionInput.acknowledgementId }
          : {}),
      };
    } else if (actionInput.kind === "gear") {
      const expectedKeys = actionInput.action === "wear"
        ? ["action", "itemId", "kind", "slot", "submissionId"]
        : ["action", "kind", "slot", "submissionId"];
      if (
        !hasExactJsonKeys(actionInput, expectedKeys)
        || (actionInput.action !== "wear" && actionInput.action !== "stow")
        || !nonEmptyString(actionInput.slot)
        || !AUTHORITATIVE_GEAR_SLOTS.has(actionInput.slot)
        || (actionInput.action === "wear" && !nonEmptyString(actionInput.itemId))
      ) return rejectedAuthority("invalidActionInput", "A closed semantic gear action is required.");
      canonicalActionInput = {
        kind: "gear",
        submissionId: actionInput.submissionId,
        action: actionInput.action,
        slot: actionInput.slot,
        ...(actionInput.action === "wear" ? { itemId: actionInput.itemId as string } : {}),
      };
    } else if (actionInput.kind === "environmentInteract") {
      if (
        !hasExactJsonKeys(actionInput, ["featureId", "intent", "kind", "submissionId"])
        || !nonEmptyString(actionInput.featureId)
        || (actionInput.intent !== "open" && actionInput.intent !== "close")
      ) {
        return rejectedAuthority(
          "invalidActionInput",
          "A closed semantic environment interaction is required.",
        );
      }
      canonicalActionInput = {
        kind: "environmentInteract",
        submissionId: actionInput.submissionId,
        featureId: actionInput.featureId,
        intent: actionInput.intent,
      };
    } else if (actionInput.kind === "environmentAbility") {
      if (
        !hasExactJsonKeys(actionInput, ["abilityRef", "featureId", "kind", "submissionId"])
        || !nonEmptyString(actionInput.abilityRef)
        || !nonEmptyString(actionInput.featureId)
      ) {
        return rejectedAuthority(
          "invalidActionInput",
          "A closed environment ability selection is required.",
        );
      }
      canonicalActionInput = {
        kind: "environmentAbility",
        submissionId: actionInput.submissionId,
        featureId: actionInput.featureId,
        abilityRef: actionInput.abilityRef,
      };
    } else if (actionInput.kind === "movement") {
      if (
        !hasExactJsonKeys(actionInput, [
          "kind",
          "movementMode",
          "path",
          "spatialRevision",
          "submissionId",
        ])
        || actionInput.movementMode !== "walk"
        || !isTacticalSpatialRevision(actionInput.spatialRevision)
        || !Array.isArray(actionInput.path)
        || actionInput.path.length < 2
        || actionInput.path.length > 64
        || !actionInput.path.every(isTacticalPosition)
      ) {
        return rejectedAuthority(
          "invalidActionInput",
          "A closed tactical movement path is required.",
        );
      }
      canonicalActionInput = {
        kind: "movement",
        submissionId: actionInput.submissionId,
        movementMode: actionInput.movementMode,
        spatialRevision: actionInput.spatialRevision,
        path: structuredClone(actionInput.path),
      };
    } else if (actionInput.kind === "safetyPause") {
      if (!hasExactJsonKeys(actionInput, ["kind", "submissionId"])) {
        return rejectedAuthority("invalidActionInput", "Safety pause accepts no reason or free-form text.");
      }
      canonicalActionInput = {
        kind: "safetyPause",
        submissionId: actionInput.submissionId,
      };
    } else if (actionInput.kind === "safetyAdjust") {
      if (
        !hasExactJsonKeys(actionInput, ["kind", "presentationAdjustment", "submissionId"])
        || ![
          "fadeToBlack",
          "reduceDetail",
          "skipSensitiveContent",
        ].includes(actionInput.presentationAdjustment)
      ) {
        return rejectedAuthority("invalidActionInput", "A closed safety presentation adjustment is required.");
      }
      canonicalActionInput = {
        kind: "safetyAdjust",
        submissionId: actionInput.submissionId,
        presentationAdjustment: actionInput.presentationAdjustment,
      };
    } else if (actionInput.kind === "errorReport") {
      const explanation = typeof actionInput.explanation === "string"
        ? actionInput.explanation.trim()
        : "";
      if (
        !hasExactJsonKeys(actionInput, [
          "concern",
          "explanation",
          "kind",
          "receiptId",
          "submissionId",
        ])
        || !nonEmptyString(actionInput.receiptId)
        || (actionInput.concern !== "rules" && actionInput.concern !== "facts")
        || explanation.length === 0
        || explanation.length > 500
      ) {
        return rejectedAuthority(
          "invalidActionInput",
          "An ErrorReport accepts only one Receipt, a rules/facts concern, and a short explanation.",
        );
      }
      canonicalActionInput = {
        kind: "errorReport",
        submissionId: actionInput.submissionId,
        receiptId: actionInput.receiptId,
        concern: actionInput.concern,
        explanation,
      };
    } else {
      return rejectedAuthority("unsupportedActionInput", "This action shape is not available.");
    }
    let payloadHash: string;
    try {
      // Actor identity is deliberately absent: it is derived below from the
      // authenticated Principal -> active Seat -> active CharacterControl.
      // Extra transport fields therefore cannot select an actor or perturb an
      // otherwise identical idempotent submission.
      payloadHash = await authorityHash(canonicalActionInput);
    } catch {
      return rejectedAuthority("invalidActionInput", "Action input must be canonical JSON.");
    }
    if (existing !== undefined) {
      if (existing.principal_id !== authenticated.principalId) {
        return rejectedAuthority("submissionUnauthorized", "The submission belongs to another principal.");
      }
      if (existing.payload_hash !== payloadHash) {
        return rejectedAuthority(
          "idempotencyPayloadMismatch",
          "The submission id was already used with a different payload.",
        );
      }
      if (existing.status === "prepared") {
        return parseJson<PreparedAuthoritativeAction>(existing.prepared_json);
      }
      if (existing.result_json !== null) return parseJson(existing.result_json);
      return {
        kind: "retryableFailure",
        code: "commitInProgress",
      } satisfies AuthorityCommitOutcome;
    }

    if (actionInput.kind === "errorReport") {
      if (authenticated.characterIds.length !== 1) {
        return rejectedAuthority(
          "notController",
          "The trusted principal must have exactly one active controlled character.",
        );
      }
      const characterId = authenticated.characterIds[0];
      const viewer = this.authorityPlayerViewer(authenticated, replay.state, characterId);
      const projection = viewer === undefined
        ? undefined
        : this.projectAuthorityViewer(replay, viewer);
      const visibleReceipt = projection !== undefined && Array.isArray(projection.receipts)
        ? projection.receipts.find((candidate) =>
            isJsonRecord(candidate) && candidate.receiptId === actionInput.receiptId)
        : undefined;
      const targetReceipt = visibleReceipt === undefined
        ? undefined
        : this.authorityStore.receipt(actionInput.receiptId);
      if (visibleReceipt === undefined || targetReceipt === undefined) {
        return rejectedAuthority(
          "privateOrUnknownReference",
          "The referenced Receipt is not visible to this viewer.",
        );
      }
      const {
        actorCharacterId: _trustedActorBinding,
        ...publicTargetReceipt
      } = targetReceipt;
      const result: AuthorityCommitOutcome = {
        kind: "needsKp",
        code: "correctionRequired",
        receipt: publicTargetReceipt,
        diagnostics: [],
      };
      const preparedActionId = `prepared-error-report:${actionInput.submissionId}`;
      const persisted = this.authorityStore.transaction(() => {
        if (this.authorityStore.roomDeletion() !== undefined) {
          return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
        }
        const raced = this.authorityStore.submission(actionInput.submissionId);
        if (raced !== undefined) {
          if (raced.principal_id !== authenticated.principalId) {
            return rejectedAuthority(
              "submissionUnauthorized",
              "The submission belongs to another principal.",
            );
          }
          if (raced.payload_hash !== payloadHash) {
            return rejectedAuthority(
              "idempotencyPayloadMismatch",
              "The submission id was already used with a different payload.",
            );
          }
          return raced.result_json === null
            ? { kind: "retryableFailure" as const, code: "commitInProgress" }
            : parseJson<AuthorityCommitOutcome>(raced.result_json);
        }
        this.authorityStore.insertSubmission({
          submissionId: actionInput.submissionId,
          principalId: authenticated.principalId,
          payloadHash,
          inputKind: actionInput.kind,
          rootActionId: targetReceipt.rootActionId,
          preparedActionId,
          characterId,
          sceneScope: `scene:${replay.state.entities[characterId]?.sceneId ?? ""}`,
          preparedScopeVersion: this.authorityStore.scopeVersion(
            `scene:${replay.state.entities[characterId]?.sceneId ?? ""}`,
          ),
          prepared: {
            kind: "prepared",
            preparedActionId,
            rootActionId: targetReceipt.rootActionId,
            kpProjection: {},
          },
          continuation: {
            receiptId: actionInput.receiptId,
            concern: actionInput.concern,
            explanation: canonicalActionInput.explanation,
          },
        });
        this.authorityStore.finishErrorReport(preparedActionId, result);
        return result;
      });
      return persisted;
    }

    if (hasActiveSafetyPause(replay.state)
      && actionInput.kind !== "safetyPause"
      && actionInput.kind !== "safetyAdjust") {
      return presentationUnavailable();
    }

    let characterId: string;
    let rootActionId: string;
    let resolutionMode: PreparedAuthoritativeAction["resolutionMode"] = "kpProposal";
    if (actionInput.kind === "intent") {
      if (authenticated.characterIds.length !== 1) {
        return rejectedAuthority(
          "notController",
          "The trusted principal must have exactly one active controlled character.",
        );
      }
      characterId = authenticated.characterIds[0];
      rootActionId = `root-action:${actionInput.submissionId}`;
    } else if (
      actionInput.kind === "gear"
      || actionInput.kind === "environmentInteract"
      || actionInput.kind === "environmentAbility"
      || actionInput.kind === "movement"
      || actionInput.kind === "safetyPause"
      || actionInput.kind === "safetyAdjust"
    ) {
      if (authenticated.characterIds.length !== 1) {
        return rejectedAuthority(
          "notController",
          "The trusted principal must have exactly one active controlled character.",
        );
      }
      characterId = authenticated.characterIds[0];
      rootActionId = `root-action:${actionInput.submissionId}`;
      resolutionMode = "authorityDirect";
    } else if (actionInput.kind === "answer") {
      if (!nonEmptyString(actionInput.pendingInputId)) {
        return rejectedAuthority("invalidActionInput", "A pending input id is required.");
      }
      const pending = this.authorityStore.pending(actionInput.pendingInputId);
      if (
        pending === undefined
        || pending.status !== "open"
        || pending.controller_principal_id !== authenticated.principalId
        || !authenticated.characterIds.includes(pending.controller_character_id)
      ) {
        return rejectedAuthority("pendingInputUnauthorized", "The pending input is unavailable.");
      }
      characterId = pending.controller_character_id;
      rootActionId = pending.root_action_id;
      try {
        const pendingProjection = parseJson<JsonObject>(pending.pending_json);
        if ([
          "advancementChoice",
          "combatChoice",
          "groupRestConsent",
          "partyInvitation",
          "partyMoveConsent",
        ].includes(String(pendingProjection.kind))) {
          resolutionMode = "authorityDirect";
        }
      } catch {
        return rejectedAuthority("pendingInputUnavailable", "The pending input projection is unavailable.");
      }
    } else {
      return rejectedAuthority("unsupportedActionInput", "This retry shape is not available in this slice.");
    }

    const movementContext = actionInput.kind === "movement"
      ? this.authoritativeMovementContext(replay, authenticated, characterId)
      : undefined;
    if (actionInput.kind === "movement") {
      if (movementContext === undefined) {
        return rejectedAuthority(
          "privateOrUnknownReference",
          "The controlled tactical encounter is unavailable.",
        );
      }
      if (movementContext.spatialRevision !== actionInput.spatialRevision) {
        return rejectedAuthority(
          "spatialStateChanged",
          "The public tactical space changed before movement was prepared.",
        );
      }
    }

    const viewer = this.authorityPlayerViewer(authenticated, replay.state, characterId);
    const moduleProfile = await this.pinnedAuthorityModule(replay);
    let dueActorPlan: JsonObject | undefined;
    let dueActorPlanChildRootActionId: string | undefined;
    let dueActorPlanProjection: JsonObject | undefined;
    if (actionInput.kind === "intent") {
      const dueProjection = projectAuthoritative(
        replay.profiles,
        replay.state,
        { kind: "kp", capability: "internal:kp-spatial-evidence" },
        { dueActorPlanFor: { affectedCharacterId: characterId } },
      );
      if (dueProjection.kind === "rejected") {
        return rejectedAuthority("projectionFailure", "The due ActorPlan projection is unavailable.");
      }
      if ("dueActorPlan" in dueProjection && dueProjection.dueActorPlan !== null) {
        if (
          !isJsonRecord(dueProjection.dueActorPlan)
          || !nonEmptyString(dueProjection.dueActorPlan.planId)
          || !nonEmptyString(dueProjection.dueActorPlanChildRootActionId)
        ) {
          return rejectedAuthority("projectionFailure", "The selected due ActorPlan is incomplete.");
        }
        dueActorPlan = structuredClone(dueProjection.dueActorPlan);
        dueActorPlanChildRootActionId = dueProjection.dueActorPlanChildRootActionId;
        dueActorPlanProjection = dueProjection as unknown as JsonObject;
      }
    }
    const kpProjection = viewer === undefined || moduleProfile === undefined
      ? undefined
      : dueActorPlanProjection ?? this.kpAuthorityProjection(
          replay,
          viewer,
          moduleKpProjection(moduleProfile) as unknown as JsonObject,
        );
    const character = replay.state.entities[characterId];
    if (viewer === undefined || kpProjection === undefined || character === undefined) {
      return rejectedAuthority("notController", "The character projection is unavailable.");
    }
    const sceneScope = actionInput.kind === "safetyPause" || actionInput.kind === "safetyAdjust"
      ? "room:safety-presentation"
      : `scene:${character.sceneId}`;
    const prepared: PreparedAuthoritativeAction = {
      kind: "prepared",
      preparedActionId: `prepared-action:${actionInput.submissionId}`,
      rootActionId,
      kpProjection,
      resolutionMode,
      ...(actionInput.kind === "intent"
        ? dueActorPlan === undefined
          ? { phase: "playerIntent" as const }
          : { phase: "dueActorPlan" as const, dueActorPlan }
        : {}),
    };
    const persisted = this.authorityStore.transaction(() => {
      if (this.authorityStore.roomDeletion() !== undefined) {
        return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
      }
      const raced = this.authorityStore.submission(actionInput.submissionId);
      if (raced !== undefined) {
        if (raced.principal_id !== authenticated.principalId) {
          return rejectedAuthority(
            "submissionUnauthorized",
            "The submission belongs to another principal.",
          );
        }
        if (raced.payload_hash !== payloadHash) {
          return rejectedAuthority(
            "idempotencyPayloadMismatch",
            "The submission id was already used with a different payload.",
          );
        }
        return parseJson<PreparedAuthoritativeAction>(raced.prepared_json);
      }
      this.authorityStore.insertSubmission({
        submissionId: actionInput.submissionId,
        principalId: authenticated.principalId,
        payloadHash,
        inputKind: actionInput.kind,
        rootActionId,
        preparedActionId: prepared.preparedActionId,
        characterId,
        sceneScope,
        preparedScopeVersion: this.authorityStore.scopeVersion(sceneScope),
        prepared,
        ...(actionInput.kind === "intent"
          ? { continuation: { originalInput: canonicalActionInput } }
          : actionInput.kind === "answer"
          ? {
              continuation: {
                pendingInputId: actionInput.pendingInputId,
                answer: structuredClone(actionInput.answer),
                ...(nonEmptyString(actionInput.displayText)
                  ? { displayText: actionInput.displayText }
                  : {}),
              },
            }
          : actionInput.kind === "gear"
            ? {
                continuation: {
                  action: actionInput.action,
                  slot: actionInput.slot,
                  ...(actionInput.action === "wear" ? { itemId: actionInput.itemId } : {}),
                },
              }
            : actionInput.kind === "environmentInteract"
              ? {
                  continuation: {
                    featureId: actionInput.featureId,
                    intent: actionInput.intent,
                  },
                }
            : actionInput.kind === "environmentAbility"
              ? {
                  continuation: {
                    featureId: actionInput.featureId,
                    abilityRef: actionInput.abilityRef,
                  },
                }
            : actionInput.kind === "movement"
              ? {
                  continuation: {
                    encounterId: movementContext!.encounterId,
                    movementMode: actionInput.movementMode,
                    spatialRevision: actionInput.spatialRevision,
                    path: structuredClone(actionInput.path),
                  },
                }
            : actionInput.kind === "safetyAdjust"
              ? {
                  continuation: {
                    presentationAdjustment: actionInput.presentationAdjustment,
                  },
                }
          : {}),
      });
      if (dueActorPlan !== undefined && dueActorPlanChildRootActionId !== undefined) {
        this.authorityStore.insertActionStage({
          preparedActionId: prepared.preparedActionId,
          submissionId: actionInput.submissionId,
          targetId: dueActorPlan.planId as string,
          childRootActionId: dueActorPlanChildRootActionId,
        });
      }
      return prepared;
    });
    return persisted;
  }

  private async authorityMechanicalInput(
    submission: AuthoritySubmissionRow,
    proposalValue: unknown,
    profiles: RuntimeProfileManifest,
    state: AuthoritativeWorldState,
    authenticated: AuthenticatedAuthorityViewer,
  ): Promise<{
    input: JsonRecord;
    receiptExtras?: JsonObject;
    forceConcluded?: boolean;
  } | { rejection: Extract<AuthorityCommitOutcome, { kind: "rejected" }> }> {
    const nestedMechanical = isJsonRecord(proposalValue) && isJsonRecord(proposalValue.mechanicalProposal)
      ? proposalValue.mechanicalProposal
      : undefined;
    const topLevelRootActionId = isJsonRecord(proposalValue) && nonEmptyString(proposalValue.rootActionId)
      ? proposalValue.rootActionId
      : undefined;
    const nestedRootActionId = nonEmptyString(nestedMechanical?.rootActionId)
      ? nestedMechanical.rootActionId
      : undefined;
    if (
      !isJsonRecord(proposalValue)
      || (topLevelRootActionId ?? nestedRootActionId) !== submission.root_action_id
      || (topLevelRootActionId !== undefined && topLevelRootActionId !== submission.root_action_id)
      || (nestedRootActionId !== undefined && nestedRootActionId !== submission.root_action_id)
    ) {
      return {
        rejection: rejectedAuthority(
          "proposalRootMismatch",
          "The mechanical proposal does not belong to this root action.",
        ),
      };
    }
    if (
      proposalValue.kind === "authenticatedSafetyPause"
      && hasExactJsonKeys(proposalValue, ["kind", "rootActionId"])
      && submission.input_kind === "safetyPause"
    ) {
      return {
        input: {
          kind: "requestSafetyPause",
          rootActionId: submission.root_action_id,
          requesterPrincipalId: submission.principal_id,
          actorCharacterId: submission.character_id,
        },
      };
    }
    if (
      proposalValue.kind === "authenticatedSafetyAdjustment"
      && hasExactJsonKeys(proposalValue, ["kind", "rootActionId"])
      && submission.input_kind === "safetyAdjust"
      && submission.continuation_json !== null
    ) {
      const continuation = parseJson<JsonObject>(submission.continuation_json);
      if (
        !hasExactJsonKeys(continuation, ["presentationAdjustment"])
        || ![
          "fadeToBlack",
          "reduceDetail",
          "skipSensitiveContent",
        ].includes(String(continuation.presentationAdjustment))
      ) {
        return {
          rejection: rejectedAuthority(
            "invalidMechanicalProposal",
            "The prepared safety presentation adjustment is unavailable.",
          ),
        };
      }
      return {
        input: {
          kind: "adjustSafetyPresentation",
          rootActionId: submission.root_action_id,
          requesterPrincipalId: submission.principal_id,
          actorCharacterId: submission.character_id,
          presentationAdjustment: continuation.presentationAdjustment,
        },
      };
    }
    if (
      isJsonRecord(proposalValue)
      && proposalValue.kind === "authenticatedGearAction"
      && hasExactJsonKeys(proposalValue, ["kind", "rootActionId"])
      && submission.input_kind === "gear"
      && submission.continuation_json !== null
    ) {
      const continuation = parseJson<JsonObject>(submission.continuation_json);
      const wear = continuation.action === "wear";
      const stow = continuation.action === "stow";
      const expectedKeys = wear ? ["action", "itemId", "slot"] : ["action", "slot"];
      if (
        (!wear && !stow)
        || !hasExactJsonKeys(continuation, expectedKeys)
        || !nonEmptyString(continuation.slot)
        || !AUTHORITATIVE_GEAR_SLOTS.has(continuation.slot)
        || (wear && !nonEmptyString(continuation.itemId))
      ) {
        return {
          rejection: rejectedAuthority(
            "invalidMechanicalProposal",
            "The prepared semantic gear action is unavailable.",
          ),
        };
      }
      return {
        input: {
          kind: "changeCharacterGear",
          rootActionId: submission.root_action_id,
          controllerPrincipalId: submission.principal_id,
          actorCharacterId: submission.character_id,
          action: continuation.action,
          slot: continuation.slot,
          ...(wear ? { itemId: continuation.itemId as string } : {}),
        },
      };
    }
    if (
      proposalValue.kind === "authenticatedEnvironmentInteraction"
      && hasExactJsonKeys(proposalValue, ["kind", "rootActionId"])
      && submission.input_kind === "environmentInteract"
      && submission.continuation_json !== null
    ) {
      const continuation = parseJson<JsonObject>(submission.continuation_json);
      if (
        !hasExactJsonKeys(continuation, ["featureId", "intent"])
        || !nonEmptyString(continuation.featureId)
        || (continuation.intent !== "open" && continuation.intent !== "close")
      ) {
        return {
          rejection: rejectedAuthority(
            "invalidMechanicalProposal",
            "The prepared environment interaction is unavailable.",
          ),
        };
      }
      return {
        input: {
          kind: "interactEnvironmentFeature",
          rootActionId: submission.root_action_id,
          controllerPrincipalId: submission.principal_id,
          actorCharacterId: submission.character_id,
          featureId: continuation.featureId,
          intent: continuation.intent,
        },
      };
    }
    if (
      proposalValue.kind === "authenticatedEnvironmentAbility"
      && hasExactJsonKeys(proposalValue, ["kind", "rootActionId"])
      && submission.input_kind === "environmentAbility"
      && submission.continuation_json !== null
    ) {
      const continuation = parseJson<JsonObject>(submission.continuation_json);
      if (
        !hasExactJsonKeys(continuation, ["abilityRef", "featureId"])
        || !nonEmptyString(continuation.abilityRef)
        || !nonEmptyString(continuation.featureId)
      ) {
        return {
          rejection: rejectedAuthority(
            "invalidMechanicalProposal",
            "The prepared environment ability is unavailable.",
          ),
        };
      }
      return {
        input: {
          kind: "invokeEnvironmentAbility",
          rootActionId: submission.root_action_id,
          controllerPrincipalId: submission.principal_id,
          actorCharacterId: submission.character_id,
          featureId: continuation.featureId,
          abilityRef: continuation.abilityRef,
        },
      };
    }
    if (
      proposalValue.kind === "authenticatedMovement"
      && hasExactJsonKeys(proposalValue, ["kind", "rootActionId"])
      && submission.input_kind === "movement"
      && submission.continuation_json !== null
    ) {
      const continuation = parseJson<JsonObject>(submission.continuation_json);
      if (
        !hasExactJsonKeys(continuation, [
          "encounterId",
          "movementMode",
          "path",
          "spatialRevision",
        ])
        || !nonEmptyString(continuation.encounterId)
        || continuation.movementMode !== "walk"
        || !isTacticalSpatialRevision(continuation.spatialRevision)
        || !Array.isArray(continuation.path)
        || continuation.path.length < 2
        || continuation.path.length > 64
        || !continuation.path.every(isTacticalPosition)
      ) {
        return {
          rejection: rejectedAuthority(
            "invalidMechanicalProposal",
            "The prepared tactical movement is unavailable.",
          ),
        };
      }
      return {
        input: {
          kind: "moveCombatant",
          rootActionId: submission.root_action_id,
          encounterId: continuation.encounterId,
          sourceEntityId: submission.character_id,
          movementMode: continuation.movementMode,
          path: structuredClone(continuation.path),
        },
      };
    }
    let proposal = normalizeRoomKpProposal(proposalValue);
    if (proposal === undefined) {
      return {
        rejection: rejectedAuthority(
          "invalidMechanicalProposal",
          "The KP proposal is not a supported production proposal envelope.",
        ),
      };
    }
    if (proposal.kind === "resolveDynamicEnvironmentStunt") {
      if (
        (submission.input_kind !== "intent" && submission.input_kind !== "answer")
        || proposal.environmentProgramVersion !== ENVIRONMENT_PROFILE.profileId
        || !nonEmptyString(proposal.formProgramHash)
        || !isJsonRecord(proposal.draft)
        || !isJsonRecord(proposal.causalActionProgram)
        || !nonEmptyString(proposal.actionPlanVersion)
        || !nonEmptyString(proposal.actionLanguageHash)
        || proposal.formProgramHash !== proposal.causalActionProgram.semanticHash
      ) {
        return {
          rejection: rejectedAuthority(
            "invalidMechanicalProposal",
            "The dynamic environment proposal is not bound to the installed Rules Profile.",
          ),
        };
      }
      const actor = state.entities[submission.character_id];
      const sceneId = nonEmptyString(actor?.sceneId) ? actor.sceneId : undefined;
      if (sceneId === undefined) {
        return {
          rejection: rejectedAuthority(
            "privateOrUnknownReference",
            "The acting character has no authoritative environment scene.",
          ),
        };
      }
      const draft = proposal.draft;
      const disposition = draft.featureDisposition;
      let featureId: string;
      let featureDefinition: ReturnType<typeof buildCustomEnvironmentFeatureDefinition> | undefined;
      if (disposition === "reuse-existing") {
        const selected = selectEstablishedEnvironmentFeature(state, sceneId, draft);
        if (selected === undefined) {
          return {
            rejection: rejectedAuthority(
              "privateOrUnknownReference",
              "The KP proposal did not resolve to exactly one established environment feature.",
            ),
          };
        }
        featureId = selected;
      } else if (disposition === "reasonable-open-blank") {
        const basisRefs = environmentStringList(draft.basisRefs);
        const actorViewer = this.authorityPlayerViewer(
          authenticated,
          state,
          submission.character_id,
        );
        const actorProjection = actorViewer === undefined
          ? undefined
          : projectAuthoritative(profiles, state, actorViewer);
        const visibleFactIds = actorProjection?.kind === "projected"
          && "visibleFacts" in actorProjection
          ? new Set(actorProjection.visibleFacts.map((fact) => fact.id))
          : new Set<string>();
        const basisAvailable = basisRefs.length > 0 && basisRefs.every((reference) =>
          reference === sceneId || visibleFactIds.has(reference));
        if (!basisAvailable) {
          return {
            rejection: rejectedAuthority(
              "privateOrUnknownReference",
              "The KP-frozen custom environment basis is unavailable to the acting character.",
            ),
          };
        }
        const digest = await authorityHash({
          rootActionId: submission.root_action_id,
          sceneId,
          formProgramHash: proposal.formProgramHash,
        });
        featureId = `feature:v3:${digest.slice("sha256:".length, "sha256:".length + 32)}`;
        try {
          featureDefinition = buildCustomEnvironmentFeatureDefinition(
            customEnvironmentDefinitionInputFromDraft({ draft, featureId, sceneId }),
          );
        } catch {
          return {
            rejection: rejectedAuthority(
              "invalidMechanicalProposal",
              "The KP-frozen custom environment definition failed the installed Rules compiler.",
            ),
          };
        }
      } else {
        return {
          rejection: rejectedAuthority(
            "invalidMechanicalProposal",
            "The environment feature disposition is unavailable.",
          ),
        };
      }

      let activation: JsonObject;
      let abilityRef: string | undefined;
      if (draft.activation === "attack") {
        abilityRef = ownedEnvironmentAttackAbilityRef(state, submission.character_id, draft);
        if (abilityRef === undefined) {
          return {
            rejection: rejectedAuthority(
              "privateOrUnknownReference",
              "The KP proposal did not supply an owned authoritative attack compatible with this activation.",
            ),
          };
        }
        activation = { kind: "attack" };
      } else if (draft.activation === "check") {
        activation = {
          kind: "check",
          ability: draft.checkAbility as string,
          skill: draft.checkSkill as string,
          dc: String(draft.checkDc),
          mode: draft.checkMode as string,
        };
      } else if (draft.activation === "direct") {
        activation = { kind: "direct" };
      } else {
        return {
          rejection: rejectedAuthority(
            "invalidMechanicalProposal",
            "The environment activation is unavailable.",
          ),
        };
      }
      return {
        input: {
          kind: "invokeEnvironmentalStunt",
          rootActionId: submission.root_action_id,
          controllerPrincipalId: submission.principal_id,
          actorCharacterId: submission.character_id,
          featureId,
          actionPlanVersion: proposal.actionPlanVersion,
          actionLanguageHash: proposal.actionLanguageHash,
          causalActionProgram: structuredClone(proposal.causalActionProgram),
          activation,
          ...(abilityRef === undefined ? {} : { abilityRef }),
          ...(draft.resourceRef === undefined
            ? {}
            : {
                resourceCost: {
                  resourceRef: draft.resourceRef,
                  amount: draft.resourceAmount,
                },
              }),
          ...(featureDefinition === undefined
            ? {}
            : { materialization: { featureDefinition } }),
        },
      };
    }
    const moduleMigrationBinding = await bindRoomModuleMigration(
      proposal,
      state.campaignRuntime.campaign?.moduleRef,
      this.authorityStore.room()?.module_id ?? "",
    );
    if (moduleMigrationBinding.kind === "rejected") {
      return {
        rejection: rejectedAuthority(
          "profileIntegrityMismatch",
          "The requested chapter Module migration is not an exact approved Registry mapping.",
        ),
      };
    }
    proposal = moduleMigrationBinding.proposal;
    if (proposal.kind === "authenticatedPendingAnswer") {
      if (submission.input_kind !== "answer" || submission.continuation_json === null) {
        return {
          rejection: rejectedAuthority(
            "invalidPendingResolution",
            "No authenticated pending answer is prepared.",
          ),
        };
      }
      const continuation = parseJson<JsonObject>(submission.continuation_json);
      const pendingInputId = nonEmptyString(continuation.pendingInputId)
        ? continuation.pendingInputId
        : undefined;
      const answer = isJsonRecord(continuation.answer) ? continuation.answer : undefined;
      const pendingRow = pendingInputId === undefined
        ? undefined
        : this.authorityStore.pending(pendingInputId);
      const pendingProjection = pendingRow === undefined
        ? undefined
        : parseJson<JsonObject>(pendingRow.pending_json);
      if (pendingInputId === undefined || answer === undefined || pendingProjection === undefined) {
        return {
          rejection: rejectedAuthority(
            "invalidPendingResolution",
            "The authenticated answer continuation is incomplete.",
          ),
        };
      }
      if (pendingProjection.kind === "partyInvitation" || pendingProjection.kind === "partyMoveConsent") {
        if (!hasExactJsonKeys(answer, ["accept"]) || typeof answer.accept !== "boolean") {
          return {
            rejection: rejectedAuthority(
              "invalidPendingResolution",
              "Party consent requires a boolean answer.",
            ),
          };
        }
        return {
          input: {
            kind: pendingProjection.kind === "partyInvitation"
              ? "answerPartyInvitation"
              : "answerPartyMove",
            pendingInputId,
            rootActionId: submission.root_action_id,
            controllerCharacterId: submission.character_id,
            accept: answer.accept,
          },
        };
      }
      if (pendingProjection.kind === "groupRestConsent") {
        const options = isJsonRecord(pendingProjection.options)
          ? pendingProjection.options
          : undefined;
        const accepted = answer.kind === "restNow";
        const declined = answer.kind === "cancelRest";
        const arcaneRecoverySlotLevels = accepted
          ? canonicalRestAnswerArcaneRecoverySlotLevels(
              answer.arcaneRecoverySlotLevels,
              options?.restKind,
            )
          : [];
        const invalidGroupRestAnswer = options === undefined
          ? "missingOptions"
          : !["short", "long"].includes(String(options.restKind))
            ? "invalidFrozenKind"
            : !nonEmptyString(options.intendedDurationMicros)
              ? "invalidFrozenDuration"
              : !accepted && !declined
                ? "unsupportedAnswerKind"
                : accepted && !hasOnlyJsonKeys(
                    answer,
                    ["kind", "restKind"],
                    ["arcaneRecoverySlotLevels", "hitDice", "mode"],
                  )
                  ? `invalidAnswerKeys:${Object.keys(answer).sort().join(",")}`
                  : accepted && answer.restKind !== options.restKind
                    ? "restKindChanged"
                    : accepted && !(answer.mode === undefined || answer.mode === "group")
                      ? "invalidMode"
                      : accepted && !(answer.hitDice === undefined
                        || (Number.isSafeInteger(answer.hitDice) && Number(answer.hitDice) >= 0))
                        ? "invalidHitDice"
                        : accepted && arcaneRecoverySlotLevels === null
                          ? "invalidArcaneRecovery"
                          : declined && !hasExactJsonKeys(answer, ["kind"])
                            ? "invalidDeclineKeys"
                            : undefined;
        if (invalidGroupRestAnswer !== undefined) {
          return {
            rejection: rejectedAuthority(
              "invalidPendingResolution",
              `Group rest consent must preserve the invited player's own recovery choice or explicit refusal (${invalidGroupRestAnswer}).`,
            ),
          };
        }
        return {
          input: {
            kind: "answerGroupRestInvitation",
            proposalId: submission.root_action_id,
            pendingInputId,
            controllerCharacterId: submission.character_id,
            accept: accepted,
            hitDiceToSpend: accepted ? Number(answer.hitDice ?? 0) : 0,
            arcaneRecoverySlotLevels: arcaneRecoverySlotLevels ?? [],
          },
        };
      }
      if (pendingProjection.kind === "combatChoice") {
        return {
          input: {
            kind: "resolveImprovisedAction",
            rootActionId: submission.root_action_id,
            actorCharacterId: submission.character_id,
            ruling: { kind: "directSuccess", outcomeCode: "authenticated-combat-answer" },
          },
        };
      }
      if (pendingProjection.kind === "advancementChoice") {
        const advancementKeys = answer.abilityScoreIncreases === undefined
          ? ["classId", "hitPointMethod", "newLevel", "selectedFeatureIds"]
          : ["abilityScoreIncreases", "classId", "hitPointMethod", "newLevel", "selectedFeatureIds"];
        if (
          !hasExactJsonKeys(answer, advancementKeys)
          || !nonEmptyString(answer.classId)
          || answer.hitPointMethod !== "fixed2014"
          || !Number.isSafeInteger(answer.newLevel)
          || !Array.isArray(answer.selectedFeatureIds)
          || !answer.selectedFeatureIds.every(nonEmptyString)
          || (answer.abilityScoreIncreases !== undefined
            && (!isJsonRecord(answer.abilityScoreIncreases)
              || Object.entries(answer.abilityScoreIncreases).some(([ability, amount]) =>
                !["str", "dex", "con", "int", "wis", "cha"].includes(ability)
                || !Number.isSafeInteger(amount)
                || Number(amount) < 1
                || Number(amount) > 2)))
        ) {
          return {
            rejection: rejectedAuthority(
              "invalidPendingResolution",
              "Advancement requires one explicit SRD 2014 level choice.",
            ),
          };
        }
        return {
          input: {
            kind: "recordAdvancementChoice",
            proposalId: submission.root_action_id,
            pendingInputId,
            characterId: submission.character_id,
            choice: structuredClone(answer),
          },
        };
      }
      return {
        rejection: rejectedAuthority(
          "invalidPendingResolution",
          "This pending answer still requires KP adjudication.",
        ),
      };
    }

    if (proposal.kind === "resolveCompoundActionPlan") {
      if (submission.input_kind !== "intent" && submission.input_kind !== "answer") {
        return {
          rejection: rejectedAuthority(
            "invalidMechanicalProposal",
            "A compound ActionPlan must follow an authenticated player intent or pending answer.",
          ),
        };
      }
      const mechanicalProposal = isJsonRecord(proposal.mechanicalProposal)
        ? proposal.mechanicalProposal
        : undefined;
      const newOptions = Array.isArray(mechanicalProposal?.newOptions)
        ? mechanicalProposal.newOptions.filter(isJsonRecord).map((entry) => ({
            optionId: entry.id,
            summary: entry.summary,
          }))
        : [];
      const privateFormRef = isJsonRecord(proposalValue)
        && proposalValue.kind === "privateFormProposal"
        && nonEmptyString(proposalValue.formId)
        ? proposalValue.formId
        : undefined;
      const inWorldRefusal = privateFormRef === "in-world-refusal.v1"
        || (privateFormRef === "environmental-stunt.v1"
          && isJsonRecord(proposalValue.draft)
          && proposalValue.draft.featureDisposition === "explicitly-absent");
      return {
        input: {
          ...structuredClone(proposal),
          rootActionId: submission.root_action_id,
          actorCharacterId: submission.character_id,
        },
        ...(mechanicalProposal?.operation === "commitMeaningfulFailure" || inWorldRefusal
          ? {
              receiptExtras: {
                ...(mechanicalProposal?.operation === "commitMeaningfulFailure"
                  ? { meaningfulFailure: true, newOptions }
                  : {}),
                ...(inWorldRefusal
                  ? { resolutionDisposition: "inWorldRefusal" as const }
                  : {}),
              },
            }
          : {}),
      };
    }

    if (proposal.kind === "clarification" || proposal.kind === "playerChoice") {
      const proposedChoices = Array.isArray(proposal.choices) ? proposal.choices : [];
      const playerChoices = proposal.kind === "playerChoice"
        ? proposedChoices.filter(isJsonRecord)
        : [];
      if (
        !nonEmptyString(proposal.prompt)
        || (proposal.kind === "playerChoice" && (
          playerChoices.length < 2
          || playerChoices.length !== proposedChoices.length
          || playerChoices.some((choice) => !hasExactJsonKeys(
            choice,
            ["choiceId", "consequence", "label"],
          )
            || !nonEmptyString(choice.choiceId)
            || !nonEmptyString(choice.label)
            || !nonEmptyString(choice.consequence))
          || new Set(playerChoices.map((choice) => choice.choiceId)).size !== playerChoices.length
        ))
      ) {
        return {
          rejection: rejectedAuthority(
            "invalidMechanicalProposal",
            "Pending input requires canonical text and frozen player choices.",
          ),
        };
      }
      return {
        input: {
          kind: "resolveImprovisedAction",
          rootActionId: submission.root_action_id,
          actorCharacterId: submission.character_id,
          ruling: {
            kind: proposal.kind,
            pendingInputId: `pending-input:${submission.root_action_id}`,
            question: proposal.prompt,
            ...(proposal.kind === "playerChoice"
              ? { choices: structuredClone(playerChoices) }
              : {}),
          },
        },
      };
    }
    return {
      rejection: rejectedAuthority(
        "invalidMechanicalProposal",
        "Only a versioned compound ActionPlan or typed pending input may commit this action.",
      ),
    };
  }

  private authorityDiceTerms(request: JsonObject): AuthorityDiceTerm[] | undefined {
    if (
      !nonEmptyString(request.randomnessId)
      || !nonEmptyString(request.diceExpression)
    ) return undefined;
    if (Array.isArray(request.dice)) {
      const terms: AuthorityDiceTerm[] = [];
      let totalDraws = 0;
      for (const value of request.dice) {
        if (!isJsonRecord(value)) return undefined;
        const count = typeof value.count === "string" && /^[1-9][0-9]*$/.test(value.count)
          ? Number(value.count)
          : undefined;
        const sides = typeof value.sides === "string" && /^[1-9][0-9]*$/.test(value.sides)
          ? Number(value.sides)
          : undefined;
        if (
          !Number.isSafeInteger(count)
          || !Number.isSafeInteger(sides)
          || count! < 1
          || sides! < 2
          || sides! > 1_000_000
        ) return undefined;
        totalDraws += count!;
        if (totalDraws > 128) return undefined;
        terms.push({ count: count!, sides: sides! });
      }
      return terms.length > 0 ? terms : undefined;
    }
    if (request.diceExpression === "1d20") return [{ count: 1, sides: 20 }];
    if (request.diceExpression === "2d20kh1" || request.diceExpression === "2d20kl1") {
      return [{ count: 2, sides: 20 }];
    }
    return undefined;
  }

  private async authorityRandomnessJournalRequest(
    value: unknown,
  ): Promise<AuthorityRandomnessJournalRequest | undefined> {
    if (!isJsonRecord(value) || this.authorityDiceTerms(value) === undefined) return undefined;
    if (!nonEmptyString(value.randomnessId)) return undefined;
    const randomnessId = value.randomnessId;
    if (Array.isArray(value.dice)) {
      if (
        !nonEmptyString(value.resolutionId)
        || !nonEmptyString(value.purposeKey)
        || !nonEmptyString(value.requestHash)
        || !isJsonRecord(value.frozenParameters)
      ) return undefined;
      const { requestHash: _suppliedHash, ...core } = value;
      const requestHash = await authorityHash(core);
      if (requestHash !== value.requestHash) return undefined;
      return {
        randomnessId,
        requestHash,
        frozenParametersHash: await authorityHash(value.frozenParameters),
        request: structuredClone(value),
      };
    }
    const requestHash = await authorityHash(value);
    return {
      randomnessId,
      requestHash,
      frozenParametersHash: await authorityHash({
        authoritySubject: value.actorCharacterId ?? value.sourceEntityId ?? null,
        purpose: value.purpose ?? value.operation ?? null,
        diceExpression: value.diceExpression,
        frozenParameters: value.frozenCheck ?? value.frozenParameters ?? value,
      }),
      request: structuredClone(value),
    };
  }

  private authorityRandomnessFulfillment(
    first: Extract<ReturnType<typeof stepAuthoritative>, { kind: "awaitingRandomness" }>,
    requestCount: number,
  ): AuthorityRandomnessFulfillment | undefined {
    if (
      nonEmptyString(first.resolutionId)
      && nonEmptyString(first.continuationCapability)
    ) {
      return {
        kind: "combatBatch",
        resolutionId: first.resolutionId,
        continuationCapability: first.continuationCapability,
      };
    }
    const continuations = first.continuations
      ?? (first.continuation === undefined ? [] : [first.continuation]);
    if (continuations.length !== requestCount || continuations.some((entry) => !isJsonRecord(entry))) {
      return undefined;
    }
    return requestCount === 1
      ? { kind: "singleContinuation", continuation: structuredClone(continuations[0]) }
      : { kind: "continuationBatch", continuations: structuredClone(continuations) };
  }

  private authorityRandomnessFulfillmentMatches(
    value: unknown,
    requests: AuthorityRandomnessJournalRequest[],
  ): value is AuthorityRandomnessFulfillment {
    if (!isJsonRecord(value)) return false;
    if (value.kind === "singleContinuation") {
      return requests.length === 1 && isJsonRecord(value.continuation);
    }
    if (value.kind === "combatBatch") {
      return nonEmptyString(value.resolutionId)
        && nonEmptyString(value.continuationCapability)
        && requests.every(({ request }) => request.resolutionId === value.resolutionId);
    }
    if (value.kind === "continuationBatch") {
      return Array.isArray(value.continuations)
        && value.continuations.length === requests.length
        && value.continuations.every(isJsonRecord);
    }
    return false;
  }

  private authorityRandomnessWaves(
    value: unknown,
    requests: AuthorityRandomnessJournalRequest[],
  ): AuthorityRandomnessWave[] | undefined {
    if (!isJsonRecord(value) || value.kind !== "multiWave") {
      return this.authorityRandomnessFulfillmentMatches(value, requests)
        ? [{ requestCount: requests.length, fulfillment: structuredClone(value) }]
        : undefined;
    }
    if (
      !hasExactJsonKeys(value, ["kind", "waves"])
      || !Array.isArray(value.waves)
      || value.waves.length === 0
      || value.waves.length > MAX_AUTHORITY_RANDOMNESS_WAVES
    ) return undefined;
    const waves: AuthorityRandomnessWave[] = [];
    let requestOffset = 0;
    for (const rawWave of value.waves) {
      if (
        !isJsonRecord(rawWave)
        || !hasExactJsonKeys(rawWave, ["fulfillment", "requestCount"])
        || !Number.isSafeInteger(rawWave.requestCount)
        || Number(rawWave.requestCount) < 1
      ) return undefined;
      const requestCount = Number(rawWave.requestCount);
      const waveRequests = requests.slice(requestOffset, requestOffset + requestCount);
      if (
        waveRequests.length !== requestCount
        || !this.authorityRandomnessFulfillmentMatches(rawWave.fulfillment, waveRequests)
      ) return undefined;
      waves.push({
        requestCount,
        fulfillment: structuredClone(rawWave.fulfillment),
      });
      requestOffset += requestCount;
    }
    return requestOffset === requests.length ? waves : undefined;
  }

  private authorityRandomnessCandidatesMatch(
    value: unknown,
    requests: AuthorityRandomnessJournalRequest[],
  ): value is AuthorityRandomnessCandidate[] {
    if (!Array.isArray(value) || value.length !== requests.length) return false;
    return value.every((candidate, index) => {
      const request = requests[index];
      if (
        request === undefined
        || !isJsonRecord(candidate)
        || !hasExactJsonKeys(candidate, ["faces", "randomnessId"])
        || candidate.randomnessId !== request.randomnessId
        || !Array.isArray(candidate.faces)
      ) return false;
      const terms = this.authorityDiceTerms(request.request);
      if (terms === undefined) return false;
      const limits = terms.flatMap(({ count, sides }) =>
        Array.from({ length: count }, () => sides));
      return candidate.faces.length === limits.length
        && candidate.faces.every((face, faceIndex) =>
          Number.isInteger(face) && face >= 1 && face <= limits[faceIndex]);
    });
  }

  private authorityRandomnessBatchIsForwardExtension(
    stale: AuthorityRandomnessBatchJournalRow,
    newer: AuthorityRandomnessBatchJournalRow,
  ): boolean {
    if (
      newer.prepared_action_id !== stale.prepared_action_id
      || newer.proposal_hash !== stale.proposal_hash
      || newer.answered_pending_input_id !== stale.answered_pending_input_id
      || newer.status === "finalized"
    ) return false;
    try {
      const staleRequests = parseJson<unknown[]>(stale.requests_json);
      const newerRequests = parseJson<unknown[]>(newer.requests_json);
      const staleRequestEvents = parseJson<unknown[]>(stale.request_events_json);
      const newerRequestEvents = parseJson<unknown[]>(newer.request_events_json);
      const staleCandidates = stale.candidates_json === null
        ? []
        : parseJson<unknown[]>(stale.candidates_json);
      const newerCandidates = newer.candidates_json === null
        ? []
        : parseJson<unknown[]>(newer.candidates_json);
      const rawWaves = (serialized: string, requestCount: number): unknown[] | undefined => {
        const fulfillment = parseJson<unknown>(serialized);
        if (!isJsonRecord(fulfillment) || fulfillment.kind !== "multiWave") {
          return [{ requestCount, fulfillment }];
        }
        return hasExactJsonKeys(fulfillment, ["kind", "waves"])
          && Array.isArray(fulfillment.waves)
          ? fulfillment.waves
          : undefined;
      };
      const staleWaves = rawWaves(stale.fulfillment_json, staleRequests.length);
      const newerWaves = rawWaves(newer.fulfillment_json, newerRequests.length);
      const isPrefix = (prefix: unknown[], value: unknown[]) =>
        prefix.length <= value.length
        && prefix.every((entry, index) =>
          JSON.stringify(entry) === JSON.stringify(value[index]));
      if (
        staleWaves === undefined
        || newerWaves === undefined
        || !isPrefix(staleRequests, newerRequests)
        || !isPrefix(staleWaves, newerWaves)
        || !isPrefix(staleRequestEvents, newerRequestEvents)
        || !isPrefix(staleCandidates, newerCandidates)
      ) return false;
      const candidateAdvanced = staleRequests.length === newerRequests.length
        && staleWaves.length === newerWaves.length
        && staleRequestEvents.length === newerRequestEvents.length
        && newerCandidates.length > staleCandidates.length
        && stale.status === "requestCommitted"
        && newer.status === "candidateCommitted";
      const waveAdvanced = newerRequests.length > staleRequests.length
        && newerWaves.length > staleWaves.length
        && newerRequestEvents.length > staleRequestEvents.length;
      return candidateAdvanced || waveAdvanced;
    } catch {
      return false;
    }
  }

  private authorityRandomnessRequestEventsMatchPersisted(
    rootActionId: string,
    requestEvents: EventEnvelope[],
    requests: AuthorityRandomnessJournalRequest[],
    waves: AuthorityRandomnessWave[],
    initialRandomnessRootActionId?: string,
  ): boolean {
    const first = requestEvents[0];
    if (first === undefined) return false;
    const requestRootActionId = first.rootActionId;
    const randomnessEvent = requestEvents.find((event) => event.eventType === "RandomnessRequested");
    if (randomnessEvent === undefined) return false;
    const randomnessPayload = randomnessEvent.payload as JsonRecord;
    const randomnessRequest = isJsonRecord(randomnessPayload?.request)
      ? randomnessPayload.request
      : undefined;
    const rootAllowed = initialRandomnessRootActionId === undefined
      ? requestRootActionId === rootActionId
      : requestRootActionId === initialRandomnessRootActionId;
    const oneRoot = !requestEvents.some((event) => event.rootActionId !== requestRootActionId);
    const randomnessId = nonEmptyString(randomnessRequest?.randomnessId)
      ? randomnessRequest.randomnessId
      : undefined;
    const requestBound = requestRootActionId === rootActionId
      || (randomnessId !== undefined
        && randomnessId.startsWith(`randomness:${requestRootActionId}:`));
    if (!rootAllowed || !oneRoot || !requestBound) return false;
    const eventRequests: JsonObject[] = [];
    for (const event of requestEvents) {
      if (event.eventType !== "RandomnessRequested") continue;
      const payload: unknown = event.payload;
      if (!isJsonRecord(payload)) return false;
      if (isJsonRecord(payload.request)) {
        eventRequests.push(payload.request);
        continue;
      }
      const resolution = isJsonRecord(payload.resolution)
        ? payload.resolution
        : undefined;
      if (
        resolution === undefined
        || !Array.isArray(resolution.randomnessRequests)
        || resolution.randomnessRequests.length === 0
        || !resolution.randomnessRequests.every(isJsonRecord)
      ) return false;
      eventRequests.push(...resolution.randomnessRequests as JsonObject[]);
    }
    if (
      waves.reduce((total, wave) => total + wave.requestCount, 0) !== requests.length
      || eventRequests.length !== requests.length
      || eventRequests.some((request, index) =>
        JSON.stringify(request) !== JSON.stringify(requests[index]?.request))
    ) return false;
    const persisted = this.authorityStore.rootEvents(requestRootActionId);
    const startIndex = persisted.findIndex((event) => event.eventSeq === first.eventSeq);
    if (startIndex < 0 || startIndex + requestEvents.length > persisted.length) return false;
    const eventSeqs = new Set<string>();
    const eventIds = new Set<string>();
    for (const [offset, event] of requestEvents.entries()) {
      const match = persisted[startIndex + offset];
      if (
        event.rootActionId !== requestRootActionId
        || eventSeqs.has(event.eventSeq)
        || eventIds.has(event.eventId)
        || match?.eventSeq !== event.eventSeq
        || match.eventId !== event.eventId
        || JSON.stringify(match) !== JSON.stringify(event)
      ) return false;
      eventSeqs.add(event.eventSeq);
      eventIds.add(event.eventId);
    }
    return true;
  }

  private authorityRoll(sides: number): number {
    const limit = Math.floor(0x1_0000_0000 / sides) * sides;
    const sample = new Uint32Array(1);
    do crypto.getRandomValues(sample);
    while (sample[0] >= limit);
    return (sample[0] % sides) + 1;
  }

  private runAuthorityRecoveryCheckpoint(name: string): void {
    const hook = (this as unknown as {
      authorityRecoveryCheckpoint?: (checkpoint: string) => void;
    }).authorityRecoveryCheckpoint;
    hook?.(name);
  }

  private authorityAudienceBindings(
    profiles: RuntimeProfileManifest,
    state: AuthoritativeWorldState,
    actorCharacterId: string,
    receiptId: string,
    priorState: AuthoritativeWorldState,
    events: EventEnvelope[],
    actorMessage?: NonNullable<DeliveryPlan["actorMessage"]>,
  ): DeliveryAudienceBinding[] {
    const actor = state.entities[actorCharacterId];
    if (actor === undefined) return [];
    const bindings: DeliveryAudienceBinding[] = [];
    const candidates = new Map<string, typeof actor>();
    for (const character of [...Object.values(priorState.entities), ...Object.values(state.entities)]) {
      if (character.kind === "player") candidates.set(character.id, character);
    }
    for (const character of [...candidates.values()]
      .filter((entry) =>
        state.entities[entry.id]?.tenureStatus === "active" || entry.id === actorCharacterId)
      .sort((left, right) => left.id.localeCompare(right.id))) {
      const viewer = this.authorityViewerForCharacter(state, character.id)
        ?? (character.id === actorCharacterId
          ? this.authorityViewerForCharacter(priorState, character.id)
          : undefined);
      if (viewer === undefined) continue;
      const projection = projectAuthoritative(profiles, state, viewer, {
        committedRange: {
          receiptId,
          actorCharacterId,
          priorState,
          events,
        },
      });
      if (!isObserverProjection(projection)) continue;
      if (projection.committedDelta === undefined
        || projection.committedDelta.changes.length === 0) continue;
      const projectedForNarration = narrationProjection(
        projection as unknown as JsonObject,
        character.id,
        receiptId,
        state.entities,
      );
      const committedDelta = isJsonRecord(projectedForNarration.committedDelta)
        ? projectedForNarration.committedDelta
        : undefined;
      const observableActionKinds = Array.isArray(committedDelta?.changes)
        ? [...new Set(committedDelta.changes
            .filter(isJsonRecord)
            .map((change) => change.kind)
            .filter(nonEmptyString))]
        : [];
      projectedForNarration.actorAction = actorMessage?.characterId === character.id
        ? {
            kind: "actorDisplay",
            actorCharacterId,
            displayBody: actorMessage.body,
          }
        : {
            kind: "observerClaims",
            actorCharacterId,
            observableActionKinds,
          };
      projectedForNarration.experiencedTranscript = this.experiencedTranscriptForViewer(
        viewer,
        state,
        actorMessage,
      );
      const priorSceneId = priorState.entities[character.id]?.sceneId;
      const currentSceneId = state.entities[character.id]?.sceneId;
      bindings.push({
        audienceId: `audience:${receiptId}:${character.id}`,
        principalId: viewer.principalId,
        sessionVersion: viewer.sessionVersion!,
        seatId: viewer.seatId!,
        characterId: character.id,
        sceneIds: uniqueSceneIds([priorSceneId, currentSceneId]),
        projectionHash: projection.projectionHash,
        kpProjection: projectedForNarration,
      });
    }
    return bindings;
  }

  async commit(
    context: TrustedPrincipalContext,
    preparedActionId: string,
    mechanicalProposal: unknown,
  ): Promise<AuthorityCommitOutcome> {
    if (this.authorityStore.roomDeletion() !== undefined) {
      return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
    }
    const stage = nonEmptyString(preparedActionId)
      ? this.authorityStore.actionStage(preparedActionId)
      : undefined;
    if (
      stage !== undefined
      && (stage.status === "prepared"
        || (isJsonRecord(mechanicalProposal) && mechanicalProposal.kind === "actorPlanDecision"))
    ) {
      return this.commitDueActorPlan(context, preparedActionId, mechanicalProposal);
    }
    return this.commitAuthoritative(
      context,
      preparedActionId,
      { kind: "proposal", value: mechanicalProposal },
    );
  }

  private async commitDueActorPlan(
    context: TrustedPrincipalContext,
    preparedActionId: string,
    proposalValue: unknown,
  ): Promise<AuthorityCommitOutcome> {
    if (!nonEmptyString(preparedActionId)) {
      return rejectedAuthority("invalidPreparedAction", "A prepared action id is required.");
    }
    const replay = this.authoritativeReplay();
    const authenticated = this.authenticatedAuthorityViewer(context, replay.state);
    if (authenticated === undefined) {
      return rejectedAuthority("unauthenticated", "The trusted principal session is unavailable.");
    }
    const submission = this.authorityStore.submissionByPrepared(preparedActionId);
    const stage = this.authorityStore.actionStage(preparedActionId);
    if (
      submission === undefined
      || stage === undefined
      || stage.submission_id !== submission.submission_id
      || submission.principal_id !== authenticated.principalId
    ) {
      return rejectedAuthority("preparedActionUnauthorized", "The prepared action is unavailable.");
    }
    if (!authenticated.characterIds.includes(submission.character_id)) {
      return rejectedAuthority(
        "preparedActionUnauthorized",
        "The due ActorPlan's affected character is no longer controlled by this principal.",
      );
    }

    let proposalHash: string;
    try {
      proposalHash = await authorityHash(proposalValue);
    } catch {
      return rejectedAuthority("invalidMechanicalProposal", "The due ActorPlan decision must be canonical JSON.");
    }
    if (stage.proposal_hash !== null && stage.proposal_hash !== proposalHash) {
      return rejectedAuthority(
        "idempotencyPayloadMismatch",
        "The due ActorPlan stage was already committed with a different decision.",
      );
    }
    if (stage.status === "committed" && stage.result_json !== null) {
      const cached = parseJson<AuthorityCommitOutcome>(stage.result_json);
      await this.resumeAuthoritativeD1Archive();
      return cached;
    }
    if (
      !isJsonRecord(proposalValue)
      || !hasOnlyJsonKeys(proposalValue, [
        "decision",
        "kind",
        "mechanicalProposal",
        "planId",
        "proposalAttemptId",
        "rootActionId",
      ], ["deferUntilFictionMicros", "reason", "revision", "targetRef"])
      || proposalValue.kind !== "actorPlanDecision"
      || !["execute", "revise", "defer", "cancel"].includes(String(proposalValue.decision))
      || !nonEmptyString(proposalValue.planId)
      || !nonEmptyString(proposalValue.proposalAttemptId)
      || proposalValue.rootActionId !== submission.root_action_id
      || proposalValue.planId !== stage.target_id
    ) {
      return rejectedAuthority(
        "invalidMechanicalProposal",
        "A closed decision for the selected due ActorPlan is required.",
      );
    }
    if (
      proposalValue.decision !== "execute"
      && proposalValue.decision !== "cancel"
      && proposalValue.decision !== "defer"
      && proposalValue.decision !== "revise"
    ) {
      return rejectedAuthority(
        "unsupportedOperation",
        "This slice recognizes but does not yet execute that ActorPlan lifecycle decision.",
      );
    }
    const mechanicalExecution = proposalValue.decision === "execute"
      && isJsonRecord(proposalValue.mechanicalProposal);
    if (
      (proposalValue.decision === "execute"
        && proposalValue.mechanicalProposal !== null
        && !mechanicalExecution)
      || (proposalValue.decision !== "execute" && proposalValue.mechanicalProposal !== null)
    ) {
      return rejectedAuthority(
        "invalidMechanicalProposal",
        "Only ActorPlan execution may carry one closed mechanical proposal.",
      );
    }
    if (
      proposalValue.decision === "cancel"
      && (
        !nonEmptyString(proposalValue.reason)
        || proposalValue.deferUntilFictionMicros !== undefined
        || proposalValue.revision !== undefined
        || proposalValue.targetRef !== undefined
      )
    ) {
      return rejectedAuthority(
        "invalidMechanicalProposal",
        "ActorPlan cancellation requires one explicit reason.",
      );
    }
    if (
      proposalValue.decision === "defer"
      && (
        !nonEmptyString(proposalValue.reason)
        || !nonEmptyString(proposalValue.deferUntilFictionMicros)
        || proposalValue.revision !== undefined
        || proposalValue.targetRef !== undefined
      )
    ) {
      return rejectedAuthority(
        "invalidMechanicalProposal",
        "ActorPlan deferral requires one later fiction instant and reason.",
      );
    }
    if (
      proposalValue.decision === "execute"
      && (proposalValue.reason !== undefined
        || proposalValue.deferUntilFictionMicros !== undefined
        || proposalValue.revision !== undefined)
    ) {
      return rejectedAuthority("invalidMechanicalProposal", "ActorPlan execution has unexpected lifecycle fields.");
    }
    if (
      proposalValue.decision === "revise"
      && (!isJsonRecord(proposalValue.revision)
        || proposalValue.reason !== undefined
        || proposalValue.deferUntilFictionMicros !== undefined
        || proposalValue.targetRef !== undefined)
    ) {
      return rejectedAuthority("invalidMechanicalProposal", "ActorPlan revision is not canonical.");
    }
    if (
      proposalValue.decision !== "execute"
      && proposalValue.targetRef !== undefined
    ) {
      return rejectedAuthority("invalidMechanicalProposal", "Only ActorPlan execution can select a target.");
    }
    if (
      (submission.status !== "prepared"
        && !(mechanicalExecution && submission.status === "awaitingRandomness"))
      || this.authorityStore.scopeVersion(submission.scene_scope)
        !== submission.prepared_scope_version
    ) {
      return rejectedAuthority(
        "scopeConflict",
        "A relevant scene scope changed after this ActorPlan stage was prepared.",
      );
    }

    const rulesInput: JsonObject = {
      kind: "resolveDueActorPlan",
      proposalId: stage.child_root_action_id,
      causedByRootActionId: submission.root_action_id,
      affectedCharacterId: submission.character_id,
      planId: stage.target_id,
      decision: proposalValue.decision,
      mechanicalProposal: mechanicalExecution
        ? structuredClone(proposalValue.mechanicalProposal as JsonObject)
        : null,
      ...(proposalValue.decision === "cancel" || proposalValue.decision === "defer"
        ? { reason: proposalValue.reason }
        : {}),
      ...(proposalValue.decision === "defer"
        ? { deferUntilFictionMicros: proposalValue.deferUntilFictionMicros }
        : {}),
      ...(proposalValue.decision === "revise" ? { revision: proposalValue.revision } : {}),
      ...(proposalValue.decision === "execute" && proposalValue.targetRef !== undefined
        ? { targetRef: proposalValue.targetRef }
        : {}),
    };
    if (mechanicalExecution && submission.status === "awaitingRandomness") {
      return this.commitAuthoritative(context, preparedActionId, {
        kind: "canonicalInput",
        proposalHash,
        input: rulesInput,
      });
    }

    const dueProjection = projectAuthoritative(
      replay.profiles,
      replay.state,
      { kind: "kp", capability: "internal:kp-spatial-evidence" },
      { dueActorPlanFor: { affectedCharacterId: submission.character_id } },
    );
    if (
      dueProjection.kind === "rejected"
      || !("dueActorPlan" in dueProjection)
      || dueProjection.dueActorPlan === null
      || dueProjection.dueActorPlan.planId !== stage.target_id
      || dueProjection.dueActorPlanChildRootActionId !== stage.child_root_action_id
    ) {
      return rejectedAuthority(
        "privateOrUnknownReference",
        "The selected due ActorPlan is no longer eligible.",
      );
    }
    if (mechanicalExecution) {
      return this.commitAuthoritative(context, preparedActionId, {
        kind: "canonicalInput",
        proposalHash,
        input: rulesInput,
      });
    }
    const stepped = stepAuthoritative(replay.profiles, replay.state, rulesInput);
    if (stepped.kind === "rejected") {
      return rejectedAuthority(stepped.rejection.code, stepped.rejection.message);
    }
    if (stepped.kind !== "committed") {
      return rejectedAuthority(
        "invalidRulesResult",
        "A due ActorPlan decision must commit one deterministic Rules step.",
      );
    }

    const nextReplay: AuthorityReplay = { ...replay, state: stepped.state };
    const actorViewer = this.authorityViewerForCharacter(stepped.state, submission.character_id);
    const moduleProfile = await this.pinnedAuthorityModule(nextReplay);
    const kpProjection = actorViewer === undefined || moduleProfile === undefined
      ? undefined
      : this.kpAuthorityProjection(
          nextReplay,
          actorViewer,
          moduleKpProjection(moduleProfile) as unknown as JsonObject,
        );
    if (kpProjection === undefined) {
      return rejectedAuthority("projectionFailure", "The resumed player intent projection is unavailable.");
    }
    const prepared: PreparedAuthoritativeAction = {
      kind: "prepared",
      preparedActionId,
      rootActionId: submission.root_action_id,
      kpProjection,
      resolutionMode: "kpProposal",
      phase: "playerIntent",
    };
    const outcome: AuthorityCommitOutcome = { kind: "continue", prepared };
    const nextScopeVersion = this.authorityStore.scopeVersion(submission.scene_scope) + 1;
    const receipt: PublicReceipt = {
      receiptId: stepped.receipt.receiptId,
      rootActionId: stage.child_root_action_id,
      actorCharacterId: stage.target_id,
      status: "committed",
      runtimeEpochId: stepped.state.runtimeEpochId,
      activeBranchId: stepped.state.activeBranchId,
      eventRange: {
        first: stepped.events[0].eventSeq,
        last: stepped.events[stepped.events.length - 1].eventSeq,
        from: Number(stepped.events[0].eventSeq),
        to: Number(stepped.events[stepped.events.length - 1].eventSeq),
      },
      scopeVersions: { [submission.scene_scope]: String(nextScopeVersion) },
      randomnessCommitments: [],
    };
    const persisted = this.authorityStore.transaction(() => {
      if (this.authorityStore.roomDeletion() !== undefined) {
        return {
          outcome: rejectedAuthority("roomDeleting", "The room is sealed for deletion."),
          committedHere: false,
        };
      }
      const currentSubmission = this.authorityStore.submissionByPrepared(preparedActionId);
      const currentStage = this.authorityStore.actionStage(preparedActionId);
      const currentAuthenticated = this.authenticatedAuthorityViewer(
        context,
        this.authoritativeReplay().state,
      );
      if (
        currentSubmission === undefined
        || currentAuthenticated === undefined
        || currentSubmission.principal_id !== currentAuthenticated.principalId
        || !currentAuthenticated.characterIds.includes(currentSubmission.character_id)
      ) {
        return {
          outcome: rejectedAuthority(
            "preparedActionUnauthorized",
            "The due ActorPlan's affected character is no longer controlled by this principal.",
          ),
          committedHere: false,
        };
      }
      if (currentStage?.status === "committed" && currentStage.result_json !== null) {
        if (currentStage.proposal_hash !== proposalHash) {
          return {
            outcome: rejectedAuthority(
              "idempotencyPayloadMismatch",
              "The due ActorPlan stage was already committed with a different decision.",
            ),
            committedHere: false,
          };
        }
        return {
          outcome: parseJson<AuthorityCommitOutcome>(currentStage.result_json),
          committedHere: false,
        };
      }
      if (
        currentStage === undefined
        || currentSubmission.status !== "prepared"
        || currentStage.status !== "prepared"
        || this.authorityStore.scopeVersion(currentSubmission.scene_scope)
          !== currentSubmission.prepared_scope_version
      ) {
        return {
          outcome: rejectedAuthority(
            "scopeConflict",
            "A relevant scene scope changed before the due ActorPlan committed.",
          ),
          committedHere: false,
        };
      }
      this.authorityStore.appendEvents(stepped.events);
      this.authorityStore.updateState(stepped.state);
      this.authorityStore.advanceScope(currentSubmission.scene_scope);
      this.authorityStore.saveReceipt(receipt);
      this.authorityStore.syncAuthorityIndex(stepped.state);
      this.authorityStore.syncPendingAuthority(stepped.state);
      this.authorityStore.finishActionStage(preparedActionId, proposalHash, outcome);
      this.authorityStore.advancePreparedSubmission({
        preparedActionId,
        preparedScopeVersion: nextScopeVersion,
        prepared,
      });
      this.authorityStore.markArchivePending(Date.now());
      return { outcome, committedHere: true };
    });
    if (persisted.committedHere) await this.resumeAuthoritativeD1Archive();
    return persisted.outcome;
  }

  private async finishDueActorPlanMechanicalStage(input: {
    context: TrustedPrincipalContext;
    preparedActionId: string;
    proposalHash: string;
    journalPreparedActionId: string;
    replay: AuthorityReplay;
    submission: AuthoritySubmissionRow;
    stage: AuthorityActionStageRow;
    resolved: Extract<ReturnType<typeof stepAuthoritative>, { kind: "committed" }>;
    eventsToAppend: EventEnvelope[];
    receiptEvents: EventEnvelope[];
    randomness: Array<{
      randomnessId: string;
      faces: number[];
      requestHash: string;
      frozenParametersHash: string;
    }>;
    usedRandomnessJournal: boolean;
  }): Promise<AuthorityCommitOutcome> {
    const {
      context,
      preparedActionId,
      proposalHash,
      journalPreparedActionId,
      replay,
      submission,
      stage,
      resolved,
      eventsToAppend,
      receiptEvents,
      randomness,
      usedRandomnessJournal,
    } = input;
    const plan = resolved.state.campaignRuntime.npcPlans[stage.target_id];
    const npcId = nonEmptyString(plan?.npcId) ? plan.npcId : undefined;
    if (npcId === undefined || receiptEvents.length === 0) {
      return rejectedAuthority(
        "invalidRulesResult",
        "The due ActorPlan mechanical result has no canonical actor or event range.",
      );
    }
    const nextReplay: AuthorityReplay = { ...replay, state: resolved.state };
    const actorViewer = this.authorityViewerForCharacter(
      resolved.state,
      submission.character_id,
    );
    const moduleProfile = await this.pinnedAuthorityModule(nextReplay);
    const projected = actorViewer === undefined || moduleProfile === undefined
      ? undefined
      : this.kpAuthorityProjection(
          nextReplay,
          actorViewer,
          moduleKpProjection(moduleProfile) as unknown as JsonObject,
        );
    if (projected === undefined) {
      return rejectedAuthority(
        "projectionFailure",
        "The player intent could not be reprojected after the due ActorPlan mechanics.",
      );
    }
    const nextScopeVersion = this.authorityStore.scopeVersion(submission.scene_scope) + 1;
    const receipt: PublicReceipt = {
      receiptId: resolved.receipt.receiptId,
      rootActionId: stage.child_root_action_id,
      actorCharacterId: npcId,
      status: "committed",
      runtimeEpochId: resolved.state.runtimeEpochId,
      activeBranchId: resolved.state.activeBranchId,
      eventRange: {
        first: receiptEvents[0].eventSeq,
        last: receiptEvents[receiptEvents.length - 1].eventSeq,
        from: Number(receiptEvents[0].eventSeq),
        to: Number(receiptEvents[receiptEvents.length - 1].eventSeq),
      },
      scopeVersions: { [submission.scene_scope]: String(nextScopeVersion) },
      randomnessCommitments: randomness.map((entry) => ({
        randomnessId: entry.randomnessId,
        requestHash: entry.requestHash,
        frozenParametersHash: entry.frozenParametersHash,
      })),
    };
    const prepared: PreparedAuthoritativeAction = {
      kind: "prepared",
      preparedActionId,
      rootActionId: submission.root_action_id,
      receipt,
      kpProjection: {
        ...projected,
        mechanicalResult: {
          kind: resolved.kind,
          randomness: structuredClone(randomness),
          ...(resolved.mechanicalResult === undefined
            ? {}
            : { resolution: structuredClone(resolved.mechanicalResult) }),
        },
      },
      resolutionMode: "kpProposal",
      phase: "playerIntent",
    };
    const outcome: AuthorityCommitOutcome = { kind: "continue", prepared };
    const persisted = this.authorityStore.transaction(() => {
      if (this.authorityStore.roomDeletion() !== undefined) {
        return {
          outcome: rejectedAuthority("roomDeleting", "The room is sealed for deletion."),
          committedHere: false,
        };
      }
      const currentSubmission = this.authorityStore.submissionByPrepared(preparedActionId);
      const currentStage = this.authorityStore.actionStage(preparedActionId);
      const currentAuthenticated = this.authenticatedAuthorityViewer(
        context,
        this.authoritativeReplay().state,
      );
      if (
        currentSubmission === undefined
        || currentAuthenticated === undefined
        || currentSubmission.principal_id !== currentAuthenticated.principalId
        || !currentAuthenticated.characterIds.includes(currentSubmission.character_id)
      ) {
        return {
          outcome: rejectedAuthority(
            "preparedActionUnauthorized",
            "The due ActorPlan's affected character is no longer controlled by this principal.",
          ),
          committedHere: false,
        };
      }
      if (currentStage?.status === "committed" && currentStage.result_json !== null) {
        if (currentStage.proposal_hash !== proposalHash) {
          return {
            outcome: rejectedAuthority(
              "idempotencyPayloadMismatch",
              "The due ActorPlan stage was already committed with a different decision.",
            ),
            committedHere: false,
          };
        }
        return {
          outcome: parseJson<AuthorityCommitOutcome>(currentStage.result_json),
          committedHere: false,
        };
      }
      if (
        currentStage === undefined
        || currentSubmission.status !== (usedRandomnessJournal ? "awaitingRandomness" : "prepared")
        || currentSubmission.proposal_hash !== (usedRandomnessJournal ? proposalHash : null)
        || currentStage.status !== "prepared"
        || currentStage.child_root_action_id !== stage.child_root_action_id
        || currentStage.target_id !== stage.target_id
        || this.authorityStore.scopeVersion(currentSubmission.scene_scope)
          !== currentSubmission.prepared_scope_version
      ) {
        return {
          outcome: rejectedAuthority(
            "scopeConflict",
            "The due ActorPlan mechanical stage changed before its outcome committed.",
          ),
          committedHere: false,
        };
      }
      this.authorityStore.appendEvents(eventsToAppend);
      this.authorityStore.updateState(resolved.state);
      this.authorityStore.advanceScope(currentSubmission.scene_scope);
      this.authorityStore.saveReceipt(receipt);
      this.authorityStore.syncAuthorityIndex(resolved.state);
      this.authorityStore.syncPendingAuthority(resolved.state);
      if (usedRandomnessJournal) {
        this.authorityStore.finalizeRandomnessBatch(journalPreparedActionId);
      }
      this.authorityStore.finishActionStage(preparedActionId, proposalHash, outcome);
      this.authorityStore.advancePreparedSubmission({
        preparedActionId,
        preparedScopeVersion: nextScopeVersion,
        prepared,
      });
      this.authorityStore.markArchivePending(Date.now());
      return { outcome, committedHere: true };
    });
    if (persisted.committedHere && usedRandomnessJournal) {
      this.runAuthorityRecoveryCheckpoint("afterOutcomeCommitBeforeResponse");
    }
    await this.resumeAuthoritativeD1Archive();
    return persisted.outcome;
  }

  private async commitAuthoritative(
    context: TrustedPrincipalContext,
    preparedActionId: string,
    source: AuthorityCommitSource,
  ): Promise<AuthorityCommitOutcome> {
    if (this.authorityStore.roomDeletion() !== undefined) {
      return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
    }
    if (!nonEmptyString(preparedActionId)) {
      return rejectedAuthority("invalidPreparedAction", "A prepared action id is required.");
    }
    let replay = this.authoritativeReplay();
    const authenticated = this.authenticatedAuthorityViewer(context, replay.state);
    if (authenticated === undefined) {
      return rejectedAuthority("unauthenticated", "The trusted principal session is unavailable.");
    }
    const submission = this.authorityStore.submissionByPrepared(preparedActionId);
    if (submission === undefined || submission.principal_id !== authenticated.principalId) {
      return rejectedAuthority("preparedActionUnauthorized", "The prepared action is unavailable.");
    }
    if (!authenticated.characterIds.includes(submission.character_id)) {
      return rejectedAuthority(
        "preparedActionUnauthorized",
        "The prepared action's character is no longer controlled by this principal.",
      );
    }
    const actionStage = this.authorityStore.actionStage(preparedActionId);

    let proposalHash: string;
    let adapted: {
      input: JsonRecord;
      receiptExtras?: JsonObject;
      forceConcluded?: boolean;
    } | undefined;
    let answeredPendingInputId: string | undefined;
    let recoveryFact: AuthorityCommitRecovery | undefined;
    let dueActorPlanStage = false;
    if (source.kind === "recovery") {
      const recovery = await verifiedAuthorityCommitRecovery(source.row);
      if (recovery === undefined) {
        return { kind: "retryableFailure", code: "proposalRecoveryIntegrityMismatch" };
      }
      dueActorPlanStage = recovery.rulesInput.kind === "resolveDueActorPlan";
      const expectedRecoveryId = dueActorPlanStage
        ? actionStage?.child_root_action_id
        : preparedActionId;
      if (source.row.prepared_action_id !== expectedRecoveryId) {
        return { kind: "retryableFailure", code: "proposalRecoveryIntegrityMismatch" };
      }
      recoveryFact = recovery;
      proposalHash = source.row.proposal_hash;
      adapted = {
        input: structuredClone(recovery.rulesInput),
        ...(recovery.receiptExtras === null
          ? {}
          : { receiptExtras: structuredClone(recovery.receiptExtras) }),
        ...(recovery.forceConcluded ? { forceConcluded: true } : {}),
      };
      answeredPendingInputId = recovery.answeredPendingInputId ?? undefined;
    } else if (source.kind === "canonicalInput") {
      dueActorPlanStage = source.input.kind === "resolveDueActorPlan";
      proposalHash = source.proposalHash;
      adapted = { input: structuredClone(source.input) };
    } else {
      try {
        proposalHash = await authorityHash(source.value);
      } catch {
        return rejectedAuthority("invalidMechanicalProposal", "The proposal must be canonical JSON.");
      }
    }
    if (
      dueActorPlanStage
      && (
        actionStage === undefined
        || actionStage.status !== "prepared"
        || adapted?.input.proposalId !== actionStage.child_root_action_id
        || adapted.input.planId !== actionStage.target_id
      )
    ) return { kind: "retryableFailure", code: "proposalRecoveryIntegrityMismatch" };
    const journalPreparedActionId = dueActorPlanStage
      ? actionStage!.child_root_action_id
      : preparedActionId;

    if (submission.proposal_hash !== null && submission.proposal_hash !== proposalHash) {
      return rejectedAuthority(
        "idempotencyPayloadMismatch",
        "The prepared action was already committed with a different proposal.",
      );
    }
    if (submission.result_json !== null) {
      const cached = parseJson<AuthorityCommitOutcome>(submission.result_json);
      if (
        cached.kind === "committed"
        || cached.kind === "concluded"
        || cached.kind === "awaitingInput"
      ) {
        const eventRange = cached.receipt.eventRange;
        const progress = this.authorityStore.archiveProgress();
        const archiveBehind = progress !== undefined && (
          !progress.progress.genesisArchived
          || (eventRange !== null
            && BigInt(progress.progress.lastEventSeq) < BigInt(eventRange.last))
        );
        if (archiveBehind && !progress.pending) {
          this.authorityStore.transaction(() => {
            this.authorityStore.ensureArchivePending(Date.now());
          });
        }
        await this.resumeAuthoritativeD1Archive();
      }
      return cached;
    }
    if (hasActiveSafetyPause(replay.state)
      && submission.input_kind !== "safetyPause"
      && submission.input_kind !== "safetyAdjust") {
      return presentationUnavailable();
    }
    if (submission.input_kind === "movement") {
      const continuation = submission.continuation_json === null
        ? undefined
        : parseJson<JsonObject>(submission.continuation_json);
      const movementContext = this.authoritativeMovementContext(
        replay,
        authenticated,
        submission.character_id,
      );
      if (
        continuation === undefined
        || movementContext === undefined
        || !isTacticalSpatialRevision(continuation.spatialRevision)
        || movementContext.spatialRevision !== continuation.spatialRevision
        || movementContext.encounterId !== continuation.encounterId
      ) {
        return rejectedAuthority(
          "spatialStateChanged",
          "The public tactical space changed before movement committed.",
        );
      }
    }
    let randomnessBatch = this.authorityStore.randomnessBatch(journalPreparedActionId);
    if (
      submission.status !== "prepared"
      && submission.status !== "awaitingRandomness"
    ) {
      return { kind: "retryableFailure", code: "commitInProgress" };
    }
    if (
      (submission.status === "awaitingRandomness") !== (randomnessBatch !== undefined)
      || (randomnessBatch !== undefined && randomnessBatch.proposal_hash !== proposalHash)
    ) {
      return { kind: "retryableFailure", code: "randomnessJournalIntegrityMismatch" };
    }
    if (randomnessBatch !== undefined && recoveryFact === undefined) {
      const recoveryRow = this.authorityStore.proposalRecovery(journalPreparedActionId);
      if (
        recoveryRow === undefined
        || recoveryRow.proposal_hash !== proposalHash
        || recoveryRow.prepared_action_id !== journalPreparedActionId
      ) return { kind: "retryableFailure", code: "proposalRecoveryIntegrityMismatch" };
      recoveryFact = await verifiedAuthorityCommitRecovery(recoveryRow);
      if (recoveryFact === undefined) {
        return { kind: "retryableFailure", code: "proposalRecoveryIntegrityMismatch" };
      }
    }
    if (this.authorityStore.scopeVersion(submission.scene_scope) !== submission.prepared_scope_version) {
      return rejectedAuthority(
        "scopeConflict",
        "A relevant scene scope changed after this action was prepared.",
      );
    }

    const needsKp = (diagnostics: JsonObject[]): Extract<AuthorityCommitOutcome, { kind: "needsKp" }> => ({
      kind: "needsKp",
      receipt: {
        receiptId: `receipt:needs-kp:${submission.root_action_id}:${proposalHash.slice(-16)}`,
        rootActionId: submission.root_action_id,
        status: "needsKp",
        runtimeEpochId: replay.state.runtimeEpochId,
        activeBranchId: replay.state.activeBranchId,
        eventRange: null,
        scopeVersions: {
          [submission.scene_scope]: String(this.authorityStore.scopeVersion(submission.scene_scope)),
        },
        randomnessCommitments: [],
      },
      diagnostics,
    });

    if (adapted === undefined) {
      if (source.kind !== "proposal") {
        return { kind: "retryableFailure", code: "proposalRecoveryIntegrityMismatch" };
      }
      const externalAdapted = await this.authorityMechanicalInput(
        submission,
        source.value,
        replay.profiles,
        replay.state,
        authenticated,
      );
      if ("rejection" in externalAdapted) {
        if (
          submission.input_kind === "intent"
          && externalAdapted.rejection.code === "invalidMechanicalProposal"
        ) {
          return needsKp([{
            code: "invalidMechanicalProposal",
            publicPath: "KP 提案未形成可执行的版本化机械操作。",
            revisionHint: "保留玩家目标与做法，按当前 ActionPlan schema 修订机械提案后重新提交。",
            secrecy: "kp",
          }]);
        }
        return externalAdapted.rejection;
      }
      const migrationRequiresStableGlobalHead = isJsonRecord(
        externalAdapted.input.mechanicalProposal,
      ) && externalAdapted.input.mechanicalProposal.verifiedModuleMigration !== undefined;
      adapted = externalAdapted;
      // Registry verification can await Web Crypto. Re-read the authoritative
      // head so a concurrent chapter change is detected by deterministic Rules
      // validation rather than committing against the stale pre-verification state.
      const currentReplay = this.authoritativeReplay();
      if (
        migrationRequiresStableGlobalHead
        && currentReplay.replay.head.eventHash !== replay.replay.head.eventHash
      ) {
        return rejectedAuthority(
          "scopeConflict",
          "The authoritative global head changed during Module migration verification.",
        );
      }
      replay = currentReplay;
    }

    let rulesInput = adapted.input;
    if (source.kind === "proposal" && submission.input_kind === "answer") {
      const continuation = submission.continuation_json === null
        ? undefined
        : parseJson<JsonObject>(submission.continuation_json);
      if (
        continuation === undefined
        || !nonEmptyString(continuation.pendingInputId)
        || !isJsonRecord(continuation.answer)
      ) {
        return rejectedAuthority(
          "invalidPendingResolution",
          "A pending answer must resolve through the canonical Rules continuation.",
        );
      }
      answeredPendingInputId = continuation.pendingInputId;
      const combatPending = replay.state.combatRuntime.pendingInputs[continuation.pendingInputId];
      if (
        isJsonRecord(combatPending)
        && combatPending.kind === "playerChoice"
        && combatPending.controllerEntityId === submission.character_id
      ) {
        rulesInput = {
          kind: "answerPendingInput",
          pendingInputId: continuation.pendingInputId,
          responseId: submission.root_action_id,
          answer: structuredClone(continuation.answer),
        };
      } else if (rulesInput.kind === "answerGroupRestInvitation") {
        const answer = continuation.answer;
        const accepted = answer.kind === "restNow";
        const declined = answer.kind === "cancelRest";
        const arcaneRecoverySlotLevels = accepted
          ? canonicalRestAnswerArcaneRecoverySlotLevels(
              answer.arcaneRecoverySlotLevels,
              answer.restKind,
            )
          : [];
        const hitDiceToSpend = accepted ? Number(answer.hitDice ?? 0) : 0;
        if (
          (!accepted && !declined)
          || arcaneRecoverySlotLevels === null
          || rulesInput.accept !== accepted
          || rulesInput.hitDiceToSpend !== hitDiceToSpend
          || JSON.stringify(rulesInput.arcaneRecoverySlotLevels) !== JSON.stringify(arcaneRecoverySlotLevels)
        ) {
          return rejectedAuthority(
            "invalidPendingResolution",
            "The group rest continuation must preserve the authenticated player's answer.",
          );
        }
        rulesInput = {
          kind: "answerGroupRestInvitation",
          proposalId: submission.root_action_id,
          pendingInputId: continuation.pendingInputId,
          controllerCharacterId: submission.character_id,
          accept: accepted,
          hitDiceToSpend,
          arcaneRecoverySlotLevels: arcaneRecoverySlotLevels ?? [],
        };
      } else if (rulesInput.kind === "answerPartyInvitation" || rulesInput.kind === "answerPartyMove") {
        if (
          !hasExactJsonKeys(continuation.answer, ["accept"])
          ||
          typeof continuation.answer.accept !== "boolean"
          || rulesInput.accept !== continuation.answer.accept
        ) {
          return rejectedAuthority(
            "invalidPendingResolution",
            "The KP PartyGroup proposal must preserve the authenticated player's answer.",
          );
        }
        rulesInput = {
          kind: rulesInput.kind,
          pendingInputId: continuation.pendingInputId,
          rootActionId: submission.root_action_id,
          controllerCharacterId: submission.character_id,
          accept: continuation.answer.accept,
        };
      } else if (rulesInput.kind === "resolveImprovisedAction" && isJsonRecord(rulesInput.ruling)) {
        rulesInput = {
          kind: "answerPendingInput",
          pendingInputId: continuation.pendingInputId,
          rootActionId: submission.root_action_id,
          controllerCharacterId: submission.character_id,
          answer: structuredClone(continuation.answer),
          proposal: {
            kind: "resolveImprovisedAction",
            ruling: structuredClone(rulesInput.ruling),
          },
        };
      } else if (rulesInput.kind === "resolveCompoundActionPlan") {
        rulesInput = {
          kind: "answerPendingInput",
          pendingInputId: continuation.pendingInputId,
          rootActionId: submission.root_action_id,
          controllerCharacterId: submission.character_id,
          answer: structuredClone(continuation.answer),
          proposal: structuredClone(rulesInput),
        };
      } else if (rulesInput.kind === "recordAdvancementChoice" && isJsonRecord(rulesInput.choice)) {
        rulesInput = {
          kind: "answerPendingInput",
          pendingInputId: continuation.pendingInputId,
          rootActionId: submission.root_action_id,
          controllerCharacterId: submission.character_id,
          answer: structuredClone(continuation.answer),
          proposal: structuredClone(rulesInput),
        };
      } else {
        return rejectedAuthority(
          "invalidPendingResolution",
          "The pending answer does not match its authoritative Rules operation.",
        );
      }
    } else if (
      source.kind === "proposal"
      && submission.input_kind !== "intent"
      && submission.input_kind !== "gear"
      && submission.input_kind !== "environmentInteract"
      && submission.input_kind !== "environmentAbility"
      && submission.input_kind !== "movement"
      && submission.input_kind !== "safetyPause"
      && submission.input_kind !== "safetyAdjust"
    ) {
      return rejectedAuthority("unsupportedPendingResolution", "The prepared action kind is unsupported.");
    }

    let final: Extract<
      ReturnType<typeof stepAuthoritative>,
      { kind: "committed" | "concluded" | "awaitingInput" }
    > | undefined;
    let eventsToAppend: EventEnvelope[] = [];
    let receiptEvents: EventEnvelope[] = [];
    let usedRandomnessJournal = false;
    let randomness: Array<{
      randomnessId: string;
      faces: number[];
      requestHash: string;
      frozenParametersHash: string;
    }> = [];
    if (randomnessBatch === undefined) {
      const first = stepAuthoritative(replay.profiles, replay.state, rulesInput);
      if (first.kind === "needsKp") {
        return needsKp(first.diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          publicPath: diagnostic.message,
          revisionHint: "保留原目标与做法，按 Rules 诊断修订能力定义后重新提交。",
          secrecy: "kp",
          ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
          source: diagnostic.source,
        })));
      }
      if (first.kind === "rejected") {
        const isWorldRuling = [
          "missingPrerequisite",
          "unchangedRetry",
          "worldLawViolation",
        ].includes(first.rejection.code);
        if (
          !isWorldRuling
          && submission.input_kind === "intent"
          && source.kind === "proposal"
        ) {
          return needsKp([{
            code: first.rejection.code,
            publicPath: "KP 提案未通过权威机械诊断。",
            revisionHint: "依据 Rules 诊断修订完整 ActionPlan；不得改变玩家原始目标、提供骰面或提交状态补丁。",
            secrecy: "kp",
            rulesMessage: first.rejection.message,
          }]);
        }
        return rejectedAuthority(first.rejection.code, first.rejection.message);
      }
      if (first.kind === "initialized") {
        return rejectedAuthority("invalidRulesResult", "Rules returned an initialization result during commit.");
      }
      if (first.kind !== "awaitingRandomness") {
        final = first;
        eventsToAppend = [...first.events];
        receiptEvents = [...first.events];
      } else {
        const randomnessRequests = first.randomnessRequests
          ?? (first.randomnessRequest === undefined ? [] : [first.randomnessRequest]);
        if (
          randomnessRequests.length === 0
          || randomnessRequests.length > MAX_AUTHORITY_RANDOMNESS_REQUESTS
        ) {
          return rejectedAuthority(
            "invalidRulesResult",
            "Rules did not provide a bounded authoritative randomness batch.",
          );
        }
        const journalRequests: AuthorityRandomnessJournalRequest[] = [];
        for (const randomnessRequest of randomnessRequests) {
          const journalRequest = await this.authorityRandomnessJournalRequest(randomnessRequest);
          if (journalRequest === undefined) {
            return rejectedAuthority(
              "invalidRulesResult",
              "Rules provided a non-canonical authoritative randomness request.",
            );
          }
          journalRequests.push(journalRequest);
        }
        if (new Set(journalRequests.map(({ randomnessId }) => randomnessId)).size !== journalRequests.length) {
          return rejectedAuthority("invalidRulesResult", "Randomness ids must be unique within one action.");
        }
        const fulfillment = this.authorityRandomnessFulfillment(first, journalRequests.length);
        if (fulfillment === undefined) {
          return rejectedAuthority(
            "invalidRulesResult",
            "Rules did not provide a continuation matching the randomness batch.",
          );
        }
        const fulfillmentJournal: AuthorityRandomnessFulfillmentJournal = {
          kind: "multiWave",
          waves: [{ requestCount: journalRequests.length, fulfillment }],
        };
        const requestsJson = JSON.stringify(journalRequests);
        const fulfillmentJson = JSON.stringify(fulfillmentJournal);
        const initialRandomnessBatch: AuthorityRandomnessBatchJournalRow = {
          prepared_action_id: journalPreparedActionId,
          proposal_hash: proposalHash,
          requests_json: requestsJson,
          fulfillment_json: fulfillmentJson,
          request_events_json: JSON.stringify(first.events),
          answered_pending_input_id: answeredPendingInputId ?? null,
          candidates_json: null,
          status: "requestCommitted",
        };

        const initialRandomnessRootActionId = first.events[0]?.rootActionId;
        if (!nonEmptyString(initialRandomnessRootActionId)) {
          return rejectedAuthority(
            "invalidRulesResult",
            "Rules did not emit a canonical event root for authoritative randomness.",
          );
        }

        const recovery: AuthorityCommitRecovery = {
          rulesInput: structuredClone(rulesInput),
          answeredPendingInputId: answeredPendingInputId ?? null,
          receiptExtras: adapted.receiptExtras === undefined
            ? null
            : structuredClone(adapted.receiptExtras),
          forceConcluded: adapted.forceConcluded === true,
          initialRandomnessRootActionId,
        };
        recoveryFact = recovery;
        const recoveryHash = await authorityHash({ proposalHash, recovery });
        const recoveryCommit = this.authorityStore.transaction(() => {
          if (this.authorityStore.roomDeletion() !== undefined) {
            return {
              kind: "outcome" as const,
              outcome: rejectedAuthority("roomDeleting", "The room is sealed for deletion."),
            };
          }
          const current = this.authorityStore.submissionByPrepared(preparedActionId);
          if (current?.result_json !== null && current?.result_json !== undefined) {
            return {
              kind: "outcome" as const,
              outcome: parseJson<AuthorityCommitOutcome>(current.result_json),
            };
          }
          const persistedRecovery = this.authorityStore.proposalRecovery(journalPreparedActionId);
          if (persistedRecovery !== undefined) {
            if (
              persistedRecovery.proposal_hash !== proposalHash
              || persistedRecovery.recovery_hash !== recoveryHash
            ) {
              return {
                kind: "outcome" as const,
                outcome: {
                  kind: "retryableFailure" as const,
                  code: "proposalRecoveryIntegrityMismatch",
                },
              };
            }
            return { kind: "resumed" as const };
          }
          if (
            current === undefined
            || current.status !== "prepared"
            || this.authorityStore.scopeVersion(current.scene_scope) !== current.prepared_scope_version
          ) {
            return {
              kind: "outcome" as const,
              outcome: {
                kind: "retryableFailure" as const,
                code: "proposalRecoveryInputMissing",
              },
            };
          }
          this.authorityStore.saveProposalRecovery({
            preparedActionId: journalPreparedActionId,
            proposalHash,
            recoveryHash,
            recovery,
          });
          return { kind: "persisted" as const };
        });
        if (recoveryCommit.kind === "outcome") return recoveryCommit.outcome;

        this.runAuthorityRecoveryCheckpoint("beforeRandomnessRequestCommit");
        const requestCommit = this.authorityStore.transaction(() => {
          if (this.authorityStore.roomDeletion() !== undefined) {
            return {
              kind: "outcome" as const,
              outcome: rejectedAuthority("roomDeleting", "The room is sealed for deletion."),
            };
          }
          const current = this.authorityStore.submissionByPrepared(preparedActionId);
          if (current?.result_json !== null && current?.result_json !== undefined) {
            return {
              kind: "outcome" as const,
              outcome: parseJson<AuthorityCommitOutcome>(current.result_json),
            };
          }
          const racedBatch = this.authorityStore.randomnessBatch(journalPreparedActionId);
          if (racedBatch !== undefined) {
            const matchesInitial = racedBatch.proposal_hash === proposalHash
              && racedBatch.requests_json === initialRandomnessBatch.requests_json
              && racedBatch.fulfillment_json === initialRandomnessBatch.fulfillment_json
              && racedBatch.request_events_json === initialRandomnessBatch.request_events_json
              && racedBatch.answered_pending_input_id
                === initialRandomnessBatch.answered_pending_input_id
              && racedBatch.candidates_json === null
              && racedBatch.status === "requestCommitted";
            if (
              matchesInitial
              || this.authorityRandomnessBatchIsForwardExtension(
                initialRandomnessBatch,
                racedBatch,
              )
            ) return { kind: "resumed" as const };
            return {
              kind: "outcome" as const,
              outcome: rejectedAuthority(
                "randomnessJournalIntegrityMismatch",
                "The authoritative randomness request journal does not match this proposal.",
              ),
            };
          }
          if (
            current === undefined
            || current.status !== "prepared"
            || this.authorityStore.scopeVersion(current.scene_scope) !== current.prepared_scope_version
          ) {
            return {
              kind: "outcome" as const,
              outcome: rejectedAuthority(
                "scopeConflict",
                "A relevant scene scope changed before randomness was journaled.",
              ),
            };
          }
          if (this.authorityStore.hasRandomnessSettlementInScene(
            current.scene_scope,
            preparedActionId,
          )) {
            return {
              kind: "outcome" as const,
              outcome: {
                kind: "retryableFailure" as const,
                code: "sceneRandomnessSettlementInProgress",
              },
            };
          }
          this.authorityStore.appendEvents(first.events);
          this.authorityStore.updateState(first.state);
          this.authorityStore.markAwaitingRandomness(preparedActionId, proposalHash);
          this.authorityStore.saveRandomnessBatchRequest({
            preparedActionId: journalPreparedActionId,
            proposalHash,
            requests: journalRequests,
            fulfillment: fulfillmentJournal,
            requestEvents: first.events,
            ...(answeredPendingInputId === undefined ? {} : { answeredPendingInputId }),
          });
          this.authorityStore.markArchivePending(Date.now());
          return { kind: "persisted" as const };
        });
        if (requestCommit.kind === "outcome") return requestCommit.outcome;
        replay = requestCommit.kind === "resumed"
          ? this.authoritativeReplay()
          : { ...replay, state: first.state };
        randomnessBatch = this.authorityStore.randomnessBatch(journalPreparedActionId);
        if (randomnessBatch === undefined) {
          return { kind: "retryableFailure", code: "randomnessJournalMissing" };
        }
        this.runAuthorityRecoveryCheckpoint("afterRandomnessRequestCommit");
      }
    }

    if (randomnessBatch !== undefined) {
      usedRandomnessJournal = true;
      while (randomnessBatch !== undefined) {
        let storedRequests: unknown[];
        let storedFulfillment: unknown;
        let requestEvents: EventEnvelope[];
        let candidates: AuthorityRandomnessCandidate[];
        try {
          storedRequests = parseJson<unknown[]>(randomnessBatch.requests_json);
          storedFulfillment = parseJson<unknown>(randomnessBatch.fulfillment_json);
          requestEvents = parseJson<EventEnvelope[]>(randomnessBatch.request_events_json);
          candidates = randomnessBatch.candidates_json === null
            ? []
            : parseJson<AuthorityRandomnessCandidate[]>(randomnessBatch.candidates_json);
        } catch {
          return { kind: "retryableFailure", code: "randomnessJournalIntegrityMismatch" };
        }
        if (
          !Array.isArray(storedRequests)
          || storedRequests.length === 0
          || storedRequests.length > MAX_AUTHORITY_RANDOMNESS_REQUESTS
          || !Array.isArray(requestEvents)
          || requestEvents.length === 0
          || !Array.isArray(candidates)
        ) {
          return { kind: "retryableFailure", code: "randomnessJournalIntegrityMismatch" };
        }
        const journalRequests: AuthorityRandomnessJournalRequest[] = [];
        for (const storedRequest of storedRequests) {
          if (
            !isJsonRecord(storedRequest)
            || !hasExactJsonKeys(storedRequest, [
              "frozenParametersHash",
              "randomnessId",
              "request",
              "requestHash",
            ])
            || !nonEmptyString(storedRequest.randomnessId)
            || !nonEmptyString(storedRequest.requestHash)
            || !nonEmptyString(storedRequest.frozenParametersHash)
          ) return { kind: "retryableFailure", code: "randomnessJournalIntegrityMismatch" };
          const recalculated = await this.authorityRandomnessJournalRequest(storedRequest.request);
          if (
            recalculated === undefined
            || recalculated.randomnessId !== storedRequest.randomnessId
            || recalculated.requestHash !== storedRequest.requestHash
            || recalculated.frozenParametersHash !== storedRequest.frozenParametersHash
          ) return { kind: "retryableFailure", code: "randomnessJournalIntegrityMismatch" };
          journalRequests.push(recalculated);
        }
        const waves = this.authorityRandomnessWaves(storedFulfillment, journalRequests);
        if (
          waves === undefined
          || new Set(journalRequests.map(({ randomnessId }) => randomnessId)).size
            !== journalRequests.length
        ) {
          return { kind: "retryableFailure", code: "randomnessJournalIntegrityMismatch" };
        }
        if (!this.authorityRandomnessRequestEventsMatchPersisted(
          submission.root_action_id,
          requestEvents,
          journalRequests,
          waves,
          recoveryFact?.initialRandomnessRootActionId,
        )) return { kind: "retryableFailure", code: "randomnessJournalIntegrityMismatch" };
        const activeWaveIndex = waves.length - 1;
        const activeWave = waves[activeWaveIndex];
        const completedRequestCount = journalRequests.length - activeWave.requestCount;
        const validCandidateLength = candidates.length === completedRequestCount
          || candidates.length === journalRequests.length;
        const statusMatchesCandidates = randomnessBatch.status === "requestCommitted"
          ? candidates.length === completedRequestCount
          : candidates.length === journalRequests.length;
        if (!validCandidateLength || !statusMatchesCandidates) {
          return { kind: "retryableFailure", code: "randomnessJournalIntegrityMismatch" };
        }
        if (!this.authorityRandomnessCandidatesMatch(
          candidates,
          journalRequests.slice(0, candidates.length),
        )) return { kind: "retryableFailure", code: "randomnessJournalIntegrityMismatch" };

        if (candidates.length === completedRequestCount) {
          if (this.authorityStore.roomDeletion() !== undefined) {
            return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
          }
          const activeRequests = journalRequests.slice(completedRequestCount);
          const generated: AuthorityRandomnessCandidate[] = activeRequests.map((entry) => ({
            randomnessId: entry.randomnessId,
            faces: this.authorityDiceTerms(entry.request)!
              .flatMap(({ count, sides }) =>
                Array.from({ length: count }, () => this.authorityRoll(sides))),
          }));
          const cumulativeCandidates = [...candidates, ...generated];
          const candidateCommit = this.authorityStore.transaction(() => {
            if (this.authorityStore.roomDeletion() !== undefined) {
              return {
                kind: "outcome" as const,
                outcome: rejectedAuthority("roomDeleting", "The room is sealed for deletion."),
              };
            }
            const current = this.authorityStore.submissionByPrepared(preparedActionId);
            if (current?.result_json !== null && current?.result_json !== undefined) {
              return {
                kind: "outcome" as const,
                outcome: parseJson<AuthorityCommitOutcome>(current.result_json),
              };
            }
            const racedBatch = this.authorityStore.randomnessBatch(journalPreparedActionId);
            if (
              racedBatch !== undefined
              && this.authorityRandomnessBatchIsForwardExtension(
                randomnessBatch!,
                racedBatch,
              )
            ) return { kind: "resumed" as const };
            if (
              current === undefined
              || current.status !== "awaitingRandomness"
              || current.proposal_hash !== proposalHash
              || this.authorityStore.scopeVersion(current.scene_scope)
                !== current.prepared_scope_version
              || racedBatch === undefined
              || racedBatch.proposal_hash !== proposalHash
              || racedBatch.requests_json !== randomnessBatch!.requests_json
              || racedBatch.fulfillment_json !== randomnessBatch!.fulfillment_json
              || racedBatch.request_events_json !== randomnessBatch!.request_events_json
              || racedBatch.candidates_json !== randomnessBatch!.candidates_json
              || racedBatch.status !== "requestCommitted"
            ) {
              return {
                kind: "outcome" as const,
                outcome: {
                  kind: "retryableFailure" as const,
                  code: "randomnessJournalIntegrityMismatch",
                },
              };
            }
            this.authorityStore.saveRandomnessBatchCandidates(
              journalPreparedActionId,
              cumulativeCandidates,
            );
            return { kind: "persisted" as const };
          });
          if (candidateCommit.kind === "outcome") return candidateCommit.outcome;
          if (candidateCommit.kind === "resumed") replay = this.authoritativeReplay();
          randomnessBatch = this.authorityStore.randomnessBatch(journalPreparedActionId);
          if (randomnessBatch === undefined) {
            return { kind: "retryableFailure", code: "randomnessCandidateMissing" };
          }
          if (candidateCommit.kind === "persisted") {
            this.runAuthorityRecoveryCheckpoint("afterRandomnessCandidateCommit");
          }
          continue;
        }

        const candidateById = new Map(candidates.map((candidate) => [
          candidate.randomnessId,
          candidate,
        ]));
        randomness = journalRequests.map((entry) => ({
          randomnessId: entry.randomnessId,
          faces: [...candidateById.get(entry.randomnessId)!.faces],
          requestHash: entry.requestHash,
          frozenParametersHash: entry.frozenParametersHash,
        }));
        const activeRequests = journalRequests.slice(completedRequestCount);
        const activeRandomness = randomness.slice(completedRequestCount);
        const fulfillment = activeWave.fulfillment;
        let fulfillmentInput: JsonObject;
        if (fulfillment.kind === "singleContinuation") {
          fulfillmentInput = {
            kind: "fulfillAuthoritativeRandomness",
            continuation: fulfillment.continuation,
            rolls: activeRandomness[0].faces,
          };
        } else if (fulfillment.kind === "combatBatch") {
          fulfillmentInput = {
            kind: "authoritativeRandomness",
            resolutionId: fulfillment.resolutionId,
            continuationCapability: fulfillment.continuationCapability,
            responseId: `randomness-response:${submission.root_action_id}:wave:${activeWaveIndex + 1}`,
            randomnessResults: activeRequests.map((entry) => {
              const faces = candidateById.get(entry.randomnessId)!.faces;
              let offset = 0;
              return {
                randomnessId: entry.randomnessId,
                requestHash: entry.requestHash,
                draws: this.authorityDiceTerms(entry.request)!.map(({ count, sides }) => {
                  const termFaces = faces.slice(offset, offset + count);
                  offset += count;
                  return { sides, faces: termFaces };
                }),
              };
            }),
          };
        } else {
          fulfillmentInput = {
            kind: "fulfillAuthoritativeRandomnessBatch",
            results: fulfillment.continuations.map((continuation, index) => ({
              continuation,
              rolls: activeRandomness[index].faces,
            })),
          };
        }
        const fulfilled = stepAuthoritative(replay.profiles, replay.state, fulfillmentInput);
        if (fulfilled.kind === "needsKp") {
          return needsKp(fulfilled.diagnostics.map((diagnostic) => ({
            code: diagnostic.code,
            publicPath: diagnostic.message,
            revisionHint: "保持已冻结参数与骰面，修订后续能力定义而不得重掷。",
            secrecy: "kp",
            ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
            source: diagnostic.source,
          })));
        }
        if (fulfilled.kind === "rejected") {
          return rejectedAuthority(fulfilled.rejection.code, fulfilled.rejection.message);
        }
        if (fulfilled.kind === "initialized") {
          return rejectedAuthority(
            "invalidRulesResult",
            "Rules returned an initialization result during randomness fulfillment.",
          );
        }
        if (fulfilled.kind === "awaitingRandomness") {
          const nextRandomnessRequests = fulfilled.randomnessRequests
            ?? (fulfilled.randomnessRequest === undefined ? [] : [fulfilled.randomnessRequest]);
          if (
            nextRandomnessRequests.length === 0
            || waves.length >= MAX_AUTHORITY_RANDOMNESS_WAVES
            || journalRequests.length + nextRandomnessRequests.length
              > MAX_AUTHORITY_RANDOMNESS_REQUESTS
          ) {
            return rejectedAuthority(
              "invalidRulesResult",
              "Rules did not provide a bounded authoritative randomness continuation.",
            );
          }
          const nextJournalRequests: AuthorityRandomnessJournalRequest[] = [];
          for (const randomnessRequest of nextRandomnessRequests) {
            const journalRequest = await this.authorityRandomnessJournalRequest(randomnessRequest);
            if (journalRequest === undefined) {
              return rejectedAuthority(
                "invalidRulesResult",
                "Rules provided a non-canonical authoritative randomness continuation.",
              );
            }
            nextJournalRequests.push(journalRequest);
          }
          const cumulativeRequests = [...journalRequests, ...nextJournalRequests];
          if (
            new Set(cumulativeRequests.map(({ randomnessId }) => randomnessId)).size
              !== cumulativeRequests.length
          ) {
            return rejectedAuthority(
              "invalidRulesResult",
              "Randomness ids must be unique across every wave of one action.",
            );
          }
          const nextFulfillment = this.authorityRandomnessFulfillment(
            fulfilled,
            nextJournalRequests.length,
          );
          if (nextFulfillment === undefined) {
            return rejectedAuthority(
              "invalidRulesResult",
              "Rules did not provide a continuation matching the next randomness wave.",
            );
          }
          const cumulativeFulfillment: AuthorityRandomnessFulfillmentJournal = {
            kind: "multiWave",
            waves: [
              ...waves,
              { requestCount: nextJournalRequests.length, fulfillment: nextFulfillment },
            ],
          };
          const cumulativeRequestEvents = [...requestEvents, ...fulfilled.events];
          this.runAuthorityRecoveryCheckpoint("beforeRandomnessRequestCommit");
          const requestCommit = this.authorityStore.transaction(() => {
            if (this.authorityStore.roomDeletion() !== undefined) {
              return {
                kind: "outcome" as const,
                outcome: rejectedAuthority("roomDeleting", "The room is sealed for deletion."),
              };
            }
            const current = this.authorityStore.submissionByPrepared(preparedActionId);
            if (current?.result_json !== null && current?.result_json !== undefined) {
              return {
                kind: "outcome" as const,
                outcome: parseJson<AuthorityCommitOutcome>(current.result_json),
              };
            }
            const racedBatch = this.authorityStore.randomnessBatch(journalPreparedActionId);
            if (
              racedBatch !== undefined
              && this.authorityRandomnessBatchIsForwardExtension(
                randomnessBatch!,
                racedBatch,
              )
            ) return { kind: "resumed" as const };
            if (
              current === undefined
              || current.status !== "awaitingRandomness"
              || current.proposal_hash !== proposalHash
              || this.authorityStore.scopeVersion(current.scene_scope)
                !== current.prepared_scope_version
              || racedBatch === undefined
              || racedBatch.proposal_hash !== proposalHash
              || racedBatch.requests_json !== randomnessBatch!.requests_json
              || racedBatch.fulfillment_json !== randomnessBatch!.fulfillment_json
              || racedBatch.request_events_json !== randomnessBatch!.request_events_json
              || racedBatch.candidates_json !== randomnessBatch!.candidates_json
              || racedBatch.status !== "candidateCommitted"
            ) {
              return {
                kind: "outcome" as const,
                outcome: {
                  kind: "retryableFailure" as const,
                  code: "randomnessJournalIntegrityMismatch",
                },
              };
            }
            this.authorityStore.appendEvents(fulfilled.events);
            this.authorityStore.updateState(fulfilled.state);
            this.authorityStore.advanceRandomnessBatchWave({
              preparedActionId: journalPreparedActionId,
              requests: cumulativeRequests,
              fulfillment: cumulativeFulfillment,
              requestEvents: cumulativeRequestEvents,
              candidates,
            });
            this.authorityStore.markArchivePending(Date.now());
            return { kind: "persisted" as const };
          });
          if (requestCommit.kind === "outcome") return requestCommit.outcome;
          replay = requestCommit.kind === "resumed"
            ? this.authoritativeReplay()
            : { ...replay, state: fulfilled.state };
          randomnessBatch = this.authorityStore.randomnessBatch(journalPreparedActionId);
          if (randomnessBatch === undefined) {
            return { kind: "retryableFailure", code: "randomnessJournalMissing" };
          }
          this.runAuthorityRecoveryCheckpoint("afterRandomnessRequestCommit");
          continue;
        }
        final = fulfilled;
        eventsToAppend = [...fulfilled.events];
        receiptEvents = [...requestEvents, ...fulfilled.events];
        answeredPendingInputId = randomnessBatch.answered_pending_input_id
          ?? answeredPendingInputId;
        break;
      }
    }

    if (final === undefined) {
      return { kind: "retryableFailure", code: "incompleteAuthorityCommit" };
    }
    const resolved = final;
    if (dueActorPlanStage) {
      if (resolved.kind !== "committed" || actionStage === undefined) {
        return rejectedAuthority(
          "invalidRulesResult",
          "Due ActorPlan mechanics must settle before the player intent resumes.",
        );
      }
      return this.finishDueActorPlanMechanicalStage({
        context,
        preparedActionId,
        proposalHash,
        journalPreparedActionId,
        replay,
        submission,
        stage: actionStage,
        resolved,
        eventsToAppend,
        receiptEvents,
        randomness,
        usedRandomnessJournal,
      });
    }
    if (
      resolved.kind === "awaitingInput"
      && isJsonRecord(resolved.pending)
      && resolved.pending.kind === "kpDecision"
    ) {
      if (usedRandomnessJournal) {
        return {
          kind: "retryableFailure",
          code: "kpDecisionAfterRandomnessUnsupported",
        };
      }
      return needsKp([{
          code: "kpDecisionRequired",
          publicPath: "该 NPC 或势力行动需要 KP 依据其有限知识作出明确选择。",
          revisionHint: "使用待决输入给出的合法候选，补全 NPC 机械提案后以同一 rootActionId 重新提交完整 ActionPlan。",
          secrecy: "kp",
          pending: structuredClone(resolved.pending),
      }]);
    }
    const status = resolved.kind === "awaitingInput"
      ? "awaitingInput" as const
      : resolved.kind === "concluded" || adapted.forceConcluded === true
        ? "concluded" as const
        : "committed" as const;
    const nextScopeVersion = this.authorityStore.scopeVersion(submission.scene_scope) + 1;
    const receipt: PublicReceipt = {
      receiptId: resolved.receipt.receiptId,
      rootActionId: submission.root_action_id,
      actorCharacterId: submission.character_id,
      status,
      runtimeEpochId: resolved.state.runtimeEpochId,
      activeBranchId: resolved.state.activeBranchId,
      eventRange: receiptEvents.length === 0
        ? null
        : {
            first: receiptEvents[0].eventSeq,
            last: receiptEvents[receiptEvents.length - 1].eventSeq,
            from: Number(receiptEvents[0].eventSeq),
            to: Number(receiptEvents[receiptEvents.length - 1].eventSeq),
          },
      scopeVersions: { [submission.scene_scope]: String(nextScopeVersion) },
      randomnessCommitments: randomness.map((entry) => ({
        randomnessId: entry.randomnessId,
        requestHash: entry.requestHash,
        frozenParametersHash: entry.frozenParametersHash,
      })),
      ...(adapted.receiptExtras ?? {}),
    };
    const actorViewer = this.authorityViewerForCharacter(resolved.state, submission.character_id);
    const priorActorViewer = this.authorityViewerForCharacter(replay.state, submission.character_id);
    const actorProjection = actorViewer !== undefined
      ? projectAuthoritative(replay.profiles, resolved.state, actorViewer)
      : priorActorViewer === undefined
        ? undefined
        : projectAuthoritative(replay.profiles, replay.state, priorActorViewer);
    if (actorProjection === undefined || actorProjection.kind === "rejected") {
      return rejectedAuthority("projectionFailure", "The committed actor projection is unavailable.");
    }
    const kpProjection: JsonObject = {
      ...roomPlayerProjection(
        actorProjection as unknown as JsonObject,
        submission.character_id,
      ),
      ...(actorViewer !== undefined ? {} : {
        lifecycleTransition: {
          characterId: submission.character_id,
          tenureStatus: resolved.state.entities[submission.character_id]?.tenureStatus ?? "missing",
          successorRequired: true,
        },
      }),
      mechanicalResult: {
        kind: resolved.kind,
        randomness,
        ...(resolved.mechanicalResult === undefined
          ? {}
          : { resolution: structuredClone(resolved.mechanicalResult) }),
      },
    };

    let pending: JsonObject | undefined;
    let pendingBindings: Array<{
      pendingInputId: string;
      controllerCharacterId: string;
      controllerPrincipalId: string;
      pending: JsonObject;
    }> = [];
    let deliveryPlan: DeliveryPlan | undefined;
    const safetyDirect = submission.input_kind === "safetyPause"
      || submission.input_kind === "safetyAdjust";
    const continuation = submission.continuation_json === null
      ? undefined
      : parseJson<JsonObject>(submission.continuation_json);
    const originalInput = isJsonRecord(continuation?.originalInput)
      ? continuation.originalInput
      : undefined;
    const pendingAnswer = isJsonRecord(continuation?.answer)
      ? continuation.answer
      : undefined;
    const actorText = submission.input_kind === "intent"
      && nonEmptyString(originalInput?.text)
      ? originalInput.text
      : submission.input_kind === "answer"
        ? nonEmptyString(continuation?.displayText)
          ? continuation.displayText
          : nonEmptyString(pendingAnswer?.text) ? pendingAnswer.text : undefined
        : undefined;
    const resolvedActorName = resolved.state.entities[submission.character_id]?.name;
    const priorActorName = replay.state.entities[submission.character_id]?.name;
    const actorName = nonEmptyString(resolvedActorName)
      ? resolvedActorName
      : nonEmptyString(priorActorName) ? priorActorName : "你";
    const actorMessage: DeliveryPlan["actorMessage"] = safetyDirect || actorText === undefined
      ? undefined
      : {
          messageId: `action:${receipt.receiptId}:${submission.character_id}`,
          characterId: submission.character_id,
          name: actorName,
          body: actorText,
          sceneIds: uniqueSceneIds([
            replay.state.entities[submission.character_id]?.sceneId,
            resolved.state.entities[submission.character_id]?.sceneId,
          ]),
        };
    if (resolved.kind === "awaitingInput") {
      pendingBindings = authorityPendingBindings(
        resolved.state,
        submission.root_action_id,
      );
      const currentBinding = pendingBindings.find((entry) =>
        entry.pendingInputId === resolved.pending.pendingInputId);
      if (currentBinding === undefined) {
        return rejectedAuthority(
          "invalidRulesResult",
          "Rules returned a pending input without an active trusted controller.",
        );
      }
      pending = {
        ...resolved.pending,
        ...currentBinding.pending,
        controllerCharacterId: currentBinding.controllerCharacterId,
        controllerPrincipalId: currentBinding.controllerPrincipalId,
      };
    } else if (!safetyDirect) {
      const deliveryPriorState = this.authorityStateBeforeEventRange(replay, receiptEvents);
      if (deliveryPriorState === undefined) {
        return rejectedAuthority(
          "projectionFailure",
          "The committed event range has no reconstructable pre-state.",
        );
      }
      deliveryPlan = {
        deliveryProtocol: deliveryProtocolForProfiles(replay.profiles),
        publishCapability: randomId("publish-capability"),
        rootActionId: submission.root_action_id,
        receiptId: receipt.receiptId,
        activeBranchId: receipt.activeBranchId,
        eventRange: receipt.eventRange,
        audiences: this.authorityAudienceBindings(
          replay.profiles,
          resolved.state,
          submission.character_id,
          receipt.receiptId,
          deliveryPriorState,
          receiptEvents,
          actorMessage,
        ),
        ...(actorMessage === undefined ? {} : { actorMessage }),
      };
    }
    const pendingMessages = resolved.kind === "awaitingInput"
      ? pendingBindings.flatMap((binding) => {
          const body = pendingTranscriptBody(binding.pending);
          return body === undefined
            ? []
            : [{
                viewerKey: `${binding.controllerPrincipalId}\u001f${binding.controllerCharacterId}`,
                messageId: `pending:${binding.pendingInputId}:prompt`,
                characterId: binding.controllerCharacterId,
                body,
                sceneIds: uniqueSceneIds([
                  replay.state.entities[binding.controllerCharacterId]?.sceneId,
                  resolved.state.entities[binding.controllerCharacterId]?.sceneId,
                ]),
              }];
        })
      : [];
    const answeredPendingMessage = answeredPendingInputId === undefined
      ? undefined
      : (() => {
          const pendingRow = this.authorityStore.pending(answeredPendingInputId);
          if (pendingRow === undefined) return undefined;
          try {
            const body = pendingTranscriptBody(parseJson<JsonObject>(pendingRow.pending_json));
            return body === undefined
              ? undefined
              : {
                  viewerKey: `${submission.principal_id}\u001f${submission.character_id}`,
                  messageId: `pending:${answeredPendingInputId}:prompt`,
                  characterId: submission.character_id,
                  body,
                  sceneIds: uniqueSceneIds([
                    replay.state.entities[submission.character_id]?.sceneId,
                    resolved.state.entities[submission.character_id]?.sceneId,
                  ]),
                };
          } catch {
            return undefined;
          }
        })();

    const outcome: AuthorityCommitOutcome = resolved.kind === "awaitingInput"
      ? {
          kind: "awaitingInput",
          receipt,
          pending: pending!,
          kpProjection,
        }
      : {
          kind: status === "concluded" ? "concluded" : "committed",
          receipt,
          kpProjection,
          ...(deliveryPlan === undefined ? {} : { deliveryPlan }),
        };
    const transcriptSourceEventSeq = receiptEvents.at(-1)?.eventSeq
      ?? replay.replay.head.eventSeq;

    const persisted = this.authorityStore.transaction(() => {
      if (this.authorityStore.roomDeletion() !== undefined) {
        return {
          outcome: rejectedAuthority("roomDeleting", "The room is sealed for deletion."),
          committedHere: false,
        };
      }
      const current = this.authorityStore.submissionByPrepared(preparedActionId);
      const currentReplay = this.authoritativeReplay();
      const currentAuthenticated = this.authenticatedAuthorityViewer(context, currentReplay.state);
      if (
        current === undefined
        || currentAuthenticated === undefined
        || current.principal_id !== currentAuthenticated.principalId
        || !currentAuthenticated.characterIds.includes(current.character_id)
      ) {
        return {
          outcome: rejectedAuthority(
            "preparedActionUnauthorized",
            "The prepared action's character is no longer controlled by this principal.",
          ),
          committedHere: false,
        };
      }
      if (current?.result_json !== null && current?.result_json !== undefined) {
        if (current.proposal_hash !== proposalHash) {
          return {
            outcome: rejectedAuthority(
              "idempotencyPayloadMismatch",
              "The prepared action was already committed with a different proposal.",
            ),
            committedHere: false,
          };
        }
        return {
          outcome: parseJson<AuthorityCommitOutcome>(current.result_json),
          committedHere: false,
        };
      }
      if (!safetyDirect && hasActiveSafetyPause(currentReplay.state)) {
        return {
          outcome: presentationUnavailable(),
          committedHere: false,
        };
      }
      if (
        current.status !== (usedRandomnessJournal ? "awaitingRandomness" : "prepared")
        || this.authorityStore.scopeVersion(current.scene_scope) !== current.prepared_scope_version
      ) {
        return {
          outcome: rejectedAuthority(
            "scopeConflict",
            "A relevant scene scope changed after this action was prepared.",
          ),
          committedHere: false,
        };
      }
      if (this.authorityStore.hasRandomnessSettlementInScene(
        current.scene_scope,
        preparedActionId,
      )) {
        return {
          outcome: {
            kind: "retryableFailure" as const,
            code: "sceneRandomnessSettlementInProgress",
          },
          committedHere: false,
        };
      }
      this.authorityStore.appendEvents(eventsToAppend);
      this.authorityStore.updateState(resolved.state);
      this.authorityStore.advanceScope(current.scene_scope);
      this.authorityStore.saveReceipt(receipt);
      if (answeredPendingMessage !== undefined) {
        this.authorityStore.appendExperiencedMessage({
          viewerKey: answeredPendingMessage.viewerKey,
          messageId: answeredPendingMessage.messageId,
          sceneIds: answeredPendingMessage.sceneIds,
          kind: "kp",
          speakerCharacterId: null,
          speakerName: "KP",
          body: answeredPendingMessage.body,
          sourceEventSeq: transcriptSourceEventSeq,
          receiptId: receipt.receiptId,
        });
      }
      if (answeredPendingInputId !== undefined) {
        this.authorityStore.closePending(answeredPendingInputId);
      }
      if (resolved.kind === "awaitingInput") {
        for (const binding of pendingBindings) {
          this.authorityStore.savePending({
            pendingInputId: binding.pendingInputId,
            rootActionId: submission.root_action_id,
            controllerCharacterId: binding.controllerCharacterId,
            controllerPrincipalId: binding.controllerPrincipalId,
            pending: binding.pending,
          });
        }
      } else if (deliveryPlan !== undefined) {
        this.authorityStore.saveDeliveryPlan(
          deliveryPlan,
          receiptEvents[receiptEvents.length - 1].eventSeq,
        );
      }
      if (actorMessage !== undefined) {
        const actorViewerKey = `${submission.principal_id}\u001f${actorMessage.characterId}`;
        const currentSlot = this.authorityStore.deliverySlot(actorViewerKey);
        if (currentSlot !== undefined) {
          const currentFrame = parseJson<DeliveryFrame>(currentSlot.frame_json);
          this.authorityStore.appendExperiencedMessage({
            viewerKey: actorViewerKey,
            messageId: currentFrame.deliveryId,
            sceneIds: this.authorityDeliveryFrameSceneIds(
              replay,
              actorMessage.characterId,
              currentSlot,
              currentFrame,
            ),
            kind: "kp",
            speakerCharacterId: null,
            speakerName: "KP",
            body: currentFrame.text,
            sourceEventSeq: currentSlot.source_event_seq,
            receiptId: currentFrame.receiptId,
          });
        }
        this.authorityStore.appendExperiencedMessage({
          viewerKey: actorViewerKey,
          messageId: actorMessage.messageId,
          sceneIds: actorMessage.sceneIds,
          kind: "player",
          speakerCharacterId: actorMessage.characterId,
          speakerName: actorMessage.name,
          body: actorMessage.body,
          sourceEventSeq: transcriptSourceEventSeq,
          receiptId: receipt.receiptId,
        });
      }
      for (const pendingMessage of pendingMessages) {
        this.authorityStore.appendExperiencedMessage({
          viewerKey: pendingMessage.viewerKey,
          messageId: pendingMessage.messageId,
          sceneIds: pendingMessage.sceneIds,
          kind: "kp",
          speakerCharacterId: null,
          speakerName: "KP",
          body: pendingMessage.body,
          sourceEventSeq: transcriptSourceEventSeq,
          receiptId: receipt.receiptId,
        });
      }
      if (submission.input_kind === "safetyPause") {
        this.authorityStore.supersedeCharacterDeliveries(
          Object.keys(resolved.state.characterControls),
        );
      }
      if (usedRandomnessJournal) this.authorityStore.finalizeRandomnessBatch(preparedActionId);
      this.authorityStore.finishSubmission(preparedActionId, status, proposalHash, outcome);
      this.authorityStore.markArchivePending(Date.now());
      return { outcome, committedHere: true };
    });
    if (
      persisted.outcome.kind === "committed"
      || persisted.outcome.kind === "concluded"
      || persisted.outcome.kind === "awaitingInput"
    ) {
      if (persisted.committedHere && usedRandomnessJournal) {
        this.runAuthorityRecoveryCheckpoint("afterOutcomeCommitBeforeResponse");
      }
      await this.resumeAuthoritativeD1Archive();
    }
    return persisted.outcome;
  }

  async exportAuthoritativeArchive(archiveExportCapability: unknown) {
    if (!hasRoomServiceCapability(archiveExportCapability, "archiveExport")) {
      return rejectedAuthority(
        "archiveExportUnauthorized",
        "Only the trusted service archive capability may export this room.",
      );
    }
    if (this.authorityStore.roomDeletion() !== undefined) {
      return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
    }
    if (this.authorityStore.room() === undefined) {
      return rejectedAuthority("roomUninitialized", "The authoritative room is not initialized.");
    }
    try {
      return {
        kind: "exported" as const,
        archive: await this.currentAuthoritativeArchive(),
      };
    } catch (error) {
      if (error instanceof AuthorityArchiveSettlementPendingError) {
        return {
          kind: "retryableFailure" as const,
          code: "archiveSettlementPending",
        };
      }
      return rejectedAuthority(
        "archiveIntegrityMismatch",
        "The current authoritative event stream cannot produce a verified archive.",
      );
    }
  }

  async restoreAuthoritativeArchive(
    disasterRecoveryCapability: unknown,
    archiveValue: unknown,
  ) {
    if (!hasRoomServiceCapability(disasterRecoveryCapability, "disasterRecovery")) {
      return rejectedAuthority(
        "recoveryUnauthorized",
        "Only the trusted service disaster-recovery capability may restore a room.",
      );
    }
    if (this.authorityStore.roomDeletion() !== undefined) {
      return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
    }
    if (!this.authorityStore.isAuthorityEmpty()) {
      return rejectedAuthority(
        "recoveryTargetNotEmpty",
        "Disaster recovery is allowed only for an empty authoritative Room Durable Object.",
      );
    }
    const validation = await validateAuthoritativeArchive(archiveValue);
    if (!validation.ok) {
      return rejectedAuthority(validation.code, "The supplied archive failed closed validation.");
    }
    const { archive, profiles, replay: replayed } = validation.value;
    const state = validation.value.state as AuthoritativeWorldState;
    const recoveredReplay: AuthorityReplay = {
      profiles,
      genesis: archive.signedGenesis,
      state,
      replay: replayed,
    };
    const recoveredAudits = await this.authorityProjectionAudits(recoveredReplay);
    const canonicalAudits = (audits: ArchiveProjectionAudit[]) => structuredClone(audits)
      .sort((left, right) => {
        const sequenceOrder = BigInt(left.eventSeq) < BigInt(right.eventSeq)
          ? -1
          : BigInt(left.eventSeq) > BigInt(right.eventSeq) ? 1 : 0;
        return sequenceOrder
          || left.viewerHash.localeCompare(right.viewerHash)
          || left.projectionHash.localeCompare(right.projectionHash);
      });
    if (
      await authorityHash(canonicalAudits(recoveredAudits))
      !== await authorityHash(canonicalAudits(archive.projectionAudits))
    ) {
      return rejectedAuthority(
        "archiveIntegrityMismatch",
        "Projection audit commitments do not match the reconstructed state.",
      );
    }

    const members: AuthoritativeMemberSeed[] = [];
    for (const member of Object.values(state.multiplayerRuntime.members)
      .filter((candidate) => candidate.status === "active")
      .sort((left, right) => left.principalId.localeCompare(right.principalId))) {
      const principal = state.principals[member.principalId];
      const activeSeat = Object.values(state.seats).find((seat) =>
        seat.principalId === member.principalId && seat.status === "active");
      if (principal === undefined || activeSeat === undefined) {
        return rejectedAuthority(
          "archiveIntegrityMismatch",
          "An active restored member has no trusted principal and Seat.",
        );
      }
      members.push({ principalId: member.principalId, role: member.role });
    }
    const characters: AuthoritativeCharacterSeed[] = [];
    for (const control of Object.values(state.characterControls)
      .sort((left, right) => left.characterId.localeCompare(right.characterId))) {
      const entity = state.entities[control.characterId];
      const seat = state.seats[control.seatId];
      const member = seat === undefined
        ? undefined
        : state.multiplayerRuntime.members[seat.principalId];
      if (
        entity?.kind !== "player"
        || entity.tenureStatus !== "active"
        || seat?.status !== "active"
        || member?.status !== "active"
        || state.principals[seat.principalId] === undefined
      ) {
        return rejectedAuthority(
          "archiveIntegrityMismatch",
          "A restored controlled character has no trusted active member and Seat.",
        );
      }
      characters.push({
        characterId: control.characterId,
        controllerPrincipalId: seat.principalId,
        staticCard: {
          name: entity.name,
          sceneId: entity.sceneId,
          ...(entity.abilityScores === undefined ? {} : { abilityScores: entity.abilityScores }),
          ...(entity.resources === undefined ? {} : { resources: entity.resources }),
          ...(entity.proficiencyBonus === undefined
            ? {}
            : { proficiencyBonus: entity.proficiencyBonus }),
          ...(entity.proficientSkills === undefined
            ? {}
            : { proficientSkills: [...entity.proficientSkills] }),
          ...(entity.expertiseSkills === undefined
            ? {}
            : { expertiseSkills: [...entity.expertiseSkills] }),
          ...(entity.proficientSaves === undefined
            ? {}
            : { proficientSaves: [...entity.proficientSaves] }),
        },
      });
    }
    const restoredProfileId = archive.signedGenesis.moduleRef.profileId;
    const restoredVersionSeparator = restoredProfileId.lastIndexOf(":");
    const restoredModuleId = restoredProfileId.startsWith("module:")
      && restoredVersionSeparator > "module:".length
      ? restoredProfileId.slice("module:".length, restoredVersionSeparator)
      : restoredProfileId;

    const restored = (() => {
      try {
        return this.authorityStore.transaction(() => {
          if (!this.authorityStore.isAuthorityEmpty()) {
            return rejectedAuthority(
              "recoveryTargetNotEmpty",
              "Disaster recovery is allowed only for an empty authoritative Room Durable Object.",
            );
          }
          this.authorityStore.createRoom({
            roomId: archive.roomId,
            moduleId: restoredModuleId,
            profiles,
            genesis: archive.signedGenesis,
            state,
            members,
            characters,
          });
          this.authorityStore.syncAuthorityIndex(state);
          this.authorityStore.appendEvents(archive.events);
          for (const reference of archive.receiptRefs) {
            this.authorityStore.saveReceiptReference(
              reference.receiptId,
              reference.rootActionId,
              reference,
            );
            for (const [scopeId, rawVersion] of Object.entries(reference.scopeVersions)) {
              const version = Number(rawVersion);
              if (Number.isSafeInteger(version) && version >= 0) {
                this.authorityStore.setScopeVersion(scopeId, version);
              }
            }
          }
          for (const binding of authorityPendingBindings(state)) {
            this.authorityStore.savePending(binding);
          }
          return {
            kind: "restored" as const,
            roomId: archive.roomId,
            deliverySlotsRestored: 0,
            projectionIntegrity: "verified" as const,
          };
        });
      } catch {
        return rejectedAuthority(
          "archiveIntegrityMismatch",
          "Archive restoration rolled back before any authoritative row was exposed.",
        );
      }
    })();
    if (restored.kind === "restored") await this.scheduleAuthoritativeD1Archive();
    return restored;
  }

  async restoreAuthoritativeArchiveFromD1(
    disasterRecoveryCapability: unknown,
    locator: unknown,
  ) {
    if (!hasRoomServiceCapability(disasterRecoveryCapability, "disasterRecovery")) {
      return rejectedAuthority(
        "recoveryUnauthorized",
        "Only the trusted service disaster-recovery capability may restore a room.",
      );
    }
    const db = this.authorityArchiveDatabase();
    if (db === undefined) {
      return rejectedAuthority(
        "archiveIntegrityMismatch",
        "The authoritative D1 archive is unavailable.",
      );
    }
    try {
      const archive = await readAuthoritativeArchiveFromD1(db, locator);
      return await this.restoreAuthoritativeArchive(disasterRecoveryCapability, archive);
    } catch (error) {
      if (error instanceof AuthoritativeArchiveD1ReadError) {
        return rejectedAuthority("archiveIntegrityMismatch", error.message);
      }
      return rejectedAuthority(
        "archiveIntegrityMismatch",
        "The authoritative D1 archive could not be assembled.",
      );
    }
  }

  beginViewerNarrationRecovery(
    context: TrustedPrincipalContext,
    capability: unknown,
  ) {
    if (!nonEmptyString(capability)) return narrationRecoveryUnavailable();
    const replay = this.authoritativeReplay();
    const authenticated = this.authenticatedAuthorityViewer(context, replay.state);
    const recovery = authenticated === undefined
      ? undefined
      : this.authenticatedViewerNarrationRecoveryRecord(replay, authenticated, capability);
    if (recovery === undefined) return narrationRecoveryUnavailable();
    if (recovery.audience.status === "published" || recovery.audience.status === "superseded") {
      return {
        kind: recovery.audience.status,
        receipt: structuredClone(recovery.receipt),
      };
    }
    if (recovery.stale) {
      this.authorityStore.finishDeliveryAudience({
        publishCapability: recovery.plan.publishCapability,
        audienceId: recovery.binding.audienceId,
        attemptHash: `superseded:${recovery.binding.audienceId}`,
        state: "superseded",
        result: { kind: "superseded" },
      });
      return { kind: "superseded" as const, receipt: structuredClone(recovery.receipt) };
    }
    const deliveryGeneration = this.authorityStore.beginDeliveryAudienceAttempt(
      recovery.plan.publishCapability,
      recovery.binding.audienceId,
    );
    if (deliveryGeneration === undefined) return narrationRecoveryUnavailable();
    return {
      kind: "pending" as const,
      rootActionId: recovery.plan.rootActionId,
      receipt: structuredClone(recovery.receipt),
      projection: structuredClone(recovery.binding.kpProjection),
      deliveryGeneration,
      deliveryProtocol: INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE,
    };
  }

  async publishViewerNarrationRecovery(
    context: TrustedPrincipalContext,
    capability: unknown,
    publication: unknown,
  ) {
    if (
      !nonEmptyString(capability)
      || !isJsonRecord(publication)
      || !hasExactJsonKeys(publication, ["body", "deliveryGeneration"])
      || !nonEmptyString(publication.body)
      || !Number.isSafeInteger(publication.deliveryGeneration)
      || Number(publication.deliveryGeneration) < 1
    ) return narrationRecoveryUnavailable();
    const replay = this.authoritativeReplay();
    const authenticated = this.authenticatedAuthorityViewer(context, replay.state);
    const recovery = authenticated === undefined
      ? undefined
      : this.authenticatedViewerNarrationRecoveryRecord(replay, authenticated, capability);
    if (
      recovery === undefined
      || recovery.stale
      || recovery.audience.delivery_generation !== Number(publication.deliveryGeneration)
    ) return narrationRecoveryUnavailable();
    if (recovery.audience.status === "published" || recovery.audience.status === "superseded") {
      return { kind: recovery.audience.status, receipt: structuredClone(recovery.receipt) };
    }
    const published = await this.publishDelivery(
      { publishCapability: recovery.plan.publishCapability },
      {
        frames: [{
          audienceId: recovery.binding.audienceId,
          deliveryGeneration: Number(publication.deliveryGeneration),
          narration: { body: publication.body },
        }],
      },
    );
    if (!isJsonRecord(published)) return narrationRecoveryUnavailable();
    return published.kind === "published" || published.kind === "superseded"
      ? { kind: published.kind, receipt: structuredClone(recovery.receipt) }
      : published;
  }

  failViewerNarrationRecovery(
    context: TrustedPrincipalContext,
    capability: unknown,
    failure: unknown,
  ) {
    if (
      !nonEmptyString(capability)
      || !isJsonRecord(failure)
      || !hasExactJsonKeys(failure, ["deliveryGeneration", "errorCode", "state"])
      || !Number.isSafeInteger(failure.deliveryGeneration)
      || Number(failure.deliveryGeneration) < 1
      || !nonEmptyString(failure.errorCode)
      || (failure.state !== "rejected" && failure.state !== "retryableFailure")
    ) return narrationRecoveryUnavailable();
    const replay = this.authoritativeReplay();
    const authenticated = this.authenticatedAuthorityViewer(context, replay.state);
    const recovery = authenticated === undefined
      ? undefined
      : this.authenticatedViewerNarrationRecoveryRecord(replay, authenticated, capability);
    if (
      recovery === undefined
      || recovery.stale
      || recovery.audience.delivery_generation !== Number(failure.deliveryGeneration)
    ) return narrationRecoveryUnavailable();
    if (recovery.audience.status === "published" || recovery.audience.status === "superseded") {
      return { kind: recovery.audience.status, receipt: structuredClone(recovery.receipt) };
    }
    this.authorityStore.failDeliveryAudience({
      publishCapability: recovery.plan.publishCapability,
      audienceId: recovery.binding.audienceId,
      state: failure.state,
      errorCode: failure.errorCode,
    });
    return {
      kind: failure.state,
      receipt: structuredClone(recovery.receipt),
      errorCode: failure.errorCode,
    };
  }

  deliveryPublicationStatus(query: unknown) {
    if (
      !isJsonRecord(query)
      || !hasExactJsonKeys(query, ["publishCapability"])
      || !nonEmptyString(query.publishCapability)
    ) {
      return rejectedAuthority(
        "invalidPublicationStatus",
        "A closed publish capability query is required.",
      );
    }
    const publishCapability = query.publishCapability;
    const status = () => {
      const row = this.authorityStore.deliveryPlan(publishCapability);
      if (row === undefined) {
        return this.authorityStore.deliveryPlanTombstone(publishCapability) === undefined
          ? rejectedAuthority(
              "publishCapabilityInvalid",
              "The publish capability is unavailable.",
            )
          : { kind: "superseded" as const };
      }
      if (row.status === "published" || row.status === "superseded") {
        return { kind: row.status, audiences: [] };
      }
      if (row.status !== "open") {
        return rejectedAuthority(
          "deliveryPublicationIntegrityMismatch",
          "The delivery publication stage is unavailable.",
        );
      }
      const plan = parseJson<DeliveryPlan>(row.plan_json);
      const deliveryProtocol = deliveryProtocolForPlan(plan);
      if (deliveryProtocol === undefined) {
        return rejectedAuthority(
          "deliveryPublicationIntegrityMismatch",
          "The delivery plan names an unregistered publication protocol.",
        );
      }
      if (deliveryProtocol.profileId === DELIVERY_PROTOCOL_PROFILE.profileId) {
        const stale = plan.audiences.some((binding) => {
          const viewerKey = `${binding.principalId}\u001f${binding.characterId}`;
          const watermark = this.authorityStore.deliveryWatermark(viewerKey);
          return watermark !== undefined && compareEventSeq(watermark, row.source_event_seq) > 0;
        });
        return stale ? { kind: "staleLegacyOpen" as const } : { kind: "open" as const };
      }
      let audiences;
      try {
        audiences = this.authorityStore.ensureDeliveryAudiences(plan);
      } catch {
        return rejectedAuthority(
          "deliveryPublicationIntegrityMismatch",
          "The delivery audience journal is unavailable.",
        );
      }
      const staleAudienceIds = plan.audiences.flatMap((binding) => {
        const viewerKey = `${binding.principalId}\u001f${binding.characterId}`;
        const watermark = this.authorityStore.deliveryWatermark(viewerKey);
        return watermark !== undefined && compareEventSeq(watermark, row.source_event_seq) > 0
          ? [binding.audienceId]
          : [];
      });
      if (staleAudienceIds.length > 0) {
        return { kind: "staleOpen" as const, staleAudienceIds };
      }
      const publicationStates = audiences.map((audience) => ({
        audienceId: audience.audience_id,
        viewerKey: audience.viewer_key,
        projectionHash: audience.projection_hash,
        deliveryGeneration: audience.delivery_generation,
        state: audience.status,
        ...(audience.error_code === null ? {} : { errorCode: audience.error_code }),
      }));
      const terminal = audiences.every((audience) =>
        audience.status === "published" || audience.status === "superseded");
      const allSuperseded = audiences.length > 0
        && audiences.every((audience) => audience.status === "superseded");
      return {
        kind: terminal ? allSuperseded ? "superseded" as const : "published" as const : "open" as const,
        audiences: publicationStates,
      };
    };

    const observed = status();
    if (observed.kind !== "staleOpen" && observed.kind !== "staleLegacyOpen") return observed;
    return this.authorityStore.transaction(() => {
      const raced = status();
      if (raced.kind === "staleLegacyOpen") {
        this.authorityStore.supersedeOpenDeliveryPlan(publishCapability);
        return { kind: "superseded" as const };
      }
      if (raced.kind !== "staleOpen") return raced;
      for (const audienceId of raced.staleAudienceIds ?? []) {
        this.authorityStore.finishDeliveryAudience({
          publishCapability,
          audienceId,
          attemptHash: `superseded:${audienceId}`,
          state: "superseded",
          result: { kind: "superseded", audienceId },
        });
      }
      return status();
    });
  }

  beginDeliveryAudiencePublication(query: unknown) {
    if (
      !isJsonRecord(query)
      || !hasExactJsonKeys(query, ["audienceId", "publishCapability"])
      || !nonEmptyString(query.publishCapability)
      || !nonEmptyString(query.audienceId)
    ) {
      return rejectedAuthority(
        "invalidPublicationStatus",
        "A publish capability and audience id are required.",
      );
    }
    const row = this.authorityStore.deliveryPlan(query.publishCapability);
    if (row === undefined || row.status !== "open") {
      return rejectedAuthority(
        "publishCapabilityInvalid",
        "The publish capability is unavailable.",
      );
    }
    const plan = parseJson<DeliveryPlan>(row.plan_json);
    const deliveryProtocol = deliveryProtocolForPlan(plan);
    if (deliveryProtocol === undefined
      || deliveryProtocol.profileId !== INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE.profileId) {
      return rejectedAuthority(
        "deliveryProtocolMismatch",
        "This delivery plan does not use independent audience publication.",
      );
    }
    const binding = plan.audiences.find((entry) => entry.audienceId === query.audienceId);
    if (binding === undefined) {
      return rejectedAuthority("audienceMismatch", "The audience is outside the frozen snapshot.");
    }
    return this.authorityStore.transaction(() => {
      this.authorityStore.ensureDeliveryAudiences(plan);
      const current = this.authorityStore.deliveryAudience(
        query.publishCapability as string,
        query.audienceId as string,
      );
      if (current?.status === "published" || current?.status === "superseded") {
        return {
          kind: current.status,
          audienceId: current.audience_id,
          deliveryGeneration: current.delivery_generation,
        };
      }
      const deliveryGeneration = this.authorityStore.beginDeliveryAudienceAttempt(
        query.publishCapability as string,
        query.audienceId as string,
      );
      if (deliveryGeneration === undefined) {
        return rejectedAuthority(
          "deliveryPublicationIntegrityMismatch",
          "The audience publication journal is unavailable.",
        );
      }
      return {
        kind: "pending" as const,
        audienceId: binding.audienceId,
        projectionHash: binding.projectionHash,
        deliveryGeneration,
      };
    });
  }

  failDeliveryAudiencePublication(capability: unknown, failure: unknown) {
    if (
      !isJsonRecord(capability)
      || !nonEmptyString(capability.publishCapability)
      || !isJsonRecord(failure)
      || !hasExactJsonKeys(
        failure,
        ["audienceId", "deliveryGeneration", "errorCode", "state"],
      )
      || !nonEmptyString(failure.audienceId)
      || !Number.isSafeInteger(failure.deliveryGeneration)
      || Number(failure.deliveryGeneration) < 1
      || !nonEmptyString(failure.errorCode)
      || (failure.state !== "rejected" && failure.state !== "retryableFailure")
    ) {
      return rejectedAuthority("invalidPublication", "A closed audience failure is required.");
    }
    const planRow = this.authorityStore.deliveryPlan(capability.publishCapability);
    const plan = planRow === undefined ? undefined : parseJson<DeliveryPlan>(planRow.plan_json);
    if (plan === undefined
      || deliveryProtocolForPlan(plan)?.profileId
        !== INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE.profileId) {
      return rejectedAuthority(
        "deliveryProtocolMismatch",
        "This delivery plan does not use independent audience publication.",
      );
    }
    const row = this.authorityStore.deliveryAudience(
      capability.publishCapability,
      failure.audienceId,
    );
    if (row === undefined || row.delivery_generation !== failure.deliveryGeneration) {
      return rejectedAuthority(
        "deliveryGenerationMismatch",
        "The audience publication generation changed.",
      );
    }
    if (row.status === "published" || row.status === "superseded") {
      return { kind: row.status, audienceId: row.audience_id };
    }
    this.authorityStore.failDeliveryAudience({
      publishCapability: capability.publishCapability,
      audienceId: failure.audienceId,
      state: failure.state,
      errorCode: failure.errorCode,
    });
    return {
      kind: failure.state,
      audienceId: failure.audienceId,
      deliveryGeneration: failure.deliveryGeneration,
      errorCode: failure.errorCode,
    };
  }

  private async publishLegacyDelivery(
    row: AuthorityDeliveryPlanRow,
    plan: DeliveryPlan,
    publishCapability: string,
    publication: JsonObject,
  ) {
    const frames = publication.frames;
    if (!Array.isArray(frames)) {
      return rejectedAuthority("invalidPublication", "Publication frames must be an array.");
    }
    const expectedAudienceIds = plan.audiences.map((entry) => entry.audienceId).sort();
    const actualAudienceIds = frames
      .map((entry) => isJsonRecord(entry) ? entry.audienceId : undefined)
      .filter(nonEmptyString)
      .sort();
    if (
      actualAudienceIds.length !== frames.length
      || actualAudienceIds.length !== new Set(actualAudienceIds).size
      || actualAudienceIds.length !== expectedAudienceIds.length
      || actualAudienceIds.some((entry, index) => entry !== expectedAudienceIds[index])
    ) {
      return rejectedAuthority(
        "audienceMismatch",
        "Publication must match the audience snapshot frozen at commit.",
      );
    }
    let publicationHash: string;
    try {
      publicationHash = await authorityHash(publication);
    } catch {
      return rejectedAuthority("invalidPublication", "Publication frames must be canonical JSON.");
    }
    if (row.publication_hash !== null) {
      if (row.publication_hash !== publicationHash) {
        return rejectedAuthority(
          "idempotencyPayloadMismatch",
          "The publish capability was already used with a different publication.",
        );
      }
      return row.publication_result_json === null
        ? { kind: row.status }
        : parseJson(row.publication_result_json);
    }

    const preparedFrames: Array<{
      binding: DeliveryAudienceBinding;
      viewer: PlayerViewer;
      frame: DeliveryFrame;
    }> = [];
    for (const frameValue of frames) {
      if (
        !isJsonRecord(frameValue)
        || !nonEmptyString(frameValue.audienceId)
        || !isJsonRecord(frameValue.narration)
        || !nonEmptyString(frameValue.narration.text)
      ) {
        return rejectedAuthority("invalidPublication", "Each frozen audience requires one text frame.");
      }
      const binding = plan.audiences.find((entry) => entry.audienceId === frameValue.audienceId);
      if (binding === undefined) {
        return rejectedAuthority("audienceMismatch", "A frame addressed an audience outside the snapshot.");
      }
      if (Object.keys(frameValue.narration).some((key) =>
        key !== "text" && key !== "agencyClaims")) {
        return rejectedAuthority(
          "invalidPublication",
          "Narration frames must use the closed publication contract.",
        );
      }
      try {
        validateNarrationAgencyClaims(frameValue.narration, binding.kpProjection);
      } catch {
        return rejectedAuthority(
          "invalidPublication",
          "Narration agency claims are unavailable or violate the frozen audience projection.",
        );
      }
      const viewer: PlayerViewer = {
        kind: "player",
        principalId: binding.principalId,
        sessionVersion: binding.sessionVersion,
        seatId: binding.seatId,
        characterId: binding.characterId,
      };
      const text = frameValue.narration.text;
      const payloadHash = await authorityHash({ text });
      const sceneIds = binding.sceneIds?.length
        ? [...binding.sceneIds]
        : projectionTranscriptSceneIds(binding.kpProjection);
      preparedFrames.push({
        binding,
        viewer,
        frame: {
          deliveryId: `delivery:${plan.receiptId}:${binding.characterId}`,
          receiptId: plan.receiptId,
          activeBranchId: plan.activeBranchId,
          projectionHash: binding.projectionHash,
          presentationPolicyVersion: PRESENTATION_POLICY_VERSION,
          narrationPolicyVersion: NARRATION_POLICY_VERSION,
          payloadHash,
          text,
          sceneIds,
        },
      });
    }
    const publicationReplay = this.authoritativeReplay();

    return this.authorityStore.transaction(() => {
      if (this.authorityStore.roomDeletion() !== undefined) {
        return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
      }
      const currentPlan = this.authorityStore.deliveryPlan(publishCapability);
      if (currentPlan === undefined) {
        return rejectedAuthority("publishCapabilityInvalid", "The publish capability is unavailable.");
      }
      if (currentPlan.publication_hash !== null) {
        if (currentPlan.publication_hash !== publicationHash) {
          return rejectedAuthority(
            "idempotencyPayloadMismatch",
            "The publish capability was already used with a different publication.",
          );
        }
        return currentPlan.publication_result_json === null
          ? { kind: currentPlan.status }
          : parseJson(currentPlan.publication_result_json);
      }
      const newerSlotExists = preparedFrames.some(({ viewer }) => {
        const viewerKey = `${viewer.principalId}\u001f${viewer.characterId}`;
        const watermark = this.authorityStore.deliveryWatermark(viewerKey);
        return watermark !== undefined && compareEventSeq(watermark, row.source_event_seq) > 0;
      });
      if (newerSlotExists) {
        const result = { kind: "superseded" as const, receiptId: plan.receiptId };
        this.authorityStore.finishDeliveryPlan(
          publishCapability,
          publicationHash,
          "superseded",
          result,
        );
        return result;
      }
      for (const { viewer, frame } of preparedFrames) {
        const viewerKey = `${viewer.principalId}\u001f${viewer.characterId}`;
        const oldSlot = this.authorityStore.deliverySlot(viewerKey);
        if (oldSlot !== undefined) {
          const oldFrame = parseJson<DeliveryFrame>(oldSlot.frame_json);
          this.authorityStore.appendExperiencedMessage({
            viewerKey,
            messageId: oldFrame.deliveryId,
            sceneIds: this.authorityDeliveryFrameSceneIds(
              publicationReplay,
              viewer.characterId,
              oldSlot,
              oldFrame,
            ),
            kind: "kp",
            speakerCharacterId: null,
            speakerName: "KP",
            body: oldFrame.text,
            sourceEventSeq: oldSlot.source_event_seq,
            receiptId: oldFrame.receiptId,
          });
          this.authorityStore.tombstoneDelivery(
            oldSlot,
            oldFrame.receiptId,
            oldFrame.payloadHash,
            "superseded",
          );
        }
        this.authorityStore.replaceDeliverySlot({
          viewerKey,
          principalId: viewer.principalId,
          characterId: viewer.characterId,
          sourceEventSeq: row.source_event_seq,
          frame,
        });
        this.authorityStore.advanceDeliveryWatermark(viewerKey, row.source_event_seq);
      }
      const result = {
        kind: "published" as const,
        receiptId: plan.receiptId,
        deliveryIds: preparedFrames.map(({ frame }) => frame.deliveryId),
      };
      this.authorityStore.finishDeliveryPlan(
        publishCapability,
        publicationHash,
        "published",
        result,
      );
      return result;
    });
  }

  async publishDelivery(capability: unknown, publication: unknown) {
    if (this.authorityStore.roomDeletion() !== undefined) {
      return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
    }
    if (
      !isJsonRecord(capability)
      || !nonEmptyString(capability.publishCapability)
      || !isJsonRecord(publication)
      || !Array.isArray(publication.frames)
    ) {
      return rejectedAuthority("invalidPublication", "A publish capability and frames are required.");
    }
    const row = this.authorityStore.deliveryPlan(capability.publishCapability);
    if (row === undefined) {
      return rejectedAuthority("publishCapabilityInvalid", "The publish capability is unavailable.");
    }
    const plan = parseJson<DeliveryPlan>(row.plan_json);
    const publishCapability = capability.publishCapability;
    const deliveryProtocol = deliveryProtocolForPlan(plan);
    if (deliveryProtocol === undefined) {
      return rejectedAuthority(
        "deliveryProtocolMismatch",
        "The delivery plan names an unregistered publication protocol.",
      );
    }
    if (deliveryProtocol.profileId === DELIVERY_PROTOCOL_PROFILE.profileId) {
      return this.publishLegacyDelivery(row, plan, publishCapability, publication);
    }
    const frames = publication.frames;
    if (frames.length === 0) {
      return rejectedAuthority("invalidPublication", "At least one audience frame is required.");
    }
    const actualAudienceIds = frames
      .map((entry) => isJsonRecord(entry) ? entry.audienceId : undefined)
      .filter(nonEmptyString)
      .sort();
    if (
      actualAudienceIds.length !== frames.length
      || actualAudienceIds.length !== new Set(actualAudienceIds).size
      || actualAudienceIds.some((entry) =>
        !plan.audiences.some((audience) => audience.audienceId === entry))
    ) {
      return rejectedAuthority(
        "audienceMismatch",
        "Publication must be a subset of the audience snapshot frozen at commit.",
      );
    }
    try {
      this.authorityStore.ensureDeliveryAudiences(plan);
    } catch {
      return rejectedAuthority(
        "deliveryPublicationIntegrityMismatch",
        "The delivery audience journal is unavailable.",
      );
    }

    const preparedFrames: Array<{
      binding: DeliveryAudienceBinding;
      viewer: PlayerViewer;
      frame: DeliveryFrame;
      audienceId: string;
      attemptHash: string;
    }> = [];
    for (const frameValue of frames) {
      if (
        !isJsonRecord(frameValue)
        || !nonEmptyString(frameValue.audienceId)
        || !isJsonRecord(frameValue.narration)
        || !hasExactJsonKeys(frameValue.narration, ["body"])
        || !nonEmptyString(frameValue.narration.body)
      ) {
        return rejectedAuthority(
          "invalidPublication",
          "Each audience frame accepts only one non-empty narration body.",
        );
      }
      const binding = plan.audiences.find((entry) => entry.audienceId === frameValue.audienceId);
      if (binding === undefined) {
        return rejectedAuthority("audienceMismatch", "A frame addressed an audience outside the snapshot.");
      }
      const journal = this.authorityStore.deliveryAudience(
        publishCapability,
        binding.audienceId,
      );
      if (journal === undefined) {
        return rejectedAuthority(
          "deliveryPublicationIntegrityMismatch",
          "The audience publication journal is unavailable.",
        );
      }
      let deliveryGeneration = Number.isSafeInteger(frameValue.deliveryGeneration)
        ? Number(frameValue.deliveryGeneration)
        : journal.delivery_generation;
      if (deliveryGeneration < 1) {
        deliveryGeneration = this.authorityStore.beginDeliveryAudienceAttempt(
          publishCapability,
          binding.audienceId,
        ) ?? 0;
      }
      if (deliveryGeneration < 1 || deliveryGeneration !== this.authorityStore.deliveryAudience(
        publishCapability,
        binding.audienceId,
      )?.delivery_generation) {
        return rejectedAuthority(
          "deliveryGenerationMismatch",
          "The audience publication generation changed.",
        );
      }
      const viewer: PlayerViewer = {
        kind: "player",
        principalId: binding.principalId,
        sessionVersion: binding.sessionVersion,
        seatId: binding.seatId,
        characterId: binding.characterId,
      };
      const body = frameValue.narration.body;
      const attemptHash = await authorityHash({
        audienceId: binding.audienceId,
        body,
        deliveryGeneration,
        projectionHash: binding.projectionHash,
      });
      const latestJournal = this.authorityStore.deliveryAudience(
        publishCapability,
        binding.audienceId,
      );
      if (latestJournal?.status === "published" || latestJournal?.status === "superseded") {
        if (latestJournal.attempt_hash !== attemptHash) {
          return rejectedAuthority(
            "idempotencyPayloadMismatch",
            "The audience generation was already finalized with a different body.",
          );
        }
        continue;
      }
      const payloadHash = await authorityHash({ text: body });
      const sceneIds = binding.sceneIds?.length
        ? [...binding.sceneIds]
        : projectionTranscriptSceneIds(binding.kpProjection);
      const derived = narrationPublicationMetadata(binding.kpProjection);
      preparedFrames.push({
        binding,
        viewer,
        audienceId: binding.audienceId,
        attemptHash,
        frame: {
          deliveryId: `delivery:${plan.receiptId}:${binding.characterId}`,
          receiptId: plan.receiptId,
          activeBranchId: plan.activeBranchId,
          projectionHash: binding.projectionHash,
          presentationPolicyVersion: PRESENTATION_POLICY_VERSION,
          narrationPolicyVersion: BODY_ONLY_NARRATION_POLICY_VERSION,
          payloadHash,
          text: body,
          sceneIds,
          ...derived,
          deliveryGeneration,
        },
      });
    }
    if (preparedFrames.length === 0) {
      return {
        kind: "published" as const,
        receiptId: plan.receiptId,
        deliveryIds: [],
      };
    }
    const publicationReplay = this.authoritativeReplay();

    return this.authorityStore.transaction(() => {
      if (this.authorityStore.roomDeletion() !== undefined) {
        return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
      }
      const currentPlan = this.authorityStore.deliveryPlan(publishCapability);
      if (currentPlan === undefined) {
        return rejectedAuthority("publishCapabilityInvalid", "The publish capability is unavailable.");
      }
      const publishedFrames: DeliveryFrame[] = [];
      for (const { audienceId, attemptHash, viewer, frame } of preparedFrames) {
        const journal = this.authorityStore.deliveryAudience(publishCapability, audienceId);
        if (
          journal === undefined
          || journal.delivery_generation !== frame.deliveryGeneration
        ) {
          return rejectedAuthority(
            "deliveryGenerationMismatch",
            "The audience publication generation changed before commit.",
          );
        }
        if (journal.status === "published" || journal.status === "superseded") {
          if (journal.attempt_hash !== attemptHash) {
            return rejectedAuthority(
              "idempotencyPayloadMismatch",
              "The audience generation was already finalized with a different body.",
            );
          }
          continue;
        }
        const viewerKey = `${viewer.principalId}\u001f${viewer.characterId}`;
        const watermark = this.authorityStore.deliveryWatermark(viewerKey);
        if (watermark !== undefined && compareEventSeq(watermark, row.source_event_seq) > 0) {
          this.authorityStore.finishDeliveryAudience({
            publishCapability,
            audienceId,
            attemptHash,
            state: "superseded",
            result: { kind: "superseded", audienceId, receiptId: plan.receiptId },
          });
          continue;
        }
        const oldSlot = this.authorityStore.deliverySlot(viewerKey);
        if (oldSlot !== undefined) {
          const oldFrame = parseJson<DeliveryFrame>(oldSlot.frame_json);
          this.authorityStore.appendExperiencedMessage({
            viewerKey,
            messageId: oldFrame.deliveryId,
            sceneIds: this.authorityDeliveryFrameSceneIds(
              publicationReplay,
              viewer.characterId,
              oldSlot,
              oldFrame,
            ),
            kind: "kp",
            speakerCharacterId: null,
            speakerName: "KP",
            body: oldFrame.text,
            sourceEventSeq: oldSlot.source_event_seq,
            receiptId: oldFrame.receiptId,
          });
          this.authorityStore.tombstoneDelivery(
            oldSlot,
            oldFrame.receiptId,
            oldFrame.payloadHash,
            "superseded",
          );
        }
        this.authorityStore.replaceDeliverySlot({
          viewerKey,
          principalId: viewer.principalId,
          characterId: viewer.characterId,
          sourceEventSeq: row.source_event_seq,
          frame,
        });
        this.authorityStore.advanceDeliveryWatermark(viewerKey, row.source_event_seq);
        this.authorityStore.finishDeliveryAudience({
          publishCapability,
          audienceId,
          attemptHash,
          state: "published",
          result: {
            kind: "published",
            audienceId,
            deliveryId: frame.deliveryId,
            deliveryGeneration: frame.deliveryGeneration,
          },
        });
        publishedFrames.push(frame);
      }
      const result = {
        kind: "published" as const,
        receiptId: plan.receiptId,
        deliveryIds: publishedFrames.map((frame) => frame.deliveryId),
        audiences: this.authorityStore.deliveryAudiences(publishCapability).map((audience) => ({
          audienceId: audience.audience_id,
          deliveryGeneration: audience.delivery_generation,
          state: audience.status,
        })),
      };
      return result;
    });
  }

  observe(
    context: TrustedPrincipalContext,
    query?: ProjectionQuery,
  ): AuthoritativeRoomObservation | AuthorityCommitOutcome {
    if (this.authorityStore.room() === undefined) {
      return rejectedAuthority("roomUninitialized", "The authoritative room is not initialized.");
    }
    let replay: AuthorityReplay;
    try {
      replay = this.authoritativeReplay();
    } catch (error) {
      if (incrementalProjectionRequested(query)) {
        return { kind: "retryableFailure", code: "projectionIntegrity" };
      }
      throw error;
    }
    const authenticated = this.authenticatedAuthorityViewer(context, replay.state);
    if (authenticated !== undefined && authenticated.characterIds.length === 0) {
      const formerCharacters = this.formerCharactersForViewer(authenticated, replay.state);
      if (formerCharacters.length > 0) {
        const latest = formerCharacters[0];
        const viewer = this.formerAuthorityPlayerViewer(
          authenticated,
          replay.state,
          latest.id,
        );
        if (viewer === undefined) {
          return rejectedAuthority("viewerUnauthorized", "The former viewer projection is unavailable.");
        }
        const projectionQuery = this.authorityIncrementalProjectionQuery(replay, query);
        if (projectionQuery === "invalid") {
          return { kind: "retryableFailure", code: "projectionIntegrity" };
        }
        const readModel = projectAuthoritative(
          replay.profiles,
          replay.state,
          viewer,
          projectionQuery,
        );
        if (readModel.kind === "rejected") {
          if (
            incrementalProjectionRequested(query)
            && readModel.rejection.code === "projectionIntegrity"
          ) return { kind: "retryableFailure", code: "projectionIntegrity" };
          return rejectedAuthority(readModel.rejection.code, readModel.rejection.message);
        }
        const viewerKey = `${viewer.principalId}\u001f${viewer.characterId}`;
        const slot = this.authorityStore.deliverySlot(viewerKey);
        const narrationRecovery = this.viewerNarrationRecovery(replay, viewer);
        return {
          readModel,
          transcript: this.experiencedObservationTranscript(viewerKey, latest.sceneId),
          delivery: slot === undefined
              ? { kind: "none" }
              : (() => {
                  const frame = parseJson<DeliveryFrame>(slot.frame_json);
                  const observedFrame = frame.sceneIds?.length
                    ? frame
                    : {
                        ...frame,
                        sceneIds: this.authorityDeliveryFrameSceneIds(
                          replay,
                          latest.id,
                          slot,
                          frame,
                        ),
                      };
                  return { kind: "current" as const, frame: observedFrame, body: frame.text };
                })(),
          ...(narrationRecovery === undefined ? {} : { narrationRecovery }),
        };
      }
      const formerRecovery = this.authenticatedFormerViewerNarrationRecovery(
        replay,
        authenticated,
      );
      const narrationRecovery = formerRecovery === undefined
        ? undefined
        : {
            kind: "available" as const,
            capability: formerRecovery.recovery.plan.publishCapability,
            state: formerRecovery.recovery.audience.status as
              | "pending"
              | "rejected"
              | "retryableFailure",
          };
      if (formerRecovery !== undefined && narrationRecovery !== undefined) {
        const viewerKey = `${formerRecovery.viewer.principalId}\u001f${formerRecovery.viewer.characterId}`;
        const slot = this.authorityStore.deliverySlot(viewerKey);
        return {
          readModel: null,
          transcript: this.experiencedObservationTranscript(viewerKey),
          delivery: slot === undefined
            ? { kind: "none" }
            : (() => {
                const frame = parseJson<DeliveryFrame>(slot.frame_json);
                return { kind: "current" as const, frame, body: frame.text };
              })(),
          narrationRecovery,
        };
      }
    }
    if (authenticated === undefined || authenticated.characterIds.length === 0) {
      const principalId = isJsonRecord(context)
        && isJsonRecord(context.principal)
        && nonEmptyString(context.principal.id)
        ? context.principal.id
        : undefined;
      const sessionVersion = isJsonRecord(context)
        && isJsonRecord(context.principal)
        && Number.isSafeInteger(context.principal.sessionVersion)
        ? Number(context.principal.sessionVersion)
        : undefined;
      if (
        principalId !== undefined
        && sessionVersion !== undefined
        && replay.state.principals[principalId]?.sessionVersion === sessionVersion
        && !Object.values(replay.state.seats).some((seat) =>
          seat.principalId === principalId && seat.status === "active")
      ) {
        return rejectedAuthority("seatInactive", "The trusted viewer has no active Seat.");
      }
      return rejectedAuthority("viewerUnauthorized", "The trusted viewer has no active character.");
    }
    const characterId = authenticated.characterIds[0];
    const viewer = this.authorityPlayerViewer(authenticated, replay.state, characterId);
    if (viewer === undefined) {
      return rejectedAuthority("viewerUnauthorized", "The viewer projection is unavailable.");
    }
    const projectionQuery = this.authorityIncrementalProjectionQuery(replay, query);
    if (projectionQuery === "invalid") {
      return { kind: "retryableFailure", code: "projectionIntegrity" };
    }
    const projected = projectAuthoritative(
      replay.profiles,
      replay.state,
      viewer,
      projectionQuery,
    );
    if (projected.kind === "rejected") {
      if (
        incrementalProjectionRequested(query)
        && projected.rejection.code === "projectionIntegrity"
      ) return { kind: "retryableFailure", code: "projectionIntegrity" };
      return rejectedAuthority(projected.rejection.code, projected.rejection.message);
    }
    const playerProjection = roomPlayerProjection(projected as unknown as JsonObject, characterId);
    const story = projectedStorySummary(playerProjection);
    const readModel: JsonObject = {
      ...playerProjection,
      viewer: {
        kind: "player",
        principalId: authenticated.principalId,
        characterId,
      },
      worldRevision: projected.stateVersion,
      ...(story === undefined ? {} : { story }),
    };
    const viewerKey = `${authenticated.principalId}\u001f${characterId}`;
    const slot = this.authorityStore.deliverySlot(viewerKey);
    const narrationRecovery = this.viewerNarrationRecovery(replay, viewer);
    return {
      readModel,
      transcript: this.experiencedObservationTranscript(
        viewerKey,
        replay.state.entities[characterId]?.sceneId,
      ),
      delivery: slot === undefined
        ? { kind: "none" }
        : (() => {
            const frame = parseJson<DeliveryFrame>(slot.frame_json);
            const observedFrame = frame.sceneIds?.length
              ? frame
              : {
                  ...frame,
                  sceneIds: this.authorityDeliveryFrameSceneIds(
                    replay,
                    characterId,
                    slot,
                    frame,
                  ),
                };
            return { kind: "current" as const, frame: observedFrame, body: frame.text };
          })(),
      ...(narrationRecovery === undefined ? {} : { narrationRecovery }),
    };
  }

  async acknowledge(
    context: TrustedPrincipalContext,
    deliveryId: string,
    acknowledgementId = `ack:${deliveryId}`,
  ) {
    if (this.authorityStore.roomDeletion() !== undefined) {
      return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
    }
    if (!nonEmptyString(deliveryId) || !nonEmptyString(acknowledgementId)) {
      return rejectedAuthority("invalidAcknowledgement", "Delivery and acknowledgement ids are required.");
    }
    const payloadHash = await authorityHash({ deliveryId });
    const replay = this.authoritativeReplay();
    const authenticated = this.authenticatedAuthorityViewer(context, replay.state);
    if (authenticated === undefined) {
      return rejectedAuthority("viewerUnauthorized", "The trusted viewer has no active character.");
    }
    const existing = this.authorityStore.acknowledgement(acknowledgementId);
    if (existing !== undefined) {
      if (existing.principal_id !== authenticated.principalId || existing.payload_hash !== payloadHash) {
        return rejectedAuthority(
          "idempotencyPayloadMismatch",
          "The acknowledgement id was already used for a different delivery.",
        );
      }
      return parseJson(existing.result_json);
    }
    const characterId = authenticated.characterIds[0]
      ?? this.formerCharactersForViewer(authenticated, replay.state)[0]?.id;
    if (characterId === undefined) {
      return rejectedAuthority("viewerUnauthorized", "The trusted viewer has no current delivery subject.");
    }
    const viewerKey = `${authenticated.principalId}\u001f${characterId}`;
    return this.authorityStore.transaction(() => {
      if (this.authorityStore.roomDeletion() !== undefined) {
        return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
      }
      const raced = this.authorityStore.acknowledgement(acknowledgementId);
      if (raced !== undefined) {
        if (raced.principal_id !== authenticated.principalId || raced.payload_hash !== payloadHash) {
          return rejectedAuthority(
            "idempotencyPayloadMismatch",
            "The acknowledgement id was already used for a different delivery.",
          );
        }
        return parseJson(raced.result_json);
      }
      const slot = this.authorityStore.deliverySlot(viewerKey);
      if (slot === undefined || slot.delivery_id !== deliveryId) {
        return rejectedAuthority("deliveryUnavailable", "The current delivery is unavailable.");
      }
      const frame = parseJson<DeliveryFrame>(slot.frame_json);
      const result = { kind: "acknowledged" as const, deliveryId };
      this.authorityStore.appendExperiencedMessage({
        viewerKey,
        messageId: frame.deliveryId,
        sceneIds: this.authorityDeliveryFrameSceneIds(
          replay,
          characterId,
          slot,
          frame,
        ),
        kind: "kp",
        speakerCharacterId: null,
        speakerName: "KP",
        body: frame.text,
        sourceEventSeq: slot.source_event_seq,
        receiptId: frame.receiptId,
      });
      this.authorityStore.tombstoneDelivery(
        slot,
        frame.receiptId,
        frame.payloadHash,
        "acknowledged",
      );
      this.authorityStore.deleteDeliverySlot(viewerKey);
      this.authorityStore.saveAcknowledgement({
        acknowledgementId,
        principalId: authenticated.principalId,
        payloadHash,
        result,
      });
      return result;
    });
  }

  async commitCorrection(
    correctionCapability: unknown,
    requestValue: unknown,
  ): Promise<AuthorityCommitOutcome> {
    if (!hasRoomServiceCapability(correctionCapability, "correction")) {
      return rejectedAuthority(
        "correctionUnauthorized",
        "Only an opaque server-held correction capability may execute a correction.",
      );
    }
    if (this.authorityStore.roomDeletion() !== undefined) {
      return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
    }
    if (
      !isJsonRecord(requestValue)
      || !hasExactJsonKeys(requestValue, [
        "correctionId",
        "errorKind",
        "explanation",
        "receiptId",
      ])
      || !nonEmptyString(requestValue.correctionId)
      || !nonEmptyString(requestValue.receiptId)
      || !nonEmptyString(requestValue.errorKind)
      || !nonEmptyString(requestValue.explanation)
    ) {
      return rejectedAuthority(
        "invalidCorrectionRequest",
        "A correction must be one closed Receipt-bound service request.",
      );
    }
    const correctionId = requestValue.correctionId;
    const targetReceiptId = requestValue.receiptId;
    const payloadHash = await authorityHash(requestValue);
    const existing = this.authorityStore.correction(correctionId);
    if (existing !== undefined) {
      if (existing.payload_hash !== payloadHash) {
        return rejectedAuthority(
          "idempotencyPayloadMismatch",
          "The correction id was already used with a different payload.",
        );
      }
      return parseJson<AuthorityCommitOutcome>(existing.result_json);
    }

    const replay = this.authoritativeReplay();
    const targetReceipt = this.authorityStore.receipt(targetReceiptId);
    if (targetReceipt === undefined || !nonEmptyString(targetReceipt.actorCharacterId)) {
      return rejectedAuthority(
        "correctionTargetUnavailable",
        "The correction target Receipt or its trusted actor binding is unavailable.",
      );
    }
    const actorCharacterId = targetReceipt.actorCharacterId;
    const corrected = stepAuthoritative(replay.profiles, replay.state, {
      kind: "applyServiceCorrection",
      actorCharacterId,
      correctionAuthority: {
        kind: "roomCorrectionAuthority",
        capability: replay.state.correctionRuntime.authorityCapability,
      },
      correctionId,
      targetReceiptId,
      errorKind: requestValue.errorKind,
      publicExplanation: requestValue.explanation,
      basis: {
        stateHash: replay.replay.head.stateHash,
        eventHash: replay.replay.head.eventHash,
      },
    });
    if (corrected.kind === "rejected") {
      return rejectedAuthority(corrected.rejection.code, corrected.rejection.message);
    }
    if (
      corrected.kind !== "committed"
      || corrected.correctionId !== correctionId
      || (corrected.strategy !== "forwardCompensation" && corrected.strategy !== "causalBranch")
      || !nonEmptyString(corrected.activeBranchId)
      || !Array.isArray(corrected.supersededRootActionIds)
      || corrected.events.length === 0
    ) {
      return rejectedAuthority(
        "invalidRulesResult",
        "Rules did not return one canonical correction transition.",
      );
    }

    const correctionReceipt: PublicReceipt = {
      receiptId: corrected.receipt.receiptId,
      rootActionId: corrected.receipt.rootActionId,
      actorCharacterId,
      status: "committed",
      runtimeEpochId: corrected.state.runtimeEpochId,
      activeBranchId: corrected.state.activeBranchId,
      eventRange: {
        first: corrected.events[0].eventSeq,
        last: corrected.events[corrected.events.length - 1].eventSeq,
        from: Number(corrected.events[0].eventSeq),
        to: Number(corrected.events[corrected.events.length - 1].eventSeq),
      },
      scopeVersions: {
        [`branch:${corrected.state.activeBranchId}`]: corrected.state.version,
      },
      randomnessCommitments: [],
      correctionId,
    };
    const deliveryPlan: DeliveryPlan = {
      deliveryProtocol: deliveryProtocolForProfiles(replay.profiles),
      publishCapability: randomId("publish-capability"),
      rootActionId: correctionReceipt.rootActionId,
      receiptId: correctionReceipt.receiptId,
      activeBranchId: correctionReceipt.activeBranchId,
      eventRange: correctionReceipt.eventRange,
      audiences: this.authorityAudienceBindings(
        replay.profiles,
        corrected.state,
        actorCharacterId,
        correctionReceipt.receiptId,
        replay.state,
        corrected.events,
      ),
    };
    const supersededRootActionIds = [...new Set([
      targetReceipt.rootActionId,
      ...corrected.supersededRootActionIds,
    ])].sort();
    const outcome: AuthorityCommitOutcome = {
      kind: "committed",
      correctionId,
      strategy: corrected.strategy,
      activeBranchId: corrected.activeBranchId,
      supersededRootActionIds,
      receipt: correctionReceipt,
      deliveryPlan,
    };

    const persisted = this.authorityStore.transaction(() => {
      if (this.authorityStore.roomDeletion() !== undefined) {
        return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
      }
      const raced = this.authorityStore.correction(correctionId);
      if (raced !== undefined) {
        if (raced.payload_hash !== payloadHash) {
          return rejectedAuthority(
            "idempotencyPayloadMismatch",
            "The correction id was already used with a different payload.",
          );
        }
        return parseJson<AuthorityCommitOutcome>(raced.result_json);
      }
      const currentReplay = this.authoritativeReplay();
      if (
        currentReplay.replay.head.eventHash !== replay.replay.head.eventHash
        || currentReplay.replay.head.stateHash !== replay.replay.head.stateHash
      ) {
        return {
          kind: "retryableFailure" as const,
          code: "correctionConflict",
        };
      }
      for (const slot of this.authorityStore.deliverySlotsForRootActions(
        supersededRootActionIds,
      )) {
        const frame = parseJson<DeliveryFrame>(slot.frame_json);
        this.authorityStore.appendExperiencedMessage({
          viewerKey: slot.viewer_key,
          messageId: frame.deliveryId,
          sceneIds: this.authorityDeliveryFrameSceneIds(
            replay,
            slot.character_id,
            slot,
            frame,
          ),
          kind: "kp",
          speakerCharacterId: null,
          speakerName: "KP",
          body: frame.text,
          sourceEventSeq: slot.source_event_seq,
          receiptId: frame.receiptId,
        });
      }
      this.authorityStore.appendEvents(corrected.events);
      this.authorityStore.updateState(corrected.state);
      this.authorityStore.syncPendingAuthority(corrected.state);
      this.authorityStore.supersedeReceipts(supersededRootActionIds);
      this.authorityStore.supersedeDeliveries(supersededRootActionIds);
      this.authorityStore.saveReceipt(correctionReceipt);
      this.authorityStore.saveDeliveryPlan(
        deliveryPlan,
        corrected.events[corrected.events.length - 1].eventSeq,
      );
      this.authorityStore.saveCorrection({
        correctionId,
        payloadHash,
        targetReceiptId,
        result: outcome,
      });
      return outcome;
    });
    if (persisted.kind === "committed") await this.scheduleAuthoritativeD1Archive();
    return persisted;
  }

  async initialize(input: InitializeRoomInput) {
    const mod = this.definition(input.moduleId);
    if (input.rulesetVersion !== RULESET_VERSION || mod.rulesetVersion !== RULESET_VERSION) {
      throw new Error(`房间必须锁定 ${RULESET_VERSION}`);
    }
    const legacyRules = legacyRulesAdapterFor(input.rulesetVersion);
    const result = this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec<RoomRow>(
          `SELECT room_id, module_id, ruleset_version, state_json, scope_versions_json
           FROM room_state WHERE singleton = 1`,
        )
        .toArray()[0];
      if (existing) {
        if (
          existing.room_id !== input.roomId ||
          existing.module_id !== input.moduleId ||
          existing.ruleset_version !== input.rulesetVersion
        ) {
          throw new Error("同一个 Room Durable Object 不能重新绑定到另一房间或规则集");
        }
        return { created: false, stateVersion: parseJson<WorldState>(existing.state_json).version };
      }
      const playerIds = new Set(input.players.map((entry) => entry.id));
      const npcEntities: LegacyInitialEntity[] = mod.npcs
        .filter((npc) => !playerIds.has(npc.id))
        .map((npc) => {
          const scene = mod.chapters
            .flatMap((chapter) => chapter.scenes)
            .find((candidate) => candidate.npcs.includes(npc.id));
          const attack = /([+-]\d+)\s+(\d+)d(\d+)([+-]\d+)?/i.exec(npc.stats);
          return {
            id: npc.id,
            kind: "npc",
            name: npc.name,
            ac: Number(/AC\s*(\d+)/i.exec(npc.stats)?.[1] ?? 10),
            hp: {
              current: Number(/HP\s*(\d+)/i.exec(npc.stats)?.[1] ?? 1),
              max: Number(/HP\s*(\d+)/i.exec(npc.stats)?.[1] ?? 1),
            },
            abilityScores: {
              str: 10,
              dex: 10 + 2 * Number(/敏捷\s*\+?(-?\d+)/.exec(npc.stats)?.[1] ?? 0),
              con: 10,
              int: 10,
              wis: 10,
              cha: 10,
            },
            sceneId: mod.world.locationSceneIds.includes(scene?.id ?? "")
              ? scene!.id
              : mod.world.initialSceneId,
            capabilities: [...(mod.world.npcCapabilities?.[npc.id] ?? [])],
            attacks: [
              {
                id: "primary-attack",
                name: "攻击",
                attackBonus: Number(attack?.[1] ?? 2),
                kind: "melee" as const,
                reachFeet: 5,
                damage: {
                  count: Number(attack?.[2] ?? 1),
                  sides: Number(attack?.[3] ?? 4),
                  bonus: Number(attack?.[4] ?? 0),
                  damageType: "physical",
                },
              },
            ],
          };
        });
      const state = legacyRules.initializeWorld(
        mod.world,
        [...input.players, ...npcEntities],
        input.squads,
      );
      const now = Date.now();
      this.ctx.storage.sql.exec(
        `INSERT INTO room_state (
           singleton, room_id, module_id, ruleset_version, state_json, scope_versions_json, updated_at
         ) VALUES (1, ?, ?, ?, ?, ?, ?)`,
        input.roomId,
        input.moduleId,
        input.rulesetVersion,
        JSON.stringify(state),
        "{}",
        now,
      );
      return { created: true, stateVersion: state.version };
    });
    return result;
  }

  async upsertPlayer(input: UpsertPlayerInput) {
    const result = this.ctx.storage.transactionSync(() => {
      const row = this.roomRow();
      const legacyRules = legacyRulesAdapterFor(row.ruleset_version);
      const mod = this.definition(row.module_id);
      const state = parseJson<WorldState>(row.state_json);
      const existingEntity = state.entities[input.player.id];
      if (existingEntity?.active !== false) {
        return { created: false, rejoined: false, stateVersion: state.version };
      }
      if (existingEntity) {
        const peers = Object.values(state.entities).filter(
          (candidate) =>
            candidate.active !== false && candidate.sceneId === existingEntity.sceneId,
        );
        const toSeconds = Math.max(
          state.causalFrontierSeconds,
          ...peers.map((candidate) => state.timelines[candidate.id]?.fictionSeconds ?? 0),
        );
        const toSpotlightBeat = Math.max(
          0,
          ...peers.map((candidate) => state.timelines[candidate.id]?.spotlightBeat ?? 0),
        );
        const commandId = `system:reseat:${input.player.id}:${crypto.randomUUID()}`;
        const events: WorldEvent[] = [
          {
            type: "EntityRejoined",
            entityId: input.player.id,
            id: `${commandId}:1`,
            commandId,
            version: state.version + 1,
            atSeconds: toSeconds,
          },
          {
            type: "TimelinesSynchronized",
            entityIds: [input.player.id],
            toSeconds,
            toSpotlightBeat,
            id: `${commandId}:2`,
            commandId,
            version: state.version + 2,
            atSeconds: toSeconds,
          },
        ];
        const next = legacyRules.applyCommittedEvents(state, events);
        const currentVersions = parseJson<Record<string, number>>(row.scope_versions_json);
        const nextVersions = advanceScopeVersions(
          currentVersions,
          [`entity:${input.player.id}`, `scene:${existingEntity.sceneId}`],
          next.version,
        );
        for (const event of events) {
          this.ctx.storage.sql.exec(
            `INSERT INTO world_events (
               version, event_id, command_id, event_type, fiction_seconds, event_json
             ) VALUES (?, ?, ?, ?, ?, ?)`,
            event.version,
            event.id,
            event.commandId,
            event.type,
            event.atSeconds,
            JSON.stringify(event),
          );
        }
        this.ctx.storage.sql.exec(
          `UPDATE room_state SET state_json = ?, scope_versions_json = ?, updated_at = ?
           WHERE singleton = 1`,
          JSON.stringify(next),
          JSON.stringify(nextVersions),
          Date.now(),
        );
        return { created: false, rejoined: true, stateVersion: next.version };
      }
      const seed = legacyRules.initializeWorld(mod.world, [{ ...input.player, kind: "player" }]);
      const entity = seed.entities[input.player.id];
      const sameSceneTimes = Object.values(state.entities)
        .filter((candidate) => candidate.sceneId === entity.sceneId)
        .map((candidate) => state.timelines[candidate.id]?.fictionSeconds ?? 0);
      const sameSceneBeats = Object.values(state.entities)
        .filter((candidate) => candidate.sceneId === entity.sceneId)
        .map((candidate) => state.timelines[candidate.id]?.spotlightBeat ?? 0);
      const timeline = {
        spotlightBeat: Math.max(0, ...sameSceneBeats),
        fictionSeconds: Math.max(state.causalFrontierSeconds, ...sameSceneTimes),
        causalVersion: state.version,
      };
      const commandId = `system:seat:${input.player.id}:${crypto.randomUUID()}`;
      const event: WorldEvent = {
        type: "EntityJoined",
        entity,
        timeline,
        id: `${commandId}:1`,
        commandId,
        version: state.version + 1,
        atSeconds: timeline.fictionSeconds,
      };
      const next = legacyRules.applyCommittedEvents(state, [event]);
      const scopes = [`entity:${entity.id}`, `scene:${entity.sceneId}`];
      const currentVersions = parseJson<Record<string, number>>(row.scope_versions_json);
      const nextVersions = advanceScopeVersions(currentVersions, scopes, next.version);
      const now = Date.now();
      this.ctx.storage.sql.exec(
        `INSERT INTO world_events (
           version, event_id, command_id, event_type, fiction_seconds, event_json
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        event.version,
        event.id,
        event.commandId,
        event.type,
        event.atSeconds,
        JSON.stringify(event),
      );
      this.ctx.storage.sql.exec(
        `UPDATE room_state SET state_json = ?, scope_versions_json = ?, updated_at = ?
         WHERE singleton = 1`,
        JSON.stringify(next),
        JSON.stringify(nextVersions),
        now,
      );
      return { created: true, rejoined: false, stateVersion: next.version };
    });
    await this.archiveAllRoomEvents();
    return result;
  }

  async departPlayer(playerId: string) {
    const result = this.ctx.storage.transactionSync(() => {
      const row = this.roomRow();
      const legacyRules = legacyRulesAdapterFor(row.ruleset_version);
      const state = parseJson<WorldState>(row.state_json);
      const entity = state.entities[playerId];
      if (!entity || entity.active === false) return { changed: false, stateVersion: state.version };
      if (entity.kind !== "player") throw new Error("只能让玩家角色离席");
      const commandId = `system:depart:${playerId}:${crypto.randomUUID()}`;
      const event: WorldEvent = {
        type: "EntityDeparted",
        entityId: playerId,
        id: `${commandId}:1`,
        commandId,
        version: state.version + 1,
        atSeconds: state.timelines[playerId]?.fictionSeconds ?? 0,
      };
      const next = legacyRules.applyCommittedEvents(state, [event]);
      const currentVersions = parseJson<Record<string, number>>(row.scope_versions_json);
      const nextVersions = advanceScopeVersions(
        currentVersions,
        [`entity:${playerId}`, `scene:${entity.sceneId}`],
        next.version,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO world_events (
           version, event_id, command_id, event_type, fiction_seconds, event_json
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        event.version,
        event.id,
        event.commandId,
        event.type,
        event.atSeconds,
        JSON.stringify(event),
      );
      this.ctx.storage.sql.exec(
        `UPDATE room_state SET state_json = ?, scope_versions_json = ?, updated_at = ?
         WHERE singleton = 1`,
        JSON.stringify(next),
        JSON.stringify(nextVersions),
        Date.now(),
      );
      return { changed: true, stateVersion: next.version };
    });
    await this.archiveAllRoomEvents();
    return result;
  }

  async synchronizePlayerLoadout(input: SynchronizePlayerLoadoutInput) {
    const result = this.ctx.storage.transactionSync(() => {
      const row = this.roomRow();
      const legacyRules = legacyRulesAdapterFor(row.ruleset_version);
      const state = parseJson<WorldState>(row.state_json);
      const entity = state.entities[input.playerId];
      if (!entity || entity.kind !== "player") {
        return { ok: false as const, error: "玩家不在这个房间中", stateVersion: state.version };
      }
      if (!Number.isInteger(input.ac) || input.ac < 1 || input.ac > 40) {
        return { ok: false as const, error: "护甲等级不合法", stateVersion: state.version };
      }
      const commandId = `system:loadout:${input.playerId}:${crypto.randomUUID()}`;
      const eventBodies: UnstampedWorldEvent[] = [];
      const combat = state.combats[entity.sceneId];
      if (combat?.status === "active") {
        const active = combat.order[combat.activeIndex];
        const combatant = combat.order.find((entry) => entry.entityId === input.playerId);
        if (!combatant || active?.entityId !== input.playerId) {
          return {
            ok: false as const,
            error: "战斗中只能在自己的回合调整手持或穿戴物品",
            stateVersion: state.version,
          };
        }
        if (combatant.economy.objectInteraction === false) {
          return {
            ok: false as const,
            error: "本回合的免费物件互动已经使用",
            stateVersion: state.version,
          };
        }
        eventBodies.push({
          type: "CombatActionSpent",
          sceneId: entity.sceneId,
          entityId: input.playerId,
          cost: "objectInteraction",
        });
      }
      eventBodies.push({
        type: "EntityLoadoutSynchronized",
        entityId: input.playerId,
        ac: input.ac,
        attacks: structuredClone(input.attacks),
        capabilities: [...new Set(input.capabilities)],
        proficientSaves: input.proficientSaves,
        creatureType: input.creatureType,
        conditionImmunities: input.conditionImmunities,
        spellLevels: input.spellLevels,
        spellActionCosts: input.spellActionCosts,
        spellcasting: input.spellcasting,
      });
      const events = eventBodies.map((body, index) => ({
        ...body,
        id: `${commandId}:${index + 1}`,
        commandId,
        version: state.version + index + 1,
        atSeconds: state.timelines[input.playerId]?.fictionSeconds ?? 0,
      })) as WorldEvent[];
      const next = legacyRules.applyCommittedEvents(state, events);
      const currentVersions = parseJson<Record<string, number>>(row.scope_versions_json);
      const nextVersions = advanceScopeVersions(
        currentVersions,
        [`entity:${input.playerId}`, `scene:${entity.sceneId}`],
        next.version,
      );
      const now = Date.now();
      for (const event of events) {
        this.ctx.storage.sql.exec(
          `INSERT INTO world_events (
             version, event_id, command_id, event_type, fiction_seconds, event_json
           ) VALUES (?, ?, ?, ?, ?, ?)`,
          event.version,
          event.id,
          event.commandId,
          event.type,
          event.atSeconds,
          JSON.stringify(event),
        );
      }
      this.ctx.storage.sql.exec(
        `UPDATE room_state SET state_json = ?, scope_versions_json = ?, updated_at = ?
         WHERE singleton = 1`,
        JSON.stringify(next),
        JSON.stringify(nextVersions),
        now,
      );
      return { ok: true as const, stateVersion: next.version };
    });
    await this.archiveAllRoomEvents();
    return result;
  }

  async prepareTurn(input: PrepareTurnInput): Promise<TurnTicket> {
    const now = input.nowMs ?? Date.now();
    const ticket = this.ctx.storage.transactionSync(() => {
      this.cleanupExpired(now);
      const row = this.roomRow();
      const legacyRules = legacyRulesAdapterFor(row.ruleset_version);
      const mod = this.definition(row.module_id);
      const state = parseJson<WorldState>(row.state_json);
      const actor = state.entities[input.actorId];
      if (!actor || actor.active === false) throw new Error("行动者不在这个房间中");
      const scopeVersions = parseJson<Record<string, number>>(row.scope_versions_json);
      const ticket: TurnTicket = {
        id: crypto.randomUUID(),
        actorId: input.actorId,
        stateVersion: state.version,
        scopeVersions,
        expiresAt: now + TURN_TICKET_TTL_MS,
        projection: legacyRules.projectViewer(mod.world, state, input.actorId),
      };
      this.ctx.storage.sql.exec(
        `INSERT INTO turn_tickets (
           id, actor_id, state_version, scope_versions_json, projection_json, status, expires_at
         ) VALUES (?, ?, ?, ?, ?, 'open', ?)`,
        ticket.id,
        ticket.actorId,
        ticket.stateVersion,
        JSON.stringify(ticket.scopeVersions),
        JSON.stringify(ticket.projection),
        ticket.expiresAt,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO ux_status (scope_id, phase, ticket_id, expires_at)
         VALUES (?, 'interpreting', ?, ?)
         ON CONFLICT(scope_id) DO UPDATE SET
           phase = excluded.phase,
           ticket_id = excluded.ticket_id,
           expires_at = excluded.expires_at`,
        actor.sceneId,
        ticket.id,
        now + UX_LEASE_TTL_MS,
      );
      return ticket;
    });
    await this.scheduleExpiryAlarm();
    return ticket;
  }

  async commitTurn(input: CommitTurnInput): Promise<CommitTurnResult> {
    const now = input.nowMs ?? Date.now();
    const result = this.ctx.storage.transactionSync((): CommitTurnResult => {
      this.cleanupExpired(now);
      const row = this.roomRow();
      const legacyRules = legacyRulesAdapterFor(row.ruleset_version);
      const existing = this.ctx.storage.sql
        .exec<{ result_json: string }>("SELECT result_json FROM commands WHERE command_id = ?", input.command.id)
        .toArray()[0];
      if (existing) {
        return { ...parseJson<CommitTurnResult>(existing.result_json), idempotent: true };
      }
      const mod = this.definition(row.module_id);
      const state = parseJson<WorldState>(row.state_json);
      const ticket = this.ctx.storage.sql
        .exec<TicketRow>(
          `SELECT id, actor_id, state_version, scope_versions_json, projection_json, status, expires_at
           FROM turn_tickets WHERE id = ?`,
          input.ticketId,
        )
        .toArray()[0];
      if (!ticket || ticket.status !== "open" || ticket.expires_at <= now) {
        return {
          decision: staleDecision(input.command.id, "行动票据不存在或已经过期，请重新解释行动。"),
          stateVersion: state.version,
          idempotent: false,
        };
      }
      if (ticket.actor_id !== input.command.actorId) {
        this.ctx.storage.sql.exec("UPDATE turn_tickets SET status = 'rejected' WHERE id = ?", ticket.id);
        return {
          decision: staleDecision(input.command.id, "行动票据不属于该角色。"),
          stateVersion: state.version,
          idempotent: false,
        };
      }
      const versionedCommand = {
        ...input.command,
        expectedVersion: state.version,
      } as Command;
      const authoritativeCommand = versionedCommand.kind === "castSpell"
        ? completeSpellCastRolls(state, versionedCommand)
        : versionedCommand;
      const scopes = commandScopes(mod.world, state, authoritativeCommand);
      const ticketVersions = parseJson<Record<string, number>>(ticket.scope_versions_json);
      const currentVersions = parseJson<Record<string, number>>(row.scope_versions_json);
      const conflict = scopeConflict(ticketVersions, currentVersions, scopes);
      if (conflict) {
        this.ctx.storage.sql.exec("UPDATE turn_tickets SET status = 'stale' WHERE id = ?", ticket.id);
        this.ctx.storage.sql.exec("DELETE FROM ux_status WHERE ticket_id = ?", ticket.id);
        return {
          decision: staleDecision(input.command.id, `行动相关状态已经变化：${conflict}`),
          stateVersion: state.version,
          idempotent: false,
          conflictedScope: conflict,
        };
      }
      const decision = legacyRules.adjudicate(mod.world, state, authoritativeCommand);
      const nextState = decision.kind === "rejected"
        ? state
        : legacyRules.applyCommittedEvents(state, decision.events);
      if (decision.kind !== "rejected") {
        for (const event of decision.events) {
          this.ctx.storage.sql.exec(
            `INSERT INTO world_events (
               version, event_id, command_id, event_type, fiction_seconds, event_json
             ) VALUES (?, ?, ?, ?, ?, ?)`,
            event.version,
            event.id,
            event.commandId,
            event.type,
            event.atSeconds,
            JSON.stringify(event),
          );
        }
      }
      const nextScopeVersions =
        decision.kind === "rejected"
          ? currentVersions
          : advanceScopeVersions(currentVersions, scopes, nextState.version);
      this.ctx.storage.sql.exec(
        `UPDATE room_state
         SET state_json = ?, scope_versions_json = ?, updated_at = ?
         WHERE singleton = 1`,
        JSON.stringify(nextState),
        JSON.stringify(nextScopeVersions),
        now,
      );
      const commitResult: CommitTurnResult = {
        decision,
        stateVersion: nextState.version,
        projection: legacyRules.projectViewer(mod.world, nextState, input.command.actorId),
        idempotent: false,
      };
      this.ctx.storage.sql.exec(
        "INSERT INTO commands (command_id, result_json, created_at) VALUES (?, ?, ?)",
        input.command.id,
        JSON.stringify(commitResult),
        now,
      );
      this.ctx.storage.sql.exec("UPDATE turn_tickets SET status = 'committed' WHERE id = ?", ticket.id);
      const phase = decision.kind === "awaitingRoll" ? "awaitingRoll" : "narrating";
      const actorScene = nextState.entities[input.command.actorId].sceneId;
      this.ctx.storage.sql.exec(
        `INSERT INTO ux_status (scope_id, phase, ticket_id, expires_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope_id) DO UPDATE SET
           phase = excluded.phase,
           ticket_id = excluded.ticket_id,
           expires_at = excluded.expires_at`,
        actorScene,
        phase,
        ticket.id,
        now + UX_LEASE_TTL_MS,
      );
      return commitResult;
    });
    if (result.decision.kind !== "rejected") {
      await this.archiveEvents(
        this.roomRow().room_id,
        result.decision.events,
      );
    }
    await this.scheduleExpiryAlarm();
    return result;
  }

  async finishNarration(ticketId: string) {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM ux_status WHERE ticket_id = ?", ticketId);
    });
    await this.scheduleExpiryAlarm();
  }

  async markInterpretationFailed(ticketId: string) {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE turn_tickets SET status = 'failed' WHERE id = ? AND status = 'open'",
        ticketId,
      );
      this.ctx.storage.sql.exec("DELETE FROM ux_status WHERE ticket_id = ?", ticketId);
    });
    await this.scheduleExpiryAlarm();
  }

  getSnapshot(viewerId: string, nowMs = Date.now()): RoomSnapshot {
    return this.ctx.storage.transactionSync(() => {
      this.cleanupExpired(nowMs);
      const row = this.roomRow();
      const legacyRules = legacyRulesAdapterFor(row.ruleset_version);
      const mod = this.definition(row.module_id);
      const state = parseJson<WorldState>(row.state_json);
      const ux = this.ctx.storage.sql
        .exec<{ scope_id: string; phase: RoomSnapshot["ux"][number]["phase"]; expires_at: number }>(
          "SELECT scope_id, phase, expires_at FROM ux_status WHERE expires_at > ? ORDER BY scope_id",
          nowMs,
        )
        .toArray()
        .map((entry) => ({ scopeId: entry.scope_id, phase: entry.phase, expiresAt: entry.expires_at }));
      return {
        roomId: row.room_id,
        moduleId: row.module_id,
        rulesetVersion: RULESET_VERSION,
        projection: legacyRules.projectViewer(mod.world, state, viewerId),
        ux,
      };
    });
  }

  getEvents(afterVersion = 0): StoredRoomEvent[] {
    return this.ctx.storage.sql
      .exec<{
        version: number;
        event_id: string;
        command_id: string;
        event_type: WorldEvent["type"];
        fiction_seconds: number;
        event_json: string;
      }>(
        `SELECT version, event_id, command_id, event_type, fiction_seconds, event_json
         FROM world_events WHERE version > ? ORDER BY version`,
        afterVersion,
      )
      .toArray()
      .map((row) => ({
        id: row.event_id,
        commandId: row.command_id,
        version: row.version,
        atSeconds: row.fiction_seconds,
        type: row.event_type,
        event: parseJson<WorldEvent>(row.event_json),
      }));
  }

  async alarm() {
    if (this.authorityStore.roomDeletion() !== undefined) {
      await this.reconcilePreparedDeletion();
      return;
    }
    const now = Date.now();
    this.ctx.storage.transactionSync(() => this.cleanupExpired(now));
    const archive = this.authorityStore.archiveProgress();
    if (
      archive?.pending
      && archive.nextAttemptAt !== null
      && archive.nextAttemptAt <= now
    ) {
      // An alarm consumes at most one D1 page. The page result persists the
      // next cursor and re-arms this same merged scheduler when more remains.
      await this.flushAuthoritativeD1ArchivePage();
      return;
    }
    await this.scheduleExpiryAlarm();
  }
}
