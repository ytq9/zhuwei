import { RulesValidationError } from "../errors";
import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState, DueActivityDescriptor, EventEnvelope, EventPayloadByType, NpcReactionRecord } from "./model";
import { actionActivityCompletionRoot } from "./activity-progress";
import { activeEncounter } from "./combat-encounters";
import { characterTimelineId } from "./timeline";
import { hasExactKeys, hasOnlyKeys, isNonEmptyString, isRecord } from "./validation";

/** SPEC 0006 §7: every NPC other than the primary observer who noticed a
 * covert act decides once, from its own view, whether to react on the spot. */
export const NPC_REACTION_SCHEMA = "zhuwei.npc-reaction/vnext-1";
const OUTCOMES = ["reacted", "declined", "lapsed"] as const;

export function npcReactionId(rootActionId: string, resolutionId: string, npcId: string): string {
  return `npc-reaction:${canonicalSha256({ rootActionId, resolutionId, npcId }).slice(7, 39)}`;
}

export function npcReactionChildRoot(reactionId: string): string {
  return `npc-reaction-decision:${reactionId.slice("npc-reaction:".length)}`;
}

/** The roots a reaction runs in: its decision and its action's completion.
 * What those roots make others notice goes into their memory but opens no
 * further reaction within the same action. */
export function isNpcReactionRoot(state: AuthoritativeWorldState, rootActionId: string): boolean {
  return Object.values(state.campaignRuntime.npcReactions ?? {}).some(record => record.childRootActionId === rootActionId
    || actionActivityCompletionRoot(record.childRootActionId) === rootActionId);
}

/** A noticer gets a reaction only when it can act now: an NPC in tenure with
 * its own timeline, outside an encounter (combat reacts by turns) and not
 * already carrying out an activity, which a new action could not start over. */
export function npcMayReact(state: AuthoritativeWorldState, npcId: string, rootActionId: string): boolean {
  const npc = state.entities[npcId];
  return npc?.kind === "npc" && npc.tenureStatus === "active" && characterTimelineId(state, npcId) !== undefined
    && activeEncounter(state, npcId) === undefined
    && !Object.values(state.campaignRuntime.activities).some(activity => activity.characterId === npcId && activity.status === "active")
    && !isNpcReactionRoot(state, rootActionId);
}

export type NpcReactionDecision =
  | { kind: "decline"; reason: string }
  | { kind: "lapse"; code: string };

export function npcReactionDecisionConform(value: unknown): value is NpcReactionDecision {
  if (!isRecord(value)) return false;
  if (value.kind === "decline") return hasExactKeys(value, ["kind", "reason"]) && isNonEmptyString(value.reason) && value.reason.length <= 4000;
  return value.kind === "lapse" && hasExactKeys(value, ["code", "kind"]) && isNonEmptyString(value.code) && value.code.length <= 200;
}

export function npcReactionHash(record: NpcReactionRecord): `sha256:${string}` {
  return canonicalSha256(record) as `sha256:${string}`;
}

/** Open reactions are internal decision work at the instant they opened. */
export function npcReactionDescriptors(state: AuthoritativeWorldState): DueActivityDescriptor[] {
  return Object.values(state.campaignRuntime.npcReactions ?? {}).flatMap((record): DueActivityDescriptor[] => {
    if (record.status !== "open" || state.entities[record.npcId] === undefined) return [];
    const reactionHash = npcReactionHash(record);
    return [{ activityId: null, ownerEntityId: record.npcId, timelineId: record.timelineId,
      completionFictionMicros: record.openedAtFictionMicros, childRootActionId: record.childRootActionId,
      activityHash: reactionHash, sceneIds: [state.entities[record.npcId].sceneId],
      npcReaction: { reactionId: record.reactionId, reactionHash } }];
  });
}

/** The one event that closes a reaction. A reacting NPC's closes after its
 * act resolves in the reaction's root; declining or lapsing is the root. */
export function npcReactionSettlementDraft(record: NpcReactionRecord, outcome: "reacted" | "declined" | "lapsed", reason: string | null) {
  return { eventType: "NpcReactionSettled" as const,
    payload: { reactionId: record.reactionId, characterId: record.npcId, reactionHash: npcReactionHash(record), outcome, reason },
    reads: [`npc-reaction:${record.reactionId}`], writes: [`npc-reaction:${record.reactionId}`],
    visibilityPolicyId: `visibility:knowledge-holder:${record.npcId}`, secrecy: "private" as const };
}

