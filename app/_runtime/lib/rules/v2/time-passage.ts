import { timePassageTimelineId } from "./time-passage-binding";
export { timePassageTimelineId } from "./time-passage-binding";
import { canonicalSha256 } from "../profiles/canonical";
import type { Sha256Ref } from "../profiles/types";
import { authorityReadSetMatches, characterTimelineAuthorityRef } from "./authority-bindings";
import { conditionMechanics } from "./condition-mechanics";
import { activeEncounter } from "./combat-encounters";
import type { AuthoritativeWorldState, JsonRecord } from "./model";
import { characterTimelineId } from "./timeline";
import { hasExactKeys, isNonEmptyString, isRecord, isSha256 } from "./validation";
import { isCanonicalReadSet, type VersionedAuthorityBinding } from "./world-interaction-model";

export const TIME_PASSAGE_PLAN_SCHEMA = "zhuwei.time-passage-plan/vnext-1" as const;
export type TimePassagePlan = Readonly<{
  schema: typeof TIME_PASSAGE_PLAN_SCHEMA;
  contextHash: Sha256Ref;
  readSet: readonly VersionedAuthorityBinding[];
  activityId: string;
  intendedDurationMicros: string;
  method: string;
}>;
export type TimePassageInterruptionReason = "actorUnavailable" | "actorIncapacitated" | "encounterActive"
  | "locationChanged" | "externalInterruption";

export function isTimePassageDuration(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value) && Number.isSafeInteger(Number(value));
}

export function isTimePassagePlan(value: unknown): value is TimePassagePlan {
  return isRecord(value) && hasExactKeys(value, ["schema", "contextHash", "readSet", "activityId", "intendedDurationMicros", "method"])
    && value.schema === TIME_PASSAGE_PLAN_SCHEMA && isSha256(value.contextHash)
    && isCanonicalReadSet(value.readSet) && isNonEmptyString(value.activityId)
    && isTimePassageDuration(value.intendedDurationMicros)
    && isNonEmptyString(value.method) && value.method.length <= 8000;
}

export function timePassageStartReadRefs(state: AuthoritativeWorldState, actorId: string): readonly string[] | undefined {
  const actor = state.entities[actorId];
  if (actor === undefined || state.scenes[actor.sceneId] === undefined || characterTimelineId(state, actorId) === undefined) return undefined;
  return [...new Set([actorId, actor.sceneId, characterTimelineAuthorityRef(actorId)])].sort();
}

function positionHash(state: AuthoritativeWorldState, actorId: string): Sha256Ref {
  return canonicalSha256(state.combatRuntime.entities[actorId]?.position ?? null);
}

export function timePassageActorUnavailableReason(state: AuthoritativeWorldState, actorId: string): TimePassageInterruptionReason | undefined {
  const actor = state.entities[actorId];
  if (actor?.kind !== "player" || actor.tenureStatus !== "active" || state.characterControls[actorId] === undefined) return "actorUnavailable";
  if (!conditionMechanics(state, actorId).canAct) return "actorIncapacitated";
  if (activeEncounter(state, actorId) !== undefined) return "encounterActive";
  return undefined;
}

export function timePassageStartPayload(state: AuthoritativeWorldState, actorId: string, plan: TimePassagePlan): JsonRecord | undefined {
  const refs = timePassageStartReadRefs(state, actorId), timelineId = characterTimelineId(state, actorId);
  if (!isTimePassagePlan(plan) || refs === undefined || timelineId === undefined
    || timePassageActorUnavailableReason(state, actorId) !== undefined
    || !refs.every(ref => plan.readSet.some(binding => binding.ref === ref))
    || !authorityReadSetMatches(state, plan.readSet)
    || state.campaignRuntime.activities[plan.activityId] !== undefined
    || Object.values(state.campaignRuntime.activities).some(activity => activity.characterId === actorId && activity.status === "active")) return undefined;
  return { activityId: plan.activityId, characterId: actorId, activityKind: "timePassage",
    intendedDurationMicros: plan.intendedDurationMicros,
    completion: { kind: "timePassage", sourceSceneId: state.entities[actorId].sceneId, sourceTimelineId: timelineId,
      sourcePositionHash: positionHash(state, actorId), plan: structuredClone(plan) } };
}


export function timePassageStopReason(state: AuthoritativeWorldState, activity: JsonRecord): TimePassageInterruptionReason | "invalidSchedule" | undefined {
  const completion = activity.completion;
  if (!isNonEmptyString(activity.characterId) || !isRecord(completion)
    || !hasExactKeys(completion, ["kind", "sourceSceneId", "sourceTimelineId", "sourcePositionHash", "plan"])
    || completion.kind !== "timePassage" || !isTimePassagePlan(completion.plan)
    || completion.plan.activityId !== activity.activityId || completion.plan.intendedDurationMicros !== activity.intendedDurationMicros
    || !isSha256(completion.sourcePositionHash) || timePassageTimelineId(state, activity) === undefined) return "invalidSchedule";
  const unavailable = timePassageActorUnavailableReason(state, activity.characterId);
  if (unavailable !== undefined) return unavailable;
  if (state.entities[activity.characterId].sceneId !== completion.sourceSceneId
    || state.scenes[String(completion.sourceSceneId)] === undefined
    || characterTimelineId(state, activity.characterId) !== completion.sourceTimelineId
    || positionHash(state, activity.characterId) !== completion.sourcePositionHash) return "locationChanged";
  return undefined;
}

export function timePassagePublicInterruptionReason(activity: JsonRecord): TimePassageInterruptionReason {
  const reason = isRecord(activity.interruptionCause) && activity.interruptionCause.kind === "timePassageInterrupted"
    ? activity.interruptionCause.reason : undefined;
  return ["actorUnavailable", "actorIncapacitated", "encounterActive", "locationChanged"].includes(String(reason))
    ? reason as TimePassageInterruptionReason : "externalInterruption";
}
