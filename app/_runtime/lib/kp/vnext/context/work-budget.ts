import { canonicalHash } from "../canonical-json";

/**
 * Deterministic work accounting for adjudication-context preparation.
 *
 * Every dimension is charged *before* the work it pays for runs, so a scan that
 * would exceed the budget never allocates and never partially mutates a result.
 * Exhaustion is therefore a function of the frozen snapshot alone: the same
 * snapshot always produces the same receipt and the same ready/blocked outcome,
 * independent of machine load. Elapsed time is telemetry and must never decide
 * a semantic result.
 *
 * These limits are circuit breakers against unbounded scans. They are not a
 * judgement that the content beyond them is irrelevant: exhausting the budget
 * yields `preparationLimit`, never a silently smaller context. Calibrating them
 * against a pinned deployment tier and `limits.cpu_ms` is deploy qualification
 * and is deliberately not proven by the determinism contract below.
 */
export const CONTEXT_WORK_DIMENSIONS = Object.freeze([
  "scannedRecords",
  "searchableCharacters",
  "postingWrites",
  "postingVisits",
  "candidateScores",
  "relationEdgeVisits",
  "closureVisits",
  "authorityRereadBytes",
  "canonicalizeBytes",
] as const);

export type ContextWorkDimension = (typeof CONTEXT_WORK_DIMENSIONS)[number];

export type ContextWorkLimits = Readonly<Record<ContextWorkDimension, number>>;

/**
 * Per-record ceilings, as opposed to the cumulative `limits`. A record over the
 * ceiling is reported as `unavailable{notLoaded}` rather than being loaded or
 * being claimed absent, so an oversized continuity domain never masquerades as
 * an authoritative "there is no such record".
 */
export type ContextWorkCaps = Readonly<{
  maxEntryRereadBytes: number;
  /** An NPC's decision view gathers the records of everything it holds, so
   * it outgrows a single reread record; past this it freezes unavailable. */
  maxDecisionViewBytes: number;
}>;

export type ContextWorkBudgetProfile = Readonly<{
  profileRef: string;
  profileHash: string;
  limits: ContextWorkLimits;
  caps: ContextWorkCaps;
}>;

export type ContextWorkReceipt = Readonly<{
  profileRef: string;
  profileHash: string;
  spent: ContextWorkLimits;
  exhaustedDimension: ContextWorkDimension | null;
}>;

export type ContextWorkBudget = Readonly<{
  profile: ContextWorkBudgetProfile;
  /**
   * Charges `amount` against `dimension` before the work runs. Returns false
   * once the budget is spent; the caller must then abandon the work it failed
   * to charge for rather than proceeding uncharged.
   */
  charge: (dimension: ContextWorkDimension, amount: number) => boolean;
  exhausted: () => boolean;
  receipt: () => ContextWorkReceipt;
}>;

export function contextWorkBudgetProfile(
  profileRef: string,
  limits: ContextWorkLimits,
  caps: ContextWorkCaps,
): ContextWorkBudgetProfile {
  for (const dimension of CONTEXT_WORK_DIMENSIONS) {
    const limit = limits[dimension];
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new TypeError(`workBudget.limits.${dimension}:positive-safe-integer-required`);
    }
  }
  for (const cap of ["maxEntryRereadBytes", "maxDecisionViewBytes"] as const) {
    if (!Number.isSafeInteger(caps[cap]) || caps[cap] <= 0) {
      throw new TypeError(`workBudget.caps.${cap}:positive-safe-integer-required`);
    }
  }
  const normalized = Object.freeze(Object.fromEntries(
    CONTEXT_WORK_DIMENSIONS.map((dimension) => [dimension, limits[dimension]]),
  )) as ContextWorkLimits;
  const normalizedCaps = Object.freeze({ maxEntryRereadBytes: caps.maxEntryRereadBytes,
    maxDecisionViewBytes: caps.maxDecisionViewBytes });
  return Object.freeze({
    profileRef,
    profileHash: canonicalHash({ profileRef, limits: normalized, caps: normalizedCaps }),
    limits: normalized,
    caps: normalizedCaps,
  });
}

/**
 * Provisional stage-3a limits. They are pinned by `profileHash` so a change to
 * any number is a visible profile change rather than a silent behaviour drift.
 * vnext-2: an NPC's decision view has its own ceiling. Under the 64,000-byte
 * record cap, Lian's view in a local room grew about 6,500 bytes a round of
 * conversation (33,604 after four) and would have frozen unavailable after
 * about nine, failing every later talk with her (ADR 0049).
 */
export const VNEXT_CONTEXT_WORK_BUDGET = contextWorkBudgetProfile(
  "zhuwei.adjudication-context-work/vnext-2",
  {
    scannedRecords: 50_000,
    searchableCharacters: 2_000_000,
    postingWrites: 200_000,
    postingVisits: 200_000,
    candidateScores: 20_000,
    relationEdgeVisits: 100_000,
    closureVisits: 50_000,
    authorityRereadBytes: 4_000_000,
    canonicalizeBytes: 8_000_000,
  },
  { maxEntryRereadBytes: 64_000, maxDecisionViewBytes: 256_000 },
);

export function createContextWorkBudget(
  profile: ContextWorkBudgetProfile = VNEXT_CONTEXT_WORK_BUDGET,
): ContextWorkBudget {
  const spent = new Map<ContextWorkDimension, number>(
    CONTEXT_WORK_DIMENSIONS.map((dimension) => [dimension, 0]),
  );
  let exhaustedDimension: ContextWorkDimension | null = null;

  const charge = (dimension: ContextWorkDimension, amount: number): boolean => {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new TypeError(`workBudget.charge.${dimension}:non-negative-safe-integer-required`);
    }
    // The first exhausted dimension latches the whole budget. A caller that
    // kept spending other dimensions after one ran out would produce a result
    // shaped by charge ordering rather than by the snapshot.
    if (exhaustedDimension !== null) return false;
    const next = spent.get(dimension)! + amount;
    if (next > profile.limits[dimension]) {
      exhaustedDimension = dimension;
      return false;
    }
    spent.set(dimension, next);
    return true;
  };

  return Object.freeze({
    profile,
    charge,
    exhausted: () => exhaustedDimension !== null,
    receipt: () => Object.freeze({
      profileRef: profile.profileRef,
      profileHash: profile.profileHash,
      spent: Object.freeze(Object.fromEntries(
        CONTEXT_WORK_DIMENSIONS.map((dimension) => [dimension, spent.get(dimension)!]),
      )) as ContextWorkLimits,
      exhaustedDimension,
    }),
  });
}
