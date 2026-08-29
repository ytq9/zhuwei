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
  compilerVersion: "kp-static-corpus-compiler-v1.0.0",
  indexSchemaVersion: "kp-static-corpus-d1-fts-v1",
  tokenizerVersion: "unicode61-zh-bigram-v1",
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
  const d1Rows: CompiledStaticCorpusRow[] = [];
  for (const chunk of chunks) {
    authorityByRef[chunk.sourceRef] = chunk;
    const entry = index.entries[chunk.sourceRef]!;
    d1Rows.push(Object.freeze({
      sourceRef: chunk.sourceRef,
      sourceHash: chunk.sourceHash,
      sourceSpanStart: chunk.sourceSpan.start,
      sourceSpanEnd: chunk.sourceSpan.end,
      sourceProfileRef: chunk.profileRef,
      corpusProfileRef: STATIC_CORPUS_PROFILE.profileRef,
      corpusProfileHash: STATIC_CORPUS_PROFILE.profileHash,
      corpusHash,
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

export const STATIC_CORPUS_D1_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS kp_static_corpus_meta (
  singleton_key TEXT PRIMARY KEY CHECK (singleton_key = 'active'),
  corpus_profile_ref TEXT NOT NULL,
  corpus_profile_hash TEXT NOT NULL,
  corpus_hash TEXT NOT NULL,
  compiler_version TEXT NOT NULL,
  chunk_count INTEGER NOT NULL CHECK (chunk_count >= 0)
);

CREATE TABLE IF NOT EXISTS kp_static_corpus_chunks (
  source_ref TEXT PRIMARY KEY,
  source_hash TEXT NOT NULL,
  source_span_start INTEGER NOT NULL CHECK (source_span_start >= 0),
  source_span_end INTEGER NOT NULL CHECK (source_span_end > source_span_start),
  source_profile_ref TEXT NOT NULL,
  corpus_profile_ref TEXT NOT NULL,
  corpus_profile_hash TEXT NOT NULL,
  corpus_hash TEXT NOT NULL,
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('public', 'kp-only')),
  dependency_refs_json TEXT NOT NULL,
  structural_refs_json TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('rules', 'module', 'story-bible', 'ability', 'enemy', 'environment')),
  source_type TEXT NOT NULL CHECK (source_type IN ('srd', 'module', 'story-bible', 'ability', 'enemy', 'environment')),
  search_text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS kp_static_corpus_profile_idx
  ON kp_static_corpus_chunks (source_profile_ref, sensitivity);

CREATE VIRTUAL TABLE IF NOT EXISTS kp_static_corpus_fts USING fts5(
  source_ref UNINDEXED,
  search_text,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

export const STATIC_CORPUS_D1_UPSERT_CHUNK_SQL = `
INSERT INTO kp_static_corpus_chunks (
  source_ref, source_hash, source_span_start, source_span_end,
  source_profile_ref, corpus_profile_ref, corpus_profile_hash, corpus_hash,
  sensitivity, dependency_refs_json, structural_refs_json, aliases_json,
  purpose, source_type, search_text
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(source_ref) DO UPDATE SET
  source_hash = excluded.source_hash,
  source_span_start = excluded.source_span_start,
  source_span_end = excluded.source_span_end,
  source_profile_ref = excluded.source_profile_ref,
  corpus_profile_ref = excluded.corpus_profile_ref,
  corpus_profile_hash = excluded.corpus_profile_hash,
  corpus_hash = excluded.corpus_hash,
  sensitivity = excluded.sensitivity,
  dependency_refs_json = excluded.dependency_refs_json,
  structural_refs_json = excluded.structural_refs_json,
  aliases_json = excluded.aliases_json,
  purpose = excluded.purpose,
  source_type = excluded.source_type,
  search_text = excluded.search_text
`;

export const STATIC_CORPUS_D1_DELETE_FTS_REF_SQL =
  "DELETE FROM kp_static_corpus_fts WHERE source_ref = ?";
export const STATIC_CORPUS_D1_INSERT_FTS_SQL =
  "INSERT INTO kp_static_corpus_fts (source_ref, search_text) VALUES (?, ?)";
export const STATIC_CORPUS_D1_CLEAR_FTS_SQL = "DELETE FROM kp_static_corpus_fts";
export const STATIC_CORPUS_D1_CLEAR_CHUNKS_SQL = "DELETE FROM kp_static_corpus_chunks";
export const STATIC_CORPUS_D1_CLEAR_META_SQL = "DELETE FROM kp_static_corpus_meta";
export const STATIC_CORPUS_D1_DELETE_STALE_FTS_SQL = `
DELETE FROM kp_static_corpus_fts
WHERE source_ref IN (
  SELECT source_ref FROM kp_static_corpus_chunks WHERE corpus_hash <> ?
)
`;
export const STATIC_CORPUS_D1_DELETE_STALE_CHUNKS_SQL =
  "DELETE FROM kp_static_corpus_chunks WHERE corpus_hash <> ?";
export const STATIC_CORPUS_D1_UPSERT_META_SQL = `
INSERT INTO kp_static_corpus_meta (
  singleton_key, corpus_profile_ref, corpus_profile_hash, corpus_hash, compiler_version, chunk_count
) VALUES ('active', ?, ?, ?, ?, ?)
ON CONFLICT(singleton_key) DO UPDATE SET
  corpus_profile_ref = excluded.corpus_profile_ref,
  corpus_profile_hash = excluded.corpus_profile_hash,
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
  exec(sql: string): Promise<unknown>;
  prepare(sql: string): D1CorpusPreparedStatement;
  batch(statements: D1CorpusPreparedStatement[]): Promise<readonly unknown[]>;
}

export type D1StaticCorpusPolicy = Readonly<{
  allowedProfileRefs: readonly string[];
  allowKpOnly: boolean;
}>;

export interface D1StaticCorpusAdapter {
  readonly mode: "d1-fts";
  migrate(): Promise<void>;
  upsert(corpus: CompiledStaticCorpus): Promise<void>;
  rebuild(corpus: CompiledStaticCorpus): Promise<void>;
  search(query: StaticFtsQuery): Promise<readonly StaticFtsHit[]>;
}

export function createD1StaticCorpusAdapter(
  db: D1CorpusDatabase,
  policy: D1StaticCorpusPolicy,
): D1StaticCorpusAdapter {
  const allowedProfiles = uniqueSorted(policy.allowedProfileRefs.map(normalizeRef));
  if (allowedProfiles.length === 0 || allowedProfiles.length > 32) {
    throw new Error("STATIC_CORPUS_D1_PROFILE_POLICY_INVALID");
  }
  return Object.freeze({
    mode: "d1-fts" as const,
    async migrate(): Promise<void> {
      await db.exec(STATIC_CORPUS_D1_MIGRATION_SQL);
    },
    async upsert(corpus: CompiledStaticCorpus): Promise<void> {
      await upsertCorpusRows(db, corpus);
      await activateCorpus(db, corpus, true);
    },
    async rebuild(corpus: CompiledStaticCorpus): Promise<void> {
      await runBatches(db, [
        db.prepare(STATIC_CORPUS_D1_CLEAR_META_SQL),
        db.prepare(STATIC_CORPUS_D1_CLEAR_FTS_SQL),
        db.prepare(STATIC_CORPUS_D1_CLEAR_CHUNKS_SQL),
      ]);
      await upsertCorpusRows(db, corpus);
      await activateCorpus(db, corpus, false);
    },
    async search(query: StaticFtsQuery): Promise<readonly StaticFtsHit[]> {
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 32) {
        throw new Error("STATIC_CORPUS_D1_QUERY_LIMIT_INVALID");
      }
      const terms = uniqueSorted(query.terms.map(normalizeFtsTerm).filter(Boolean));
      if (terms.length === 0) return Object.freeze([]);
      const profilePlaceholders = allowedProfiles.map(() => "?").join(", ");
      const sensitivities = policy.allowKpOnly ? ["public", "kp-only"] : ["public"];
      const sensitivityPlaceholders = sensitivities.map(() => "?").join(", ");
      const sql = `
SELECT kp_static_corpus_fts.source_ref AS source_ref,
       -bm25(kp_static_corpus_fts) AS score
FROM kp_static_corpus_fts
JOIN kp_static_corpus_chunks
  ON kp_static_corpus_chunks.source_ref = kp_static_corpus_fts.source_ref
JOIN kp_static_corpus_meta
  ON kp_static_corpus_meta.singleton_key = 'active'
 AND kp_static_corpus_meta.corpus_hash = kp_static_corpus_chunks.corpus_hash
WHERE kp_static_corpus_fts MATCH ?
  AND kp_static_corpus_meta.corpus_profile_hash = ?
  AND kp_static_corpus_chunks.source_profile_ref IN (${profilePlaceholders})
  AND kp_static_corpus_chunks.sensitivity IN (${sensitivityPlaceholders})
ORDER BY bm25(kp_static_corpus_fts), kp_static_corpus_fts.source_ref
LIMIT ?
`;
      const result = await db.prepare(sql).bind(
        ftsMatchExpression(terms),
        STATIC_CORPUS_PROFILE.profileHash,
        ...allowedProfiles,
        ...sensitivities,
        query.limit,
      ).all<{ source_ref: string; score: number }>();
      const rows = result.results ?? [];
      return Object.freeze(rows.map((row) => {
        if (typeof row.source_ref !== "string" || row.source_ref.length === 0 || !Number.isFinite(row.score)) {
          throw new Error("STATIC_CORPUS_D1_HIT_INVALID");
        }
        return Object.freeze({ sourceRef: row.source_ref, score: row.score });
      }));
    },
  });
}

async function upsertCorpusRows(db: D1CorpusDatabase, corpus: CompiledStaticCorpus): Promise<void> {
  const statements: D1CorpusPreparedStatement[] = [];
  for (const row of corpus.d1Rows) {
    statements.push(db.prepare(STATIC_CORPUS_D1_UPSERT_CHUNK_SQL).bind(
      row.sourceRef,
      row.sourceHash,
      row.sourceSpanStart,
      row.sourceSpanEnd,
      row.sourceProfileRef,
      row.corpusProfileRef,
      row.corpusProfileHash,
      row.corpusHash,
      row.sensitivity,
      row.dependencyRefsJson,
      row.structuralRefsJson,
      row.aliasesJson,
      row.purpose,
      row.sourceType,
      row.searchText,
    ));
    statements.push(db.prepare(STATIC_CORPUS_D1_DELETE_FTS_REF_SQL).bind(row.sourceRef));
    statements.push(db.prepare(STATIC_CORPUS_D1_INSERT_FTS_SQL).bind(row.sourceRef, row.searchText));
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
    statements.push(db.prepare(STATIC_CORPUS_D1_DELETE_STALE_FTS_SQL).bind(corpus.corpusHash));
    statements.push(db.prepare(STATIC_CORPUS_D1_DELETE_STALE_CHUNKS_SQL).bind(corpus.corpusHash));
  }
  statements.push(db.prepare(STATIC_CORPUS_D1_UPSERT_META_SQL).bind(
    corpus.compilerProfileRef,
    corpus.compilerProfileHash,
    corpus.corpusHash,
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
  const refOnlyHits = await d1.search(Object.freeze({ terms: request.queryTerms, limit: request.limit }));
  const bridge: D1FtsAdapter = Object.freeze({
    mode: "d1-fts" as const,
    search(): readonly StaticFtsHit[] {
      return refOnlyHits;
    },
  });
  return retrieveStaticReferences(index, request, bridge);
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
