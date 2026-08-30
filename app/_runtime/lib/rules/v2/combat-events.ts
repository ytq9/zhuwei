import type {
  AuthoritativeWorldState,
  CharacterRecord,
  EventEnvelope,
  EventType,
  JsonRecord,
} from "./model";
import {
  hasExactKeys,
  hasOnlyKeys,
  isNonEmptyString,
  isProfileRef,
  isRecord,
  isSha256,
} from "./validation";
import { socialResolutionProfileEnabled } from "../profiles/social-resolution";
import { npcMechanicsProfileEnabled } from "../profiles/npc-mechanics";
import { endCharacterTenure } from "./character-lifecycle";
import {
  isDefinitionRegisteredAbilityPayload,
  registeredAbilityRecord,
} from "../profiles/ability-compiler";
import {
  analyzeCombatMovement,
  canonicalizeCombatPath,
} from "../profiles/combat-geometry";
import {
  canPromoteNpcSpatialShell,
  isNpcMechanicalItemDefinition,
  isNpcMechanicalTemplateDefinition,
  materializeNpcMechanicalLoadout,
  NPC_MECHANICAL_ITEM_KIND,
  NPC_MECHANICAL_TEMPLATE_KIND,
  npcCoreMechanicsCompatible,
  synchronizeCoreNpcCombatState,
} from "./npc-mechanics";

export const COMBAT_EVENT_TYPES = [
  "EntityMaterialized",
  "EncounterStarted",
  "HostilityChanged",
  "InitiativeRequested",
  "InitiativeEstablished",
  "InitiativeTieOrdered",
  "RoundStarted",
  "TurnStarted",
  "TurnEnded",
  "AbilityInvoked",
  "MovementSegmentCommitted",
  "ConditionChanged",
  "ResourceSpent",
  "HealingResolved",
  "TemporaryHitPointsGranted",
  "ConcentrationStarted",
  "ConcentrationTested",
  "ConcentrationEnded",
  "ReadiedActionCreated",
  "ReadiedActionTriggered",
  "ReadiedActionExpired",
  "ReactionOpportunityOpened",
  "ReactionOffered",
  "ReactionAnswered",
  "TriggerInvalidated",
  "SpellCastingStarted",
  "SpellCountered",
  "SpellResolved",
  "EffectApplied",
  "EffectEnded",
  "RoundEnded",
  "DeathSaveResolved",
  "EncounterConclusionProposed",
  "EncounterConcluded",
  "CombatPendingOpened",
  "CombatPendingClosed",
] as const satisfies readonly EventType[];

const KEYS: Record<typeof COMBAT_EVENT_TYPES[number], readonly string[]> = {
  EntityMaterialized: ["entity"],
  EncounterStarted: ["encounter"],
  HostilityChanged: ["encounterId", "previousTargetEntityIds", "reason", "sourceEntityId", "targetEntityIds"],
  InitiativeRequested: ["combatantEntityIds", "encounterId", "entryId"],
  InitiativeEstablished: ["encounterId", "entries", "pending"],
  InitiativeTieOrdered: ["encounterId", "orderedEntityIds"],
  RoundStarted: ["encounterId", "round", "turnOrderEntityIds"],
  TurnStarted: ["encounterId", "round", "sourceEntityId"],
  TurnEnded: ["encounterId", "sourceEntityId"],
  AbilityInvoked: ["abilityRef", "mechanicalResult", "sourceEntityId", "sourcePatch"],
  MovementSegmentCommitted: ["distanceMilliInches", "encounterId", "entityPatch", "movementAuthority", "movementMode", "path", "sourceEntityId"],
  ConditionChanged: ["conditions", "entityId"],
  ResourceSpent: ["amount", "entityId", "resourceAfter", "resourceId"],
  HealingResolved: ["after", "before", "entityId"],
  TemporaryHitPointsGranted: ["after", "before", "entityId", "sourceDefinitionId"],
  ConcentrationStarted: ["concentration", "entityId"],
  ConcentrationTested: ["causeFactId", "dc", "entityId", "modifier", "roll", "succeeded", "total"],
  ConcentrationEnded: ["entityId", "reason"],
  ReadiedActionCreated: ["ready", "sourcePatch"],
  ReadiedActionTriggered: ["effectId", "sourceEntityId", "triggerEvent"],
  ReadiedActionExpired: ["effectId", "reason", "sourceEntityId"],
  ReactionOpportunityOpened: ["pending"],
  ReactionOffered: ["pending"],
  ReactionAnswered: ["answer", "controllerEntityId", "pendingInputId"],
  TriggerInvalidated: ["pendingInputId", "reason", "triggerInstanceId"],
  SpellCastingStarted: ["cast", "sourcePatch"],
  SpellCountered: ["abilityRef", "castId", "counteredByCastId", "sourceEntityId"],
  SpellResolved: ["abilityRef", "castId", "outcome", "sourceEntityId"],
  EffectApplied: ["effect"],
  EffectEnded: ["effectId", "reason", "targetEntityId"],
  RoundEnded: ["encounterId", "fictionAdvanceMicros", "round"],
  DeathSaveResolved: ["entityId", "entityPatch", "failures", "natural", "roll", "successes"],
  EncounterConclusionProposed: ["pending", "proposal"],
  EncounterConcluded: ["encounterId", "fictionAdvanceMicros", "reason"],
  CombatPendingOpened: ["pending"],
  CombatPendingClosed: ["pendingInputId"],
};

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function canonicalStringArray(value: unknown): value is string[] {
  return stringArray(value)
    && value.length === new Set(value).size
    && value.every((entry, index) => index === 0 || value[index - 1] < entry);
}

function canonicalUnsignedIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
}

function canonicalMovementSegmentPayload(value: JsonRecord): boolean {
  if (
    !isNonEmptyString(value.encounterId)
    || !isNonEmptyString(value.sourceEntityId)
    || !isNonEmptyString(value.movementMode)
    || !["activeTurn", "readiedReaction"].includes(String(value.movementAuthority))
    || !canonicalUnsignedIntegerString(value.distanceMilliInches)
    || BigInt(value.distanceMilliInches) <= 0n
    || !Array.isArray(value.path)
    || value.path.length < 2
    || value.path.length > 64
    || !isRecord(value.entityPatch)
  ) return false;
  const path = canonicalizeCombatPath(value.path);
  if (path === undefined || JSON.stringify(path) !== JSON.stringify(value.path)) return false;
  const patchId = isNonEmptyString(value.entityPatch.id)
    ? value.entityPatch.id
    : value.entityPatch.entityId;
  return patchId === value.sourceEntityId
    && (value.entityPatch.entityId === undefined
      || value.entityPatch.entityId === value.sourceEntityId)
    && JSON.stringify(value.entityPatch.position) === JSON.stringify(path[path.length - 1])
    && isRecord(value.entityPatch.movement)
    && canonicalUnsignedIntegerString(value.entityPatch.movement.spentMilliInches);
}

function phaseTask(value: unknown): value is JsonRecord {
  return isRecord(value)
    && hasExactKeys(value, [
      "dueMicros",
      "edge",
      "effectId",
      "effectKind",
      "entryCount",
      "initiativeOrderHash",
      "slotIndex",
      "sourceEntityId",
      "targetEntityId",
      "targetRound",
      "taskId",
      "timeProfile",
    ])
    && [
      value.taskId,
      value.effectId,
      value.effectKind,
      value.sourceEntityId,
      value.targetEntityId,
    ].every(isNonEmptyString)
    && typeof value.dueMicros === "string"
    && /^(0|[1-9][0-9]*)$/.test(value.dueMicros)
    && [value.targetRound, value.slotIndex, value.entryCount].every(Number.isSafeInteger)
    && Number(value.targetRound) >= 0
    && Number(value.entryCount) >= 1
    && Number(value.slotIndex) >= 0
    && Number(value.slotIndex) < Number(value.entryCount)
    && ["turnStart", "turnEnd"].includes(String(value.edge))
    && isSha256(value.initiativeOrderHash)
    && isProfileRef(value.timeProfile);
}

export function validateCombatRandomnessResolution(value: unknown): value is JsonRecord {
  if (!isRecord(value)
    || !hasExactKeys(value, ["continuationCapability", "operation", "randomnessRequests", "resolutionId", "rootActionId"])
    || ![value.continuationCapability, value.resolutionId, value.rootActionId].every(isNonEmptyString)
    || !String(value.continuationCapability).startsWith("continuation:")
    || !isRecord(value.operation)
    || !Array.isArray(value.randomnessRequests)
    || value.randomnessRequests.length === 0) return false;
  return value.randomnessRequests.every((request) => isRecord(request)
    && hasExactKeys(request, ["dice", "diceExpression", "frozenParameters", "purposeKey", "randomnessId", "requestHash", "resolutionId"])
    && [request.purposeKey, request.randomnessId, request.resolutionId].every(isNonEmptyString)
    && isNonEmptyString(request.diceExpression)
    && request.resolutionId === value.resolutionId
    && isSha256(request.requestHash)
    && isRecord(request.frozenParameters)
    && Array.isArray(request.dice)
    && request.dice.length > 0
    && request.dice.every((die) => isRecord(die)
      && hasExactKeys(die, ["count", "sides"])
      && typeof die.count === "string" && /^[1-9][0-9]*$/.test(die.count)
      && typeof die.sides === "string" && /^[1-9][0-9]*$/.test(die.sides)
      && Number(die.sides) > 1));
}

