import {
  analyzeCombatMovement,
  canonicalCombatPoint,
  entitiesWithinRange,
  entityOccupanciesOverlap,
  entitySizeRank,
  type CanonicalCombatPoint,
} from "../profiles/combat-geometry";
import { sameCanonical } from "../profiles/canonical";
import { grappledBy } from "./contest";
import type { AuthoritativeWorldState, JsonRecord } from "./model";
import { hasExactKeys, isNonEmptyString, isRecord } from "./validation";

/** SPEC 0014 §4 (ADR 0090): a creature held in a grapple moves with the one
 * holding it and stops beside it, out of an encounter on a walk within the
 * scene and in one on each committed movement segment. */
export type CarriedCreature = { characterId: string; position: CanonicalCombatPoint };

/** Next to: the two measurement cores within 5 feet, as for melee reach. */
const NEXT_TO_INCHES = "60";
/** Scene positions are planned on a half-square lattice, so a walker on one
 * 5-foot grid can still stop beside someone standing on another. */
export const SCENE_GRID_STEP = 30n;

/** One entry per held creature, in code-unit order, each at an integer point. */
export function isCarriedCreatures(value: unknown): value is CarriedCreature[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry, index) => isRecord(entry)
    && hasExactKeys(entry, ["characterId", "position"]) && isNonEmptyString(entry.characterId)
    && sameCanonical(canonicalCombatPoint(entry.position) ?? null, entry.position)
    && (index === 0 || String((value[index - 1] as JsonRecord).characterId) < entry.characterId));
}

/** The bodies of the creatures `actorId` holds in a grapple in this scene. */
export function heldBodies(state: AuthoritativeWorldState, actorId: string, sceneRef: string): JsonRecord[] {
  return grappledBy(state, actorId).map(id => state.combatRuntime.entities[id])
    .filter((entity): entity is JsonRecord => isRecord(entity) && entity.sceneId === sceneRef
      && isRecord(entity.position) && isRecord(entity.footprint));
}

/** SRD 5.1: dragging or carrying a grappled creature halves the mover's
 * speed, unless the creature is two or more sizes smaller; each foot moved
 * then costs two. */
export function dragCostFactor(mover: JsonRecord, held: readonly JsonRecord[]): bigint {
  return held.some(body => entitySizeRank(mover) - entitySizeRank(body) < 2) ? 2n : 1n;
}

/** The scene boundary of canonical tactical geometry, or undefined. */
export function sceneBoundary(scene: unknown): { x: bigint; y: bigint }[] | undefined {
  const geometry = isRecord(scene) ? scene.geometry : undefined;
  const points = isRecord(geometry) && isRecord(geometry.boundary) ? geometry.boundary.points : undefined;
  if (!Array.isArray(points) || points.length < 3) return undefined;
  const parsed = points.map(point => isRecord(point) && typeof point.x === "string" && typeof point.y === "string"
    && /^-?(0|[1-9][0-9]*)$/u.test(point.x) && /^-?(0|[1-9][0-9]*)$/u.test(point.y)
    ? { x: BigInt(point.x), y: BigInt(point.y) } : undefined);
  return parsed.every(point => point !== undefined) ? parsed as { x: bigint; y: bigint }[] : undefined;
}

/** Where each held creature stops when the walker stops at `walkerAtEnd`,
 * having come from `from`: flush against the walker, inside the scene, on
 * nobody else and with nothing impassable between the walker and it. The spot
 * nearest `from` is taken, so the held creature trails behind; ties go to the
 * lower y, then x. Undefined when one has no room. */
