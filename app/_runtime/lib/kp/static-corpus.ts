import { stableStructuralHash } from "./causal-action-program";
import {
  buildStaticRetrievalIndex,
  chineseBigrams,
  retrieveStaticReferences,
  staticSearchTerms,
  type D1FtsAdapter,
  type StaticFtsHit,
  type StaticFtsQuery,
  type StaticRetrievalHit,
  type StaticRetrievalIndex,
  type StaticRetrievalRequest,
  type StaticSourceChunk,
} from "./static-retrieval";
import type {
  ContextSensitivity,
  StaticContextPurpose,
} from "./context-pack";

export const STATIC_CORPUS_SOURCE_TYPES = Object.freeze([
  "srd",
  "module",
  "story-bible",
  "ability",
  "enemy",
  "environment",
] as const);

export type StaticCorpusSourceType = (typeof STATIC_CORPUS_SOURCE_TYPES)[number];

const STATIC_CORPUS_PROFILE_SOURCE = Object.freeze({
  profileRef: "kp-static-corpus-compiler-v1",
  compilerVersion: "kp-static-corpus-compiler-v1.1.0",
  indexSchemaVersion: "kp-static-corpus-d1-fts-v2",
  tokenizerVersion: "unicode61-public-zh-bigram-v2",
  spanPolicyVersion: "authoritative-explicit-span-v1",
  allowedSourceTypes: STATIC_CORPUS_SOURCE_TYPES,
});

export const STATIC_CORPUS_PROFILE = Object.freeze({
  ...STATIC_CORPUS_PROFILE_SOURCE,
  profileHash: stableStructuralHash(STATIC_CORPUS_PROFILE_SOURCE),
});

export type AuthoritativeCorpusSpan = Readonly<{
  start: number;
  end: number;
  aliases?: readonly string[];
  structuralRefs?: readonly string[];
  dependencyRefs?: readonly string[];
}>;

export type AuthoritativeStaticCorpusSource = Readonly<{
  sourceKind: "static";
  sourceType: StaticCorpusSourceType;
  sourceRef: string;
  profileRef: string;
  sensitivity: ContextSensitivity;
  body: string;
  aliases?: readonly string[];
  structuralRefs?: readonly string[];
  dependencyRefs?: readonly string[];
  spans?: readonly AuthoritativeCorpusSpan[];
}>;

export type CompiledStaticCorpusRow = Readonly<{
  sourceRef: string;
  sourceHash: string;
  sourceSpanStart: number;
  sourceSpanEnd: number;
  sourceProfileRef: string;
  corpusProfileRef: string;
  corpusProfileHash: string;
  corpusHash: string;
  sensitivity: ContextSensitivity;
  dependencyRefsJson: string;
  structuralRefsJson: string;
  aliasesJson: string;
  purpose: StaticContextPurpose;
  sourceType: StaticCorpusSourceType;
  searchText: string;
}>;

export type CompiledStaticCorpus = Readonly<{
  compilerProfileRef: string;
  compilerProfileHash: string;
  corpusHash: string;
  d1CorpusHash: string;
  d1StorageScope: string;
  chunks: readonly StaticSourceChunk[];
  authorityByRef: Readonly<Record<string, StaticSourceChunk>>;
  index: StaticRetrievalIndex;
  d1Rows: readonly CompiledStaticCorpusRow[];
}>;

const SOURCE_KEYS = Object.freeze([
  "sourceKind",
  "sourceType",
  "sourceRef",
  "profileRef",
  "sensitivity",
  "body",
  "aliases",
  "structuralRefs",
  "dependencyRefs",
  "spans",
]);
const SPAN_KEYS = Object.freeze(["start", "end", "aliases", "structuralRefs", "dependencyRefs"]);
const DYNAMIC_FIELD_TOKENS = Object.freeze([
  "room",
  "transcript",
  "message",
  "currenttactical",
  "tacticalstate",
  "knowledge",
  "worldstate",
  "encounterstate",
  "viewer",
  "session",
]);
const DYNAMIC_REF_PREFIXES = Object.freeze([
  "room:",
  "transcript:",
  "message:",
  "current-tactical:",
  "tactical:current",
  "knowledge:",
  "world-state:",
  "encounter-state:",
  "viewer:",
  "session:",
]);

