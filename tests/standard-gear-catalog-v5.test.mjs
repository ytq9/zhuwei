import assert from "node:assert/strict";
import test from "node:test";
import { ITEMS, itemById, kitToGear, packSummary } from "../app/_runtime/lib/dnd/gear.ts";
import { compileSheet, ensureGear } from "../app/_runtime/lib/dnd/compute.ts";
import { initResources } from "../app/_runtime/lib/dnd/resources.ts";

function gearQuantity(gear, itemId) {
  return gear.backpack.filter(entry => entry.itemId === itemId).reduce((sum, entry) => sum + entry.qty, 0)
    + Object.entries(gear.equipped).filter(([slot, id]) => slot !== "ammo" && id === itemId).length;
}

test("starting kits keep each weapon and its declared ammunition quantities separate", () => {
  for (const [line, weaponId, ammunitionId, ammunitionQuantity] of [
    ["轻弩与 20 矢", "light-crossbow", "bolt", 20],
    ["短弓与 20 矢", "shortbow", "arrow", 20],
    ["长弓与 12 矢", "longbow", "arrow", 12],
  ]) {
    const gear = kitToGear([line]);
    assert.equal(gearQuantity(gear, weaponId), 1, line);
    assert.equal(gearQuantity(gear, ammunitionId), ammunitionQuantity, line);
    assert.equal(gear.equipped.ammo, ammunitionId);
  }
});

test("individual ammunition, counted weapons, currency and a named compound tool retain exact quantities", () => {
  for (const [line, itemId, quantity] of [
    ["20 矢", "bolt", 20], ["箭", "arrow", 1],
    ["两把手斧", "handaxe", 2], ["手斧两把", "handaxe", 2],
    ["两把短剑", "shortsword", 2], ["标枪 4 支", "javelin", 4],
    ["15 gp", "gp", 15], ["墨水与笔", "ink", 1],
  ]) assert.equal(gearQuantity(kitToGear([line]), itemId), quantity, line);
});

test("normal fighter sheet compilation and missing-loadout recovery share the corrected kit parser", () => {
  const sheet = compileSheet({ name: "建卡数量回归", raceId: "human", classId: "fighter",
    subclassId: "champion", backgroundId: "soldier", equipmentChoice: 0,
    scores: { str: 15, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
    extraSkillIds: [], cantrips: [], prepared: [], spellbook: [],
    appearance: "", trait: "", ideal: "", bond: "", flaw: "",
  });
  for (const gear of [sheet, ensureGear({ ...sheet, equipped: undefined, backpack: undefined })]) {
    assert.equal(gearQuantity(gear, "light-crossbow"), 1);
    assert.equal(gearQuantity(gear, "bolt"), 20);
    assert.equal(gearQuantity(gear, "gp"), 10);
    assert.equal(gearQuantity(gear, "torch"), 10);
    assert.equal(gearQuantity(gear, "ration"), 10);
    assert.equal(gearQuantity(gear, "explorer-pack"), 0);
  }
  assert.equal(sheet.resources.arrow, 0);
  assert.equal(sheet.resources.bolt, 20);
  assert.equal(sheet.resources.secondWind.max, 1);
});

test("stock initialization sums structured stacks and never refills zero from equipment prose", () => {
  const base = { classId: "fighter", raceId: "human", subclassId: "champion",
    scores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    equipment: ["轻弩与 20 矢", "探险者套装", "15 gp"], equipped: { ammo: "bolt" } };
  const counted = initResources({ ...base, backpack: [
    { itemId: "bolt", qty: 3 }, { itemId: "bolt", qty: 4 },
    { itemId: "gp", qty: 2 }, { itemId: "gp", qty: 5 },
    { itemId: "torch", qty: 0 }, { itemId: "ration", qty: 0 },
  ] });
  assert.equal(counted.bolt, 7);
  assert.equal(counted.arrow, 0);
  assert.equal(counted.gold, 7);
  assert.equal(counted.torch, 0);
  assert.equal(counted.ration, 0);
  assert.equal(initResources({ ...base, backpack: [{ itemId: "bolt", qty: 0 }] }).bolt, 0);
  assert.equal(initResources({ ...base, backpack: [] }).bolt, 0);
});

test("different equipment bundles expand through the same declared contents without retaining a refill source", () => {
  for (const bundle of ITEMS.filter((item) => item.contents !== undefined)) {
    const gear = kitToGear([bundle.name, bundle.name]);
    assert.equal(gearQuantity(gear, bundle.id), 0);
    for (const entry of bundle.contents) assert.equal(gearQuantity(gear, entry.itemId), entry.qty * 2);
  }
});

test("equipment bundle contents match SRD 5.1 Equipment Packs page 70", () => {
  const expected = {
    "explorer-pack": { backpack: 1, bedroll: 1, "mess-kit": 1, tinderbox: 1, torch: 10, ration: 10, waterskin: 1, "rope-50ft": 1 },
    "burglar-pack": { backpack: 1, "ball-bearing": 1000, "string-10ft": 1, bell: 1, candle: 5, crowbar: 1, hammer: 1,
      piton: 10, lantern: 1, oil: 2, ration: 5, tinderbox: 1, waterskin: 1, "rope-50ft": 1 },
    "priest-pack": { backpack: 1, blanket: 1, candle: 10, tinderbox: 1, "alms-box": 1, incense: 2, censer: 1,
      vestments: 1, ration: 2, waterskin: 1 },
    "scholar-pack": { backpack: 1, book: 1, ink: 1, parchment: 10, "sand-pouch": 1, knife: 1 },
  };
  for (const [bundleId, contents] of Object.entries(expected)) {
    const gear = kitToGear([itemById(bundleId).name]);
    assert.deepEqual(Object.fromEntries(gear.backpack.map(({ itemId, qty }) => [itemId, qty])), contents, bundleId);
  }
  assert.match(itemById("ink").text, /一瓶墨水与一支墨水笔/);
  assert.equal(gearQuantity(kitToGear(["学者套装"]), "ink"), 1);
  assert.equal(initResources({ classId: "cleric", scores: {}, ...kitToGear(["牧师套装"]) }).ration, 2);
});

test("standard gear declares category and stackability per catalog entry", () => {
  for (const item of ITEMS) {
    assert.equal(typeof item.category, "string", `${item.id} must declare category`);
    assert.equal(typeof item.stackable, "boolean", `${item.id} must declare stackability`);
  }

  assert.deepEqual(
    ITEMS.filter(({ stackable }) => stackable).map(({ id }) => id).sort(),
    ["arrow", "ball-bearing", "bolt", "candle", "gp", "incense", "oil", "parchment", "piton", "ration", "torch"],
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
