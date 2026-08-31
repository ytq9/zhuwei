import { canonicalSha256 } from "../profiles/canonical";
import { pathLengthMilliInches } from "../profiles/combat-geometry";
import { isCanonicalTacticalGeometry } from "../profiles/tactical-geometry";
import { projectRegisteredAbility } from "../profiles/ability-compiler";
import { socialResolutionProfileEnabled } from "../profiles/social-resolution";
import { npcMechanicsProfileEnabled } from "../profiles/npc-mechanics";
import type { RuntimeProfileManifest } from "../profiles/types";
import {
  isTacticalProjection,
  type TacticalEntity,
  type TacticalEncounterSummary,
  type TacticalKnownFeature,
  type TacticalProjection,
} from "../tactical-projection";
import type {
  AuthoritativeWorldState,
  CharacterRecord,
  DueActorPlanReadModel,
  EventEnvelope,
  EventPayloadByType,
  JsonRecord,
  KpSpatialReadModel,
  KpViewer,
  LifecycleReadModel,
  NpcViewer,
  ObserverCommittedDelta,
  ObserverDeltaChange,
  ObserverIncrementalDelta,
  ObserverProjectionAnchor,
  PlayerViewer,
  ProjectionQuery,
  ProjectionResult,
  PublicReceipt,
  SafeReadModel,
} from "./model";
import { dueActorPlanChildRoot, earliestEligibleDueActorPlan } from "./actor-plans";
import { eventHash, foldEvent, validateEventEnvelope } from "./events";
import { rejected } from "./results";
import {
  isKpSpatialViewer,
  spatialRecordVisibleTo,
} from "./spatial-visibility";
import { characterTimelineId } from "./timeline";
import { projectRestRecoveryOptions } from "./character-rest";
import {
  itemPolicyVisibleToViewer,
  projectHeldInventory,
} from "./item-projection";
import type { ItemDefinitionV1, ItemEntryV1 } from "./items";
import {
  isNpcMechanicalTemplateDefinition,
  NPC_MECHANICAL_TEMPLATE_KIND,
} from "./npc-mechanics";
import {
  canonicalFactVisibleToCharacter,
  isAuthoritativeWorldState,
  isNonEmptyString,
  isRecord,
  hashWorldState,
} from "./validation";

type AuthorizedViewer = {
  kind: "player" | "npc";
  character: CharacterRecord;
  principalId?: string;
};

const FORMER_TENURE_STATUSES: ReadonlySet<CharacterRecord["tenureStatus"]> = new Set([
  "dead",
  "retired",
  "missing",
  "npcTransitioned",
] as const);

function projectLifecycle(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  value: unknown,
): LifecycleReadModel | ReturnType<typeof rejected> | undefined {
  if (!isRecord(value) || value.kind !== "player" || value.purpose !== "lifecycle") {
    return undefined;
  }
  if (!isNonEmptyString(value.principalId)
    || !Number.isSafeInteger(value.sessionVersion)
    || !isNonEmptyString(value.seatId)
    || !isNonEmptyString(value.characterId)) {
    return rejected("viewerUnauthorized", "Viewer authentication is unavailable.");
  }
  const principal = state.principals[value.principalId];
  const activeSeatIds = new Set(Object.values(state.seats)
    .filter((seat) => seat.principalId === value.principalId && seat.status === "active")
    .map((seat) => seat.id));
  if (principal?.sessionVersion !== value.sessionVersion
    || !activeSeatIds.has(value.seatId)) {
    return rejected("viewerUnauthorized", "Viewer authentication is unavailable.");
  }
  const formerCharacters = Object.values(state.entities)
    .filter((character) => character.lastControllerSeatId !== undefined
      && activeSeatIds.has(character.lastControllerSeatId)
      && FORMER_TENURE_STATUSES.has(character.tenureStatus))
    .sort((left, right) => {
      const ordinal = BigInt(right.entityOrdinal) - BigInt(left.entityOrdinal);
      return ordinal === 0n ? left.id.localeCompare(right.id) : ordinal > 0n ? 1 : -1;
    });
  if (formerCharacters.length === 0
    || !formerCharacters.some((character) => character.id === value.characterId)) {
    return rejected("viewerUnauthorized", "Viewer authentication is unavailable.");
  }
  const latest = formerCharacters[0];
  const base = {
    kind: "projected" as const,
    runtimeProfiles: structuredClone(profiles),
    stateVersion: state.version,
    worldRevision: state.version,
    activeBranchId: state.activeBranchId,
    viewer: { kind: "player" as const, principalId: value.principalId },
    controlledCharacter: null,
    ...(state.multiplayerRuntime.safetyPresentations[value.principalId] === undefined
      ? {}
      : {
          safetyPresentation: {
            status: state.multiplayerRuntime.safetyPresentations[value.principalId].status,
            presentationAdjustment:
              state.multiplayerRuntime.safetyPresentations[value.principalId].presentationAdjustment,
          },
        }),
    lifecycle: {
      kind: "successorRequired" as const,
      defaultPredecessorCharacterId: latest.id,
      eligiblePredecessors: formerCharacters.map((character) => ({
        characterId: character.id,
        name: character.name,
        tenureStatus: character.tenureStatus as LifecycleReadModel["lifecycle"]["eligiblePredecessors"][number]["tenureStatus"],
      })),
    },
  };
  return { ...base, projectionHash: canonicalSha256(base) };
}

function authorizePlayer(
  state: AuthoritativeWorldState,
  value: unknown,
): AuthorizedViewer | undefined {
  if (!isRecord(value)
    || value.kind !== "player"
    || !isNonEmptyString(value.principalId)
    || !isNonEmptyString(value.characterId)) {
    return undefined;
  }
  const principal = state.principals[value.principalId];
  const seatId = isNonEmptyString(value.seatId) ? value.seatId : undefined;
  const seat = seatId === undefined ? undefined : state.seats[seatId];
  const character = state.entities[value.characterId];
  const control = state.characterControls[value.characterId];
  const fullTrustedViewer = Number.isSafeInteger(value.sessionVersion)
    && isNonEmptyString(value.seatId)
    && principal?.sessionVersion === value.sessionVersion
    && seat?.principalId === value.principalId
    && seat.status === "active"
    && control?.seatId === value.seatId;
  const campaignTrustedViewer = character?.tenureStatus === "active"
    && character.controllerPrincipalId === value.principalId
    && (state.campaignRuntime.campaign !== null || state.combatRuntime.story !== null);
  if (character?.kind !== "player" || (!fullTrustedViewer && !campaignTrustedViewer)) {
    return undefined;
  }
  return { kind: "player", character, principalId: value.principalId };
}

function authorizeNpc(
  state: AuthoritativeWorldState,
  value: unknown,
): AuthorizedViewer | undefined {
  if (
    !isRecord(value)
    || value.kind !== "npc"
    || !isNonEmptyString(value.npcId)
  ) {
    return undefined;
  }
  const character = state.entities[value.npcId];
  const explicitCapability = value.purpose === "kpDecision"
    && value.capability === "internal:npc-limited-knowledge";
  const campaignInternalViewer = state.campaignRuntime.campaign !== null
    || state.combatRuntime.story !== null
      ? value.purpose === undefined && value.capability === undefined
      : false;
  return character?.kind === "npc" && (explicitCapability || campaignInternalViewer)
    ? { kind: "npc", character }
    : undefined;
}

function safeVisibleItemFor(
  state: AuthoritativeWorldState,
  entry: ItemEntryV1,
  definition: ItemDefinitionV1,
  character: CharacterRecord,
): JsonRecord | undefined {
  if (["consumed", "destroyed"].includes(entry.disposition)) return undefined;
  const holderId = entry.disposition === "held" && entry.holderRef !== null
    ? entry.holderRef
    : undefined;
  const sceneId = entry.disposition === "scene" && entry.sceneRef !== null
    ? entry.sceneRef
    : undefined;
  const holderSceneId = holderId === undefined ? undefined : state.entities[holderId]?.sceneId;
  const viewer = { kind: character.kind, characterId: character.id } as const;
  const sameScene = sceneId === character.sceneId || holderSceneId === character.sceneId;
  const heldByViewer = holderId === character.id;
  if (!sameScene && !heldByViewer) return undefined;
  const entryVisible = itemPolicyVisibleToViewer(entry.visibilityPolicyRef, viewer, entry)
    && (entry.visibilityPolicyRef !== "visibility:scene-observers" || sameScene);
  if (!entryVisible) return undefined;
  const definitionVisible = itemPolicyVisibleToViewer(
    definition.visibilityPolicyRef,
    viewer,
    entry,
  ) && (definition.visibilityPolicyRef !== "visibility:scene-observers" || sameScene);
  return {
    itemEntryId: entry.entryId,
    kind: definitionVisible ? "identified" : "opaque",
    ...(definitionVisible
      ? { definitionRef: definition.definitionId, name: definition.content.label }
      : {}),
    disposition: entry.disposition,
    quantity: entry.quantity,
    ...(holderId === undefined ? {} : { holderRef: holderId }),
    ...(sceneId === undefined ? {} : { sceneRef: sceneId }),
  };
}

function safeRelationshipFor(relationship: JsonRecord): JsonRecord | undefined {
  if (!isNonEmptyString(relationship.relationshipId)
    || !Array.isArray(relationship.subjectIds)
    || !relationship.subjectIds.every(isNonEmptyString)
    || !isNonEmptyString(relationship.value)) return undefined;
  return {
    relationshipId: relationship.relationshipId,
    subjectIds: [...relationship.subjectIds].sort(),
    value: relationship.value,
    ...(Array.isArray(relationship.basisFactIds)
      ? { basisFactIds: relationship.basisFactIds.filter(isNonEmptyString).sort() }
      : {}),
    ...(isNonEmptyString(relationship.sourceFactId)
      ? { sourceFactId: relationship.sourceFactId }
      : {}),
  };
}

function safePromiseFor(promise: JsonRecord): JsonRecord | undefined {
  if (![promise.promiseId, promise.promisorId, promise.promiseeId, promise.content]
    .every(isNonEmptyString)) return undefined;
  return {
    promiseId: promise.promiseId,
    promisorId: promise.promisorId,
    promiseeId: promise.promiseeId,
    content: promise.content,
    ...(isNonEmptyString(promise.condition) ? { condition: promise.condition } : {}),
    ...(isNonEmptyString(promise.status) ? { status: promise.status } : {}),
    ...(isNonEmptyString(promise.sourceFactId) ? { sourceFactId: promise.sourceFactId } : {}),
  };
}

function safeDebtFor(debt: JsonRecord): JsonRecord | undefined {
  if (![debt.debtId, debt.debtorId, debt.creditorId, debt.obligation, debt.condition]
    .every(isNonEmptyString)) return undefined;
  return {
    debtId: debt.debtId,
    debtorId: debt.debtorId,
    creditorId: debt.creditorId,
    obligation: debt.obligation,
    condition: debt.condition,
    ...(isNonEmptyString(debt.status) ? { status: debt.status } : {}),
    ...(Array.isArray(debt.basisFactIds)
      ? { basisFactIds: debt.basisFactIds.filter(isNonEmptyString).sort() }
      : {}),
    ...(isNonEmptyString(debt.sourceFactId) ? { sourceFactId: debt.sourceFactId } : {}),
  };
}

