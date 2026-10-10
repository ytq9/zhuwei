import {
  authorityEquippedItemWeaponAbilityRefs,
  authorityItemComposite,
  authorityRevisionOrHash,
  authoritySpatialRefVisibleTo,
  containedItemAccessible,
  itemEntryUseAbilityId,
  type AuthoritativeWorldState,
} from "../../../rules/authority-read";
import { canonicalHash, canonicalUnits, compareCodeUnits, isPlainRecord } from "../canonical-json";
import type { RequiredContextPossessionRecall } from "../required-context";
import { VNEXT_CONTEXT_WORK_BUDGET, type ContextWorkBudget } from "./work-budget";

/** At most this many rows; the rest are counted, and naming one still
 * reaches it through ordinary discovery. */
export const POSSESSION_RECALL_MAX_ROWS = 24;

export type PossessionRecallDirectory = Readonly<{ rows: readonly RequiredContextPossessionRecall[]; omitted: number }>;

/**
 * SPEC 0016 §4.3 (ADR 0132): the actor's carried items the closure did not
 * read. Reading every one of them would send each item's record and
 * definition with every request, about 4,600 conservative tokens for a
 * fighter carrying an explorer's pack, while a vague "the one I just took
 * out" names none of them. Each row is what a stage can match such a
 * reference against -- the item's name, count and where it is carried --
 * and the version of each record a stage that names the item then reads.
 *
 * Items alike in everything but their identity share one row, read through
 * its first instance, so ninety identical tubes are one line. Equipped and
 * loose items come first; past `POSSESSION_RECALL_MAX_ROWS` rows the rest
 * are counted. Items inside a closed container stay out: what the actor
 * remembers of them is that container's inspection memory (ADR 0130).
 */
export function possessionRecallRows(state: AuthoritativeWorldState, actorRef: string, sceneRef: string,
  frozen: ReadonlySet<string>, budget: ContextWorkBudget): PossessionRecallDirectory | undefined {
  const system = state.campaignRuntime.itemSystem;
  const groups = new Map<string, { entryRef: string; count: number; equipped: boolean; loose: boolean }>();
  for (const entry of Object.values(system.entries)) {
    if (!budget.charge("postingVisits", 1)) return undefined;
    if (entry.disposition !== "held" || entry.holderRef !== actorRef || entry.assemblyRef !== undefined
      || frozen.has(entry.entryId) || system.definitions[entry.definitionRef] === undefined
      || !containedItemAccessible(system, entry) || !authoritySpatialRefVisibleTo(state, entry.entryId, sceneRef, actorRef)) continue;
    // Alike as the actor reads them: how a stack came to its hands sets it
    // apart (ADR 0136).
    const composite = possessionRecordValue(state, entry.entryId, actorRef);
    if (!isPlainRecord(composite)) continue;
    const { entryId: _entryId, ...alike } = composite;
    const key = canonicalHash(alike);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { entryRef: entry.entryId, count: 1, equipped: entry.equippedSlot !== null, loose: entry.containerRef === undefined });
    } else {
      group.count += 1;
      if (compareCodeUnits(entry.entryId, group.entryRef) < 0) group.entryRef = entry.entryId;
    }
  }
  const ordered = [...groups.values()].sort((left, right) => Number(right.equipped) - Number(left.equipped)
    || Number(right.loose) - Number(left.loose) || compareCodeUnits(left.entryRef, right.entryRef));
  const rows: RequiredContextPossessionRecall[] = [];
  let omitted = 0;
  for (const group of ordered) {
    if (rows.length >= POSSESSION_RECALL_MAX_ROWS) { omitted += group.count; continue; }
    const entry = system.entries[group.entryRef]!;
    const records: { entryRef: string; revisionOrHash: string; valueHash?: string }[] = [];
    let complete = true;
    for (const ref of possessionRecordRefs(state, entry.entryId, budget)) {
      if (ref !== entry.entryId && frozen.has(ref)) continue;
      const revisionOrHash = authorityRevisionOrHash(state, ref);
      const value = possessionRecordValue(state, ref, actorRef);
      if (revisionOrHash === null || value === undefined) { complete = false; break; }
      const valueHash = canonicalHash(value);
      records.push({ entryRef: ref, revisionOrHash, ...(valueHash === revisionOrHash ? {} : { valueHash }) });
    }
    if (!complete) continue;
    const own = possessionRecordValue(state, entry.entryId, actorRef);
    const parts = isPlainRecord(own) && Array.isArray(own.acquiredFrom) ? own.acquiredFrom.flatMap(part => isPlainRecord(part)
      ? [Object.freeze({ from: part.from as "container" | "ground" | "character", ref: String(part.ref), quantity: Number(part.quantity),
        eventSeq: String(part.eventSeq) })] : []) : [];
    rows.push(Object.freeze({ entryRef: entry.entryId, label: system.definitions[entry.definitionRef]!.content.label,
      quantity: entry.quantity, ...(group.count === 1 ? {} : { count: group.count }), equippedSlot: entry.equippedSlot,
      containerRef: entry.containerRef ?? null, ...(parts.length === 0 ? {} : { acquiredFrom: Object.freeze(parts) }),
      records: Object.freeze(records) }));
  }
  return Object.freeze({ rows: Object.freeze(rows.sort((left, right) => compareCodeUnits(left.entryRef, right.entryRef))), omitted });
}

