import { authorityKnowledgeText, fictionDayOf, type AuthoritativeWorldState } from "../../../rules/authority-read";
import { canonicalHash, compareCodeUnits, deepFreeze, isPlainRecord } from "../canonical-json";
import { buildRequiredContext, type VNextRequiredContext } from "../required-context";
import { knowledgeGroups, knowledgeHeldAt } from "./knowledge-relevance";
import { recentMemoryRounds, isRoundMemory, RECENT_MEMORY_ROUNDS } from "./npc-decision";

/** SPEC 0016 §§4.3、4.5: model prose is a retrieval hint, never evidence.
 * Segments are made from original held records, independently of an action's
 * relevance selection. A summary is never the input to another summary. */
export const KNOWLEDGE_SUMMARY_POLICY = deepFreeze({ schema: "zhuwei.knowledge-summary-policy/v1",
  maxRecords: 32, maxCharacters: 12_000, maxSummaryCharacters: 240, maxHintsPerGroup: 2, maxHintsPerHolder: 8 });
export type KnowledgeSummarySegment = Readonly<{
  roomId: string; runtimeEpochId: string; branchId: string; holderRef: string; groupRef: string;
  sources: readonly Readonly<{ knowledgeRef: string; revisionOrHash: string; textHash: string }>[];
  sourceHash: string;
}>;
export type KnowledgeSummaryHint = Readonly<{ segment: KnowledgeSummarySegment; summary: string }>;

export function knowledgeSummarySegments(state: AuthoritativeWorldState, holderRef: string): readonly KnowledgeSummarySegment[] {
  const held = knowledgeHeldAt(state, holderRef, state.version);
  const recent = recentMemoryRounds(held, RECENT_MEMORY_ROUNDS);
  const older = held.filter(record => !isRoundMemory(record) || !recent.has(record.acquiredAtFictionMicros));
  const groups = knowledgeGroups(state, holderRef, held, new Set(older.map(record => record.knowledgeRef)));
  const timelineId = state.multiplayerRuntime.characterTimelineIds[holderRef] ?? state.activeBranchId;
  const today = fictionDayOf(state, state.fictionTimelines[timelineId]?.nowMicros ?? "0");
  const segments: KnowledgeSummarySegment[] = [];
  for (const group of groups) {
    let sources: KnowledgeSummarySegment["sources"][number][] = [], characters = 0;
    const flush = () => {
      if (sources.length === 0) return;
      const body = { roomId: state.roomId, runtimeEpochId: state.runtimeEpochId, branchId: state.activeBranchId,
        holderRef, groupRef: group.groupRef, sources };
      segments.push(deepFreeze({ ...body, sourceHash: canonicalHash(body) }));
      sources = []; characters = 0;
    };
    // Fiction time can be equal for many acquisitions (especially combat).
    // The acquisition event, then the stable record ref, keeps closed chunks
    // fixed even when a later event adds a lexically earlier ref that instant.
    const sequence = (ref: string) => BigInt(/:([0-9]+)$/u.exec(state.knowledge[holderRef][ref].acquiredByEventId)?.[1] ?? "0");
    const members = [...group.members].sort((a, b) => sequence(a) < sequence(b) ? -1 : sequence(a) > sequence(b) ? 1 : compareCodeUnits(a, b));
    for (const ref of members) {
      const text = authorityKnowledgeText(state, holderRef, ref);
      // Missing/oversized raw records cannot be replaced with invented text.
      if (text === undefined || [...text].length > KNOWLEDGE_SUMMARY_POLICY.maxCharacters) { flush(); continue; }
      const size = [...text].length;
      if (sources.length === KNOWLEDGE_SUMMARY_POLICY.maxRecords || characters + size > KNOWLEDGE_SUMMARY_POLICY.maxCharacters) flush();
      sources.push({ knowledgeRef: ref, revisionOrHash: canonicalHash(state.knowledge[holderRef][ref]), textHash: canonicalHash(text) });
      characters += size;
      if (sources.length === KNOWLEDGE_SUMMARY_POLICY.maxRecords) flush();
    }
    // A day's tail closes only once that day has ended. Leaving and returning
    // to a scene on the same day must not change an earlier partial segment.
    if (group.day === null || (today !== undefined && group.day < today)) flush();
  }
  return Object.freeze(segments);
}

