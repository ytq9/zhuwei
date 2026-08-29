import { stableStructuralHash } from "./causal-action-program";
import type {
  ContextSensitivity,
  RetrievedContextChunk,
  SourceSpan,
  StaticContextPurpose,
} from "./context-pack";

export type StaticSourceChunk = Readonly<{
  sourceKind: "static";
  sourceRef: string;
  sourceHash: string;
  sourceSpan: SourceSpan;
  profileRef: string;
  sensitivity: ContextSensitivity;
  dependencyRefs: readonly string[];
  purpose: StaticContextPurpose;
  body: string;
  aliases: readonly string[];
  structuralRefs: readonly string[];
}>;

export type IndexableSourceChunk = StaticSourceChunk | Readonly<{
  sourceKind: "dynamic-room";
  sourceRef: string;
  [key: string]: unknown;
}>;

export type StaticIndexEntry = Readonly<{
  sourceRef: string;
  sourceHash: string;
  sourceSpan: SourceSpan;
  profileRef: string;
  sensitivity: ContextSensitivity;
  dependencyRefs: readonly string[];
  purpose: StaticContextPurpose;
  aliases: readonly string[];
  structuralRefs: readonly string[];
  searchTerms: readonly string[];
}>;

export type StaticRetrievalIndex = Readonly<{
  indexVersion: "kp-static-retrieval-index-v1";
  indexHash: string;
  entries: Readonly<Record<string, StaticIndexEntry>>;
  aliasRefs: Readonly<Record<string, readonly string[]>>;
  structuralRefs: Readonly<Record<string, readonly string[]>>;
}>;

/** Builds a disposable search index; room state is rejected at this boundary. */
export function buildStaticRetrievalIndex(chunks: readonly IndexableSourceChunk[]): StaticRetrievalIndex {
  const entries: Record<string, StaticIndexEntry> = {};
  const aliasRefs: Record<string, string[]> = {};
  const structuralRefs: Record<string, string[]> = {};
  for (const rawChunk of chunks) {
    if (rawChunk.sourceKind !== "static") throw new Error("RAG_DYNAMIC_SOURCE_FORBIDDEN");
    validateStaticChunk(rawChunk);
    if (entries[rawChunk.sourceRef] !== undefined) throw new Error("RAG_SOURCE_REF_DUPLICATE");
    const aliases = uniqueSorted(rawChunk.aliases.map(normalizeExactAlias).filter(Boolean));
    const structure = uniqueSorted(rawChunk.structuralRefs.map(normalizeRef));
    const searchTerms = staticSearchTerms(rawChunk.body, aliases);
    entries[rawChunk.sourceRef] = Object.freeze({
      sourceRef: rawChunk.sourceRef,
      sourceHash: rawChunk.sourceHash,
      sourceSpan: Object.freeze({ ...rawChunk.sourceSpan }),
      profileRef: rawChunk.profileRef,
      sensitivity: rawChunk.sensitivity,
      dependencyRefs: Object.freeze(uniqueSorted(rawChunk.dependencyRefs.map(normalizeRef))),
      purpose: rawChunk.purpose,
      aliases: Object.freeze(aliases),
      structuralRefs: Object.freeze(structure),
      searchTerms: Object.freeze(searchTerms),
    });
    for (const alias of aliases) pushLookup(aliasRefs, alias, rawChunk.sourceRef);
    for (const ref of structure) pushLookup(structuralRefs, ref, rawChunk.sourceRef);
    pushLookup(structuralRefs, normalizeRef(rawChunk.sourceRef), rawChunk.sourceRef);
  }

  const frozenEntries = freezeLookupValues(entries);
  const frozenAliases = freezeStringLookup(aliasRefs);
  const frozenStructuralRefs = freezeStringLookup(structuralRefs);
  const indexSource = {
    indexVersion: "kp-static-retrieval-index-v1" as const,
    entries: frozenEntries,
    aliasRefs: frozenAliases,
    structuralRefs: frozenStructuralRefs,
  };
  return Object.freeze({ ...indexSource, indexHash: stableStructuralHash(indexSource) });
}

export function chineseBigrams(text: string): readonly string[] {
  const result = new Set<string>();
  for (const match of text.normalize("NFKC").matchAll(/[\p{Script=Han}]+/gu)) {
    const characters = [...match[0]];
    if (characters.length === 1) result.add(characters[0]!);
    for (let index = 0; index + 1 < characters.length; index += 1) {
      result.add(`${characters[index]}${characters[index + 1]}`);
    }
  }
  return Object.freeze([...result].sort());
}