/** Closed payload validation for the pinned combat event extension. */
export function validateCombatEventPayload(eventType: EventType, value: JsonRecord): boolean {
  if (eventType === "DamagePacketResolved") {
    return hasExactKeys(value, ["components", "encounterId", "pipelineProfileId", "sourceDefinitionId", "targetEntityId", "targetPatch", "totalApplied"])
      && (value.encounterId === null || isNonEmptyString(value.encounterId))
      && isNonEmptyString(value.pipelineProfileId)
      && isNonEmptyString(value.sourceDefinitionId)
      && isNonEmptyString(value.targetEntityId)
      && Array.isArray(value.components)
      && Number.isSafeInteger(value.totalApplied)
      && isRecord(value.targetPatch);
  }
  if (!(COMBAT_EVENT_TYPES as readonly string[]).includes(eventType)) return false;
  const type = eventType as typeof COMBAT_EVENT_TYPES[number];
  if (type === "EncounterConcluded") {
    return hasOnlyKeys(value, ["encounterId", "fictionAdvanceMicros", "reason"], ["phaseTasks"])
      && [value.encounterId, value.fictionAdvanceMicros, value.reason].every(isNonEmptyString)
      && (value.phaseTasks === undefined
        || (Array.isArray(value.phaseTasks) && value.phaseTasks.every(phaseTask)));
  }
  if (!hasExactKeys(value, KEYS[type])) return false;
  switch (type) {
    case "EntityMaterialized": return isRecord(value.entity) && isNonEmptyString(value.entity.entityId);
    case "EncounterStarted": return isRecord(value.encounter) && isNonEmptyString(value.encounter.encounterId);
    case "HostilityChanged": return isNonEmptyString(value.encounterId)
      && isNonEmptyString(value.reason)
      && isNonEmptyString(value.sourceEntityId)
      && canonicalStringArray(value.previousTargetEntityIds)
      && canonicalStringArray(value.targetEntityIds)
      && !value.previousTargetEntityIds.includes(value.sourceEntityId)
      && !value.targetEntityIds.includes(value.sourceEntityId);
    case "InitiativeRequested": return [value.encounterId, value.entryId].every(isNonEmptyString)
      && stringArray(value.combatantEntityIds);
    case "InitiativeEstablished": return isNonEmptyString(value.encounterId)
      && Array.isArray(value.entries) && isRecord(value.pending);
    case "InitiativeTieOrdered": return isNonEmptyString(value.encounterId) && stringArray(value.orderedEntityIds);
    case "RoundStarted": return isNonEmptyString(value.encounterId) && Number.isSafeInteger(value.round)
      && stringArray(value.turnOrderEntityIds);
    case "TurnStarted": return [value.encounterId, value.sourceEntityId].every(isNonEmptyString)
      && Number.isSafeInteger(value.round);
    case "TurnEnded": return [value.encounterId, value.sourceEntityId].every(isNonEmptyString);
    case "AbilityInvoked": return [value.abilityRef, value.sourceEntityId].every(isNonEmptyString)
      && isRecord(value.mechanicalResult) && isRecord(value.sourcePatch);
    case "MovementSegmentCommitted": return canonicalMovementSegmentPayload(value);
    case "ConditionChanged": return isNonEmptyString(value.entityId) && isRecord(value.conditions);
    case "ResourceSpent": return [value.entityId, value.resourceId, value.resourceAfter].every(isNonEmptyString)
      && Number.isSafeInteger(value.amount);
    case "HealingResolved": return isNonEmptyString(value.entityId)
      && [value.before, value.after].every((entry) => typeof entry === "string");
    case "TemporaryHitPointsGranted": return [value.entityId, value.sourceDefinitionId].every(isNonEmptyString)
      && [value.before, value.after].every((entry) => typeof entry === "string")
      && [value.before, value.after].every((entry) => /^(0|[1-9][0-9]*)$/.test(String(entry)));
    case "ConcentrationStarted": return isNonEmptyString(value.entityId) && isRecord(value.concentration);
    case "ConcentrationTested": return [value.entityId, value.causeFactId].every(isNonEmptyString)
      && [value.dc, value.modifier, value.roll, value.total].every(Number.isSafeInteger)
      && typeof value.succeeded === "boolean";
    case "ConcentrationEnded": return [value.entityId, value.reason].every(isNonEmptyString);
    case "ReadiedActionCreated": return isRecord(value.ready) && isNonEmptyString(value.ready.effectId)
      && isRecord(value.sourcePatch);
    case "ReadiedActionTriggered": return [value.effectId, value.sourceEntityId, value.triggerEvent].every(isNonEmptyString);
    case "ReadiedActionExpired": return [value.effectId, value.sourceEntityId, value.reason].every(isNonEmptyString);
    case "ReactionOpportunityOpened":
    case "ReactionOffered":
    case "CombatPendingOpened": return isRecord(value.pending) && isNonEmptyString(value.pending.pendingInputId);
    case "ReactionAnswered": return [value.pendingInputId, value.controllerEntityId].every(isNonEmptyString)
      && isRecord(value.answer);
    case "TriggerInvalidated": return [value.pendingInputId, value.triggerInstanceId, value.reason].every(isNonEmptyString);
    case "SpellCastingStarted": return isRecord(value.cast) && isNonEmptyString(value.cast.castId)
      && isRecord(value.sourcePatch);
    case "SpellCountered": return [value.castId, value.sourceEntityId, value.abilityRef, value.counteredByCastId].every(isNonEmptyString);
    case "SpellResolved": return [value.castId, value.sourceEntityId, value.abilityRef].every(isNonEmptyString)
      && isRecord(value.outcome);
    case "EffectApplied": return isRecord(value.effect) && isNonEmptyString(value.effect.effectId);
    case "EffectEnded": return [value.effectId, value.targetEntityId, value.reason].every(isNonEmptyString);
    case "RoundEnded": return isNonEmptyString(value.encounterId)
      && isNonEmptyString(value.fictionAdvanceMicros) && Number.isSafeInteger(value.round);
    case "DeathSaveResolved": return isNonEmptyString(value.entityId) && isRecord(value.entityPatch)
      && [value.roll, value.natural, value.successes, value.failures].every(Number.isSafeInteger);
    case "EncounterConclusionProposed": return isRecord(value.pending) && isRecord(value.proposal);
    case "CombatPendingClosed": return isNonEmptyString(value.pendingInputId);
  }
}

