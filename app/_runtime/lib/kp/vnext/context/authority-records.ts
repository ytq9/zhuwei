import { VNEXT_CONTINUITY_AUTHORITY_COLLECTIONS } from "../../../rules/authority-read";
import type { AuthoritativeWorldState } from "../../../rules/authority-read";
import { isPlainRecord } from "../canonical-json";
import type { ReferenceNode } from "./reference-index";

/**
 * The primary record behind an addressed ref, read from the frozen snapshot.
 *
 * Retrieval only ever yields refs; the body is read back here so a candidate is
 * grounded in authority state rather than in whatever the index happened to
 * remember. Composite bindings used for version checking live with the read
 * seam and are deliberately not duplicated here.
 */
export function indexableRecord(
  state: AuthoritativeWorldState,
  node: ReferenceNode,
): unknown {
  switch (node.kind) {
    case "scene":
      return state.scenes[node.ref];
    case "entity":
      return state.entities[node.ref];
    case "itemEntry":
      return state.campaignRuntime.itemSystem.entries[node.ref];
    case "itemDefinition":
      return state.campaignRuntime.itemSystem.definitions[node.ref];
    case "semanticDefinition":
    case "campaignDefinition":
      return state.campaignRuntime.definitions[node.ref];
    case "abilityDefinition":
      return state.combatRuntime.definitions[node.ref];
    case "canonicalFact":
      return state.canonicalFacts[node.ref];
    case "knowledge":
      return node.knowledgeHolderRef === undefined
        ? undefined
        : state.knowledge[node.knowledgeHolderRef]?.[
            node.ref.slice(`knowledge:${node.knowledgeHolderRef}:`.length)
          ];
    default:
      return undefined;
  }
}

/**
 * The exact value the read seam versions for this ref.
 *
 * Composition must match `authorityRevisionOrHash` element for element: an
 * entry whose body and whose `revisionOrHash` came from different shapes would
 * bind the KP to one thing and the transaction to another. Actor and scene refs
 * deliberately carry their tactical runtime because those mechanics are part of
 * the same adjudication dependency.
 */
export function authorityCompositeRecord(
  state: AuthoritativeWorldState,
  node: ReferenceNode,
): unknown {
  if (node.kind === "entity") {
    const entity = state.entities[node.ref];
    if (entity === undefined) return undefined;
    const combat = state.combatRuntime.entities[node.ref];
    return combat === undefined ? { entity } : { entity, combat };
  }
  if (node.kind === "scene") {
    const scene = state.scenes[node.ref];
    if (scene === undefined) return undefined;
    const combatScene = state.combatRuntime.scenes[node.ref];
    return combatScene === undefined ? { scene } : { scene, combatScene };
  }
  if (node.kind === "continuityCollection" || node.kind === "continuityEntry") {
    return continuityValue(state, node);
  }
  if (node.kind === "profileContext") {
    const moduleRef = state.campaignRuntime.campaign?.moduleRef;
    return isPlainRecord(moduleRef) ? { moduleRef } : undefined;
  }
  return indexableRecord(state, node);
}

function continuityValue(state: AuthoritativeWorldState, node: ReferenceNode): unknown {
  if (node.ref === "continuity:campaign") return state.campaignRuntime.campaign ?? undefined;
  const [, collection, ...idParts] = node.ref.split(":");
  if (!VNEXT_CONTINUITY_AUTHORITY_COLLECTIONS.includes(
    collection as typeof VNEXT_CONTINUITY_AUTHORITY_COLLECTIONS[number],
  )) return undefined;
  const source = state.campaignRuntime[
    collection as typeof VNEXT_CONTINUITY_AUTHORITY_COLLECTIONS[number]
  ];
  if (idParts.length === 0) return source;
  return isPlainRecord(source) ? source[idParts.join(":")] : undefined;
}
