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
  const words = normalized.match(/[\p{Letter}\p{Number}][\p{Letter}\p{Number}._-]*/gu) ?? [];
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
  limit: number;
}>;

export function createStaticRetrievalRequest(input: Readonly<{
  structuralRefs?: readonly string[];
  exactAliases?: readonly string[];
  queryText?: string;
  plannerQueryTerms?: readonly string[];
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
    limit,
  });
}

export type StaticRetrievalHit = StaticIndexEntry & Readonly<{
  relevance: number;
  routes: readonly ("structural" | "alias" | "fts")[];
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
    routes: Set<"structural" | "alias" | "fts">;
  }>();
  const add = (sourceRef: string, route: "structural" | "alias" | "fts", ftsScore = 0): void => {
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

  return Object.freeze([...accumulated.entries()]
    .map(([sourceRef, value]) => Object.freeze({
      ...index.entries[sourceRef]!,
      relevance: value.routePriority * 1_000_000
        + (Number.isFinite(value.ftsScore) ? Math.max(-999_999, Math.min(999_999, value.ftsScore)) : 0),
      routes: Object.freeze([...value.routes].sort()),
    }))
    .sort((left, right) => right.relevance - left.relevance || left.sourceRef.localeCompare(right.sourceRef))
    .slice(0, request.limit));
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
  const allowedProfiles = new Set(policy.allowedProfileRefs);
  return Object.freeze(hits.map((hit) => {
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
  }));
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
