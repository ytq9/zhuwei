import type { CharacterRecord, JsonRecord } from "./model";
import { classHitDie } from "./character-progression";

export const SHORT_REST_MINIMUM_MICROS = 3_600_000_000n;
export const LONG_REST_MINIMUM_MICROS = 28_800_000_000n;
export const LONG_REST_BENEFIT_INTERVAL_MICROS = 86_400_000_000n;

export type RestRecoveryChoice = {
  hitDiceToSpend: number;
  arcaneRecoverySlotLevels: number[];
};

export type RestRecoveryResult = {
  character: CharacterRecord;
  summary: JsonRecord;
};

export type ProjectedRestRecoveryOptions = {
  shortRest: {
    hitDiceMaximumSpend: number;
    hitDieSides?: number;
    arcaneRecovery: {
      eligible: boolean;
      spellLevelBudget: number;
      maximumSlotsByLevel: Record<1 | 2 | 3 | 4 | 5, number>;
    };
  };
};

const SHORT_REST_RESOURCES = new Set([
  "actionSurge",
  "breath",
  "breathWeapon",
  "channel",
  "channelDivinity",
  "secondWind",
  "superiority",
  "superiorityDice",
  "surge",
]);

const LONG_REST_RESOURCES = new Set([
  ...SHORT_REST_RESOURCES,
  "arcaneRecovery",
  "indomitable",
  "rage",
  "relentless",
  "warPriest",
]);

function abilityModifier(score: number | undefined): number {
  return Math.floor(((score ?? 10) - 10) / 2);
}

function isSpellSlot(resourceId: string): boolean {
  return /^slot[1-9]$/.test(resourceId) || /^spellSlot:[1-9]$/.test(resourceId);
}

function slotResourceId(resources: Record<string, number>, level: number): string {
  const combatStyle = `spellSlot:${level}`;
  return combatStyle in resources ? combatStyle : `slot${level}`;
}

export function projectRestRecoveryOptions(
  character: CharacterRecord,
): ProjectedRestRecoveryOptions {
  const resources = character.resources ?? {};
  const maximums = character.resourceMaximums ?? {};
  const maximumSlotsByLevel = Object.fromEntries([1, 2, 3, 4, 5].map((level) => {
    const resourceId = slotResourceId(resources, level);
    const maximum = maximums[resourceId] ?? 0;
    return [level, Math.max(0, maximum - (resources[resourceId] ?? maximum))];
  })) as Record<1 | 2 | 3 | 4 | 5, number>;
  const hitDieSides = classHitDie(character.classId);
  return {
    shortRest: {
      hitDiceMaximumSpend: Math.max(0, resources.hitDice ?? 0),
      ...(hitDieSides === undefined ? {} : { hitDieSides }),
      arcaneRecovery: {
        eligible: character.classId === "wizard"
          && (resources.arcaneRecovery ?? 1) >= 1
          && Object.values(maximumSlotsByLevel).some((missing) => missing > 0),
        spellLevelBudget: Math.ceil((character.level ?? 1) / 2),
        maximumSlotsByLevel,
      },
    },
  };
}

function restoreResources(
  resources: Record<string, number>,
  maximums: Record<string, number>,
  predicate: (resourceId: string) => boolean,
): string[] {
  const restored: string[] = [];
  for (const [resourceId, maximum] of Object.entries(maximums).sort(([left], [right]) =>
    left.localeCompare(right))) {
    if (resourceId === "hitDice" || !predicate(resourceId)) continue;
    if ((resources[resourceId] ?? maximum) !== maximum) restored.push(resourceId);
    resources[resourceId] = maximum;
  }
  return restored;
}

export function canonicalRestRecoveryChoice(
  character: CharacterRecord,
  restKind: "short" | "long",
  hitDiceToSpendValue: unknown,
  arcaneRecoverySlotLevelsValue: unknown,
): RestRecoveryChoice | undefined {
  if (!Number.isSafeInteger(hitDiceToSpendValue) || Number(hitDiceToSpendValue) < 0) return undefined;
  if (!Array.isArray(arcaneRecoverySlotLevelsValue)
    || arcaneRecoverySlotLevelsValue.length > 20
    || !arcaneRecoverySlotLevelsValue.every((level) =>
      Number.isSafeInteger(level) && Number(level) >= 1 && Number(level) <= 5)) return undefined;
  const hitDiceToSpend = Number(hitDiceToSpendValue);
  const arcaneRecoverySlotLevels = arcaneRecoverySlotLevelsValue.map(Number).sort((left, right) => left - right);
  if (restKind === "long") {
    return hitDiceToSpend === 0 && arcaneRecoverySlotLevels.length === 0
      ? { hitDiceToSpend, arcaneRecoverySlotLevels }
      : undefined;
  }
  const options = projectRestRecoveryOptions(character).shortRest;
  if (hitDiceToSpend > options.hitDiceMaximumSpend) return undefined;
  if (hitDiceToSpend > 0 && classHitDie(character.classId) === undefined) return undefined;
  if (arcaneRecoverySlotLevels.length === 0) return { hitDiceToSpend, arcaneRecoverySlotLevels };
  if (!options.arcaneRecovery.eligible
    || arcaneRecoverySlotLevels.reduce((sum, level) => sum + level, 0)
      > options.arcaneRecovery.spellLevelBudget) return undefined;
  const selectedByLevel = new Map<number, number>();
  for (const level of arcaneRecoverySlotLevels) {
    selectedByLevel.set(level, (selectedByLevel.get(level) ?? 0) + 1);
  }
  for (const [level, selected] of selectedByLevel) {
    if (options.arcaneRecovery.maximumSlotsByLevel[level as 1 | 2 | 3 | 4 | 5] < selected) {
      return undefined;
    }
  }
  return { hitDiceToSpend, arcaneRecoverySlotLevels };
}

