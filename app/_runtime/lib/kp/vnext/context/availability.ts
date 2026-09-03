import {
  authorityRevisionOrHash,
  type AuthoritativeWorldState,
} from "../../../rules/authority-read";
import { compareCodeUnits, isNonEmptyString, isPlainRecord } from "../canonical-json";
import type { RequiredContextEntry } from "../required-context";
import type { ContextObligation } from "./obligation-closure";
import type { ReferenceIndex, ReferenceNode } from "./reference-index";

/**
 * How a question about absence names what it is asking about. A closed union:
 * an absence claim that cannot say precisely what is absent is not a claim the
 * KP can rely on.
 */
export type AbsenceSelector =
  | Readonly<{ kind: "exactRef"; ref: string }>
  | Readonly<{ kind: "semanticKind"; semanticKind: string }>
  | Readonly<{ kind: "templateRef"; templateRef: string }>
  | Readonly<{ kind: "templateFamily"; templateFamily: string }>;

/**
 * An explicit question the caller wants answered about one scope.
 *
 * `openBlank` is only ever produced in reply to one of these. It is never
 * inferred from the player's wording, and never from retrieval finding nothing
 * — a search that returns no hits has not established that the world is empty.
 */
export type AvailabilityRequirement = Readonly<{
  entryRef: string;
  obligation: ContextObligation;
  scopeRef: string;
  selector: AbsenceSelector;
  allowedKinds: readonly string[];
}>;

/** Profile-issued permission for the KP to settle one kind of blank. Produced
 * outside this module; recorded here so the integration line can validate the
 * version binding inside the transaction. */
export type OpenBlankAuthorization = Readonly<{
  grantRef: string;
  grantHash: string;
  scopeRef: string;
  scopeRevisionOrHash: string;
  allowedKinds: readonly string[];
  basisRefs: readonly string[];
  visibilityPolicyRef: string;
}>;

export type AvailabilityOutcome =
  | Readonly<{ kind: "present" }>
  | Readonly<{ kind: "entry"; entry: RequiredContextEntry }>
  | Readonly<{ kind: "unresolved"; reason: string }>
  | Readonly<{ kind: "integrityConflict"; issue: string }>;

export type AvailabilityInput = Readonly<{
  state: AuthoritativeWorldState;
  index: ReferenceIndex;
  requirement: AvailabilityRequirement;
  authorizations: readonly OpenBlankAuthorization[];
  /** Refs already read as `known`. A scope that was not loaded cannot support
   * a claim about what is or is not inside it. */
  loadedRefs: ReadonlySet<string>;
  frontierExhausted: boolean;
}>;

export function resolveAvailability(input: AvailabilityInput): AvailabilityOutcome {
  const { requirement } = input;
  if (!input.loadedRefs.has(requirement.scopeRef)) {
    return unresolved("scope:not-loaded");
  }

  const positives = positiveMatches(input.index, requirement);
  const absence = activeLocalAbsence(input.state, requirement);

  // The world cannot both contain the thing and authoritatively record that it
  // does not. That is two authority records disagreeing, not a reading the KP
  // gets to choose between.
  if (positives.length > 0 && absence !== undefined) {
    return Object.freeze({
      kind: "integrityConflict",
      issue: `availability:${requirement.entryRef}:positive-and-active-absence`,
    });
  }
  if (positives.length > 0) return PRESENT;

  if (absence !== undefined) {
    return Object.freeze({
      kind: "entry",
      entry: Object.freeze({
        kind: "knownAbsent",
        entryRef: requirement.entryRef,
        scopeRef: requirement.scopeRef,
        selector: absence.selector,
        basisRefs: absence.basisRefs,
      }),
    });
  }

  // Nothing found and nothing denied. Only an explicit grant turns that into
  // room for the KP to decide; without one the question stays unanswered
  // rather than becoming a licence to invent.
  if (!input.frontierExhausted) return unresolved("frontier:truncated");
  const grant = matchingAuthorization(input.state, requirement, input.authorizations);
  if (grant === undefined) return unresolved("authorization:absent-or-stale");

  return Object.freeze({
    kind: "entry",
    entry: Object.freeze({
      kind: "openBlank",
      entryRef: requirement.entryRef,
      scopeRef: requirement.scopeRef,
      allowedKinds: Object.freeze([...requirement.allowedKinds].sort(compareCodeUnits)),
      basisRefs: Object.freeze([...grant.basisRefs].sort(compareCodeUnits)),
      authorizationRef: grant.grantRef,
      authorizationHash: grant.grantHash,
    }),
  });
}

/** Objects in scope that already satisfy the selector. */
function positiveMatches(
  index: ReferenceIndex,
  requirement: AvailabilityRequirement,
): readonly string[] {
  const inScope = index.refsByScene.get(requirement.scopeRef) ?? [];
  return inScope.filter((ref) => {
    const node = index.nodes.get(ref);
    return node !== undefined && selectorMatchesNode(requirement.selector, node);
  });
}

