import { isCanonicalTacticalGeometry } from "../profiles/tactical-geometry";
import type { TacticalPosition } from "../tactical-projection";
import type { AuthoritativeWorldState } from "./model";
import { isRecord } from "./validation";

export type DynamicCombatantSpawn =
  | { kind: "allocated"; position: TacticalPosition }
  | { kind: "unavailable" };

function positionKey(position: TacticalPosition): string {
  return `${position.x}\u0000${position.y}\u0000${position.elevation}`;
}

function occupiedPositionKey(value: unknown): string | undefined {
  if (!isRecord(value)
    || typeof value.x !== "string"
    || typeof value.y !== "string"
    || typeof value.elevation !== "string") return undefined;
  return `${value.x}\u0000${value.y}\u0000${value.elevation}`;
}

/**
 * The sole allocator for a combatant introduced after genesis. 0.4 rooms can
 * only use their pinned scene spawn list.
 */
export function allocateDynamicCombatantSpawn(
  state: AuthoritativeWorldState,
  sceneId: string,
): DynamicCombatantSpawn {
  const scene = state.combatRuntime.scenes[sceneId];
  const geometry = isRecord(scene) ? scene.geometry : undefined;
  if (!isCanonicalTacticalGeometry(geometry)) {
    return { kind: "unavailable" };
  }

  const occupied = new Set(
    Object.values(state.combatRuntime.entities)
      .filter((entity) => entity.sceneId === sceneId)
      .map((entity) => occupiedPositionKey(entity.position))
      .filter((entry): entry is string => entry !== undefined),
  );
  const available = geometry.spawnPoints.find((entry) => !occupied.has(positionKey(entry)));
  return available === undefined
    ? { kind: "unavailable" }
    : { kind: "allocated", position: structuredClone(available) };
}
