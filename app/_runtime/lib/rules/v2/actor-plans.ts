import type { AuthoritativeWorldState, JsonRecord } from "./model";
import { characterTimelineId } from "./timeline";
import { isNonEmptyString, isRecord } from "./validation";

export type EligibleDueActorPlan = {
  plan: JsonRecord;
  npcId: string;
  timelineId: string;
  eligibleAtFictionMicros: string;
};

export function actorPlanNpcIsAvailable(
  entity: AuthoritativeWorldState["entities"][string] | undefined,
): entity is AuthoritativeWorldState["entities"][string] {
  return entity?.kind === "npc"
    && (entity.tenureStatus === "active" || entity.tenureStatus === "npcTransitioned");
}

export function actorPlanPremiseIsAvailable(
  state: AuthoritativeWorldState,
  npcId: string,
  reference: string,
): boolean {
  if (reference in (state.knowledge[npcId] ?? {})) return true;
  const relationship = state.campaignRuntime.relationships[reference];
  if (Array.isArray(relationship?.subjectIds)
    && relationship.subjectIds.includes(npcId)) return true;
  const promise = state.campaignRuntime.promises[reference];
  if (promise?.status === "active"
    && (promise.promisorId === npcId || promise.promiseeId === npcId)) return true;
  const debt = state.campaignRuntime.debts[reference];
  return debt?.status === "active"
    && (debt.debtorId === npcId || debt.creditorId === npcId);
}

export function actorPlanPremiseScope(
  state: AuthoritativeWorldState,
  npcId: string,
  reference: string,
): string | undefined {
  if (reference in (state.knowledge[npcId] ?? {})) return `knowledge:${npcId}:${reference}`;
  if (reference in state.campaignRuntime.relationships) return `relationship:${reference}`;
  if (reference in state.campaignRuntime.promises) return `promise:${reference}`;
  if (reference in state.campaignRuntime.debts) return `debt:${reference}`;
  return undefined;
}

function planActivity(plan: JsonRecord): JsonRecord | undefined {
  return isRecord(plan.activity) ? plan.activity : undefined;
}

function planTriggerIsSatisfied(
  state: AuthoritativeWorldState,
  npcId: string,
  trigger: JsonRecord,
): boolean {
  const heldKnowledge = Object.values(state.knowledge[npcId] ?? {});
  if (trigger.kind === "knowledgeAcquired" && isNonEmptyString(trigger.knowledgeRef)) {
    return trigger.knowledgeRef in (state.knowledge[npcId] ?? {});
  }
  if (trigger.kind === "committedEvent" && isNonEmptyString(trigger.eventRef)) {
    return heldKnowledge.some((knowledge) =>
      knowledge.acquiredByEventId === trigger.eventRef
      || knowledge.provenanceChain.includes(trigger.eventRef as string));
  }
  return false;
}

function eligiblePlan(
  state: AuthoritativeWorldState,
  affectedCharacterId: string,
  plan: JsonRecord,
): EligibleDueActorPlan | undefined {
  const affected = state.entities[affectedCharacterId];
  const npcId = isNonEmptyString(plan.npcId) ? plan.npcId : undefined;
  if (npcId === undefined) return undefined;
  const npc = npcId === undefined ? undefined : state.entities[npcId];
  const affectedTimelineId = characterTimelineId(state, affectedCharacterId);
  const npcTimelineId = characterTimelineId(state, npcId);
  const activity = planActivity(plan);
  const activityId = isNonEmptyString(activity?.activityId) ? activity.activityId : undefined;
  const persistedActivity = activityId === undefined
    ? undefined
    : state.campaignRuntime.activities[activityId];
  if (
    affected?.kind !== "player"
    || affected.tenureStatus !== "active"
    || !actorPlanNpcIsAvailable(npc)
    || npc.sceneId !== affected.sceneId
    || affectedTimelineId === undefined
    || npcTimelineId !== affectedTimelineId
    || plan.actorKind !== "npc"
    || plan.actorRef !== npcId
    || plan.decisionNpcId !== npcId
    || plan.status !== "scheduled"
    || !isNonEmptyString(plan.planId)
    || activityId === undefined
    || persistedActivity?.status !== "active"
    || persistedActivity.characterId !== npcId
    || !isRecord(persistedActivity.completion)
    || persistedActivity.completion.kind !== "actorPlan"
    || persistedActivity.completion.planId !== plan.planId
    || plan.trace === undefined
    || !isRecord(plan.trace)
    || !isNonEmptyString(plan.trace.factRef)
    || plan.trace.factRef in state.canonicalFacts
  ) return undefined;

  const timelineNow = state.fictionTimelines[affectedTimelineId].nowMicros;
  if (isRecord(plan.due)
    && plan.due.kind === "fictionTime"
    && typeof plan.due.atFictionMicros === "string"
    && /^(0|[1-9][0-9]*)$/.test(plan.due.atFictionMicros)
    && BigInt(plan.due.atFictionMicros) <= BigInt(timelineNow)) {
    return {
      plan,
      npcId,
      timelineId: affectedTimelineId,
      eligibleAtFictionMicros: plan.due.atFictionMicros,
    };
  }
  if (isRecord(plan.trigger) && planTriggerIsSatisfied(state, npcId, plan.trigger)) {
    return {
      plan,
      npcId,
      timelineId: affectedTimelineId,
      eligibleAtFictionMicros: timelineNow,
    };
  }
  return undefined;
}

/**
 * Rules owns both eligibility and deterministic ordering. Room supplies only
 * the authenticated player's character id and never reads plan internals.
 */
export function earliestEligibleDueActorPlan(
  state: AuthoritativeWorldState,
  affectedCharacterId: string,
): EligibleDueActorPlan | undefined {
  return Object.values(state.campaignRuntime.npcPlans)
    .flatMap((plan) => {
      const eligible = eligiblePlan(state, affectedCharacterId, plan);
      return eligible === undefined ? [] : [eligible];
    })
    .sort((left, right) => {
      const leftAt = BigInt(left.eligibleAtFictionMicros);
      const rightAt = BigInt(right.eligibleAtFictionMicros);
      return leftAt < rightAt ? -1 : leftAt > rightAt ? 1
        : String(left.plan.planId).localeCompare(String(right.plan.planId));
    })[0];
}

export function dueActorPlanChildRoot(plan: JsonRecord): string | undefined {
  if (!isNonEmptyString(plan.planId)) return undefined;
  const dueKey = isRecord(plan.due) && typeof plan.due.atFictionMicros === "string"
    ? `time:${plan.due.atFictionMicros}`
    : isRecord(plan.trigger) && isNonEmptyString(plan.trigger.kind)
      ? `trigger:${plan.trigger.kind}`
      : undefined;
  return dueKey === undefined ? undefined : `actor-plan-due:${plan.planId}:${dueKey}`;
}
