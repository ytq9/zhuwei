import type { AuthoritativeWorldState, CharacterRecord, JsonRecord } from "./model";
import { isRecord } from "./validation";

function supersedePending(state: AuthoritativeWorldState, pendingInputId: string, reason: string): void {
  const pending = state.pendingInputs[pendingInputId];
  if (pending === undefined) return;
  state.multiplayerRuntime.suspendedPendingInputs[pendingInputId] = {
    ...structuredClone(pending),
    suspendedReason: reason,
  };
  const receipt = state.receipts[pending.rootActionId];
  if (receipt?.status === "awaitingInput") receipt.status = "superseded";
  delete state.pendingInputs[pendingInputId];
}

function cancelPartyParticipation(
  state: AuthoritativeWorldState,
  characterId: string,
  reason: string,
): void {
  for (const group of Object.values(state.multiplayerRuntime.partyGroups)) {
    if (!Array.isArray(group.memberCharacterIds)
      || !group.memberCharacterIds.includes(characterId)
      || group.status === "disbanded") continue;
    if (group.leaderCharacterId === characterId) {
      group.status = "disbanded";
      group.leaderCharacterId = null;
      group.disbandReason = reason;
    } else {
      group.memberCharacterIds = group.memberCharacterIds.filter((entry) => entry !== characterId);
    }
  }
  for (const [pendingInputId, invitation] of Object.entries(
    state.multiplayerRuntime.partyInvitations,
  )) {
    if (invitation.status !== "pending"
      || (invitation.inviterCharacterId !== characterId
        && invitation.invitedCharacterId !== characterId)) continue;
    invitation.status = "cancelled";
    invitation.cancellationReason = reason;
    supersedePending(state, pendingInputId, reason);
  }
  for (const proposal of Object.values(state.multiplayerRuntime.partyMoveProposals)) {
    if (!isRecord(proposal) || proposal.status === "cancelled") continue;
    const participants = Array.isArray(proposal.participantCharacterIds)
      ? proposal.participantCharacterIds
      : Array.isArray(proposal.memberCharacterIds) ? proposal.memberCharacterIds : [];
    if (!participants.includes(characterId) && proposal.leaderCharacterId !== characterId) continue;
    proposal.status = "cancelled";
    proposal.cancellationReason = reason;
    if (Array.isArray(proposal.pendingInputIds)) {
      for (const pendingInputId of proposal.pendingInputIds) {
        if (typeof pendingInputId === "string") supersedePending(state, pendingInputId, reason);
      }
    }
  }
}

/**
 * Canonical fold consequence for a player tenure ending. It never chooses a
 * replacement controller or Party leader; a successor requires a later event.
 */
export function endCharacterTenure(
  state: AuthoritativeWorldState,
  characterId: string,
  tenureStatus: Extract<CharacterRecord["tenureStatus"], "dead" | "retired" | "missing" | "npcTransitioned">,
  reason: string,
): CharacterRecord {
  const character = state.entities[characterId];
  if (character === undefined) throw new TypeError("character tenure target is unavailable");
  const control = state.characterControls[characterId];
  if (control !== undefined) character.lastControllerSeatId = control.seatId;
  character.tenureStatus = tenureStatus;
  if (tenureStatus === "npcTransitioned") {
    character.kind = "npc";
    delete character.controllerPrincipalId;
  }
  delete state.characterControls[characterId];
  for (const pendingInputId of Object.keys(state.pendingInputs).sort()) {
    if (state.pendingInputs[pendingInputId]?.controllerCharacterId === characterId) {
      supersedePending(state, pendingInputId, reason);
    }
  }
  cancelPartyParticipation(state, characterId, reason);
  const combatEntity = state.combatRuntime.entities[characterId] as JsonRecord | undefined;
  if (combatEntity !== undefined) delete combatEntity.controllerPrincipalId;
  return character;
}