export function placeCarriedCreatures(scene: JsonRecord, boundary: readonly { x: bigint; y: bigint }[], walkerAtEnd: JsonRecord,
  from: CanonicalCombatPoint, held: readonly JsonRecord[], others: readonly JsonRecord[]): CarriedCreature[] | undefined {
  const end = canonicalCombatPoint(walkerAtEnd.position)!;
  const placed: CarriedCreature[] = [];
  const taken: JsonRecord[] = [];
  for (const body of [...held].sort((left, right) => String(left.id ?? left.entityId) < String(right.id ?? right.entityId) ? -1 : 1)) {
    const id = String(body.id ?? body.entityId);
    const distance = (point: CanonicalCombatPoint) => (BigInt(point.x) - BigInt(from.x)) ** 2n + (BigInt(point.y) - BigInt(from.y)) ** 2n;
    const spot = besideTarget(walkerAtEnd, body, end.elevation)
      .filter(point => carriedSpotFree(scene, boundary, walkerAtEnd, body, point, [...others, ...taken]))
      .sort((left, right) => compareBigInt(distance(left), distance(right))
        || compareBigInt(BigInt(left.y), BigInt(right.y)) || compareBigInt(BigInt(left.x), BigInt(right.x)))[0];
    if (spot === undefined) return undefined;
    placed.push({ characterId: id, position: spot });
    taken.push({ ...body, position: spot });
  }
  return placed;
}

/** Replay: the event carries exactly the creatures the walker holds, each on
 * a spot it may stand on beside the walker's end. */
export function carriedPlacementValid(scene: JsonRecord, boundary: readonly { x: bigint; y: bigint }[], walkerAtEnd: JsonRecord,
  held: readonly JsonRecord[], carried: readonly CarriedCreature[], others: readonly JsonRecord[]): boolean {
  const end = canonicalCombatPoint(walkerAtEnd.position);
  if (end === undefined || !sameCanonical(held.map(body => String(body.id ?? body.entityId)).sort(), carried.map(entry => entry.characterId))) return false;
  const placed: JsonRecord[] = [];
  for (const entry of carried) {
    const body = held.find(candidate => String(candidate.id ?? candidate.entityId) === entry.characterId)!;
    if (entry.position.elevation !== end.elevation
      || !carriedSpotFree(scene, boundary, walkerAtEnd, body, entry.position, [...others, ...placed])) return false;
    placed.push({ ...body, position: entry.position });
  }
  return true;
}

/** A held creature may stand at `point`: inside the scene, next to the
 * walker, overlapping nobody in `others`, with nothing impassable on the short
 * way from the walker's spot to it. */
function carriedSpotFree(scene: JsonRecord, boundary: readonly { x: bigint; y: bigint }[], walkerAtEnd: JsonRecord,
  body: JsonRecord, point: CanonicalCombatPoint, others: readonly JsonRecord[]): boolean {
  const end = canonicalCombatPoint(walkerAtEnd.position)!;
  const moved = { ...body, position: point };
  if (!footprintInsidePolygon(point, body, boundary) || !nextTo(moved, walkerAtEnd)
    || entityOccupanciesOverlap(moved, walkerAtEnd)) return false;
  const bodyId = String(body.id ?? body.entityId);
  const rest = others.filter(entity => String(entity.id ?? entity.entityId) !== bodyId && entity.lifeState !== "dead"
    && isRecord(entity.position) && isRecord(entity.footprint));
  if (rest.some(entity => entityOccupanciesOverlap(moved, entity))) return false;
  return sameCanonical(end, point) || analyzeCombatMovement({ ...body, position: end }, [], scene, [end, point], new Set()).ok;
}

/** Within 5 feet across the floor of something that reaches the walker's
 * height band: a low counter or a body on the floor is next to whoever stands
 * by it, which the exact 3D cores would not allow at a 5-foot spacing. */
export function nextTo(walker: JsonRecord, target: JsonRecord): boolean {
  if (!isRecord(walker.position) || !isRecord(walker.footprint) || !isRecord(target.position) || !isRecord(target.footprint)) return false;
  const bottom = (body: JsonRecord) => BigInt(String((body.position as JsonRecord).elevation));
  const top = (body: JsonRecord) => bottom(body) + BigInt(String((body.footprint as JsonRecord).height));
  if (bottom(target) >= top(walker) || bottom(walker) >= top(target)) return false;
  const flat = (body: JsonRecord): JsonRecord => ({ ...body, position: { ...(body.position as JsonRecord), elevation: "0" },
    footprint: { ...(body.footprint as JsonRecord), height: "60" } });
  return entitiesWithinRange(flat(walker), flat(target), NEXT_TO_INCHES);
}

