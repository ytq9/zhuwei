type JsonRecord = Record<string, unknown>;

export type AuthoritativeGrowthStaticCardSyncResult =
  | { kind: "unchanged" }
  | { kind: "synchronized" }
  | { kind: "failed" };

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function positiveInteger(value: unknown, maximum: number): number | undefined {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
    && value <= maximum
    ? value
    : undefined;
}

function abilityScores(value: unknown): JsonRecord | undefined {
  const scores = record(value);
  const abilities = ["str", "dex", "con", "int", "wis", "cha"] as const;
  if (scores === undefined || Object.keys(scores).length !== abilities.length) return undefined;
  return abilities.every((ability) => {
    const score = scores[ability];
    return typeof score === "number"
      && Number.isSafeInteger(score)
      && score >= 1
      && score <= 30;
  }) ? Object.fromEntries(abilities.map((ability) => [ability, scores[ability]])) : undefined;
}

function stringSet(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((entry) =>
    typeof entry === "string" && entry.length > 0)) return undefined;
  return [...new Set(value)].sort();
}

/**
 * Builds only the rebuildable level-up portion of the D1 static card.
 *
 * Current HP, resources, inventory, equipment, position, knowledge, and every
 * other active value remain owned by the Room DO and are intentionally copied
 * from the existing static card instead of from the live projection.
 */
export function authoritativeGrowthStaticCard(input: {
  currentStaticCard: unknown;
  observation: unknown;
}): JsonRecord | undefined {
  const current = record(input.currentStaticCard);
  const observation = record(input.observation);
  const readModel = record(observation?.readModel);
  const controlledCharacter = record(readModel?.controlledCharacter);
  const currentLevel = positiveInteger(current?.level, 20);
  const projectedLevel = positiveInteger(controlledCharacter?.level, 20);
  if (
    current === undefined
    || readModel?.kind !== "projected"
    || controlledCharacter === undefined
    || currentLevel === undefined
    || projectedLevel === undefined
    || projectedLevel === currentLevel
  ) return undefined;

  const next = structuredClone(current);
  next.level = projectedLevel;

  const projectedScores = abilityScores(controlledCharacter.abilityScores);
  if (projectedScores !== undefined) next.scores = projectedScores;

  const projectedHitPoints = record(controlledCharacter.hitPoints);
  const maximumHitPoints = positiveInteger(projectedHitPoints?.maximum, 1_000_000);
  const currentStaticHitPoints = record(current.hp);
  if (maximumHitPoints !== undefined && currentStaticHitPoints !== undefined) {
    next.hp = { ...structuredClone(currentStaticHitPoints), max: maximumHitPoints };
  }

  const proficiencyBonus = positiveInteger(controlledCharacter.proficiencyBonus, 20);
  if (proficiencyBonus !== undefined) next.proficiency = proficiencyBonus;

  const featureIds = stringSet(controlledCharacter.featureIds);
  if (featureIds !== undefined) next.features = featureIds;
  return next;
}

/**
 * The write happens strictly after the caller has received a committed Room
 * result. A D1 outage is therefore a failed rebuildable mirror operation, not
 * a reason to roll back or reinterpret the authoritative advancement.
 */
export async function synchronizeAuthoritativeGrowthStaticCard(input: {
  currentStaticCard: unknown;
  observation: unknown;
  writeStaticCard(card: JsonRecord): Promise<void>;
}): Promise<AuthoritativeGrowthStaticCardSyncResult> {
  const next = authoritativeGrowthStaticCard(input);
  if (next === undefined) return { kind: "unchanged" };
  try {
    await input.writeStaticCard(next);
    return { kind: "synchronized" };
  } catch {
    return { kind: "failed" };
  }
}

/**
 * Runs the rebuildable mirror continuation only after an authoritative result
 * exists, and always returns that exact result. This is the table/server seam
 * that prevents D1 availability from becoming a hidden commit coordinator.
 */
export async function synchronizeGrowthAfterAuthoritativeOutcome<T>(input: {
  outcome: T;
  synchronize(): Promise<unknown>;
}): Promise<T> {
  const kind = record(input.outcome)?.kind;
  if (kind !== "committed" && kind !== "concluded") return input.outcome;
  try {
    await input.synchronize();
  } catch {
    // A caller may supply an adapter that fails before it reaches the guarded
    // D1 write helper. That still cannot rewrite the already committed Room.
  }
  return input.outcome;
}
