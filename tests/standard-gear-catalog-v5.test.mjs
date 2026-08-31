import assert from "node:assert/strict";
import test from "node:test";
import { ITEMS, itemById, packSummary } from "../app/_runtime/lib/dnd/gear.ts";

test("standard gear declares category and stackability per catalog entry", () => {
  for (const item of ITEMS) {
    assert.equal(typeof item.category, "string", `${item.id} must declare category`);
    assert.equal(typeof item.stackable, "boolean", `${item.id} must declare stackability`);
  }

  assert.deepEqual(
    ITEMS.filter(({ stackable }) => stackable).map(({ id }) => id).sort(),
    ["arrow", "bolt", "gp", "incense"],
  );
  assert.equal(itemById("spellbook")?.stackable, false);
  assert.equal(itemById("thieves-tools")?.stackable, false);
  assert.equal(itemById("letters")?.stackable, false);
  assert.equal(itemById("trophy")?.stackable, false);
  assert.equal(itemById("map-scrap")?.stackable, false);
  assert.equal(itemById("pet-rat")?.stackable, false);
});

test("standard gear category is an explicit mechanical fact", () => {
  assert.equal(itemById("longsword")?.category, "weapon");
  assert.equal(itemById("chain")?.category, "armor");
  assert.equal(itemById("shield")?.category, "shield");
  assert.equal(itemById("arrow")?.category, "ammunition");
  assert.equal(itemById("incense")?.category, "consumable");
  assert.equal(itemById("thieves-tools")?.category, "tool");
  assert.equal(itemById("gp")?.category, "currency");
  assert.equal(itemById("holy-symbol")?.category, "equipment");
  assert.equal(itemById("spellbook")?.category, "object");
});

test("legacy character summaries use kinds and units instead of calling everything pieces", () => {
  assert.equal(packSummary([
    { itemId: "arrow", qty: 20 },
    { itemId: "gp", qty: 50 },
  ]), "2 种 · 共 70 个 · 50 gp");
});
