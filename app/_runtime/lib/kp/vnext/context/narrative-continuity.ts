import type { AuthoritativeWorldState } from "../../../rules/authority-read";
import {
  narrativeBindingRef,
  narrativeDetail,
  narrativeDetailVisibleTo,
  narrativeMaterializedRef,
} from "../../../rules/v2/narrative-commitments";
import { compareCodeUnits, isPlainRecord } from "../canonical-json";
import type { CandidateDiscoveryResult } from "./candidate-discovery";
import type { ObligationSeed } from "./obligation-closure";
import type { ReferenceIndex } from "./reference-index";
import type { ContextWorkBudget } from "./work-budget";

type Discovery = Extract<CandidateDiscoveryResult, { kind: "discovered" }>;
type NarrativeContextResult =
  | Readonly<{ kind: "ready"; seeds: readonly ObligationSeed[]; materializationRefs: readonly string[] }>
  | Readonly<{ kind: "blocked"; reason: "criticalUnavailable" | "preparationLimit"; issue: string }>;

/** Publication history is neither a mechanical object directory nor a recent
 * dialogue window. Current-scene commitments constrain new prose even with
 * zero lexical hits; remembered details elsewhere enter through discovery.
 * None of these preparation obligations becomes a transaction read set. */
export function narrativeContextRequirements(input: Readonly<{
  state: AuthoritativeWorldState;
  index: ReferenceIndex;
  actorRef: string;
  sceneRef: string;
  intentText: string;
  focusRefs: readonly string[];
  discovery: Discovery;
  budget: ContextWorkBudget;
}>): NarrativeContextResult {
  const { state, index, actorRef, discovery } = input;
  const relevant = new Set<string>();
  const explicit = new Set<string>();
  for (const ref of index.narrativeCommitmentsByScene.get(input.sceneRef) ?? []) {
    if (!input.budget.charge("postingVisits", 1)) return limited();
    if (narrativeDetail(state, ref) === undefined) return unavailable();
    if (narrativeDetailVisibleTo(state, ref, actorRef)) relevant.add(ref);
  }
  for (const ref of input.focusRefs) {
    const node = index.nodes.get(ref);
    if (node?.kind === "narrativeBinding") {
      const value = state.canonicalFacts[ref]?.value;
      if (!isPlainRecord(value) || typeof value.commitmentRef !== "string"
        || !narrativeDetailVisibleTo(state, value.commitmentRef, actorRef)) return unavailable();
      relevant.add(value.commitmentRef);
    }
    if (node?.kind !== "narrativeCommitment") continue;
    if (!narrativeDetailVisibleTo(state, ref, actorRef)) return unavailable();
    relevant.add(ref);
    explicit.add(ref);
  }
  const identifying = discovery.candidates.filter(({ purpose }) => purpose === "objectIdentification");
  const narrativeCandidates = identifying.filter(({ ref }) => index.nodes.get(ref)?.kind === "narrativeCommitment"
    && narrativeDetailVisibleTo(state, ref, actorRef));
  for (const { ref } of narrativeCandidates) relevant.add(ref);

  const complete = discovery.droppedCandidateCount === 0 && discovery.truncatedPaths.length === 0
    && discovery.droppedGenericTerms.length === 0;
  if (complete) {
    // Full, unique published labels allow several independently named details
    // in one action. A shorter label inside another matched label is not a
    // second identification, and duplicate labels remain ambiguous.
    const labels = narrativeCandidates.map(({ ref }) => ({ ref, label: narrativeDetail(state, ref)!.label }))
      .filter(({ label }) => input.intentText.normalize("NFC").includes(label));
    for (const entry of labels) {
      if (labels.some((other) => other.ref !== entry.ref
        && (other.label === entry.label || other.label.includes(entry.label)))) continue;
      const candidate = narrativeCandidates.find(({ ref }) => ref === entry.ref)!;
      if (identifying.some((other) => other.ref !== entry.ref && other.score >= candidate.score
        && other.matchedTerms.some((term) => candidate.matchedTerms.includes(term)))) continue;
      explicit.add(entry.ref);
    }
    const natural = identifying.filter(({ matchKind }) => matchKind !== "exactRef");
    const topScore = Math.max(-1, ...natural.map(({ score }) => score));
    const top = natural.filter(({ score }) => score === topScore);
    if (top.length === 1 && narrativeCandidates.some(({ ref }) => ref === top[0]!.ref)) {
      explicit.add(top[0]!.ref);
    }
  }

  const seeds: ObligationSeed[] = [];
  for (const ref of [...relevant].sort(compareCodeUnits)) {
    if (!input.budget.charge("postingVisits", 1)) return limited();
    seeds.push({ ref, obligation: "narrativeContinuity" });
    const bindingRef = narrativeBindingRef(ref);
    const binding = state.canonicalFacts[bindingRef];
    if (binding === undefined) continue;
    const materializedRef = narrativeMaterializedRef(state, ref);
    if (materializedRef === undefined || !index.nodes.has(materializedRef)) return unavailable();
    seeds.push({ ref: bindingRef, obligation: "narrativeContinuity" },
      { ref: materializedRef, obligation: "definition" });
  }
  return { kind: "ready", seeds,
    materializationRefs: [...explicit].filter((ref) => narrativeMaterializedRef(state, ref) === undefined)
      .sort(compareCodeUnits) };
}

function limited(): NarrativeContextResult {
  return { kind: "blocked", reason: "preparationLimit", issue: "narrativeContinuity:work-budget-exhausted" };
}
function unavailable(): NarrativeContextResult {
  return { kind: "blocked", reason: "criticalUnavailable", issue: "narrativeContinuity:required-context-unavailable" };
}
