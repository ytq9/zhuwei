import {
  isCanonicalTacticalGeometry,
  type CanonicalTacticalFeature,
} from "../profiles/tactical-geometry";
import type { AreaEffect } from "../profiles/environment";
import { entitiesAffectedByArea } from "../profiles/combat-geometry";
import type { AuthoritativeWorldState, JsonRecord } from "./model";
import { isRecord } from "./validation";

function featureOrigin(
  feature: CanonicalTacticalFeature,
  areaEffect: AreaEffect,
): { x: string; y: string; elevation: string } {
  const xs = feature.polygon.map(({ x }) => BigInt(x));
  const ys = feature.polygon.map(({ y }) => BigInt(y));
  const minimumX = xs.reduce((minimum, value) => value < minimum ? value : minimum);
  const maximumX = xs.reduce((maximum, value) => value > maximum ? value : maximum);
  const minimumY = ys.reduce((minimum, value) => value < minimum ? value : minimum);
  const maximumY = ys.reduce((maximum, value) => value > maximum ? value : maximum);
  return {
    x: ((minimumX + maximumX) / 2n).toString(),
    y: ((minimumY + maximumY) / 2n).toString(),
    elevation: areaEffect.origin.elevationInches,
  };
}

function featureAsGeometryEntity(
  feature: CanonicalTacticalFeature,
  ordinal: number,
): JsonRecord {
  const xs = feature.polygon.map(({ x }) => BigInt(x));
  const ys = feature.polygon.map(({ y }) => BigInt(y));
  const minimumX = xs.reduce((minimum, value) => value < minimum ? value : minimum);
  const maximumX = xs.reduce((maximum, value) => value > maximum ? value : maximum);
  const minimumY = ys.reduce((minimum, value) => value < minimum ? value : minimum);
  const maximumY = ys.reduce((maximum, value) => value > maximum ? value : maximum);
  return {
    id: feature.featureId,
    entityOrdinal: String(100_000 + ordinal),
    lifeState: "alive",
    position: {
      x: ((minimumX + maximumX) / 2n).toString(),
      y: ((minimumY + maximumY) / 2n).toString(),
      elevation: feature.elevation,
    },
    footprint: {
      width: (maximumX > minimumX ? maximumX - minimumX : 1n).toString(),
      depth: (maximumY > minimumY ? maximumY - minimumY : 1n).toString(),
      height: feature.height,
    },
  };
}

/** Complete target discovery; no caller-supplied target list participates. */
export function environmentAreaTargets(
  state: AuthoritativeWorldState,
  sceneId: string,
  sourceFeatureId: string,
  areaEffect: AreaEffect,
): {
  origin: { x: string; y: string; elevation: string };
  entityTargetIds: string[];
  featureTargetIds: string[];
} | undefined {
  const scene = state.combatRuntime.scenes[sceneId];
  const geometry = isRecord(scene) ? scene.geometry : undefined;
  if (!isCanonicalTacticalGeometry(geometry)) return undefined;
  const sourceFeature = geometry.obstacles.find(({ featureId }) =>
    featureId === sourceFeatureId);
  if (sourceFeature === undefined) return undefined;
  const origin = featureOrigin(sourceFeature, areaEffect);
  // Propagation begins inside the source feature's own prism. Keeping an
  // opaque source in the blocker set would make it occlude every outbound
  // sample, so remove it once for both entity and feature discovery. Other
  // opaque features remain authoritative blockers.
  const propagationScene = structuredClone(scene);
  if (!isRecord(propagationScene.geometry)
    || !Array.isArray(propagationScene.geometry.obstacles)) return undefined;
  propagationScene.geometry.obstacles = propagationScene.geometry.obstacles.filter((obstacle) =>
    !isRecord(obstacle) || obstacle.featureId !== sourceFeatureId);
  const entityCandidates = Object.values(state.combatRuntime.entities)
    .filter((entity) => entity.sceneId === sceneId);
  const featureCandidates = geometry.obstacles
    .filter((feature) => feature.featureId !== sourceFeatureId)
    .map(featureAsGeometryEntity);
  const featureTargetIds = featureCandidates.flatMap((candidate) => {
    // An opaque target occupies its own prism. Keeping that prism in the
    // propagation set makes every sample appear occluded by the target itself.
    // Remove this candidate in addition to the already-removed source; every
    // other opaque obstacle keeps blocking the area effect.
    const targetScene = structuredClone(propagationScene);
    if (!isRecord(targetScene.geometry) || !Array.isArray(targetScene.geometry.obstacles)) {
      return [];
    }
    targetScene.geometry.obstacles = targetScene.geometry.obstacles.filter((obstacle) =>
      !isRecord(obstacle) || obstacle.featureId !== candidate.id);
    return entitiesAffectedByArea(
      [candidate],
      targetScene,
      origin,
      areaEffect.shape,
    );
  });
  return {
    origin,
    entityTargetIds: entitiesAffectedByArea(
      entityCandidates,
      propagationScene,
      origin,
      areaEffect.shape,
    ).sort(),
    featureTargetIds: featureTargetIds.sort(),
  };
}