export function canStartRest(
  character: CharacterRecord,
  restKind: "short" | "long",
  nowMicros: bigint,
  intendedDurationMicros: bigint,
): boolean {
  const minimum = restKind === "short" ? SHORT_REST_MINIMUM_MICROS : LONG_REST_MINIMUM_MICROS;
  if (intendedDurationMicros < minimum) return false;
  if (restKind === "long" && (character.hitPoints?.current ?? 1) < 1) return false;
  if (restKind === "long" && character.lastLongRestCompletedAtMicros !== undefined) {
    const earliestBenefit = BigInt(character.lastLongRestCompletedAtMicros)
      + LONG_REST_BENEFIT_INTERVAL_MICROS;
    if (nowMicros + intendedDurationMicros < earliestBenefit) return false;
  }
  return true;
}

export function resolveRestRecovery(
  character: CharacterRecord,
  restKind: "short" | "long",
  choice: RestRecoveryChoice,
  hitDieFaces: number[],
  completedAtFictionMicros: string,
): RestRecoveryResult | undefined {
  const canonicalChoice = canonicalRestRecoveryChoice(
    character,
    restKind,
    choice.hitDiceToSpend,
    choice.arcaneRecoverySlotLevels,
  );
  if (canonicalChoice === undefined || hitDieFaces.length !== canonicalChoice.hitDiceToSpend) {
    return undefined;
  }
  const hitDieSides = classHitDie(character.classId);
  if (hitDieFaces.some((face) => !Number.isInteger(face) || face < 1
    || hitDieSides === undefined || face > hitDieSides)) return undefined;

  const next = structuredClone(character);
  const resources = next.resources ??= {};
  const maximums = next.resourceMaximums ??= {};
  let healing = 0;
  const restoredResourceIds: string[] = [];
  if (restKind === "short") {
    const conModifier = abilityModifier(next.abilityScores?.con);
    healing = hitDieFaces.reduce((sum, face) => sum + Math.max(0, face + conModifier), 0);
    resources.hitDice = (resources.hitDice ?? 0) - canonicalChoice.hitDiceToSpend;
    if (next.hitPoints !== undefined) {
      next.hitPoints.current = Math.min(next.hitPoints.maximum, next.hitPoints.current + healing);
    }
    restoredResourceIds.push(...restoreResources(
      resources,
      maximums,
      (resourceId) => SHORT_REST_RESOURCES.has(resourceId),
    ));
    if (canonicalChoice.arcaneRecoverySlotLevels.length > 0) {
      for (const level of canonicalChoice.arcaneRecoverySlotLevels) {
        const resourceId = slotResourceId(resources, level);
        resources[resourceId] = Math.min(maximums[resourceId], (resources[resourceId] ?? 0) + 1);
        restoredResourceIds.push(resourceId);
      }
      resources.arcaneRecovery = 0;
      maximums.arcaneRecovery = 1;
    }
  } else {
    if (next.hitPoints !== undefined) next.hitPoints.current = next.hitPoints.maximum;
    const maximumHitDice = maximums.hitDice ?? next.level ?? resources.hitDice ?? 0;
    maximums.hitDice = maximumHitDice;
    resources.hitDice = Math.min(
      maximumHitDice,
      (resources.hitDice ?? maximumHitDice) + Math.max(1, Math.floor(maximumHitDice / 2)),
    );
    restoredResourceIds.push(...restoreResources(
      resources,
      maximums,
      (resourceId) => LONG_REST_RESOURCES.has(resourceId) || isSpellSlot(resourceId),
    ));
    if (next.classId === "wizard") {
      resources.arcaneRecovery = 1;
      maximums.arcaneRecovery = 1;
    }
    next.lastLongRestCompletedAtMicros = completedAtFictionMicros;
  }
  return {
    character: next,
    summary: {
      hitDiceSpent: canonicalChoice.hitDiceToSpend,
      hitDieSides: hitDieSides ?? 0,
      hitDieFaces: [...hitDieFaces],
      healing,
      restoredResourceIds: [...new Set(restoredResourceIds)].sort(),
      arcaneRecoverySlotLevels: [...canonicalChoice.arcaneRecoverySlotLevels],
    },
  };
}
