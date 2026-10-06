import { RulesValidationError } from "../errors";
import {
  analyzeCombatMovement,
  entityOccupanciesOverlap,
  rectangularFeatureEntity,
  type CanonicalCombatPoint,
} from "../profiles/combat-geometry";
import { sameCanonical } from "../profiles/canonical";
import { isCanonicalTacticalGeometry, type CanonicalTacticalFeature, type CanonicalTacticalGeometry } from "../profiles/tactical-geometry";
import { footprintInsidePolygon, nextTo, SCENE_GRID_STEP } from "./carry";
import { activeEncounter } from "./combat-encounters";
import { conditionMechanics } from "./condition-mechanics";
import { dynamicLocationSceneRef, dynamicPassageConform, locationSceneRef } from "./dynamic-locations";
import type { AuthoritativeWorldState, JsonRecord } from "./model";
import type { PlaceArrival, PlaceConnection, PlaceConnectionSide } from "./place-map";
import { spatialRecordVisibleTo } from "./spatial-visibility";
import { characterTimelineId, sceneTimelineId } from "./timeline";
import { isRecord } from "./validation";

export * from "./place-map";

/** SPEC 0014 §4 (ADR 0103): a place the actor can go to from its scene, for
 * the KP's frozen context. `viaFeatureRef` is the door the way starts at
 * (null for a KP passage without one); `travelMicros` is the whole way's
 * time. A place behind a closed or locked door is listed with `open: false`
 * and the door (or KP passage) that is shut. */
export type ReachablePlace = {
  placeRef: string;
  label: string;
  viaFeatureRef: string | null;
  viaLabel: string | null;
  travelMicros: string;
  open: boolean;
  closedRef?: string;
  closedLabel?: string;
};

/** The way Rules takes: its connections in order, the side the actor leaves
 * from and the side it arrives at. */
export type PlaceRoute = {
  destinationSceneId: string;
  connectionIds: string[];
  travelMicros: string;
  departure: PlaceConnectionSide;
  arrival: PlaceConnectionSide;
};

export type PlaceRouteRejection = Readonly<{ kind: "rejected"; reason: string; closedRef?: string }>;
export type PlaceRoutePlan = Readonly<{ kind: "accepted"; route: PlaceRoute }> | PlaceRouteRejection;

/** What a move to another place commits: the timelines the CharacterMoved
 * carries and the route with the spot the actor arrives at. */
export type PlaceTravel = { connectionIds: string[]; arrival: CanonicalCombatPoint };
export type PlaceTravelMovement = {
  sourceTimelineId: string;
  destinationTimelineId: string;
  departureMicros: string;
  arrivalMicros: string;
  travel: PlaceTravel;
};
export type PlaceTravelPlan = Readonly<{ kind: "accepted"; route: PlaceRoute; movement: PlaceTravelMovement }> | PlaceRouteRejection;

/** How far, in lattice steps, a spot is looked for around an arrival point. */
const ARRIVAL_SEARCH_STEPS = 6n;

type Hop = { connection: PlaceConnection; from: 0 | 1 };
type Way = { cost: bigint; hops: Hop[] };
type Passage = { kind: "open" } | { kind: "closed"; closedRef: string } | { kind: "hidden" };

function connections(state: AuthoritativeWorldState): readonly PlaceConnection[] {
  return state.campaignRuntime.placeMap?.connections ?? [];
}

function sceneGeometry(state: AuthoritativeWorldState, sceneId: string): CanonicalTacticalGeometry | undefined {
  const scene = state.combatRuntime.scenes[sceneId];
  return isRecord(scene) && isCanonicalTacticalGeometry(scene.geometry) ? scene.geometry : undefined;
}

function sceneFeature(state: AuthoritativeWorldState, sceneId: string, featureId: string): CanonicalTacticalFeature | undefined {
  return sceneGeometry(state, sceneId)?.obstacles.find(feature => feature.featureId === featureId);
}

