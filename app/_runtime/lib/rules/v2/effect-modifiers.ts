import { attackArmorClass } from "../profiles/attack-resolution";
import type { AuthoritativeWorldState, JsonRecord } from "./model";
import { isRecord } from "./validation";
import { modifierEffectsOn, type EffectModifier } from "./world-effects";

/** SPEC 0012 §10.1: the effective values the modifier effects on a creature
 * give. Mechanics and projection read these same functions. Modifiers of one
 * kind do not stack: the strongest bonus, and the strongest penalty, holds. */

type Modifier<K extends EffectModifier["kind"]> = Extract<EffectModifier, { kind: K }>;

function modifiersOf<K extends EffectModifier["kind"]>(state: AuthoritativeWorldState, entityId: string, kind: K): Modifier<K>[] {
  return modifierEffectsOn(state, entityId).map((effect) => effect.modifier)
    .filter((modifier): modifier is Modifier<K> => modifier.kind === kind);
}

function equippedArmorKind(state: AuthoritativeWorldState, entityId: string, slot: "armor" | "off"): string | undefined {
  const entryId = state.entities[entityId]?.loadout?.equipped[slot];
  const system = state.campaignRuntime.itemSystem;
  const entry = entryId === undefined ? undefined : system?.entries[entryId];
  return entry === undefined ? undefined : system.definitions[entry.definitionRef]?.content.equipment?.armor?.kind;
}

/** SPEC 0004 §4: body armor the creature wears (a shield is not body armor). */
export function wearsBodyArmor(state: AuthoritativeWorldState, entityId: string): boolean {
  const kind = equippedArmorKind(state, entityId, "armor");
  return kind !== undefined && kind !== "shield";
}

function dexterityModifier(entity: JsonRecord): number {
  const score = isRecord(entity.stats) ? Number(entity.stats.dex) : NaN;
  return Number.isInteger(score) ? Math.floor((score - 10) / 2) : 0;
}

/** The armor class an attack is rolled against, before cover: the stored one
 * or, unarmored under a base-AC effect (SRD Mage Armor), that base plus
 * Dexterity and a held shield when higher; then the Shield spell and any
 * armor-class bonus (SRD Shield of Faith). */
export function effectiveArmorClass(state: AuthoritativeWorldState, target: JsonRecord): number {
  const id = String(target.id ?? target.entityId);
  const stored = Number(target.armorClass ?? 10);
  const shieldSpell = attackArmorClass(target, Object.values(state.combatRuntime.effects)) - stored;
  const bases = modifiersOf(state, id, "unarmoredArmorClass").map((modifier) => modifier.base);
  const unarmored = bases.length === 0 || wearsBodyArmor(state, id) ? undefined
    : Math.max(...bases) + dexterityModifier(target) + (equippedArmorKind(state, id, "off") === "shield" ? 2 : 0);
  const bonus = Math.max(0, ...modifiersOf(state, id, "armorClassBonus").map((modifier) => modifier.amount));
  return Math.max(stored, unarmored ?? stored) + shieldSpell + bonus;
}

/** SRD Ray of Frost: the speed change in inches, a bonus only where the
 * creature can benefit from one. */
export function speedModifierInches(state: AuthoritativeWorldState, entityId: string, canBenefitFromBonus: boolean): bigint {
  const feet = modifiersOf(state, entityId, "speedBonus").map((modifier) => modifier.feet);
  const bonus = canBenefitFromBonus ? Math.max(0, ...feet) : 0;
  const penalty = Math.min(0, ...feet);
  return BigInt((bonus + penalty) * 12);
}

/** SRD Shocking Grasp: the creature cannot take reactions. */
export function reactionsBlocked(state: AuthoritativeWorldState, entityId: string): boolean {
  return modifiersOf(state, entityId, "noReactions").length > 0;
}

/** SRD Guiding Bolt: the next attack roll against the creature has advantage. */
export function attacksAgainstHaveAdvantage(state: AuthoritativeWorldState, entityId: string): boolean {
  return modifiersOf(state, entityId, "advantageOnNextAttackAgainst").length > 0;
}

/** SRD Aid: how much the creature's hit point maximum is raised. */
export function hitPointMaximumBonus(state: AuthoritativeWorldState, entityId: string): number {
  return Math.max(0, ...modifiersOf(state, entityId, "hitPointMaximumBonus").map((modifier) => modifier.amount));
}

export type D20BonusDie = { sides: number; effectIds: string[]; spentEffectIds: string[] };

/** SRD Bless, Guidance: the die a creature adds to a d20 roll of this kind --
 * the largest one, a lasting one before one the roll would use up. A die that
 * lasts for one roll only is spent by it. */
export function d20BonusDie(state: AuthoritativeWorldState, entityId: string, roll: "attack" | "check" | "save"): D20BonusDie | undefined {
  const candidates = modifierEffectsOn(state, entityId).flatMap((effect) => effect.modifier.kind === "d20BonusDie"
    && effect.modifier.rolls.includes(roll) ? [{ effect, sides: effect.modifier.sides,
      once: effect.lifecycle?.endsWhen?.includes("bonusDieUsed") === true }] : []);
  if (candidates.length === 0) return undefined;
  const sides = Math.max(...candidates.map((candidate) => candidate.sides));
  const chosen = candidates.filter((candidate) => candidate.sides === sides)
    .sort((left, right) => Number(left.once) - Number(right.once))[0]!;
  return { sides, effectIds: [chosen.effect.effectId], spentEffectIds: chosen.once ? [chosen.effect.effectId] : [] };
}

/** SRD Hunter's Mark: the die `sourceId`'s weapon hits deal a creature it has
 * marked, beyond the weapon's own damage; undefined when it has none there. */
export function weaponDamageDieFrom(state: AuthoritativeWorldState, targetId: string, sourceId: string): number | undefined {
  const sides = modifierEffectsOn(state, targetId).flatMap((effect) => effect.modifier.kind === "weaponDamageDieFromSource"
    && effect.sourceRef === sourceId ? [effect.modifier.sides] : []);
  return sides.length === 0 ? undefined : Math.max(...sides);
}
