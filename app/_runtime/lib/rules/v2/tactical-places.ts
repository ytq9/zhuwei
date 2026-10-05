import {
  isTacticalPlacePlacement,
  tacticalLevelLabel,
  type TacticalFeatureDestination,
  type TacticalKnownFeature,
  type TacticalKnownPlace,
  type TacticalPlaceFeature,
  type TacticalPlacePlacement,
} from "../tactical-projection";
import { isCanonicalTacticalGeometry, type CanonicalTacticalFeature } from "../profiles/tactical-geometry";
import type { AuthoritativeWorldState, JsonRecord } from "./model";
import { isNonEmptyString, isRecord } from "./validation";

/**
 * SPEC 0014 §8 (ADR 0103 decisions 4-5): what a player's own map shows of the
 * room's place map -- where each door on it leads, and the places the player
 * has been to or is in, for a stitched map. The place map itself
 * (`campaignRuntime.placeMap`) and each character's `visitedSceneIds` are
 * written by the room; this module only reads the parts a map needs and
 * projects nothing a viewer may not know: features of other places are the
 * public ones, without live state, and no creature anywhere else.
 */

type PlaceMapSide = Readonly<{ sceneId: string; featureId: string | null }>;
type PlaceMapConnection = Readonly<{ id: string; sides: readonly [PlaceMapSide, PlaceMapSide]; bidirectional: boolean }>;
type PlaceMap = Readonly<{ connections: readonly PlaceMapConnection[]; sitePlan: Readonly<Record<string, TacticalPlacePlacement>> }>;

/** The most places a stitched map lists, the current one included. */
const MAX_KNOWN_PLACES = 64;

function placeMapSide(value: unknown): PlaceMapSide | undefined {
  return isRecord(value) && isNonEmptyString(value.sceneId) && (value.featureId === null || isNonEmptyString(value.featureId))
    ? { sceneId: value.sceneId, featureId: value.featureId }
    : undefined;
}

/** The room's place map, read for display: connections in id order, and the
 * site plan's well-formed placements. Absent when the room has none. */
function placeMapOf(state: AuthoritativeWorldState): PlaceMap | undefined {
  const value = (state.campaignRuntime as unknown as JsonRecord).placeMap;
  if (!isRecord(value) || !Array.isArray(value.connections) || !isRecord(value.sitePlan)) return undefined;
  const connections = value.connections.flatMap((entry): PlaceMapConnection[] => {
    if (!isRecord(entry) || !isNonEmptyString(entry.id) || typeof entry.bidirectional !== "boolean"
      || !Array.isArray(entry.sides) || entry.sides.length !== 2) return [];
    const from = placeMapSide(entry.sides[0]);
    const to = placeMapSide(entry.sides[1]);
    return from === undefined || to === undefined ? [] : [{ id: entry.id, sides: [from, to], bidirectional: entry.bidirectional }];
  }).sort((left, right) => left.id.localeCompare(right.id));
  const sitePlan = Object.fromEntries(Object.entries(value.sitePlan).flatMap(([sceneId, placement]) =>
    isTacticalPlacePlacement(placement) ? [[sceneId, { x: placement.x, y: placement.y, level: placement.level }]] : []));
  return { connections, sitePlan };
}

function sceneFeatures(state: AuthoritativeWorldState, sceneId: string): CanonicalTacticalFeature[] | undefined {
  const scene = state.combatRuntime.scenes[sceneId];
  const geometry = isRecord(scene) ? scene.geometry : undefined;
  return isCanonicalTacticalGeometry(geometry) ? geometry.obstacles : undefined;
}

/** SPEC 0014 §§4、9.1: a door is passable open or destroyed; any other
 * feature at a connection's end unless it blocks movement. An end without a
 * feature has nothing to shut. */
function sidePassable(state: AuthoritativeWorldState, side: PlaceMapSide): boolean {
  if (side.featureId === null) return true;
  const feature = sceneFeatures(state, side.sceneId)?.find((entry) => entry.featureId === side.featureId);
  if (feature === undefined) return false;
  return feature.kind === "portal" ? feature.state === "open" || feature.state === "destroyed" : !feature.impassable;
}

/** SPEC 0014 §8 (ADR 0103 decision 4): each known feature of the current
 * place that is one end of a connection leads to the other end's place,
 * passable when the doors at both ends are. A one-way connection leads only
 * from its first end. A feature at the end of several connections takes the
 * first by id. */
function withDestinations(
  state: AuthoritativeWorldState,
  placeMap: PlaceMap,
  sceneId: string,
  features: TacticalKnownFeature[],
): TacticalKnownFeature[] {
  const destinations = new Map<string, TacticalFeatureDestination>();
  for (const connection of placeMap.connections) {
    connection.sides.forEach((side, index) => {
      if (index === 1 && !connection.bidirectional) return;
      const other = connection.sides[1 - index];
      if (side.sceneId !== sceneId || side.featureId === null || other.sceneId === sceneId
        || destinations.has(side.featureId)) return;
      const name = state.scenes[other.sceneId]?.name;
      if (!isNonEmptyString(name)) return;
      destinations.set(side.featureId, {
        sceneId: other.sceneId,
        name,
        passable: connection.sides.every((end) => sidePassable(state, end)),
      });
    });
  }
  return features.map((feature) => {
    const leadsTo = destinations.get(feature.id);
    return leadsTo === undefined ? feature : { ...feature, leadsTo };
  });
}

