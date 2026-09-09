import { canonicalSha256 } from "../profiles/canonical";
import { authorityRefBoundToScene, authorityRevisionOrHash, authoritySpatialRefVisibleTo } from "./authority-bindings";
import type { AuthoritativeWorldState } from "./model";
import { canonicalFactVisibleToCharacter, isRecord } from "./validation";
import type { SemanticDefinitionOperation, SemanticFieldPolicy, SemanticJsonRecord, StoredSemanticDefinition } from "./semantic-definitions";

const fields = ["description", "observableState"] as const;

/** Follow the existing description/state field precedence without moving data
 * or exposing an arbitrary patch interface to KP. */
export function objectCompletionOperations(content: SemanticJsonRecord, description: string, state: string): SemanticDefinitionOperation[] {
  return fields.flatMap(field => {
    if (field === "observableState" && state === "none") return [];
    const path = content[field] === undefined && isRecord(content.semantics) && content.semantics[field] !== undefined
      ? ["semantics", field] : [field];
    return [{ kind: "set" as const, path, value: field === "description" ? description : state }];
  });
}

export const OBJECT_COMPLETION_FIELDS: readonly SemanticFieldPolicy[] = Object.freeze(fields.flatMap(field => [
  Object.freeze({ kind: "value" as const, path: Object.freeze([field]) }),
  Object.freeze({ kind: "value" as const, path: Object.freeze(["semantics", field]) }),
]));

/** Shared execution/replay guard. Semantic consistency with prose remains KP's
 * responsibility; this proves scope, audience and the closed data boundary. */
export function objectCompletionIssue(state: AuthoritativeWorldState, actorId: string,
  prior: StoredSemanticDefinition, next: StoredSemanticDefinition, basisRefs: readonly string[]): string | undefined {
  const actor = state.entities[actorId];
  const profileRef = basisRefs.find(ref => ref.startsWith("profile-context:") && authorityRevisionOrHash(state, ref) !== null);
  if (actor?.tenureStatus !== "active" || prior.semanticKind !== "sceneFeature" || next.semanticKind !== "sceneFeature"
    || !authorityRefBoundToScene(state, prior.definitionId, actor.sceneId)
    || !authoritySpatialRefVisibleTo(state, prior.definitionId, actor.sceneId, actorId)
    || !profileRef || !basisRefs.includes(actor.sceneId) || !basisRefs.includes(prior.definitionId)) {
    return "object-completion:visible-current-object-and-authority-required";
  }
  // An object keeps its audience. Every current observer of that object must
  // also be allowed to receive the supporting facts in its new description.
  const viewers = Object.values(state.entities).filter(viewer => viewer.tenureStatus === "active"
    && viewer.sceneId === actor.sceneId && authoritySpatialRefVisibleTo(state, prior.definitionId, actor.sceneId, viewer.id));
  if (basisRefs.some(ref => ref !== profileRef && ref !== actor.sceneId && viewers.some(viewer => state.canonicalFacts[ref]
    ? !canonicalFactVisibleToCharacter(state, state.canonicalFacts[ref], viewer)
    : !authoritySpatialRefVisibleTo(state, ref, actor.sceneId, viewer.id)))) {
    return "object-completion:audience-inaccessible-basis";
  }
  const fixed = (definition: StoredSemanticDefinition) => {
    const { revision: _revision, definitionHash: _hash, ...rest } = structuredClone(definition);
    const content = rest.content as Record<string, unknown>;
    for (const field of fields) { delete content[field]; if (isRecord(content.semantics)) delete content.semantics[field]; }
    return rest;
  };
  if (canonicalSha256(fixed(prior)) !== canonicalSha256(fixed(next))) return "object-completion:fixed-object-fields-changed";
  for (const field of fields) {
    const sources = [next.content, ...(isRecord(next.content.semantics) ? [next.content.semantics] : [])];
    if (sources.some(source => source[field] !== undefined && (typeof source[field] !== "string"
      || !source[field].trim() || source[field].length > (field === "description" ? 4000 : 500)))) {
      return "object-completion:description-and-state-must-be-text";
    }
  }
  return undefined;
}
