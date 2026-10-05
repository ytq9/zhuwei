import type { AuthoritativeWorldState, KnowledgeRecord } from "../../../rules/v2/model";
import { authorityKnowledgeText, fictionDayOf } from "../../../rules/authority-read";
import { compareCodeUnits } from "../canonical-json";
import type { DiscoveredCandidate } from "./candidate-discovery";
import { singleHanQueryWords, tokenize, VNEXT_RETRIEVAL_PROFILE, type RetrievalProfile } from "./extractors";
import type { ReferenceIndex } from "./reference-index";
import { RECENT_MEMORY_ROUNDS, acquiredInPlay, isRoundMemory, recentMemoryRounds } from "./npc-decision";

/**
 * Which held-knowledge bodies one action freezes for a holder.
 *
 * A holder's directory of knowledge (every ref and version) is always frozen
 * whole; this decides whose bodies travel. A character's knowledge grows with
 * every observation and conversation, and loading every body for every
 * present character on every action is what makes a room's request grow with
 * its age rather than with the action.
 *
 * Three kinds of body travel. Whatever a still-scheduled plan of the holder
 * cites as a premise. Everything the holder learned in its latest six rounds
 * of play: SPEC 0016 §4.2 allows limited recent dialogue, and the user fixed
 * the limit at six rounds per character (ADR 0048). And background, when the
 * action's words reach it: what the module gave the holder before play and
 * the world facts a story handed it, neither of which is a round it lived.
 * Older play memories stay directory lines, a gist and a handle the selection
 * can name. Rules counts rounds the same way (`recentMemoryRounds`), so an
 * NPC's decision view holds the claims and exchanges of exactly these rounds.
 * The caps are overflow protection only.
 *
 * The directory itself is bounded (SPEC 0016 §4.3, ADR 0111): past a few
 * dozen unread memories it lists those the action's words reach and the most
 * recent ones, and counts the rest in groups of where and when the holder
 * acquired them. A group's handle reads its newest bodies.
 */
export type KnowledgeRelevanceProfile = Readonly<{
  profileRef: string;
  maxLoadedRecords: number;
  maxLoadedCharacters: number;
  /** Code points of a memory's content shown in the holder's directory of
   * bodies this action did not read. */
  gistCharacters: number;
  /** How many of the holder's latest rounds of play travel in full; see
   * `isRoundMemory` for what a round is. */
  recentRounds: number;
  /** Unread memories the directory lists by the action's words, at most;
   * then at most `directoryRecentLines` more by recency. A holder with no more
   * unread memories than both together sees them all listed. */
  directoryRelevantLines: number;
  directoryRecentLines: number;
}>;

// vnext-2: bodies travel by the current topic. Neither authored background
// nor a fiction-time window nor a record count loads a body on its own; the
// words of the action (and the names they reached) do, and a scheduled plan's
// premises do because the plan cannot be judged without them. Who the holder
// is, what it wants and how it stands with the actor are records of its
// decision view, not memories, and always travel with it. Everything else
// stays on the server behind a short directory (see `knowledgeGist`).
// vnext-3: what the holder saw the acting character do within the last
// fiction hour travels regardless of the words.
// vnext-4: each holder's latest six rounds of play travel in full, the actor's
// included, and older play memories no longer load by word overlap: in a long
// conversation the words of any question share 知道 or 什么 with nearly every
// earlier line, so overlap loaded almost all of it. Background the module gave
// before play still loads by the words.
// vnext-5: rounds are counted by Rules' `recentMemoryRounds`, and a world fact
// a story handed the holder is background that loads by the words.
// vnext-7: the directory lists at most twenty unread memories by the words and
// twenty by recency; the rest are counted by scene and fiction day (ADR 0111).
export const VNEXT_KNOWLEDGE_RELEVANCE_PROFILE: KnowledgeRelevanceProfile = Object.freeze({
  profileRef: "zhuwei.knowledge-relevance/vnext-7",
  maxLoadedRecords: 40,
  maxLoadedCharacters: 64_000,
  gistCharacters: 24,
  recentRounds: RECENT_MEMORY_ROUNDS,
  directoryRelevantLines: 20,
  directoryRecentLines: 20,
});

/** vnext-2: a line is a gist and a handle; vnext-1 lines also repeated the
 * refs the recall references hold. vnext-3 may add group lines, a label, a
 * count and a handle each (ADR 0111). */
export const KNOWLEDGE_DIRECTORY_SCHEMA = "zhuwei.knowledge-directory/vnext-3" as const;
export const KNOWLEDGE_DIRECTORY_SCHEMAS: readonly string[] = Object.freeze(["zhuwei.knowledge-directory/vnext-1",
  "zhuwei.knowledge-directory/vnext-2", KNOWLEDGE_DIRECTORY_SCHEMA]);