/** What another place's feature shows: shape, label, kind and ground, never
 * its live state. Hidden features stay out, as on the current map. */
function placeFeatures(features: readonly CanonicalTacticalFeature[]): TacticalPlaceFeature[] {
  return features
    .filter((feature) => feature.visibilityPolicyId === "visibility:public"
      || feature.visibilityPolicyId === "visibility:scene-observers")
    .sort((left, right) => left.featureId.localeCompare(right.featureId))
    .map((feature) => ({
      id: feature.featureId,
      kind: feature.kind,
      label: feature.label,
      polygon: structuredClone(feature.polygon),
      elevation: feature.elevation,
      height: feature.height,
      ...(feature.landform === undefined ? {} : { landform: feature.landform }),
      ...(feature.depth === undefined ? {} : { depth: feature.depth }),
      ...(feature.current === undefined ? {} : { current: feature.current }),
      ...(feature.material === undefined ? {} : { material: feature.material }),
    }));
}

/** The places the character has been to, its current place always among
 * them; just the current place when the room records none. */
function visitedSceneIds(state: AuthoritativeWorldState, characterId: string, currentSceneId: string): string[] {
  const recorded = (state.entities[characterId] as unknown as JsonRecord | undefined)?.visitedSceneIds;
  const visited = Array.isArray(recorded) ? recorded.filter(isNonEmptyString) : [];
  return [...new Set([currentSceneId, ...visited])];
}

/** SPEC 0014 §8 (ADR 0103 decision 5): the places a stitched map may show --
 * the current place and those the character has been to that have a map and
 * a site-plan placement -- sorted by scene. None without a placement for the
 * current place, since the stitched map is laid out around it. */
function knownPlaces(
  state: AuthoritativeWorldState,
  placeMap: PlaceMap,
  characterId: string,
  currentSceneId: string,
): TacticalKnownPlace[] | undefined {
  if (placeMap.sitePlan[currentSceneId] === undefined) return undefined;
  const others = visitedSceneIds(state, characterId, currentSceneId)
    .filter((sceneId) => sceneId !== currentSceneId)
    .sort((left, right) => left.localeCompare(right));
  const places = [currentSceneId, ...others].flatMap((sceneId): TacticalKnownPlace[] => {
    const name = state.scenes[sceneId]?.name;
    const placement = placeMap.sitePlan[sceneId];
    const scene = state.combatRuntime.scenes[sceneId];
    const geometry = isRecord(scene) ? scene.geometry : undefined;
    if (!isNonEmptyString(name) || placement === undefined || !isCanonicalTacticalGeometry(geometry)) return [];
    return [{
      sceneId,
      name,
      placement: { ...placement },
      boundary: structuredClone(geometry.boundary),
      features: sceneId === currentSceneId ? [] : placeFeatures(geometry.obstacles),
    }];
  });
  if (places[0]?.sceneId !== currentSceneId) return undefined;
  return places.slice(0, MAX_KNOWN_PLACES).sort((left, right) => left.sceneId.localeCompare(right.sceneId));
}

/** One readout line per known place, in the same order. */
function placeReadout(places: readonly TacticalKnownPlace[], currentSceneId: string): string[] {
  return places.map((place) => {
    const where = `${place.name}（${tacticalLevelLabel(place.placement.level)}）`;
    if (place.sceneId === currentSceneId) return `${where}：你在这里。`;
    return place.features.length === 0
      ? `${where}：到过；没有已知环境要素。`
      : `${where}：到过；已知${place.features.map((feature) => feature.label).join("、")}。`;
  });
}

/** SPEC 0014 §8 (ADR 0103 decision 4): the readout's words for where a door
 * leads. */
export function tacticalDestinationPhrase(destination: TacticalFeatureDestination): string {
  return `通往${destination.name}（${destination.passable ? "现在可以通过" : "现在过不去"}）`;
}

/**
 * SPEC 0014 §8 (ADR 0103 decisions 4-5): the place-map part of a player's
 * own tactical projection. Without a place map the features come back as
 * they are and there are no places.
 */
export function projectTacticalPlaces(
  state: AuthoritativeWorldState,
  characterId: string,
  currentSceneId: string,
  features: TacticalKnownFeature[],
): { knownFeatures: TacticalKnownFeature[]; knownPlaces?: TacticalKnownPlace[]; placeReadout?: string[] } {
  const placeMap = placeMapOf(state);
  if (placeMap === undefined) return { knownFeatures: features };
  const places = knownPlaces(state, placeMap, characterId, currentSceneId);
  return {
    knownFeatures: withDestinations(state, placeMap, currentSceneId, features),
    ...(places === undefined ? {} : { knownPlaces: places, placeReadout: placeReadout(places, currentSceneId) }),
  };
}