/** Compiles immutable source spans; it never summarizes or copies dynamic room state. */
export function compileStaticCorpus(
  sources: readonly AuthoritativeStaticCorpusSource[],
): CompiledStaticCorpus {
  for (const source of sources) validateAuthoritativeSource(source);
  const sortedSources = [...sources].sort((left, right) => left.sourceRef.localeCompare(right.sourceRef));
  const parentRefs = new Set<string>();
  const chunks: StaticSourceChunk[] = [];
  const sourceTypeByChunkRef = new Map<string, StaticCorpusSourceType>();
  for (const source of sortedSources) {
    if (parentRefs.has(source.sourceRef)) throw new Error("STATIC_CORPUS_SOURCE_REF_DUPLICATE");
    parentRefs.add(source.sourceRef);
    const sourceHash = authoritativeSourceHash(source);
    const spans = normalizedSpans(source);
    for (const span of spans) {
      const chunkRef = `${source.sourceRef}#span:${span.start}-${span.end}`;
      const aliases = generatedAliases([...(source.aliases ?? []), ...(span.aliases ?? [])]);
      const structuralRefs = uniqueSorted([
        source.sourceRef,
        `source-type:${source.sourceType}`,
        ...(source.structuralRefs ?? []),
        ...(span.structuralRefs ?? []),
      ].map(normalizeRef));
      const dependencyRefs = uniqueSorted([
        source.sourceRef,
        ...(source.dependencyRefs ?? []),
        ...(span.dependencyRefs ?? []),
      ].map(normalizeRef));
      const chunk = Object.freeze({
        sourceKind: "static" as const,
        sourceRef: chunkRef,
        sourceHash,
        sourceSpan: Object.freeze({ start: span.start, end: span.end }),
        profileRef: source.profileRef,
        sensitivity: source.sensitivity,
        dependencyRefs: Object.freeze(dependencyRefs),
        purpose: purposeForSourceType(source.sourceType),
        body: source.body.slice(span.start, span.end),
        aliases: Object.freeze(aliases),
        structuralRefs: Object.freeze(structuralRefs),
      });
      chunks.push(chunk);
      sourceTypeByChunkRef.set(chunkRef, source.sourceType);
    }
  }
  chunks.sort((left, right) => left.sourceRef.localeCompare(right.sourceRef));
  const index = buildStaticRetrievalIndex(chunks);
  const corpusHash = stableStructuralHash({
    compilerProfileRef: STATIC_CORPUS_PROFILE.profileRef,
    compilerProfileHash: STATIC_CORPUS_PROFILE.profileHash,
    chunks,
  });
  const authorityByRef: Record<string, StaticSourceChunk> = {};
  const publicChunks = chunks.filter((chunk) => chunk.sensitivity === "public");
  const d1CorpusHash = stableStructuralHash({
    compilerProfileRef: STATIC_CORPUS_PROFILE.profileRef,
    compilerProfileHash: STATIC_CORPUS_PROFILE.profileHash,
    chunks: publicChunks,
  });
  const d1StorageScope = stableStructuralHash({
    compilerProfileRef: STATIC_CORPUS_PROFILE.profileRef,
    sourceProfileRefs: uniqueSorted(publicChunks.map((chunk) => chunk.profileRef)),
    d1CorpusHash,
  });
  const d1Rows: CompiledStaticCorpusRow[] = [];
  for (const chunk of chunks) {
    authorityByRef[chunk.sourceRef] = chunk;
    // KP-only prose, aliases, refs, tokens, and content-derived hashes remain
    // inside the Worker authority. D1 indexes only public static material;
    // private free-text retrieval is merged deterministically in memory.
    if (chunk.sensitivity !== "public") continue;
    const entry = index.entries[chunk.sourceRef]!;
    d1Rows.push(Object.freeze({
      sourceRef: chunk.sourceRef,
      sourceHash: chunk.sourceHash,
      sourceSpanStart: chunk.sourceSpan.start,
      sourceSpanEnd: chunk.sourceSpan.end,
      sourceProfileRef: chunk.profileRef,
      corpusProfileRef: STATIC_CORPUS_PROFILE.profileRef,
      corpusProfileHash: STATIC_CORPUS_PROFILE.profileHash,
      corpusHash: d1CorpusHash,
      sensitivity: chunk.sensitivity,
      dependencyRefsJson: JSON.stringify(entry.dependencyRefs),
      structuralRefsJson: JSON.stringify(entry.structuralRefs),
      aliasesJson: JSON.stringify(entry.aliases),
      purpose: chunk.purpose,
      sourceType: sourceTypeByChunkRef.get(chunk.sourceRef)!,
      searchText: entry.searchTerms.join(" "),
    }));
  }
  return Object.freeze({
    compilerProfileRef: STATIC_CORPUS_PROFILE.profileRef,
    compilerProfileHash: STATIC_CORPUS_PROFILE.profileHash,
    corpusHash,
    d1CorpusHash,
    d1StorageScope,
    chunks: Object.freeze(chunks),
    authorityByRef: freezeRecord(authorityByRef),
    index,
    d1Rows: Object.freeze(d1Rows),
  });
}

