import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  playTableSnapFixture,
  tacticalProjectionFixture,
} from "../../support/fixtures/tactical-map-v2.mjs";

test("TacticalMap renders only the public projection as a readable two-dimensional map", async () => {
  const [{ TacticalMap }, { isTacticalProjection }] = await Promise.all([
    import("../../../app/_runtime/components/tactical-map.tsx"),
    import("../../../app/_runtime/lib/rules/tactical-projection.ts"),
  ]);
  const projection = tacticalProjectionFixture();
  assert.equal(isTacticalProjection(projection), true, "the DOM fixture must be a valid public projection");
  const html = renderToStaticMarkup(createElement(TacticalMap, {
    projection,
    defaultExpanded: true,
  }));

  assert.match(html, /data-tactical-map-disclosure="ready"/);
  assert.match(html, /data-tactical-disclosure-trigger="desktop" aria-expanded="true"/);
  assert.match(html, /data-tactical-disclosure-trigger="mobile" aria-expanded="false"/);
  assert.match(html, /data-tactical-map="v1" data-tactical-layout="desktop-inline" data-tactical-view="map"/);
  assert.match(html, /data-tactical-canvas="v1"/);
  assert.match(html, /data-tactical-detail="v1"/);
  assert.match(html, /data-tactical-view-trigger="map" aria-selected="true"/);
  assert.match(html, /data-tactical-view-trigger="text" aria-selected="false"/);
  assert.match(html, /aria-label="钟楼庭院战术地图"/);
  assert.match(html, /viewBox="0 0 1200 900"/);
  assert.match(
    html,
    /<svg[^>]*width="1200"[^>]*height="900"/,
    "the SVG needs an intrinsic aspect ratio so its overflow-hidden frame cannot collapse",
  );
  assert.match(html, /data-grid-inches="60"/);
  assert.match(html, /data-scene-boundary="scene:bell-yard"/);

  assert.match(html, /data-entity-id="character:alice"/);
  assert.match(html, /focus-visible:outline-2/);
  assert.match(html, /data-entity-id="character:alice"[^>]*data-map-label="我"/);
  assert.match(html, /data-relation="self"/);
  assert.match(html, /data-current-actor="true"/);
  assert.match(html, /data-position-x="120"/);
  assert.match(html, /data-position-y="180"/);
  assert.match(html, /data-footprint-width="60"/);
  assert.match(html, /data-footprint-depth="60"/);
  assert.match(html, /data-elevation-inches="60"/);
  assert.match(html, /data-height-inches="66"/);
  assert.match(
    html,
    /data-entity-id="character:alice"[^>]*>.*?<rect x="90" y="150" width="60" height="60"/,
    "the projected x/y is the footprint center, not the rectangle's top-left corner",
  );
  assert.match(html, /阿莱莎/);
  assert.match(html, /data-entity-id="npc:warden"/);
  assert.match(html, /data-entity-id="npc:warden"[^>]*data-map-label="守夜"/);
  assert.match(html, /data-relation="enemy"/);
  assert.match(html, /data-position-x="720"/);
  assert.match(html, /data-position-y="180"/);
  assert.match(
    html,
    /data-entity-id="npc:warden"[^>]*>.*?<rect x="689\.5" y="150\.5" width="61" height="59"/,
    "odd positive footprint sizes may use display-only half-inch SVG coordinates without rounding authority",
  );
  assert.match(html, /守夜人/);
  assert.match(html, /第 1 轮 · 轮到你/);
  assert.match(html, /\+5 尺/);
  assert.match(html, /data-elevation-label="true"[^>]*>\+5 尺<\/text>/);
  assert.match(html, /高度 5 尺 6 英寸/);

  for (const kind of ["barrier", "destructible", "interactable", "portal", "terrain"]) {
    assert.match(html, new RegExp(`data-feature-kind="${kind}"`));
  }
  assert.match(html, /data-feature-id="feature:barrier"/);
  assert.match(html, /data-impassable="true"/);
  assert.match(html, /data-opaque="true"/);
  assert.match(html, /data-cover="full"/);
  assert.match(html, /data-propagation="blocks"/);
  assert.match(html, /data-terrain="rubble"/);
  assert.match(html, /data-movement-encoding="solid"/);
  assert.match(html, /data-movement-encoding="dashed"/);
  assert.match(html, /data-vision-encoding="diagonal-hatch"/);
  assert.match(html, /data-propagation-encoding="dot-hatch"/);
  assert.match(html, /data-cover-encoding="half"/);
  assert.match(html, /阻挡移动/);
  assert.match(html, /阻挡视线/);
  assert.match(html, /全掩护/);
  assert.match(html, /阻断区域传播/);
  assert.match(html, /瓦砾地形/);
  assert.match(html, /实线边阻挡移动；虚线边可通过/);
  assert.match(html, /斜纹阻挡视线；点纹阻断区域传播/);
  assert.match(html, /data-zone-id="zone:fog-cloud"/);
  assert.match(html, /data-zone-state="active"/);
  assert.match(html, /庭院浓雾/);
  assert.match(html, /庭院浓雾；状态 生效中/);
  assert.match(html, /关闭的庭院铁门；状态 关闭/);
  assert.match(html, /data-tactical-selected="entity:character:alice"/);
  assert.match(html, />正常</);
  // SPEC 0014 §8 (ADR 0091): without table actions the map only shows the
  // projection; interaction is no longer marked as deferred.
  assert.match(html, /data-tactical-interactions="view-only"/);
  assert.doesNotMatch(html, /data-tactical-interactions="deferred"|后续支持/);
  assert.doesNotMatch(html, /data-tactical-actions=/);
  assert.doesNotMatch(html, /data-tactical-readout="v1"/);

  const unevenProjection = tacticalProjectionFixture();
  unevenProjection.self.position.elevation = "65";
  unevenProjection.visibleEntities[0].position.elevation = "-13";
  const unevenElevationHtml = renderToStaticMarkup(createElement(TacticalMap, {
    projection: unevenProjection,
    defaultExpanded: true,
  }));
  assert.match(unevenElevationHtml, />\+5 尺 5 寸<\/text>/);
  assert.match(unevenElevationHtml, />−1 尺 1 寸<\/text>/);

  // SRD Dodge is a public condition the map names in plain words.
  const dodging = tacticalProjectionFixture();
  dodging.self.publicStates = ["condition:dodging", "life:alive"];
  const dodgingHtml = renderToStaticMarkup(createElement(TacticalMap, {
    projection: dodging,
    defaultExpanded: true,
  }));
  assert.match(dodgingHtml, /闪避、正常/);
});

