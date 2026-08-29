import { characterProficiencyProfileEnabled } from "../profiles/character-proficiency";
import type { RuntimeProfileManifest } from "../profiles/types";
import { isNonEmptyString, isRecord } from "./validation";

export const PROFICIENCY_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type ProficiencyAbility = typeof PROFICIENCY_ABILITIES[number];

function isUniqueStringList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(isNonEmptyString)
    && value.length === new Set(value).size;
}

export function characterProficiencyFieldsMatchProfile(
  profiles: RuntimeProfileManifest,
  value: unknown,
): boolean {
  if (!isRecord(value)) return false;
  const enabled = characterProficiencyProfileEnabled(profiles.extensions);
  if (!enabled) {
    return value.expertiseSkills === undefined && value.proficientSaves === undefined;
  }
  if (value.proficientSkills !== undefined && !isUniqueStringList(value.proficientSkills)) return false;
  if (value.expertiseSkills !== undefined && !isUniqueStringList(value.expertiseSkills)) return false;
  if (
    value.proficientSaves !== undefined
    && (!isUniqueStringList(value.proficientSaves)
      || !value.proficientSaves.every((ability) =>
        (PROFICIENCY_ABILITIES as readonly string[]).includes(ability)))
  ) return false;
  const proficient = new Set(value.proficientSkills ?? []);
  return (value.expertiseSkills ?? []).every((skill) => proficient.has(skill));
}

function scoreFor(actor: unknown, ability: ProficiencyAbility): number | undefined {
  if (!isRecord(actor)) return undefined;
  const source = isRecord(actor.abilityScores)
    ? actor.abilityScores
    : isRecord(actor.stats) ? actor.stats : undefined;
  if (source === undefined) return undefined;
  const score = Number(source[ability]);
  return Number.isSafeInteger(score) ? score : undefined;
}

function proficiencyBonusFor(actor: Record<string, unknown>): number {
  const bonus = Number(actor.proficiencyBonus ?? 0);
  return Number.isSafeInteger(bonus) && bonus >= 0 ? bonus : 0;
}

export function skillCheckModifier(
  profiles: RuntimeProfileManifest,
  actorValue: unknown,
  ability: ProficiencyAbility,
  skill: string | null,
): number | undefined {
  if (!isRecord(actorValue)) return undefined;
  const actor = actorValue;
  const score = scoreFor(actor, ability);
  if (score === undefined) return undefined;
  const base = Math.floor((score - 10) / 2);
  if (skill === null || !Array.isArray(actor.proficientSkills) || !actor.proficientSkills.includes(skill)) {
    return base;
  }
  const proficiencyBonus = proficiencyBonusFor(actor);
  const expertise = characterProficiencyProfileEnabled(profiles.extensions)
    && Array.isArray(actor.expertiseSkills)
    && actor.expertiseSkills.includes(skill);
  return base + proficiencyBonus * (expertise ? 2 : 1);
}

export function savingThrowModifier(
  profiles: RuntimeProfileManifest,
  actorValue: unknown,
  ability: ProficiencyAbility,
): number | undefined {
  if (!isRecord(actorValue)) return undefined;
  const actor = actorValue;
  const score = scoreFor(actor, ability);
  if (score === undefined) return undefined;
  const base = Math.floor((score - 10) / 2);
  const proficient = characterProficiencyProfileEnabled(profiles.extensions)
    && Array.isArray(actor.proficientSaves)
    && actor.proficientSaves.includes(ability);
  return base + (proficient ? proficiencyBonusFor(actor) : 0);
}