export function authoritativeStaticCorpusReader(
  corpus: CompiledStaticCorpus,
): (sourceRef: string) => StaticSourceChunk | undefined {
  return (sourceRef) => corpus.authorityByRef[sourceRef];
}

export function authoritativeSourceHash(source: AuthoritativeStaticCorpusSource): string {
  validateAuthoritativeSource(source);
  return stableStructuralHash({
    sourceKind: source.sourceKind,
    sourceType: source.sourceType,
    sourceRef: source.sourceRef,
    profileRef: source.profileRef,
    sensitivity: source.sensitivity,
    body: source.body,
    aliases: uniqueSorted((source.aliases ?? []).map(normalizeAlias)),
    structuralRefs: uniqueSorted((source.structuralRefs ?? []).map(normalizeRef)),
    dependencyRefs: uniqueSorted((source.dependencyRefs ?? []).map(normalizeRef)),
  });
}

function validateAuthoritativeSource(source: AuthoritativeStaticCorpusSource): void {
  if (!isPlainRecord(source)) throw new Error("STATIC_CORPUS_SOURCE_OBJECT_REQUIRED");
  for (const key of Object.keys(source)) {
    if (!(SOURCE_KEYS as readonly string[]).includes(key)) {
      if (isDynamicField(key)) throw new Error("STATIC_CORPUS_DYNAMIC_SOURCE_FORBIDDEN");
      throw new Error(`STATIC_CORPUS_SOURCE_FIELD_UNKNOWN:${key}`);
    }
  }
  if (source.sourceKind !== "static") throw new Error("STATIC_CORPUS_DYNAMIC_SOURCE_FORBIDDEN");
  if (!(STATIC_CORPUS_SOURCE_TYPES as readonly string[]).includes(source.sourceType)) {
    throw new Error("STATIC_CORPUS_SOURCE_TYPE_FORBIDDEN");
  }
  const sourceRef = normalizeRef(source.sourceRef);
  if (sourceRef !== source.sourceRef) throw new Error("STATIC_CORPUS_REF_NOT_CANONICAL");
  if (DYNAMIC_REF_PREFIXES.some((prefix) => sourceRef.toLowerCase().startsWith(prefix))) {
    throw new Error("STATIC_CORPUS_DYNAMIC_SOURCE_FORBIDDEN");
  }
  requireText(source.profileRef, "STATIC_CORPUS_PROFILE_REF_REQUIRED");
  if (normalizeRef(source.profileRef) !== source.profileRef) throw new Error("STATIC_CORPUS_PROFILE_REF_NOT_CANONICAL");
  requireText(source.body, "STATIC_CORPUS_BODY_REQUIRED");
  if (source.sensitivity !== "public" && source.sensitivity !== "kp-only") {
    throw new Error("STATIC_CORPUS_SENSITIVITY_INVALID");
  }
  for (const [name, values] of [
    ["aliases", source.aliases],
    ["structuralRefs", source.structuralRefs],
    ["dependencyRefs", source.dependencyRefs],
  ] as const) validateStringList(values, `STATIC_CORPUS_${name.toUpperCase()}_INVALID`);
}

function normalizedSpans(source: AuthoritativeStaticCorpusSource): readonly AuthoritativeCorpusSpan[] {
  const rawSpans: readonly AuthoritativeCorpusSpan[] = source.spans
    ?? [Object.freeze({ start: 0, end: source.body.length })];
  if (rawSpans.length === 0) throw new Error("STATIC_CORPUS_SPAN_REQUIRED");
  const spans = rawSpans.map((span) => {
    if (!isPlainRecord(span)) throw new Error("STATIC_CORPUS_SPAN_OBJECT_REQUIRED");
    for (const key of Object.keys(span)) {
      if (!(SPAN_KEYS as readonly string[]).includes(key)) throw new Error(`STATIC_CORPUS_SPAN_FIELD_UNKNOWN:${key}`);
    }
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end)
      || span.start < 0 || span.end <= span.start || span.end > source.body.length) {
      throw new Error("STATIC_CORPUS_SPAN_INVALID");
    }
    if (source.body.slice(span.start, span.end).trim().length === 0) throw new Error("STATIC_CORPUS_SPAN_EMPTY");
    validateStringList(span.aliases, "STATIC_CORPUS_SPAN_ALIASES_INVALID");
    validateStringList(span.structuralRefs, "STATIC_CORPUS_SPAN_STRUCTURAL_REFS_INVALID");
    validateStringList(span.dependencyRefs, "STATIC_CORPUS_SPAN_DEPENDENCY_REFS_INVALID");
    return Object.freeze({
      start: span.start,
      end: span.end,
      aliases: Object.freeze([...(span.aliases ?? [])]),
      structuralRefs: Object.freeze([...(span.structuralRefs ?? [])]),
      dependencyRefs: Object.freeze([...(span.dependencyRefs ?? [])]),
    });
  }).sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index]!.start < spans[index - 1]!.end) throw new Error("STATIC_CORPUS_SPAN_OVERLAP");
  }
  return Object.freeze(spans);
}

