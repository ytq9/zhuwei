import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";

import { playTableSnapFixture } from "../../support/fixtures/tactical-map-v2.mjs";

// SPEC 0014 §8 (ADR 0103 decisions 4-5): outside an encounter a door that
// leads elsewhere offers "前往<地点>", a plain sentence sent to the KP through
// the map's sendIntent like anything the player says; and the player
// stitches the maps of the places it knows, picked by level, aligned by the
// site plan. Stitching sends nothing to the table.

const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const STORAGE_KEY = "zhuwei:tactical-map:stitched:character:alice";

function text(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node?.children?.map(text).join("") ?? "";
}

/** The bell yard with an open gate to the chapel next door and its closed
 * iron gate down to the crypt; the chapel and the crypt were visited. */
function snapFor(compileSheet, { combat }) {
  const snap = playTableSnapFixture(compileSheet);
  const authoritative = snap.state.authoritative;
  const projection = authoritative.tacticalProjection;
  authoritative.combatControls = {
    abilities: [],
    basicActions: [],
    turn: combat ? { action: 1, bonusAction: 1, reaction: 1, attacksRemaining: 0 } : null,
    movement: combat ? { speedFeet: 30, remainingFeet: 30 } : null,
  };
  if (combat) {
    authoritative.inCombat = true;
  } else {
    authoritative.inCombat = false;
    projection.encounter = null;
  }
  projection.knownFeatures.find((feature) => feature.id === "feature:portal").leadsTo =
    { sceneId: "scene:crypt", name: "地下墓室", passable: false };
  projection.knownFeatures.push({
    id: "feature:gate", kind: "portal", label: "庭院侧门", state: "open", polygon: rect("1140", "360", "1200", "480"),
    elevation: "0", height: "84", opaque: false, impassable: false, cover: "none", propagation: "passes", terrain: "normal",
    leadsTo: { sceneId: "scene:chapel", name: "小礼拜堂", passable: true },
  });
  projection.knownFeatures.sort((left, right) => left.id.localeCompare(right.id));
  projection.knownPlaces = [
    { sceneId: "scene:bell-yard", name: "钟楼庭院", placement: { x: "0", y: "0", level: 0 },
      boundary: structuredClone(projection.scene.boundary), features: [] },
    { sceneId: "scene:chapel", name: "小礼拜堂", placement: { x: "1200", y: "0", level: 0 },
      boundary: { kind: "polygon", points: rect("0", "0", "600", "900") },
      features: [{ id: "feature:chapel:altar", kind: "interactable", label: "祭坛", polygon: rect("240", "60", "360", "120"),
        elevation: "0", height: "36" }] },
    { sceneId: "scene:crypt", name: "地下墓室", placement: { x: "0", y: "0", level: -1 },
      boundary: { kind: "polygon", points: rect("0", "0", "600", "600") },
      features: [{ id: "feature:crypt:pool", kind: "terrain", label: "积水", polygon: rect("120", "120", "240", "240"),
        elevation: "0", height: "1", landform: "water", depth: "24", current: "still" }] },
  ];
  projection.textualReadout.places = [
    "钟楼庭院（地面层）：你在这里。",
    "小礼拜堂（地面层）：到过；已知祭坛。",
    "地下墓室（地下 1 层）：到过；已知积水。",
  ];
  return snap;
}

function memoryStorage(entries = {}) {
  const store = new Map(Object.entries(entries));
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
}

