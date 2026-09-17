/** SPEC 0016 §7.2: one explicit replacement, attached to its original physical
 * call. This does not change frozen workflow/profile or provider-request hashes. */
export const PROPOSAL_RECOVERY_SUFFIX = ":explicit-recovery:1";

export function proposalRecoveryBinding<T extends { invocationKey: string }>(binding: T): T {
  return { ...binding, invocationKey: `${binding.invocationKey}${PROPOSAL_RECOVERY_SUFFIX}` };
}
