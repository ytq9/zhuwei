import assert from "node:assert/strict";
import test from "node:test";
import {
  compileSheet,
  draftIssues,
  isDraftSheet,
  normalizeDraftChoices,
  spellRequirement,
} from "../../../app/_runtime/lib/dnd/compute.ts";
import { WIZARD_SPELLS } from "../../../app/_runtime/lib/dnd/catalog.ts";

// ADR 0156: a card owes every choice SRD 5.1 (2014) gives a 3rd-level
// character -- the race's picks, a legal point buy, the class skills and the
// class's spells in their counts -- and the server and the wizard read the
// same list. SPEC 0004 §4 keeps its tool and Expertise choices in it.

const base = {
  name: "规则样例", raceId: "human", classId: "fighter", subclassId: "champion", backgroundId: "soldier",
  scores: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 },
  extraSkillIds: ["perception", "insight", "survival"], toolChoices: { background: "dice-set" },
  cantrips: [], prepared: [], spellbook: [], equipmentChoice: 0,
  appearance: "", trait: "", ideal: "", bond: "", flaw: "",
};
const texts = (draft) => draftIssues(draft).map((issue) => `${issue.step}:${issue.text}`);
const BOOK = WIZARD_SPELLS.filter((id) => id !== "web").slice(0, 10);
const wizard = { ...base, raceId: "high-elf", classId: "wizard", subclassId: "evocation", backgroundId: "sage",
  scores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, extraSkillIds: ["investigation", "insight"], toolChoices: {},
  cantrips: ["fire-bolt", "mage-hand", "light"], spellbook: BOOK, prepared: BOOK.slice(0, 6) };

test("a complete card owes nothing, and an empty one names each thing in its step", () => {
  assert.deepEqual(draftIssues(base), []);
  assert.deepEqual(draftIssues(wizard), []);
  assert.deepEqual(texts({ ...base, name: " ", extraSkillIds: [], toolChoices: undefined }), [
    "background:选背景给的一种赌具",
    "skills:再选 3 项技能",
    "identity:填写姓名",
  ]);
});

test("a half-elf picks two abilities other than Charisma to raise by 1", () => {
  const halfElf = { ...base, raceId: "half-elf", extraSkillIds: ["perception", "insight", "arcana", "stealth"] };
  assert.deepEqual(texts(halfElf), ["race:选半精灵另外两项各 +1 的属性"]);
  assert.deepEqual(texts({ ...halfElf, halfElfPicks: ["cha", "dex"] }), ["race:选半精灵另外两项各 +1 的属性"]);
  const picked = { ...halfElf, halfElfPicks: ["dex", "con"] };
  assert.deepEqual(draftIssues(picked), []);
  const sheet = compileSheet(picked);
  assert.deepEqual([sheet.scores.cha, sheet.scores.dex, sheet.scores.con, sheet.scores.str], [14, 14, 15, 15]);
  // Another race drops the picks.
  assert.equal(normalizeDraftChoices({ ...picked, raceId: "human" }).halfElfPicks, undefined);
});

test("a dragonborn picks an ancestry, which names its breath and resistance", () => {
  const dragonborn = { ...base, raceId: "dragonborn", extraSkillIds: ["perception", "insight"] };
  assert.deepEqual(texts(dragonborn), ["race:选龙种"]);
  const sheet = compileSheet({ ...dragonborn, dragonAncestry: "silver" });
  assert.equal(sheet.dragonAncestry, "silver");
  assert.ok(sheet.features.includes("龙种：银龙"));
  assert.ok(sheet.features.some((line) => /15 尺锥形，体质豁免.*2d6 寒冷伤害/.test(line)), sheet.features.join("\n"));
  assert.ok(sheet.features.includes("寒冷伤害抗性"));
});

test("a class without spellcasting picks no spells; a high elf's own cantrip comes with the race", () => {
  const fighter = { ...base, raceId: "high-elf", extraSkillIds: ["insight", "survival"] };
  assert.equal(spellRequirement(fighter), null);
  assert.deepEqual(draftIssues(fighter), []);
  assert.deepEqual(texts({ ...fighter, cantrips: ["fire-bolt", "mage-hand", "light"] }), ["spells:这个职业不选法术"]);
  // The cantrips the wizard once let a fighter take are dropped.
  assert.deepEqual(compileSheet({ ...fighter, cantrips: ["fire-bolt", "mage-hand", "light"] }).cantrips, ["prestidigitation"]);
});

