import { scheduledWorldEffectDeadlines, isWorldEffectRecord, isWorldEffectRecordCandidate } from "./world-effects";
import { activeEncounter } from "./combat-encounters";
import { hasActivityProgress, activityProgressAvailable, activityNoticeKnowledgeRefs, activityAttentionRoot } from "./activity-progress";
import { longSpellcastingTimelineId } from "./time-passage-binding";
import { timePassageStopReason, timePassageTimelineId, type TimePassageInterruptionReason } from "./time-passage";
import { dueActorPlanDescriptors, scheduledActorPlanDescriptors } from "./actor-plans";
import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState, DueActivityDescriptor, JsonRecord } from "./model";
import { characterTimelineId, sceneTimelineId } from "./timeline";
import { isNonEmptyString, isRecord } from "./validation";

export type ScheduledDeadlineWithin = Readonly<{
  kind: "activity" | "actorPlan" | "longSpellcasting" | "worldEffect";
  ref: string;
  atFictionMicros: string;
}>;

/** Every scheduled deadline on the character's timeline strictly after now and
 * no later than now + duration. An immediate advance of that duration steps
 * over these; Room settles them in the same request's due tail. Recorded so
 * the frequency of the case is measured before anyone pays for a staged form. */
export function scheduledDeadlinesWithin(state: AuthoritativeWorldState, characterId: string, durationMicros: string): ScheduledDeadlineWithin[] {
  const timelineId = characterTimelineId(state, characterId);
  if (timelineId === undefined || !/^[1-9][0-9]*$/.test(durationMicros)) return [];
  const now = BigInt(state.fictionTimelines[timelineId].nowMicros), end = now + BigInt(durationMicros);
  const within = (at: string) => /^(0|[1-9][0-9]*)$/.test(at) && BigInt(at) > now && BigInt(at) <= end;
  const crossed: ScheduledDeadlineWithin[] = [];
  for (const due of ordinaryActivityDescriptors(state, true)) {
    if (due.timelineId === timelineId && within(due.completionFictionMicros)) crossed.push({ kind: "activity", ref: due.activityId, atFictionMicros: due.completionFictionMicros });
  }
  for (const due of scheduledActorPlanDescriptors(state)) {
    if (due.timelineId === timelineId && due.actorPlan !== undefined && within(due.completionFictionMicros)) crossed.push({ kind: "actorPlan", ref: due.actorPlan.planId, atFictionMicros: due.completionFictionMicros });
  }
  for (const due of scheduledLongSpellcastingDescriptors(state)) {
    if (due.timelineId === timelineId && within(due.completionFictionMicros)) crossed.push({ kind: "longSpellcasting", ref: due.activityId, atFictionMicros: due.completionFictionMicros });
  }
  for (const deadline of scheduledWorldEffectDeadlines(state, { timelineId })) {
    if (within(deadline.dueMicros)) crossed.push({ kind: "worldEffect", ref: deadline.effectId, atFictionMicros: deadline.dueMicros });
  }
  return crossed.sort((left, right) => BigInt(left.atFictionMicros) < BigInt(right.atFictionMicros) ? -1
    : BigInt(left.atFictionMicros) > BigInt(right.atFictionMicros) ? 1 : left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0);
}

/** Completion is fixed by fiction time, independent of when a request resumes. */
export function activityCompletionFictionMicros(activity: JsonRecord): string | undefined {
  if (typeof activity.startedAtFictionMicros !== "string"
    || !/^(0|[1-9][0-9]*)$/.test(activity.startedAtFictionMicros)
    || typeof activity.intendedDurationMicros !== "string"
    || !/^[1-9][0-9]*$/.test(activity.intendedDurationMicros)) return undefined;
  return (BigInt(activity.startedAtFictionMicros) + BigInt(activity.intendedDurationMicros)).toString();
}

function activitySceneIds(state: AuthoritativeWorldState, activity: JsonRecord): string[] {
  const completion = isRecord(activity.completion) ? activity.completion : undefined;
  const sceneIds = new Set<string>();
  for (const sceneId of [state.entities[String(activity.characterId)]?.sceneId, completion?.sourceSceneId]) {
    if (isNonEmptyString(sceneId)) sceneIds.add(sceneId);
  }
  for (const effects of [completion?.success, completion?.failure]) {
    if (!Array.isArray(effects)) continue;
    for (const effect of effects) {
      if (isRecord(effect) && effect.kind === "moveEntity" && isNonEmptyString(effect.sceneRef)) {
        sceneIds.add(effect.sceneRef);
      }
    }
  }
  return [...sceneIds].sort();
}

