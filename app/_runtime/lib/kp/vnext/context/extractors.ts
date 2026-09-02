import { canonicalHash, compareCodeUnits, isPlainRecord } from "../canonical-json";
import type { AuthorityRefKind } from "./reference-index";
import type { ContextWorkBudget } from "./work-budget";

/**
 * What a field is indexed *for*. Purpose is part of the extractor key, so a
 * field is never admitted to retrieval because its name looks searchable. An
 * NPC's stated goals are indexed for `actorIntent` and are reachable only by
 * that NPC's own discovery; a precedent's `publicExplanation` is registered
 * nowhere, because prose written to explain a ruling must not decide whether
 * that ruling applies again.
 */
export type RetrievalPurpose = "objectIdentification" | "capability" | "actorIntent";

export type ExtractorTermKind = "alias" | "lexical" | "structural";

export type FieldExtractor = Readonly<{
  /** The record's own `schema`, or `authority:<kind>` for records that carry
   * no schema field and are typed by the reference index instead. */
  sourceSchema: string;
  /** Semantic kind, fact kind, or "" when the schema has only one shape. */
  recordKind: string;
  path: readonly string[];
  termKind: ExtractorTermKind;
  purpose: RetrievalPurpose;
}>;

export type TokenizerProfile = Readonly<{
  /** Widths used for Han runs. Latin and digit runs tokenize whole. */
  ngramSizes: readonly number[];
  maxFieldCharacters: number;
  maxTermsPerField: number;
  /** Fan-out cap: a term appearing in more refs than this is too generic to
   * discriminate and is dropped rather than silently ranked. */
  maxPostingsPerTerm: number;
  maxCandidates: number;
}>;

export type RetrievalProfile = Readonly<{
  profileRef: string;
  profileHash: string;
  tokenizer: TokenizerProfile;
  extractors: readonly FieldExtractor[];
}>;

export type ExtractedTerm = Readonly<{
  term: string;
  termKind: ExtractorTermKind;
  purpose: RetrievalPurpose;
}>;

export type RecordDescriptor = Readonly<{
  sourceSchema: string;
  recordKind: string;
}>;

export type ExtractionResult =
  | Readonly<{
      kind: "terms";
      terms: readonly ExtractedTerm[];
      /** Field paths whose text hit the profile length cap. Carried into
       * coverage so a truncated surface is never reported as a complete one. */
      truncatedPaths: readonly string[];
    }>
  | Readonly<{ kind: "preparationLimit" }>;

export function retrievalProfile(
  profileRef: string,
  tokenizer: TokenizerProfile,
  extractors: readonly FieldExtractor[],
): RetrievalProfile {
  if (tokenizer.ngramSizes.length === 0
    || tokenizer.ngramSizes.some((size) => !Number.isSafeInteger(size) || size < 1)) {
    throw new TypeError("retrievalProfile.tokenizer.ngramSizes:positive-integers-required");
  }
  for (const [label, value] of Object.entries({
    maxFieldCharacters: tokenizer.maxFieldCharacters,
    maxTermsPerField: tokenizer.maxTermsPerField,
    maxPostingsPerTerm: tokenizer.maxPostingsPerTerm,
    maxCandidates: tokenizer.maxCandidates,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`retrievalProfile.tokenizer.${label}:positive-safe-integer-required`);
    }
  }
  const normalizedTokenizer = Object.freeze({
    ngramSizes: Object.freeze([...new Set(tokenizer.ngramSizes)].sort((left, right) =>
      left - right)),
    maxFieldCharacters: tokenizer.maxFieldCharacters,
    maxTermsPerField: tokenizer.maxTermsPerField,
    maxPostingsPerTerm: tokenizer.maxPostingsPerTerm,
    maxCandidates: tokenizer.maxCandidates,
  });
  const normalizedExtractors = Object.freeze([...extractors]
    .map((extractor) => {
      if (extractor.path.length === 0) {
        throw new TypeError("retrievalProfile.extractors.path:non-empty-required");
      }
      return Object.freeze({ ...extractor, path: Object.freeze([...extractor.path]) });
    })
    .sort((left, right) => compareCodeUnits(extractorKey(left), extractorKey(right))));
  if (normalizedExtractors.some((extractor, index) =>
    index > 0 && extractorKey(extractor) === extractorKey(normalizedExtractors[index - 1]!))) {
    throw new TypeError("retrievalProfile.extractors:duplicate-key");
  }
  return Object.freeze({
    profileRef,
    profileHash: canonicalHash({
      profileRef,
      tokenizer: normalizedTokenizer,
      extractors: normalizedExtractors,
    }),
    tokenizer: normalizedTokenizer,
    extractors: normalizedExtractors,
  });
}

