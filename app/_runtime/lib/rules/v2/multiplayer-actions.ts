import type { RuntimeProfileManifest } from "../profiles/types";
import { createEventTransition, createScopeProof } from "./events";
import type {
  AuthoritativeWorldState,
  CharacterRecord,
  EventEnvelope,
  EventPayloadByType,
  EventType,
  JsonRecord,
  PublicReceipt,
  ScopeProof,
  StepResult,
} from "./model";
import { rejected } from "./results";
import {
  hasExactKeys,
  hasOnlyKeys,
  isCharacterLoadout,
  isNonEmptyString,
  isRecord,
  isSha256,
} from "./validation";
import { movementPlan } from "./timeline";
import { isContinuedCompoundRoot } from "./internal-compound";
import {
  buildPlayerCombatEntity,
  compileStaticCharacterCombat,
} from "./character-abilities";
import { changeCharacterGear, isGearSlot } from "./character-gear";
import { allocateDynamicCombatantSpawn } from "./spatial-spawn";

type Draft = {
  eventType: EventType;
  payload: EventPayloadByType[EventType];
  reads?: string[];
  writes?: string[];
  creates?: string[];
  visibilityPolicyId?: string;
  secrecy?: EventEnvelope["secrecy"];
};

function compoundRootAvailable(
  state: AuthoritativeWorldState,
  input: JsonRecord,
): input is JsonRecord & { rootActionId: string } {
  return isNonEmptyString(input.rootActionId)
    && (!(input.rootActionId in state.receipts) || isContinuedCompoundRoot(input, input.rootActionId));
}

function sequence(
  profiles: RuntimeProfileManifest,
  source: AuthoritativeWorldState,
  rootActionId: string,
  drafts: Draft[],
  kind: "committed" | "awaitingInput" = "committed",
  additions: JsonRecord = {},
): StepResult {
  let state = source;
  const events: EventEnvelope[] = [];
  let receipt: PublicReceipt | undefined;
  let scopeProof: ScopeProof | undefined;
  for (const draft of drafts) {
    scopeProof = createScopeProof(
      state,
      draft.reads ?? [],
      draft.writes ?? [`receipt:${rootActionId}`],
      draft.creates ?? [],
    );
    const transition = createEventTransition(state, profiles, {
      rootActionId,
      eventType: draft.eventType,
      payload: draft.payload,
      scopeProof,
      visibilityPolicyId: draft.visibilityPolicyId ?? "visibility:public-room-membership",
      secrecy: draft.secrecy ?? "public",
    });
    events.push(transition.event);
    state = transition.state;
    receipt = transition.receipt;
  }
  return {
    kind,
    events,
    state,
    cache: state,
    stateHash: events[events.length - 1].stateHashAfter,
    scopeProof: scopeProof!,
    receipt: receipt!,
    ...additions,
  } as StepResult;
}

function canonicalStringList(value: unknown): string[] | undefined {
  return Array.isArray(value)
    && value.every(isNonEmptyString)
    && value.length === new Set(value).size
    ? [...value].sort()
    : undefined;
}

export function canonicalControlledCharacter(value: unknown, ordinal: string): CharacterRecord | undefined {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ["id", "kind", "name", "sceneId", "tenureStatus"], [
      "abilityScores",
      "cantripIds",
      "characterBuild",
      "classId",
      "featureIds",
      "hitPoints",
      "lastLongRestCompletedAtMicros",
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
    || !isNonEmptyString(value.id)
    || value.kind !== "player"
    || !isNonEmptyString(value.name)
    || !isNonEmptyString(value.sceneId)
    || value.tenureStatus !== "active"
    || (value.level !== undefined
      && (!Number.isSafeInteger(value.level) || Number(value.level) <= 0))
    || (value.lastLongRestCompletedAtMicros !== undefined
      && (typeof value.lastLongRestCompletedAtMicros !== "string"
        || !/^(0|[1-9][0-9]*)$/.test(value.lastLongRestCompletedAtMicros)))
    || (value.hitPoints !== undefined
      && (!isRecord(value.hitPoints)
        || !hasExactKeys(value.hitPoints, ["current", "maximum"])
        || !Number.isSafeInteger(value.hitPoints.current)
        || !Number.isSafeInteger(value.hitPoints.maximum)
        || Number(value.hitPoints.current) < 0
        || Number(value.hitPoints.maximum) <= 0
        || Number(value.hitPoints.current) > Number(value.hitPoints.maximum)))
    || (value.resources !== undefined
      && (!isRecord(value.resources)
        || !Object.entries(value.resources).every(([resourceId, amount]) =>
          isNonEmptyString(resourceId)
          && Number.isSafeInteger(amount)
          && Number(amount) >= 0)))
    || (value.resourceMaximums !== undefined
      && (!isRecord(value.resourceMaximums)
        || !Object.entries(value.resourceMaximums).every(([resourceId, amount]) =>
          isNonEmptyString(resourceId)
          && Number.isSafeInteger(amount)
          && Number(amount) >= 0)))
    || (value.abilityScores !== undefined
      && (!isRecord(value.abilityScores)
        || !hasExactKeys(value.abilityScores, ["cha", "con", "dex", "int", "str", "wis"])
        || !Object.values(value.abilityScores).every((score) =>
          Number.isSafeInteger(score) && Number(score) >= 1 && Number(score) <= 30)))
    || (value.proficiencyBonus !== undefined
      && (!Number.isSafeInteger(value.proficiencyBonus)
        || Number(value.proficiencyBonus) < 0
        || Number(value.proficiencyBonus) > 12))
    || (value.proficientSkills !== undefined
      && (!Array.isArray(value.proficientSkills)
        || !value.proficientSkills.every(isNonEmptyString)
        || value.proficientSkills.length !== new Set(value.proficientSkills).size))
    || (value.loadout !== undefined && !isCharacterLoadout(value.loadout))
    || ([value.classId, value.raceId, value.subclassId]
      .some((entry) => entry !== undefined && !isNonEmptyString(entry)))
    || ([value.cantripIds, value.preparedSpellIds, value.featureIds]
      .some((entry) => entry !== undefined && canonicalStringList(entry) === undefined))
  ) return undefined;
  return {
    id: value.id,
    kind: "player",
    name: value.name,
    sceneId: value.sceneId,
    tenureStatus: "active",
    entityOrdinal: ordinal,
    ...(value.level === undefined ? {} : { level: Number(value.level) }),
    ...(value.lastLongRestCompletedAtMicros === undefined
      ? {}
      : { lastLongRestCompletedAtMicros: value.lastLongRestCompletedAtMicros as string }),
    ...(value.hitPoints === undefined
      ? {}
      : { hitPoints: structuredClone(value.hitPoints) as CharacterRecord["hitPoints"] }),
    ...(value.resources === undefined
      ? {}
      : { resources: structuredClone(value.resources) as Record<string, number> }),
    ...(value.resourceMaximums === undefined
      ? {}
      : { resourceMaximums: structuredClone(value.resourceMaximums) as Record<string, number> }),
    ...(value.abilityScores === undefined
      ? {}
      : { abilityScores: structuredClone(value.abilityScores) as Record<string, number> }),
    ...(value.proficiencyBonus === undefined
      ? {}
      : { proficiencyBonus: Number(value.proficiencyBonus) }),
    ...(value.proficientSkills === undefined
      ? {}
      : { proficientSkills: [...value.proficientSkills].sort() }),
    ...(value.classId === undefined ? {} : { classId: value.classId as string }),
    ...(value.raceId === undefined ? {} : { raceId: value.raceId as string }),
    ...(value.subclassId === undefined ? {} : { subclassId: value.subclassId as string }),
    ...(value.cantripIds === undefined ? {} : { cantripIds: canonicalStringList(value.cantripIds)! }),
    ...(value.preparedSpellIds === undefined
      ? {}
      : { preparedSpellIds: canonicalStringList(value.preparedSpellIds)! }),
    ...(value.featureIds === undefined ? {} : { featureIds: canonicalStringList(value.featureIds)! }),
    ...(value.loadout === undefined
      ? {}
      : { loadout: structuredClone(value.loadout) }),
  };
}

