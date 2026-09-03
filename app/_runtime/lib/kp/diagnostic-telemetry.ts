import {
  KP_FORM_IDS,
  buildKpFormToolParameters,
  type KpFormId,
} from "./form-catalog";

/**
 * Field-level telemetry for a proposal that never committed.
 *
 * Production records `errorCode` and `failureClass`, which is enough to say
 * "the repair was exhausted" and nothing at all about *what* the model got
 * wrong. D1 only stores committed events, so an uncommitted proposal leaves
 * no trace to go back to, and the highest-frequency failure cannot be named.
 *
 * The obstacle is that a raw diagnostic is not safe to log. A Rules error
 * reads `draft.desiredResponse.evidenceRefs:fact:9f3…:not-authoritative` —
 * the middle carries a real world reference, and `<field>:unknown-phase:<name>`
 * carries a model-authored phase name in the trailing position, so neither
 * "drop the last segment" nor "drop the middle" is a safe rule on its own.
 *
 * This module keeps only tokens drawn from a closed vocabulary the server
 * already owns: the schema field names, the structural prefixes, and the
 * diagnostic codes. Every other token is discarded without being inspected,
 * so a reference, a phase name, a player utterance or anything else a future
 * diagnostic starts interpolating cannot reach telemetry by default.
 */

/** Diagnostic codes the Form validator, envelope and Rules boundary emit. */
export const KP_DIAGNOSTIC_CODES: readonly string[] = Object.freeze([
  "absent-feature-forbidden",
  "area-hazard-required",
  "arguments-invalid",
  "array-required",
  "attack-required",
  "authority-field-forbidden",
  "cardinality-mismatch",
  "changed",
  "check-required",
  "direct-forbidden",
  "duplicate",
  "duplicate-identity",
  "environment-check-required",
  "environment-required",
  "established-definition-forbidden",
  "exceeds-object-hit-points",
  "form-upgrade-forbidden",
  "hash-mismatch",
  "identity-already-authoritative",
  "json-parse-failed",
  "not-allowed",
  "not-authoritative",
  "object-required",
  "pair-required",
  "phase-cardinality-mismatch",
  "required",
  "scene-observers",
  "self-transition",
  "single-tool-required",
  "state-only-forbidden",
  "stunt-required",
  "tool-switch-forbidden",
  "type-invalid",
  "unknown-field",
  "unknown-phase",
  "unproven",
]);

/** Structural prefixes that are part of the diagnostic grammar, not content. */
const STRUCTURAL_TOKENS: readonly string[] = Object.freeze([
  "$",
  "draft",
  "repair",
  "semantic-freeze",
  "structured-output",
  "tool",
  "visibility",
]);

/**
 * Names inside the typed JSON payloads a draft carries as a *string* field.
 * The Form schema models `desiredResponse` as text, so its members are not in
 * the catalog, yet diagnostics address them by name
 * (`draft.desiredResponse.evidenceRefs:<ref>:not-authoritative`). They are
 * server-authored contract names, not content, and only the ones that appear
 * literally in a diagnostic template are listed — anything else truncates.
 */
const TYPED_PAYLOAD_TOKENS: readonly string[] = Object.freeze([
  "addressedThreadRef",
  "assertion",
  "bindings",
  "evidenceRefs",
  "object",
]);

const CODE_SET = new Set(KP_DIAGNOSTIC_CODES);

/**
 * Every field name any Form can carry, read from the catalog so the
 * vocabulary cannot drift away from the schemas it describes.
 */
function catalogFieldNames(): ReadonlySet<string> {
  const names = new Set<string>([...STRUCTURAL_TOKENS, ...TYPED_PAYLOAD_TOKENS]);
  const collect = (schema: unknown): void => {
    if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return;
    const node = schema as Record<string, unknown>;
    const properties = node.properties;
    if (properties !== null && typeof properties === "object" && !Array.isArray(properties)) {
      for (const [key, child] of Object.entries(properties)) {
        names.add(key);
        collect(child);
      }
    }
    if (node.items !== undefined) collect(node.items);
    for (const key of ["anyOf", "allOf", "oneOf"]) {
      const branches = node[key];
      if (Array.isArray(branches)) for (const branch of branches) collect(branch);
    }
  };
  for (const formId of KP_FORM_IDS) collect(buildKpFormToolParameters(formId));
  return names;
}

