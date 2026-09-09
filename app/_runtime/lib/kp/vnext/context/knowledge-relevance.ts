import type { AuthoritativeWorldState, KnowledgeRecord } from "../../../rules/v2/model";
import { characterTimelineId } from "../../../rules/v2/timeline";
import { compareCodeUnits } from "../canonical-json";
import type { DiscoveredCandidate } from "./candidate-discovery";
import { singleHanQueryWords, tokenize, VNEXT_RETRIEVAL_PROFILE, type RetrievalProfile } from "./extractors";
import type { ReferenceIndex } from "./reference-index";

/**
 * Which held-knowledge bodies one action freezes for a holder.
 *
 * A holder's directory of knowledge (every ref and version) is always frozen
 * whole; this decides whose bodies travel. A character's knowledge grows with
 * every observation and conversation, and loading every body for every
 * present character on every action is what makes a room's request grow with
 * its age rather than with the action. SPEC 0016 §4.2 asks for the relevant
 * knowledge of the people involved; a recency window alone is not allowed to
 * decide, so recency is one signal among structural and lexical ones.
 *
 * Tier one is always loaded: module-authored background, whatever came from
 * or concerns the actor, whatever a still-scheduled plan of the holder cites
 * as a premise, and whatever the holder learned within the recent window of
 * fiction time. Tier two loads by lexical overlap between the record and the
 * player's words or the discovered candidates. Everything else stays a
 * directory line the KP cannot cite. The caps are overflow protection only.
 */
export type KnowledgeRelevanceProfile = Readonly<{
  profileRef: string;
  recentFictionMicros: bigint;
  maxLoadedRecords: number;
  maxLoadedCharacters: number;
}>;

export const VNEXT_KNOWLEDGE_RELEVANCE_PROFILE: KnowledgeRelevanceProfile = Object.freeze({
  profileRef: "zhuwei.knowledge-relevance/vnext-1",
  recentFictionMicros: 24n * 60n * 60n * 1_000_000n,
  maxLoadedRecords: 40,
  maxLoadedCharacters: 64_000,
});

export type KnowledgeSelection = Readonly<{
  kind: "selected";
  holderRef: string;
  /** Knowledge refs (holder-local) whose bodies are frozen, in load order. */
  loaded: readonly string[];
  /** Knowledge refs left as directory lines. */
  unloaded: readonly string[];
}> | Readonly<{ kind: "budgetExceeded"; holderRef: string }>;

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
    const timelineId = characterTimelineId(state, holderRef);
    const now = timelineId === undefined ? undefined : BigInt(state.fictionTimelines[timelineId]?.nowMicros ?? "0");
    const premises = new Set<string>();
    for (const plan of Object.values(state.campaignRuntime.npcPlans ?? {}) as readonly Record<string, unknown>[]) {
      if (plan.npcId !== holderRef || plan.status !== "scheduled" || !Array.isArray(plan.premiseRefs)) continue;
      for (const ref of plan.premiseRefs) if (typeof ref === "string") premises.add(ref);
    }
    const scored = records.map((record) => ({ record, tier: tier(record, premises, now), score: overlap(record) }))
      .filter(({ tier, score }) => tier === 1 || score > 0)
      .sort((left, right) => left.tier - right.tier || right.score - left.score
        || compareMicros(right.record.acquiredAtFictionMicros, left.record.acquiredAtFictionMicros)
        || compareCodeUnits(left.record.knowledgeRef, right.record.knowledgeRef));
    const loaded: string[] = [];
    let characters = 0;
    for (const { record } of scored) {
      const size = JSON.stringify(record.content).length;
      if (loaded.length >= profile.maxLoadedRecords || characters + size > profile.maxLoadedCharacters) {
        const exceeded = Object.freeze({ kind: "budgetExceeded" as const, holderRef });
        cache.set(holderRef, exceeded);
        return exceeded;
      }
      loaded.push(record.knowledgeRef);
      characters += size;
    }
    const chosen = new Set(loaded);
    const selection = Object.freeze({ kind: "selected" as const, holderRef, loaded: Object.freeze(loaded),
      unloaded: Object.freeze(records.map(({ knowledgeRef }) => knowledgeRef).filter((ref) => !chosen.has(ref)).sort(compareCodeUnits)) });
    cache.set(holderRef, selection);
    return selection;
  };

  function tier(record: KnowledgeRecord, premises: ReadonlySet<string>, now: bigint | undefined): 1 | 2 {
    if (record.acquiredByEventId.startsWith("genesis:")
      || record.provenanceChain.some((step) => step.startsWith("module:") || step.startsWith("definition-catalog:") || step.startsWith("genesis:"))) return 1;
    if (record.sourceCharacterId === input.actorCharacterId || record.characterId === input.actorCharacterId && addressed.has(record.sourceCharacterId ?? "")) return 1;
    if (premises.has(record.knowledgeRef) || premises.has(`knowledge:${record.characterId}:${record.knowledgeRef}`)) return 1;
    if (now !== undefined && /^(0|[1-9][0-9]*)$/u.test(record.acquiredAtFictionMicros)
      && now - BigInt(record.acquiredAtFictionMicros) <= profile.recentFictionMicros) return 1;
    return 2;
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

function compareMicros(left: string, right: string): number {
  const a = /^(0|[1-9][0-9]*)$/u.test(left) ? BigInt(left) : 0n, b = /^(0|[1-9][0-9]*)$/u.test(right) ? BigInt(right) : 0n;
  return a < b ? -1 : a > b ? 1 : 0;
}