async function withTable(snap, run, { storage } = {}) {
  const originalFetch = globalThis.fetch;
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  if (storage) Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const { command, data } = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ command, data });
    const body = command === "sendAction"
      ? { ok: true, action: "committed", narration: "published" }
      : { action: "committed", narration: "notApplicable" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  let renderer;
  let queryClient;
  const [{ QueryClient, QueryClientProvider }, { PlayTable }, { TacticalMap }, { act, create }] = await Promise.all([
    import("@tanstack/react-query"),
    import("../../../app/_runtime/components/play-table.tsx"),
    import("../../../app/_runtime/components/tactical-map.tsx"),
    import("react-test-renderer"),
  ]);
  try {
    queryClient = new QueryClient();
    const tree = () => createElement(QueryClientProvider, { client: queryClient }, createElement(PlayTable, { code: "TACTIC", snap }));
    await act(async () => { renderer = create(tree()); });
    const map = () => renderer.root.findByType(TacticalMap);
    const one = (props) => map().findByProps(props);
    const all = (attribute) => map().findAll((node) => typeof node.type === "string" && node.props[attribute] !== undefined);
    const settle = async () => {
      for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    };
    const press = async (props) => {
      const node = one(props);
      assert.notEqual(node.props.disabled, true, `${JSON.stringify(props)} must be enabled`);
      await act(async () => { node.props.onClick(); await settle(); });
    };
    const check = async (sceneId, checked) => {
      const box = one({ "data-tactical-stitch-place": sceneId });
      await act(async () => { box.props.onChange({ target: { checked } }); await settle(); });
    };
    const remount = async () => {
      await act(async () => renderer.unmount());
      await act(async () => { renderer = create(tree()); });
    };
    await run({ calls, map, one, all, press, check, remount, act, settle });
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    queryClient?.clear();
    globalThis.fetch = originalFetch;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
  }
}

test("the fixture is a valid public projection", async () => {
  const [{ compileSheet }, { isTacticalProjection }] = await Promise.all([
    import("../../../app/_runtime/lib/dnd/compute.ts"),
    import("../../../app/_runtime/lib/rules/tactical-projection.ts"),
  ]);
  for (const combat of [false, true]) {
    assert.equal(isTacticalProjection(snapFor(compileSheet, { combat }).state.authoritative.tacticalProjection), true);
  }
});

test("outside an encounter 前往 on a door sends the player's sentence to the KP, and says when the door is closed", async () => {
  const { compileSheet } = await import("../../../app/_runtime/lib/dnd/compute.ts");
  await withTable(snapFor(compileSheet, { combat: false }), async ({ calls, one, all, press }) => {
    await press({ "data-tactical-disclosure-trigger": "desktop" });
    assert.deepEqual(all("data-tactical-go-to").map((node) => node.props["data-tactical-go-to"]), ["feature:gate", "feature:portal"]);
    assert.match(text(one({ "data-tactical-go-to": "feature:gate" })), /^庭院侧门→ 小礼拜堂$/);
    assert.match(text(one({ "data-tactical-go-to": "feature:portal" })), /^关闭的庭院铁门→ 地下墓室 · 暂时无法通过$/);

    await press({ "data-tactical-go-to": "feature:gate" });
    // The door is selected on the map, with where it leads.
    assert.ok(one({ "data-tactical-selected": "feature:feature:gate" }));
    assert.match(text(one({ "data-tactical-leads-to": "scene:chapel" })), /通往小礼拜堂 · 现在可以通过/);
    assert.match(text(one({ "data-tactical-intent-preview": true })), /将作为你的行动发送：我穿过庭院侧门去小礼拜堂。/);
    assert.equal(all("data-tactical-go-to-closed").length, 0);
    await press({ "data-tactical-intent-submit": true });
    assert.deepEqual([calls.at(-1).command, calls.at(-1).data.text, calls.at(-1).data.code], ["sendAction", "我穿过庭院侧门去小礼拜堂。", "TACTIC"]);

    // A closed door: the map says so, and the player may still ask the KP.
    await press({ "data-tactical-go-to": "feature:portal" });
    assert.match(text(one({ "data-tactical-go-to-closed": true })), /这扇门现在关着/);
    await press({ "data-tactical-intent-submit": true });
    assert.equal(calls.at(-1).data.text, "我打开关闭的庭院铁门，去地下墓室。");
    assert.deepEqual(calls.map((call) => call.command), ["sendAction", "sendAction"],
      "going elsewhere is the KP's to adjudicate; nothing goes straight to Rules");
  });
});

