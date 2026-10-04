import { coverLevel, type CoverLevel } from "../profiles/combat-geometry";
import type { RuntimeProfileManifest } from "../profiles/types";
import { conditionMechanics } from "./condition-mechanics";
import { concealmentObserver, concealmentThreshold, defaultConcealmentAttention, passivePerception } from "./concealment";
import type { AuthoritativeWorldState, EventEnvelope, FrozenConcealment, JsonRecord } from "./model";
import { hiddenCondition, type HiddenCondition } from "./spatial-visibility";
import { isNonEmptyString, isRecord } from "./validation";

// SPEC 0004 §4 (ADR 0093, ADR 0094): hiding outside combat. The actor rolls
// Dexterity (Stealth); each NPC in its scene that cannot see at all, or whose
// threshold plus the cover adjustment the total beats, loses sight of where it
// is. Only NPCs are compared (SPEC 0005 §6.2): player characters keep seeing a
// hider and learn of it from what happens. The record lives on the hider's
// combat entity as `conditions.hidden`, and every change to it is a
// ConditionChanged that Rules emits.

export { hiddenCondition, type HiddenCondition };

/** SPEC 0004 §4 (ADR 0094): what the cover between an NPC and the hider
 * adds to the NPC's threshold. Hiding in the open is possible but hard;
 * full cover makes it easier than the bare threshold. */
export const HIDE_COVER_DC_ADJUSTMENT: Readonly<Record<CoverLevel, number>> = Object.freeze({
  none: 5, half: 2, threeQuarters: 0, full: -2,
});

export type HiddenConditionDraft = {
  eventType: "ConditionChanged";
  payload: JsonRecord;
  visibilityPolicyId: string;
  secrecy: "internal";
};

/** The conditions with `hidden` replaced, or left out when nobody remains. */
export function withHidden(conditions: unknown, hidden: HiddenCondition | undefined): JsonRecord {
  const { hidden: _prior, ...rest } = isRecord(conditions) ? conditions : {};
  return hidden === undefined || hidden.fromIds.length === 0 ? rest
    : { ...rest, hidden: { stealthTotal: hidden.stealthTotal, fromIds: [...new Set(hidden.fromIds)].sort() } };
}

/** The NPCs a hide is compared against: those in the actor's scene, in
 * tenure and aware of their surroundings, never the actor. None refuses the
 * hide (`hide:no-one-to-hide-from`). */
export function hideObserverCandidates(state: AuthoritativeWorldState, actorId: string): string[] {
  const sceneId = state.entities[actorId]?.sceneId;
  if (sceneId === undefined) return [];
  return Object.values(state.entities)
    .filter(entity => entity.id !== actorId && entity.kind === "npc" && entity.sceneId === sceneId && entity.tenureStatus === "active"
      && state.combatRuntime.entities[entity.id]?.sceneId === sceneId && !conditionMechanics(state, entity.id).unawareOfSurroundings)
    .map(entity => entity.id)
    .sort();
}

/** The cover the hider has from the observer, read as an attack from the
 * observer reads it; none when either has no body on the map. */
export function hideCover(state: AuthoritativeWorldState, observerId: string, hiderId: string): CoverLevel {
  const observer = state.combatRuntime.entities[observerId], hider = state.combatRuntime.entities[hiderId];
  if (!isRecord(observer) || !isRecord(hider) || observer.sceneId !== hider.sceneId || !isRecord(observer.position)
    || !isRecord(observer.footprint) || !isRecord(hider.position) || !isRecord(hider.footprint)) return "none";
  const scene = state.combatRuntime.scenes[String(observer.sceneId)];
  return coverLevel(isRecord(scene) ? scene : undefined, observer, hider, Object.values(state.combatRuntime.entities));
}

/** An NPC's threshold outside a frozen concealment: its passive Perception
 * shifted by the attention Rules assumes. */
function defaultThreshold(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, observerId: string): number {
  return concealmentThreshold({ observerRef: observerId, attention: defaultConcealmentAttention(state, observerId),
    passivePerception: passivePerception(profiles, state, observerId) }) ?? Number.POSITIVE_INFINITY;
}

/** Who a Stealth total of `total` hides the actor from: each candidate that
 * cannot see, and each whose DC the total beats. The DC is the candidate's
 * threshold -- its frozen one when the step's concealment froze it, else its
 * passive Perception with Rules' default attention -- plus the cover
 * adjustment. One frozen as unable to see the act ("unseen") has no threshold
 * to beat. `excluded` observers perceived the actor in this outcome. */
export function hiddenFromIds(
  profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, actorId: string, total: number,
  concealment: FrozenConcealment | undefined, excluded: ReadonlySet<string>,
): string[] {
  return hideObserverCandidates(state, actorId).filter(observerId => {
    if (excluded.has(observerId)) return false;
    if (!conditionMechanics(state, observerId).canSee) return true;
    const frozen = concealment?.observers.find(observer => observer.observerRef === observerId);
    const threshold = frozen === undefined ? defaultThreshold(profiles, state, observerId) : concealmentThreshold(concealmentObserver(frozen));
    return threshold === null || total > threshold + HIDE_COVER_DC_ADJUSTMENT[hideCover(state, observerId, actorId)];
  });
}

