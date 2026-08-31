import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TestRenderer, { act } from "react-test-renderer";
import {
  InventoryPanel,
  inventoryPackSummary,
  inventoryWornSummary,
} from "../app/_runtime/components/inventory-panel.tsx";

const root = new URL("../", import.meta.url);

test("inventory summaries distinguish occupied slots, item kinds, and total quantity", () => {
  assert.equal(inventoryWornSummary({ entries: [] }), "未装备");
  assert.equal(
    inventoryWornSummary({
      entries: [
        { kind: "identified", name: "长剑", quantity: 1, equippedSlot: "main" },
        { kind: "identified", name: "链甲", quantity: 1, equippedSlot: "armor" },
      ],
    }),
    "2 个槽位 · 链甲、长剑",
  );
  assert.equal(inventoryPackSummary({ entries: [] }), "空");
  assert.equal(
    inventoryPackSummary({
      entries: [
        { kind: "identified", name: "箭", quantity: 20, equippedSlot: null },
        { kind: "identified", name: "金币", quantity: 50, equippedSlot: null },
      ],
    }),
    "2 种 · 共 70 个",
  );
});

function renderedText(node) {
  return node.children.map((child) => typeof child === "string" ? child : renderedText(child)).join("");
}

test("opaque inventory renders only safe state and no item actions", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const queryClient = new QueryClient();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(InventoryPanel, {
        code: "ROOM",
        canEdit: true,
        inventory: {
          entries: [{
            kind: "opaque",
            entryId: "item-entry:hidden:1",
            quantity: 3,
            condition: "broken",
            equippedSlot: null,
          }],
        },
      }),
    ));
  });

  const buttons = () => renderer.root.findAllByType("button");
  const backpack = buttons().find((button) => renderedText(button).includes("背包"));
  assert.ok(backpack);
  await act(async () => backpack.props.onClick());
  const opaqueItem = buttons().find((button) => renderedText(button).includes("未辨明物品"));
  assert.ok(opaqueItem);
  await act(async () => opaqueItem.props.onClick());

  const output = renderedText(renderer.root);
  assert.match(output, /未辨明物品/);
  assert.match(output, /数量 3 · 槽位 背包 · 状态 已损坏/);
  assert.doesNotMatch(output, /使用|装备到|卸到背包/);
  assert.equal(buttons().length, 3, "opaque entries add no use, equip, or stow buttons");

  await act(async () => renderer.unmount());
  queryClient.clear();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

test("an opaque equipped item can be stowed without disclosing item mechanics", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const queryClient = new QueryClient();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(InventoryPanel, {
        code: "ROOM",
        canEdit: true,
        inventory: {
          entries: [{
            kind: "opaque",
            entryId: "item-entry:hidden:equipped",
            quantity: 1,
            condition: "usable",
            equippedSlot: "main",
          }],
        },
      }),
    ));
  });

  const buttons = () => renderer.root.findAllByType("button");
  const worn = buttons().find((button) => renderedText(button).includes("身上"));
  assert.ok(worn);
  await act(async () => worn.props.onClick());
  const mainHand = buttons().find((button) => renderedText(button).includes("主手"));
  assert.ok(mainHand);
  await act(async () => mainHand.props.onClick());

  const output = renderedText(renderer.root);
  assert.match(output, /数量 1 · 槽位 主手 · 状态 可用/);
  assert.match(output, /卸到背包/);
  assert.doesNotMatch(output, /使用|装备到|充能|耐久/);

  await act(async () => renderer.unmount());
  queryClient.clear();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

test("identified inventory displays projected charges and durability without attunement UI", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const queryClient = new QueryClient();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(InventoryPanel, {
        code: "ROOM",
        canEdit: true,
        inventory: {
          entries: [{
            kind: "identified",
            entryId: "item-entry:known:charged",
            name: "充能护符",
            description: "已辨明的测试物品。",
            category: "equipment",
            quantity: 1,
            condition: "usable",
            equippedSlot: null,
            charges: { current: 2, maximum: 3 },
            durability: { current: 4, maximum: 5 },
            allowedSlots: [],
            twoHanded: false,
            publicDamageText: null,
            activities: [],
          }],
        },
      }),
    ));
  });

  const buttons = () => renderer.root.findAllByType("button");
  const backpack = buttons().find((button) => renderedText(button).includes("背包"));
  assert.ok(backpack);
  await act(async () => backpack.props.onClick());
  const item = buttons().find((button) => renderedText(button).includes("充能护符"));
  assert.ok(item);
  await act(async () => item.props.onClick());

  const output = renderedText(renderer.root);
  assert.match(output, /充能 2\/3 · 耐久 4\/5/);
  assert.doesNotMatch(output, /同调/);

  await act(async () => renderer.unmount());
  queryClient.clear();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

test("inventory disclosures expose state and have no static-catalog fallback", async () => {
  const source = await readFile(
    new URL("app/_runtime/components/inventory-panel.tsx", root),
    "utf8",
  );
  assert.match(source, /aria-controls=\{panelId\}/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /role="region"/);
  assert.match(source, /min-h-11/);
  assert.match(source, /inventory === undefined/);
  assert.doesNotMatch(source, /itemById|allowedSlots\(/);
});

test("equipped and backpack controls share one in-flight gear action controller", async () => {
  const source = await readFile(
    new URL("app/_runtime/components/inventory-panel.tsx", root),
    "utf8",
  );
  const panel = source.slice(source.indexOf("export function InventoryPanel"));
  assert.match(panel, /const actions = useGearActions\(code, canEdit\)/);
  assert.match(panel, /<AuthoritativeGearSlots[^>]*actions=\{actions\}/s);
  assert.match(panel, /<AuthoritativeBackpack[^>]*actions=\{actions\}/s);
  assert.match(source, /if \(!canEdit \|\| inFlight\.current\) return/);
});