function grantSeat(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  command: JsonRecord,
): StepResult {
  const commandPrincipalId = isRecord(command.principal) && isNonEmptyString(command.principal.id)
    ? command.principal.id
    : undefined;
  const existingMember = commandPrincipalId === undefined
    ? undefined
    : state.multiplayerRuntime.members[commandPrincipalId];
  const existingSeat = isNonEmptyString(command.seatId) ? state.seats[command.seatId] : undefined;
  const reactivating = existingMember !== undefined
    && existingMember.status !== "active"
    && existingSeat !== undefined
    && existingSeat.principalId === commandPrincipalId
    && existingSeat.status === "inactive";
  if (
    !hasOnlyKeys(command, ["kind", "principal", "role", "seatId"], ["character"])
    || !isRecord(command.principal)
    || !hasExactKeys(command.principal, ["id", "sessionVersion"])
    || !isNonEmptyString(command.principal.id)
    || !Number.isSafeInteger(command.principal.sessionVersion)
    || Number(command.principal.sessionVersion) <= 0
    || !["player", "observer"].includes(String(command.role))
    || !isNonEmptyString(command.seatId)
    || existingMember?.status === "active"
    || (existingSeat !== undefined && !reactivating)
  ) return rejected("invalidRulesInput", "Seat grant command is not canonical or references an active member.");
  const nextOrdinal = String(
    Object.values(state.entities).reduce((maximum, entity) =>
      Math.max(maximum, Number(entity.entityOrdinal)), 0) + 1,
  );
  const character = command.character === undefined
    ? undefined
    : canonicalControlledCharacter(command.character, nextOrdinal);
  const existingCharacter = character === undefined ? undefined : state.entities[character.id];
  const restoringCharacter = existingCharacter !== undefined
    && existingCharacter.kind === "player"
    && existingCharacter.tenureStatus === "active"
    && existingCharacter.name === character?.name
    && existingCharacter.sceneId === character?.sceneId
    && state.characterControls[existingCharacter.id] === undefined;
  if (
    (command.character !== undefined && character === undefined)
    || (character !== undefined
      && (!(character.sceneId in state.scenes)
        || (existingCharacter !== undefined && !restoringCharacter)))
  ) return rejected("invalidRulesInput", "Controlled character seed is unavailable.");
  const principal = {
    id: command.principal.id,
    sessionVersion: Number(command.principal.sessionVersion),
  };
  const drafts: Draft[] = [
    {
      eventType: "MemberJoined",
      payload: { principal, role: command.role as "player" | "observer" },
      creates: [`member:${principal.id}`],
    },
    {
      eventType: reactivating ? "SeatReactivated" : "SeatGranted",
      payload: reactivating
        ? { seatId: command.seatId, principalId: principal.id }
        : { seat: { id: command.seatId, principalId: principal.id, status: "active" } },
      ...(reactivating ? {} : { creates: [`seat:${command.seatId}`] }),
    },
  ];
  if (character !== undefined) {
    drafts.push({
      eventType: "CharacterControlGranted",
      payload: {
        character: restoringCharacter ? null : character,
        characterId: character.id,
        seatId: command.seatId,
      },
      creates: restoringCharacter
        ? [`control:${character.id}`]
        : [`entity:${character.id}`, `control:${character.id}`],
    });
    if (!restoringCharacter) {
      const compiled = compileStaticCharacterCombat(
        character,
        isRecord(command.character) ? command.character.characterBuild : undefined,
      );
      const spawn = allocateDynamicCombatantSpawn(state, character.sceneId);
      if (spawn.kind === "unavailable") {
        return rejected(
          "spatialCapacityUnavailable",
          "The pinned tactical scene has no available character spawn.",
        );
      }
      const combatEntity = buildPlayerCombatEntity(
        character,
        compiled,
        principal.id,
        spawn.kind === "allocated" ? spawn.position : undefined,
      );
      drafts.push({
        eventType: "CharacterMechanicsSynchronized",
        payload: {
          characterId: character.id,
          combatEntity,
          definitions: Object.values(compiled.definitions)
            .sort((left, right) => String(left.definitionId).localeCompare(String(right.definitionId))),
        },
        creates: [`combat-entity:${character.id}`],
      });
    }
    if (restoringCharacter) {
      for (const suspended of Object.values(state.multiplayerRuntime.suspendedPendingInputs)
        .filter((entry) => entry.controllerCharacterId === character.id)
        .sort((left, right) => String(left.pendingInputId).localeCompare(String(right.pendingInputId)))) {
        if (!isNonEmptyString(suspended.pendingInputId)) continue;
        drafts.push({
          eventType: "PendingInputResumed",
          payload: {
            pendingInputId: suspended.pendingInputId,
            controllerCharacterId: character.id,
            seatId: command.seatId,
          },
          visibilityPolicyId: "visibility:room-authority-only",
          secrecy: "internal",
        });
      }
    }
  }
  return sequence(profiles, state, rootActionId, drafts);
}

