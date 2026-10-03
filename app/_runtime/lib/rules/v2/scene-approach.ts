import { RulesValidationError } from "../errors";
import {
  analyzeCombatMovement,
  canonicalCombatPoint,
  canonicalizeCombatPath,
  pathLengthMilliInches,
  rectangularFeatureEntity,
  type CanonicalCombatPoint,
} from "../profiles/combat-geometry";
import { sameCanonical } from "../profiles/canonical";
import { isCanonicalTacticalGeometry } from "../profiles/tactical-geometry";
import { authorityGeometryFeatureComposite, authoritySpatialBinding, authoritySpatialRefVisibleTo } from "./authority-bindings";
import { activeEncounter } from "./combat-encounters";
import { conditionMechanics } from "./condition-mechanics";
import { besideTarget, carriedPlacementValid, footprintInsidePolygon, heldBodies, isCarriedCreatures, nextTo,
  placeCarriedCreatures, SCENE_GRID_STEP, type CarriedCreature } from "./carry";
import type { AuthoritativeWorldState, EventEnvelope, JsonRecord } from "./model";
import { isStoredSemanticDefinition } from "./semantic-definitions";
import { spatialRecordVisibleTo } from "./spatial-visibility";
import { hasExactKeys, isNonEmptyString, isRecord } from "./validation";

/** SPEC 0014 §4 (ADR 0087): before one of its world steps, the actor walks
 * within its scene next to a creature or a mapped object, or to a map point.
 * The KP names where; Rules finds the route on the full scene geometry. */
export type WorldInteractionApproach = Readonly<
  | { kind: "nextTo"; ref: string }
  | { kind: "point"; position: CanonicalCombatPoint }
>;

export type CharacterRepositionedPayload = {
  characterId: string;
  sceneId: string;
  /** From the actor's position before the walk to where it stops. */
  path: CanonicalCombatPoint[];
  toward: { kind: "nextTo"; ref: string } | { kind: "point" };
  /** SPEC 0014 §4 (ADR 0090): creatures the actor holds in a grapple, and
   * where each stops beside it. Absent when it holds no one. */
  carried?: CarriedCreature[];
};

export type SceneApproachPlan =
  | Readonly<{ kind: "stay" }>
  | Readonly<{ kind: "move"; payload: CharacterRepositionedPayload }>
  | Readonly<{ kind: "rejected"; reason: string }>;

export { nextTo };

const GRID_STEP = SCENE_GRID_STEP;
const MAX_SEARCH_NODES = 4096;
const NEIGHBOURS: readonly (readonly [bigint, bigint])[] = [
  [1n, 0n], [-1n, 0n], [0n, 1n], [0n, -1n], [1n, 1n], [1n, -1n], [-1n, 1n], [-1n, -1n],
];

export function isWorldInteractionApproach(value: unknown): value is WorldInteractionApproach {
  if (!isRecord(value)) return false;
  if (value.kind === "nextTo") return hasExactKeys(value, ["kind", "ref"]) && isNonEmptyString(value.ref);
  return value.kind === "point" && hasExactKeys(value, ["kind", "position"])
    && canonicalCombatPoint(value.position) !== undefined
    && sameCanonical(canonicalCombatPoint(value.position), value.position);
}

export function isCharacterRepositionedPayload(value: unknown): value is CharacterRepositionedPayload {
  if (!isRecord(value) || !(hasExactKeys(value, ["characterId", "sceneId", "path", "toward"])
    || (hasExactKeys(value, ["characterId", "sceneId", "path", "toward", "carried"]) && isCarriedCreatures(value.carried)))
    || !isNonEmptyString(value.characterId) || !isNonEmptyString(value.sceneId) || !isRecord(value.toward)) return false;
  const path = canonicalizeCombatPath(value.path);
  const toward = value.toward;
  return path !== undefined && sameCanonical(path, value.path)
    && (toward.kind === "point" ? hasExactKeys(toward, ["kind"])
      : toward.kind === "nextTo" && hasExactKeys(toward, ["kind", "ref"]) && isNonEmptyString(toward.ref));
}

/** The refs an approach may name: a creature in the scene the actor can see,
 * a mapped object of the scene geometry it can see, or a scene object whose
 * definition is placed by such mapped objects. Each yields the bodies the
 * actor must end up next to (any one of them). */
