import { compareCodeUnits } from "../canonical-json";
import type { ReferenceIndex, ReferenceNode } from "./reference-index";
import type { ContextWorkBudget, ContextWorkReceipt } from "./work-budget";

/**
 * Why a reference must be readable before the KP adjudicates — never what the
 * action is called. The pipeline expands the same obligations for "shoot the
 * chandelier", "burn the rope" and "throw a stone at the trap"; nothing here
 * dispatches on an action name, a material word or a fixture identifier.
 */
export const CONTEXT_OBLIGATIONS = Object.freeze([
  "actor",
  "target",
  "instrument",
  "ability",
  "relation",
  "geometry",
  "fact",
  "continuity",
  "precedent",
  "safety",
] as const);

export type ContextObligation = (typeof CONTEXT_OBLIGATIONS)[number];

export type ObligationSeed = Readonly<{
  ref: string;
  obligation: ContextObligation;
}>;

/**
 * Declared dependencies that cannot be read from addressing alone — ability
 * costs, precedent lineage, policy references. Resolving these needs the record
 * body and therefore its schema, so the closure takes it as a hook rather than
 * embedding schema knowledge in graph traversal.
 */
export type DependencyResolver = (
  ref: string,
  obligation: ContextObligation,
  node: ReferenceNode | undefined,
) => readonly ObligationSeed[];

export type ClosedReference = Readonly<{
  ref: string;
  obligations: readonly ContextObligation[];
  /** Refs that admitted this one. Empty for seeds. */
  basisRefs: readonly string[];
}>;

export type ObligationClosureResult =
  | Readonly<{ kind: "closed"; refs: readonly ClosedReference[] }>
  | Readonly<{ kind: "preparationLimit"; receipt: ContextWorkReceipt }>;

export type ObligationClosureInput = Readonly<{
  index: ReferenceIndex;
  seeds: readonly ObligationSeed[];
  budget: ContextWorkBudget;
  dependencies?: DependencyResolver;
}>;

/**
 * Walks outward from the seeds along typed relations, shared canonical facts
 * and declared dependencies until no obligation is left unclosed.
 *
 * The work key is `(ref, obligation)`, so the same ref may be admitted twice
 * for different reasons and expand differently, while a repeat of the same
 * reason terminates. Traversal is a queue over an adjacency index rather than
 * the repeated whole-catalog fixed point it replaces: unrelated records are
 * never visited at all, so a scene stays adjudicable as it accumulates
 * relations instead of getting closer to failing.
 *
 * The only bound is the deterministic work budget. Exhausting it yields
 * `preparationLimit` — never a quietly smaller closure presented as complete.
 */
export function closeObligations(input: ObligationClosureInput): ObligationClosureResult {
  const { index, budget } = input;
  const visited = new Set<string>();
  const admitted = new Map<string, { obligations: Set<ContextObligation>; basisRefs: Set<string> }>();
  const queue: (ObligationSeed & { basisRef?: string })[] = [];

  const enqueue = (seed: ObligationSeed, basisRef?: string): boolean => {
    if (!budget.charge("closureVisits", 1)) return false;
    queue.push(basisRef === undefined ? seed : { ...seed, basisRef });
    return true;
  };

  for (const seed of [...input.seeds].sort(seedOrder)) {
    if (!enqueue(seed)) return limited(budget);
  }

  while (queue.length > 0) {
    const item = queue.shift()!;
    const record = admitted.get(item.ref) ?? { obligations: new Set(), basisRefs: new Set() };
    record.obligations.add(item.obligation);
    if (item.basisRef !== undefined) record.basisRefs.add(item.basisRef);
    admitted.set(item.ref, record);

    // Keep the tuple delimiter escaped in source so this TypeScript file stays
    // text while preserving the original collision-free runtime key.
    const workKey = `${item.obligation}\u0000${item.ref}`;
    if (visited.has(workKey)) continue;
    visited.add(workKey);

    const node = index.nodes.get(item.ref);
    for (const seed of input.dependencies?.(item.ref, item.obligation, node) ?? []) {
      if (!enqueue(seed, item.ref)) return limited(budget);
    }
    if (!expands(item.obligation)) continue;

    // Scope is read as a container, never as a membership list. Expanding a
    // scene into everything standing in it is exactly the wide collection this
    // pipeline replaces; members enter through relations, facts or the
    // player's own reference instead.
    if (node?.sceneRef !== undefined && node.sceneRef !== item.ref) {
      if (!enqueue({ ref: node.sceneRef, obligation: "geometry" }, item.ref)) return limited(budget);
    }
    if (node?.definitionRef !== undefined) {
      if (!enqueue({ ref: node.definitionRef, obligation: item.obligation }, item.ref)) {
        return limited(budget);
      }
    }

    for (const edge of [
      ...index.relationsBySubject.get(item.ref) ?? [],
      ...index.relationsByObject.get(item.ref) ?? [],
    ]) {
      if (!budget.charge("relationEdgeVisits", 1)) return limited(budget);
      // An ended relation is history, not a current cause, and must not drag
      // its far end into the decisive set.
      if (edge.state !== "active") continue;
      const far = edge.subjectRef === item.ref ? edge.objectRef : edge.subjectRef;
      if (!enqueue({ ref: edge.relationRef, obligation: "relation" }, item.ref)) {
        return limited(budget);
      }
      if (!enqueue({ ref: far, obligation: "relation" }, edge.relationRef)) return limited(budget);
    }

    for (const factRef of index.factsBySubject.get(item.ref) ?? []) {
      if (!enqueue({ ref: factRef, obligation: "fact" }, item.ref)) return limited(budget);
    }

    // A canonical fact asserted about several refs binds them causally. Without
    // the co-subjects the KP would adjudicate around a cause it cannot see --
    // the hidden trigger behind a thrown stone is reachable only this way.
    if (item.obligation === "fact") {
      for (const subjectRef of node?.subjectRefs ?? []) {
        if (subjectRef === item.ref) continue;
        if (!enqueue({ ref: subjectRef, obligation: "relation" }, item.ref)) return limited(budget);
      }
    }
  }

  if (budget.exhausted()) return limited(budget);
  return Object.freeze({
    kind: "closed",
    refs: Object.freeze([...admitted]
      .map(([ref, record]) => Object.freeze({
        ref,
        obligations: Object.freeze([...record.obligations].sort(compareCodeUnits)),
        basisRefs: Object.freeze([...record.basisRefs].sort(compareCodeUnits)),
      }))
      .sort((left, right) => compareCodeUnits(left.ref, right.ref))),
  });
}

/**
 * Obligations that pull neighbours in. The rest are read for their own content:
 * `geometry` is the scope a decisive ref sits in, `safety` is the policy that
 * governs disclosure, and neither is a reason to walk further outward.
 */
function expands(obligation: ContextObligation): boolean {
  return obligation === "actor"
    || obligation === "target"
    || obligation === "instrument"
    || obligation === "relation"
    || obligation === "fact";
}

function seedOrder(left: ObligationSeed, right: ObligationSeed): number {
  return compareCodeUnits(left.ref, right.ref)
    || compareCodeUnits(left.obligation, right.obligation);
}

function limited(budget: ContextWorkBudget): ObligationClosureResult {
  return Object.freeze({ kind: "preparationLimit", receipt: budget.receipt() });
}