function materializeCharacter(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  command: JsonRecord,
): StepResult {
  if (
    !hasExactKeys(command, ["character", "kind", "principalId", "seatId"])
    || !isNonEmptyString(command.principalId)
    || !isNonEmptyString(command.seatId)
    || state.multiplayerRuntime.members[command.principalId]?.status !== "active"
    || state.seats[command.seatId]?.principalId !== command.principalId
    || state.seats[command.seatId]?.status !== "active"
  ) return rejected("invalidRulesInput", "Character materialization command is not canonical.");
  const nextOrdinal = String(
    Object.values(state.entities).reduce((maximum, entity) =>
      Math.max(maximum, Number(entity.entityOrdinal)), 0) + 1,
  );
  const character = canonicalControlledCharacter(command.character, nextOrdinal);
  if (
    character === undefined
    || character.id in state.entities
    || character.id in state.characterControls
    || !(character.sceneId in state.scenes)
  ) return rejected("targetSeatUnavailable", "Character cannot be materialized for the target Seat.");
  const build = isRecord(command.character) ? command.character.characterBuild : undefined;
  const compiled = compileStaticCharacterCombat(character, build);
  const spawn = allocateDynamicCombatantSpawn(state, character.sceneId);
  if (spawn.kind === "unavailable") {
    return rejected(
      "spatialCapacityUnavailable",
      "The pinned tactical scene has no available character spawn.",
    );
  }
  const combatEntity = buildPlayerCombatEntity(
    character,
    compiled,
    command.principalId as string,
    spawn.kind === "allocated" ? spawn.position : undefined,
  );
  return sequence(profiles, state, rootActionId, [
    {
      eventType: "CharacterControlGranted",
      payload: { character, characterId: character.id, seatId: command.seatId },
      creates: [`entity:${character.id}`, `control:${character.id}`],
    },
    {
      eventType: "CharacterMechanicsSynchronized",
      payload: {
        characterId: character.id,
        combatEntity,
        definitions: Object.values(compiled.definitions)
          .sort((left, right) => String(left.definitionId).localeCompare(String(right.definitionId))),
      },
      creates: [`combat-entity:${character.id}`],
    },
  ]);
}

function changeControlledCharacterGear(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  const expectedKeys = input.action === "wear"
    ? ["action", "actorCharacterId", "controllerPrincipalId", "itemId", "kind", "rootActionId", "slot"]
    : ["action", "actorCharacterId", "controllerPrincipalId", "kind", "rootActionId", "slot"];
  if (
    !hasExactKeys(input, expectedKeys)
    || (input.action !== "wear" && input.action !== "stow")
    || !isNonEmptyString(input.actorCharacterId)
    || !isNonEmptyString(input.controllerPrincipalId)
    || !isNonEmptyString(input.rootActionId)
    || !isGearSlot(input.slot)
    || (input.action === "wear" && !isNonEmptyString(input.itemId))
  ) return rejected("invalidRulesInput", "Character gear action is not canonical.");
  if (input.rootActionId in state.receipts) {
    return rejected("duplicateRootAction", "Character gear root action is already used.");
  }
  const character = state.entities[input.actorCharacterId];
  const control = state.characterControls[input.actorCharacterId];
  const seat = control === undefined ? undefined : state.seats[control.seatId];
  if (
    character?.kind !== "player"
    || character.tenureStatus !== "active"
    || seat?.status !== "active"
    || seat.principalId !== input.controllerPrincipalId
    || state.multiplayerRuntime.members[input.controllerPrincipalId]?.status !== "active"
  ) return rejected("targetSeatUnavailable", "Character gear controller is unavailable.");
  const transition = changeCharacterGear(
    character,
    input.action === "wear"
      ? { action: "wear", slot: input.slot, itemId: input.itemId as string }
      : { action: "stow", slot: input.slot },
  );
  if ("error" in transition) {
    return rejected(
      transition.error === "unchangedGear" ? "unchangedRetry" : "insufficientResource",
      "The requested item cannot be moved from the current authoritative loadout.",
    );
  }
  return sequence(profiles, state, input.rootActionId, [{
    eventType: "CharacterGearChanged",
    payload: {
      characterId: character.id,
      action: input.action,
      slot: input.slot,
      itemId: transition.movedItemId,
      armorClass: transition.loadout.armorClass,
    },
    reads: [`entity:${character.id}`, `control:${character.id}`],
    writes: [`entity:${character.id}`, `combat-entity:${character.id}`],
  }]);
}

function removalDrafts(
  state: AuthoritativeWorldState,
  principalId: string,
  reason: string,
  finalEvent: "MemberRemoved" | "MemberDeparted",
  allowHostTransition = false,
): Draft[] | undefined {
  const member = state.multiplayerRuntime.members[principalId];
  if (
    member?.status !== "active"
    || (member.role === "host" && !allowHostTransition)
  ) return undefined;
  const seats = Object.values(state.seats)
    .filter((seat) => seat.principalId === principalId && seat.status === "active")
    .sort((left, right) => left.id.localeCompare(right.id));
  if (seats.length === 0) return undefined;
  const drafts: Draft[] = [];
  for (const seat of seats) {
    const controls = Object.values(state.characterControls)
      .filter((control) => control.seatId === seat.id)
      .sort((left, right) => left.characterId.localeCompare(right.characterId));
    for (const control of controls) {
      drafts.push({
        eventType: "CharacterControlRevoked",
        payload: { characterId: control.characterId, seatId: seat.id, reason },
        writes: [`control:${control.characterId}`],
      });
      for (const pending of Object.values(state.pendingInputs)
        .filter((entry) => entry.controllerCharacterId === control.characterId)
        .sort((left, right) => left.pendingInputId.localeCompare(right.pendingInputId))) {
        drafts.push({
          eventType: "PendingInputSuspended",
          payload: {
            pendingInputId: pending.pendingInputId,
            controllerCharacterId: control.characterId,
            reason,
          },
          visibilityPolicyId: "visibility:room-authority-only",
          secrecy: "internal",
          writes: [`pending:${pending.pendingInputId}`],
        });
      }
    }
    drafts.push({
      eventType: "SeatVacated",
      payload: { seatId: seat.id, principalId, reason },
      writes: [`seat:${seat.id}`],
    });
  }
  drafts.push({
    eventType: finalEvent,
    payload: { principalId, reason },
    writes: [`member:${principalId}`],
  });
  return drafts;
}