function approachTargets(state: AuthoritativeWorldState, actorId: string, sceneRef: string, ref: string): JsonRecord[] | undefined {
  if (ref === actorId || !authoritySpatialRefVisibleTo(state, ref, sceneRef, actorId)) return undefined;
  const binding = authoritySpatialBinding(state, ref, sceneRef);
  if (binding?.kind === "entity") {
    const body = state.combatRuntime.entities[ref];
    return isRecord(body) && body.sceneId === sceneRef && isRecord(body.position) && isRecord(body.footprint) ? [body] : undefined;
  }
  const featureBody = (featureRef: string): JsonRecord | undefined => {
    const record = authorityGeometryFeatureComposite(state, featureRef);
    if (record === undefined || record.sceneRef !== sceneRef
      || !spatialRecordVisibleTo(state, { ...record.feature, id: featureRef }, actorId)) return undefined;
    return rectangularFeatureEntity(record.feature, sceneRef);
  };
  if (binding?.kind === "geometryFeature") {
    const body = featureBody(ref);
    return body === undefined ? undefined : [body];
  }
  const definition = state.campaignRuntime.definitions[ref];
  if (binding?.kind === "sceneFeature" && isStoredSemanticDefinition(definition)
    && Array.isArray(definition.content.mechanicDefinitionRefs)) {
    const bodies = definition.content.mechanicDefinitionRefs.flatMap(featureRef =>
      typeof featureRef === "string" ? [featureBody(featureRef)].filter((body): body is JsonRecord => body !== undefined) : []);
    return bodies.length === 0 ? undefined : bodies;
  }
  return undefined;
}

