import { canonicalClone, canonicalHash, deepFreeze, isPlainRecord, parseJsonWithNumberTokens, completeJsonObjectSyntaxEvidence } from "./canonical-json";
import { decodeVNextStrictToolBundle, VNEXT2_PROPOSAL_BUNDLE_SCHEMA, type VNextBundleCorrection, type VNextBundleReference } from "./proposal-schema";
import { validateVNextProposalBundle } from "./proposal-validator";
import { proposalDecisionFieldArgumentPath } from "./proposal-filling-interface";
import type { VNextRequiredContext } from "./required-context";
import type { ProposalDiagnostic } from "./proposal-diagnostics";

type Path = readonly (string | number)[];
export type VNextRepresentationRepair = Readonly<{
  path: Path;
  operation: "add" | "replace" | "remove";
  value?: VNextBundleCorrection["changes"][number]["value"];
  reason: string;
}>;

const MAX_CHANGES = 8;
const SUMMARY_ENTRIES = new Set([
  "materializeObject", "reviseSemanticDefinition", "materializeDefinition", "materializeItem", "inventoryOperation",
]);
const BRANCH_ENTRIES = new Set(["worldInteraction", "observe", "social"]);

/** Proves only fixed representation changes to an already selected proposal.
 * The full validator remains the sole acceptance authority. Summary paths are
 * placeholders for the caller's existing presentation repair, never changes
 * returned by this module or permission to supply missing mechanics. */
