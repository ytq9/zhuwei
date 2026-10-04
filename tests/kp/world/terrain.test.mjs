import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as PEER, PROBE_SCENE as SCENE }
  from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { authoritativeModuleProfile } from "../../../app/_runtime/lib/module/authoritative.ts";
import { BLACK_OAK_OPENING_PLACEMENTS_V2, BLACK_OAK_TACTICAL_GEOMETRY_V1, BLACK_OAK_TACTICAL_GEOMETRY_V2 }
  from "../../../app/_runtime/lib/module/black-oak-will-tactical.ts";
import { registeredModuleProfileId } from "../../../app/_runtime/lib/module/registry.ts";
import { isCanonicalTacticalGeometry } from "../../../app/_runtime/lib/rules/profiles/tactical-geometry.ts";
import { analyzeCombatMovement, coverLevel } from "../../../app/_runtime/lib/rules/profiles/combat-geometry.ts";
import { planJump, planJumpTakeoff } from "../../../app/_runtime/lib/rules/v2/character-jump.ts";
import { planSceneApproach } from "../../../app/_runtime/lib/rules/v2/scene-approach.ts";
import { vnextProposalContextBody } from "../../../app/_runtime/lib/kp/vnext/proposal-context.ts";

// SPEC 0014 §4 (ADR 0098), step 1 of 3: the map records terrain -- a ditch or
// water with its depth, water's current, a step, low wall or cliff by its
// height, and what a feature is made of. Nobody walks into a ditch or water
// until climbing and swimming exist; a long jump clears a ditch; the KP reads
// the terrain from its frozen context; Black Oak's terrain version puts a
// ditch and a low wall in the back yard for new rooms only.

const rectangle = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const point = (x, y) => ({ x, y, elevation: "0" });
const DITCH_ID = "feature:probe-ditch";
/** A 5-foot-wide, 3-foot-deep earth ditch across the whole 600-inch room, between y 240 and 300. */
const DITCH = { featureId: DITCH_ID, kind: "terrain", label: "土沟", state: "dry", polygon: rectangle("0", "240", "600", "300"),
  elevation: "0", height: "1", opaque: false, impassable: true, cover: "none", propagation: "passes",
  landform: "ditch", depth: "36", material: "earth", visibilityPolicyId: "visibility:public" };
/** A 3-foot stone wall on the same footprint. */
const { depth: _depth, ...DITCH_FOOTPRINT } = DITCH;
const LOW_WALL = { ...DITCH_FOOTPRINT, featureId: "feature:probe-low-wall", kind: "barrier", label: "矮石墙", state: "intact", height: "36",
  opaque: true, cover: "half", propagation: "blocks", landform: "lowWall", material: "stone" };
const POND = { featureId: "feature:probe-pond", kind: "terrain", label: "急流水渠", state: "flowing", polygon: rectangle("420", "420", "540", "540"),
  elevation: "0", height: "1", opaque: false, impassable: true, cover: "none", propagation: "passes",
  landform: "water", depth: "48", current: "rough", material: "stone", visibilityPolicyId: "visibility:public" };
/** The actor at (100, 100) north of the ditch, the other player at (100, 420) south of it. */
const SPAWNS = [point("100", "100"), point("100", "420")];

const fixture = (name, obstacles, options = {}) => createAuthoredProbeFixture(`terrain:${name}`, { extraObstacles: obstacles, spawnPoints: SPAWNS, ...options });
const sceneOf = (f, sceneId = SCENE) => f.state.combatRuntime.scenes[sceneId];
const geometryWith = (obstacle) => ({ ...sceneOf(fixture("shape", [])).geometry,
  obstacles: [...sceneOf(fixture("shape", [])).geometry.obstacles, obstacle].sort((a, b) => a.featureId.localeCompare(b.featureId)) });
