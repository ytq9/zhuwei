import type { VNextProposalBundleEntry } from "./proposal-schema";

/** The complete success/failure pair identifies the one uncertainty. Other
 * direct consequences are governed by the bundle's outcomeBinding, not by
 * additional copies of that check. Used by validation and graph derivation. */
export function vnextSharedCheckOwnerOrdinal(proposals: readonly VNextProposalBundleEntry[]): number | undefined {
  const owners = proposals.flatMap((entry, ordinal) => (entry.kind === "worldInteraction" || entry.kind === "observe" || entry.kind === "social")
    && entry.branches.failure !== null ? [{ entry, ordinal }] : []);
  return owners.length === 1 && owners[0].entry.outcomeBinding === "always" ? owners[0].ordinal : undefined;
}
