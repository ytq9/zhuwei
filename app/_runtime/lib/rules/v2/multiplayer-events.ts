import type {
  AuthoritativeWorldState,
  CharacterRecord,
  EventEnvelope,
  EventPayloadByType,
  EventType,
  JsonRecord,
} from "./model";
import { canonicalSha256 } from "../profiles/canonical";
import { isRegisteredAbilityRecord } from "../profiles/ability-compiler";
import { npcMechanicsProfileEnabled } from "../profiles/npc-mechanics";
import {
  canonicalFactVisibleToCharacter,
  hasExactKeys,
  hasOnlyKeys,
  isCharacterLoadout,
  isNonEmptyString,
  isRecord,
} from "./validation";
import { applyMovement } from "./timeline";
import { fictionTimelineIdForScene } from "./multiplayer-model";
import { isGearSlot } from "./character-gear";
import { changeItemEquipment } from "./item-transitions";
import { compileCanonicalCharacterCombat } from "./character-abilities";
import {
  isNpcMechanicalTemplateDefinition,
  synchronizeCombatItemResources,
} from "./npc-mechanics";
import {
  changeNpcItemSystemEquipment,
  changeNpcItemSystemLifecycle,
} from "./npc-item-system";

const NPC_ITEM_STATE_CAUSE_SCHEMA = "zhuwei.npc-mechanical-item-state-cause/v1";
const NPC_ITEM_STATE_CAUSE_CONSUMED_SCHEMA = "zhuwei.npc-mechanical-item-state-cause-consumed/v1";

type NpcMechanicalItemStateCause = {
  actorCharacterId: string;
  npcCharacterId: string;
  itemId: string;
  action: "break" | "repair" | "destroy";
  causeFactRef: string;
};

export function npcMechanicalItemStateCauseUseFactId(causeFactRef: string): string {
  return `fact:npc-mechanical-item-state-cause-use:${canonicalSha256({
    schema: NPC_ITEM_STATE_CAUSE_CONSUMED_SCHEMA,
    causeFactRef,
  })}`;
}

function frozenAbilityMatches(expected: JsonRecord, registered: unknown): boolean {
  if (isRegisteredAbilityRecord(registered)) {
    return registered.definitionHash === (isRegisteredAbilityRecord(expected)
      ? expected.definitionHash
      : canonicalSha256(expected));
  }
  return isRecord(registered)
    && canonicalSha256(registered) === canonicalSha256(expected);
}

function npcMechanicalItemStateCauseMatches(
  state: AuthoritativeWorldState,
  input: NpcMechanicalItemStateCause,
): boolean {
  const actor = state.entities[input.actorCharacterId];
  const npc = state.entities[input.npcCharacterId];
  const fact = state.canonicalFacts[input.causeFactRef];
  const expectedSubjects = [input.itemId, input.npcCharacterId].sort();
  if (actor === undefined
    || actor.tenureStatus !== "active"
    || npc?.kind !== "npc"
    || npc.tenureStatus !== "active"
    || actor.sceneId !== npc.sceneId
    || fact?.kind !== "npcMechanicalItemStateCause"
    || !canonicalFactVisibleToCharacter(state, fact, actor)
    || canonicalSha256(fact.subjectRefs) !== canonicalSha256(expectedSubjects)
    || !isRecord(fact.value)
    || !hasExactKeys(fact.value, ["action", "itemRef", "npcRef", "schema"])
    || fact.value.schema !== NPC_ITEM_STATE_CAUSE_SCHEMA
    || fact.value.npcRef !== input.npcCharacterId
    || fact.value.itemRef !== input.itemId
    || fact.value.action !== input.action
    || !["mechanicalResolution", "observedEvent"].includes(fact.source)
    || fact.causalParentIds.some((parentRef) =>
      parentRef === fact.id || !(parentRef in state.canonicalFacts))) {
    return false;
  }
  return fact.source !== "observedEvent" || fact.causalParentIds.length > 0;
}

export function npcMechanicalItemStateCauseAvailable(
  state: AuthoritativeWorldState,
  input: NpcMechanicalItemStateCause,
): boolean {
  return npcMechanicalItemStateCauseMatches(state, input)
    && !(npcMechanicalItemStateCauseUseFactId(input.causeFactRef) in state.canonicalFacts);
}

function consumeNpcMechanicalItemStateCause(
  state: AuthoritativeWorldState,
  event: EventEnvelope,
  input: NpcMechanicalItemStateCause,
): void {
  if (!npcMechanicalItemStateCauseAvailable(state, input)) {
    throw new TypeError("NPC mechanical item-state cause is unavailable or already consumed");
  }
  const factId = npcMechanicalItemStateCauseUseFactId(input.causeFactRef);
  state.canonicalFacts[factId] = {
    id: factId,
    kind: "npcMechanicalItemStateCauseConsumed",
    subjectRefs: [...new Set([
      input.actorCharacterId,
      input.npcCharacterId,
      input.itemId,
      input.causeFactRef,
    ])].sort(),
    value: {
      schema: NPC_ITEM_STATE_CAUSE_CONSUMED_SCHEMA,
      actorCharacterId: input.actorCharacterId,
      npcRef: input.npcCharacterId,
      itemRef: input.itemId,
      action: input.action,
      causeFactRef: input.causeFactRef,
    },
    visibilityPolicyId: "visibility:room-authority-only",
    source: "mechanicalResolution",
    branchId: event.branchId,
    validFromEventSeq: event.eventSeq,
    causalParentIds: [input.causeFactRef],
  };
}