function generatedAliases(values: readonly string[]): string[] {
  const aliases = new Set<string>();
  for (const value of values) {
    const normalized = normalizeAlias(value);
    aliases.add(normalized);
    const compact = normalized.replace(/\s+/gu, "");
    if (compact.length > 0) aliases.add(compact);
  }
  return [...aliases].sort();
}

function purposeForSourceType(sourceType: StaticCorpusSourceType): StaticContextPurpose {
  if (sourceType === "srd") return "rules";
  return sourceType;
}

export const STATIC_CORPUS_D1_UPSERT_CHUNK_SQL = `
INSERT INTO kp_static_chunks (
  source_ref, source_hash, source_span, profile_ref,
  corpus_profile_ref, corpus_profile_hash, corpus_hash,
  sensitivity, dependency_refs, structural_refs, aliases,
  purpose, source_type, body, search_text
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)
ON CONFLICT(source_ref) DO UPDATE SET
  source_hash = excluded.source_hash,
  source_span = excluded.source_span,
  profile_ref = excluded.profile_ref,
  corpus_profile_ref = excluded.corpus_profile_ref,
  corpus_profile_hash = excluded.corpus_profile_hash,
  corpus_hash = excluded.corpus_hash,
  sensitivity = excluded.sensitivity,
  dependency_refs = excluded.dependency_refs,
  structural_refs = excluded.structural_refs,
  aliases = excluded.aliases,
  purpose = excluded.purpose,
  source_type = excluded.source_type,
  body = '',
  search_text = excluded.search_text
`;

export const STATIC_CORPUS_D1_DELETE_FTS_REF_SQL =
  "DELETE FROM kp_static_chunks_fts WHERE source_ref = ?";
export const STATIC_CORPUS_D1_INSERT_FTS_SQL =
  "INSERT INTO kp_static_chunks_fts (source_ref, search_text) VALUES (?, ?)";
export const STATIC_CORPUS_D1_CLEAR_FTS_SQL = "DELETE FROM kp_static_chunks_fts";
export const STATIC_CORPUS_D1_CLEAR_CHUNKS_SQL = "DELETE FROM kp_static_chunks";
export const STATIC_CORPUS_D1_CLEAR_META_SQL = "DELETE FROM kp_static_corpus_profiles";
export const STATIC_CORPUS_D1_DELETE_SCOPE_FTS_SQL = `
DELETE FROM kp_static_chunks_fts
WHERE source_ref IN (
  SELECT source_ref FROM kp_static_chunks WHERE source_ref LIKE ?
)
`;
export const STATIC_CORPUS_D1_DELETE_SCOPE_CHUNKS_SQL =
  "DELETE FROM kp_static_chunks WHERE source_ref LIKE ?";
export const STATIC_CORPUS_D1_DELETE_STALE_FTS_SQL = `
DELETE FROM kp_static_chunks_fts
WHERE source_ref IN (
  SELECT source_ref FROM kp_static_chunks
  WHERE source_ref LIKE ? AND (corpus_hash IS NULL OR corpus_hash <> ?)
)
`;
export const STATIC_CORPUS_D1_DELETE_STALE_CHUNKS_SQL =
  "DELETE FROM kp_static_chunks WHERE source_ref LIKE ? AND (corpus_hash IS NULL OR corpus_hash <> ?)";
export const STATIC_CORPUS_D1_UPSERT_META_SQL = `
INSERT INTO kp_static_corpus_profiles (
  profile_ref, profile_hash, corpus_hash, compiler_version, chunk_count
) VALUES (?, ?, ?, ?, ?)
ON CONFLICT(profile_ref) DO UPDATE SET
  profile_hash = excluded.profile_hash,
  corpus_hash = excluded.corpus_hash,
  compiler_version = excluded.compiler_version,
  chunk_count = excluded.chunk_count
`;

export const STATIC_CORPUS_D1_UPSERT_SQL = Object.freeze({
  chunk: STATIC_CORPUS_D1_UPSERT_CHUNK_SQL,
  deleteFtsRef: STATIC_CORPUS_D1_DELETE_FTS_REF_SQL,
  insertFts: STATIC_CORPUS_D1_INSERT_FTS_SQL,
  deleteStaleFts: STATIC_CORPUS_D1_DELETE_STALE_FTS_SQL,
  deleteStaleChunks: STATIC_CORPUS_D1_DELETE_STALE_CHUNKS_SQL,
  activateMeta: STATIC_CORPUS_D1_UPSERT_META_SQL,
});

