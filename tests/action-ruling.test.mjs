import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeActionCheck,
  resolveActionRuling,
} from "../app/_runtime/lib/kp/action-ruling.ts";

const actor = {
  userId: "u1",
  name: "散木",
  inventory: {
    resources: { torch: 0, ration: 0 },
    itemIds: ["thieves-tools"],
  },
};

const cellar = {
  id: "cellar",
  name: "打开酒窖",
  environmentItems: [
    {
      id: "cellar-spare-torch",
      itemId: "torch",
      name: "备用火把",
      aliases: ["火把", "照明物"],
      availability: "plausible",
      quantity: 1,
      check: { ability: "int", skill: "investigation", dc: 10 },
    },
  ],
  physicalChallenges: [],
};

const shrine = {
  id: "shrine",
  name: "旧神龛",
  environmentItems: [],
  physicalChallenges: [
    {
      id: "move-stone-seat",
      name: "移动沉重的石座",
      aliases: ["石座", "神龛石座"],
      verbs: ["搬", "抬", "推", "挪", "拖", "移动"],
      ruling: "check",
      check: { ability: "str", skill: "athletics", dc: 14 },
    },
  ],
};

function decide(overrides = {}) {
  return resolveActionRuling({
    text: "",
    actor,
    scene: cellar,
    claimedSourceIds: [],
    reservedSourceIds: [],
    catalogItems: [
      { itemId: "thieves-tools", name: "盗贼工具", aliases: ["盗贼工具"] },
      { itemId: "crowbar", name: "撬棍", aliases: ["撬棍"] },
    ],
    proposal: null,
    ...overrides,
  });
}

test("inventory use is authoritative before the KP narrates", () => {
  const missing = decide({ text: "我点燃火把" });
  assert.equal(missing.kind, "refuse");
  assert.match(missing.speech, /没有火把/);

  const available = decide({
    text: "我拿出火把点燃",
    actor: {
      ...actor,
      inventory: { ...actor.inventory, resources: { torch: 1, ration: 0 } },
    },
  });
  assert.equal(available.kind, "allow");
  assert.deepEqual(available.effect, {
    type: "consume_resource",
    resource: "torch",
    quantity: 1,
  });
});

test("scene items resolve to allow, small check, or refuse", () => {
  const plausible = decide({ text: "我在酒窖找一根火把" });
  assert.equal(plausible.kind, "check");
  assert.deepEqual(plausible.check, {
    ability: "int",
    skill: "investigation",
    dc: 10,
    reason: "寻找可能存在的备用火把。",
  });
  assert.equal(plausible.effect?.type, "grant_item");
  assert.equal(plausible.effect?.sourceId, "cellar-spare-torch");

  const obvious = decide({
    text: "我拿一根墙上的火把",
    scene: {
      ...cellar,
      environmentItems: [
        { ...cellar.environmentItems[0], availability: "obvious" },
      ],
    },
  });
  assert.equal(obvious.kind, "allow");
  assert.equal(obvious.effect?.type, "grant_item");

  const absent = decide({
    text: "我找一把魔法长剑",
    proposal: {
      kind: "allow",
      intent: "find_item",
      sourceId: "imaginary-magic-sword",
    },
  });
  assert.equal(absent.kind, "refuse");
  assert.match(absent.speech, /没有可靠来源|不能凭空/);

  const unrelated = decide({
    text: "我贴着门听听里面的动静",
    proposal: {
      kind: "allow",
      intent: "find_item",
      sourceId: "cellar-spare-torch",
    },
  });
  assert.equal(unrelated.kind, "none");
});

test("claimed or reserved scene items cannot be duplicated", () => {
  const claimed = decide({
    text: "我找火把",
    claimedSourceIds: ["cellar-spare-torch"],
  });
  assert.equal(claimed.kind, "refuse");

  const reserved = decide({
    text: "我找火把",
    reservedSourceIds: ["cellar-spare-torch"],
  });
  assert.equal(reserved.kind, "refuse");
  assert.match(reserved.speech, /正在翻找/);
});

test("forceful actions use strength instead of investigation", () => {
  const cloth = decide({
    text: "我用手把厚布扯开",
    proposal: {
      kind: "check",
      intent: "physical",
      ability: "int",
      skill: "investigation",
      dc: 12,
    },
  });
  assert.equal(cloth.kind, "check");
  assert.equal(cloth.check.ability, "str");
  assert.equal(cloth.check.skill, "athletics");
  assert.equal(cloth.check.dc, 10);

  const stoneSeat = decide({
    text: "我试着搬开石座",
    scene: shrine,
    proposal: {
      kind: "allow",
      intent: "physical",
      sourceId: "move-stone-seat",
    },
  });
  assert.equal(stoneSeat.kind, "check");
  assert.deepEqual(stoneSeat.check, {
    ability: "str",
    skill: "athletics",
    dc: 14,
    reason: "尝试移动沉重的石座。",
  });
});

test("normalizes model-selected checks from the player's method", () => {
  const heard = normalizeActionCheck("我贴近门缝听听里面的动静", {
    kind: "check",
    ability: "int",
    skill: "investigation",
  });
  assert.equal(heard.ability, "wis");
  assert.equal(heard.skill, "perception");

  const searched = normalizeActionCheck("我翻找木箱，看看工具放在哪里", {
    kind: "check",
    ability: "wis",
    skill: "perception",
  });
  assert.equal(searched.ability, "int");
  assert.equal(searched.skill, "investigation");
});
