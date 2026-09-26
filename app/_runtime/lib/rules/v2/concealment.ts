import type { RuntimeProfileManifest } from "../profiles/types";
import { conditionMechanics } from "./condition-mechanics";
import { CONCEALMENT_ATTENTION, CONCEALMENT_SENSES } from "./concealment-shapes";
import type { AuthoritativeWorldState, FrozenConcealment } from "./model";
import { skillCheckModifier } from "./proficiency";
import { isRecord } from "./validation";

export { CONCEALMENT_ATTENTION, CONCEALMENT_SENSES };
/** SPEC 0005 §6.2: how a present character's attention shifts their passive
 * Perception against a covert act. "unseen" takes them out of the comparison. */
export type ConcealmentAttention = typeof CONCEALMENT_ATTENTION[number];
const ATTENTION_ADJUSTMENT: Readonly<Record<Exclude<ConcealmentAttention, "unseen">, number>> = Object.freeze({
  watching: 5, unfocused: 0, distracted: -5,
});

/** The sense a noticer would perceive the act through. */
export type ConcealmentSense = typeof CONCEALMENT_SENSES[number];

export type ConcealmentObserver = Readonly<{
  observerRef: string;
  attention: ConcealmentAttention;
  passivePerception: number;
}>;

/** Who may notice a covert act: characters in the actor's scene, in tenure
 * and aware of their surroundings, never the actor. Rules decides this from
 * authoritative state; the model rates their attention but cannot add or drop
 * anyone. */
export function concealmentCandidates(state: AuthoritativeWorldState, actorId: string): string[] {
  const sceneId = state.entities[actorId]?.sceneId;
  if (sceneId === undefined) return [];
  return Object.values(state.entities)
    .filter((entity) => entity.id !== actorId && entity.sceneId === sceneId && entity.tenureStatus === "active"
      && !conditionMechanics(state, entity.id).unawareOfSurroundings)
    .map((entity) => entity.id)
    .sort();
}

/** 10 plus the Perception modifier: an NPC stat block's explicit skill bonus
 * when it has one, otherwise Wisdom plus proficiency as for any character. */
export function passivePerception(
  profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, entityId: string,
): number {
  const entity = state.entities[entityId];
  if (entity === undefined) return 10;
  const skills = isRecord(entity.socialMechanics) && isRecord(entity.socialMechanics.skillModifiers)
    ? entity.socialMechanics.skillModifiers : undefined;
  if (skills !== undefined && Number.isSafeInteger(skills.perception)) return 10 + Number(skills.perception);
  return 10 + (skillCheckModifier(profiles, entity, "wis", "perception") ?? 0);
}

/** The value a covert check must reach to pass this observer unnoticed, or
 * null when the observer cannot see the act at all. */
export function concealmentThreshold(observer: ConcealmentObserver): number | null {
  return observer.attention === "unseen" ? null : observer.passivePerception + ATTENTION_ADJUSTMENT[observer.attention];
}

/** A blinded observer notices nothing seen, a deafened one nothing heard. */
export function canSenseConcealment(
  state: AuthoritativeWorldState, entityId: string, sense: ConcealmentSense,
): boolean {
  const mechanics = conditionMechanics(state, entityId);
  return sense === "sight" ? mechanics.canSee : mechanics.canHear;
}

/** The observers Rules freezes for a covert check: every candidate, in
 * code-unit order, with the attention the KP declared for it ("unfocused"
 * when none), that declaration's basis and its passive Perception. A declared
 * character who is not a candidate adds no one. */
export function frozenConcealmentObservers(
  profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, actorId: string,
  declared: readonly Readonly<{ observerRef: string; attention: ConcealmentAttention; basisRefs: readonly string[] }>[],
): FrozenConcealment["observers"] {
  return concealmentCandidates(state, actorId).map((observerRef) => {
    const declaration = declared.find((entry) => entry.observerRef === observerRef);
    return { observerRef, attention: declaration?.attention ?? "unfocused",
      passivePerception: String(passivePerception(profiles, state, observerRef)),
      basisRefs: [...(declaration?.basisRefs ?? [])] };
  });
}

/** A frozen observer with its passive Perception as a number. */
export function concealmentObserver(observer: FrozenConcealment["observers"][number]): ConcealmentObserver {
  return { observerRef: observer.observerRef, attention: observer.attention, passivePerception: Number(observer.passivePerception) };
}

/** SPEC 0016 §7.3: a covert check's DC is its primary observer's threshold. */
export function concealmentDc(concealment: FrozenConcealment): number | undefined {
  const primary = concealment.observers.find((observer) => observer.observerRef === concealment.primaryObserverRef);
  const threshold = primary === undefined ? null : concealmentThreshold(concealmentObserver(primary));
  return threshold === null ? undefined : threshold;
}

/** Observers other than `primaryObserverRef` who notice a covert check that
 * totalled `total`: a check at or above an observer's threshold passes them. */
export function concealmentNoticers(
  state: AuthoritativeWorldState, total: number, observers: readonly ConcealmentObserver[],
  primaryObserverRef: string, sense: ConcealmentSense,
): string[] {
  return observers.filter((observer) => {
    if (observer.observerRef === primaryObserverRef) return false;
    const threshold = concealmentThreshold(observer);
    return threshold !== null && total < threshold && canSenseConcealment(state, observer.observerRef, sense);
  }).map((observer) => observer.observerRef);
}