function revokeControlDrafts(
  state: AuthoritativeWorldState,
  characterId: string,
  seatId: string,
  reason: string,
): Draft[] | undefined {
  if (state.characterControls[characterId]?.seatId !== seatId) return undefined;
  const drafts: Draft[] = [{
    eventType: "CharacterControlRevoked",
    payload: { characterId, seatId, reason },
    writes: [`control:${characterId}`],
  }];
  for (const pending of Object.values(state.pendingInputs)
    .filter((entry) => entry.controllerCharacterId === characterId)
    .sort((left, right) => left.pendingInputId.localeCompare(right.pendingInputId))) {
    drafts.push({
      eventType: "PendingInputSuspended",
      payload: { pendingInputId: pending.pendingInputId, controllerCharacterId: characterId, reason },
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
      writes: [`pending:${pending.pendingInputId}`],
    });
  }
  return drafts;
}

function activeGroupForCharacter(state: AuthoritativeWorldState, characterId: string): JsonRecord | undefined {
  return Object.values(state.multiplayerRuntime.partyGroups).find((group) =>
    group.status === "active"
    && Array.isArray(group.memberCharacterIds)
    && group.memberCharacterIds.includes(characterId));
}

export function partyDepartureEvents(
  state: AuthoritativeWorldState,
  characterId: string,
  reason: string,
): Draft[] {
  const group = activeGroupForCharacter(state, characterId);
  if (group === undefined || !Array.isArray(group.memberCharacterIds)) return [];
  const memberCharacterIds = group.memberCharacterIds.filter(isNonEmptyString).sort();
  const remaining = memberCharacterIds.filter((id) => id !== characterId);
  const drafts: Draft[] = [];
  if (group.leaderCharacterId === characterId && remaining.length > 0) {
    drafts.push({
      eventType: "PartyLeaderTransferred",
      payload: {
        groupId: group.groupId as string,
        fromCharacterId: characterId,
        toCharacterId: remaining[0],
      },
    });
  }
  drafts.push({
    eventType: "PartyMemberLeft",
    payload: { groupId: group.groupId as string, characterId, reason },
  });
  if (remaining.length === 0) {
    drafts.push({
      eventType: "PartyGroupDisbanded",
      payload: { groupId: group.groupId as string, reason },
    });
  }
  return drafts;
}

function invitePartyMember(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, ["invitedCharacterId", "inviterCharacterId", "kind", "rootActionId"])
    || !compoundRootAvailable(state, input)
    || !isNonEmptyString(input.inviterCharacterId)
    || !isNonEmptyString(input.invitedCharacterId)) {
    return rejected("invalidRulesInput", "Party invitation input is not canonical.");
  }
  const inviter = state.entities[input.inviterCharacterId];
  const invited = state.entities[input.invitedCharacterId];
  if (
    inviter?.tenureStatus !== "active"
    || invited?.tenureStatus !== "active"
    || inviter.kind !== "player"
    || invited.kind !== "player"
    || inviter.sceneId !== invited.sceneId
    || state.characterControls[inviter.id] === undefined
    || state.characterControls[invited.id] === undefined
    || activeGroupForCharacter(state, invited.id) !== undefined
  ) return rejected("privateOrUnknownReference", "Party invitation participants are unavailable.");
  const existing = activeGroupForCharacter(state, inviter.id);
  if (existing !== undefined && existing.leaderCharacterId !== inviter.id) {
    return rejected("privateOrUnknownReference", "Only the current PartyGroup leader may invite a member.");
  }
  const groupId = existing === undefined ? `party:${input.rootActionId}` : String(existing.groupId);
  const pendingInputId = `pending:party-invitation:${input.rootActionId}:${invited.id}`;
  const drafts: Draft[] = [];
  if (existing === undefined) {
    drafts.push({
      eventType: "PartyGroupCreated",
      payload: { groupId, leaderCharacterId: inviter.id, memberCharacterIds: [inviter.id] },
      creates: [`party:${groupId}`],
    });
  }
  drafts.push({
    eventType: "PartyMemberInvited",
    payload: {
      groupId,
      inviterCharacterId: inviter.id,
      invitedCharacterId: invited.id,
      pendingInputId,
    },
    visibilityPolicyId: `visibility:character-controller:${invited.id}`,
    secrecy: "private",
    creates: [`pending:${pendingInputId}`],
  });
  return sequence(profiles, state, input.rootActionId, drafts, "awaitingInput", {
    pending: {
      pendingInputId,
      kind: "partyInvitation",
      question: "是否接受同行邀请？",
      controller: { kind: "character", characterId: invited.id },
    },
  });
}

