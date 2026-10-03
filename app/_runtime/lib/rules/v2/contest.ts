import type { RuntimeProfileManifest } from "../profiles/types";
import type { AuthoritativeWorldState, FrozenCheck, FrozenOpposition, JsonRecord } from "./model";
import { activeEncounter } from "./combat-encounters";
import { skillCheckModifier, type ProficiencyAbility } from "./proficiency";
import { CANONICAL_SIGNED_INTEGER_PATTERN, hasExactKeys, isNonEmptyString, isRecord } from "./validation";

// SPEC 0004 §4: a contested check outside combat. The KP names who resists and
// the one or two checks it may resist with; Rules takes the higher of them from
// the opponent's own stat block, both sides roll, and the actor achieves the
// act only with the higher total. A tie keeps things as they were.

export type ContestOption = Readonly<{ ability: FrozenCheck["ability"]; skill: string | null }>;

const FROZEN_ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"] as const;
const SHORT_ABILITY: Readonly<Record<FrozenCheck["ability"], ProficiencyAbility>> = Object.freeze({
  strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha",
});
const MODES = ["normal", "advantage", "disadvantage"] as const;
const isRef = (value: unknown): value is string => isNonEmptyString(value) && !/\s/.test(value);

/** SRD 5.1 grapple and shove: the target resists with Athletics or
 * Acrobatics, its choice. An escape is resisted by the grappler's Athletics. */
export const GRAPPLE_RESISTANCE: readonly ContestOption[] = Object.freeze([
  Object.freeze({ ability: "strength", skill: "athletics" }), Object.freeze({ ability: "dexterity", skill: "acrobatics" }),
]);
export const ESCAPE_RESISTANCE: readonly ContestOption[] = Object.freeze([Object.freeze({ ability: "strength", skill: "athletics" })]);

export function isContestOption(value: unknown): value is ContestOption {
  return isRecord(value) && hasExactKeys(value, ["ability", "skill"])
    && (FROZEN_ABILITIES as readonly unknown[]).includes(value.ability) && (value.skill === null || isRef(value.skill));
}

/** One or two distinct checks, as the KP listed them. */
export function isContestOptions(value: unknown): value is readonly ContestOption[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 2 && value.every(isContestOption)
    && new Set(value.map(option => `${option.ability}:${option.skill}`)).size === value.length;
}

export function sameContestOptions(left: readonly ContestOption[], right: readonly ContestOption[]): boolean {
  const key = (option: ContestOption) => `${option.ability}:${option.skill}`;
  return left.length === right.length && left.every(option => right.some(other => key(other) === key(option)));
}

export function isFrozenOpposition(value: unknown): value is FrozenOpposition {
  return isRecord(value) && hasExactKeys(value, ["ability", "mode", "modifier", "opponentRef", "options", "skill"])
    && isRef(value.opponentRef) && isContestOptions(value.options)
    && value.options.some(option => option.ability === value.ability && option.skill === value.skill)
    && typeof value.modifier === "string" && CANONICAL_SIGNED_INTEGER_PATTERN.test(value.modifier)
    && (MODES as readonly unknown[]).includes(value.mode);
}

/** An NPC stat block's explicit skill bonus counts first, as in passive
 * Perception; otherwise the ability modifier plus proficiency. */
export function contestantModifier(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState,
  entityId: string, option: ContestOption): number | undefined {
  const entity = state.entities[entityId];
  if (entity === undefined) return undefined;
  const social = (entity as JsonRecord).socialMechanics;
  const bonus = option.skill !== null && isRecord(social) && isRecord(social.skillModifiers)
    ? social.skillModifiers[option.skill] : undefined;
  if (Number.isSafeInteger(bonus)) return Number(bonus);
  return skillCheckModifier(profiles, entity, SHORT_ABILITY[option.ability], option.skill);
}

/** The opponent's choice before conditions: the higher listed check, the
 * first listed on a tie. */
export function contestOpposition(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState,
  opponentRef: string, options: readonly ContestOption[]): FrozenOpposition | undefined {
  let best: { option: ContestOption; modifier: number } | undefined;
  for (const option of options) {
    const modifier = contestantModifier(profiles, state, opponentRef, option);
    if (modifier === undefined) return undefined;
    if (best === undefined || modifier > best.modifier) best = { option, modifier };
  }
  return best === undefined ? undefined : { opponentRef, options: options.map(option => ({ ...option })),
    ability: best.option.ability, skill: best.option.skill, modifier: String(best.modifier), mode: "normal" };
}

