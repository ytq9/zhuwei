export const WORLD_DAMAGE_PROFILE_REGISTRY = Object.freeze({
  "world-damage:falling-object:moderate": Object.freeze({
    targetResolver: "active-contains-relation" as const,
    amount: 6,
    damageType: "bludgeoning",
  }),
});

export type WorldDamageProfileRef = keyof typeof WORLD_DAMAGE_PROFILE_REGISTRY;

export function isWorldDamageProfileRef(value: unknown): value is WorldDamageProfileRef {
  return typeof value === "string"
    && Object.hasOwn(WORLD_DAMAGE_PROFILE_REGISTRY, value);
}
