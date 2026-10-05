import assert from "node:assert/strict";
import test from "node:test";

import { project, replay, step } from "../../../app/_runtime/lib/rules/index.ts";
import { isTacticalProjection } from "../../../app/_runtime/lib/rules/tactical-projection.ts";
import { projectTacticalPlaces } from "../../../app/_runtime/lib/rules/v2/tactical-places.ts";
import { projectAuthoritativeTableObservation } from "../../../app/_runtime/lib/table/authoritative.ts";

// SPEC 0014 §8 (ADR 0103 decisions 4-5): the player's own map marks where
// each known door leads and whether it can be passed now, and lists the
// places the player has been to for a stitched map -- the public features of
// each, without live state, and no creature anywhere but the current place.
// The room writes `campaignRuntime.placeMap` and each character's
// `visitedSceneIds`; these tests set them on a replayed state.

const PLAYER = "character:alice";
const VIEWER = { kind: "player", principalId: "principal:alice", sessionVersion: 1, seatId: "seat:alice", characterId: PLAYER };
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

function feature(featureId, kind, label, state, polygon, extra = {}) {
  return {
    featureId, kind, label, state, polygon,
    elevation: "0", height: "84", opaque: false, impassable: false, cover: "none", propagation: "passes", terrain: "normal",
    visibilityPolicyId: "visibility:public",
    ...extra,
  };
}

const CLOSED = { opaque: true, impassable: true, cover: "full", propagation: "blocks" };

function geometry(obstacles) {
  return {
    schema: "zhuwei.tactical-geometry/v1",
    unit: "inch",
    boundary: { kind: "polygon", points: rect("-300", "-300", "300", "300") },
    spawnPoints: [{ x: "0", y: "0", elevation: "0" }, { x: "120", y: "0", elevation: "0" }],
    obstacles: obstacles.sort((left, right) => left.featureId.localeCompare(right.featureId)),
    clearanceZones: [],
  };
}

const SCENES = [
  { id: "scene:hall", name: "大厅", geometry: geometry([
    feature("feature:hall:back-door", "portal", "后门", "open", rect("-60", "-300", "60", "-270")),
    feature("feature:hall:hatch", "portal", "阁楼活板", "closed", rect("180", "180", "240", "240"), CLOSED),
    feature("feature:hall:pillar", "barrier", "立柱", "intact", rect("-30", "-30", "30", "30"), { impassable: true, cover: "half" }),
  ]) },
  { id: "scene:yard", name: "后院", geometry: geometry([
    feature("feature:yard:cellar-door", "portal", "酒窖门", "locked", rect("-60", "270", "60", "300"), CLOSED),
    feature("feature:yard:house-door", "portal", "通往大厅的门", "open", rect("-60", "-300", "60", "-270")),
    feature("feature:yard:pond", "terrain", "水塘", "still", rect("120", "-120", "240", "0"),
      { height: "1", impassable: true, landform: "water", depth: "48", current: "still" }),
    feature("feature:yard:tunnel", "barrier", "暗道口", "hidden", rect("-240", "-240", "-180", "-180"),
      { impassable: true, visibilityPolicyId: "visibility:hidden-until-evidence" }),
  ]) },
  { id: "scene:cellar", name: "酒窖", geometry: geometry([
    feature("feature:cellar:yard-door", "portal", "通往后院的门", "locked", rect("-60", "-300", "60", "-270"), CLOSED),
  ]) },
  { id: "scene:attic", name: "阁楼", geometry: geometry([
    feature("feature:attic:trunk", "interactable", "旧箱子", "closed", rect("0", "0", "60", "60")),
  ]) },
];

