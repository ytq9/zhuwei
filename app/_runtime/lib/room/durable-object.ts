import type { LifecycleReadModel } from "../rules/v2/model";
import { isSupersededTimePassageAdvance, isSupersededLongSpellcastingAdvance, isSupersededActivityProgress, scheduledDeadlinesWithin } from "../rules/v2/due-activities";
import { activityProgressAvailable, actionActivityCompletionRoot } from "../rules/v2/activity-progress";
import { deepSeekRequestBody } from "../kp/deepseek";
import { narrationPublicFailureCode } from "../kp/public-failure-codes";
import type { ActorPlanTransport } from "./actor-plan-transport-types";
import type { AuthoritativeModelBinding, DueActorPlanDecisionRequest } from "../kp/authoritative-types";
import { usageFrom } from "../kp/authoritative-helpers";
import { vnextActorPlanDecisionInput, parseVnextActorPlanDecision, VNEXT_ACTOR_PLAN_DECISION_BINDING_HASH } from "../kp/vnext/actor-plan-decision";
import { assembleProviderInvocation, INITIAL_REPAIR_LEDGER } from "../kp/vnext/invocation/assemble";
import { VNEXT_KP_PROFILE, VNEXT_PROVIDER_BUDGET } from "../kp/vnext/runtime-policy";
import type { DueActivityDescriptor, RuleDiagnostic } from "../rules/v2/model";
import { characterTimelineId } from "../rules/v2/timeline";
import { roomNarrationContext } from "./narration-context";
import { moduleNpcSemanticSeeds } from "../module/npc-semantics";
import { frozenNarrationContextConform } from "../kp/narration-context";
import { DurableObject } from "cloudflare:workers";

import { validateCausalActionProgram } from "../kp/causal-action-program";
import { isFrozenPlayerChoiceAnswerInput } from "../rules/v2/frozen-player-choice";
import {
  authoritativeModuleProfile,
  moduleAuthorityFactSeeds,
  moduleInitializationFixtures,
  moduleKpProjection,
  SOCIAL_RESOLUTION_MODULE_VERSION,
  type AuthoritativeModuleProfile,
} from "../module/authoritative";
import {
  isTacticalPosition,
  isTacticalSpatialRevision,
} from "../rules/tactical-projection";
import {
  project as projectAuthoritative,
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
  committedRangeUsesFrozenRenderableClaims,
  frozenRenderableClaimsConform,
  type FrozenRenderableClaims,
} from "../rules/authority-read";
import {
  isSemanticDefinitionRevisionPlan,
  isWorldInteractionResolutionPlan,
} from "../rules/v2/world-interaction-model";
import { isSemanticDefinitionMaterializationPlan } from "../rules/v2/semantic-definitions";
import { isCanonicalAtomicWorldInteractionStepsInput } from "../rules/v2/world-interactions";
import { isTimePassagePlan } from "../rules/v2/time-passage";
import { combatPendingAnswerOptions } from "../rules/v2/combat-actions";
import { npcPendingAnswerConforms } from "../kp/pending-decision-policy";
import { canonicalJson as canonicalNpcAnswer } from "../kp/authoritative-helpers";
import { canonicalHash as vnextCanonicalHash, type JsonRecord as VNextJsonRecord } from "../kp/vnext/canonical-json";
import { VNEXT_KP_WORKFLOW_HASH, VNEXT_RULES_RUNTIME } from "../kp/vnext/runtime-policy";
import { VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE } from "../kp/vnext/room-bridge";
import type { VNextInvocationRequest, VNextInvocationStart, VNextInvocationCompletion } from "./vnext-proposal-invocation";
import { assertVNextInvocationTransition, vnextInvocationRetryAfter } from "./vnext-proposal-invocation";
import type { VersionedRulesRuntime } from "../rules/v2-runtime";
import { compileEnvironmentFeature } from "../rules/profiles/environment";
import { INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE } from "../rules/profiles/manifests";
import { characterProficiencyProfileEnabled } from "../rules/profiles/character-proficiency";
import { socialResolutionProfileEnabled } from "../rules/profiles/social-resolution";
import { worldInteractionProfileEnabled } from "../rules/profiles/vnext-world-interaction";
import type { ProfileRef } from "../rules/profiles/types";
import {
  AuthoritativeRoomStore,
  type AuthorityActionStageRow,
  type AuthorityDeliveryAudienceRow,
  type AuthorityDeliveryPlanRow,
  type AuthorityRandomnessBatchJournalRow,
  type AuthorityProposalRecoveryRow,
  type AuthorityNpcDecisionRow,
  type AuthoritySubmissionRow,
} from "./authority-store";
import { buildModelInvocationTelemetryEvent, buildRoomTelemetryEvent } from "./telemetry";
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
  ExperiencedTranscriptMessageInput,
  InitializeAuthoritativeRoomInput,
  JsonObject,
  NarrationInputMode,
  PreparedAuthoritativeAction,
  PublicReceipt,
  TrustedPrincipalContext,
  ViewerPendingPlayerRoll,
  ViewerNarrationRecovery,
} from "./authority-types";
import { lowerDynamicEnvironmentProposal } from "./environment-proposal-lowering";
import {
  isCanonicalV3CausalRulesInput,
  narrationProjection,
  normalizeRoomKpProposal,
  projectInitializationFixtures,
  projectedStorySummary,
  roomPlayerProjection,
} from "./proposal-adapter";
import { authorityPendingBindings, frozenPlayerChoiceAnswer } from "./pending-bindings";
import { isPartyCommand } from "./party-action";
import type {
  RoomVNextAdjudicationBridge,
  RoomVNextProposalLoweringResult,
  RoomVNextReadSetPhase,
} from "./vnext-adjudication-bridge";
import { requiredContextMatchesPreparedAction } from "./vnext-adjudication-bridge";

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
  throw new TypeError("The runtime manifest has no registered delivery protocol.");
}