export function knowledgeDirectoryEntryRef(holderRef: string): string {
  return `knowledge-directory:${holderRef}`;
}
/** The opening of a memory's content: enough to tell what it is about, not
 * enough to narrate from. Deterministic over the record alone. */
export function knowledgeGist(record: Readonly<{ content: unknown }> | undefined, profile: KnowledgeRelevanceProfile = VNEXT_KNOWLEDGE_RELEVANCE_PROFILE): string {
  if (record === undefined) return "";
  const text = (typeof record.content === "string" ? record.content : JSON.stringify(record.content) ?? "").normalize("NFC").replace(/\s+/gu, " ").trim();
  const points = [...text];
  return points.length <= profile.gistCharacters ? text : points.slice(0, profile.gistCharacters).join("") + "…";
}

/** SPEC 0016 §4.3 (ADR 0111): unread memories of one holder counted together
 * in its directory, by the scene and fiction day they were acquired in. */
export type KnowledgeDirectoryGroup = Readonly<{
  /** The same for this holder, scene and day in every action: what a stage's
   * request carries once the group is asked for. */
  groupRef: string;
  /** Null when the memories name no scene, or were known before play. */
  sceneRef: string | null;
  /** The fiction day of play, counting from 1; null for what the holder knew
   * before play began. */
  day: number | null;
  /** What the directory shows: the scene's name and the day. */
  label: string;
  /** Holder-local knowledge refs, newest first. */
  members: readonly string[];
}>;

export type KnowledgeSelection = Readonly<{
  holderRef: string;
  /** Knowledge refs (holder-local) whose bodies are sent by default, in order. */
  loaded: readonly string[];
  /** Knowledge refs left to the directory: frozen with the view, sent on request. */
  unloaded: readonly string[];
  /** The unloaded refs the directory lists line by line, in `unloaded` order. */
  listed: readonly string[];
  /** The other unloaded refs, a line per group. */
  groups: readonly KnowledgeDirectoryGroup[];
}>;

export type KnowledgeSelector = (holderRef: string) => KnowledgeSelection;