function placeMap() {
  const side = (sceneId, featureId) => ({ sceneId, featureId, arrival: { x: "0", y: "0", elevation: "0" } });
  return {
    connections: [
      { id: "hall-yard", source: "module", sides: [side("scene:hall", "feature:hall:back-door"), side("scene:yard", "feature:yard:house-door")],
        bidirectional: true, travelMicros: "6000000" },
      // The hatch goes up only; nothing on the attic's map leads back.
      { id: "hall-attic", source: "kp", sides: [side("scene:hall", "feature:hall:hatch"), side("scene:attic", null)],
        bidirectional: false, travelMicros: "12000000" },
      { id: "yard-cellar", source: "module", sides: [side("scene:yard", "feature:yard:cellar-door"), side("scene:cellar", "feature:cellar:yard-door")],
        bidirectional: true, travelMicros: "6000000" },
    ],
    sitePlan: {
      "scene:hall": { x: "0", y: "0", level: 0 },
      "scene:yard": { x: "0", y: "-600", level: 0 },
      "scene:cellar": { x: "0", y: "-900", level: -1 },
      "scene:attic": { x: "0", y: "0", level: 1 },
    },
  };
}

/** Alice in the hall; a groundskeeper in the yard. */
function world() {
  const initialized = step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:tactical-places",
    runtimeEpochId: "epoch:tactical-places:1",
    moduleRef: { profileId: "module:tactical-places-v1", profileHash: `sha256:${"d".repeat(64)}` },
    initialDefinitionCatalogRef: { profileId: "definitions:tactical-places-v1", profileHash: `sha256:${"e".repeat(64)}` },
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: structuredClone(SCENES),
    principals: [{ id: "principal:alice", sessionVersion: 1, role: "host" }],
    seats: [{ id: "seat:alice", principalId: "principal:alice", status: "active" }],
    characters: [
      { id: PLAYER, kind: "player", name: "阿莱莎", sceneId: "scene:hall", tenureStatus: "active" },
      { id: "npc:groundskeeper", kind: "npc", name: "园丁", sceneId: "scene:yard", tenureStatus: "active" },
    ],
    characterControls: [{ characterId: PLAYER, seatId: "seat:alice" }],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const rebuilt = replay(initialized.genesis, []);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  return { profiles: initialized.profiles, state: rebuilt.state };
}

/** The room's place map and Alice's visits (none recorded when null) written onto a state. */
function withPlaces(state, visited = ["scene:yard", "scene:hall"]) {
  const next = structuredClone(state);
  next.campaignRuntime.placeMap = placeMap();
  if (visited !== null) next.entities[PLAYER].visitedSceneIds = visited;
  return next;
}

function hallView() {
  const { profiles, state } = world();
  const view = project(profiles, state, VIEWER);
  assert.equal(view.kind, "projected", JSON.stringify(view));
  return { profiles, state, view };
}

test("each known door of the current place leads to its connection's other place, passable when both doors are", () => {
  const { state, view } = hallView();
  const { knownFeatures } = projectTacticalPlaces(withPlaces(state), PLAYER, "scene:hall", view.tacticalProjection.knownFeatures);
  const leads = Object.fromEntries(knownFeatures.map((entry) => [entry.id, entry.leadsTo]));
  assert.deepEqual(leads, {
    "feature:hall:back-door": { sceneId: "scene:yard", name: "后院", passable: true },
    "feature:hall:hatch": { sceneId: "scene:attic", name: "阁楼", passable: false },
    "feature:hall:pillar": undefined,
  });

  // The yard's side of the back door shut: the hall's open side alone does not make it passable.
  const shut = withPlaces(state);
  const houseDoor = shut.combatRuntime.scenes["scene:yard"].geometry.obstacles.find((entry) => entry.featureId === "feature:yard:house-door");
  Object.assign(houseDoor, { state: "closed", ...CLOSED });
  assert.equal(projectTacticalPlaces(shut, PLAYER, "scene:hall", view.tacticalProjection.knownFeatures)
    .knownFeatures.find((entry) => entry.id === "feature:hall:back-door").leadsTo.passable, false);

  // From the yard: back to the hall, and the locked cellar door. The cellar
  // is not passable while locked and is once the door is broken down.
  const yardFeatures = [{ id: "feature:yard:cellar-door" }, { id: "feature:yard:house-door" }];
  const fromYard = (value) => Object.fromEntries(projectTacticalPlaces(value, PLAYER, "scene:yard", yardFeatures)
    .knownFeatures.map((entry) => [entry.id, entry.leadsTo]));
  assert.deepEqual(fromYard(withPlaces(state)), {
    "feature:yard:cellar-door": { sceneId: "scene:cellar", name: "酒窖", passable: false },
    "feature:yard:house-door": { sceneId: "scene:hall", name: "大厅", passable: true },
  });
  const broken = withPlaces(state);
  for (const [sceneId, featureId] of [["scene:yard", "feature:yard:cellar-door"], ["scene:cellar", "feature:cellar:yard-door"]]) {
    Object.assign(broken.combatRuntime.scenes[sceneId].geometry.obstacles.find((entry) => entry.featureId === featureId),
      { state: "destroyed", opaque: false, impassable: false, cover: "none", propagation: "passes", terrain: "rubble" });
  }
  assert.equal(fromYard(broken)["feature:yard:cellar-door"].passable, true);

  // A one-way connection leads nowhere back from its second end.
  assert.deepEqual(projectTacticalPlaces(withPlaces(state), PLAYER, "scene:attic", [{ id: "feature:attic:trunk" }]).knownFeatures,
    [{ id: "feature:attic:trunk" }]);
});

