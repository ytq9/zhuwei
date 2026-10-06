import type { ItemEntryV1, ItemSystemStateV1 } from "./items";

export function containedItemAccessible(system: ItemSystemStateV1, entry: ItemEntryV1): boolean {
  const seen = new Set([entry.entryId]);
  for (let ref = entry.containerRef; ref !== undefined;) {
    if (seen.has(ref)) return false;
    seen.add(ref);
    const parent = system.entries[ref];
    if (!parent) return entry.disposition === "scene";
    if (!["held", "scene"].includes(parent.disposition) || parent.stateMachine === undefined || parent.stateMachine?.state === "closed" || parent.stateMachine?.state === "locked") return false;
    ref = parent.containerRef;
  }
  return true;
}

/** SPEC 0001 §16: containerRef owns immediate placement. The existing
 * holder/scene fields are derived location indexes for inventory consumers.
 * Every native item transition reconciles them before validating its result. */
export function reconcileContainedItems(system: ItemSystemStateV1): string | undefined {
  const resolved = new Set<string>();
  const visiting = new Set<string>();
  const resolve = (entry: ItemEntryV1): string | undefined => {
    if (resolved.has(entry.entryId)) return undefined;
    if (visiting.has(entry.entryId)) return "itemContainerCycle";
    visiting.add(entry.entryId);
    const parent = entry.containerRef === undefined ? undefined : system.entries[entry.containerRef];
    if (parent !== undefined) {
      const issue = resolve(parent);
      if (issue) return issue;
      if (parent.disposition === "consumed" || parent.disposition === "destroyed") return "itemContainerUnavailable";
      if (parent.quantity !== 1 || system.definitions[parent.definitionRef]?.content.stackable) return "itemContainerMustBeIndividual";
      const priorHolder = entry.holderRef;
      entry.disposition = parent.disposition;
      entry.holderRef = parent.holderRef;
      entry.sceneRef = parent.sceneRef;
      entry.equippedSlot = null;
      delete entry.position;
      if (entry.visibilityPolicyRef === `visibility:character-controller:${priorHolder}` || entry.visibilityPolicyRef === "visibility:scene-observers") {
        entry.visibilityPolicyRef = parent.holderRef === null ? "visibility:scene-observers" : `visibility:character-controller:${parent.holderRef}`;
      }
    }
    visiting.delete(entry.entryId);
    resolved.add(entry.entryId);
    return undefined;
  };
  for (const entry of Object.values(system.entries)) {
    const issue = resolve(entry);
    if (issue) return issue;
  }
  return undefined;
}

/** Pure validation; reading saved state never silently repairs it. External
 * scene containers are validated by the world authority on admission. */
export function itemContainmentValid(system: ItemSystemStateV1): boolean {
  for (const entry of Object.values(system.entries)) {
    const seen = new Set([entry.entryId]);
    let ref = entry.containerRef;
    while (ref !== undefined) {
      if (seen.has(ref)) return false;
      seen.add(ref);
      const parent = system.entries[ref];
      if (parent === undefined) break;
      if (!["held", "scene"].includes(parent.disposition) || parent.quantity !== 1
        || system.definitions[parent.definitionRef]?.content.stackable
        || parent.disposition !== entry.disposition || parent.holderRef !== entry.holderRef || parent.sceneRef !== entry.sceneRef) return false;
      ref = parent.containerRef;
    }
  }
  return true;
}

/** Destroying a vessel does not silently destroy its separate contents.
 * The actual action must express any damage to those items independently. */
export function releaseContainerContents(system: ItemSystemStateV1, containerRef: string): void {
  const container = system.entries[containerRef];
  for (const entry of Object.values(system.entries)) {
    if (entry.containerRef !== containerRef) continue;
    if (container?.containerRef === undefined) delete entry.containerRef;
    else entry.containerRef = container.containerRef;
  }
}
