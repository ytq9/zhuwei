import { authorityDefinitionComposite, authorityEntityComposite, authorityKnowledgeCatalog, authorityCharacterTimeline, authorityAbilityCatalog } from "../../../rules/v2/authority-bindings";
import { authorityItemComposite } from "../../../rules/v2/item-authority-vnext";
import {
  authorityGeometryFeatureAt,
  authorityGeometryFeatureAtVisibleTo,
  authoritySpatialRefVisibleTo,
  VNEXT_CONTINUITY_AUTHORITY_COLLECTIONS,
} from "../../../rules/authority-read";
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
    case "characterTimeline":
      return authorityCharacterTimeline(state, node.ref.slice("character-timeline:".length));
    case "geometryFeature":
      return indexedGeometryFeature(state, node)?.feature;
    case "scene":
      return state.scenes[node.ref];
    case "entity":
      return state.entities[node.ref];
    case "itemAssembly":
      return state.campaignRuntime.itemSystem.assemblies?.[node.ref];
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
    case "narrativeCommitment":
    case "narrativeBinding":
      return state.canonicalFacts[node.ref];
    case "knowledge":
      return node.knowledgeHolderRef === undefined
        ? undefined
        : state.knowledge[node.knowledgeHolderRef]?.[
            node.ref.slice(`knowledge:${node.knowledgeHolderRef}:`.length)
          ];
    case "knowledgeCatalog":
      return node.knowledgeHolderRef === undefined ? undefined : authorityKnowledgeCatalog(state, node.knowledgeHolderRef);
    case "abilityCatalog":
      return node.knowledgeHolderRef === undefined ? undefined : authorityAbilityCatalog(state, node.knowledgeHolderRef);
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
    return authorityEntityComposite(state,node.ref);
  }
  if (node.kind === "geometryFeature") return indexedGeometryFeature(state, node);
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
  if (node.kind === "campaignDefinition") return authorityDefinitionComposite(state, node.ref);
  if (node.kind === "itemEntry") return authorityItemComposite(state, node.ref);
  return indexableRecord(state, node);
}

/** Index entries carry a unique geometry locator over this frozen snapshot.
 * Other spatial kinds retain the shared authority resolver. */
export function indexedSpatialRefVisibleTo(
  state: AuthoritativeWorldState, node: ReferenceNode, sceneRef: string, viewerCharacterId: string,
): boolean {
  if (node.kind !== "geometryFeature") {
    return authoritySpatialRefVisibleTo(state, node.ref, sceneRef, viewerCharacterId);
  }
  return node.sceneRef === sceneRef && node.geometryIndex !== undefined
    && authorityGeometryFeatureAtVisibleTo(state, sceneRef, node.geometryIndex, node.ref, viewerCharacterId);
}

function indexedGeometryFeature(state: AuthoritativeWorldState, node: ReferenceNode) {
  return node.sceneRef === undefined || node.geometryIndex === undefined
    ? undefined : authorityGeometryFeatureAt(state, node.sceneRef, node.geometryIndex, node.ref);
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