export function representationRepairPlan(
  bundle: unknown,
  presentationalPaths: readonly Path[] = [],
  proofDiagnostics?: ProposalDiagnostic[],
  originalArguments?: string,
  requiredContext?: VNextRequiredContext,
): readonly VNextRepresentationRepair[] {
  try {
    // The current draft/journal identity uses canonical JSON. A noncanonical
    // draft cannot enter repair before that binding contract supports it.
    const proof: unknown = canonicalClone(bundle);
    if (!isPlainRecord(proof) || !Array.isArray(presentationalPaths)
      || presentationalPaths.length > MAX_CHANGES) return Object.freeze([]);
    const durationTokens = originalDurationIntegers(bundle, originalArguments);
    const repairs: VNextRepresentationRepair[] = [];
    const change = (parent: Record<string, unknown>, path: Path, key: string,
      value: VNextRepresentationRepair["value"], reason: string) => {
      repairs.push({ path: [...path, key], operation: Object.hasOwn(parent, key) ? "replace" : "add", value, reason });
      parent[key] = value;
    };
    const refs = (parent: Record<string, unknown>, path: Path, key: string) => {
      const original = parent[key];
      if (!Array.isArray(original) || !original.every(value => typeof value === "string")) return;
      const unique = [...new Set(original)] as string[];
      if (unique.length !== original.length) change(parent, path, key, unique, "reference-set-duplicates");
    };
    const proposals = (value: unknown, path: Path, ruling: unknown): void => {
      if (!Array.isArray(value)) return;
      for (const [index, entry] of value.entries()) {
        if (!isPlainRecord(entry)) continue;
        const entryPath = [...path, index];
        refs(entry, entryPath, "basisRefs");
        const durationToken = durationTokens.get(JSON.stringify([...entryPath, "durationMicros"]));
        if (entry.kind === "formActorPlan" && durationToken !== undefined) change(entry, entryPath,
          "durationMicros", durationToken, "exact-integer-token-to-string");
        // consumes declares dependency membership, not quantity. Remove only
        // byte-equivalent canonical records; full validation below proves the
        // remaining references and graph. Never deduplicate producers.
        if (Array.isArray(entry.consumes) && entry.consumes.every(isPlainRecord)) {
          const seen = new Set<string>();
          const unique = entry.consumes.filter(reference => {
            const identity = canonicalHash(reference);
            if (seen.has(identity)) return false;
            seen.add(identity); return true;
          });
          if (unique.length !== entry.consumes.length) change(entry, entryPath, "consumes",
            unique as VNextBundleReference[], "reference-set-duplicates");
        }
        if (entry.kind === "worldInteraction") {
          for (const field of ["targetRefs", "directTargetRefs", "instrumentRefs"]) refs(entry, entryPath, field);
        } else if (entry.kind === "observe") {
          for (const field of ["focusRefs", "existingFactRefs"]) refs(entry, entryPath, field);
        } else if (entry.kind === "materializeObject" && isPlainRecord(entry.definition)) {
          refs(entry.definition, [...entryPath, "definition"], "mechanicDefinitionRefs");
        }
        if (entry.kind === "social" && isPlainRecord(entry.retryChange)) refs(entry.retryChange, [...entryPath, "retryChange"], "basisRefs");
        if (!BRANCH_ENTRIES.has(String(entry.kind)) || !isPlainRecord(entry.branches)) continue;
        const branchPath = [...entryPath, "branches"];
        if (isPlainRecord(ruling) && !Object.hasOwn(entry.branches, "failure")
          && (ruling.kind === "directSuccess" || (ruling.kind === "check"
            && (entry.outcomeBinding === "onSuccess" || entry.outcomeBinding === "onFailure")))) {
          // A conditional consequence cannot own the shared check. The full
          // validator below must still prove its existing complete owner.
          change(entry.branches, branchPath, "failure", null, "inactive-direct-success-branch");
        }
        for (const branchName of ["success", "failure"]) {
          const branch = entry.branches[branchName];
          if (!isPlainRecord(branch)) continue;
          for (const field of ["sensoryEvidence", "pressures", "opportunities"]) {
            const entries = branch[field];
            if (!Array.isArray(entries)) continue;
            entries.forEach((entry, index) => {
              if (isPlainRecord(entry)) refs(entry, [...branchPath, branchName, field, index], "basisRefs");
            });
          }
        }
      }
    };
    const refusal = (value: Record<string, unknown>, path: Path) => {
      if (!isPlainRecord(value.ruling) || !Array.isArray(value.ruling.nextActions)) return;
      value.ruling.nextActions.forEach((entry, index) => {
        if (isPlainRecord(entry)) refs(entry, [...path, "ruling", "nextActions", index], "basisRefs");
      });
    };
    refs(proof, [], "basisRefs");
    if (proof.mode === "adjudication") {
      if (!Object.hasOwn(proof, "terminal")) change(proof, [], "terminal", null, "inactive-bundle-branch");
      proposals(proof.proposals, ["proposals"], proof.adjudication);
    } else if (proof.mode === "terminal") {
      if (!Object.hasOwn(proof, "adjudication")) change(proof, [], "adjudication", null, "inactive-bundle-branch");
      if (!Object.hasOwn(proof, "proposals")) change(proof, [], "proposals", [], "inactive-bundle-branch");
      const terminal = proof.terminal;
      if (isPlainRecord(terminal)) {
        const durationToken = durationTokens.get(JSON.stringify(["terminal", "durationMicros"]));
        if (terminal.kind === "passTime" && durationToken !== undefined) change(terminal, ["terminal"],
          "durationMicros", durationToken, "exact-integer-token-to-string");
        if (terminal.kind === "knowledgeReview") refs(terminal, ["terminal"], "knowledgeRefs");
        if (terminal.kind === "inWorldRefusal") refusal(terminal, ["terminal"]);
        if (terminal.kind === "clarification" && Array.isArray(terminal.choices)) {
          terminal.choices.forEach((choice, index) => {
            if (!isPlainRecord(choice)) return;
            const path = ["terminal", "choices", index];
            refs(choice, path, "basisRefs");
            const continuation = choice.continuation;
            if (!isPlainRecord(continuation)) return;
            const continuationPath = [...path, "continuation"];
            refs(continuation, continuationPath, "basisRefs");
            if (continuation.kind === "adjudication") proposals(continuation.proposals, [...continuationPath, "proposals"], continuation.adjudication);
            if (continuation.kind === "inWorldRefusal") refusal(continuation, continuationPath);
          });
        }
      }
    }
    if (repairs.length + presentationalPaths.length > MAX_CHANGES) return Object.freeze([]);
    const summaryIds = new Set<string>();
    for (const path of presentationalPaths) {
      if (!summaryPath(proof, path) || summaryIds.has(JSON.stringify(path))) return Object.freeze([]);
      summaryIds.add(JSON.stringify(path));
      const parent = atPath(proof, path.slice(0, -1));
      if (!isPlainRecord(parent)) return Object.freeze([]);
      parent.summary = "修正后的摘要。";
    }
    // Discover text repairs from the actual validator, not from field names:
    // authored descriptions and NPC explanations may legally retain spaces.
    // Each pass fixes one diagnosed leaf; at most eight edits plus final proof.
    for (;;) {
      const validation = validateVNextProposalBundle(proof);
      if (validation.kind === "accepted") return deepFreeze(repairs);
      // A failed full proof may reveal the actual refusal behind an earlier
      // formatting error. Retain only locations untouched by tentative edits;
      // never report a placeholder or a shifted array member as the raw draft.
      if (proofDiagnostics) for (const detail of validation.diagnostics ?? []) {
        const path = detail.path;
        if (!path || [...repairs.map(repair => repair.path), ...presentationalPaths].some(changed =>
          path.slice(0, Math.min(path.length, changed.length)).every((part, index) => part === changed[index]))) continue;
        proofDiagnostics.push(detail);
      }
      if (repairs.length + presentationalPaths.length >= MAX_CHANGES) return Object.freeze([]);
      const echoDiagnostic = validation.diagnostics?.find(detail => detail.code === "VALUE_INVALID"
        && detail.constraint === "closed-object-additional-field" && detail.path?.at(-1) === "intent"
        && proposalDecisionFieldArgumentPath(bundle, detail.path) !== undefined);
      if (echoDiagnostic?.path) {
        const path = echoDiagnostic.path, echo = atPath(proof, path), frozen = requiredContext?.intent;
        const fields = ["actorRef", "submissionRef", "text"] as const;
        if (isPlainRecord(echo) && isPlainRecord(frozen) && Object.keys(echo).length === fields.length
          && fields.every(field => Object.hasOwn(echo, field) && typeof echo[field] === "string" && echo[field] === frozen[field])) {
          const parent = atPath(proof, path.slice(0, -1));
          if (!isPlainRecord(parent)) return Object.freeze([]);
          delete parent.intent;
          repairs.push({ path, operation: "remove", reason: "exact-frozen-intent-echo" });
          continue;
        }
        proofDiagnostics?.push({ ...echoDiagnostic, repair: { allowed: false, reason: frozen === undefined
          ? "trusted-frozen-intent-required" : "additional-intent-is-not-an-exact-complete-frozen-input-echo" } });
        return Object.freeze([]);
      }
      const diagnostic = validation.diagnostics?.find(detail => detail.code === "VALUE_INVALID"
        && detail.path !== undefined && isPlainRecord(detail.expected) && detail.expected.whitespace === "trimmed");
      const path = diagnostic?.path;
      if (!path || path.length === 0) return Object.freeze([]);
      const parent = atPath(proof, path.slice(0, -1)), key = path.at(-1);
      if (!isPlainRecord(parent) || typeof key !== "string" || typeof parent[key] !== "string") return Object.freeze([]);
      const original = parent[key], normalized = original.trim();
      if (normalized.length === 0 || normalized === original) return Object.freeze([]);
      change(parent, path.slice(0, -1), key, normalized, "text-canonical-form");
    }
  } catch {
    return Object.freeze([]);
  }
}