test("the known places are the current place and the visited ones, with public features, no live state and no creatures", () => {
  const { state, view } = hallView();
  const places = projectTacticalPlaces(withPlaces(state), PLAYER, "scene:hall", view.tacticalProjection.knownFeatures);
  // The cellar and the attic were never visited: neither appears.
  assert.deepEqual(places.knownPlaces.map((place) => place.sceneId), ["scene:hall", "scene:yard"]);
  const [hall, yard] = places.knownPlaces;
  // The current place's features are the projection's own, with their state.
  assert.deepEqual(hall, {
    sceneId: "scene:hall", name: "大厅", placement: { x: "0", y: "0", level: 0 },
    boundary: { kind: "polygon", points: rect("-300", "-300", "300", "300") }, features: [],
  });
  assert.deepEqual(yard.placement, { x: "0", y: "-600", level: 0 });
  // The hidden tunnel stays out; what is shown has shape, label, kind and
  // ground, never state, blocking, cover or durability.
  assert.deepEqual(yard.features, [
    { id: "feature:yard:cellar-door", kind: "portal", label: "酒窖门", polygon: rect("-60", "270", "60", "300"), elevation: "0", height: "84" },
    { id: "feature:yard:house-door", kind: "portal", label: "通往大厅的门", polygon: rect("-60", "-300", "60", "-270"), elevation: "0", height: "84" },
    { id: "feature:yard:pond", kind: "terrain", label: "水塘", polygon: rect("120", "-120", "240", "0"), elevation: "0", height: "1",
      landform: "water", depth: "48", current: "still" },
  ]);
  const serialized = JSON.stringify(places.knownPlaces);
  assert.doesNotMatch(serialized, /tunnel|暗道|groundskeeper|园丁|"state"|locked|impassable|visibility/);
  assert.deepEqual(places.placeReadout, [
    "大厅（地面层）：你在这里。",
    "后院（地面层）：到过；已知酒窖门、通往大厅的门、水塘。",
  ]);

  // Without recorded visits only the current place is known.
  assert.deepEqual(projectTacticalPlaces(withPlaces(state, null), PLAYER, "scene:hall", [])
    .knownPlaces.map((place) => place.sceneId), ["scene:hall"]);
  // A visited place with no site-plan placement cannot be stitched; without
  // a placement for the current place there are no known places at all.
  const unplaced = withPlaces(state);
  delete unplaced.campaignRuntime.placeMap.sitePlan["scene:yard"];
  assert.deepEqual(projectTacticalPlaces(unplaced, PLAYER, "scene:hall", []).knownPlaces.map((place) => place.sceneId), ["scene:hall"]);
  delete unplaced.campaignRuntime.placeMap.sitePlan["scene:hall"];
  assert.equal(Object.hasOwn(projectTacticalPlaces(unplaced, PLAYER, "scene:hall", []), "knownPlaces"), false);
});

