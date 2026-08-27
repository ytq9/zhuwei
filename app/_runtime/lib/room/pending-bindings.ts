import type { AuthoritativeWorldState } from "../rules";
import type { JsonObject } from "./authority-types";

export type AuthorityPendingBindingSeed = {
  pendingInputId: string;
  rootActionId: string;
  controllerCharacterId: string;
  pending: JsonObject;
};

export type AuthorityPendingBinding = AuthorityPendingBindingSeed & {
  controllerPrincipalId: string;
};

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function combatQuestion(choiceKind: unknown): string {
  return choiceKind === "initiativeTieOrder"
    ? "请决定同点玩家角色的先攻顺序。"
    : choiceKind === "reaction"
      ? "是否使用这次反应？"
      : choiceKind === "encounterConclusion"
        ? "是否接受当前遭遇的收束方式？"
        : "请选择本次战斗行动的明确目标或取消。";
}

/**
 * Enumerates the one Rules-owned pending-input set that Room Authority must
 * authenticate. Both live commit and disaster restore consume this function,
 * so a shipped pending kind cannot be recoverable in one path but absent from
 * the other.
 */
export function authorityPendingBindingSeeds(
  state: AuthoritativeWorldState,
  rootActionId?: string,
): AuthorityPendingBindingSeed[] {
  const ordinary = Object.values(state.pendingInputs).map((entry) => ({
    pendingInputId: entry.pendingInputId,
    rootActionId: entry.rootActionId,
    controllerCharacterId: entry.controllerCharacterId,
    pending: {
      ...(structuredClone(entry) as unknown as JsonObject),
      controller: { kind: "character", characterId: entry.controllerCharacterId },
      controllerCharacterId: entry.controllerCharacterId,
    },
  }));
  const combat = Object.values(state.combatRuntime.pendingInputs).flatMap((entry) => {
    if (
      !isRecord(entry)
      || entry.kind !== "playerChoice"
      || !nonEmptyString(entry.pendingInputId)
      || !nonEmptyString(entry.rootActionId)
      || !nonEmptyString(entry.controllerEntityId)
    ) return [];
    return [{
      pendingInputId: entry.pendingInputId,
      rootActionId: entry.rootActionId,
      controllerCharacterId: entry.controllerEntityId,
      pending: {
        ...structuredClone(entry),
        kind: "combatChoice",
        question: combatQuestion(entry.choiceKind),
        controller: { kind: "character", characterId: entry.controllerEntityId },
        controllerCharacterId: entry.controllerEntityId,
      },
    } satisfies AuthorityPendingBindingSeed];
  });

  return [...ordinary, ...combat]
    .filter((entry) => rootActionId === undefined || entry.rootActionId === rootActionId)
    .sort((left, right) => left.pendingInputId.localeCompare(right.pendingInputId));
}

/** Resolves pending controllers only from the active trusted Seat graph. */
export function authorityPendingBindings(
  state: AuthoritativeWorldState,
  rootActionId?: string,
): AuthorityPendingBinding[] {
  return authorityPendingBindingSeeds(state, rootActionId).flatMap((entry) => {
    const control = state.characterControls[entry.controllerCharacterId];
    const seat = control === undefined ? undefined : state.seats[control.seatId];
    const principal = seat === undefined ? undefined : state.principals[seat.principalId];
    if (seat?.status !== "active" || principal === undefined) return [];
    return [{
      ...entry,
      controllerPrincipalId: principal.id,
      pending: {
        ...entry.pending,
        controllerPrincipalId: principal.id,
      },
    }];
  });
}