export const MULTIPLAYER_EVENT_TYPES = [
  "MemberJoined",
  "MemberDeparted",
  "MemberRemoved",
  "SeatGranted",
  "SeatReactivated",
  "SeatVacated",
  "CharacterControlGranted",
  "CharacterGearChanged",
  "NpcGearChanged",
  "NpcMechanicalItemStateChanged",
  "CharacterMechanicsSynchronized",
  "CharacterControlRevoked",
  "HostTransferred",
  "PendingInputSuspended",
  "PendingInputReassigned",
  "PendingInputResumed",
  "PartyGroupCreated",
  "PartyMemberInvited",
  "PartyInvitationAnswered",
  "PartyInvitationCancelled",
  "PartyMemberJoined",
  "PartyMemberLeft",
  "PartyLeaderTransferred",
  "PartyGroupDisbanded",
  "PartyMoveProposed",
  "PartyMoveConsentRecorded",
  "PartyMoved",
  "CharacterMoved",
  "FictionTimelinesMet",
  "CausalFrontierPropagated",
] as const satisfies readonly EventType[];

function canonicalStrings(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(isNonEmptyString)
    && value.length === new Set(value).size
    && value.every((entry, index) => index === 0 || value[index - 1] < entry);
}

function character(value: unknown): value is CharacterRecord {
  return isRecord(value)
    && hasOnlyKeys(value, ["entityOrdinal", "id", "kind", "name", "sceneId", "tenureStatus"], [
      "abilityScores",
      "cantripIds",
      "classId",
      "expertiseSkills",
      "featureIds",
      "hitPoints",
      "lastControllerSeatId",
      "lastLongRestCompletedAtMicros",
      "level",
      "loadout",
      "preparedSpellIds",
      "proficiencyBonus",
      "proficientSkills",
      "proficientSaves",
      "raceId",
      "resourceMaximums",
      "resources",
      "subclassId",
    ])
    && isNonEmptyString(value.id)
    && (value.kind === "player" || value.kind === "npc")
    && isNonEmptyString(value.name)
    && isNonEmptyString(value.sceneId)
    && isNonEmptyString(value.tenureStatus)
    && typeof value.entityOrdinal === "string"
    && /^[1-9][0-9]*$/.test(value.entityOrdinal)
    && (value.loadout === undefined || isCharacterLoadout(value.loadout))
    && [value.classId, value.raceId, value.subclassId, value.lastControllerSeatId]
      .every((entry) => entry === undefined || isNonEmptyString(entry))
    && (value.lastLongRestCompletedAtMicros === undefined
      || (typeof value.lastLongRestCompletedAtMicros === "string"
        && /^(0|[1-9][0-9]*)$/.test(value.lastLongRestCompletedAtMicros)))
    && [value.cantripIds, value.preparedSpellIds, value.featureIds]
      .every((entry) => entry === undefined || canonicalStrings(entry))
    && [value.proficientSkills, value.expertiseSkills, value.proficientSaves]
      .every((entry) => entry === undefined || canonicalStrings(entry))
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
        isNonEmptyString(resourceId) && Number.isSafeInteger(maximum) && Number(maximum) >= 0)));
}

export function validCharacterMechanicsSnapshot(
  characterId: unknown,
  combatEntity: unknown,
  definitions: unknown,
): boolean {
  return isNonEmptyString(characterId)
    && isRecord(combatEntity)
    && combatEntity.id === characterId
    && combatEntity.entityId === characterId
    && combatEntity.kind === "player"
    && Array.isArray(definitions)
    && definitions.every((definition) => isRecord(definition)
      && isNonEmptyString(definition.definitionId)
      && definition.rulesBasis === "srd5.1-2014")
    && canonicalStrings(definitions.map((definition) => String(definition.definitionId)));
}

