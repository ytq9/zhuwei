import { isCanonicalTacticalGeometry } from "../profiles/tactical-geometry";
import type { TacticalPosition } from "../tactical-projection";
import type { AuthoritativeWorldState } from "./model";
import { isRecord } from "./validation";

export type DynamicCombatantSpawn =
  | { kind: "legacy" }
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
 * The sole allocator for a combatant introduced after genesis. Tactical rooms
 * can only use their pinned scene spawn list; legacy rooms retain the historical
 * ordinal placement in buildPlayerCombatEntity.
 */
export function allocateDynamicCombatantSpawn(
  state: AuthoritativeWorldState,
  sceneId: string,
): DynamicCombatantSpawn {
  const campaign = state.campaignRuntime.campaign;
  const tacticalRoom = isRecord(campaign)
    && isRecord(campaign.moduleRef)
    && typeof campaign.moduleRef.profileId === "string"
    && campaign.moduleRef.profileId.endsWith(":tactical-map-v1");
  const scene = state.combatRuntime.scenes[sceneId];
  const geometry = isRecord(scene) ? scene.geometry : undefined;
  if (!isCanonicalTacticalGeometry(geometry)) {
    return tacticalRoom ? { kind: "unavailable" } : { kind: "legacy" };
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
