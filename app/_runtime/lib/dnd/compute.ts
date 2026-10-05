import { abilityMod } from "@/lib/utils";
import {
  BACKGROUNDS,
  CLASSES,
  CLASS_KITS,
  RACES,
  SPELLS,
  armorProficiencies,
  backgroundById,
  classById,
  listFreeBoosts,
  raceById,
  toolChoiceOptions,
  toolProficiencies,
  uniqueSpellIds,
  validToolChoices,
  weaponProficiencies,
  type ProficiencySource,
} from "./catalog";
import { spellDefinition } from "../rules/spell-catalog";
import type { SpellcastingProfile } from "../rules/spell-model";
import { acFromGear, itemById, kitToGear, wornSummary, packSummary } from "./gear";
import { initResources, ensureResources, resourceLine } from "./resources";
import {
  ABILITIES,
  ARMOR_PROFICIENCIES,
  type Ability,
  type AbilityScores,
  type CharacterSheet,
  type DraftSheet,
  type SkillId,
  SKILLS,
  TOOLS,
  TOOL_CHOICE_SOURCES,
  type ToolChoiceSource,
  type ToolId,
  type ToolKind,
  WEAPON_PROFICIENCIES,
} from "./types";

export function spellcastingAbility(
  sheet: Pick<CharacterSheet, "classId" | "raceId">,
  spellId?: string,
): Ability {
  if (sheet.raceId === "high-elf" && spellId === "prestidigitation" && sheet.classId !== "wizard") {
    return "int";
  }
  if (sheet.raceId === "tiefling" && (spellId === "thaumaturgy" || spellId === "hellish-rebuke")) {
    return "cha";
  }
  const kind = classById(sheet.classId)?.spellcasting;
  if (kind === "wizard") return "int";
  if (kind === "cleric" || kind === "ranger") return "wis";
  return "wis";
}

export function casterMod(sheet: CharacterSheet, spellId?: string) {
  const ab = spellcastingAbility(sheet, spellId);
  return { ability: ab, mod: abilityMod(sheet.scores?.[ab] ?? 10) };
}

export function spellcastingProfile(
  sheet: CharacterSheet,
  spellId: string,
): SpellcastingProfile | undefined {
  if (!spellDefinition(spellId)) return undefined;
  const { ability, mod } = casterMod(sheet, spellId);
  return {
    ability,
    castingModifier: mod,
    attackBonus: sheet.proficiency + mod,
    saveDc: 8 + sheet.proficiency + mod,
  };
}

export const POINT_COST: Record<number, number> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
};

export function pointsSpent(scores: AbilityScores) {
  return ABILITIES.reduce((n, a) => n + (POINT_COST[scores[a]] ?? 99), 0);
}

export function racialBonuses(
  raceId: string,
  halfElfPicks?: Ability[],
): Partial<Record<Ability, number>> {
  const race = raceById(raceId);
  if (!race) return {};
  if (race.bonuses === "all1") {
    return { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 };
  }
  if (race.bonuses === "halfElf") {
    const extra: Partial<Record<Ability, number>> = { cha: 2 };
    for (const a of halfElfPicks ?? []) {
      if (a !== "cha") extra[a] = (extra[a] ?? 0) + 1;
    }
    return extra;
  }
  return race.bonuses;
}

export function finalScores(
  base: AbilityScores,
  raceId: string,
  halfElfPicks?: Ability[],
): AbilityScores {
  const b = racialBonuses(raceId, halfElfPicks);
  const out = { ...base };
  for (const a of ABILITIES) out[a] = base[a] + (b[a] ?? 0);
  return out;
}

export function skillBonus(
  sheet: Pick<CharacterSheet, "scores" | "skills" | "expertise" | "proficiency">,
  skillId: SkillId,
) {
  const skill = SKILLS.find((s) => s.id === skillId);
  if (!skill) return 0;
  const mod = abilityMod(sheet.scores[skill.ability]);
  const prof = sheet.skills.includes(skillId) ? sheet.proficiency : 0;
  const exp = sheet.expertise.includes(skillId) ? sheet.proficiency : 0;
  return mod + prof + exp;
}