const SEMANTIC_SCHEMA = "zhuwei.semantic-definition/vnext-1";

/**
 * The registered surface. A schema absent from this table is never scanned for
 * free text: it remains reachable by exact ref and typed relation only. Adding
 * a row widens what discovery can see and changes `profileHash`, so it cannot
 * happen by accident.
 */
export const VNEXT_RETRIEVAL_PROFILE = retrievalProfile(
  "zhuwei.adjudication-retrieval/vnext-1",
  {
    ngramSizes: [2, 3],
    maxFieldCharacters: 2_000,
    maxTermsPerField: 256,
    maxPostingsPerTerm: 64,
    maxCandidates: 128,
  },
  [
    { sourceSchema: SEMANTIC_SCHEMA, recordKind: "sceneFeature", path: ["content", "label"], termKind: "alias", purpose: "objectIdentification" },
    { sourceSchema: SEMANTIC_SCHEMA, recordKind: "sceneFeature", path: ["content", "description"], termKind: "lexical", purpose: "objectIdentification" },
    { sourceSchema: SEMANTIC_SCHEMA, recordKind: "sceneFeature", path: ["content", "materialDescription"], termKind: "lexical", purpose: "objectIdentification" },
    { sourceSchema: SEMANTIC_SCHEMA, recordKind: "sceneFeature", path: ["content", "observableState"], termKind: "lexical", purpose: "objectIdentification" },
    { sourceSchema: SEMANTIC_SCHEMA, recordKind: "sceneFeature", path: ["content", "affordances"], termKind: "lexical", purpose: "objectIdentification" },
    { sourceSchema: SEMANTIC_SCHEMA, recordKind: "sceneFeature", path: ["content", "mechanicDefinitionRefs"], termKind: "structural", purpose: "objectIdentification" },
    { sourceSchema: SEMANTIC_SCHEMA, recordKind: "item", path: ["content", "label"], termKind: "alias", purpose: "objectIdentification" },
    { sourceSchema: SEMANTIC_SCHEMA, recordKind: "item", path: ["content", "description"], termKind: "lexical", purpose: "objectIdentification" },
    { sourceSchema: SEMANTIC_SCHEMA, recordKind: "npc", path: ["content", "label"], termKind: "alias", purpose: "objectIdentification" },
    { sourceSchema: SEMANTIC_SCHEMA, recordKind: "npc", path: ["content", "description"], termKind: "lexical", purpose: "objectIdentification" },
    // Reachable only through NPC-owned discovery; never part of the surface
    // built for a player's own action.
    { sourceSchema: SEMANTIC_SCHEMA, recordKind: "npc", path: ["content", "semantics", "goals", "description"], termKind: "lexical", purpose: "actorIntent" },
    { sourceSchema: SEMANTIC_SCHEMA, recordKind: "npc", path: ["content", "semantics", "plans", "description"], termKind: "lexical", purpose: "actorIntent" },
    { sourceSchema: "authority:entity", recordKind: "", path: ["name"], termKind: "alias", purpose: "objectIdentification" },
    { sourceSchema: "authority:itemDefinition", recordKind: "", path: ["content", "label"], termKind: "alias", purpose: "objectIdentification" },
    { sourceSchema: "authority:itemDefinition", recordKind: "", path: ["content", "description"], termKind: "lexical", purpose: "objectIdentification" },
    { sourceSchema: "authority:itemDefinition", recordKind: "", path: ["content", "aliases"], termKind: "alias", purpose: "objectIdentification" },
    { sourceSchema: "authority:abilityDefinition", recordKind: "", path: ["label"], termKind: "alias", purpose: "capability" },
  ],
);

/**
 * Derives the extractor key from addressing alone. A node whose descriptor
 * matches no registered extractor is never opened, so an unregistered schema
 * costs nothing and stays reachable by exact ref and typed relation only.
 */
export function nodeDescriptor(node: Readonly<{
  kind: AuthorityRefKind;
  semanticKind?: string;
}>): RecordDescriptor {
  return Object.freeze(node.kind === "semanticDefinition"
    ? { sourceSchema: SEMANTIC_SCHEMA, recordKind: node.semanticKind ?? "" }
    : { sourceSchema: `authority:${node.kind}`, recordKind: "" });
}

export function profileIndexesDescriptor(
  profile: RetrievalProfile,
  descriptor: RecordDescriptor,
): boolean {
  return profile.extractors.some((extractor) =>
    extractor.sourceSchema === descriptor.sourceSchema
    && extractor.recordKind === descriptor.recordKind);
}

