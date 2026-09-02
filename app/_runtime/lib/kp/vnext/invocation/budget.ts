import { canonicalHash } from "../canonical-json";

/**
 * The input ceiling for one actual provider request.
 *
 * This is not the ceiling on the frozen context artifact. A context that fits
 * comfortably on its own can still overflow once the system prompt, Form and
 * tool schemas, static material and repair diagnostics are assembled around it,
 * which is why the gate is applied to the assembled body and to nothing else.
 *
 * `allowedInputTokens` is what remains of the model's own window after the
 * completion reserve and a safety margin: a request that leaves no room to
 * answer is not a request that fits.
 */
export type ProviderBudgetProfile = Readonly<{
  profileRef: string;
  profileHash: string;
  contextWindowTokens: number;
  completionReserveTokens: number;
  safetyMarginTokens: number;
  counterRef: TokenCounterRef;
}>;

export type TokenCounterRef = "conservative-v1";

export type BudgetReceipt = Readonly<{
  profileRef: string;
  profileHash: string;
  counterRef: TokenCounterRef;
  estimatedInputTokens: number;
  allowedInputTokens: number;
  decision: "accepted" | "blocked";
}>;

export function providerBudgetProfile(
  profileRef: string,
  input: Readonly<{
    contextWindowTokens: number;
    completionReserveTokens: number;
    safetyMarginTokens: number;
    counterRef: TokenCounterRef;
  }>,
): ProviderBudgetProfile {
  for (const [label, value] of Object.entries({
    contextWindowTokens: input.contextWindowTokens,
    completionReserveTokens: input.completionReserveTokens,
    safetyMarginTokens: input.safetyMarginTokens,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`providerBudget.${label}:positive-safe-integer-required`);
    }
  }
  if (input.contextWindowTokens
    <= input.completionReserveTokens + input.safetyMarginTokens) {
    throw new TypeError("providerBudget.contextWindowTokens:must-exceed-reserve-and-margin");
  }
  if (input.counterRef !== "conservative-v1") {
    throw new TypeError("providerBudget.counterRef:unsupported");
  }
  return Object.freeze({
    profileRef,
    profileHash: canonicalHash({ profileRef, ...input }),
    ...input,
  });
}

/**
 * DeepSeek exposes no token-counting endpoint, so this gate is an estimate and
 * is built to overestimate rather than to be accurate. Treating it as a true
 * token count would be the same mistake as the byte-derived ceiling it
 * replaces. Calibrating it against a real provider — and revising both the
 * counter ref and this profile hash when that happens — is deploy
 * qualification and has not been done.
 */
export const VNEXT_PROPOSAL_BUDGET = providerBudgetProfile(
  "zhuwei.proposal-input-budget/vnext-1",
  {
    contextWindowTokens: 32_000,
    completionReserveTokens: 4_000,
    safetyMarginTokens: 2_000,
    counterRef: "conservative-v1",
  },
);

export function allowedInputTokens(profile: ProviderBudgetProfile): number {
  return profile.contextWindowTokens
    - profile.completionReserveTokens
    - profile.safetyMarginTokens;
}

/**
 * Versioned conservative counter. CJK characters are charged a whole token
 * each and everything else a token per three characters, both above what a
 * BPE tokenizer typically produces, plus a fixed envelope allowance. It is
 * deliberately pessimistic: an estimate that under-counts would let a request
 * through to fail at the provider, which is the failure this gate exists to
 * prevent.
 */
export function conservativeInputTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const character of text) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return ENVELOPE_TOKENS + cjk + Math.ceil(other / 3);
}

const ENVELOPE_TOKENS = 64;

export function evaluateInputBudget(
  serializedBody: string,
  profile: ProviderBudgetProfile,
): BudgetReceipt {
  const estimatedInputTokens = conservativeInputTokens(serializedBody);
  const allowed = allowedInputTokens(profile);
  return Object.freeze({
    profileRef: profile.profileRef,
    profileHash: profile.profileHash,
    counterRef: profile.counterRef,
    estimatedInputTokens,
    allowedInputTokens: allowed,
    decision: estimatedInputTokens > allowed ? "blocked" : "accepted",
  });
}