function atPath(root: unknown, path: Path): unknown {
  let value = root;
  for (const part of path) {
    if (typeof part === "number") {
      if (!Array.isArray(value) || !Number.isSafeInteger(part) || part < 0 || !Object.hasOwn(value, part)) return undefined;
    } else if (!isPlainRecord(value) || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string | number, unknown>)[part];
  }
  return value;
}

function summaryPath(root: unknown, path: Path): boolean {
  if (!Array.isArray(path)) return false;
  const offset = path[0] === "proposals" ? 0
    : path[0] === "terminal" && path[1] === "choices" && Number.isSafeInteger(path[2])
      && path[3] === "continuation" && path[4] === "proposals" ? 4 : -1;
  if (offset < 0 || !Number.isSafeInteger(path[offset + 1])) return false;
  const entry = atPath(root, path.slice(0, offset + 2));
  if (!isPlainRecord(entry)) return false;
  const rest = path.slice(offset + 2);
  if (rest.length === 1 && rest[0] === "summary") return SUMMARY_ENTRIES.has(String(entry.kind));
  if (rest[0] !== "branches" || !["success", "failure"].includes(String(rest[1]))) return false;
  if (rest.length === 3 && rest[2] === "summary") return BRANCH_ENTRIES.has(String(entry.kind));
  return entry.kind === "worldInteraction" && rest.length === 5 && rest[2] === "effects"
    && Number.isSafeInteger(rest[3]) && rest[4] === "summary"
    && (atPath(entry, rest.slice(0, -1)) as Record<string, unknown> | undefined)?.kind === "definitionRevision";
}

