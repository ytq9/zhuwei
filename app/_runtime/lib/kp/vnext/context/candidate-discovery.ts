import {
  authoritySpatialRefVisibleTo,
  canonicalFactVisibleToCharacter,
  type AuthoritativeWorldState,
} from "../../../rules/authority-read";
import { compareCodeUnits } from "../canonical-json";
import { indexableRecord } from "./authority-records";
import {
  extractTerms,
  nodeDescriptor,
  profileIndexesDescriptor,
  tokenize,
  type ExtractedTerm,
  type RetrievalProfile,
  type RetrievalPurpose,
} from "./extractors";
import type { ReferenceIndex, ReferenceNode } from "./reference-index";
import type { ContextWorkBudget, ContextWorkReceipt } from "./work-budget";

/**
 * Whose authorized view the search surface is built for. The main KP may
 * search authorized hidden material because it adjudicates on it; an NPC is
 * limited to what that character can actually perceive and knows. Building the
 * surface per subject *before* indexing is what keeps an NPC's own discovery
 * from silently inheriting the KP's reach.
 */
export type EpistemicSubject =
  | Readonly<{ kind: "kp"; sceneRef: string }>
  | Readonly<{ kind: "character"; characterRef: string; sceneRef: string }>;

export type CandidateMatchKind = "exactRef" | "alias" | "lexical";

export type DiscoveredCandidate = Readonly<{
  ref: string;
  purpose: RetrievalPurpose;
  matchKind: CandidateMatchKind;
  matchedTerms: readonly string[];
  score: number;
}>;

export type CandidateDiscoveryResult =
  | Readonly<{
      kind: "discovered";
      candidates: readonly DiscoveredCandidate[];
      /** Field paths whose text hit the length cap while building the surface. */
      truncatedPaths: readonly string[];
      /** Terms dropped for exceeding the profile's fan-out, and candidates
       * dropped past the profile cap. Reported rather than silently applied:
       * a bounded search must not read as an exhaustive one. */
      droppedGenericTerms: readonly string[];
      droppedCandidateCount: number;
    }>
  | Readonly<{ kind: "preparationLimit"; receipt: ContextWorkReceipt }>;

export type CandidateDiscoveryInput = Readonly<{
  state: AuthoritativeWorldState;
  index: ReferenceIndex;
  subject: EpistemicSubject;
  /**
   * Refs the player addressed directly through UI or map focus. Trusted as
   * addressing only — naming a thing is not choosing it, and discovery never
   * promotes a focus ref into a decided target.
   */
  focusRefs: readonly string[];
  intentText: string;
  profile: RetrievalProfile;
  budget: ContextWorkBudget;
  purposes?: readonly RetrievalPurpose[];
}>;

/**
 * Produces candidate refs for the player's words. It resolves nothing: the
 * result is what the intent *could* be addressing, ranked deterministically and
 * with ties preserved, so understanding stays with the KP.
 */