/** Rules owns eligibility and identity; Room may persist these obligations.
 * ActorPlan uses its specialized Rules completion within the same queue;
 * long spellcasting uses the same queue with its frozen spell completion route.
 * Pending receipts remain visible so recovery cannot mistake them for no work. */
function ordinaryActivityDescriptors(state: AuthoritativeWorldState, includeFuture = false): DueActivityDescriptor[] {
  const due: DueActivityDescriptor[] = [];
  for (const activity of Object.values(state.campaignRuntime.activities)) {
    if (activity.status !== "active" || activity.activityKind === "timePassage" || activity.activityKind === "longSpellcasting"
      || (isRecord(activity.completion) && activity.completion.kind === "actorPlan")
      || !isNonEmptyString(activity.activityId) || !isNonEmptyString(activity.characterId)) continue;
    const timelineId = characterTimelineId(state, activity.characterId);
    const completionFictionMicros = activityCompletionFictionMicros(activity);
    if (timelineId === undefined || completionFictionMicros === undefined
      || (!includeFuture && BigInt(state.fictionTimelines[timelineId].nowMicros) < BigInt(completionFictionMicros))) continue;
    due.push({
      activityId: activity.activityId,
      ownerEntityId: activity.characterId,
      timelineId,
      completionFictionMicros,
      childRootActionId: `activity-due:${activity.activityId}:${completionFictionMicros}`,
      activityHash: canonicalSha256(activity),
      sceneIds: activitySceneIds(state, activity),
    });
  }
  return due;
}

function order(left: DueActivityDescriptor, right: DueActivityDescriptor): number {
  const a = BigInt(left.completionFictionMicros), b = BigInt(right.completionFictionMicros);
  return a < b ? -1 : a > b ? 1 : (left.actorPlan?.planId ?? left.activityId).localeCompare(right.actorPlan?.planId ?? right.activityId);
}

function micros(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value);
}

/** Pending input/randomness belongs to its existing root and cannot be bypassed
 * by a new time stage, even if its due Activity no longer appears in the queue. */
function timelineHasPendingMechanics(state: AuthoritativeWorldState, timelineId: string): boolean {
  return Object.values(state.pendingInputs).some(pending => characterTimelineId(state, pending.controllerCharacterId) === timelineId)
    || Object.values(state.receipts).some(receipt => ["awaitingInput", "awaitingRandomness"].includes(receipt.status)
      && (receipt.subjectCharacterIds.length === 0
        || receipt.subjectCharacterIds.some(id => characterTimelineId(state, id) === timelineId)));
}

export function timePassageHasPendingWork(state: AuthoritativeWorldState, timelineId: string): boolean {
  return Object.values(state.campaignRuntime.activities).some(activity => activity.status === "active"
      && characterTimelineId(state, String(activity.characterId)) === timelineId
      && activeEncounter(state, String(activity.characterId)) === undefined
      && (isRecord(activity.attention) || activityNoticeKnowledgeRefs(state, activity).length > 0))
    || timelineHasPendingMechanics(state, timelineId);
}

type ActivityTimeSchedule = { kind: "blocked"; reason?: "unsupportedDeadline" | "invalidSchedule" }
  | { kind: "complete" } | { kind: "advance"; to: string };
type TimeSchedule = { kind: "interrupt"; reason: TimePassageInterruptionReason } | ActivityTimeSchedule;

/** The next boundary is recomputed from live authority after every due root.
 * Unsupported completion families stop at their real deadline, never beyond it. */
export function timePassageSchedule(state: AuthoritativeWorldState, activity: JsonRecord): TimeSchedule {
  const unavailable = timePassageStopReason(state, activity);
  if (unavailable !== undefined) return { kind: unavailable === "invalidSchedule" ? "blocked" : "interrupt", reason: unavailable } as TimeSchedule;
  return activityTimeSchedule(state, activity, timePassageTimelineId(state, activity)!);
}

/** One deadline selector for non-combat sustained work. Family-specific legality
 * stays in its owner; neither family can cross another due root. */
