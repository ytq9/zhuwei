import assert from "node:assert/strict";
import test from "node:test";
import {
  compileSheet,
  expertiseChoice,
  grantedSkills,
  kitProficiencyGaps,
  normalizeDraftChoices,
  pendingDraftChoices,
  sheetProficiencies,
} from "../../../app/_runtime/lib/dnd/compute.ts";
import {
  armorProficiencies,
  toolChoiceOptions,
  toolProficiencies,
  weaponProficiencies,
} from "../../../app/_runtime/lib/dnd/catalog.ts";

// SPEC 0004 §4: the builder's tool, Expertise and starting-kit choices go
// through the same catalog grants compileSheet and the room seed derive from.

const base = {
  name: "熟练样例", scores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
  cantrips: [], prepared: [], spellbook: [], equipmentChoice: 0,
  appearance: "", trait: "", ideal: "", bond: "", flaw: "",
};
const ids = (entries) => entries.map((entry) => entry.id);

test("a criminal rogue picks a gaming set and Expertise in a skill and thieves' tools", () => {
  const draft = { ...base, raceId: "human", classId: "rogue", subclassId: "thief", backgroundId: "criminal",
    extraSkillIds: ["acrobatics", "sleight", "perception", "investigation", "insight"],
    toolChoices: { background: "dice-set" }, expertiseIds: ["stealth", "thieves-tools"] };
  assert.deepEqual(pendingDraftChoices(draft), []);
  const choice = expertiseChoice(draft);
  assert.equal(choice.source, "class");
  assert.equal(choice.count, 2);
  // The rogue's own skills (background and picks) and thieves' tools.
  assert.deepEqual(choice.options, ["acrobatics", "sleight", "stealth", "investigation", "insight", "perception",
    "deception", "thieves-tools"]);
  const sheet = compileSheet(draft);
  assert.deepEqual(sheet.expertise, ["stealth", "thieves-tools"]);
  assert.deepEqual(sheet.toolChoices, { background: "dice-set" });
  assert.deepEqual(toolProficiencies(sheet), ["dice-set", "thieves-tools"]);
  assert.deepEqual(armorProficiencies(sheet), ["light"]);
  assert.ok(weaponProficiencies(sheet).includes("rapier"));
  const shown = sheetProficiencies(sheet);
  assert.deepEqual(shown.tools, [
    { id: "thieves-tools", label: "盗贼工具", expertise: true },
    { id: "dice-set", label: "骰子", expertise: false },
  ]);
  assert.deepEqual(ids(shown.weapons), ["simple", "hand-crossbow", "longsword", "rapier", "shortsword"]);
  assert.deepEqual(ids(shown.armor), ["light"]);
  assert.deepEqual(kitProficiencyGaps(draft), [[], []]);

  // Two skills is the other form of the rogue's Expertise.
  assert.deepEqual(compileSheet({ ...draft, expertiseIds: ["sleight", "deception"] }).expertise, ["sleight", "deception"]);
  // Unpicked: the gaming set and one Expertise are still owed, on their steps.
  assert.deepEqual(pendingDraftChoices({ ...draft, toolChoices: {}, expertiseIds: ["stealth"] }), [
    { step: "background", text: "背景给的一种赌具" },
    { step: "skills", text: "1 项专精" },
  ]);
  // A skill no longer picked drops out of the Expertise.
  const unpicked = normalizeDraftChoices({ ...draft, expertiseIds: ["acrobatics", "thieves-tools"],
    extraSkillIds: ["sleight", "perception", "investigation", "insight"] });
  assert.deepEqual(unpicked.expertiseIds, ["thieves-tools"]);
});

