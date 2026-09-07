import { deepFreeze } from "./canonical-json";

export type ProposalDiagnosticPath = readonly (string | number)[];
export const PROPOSAL_DIAGNOSTIC_CODES = ["JSON_SYNTAX", "FIELD_MISSING", "TYPE_MISMATCH",
  "VALUE_INVALID", "REFERENCE_UNAVAILABLE", "CONSTRAINT_CONFLICT", "REPAIR_OUT_OF_SCOPE"] as const;
export type ProposalDiagnosticCode = typeof PROPOSAL_DIAGNOSTIC_CODES[number];
export type ProposalDiagnostic = Readonly<{
  code: ProposalDiagnosticCode;
  path?: ProposalDiagnosticPath;
  /** Defaults to the supplied validator draft. Raw parser/transport diagnostics
   * name arguments explicitly; codec-created containers are never raw offsets. */
  pathBase?: "draft" | "arguments" | "rulesInput";
  expected?: unknown;
  actual?: unknown;
  constraint: string;
  location?: Readonly<{ offset: number; line: number; column: number }>;
  repair: Readonly<{ allowed: boolean; reason: string;
    changes?: readonly Readonly<{ path: ProposalDiagnosticPath; operation: "add" | "replace" | "remove"; value?: unknown }>[] }>;
}>;

/** These records are KP-private diagnostics, never a public Viewer result.
 * Callers may describe submitted values or authorized context only. */
export function proposalDiagnostic(code: ProposalDiagnosticCode, constraint: string,
  detail: Omit<Partial<ProposalDiagnostic>, "code" | "constraint"> = {}): ProposalDiagnostic {
  return deepFreeze({ code, constraint,
    repair: { allowed: false, reason: "semantic-equivalence-unproven" }, ...detail });
}

export function diagnosticActual(value: unknown): unknown {
  if (value === undefined) return { type: "missing" };
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value === "object") return { type: "object" };
  return typeof value === "string" && value.length > 512
    ? { type: "string", length: value.length }
    : { type: typeof value, value };
}

/** Fallback retains the authoritative reason; it never invents a path. */
export function diagnosticsFromIssues(code: string, issues: readonly string[]): readonly ProposalDiagnostic[] {
  const category: ProposalDiagnosticCode = code.includes("CORRECTION") || code.includes("REPAIR")
    ? "REPAIR_OUT_OF_SCOPE" : code.includes("REFERENCE") ? "REFERENCE_UNAVAILABLE"
      : code.includes("JSON") ? "JSON_SYNTAX" : "CONSTRAINT_CONFLICT";
  return deepFreeze(issues.map(constraint => proposalDiagnostic(category, constraint)));
}
