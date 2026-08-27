import type { JsonRecord } from "./model";

const CONTINUED_COMPOUND_ROOT = Symbol("zhuwei.rules.continued-compound-root");

type ContinuedCompoundInput = JsonRecord & {
  [CONTINUED_COMPOUND_ROOT]?: string;
};

/**
 * Marks an in-memory Rules command as the mechanical continuation of a story
 * prefix already committed under the same root action. Symbols do not survive
 * JSON and are ignored by exact-key validation, so a client or model cannot
 * manufacture this capability at the public `step` boundary.
 */
export function continueCompoundRoot<T extends JsonRecord>(input: T, rootActionId: string): T {
  Object.defineProperty(input, CONTINUED_COMPOUND_ROOT, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: rootActionId,
  });
  return input;
}

export function isContinuedCompoundRoot(input: unknown, rootActionId: string): boolean {
  return input !== null
    && typeof input === "object"
    && (input as ContinuedCompoundInput)[CONTINUED_COMPOUND_ROOT] === rootActionId;
}