// SPEC 0014 §4 (ADR 0098): the map draws each landform as its own ground,
// and a token in a ditch or water, or on a top, shows how far below or above
// the ground beside it it stands.
test("TacticalMap draws ditches, water, walls, steps and cliffs apart and labels heights from the ground beside them", async () => {
  const [{ TacticalMap }, { isTacticalProjection }] = await Promise.all([
    import("../../../app/_runtime/components/tactical-map.tsx"),
    import("../../../app/_runtime/lib/rules/tactical-projection.ts"),
  ]);
  const projection = tacticalProjectionFixture();
  const rectangle = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const ground = { state: "intact", opaque: false, impassable: true, cover: "none", propagation: "passes", terrain: "normal", elevation: "0" };
  projection.knownFeatures.push(
    { ...ground, id: "feature:ditch", kind: "terrain", label: "排水沟", state: "muddy", polygon: rectangle("690", "120", "750", "240"),
      height: "1", landform: "ditch", depth: "36", material: "mud" },
    { ...ground, id: "feature:low-wall", kind: "barrier", label: "矮石墙", polygon: rectangle("90", "150", "150", "210"),
      elevation: "24", height: "36", cover: "half", landform: "lowWall", material: "stone" },
    { ...ground, id: "feature:pond", kind: "terrain", label: "水塘", state: "still", polygon: rectangle("900", "600", "1020", "720"),
      height: "1", landform: "water", depth: "48", current: "still" },
    { ...ground, id: "feature:steps", kind: "terrain", label: "台阶", polygon: rectangle("60", "600", "180", "720"),
      height: "18", landform: "step", material: "stone" },
    { ...ground, id: "feature:cliff", kind: "barrier", label: "崖壁", polygon: rectangle("300", "600", "420", "720"),
      height: "300", opaque: true, cover: "full", landform: "cliff", material: "stone" },
  );
  projection.knownFeatures.sort((left, right) => left.id.localeCompare(right.id));
  // The warden stands on the ditch's bottom, 3 feet down; Alice on the wall,
  // whose foot is 2 feet up, 3 feet above it.
  projection.visibleEntities[0].position.elevation = "-36";
  projection.self.position.elevation = "60";
  assert.equal(isTacticalProjection(projection), true);
  const html = renderToStaticMarkup(createElement(TacticalMap, { projection, defaultExpanded: true }));
  assert.match(html, /data-entity-id="npc:warden".*?data-elevation-label="true"[^>]*>−3 尺<\/text>/);
  assert.match(html, /data-entity-id="character:alice".*?data-elevation-label="true"[^>]*>\+3 尺<\/text>/);
  for (const landform of ["ditch", "lowWall", "water", "step", "cliff"]) {
    assert.match(html, new RegExp(`data-landform="${landform}"`));
    assert.match(html, new RegExp(`data-landform-encoding="${landform}"`));
    assert.match(html, new RegExp(`data-landform-pattern="${landform}"`));
  }
  const ditchClass = /data-feature-id="feature:ditch"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";
  const pondClass = /data-feature-id="feature:pond"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";
  assert.notEqual(ditchClass.split(" ")[0], pondClass.split(" ")[0], "a ditch and water are filled differently");
  // The card keeps the terrain phrases.
  assert.match(html, /排水沟；状态 muddy；[^<]*沟；深 36 英寸；泥质/);
  // Off the terrain a token keeps its own elevation.
  const flying = tacticalProjectionFixture();
  assert.match(renderToStaticMarkup(createElement(TacticalMap, { projection: flying, defaultExpanded: true })),
    /data-entity-id="character:alice".*?data-elevation-label="true"[^>]*>\+5 尺<\/text>/);
});