function safeFactionFor(faction: JsonRecord, character: CharacterRecord): JsonRecord | undefined {
  if (
    character.kind !== "npc"
    || !isNonEmptyString(faction.factionId)
    || !Array.isArray(faction.memberRefs)
    || !faction.memberRefs.includes(character.id)
  ) return undefined;
  return {
    factionId: faction.factionId,
    ...(isNonEmptyString(faction.definitionRef) ? { definitionRef: faction.definitionRef } : {}),
    ...(isNonEmptyString(faction.name) ? { name: faction.name } : {}),
    ...(isNonEmptyString(faction.goal) ? { goal: faction.goal } : {}),
    memberRefs: faction.memberRefs.filter(isNonEmptyString).sort(),
    resourceRefs: Array.isArray(faction.resourceRefs)
      ? faction.resourceRefs.filter(isNonEmptyString).sort()
      : [],
  };
}

function safeFactionPlanFor(plan: JsonRecord, character: CharacterRecord): JsonRecord | undefined {
  if (character.kind !== "npc" || plan.actingNpcId !== character.id) return undefined;
  const lastAdvance = isRecord(plan.lastAdvance) ? plan.lastAdvance : undefined;
  return {
    ...(isNonEmptyString(plan.factionId) ? { factionId: plan.factionId } : {}),
    ...(isNonEmptyString(plan.planId) ? { planId: plan.planId } : {}),
    actingNpcId: character.id,
    premiseRefs: Array.isArray(plan.premiseRefs)
      ? plan.premiseRefs.filter(isNonEmptyString).sort()
      : [],
    resourceRefs: Array.isArray(plan.resourceRefs)
      ? plan.resourceRefs.filter(isNonEmptyString).sort()
      : [],
    ...(isNonEmptyString(plan.revision) ? { revision: plan.revision } : {}),
    ...(isNonEmptyString(plan.status) ? { status: plan.status } : {}),
    ...(lastAdvance === undefined ? {} : {
      lastAdvance: {
        causeFactIds: Array.isArray(lastAdvance.causeFactIds)
          ? lastAdvance.causeFactIds.filter(isNonEmptyString).sort()
          : [],
        ...(isNonEmptyString(lastAdvance.action) ? { action: lastAdvance.action } : {}),
      },
    }),
  };
}

function safeConversationThreadFor(
  thread: JsonRecord,
  viewerKind: "player" | "npc",
): JsonRecord {
  const commonKeys = [
    "threadRef",
    "actorCharacterId",
    "npcCharacterId",
    "claimRef",
    "responseClaimRef",
    "claimKind",
    "claimTruthStatus",
    "topicFingerprint",
    "resolution",
    "sourceSceneId",
    "evidenceRefs",
    "status",
    "degree",
    "marginDegree",
    "maximumInfluenceDegree",
    "margin",
    "immediateBehavior",
    "relationshipScore",
    "outcome",
    "updatedByEventId",
  ];
  const projected = Object.fromEntries(commonKeys.flatMap((key) =>
    thread[key] === undefined ? [] : [[key, structuredClone(thread[key])]]));
  const semantics = isRecord(thread.claimSemantics) ? thread.claimSemantics : undefined;
  if (viewerKind === "player") {
    if (semantics !== undefined) projected.claimSemantics = structuredClone(semantics);
    if (thread.goal !== undefined) projected.goal = structuredClone(thread.goal);
    if (thread.method !== undefined) projected.method = structuredClone(thread.method);
    return projected;
  }
  if (semantics !== undefined) {
    projected.claimSemantics = Object.fromEntries([
      "schema",
      "targetNpcRef",
      "addressedThreadRef",
      "evidenceRefs",
      "assertion",
      "topicFingerprint",
    ].flatMap((key) => semantics[key] === undefined
      ? []
      : [[key, structuredClone(semantics[key])]]));
  }
  return projected;
}

function safeReceipt(receipt: AuthoritativeWorldState["receipts"][string]): PublicReceipt {
  return {
    receiptId: receipt.receiptId,
    rootActionId: receipt.rootActionId,
    status: receipt.status,
    branchId: receipt.branchId,
    eventRange: structuredClone(receipt.eventRange),
    rulesetVersion: receipt.rulesetVersion,
    eventSchemaVersion: receipt.eventSchemaVersion,
    scopeProofHash: receipt.scopeProofHash,
  };
}

function projectedArmorClass(state: AuthoritativeWorldState, entity: JsonRecord): number | undefined {
  const base = Number(entity.armorClass);
  if (!Number.isFinite(base)) return undefined;
  const shieldBonus = Object.values(state.combatRuntime.effects)
    .filter((effect) => effect.kind === "shield"
      && effect.targetEntityId === entity.id)
    .reduce((maximum, effect) => Math.max(maximum, Number(effect.armorClassBonus ?? 0)), 0);
  return base + shieldBonus;
}

function observerSafeCombatEntity(
  state: AuthoritativeWorldState,
  entity: JsonRecord,
  viewerCharacterId: string,
): JsonRecord {
  const effectiveArmorClass = projectedArmorClass(state, entity);
  if (entity.id === viewerCharacterId) return {
    ...structuredClone(entity),
    ...(effectiveArmorClass === undefined ? {} : { effectiveArmorClass }),
  };
  const projected: JsonRecord = {};
  for (const key of [
    "id",
    "kind",
    "name",
    "entityOrdinal",
    "sceneId",
    "position",
    "footprint",
    "conditions",
    "concentration",
    "lifeState",
  ]) {
    if (entity[key] !== undefined) projected[key] = structuredClone(entity[key]);
  }
  if (entity.kind === "player" && entity.hitPoints !== undefined) {
    projected.hitPoints = structuredClone(entity.hitPoints);
  }
  if (effectiveArmorClass !== undefined) projected.effectiveArmorClass = effectiveArmorClass;
  return projected;
}

function observerSafeEncounter(
  encounter: JsonRecord,
  visibleEntityIds: Set<string>,
): JsonRecord {
  const projected: JsonRecord = {};
  for (const key of [
    "encounterId",
    "sceneId",
    "status",
    "round",
    "turnCursor",
    "roundClosed",
  ]) {
    if (encounter[key] !== undefined) projected[key] = structuredClone(encounter[key]);
  }
  if (Array.isArray(encounter.participantEntityIds)) {
    projected.participantEntityIds = encounter.participantEntityIds.filter((id) =>
      isNonEmptyString(id) && visibleEntityIds.has(id));
  }
  if (isNonEmptyString(encounter.activeEntityId) && visibleEntityIds.has(encounter.activeEntityId)) {
    projected.activeEntityId = encounter.activeEntityId;
  } else {
    projected.activeEntityId = null;
  }
  if (isRecord(encounter.initiative) && Array.isArray(encounter.initiative.entries)) {
    projected.initiative = {
      ordered: encounter.initiative.ordered === true,
      entries: encounter.initiative.entries.flatMap((entry) => {
        if (!isRecord(entry) || !Array.isArray(entry.combatantEntityIds)) return [];
        const combatantEntityIds = entry.combatantEntityIds.filter((id) =>
          isNonEmptyString(id) && visibleEntityIds.has(id));
        return combatantEntityIds.length === 0 ? [] : [{
          entryId: entry.entryId,
          combatantEntityIds,
          ...(Number.isFinite(entry.total) ? { total: entry.total } : {}),
        }];
      }),
    };
  }
  return projected;
}

function fullAdjudicationPrecedents(state: AuthoritativeWorldState): JsonRecord[] {
  return Object.values(state.campaignRuntime.adjudicationPrecedents)
    .filter(isRecord)
    .sort((left, right) => String(left.precedentId).localeCompare(String(right.precedentId)))
    .map((precedent) => structuredClone(precedent));
}

function adjudicationPrecedentApplies(
  state: AuthoritativeWorldState,
  precedent: JsonRecord,
  sceneId: string,
): boolean {
  if (!isRecord(precedent.applicabilityScope)) return false;
  const scope = precedent.applicabilityScope;
  if (!isNonEmptyString(scope.ref)) return false;
  switch (scope.kind) {
    case "scene":
      return scope.ref === sceneId;
    case "room":
      return scope.ref === state.roomId;
    case "campaign":
      return state.campaignRuntime.campaign?.campaignId === scope.ref;
    case "module":
      return true;
    default:
      return false;
  }
}

function publicAdjudicationPrecedents(
  state: AuthoritativeWorldState,
  sceneId: string,
): JsonRecord[] {
  return fullAdjudicationPrecedents(state)
    .filter((precedent) => adjudicationPrecedentApplies(state, precedent, sceneId))
    .map((precedent) => ({
      precedentId: precedent.precedentId,
      status: precedent.status,
      publicExplanation: precedent.publicExplanation,
      publicRuleBasis: structuredClone(precedent.publicRuleBasis),
      applicabilityScope: structuredClone(precedent.applicabilityScope),
      ...(isNonEmptyString(precedent.supersededPrecedentId)
        ? { supersededPrecedentId: precedent.supersededPrecedentId }
        : {}),
      ...(Array.isArray(precedent.materialDifferences)
        ? { materialDifferences: structuredClone(precedent.materialDifferences) }
        : {}),
      ...(isNonEmptyString(precedent.supersededByPrecedentId)
        ? { supersededByPrecedentId: precedent.supersededByPrecedentId }
        : {}),
    }));
}

