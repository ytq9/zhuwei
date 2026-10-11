import { RulesValidationError } from "../errors";
import { coverLevel, type CoverLevel } from "../profiles/combat-geometry";
import type { RuntimeProfileManifest } from "../profiles/types";
import { activeEncounter } from "./combat-encounters";
import { weaponDamageDieFrom } from "./effect-modifiers";
import { zoneBlocksSight } from "./zone-effects";
import { conditionAbilityCheck, conditionMechanics, conditionSourceRefs, type ConditionRollMode } from "./condition-mechanics";
import { passivePerception } from "./concealment";
import type { AuthoritativeWorldState, EventEnvelope, JsonRecord } from "./model";
import { hiddenCondition, hidingOpponents, type HiddenCondition } from "./spatial-visibility";
import { skillCheckModifier } from "./proficiency";
import { hasExactKeys, isNonEmptyString, isRecord } from "./validation";
import type { WorldInteractionDiceSpec } from "./world-interaction-randomness";

// SPEC 0004 §4 (ADR 0097): hiding outside encounters. The hider rolls
// Dexterity (Stealth) and keeps the total as `conditions.hidden` on its combat
// entity. From then on every opponent -- NPCs for a player character, player
// characters for an NPC -- loses sight of it, while its own side still sees
// it. After each action committed in its scene, every opponent that can see
// it (it is not behind full cover from them, they are not blinded) gets a
// Perception roll that Rules makes with the action's own authoritative dice;
// the first whose roll plus modifier plus the cover adjustment reaches the
// Stealth total finds it, and the hiding ends for everyone. Attacking,
// speaking, being perceived in an outcome, a Perception search that reaches
// the total and leaving the scene end it as well. Every change is a
// ConditionChanged that Rules emits. Inside an encounter (SPEC 0012 §6.3) the
// rolls come at each opponent's turn start and when a hider walks into its
// view on its turn; combat-actions makes them with
// `encounterPerceptionDiceSpecs`. Each roll is the perceiver's ability check:
// its conditions give it advantage or disadvantage as for any other.

export { hiddenCondition, type HiddenCondition };

/** SPEC 0004 §4 (ADR 0097): what the cover between a perceiver and the hider
 * adds to the perceiver's Perception total. Behind full cover the hider is out
 * of the perceiver's sight, and it neither rolls nor searches it out. */
export const PERCEPTION_COVER_ADJUSTMENT: Readonly<Record<Exclude<CoverLevel, "full">, number>> = Object.freeze({
  none: 5, half: 2, threeQuarters: 0,
});

export type HiddenConditionDraft = {
  eventType: "ConditionChanged";
  payload: JsonRecord;
  visibilityPolicyId: string;
  secrecy: "internal";
};

/** One opponent's Perception roll against a hider: the d20, its Perception
 * modifier, the cover adjustment and their sum. */
export type HiddenPerceptionRoll = Readonly<{ perceiverRef: string; roll: number; modifier: number; coverAdjustment: number; total: number }>;

/** SPEC 0004 §4 (ADR 0097): the Perception rolls made against one hider after
 * an action, in the order they were made, and who found it, if anyone did.
 * Rolling stops at the finder. */
export type HiddenPerceptionRolledPayload = Readonly<{
  hiderRef: string;
  sceneRef: string;
  stealthTotal: string;
  rolls: readonly HiddenPerceptionRoll[];
  foundByRef: string | null;
}>;

export type HiddenPerceptionDraft = HiddenConditionDraft | {
  eventType: "HiddenPerceptionRolled";
  payload: HiddenPerceptionRolledPayload;
  visibilityPolicyId: string;
  secrecy: "internal";
};

const PERCEPTION_PURPOSE_PREFIX = "hidden-perception:";
const CANONICAL_INTEGER = /^-?(0|[1-9][0-9]*)$/;

/** The conditions with `hidden` replaced, or left out. */
export function withHidden(conditions: unknown, hidden: HiddenCondition | undefined): JsonRecord {
  const { hidden: _prior, ...rest } = isRecord(conditions) ? conditions : {};
  return hidden === undefined ? rest : { ...rest, hidden: { stealthTotal: hidden.stealthTotal } };
}

