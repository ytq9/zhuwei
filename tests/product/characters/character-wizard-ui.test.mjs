import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";

// ADR 0156: the wizard asks for what the card owes, step by step, from the
// same list the server checks, and locks only a complete card.

function text(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node?.children?.map(text).join("") ?? "";
}

async function wizard(initial) {
  const [{ CharacterWizard }, { act, create }] = await Promise.all([
    import("../../../app/_runtime/components/character-wizard.tsx"),
    import("react-test-renderer"),
  ]);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const locked = [];
  let renderer;
  await act(async () => {
    renderer = create(createElement(CharacterWizard, { initial, onLock: (draft) => locked.push(draft) }));
  });
  const buttons = () => renderer.root.findAll((node) => node.type === "button");
  // A card's button reads its title then its summary; it is found by its title.
  const button = (label) => {
    const found = buttons().find((node) => text(node) === label)
      ?? buttons().find((node) => !node.props.className?.includes("rounded-full") && text(node).startsWith(label) && label.length >= 2
        && buttons().filter((other) => text(other).startsWith(label)).length === 1);
    assert.ok(found, `no button ${label}: ${buttons().map(text).join(" | ")}`);
    return found;
  };
  const click = async (node) => { await act(async () => { node.props.onClick(); }); };
  return {
    renderer, locked, button, click,
    step: (label) => click(button(label)),
    steps: () => buttons().filter((node) => node.props.className?.includes("rounded-full")).map(text),
    find: (attribute) => renderer.root.findAll((node) => typeof node.type === "string" && node.props[attribute] !== undefined),
    close: async () => { await act(async () => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; },
  };
}

test("a fighter has no spell step, even as a high elf, and locks only once nothing is owed", async () => {
  const ui = await wizard();
  try {
    assert.equal(ui.steps().includes("法术"), false);
    await ui.click(ui.button("高精灵"));
    assert.equal(ui.steps().includes("法术"), false, "a high elf's cantrip comes with the race");
    await ui.step("总览");
    assert.match(text(ui.find("data-wizard-issues")[0]), /锁定前还要：.*再选 \d 项技能.*填写姓名/);
    assert.equal(ui.button("锁定人物卡").props.disabled, true);
    // The skills step names what it still needs and holds the next step.
    await ui.step("技能");
    assert.match(text(ui.find("data-wizard-step-issues")[0]), /这一步还要：再选/);
    assert.equal(ui.button("下一步").props.disabled, true);
  } finally {
    await ui.close();
  }
});

test("a half-elf picks its two +1 abilities and a dragonborn its ancestry on the race step", async () => {
  const ui = await wizard();
  try {
    await ui.click(ui.button("半精灵"));
    assert.match(text(ui.renderer.root), /属性：另外两项各 \+1/);
    assert.match(text(ui.find("data-wizard-step-issues")[0]), /选半精灵另外两项各 \+1 的属性/);
    await ui.click(ui.button("龙裔"));
    assert.match(text(ui.renderer.root), /龙种/);
    await ui.click(ui.button("红龙 · 火焰 · 15 尺锥形（敏捷豁免）"));
    assert.equal(ui.find("data-wizard-step-issues").length, 0);
  } finally {
    await ui.close();
  }
});

test("a wizard fills its spellbook with 10 spells before it prepares from it", async () => {
  const ui = await wizard({ name: "书", raceId: "human", classId: "wizard", subclassId: "evocation", backgroundId: "sage",
    scores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, extraSkillIds: [], cantrips: [], prepared: [], spellbook: [],
    equipmentChoice: 0, appearance: "", trait: "", ideal: "", bond: "", flaw: "" });
  try {
    await ui.step("法术");
    assert.match(text(ui.renderer.root), /法术书（0\/10）/);
    assert.match(text(ui.renderer.root), /先在上面的法术书里选法术，再从书里准备。/);
    const spells = () => ui.find("data-wizard-spell");
    // Only cantrips and the book are offered until the book has spells.
    assert.equal(spells().filter((node) => node.props["data-wizard-spell"] === "magic-missile").length, 1);
    await ui.click(spells().find((node) => node.props["data-wizard-spell"] === "magic-missile"));
    assert.equal(spells().filter((node) => node.props["data-wizard-spell"] === "magic-missile").length, 2,
      "a spell in the book can now be prepared");
  } finally {
    await ui.close();
  }
});