export function staticSearchTerms(text: string, aliases: readonly string[] = []): readonly string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  // Han runs must not be copied wholesale into a derived FTS row. Chinese is
  // indexed by the declared bigram tokenizer below; Latin/numeric rule terms
  // keep their exact token form.
  const words = (normalized.match(/[\p{Letter}\p{Number}][\p{Letter}\p{Number}._-]*/gu) ?? [])
    .filter((word) => !/\p{Script=Han}/u.test(word));
  return Object.freeze(uniqueSorted([
    ...aliases.map(normalizeExactAlias),
    ...words,
    ...chineseBigrams(normalized),
    ...aliases.flatMap((alias) => chineseBigrams(alias)),
  ].filter(Boolean)));
}

export type StaticFtsQuery = Readonly<{
  terms: readonly string[];
  limit: number;
}>;

export type StaticFtsHit = Readonly<{
  sourceRef: string;
  score: number;
}>;

/** D1 implementations live at the platform seam; this core owns only the contract. */
export interface D1FtsAdapter {
  readonly mode: "d1-fts" | "deterministic";
  search(query: StaticFtsQuery): readonly StaticFtsHit[];
}

export type StaticRetrievalRequest = Readonly<{
  structuralRefs: readonly string[];
  exactAliases: readonly string[];
  queryTerms: readonly string[];
  publicD1QueryTerms: readonly string[];
  limit: number;
}>;

export function createStaticRetrievalRequest(input: Readonly<{
  structuralRefs?: readonly string[];
  exactAliases?: readonly string[];
  queryText?: string;
  plannerQueryTerms?: readonly string[];
  /** Terms derived exclusively from public static corpus metadata. Player/KP
   * text and Planner output must never be supplied through this field. */
  publicD1QueryTerms?: readonly string[];
  limit?: number;
}>): StaticRetrievalRequest {
  const limit = input.limit ?? 8;
  if (!Number.isInteger(limit) || limit < 1 || limit > 32) throw new Error("RAG_RESULT_LIMIT_INVALID");
  return Object.freeze({
    structuralRefs: Object.freeze(uniqueSorted((input.structuralRefs ?? []).map(normalizeRef))),
    exactAliases: Object.freeze(uniqueSorted((input.exactAliases ?? []).map(normalizeExactAlias).filter(Boolean))),
    queryTerms: Object.freeze(uniqueSorted([
      ...staticSearchTerms(input.queryText ?? ""),
      ...(input.plannerQueryTerms ?? []).flatMap((term) => staticSearchTerms(term)),
    ])),
    publicD1QueryTerms: Object.freeze(uniqueSorted(
      (input.publicD1QueryTerms ?? []).map((term) => term.normalize("NFKC").trim().toLowerCase()).filter(Boolean),
    )),
    limit,
  });
}

/** Builds a D1-safe query only from public, server-owned index metadata bound
 * to authoritative structural references. It never consumes free text. */
export function publicD1QueryTermsForStructuralRefs(
  index: StaticRetrievalIndex,
  structuralRefs: readonly string[],
  limit = 24,
): readonly string[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 64) throw new Error("RAG_D1_TERM_LIMIT_INVALID");
  const sourceRefs = new Set<string>();
  for (const ref of uniqueSorted(structuralRefs.map(normalizeRef))) {
    for (const sourceRef of index.structuralRefs[ref] ?? []) sourceRefs.add(sourceRef);
  }
  return Object.freeze(uniqueSorted([...sourceRefs]
    .flatMap((sourceRef) => {
      const entry = index.entries[sourceRef];
      return entry?.sensitivity === "public" ? [...entry.searchTerms] : [];
    }))
    .slice(0, limit));
}

export type StaticRetrievalHit = StaticIndexEntry & Readonly<{
  relevance: number;
  routes: readonly ("structural" | "alias" | "fts" | "dependency")[];
}>;

const MAX_STATIC_DEPENDENCY_REFS = 16;
const MAX_STATIC_DEPENDENCY_DEPTH = 8;
const MAX_STATIC_DEPENDENCY_GROUP_CHUNKS = 64;
const MAX_STATIC_RETRIEVAL_ROOTS = 128;

type DirectRetrievalRoute = "structural" | "alias" | "fts";
type DirectRetrievalRank = Readonly<{
  sourceRef: string;
  relevance: number;
  routes: readonly DirectRetrievalRoute[];
}>;

