import type { ItemEntryV1 } from "./items";
import type { InventoryOperation } from "./inventory-operations";
import type { AtomicWorldInteractionStep } from "./world-interaction-model";

/** Exact containment paths, derived by the server from frozen entries or
 * same-bundle materializers. Not an order supplied by the model. */
export function inventoryContainerRefs(operation: InventoryOperation,
  entries: Readonly<Record<string, Pick<ItemEntryV1, "containerRef">>>): string[] {
  const refs = new Set<string>();
  const walk = (ref: string | undefined) => {
    const seen = new Set<string>();
    while (ref !== undefined && !seen.has(ref)) {
      seen.add(ref); refs.add(ref); ref = entries[ref]?.containerRef;
    }
  };
  if (operation.kind === "assemble") operation.components.forEach(component => walk(entries[component.entryRef]?.containerRef));
  else if (operation.kind !== "disassemble") walk(entries[operation.entryRef]?.containerRef);
  if (operation.kind === "store") walk(operation.containerRef);
  return [...refs].sort();
}

/** SPEC 0016 §7.3: a container access consumes the open interval. Conditions
 * are handled by the caller; a failed opener cannot enable an always take. */
export function containerAccessDependencies(steps: readonly AtomicWorldInteractionStep[], outcome: "success" | "failure"):
  Map<string, Set<string>> {
  const edges = new Map(steps.map(step => [step.proposalRef, new Set<string>()]));
  const transitions = steps.flatMap(step => {
    if (step.rulesInput.kind !== "resolveWorldInteraction") return [];
    const plan = step.rulesInput.plan;
    return plan.branches[plan.ruling.kind === "check" ? outcome : "success"].effects.flatMap(effect =>
      effect.kind === "objectStateTransition" ? [{ step, targetRef: effect.targetRef, intent: effect.intent }] : []);
  });
  const lastTransition = new Map<string, string>();
  const accessed = new Set(steps.flatMap(step => step.rulesInput.kind === "inventoryOperation" ? [...step.rulesInput.plan.containerRefs ?? []] : []));
  for (const transition of transitions) {
    if (!accessed.has(transition.targetRef)) continue;
    const previous = lastTransition.get(transition.targetRef);
    if (previous) edges.get(transition.step.proposalRef)!.add(previous);
    lastTransition.set(transition.targetRef, transition.step.proposalRef);
  }
  for (const step of steps) {
    if (step.rulesInput.kind !== "inventoryOperation") continue;
    for (const container of step.rulesInput.plan.containerRefs ?? []) {
      const related = transitions.filter(transition => transition.targetRef === container);
      for (const transition of related) {
        if (["open", "unlock"].includes(transition.intent)) edges.get(step.proposalRef)!.add(transition.step.proposalRef);
        else edges.get(transition.step.proposalRef)!.add(step.proposalRef);
      }
    }
  }
  return edges;
}