function combatNpcSocialMechanics(entity: JsonRecord): CharacterRecord["socialMechanics"] {
  if (!isRecord(entity.stats)) return undefined;
  const stats = entity.stats;
  const abilities = ["str", "dex", "con", "int", "wis", "cha"] as const;
  if (!abilities.every((ability) => /^(?:[1-9]|[12][0-9]|30)$/u.test(String(stats[ability])))) {
    return undefined;
  }
  const abilityScores = Object.fromEntries(abilities.map((ability) => [
    ability,
    Number(stats[ability]),
  ])) as Record<typeof abilities[number], number>;
  const proficiencyBonus = Number(entity.proficiencyBonus);
  if (!Number.isSafeInteger(proficiencyBonus) || proficiencyBonus < 0 || proficiencyBonus > 12) {
    return undefined;
  }
  return {
    abilityScores,
    proficiencyBonus,
    skillModifiers: { insight: Math.floor((abilityScores.wis - 10) / 2) },
    initialTrust: 0,
    authorityModifier: 0,
    stakesSensitivity: 0,
    maximumInfluenceDegree: "fullSuccess",
  };
}

function setCoreNpc(
  state: AuthoritativeWorldState,
  entity: JsonRecord,
  socialResolution: boolean,
): void {
  const entityKind = entity.entityKind ?? entity.kind;
  if (!isNonEmptyString(entity.entityId) || entityKind !== "npc" || !isNonEmptyString(entity.name)) return;
  const sceneId = isNonEmptyString(entity.sceneId)
    ? entity.sceneId
    : Object.keys(state.combatRuntime.scenes).sort()[0];
  if (!isNonEmptyString(sceneId)) throw new TypeError("materialized NPC lacks a scene");
  const established = state.entities[entity.entityId];
  if (established !== undefined) {
    if (
      established.kind !== "npc"
      || established.tenureStatus !== "active"
      || established.name !== entity.name
      || established.sceneId !== sceneId
    ) throw new TypeError("combat NPC conflicts with established world identity");
    if (isNonEmptyString(entity.mechanicalDefinitionRef)
      && !npcCoreMechanicsCompatible(established, entity)) {
      throw new TypeError("combat NPC mechanics conflict with established noncombat mechanics");
    }
    if (isNonEmptyString(entity.mechanicalDefinitionRef)) {
      const definition = state.combatRuntime.definitions[entity.mechanicalDefinitionRef];
      if (!isNpcMechanicalTemplateDefinition(definition)) {
        throw new TypeError("combat NPC lacks its frozen mechanical template");
      }
      const loadout = materializeNpcMechanicalLoadout(
        definition,
        entity,
        state.combatRuntime.definitions,
        established.loadout,
      );
      if (loadout === undefined) throw new TypeError("combat NPC inventory cannot be materialized");
      established.loadout = loadout;
    }
    if (socialResolution && established.socialMechanics === undefined) {
      const socialMechanics = combatNpcSocialMechanics(entity);
      if (socialMechanics === undefined) {
        throw new TypeError("V5 combat NPC lacks derivable social mechanics");
      }
      established.socialMechanics = socialMechanics;
    }
    state.knowledge[entity.entityId] ??= {};
    synchronizeCoreNpcCombatState(state, entity);
    return;
  }
  const nextOrdinal = Object.values(state.entities)
    .reduce((maximum, entry) => Math.max(maximum, Number(entry.entityOrdinal)), 0) + 1;
  const socialMechanics = socialResolution ? combatNpcSocialMechanics(entity) : undefined;
  if (socialResolution && socialMechanics === undefined) {
    throw new TypeError("V5 combat NPC lacks derivable social mechanics");
  }
  state.entities[entity.entityId] = {
    id: entity.entityId,
    kind: "npc",
    name: entity.name,
    sceneId,
    tenureStatus: "active",
    entityOrdinal: String(nextOrdinal),
    ...(socialMechanics === undefined ? {} : { socialMechanics }),
  } satisfies CharacterRecord;
  if (isNonEmptyString(entity.mechanicalDefinitionRef)) {
    const definition = state.combatRuntime.definitions[entity.mechanicalDefinitionRef];
    if (!isNpcMechanicalTemplateDefinition(definition)) {
      throw new TypeError("combat NPC lacks its frozen mechanical template");
    }
    const loadout = materializeNpcMechanicalLoadout(
      definition,
      entity,
      state.combatRuntime.definitions,
    );
    if (loadout === undefined) throw new TypeError("combat NPC inventory cannot be materialized");
    state.entities[entity.entityId].loadout = loadout;
  }
  state.knowledge[entity.entityId] = {};
  synchronizeCoreNpcCombatState(state, entity);
}

function patchEntity(state: AuthoritativeWorldState, patch: unknown): void {
  if (!isRecord(patch) || !isNonEmptyString(patch.id)) throw new TypeError("combat entity patch is malformed");
  if (!(patch.id in state.combatRuntime.entities)) throw new TypeError("combat entity patch target is unavailable");
  state.combatRuntime.entities[patch.id] = structuredClone(patch);
  synchronizeCoreNpcCombatState(state, patch);
}

