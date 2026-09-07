import {
  authorityReadSetConflicts,
  type AuthoritativeWorldState,
} from "../../rules/authority-read";
import type { ReadSetEntry, VNextRequiredContext } from "./required-context";
import { compareCodeUnits, isPlainRecord } from "./canonical-json";

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
    ...requiredContextReadBindings(context).keys(),
    ...context.entries.flatMap((entry) => [
      ...( "basisRefs" in entry ? [...entry.basisRefs] : []),
    ]),
    ...context.references.citations.npcKnowledge.flatMap(({ refs }) => refs),
  ]);
}

export type VNextBasisReferenceChoices = Readonly<{
  existingRefs: readonly string[];
  viewerRefs: readonly string[];
}>;
export type VNextBasisReferenceRejection = "proposal:basis-ref-not-authorized" | "proposal:basis-ref-not-read-bound";

/** The proposal guard and its model-facing choices share this admission.
 * Loaded context wrappers are not automatically authority references. Exact
 * selected read locks and each consumer's narrower scope still apply later. */
export function requiredContextBasisReferences(context: VNextRequiredContext): VNextBasisReferenceChoices & Readonly<{
  rejection(ref: string): VNextBasisReferenceRejection | undefined;
}> {
  const authority = requiredContextAuthorityRefs(context), read = requiredContextReadRefs(context);
  const rejection = (ref: string): VNextBasisReferenceRejection | undefined => !authority.has(ref)
    ? "proposal:basis-ref-not-authorized" : !read.has(ref) ? "proposal:basis-ref-not-read-bound" : undefined;
  const existingRefs = Object.freeze([...authority].filter(ref => rejection(ref) === undefined).sort(compareCodeUnits));
  const viewer = requiredContextViewerRefs(context);
  return Object.freeze({ existingRefs,
    viewerRefs: Object.freeze(existingRefs.filter(ref => viewer.has(ref))), rejection });
}

/** Guard and lock selection resolve the same exact frozen record. A raw
 * knowledge ID aliases only the actor's loaded, holder-qualified body; an
 * advertised ID or another holder's same ID is insufficient. */
export function requiredContextReadBindings(context: VNextRequiredContext): ReadonlyMap<string, ReadSetEntry> {
  const bindings = new Map<string, ReadSetEntry>(context.entries.flatMap(entry => entry.kind === "known"
    ? [[entry.entryRef, { ref: entry.entryRef, revisionOrHash: entry.revisionOrHash }]] : []));
  for (const entry of context.entries) {
    if (entry.kind !== "known" || !isPlainRecord(entry.value)
      || entry.value.characterId !== context.intent.actorRef || typeof entry.value.knowledgeRef !== "string"
      || entry.entryRef !== `knowledge:${context.intent.actorRef}:${entry.value.knowledgeRef}`) continue;
    if (!bindings.has(entry.value.knowledgeRef)) bindings.set(entry.value.knowledgeRef,
      { ref: entry.entryRef, revisionOrHash: entry.revisionOrHash });
  }
  return bindings;
}
