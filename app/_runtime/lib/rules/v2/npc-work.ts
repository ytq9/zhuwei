import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState, DueActivityDescriptor, EventEnvelope, JsonRecord } from "./model";
import { characterTimelineId } from "./timeline";
import { activeEncounter } from "./combat-encounters";
import { promiseLifecycle, promiseKnownTo } from "./promise-lifecycle";
import { hasExactKeys, isNonEmptyString, isRecord } from "./validation";

export const npcWorkId = (promiseId: string) => `npc-work:${promiseId}`;
export type NpcWorkDecision = { kind: "defer" | "revise" | "cancel"; reason: string; nextStep: string; wakeAtFictionMicros: string | null };
export function npcWorkDecisionConform(value: unknown): value is NpcWorkDecision {
  return isRecord(value) && hasExactKeys(value, ["kind", "reason", "nextStep", "wakeAtFictionMicros"])
    && ["defer", "revise", "cancel"].includes(String(value.kind)) && isNonEmptyString(value.reason) && value.reason.length <= 4000
    && isNonEmptyString(value.nextStep) && value.nextStep.length <= 4000
    && (value.wakeAtFictionMicros === null || typeof value.wakeAtFictionMicros === "string" && /^(0|[1-9][0-9]*)$/.test(value.wakeAtFictionMicros));
}
export function npcWorkKnownPromise(state: AuthoritativeWorldState, plan: JsonRecord): JsonRecord {
  const promise = state.campaignRuntime.promises[String(plan.promiseId)];
  return promiseKnownTo(state, promise, String(plan.npcId)) ?? plan.knownPromise as JsonRecord;
}
function wakeFingerprint(state: AuthoritativeWorldState, plan: JsonRecord): string {
  return canonicalSha256({ promise: npcWorkKnownPromise(state, plan), knowledge: state.knowledge[String(plan.npcId)] ?? {} });
}
export function npcWorkDeadlines(state: AuthoritativeWorldState): Array<{ timelineId: string; at: string }> {
  return Object.values(state.campaignRuntime.npcPlans).flatMap(plan => {
    const timelineId = characterTimelineId(state, String(plan.npcId));
    return plan.schema === "zhuwei.npc-work/vnext-1" && plan.status === "deferred" && timelineId
      && typeof plan.wakeAtFictionMicros === "string" && BigInt(plan.wakeAtFictionMicros) > BigInt(state.fictionTimelines[timelineId].nowMicros)
      ? [{ timelineId, at: plan.wakeAtFictionMicros }] : [];
  });
}
export function npcWorkDescriptors(state: AuthoritativeWorldState): DueActivityDescriptor[] {
  return Object.values(state.campaignRuntime.npcPlans).flatMap(plan => {
    if (plan.schema !== "zhuwei.npc-work/vnext-1" || plan.status === "started") return [];
    const npcId = String(plan.npcId), timelineId = characterTimelineId(state, npcId);
    if (!timelineId || activeEncounter(state, npcId) || state.entities[npcId]?.tenureStatus !== "active"
      || Object.values(state.campaignRuntime.activities).some(a => a.characterId === npcId && a.status === "active")) return [];
    const now = state.fictionTimelines[timelineId].nowMicros;
    const changedTerms = canonicalSha256(npcWorkKnownPromise(state, plan)) !== plan.knownPromiseHash;
    const ready = plan.status === "planned" || (plan.status === "deferred"
      ? wakeFingerprint(state, plan) !== plan.wakeFingerprint || typeof plan.wakeAtFictionMicros === "string" && BigInt(plan.wakeAtFictionMicros) <= BigInt(now)
      : changedTerms);
    if (!ready) return [];
    const revision = plan.decisionOrdinal ?? "0";
    return [{ activityId: null, ownerEntityId: npcId, timelineId, completionFictionMicros: now,
      childRootActionId: `npc-work-decision:${plan.planId}${revision === "0" ? "" : `:${revision}:${wakeFingerprint(state, plan)}`}`,
      activityHash: canonicalSha256(plan), sceneIds: [state.entities[npcId].sceneId],
      npcWork: { planId: String(plan.planId), planHash: canonicalSha256(plan) } }];
  });
}
export function applyNpcWorkEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  if (event.eventType === "NpcWorkProposed") {
    const p = event.payload as JsonRecord, promise = state.campaignRuntime.promises[String(p.promiseId)], life = promiseLifecycle(promise);
    if (!hasExactKeys(p, ["planId", "promiseId", "npcId", "nextStep"]) || !life || promise.promisorId !== p.npcId
      || state.entities[String(p.npcId)]?.kind !== "npc" || p.planId !== npcWorkId(String(p.promiseId))
      || Object.hasOwn(state.campaignRuntime.npcPlans, String(p.planId)) || !isNonEmptyString(p.nextStep)
      || event.visibilityPolicyId !== `visibility:knowledge-holder:${p.npcId}` || event.secrecy !== "private") throw new TypeError("npc-work:formation-invalid");
    state.campaignRuntime.npcPlans[String(p.planId)] = { schema: "zhuwei.npc-work/vnext-1", ...structuredClone(p),
      goal: promise.content, status: "planned", premiseRefs: [life.originalExpressionRef],
      // The NPC's own commitment is retained as known terms. Hidden later
      // adjudication never replaces this decision premise.
      knownPromise: { promiseId: p.promiseId, content: promise.content, condition: promise.condition, terms: structuredClone(life.terms) },
      requestedAtFictionMicros: life.fromFictionMicros, formedAtEventId: event.eventId };
    return true;
  }
  if (event.eventType === "NpcWorkDecision") {
    const p = event.payload as JsonRecord, plan = state.campaignRuntime.npcPlans[String(p.planId)];
    const due = npcWorkDescriptors(state).find(d => d.childRootActionId === event.rootActionId);
    if (!hasExactKeys(p, ["planId", "planHash", "decision"]) || !due?.npcWork || due.npcWork.planHash !== p.planHash
      || !npcWorkDecisionConform(p.decision) || !plan || event.secrecy !== "private"
      || event.visibilityPolicyId !== `visibility:knowledge-holder:${plan.npcId}`) throw new TypeError("npc-work:decision-invalid");
    const decision = p.decision, now = state.fictionTimelines[due.timelineId].nowMicros;
    if (decision.wakeAtFictionMicros !== null && (decision.kind !== "defer" || BigInt(decision.wakeAtFictionMicros) <= BigInt(now)))
      throw new TypeError("npc-work:future-wake-required");
    if (decision.kind === "revise" && decision.nextStep === plan.nextStep) throw new TypeError("npc-work:revision-unchanged");
    plan.status = decision.kind === "cancel" ? "cancelled" : decision.kind === "revise" ? "planned" : "deferred";
    plan.nextStep = decision.nextStep; plan.wakeAtFictionMicros = decision.wakeAtFictionMicros;
    plan.decisionOrdinal = String(BigInt(String(plan.decisionOrdinal ?? "0")) + 1n);
    plan.knownPromiseHash = canonicalSha256(npcWorkKnownPromise(state, plan)); plan.wakeFingerprint = wakeFingerprint(state, plan);
    const history = Array.isArray(plan.decisions) ? plan.decisions : [];
    plan.decisions = [...history, { eventId: event.eventId, atFictionMicros: now, decision: structuredClone(decision) }];
    return true;
  }
  if (event.eventType === "NpcWorkStarted") {
    const p = event.payload as JsonRecord, plan = state.campaignRuntime.npcPlans[String(p.planId)];
    if (!hasExactKeys(p, ["planId", "planHash"]) || plan?.schema !== "zhuwei.npc-work/vnext-1" || plan.status === "started"
      || canonicalSha256(plan) !== p.planHash || event.visibilityPolicyId !== `visibility:knowledge-holder:${plan.npcId}`
      || event.secrecy !== "private") throw new TypeError("npc-work:start-invalid");
    const activity = state.campaignRuntime.activities[`activity:${event.rootActionId}`];
    if (activity !== undefined ? activity.characterId !== plan.npcId || activity.status !== "active" || activity.activityKind !== "actionExecution"
      : state.receipts[event.rootActionId]?.proposalBundleSettlement === undefined) throw new TypeError("npc-work:execution-unavailable");
    plan.knownPromiseHash = canonicalSha256(npcWorkKnownPromise(state, plan)); plan.wakeFingerprint = wakeFingerprint(state, plan);
    plan.decisionOrdinal = String(BigInt(String(plan.decisionOrdinal ?? "0")) + 1n);
    plan.status = activity === undefined ? "resolved" : "started";
    plan.activityId = activity?.activityId ?? null;
    plan.startedByRootActionId = event.rootActionId;
    if (activity === undefined) plan.resolvedByEventId = event.eventId;
    return true;
  }
  return false;
}

export function npcWorkActivityTargets(state: AuthoritativeWorldState, event: EventEnvelope): string[] {
  if (event.eventType !== "ActivityCompleted" && event.eventType !== "ActivityInterrupted") return [];
  const activityId = (event.payload as JsonRecord).activityId;
  return Object.entries(state.campaignRuntime.npcPlans).flatMap(([id, plan]) =>
    plan.schema === "zhuwei.npc-work/vnext-1" && plan.status === "started" && plan.activityId === activityId ? [id] : []);
}

/** Execution ending is bookkeeping about the actual Activity. It says
 * nothing about whether the promise's terms were fulfilled. */
export function recordNpcWorkActivityOutcome(state: AuthoritativeWorldState, event: EventEnvelope): void {
  for (const id of npcWorkActivityTargets(state, event)) {
    const plan = state.campaignRuntime.npcPlans[id];
    plan.status = event.eventType === "ActivityCompleted" ? "resolved" : "interrupted";
    plan.resolvedByEventId = event.eventId;
  }
}