/** The open reaction whose act this resolution in `rootActionId` is. */
export function openNpcReactionActedIn(state: AuthoritativeWorldState, rootActionId: string, actorId: string): NpcReactionRecord | undefined {
  return Object.values(state.campaignRuntime.npcReactions ?? {}).find(record => record.status === "open"
    && record.childRootActionId === rootActionId && record.npcId === actorId);
}

export function isNpcReactionOpenedPayload(value: unknown): value is EventPayloadByType["NpcReactionOpened"] {
  return isRecord(value) && hasExactKeys(value, ["characterId", "factId", "reactionId", "resolutionId"])
    && [value.characterId, value.factId, value.reactionId, value.resolutionId].every(isNonEmptyString);
}

export function isNpcReactionSettledPayload(value: unknown): value is EventPayloadByType["NpcReactionSettled"] {
  return isRecord(value) && hasExactKeys(value, ["characterId", "outcome", "reactionHash", "reactionId", "reason"])
    && isNonEmptyString(value.characterId) && isNonEmptyString(value.reactionId)
    && typeof value.reactionHash === "string" && /^sha256:[0-9a-f]{64}$/.test(value.reactionHash)
    && (OUTCOMES as readonly unknown[]).includes(value.outcome)
    && (value.outcome === "reacted" ? value.reason === null
      : isNonEmptyString(value.reason) && value.reason.length <= 4000);
}

export function isNpcReactionRecord(value: unknown): value is NpcReactionRecord {
  return isRecord(value) && hasOnlyKeys(value, ["childRootActionId", "factId", "npcId", "openedAtEventId", "openedAtFictionMicros",
    "reactionId", "resolutionId", "schema", "sourceRootActionId", "status", "timelineId"], ["reason", "settledByEventId"])
    && value.schema === NPC_REACTION_SCHEMA
    && [value.childRootActionId, value.factId, value.npcId, value.openedAtEventId, value.reactionId, value.resolutionId,
      value.sourceRootActionId, value.timelineId].every(isNonEmptyString)
    && typeof value.openedAtFictionMicros === "string" && /^(0|[1-9][0-9]*)$/.test(value.openedAtFictionMicros)
    && ["open", ...OUTCOMES].includes(String(value.status))
    && (value.reason === undefined || isNonEmptyString(value.reason))
    && (value.settledByEventId === undefined || isNonEmptyString(value.settledByEventId));
}

export function applyNpcReactionEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  if (event.eventType === "NpcReactionOpened") {
    const p = event.payload;
    if (!isNpcReactionOpenedPayload(p) || p.reactionId !== npcReactionId(event.rootActionId, p.resolutionId, p.characterId)
      || Object.hasOwn(state.campaignRuntime.npcReactions ?? {}, p.reactionId)
      || state.knowledge[p.characterId]?.[p.factId] === undefined || !npcMayReact(state, p.characterId, event.rootActionId)
      || event.secrecy !== "private" || event.visibilityPolicyId !== `visibility:knowledge-holder:${p.characterId}`) {
      throw new RulesValidationError("npc-reaction:opening-invalid");
    }
    const timelineId = characterTimelineId(state, p.characterId)!;
    state.campaignRuntime.npcReactions ??= {};
    state.campaignRuntime.npcReactions[p.reactionId] = { schema: NPC_REACTION_SCHEMA, reactionId: p.reactionId, npcId: p.characterId,
      factId: p.factId, resolutionId: p.resolutionId, sourceRootActionId: event.rootActionId,
      childRootActionId: npcReactionChildRoot(p.reactionId), timelineId,
      openedAtFictionMicros: state.fictionTimelines[timelineId].nowMicros, openedAtEventId: event.eventId, status: "open" };
    return true;
  }
  if (event.eventType === "NpcReactionSettled") {
    const p = event.payload, record = isNpcReactionSettledPayload(p) ? state.campaignRuntime.npcReactions?.[p.reactionId] : undefined;
    if (!isNpcReactionSettledPayload(p) || record === undefined || record.status !== "open" || record.npcId !== p.characterId
      || npcReactionHash(record) !== p.reactionHash || record.childRootActionId !== event.rootActionId
      || event.secrecy !== "private" || event.visibilityPolicyId !== `visibility:knowledge-holder:${record.npcId}`) {
      throw new RulesValidationError("npc-reaction:settlement-invalid");
    }
    // Declining or lapsing is the whole root. A reacting NPC's closes after
    // its own act resolved in this root (world interaction finalization).
    if (p.outcome !== "reacted" && state.receipts[event.rootActionId] !== undefined) {
      throw new RulesValidationError("npc-reaction:settlement-not-alone");
    }
    record.status = p.outcome;
    if (p.reason !== null) record.reason = p.reason;
    record.settledByEventId = event.eventId;
    return true;
  }
  return false;
}