/** Exact structure and aliases precede FTS; merging is stable and ref-only. */
export function retrieveStaticReferences(
  index: StaticRetrievalIndex,
  request: StaticRetrievalRequest,
  fts: D1FtsAdapter,
): readonly StaticRetrievalHit[] {
  const accumulated = new Map<string, {
    routePriority: number;
    ftsScore: number;
    routes: Set<DirectRetrievalRoute>;
  }>();
  const add = (sourceRef: string, route: DirectRetrievalRoute, ftsScore = 0): void => {
    if (index.entries[sourceRef] === undefined) return;
    const priority = route === "structural" ? 3 : route === "alias" ? 2 : 1;
    const current = accumulated.get(sourceRef) ?? {
      routePriority: 0,
      ftsScore: Number.NEGATIVE_INFINITY,
      routes: new Set(),
    };
    current.routePriority = Math.max(current.routePriority, priority);
    if (route === "fts") current.ftsScore = Math.max(current.ftsScore, ftsScore);
    current.routes.add(route);
    accumulated.set(sourceRef, current);
  };

  for (const ref of request.structuralRefs) {
    for (const sourceRef of index.structuralRefs[ref] ?? []) add(sourceRef, "structural");
  }
  for (const alias of request.exactAliases) {
    for (const sourceRef of index.aliasRefs[alias] ?? []) add(sourceRef, "alias");
  }
  if (request.queryTerms.length > 0) {
    const ftsHits = fts.search(Object.freeze({ terms: request.queryTerms, limit: request.limit }));
    for (const hit of ftsHits) {
      if (!Number.isFinite(hit.score)) throw new Error("RAG_FTS_SCORE_INVALID");
      add(hit.sourceRef, "fts", hit.score);
    }
  }

  const rankedRoots: readonly DirectRetrievalRank[] = Object.freeze([...accumulated.entries()]
    .map(([sourceRef, value]) => Object.freeze({
      sourceRef,
      relevance: value.routePriority * 1_000_000
        + (Number.isFinite(value.ftsScore) ? Math.max(-999_999, Math.min(999_999, value.ftsScore)) : 0),
      routes: Object.freeze([...value.routes].sort()) as readonly DirectRetrievalRoute[],
    }))
    .sort((left, right) => right.relevance - left.relevance || left.sourceRef.localeCompare(right.sourceRef)));
  if (rankedRoots.length > MAX_STATIC_RETRIEVAL_ROOTS) {
    throw new Error("RAG_DEPENDENCY_ROOT_LIMIT_EXCEEDED");
  }

  // A retrieval limit applies only after every candidate root has acquired its
  // complete bounded dependency closure. Groups which do not fit are omitted
  // whole; a dependency is never truncated away from a retained root.
  const chunksBySource = staticChunksByParentSource(index);
  const selected = new Set<string>();
  const relevanceByRef = new Map<string, number>();
  const routesByRef = new Map<string, Set<StaticRetrievalHit["routes"][number]>>();
  const directByRef = new Map(rankedRoots.map((root) => [root.sourceRef, root]));
  for (const root of rankedRoots) {
    const group = dependencyClosure(index, chunksBySource, root.sourceRef);
    const additions = group.filter((sourceRef) => !selected.has(sourceRef));
    if (selected.size + additions.length > request.limit) continue;
    for (const sourceRef of group) {
      selected.add(sourceRef);
      relevanceByRef.set(sourceRef, Math.max(relevanceByRef.get(sourceRef) ?? Number.NEGATIVE_INFINITY, root.relevance));
      const routes = routesByRef.get(sourceRef) ?? new Set();
      const direct = directByRef.get(sourceRef);
      for (const route of direct?.routes ?? []) routes.add(route);
      if (sourceRef !== root.sourceRef) routes.add("dependency");
      routesByRef.set(sourceRef, routes);
    }
  }

  return Object.freeze([...selected]
    .map((sourceRef) => Object.freeze({
      ...index.entries[sourceRef]!,
      relevance: relevanceByRef.get(sourceRef)!,
      routes: Object.freeze([...routesByRef.get(sourceRef)!].sort()),
    }))
    .sort((left, right) => right.relevance - left.relevance || left.sourceRef.localeCompare(right.sourceRef)));
}

/** Pure in-memory adapter for deterministic tests and disabled-platform fallback. */
export function createDeterministicFtsAdapter(index: StaticRetrievalIndex): D1FtsAdapter {
  return Object.freeze({
    mode: "deterministic" as const,
    search(query: StaticFtsQuery): readonly StaticFtsHit[] {
      const requestedTerms = new Set(query.terms);
      return Object.freeze(Object.values(index.entries)
        .map((entry) => {
          const overlap = entry.searchTerms.reduce((count, term) => count + (requestedTerms.has(term) ? 1 : 0), 0);
          return Object.freeze({ sourceRef: entry.sourceRef, score: overlap });
        })
        .filter((hit) => hit.score > 0)
        .sort((left, right) => right.score - left.score || left.sourceRef.localeCompare(right.sourceRef))
        .slice(0, query.limit));
    },
  });
}