export function createKnowledgeSelector(input: Readonly<{
  state: AuthoritativeWorldState;
  index: ReferenceIndex;
  actorCharacterId: string;
  intentText: string;
  candidates: readonly DiscoveredCandidate[];
  focusRefs?: readonly string[];
  profile?: KnowledgeRelevanceProfile;
  retrieval?: RetrievalProfile;
}>): KnowledgeSelector {
  const { state } = input;
  const profile = input.profile ?? VNEXT_KNOWLEDGE_RELEVANCE_PROFILE;
  const retrieval = input.retrieval ?? VNEXT_RETRIEVAL_PROFILE;
  const addressed = new Set<string>([...input.candidates.map(({ ref }) => ref), ...(input.focusRefs ?? [])]);
  // Query terms: the player's words plus the names of what those words reached.
  const queryText = [input.intentText, ...[...addressed].flatMap((ref) => {
    const entity = state.entities[ref];
    if (entity !== undefined) return [entity.name];
    const definition = (state.campaignRuntime.itemSystem.definitions[ref]?.content as { label?: unknown } | undefined)?.label
      ?? (state.campaignRuntime.definitions[ref]?.content as { label?: unknown } | undefined)?.label;
    return typeof definition === "string" ? [definition] : [];
  })].join("\n");
  const queryTerms = new Set(tokenize(queryText, retrieval.tokenizer));
  const queryWords = singleHanQueryWords(queryText);
  const cache = new Map<string, KnowledgeSelection>();
  return (holderRef) => {
    const cached = cache.get(holderRef);
    if (cached !== undefined) return cached;
    const records = Object.values(state.knowledge[holderRef] ?? {});
    const premises = new Set<string>();
    for (const plan of Object.values(state.campaignRuntime.npcPlans ?? {}) as readonly Record<string, unknown>[]) {
      if (plan.npcId !== holderRef || plan.status !== "scheduled" || !Array.isArray(plan.premiseRefs)) continue;
      for (const ref of plan.premiseRefs) if (typeof ref === "string") premises.add(ref);
    }
    const recent = recentMemoryRounds(records, profile.recentRounds);
    const scored = records.map((record) => ({ record, tier: tier(record, premises, recent),
      score: isRoundMemory(record) ? 0 : overlap(record) }))
      .filter(({ tier, score }) => tier === 1 || score > 0)
      .sort((left, right) => left.tier - right.tier || right.score - left.score
        || compareMicros(right.record.acquiredAtFictionMicros, left.record.acquiredAtFictionMicros)
        || compareCodeUnits(left.record.knowledgeRef, right.record.knowledgeRef));
    const loaded: string[] = [];
    let characters = 0;
    for (const { record } of scored) {
      const size = JSON.stringify(record.content).length;
      // Past the caps the remaining bodies stay requestable by handle;
      // nothing is lost, the default view just stops growing. A single body
      // larger than the whole allowance is not overflow: it is read, so the
      // freeze reports it over budget instead of filing it in the directory
      // (SPEC 0016 §4.3).
      if (loaded.length >= profile.maxLoadedRecords
        || (characters + size > profile.maxLoadedCharacters && size <= profile.maxLoadedCharacters)) break;
      loaded.push(record.knowledgeRef);
      characters += size;
    }
    const chosen = new Set(loaded);
    const unloaded = records.map(({ knowledgeRef }) => knowledgeRef).filter((ref) => !chosen.has(ref)).sort(compareCodeUnits);
    const selection = Object.freeze({ holderRef, loaded: Object.freeze(loaded), unloaded: Object.freeze(unloaded),
      ...directory(holderRef, records, unloaded) });
    cache.set(holderRef, selection);
    return selection;
  };

  // SPEC 0016 §4.3 (ADR 0111): the directory lists the unread memories the
  // words reach, then the most recent; the rest are counted per group of
  // scene and fiction day, so a holder's directory stops growing with play.
  function directory(holderRef: string, records: readonly KnowledgeRecord[], unloaded: readonly string[]):
    Pick<KnowledgeSelection, "listed" | "groups"> {
    if (unloaded.length <= profile.directoryRelevantLines + profile.directoryRecentLines) {
      return { listed: Object.freeze([...unloaded]), groups: Object.freeze([]) };
    }
    const unread = new Set(unloaded);
    const newest = records.filter((record) => unread.has(record.knowledgeRef)).sort(newestFirst);
    const listed = new Set(newest.map((record) => ({ record, score: overlap(record) })).filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || newestFirst(left.record, right.record))
      .slice(0, profile.directoryRelevantLines).map(({ record }) => record.knowledgeRef));
    for (const record of newest.filter((record) => !listed.has(record.knowledgeRef)).slice(0, profile.directoryRecentLines)) {
      listed.add(record.knowledgeRef);
    }
    const scenes = memoryScenes(records);
    const groups = new Map<string, { group: Omit<KnowledgeDirectoryGroup, "members">; members: string[]; first: string }>();
    for (const record of newest) {
      if (listed.has(record.knowledgeRef)) continue;
      const day = acquiredInPlay(record) ? fictionDayOf(state, record.acquiredAtFictionMicros) ?? null : null;
      const sceneRef = day === null ? null : scenes.get(record.knowledgeRef) ?? null;
      const groupRef = `knowledge-group:${holderRef}:${day === null ? "before-play" : `day-${day}`}${sceneRef === null ? "" : `:${sceneRef}`}`;
      const existing = groups.get(groupRef);
      // Members arrive newest first, so the last one seen is the earliest.
      if (existing !== undefined) {
        existing.members.push(record.knowledgeRef);
        existing.first = record.acquiredAtFictionMicros;
        continue;
      }
      const name = sceneRef === null ? undefined : state.scenes[sceneRef]?.name;
      const place = sceneRef === null ? "" : `${typeof name === "string" && name.length > 0 ? name : sceneRef} `;
      groups.set(groupRef, { group: { groupRef, sceneRef, day, label: day === null ? "开局前" : `${place}第${day}天` },
        members: [record.knowledgeRef], first: record.acquiredAtFictionMicros });
    }
    return {
      listed: Object.freeze(unloaded.filter((ref) => listed.has(ref))),
      // What the holder knew before play first, then by day, then by when the
      // holder first came by a memory of the group that day.
      groups: Object.freeze([...groups.values()].sort((left, right) => (left.group.day ?? 0) - (right.group.day ?? 0)
        || compareMicros(left.first, right.first) || compareCodeUnits(left.group.groupRef, right.group.groupRef))
        .map(({ group, members }) => Object.freeze({ ...group, members: Object.freeze(members) }))),
    };
  }
  // Where a memory was acquired: the one scene that the fact it is of, or a
  // fact its provenance names, has among its subjects (a perception names its
  // scene). A memory naming none -- a line someone said -- takes the scene the
  // holder's other memories of the same fiction instant name, when they name
  // exactly one; otherwise it is grouped by its day alone.
  function memoryScenes(records: readonly KnowledgeRecord[]): ReadonlyMap<string, string> {
    const own = new Map<string, string>(), atInstant = new Map<string, Set<string>>();
    for (const record of records) {
      for (const ref of [record.knowledgeRef, ...record.provenanceChain]) {
        const fact = Object.hasOwn(state.canonicalFacts, ref) ? state.canonicalFacts[ref] : undefined;
        const named = fact?.subjectRefs.filter((subject) => Object.hasOwn(state.scenes, subject)) ?? [];
        if (named.length !== 1) continue;
        own.set(record.knowledgeRef, named[0]!);
        const scenes = atInstant.get(record.acquiredAtFictionMicros) ?? new Set<string>();
        scenes.add(named[0]!);
        atInstant.set(record.acquiredAtFictionMicros, scenes);
        break;
      }
    }
    const scenes = new Map(own);
    for (const record of records) {
      const shared = atInstant.get(record.acquiredAtFictionMicros);
      if (!own.has(record.knowledgeRef) && shared?.size === 1) scenes.set(record.knowledgeRef, [...shared][0]!);
    }
    return scenes;
  }

  // A scheduled plan's premises and the holder's latest rounds travel
  // regardless of the words; background travels when the words reach it;
  // older rounds wait behind their handles.
  function tier(record: KnowledgeRecord, premises: ReadonlySet<string>, recent: ReadonlySet<string>): 1 | 2 {
    return premises.has(record.knowledgeRef) || premises.has(`knowledge:${record.characterId}:${record.knowledgeRef}`)
      || isRoundMemory(record) && recent.has(record.acquiredAtFictionMicros) ? 1 : 2;
  }
  function overlap(record: KnowledgeRecord): number {
    const text = authorityKnowledgeText(state, record.characterId, record.knowledgeRef) ?? "";
    let hits = 0;
    for (const term of tokenize(text, retrieval.tokenizer)) if (queryTerms.has(term)) hits += 1;
    // A standalone word in the intent (「桥」, 「钥」) reaches a memory that
    // spells it inside a longer run; the stop set already removed the words
    // that would reach everything.
    for (const word of queryWords) if (text.includes(word)) hits += 1;
    return hits;
  }
}

