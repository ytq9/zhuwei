import type { AuthoritativeWorldState } from "../rules";
import { spatialRecordVisibleTo } from "../rules/v2/spatial-visibility";
import { combatPendingAnswerOptions } from "../rules/v2/combat-actions";
import type { JsonObject } from "./authority-types";
import { frozenChoicePublicBindingMatches } from "../rules/v2/frozen-player-choice";

/** Normalize only a saved choice ID after Room has authenticated the row's
 * principal. Never accept a new plan or infer a replacement choice. */
export function frozenPlayerChoiceAnswer(state: AuthoritativeWorldState,
  binding: Readonly<{ rootActionId: string; controllerCharacterId: string; pendingInputId: string }>,
  answer: unknown): JsonObject | undefined {
  const record = state.frozenPlayerChoices?.[binding.pendingInputId];
  const pending = state.pendingInputs[binding.pendingInputId];
  if (record === undefined || record.selectedChoiceId !== null || pending?.kind !== "playerChoice"
    || record.plan.rootActionId !== binding.rootActionId || pending.rootActionId !== binding.rootActionId
    || record.plan.actorCharacterId !== binding.controllerCharacterId || pending.controllerCharacterId !== binding.controllerCharacterId
    || !frozenChoicePublicBindingMatches(record, { actorCharacterId: pending.controllerCharacterId,
      pendingInputId: pending.pendingInputId, question: pending.question, choices: pending.options?.choices })
    || !isRecord(answer) || Object.keys(answer).length !== 1 || !nonEmptyString(answer.choiceId)
    || !record.plan.choices.some(choice => choice.choiceId === answer.choiceId)) return undefined;
  return { kind: "answerFrozenPlayerChoice", ...binding, choiceId: answer.choiceId };
}

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

function combatQuestion(pending: JsonObject): string {
  return pending.choiceKind === "initiativeTieOrder"
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
        : "请选择本次战斗行动的明确目标或取消。";
}

/** Room persists this same public shape for delivery and disaster restore.
 * Native combat pending records also carry private execution snapshots and
 * reserved dice: adding a continuation field must never publish it here. */
function publicCombatPending(
  state: AuthoritativeWorldState,
  pending: JsonObject,
  controllerCharacterId: string,
): JsonObject {
  const visibleEntity = (id: unknown): id is string => {
    if (!nonEmptyString(id)) return false;
    const entity = state.combatRuntime.entities[id];
    const controller = state.entities[controllerCharacterId];
    return entity !== undefined && controller !== undefined
      && entity.sceneId === controller.sceneId
      && spatialRecordVisibleTo(state, entity, controllerCharacterId);
  };
  const result: JsonObject = {
    pendingInputId: pending.pendingInputId,
    rootActionId: pending.rootActionId,
    kind: "combatChoice",
    question: combatQuestion(pending),
    controller: { kind: "character", characterId: controllerCharacterId },
    controllerCharacterId,
  };
  const answerOptions = Array.isArray(pending.answerOptions)
    ? pending.answerOptions : combatPendingAnswerOptions(state, pending);
  if (answerOptions.length > 0) result.answerOptions = structuredClone(answerOptions.filter((option) =>
    isRecord(option) && isRecord(option.answer)
      && (option.answer.targetEntityId === undefined || visibleEntity(option.answer.targetEntityId))));
  for (const field of ["choiceKind", "reactionKind", "triggerKind", "triggerBatchId", "triggerBatchHash"]) {
    if (nonEmptyString(pending[field])) result[field] = pending[field];
  }
  for (const field of ["candidateEntityIds", "orderedEntityIds"]) {
    if (Array.isArray(pending[field])) result[field] = pending[field].filter(visibleEntity);
  }
  for (const field of ["candidateAbilityRefs", "orderedTriggerInstanceIds"]) {
    if (Array.isArray(pending[field])) result[field] = pending[field].filter(nonEmptyString);
  }
  if (Number.isSafeInteger(pending.maximumTargetCount) && Number(pending.maximumTargetCount) > 0) {
    result.maximumTargetCount = pending.maximumTargetCount;
  }
  if (pending.choiceKind === "reaction") {
    const target = visibleEntity(pending.targetEntityId) ? pending.targetEntityId
      : visibleEntity(pending.movingEntityId) ? pending.movingEntityId : undefined;
    if (target !== undefined) result.targetEntityId = target;
  }
  return result;
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
      pending: publicCombatPending(state, entry, entry.controllerEntityId),
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
