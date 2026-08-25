export const RULESET_VERSION = "dnd5e-2014-srd5.1-v1" as const;

export type RulesetVersion = typeof RULESET_VERSION;
export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type D20Mode = "normal" | "advantage" | "disadvantage";

export const COMBAT_ROUND_SECONDS = 6;
export const SHORT_REST_SECONDS = 60 * 60;
export const LONG_REST_SECONDS = 8 * 60 * 60;
export const LONG_REST_LIMIT_SECONDS = 24 * 60 * 60;
export const MAX_SPOTLIGHT_SKEW = 3;

export type Duration =
  | { unit: "round"; value: number }
  | { unit: "minute"; value: number }
  | { unit: "hour"; value: number }
  | { unit: "day"; value: number };

export function durationSeconds(duration: Duration): number {
  const value = Math.max(0, Math.floor(duration.value));
  if (duration.unit === "round") return value * COMBAT_ROUND_SECONDS;
  if (duration.unit === "minute") return value * 60;
  if (duration.unit === "hour") return value * 60 * 60;
  return value * 24 * 60 * 60;
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function proficiencyModifier(
  proficiencyBonus: number,
  proficiency: "none" | "proficient" | "expertise",
): number {
  if (proficiency === "expertise") return proficiencyBonus * 2;
  if (proficiency === "proficient") return proficiencyBonus;
  return 0;
}

export function resolveD20Check(input: {
  rolls: number[];
  mode: D20Mode;
  abilityScore: number;
  proficiencyBonus: number;
  proficiency: "none" | "proficient" | "expertise";
  dc: number;
}) {
  const expectedRolls = input.mode === "normal" ? 1 : 2;
  if (
    input.rolls.length !== expectedRolls ||
    input.rolls.some((roll) => !Number.isInteger(roll) || roll < 1 || roll > 20)
  ) {
    throw new Error(`d20 数量或点数不合法：${input.rolls.join(",")}`);
  }
  const d20 =
    input.mode === "advantage"
      ? Math.max(...input.rolls)
      : input.mode === "disadvantage"
        ? Math.min(...input.rolls)
        : input.rolls[0];
  const modifier =
    abilityModifier(input.abilityScore) +
    proficiencyModifier(input.proficiencyBonus, input.proficiency);
  const total = d20 + modifier;
  return { d20, modifier, total, success: total >= input.dc };
}

export function combineD20Modes(
  hasAdvantage: boolean,
  hasDisadvantage: boolean,
): D20Mode {
  if (hasAdvantage === hasDisadvantage) return "normal";
  return hasAdvantage ? "advantage" : "disadvantage";
}

/** Worker 端权威骰源；模型和浏览器只能请求动作，不能指定随机结果。 */
export function rollDie(sides: number): number {
  if (!Number.isInteger(sides) || sides < 2) throw new Error("骰面必须是大于 1 的整数");
  const range = 0x1_0000_0000;
  const limit = range - (range % sides);
  const values = new Uint32Array(1);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return (values[0] % sides) + 1;
}