/** Places where a walker of `walker`'s footprint stands flush against one
 * side of `target`, every half square along that side and at its corners. */
export function besideTarget(target: JsonRecord, walker: JsonRecord, elevation: string): CanonicalCombatPoint[] {
  if (!isRecord(target.position) || !isRecord(target.footprint) || !isRecord(walker.footprint)) return [];
  const cx = BigInt(String(target.position.x)) * 2n, cy = BigInt(String(target.position.y)) * 2n;
  const tw = BigInt(String(target.footprint.width)), td = BigInt(String(target.footprint.depth));
  const ww = BigInt(String(walker.footprint.width)), wd = BigInt(String(walker.footprint.depth));
  // Doubled coordinates: centres a whole number of inches apart stay exact.
  const left = cx - tw - ww, right = cx + tw + ww, bottom = cy - td - wd, top = cy + td + wd;
  const points = new Map<string, CanonicalCombatPoint>();
  const add = (x: bigint, y: bigint) => {
    if (x % 2n !== 0n || y % 2n !== 0n) return;
    const point = { x: (x / 2n).toString(), y: (y / 2n).toString(), elevation };
    points.set(`${point.x},${point.y}`, point);
  };
  for (let y = bottom; y <= top; y += SCENE_GRID_STEP * 2n) { add(left, y); add(right, y); }
  for (let x = left; x <= right; x += SCENE_GRID_STEP * 2n) { add(x, bottom); add(x, top); }
  add(left, top); add(right, top); add(right, bottom);
  return [...points.values()];
}

/** All four corners of the footprint lie in the polygon or on its edge. */
export function footprintInsidePolygon(point: CanonicalCombatPoint, body: JsonRecord,
  polygon: readonly { x: bigint; y: bigint }[]): boolean {
  if (!isRecord(body.footprint)) return false;
  const halfWidth = BigInt(String(body.footprint.width)), halfDepth = BigInt(String(body.footprint.depth));
  const cx = BigInt(point.x) * 2n, cy = BigInt(point.y) * 2n;
  const doubled = polygon.map(vertex => ({ x: vertex.x * 2n, y: vertex.y * 2n }));
  return [[-1n, -1n], [1n, -1n], [1n, 1n], [-1n, 1n]].every(([sx, sy]) =>
    pointInPolygonInclusive(cx + sx * halfWidth, cy + sy * halfDepth, doubled));
}

/** The point lies inside the polygon or on its edge. */
export function pointInPolygonInclusive(x: bigint, y: bigint, polygon: readonly { x: bigint; y: bigint }[]): boolean {
  let inside = false;
  for (let index = 0, prior = polygon.length - 1; index < polygon.length; prior = index++) {
    const a = polygon[prior], b = polygon[index];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross === 0n && x >= min([a.x, b.x]) && x <= max([a.x, b.x]) && y >= min([a.y, b.y]) && y <= max([a.y, b.y])) return true;
    if ((a.y > y) !== (b.y > y)) {
      // x < a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y), compared without division.
      const left = (x - a.x) * (b.y - a.y), right = (y - a.y) * (b.x - a.x);
      if (b.y > a.y ? left < right : left > right) inside = !inside;
    }
  }
  return inside;
}

function min(values: readonly bigint[]): bigint { return values.reduce((low, value) => value < low ? value : low); }
function max(values: readonly bigint[]): bigint { return values.reduce((high, value) => value > high ? value : high); }
function compareBigInt(left: bigint, right: bigint): number { return left < right ? -1 : left > right ? 1 : 0; }
