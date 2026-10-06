import { combatPlaceDeparture } from "./places";
import { RulesInvariantError, RulesValidationError } from "../errors";
import { isItemStockResourceId } from "./item-resources";
import { playerResourceKeyForCombatPool } from "./character-abilities";
import type {
  AuthoritativeWorldState,
  CharacterRecord,
  EventEnvelope,
  EventType,
  JsonRecord,
} from "./model";
import { applyWorldEffectEvent, isWorldEffectRecord, isWorldEffectRecordCandidate, synchronizeWorldEffectSuspensions } from "./world-effects";
import { parseDamageFormula, resolveCreatureDamage, worldDamageTarget } from "./damage";
import { conditionMovementPermission, conditionMovementCost, conditionSpeed, conditionDamageDefense } from "./condition-mechanics";
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
import { canonicalSha256, sameCanonical } from "../profiles/canonical";
import { isCanonicalTacticalGeometry } from "../profiles/tactical-geometry";
import { carriedPlacementValid, dragCostFactor, heldBodies, isCarriedCreatures, sceneBoundary, type CarriedCreature } from "./carry";
import { turnMovementLimitMilliInches } from "./basic-actions";
import { encounterParticipantsAbleToFight, recordEncounterStandDown } from "./combat-encounters";
import { endCharacterTenure } from "./character-lifecycle";
import {
  isDefinitionRegisteredAbilityPayload,
  isRegisteredAbilityRecord,
  registeredAbilityRecord,
  registeredAbilityDefinition,
} from "../profiles/ability-compiler";
import {
  analyzeCombatMovement,
  canonicalizeCombatPath,
} from "../profiles/combat-geometry";
import {
  canPromoteNpcSpatialShell,
  isNpcMechanicalTemplateDefinition,
  NPC_MECHANICAL_TEMPLATE_KIND,
  npcCoreMechanicsCompatible,
  synchronizeCombatItemResources,
  synchronizeCoreNpcCombatState,
} from "./npc-mechanics";
import { isItemDefinitionV1 } from "./items";
import {
  deriveNpcItemSystemLoadout,
  npcItemSystemEquipmentMechanics,
} from "./npc-item-system";

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
  "CombatantDeparted",
  "CombatPendingOpened",
  "CombatPendingClosed",
  "EncounterJoined",
  "InitiativeInserted",
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
  CombatantDeparted: ["encounterId", "entityId", "destinationSceneId", "phaseTasks"],
  EncounterConcluded: ["encounterId", "fictionAdvanceMicros", "reason"],
  CombatPendingOpened: ["pending"],
  CombatPendingClosed: ["pendingInputId"],
  EncounterJoined: ["encounterId", "entityIds", "hostilities"],
  InitiativeInserted: ["encounterId", "entries", "turnOrderEntityIds"],
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
    || (value.carried !== undefined && !isCarriedCreatures(value.carried))
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
  const formulaRoll = (type === "HealingResolved" || type === "TemporaryHitPointsGranted") && Object.hasOwn(value, "rollResult");
  // SPEC 0014 §4 (ADR 0090): a segment that drags a held creature records where it stops.
  const carries = type === "MovementSegmentCommitted" && Object.hasOwn(value, "carried");
  // SPEC 0012 §§3.1、3.4: a fight the KP starts or joins keeps its opening
  // description for the narration.
  // ADR 0112: a KP's ruling that some stop fighting tells its moment too.
  const described = (type === "EncounterStarted" || type === "EncounterJoined" || type === "HostilityChanged")
    && Object.hasOwn(value, "description");
  if (described && !(typeof value.description === "string" && value.description.trim().length > 0 && value.description.length <= 2_000)) return false;
  if (!hasExactKeys(value, [...KEYS[type], ...(formulaRoll ? ["rollResult"] : []), ...(carries ? ["carried"] : []),
    ...(described ? ["description"] : [])])) return false;
  if (formulaRoll) {
    const result = value.rollResult;
    const formula = isRecord(result) ? parseDamageFormula(result.formula) : undefined;
    if (!isRecord(result) || !hasExactKeys(result, ["sourceEntityId", "formula", "rolls", "total"])
      || !isNonEmptyString(result.sourceEntityId) || formula === undefined || !Array.isArray(result.rolls)
      || result.rolls.length !== formula.count
      || !result.rolls.every(face => Number.isSafeInteger(face) && Number(face) >= 1 && Number(face) <= formula.sides)
      || result.total !== Math.max(0, result.rolls.reduce<number>((sum, face) => sum + Number(face), 0) + formula.modifier)) return false;
  }
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
    case "EncounterJoined": return isNonEmptyString(value.encounterId) && canonicalStringArray(value.entityIds)
      && value.entityIds.length > 0 && Array.isArray(value.hostilities)
      && value.hostilities.every((relation) => isRecord(relation) && hasExactKeys(relation, ["fromEntityIds", "toEntityIds"])
        && stringArray(relation.fromEntityIds) && stringArray(relation.toEntityIds));
    case "InitiativeInserted": return isNonEmptyString(value.encounterId) && Array.isArray(value.entries)
      && value.entries.every(isRecord) && stringArray(value.turnOrderEntityIds);
    case "RoundStarted": return isNonEmptyString(value.encounterId) && Number.isSafeInteger(value.round)
      && stringArray(value.turnOrderEntityIds);
    case "TurnStarted": return [value.encounterId, value.sourceEntityId].every(isNonEmptyString)
      && Number.isSafeInteger(value.round);
    case "TurnEnded": return [value.encounterId, value.sourceEntityId].every(isNonEmptyString);
    case "AbilityInvoked": return [value.abilityRef, value.sourceEntityId].every(isNonEmptyString)
      && isRecord(value.mechanicalResult) && isRecord(value.sourcePatch);
    case "MovementSegmentCommitted": return canonicalMovementSegmentPayload(value);
    case "ConditionChanged": return isNonEmptyString(value.entityId) && isRecord(value.conditions);
    case "ResourceSpent": return [value.entityId, value.resourceId].every(isNonEmptyString)
      && !isItemStockResourceId(String(value.resourceId))
      && canonicalUnsignedIntegerString(value.amount)
      && value.amount !== "0"
      && canonicalUnsignedIntegerString(value.resourceAfter);
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
    case "CombatantDeparted": return [value.encounterId, value.entityId, value.destinationSceneId].every(isNonEmptyString)
      && Array.isArray(value.phaseTasks) && value.phaseTasks.every(phaseTask);
    case "ReactionAnswered": return [value.pendingInputId, value.controllerEntityId].every(isNonEmptyString)
      && isRecord(value.answer);
    case "TriggerInvalidated": return [value.pendingInputId, value.triggerInstanceId, value.reason].every(isNonEmptyString);
    case "SpellCastingStarted": return isRecord(value.cast) && isNonEmptyString(value.cast.castId)
      && isRecord(value.sourcePatch);
    case "SpellCountered": return [value.castId, value.sourceEntityId, value.abilityRef, value.counteredByCastId].every(isNonEmptyString);
    case "SpellResolved": return [value.castId, value.sourceEntityId, value.abilityRef].every(isNonEmptyString)
      && isRecord(value.outcome);
    case "EffectApplied": return isRecord(value.effect) && isNonEmptyString(value.effect.effectId)
      && (!isWorldEffectRecordCandidate(value.effect) || isWorldEffectRecord(value.effect));
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
  if (!isNonEmptyString(sceneId)) throw new RulesValidationError("materialized NPC lacks a scene");
  const established = state.entities[entity.entityId];
  if (established !== undefined) {
    if (
      established.kind !== "npc"
      || established.tenureStatus !== "active"
      || established.name !== entity.name
      || established.sceneId !== sceneId
    ) throw new RulesValidationError("combat NPC conflicts with established world identity");
    if (isNonEmptyString(entity.mechanicalDefinitionRef)
      && !npcCoreMechanicsCompatible(established, entity)) {
      throw new RulesValidationError("combat NPC mechanics conflict with established noncombat mechanics");
    }
    if (isNonEmptyString(entity.mechanicalDefinitionRef)) {
      const definition = state.combatRuntime.definitions[entity.mechanicalDefinitionRef];
      if (!isNpcMechanicalTemplateDefinition(definition)) {
        throw new RulesValidationError("combat NPC lacks its frozen mechanical template");
      }
      const itemSystem = state.campaignRuntime.itemSystem;
      if (itemSystem === undefined) throw new RulesValidationError("combat NPC item system is unavailable");
      const derived = deriveNpcItemSystemLoadout(itemSystem, established, definition);
      if ("error" in derived) throw new RulesValidationError("combat NPC inventory cannot be derived");
      established.loadout = derived.loadout;
    }
    if (socialResolution && established.socialMechanics === undefined) {
      const socialMechanics = combatNpcSocialMechanics(entity);
      if (socialMechanics === undefined) {
        throw new RulesValidationError("V5 combat NPC lacks derivable social mechanics");
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
    throw new RulesValidationError("V5 combat NPC lacks derivable social mechanics");
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
      throw new RulesValidationError("combat NPC lacks its frozen mechanical template");
    }
    const itemSystem = state.campaignRuntime.itemSystem;
    if (itemSystem === undefined) throw new RulesValidationError("combat NPC item system is unavailable");
    const derived = deriveNpcItemSystemLoadout(
      itemSystem,
      state.entities[entity.entityId],
      definition,
    );
    if ("error" in derived) throw new RulesValidationError("combat NPC inventory cannot be derived");
    state.entities[entity.entityId].loadout = derived.loadout;
  }
  state.knowledge[entity.entityId] = {};
  synchronizeCoreNpcCombatState(state, entity);
}