export type AuthoritativeStaticReader = (sourceRef: string) => StaticSourceChunk | undefined;

export type RehydratePolicy = Readonly<{
  allowedProfileRefs: readonly string[];
  allowKpOnly: boolean;
}>;

/**
 * A hit never carries authoritative prose. Every hit is re-read and all
 * security/version coordinates are checked before its body enters context.
 */
export function rehydrateStaticContext(
  hits: readonly StaticRetrievalHit[],
  readAuthoritative: AuthoritativeStaticReader,
  policy: RehydratePolicy,
): readonly RetrievedContextChunk[] {
  if (hits.length > MAX_STATIC_DEPENDENCY_GROUP_CHUNKS) {
    throw new Error("RAG_DEPENDENCY_GROUP_LIMIT_EXCEEDED");
  }
  if (new Set(hits.map((hit) => hit.sourceRef)).size !== hits.length) {
    throw new Error("RAG_SOURCE_REF_DUPLICATE");
  }
  const allowedProfiles = new Set(policy.allowedProfileRefs);
  const hydrated = hits.map((hit) => {
    const authoritative = readAuthoritative(hit.sourceRef);
    if (authoritative === undefined || authoritative.sourceKind !== "static") {
      throw new Error("RAG_AUTHORITATIVE_SOURCE_MISSING");
    }
    if (authoritative.sourceRef !== hit.sourceRef) throw new Error("RAG_SOURCE_REF_MISMATCH");
    if (authoritative.sourceHash !== hit.sourceHash) throw new Error("RAG_SOURCE_HASH_MISMATCH");
    if (authoritative.profileRef !== hit.profileRef || !allowedProfiles.has(authoritative.profileRef)) {
      throw new Error("RAG_PROFILE_MISMATCH");
    }
    if (!sameSpan(authoritative.sourceSpan, hit.sourceSpan)) throw new Error("RAG_SOURCE_SPAN_MISMATCH");
    if (authoritative.sensitivity !== hit.sensitivity) throw new Error("RAG_SENSITIVITY_MISMATCH");
    if (authoritative.sensitivity === "kp-only" && !policy.allowKpOnly) throw new Error("RAG_SENSITIVITY_FORBIDDEN");
    if (authoritative.purpose !== hit.purpose) throw new Error("RAG_PURPOSE_MISMATCH");
    if (!sameStrings(authoritative.dependencyRefs, hit.dependencyRefs)) {
      throw new Error("RAG_DEPENDENCY_MISMATCH");
    }
    if (authoritative.dependencyRefs.length > MAX_STATIC_DEPENDENCY_REFS) {
      throw new Error("RAG_DEPENDENCY_REF_LIMIT_EXCEEDED");
    }
    return Object.freeze({
      sourceRef: authoritative.sourceRef,
      sourceHash: authoritative.sourceHash,
      sourceSpan: Object.freeze({ ...authoritative.sourceSpan }),
      profileRef: authoritative.profileRef,
      sensitivity: authoritative.sensitivity,
      dependencyRefs: Object.freeze([...authoritative.dependencyRefs]),
      purpose: authoritative.purpose,
      body: authoritative.body,
      relevance: hit.relevance,
    });
  });

  // Dependencies are authority coordinates, not advisory labels. A reference
  // must resolve either to an exact room-pinned profile binding or to every
  // retained chunk of an authoritative static source. Since each resolved
  // chunk was independently checked above, this also gates profile, hash,
  // span, sensitivity, and KP-only access for the whole dependency group.
  const hydratedByRef = new Map(hydrated.map((chunk) => [chunk.sourceRef, chunk]));
  const hydratedBySource = staticChunksByParentSource(hydrated);
  for (const chunk of hydrated) {
    for (const dependencyRef of chunk.dependencyRefs) {
      const dependencyChunks = hydratedByRef.has(dependencyRef)
        ? [dependencyRef]
        : hydratedBySource.get(dependencyRef) ?? [];
      if (dependencyChunks.length > 0) continue;
      if (allowedProfiles.has(dependencyRef)) continue;
      throw new Error("RAG_DEPENDENCY_UNRESOLVED");
    }
  }
  return Object.freeze(hydrated);
}

