import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";

import { playTableSnapFixture } from "../../support/fixtures/tactical-map-v2.mjs";

// SPEC 0014 §§4、5、8 and ADR 0091: the map only collects the player's picks.
// Moves, the end of a turn and abilities on the player's own turn go straight
// to Rules (moveOnMap / combatAbility / endTurn); outside an encounter an
// ability aimed at someone is sent to the KP as an intent sentence
// (sendAction). An area is only an origin and a direction, never a target list.

const REVISION = `sha256:${"a".repeat(64)}`;

function text(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node?.children?.map(text).join("") ?? "";
}

const ABILITIES = [
  {
    abilityRef: "ability:alice:improvised-strike", name: "徒手攻击", group: "attack", activation: "attack",
    target: { kind: "creatures", count: 1, reachFeet: 5 },
  },
  {
    abilityRef: "ability:alice:class:second-wind", name: "回气", group: "feature", activation: "bonusAction",
    target: { kind: "self" },
  },
  {
    abilityRef: "ability:alice:spell:healing-word", name: "治愈真言", group: "spell", activation: "bonusAction",
    spellLevel: 1, slotLevel: 1, target: { kind: "creatures", count: 1, rangeFeet: 60 },
  },
  {
    abilityRef: "ability:alice:spell:sleep", name: "睡眠术", group: "spell", activation: "action", spellLevel: 1,
    slotLevel: 1, target: { kind: "area", shape: "sphere", sizeFeet: 20, origin: "point", rangeFeet: 90, needsDirection: false },
  },
  {
    abilityRef: "ability:alice:spell:thunderwave", name: "雷鸣波", group: "spell", activation: "action", spellLevel: 1,
    slotLevel: 1, target: { kind: "area", shape: "cube", sizeFeet: 15, origin: "self", needsDirection: true },
  },
];

const BASIC = [
  { abilityRef: "action:dash", name: "疾走", group: "basic", activation: "action", target: { kind: "none" } },
  { abilityRef: "action:disengage", name: "撤离", group: "basic", activation: "action", target: { kind: "none" } },
  { abilityRef: "action:dodge", name: "闪避", group: "basic", activation: "action", target: { kind: "none" } },
  { abilityRef: "action:grapple", name: "擒抱", group: "basic", activation: "attack",
    target: { kind: "creatures", count: 1, reachFeet: 5, npcOpponentsOnly: true } },
  { abilityRef: "action:shove", name: "推撞", group: "basic", activation: "attack",
    target: { kind: "creatures", count: 1, reachFeet: 5, npcOpponentsOnly: true } },
];

function snapFor(compileSheet, { combat, activeEntityId = "character:alice" }) {
  const snap = playTableSnapFixture(compileSheet);
  const authoritative = snap.state.authoritative;
  authoritative.combatControls = {
    abilities: structuredClone(ABILITIES),
    basicActions: structuredClone(BASIC),
    turn: combat ? { action: 1, bonusAction: 1, reaction: 1, attacksRemaining: 0 } : null,
    movement: combat ? { speedFeet: 30, remainingFeet: 20 } : null,
  };
  authoritative.tacticalProjection.spatialRevision = REVISION;
  if (combat) {
    authoritative.inCombat = true;
    authoritative.tacticalProjection.encounter.activeEntityId = activeEntityId;
  } else {
    authoritative.inCombat = false;
    authoritative.tacticalProjection.encounter = null;
  }
  return snap;
}

async function withTable(snap, run, respond = () => ({ action: "committed", narration: "notApplicable" })) {
  const originalFetch = globalThis.fetch;
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const { command, data } = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ command, data });
    const body = await respond(command, calls.length);
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
    await act(async () => {
      renderer = create(createElement(QueryClientProvider, { client: queryClient }, createElement(PlayTable, { code: "TACTIC", snap })));
    });
    const map = () => renderer.root.findByType(TacticalMap);
    const one = (props) => map().findByProps(props);
    const settle = async () => {
      for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    };
    const press = async (props) => {
      const node = one(props);
      assert.notEqual(node.props.disabled, true, `${JSON.stringify(props)} must be enabled`);
      await act(async () => { node.props.onClick(); await settle(); });
    };
    const key = async (name) => {
      const svg = map().find((node) => node.type === "svg" && node.props.role === "group");
      const target = {};
      await act(async () => {
        svg.props.onKeyDown({ key: name, target, currentTarget: target, preventDefault() {} });
        await settle();
      });
    };
    const token = async (entityId) => {
      const node = one({ "data-entity-id": entityId });
      await act(async () => { node.props.onClick(); await settle(); });
    };
    await run({ calls, map, one, press, key, token, act, settle });
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    queryClient?.clear();
    globalThis.fetch = originalFetch;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
}

