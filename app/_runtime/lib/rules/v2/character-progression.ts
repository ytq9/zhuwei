import type { CharacterRecord, JsonRecord } from "./model";
import { hasOnlyKeys, isNonEmptyString, isRecord } from "./validation";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;

export const ADVANCEMENT_PROFILES = ["milestone", "srdXp2014"] as const;
export type AdvancementProfile = typeof ADVANCEMENT_PROFILES[number];

/** SRD 5.1 / D&D 5e 2014 cumulative experience thresholds for levels 1-20. */
export const SRD_XP_THRESHOLDS = [
  0,
  300,
  900,
  2_700,
  6_500,
  14_000,
  23_000,
  34_000,
  48_000,
  64_000,
  85_000,
  100_000,
  120_000,
  140_000,
  165_000,
  195_000,
  225_000,
  265_000,
  305_000,
  355_000,
] as const;

/** Keeps one KP award bounded while still allowing any SRD tier in one transaction. */
export const MAX_EXPERIENCE_AWARD = 1_000_000;

export function experienceThresholdForLevel(level: number): number | undefined {
  return Number.isSafeInteger(level) && level >= 1 && level <= 20
    ? SRD_XP_THRESHOLDS[level - 1]
    : undefined;
}

export function experienceQualifiesForNextLevel(character: CharacterRecord): boolean {
  const level = character.level;
  const experiencePoints = character.experiencePoints;
  if (!Number.isSafeInteger(level) || !Number.isSafeInteger(experiencePoints)) return false;
  const nextThreshold = experienceThresholdForLevel(Number(level) + 1);
  return nextThreshold !== undefined && Number(experiencePoints) >= nextThreshold;
}

type Ability = typeof ABILITIES[number];

const CLASS_HIT_DIE: Record<string, number> = {
  barbarian: 12,
  cleric: 8,
  fighter: 10,
  ranger: 10,
  rogue: 8,
  wizard: 6,
};

export function classHitDie(classId: string | undefined): number | undefined {
  return classId === undefined ? undefined : CLASS_HIT_DIE[classId];
}

const STANDARD_ASI_LEVELS: Record<string, readonly number[]> = {
  barbarian: [4, 8, 12, 16, 19],
  cleric: [4, 8, 12, 16, 19],
  fighter: [4, 6, 8, 12, 14, 16, 19],
  ranger: [4, 8, 12, 16, 19],
  rogue: [4, 8, 10, 12, 16, 19],
  wizard: [4, 8, 12, 16, 19],
};

const LEVEL_FEATURES: Record<string, Record<number, readonly string[]>> = {
  barbarian: {
    5: ["feature:extra-attack:2", "feature:fast-movement"],
    7: ["feature:feral-instinct"],
    9: ["feature:brutal-critical:1"],
    11: ["feature:relentless-rage"],
    13: ["feature:brutal-critical:2"],
    15: ["feature:persistent-rage"],
    17: ["feature:brutal-critical:3"],
    18: ["feature:indomitable-might"],
    20: ["feature:primal-champion"],
  },
  cleric: {
    5: ["feature:destroy-undead:cr-half"],
    6: ["feature:channel-divinity:2"],
    10: ["feature:divine-intervention"],
    11: ["feature:destroy-undead:cr-2"],
    14: ["feature:destroy-undead:cr-3"],
    17: ["feature:destroy-undead:cr-4"],
    18: ["feature:channel-divinity:3"],
    20: ["feature:divine-intervention:automatic"],
  },
  fighter: {
    5: ["feature:extra-attack:2"],
    9: ["feature:indomitable:1"],
    11: ["feature:extra-attack:3"],
    13: ["feature:indomitable:2"],
    17: ["feature:action-surge:2", "feature:indomitable:3"],
    20: ["feature:extra-attack:4"],
  },
  ranger: {
    5: ["feature:extra-attack:2"],
    8: ["feature:land-stride"],
    10: ["feature:hide-in-plain-sight"],
    14: ["feature:vanish"],
    18: ["feature:feral-senses"],
    20: ["feature:foe-slayer"],
  },
  rogue: {
    5: ["feature:uncanny-dodge"],
    6: ["feature:expertise:second"],
    7: ["feature:evasion"],
    11: ["feature:reliable-talent"],
    14: ["feature:blindsense"],
    15: ["feature:slippery-mind"],
    18: ["feature:elusive"],
    20: ["feature:stroke-of-luck"],
  },
  wizard: {
    18: ["feature:spell-mastery"],
    20: ["feature:signature-spells"],
  },
};