function projectKpSpatialEvidence(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
): KpSpatialReadModel {
  const includeNpcMechanics = npcMechanicsProfileEnabled(profiles.extensions);
  const scenes = Object.fromEntries(
    Object.entries(state.combatRuntime.scenes)
      .filter(([, scene]) => isNonEmptyString(scene.sceneId) && isRecord(scene.geometry))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sceneId, scene]) => [sceneId, {
        sceneId: scene.sceneId as string,
        geometry: structuredClone(scene.geometry as JsonRecord),
      }]),
  );
  const entities = Object.fromEntries(
    Object.entries(state.combatRuntime.entities)
      .filter(([, entity]) => isNonEmptyString(entity.id)
        && isNonEmptyString(entity.sceneId)
        && (isRecord(entity.position) || isRecord(entity.footprint)))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([entityId, entity]) => [entityId, {
        id: entity.id as string,
        ...(includeNpcMechanics && isNonEmptyString(entity.name) ? { name: entity.name } : {}),
        sceneId: entity.sceneId as string,
        ...(includeNpcMechanics && isNonEmptyString(entity.mechanicalDefinitionRef)
          ? { mechanicalDefinitionRef: entity.mechanicalDefinitionRef }
          : {}),
        ...(entity.position === undefined ? {} : { position: structuredClone(entity.position) }),
        ...(entity.footprint === undefined ? {} : { footprint: structuredClone(entity.footprint) }),
        ...(isNonEmptyString(entity.visibilityPolicyId)
          ? { visibilityPolicyId: entity.visibilityPolicyId }
          : {}),
        ...(isNonEmptyString(entity.visibilityFactId)
          ? { visibilityFactId: entity.visibilityFactId }
          : {}),
      }]),
  );
  const npcMechanicalDefinitions = Object.fromEntries(
    Object.entries(state.combatRuntime.definitions)
      .filter(([, definition]) =>
        definition.definitionKind === NPC_MECHANICAL_TEMPLATE_KIND
        && isNpcMechanicalTemplateDefinition(definition))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([definitionRef, definition]) => [definitionRef, {
        definitionRef,
        revision: definition.revision,
        rulesBasis: definition.rulesBasis,
        content: structuredClone(definition.content),
      }]),
  );
  const itemDefinitions = Object.fromEntries(
    Object.entries(state.campaignRuntime.itemSystem.definitions)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([definitionRef, definition]) => [definitionRef, structuredClone(definition)]),
  );
  const dynamicAuthoritativeFacts = Object.fromEntries(
    Object.entries(state.canonicalFacts)
      .filter(([, fact]) => fact.source !== "moduleAnchor"
        && fact.kind !== "npcMechanicalItemStateCauseConsumed")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([factRef, fact]) => [factRef, structuredClone(fact)]),
  );
  const base = {
    kind: "projected" as const,
    runtimeProfiles: structuredClone(profiles),
    stateVersion: state.version,
    activeBranchId: state.activeBranchId,
    viewer: { kind: "kp" as const, subjectId: "kp" as const },
    adjudicationPrecedents: fullAdjudicationPrecedents(state),
    ...(Object.keys(dynamicAuthoritativeFacts).length === 0
      ? {}
      : { dynamicAuthoritativeFacts }),
    spatialEvidence: { scenes, entities },
    ...(Object.keys(npcMechanicalDefinitions).length === 0
      ? {}
      : { npcMechanicalDefinitions }),
    ...(Object.keys(itemDefinitions).length === 0
      ? {}
      : { itemDefinitions }),
  };
  return { ...base, projectionHash: canonicalSha256(base) } satisfies KpSpatialReadModel;
}

function tacticalPublicStates(entity: JsonRecord): string[] {
  const conditions = isRecord(entity.conditions)
    ? Object.entries(entity.conditions)
      .filter(([, active]) => active === true || (typeof active === "string" && active !== "0"))
      .map(([conditionId]) => `condition:${conditionId}`)
    : [];
  const lifeState = isNonEmptyString(entity.lifeState) && entity.lifeState !== "alive"
    ? [`life:${entity.lifeState}`]
    : [];
  return [...new Set([...conditions, ...lifeState])].sort();
}

function tacticalEntity(
  value: JsonRecord | undefined,
  relation: TacticalEntity["relation"],
): TacticalEntity | undefined {
  if (value === undefined
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.name)
    || (value.kind !== "player" && value.kind !== "npc")
    || !isRecord(value.position)
    || !isRecord(value.footprint)
    || ![value.position.x, value.position.y, value.position.elevation]
      .every((entry) => typeof entry === "string")
    || ![value.footprint.width, value.footprint.depth, value.footprint.height]
      .every((entry) => typeof entry === "string")) return undefined;
  return {
    id: value.id,
    name: value.name,
    kind: value.kind,
    position: {
      x: value.position.x as string,
      y: value.position.y as string,
      elevation: value.position.elevation as string,
    },
    footprint: {
      width: value.footprint.width as string,
      depth: value.footprint.depth as string,
      height: value.footprint.height as string,
    },
    relation,
    publicStates: tacticalPublicStates(value),
  };
}

function hostileToViewer(encounter: JsonRecord | undefined, viewerId: string): Set<string> {
  if (encounter === undefined || !Array.isArray(encounter.hostilities)) return new Set();
  const hostileIds = new Set<string>();
  for (const edge of encounter.hostilities) {
    if (!isRecord(edge)
      || !Array.isArray(edge.fromEntityIds)
      || !Array.isArray(edge.toEntityIds)) continue;
    const from = edge.fromEntityIds.filter(isNonEmptyString);
    const to = edge.toEntityIds.filter(isNonEmptyString);
    if (from.includes(viewerId)) for (const id of to) hostileIds.add(id);
    if (to.includes(viewerId)) for (const id of from) hostileIds.add(id);
  }
  return hostileIds;
}

function tacticalEncounterSummary(
  value: JsonRecord | undefined,
): TacticalEncounterSummary | null | undefined {
  if (value === undefined) return null;
  if (!isNonEmptyString(value.encounterId)
    || (value.status !== "starting" && value.status !== "concluded")
    || !Number.isSafeInteger(value.round)
    || !Array.isArray(value.participantEntityIds)
    || !value.participantEntityIds.every(isNonEmptyString)
    || !(value.activeEntityId === null || isNonEmptyString(value.activeEntityId))) return undefined;
  return {
    id: value.encounterId,
    status: value.status,
    round: Number(value.round),
    activeEntityId: value.activeEntityId as string | null,
    participantEntityIds: [...new Set(value.participantEntityIds as string[])].sort(),
  };
}

function projectTacticalScene(
  state: AuthoritativeWorldState,
  character: CharacterRecord,
  visibleCombatEntities: Record<string, JsonRecord>,
  visibleEncounters: Record<string, JsonRecord>,
): TacticalProjection | undefined {
  const scene = state.scenes[character.sceneId];
  const combatScene = state.combatRuntime.scenes[character.sceneId];
  const geometry = isRecord(combatScene) ? combatScene.geometry : undefined;
  if (scene === undefined || !isCanonicalTacticalGeometry(geometry)) return undefined;
  const self = tacticalEntity(visibleCombatEntities[character.id], "self");
  if (self === undefined) return undefined;
  const participantEncounters = Object.values(visibleEncounters)
    .filter((candidate) => Array.isArray(candidate.participantEntityIds)
      && candidate.participantEntityIds.includes(character.id))
    .sort((left, right) => String(left.encounterId).localeCompare(String(right.encounterId)));
  const activeEncounters = participantEncounters.filter((candidate) => candidate.status !== "concluded");
  if (activeEncounters.length > 1) return undefined;
  const encounterValue = activeEncounters[0] ?? participantEncounters[0];
  const encounter = tacticalEncounterSummary(encounterValue);
  if (encounter === undefined) return undefined;
  const fullEncounter = encounterValue === undefined
    ? undefined
    : state.combatRuntime.encounters[String(encounterValue.encounterId)];
  const hostileIds = hostileToViewer(fullEncounter, character.id);
  const visibleEntities = Object.entries(visibleCombatEntities)
    .filter(([entityId]) => entityId !== character.id)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([entityId, entity]) => {
      const relation: TacticalEntity["relation"] = hostileIds.has(entityId)
        ? "enemy"
        : entity.kind === "player" ? "ally" : "neutral";
      const projected = tacticalEntity(entity, relation);
      return projected === undefined ? [] : [projected];
    });
  const knownFeatures: TacticalKnownFeature[] = geometry.obstacles
    .filter((feature) => feature.visibilityPolicyId === "visibility:public"
      || feature.visibilityPolicyId === "visibility:scene-observers")
    .sort((left, right) => left.featureId.localeCompare(right.featureId))
    .map((feature) => ({
      id: feature.featureId,
      kind: feature.kind,
      label: feature.label,
      state: feature.state,
      polygon: structuredClone(feature.polygon),
      elevation: feature.elevation,
      height: feature.height,
      opaque: feature.opaque,
      impassable: feature.impassable,
      cover: feature.cover,
      propagation: feature.propagation,
      terrain: feature.terrain ?? "normal",
      ...(feature.durability === undefined ? {} : {
        durability: {
          current: feature.durability.current,
          maximum: feature.durability.maximum,
        },
      }),
    }));
  const entityReadout = visibleEntities.map((entity) => {
    const milliInches = BigInt(pathLengthMilliInches([
      self.position,
      entity.position,
    ]));
    const approximateFeet = (milliInches + 6_000n) / 12_000n;
    return `${entity.name}与我中心直线约距 ${approximateFeet} 尺；位置 (${entity.position.x}, ${entity.position.y})，高程 ${entity.position.elevation} 英寸，实体高度 ${entity.footprint.height} 英寸。`;
  });
  const coverLabel: Record<TacticalKnownFeature["cover"], string> = {
    none: "无掩护",
    half: "半掩护",
    threeQuarters: "四分之三掩护",
    full: "全掩护",
  };
  const featureReadout = knownFeatures.map((feature) => {
    const mechanics = [
      feature.impassable ? "阻挡移动" : "不阻挡移动",
      feature.opaque ? "阻挡视线" : "不阻挡视线",
      coverLabel[feature.cover],
      feature.propagation === "blocks" ? "阻断区域传播" : "允许区域传播",
      feature.terrain === "rubble" ? "形成碎石地" : "地表未改变",
      ...(feature.durability === undefined
        ? []
        : [`耐久 ${feature.durability.current}/${feature.durability.maximum}`]),
    ];
    return `${feature.label}：${mechanics.join("、")}。`;
  });
  const viewerSafeSpatialPayload = {
    schema: "zhuwei.tactical-spatial-revision/v1" as const,
    scene: {
      id: scene.id,
      name: scene.name,
      boundary: structuredClone(geometry.boundary),
      gridInches: 60 as const,
    },
    self,
    visibleEntities,
    knownFeatures,
    knownZones: [] as const,
    encounter,
  };
  const result: TacticalProjection = {
    schema: "zhuwei.tactical-projection/v1",
    scene: viewerSafeSpatialPayload.scene,
    self: viewerSafeSpatialPayload.self,
    visibleEntities: viewerSafeSpatialPayload.visibleEntities,
    knownFeatures: viewerSafeSpatialPayload.knownFeatures,
    knownZones: [],
    encounter: viewerSafeSpatialPayload.encounter,
    preview: null,
    textualReadout: {
      sceneId: scene.id,
      summary: `${self.name}位于${scene.name}；可见 ${visibleEntities.length} 个其他单位与 ${knownFeatures.length} 个已知环境要素。`,
      entities: entityReadout,
      features: featureReadout,
    },
    spatialRevision: canonicalSha256(viewerSafeSpatialPayload),
  };
  return isTacticalProjection(result) ? result : undefined;
}