function deliveryProtocolForPlan(plan: DeliveryPlan): ProfileRef | undefined {
  if (exactProfileRef(plan.deliveryProtocol, INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE)) {
    return INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE;
  }
  return undefined;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function isObserverProjection(value: ReturnType<typeof projectAuthoritative>): value is SafeReadModel | LifecycleReadModel {
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

function deliveryNarrationInputMode(
  binding: DeliveryAudienceBinding,
): NarrationInputMode | undefined {
  if (binding.narrationInputMode === "observerProjection-v1"
    || binding.narrationInputMode === "frozenRenderableClaims-vnext-1") {
    return binding.narrationInputMode;
  }
  // Open product-0.4 V5 delivery journals written before this discriminator
  // contain only the legacy observer projection. New DeliveryPlan writers are
  // statically required to set the mode; an absent mode beside a Claims
  // envelope is therefore corruption, not a legacy plan.
  const persisted = binding as unknown as JsonObject;
  return !("narrationInputMode" in persisted)
      && isJsonRecord(binding.kpProjection)
      && !("renderableClaims" in binding.kpProjection)
    ? "observerProjection-v1"
    : undefined;
}

function deliveryRenderableClaims(
  binding: DeliveryAudienceBinding,
): FrozenRenderableClaims | undefined {
  if (deliveryNarrationInputMode(binding) !== "frozenRenderableClaims-vnext-1"
    || !isJsonRecord(binding.kpProjection)
    || !frozenRenderableClaimsConform(binding.kpProjection.renderableClaims)) {
    return undefined;
  }
  return binding.kpProjection.renderableClaims;
}

function narrationPublicationMetadata(binding: DeliveryAudienceBinding) {
  if (deliveryNarrationInputMode(binding) === "frozenRenderableClaims-vnext-1") {
    return { derivedEvidenceRefs: [], derivedAgencyClaims: [] };
  }
  const projection = binding.kpProjection;
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
      receiptExtras?: JsonObject;
      forceConcluded?: boolean;
      answeredPendingInputId?: string;
    };

type AuthorityCommitContext = TrustedPrincipalContext | {
  kind: "internalDueActivity";
  rootActionId: string;
};

type AuthorityReplay = {
  profiles: RuntimeProfileManifest;
  genesis: RuntimeGenesis;
  state: AuthoritativeWorldState;
  replay: ReplayedRulesResult;
};

type AuthorityReplayCacheKey = {
  roomId: string;
  moduleId: string;
  profilesJson: string;
  genesisJson: string;
  stateJson: string;
  eventCount: number;
  eventSeq: string | null;
  eventId: string | null;
  eventJson: string | null;
};

type AuthorityReplayCache = {
  key: AuthorityReplayCacheKey;
  value: AuthorityReplay;
};

function sameAuthorityReplayCacheKey(
  left: AuthorityReplayCacheKey,
  right: AuthorityReplayCacheKey,
): boolean {
  return left.roomId === right.roomId
    && left.moduleId === right.moduleId
    && left.profilesJson === right.profilesJson
    && left.genesisJson === right.genesisJson
    && left.stateJson === right.stateJson
    && left.eventCount === right.eventCount
    && left.eventSeq === right.eventSeq
    && left.eventId === right.eventId
    && left.eventJson === right.eventJson;
}

type AuthenticatedAuthorityViewer = {
  principalId: string;
  sessionVersion: number;
  seatId: string;
  characterIds: string[];
};

type AuthorityAudienceBindingsResult =
  | Readonly<{ kind: "accepted"; audiences: DeliveryAudienceBinding[]; diceMessages: ExperiencedTranscriptMessageInput[] }>
  | Readonly<{
      kind: "rejected";
      outcome: Extract<AuthorityCommitOutcome, { kind: "rejected" }>;
    }>;

type AuthoritativeMovementContext = {
  encounterId: string;
  spatialRevision: `sha256:${string}`;
};

type AuthoritativeCombatTurnContext = {
  encounterId: string;
};

type AuthoritativeRestContext = {
  activityId: string;
};

const AUTHORITY_BRANCH_ID = "branch:main";
const PRESENTATION_POLICY_VERSION = "observer-single-slot/v1";
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
    super("Authoritative in-flight work must settle before this head is recoverable.");
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
  if (value.kind === "materializeSemanticDefinition"
    || value.kind === "reviseSemanticDefinition"
    || value.kind === "resolveWorldInteraction") {
    if (!hasExactJsonKeys(value, ["actorCharacterId", "kind", "plan", "rootActionId"])
      || !nonEmptyString(value.actorCharacterId)
      || !nonEmptyString(value.rootActionId)) return false;
    if (value.kind === "materializeSemanticDefinition") {
      return isSemanticDefinitionMaterializationPlan(value.plan);
    }
    if (value.kind === "reviseSemanticDefinition") {
      return isSemanticDefinitionRevisionPlan(value.plan);
    }
    return isWorldInteractionResolutionPlan(value.plan)
      && value.plan.actorCharacterId === value.actorCharacterId;
  }
  if (value.kind === "applyAtomicWorldInteractionSteps") {
    return isCanonicalAtomicWorldInteractionStepsInput(value);
  }
  if (value.kind === "startActionActivity") {
    return hasExactJsonKeys(value, ["actorCharacterId", "completionInput", "kind", "rootActionId"])
      && nonEmptyString(value.rootActionId) && nonEmptyString(value.actorCharacterId)
      && isCanonicalAtomicWorldInteractionStepsInput(value.completionInput)
      && value.completionInput.rootActionId === actionActivityCompletionRoot(value.rootActionId)
      && value.completionInput.actorCharacterId === value.actorCharacterId;
  }
  if (value.kind === "controlActivity") {
    return hasExactJsonKeys(value, ["activityId", "actorCharacterId", "attentionRootActionId", "decision", "kind", "proposalId"])
      && [value.activityId, value.actorCharacterId, value.attentionRootActionId, value.proposalId].every(nonEmptyString)
      && ["continue", "stop"].includes(String(value.decision));
  }
  if (value.kind === "endTurn") {
    return hasExactJsonKeys(value, ["encounterId", "kind", "rootActionId", "sourceEntityId"])
      && [value.encounterId, value.rootActionId, value.sourceEntityId].every(nonEmptyString);
  }
  if (value.kind === "startRest") {
    return hasOnlyJsonKeys(value, [
      "arcaneRecoverySlotLevels",
      "characterId",
      "hitDiceToSpend",
      "kind",
      "proposalId",
      "restKind",
    ], ["memberCharacterIds"])
      && [value.characterId, value.proposalId].every(nonEmptyString)
      && (value.restKind === "short" || value.restKind === "long")
      && Number.isSafeInteger(value.hitDiceToSpend)
      && Number(value.hitDiceToSpend) >= 0
      && Array.isArray(value.arcaneRecoverySlotLevels)
      && value.arcaneRecoverySlotLevels.every((level) =>
        Number.isSafeInteger(level) && Number(level) >= 1 && Number(level) <= 5)
      && (value.memberCharacterIds === undefined
        || (Array.isArray(value.memberCharacterIds)
          && value.memberCharacterIds.every(nonEmptyString)));
  }
  if (value.kind === "startTimePassage") {
    return hasExactJsonKeys(value, ["actorCharacterId", "kind", "plan", "rootActionId"])
      && nonEmptyString(value.actorCharacterId) && nonEmptyString(value.rootActionId)
      && isTimePassagePlan(value.plan);
  }
  if (["completeActivity", "advanceTimePassage", "advanceLongSpellcasting", "completeLongSpellcasting", "advanceActivity", "completeActionActivity"].includes(String(value.kind))) {
    return hasExactJsonKeys(value, ["activityId", "kind", "proposalId"])
      && nonEmptyString(value.activityId) && nonEmptyString(value.proposalId);
  }
  if (value.kind === "interruptActivity") {
    return hasExactJsonKeys(value, ["activityId", "cause", "kind", "proposalId"])
      && nonEmptyString(value.activityId)
      && nonEmptyString(value.proposalId)
      && isJsonRecord(value.cause);
  }
  if (value.kind === "invokeEnvironmentalStunt") {
    if (!hasOnlyJsonKeys(value, [
      "actorCharacterId", "controllerPrincipalId", "featureId", "kind", "rootActionId",
      "actionLanguageHash", "actionLanguageRef", "causalActionProgram",
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
      || !nonEmptyString(value.actionLanguageRef)
      || !isJsonRecord(value.causalActionProgram)
      || !validateCausalActionProgram(value.causalActionProgram).ok
      || value.causalActionProgram.formRef !== "environmental-stunt.v1"
      || value.actionLanguageHash !== value.causalActionProgram.languageHash
      || value.actionLanguageRef !== value.causalActionProgram.languageRef) return false;
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
  if (value.kind === "executeCausalActionProgram") {
    return isCanonicalV3CausalRulesInput(value);
  }
  if (value.kind === "resolveDueActorPlan") {
    return hasOnlyJsonKeys(value, [
      "affectedCharacterId",
      "causedByRootActionId",
      "decision",
      "kind",
      "mechanicalProposal",
      "planId",
      "proposalId",
    ], ["targetRef"])
      && value.decision === "execute"
      && [
        value.affectedCharacterId,
        value.causedByRootActionId,
        value.planId,
        value.proposalId,
      ].every(nonEmptyString)
      && (value.targetRef === undefined || nonEmptyString(value.targetRef))
      && isJsonRecord(value.mechanicalProposal);
  }
  if (value.kind === "answerFrozenPlayerChoice") return isFrozenPlayerChoiceAnswerInput(value);
  if (value.kind === "answerSocialResolution") {
    return hasExactJsonKeys(value, [
      "choice",
      "controllerCharacterId",
      "kind",
      "pendingInputId",
      "rootActionId",
    ])
      && [value.controllerCharacterId, value.pendingInputId, value.rootActionId]
        .every(nonEmptyString)
      && ["press", "acceptStatusQuo"].includes(String(value.choice));
  }
  if (value.kind !== "answerPendingInput") return false;
  if (value.proposal === undefined) {
    return hasExactJsonKeys(value, ["answer", "kind", "pendingInputId", "responseId"])
      && nonEmptyString(value.pendingInputId)
      && nonEmptyString(value.responseId)
      && isJsonRecord(value.answer);
  }
  return hasExactJsonKeys(value, [
    "answer",
    "controllerCharacterId",
    "kind",
    "pendingInputId",
    "proposal",
    "rootActionId",
  ])
    && [value.controllerCharacterId, value.pendingInputId, value.rootActionId].every(nonEmptyString)
    && isJsonRecord(value.answer)
    && isJsonRecord(value.proposal)
    && value.proposal.kind === "executeCausalActionProgram"
    && isCanonicalV3CausalRulesInput(value.proposal);
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
  diagnostics?: readonly RuleDiagnostic[],
): Extract<AuthorityCommitOutcome, { kind: "rejected" }> {
  return { kind: "rejected", code, explanation,
    ...(diagnostics === undefined ? {} : { diagnostics: structuredClone(diagnostics) }) };
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

function hasPendingAuthorityRoot(state: AuthoritativeWorldState, rootActionId: string): boolean {
  const status = state.receipts[rootActionId]?.status;
  if (status === "awaitingInput") return [...Object.values(state.pendingInputs),
    ...Object.values(state.combatRuntime.pendingInputs)].some(pending => pending.rootActionId === rootActionId);
  if (status === "awaitingRandomness") return [...Object.values(state.internalContinuations),
    ...Object.values(state.combatRuntime.randomnessResolutions)].some(pending => pending.rootActionId === rootActionId);
  return false;
}

function compareEventSeq(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function dueActivityRulesInputKind(due: DueActivityDescriptor): "completeActivity" | "advanceTimePassage" | "advanceLongSpellcasting" | "completeLongSpellcasting" | "advanceActivity" | "completeActionActivity" {
  if (due.activityProgress !== undefined) return due.activityProgress.phase !== "complete" ? "advanceActivity"
    : due.activityProgress.completion === "action" ? "completeActionActivity" : "completeActivity";
  if (due.longSpellcasting !== undefined) return due.longSpellcasting.phase === "complete" ? "completeLongSpellcasting" : "advanceLongSpellcasting";
  return due.timePassage === undefined ? "completeActivity" : "advanceTimePassage";
}

export class RoomDurableObject extends DurableObject<Env> {
  private readonly bindings: Env;
  private readonly authorityStore: AuthoritativeRoomStore;
  private readonly rulesRuntime: VersionedRulesRuntime;
  private readonly vnextAdjudicationBridge: RoomVNextAdjudicationBridge | undefined;
  private authorityArchiveDatabaseOverride: D1Database | undefined;
  private authorityDeletionDatabaseOverride: D1Database | undefined;
  private authorityArchiveFlight: Promise<void> | undefined;
  private authoritativeReplayCache: AuthorityReplayCache | undefined;

  constructor(
    ctx: DurableObjectState,
    env: Env,
    rulesRuntime?: VersionedRulesRuntime,
    vnextAdjudicationBridge?: RoomVNextAdjudicationBridge,
  ) {
    super(ctx, env);
    this.bindings = env;
    this.authorityStore = new AuthoritativeRoomStore(ctx.storage);
    this.rulesRuntime = rulesRuntime ?? VNEXT_RULES_RUNTIME;
    this.vnextAdjudicationBridge = vnextAdjudicationBridge ?? VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE;
    ctx.blockConcurrencyWhile(async () => {
      this.authorityStore.ensureSchema();
      // Alarm state is durable, but recomputing the minimum on construction
      // also repairs a crash between persisting an archive task and setAlarm.
      await this.scheduleExpiryAlarm();
    });
  }

  private preparedActionSnapshot(
    submission: AuthoritySubmissionRow,
  ): PreparedAuthoritativeAction | undefined {
    try {
      const prepared = parseJson<PreparedAuthoritativeAction>(submission.prepared_json);
      return prepared.kind === "prepared"
        && prepared.preparedActionId === submission.prepared_action_id
        && prepared.rootActionId === submission.root_action_id
        ? prepared
        : undefined;
    } catch {
      return undefined;
    }
  }

  private validatePreparedReadSet(
    submission: AuthoritySubmissionRow,
    replay: AuthorityReplay,
    phase: RoomVNextReadSetPhase,
    rulesInput: JsonObject,
  ): Extract<AuthorityCommitOutcome, { kind: "rejected" }> | undefined {
    if (this.vnextAdjudicationBridge === undefined) return undefined;
    let actorPlanDue = false;
    if (submission.input_kind === "dueActivity") {
      const work = this.authorityStore.dueWorkByRoot(submission.root_action_id);
      try { actorPlanDue = work !== undefined && parseJson<DueActivityDescriptor>(work.descriptor_json).actorPlan !== undefined; }
      catch { return rejectedAuthority("dueActorPlanIntegrityMismatch", "The persisted due Activity descriptor is invalid."); }
    }
    if (actorPlanDue) {
      // Once randomness is journaled, its validated Rules continuation owns
      // the frozen decision. Before that boundary compare the exact NPC frame
      // again in the transaction that is about to commit effects or dice.
      if (this.authorityStore.proposalRecovery(submission.prepared_action_id) !== undefined) return undefined;
      try {
        const continuation = parseJson<JsonObject>(submission.continuation_json!);
        const due = continuation.dueActivity as unknown as DueActivityDescriptor;
        const request = continuation.actorPlanRequest as unknown as DueActorPlanDecisionRequest;
        const current = this.actorPlanRequest(replay, due);
        if (current !== undefined && vnextCanonicalHash(this.actorPlanProviderInput(current))
          === vnextCanonicalHash(this.actorPlanProviderInput(request))) return undefined;
      } catch { /* The same explicit conflict covers unavailable private state. */ }
      return rejectedAuthority("dueActorPlanContextChanged", "The frozen NPC decision no longer matches its authorized context.");
    }
    const prepared = this.preparedActionSnapshot(submission);
    if (prepared === undefined) {
      return rejectedAuthority(
        "requiredContextIntegrityMismatch",
        "The frozen adjudication context is unavailable.",
      );
    }
    if (prepared.requiredContext === undefined) return undefined;
    try {
      if (
        prepared.requiredContext.binding.preparedActionId !== submission.prepared_action_id
        || prepared.requiredContext.binding.rootActionId !== submission.root_action_id
        || prepared.requiredContext.binding.roomEpochRef !== replay.state.runtimeEpochId
      ) {
        return rejectedAuthority(
          "requiredContextIntegrityMismatch",
          "The frozen adjudication context no longer matches its prepared action.",
        );
      }
      const validation = this.vnextAdjudicationBridge.validateReadSet({
        phase,
        requiredContext: prepared.requiredContext,
        rulesInput,
        profiles: replay.profiles,
        state: replay.state,
        replayHead: replay.replay.head,
      });
      return validation.kind === "valid"
        ? undefined
        : rejectedAuthority(
            "readSetConflict",
            "A fact used by the frozen adjudication changed after this action was prepared.",
          );
    } catch {
      return rejectedAuthority(
        "requiredContextIntegrityMismatch",
        "The frozen adjudication context could not be revalidated.",
      );
    }
  }

  private async scheduleExpiryAlarm() {
    if (this.authorityStore.roomDeletion() !== undefined) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_DELETION_RECONCILE_DELAY_MS);
      return;
    }
    // Safety stops fictional progression. Keep the work durable and re-arm it
    // when the pause is cleared; scheduling an already-due deadline would spin.
    const dueAlarmAt = this.authorityStore.room() !== undefined
      && hasActiveSafetyPause(this.authoritativeReplay().state)
      ? null : this.authorityStore.dueWorkAlarmAt();
    const candidates = [this.authorityStore.archiveAlarmAt(), dueAlarmAt]
      .filter((value): value is number => value !== null);
    if (candidates.length > 0) await this.ctx.storage.setAlarm(Math.max(Date.now() + 100, Math.min(...candidates)));
    else await this.ctx.storage.deleteAlarm();
  }

  private authoritativeReplay(): AuthorityReplay {
    const room = this.authorityStore.room();
    if (room === undefined) throw new Error("authoritative-v2 room has not been initialized");
    const eventHead = this.authorityStore.eventHead();
    const cacheKey: AuthorityReplayCacheKey = {
      roomId: room.room_id,
      moduleId: room.module_id,
      profilesJson: room.profiles_json,
      genesisJson: room.genesis_json,
      stateJson: room.state_json,
      eventCount: eventHead?.eventCount ?? 0,
      eventSeq: eventHead?.eventSeq ?? null,
      eventId: eventHead?.eventId ?? null,
      eventJson: eventHead?.eventJson ?? null,
    };
    if (
      this.authoritativeReplayCache !== undefined
      && sameAuthorityReplayCacheKey(this.authoritativeReplayCache.key, cacheKey)
    ) {
      return structuredClone(this.authoritativeReplayCache.value);
    }
    const genesis = parseJson<RuntimeGenesis>(room.genesis_json);
    const replayed = this.rulesRuntime.replay(genesis, this.authorityStore.events());
    if (replayed.kind !== "replayed") {
      throw new Error(`authoritative-v2 replay rejected: ${replayed.rejection.code}`);
    }
    const value = {
      profiles: replayed.profiles,
      genesis,
      state: replayed.state as AuthoritativeWorldState,
      replay: replayed,
    };
    this.authoritativeReplayCache = {
      key: cacheKey,
      value: structuredClone(value),
    };
    return value;
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
    const reconstructed = this.rulesRuntime.replay(replay.genesis, prefix);
    return reconstructed.kind === "replayed"
      ? reconstructed.state as AuthoritativeWorldState
      : undefined;
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
    const reconstructed = this.rulesRuntime.replay(replay.genesis, prefix);
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

  private authoritativeInheritanceParties(
    authenticated: AuthenticatedAuthorityViewer,
    state: AuthoritativeWorldState,
    successorCharacterId: string,
  ): { predecessorCharacterId: string; successorCharacterId: string } | undefined {
    const successor = state.entities[successorCharacterId];
    const control = state.characterControls[successorCharacterId];
    const seat = control === undefined ? undefined : state.seats[control.seatId];
    if (
      !authenticated.characterIds.includes(successorCharacterId)
      || successor?.kind !== "player"
      || successor.tenureStatus !== "active"
      || control?.characterId !== successorCharacterId
      || seat?.status !== "active"
      || seat.principalId !== authenticated.principalId
      || state.multiplayerRuntime.members[authenticated.principalId]?.status !== "active"
    ) return undefined;

    const predecessorIds = new Set(this.authorityStore.events().flatMap((event) => {
      const payload: unknown = event.payload;
      if (event.eventType !== "SuccessorIntroduced" || !isJsonRecord(payload)) return [];
      const introduced = payload.successor;
      return isJsonRecord(introduced)
        && introduced.id === successorCharacterId
        && payload.controllerSeatId === control.seatId
        && nonEmptyString(payload.predecessorCharacterId)
        ? [payload.predecessorCharacterId]
        : [];
    }));
    if (predecessorIds.size !== 1) return undefined;
    const predecessorCharacterId = [...predecessorIds][0];
    const predecessor = state.entities[predecessorCharacterId];
    if (
      predecessor?.lastControllerSeatId !== control.seatId
      || !["dead", "retired", "missing", "npcTransitioned"].includes(
        String(predecessor?.tenureStatus),
      )
    ) return undefined;
    return { predecessorCharacterId, successorCharacterId };
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

  private timePassageFormerViewer(state: AuthoritativeWorldState, characterId: string, events: EventEnvelope[]): PlayerViewer | undefined {
    if (!events.some(event => {
      const payload: unknown = event.payload;
      if (!["ActivityCompleted", "ActivityInterrupted"].includes(event.eventType)
        || !isJsonRecord(payload) || typeof payload.activityId !== "string") return false;
      const activity = state.campaignRuntime.activities[payload.activityId];
      return activity?.characterId === characterId && isJsonRecord(activity.completion) && activity.completion.kind === "timePassage";
    })) return undefined;
    const character = state.entities[characterId];
    if (character === undefined || !["dead", "retired", "missing", "npcTransitioned"].includes(String(character.tenureStatus))) return undefined;
    const seat = character.lastControllerSeatId === undefined ? undefined : state.seats[character.lastControllerSeatId];
    const principal = seat === undefined ? undefined : state.principals[seat.principalId];
    if (seat?.status !== "active" || principal === undefined) return undefined;
    return { kind: "player", purpose: "lifecycle", principalId: principal.id, sessionVersion: principal.sessionVersion,
      seatId: seat.id, characterId };
  }

  private withTimePassageProcessing(readModel: JsonObject, characterId: string, state: AuthoritativeWorldState): JsonObject {
    if (!Array.isArray(readModel.activities)) return readModel;
    const pending = this.authorityStore.pendingDueWork();
    return { ...readModel, activities: readModel.activities.map(value => {
      if (!isJsonRecord(value) || value.kind !== "timePassage" || value.characterId !== characterId || value.status !== "active") return value;
      const activity = state.campaignRuntime.activities[String(value.activityId)];
      const completion = activity?.completion;
      if (!isJsonRecord(completion) || completion.kind !== "timePassage") return value;
      const obligations = pending.filter(work => {
        const due = parseJson<DueActivityDescriptor>(work.descriptor_json);
        return due.timelineId === completion.sourceTimelineId || due.sceneIds.includes(String(completion.sourceSceneId));
      });
      const unknown = obligations.some(work => {
        const invocation = this.authorityStore.vnextInvocation(work.child_root_action_id, 1);
        return invocation?.status === "retryable" || invocation?.status === "rejected"
          || (invocation?.status === "running" && invocation.lease_until <= Date.now());
      });
      const blocked = value.processingState === "blocked" || obligations.some(work => work.next_attempt_at === null || work.next_attempt_at > Date.now());
      return { ...value, processingState: unknown ? "cannotSafelyContinue" : blocked ? "blocked" : "processing" };
    }) };
  }

  private authorityViewerForCharacter(
    state: AuthoritativeWorldState,
    characterId: string,
  ): (PlayerViewer & { sessionVersion: number }) | undefined {
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
    const projection = this.rulesRuntime.project(replay.profiles, replay.state, viewer, query);
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

  private authoritativeCombatTurnContext(
    state: AuthoritativeWorldState,
    characterId: string,
  ): AuthoritativeCombatTurnContext | undefined {
    const matches = Object.entries(state.combatRuntime.encounters)
      .filter(([encounterId, encounter]) => {
        if (
          encounter.status === "concluded"
          || encounter.encounterId !== encounterId
          || !Array.isArray(encounter.turnOrderEntityIds)
          || !Number.isSafeInteger(encounter.turnCursor)
        ) return false;
        const order = encounter.turnOrderEntityIds.filter(nonEmptyString);
        return order[Number(encounter.turnCursor)] === characterId;
      });
    return matches.length === 1 ? { encounterId: matches[0][0] } : undefined;
  }

  private authoritativeGroupRestMemberIds(
    state: AuthoritativeWorldState,
    characterId: string,
  ): string[] | undefined {
    const matches = Object.values(state.multiplayerRuntime.partyGroups)
      .filter((group) => group.status === "active"
        && Array.isArray(group.memberCharacterIds)
        && group.memberCharacterIds.includes(characterId));
    if (matches.length !== 1) return undefined;
    const memberCharacterIds = matches[0].memberCharacterIds;
    if (!Array.isArray(memberCharacterIds)
      || !memberCharacterIds.every(nonEmptyString)
      || memberCharacterIds.length !== new Set(memberCharacterIds).size) return undefined;
    const invitees = memberCharacterIds
      .filter((candidate): candidate is string => nonEmptyString(candidate) && candidate !== characterId)
      .sort((left, right) => left.localeCompare(right));
    return invitees.length > 0 ? invitees : undefined;
  }

  private authoritativeActiveRestContext(
    state: AuthoritativeWorldState,
    characterId: string,
  ): AuthoritativeRestContext | undefined {
    const matches = Object.entries(state.campaignRuntime.activities)
      .filter(([activityId, activity]) => activity.activityId === activityId
        && activity.status === "active"
        && activity.characterId === characterId
        && (activity.restKind === "short" || activity.restKind === "long"));
    return matches.length === 1 ? { activityId: matches[0][0] } : undefined;
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
      ? this.authorityStore.recoverableDeliveryAudience(viewerKey, this.vnextAdjudicationBridge !== undefined)
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
    const narrationInputMode = deliveryNarrationInputMode(binding);
    if (narrationInputMode === undefined) return undefined;
    if (narrationInputMode === "frozenRenderableClaims-vnext-1") {
      const renderableClaims = deliveryRenderableClaims(binding);
      if (
        renderableClaims === undefined
        || renderableClaims.receiptId !== plan.receiptId
        || renderableClaims.rootActionId !== plan.rootActionId
        || renderableClaims.viewerKey !== audience.viewer_key
        || renderableClaims.projectionHash !== binding.projectionHash
        || !isJsonRecord(binding.kpProjection)
        || !frozenNarrationContextConform(binding.kpProjection.narrationContext, renderableClaims)
        || binding.kpProjection.narrationContext.expression.viewer.characterRef !== viewer.characterId
      ) return undefined;
    }
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
          this.vnextAdjudicationBridge !== undefined,
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
      ? undefined
      : this.viewerNarrationRecoveryProjection(recovery.plan.publishCapability, recovery.audience);
  }

  private viewerNarrationRecoveryProjection(
    capability: string,
    audience: AuthorityDeliveryAudienceRow,
  ): ViewerNarrationRecovery | undefined {
    const state = audience.status;
    if (state !== "pending" && state !== "rejected" && state !== "retryableFailure") return undefined;
    const failureCode = state === "pending" ? undefined : narrationPublicFailureCode(audience.error_code);
    return {
      kind: "available",
      capability,
      state,
      ...(failureCode === undefined ? {} : { failureCode }),
    };
  }

  private earlierFrozenNarrationPending(planRow: AuthorityDeliveryPlanRow,
    binding: DeliveryAudienceBinding): boolean {
    if (deliveryNarrationInputMode(binding) !== "frozenRenderableClaims-vnext-1") return false;
    const first = this.authorityStore.recoverableDeliveryAudience(
      `${binding.principalId}\u001f${binding.characterId}`, true);
    const earlier = first === undefined ? undefined : this.authorityStore.deliveryPlan(first.publish_capability);
    return earlier !== undefined && earlier.active_branch_id === planRow.active_branch_id
      && compareEventSeq(earlier.source_event_seq, planRow.source_event_seq) < 0;
  }

  private viewerNarrationPresentationHold(
    replay: AuthorityReplay,
    viewer: PlayerViewer,
    readModel: unknown,
    narrationRecovery: unknown,
  ): { knowledgeRefs: string[] } | undefined {
    if (narrationRecovery === undefined || !isJsonRecord(readModel)) return undefined;
    const knowledge = Array.isArray(readModel.knowledge)
      ? readModel.knowledge.filter(isJsonRecord)
      : [];
    const viewerKey = `${viewer.principalId}\u001f${viewer.characterId}`;
    const watermark = this.authorityStore.deliveryWatermark(viewerKey) ?? "0";
    const eventPrefix = `event:${replay.state.runtimeEpochId}:`;
    const knowledgeRefs = knowledge.flatMap((entry) => {
      if (!nonEmptyString(entry.knowledgeRef)
        || !nonEmptyString(entry.acquiredByEventId)
        || !entry.acquiredByEventId.startsWith(eventPrefix)) return [];
      const eventSeq = entry.acquiredByEventId.slice(eventPrefix.length);
      return /^[0-9]+$/u.test(eventSeq) && compareEventSeq(eventSeq, watermark) > 0
        ? [entry.knowledgeRef]
        : [];
    });
    return knowledgeRefs.length === 0
      ? undefined
      : { knowledgeRefs: [...new Set(knowledgeRefs)].sort() };
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
      const sceneIds = uniqueSceneIds(frame.sceneIds);
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
    const kpProjection = this.rulesRuntime.project(replay.profiles, replay.state, kpViewer);
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
      const projection = this.rulesRuntime.project(replay.profiles, replay.state, viewer);
      if (projection.kind === "rejected") return undefined;
      npcViewers[npc.id] = projection as unknown as JsonObject;
    }
    return {
      ...moduleProjection,
      kind: kpProjection.kind,
      runtimeProfiles: structuredClone(kpProjection.runtimeProfiles),
      stateVersion: kpProjection.stateVersion,
      activeBranchId: kpProjection.activeBranchId,
      projectionHash: kpProjection.projectionHash,
      viewer: structuredClone(kpProjection.viewer),
      actorProjection: roomPlayerProjection(actorProjection, actorViewer.characterId),
      npcViewers,
      ...(kpProjection.adjudicationPrecedents === undefined
        ? {}
        : { adjudicationPrecedents: kpProjection.adjudicationPrecedents }),
      ...(kpProjection.npcMechanicalDefinitions === undefined
        ? {}
        : { npcMechanicalDefinitions: kpProjection.npcMechanicalDefinitions }),
      ...(kpProjection.itemDefinitions === undefined
        ? {}
        : { itemDefinitions: kpProjection.itemDefinitions }),
      ...(kpProjection.dynamicAuthoritativeFacts === undefined
        ? {}
        : { dynamicAuthoritativeFacts: kpProjection.dynamicAuthoritativeFacts }),
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
      const projection = this.rulesRuntime.project(replay.profiles, replay.state, viewer);
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
    if (
      hasUnsettledAuthoritativeRandomness(replay.state)
      || this.authorityStore.hasSuspendedActionStage()
      || this.authorityStore.pendingDueWork().length > 0
    ) {
      throw new AuthorityArchiveSettlementPendingError();
    }
    const events = this.authorityStore.events();
    const receiptRefs = await this.authorityReceiptReferences();
    const projectionAudits = await this.authorityProjectionAudits(replay);
    const current = this.authoritativeReplay();
    if (
      hasUnsettledAuthoritativeRandomness(current.state)
      || this.authorityStore.hasSuspendedActionStage()
      || this.authorityStore.pendingDueWork().length > 0
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
    }, this.rulesRuntime.replay);
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
      const result = await appendAuthoritativeArchiveToD1(db, archive, work.progress, this.rulesRuntime.replay);
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
        // action settling DO-local randomness or an in-flight ActorPlan
        // continuation. Keep the archive dirty but do not spin alarms; the
        // settlement transaction marks it runnable again.
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
    const hasVNextSeed = Object.hasOwn(input, "vNextSeed");
    const vNextSeed = input.vNextSeed;
    if (
      hasVNextSeed
      && (
        this.vnextAdjudicationBridge === undefined
        || !isJsonRecord(vNextSeed)
        || !hasExactJsonKeys(vNextSeed, [
          "entityDefinitionBindings",
          "itemDefinitions",
          "itemEntries",
          "semanticDefinitions",
        ])
        || !Array.isArray(vNextSeed.semanticDefinitions)
        || !vNextSeed.semanticDefinitions.every(isJsonRecord)
        || !Array.isArray(vNextSeed.itemDefinitions)
        || !vNextSeed.itemDefinitions.every(isJsonRecord)
        || !Array.isArray(vNextSeed.itemEntries)
        || !vNextSeed.itemEntries.every(isJsonRecord)
        || !Array.isArray(vNextSeed.entityDefinitionBindings)
        || !vNextSeed.entityDefinitionBindings.every(isJsonRecord)
      )
    ) {
      return rejectedAuthority(
        "invalidInitialization",
        "The isolated vNext seed is unavailable or is not a closed JSON container.",
      );
    }
    if (vNextSeed !== undefined) {
      try {
        await authorityHash(vNextSeed);
      } catch {
        return rejectedAuthority(
          "invalidInitialization",
          "The isolated vNext seed must contain canonical JSON values.",
        );
      }
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
    const existing = this.authorityStore.room();
    if (existing !== undefined) {
      if (existing.room_id !== input.roomId || existing.module_id !== input.moduleId) {
        return rejectedAuthority(
          "roomAlreadyBound",
          "The Durable Object is already bound to a different authoritative room.",
        );
      }
      let replay: AuthorityReplay;
      try {
        replay = this.authoritativeReplay();
      } catch {
        return rejectedAuthority(
          "roomAlreadyBound",
          "The existing room is not a supported current 0.4 authority epoch.",
        );
      }
      if (!exactProfileRef(replay.genesis.moduleRef, moduleProfile.moduleRef)) {
        return rejectedAuthority(
          "roomAlreadyBound",
          "The Durable Object is already bound to a different Module Profile.",
        );
      }
      return {
        created: false,
        runtimeEpochId: replay.genesis.runtimeEpochId,
        genesisHash: replay.genesis.genesisHash,
        moduleRef: structuredClone(replay.genesis.moduleRef),
        runtimeProfiles: structuredClone(replay.profiles),
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
    const catalogHash = await authorityHash({
      kind: "initialDefinitionCatalog",
      moduleId: input.moduleId,
      version: "authoritative-v2",
    });
    const runtimeEpochId = randomId("runtime-epoch");
    const openingSceneId = moduleProfile.storyBible.storyAnchors.chapters[0]?.sceneIds[0];
    const openingLocation = openingSceneId === undefined
      ? undefined
      : moduleProfile.storyBible.storyAnchors.locations.find((location) => location.sceneId === openingSceneId);
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
    if (moduleProfile.moduleVersion === SOCIAL_RESOLUTION_MODULE_VERSION
      && sceneIds.some((sceneId) => locationBySceneId.get(sceneId)?.tacticalGeometry === undefined)) {
      return rejectedAuthority(
        "invalidInitialization",
        "Every initial tactical scene must be defined by the pinned Module Profile.",
      );
    }
    const vnextInitialization = input.runtimeProfiles === undefined
      ? this.vnextAdjudicationBridge !== undefined
      : worldInteractionProfileEnabled(input.runtimeProfiles.extensions);
    const scenes = sceneIds.map((sceneId) => {
      const location = locationBySceneId.get(sceneId);
      return {
        id: sceneId,
        name: location?.name ?? sceneId,
        ...(vnextInitialization ? { publicTone: moduleProfile.tone } : {}),
        ...(location?.tacticalGeometry === undefined
          ? {}
          : { geometry: structuredClone(location.tacticalGeometry) }),
      };
    });
    const suppliedSeed = vNextSeed as {
      semanticDefinitions: JsonRecord[]; itemDefinitions: JsonRecord[]; itemEntries: JsonRecord[];
      entityDefinitionBindings: JsonRecord[];
    } | undefined;
    const moduleNpcSeeds = vnextInitialization
      ? moduleNpcSemanticSeeds(moduleProfile).filter(({ binding }) => !suppliedSeed?.entityDefinitionBindings
        .some(existing => existing.entityRef === binding.entityRef))
      : [];
    const initializationSeed = moduleNpcSeeds.length === 0 ? suppliedSeed : {
      semanticDefinitions: [...(suppliedSeed?.semanticDefinitions ?? []), ...moduleNpcSeeds.map(entry => entry.definition)],
      entityDefinitionBindings: [...(suppliedSeed?.entityDefinitionBindings ?? []), ...moduleNpcSeeds.map(entry => entry.binding)],
      itemDefinitions: suppliedSeed?.itemDefinitions ?? [],
      itemEntries: suppliedSeed?.itemEntries ?? [],
    };
    const initialized = this.rulesRuntime.step(input.runtimeProfiles, undefined, {
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
            ...(vnextInitialization && npc.voice.trim()
              ? { publicExpression: { voice: npc.voice.trim(), attitude: null } } : {}),
            sceneId: npc.startSceneId,
            tenureStatus: "active" as const,
            ...(npc.socialMechanics === undefined
              ? {}
              : {
                  abilityScores: structuredClone(npc.socialMechanics.abilityScores),
                  proficiencyBonus: npc.socialMechanics.proficiencyBonus,
                  socialMechanics: structuredClone(npc.socialMechanics),
                }),
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
      canonicalFacts: [
        ...fixtures.canonicalFacts,
        ...moduleAuthorityFactSeeds(moduleProfile).map((fact) => ({
          ...fact,
          subjectRefs: [...fact.subjectRefs],
          value: structuredClone(fact.value),
        })),
      ],
      initialKnowledge: [
        ...fixtures.initialKnowledge,
        // The pinned public opening was actually experienced by these initial
        // characters. Preserve that evidence in genesis, independently of ACK
        // and transient delivery, without granting module truths or NPC minds.
        ...(openingLocation === undefined ? [] : input.characters
          .filter((character) => character.staticCard.sceneId === openingLocation.sceneId)
          .map((character) => ({
            characterId: character.characterId,
            knowledgeRef: `${character.characterId}:module-opening:${openingLocation.sceneId}`,
            kind: "sensoryEvidence" as const,
            layer: "full" as const,
            content: {
              schema: "zhuwei.module-opening-knowledge/v1",
              moduleRef: structuredClone(moduleProfile.moduleRef),
              sceneId: openingLocation.sceneId,
              description: openingLocation.publicOpening,
            },
            visibility: "private" as const,
            provenanceChain: [`genesis:module-opening:${openingLocation.sceneId}`,
              moduleProfile.moduleRef.profileId, moduleProfile.moduleRef.profileHash],
          }))),
      ],
      ...(initializationSeed === undefined ? {} : { vNextSeed: structuredClone(initializationSeed) }),
    });
    if (initialized.kind !== "initialized") {
      return initialized.kind === "rejected"
        ? rejectedAuthority(initialized.rejection.code, initialized.rejection.message)
        : rejectedAuthority("invalidRulesResult", "Rules did not return an initialization result.");
    }
    const replayed = this.rulesRuntime.replay(initialized.genesis, []);
    if (replayed.kind !== "replayed") {
      return rejectedAuthority(replayed.rejection.code, replayed.rejection.message);
    }
    const initialState = replayed.state as AuthoritativeWorldState;

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
        const projection = this.rulesRuntime.project(initialized.profiles, initialState, viewer);
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
            narrationPolicyVersion: BODY_ONLY_NARRATION_POLICY_VERSION,
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
        let replay: AuthorityReplay;
        try {
          replay = this.authoritativeReplay();
        } catch {
          return rejectedAuthority(
            "roomAlreadyBound",
            "The existing authoritative room is not a valid current 0.4 room.",
          );
        }
        if (!exactProfileRef(replay.genesis.moduleRef, moduleProfile.moduleRef)) {
          return rejectedAuthority(
            "roomAlreadyBound",
            "The Durable Object is already bound to a different Module Profile.",
          );
        }
        return {
          created: false,
          runtimeEpochId: replay.genesis.runtimeEpochId,
          genesisHash: replay.genesis.genesisHash,
          moduleRef: structuredClone(replay.genesis.moduleRef),
          runtimeProfiles: replay.profiles,
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
        moduleRef: structuredClone(moduleProfile.moduleRef),
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
    const stepped = this.rulesRuntime.step(
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
    const unsettledRandomness = hasUnsettledAuthoritativeRandomness(replay.state);
    const pendingPlayerRollOwners = unsettledRandomness
      ? this.authorityPendingPlayerRollOwnerIds(replay)
      : new Set<string>();
    const transfersEveryPendingPlayerRoll = changedControlCharacterIds.length > 0
      && unsettledRandomness
      && pendingPlayerRollOwners.size === changedControlCharacterIds.length
      && normalized.command.kind === "transferControl"
      && changedControlCharacterIds.every((characterId) => {
        if (!pendingPlayerRollOwners.has(characterId)) return false;
        const nextControl = stepped.state.characterControls[characterId];
        const nextSeat = nextControl === undefined
          ? undefined
          : stepped.state.seats[nextControl.seatId];
        return nextSeat?.status === "active"
          && stepped.state.multiplayerRuntime.members[nextSeat.principalId]?.status === "active";
      });
    if (changedControlCharacterIds.length > 0
      && unsettledRandomness
      && !transfersEveryPendingPlayerRoll) {
      return {
        kind: "retryableFailure" as const,
        code: "roomAdministrationRandomnessSettlementPending",
      };
    }
    const scopeId = "room:administration";
    // A control transfer for the exact pending player-roll owner changes who
    // may authorize the gesture, not the frozen scene mechanics. Keeping that
    // scene scope stable lets the new controller finish the same journaled
    // request without re-proposal or re-roll.
    const changedControlSceneScopes = transfersEveryPendingPlayerRoll ? [] : [...new Set(changedControlCharacterIds.flatMap(
      (characterId) => [
        replay.state.entities[characterId]?.sceneId,
        stepped.state.entities[characterId]?.sceneId,
      ].filter(nonEmptyString).map((sceneId) => `scene:${sceneId}`),
    ))].sort();
    if (this.authorityStore.hasSuspendedActionStageInScopes(changedControlSceneScopes)) {
      return {
        kind: "retryableFailure" as const,
        code: "roomAdministrationActionSettlementPending",
      };
    }
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
      this.appendAuthorityTransition(stepped.state, stepped.events);
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

  private async resumeUnfinishedAuthoritySubmission(
    context: TrustedPrincipalContext,
    replay: AuthorityReplay,
    existing: AuthoritySubmissionRow,
    actorPlanTransport?: ActorPlanTransport,
  ): Promise<AuthorityCommitOutcome | PreparedAuthoritativeAction> {
    const staged = this.authorityStore.actionStage(existing.prepared_action_id);
    if (existing.status === "prepared" && staged?.status === "committed") {
      return parseJson<PreparedAuthoritativeAction>(existing.prepared_json);
    }
    const npcDecision = this.authorityStore.npcDecision(existing.prepared_action_id);
    if (npcDecision !== undefined && existing.result_json === null) {
      if (npcDecision.answer_json === null) return this.npcDecisionOutcome(existing, npcDecision);
      const canonical = parseJson<JsonObject>(npcDecision.input_json);
      return this.withDueTail(await this.commitAuthoritative(context, existing.prepared_action_id, {
        kind: "canonicalInput", proposalHash: npcDecision.proposal_hash,
        input: canonical.input as JsonObject,
        ...(isJsonRecord(canonical.receiptExtras) ? { receiptExtras: canonical.receiptExtras } : {}),
        ...(canonical.forceConcluded === true ? { forceConcluded: true } : {}),
        ...(nonEmptyString(canonical.answeredPendingInputId) ? { answeredPendingInputId: canonical.answeredPendingInputId } : {}),
      }), actorPlanTransport);
    }
    if (
      existing.status === "prepared"
      && staged?.status === "prepared"
      && staged.proposal_hash !== null
      && staged.result_json !== null
    ) {
      return parseJson<AuthorityCommitOutcome>(staged.result_json);
    }
    if (hasActiveSafetyPause(replay.state)
      && existing.input_kind !== "safetyPause"
      && existing.input_kind !== "safetyAdjust") {
      return presentationUnavailable();
    }
    const recovery = this.authorityStore.proposalRecovery(existing.prepared_action_id)
      ?? (staged?.status === "prepared"
        ? this.authorityStore.proposalRecovery(staged.child_root_action_id)
        : undefined);
    if (recovery !== undefined) {
      return this.withDueTail(await this.commitAuthoritative(
        context,
        existing.prepared_action_id,
        { kind: "recovery", row: recovery },
      ), actorPlanTransport);
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

  async beginVNextProposalInvocation(
    context: TrustedPrincipalContext,
    preparedActionId: string,
    input: VNextInvocationRequest,
  ): Promise<VNextInvocationStart> {
    if (this.authorityStore.roomDeletion() !== undefined || this.vnextAdjudicationBridge === undefined) {
      return { kind: "rejected", code: "PROPOSAL_REFERENCE_INVALID" };
    }
    const replay = this.authoritativeReplay();
    const authenticated = this.authenticatedAuthorityViewer(context, replay.state);
    const submission = this.authorityStore.submissionByPrepared(preparedActionId);
    const prepared = submission === undefined ? undefined : this.preparedActionSnapshot(submission);
    if (authenticated === undefined || submission?.principal_id !== authenticated.principalId
      || !authenticated.characterIds.includes(submission.character_id)
      || prepared?.requiredContext?.binding.contextHash !== input.contextHash
      || !worldInteractionProfileEnabled(replay.profiles.extensions ?? [])
      || input.bindingHash !== VNEXT_KP_WORKFLOW_HASH
      || (input.ordinal !== 1 && input.ordinal !== 2 && input.ordinal !== 3 && input.ordinal !== 4)
      || !isJsonRecord(input.request) || vnextCanonicalHash(input.request) !== input.requestHash) {
      return { kind: "rejected", code: "PROPOSAL_REFERENCE_INVALID" };
    }
    return this.ctx.storage.transactionSync((): VNextInvocationStart => {
      const existing = this.authorityStore.vnextInvocation(preparedActionId, input.ordinal);
      try {
        assertVNextInvocationTransition(input, ordinal => this.authorityStore.vnextInvocation(preparedActionId, ordinal), prepared.requiredContext!);
      } catch { return { kind: "rejected", code: "PROPOSAL_REPAIR_EXHAUSTED" }; }
      if (existing !== undefined) {
        if (existing.context_hash !== input.contextHash || existing.binding_hash !== input.bindingHash
          || existing.request_hash !== input.requestHash
          || existing.repair_ticket_json !== (input.repairTicket === undefined ? null : JSON.stringify(input.repairTicket))) {
          return { kind: "rejected", code: "PROPOSAL_REPAIR_EXHAUSTED" };
        }
        if (existing.status === "completed") return { kind: "completed", response: JSON.parse(existing.response_json!) };
        if (existing.status === "rejected") return { kind: "rejected", code: "PROPOSAL_PROVIDER_CONFIGURATION" };
        if (existing.status === "running" && existing.lease_until > Date.now()) {
          return { kind: "retryableFailure", code: "PROPOSAL_INVOCATION_IN_PROGRESS" };
        }
        if (existing.status === "retryable" && existing.lease_until > Date.now()) {
          return { kind: "retryableFailure", code: "PROPOSAL_PROVIDER_TIMEOUT",
            retryAfter: Math.ceil((existing.lease_until - Date.now()) / 1_000) };
        }
      }
      if (submission.status !== "prepared" || submission.proposal_hash !== null) {
        return { kind: "rejected", code: "PROPOSAL_REFERENCE_INVALID" };
      }
      const capability = crypto.randomUUID();
      this.authorityStore.saveVnextInvocation({
        prepared_action_id: preparedActionId, ordinal: input.ordinal,
        context_hash: input.contextHash, binding_hash: input.bindingHash,
        request_hash: input.requestHash, request_json: JSON.stringify(input.request),
        repair_ticket_json: input.repairTicket === undefined ? null : JSON.stringify(input.repairTicket),
        capability, lease_until: Date.now() + 60_000, status: "running", response_json: null,
      });
      return { kind: "ready", capability };
    });
  }

  async completeVNextProposalInvocation(
    context: TrustedPrincipalContext,
    preparedActionId: string,
    input: VNextInvocationCompletion,
  ): Promise<{ kind: "saved" } | { kind: "rejected"; code: string }> {
    const replay = this.authoritativeReplay();
    const authenticated = this.authenticatedAuthorityViewer(context, replay.state);
    const submission = this.authorityStore.submissionByPrepared(preparedActionId);
    if (this.authorityStore.roomDeletion() !== undefined || authenticated === undefined
      || submission?.principal_id !== authenticated.principalId
      || !authenticated.characterIds.includes(submission.character_id)) {
      return { kind: "rejected", code: "PROPOSAL_REFERENCE_INVALID" };
    }
    return this.ctx.storage.transactionSync(() => {
      const row = this.authorityStore.vnextInvocation(preparedActionId, input.ordinal);
      if (row === undefined || row.capability !== input.capability || row.request_hash !== input.requestHash) {
        return { kind: "rejected" as const, code: "PROPOSAL_REFERENCE_INVALID" };
      }
      if (row.status === "completed") return { kind: "saved" as const };
      if (row.status !== "running" || !["completed", "retryable", "rejected"].includes(input.result.kind)) {
        return { kind: "rejected" as const, code: "PROPOSAL_REFERENCE_INVALID" };
      }
      if (input.result.kind === "completed") {
        this.authorityStore.saveVnextInvocation({ ...row,
          status: "completed", response_json: JSON.stringify(input.result.response),
        });
      } else {
        const retryAfter = input.result.kind === "retryable"
          ? vnextInvocationRetryAfter(input.result.retryAfter) : undefined;
        const code = input.result.kind === "retryable"
          ? "PROPOSAL_PROVIDER_TIMEOUT" : "PROPOSAL_PROVIDER_CONFIGURATION";
        this.authorityStore.saveVnextInvocation({ ...row,
          status: input.result.kind, lease_until: Date.now() + (retryAfter ?? 0) * 1_000,
          response_json: JSON.stringify({ code, ...(retryAfter === undefined ? {} : { retryAfter }) }),
        });
      }
      return { kind: "saved" as const };
    });
  }

  async prepare(context: TrustedPrincipalContext, actionInput: AuthoritativeActionInput, actorPlanTransport?: ActorPlanTransport) {
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
        return this.withDueTail(result, actorPlanTransport);
      }
      return this.resumeUnfinishedAuthoritySubmission(context, replay, existing, actorPlanTransport);
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
    } else if (actionInput.kind === "party") {
      if (!hasOnlyJsonKeys(actionInput, ["kind", "submissionId", "command"], ["displayText"])
        || (actionInput.displayText !== undefined && !nonEmptyString(actionInput.displayText))
        || !isPartyCommand(actionInput.command)) {
        return rejectedAuthority("invalidActionInput", "A closed party command is required.");
      }
      canonicalActionInput = {
        kind: "party",
        submissionId: actionInput.submissionId,
        command: structuredClone(actionInput.command),
        ...(actionInput.displayText === undefined ? {} : { displayText: actionInput.displayText }),
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
    } else if (actionInput.kind === "itemActivity") {
      if (
        !hasExactJsonKeys(actionInput, ["itemEntryId", "kind", "submissionId"])
        || !nonEmptyString(actionInput.itemEntryId)
      ) {
        return rejectedAuthority(
          "invalidActionInput",
          "A closed item-entry activity selection is required.",
        );
      }
      canonicalActionInput = {
        kind: "itemActivity",
        submissionId: actionInput.submissionId,
        itemEntryId: actionInput.itemEntryId,
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
    } else if (actionInput.kind === "combatEndTurn") {
      if (!hasExactJsonKeys(actionInput, ["kind", "submissionId"])) {
        return rejectedAuthority("invalidActionInput", "Combat end turn accepts only submissionId.");
      }
      canonicalActionInput = {
        kind: "combatEndTurn",
        submissionId: actionInput.submissionId,
      };
    } else if (actionInput.kind === "restStart") {
      const arcaneRecoverySlotLevels = actionInput.arcaneRecoverySlotLevels;
      if (
        !hasExactJsonKeys(actionInput, [
          "arcaneRecoverySlotLevels",
          "hitDiceToSpend",
          "kind",
          "mode",
          "restKind",
          "submissionId",
        ])
        || (actionInput.restKind !== "short" && actionInput.restKind !== "long")
        || (actionInput.mode !== "personal" && actionInput.mode !== "group")
        || !Number.isSafeInteger(actionInput.hitDiceToSpend)
        || actionInput.hitDiceToSpend < 0
        || actionInput.hitDiceToSpend > 20
        || !Array.isArray(arcaneRecoverySlotLevels)
        || arcaneRecoverySlotLevels.length > 20
        || !arcaneRecoverySlotLevels.every((level) =>
          Number.isSafeInteger(level) && level >= 1 && level <= 5)
        || (actionInput.restKind === "long"
          && (actionInput.hitDiceToSpend !== 0 || arcaneRecoverySlotLevels.length !== 0))
      ) {
        return rejectedAuthority("invalidActionInput", "A closed canonical rest selection is required.");
      }
      canonicalActionInput = {
        kind: "restStart",
        submissionId: actionInput.submissionId,
        restKind: actionInput.restKind,
        mode: actionInput.mode,
        hitDiceToSpend: actionInput.hitDiceToSpend,
        arcaneRecoverySlotLevels: [...arcaneRecoverySlotLevels]
          .sort((left, right) => left - right),
      };
    } else if (actionInput.kind === "activityControl") {
      if (!hasExactJsonKeys(actionInput, ["kind", "submissionId", "activityId", "attentionRootActionId", "decision"])
        || !nonEmptyString(actionInput.activityId) || !nonEmptyString(actionInput.attentionRootActionId)
        || !["continue", "stop"].includes(actionInput.decision)) return rejectedAuthority("invalidActionInput", "Activity control requires the current decision point.");
      canonicalActionInput = { ...actionInput };
    } else if (actionInput.kind === "restInterrupt") {
      if (!hasExactJsonKeys(actionInput, ["kind", "submissionId"])) {
        return rejectedAuthority("invalidActionInput", "Rest interruption accepts only submissionId.");
      }
      canonicalActionInput = {
        kind: "restInterrupt",
        submissionId: actionInput.submissionId,
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
      if (existing.result_json !== null) return this.withDueTail(parseJson(existing.result_json), actorPlanTransport);
      return this.resumeUnfinishedAuthoritySubmission(context, replay, existing, actorPlanTransport);
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
    if (
      !["safetyPause", "safetyAdjust"].includes(actionInput.kind)
      && !(this.vnextAdjudicationBridge !== undefined && actionInput.kind === "intent")
      && this.viewerPendingPlayerRolls(replay, authenticated).length > 0
    ) {
      return rejectedAuthority(
        "pendingInputUnresolved",
        "The authorized dice request must be resolved before another action can change the scene.",
      );
    }
    if (actionInput.kind === "intent" && this.vnextAdjudicationBridge === undefined
      && Object.values(replay.state.pendingInputs).some((pending) =>
        pending.kind === "socialResolution"
        && authenticated.characterIds.includes(pending.controllerCharacterId))) {
      return rejectedAuthority(
        "pendingInputUnresolved",
        "The open social offer must be pressed, accepted, or reframed through its pending answer.",
      );
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
      actionInput.kind === "party"
      || actionInput.kind === "gear"
      || actionInput.kind === "itemActivity"
      || actionInput.kind === "environmentInteract"
      || actionInput.kind === "environmentAbility"
      || actionInput.kind === "movement"
      || actionInput.kind === "combatEndTurn"
      || actionInput.kind === "restStart"
      || actionInput.kind === "restInterrupt"
      || actionInput.kind === "activityControl"
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
        if (replay.state.frozenPlayerChoices?.[actionInput.pendingInputId] !== undefined) {
          if (pendingProjection.kind !== "playerChoice" || frozenPlayerChoiceAnswer(replay.state,
            { rootActionId, controllerCharacterId: characterId, pendingInputId: actionInput.pendingInputId }, actionInput.answer) === undefined)
            return rejectedAuthority("invalidPendingResolution", "The frozen choice requires one of its saved choice IDs.");
          resolutionMode = "authorityDirect";
        } else if ([
          "advancementChoice",
          "combatChoice",
          "groupRestConsent",
          "partyInvitation",
          "partyMoveConsent",
        ].includes(String(pendingProjection.kind))) {
          resolutionMode = "authorityDirect";
        } else if (
          pendingProjection.kind === "socialResolution"
          && isJsonRecord(actionInput.answer)
          && hasExactJsonKeys(actionInput.answer, ["choice"])
          && ["press", "acceptStatusQuo"].includes(String(actionInput.answer.choice))
        ) {
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
    const combatTurnContext = actionInput.kind === "combatEndTurn"
      ? this.authoritativeCombatTurnContext(replay.state, characterId)
      : undefined;
    if (actionInput.kind === "combatEndTurn" && combatTurnContext === undefined) {
      return rejectedAuthority(
        "privateOrUnknownReference",
        "The controlled character does not hold an authoritative combat turn.",
      );
    }
    const groupRestMemberIds = actionInput.kind === "restStart" && actionInput.mode === "group"
      ? this.authoritativeGroupRestMemberIds(replay.state, characterId)
      : undefined;
    if (actionInput.kind === "restStart"
      && actionInput.mode === "group"
      && groupRestMemberIds === undefined) {
      return rejectedAuthority(
        "privateOrUnknownReference",
        "No eligible PartyGroup is available for a group rest.",
      );
    }
    const activeRestContext = actionInput.kind === "restInterrupt"
      ? this.authoritativeActiveRestContext(replay.state, characterId)
      : undefined;
    if (actionInput.kind === "restInterrupt" && activeRestContext === undefined) {
      return rejectedAuthority(
        "privateOrUnknownReference",
        "The controlled character has no active rest to interrupt.",
      );
    }

    if (actionInput.kind === "activityControl") {
      const activity = replay.state.campaignRuntime.activities[actionInput.activityId];
      if (activity === undefined || activity.characterId !== characterId || !activityProgressAvailable(replay.state, activity)
        || !isJsonRecord(activity.attention) || activity.attention.rootActionId !== actionInput.attentionRootActionId) {
        return rejectedAuthority("privateOrUnknownReference", "The activity decision is unavailable to this controller or in combat.");
      }
    }
    const viewer = this.authorityPlayerViewer(authenticated, replay.state, characterId);
    const moduleProfile = await this.pinnedAuthorityModule(replay);
    let dueActorPlan: JsonObject | undefined;
    let dueActorPlanChildRootActionId: string | undefined;
    let dueActorPlanProjection: JsonObject | undefined;
    if (actionInput.kind === "intent" && this.vnextAdjudicationBridge === undefined) {
      const dueProjection = this.rulesRuntime.project(
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
    const preparedActionId = `prepared-action:${actionInput.submissionId}`;
    let requiredContext: PreparedAuthoritativeAction["requiredContext"];
    // Only KP decisions need a frozen model context. The canonical branches
    // above assign authorityDirect after validating registered button/answer
    // inputs; those retain the existing authenticated Rules commit path.
    if (this.vnextAdjudicationBridge !== undefined && resolutionMode !== "authorityDirect") {
      let contextResult: ReturnType<RoomVNextAdjudicationBridge["prepareRequiredContext"]>;
      try {
        contextResult = this.vnextAdjudicationBridge.prepareRequiredContext({
          actionInput: structuredClone(canonicalActionInput) as AuthoritativeActionInput,
          preparedActionId,
          rootActionId,
          actorCharacterId: characterId,
          profiles: replay.profiles,
          state: replay.state,
          replayHead: replay.replay.head,
          kpProjection,
          moduleProfile,
        });
      } catch {
        return rejectedAuthority(
          "requiredContextUnavailable",
          "The required adjudication context could not be frozen.",
        );
      }
      if (contextResult.kind === "rejected") {
        return rejectedAuthority(contextResult.code, contextResult.explanation);
      }
      if (contextResult.kind === "accepted") {
        if (!requiredContextMatchesPreparedAction(contextResult.requiredContext, {
          preparedActionId,
          rootActionId,
          roomEpochRef: replay.state.runtimeEpochId,
          baseEventSeq: replay.replay.head.eventSeq,
        })) {
          return rejectedAuthority(
            "requiredContextIntegrityMismatch",
            "The frozen adjudication context has an invalid authority binding.",
          );
        }
        try {
          await authorityHash(contextResult.requiredContext);
        } catch {
          return rejectedAuthority(
            "requiredContextIntegrityMismatch",
            "The frozen adjudication context is not canonical JSON.",
          );
        }
        requiredContext = structuredClone(contextResult.requiredContext);
      }
    }
    const prepared: PreparedAuthoritativeAction = {
      kind: "prepared",
      preparedActionId,
      rootActionId,
      kpProjection,
      ...(requiredContext === undefined ? {} : { requiredContext }),
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
          : actionInput.kind === "party"
            ? { continuation: { command: structuredClone(actionInput.command),
                ...(actionInput.displayText === undefined ? {} : { displayText: actionInput.displayText }) } }
          : actionInput.kind === "gear"
            ? {
                continuation: {
                  action: actionInput.action,
                  slot: actionInput.slot,
                  ...(actionInput.action === "wear" ? { itemId: actionInput.itemId } : {}),
                },
              }
            : actionInput.kind === "itemActivity"
              ? {
                  continuation: {
                    itemEntryId: actionInput.itemEntryId,
                    parameters: { targetEntityId: characterId },
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
            : actionInput.kind === "combatEndTurn"
              ? {
                  continuation: {
                    encounterId: combatTurnContext!.encounterId,
                  },
                }
            : actionInput.kind === "restStart"
              ? {
                  continuation: {
                    restKind: actionInput.restKind,
                    mode: actionInput.mode,
                    hitDiceToSpend: actionInput.hitDiceToSpend,
                    arcaneRecoverySlotLevels: structuredClone(
                      actionInput.arcaneRecoverySlotLevels,
                    ),
                    ...(actionInput.mode === "group"
                      ? { memberCharacterIds: structuredClone(groupRestMemberIds!) }
                      : {}),
                  },
                }
            : actionInput.kind === "activityControl"
              ? { continuation: { activityId: actionInput.activityId, attentionRootActionId: actionInput.attentionRootActionId, decision: actionInput.decision } }
            : actionInput.kind === "restInterrupt"
              ? {
                  continuation: {
                    activityId: activeRestContext!.activityId,
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
    if (submission.principal_id === null) {
      return { rejection: rejectedAuthority("preparedActionUnauthorized", "A system Activity cannot accept an external proposal.") };
    }
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
      isJsonRecord(proposalValue)
      && proposalValue.kind === "authenticatedItemActivity"
      && hasExactJsonKeys(proposalValue, ["kind", "rootActionId"])
      && submission.input_kind === "itemActivity"
      && submission.continuation_json !== null
    ) {
      const continuation = parseJson<JsonObject>(submission.continuation_json);
      const itemEntryId = nonEmptyString(continuation.itemEntryId)
        ? continuation.itemEntryId
        : undefined;
      if (
        !hasExactJsonKeys(continuation, ["itemEntryId", "parameters"])
        || itemEntryId === undefined
        || !isJsonRecord(continuation.parameters)
        || !hasExactJsonKeys(continuation.parameters, ["targetEntityId"])
        || continuation.parameters.targetEntityId !== submission.character_id
      ) {
        return {
          rejection: rejectedAuthority(
            "invalidMechanicalProposal",
            "The prepared item activity is unavailable.",
          ),
        };
      }
      return {
        input: {
          kind: "invokeItemActivity",
          rootActionId: submission.root_action_id,
          sourceEntityId: submission.character_id,
          itemEntryId,
          parameters: structuredClone(continuation.parameters),
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
    if (
      proposalValue.kind === "authenticatedCombatEndTurn"
      && hasExactJsonKeys(proposalValue, ["kind", "rootActionId"])
      && submission.input_kind === "combatEndTurn"
      && submission.continuation_json !== null
    ) {
      const continuation = parseJson<JsonObject>(submission.continuation_json);
      const combatTurnContext = this.authoritativeCombatTurnContext(
        state,
        submission.character_id,
      );
      if (
        !hasExactJsonKeys(continuation, ["encounterId"])
        || !nonEmptyString(continuation.encounterId)
        || combatTurnContext?.encounterId !== continuation.encounterId
      ) {
        return {
          rejection: rejectedAuthority(
            "privateOrUnknownReference",
            "The prepared combat turn is no longer available.",
          ),
        };
      }
      return {
        input: {
          kind: "endTurn",
          rootActionId: submission.root_action_id,
          encounterId: continuation.encounterId,
          sourceEntityId: submission.character_id,
        },
      };
    }
    if (proposalValue.kind === "authenticatedActivityControl" && hasExactJsonKeys(proposalValue, ["kind", "rootActionId"])
      && submission.input_kind === "activityControl" && submission.continuation_json !== null) {
      const continuation = parseJson<JsonObject>(submission.continuation_json);
      if (!hasExactJsonKeys(continuation, ["activityId", "attentionRootActionId", "decision"])) return { rejection: rejectedAuthority("invalidActionInput", "The saved activity decision is invalid.") };
      return { input: { kind: "controlActivity", proposalId: submission.root_action_id, actorCharacterId: submission.character_id, ...continuation } };
    }
    if (
      proposalValue.kind === "authenticatedRestStart"
      && hasExactJsonKeys(proposalValue, ["kind", "rootActionId"])
      && submission.input_kind === "restStart"
      && submission.continuation_json !== null
    ) {
      const continuation = parseJson<JsonObject>(submission.continuation_json);
      const group = continuation.mode === "group";
      const personal = continuation.mode === "personal";
      const expectedKeys = group
        ? [
            "arcaneRecoverySlotLevels",
            "hitDiceToSpend",
            "memberCharacterIds",
            "mode",
            "restKind",
          ]
        : [
            "arcaneRecoverySlotLevels",
            "hitDiceToSpend",
            "mode",
            "restKind",
          ];
      const restKind = continuation.restKind === "short" || continuation.restKind === "long"
        ? continuation.restKind
        : undefined;
      const arcaneRecoverySlotLevels = Array.isArray(continuation.arcaneRecoverySlotLevels)
        ? continuation.arcaneRecoverySlotLevels
        : undefined;
      const memberCharacterIds = group
        ? this.authoritativeGroupRestMemberIds(state, submission.character_id)
        : undefined;
      if (
        (!group && !personal)
        || !hasExactJsonKeys(continuation, expectedKeys)
        || restKind === undefined
        || !Number.isSafeInteger(continuation.hitDiceToSpend)
        || Number(continuation.hitDiceToSpend) < 0
        || Number(continuation.hitDiceToSpend) > 20
        || arcaneRecoverySlotLevels === undefined
        || arcaneRecoverySlotLevels.length > 20
        || !arcaneRecoverySlotLevels.every((level) =>
          Number.isSafeInteger(level) && Number(level) >= 1 && Number(level) <= 5)
        || (restKind === "long"
          && (Number(continuation.hitDiceToSpend) !== 0
            || arcaneRecoverySlotLevels.length !== 0))
        || (group && (
          memberCharacterIds === undefined
          || !Array.isArray(continuation.memberCharacterIds)
          || JSON.stringify(memberCharacterIds) !== JSON.stringify(continuation.memberCharacterIds)
        ))
      ) {
        return {
          rejection: rejectedAuthority(
            "privateOrUnknownReference",
            "The prepared rest is no longer available.",
          ),
        };
      }
      return {
        input: {
          kind: "startRest",
          proposalId: submission.root_action_id,
          characterId: submission.character_id,
          restKind,
          hitDiceToSpend: Number(continuation.hitDiceToSpend),
          arcaneRecoverySlotLevels: structuredClone(arcaneRecoverySlotLevels),
          ...(group ? { memberCharacterIds: structuredClone(memberCharacterIds!) } : {}),
        },
      };
    }
    if (
      proposalValue.kind === "authenticatedRestInterrupt"
      && hasExactJsonKeys(proposalValue, ["kind", "rootActionId"])
      && submission.input_kind === "restInterrupt"
      && submission.continuation_json !== null
    ) {
      const continuation = parseJson<JsonObject>(submission.continuation_json);
      const activeRestContext = this.authoritativeActiveRestContext(
        state,
        submission.character_id,
      );
      if (
        !hasExactJsonKeys(continuation, ["activityId"])
        || !nonEmptyString(continuation.activityId)
        || activeRestContext?.activityId !== continuation.activityId
      ) {
        return {
          rejection: rejectedAuthority(
            "privateOrUnknownReference",
            "The prepared rest is no longer active.",
          ),
        };
      }
      return {
        input: {
          kind: "interruptActivity",
          proposalId: submission.root_action_id,
          activityId: continuation.activityId,
          cause: {
            kind: "playerCancelledRest",
            characterId: submission.character_id,
          },
        },
      };
    }
    if (proposalValue.kind === "authenticatedPartyAction") {
      // Only a prepared button command can enter this seam. KP envelopes
      // cannot opt out of Form/read-set validation by naming this capability.
      if (submission.input_kind !== "party"
        || !hasExactJsonKeys(proposalValue, ["kind", "rootActionId"])
        || submission.continuation_json === null) {
        return { rejection: rejectedAuthority(
          "invalidMechanicalProposal", "The party command must match its authenticated preparation.",
        ) };
      }
      const continuation = parseJson<JsonObject>(submission.continuation_json);
      if (!hasOnlyJsonKeys(continuation, ["command"], ["displayText"]) || !isPartyCommand(continuation.command)) {
        return { rejection: rejectedAuthority(
          "invalidMechanicalProposal", "The prepared party command is unavailable.",
        ) };
      }
      const command = continuation.command;
      switch (command.action) {
        case "inviteMember":
          return {
            input: {
              kind: "invitePartyMember",
              rootActionId: submission.root_action_id,
              inviterCharacterId: submission.character_id,
              invitedCharacterId: command.targetCharacterId,
            },
          };
        case "cancelInvitation":
          return {
            input: {
              kind: "cancelPartyInvitation",
              rootActionId: submission.root_action_id,
              inviterCharacterId: submission.character_id,
              pendingInputId: command.pendingInputId,
            },
          };
        case "leave":
          return {
            input: {
              kind: "leavePartyGroup",
              rootActionId: submission.root_action_id,
              characterId: submission.character_id,
            },
          };
        case "transferLeadership":
          return {
            input: {
              kind: "transferPartyLeadership",
              rootActionId: submission.root_action_id,
              fromCharacterId: submission.character_id,
              toCharacterId: command.targetCharacterId,
            },
          };
        case "proposeMove":
          return {
            input: {
              kind: "proposePartyMove",
              rootActionId: submission.root_action_id,
              leaderCharacterId: submission.character_id,
              destinationSceneId: command.destinationSceneId,
              fictionTimeCostMicros: command.fictionTimeCostMicros,
            },
          };
        case "moveIndividually":
          return {
            input: {
              kind: "moveIndividually",
              rootActionId: submission.root_action_id,
              characterId: submission.character_id,
              destinationSceneId: command.destinationSceneId,
              fictionTimeCostMicros: command.fictionTimeCostMicros,
            },
          };
        default:
          return {
            rejection: rejectedAuthority(
              "invalidMechanicalProposal",
              "The authenticated party action is unavailable.",
            ),
          };
      }
    }
    const prepared = this.preparedActionSnapshot(submission);
    if (
      this.vnextAdjudicationBridge?.lowerProposal !== undefined
      && prepared?.requiredContext !== undefined
    ) {
      let lowered: RoomVNextProposalLoweringResult;
      try {
        lowered = this.vnextAdjudicationBridge.lowerProposal({
          proposal: proposalValue,
          preparedActionId: submission.prepared_action_id,
          rootActionId: submission.root_action_id,
          actorCharacterId: submission.character_id,
          principalId: submission.principal_id,
          requiredContext: prepared.requiredContext,
          profiles,
          state,
        });
      } catch {
        return {
          rejection: rejectedAuthority(
            "invalidMechanicalProposal",
            "The vNext proposal could not be lowered into a Rules operation.",
          ),
        };
      }
      if (lowered.kind === "rejected") {
        return { rejection: {
          ...rejectedAuthority(lowered.code, lowered.explanation),
          ...(lowered.issues === undefined ? {} : { issues: structuredClone(lowered.issues) }),
          ...(lowered.diagnostics === undefined ? {} : { diagnostics: structuredClone(lowered.diagnostics) }),
        } };
      }
      if (lowered.kind === "accepted") {
        return {
          input: structuredClone(lowered.input),
          ...(lowered.receiptExtras === undefined
            ? {}
            : { receiptExtras: structuredClone(lowered.receiptExtras) }),
          ...(lowered.forceConcluded === undefined
            ? {}
            : { forceConcluded: lowered.forceConcluded }),
        };
      }
    }
    const proposal = normalizeRoomKpProposal(proposalValue);
    if (proposal === undefined) {
      return {
        rejection: rejectedAuthority(
          "invalidMechanicalProposal",
          "The KP proposal is not a supported production proposal envelope.",
        ),
      };
    }
    if (proposal.kind === "authenticatedCampaignAction") {
      if (submission.input_kind !== "intent") {
        return {
          rejection: rejectedAuthority(
            "invalidMechanicalProposal",
            "An authenticated campaign action must follow its prepared player intent.",
          ),
        };
      }
      switch (proposal.action) {
        case "grantMilestone": {
          const actorViewer = this.authorityPlayerViewer(
            authenticated,
            state,
            submission.character_id,
          );
          const actorProjection = actorViewer === undefined
            ? undefined
            : this.rulesRuntime.project(profiles, state, actorViewer);
          const visibleFactIds = actorProjection?.kind === "projected"
            && "visibleFacts" in actorProjection
            ? new Set(actorProjection.visibleFacts.map((fact) => fact.id))
            : new Set<string>();
          const rawSourceFactIds = Array.isArray(proposal.sourceFactIds)
            ? proposal.sourceFactIds
            : [];
          const sourceFactIds = rawSourceFactIds.filter(nonEmptyString);
          const campaignId = state.campaignRuntime.campaign?.campaignId;
          if (
            !nonEmptyString(campaignId)
            || sourceFactIds.length === 0
            || sourceFactIds.length !== rawSourceFactIds.length
            || sourceFactIds.some((factId) => !visibleFactIds.has(factId))
          ) {
            return {
              rejection: rejectedAuthority(
                "privateOrUnknownReference",
                "The milestone source is unavailable to the acting character.",
              ),
            };
          }
          return {
            input: {
              kind: "grantMilestone",
              proposalId: submission.root_action_id,
              campaignId,
              characterId: submission.character_id,
              sourceFactIds: [...sourceFactIds].sort(),
            },
          };
        }
        case "retireCharacter":
          return {
            input: {
              kind: "retireCharacter",
              proposalId: submission.root_action_id,
              characterId: submission.character_id,
              reason: proposal.reason,
              continueAsNpc: proposal.continueAsNpc,
            },
          };
        case "establishInheritanceSource": {
          const parties = this.authoritativeInheritanceParties(
            authenticated,
            state,
            submission.character_id,
          );
          const authorization = isJsonRecord(proposal.inheritanceAuthorization)
            ? proposal.inheritanceAuthorization
            : undefined;
          if (parties === undefined || authorization === undefined) {
            return {
              rejection: rejectedAuthority(
                "privateOrUnknownReference",
                "The current Seat has no exact predecessor-successor inheritance context.",
              ),
            };
          }
          return {
            input: {
              kind: "establishInheritanceSource",
              proposalId: submission.root_action_id,
              predecessorCharacterId: parties.predecessorCharacterId,
              successorCharacterId: parties.successorCharacterId,
              source: {
                kind: proposal.inheritanceSourceKind,
                publicClause: proposal.publicClause,
                authorizations: [{
                  authorizationId: authorization.authorizationId,
                  subjectCharacterId: parties.predecessorCharacterId,
                  kind: authorization.kind,
                  sourceRef: authorization.sourceRef,
                  targetCharacterId: parties.successorCharacterId,
                  targetRef: authorization.targetRef,
                  scope: authorization.scope,
                }],
              },
            },
          };
        }
        case "transferInheritance": {
          const parties = this.authoritativeInheritanceParties(
            authenticated,
            state,
            submission.character_id,
          );
          if (parties === undefined) {
            return {
              rejection: rejectedAuthority(
                "privateOrUnknownReference",
                "The current Seat has no exact predecessor-successor inheritance context.",
              ),
            };
          }
          return {
            input: {
              kind: "transferInheritance",
              proposalId: submission.root_action_id,
              predecessorCharacterId: parties.predecessorCharacterId,
              successorCharacterId: parties.successorCharacterId,
              sourceFactId: proposal.inheritanceSourceFactRef,
              authorizationId: proposal.inheritanceAuthorizationRef,
            },
          };
        }
        case "startActivity":
          return {
            input: {
              kind: "startActivity",
              proposalId: submission.root_action_id,
              characterId: submission.character_id,
              activityId: proposal.activityId,
              activityKind: proposal.activityKind,
              intendedDurationMicros: proposal.intendedDurationMicros,
              completion: structuredClone(proposal.completion),
            },
          };
        case "recordEpilogueChoice":
          return {
            input: {
              kind: "recordEpilogueChoice",
              proposalId: submission.root_action_id,
              characterId: submission.character_id,
              storyId: proposal.storyId,
              choice: proposal.choice,
            },
          };
        case "startSequel":
          return {
            input: {
              kind: "startSequel",
              proposalId: submission.root_action_id,
              priorStoryId: proposal.priorStoryId,
              sequelStoryId: proposal.sequelStoryId,
              chapterId: proposal.chapterId,
              anchorFactIds: structuredClone(proposal.anchorFactIds),
              sceneQuestion: proposal.sceneQuestion,
              activityTransitions: structuredClone(proposal.activityTransitions),
            },
          };
        default:
          return {
            rejection: rejectedAuthority(
              "invalidMechanicalProposal",
              "The authenticated campaign action is unavailable.",
            ),
          };
      }
    }
    if (proposal.kind === "resolveDynamicEnvironmentStunt") {
      return lowerDynamicEnvironmentProposal({
        proposal,
        profiles,
        state,
        actor: {
          inputKind: submission.input_kind,
          rootActionId: submission.root_action_id,
          principalId: submission.principal_id,
          characterId: submission.character_id,
          viewer: this.authorityPlayerViewer(
            authenticated,
            state,
            submission.character_id,
          ),
        },
      });
    }
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
      if (state.frozenPlayerChoices?.[pendingInputId] !== undefined) {
        const input = frozenPlayerChoiceAnswer(state, { pendingInputId, rootActionId: submission.root_action_id,
          controllerCharacterId: submission.character_id }, answer);
        return input === undefined || pendingProjection.kind !== "playerChoice"
          ? { rejection: rejectedAuthority("invalidPendingResolution", "The frozen choice is unavailable or its answer changed.") }
          : { input };
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
      if (pendingProjection.kind === "socialResolution") {
        if (
          !hasExactJsonKeys(answer, ["choice"])
          || !["press", "acceptStatusQuo"].includes(String(answer.choice))
        ) {
          return {
            rejection: rejectedAuthority(
              "invalidPendingResolution",
              "Social resolution requires press or acceptStatusQuo.",
            ),
          };
        }
        return {
          input: {
            kind: "answerSocialResolution",
            pendingInputId,
            rootActionId: submission.root_action_id,
            controllerCharacterId: submission.character_id,
            choice: answer.choice,
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

    if (proposal.kind === "executeCausalActionProgram") {
      const boundProposal = {
        ...structuredClone(proposal),
        rootActionId: submission.root_action_id,
        actorCharacterId: submission.character_id,
      };
      if (
        (submission.input_kind !== "intent" && submission.input_kind !== "answer")
        || !isCanonicalV3CausalRulesInput(boundProposal)
      ) {
        return {
          rejection: rejectedAuthority(
            "invalidMechanicalProposal",
            "A causal action program must follow an authenticated player intent or pending answer.",
          ),
        };
      }
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
        input: boundProposal,
        ...(inWorldRefusal
          ? {
              receiptExtras: {
                resolutionDisposition: "inWorldRefusal" as const,
              },
            }
          : {}),
      };
    }

    return {
      rejection: rejectedAuthority(
        "invalidMechanicalProposal",
        "Only a current private Form, authenticated party action, or typed pending input may commit this action.",
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
    if (
      !isJsonRecord(value)
      || value.kind !== "multiWave"
      || !hasExactJsonKeys(value, ["kind", "waves"])
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

  private authorityPlayerRollGestureRequired(
    profiles: RuntimeProfileManifest,
    request?: JsonObject,
  ): boolean {
    // The gesture authorizes a frozen player-owned request, regardless of
    // which Rules plan produced it. Ownership is checked from trusted state.
    return socialResolutionProfileEnabled(profiles.extensions)
      && request?.purpose !== "hiddenRealitySelection";
  }

  private authorityRandomnessOperation(
    request: JsonObject,
    requestEvents: EventEnvelope[],
  ): JsonObject | undefined {
    for (let index = requestEvents.length - 1; index >= 0; index -= 1) {
      const payload = requestEvents[index]?.payload as unknown;
      if (!isJsonRecord(payload) || !isJsonRecord(payload.resolution)) continue;
      const resolution = payload.resolution;
      if (resolution.resolutionId !== request.resolutionId) continue;
      const resolutionRequests = Array.isArray(resolution.randomnessRequests)
        ? resolution.randomnessRequests.filter(isJsonRecord)
        : [];
      if (resolutionRequests.some((entry) => entry.randomnessId === request.randomnessId)) {
        return isJsonRecord(resolution.operation)
          ? resolution.operation
          : undefined;
      }
    }
    return undefined;
  }

  private authorityPlayerRollOwner(
    state: AuthoritativeWorldState,
    request: JsonObject,
    requestEvents: EventEnvelope[],
  ): string | undefined {
    if (request.purpose === "hiddenRealitySelection") return undefined;
    const player = (candidate: unknown): string | undefined =>
      nonEmptyString(candidate)
      && state.entities[candidate]?.kind === "player"
      && state.entities[candidate]?.tenureStatus === "active"
      && state.characterControls[candidate] !== undefined
        ? candidate
        : undefined;
    if (nonEmptyString(request.actorCharacterId)) {
      return player(request.actorCharacterId);
    }

    const frozen = isJsonRecord(request.frozenParameters)
      ? request.frozenParameters
      : {};
    const operation = this.authorityRandomnessOperation(request, requestEvents) ?? {};
    const purposeKey = nonEmptyString(request.purposeKey) ? request.purposeKey : "";
    if (purposeKey.startsWith("initiative:")) {
      const combatants = Array.isArray(frozen.combatantEntityIds)
        ? frozen.combatantEntityIds
        : [];
      return player(combatants[0]);
    }

    const counterFrame = isJsonRecord(operation.counterFrame)
      ? operation.counterFrame
      : undefined;
    const spellFrame = isJsonRecord(operation.spellFrame) ? operation.spellFrame : undefined;
    if (purposeKey.startsWith("save:")
      || purposeKey.startsWith("death-save:")
      || purposeKey.startsWith("stable-recovery:")) {
      const savingCharacterId = nonEmptyString(frozen.targetEntityId)
        ? frozen.targetEntityId
        : purposeKey.startsWith("save:concentration:")
          && nonEmptyString(frozen.sourceEntityId)
          ? frozen.sourceEntityId
          : undefined;
      return player(savingCharacterId);
    }
    if (purposeKey.startsWith("damage:environment-hazard:")) return undefined;

    const rollingCharacterId = nonEmptyString(frozen.sourceEntityId)
      ? frozen.sourceEntityId
      : nonEmptyString(frozen.entityId)
        ? frozen.entityId
        : nonEmptyString(operation.sourceEntityId)
          ? operation.sourceEntityId
          : nonEmptyString(counterFrame?.sourceEntityId)
            ? counterFrame.sourceEntityId
            : nonEmptyString(spellFrame?.sourceEntityId) ? spellFrame.sourceEntityId : undefined;
    return player(rollingCharacterId);
  }

  private authorityViewerPendingRoll(
    state: AuthoritativeWorldState,
    request: AuthorityRandomnessJournalRequest,
    requestEvents: EventEnvelope[],
    characterId: string,
  ): ViewerPendingPlayerRoll {
    let value = request.request;
    if (value.purpose === "worldInteractionCheck") {
      if (value.actorCharacterId === characterId && isJsonRecord(value.frozenCheck)) {
        const mode = value.frozenCheck.mode;
        value = { ...value, diceExpression: mode === "advantage" ? "2d20kh1" : mode === "disadvantage" ? "2d20kl1" : "1d20" };
      } else {
        // A shared commitment may contain private NPC/unused candidate dice.
        // Each target sees only its own save gesture, never that private pool.
        const native = this.authorityWorldInteractionNativeRequests(value).find(entry =>
          this.authorityPlayerRollOwner(state, entry, requestEvents) === characterId);
        value = native === undefined
          ? { purpose: "savingThrow", diceExpression: "d20", frozenParameters: {} }
          : native;
      }
    }
    const frozen = isJsonRecord(value.frozenCheck)
      ? value.frozenCheck
      : isJsonRecord(value.frozenParameters) ? value.frozenParameters : {};
    const purposeKey = nonEmptyString(value.purposeKey) ? value.purposeKey : "";
    const kind: ViewerPendingPlayerRoll["kind"] = value.purpose === "savingThrow"
      || purposeKey.startsWith("save:")
      || purposeKey.startsWith("concentration:")
      ? "save"
      : value.purpose === "restHitDice"
        || purposeKey.startsWith("stable-recovery:")
        || purposeKey.startsWith("healing:")
        || purposeKey.startsWith("temporary-hit-points:")
        ? "heal"
        : purposeKey.startsWith("attack:")
          ? "attack"
          : purposeKey.startsWith("initiative:")
            ? "init"
            : purposeKey.startsWith("damage:")
              ? "damage"
              : purposeKey.startsWith("death-save:")
                ? "death"
                : "check";
    const abilityAliases: Record<string, string> = {
      strength: "str",
      dexterity: "dex",
      constitution: "con",
      intelligence: "int",
      wisdom: "wis",
      charisma: "cha",
    };
    const suppliedAbility = nonEmptyString(frozen.ability) ? frozen.ability : "str";
    const ability = abilityAliases[suppliedAbility] ?? suppliedAbility;
    const rawDc = typeof frozen.dc === "string" && /^[0-9]+$/u.test(frozen.dc)
      ? Number(frozen.dc)
      : Number.isSafeInteger(frozen.dc) ? Number(frozen.dc) : 0;
    const reason = kind === "save"
      ? "进行豁免检定"
      : kind === "attack"
        ? "进行攻击检定"
        : kind === "init"
          ? "进行先攻检定"
          : kind === "damage"
            ? "掷伤害骰"
            : kind === "death"
              ? "进行死亡豁免"
              : kind === "heal"
                ? "掷恢复骰"
                : nonEmptyString(frozen.goal) ? `为「${frozen.goal}」进行检定` : "进行属性检定";
    return {
      id: request.randomnessId,
      characterId,
      name: state.entities[characterId]?.name ?? "你",
      kind,
      ability,
      ...(nonEmptyString(frozen.skill) ? { skill: frozen.skill } : {}),
      dc: rawDc,
      reason,
      dice: String(value.diceExpression),
      ...(frozen.mode === "advantage" ? { advantage: true } : {}),
      ...(frozen.mode === "disadvantage" ? { disadvantage: true } : {}),
    };
  }

  private authorityPlayerRollOwners(state: AuthoritativeWorldState, request: JsonObject, events: EventEnvelope[]): string[] {
    if (request.purpose !== "worldInteractionCheck") {
      if (String(request.purposeKey).startsWith("initiative:") && isJsonRecord(request.frozenParameters)
        && Array.isArray(request.frozenParameters.combatantEntityIds)) {
        return [...new Set(request.frozenParameters.combatantEntityIds.flatMap(actorCharacterId => {
          const owner = this.authorityPlayerRollOwner(state, { actorCharacterId }, events);
          return owner === undefined ? [] : [owner];
        }))].sort();
      }
      const owner = this.authorityPlayerRollOwner(state, request, events);
      return owner === undefined ? [] : [owner];
    }
    const owners = new Set<string>();
    if (isJsonRecord(request.frozenCheck)) {
      const owner = this.authorityPlayerRollOwner(state, request, events);
      if (owner !== undefined) owners.add(owner);
    }
    for (const native of this.authorityWorldInteractionNativeRequests(request)) {
      const owner = this.authorityPlayerRollOwner(state, native, events);
      if (owner !== undefined) owners.add(owner);
    }
    for (const spec of Array.isArray(request.hazardRolls) ? request.hazardRolls : []) {
      if (!isJsonRecord(spec) || !isJsonRecord(spec.frozenParameters)) continue;
      const target = spec.frozenParameters.targetRef;
      const purpose = spec.purposeKey;
      if (!nonEmptyString(target) || !nonEmptyString(purpose)) continue;
      if (!purpose.endsWith(`:save:${target}`)
        && !(purpose.endsWith(`:concentration:${target}`) && isJsonRecord(state.combatRuntime.entities[target]?.concentration))) continue;
      const owner = this.authorityPlayerRollOwner(state, { purposeKey: "save:hazard",
        frozenParameters: { targetEntityId: target } }, events);
      if (owner !== undefined) owners.add(owner);
    }
    return [...owners].sort();
  }

  private authorityWorldInteractionNativeRequests(request: JsonObject): JsonObject[] {
    return (Array.isArray(request.hazardRolls) ? request.hazardRolls : []).flatMap(spec => {
      if (!isJsonRecord(spec) || !nonEmptyString(spec.purposeKey)
        || !spec.purposeKey.startsWith("inventory:") || !isJsonRecord(spec.frozenParameters)
        || !Array.isArray(spec.dice)) return [];
      const purposeKey = spec.purposeKey.replace(
        /^inventory:.+:\d+:(?=(?:attack|damage|save|death-save|stable-recovery|healing|temporary-hit-points|check|initiative):)/u, "");
      if (purposeKey === spec.purposeKey) return [];
      return [{ purposeKey, frozenParameters: { ...(!nonEmptyString(spec.frozenParameters.entityId)
        ? { sourceEntityId: request.actorCharacterId } : {}), ...spec.frozenParameters },
        diceExpression: spec.dice.filter(isJsonRecord).map(die => `${die.count}d${die.sides}`).join("+") }];
    });
  }

  private authorityRandomnessBatchKey(submission: AuthoritySubmissionRow): string {
    const stage = this.authorityStore.actionStage(submission.prepared_action_id);
    return stage?.status === "prepared"
      ? stage.child_root_action_id
      : submission.prepared_action_id;
  }

  private authorityResumedPlayerIntent(
    submission: AuthoritySubmissionRow,
  ): JsonObject | undefined {
    if (submission.input_kind !== "intent" || submission.continuation_json === null) {
      return undefined;
    }
    try {
      const continuation = parseJson<JsonObject>(submission.continuation_json);
      const originalInput = continuation.originalInput;
      return isJsonRecord(originalInput)
        && originalInput.kind === "intent"
        && originalInput.submissionId === submission.submission_id
        && nonEmptyString(originalInput.text)
        ? structuredClone(originalInput)
        : undefined;
    } catch {
      return undefined;
    }
  }

  private authorityResumedPrincipalContext(
    state: AuthoritativeWorldState,
    submission: AuthoritySubmissionRow,
  ): TrustedPrincipalContext | undefined {
    if (submission.principal_id === null) return undefined;
    const sessionVersion = state.principals[submission.principal_id]?.sessionVersion;
    return Number.isSafeInteger(sessionVersion)
      ? {
          principal: {
            id: submission.principal_id,
            sessionVersion: Number(sessionVersion),
          },
        }
      : undefined;
  }

  private authorityActiveRandomnessRequests(input: {
    batch: AuthorityRandomnessBatchJournalRow;
  }): {
    requests: AuthorityRandomnessJournalRequest[];
    activeRequests: AuthorityRandomnessJournalRequest[];
    requestEvents: EventEnvelope[];
  } | undefined {
    try {
      const requests = parseJson<AuthorityRandomnessJournalRequest[]>(input.batch.requests_json);
      const requestEvents = parseJson<EventEnvelope[]>(input.batch.request_events_json);
      const fulfillment = parseJson<unknown>(input.batch.fulfillment_json);
      if (!Array.isArray(requests) || !Array.isArray(requestEvents)) return undefined;
      const waves = this.authorityRandomnessWaves(fulfillment, requests);
      const activeWave = waves?.at(-1);
      if (activeWave === undefined) return undefined;
      return {
        requests,
        activeRequests: requests.slice(requests.length - activeWave.requestCount),
        requestEvents,
      };
    } catch {
      return undefined;
    }
  }

  private viewerPendingPlayerRolls(
    replay: AuthorityReplay,
    authenticated: AuthenticatedAuthorityViewer,
  ): ViewerPendingPlayerRoll[] {
    if (!this.authorityPlayerRollGestureRequired(replay.profiles)) return [];
    const rolls: ViewerPendingPlayerRoll[] = [];
    for (const submission of this.authorityStore.awaitingRandomnessSubmissions()) {
      const batchKey = this.authorityRandomnessBatchKey(submission);
      const batch = this.authorityStore.randomnessBatch(batchKey);
      if (batch?.status !== "requestCommitted" && batch?.status !== "candidateCommitted") continue;
      const active = this.authorityActiveRandomnessRequests({ batch });
      if (active === undefined) continue;
      const authorized = this.authorityStore.randomnessAuthorizations(batchKey);
      const waitingForOthers = active.activeRequests.some(request =>
        this.authorityPlayerRollOwners(replay.state, request.request, active.requestEvents).some(characterId =>
          !authorized.some(entry => entry.randomness_id === request.randomnessId && entry.character_id === characterId)));
      for (const request of active.activeRequests) {
        if (!this.authorityPlayerRollGestureRequired(
          replay.profiles,
          request.request,
        )) continue;
        for (const characterId of this.authorityPlayerRollOwners(replay.state, request.request, active.requestEvents)) {
          if (!authenticated.characterIds.includes(characterId)
            || (waitingForOthers && authorized.some(entry => entry.randomness_id === request.randomnessId && entry.character_id === characterId))) continue;
          rolls.push(this.authorityViewerPendingRoll(replay.state, request, active.requestEvents, characterId));
        }
      }
    }
    return rolls.sort((left, right) => left.id.localeCompare(right.id));
  }

  private authorityPendingPlayerRollOwnerIds(replay: AuthorityReplay): Set<string> {
    const owners = new Set<string>();
    if (!this.authorityPlayerRollGestureRequired(replay.profiles)) return owners;
    for (const submission of this.authorityStore.awaitingRandomnessSubmissions()) {
      const batch = this.authorityStore.randomnessBatch(
        this.authorityRandomnessBatchKey(submission),
      );
      if (batch?.status !== "requestCommitted" && batch?.status !== "candidateCommitted") continue;
      const active = this.authorityActiveRandomnessRequests({ batch });
      if (active === undefined) continue;
      for (const request of active.activeRequests) {
        if (!this.authorityPlayerRollGestureRequired(
          replay.profiles,
          request.request,
        )) continue;
        for (const owner of this.authorityPlayerRollOwners(replay.state, request.request, active.requestEvents)) owners.add(owner);
      }
    }
    return owners;
  }

  private awaitingPlayerRollOutcome(
    replay: AuthorityReplay,
    authenticated: AuthenticatedAuthorityViewer,
  ): Extract<AuthorityCommitOutcome, { kind: "awaitingPlayerRoll" }> {
    return {
      kind: "awaitingPlayerRoll",
      pendingPlayerRolls: this.viewerPendingPlayerRolls(replay, authenticated),
    };
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
      const rawWaves = (serialized: string): unknown[] | undefined => {
        const fulfillment = parseJson<unknown>(serialized);
        return isJsonRecord(fulfillment)
          && fulfillment.kind === "multiWave"
          && hasExactJsonKeys(fulfillment, ["kind", "waves"])
          && Array.isArray(fulfillment.waves)
          ? fulfillment.waves
          : undefined;
      };
      const staleWaves = rawWaves(stale.fulfillment_json);
      const newerWaves = rawWaves(newer.fulfillment_json);
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
    const rootAllowed = initialRandomnessRootActionId === undefined
      ? requestRootActionId === rootActionId
      : requestRootActionId === initialRandomnessRootActionId;
    const oneRoot = !requestEvents.some((event) => event.rootActionId !== requestRootActionId);
    if (!rootAllowed || !oneRoot) return false;
    const eventRequests: JsonObject[] = [];
    for (const event of requestEvents) {
      if (event.eventType !== "RandomnessRequested") continue;
      const payload: unknown = event.payload;
      if (!isJsonRecord(payload)) return false;
      if (isJsonRecord(payload.request)) {
        const randomnessId = nonEmptyString(payload.request.randomnessId)
          ? payload.request.randomnessId
          : undefined;
        if (requestRootActionId !== rootActionId
          && (randomnessId === undefined
            || !randomnessId.startsWith(`randomness:${requestRootActionId}:`))) return false;
        eventRequests.push(payload.request);
        continue;
      }
      const resolution = isJsonRecord(payload.resolution)
        ? payload.resolution
        : undefined;
      if (
        resolution === undefined
        || resolution.rootActionId !== requestRootActionId
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
    rootActionId: string,
    priorState: AuthoritativeWorldState,
    events: EventEnvelope[],
    actorMessage?: NonNullable<DeliveryPlan["actorMessage"]>,
  ): AuthorityAudienceBindingsResult {
    const actor = state.entities[actorCharacterId];
    if (actor === undefined) {
      return {
        kind: "rejected",
        outcome: rejectedAuthority(
          "projectionFailure",
          "The committed action actor is unavailable for audience projection.",
        ),
      };
    }
    const usesFrozenRenderableClaims = worldInteractionProfileEnabled(profiles.extensions)
      && committedRangeUsesFrozenRenderableClaims(events.filter(event => event.rootActionId === rootActionId));
    const bindings: DeliveryAudienceBinding[] = [];
    const diceMessages: ExperiencedTranscriptMessageInput[] = [];
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
            ?? this.timePassageFormerViewer(state, character.id, events)
          : undefined);
      if (viewer === undefined) continue;
      const projection = this.rulesRuntime.project(profiles, state, viewer, {
        committedRange: {
          receiptId,
          actorCharacterId,
          priorState,
          events,
        },
      });
      if (!isObserverProjection(projection)) {
        return {
          kind: "rejected",
          outcome: rejectedAuthority(
            "projectionFailure",
            "A frozen audience projection could not be derived from the committed event range.",
          ),
        };
      }
      const projectionRecord = projection as unknown as JsonObject;
      if ("committedDelta" in projection && projection.committedDelta !== undefined) {
        for (const change of projection.committedDelta.changes) {
          if (change.kind !== "diceRolled" || !nonEmptyString(change.messageId)
            || !nonEmptyString(change.characterId) || !nonEmptyString(change.speakerName)
            || !nonEmptyString(change.body) || !nonEmptyString(change.sceneId)
            || !nonEmptyString(change.sourceEventSeq)) continue;
          diceMessages.push({ viewerKey: `${viewer.principalId}\u001f${character.id}`,
            messageId: change.messageId, kind: "roll", speakerCharacterId: change.characterId,
            speakerName: change.speakerName, body: change.body, sceneIds: [change.sceneId],
            sourceEventSeq: change.sourceEventSeq, receiptId });
        }
      }
      const hasCommittedDelta = "committedDelta" in projection && projection.committedDelta !== undefined
        && projection.committedDelta.changes.length > 0;
      const renderableClaims = frozenRenderableClaimsConform(
          projectionRecord.renderableClaims,
        )
        ? projectionRecord.renderableClaims
        : undefined;
      let narrationInputMode: NarrationInputMode;
      let projectionHash: string;
      let kpProjection: JsonObject;
      if (usesFrozenRenderableClaims) {
        if (renderableClaims === undefined) {
          return {
            kind: "rejected",
            outcome: rejectedAuthority(
              "projectionFailure",
              "The frozen audience projection did not provide conforming Viewer Claims.",
            ),
          };
        }
        const viewerKey = `${viewer.principalId}\u001f${character.id}`;
        if (renderableClaims.receiptId !== receiptId
          || renderableClaims.rootActionId !== rootActionId
          || renderableClaims.viewerKey !== viewerKey) {
          return {
            kind: "rejected",
            outcome: rejectedAuthority(
              "projectionFailure",
              "The frozen Viewer Claims do not match their Receipt, Viewer, or projection.",
            ),
          };
        }
        if (renderableClaims.claims.length === 0) continue;
        // A pure wait used to be delivered only by the owner's projected
        // Activity. A live Viewer now also gets KP narration for it: what was
        // said just before the wait is returned inside the elapsed time. A
        // lifecycle audience (the former controller of a dead or departed
        // character) keeps the deterministic Activity delivery alone.
        const pureWait = renderableClaims.claims.every(claim => claim.kind === "mechanicalOutcome"
          && ["timePassageCompleted", "timePassageInterrupted"].includes(String(claim.outcomeCode)));
        if (pureWait && projection.controlledCharacter === null) continue;
        if (projection.controlledCharacter === null) return { kind: "rejected",
          outcome: rejectedAuthority("projectionFailure", "A lifecycle audience contains unsupported narration material.") };
        narrationInputMode = "frozenRenderableClaims-vnext-1";
        projectionHash = renderableClaims.projectionHash;
        kpProjection = {
          renderableClaims: structuredClone(renderableClaims) as unknown as JsonObject,
          narrationContext: roomNarrationContext({ claims: renderableClaims, projection, actorCharacterId, actorMessage,
            experiencedTranscript: this.experiencedTranscriptForViewer(viewer, state),
          }) as unknown as JsonObject,
        };
      } else {
        if (!hasCommittedDelta) continue;
        narrationInputMode = "observerProjection-v1";
        projectionHash = projection.projectionHash;
        const projectedForNarration = narrationProjection(
          projectionRecord,
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
        kpProjection = projectedForNarration;
      }
      const priorSceneId = priorState.entities[character.id]?.sceneId;
      const currentSceneId = state.entities[character.id]?.sceneId;
      bindings.push({
        audienceId: `audience:${receiptId}:${character.id}`,
        principalId: viewer.principalId,
        sessionVersion: viewer.sessionVersion!,
        seatId: viewer.seatId!,
        characterId: character.id,
        sceneIds: uniqueSceneIds([priorSceneId, currentSceneId]),
        projectionHash,
        narrationInputMode,
        kpProjection,
      });
    }
    return { kind: "accepted", audiences: bindings, diceMessages };
  }

  private npcDecisionOutcome(
    submission: AuthoritySubmissionRow,
    row: AuthorityNpcDecisionRow,
  ): Extract<AuthorityCommitOutcome, { kind: "awaitingKpDecision" }> {
    return {
      kind: "awaitingKpDecision",
      preparedActionId: submission.prepared_action_id,
      rootActionId: submission.root_action_id,
      decision: { ...parseJson<JsonObject>(row.request_json), capability: row.capability },
    };
  }

  private async commitNpcDecision(
    context: TrustedPrincipalContext,
    preparedActionId: string,
    decision: JsonObject,
  ): Promise<AuthorityCommitOutcome> {
    const replay = this.authoritativeReplay();
    const viewer = this.authenticatedAuthorityViewer(context, replay.state);
    const submission = this.authorityStore.submissionByPrepared(preparedActionId);
    const row = this.authorityStore.npcDecision(preparedActionId);
    if (viewer === undefined || submission === undefined || row === undefined
      || submission.principal_id !== viewer.principalId
      || !viewer.characterIds.includes(submission.character_id)
      || !hasExactJsonKeys(decision, ["kind", "capability", "answer"])
      || decision.capability !== row.capability || !isJsonRecord(decision.answer)) {
      return rejectedAuthority("privateOrUnknownReference", "The NPC decision capability is unavailable.");
    }
    if (row.answer_json !== null
      && await authorityHash(parseJson(row.answer_json)) !== await authorityHash(decision.answer)) {
      return rejectedAuthority("idempotencyPayloadMismatch", "The NPC decision already has a frozen answer.");
    }
    if (!npcPendingAnswerConforms(parseJson<JsonObject>(row.request_json).pending, decision.answer)) {
      return rejectedAuthority("invalidPendingResolution", "The answer is outside this NPC decision capability.");
    }
    if (submission.result_json !== null) return parseJson<AuthorityCommitOutcome>(submission.result_json);
    const finishedStage = this.authorityStore.actionStage(preparedActionId);
    if (finishedStage?.status === "committed" && finishedStage.result_json !== null
      && finishedStage.proposal_hash === row.proposal_hash) {
      return parseJson<AuthorityCommitOutcome>(finishedStage.result_json);
    }
    if (hasActiveSafetyPause(replay.state)) return presentationUnavailable();
    const pending = replay.state.combatRuntime.pendingInputs[row.pending_input_id];
    if (!isJsonRecord(pending) || pending.kind !== "kpDecision") {
      // An answered checkpoint can already have advanced to a later randomness
      // wave. Recovery consumes that journal, never the old answer a second time.
      if (row.answer_json === null) return rejectedAuthority("privateOrUnknownReference", "The NPC decision is no longer pending.");
    }
    const canonical = parseJson<JsonObject>(row.input_json);
    const accepted = this.authorityStore.transaction(() => {
      const current = this.authorityStore.npcDecision(preparedActionId);
      if (current?.capability !== row.capability) return false;
      if (current.answer_json !== null
        && canonicalNpcAnswer(parseJson(current.answer_json)) !== canonicalNpcAnswer(decision.answer)) return false;
      this.authorityStore.answerNpcDecision(preparedActionId, row.capability, decision.answer);
      return true;
    });
    if (!accepted) return rejectedAuthority("idempotencyPayloadMismatch", "The NPC decision already has a frozen answer.");
    return this.commitAuthoritative(context, preparedActionId, {
      kind: "canonicalInput", proposalHash: row.proposal_hash,
      input: canonical.input as JsonObject,
      ...(isJsonRecord(canonical.receiptExtras) ? { receiptExtras: canonical.receiptExtras } : {}),
      ...(canonical.forceConcluded === true ? { forceConcluded: true } : {}),
      ...(nonEmptyString(canonical.answeredPendingInputId) ? { answeredPendingInputId: canonical.answeredPendingInputId } : {}),
    });
  }

  private async suspendNpcDecision(input: {
    submission: AuthoritySubmissionRow;
    proposalHash: string;
    journalPreparedActionId: string;
    waveIndex: number;
    replay: AuthorityReplay;
    canonical: { input: JsonObject; receiptExtras?: JsonObject; forceConcluded?: boolean; answeredPendingInputId?: string };
    resolved: Extract<ReturnType<typeof stepAuthoritative>, { kind: "awaitingInput" }>;
  }): Promise<AuthorityCommitOutcome> {
    const { submission, resolved, replay } = input;
    const publicPending = isJsonRecord(resolved.pending) ? resolved.pending : undefined;
    const pendingId = publicPending?.pendingInputId;
    const pending = nonEmptyString(pendingId)
      ? resolved.state.combatRuntime.pendingInputs[pendingId] : undefined;
    if (!isJsonRecord(pending) || pending.kind !== "kpDecision"
      || !nonEmptyString(pending.controllerEntityId)) {
      return rejectedAuthority("invalidRulesResult", "The NPC pending input has no trusted controller.");
    }
    const projection = this.rulesRuntime.project(replay.profiles, resolved.state, {
      kind: "npc", npcId: pending.controllerEntityId, purpose: "kpDecision",
      capability: "internal:npc-limited-knowledge",
    }, { pendingNpcDecisionFor: { pendingInputId: String(pendingId) } });
    if (projection.kind === "rejected" || projection.viewer.kind !== "npc"
      || projection.viewer.subjectId !== pending.controllerEntityId) {
      return rejectedAuthority("projectionFailure", "The NPC limited-knowledge projection is unavailable.");
    }
    const safePending: JsonObject = {
      pendingInputId: pendingId,
      npcId: pending.controllerEntityId,
      choiceKind: pending.choiceKind,
    };
    for (const key of ["reactionKind", "triggerKind", "candidateEntityIds", "maximumTargetCount",
      "orderedEntityIds", "orderedTriggerInstanceIds", "triggerBatchId", "triggerBatchHash"]) {
      if (pending[key] !== undefined) safePending[key] = structuredClone(pending[key]);
    }
    if (pending.choiceKind === "reaction" || pending.choiceKind === "knockOut") {
      safePending.answerOptions = Array.isArray(pending.answerOptions)
        ? structuredClone(pending.answerOptions)
        : combatPendingAnswerOptions(resolved.state, pending);
    }
    const row: AuthorityNpcDecisionRow = {
      prepared_action_id: submission.prepared_action_id,
      capability: `npc-decision:${crypto.randomUUID()}`,
      pending_input_id: String(pendingId), proposal_hash: input.proposalHash,
      wave_index: input.waveIndex,
      input_json: JSON.stringify(input.canonical),
      request_json: JSON.stringify({ pending: safePending, projection }), answer_json: null,
    };
    const outcome = this.authorityStore.transaction(() => {
      const existing = this.authorityStore.npcDecision(submission.prepared_action_id);
      if (existing !== undefined && existing.pending_input_id === pendingId) return this.npcDecisionOutcome(submission, existing);
      if (canonicalNpcAnswer(this.authoritativeReplay().state) !== canonicalNpcAnswer(replay.state)) {
        return rejectedAuthority("scopeConflict", "The authority changed before the NPC decision paused.");
      }
      this.appendAuthorityTransition(resolved.state, resolved.events);
      this.authorityStore.syncPendingAuthority(resolved.state);
      this.authorityStore.freezeNpcDecisionProposal(submission.prepared_action_id, input.proposalHash);
      this.authorityStore.saveNpcDecision(row);
      this.authorityStore.appendRandomnessDecisionEvents(input.journalPreparedActionId, resolved.events);
      this.authorityStore.markArchivePending(Date.now());
      return this.npcDecisionOutcome(submission, row);
    });
    this.runAuthorityRecoveryCheckpoint("afterNpcDecisionCommit");
    return outcome;
  }

  private dueActivities(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState): DueActivityDescriptor[] {
    if (this.vnextAdjudicationBridge === undefined) return [];
    const projected = this.rulesRuntime.project(profiles, state,
      { kind: "kp", capability: "internal:kp-spatial-evidence" }, { dueActivities: true });
    if (projected.kind === "rejected" || !("dueActivities" in projected)) {
      throw new Error("The canonical due Activity projection is unavailable.");
    }
    return projected.dueActivities;
  }

  private enqueueNewDueActivities(profiles: RuntimeProfileManifest, before: AuthoritativeWorldState,
    after: AuthoritativeWorldState, events: EventEnvelope[]): void {
    const cause = events.at(-1);
    if (cause === undefined || this.vnextAdjudicationBridge === undefined) return;
    const prior = new Set(this.dueActivities(profiles, before).map(due => due.childRootActionId));
    for (const work of this.authorityStore.pendingDueWork()) {
      // ActorPlan lifecycle may commit before its frozen mechanical check.
      // Only the final Receipt closes that in-flight independent task.
      const descriptor = parseJson<DueActivityDescriptor>(work.descriptor_json), actorPlan = descriptor.actorPlan;
      if ((descriptor.longSpellcasting?.phase === "complete" || descriptor.activityProgress?.phase === "complete")
        && (cause.rootActionId === work.child_root_action_id
          || hasPendingAuthorityRoot(after, work.child_root_action_id))) {
        // The duration may complete before Counterspell or player dice. Only
        // the final receipt closes this frozen spell-resolution obligation.
        continue;
      }
      if (actorPlan !== undefined) {
        const inFlight = cause.rootActionId === work.child_root_action_id
          || this.authorityStore.proposalRecovery(work.child_root_action_id) !== undefined;
        const plan = after.campaignRuntime.npcPlans[actorPlan.planId];
        if (!inFlight && (plan === undefined || plan.status !== "scheduled" || plan.revision !== actorPlan.revision)) {
          this.authorityStore.finishDueWork(work.child_root_action_id, "cancelled");
        }
        continue;
      }
      const status = after.campaignRuntime.activities[work.activity_id]?.status;
      if (status === "interrupted" || status === "completed") {
        this.authorityStore.finishDueWork(work.child_root_action_id,
          status === "completed" ? "committed" : "cancelled");
      } else {
        const owner = String(after.campaignRuntime.activities[work.activity_id]?.characterId ?? "");
        if (work.next_attempt_at === null && this.authorityViewerForCharacter(before, owner) === undefined
          && this.authorityViewerForCharacter(after, owner) !== undefined) {
          // A missing controller is an event-driven wait. Regaining a trusted
          // owner wakes it once; any existing dice journal still requires its
          // original player gesture and cannot be drawn by this wakeup.
          this.authorityStore.deferDueWork(work.child_root_action_id, 0);
        }
      }
    }
    for (const due of this.dueActivities(profiles, after)) {
      const queued = this.authorityStore.dueWorkByRoot(due.childRootActionId);
      if (due.activityProgress !== undefined && queued?.status === "pending" && queued.next_attempt_at === null
        && !hasPendingAuthorityRoot(after, due.childRootActionId)
        && vnextCanonicalHash(parseJson(queued.descriptor_json)) === vnextCanonicalHash(due)) {
        this.authorityStore.deferDueWork(due.childRootActionId, 0);
      }
      if (!prior.has(due.childRootActionId)) this.authorityStore.enqueueDueWork({
        activity: due, causeRootActionId: cause.rootActionId, causeEventId: cause.eventId,
      });
    }
  }

  /** Called only inside the transaction that persists the corresponding
   * Receipt or continuation. Every authority producer uses the same due seam. */
  private appendAuthorityTransition(state: AuthoritativeWorldState, events: EventEnvelope[]): void {
    const before = this.authoritativeReplay();
    this.enqueueNewDueActivities(before.profiles, before.state, state, events);
    this.authorityStore.appendEvents(events);
    this.authorityStore.updateState(state);
  }

  private verifiedDueActivity(rootActionId: string, replay: AuthorityReplay): DueActivityDescriptor | undefined {
    const work = this.authorityStore.dueWorkByRoot(rootActionId);
    if (work?.status !== "pending") return undefined;
    const frozen = parseJson<DueActivityDescriptor>(work.descriptor_json);
    const saved = this.authorityStore.submissionByPrepared(rootActionId);
    const pendingSpellResolution = (frozen.longSpellcasting?.phase === "complete" || frozen.activityProgress?.phase === "complete")
      && (saved?.status === "awaitingInput" || saved?.status === "awaitingRandomness")
      && hasPendingAuthorityRoot(replay.state, rootActionId);
    const recoveringSpecialized = saved?.input_kind === "dueActivity"
      && (pendingSpellResolution || ((frozen.actorPlan !== undefined || frozen.longSpellcasting?.phase === "complete" || frozen.activityProgress?.phase === "complete")
        && (saved.status === "awaitingRandomness" || saved.status === "awaitingInput")
        && this.authorityStore.proposalRecovery(rootActionId) !== undefined));
    const candidate = this.dueActivities(replay.profiles, replay.state).find(candidate => candidate.childRootActionId === rootActionId);
    const due = recoveringSpecialized ? frozen : candidate?.actorPlan === undefined ? candidate
      : { ...candidate, completionFictionMicros: frozen.completionFictionMicros };
    if (due === undefined || work.activity_id !== due.activityId || work.timeline_id !== due.timelineId
      || work.completion_fiction_micros !== due.completionFictionMicros) return undefined;
    try {
      if (vnextCanonicalHash(parseJson(work.descriptor_json)) !== vnextCanonicalHash(due)) return undefined;
      const submission = this.authorityStore.submissionByPrepared(rootActionId);
      if (submission !== undefined) {
        const continuation = submission.continuation_json === null ? undefined : parseJson<JsonObject>(submission.continuation_json);
        if (submission.input_kind !== "dueActivity" || submission.character_id !== due.ownerEntityId
          || submission.root_action_id !== rootActionId || continuation?.causeRootActionId !== work.cause_root_action_id
          || continuation.causeEventId !== work.cause_event_id
          || vnextCanonicalHash(continuation.dueActivity) !== vnextCanonicalHash(due)) return undefined;
      }
    } catch { return undefined; }
    return this.authorityStore.events().some(event => event.eventId === work.cause_event_id
      && event.rootActionId === work.cause_root_action_id) ? due : undefined;
  }

  private authorizedInternalDueActivity(context: AuthorityCommitContext, source: AuthorityCommitSource,
    submission: AuthoritySubmissionRow | undefined, replay: AuthorityReplay): boolean {
    if (!("kind" in context) || context.kind !== "internalDueActivity" || source.kind === "proposal"
      || submission?.principal_id !== null || submission.root_action_id !== context.rootActionId) return false;
    const due = this.verifiedDueActivity(context.rootActionId, replay);
    const completion = due === undefined ? undefined : replay.state.campaignRuntime.activities[due.activityId]?.completion;
    return due !== undefined && (replay.state.entities[due.ownerEntityId]?.kind === "npc"
      || (isJsonRecord(completion) && completion.kind === "timePassage"));
  }

  /** Request-scoped transport. The durable invocation below owns attempts and
   * raw responses; the model cannot supply a task identity or authority input. */
  private actorPlanDecisionBinding(transport?: ActorPlanTransport): AuthoritativeModelBinding | undefined {
    if (transport === undefined) return undefined;
    return { async run(model, input) {
      const result = await transport.run(model, input);
      if (result.kind === "completed") return result.response;
      throw Object.assign(new Error(result.code), { actorPlanNotInvoked: true, code: result.code });
    } };
  }

  private actorPlanProviderInput(request: DueActorPlanDecisionRequest): Record<string, unknown> {
    const assembled = assembleProviderInvocation({
      providerBody: deepSeekRequestBody(VNEXT_KP_PROFILE.modelId, vnextActorPlanDecisionInput(request)) as VNextJsonRecord,
      invocationKind: "initial", ledger: INITIAL_REPAIR_LEDGER, budgetProfile: VNEXT_PROVIDER_BUDGET,
    });
    if (assembled.kind === "blocked") throw new TypeError(assembled.code);
    return assembled.providerBody;
  }

  private actorPlanRequest(replay: AuthorityReplay, due: DueActivityDescriptor): DueActorPlanDecisionRequest | undefined {
    const projected = this.rulesRuntime.project(replay.profiles, replay.state,
      { kind: "kp", capability: "internal:kp-spatial-evidence" },
      { dueActorPlanFor: { affectedCharacterId: due.ownerEntityId } });
    if (projected.kind === "rejected" || !("dueActorPlan" in projected)
      || projected.dueActorPlan === null || projected.dueActorPlan.planId !== due.actorPlan?.planId
      || projected.dueActorPlanChildRootActionId !== due.childRootActionId) return undefined;
    return { preparedActionId: due.childRootActionId, rootActionId: due.childRootActionId,
      dueActorPlan: structuredClone(projected.dueActorPlan), projection: structuredClone(projected), attempt: 1 };
  }

  private async commitDueActorPlanWork(rootActionId: string, actorPlanTransport?: ActorPlanTransport): Promise<AuthorityCommitOutcome> {
    const replay = this.authoritativeReplay();
    const work = this.authorityStore.dueWorkByRoot(rootActionId);
    const due = this.verifiedDueActivity(rootActionId, replay);
    if (work === undefined || due?.actorPlan === undefined) {
      return rejectedAuthority("dueActorPlanIntegrityMismatch", "The persisted ActorPlan obligation is no longer eligible.");
    }
    const recovery = this.authorityStore.proposalRecovery(rootActionId);
    if (recovery !== undefined) return this.commitAuthoritative({ kind: "internalDueActivity", rootActionId }, rootActionId,
      { kind: "recovery", row: recovery });
    let submission = this.authorityStore.submissionByPrepared(rootActionId);
    if (submission === undefined) {
      const request = this.actorPlanRequest(replay, due);
      if (request === undefined) return rejectedAuthority("dueActorPlanIntegrityMismatch", "The selected NPC decision is unavailable.");
      // Validate the exact NPC-only frame before persisting or sending it.
      try { this.actorPlanProviderInput(request); }
      catch { return rejectedAuthority("dueActorPlanContextUnavailable", "The NPC limited-knowledge frame is unavailable."); }
      this.authorityStore.transaction(() => {
        if (this.authorityStore.submissionByPrepared(rootActionId) !== undefined) return;
        const sceneScope = `scene:${replay.state.entities[due.ownerEntityId].sceneId}`;
        this.authorityStore.insertSubmission({ submissionId: `due-submission:${rootActionId}`, principalId: null,
          payloadHash: vnextCanonicalHash(due), inputKind: "dueActivity", rootActionId, preparedActionId: rootActionId,
          characterId: due.ownerEntityId, sceneScope, preparedScopeVersion: this.authorityStore.scopeVersion(sceneScope),
          prepared: { kind: "prepared", preparedActionId: rootActionId, rootActionId, kpProjection: {}, resolutionMode: "authorityDirect" },
          continuation: { dueActivity: structuredClone(due), causeRootActionId: work.cause_root_action_id,
            causeEventId: work.cause_event_id, actorPlanRequest: structuredClone(request) as unknown as JsonObject } });
      });
      this.runAuthorityRecoveryCheckpoint("afterDueSubmissionBeforeCommit");
      submission = this.authorityStore.submissionByPrepared(rootActionId)!;
    }
    if (submission.result_json !== null) return parseJson<AuthorityCommitOutcome>(submission.result_json);
    const continuation = submission.continuation_json === null ? undefined : parseJson<JsonObject>(submission.continuation_json);
    const request = continuation?.actorPlanRequest as DueActorPlanDecisionRequest | undefined;
    if (request === undefined) return rejectedAuthority("dueActorPlanContextUnavailable", "The frozen NPC decision is unavailable.");
    const currentRequest = this.actorPlanRequest(this.authoritativeReplay(), due);
    let modelInput: Record<string, unknown>;
    try {
      modelInput = this.actorPlanProviderInput(request);
      if (currentRequest === undefined || vnextCanonicalHash(this.actorPlanProviderInput(currentRequest)) !== vnextCanonicalHash(modelInput)) {
        return rejectedAuthority("dueActorPlanContextChanged", "The NPC's frozen premises changed before its decision committed.");
      }
    } catch { return rejectedAuthority("dueActorPlanContextUnavailable", "The frozen NPC decision failed integrity validation."); }
    const requestHash = vnextCanonicalHash(modelInput), contextHash = vnextCanonicalHash(request);
    let response: unknown;
    // Exactly one physical attempt. A prepared request has not been sent;
    // a running request may have reached the provider and is never resent.
    for (const ordinal of [1]) {
      let row = this.authorityStore.vnextInvocation(rootActionId, ordinal);
      if (row !== undefined) {
        let savedRequest: unknown;
        try { savedRequest = parseJson(row.request_json); }
        catch { return rejectedAuthority("dueActorPlanInvocationIntegrityMismatch", "The saved NPC request is invalid."); }
        if (row.request_hash !== requestHash || row.context_hash !== contextHash
          || row.binding_hash !== VNEXT_ACTOR_PLAN_DECISION_BINDING_HASH
          || vnextCanonicalHash(savedRequest) !== requestHash) {
          return rejectedAuthority("dueActorPlanInvocationIntegrityMismatch", "The saved NPC invocation does not match its frozen contract.");
        }
        if (row.status === "completed") {
          try { response = parseJson(row.response_json!); }
          catch { return rejectedAuthority("dueActorPlanInvocationIntegrityMismatch", "The saved NPC response is invalid."); }
          break;
        }
        if (row.status === "rejected") return rejectedAuthority("ACTOR_PLAN_DECISION_INVALID", "The bounded NPC decision was rejected.");
        if (row.status === "running" && row.lease_until > Date.now()) {
          return { kind: "retryableFailure", code: "ACTOR_PLAN_DECISION_PENDING" };
        }
        if (row.status !== "prepared") {
          return rejectedAuthority("ACTOR_PLAN_DECISION_OUTCOME_UNKNOWN", "The single NPC provider attempt has no reliable saved response; it cannot be repeated.");
        }
      }
      row ??= { prepared_action_id: rootActionId, ordinal, context_hash: contextHash,
        binding_hash: VNEXT_ACTOR_PLAN_DECISION_BINDING_HASH, request_hash: requestHash,
        request_json: JSON.stringify(modelInput), repair_ticket_json: null, capability: crypto.randomUUID(),
        lease_until: 0, status: "prepared", response_json: null };
      this.authorityStore.saveVnextInvocation(row);
      this.runAuthorityRecoveryCheckpoint("afterActorPlanInvocationPrepared");
      const binding = this.actorPlanDecisionBinding(actorPlanTransport);
      if (binding === undefined) return { kind: "retryableFailure", code: "ACTOR_PLAN_DECISION_TRANSPORT_REQUIRED" };
      row = { ...row, status: "running", lease_until: Date.now() + 60_000 };
      this.authorityStore.saveVnextInvocation(row);
      this.runAuthorityRecoveryCheckpoint("afterActorPlanInvocationStarted");
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const startedAt = Date.now();
      const emitInvocation = (result: "success" | "modelTransient", response?: unknown) => {
        try {
          console.info(JSON.stringify(buildModelInvocationTelemetryEvent({
            roomId: this.authorityStore.room()?.room_id,
            receipt: {
              provider: VNEXT_KP_PROFILE.provider, modelId: VNEXT_KP_PROFILE.modelId,
              modelRevision: VNEXT_KP_PROFILE.modelRevision, modelProfileVersion: VNEXT_KP_PROFILE.modelProfileVersion,
              promptPolicyVersion: VNEXT_KP_PROFILE.promptPolicyVersion,
              schemaVersion: VNEXT_ACTOR_PLAN_DECISION_BINDING_HASH,
              task: "proposal", invocationPurpose: "actorPlan", rootActionId, attempt: ordinal,
              startedAt, endedAt: Date.now(), result, ...usageFrom(response),
            },
          })));
        } catch { /* Telemetry cannot change a saved response or the decision's outcome. */ }
      };
      try {
        response = await Promise.race([
          binding.run(VNEXT_KP_PROFILE.modelId, modelInput, { signal: controller.signal }),
          new Promise<never>((_resolve, reject) => {
            // The server binding has a 45s provider deadline plus at most 1s
            // private capture. Preserve its completed response across that
            // instrumentation tail while staying below the 60s lease.
            timer = setTimeout(() => { controller.abort(); reject(new Error("ACTOR_PLAN_DECISION_TIMEOUT")); }, 50_000);
          }),
        ]);
        // This reports the transport result, before semantic validation. A
        // completed durable response is reused above without logging a new call.
        emitInvocation("success", response);
      } catch (error) {
        if (error !== null && typeof error === "object" && "actorPlanNotInvoked" in error
          && error.actorPlanNotInvoked === true) {
          this.authorityStore.saveVnextInvocation({ ...row, status: "prepared", lease_until: 0 });
          return { kind: "retryableFailure", code: "ACTOR_PLAN_DECISION_CALL_BUDGET_EXHAUSTED" };
        }
        emitInvocation("modelTransient");
        this.authorityStore.saveVnextInvocation({ ...row, status: "retryable", lease_until: 0 });
        return rejectedAuthority("ACTOR_PLAN_DECISION_OUTCOME_UNKNOWN", "The single NPC provider attempt has no reliable saved response; it cannot be repeated.");
      } finally { if (timer !== undefined) clearTimeout(timer); }
      const active = this.authorityStore.vnextInvocation(rootActionId, ordinal);
      if (active?.status !== "running" || active.capability !== row.capability
        || active.request_hash !== requestHash || active.context_hash !== contextHash) {
        return rejectedAuthority("dueActorPlanInvocationIntegrityMismatch", "The saved NPC invocation changed while its response was running.");
      }
      try { vnextCanonicalHash(response); }
      catch {
        this.authorityStore.saveVnextInvocation({ ...row, status: "rejected", lease_until: 0 });
        return rejectedAuthority("ACTOR_PLAN_DECISION_INVALID", "The NPC response must be canonical JSON.");
      }
      this.authorityStore.saveVnextInvocation({ ...row, status: "completed", lease_until: 0, response_json: JSON.stringify(response) });
      this.runAuthorityRecoveryCheckpoint("afterActorPlanResponseSaved");
      break;
    }
    let decision;
    try { decision = parseVnextActorPlanDecision(response, request); }
    catch { return rejectedAuthority("ACTOR_PLAN_DECISION_INVALID", "The saved NPC decision does not satisfy its frozen ActorPlan contract."); }
    const fresh = this.actorPlanRequest(this.authoritativeReplay(), due);
    if (fresh === undefined || vnextCanonicalHash(this.actorPlanProviderInput(fresh)) !== requestHash) {
      return rejectedAuthority("dueActorPlanContextChanged", "The NPC's frozen premises changed while its decision was running.");
    }
    const { kind: _kind, proposalAttemptId: _attempt, rootActionId: _root, ...decisionFields } = decision;
    const rulesInput = { kind: "resolveDueActorPlan", ...decisionFields, proposalId: rootActionId,
      affectedCharacterId: due.ownerEntityId, causedByRootActionId: work.cause_root_action_id };
    return this.commitAuthoritative({ kind: "internalDueActivity", rootActionId }, rootActionId,
      { kind: "canonicalInput", input: rulesInput as unknown as JsonObject, proposalHash: vnextCanonicalHash(rulesInput) });
  }

  /** A persisted scheduling obligation is the only authority to create this
   * internal submission. Player requests never supply its actor or input. */
  private async commitDueActivity(childRootActionId: string, actorPlanTransport?: ActorPlanTransport): Promise<AuthorityCommitOutcome> {
    const work = this.authorityStore.dueWorkByRoot(childRootActionId);
    if (work === undefined || work.status !== "pending") {
      return rejectedAuthority("dueActivityUnavailable", "The due Activity work is unavailable.");
    }
    const replay = this.authoritativeReplay();
    const frozen = parseJson<DueActivityDescriptor>(work.descriptor_json);
    if (frozen.actorPlan !== undefined) return this.commitDueActorPlanWork(childRootActionId, actorPlanTransport);
    const due = this.verifiedDueActivity(childRootActionId, replay);
    if (due === undefined) {
      if (frozen.childRootActionId === childRootActionId && frozen.activityId === work.activity_id
        && frozen.timelineId === work.timeline_id && frozen.completionFictionMicros === work.completion_fiction_micros
        && this.authorityStore.events().some(event => event.eventId === work.cause_event_id && event.rootActionId === work.cause_root_action_id)
        && (isSupersededTimePassageAdvance(replay.state, frozen) || isSupersededLongSpellcastingAdvance(replay.state, frozen) || isSupersededActivityProgress(replay.state, frozen))) {
        this.authorityStore.finishDueWork(childRootActionId, "cancelled");
        return rejectedAuthority("dueActivitySuperseded", "The authoritative clock superseded this time segment.");
      }
      const activity = replay.state.campaignRuntime.activities[work.activity_id];
      if (activity?.status === "interrupted" || activity?.status === "completed") {
        this.authorityStore.finishDueWork(childRootActionId,
          activity.status === "completed" ? "committed" : "cancelled");
        const cached = this.authorityStore.submissionByPrepared(childRootActionId)?.result_json;
        return cached ? parseJson<AuthorityCommitOutcome>(cached)
          : rejectedAuthority("dueActivityCancelled", "The activity has already settled.");
      }
      return rejectedAuthority("dueActivityIntegrityMismatch", "The frozen due Activity is no longer eligible.");
    }
    if (due.longSpellcasting?.phase === "complete"
      && replay.state.receipts[childRootActionId]?.status === "awaitingRandomness"
      && hasPendingAuthorityRoot(replay.state, childRootActionId)
      && this.authorityStore.proposalRecovery(childRootActionId) === undefined) {
      return rejectedAuthority("pendingInputUnresolved", "The spell's authorized randomness must resume through its saved answer journal.");
    }
    const viewer = this.authorityViewerForCharacter(replay.state, due.ownerEntityId);
    const completion = replay.state.campaignRuntime.activities[due.activityId]?.completion;
    const internalOwner = replay.state.entities[due.ownerEntityId]?.kind === "npc"
      || (isJsonRecord(completion) && completion.kind === "timePassage");
    if (!internalOwner && viewer === undefined) return rejectedAuthority("dueActivityOwnerUnavailable", "The activity owner has no active controller.");
    const context: AuthorityCommitContext = internalOwner
      ? { kind: "internalDueActivity", rootActionId: childRootActionId }
      : { principal: { id: viewer!.principalId, sessionVersion: viewer!.sessionVersion } };
    const rulesInput = { kind: dueActivityRulesInputKind(due),
      proposalId: childRootActionId, activityId: due.activityId };
    const proposalHash = vnextCanonicalHash(rulesInput);
    this.authorityStore.transaction(() => {
      if (this.authorityStore.submissionByPrepared(childRootActionId) !== undefined) return;
      const sceneScope = `scene:${replay.state.entities[due.ownerEntityId].sceneId}`;
      this.authorityStore.insertSubmission({
        submissionId: `due-submission:${childRootActionId}`, principalId: internalOwner ? null : viewer!.principalId,
        payloadHash: proposalHash, inputKind: "dueActivity", rootActionId: childRootActionId,
        preparedActionId: childRootActionId, characterId: due.ownerEntityId, sceneScope,
        preparedScopeVersion: this.authorityStore.scopeVersion(sceneScope),
        prepared: { kind: "prepared", preparedActionId: childRootActionId,
          rootActionId: childRootActionId, kpProjection: {}, resolutionMode: "authorityDirect" },
        continuation: { dueActivity: frozen, causeRootActionId: work.cause_root_action_id,
          causeEventId: work.cause_event_id },
      });
    });
    this.runAuthorityRecoveryCheckpoint("afterDueSubmissionBeforeCommit");
    const recovery = this.authorityStore.proposalRecovery(childRootActionId);
    return this.commitAuthoritative(context, childRootActionId, recovery === undefined
      ? { kind: "canonicalInput", input: rulesInput, proposalHash }
      : { kind: "recovery", row: recovery });
  }

  private async drainDueActivities(actorPlanTransport?: ActorPlanTransport): Promise<AuthorityCommitOutcome[]> {
    const outcomes: AuthorityCommitOutcome[] = [];
    const blockedTimelines = new Set<string>();
    let actorPlanDecisionTaken = false;
    for (let count = 0; count < 32; count += 1) {
      if (this.authorityStore.roomDeletion() !== undefined) break;
      const replay = this.authoritativeReplay();
      if (hasActiveSafetyPause(replay.state)) break;
      const availableRoots = new Set(this.dueActivities(replay.profiles, replay.state).map(due => due.childRootActionId));
      for (const work of this.authorityStore.pendingDueWork()) {
        if (parseJson<DueActivityDescriptor>(work.descriptor_json).activityProgress?.phase === "complete"
          && !availableRoots.has(work.child_root_action_id) && !hasPendingAuthorityRoot(replay.state, work.child_root_action_id)) {
          this.authorityStore.deferDueWork(work.child_root_action_id, null);
        }
      }
      const next = this.authorityStore.pendingDueWork().find(row => !blockedTimelines.has(row.timeline_id)
        && (parseJson<DueActivityDescriptor>(row.descriptor_json).activityProgress?.phase !== "complete"
          || availableRoots.has(row.child_root_action_id) || hasPendingAuthorityRoot(replay.state, row.child_root_action_id)));
      if (next === undefined) break;
      if (next.next_attempt_at === null || next.next_attempt_at > Date.now()) {
        blockedTimelines.add(next.timeline_id); continue;
      }
      const actorPlan = parseJson<DueActivityDescriptor>(next.descriptor_json).actorPlan;
      if (actorPlan !== undefined && actorPlanDecisionTaken) { blockedTimelines.add(next.timeline_id); continue; }
      if (actorPlan !== undefined) actorPlanDecisionTaken = true;
      let outcome: AuthorityCommitOutcome;
      try { outcome = await this.commitDueActivity(next.child_root_action_id, actorPlanTransport); }
      catch { outcome = { kind: "retryableFailure", code: "dueActivitySettlementInterrupted" }; }
      outcomes.push(outcome);
      if (this.authorityStore.dueWorkByRoot(next.child_root_action_id)?.status !== "pending") continue;
      // Player gesture and deterministic failures must not turn into a hot
      // alarm loop. Their durable journal remains available for explicit resume.
      this.authorityStore.deferDueWork(next.child_root_action_id,
        outcome.kind === "retryableFailure"
          && outcome.code !== "ACTOR_PLAN_DECISION_TRANSPORT_REQUIRED"
          && outcome.code !== "ACTOR_PLAN_DECISION_CALL_BUDGET_EXHAUSTED" ? Date.now() + 30_000 : null);
      blockedTimelines.add(next.timeline_id);
    }
    await this.scheduleExpiryAlarm();
    return outcomes;
  }

  /** Durable due roots retain their immediate cause. Following that stored
   * chain lets a retry of the original wait resume its later segment without
   * treating an unrelated player action as permission to advance the clock. */
  private dueWorkDescendsFrom(work: { child_root_action_id: string; cause_root_action_id: string }, rootActionId: string): boolean {
    const visited = new Set<string>();
    let cursor: typeof work | undefined = work;
    while (cursor !== undefined && !visited.has(cursor.child_root_action_id)) {
      if (cursor.cause_root_action_id === rootActionId) return true;
      visited.add(cursor.child_root_action_id);
      cursor = this.authorityStore.dueWorkByRoot(cursor.cause_root_action_id);
    }
    return false;
  }

  private async withDueTail(outcome: AuthorityCommitOutcome, actorPlanTransport?: ActorPlanTransport): Promise<AuthorityCommitOutcome> {
    if ((outcome.kind !== "committed" && outcome.kind !== "concluded")
      || this.vnextAdjudicationBridge === undefined) return outcome;
    const causedPending = this.authorityStore.pendingDueWork()
      .some(work => this.dueWorkDescendsFrom(work, outcome.receipt.rootActionId));
    // A completion already queued at the notice's exact deadline keeps its
    // original cause. Acknowledging that activity must nevertheless drain it
    // in this request, rather than waiting for another action or an alarm.
    const resumedActivityIds = new Set(this.authorityStore.events().flatMap(event => event.rootActionId === outcome.receipt.rootActionId
      && event.eventType === "ActivityAttentionAcknowledged" ? [String((event.payload as JsonObject).activityId)] : []));
    const resumesPending = this.authorityStore.pendingDueWork().some(work => resumedActivityIds.has(work.activity_id));
    if (!causedPending && !resumesPending && this.authorityStore.dueWorkByRoot(outcome.receipt.rootActionId) === undefined) return outcome;
    for (const work of this.authorityStore.pendingDueWork()) {
      if (!this.dueWorkDescendsFrom(work, outcome.receipt.rootActionId)) continue;
      const invocation = this.authorityStore.vnextInvocation(work.child_root_action_id, 1);
      // Explicit retry can resume a saved response immediately, without any
      // new provider call. A request never dispatched can use a fresh call
      // scope; an unknown response never becomes eligible for resampling.
      if (invocation?.status === "completed"
        || (actorPlanTransport !== undefined && invocation?.status === "prepared")) {
        this.authorityStore.deferDueWork(work.child_root_action_id, 0);
      }
    }
    this.runAuthorityRecoveryCheckpoint("afterCauseCommitBeforeDueTail");
    const dueOutcomes = await this.drainDueActivities(actorPlanTransport);
    return dueOutcomes.length === 0 ? outcome : { ...outcome, dueOutcomes };
  }

  async commit(
    context: TrustedPrincipalContext,
    preparedActionId: string,
    mechanicalProposal: unknown,
    actorPlanTransport?: ActorPlanTransport,
  ): Promise<AuthorityCommitOutcome> {
    if (this.authorityStore.roomDeletion() !== undefined) {
      return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
    }
    if (isJsonRecord(mechanicalProposal) && mechanicalProposal.kind === "npcPendingDecision") {
      return this.withDueTail(await this.commitNpcDecision(context, preparedActionId, mechanicalProposal), actorPlanTransport);
    }
    const stage = nonEmptyString(preparedActionId)
      ? this.authorityStore.actionStage(preparedActionId)
      : undefined;
    if (
      stage !== undefined
      && (stage.status === "prepared"
        || (isJsonRecord(mechanicalProposal) && mechanicalProposal.kind === "actorPlanDecision"))
    ) {
      return this.withDueTail(await this.commitDueActorPlan(context, preparedActionId, mechanicalProposal), actorPlanTransport);
    }
    return this.withDueTail(await this.commitAuthoritative(
      context,
      preparedActionId,
      { kind: "proposal", value: mechanicalProposal },
    ), actorPlanTransport);
  }

  async resumePlayerRandomness(
    context: TrustedPrincipalContext,
    randomnessId: string,
    actorPlanTransport?: ActorPlanTransport,
  ): Promise<AuthorityCommitOutcome> {
    if (this.authorityStore.roomDeletion() !== undefined) {
      return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
    }
    if (!nonEmptyString(randomnessId)) {
      return rejectedAuthority("privateOrUnknownReference", "The randomness request is unavailable.");
    }
    let replay = this.authoritativeReplay();
    const authenticated = this.authenticatedAuthorityViewer(context, replay.state);
    if (authenticated === undefined || !this.authorityPlayerRollGestureRequired(replay.profiles)) {
      return rejectedAuthority("privateOrUnknownReference", "The randomness request is unavailable.");
    }

    // A lost HTTP response must not turn the player's explicit roll gesture
    // into a second draw. The finalized journal remains the capability source;
    // only the character's current trusted controller may recover its cached
    // outcome, including after an exact control transfer.
    for (const authorization of this.authorityStore
      .randomnessAuthorizationsByRandomnessId(randomnessId)) {
      const batch = this.authorityStore.randomnessBatch(authorization.prepared_action_id);
      const directSubmission = this.authorityStore.submissionByPrepared(
        authorization.prepared_action_id,
      );
      const dueStage = directSubmission === undefined
        ? this.authorityStore.actionStageByChildRoot(authorization.prepared_action_id)
        : undefined;
      const cachedResultJson = directSubmission?.result_json ?? dueStage?.result_json;
      const active = batch?.status === "finalized"
        ? this.authorityActiveRandomnessRequests({ batch })
        : undefined;
      const request = active?.requests.find((entry) =>
        entry.randomnessId === randomnessId);
      const currentOwner = authenticated.characterIds.includes(authorization.character_id)
        ? authorization.character_id : undefined;
      if (
        batch?.status !== "finalized"
        || cachedResultJson === null
        || cachedResultJson === undefined
        || request === undefined
        || active === undefined
        || !this.authorityPlayerRollGestureRequired(
          replay.profiles,
          request.request,
        )
        || currentOwner === undefined
        || authorization.character_id !== currentOwner
        || !authenticated.characterIds.includes(currentOwner)
      ) continue;
      return this.withDueTail(parseJson<AuthorityCommitOutcome>(cachedResultJson), actorPlanTransport);
    }

    for (const submission of this.authorityStore.awaitingRandomnessSubmissions()) {
      const batchKey = this.authorityRandomnessBatchKey(submission);
      const batch = this.authorityStore.randomnessBatch(batchKey);
      if (batch?.status !== "requestCommitted" && batch?.status !== "candidateCommitted") continue;
      const active = this.authorityActiveRandomnessRequests({ batch });
      const request = active?.requests.find((entry) => entry.randomnessId === randomnessId);
      if (active === undefined || request === undefined) continue;
      if (!this.authorityPlayerRollGestureRequired(
        replay.profiles,
        request.request,
      )) {
        return rejectedAuthority("privateOrUnknownReference", "The randomness request is unavailable.");
      }
      const ownerCharacterId = this.authorityPlayerRollOwners(
        replay.state,
        request.request,
        active.requestEvents,
      ).find(owner => authenticated.characterIds.includes(owner));
      if (ownerCharacterId === undefined || !authenticated.characterIds.includes(ownerCharacterId)) {
        return rejectedAuthority("privateOrUnknownReference", "The randomness request is unavailable.");
      }

      const authorized = this.authorityStore.transaction(() => {
        replay = this.authoritativeReplay();
        const currentViewer = this.authenticatedAuthorityViewer(context, replay.state);
        const currentSubmission = this.authorityStore.submissionByPrepared(
          submission.prepared_action_id,
        );
        const currentBatch = this.authorityStore.randomnessBatch(batchKey);
        const currentActive = currentBatch?.status === "requestCommitted"
          || currentBatch?.status === "candidateCommitted"
          ? this.authorityActiveRandomnessRequests({ batch: currentBatch })
          : undefined;
        const currentRequest = currentActive?.requests.find((entry) =>
          entry.randomnessId === randomnessId);
        const currentOwner = currentRequest === undefined || currentActive === undefined
          ? undefined
          : this.authorityPlayerRollOwners(
              replay.state,
              currentRequest.request,
              currentActive.requestEvents,
            ).find(owner => currentViewer?.characterIds.includes(owner));
        if (
          currentViewer === undefined
          || currentSubmission?.status !== "awaitingRandomness"
          || currentRequest === undefined
          || currentActive === undefined
          || !this.authorityPlayerRollGestureRequired(
            replay.profiles,
            currentRequest.request,
          )
          || currentOwner === undefined
          || !currentViewer.characterIds.includes(currentOwner)
        ) return false;
        const existing = this.authorityStore.randomnessAuthorizations(batchKey)
          .find((entry) => entry.randomness_id === randomnessId && entry.character_id === currentOwner);
        if (existing !== undefined) {
          return existing.character_id === currentOwner;
        }
        this.authorityStore.authorizeRandomness({
          prepared_action_id: batchKey,
          randomness_id: randomnessId,
          principal_id: currentViewer.principalId,
          character_id: currentOwner,
        });
        return true;
      });
      if (!authorized) {
        return rejectedAuthority("privateOrUnknownReference", "The randomness request is unavailable.");
      }

      const recovery = this.authorityStore.proposalRecovery(batchKey);
      if (recovery === undefined) {
        return { kind: "retryableFailure", code: "randomnessRecoveryInputMissing" };
      }
      // A target's roll can complete another character's frozen action. NPC
      // due work keeps its persisted internal authority, verified again by commit.
      const actorViewer = this.authorityViewerForCharacter(replay.state, submission.character_id);
      const continuationContext: AuthorityCommitContext | undefined = submission.input_kind === "dueActivity" && submission.principal_id === null
        ? { kind: "internalDueActivity", rootActionId: submission.root_action_id }
        : authenticated.characterIds.includes(submission.character_id) ? context
        : actorViewer === undefined ? undefined : { principal: { id: actorViewer.principalId,
            sessionVersion: actorViewer.sessionVersion! } };
      if (continuationContext === undefined) return rejectedAuthority("privateOrUnknownReference", "The action controller is unavailable.");
      const resumed = await this.commitAuthoritative(
        continuationContext,
        submission.prepared_action_id,
        { kind: "recovery", row: recovery },
      );
      return resumed.kind === "awaitingPlayerRoll"
        ? this.awaitingPlayerRollOutcome(this.authoritativeReplay(), authenticated)
        : this.withDueTail(resumed, actorPlanTransport);
    }
    return rejectedAuthority("privateOrUnknownReference", "The randomness request is unavailable.");
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
      stage.status === "prepared"
      && stage.proposal_hash === proposalHash
      && stage.result_json !== null
    ) {
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

    const dueProjection = this.rulesRuntime.project(
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
    const stepped = this.rulesRuntime.step(replay.profiles, replay.state, rulesInput);
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
      resumedActionInput: this.authorityResumedPlayerIntent(submission),
      resumedPrincipalContext: this.authorityResumedPrincipalContext(
        stepped.state,
        submission,
      ),
    };
    if (
      prepared.resumedActionInput === undefined
      || prepared.resumedPrincipalContext === undefined
    ) {
      return rejectedAuthority(
        "continuationUnavailable",
        "The original player intent is unavailable after the due ActorPlan stage.",
      );
    }
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
      if (this.authorityStore.hasRandomnessSettlementInScene(
        currentSubmission.scene_scope,
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
      this.appendAuthorityTransition(stepped.state, stepped.events);
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

  private async suspendDueActorPlanMechanicalStage(input: {
    context: TrustedPrincipalContext;
    preparedActionId: string;
    proposalHash: string;
    journalPreparedActionId: string;
    replay: AuthorityReplay;
    submission: AuthoritySubmissionRow;
    stage: AuthorityActionStageRow;
    resolved: Extract<ReturnType<typeof stepAuthoritative>, { kind: "awaitingInput" }>;
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
    const plan = resolved.state.campaignRuntime.npcPlans[stage.target_id]
      ?? replay.state.campaignRuntime.npcPlans[stage.target_id];
    const npcId = nonEmptyString(plan?.npcId) ? plan.npcId : undefined;
    const pendingBindings = authorityPendingBindings(
      resolved.state,
      stage.child_root_action_id,
    );
    const currentBinding = pendingBindings.find((entry) =>
      entry.pendingInputId === resolved.pending.pendingInputId);
    if (npcId === undefined || receiptEvents.length === 0 || currentBinding === undefined) {
      return rejectedAuthority(
        "invalidRulesResult",
        "The due ActorPlan pending result has no canonical actor, controller, or event range.",
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
      return usedRandomnessJournal
        ? { kind: "retryableFailure", code: "projectionFailure" }
        : rejectedAuthority(
            "projectionFailure",
            "The player intent could not be reprojected while the due ActorPlan awaits input.",
          );
    }
    const nextScopeVersion = this.authorityStore.scopeVersion(submission.scene_scope) + 1;
    const receipt: PublicReceipt = {
      receiptId: resolved.receipt.receiptId,
      rootActionId: stage.child_root_action_id,
      actorCharacterId: npcId,
      status: "awaitingInput",
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
      pendingInputId: currentBinding.pendingInputId,
    };
    const pending: JsonObject = {
      ...currentBinding.pending,
      controllerCharacterId: currentBinding.controllerCharacterId,
      controllerPrincipalId: currentBinding.controllerPrincipalId,
    };
    const pendingMessageBody = pendingTranscriptBody(pending);
    const pendingMessage = pendingMessageBody === undefined
      ? undefined
      : {
          viewerKey: `${currentBinding.controllerPrincipalId}\u001f${currentBinding.controllerCharacterId}`,
          messageId: `pending:${currentBinding.pendingInputId}:prompt`,
          sceneIds: uniqueSceneIds([
            replay.state.entities[currentBinding.controllerCharacterId]?.sceneId,
            resolved.state.entities[currentBinding.controllerCharacterId]?.sceneId,
          ]),
          body: pendingMessageBody,
        };
    const outcome: AuthorityCommitOutcome = {
      kind: "awaitingInput",
      receipt,
      pending,
      kpProjection: {
        ...projected,
        mechanicalResult: {
          kind: resolved.kind,
          randomness: structuredClone(randomness),
        },
      },
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
        || currentStage === undefined
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
      if (
        currentSubmission.status !== (usedRandomnessJournal ? "awaitingRandomness" : "prepared")
        || currentStage.status !== "prepared"
        || currentStage.child_root_action_id !== stage.child_root_action_id
        || currentStage.target_id !== stage.target_id
        || (currentStage.proposal_hash !== null
          && currentStage.proposal_hash !== proposalHash)
        || this.authorityStore.scopeVersion(currentSubmission.scene_scope)
          !== currentSubmission.prepared_scope_version
      ) {
        return {
          outcome: rejectedAuthority(
            "scopeConflict",
            "The due ActorPlan pending stage changed before it could be persisted.",
          ),
          committedHere: false,
        };
      }
      if (this.authorityStore.hasRandomnessSettlementInScene(
        currentSubmission.scene_scope,
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
      this.appendAuthorityTransition(resolved.state, eventsToAppend);
      this.authorityStore.advanceScope(currentSubmission.scene_scope);
      this.authorityStore.saveReceipt(receipt);
      this.authorityStore.syncAuthorityIndex(resolved.state);
      this.authorityStore.syncPendingAuthority(resolved.state);
      if (pendingMessage !== undefined) {
        this.authorityStore.appendExperiencedMessage({
          viewerKey: pendingMessage.viewerKey,
          messageId: pendingMessage.messageId,
          sceneIds: pendingMessage.sceneIds,
          kind: "kp",
          speakerCharacterId: null,
          speakerName: "KP",
          body: pendingMessage.body,
          sourceEventSeq: receiptEvents[receiptEvents.length - 1].eventSeq,
          receiptId: receipt.receiptId,
        });
      }
      if (usedRandomnessJournal) {
        this.authorityStore.finalizeRandomnessBatch(journalPreparedActionId);
      }
      this.authorityStore.saveSuspendedActionStage(
        preparedActionId,
        proposalHash,
        outcome,
      );
      this.authorityStore.advancePreparedSubmission({
        preparedActionId,
        preparedScopeVersion: nextScopeVersion,
        prepared: parseJson<PreparedAuthoritativeAction>(currentSubmission.prepared_json),
      });
      this.authorityStore.markArchivePending(Date.now());
      return { outcome, committedHere: true };
    });
    if (persisted.committedHere && usedRandomnessJournal) {
      this.runAuthorityRecoveryCheckpoint("afterOutcomeCommitBeforeResponse");
    }
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
      return usedRandomnessJournal
        ? { kind: "retryableFailure", code: "projectionFailure" }
        : rejectedAuthority(
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
      resumedActionInput: this.authorityResumedPlayerIntent(submission),
      resumedPrincipalContext: this.authorityResumedPrincipalContext(
        resolved.state,
        submission,
      ),
    };
    if (
      prepared.resumedActionInput === undefined
      || prepared.resumedPrincipalContext === undefined
    ) {
      return rejectedAuthority(
        "continuationUnavailable",
        "The original player intent is unavailable after the due ActorPlan mechanics.",
      );
    }
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
      if (this.authorityStore.hasRandomnessSettlementInScene(
        currentSubmission.scene_scope,
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
      this.appendAuthorityTransition(resolved.state, eventsToAppend);
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
    context: AuthorityCommitContext,
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
    const playerContext = "principal" in context ? context : undefined;
    const authenticated = playerContext === undefined ? undefined : this.authenticatedAuthorityViewer(playerContext, replay.state);
    const submission = this.authorityStore.submissionByPrepared(preparedActionId);
    const internalDueActivity = this.authorizedInternalDueActivity(context, source, submission, replay);
    if (authenticated === undefined && !internalDueActivity) {
      return rejectedAuthority("unauthenticated", "The trusted principal session is unavailable.");
    }
    const dueWork = submission?.input_kind === "dueActivity"
      ? this.authorityStore.dueWorkByRoot(submission.root_action_id) : undefined;
    const internalDueRecovery = dueWork !== undefined && source.kind !== "proposal";
    const transferredRandomnessRecovery = source.kind === "recovery"
      && submission !== undefined
      && authenticated?.characterIds.includes(submission.character_id) === true;
    if (submission === undefined
      || (!internalDueActivity && submission.principal_id !== authenticated?.principalId
        && !transferredRandomnessRecovery && !internalDueRecovery)) {
      return rejectedAuthority("preparedActionUnauthorized", "The prepared action is unavailable.");
    }
    if (!internalDueActivity && authenticated?.characterIds.includes(submission.character_id) !== true) {
      return rejectedAuthority(
        "preparedActionUnauthorized",
        "The prepared action's character is no longer controlled by this principal.",
      );
    }
    const actionStage = this.authorityStore.actionStage(preparedActionId);
    if (submission.input_kind === "dueActivity" && (dueWork === undefined || source.kind === "proposal")) {
      return rejectedAuthority("preparedActionUnauthorized", "Only persisted due work may complete an Activity.");
    }
    const usesVNextTransactionReadSet = dueWork !== undefined || this.preparedActionSnapshot(submission)
      ?.requiredContext !== undefined;

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
      dueActorPlanStage = recovery.rulesInput.kind === "resolveDueActorPlan" && dueWork === undefined;
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
      dueActorPlanStage = source.input.kind === "resolveDueActorPlan" && dueWork === undefined;
      proposalHash = source.proposalHash;
      answeredPendingInputId = source.answeredPendingInputId;
      adapted = {
        input: structuredClone(source.input),
        ...(source.receiptExtras === undefined ? {} : { receiptExtras: structuredClone(source.receiptExtras) }),
        ...(source.forceConcluded === true ? { forceConcluded: true } : {}),
      };
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
      if (authenticated === undefined) return rejectedAuthority("preparedActionUnauthorized", "Movement requires a trusted player.");
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
    if (!usesVNextTransactionReadSet
      && this.authorityStore.scopeVersion(submission.scene_scope)
        !== submission.prepared_scope_version) {
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
      if (source.kind !== "proposal" || authenticated === undefined) {
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
            revisionHint: "保留玩家目标与做法，按当前私有 Form 或精确 typed command 修订后重新提交。",
            secrecy: "kp",
          }]);
        }
        return externalAdapted.rejection;
      }
      adapted = externalAdapted;
      replay = this.authoritativeReplay();
    }

    let rulesInput = adapted.input;
    const dueDescriptor = dueWork === undefined ? undefined : parseJson<DueActivityDescriptor>(dueWork.descriptor_json);
    if (dueWork !== undefined && (rulesInput.proposalId !== dueWork.child_root_action_id
      || (dueDescriptor?.actorPlan === undefined
        ? rulesInput.kind !== dueActivityRulesInputKind(dueDescriptor!)
          || rulesInput.activityId !== dueWork.activity_id
        : rulesInput.kind !== "resolveDueActorPlan" || rulesInput.planId !== dueDescriptor.actorPlan.planId
          || rulesInput.affectedCharacterId !== dueDescriptor.ownerEntityId
          || rulesInput.causedByRootActionId !== dueWork.cause_root_action_id))) {
      return { kind: "retryableFailure", code: "proposalRecoveryIntegrityMismatch" };
    }
    // A validated durable random journal continues its frozen operation; it
    // must finish before due work waiting on the same scene can make progress.
    const permitsPendingDue = randomnessBatch !== undefined
      || (dueDescriptor?.activityProgress !== undefined && rulesInput.kind === dueActivityRulesInputKind(dueDescriptor))
      || (dueDescriptor?.timePassage !== undefined && rulesInput.kind === "advanceTimePassage")
      || (dueDescriptor?.longSpellcasting !== undefined && rulesInput.kind === dueActivityRulesInputKind(dueDescriptor))
      || ["knowledgeReview", "completeActivity", "interruptActivity", "controlActivity", "completeActionActivity",
      "answerPendingInput", "answerFrozenPlayerChoice", "answerGroupRestInvitation", "answerPartyInvitation", "answerPartyMove", "answerSocialResolution",
      "resolveDueActorPlan", "requestSafetyPause", "adjustSafetyPresentation"].includes(String(rulesInput.kind));
    if (!permitsPendingDue && this.vnextAdjudicationBridge !== undefined) {
      const timelineId = characterTimelineId(replay.state, submission.character_id);
      const sceneId = replay.state.entities[submission.character_id]?.sceneId;
      const due = this.dueActivities(replay.profiles, replay.state);
      if (due.some(work => work.timelineId === timelineId || work.sceneIds.includes(sceneId ?? ""))) {
        return rejectedAuthority("dueActivityPending", "Previously triggered activity effects must settle before this action. The frozen proposal has not committed.");
      }
      if (authenticated !== undefined && this.viewerPendingPlayerRolls(replay, authenticated).length > 0) {
        return rejectedAuthority("pendingInputUnresolved", "The authorized dice request must settle before a new world action.");
      }
    }
    const storedNpcDecision = this.authorityStore.npcDecision(preparedActionId);
    const npcDecision = storedNpcDecision?.proposal_hash === proposalHash ? storedNpcDecision : undefined;
    if (npcDecision !== undefined && npcDecision.answer_json === null) {
      return this.npcDecisionOutcome(submission, npcDecision);
    }
    const npcAnswerInput = npcDecision?.answer_json === null || npcDecision === undefined
      ? undefined : {
          kind: "answerPendingInput",
          pendingInputId: npcDecision.pending_input_id,
          responseId: `npc-response:${await authorityHash({ preparedActionId, pendingInputId: npcDecision.pending_input_id })}`,
          answer: parseJson<JsonObject>(npcDecision.answer_json),
        };
    if (source.kind === "proposal"
      && socialResolutionProfileEnabled(replay.profiles.extensions)
      && rulesInput.kind === "executeCausalActionProgram"
      && isJsonRecord(rulesInput.causalActionProgram)
      && rulesInput.causalActionProgram.formRef === "npc-exchange.v1") {
      const continuation = submission.continuation_json === null
        ? undefined
        : parseJson<JsonObject>(submission.continuation_json);
      const originalInput = isJsonRecord(continuation?.originalInput)
        ? continuation.originalInput
        : undefined;
      const answer = isJsonRecord(continuation?.answer) ? continuation.answer : undefined;
      const trustedUtterance = submission.input_kind === "intent"
        ? originalInput?.text
        : submission.input_kind === "answer"
          ? continuation?.displayText ?? answer?.text
          : undefined;
      if (!nonEmptyString(trustedUtterance)) {
        return rejectedAuthority(
          "invalidMechanicalProposal",
          "The social proposal is missing the authenticated player's exact utterance.",
        );
      }
      rulesInput = {
        ...rulesInput,
        trustedUtterance,
      };
    }
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
      if (replay.state.frozenPlayerChoices?.[continuation.pendingInputId] !== undefined || rulesInput.kind === "answerFrozenPlayerChoice") {
        const saved = frozenPlayerChoiceAnswer(replay.state, { pendingInputId: continuation.pendingInputId,
          rootActionId: submission.root_action_id, controllerCharacterId: submission.character_id }, continuation.answer);
        if (saved === undefined || vnextCanonicalHash(saved) !== vnextCanonicalHash(rulesInput))
          return rejectedAuthority("invalidPendingResolution", "The pending answer must select its original frozen plan.");
        rulesInput = saved;
      } else if (
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
      } else if (rulesInput.kind === "answerSocialResolution") {
        if (
          !hasExactJsonKeys(continuation.answer, ["choice"])
          || !["press", "acceptStatusQuo"].includes(String(continuation.answer.choice))
          || rulesInput.choice !== continuation.answer.choice
          || rulesInput.pendingInputId !== continuation.pendingInputId
          || rulesInput.rootActionId !== submission.root_action_id
          || rulesInput.controllerCharacterId !== submission.character_id
        ) {
          return rejectedAuthority(
            "invalidPendingResolution",
            "The social continuation must preserve the authenticated player's choice.",
          );
        }
        rulesInput = {
          kind: "answerSocialResolution",
          pendingInputId: continuation.pendingInputId,
          rootActionId: submission.root_action_id,
          controllerCharacterId: submission.character_id,
          choice: continuation.answer.choice,
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
      } else if (rulesInput.kind === "executeCausalActionProgram") {
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
      && submission.input_kind !== "party"
      && submission.input_kind !== "gear"
      && submission.input_kind !== "itemActivity"
      && submission.input_kind !== "environmentInteract"
      && submission.input_kind !== "environmentAbility"
      && submission.input_kind !== "movement"
      && submission.input_kind !== "combatEndTurn"
      && submission.input_kind !== "restStart"
      && submission.input_kind !== "restInterrupt"
      && submission.input_kind !== "activityControl"
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
    const projectionFailure = (explanation: string): AuthorityCommitOutcome => {
      return usedRandomnessJournal
        ? { kind: "retryableFailure", code: "projectionFailure" }
        : rejectedAuthority("projectionFailure", explanation);
    };
    const audienceProjectionFailure = (
      outcome: AuthorityCommitOutcome,
    ): AuthorityCommitOutcome => {
      return usedRandomnessJournal ? { kind: "retryableFailure", code: "projectionFailure" } : outcome;
    };
    let randomness: Array<{
      randomnessId: string;
      faces: number[];
      requestHash: string;
      frozenParametersHash: string;
    }> = [];
    if (randomnessBatch === undefined) {
      const readSetConflict = this.validatePreparedReadSet(
        submission,
        replay,
        "beforeFirstRulesStep",
        rulesInput,
      );
      if (readSetConflict !== undefined) return readSetConflict;
      const first = this.rulesRuntime.step(replay.profiles, replay.state,
        npcDecision?.wave_index === -1 && npcAnswerInput !== undefined ? npcAnswerInput : rulesInput);
      if (first.kind === "awaitingInput" && isJsonRecord(first.pending) && first.pending.kind === "kpDecision") {
        return this.suspendNpcDecision({ submission, proposalHash, journalPreparedActionId,
          waveIndex: -1, replay, canonical: { ...adapted, answeredPendingInputId }, resolved: first });
      }
      if (first.kind === "needsKp") {
        return needsKp(first.diagnostics.map((diagnostic) => ({
          ...structuredClone(diagnostic),
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
        const socialPendingReframe = submission.input_kind === "answer"
          && answeredPendingInputId !== undefined
          && replay.state.pendingInputs[answeredPendingInputId]?.kind === "socialResolution";
        if (
          !isWorldRuling
          && (submission.input_kind === "intent" || socialPendingReframe)
          && source.kind === "proposal"
        ) {
          const diagnostics = first.rejection.diagnostics;
          return needsKp(diagnostics?.length ? diagnostics.map(diagnostic => ({
            ...structuredClone(diagnostic),
            publicPath: diagnostic.message,
            revisionHint: "当前诊断不授予修改冻结目标或裁决的权限。",
            secrecy: "kp",
            rulesMessage: first.rejection.message,
          })) : [{
            code: first.rejection.code,
            publicPath: "KP 提案未通过权威机械诊断。",
            revisionHint: "依据 Rules 诊断修订当前机械提案；不得改变玩家原始目标、提供骰面或提交状态补丁。",
            secrecy: "kp",
            rulesMessage: first.rejection.message,
          }]);
        }
        return rejectedAuthority(first.rejection.code, first.rejection.message, first.rejection.diagnostics);
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
            || (!usesVNextTransactionReadSet
              && this.authorityStore.scopeVersion(current.scene_scope)
                !== current.prepared_scope_version)
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
            || (!usesVNextTransactionReadSet
              && this.authorityStore.scopeVersion(current.scene_scope)
                !== current.prepared_scope_version)
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
          const readSetConflict = this.validatePreparedReadSet(
            current,
            this.authoritativeReplay(),
            "beforeFirstRulesStep",
            rulesInput,
          );
          if (readSetConflict !== undefined) {
            return { kind: "outcome" as const, outcome: readSetConflict };
          }
          if (dueWork !== undefined && first.events[0]?.previousEventHash !== this.authoritativeReplay().replay.head.eventHash) {
            return { kind: "outcome" as const,
              outcome: { kind: "retryableFailure" as const, code: "dueActivityHeadConflict" } };
          }
          this.appendAuthorityTransition(first.state, first.events);
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

        const activeRequests = journalRequests.slice(completedRequestCount);
        if (candidates.length === completedRequestCount) {
          if (this.authorityPlayerRollGestureRequired(replay.profiles)) {
            const authorized = new Set(
              this.authorityStore.randomnessAuthorizations(journalPreparedActionId)
                .map((entry) => `${entry.randomness_id}\u001f${entry.character_id}`),
            );
            const waitingForPlayer = activeRequests.some((entry) =>
              this.authorityPlayerRollGestureRequired(
                replay.profiles,
                entry.request,
              )
              && this.authorityPlayerRollOwners(replay.state, entry.request, requestEvents)
                .some(owner => !authorized.has(`${entry.randomnessId}\u001f${owner}`)));
            if (waitingForPlayer) {
              return authenticated === undefined ? { kind: "awaitingPlayerRoll", pendingPlayerRolls: [] }
                : this.awaitingPlayerRollOutcome(replay, authenticated);
            }
          }
          if (this.authorityStore.roomDeletion() !== undefined) {
            return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
          }
          const readSetConflict = this.validatePreparedReadSet(
            submission,
            replay,
            "beforeRandomnessWave",
            rulesInput,
          );
          if (readSetConflict !== undefined) return readSetConflict;
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
              || (!usesVNextTransactionReadSet
                && this.authorityStore.scopeVersion(current.scene_scope)
                  !== current.prepared_scope_version)
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
        const readSetConflict = this.validatePreparedReadSet(
          submission,
          replay,
          "beforeRandomnessWave",
          rulesInput,
        );
        if (readSetConflict !== undefined) return readSetConflict;
        const fulfilled = this.rulesRuntime.step(replay.profiles, replay.state,
          npcDecision?.wave_index === activeWaveIndex && npcAnswerInput !== undefined
            ? npcAnswerInput : fulfillmentInput);
        if (fulfilled.kind === "awaitingInput" && isJsonRecord(fulfilled.pending) && fulfilled.pending.kind === "kpDecision") {
          return this.suspendNpcDecision({ submission, proposalHash, journalPreparedActionId,
            waveIndex: activeWaveIndex, replay, canonical: { ...adapted, answeredPendingInputId }, resolved: fulfilled });
        }
        if (fulfilled.kind === "needsKp") {
          return needsKp(fulfilled.diagnostics.map((diagnostic) => ({
            ...structuredClone(diagnostic),
            code: diagnostic.code,
            publicPath: diagnostic.message,
            revisionHint: "保持已冻结参数与骰面，修订后续能力定义而不得重掷。",
            secrecy: "kp",
            ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
            source: diagnostic.source,
          })));
        }
        if (fulfilled.kind === "rejected") {
          return rejectedAuthority(fulfilled.rejection.code, fulfilled.rejection.message, fulfilled.rejection.diagnostics);
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
              || (!usesVNextTransactionReadSet
                && this.authorityStore.scopeVersion(current.scene_scope)
                  !== current.prepared_scope_version)
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
            const readSetConflict = this.validatePreparedReadSet(
              current,
              this.authoritativeReplay(),
              "beforeRandomnessWave",
              rulesInput,
            );
            if (readSetConflict !== undefined) {
              return { kind: "outcome" as const, outcome: readSetConflict };
            }
            this.appendAuthorityTransition(fulfilled.state, fulfilled.events);
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
        const requestTail = requestEvents.at(-1);
        const fulfillmentHead = fulfilled.events[0];
        const requestAndFulfillmentAreContiguous = requestTail !== undefined
          && fulfillmentHead !== undefined
          && requestEvents.every((event) => event.rootActionId === fulfillmentHead.rootActionId)
          && fulfilled.events.every((event) => event.rootActionId === fulfillmentHead.rootActionId)
          && (BigInt(requestTail.eventSeq) + 1n).toString() === fulfillmentHead.eventSeq
          && fulfillmentHead.previousEventHash === requestTail.eventHash
          && fulfillmentHead.parentEventId === requestTail.eventId;
        // Room administration may legitimately transfer a pending player-roll
        // gesture between the request and fulfillment. A committed projection
        // must receive one contiguous Rules segment, so in that case its
        // pre-state starts after administration and its range contains only the
        // fulfillment events; the append-only archive still retains the full
        // request, administration, and fulfillment history.
        receiptEvents = requestAndFulfillmentAreContiguous
          ? [...requestEvents, ...fulfilled.events]
          : [...fulfilled.events];
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
      if (actionStage === undefined || playerContext === undefined) {
        return rejectedAuthority(
          "invalidRulesResult",
          "Due ActorPlan mechanics lost their frozen child stage.",
        );
      }
      if (resolved.kind === "awaitingInput") {
        return this.suspendDueActorPlanMechanicalStage({
          context: playerContext,
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
      if (resolved.kind !== "committed") {
        return rejectedAuthority(
          "invalidRulesResult",
          "Due ActorPlan mechanics must settle or await one authenticated input.",
        );
      }
      return this.finishDueActorPlanMechanicalStage({
        context: playerContext,
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
    let suspendedDue: {
      stage: AuthorityActionStageRow;
      parent: AuthoritySubmissionRow;
      outcome: Extract<AuthorityCommitOutcome, { kind: "awaitingInput" }>;
      proposalHash: string;
    } | undefined;
    if (answeredPendingInputId !== undefined) {
      const linkedStage = this.authorityStore.actionStageByChildRoot(
        submission.root_action_id,
      );
      if (linkedStage?.status === "prepared") {
        const linkedParent = this.authorityStore.submissionByPrepared(
          linkedStage.prepared_action_id,
        );
        let linkedOutcome: AuthorityCommitOutcome | undefined;
        try {
          linkedOutcome = linkedStage.result_json === null
            ? undefined
            : parseJson<AuthorityCommitOutcome>(linkedStage.result_json);
        } catch {
          linkedOutcome = undefined;
        }
        if (
          linkedStage.proposal_hash === null
          || linkedParent === undefined
          || linkedParent.status !== "prepared"
          || linkedParent.scene_scope !== submission.scene_scope
          || linkedParent.prepared_scope_version !== submission.prepared_scope_version
          || linkedOutcome?.kind !== "awaitingInput"
          || !isJsonRecord(linkedOutcome.pending)
          || linkedOutcome.pending.pendingInputId !== answeredPendingInputId
          || linkedOutcome.receipt.rootActionId !== linkedStage.child_root_action_id
        ) {
          return { kind: "retryableFailure", code: "actorPlanPendingIntegrityMismatch" };
        }
        suspendedDue = {
          stage: linkedStage,
          parent: linkedParent,
          outcome: linkedOutcome,
          proposalHash: linkedStage.proposal_hash,
        };
      }
    }
    if (worldInteractionProfileEnabled(replay.profiles.extensions)
      && (["answerPartyInvitation", "answerPartyMove"].includes(String(rulesInput.kind))
        || (resolved.kind !== "awaitingInput"
          && (committedRangeUsesFrozenRenderableClaims(receiptEvents)
            || Object.values(replay.state.frozenPlayerChoices ?? {}).some(choice => choice.plan.rootActionId === resolved.receipt.rootActionId))))) {
      // Projection verifies the complete global journal interval, including
      // other roots that committed during a pause. Rules selects only this
      // receipt's events after verification; append receives just our suffix.
      const canonicalReceipt = resolved.state.receipts[resolved.receipt.rootActionId];
      if (canonicalReceipt?.receiptId !== resolved.receipt.receiptId
        || canonicalReceipt.rootActionId !== resolved.receipt.rootActionId) {
        return projectionFailure("The continuation has no matching authoritative receipt.");
      }
      const from = BigInt(canonicalReceipt.eventRange.fromEventSeq);
      const to = BigInt(canonicalReceipt.eventRange.toEventSeq);
      const complete = [...this.authorityStore.events(), ...eventsToAppend]
        .filter((event) => BigInt(event.eventSeq) >= from && BigInt(event.eventSeq) <= to)
        .sort((left, right) => BigInt(left.eventSeq) < BigInt(right.eventSeq) ? -1 : 1);
      const unique = [...new Map(complete.map((event) => [event.eventId, event])).values()];
      if (BigInt(unique.length) !== to - from + 1n
        || unique[0]?.rootActionId !== resolved.receipt.rootActionId
        || unique.at(-1)?.rootActionId !== resolved.receipt.rootActionId
        || unique.some((event, index) => BigInt(event.eventSeq) !== from + BigInt(index)
          || (index > 0 && event.previousEventHash !== unique[index - 1].eventHash))) {
        return projectionFailure("The continuation receipt has no complete verified journal interval.");
      }
      receiptEvents = unique;
    }
    const status = resolved.kind === "awaitingInput"
      ? "awaitingInput" as const
      : resolved.kind === "concluded" || adapted.forceConcluded === true
        ? "concluded" as const
        : "committed" as const;
    const lifecycleReceiptExtras = isJsonRecord(resolved.mechanicalResult)
      && resolved.mechanicalResult.kind === "campaignLifecycle"
      && resolved.mechanicalResult.action === "commitMeaningfulFailure"
      && resolved.mechanicalResult.meaningfulFailure === true
      && Array.isArray(resolved.mechanicalResult.newOptions)
      && resolved.mechanicalResult.newOptions.every(isJsonRecord)
      ? {
          meaningfulFailure: true,
          newOptions: structuredClone(resolved.mechanicalResult.newOptions),
        }
      : {};
    const nextScopeVersion = this.authorityStore.scopeVersion(submission.scene_scope) + 1;
    const currentRandomnessCommitments = randomness.map((entry) => ({
      randomnessId: entry.randomnessId,
      requestHash: entry.requestHash,
      frozenParametersHash: entry.frozenParametersHash,
    }));
    const randomnessCommitments = [...new Map([
      ...(suspendedDue?.outcome.receipt.randomnessCommitments ?? []),
      ...currentRandomnessCommitments,
    ].map((entry) => [entry.randomnessId, entry])).values()];
    const priorEventRange = suspendedDue?.outcome.receipt.eventRange;
    // A reactor supplies the answer, while the persisted due root still
    // belongs to the original caster. Authentication above remains attached
    // to the reactor; full-root delivery uses the verified initiating actor.
    const resumedSpellDue = this.verifiedDueActivity(resolved.receipt.rootActionId, replay);
    const receiptActorCharacterId = suspendedDue?.outcome.receipt.actorCharacterId
      ?? (resumedSpellDue?.longSpellcasting === undefined ? submission.character_id : resumedSpellDue.ownerEntityId);
    const receipt: PublicReceipt = {
      receiptId: resolved.receipt.receiptId,
      rootActionId: submission.root_action_id,
      actorCharacterId: receiptActorCharacterId,
      status,
      runtimeEpochId: resolved.state.runtimeEpochId,
      activeBranchId: resolved.state.activeBranchId,
      eventRange: receiptEvents.length === 0 && priorEventRange == null
        ? null
        : {
            first: priorEventRange?.first ?? receiptEvents[0].eventSeq,
            last: receiptEvents.at(-1)?.eventSeq ?? priorEventRange!.last,
            from: Number(priorEventRange?.first ?? receiptEvents[0].eventSeq),
            to: Number(receiptEvents.at(-1)?.eventSeq ?? priorEventRange!.last),
          },
      scopeVersions: { [submission.scene_scope]: String(nextScopeVersion) },
      randomnessCommitments,
      ...(resolved.kind === "awaitingInput"
        ? { pendingInputId: resolved.pending.pendingInputId }
        : {}),
      ...(adapted.receiptExtras ?? {}),
      ...lifecycleReceiptExtras,
    };
    const actorViewer = this.authorityViewerForCharacter(resolved.state, submission.character_id);
    const priorActorViewer = this.authorityViewerForCharacter(replay.state, submission.character_id);
    const actorProjection = actorViewer !== undefined
      ? this.rulesRuntime.project(replay.profiles, resolved.state, actorViewer)
      : priorActorViewer === undefined
        ? undefined
        : this.rulesRuntime.project(replay.profiles, replay.state, priorActorViewer);
    if (!internalDueActivity && (actorProjection === undefined || actorProjection.kind === "rejected")) {
      return projectionFailure("The committed actor projection is unavailable.");
    }
    const kpProjection: JsonObject = {
      ...(internalDueActivity ? {} : roomPlayerProjection(
        actorProjection as unknown as JsonObject,
        submission.character_id,
      )),
      ...(internalDueActivity || actorViewer !== undefined ? {} : {
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

    let resumedDuePrepared: PreparedAuthoritativeAction | undefined;
    if (suspendedDue !== undefined && resolved.kind !== "awaitingInput") {
      if (resolved.kind !== "committed") {
        return rejectedAuthority(
          "invalidRulesResult",
          "The suspended due ActorPlan continuation did not settle canonically.",
        );
      }
      const parentViewer = this.authorityViewerForCharacter(
        resolved.state,
        suspendedDue.parent.character_id,
      );
      const nextReplay: AuthorityReplay = { ...replay, state: resolved.state };
      const moduleProfile = await this.pinnedAuthorityModule(nextReplay);
      const parentProjection = parentViewer === undefined || moduleProfile === undefined
        ? undefined
        : this.kpAuthorityProjection(
            nextReplay,
            parentViewer,
            moduleKpProjection(moduleProfile) as unknown as JsonObject,
          );
      const resumedActionInput = this.authorityResumedPlayerIntent(suspendedDue.parent);
      const resumedPrincipal = this.authorityResumedPrincipalContext(
        resolved.state,
        suspendedDue.parent,
      );
      if (
        parentProjection === undefined
        || resumedActionInput === undefined
        || resumedPrincipal === undefined
      ) {
        return rejectedAuthority(
          "continuationUnavailable",
          "The original player intent is unavailable after the pending ActorPlan mechanics.",
        );
      }
      resumedDuePrepared = {
        kind: "prepared",
        preparedActionId: suspendedDue.parent.prepared_action_id,
        rootActionId: suspendedDue.parent.root_action_id,
        receipt,
        kpProjection: {
          ...parentProjection,
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
        resumedActionInput,
        resumedPrincipalContext: resumedPrincipal,
      };
    }

    let pending: JsonObject | undefined;
    let pendingBindings: Array<{
      pendingInputId: string;
      controllerCharacterId: string;
      controllerPrincipalId: string;
      pending: JsonObject;
    }> = [];
    let deliveryPlan: DeliveryPlan | undefined;
    let awaitingInputTranscriptAudiences: DeliveryAudienceBinding[] = [];
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
      : submission.input_kind === "party"
        ? nonEmptyString(continuation?.displayText) ? continuation.displayText : undefined
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
    const socialMetaAnswer = submission.input_kind === "answer"
      && ["press", "acceptStatusQuo"].includes(String(pendingAnswer?.choice));
    const actorMessage: DeliveryPlan["actorMessage"] = safetyDirect
      || socialMetaAnswer
      || actorText === undefined
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
    let diceMessages: ExperiencedTranscriptMessageInput[] = [];
    if (resolved.kind === "awaitingInput") {
      pendingBindings = authorityPendingBindings(
        resolved.state,
        submission.root_action_id,
      );
      const currentBinding = pendingBindings.find((entry) =>
        entry.pendingInputId === resolved.pending.pendingInputId);
      const suspendedPending = currentBinding === undefined
        ? resolved.state.multiplayerRuntime.suspendedPendingInputs[
            resolved.pending.pendingInputId
          ]
        : undefined;
      const suspendedGroupRest = isJsonRecord(suspendedPending)
        && suspendedPending.kind === "groupRestConsent"
        && suspendedPending.pendingInputId === resolved.pending.pendingInputId
        && suspendedPending.rootActionId === submission.root_action_id;
      if (currentBinding === undefined && !suspendedGroupRest) {
        return rejectedAuthority(
          "invalidRulesResult",
          "Rules returned a pending input without an active trusted controller.",
        );
      }
      pending = currentBinding === undefined
        ? {
            kind: "pending",
            pendingInputId: resolved.pending.pendingInputId,
          }
        : {
            ...currentBinding.pending,
            controllerCharacterId: currentBinding.controllerCharacterId,
            controllerPrincipalId: currentBinding.controllerPrincipalId,
          };
      if (actorMessage !== undefined
        && socialResolutionProfileEnabled(replay.profiles.extensions)) {
        const deliveryPriorState = this.authorityStateBeforeEventRange(replay, receiptEvents);
        if (deliveryPriorState === undefined) {
          return projectionFailure(
            "The social offer event range has no reconstructable pre-state.",
          );
        }
        const audienceBindings = this.authorityAudienceBindings(
          replay.profiles,
          resolved.state,
          receiptActorCharacterId,
          receipt.receiptId,
          receipt.rootActionId,
          deliveryPriorState,
          receiptEvents,
          actorMessage,
        );
        if (audienceBindings.kind === "rejected") {
          return audienceProjectionFailure(audienceBindings.outcome);
        }
        awaitingInputTranscriptAudiences = audienceBindings.audiences;
        diceMessages = audienceBindings.diceMessages;
      }
    } else if (!safetyDirect && suspendedDue === undefined) {
      const deliveryPriorState = this.authorityStateBeforeEventRange(replay, receiptEvents);
      if (deliveryPriorState === undefined) {
        return projectionFailure(
          "The committed event range has no reconstructable pre-state.",
        );
      }
      const audienceBindings = this.authorityAudienceBindings(
        replay.profiles,
        resolved.state,
        receiptActorCharacterId,
        receipt.receiptId,
        receipt.rootActionId,
        deliveryPriorState,
        receiptEvents,
        actorMessage,
      );
      if (audienceBindings.kind === "rejected") {
        return audienceProjectionFailure(audienceBindings.outcome);
      }
      diceMessages = audienceBindings.diceMessages;
      deliveryPlan = {
        deliveryProtocol: deliveryProtocolForProfiles(replay.profiles),
        publishCapability: randomId("publish-capability"),
        rootActionId: submission.root_action_id,
        receiptId: receipt.receiptId,
        activeBranchId: receipt.activeBranchId,
        eventRange: receipt.eventRange,
        audiences: audienceBindings.audiences,
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
      : resumedDuePrepared !== undefined
        ? { kind: "continue", prepared: resumedDuePrepared }
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
      const currentAuthenticated = playerContext === undefined ? undefined
        : this.authenticatedAuthorityViewer(playerContext, currentReplay.state);
      const currentInternalDueActivity = internalDueActivity && this.authorizedInternalDueActivity(context, source, current, currentReplay);
      const currentTransferredRandomnessRecovery = usedRandomnessJournal
        && source.kind === "recovery"
        && current !== undefined
        && currentAuthenticated?.characterIds.includes(current.character_id) === true;
      const currentInternalDueRecovery = internalDueRecovery && current !== undefined
        && this.authorityStore.dueWorkByRoot(current.root_action_id)?.status === "pending"
        && currentAuthenticated?.characterIds.includes(current.character_id) === true;
      if (
        current === undefined
        || (!currentInternalDueActivity && (currentAuthenticated === undefined
          || (current.principal_id !== currentAuthenticated.principalId
            && !currentTransferredRandomnessRecovery && !currentInternalDueRecovery)
          || !currentAuthenticated.characterIds.includes(current.character_id)))
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
      const readSetConflict = this.validatePreparedReadSet(
        current,
        currentReplay,
        "beforeFinalCommit",
        rulesInput,
      );
      if (readSetConflict !== undefined) {
        return { outcome: readSetConflict, committedHere: false };
      }
      let currentSuspendedParent: AuthoritySubmissionRow | undefined;
      if (suspendedDue !== undefined) {
        const currentSuspendedStage = this.authorityStore.actionStageByChildRoot(
          current.root_action_id,
        );
        currentSuspendedParent = currentSuspendedStage === undefined
          ? undefined
          : this.authorityStore.submissionByPrepared(
              currentSuspendedStage.prepared_action_id,
            );
        if (
          currentSuspendedStage === undefined
          || currentSuspendedParent === undefined
          || currentSuspendedStage.status !== "prepared"
          || currentSuspendedStage.prepared_action_id !== suspendedDue.stage.prepared_action_id
          || currentSuspendedStage.submission_id !== currentSuspendedParent.submission_id
          || currentSuspendedStage.proposal_hash !== suspendedDue.proposalHash
          || currentSuspendedStage.result_json !== suspendedDue.stage.result_json
          || currentSuspendedParent.status !== "prepared"
          || currentSuspendedParent.scene_scope !== current.scene_scope
          || currentSuspendedParent.prepared_scope_version !== current.prepared_scope_version
        ) {
          return {
            outcome: {
              kind: "retryableFailure" as const,
              code: "actorPlanPendingIntegrityMismatch",
            },
            committedHere: false,
          };
        }
      }
      if (!safetyDirect && hasActiveSafetyPause(currentReplay.state)) {
        return {
          outcome: presentationUnavailable(),
          committedHere: false,
        };
      }
      if (
        current.status !== (usedRandomnessJournal ? "awaitingRandomness" : "prepared")
        || (!usesVNextTransactionReadSet
          && this.authorityStore.scopeVersion(current.scene_scope)
            !== current.prepared_scope_version)
      ) {
        return {
          outcome: rejectedAuthority(
            "scopeConflict",
            "A relevant scene scope changed after this action was prepared.",
          ),
          committedHere: false,
        };
      }
      if (rulesInput.kind !== "knowledgeReview" && !safetyDirect && this.authorityStore.hasRandomnessSettlementInScene(
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
      if (dueWork !== undefined && eventsToAppend[0]?.previousEventHash !== currentReplay.replay.head.eventHash) {
        return { outcome: { kind: "retryableFailure" as const, code: "dueActivityHeadConflict" }, committedHere: false };
      }
      this.appendAuthorityTransition(resolved.state, eventsToAppend);
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
      if (rulesInput.kind === "cancelPartyInvitation") {
        this.authorityStore.closePending(String(rulesInput.pendingInputId));
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
            sceneIds: uniqueSceneIds(currentFrame.sceneIds),
            kind: "kp",
            speakerCharacterId: null,
            speakerName: "KP",
            body: currentFrame.text,
            sourceEventSeq: currentSlot.source_event_seq,
            receiptId: currentFrame.receiptId,
          });
        }
        const transcriptViewerKeys = new Set([actorViewerKey]);
        for (const audience of awaitingInputTranscriptAudiences) {
          transcriptViewerKeys.add(`${audience.principalId}\u001f${audience.characterId}`);
        }
        for (const viewerKey of transcriptViewerKeys) {
          this.authorityStore.appendExperiencedMessage({
            viewerKey,
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
      for (const message of diceMessages) this.authorityStore.appendExperiencedMessage(message);
      if (submission.input_kind === "safetyPause") {
        this.authorityStore.supersedeCharacterDeliveries(
          Object.keys(resolved.state.characterControls),
        );
      }
      if (usedRandomnessJournal) this.authorityStore.finalizeRandomnessBatch(preparedActionId);
      if (suspendedDue !== undefined && currentSuspendedParent !== undefined) {
        if (resolved.kind === "awaitingInput") {
          this.authorityStore.saveSuspendedActionStage(
            currentSuspendedParent.prepared_action_id,
            suspendedDue.proposalHash,
            outcome,
          );
          this.authorityStore.advancePreparedSubmission({
            preparedActionId: currentSuspendedParent.prepared_action_id,
            preparedScopeVersion: nextScopeVersion,
            prepared: parseJson<PreparedAuthoritativeAction>(
              currentSuspendedParent.prepared_json,
            ),
          });
        } else if (resumedDuePrepared !== undefined) {
          this.authorityStore.finishActionStage(
            currentSuspendedParent.prepared_action_id,
            suspendedDue.proposalHash,
            outcome,
          );
          this.authorityStore.advancePreparedSubmission({
            preparedActionId: currentSuspendedParent.prepared_action_id,
            preparedScopeVersion: nextScopeVersion,
            prepared: resumedDuePrepared,
          });
        }
      }
      this.authorityStore.finishSubmission(preparedActionId, status, proposalHash, outcome);
      if (resolved.kind === "committed" && this.authorityStore.dueWorkByRoot(receipt.rootActionId) !== undefined) {
        this.authorityStore.finishDueWork(receipt.rootActionId, "committed");
      }
      this.authorityStore.markArchivePending(Date.now());
      return { outcome, committedHere: true };
    });
    if (persisted.committedHere && dueDescriptor?.timePassage !== undefined) {
      try {
        // Count committed advances, not the requested wait or a replayed
        // receipt. The ordinary HTTP commit sample describes the start only.
        const elapsed = receiptEvents.reduce((sum, event) => {
          const payload = event.payload as unknown as JsonObject;
          return event.eventType === "FictionTimeAdvanced" && typeof payload.durationMicros === "string"
            ? sum + BigInt(payload.durationMicros) : sum;
        }, 0n);
        if (elapsed > 0n) console.info(JSON.stringify(buildRoomTelemetryEvent({
          occurredAt: new Date().toISOString(), severity: "info", eventName: "room.time-passage.advanced",
          correlation: { roomId: this.authorityStore.room()?.room_id, rootActionId: receipt.rootActionId,
            receiptId: receipt.receiptId, eventRange: receipt.eventRange },
          measurements: { fictionTimeMicros: elapsed.toString(),
            crossedDeadlineCount: scheduledDeadlinesWithin(replay.state, submission.character_id, elapsed.toString()).length },
        })));
      } catch { /* A telemetry failure cannot undo or repeat committed time. */ }
    }
    if (
      persisted.outcome.kind === "committed"
      || persisted.outcome.kind === "concluded"
      || persisted.outcome.kind === "awaitingInput"
      || persisted.outcome.kind === "continue"
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
    const validation = await validateAuthoritativeArchive(archiveValue, this.rulesRuntime.replay);
    if (!validation.ok) {
      return rejectedAuthority(validation.code, "The supplied archive failed closed validation.");
    }
    const { archive, profiles, replay: replayed } = validation.value;
    const state = validation.value.state as AuthoritativeWorldState;
    const restoredModuleMatch = /^module:(.+):([^:]+)$/u.exec(
      archive.signedGenesis.moduleRef.profileId,
    );
    let restoredModuleProfile: AuthoritativeModuleProfile | undefined;
    if (restoredModuleMatch !== null) {
      try {
        restoredModuleProfile = await authoritativeModuleProfile(
          restoredModuleMatch[1],
          restoredModuleMatch[2],
        );
      } catch {
        restoredModuleProfile = undefined;
      }
    }
    if (
      restoredModuleProfile === undefined
      || !exactProfileRef(archive.signedGenesis.moduleRef, restoredModuleProfile.moduleRef)
    ) {
      return rejectedAuthority(
        "profileIntegrityMismatch",
        "The archive Module Profile is not registered for current 0.4 recovery.",
      );
    }
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
    const restoredModuleId = restoredModuleProfile.moduleId;

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
      const archive = await readAuthoritativeArchiveFromD1(db, locator, this.rulesRuntime.replay);
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
    if (this.earlierFrozenNarrationPending(recovery.planRow, recovery.binding)) {
      return rejectedAuthority("narrationPredecessorPending", "An earlier frozen narration for this Viewer must be delivered first.");
    }
    const deliveryGeneration = this.authorityStore.beginDeliveryAudienceAttempt(
      recovery.plan.publishCapability,
      recovery.binding.audienceId,
    );
    if (deliveryGeneration === undefined) return narrationRecoveryUnavailable();
    const narrationInputMode = deliveryNarrationInputMode(recovery.binding);
    if (narrationInputMode === undefined) return narrationRecoveryUnavailable();
    const renderableClaims = deliveryRenderableClaims(recovery.binding);
    if (narrationInputMode === "frozenRenderableClaims-vnext-1"
      && renderableClaims === undefined) return narrationRecoveryUnavailable();
    return {
      kind: "pending" as const,
      rootActionId: recovery.plan.rootActionId,
      receipt: structuredClone(recovery.receipt),
      narrationInputMode,
      ...(narrationInputMode === "observerProjection-v1"
        ? { projection: structuredClone(recovery.binding.kpProjection) }
        : {
            viewerKey: renderableClaims!.viewerKey,
            renderableClaims: structuredClone(renderableClaims!),
            narrationContext: structuredClone((recovery.binding.kpProjection as JsonObject).narrationContext),
          }),
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
    return published.kind === "published"
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
    if (observed.kind !== "staleOpen") return observed;
    return this.authorityStore.transaction(() => {
      const raced = status();
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
      if (this.earlierFrozenNarrationPending(row, binding)) {
        return rejectedAuthority("narrationPredecessorPending", "An earlier frozen narration for this Viewer must be delivered first.");
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
    const publicationResult = () => {
      const requestedAudiences = new Set(actualAudienceIds);
      const audienceRows = this.authorityStore.deliveryAudiences(publishCapability);
      return {
        kind: "published" as const,
        receiptId: plan.receiptId,
        deliveryIds: audienceRows.flatMap((audience) => {
          if (
            !requestedAudiences.has(audience.audience_id)
            || audience.status !== "published"
            || audience.result_json === null
          ) {
            return [];
          }
          const result = parseJson<unknown>(audience.result_json);
          return isJsonRecord(result) && nonEmptyString(result.deliveryId)
            ? [result.deliveryId]
            : [];
        }),
        audiences: audienceRows.map((audience) => ({
          audienceId: audience.audience_id,
          deliveryGeneration: audience.delivery_generation,
          state: audience.status,
        })),
      };
    };

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
        || !Number.isSafeInteger(frameValue.deliveryGeneration)
        || Number(frameValue.deliveryGeneration) < 1
      ) {
        return rejectedAuthority(
          "invalidPublication",
          "Each audience frame requires one generation and one non-empty narration body.",
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
      const deliveryGeneration = Number(frameValue.deliveryGeneration);
      if (deliveryGeneration !== journal.delivery_generation) {
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
      const narrationInputMode = deliveryNarrationInputMode(binding);
      if (narrationInputMode === undefined) {
        return rejectedAuthority(
          "deliveryPublicationIntegrityMismatch",
          "The audience narration input protocol is unavailable.",
        );
      }
      const renderableClaims = deliveryRenderableClaims(binding);
      if (narrationInputMode === "frozenRenderableClaims-vnext-1"
        && renderableClaims === undefined) {
        return rejectedAuthority(
          "deliveryPublicationIntegrityMismatch",
          "The audience's frozen Viewer Claims are unavailable.",
        );
      }
      const attemptHash = await authorityHash({
        audienceId: binding.audienceId,
        body,
        deliveryGeneration,
        projectionHash: binding.projectionHash,
        narrationInputMode,
        ...(renderableClaims === undefined
          ? {}
          : { claimsHash: renderableClaims.claimsHash }),
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
      const sceneIds = uniqueSceneIds(binding.sceneIds);
      const derived = narrationPublicationMetadata(binding);
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
      return publicationResult();
    }
    return this.authorityStore.transaction(() => {
      if (this.authorityStore.roomDeletion() !== undefined) {
        return rejectedAuthority("roomDeleting", "The room is sealed for deletion.");
      }
      const currentPlan = this.authorityStore.deliveryPlan(publishCapability);
      if (currentPlan === undefined) {
        return rejectedAuthority("publishCapabilityInvalid", "The publish capability is unavailable.");
      }
      // Recheck before any frame mutates the publication journal. A concurrent
      // publisher must not advance a Viewer past an undelivered frozen root.
      for (const { binding } of preparedFrames) {
        if (this.earlierFrozenNarrationPending(currentPlan, binding)) {
          return rejectedAuthority("narrationPredecessorPending", "An earlier frozen narration for this Viewer must be delivered first.");
        }
      }
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
            sceneIds: uniqueSceneIds(oldFrame.sceneIds),
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
      }
      return publicationResult();
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
        const readModel = this.rulesRuntime.project(
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
        const presentationHold = this.viewerNarrationPresentationHold(
          replay,
          viewer,
          readModel,
          narrationRecovery,
        );
        return {
          readModel: this.withTimePassageProcessing(readModel as unknown as JsonObject, latest.id, replay.state),
          transcript: this.experiencedObservationTranscript(viewerKey, latest.sceneId),
          delivery: slot === undefined
              ? { kind: "none" }
              : (() => {
                  const frame = parseJson<DeliveryFrame>(slot.frame_json);
                  return { kind: "current" as const, frame, body: frame.text };
                })(),
          pendingPlayerRolls: [],
          ...(narrationRecovery === undefined ? {} : { narrationRecovery }),
          ...(presentationHold === undefined ? {} : { presentationHold }),
        };
      }
      const formerRecovery = this.authenticatedFormerViewerNarrationRecovery(
        replay,
        authenticated,
      );
      const narrationRecovery = formerRecovery === undefined
        ? undefined
        : this.viewerNarrationRecoveryProjection(
            formerRecovery.recovery.plan.publishCapability,
            formerRecovery.recovery.audience,
          );
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
          pendingPlayerRolls: [],
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
    const projected = this.rulesRuntime.project(
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
    const presentationHold = this.viewerNarrationPresentationHold(
      replay,
      viewer,
      readModel,
      narrationRecovery,
    );
    return {
      readModel: this.withTimePassageProcessing(readModel, characterId, replay.state),
      transcript: this.experiencedObservationTranscript(
        viewerKey,
        replay.state.entities[characterId]?.sceneId,
      ),
      delivery: slot === undefined
        ? { kind: "none" }
        : (() => {
            const frame = parseJson<DeliveryFrame>(slot.frame_json);
            return { kind: "current" as const, frame, body: frame.text };
          })(),
      pendingPlayerRolls: this.viewerPendingPlayerRolls(replay, authenticated),
      ...(narrationRecovery === undefined ? {} : { narrationRecovery }),
      ...(presentationHold === undefined ? {} : { presentationHold }),
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
        sceneIds: uniqueSceneIds(frame.sceneIds),
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
    const corrected = this.rulesRuntime.step(replay.profiles, replay.state, {
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
    const audienceBindings = this.authorityAudienceBindings(
      replay.profiles,
      corrected.state,
      actorCharacterId,
      correctionReceipt.receiptId,
      correctionReceipt.rootActionId,
      replay.state,
      corrected.events,
    );
    if (audienceBindings.kind === "rejected") return audienceBindings.outcome;
    const deliveryPlan: DeliveryPlan = {
      deliveryProtocol: deliveryProtocolForProfiles(replay.profiles),
      publishCapability: randomId("publish-capability"),
      rootActionId: correctionReceipt.rootActionId,
      receiptId: correctionReceipt.receiptId,
      activeBranchId: correctionReceipt.activeBranchId,
      eventRange: correctionReceipt.eventRange,
      audiences: audienceBindings.audiences,
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
          sceneIds: uniqueSceneIds(frame.sceneIds),
          kind: "kp",
          speakerCharacterId: null,
          speakerName: "KP",
          body: frame.text,
          sourceEventSeq: slot.source_event_seq,
          receiptId: frame.receiptId,
        });
      }
      this.appendAuthorityTransition(corrected.state, corrected.events);
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

  async alarm() {
    if (this.authorityStore.roomDeletion() !== undefined) {
      await this.reconcilePreparedDeletion();
      return;
    }
    const now = Date.now();
    const dueAt = this.authorityStore.dueWorkAlarmAt();
    if (dueAt !== null && dueAt <= now && this.authorityStore.room() !== undefined) await this.drainDueActivities();
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