function answerPartyInvitation(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, ["accept", "controllerCharacterId", "kind", "pendingInputId", "rootActionId"])
    || typeof input.accept !== "boolean"
    || !isNonEmptyString(input.controllerCharacterId)
    || !isNonEmptyString(input.pendingInputId)
    || !isNonEmptyString(input.rootActionId)) {
    return rejected("invalidRulesInput", "Party invitation answer is not canonical.");
  }
  const pending = state.pendingInputs[input.pendingInputId];
  const invitation = state.multiplayerRuntime.partyInvitations[input.pendingInputId];
  if (
    pending?.kind !== "partyInvitation"
    || pending.rootActionId !== input.rootActionId
    || pending.controllerCharacterId !== input.controllerCharacterId
    || state.receipts[input.rootActionId]?.status !== "awaitingInput"
    || invitation?.status !== "pending"
    || invitation.invitedCharacterId !== input.controllerCharacterId
  ) return rejected("privateOrUnknownReference", "Party invitation answer reference is unavailable.");
  const drafts: Draft[] = [{
    eventType: "PartyInvitationAnswered",
    payload: {
      groupId: invitation.groupId as string,
      invitedCharacterId: input.controllerCharacterId,
      pendingInputId: input.pendingInputId,
      accepted: input.accept,
    },
    visibilityPolicyId: `visibility:character-controller:${input.controllerCharacterId}`,
    secrecy: "private",
  }];
  if (input.accept) {
    drafts.push({
      eventType: "PartyMemberJoined",
      payload: { groupId: invitation.groupId as string, characterId: input.controllerCharacterId },
    });
  } else {
    const group = state.multiplayerRuntime.partyGroups[String(invitation.groupId)];
    if (Array.isArray(group?.memberCharacterIds) && group.memberCharacterIds.length === 1) {
      drafts.push({
        eventType: "PartyGroupDisbanded",
        payload: { groupId: invitation.groupId as string, reason: "invitationDeclined" },
      });
    }
  }
  return sequence(profiles, state, input.rootActionId, drafts);
}

function cancelPartyInvitation(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (
    !hasExactKeys(input, ["inviterCharacterId", "kind", "pendingInputId", "rootActionId"])
    || !compoundRootAvailable(state, input)
    || !isNonEmptyString(input.pendingInputId)
    || !isNonEmptyString(input.inviterCharacterId)
  ) return rejected("invalidRulesInput", "Party invitation cancellation is not canonical.");
  const pending = state.pendingInputs[input.pendingInputId];
  const invitation = state.multiplayerRuntime.partyInvitations[input.pendingInputId];
  if (
    pending?.kind !== "partyInvitation"
    || invitation?.status !== "pending"
    || invitation.inviterCharacterId !== input.inviterCharacterId
    || state.characterControls[input.inviterCharacterId] === undefined
    || !isNonEmptyString(invitation.groupId)
    || !isNonEmptyString(invitation.invitedCharacterId)
  ) return rejected("privateOrUnknownReference", "Party invitation cancellation is unavailable.");
  const drafts: Draft[] = [{
    eventType: "PartyInvitationCancelled",
    payload: {
      groupId: invitation.groupId,
      inviterCharacterId: input.inviterCharacterId,
      invitedCharacterId: invitation.invitedCharacterId,
      pendingInputId: input.pendingInputId,
      invitationRootActionId: pending.rootActionId,
    },
  }];
  const group = state.multiplayerRuntime.partyGroups[invitation.groupId];
  const otherPending = Object.entries(state.multiplayerRuntime.partyInvitations)
    .some(([pendingInputId, candidate]) =>
      pendingInputId !== input.pendingInputId
      && candidate.status === "pending"
      && candidate.groupId === invitation.groupId);
  if (
    Array.isArray(group?.memberCharacterIds)
    && group.memberCharacterIds.length === 1
    && !otherPending
  ) {
    drafts.push({
      eventType: "PartyGroupDisbanded",
      payload: { groupId: invitation.groupId, reason: "invitationCancelled" },
    });
  }
  return sequence(profiles, state, input.rootActionId, drafts);
}

function proposePartyMove(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, [
    "destinationSceneId",
    "fictionTimeCostMicros",
    "kind",
    "leaderCharacterId",
    "rootActionId",
  ])
    || !compoundRootAvailable(state, input)
    || !isNonEmptyString(input.leaderCharacterId)
    || !isNonEmptyString(input.destinationSceneId)
    || typeof input.fictionTimeCostMicros !== "string") {
    return rejected("invalidRulesInput", "Party move proposal is not canonical.");
  }
  const group = activeGroupForCharacter(state, input.leaderCharacterId);
  if (group?.leaderCharacterId !== input.leaderCharacterId || !Array.isArray(group.memberCharacterIds)) {
    return rejected("privateOrUnknownReference", "PartyGroup leader reference is unavailable.");
  }
  const memberCharacterIds = [...group.memberCharacterIds].filter(isNonEmptyString).sort();
  if (memberCharacterIds.length < 2
    || memberCharacterIds.some((characterId) => state.characterControls[characterId] === undefined)
    || new Set(memberCharacterIds.map((characterId) => state.entities[characterId]?.sceneId)).size !== 1) {
    return rejected("privateOrUnknownReference", "Party members are no longer co-located and controlled.");
  }
  const plan = movementPlan(
    state,
    memberCharacterIds,
    input.destinationSceneId,
    input.fictionTimeCostMicros,
  );
  if (plan === undefined) return rejected("privateOrUnknownReference", "Party movement conflicts with a causal frontier.");
  const nonLeaderMembers = memberCharacterIds.filter((id) => id !== input.leaderCharacterId);
  const pendingInputIds = nonLeaderMembers
    .map((characterId) => `pending:party-move:${input.rootActionId}:${characterId}`)
    .sort();
  const proposalId = `party-move:${input.rootActionId}`;
  const firstController = nonLeaderMembers
    .map((characterId) => ({ characterId, pendingInputId: `pending:party-move:${input.rootActionId}:${characterId}` }))
    .sort((left, right) => left.pendingInputId.localeCompare(right.pendingInputId))[0];
  return sequence(profiles, state, input.rootActionId, [{
    eventType: "PartyMoveProposed",
    payload: {
      proposalId,
      groupId: group.groupId as string,
      leaderCharacterId: input.leaderCharacterId,
      memberCharacterIds,
      destinationSceneId: input.destinationSceneId,
      fictionTimeCostMicros: input.fictionTimeCostMicros,
      ...plan,
      pendingInputIds,
    },
    creates: [`party-move:${proposalId}`, ...pendingInputIds.map((id) => `pending:${id}`)],
  }], "awaitingInput", {
    pending: {
      pendingInputId: firstController.pendingInputId,
      kind: "partyMoveConsent",
      question: `是否同意整队前往 ${input.destinationSceneId}？`,
      controller: { kind: "character", characterId: firstController.characterId },
    },
  });
}