function assertKeys(data, keys) {
  assert.deepEqual(Object.keys(data).sort(), [...keys].sort());
  assert.equal(typeof data.submissionId, "string");
  assert.ok(data.submissionId.length > 0);
}

test("outside an encounter the map walks to a point or beside someone, and sends abilities to the KP as intent", async () => {
  const { compileSheet } = await import("../../../app/_runtime/lib/dnd/compute.ts");
  await withTable(snapFor(compileSheet, { combat: false }), async ({ calls, map, one, press, key, token, act, settle }) => {
    await press({ "data-tactical-disclosure-trigger": "desktop" });
    assert.equal(one({ "data-tactical-actions": "exploration" }).props["data-tactical-my-turn"], "false");
    assert.equal(one({ "data-tactical-canvas": "v1" }).props["data-tactical-picking"], "destination");

    // Keyboard: the cursor starts on the player (120, 180) and moves a square.
    await key("ArrowRight");
    await key("Enter");
    assert.ok(one({ "data-tactical-destination": "180,180" }));
    await press({ "data-tactical-destination-submit": true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "moveOnMap");
    assertKeys(calls[0].data, ["code", "destination", "spatialRevision", "submissionId"]);
    assert.deepEqual(calls[0].data.destination, { kind: "point", x: "180", y: "180" });
    assert.equal(calls[0].data.spatialRevision, REVISION);

    for (const [key, ref] of [["entity:npc:warden", "npc:warden"], ["feature:feature:portal", "feature:portal"]]) {
      const select = one({ "data-tactical-beside-select": true });
      await act(async () => { select.props.onChange({ target: { value: key } }); await settle(); });
      await press({ "data-tactical-beside-submit": ref });
      const call = calls.at(-1);
      assert.equal(call.command, "moveOnMap");
      assertKeys(call.data, ["code", "destination", "spatialRevision", "submissionId"]);
      assert.deepEqual(call.data.destination, { kind: "nextTo", ref });
    }

    const sentences = [
      ["ability:alice:spell:healing-word", "target", "我对守夜人施放治愈真言。"],
      ["ability:alice:improvised-strike", "target", "我徒手攻击守夜人。"],
      ["ability:alice:spell:sleep", "aim", "我朝守夜人施放睡眠术。"],
    ];
    for (const [abilityRef, pick, sentence] of sentences) {
      await press({ "data-tactical-ability": abilityRef });
      if (pick === "target") await token("npc:warden");
      else await press({ "data-tactical-aim-option": "npc:warden" });
      assert.match(text(one({ "data-tactical-intent-preview": true })), new RegExp(sentence));
      await press({ "data-tactical-intent-submit": true });
      const call = calls.at(-1);
      assert.equal(call.command, "sendAction");
      assert.equal(call.data.text, sentence);
      assert.equal(call.data.code, "TACTIC");
    }
    assert.equal(calls.some((call) => call.command === "combatAbility"), false,
      "outside an encounter an ability is the KP's to adjudicate");
    assert.equal(map().findAll((node) => node.props["data-tactical-move-mode"] !== undefined).length, 0);
  }, (command) => command === "sendAction"
    ? { ok: true, action: "committed", narration: "published" }
    : { action: "committed", narration: "notApplicable" });
});

test("on the player's turn the map submits a path, creature targets, an area origin and direction, basic actions and the end of the turn", async () => {
  const { compileSheet } = await import("../../../app/_runtime/lib/dnd/compute.ts");
  await withTable(snapFor(compileSheet, { combat: true }), async ({ calls, map, one, press, key, token }) => {
    const panel = one({ "data-tactical-actions": "combat" });
    assert.equal(panel.props["data-tactical-my-turn"], "true");
    assert.match(text(one({ "data-tactical-turn-grants": true })), /动作 1 · 附赠动作 1 · 反应 1 · 剩余移动 20 尺（速度 30 尺）/);

    await press({ "data-tactical-move-mode": true });
    assert.equal(one({ "data-tactical-canvas": "v1" }).props["data-tactical-picking"], "path");
    await key("ArrowRight");
    await key("ArrowRight");
    await key("Enter");
    await key("ArrowDown");
    await key("Enter");
    assert.ok(one({ "data-tactical-path": "120,180 240,180 240,240" }));
    await press({ "data-tactical-path-submit": true });
    let call = calls.at(-1);
    assert.equal(call.command, "moveOnMap");
    assertKeys(call.data, ["code", "path", "spatialRevision", "submissionId"]);
    assert.deepEqual(call.data.path, [
      { x: "120", y: "180", elevation: "60" },
      { x: "240", y: "180", elevation: "60" },
      { x: "240", y: "240", elevation: "60" },
    ]);

    const abilityCall = (abilityRef) => {
      const latest = calls.at(-1);
      assert.equal(latest.command, "combatAbility");
      assertKeys(latest.data, ["abilityRef", "code", "spatialRevision", "submissionId", "target"]);
      assert.equal(latest.data.abilityRef, abilityRef);
      assert.equal(latest.data.spatialRevision, REVISION);
      return latest.data.target;
    };

    for (const abilityRef of ["ability:alice:improvised-strike", "action:grapple"]) {
      await press({ "data-tactical-ability": abilityRef });
      if (abilityRef === "action:grapple") {
        // A player target answers a contest itself, so the map offers grapple
        // and shove only against non-player creatures.
        assert.equal(map().findAll((node) => node.props["data-tactical-target-option"] === "character:alice").length, 0);
        assert.ok(one({ "data-tactical-target-option": "npc:warden" }));
        await token("character:alice");
        assert.equal(one({ "data-entity-id": "character:alice" }).props["data-targeted"], "false");
      }
      await token("npc:warden");
      assert.equal(one({ "data-entity-id": "npc:warden" }).props["data-targeted"], "true");
      await press({ "data-tactical-target-submit": true });
      assert.deepEqual(abilityCall(abilityRef), { kind: "creatures", refs: ["npc:warden"] });
    }

    await press({ "data-tactical-ability": "ability:alice:class:second-wind" });
    assert.deepEqual(abilityCall("ability:alice:class:second-wind"), { kind: "creatures", refs: ["character:alice"] });

    for (const abilityRef of ["action:dash", "action:disengage", "action:dodge"]) {
      await press({ "data-tactical-ability": abilityRef });
      assert.deepEqual(abilityCall(abilityRef), { kind: "none" });
    }

    // A cube from the player: the origin is where the player stands; the
    // direction is the way to the second point the player picked.
    await press({ "data-tactical-ability": "ability:alice:spell:thunderwave" });
    assert.equal(one({ "data-tactical-area-submit": true }).props.disabled, true);
    await key("ArrowRight");
    await key("Enter");
    await press({ "data-tactical-area-submit": true });
    const cube = abilityCall("ability:alice:spell:thunderwave");
    assert.deepEqual(cube, {
      kind: "area",
      origin: { x: "120", y: "180", elevation: "60" },
      direction: { x: "60", y: "0", elevation: "0" },
    });

    // A sphere at range: only its origin is submitted.
    await press({ "data-tactical-ability": "ability:alice:spell:sleep" });
    await press({ "data-tactical-area-option": "npc:warden" });
    await press({ "data-tactical-area-submit": true });
    const sphere = abilityCall("ability:alice:spell:sleep");
    assert.deepEqual(sphere, { kind: "area", origin: { x: "720", y: "180", elevation: "60" } });
    for (const area of [cube, sphere]) {
      assert.doesNotMatch(JSON.stringify(area), /targetIds|refs|affected/);
    }

    await press({ "data-tactical-end-turn": true });
    call = calls.at(-1);
    assert.equal(call.command, "endTurn");
    assertKeys(call.data, ["code", "submissionId"]);
    assert.equal(calls.some((entry) => entry.command === "sendAction"), false,
      "on the player's turn structured actions never go through the KP");
    assert.equal(map().findAll((node) => node.props["data-tactical-action-error"] !== undefined).length, 0);
  });
});

test("a refused map action shows the server's explanation and the bar waits while a submission is in flight", async () => {
  const { compileSheet } = await import("../../../app/_runtime/lib/dnd/compute.ts");
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await withTable(snapFor(compileSheet, { combat: true }), async ({ calls, one, press, act, settle }) => {
    await press({ "data-tactical-ability": "action:dash" });
    assert.match(text(one({ "data-tactical-action-error": true })), /这个动作现在不能这样用。/);

    const endTurn = one({ "data-tactical-end-turn": true });
    let pending;
    await act(async () => { pending = endTurn.props.onClick(); await settle(); });
    assert.equal(one({ "data-tactical-end-turn": true }).props.disabled, true);
    assert.equal(one({ "data-tactical-ability": "action:dodge" }).props.disabled, true);
    await act(async () => { release(); await pending; await settle(); });
    assert.equal(one({ "data-tactical-end-turn": true }).props.disabled, false);
    assert.equal(calls.at(-1).command, "endTurn");
  }, async (command) => {
    if (command === "combatAbility") return { ok: false, action: "notCommitted", error: "这个动作现在不能这样用。" };
    await held;
    return { action: "committed", narration: "notApplicable" };
  });
});

test("when it is another creature's turn the map says whose turn it is and the bar is disabled", async () => {
  const { compileSheet } = await import("../../../app/_runtime/lib/dnd/compute.ts");
  await withTable(snapFor(compileSheet, { combat: true, activeEntityId: "npc:warden" }), async ({ calls, map, one }) => {
    const panel = one({ "data-tactical-actions": "combat" });
    assert.equal(panel.props["data-tactical-my-turn"], "false");
    assert.match(text(panel), /当前行动：守夜人。轮到你时再行动。/);
    for (const props of [{ "data-tactical-move-mode": true }, { "data-tactical-end-turn": true }]) {
      assert.equal(one(props).props.disabled, true);
    }
    const abilityButtons = map().findAll((node) => node.type === "button" && node.props["data-tactical-ability"] !== undefined);
    assert.equal(abilityButtons.length, ABILITIES.length + BASIC.length);
    assert.ok(abilityButtons.every((button) => button.props.disabled === true));
    assert.equal(calls.length, 0);
  });
});

// SPEC 0014 §4 (ADR 0098): on the combat map a jump across or onto a feature
// goes straight to Rules at the landing it offered; a climb or swim is the
// player's sentence for the KP, offered only on a ditch, step, low wall,
// cliff or water.
test("on the player's turn the map jumps across a picked feature and sends a climb or a swim to the KP", async () => {
  const { compileSheet } = await import("../../../app/_runtime/lib/dnd/compute.ts");
  const snap = snapFor(compileSheet, { combat: true });
  const authoritative = snap.state.authoritative;
  const rectangle = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const ground = { state: "intact", opaque: false, impassable: true, cover: "none", propagation: "passes", terrain: "normal", elevation: "0" };
  authoritative.tacticalProjection.knownFeatures.push(
    { ...ground, id: "feature:ditch", kind: "terrain", label: "排水沟", polygon: rectangle("150", "120", "210", "240"),
      height: "1", landform: "ditch", depth: "36", material: "mud" },
    { ...ground, id: "feature:pond", kind: "terrain", label: "水塘", polygon: rectangle("900", "600", "1020", "720"),
      height: "1", landform: "water", depth: "48", current: "still" },
  );
  authoritative.tacticalProjection.knownFeatures.sort((left, right) => left.id.localeCompare(right.id));
  const landing = { x: "240", y: "180", elevation: "60" };
  authoritative.combatControls.jumps = [{ abilityRef: "action:long-jump", featureId: "feature:ditch", landing, running: true,
    costFeet: 10, clearCheck: false, landingCheck: false }];
  await withTable(snap, async ({ calls, map, one, press, act, settle }) => {
    const terrain = one({ "data-tactical-terrain": true });
    // Only the ditch and the pond are terrain to jump, climb or swim.
    assert.deepEqual(terrain.findAll((node) => node.type === "option" && node.props.value !== "").map((node) => node.props.value),
      ["feature:feature:ditch", "feature:feature:pond"]);
    const pick = async (featureId) => {
      const select = one({ "data-tactical-terrain-select": true });
      await act(async () => { select.props.onChange({ target: { value: `feature:${featureId}` } }); await settle(); });
    };
    await pick("feature:ditch");
    assert.match(text(one({ "data-tactical-jump": "action:long-jump" })), /跳过排水沟（助跑，花 10 尺）/);
    await press({ "data-tactical-jump": "action:long-jump" });
    let call = calls.at(-1);
    assert.equal(call.command, "combatAbility");
    assertKeys(call.data, ["abilityRef", "code", "spatialRevision", "submissionId", "target"]);
    assert.deepEqual([call.data.abilityRef, call.data.target], ["action:long-jump", { kind: "point", position: landing }]);

    // Beside the ditch she can climb down into it or across it.
    assert.deepEqual(map().findAll((node) => node.type === "button" && node.props["data-tactical-climb"] !== undefined)
      .map((node) => node.props["data-tactical-climb"]), ["down", "across"]);
    await press({ "data-tactical-climb": "across" });
    assert.match(text(one({ "data-tactical-intent-preview": true })), /我爬过排水沟。/);
    await press({ "data-tactical-intent-submit": true });
    call = calls.at(-1);
    assert.deepEqual([call.command, call.data.text], ["sendAction", "我爬过排水沟。"]);

    await pick("feature:pond");
    assert.equal(map().findAll((node) => node.props["data-tactical-jump"] !== undefined).length, 0);
    await press({ "data-tactical-climb": "across" });
    await press({ "data-tactical-intent-submit": true });
    assert.equal(calls.at(-1).data.text, "我游过水塘。");
  }, (command) => command === "sendAction"
    ? { ok: true, action: "committed", narration: "published" }
    : { action: "committed", narration: "notApplicable" });

  // Off her turn the terrain controls wait like the rest of the bar.
  const waiting = snapFor(compileSheet, { combat: true, activeEntityId: "npc:warden" });
  waiting.state.authoritative.tacticalProjection.knownFeatures.push({ ...ground, id: "feature:ditch", kind: "terrain", label: "排水沟",
    polygon: rectangle("150", "120", "210", "240"), height: "1", landform: "ditch", depth: "36", material: "mud" });
  waiting.state.authoritative.tacticalProjection.knownFeatures.sort((left, right) => left.id.localeCompare(right.id));
  await withTable(waiting, async ({ one, act, settle, map }) => {
    const select = one({ "data-tactical-terrain-select": true });
    await act(async () => { select.props.onChange({ target: { value: "feature:feature:ditch" } }); await settle(); });
    assert.ok(map().findAll((node) => node.type === "button" && node.props["data-tactical-climb"] !== undefined)
      .every((node) => node.props.disabled === true));
  });
});

// SPEC 0012 §§6.3、8.1 (ADR 0097, 0099): Hide, Search, Help and Ready on the
// bar, and an attack aimed at a point for a creature the player cannot see.
test("the bar hides, searches, helps an ally, readies a response and aims an attack at a point", async () => {
  const { compileSheet } = await import("../../../app/_runtime/lib/dnd/compute.ts");
  const snap = snapFor(compileSheet, { combat: true });
  const authoritative = snap.state.authoritative;
  authoritative.tacticalProjection.visibleEntities.push({
    id: "character:bob", name: "鲍勃", kind: "player", position: { x: "180", y: "180", elevation: "60" },
    footprint: { width: "60", depth: "60", height: "66" }, relation: "ally", publicStates: [],
  });
  authoritative.combatControls.abilities[0].target = { kind: "creatures", count: 1, reachFeet: 5, aimable: true };
  authoritative.combatControls.hidden = true;
  authoritative.combatControls.basicActions.push(
    { abilityRef: "action:hide", name: "躲藏", group: "basic", activation: "action", target: { kind: "none" } },
    { abilityRef: "action:search", name: "搜索", group: "basic", activation: "action", target: { kind: "none" } },
    { abilityRef: "action:help", name: "帮助", group: "basic", activation: "action",
      target: { kind: "help", allyRefs: ["character:bob"], enemyRefs: ["npc:warden"] } },
    { abilityRef: "action:ready", name: "预备", group: "basic", activation: "action",
      target: { kind: "ready", triggerRefs: ["character:bob", "npc:warden"], events: ["turnStarted", "movementCommitted", "spellCastingStarted"] } },
  );
  await withTable(snap, async ({ calls, map, one, press, key, token }) => {
    assert.match(text(one({ "data-tactical-hidden": true })), /你正躲藏着/);
    const abilityCall = (abilityRef) => {
      const latest = calls.at(-1);
      assert.equal(latest.command, "combatAbility");
      assertKeys(latest.data, ["abilityRef", "code", "spatialRevision", "submissionId", "target"]);
      assert.equal(latest.data.abilityRef, abilityRef);
      return latest.data.target;
    };
    for (const abilityRef of ["action:hide", "action:search"]) {
      await press({ "data-tactical-ability": abilityRef });
      assert.deepEqual(abilityCall(abilityRef), { kind: "none" });
    }

    // Help: the ally, then for an attack the enemy beside the helper.
    await press({ "data-tactical-ability": "action:help" });
    assert.equal(one({ "data-tactical-help-submit": true }).props.disabled, true);
    await token("character:bob");
    await press({ "data-tactical-help-submit": true });
    assert.deepEqual(abilityCall("action:help"), { kind: "help", allyRef: "character:bob" });
    await press({ "data-tactical-ability": "action:help" });
    await press({ "data-tactical-help-ally": "character:bob" });
    await press({ "data-tactical-help-mode": "attack" });
    assert.equal(one({ "data-tactical-help-submit": true }).props.disabled, true, "an attack help names its enemy");
    await press({ "data-tactical-help-enemy": "npc:warden" });
    await press({ "data-tactical-help-submit": true });
    assert.deepEqual(abilityCall("action:help"), { kind: "help", allyRef: "character:bob", enemyRef: "npc:warden" });

    // Ready: the warden's turn start, then the strike at it.
    await press({ "data-tactical-ability": "action:ready" });
    assert.equal(map().findAll((node) => node.props["data-tactical-ready-response"] !== undefined).length, 0,
      "the response comes after the trigger");
    await token("npc:warden");
    await press({ "data-tactical-ready-event": "turnStarted" });
    // Only abilities taking an action or an attack can be readied, and a
    // grapple or shove.
    assert.deepEqual(map().findAll((node) => node.type === "button" && node.props["data-tactical-ready-response"] !== undefined)
      .map((node) => node.props["data-tactical-ready-response"]),
    ["ability:alice:improvised-strike", "ability:alice:spell:sleep", "ability:alice:spell:thunderwave", "action:grapple", "action:shove"]);
    await press({ "data-tactical-ready-response": "ability:alice:improvised-strike" });
    await token("npc:warden");
    await press({ "data-tactical-target-submit": true });
    assert.deepEqual(abilityCall("action:ready"), { kind: "ready", trigger: { ref: "npc:warden", event: "turnStarted" },
      response: { kind: "ability", abilityRef: "ability:alice:improvised-strike", target: { kind: "creatures", refs: ["npc:warden"] } } });

    // Ready a grapple on the warden: the defender's skill is its own choice later.
    await press({ "data-tactical-ability": "action:ready" });
    await press({ "data-tactical-ready-trigger": "npc:warden" });
    await press({ "data-tactical-ready-event": "movementCommitted" });
    await press({ "data-tactical-ready-response": "action:grapple" });
    await token("npc:warden");
    await press({ "data-tactical-target-submit": true });
    assert.deepEqual(abilityCall("action:ready"), { kind: "ready", trigger: { ref: "npc:warden", event: "movementCommitted" },
      response: { kind: "ability", abilityRef: "action:grapple", target: { kind: "creatures", refs: ["npc:warden"] } } });

    // Ready a move: Bob's movement, then a path.
    await press({ "data-tactical-ability": "action:ready" });
    await press({ "data-tactical-ready-trigger": "character:bob" });
    await press({ "data-tactical-ready-event": "movementCommitted" });
    await press({ "data-tactical-ready-move": true });
    await key("ArrowLeft");
    await key("Enter");
    await press({ "data-tactical-path-submit": true });
    assert.deepEqual(abilityCall("action:ready"), { kind: "ready", trigger: { ref: "character:bob", event: "movementCommitted" },
      response: { kind: "move", path: [{ x: "120", y: "180", elevation: "60" }, { x: "60", y: "180", elevation: "60" }] } });

    // An attack aimed at an empty square: the ground pick names a point.
    await press({ "data-tactical-ability": "ability:alice:improvised-strike" });
    assert.equal(one({ "data-tactical-canvas": "v1" }).props["data-tactical-picking"], "aim");
    await key("ArrowUp");
    await key("Enter");
    assert.ok(one({ "data-tactical-aimed-point": "120,120" }));
    await press({ "data-tactical-target-submit": true });
    assert.deepEqual(abilityCall("ability:alice:improvised-strike"), { kind: "point", position: { x: "120", y: "120", elevation: "60" } });
    assert.equal(calls.some((call) => call.command === "sendAction"), false);
  });
});
