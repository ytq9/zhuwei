import type { JsonRecord } from "./model";
import { hasExactKeys, isNonEmptyString, isRecord } from "./validation";

/** SPEC 0012 §6.3: Multiattack grants only the named stat-block attacks;
 * these are separate from an Attack action and cannot be traded for shoves. */
export type MultiattackGrant = { kind: "multiattack"; attacks: Array<{ abilityRef: string; count: string }> };
export function multiattackGrant(value: unknown): MultiattackGrant | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["kind", "attacks"]) || value.kind !== "multiattack"
    || !Array.isArray(value.attacks) || value.attacks.length < 1 || value.attacks.length > 8
    || !value.attacks.every(entry => isRecord(entry) && hasExactKeys(entry, ["abilityRef", "count"])
      && isNonEmptyString(entry.abilityRef) && typeof entry.count === "string" && /^[1-9][0-9]?$/u.test(entry.count))
    || new Set(value.attacks.map(entry => (entry as JsonRecord).abilityRef)).size !== value.attacks.length) return undefined;
  return value as MultiattackGrant;
}
export function abilityMultiattackGrant(definition: JsonRecord): MultiattackGrant | undefined {
  return Array.isArray(definition.grants) && definition.grants.length === 1
    ? multiattackGrant(definition.grants[0]) : undefined;
}