function projectAuthoritative(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  viewerValue: unknown,
): SafeReadModel | LifecycleReadModel | KpSpatialReadModel | ReturnType<typeof rejected> {
  const lifecycle = projectLifecycle(profiles, state, viewerValue);
  if (lifecycle !== undefined) return lifecycle;
  if (isKpSpatialViewer(viewerValue)) {
    return projectKpSpatialEvidence(profiles, state);
  }
  const authorized = isRecord(viewerValue) && viewerValue.kind === "npc"
    ? authorizeNpc(state, viewerValue)
    : authorizePlayer(state, viewerValue);
  if (authorized === undefined) {
    return rejected("viewerUnauthorized", "Viewer authentication is unavailable.");
  }

  const character = authorized.character;
  const inventory = projectHeldInventory(state.campaignRuntime.itemSystem, {
    kind: authorized.kind,
    characterId: character.id,
  });
  const timelineId = characterTimelineId(state, character.id) ?? state.activeBranchId;
  const timeline = state.fictionTimelines[timelineId];
  const visibleFacts = Object.values(state.canonicalFacts)
    .filter((fact) => canonicalFactVisibleToCharacter(state, fact, character))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((fact) => structuredClone(fact));
  const knowledge = Object.values(state.knowledge[character.id] ?? {})
    .sort((left, right) => left.knowledgeRef.localeCompare(right.knowledgeRef))
    .map((entry) => structuredClone(entry));
  const receipts = Object.values(state.receipts)
    .filter((receipt) => receipt.subjectCharacterIds.includes(character.id))
    .sort((left, right) => BigInt(left.eventRange.fromEventSeq) < BigInt(right.eventRange.fromEventSeq) ? -1 : 1)
    .map(safeReceipt);
  const visibleCombatEntities = Object.fromEntries(
    Object.entries(state.combatRuntime.entities)
      .filter(([, entity]) => entity.sceneId === character.sceneId
        && spatialRecordVisibleTo(state, entity, character.id))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([entityId, entity]) => [
        entityId,
        observerSafeCombatEntity(state, entity, character.id),
      ]),
  );
  const visibleCombatEntityIds = new Set(Object.keys(visibleCombatEntities));
  const controlledPendingInputs = Object.values(state.pendingInputs)
    .filter((pending) => pending.controllerCharacterId === character.id)
    .map((pending) => {
      const invitation = pending.kind === "partyInvitation"
        ? state.multiplayerRuntime.partyInvitations[pending.pendingInputId]
        : undefined;
      return {
        pendingInputId: pending.pendingInputId,
        kind: pending.kind,
        rootActionId: pending.rootActionId,
        question: pending.question,
        ...(pending.kind === "playerChoice"
          && Array.isArray(pending.options?.choices)
          ? { choices: structuredClone(pending.options.choices) }
          : {}),
        ...(pending.kind === "socialResolution" && isRecord(pending.options)
          ? {
              options: Object.fromEntries([
                "npcCharacterId",
                "npcName",
                "goal",
                "method",
                "risk",
                "successOutcome",
                "failureOutcome",
                "dc",
                "retryGate",
              ].flatMap((key) => pending.options?.[key] === undefined
                ? []
                : [[key, structuredClone(pending.options[key])]])),
            }
          : {}),
        ...(pending.options === undefined
          || pending.kind === "playerChoice"
          || pending.kind === "socialResolution"
          ? {}
          : { options: structuredClone(pending.options) }),
        ...(invitation === undefined ? {} : {
          access: "controller" as const,
          inviterCharacterId: invitation.inviterCharacterId as string,
          invitedCharacterId: invitation.invitedCharacterId as string,
        }),
      };
    });
  const outgoingPartyInvitations = Object.entries(state.multiplayerRuntime.partyInvitations)
    .filter(([, invitation]) =>
      invitation.status === "pending" && invitation.inviterCharacterId === character.id)
    .flatMap(([pendingInputId, invitation]) => {
      const pending = state.pendingInputs[pendingInputId];
      return pending === undefined ? [] : [{
        pendingInputId,
        kind: "partyInvitation" as const,
        rootActionId: pending.rootActionId,
        question: "等待对方回应同行邀请。",
        access: "initiator" as const,
        inviterCharacterId: character.id,
        invitedCharacterId: invitation.invitedCharacterId as string,
      }];
    });
  const controlledCombatPending = Object.values(state.combatRuntime.pendingInputs)
    .filter((pending) => isRecord(pending)
      && (authorized.kind === "player" ? pending.kind === "playerChoice" : pending.kind === "kpDecision")
      && pending.controllerEntityId === character.id
      && isNonEmptyString(pending.pendingInputId)
      && isNonEmptyString(pending.rootActionId))
    .map((pending) => ({
      pendingInputId: pending.pendingInputId as string,
      kind: "combatChoice" as const,
      rootActionId: pending.rootActionId as string,
      question: pending.choiceKind === "initiativeTieOrder"
        ? "请决定同点玩家角色的先攻顺序。"
        : pending.choiceKind === "triggerOrder"
          ? "请决定你同时发生且会相互影响的触发顺序。"
        : pending.choiceKind === "reaction"
          ? pending.reactionKind === "shield"
            ? "是否施放护盾术？"
            : pending.reactionKind === "counterspell"
              ? "是否施放反制法术？"
              : pending.reactionKind === "ready"
                ? "是否执行已预备的回应？"
                : "是否使用这次反应？"
          : pending.choiceKind === "encounterConclusion"
            ? "是否接受当前遭遇的收束方式？"
          : pending.choiceKind === "knockOut"
            ? "是否将这次近战攻击改为非致命击昏？"
            : "请选择本次战斗行动的明确目标或取消。",
      ...(isNonEmptyString(pending.choiceKind) ? { choiceKind: pending.choiceKind } : {}),
      ...(Array.isArray(pending.candidateEntityIds)
        ? { candidateEntityIds: pending.candidateEntityIds.filter((entry) =>
            isNonEmptyString(entry) && visibleCombatEntityIds.has(entry)) }
        : {}),
      ...(Array.isArray(pending.candidateAbilityRefs)
        ? { candidateAbilityRefs: pending.candidateAbilityRefs.filter(isNonEmptyString) }
        : {}),
      ...(isNonEmptyString(pending.reactionKind) ? { reactionKind: pending.reactionKind } : {}),
      ...(isNonEmptyString(pending.triggerKind) ? { triggerKind: pending.triggerKind } : {}),
      ...(pending.choiceKind === "reaction"
          && isNonEmptyString(pending.targetEntityId)
          && visibleCombatEntityIds.has(pending.targetEntityId)
        ? { targetEntityId: pending.targetEntityId }
        : pending.choiceKind === "reaction"
          && isNonEmptyString(pending.movingEntityId)
          && visibleCombatEntityIds.has(pending.movingEntityId)
          ? { targetEntityId: pending.movingEntityId }
        : {}),
      ...(Array.isArray(pending.orderedEntityIds)
        ? { orderedEntityIds: pending.orderedEntityIds.filter((entry) =>
            isNonEmptyString(entry) && visibleCombatEntityIds.has(entry)) }
        : {}),
      ...(Array.isArray(pending.orderedTriggerInstanceIds)
        ? { orderedTriggerInstanceIds: pending.orderedTriggerInstanceIds.filter(isNonEmptyString) }
        : {}),
      ...(isNonEmptyString(pending.triggerBatchId)
        ? { triggerBatchId: pending.triggerBatchId }
        : {}),
      ...(isNonEmptyString(pending.triggerBatchHash)
        ? { triggerBatchHash: pending.triggerBatchHash }
        : {}),
    }));
  const pendingInputs = [
    ...controlledPendingInputs,
    ...outgoingPartyInvitations,
    ...controlledCombatPending,
  ]
    .sort((left, right) => left.pendingInputId.localeCompare(right.pendingInputId));
  const roomMembers = Object.values(state.multiplayerRuntime.members)
    .filter((member) => member.status === "active")
    .sort((left, right) => left.principalId.localeCompare(right.principalId))
    .map((member) => ({
      principalId: member.principalId,
      role: member.role,
      characterIds: Object.values(state.characterControls)
        .filter((control) => state.seats[control.seatId]?.principalId === member.principalId)
        .map((control) => control.characterId)
        .filter((characterId) => state.entities[characterId]?.tenureStatus === "active")
        .sort(),
      seatStatus: Object.values(state.seats).some((seat) =>
        seat.principalId === member.principalId && seat.status === "active")
        ? "active" as const
        : "inactive" as const,
    }));
  const partyGroups = Object.values(state.multiplayerRuntime.partyGroups)
    .filter((group) => group.status === "active"
      && Array.isArray(group.memberCharacterIds)
      && group.memberCharacterIds.includes(character.id))
    .sort((left, right) => String(left.groupId).localeCompare(String(right.groupId)))
    .map((group) => ({
      groupId: group.groupId,
      leaderCharacterId: group.leaderCharacterId,
      memberCharacterIds: [...group.memberCharacterIds as string[]],
    }));
  const causalFrontier = structuredClone(
    state.multiplayerRuntime.causalFrontiers[timelineId] ?? {
      timelineId,
      sceneId: character.sceneId,
      branchId: timeline.branchId,
      nowMicros: timeline.nowMicros,
      eventHeadId: null,
      causalParentTimelineIds: [],
    },
  );
  const spotlightLedger = Object.fromEntries(
    Object.entries(state.multiplayerRuntime.spotlightLedger)
      .filter(([characterId]) => state.entities[characterId]?.kind === "player"
        && state.entities[characterId]?.tenureStatus === "active")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([characterId, entry]) => [characterId, {
        characterId,
        seatId: entry.seatId,
        decisionBeats: entry.decisionBeats,
        invited: entry.invited,
        lastInvitedBeat: entry.lastInvitedBeat,
        explicitSkips: entry.explicitSkips,
      }]),
  );
  const visibleEncounters = Object.fromEntries(
    Object.entries(state.combatRuntime.encounters)
      .filter(([, encounter]) => encounter.sceneId === character.sceneId)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([encounterId, encounter]) => [
        encounterId,
        observerSafeEncounter(encounter, visibleCombatEntityIds),
      ]),
  );
  const tacticalProjection = projectTacticalScene(
    state,
    character,
    visibleCombatEntities,
    visibleEncounters,
  );
  if (tacticalProjection === undefined) {
    return rejected("invalidWorldState", "The viewer tactical projection is unavailable.");
  }
  const controlledCombatEntity = state.combatRuntime.entities[character.id];
  const controlledAbilityRefs = Array.isArray(controlledCombatEntity?.abilityRefs)
    ? controlledCombatEntity.abilityRefs.filter(isNonEmptyString).sort()
    : [];
  const controlledCombat = controlledCombatEntity === undefined
    ? undefined
    : {
        abilityRefs: controlledAbilityRefs,
        definitions: Object.fromEntries(controlledAbilityRefs.flatMap((definitionId) => {
          const definition = state.combatRuntime.definitions[definitionId];
          return definition === undefined
            ? []
            : [[definitionId, isRecord(definition.mechanicGraph)
              ? projectRegisteredAbility(definition)
              : structuredClone(definition)]];
        })),
        resources: isRecord(controlledCombatEntity.resources)
          ? structuredClone(controlledCombatEntity.resources)
          : {},
        ...(isRecord(controlledCombatEntity.spellcasting)
          ? { spellcasting: structuredClone(controlledCombatEntity.spellcasting) }
          : {}),
      };
  const adjudicationPrecedents = publicAdjudicationPrecedents(state, character.sceneId);

  const base = {
    kind: "projected" as const,
    runtimeProfiles: structuredClone(profiles),
    stateVersion: state.version,
    activeBranchId: state.activeBranchId,
    viewer: {
      kind: authorized.kind,
      subjectId: character.id,
      ...(authorized.kind === "player" && authorized.principalId !== undefined
        ? { principalId: authorized.principalId }
        : {}),
    },
    controlledCharacter: {
      characterId: character.id,
      name: character.name,
      sceneId: character.sceneId,
      tenureStatus: character.tenureStatus,
      ...(character.level === undefined ? {} : { level: character.level }),
      ...(character.experiencePoints === undefined
        ? {}
        : { experiencePoints: character.experiencePoints }),
      ...(character.classId === undefined ? {} : { classId: character.classId }),
      ...(character.raceId === undefined ? {} : { raceId: character.raceId }),
      ...(character.subclassId === undefined ? {} : { subclassId: character.subclassId }),
      ...(character.hitPoints === undefined ? {} : { hitPoints: structuredClone(character.hitPoints) }),
      ...(character.resources === undefined ? {} : { resources: structuredClone(character.resources) }),
      ...(authorized.kind === "player"
        ? { restRecoveryOptions: projectRestRecoveryOptions(character) }
        : {}),
      ...(character.resourceMaximums === undefined
        ? {}
        : { resourceMaximums: structuredClone(character.resourceMaximums) }),
      ...(character.abilityScores === undefined
        ? {}
        : { abilityScores: structuredClone(character.abilityScores) }),
      ...(character.proficiencyBonus === undefined
        ? {}
        : { proficiencyBonus: character.proficiencyBonus }),
      ...(character.proficientSkills === undefined
        ? {}
        : { proficientSkills: [...character.proficientSkills] }),
      ...(character.expertiseSkills === undefined
        ? {}
        : { expertiseSkills: [...character.expertiseSkills] }),
      ...(character.proficientSaves === undefined
        ? {}
        : { proficientSaves: [...character.proficientSaves] }),
      ...(character.featureIds === undefined ? {} : { featureIds: [...character.featureIds] }),
      ...(character.lastLongRestCompletedAtMicros === undefined
        ? {}
        : { lastLongRestCompletedAtMicros: character.lastLongRestCompletedAtMicros }),
      ...(character.loadout === undefined ? {} : { loadout: structuredClone(character.loadout) }),
      inventory,
      ...(authorized.kind !== "npc" || character.socialMechanics === undefined
        ? {}
        : {
            socialCapabilities: {
              maximumInfluenceDegree: character.socialMechanics.maximumInfluenceDegree,
            },
          }),
      ...(controlledCombat === undefined ? {} : { combat: controlledCombat }),
    },
    abilityDefinitions: Object.fromEntries(
      Object.entries(state.campaignRuntime.definitions)
        .filter(([, definition]) => isRecord(definition.mechanicGraph)
          && (definition.visibilityPolicy === "public"
            || definition.controllerCharacterId === character.id
            || definition.sourceEntityId === character.id
            || controlledAbilityRefs.includes(String(definition.definitionId))))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([definitionId, definition]) => [
          definitionId,
          projectRegisteredAbility(definition),
        ]),
    ),
    fictionTime: {
      branchId: timeline.branchId,
      nowMicros: timeline.nowMicros,
    },
    visibleFacts,
    knowledge,
    receipts,
    pendingInputs,
    adjudicationPrecedents,
    ...(authorized.kind !== "player"
      || authorized.principalId === undefined
      || state.multiplayerRuntime.safetyPresentations[authorized.principalId] === undefined
      ? {}
      : {
          safetyPresentation: {
            status: state.multiplayerRuntime.safetyPresentations[authorized.principalId].status,
            presentationAdjustment:
              state.multiplayerRuntime.safetyPresentations[authorized.principalId].presentationAdjustment,
          },
        }),
    causalFrontier,
    activities: Object.values(state.campaignRuntime.activities)
      .filter((activity) => activity.characterId === character.id)
      .map((entry) => structuredClone(entry)),
    ...(authorized.kind === "player" ? { roomMembers, partyGroups, spotlightLedger } : {}),
    visibleItems: Object.values(state.campaignRuntime.itemSystem.entries)
      .flatMap((entry) => {
        const definition = state.campaignRuntime.itemSystem.definitions[entry.definitionRef];
        if (definition === undefined) return [];
        const safe = safeVisibleItemFor(state, entry, definition, character);
        return safe === undefined ? [] : [safe];
      })
      .sort((left, right) => String(left.itemEntryId).localeCompare(String(right.itemEntryId))),
    ...(state.campaignRuntime.campaign === null ? {} : {
      campaign: structuredClone(state.campaignRuntime.campaign),
      chapters: Object.values(state.campaignRuntime.chapters).map((entry) => structuredClone(entry)),
      factions: Object.values(state.campaignRuntime.factions)
        .flatMap((faction) => {
          const safe = safeFactionFor(faction, character);
          return safe === undefined ? [] : [safe];
        })
        .sort((left, right) => String(left.factionId).localeCompare(String(right.factionId))),
      factionPlans: Object.values(state.campaignRuntime.factionPlans)
        .flatMap((plan) => {
          const safe = safeFactionPlanFor(plan, character);
          return safe === undefined ? [] : [safe];
        })
        .sort((left, right) => String(left.planId).localeCompare(String(right.planId))),
      relationships: Object.values(state.campaignRuntime.relationships)
        .filter((relationship) => Array.isArray(relationship.subjectIds)
          && relationship.subjectIds.includes(character.id))
        .flatMap((entry) => {
          const safe = safeRelationshipFor(entry);
          return safe === undefined ? [] : [safe];
        }),
      promises: Object.values(state.campaignRuntime.promises)
        .filter((promise) => promise.promisorId === character.id || promise.promiseeId === character.id)
        .flatMap((entry) => {
          const safe = safePromiseFor(entry);
          return safe === undefined ? [] : [safe];
        }),
      debts: Object.values(state.campaignRuntime.debts)
        .filter((debt) => debt.debtorId === character.id || debt.creditorId === character.id)
        .flatMap((entry) => {
          const safe = safeDebtFor(entry);
          return safe === undefined ? [] : [safe];
        }),
      unresolvedThreats: [...state.campaignRuntime.unresolvedThreats],
      sourceClaims: Object.values(state.campaignRuntime.sourceClaims)
        .filter((claim) => claim.speakerId === character.id
          || String(claim.claimId) in (state.knowledge[character.id] ?? {}))
        .map((entry) => structuredClone(entry)),
      ...(state.campaignRuntime.conversationThreads === undefined
        ? {}
        : {
            conversationThreads: Object.values(state.campaignRuntime.conversationThreads)
              .filter((thread) => thread.actorCharacterId === character.id
                || thread.npcCharacterId === character.id)
              .map((thread) => safeConversationThreadFor(thread, authorized.kind))
              .sort((left, right) => String(left.threadRef).localeCompare(String(right.threadRef))),
          }),
      npcPlans: Object.values(state.campaignRuntime.npcPlans)
        .filter((plan) => authorized.kind === "npc" && plan.npcId === character.id)
        .map((entry) => structuredClone(entry)),
      stories: Object.values(state.campaignRuntime.stories).map((entry) => structuredClone(entry)),
      epilogues: Object.values(state.campaignRuntime.epilogues)
        .filter((entry) => entry.characterId === character.id)
        .map((entry) => structuredClone(entry)),
    }),
    ...(state.combatRuntime.story === null ? {} : {
      entities: visibleCombatEntities,
      encounters: visibleEncounters,
      story: structuredClone(state.combatRuntime.story),
    }),
    ...(tacticalProjection === undefined ? {} : { tacticalProjection }),
  };
  return {
    ...base,
    projectionHash: canonicalSha256(base),
  } satisfies SafeReadModel;
}

