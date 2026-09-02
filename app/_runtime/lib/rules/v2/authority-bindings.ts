import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState } from "./model";
import { itemPolicyVisibleToViewer } from "./item-projection";
import { isStoredSemanticDefinition } from "./semantic-definitions";
import { spatialRecordVisibleTo } from "./spatial-visibility";
import type { VersionedAuthorityBinding } from "./world-interaction-model";

export const VNEXT_CONTINUITY_AUTHORITY_COLLECTIONS = Object.freeze([
  "chapters",
  "relationships",
  "promises",
  "debts",
  "factions",
  "activities",
  "unresolvedThreats",
  "sourceClaims",
  "npcPlans",
  "factionPlans",
  "meaningfulFailures",
  "adjudicationPrecedents",
  "retryChanges",
  "sceneQuestions",
  "endingCandidates",
  "stories",
  "epilogues",
] as const);

export type AuthorityReadSetConflict = Readonly<{
  ref: string;
  expectedRevisionOrHash: string;
  actualRevisionOrHash: string | null;
}>;

/**
 * Resolves the one canonical version binding used by the frozen epistemic
 * snapshot, Proposal plan and Rules continuation. Composite actor/scene refs
 * deliberately include their tactical runtime because those mechanics are
 * part of the same adjudication dependency.
 */
export function authorityRevisionOrHash(
  state: AuthoritativeWorldState,
  ref: string,
): string | null {
  const entity = state.entities[ref];
  if (entity !== undefined) {
    const combat = state.combatRuntime.entities[ref];
    return canonicalSha256({ entity, ...(combat === undefined ? {} : { combat }) });
  }

  const scene = state.scenes[ref];
  if (scene !== undefined) {
    const combatScene = state.combatRuntime.scenes[ref];
    return canonicalSha256({ scene, ...(combatScene === undefined ? {} : { combatScene }) });
  }

  const itemEntry = state.campaignRuntime.itemSystem.entries[ref];
  if (itemEntry !== undefined) return canonicalSha256(itemEntry);

  const itemDefinition = state.campaignRuntime.itemSystem.definitions[ref];
  if (itemDefinition !== undefined) return canonicalSha256(itemDefinition);

  const definition = state.campaignRuntime.definitions[ref];
  if (definition !== undefined) {
    return isStoredSemanticDefinition(definition)
      ? definition.definitionHash
      : canonicalSha256(definition);
  }

  const ability = state.combatRuntime.definitions[ref];
  if (ability !== undefined) return canonicalSha256(ability);

  const fact = state.canonicalFacts[ref];
  if (fact !== undefined) return canonicalSha256(fact);

  const knowledge = authorityKnowledgeRecord(state, ref);
  if (knowledge !== undefined) return canonicalSha256(knowledge);

  if (ref === "continuity:campaign") {
    return state.campaignRuntime.campaign === null
      ? null
      : canonicalSha256(state.campaignRuntime.campaign);
  }

  if (ref.startsWith("profile-context:")) {
    const moduleRef = state.campaignRuntime.campaign?.moduleRef;
    return isPlainRecord(moduleRef)
      && moduleRef.profileId === ref.slice("profile-context:".length)
      && typeof moduleRef.profileHash === "string"
      ? moduleRef.profileHash
      : null;
  }

  if (ref.startsWith("continuity:")) {
    const [, collection, ...idParts] = ref.split(":");
    if (!VNEXT_CONTINUITY_AUTHORITY_COLLECTIONS.includes(
      collection as typeof VNEXT_CONTINUITY_AUTHORITY_COLLECTIONS[number],
    )) return null;
    const source = state.campaignRuntime[
      collection as typeof VNEXT_CONTINUITY_AUTHORITY_COLLECTIONS[number]
    ];
    const selected = idParts.length === 0
      ? source
      : isPlainRecord(source) ? source[idParts.join(":")] : undefined;
    return selected === undefined ? null : canonicalSha256(selected);
  }

  return null;
}

export function authorityReadSetConflicts(
  state: AuthoritativeWorldState,
  readSet: readonly VersionedAuthorityBinding[],
  skippedRefs: ReadonlySet<string> = new Set(),
): readonly AuthorityReadSetConflict[] {
  return Object.freeze(readSet.flatMap((binding) => {
    if (skippedRefs.has(binding.ref)) return [];
    const actualRevisionOrHash = authorityRevisionOrHash(state, binding.ref);
    return actualRevisionOrHash === binding.revisionOrHash
      ? []
      : [Object.freeze({
          ref: binding.ref,
          expectedRevisionOrHash: binding.revisionOrHash,
          actualRevisionOrHash,
        })];
  }).sort((left, right) => left.ref === right.ref ? 0 : left.ref < right.ref ? -1 : 1));
}

