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
  // SPEC 0006 §7: the scene an NPC walks to is the target of that move.
  if ([interaction.branches.success, interaction.branches.failure].some((branch) => branch.effects.some((effect) =>
    isMoveToScene(effect, ref)))) {
    return state.scenes[ref] !== undefined && state.entities[actorCharacterId]?.kind === "npc";
  }
  return authorityRefBoundToScene(state, ref, interaction.sceneRef)
    && authoritySpatialRefVisibleTo(state, ref, interaction.sceneRef, actorCharacterId);
}

function isMoveToScene(effect: unknown, sceneRef: string): boolean {
  if (effect === null || typeof effect !== "object" || Array.isArray(effect)) return false;
  const { kind, destination } = effect as { kind?: unknown; destination?: unknown };
  return kind === "moveNpc" && destination !== null && typeof destination === "object"
    && (destination as { kind?: unknown }).kind === "scene" && (destination as { sceneRef?: unknown }).sceneRef === sceneRef;
}
