import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

function tacticalProjectionFixture() {
  const feature = ({ x, ...input }) => ({
    elevation: "0",
    height: "120",
    polygon: [
      { x, y: "120" },
      { x: String(Number(x) + 60), y: "120" },
      { x: String(Number(x) + 60), y: "240" },
      { x, y: "240" },
    ],
    state: "intact",
    terrain: "normal",
    ...input,
  });
  return {
    schema: "zhuwei.tactical-projection/v1",
    scene: {
      id: "scene:bell-yard",
      name: "钟楼庭院",
      boundary: {
        kind: "polygon",
        points: [
          { x: "0", y: "0" },
          { x: "1200", y: "0" },
          { x: "1200", y: "900" },
          { x: "0", y: "900" },
        ],
      },
      gridInches: 60,
    },
    self: {
      id: "character:alice",
      name: "阿莱莎",
      kind: "player",
      position: { x: "120", y: "180", elevation: "60" },
      footprint: { width: "60", depth: "60", height: "66" },
      relation: "self",
      publicStates: ["life:alive"],
    },
    visibleEntities: [{
      id: "npc:warden",
      name: "守夜人",
      kind: "npc",
      position: { x: "720", y: "180", elevation: "0" },
      footprint: { width: "61", depth: "59", height: "72" },
      relation: "enemy",
      publicStates: [],
    }],
    knownFeatures: [
      feature({
        id: "feature:barrier",
        kind: "barrier",
        label: "钟楼石墙",
        x: "300",
        opaque: true,
        impassable: true,
        cover: "full",
        propagation: "blocks",
      }),
      feature({
        id: "feature:destructible",
        kind: "destructible",
        label: "朽坏木箱",
        x: "420",
        opaque: false,
        impassable: true,
        cover: "threeQuarters",
        propagation: "passes",
      }),
      feature({
        id: "feature:interactable",
        kind: "interactable",
        label: "警铃拉杆",
        x: "540",
        opaque: false,
        impassable: false,
        cover: "half",
        propagation: "passes",
      }),
      feature({
        id: "feature:portal",
        kind: "portal",
        label: "关闭的庭院铁门",
        state: "closed",
        x: "660",
        opaque: true,
        impassable: true,
        cover: "half",
        propagation: "blocks",
      }),
      feature({
        id: "feature:terrain",
        kind: "terrain",
        label: "碎石坡",
        state: "difficult",
        x: "780",
        opaque: false,
        impassable: false,
        cover: "none",
        propagation: "passes",
      }),
    ],
    knownZones: [{
      id: "zone:fog-cloud",
      label: "庭院浓雾",
      sourceRef: "spell:fog-cloud",
      state: "active",
      geometry: {
        kind: "polygon",
        points: [
          { x: "840", y: "360" },
          { x: "1080", y: "360" },
          { x: "1080", y: "600" },
          { x: "840", y: "600" },
        ],
        elevation: "0",
        height: "120",
      },
      effectTags: ["heavily-obscured"],
      startsAtMicros: "0",
      expiresAtMicros: "60000000",
    }],
    encounter: {
      id: "encounter:yard",
      status: "starting",
      round: 1,
      activeEntityId: "character:alice",
      participantEntityIds: ["character:alice", "npc:warden"],
    },
    preview: null,
    textualReadout: {
      sceneId: "scene:bell-yard",
      summary: "阿莱莎位于钟楼庭院；可见守夜人与五个环境要素。",
      entities: ["守夜人与我中心直线约距 50 尺；位于东侧，地面高程 0 英寸。"],
      features: ["关闭的庭院铁门阻挡移动与视线，并提供半掩护。"],
    },
    spatialRevision:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
}

test("TacticalMap renders only the public projection as a readable two-dimensional map", async () => {
  const [{ TacticalMap }, { isTacticalProjection }] = await Promise.all([
    import("../app/_runtime/components/tactical-map.tsx"),
    import("../app/_runtime/lib/rules/tactical-projection.ts"),
  ]);
  const projection = tacticalProjectionFixture();
  assert.equal(isTacticalProjection(projection), true, "the DOM fixture must be a valid public projection");
  const html = renderToStaticMarkup(createElement(TacticalMap, { projection }));

  assert.match(html, /data-tactical-map="v1"/);
  assert.match(
    html,
    /data-tactical-map="v1" class="[^"]*flex[^"]*flex-col/,
    "the bounded map panel must scroll as a column instead of shrinking its SVG grid track",
  );
  assert.match(html, /aria-label="钟楼庭院战术地图"/);
  assert.match(html, /viewBox="0 0 1200 900"/);
  assert.match(
    html,
    /<svg[^>]*width="1200"[^>]*height="900"/,
    "the SVG needs an intrinsic aspect ratio so its overflow-hidden frame cannot collapse",
  );
  assert.match(
    html,
    /<div class="[^"]*shrink-0[^"]*overflow-hidden[^"]*">\s*<svg/,
    "the map frame must keep its rendered height while the panel scrolls",
  );
  assert.match(html, /data-grid-inches="60"/);
  assert.match(html, /data-scene-boundary="scene:bell-yard"/);

  assert.match(html, /data-entity-id="character:alice"/);
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
    /data-entity-id="character:alice"[^>]*>.*?<rect x="90" y="150" width="60" height="60"[^>]*>.*?<text x="120" y="180"/,
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
    /data-entity-id="npc:warden"[^>]*>.*?<rect x="689\.5" y="150\.5" width="61" height="59"[^>]*>.*?<text x="720" y="180"/,
    "odd positive footprint sizes may use display-only half-inch SVG coordinates without rounding authority",
  );
  assert.match(html, /守夜人/);
  assert.match(html, /当前行动：阿莱莎/);
  assert.match(html, /\+5 尺/);
  assert.match(html, /高度 5 尺 6 英寸/);

  for (const kind of ["barrier", "destructible", "interactable", "portal", "terrain"]) {
    assert.match(html, new RegExp(`data-feature-kind="${kind}"`));
  }
  assert.match(html, /data-feature-id="feature:barrier"/);
  assert.match(html, /data-impassable="true"/);
  assert.match(html, /data-opaque="true"/);
  assert.match(html, /data-cover="full"/);
  assert.match(html, /data-propagation="blocks"/);
  assert.match(html, /阻挡移动/);
  assert.match(html, /阻挡视线/);
  assert.match(html, /全掩护/);
  assert.match(html, /阻断区域传播/);
  assert.match(html, /data-zone-id="zone:fog-cloud"/);
  assert.match(html, /data-zone-state="active"/);
  assert.match(html, /庭院浓雾/);
  assert.match(html, /地图交互后续支持/);

  assert.match(html, /data-tactical-readout="v1"/);
  assert.match(html, /aria-label="钟楼庭院文字战术读数"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /阿莱莎位于钟楼庭院；可见守夜人与五个环境要素。/);
  assert.match(html, /守夜人与我中心直线约距 50 尺/);
  assert.match(html, /关闭的庭院铁门阻挡移动与视线，并提供半掩护。/);
});

