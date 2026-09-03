import {
  canonicalClone,
  canonicalHash,
  compareCodeUnits,
  deepFreeze,
  isPlainRecord,
} from "./canonical-json";
import {
  VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA,
  type VNextBundleCorrectionPath,
  type VNextProposalBundleCorrectionInput,
  type VNextProposalBundleCorrectionResult,
} from "./proposal-schema";
import { validateVNextProposalBundle } from "./proposal-validator";

const MAX_CHANGES = 8;
const MAX_PATH_DEPTH = 16;

/** Returns a repair allowlist only when invalid presentation summaries are
 * the complete reason the decoded Bundle fails local validation. */
export function repairableVNextProposalBundlePaths(
  bundle: unknown,
): readonly VNextBundleCorrectionPath[] {
  let candidate: unknown;
  try {
    candidate = canonicalClone(bundle);
  } catch {
    return Object.freeze([]);
  }
  if (!isPlainRecord(candidate) || !Array.isArray(candidate.proposals)) {
    return Object.freeze([]);
  }
  const paths: VNextBundleCorrectionPath[] = [];
  const addIfInvalid = (path: VNextBundleCorrectionPath, maximum: number) => {
    const value = valueAtPath(candidate, path);
    if (value.found && !isValidSummary(value.value, maximum)) paths.push(path);
  };
  collectProposalSummaryPaths(candidate.proposals, [], addIfInvalid);
  if (isPlainRecord(candidate.terminal)
    && candidate.terminal.kind === "clarification"
    && Array.isArray(candidate.terminal.choices)) {
    for (const [choiceIndex, choice] of candidate.terminal.choices.entries()) {
      if (!isPlainRecord(choice)
        || !isPlainRecord(choice.continuation)
        || choice.continuation.kind !== "adjudication"
        || !Array.isArray(choice.continuation.proposals)) continue;
      collectProposalSummaryPaths(
        choice.continuation.proposals,
        ["terminal", "choices", choiceIndex, "continuation"],
        addIfInvalid,
      );
    }
  }
  if (paths.length < 1 || paths.length > MAX_CHANGES) return Object.freeze([]);
  const proof = canonicalClone(candidate) as unknown;
  for (const path of paths) {
    if (!replaceExistingPath(proof, path, "修正后的摘要。")) return Object.freeze([]);
  }
  if (validateVNextProposalBundle(proof).kind !== "accepted") return Object.freeze([]);
  return deepFreeze(paths.map((path) => [...path]));
}

/**
 * Applies the single permitted sparse repair without trusting a partial
 * validation result. A caller that later enables the consumer must lower and
 * Rules-preflight the returned full Bundle again from the beginning.
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
    || input.correction.changes.length < 1
    || input.correction.changes.length > MAX_CHANGES
    || !validAllowedPaths(input.allowedPaths)) {
    return rejected("PROPOSAL_CORRECTION_INVALID", ["correction:envelope-invalid"]);
  }

  const allowed = new Set(input.allowedPaths.map(pathIdentity));
  const seen = new Set<string>();
  const merged = canonicalClone(original) as unknown;
  for (const change of input.correction.changes) {
    if (!isPlainRecord(change)
      || !exactKeys(change, ["path", "value"])
      || !isCorrectionPath(change.path)
      || !repairablePath(change.path)) {
      return rejected("PROPOSAL_CORRECTION_INVALID", ["correction:change-invalid"]);
    }
    const identity = pathIdentity(change.path);
    if (!allowed.has(identity) || seen.has(identity) || typeof change.value !== "string") {
      return rejected("PROPOSAL_CORRECTION_INVALID", ["correction:path-not-allowed"]);
    }
    seen.add(identity);
    if (!replaceExistingPath(merged, change.path, change.value)) {
      return rejected("PROPOSAL_CORRECTION_INVALID", ["correction:path-not-found"]);
    }
  }

  const validated = validateVNextProposalBundle(merged);
  if (validated.kind === "rejected") {
    return rejected("PROPOSAL_REPAIR_EXHAUSTED", validated.issues);
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
    if (!isCorrectionPath(path) || !repairablePath(path)) return false;
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

/** Repairs are presentation-only. Authority bindings, rulings, branches,
 * effects and materialized semantics remain frozen even if a caller supplies
 * an over-broad diagnostic allowlist. */
function repairablePath(path: VNextBundleCorrectionPath): boolean {
  const proposalOffset = path[0] === "proposals"
    ? 0
    : path[0] === "terminal"
      && path[1] === "choices"
      && typeof path[2] === "number"
      && path[3] === "continuation"
      && path[4] === "proposals"
      ? 4
      : -1;
  if (proposalOffset < 0 || typeof path[proposalOffset + 1] !== "number") return false;
  if (path.length === proposalOffset + 3 && path[proposalOffset + 2] === "summary") {
    return true;
  }
  if (path.length === proposalOffset + 5
    && path[proposalOffset + 2] === "branches"
    && (path[proposalOffset + 3] === "success"
      || path[proposalOffset + 3] === "failure")
    && path[proposalOffset + 4] === "summary") return true;
  return path.length === proposalOffset + 7
    && path[proposalOffset + 2] === "branches"
    && (path[proposalOffset + 3] === "success"
      || path[proposalOffset + 3] === "failure")
    && path[proposalOffset + 4] === "effects"
    && typeof path[proposalOffset + 5] === "number"
    && path[proposalOffset + 6] === "summary";
}

function collectProposalSummaryPaths(
  proposals: readonly unknown[],
  prefix: VNextBundleCorrectionPath,
  addIfInvalid: (path: VNextBundleCorrectionPath, maximum: number) => void,
): void {
  for (const [proposalIndex, proposal] of proposals.entries()) {
    if (!isPlainRecord(proposal)) continue;
    const proposalPath = [...prefix, "proposals", proposalIndex] as const;
    if (proposal.kind === "materializeObject" || proposal.kind === "reviseSemanticDefinition") {
      addIfInvalid([...proposalPath, "summary"], 2_000);
    }
    if (proposal.kind !== "worldInteraction" || !isPlainRecord(proposal.branches)) continue;
    for (const branchName of ["success", "failure"] as const) {
      const branch = proposal.branches[branchName];
      if (!isPlainRecord(branch)) continue;
      addIfInvalid([...proposalPath, "branches", branchName, "summary"], 4_000);
      if (!Array.isArray(branch.effects)) continue;
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
): boolean {
  let parent = root;
  for (const segment of path.slice(0, -1)) {
    if (typeof segment === "number") {
      if (!Array.isArray(parent) || segment >= parent.length) return false;
      parent = parent[segment];
    } else {
      if (!isPlainRecord(parent) || !(segment in parent)) return false;
      parent = parent[segment];
    }
  }
  const leaf = path.at(-1)!;
  if (typeof leaf === "number") {
    if (!Array.isArray(parent) || leaf >= parent.length) return false;
    parent[leaf] = value;
    return true;
  }
  if (!isPlainRecord(parent) || !(leaf in parent)) return false;
  parent[leaf] = value;
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

function isValidSummary(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && value.trim() === value
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
): Extract<VNextProposalBundleCorrectionResult, { kind: "rejected" }> {
  return Object.freeze({
    kind: "rejected",
    code,
    issues: Object.freeze([...new Set(issues)].sort(compareCodeUnits)),
  });
}
