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
} from "../../../app/_runtime/components/inventory-panel.tsx";

const root = new URL("../../../", import.meta.url);

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
  // The backpack is open; an unidentified item sits in its own group.
  assert.ok(renderer.root.findByProps({ "data-inventory-group": "opaque" }));
  const opaqueItem = buttons().find((button) => renderedText(button).includes("未辨明物品"));
  assert.ok(opaqueItem);
  await act(async () => opaqueItem.props.onClick());

  const output = renderedText(renderer.root);
  assert.match(output, /未辨明物品/);
  assert.match(output, /数量 3 · 槽位 背包 · 状态 已损坏/);
  assert.doesNotMatch(output, /使用|装到|卸下|说出来/);
  for (const marker of ["data-inventory-use", "data-inventory-wear", "data-inventory-stow", "data-inventory-say"]) {
    assert.equal(renderer.root.findAll((node) => node.props[marker] !== undefined).length, 0, marker);
  }
  assert.deepEqual(buttons().map((button) => renderedText(button)).filter((label) => !label.includes("未辨明物品")),
    ["其他槽位9 个空着"], "opaque entries add no use, equip, stow or sentence buttons");

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
  const mainHand = buttons().find((button) => renderedText(button).includes("主手"));
  assert.ok(mainHand);
  await act(async () => mainHand.props.onClick());

  const output = renderedText(renderer.root);
  assert.match(output, /数量 1 · 槽位 主手 · 状态 可用/);
  assert.ok(renderer.root.findByProps({ "data-inventory-stow": "item-entry:hidden:equipped" }));
  assert.doesNotMatch(output, /使用|装到|充能|耐久/);
  assert.equal(renderer.root.findAll((node) => node.props["data-inventory-wear"] !== undefined).length, 0);

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

test('closed container history shows last observed quantity without item controls', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const queryClient = new QueryClient(); let renderer;
  await act(async () => {
    renderer = TestRenderer.create(createElement(QueryClientProvider, { client: queryClient }, createElement(InventoryPanel, {
      code: 'ROOM', canEdit: true, inventory: { entries: [{ kind: 'opaque', entryId: 'item-entry:box', quantity: 1, condition: 'usable', equippedSlot: null }],
        containerMemories: [{ containerRef: 'item-entry:box', observerRef: 'character:alice', eventSeq: '1',
          entries: [{ entryId: 'item-entry:old-potion', name: '药剂', quantity: 2, condition: 'usable' }] }] },
    })));
  });
  const history = renderer.root.findAllByType('button').find(button => renderedText(button).includes('上次查看'));
  assert.ok(history); await act(async () => history.props.onClick());
  const output = renderedText(renderer.root);
  assert.match(output, /重新打开后更新/); assert.match(output, /药剂 ×2/);
  assert.doesNotMatch(output, /使用|装备到|卸到背包/);
  await act(async () => renderer.unmount()); queryClient.clear(); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

function identified(entryId, name, category, extra = {}) {
  return {
    kind: "identified", entryId, name, description: `${name}。`, category, quantity: 1, condition: "usable",
    equippedSlot: null, charges: null, durability: null, allowedSlots: [], twoHanded: false, publicDamageText: null,
    activities: [], ...extra,
  };
}

// SPEC 0010 §7 (ADR 0146): worn items first with the main hand, off hand and
// armor always shown, the backpack grouped with coins on top; equipping,
// stowing and using go to Rules from the row, a refusal stays under its item,
// and anything else is a sentence put in the composer.
test("the inventory groups the pack, acts from the row, keeps a refusal by its item and drafts sentences", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const { command, data } = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ command, data });
    const body = command === "useInventoryItem"
      ? { ok: false, action: "notCommitted", error: "战斗中喝药要用一个动作，你这回合的动作已经用掉了。" }
      : { action: "committed", narration: "notApplicable" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const drafts = [];
  const queryClient = new QueryClient();
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(createElement(QueryClientProvider, { client: queryClient }, createElement(InventoryPanel, {
        code: "ROOM",
        canEdit: true,
        onDraft: (sentence) => drafts.push(sentence),
        inventory: { entries: [
          identified("item-entry:sword", "长剑", "weapon", { equippedSlot: "main", allowedSlots: ["main", "off"], publicDamageText: "1d8 挥砍" }),
          identified("item-entry:shield", "盾牌", "shield", { allowedSlots: ["off"] }),
          identified("item-entry:potion", "治疗药水", "consumable", { quantity: 2,
            activities: [{ activityId: "use", label: "使用", enabled: true, disabledReason: null }] }),
          identified("item-entry:gold", "金币", "currency", { quantity: 15 }),
          identified("item-entry:rope", "麻绳（50 尺）", "equipment"),
        ] },
      })));
    });
    const one = (props) => renderer.root.findByProps(props);
    const press = async (props) => {
      const node = one(props);
      await act(async () => { node.props.onClick(); for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setTimeout(resolve, 0)); });
    };

    // Main hand, off hand and armor are always there; the other empty slots fold into one line.
    assert.deepEqual(renderer.root.findAll((node) => node.props["data-inventory-slot"] !== undefined)
      .map((node) => node.props["data-inventory-slot"]), ["off", "armor"]);
    assert.match(renderedText(one({ "data-inventory-entry": "item-entry:sword" })), /主手长剑/);
    assert.deepEqual(renderer.root.findAll((node) => node.props["data-inventory-group"] !== undefined && typeof node.type === "string")
      .map((node) => node.props["data-inventory-group"]), ["currency", "armor", "consumable", "other"]);

    await press({ "data-inventory-wear": "item-entry:shield:off" });
    assert.deepEqual([calls.at(-1).command, calls.at(-1).data.action, calls.at(-1).data.slot, calls.at(-1).data.itemId],
      ["setGear", "wear", "off", "item-entry:shield"]);
    await press({ "data-inventory-stow": "item-entry:sword" });
    assert.deepEqual([calls.at(-1).command, calls.at(-1).data.action, calls.at(-1).data.slot, calls.at(-1).data.itemId],
      ["setGear", "stow", "main", undefined]);

    await press({ "data-inventory-use": "item-entry:potion" });
    assert.deepEqual([calls.at(-1).command, calls.at(-1).data.itemEntryId], ["useInventoryItem", "item-entry:potion"]);
    const refused = one({ "data-inventory-entry": "item-entry:potion" });
    assert.match(renderedText(refused.findByProps({ "data-inventory-failure": true })), /动作已经用掉了/);
    assert.equal(renderer.root.findAll((node) => node.props["data-inventory-failure"] !== undefined && typeof node.type === "string").length, 1);

    const rope = one({ "data-inventory-entry": "item-entry:rope" });
    const ropeTrigger = rope.findAll((node) => node.type === "button" && node.props["aria-expanded"] !== undefined)[0];
    await act(async () => ropeTrigger.props.onClick());
    await press({ "data-inventory-say": "交给…" });
    assert.deepEqual(drafts, ["我把麻绳（50 尺）交给"]);
    assert.equal(calls.length, 3, "a sentence sends nothing by itself");
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    queryClient.clear();
    globalThis.fetch = originalFetch;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
