/** The KP freezes an act's fictional duration as one coarse tier; the domain
 * and Rules keep exact microseconds. Precision below a tier is not a KP
 * judgment worth asking for: round79 wrote 30 s and round80 12 s for the
 * same half-minute request. "none" is the explicit zero of a bundle that
 * only authors world content. */
export const VNEXT_ACTION_DURATION_TIERS = Object.freeze({
  none: "0",
  "5min": "300000000",
  "10min": "600000000",
  "30min": "1800000000",
  "1h": "3600000000",
  halfDay: "43200000000",
} as const);
export type VNextActionDurationTier = keyof typeof VNEXT_ACTION_DURATION_TIERS;
export const VNEXT_ACTION_DURATION_TIER_IDS: readonly VNextActionDurationTier[] =
  Object.freeze(Object.keys(VNEXT_ACTION_DURATION_TIERS) as VNextActionDurationTier[]);

export function actionDurationMicrosForTier(tier: unknown): string | undefined {
  return typeof tier === "string" && Object.hasOwn(VNEXT_ACTION_DURATION_TIERS, tier)
    ? VNEXT_ACTION_DURATION_TIERS[tier as VNextActionDurationTier] : undefined;
}
export function actionDurationTierForMicros(micros: unknown): VNextActionDurationTier | undefined {
  return VNEXT_ACTION_DURATION_TIER_IDS.find(tier => VNEXT_ACTION_DURATION_TIERS[tier] === micros);
}
/** The domain field stays exact microseconds, but only a tier's worth. */
export function isActionDurationMicros(value: unknown): value is string {
  return actionDurationTierForMicros(value) !== undefined;
}