export function authorityReadSetMatches(
  state: AuthoritativeWorldState,
  readSet: readonly VersionedAuthorityBinding[],
  skippedRefs: ReadonlySet<string> = new Set(),
): boolean {
  return authorityReadSetConflicts(state, readSet, skippedRefs).length === 0;
}

export type AuthoritySpatialBinding = Readonly<{
  kind: "entity" | "itemEntry" | "sceneFeature";
  ref: string;
  sceneRef: string;
}>;

/** Resolves spatial role and location from authority state, never from labels,
 * material words, relation closure or incidental fields on non-spatial facts. */
export function authoritySpatialBinding(
  state: AuthoritativeWorldState,
  ref: string,
  sceneRef: string,
): AuthoritySpatialBinding | undefined {
  const entity = state.entities[ref];
  if (entity !== undefined) {
    return entity.sceneId === sceneRef
      ? Object.freeze({ kind: "entity", ref, sceneRef })
      : undefined;
  }

  const itemEntry = state.campaignRuntime.itemSystem.entries[ref];
  if (itemEntry !== undefined) {
    const inScene = (itemEntry.disposition === "scene" && itemEntry.sceneRef === sceneRef)
      || (itemEntry.holderRef !== null
        && itemEntry.disposition === "held"
        && state.entities[itemEntry.holderRef]?.sceneId === sceneRef);
    return inScene
      ? Object.freeze({ kind: "itemEntry", ref, sceneRef })
      : undefined;
  }

  const definition = state.campaignRuntime.definitions[ref];
  return isStoredSemanticDefinition(definition)
    && definition.semanticKind === "sceneFeature"
    && definition.content.sceneRef === sceneRef
    ? Object.freeze({ kind: "sceneFeature", ref, sceneRef })
    : undefined;
}

export function authorityRefBoundToScene(
  state: AuthoritativeWorldState,
  ref: string,
  sceneRef: string,
): boolean {
  return authoritySpatialBinding(state, ref, sceneRef) !== undefined;
}

/** Direct player targets need both a spatial binding and that player's current
 * projection permission. Hidden causes may still be cited through basisRefs or
 * resolved downstream by Rules and deliberately do not use this predicate. */
export function authoritySpatialRefVisibleTo(
  state: AuthoritativeWorldState,
  ref: string,
  sceneRef: string,
  viewerCharacterId: string,
): boolean {
  const binding = authoritySpatialBinding(state, ref, sceneRef);
  if (binding === undefined) return false;
  if (binding.kind === "entity") {
    if (ref === viewerCharacterId) return true;
    const spatial = state.combatRuntime.entities[ref];
    return spatial !== undefined && spatialRecordVisibleTo(state, spatial, viewerCharacterId);
  }
  if (binding.kind === "itemEntry") {
    const entry = state.campaignRuntime.itemSystem.entries[ref];
    const viewer = state.entities[viewerCharacterId];
    return entry !== undefined
      && viewer !== undefined
      && itemPolicyVisibleToViewer(entry.visibilityPolicyRef, {
        kind: viewer.kind,
        characterId: viewerCharacterId,
      }, entry);
  }
  const definition = state.campaignRuntime.definitions[ref];
  if (!isStoredSemanticDefinition(definition)) return false;
  const visibilityFactId = typeof definition.content.visibilityFactId === "string"
    ? definition.content.visibilityFactId
    : undefined;
  return spatialRecordVisibleTo(state, {
    id: ref,
    visibilityPolicyId: definition.visibilityPolicyRef,
    ...(visibilityFactId === undefined ? {} : { visibilityFactId }),
  }, viewerCharacterId);
}

function authorityKnowledgeRecord(
  state: AuthoritativeWorldState,
  ref: string,
): unknown | undefined {
  const marker = ref.startsWith("knowledge:")
    ? "knowledge:"
    : ref.startsWith("npc-knowledge:") ? "npc-knowledge:" : undefined;
  if (marker === undefined) return undefined;
  const remainder = ref.slice(marker.length);
  for (const holderRef of Object.keys(state.knowledge).sort((left, right) =>
    right.length - left.length || (left < right ? -1 : left > right ? 1 : 0))) {
    const prefix = `${holderRef}:`;
    if (!remainder.startsWith(prefix)) continue;
    return state.knowledge[holderRef]?.[remainder.slice(prefix.length)];
  }
  return undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