/** Whether `viewerId` can take this connection from its `from` side now. A
 * module connection is open when the doors on both its sides are passable; a
 * KP passage without a door when its own record says open. */
function passage(state: AuthoritativeWorldState, viewerId: string, connection: PlaceConnection, from: 0 | 1): Passage {
  if (connection.source === "kp" && connection.sides.every(side => side.featureId === null)) {
    const definition = state.campaignRuntime.definitions[connection.id];
    if (definition?.semanticKind !== "passage" || !isRecord(definition.content)
      || !spatialRecordVisibleTo(state, { id: connection.id, visibilityPolicyId: definition.visibilityPolicyRef,
        ...(definition.content.visibilityFactId === undefined || definition.content.visibilityFactId === null ? {}
          : { visibilityFactId: definition.content.visibilityFactId }) }, viewerId)) return { kind: "hidden" };
    return definition.content.observableState === "open" ? { kind: "open" } : { kind: "closed", closedRef: connection.id };
  }
  const departure = connection.sides[from], arrival = connection.sides[from === 0 ? 1 : 0];
  const doors = [departure, arrival].map(side => side.featureId === null ? null : sceneFeature(state, side.sceneId, side.featureId) ?? undefined);
  const leaving = doors[0];
  if (leaving === undefined || (leaving !== null && !spatialRecordVisibleTo(state, { ...leaving, id: leaving.featureId } as unknown as JsonRecord, viewerId))) {
    return { kind: "hidden" };
  }
  const shut = [departure, arrival].find((side, index) => side.featureId !== null && doorShut(doors[index]));
  return shut === undefined ? { kind: "open" } : { kind: "closed", closedRef: shut.featureId! };
}

/** A door is shut when its current state cannot be walked through: closed,
 * locked, or any other impassable state. An open opening stays open even
 * when it is railed against walking into it, as a stairwell on the upper
 * floor is: the way goes down its stairs. */
function doorShut(door: CanonicalTacticalFeature | null | undefined): boolean {
  return door === undefined || (door !== null && door.impassable && door.state !== "open");
}

function wayKey(way: Way): string {
  return way.hops.map(hop => `${hop.connection.id}\u0000${hop.from}`).join("\u0001");
}
function better(left: Way, right: Way): boolean {
  return left.cost < right.cost || (left.cost === right.cost && wayKey(left) < wayKey(right));
}

/** The cheapest open way to every place reachable from `startSceneId`, and,
 * for each place that is not, the cheapest way up to the shut door in front
 * of it. Ties go to the connection ids in code-unit order. */
function search(state: AuthoritativeWorldState, viewerId: string, startSceneId: string) {
  const best = new Map<string, Way>([[startSceneId, { cost: 0n, hops: [] }]]);
  const blocked = new Map<string, Way & { closedRef: string }>();
  const done = new Set<string>();
  for (;;) {
    let current: string | undefined;
    for (const [sceneId, way] of best) if (!done.has(sceneId) && (current === undefined || better(way, best.get(current)!))) current = sceneId;
    if (current === undefined) break;
    done.add(current);
    const here = best.get(current)!;
    for (const connection of connections(state)) {
      for (const from of [0, 1] as const) {
        if (connection.sides[from].sceneId !== current || (from === 1 && !connection.bidirectional)) continue;
        const to = connection.sides[from === 0 ? 1 : 0].sceneId;
        if (done.has(to) || state.scenes[to] === undefined) continue;
        const way = passage(state, viewerId, connection, from);
        if (way.kind === "hidden") continue;
        const next: Way = { cost: here.cost + BigInt(connection.travelMicros), hops: [...here.hops, { connection, from }] };
        if (way.kind === "open") {
          const known = best.get(to);
          if (known === undefined || better(next, known)) best.set(to, next);
        } else {
          const known = blocked.get(to);
          if (known === undefined || better(next, known)) blocked.set(to, { ...next, closedRef: way.closedRef });
        }
      }
    }
  }
  return { best, blocked };
}