export const STATIC_CORPUS_D1_REBUILD_SQL = Object.freeze({
  clearMeta: STATIC_CORPUS_D1_CLEAR_META_SQL,
  clearFts: STATIC_CORPUS_D1_CLEAR_FTS_SQL,
  clearChunks: STATIC_CORPUS_D1_CLEAR_CHUNKS_SQL,
  chunk: STATIC_CORPUS_D1_UPSERT_CHUNK_SQL,
  insertFts: STATIC_CORPUS_D1_INSERT_FTS_SQL,
  activateMeta: STATIC_CORPUS_D1_UPSERT_META_SQL,
});

export interface D1CorpusPreparedStatement {
  bind(...values: unknown[]): D1CorpusPreparedStatement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<Readonly<{ results?: readonly T[] }>>;
}

export interface D1CorpusDatabase {
  prepare(sql: string): D1CorpusPreparedStatement;
  batch(statements: D1CorpusPreparedStatement[]): Promise<readonly unknown[]>;
}

type D1StoredChunkRow = Readonly<{
  source_ref: string;
  source_hash: string;
  source_span: string;
  profile_ref: string;
  corpus_profile_ref: string;
  corpus_profile_hash: string;
  corpus_hash: string;
  sensitivity: string;
  dependency_refs: string;
  structural_refs: string;
  aliases: string;
  purpose: string;
  source_type: string;
  body: string;
  search_text: string;
}>;

type D1StoredFtsRow = Readonly<{
  source_ref: string;
  search_text: string;
}>;

const D1_STORED_CHUNK_INTEGRITY_KEYS = Object.freeze([
  "source_ref",
  "source_hash",
  "source_span",
  "profile_ref",
  "corpus_profile_ref",
  "corpus_profile_hash",
  "corpus_hash",
  "sensitivity",
  "dependency_refs",
  "structural_refs",
  "aliases",
  "purpose",
  "source_type",
  "body",
  "search_text",
] as const);

const D1_STORED_FTS_INTEGRITY_KEYS = Object.freeze([
  "source_ref",
  "search_text",
] as const);

export type D1StaticCorpusPolicy = Readonly<{
  allowedProfileRefs: readonly string[];
  allowKpOnly: boolean;
}>;

export interface D1StaticCorpusAdapter {
  readonly mode: "d1-fts";
  readonly allowKpOnly: boolean;
  readonly isCurrent: (corpus: CompiledStaticCorpus) => Promise<boolean>;
  readonly upsert: (corpus: CompiledStaticCorpus) => Promise<void>;
  readonly rebuild: (corpus: CompiledStaticCorpus) => Promise<void>;
  readonly search: (query: StaticFtsQuery) => Promise<readonly StaticFtsHit[]>;
}

