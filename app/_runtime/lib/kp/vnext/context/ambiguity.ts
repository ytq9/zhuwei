import {
  authoritySpatialRefVisibleTo,
  type AuthoritativeWorldState,
} from "../../../rules/authority-read";
import { canonicalHash, compareCodeUnits, isPlainRecord } from "../canonical-json";
import type { AmbiguityCandidate, AmbiguousContextEntry } from "../required-context";
import { indexableRecord } from "./authority-records";
import type { DiscoveredCandidate } from "./candidate-discovery";
import type { ReferenceIndex, ReferenceNode } from "./reference-index";

/**
 * What the server may do with an unresolved reading.
 *
 * `kpMaySelect` means the readings differ, but not in a way that changes the
 * outcome the player would care about; the KP picks and records why.
 * `clarificationRequired` means the choice changes danger, a significant
 * resource, what gets attacked, what is reachable, or something irreversible —
 * the kind of decision that is the player's to make.
 */
export type AmbiguityResolution = "kpMaySelect" | "clarificationRequired";

/**
 * A fold the server performed on the player's behalf. Four identical chairs are
 * one choice, not a question, so equivalence is resolved here and the basis is
 * kept for audit rather than being put to the KP as ambiguity.
 */
export type EquivalentSelection = Readonly<{
  obligation: string;
  selectedRef: string;
  foldedRefs: readonly string[];
  equivalenceKey: string;
}>;

export type AmbiguityOutcome =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "equivalent"; selection: EquivalentSelection }>
  | Readonly<{ kind: "ambiguous"; entry: AmbiguousContextEntry }>;

export type AmbiguityInput = Readonly<{
  state: AuthoritativeWorldState;
  index: ReferenceIndex;
  candidates: readonly DiscoveredCandidate[];
  actorCharacterId: string;
  sceneRef: string;
  frontierExhausted: boolean;
}>;

export function resolveTargetAmbiguity(input: AmbiguityInput): AmbiguityOutcome {
  const identifying = input.candidates.filter((candidate) =>
    candidate.purpose === "objectIdentification" && candidate.matchKind !== "exactRef");
  if (identifying.length < 2) return NONE;
  const topScore = Math.max(...identifying.map(({ score }) => score));
  const tied = identifying
    .filter((candidate) => candidate.score === topScore)
    .sort((left, right) => compareCodeUnits(left.ref, right.ref));
  if (tied.length < 2) return NONE;

  const nodes = tied.map(({ ref }) => input.index.nodes.get(ref));
  if (nodes.some((node) => node === undefined)) return NONE;
  const resolved = nodes as readonly ReferenceNode[];

  // Equivalence must be proven, never assumed. A reading the server cannot show
  // to be interchangeable stays a reading the KP has to look at.
  const keys = resolved.map((node) => equivalenceKey(input.state, node, input.actorCharacterId, input.sceneRef));
  if (keys.every((key) => key !== undefined && key === keys[0])) {
    return Object.freeze({
      kind: "equivalent",
      selection: Object.freeze({
        obligation: "target",
        selectedRef: tied[0]!.ref,
        foldedRefs: Object.freeze(tied.slice(1).map(({ ref }) => ref)),
        equivalenceKey: keys[0]!,
      }),
    });
  }

  const addressable = resolved.map((node) =>
    node.sceneRef === input.sceneRef
    && authoritySpatialRefVisibleTo(input.state, node.ref, input.sceneRef, input.actorCharacterId));
  const viewerSafe = addressable.every(Boolean);
  const material = materialDifference(input, resolved);

  return Object.freeze({
    kind: "ambiguous",
    entry: Object.freeze({
      kind: "ambiguous",
      entryRef: "ambiguity:target",
      obligation: "target",
      // Asking about a reading the player cannot perceive would turn a secret
      // into an option, so a set that is not wholly addressable never becomes
      // a question however much the readings differ.
      resolution: (material && viewerSafe
        ? "clarificationRequired"
        : "kpMaySelect") as AmbiguityResolution,
      candidates: Object.freeze(tied.map((candidate): AmbiguityCandidate => Object.freeze({
        ref: candidate.ref,
        matchKind: candidate.matchKind,
        score: candidate.score,
        basisRefs: Object.freeze(candidate.matchedTerms.length === 0 ? [] : [candidate.ref]),
      }))),
      frontierExhausted: input.frontierExhausted,
      viewerSafe,
    }),
  });
}