const diagnosticsOf = (obstacle) => {
  const diagnostics = [];
  assert.equal(isCanonicalTacticalGeometry(geometryWith(obstacle), diagnostics), false, JSON.stringify(obstacle));
  return diagnostics.map(entry => [entry.path.slice(2).join("."), entry.constraint]);
};
const hasTerrainField = feature => ["landform", "depth", "current", "material"].some(key => key in feature);

test("terrain fields validate on a feature; every earlier map stays canonical and carries none", () => {
  for (const sample of [DITCH, LOW_WALL, POND, { ...LOW_WALL, landform: "cliff", height: "240" }, { ...LOW_WALL, landform: "step", height: "12" }]) {
    const diagnostics = [];
    assert.equal(isCanonicalTacticalGeometry(geometryWith(sample), diagnostics), true, JSON.stringify(diagnostics));
  }
  for (const layouts of [BLACK_OAK_TACTICAL_GEOMETRY_V1, BLACK_OAK_TACTICAL_GEOMETRY_V2]) {
    for (const [sceneId, geometry] of Object.entries(layouts)) {
      assert.equal(isCanonicalTacticalGeometry(geometry), true, sceneId);
      assert.equal(geometry.obstacles.some(hasTerrainField), false, sceneId);
    }
  }
  // Each refusal names the field and the rule.
  assert.deepEqual(diagnosticsOf({ ...LOW_WALL, depth: "36" }), [["depth", "geometry:depth-landform"]]);
  assert.deepEqual(diagnosticsOf({ ...DITCH, depth: "0" }), [["depth", "geometry:field-contract"]]);
  assert.deepEqual(diagnosticsOf({ ...DITCH, current: "still" }), [["current", "geometry:current-landform"]]);
  const { current: _current, ...stillWater } = POND;
  assert.deepEqual(diagnosticsOf(stillWater), [["current", "geometry:field-contract"]]);
  assert.deepEqual(diagnosticsOf({ ...POND, current: "calm" }), [["current", "geometry:field-contract"]]);
  assert.deepEqual(diagnosticsOf({ ...DITCH, material: "glass" }), [["material", "geometry:field-contract"]]);
  assert.deepEqual(diagnosticsOf({ ...DITCH, landform: "pit" }), [["landform", "geometry:field-contract"]]);
  // A ditch that could be walked into, or that hid what is beyond it, is refused.
  assert.deepEqual(diagnosticsOf({ ...DITCH, impassable: false }), [["", "geometry:hollow-terrain"]]);
  assert.deepEqual(diagnosticsOf({ ...DITCH, opaque: true }), [["", "geometry:hollow-terrain"]]);
});

test("nobody walks into or across the ditch, and it hides nothing beyond it", () => {
  const f = fixture("walk", [DITCH]);
  const actor = f.state.combatRuntime.entities[ACTOR], peer = f.state.combatRuntime.entities[PEER];
  assert.equal(analyzeCombatMovement(actor, [], sceneOf(f), [point("100", "100"), point("100", "360")], new Set()).ok, false);
  assert.equal(analyzeCombatMovement(actor, [], sceneOf(f), [point("100", "100"), point("100", "270")], new Set()).ok, false);
  assert.deepEqual(planSceneApproach(f.state, ACTOR, SCENE, { kind: "point", position: point("300", "360") }),
    { kind: "rejected", reason: "approach:no-route" });
  // A walk along its near edge is free; the other player stays in plain sight.
  assert.equal(analyzeCombatMovement(actor, [], sceneOf(f), [point("100", "100"), point("100", "210")], new Set()).ok, true);
  assert.equal(coverLevel(sceneOf(f), actor, peer, []), "none");
  // The player's map names it, its depth and what it is made of.
  const view = f.runtime.project(f.profiles, f.state, f.viewer, { channel: "realtime" });
  assert.equal(view.kind, "projected", JSON.stringify(view));
  const shown = view.tacticalProjection.knownFeatures.find(feature => feature.id === DITCH_ID);
  assert.deepEqual([shown.landform, shown.depth, shown.material, shown.impassable, shown.opaque], ["ditch", "36", "earth", true, false]);
  assert.ok(view.tacticalProjection.textualReadout.features.includes("土沟：阻挡移动、不阻挡视线、无掩护、允许区域传播、地表未改变、沟、深 36 英寸、土质。"));
});

