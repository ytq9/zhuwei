import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { authoritativeModuleProfile, CURRENT_AUTHORITATIVE_MODULE_VERSION, moduleKpProjection }
  from "../../../app/_runtime/lib/module/authoritative.ts";
import { BLACK_OAK_WILL } from "../../../app/_runtime/lib/module/black-oak-will.ts";
import { BLACK_OAK_SCENE_CONNECTIONS_V4, BLACK_OAK_SITE_PLAN_V4 } from "../../../app/_runtime/lib/module/black-oak-will-connections.ts";
import { BLACK_OAK_OPENING_PLACEMENTS_V2, BLACK_OAK_TACTICAL_GEOMETRY_V3, BLACK_OAK_TACTICAL_GEOMETRY_V4 }
  from "../../../app/_runtime/lib/module/black-oak-will-tactical.ts";
import { registeredModuleProfileId } from "../../../app/_runtime/lib/module/registry.ts";
import { isCanonicalTacticalGeometry } from "../../../app/_runtime/lib/rules/profiles/tactical-geometry.ts";
import { entityOccupanciesOverlap, rectangularFeatureEntity } from "../../../app/_runtime/lib/rules/profiles/combat-geometry.ts";
import { footprintInsidePolygon } from "../../../app/_runtime/lib/rules/v2/carry.ts";
import { nextTo, planSceneApproach } from "../../../app/_runtime/lib/rules/v2/scene-approach.ts";
import { durationSeconds } from "../../../app/_runtime/lib/rules/ruleset.ts";

// SPEC 0014 §2.1 (ADR 0098): new rooms get social-resolution-v4, whose maps
// are completed from the module text, with a door on both sides of every
// module connection, and placed in one site plan; v3 rooms keep v3's maps.

const MODULE_ID = "black-oak-will";
const V4 = "social-resolution-v4";
const SCENES = Object.keys(BLACK_OAK_TACTICAL_GEOMETRY_V4);
const BODY = { width: "60", depth: "60", height: "60" };
const body = (sceneId, position, id = "body") => ({ id, entityId: id, sceneId, position, footprint: BODY });
const featureOf = (sceneId, featureId) => BLACK_OAK_TACTICAL_GEOMETRY_V4[sceneId].obstacles.find(entry => entry.featureId === featureId);
const key = position => `${position.x},${position.y}`;

/** A rectangle's corners in the site plan, the scene's origin added. */
function planBox(sceneId, featureId) {
  const placement = BLACK_OAK_SITE_PLAN_V4[sceneId];
  const xs = featureOf(sceneId, featureId).polygon.map(point => BigInt(point.x) + BigInt(placement.x));
  const ys = featureOf(sceneId, featureId).polygon.map(point => BigInt(point.y) + BigInt(placement.y));
  const low = values => values.reduce((a, b) => a < b ? a : b), high = values => values.reduce((a, b) => a > b ? a : b);
  return { left: low(xs), right: high(xs), top: low(ys), bottom: high(ys) };
}
const touchOrOverlap = (a, b) => a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;

test("new rooms get v4, which exposes its connections and site plan; v3 rooms keep v3's maps and get neither", async () => {
  assert.equal(CURRENT_AUTHORITATIVE_MODULE_VERSION, V4);
  assert.equal(registeredModuleProfileId(MODULE_ID, V4), `module:${MODULE_ID}:${V4}`);
  const v4 = await authoritativeModuleProfile(MODULE_ID);
  assert.equal(v4.moduleRef.profileId, `module:${MODULE_ID}:${V4}`);
  for (const location of v4.storyBible.storyAnchors.locations) {
    assert.deepEqual(location.tacticalGeometry, BLACK_OAK_TACTICAL_GEOMETRY_V4[location.sceneId], location.sceneId);
  }
  assert.deepEqual(v4.storyBible.storyAnchors.locations.find(location => location.sceneId === "wake").openingPlacements,
    BLACK_OAK_OPENING_PLACEMENTS_V2.wake);
  assert.deepEqual(v4.tacticalSite, { connections: structuredClone([...BLACK_OAK_SCENE_CONNECTIONS_V4]),
    sitePlan: structuredClone({ ...BLACK_OAK_SITE_PLAN_V4 }) });
  // It is Room's to read at genesis, not a model's: the KP's view of the
  // module, which is its story bible, does not carry it.
  const kpView = JSON.stringify(moduleKpProjection(v4));
  assert.equal(kpView.includes("travelMicros") || kpView.includes("sitePlan"), false);

  const v3 = await authoritativeModuleProfile(MODULE_ID, "social-resolution-v3");
  for (const location of v3.storyBible.storyAnchors.locations) {
    assert.deepEqual(location.tacticalGeometry, BLACK_OAK_TACTICAL_GEOMETRY_V3[location.sceneId], location.sceneId);
  }
  assert.equal(v3.tacticalSite, undefined);
  assert.equal(v3.storyBible.storyAnchors.locations.find(location => location.sceneId === "yard").tacticalGeometry.obstacles
    .find(entry => entry.featureId === "feature:yard:cellar-door").state, "closed");
});

