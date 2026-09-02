import {
  canonicalClone,
  compareCodeUnits,
  isNonEmptyString,
  isPlainRecord,
  type JsonRecord,
  type JsonValue,
} from "../canonical-json";
import type { KnownAbsentContextEntry } from "../required-context";

/**
 * A precedent condition is the part of a ruling that says when it may be
 * considered again. It is deliberately structural: a context fingerprint
 * also contains the old ruling's mechanics, DC and outcome text, so it cannot
 * answer an applicability question by itself.
 */
export const VNEXT_PRECEDENT_CONDITION_SCHEMA =
  "zhuwei.precedent-condition-signature/vnext-1" as const;

export type PrecedentScopeKind = "scene" | "campaign" | "module" | "room";

export type PrecedentConditionScope = Readonly<{
  kind: PrecedentScopeKind;
  ref: string;
}>;

/**
 * The condition body is intentionally extensible for future Form families,
 * but its scope and form are always explicit. "mechanics", "dc",
 * "outcomeRange" and the old aggregate fingerprint are forbidden at every
 * depth so a caller cannot accidentally turn a ruling into a condition key.
 */
export type PrecedentConditionSignature = Readonly<{
  schema: typeof VNEXT_PRECEDENT_CONDITION_SCHEMA;
  scope: PrecedentConditionScope;
  formId: string;
  [key: string]: JsonValue;
}>;

export type PrecedentApplicabilityQuery = Readonly<{
  entryRef: string;
  conditionSignature: PrecedentConditionSignature;
  /** The scope/selector evidence used to prove a negative applicability
   * result. The collection ref is used when omitted. */
  basisRefs?: readonly string[];
}>;

export type PrecedentApplicabilityInput = Readonly<{
  /** A complete authority collection is required before absence can be
   * asserted. A partial retrieval result must set this to false. */
  collectionComplete: boolean;
  collection: readonly unknown[] | Readonly<Record<string, unknown>>;
  query: PrecedentApplicabilityQuery;
  collectionRef?: string;
}>;

export type VNextPrecedentRecord = Readonly<JsonRecord & {
  precedentId: string;
  status: "active" | "superseded";
  conditionSignature: PrecedentConditionSignature;
}>;

export type PrecedentApplicabilityResult =
  | Readonly<{
      kind: "exact";
      conditionSignature: PrecedentConditionSignature;
      active: VNextPrecedentRecord;
      /** Superseded records are returned only as historical lineage. */
      lineage: readonly VNextPrecedentRecord[];
    }>
  | Readonly<{
      kind: "analogous";
      conditionSignature: PrecedentConditionSignature;
      candidates: readonly VNextPrecedentRecord[];
      lineage: readonly VNextPrecedentRecord[];
    }>
  | Readonly<{
      kind: "knownAbsent";
      conditionSignature: PrecedentConditionSignature;
      /** notApplicable means no active same-form ruling was found in the
       * requested scope. It is still an explicit negative, not a retrieval
       * miss. */
      applicability: "notApplicable";
      entry: KnownAbsentContextEntry;
      lineage: readonly VNextPrecedentRecord[];
    }>
  | Readonly<{
      kind: "unresolved";
      reason:
        | "collectionIncomplete"
        | "conditionSignatureMissing"
        | "recordInvalid"
        | "queryInvalid";
      issues: readonly string[];
    }>
  | Readonly<{
      kind: "integrityConflict";
      issue: string;
    }>;

const FORBIDDEN_CONDITION_KEYS = new Set([
  "mechanics",
  "dc",
  "outcomeRange",
  "canonicalContextFingerprint",
]);

/**
 * Resolves applicability against one authoritative collection. No active
 * exact record may be replaced by an analogous or superseded one. Likewise,
 * a collection that is not known complete never produces knownAbsent.
 */