export function validateMultiplayerEventPayload(eventType: EventType, value: JsonRecord): boolean {
  switch (eventType) {
    case "MemberJoined":
      return hasExactKeys(value, ["principal", "role"])
        && isRecord(value.principal)
        && hasExactKeys(value.principal, ["id", "sessionVersion"])
        && isNonEmptyString(value.principal.id)
        && Number.isSafeInteger(value.principal.sessionVersion)
        && Number(value.principal.sessionVersion) > 0
        && ["host", "player", "observer"].includes(String(value.role));
    case "MemberDeparted":
    case "MemberRemoved":
      return hasExactKeys(value, ["principalId", "reason"])
        && isNonEmptyString(value.principalId)
        && isNonEmptyString(value.reason);
    case "SeatGranted":
      return hasExactKeys(value, ["seat"])
        && isRecord(value.seat)
        && hasExactKeys(value.seat, ["id", "principalId", "status"])
        && isNonEmptyString(value.seat.id)
        && isNonEmptyString(value.seat.principalId)
        && value.seat.status === "active";
    case "SeatReactivated":
      return hasExactKeys(value, ["principalId", "seatId"])
        && isNonEmptyString(value.principalId)
        && isNonEmptyString(value.seatId);
    case "SeatVacated":
      return hasExactKeys(value, ["principalId", "reason", "seatId"])
        && [value.principalId, value.reason, value.seatId].every(isNonEmptyString);
    case "CharacterControlGranted":
      if (!isNonEmptyString(value.characterId) || !isNonEmptyString(value.seatId)) return false;
      if (value.character === null) {
        return hasExactKeys(value, ["character", "characterId", "seatId"]);
      }
      return hasExactKeys(value, [
        "character",
        "characterId",
        "combatEntity",
        "definitions",
        "seatId",
      ])
        && character(value.character)
        && value.character.id === value.characterId
        && validCharacterMechanicsSnapshot(
          value.characterId,
          value.combatEntity,
          value.definitions,
        );
    case "CharacterGearChanged":
      return hasExactKeys(value, ["action", "armorClass", "characterId", "itemId", "slot"])
        && (value.action === "wear" || value.action === "stow")
        && isNonEmptyString(value.characterId)
        && isNonEmptyString(value.itemId)
        && isGearSlot(value.slot)
        && Number.isSafeInteger(value.armorClass)
        && Number(value.armorClass) >= 1
        && Number(value.armorClass) <= 99;
    case "NpcGearChanged":
      return hasExactKeys(value, [
        "action",
        "armorClass",
        "characterId",
        "equipmentAbilityRefs",
        "itemId",
        "slot",
      ])
        && (value.action === "wear" || value.action === "stow")
        && isNonEmptyString(value.characterId)
        && isNonEmptyString(value.itemId)
        && isGearSlot(value.slot)
        && Number.isSafeInteger(value.armorClass)
        && Number(value.armorClass) >= 1
        && Number(value.armorClass) <= 99
        && canonicalStrings(value.equipmentAbilityRefs);
    case "NpcMechanicalItemStateChanged":
      return hasExactKeys(value, [
        "action",
        "actorCharacterId",
        "armorClass",
        "causeFactRef",
        "characterId",
        "equipmentAbilityRefs",
        "itemId",
      ])
        && ["break", "repair", "destroy"].includes(String(value.action))
        && isNonEmptyString(value.actorCharacterId)
        && isNonEmptyString(value.causeFactRef)
        && isNonEmptyString(value.characterId)
        && isNonEmptyString(value.itemId)
        && Number.isSafeInteger(value.armorClass)
        && Number(value.armorClass) >= 1
        && Number(value.armorClass) <= 99
        && canonicalStrings(value.equipmentAbilityRefs);
    case "CharacterMechanicsSynchronized":
      return hasExactKeys(value, ["characterId", "combatEntity", "definitions"])
        && validCharacterMechanicsSnapshot(
          value.characterId,
          value.combatEntity,
          value.definitions,
        );
    case "CharacterControlRevoked":
      return hasExactKeys(value, ["characterId", "reason", "seatId"])
        && [value.characterId, value.reason, value.seatId].every(isNonEmptyString);
    case "HostTransferred":
      return hasExactKeys(value, ["fromPrincipalId", "toPrincipalId"])
        && isNonEmptyString(value.fromPrincipalId)
        && isNonEmptyString(value.toPrincipalId);
    case "PendingInputSuspended":
      return hasExactKeys(value, ["controllerCharacterId", "pendingInputId", "reason"])
        && [value.controllerCharacterId, value.pendingInputId, value.reason].every(isNonEmptyString);
    case "PendingInputReassigned":
      return hasExactKeys(value, ["controllerCharacterId", "fromSeatId", "pendingInputId", "toSeatId"])
        && [value.controllerCharacterId, value.fromSeatId, value.pendingInputId, value.toSeatId]
          .every(isNonEmptyString);
    case "PendingInputResumed":
      return hasExactKeys(value, ["controllerCharacterId", "pendingInputId", "seatId"])
        && [value.controllerCharacterId, value.pendingInputId, value.seatId]
          .every(isNonEmptyString);
    case "PartyGroupCreated":
      return hasExactKeys(value, ["groupId", "leaderCharacterId", "memberCharacterIds"])
        && isNonEmptyString(value.groupId)
        && isNonEmptyString(value.leaderCharacterId)
        && canonicalStrings(value.memberCharacterIds)
        && value.memberCharacterIds.includes(value.leaderCharacterId);
    case "PartyMemberInvited":
      return hasExactKeys(value, ["groupId", "invitedCharacterId", "inviterCharacterId", "pendingInputId"])
        && [value.groupId, value.invitedCharacterId, value.inviterCharacterId, value.pendingInputId]
          .every(isNonEmptyString);
    case "PartyInvitationAnswered":
      return hasExactKeys(value, ["accepted", "groupId", "invitedCharacterId", "pendingInputId"])
        && [value.groupId, value.invitedCharacterId, value.pendingInputId].every(isNonEmptyString)
        && typeof value.accepted === "boolean";
    case "PartyInvitationCancelled":
      return hasExactKeys(value, [
        "groupId",
        "invitationRootActionId",
        "invitedCharacterId",
        "inviterCharacterId",
        "pendingInputId",
      ])
        && [
          value.groupId,
          value.invitationRootActionId,
          value.invitedCharacterId,
          value.inviterCharacterId,
          value.pendingInputId,
        ].every(isNonEmptyString);
    case "PartyMemberJoined":
      return hasExactKeys(value, ["characterId", "groupId"])
        && isNonEmptyString(value.characterId)
        && isNonEmptyString(value.groupId);
    case "PartyMemberLeft":
      return hasExactKeys(value, ["characterId", "groupId", "reason"])
        && [value.characterId, value.groupId, value.reason].every(isNonEmptyString);
    case "PartyLeaderTransferred":
      return hasExactKeys(value, ["fromCharacterId", "groupId", "toCharacterId"])
        && [value.fromCharacterId, value.groupId, value.toCharacterId].every(isNonEmptyString);
    case "PartyGroupDisbanded":
      return hasExactKeys(value, ["groupId", "reason"])
        && isNonEmptyString(value.groupId)
        && isNonEmptyString(value.reason);
    case "PartyMoveProposed":
      return hasExactKeys(value, [
        "arrivalMicros",
        "departureMicros",
        "destinationSceneId",
        "destinationTimelineId",
        "fictionTimeCostMicros",
        "groupId",
        "leaderCharacterId",
        "memberCharacterIds",
        "pendingInputIds",
        "proposalId",
        "sourceTimelineId",
      ])
        && [
          value.arrivalMicros,
          value.departureMicros,
          value.destinationSceneId,
          value.destinationTimelineId,
          value.fictionTimeCostMicros,
          value.groupId,
          value.leaderCharacterId,
          value.proposalId,
          value.sourceTimelineId,
        ].every(isNonEmptyString)
        && canonicalStrings(value.memberCharacterIds)
        && canonicalStrings(value.pendingInputIds);
    case "PartyMoveConsentRecorded":
      return hasExactKeys(value, ["accepted", "characterId", "groupId", "pendingInputId", "proposalId"])
        && [value.characterId, value.groupId, value.pendingInputId, value.proposalId].every(isNonEmptyString)
        && typeof value.accepted === "boolean";
    case "PartyMoved":
      return hasExactKeys(value, [
        "arrivalMicros",
        "departureMicros",
        "destinationSceneId",
        "destinationTimelineId",
        "groupId",
        "memberCharacterIds",
        "proposalId",
        "sourceTimelineId",
      ])
        && [
          value.arrivalMicros,
          value.departureMicros,
          value.destinationSceneId,
          value.destinationTimelineId,
          value.groupId,
          value.proposalId,
          value.sourceTimelineId,
        ].every(isNonEmptyString)
        && canonicalStrings(value.memberCharacterIds);
    case "CharacterMoved":
      return hasExactKeys(value, [
        "arrivalMicros",
        "characterId",
        "departureMicros",
        "destinationSceneId",
        "destinationTimelineId",
        "sourceTimelineId",
      ])
        && [
          value.arrivalMicros,
          value.characterId,
          value.departureMicros,
          value.destinationSceneId,
          value.destinationTimelineId,
          value.sourceTimelineId,
        ].every(isNonEmptyString);
    case "FictionTimelinesMet":
      return hasExactKeys(value, [
        "characterIds",
        "meetingMicros",
        "meetingTimelineId",
        "sceneId",
        "sourceTimelineIds",
      ])
        && canonicalStrings(value.characterIds)
        && canonicalStrings(value.sourceTimelineIds)
        && [value.meetingMicros, value.meetingTimelineId, value.sceneId].every(isNonEmptyString)
        && /^(0|[1-9][0-9]*)$/.test(String(value.meetingMicros));
    case "CausalFrontierPropagated":
      return hasExactKeys(value, [
        "arrivalMicros",
        "mediumFactId",
        "sourceEventHeadId",
        "sourceTimelineId",
        "targetTimelineId",
      ])
        && [
          value.arrivalMicros,
          value.mediumFactId,
          value.sourceEventHeadId,
          value.sourceTimelineId,
          value.targetTimelineId,
        ].every(isNonEmptyString)
        && /^(0|[1-9][0-9]*)$/.test(String(value.arrivalMicros));
    default:
      return false;
  }
}