// SPEC 0014 §8: the ground lies under the objects on it and the walls and
// doors above both, a smaller shape over a larger one in the same layer;
// zones over the features, then the creatures, then the names and cover
// marks, so none of them hides under a larger shape or a token.
test("TacticalMap lays ground, objects and walls in order, with names and cover marks above the tokens", async () => {
  const { TacticalMap } = await import("../../../app/_runtime/components/tactical-map.tsx");
  const projection = tacticalProjectionFixture();
  const rectangle = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const base = { state: "intact", elevation: "0", height: "36", opaque: false, impassable: false, cover: "none", propagation: "passes", terrain: "normal" };
  projection.knownFeatures = [
    // In id order the lever would come first and the yard's mud over it.
    { ...base, id: "feature:a-lever", kind: "interactable", label: "警铃拉杆", polygon: rectangle("540", "540", "570", "570"), material: "metal" },
    { ...base, id: "feature:b-wall", kind: "barrier", label: "钟楼石墙", polygon: rectangle("300", "60", "312", "660"),
      height: "120", opaque: true, impassable: true, cover: "full", propagation: "blocks", material: "stone" },
    { ...base, id: "feature:c-crate", kind: "destructible", label: "木箱", polygon: rectangle("600", "300", "660", "360"), impassable: true, cover: "half" },
    { ...base, id: "feature:d-mud", kind: "terrain", label: "后院泥泞", polygon: rectangle("420", "420", "900", "780"), material: "mud" },
    { ...base, id: "feature:e-gate", kind: "portal", label: "庭院铁门", state: "locked", polygon: rectangle("660", "60", "840", "72"),
      height: "120", opaque: true, impassable: true, cover: "full", propagation: "blocks", material: "metal" },
  ];
  const html = renderToStaticMarkup(createElement(TacticalMap, { projection, defaultExpanded: true }));
  const at = (pattern) => {
    const index = html.search(pattern);
    assert.notEqual(index, -1, `${pattern} must be drawn`);
    return index;
  };
  // The crate is larger than the lever, so it lies under it; the wall
  // covers more ground than the gate.
  const order = ["feature:d-mud", "feature:c-crate", "feature:a-lever", "feature:b-wall", "feature:e-gate"]
    .map((id) => at(new RegExp(`data-feature-id="${id}"`)));
  assert.deepEqual([...order].sort((left, right) => left - right), order, "ground, then objects, then walls and doors");
  assert.ok(at(/data-feature-id="feature:e-gate"/) < at(/data-zone-id="zone:fog-cloud"/), "zones lie over the features");
  assert.ok(at(/data-zone-id="zone:fog-cloud"/) < at(/data-entity-id="character:alice"/), "creatures stand over zones");
  const annotations = at(/data-tactical-annotations/);
  assert.ok(at(/data-entity-id="npc:warden"/) < annotations, "names and cover marks come after the tokens");
  assert.ok(at(/data-cover-encoding="full"/) > annotations);
  assert.ok(at(/data-feature-caption="feature:a-lever"/) > annotations);
  // Each kind is drawn as what it is: a stone wall coursed, a metal gate
  // barred with a bolt across while locked, mud rippled, a crate braced.
  assert.match(html, /data-feature-id="feature:b-wall"[^>]*data-feature-layer="structure"/);
  assert.match(html, /data-feature-id="feature:d-mud"[^>]*data-feature-layer="ground"/);
  assert.match(html, /data-feature-id="feature:a-lever"[^>]*data-feature-layer="object"/);
  for (const texture of ["masonry", "bars", "mud"]) assert.match(html, new RegExp(`data-texture-encoding="${texture}"`));
  assert.match(html, /data-feature-fitting="bolt"/);
  assert.match(html, /data-feature-fitting="brace"/);
  // The lever is drawn at its own 2.5-foot size, not a whole cell.
  assert.match(html, /data-feature-id="feature:a-lever"[^>]*>(?:(?!<\/g>).)*?points="540,540 570,540 570,570 540,570"/);
});