/** The place ref the KP writes for a scene: a dynamic location's definition,
 * or the scene itself. */
export function placeRefForScene(state: AuthoritativeWorldState, sceneId: string): string {
  const location = Object.entries(state.campaignRuntime.definitions).find(([ref, definition]) => definition.semanticKind === "location"
    && isRecord(definition.content) && definition.content.sceneRef === sceneId && dynamicLocationSceneRef(ref) === sceneId);
  return location?.[0] ?? sceneId;
}

function featureLabel(state: AuthoritativeWorldState, side: PlaceConnectionSide): string | null {
  return side.featureId === null ? null : sceneFeature(state, side.sceneId, side.featureId)?.label ?? null;
}

function closedLabel(state: AuthoritativeWorldState, way: Way & { closedRef: string }): string | undefined {
  const last = way.hops[way.hops.length - 1]!;
  const side = last.connection.sides.find(candidate => candidate.featureId === way.closedRef);
  if (side !== undefined) return featureLabel(state, side) ?? undefined;
  const definition = state.campaignRuntime.definitions[way.closedRef];
  return isRecord(definition?.content) && typeof definition.content.label === "string" ? definition.content.label : undefined;
}

/**
 * SPEC 0014 §4 (ADR 0103): every other place reachable from the actor's
 * scene over connections whose doors it can see, sorted by place ref. Places
 * behind a closed or locked door are listed with `open: false`, so the KP
 * can tell the player; nothing past that door is listed.
 */
export function placesReachableFrom(state: AuthoritativeWorldState, characterId: string): ReachablePlace[] {
  const actor = state.entities[characterId];
  if (actor?.tenureStatus !== "active") return [];
  const { best, blocked } = search(state, characterId, actor.sceneId);
  const entry = (sceneId: string, way: Way, open: boolean): ReachablePlace => {
    const first = way.hops[0]!, departure = first.connection.sides[first.from];
    return { placeRef: placeRefForScene(state, sceneId), label: state.scenes[sceneId]?.name ?? sceneId,
      viaFeatureRef: departure.featureId, viaLabel: featureLabel(state, departure), travelMicros: way.cost.toString(), open };
  };
  const places: ReachablePlace[] = [];
  for (const [sceneId, way] of best) if (sceneId !== actor.sceneId) places.push(entry(sceneId, way, true));
  for (const [sceneId, way] of blocked) {
    if (best.has(sceneId)) continue;
    const label = closedLabel(state, way);
    places.push({ ...entry(sceneId, way, false), closedRef: way.closedRef, ...(label === undefined ? {} : { closedLabel: label }) });
  }
  return places.sort((left, right) => left.placeRef < right.placeRef ? -1 : left.placeRef > right.placeRef ? 1 : 0);
}

/**
 * SPEC 0014 §4 (ADR 0103): the open way from the actor's scene to a place
 * (a registered scene or a location definition ref). Refused inside an
 * encounter, when the actor cannot move, and when every way to it is shut
 * (`place:no-open-route`, naming the shut door) or there is none.
 */
export function planPlaceRoute(state: AuthoritativeWorldState, characterId: string, destinationRef: string, exitingEncounter = false): PlaceRoutePlan {
  const reject = (reason: string, closedRef?: string): PlaceRouteRejection =>
    ({ kind: "rejected", reason, ...(closedRef === undefined ? {} : { closedRef }) });
  const actor = state.entities[characterId];
  if (actor?.tenureStatus !== "active") return reject("place:actor-unavailable");
  if (!exitingEncounter && activeEncounter(state, characterId) !== undefined) return reject("place:in-encounter");
  if (!conditionMechanics(state, characterId).canMove) return reject("place:actor-cannot-move");
  const destinationSceneId = locationSceneRef(state, destinationRef);
  if (destinationSceneId === undefined) return reject("place:unknown-destination");
  if (destinationSceneId === actor.sceneId) return reject("place:already-here");
  const { best, blocked } = search(state, characterId, actor.sceneId);
  const way = best.get(destinationSceneId);
  if (way === undefined) {
    const shut = blocked.get(destinationSceneId);
    return shut === undefined ? reject("place:no-route") : reject("place:no-open-route", shut.closedRef);
  }
  const first = way.hops[0]!, last = way.hops[way.hops.length - 1]!;
  return { kind: "accepted", route: {
    destinationSceneId,
    connectionIds: way.hops.map(hop => hop.connection.id),
    travelMicros: way.cost.toString(),
    departure: structuredClone(first.connection.sides[first.from]),
    arrival: structuredClone(last.connection.sides[last.from === 0 ? 1 : 0]),
  } };
}