test("a hill dwarf Knowledge cleric picks a race tool and two Knowledge skills, and the chain mail kit is refused", () => {
  const draft = { ...base, raceId: "hill-dwarf", classId: "cleric", subclassId: "knowledge", backgroundId: "acolyte",
    extraSkillIds: ["medicine", "persuasion"], toolChoices: { race: "smiths-tools" }, expertiseIds: ["arcana", "history"] };
  assert.deepEqual(toolChoiceOptions(draft), { race: ["smiths-tools", "brewers-supplies", "masons-tools"] });
  assert.deepEqual(pendingDraftChoices(draft), []);
  assert.deepEqual(expertiseChoice(draft), { source: "subclass", options: ["arcana", "history", "nature", "religion"], count: 2 });
  assert.deepEqual(grantedSkills(draft), ["arcana", "history", "religion", "insight"]);
  const sheet = compileSheet(draft);
  assert.deepEqual(sheet.expertise, ["arcana", "history"]);
  for (const skill of ["arcana", "history", "insight", "religion", "medicine", "persuasion"]) assert.ok(sheet.skills.includes(skill), skill);
  assert.deepEqual(sheet.toolChoices, { race: "smiths-tools" });
  assert.deepEqual(ids(sheetProficiencies(sheet).tools), ["smiths-tools"]);
  assert.deepEqual(ids(sheetProficiencies(sheet).weapons), ["simple", "battleaxe", "handaxe", "light-hammer", "warhammer"]);
  assert.deepEqual(ids(sheetProficiencies(sheet).armor), ["light", "medium", "shield"]);
  // Kit 1 (chain mail) needs heavy armor; the dwarf's warhammer training allows kit 2.
  assert.deepEqual(kitProficiencyGaps(draft), [["链甲"], [], []]);
  assert.equal(normalizeDraftChoices(draft).equipmentChoice, 1);
  assert.deepEqual(pendingDraftChoices({ ...draft, toolChoices: undefined, expertiseIds: [] }), [
    { step: "race", text: "种族给的一种工匠工具" },
    { step: "class", text: "2 项专精" },
  ]);
});

test("a mountain dwarf battle master picks tools from race, subclass and background", () => {
  const draft = { ...base, raceId: "mountain-dwarf", classId: "fighter", subclassId: "battlemaster", backgroundId: "soldier",
    extraSkillIds: ["perception", "survival"],
    toolChoices: { race: "brewers-supplies", subclass: "carpenters-tools", background: "playing-card-set" } };
  assert.deepEqual(pendingDraftChoices(draft), []);
  assert.equal(expertiseChoice(draft), undefined);
  const sheet = compileSheet(draft);
  assert.deepEqual(sheet.expertise, []);
  assert.deepEqual(sheet.toolChoices, draft.toolChoices);
  assert.deepEqual(toolProficiencies(sheet), ["brewers-supplies", "carpenters-tools", "land-vehicles", "playing-card-set"]);
  assert.deepEqual(ids(sheetProficiencies(sheet).armor), ["light", "medium", "heavy", "shield"]);
  assert.deepEqual(kitProficiencyGaps(draft), [[], []]);
  // A battle master's tool is an artisan's tool: a gaming set is not offered there.
  const wrong = { ...draft, toolChoices: { ...draft.toolChoices, subclass: "dice-set" } };
  assert.deepEqual(compileSheet(wrong).toolChoices, { race: "brewers-supplies", background: "playing-card-set" });
  assert.deepEqual(pendingDraftChoices(wrong), [{ step: "class", text: "子职给的一种工匠工具" }]);
  // Another subclass drops the battle master's tool.
  assert.deepEqual(normalizeDraftChoices({ ...draft, subclassId: "champion" }).toolChoices,
    { race: "brewers-supplies", background: "playing-card-set" });
});

test("a cleric without heavy armor or martial weapons is refused the kits that need them", () => {
  const knowledge = { ...base, raceId: "human", classId: "cleric", subclassId: "knowledge", backgroundId: "sage",
    extraSkillIds: ["insight", "medicine", "persuasion"], expertiseIds: ["nature", "religion"] };
  // The third kit, scale mail and a mace, suits every domain.
  assert.deepEqual(kitProficiencyGaps(knowledge), [["链甲"], ["战锤"], []]);
  assert.equal(normalizeDraftChoices({ ...knowledge, equipmentChoice: 1 }).equipmentChoice, 2);
  // Life domain adds heavy armor; War adds martial weapons too.
  assert.deepEqual(kitProficiencyGaps({ ...knowledge, subclassId: "life" }), [[], ["战锤"], []]);
  assert.equal(normalizeDraftChoices({ ...knowledge, subclassId: "life", equipmentChoice: 1, expertiseIds: [] }).equipmentChoice, 0);
  assert.deepEqual(kitProficiencyGaps({ ...knowledge, subclassId: "war" }), [[], [], []]);
});

test("an older sheet without tool choices shows the tools its grants fix", () => {
  const older = { classId: "rogue", raceId: "human", subclassId: "thief", backgroundId: "criminal", expertise: ["stealth", "sleight"] };
  assert.deepEqual(sheetProficiencies(older).tools, [{ id: "thieves-tools", label: "盗贼工具", expertise: false }]);
  assert.deepEqual(sheetProficiencies({ ...older, expertise: undefined }).tools[0].expertise, false);
});