test("TacticalMap reports unknown information instead of inventing a complete map", async () => {
  const { TacticalMap } = await import("../app/_runtime/components/tactical-map.tsx");
  const absent = renderToStaticMarkup(createElement(TacticalMap, { projection: null }));
  assert.match(absent, /data-tactical-map="unknown"/);
  assert.match(absent, /尚无观察者可见的战术地图数据/);

  const emptyProjection = tacticalProjectionFixture();
  emptyProjection.knownFeatures = [];
  emptyProjection.knownZones = [];
  emptyProjection.encounter = null;
  emptyProjection.textualReadout.features = [];
  const empty = renderToStaticMarkup(createElement(TacticalMap, {
    projection: emptyProjection,
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
  const sheet = compileSheet({
    name: "阿莱莎",
    raceId: "human",
    classId: "fighter",
    subclassId: "champion",
    backgroundId: "soldier",
    scores: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 },
    extraSkillIds: [],
    cantrips: [],
    prepared: [],
    spellbook: [],
    equipmentChoice: 0,
    appearance: "提着旧灯。",
    trait: "谨慎",
    ideal: "真相",
    bond: "遗嘱",
    flaw: "多疑",
  });
  const projection = tacticalProjectionFixture();
  const snap = {
    me: { userId: "principal:alice", is_host: true, nickname: "爱丽丝" },
    room: {
      id: "room:tactical",
      code: "TACTIC",
      title: "战术桌",
      status: "play",
      module_id: "black-oak-will",
      kp_model: "deepseek-chat",
      ruleset_version: "dnd5e-2014-srd5.1-authoritative-v2",
    },
    members: [{ user_id: "principal:alice", nickname: "爱丽丝", is_host: true }],
    characters: [{ userId: "principal:alice", locked: true, sheet }],
    messages: [],
    locationThreads: [],
    logs: [],
    state: {
      chapterName: "第一章",
      sceneName: "钟楼庭院",
      kpBusy: false,
      pendingRolls: [],
      pendingInputs: [],
      clues: [],
      npcs: [],
      sceneId: "scene:bell-yard",
      places: { "principal:alice": "scene:bell-yard" },
      placeNames: { "principal:alice": "钟楼庭院" },
      partySplit: false,
      clocks: {},
      receipts: [],
      authoritative: {
        stateVersion: "17",
        projectionHash: "sha256:alice-tactical",
        controlledCharacter: {
          characterId: "character:alice",
          name: "阿莱莎",
          sceneId: "scene:bell-yard",
          hitPoints: { current: sheet.hp.current, maximum: sheet.hp.max },
          resources: {},
          resourceMaximums: {},
          classId: "fighter",
          level: 3,
        },
        activities: [],
        inCombat: true,
        tacticalProjection: projection,
      },
      restVote: null,
      restHold: null,
      squads: [],
      squadInvite: null,
      squadQueue: [],
      combat: null,
      ruleProjection: null,
    },
    module: { title: "黑橡木遗嘱", chapters: [{ id: "chapter:one", name: "第一章" }] },
  };
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(PlayTable, { code: "TACTIC", snap }),
    ),
  );

  assert.match(html, /data-tactical-map="v1"/);
  assert.match(html, /data-scene-boundary="scene:bell-yard"/);
  assert.match(html, /data-tactical-readout="v1"/);
  assert.match(html, /阿莱莎位于钟楼庭院；可见守夜人与五个环境要素。/);

  const unknownSnap = structuredClone(snap);
  delete unknownSnap.state.authoritative.tacticalProjection;
  const unknownHtml = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(PlayTable, { code: "TACTIC", snap: unknownSnap }),
    ),
  );
  assert.match(unknownHtml, /data-tactical-map="unknown"/);
  assert.match(unknownHtml, /尚无观察者可见的战术地图数据/);
  assert.match(unknownHtml, /你做什么、说什么/);
});
