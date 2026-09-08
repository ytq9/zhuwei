import { activeEncounter } from "./combat-encounters";
import { characterTimelineId } from "./timeline";
import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState, JsonRecord } from "./model";
import { isRecord } from "./validation";
import { authorityRevisionOrHash } from "./authority-bindings";

/** Progress is authority bookkeeping, never a claim that a resting character
 * is awake. Only knowledge already acquired by the character can notify it. */
export function activityProgressBinding(state: AuthoritativeWorldState, characterId: string): JsonRecord | undefined {
  const timelineId = characterTimelineId(state, characterId);
  if (timelineId === undefined || state.entities[characterId]?.kind !== "player") return undefined;
  return { timelineId, sourceSceneId: state.entities[characterId].sceneId,
    timelineAtStart: structuredClone(state.fictionTimelines[timelineId]),
    acknowledgedKnowledgeRefs: Object.keys(state.knowledge[characterId] ?? {}).sort() };
}

export function hasActivityProgress(activity: JsonRecord): boolean {
  return isRecord(activity.progression) && activity.activityKind !== "timePassage"
    && !(isRecord(activity.completion) && activity.completion.kind === "actorPlan");
}

export function activityProgressAvailable(state: AuthoritativeWorldState, activity: JsonRecord): boolean {
  const actorId = String(activity.characterId), binding = activity.progression;
  return hasActivityProgress(activity) && isRecord(binding) && activity.status === "active"
    && state.entities[actorId]?.tenureStatus === "active"
    && activeEncounter(state, actorId) === undefined
    && characterTimelineId(state, actorId) === binding.timelineId
    && state.entities[actorId].sceneId === binding.sourceSceneId;
}

/** Newly committed character knowledge includes delivered messages and
 * acquired sensory evidence. Decorative narration and private world changes
 * do not enter this causal knowledge channel. Self-authored claims do not
 * interrupt their author. This selector never acquires knowledge itself. */
export function activityNoticeKnowledgeRefs(state: AuthoritativeWorldState, activity: JsonRecord): string[] {
  if (!activityProgressAvailable(state, activity) || isRecord(activity.attention)) return [];
  const binding = activity.progression as JsonRecord;
  const acknowledged = new Set(Array.isArray(binding.acknowledgedKnowledgeRefs) ? binding.acknowledgedKnowledgeRefs : []);
  return Object.values(state.knowledge[String(activity.characterId)] ?? {}).filter(knowledge =>
    !acknowledged.has(knowledge.knowledgeRef)
    && knowledge.sourceCharacterId !== activity.characterId).map(knowledge => knowledge.knowledgeRef).sort();
}

export function activityAttentionRoot(activityId: string, knowledgeRefs: readonly string[]): string {
  return `activity-attention:${activityId}:${canonicalSha256(knowledgeRefs).slice(7, 39)}`;
}

export function actionActivityCompletionRoot(rootActionId: string): string {
  return `activity-result:${rootActionId}`;
}

export function actionActivityForRoot(state: AuthoritativeWorldState, root: string): JsonRecord | undefined {
  return Object.values(state.campaignRuntime.activities).find(activity => activity.status === "active"
    && isRecord(activity.completion) && activity.completion.kind === "actionExecution"
    && isRecord(activity.completion.plan) && activity.completion.plan.rootActionId === root);
}

/** Remove only elapsed time and the activity's own bookkeeping for comparison.
 * Other changed or deleted dependencies, including a clarification's basis,
 * remain conflicts. This view is never committed or used as a world snapshot. */
export function actionActivityBaseline(state: AuthoritativeWorldState, activity: JsonRecord): AuthoritativeWorldState | undefined {
  if (!isRecord(activity.progression) || !isRecord(activity.progression.timelineAtStart)) return undefined;
  const timelineId = String(activity.progression.timelineId);
  if (state.fictionTimelines[timelineId] === undefined) return undefined;
  const baseline = structuredClone(state);
  baseline.fictionTimelines[timelineId].nowMicros = String(activity.progression.timelineAtStart.nowMicros);
  delete baseline.campaignRuntime.activities[String(activity.activityId)];
  return baseline;
}

export function actionActivityDependenciesMatch(state: AuthoritativeWorldState, activity: JsonRecord): boolean {
  const baseline = actionActivityBaseline(state, activity), reads = isRecord(activity.progression) ? activity.progression.completionReadSet : undefined;
  return baseline !== undefined && Array.isArray(reads) && reads.every(binding => isRecord(binding)
    && typeof binding.ref === "string" && authorityRevisionOrHash(baseline, binding.ref) === binding.revisionOrHash);
}