export function resolvePrecedentApplicability(
  input: PrecedentApplicabilityInput,
): PrecedentApplicabilityResult {
  const query = normalizeQuery(input.query);
  if (query === undefined) {
    return unresolved("queryInvalid", ["query:condition-signature-invalid"]);
  }
  if (input.collectionComplete !== true) {
    return unresolved("collectionIncomplete", [
      "precedentCollection:complete-authority-snapshot-required",
    ]);
  }

  const collectionRef = isNonEmptyString(input.collectionRef)
    ? input.collectionRef
    : "continuity:adjudicationPrecedents";
  const rawRecords = collectionRecords(input.collection);
  if (rawRecords === undefined) {
    return unresolved("recordInvalid", ["precedentCollection:record-map-or-array-required"]);
  }

  const normalized: VNextPrecedentRecord[] = [];
  for (const [index, raw] of rawRecords.entries()) {
    const result = normalizeRecord(raw, index);
    if (result.kind === "integrityConflict") return result;
    if (result.kind === "unresolved") return result;
    normalized.push(result.record);
  }
  normalized.sort((left, right) => compareCodeUnits(left.precedentId, right.precedentId));

  const byId = new Map<string, VNextPrecedentRecord>();
  for (const record of normalized) {
    if (byId.has(record.precedentId)) {
      return Object.freeze({
        kind: "integrityConflict",
        issue: "precedent:" + record.precedentId + ":duplicate-authority-record",
      });
    }
    byId.set(record.precedentId, record);
  }

  const activeExact = normalized.filter((record) =>
    record.status === "active"
    && conditionSignatureEqual(record.conditionSignature, query.conditionSignature));
  if (activeExact.length > 1) {
    return Object.freeze({
      kind: "integrityConflict",
      issue: "precedent:active-condition-conflict:"
        + query.conditionSignature.scope.ref,
    });
  }
  if (activeExact.length === 1) {
    const active = activeExact[0]!;
    return Object.freeze({
      kind: "exact",
      conditionSignature: query.conditionSignature,
      active,
      lineage: lineageFor(active, normalized, byId),
    });
  }

  const activeAnalogous = normalized
    .filter((record) => record.status === "active"
      && sameScopeAndForm(record.conditionSignature, query.conditionSignature)
      && !conditionSignatureEqual(record.conditionSignature, query.conditionSignature))
    .sort((left, right) => compareCodeUnits(left.precedentId, right.precedentId));
  if (activeAnalogous.length > 0) {
    return Object.freeze({
      kind: "analogous",
      conditionSignature: query.conditionSignature,
      candidates: Object.freeze(activeAnalogous),
      lineage: Object.freeze(normalized.filter((record) =>
        record.status === "superseded"
        && sameScopeAndForm(record.conditionSignature, query.conditionSignature))),
    });
  }

  // Superseded records can explain where an old ruling came from, but they
  // cannot establish current applicability. A complete collection with no
  // active exact is the one case where a negative is authoritative.
  const exactLineage = normalized.filter((record) =>
    record.status === "superseded"
    && conditionSignatureEqual(record.conditionSignature, query.conditionSignature));
  const basisRefs = [...new Set([
    ...(query.basisRefs ?? []),
    collectionRef,
  ])].sort(compareCodeUnits);
  return Object.freeze({
    kind: "knownAbsent",
    conditionSignature: query.conditionSignature,
    applicability: "notApplicable",
    entry: Object.freeze({
      kind: "knownAbsent",
      entryRef: query.entryRef,
      scopeRef: query.conditionSignature.scope.ref,
      selector: {
        kind: "conditionSignature" as const,
        conditionSignature: query.conditionSignature as unknown as JsonRecord,
      },
      basisRefs: Object.freeze(basisRefs),
    }),
    lineage: Object.freeze(exactLineage),
  });
}

/**
 * Structural equality is intentionally exported for consumers that need to
 * compare a frozen condition without reducing it to a hash.
 */
export function conditionSignatureEqual(
  left: PrecedentConditionSignature,
  right: PrecedentConditionSignature,
): boolean {
  return structuralKey(left) === structuralKey(right);
}

export function normalizePrecedentConditionSignature(
  value: unknown,
): PrecedentConditionSignature | undefined {
  if (!isPlainRecord(value)
    || value.schema !== VNEXT_PRECEDENT_CONDITION_SCHEMA
    || !isNonEmptyString(value.formId)
    || !isPlainRecord(value.scope)
    || !isNonEmptyString(value.scope.ref)
    || !isNonEmptyString(value.scope.kind)
    || !["scene", "campaign", "module", "room"].includes(value.scope.kind)) {
    return undefined;
  }
  if (containsForbiddenKey(value)) return undefined;
  try {
    return canonicalClone(value) as PrecedentConditionSignature;
  } catch {
    return undefined;
  }
}

function normalizeQuery(
  query: PrecedentApplicabilityQuery,
): PrecedentApplicabilityQuery | undefined {
  if (query === null || typeof query !== "object"
    || !isNonEmptyString(query.entryRef)) return undefined;
  const conditionSignature = normalizePrecedentConditionSignature(query.conditionSignature);
  if (conditionSignature === undefined) return undefined;
  if (query.basisRefs !== undefined
    && (!Array.isArray(query.basisRefs)
      || query.basisRefs.some((ref) => !isNonEmptyString(ref)))) return undefined;
  return Object.freeze({
    entryRef: query.entryRef,
    conditionSignature,
    ...(query.basisRefs === undefined
      ? {}
      : { basisRefs: Object.freeze([...new Set(query.basisRefs)].sort(compareCodeUnits)) }),
  });
}

