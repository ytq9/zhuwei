import type { AuthoritativeWorldState, JsonRecord } from "./model";
import { isNonEmptyString, isRecord } from "./validation";
import { zoneEffectsIn, type ZoneEffectRecord } from "./world-effects";

/** SPEC 0012 §10.1: what the zones in a scene do to the creatures there.
 * A zone is a sphere around its frozen origin; distances are in inches,
 * elevation included. */

type Point = readonly [number, number, number];

function point(value: unknown): Point | undefined {
  if (!isRecord(value)) return undefined;
  const coordinates = [value.x, value.y, value.elevation ?? "0"].map(Number);
  return coordinates.every(Number.isFinite) ? [coordinates[0]!, coordinates[1]!, coordinates[2]!] : undefined;
}

function distanceToSegment(target: Point, from: Point, to: Point): number {
  const segment = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const length = segment[0]! ** 2 + segment[1]! ** 2 + segment[2]! ** 2;
  const along = length === 0 ? 0 : Math.max(0, Math.min(1,
    ((target[0] - from[0]) * segment[0]! + (target[1] - from[1]) * segment[1]! + (target[2] - from[2]) * segment[2]!) / length));
  const nearest = [from[0] + along * segment[0]!, from[1] + along * segment[1]!, from[2] + along * segment[2]!];
  return Math.hypot(target[0] - nearest[0]!, target[1] - nearest[1]!, target[2] - nearest[2]!);
}

function sceneOf(entity: JsonRecord): string | undefined {
  return isNonEmptyString(entity.sceneId) ? entity.sceneId : undefined;
}

/** SRD Fog Cloud: a heavily obscured area blocks vision entirely, so neither
 * creature sees the other when the line between them passes through one --
 * either standing inside it included. */
export function zoneBlocksSight(state: AuthoritativeWorldState, viewer: JsonRecord, other: JsonRecord): boolean {
  const scene = sceneOf(viewer), from = point(viewer.position), to = point(other.position);
  if (scene === undefined || scene !== sceneOf(other) || from === undefined || to === undefined) return false;
  return zoneEffectsIn(state, scene, "heavilyObscured").some((zone) => {
    const origin = point(zone.origin);
    return origin !== undefined && distanceToSegment(origin, from, to) <= Number(zone.radiusInches);
  });
}

/** Every corner of the creature's space, top and bottom, lies in the sphere. */
function entirelyInside(entity: JsonRecord, zone: ZoneEffectRecord): boolean {
  const center = point(entity.position), origin = point(zone.origin);
  if (center === undefined || origin === undefined) return false;
  const footprint = isRecord(entity.footprint) ? entity.footprint : {};
  const halfWidth = Number(footprint.width ?? 60) / 2, halfDepth = Number(footprint.depth ?? 60) / 2;
  const height = Number(footprint.height ?? 60);
  if (![halfWidth, halfDepth, height].every(Number.isFinite)) return false;
  return [-halfWidth, halfWidth].every((dx) => [-halfDepth, halfDepth].every((dy) => [0, height].every((dz) =>
    Math.hypot(center[0] + dx - origin[0], center[1] + dy - origin[1], center[2] + dz - origin[2]) <= Number(zone.radiusInches))));
}

/** SRD Silence: a creature entirely inside is deafened and immune to thunder
 * damage. */
export function entirelySilenced(state: AuthoritativeWorldState, entityId: string): boolean {
  const entity = state.combatRuntime.entities[entityId];
  const scene = entity === undefined ? undefined : sceneOf(entity);
  return entity !== undefined && scene !== undefined
    && zoneEffectsIn(state, scene, "silence").some((zone) => entirelyInside(entity, zone));
}

/** SRD Silence: no spell with a verbal component can be cast there -- by a
 * caster standing in the sphere. */
export function castingSilenced(state: AuthoritativeWorldState, entityId: string): boolean {
  const entity = state.combatRuntime.entities[entityId];
  const scene = entity === undefined ? undefined : sceneOf(entity), center = entity === undefined ? undefined : point(entity.position);
  return scene !== undefined && center !== undefined && zoneEffectsIn(state, scene, "silence").some((zone) => {
    const origin = point(zone.origin);
    return origin !== undefined && Math.hypot(center[0] - origin[0], center[1] - origin[1], center[2] - origin[2]) <= Number(zone.radiusInches);
  });
}