test("TacticalMap is collapsible and keeps unavailable projections compact", async () => {
  const { TacticalMap } = await import("../../../app/_runtime/components/tactical-map.tsx");
  const projection = tacticalProjectionFixture();
  projection.encounter = null;
  const collapsed = renderToStaticMarkup(createElement(TacticalMap, {
    projection,
    defaultExpanded: false,
  }));
  assert.match(collapsed, /data-tactical-map-disclosure="ready"/);
  assert.match(collapsed, /data-tactical-disclosure-trigger="desktop" aria-expanded="false"/);
  assert.match(collapsed, /data-tactical-disclosure-trigger="mobile" aria-expanded="false"/);
  const collapsedControls = collapsed.match(
    /data-tactical-disclosure-trigger="desktop"[^>]*aria-controls="([^"]+)"/,
  )?.[1];
  assert.ok(collapsedControls, "the disclosure button must name its controlled region");
  assert.ok(
    new RegExp(`<div id="${collapsedControls}" hidden=""[^>]*></div>`).test(collapsed),
    "the collapsed controlled region must remain in the DOM and be hidden",
  );
  assert.doesNotMatch(collapsed, /data-tactical-map="v1"/);
  assert.doesNotMatch(collapsed, /data-tactical-readout="v1"/);

  const absent = renderToStaticMarkup(createElement(TacticalMap, {
    projection: null,
    defaultExpanded: true,
  }));
  assert.match(absent, /data-tactical-map-disclosure="unknown"/);
  assert.match(absent, /data-tactical-disclosure-trigger="desktop" aria-expanded="false"/);
  assert.match(absent, /data-tactical-disclosure-trigger="mobile" aria-expanded="false"/);
  const absentControls = absent.match(
    /data-tactical-disclosure-trigger="desktop"[^>]*aria-controls="([^"]+)"/,
  )?.[1];
  assert.ok(absentControls, "the unavailable status must still name its compact region");
  assert.ok(
    new RegExp(`<div id="${absentControls}" hidden=""[^>]*></div>`).test(absent),
    "the unavailable controlled region must remain valid without mounting map content",
  );
  assert.doesNotMatch(absent, /data-tactical-map="unknown"/);
  assert.match(absent, /尚无观察者可见的战术地图数据/);
  assert.doesNotMatch(absent, /data-tactical-readout="v1"/);

  const emptyProjection = tacticalProjectionFixture();
  emptyProjection.knownFeatures = [];
  emptyProjection.knownZones = [];
  emptyProjection.encounter = null;
  emptyProjection.textualReadout.features = [];
  const empty = renderToStaticMarkup(createElement(TacticalMap, {
    projection: emptyProjection,
    defaultExpanded: true,
  }));
  assert.match(empty, /暂未发现可查看的环境/);
  assert.match(empty, /暂无区域效果/);
  assert.match(empty, /当前遭遇信息未知/);
});

