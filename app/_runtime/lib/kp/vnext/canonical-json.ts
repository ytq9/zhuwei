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

/** Parses one complete JSON value while rejecting duplicate object members at
 * every depth. Native JSON.parse keeps the last duplicate and therefore
 * cannot prove which model-authored semantics were frozen. */
export function parseJsonWithUniqueMembers(source: string): unknown {
  if (typeof source !== "string") throw new TypeError("json:string-required");
  let cursor = 0;

  const skipWhitespace = (): void => {
    while (cursor < source.length && /[\u0020\u0009\u000a\u000d]/u.test(source[cursor]!)) {
      cursor += 1;
    }
  };

  const parseString = (): string => {
    if (source[cursor] !== "\"") throw new TypeError("json:string-expected");
    const start = cursor;
    cursor += 1;
    let escaped = false;
    while (cursor < source.length) {
      const character = source[cursor]!;
      if (escaped) {
        escaped = false;
        cursor += 1;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        cursor += 1;
        continue;
      }
      if (character === "\"") {
        cursor += 1;
        try {
          return JSON.parse(source.slice(start, cursor)) as string;
        } catch {
          throw new TypeError("json:string-invalid");
        }
      }
      cursor += 1;
    }
    throw new TypeError("json:string-unclosed");
  };

  const parseValue = (depth: number): unknown => {
    if (depth > 100) throw new TypeError("json:depth-exceeded");
    skipWhitespace();
    const character = source[cursor];
    if (character === "\"") return parseString();
    if (character === "{") {
      cursor += 1;
      const record = Object.create(null) as Record<string, unknown>;
      const keys = new Set<string>();
      skipWhitespace();
      if (source[cursor] === "}") {
        cursor += 1;
        return record;
      }
      while (cursor < source.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) throw new TypeError("json:duplicate-object-member");
        keys.add(key);
        skipWhitespace();
        if (source[cursor] !== ":") throw new TypeError("json:colon-expected");
        cursor += 1;
        record[key] = parseValue(depth + 1);
        skipWhitespace();
        if (source[cursor] === "}") {
          cursor += 1;
          return record;
        }
        if (source[cursor] !== ",") throw new TypeError("json:object-delimiter-expected");
        cursor += 1;
      }
      throw new TypeError("json:object-unclosed");
    }
    if (character === "[") {
      cursor += 1;
      const values: unknown[] = [];
      skipWhitespace();
      if (source[cursor] === "]") {
        cursor += 1;
        return values;
      }
      while (cursor < source.length) {
        values.push(parseValue(depth + 1));
        skipWhitespace();
        if (source[cursor] === "]") {
          cursor += 1;
          return values;
        }
        if (source[cursor] !== ",") throw new TypeError("json:array-delimiter-expected");
        cursor += 1;
      }
      throw new TypeError("json:array-unclosed");
    }
    for (const [literal, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (source.startsWith(literal, cursor)) {
        cursor += literal.length;
        return value;
      }
    }
    const number = source.slice(cursor).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u)?.[0];
    if (number !== undefined) {
      cursor += number.length;
      const value = Number(number);
      if (!Number.isFinite(value)) throw new TypeError("json:number-invalid");
      return value;
    }
    throw new TypeError("json:value-invalid");
  };

  const value = parseValue(0);
  skipWhitespace();
  if (cursor !== source.length) throw new TypeError("json:trailing-content");
  return value;
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