/** Parsed numbers cannot prove their original decimals: a fraction may have
 * rounded to an integer. Bind the entire original wire to this draft before
 * addressing only existing timer duration fields. Full domain validation owns
 * the accepted range; this proof only preserves an exact integer token. */
function originalDurationIntegers(bundle: unknown, source?: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  if (typeof source !== "string" || !isPlainRecord(bundle)) return result;
  try {
    let parsed;
    try { parsed = parseJsonWithNumberTokens(source); }
    catch { parsed = completeJsonObjectSyntaxEvidence(source); }
    const decoded = decodeVNextStrictToolBundle(parsed.value);
    if (!isPlainRecord(decoded) || canonicalHash({ ...decoded, schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
      kind: "proposalBundle" }) !== canonicalHash(bundle)) return result;
    const tokens = new Map(parsed.numberTokens.map(token => [JSON.stringify(token.path), token]));
    const select = (parent: Record<string, unknown>, draftPath: Path, wirePath: Path) => {
      if (typeof parent.durationMicros !== "number") return;
      const token = tokens.get(JSON.stringify([...wirePath, "durationMicros"]));
      if (token && /^[1-9][0-9]*$/u.test(token.raw)) result.set(JSON.stringify([...draftPath, "durationMicros"]), token.raw);
    };
    const proposals = (entries: unknown, draftPath: Path, wirePath: Path) => {
      if (!Array.isArray(entries)) return;
      entries.forEach((entry, index) => {
        if (isPlainRecord(entry) && entry.kind === "formActorPlan") select(entry, [...draftPath, index], [...wirePath, "steps", index]);
      });
    };
    if (bundle.mode === "adjudication") proposals(bundle.proposals, ["proposals"], []);
    if (bundle.mode === "terminal" && isPlainRecord(bundle.terminal)) {
      if (bundle.terminal.kind === "passTime") select(bundle.terminal, ["terminal"], ["decision"]);
      if (bundle.terminal.kind === "clarification" && Array.isArray(bundle.terminal.choices)) bundle.terminal.choices.forEach((choice, index) => {
        if (isPlainRecord(choice) && isPlainRecord(choice.continuation) && choice.continuation.kind === "adjudication") {
          proposals(choice.continuation.proposals, ["terminal", "choices", index, "continuation", "proposals"],
            ["decision", "choices", index, "continuation"]);
        }
      });
    }
    return result;
  } catch { return new Map(); }
}