function projectDueActorPlan(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  viewerValue: unknown,
  query: ProjectionQuery,
): DueActorPlanReadModel | ReturnType<typeof rejected> {
  if (!isKpSpatialViewer(viewerValue)
    || !isRecord(query.dueActorPlanFor)
    || !isNonEmptyString(query.dueActorPlanFor.affectedCharacterId)) {
    return rejected("viewerUnauthorized", "Due ActorPlan selection requires the internal KP capability.");
  }
  const selected = earliestEligibleDueActorPlan(
    state,
    query.dueActorPlanFor.affectedCharacterId,
  );
  if (selected === undefined) {
    const base = {
      kind: "projected" as const,
      runtimeProfiles: structuredClone(profiles),
      stateVersion: state.version,
      activeBranchId: state.activeBranchId,
      viewer: { kind: "kp" as const, subjectId: "kp" as const },
      dueActorPlan: null,
      dueActorPlanChildRootActionId: null,
    };
    return { ...base, projectionHash: canonicalSha256(base) };
  }
  const npcProjection = projectAuthoritative(profiles, state, {
    kind: "npc",
    npcId: selected.npcId,
    purpose: "kpDecision",
    capability: "internal:npc-limited-knowledge",
  });
  if (npcProjection.kind === "rejected"
    || npcProjection.viewer.kind !== "npc"
    || !("controlledCharacter" in npcProjection)) {
    return rejected("viewerUnauthorized", "The due ActorPlan NPC projection is unavailable.");
  }
  const { projectionHash: _projectionHash, ...projected } = npcProjection;
  const childRootActionId = dueActorPlanChildRoot(selected.plan);
  if (childRootActionId === undefined) {
    return rejected("invalidWorldState", "The due ActorPlan child root is unavailable.");
  }
  const base = {
    ...projected,
    dueActorPlan: structuredClone(selected.plan),
    dueActorPlanChildRootActionId: childRootActionId,
  };
  return { ...base, projectionHash: canonicalSha256(base) } as DueActorPlanReadModel;
}

function isKpSpatialReadModel(value: ProjectionResult): value is KpSpatialReadModel {
  return value.kind === "projected" && value.viewer.kind === "kp";
}

function isLifecycleReadModel(value: ProjectionResult): value is LifecycleReadModel {
  return value.kind === "projected"
    && "controlledCharacter" in value
    && value.controlledCharacter === null;
}

const ACTOR_DELTA_FIELDS = [
  "controlledCharacter",
  "safetyPresentation",
  "fictionTime",
  "visibleFacts",
  "knowledge",
  "pendingInputs",
  "campaign",
  "chapters",
  "visibleItems",
  "factions",
  "factionPlans",
  "npcPlans",
  "adjudicationPrecedents",
  "relationships",
  "promises",
  "activities",
  "unresolvedThreats",
  "sourceClaims",
  "conversationThreads",
  "stories",
  "epilogues",
  "entities",
  "encounters",
  "tacticalProjection",
  "story",
] as const;

const OBSERVER_DELTA_FIELDS = [
  "visibleFacts",
  "adjudicationPrecedents",
  "campaign",
  "chapters",
  "unresolvedThreats",
  "conversationThreads",
  "stories",
  "entities",
  "encounters",
  "tacticalProjection",
  "story",
] as const;

type VerifiedCommittedRange = {
  actorCharacterId: string;
  priorState: AuthoritativeWorldState;
  events: EventEnvelope[];
  receipt: PublicReceipt;
};

function sameProjectedValue(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalSha256({ value: left }) === canonicalSha256({ value: right });
}

type VerifiedIncrementalRange = {
  priorState: AuthoritativeWorldState;
  events: EventEnvelope[];
  expectedFrom: {
    eventSeq: string;
    stateHash?: `sha256:${string}`;
    eventHash?: `sha256:${string}`;
    projectionHash?: `sha256:${string}`;
  };
};