/** Plans the walk on the authoritative state the step executes against. */
export function planSceneApproach(
  state: AuthoritativeWorldState,
  actorId: string,
  sceneRef: string,
  approach: WorldInteractionApproach,
): SceneApproachPlan {
  const reject = (reason: string): SceneApproachPlan => ({ kind: "rejected", reason });
  const actor = state.entities[actorId];
  const mover = state.combatRuntime.entities[actorId];
  const scene = state.combatRuntime.scenes[sceneRef];
  const geometry = isRecord(scene) ? scene.geometry : undefined;
  const start = isRecord(mover) ? canonicalCombatPoint(mover.position) : undefined;
  if (actor?.tenureStatus !== "active" || actor.sceneId !== sceneRef || !isRecord(mover) || mover.sceneId !== sceneRef
    || start === undefined || !isRecord(mover.footprint) || !isCanonicalTacticalGeometry(geometry)) return reject("approach:actor-not-placed");
  if (activeEncounter(state, actorId) !== undefined) return reject("approach:in-encounter");
  if (!conditionMechanics(state, actorId).canMove) return reject("approach:actor-cannot-move");
  // SPEC 0014 §4 (ADR 0090): whoever the actor holds comes along, so it is
  // not in the way of the walk.
  const held = heldBodies(state, actorId, sceneRef);
  const others = Object.values(state.combatRuntime.entities).filter((entity): entity is JsonRecord => isRecord(entity)
    && entity.sceneId === sceneRef && String(entity.id ?? entity.entityId) !== actorId && !held.some(body => body === entity));
  // What the geometry reads of the walker; the full record is cloned once per
  // probe otherwise, hundreds of times for one room.
  const body: JsonRecord = { id: actorId, entityId: actorId, sceneId: sceneRef, footprint: structuredClone(mover.footprint),
    ...(typeof mover.sizeCategory === "string" ? { sizeCategory: mover.sizeCategory } : {}) };
  const at = (point: CanonicalCombatPoint): JsonRecord => ({ ...body, position: point });
  const boundary = geometry.boundary.points.map(point => ({ x: BigInt(point.x), y: BigInt(point.y) }));
  const inside = (point: CanonicalCombatPoint) => footprintInsidePolygon(point, mover, boundary);
  const clear = (from: CanonicalCombatPoint, to: CanonicalCombatPoint) =>
    analyzeCombatMovement(at(from), [], scene as JsonRecord, [from, to], new Set()).ok;
  const free = (from: CanonicalCombatPoint, to: CanonicalCombatPoint) =>
    analyzeCombatMovement(at(from), others, scene as JsonRecord, [from, to], new Set()).ok;

  // Where the walk may stop: beside the target, flush with one of its sides,
  // or exactly on the point. These need not lie on the route's lattice.
  let toward: CharacterRepositionedPayload["toward"];
  let reached: (point: CanonicalCombatPoint) => boolean;
  let endpoints: CanonicalCombatPoint[];
  if (approach.kind === "nextTo") {
    const targets = approachTargets(state, actorId, sceneRef, approach.ref);
    if (targets === undefined) return reject("approach:target-not-placed-or-visible");
    toward = { kind: "nextTo", ref: approach.ref };
    reached = point => targets.some(target => nextTo(at(point), target));
    if (reached(start)) return { kind: "stay" };
    endpoints = targets.flatMap(target => besideTarget(target, mover, start.elevation)).filter(point => inside(point) && reached(point));
  } else {
    const exact = approach.position;
    if (exact.elevation !== start.elevation) return reject("approach:elevation-change-unsupported");
    if (exact.x === start.x && exact.y === start.y) return { kind: "stay" };
    if (!inside(exact)) return reject("approach:point-outside-scene");
    toward = { kind: "point" };
    reached = point => point.x === exact.x && point.y === exact.y;
    endpoints = [exact];
  }

  // Dijkstra over the scene lattice. A start off the lattice is joined to the
  // lattice corners around it; an endpoint is entered from a lattice point
  // within one step of it.
  const key = (point: CanonicalCombatPoint) => `${point.x},${point.y}`;
  const xs = boundary.map(point => point.x), ys = boundary.map(point => point.y);
  const [minX, maxX, minY, maxY] = [min(xs), max(xs), min(ys), max(ys)];
  const cost = new Map<string, bigint>([[key(start), 0n]]);
  const previous = new Map<string, CanonicalCombatPoint>();
  const open: CanonicalCombatPoint[] = [start];
  const done = new Set<string>();
  const pathTo = (end: CanonicalCombatPoint): CanonicalCombatPoint[] => {
    const path = [end];
    for (let point = previous.get(key(end)); point !== undefined; point = previous.get(key(point))) path.unshift(point);
    return path;
  };
  let found: CanonicalCombatPoint[] | undefined;
  const before = (left: CanonicalCombatPoint, right: CanonicalCombatPoint) =>
    (compareBigInt(cost.get(key(left))!, cost.get(key(right))!)
      || compareBigInt(BigInt(left.y), BigInt(right.y)) || compareBigInt(BigInt(left.x), BigInt(right.x))) < 0;
  while (open.length > 0) {
    if (done.size >= MAX_SEARCH_NODES) return reject("approach:route-search-exceeded");
    let pick = 0;
    for (let index = 1; index < open.length; index++) if (before(open[index], open[pick])) pick = index;
    const current = open.splice(pick, 1)[0];
    if (done.has(key(current))) continue;
    done.add(key(current));
    if (current !== start && reached(current) && free(previous.get(key(current))!, current)) { found = pathTo(current); break; }
    const entered = endpoints.find(end => key(end) !== key(current)
      && abs(BigInt(end.x) - BigInt(current.x)) <= GRID_STEP && abs(BigInt(end.y) - BigInt(current.y)) <= GRID_STEP
      && clear(current, end) && free(current, end));
    if (entered !== undefined) { found = [...pathTo(current), entered]; break; }
    for (const next of latticeNeighbours(current)) {
      const nx = BigInt(next.x), ny = BigInt(next.y);
      if (nx < minX || nx > maxX || ny < minY || ny > maxY || done.has(key(next)) || !inside(next) || !clear(current, next)) continue;
      const through = cost.get(key(current))! + BigInt(pathLengthMilliInches([current, next]));
      const known = cost.get(key(next));
      if (known !== undefined && known <= through) continue;
      cost.set(key(next), through);
      previous.set(key(next), current);
      open.push(next);
    }
  }
  if (found === undefined) return reject("approach:no-route");
  const path = canonicalizeCombatPath(found);
  if (path === undefined || !analyzeCombatMovement(mover, others, scene as JsonRecord, path, new Set()).ok) return reject("approach:no-route");
  const carried = placeCarriedCreatures(scene as JsonRecord, boundary, at(path[path.length - 1]), path[path.length - 2]!, held, others);
  if (carried === undefined) return reject("approach:no-room-for-carried");
  return { kind: "move", payload: { characterId: actorId, sceneId: sceneRef, path, toward, ...(carried.length === 0 ? {} : { carried }) } };
}

/** Why the actor cannot first walk there now, or undefined. Lowering names
 * the problem at the field; Rules plans the walk again when the step runs. */
export function sceneApproachIssue(state: AuthoritativeWorldState, actorId: string, sceneRef: string,
  approach: WorldInteractionApproach): string | undefined {
  const plan = planSceneApproach(state, actorId, sceneRef, approach);
  return plan.kind === "rejected" ? plan.reason : undefined;
}

