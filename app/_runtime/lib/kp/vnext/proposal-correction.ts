import {
  canonicalClone,
  canonicalHash,
  compareCodeUnits,
  deepFreeze,
  isPlainRecord,
} from "./canonical-json";
import {
  VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA,
  type VNextBundleCorrection,
  type VNextBundleCorrectionPath,
  type VNextProposalBundleCorrectionInput,
  type VNextProposalBundleCorrectionResult,
} from "./proposal-schema";
import type { VNextRequiredContext } from "./required-context";
import { representationRepairPlan } from "./proposal-repair-plan";
import { diagnosticsFromIssues, proposalDiagnostic, type ProposalDiagnostic } from "./proposal-diagnostics";
import { validateVNextProposalBundle } from "./proposal-validator";

const MAX_CHANGES = 8;
const MAX_PATH_DEPTH = 16;

export type VNextProposalRepair = Readonly<{
  path: VNextBundleCorrectionPath;
  operation: "add" | "replace" | "remove";
  /** Absent for a fixed remove or an existing presentation-summary contract. */
  value?: VNextBundleCorrection["changes"][number]["value"];
  reason: string;
}>;

/** Computes permitted edits from the immutable draft, then proves the complete
 * repaired shape using the same validator. No caller-supplied path grants authority. */
export function vnextProposalRepairPlan(bundle: unknown, proofDiagnostics?: ProposalDiagnostic[], originalArguments?: string, requiredContext?: VNextRequiredContext): readonly VNextProposalRepair[] {
  let candidate: unknown;
  try { candidate = canonicalClone(bundle); } catch { return Object.freeze([]); }
  if (!isPlainRecord(candidate)) return Object.freeze([]);
  const paths: VNextBundleCorrectionPath[] = [];
  const addIfInvalid = (path: VNextBundleCorrectionPath, maximum: number, trimmed = true) => {
    const found = valueAtPath(candidate, path);
    if (!found.found || !isValidSummary(found.value, maximum, trimmed)) paths.push(path);
  };
  if (Array.isArray(candidate.proposals)) collectProposalSummaryPaths(candidate.proposals, [], addIfInvalid);
  if (isPlainRecord(candidate.terminal) && candidate.terminal.kind === "clarification"
    && Array.isArray(candidate.terminal.choices)) {
    for (const [choiceIndex, choice] of candidate.terminal.choices.entries()) {
      if (!isPlainRecord(choice) || !isPlainRecord(choice.continuation)
        || choice.continuation.kind !== "adjudication" || !Array.isArray(choice.continuation.proposals)) continue;
      collectProposalSummaryPaths(choice.continuation.proposals,
        ["terminal", "choices", choiceIndex, "continuation"], addIfInvalid);
    }
  }
  const fixed = representationRepairPlan(candidate, paths, proofDiagnostics, originalArguments, requiredContext);
  const plan: VNextProposalRepair[] = [
    ...paths.map(path => ({ path, operation: valueAtPath(candidate, path).found ? "replace" as const : "add" as const,
      reason: "presentation-summary-only" })), ...fixed,
  ];
  if (plan.length < 1 || plan.length > MAX_CHANGES) return Object.freeze([]);
  const proof = canonicalClone(candidate);
  for (const change of plan) {
    if (!replaceExistingPath(proof, change.path, Object.hasOwn(change, "value") ? change.value : "修正后的摘要。", change.operation === "add", change.operation === "remove")) return Object.freeze([]);
  }
  return validateVNextProposalBundle(proof).kind === "accepted" ? deepFreeze(plan) : Object.freeze([]);
}

export function repairableVNextProposalBundlePaths(bundle: unknown, originalArguments?: string, requiredContext?: VNextRequiredContext): readonly VNextBundleCorrectionPath[] {
  return deepFreeze(vnextProposalRepairPlan(bundle, undefined, originalArguments, requiredContext).map(change => change.path));
}

export function vnextProposalRepairDiagnostics(bundle: unknown, diagnostics: readonly ProposalDiagnostic[],
  syntaxProven = false, originalArguments?: string, requiredContext?: VNextRequiredContext): readonly ProposalDiagnostic[] {
  const plan = vnextProposalRepairPlan(bundle, undefined, originalArguments, requiredContext);
  const described = diagnostics.map(diagnostic => {
    if (diagnostic.code === "JSON_SYNTAX" && syntaxProven) return { ...diagnostic,
      repair: { allowed: true, reason: "complete-root-members-frozen", changes: [] } };
    // A proven whole-array replacement also repairs the diagnosed member.
    // Keep the original error location and grant only the exact plan path/value.
    const changes = plan.filter(change => diagnostic.path === undefined
      || pathIdentity(change.path) === pathIdentity(diagnostic.path)
      || (change.operation === "replace" && change.path.length < diagnostic.path.length
        && change.path.every((segment, index) => segment === diagnostic.path![index])));
    return changes.length === 0 ? diagnostic : { ...diagnostic,
      repair: { allowed: true, reason: changes.every(change => change.operation === "remove" || Object.hasOwn(change, "value"))
        ? "complete-bundle-representation-proven" : "presentation-summary-only", changes } };
  });
  // Short-circuit validators need not report later defects. Include every
  // proven edit so the model can repair the entire draft in the single call.
  for (const change of plan) {
    if (described.some(d => d.path !== undefined && pathIdentity(d.path) === pathIdentity(change.path))) continue;
    const original = valueAtPath(bundle, change.path);
    described.push(proposalDiagnostic(change.operation === "add" ? "FIELD_MISSING" : "VALUE_INVALID", change.reason,
      { path: change.path, ...(original.found ? { actual: original.value } : {}),
        ...(change.operation === "remove" ? { expected: "absent; exact frozen input echo is redundant" } : Object.hasOwn(change, "value") ? { expected: change.value } : { expected: "nonempty presentation summary of the frozen operations" }),
        repair: { allowed: true, reason: change.operation === "remove" || Object.hasOwn(change, "value")
          ? "complete-bundle-representation-proven" : "presentation-summary-only", changes: [change] } }));
  }
  return deepFreeze(described);
}

