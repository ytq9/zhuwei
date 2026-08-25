import assert from "node:assert/strict";
import test from "node:test";

import { projectLocationMessages } from "../app/_runtime/lib/table/message-projection.ts";
import {
  publicPendingRoll,
  reconcileClueState,
} from "../app/_runtime/lib/kp/clue-state.ts";

test("keeps the live feed local and groups only experienced messages by visited place", () => {
  const rows = [
    { id: "a-wake", user_id: "a", body: "我检查遗体", meta: { place: "wake" } },
    { id: "kp-wake", user_id: null, body: "你看见黑橡叶", meta: { place: "wake" } },
    { id: "b-wake", user_id: "b", body: "我也看看", meta: { place: "wake" } },
    { id: "move", user_id: null, kind: "stage", name: "去向", body: "散木 去了 酒窖", meta: { places: ["wake", "cellar"] } },
    { id: "a-cellar", user_id: "a", body: "我检查盐霜", meta: { place: "cellar" } },
    { id: "kp-cellar", user_id: null, body: "盐霜带着海腥味", meta: { place: "cellar" } },
    { id: "after-left", user_id: "b", body: "离开后才说的话", meta: { place: "wake" } },
    { id: "yard", user_id: null, body: "后院秘密", meta: { place: "yard" } },
  ];

  const projected = projectLocationMessages({
    rows,
    userId: "a",
    currentPlace: "cellar",
    visitedPlaces: ["wake", "cellar"],
    labels: { wake: "居酒屋大厅", cellar: "酒窖", yard: "后院" },
    userNames: ["散木"],
  });

  assert.deepEqual(projected.current.map((m) => m.id), ["move", "a-cellar", "kp-cellar"]);
  assert.equal(projected.history.length, 1);
  assert.equal(projected.history[0].placeId, "wake");
  assert.deepEqual(
    projected.history[0].messages.map((m) => m.id),
    ["a-wake", "kp-wake", "b-wake", "move"],
  );
  assert.ok(!projected.history[0].messages.some((m) => m.id === "after-left"));
  assert.ok(!projected.history.some((thread) => thread.placeId === "yard"));
});

test("a clue roll deterministically pins the surface layer and success upgrades it", () => {
  const called = reconcileClueState({
    knownClueIds: ["c-leaf", "c-salt"],
    previousIds: [],
    explicitIds: [],
    calledRolls: [{ clueId: "c-salt" }],
    resolvedRolls: [],
    layers: {},
  });
  assert.deepEqual(called.revealedIds, ["c-salt"]);
  assert.equal(called.layers["c-salt"], "talk");
  assert.deepEqual(called.newIds, ["c-salt"]);

  const succeeded = reconcileClueState({
    knownClueIds: ["c-leaf", "c-salt"],
    previousIds: called.revealedIds,
    explicitIds: [],
    calledRolls: [],
    resolvedRolls: [{ clueId: "c-salt", result: { success: true } }],
    layers: called.layers,
  });
  assert.equal(succeeded.layers["c-salt"], "full");
  assert.deepEqual(succeeded.revealedIds, ["c-salt"]);
});

test("public clue rolls hide the clue id and success or failure payload", () => {
  const publicRoll = publicPendingRoll({
    id: "roll-1",
    userId: "a",
    name: "散木",
    ability: "int",
    skill: "investigation",
    kind: "check",
    dc: 11,
    clueId: "c-salt",
    reason: "失败只看到盐霜，成功认出盐霜与亡骨封禁有关。",
  });
  assert.equal("clueId" in publicRoll, false);
  assert.equal(publicRoll.reason, "进一步确认眼前的细节。");
  assert.doesNotMatch(JSON.stringify(publicRoll), /亡骨|封禁|失败|成功|c-salt/);
});