function collectionRecords(
  collection: readonly unknown[] | Readonly<Record<string, unknown>>,
): readonly unknown[] | undefined {
  if (Array.isArray(collection)) return collection;
  if (!isPlainRecord(collection)) return undefined;
  return Object.entries(collection)
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([, value]) => value);
}

type NormalizedRecordResult =
  | Readonly<{ kind: "record"; record: VNextPrecedentRecord }>
  | Extract<PrecedentApplicabilityResult, { kind: "unresolved" }>
  | Extract<PrecedentApplicabilityResult, { kind: "integrityConflict" }>;

function normalizeRecord(value: unknown, index: number): NormalizedRecordResult {
  if (!isPlainRecord(value)
    || !isNonEmptyString(value.precedentId)
    || (value.status !== "active" && value.status !== "superseded")) {
    return unresolved("recordInvalid", [
      "precedent[" + index + "]:identity-or-status-invalid",
    ]);
  }
  const conditionSignature = normalizePrecedentConditionSignature(value.conditionSignature);
  if (conditionSignature === undefined) {
    return unresolved("conditionSignatureMissing", [
      "precedent:" + value.precedentId + ":structured-condition-signature-required",
    ]);
  }
  if (isPlainRecord(value.applicabilityScope)
    && (value.applicabilityScope.kind !== conditionSignature.scope.kind
      || value.applicabilityScope.ref !== conditionSignature.scope.ref)) {
    return Object.freeze({
      kind: "integrityConflict",
      issue: "precedent:" + value.precedentId + ":scope-condition-mismatch",
    });
  }
  try {
    const cloned = canonicalClone(value) as JsonRecord;
    return Object.freeze({
      kind: "record",
      record: Object.freeze({
        ...cloned,
        conditionSignature,
      }) as VNextPrecedentRecord,
    });
  } catch {
    return unresolved("recordInvalid", [
      "precedent:" + value.precedentId + ":non-canonical-record",
    ]);
  }
}

function sameScopeAndForm(
  left: PrecedentConditionSignature,
  right: PrecedentConditionSignature,
): boolean {
  return left.formId === right.formId
    && left.scope.kind === right.scope.kind
    && left.scope.ref === right.scope.ref;
}

function lineageFor(
  active: VNextPrecedentRecord,
  records: readonly VNextPrecedentRecord[],
  byId: ReadonlyMap<string, VNextPrecedentRecord>,
): readonly VNextPrecedentRecord[] {
  const lineage: VNextPrecedentRecord[] = [];
  const seen = new Set<string>([active.precedentId]);
  let current = active;
  while (isNonEmptyString(current.supersededPrecedentId)) {
    const prior = byId.get(current.supersededPrecedentId);
    if (prior === undefined || seen.has(prior.precedentId)) break;
    seen.add(prior.precedentId);
    if (prior.status !== "superseded") break;
    lineage.push(prior);
    current = prior;
  }
  // Some restored records only carry the forward edge. Include those records
  // as lineage too, but never promote them into the active result.
  for (const record of records) {
    if (record.status === "superseded"
      && record.supersededByPrecedentId === active.precedentId
      && !seen.has(record.precedentId)) {
      lineage.push(record);
    }
  }
  return Object.freeze(lineage.sort((left, right) =>
    compareCodeUnits(left.precedentId, right.precedentId)));
}

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (!isPlainRecord(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    FORBIDDEN_CONDITION_KEYS.has(key) || containsForbiddenKey(child));
}

/**
 * Stable structural notation used only for equality. It is not a persisted
 * fingerprint and does not hide the condition fields from callers.
 */
function structuralKey(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return "s:" + JSON.stringify(value);
  if (typeof value === "number") return "n:" + String(value);
  if (typeof value === "boolean") return value ? "b:1" : "b:0";
  if (Array.isArray(value)) return "a:[" + value.map(structuralKey).join(",") + "]";
  const record = value as JsonRecord;
  return "o:{" + Object.keys(record).sort(compareCodeUnits)
    .map((key) => JSON.stringify(key) + ":" + structuralKey(record[key]!))
    .join(",") + "}";
}

function unresolved(
  reason: Extract<PrecedentApplicabilityResult, { kind: "unresolved" }>["reason"],
  issues: readonly string[],
): Extract<PrecedentApplicabilityResult, { kind: "unresolved" }> {
  return Object.freeze({
    kind: "unresolved",
    reason,
    issues: Object.freeze([...issues].sort(compareCodeUnits)),
  });
}