/** In tenure, in `sceneId` and with a body on that scene's map. */
function present(state: AuthoritativeWorldState, id: string, sceneId: string): boolean {
  const entity = state.entities[id];
  return entity?.sceneId === sceneId && entity.tenureStatus === "active" && state.combatRuntime.entities[id]?.sceneId === sceneId;
}

/** The hider's opponents present in its scene and aware of their
 * surroundings, in code-unit order. With none, there is nobody to hide from
 * (`hide:no-one-to-hide-from`). */
export function hidingObservers(state: AuthoritativeWorldState, hiderId: string): string[] {
  const sceneId = state.entities[hiderId]?.sceneId;
  if (sceneId === undefined) return [];
  return Object.keys(state.entities)
    .filter(id => id !== hiderId && hidingOpponents(state, hiderId, id) && present(state, id, sceneId)
      && !conditionMechanics(state, id).unawareOfSurroundings)
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

/** What `perceiverId` adds to its Perception total against `hiderId`, or
 * undefined when it cannot see the hider at all: it cannot see (blinded,
 * unconscious, dead) or the hider is behind full cover from it. */
export function perceptionCoverAdjustment(state: AuthoritativeWorldState, perceiverId: string, hiderId: string): number | undefined {
  if (!conditionMechanics(state, perceiverId).canSee) return undefined;
  // SRD 5.1 Fog Cloud: no one sees into or through a heavily obscured area.
  const perceiver = state.combatRuntime.entities[perceiverId], hider = state.combatRuntime.entities[hiderId];
  if (perceiver !== undefined && hider !== undefined && zoneBlocksSight(state, perceiver, hider)) return undefined;
  const cover = hideCover(state, perceiverId, hiderId);
  return cover === "full" ? undefined : PERCEPTION_COVER_ADJUSTMENT[cover];
}

/** A Perception modifier: an NPC stat block's own bonus, else Wisdom and
 * proficiency, as passive Perception counts it. */
export function perceptionModifier(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, id: string): number {
  return passivePerception(profiles, state, id) - 10;
}

/** SPEC 0012 §6.3 (ADR 0097): a creature's Dexterity (Stealth) modifier, read
 * the way Perception is: an NPC stat block's own bonus, else Dexterity and
 * proficiency from its character record, else from its combat statistics. */
export function stealthModifier(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, id: string): number {
  const entity = state.entities[id];
  const skills = isRecord(entity?.socialMechanics) && isRecord(entity.socialMechanics.skillModifiers)
    ? entity.socialMechanics.skillModifiers : undefined;
  if (skills !== undefined && Number.isSafeInteger(skills.stealth)) return Number(skills.stealth);
  return skillCheckModifier(profiles, entity, "dex", "stealth")
    ?? skillCheckModifier(profiles, state.combatRuntime.entities[id], "dex", "stealth") ?? 0;
}

/** SPEC 0004 §4 (ADR 0097): the d20s an action in `sceneRef` freezes before
 * anyone rolls, one for each aware opponent able to see of each creature
 * hidden there and of `hidingActorId` when the action may hide it. Who
 * actually rolls is decided once the action has settled, so a die may go
 * unused; one who arrived during the action has no die and does not roll this
 * time. A hider inside an encounter gets none. */
export function hiddenPerceptionDiceSpecs(state: AuthoritativeWorldState, sceneRef: string, hidingActorId?: string): WorldInteractionDiceSpec[] {
  return Object.keys(state.combatRuntime.entities).sort().flatMap(hiderRef => {
    if (!present(state, hiderRef, sceneRef) || activeEncounter(state, hiderRef) !== undefined
      || (hiderRef !== hidingActorId && hiddenCondition(state.combatRuntime.entities[hiderRef]!.conditions) === undefined)) return [];
    return hidingObservers(state, hiderRef).filter(perceiverRef => conditionMechanics(state, perceiverRef).canSee)
      .map(perceiverRef => perceptionSpec(state, hiderRef, perceiverRef, sceneRef));
  });
}

/** SPEC 0004 §4, SPEC 0012 §6.3: a Perception roll is the perceiver's
 * ability check, so its conditions set the mode as they do any other's --
 * poisoned or exhausted, disadvantage; a source of its fear in sight, too. A
 * fear source without a body on the map is left out, as unknown. */
export function perceptionCheckMode(state: AuthoritativeWorldState, perceiverRef: string, hiderRef?: string): ConditionRollMode {
  // SRD Hunter's Mark: Perception to find the creature the perceiver marked.
  const marked = hiderRef !== undefined && weaponDamageDieFrom(state, hiderRef, perceiverRef) !== undefined;
  return conditionAbilityCheck(state, perceiverRef, { visibleFearSourceRefs: fearSourcesInSight(state, perceiverRef),
    ...(marked ? { advantageReasons: ["markedQuarry2014"] } : {}) }).mode;
}

function fearSourcesInSight(state: AuthoritativeWorldState, perceiverRef: string): string[] | undefined {
  const refs = conditionSourceRefs(state, perceiverRef, "frightened");
  const perceiver = state.combatRuntime.entities[perceiverRef];
  if (refs.length === 0 || !conditionMechanics(state, perceiverRef).canSee) return [];
  if (!isRecord(perceiver) || !isRecord(perceiver.position) || !isRecord(perceiver.footprint)) return undefined;
  const scene = state.combatRuntime.scenes[String(perceiver.sceneId)];
  const seen: string[] = [];
  for (const ref of refs) {
    const source = state.combatRuntime.entities[ref];
    if (!isRecord(source) || !isRecord(source.position) || !isRecord(source.footprint)) return undefined;
    if (source.sceneId !== perceiver.sceneId || conditionMechanics(state, ref).conditions.invisible === true) continue;
    if (coverLevel(isRecord(scene) ? scene : undefined, perceiver, source, Object.values(state.combatRuntime.entities)) !== "full") seen.push(ref);
  }
  return seen;
}

/** One perceiver's d20s against one hider: two when its conditions give the
 * roll advantage or disadvantage, which the spec freezes beside them. */
function perceptionSpec(state: AuthoritativeWorldState, hiderRef: string, perceiverRef: string, sceneRef: string): WorldInteractionDiceSpec {
  const mode = perceptionCheckMode(state, perceiverRef, hiderRef);
  return { purposeKey: `${PERCEPTION_PURPOSE_PREFIX}${hiderRef}:${perceiverRef}`, dice: [{ count: mode === "normal" ? "1" : "2", sides: "20" }],
    frozenParameters: { hiderRef, perceiverRef, sceneRef, ...(mode === "normal" ? {} : { mode }) } };
}

/** The d20 a frozen Perception roll keeps: the higher with advantage, the
 * lower with disadvantage, else its one die. */
function perceptionFace(spec: WorldInteractionDiceSpec, faces: ReadonlyMap<string, readonly number[]>): number | undefined {
  const rolled = faces.get(spec.purposeKey);
  if (rolled === undefined || rolled.length === 0) return undefined;
  const mode = spec.frozenParameters.mode;
  return mode === "advantage" ? Math.max(...rolled) : mode === "disadvantage" ? Math.min(...rolled) : rolled[0];
}

/** SPEC 0014 §4 (ADR 0091, 0097): the rolls a map move outside an encounter
 * brings once the mover stands at its destination: each aware opponent that
 * sees a creature hidden in the scene now rolls once. A map move has no other
 * dice, so who rolls is known before anyone does. */
export function sceneHiddenPerceptionDiceSpecs(state: AuthoritativeWorldState, sceneRef: string): WorldInteractionDiceSpec[] {
  return hiddenPerceptionDiceSpecs(state, sceneRef).filter(spec =>
    perceptionCoverAdjustment(state, String(spec.frozenParameters.perceiverRef), String(spec.frozenParameters.hiderRef)) !== undefined);
}

/** SPEC 0004 §4, SPEC 0012 §6.3 (ADR 0097): inside an encounter, the d20s
 * `perceiverRef` rolls against the opponents hidden in its encounter that it
 * can see now -- at the start of its turn, or, with `hiderRefs`, against those
 * that just walked into its view on its turn. A perceiver that is unaware of
 * its surroundings or cannot see rolls nothing. */
export function encounterPerceptionDiceSpecs(
  state: AuthoritativeWorldState, perceiverRef: string, hiderRefs?: readonly string[],
): WorldInteractionDiceSpec[] {
  const encounter = activeEncounter(state, perceiverRef);
  const sceneRef = state.entities[perceiverRef]?.sceneId;
  if (encounter === undefined || sceneRef === undefined || !present(state, perceiverRef, sceneRef)
    || conditionMechanics(state, perceiverRef).unawareOfSurroundings || !Array.isArray(encounter.participantEntityIds)) return [];
  return encounter.participantEntityIds.filter(isNonEmptyString)
    .filter(hiderRef => hiderRef !== perceiverRef && (hiderRefs === undefined || hiderRefs.includes(hiderRef))
      && hiddenCondition(state.combatRuntime.entities[hiderRef]?.conditions) !== undefined
      && hidingOpponents(state, hiderRef, perceiverRef) && present(state, hiderRef, sceneRef)
      && perceptionCoverAdjustment(state, perceiverRef, hiderRef) !== undefined)
    .sort().map(hiderRef => perceptionSpec(state, hiderRef, perceiverRef, sceneRef));
}

/** Whether a frozen spec is one of `hiddenPerceptionDiceSpecs`: one d20, or
 * two beside the advantage or disadvantage that asked for them. */
export function isHiddenPerceptionDiceSpec(spec: WorldInteractionDiceSpec): boolean {
  const parameters = spec.frozenParameters;
  const moded = parameters.mode === "advantage" || parameters.mode === "disadvantage";
  return spec.purposeKey === `${PERCEPTION_PURPOSE_PREFIX}${String(parameters.hiderRef)}:${String(parameters.perceiverRef)}`
    && hasExactKeys(parameters, moded ? ["hiderRef", "mode", "perceiverRef", "sceneRef"] : ["hiderRef", "perceiverRef", "sceneRef"])
    && [parameters.hiderRef, parameters.perceiverRef, parameters.sceneRef].every(isNonEmptyString)
    && spec.dice.length === 1 && spec.dice[0]!.count === (moded ? "2" : "1") && spec.dice[0]!.sides === "20";
}

/** SPEC 0004 §4 (ADR 0097): an action has settled. Each creature still hidden
 * in the scene its dice were frozen for meets, in code-unit order, every
 * opponent there that can see it now; each rolls the face frozen for it, and
 * the first whose total reaches the Stealth total finds it, ending the hiding
 * for everyone, so the rest do not roll. A hider nobody could look at gets no
 * record. The drafts are one record per hider that met a roll, each followed
 * by its ConditionChanged when it was found. `scope` says whether the hiders
 * are outside encounters (rolls after actions) or inside one (SPEC 0012 §6.3:
 * rolls at turn starts and on walking into view). */
export function hiddenPerceptionDrafts(
  profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, specs: readonly WorldInteractionDiceSpec[],
  faces: ReadonlyMap<string, readonly number[]>, scope: "outsideEncounters" | "encounter" = "outsideEncounters",
): HiddenPerceptionDraft[] {
  const byHider = new Map<string, WorldInteractionDiceSpec[]>();
  for (const spec of specs.filter(isHiddenPerceptionDiceSpec)) {
    const hiderRef = String(spec.frozenParameters.hiderRef);
    byHider.set(hiderRef, [...byHider.get(hiderRef) ?? [], spec]);
  }
  return [...byHider.keys()].sort().flatMap((hiderRef): HiddenPerceptionDraft[] => {
    const entries = byHider.get(hiderRef)!;
    const sceneRef = String(entries[0]!.frozenParameters.sceneRef);
    const hidden = hiddenCondition(state.combatRuntime.entities[hiderRef]?.conditions);
    if (hidden === undefined || !present(state, hiderRef, sceneRef)
      || (activeEncounter(state, hiderRef) !== undefined) !== (scope === "encounter")) return [];
    const stealthTotal = Number(hidden.stealthTotal);
    const rolls: HiddenPerceptionRoll[] = [];
    let foundByRef: string | null = null;
    for (const entry of [...entries].sort((left, right) => left.purposeKey < right.purposeKey ? -1 : 1)) {
      const perceiverRef = String(entry.frozenParameters.perceiverRef), face = perceptionFace(entry, faces);
      if (face === undefined || String(entry.frozenParameters.sceneRef) !== sceneRef || !hidingOpponents(state, hiderRef, perceiverRef)
        || !present(state, perceiverRef, sceneRef)) continue;
      const coverAdjustment = perceptionCoverAdjustment(state, perceiverRef, hiderRef);
      if (coverAdjustment === undefined) continue;
      const modifier = perceptionModifier(profiles, state, perceiverRef);
      rolls.push({ perceiverRef, roll: face, modifier, coverAdjustment, total: face + modifier + coverAdjustment });
      if (face + modifier + coverAdjustment >= stealthTotal) { foundByRef = perceiverRef; break; }
    }
    if (rolls.length === 0) return [];
    return [{ eventType: "HiddenPerceptionRolled", payload: { hiderRef, sceneRef, stealthTotal: hidden.stealthTotal, rolls, foundByRef },
      visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" },
    ...(foundByRef === null ? [] : hiddenEndDrafts(state, hiderRef))];
  });
}

export function isHiddenPerceptionRolledPayload(value: unknown): value is HiddenPerceptionRolledPayload {
  if (!isRecord(value) || !hasExactKeys(value, ["foundByRef", "hiderRef", "rolls", "sceneRef", "stealthTotal"])
    || !isNonEmptyString(value.hiderRef) || !isNonEmptyString(value.sceneRef)
    || typeof value.stealthTotal !== "string" || !CANONICAL_INTEGER.test(value.stealthTotal) || value.stealthTotal === "-0"
    || !Array.isArray(value.rolls) || value.rolls.length === 0 || value.rolls.length > 64
    || !(value.foundByRef === null || isNonEmptyString(value.foundByRef))) return false;
  const stealthTotal = Number(value.stealthTotal), rolls = value.rolls as unknown[];
  const adjustments: readonly number[] = Object.values(PERCEPTION_COVER_ADJUSTMENT);
  const last = rolls.at(-1);
  return rolls.every((roll, index) => isRecord(roll) && hasExactKeys(roll, ["coverAdjustment", "modifier", "perceiverRef", "roll", "total"])
      && isNonEmptyString(roll.perceiverRef) && roll.perceiverRef !== value.hiderRef
      && (index === 0 || String((rolls[index - 1] as JsonRecord).perceiverRef) < roll.perceiverRef)
      && Number.isSafeInteger(roll.roll) && Number(roll.roll) >= 1 && Number(roll.roll) <= 20 && Number.isSafeInteger(roll.modifier)
      && typeof roll.coverAdjustment === "number" && adjustments.includes(roll.coverAdjustment)
      && roll.total === Number(roll.roll) + Number(roll.modifier) + roll.coverAdjustment
      // Each perceiver rolls in turn; only the last may reach the total.
      && (index === rolls.length - 1 || Number(roll.total) < stealthTotal))
    && isRecord(last) && (value.foundByRef === null ? Number(last.total) < stealthTotal
      : value.foundByRef === last.perceiverRef && Number(last.total) >= stealthTotal);
}

/** The record names a hiding that stood, in that scene, and perceivers who
 * were there to look; it changes nothing itself. The ConditionChanged after a
 * finding ends the hiding. */
export function applyHiddenPerceptionRolledEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  if (event.eventType !== "HiddenPerceptionRolled") return false;
  const payload = event.payload;
  if (!isHiddenPerceptionRolledPayload(payload)) throw new RulesValidationError("hide:perception-payload-invalid");
  const hidden = hiddenCondition(state.combatRuntime.entities[payload.hiderRef]?.conditions);
  if (hidden?.stealthTotal !== payload.stealthTotal || !present(state, payload.hiderRef, payload.sceneRef)
    || payload.rolls.some(roll => !hidingOpponents(state, payload.hiderRef, roll.perceiverRef) || !present(state, roll.perceiverRef, payload.sceneRef))) {
    throw new RulesValidationError("hide:perception-not-applicable");
  }
  // A roll Rules asked for as a combat randomness resolution (a turn start, a
  // search, a map move) settles that resolution, as a combat event does.
  if (event.resolutionId !== null) delete state.combatRuntime.randomnessResolutions[event.resolutionId];
  return true;
}

function draft(state: AuthoritativeWorldState, hiderId: string, hidden: HiddenCondition | undefined): HiddenConditionDraft {
  return { eventType: "ConditionChanged", payload: { entityId: hiderId, conditions: withHidden(state.combatRuntime.entities[hiderId]!.conditions, hidden) },
    visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" };
}

/** The hider is found, attacked, spoke or left: it hides from nobody. */
export function hiddenEndDrafts(state: AuthoritativeWorldState, hiderId: string): HiddenConditionDraft[] {
  return hiddenCondition(state.combatRuntime.entities[hiderId]?.conditions) === undefined ? [] : [draft(state, hiderId, undefined)];
}

/** An opponent that perceives a hider in a resolved outcome has found it;
 * `pairs` are each perception's observer and subject. */
export function hiddenRevealDrafts(state: AuthoritativeWorldState,
  pairs: readonly Readonly<{ observerRef: string; subjectRef: string | null }>[]): HiddenConditionDraft[] {
  return [...new Set(pairs.filter(pair => pair.subjectRef !== null && pair.observerRef !== pair.subjectRef
    && hidingOpponents(state, pair.subjectRef, pair.observerRef)).map(pair => pair.subjectRef!))].sort()
    .flatMap(hiderId => hiddenEndDrafts(state, hiderId));
}

/** SPEC 0004 §4 (ADR 0097): the hiders a Perception check totalling `total`
 * by `finderId` finds: those `hidersInSearch` whose Stealth total the check
 * reaches with the cover adjustment added. */
export function hidersFoundBy(state: AuthoritativeWorldState, finderId: string, total: number,
  scope: "outsideEncounters" | "encounter" = "outsideEncounters"): string[] {
  return hidersInSearch(state, finderId, scope).filter(hiderId => total + perceptionCoverAdjustment(state, finderId, hiderId)!
    >= Number(hiddenCondition(state.combatRuntime.entities[hiderId]!.conditions)!.stealthTotal));
}

/** The hiders a search by `finderId` reaches at all: hidden from it in its
 * scene and in its sight, and out of an encounter -- or, for the Search action
 * (SPEC 0012 §6.3), in the finder's own encounter. */
export function hidersInSearch(state: AuthoritativeWorldState, finderId: string,
  scope: "outsideEncounters" | "encounter" = "outsideEncounters"): string[] {
  const sceneId = state.entities[finderId]?.sceneId;
  if (sceneId === undefined) return [];
  const encounter = scope === "encounter" ? activeEncounter(state, finderId) : undefined;
  if (scope === "encounter" && encounter === undefined) return [];
  return Object.keys(state.combatRuntime.entities).sort().filter(hiderId => {
    const hidden = hiddenCondition(state.combatRuntime.entities[hiderId]!.conditions);
    if (hidden === undefined || !hidingOpponents(state, hiderId, finderId) || !present(state, hiderId, sceneId)
      || activeEncounter(state, hiderId) !== encounter) return false;
    return perceptionCoverAdjustment(state, finderId, hiderId) !== undefined;
  });
}

/** The hidden records an event ends, as Rules' own follow-ups: leaving the
 * scene ends the leaver's hiding; an attack ends its attacker's. World
 * interactions end it for their own attacks, conversations and perceptions
 * where they resolve. Moving within the scene changes nothing by itself: the
 * next roll reads where everyone then stands. */
export function hiddenFollowupDrafts(
  _profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, event: EventEnvelope,
): HiddenConditionDraft[] {
  const payload = event.payload as JsonRecord;
  if (event.eventType === "CharacterMoved" && isNonEmptyString(payload.characterId)) return hiddenEndDrafts(state, payload.characterId);
  if (event.eventType === "PartyMoved" && Array.isArray(payload.memberCharacterIds)) {
    return [...new Set(payload.memberCharacterIds.filter(isNonEmptyString))].sort().flatMap(id => hiddenEndDrafts(state, id));
  }
  // SPEC 0012 §6.3 (ADR 0097): a grapple or shove is an attack too.
  if (event.eventType === "AbilityInvoked" && isNonEmptyString(payload.sourceEntityId) && isRecord(payload.mechanicalResult)
    && (isRecord(payload.mechanicalResult.attack) || isRecord(payload.mechanicalResult.contest)
      || (isRecord(payload.mechanicalResult.attacks) && Object.keys(payload.mechanicalResult.attacks).length > 0))) {
    return hiddenEndDrafts(state, payload.sourceEntityId);
  }
  if (event.eventType === "EnvironmentFeatureDamaged" && isNonEmptyString(payload.actorCharacterId) && Array.isArray(payload.attackRolls)) {
    return hiddenEndDrafts(state, payload.actorCharacterId);
  }
  return [];
}