function answerPartyMove(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, ["accept", "controllerCharacterId", "kind", "pendingInputId", "rootActionId"])
    || typeof input.accept !== "boolean"
    || !isNonEmptyString(input.controllerCharacterId)
    || !isNonEmptyString(input.pendingInputId)
    || !isNonEmptyString(input.rootActionId)) {
    return rejected("invalidRulesInput", "Party move answer is not canonical.");
  }
  const pending = state.pendingInputs[input.pendingInputId];
  const proposal = Object.values(state.multiplayerRuntime.partyMoveProposals)
    .find((entry) => entry.status === "pending"
      && Array.isArray(entry.pendingInputIds)
      && entry.pendingInputIds.includes(input.pendingInputId));
  if (
    pending?.kind !== "partyMoveConsent"
    || pending.rootActionId !== input.rootActionId
    || pending.controllerCharacterId !== input.controllerCharacterId
    || state.receipts[input.rootActionId]?.status !== "awaitingInput"
    || proposal === undefined
    || !Array.isArray(proposal.memberCharacterIds)
    || !Array.isArray(proposal.acceptedCharacterIds)
  ) return rejected("privateOrUnknownReference", "Party move consent reference is unavailable.");
  const drafts: Draft[] = [{
    eventType: "PartyMoveConsentRecorded",
    payload: {
      proposalId: proposal.proposalId as string,
      groupId: proposal.groupId as string,
      characterId: input.controllerCharacterId,
      pendingInputId: input.pendingInputId,
      accepted: input.accept,
    },
    visibilityPolicyId: `visibility:character-controller:${input.controllerCharacterId}`,
    secrecy: "private",
  }];
  const accepted = new Set([...proposal.acceptedCharacterIds, ...(input.accept ? [input.controllerCharacterId] : [])]);
  const allAccepted = input.accept
    && proposal.memberCharacterIds.every((characterId) => accepted.has(characterId));
  if (allAccepted) {
    const group = state.multiplayerRuntime.partyGroups[String(proposal.groupId)];
    const memberCharacterIds = [...proposal.memberCharacterIds].filter(isNonEmptyString).sort();
    if (group?.status !== "active"
      || !Array.isArray(group.memberCharacterIds)
      || JSON.stringify([...group.memberCharacterIds].sort()) !== JSON.stringify(memberCharacterIds)
      || memberCharacterIds.some((id) => state.characterControls[id] === undefined)
      || memberCharacterIds.some((id) => state.multiplayerRuntime.characterTimelineIds[id] !== proposal.sourceTimelineId)) {
      return rejected("privateOrUnknownReference", "Party movement scope changed before unanimous consent.");
    }
    drafts.push({
      eventType: "PartyMoved",
      payload: {
        proposalId: proposal.proposalId as string,
        groupId: proposal.groupId as string,
        memberCharacterIds,
        destinationSceneId: proposal.destinationSceneId as string,
        sourceTimelineId: proposal.sourceTimelineId as string,
        destinationTimelineId: proposal.destinationTimelineId as string,
        departureMicros: proposal.departureMicros as string,
        arrivalMicros: proposal.arrivalMicros as string,
      },
    });
    return sequence(profiles, state, input.rootActionId, drafts);
  }
  if (!input.accept) return sequence(profiles, state, input.rootActionId, drafts);
  const remaining = Object.values(state.pendingInputs)
    .filter((entry) => entry.rootActionId === input.rootActionId && entry.pendingInputId !== input.pendingInputId)
    .sort((left, right) => left.pendingInputId.localeCompare(right.pendingInputId));
  const next = remaining[0];
  return sequence(profiles, state, input.rootActionId, drafts, "awaitingInput", {
    pending: {
      pendingInputId: next.pendingInputId,
      kind: "partyMoveConsent",
      question: next.question,
      controller: { kind: "character", characterId: next.controllerCharacterId },
    },
  });
}

function moveIndividually(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, [
    "characterId",
    "destinationSceneId",
    "fictionTimeCostMicros",
    "kind",
    "rootActionId",
  ])
    || !compoundRootAvailable(state, input)
    || !isNonEmptyString(input.characterId)
    || !isNonEmptyString(input.destinationSceneId)
    || typeof input.fictionTimeCostMicros !== "string"
    || state.characterControls[input.characterId] === undefined) {
    return rejected("invalidRulesInput", "Individual movement input is not canonical.");
  }
  const plan = movementPlan(state, [input.characterId], input.destinationSceneId, input.fictionTimeCostMicros);
  if (plan === undefined) return rejected("privateOrUnknownReference", "Individual movement conflicts with a causal frontier.");
  const drafts = partyDepartureEvents(state, input.characterId, "individualAction");
  drafts.push({
    eventType: "CharacterMoved",
    payload: {
      characterId: input.characterId,
      destinationSceneId: input.destinationSceneId,
      ...plan,
    },
  });
  return sequence(profiles, state, input.rootActionId, drafts);
}

function leavePartyGroup(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, ["characterId", "kind", "rootActionId"])
    || !compoundRootAvailable(state, input)
    || !isNonEmptyString(input.characterId)
    || state.characterControls[input.characterId] === undefined) {
    return rejected("invalidRulesInput", "Party leave input is not canonical.");
  }
  const drafts = partyDepartureEvents(state, input.characterId, "explicitLeave");
  return drafts.length === 0
    ? rejected("privateOrUnknownReference", "Party membership is unavailable.")
    : sequence(profiles, state, input.rootActionId, drafts);
}

function transferPartyLeadership(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, ["fromCharacterId", "kind", "rootActionId", "toCharacterId"])
    || !compoundRootAvailable(state, input)
    || !isNonEmptyString(input.fromCharacterId)
    || !isNonEmptyString(input.toCharacterId)) {
    return rejected("invalidRulesInput", "Party leader transfer input is not canonical.");
  }
  const group = activeGroupForCharacter(state, input.fromCharacterId);
  if (group?.leaderCharacterId !== input.fromCharacterId
    || !Array.isArray(group.memberCharacterIds)
    || !group.memberCharacterIds.includes(input.toCharacterId)
    || state.characterControls[input.fromCharacterId] === undefined
    || state.characterControls[input.toCharacterId] === undefined) {
    return rejected("privateOrUnknownReference", "Party leader transfer reference is unavailable.");
  }
  return sequence(profiles, state, input.rootActionId, [{
    eventType: "PartyLeaderTransferred",
    payload: {
      groupId: group.groupId as string,
      fromCharacterId: input.fromCharacterId,
      toCharacterId: input.toCharacterId,
    },
  }]);
}