function synchronizeNpcItemSystemCombatCache(
  state: AuthoritativeWorldState,
  entityId: string,
): void {
  const character = state.entities[entityId];
  const combatEntity = state.combatRuntime.entities[entityId];
  const itemSystem = state.campaignRuntime.itemSystem;
  if (character?.kind !== "npc"
    || !isRecord(combatEntity)
    || !isNonEmptyString(combatEntity.mechanicalDefinitionRef)) return;
  const definition = state.combatRuntime.definitions[combatEntity.mechanicalDefinitionRef];
  if (itemSystem === undefined || !isNpcMechanicalTemplateDefinition(definition)) {
    throw new RulesValidationError("combat NPC item system mechanics are unavailable");
  }
  const derived = deriveNpcItemSystemLoadout(itemSystem, character, definition);
  if ("error" in derived) {
    throw new RulesValidationError(`combat NPC item loadout cannot be derived: ${derived.error}`);
  }
  character.loadout = derived.loadout;
  const equipment = npcItemSystemEquipmentMechanics(
    character,
    itemSystem,
    state.combatRuntime.definitions,
  );
  for (const equipmentDefinition of equipment.definitions) {
    const registered = state.combatRuntime.definitions[String(equipmentDefinition.definitionId)];
    if (!isRegisteredAbilityRecord(registered)
      || !sameCanonical(registeredAbilityDefinition(registered), equipmentDefinition)) {
      throw new RulesValidationError("combat NPC item ability is not frozen in the authoritative catalog");
    }
  }
  const intrinsicAbilityRefs = (definition.content as JsonRecord).intrinsicAbilityRefs as string[];
  combatEntity.armorClass = String(derived.loadout.armorClass);
  combatEntity.equipmentAbilityRefs = [...equipment.refs];
  combatEntity.abilityRefs = [...new Set([
    ...intrinsicAbilityRefs,
    ...equipment.refs,
  ])].sort();
  synchronizeCombatItemResources(combatEntity, itemSystem);
}

