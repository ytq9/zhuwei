/** Canonical condition vocabulary, independent of world execution and schemas. */
export const CONDITION_IDS = [
  "blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled",
  "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone",
  "restrained", "stunned", "unconscious",
] as const;
export type ConditionId = typeof CONDITION_IDS[number];