/** Faces of the check itself: the actor's d20s, then the opponent's. */
export function checkFaceCount(check: FrozenCheck | null): number {
  if (check === null) return 0;
  return dieCount(check.mode) + (check.opposition === undefined ? 0 : dieCount(check.opposition.mode));
}

export function dieCount(mode: FrozenCheck["mode"]): number {
  return mode === "normal" ? 1 : 2;
}

export function selectedFace(mode: FrozenCheck["mode"], faces: readonly number[]): number {
  return mode === "advantage" ? Math.max(...faces) : mode === "disadvantage" ? Math.min(...faces) : faces[0]!;
}

export type OpposedRoll = Readonly<{ rolls: readonly number[]; selectedRoll: number; total: number }>;

/** The opponent's roll from the check faces that follow the actor's. */
export function opposedRoll(check: FrozenCheck, faces: readonly number[]): OpposedRoll | undefined {
  const opposition = check.opposition;
  if (opposition === undefined) return undefined;
  const rolls = faces.slice(dieCount(check.mode), dieCount(check.mode) + dieCount(opposition.mode));
  if (rolls.length !== dieCount(opposition.mode)) return undefined;
  const selectedRoll = selectedFace(opposition.mode, rolls);
  return { rolls, selectedRoll, total: selectedRoll + Number(opposition.modifier) };
}

/** SRD 5.1 size categories from a footprint's larger side, in inches. */
export function footprintSizeRank(entity: JsonRecord | undefined): number | undefined {
  if (entity === undefined || !isRecord(entity.footprint)) return undefined;
  const largest = Math.max(Number(entity.footprint.width), Number(entity.footprint.depth));
  if (!Number.isFinite(largest) || largest <= 0) return undefined;
  if (largest <= 30) return 0;
  if (largest <= 60) return 1;
  if (largest <= 120) return 2;
  if (largest <= 180) return 3;
  return 4;
}

/** The creatures this one holds in a grapple, in code-unit order. */
export function grappledBy(state: AuthoritativeWorldState, grapplerId: string): string[] {
  return Object.entries(state.combatRuntime.entities).filter(([, entity]) =>
    isRecord(entity.conditions) && entity.conditions.grappledBy === grapplerId).map(([entityId]) => entityId).sort();
}

export function withoutGrapple(conditions: unknown): JsonRecord {
  const { grappledBy: _ended, ...rest } = isRecord(conditions) ? conditions : {};
  return rest;
}

/** SRD 5.1: a grapple ends when the two are no longer together. A character
 * who leaves the scene lets go of whoever it held and is out of any hold;
 * the movement event that takes it away is the one that ends it. */
export function releaseGrapplesOnDeparture(state: AuthoritativeWorldState, characterId: string): void {
  for (const entityId of grappledBy(state, characterId)) {
    const entity = state.combatRuntime.entities[entityId]!;
    entity.conditions = withoutGrapple(entity.conditions);
  }
  const mover = state.combatRuntime.entities[characterId];
  if (mover !== undefined && isRecord(mover.conditions) && Object.hasOwn(mover.conditions, "grappledBy")) {
    mover.conditions = withoutGrapple(mover.conditions);
  }
}

/** SPEC 0004 §4: outside an encounter a prone creature stands up as part of
 * its own next act. Only its own prone flag; an effect with a duration keeps
 * its own end. */
export function standsUpToAct(state: AuthoritativeWorldState, actorId: string): boolean {
  const conditions = state.combatRuntime.entities[actorId]?.conditions;
  return isRecord(conditions) && conditions.prone === true && activeEncounter(state, actorId) === undefined;
}

/** The state the actor's own act is judged in: already standing. */
export function standingView(state: AuthoritativeWorldState, actorId: string): AuthoritativeWorldState {
  if (!standsUpToAct(state, actorId)) return state;
  const entity = state.combatRuntime.entities[actorId]!;
  const { prone: _stood, ...conditions } = entity.conditions as JsonRecord;
  return { ...state, combatRuntime: { ...state.combatRuntime,
    entities: { ...state.combatRuntime.entities, [actorId]: { ...entity, conditions } } } };
}
