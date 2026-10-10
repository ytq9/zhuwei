import { compareCodeUnits, isPlainRecord } from "./canonical-json";
import { proposalInventoryEntryRefs } from "./proposal-context";
import type { VNextRequiredContext } from "./required-context";

export type FrozenRecords = ReadonlyMap<string, Record<string, unknown>>;

/** The known records of a frozen context, by entry ref. */
export function frozenRecords(context: VNextRequiredContext): FrozenRecords {
  return new Map(context.entries.flatMap(entry => entry.kind === "known" && isPlainRecord(entry.value)
    ? [[entry.entryRef, entry.value] as const] : []));
}

/** A container and everything holding it: nothing goes into itself or into
 * a container inside it. */
export function holdingChain(records: FrozenRecords, containerRef: string): ReadonlySet<string> {
  const holding = new Set([containerRef]);
  for (let ref = records.get(containerRef)?.containerRef; typeof ref === "string" && !holding.has(ref); ref = records.get(ref)?.containerRef) holding.add(ref);
  return holding;
}

const sorted = (refs: readonly string[]) => [...new Set(refs)].sort(compareCodeUnits);
/** Carried items the freeze only listed: a draft that names one has Room
 * read it before the draft is checked (ADR 0133). */
const listed = (context: VNextRequiredContext, records: FrozenRecords) =>
  (context.references.possessionRecall ?? []).filter(row => !records.has(row.entryRef));
const readItems = (context: VNextRequiredContext, records: FrozenRecords) => proposalInventoryEntryRefs(context)
  .flatMap(ref => { const value = records.get(ref); return value === undefined ? [] : [{ ref, value }]; });

/** SPEC 0016 §7.2: the items the actor carries loose and unequipped, read or
 * only listed -- what may be stored, handed over or put down. */
export function carriedLooseItemRefs(context: VNextRequiredContext, records: FrozenRecords = frozenRecords(context)): readonly string[] {
  return sorted([...readItems(context, records).filter(({ value }) => value.disposition === "held" && value.holderRef === context.intent.actorRef
    && value.containerRef === undefined && (value.equippedSlot === null || value.equippedSlot === undefined)).map(({ ref }) => ref),
    ...listed(context, records).filter(row => row.containerRef === null && row.equippedSlot === null).map(row => row.entryRef)]);
}

/** SPEC 0016 §7.2: what is inside one container, read or only listed --
 * what may be taken out of it. */
export function containedItemRefs(context: VNextRequiredContext, containerRef: string, records: FrozenRecords = frozenRecords(context)): readonly string[] {
  return sorted([...readItems(context, records).filter(({ value }) => value.containerRef === containerRef).map(({ ref }) => ref),
    ...listed(context, records).filter(row => row.containerRef === containerRef).map(row => row.entryRef)]);
}

/** The references a revision may name in place of a refused item of an
 * inventory operation: undefined where the operation offers none. A store
 * never offers its own container or what holds it. */
export function inventoryEntryCandidates(context: VNextRequiredContext, operation: Readonly<Record<string, unknown>>,
  records: FrozenRecords = frozenRecords(context)): readonly string[] | undefined {
  if (operation.kind === "store" && typeof operation.containerRef === "string") {
    const holding = holdingChain(records, operation.containerRef);
    return carriedLooseItemRefs(context, records).filter(ref => !holding.has(ref));
  }
  if (operation.kind === "transfer" || operation.kind === "release") return carriedLooseItemRefs(context, records);
  return undefined;
}