test("project(viewer) supplies a viewer-visible centre-line distance for the map readout", async () => {
  const { project, replay, step } = await import("../../../app/_runtime/lib/rules/index.ts");
  const initialized = step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:tactical-map-distance",
    runtimeEpochId: "epoch:tactical-map-distance:1",
    moduleRef: {
      profileId: "module:tactical-map-distance-v1",
      profileHash: `sha256:${"d".repeat(64)}`,
    },
    initialDefinitionCatalogRef: {
      profileId: "definitions:tactical-map-distance-v1",
      profileHash: `sha256:${"e".repeat(64)}`,
    },
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{
      id: "scene:yard",
      name: "庭院",
      geometry: {
        schema: "zhuwei.tactical-geometry/v1",
        unit: "inch",
        boundary: {
          kind: "polygon",
          points: [
            { x: "0", y: "0" },
            { x: "900", y: "0" },
            { x: "900", y: "600" },
            { x: "0", y: "600" },
          ],
        },
        spawnPoints: [
          { x: "120", y: "180", elevation: "0" },
          { x: "720", y: "180", elevation: "0" },
        ],
        obstacles: [{
          featureId: "feature:yard-wall",
          kind: "barrier",
          label: "庭院矮墙",
          state: "intact",
          polygon: [
            { x: "300", y: "300" },
            { x: "360", y: "300" },
            { x: "360", y: "420" },
            { x: "300", y: "420" },
          ],
          elevation: "0",
          height: "60",
          opaque: false,
          impassable: true,
          cover: "half",
          propagation: "passes",
          terrain: "normal",
          visibilityPolicyId: "visibility:scene-observers",
        }],
        clearanceZones: [],
      },
    }],
    principals: [{ id: "principal:alice", sessionVersion: 1, role: "host" }],
    seats: [{ id: "seat:alice", principalId: "principal:alice", status: "active" }],
    characters: [
      {
        id: "character:alice",
        kind: "player",
        name: "阿莱莎",
        sceneId: "scene:yard",
        tenureStatus: "active",
      },
      {
        id: "npc:warden",
        kind: "npc",
        name: "守夜人",
        sceneId: "scene:yard",
        tenureStatus: "active",
      },
    ],
    characterControls: [{ characterId: "character:alice", seatId: "seat:alice" }],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const rebuilt = replay(initialized.genesis, []);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  const readModel = project(initialized.profiles, rebuilt.state, {
    kind: "player",
    principalId: "principal:alice",
    sessionVersion: 1,
    seatId: "seat:alice",
    characterId: "character:alice",
  });

  assert.deepEqual(readModel.tacticalProjection.textualReadout.entities, [
    "守夜人与我中心直线约距 50 尺；位置 (720, 180)，高程 0 英寸，实体高度 60 英寸。",
  ]);
});

test("PlayTable renders the authoritative tactical projection through TacticalMap", async () => {
  const [{ QueryClient, QueryClientProvider }, { compileSheet }, { PlayTable }] =
    await Promise.all([
      import("@tanstack/react-query"),
      import("../../../app/_runtime/lib/dnd/compute.ts"),
      import("../../../app/_runtime/components/play-table.tsx"),
    ]);
  const snap = playTableSnapFixture(compileSheet);
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(PlayTable, { code: "TACTIC", snap }),
    ),
  );

  assert.match(html, /data-tactical-map="v1"/);
  assert.match(html, /data-tactical-disclosure-trigger="desktop" aria-expanded="true"/);
  assert.match(html, /data-tactical-disclosure-trigger="mobile" aria-expanded="false"/);
  assert.match(html, /data-scene-boundary="scene:bell-yard"/);
  assert.match(html, /data-tactical-selected="entity:character:alice"/);
  assert.doesNotMatch(html, /data-tactical-readout="v1"/);

  const explorationSnap = structuredClone(snap);
  explorationSnap.state.authoritative.inCombat = false;
  explorationSnap.state.authoritative.tacticalProjection.encounter = null;
  const explorationHtml = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(PlayTable, { code: "TACTIC", snap: explorationSnap }),
    ),
  );
  assert.match(explorationHtml, /data-tactical-map-disclosure="ready"/);
  assert.match(explorationHtml, /data-tactical-disclosure-trigger="desktop" aria-expanded="false"/);
  assert.match(explorationHtml, /data-tactical-disclosure-trigger="mobile" aria-expanded="false"/);
  assert.doesNotMatch(explorationHtml, /data-tactical-map="v1"/);
  assert.doesNotMatch(explorationHtml, /data-tactical-readout="v1"/);

  const unknownSnap = structuredClone(snap);
  delete unknownSnap.state.authoritative.tacticalProjection;
  const unknownHtml = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(PlayTable, { code: "TACTIC", snap: unknownSnap }),
    ),
  );
  assert.match(unknownHtml, /data-tactical-map-disclosure="unknown"/);
  assert.match(unknownHtml, /data-tactical-disclosure-trigger="desktop" aria-expanded="false"/);
  assert.match(unknownHtml, /data-tactical-disclosure-trigger="mobile" aria-expanded="false"/);
  assert.doesNotMatch(unknownHtml, /data-tactical-map="unknown"/);
  assert.match(unknownHtml, /尚无观察者可见的战术地图数据/);
  assert.match(unknownHtml, /你做什么、说什么/);
});