function dependencyClosure(
  index: StaticRetrievalIndex,
  chunksBySource: ReadonlyMap<string, readonly string[]>,
  rootSourceRef: string,
): readonly string[] {
  const visited = new Set<string>();
  const pending: Array<{ sourceRef: string; depth: number }> = [{ sourceRef: rootSourceRef, depth: 1 }];
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (visited.has(current.sourceRef)) continue;
    if (current.depth > MAX_STATIC_DEPENDENCY_DEPTH) {
      throw new Error("RAG_DEPENDENCY_DEPTH_EXCEEDED");
    }
    const entry = index.entries[current.sourceRef];
    if (entry === undefined) throw new Error("RAG_DEPENDENCY_CHUNK_MISSING");
    if (entry.dependencyRefs.length > MAX_STATIC_DEPENDENCY_REFS) {
      throw new Error("RAG_DEPENDENCY_REF_LIMIT_EXCEEDED");
    }
    visited.add(current.sourceRef);
    if (visited.size > MAX_STATIC_DEPENDENCY_GROUP_CHUNKS) {
      throw new Error("RAG_DEPENDENCY_GROUP_LIMIT_EXCEEDED");
    }
    for (const dependencyRef of entry.dependencyRefs) {
      const dependencyChunks = index.entries[dependencyRef] === undefined
        ? chunksBySource.get(dependencyRef) ?? []
        : [dependencyRef];
      for (const sourceRef of dependencyChunks) {
        if (!visited.has(sourceRef)) pending.push({ sourceRef, depth: current.depth + 1 });
      }
    }
  }
  return Object.freeze([...visited].sort());
}

function staticChunksByParentSource<T extends Readonly<{ sourceRef: string }>>(
  source: StaticRetrievalIndex | readonly T[],
): ReadonlyMap<string, readonly string[]> {
  const sourceRefs = Array.isArray(source)
    ? source.map((entry) => entry.sourceRef)
    : Object.keys((source as StaticRetrievalIndex).entries);
  const mutable = new Map<string, string[]>();
  for (const sourceRef of sourceRefs) {
    const parentRef = parentStaticSourceRef(sourceRef);
    const refs = mutable.get(parentRef) ?? [];
    refs.push(sourceRef);
    mutable.set(parentRef, refs);
  }
  return new Map([...mutable.entries()].map(([parentRef, refs]) => [
    parentRef,
    Object.freeze([...refs].sort()),
  ]));
}

function parentStaticSourceRef(sourceRef: string): string {
  const marker = sourceRef.lastIndexOf("#span:");
  return marker < 0 ? sourceRef : sourceRef.slice(0, marker);
}

function validateStaticChunk(chunk: StaticSourceChunk): void {
  for (const [path, value] of [
    ["sourceRef", chunk.sourceRef],
    ["sourceHash", chunk.sourceHash],
    ["profileRef", chunk.profileRef],
    ["body", chunk.body],
  ] as const) {
    if (value.trim().length === 0) throw new Error(`RAG_${path.toUpperCase()}_INVALID`);
  }
  if (!Number.isInteger(chunk.sourceSpan.start) || !Number.isInteger(chunk.sourceSpan.end)
    || chunk.sourceSpan.start < 0 || chunk.sourceSpan.end <= chunk.sourceSpan.start) {
    throw new Error("RAG_SOURCE_SPAN_INVALID");
  }
  if (chunk.sensitivity !== "public" && chunk.sensitivity !== "kp-only") {
    throw new Error("RAG_SENSITIVITY_INVALID");
  }
}

function pushLookup(lookup: Record<string, string[]>, key: string, sourceRef: string): void {
  const refs = lookup[key] ?? [];
  if (!refs.includes(sourceRef)) refs.push(sourceRef);
  lookup[key] = refs;
}

function freezeStringLookup(lookup: Record<string, string[]>): Readonly<Record<string, readonly string[]>> {
  const result: Record<string, readonly string[]> = {};
  for (const key of Object.keys(lookup).sort()) result[key] = Object.freeze([...lookup[key]!].sort());
  return Object.freeze(result);
}

function freezeLookupValues<T>(lookup: Record<string, T>): Readonly<Record<string, T>> {
  const result: Record<string, T> = {};
  for (const key of Object.keys(lookup).sort()) result[key] = lookup[key]!;
  return Object.freeze(result);
}

function normalizeRef(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length === 0) throw new Error("RAG_REF_INVALID");
  return normalized;
}

function normalizeExactAlias(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sameSpan(left: SourceSpan, right: SourceSpan): boolean {
  return left.start === right.start && left.end === right.end;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = uniqueSorted(left.map(normalizeRef));
  const normalizedRight = uniqueSorted(right.map(normalizeRef));
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}