test("every v4 map validates, and every v3 feature is still there, in the same place and of the same kind", () => {
  assert.deepEqual([...SCENES].sort(), Object.keys(BLACK_OAK_TACTICAL_GEOMETRY_V3).sort());
  for (const sceneId of SCENES) {
    const diagnostics = [];
    const geometry = BLACK_OAK_TACTICAL_GEOMETRY_V4[sceneId];
    assert.equal(isCanonicalTacticalGeometry(geometry, diagnostics), true, `${sceneId} ${JSON.stringify(diagnostics)}`);
    assert.deepEqual(diagnostics, [], sceneId);
    const v3 = BLACK_OAK_TACTICAL_GEOMETRY_V3[sceneId];
    assert.deepEqual(geometry.boundary, v3.boundary, sceneId);
    assert.deepEqual(geometry.spawnPoints, v3.spawnPoints, sceneId);
    for (const before of v3.obstacles) {
      const after = featureOf(sceneId, before.featureId);
      assert.ok(after, `${before.featureId} kept`);
      assert.deepEqual([after.polygon, after.elevation, after.height, after.kind, after.label, after.visibilityPolicyId],
        [before.polygon, before.elevation, before.height, before.kind, before.label, before.visibilityPolicyId], before.featureId);
    }
  }
  // Secrets stay secret.
  assert.equal(featureOf("yard", "feature:yard:hidden-passage").visibilityPolicyId, "visibility:hidden-until-evidence");
  assert.equal(featureOf("wake", "feature:wake:hidden-side-wall-left").visibilityPolicyId, "visibility:hidden-until-evidence");
});

test("each module portal is a door on both maps that starts as the portal does, with an arrival beside it", () => {
  const portals = BLACK_OAK_WILL.world.portals;
  assert.deepEqual(BLACK_OAK_SCENE_CONNECTIONS_V4.map(entry => entry.id).sort(), portals.map(entry => entry.id).sort());
  for (const connection of BLACK_OAK_SCENE_CONNECTIONS_V4) {
    const portal = portals.find(entry => entry.id === connection.id);
    assert.deepEqual(connection.sides.map(side => side.sceneId), [portal.from, portal.to], connection.id);
    assert.equal(connection.initialState, portal.initialState, connection.id);
    assert.equal(connection.travelMicros, String(durationSeconds(portal.traversalTime) * 1_000_000), connection.id);
    assert.equal(connection.bidirectional, true, connection.id);
    for (const side of connection.sides) {
      const door = featureOf(side.sceneId, side.featureId);
      const label = `${connection.id} ${side.sceneId}`;
      assert.ok(door, label);
      assert.equal(door.kind, "portal", label);
      assert.equal(door.state, connection.initialState, label);
      assert.equal(door.visibilityPolicyId, "visibility:public", label);
      assert.ok(door.stateGraph.states.some(entry => entry.state === connection.initialState), label);
      // The arrival is inside the map, clear of anything solid, beside the door.
      const geometry = BLACK_OAK_TACTICAL_GEOMETRY_V4[side.sceneId];
      const arrival = body(side.sceneId, side.arrival);
      assert.equal(side.arrival.elevation, "0", label);
      assert.equal(footprintInsidePolygon(side.arrival, arrival,
        geometry.boundary.points.map(point => ({ x: BigInt(point.x), y: BigInt(point.y) }))), true, label);
      for (const solid of geometry.obstacles.filter(entry => entry.impassable)) {
        assert.equal(entityOccupanciesOverlap(arrival, rectangularFeatureEntity(solid, side.sceneId)), false, `${label} in ${solid.featureId}`);
      }
      assert.equal(nextTo(arrival, rectangularFeatureEntity(door, side.sceneId)), true, label);
    }
  }
  // The nailed cellar door is locked from both sides, and nothing opens it by hand.
  for (const [sceneId, featureId] of [["yard", "feature:yard:cellar-door"], ["cellar", "feature:cellar:yard-door"]]) {
    const door = featureOf(sceneId, featureId);
    assert.deepEqual([door.state, door.impassable, door.opaque], ["locked", true, true]);
    assert.equal(door.stateGraph.transitions.some(entry => entry.fromState === "locked"), false);
    assert.ok(door.stateGraph.damageTransitions.some(entry => entry.fromState === "locked" && entry.toState === "destroyed"));
  }
});

