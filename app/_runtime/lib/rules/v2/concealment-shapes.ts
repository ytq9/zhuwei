import type { FrozenConcealment } from "./model";
import { CANONICAL_SIGNED_INTEGER_PATTERN, hasExactKeys, isNonEmptyString, isRecord } from "./validation";

/** SPEC 0005 §6.2 vocabulary shared by the plan, event and Rules modules. */
export const CONCEALMENT_ATTENTION = ["watching", "unfocused", "distracted", "unseen"] as const;
export const CONCEALMENT_SENSES = ["sight", "hearing"] as const;
const MAX_OBSERVERS = 64, MAX_BASIS_REFS = 32, MAX_EVIDENCE = 2_000;

const isRef = (value: unknown): value is string => isNonEmptyString(value) && !/\s/.test(value);

/** A covert check's frozen observers: every candidate once, in code-unit
 * order, the primary among them and able to see the act. */
export function isFrozenConcealment(value: unknown): value is FrozenConcealment {
  if (!isRecord(value) || !hasExactKeys(value, ["evidence", "observers", "primaryObserverRef", "sense"])) return false;
  if (!isRef(value.primaryObserverRef) || !(CONCEALMENT_SENSES as readonly unknown[]).includes(value.sense)
    || !isNonEmptyString(value.evidence) || value.evidence.length > MAX_EVIDENCE) return false;
  const observers = value.observers;
  if (!Array.isArray(observers) || observers.length === 0 || observers.length > MAX_OBSERVERS) return false;
  if (!observers.every((observer) => isRecord(observer)
    && hasExactKeys(observer, ["attention", "basisRefs", "observerRef", "passivePerception"])
    && isRef(observer.observerRef)
    && (CONCEALMENT_ATTENTION as readonly unknown[]).includes(observer.attention)
    && typeof observer.passivePerception === "string" && CANONICAL_SIGNED_INTEGER_PATTERN.test(observer.passivePerception)
    && Array.isArray(observer.basisRefs) && observer.basisRefs.length <= MAX_BASIS_REFS && observer.basisRefs.every(isRef))) return false;
  const refs = observers.map((observer) => String((observer as { observerRef: string }).observerRef));
  if (refs.some((ref, index) => index > 0 && refs[index - 1]! >= ref)) return false;
  const primary = observers.find((observer) => (observer as { observerRef: string }).observerRef === value.primaryObserverRef);
  return primary !== undefined && (primary as { attention: string }).attention !== "unseen";
}