test("in an encounter the map offers no 前往", async () => {
  const { compileSheet } = await import("../../../app/_runtime/lib/dnd/compute.ts");
  await withTable(snapFor(compileSheet, { combat: true }), async ({ one, all, act, settle }) => {
    assert.equal(one({ "data-tactical-actions": "combat" }).props["data-tactical-my-turn"], "true");
    // Even with the door picked on the map.
    const door = one({ "data-feature-id": "feature:gate" });
    await act(async () => { door.props.onClick(); await settle(); });
    assert.ok(one({ "data-tactical-selected": "feature:feature:gate" }));
    assert.equal(all("data-tactical-go-to-list").length, 0);
    assert.equal(all("data-tactical-go-to").length, 0);
  });
});

test("the stitch picker lists the known places by level and draws the chosen ones where the site plan puts them", async () => {
  const { compileSheet } = await import("../../../app/_runtime/lib/dnd/compute.ts");
  const storage = memoryStorage();
  await withTable(snapFor(compileSheet, { combat: false }), async ({ calls, one, all, press, check, remount }) => {
    await press({ "data-tactical-disclosure-trigger": "desktop" });
    const canvas = () => one({ "data-tactical-canvas": "v1" });
    const svg = () => canvas().find((node) => node.type === "svg");
    // Only the known places, by level from the top floor down; the current
    // place is always on the map.
    assert.deepEqual(all("data-tactical-stitch-level").map((node) => node.props["data-tactical-stitch-level"]), [0, -1]);
    const boxes = all("data-tactical-stitch-place");
    assert.deepEqual(boxes.map((node) => [node.props["data-tactical-stitch-place"], node.props.checked, node.props.disabled]), [
      ["scene:bell-yard", true, true],
      ["scene:chapel", false, false],
      ["scene:crypt", false, false],
    ]);
    assert.equal(canvas().props["data-tactical-stitched-view"], "none");
    assert.equal(svg().props.viewBox, "0 0 1200 900");
    assert.equal(all("data-tactical-stitched-place").length, 0);

    await check("scene:chapel", true);
    // The chapel lies east of the yard: the view widens to it, read-only and
    // dimmed, while the yard stays the interactive map.
    const chapel = one({ "data-tactical-stitched-place": "scene:chapel" });
    assert.equal(chapel.props.transform, "translate(1200 0)");
    assert.match(chapel.props.className, /pointer-events-none/);
    assert.match(chapel.props.className, /opacity-50/);
    assert.ok(one({ "data-tactical-stitched-feature": "feature:chapel:altar" }));
    assert.equal(svg().props.viewBox, "0 0 1800 900");
    assert.equal(canvas().props["data-tactical-stitched-view"], "0");
    assert.ok(one({ "data-entity-id": "character:alice" }));
    assert.ok(one({ "data-tactical-ground": true }));
    assert.equal(canvas().props["data-tactical-picking"], "destination");
    assert.match(svg().props["aria-label"], /拼合显示地面层的小礼拜堂，只读/);
    // One level chosen: nothing to switch.
    assert.equal(all("data-tactical-level-switch").length, 0);
    assert.equal(storage.store.get(STORAGE_KEY), JSON.stringify(["scene:chapel"]));

    // The choice is remembered for this viewer.
    await remount();
    await press({ "data-tactical-disclosure-trigger": "desktop" });
    assert.equal(one({ "data-tactical-stitch-place": "scene:chapel" }).props.checked, true);
    assert.ok(one({ "data-tactical-stitched-place": "scene:chapel" }));

    await check("scene:chapel", false);
    assert.equal(all("data-tactical-stitched-place").length, 0);
    assert.equal(svg().props.viewBox, "0 0 1200 900");
    assert.equal(storage.store.get(STORAGE_KEY), JSON.stringify([]));
    assert.equal(calls.length, 0, "stitching sends nothing to the table");
  }, { storage });
});