test("a running long jump clears the ditch, however deep, with no roll to clear it; a low wall there is too high", () => {
  // Strength 10: ten feet with a run-up. The actor walks to the nearest spot
  // on the near edge and jumps 120 inches straight across, landing with its
  // footprint on the far edge.
  const f = fixture("jump", [DITCH]);
  const takeoff = planJumpTakeoff(f.state, ACTOR, DITCH_ID);
  assert.equal(takeoff.kind, "accepted", JSON.stringify(takeoff));
  assert.deepEqual(takeoff.takeoff, point("90", "210"));
  assert.deepEqual([takeoff.jump.to, takeoff.jump.running, takeoff.jump.impassable, takeoff.jump.difficultLanding, takeoff.jump.maxInches],
    [point("90", "330"), true, false, false, "120"]);
  const deep = fixture("jump-deep", [{ ...DITCH, depth: "240" }]);
  assert.deepEqual(planJumpTakeoff(deep.state, ACTOR, DITCH_ID), takeoff);
  // Standing at the edge with the room's north wall behind, it gets half the reach.
  const standing = fixture("jump-standing", [{ ...DITCH, polygon: rectangle("0", "150", "600", "210") }], { spawnPoints: [point("100", "120"), point("100", "420")] });
  assert.deepEqual(planJump(standing.state, ACTOR, DITCH_ID), { kind: "rejected", code: "worldLawViolation", reason: "jump:beyond-reach" });
  // A ditch wider than the reach cannot be jumped from anywhere.
  const wide = fixture("jump-wide", [{ ...DITCH, polygon: rectangle("0", "240", "600", "330") }]);
  assert.deepEqual(planJumpTakeoff(wide.state, ACTOR, DITCH_ID), { kind: "rejected", code: "worldLawViolation", reason: "jump:beyond-reach" });
  // The same footprint as a 3-foot wall is an obstacle to clear, 36 inches
  // high against a 120-inch reach: more than a quarter of it.
  const wall = fixture("jump-wall", [LOW_WALL]);
  assert.deepEqual(planJumpTakeoff(wall.state, ACTOR, LOW_WALL.featureId), { kind: "rejected", code: "worldLawViolation", reason: "jump:obstacle-too-high" });
});

test("the KP's frozen context shows the terrain: kind, depth or height, material and current", () => {
  const f = fixture("context", [DITCH, POND]);
  const shown = new Map();
  const collect = value => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value !== null && typeof value === "object") {
      if (typeof value.featureId === "string" && "polygon" in value) shown.set(value.featureId, value);
      Object.values(value).forEach(collect);
    }
  };
  collect(JSON.parse(vnextProposalContextBody(f.requiredContext)));
  const pick = (id, keys) => keys.map(key => shown.get(id)?.[key]);
  assert.deepEqual(pick(DITCH_ID, ["landform", "depth", "material", "elevation"]), ["ditch", "36", "earth", "0"]);
  assert.deepEqual(pick(POND.featureId, ["landform", "depth", "current", "material"]), ["water", "48", "rough", "stone"]);
});

