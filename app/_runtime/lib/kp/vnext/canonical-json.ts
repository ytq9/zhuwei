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

export type JsonSyntaxDiagnostic = Readonly<{
  reason: string;
  path: readonly (string | number)[];
  /** Zero-based UTF-16 offset; line and column are one-based. */
  offset: number;
  line: number;
  column: number;
}>;

/** Locations identify where this parser detected the error. An invalid JSON
 * string token is located at its opening quote, not a guessed bad character. */
export class JsonSyntaxError extends TypeError implements JsonSyntaxDiagnostic {
  readonly reason: string;
  readonly path: readonly (string | number)[];
  readonly offset: number;
  readonly line: number;
  readonly column: number;

  constructor(source: string, reason: string, path: readonly (string | number)[], offset: number) {
    super(reason);
    this.name = "JsonSyntaxError";
    const diagnostic = jsonSyntaxDiagnostic(source, reason, path, offset);
    this.reason = diagnostic.reason;
    this.path = diagnostic.path;
    this.offset = diagnostic.offset;
    this.line = diagnostic.line;
    this.column = diagnostic.column;
  }
}

function jsonSyntaxDiagnostic(source: string, reason: string,
  path: readonly (string | number)[], offset: number): JsonSyntaxDiagnostic {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\r") {
      if (source[index + 1] === "\n" && index + 1 < offset) index += 1;
      line += 1;
      column = 1;
    } else if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else column += 1;
  }
  return Object.freeze({ reason, path: Object.freeze([...path]), offset, line, column });
}

/** Parses one complete JSON value while rejecting duplicate object members at
 * every depth. Native JSON.parse keeps the last duplicate and therefore
 * cannot prove which model-authored semantics were frozen. */
export function parseJsonWithUniqueMembers(source: string): unknown {
  return parseUniqueJson(source, false).value;
}

export type JsonNumberToken = Readonly<{
  path: readonly (string | number)[];
  raw: string;
  startOffset: number;
  endOffset: number;
}>;

/** Same unique-member parser, with exact number lexemes retained before IEEE-754
 * conversion. Evidence is returned only after the whole source has parsed. */
export function parseJsonWithNumberTokens(source: string): Readonly<{
  value: unknown;
  numberTokens: readonly JsonNumberToken[];
}> {
  const result = parseUniqueJson(source, false, true);
  return deepFreeze({ value: result.value, numberTokens: result.numberTokens });
}

type RootSyntaxIssue = "json:root-close-missing" | "json:root-trailing-comma" | "json:root-redundant-delimiters";

/** Evidence only: every root member and every nested value must be complete.
 * This does not return an accepted Proposal or repair a truncated child. */
export function completeJsonObjectSyntaxEvidence(source: string): Readonly<{
  value: Record<string, unknown>;
  issue: RootSyntaxIssue;
  diagnostic: JsonSyntaxDiagnostic;
  numberTokens: readonly JsonNumberToken[];
}> {
  const result = parseUniqueJson(source, true, true);
  if (!isPlainRecord(result.value) || result.issue === undefined || result.diagnostic === undefined) {
    throw new JsonSyntaxError(source, "json:root-syntax-evidence-required", [], source.length);
  }
  return deepFreeze({ value: result.value, issue: result.issue, diagnostic: result.diagnostic, numberTokens: result.numberTokens });
}