function activityTimeSchedule(state: AuthoritativeWorldState, activity: JsonRecord, timelineId: string): ActivityTimeSchedule {
  const end = activityCompletionFictionMicros(activity), now = state.fictionTimelines[timelineId].nowMicros;
  if (end === undefined || !micros(now)) return { kind: "blocked", reason: "invalidSchedule" };
  const ordinary = ordinaryActivityDescriptors(state, true), actorPlans = scheduledActorPlanDescriptors(state);
  const longSpells = scheduledLongSpellcastingDescriptors(state);
  const deadlines: { at: string; unsupported?: boolean }[] = [{ at: end }];
  for (const other of Object.values(state.campaignRuntime.activities)) {
    if (other.status !== "active" || other.activityId === activity.activityId) continue;
    const owner = String(other.characterId), otherTimeline = other.activityKind === "timePassage"
      ? timePassageTimelineId(state, other) : other.activityKind === "longSpellcasting"
        ? longSpellcastingTimelineId(state, other) ?? characterTimelineId(state, owner) : characterTimelineId(state, owner);
    if (otherTimeline !== timelineId) continue;
    if (isRecord(other.completion) && other.completion.kind === "actorPlan") {
      const plan = state.campaignRuntime.npcPlans[String(other.completion.planId)];
      if (plan?.status !== "scheduled" || (isRecord(plan.due) && plan.due.kind === "fictionTime"
        && (!micros(plan.due.atFictionMicros) || !actorPlans.some(item => item.activityId === other.activityId)))) {
        return { kind: "blocked", reason: "invalidSchedule" };
      }
      continue;
    }
    const at = activityCompletionFictionMicros(other);
    if (at === undefined) return { kind: "blocked", reason: "invalidSchedule" };
    if (other.activityKind === "timePassage" && BigInt(at) <= BigInt(now)
      && (BigInt(end) > BigInt(now) || BigInt(at) < BigInt(end)
        || (at === end && String(other.activityId).localeCompare(String(activity.activityId)) < 0))) return { kind: "blocked" };
    if (other.activityKind === "longSpellcasting" && !longSpells.some(due => due.activityId === other.activityId)) {
      return { kind: "blocked", reason: "invalidSchedule" };
    }
    deadlines.push({ at });
  }
  for (const due of actorPlans.filter(due => due.timelineId === timelineId)) deadlines.push({ at: due.completionFictionMicros });
  for (const effect of Object.values(state.combatRuntime.effects)) {
    if (isWorldEffectRecordCandidate(effect) && !isWorldEffectRecord(effect)
      && characterTimelineId(state, String(effect.targetEntityId)) === timelineId) return { kind: "blocked", reason: "invalidSchedule" };
  }
  for (const due of scheduledWorldEffectDeadlines(state, { timelineId })) deadlines.push({ at: due.dueMicros });
  for (const encounter of Object.values(state.combatRuntime.encounters)) {
    if (encounter.status !== "concluded") {
      if (Array.isArray(encounter.participantEntityIds) && encounter.participantEntityIds
        .some(id => isNonEmptyString(id) && characterTimelineId(state, id) === timelineId)) return { kind: "blocked", reason: "unsupportedDeadline" };
      continue;
    }
    if (!Array.isArray(encounter.residualPhaseTasks)) continue;
    const candidate = isNonEmptyString(encounter.sceneId) ? sceneTimelineId(state, encounter.sceneId) : state.activeBranchId;
    if ((candidate in state.fictionTimelines ? candidate : state.activeBranchId) !== timelineId) continue;
    for (const task of encounter.residualPhaseTasks) {
      if (!isRecord(task) || !micros(task.dueMicros)) return { kind: "blocked", reason: "invalidSchedule" };
      deadlines.push({ at: task.dueMicros, unsupported: true });
    }
  }
  if (deadlines.some(deadline => deadline.unsupported && BigInt(deadline.at) <= BigInt(now))) return { kind: "blocked", reason: "unsupportedDeadline" };
  if (timePassageHasPendingWork(state, timelineId)) return { kind: "blocked" };
  const ownDue = BigInt(now) >= BigInt(end);
  if ([...ordinary, ...actorPlans, ...longSpells].some(due => due.activityId !== activity.activityId
    && due.timelineId === timelineId && BigInt(due.completionFictionMicros) <= BigInt(now)
    && (!ownDue || BigInt(due.completionFictionMicros) < BigInt(end)
      || (due.completionFictionMicros === end && (due.actorPlan?.planId ?? due.activityId).localeCompare(String(activity.activityId)) < 0)))) return { kind: "blocked" };
  if (BigInt(now) >= BigInt(end)) return { kind: "complete" };
  // Expired effects should have drained synchronously at their preceding time
  // transition. An unprocessed current deadline must never become a time skip.
  if (scheduledWorldEffectDeadlines(state, { timelineId }).some(due => BigInt(due.dueMicros) <= BigInt(now))) return { kind: "blocked", reason: "invalidSchedule" };
  const future = deadlines.filter(deadline => BigInt(deadline.at) > BigInt(now))
    .sort((a, b) => BigInt(a.at) < BigInt(b.at) ? -1 : BigInt(a.at) > BigInt(b.at) ? 1 : 0);
  return { kind: "advance", to: future[0]!.at };
}

