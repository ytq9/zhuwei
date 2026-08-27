import type { JsonRecord } from "../v2/model";
import { isNonEmptyString, isRecord } from "../v2/validation";

function abilityModifier(entity: JsonRecord, ability: string): number {
  const stats = entity.stats;
  if (!isRecord(stats)) return 0;
  const score = Number(stats[ability]);
  return Number.isInteger(score) ? Math.floor((score - 10) / 2) : 0;
}

export function combatAttackBonus(source: JsonRecord, definition: JsonRecord): number {
  if (isRecord(definition.attack) && definition.attack.kind === "spellAttack"
    && isRecord(source.spellcasting)) return Number(source.spellcasting.spellAttackBonus ?? 0);
  const ability = isRecord(definition.attack) && isNonEmptyString(definition.attack.ability)
    ? definition.attack.ability : "str";
  return abilityModifier(source, ability) + (isRecord(definition.attack) && definition.attack.proficiency === true
    ? Number(source.proficiencyBonus ?? 0) : 0);
}

export function resolveCombatAttackRoll(
  source: JsonRecord,
  definition: JsonRecord,
  armorClass: number,
  rolls: readonly number[],
  mode: "normal" | "advantage" | "disadvantage",
): { selected: number; attackBonus: number; total: number; hit: boolean } {
  if (rolls.length === 0 || !rolls.every((roll) => Number.isInteger(roll) && roll >= 1 && roll <= 20)) {
    throw new TypeError("d20 faces missing");
  }
  const selected = mode === "advantage"
    ? Math.max(...rolls)
    : mode === "disadvantage" ? Math.min(...rolls) : rolls[0];
  const attackBonus = combatAttackBonus(source, definition);
  const total = selected + attackBonus;
  return {
    selected,
    attackBonus,
    total,
    hit: selected === 20 || (selected !== 1 && total >= armorClass),
  };
}