export function createD1StaticCorpusAdapter(
  db: D1CorpusDatabase,
  policy: D1StaticCorpusPolicy,
): D1StaticCorpusAdapter {
  const allowedProfiles = uniqueSorted(policy.allowedProfileRefs.map(normalizeRef));
  if (allowedProfiles.length === 0 || allowedProfiles.length > 32) {
    throw new Error("STATIC_CORPUS_D1_PROFILE_POLICY_INVALID");
  }
  let activeCorpus: CompiledStaticCorpus | undefined;
  const adapter: D1StaticCorpusAdapter = {
    mode: "d1-fts" as const,
    allowKpOnly: policy.allowKpOnly,
    async isCurrent(corpus: CompiledStaticCorpus): Promise<boolean> {
      activeCorpus = corpus;
      const metadataResult = await db.prepare(`
SELECT profile_ref, profile_hash, corpus_hash, compiler_version, chunk_count
FROM kp_static_corpus_profiles
WHERE profile_ref = ?
LIMIT 1
`).bind(
        d1MetaRef(corpus),
      ).all<{
        profile_ref: string;
        profile_hash: string;
        corpus_hash: string;
        compiler_version: string;
        chunk_count: number;
      }>();
      const metadata = metadataResult.results?.[0];
      if (metadata?.profile_ref !== d1MetaRef(corpus)
        || metadata.profile_hash !== corpus.compilerProfileHash
        || metadata.corpus_hash !== corpus.d1CorpusHash
        || metadata.compiler_version !== STATIC_CORPUS_PROFILE.compilerVersion
        || metadata.chunk_count !== corpus.d1Rows.length) return false;

      const chunkResult = await db.prepare(`
SELECT source_ref, source_hash, source_span, profile_ref,
       corpus_profile_ref, corpus_profile_hash, corpus_hash,
       sensitivity, dependency_refs, structural_refs, aliases,
       purpose, source_type, body, search_text
FROM kp_static_chunks
WHERE source_ref LIKE ?
ORDER BY source_ref
`).bind(d1StorageLike(corpus)).all<D1StoredChunkRow>();
      const ftsResult = await db.prepare(`
SELECT source_ref, search_text
FROM kp_static_chunks_fts
WHERE source_ref LIKE ?
ORDER BY source_ref
`).bind(d1StorageLike(corpus)).all<D1StoredFtsRow>();
      const expectedChunks = corpus.d1Rows
        .map((row) => d1StoredChunkRow(corpus, row))
        .sort((left, right) => left.source_ref.localeCompare(right.source_ref));
      const expectedFts = expectedChunks.map((row) => Object.freeze({
        source_ref: row.source_ref,
        search_text: row.search_text,
      }));
      return rowsExactlyMatch(
        chunkResult.results,
        expectedChunks,
        D1_STORED_CHUNK_INTEGRITY_KEYS,
      ) && rowsExactlyMatch(
        ftsResult.results,
        expectedFts,
        D1_STORED_FTS_INTEGRITY_KEYS,
      );
    },
    async upsert(corpus: CompiledStaticCorpus): Promise<void> {
      activeCorpus = corpus;
      await upsertCorpusRows(db, corpus);
      await activateCorpus(db, corpus, true);
    },
    async rebuild(corpus: CompiledStaticCorpus): Promise<void> {
      activeCorpus = corpus;
      await runBatches(db, [
        db.prepare(STATIC_CORPUS_D1_DELETE_SCOPE_FTS_SQL).bind(d1StorageLike(corpus)),
        db.prepare(STATIC_CORPUS_D1_DELETE_SCOPE_CHUNKS_SQL).bind(d1StorageLike(corpus)),
        db.prepare("DELETE FROM kp_static_corpus_profiles WHERE profile_ref = ?")
          .bind(d1MetaRef(corpus)),
      ]);
      await upsertCorpusRows(db, corpus);
      await activateCorpus(db, corpus, false);
    },
    async search(query: StaticFtsQuery): Promise<readonly StaticFtsHit[]> {
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 32) {
        throw new Error("STATIC_CORPUS_D1_QUERY_LIMIT_INVALID");
      }
      if (activeCorpus === undefined) throw new Error("STATIC_CORPUS_D1_NOT_SYNCHRONIZED");
      const publicTerms = new Set(activeCorpus.d1Rows.flatMap((row) => row.searchText.split(" ")));
      // A query can contain player-private prose. Only tokens already present
      // in the public index may cross the D1 seam.
      const terms = uniqueSorted(query.terms
        .map(normalizeFtsTerm)
        .filter((term) => Boolean(term) && publicTerms.has(term)));
      if (terms.length === 0) return Object.freeze([]);
      const profilePlaceholders = allowedProfiles.map(() => "?").join(", ");
      const sql = `
SELECT kp_static_chunks_fts.source_ref AS source_ref,
       -bm25(kp_static_chunks_fts) AS score
FROM kp_static_chunks_fts
JOIN kp_static_chunks
  ON kp_static_chunks.source_ref = kp_static_chunks_fts.source_ref
JOIN kp_static_corpus_profiles
  ON kp_static_corpus_profiles.profile_ref = ?
 AND kp_static_corpus_profiles.corpus_hash = kp_static_chunks.corpus_hash
WHERE kp_static_chunks_fts MATCH ?
  AND kp_static_corpus_profiles.profile_hash = ?
  AND kp_static_chunks.profile_ref IN (${profilePlaceholders})
  AND kp_static_chunks.sensitivity = 'public'
  AND kp_static_chunks.corpus_hash = ?
  AND kp_static_chunks.source_ref LIKE ?
ORDER BY bm25(kp_static_chunks_fts), kp_static_chunks_fts.source_ref
LIMIT ?
`;
      const result = await db.prepare(sql).bind(
        d1MetaRef(activeCorpus),
        ftsMatchExpression(terms),
        STATIC_CORPUS_PROFILE.profileHash,
        ...allowedProfiles,
        activeCorpus.d1CorpusHash,
        d1StorageLike(activeCorpus),
        query.limit,
      ).all<{ source_ref: string; score: number }>();
      const rows = result.results ?? [];
      return Object.freeze(rows.map((row) => {
        if (typeof row.source_ref !== "string" || row.source_ref.length === 0 || !Number.isFinite(row.score)) {
          throw new Error("STATIC_CORPUS_D1_HIT_INVALID");
        }
        return Object.freeze({
          sourceRef: logicalD1SourceRef(activeCorpus!, row.source_ref),
          score: row.score,
        });
      }));
    },
  };
  return Object.freeze(adapter);
}