function patchEntity(state: AuthoritativeWorldState, patch: unknown): void {
  if (!isRecord(patch) || !isNonEmptyString(patch.id)) throw new RulesValidationError("combat entity patch is malformed");
  if (!(patch.id in state.combatRuntime.entities)) throw new RulesValidationError("combat entity patch target is unavailable");
  state.combatRuntime.entities[patch.id] = structuredClone(patch);
  synchronizeCoreNpcCombatState(state, patch);
}

function coreHitPointSyncForCombatPatch(
  state: AuthoritativeWorldState,
  previousCombatEntity: JsonRecord,
  combatEntity: JsonRecord,
): { characterId: string; current: number } | undefined {
  if (!isNonEmptyString(combatEntity.id)) return;
  const character = state.entities[combatEntity.id];
  if (character === undefined) return;
  const hitPoints = combatEntity.hitPoints;
  const current = isRecord(hitPoints) && canonicalUnsignedIntegerString(hitPoints.current)
    ? Number(hitPoints.current)
    : Number.NaN;
  const maximum = isRecord(hitPoints) && canonicalUnsignedIntegerString(hitPoints.maximum)
    ? Number(hitPoints.maximum)
    : Number.NaN;
  if (!Number.isSafeInteger(current)
    || !Number.isSafeInteger(maximum)
    || maximum <= 0
    || current > maximum) {
    throw new RulesValidationError("combat damage patch hit points are malformed");
  }
  if (character.hitPoints === undefined) {
    if (character.kind === "player") {
      throw new RulesValidationError("combat hit points conflict with the authoritative character");
    }
    return undefined;
  }
  if (!Number.isSafeInteger(character.hitPoints.current)
    || !Number.isSafeInteger(character.hitPoints.maximum)
    || character.hitPoints.maximum <= 0
    || character.hitPoints.current < 0
    || character.hitPoints.current > character.hitPoints.maximum
    || character.hitPoints.maximum !== maximum
    || current > character.hitPoints.current) {
    throw new RulesValidationError("combat hit points conflict with the authoritative character");
  }
  const previousHitPoints = previousCombatEntity.hitPoints;
  if (previousHitPoints !== undefined) {
    const previousCurrent = isRecord(previousHitPoints)
      && canonicalUnsignedIntegerString(previousHitPoints.current)
      ? Number(previousHitPoints.current)
      : Number.NaN;
    const previousMaximum = isRecord(previousHitPoints)
      && canonicalUnsignedIntegerString(previousHitPoints.maximum)
      ? Number(previousHitPoints.maximum)
      : Number.NaN;
    if (!Number.isSafeInteger(previousCurrent)
      || !Number.isSafeInteger(previousMaximum)
      || previousCurrent !== character.hitPoints.current
      || previousMaximum !== character.hitPoints.maximum) {
      throw new RulesValidationError("combat hit-point cache conflicts with the authoritative character");
    }
  } else if (character.kind !== "npc") {
    throw new RulesValidationError("combat player hit-point cache is unavailable");
  }
  return { characterId: character.id, current };
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
    throw new RulesValidationError("movement segment payload is malformed");
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
  ) throw new RulesValidationError("movement segment does not continue the authoritative combat state");
  const baseSpeed = isRecord(source.speedInches) ? source.speedInches[movementMode] : undefined;
  const conditionMovement = typeof baseSpeed === "string" ? conditionSpeed(state, sourceEntityId, baseSpeed) : undefined;
  const speed = conditionMovement?.canMove && (!conditionMovement.mustCrawl || movementMode === "walk") ? conditionMovement.speed : "0";
  if (!conditionMovementPermission(state, sourceEntityId, path).allowed) {
    throw new RulesValidationError("movement segment violates an authoritative condition");
  }
  if (!canonicalUnsignedIntegerString(speed)) {
    throw new RulesValidationError("movement segment mode has no authoritative speed");
  }
  if (movementAuthority === "activeTurn") {
    if (encounter.activeEntityId !== sourceEntityId) {
      throw new RulesValidationError("movement segment source is not in the active initiative group");
    }
  } else {
    const turn = isRecord(source.turn) ? source.turn : undefined;
    if (turn === undefined || turn.reaction !== "1") {
      throw new RulesValidationError("readied movement has no authoritative reaction grant");
    }
  }
  const scene = state.combatRuntime.scenes[String(source.sceneId)];
  // SPEC 0014 §4 (ADR 0090): exactly the creatures the mover holds come along.
  const held = heldBodies(state, sourceEntityId, String(source.sceneId));
  const field = Object.values(state.combatRuntime.entities).filter(entity => !held.includes(entity));
  const analyzed = analyzeCombatMovement(
    source,
    field,
    isRecord(scene) ? scene : undefined,
    path,
    movementHostileEntityIds(encounter, sourceEntityId),
  );
  if (
    !analyzed.ok
    || (BigInt(conditionMovementCost(state, sourceEntityId, analyzed.totalMilliInches, analyzed.path)) * dragCostFactor(source, held)).toString()
      !== payload.distanceMilliInches
    || JSON.stringify(analyzed.path) !== JSON.stringify(path)
  ) throw new RulesValidationError("movement segment distance or geometry is not authoritative");
  const carried = Array.isArray(payload.carried) ? payload.carried as CarriedCreature[] : [];
  const boundary = sceneBoundary(scene);
  if ((held.length > 0 || carried.length > 0) && (movementAuthority !== "activeTurn" || boundary === undefined || !isRecord(scene)
    || !carriedPlacementValid(scene, boundary, { ...source, position: path[path.length - 1] }, held, carried,
      field.filter(entity => entity !== source && entity.sceneId === source.sceneId)))) {
    throw new RulesValidationError("movement segment does not carry the held creatures beside the mover");
  }

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
  ) throw new RulesValidationError("movement segment spent distance is inconsistent");
  // SPEC 0012 §6.3: Dash taken on this turn raises the turn's movement limit.
  if (movementAuthority === "activeTurn"
    ? BigInt(nextMovement.spentMilliInches) > turnMovementLimitMilliInches(source, speed)
    : BigInt(String(payload.distanceMilliInches)) > BigInt(speed) * 1_000n) {
    throw new RulesValidationError("movement segment exceeds the authoritative movement speed");
  }

  const expectedPatch = structuredClone(source);
  if (movementAuthority === "readiedReaction") {
    const turn = isRecord(expectedPatch.turn) ? expectedPatch.turn : undefined;
    if (turn === undefined) throw new RulesValidationError("readied movement source has no turn grants");
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
    throw new RulesValidationError("movement segment entity patch changes unrelated authority state");
  }
  patchEntity(state, patch);
  for (const entry of carried) state.combatRuntime.entities[entry.characterId]!.position = structuredClone(entry.position);
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
  if (applyWorldEffectEvent(state, event)) return true;
  // Definitions are version-pinned room facts, not encounter-local state.  They
  // must remain replayable before the first combat/story runtime is opened so a
  // later encounter can refer to exactly the definition that was committed.
  if (runtime.story === null
    && event.eventType !== "DefinitionRegistered"
    && event.eventType !== "DamagePacketResolved") return false;
  if (event.resolutionId !== null && event.eventType !== "RandomnessRequested") {
    delete runtime.randomnessResolutions[event.resolutionId];
  }
  const payload = event.payload as JsonRecord;
  switch (event.eventType) {
    case "DefinitionRegistered": {
      const definition = payload.definition;
      const locationContent = isRecord(definition)
        && definition.definitionKind === "location"
        && isRecord(definition.content)
        ? definition.content
        : undefined;
      const dynamicGeometry = locationContent?.geometry;
      if (!isRecord(definition) || !isNonEmptyString(definition.definitionId)
        || definition.definitionId in runtime.definitions
        || (definition.definitionKind === NPC_MECHANICAL_TEMPLATE_KIND
          && !isNpcMechanicalTemplateDefinition(definition))
        || (definition.definitionKind === "item"
          && !isItemDefinitionV1(definition))
        || (dynamicGeometry !== undefined
          && (!hasExactKeys(locationContent!, ["geometry", "name", "sceneId"])
            || !isNonEmptyString(locationContent!.sceneId)
            || !isNonEmptyString(locationContent!.name)
            || !isCanonicalTacticalGeometry(dynamicGeometry)
            || locationContent!.sceneId in runtime.scenes))) {
        throw new RulesValidationError("combat definition already exists or is malformed");
      }
      runtime.definitions[definition.definitionId] = isDefinitionRegisteredAbilityPayload(payload)
        ? registeredAbilityRecord(payload)
        : structuredClone(definition);
      if (dynamicGeometry !== undefined) {
        runtime.scenes[locationContent!.sceneId as string] = {
          sceneId: locationContent!.sceneId,
          geometry: structuredClone(dynamicGeometry),
        };
      }
      return true;
    }
    case "EntityMaterialized": {
      if (!isRecord(payload.entity) || !isNonEmptyString(payload.entity.entityId)) {
        throw new RulesValidationError("combat entity is malformed");
      }
      const prior = runtime.entities[payload.entity.entityId];
      if (prior !== undefined
        && (!npcMechanicsProfileEnabled(event.profiles.extensions)
          || !canPromoteNpcSpatialShell(prior, payload.entity))) {
        throw new RulesValidationError("combat entity already exists");
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
        || encounter.encounterId in runtime.encounters) throw new RulesValidationError("encounter already exists");
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
        throw new RulesValidationError("hostility encounter unavailable");
      }
      const outgoing = new Map<string, Set<string>>();
      for (const relation of encounter.hostilities) {
        if (!isRecord(relation)
          || !Array.isArray(relation.fromEntityIds)
          || !relation.fromEntityIds.every(isNonEmptyString)
          || !Array.isArray(relation.toEntityIds)
          || !relation.toEntityIds.every(isNonEmptyString)) {
          throw new RulesValidationError("encounter hostility relation is malformed");
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
        throw new RulesValidationError("hostility change does not match its causal predecessor");
      }
      outgoing.set(String(payload.sourceEntityId), new Set(targetEntityIds));
      encounter.hostilities = [...outgoing.entries()]
        .filter(([, targetEntityIds]) => targetEntityIds.size > 0)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([sourceEntityId, targetEntityIds]) => ({
          fromEntityIds: [sourceEntityId],
          toEntityIds: [...targetEntityIds].sort(),
        }));
      // SPEC 0012 §§3.3、13 (ADR 0117): who stood down from whom, for the end
      // of the fight. Turning on someone again means an end refused earlier
      // no longer holds: the next one is asked when the fight is over again.
      const removed = previousTargetEntityIds.filter(id => !targetEntityIds.includes(id));
      const added = targetEntityIds.filter(id => !previousTargetEntityIds.includes(id));
      recordEncounterStandDown(encounter, String(payload.sourceEntityId), removed, added, String(payload.reason));
      if (added.length > 0) delete encounter.conclusionProposedWhileAble;
      return true;
    }
    case "InitiativeRequested": return true;
    case "InitiativeEstablished": {
      const encounter = runtime.encounters[String(payload.encounterId)];
      if (encounter === undefined || !Array.isArray(payload.entries) || !isRecord(payload.pending)) throw new RulesValidationError("initiative encounter unavailable");
      encounter.initiative = { entries: structuredClone(payload.entries), ordered: false };
      runtime.pendingInputs[String(payload.pending.pendingInputId)] = structuredClone(payload.pending);
      return true;
    }
    case "InitiativeTieOrdered": {
      const encounter = runtime.encounters[String(payload.encounterId)];
      if (encounter === undefined || !isRecord(encounter.initiative)) throw new RulesValidationError("initiative unavailable");
      encounter.initiative.orderedEntityIds = structuredClone(payload.orderedEntityIds);
      encounter.initiative.ordered = true;
      return true;
    }
    // SPEC 0012 §3.4: newcomers are participants with their hostilities from
    // now on, and take their place in the order once initiative is rolled.
    case "EncounterJoined": {
      const encounter = runtime.encounters[String(payload.encounterId)];
      if (encounter === undefined || encounter.status === "concluded" || !Array.isArray(encounter.participantEntityIds)
        || !Array.isArray(encounter.hostilities)) throw new RulesValidationError("joined encounter unavailable");
      encounter.participantEntityIds = [...new Set([...encounter.participantEntityIds, ...(payload.entityIds as string[])])];
      if (Array.isArray(encounter.departedEntityIds)) encounter.departedEntityIds = encounter.departedEntityIds.filter(id => !(payload.entityIds as string[]).includes(String(id)));
      encounter.hostilities = [...encounter.hostilities, ...structuredClone(payload.hostilities as JsonRecord[])];
      return true;
    }
    case "InitiativeInserted": {
      const encounter = runtime.encounters[String(payload.encounterId)];
      if (encounter === undefined || !isRecord(encounter.initiative) || !Array.isArray(encounter.initiative.entries)) {
        throw new RulesValidationError("initiative unavailable");
      }
      const entries = payload.entries as JsonRecord[];
      const joining = entries.flatMap(entry => Array.isArray(entry.combatantEntityIds) ? entry.combatantEntityIds : []);
      // SPEC 0012 §3.4: rejoining replaces only that creature's old place.
      // Other creatures in its original initiative group keep their roll.
      encounter.initiative.entries = [...encounter.initiative.entries.flatMap(entry => {
        if (!isRecord(entry) || !Array.isArray(entry.combatantEntityIds)) return [entry];
        const members = entry.combatantEntityIds.filter(id => !joining.includes(id));
        return members.length === 0 ? [] : [{ ...entry, combatantEntityIds: members }];
      }), ...structuredClone(entries)];
      encounter.turnOrderEntityIds = structuredClone(payload.turnOrderEntityIds);
      encounter.turnCursor = (payload.turnOrderEntityIds as string[]).indexOf(String(encounter.activeEntityId));
      // A newcomer's reaction is ready at once; its action waits for its turn.
      for (const entityId of entries.flatMap((entry) => entry.combatantEntityIds as string[])) {
        const entity = runtime.entities[entityId];
        if (entity !== undefined && !isRecord(entity.turn)) entity.turn = { action: "0", bonusAction: "0", reaction: "1",
          attacksRemaining: "0", hasteAction: "0", bonusActionSpellCast: false, leveledActionSpell: false,
          leveledBonusActionSpell: false, surprised: false };
      }
      return true;
    }
    case "RoundStarted": {
      const encounter = runtime.encounters[String(payload.encounterId)];
      if (encounter === undefined) throw new RulesValidationError("encounter unavailable");
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
      if (encounter === undefined) throw new RulesValidationError("encounter unavailable");
      encounter.activeEntityId = payload.sourceEntityId;
      encounter.combatMoment = {edge:"turnStart"};
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
      const encounter = runtime.encounters[String(payload.encounterId)];
      if(encounter!==undefined)encounter.combatMoment={edge:"turnEnd"};
      const entity = runtime.entities[String(payload.sourceEntityId)];
      if (entity !== undefined && isRecord(entity.turn) && entity.turn.surprised === true) {
        entity.turn.surprised = false;
        entity.turn.reaction = "1";
      }
      return true;
    }
    case "AbilityInvoked": {
      patchEntity(state, payload.sourcePatch);
      synchronizeNpcItemSystemCombatCache(state, String(payload.sourceEntityId));
      return true;
    }
    case "MovementSegmentCommitted": applyMovementSegment(state, payload); return true;
    case "ConditionChanged": {
      const entity = runtime.entities[String(payload.entityId)];
      if (entity === undefined) throw new RulesValidationError("condition entity unavailable");
      entity.conditions = structuredClone(payload.conditions);
      synchronizeWorldEffectSuspensions(state,String(payload.entityId));
      return true;
    }
    case "ResourceSpent": {
      const resourceId = String(payload.resourceId);
      if (isItemStockResourceId(resourceId)) {
        throw new RulesValidationError("item costs must use ItemUsed");
      }
      const entity = runtime.entities[String(payload.entityId)];
      if (entity === undefined || !isRecord(entity.resources) || !isRecord(entity.resources[resourceId])) throw new RulesValidationError("resource unavailable");
      const resource = entity.resources[resourceId] as JsonRecord;
      const core = state.entities[String(payload.entityId)];
      if (core?.kind === "player") {
        const key = playerResourceKeyForCombatPool(core, resourceId, resource);
        const amount = Number(payload.amount);
        const after = Number(payload.resourceAfter);
        if (key === undefined || !Number.isSafeInteger(amount) || amount <= 0
          || !Number.isSafeInteger(after) || after < 0
          || after !== Number(resource.current) - amount)
          throw new RulesValidationError("player resource spending lacks its authoritative pool");
        core.resources![key] = after;
      }
      resource.current = payload.resourceAfter;
      synchronizeCoreNpcCombatState(state, entity);
      return true;
    }
    case "HealingResolved": {
      const entity = runtime.entities[String(payload.entityId)];
      if (entity === undefined || !isRecord(entity.hitPoints)) throw new RulesValidationError("healing target unavailable");
      const coreCharacter = state.entities[String(payload.entityId)];
      if (coreCharacter?.kind === "player") {
        const before = Number(payload.before);
        const after = Number(payload.after);
        const combatBefore = Number(entity.hitPoints.current);
        const combatMaximum = Number(entity.hitPoints.maximum);
        if (coreCharacter.hitPoints === undefined
          || !Number.isSafeInteger(before)
          || !Number.isSafeInteger(after)
          || !Number.isSafeInteger(combatBefore)
          || !Number.isSafeInteger(combatMaximum)
          || before !== combatBefore
          || coreCharacter.hitPoints.current !== before
          || coreCharacter.hitPoints.maximum !== combatMaximum
          || after < before
          || after > combatMaximum) {
          throw new RulesValidationError("player healing event does not match authoritative hit points");
        }
        coreCharacter.hitPoints.current = after;
      }
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
        throw new RulesValidationError("temporary-hit-point target unavailable");
      }
      entity.hitPoints.temporary = payload.after;
      return true;
    }
    case "DamagePacketResolved": {
      if (!("targetPatch" in payload)) return false;
      if (!isRecord(payload.targetPatch)
        || payload.targetPatch.id !== payload.targetEntityId) {
        throw new RulesValidationError("damage packet target patch is malformed");
      }
      const previousSnapshot = runtime.entities[String(payload.targetEntityId)];
      const needsMechanicalBaseline = !isRecord(previousSnapshot?.hitPoints);
      const previousCombatEntity = needsMechanicalBaseline
        ? worldDamageTarget(state, String(payload.targetEntityId))
        : previousSnapshot;
      if (!isRecord(previousCombatEntity)) {
        throw new RulesInvariantError("damage packet target is unavailable");
      }
      if (needsMechanicalBaseline) {
        if (!Array.isArray(payload.components)
          || !payload.components.every((component) => isRecord(component)
            && isNonEmptyString(component.type)
            && Number.isSafeInteger(component.rolled) && Number(component.rolled) >= 0)) {
          throw new RulesInvariantError("world damage components are malformed");
        }
        const expected = resolveCreatureDamage(previousCombatEntity,
          payload.components.map((component) => ({
            type: String((component as JsonRecord).type),
            rolled: Number((component as JsonRecord).rolled),
          })), (type) => conditionDamageDefense(state, String(payload.targetEntityId), type));
        if (payload.pipelineProfileId !== "damage-death-srd51-2014-v1"
          || expected.totalApplied !== payload.totalApplied
          || !sameCanonical(expected.components, payload.components)
          || !sameCanonical(expected.targetPatch, payload.targetPatch)) {
          throw new RulesInvariantError("world damage packet differs from the authoritative creature result");
        }
      }
      const coreHitPointSync = coreHitPointSyncForCombatPatch(
        state,
        previousCombatEntity,
        payload.targetPatch,
      );
      if (previousSnapshot === undefined) {
        runtime.entities[String(payload.targetEntityId)] = structuredClone(payload.targetPatch);
        synchronizeCoreNpcCombatState(state, payload.targetPatch);
      } else patchEntity(state, payload.targetPatch);
      if (coreHitPointSync !== undefined) {
        state.entities[coreHitPointSync.characterId].hitPoints!.current = coreHitPointSync.current;
      }
      synchronizeWorldEffectSuspensions(state,String(payload.targetEntityId));
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
      if (entity === undefined) throw new RulesValidationError("concentration entity unavailable");
      entity.concentration = structuredClone(payload.concentration);
      return true;
    }
    case "ConcentrationTested": return true;
    case "ConcentrationEnded": {
      const entity = runtime.entities[String(payload.entityId)];
      if (entity === undefined) throw new RulesValidationError("concentration entity unavailable");
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
        || ready.effectId in runtime.effects) throw new RulesValidationError("readied action already exists");
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
        || effect.effectId in runtime.effects) throw new RulesValidationError("combat effect already exists");
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
      if (encounter === undefined) throw new RulesValidationError("encounter unavailable");
      encounter.roundClosed = true;
      const timeline = state.fictionTimelines[event.fictionTimelineId];
      if (timeline === undefined) throw new RulesValidationError("combat fiction timeline is unavailable");
      timeline.nowMicros = (BigInt(timeline.nowMicros) + BigInt(String(payload.fictionAdvanceMicros))).toString();
      return true;
    }
    case "DeathSaveResolved": {
      patchEntity(state, payload.entityPatch);
      if(isRecord(payload.entityPatch))synchronizeWorldEffectSuspensions(state,String(payload.entityPatch.id));
      return true;
    }
    case "EncounterConclusionProposed": {
      const pending = payload.pending as JsonRecord;
      runtime.pendingInputs[String(pending.pendingInputId)] = structuredClone(pending);
      // SPEC 0012 §13 (ADR 0112): who could still fight when an end was last
      // put to the players. Rules proposes the end on its own again only once
      // that has changed, so a refusal is not asked again turn after turn.
      const encounter = runtime.encounters[String(pending.encounterId)];
      if (encounter !== undefined) encounter.conclusionProposedWhileAble = encounterParticipantsAbleToFight(state, encounter);
      return true;
    }
    case "CombatantDeparted": {
      const encounter = runtime.encounters[String(payload.encounterId)];
      const planned = combatPlaceDeparture(state, String(payload.entityId), String(payload.destinationSceneId));
      if (encounter === undefined || planned.kind !== "accepted" || encounter.activeEntityId !== payload.entityId)
        throw new RulesValidationError("combat departure does not match a real exit");
      const entity = runtime.entities[String(payload.entityId)]!;
      const movement = isRecord(entity.movement) ? entity.movement : { spentMilliInches: "0" };
      movement.spentMilliInches = (BigInt(String(movement.spentMilliInches)) + 60_000n).toString();
      entity.movement = movement;
      encounter.historicalParticipantEntityIds = [...new Set([
        ...(Array.isArray(encounter.historicalParticipantEntityIds) ? encounter.historicalParticipantEntityIds : []),
        ...(Array.isArray(encounter.participantEntityIds) ? encounter.participantEntityIds : []),
      ])];
      encounter.participantEntityIds = (encounter.participantEntityIds as unknown[]).filter(id => id !== payload.entityId);
      encounter.departedEntityIds = [...(Array.isArray(encounter.departedEntityIds) ? encounter.departedEntityIds : []), payload.entityId];
      encounter.residualPhaseTasks = [...(Array.isArray(encounter.residualPhaseTasks) ? encounter.residualPhaseTasks : []),
        ...structuredClone(payload.phaseTasks as JsonRecord[])];
      return true;
    }
    case "EncounterConcluded": {
      const encounter = runtime.encounters[String(payload.encounterId)];
      if (encounter === undefined) throw new RulesValidationError("encounter unavailable");
      encounter.status = "concluded";
      if (Array.isArray(payload.phaseTasks)) {
        encounter.residualPhaseTasks = structuredClone(payload.phaseTasks);
      }
      if (String(payload.fictionAdvanceMicros) !== "0") {
        const timeline = state.fictionTimelines[event.fictionTimelineId];
        if (timeline === undefined) throw new RulesValidationError("combat fiction timeline is unavailable");
        timeline.nowMicros = (BigInt(timeline.nowMicros) + BigInt(String(payload.fictionAdvanceMicros))).toString();
      }
      return true;
    }
    default: return false;
  }
}
