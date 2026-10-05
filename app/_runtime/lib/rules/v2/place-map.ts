import type { CanonicalTacticalGeometry } from "../profiles/tactical-geometry";

/**
 * SPEC 0014 §4 (ADR 0103): how the places of a room connect. Room registers
 * the module's connections at genesis; a passage the KP creates later joins
 * the same list with `source: "kp"`. Whether a connection can be passed is
 * read from its doors' current state (or, for a KP passage without a door,
 * from the passage record), never stored here.
 */
export type PlaceArrival = { x: string; y: string; elevation: string };
/** One end of a connection: the door or opening on that scene's map, and
 * where a creature coming through stands. A KP passage has no door. */
export type PlaceConnectionSide = { sceneId: string; featureId: string | null; arrival: PlaceArrival };
export type PlaceConnection = {
  id: string;
  source: "module" | "kp";
  sides: [PlaceConnectionSide, PlaceConnectionSide];
  bidirectional: boolean;
  /** Time on the way, in microseconds. */
  travelMicros: string;
};
/** Where a scene map's origin lies in the one site plan, in inches; `level`
 * 0 is the ground floor, -1 below it and 1 above. */
export type PlaceSitePlacement = { x: string; y: string; level: number };
export type PlaceMap = { connections: PlaceConnection[]; sitePlan: Record<string, PlaceSitePlacement> };

const INTEGER = /^-?(0|[1-9][0-9]{0,17})$/u;
const DURATION = /^[1-9][0-9]{0,17}$/u;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && [...keys].sort().every((key, index) => key === actual[index]);
}
function ref(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.normalize("NFC") === value;
}
function integer(value: unknown): value is string {
  return typeof value === "string" && INTEGER.test(value) && value !== "-0";
}

export function isPlaceArrival(value: unknown): value is PlaceArrival {
  return record(value) && exactKeys(value, ["elevation", "x", "y"]) && integer(value.x) && integer(value.y) && integer(value.elevation);
}

export function isPlaceConnection(value: unknown): value is PlaceConnection {
  if (!record(value) || !exactKeys(value, ["bidirectional", "id", "sides", "source", "travelMicros"]) || !ref(value.id)
    || (value.source !== "module" && value.source !== "kp") || typeof value.bidirectional !== "boolean"
    || typeof value.travelMicros !== "string" || !DURATION.test(value.travelMicros)
    || !Array.isArray(value.sides) || value.sides.length !== 2) return false;
  const sides = value.sides as unknown[];
  return sides.every(side => record(side) && exactKeys(side, ["arrival", "featureId", "sceneId"]) && ref(side.sceneId)
    && (side.featureId === null || ref(side.featureId)) && isPlaceArrival(side.arrival))
    && (sides[0] as PlaceConnectionSide).sceneId !== (sides[1] as PlaceConnectionSide).sceneId;
}

export function isPlaceMap(value: unknown): value is PlaceMap {
  return record(value) && exactKeys(value, ["connections", "sitePlan"]) && Array.isArray(value.connections)
    && value.connections.every(isPlaceConnection)
    && new Set((value.connections as PlaceConnection[]).map(connection => connection.id)).size === value.connections.length
    && record(value.sitePlan) && Object.entries(value.sitePlan).every(([sceneId, placement]) => ref(sceneId) && record(placement)
      && exactKeys(placement, ["level", "x", "y"]) && integer(placement.x) && integer(placement.y)
      && Number.isSafeInteger(placement.level));
}

/**
 * SPEC 0014 §4 (ADR 0103): the place map a room starts with, from the
 * module's connections and site plan as Room reads them from the module
 * profile. Each connection becomes a module connection; the door state the
 * module gives it must be the state of the doors on both maps, which hold it
 * from then on. Every side is a registered scene and a module door is a
 * portal of that scene's map. Undefined when it does not fit.
 */
export function genesisPlaceMap(value: unknown, geometryByScene: ReadonlyMap<string, CanonicalTacticalGeometry | undefined>):
  PlaceMap | undefined {
  if (!record(value) || !exactKeys(value, ["connections", "sitePlan"]) || !Array.isArray(value.connections)) return undefined;
  const connections: PlaceConnection[] = [];
  for (const entry of value.connections) {
    if (!record(entry) || !exactKeys(entry, ["bidirectional", "id", "sides", "travelMicros", ...(Object.hasOwn(entry, "initialState") ? ["initialState"] : [])])) {
      return undefined;
    }
    const { initialState, ...rest } = entry;
    const connection = { ...structuredClone(rest), source: "module" };
    if (!isPlaceConnection(connection)) return undefined;
    for (const side of connection.sides) {
      if (!geometryByScene.has(side.sceneId)) return undefined;
      const door = side.featureId === null ? undefined
        : geometryByScene.get(side.sceneId)?.obstacles.find(feature => feature.featureId === side.featureId);
      if (side.featureId !== null && (door?.kind !== "portal" || (initialState !== undefined && door.state !== initialState))) return undefined;
    }
    connections.push(connection);
  }
  const placeMap = { connections: connections.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    sitePlan: record(value.sitePlan) ? Object.fromEntries(Object.keys(value.sitePlan).sort()
      .map(sceneId => [sceneId, structuredClone((value.sitePlan as Record<string, unknown>)[sceneId])])) : value.sitePlan };
  return isPlaceMap(placeMap) && Object.keys(placeMap.sitePlan).every(sceneId => geometryByScene.has(sceneId)) ? placeMap : undefined;
}