function verifiedIncrementalRange(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  query: ProjectionQuery | undefined,
): VerifiedIncrementalRange | "invalid" | undefined {
  const rangeValue = isRecord(query) ? query.incrementalRange : undefined;
  if (rangeValue === undefined) return undefined;
  if (
    !isRecord(rangeValue)
    || !isAuthoritativeWorldState(rangeValue.priorState)
    || !Array.isArray(rangeValue.events)
    || !isRecord(rangeValue.expectedFrom)
    || !isNonEmptyString(rangeValue.expectedFrom.eventSeq)
  ) return "invalid";

  const priorState = rangeValue.priorState;
  if (
    priorState.roomId !== state.roomId
    || priorState.runtimeEpochId !== state.runtimeEpochId
    || priorState.version !== rangeValue.expectedFrom.eventSeq
  ) return "invalid";

  const fromStateHash = hashWorldState(priorState);
  if (
    (rangeValue.expectedFrom.stateHash !== undefined
      && rangeValue.expectedFrom.stateHash !== fromStateHash)
    || (rangeValue.expectedFrom.eventHash !== undefined
      && rangeValue.expectedFrom.eventHash !== priorState.eventHeadHash)
  ) return "invalid";

  let folded = structuredClone(priorState);
  const events: EventEnvelope[] = [];
  try {
    for (const eventValue of rangeValue.events) {
      const validation = validateEventEnvelope(eventValue);
      if (!validation.ok) return "invalid";
      const event = validation.event;
      const expectedSeq = (BigInt(folded.version) + 1n).toString();
      if (
        event.roomId !== folded.roomId
        || event.runtimeEpochId !== folded.runtimeEpochId
        || event.eventSeq !== expectedSeq
        || event.previousEventHash !== folded.eventHeadHash
        || event.parentEventId !== folded.lastEventId
        || event.stateBeforeHash !== hashWorldState(folded)
        || canonicalSha256(event.profiles) !== canonicalSha256(profiles)
      ) return "invalid";
      const next = foldEvent(folded, event);
      if (
        hashWorldState(next) !== event.stateHashAfter
        || eventHash(event) !== event.eventHash
      ) return "invalid";
      folded = next;
      events.push(event);
    }
  } catch {
    return "invalid";
  }

  if (
    folded.version !== state.version
    || folded.lastEventId !== state.lastEventId
    || folded.eventHeadHash !== state.eventHeadHash
    || hashWorldState(folded) !== hashWorldState(state)
  ) return "invalid";
  return {
    priorState,
    events,
    expectedFrom: rangeValue.expectedFrom,
  };
}

const INCREMENTAL_METADATA_FIELDS = new Set([
  "activeBranchId",
  "incrementalDelta",
  "kind",
  "projectionHash",
  "runtimeProfiles",
  "stateVersion",
  "viewer",
]);

function incrementalProjectionChanges(
  before: SafeReadModel | LifecycleReadModel,
  after: SafeReadModel | LifecycleReadModel,
  correction: boolean,
): ObserverDeltaChange[] {
  const beforeRecord = before as unknown as JsonRecord;
  const afterRecord = after as unknown as JsonRecord;
  const fields = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])]
    .filter((field) => !INCREMENTAL_METADATA_FIELDS.has(field))
    .sort();
  return fields.flatMap((field) => {
    const beforeValue = beforeRecord[field];
    const afterValue = afterRecord[field];
    if (sameProjectedValue(beforeValue, afterValue)) return [];
    if (correction) {
      return [{
        kind: "projectionFieldCorrected",
        field,
        ...(afterValue === undefined
          ? { removed: true }
          : { current: structuredClone(afterValue) }),
      }];
    }
    return [{
      kind: "projectionFieldChanged",
      field,
      ...(afterValue === undefined
        ? { removed: true }
        : { current: structuredClone(afterValue) }),
    }];
  });
}

function lifecyclePriorProjection(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  viewerValue: PlayerViewer | NpcViewer | unknown,
): SafeReadModel | LifecycleReadModel | undefined {
  const lifecycle = projectAuthoritative(profiles, state, viewerValue);
  if (
    lifecycle.kind !== "rejected"
    && !isKpSpatialReadModel(lifecycle)
  ) return lifecycle;
  if (!isRecord(viewerValue) || viewerValue.kind !== "player") return undefined;
  const { purpose: _purpose, ...activeViewer } = viewerValue;
  const active = projectAuthoritative(profiles, state, activeViewer);
  return active.kind !== "rejected"
    && !isKpSpatialReadModel(active)
    && !isLifecycleReadModel(active)
    ? active
    : undefined;
}

function lifecycleIncrementalDelta(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  viewerValue: PlayerViewer | NpcViewer | unknown,
  after: LifecycleReadModel,
  query: ProjectionQuery | undefined,
): ObserverIncrementalDelta | "invalid" | undefined {
  const range = verifiedIncrementalRange(profiles, state, query);
  if (range === undefined || range === "invalid") return range;
  const before = lifecyclePriorProjection(profiles, range.priorState, viewerValue);
  if (
    before === undefined
    || (range.expectedFrom.projectionHash !== undefined
      && range.expectedFrom.projectionHash !== before.projectionHash)
  ) return "invalid";

  return {
    schema: "zhuwei.observer-incremental-delta/v1",
    from: {
      eventSeq: range.priorState.version,
      stateHash: hashWorldState(range.priorState),
      eventHash: range.priorState.eventHeadHash,
      projectionHash: before.projectionHash,
    },
    to: {
      eventSeq: state.version,
      stateHash: hashWorldState(state),
      eventHash: state.eventHeadHash,
      projectionHash: after.projectionHash,
    },
    changes: incrementalProjectionChanges(
      before,
      after,
      range.events.some((event) =>
        event.eventType === "CorrectionApplied"
        || event.eventType === "CorrectionBranchOpened"
        || event.eventType === "BranchActivated"),
    ),
  };
}

function observerIncrementalDelta(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  viewerValue: PlayerViewer | NpcViewer | unknown,
  after: SafeReadModel,
  query: ProjectionQuery | undefined,
): ObserverIncrementalDelta | "invalid" | undefined {
  const range = verifiedIncrementalRange(profiles, state, query);
  if (range === undefined || range === "invalid") return range;
  const beforeValue = projectAuthoritative(profiles, range.priorState, viewerValue);
  if (
    beforeValue.kind === "rejected"
    || isKpSpatialReadModel(beforeValue)
    || isLifecycleReadModel(beforeValue)
    || (range.expectedFrom.projectionHash !== undefined
      && range.expectedFrom.projectionHash !== beforeValue.projectionHash)
  ) return "invalid";

  const from: ObserverProjectionAnchor = {
    eventSeq: range.priorState.version,
    stateHash: hashWorldState(range.priorState),
    eventHash: range.priorState.eventHeadHash,
    projectionHash: beforeValue.projectionHash,
  };
  const to: ObserverProjectionAnchor = {
    eventSeq: state.version,
    stateHash: hashWorldState(state),
    eventHash: state.eventHeadHash,
    projectionHash: after.projectionHash,
  };
  return {
    schema: "zhuwei.observer-incremental-delta/v1",
    from,
    to,
    changes: incrementalProjectionChanges(
      beforeValue,
      after,
      range.events.some((event) =>
        event.eventType === "CorrectionApplied"
        || event.eventType === "CorrectionBranchOpened"
        || event.eventType === "BranchActivated"),
    ),
  };
}

function verifiedCommittedRange(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  query: ProjectionQuery | undefined,
): VerifiedCommittedRange | undefined {
  const rangeValue = isRecord(query) ? query.committedRange : undefined;
  if (
    !isRecord(rangeValue)
    || !isNonEmptyString(rangeValue.receiptId)
    || !isNonEmptyString(rangeValue.actorCharacterId)
    || !isAuthoritativeWorldState(rangeValue.priorState)
    || !Array.isArray(rangeValue.events)
    || rangeValue.events.length === 0
  ) return undefined;

  const receipt = Object.values(state.receipts)
    .find((candidate) => candidate.receiptId === rangeValue.receiptId);
  if (
    receipt === undefined
    || !receipt.subjectCharacterIds.includes(rangeValue.actorCharacterId)
  ) return undefined;

  let folded = structuredClone(rangeValue.priorState);
  const events: EventEnvelope[] = [];
  try {
    for (const eventValue of rangeValue.events) {
      const validation = validateEventEnvelope(eventValue);
      if (!validation.ok) return undefined;
      const event = validation.event;
      const expectedSeq = (BigInt(folded.version) + 1n).toString();
      if (
        event.roomId !== folded.roomId
        || event.runtimeEpochId !== folded.runtimeEpochId
        || event.eventSeq !== expectedSeq
        || event.rootActionId !== receipt.rootActionId
        || event.previousEventHash !== folded.eventHeadHash
        || event.parentEventId !== folded.lastEventId
        || event.stateBeforeHash !== hashWorldState(folded)
        || event.profiles.manifest.profileId !== profiles.manifest.profileId
        || event.profiles.manifest.profileHash !== profiles.manifest.profileHash
      ) return undefined;
      const next = foldEvent(folded, event);
      if (
        hashWorldState(next) !== event.stateHashAfter
        || eventHash(event) !== event.eventHash
      ) return undefined;
      folded = next;
      events.push(event);
    }
  } catch {
    return undefined;
  }

  const first = events[0];
  const last = events[events.length - 1];
  let receiptFrom: bigint;
  let receiptTo: bigint;
  let segmentFrom: bigint;
  let segmentTo: bigint;
  try {
    receiptFrom = BigInt(receipt.eventRange.fromEventSeq);
    receiptTo = BigInt(receipt.eventRange.toEventSeq);
    segmentFrom = BigInt(first.eventSeq);
    segmentTo = BigInt(last.eventSeq);
  } catch {
    return undefined;
  }
  if (
    receiptFrom > segmentFrom
    || receiptTo < segmentTo
    || folded.version !== state.version
    || folded.lastEventId !== state.lastEventId
    || folded.eventHeadHash !== state.eventHeadHash
    || hashWorldState(folded) !== hashWorldState(state)
  ) return undefined;

  return {
    actorCharacterId: rangeValue.actorCharacterId,
    priorState: rangeValue.priorState,
    events,
    receipt: {
      ...safeReceipt(receipt),
      eventRange: {
        fromEventSeq: first.eventSeq,
        toEventSeq: last.eventSeq,
      },
    },
  };
}

function projectionFieldChanges(
  before: SafeReadModel | undefined,
  after: SafeReadModel,
  actor: boolean,
): ObserverDeltaChange[] {
  const fields = actor ? ACTOR_DELTA_FIELDS : OBSERVER_DELTA_FIELDS;
  const beforeRecord = before as unknown as JsonRecord | undefined;
  const afterRecord = after as unknown as JsonRecord;
  return fields.flatMap((field) => {
    const beforeValue = beforeRecord?.[field];
    const afterValue = afterRecord[field];
    if (sameProjectedValue(beforeValue, afterValue)) return [];
    return [{
      kind: "projectionFieldChanged",
      field,
      ...(beforeValue === undefined ? {} : { before: structuredClone(beforeValue) }),
      ...(afterValue === undefined ? {} : { after: structuredClone(afterValue) }),
    }];
  });
}

function isCorrectionCommittedRange(range: VerifiedCommittedRange): boolean {
  return range.events.some((event) =>
    event.eventType === "CorrectionApplied"
    || event.eventType === "CorrectionBranchOpened"
    || event.eventType === "BranchActivated");
}