function movementHostileEntityIds(encounter: JsonRecord, sourceEntityId: string): Set<string> {
  if (!Array.isArray(encounter.hostilities)) return new Set();
  return new Set(encounter.hostilities.flatMap((relation) =>
    isRecord(relation)
      && Array.isArray(relation.fromEntityIds)
      && relation.fromEntityIds.includes(sourceEntityId)
      && Array.isArray(relation.toEntityIds)
      ? relation.toEntityIds.filter(isNonEmptyString)
      : []));
}

function applyMovementSegment(
  state: AuthoritativeWorldState,
  payload: JsonRecord,
): void {
  if (!canonicalMovementSegmentPayload(payload)) {
    throw new TypeError("movement segment payload is malformed");
  }
  const sourceEntityId = String(payload.sourceEntityId);
  const source = state.combatRuntime.entities[sourceEntityId];
  const encounter = state.combatRuntime.encounters[String(payload.encounterId)];
  const movementMode = String(payload.movementMode);
  const movementAuthority = String(payload.movementAuthority);
  const path = canonicalizeCombatPath(payload.path)!;
  if (
    source === undefined
    || encounter === undefined
    || encounter.status === "concluded"
    || !Array.isArray(encounter.participantEntityIds)
    || !encounter.participantEntityIds.includes(sourceEntityId)
    || JSON.stringify(source.position) !== JSON.stringify(path[0])
  ) throw new TypeError("movement segment does not continue the authoritative combat state");
  const speed = isRecord(source.conditions) && isNonEmptyString(source.conditions.grappledBy)
    ? "0"
    : isRecord(source.speedInches)
      ? source.speedInches[movementMode]
      : undefined;
  if (!canonicalUnsignedIntegerString(speed)) {
    throw new TypeError("movement segment mode has no authoritative speed");
  }
  if (movementAuthority === "activeTurn") {
    if (encounter.activeEntityId !== sourceEntityId) {
      throw new TypeError("movement segment source is not in the active initiative group");
    }
  } else {
    const turn = isRecord(source.turn) ? source.turn : undefined;
    if (turn === undefined || turn.reaction !== "1") {
      throw new TypeError("readied movement has no authoritative reaction grant");
    }
  }
  const scene = state.combatRuntime.scenes[String(source.sceneId)];
  const analyzed = analyzeCombatMovement(
    source,
    Object.values(state.combatRuntime.entities),
    isRecord(scene) ? scene : undefined,
    path,
    movementHostileEntityIds(encounter, sourceEntityId),
  );
  if (
    !analyzed.ok
    || analyzed.totalMilliInches !== payload.distanceMilliInches
    || JSON.stringify(analyzed.path) !== JSON.stringify(path)
  ) throw new TypeError("movement segment distance or geometry is not authoritative");

  const priorMovement = isRecord(source.movement) ? source.movement : undefined;
  const patch = payload.entityPatch as JsonRecord;
  const nextMovement = isRecord(patch.movement) ? patch.movement : undefined;
  if (
    priorMovement === undefined
    || nextMovement === undefined
    || !canonicalUnsignedIntegerString(priorMovement.spentMilliInches)
    || !canonicalUnsignedIntegerString(nextMovement.spentMilliInches)
    || BigInt(nextMovement.spentMilliInches) - BigInt(priorMovement.spentMilliInches)
      !== BigInt(String(payload.distanceMilliInches))
  ) throw new TypeError("movement segment spent distance is inconsistent");
  const distanceLimit = BigInt(speed) * 1_000n;
  if (movementAuthority === "activeTurn"
    ? BigInt(nextMovement.spentMilliInches) > distanceLimit
    : BigInt(String(payload.distanceMilliInches)) > distanceLimit) {
    throw new TypeError("movement segment exceeds the authoritative movement speed");
  }

  const expectedPatch = structuredClone(source);
  if (movementAuthority === "readiedReaction") {
    const turn = isRecord(expectedPatch.turn) ? expectedPatch.turn : undefined;
    if (turn === undefined) throw new TypeError("readied movement source has no turn grants");
    turn.reaction = "0";
    expectedPatch.turn = turn;
  }
  expectedPatch.position = structuredClone(path[path.length - 1]);
  const conditions = isRecord(expectedPatch.conditions) ? expectedPatch.conditions : {};
  if (analyzed.squeezingAtEndpoint) conditions.squeezing = true;
  else delete conditions.squeezing;
  expectedPatch.conditions = conditions;
  const movement = isRecord(expectedPatch.movement)
    ? expectedPatch.movement
    : { spentMilliInches: "0" };
  movement.spentMilliInches = nextMovement.spentMilliInches;
  expectedPatch.movement = movement;
  if (JSON.stringify(patch) !== JSON.stringify(expectedPatch)) {
    throw new TypeError("movement segment entity patch changes unrelated authority state");
  }
  patchEntity(state, patch);
}

function removeResidualPhaseTask(
  runtime: AuthoritativeWorldState["combatRuntime"],
  effectId: string,
): void {
  for (const encounter of Object.values(runtime.encounters)) {
    if (!Array.isArray(encounter.residualPhaseTasks)) continue;
    encounter.residualPhaseTasks = encounter.residualPhaseTasks
      .filter((task) => !isRecord(task) || task.effectId !== effectId);
  }
}