export function ordinaryActivitySchedule(state: AuthoritativeWorldState, activity: JsonRecord): ActivityTimeSchedule {
  if (!activityProgressAvailable(state, activity)) return { kind: "blocked" };
  return activityTimeSchedule(state, activity, characterTimelineId(state, String(activity.characterId))!);
}

function activityProgressDescriptor(state: AuthoritativeWorldState, activity: JsonRecord): DueActivityDescriptor | undefined {
  if (!activityProgressAvailable(state, activity) || isRecord(activity.attention)) return undefined;
  const timelineId = characterTimelineId(state, String(activity.characterId))!;
  const completionRoot = isRecord(activity.completion) && activity.completion.kind === "actionExecution"
    && isRecord(activity.completion.plan) ? String(activity.completion.plan.rootActionId) : undefined;
  const dueRoot = completionRoot ?? `activity-due:${activity.activityId}:${activityCompletionFictionMicros(activity)}`;
  const resuming = ["awaitingInput", "awaitingRandomness"].includes(state.receipts[dueRoot]?.status);
  if (timelineHasPendingMechanics(state, timelineId) && !resuming) return undefined;
  const from = state.fictionTimelines[timelineId].nowMicros;
  const knowledgeRefs = activityNoticeKnowledgeRefs(state, activity);
  const schedule = resuming ? { kind: "complete" as const }
    : knowledgeRefs.length > 0 ? { kind: "attention" as const } : ordinaryActivitySchedule(state, activity);
  if (schedule.kind === "blocked" || (activity.activityKind === "longSpellcasting" && schedule.kind !== "attention")) return undefined;
  const to = schedule.kind === "advance" ? schedule.to : from;
  const at = schedule.kind === "complete" ? activityCompletionFictionMicros(activity)! : to;
  const completionBinding = structuredClone(activity);
  delete completionBinding.attention;
  delete (completionBinding.progression as JsonRecord).acknowledgedKnowledgeRefs;
  return { activityId: String(activity.activityId), ownerEntityId: String(activity.characterId), timelineId,
    completionFictionMicros: at, activityHash: canonicalSha256(schedule.kind === "complete" ? completionBinding : activity), sceneIds: activitySceneIds(state, activity),
    childRootActionId: schedule.kind === "attention" ? activityAttentionRoot(String(activity.activityId), knowledgeRefs)
      : schedule.kind === "advance" ? `activity-advance:${activity.activityId}:${from}:${to}:${canonicalSha256((activity.progression as JsonRecord).acknowledgedKnowledgeRefs).slice(7, 23)}`
        : completionRoot ?? `activity-due:${activity.activityId}:${activityCompletionFictionMicros(activity)}`,
    activityProgress: { phase: schedule.kind, completion: completionRoot === undefined ? "activity" : "action", fromFictionMicros: schedule.kind === "complete" ? at : from, toFictionMicros: at } };
}

function validLongSpellcasting(state: AuthoritativeWorldState, activity: JsonRecord): boolean {
  const completion = activity.completion, concentration = state.combatRuntime.entities[String(activity.characterId)]?.concentration;
  return activity.activityKind === "longSpellcasting" && activity.status === "active"
    && isNonEmptyString(activity.activityId) && isNonEmptyString(activity.characterId)
    && isRecord(completion) && completion.kind === "longSpellcasting" && completion.activityId === activity.activityId
    && completion.sourceEntityId === activity.characterId && isRecord(completion.definition) && isRecord(completion.parameters)
    && isRecord(concentration) && concentration.kind === "longSpellcasting" && concentration.activityId === activity.activityId
    && activityCompletionFictionMicros(activity) !== undefined;
}