// New rooms now get social-resolution-v4, which keeps all of this
// (module-maps.test.mjs); a v3 room reads the v3 maps.
test("terrain-version rooms get the yard's ditch and low wall, materials, and every passage still open; v2 rooms are unchanged", async () => {
  assert.equal(registeredModuleProfileId("black-oak-will", "social-resolution-v3"), "module:black-oak-will:social-resolution-v3");
  const v3 = await authoritativeModuleProfile("black-oak-will", "social-resolution-v3");
  const v2 = await authoritativeModuleProfile("black-oak-will", "social-resolution-v2");
  assert.equal(v3.moduleRef.profileId, "module:black-oak-will:social-resolution-v3");
  const scene = (profile, sceneId) => profile.storyBible.storyAnchors.locations.find(location => location.sceneId === sceneId);
  // A v2 room reads exactly the v2 maps, with no terrain fields.
  for (const location of v2.storyBible.storyAnchors.locations) {
    assert.deepEqual(location.tacticalGeometry, BLACK_OAK_TACTICAL_GEOMETRY_V2[location.sceneId], location.sceneId);
  }
  assert.deepEqual(scene(v2, "yard").tacticalGeometry, BLACK_OAK_TACTICAL_GEOMETRY_V1.yard);

  const yard = scene(v3, "yard").tacticalGeometry;
  const byId = id => yard.obstacles.find(feature => feature.featureId === id);
  assert.equal(isCanonicalTacticalGeometry(yard), true);
  assert.deepEqual(yard.spawnPoints, BLACK_OAK_TACTICAL_GEOMETRY_V2.yard.spawnPoints);
  assert.deepEqual(byId("feature:yard:drainage-ditch"), { featureId: "feature:yard:drainage-ditch", kind: "terrain", label: "排水沟", state: "muddy",
    polygon: rectangle("-420", "-360", "-360", "-60"), elevation: "0", height: "1", opaque: false, impassable: true, cover: "none",
    propagation: "passes", landform: "ditch", depth: "36", material: "mud", visibilityPolicyId: "visibility:public" });
  assert.deepEqual([byId("feature:yard:low-stone-wall").landform, byId("feature:yard:low-stone-wall").height, byId("feature:yard:low-stone-wall").material],
    ["lowWall", "36", "stone"]);
  assert.equal(byId("feature:yard:cellar-door").material, "wood");
  // Apart from materials, every v2 feature is as it was.
  const plain = ({ material: _material, ...feature }) => feature;
  for (const feature of BLACK_OAK_TACTICAL_GEOMETRY_V2.yard.obstacles) assert.deepEqual(plain(byId(feature.featureId)), feature);
  const wake = scene(v3, "wake");
  assert.deepEqual(wake.openingPlacements, BLACK_OAK_OPENING_PLACEMENTS_V2.wake);
  assert.deepEqual(wake.tacticalGeometry.obstacles.filter(feature => feature.material !== undefined).map(feature => [feature.featureId, feature.material]),
    [["feature:wake:hearth", "stone"], ["feature:wake:joined-tables", "wood"], ["feature:wake:ledger-counter", "wood"],
      ["feature:wake:stairs", "wood"], ["feature:wake:wet-floor", "mud"]]);

  // Someone arriving at the first spawn point, beside the cellar door, still
  // reaches every other spawn point, the steps, the hidden passage and the
  // strips behind the wall and the ditch -- round their south ends, since
  // nobody walks across the ditch.
  const f = createAuthoredProbeFixture("terrain:yard", { additionalScenes: [{ id: "yard", name: "后院", geometry: yard }],
    characterScenes: { [ACTOR]: "yard" } });
  assert.deepEqual(f.state.combatRuntime.entities[ACTOR].position, yard.spawnPoints[0]);
  const walk = position => planSceneApproach(f.state, ACTOR, "yard", { kind: "point", position });
  for (const place of [...yard.spawnPoints.slice(1), point("300", "210"), point("420", "210"), point("480", "-240"), point("-480", "-240")]) {
    assert.equal(walk(place).kind, "move", JSON.stringify(place));
  }
  const body = f.state.combatRuntime.entities[ACTOR];
  assert.equal(analyzeCombatMovement({ ...body, position: point("-300", "-240") }, [], f.state.combatRuntime.scenes.yard,
    [point("-300", "-240"), point("-480", "-240")], new Set()).ok, false);
  // ...or jumped, with a run-up, from beside it.
  const jump = planJumpTakeoff(f.state, ACTOR, "feature:yard:drainage-ditch");
  assert.equal(jump.kind, "accepted", JSON.stringify(jump));
  assert.deepEqual([jump.jump.running, jump.jump.impassable, BigInt(jump.jump.to.x) <= -450n], [true, false, true]);
});