function synchronizeFictionTimelines(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, ["characterIds", "kind", "meetingMicros", "rootActionId", "sceneId"])
    || !compoundRootAvailable(state, input)
    || !Array.isArray(input.characterIds)
    || input.characterIds.length < 2
    || !input.characterIds.every(isNonEmptyString)
    || new Set(input.characterIds).size !== input.characterIds.length
    || !isNonEmptyString(input.sceneId)
    || typeof input.meetingMicros !== "string"
    || !/^(0|[1-9][0-9]*)$/.test(input.meetingMicros)) {
    return rejected("invalidRulesInput", "Fiction timeline meeting input is not canonical.");
  }
  const characterIds = [...input.characterIds].sort();
  if (characterIds.some((characterId) =>
    state.characterControls[characterId] === undefined
    || state.entities[characterId]?.sceneId !== input.sceneId)) {
    return rejected("privateOrUnknownReference", "Meeting participants are not co-located and controlled.");
  }
  const sourceTimelineIds = [...new Set(characterIds
    .map((characterId) => state.multiplayerRuntime.characterTimelineIds[characterId]))].sort();
  if (sourceTimelineIds.some((timelineId) => !(timelineId in state.fictionTimelines))) {
    return rejected("privateOrUnknownReference", "Meeting causal frontier is unavailable.");
  }
  const latest = sourceTimelineIds.reduce((maximum, timelineId) => {
    const current = BigInt(state.fictionTimelines[timelineId].nowMicros);
    return current > maximum ? current : maximum;
  }, 0n);
  if (BigInt(input.meetingMicros) < latest) {
    return rejected("causalFrontierConflict", "Meeting cannot precede a participant's committed frontier.");
  }
  const meetingTimelineId = `timeline:${state.activeBranchId}:${input.sceneId}`;
  return sequence(profiles, state, input.rootActionId, [{
    eventType: "FictionTimelinesMet",
    payload: {
      characterIds,
      sceneId: input.sceneId,
      sourceTimelineIds,
      meetingTimelineId,
      meetingMicros: input.meetingMicros,
    },
  }]);
}

function propagateCausalFrontier(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, [
    "arrivalMicros",
    "kind",
    "mediumFactId",
    "rootActionId",
    "sourceTimelineId",
    "targetTimelineId",
  ])
    || !compoundRootAvailable(state, input)
    || !isNonEmptyString(input.sourceTimelineId)
    || !isNonEmptyString(input.targetTimelineId)
    || input.sourceTimelineId === input.targetTimelineId
    || !isNonEmptyString(input.mediumFactId)
    || typeof input.arrivalMicros !== "string"
    || !/^(0|[1-9][0-9]*)$/.test(input.arrivalMicros)) {
    return rejected("invalidRulesInput", "Causal propagation input is not canonical.");
  }
  const source = state.multiplayerRuntime.causalFrontiers[input.sourceTimelineId];
  const target = state.multiplayerRuntime.causalFrontiers[input.targetTimelineId];
  if (source === undefined
    || target === undefined
    || !isNonEmptyString(source.eventHeadId)
    || !(input.mediumFactId in state.canonicalFacts)
    || BigInt(String(source.nowMicros)) > BigInt(input.arrivalMicros)
    || BigInt(String(target.nowMicros)) < BigInt(input.arrivalMicros)) {
    return rejected("causalFrontierConflict", "The propagation has not reached the target causal frontier.");
  }
  return sequence(profiles, state, input.rootActionId, [{
    eventType: "CausalFrontierPropagated",
    payload: {
      sourceTimelineId: input.sourceTimelineId,
      targetTimelineId: input.targetTimelineId,
      sourceEventHeadId: source.eventHeadId,
      arrivalMicros: input.arrivalMicros,
      mediumFactId: input.mediumFactId,
    },
  }]);
}

