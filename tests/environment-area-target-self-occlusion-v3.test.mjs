import assert from "node:assert/strict";
import test from "node:test";

import { environmentAreaTargets } from "../app/_runtime/lib/rules/v2/environment-targeting.ts";

function feature(featureId, centerX, opaque) {
  return {
    featureId,
    kind: "barrier",
    label: featureId,
    state: "standing",
    polygon: [
      { x: String(centerX - 12), y: "-24" },
      { x: String(centerX - 12), y: "24" },
      { x: String(centerX + 12), y: "24" },
      { x: String(centerX + 12), y: "-24" },
    ],
    elevation: "0",
    height: "120",
    opaque,
    impassable: opaque,
    cover: opaque ? "full" : "none",
    propagation: opaque ? "blocks" : "passes",
    visibilityPolicyId: "visibility:scene-observers",
  };
}

function entity(entityId, centerX) {
  return {
    id: entityId,
    entityOrdinal: "1",
    sceneId: "scene:area",
    lifeState: "alive",
    position: { x: String(centerX), y: "0", elevation: "0" },
    footprint: { width: "24", depth: "24", height: "72" },
  };
}

function stateWith(obstacles, entities = []) {
  return {
    combatRuntime: {
      scenes: {
        "scene:area": {
          geometry: {
            schema: "zhuwei.tactical-geometry/v1",
            unit: "inch",
            boundary: {
              kind: "polygon",
              points: [
                { x: "-240", y: "-240" },
                { x: "-240", y: "240" },
                { x: "240", y: "240" },
                { x: "240", y: "-240" },
              ],
            },
            spawnPoints: [{ x: "0", y: "0", elevation: "0" }],
            obstacles: [...obstacles].sort((left, right) => left.featureId.localeCompare(right.featureId)),
            clearanceZones: [],
          },
        },
      },
      entities: Object.fromEntries(entities.map((entry) => [entry.id, entry])),
    },
  };
}

const areaEffect = {
  origin: { kind: "featureCentroid", elevationInches: "60" },
  shape: { kind: "sphere", radiusInches: "120", propagation: "straight" },
};

test("opaque environment target does not occlude itself, while another opaque prism still blocks it", () => {
  const source = feature("feature:area:00-source", 0, false);
  const target = feature("feature:area:20-target", 72, true);
  const unobstructed = environmentAreaTargets(
    stateWith([source, target]),
    "scene:area",
    source.featureId,
    areaEffect,
  );
  assert.deepEqual(unobstructed?.featureTargetIds, [target.featureId]);

  const blocker = feature("feature:area:10-blocker", 36, true);
  const obstructed = environmentAreaTargets(
    stateWith([source, blocker, target]),
    "scene:area",
    source.featureId,
    areaEffect,
  );
  assert.deepEqual(obstructed?.featureTargetIds, [blocker.featureId]);
});

test("an opaque source does not block its own outbound area, while another opaque prism still does", () => {
  const source = feature("feature:area:00-source", 0, true);
  const target = entity("entity:target", 72);
  const unobstructed = environmentAreaTargets(
    stateWith([source], [target]),
    "scene:area",
    source.featureId,
    areaEffect,
  );
  assert.deepEqual(unobstructed?.entityTargetIds, [target.id]);

  const blocker = feature("feature:area:10-blocker", 36, true);
  const obstructed = environmentAreaTargets(
    stateWith([source, blocker], [target]),
    "scene:area",
    source.featureId,
    areaEffect,
  );
  assert.deepEqual(obstructed?.entityTargetIds, []);
});