/** Whom an unnamed "you" goes to: among `present`, the NPC the actor last
 * heard speak or watched within its latest rounds of play. Same moment:
 * the later event. */
export function recentInterlocutor(state: AuthoritativeWorldState, actorCharacterId: string, present: ReadonlySet<string>,
  profile: KnowledgeRelevanceProfile = VNEXT_KNOWLEDGE_RELEVANCE_PROFILE): string | undefined {
  const records = Object.values(state.knowledge[actorCharacterId] ?? {});
  const recent = recentMemoryRounds(records, profile.recentRounds);
  let latest: { npcRef: string; micros: string; seq: bigint } | undefined;
  for (const record of records) {
    if (!isRoundMemory(record) || !recent.has(record.acquiredAtFictionMicros)) continue;
    const perceived = state.canonicalFacts[record.knowledgeRef]?.value as { subjectRef?: unknown } | undefined;
    const npcRef = record.objectKind === "sourceClaim" ? record.sourceCharacterId
      : record.objectKind === "sensoryEvidence" && typeof perceived?.subjectRef === "string" ? perceived.subjectRef : null;
    if (npcRef === null || npcRef === actorCharacterId || !present.has(npcRef)) continue;
    const seq = /:([0-9]+)$/u.exec(record.acquiredByEventId)?.[1];
    const candidate = { npcRef, micros: record.acquiredAtFictionMicros, seq: seq === undefined ? 0n : BigInt(seq) };
    if (latest === undefined || compareMicros(candidate.micros, latest.micros) > 0
      || compareMicros(candidate.micros, latest.micros) === 0 && candidate.seq > latest.seq) latest = candidate;
  }
  return latest?.npcRef;
}

const MICROS = /^(0|[1-9][0-9]*)$/u;

function compareMicros(left: string, right: string): number {
  const a = MICROS.test(left) ? BigInt(left) : 0n, b = MICROS.test(right) ? BigInt(right) : 0n;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The later fiction instant first; at one instant the later event; then by ref. */
function newestFirst(left: KnowledgeRecord, right: KnowledgeRecord): number {
  const seq = (record: KnowledgeRecord) => BigInt(/^event:.*:([0-9]+)$/u.exec(record.acquiredByEventId)?.[1] ?? "0");
  const a = seq(left), b = seq(right);
  return compareMicros(right.acquiredAtFictionMicros, left.acquiredAtFictionMicros) || (a < b ? 1 : a > b ? -1 : 0)
    || compareCodeUnits(left.knowledgeRef, right.knowledgeRef);
}
