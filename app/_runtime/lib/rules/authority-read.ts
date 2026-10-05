/**
 * Public read-only view over authority state, for consumers that must *reason
 * about* the world without being able to change it.
 *
 * `index.ts` stays the narrow verb seam — only `step`, `project` and `replay`
 * advance or read the world through Rules. Nothing re-exported here writes,
 * rolls, advances fiction time or emits events: they resolve version bindings,
 * spatial scope, viewer permission and stored semantic shape from a snapshot
 * the caller already holds. That makes them safe to share with adjudication
 * context preparation and Proposal lowering without creating a second
 * mechanics or state authority.
 *
 * Adding a symbol here is a deliberate widening of the read seam. Anything
 * that mutates, decides mechanics or produces randomness belongs behind
 * `step`, not here.
 */
export {
  authorityGeometryFeatureAt,
  authorityGeometryFeatureAtVisibleTo,
  authorityGeometryFeatureComposite,
  authorityGeometryFeatureRecords,
  authorityReadSetConflicts,
  authorityReadSetMatches,
  authorityRefBoundToScene,
  authorityRevisionOrHash,
  authoritySpatialBinding,
  authoritySpatialRefVisibleTo,
  VNEXT_CONTINUITY_AUTHORITY_COLLECTIONS,
  type AuthorityReadSetConflict,
  type AuthoritySpatialBinding,
} from "./v2/authority-bindings";

export {
  composeDefinition,
  createDefinitionSnapshot,
  isStoredSemanticDefinition,
  normalizedProspectiveRef,
  semanticDefinitionSnapshot,
  storedSemanticDefinition,
  type DefinitionSnapshot,
  type SemanticDefinitionKind,
  type SemanticDefinitionOperation,
  type SemanticFieldPolicy,
  type StoredSemanticDefinition,
} from "./v2/semantic-definitions";

export { canonicalFactVisibleToCharacter } from "./v2/validation";
// SPEC 0006 §7: an NPC's own context lists where it can walk.
export { isDynamicLocationScene, passageFactRef, resolvePassageTraversal } from "./v2/dynamic-locations";
export { authorityWorldInteractionTargetVisibleTo } from "./v2/world-interaction-targets";
// SPEC 0014 §4 (ADR 0087): whether the actor can first walk within its scene;
// a read of the scene map. Rules plans and commits the walk only in `step`.
export { sceneApproachIssue, sceneApproachTargetRefs } from "./v2/scene-approach";
export type { WorldInteractionApproach } from "./v2/scene-approach";
// SPEC 0014 §4 (ADR 0092): where a jump script starts, read when it is lowered.
export { planJumpTakeoff } from "./v2/character-jump";
// SPEC 0014 §4 (ADR 0100): the check a climb or swim asks, by height and material.
export { terrainCheckRequirement, terrainChecksFor } from "./v2/terrain-checks";
// SPEC 0014 §4 (ADR 0098): the terrain a map feature may record, offered to the KP when it maps a new place.
export { TACTICAL_LANDFORMS, TACTICAL_MATERIALS, TACTICAL_WATER_CURRENTS } from "./tactical-projection";
// A holder-bound, pinned content read for relevance and short recall gists.
export { authorityKnowledgeText } from "./v2/world-facts";
// SPEC 0016 §4.3 (ADR 0111): the fiction day a memory was acquired on, by
// which a holder's directory groups its older memories.
export { fictionDayOf } from "./v2/promise-due";
export { itemEntryResourceId } from "./v2/items";
export { authorityEquippedItemWeaponAbilityRefs } from "./v2/item-authority-vnext";
// SPEC 0016 §7: the snapshot-dependency edges of a typed Bundle are a pure
// function of its steps; lowering must order the same edges Rules compiles.
export { atomicSnapshotDependencies } from "./v2/atomic-snapshot-dependencies";
export { primaryConcealmentFailureSource } from "./v2/world-interaction-model";
export {
  COMBAT_ACT_ROOT_PREFIX,
  committedRangeUsesFrozenRenderableClaims,
  frozenRenderableClaimsConform,
  isCombatMapRoot,
  type FrozenRenderableClaims,
} from "./v2/claims";

export type {
  AuthoritativeWorldState,
  CanonicalFactRecord,
  CharacterRecord,
  JsonRecord,
  KnowledgeRecord,
  KpSpatialReadModel,
  PublicReceipt,
} from "./v2/model";
// SPEC 0014 §4 (ADR 0098): where a climb, swim or high jump script starts and
// ends, read when it is lowered; Rules judges the move again when it commits.
export { planTerrainTraversal } from "./v2/terrain-traversal";
export { portalTransitionPlan } from "./v2/environment";
export { actorEndAfter, actorEndNow, type ActorEnd } from "./v2/actor-end";
export type { TerrainMove, TerrainRejection, TerrainTraversal } from "./v2/terrain-traversal";
// SPEC 0006 §§6、7: what the NPC whose combat turn it is may do now, from its own
// view, and whether a plan fits those options. Rules takes the plan's steps
// only in `step`; the dry runs these read are discarded.
export { npcCombatTurnHasNoChoice, npcCombatTurnOptions, npcCombatTurnPlanIssues } from "./v2/npc-turn-options";
export type { NpcCombatTurnOptions } from "./v2/npc-turn-options";
export { isNpcCombatTurnSteps, npcCombatTurnOf, NPC_BASIC_ACTIONS, NPC_COMBAT_TURN_MAX_STEPS, NPC_READY_EVENTS } from "./v2/npc-combat-turn-state";
export type { NpcCombatTurnDue, NpcCombatTurnStep } from "./v2/npc-combat-turn-state";
// SPEC 0012 §§3、5: whether a KP's combat start holds against this snapshot
// (who is present, hostility, surprise, an NPC's first statistics) and what
// it reads. Lowering turns the problems into revision diagnostics; Rules
// checks the same in `step`.
export { combatStartIssues, combatStartReadRefs } from "./v2/combat-start";
export type { CombatStartIssue } from "./v2/combat-start";
// SPEC 0014 §4 (ADR 0103): where the actor can go from its scene over the
// place map, for the KP's frozen context, and the route and first walk of a
// move there, read when it is lowered. Rules plans the move again in `step`.
export { placesReachableFrom, planPlaceDeparture, visitedSceneIds } from "./v2/places";
export type { PlaceConnection, PlaceConnectionSide, PlaceMap, PlaceRoute, ReachablePlace } from "./v2/places";
