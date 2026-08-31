import type {
  CompoundActionCost,
  CompoundActionEffect,
  CompoundResolutionPlan,
} from "./model";
import {
  CANONICAL_SIGNED_INTEGER_PATTERN,
  hasExactKeys,
  isNonEmptyString,
  isRecord,
} from "./validation";

/**
 * Current Rules-internal outcome plan used by finite Due ActorPlan checks.
 * This is not the retired production KP ActionPlan transport.
 */

function isDurationMicros(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value);
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

export function isCompoundActionCost(value: unknown): value is CompoundActionCost {
  if (!isRecord(value) || !isNonEmptyString(value.kind)) return false;
  if (value.kind === "consumeResource") {
    return hasExactKeys(value, ["amount", "kind", "resourceRef"])
      && isNonEmptyString(value.resourceRef)
      && Number.isSafeInteger(value.amount)
      && Number(value.amount) > 0;
  }
  if (value.kind === "consumeItem") {
    return hasExactKeys(value, ["count", "itemRef", "kind"])
      && isNonEmptyString(value.itemRef)
      && Number.isSafeInteger(value.count)
      && Number(value.count) > 0;
  }
  return value.kind === "fictionTime"
    && hasExactKeys(value, ["durationMicros", "kind"])
    && isDurationMicros(value.durationMicros);
}

export function isCompoundActionEffect(value: unknown): value is CompoundActionEffect {
  if (!isRecord(value) || !isNonEmptyString(value.kind)) return false;
  switch (value.kind) {
    case "acquireEvidence":
      return hasExactKeys(value, ["definitionRef", "evidence", "evidenceRef", "kind"])
        && [value.definitionRef, value.evidence, value.evidenceRef].every(isNonEmptyString);
    case "acquireKnowledge":
      return hasExactKeys(value, ["definitionRef", "kind", "knowledgeRef", "value"])
        && isNonEmptyString(value.definitionRef)
        && isNonEmptyString(value.knowledgeRef)
        && isPrimitive(value.value);
    case "changeResource":
      return hasExactKeys(value, ["amount", "kind", "resourceRef", "targetRef"])
        && isNonEmptyString(value.resourceRef)
        && isNonEmptyString(value.targetRef)
        && typeof value.amount === "number"
        && Number.isSafeInteger(value.amount)
        && CANONICAL_SIGNED_INTEGER_PATTERN.test(String(value.amount))
        && Number(value.amount) < 0;
    case "changeHitPoints":
      return hasExactKeys(value, ["amount", "kind", "targetRef"])
        && isNonEmptyString(value.targetRef)
        && typeof value.amount === "number"
        && Number.isSafeInteger(value.amount)
        && CANONICAL_SIGNED_INTEGER_PATTERN.test(String(value.amount))
        && Number(value.amount) !== 0;
    case "alertNpc":
      return hasExactKeys(value, ["kind", "npcId", "status"])
        && isNonEmptyString(value.npcId)
        && isNonEmptyString(value.status);
    case "moveEntity":
      return hasExactKeys(value, ["entityRef", "kind", "sceneRef"])
        && isNonEmptyString(value.entityRef)
        && isNonEmptyString(value.sceneRef);
    case "advanceFictionTime":
      return hasExactKeys(value, ["durationMicros", "kind"])
        && isDurationMicros(value.durationMicros);
    case "updateRelationship":
      return hasExactKeys(value, ["basisFactIds", "change", "kind", "relationshipRef", "subjectRefs"])
        && isNonEmptyString(value.relationshipRef)
        && isNonEmptyString(value.change)
        && Array.isArray(value.subjectRefs)
        && value.subjectRefs.length >= 2
        && value.subjectRefs.every(isNonEmptyString)
        && Array.isArray(value.basisFactIds)
        && value.basisFactIds.length > 0
        && value.basisFactIds.every(isNonEmptyString);
    case "recordCommitment":
      return hasExactKeys(value, [
        "commitmentRef",
        "condition",
        "content",
        "kind",
        "promiseeRef",
        "promisorRef",
      ])
        && [
          value.commitmentRef,
          value.condition,
          value.content,
          value.promiseeRef,
          value.promisorRef,
        ].every(isNonEmptyString);
    case "recordDebt":
      return hasExactKeys(value, [
        "basisFactIds",
        "condition",
        "creditorRef",
        "debtRef",
        "debtorRef",
        "kind",
        "obligation",
      ])
        && [
          value.condition,
          value.creditorRef,
          value.debtRef,
          value.debtorRef,
          value.obligation,
        ].every(isNonEmptyString)
        && Array.isArray(value.basisFactIds)
        && value.basisFactIds.length > 0
        && value.basisFactIds.every(isNonEmptyString);
    default:
      return false;
  }
}

export function isCompoundResolutionPlan(value: unknown): value is CompoundResolutionPlan {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "actorCharacterId",
      "durationMicros",
      "failureEffects",
      "frozenCosts",
      "goal",
      "method",
      "primaryFactRef",
      "schema",
      "sourceSceneId",
      "successEffects",
    ])
    || value.schema !== "zhuwei.compound-resolution-plan/v1"
    || !isNonEmptyString(value.actorCharacterId)
    || !isNonEmptyString(value.goal)
    || !isNonEmptyString(value.method)
    || !isNonEmptyString(value.sourceSceneId)
    || !isDurationMicros(value.durationMicros)
    || !isNonEmptyString(value.primaryFactRef)
    || !Array.isArray(value.frozenCosts)
    || !value.frozenCosts.every(isCompoundActionCost)
    || !Array.isArray(value.successEffects)
    || !value.successEffects.every(isCompoundActionEffect)
    || !Array.isArray(value.failureEffects)
    || !value.failureEffects.every(isCompoundActionEffect)
  ) return false;
  return true;
}