/** Applies combat events only; core/campaign events return false. */
export function applyCombatEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  const runtime = state.combatRuntime;
  // Definitions are version-pinned room facts, not encounter-local state.  They
  // must remain replayable before the first combat/story runtime is opened so a
  // later encounter can refer to exactly the definition that was committed.
  if (runtime.story === null && event.eventType !== "DefinitionRegistered") return false;
  if (event.resolutionId !== null && event.eventType !== "RandomnessRequested") {
    delete runtime.randomnessResolutions[event.resolutionId];
  }
  const payload = event.payload as JsonRecord;
  switch (event.eventType) {
    case "DefinitionRegistered": {
      const definition = payload.definition;
      if (!isRecord(definition) || !isNonEmptyString(definition.definitionId)
        || definition.definitionId in runtime.definitions
        || (definition.definitionKind === NPC_MECHANICAL_TEMPLATE_KIND
          && !isNpcMechanicalTemplateDefinition(definition))
        || (definition.definitionKind === NPC_MECHANICAL_ITEM_KIND
          && !isNpcMechanicalItemDefinition(definition))) {
        throw new TypeError("combat definition already exists or is malformed");
      }
      runtime.definitions[definition.definitionId] = isDefinitionRegisteredAbilityPayload(payload)
        ? registeredAbilityRecord(payload)
        : structuredClone(definition);
      return true;
    }
    case "EntityMaterialized": {
      if (!isRecord(payload.entity) || !isNonEmptyString(payload.entity.entityId)) {
        throw new TypeError("combat entity is malformed");
      }
      const prior = runtime.entities[payload.entity.entityId];
      if (prior !== undefined
        && (!npcMechanicsProfileEnabled(event.profiles.extensions)
          || !canPromoteNpcSpatialShell(prior, payload.entity))) {
        throw new TypeError("combat entity already exists");
      }
      runtime.entities[payload.entity.entityId] = structuredClone(payload.entity);
      setCoreNpc(
        state,
        payload.entity,
        socialResolutionProfileEnabled(event.profiles.extensions),
      );
      return true;
    }
    case "EncounterStarted": {
      const encounter = payload.encounter;
      if (!isRecord(encounter) || !isNonEmptyString(encounter.encounterId)
        || encounter.encounterId in runtime.encounters) throw new TypeError("encounter already exists");
      runtime.encounters[encounter.encounterId] = structuredClone(encounter);
      return true;
    }
    case "HostilityChanged": {
      const encounter = runtime.encounters[String(payload.encounterId)];
      if (encounter === undefined || encounter.status === "concluded"
        || !Array.isArray(encounter.participantEntityIds)
        || !encounter.participantEntityIds.includes(payload.sourceEntityId)
        || !Array.isArray(encounter.hostilities)
        || !Array.isArray(payload.previousTargetEntityIds)
        || !payload.previousTargetEntityIds.every(isNonEmptyString)
        || !Array.isArray(payload.targetEntityIds)
        || !payload.targetEntityIds.every(isNonEmptyString)) {
        throw new TypeError("hostility encounter unavailable");
      }
      const outgoing = new Map<string, Set<string>>();
      for (const relation of encounter.hostilities) {
        if (!isRecord(relation)
          || !Array.isArray(relation.fromEntityIds)
          || !relation.fromEntityIds.every(isNonEmptyString)
          || !Array.isArray(relation.toEntityIds)
          || !relation.toEntityIds.every(isNonEmptyString)) {
          throw new TypeError("encounter hostility relation is malformed");
        }
        for (const sourceEntityId of relation.fromEntityIds) {
          const targets = outgoing.get(sourceEntityId) ?? new Set<string>();
          for (const targetEntityId of relation.toEntityIds) targets.add(targetEntityId);
          outgoing.set(sourceEntityId, targets);
        }
      }
      const previousTargetEntityIds = payload.previousTargetEntityIds as string[];
      const targetEntityIds = payload.targetEntityIds as string[];
      const currentTargets = [...(outgoing.get(String(payload.sourceEntityId)) ?? [])].sort();
      if (currentTargets.length !== previousTargetEntityIds.length
        || currentTargets.some((targetEntityId, index) =>
          targetEntityId !== previousTargetEntityIds[index])) {
        throw new TypeError("hostility change does not match its causal predecessor");
      }
      outgoing.set(String(payload.sourceEntityId), new Set(targetEntityIds));
      encounter.hostilities = [...outgoing.entries()]
        .filter(([, targetEntityIds]) => targetEntityIds.size > 0)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([sourceEntityId, targetEntityIds]) => ({
          fromEntityIds: [sourceEntityId],
          toEntityIds: [...targetEntityIds].sort(),
        }));
      return true;
    }
    case "InitiativeRequested": return true;
    case "InitiativeEstablished": {
      const encounter = runtime.encounters[String(payload.encounterId)];
      if (encounter === undefined || !Array.isArray(payload.entries) || !isRecord(payload.pending)) throw new TypeError("initiative encounter unavailable");
      encounter.initiative = { entries: structuredClone(payload.entries), ordered: false };
      runtime.pendingInputs[String(payload.pending.pendingInputId)] = structuredClone(payload.pending);
      return true;
    }
    case "InitiativeTieOrdered": {
      const encounter = runtime.encounters[String(payload.encounterId)];
      if (encounter === undefined || !isRecord(encounter.initiative)) throw new TypeError("initiative unavailable");
      encounter.initiative.orderedEntityIds = structuredClone(payload.orderedEntityIds);
      encounter.initiative.ordered = true;
      return true;
    }
    case "RoundStarted": {
      const encounter = runtime.encounters[String(payload.encounterId)];
      if (encounter === undefined) throw new TypeError("encounter unavailable");
      encounter.round = payload.round;
      encounter.turnOrderEntityIds = structuredClone(payload.turnOrderEntityIds);
      encounter.turnCursor = 0;
      encounter.roundClosed = false;
      for (const entityId of payload.turnOrderEntityIds as string[]) {
        const entity = runtime.entities[entityId];
        if (entity !== undefined && !isRecord(entity.turn)) {
          const surprised = payload.round === 1
            && Array.isArray(encounter.surprisedEntityIds)
            && encounter.surprisedEntityIds.includes(entityId);
          entity.turn = {
            action: "0",
            bonusAction: "0",
            reaction: surprised ? "0" : "1",
            attacksRemaining: "0",
            hasteAction: "0",
            bonusActionSpellCast: false,
            leveledActionSpell: false,
            leveledBonusActionSpell: false,
            surprised,
          };
        }
      }
      return true;
    }
    case "TurnStarted": {
      const encounter = runtime.encounters[String(payload.encounterId)];
      if (encounter === undefined) throw new TypeError("encounter unavailable");
      encounter.activeEntityId = payload.sourceEntityId;
      const order = encounter.turnOrderEntityIds;
      if (Array.isArray(order)) encounter.turnCursor = order.indexOf(payload.sourceEntityId);
      const entity = runtime.entities[String(payload.sourceEntityId)];
      if (entity !== undefined) {
        const surprised = payload.round === 1
          && Array.isArray(encounter.surprisedEntityIds)
          && encounter.surprisedEntityIds.includes(payload.sourceEntityId);
        entity.turn = surprised
          ? {
              action: "0",
              bonusAction: "0",
              reaction: "0",
              attacksRemaining: "0",
              hasteAction: "0",
              bonusActionSpellCast: false,
              leveledActionSpell: false,
              leveledBonusActionSpell: false,
              surprised: true,
            }
          : {
              action: "1",
              bonusAction: "1",
              reaction: "1",
              attacksRemaining: "0",
              hasteAction: isRecord(entity.conditions) && entity.conditions.hasted === true ? "1" : "0",
              bonusActionSpellCast: false,
              leveledActionSpell: false,
              leveledBonusActionSpell: false,
              surprised: false,
            };
        entity.movement = { spentMilliInches: "0" };
      }
      return true;
    }
    case "TurnEnded": {
      const entity = runtime.entities[String(payload.sourceEntityId)];
      if (entity !== undefined && isRecord(entity.turn) && entity.turn.surprised === true) {
        entity.turn.surprised = false;
        entity.turn.reaction = "1";
      }
      return true;
    }
    case "AbilityInvoked": patchEntity(state, payload.sourcePatch); return true;
    case "MovementSegmentCommitted": applyMovementSegment(state, payload); return true;
    case "ConditionChanged": {
      const entity = runtime.entities[String(payload.entityId)];
      if (entity === undefined) throw new TypeError("condition entity unavailable");
      entity.conditions = structuredClone(payload.conditions);
      return true;
    }
    case "ResourceSpent": {
      const entity = runtime.entities[String(payload.entityId)];
      if (entity === undefined || !isRecord(entity.resources) || !isRecord(entity.resources[String(payload.resourceId)])) throw new TypeError("resource unavailable");
      const resourceId = String(payload.resourceId);
      const resource = entity.resources[resourceId] as JsonRecord;
      if (resourceId.startsWith("item:")) {
        const itemId = resourceId.slice("item:".length);
        const loadout = state.entities[String(payload.entityId)]?.loadout;
        if (loadout !== undefined) {
          const current = Number(resource.current);
          const after = Number(payload.resourceAfter);
          const amount = Number(payload.amount);
          const item = loadout.backpack.find((entry) => entry.itemId === itemId);
          if (
            itemId.length === 0
            || item === undefined
            || !Number.isSafeInteger(current)
            || !Number.isSafeInteger(after)
            || !Number.isSafeInteger(amount)
            || amount <= 0
            || item.quantity !== current
            || current - amount !== after
            || after < 0
          ) throw new TypeError("combat item cache does not match authoritative inventory");
          if (after === 0) {
            loadout.backpack.splice(loadout.backpack.indexOf(item), 1);
            if (loadout.equipped.ammo === itemId) delete loadout.equipped.ammo;
          } else item.quantity = after;
        }
      }
      if (resourceId.startsWith("item:") && payload.resourceAfter === "0") {
        delete entity.resources[resourceId];
      } else {
        resource.current = payload.resourceAfter;
      }
      synchronizeCoreNpcCombatState(state, entity);
      return true;
    }
    case "HealingResolved": {
      const entity = runtime.entities[String(payload.entityId)];
      if (entity === undefined || !isRecord(entity.hitPoints)) throw new TypeError("healing target unavailable");
      entity.hitPoints.current = payload.after;
      if (Number(payload.after) > 0) {
        const conditions = { ...(isRecord(entity.conditions) ? entity.conditions : {}) };
        delete conditions.unconscious;
        delete conditions.stable;
        entity.conditions = conditions;
        entity.lifeState = "alive";
        entity.deathSaves = { successes: 0, failures: 0 };
      }
      synchronizeCoreNpcCombatState(state, entity);
      return true;
    }
    case "TemporaryHitPointsGranted": {
      const entity = runtime.entities[String(payload.entityId)];
      if (entity === undefined || !isRecord(entity.hitPoints)) {
        throw new TypeError("temporary-hit-point target unavailable");
      }
      entity.hitPoints.temporary = payload.after;
      return true;
    }
    case "DamagePacketResolved": {
      if (!("targetPatch" in payload)) return false;
      patchEntity(state, payload.targetPatch);
      return true;
    }
    // Campaign/world hazards own this canonical event. Returning false lets
    // the campaign projector update both the core character and combat cache.
    case "HitPointsChanged": return false;
    case "CreatureDied": {
      const entity = runtime.entities[String(payload.characterId)];
      if (entity === undefined) return false;
      entity.lifeState = "dead";
      entity.conditions = { ...(isRecord(entity.conditions) ? entity.conditions : {}), unconscious: true, prone: true };
      if (state.entities[String(payload.characterId)] !== undefined) {
        endCharacterTenure(state, String(payload.characterId), "dead", "characterDied");
      }
      return true;
    }
    case "ConcentrationStarted": {
      const entity = runtime.entities[String(payload.entityId)];
      if (entity === undefined) throw new TypeError("concentration entity unavailable");
      entity.concentration = structuredClone(payload.concentration);
      return true;
    }
    case "ConcentrationTested": return true;
    case "ConcentrationEnded": {
      const entity = runtime.entities[String(payload.entityId)];
      if (entity === undefined) throw new TypeError("concentration entity unavailable");
      const concentration = entity.concentration;
      if (isRecord(concentration)
        && concentration.kind === "longSpellcasting"
        && isNonEmptyString(concentration.activityId)) {
        const activity = state.campaignRuntime.activities[concentration.activityId];
        if (activity?.status === "active") {
          activity.status = "interrupted";
          activity.interruptionCause = {
            kind: "concentrationEnded",
            reason: payload.reason,
            eventId: event.eventId,
          };
        }
      }
      entity.concentration = null;
      return true;
    }
    case "ReadiedActionCreated": {
      const ready = payload.ready;
      if (!isRecord(ready) || !isNonEmptyString(ready.effectId)
        || ready.effectId in runtime.effects) throw new TypeError("readied action already exists");
      patchEntity(state, payload.sourcePatch);
      runtime.effects[ready.effectId] = structuredClone(ready);
      return true;
    }
    case "ReadiedActionTriggered": return true;
    case "ReadiedActionExpired": {
      delete runtime.effects[String(payload.effectId)];
      removeResidualPhaseTask(runtime, String(payload.effectId));
      return true;
    }
    case "ReactionOpportunityOpened":
    case "ReactionOffered":
    case "CombatPendingOpened": runtime.pendingInputs[String((payload.pending as JsonRecord).pendingInputId)] = structuredClone(payload.pending as JsonRecord); return true;
    case "ReactionAnswered": return true;
    case "TriggerInvalidated": return true;
    case "SpellCastingStarted": patchEntity(state, payload.sourcePatch); return true;
    case "SpellCountered":
    case "SpellResolved": return true;
    case "EffectApplied": {
      const effect = payload.effect;
      if (!isRecord(effect) || !isNonEmptyString(effect.effectId)
        || effect.effectId in runtime.effects) throw new TypeError("combat effect already exists");
      runtime.effects[effect.effectId] = structuredClone(effect);
      return true;
    }
    case "EffectEnded": {
      delete runtime.effects[String(payload.effectId)];
      removeResidualPhaseTask(runtime, String(payload.effectId));
      return true;
    }
    case "CombatPendingClosed": delete runtime.pendingInputs[String(payload.pendingInputId)]; return true;
    case "RoundEnded": {
      const encounter = runtime.encounters[String(payload.encounterId)];
      if (encounter === undefined) throw new TypeError("encounter unavailable");
      encounter.roundClosed = true;
      const timeline = state.fictionTimelines[event.fictionTimelineId];
      if (timeline === undefined) throw new TypeError("combat fiction timeline is unavailable");
      timeline.nowMicros = (BigInt(timeline.nowMicros) + BigInt(String(payload.fictionAdvanceMicros))).toString();
      return true;
    }
    case "DeathSaveResolved": patchEntity(state, payload.entityPatch); return true;
    case "EncounterConclusionProposed": runtime.pendingInputs[String((payload.pending as JsonRecord).pendingInputId)] = structuredClone(payload.pending as JsonRecord); return true;
    case "EncounterConcluded": {
      const encounter = runtime.encounters[String(payload.encounterId)];
      if (encounter === undefined) throw new TypeError("encounter unavailable");
      encounter.status = "concluded";
      if (Array.isArray(payload.phaseTasks)) {
        encounter.residualPhaseTasks = structuredClone(payload.phaseTasks);
      }
      if (String(payload.fictionAdvanceMicros) !== "0") {
        const timeline = state.fictionTimelines[event.fictionTimelineId];
        if (timeline === undefined) throw new TypeError("combat fiction timeline is unavailable");
        timeline.nowMicros = (BigInt(timeline.nowMicros) + BigInt(String(payload.fictionAdvanceMicros))).toString();
      }
      return true;
    }
    default: return false;
  }
}
