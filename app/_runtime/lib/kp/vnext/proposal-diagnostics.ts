import { deepFreeze, isPlainRecord } from "./canonical-json";

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
  /** Private lowering provenance; omitted from the model-facing diagnostic. */
  authorityPath?: ProposalDiagnosticPath;
  expected?: unknown;
  actual?: unknown;
  constraint: string;
  location?: Readonly<{ offset: number; line: number; column: number }>;
  repair: Readonly<{ allowed: boolean; reason: string }>;
}>;

/** These records are KP-private diagnostics, never a public Viewer result.
 * Callers may describe submitted values or authorized context only. */
export function proposalDiagnostic(code: ProposalDiagnosticCode, constraint: string,
  detail: Omit<Partial<ProposalDiagnostic>, "code" | "constraint"> = {}): ProposalDiagnostic {
  return deepFreeze({ code, constraint,
    repair: { allowed: false, reason: "revision-requires-room-admission" }, ...detail });
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

/** Preserve Rules diagnostics for the same private proposal revision protocol.
 * This mapping grants no invocation; Room separately proves its rejection. */
export function authorityProposalDiagnostics(value: unknown): readonly ProposalDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(diagnostic => {
    if (!isPlainRecord(diagnostic) || typeof diagnostic.code !== "string") return [];
    const code = (PROPOSAL_DIAGNOSTIC_CODES as readonly string[]).includes(diagnostic.code)
      ? diagnostic.code as ProposalDiagnosticCode : "CONSTRAINT_CONFLICT";
    const constraint = [diagnostic.constraint, diagnostic.message, diagnostic.rulesMessage,
      diagnostic.publicPath, diagnostic.code].find(value => typeof value === "string" && value.length > 0) as string;
    let position: Pick<ProposalDiagnostic, "path" | "pathBase"> = {};
    if (typeof diagnostic.path === "string" && diagnostic.path.startsWith("/")
      && !/~(?:[^01]|$)/u.test(diagnostic.path)) {
      position = { pathBase: "rulesInput", path: diagnostic.path.slice(1).split("/")
        .map(part => part.replaceAll("~1", "/").replaceAll("~0", "~")) };
    } else if (Array.isArray(diagnostic.path) && diagnostic.path.every(part => typeof part === "string"
      || (Number.isSafeInteger(part) && Number(part) >= 0))) {
      position = { path: [...diagnostic.path] as (string | number)[],
        ...(diagnostic.pathBase === "arguments" || diagnostic.pathBase === "rulesInput"
          ? { pathBase: diagnostic.pathBase } : { pathBase: "draft" }) };
    }
    return [proposalDiagnostic(code, constraint, { ...position,
      ...(Array.isArray(diagnostic.authorityPath) ? { authorityPath: structuredClone(diagnostic.authorityPath) as ProposalDiagnosticPath } : {}),
      ...(diagnostic.expected === undefined ? {} : { expected: structuredClone(diagnostic.expected) }),
      ...(diagnostic.actual === undefined ? {} : { actual: structuredClone(diagnostic.actual) }),
    })];
  });
}