function draft(state: AuthoritativeWorldState, hiderId: string, hidden: HiddenCondition | undefined): HiddenConditionDraft {
  return { eventType: "ConditionChanged", payload: { entityId: hiderId, conditions: withHidden(state.combatRuntime.entities[hiderId]!.conditions, hidden) },
    visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" };
}

/** Narrows each hider's record to `keep`; one draft per hider that changes. */
function narrowed(state: AuthoritativeWorldState, keep: (hiderId: string, observerId: string, hidden: HiddenCondition) => boolean): HiddenConditionDraft[] {
  return Object.keys(state.combatRuntime.entities).sort().flatMap(hiderId => {
    const hidden = hiddenCondition(state.combatRuntime.entities[hiderId]!.conditions);
    if (hidden === undefined) return [];
    const fromIds = hidden.fromIds.filter(observerId => keep(hiderId, observerId, hidden));
    return fromIds.length === hidden.fromIds.length ? [] : [draft(state, hiderId, { ...hidden, fromIds })];
  });
}

/** The hider attacked or spoke: nobody is fooled any more. */
export function hiddenEndDrafts(state: AuthoritativeWorldState, hiderId: string): HiddenConditionDraft[] {
  return narrowed(state, hider => hider !== hiderId);
}

/** Observers that perceived a hider in a resolved outcome see it again;
 * `pairs` are each perception's observer and subject. */
export function hiddenRevealDrafts(state: AuthoritativeWorldState,
  pairs: readonly Readonly<{ observerRef: string; subjectRef: string | null }>[]): HiddenConditionDraft[] {
  return narrowed(state, (hiderId, observerId) => !pairs.some(pair => pair.subjectRef === hiderId && pair.observerRef === observerId));
}

/** The hiders a Perception check totalling `total` by `finderId` finds: those
 * hiding from it in its scene whose Stealth total it meets. */
export function hidersFoundBy(state: AuthoritativeWorldState, finderId: string, total: number): string[] {
  const sceneId = state.entities[finderId]?.sceneId;
  return Object.keys(state.combatRuntime.entities).sort().filter(hiderId => {
    const hidden = hiddenCondition(state.combatRuntime.entities[hiderId]!.conditions);
    return hidden !== undefined && hidden.fromIds.includes(finderId) && state.entities[hiderId]?.sceneId === sceneId
      && total >= Number(hidden.stealthTotal);
  });
}

/** Drops `finderId` from each hider in `hiderIds`. */
export function hiddenFoundDrafts(state: AuthoritativeWorldState, finderId: string, hiderIds: readonly string[]): HiddenConditionDraft[] {
  return narrowed(state, (hiderId, observerId) => !(observerId === finderId && hiderIds.includes(hiderId)));
}

/** After anything moved, each NPC a hider is hidden from is weighed again
 * where both now stand: it stays fooled while it is in the hider's scene and
 * either cannot see or the Stealth total still beats its passive Perception
 * with Rules' default attention plus the current cover adjustment. A hider
 * that left its observers' scene is seen by all of them again. Moving never
 * adds anyone; only a new hide does. */
export function hiddenRecheckDrafts(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState): HiddenConditionDraft[] {
  return narrowed(state, (hiderId, observerId, hidden) => {
    const sceneId = state.entities[hiderId]?.sceneId, observer = state.entities[observerId];
    if (sceneId === undefined || state.combatRuntime.entities[hiderId]?.sceneId !== sceneId || observer?.sceneId !== sceneId
      || observer.tenureStatus !== "active" || state.combatRuntime.entities[observerId]?.sceneId !== sceneId) return false;
    return !conditionMechanics(state, observerId).canSee || Number(hidden.stealthTotal)
      > defaultThreshold(profiles, state, observerId) + HIDE_COVER_DC_ADJUSTMENT[hideCover(state, observerId, hiderId)];
  });
}

const MOVEMENT_EVENT_TYPES: ReadonlySet<string> = new Set([
  "CharacterRepositioned", "MovementSegmentCommitted", "CreaturePushed", "CharacterJumped", "CharacterMoved", "PartyMoved",
]);

/** The hidden records an event ends or narrows, as Rules' own follow-ups:
 * any committed movement re-weighs every pair; an attack ends its attacker's
 * hiding. World interactions end it for their own attacks, conversations and
 * perceptions where they resolve. */
export function hiddenFollowupDrafts(
  profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, event: EventEnvelope,
): HiddenConditionDraft[] {
  if (MOVEMENT_EVENT_TYPES.has(event.eventType)) return hiddenRecheckDrafts(profiles, state);
  const payload = event.payload as JsonRecord;
  if (event.eventType === "AbilityInvoked" && isNonEmptyString(payload.sourceEntityId) && isRecord(payload.mechanicalResult)
    && (isRecord(payload.mechanicalResult.attack)
      || (isRecord(payload.mechanicalResult.attacks) && Object.keys(payload.mechanicalResult.attacks).length > 0))) {
    return hiddenEndDrafts(state, payload.sourceEntityId);
  }
  if (event.eventType === "EnvironmentFeatureDamaged" && isNonEmptyString(payload.actorCharacterId) && Array.isArray(payload.attackRolls)) {
    return hiddenEndDrafts(state, payload.actorCharacterId);
  }
  return [];
}