function selectorMatchesNode(selector: AbsenceSelector, node: ReferenceNode): boolean {
  switch (selector.kind) {
    case "exactRef":
      return node.ref === selector.ref;
    case "semanticKind":
      return node.semanticKind === selector.semanticKind;
    case "templateRef":
      return node.templateRef === selector.templateRef;
    case "templateFamily":
      return node.templateRef !== undefined
        && node.templateRef.startsWith(`${selector.templateFamily}:`);
  }
}

type ParsedAbsence = Readonly<{
  selector: AbsenceSelector;
  basisRefs: readonly string[];
}>;

/**
 * Reads an authoritative `localAbsence` fact for this scope and selector.
 *
 * A stale scope revision, a missing basis, or a superseded record all mean the
 * denial no longer holds. None of them is grounds to assume the opposite; they
 * simply leave the question open.
 */
function activeLocalAbsence(
  state: AuthoritativeWorldState,
  requirement: AvailabilityRequirement,
): ParsedAbsence | undefined {
  const currentScopeRevision = authorityRevisionOrHash(state, requirement.scopeRef);
  if (currentScopeRevision === null) return undefined;

  for (const fact of Object.values(state.canonicalFacts)
    .filter((candidate) => candidate.kind === "localAbsence")
    .sort((left, right) => compareCodeUnits(left.id, right.id))) {
    const value = fact.value;
    if (!isPlainRecord(value)) continue;
    if (value.scopeRef !== requirement.scopeRef) continue;
    if (value.status !== "active") continue;
    if (value.scopeRevisionOrHash !== currentScopeRevision) continue;
    const selector = parseSelector(value.selector);
    if (selector === undefined || !sameSelector(selector, requirement.selector)) continue;
    const basisRefs = Array.isArray(value.basisRefs)
      ? value.basisRefs.filter(isNonEmptyString)
      : [];
    if (basisRefs.length === 0) continue;
    return Object.freeze({
      selector,
      basisRefs: Object.freeze([...new Set([...basisRefs, fact.id])].sort(compareCodeUnits)),
    });
  }
  return undefined;
}

function parseSelector(value: unknown): AbsenceSelector | undefined {
  if (!isPlainRecord(value)) return undefined;
  if (value.kind === "exactRef" && isNonEmptyString(value.ref)) {
    return Object.freeze({ kind: "exactRef", ref: value.ref });
  }
  if (value.kind === "semanticKind" && isNonEmptyString(value.semanticKind)) {
    return Object.freeze({ kind: "semanticKind", semanticKind: value.semanticKind });
  }
  if (value.kind === "templateRef" && isNonEmptyString(value.templateRef)) {
    return Object.freeze({ kind: "templateRef", templateRef: value.templateRef });
  }
  if (value.kind === "templateFamily" && isNonEmptyString(value.templateFamily)) {
    return Object.freeze({ kind: "templateFamily", templateFamily: value.templateFamily });
  }
  return undefined;
}

/**
 * Field-wise equality over the closed selector union.
 *
 * `parseSelector` always builds its side in a fixed key order, but the
 * requirement side comes from the caller unnormalized: a `JSON.stringify`
 * comparison would call two semantically identical selectors unequal purely
 * because their keys were written in a different order, and silently drop a
 * valid absence record as a result.
 */
function sameSelector(left: AbsenceSelector, right: AbsenceSelector): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "exactRef":
      return left.ref === (right as Extract<AbsenceSelector, { kind: "exactRef" }>).ref;
    case "semanticKind":
      return left.semanticKind
        === (right as Extract<AbsenceSelector, { kind: "semanticKind" }>).semanticKind;
    case "templateRef":
      return left.templateRef
        === (right as Extract<AbsenceSelector, { kind: "templateRef" }>).templateRef;
    case "templateFamily":
      return left.templateFamily
        === (right as Extract<AbsenceSelector, { kind: "templateFamily" }>).templateFamily;
  }
}

function matchingAuthorization(
  state: AuthoritativeWorldState,
  requirement: AvailabilityRequirement,
  authorizations: readonly OpenBlankAuthorization[],
): OpenBlankAuthorization | undefined {
  const currentScopeRevision = authorityRevisionOrHash(state, requirement.scopeRef);
  if (currentScopeRevision === null) return undefined;
  const required = new Set(requirement.allowedKinds);
  return authorizations.find((grant) =>
    grant.scopeRef === requirement.scopeRef
    // A grant issued against an older scope no longer describes this scope.
    && grant.scopeRevisionOrHash === currentScopeRevision
    && isNonEmptyString(grant.grantRef)
    && isNonEmptyString(grant.grantHash)
    && grant.basisRefs.length > 0
    && [...required].every((kind) => grant.allowedKinds.includes(kind)));
}

const PRESENT: AvailabilityOutcome = Object.freeze({ kind: "present" });

function unresolved(reason: string): AvailabilityOutcome {
  return Object.freeze({ kind: "unresolved", reason });
}