export function extractTerms(
  record: unknown,
  descriptor: RecordDescriptor,
  profile: RetrievalProfile,
  budget: ContextWorkBudget,
): ExtractionResult {
  const terms = new Map<string, ExtractedTerm>();
  const truncatedPaths: string[] = [];
  for (const extractor of profile.extractors) {
    if (extractor.sourceSchema !== descriptor.sourceSchema
      || extractor.recordKind !== descriptor.recordKind) continue;
    for (const raw of fieldStrings(record, extractor.path)) {
      if (extractor.termKind === "structural") {
        if (!budget.charge("postingWrites", 1)) return LIMITED;
        addTerm(terms, raw, extractor);
        continue;
      }
      const capped = raw.length > profile.tokenizer.maxFieldCharacters;
      const text = capped ? raw.slice(0, profile.tokenizer.maxFieldCharacters) : raw;
      if (capped) truncatedPaths.push(extractor.path.join("."));
      // Charged before tokenizing, so an oversized surface is refused rather
      // than expanded and then rejected.
      if (!budget.charge("searchableCharacters", text.length)) return LIMITED;
      const tokens = tokenize(text, profile.tokenizer);
      if (!budget.charge("postingWrites", tokens.length)) return LIMITED;
      for (const token of tokens) addTerm(terms, token, extractor);
    }
  }
  return Object.freeze({
    kind: "terms",
    terms: Object.freeze([...terms.values()].sort((left, right) =>
      compareCodeUnits(termKey(left), termKey(right)))),
    truncatedPaths: Object.freeze([...new Set(truncatedPaths)].sort(compareCodeUnits)),
  });
}

/**
 * Deterministic tokenizer. Han runs yield fixed-width n-grams because the
 * language has no space-delimited words; latin and digit runs yield whole
 * tokens. No dictionary, no locale, no scoring heuristics — the same text
 * always produces the same terms in the same order.
 */
export function tokenize(
  text: string,
  tokenizer: TokenizerProfile,
): readonly string[] {
  const normalized = text.normalize("NFC").toLowerCase();
  const tokens = new Set<string>();
  for (const run of normalized.match(/\p{Script=Han}+|[a-z0-9]+/gu) ?? []) {
    if (!/^\p{Script=Han}+$/u.test(run)) {
      if (run.length >= 2) tokens.add(run);
      continue;
    }
    const characters = [...run];
    for (const size of tokenizer.ngramSizes) {
      if (characters.length <= size) {
        if (characters.length >= 1) tokens.add(characters.join(""));
        continue;
      }
      for (let start = 0; start + size <= characters.length; start += 1) {
        tokens.add(characters.slice(start, start + size).join(""));
      }
    }
    if (tokens.size > tokenizer.maxTermsPerField) break;
  }
  return Object.freeze([...tokens]
    .sort(compareCodeUnits)
    .slice(0, tokenizer.maxTermsPerField));
}

const LIMITED = Object.freeze({ kind: "preparationLimit" as const });

function addTerm(
  target: Map<string, ExtractedTerm>,
  term: string,
  extractor: FieldExtractor,
): void {
  if (term.length === 0) return;
  const entry = Object.freeze({
    term,
    termKind: extractor.termKind,
    purpose: extractor.purpose,
  });
  const key = termKey(entry);
  // An alias reading of a term outranks a lexical one and must not be
  // overwritten by a later field that happens to contain the same token.
  if (!target.has(key)) target.set(key, entry);
}

function termKey(term: ExtractedTerm): string {
  return `${term.purpose} ${term.termKind} ${term.term}`;
}

function extractorKey(extractor: FieldExtractor): string {
  return [
    extractor.sourceSchema,
    extractor.recordKind,
    extractor.path.join("."),
    extractor.termKind,
    extractor.purpose,
  ].join(" ");
}

/**
 * Reads exactly the declared path. A segment applied to an array maps over its
 * members, so `goals.description` reaches each goal's own text without the
 * recursive whole-record descent this replaces. Only strings are yielded: a
 * value of any other shape contributes nothing rather than being stringified.
 */
function fieldStrings(record: unknown, path: readonly string[]): readonly string[] {
  let cursor: readonly unknown[] = [record];
  for (const key of path) {
    cursor = cursor.flatMap((value) => isPlainRecord(value)
      ? [value[key]]
      : Array.isArray(value)
        ? value.map((member) => isPlainRecord(member) ? member[key] : undefined)
        : []);
  }
  return cursor
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}