async function upsertCorpusRows(db: D1CorpusDatabase, corpus: CompiledStaticCorpus): Promise<void> {
  const statements: D1CorpusPreparedStatement[] = [];
  for (const row of corpus.d1Rows) {
    const stored = d1StoredChunkRow(corpus, row);
    statements.push(db.prepare(STATIC_CORPUS_D1_UPSERT_CHUNK_SQL).bind(
      stored.source_ref,
      stored.source_hash,
      stored.source_span,
      stored.profile_ref,
      stored.corpus_profile_ref,
      stored.corpus_profile_hash,
      stored.corpus_hash,
      stored.sensitivity,
      stored.dependency_refs,
      stored.structural_refs,
      stored.aliases,
      stored.purpose,
      stored.source_type,
      stored.search_text,
    ));
    statements.push(db.prepare(STATIC_CORPUS_D1_DELETE_FTS_REF_SQL).bind(stored.source_ref));
    statements.push(db.prepare(STATIC_CORPUS_D1_INSERT_FTS_SQL).bind(stored.source_ref, stored.search_text));
  }
  await runBatches(db, statements);
}

async function activateCorpus(
  db: D1CorpusDatabase,
  corpus: CompiledStaticCorpus,
  pruneStale: boolean,
): Promise<void> {
  const statements: D1CorpusPreparedStatement[] = [];
  if (pruneStale) {
    statements.push(db.prepare(STATIC_CORPUS_D1_DELETE_STALE_FTS_SQL).bind(
      d1StorageLike(corpus),
      corpus.d1CorpusHash,
    ));
    statements.push(db.prepare(STATIC_CORPUS_D1_DELETE_STALE_CHUNKS_SQL).bind(
      d1StorageLike(corpus),
      corpus.d1CorpusHash,
    ));
  }
  statements.push(db.prepare(STATIC_CORPUS_D1_UPSERT_META_SQL).bind(
    d1MetaRef(corpus),
    corpus.compilerProfileHash,
    corpus.d1CorpusHash,
    STATIC_CORPUS_PROFILE.compilerVersion,
    corpus.d1Rows.length,
  ));
  await runBatches(db, statements);
}

async function runBatches(db: D1CorpusDatabase, statements: D1CorpusPreparedStatement[]): Promise<void> {
  const batchSize = 60;
  for (let offset = 0; offset < statements.length; offset += batchSize) {
    await db.batch(statements.slice(offset, offset + batchSize));
  }
}

/** Async D1 seam followed by the core's deterministic structural/alias merge. */
export async function retrieveStaticReferencesFromD1(
  index: StaticRetrievalIndex,
  request: StaticRetrievalRequest,
  d1: D1StaticCorpusAdapter,
): Promise<readonly StaticRetrievalHit[]> {
  // Only public corpus-derived structural terms may cross this seam. The
  // player's prose and Planner suggestions remain in Worker memory even when
  // every individual token also happens to exist in the public corpus: their
  // co-occurrence would otherwise disclose a reconstructable private query.
  const publicHits = request.publicD1QueryTerms.length === 0
    ? Object.freeze([])
    : await d1.search(Object.freeze({
        terms: request.publicD1QueryTerms,
        limit: request.limit,
      }));
  const requestedTerms = new Set(request.queryTerms);
  const memoryTextHits = Object.values(index.entries)
      .filter((entry) => entry.sensitivity === "public" || d1.allowKpOnly)
      .map((entry) => Object.freeze({
        sourceRef: entry.sourceRef,
        score: entry.searchTerms.reduce(
          (count, term) => count + (requestedTerms.has(term) ? 1 : 0),
          0,
        ),
      }))
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score || left.sourceRef.localeCompare(right.sourceRef))
      .slice(0, request.limit);
  const mergedScores = new Map<string, number>();
  for (const hit of [...publicHits, ...memoryTextHits]) {
    mergedScores.set(hit.sourceRef, Math.max(mergedScores.get(hit.sourceRef) ?? Number.NEGATIVE_INFINITY, hit.score));
  }
  const refOnlyHits = [...mergedScores]
    .map(([sourceRef, score]) => Object.freeze({ sourceRef, score }))
    .sort((left, right) => right.score - left.score || left.sourceRef.localeCompare(right.sourceRef))
    .slice(0, request.limit);
  const bridge: D1FtsAdapter = Object.freeze({
    mode: "d1-fts" as const,
    search(): readonly StaticFtsHit[] {
      return refOnlyHits;
    },
  });
  return retrieveStaticReferences(index, request, bridge);
}

