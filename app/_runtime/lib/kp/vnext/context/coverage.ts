import {
  authoritySpatialRefVisibleTo,
  canonicalFactVisibleToCharacter,
  type AuthoritativeWorldState,
} from "../../../rules/authority-read";
import { compareCodeUnits } from "../canonical-json";
import type { EquivalentSelection } from "./ambiguity";
import type { ContextObligation } from "./obligation-closure";
import type { ReferenceNode } from "./reference-index";

export type CitationClass = "viewer" | "authority" | "nonCitable";
export type ContextDomain = "ability" | "item" | "semantic";

/**
 * Obligations whose reference is decisive: a gap in one of these means the KP
 * would be ruling on something it cannot see. The rest are supporting material
 * whose absence is reported without blocking.
 */
const DECISIVE_OBLIGATIONS: ReadonlySet<ContextObligation> = new Set([
  "actor",
  "target",
  "instrument",
  "ability",
  "relation",
]);

export function obligationsAreDecisive(
  obligations: readonly ContextObligation[],
): boolean {
  return obligations.some((obligation) => DECISIVE_OBLIGATIONS.has(obligation));
}

/**
 * Which disclosure class a reference belongs to for this actor.
 *
 * Classification is read from authority state, never inferred from where the
 * ref came from in the closure. A hidden cause pulled in through a relation
 * stays `authority`: it may ground the ruling without ever reaching a Viewer.
 */
export function citationClass(
  state: AuthoritativeWorldState,
  node: ReferenceNode,
  actorCharacterId: string,
  sceneRef: string,
): CitationClass {
  switch (node.kind) {
    case "scene":
      return node.ref === sceneRef ? "viewer" : "authority";
    case "entity":
    case "itemEntry":
      return authoritySpatialRefVisibleTo(state, node.ref, sceneRef, actorCharacterId)
        ? "viewer"
        : "authority";
    case "semanticDefinition":
      if (node.semanticKind === "sceneFeature") {
        return authoritySpatialRefVisibleTo(state, node.ref, sceneRef, actorCharacterId)
          ? "viewer"
          : "authority";
      }
      return node.visibilityPolicyRef === "visibility:public"
        || node.visibilityPolicyRef === "visibility:scene-observers"
        ? "viewer"
        : "authority";
    case "canonicalFact": {
      const fact = state.canonicalFacts[node.ref];
      const character = state.entities[actorCharacterId];
      return fact !== undefined
        && character !== undefined
        && canonicalFactVisibleToCharacter(state, fact, character)
        ? "viewer"
        : "authority";
    }
    case "knowledge":
      if (node.knowledgeHolderRef === actorCharacterId) return "viewer";
      // Another character's knowledge grounds NPC behaviour but is not
      // material anyone may cite back into the fiction.
      return node.knowledgeHolderRef !== undefined
        && state.entities[node.knowledgeHolderRef]?.kind === "npc"
        ? "nonCitable"
        : "authority";
    default:
      return "authority";
  }
}

export function contextDomain(node: ReferenceNode): ContextDomain {
  if (node.kind === "abilityDefinition") return "ability";
  if (node.kind === "itemEntry" || node.kind === "itemDefinition") return "item";
  return "semantic";
}

export type ObligationCoverage = Readonly<{
  obligation: ContextObligation;
  refCount: number;
  /** False when at least one ref carrying this obligation could not be read. */
  resolved: boolean;
}>;

export type ContextCoverage = Readonly<{
  obligations: readonly ObligationCoverage[];
  entryStates: Readonly<Record<
    "known" | "knownAbsent" | "openBlank" | "ambiguous" | "unavailable",
    number
  >>;
  /** True when the closure ran to an empty frontier rather than hitting a bound. */
  frontierExhausted: boolean;
  /** Bounded-search disclosures, carried so a partial surface is never read as
   * a complete one. */
  truncatedPaths: readonly string[];
  droppedGenericTerms: readonly string[];
  droppedCandidateCount: number;
  /** Readings the server folded because they were provably interchangeable.
   * Server-private audit: the KP sees the selected instance as an ordinary
   * entry and is not asked a question that has only one answer. */
  equivalentSelections: readonly EquivalentSelection[];
  /** Availability questions the pipeline could answer neither way. Recorded so
   * an unanswered question is never mistaken for a settled absence. */
  unresolvedRequirements: readonly string[];
  /** Canonical units the frozen artifact actually used, against the profile
   * target. A soft target for telemetry; the hard ceiling is the callers
   * maxUnits. */
  unitsUsed: number;
  unitsTarget: number;
}>;

export function contextCoverage(input: Readonly<{
  obligations: ReadonlyMap<ContextObligation, { refCount: number; resolved: boolean }>;
  entryStates: ContextCoverage["entryStates"];
  frontierExhausted: boolean;
  truncatedPaths: readonly string[];
  droppedGenericTerms: readonly string[];
  droppedCandidateCount: number;
  equivalentSelections: readonly EquivalentSelection[];
  unresolvedRequirements: readonly string[];
  unitsUsed: number;
  unitsTarget: number;
}>): ContextCoverage {
  return Object.freeze({
    obligations: Object.freeze([...input.obligations]
      .map(([obligation, value]) => Object.freeze({ obligation, ...value }))
      .sort((left, right) => compareCodeUnits(left.obligation, right.obligation))),
    entryStates: Object.freeze({ ...input.entryStates }),
    frontierExhausted: input.frontierExhausted,
    truncatedPaths: Object.freeze([...input.truncatedPaths].sort(compareCodeUnits)),
    droppedGenericTerms: Object.freeze([...input.droppedGenericTerms].sort(compareCodeUnits)),
    droppedCandidateCount: input.droppedCandidateCount,
    equivalentSelections: Object.freeze([...input.equivalentSelections]
      .sort((left, right) => compareCodeUnits(left.selectedRef, right.selectedRef))),
    unresolvedRequirements: Object.freeze([...input.unresolvedRequirements].sort(compareCodeUnits)),
    unitsUsed: input.unitsUsed,
    unitsTarget: input.unitsTarget,
  });
}