function unarmoredAc(classId: string, scores: AbilityScores) {
  const dex = abilityMod(scores.dex);
  const con = abilityMod(scores.con);
  if (classId === "barbarian") return 10 + dex + con;
  if (classId === "wizard") return 10 + dex;
  return 10 + dex;
}

function armorFromKit(kit: string[], classId: string, scores: AbilityScores) {
  const dex = abilityMod(scores.dex);
  const joined = kit.join(" ");
  let ac = unarmoredAc(classId, scores);
  if (joined.includes("链甲")) ac = 16;
  else if (joined.includes("鳞甲")) ac = 14 + Math.min(dex, 2);
  else if (joined.includes("皮甲")) ac = 11 + dex;
  if (joined.includes("盾牌")) ac += 2;
  if (classId === "fighter") ac += 1; // 防御战斗风格
  return ac;
}

function maxHp(classId: string, conMod: number, raceId: string) {
  const cls = classById(classId);
  const die = cls?.hitDie ?? 8;
  const avg = Math.floor(die / 2) + 1;
  let hp = die + conMod + 2 * (avg + conMod);
  if (raceId === "hill-dwarf") hp += 3;
  return Math.max(hp, 4);
}

export function lockedSkills(draft: Pick<DraftSheet, "classId" | "backgroundId" | "raceId">) {
  const bg = BACKGROUNDS.find((b) => b.id === draft.backgroundId);
  const race = RACES.find((r) => r.id === draft.raceId);
  const fromBg = bg?.skills ?? [];
  const extra = race?.extraSkills ?? 0;
  return { fromBg, extra };
}

/** `count` of `options`: those `picked` names first, then the rest in order. */
function pickUpTo<T extends string>(options: readonly T[], picked: readonly string[], count: number): T[] {
  const chosen = [...new Set(picked)].filter((id): id is T => (options as readonly string[]).includes(id));
  return [...chosen, ...options.filter((id) => !chosen.includes(id))].slice(0, count);
}

export function compileSheet(draft: DraftSheet): CharacterSheet {
  const cls = classById(draft.classId) ?? CLASSES[0];
  const race = raceById(draft.raceId) ?? RACES[0];
  const bg = BACKGROUNDS.find((b) => b.id === draft.backgroundId);
  const scores = finalScores(draft.scores, draft.raceId);
  const kits = CLASS_KITS[cls.id] ?? [[]];
  const kit = kits[Math.min(draft.equipmentChoice, kits.length - 1)] ?? kits[0];
  const equipment = [...kit, ...(bg?.equipment ?? [])];
  const subclass = cls.subclasses.find((s) => s.id === draft.subclassId) ?? cls.subclasses[0];
  // SPEC 0004 §4: the Knowledge domain makes two of its skills proficient
  // with Expertise; a rogue's Expertise is two of its skills, or one and
  // thieves' tools. A draft that picks too few takes the first options.
  const picked = draft.expertiseIds ?? [];
  const knowledge = subclass?.skillExpertiseChoice;
  const knowledgeSkills = knowledge === undefined ? [] : pickUpTo(knowledge.from, picked, knowledge.count);
  const skills = Array.from(
    new Set<SkillId>([...(bg?.skills ?? []), ...(race.skillProficiencies ?? []), ...draft.extraSkillIds, ...knowledgeSkills]),
  );
  const expertise: (SkillId | ToolId)[] = knowledge !== undefined ? knowledgeSkills
    : cls.expertiseChoice === undefined ? []
    : pickUpTo<SkillId | ToolId>([...skills, ...cls.expertiseChoice.tools], picked, cls.expertiseChoice.count);
  const toolChoices = validToolChoices({ classId: cls.id, raceId: race.id, subclassId: subclass?.id,
    backgroundId: bg?.id, toolChoices: draft.toolChoices });

  const hpMax = maxHp(cls.id, abilityMod(scores.con), race.id);
  const gear = kitToGear(equipment);
  const ac = acFromGear(cls.id, scores, gear.equipped);
  const features = [
    ...race.traits,
    ...cls.features,
    ...(subclass?.features ?? []),
  ];
  const cantrips = [...draft.cantrips];
  if (race.extraCantrip && !cantrips.includes("prestidigitation")) {
    cantrips.push("prestidigitation");
  }
  if (race.id === "tiefling" && !cantrips.includes("thaumaturgy")) {
    cantrips.push("thaumaturgy");
  }

  return {
    name: draft.name.trim() || "未名冒险者",
    raceId: race.id,
    classId: cls.id,
    subclassId: subclass?.id ?? cls.subclasses[0]?.id ?? "",
    backgroundId: bg?.id ?? "",
    level: 3,
    scores,
    skills,
    expertise,
    toolChoices,
    cantrips,
    prepared: draft.prepared,
    spellbook: draft.spellbook,
    equipment,
    equipped: gear.equipped,
    backpack: gear.backpack,
    appearance: draft.appearance,
    trait: draft.trait,
    ideal: draft.ideal,
    bond: draft.bond,
    flaw: draft.flaw,
    hp: { current: hpMax, max: hpMax, temp: 0 },
    ac,
    speed: race.speed,
    proficiency: 2,
    deathSaves: { success: 0, fail: 0 },
    conditions: [],
    inspiration: false,
    features,
    resources: initResources({
      classId: cls.id,
      subclassId: subclass?.id ?? "",
      raceId: race.id,
      scores,
      equipment,
      backpack: gear.backpack,
      equipped: gear.equipped,
    }),
  };
}