function scheduledLongSpellcastingDescriptors(state: AuthoritativeWorldState): DueActivityDescriptor[] {
  return Object.values(state.campaignRuntime.activities).flatMap(activity => {
    if (!validLongSpellcasting(state, activity)) return [];
    const timelineId = longSpellcastingTimelineId(state, activity) ?? characterTimelineId(state, String(activity.characterId));
    if (timelineId === undefined) return [];
    const at = activityCompletionFictionMicros(activity)!;
    return [{ activityId: String(activity.activityId), ownerEntityId: String(activity.characterId), timelineId,
      completionFictionMicros: at, childRootActionId: `long-spell-due:${activity.activityId}:${at}`,
      activityHash: canonicalSha256(activity), sceneIds: activitySceneIds(state, activity),
      longSpellcasting: { phase: "complete" as const, fromFictionMicros: at, toFictionMicros: at } }];
  });
}

export function longSpellcastingSchedule(state: AuthoritativeWorldState, activity: JsonRecord): ActivityTimeSchedule {
  if (!validLongSpellcasting(state, activity)) return { kind: "blocked", reason: "invalidSchedule" };
  const timelineId = longSpellcastingTimelineId(state, activity) ?? characterTimelineId(state, String(activity.characterId));
  if (timelineId === undefined || characterTimelineId(state, String(activity.characterId)) !== timelineId) return { kind: "blocked", reason: "invalidSchedule" };
  const now = state.fictionTimelines[timelineId].nowMicros, at = activityCompletionFictionMicros(activity)!;
  if (!micros(now)) return { kind: "blocked", reason: "invalidSchedule" };
  if (timePassageHasPendingWork(state, timelineId)) return { kind: "blocked" };
  // Combat time belongs exclusively to turn progression, including when a
  // caster began outside combat. This scheduler never invests a combat action.
  if (activeEncounter(state, String(activity.characterId)) !== undefined) {
    return BigInt(now) >= BigInt(at) ? { kind: "complete" } : { kind: "blocked" };
  }
  return activityTimeSchedule(state, activity, timelineId);
}

function longSpellcastingDescriptor(state: AuthoritativeWorldState, activity: JsonRecord): DueActivityDescriptor | undefined {
  const timelineId = longSpellcastingTimelineId(state, activity) ?? characterTimelineId(state, String(activity.characterId));
  if (timelineId === undefined || !isNonEmptyString(activity.activityId) || !isNonEmptyString(activity.characterId)) return undefined;
  const schedule = longSpellcastingSchedule(state, activity), from = state.fictionTimelines[timelineId].nowMicros;
  if (schedule.kind === "blocked" && schedule.reason === undefined) return undefined;
  if (schedule.kind === "complete") return scheduledLongSpellcastingDescriptors(state).find(due => due.activityId === activity.activityId);
  const to = schedule.kind === "advance" ? schedule.to : from;
  return { activityId: activity.activityId, ownerEntityId: activity.characterId, timelineId,
    completionFictionMicros: to,
    childRootActionId: schedule.kind === "advance" ? `long-spell-advance:${activity.activityId}:${from}:${to}`
      : `long-spell-blocked:${activity.activityId}:${from}`,
    activityHash: canonicalSha256(activity), sceneIds: activitySceneIds(state, activity),
    longSpellcasting: { phase: schedule.kind, fromFictionMicros: from, toFictionMicros: to } };
}

function timePassageDescriptor(state: AuthoritativeWorldState, activity: JsonRecord): DueActivityDescriptor | undefined {
  const timelineId = timePassageTimelineId(state, activity);
  if (timelineId === undefined || !isNonEmptyString(activity.activityId) || !isNonEmptyString(activity.characterId)) return undefined;
  const selected = timePassageSchedule(state, activity), from = state.fictionTimelines[timelineId].nowMicros;
  if (selected.kind === "blocked" && selected.reason === undefined) return undefined;
  const phase = selected.kind === "complete" ? undefined : selected.kind;
  const to = selected.kind === "advance" ? selected.to : from;
  const completionFictionMicros = selected.kind === "complete" ? activityCompletionFictionMicros(activity)! : to;
  return { activityId: activity.activityId, ownerEntityId: activity.characterId, timelineId, completionFictionMicros,
    childRootActionId: phase === "advance" ? `time-passage-advance:${activity.activityId}:${from}:${to}`
      : phase === "interrupt" ? `time-passage-interrupt:${activity.activityId}:${from}`
      : phase === "blocked" ? `time-passage-blocked:${activity.activityId}:${from}`
      : `activity-due:${activity.activityId}:${completionFictionMicros}`,
    activityHash: canonicalSha256(activity), sceneIds: activitySceneIds(state, activity),
    ...(phase === undefined ? {} : { timePassage: { phase, fromFictionMicros: from, toFictionMicros: to } }) };
}

