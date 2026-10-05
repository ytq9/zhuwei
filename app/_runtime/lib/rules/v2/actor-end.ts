import { terrainFooting } from "../profiles/combat-geometry";
import { isCanonicalTacticalGeometry, isHollowTacticalFeature } from "../profiles/tactical-geometry";
import type { AuthoritativeWorldState } from "./model";
import { placeRefForScene } from "./places";
import { isRecord } from "./validation";

// SPEC 0014 §4 (ADR 0106): where an act leaves its actor -- the place, and
// whether it stands on the ground, down in a ditch or water, or on top of a
// step, wall or cliff -- as the actor-move effects it commits put it. The KP
// says where each outcome leaves the actor; a step that moves it otherwise
// goes back for revision (round 167 wrote "reached the yard" over a step that
// moved no one, and "climbed out" over a climb down).

export type ActorFooting = "ground" | "inside" | "onTop";
export type ActorEnd = Readonly<{ placeRef: string; footing: ActorFooting; featureRef: string | null }>;

/** Where the actor is now, or undefined when it is not on a map. */
export function actorEndNow(state: AuthoritativeWorldState, actorId: string): ActorEnd | undefined {
  const actor = state.entities[actorId], body = state.combatRuntime.entities[actorId];
  const scene = actor === undefined ? undefined : state.combatRuntime.scenes[actor.sceneId];
  if (actor === undefined || !isRecord(body) || !isRecord(body.position) || !isRecord(scene)) return undefined;
  const position = body.position as unknown as Parameters<typeof terrainFooting>[1];
  const footing = terrainFooting(scene, position);
  return { placeRef: placeRefForScene(state, actor.sceneId), footing: footing.kind === "floor" ? "ground" : footing.kind,
    featureRef: footing.kind === "floor" ? null : String(footing.feature.featureId) };
}

/** Where `effects`, applied in order from `start`, leave the actor. Effects
 * that do not move the actor between places or heights leave it as it was;
 * a walk never does (ADR 0098). */
export function actorEndAfter(state: AuthoritativeWorldState, start: ActorEnd, effects: readonly unknown[]): ActorEnd {
  let end = start;
  for (const effect of effects) {
    if (!isRecord(effect)) continue;
    if (effect.kind === "travelTo" && typeof effect.destinationRef === "string") {
      end = { placeRef: effect.destinationRef, footing: "ground", featureRef: null };
      continue;
    }
    if (!["climbFeature", "jumpOnto", "jumpOver", "fallFrom"].includes(String(effect.kind)) || typeof effect.featureRef !== "string") continue;
    const hollow = featureIsHollow(state, effect.featureRef);
    if (hollow === undefined) continue;
    const footing: ActorFooting = effect.kind === "jumpOnto" ? "onTop" : effect.kind === "jumpOver" ? "ground"
      : effect.kind === "fallFrom" ? (hollow ? "inside" : "ground")
      : effect.direction === "down" ? (hollow ? "inside" : "ground")
      : effect.direction === "up" ? (hollow ? "ground" : "onTop") : "ground";
    end = { placeRef: end.placeRef, footing, featureRef: footing === "ground" ? null : effect.featureRef };
  }
  return end;
}

function featureIsHollow(state: AuthoritativeWorldState, featureRef: string): boolean | undefined {
  for (const scene of Object.values(state.combatRuntime.scenes)) {
    const geometry = isRecord(scene) ? scene.geometry : undefined;
    if (!isCanonicalTacticalGeometry(geometry)) continue;
    const feature = geometry.obstacles.find(candidate => candidate.featureId === featureRef);
    if (feature !== undefined) return isHollowTacticalFeature(feature);
  }
  return undefined;
}