/** A superseded branch may contain material the active viewer must no longer
 * receive. Correction narration therefore describes only the safe current
 * projection and the explicit public explanation; it never serializes the
 * invalid branch's `before` values or departure location. */
function correctionProjectionFieldChanges(
  before: SafeReadModel | undefined,
  after: SafeReadModel,
  actor: boolean,
): ObserverDeltaChange[] {
  const fields = actor ? ACTOR_DELTA_FIELDS : OBSERVER_DELTA_FIELDS;
  const beforeRecord = before as unknown as JsonRecord | undefined;
  const afterRecord = after as unknown as JsonRecord;
  return fields.flatMap((field) => {
    const beforeValue = beforeRecord?.[field];
    const currentValue = afterRecord[field];
    if (sameProjectedValue(beforeValue, currentValue)) return [];
    return [{
      kind: "projectionFieldCorrected",
      field,
      ...(currentValue === undefined ? {} : { current: structuredClone(currentValue) }),
    }];
  });
}

function publicCorrectionChanges(range: VerifiedCommittedRange): ObserverDeltaChange[] {
  const event = range.events.find((candidate) =>
    candidate.eventType === "CorrectionApplied"
    || candidate.eventType === "CorrectionBranchOpened");
  if (event === undefined) return [];
  if (event.eventType === "CorrectionApplied") {
    const payload = event.payload as EventPayloadByType["CorrectionApplied"];
    return [{
      kind: "correctionApplied",
      correctionId: payload.correctionId,
      strategy: "forwardCompensation",
      publicExplanation: payload.publicExplanation,
    }];
  }
  const payload = event.payload as EventPayloadByType["CorrectionBranchOpened"];
  return [{
    kind: "correctionApplied",
    correctionId: payload.correctionId,
    strategy: "causalBranch",
    publicExplanation: payload.publicExplanation,
  }];
}

function movementChanges(
  range: VerifiedCommittedRange,
  state: AuthoritativeWorldState,
  viewerCharacterId: string,
): ObserverDeltaChange[] {
  const changes: ObserverDeltaChange[] = [];
  const addMovement = (characterId: string, destinationSceneId: string) => {
    const sourceSceneId = range.priorState.entities[characterId]?.sceneId;
    const viewerPriorSceneId = range.priorState.entities[viewerCharacterId]?.sceneId;
    const viewerCurrentSceneId = state.entities[viewerCharacterId]?.sceneId;
    if (viewerCharacterId === characterId) {
      if (sourceSceneId !== undefined) {
        changes.push({
          kind: "characterMoved",
          characterId,
          fromSceneId: sourceSceneId,
          toSceneId: destinationSceneId,
        });
      }
      return;
    }
    if (sourceSceneId !== undefined && viewerPriorSceneId === sourceSceneId) {
      changes.push({ kind: "characterDeparted", characterId, sceneId: sourceSceneId });
    }
    if (viewerCurrentSceneId === destinationSceneId) {
      changes.push({ kind: "characterArrived", characterId, sceneId: destinationSceneId });
    }
  };

  for (const event of range.events) {
    if (event.eventType === "CharacterMoved") {
      const payload = event.payload as EventPayloadByType["CharacterMoved"];
      addMovement(payload.characterId, payload.destinationSceneId);
    }
    if (event.eventType === "PartyMoved") {
      const payload = event.payload as EventPayloadByType["PartyMoved"];
      for (const characterId of payload.memberCharacterIds) {
        addMovement(characterId, payload.destinationSceneId);
      }
    }
  }
  return changes;
}

function dynamicEntityChanges(
  range: VerifiedCommittedRange,
  state: AuthoritativeWorldState,
  viewerCharacterId: string,
): ObserverDeltaChange[] {
  const viewerSceneId = state.entities[viewerCharacterId]?.sceneId;
  const viewerTimelineId = characterTimelineId(state, viewerCharacterId);
  if (viewerSceneId === undefined || viewerTimelineId === undefined) return [];
  return range.events.flatMap((event) => {
    if (event.eventType !== "DynamicEntityMaterialized") return [];
    const payload = event.payload as EventPayloadByType["DynamicEntityMaterialized"];
    const entity = state.entities[payload.entityId];
    if (payload.sceneId !== viewerSceneId
      || payload.sourceTimelineId !== viewerTimelineId
      || entity?.kind !== "npc"
      || entity.sceneId !== payload.sceneId
      || characterTimelineId(state, entity.id) !== viewerTimelineId) return [];
    return [{
      kind: "dynamicEntityArrived",
      entityId: payload.entityId,
      entityKind: payload.entityKind,
      name: entity.name,
      sceneId: payload.sceneId,
    }];
  });
}

function actorEventChanges(
  range: VerifiedCommittedRange,
  state: AuthoritativeWorldState,
  viewerCharacterId: string,
): ObserverDeltaChange[] {
  if (viewerCharacterId !== range.actorCharacterId) return [];
  const changes: ObserverDeltaChange[] = [];
  for (const event of range.events) {
    switch (event.eventType) {
      case "ImprovisedActionResolved": {
        const payload = event.payload as EventPayloadByType["ImprovisedActionResolved"];
        const match = /^character-premise-(?:established|recalled):(.+)$/u.exec(
          payload.outcomeCode,
        );
        if (payload.actorCharacterId !== viewerCharacterId || match === null) break;
        const predicate = match[1];
        const fact = payload.fact ?? Object.values(state.canonicalFacts).find((candidate) =>
          candidate.kind === "characterPremise"
          && candidate.subjectRefs.length === 1
          && candidate.subjectRefs[0] === viewerCharacterId
          && isRecord(candidate.value)
          && candidate.value.predicate === predicate);
        if (fact === undefined || !isRecord(fact.value)) break;
        const bindings = Array.isArray(fact.value.bindings)
          ? fact.value.bindings.filter(isRecord).map((binding) => {
              const entityRef = typeof binding.entityRef === "string" ? binding.entityRef : "";
              const entity = state.entities[entityRef];
              const definition = state.campaignRuntime.definitions[entityRef];
              const content = isRecord(definition?.content) ? definition.content : {};
              const displayName = entity?.name
                ?? state.scenes[entityRef]?.name
                ?? (typeof content.name === "string" ? content.name : undefined)
                ?? (typeof content.displayAlias === "string" ? content.displayAlias : undefined)
                ?? entityRef;
              return {
                slotRef: binding.slotRef,
                relationKind: binding.relationKind,
                referenceKind: binding.referenceKind,
                entityRef,
                entityKind: binding.entityKind,
                displayName,
              };
            })
          : [];
        changes.push({
          kind: "characterPremiseResolved",
          resolution: payload.fact === null ? "recalled" : "established",
          factRef: fact.id,
          predicate,
          policyRef: fact.value.policyRef,
          statementTemplateRef: fact.value.statementTemplateRef,
          bindings,
          sourceRefs: structuredClone(fact.value.sourceRefs),
        });
        break;
      }
      case "FeasibilityRuled": {
        const payload = event.payload as EventPayloadByType["FeasibilityRuled"];
        if (payload.characterId !== viewerCharacterId) break;
        changes.push({
          kind: "actionRuled",
          characterId: payload.characterId,
          goal: payload.goal,
          method: payload.method,
          feasibility: payload.feasibilityKind,
          publicBasis: payload.publicBasis,
        });
        break;
      }
      case "ImprovisedCheckResolved": {
        const payload = event.payload as EventPayloadByType["ImprovisedCheckResolved"];
        if (payload.request.actorCharacterId !== viewerCharacterId) break;
        changes.push({
          kind: "checkResolved",
          characterId: viewerCharacterId,
          outcome: payload.succeeded ? "success" : "failure",
          selectedRoll: payload.selectedRoll,
          total: payload.total,
          result: payload.outcome,
        });
        break;
      }
      case "SocialResolutionDeclined": {
        const payload = event.payload as EventPayloadByType["SocialResolutionDeclined"];
        if (payload.actorCharacterId !== viewerCharacterId) break;
        changes.push({
          kind: "socialResolutionChanged",
          resolution: payload.reason === "reframed"
            ? "reframed"
            : payload.reason === "invalidated" ? "invalidated" : "statusQuo",
          npcCharacterId: payload.npcCharacterId,
          claimRef: payload.claimRef,
          threadRef: payload.threadRef,
          threadDisposition: payload.disposition,
          relationshipChanged: false,
          result: payload.outcome,
        });
        break;
      }
      case "SocialDirectResolved": {
        const payload = event.payload as EventPayloadByType["SocialDirectResolved"];
        if (payload.actorCharacterId !== viewerCharacterId) break;
        changes.push({
          kind: "socialResolutionChanged",
          resolution: "direct",
          npcCharacterId: payload.npcCharacterId,
          claimRef: payload.claimRef,
          responseClaimRef: payload.responseClaimRef,
          responseMode: payload.responseMode,
          responseReaction: payload.responseReaction,
          addressedThreadRef: payload.addressedThreadRef,
          threadRef: payload.threadRef,
          threadDisposition: payload.threadDisposition,
          relationshipChanged: false,
          result: payload.outcome,
        });
        break;
      }
      case "SocialCheckResolved": {
        const payload = event.payload as EventPayloadByType["SocialCheckResolved"];
        if (payload.actorCharacterId !== viewerCharacterId) break;
        changes.push({
          kind: "socialResolutionChanged",
          resolution: "check",
          npcCharacterId: payload.npcCharacterId,
          claimRef: payload.claimRef,
          responseClaimRef: payload.responseClaimRef,
          responseMode: payload.responseMode,
          responseReaction: payload.responseReaction,
          addressedThreadRef: payload.addressedThreadRef,
          addressedThreadDisposition: payload.addressedThreadDisposition,
          threadRef: payload.threadRef,
          boundary: payload.boundary,
          selectedRoll: payload.selectedRoll,
          total: payload.total,
          margin: payload.margin,
          marginDegree: payload.marginDegree,
          degree: payload.degree,
          outcome: payload.succeeded ? "success" : "failure",
          maximumInfluenceDegree: payload.maximumInfluenceDegree,
          threadDisposition: payload.threadDisposition,
          relationshipBefore: payload.relationshipBefore,
          relationshipDelta: payload.relationshipDelta,
          relationshipScore: payload.relationshipScore,
          result: payload.outcome,
        });
        break;
      }
      case "ContestResolved": {
        const payload = event.payload as EventPayloadByType["ContestResolved"];
        if (payload.initiatorId !== viewerCharacterId && payload.defenderId !== viewerCharacterId) break;
        changes.push({
          kind: "contestResolved",
          characterId: viewerCharacterId,
          outcome: payload.winnerId === viewerCharacterId
            ? "success"
            : payload.winnerId === null ? "tie" : "failure",
          result: payload.outcome,
        });
        break;
      }
      case "CharacterInferenceFormed": {
        const payload = event.payload as EventPayloadByType["CharacterInferenceFormed"];
        if (payload.characterId !== viewerCharacterId) break;
        changes.push({
          kind: "privateInferenceFormed",
          characterId: payload.characterId,
          inferenceId: payload.inferenceId,
          conclusion: payload.conclusion,
          confidence: payload.confidence,
        });
        break;
      }
      case "MeaningfulFailureCommitted": {
        const payload = event.payload as EventPayloadByType["MeaningfulFailureCommitted"];
        if (payload.characterId !== viewerCharacterId) break;
        changes.push({
          kind: "meaningfulFailureCommitted",
          characterId: payload.characterId,
          outcome: "failure",
        });
        break;
      }
    }
  }
  return changes;
}