/** The bodies a free spot must keep clear of in `sceneId`, other than the
 * mover and anyone it holds. */
function bodiesIn(state: AuthoritativeWorldState, characterId: string, sceneId: string): JsonRecord[] {
  return Object.values(state.combatRuntime.entities).filter((entity): entity is JsonRecord => isRecord(entity)
    && entity.sceneId === sceneId && String(entity.id ?? entity.entityId) !== characterId && entity.lifeState !== "dead"
    && isRecord(entity.position) && isRecord(entity.footprint)
    && !(isRecord(entity.conditions) && entity.conditions.grappledBy === characterId));
}

/** The free spot nearest `around` in `sceneId` where the mover fits: inside
 * the map, clear of anything impassable and of everyone else, and reached
 * from `around` without passing through a wall. Spots lie on the half-square
 * lattice around it; ties go to the lower y, then x. */
function freeSpotNear(state: AuthoritativeWorldState, characterId: string, sceneId: string, around: PlaceArrival,
  admits: (body: JsonRecord) => boolean = () => true): CanonicalCombatPoint | undefined {
  const mover = state.combatRuntime.entities[characterId];
  const geometry = sceneGeometry(state, sceneId);
  if (!isRecord(mover) || !isRecord(mover.footprint) || geometry === undefined) return undefined;
  const scene = state.combatRuntime.scenes[sceneId] as JsonRecord;
  const body: JsonRecord = { id: characterId, entityId: characterId, sceneId, footprint: structuredClone(mover.footprint),
    ...(typeof mover.sizeCategory === "string" ? { sizeCategory: mover.sizeCategory } : {}) };
  const at = (point: CanonicalCombatPoint): JsonRecord => ({ ...body, position: point });
  const boundary = geometry.boundary.points.map(point => ({ x: BigInt(point.x), y: BigInt(point.y) }));
  const solids = geometry.obstacles.filter(feature => feature.impassable)
    .map(feature => rectangularFeatureEntity(feature as unknown as JsonRecord, sceneId))
    .filter((entity): entity is JsonRecord => entity !== undefined);
  const others = bodiesIn(state, characterId, sceneId);
  const origin = { x: BigInt(around.x), y: BigInt(around.y) };
  const offsets: [bigint, bigint][] = [];
  for (let dy = -ARRIVAL_SEARCH_STEPS; dy <= ARRIVAL_SEARCH_STEPS; dy++) {
    for (let dx = -ARRIVAL_SEARCH_STEPS; dx <= ARRIVAL_SEARCH_STEPS; dx++) offsets.push([dx, dy]);
  }
  offsets.sort(([ax, ay], [bx, by]) => {
    const left = ax * ax + ay * ay, right = bx * bx + by * by;
    return left < right ? -1 : left > right ? 1 : ay < by ? -1 : ay > by ? 1 : ax < bx ? -1 : ax > bx ? 1 : 0;
  });
  const start: CanonicalCombatPoint = { x: around.x, y: around.y, elevation: around.elevation };
  for (const [dx, dy] of offsets) {
    const point: CanonicalCombatPoint = { x: (origin.x + dx * SCENE_GRID_STEP).toString(),
      y: (origin.y + dy * SCENE_GRID_STEP).toString(), elevation: around.elevation };
    const placed = at(point);
    if (!footprintInsidePolygon(point, body, boundary) || solids.some(solid => entityOccupanciesOverlap(placed, solid))
      || others.some(other => entityOccupanciesOverlap(placed, other)) || !admits(placed)) continue;
    if ((dx !== 0n || dy !== 0n) && !analyzeCombatMovement(at(start), [], scene, [start, point], new Set()).ok) continue;
    return point;
  }
  return undefined;
}

