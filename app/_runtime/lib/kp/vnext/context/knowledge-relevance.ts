import type { AuthoritativeWorldState, KnowledgeRecord } from "../../../rules/v2/model";
import { compareCodeUnits } from "../canonical-json";
import type { DiscoveredCandidate } from "./candidate-discovery";
import { singleHanQueryWords, tokenize, VNEXT_RETRIEVAL_PROFILE, type RetrievalProfile } from "./extractors";
import type { ReferenceIndex } from "./reference-index";
import { RECENT_MEMORY_ROUNDS, isRoundMemory, recentMemoryRounds } from "./npc-decision";

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
export const VNEXT_KNOWLEDGE_RELEVANCE_PROFILE: KnowledgeRelevanceProfile = Object.freeze({
  profileRef: "zhuwei.knowledge-relevance/vnext-5",
  maxLoadedRecords: 40,
  maxLoadedCharacters: 64_000,
  gistCharacters: 24,
  recentRounds: RECENT_MEMORY_ROUNDS,
});

/** vnext-2: a line is a gist and a handle; vnext-1 lines also repeated the
 * refs the recall references hold. */
export const KNOWLEDGE_DIRECTORY_SCHEMA = "zhuwei.knowledge-directory/vnext-2" as const;
export const KNOWLEDGE_DIRECTORY_SCHEMAS: readonly string[] = Object.freeze(["zhuwei.knowledge-directory/vnext-1", KNOWLEDGE_DIRECTORY_SCHEMA]);
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

export type KnowledgeSelection = Readonly<{
  holderRef: string;
  /** Knowledge refs (holder-local) whose bodies are sent by default, in order. */
  loaded: readonly string[];
  /** Knowledge refs left to the directory: frozen with the view, sent on request. */
  unloaded: readonly string[];
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
    const selection = Object.freeze({ holderRef, loaded: Object.freeze(loaded),
      unloaded: Object.freeze(records.map(({ knowledgeRef }) => knowledgeRef).filter((ref) => !chosen.has(ref)).sort(compareCodeUnits)) });
    cache.set(holderRef, selection);
    return selection;
  };

  // A scheduled plan's premises and the holder's latest rounds travel
  // regardless of the words; background travels when the words reach it;
  // older rounds wait behind their handles.
  function tier(record: KnowledgeRecord, premises: ReadonlySet<string>, recent: ReadonlySet<string>): 1 | 2 {
    return premises.has(record.knowledgeRef) || premises.has(`knowledge:${record.characterId}:${record.knowledgeRef}`)
      || isRoundMemory(record) && recent.has(record.acquiredAtFictionMicros) ? 1 : 2;
  }
  function overlap(record: KnowledgeRecord): number {
    const text = typeof record.content === "string" ? record.content : JSON.stringify(record.content);
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