function socialObserverEventChanges(
  range: VerifiedCommittedRange,
  state: AuthoritativeWorldState,
  viewerCharacterId: string,
): ObserverDeltaChange[] {
  const changes: ObserverDeltaChange[] = [];
  for (const event of range.events) {
    if (event.eventType === "SourceClaimCreated") {
      const payload = event.payload as EventPayloadByType["SourceClaimCreated"];
      if (!payload.claimId.startsWith("claim:social:")
        && !payload.claimId.startsWith("claim:social-npc:")) continue;
      const heard = payload.speakerId === viewerCharacterId
        || range.events.some((candidate) => {
          if (candidate.eventType !== "KnowledgeAcquired") return false;
          const acquired = candidate.payload as EventPayloadByType["KnowledgeAcquired"];
          return "medium" in acquired
            && acquired.characterId === viewerCharacterId
            && acquired.medium === "spokenConversation"
            && acquired.items.some((item) => item.knowledgeRef === payload.claimId);
        });
      if (!heard) continue;
      const thread = Object.values(state.campaignRuntime.conversationThreads ?? {})
        .find((candidate) => candidate.claimRef === payload.claimId);
      changes.push({
        kind: "spokenClaimHeard",
        speakerCharacterId: payload.speakerId,
        speakerName: state.entities[payload.speakerId]?.name ?? payload.speakerId,
        claimRef: payload.claimId,
        truthStatus: "unresolved",
        ...(thread?.claimSemantics.assertion === undefined
          || thread.claimSemantics.assertion === null
          ? {}
          : {
              assertion: structuredClone(thread?.claimSemantics.assertion),
            }),
        utterance: payload.semanticContent,
      });
      continue;
    }
    if (event.eventType === "SocialDirectResolved") {
      const payload = event.payload as EventPayloadByType["SocialDirectResolved"];
      const viewer = state.entities[viewerCharacterId];
      const npc = state.entities[payload.npcCharacterId];
      const observed = payload.responseClaimRef === null
        ? payload.responseReaction === "silence"
          && viewer !== undefined
          && npc !== undefined
          && viewer.sceneId === npc.sceneId
          && characterTimelineId(state, viewer.id) !== undefined
          && characterTimelineId(state, viewer.id) === characterTimelineId(state, npc.id)
        : state.knowledge[viewerCharacterId]?.[payload.responseClaimRef] !== undefined;
      if (!observed) continue;
      changes.push({
        kind: "socialBehaviorObserved",
        npcCharacterId: payload.npcCharacterId,
        claimRef: payload.claimRef,
        responseClaimRef: payload.responseClaimRef,
        responseMode: payload.responseMode,
        responseReaction: payload.responseReaction,
        addressedThreadRef: payload.addressedThreadRef,
        threadDisposition: payload.threadDisposition,
        immediateBehavior: payload.immediateBehavior,
      });
      continue;
    }
    if (event.eventType === "SocialCheckResolved") {
      const payload = event.payload as EventPayloadByType["SocialCheckResolved"];
      if (viewerCharacterId === range.actorCharacterId
        || state.knowledge[viewerCharacterId]?.[payload.claimRef] !== undefined) {
        changes.push({
          kind: "socialBehaviorObserved",
          npcCharacterId: payload.npcCharacterId,
          claimRef: payload.claimRef,
          responseClaimRef: payload.responseClaimRef,
          responseMode: payload.responseMode,
          responseReaction: payload.responseReaction,
          addressedThreadRef: payload.addressedThreadRef,
          addressedThreadDisposition: payload.addressedThreadDisposition,
          threadDisposition: payload.threadDisposition,
          immediateBehavior: payload.immediateBehavior,
        });
      }
    }
  }
  return changes;
}

function observerCommittedDelta(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  viewerValue: PlayerViewer | NpcViewer | unknown,
  after: SafeReadModel,
  query: ProjectionQuery | undefined,
): ObserverCommittedDelta | undefined {
  const range = verifiedCommittedRange(profiles, state, query);
  if (range === undefined) return undefined;
  const viewerCharacterId = after.viewer.subjectId;
  const actor = viewerCharacterId === range.actorCharacterId;
  const beforeProjection = projectAuthoritative(profiles, range.priorState, viewerValue);
  const before = beforeProjection.kind === "rejected"
    || isKpSpatialReadModel(beforeProjection)
    || isLifecycleReadModel(beforeProjection)
    ? undefined
    : beforeProjection;
  const actorPriorSceneId = range.priorState.entities[range.actorCharacterId]?.sceneId;
  const actorCurrentSceneId = state.entities[range.actorCharacterId]?.sceneId;
  const viewerPriorSceneId = range.priorState.entities[viewerCharacterId]?.sceneId;
  const viewerCurrentSceneId = state.entities[viewerCharacterId]?.sceneId;
  const coPresent = actor
    || (actorPriorSceneId !== undefined && actorPriorSceneId === viewerPriorSceneId)
    || (actorCurrentSceneId !== undefined && actorCurrentSceneId === viewerCurrentSceneId);
  if (!coPresent) return undefined;

  const correction = isCorrectionCommittedRange(range);
  const movement = correction ? [] : movementChanges(range, state, viewerCharacterId);
  const dynamicEntities = correction ? [] : dynamicEntityChanges(range, state, viewerCharacterId);
  const fieldChanges = correction
    ? correctionProjectionFieldChanges(before, after, actor)
    : projectionFieldChanges(before, after, actor);
  const eventChanges = actorEventChanges(range, state, viewerCharacterId);
  const socialChanges = socialResolutionProfileEnabled(profiles.extensions)
    ? socialObserverEventChanges(range, state, viewerCharacterId)
    : [];
  const correctionChanges = correction ? publicCorrectionChanges(range) : [];
  const changes = [
    ...correctionChanges,
    ...eventChanges,
    ...socialChanges,
    ...dynamicEntities,
    ...movement,
    ...fieldChanges,
  ];
  if (actor && changes.length === 0) {
    changes.push({ kind: "actionCommitted", status: range.receipt.status });
  }
  if (!actor && changes.length === 0) return undefined;
  return {
    schema: "zhuwei.observer-committed-delta/v1",
    actorCharacterId: range.actorCharacterId,
    viewerCharacterId,
    receipt: range.receipt,
    changes,
  };
}

function projectFormerActorCommittedResult(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  viewerValue: PlayerViewer | NpcViewer | unknown,
  query: ProjectionQuery | undefined,
): SafeReadModel | undefined {
  const range = verifiedCommittedRange(profiles, state, query);
  if (range === undefined || !isRecord(viewerValue) || viewerValue.kind !== "player") {
    return undefined;
  }
  if (viewerValue.characterId !== range.actorCharacterId) return undefined;
  const prior = projectAuthoritative(profiles, range.priorState, viewerValue);
  if (prior.kind === "rejected"
    || isKpSpatialReadModel(prior)
    || isLifecycleReadModel(prior)) return undefined;
  const beforeStatus = range.priorState.entities[range.actorCharacterId]?.tenureStatus;
  const afterStatus = state.entities[range.actorCharacterId]?.tenureStatus ?? "missing";
  if (beforeStatus === afterStatus || afterStatus === "active") return undefined;
  const committedDelta: ObserverCommittedDelta = {
    schema: "zhuwei.observer-committed-delta/v1",
    actorCharacterId: range.actorCharacterId,
    viewerCharacterId: range.actorCharacterId,
    receipt: range.receipt,
    changes: [
      ...actorEventChanges(range, state, range.actorCharacterId),
      {
        kind: "characterLifecycleChanged",
        characterId: range.actorCharacterId,
        before: beforeStatus,
        after: afterStatus,
        successorRequired: true,
      },
    ],
  };
  const receipts = [
    ...prior.receipts.filter((receipt) => receipt.receiptId !== range.receipt.receiptId),
    range.receipt,
  ];
  const { projectionHash: _projectionHash, ...priorHashable } = prior;
  const hashable = {
    ...priorHashable,
    stateVersion: state.version,
    activeBranchId: state.activeBranchId,
    controlledCharacter: {
      ...prior.controlledCharacter,
      tenureStatus: afterStatus,
    },
    receipts,
    committedDelta,
  };
  return { ...hashable, projectionHash: canonicalSha256(hashable) };
}

/** Query channel and guessed reference never select a second projection path. */
export function projectWorld(
  profiles: RuntimeProfileManifest,
  state: unknown,
  viewerValue: PlayerViewer | NpcViewer | KpViewer | unknown,
  query?: ProjectionQuery,
): ProjectionResult {
  if (!isRecord(state)) {
    return rejected("invalidWorldState", "Projection requires a canonical WorldState.");
  }
  if (!isAuthoritativeWorldState(state)) {
    return rejected("invalidWorldState", "Projection requires a canonical V5 WorldState.");
  }
  if (query?.dueActorPlanFor !== undefined) {
    return projectDueActorPlan(profiles, state, viewerValue, query);
  }
  const projected = projectAuthoritative(profiles, state, viewerValue);
  if (projected.kind === "rejected") {
    return projectFormerActorCommittedResult(profiles, state, viewerValue, query) ?? projected;
  }
  if (isLifecycleReadModel(projected)) {
    const incrementalDelta = lifecycleIncrementalDelta(
      profiles,
      state,
      viewerValue,
      projected,
      query,
    );
    if (incrementalDelta === "invalid") {
      return rejected(
        "projectionIntegrity",
        "The observer increment is incomplete or does not match its authoritative hashes.",
      );
    }
    if (incrementalDelta === undefined) return projected;
    const { projectionHash: _projectionHash, ...hashable } = projected;
    return {
      ...projected,
      incrementalDelta,
      projectionHash: canonicalSha256({ ...hashable, incrementalDelta }),
    };
  }
  if (isKpSpatialReadModel(projected)) return projected;
  const incrementalDelta = observerIncrementalDelta(
    profiles,
    state,
    viewerValue,
    projected,
    query,
  );
  if (incrementalDelta === "invalid") {
    return rejected(
      "projectionIntegrity",
      "The observer increment is incomplete or does not match its authoritative hashes.",
    );
  }
  if (incrementalDelta !== undefined) {
    const { projectionHash: _projectionHash, ...hashable } = projected;
    return {
      ...projected,
      incrementalDelta,
      projectionHash: canonicalSha256({ ...hashable, incrementalDelta }),
    };
  }
  const committedDelta = observerCommittedDelta(profiles, state, viewerValue, projected, query);
  if (committedDelta === undefined) return projected;
  const { projectionHash: _projectionHash, ...hashable } = projected;
  return {
    ...projected,
    committedDelta,
    projectionHash: canonicalSha256({ ...hashable, committedDelta }),
  };
}