/**
 * A stable identity for "the same thing in the same state, reached the same
 * way". Returns undefined when interchangeability cannot be established from
 * declared fields — creatures are never interchangeable, and a record whose
 * shape is unknown is not assumed to be a duplicate of anything.
 */
function equivalenceKey(
  state: AuthoritativeWorldState,
  node: ReferenceNode,
  actorCharacterId: string,
  sceneRef: string,
): string | undefined {
  const reachable = node.sceneRef === sceneRef
    && authoritySpatialRefVisibleTo(state, node.ref, sceneRef, actorCharacterId);
  const record = indexableRecord(state, node);
  if (!isPlainRecord(record)) return undefined;

  if (node.kind === "itemEntry") {
    return canonicalHash({
      kind: node.kind,
      reachable,
      sceneRef: node.sceneRef ?? null,
      holderRef: node.holderRef ?? null,
      definitionRef: record.definitionRef ?? null,
      definitionRevision: record.definitionRevision ?? null,
      disposition: record.disposition ?? null,
      equippedSlot: record.equippedSlot ?? null,
      quantity: record.quantity ?? null,
      condition: record.condition ?? null,
      charges: record.charges ?? null,
      durability: record.durability ?? null,
      visibilityPolicyRef: record.visibilityPolicyRef ?? null,
    });
  }
  if (node.kind === "semanticDefinition" && node.semanticKind !== "npc") {
    // Whole content, label included. Two features are interchangeable only when
    // nothing an observer could tell apart differs.
    return canonicalHash({
      kind: node.kind,
      semanticKind: node.semanticKind ?? null,
      reachable,
      templateRef: node.templateRef ?? null,
      templateHash: node.templateHash ?? null,
      visibilityPolicyRef: node.visibilityPolicyRef ?? null,
      content: record.content ?? null,
    });
  }
  return undefined;
}

/**
 * Whether choosing wrongly would change something the player would object to
 * after the fact.
 *
 * Irreversibility itself is not detectable from a snapshot, so it is not
 * claimed here; the detectable proxies are a different kind of thing, a
 * different place or reachability, a different exposure to a triggered or
 * blocking relation, and a different quantity of a consumable.
 */
function materialDifference(
  input: AmbiguityInput,
  nodes: readonly ReferenceNode[],
): boolean {
  const distinct = <T>(values: readonly T[]): boolean =>
    new Set(values.map((value) => JSON.stringify(value ?? null))).size > 1;

  if (distinct(nodes.map((node) => node.kind))) return true;
  if (distinct(nodes.map((node) => node.sceneRef ?? null))) return true;
  if (distinct(nodes.map((node) => node.holderRef ?? null))) return true;
  if (distinct(nodes.map((node) =>
    node.sceneRef === input.sceneRef
    && authoritySpatialRefVisibleTo(
      input.state,
      node.ref,
      input.sceneRef,
      input.actorCharacterId,
    )))) return true;

  if (distinct(nodes.map((node) => hazardExposure(input.index, node.ref)))) return true;

  const consumables = nodes.map((node) => {
    const record = indexableRecord(input.state, node);
    return isPlainRecord(record)
      ? { quantity: record.quantity ?? null, charges: record.charges ?? null }
      : null;
  });
  return distinct(consumables);
}

/** Relations that make one candidate dangerous where another is not. */
function hazardExposure(index: ReferenceIndex, ref: string): readonly string[] {
  return [
    ...index.relationsBySubject.get(ref) ?? [],
    ...index.relationsByObject.get(ref) ?? [],
  ]
    .filter((edge) => edge.state === "active"
      && (edge.relationKind === "triggers" || edge.relationKind === "blocks"))
    .map((edge) => edge.relationKind)
    .sort(compareCodeUnits);
}

const NONE: AmbiguityOutcome = Object.freeze({ kind: "none" });