const FIELD_NAMES = catalogFieldNames();

export const KP_DIAGNOSTIC_UNRECOGNIZED_PATH = "unrecognized" as const;
export const KP_DIAGNOSTIC_OTHER_CODE = "other" as const;

/** `evidenceRefs[3]` and `evidenceRefs` describe the same field. */
function normalizeIndex(token: string): string {
  return token.replace(/\[\d+\]/gu, "[]");
}

function isSafeToken(token: string): boolean {
  const bare = normalizeIndex(token).replace(/\[\]$/u, "");
  return FIELD_NAMES.has(bare);
}

/**
 * Keeps the longest prefix of a dotted path whose every part is a known
 * field, and drops the rest. Truncating rather than rejecting means a
 * diagnostic that reaches into an unmodelled payload still reports the field
 * it started from, while a model-authored key is never echoed back — the
 * useful half survives and the unsafe half cannot.
 */
function safePath(token: string): string | undefined {
  const parts = token.split(".");
  const safe: string[] = [];
  for (const part of parts) {
    if (!isSafeToken(part)) break;
    safe.push(normalizeIndex(part));
  }
  return safe.length === 0 ? undefined : safe.join(".");
}

export type KpDiagnosticField = Readonly<{
  path: string;
  code: string;
}>;

/**
 * Reduces one diagnostic string to the field it names and the rule it broke.
 * Tokens outside the closed vocabulary are dropped, never emitted, so an
 * unfamiliar diagnostic degrades to `unrecognized`/`other` rather than
 * leaking whatever it interpolated.
 */
export function desensitizeKpDiagnostic(value: unknown): KpDiagnosticField {
  if (typeof value !== "string") {
    return Object.freeze({
      path: KP_DIAGNOSTIC_UNRECOGNIZED_PATH,
      code: KP_DIAGNOSTIC_OTHER_CODE,
    });
  }
  const segments = value.split(":");
  const code = segments.find((segment) => CODE_SET.has(segment)) ?? KP_DIAGNOSTIC_OTHER_CODE;
  const path = segments
    .filter((segment) => !CODE_SET.has(segment))
    .map(safePath)
    .find((candidate) => candidate !== undefined) ?? KP_DIAGNOSTIC_UNRECOGNIZED_PATH;
  return Object.freeze({ path, code });
}

/** Bounded, de-duplicated, ordered field view of a whole diagnostic set. */
export function desensitizeKpDiagnostics(
  values: unknown,
  limit = 8,
): readonly KpDiagnosticField[] {
  if (!Array.isArray(values)) return Object.freeze([]);
  const seen = new Map<string, KpDiagnosticField>();
  for (const value of values) {
    const field = desensitizeKpDiagnostic(value);
    const key = `${field.path}:${field.code}`;
    if (!seen.has(key)) seen.set(key, field);
  }
  return Object.freeze(
    [...seen.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .slice(0, limit)
      .map(([, field]) => field),
  );
}

export type KpProposalFailureTelemetry = Readonly<{
  proposalFormId: KpFormId | undefined;
  repairUsed: boolean | undefined;
  diagnosticFields: readonly KpDiagnosticField[];
}>;

/**
 * The structured view of a failed proposal: which Form was being filled,
 * whether the one narrow repair had already been spent, and which fields
 * broke which rules. Together these name the highest-frequency failure that
 * `PROPOSAL_REPAIR_EXHAUSTED` alone cannot.
 */
export function kpProposalFailureTelemetry(input: Readonly<{
  formId?: unknown;
  repairUsed?: unknown;
  diagnostics?: unknown;
}>): KpProposalFailureTelemetry {
  const formId = typeof input.formId === "string"
    && (KP_FORM_IDS as readonly string[]).includes(input.formId)
    ? input.formId as KpFormId
    : undefined;
  return Object.freeze({
    proposalFormId: formId,
    repairUsed: typeof input.repairUsed === "boolean" ? input.repairUsed : undefined,
    diagnosticFields: desensitizeKpDiagnostics(input.diagnostics),
  });
}