/**
 * Applies the single permitted sparse repair without trusting a partial
 * validation result. The consumer must lower and Rules-preflight the returned
 * full Bundle again from the beginning.
 */
export function applyVNextProposalBundleCorrection(
  input: VNextProposalBundleCorrectionInput,
): VNextProposalBundleCorrectionResult {
  let original: unknown;
  try {
    original = canonicalClone(input.bundle);
  } catch {
    return rejected("PROPOSAL_CORRECTION_INVALID", ["correction:base-bundle-not-json"]);
  }
  if (!isPlainRecord(original)) {
    return rejected("PROPOSAL_CORRECTION_INVALID", ["correction:base-bundle-invalid"]);
  }
  if (!isPlainRecord(input.correction)
    || !exactKeys(input.correction, [
      "attempt", "baseBundleHash", "changes", "contextHash", "schema",
    ])
    || input.correction.schema !== VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA
    || input.correction.attempt !== 1
    || input.correction.baseBundleHash !== canonicalHash(original)
    || input.correction.contextHash !== input.requiredContext.binding.contextHash
    || !Array.isArray(input.correction.changes)
    || input.correction.changes.length > MAX_CHANGES
    || !validAllowedPaths(input.allowedPaths)) {
    return rejected("PROPOSAL_CORRECTION_INVALID", ["correction:envelope-invalid"]);
  }

  const plan = vnextProposalRepairPlan(original, undefined, input.originalArguments, input.requiredContext);
  if (plan.length === 0 || canonicalHash(plan.map(change => change.path)) !== canonicalHash(input.allowedPaths)
    || (input.correction.changes.length === 0 && !plan.every(change => change.operation === "remove"))) {
    return rejected("PROPOSAL_CORRECTION_INVALID", ["correction:allowlist-not-proven"]);
  }
  const allowed = new Map(plan.map(change => [pathIdentity(change.path), change]));
  const seen = new Set<string>();
  const merged = canonicalClone(original) as unknown;
  // Deletions are fixed server operations, never supplied by the model.
  for (const change of plan.filter(change => change.operation === "remove")) {
    if (!replaceExistingPath(merged, change.path, undefined, false, true)) {
      return rejected("PROPOSAL_CORRECTION_INVALID", ["correction:path-not-found"]);
    }
    seen.add(pathIdentity(change.path));
  }
  for (const change of input.correction.changes) {
    if (!isPlainRecord(change)
      || !exactKeys(change, ["path", "value"])
      || !isCorrectionPath(change.path)) {
      return rejected("PROPOSAL_CORRECTION_INVALID", ["correction:change-invalid"]);
    }
    const identity = pathIdentity(change.path);
    const permission = allowed.get(identity);
    if (!permission || seen.has(identity)) {
      return rejected("PROPOSAL_CORRECTION_INVALID", ["correction:path-not-allowed"], [proposalDiagnostic("REPAIR_OUT_OF_SCOPE", "correction:path-not-allowed", { path: change.path,
        repair: { allowed: false, reason: "path-not-in-server-proven-plan" } })]);
    }
    const fixedValue = Object.hasOwn(permission, "value");
    let matches = false;
    try { matches = fixedValue ? canonicalHash(change.value) === canonicalHash(permission.value) : typeof change.value === "string"; } catch { /* invalid JSON cannot match */ }
    if (!matches) return rejected("PROPOSAL_CORRECTION_INVALID", ["correction:replacement-not-proven"],
      [proposalDiagnostic("REPAIR_OUT_OF_SCOPE", "correction:replacement-not-proven", { path: change.path,
        ...(fixedValue ? { expected: permission.value } : {}), repair: { allowed: false, reason: "replacement-changes-frozen-semantics" } })]);
    seen.add(identity);
    if (!replaceExistingPath(merged, change.path, change.value, permission.operation === "add")) {
      return rejected("PROPOSAL_CORRECTION_INVALID", ["correction:path-not-found"]);
    }
  }

  const validated = validateVNextProposalBundle(merged);
  if (validated.kind === "rejected") {
    return rejected("PROPOSAL_REPAIR_EXHAUSTED", validated.issues, validated.diagnostics);
  }
  return Object.freeze({
    kind: "accepted",
    bundle: deepFreeze(validated.bundle),
    bundleHash: canonicalHash(validated.bundle),
  });
}