const FULL_CASTER_SLOTS: readonly (readonly number[])[] = [
  [],
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1],
  [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const RANGER_SLOTS: readonly (readonly number[])[] = [
  [],
  [], [2], [3], [3], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3, 2],
  [4, 3, 2], [4, 3, 3], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 1],
  [4, 3, 3, 2], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2], [4, 3, 3, 3, 2],
];

export type AdvancementResult =
  | { ok: true; choice: JsonRecord; character: CharacterRecord }
  | { ok: false; message: string };

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function proficiencyBonus(level: number): number {
  return 2 + Math.floor((level - 1) / 4);
}

function canonicalStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)
    || value.length !== new Set(value).size) return undefined;
  return [...value].sort();
}

function classFeaturesAtLevel(classId: string, level: number): string[] {
  const features = [...(LEVEL_FEATURES[classId]?.[level] ?? [])];
  if (STANDARD_ASI_LEVELS[classId]?.includes(level)) {
    features.push("feature:ability-score-improvement");
  }
  return features.sort();
}

function slotsFor(classId: string, level: number): readonly number[] {
  if (classId === "wizard" || classId === "cleric") return FULL_CASTER_SLOTS[level] ?? [];
  if (classId === "ranger") return RANGER_SLOTS[level] ?? [];
  return [];
}

function canonicalAbilityScores(value: unknown): Record<Ability, number> | undefined {
  if (!isRecord(value) || Object.keys(value).length !== ABILITIES.length
    || !ABILITIES.every((ability) => Number.isSafeInteger(value[ability])
      && Number(value[ability]) >= 1 && Number(value[ability]) <= 30)) return undefined;
  return Object.fromEntries(
    ABILITIES.map((ability) => [ability, Number(value[ability])]),
  ) as Record<Ability, number>;
}

function canonicalAbilityIncreases(value: unknown): Partial<Record<Ability, number>> | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) => !ABILITIES.includes(key as Ability))) {
    return undefined;
  }
  const result: Partial<Record<Ability, number>> = {};
  for (const ability of ABILITIES) {
    const amount = value[ability];
    if (amount === undefined) continue;
    if (!Number.isSafeInteger(amount) || Number(amount) < 1 || Number(amount) > 2) return undefined;
    result[ability] = Number(amount);
  }
  return result;
}

export function advancementOptions(character: CharacterRecord): JsonRecord | undefined {
  const level = character.level;
  const classId = character.classId;
  if (!Number.isSafeInteger(level) || Number(level) < 1 || Number(level) >= 20
    || !isNonEmptyString(classId) || CLASS_HIT_DIE[classId] === undefined
    || canonicalAbilityScores(character.abilityScores) === undefined
    || character.hitPoints === undefined) return undefined;
  const newLevel = Number(level) + 1;
  const conModifier = abilityModifier(character.abilityScores!.con);
  const fixedHitPointGain = Math.max(
    1,
    Math.floor(CLASS_HIT_DIE[classId] / 2) + 1 + conModifier
      + (character.raceId === "hill-dwarf" ? 1 : 0),
  );
  const abilityScoreBudget = STANDARD_ASI_LEVELS[classId]?.includes(newLevel) ? 2 : 0;
  return {
    classId,
    newLevel,
    hitPointMethod: "fixed2014",
    fixedHitPointGain,
    abilityScoreBudget,
    maximumAbilityScore: 20,
    grantedFeatureIds: classFeaturesAtLevel(classId, newLevel),
  };
}

function progressedResources(
  character: CharacterRecord,
  classId: string,
  oldLevel: number,
  newLevel: number,
): { resources: Record<string, number>; resourceMaximums: Record<string, number> } {
  const resources = structuredClone(character.resources ?? {});
  const maximums = structuredClone(character.resourceMaximums ?? {});
  const priorHitDiceMaximum = maximums.hitDice ?? oldLevel;
  const priorHitDice = resources.hitDice ?? priorHitDiceMaximum;
  maximums.hitDice = newLevel;
  resources.hitDice = Math.min(newLevel, priorHitDice + (newLevel - priorHitDiceMaximum));

  const priorSlots = slotsFor(classId, oldLevel);
  const nextSlots = slotsFor(classId, newLevel);
  for (let index = 0; index < Math.max(priorSlots.length, nextSlots.length); index += 1) {
    const key = `slot${index + 1}`;
    const priorMaximum = maximums[key] ?? priorSlots[index] ?? 0;
    const nextMaximum = nextSlots[index] ?? 0;
    const current = resources[key] ?? priorMaximum;
    maximums[key] = nextMaximum;
    resources[key] = Math.min(nextMaximum, current + Math.max(0, nextMaximum - priorMaximum));
  }
  return { resources, resourceMaximums: maximums };
}