/** The refs among `refs` that name something the actor could stand next to. */
export function sceneApproachTargetRefs(state: AuthoritativeWorldState, actorId: string, sceneRef: string,
  refs: Iterable<string>): string[] {
  return [...new Set(refs)].filter(ref => approachTargets(state, actorId, sceneRef, ref) !== undefined).sort();
}

/** Replays a committed walk: the same scene, start, route and free endpoint. */
export function applySceneApproachEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  if (event.eventType !== "CharacterRepositioned") return false;
  const payload = event.payload;
  if (!isCharacterRepositionedPayload(payload)) throw new RulesValidationError("approach:payload-invalid");
  const actor = state.entities[payload.characterId];
  const mover = state.combatRuntime.entities[payload.characterId];
  const scene = state.combatRuntime.scenes[payload.sceneId];
  const geometry = isRecord(scene) ? scene.geometry : undefined;
  if (actor?.tenureStatus !== "active" || actor.sceneId !== payload.sceneId || !isRecord(mover) || mover.sceneId !== payload.sceneId
    || !isCanonicalTacticalGeometry(geometry) || !sameCanonical(canonicalCombatPoint(mover.position) ?? null, payload.path[0])) {
    throw new RulesValidationError("approach:start-changed");
  }
  if (activeEncounter(state, payload.characterId) !== undefined || !conditionMechanics(state, payload.characterId).canMove) {
    throw new RulesValidationError("approach:actor-cannot-walk");
  }
  const boundary = geometry.boundary.points.map(point => ({ x: BigInt(point.x), y: BigInt(point.y) }));
  // SPEC 0014 §4 (ADR 0090): exactly the creatures the actor holds come along.
  const held = heldBodies(state, payload.characterId, payload.sceneId);
  const carried = payload.carried ?? [];
  const others = Object.values(state.combatRuntime.entities).filter((entity): entity is JsonRecord => isRecord(entity)
    && entity.sceneId === payload.sceneId && String(entity.id ?? entity.entityId) !== payload.characterId && !held.includes(entity));
  if (payload.path.some(point => point.elevation !== payload.path[0].elevation || !footprintInsidePolygon(point, mover, boundary))
    || !analyzeCombatMovement(mover, others, scene as JsonRecord, payload.path, new Set()).ok) {
    throw new RulesValidationError("approach:route-blocked");
  }
  const end = payload.path[payload.path.length - 1];
  if (!carriedPlacementValid(scene as JsonRecord, boundary, { ...mover, position: end }, held, carried, others)) {
    throw new RulesValidationError("approach:carried-spot-invalid");
  }
  mover.position = structuredClone(end);
  for (const entry of carried) state.combatRuntime.entities[entry.characterId]!.position = structuredClone(entry.position);
  return true;
}

/** Lattice points one step away, or, off the lattice, the corners of the
 * lattice square the point lies in. */
function latticeNeighbours(point: CanonicalCombatPoint): CanonicalCombatPoint[] {
  const x = BigInt(point.x), y = BigInt(point.y);
  const at = (nx: bigint, ny: bigint) => ({ x: nx.toString(), y: ny.toString(), elevation: point.elevation });
  if (x % GRID_STEP === 0n && y % GRID_STEP === 0n) return NEIGHBOURS.map(([dx, dy]) => at(x + dx * GRID_STEP, y + dy * GRID_STEP));
  const xs = [...new Set([floorTo(x), floorTo(x) + (x % GRID_STEP === 0n ? 0n : GRID_STEP)])];
  const ys = [...new Set([floorTo(y), floorTo(y) + (y % GRID_STEP === 0n ? 0n : GRID_STEP)])];
  return xs.flatMap(nx => ys.map(ny => at(nx, ny)));
}

function floorTo(value: bigint): bigint {
  const rest = value % GRID_STEP;
  return rest === 0n ? value : value - rest - (rest < 0n ? GRID_STEP : 0n);
}

function min(values: readonly bigint[]): bigint { return values.reduce((low, value) => value < low ? value : low); }
function max(values: readonly bigint[]): bigint { return values.reduce((high, value) => value > high ? value : high); }
function abs(value: bigint): bigint { return value < 0n ? -value : value; }
function compareBigInt(left: bigint, right: bigint): number { return left < right ? -1 : left > right ? 1 : 0; }