test("on every v4 map each spawn point, connection arrival and opening place walks to every other", () => {
  for (const sceneId of SCENES) {
    const geometry = BLACK_OAK_TACTICAL_GEOMETRY_V4[sceneId];
    const arrivals = BLACK_OAK_SCENE_CONNECTIONS_V4.flatMap(connection => connection.sides)
      .filter(side => side.sceneId === sceneId).map(side => side.arrival);
    const opening = Object.values(BLACK_OAK_OPENING_PLACEMENTS_V2[sceneId] ?? {});
    const places = [...new Map([...geometry.spawnPoints, ...arrivals, ...opening].map(place => [key(place), place])).values()];
    const fixture = createAuthoredProbeFixture(`module-maps:${sceneId}`, {
      additionalScenes: [{ id: sceneId, name: sceneId, geometry }], characterScenes: { [ACTOR]: sceneId } });
    const state = structuredClone(fixture.state);
    const walk = (from, to) => {
      state.combatRuntime.entities[ACTOR].position = structuredClone(from);
      return planSceneApproach(state, ACTOR, sceneId, { kind: "point", position: structuredClone(to) });
    };
    // Every place reaches the first and the first reaches every place, so
    // any two are joined through it.
    const [hub, ...rest] = places;
    for (const place of rest) {
      assert.equal(walk(hub, place).kind, "move", `${sceneId} ${key(hub)} -> ${key(place)}`);
      assert.equal(walk(place, hub).kind, "move", `${sceneId} ${key(place)} -> ${key(hub)}`);
    }
  }
});

test("one site plan: doors of a connection meet on the same level and line up between levels", () => {
  assert.deepEqual(Object.keys(BLACK_OAK_SITE_PLAN_V4).sort(), [...SCENES].sort());
  assert.deepEqual(Object.fromEntries(Object.entries(BLACK_OAK_SITE_PLAN_V4).map(([sceneId, placement]) => [sceneId, placement.level])),
    { wake: 0, wills: 0, yard: 0, "private-lian": 1, cellar: -1, shrine: -1, reveal: 0, confrontation: 0 });
  for (const connection of BLACK_OAK_SCENE_CONNECTIONS_V4) {
    const [from, to] = connection.sides;
    const levels = [BLACK_OAK_SITE_PLAN_V4[from.sceneId].level, BLACK_OAK_SITE_PLAN_V4[to.sceneId].level];
    assert.ok(Math.abs(levels[0] - levels[1]) <= 1, connection.id);
    assert.equal(touchOrOverlap(planBox(from.sceneId, from.featureId), planBox(to.sceneId, to.featureId)), true, connection.id);
  }
  // Between levels: the stairs go up from the hall, the cellar door goes down from the yard.
  assert.deepEqual(BLACK_OAK_SCENE_CONNECTIONS_V4.filter(connection =>
    BLACK_OAK_SITE_PLAN_V4[connection.sides[0].sceneId].level !== BLACK_OAK_SITE_PLAN_V4[connection.sides[1].sceneId].level)
    .map(connection => connection.id), ["wake-private-lian", "yard-cellar"]);
  // The places of one level do not overlap; the story scenes are the hall later on.
  const places = BLACK_OAK_WILL.world.locationSceneIds;
  const extent = sceneId => {
    const placement = BLACK_OAK_SITE_PLAN_V4[sceneId];
    const points = BLACK_OAK_TACTICAL_GEOMETRY_V4[sceneId].boundary.points;
    const xs = points.map(point => BigInt(point.x) + BigInt(placement.x)), ys = points.map(point => BigInt(point.y) + BigInt(placement.y));
    const low = values => values.reduce((a, b) => a < b ? a : b), high = values => values.reduce((a, b) => a > b ? a : b);
    return { left: low(xs), right: high(xs), top: low(ys), bottom: high(ys) };
  };
  for (const [index, one] of places.entries()) {
    for (const other of places.slice(index + 1)) {
      if (BLACK_OAK_SITE_PLAN_V4[one].level !== BLACK_OAK_SITE_PLAN_V4[other].level) continue;
      const a = extent(one), b = extent(other);
      assert.equal(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom, false, `${one} overlaps ${other}`);
    }
  }
  for (const story of ["reveal", "confrontation"]) assert.deepEqual(BLACK_OAK_SITE_PLAN_V4[story], BLACK_OAK_SITE_PLAN_V4.wake);
});
