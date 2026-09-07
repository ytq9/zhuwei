import { authorityRefBoundToScene, authoritySpatialRefVisibleTo } from "./authority-bindings";
import type { AuthoritativeWorldState } from "./model";

/** A scene is an observation scope, not an object with mechanical Geometry.
 * Keep this read predicate shared by Proposal lowering and Rules validation. */
export function authorityWorldInteractionTargetVisibleTo(
  state: AuthoritativeWorldState,
  ref: string,
  actorCharacterId: string,
  interaction: Readonly<{
    sceneRef: string;
    abilityRef: string | null;
    branches: Readonly<{
      success: Readonly<{ effects: readonly unknown[] }>;
      failure: Readonly<{ effects: readonly unknown[] }>;
    }>;
  }>,
): boolean {
  if (ref === interaction.sceneRef) {
    return state.entities[actorCharacterId]?.sceneId === ref
      && state.scenes[ref] !== undefined
      && interaction.abilityRef === null
      && interaction.branches.success.effects.length === 0
      && interaction.branches.failure.effects.length === 0;
  }
  return authorityRefBoundToScene(state, ref, interaction.sceneRef)
    && authoritySpatialRefVisibleTo(state, ref, interaction.sceneRef, actorCharacterId);
}
