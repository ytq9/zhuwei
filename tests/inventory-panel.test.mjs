import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  inventoryPackSummary,
  inventoryWornSummary,
} from "../app/_runtime/components/inventory-panel.tsx";

const root = new URL("../", import.meta.url);

test("inventory summaries distinguish occupied slots, item kinds, and total quantity", () => {
  assert.equal(inventoryWornSummary({}), "未装备");
  assert.equal(
    inventoryWornSummary({ main: "longsword", armor: "unknown:item:private" }),
    "2 个槽位 · 物品资料不可用、长剑",
  );
  assert.equal(inventoryPackSummary([]), "空");
  assert.equal(
    inventoryPackSummary([
      { itemId: "arrow", qty: 20 },
      { itemId: "gp", qty: 50 },
    ]),
    "2 种 · 共 70 个",
  );
});

test("inventory disclosures expose state and never use internal ids as fallback labels", async () => {
  const source = await readFile(
    new URL("app/_runtime/components/inventory-panel.tsx", root),
    "utf8",
  );
  assert.match(source, /aria-controls=\{panelId\}/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /role="region"/);
  assert.match(source, /min-h-11/);
  assert.match(source, /item\?\.name \?\? UNAVAILABLE_ITEM_LABEL/);
  assert.doesNotMatch(source, /item\?\.name \?\? entry\.itemId/);
});

test("equipped and backpack controls share one in-flight gear action controller", async () => {
  const source = await readFile(
    new URL("app/_runtime/components/inventory-panel.tsx", root),
    "utf8",
  );
  const panel = source.slice(source.indexOf("export function InventoryPanel"));
  assert.match(panel, /const actions = useGearActions\(code, canEdit\)/);
  assert.match(panel, /<GearSlots[^>]*actions=\{actions\}/s);
  assert.match(panel, /<Backpack[^>]*actions=\{actions\}/s);
  assert.match(source, /if \(!canEdit \|\| inFlight\.current\) return/);
});