function doorBody(state: AuthoritativeWorldState, side: PlaceConnectionSide): JsonRecord | undefined {
  const feature = side.featureId === null ? undefined : sceneFeature(state, side.sceneId, side.featureId);
  return feature === undefined ? undefined : rectangularFeatureEntity(feature as unknown as JsonRecord, side.sceneId);
}

/** Whether the actor stands where it leaves from: next to the departure
 * door, or, for a passage without a door, anywhere in its scene. */
function atDeparture(state: AuthoritativeWorldState, characterId: string, route: PlaceRoute): boolean {
  const body = state.combatRuntime.entities[characterId];
  if (route.departure.featureId === null) return true;
  const door = doorBody(state, route.departure);
  return isRecord(body) && body.sceneId === route.departure.sceneId && door !== undefined && nextTo(body, door);
}

/**
 * SPEC 0014 §4 (ADR 0103): read when a move to another place is lowered.
 * The route Rules will take, and the spot the actor first walks to: the free
 * spot nearest the departure side's arrival point that is next to its door.
 * `walkTo` is null when the actor already stands next to that door.
 */
export function planPlaceDeparture(state: AuthoritativeWorldState, characterId: string, destinationRef: string):
  Readonly<{ kind: "accepted"; route: PlaceRoute; walkTo: CanonicalCombatPoint | null }> | PlaceRouteRejection {
  const planned = planPlaceRoute(state, characterId, destinationRef);
  if (planned.kind === "rejected") return planned;
  const route = planned.route;
  if (atDeparture(state, characterId, route)) return { kind: "accepted", route, walkTo: null };
  const door = doorBody(state, route.departure);
  const spot = door === undefined ? undefined
    : freeSpotNear(state, characterId, route.departure.sceneId, route.departure.arrival, placed => nextTo(placed, door));
  return spot === undefined ? { kind: "rejected", reason: "place:no-room-at-departure" } : { kind: "accepted", route, walkTo: spot };
}

/**
 * SPEC 0014 §4 (ADR 0103): the move Rules commits. The route is planned
 * again on the current state; the actor must stand at its departure door
 * (the step's walk took it there); time on the way advances the actor's
 * clock as an individual move does (SPEC 0007 §5); the actor arrives on the
 * free spot nearest the destination side's arrival point.
 */
export function placeTravelPlan(state: AuthoritativeWorldState, characterId: string, destinationRef: string, exitingEncounter = false): PlaceTravelPlan {
  const planned = planPlaceRoute(state, characterId, destinationRef, exitingEncounter);
  if (planned.kind === "rejected") return planned;
  const route = planned.route;
  if (!atDeparture(state, characterId, route)) return { kind: "rejected", reason: "place:not-at-departure" };
  const arrival = freeSpotNear(state, characterId, route.destinationSceneId, route.arrival.arrival);
  if (arrival === undefined) return { kind: "rejected", reason: "place:no-room-at-arrival" };
  const sourceTimelineId = characterTimelineId(state, characterId);
  if (sourceTimelineId === undefined) return { kind: "rejected", reason: "place:timeline-unavailable" };
  const departureMicros = state.fictionTimelines[sourceTimelineId].nowMicros;
  const arrivalMicros = (BigInt(departureMicros) + BigInt(route.travelMicros)).toString();
  const destinationTimelineId = sceneTimelineId(state, route.destinationSceneId);
  const existing = state.fictionTimelines[destinationTimelineId];
  // As for any individual move: arriving may bring an earlier clock there
  // forward, never enter one already later (SPEC 0007 §§5、7).
  if (existing !== undefined && BigInt(existing.nowMicros) > BigInt(arrivalMicros)) {
    return { kind: "rejected", reason: "place:destination-clock-ahead" };
  }
  return { kind: "accepted", route, movement: { sourceTimelineId, destinationTimelineId, departureMicros, arrivalMicros,
    travel: { connectionIds: [...route.connectionIds], arrival } } };
}