export function knowledgeSummarySourceMatches(state: AuthoritativeWorldState, segment: KnowledgeSummarySegment): boolean {
  if (state.roomId !== segment.roomId || state.runtimeEpochId !== segment.runtimeEpochId || state.activeBranchId !== segment.branchId
    || segment.sources.length === 0 || segment.sources.length > KNOWLEDGE_SUMMARY_POLICY.maxRecords) return false;
  const { sourceHash, ...body } = segment;
  if (canonicalHash(body) !== sourceHash) return false;
  let characters = 0;
  for (const source of segment.sources) {
    const held = state.knowledge[segment.holderRef]?.[source.knowledgeRef];
    const text = authorityKnowledgeText(state, segment.holderRef, source.knowledgeRef);
    if (!held || canonicalHash(held) !== source.revisionOrHash || text === undefined || canonicalHash(text) !== source.textHash) return false;
    characters += [...text].length;
  }
  return characters <= KNOWLEDGE_SUMMARY_POLICY.maxCharacters;
}

/** Rebuilding an NPC's frozen request selects its original hint witnesses,
 * even if another action completed a summary in the meantime. */
export function frozenKnowledgeSummaryHashes(context: VNextRequiredContext): ReadonlySet<string> {
  return new Set(context.entries.flatMap(entry => entry.kind === "known" && entry.entryRef.startsWith("knowledge-directory:")
    && isPlainRecord(entry.value) && Array.isArray(entry.value.groups) ? entry.value.groups.flatMap(group =>
      isPlainRecord(group) && Array.isArray(group.summaries) ? group.summaries.flatMap(hint =>
        isPlainRecord(hint) && typeof hint.sourceHash === "string" ? [hint.sourceHash] : []) : []) : []));
}

/** Adds only non-citable, holder-bound hints and re-freezes the complete
 * snapshot. The original recall membership, versions and handles stay put. */
export function withKnowledgeSummaryHints(context: VNextRequiredContext, state: AuthoritativeWorldState,
  hints: readonly KnowledgeSummaryHint[], maxUnits = 160_000): VNextRequiredContext {
  const valid = hints.filter(hint => typeof hint.summary === "string" && hint.summary.trim().length > 0
    && [...hint.summary].length <= KNOWLEDGE_SUMMARY_POLICY.maxSummaryCharacters && knowledgeSummarySourceMatches(state, hint.segment));
  if (valid.length === 0) return context;
  let changed = false;
  const entries = context.entries.map(entry => {
    if (entry.kind !== "known" || !entry.entryRef.startsWith("knowledge-directory:") || !isPlainRecord(entry.value)
      || typeof entry.value.holderRef !== "string" || !Array.isArray(entry.value.groups)
      || !context.references.citations.nonCitableRefs.includes(entry.entryRef)) return entry;
    const holder = entry.value.holderRef, records = knowledgeHeldAt(state, holder, context.binding.baseEventSeq);
    const groupNames = knowledgeGroups(state, holder, records, new Set(records.map(record => record.knowledgeRef)));
    const recall = context.references.knowledgeRecall?.find(row => row.holderRef === holder);
    const candidates = valid.filter(hint => hint.segment.holderRef === holder);
    // Newest segments first within a fixed total allowance; a query may name
    // an older group's handle and read every original record through recall.
    const ordered = [...candidates].sort((a, b) => {
      const at = (hint: KnowledgeSummaryHint) => state.knowledge[holder][hint.segment.sources.at(-1)!.knowledgeRef].acquiredAtFictionMicros;
      return BigInt(at(a)) > BigInt(at(b)) ? -1 : BigInt(at(a)) < BigInt(at(b)) ? 1 : compareCodeUnits(a.segment.sourceHash, b.segment.sourceHash);
    }).slice(0, KNOWLEDGE_SUMMARY_POLICY.maxHintsPerHolder);
    const groups = entry.value.groups.map(line => {
      if (!isPlainRecord(line)) return line;
      const named = groupNames.filter(group => group.label === line.label);
      const groupRef = typeof line.handle === "string" ? recall?.groups?.find(group => group.handle === line.handle)?.groupRef
        : named.length === 1 ? named[0].groupRef : undefined;
      const summaries = ordered.filter(hint => hint.segment.groupRef === groupRef).slice(0, KNOWLEDGE_SUMMARY_POLICY.maxHintsPerGroup)
        .map(hint => ({ summary: hint.summary, sourceCount: hint.segment.sources.length, sourceHash: hint.segment.sourceHash }));
      if (summaries.length === 0) return line;
      changed = true;
      return { ...line, summaries };
    });
    const value = { ...entry.value, groups };
    return { ...entry, value, revisionOrHash: canonicalHash(value) };
  });
  if (!changed) return context;
  const { contextHash: _hash, ...binding } = context.binding;
  const built = buildRequiredContext({ intent: context.intent, entries, references: context.references, binding, maxUnits });
  // Hints are optional retrieval material. They never crowd out a required
  // body or convert an otherwise valid action into a context failure.
  return built.kind === "accepted" ? built.context : context;
}