test("places on another level are switched to by level, with the current place only an outline there", async () => {
  const { compileSheet } = await import("../../../app/_runtime/lib/dnd/compute.ts");
  const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(["scene:chapel", "scene:crypt", "scene:elsewhere"]) });
  await withTable(snapFor(compileSheet, { combat: false }), async ({ calls, one, all, press }) => {
    await press({ "data-tactical-disclosure-trigger": "desktop" });
    const canvas = () => one({ "data-tactical-canvas": "v1" });
    // A remembered place the player does not know (any more) is ignored.
    assert.deepEqual(all("data-tactical-stitch-place").map((node) => node.props.checked), [true, true, true]);
    assert.deepEqual(all("data-tactical-level").map((node) => [node.props["data-tactical-level"], node.props["aria-checked"]]),
      [[0, true], [-1, false]]);
    assert.match(text(one({ "data-tactical-level": 0 })), /地面层（你在这层）/);
    assert.deepEqual(all("data-tactical-stitched-place").map((node) => node.props["data-tactical-stitched-place"]), ["scene:chapel"]);

    await press({ "data-tactical-level": -1 });
    assert.deepEqual(all("data-tactical-stitched-place").map((node) => node.props["data-tactical-stitched-place"]), ["scene:crypt"]);
    assert.ok(one({ "data-tactical-stitched-feature": "feature:crypt:pool" }));
    assert.ok(one({ "data-tactical-current-outline": "scene:bell-yard" }));
    // Nothing on the yard's map is picked or drawn from another level.
    assert.equal(all("data-entity-id").length, 0);
    assert.equal(all("data-tactical-ground").length, 0);
    assert.equal(all("data-scene-boundary").length, 0);
    assert.equal(canvas().props["data-tactical-picking"], "none");
    assert.equal(canvas().props["data-tactical-stitched-view"], "-1");
    // The walk and go-to controls stay usable from the lists.
    assert.equal(all("data-tactical-go-to").length, 2);

    await press({ "data-tactical-level": 0 });
    assert.ok(one({ "data-entity-id": "character:alice" }));
    assert.equal(all("data-tactical-current-outline").length, 0);
    assert.equal(calls.length, 0);
  }, { storage });
});

test("the text readout lists the same places, and the mobile map keeps the stitch controls inside its frame", async () => {
  const { compileSheet } = await import("../../../app/_runtime/lib/dnd/compute.ts");
  await withTable(snapFor(compileSheet, { combat: false }), async ({ map, one, all, press }) => {
    await press({ "data-tactical-disclosure-trigger": "mobile" });
    const dialog = one({ "data-tactical-map-mobile": "open" });
    const controls = dialog.find((node) => node.props["data-tactical-stitch-controls"] !== undefined);
    assert.match(controls.props.className, /min-w-0/);
    for (const label of controls.findAll((node) => node.type === "label")) assert.match(label.props.className, /max-w-full/);
    // The stitched map scales inside the same frame rather than overflowing it.
    const frame = dialog.find((node) => node.props["data-tactical-canvas"] === "v1");
    assert.match(frame.props.className, /overflow-hidden/);
    assert.equal(frame.find((node) => node.type === "svg").props.preserveAspectRatio, "xMidYMid meet");

    await press({ "data-tactical-view-trigger": "text" });
    const places = map().find((node) => node.props["data-tactical-readout-places"] !== undefined);
    assert.deepEqual(places.findAll((node) => node.type === "li").map(text), [
      "钟楼庭院（地面层）：你在这里。",
      "小礼拜堂（地面层）：到过；已知祭坛。",
      "地下墓室（地下 1 层）：到过；已知积水。",
    ]);
    // The doors elsewhere stay reachable from the text view.
    assert.equal(all("data-tactical-go-to").length, 2);
  });
});

test("without known places or door destinations the map shows neither control", async () => {
  const { compileSheet } = await import("../../../app/_runtime/lib/dnd/compute.ts");
  const snap = playTableSnapFixture(compileSheet);
  snap.state.authoritative.inCombat = false;
  snap.state.authoritative.tacticalProjection.encounter = null;
  await withTable(snap, async ({ all, press }) => {
    await press({ "data-tactical-disclosure-trigger": "desktop" });
    assert.equal(all("data-tactical-stitch").length, 0);
    assert.equal(all("data-tactical-go-to-list").length, 0);
    assert.equal(all("data-tactical-stitched-view").length, 0);
  });
});