export function sheetSummary(sheet: CharacterSheet) {
  const race = raceById(sheet.raceId)?.name ?? "";
  const cls = classById(sheet.classId)?.name ?? "";
  const sub =
    classById(sheet.classId)?.subclasses.find((s) => s.id === sheet.subclassId)
      ?.name ?? "";
  return `${sheet.name} · ${race}${cls}（${sub}）3 级`;
}

export function describeSheetForKp(sheet: CharacterSheet) {
  const race = raceById(sheet.raceId)?.name ?? "";
  const cls = classById(sheet.classId)?.name ?? "";
  const mods = ABILITIES.map(
    (a) =>
      `${{ str: "力量", dex: "敏捷", con: "体质", int: "智力", wis: "感知", cha: "魅力" }[a]} ${sheet.scores[a]}（${abilityMod(sheet.scores[a]) >= 0 ? "+" : ""}${abilityMod(sheet.scores[a])}）`,
  ).join("，");
  const skillLine = SKILLS.filter((s) => sheet.skills.includes(s.id))
    .map((s) => {
      const b = skillBonus(sheet, s.id);
      return `${s.label}${b >= 0 ? "+" : ""}${b}`;
    })
    .join("、");
  const spells = uniqueSpellIds(sheet)
    .map((id) => {
      const sp = SPELLS.find((s) => s.id === id);
      if (!sp) return "";
      const ring = sp.level === 0 ? "戏法" : `${sp.level}环`;
      const meta = [sp.time, sp.range, sp.duration].filter(Boolean).join("，");
      return `- ${sp.name}（${ring}${meta ? "，" + meta : ""}）：${sp.text}`;
    })
    .filter(Boolean)
    .join("\n");
  const boosts = listFreeBoosts(sheet)
    .map((b) => `· [${b.when}] ${b.line}`)
    .join("\n");
  return [
    `${sheet.name}，${race}${cls} 3 级，AC ${sheet.ac}，生命 ${sheet.hp.current}/${sheet.hp.max}，速度 ${sheet.speed} 尺，熟练加值 +2。`,
    `库存（由系统记账，你不能改数字，不能送环位）：${resourceLine(ensureResources(sheet).resources!)}`,
    `属性：${mods}`,
    `熟练技能：${skillLine || "无"}`,
    spells ? `法术与效果：\n${spells}` : "",
    boosts ? `即时能力由面板勾选，不要再口头问一轮：\n${boosts}` : "",
    `身上：${wornSummary(sheet.equipped ?? {})}`,
    `背包：${packSummary(sheet.backpack ?? [])}`,
    `装备（旧列表）：${sheet.equipment.join("、")}`,
    `特征：${sheet.features.join("；")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function ensureGear(sheet: CharacterSheet): CharacterSheet {
  const withRes = ensureResources(sheet);
  const scores = withRes.scores ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  if (withRes.equipped && withRes.backpack) {
    return {
      ...withRes,
      scores,
      ac: acFromGear(withRes.classId || "fighter", scores, withRes.equipped),
    };
  }
  const gear = kitToGear(withRes.equipment ?? []);
  return {
    ...withRes,
    scores,
    equipped: gear.equipped,
    backpack: gear.backpack,
    ac: acFromGear(withRes.classId || "fighter", scores, gear.equipped),
  };
}

export const POINT_BUY_CAP = 27;

// SPEC 0004 §4: the builder's proficiency choices and their display. They
// derive from the same catalog grants as compileSheet and the room seed.

const TOOL_KIND_LABEL: Record<ToolKind, string> = {
  artisan: "工匠工具",
  kit: "工具",
  gaming: "赌具",
  instrument: "乐器",
  vehicle: "载具",
};

/** A skill's or tool's label. */
export function skillOrToolLabel(id: string): string {
  return SKILLS.find((s) => s.id === id)?.label ?? TOOLS.find((t) => t.id === id)?.label ?? id;
}

/** What a "one tool of your choice" grant offers, in words: "一种赌具". */
export function toolChoiceLabel(options: readonly ToolId[]): string {
  const kinds = [...new Set(options.map((id) => TOOLS.find((t) => t.id === id)?.kind))];
  return kinds.length === 1 && kinds[0] !== undefined ? `一种${TOOL_KIND_LABEL[kinds[0]]}` : "一种工具";
}

type DraftGrants = Pick<DraftSheet, "classId" | "raceId" | "subclassId" | "backgroundId" | "extraSkillIds">;

/** The Expertise a draft picks: `count` of the Knowledge domain's skills
 * (which also become proficient), or `count` of a rogue's proficient skills
 * and thieves' tools. compileSheet applies the same options. */
export type ExpertiseChoice = { source: "class" | "subclass"; options: (SkillId | ToolId)[]; count: number };

/** The draft's Expertise choice; undefined when its class and subclass offer none. */
export function expertiseChoice(draft: DraftGrants): ExpertiseChoice | undefined {
  const cls = classById(draft.classId) ?? CLASSES[0];
  const subclass = cls.subclasses.find((s) => s.id === draft.subclassId) ?? cls.subclasses[0];
  const knowledge = subclass?.skillExpertiseChoice;
  if (knowledge !== undefined) return { source: "subclass", options: [...knowledge.from], count: knowledge.count };
  if (cls.expertiseChoice === undefined) return undefined;
  const race = raceById(draft.raceId) ?? RACES[0];
  const proficient = new Set<string>([
    ...(backgroundById(draft.backgroundId)?.skills ?? []),
    ...(race.skillProficiencies ?? []),
    ...draft.extraSkillIds,
  ]);
  return {
    source: "class",
    options: [...SKILLS.map((s) => s.id).filter((id) => proficient.has(id)), ...cls.expertiseChoice.tools],
    count: cls.expertiseChoice.count,
  };
}

/** The draft's picks among the Expertise options, at most `count`. */
export function chosenExpertise(draft: Pick<DraftSheet, "expertiseIds">, choice: ExpertiseChoice): (SkillId | ToolId)[] {
  return [...new Set(draft.expertiseIds ?? [])]
    .filter((id) => choice.options.includes(id))
    .slice(0, choice.count);
}

/** Skills a draft is proficient with apart from its class picks: from its
 * background, its race and the Knowledge domain's picks. */
export function grantedSkills(draft: DraftGrants & Pick<DraftSheet, "expertiseIds">): SkillId[] {
  const choice = expertiseChoice(draft);
  const granted = new Set<string>([
    ...(backgroundById(draft.backgroundId)?.skills ?? []),
    ...(raceById(draft.raceId)?.skillProficiencies ?? []),
    ...(choice?.source === "subclass" ? chosenExpertise(draft, choice) : []),
  ]);
  return SKILLS.map((s) => s.id).filter((id) => granted.has(id));
}

/** 2014 starting equipment gives armor and weapons "if proficient": per kit
 * of the draft's class, the names of the armor, shields and weapons in it the
 * draft is not proficient with. An empty list is a kit the draft may take. */
export function kitProficiencyGaps(draft: ProficiencySource & { classId: string }): string[][] {
  const weapons = new Set<string>(weaponProficiencies(draft));
  const armor = new Set<string>(armorProficiencies(draft));
  return (CLASS_KITS[draft.classId] ?? []).map((kit) => {
    const gear = kitToGear(kit);
    const ids = new Set([...Object.values(gear.equipped), ...gear.backpack.map((entry) => entry.itemId)]);
    return [...ids].flatMap((id) => {
      const item = itemById(id);
      if (item?.armor !== undefined) return armor.has(item.armor) ? [] : [item.name];
      if (item?.weapon !== undefined) {
        return weapons.has(item.weapon.category) || weapons.has(item.weapon.kind ?? item.id) ? [] : [item.name];
      }
      return [];
    });
  });
}

/** The chosen kit, or the first one the draft is proficient with when the
 * chosen one is not. When no kit is, the choice stays. */
export function proficientKitChoice(draft: ProficiencySource & Pick<DraftSheet, "classId" | "equipmentChoice">): number {
  const gaps = kitProficiencyGaps(draft);
  if ((gaps[draft.equipmentChoice]?.length ?? 0) === 0) return draft.equipmentChoice;
  const allowed = gaps.findIndex((gap) => gap.length === 0);
  return allowed === -1 ? draft.equipmentChoice : allowed;
}

/** The draft without the tool and Expertise choices its race, class,
 * subclass, background and skills no longer offer, and with a kit it is
 * proficient with when the chosen one is not. */
export function normalizeDraftChoices(draft: DraftSheet): DraftSheet {
  const choice = expertiseChoice(draft);
  return {
    ...draft,
    toolChoices: validToolChoices(draft),
    expertiseIds: choice === undefined ? [] : chosenExpertise(draft, choice),
    equipmentChoice: proficientKitChoice(draft),
  };
}

export type DraftChoiceStep = "race" | "class" | "background" | "skills";
export type PendingDraftChoice = { step: DraftChoiceStep; text: string };

const TOOL_CHOICE_STEP: Record<ToolChoiceSource, DraftChoiceStep> = {
  race: "race",
  subclass: "class",
  background: "background",
};
const TOOL_CHOICE_FROM: Record<ToolChoiceSource, string> = { race: "种族", subclass: "子职", background: "背景" };

/** The choices a draft still owes before it can be locked: a tool for each
 * "one of your choice" grant, and the full count of Expertise. */
export function pendingDraftChoices(draft: DraftSheet): PendingDraftChoice[] {
  const offered = toolChoiceOptions(draft);
  const picked = validToolChoices(draft);
  const pending: PendingDraftChoice[] = TOOL_CHOICE_SOURCES.flatMap((source) => {
    const options = offered[source];
    return options === undefined || picked[source] !== undefined
      ? []
      : [{ step: TOOL_CHOICE_STEP[source], text: `${TOOL_CHOICE_FROM[source]}给的${toolChoiceLabel(options)}` }];
  });
  const choice = expertiseChoice(draft);
  const missing = choice === undefined ? 0 : choice.count - chosenExpertise(draft, choice).length;
  if (choice !== undefined && missing > 0) {
    pending.push({ step: choice.source === "subclass" ? "class" : "skills", text: `${missing} 项专精` });
  }
  return pending;
}

export type ProficiencyEntry = { id: string; label: string; expertise: boolean };

/** A sheet's tools (marking Expertise), weapons and armor in catalog order.
 * An older sheet without tool choices shows its fixed grants. */
export function sheetProficiencies(sheet: ProficiencySource & { expertise?: readonly string[] }): {
  tools: ProficiencyEntry[];
  weapons: ProficiencyEntry[];
  armor: ProficiencyEntry[];
} {
  const expertise = new Set(Array.isArray(sheet.expertise) ? sheet.expertise : []);
  const tools = new Set<string>(toolProficiencies(sheet));
  const weapons = new Set<string>(weaponProficiencies(sheet));
  const armor = new Set<string>(armorProficiencies(sheet));
  const entry = ({ id, label }: { id: string; label: string }) => ({ id, label, expertise: expertise.has(id) });
  return {
    tools: TOOLS.filter((t) => tools.has(t.id)).map(entry),
    weapons: WEAPON_PROFICIENCIES.filter((w) => weapons.has(w.id)).map(entry),
    armor: ARMOR_PROFICIENCIES.filter((a) => armor.has(a.id)).map(entry),
  };
}
