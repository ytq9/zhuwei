import { worldFactConstraints } from "./world-facts";
import { isRegisteredAbilityRecord } from "../profiles/ability-compiler";
import { dynamicDefinitionInScene } from "./dynamic-locations";
import { authorityItemComposite } from "./item-authority-vnext";
import { canonicalSha256 } from "../profiles/canonical";
import { isEnvironmentHazardDefinition } from "./environment-hazards";
import { hazardTriggerRelationRef } from "./hazard-lifecycle";
import type { AuthoritativeWorldState } from "./model";
import { itemPolicyVisibleToViewer } from "./item-projection";
import { isStoredSemanticDefinition } from "./semantic-definitions";
import { spatialRecordVisibleTo } from "./spatial-visibility";
import type { VersionedAuthorityBinding } from "./world-interaction-model";
import { characterTimelineId } from "./timeline";

export function characterTimelineAuthorityRef(characterId: string): string {
  return `character-timeline:${characterId}`;
}

/** Separate from actor mechanics: only a plan that depends on fiction time
 * selects this binding. It freezes both timeline membership and its clock. */
export function authorityCharacterTimeline(state: AuthoritativeWorldState, characterId: string) {
  const timelineId = state.entities[characterId] === undefined ? undefined : characterTimelineId(state, characterId);
  return timelineId === undefined ? undefined : {
    characterId, timelineId, timeline: state.fictionTimelines[timelineId],
  };
}

/** The actor's finite owned catalog, not another character's private loadout.
 * Mechanical source fields are retained; compiler execution graphs are not a
 * KP filling surface. The full registered record hash binds each source. */
export function authorityAbilityCatalog(state: AuthoritativeWorldState, characterId: string) {
  const actor = state.entities[characterId], combat = state.combatRuntime.entities[characterId];
  if (actor === undefined || combat === undefined || !Array.isArray(combat.abilityRefs)) return undefined;
  const metadata = new Set(["mechanicGraph", "referenceClosure", "compilerProfile", "compiledHash", "definitionHash"]);
  return { schema: "zhuwei.owned-ability-catalog/vnext-1", actorCharacterId: characterId,
    abilities: [...new Set(combat.abilityRefs.filter((ref): ref is string => typeof ref === "string"))].sort().map(abilityRef => {
      const definition = state.combatRuntime.definitions[abilityRef];
      return { abilityRef, registered: isRegisteredAbilityRecord(definition),
        definitionHash: definition === undefined ? null : canonicalSha256(definition),
        definition: definition === undefined ? null : Object.fromEntries(Object.entries(definition).filter(([key]) => !metadata.has(key))) };
    }),
  };
}