/** The records a carried item brings when named, as the closure would read
 * them: the item, its definition, and the abilities it grants -- its
 * per-instance use and, while equipped, its weapon attacks. */
function possessionRecordRefs(state: AuthoritativeWorldState, entryRef: string, budget: ContextWorkBudget): readonly string[] {
  const entry = state.campaignRuntime.itemSystem.entries[entryRef]!;
  const definition = state.campaignRuntime.itemSystem.definitions[entry.definitionRef];
  const use = definition?.content.use;
  const abilities = [
    ...authorityEquippedItemWeaponAbilityRefs(state, entryRef, count => budget.charge("postingVisits", count)),
    ...(use === null || use === undefined ? [] : [itemEntryUseAbilityId(use.abilityRef, entry.entryId)]),
  ].filter(ref => state.combatRuntime.definitions[ref] !== undefined);
  return [entryRef, entry.definitionRef, ...[...new Set(abilities)].sort(compareCodeUnits)];
}

/** How a recalled record is cited: the item itself is something the actor
 * holds in view; its definition and abilities are authority material, as
 * the freeze classes them. */
export function possessionRecordCitation(row: RequiredContextPossessionRecall, entryRef: string): "viewer" | "authority" {
  return entryRef === row.entryRef ? "viewer" : "authority";
}

/** The value a frozen context holds for one of these records: the item's
 * composite as the actor reads it, or the definition or ability as stored. */
export function possessionRecordValue(state: AuthoritativeWorldState, ref: string, actorRef: string): unknown {
  if (state.campaignRuntime.itemSystem.entries[ref] !== undefined) return actorItemRecord(authorityItemComposite(state, ref), actorRef);
  return state.campaignRuntime.itemSystem.definitions[ref] ?? state.combatRuntime.definitions[ref];
}

/** An item or container composite as one actor reads it: the inspection
 * memories and how a stack came to hand are that actor's own (ADR 0130,
 * ADR 0136). Another character's are left out, and an empty list of how it
 * came to hand goes with them. */
export function actorItemRecord(record: unknown, actorRef: string): unknown {
  if (!isPlainRecord(record) || (!Array.isArray(record.containerMemories) && !Array.isArray(record.acquiredFrom))) return record;
  const own = (list: unknown) => (Array.isArray(list) ? list : []).filter(item => isPlainRecord(item) && item.observerRef === actorRef);
  return Object.fromEntries(Object.entries(record).flatMap(([key, value]) => key === "containerMemories" ? [[key, own(value)]]
    : key !== "acquiredFrom" ? [[key, value]] : own(value).length === 0 ? [] : [[key, own(value)]]));
}

/** Room's read when a stage names carried items (ADR 0132): each record the
 * context does not hold yet, from authority now, at exactly the version and
 * value the row recorded. A record that changed since the freeze fails the
 * read as stale; one over the per-record cap is refused as freezing would. */
export function readPossessionRecords(context: Readonly<{ intent: { actorRef: string }; entries: readonly { entryRef: string }[];
  references: { possessionRecall?: readonly RequiredContextPossessionRecall[] } }>, requested: readonly string[],
  state: AuthoritativeWorldState): readonly Readonly<{ entryRef: string; revisionOrHash: string; value: unknown }>[] {
  const present = new Set(context.entries.map(entry => entry.entryRef));
  const read = new Map<string, Readonly<{ entryRef: string; revisionOrHash: string; value: unknown }>>();
  for (const row of context.references.possessionRecall ?? []) {
    if (!requested.includes(row.entryRef)) continue;
    for (const record of row.records) {
      if (present.has(record.entryRef) || read.has(record.entryRef)) continue;
      if (authorityRevisionOrHash(state, record.entryRef) !== record.revisionOrHash) {
        throw new TypeError(`possession-recall:record-changed:${record.entryRef}`);
      }
      const value = possessionRecordValue(state, record.entryRef, context.intent.actorRef);
      if (value === undefined || canonicalHash(value) !== (record.valueHash ?? record.revisionOrHash)
        || canonicalUnits(value) * 4 > VNEXT_CONTEXT_WORK_BUDGET.caps.maxEntryRereadBytes) {
        throw new TypeError(`possession-recall:record-unavailable:${record.entryRef}`);
      }
      read.set(record.entryRef, Object.freeze({ entryRef: record.entryRef, revisionOrHash: record.revisionOrHash, value }));
    }
  }
  return Object.freeze([...read.values()].sort((left, right) => compareCodeUnits(left.entryRef, right.entryRef)));
}