export function isPlaceTravel(value: unknown): value is PlaceTravel {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "arrival,connectionIds"
    || !Array.isArray(value.connectionIds) || value.connectionIds.length === 0
    || !value.connectionIds.every(id => typeof id === "string" && id.length > 0) || !isRecord(value.arrival)) return false;
  const arrival = value.arrival;
  return Object.keys(arrival).sort().join(",") === "elevation,x,y"
    && [arrival.x, arrival.y, arrival.elevation].every(field => typeof field === "string" && /^-?(0|[1-9][0-9]*)$/u.test(field) && field !== "-0");
}

/** Replay: the move's route, times and arrival spot are those Rules plans
 * again from the state before it. */
export function assertPlaceTravel(state: AuthoritativeWorldState, payload: Readonly<{ characterId: string; destinationSceneId: string;
  sourceTimelineId: string; destinationTimelineId: string; departureMicros: string; arrivalMicros: string; travel: PlaceTravel }>): void {
  const planned = placeTravelPlan(state, payload.characterId, payload.destinationSceneId);
  const { travel, sourceTimelineId, destinationTimelineId, departureMicros, arrivalMicros } = payload;
  if (planned.kind !== "accepted" || !["player", "npc"].includes(String(state.entities[payload.characterId]?.kind))
    || planned.route.destinationSceneId !== payload.destinationSceneId
    || !sameCanonical(planned.movement, { sourceTimelineId, destinationTimelineId, departureMicros, arrivalMicros, travel })) {
    throw new RulesValidationError("place:travel-does-not-match-route");
  }
}

/**
 * SPEC 0014 §4 (ADR 0103): one door has a feature on each side's map. When
 * the one in `sceneId` changes state -- opened, closed, destroyed -- its
 * pair on the other side takes the same state, with that state's mechanics
 * from its own graph and the same durability left, in the same fold.
 */
export function syncConnectedDoors(state: AuthoritativeWorldState, sceneId: string, featureId: string): void {
  const changed = sceneFeature(state, sceneId, featureId);
  if (changed === undefined) return;
  for (const connection of connections(state)) {
    const index = connection.sides.findIndex(side => side.sceneId === sceneId && side.featureId === featureId);
    if (index < 0) continue;
    const other = connection.sides[index === 0 ? 1 : 0];
    if (other.featureId === null) continue;
    const pair = sceneFeature(state, other.sceneId, other.featureId);
    const semantics = pair?.stateGraph?.states.find(entry => entry.state === changed.state);
    if (pair === undefined || semantics === undefined) continue;
    pair.state = semantics.state;
    pair.opaque = semantics.opaque;
    pair.impassable = semantics.impassable;
    pair.cover = semantics.cover;
    pair.propagation = semantics.propagation;
    pair.terrain = semantics.terrain ?? "normal";
    if (pair.durability !== undefined && changed.durability !== undefined) pair.durability.current = changed.durability.current;
    const scene = state.combatRuntime.scenes[other.sceneId];
    if (!isRecord(scene) || !isCanonicalTacticalGeometry(scene.geometry)) throw new RulesValidationError("place:paired-door-violates-geometry");
  }
}

/**
 * SPEC 0014 §4 (ADR 0103): a passage the KP created joins the place map as a
 * connection without doors; each side's arrival is its scene's first spawn
 * point. The passage record keeps whether it is open.
 */
