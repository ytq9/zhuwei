import type { CharacterRecord } from "./model";
import type { JsonRecord } from "./model";

export type FixedDamageResolution = {
  before: number;
  after: number;
  maximum: number;
  died: boolean;
};

/** Shared SRD 5.1 damage primitive for hazards and the later combat adapter. */
export function resolveFixedDamage(
  target: CharacterRecord,
  amount: number,
): FixedDamageResolution {
  if (
    !Number.isSafeInteger(amount)
    || amount < 0
    || target.hitPoints === undefined
    || !Number.isSafeInteger(target.hitPoints.current)
    || !Number.isSafeInteger(target.hitPoints.maximum)
  ) {
    throw new TypeError("fixed damage requires canonical hit points and a non-negative integer");
  }
  const before = target.hitPoints.current;
  const after = Math.max(0, before - amount);
  return { before, after, maximum: target.hitPoints.maximum, died: before > 0 && after === 0 };
}

export type CombatDamageComponent = {
  type: string;
  rolled: number;
  defense: "none" | "resistance" | "immunity" | "vulnerability";
  applied: number;
};

/** Shared SRD 5.1 component pipeline for combat and non-combat hazards. */
export function resolveCombatDamage(
  target: JsonRecord,
  rolled: Array<{ type: string; rolled: number }>,
): { components: CombatDamageComponent[]; totalApplied: number; targetPatch: JsonRecord } {
  const hitPoints = target.hitPoints;
  if (!hitPoints || typeof hitPoints !== "object" || Array.isArray(hitPoints)) {
    throw new TypeError("combat damage target lacks hit points");
  }
  const defenses = target.damageDefenses;
  const defenseRecord = defenses && typeof defenses === "object" && !Array.isArray(defenses)
    ? defenses as JsonRecord
    : {};
  const contains = (key: string, type: string) => Array.isArray(defenseRecord[key])
    && (defenseRecord[key] as unknown[]).includes(type);
  const components = rolled.map(({ type, rolled: amount }) => {
    const defense: CombatDamageComponent["defense"] = contains("immune", type)
      ? "immunity"
      : contains("resistant", type)
        ? "resistance"
        : contains("vulnerable", type)
          ? "vulnerability"
          : "none";
    const applied = defense === "immunity" ? 0
      : defense === "resistance" ? Math.floor(amount / 2)
        : defense === "vulnerability" ? amount * 2
          : amount;
    return { type, rolled: amount, defense, applied };
  });
  const totalApplied = components.reduce((sum, component) => sum + component.applied, 0);
  const patch = structuredClone(target);
  const current = Number((patch.hitPoints as JsonRecord).current);
  const temporary = Number((patch.hitPoints as JsonRecord).temporary ?? 0);
  const absorbed = Math.min(temporary, totalApplied);
  (patch.hitPoints as JsonRecord).temporary = String(temporary - absorbed);
  (patch.hitPoints as JsonRecord).current = String(Math.max(0, current - (totalApplied - absorbed)));
  return { components, totalApplied, targetPatch: patch };
}