export function discoverCandidates(input: CandidateDiscoveryInput): CandidateDiscoveryResult {
  const { budget, profile } = input;
  const allowedPurposes = new Set<RetrievalPurpose>(
    input.purposes ?? (input.subject.kind === "kp"
      ? ["objectIdentification", "capability"]
      : ["objectIdentification", "capability", "actorIntent"]),
  );

  if (!budget.charge("searchableCharacters", input.intentText.length)) return limited(budget);
  const queryTerms = new Set(tokenize(input.intentText, profile.tokenizer));

  const postings = new Map<string, Map<string, ExtractedTerm>>();
  const truncatedPaths = new Set<string>();
  for (const [ref, node] of [...input.index.nodes].sort(([left], [right]) =>
    compareCodeUnits(left, right))) {
    const descriptor = nodeDescriptor(node);
    if (!profileIndexesDescriptor(profile, descriptor)) continue;
    if (!budget.charge("scannedRecords", 1)) return limited(budget);
    if (!addressable(node, input.subject.sceneRef)) continue;
    if (!authorized(input.state, input.subject, node)) continue;
    const record = indexableRecord(input.state, node);
    if (record === undefined) continue;
    const extracted = extractTerms(record, descriptor, profile, budget);
    if (extracted.kind === "preparationLimit") return limited(budget);
    for (const path of extracted.truncatedPaths) truncatedPaths.add(`${ref}:${path}`);
    for (const term of extracted.terms) {
      if (!allowedPurposes.has(term.purpose)) continue;
      if (term.termKind === "structural") continue;
      if (!queryTerms.has(term.term)) continue;
      const byRef = postings.get(term.term) ?? new Map<string, ExtractedTerm>();
      // An alias reading of the same term wins over a lexical one.
      if (!(byRef.get(ref)?.termKind === "alias")) byRef.set(ref, term);
      postings.set(term.term, byRef);
    }
  }

  const scores = new Map<string, {
    purpose: RetrievalPurpose;
    matchKind: CandidateMatchKind;
    terms: Set<string>;
    score: number;
  }>();
  const droppedGenericTerms: string[] = [];
  for (const [term, byRef] of [...postings].sort(([left], [right]) =>
    compareCodeUnits(left, right))) {
    // A term matching more refs than the profile allows discriminates nothing.
    // Dropping it is a bounded-search decision, so it is reported.
    if (byRef.size > profile.tokenizer.maxPostingsPerTerm) {
      droppedGenericTerms.push(term);
      continue;
    }
    for (const [ref, extracted] of byRef) {
      if (!budget.charge("candidateScores", 1)) return limited(budget);
      const existing = scores.get(ref) ?? {
        purpose: extracted.purpose,
        matchKind: "lexical" as CandidateMatchKind,
        terms: new Set<string>(),
        score: 0,
      };
      existing.terms.add(term);
      // An alias hit is stronger evidence than prose containing the same
      // characters, but it is still only evidence.
      existing.score += extracted.termKind === "alias" ? 2 : 1;
      if (extracted.termKind === "alias") existing.matchKind = "alias";
      scores.set(ref, existing);
    }
  }

  for (const ref of [...new Set(input.focusRefs)].sort(compareCodeUnits)) {
    if (!input.index.nodes.has(ref)) continue;
    if (!budget.charge("candidateScores", 1)) return limited(budget);
    scores.set(ref, {
      purpose: "objectIdentification",
      matchKind: "exactRef",
      terms: new Set(),
      score: Number.MAX_SAFE_INTEGER,
    });
  }

  const ranked = [...scores]
    .map(([ref, entry]) => Object.freeze({
      ref,
      purpose: entry.purpose,
      matchKind: entry.matchKind,
      matchedTerms: Object.freeze([...entry.terms].sort(compareCodeUnits)),
      score: entry.score,
    }))
    // Ties keep their order and are never broken by recency or by picking the
    // first: two equally matched refs stay two candidates.
    .sort((left, right) => right.score - left.score || compareCodeUnits(left.ref, right.ref));

  return Object.freeze({
    kind: "discovered",
    candidates: Object.freeze(ranked.slice(0, profile.tokenizer.maxCandidates)),
    truncatedPaths: Object.freeze([...truncatedPaths].sort(compareCodeUnits)),
    droppedGenericTerms: Object.freeze(droppedGenericTerms.sort(compareCodeUnits)),
    droppedCandidateCount: Math.max(0, ranked.length - profile.tokenizer.maxCandidates),
  });
}

/**
 * Scope, applied before permission and independently of it. The player's words
 * can only address something standing in the scene they are acting in, so a
 * same-named object elsewhere in the world is not a rival reading of "the
 * chandelier" — even for the KP, which is otherwise permitted to see it.
 * Scope-free records such as item and ability definitions are unaffected;
 * out-of-scene causes reach the KP through relation and fact closure, not by
 * being offered as things the player might have meant.
 */
function addressable(node: ReferenceNode, sceneRef: string): boolean {
  return node.sceneRef === undefined || node.sceneRef === sceneRef;
}

function authorized(
  state: AuthoritativeWorldState,
  subject: EpistemicSubject,
  node: ReferenceNode,
): boolean {
  if (subject.kind === "kp") return true;
  if (node.kind === "canonicalFact") {
    const fact = state.canonicalFacts[node.ref];
    const character = state.entities[subject.characterRef];
    return fact !== undefined
      && character !== undefined
      && canonicalFactVisibleToCharacter(state, fact, character);
  }
  if (node.kind === "knowledge") return node.knowledgeHolderRef === subject.characterRef;
  // Everything else must be something the character can actually perceive in
  // the scene it is acting in. Authority-only records have no character
  // surface at all.
  return node.sceneRef === subject.sceneRef
    && authoritySpatialRefVisibleTo(state, node.ref, subject.sceneRef, subject.characterRef);
}

function limited(budget: ContextWorkBudget): CandidateDiscoveryResult {
  return Object.freeze({ kind: "preparationLimit", receipt: budget.receipt() });
}
