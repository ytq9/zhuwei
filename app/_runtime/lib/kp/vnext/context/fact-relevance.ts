import type { DiscoveredCandidate } from "./candidate-discovery";
import type { ReferenceIndex } from "./reference-index";

/**
 * Which item-scoped canonical facts one action can touch.
 *
 * A fact asserted about the scene, its people or its definitions is always
 * admitted: it is the constraint frame the KP rules inside. A fact asserted
 * about an item instance, definition or assembly is a hidden truth about that
 * item, and SPEC 0016 §4.3 retrieves such material before closing, instead of
 * collecting every truth in the room and trimming afterwards. It enters through
 * one of its own item subjects once the closure reaches that item, or when the
 * player's words, UI focus or the actor's own possessions reach one of them.
 * This decides what is read, never what exists: the complete frame stays the
 * versioned membership binding that lowering and Rules compare at commit.
 */
export type FactRelevance = Readonly<{
  admits(fact: Readonly<{ subjectRefs: readonly string[] }>, viaRef?: string): boolean;
}>;

export function createFactRelevance(input: Readonly<{
  index: ReferenceIndex;
  actorCharacterId: string;
  candidates: readonly DiscoveredCandidate[];
  focusRefs?: readonly string[];
}>): FactRelevance {
  const { index } = input;
  const relevant = new Set<string>([input.actorCharacterId,
    ...input.candidates.map(({ ref }) => ref), ...(input.focusRefs ?? [])]);
  for (const entryRef of index.itemEntriesByHolder.get(input.actorCharacterId) ?? []) {
    relevant.add(entryRef);
    const definitionRef = index.nodes.get(entryRef)?.definitionRef;
    if (definitionRef !== undefined) relevant.add(definitionRef);
  }
  const itemSubject = (ref: string): boolean => {
    const kind = index.nodes.get(ref)?.kind;
    return kind === "itemEntry" || kind === "itemDefinition" || kind === "itemAssembly";
  };
  return Object.freeze({
    admits(fact, viaRef) {
      const items = fact.subjectRefs.filter(itemSubject);
      if (items.length === 0) return true;
      if (viaRef !== undefined && items.includes(viaRef)) return true;
      return items.some((ref) => relevant.has(ref));
    },
  });
}
