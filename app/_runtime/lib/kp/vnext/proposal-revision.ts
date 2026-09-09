import { applyPatch, type Operation } from "rfc6902";
import { canonicalHash, deepFreeze, isPlainRecord, parseJsonWithUniqueMembers, type JsonRecord } from "./canonical-json";
import { diagnosticActual, proposalDiagnostic, type ProposalDiagnostic } from "./proposal-diagnostics";

export class ProposalRevisionError extends Error {
  constructor(readonly diagnostics: readonly ProposalDiagnostic[]) { super("PROPOSAL_REVISION_INVALID"); }
}

export type ProposalRevisionSource = Readonly<{ sourceDraft: Readonly<JsonRecord> | null; sourceDraftVersion: string }>;
export type ProposalRevisionSynthesis = Readonly<{
  sourceDraftVersion: string;
  mode: "patch" | "replaceDraft";
  draft: Readonly<JsonRecord>;
  draftVersion: string;
  /** Private audit diff. Replacement is intentionally one whole-document diff. */
  changes: readonly unknown[];
}>;

/** This version binds the exact source bytes as well as the context. Whitespace
 * changes cannot silently select a different saved response. */
export function proposalSourceDraftVersion(originalArguments: string, contextHash: string): string {
  return canonicalHash({ originalArguments, contextHash });
}

function invalid(constraint: string, path: readonly (string | number)[], expected: unknown, actual?: unknown): never {
  throw new ProposalRevisionError([proposalDiagnostic("REPAIR_OUT_OF_SCOPE", constraint,
    { path, pathBase: "arguments", expected, actual: diagnosticActual(actual) })]);
}

function exact(value: Record<string, unknown>, keys: readonly string[], path: readonly (string | number)[]) {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)))
    invalid("revision:closed-document", path, { required: keys, additionalProperties: false }, value);
}

/** RFC 6902 operates on a disposable copy. Prevalidate pointers because the
 * library deliberately skips prototype tokens and accepts loose array indices;
 * neither behavior is allowed by this protocol. No failed prefix is retained. */
export function synthesizeProposalRevision(argumentsValue: unknown, source: ProposalRevisionSource): ProposalRevisionSynthesis {
  const envelope = typeof argumentsValue === "string" ? parseJsonWithUniqueMembers(argumentsValue) : argumentsValue;
  if (!isPlainRecord(envelope)) invalid("revision:envelope-object", [], "object", envelope);
  exact(envelope, ["sourceDraftVersion", "revisionJson"], []);
  if (envelope.sourceDraftVersion !== source.sourceDraftVersion)
    invalid("revision:source-draft-version-mismatch", ["sourceDraftVersion"], source.sourceDraftVersion, envelope.sourceDraftVersion);
  if (typeof envelope.revisionJson !== "string") invalid("revision:json-string-required", ["revisionJson"], "string", envelope.revisionJson);
  const document = parseJsonWithUniqueMembers(envelope.revisionJson);
  if (!isPlainRecord(document)) invalid("revision:document-object", [], "object", document);
  let draft: unknown, changes: readonly unknown[];
  if (document.mode === "replaceDraft") {
    exact(document, ["mode", "draft"], []);
    draft = structuredClone(document.draft);
    changes = [{ op: "replace", path: "", value: draft }];
  } else if (document.mode === "patch") {
    exact(document, ["mode", "operations"], []);
    if (source.sourceDraft === null) invalid("revision:unparsed-source-requires-replacement", ["mode"], "replaceDraft", document.mode);
    if (!Array.isArray(document.operations)) invalid("revision:operations-array", ["operations"], "array", document.operations);
    draft = structuredClone(source.sourceDraft);
    for (const [index, operation] of document.operations.entries()) {
      const at = ["operations", index];
      if (!isPlainRecord(operation) || !["add", "replace", "remove"].includes(String(operation.op)))
        invalid("revision:operation-not-allowed", at, ["add", "replace", "remove"], operation);
      exact(operation, operation.op === "remove" ? ["op", "path"] : ["op", "path", "value"], at);
      if (typeof operation.path !== "string" || !operation.path.startsWith("/") || /~(?:[^01]|$)/u.test(operation.path))
        invalid("revision:json-pointer-required", [...at, "path"], "RFC 6901 pointer to proposal content", operation.path);
      const parts = operation.path.slice(1).split("/").map(part => part.replaceAll("~1", "/").replaceAll("~0", "~"));
      if (!["decision", "steps", "results"].includes(parts[0]!) || parts.some(part => ["__proto__", "prototype", "constructor"].includes(part)))
        invalid("revision:path-outside-model-content", [...at, "path"], "/decision, /steps or /results", operation.path);
      let parent: unknown = draft;
      for (const [offset, part] of parts.entries()) {
        const last = offset === parts.length - 1;
        if (!Array.isArray(parent) && !isPlainRecord(parent))
          invalid("revision:path-parent-missing", [...at, "path"], "existing object or array parent", operation.path);
        if (Array.isArray(parent) && !(last && operation.op === "add" && part === "-")) {
          const limit = parent.length - (last && operation.op === "add" ? 0 : 1);
          if (!/^(0|[1-9][0-9]*)$/u.test(part) || !Number.isSafeInteger(Number(part)) || Number(part) > limit)
            invalid("revision:array-index-invalid", [...at, "path"], "existing index; add permits length or -", operation.path);
        }
        if ((!last || operation.op !== "add") && !Object.hasOwn(parent, part))
          invalid("revision:path-missing", [...at, "path"], "existing target", operation.path);
        parent = (parent as Record<string, unknown>)[part];
      }
      const errors = applyPatch(draft, [operation as unknown as Operation]);
      if (errors.some(error => error !== null)) invalid("revision:patch-application-failed", at, "applicable operation", operation);
    }
    changes = document.operations;
  } else invalid("revision:mode-invalid", ["mode"], ["patch", "replaceDraft"], document.mode);
  if (!isPlainRecord(draft)) invalid("revision:draft-object", ["draft"], "complete proposal object", draft);
  // A source can contain invalid extra fields. Replacement must remove them;
  // patch never gains access to a server envelope or to context/identity.
  if (Object.keys(draft).some(key => !["decision", "steps", "results"].includes(key)))
    invalid("revision:draft-outside-model-content", ["draft"], ["decision", "steps", "results"], draft);
  const draftVersion = canonicalHash(draft);
  if (source.sourceDraft !== null && draftVersion === canonicalHash(source.sourceDraft))
    invalid("revision:unchanged-draft", [], "a changed draft addressing the diagnostics");
  return deepFreeze({ sourceDraftVersion: source.sourceDraftVersion, mode: document.mode, draft: draft as JsonRecord, draftVersion, changes });
}
