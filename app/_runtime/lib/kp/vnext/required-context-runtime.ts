import {
  authorityReadSetConflicts,
  type AuthoritativeWorldState,
} from "../../rules/authority-read";
import type { ReadSetEntry, VNextRequiredContext } from "./required-context";

export type VNextContextReplayHead = Readonly<{
  eventSeq: string;
  stateHash: string;
}>;

export type VNextReadSetValidation =
  | Readonly<{ kind: "valid" }>
  | Readonly<{
      kind: "conflict";
      conflicts: readonly Readonly<{
        ref: string;
        expectedRevisionOrHash: string;
        actualRevisionOrHash: string | null;
      }>[];
    }>;

/** Re-resolves only dependencies selected by Proposal lowering. The larger
 * epistemic slice remains frozen for KP reasoning but is not a transaction
 * lock. */
export function validateVNextTransactionReadSet(
  readSet: readonly ReadSetEntry[],
  state: AuthoritativeWorldState,
): VNextReadSetValidation {
  const conflicts = authorityReadSetConflicts(state, readSet);
  return conflicts.length === 0
    ? Object.freeze({ kind: "valid" })
    : Object.freeze({ kind: "conflict", conflicts: Object.freeze(conflicts) });
}

export function requiredContextAuthorityRefs(context: VNextRequiredContext): ReadonlySet<string> {
  return new Set([
    ...context.references.citations.authorityBasisRefs,
    ...context.references.citations.viewerEvidenceRefs,
    ...context.references.citations.npcKnowledge.flatMap(({ refs }) => refs),
    ...context.entries.flatMap((entry) =>
      "basisRefs" in entry ? [...entry.basisRefs] : []),
  ]);
}

export function requiredContextViewerRefs(context: VNextRequiredContext): ReadonlySet<string> {
  return new Set(context.references.citations.viewerEvidenceRefs);
}

export function requiredContextReadRefs(context: VNextRequiredContext): ReadonlySet<string> {
  return new Set([
    ...context.entries.flatMap((entry) => [
      ...(entry.kind === "known" ? [entry.entryRef] : []),
      ...( "basisRefs" in entry ? [...entry.basisRefs] : []),
    ]),
    ...context.references.citations.npcKnowledge.flatMap(({ refs }) => refs),
  ]);
}
