import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  playTableSnapFixture,
  tacticalProjectionFixture,
} from "./fixtures/tactical-map-v2.mjs";

test("TacticalMap renders only the public projection as a readable two-dimensional map", async () => {
  const [{ TacticalMap }, { isTacticalProjection }] = await Promise.all([
    import("../app/_runtime/components/tactical-map.tsx"),
    import("../app/_runtime/lib/rules/tactical-projection.ts"),
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
  assert.match(html, />\+5尺<\/text>/);
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
  assert.match(html, /当前可点选查看详情；移动与范围预览后续支持/);
  assert.doesNotMatch(html, /data-tactical-readout="v1"/);

  const unevenProjection = tacticalProjectionFixture();
  unevenProjection.self.position.elevation = "65";
  unevenProjection.visibleEntities[0].position.elevation = "-13";
  const unevenElevationHtml = renderToStaticMarkup(createElement(TacticalMap, {
    projection: unevenProjection,
    defaultExpanded: true,
  }));
  assert.match(unevenElevationHtml, />\+5尺5寸<\/text>/);
  assert.match(unevenElevationHtml, />-1尺1寸<\/text>/);
});

test("TacticalMap is collapsible and keeps unavailable projections compact", async () => {
  const { TacticalMap } = await import("../app/_runtime/components/tactical-map.tsx");
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
    collapsed.includes(`<div id="${collapsedControls}" hidden="" class="hidden lg:block"></div>`),
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
    absent.includes(`<div id="${absentControls}" hidden="" class="hidden lg:block"></div>`),
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
  assert.match(empty, /尚无已知环境要素/);
  assert.match(empty, /尚无已知区域效果/);
  assert.match(empty, /当前遭遇信息未知/);
});

test("project(viewer) supplies a viewer-visible centre-line distance for the map readout", async () => {
  const { project, replay, step } = await import("../app/_runtime/lib/rules/index.ts");
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
      import("../app/_runtime/lib/dnd/compute.ts"),
      import("../app/_runtime/components/play-table.tsx"),
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
