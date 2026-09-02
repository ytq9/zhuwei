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
  semanticDefinitionSnapshot,
  storedSemanticDefinition,
  type DefinitionSnapshot,
  type SemanticDefinitionKind,
  type SemanticDefinitionOperation,
  type SemanticFieldPolicy,
  type StoredSemanticDefinition,
} from "./v2/semantic-definitions";

export { canonicalFactVisibleToCharacter } from "./v2/validation";
export { itemEntryResourceId } from "./v2/items";
export {
  frozenRenderableClaimsConform,
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
