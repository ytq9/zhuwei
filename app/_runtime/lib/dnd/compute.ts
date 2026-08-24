import { abilityMod } from "@/lib/utils";
import {
  BACKGROUNDS,
  CLASSES,
  CLASS_KITS,
  RACES,
  SPELLS,
  classById,
  listFreeBoosts,
  raceById,
  uniqueSpellIds,
} from "./catalog";
import { acFromGear, kitToGear, wornSummary, packSummary } from "./gear";
import { initResources, ensureResources, resourceLine } from "./resources";
import {
  ABILITIES,
  type Ability,
  type AbilityScores,
  type CharacterSheet,
  type DraftSheet,
  type SkillId,
  SKILLS,
} from "./types";

export function casterMod(sheet: CharacterSheet) {
  const ab = (classById(sheet.classId)?.primary?.[0] ?? "wis") as Ability;
  return { ability: ab, mod: abilityMod(sheet.scores?.[ab] ?? 10) };
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

export function compileSheet(draft: DraftSheet): CharacterSheet {
  const cls = classById(draft.classId) ?? CLASSES[0];
  const race = raceById(draft.raceId) ?? RACES[0];
  const bg = BACKGROUNDS.find((b) => b.id === draft.backgroundId);
  const scores = finalScores(draft.scores, draft.raceId);
  const kits = CLASS_KITS[cls.id] ?? [[]];
  const kit = kits[Math.min(draft.equipmentChoice, kits.length - 1)] ?? kits[0];
  const equipment = [...kit, ...(bg?.equipment ?? [])];
  const skills = Array.from(
    new Set<SkillId>([...(bg?.skills ?? []), ...draft.extraSkillIds]),
  );
  const expertise: SkillId[] =
    cls.id === "rogue" ? skills.slice(0, 2) : cls.subclasses.find((s) => s.id === draft.subclassId)?.id === "knowledge" ? skills.filter((s) => ["arcana", "history", "investigation", "religion", "nature"].includes(s)).slice(0, 2) as SkillId[] : [];

  const hpMax = maxHp(cls.id, abilityMod(scores.con), race.id);
  const gear = kitToGear(equipment);
  const ac = acFromGear(cls.id, scores, gear.equipped);
  const subclass = cls.subclasses.find((s) => s.id === draft.subclassId);
  const features = [
    ...race.traits,
    ...cls.features,
    ...(subclass?.features ?? []),
  ];
  const cantrips = [...draft.cantrips];
  if (race.extraCantrip && !cantrips.includes("prestidigitation")) {
    cantrips.push("prestidigitation");
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