export function dueActivityDescriptors(state: AuthoritativeWorldState): DueActivityDescriptor[] {
  return [...ordinaryActivityDescriptors(state).filter(due => !hasActivityProgress(state.campaignRuntime.activities[due.activityId])), ...dueActorPlanDescriptors(state),
    ...Object.values(state.campaignRuntime.activities).flatMap(activity => {
      if (activity.status !== "active") return [];
      const progress = hasActivityProgress(activity) ? activityProgressDescriptor(state, activity) : undefined;
      if (progress !== undefined) return [progress];
      const descriptor = activity.activityKind === "timePassage" ? timePassageDescriptor(state, activity)
        : activity.activityKind === "longSpellcasting" ? longSpellcastingDescriptor(state, activity) : undefined;
      return descriptor === undefined ? [] : [descriptor];
    })].sort(order);
}

export function isSupersededActivityProgress(state: AuthoritativeWorldState, frozen: DueActivityDescriptor): boolean {
  if (frozen.activityProgress === undefined) return false;
  const activity = state.campaignRuntime.activities[frozen.activityId];
  if (activity === undefined || activity.characterId !== frozen.ownerEntityId) return false;
  if (frozen.activityProgress.phase === "complete" && activity.status === "active") return false;
  if (["awaitingInput", "awaitingRandomness"].includes(state.receipts[frozen.childRootActionId]?.status)) return false;
  return !dueActivityDescriptors(state).some(due => due.childRootActionId === frozen.childRootActionId
    && canonicalSha256(due) === canonicalSha256(frozen));
}

/** Room already persisted/verified this descriptor. The same Activity may
 * legitimately see another root move its source clock; only that monotonic
 * clock change can supersede the stale advance without completing the wait. */
export function isSupersededTimePassageAdvance(state: AuthoritativeWorldState, prior: DueActivityDescriptor): boolean {
  const phase = prior.timePassage, activity = state.campaignRuntime.activities[prior.activityId];
  if (phase?.phase !== "advance" || activity?.status !== "active" || activity.activityKind !== "timePassage"
    || activity.characterId !== prior.ownerEntityId || canonicalSha256(activity) !== prior.activityHash
    || timePassageTimelineId(state, activity) !== prior.timelineId
    || !micros(phase.fromFictionMicros) || !micros(phase.toFictionMicros)
    || BigInt(phase.toFictionMicros) <= BigInt(phase.fromFictionMicros)
    || prior.completionFictionMicros !== phase.toFictionMicros
    || prior.childRootActionId !== `time-passage-advance:${prior.activityId}:${phase.fromFictionMicros}:${phase.toFictionMicros}`) return false;
  const now = BigInt(state.fictionTimelines[prior.timelineId].nowMicros), from = BigInt(phase.fromFictionMicros);
  if (now > from) return true;
  if (now !== from) return false;
  const replacement = timePassageDescriptor(state, activity);
  return replacement?.timePassage?.phase === "interrupt"
    && replacement.childRootActionId !== prior.childRootActionId;
}

/** Same monotonic supersession rule for a frozen non-combat casting segment. */
export function isSupersededLongSpellcastingAdvance(state: AuthoritativeWorldState, prior: DueActivityDescriptor): boolean {
  const phase = prior.longSpellcasting, activity = state.campaignRuntime.activities[prior.activityId];
  if (phase?.phase !== "advance" || activity?.status !== "active" || activity.activityKind !== "longSpellcasting"
    || activity.characterId !== prior.ownerEntityId || canonicalSha256(activity) !== prior.activityHash
    || (longSpellcastingTimelineId(state, activity) ?? characterTimelineId(state, prior.ownerEntityId)) !== prior.timelineId
    || !micros(phase.fromFictionMicros) || !micros(phase.toFictionMicros)
    || BigInt(phase.toFictionMicros) <= BigInt(phase.fromFictionMicros)
    || prior.completionFictionMicros !== phase.toFictionMicros
    || prior.childRootActionId !== `long-spell-advance:${prior.activityId}:${phase.fromFictionMicros}:${phase.toFictionMicros}`) return false;
  return BigInt(state.fictionTimelines[prior.timelineId].nowMicros) > BigInt(phase.fromFictionMicros)
    || activeEncounter(state, prior.ownerEntityId) !== undefined
    || characterTimelineId(state, prior.ownerEntityId) !== prior.timelineId;
}