export function advanceCharacter2014(
  character: CharacterRecord,
  choiceValue: unknown,
): AdvancementResult {
  const options = advancementOptions(character);
  if (options === undefined || !isRecord(choiceValue)
    || !hasOnlyKeys(choiceValue, ["classId", "hitPointMethod", "newLevel", "selectedFeatureIds"], ["abilityScoreIncreases"])) {
    return { ok: false, message: "Advancement choice is unavailable for this character." };
  }
  const selectedFeatureIds = canonicalStrings(choiceValue.selectedFeatureIds);
  const expectedFeatureIds = canonicalStrings(options.grantedFeatureIds);
  if (choiceValue.classId !== options.classId
    || choiceValue.newLevel !== options.newLevel
    || choiceValue.hitPointMethod !== "fixed2014"
    || selectedFeatureIds === undefined
    || expectedFeatureIds === undefined
    || JSON.stringify(selectedFeatureIds) !== JSON.stringify(expectedFeatureIds)) {
    return { ok: false, message: "Advancement choice does not match the frozen 2014 options." };
  }

  const scores = canonicalAbilityScores(character.abilityScores)!;
  const abilityScoreBudget = Number(options.abilityScoreBudget);
  const increases = choiceValue.abilityScoreIncreases === undefined
    ? {}
    : canonicalAbilityIncreases(choiceValue.abilityScoreIncreases);
  if (increases === undefined
    || Object.values(increases).reduce((sum, amount) => sum + Number(amount), 0) !== abilityScoreBudget) {
    return { ok: false, message: "Ability score increases do not spend the frozen budget." };
  }
  const nextScores = { ...scores };
  for (const [ability, amount] of Object.entries(increases) as Array<[Ability, number]>) {
    if (nextScores[ability] + amount > Number(options.maximumAbilityScore)) {
      return { ok: false, message: "Ability score advancement exceeds the 2014 maximum." };
    }
    nextScores[ability] += amount;
  }

  const oldLevel = Number(character.level);
  const newLevel = Number(options.newLevel);
  const oldConModifier = abilityModifier(scores.con);
  const newConModifier = abilityModifier(nextScores.con);
  const conRetroactiveDelta = (newConModifier - oldConModifier) * newLevel;
  const maximumHitPoints = Math.max(
    1,
    character.hitPoints!.maximum + Number(options.fixedHitPointGain) + conRetroactiveDelta,
  );
  const progression = progressedResources(character, String(options.classId), oldLevel, newLevel);
  const canonicalChoice: JsonRecord = {
    classId: options.classId,
    newLevel,
    hitPointMethod: "fixed2014",
    selectedFeatureIds,
    ...(abilityScoreBudget === 0 ? {} : {
      abilityScoreIncreases: Object.fromEntries(
        Object.entries(increases).sort(([left], [right]) => left.localeCompare(right)),
      ),
    }),
  };
  return {
    ok: true,
    choice: canonicalChoice,
    character: {
      ...structuredClone(character),
      classId: String(options.classId),
      level: newLevel,
      abilityScores: nextScores,
      hitPoints: {
        current: character.hitPoints!.current,
        maximum: maximumHitPoints,
      },
      proficiencyBonus: proficiencyBonus(newLevel),
      resources: progression.resources,
      resourceMaximums: progression.resourceMaximums,
      featureIds: [...new Set([...(character.featureIds ?? []), ...selectedFeatureIds])].sort(),
    },
  };
}

export function characterBuildSnapshot(character: CharacterRecord): JsonRecord {
  return {
    ...(character.classId === undefined ? {} : { classId: character.classId }),
    ...(character.raceId === undefined ? {} : { raceId: character.raceId }),
    ...(character.subclassId === undefined ? {} : { subclassId: character.subclassId }),
    cantrips: [...(character.cantripIds ?? [])],
    prepared: [...(character.preparedSpellIds ?? [])],
  };
}

export function attackActionsPerTurn(character: CharacterRecord): number {
  const level = character.level ?? 1;
  if (character.classId === "fighter") return level >= 20 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1;
  if (["barbarian", "ranger"].includes(character.classId ?? "") && level >= 5) return 2;
  return 1;
}