function parseUniqueJson(source: string, collectRootEvidence: boolean, collectNumberTokens = false): {
  value: unknown;
  numberTokens: readonly JsonNumberToken[];
  issue?: RootSyntaxIssue;
  diagnostic?: JsonSyntaxDiagnostic;
} {
  if (typeof source !== "string") throw new JsonSyntaxError("", "json:string-required", [], 0);
  let cursor = 0;
  const numberTokens: JsonNumberToken[] = [];
  let issue: RootSyntaxIssue | undefined;
  let diagnostic: JsonSyntaxDiagnostic | undefined;
  const invalid = (reason: string, path: readonly (string | number)[], offset = cursor): never => {
    throw new JsonSyntaxError(source, reason, path, offset);
  };

  const skipWhitespace = (): void => {
    while (cursor < source.length && /[\u0020\u0009\u000a\u000d]/u.test(source[cursor]!)) {
      cursor += 1;
    }
  };

  // Only after every root member value has parsed successfully. No keys,
  // scalars, opening delimiters or incomplete child can enter this suffix.
  const closingSuffixOnly = (): boolean => /^[}\]\u0020\u0009\u000a\u000d]+$/u.test(source.slice(cursor));

  const parseString = (path: readonly (string | number)[]): string => {
    if (source[cursor] !== "\"") return invalid("json:string-expected", path);
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
          return invalid("json:string-invalid", path, start);
        }
      }
      cursor += 1;
    }
    return invalid("json:string-unclosed", path);
  };

  const parseValue = (depth: number, path: readonly (string | number)[]): unknown => {
    if (depth > 100) return invalid("json:depth-exceeded", path);
    skipWhitespace();
    const character = source[cursor];
    if (character === "\"") return parseString(path);
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
        const keyStart = cursor;
        const key = parseString(path);
        const memberPath = [...path, key];
        if (keys.has(key)) return invalid("json:duplicate-object-member", memberPath, keyStart);
        keys.add(key);
        skipWhitespace();
        if (source[cursor] !== ":") return invalid("json:colon-expected", memberPath);
        cursor += 1;
        record[key] = parseValue(depth + 1, memberPath);
        skipWhitespace();
        if (collectRootEvidence && depth === 0 && cursor === source.length) {
          issue = "json:root-close-missing";
          diagnostic = jsonSyntaxDiagnostic(source, issue, path, cursor);
          return record;
        }
        if (collectRootEvidence && depth === 0 && source[cursor] === "]" && closingSuffixOnly()) {
          issue = "json:root-redundant-delimiters";
          diagnostic = jsonSyntaxDiagnostic(source, "json:object-delimiter-expected", path, cursor);
          cursor = source.length;
          return record;
        }
        if (source[cursor] === "}") {
          cursor += 1;
          return record;
        }
        if (source[cursor] !== ",") return invalid("json:object-delimiter-expected", path);
        const commaOffset = cursor;
        cursor += 1;
        if (collectRootEvidence && depth === 0) {
          skipWhitespace();
          if (cursor === source.length || source[cursor] === "}") {
            issue = "json:root-trailing-comma";
            diagnostic = jsonSyntaxDiagnostic(source, issue, path, commaOffset);
            if (source[cursor] === "}") cursor += 1;
            return record;
          }
        }
      }
      return invalid("json:object-unclosed", path);
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
        values.push(parseValue(depth + 1, [...path, values.length]));
        skipWhitespace();
        if (source[cursor] === "]") {
          cursor += 1;
          return values;
        }
        if (source[cursor] !== ",") return invalid("json:array-delimiter-expected", path);
        cursor += 1;
      }
      return invalid("json:array-unclosed", path);
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
      const startOffset = cursor;
      cursor += number.length;
      const value = Number(number);
      if (!Number.isFinite(value)) return invalid("json:number-invalid", path);
      if (collectNumberTokens) numberTokens.push({ path: [...path], raw: number, startOffset, endOffset: cursor });
      return value;
    }
    return invalid("json:value-invalid", path);
  };

  const value = parseValue(0, []);
  skipWhitespace();
  if (cursor !== source.length) {
    if (!collectRootEvidence || !isPlainRecord(value) || issue !== undefined || !closingSuffixOnly()) {
      return invalid("json:trailing-content", []);
    }
    issue = "json:root-redundant-delimiters";
    diagnostic = jsonSyntaxDiagnostic(source, "json:trailing-content", [], cursor);
  }
  return { value, numberTokens, ...(issue === undefined ? {} : { issue, diagnostic }) };
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