test("a 3rd-level wizard keeps 10 spells in its book and prepares Intelligence modifier + 3 of them", () => {
  const need = spellRequirement(wizard);
  assert.deepEqual([need.cantrips.count, need.spellbook.count, need.prepared.count], [3, 10, 6]);
  // A high elf's Prestidigitation is not one of its three class cantrips.
  assert.equal(need.cantrips.pool.includes("prestidigitation"), false);
  assert.deepEqual(texts({ ...wizard, spellbook: BOOK.slice(0, 8), prepared: BOOK.slice(0, 6) }), ["spells:再选 2 个法术书里的法术"]);
  // A spell prepared from outside the book is not kept.
  const outside = { ...wizard, prepared: [...BOOK.slice(0, 5), "web"] };
  assert.deepEqual(texts(outside), ["spells:去掉不能选或多选的准备的法术"]);
  assert.deepEqual(normalizeDraftChoices(outside).prepared, BOOK.slice(0, 5));
  assert.deepEqual(compileSheet(wizard).prepared, BOOK.slice(0, 6));
});

test("a ranger's known spells are its prepared list, so they reach the game", () => {
  const ranger = { ...base, classId: "ranger", subclassId: "hunter", backgroundId: "outlander",
    scores: { str: 10, dex: 15, con: 13, int: 10, wis: 14, cha: 8 }, extraSkillIds: ["insight", "investigation", "nature", "perception"],
    toolChoices: {}, prepared: ["fog", "cure", "hunters-mark"] };
  assert.deepEqual(texts(ranger), []);
  assert.deepEqual(compileSheet(ranger).prepared, ["fog", "cure", "hunters-mark"]);
  // A ranger draft from the old wizard kept them in its spellbook.
  const old = normalizeDraftChoices({ ...ranger, prepared: [], spellbook: ["fog", "cure", "hunters-mark"] });
  assert.deepEqual([old.prepared, old.spellbook], [["fog", "cure", "hunters-mark"], []]);
});

test("the point buy stays within 27 and class skills come from the class list", () => {
  assert.deepEqual(texts({ ...base, scores: { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 } }), [], "exactly 27 points");
  assert.deepEqual(texts({ ...base, scores: { str: 15, dex: 15, con: 15, int: 10, wis: 8, cha: 8 } }), ["scores:点买超出 2 点（上限 27 点）"]);
  assert.deepEqual(texts({ ...base, scores: { ...base.scores, str: 17 } }), ["scores:把每项属性的点买基础定在 8 到 15 之间"]);
  // A human fighter: two from the fighter list and one of any.
  assert.deepEqual(texts({ ...base, extraSkillIds: ["arcana", "stealth", "perception"] }), ["skills:职业技能表以外的技能最多选 1 项"]);
  assert.deepEqual(texts({ ...base, extraSkillIds: ["athletics", "perception", "insight"] }), ["skills:去掉重复或已经熟练的技能"]);
  assert.deepEqual(texts({ ...base, extraSkillIds: ["arcana", "perception", "insight"] }), []);
});

test("the server's shape check refuses what is not a wizard draft", () => {
  assert.equal(isDraftSheet(base), true);
  assert.equal(isDraftSheet(wizard), true);
  for (const bad of [
    { ...base, sceneId: "secret" },
    { ...base, raceId: "invented" },
    { ...base, scores: { ...base.scores, str: 15.5 } },
    { ...base, extraSkillIds: ["flying"] },
    { ...base, cantrips: ["wish"] },
    { ...base, halfElfPicks: ["str", "dex", "con"] },
    { ...base, dragonAncestry: "purple" },
    { ...base, equipmentChoice: 9 },
    { ...base, toolChoices: { background: "lute" } },
  ]) assert.equal(isDraftSheet(bad), false, JSON.stringify(bad).slice(0, 120));
});