export function applyCharacterMechanicsSnapshot(
  state: AuthoritativeWorldState,
  characterId: string,
  combatEntity: JsonRecord,
  definitions: JsonRecord[],
): void {
  const characterState = state.entities[characterId];
  if (characterState?.kind !== "player"
    || characterState.tenureStatus !== "active"
    || !validCharacterMechanicsSnapshot(characterId, combatEntity, definitions)) {
    throw new TypeError("character mechanics cannot be synchronized");
  }
  for (const definition of definitions) {
    const definitionId = String(definition.definitionId);
    const prior = state.combatRuntime.definitions[definitionId];
    if (prior !== undefined && canonicalSha256(prior) !== canonicalSha256(definition)) {
      throw new TypeError("character ability definition conflicts with its pinned revision");
    }
  }
  for (const definition of definitions) {
    state.combatRuntime.definitions[String(definition.definitionId)] = structuredClone(definition);
  }
  state.combatRuntime.entities[characterId] = structuredClone(combatEntity);
}

export function applyMultiplayerEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  switch (event.eventType) {
    case "MemberJoined": {
      const payload = event.payload as EventPayloadByType["MemberJoined"];
      const existing = state.multiplayerRuntime.members[payload.principal.id];
      if (existing?.status === "active") throw new TypeError("room member is already active");
      state.principals[payload.principal.id] = structuredClone(payload.principal);
      state.multiplayerRuntime.members[payload.principal.id] = {
        principalId: payload.principal.id,
        role: payload.role,
        status: "active",
      };
      return true;
    }
    case "MemberDeparted":
    case "MemberRemoved": {
      const payload = event.payload as EventPayloadByType["MemberRemoved"];
      const member = state.multiplayerRuntime.members[payload.principalId];
      if (member?.status !== "active") throw new TypeError("active room member is unavailable");
      member.status = event.eventType === "MemberRemoved" ? "removed" : "departed";
      return true;
    }
    case "SeatGranted": {
      const payload = event.payload as EventPayloadByType["SeatGranted"];
      if (payload.seat.id in state.seats || state.multiplayerRuntime.members[payload.seat.principalId]?.status !== "active") {
        throw new TypeError("seat cannot be granted");
      }
      state.seats[payload.seat.id] = structuredClone(payload.seat);
      return true;
    }
    case "SeatReactivated": {
      const payload = event.payload as EventPayloadByType["SeatReactivated"];
      const seat = state.seats[payload.seatId];
      if (
        seat?.principalId !== payload.principalId
        || seat.status !== "inactive"
        || state.multiplayerRuntime.members[payload.principalId]?.status !== "active"
      ) throw new TypeError("seat cannot be reactivated");
      seat.status = "active";
      return true;
    }
    case "SeatVacated": {
      const payload = event.payload as EventPayloadByType["SeatVacated"];
      const seat = state.seats[payload.seatId];
      if (seat?.principalId !== payload.principalId || seat.status !== "active") {
        throw new TypeError("seat cannot be vacated");
      }
      seat.status = "inactive";
      return true;
    }
    case "CharacterControlGranted": {
      const payload = event.payload as EventPayloadByType["CharacterControlGranted"];
      if (
        payload.characterId in state.characterControls
        || state.seats[payload.seatId]?.status !== "active"
        || (payload.character === null && !(payload.characterId in state.entities))
      ) throw new TypeError("character control cannot be granted");
      if (payload.character !== null) {
        if (payload.character.id in state.entities || !(payload.character.sceneId in state.scenes)) {
          throw new TypeError("controlled character cannot be materialized");
        }
        state.entities[payload.character.id] = structuredClone(payload.character);
        state.knowledge[payload.character.id] = {};
        applyCharacterMechanicsSnapshot(
          state,
          payload.characterId,
          payload.combatEntity,
          payload.definitions,
        );
      }
      state.characterControls[payload.characterId] = {
        characterId: payload.characterId,
        seatId: payload.seatId,
      };
      const characterState = state.entities[payload.characterId];
      const primarySceneId = String(
        state.multiplayerRuntime.causalFrontiers[state.activeBranchId]?.sceneId ?? "",
      );
      const timelineId = characterState.sceneId === primarySceneId
        ? state.activeBranchId
        : fictionTimelineIdForScene(state.activeBranchId, characterState.sceneId);
      const branchTimeline = state.fictionTimelines[state.activeBranchId];
      state.fictionTimelines[timelineId] ??= {
        branchId: state.activeBranchId,
        nowMicros: branchTimeline.nowMicros,
      };
      state.multiplayerRuntime.characterTimelineIds[payload.characterId] = timelineId;
      state.multiplayerRuntime.causalFrontiers[timelineId] ??= {
        timelineId,
        sceneId: characterState.sceneId,
        branchId: state.activeBranchId,
        nowMicros: state.fictionTimelines[timelineId].nowMicros,
        eventHeadId: event.eventId,
        causalParentTimelineIds: [state.activeBranchId],
      };
      const priorSpotlight = state.multiplayerRuntime.spotlightLedger[payload.characterId];
      state.multiplayerRuntime.spotlightLedger[payload.characterId] = {
        characterId: payload.characterId,
        seatId: payload.seatId,
        decisionBeats: priorSpotlight?.decisionBeats ?? "0",
        invited: priorSpotlight?.invited ?? false,
        lastInvitedBeat: priorSpotlight?.lastInvitedBeat ?? null,
        explicitSkips: priorSpotlight?.explicitSkips ?? "0",
        sceneId: characterState.sceneId,
      };
      return true;
    }
    case "CharacterGearChanged": {
      const payload = event.payload as EventPayloadByType["CharacterGearChanged"];
      const target = state.entities[payload.characterId];
      if (target?.kind !== "player" || target.tenureStatus !== "active" || !isGearSlot(payload.slot)) {
        throw new TypeError("character gear cannot be changed");
      }
      const itemSystem = state.campaignRuntime.itemSystem;
      if (itemSystem === undefined) {
        throw new TypeError("character item system is unavailable");
      }
      if (Object.values(state.combatRuntime.encounters).some((encounter) =>
        encounter.status !== "concluded"
        && Array.isArray(encounter.participantEntityIds)
        && encounter.participantEntityIds.includes(target.id))) {
        throw new TypeError("character gear cannot change during an active encounter");
      }
      const transition = changeItemEquipment(
            itemSystem,
            {
              holderRef: target.id,
              classId: target.classId,
              scores: {
                dex: target.abilityScores?.dex ?? 10,
                con: target.abilityScores?.con ?? 10,
              },
              speedFeet: target.loadout?.speedFeet ?? 30,
            },
            payload.action === "wear"
              ? { action: "wear", slot: payload.slot, entryId: payload.itemId }
              : { action: "stow", slot: payload.slot },
          );
      const movedItemId = "error" in transition ? undefined : transition.movedEntryId;
      if (
        "error" in transition
        || movedItemId !== payload.itemId
        || transition.loadout.armorClass !== payload.armorClass
      ) throw new TypeError("character gear transition does not match active loadout");
      state.campaignRuntime.itemSystem = transition.itemSystem;
      target.loadout = structuredClone(transition.loadout);

      const compiled = compileCanonicalCharacterCombat(
        target,
        transition.itemSystem,
        state.combatRuntime.definitions,
      );
      for (const definition of Object.values(compiled.definitions)) {
        const definitionId = String(definition.definitionId);
        const prior = state.combatRuntime.definitions[definitionId];
        if (!frozenAbilityMatches(definition, prior)) {
          throw new TypeError("character equipment ability is not frozen in the authoritative catalog");
        }
      }
      for (const abilityRef of compiled.abilityRefs) {
        if (compiled.definitions[abilityRef] !== undefined) continue;
        if (!isRegisteredAbilityRecord(state.combatRuntime.definitions[abilityRef])) {
          throw new TypeError("portable item ability is not frozen in the authoritative catalog");
        }
      }
      const combatEntity = state.combatRuntime.entities[payload.characterId];
      if (combatEntity !== undefined) {
        combatEntity.armorClass = String(transition.loadout.armorClass);
        combatEntity.speedInches = { walk: String(transition.loadout.speedFeet * 12) };
        combatEntity.abilityRefs = [...compiled.abilityRefs];
        synchronizeCombatItemResources(combatEntity, transition.itemSystem);
      }
      return true;
    }
    case "NpcGearChanged": {
      const payload = event.payload as EventPayloadByType["NpcGearChanged"];
      const target = state.entities[payload.characterId];
      const combatEntity = state.combatRuntime.entities[payload.characterId];
      const definition = isRecord(combatEntity)
        && isNonEmptyString(combatEntity.mechanicalDefinitionRef)
        ? state.combatRuntime.definitions[combatEntity.mechanicalDefinitionRef]
        : undefined;
      const activeEncounter = Object.values(state.combatRuntime.encounters).some((encounter) =>
        encounter.status !== "concluded"
        && Array.isArray(encounter.participantEntityIds)
        && encounter.participantEntityIds.includes(payload.characterId));
      if (!npcMechanicsProfileEnabled(event.profiles.extensions)
        || target?.kind !== "npc"
        || target.tenureStatus !== "active"
        || !isRecord(combatEntity)
        || !isNpcMechanicalTemplateDefinition(definition)
        || !isGearSlot(payload.slot)
        || activeEncounter) {
        throw new TypeError("NPC gear cannot be changed");
      }
      const itemSystem = state.campaignRuntime.itemSystem;
      if (itemSystem === undefined) {
        throw new TypeError("NPC item system is unavailable");
      }
      const transition = changeNpcItemSystemEquipment(
            itemSystem,
            target,
            definition,
            payload.action === "wear"
              ? { action: "wear", slot: payload.slot, entryId: payload.itemId }
              : { action: "stow", slot: payload.slot },
          );
      const expectedEquipmentAbilityRefs = "error" in transition ? [] : transition.equipment.refs;
      const movedItemId = "error" in transition ? undefined : transition.movedEntryId;
      if ("error" in transition
        || movedItemId !== payload.itemId
        || transition.loadout.armorClass !== payload.armorClass
        || canonicalSha256(expectedEquipmentAbilityRefs) !== canonicalSha256(payload.equipmentAbilityRefs)) {
        throw new TypeError("NPC gear transition does not match its authoritative mechanics");
      }
      const equipmentDefinitions = transition.equipment.definitions;
      for (const equipmentDefinition of equipmentDefinitions) {
        const abilityRef = String(equipmentDefinition.definitionId);
        const registered = state.combatRuntime.definitions[abilityRef];
        if (!isRegisteredAbilityRecord(registered)
          || registered.definitionHash !== canonicalSha256(equipmentDefinition)) {
          throw new TypeError("NPC equipment ability is not frozen in the authoritative catalog");
        }
      }

      const content = definition.content as JsonRecord;
      const intrinsicAbilityRefs = content.intrinsicAbilityRefs as string[];
      state.campaignRuntime.itemSystem = transition.itemSystem;
      target.loadout = structuredClone(transition.loadout);
      combatEntity.armorClass = String(transition.loadout.armorClass);
      combatEntity.equipmentAbilityRefs = [...payload.equipmentAbilityRefs];
      combatEntity.abilityRefs = [...new Set([
        ...intrinsicAbilityRefs,
        ...payload.equipmentAbilityRefs,
      ])].sort();
      synchronizeCombatItemResources(combatEntity, transition.itemSystem);
      return true;
    }
    case "NpcMechanicalItemStateChanged": {
      const payload = event.payload as EventPayloadByType["NpcMechanicalItemStateChanged"];
      const target = state.entities[payload.characterId];
      const combatEntity = state.combatRuntime.entities[payload.characterId];
      const definition = isRecord(combatEntity)
        && isNonEmptyString(combatEntity.mechanicalDefinitionRef)
        ? state.combatRuntime.definitions[combatEntity.mechanicalDefinitionRef]
        : undefined;
      if (!npcMechanicsProfileEnabled(event.profiles.extensions)
        || target?.kind !== "npc"
        || target.tenureStatus !== "active"
        || !isRecord(combatEntity)
        || !isNpcMechanicalTemplateDefinition(definition)) {
        throw new TypeError("NPC mechanical item state cannot be changed");
      }
      consumeNpcMechanicalItemStateCause(state, event, {
        actorCharacterId: payload.actorCharacterId,
        npcCharacterId: payload.characterId,
        itemId: payload.itemId,
        action: payload.action,
        causeFactRef: payload.causeFactRef,
      });
      const itemSystem = state.campaignRuntime.itemSystem;
      if (itemSystem === undefined) {
        throw new TypeError("NPC item system is unavailable");
      }
      const transition = changeNpcItemSystemLifecycle(
            itemSystem,
            target,
            definition,
            payload.itemId,
            payload.action,
          );
      const equipmentAbilityRefs = "error" in transition ? [] : transition.equipment.refs;
      if ("error" in transition
        || transition.loadout.armorClass !== payload.armorClass
        || canonicalSha256(equipmentAbilityRefs)
          !== canonicalSha256(payload.equipmentAbilityRefs)) {
        throw new TypeError("NPC mechanical item transition does not match authority state");
      }
      const equipmentDefinitions = transition.equipment.definitions;
      for (const equipmentDefinition of equipmentDefinitions) {
        const registered = state.combatRuntime.definitions[String(equipmentDefinition.definitionId)];
        if (!isRegisteredAbilityRecord(registered)
          || registered.definitionHash !== canonicalSha256(equipmentDefinition)) {
          throw new TypeError("remaining NPC equipment ability is not frozen");
        }
      }
      const intrinsicAbilityRefs = (definition.content as JsonRecord).intrinsicAbilityRefs as string[];
      state.campaignRuntime.itemSystem = transition.itemSystem;
      target.loadout = structuredClone(transition.loadout);
      combatEntity.armorClass = String(transition.loadout.armorClass);
      combatEntity.equipmentAbilityRefs = [...payload.equipmentAbilityRefs];
      combatEntity.abilityRefs = [...new Set([
        ...intrinsicAbilityRefs,
        ...payload.equipmentAbilityRefs,
      ])].sort();
      synchronizeCombatItemResources(combatEntity, transition.itemSystem);
      return true;
    }
    case "CharacterMechanicsSynchronized": {
      const payload = event.payload as EventPayloadByType["CharacterMechanicsSynchronized"];
      applyCharacterMechanicsSnapshot(
        state,
        payload.characterId,
        payload.combatEntity,
        payload.definitions,
      );
      return true;
    }
    case "CharacterControlRevoked": {
      const payload = event.payload as EventPayloadByType["CharacterControlRevoked"];
      if (state.characterControls[payload.characterId]?.seatId !== payload.seatId) {
        throw new TypeError("character control cannot be revoked");
      }
      delete state.characterControls[payload.characterId];
      return true;
    }
    case "HostTransferred": {
      const payload = event.payload as EventPayloadByType["HostTransferred"];
      const from = state.multiplayerRuntime.members[payload.fromPrincipalId];
      const to = state.multiplayerRuntime.members[payload.toPrincipalId];
      if (from?.role !== "host" || to?.status !== "active") throw new TypeError("host transfer is unavailable");
      from.role = "player";
      to.role = "host";
      state.multiplayerRuntime.hostPrincipalId = payload.toPrincipalId;
      return true;
    }
    case "PendingInputSuspended": {
      const payload = event.payload as EventPayloadByType["PendingInputSuspended"];
      const pending = state.pendingInputs[payload.pendingInputId];
      if (pending?.controllerCharacterId !== payload.controllerCharacterId) {
        throw new TypeError("pending input cannot be suspended");
      }
      state.multiplayerRuntime.suspendedPendingInputs[payload.pendingInputId] = structuredClone(pending);
      delete state.pendingInputs[payload.pendingInputId];
      return true;
    }
    case "PendingInputReassigned": {
      const payload = event.payload as EventPayloadByType["PendingInputReassigned"];
      const pending = state.pendingInputs[payload.pendingInputId];
      if (pending?.controllerCharacterId !== payload.controllerCharacterId
        || state.characterControls[payload.controllerCharacterId]?.seatId !== payload.toSeatId) {
        throw new TypeError("pending input cannot be reassigned");
      }
      return true;
    }
    case "PendingInputResumed": {
      const payload = event.payload as EventPayloadByType["PendingInputResumed"];
      const suspended = state.multiplayerRuntime.suspendedPendingInputs[payload.pendingInputId];
      if (
        !isRecord(suspended)
        || suspended.controllerCharacterId !== payload.controllerCharacterId
        || state.characterControls[payload.controllerCharacterId]?.seatId !== payload.seatId
        || state.seats[payload.seatId]?.status !== "active"
        || payload.pendingInputId in state.pendingInputs
      ) throw new TypeError("pending input cannot be resumed");
      state.pendingInputs[payload.pendingInputId] = structuredClone(
        suspended as unknown as AuthoritativeWorldState["pendingInputs"][string],
      );
      delete state.multiplayerRuntime.suspendedPendingInputs[payload.pendingInputId];
      return true;
    }
    case "PartyGroupCreated": {
      const payload = event.payload as EventPayloadByType["PartyGroupCreated"];
      if (payload.groupId in state.multiplayerRuntime.partyGroups) throw new TypeError("party group already exists");
      state.multiplayerRuntime.partyGroups[payload.groupId] = {
        groupId: payload.groupId,
        leaderCharacterId: payload.leaderCharacterId,
        memberCharacterIds: [...payload.memberCharacterIds],
        status: "active",
      };
      return true;
    }
    case "PartyMemberInvited": {
      const payload = event.payload as EventPayloadByType["PartyMemberInvited"];
      const group = state.multiplayerRuntime.partyGroups[payload.groupId];
      if (group === undefined || payload.pendingInputId in state.pendingInputs) throw new TypeError("party invitation unavailable");
      state.multiplayerRuntime.partyInvitations[payload.pendingInputId] = {
        ...structuredClone(payload),
        status: "pending",
      };
      state.pendingInputs[payload.pendingInputId] = {
        pendingInputId: payload.pendingInputId,
        kind: "partyInvitation",
        rootActionId: event.rootActionId,
        controllerCharacterId: payload.invitedCharacterId,
        question: "是否接受同行邀请？",
        openedByEventId: event.eventId,
        visibility: "private",
      };
      return true;
    }
    case "PartyInvitationAnswered": {
      const payload = event.payload as EventPayloadByType["PartyInvitationAnswered"];
      const pending = state.pendingInputs[payload.pendingInputId];
      const invitation = state.multiplayerRuntime.partyInvitations[payload.pendingInputId];
      if (pending?.controllerCharacterId !== payload.invitedCharacterId || invitation?.status !== "pending") {
        throw new TypeError("party invitation answer unavailable");
      }
      invitation.status = payload.accepted ? "accepted" : "declined";
      delete state.pendingInputs[payload.pendingInputId];
      return true;
    }
    case "PartyInvitationCancelled": {
      const payload = event.payload as EventPayloadByType["PartyInvitationCancelled"];
      const pending = state.pendingInputs[payload.pendingInputId];
      const invitation = state.multiplayerRuntime.partyInvitations[payload.pendingInputId];
      if (
        pending?.rootActionId !== payload.invitationRootActionId
        || pending.controllerCharacterId !== payload.invitedCharacterId
        || invitation?.status !== "pending"
        || invitation.groupId !== payload.groupId
        || invitation.inviterCharacterId !== payload.inviterCharacterId
        || invitation.invitedCharacterId !== payload.invitedCharacterId
      ) throw new TypeError("party invitation cancellation unavailable");
      invitation.status = "cancelled";
      delete state.pendingInputs[payload.pendingInputId];
      const invitationReceipt = state.receipts[payload.invitationRootActionId];
      if (invitationReceipt?.status === "awaitingInput") invitationReceipt.status = "superseded";
      return true;
    }
    case "PartyMemberJoined": {
      const payload = event.payload as EventPayloadByType["PartyMemberJoined"];
      const group = state.multiplayerRuntime.partyGroups[payload.groupId];
      if (group === undefined || !Array.isArray(group.memberCharacterIds)) throw new TypeError("party group unavailable");
      group.memberCharacterIds = [...new Set([...group.memberCharacterIds, payload.characterId])].sort();
      return true;
    }
    case "PartyMemberLeft": {
      const payload = event.payload as EventPayloadByType["PartyMemberLeft"];
      const group = state.multiplayerRuntime.partyGroups[payload.groupId];
      if (group === undefined || !Array.isArray(group.memberCharacterIds)
        || !group.memberCharacterIds.includes(payload.characterId)) throw new TypeError("party membership unavailable");
      const memberCharacterIds = group.memberCharacterIds as string[];
      group.memberCharacterIds = memberCharacterIds.filter((entry) => entry !== payload.characterId);
      if (group.leaderCharacterId === payload.characterId) group.leaderCharacterId = null;
      return true;
    }
    case "PartyLeaderTransferred": {
      const payload = event.payload as EventPayloadByType["PartyLeaderTransferred"];
      const group = state.multiplayerRuntime.partyGroups[payload.groupId];
      if (group?.leaderCharacterId !== payload.fromCharacterId
        || !Array.isArray(group.memberCharacterIds)
        || !group.memberCharacterIds.includes(payload.toCharacterId)) throw new TypeError("party leader transfer unavailable");
      group.leaderCharacterId = payload.toCharacterId;
      return true;
    }
    case "PartyGroupDisbanded": {
      const payload = event.payload as EventPayloadByType["PartyGroupDisbanded"];
      const group = state.multiplayerRuntime.partyGroups[payload.groupId];
      if (group === undefined || !Array.isArray(group.memberCharacterIds)) {
        throw new TypeError("party group unavailable");
      }
      group.status = "disbanded";
      return true;
    }
    case "PartyMoveProposed": {
      const payload = event.payload as EventPayloadByType["PartyMoveProposed"];
      if (payload.proposalId in state.multiplayerRuntime.partyMoveProposals) throw new TypeError("party move already proposed");
      state.multiplayerRuntime.partyMoveProposals[payload.proposalId] = {
        ...structuredClone(payload),
        acceptedCharacterIds: [payload.leaderCharacterId],
        declinedCharacterIds: [],
        status: "pending",
      };
      const nonLeaderMembers = payload.memberCharacterIds.filter((id) => id !== payload.leaderCharacterId);
      if (nonLeaderMembers.length !== payload.pendingInputIds.length) throw new TypeError("party move consent count mismatch");
      nonLeaderMembers.forEach((characterId, index) => {
        const pendingInputId = payload.pendingInputIds[index];
        state.pendingInputs[pendingInputId] = {
          pendingInputId,
          kind: "partyMoveConsent",
          rootActionId: event.rootActionId,
          controllerCharacterId: characterId,
          question: `是否同意整队前往 ${payload.destinationSceneId}？`,
          openedByEventId: event.eventId,
          visibility: "private",
        };
      });
      return true;
    }
    case "PartyMoveConsentRecorded": {
      const payload = event.payload as EventPayloadByType["PartyMoveConsentRecorded"];
      const pending = state.pendingInputs[payload.pendingInputId];
      const proposal = state.multiplayerRuntime.partyMoveProposals[payload.proposalId];
      if (pending?.controllerCharacterId !== payload.characterId || proposal?.status !== "pending") {
        throw new TypeError("party move consent unavailable");
      }
      delete state.pendingInputs[payload.pendingInputId];
      const key = payload.accepted ? "acceptedCharacterIds" : "declinedCharacterIds";
      const entries = Array.isArray(proposal[key]) ? proposal[key] as string[] : [];
      proposal[key] = [...new Set([...entries, payload.characterId])].sort();
      if (!payload.accepted) proposal.status = "declined";
      return true;
    }
    case "PartyMoved": {
      const payload = event.payload as EventPayloadByType["PartyMoved"];
      const proposal = state.multiplayerRuntime.partyMoveProposals[payload.proposalId];
      const acceptedCharacterIds = Array.isArray(proposal?.acceptedCharacterIds)
        ? proposal.acceptedCharacterIds as string[]
        : undefined;
      if (proposal?.status !== "pending"
        || acceptedCharacterIds === undefined
        || !payload.memberCharacterIds.every((id) => acceptedCharacterIds.includes(id))) {
        throw new TypeError("party move lacks unanimous consent");
      }
      applyMovement(state, event.eventId, payload.memberCharacterIds, payload.destinationSceneId, payload);
      proposal.status = "committed";
      return true;
    }
    case "CharacterMoved": {
      const payload = event.payload as EventPayloadByType["CharacterMoved"];
      applyMovement(state, event.eventId, [payload.characterId], payload.destinationSceneId, payload);
      return true;
    }
    case "FictionTimelinesMet": {
      const payload = event.payload as EventPayloadByType["FictionTimelinesMet"];
      if (payload.characterIds.some((characterId) =>
        state.entities[characterId]?.sceneId !== payload.sceneId
        || !payload.sourceTimelineIds.includes(
          state.multiplayerRuntime.characterTimelineIds[characterId],
        ))) throw new TypeError("meeting participants left the frozen causal frontiers");
      state.fictionTimelines[payload.meetingTimelineId] = {
        branchId: state.activeBranchId,
        nowMicros: payload.meetingMicros,
      };
      for (const characterId of payload.characterIds) {
        state.multiplayerRuntime.characterTimelineIds[characterId] = payload.meetingTimelineId;
      }
      state.multiplayerRuntime.causalFrontiers[payload.meetingTimelineId] = {
        timelineId: payload.meetingTimelineId,
        sceneId: payload.sceneId,
        branchId: state.activeBranchId,
        nowMicros: payload.meetingMicros,
        eventHeadId: event.eventId,
        causalParentTimelineIds: [...payload.sourceTimelineIds],
      };
      return true;
    }
    case "CausalFrontierPropagated": {
      const payload = event.payload as EventPayloadByType["CausalFrontierPropagated"];
      const source = state.multiplayerRuntime.causalFrontiers[payload.sourceTimelineId];
      const target = state.multiplayerRuntime.causalFrontiers[payload.targetTimelineId];
      if (source?.eventHeadId !== payload.sourceEventHeadId
        || target === undefined
        || !(payload.mediumFactId in state.canonicalFacts)
        || BigInt(String(target.nowMicros)) < BigInt(payload.arrivalMicros)) {
        throw new TypeError("causal propagation is not available at the target frontier");
      }
      const received = Array.isArray(target.receivedFromTimelineIds)
        ? target.receivedFromTimelineIds.filter(isNonEmptyString)
        : [];
      target.receivedFromTimelineIds = [...new Set([...received, payload.sourceTimelineId])].sort();
      target.lastPropagationEventId = event.eventId;
      return true;
    }
    default:
      return false;
  }
}
