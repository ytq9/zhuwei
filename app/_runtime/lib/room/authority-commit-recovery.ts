import { isPlainRecord as isJsonRecord, parseJsonWithUniqueMembers } from "../kp/vnext/canonical-json";

import { isFrozenPlayerChoiceAnswerInput } from "../rules/shapes";
import { isSemanticDefinitionRevisionPlan, isWorldInteractionResolutionPlan } from "../rules/shapes";
import { isSemanticDefinitionMaterializationPlan } from "../rules/shapes";
import { isCanonicalAtomicWorldInteractionStepsInput } from "../rules/shapes";
import { isTimePassagePlan } from "../rules/shapes";
import { actionActivityCompletionRoot } from "../rules/v2/activity-progress";

import type { AuthorityProposalRecoveryRow } from "./authority-store";

type JsonRecord = Record<string, unknown>;
export type AuthorityCommitRecovery = {
  rulesInput: JsonRecord;
  answeredPendingInputId: string | null;
  receiptExtras: JsonRecord | null;
  forceConcluded: boolean;
  initialRandomnessRootActionId?: string;
};
const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
function hasExactJsonKeys(value: JsonRecord, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function hasOnlyJsonKeys(value: JsonRecord, required: readonly string[], optional: readonly string[]): boolean {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}

/** Shared pure recovery boundary. Uses the actual registered Rules plan
 * validators, never a generic command-name or hash-only admission. The caller
 * still binds the Room runtime manifest and executes through its Rules port. */
export function isCanonicalAuthorityRecoveryInput(value: unknown): value is JsonRecord {
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
    // The only proposal a pending answer still carries is the improvised
    // ruling; the causal program went with the V5 path (ADR 0034).
    && hasExactJsonKeys(value.proposal, ["kind", "ruling"])
    && value.proposal.kind === "resolveImprovisedAction"
    && isJsonRecord(value.proposal.ruling);
}

export function verifiedAuthorityCommitRecovery(
  row: AuthorityProposalRecoveryRow,
): AuthorityCommitRecovery | undefined {
  let recovery: AuthorityCommitRecovery;
  try {
    recovery = parseJsonWithUniqueMembers(row.recovery_json) as AuthorityCommitRecovery;
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
  ) return undefined;
  return recovery;
}