function d1StoragePrefix(corpus: CompiledStaticCorpus): string {
  return `corpus:${corpus.d1StorageScope}:`;
}

function d1StorageLike(corpus: CompiledStaticCorpus): string {
  return `${d1StoragePrefix(corpus)}%`;
}

function d1MetaRef(corpus: CompiledStaticCorpus): string {
  return `${corpus.compilerProfileRef}:${corpus.d1StorageScope}`;
}

function d1StoredSourceRef(corpus: CompiledStaticCorpus, logicalSourceRef: string): string {
  return `${d1StoragePrefix(corpus)}${corpus.d1CorpusHash}:${logicalSourceRef}`;
}

function d1StoredChunkRow(
  corpus: CompiledStaticCorpus,
  row: CompiledStaticCorpusRow,
): D1StoredChunkRow {
  return Object.freeze({
    source_ref: d1StoredSourceRef(corpus, row.sourceRef),
    source_hash: row.sourceHash,
    source_span: JSON.stringify({ start: row.sourceSpanStart, end: row.sourceSpanEnd }),
    profile_ref: row.sourceProfileRef,
    corpus_profile_ref: row.corpusProfileRef,
    corpus_profile_hash: row.corpusProfileHash,
    corpus_hash: row.corpusHash,
    sensitivity: row.sensitivity,
    dependency_refs: row.dependencyRefsJson,
    structural_refs: row.structuralRefsJson,
    aliases: row.aliasesJson,
    purpose: row.purpose,
    source_type: row.sourceType,
    body: "",
    search_text: row.searchText,
  });
}

function rowsExactlyMatch<T extends { readonly source_ref: string }>(
  actual: readonly T[] | undefined,
  expected: readonly T[],
  keys: readonly (keyof T)[],
): boolean {
  if (actual === undefined || actual.length !== expected.length) return false;
  const actualBySourceRef = new Map<string, T>();
  for (const actualRow of actual) {
    if (actualBySourceRef.has(actualRow.source_ref)) return false;
    actualBySourceRef.set(actualRow.source_ref, actualRow);
  }
  const expectedSourceRefs = new Set<string>();
  return expected.every((expectedRow) => {
    if (expectedSourceRefs.has(expectedRow.source_ref)) return false;
    expectedSourceRefs.add(expectedRow.source_ref);
    const actualRow = actualBySourceRef.get(expectedRow.source_ref);
    return actualRow !== undefined
      && keys.every((key) => actualRow[key] === expectedRow[key]);
  });
}

function logicalD1SourceRef(corpus: CompiledStaticCorpus, storedSourceRef: string): string {
  const prefix = `${d1StoragePrefix(corpus)}${corpus.d1CorpusHash}:`;
  if (!storedSourceRef.startsWith(prefix) || storedSourceRef.length === prefix.length) {
    throw new Error("STATIC_CORPUS_D1_HIT_SCOPE_INVALID");
  }
  return storedSourceRef.slice(prefix.length);
}

export function corpusChineseTerms(corpus: CompiledStaticCorpus, sourceRef: string): readonly string[] {
  const chunk = corpus.authorityByRef[sourceRef];
  if (chunk === undefined) return Object.freeze([]);
  return Object.freeze(uniqueSorted([
    ...chineseBigrams(chunk.body),
    ...staticSearchTerms(chunk.body, chunk.aliases),
  ]));
}

function ftsMatchExpression(terms: readonly string[]): string {
  return terms.map((term) => `"${term.replace(/"/gu, '""')}"`).join(" OR ");
}

function normalizeFtsTerm(value: string): string {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (normalized.length > 160 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error("STATIC_CORPUS_D1_QUERY_TERM_INVALID");
  }
  return normalized;
}

function validateStringList(values: readonly string[] | undefined, code: string): void {
  if (values === undefined) return;
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    throw new Error(code);
  }
}

function isDynamicField(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return DYNAMIC_FIELD_TOKENS.some((token) => normalized.includes(token));
}

function normalizeRef(value: string): string {
  if (typeof value !== "string") throw new Error("STATIC_CORPUS_REF_INVALID");
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length === 0) throw new Error("STATIC_CORPUS_REF_INVALID");
  return normalized;
}

function normalizeAlias(value: string): string {
  if (typeof value !== "string") throw new Error("STATIC_CORPUS_ALIAS_INVALID");
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (normalized.length === 0) throw new Error("STATIC_CORPUS_ALIAS_INVALID");
  return normalized;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function requireText(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(code);
}

function freezeRecord<T>(value: Record<string, T>): Readonly<Record<string, T>> {
  const result: Record<string, T> = {};
  for (const key of Object.keys(value).sort()) result[key] = value[key]!;
  return Object.freeze(result);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