export const VNEXT_CONTINUITY_AUTHORITY_COLLECTIONS = Object.freeze([
  "chapters",
  "relationships",
  "promises",
  "debts",
  "factions",
  "activities",
  "unresolvedThreats",
  "sourceClaims",
  "conversationThreads",
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

/** The hazard and the current trigger connection are one adjudication read. */
export function authorityDefinitionComposite(state: AuthoritativeWorldState, ref: string) {
  const definition = state.campaignRuntime.definitions[ref];
  return isEnvironmentHazardDefinition(definition)
    ? { ...definition, triggerRelation: state.campaignRuntime.definitions[hazardTriggerRelationRef(ref)] ?? null }
    : definition;
}

/** Addresses only obstacles already persisted in a live scene. Static module
 * geometry and semantic templates are not authority records. A bare featureId
 * must identify exactly one record; duplicate ids never select the first scene.
 * The composite includes its scene so moving/replacing it invalidates the read. */
export function* authorityGeometryFeatureRecords(
  state: AuthoritativeWorldState,
  beforeVisit?: () => boolean,
): Generator<Readonly<{
  sceneRef: string;
  obstacleIndex: number;
  feature: Record<string, unknown> & { featureId: string };
}>> {
  for (const sceneRef of Object.keys(state.combatRuntime.scenes).sort()) {
    if (beforeVisit !== undefined && !beforeVisit()) return;
    const scene = state.combatRuntime.scenes[sceneRef]!;
    if (state.scenes[sceneRef] === undefined || !isPlainRecord(scene.geometry)
      || scene.geometry.schema !== "zhuwei.tactical-geometry/v1" || !Array.isArray(scene.geometry.obstacles)) continue;
    for (let obstacleIndex = 0; obstacleIndex < scene.geometry.obstacles.length; obstacleIndex += 1) {
      if (beforeVisit !== undefined && !beforeVisit()) return;
      const feature = scene.geometry.obstacles[obstacleIndex];
      if (!isPlainRecord(feature) || typeof feature.featureId !== "string"
        || feature.featureId.length === 0 || hasNonGeometryAuthorityRef(state, feature.featureId)) continue;
      yield { sceneRef, obstacleIndex, feature: feature as Record<string, unknown> & { featureId: string } };
    }
  }
}

/** Rereads a locator admitted by a unique-reference directory over the same
 * frozen snapshot. The locator is addressing only; its expected identity is
 * checked against the current obstacle rather than trusting a cached body.
 * Callers without that directory must use the global composite reader. */
export function authorityGeometryFeatureAt(
  state: AuthoritativeWorldState, sceneRef: string, obstacleIndex: number, ref: string,
) {
  if (!Number.isSafeInteger(obstacleIndex) || obstacleIndex < 0 || state.scenes[sceneRef] === undefined
    || hasNonGeometryAuthorityRef(state, ref)) return undefined;
  const geometry = state.combatRuntime.scenes[sceneRef]?.geometry;
  if (!isPlainRecord(geometry) || geometry.schema !== "zhuwei.tactical-geometry/v1"
    || !Array.isArray(geometry.obstacles)) return undefined;
  const feature = geometry.obstacles[obstacleIndex];
  return isPlainRecord(feature) && ref.length > 0 && feature.featureId === ref
    ? { sceneRef, feature: feature as Record<string, unknown> & { featureId: string } }
    : undefined;
}

/** Same policy as the global spatial reader, with an already unique frozen
 * locator so candidate visibility does not rescan the world's geometry. */
export function authorityGeometryFeatureAtVisibleTo(
  state: AuthoritativeWorldState, sceneRef: string, obstacleIndex: number, ref: string,
  viewerCharacterId: string,
): boolean {
  const record = authorityGeometryFeatureAt(state, sceneRef, obstacleIndex, ref);
  return record !== undefined && spatialRecordVisibleTo(state, { ...record.feature, id: ref }, viewerCharacterId);
}

export function authorityGeometryFeatureComposite(state: AuthoritativeWorldState, ref: string) {
  let found: Readonly<{ sceneRef: string; feature: Record<string, unknown> & { featureId: string } }> | undefined;
  for (const record of authorityGeometryFeatureRecords(state)) {
    if (record.feature.featureId !== ref) continue;
    if (found !== undefined) return undefined;
    found = { sceneRef: record.sceneRef, feature: record.feature };
  }
  return found;
}

function hasNonGeometryAuthorityRef(state: AuthoritativeWorldState, ref: string): boolean {
  return state.entities[ref] !== undefined || state.scenes[ref] !== undefined
    || state.campaignRuntime.definitions[ref] !== undefined
    || state.campaignRuntime.itemSystem.assemblies?.[ref] !== undefined
    || state.campaignRuntime.itemSystem.entries[ref] !== undefined
    || state.campaignRuntime.itemSystem.definitions[ref] !== undefined
    || state.combatRuntime.definitions[ref] !== undefined || state.canonicalFacts[ref] !== undefined
    || ["knowledge:", "knowledge-catalog:", "ability-catalog:", "npc-knowledge:", "continuity:", "profile-context:", "character-timeline:"].some(prefix => ref.startsWith(prefix));
}

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
  if (ref.startsWith("world-fact-constraints:")) {
    const frame = worldFactConstraints(state, ref.slice("world-fact-constraints:".length));
    return frame === undefined ? null : canonicalSha256(frame);
  }
  if (ref.startsWith("character-timeline:")) {
    const timeline = authorityCharacterTimeline(state, ref.slice("character-timeline:".length));
    return timeline === undefined ? null : canonicalSha256(timeline);
  }
  const entity = authorityEntityComposite(state,ref);
  if (entity !== undefined) return canonicalSha256(entity);

  const scene = state.scenes[ref];
  if (scene !== undefined) {
    const combatScene = state.combatRuntime.scenes[ref];
    return canonicalSha256({ scene, ...(combatScene === undefined ? {} : { combatScene }) });
  }

  const itemEntry = state.campaignRuntime.itemSystem.entries[ref];
  if (itemEntry !== undefined) return canonicalSha256(authorityItemComposite(state, ref));

  const assembly = state.campaignRuntime.itemSystem.assemblies?.[ref];
  if (assembly !== undefined) return canonicalSha256(assembly);

  const itemDefinition = state.campaignRuntime.itemSystem.definitions[ref];
  if (itemDefinition !== undefined) return canonicalSha256(itemDefinition);

  const definition = state.campaignRuntime.definitions[ref];
  if (definition !== undefined) {
    if (isEnvironmentHazardDefinition(definition as unknown)) return canonicalSha256(authorityDefinitionComposite(state, ref));
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

  if (ref.startsWith("knowledge-catalog:")) {
    const catalog = authorityKnowledgeCatalog(state, ref.slice("knowledge-catalog:".length));
    return catalog === undefined ? null : canonicalSha256(catalog);
  }
  if (ref.startsWith("ability-catalog:")) {
    const catalog = authorityAbilityCatalog(state, ref.slice("ability-catalog:".length));
    return catalog === undefined ? null : canonicalSha256(catalog);
  }

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

  const geometryFeature = authorityGeometryFeatureComposite(state, ref);
  return geometryFeature === undefined ? null : canonicalSha256(geometryFeature);
}

/** Character mechanics include independent sourced effects. A grant or expiry
 * must invalidate the same ref that prepares and commits a character action. */
export function authorityEntityComposite(state:AuthoritativeWorldState,ref:string) {
  const entity=state.entities[ref];
  if(entity===undefined)return undefined;
  const combat=state.combatRuntime.entities[ref];
  const effects=Object.values(state.combatRuntime.effects).filter(effect=>effect.targetEntityId===ref)
    .sort((a,b)=>String(a.effectId).localeCompare(String(b.effectId)));
  return {entity,...(combat===undefined?{}:{combat}),...(effects.length===0?{}:{effects})};
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
  kind: "entity" | "itemEntry" | "itemAssembly" | "sceneFeature" | "geometryFeature" | "hazard" | "location" | "passage";
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
  return resolveAuthoritySpatialBinding(state, ref, sceneRef, new Set());
}

function resolveAuthoritySpatialBinding(
  state: AuthoritativeWorldState, ref: string, sceneRef: string, visited: Set<string>,
): AuthoritySpatialBinding | undefined {
  if (visited.has(ref)) return undefined;
  visited.add(ref);
  const entity = state.entities[ref];
  if (entity !== undefined) {
    return entity.sceneId === sceneRef
      ? Object.freeze({ kind: "entity", ref, sceneRef })
      : undefined;
  }

  const assembly = state.campaignRuntime.itemSystem.assemblies?.[ref];
  if (assembly?.state === "active" && assembly.sceneRef === sceneRef) return Object.freeze({ kind: "itemAssembly", ref, sceneRef });

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
  if (definition !== undefined && isEnvironmentHazardDefinition(definition as unknown)) {
    const triggerRef = String((definition.content as { trigger: { ref: string } }).trigger.ref);
    return resolveAuthoritySpatialBinding(state, triggerRef, sceneRef, visited) === undefined
      ? undefined : Object.freeze({ kind: "hazard", ref, sceneRef });
  }
  if (isStoredSemanticDefinition(definition)
    && definition.semanticKind === "sceneFeature"
    && definition.content.sceneRef === sceneRef) return Object.freeze({ kind: "sceneFeature", ref, sceneRef });
  if (isStoredSemanticDefinition(definition) && (definition.semanticKind === "location" || definition.semanticKind === "passage")
    && dynamicDefinitionInScene(state, definition, sceneRef)) return Object.freeze({ kind: definition.semanticKind, ref, sceneRef });
  const geometryFeature = authorityGeometryFeatureComposite(state, ref);
  return geometryFeature?.sceneRef === sceneRef
    ? Object.freeze({ kind: "geometryFeature", ref, sceneRef }) : undefined;
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
  if (binding.kind === "itemAssembly") return state.entities[viewerCharacterId]?.sceneId === sceneRef;
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
  if (binding.kind === "geometryFeature") {
    const record = authorityGeometryFeatureComposite(state, ref);
    return record !== undefined && spatialRecordVisibleTo(state, { ...record.feature, id: ref }, viewerCharacterId);
  }
  const definition = state.campaignRuntime.definitions[ref];
  if (binding.kind === "hazard" && isEnvironmentHazardDefinition(definition)) {
    return spatialRecordVisibleTo(state, { id: ref, visibilityPolicyId: definition.visibilityPolicyRef }, viewerCharacterId);
  }
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

/** Complete membership witness, including an empty collection. Individual
 * records remain separate frozen entries; hashes bind all known content and
 * acquisition metadata without copying it into a second model-facing body. */
export function authorityKnowledgeCatalog(state: AuthoritativeWorldState, characterId: string) {
  if (state.entities[characterId] === undefined) return undefined;
  return { schema: "zhuwei.held-knowledge-catalog/v1", characterId,
    records: Object.keys(state.knowledge[characterId] ?? {}).sort().map(knowledgeRef => ({
      knowledgeRef, recordRef: `knowledge:${characterId}:${knowledgeRef}`,
      recordHash: canonicalSha256(state.knowledge[characterId]![knowledgeRef]),
    })),
  };
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