export function stepMultiplayerWorld(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  if (input.kind !== "applyRoomAdministration") {
    switch (input.kind) {
      case "changeCharacterGear": return changeControlledCharacterGear(profiles, state, input);
      case "invitePartyMember": return invitePartyMember(profiles, state, input);
      case "answerPartyInvitation": return answerPartyInvitation(profiles, state, input);
      case "cancelPartyInvitation": return cancelPartyInvitation(profiles, state, input);
      case "proposePartyMove": return proposePartyMove(profiles, state, input);
      case "answerPartyMove": return answerPartyMove(profiles, state, input);
      case "moveIndividually": return moveIndividually(profiles, state, input);
      case "leavePartyGroup": return leavePartyGroup(profiles, state, input);
      case "transferPartyLeadership": return transferPartyLeadership(profiles, state, input);
      case "synchronizeFictionTimelines": return synchronizeFictionTimelines(profiles, state, input);
      case "propagateCausalFrontier": return propagateCausalFrontier(profiles, state, input);
      default: return undefined;
    }
  }
  if (
    !hasExactKeys(input, ["command", "commandId", "kind", "roomAdministration"])
    || !isNonEmptyString(input.commandId)
    || !isRecord(input.roomAdministration)
    || !hasExactKeys(input.roomAdministration, ["capability", "kind"])
    || input.roomAdministration.kind !== "roomAdministration"
    || !isSha256(input.roomAdministration.capability)
    || !isRecord(input.command)
  ) return rejected("invalidRulesInput", "Room administration input is not canonical.");
  if (input.roomAdministration.capability !== state.multiplayerRuntime.roomAdministrationCapability) {
    return rejected("roomAdministrationUnauthorized", "Only Room Authority may administer membership and control.");
  }
  const command = input.command;
  const rootActionId = `room-administration:${input.commandId}`;
  if (rootActionId in state.receipts) return rejected("duplicateRootAction", "Room administration command id is already used.");
  switch (command.kind) {
    case "grantSeat":
      return grantSeat(profiles, state, rootActionId, command);
    case "materializeCharacter":
      return materializeCharacter(profiles, state, rootActionId, command);
    case "removeMember":
    case "departMember": {
      if (
        !hasExactKeys(command, ["kind", "principalId", "reason"])
        || !isNonEmptyString(command.principalId)
        || !isNonEmptyString(command.reason)
      ) return rejected("invalidRulesInput", "Member removal command is not canonical.");
      const drafts = removalDrafts(
        state,
        command.principalId,
        command.reason,
        command.kind === "removeMember" ? "MemberRemoved" : "MemberDeparted",
      );
      return drafts === undefined
        ? rejected("targetSeatUnavailable", "The target active non-host Seat is unavailable.")
        : sequence(profiles, state, rootActionId, drafts);
    }
    case "vacateSeat": {
      if (!hasExactKeys(command, ["kind", "principalId", "reason", "seatId"])
        || !isNonEmptyString(command.principalId)
        || !isNonEmptyString(command.reason)
        || !isNonEmptyString(command.seatId)
        || state.seats[command.seatId]?.principalId !== command.principalId
        || state.seats[command.seatId]?.status !== "active") {
        return rejected("targetSeatUnavailable", "The target active Seat is unavailable.");
      }
      const drafts = Object.values(state.characterControls)
        .filter((control) => control.seatId === command.seatId)
        .sort((left, right) => left.characterId.localeCompare(right.characterId))
        .flatMap((control) => revokeControlDrafts(
          state,
          control.characterId,
          command.seatId as string,
          command.reason as string,
        ) ?? []);
      drafts.push({
        eventType: "SeatVacated",
        payload: {
          seatId: command.seatId,
          principalId: command.principalId,
          reason: command.reason,
        },
      });
      return sequence(profiles, state, rootActionId, drafts);
    }
    case "grantControl":
      if (!hasExactKeys(command, ["characterId", "kind", "seatId"])
        || !isNonEmptyString(command.characterId)
        || !isNonEmptyString(command.seatId)
        || state.entities[command.characterId]?.tenureStatus !== "active"
        || state.characterControls[command.characterId] !== undefined
        || state.seats[command.seatId]?.status !== "active") {
        return rejected("targetSeatUnavailable", "Character control cannot be granted to the target Seat.");
      }
      return sequence(profiles, state, rootActionId, [{
        eventType: "CharacterControlGranted",
        payload: { character: null, characterId: command.characterId, seatId: command.seatId },
      }]);
    case "revokeControl": {
      if (!hasExactKeys(command, ["characterId", "kind", "reason", "seatId"])
        || !isNonEmptyString(command.characterId)
        || !isNonEmptyString(command.seatId)
        || !isNonEmptyString(command.reason)) {
        return rejected("invalidRulesInput", "Control revocation command is not canonical.");
      }
      const drafts = revokeControlDrafts(
        state,
        command.characterId,
        command.seatId,
        command.reason,
      );
      return drafts === undefined
        ? rejected("targetSeatUnavailable", "Character control is unavailable.")
        : sequence(profiles, state, rootActionId, drafts);
    }
    case "transferControl": {
      if (!hasExactKeys(command, ["characterId", "fromSeatId", "kind", "toSeatId"])
        || !isNonEmptyString(command.characterId)
        || !isNonEmptyString(command.fromSeatId)
        || !isNonEmptyString(command.toSeatId)
        || state.characterControls[command.characterId]?.seatId !== command.fromSeatId
        || state.seats[command.toSeatId]?.status !== "active") {
        return rejected("targetSeatUnavailable", "Character control transfer is unavailable.");
      }
      const drafts: Draft[] = [{
        eventType: "CharacterControlTransferred",
        payload: {
          characterId: command.characterId,
          fromSeatId: command.fromSeatId,
          toSeatId: command.toSeatId,
        },
      }];
      for (const pending of Object.values(state.pendingInputs)
        .filter((entry) => entry.controllerCharacterId === command.characterId)
        .sort((left, right) => left.pendingInputId.localeCompare(right.pendingInputId))) {
        drafts.push({
          eventType: "PendingInputReassigned",
          payload: {
            pendingInputId: pending.pendingInputId,
            controllerCharacterId: command.characterId,
            fromSeatId: command.fromSeatId,
            toSeatId: command.toSeatId,
          },
          visibilityPolicyId: "visibility:room-authority-only",
          secrecy: "internal",
        });
      }
      return sequence(profiles, state, rootActionId, drafts);
    }
    case "transferHost":
      if (
        !hasExactKeys(command, ["fromPrincipalId", "kind", "toPrincipalId"])
        || command.fromPrincipalId !== state.multiplayerRuntime.hostPrincipalId
        || !isNonEmptyString(command.toPrincipalId)
        || state.multiplayerRuntime.members[command.toPrincipalId]?.status !== "active"
        || !Object.values(state.seats).some((seat) =>
          seat.principalId === command.toPrincipalId && seat.status === "active")
      ) return rejected("targetSeatUnavailable", "The target active Seat is unavailable for host transfer.");
      return sequence(profiles, state, rootActionId, [{
        eventType: "HostTransferred",
        payload: {
          fromPrincipalId: command.fromPrincipalId as string,
          toPrincipalId: command.toPrincipalId,
        },
      }]);
    case "transferHostAndDepart": {
      if (
        !hasExactKeys(command, ["fromPrincipalId", "kind", "reason", "toPrincipalId"])
        || command.fromPrincipalId !== state.multiplayerRuntime.hostPrincipalId
        || !isNonEmptyString(command.toPrincipalId)
        || !isNonEmptyString(command.reason)
        || command.toPrincipalId === command.fromPrincipalId
        || state.multiplayerRuntime.members[command.toPrincipalId]?.status !== "active"
        || !Object.values(state.seats).some((seat) =>
          seat.principalId === command.toPrincipalId && seat.status === "active")
      ) return rejected("targetSeatUnavailable", "The host transfer departure target is unavailable.");
      const departure = removalDrafts(
        state,
        command.fromPrincipalId as string,
        command.reason as string,
        "MemberDeparted",
        true,
      );
      if (departure === undefined) {
        return rejected("targetSeatUnavailable", "The departing host Seat is unavailable.");
      }
      return sequence(profiles, state, rootActionId, [{
        eventType: "HostTransferred",
        payload: {
          fromPrincipalId: command.fromPrincipalId as string,
          toPrincipalId: command.toPrincipalId,
        },
      }, ...departure]);
    }
    default:
      return rejected("unsupportedOperation", "No authoritative-v2 room administration command is registered.");
  }
}