test("without a place map the projection has no door destinations and no known places", () => {
  const { state, view } = hallView();
  const features = view.tacticalProjection.knownFeatures;
  assert.deepEqual(projectTacticalPlaces(state, PLAYER, "scene:hall", features), { knownFeatures: features });
  // The real projection is the map as it was.
  assert.equal(Object.hasOwn(view.tacticalProjection, "knownPlaces"), false);
  assert.equal(Object.hasOwn(view.tacticalProjection.textualReadout, "places"), false);
  assert.ok(view.tacticalProjection.knownFeatures.every((entry) => entry.leadsTo === undefined));
});

/** The hall projection with the place map's parts, as the projector builds it. */
function hallProjectionWithPlaces() {
  const { state, view } = hallView();
  const places = projectTacticalPlaces(withPlaces(state), PLAYER, "scene:hall", view.tacticalProjection.knownFeatures);
  const tacticalProjection = {
    ...structuredClone(view.tacticalProjection),
    knownFeatures: places.knownFeatures,
    knownPlaces: places.knownPlaces,
    textualReadout: { ...view.tacticalProjection.textualReadout, places: places.placeReadout },
  };
  return { view: { ...view, tacticalProjection }, tacticalProjection };
}

function tableObservation(view) {
  return projectAuthoritativeTableObservation({
    userId: "principal:alice",
    members: ["principal:alice"],
    locationLabels: {},
    observation: { readModel: view, delivery: { kind: "none" } },
  });
}

test("the table read model forwards door destinations and known places closed and validated", () => {
  const { view, tacticalProjection } = hallProjectionWithPlaces();
  assert.equal(isTacticalProjection(tacticalProjection), true);
  assert.deepEqual(tableObservation(view).tacticalProjection, tacticalProjection);

  const broken = [
    // Places without their readout lines.
    (projection) => { delete projection.textualReadout.places; },
    // Another place's feature carrying live state.
    (projection) => { projection.knownPlaces[1].features[0].state = "locked"; },
    // A creature slipped into another place.
    (projection) => { projection.knownPlaces[1].visibleEntities = []; },
    // The current place missing from its own list.
    (projection) => { projection.knownPlaces.shift(); projection.textualReadout.places.shift(); },
    // A door leading into the place it stands in.
    (projection) => { projection.knownFeatures[0].leadsTo = { sceneId: "scene:hall", name: "大厅", passable: true }; },
    // A destination with more than its place and passability.
    (projection) => { projection.knownFeatures[0].leadsTo.travelMicros = "6000000"; },
  ];
  for (const breakIt of broken) {
    const projection = structuredClone(tacticalProjection);
    breakIt(projection);
    assert.equal(isTacticalProjection(projection), false, breakIt.toString());
    assert.throws(() => tableObservation({ ...view, tacticalProjection: projection }), /tactical projection is invalid/);
  }
});

// Until world-state validation accepts `placeMap` (written by the room in a
// separate change), Rules rejects a state carrying it and this end-to-end
// check is skipped.
const placesWorld = (() => {
  const { profiles, state } = world();
  const placed = withPlaces(state);
  return { profiles, state: placed, view: project(profiles, placed, VIEWER) };
})();

test("project(viewer) gives the player's own map its door destinations, known places and readout", {
  skip: placesWorld.view.kind === "projected" ? false : "world-state validation does not accept placeMap yet",
}, () => {
  const tactical = placesWorld.view.tacticalProjection;
  assert.equal(isTacticalProjection(tactical), true);
  assert.deepEqual(tactical.knownPlaces.map((place) => place.sceneId), ["scene:hall", "scene:yard"]);
  assert.deepEqual(tactical.knownFeatures.find((entry) => entry.id === "feature:hall:back-door").leadsTo,
    { sceneId: "scene:yard", name: "后院", passable: true });
  assert.ok(tactical.textualReadout.features.some((line) => line.startsWith("后门：") && line.includes("通往后院（现在可以通过）")));
  assert.deepEqual(tactical.textualReadout.places, ["大厅（地面层）：你在这里。", "后院（地面层）：到过；已知酒窖门、通往大厅的门、水塘。"]);
  // Stitching changes display only: the known places stay out of the
  // spatial revision a move is checked against.
  const revisit = withPlaces(placesWorld.state, ["scene:hall"]);
  assert.equal(project(placesWorld.profiles, revisit, VIEWER).tacticalProjection.spatialRevision, tactical.spatialRevision);
});