export function registerKpPassage(state: AuthoritativeWorldState, definitionRef: string, content: unknown): void {
  if (!isRecord(content) || !dynamicPassageConform(content.passage)) return;
  const passage = content.passage;
  const sides = [passage.fromLocationRef, passage.toLocationRef].map(ref => {
    const sceneId = locationSceneRef(state, ref);
    const spawn = sceneId === undefined ? undefined : sceneGeometry(state, sceneId)?.spawnPoints[0];
    return sceneId === undefined || spawn === undefined ? undefined
      : { sceneId, featureId: null, arrival: { x: spawn.x, y: spawn.y, elevation: spawn.elevation } };
  });
  if (sides.some(side => side === undefined)) return;
  const map = state.campaignRuntime.placeMap ??= { connections: [], sitePlan: {} };
  if (map.connections.some(connection => connection.id === definitionRef)) throw new RulesValidationError("place:connection-exists");
  map.connections.push({ id: definitionRef, source: "kp", sides: sides as [PlaceConnectionSide, PlaceConnectionSide],
    bidirectional: passage.bidirectional, travelMicros: passage.travelDurationMicros });
  map.connections.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

/** SPEC 0014 §4 (ADR 0103): the scenes a character has been in, sorted; a
 * record that never kept them has been only where it is. */
export function visitedSceneIds(state: AuthoritativeWorldState, characterId: string): string[] {
  const character = state.entities[characterId];
  if (character === undefined) return [];
  return character.visitedSceneIds ?? [character.sceneId];
}

/** SPEC 0012 §§3.4、7、13: leaving uses an actual open, adjacent exit.
 * Getting to it is ordinary segmented combat movement, with its reactions. */
export function combatPlaceDeparture(state: AuthoritativeWorldState, characterId: string, destinationRef: string): PlaceTravelPlan {
  if (activeEncounter(state, characterId) === undefined) return { kind: "rejected", reason: "place:not-in-encounter" };
  const planned = placeTravelPlan(state, characterId, destinationRef, true);
  if (planned.kind === "rejected") return planned;
  if (planned.route.connectionIds.length !== 1) return { kind: "rejected", reason: "place:escape-needs-adjacent-scene" };
  // Doorless passages still have a concrete departure point on their map.
  const actor = state.combatRuntime.entities[characterId];
  const point = planned.route.departure.arrival;
  if (planned.route.departure.featureId === null && (!isRecord(actor?.position)
    || BigInt(String(actor.position.elevation)) !== BigInt(point.elevation)
    || (BigInt(String(actor.position.x)) - BigInt(point.x)) ** 2n
      + (BigInt(String(actor.position.y)) - BigInt(point.y)) ** 2n > 60n ** 2n)) {
    return { kind: "rejected", reason: "place:not-at-departure" };
  }
  return planned;
}

export const COMBAT_DEPARTURE_PREFIX = "action:depart:";
export function combatDepartureOptions(state: AuthoritativeWorldState, characterId: string, onlyAtExit = true):
  Array<{ abilityRef: string; name: string; departure: { featureRef: string | null; point: CanonicalCombatPoint; atExitNow: boolean; crossingFeet: number } }> {
  if (activeEncounter(state, characterId) === undefined) return [];
  return placesReachableFrom(state, characterId).flatMap(place => {
    if (!place.open) return [];
    const route = planPlaceRoute(state, characterId, place.placeRef, true);
    if (route.kind !== "accepted" || route.route.connectionIds.length !== 1) return [];
    const atExitNow = combatPlaceDeparture(state, characterId, place.placeRef).kind === "accepted";
    if (onlyAtExit && !atExitNow) return [];
    return [{ abilityRef: `${COMBAT_DEPARTURE_PREFIX}${place.placeRef}`, name: `离开战斗，前往${place.label}`,
      departure: { featureRef: route.route.departure.featureId, point: structuredClone(route.route.departure.arrival), atExitNow, crossingFeet: 5 } }];
  });
}