function validAllowedPaths(value: readonly VNextBundleCorrectionPath[]): boolean {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CHANGES) return false;
  const identities = new Set<string>();
  return value.every((path) => {
    if (!isCorrectionPath(path)) return false;
    const identity = pathIdentity(path);
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
}

function isCorrectionPath(value: unknown): value is VNextBundleCorrectionPath {
  return Array.isArray(value)
    && value.length >= 1
    && value.length <= MAX_PATH_DEPTH
    && value.every((segment) => (typeof segment === "string"
      && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(segment))
      || (Number.isSafeInteger(segment) && Number(segment) >= 0));
}

function collectProposalSummaryPaths(
  proposals: readonly unknown[],
  prefix: VNextBundleCorrectionPath,
  addIfInvalid: (path: VNextBundleCorrectionPath, maximum: number, trimmed?: boolean) => void,
): void {
  for (const [proposalIndex, proposal] of proposals.entries()) {
    if (!isPlainRecord(proposal)) continue;
    const proposalPath = [...prefix, "proposals", proposalIndex] as const;
    if (["materializeObject", "reviseSemanticDefinition", "materializeDefinition", "materializeItem", "inventoryOperation"].includes(String(proposal.kind))) {
      addIfInvalid([...proposalPath, "summary"], 2_000);
    }
    if (!["worldInteraction", "observe", "social"].includes(String(proposal.kind)) || !isPlainRecord(proposal.branches)) continue;
    for (const branchName of ["success", "failure"] as const) {
      const branch = proposal.branches[branchName];
      if (!isPlainRecord(branch)) continue;
      // Social's existing source contract permits whitespace in summaries.
      // Other branches require canonical text; an all-blank summary is empty.
      addIfInvalid([...proposalPath, "branches", branchName, "summary"], 4_000, proposal.kind !== "social");
      if (proposal.kind !== "worldInteraction" || !Array.isArray(branch.effects)) continue;
      for (const [effectIndex, effect] of branch.effects.entries()) {
        if (!isPlainRecord(effect) || effect.kind !== "definitionRevision") continue;
        addIfInvalid([
          ...proposalPath, "branches", branchName,
          "effects", effectIndex, "summary",
        ], 2_000);
      }
    }
  }
}

function replaceExistingPath(
  root: unknown,
  path: VNextBundleCorrectionPath,
  value: unknown,
  allowAdd = false,
  remove = false,
): boolean {
  let parent = root;
  for (const segment of path.slice(0, -1)) {
    if (typeof segment === "number") {
      if (!Array.isArray(parent) || segment >= parent.length) return false;
      parent = parent[segment];
    } else {
      if (!isPlainRecord(parent) || !Object.hasOwn(parent, segment)) return false;
      parent = parent[segment];
    }
  }
  const leaf = path.at(-1)!;
  if (typeof leaf === "number") {
    if (remove || !Array.isArray(parent) || leaf >= parent.length) return false;
    parent[leaf] = value;
    return true;
  }
  // The plan proves additions only for inactive branches or summary leaves.
  // Parent objects always have to exist in the original draft.
  if (!isPlainRecord(parent) || (!Object.hasOwn(parent, leaf) && !allowAdd)) return false;
  if (remove) delete parent[leaf];
  else parent[leaf] = value;
  return true;
}

function valueAtPath(
  root: unknown,
  path: VNextBundleCorrectionPath,
): { found: true; value: unknown } | { found: false } {
  let value = root;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(value) || segment >= value.length) return { found: false };
      value = value[segment];
    } else {
      if (!isPlainRecord(value) || !(segment in value)) return { found: false };
      value = value[segment];
    }
  }
  return { found: true, value };
}

function isValidSummary(value: unknown, maximum: number, trimmed: boolean): value is string {
  return typeof value === "string"
    && value.length > 0
    && (!trimmed || value.trim().length > 0)
    && value.length <= maximum
    && value.normalize("NFC") === value;
}

function pathIdentity(path: VNextBundleCorrectionPath): string {
  return JSON.stringify(path);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareCodeUnits);
  const sorted = [...expected].sort(compareCodeUnits);
  return actual.length === sorted.length
    && actual.every((key, index) => key === sorted[index]);
}

function rejected(
  code: Extract<VNextProposalBundleCorrectionResult, { kind: "rejected" }>["code"],
  issues: readonly string[],
  diagnostics: readonly ProposalDiagnostic[] = diagnosticsFromIssues(code, issues),
): Extract<VNextProposalBundleCorrectionResult, { kind: "rejected" }> {
  return Object.freeze({
    kind: "rejected",
    code,
    diagnostics,
    issues: Object.freeze([...new Set(issues)].sort(compareCodeUnits)),
  });
}
