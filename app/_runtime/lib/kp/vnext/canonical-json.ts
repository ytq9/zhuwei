import {
  canonicalProfileBytes,
  canonicalSha256,
} from "../../rules/profiles/canonical";

export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | readonly JsonValue[] | JsonRecord;
export interface JsonRecord {
  readonly [key: string]: JsonValue;
}

export function canonicalHash(value: unknown): string {
  return canonicalSha256(value);
}

export function canonicalUnits(value: unknown): number {
  return Math.max(1, Math.ceil(canonicalProfileBytes(value).byteLength / 4));
}

export function canonicalClone<T>(value: T): T {
  canonicalHash(value);
  return structuredClone(value);
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function compareCodeUnits(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function sortedUniqueStrings(values: readonly string[], label: string): readonly string[] {
  if (values.some((value) => !isNonEmptyString(value))) {
    throw new TypeError(`${label}:non-empty-string-required`);
  }
  const sorted = [...values].sort(compareCodeUnits);
  if (sorted.some((value, index) => index > 0 && value === sorted[index - 1])) {
    throw new TypeError(`${label}:duplicate`);
  }
  return Object.freeze(sorted);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function issueMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown-error";
}
