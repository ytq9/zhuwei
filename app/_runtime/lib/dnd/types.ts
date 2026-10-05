import type { Equipped, PackEntry } from "./gear";
import type { Resources } from "./resources";

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Ability = (typeof ABILITIES)[number];

export const ABILITY_LABEL: Record<Ability, string> = {
  str: "力量",
  dex: "敏捷",
  con: "体质",
  int: "智力",
  wis: "感知",
  cha: "魅力",
};

export const SKILLS = [
  { id: "athletics", label: "运动", ability: "str" },
  { id: "acrobatics", label: "特技", ability: "dex" },
  { id: "sleight", label: "巧手", ability: "dex" },
  { id: "stealth", label: "隐匿", ability: "dex" },
  { id: "arcana", label: "奥秘", ability: "int" },
  { id: "history", label: "历史", ability: "int" },
  { id: "investigation", label: "调查", ability: "int" },
  { id: "nature", label: "自然", ability: "int" },
  { id: "religion", label: "宗教", ability: "int" },
  { id: "animal", label: "驯兽", ability: "wis" },
  { id: "insight", label: "洞悉", ability: "wis" },
  { id: "medicine", label: "医药", ability: "wis" },
  { id: "perception", label: "察觉", ability: "wis" },
  { id: "survival", label: "求生", ability: "wis" },
  { id: "deception", label: "欺瞒", ability: "cha" },
  { id: "intimidation", label: "威吓", ability: "cha" },
  { id: "performance", label: "表演", ability: "cha" },
  { id: "persuasion", label: "说服", ability: "cha" },
] as const;

export type SkillId = (typeof SKILLS)[number]["id"];

/** SPEC 0004 §4: the SRD 5.1 tools. Proficiency with one adds the
 * proficiency bonus to a check that uses it, as a skill's does; a check names
 * the tool by its id. */
export const TOOLS = [
  { id: "alchemists-supplies", label: "炼金工具", kind: "artisan" },
  { id: "brewers-supplies", label: "酿酒工具", kind: "artisan" },
  { id: "calligraphers-supplies", label: "书法工具", kind: "artisan" },
  { id: "carpenters-tools", label: "木匠工具", kind: "artisan" },
  { id: "cartographers-tools", label: "制图工具", kind: "artisan" },
  { id: "cobblers-tools", label: "制鞋工具", kind: "artisan" },
  { id: "cooks-utensils", label: "厨具", kind: "artisan" },
  { id: "glassblowers-tools", label: "玻璃工具", kind: "artisan" },
  { id: "jewelers-tools", label: "珠宝工具", kind: "artisan" },
  { id: "leatherworkers-tools", label: "皮匠工具", kind: "artisan" },
  { id: "masons-tools", label: "石匠工具", kind: "artisan" },
  { id: "painters-supplies", label: "画具", kind: "artisan" },
  { id: "potters-tools", label: "陶匠工具", kind: "artisan" },
  { id: "smiths-tools", label: "铁匠工具", kind: "artisan" },
  { id: "tinkers-tools", label: "修补工具", kind: "artisan" },
  { id: "weavers-tools", label: "织工工具", kind: "artisan" },
  { id: "woodcarvers-tools", label: "木雕工具", kind: "artisan" },
  { id: "disguise-kit", label: "易容工具", kind: "kit" },
  { id: "forgery-kit", label: "伪造工具", kind: "kit" },
  { id: "herbalism-kit", label: "草药工具", kind: "kit" },
  { id: "navigators-tools", label: "导航工具", kind: "kit" },
  { id: "poisoners-kit", label: "下毒工具", kind: "kit" },
  { id: "thieves-tools", label: "盗贼工具", kind: "kit" },
  { id: "dice-set", label: "骰子", kind: "gaming" },
  { id: "dragonchess-set", label: "龙棋", kind: "gaming" },
  { id: "playing-card-set", label: "纸牌", kind: "gaming" },
  { id: "three-dragon-ante-set", label: "三龙牌", kind: "gaming" },
  { id: "bagpipes", label: "风笛", kind: "instrument" },
  { id: "drum", label: "鼓", kind: "instrument" },
  { id: "dulcimer", label: "扬琴", kind: "instrument" },
  { id: "flute", label: "长笛", kind: "instrument" },
  { id: "horn", label: "号角", kind: "instrument" },
  { id: "lute", label: "鲁特琴", kind: "instrument" },
  { id: "lyre", label: "里拉琴", kind: "instrument" },
  { id: "pan-flute", label: "排箫", kind: "instrument" },
  { id: "shawm", label: "肖姆管", kind: "instrument" },
  { id: "viol", label: "维奥尔琴", kind: "instrument" },
  { id: "land-vehicles", label: "陆载载具", kind: "vehicle" },
  { id: "water-vehicles", label: "水载载具", kind: "vehicle" },
] as const;

export type ToolId = (typeof TOOLS)[number]["id"];
export type ToolKind = (typeof TOOLS)[number]["kind"];

/** Where a "one tool of your choice" proficiency comes from; each source
 * offers at most one such choice. */
export const TOOL_CHOICE_SOURCES = ["race", "subclass", "background"] as const;
export type ToolChoiceSource = (typeof TOOL_CHOICE_SOURCES)[number];
export type ToolChoices = Partial<Record<ToolChoiceSource, ToolId>>;

/** The weapon proficiencies of the 2014 classes and races here: the two
 * categories, and the single weapons some grant. A weapon is "simple" or
 * "martial" and has its own kind id; proficiency with either adds the
 * proficiency bonus to its attack rolls. */
export const WEAPON_PROFICIENCIES = [
  { id: "simple", label: "简易武器" },
  { id: "martial", label: "军用武器" },
  { id: "battleaxe", label: "战斧" },
  { id: "dagger", label: "匕首" },
  { id: "dart", label: "飞镖" },
  { id: "hand-crossbow", label: "手弩" },
  { id: "handaxe", label: "手斧" },
  { id: "light-crossbow", label: "轻弩" },
  { id: "light-hammer", label: "轻锤" },
  { id: "longbow", label: "长弓" },
  { id: "longsword", label: "长剑" },
  { id: "rapier", label: "刺剑" },
  { id: "shortbow", label: "短弓" },
  { id: "shortsword", label: "短剑" },
  { id: "sling", label: "投石索" },
  { id: "staff", label: "短杖" },
  { id: "warhammer", label: "战锤" },
] as const;
export type WeaponProficiencyId = (typeof WEAPON_PROFICIENCIES)[number]["id"];

/** Armor proficiencies (2014): wearing armor or a shield without the
 * proficiency gives disadvantage on checks, saves and attack rolls that use
 * Strength or Dexterity, and no spellcasting. */
export const ARMOR_PROFICIENCIES = [
  { id: "light", label: "轻甲" },
  { id: "medium", label: "中甲" },
  { id: "heavy", label: "重甲" },
  { id: "shield", label: "盾牌" },
] as const;
export type ArmorProficiencyId = (typeof ARMOR_PROFICIENCIES)[number]["id"];

/** What a class, race, subclass or background grants; SRD 5.1 2014. */
export type ProficiencyGrants = {
  toolProficiencies?: ToolId[];
  /** One tool the player picks from these. */
  toolChoice?: readonly ToolId[];
  weaponProficiencies?: WeaponProficiencyId[];
  armorProficiencies?: ArmorProficiencyId[];
};

export type Spell = {
  id: string;
  name: string;
  level: 0 | 1 | 2;
  school: string;
  text: string;
  time?: string;
  range?: string;
  duration?: string;
  askOn?: "check" | "hit" | "dying";
};

export type RaceDef = {
  id: string;
  name: string;
  size: string;
  speed: number;
  summary: string;
  bonuses: Partial<Record<Ability, number>> | "all1" | "halfElf";
  traits: string[];
  extraSkills?: number;
  extraCantrip?: boolean;
  /** Skills the race itself makes proficient (the half-orc's Intimidation). */
  skillProficiencies?: SkillId[];
} & ProficiencyGrants;

export type SubclassDef = {
  id: string;
  name: string;
  summary: string;
  features: string[];
  /** Skills picked from `from` that become proficient with Expertise (the
   * Knowledge domain's Blessings of Knowledge). */
  skillExpertiseChoice?: { from: SkillId[]; count: number };
} & ProficiencyGrants;

export type ClassDef = {
  id: string;
  name: string;
  hitDie: number;
  primary: Ability[];
  saves: Ability[];
  armor: string;
  weapons: string;
  skillPicks: number;
  skillList: SkillId[];
  /** Expertise picked from the character's own skills and these tools (the
   * rogue's: two skills, or one skill and thieves' tools). */
  expertiseChoice?: { count: number; tools: ToolId[] };
  summary: string;
  features: string[];
  subclasses: SubclassDef[];
  spellcasting?: "wizard" | "cleric" | "ranger";
} & ProficiencyGrants;

export type BackgroundDef = {
  id: string;
  name: string;
  skills: SkillId[];
  tools: string;
  summary: string;
  equipment: string[];
} & ProficiencyGrants;

export type AbilityScores = Record<Ability, number>;

export type CharacterSheet = {
  name: string;
  raceId: string;
  classId: string;
  subclassId: string;
  backgroundId: string;
  level: 3;
  scores: AbilityScores;
  skills: SkillId[];
  /** Skills and, for a rogue, thieves' tools. */
  expertise: (SkillId | ToolId)[];
  /** The tool picked for each "one of your choice" grant; older sheets lack it. */
  toolChoices?: ToolChoices;
  cantrips: string[];
  prepared: string[];
  spellbook: string[];
  equipment: string[];
  equipped?: Equipped;
  backpack?: PackEntry[];
  appearance: string;
  trait: string;
  ideal: string;
  bond: string;
  flaw: string;
  hp: { current: number; max: number; temp: number };
  ac: number;
  speed: number;
  proficiency: 2;
  deathSaves: { success: number; fail: number };
  conditions: string[];
  inspiration: boolean;
  features: string[];
  channelUsed?: boolean;
  resources?: Resources;
};

export type DraftSheet = {
  name: string;
  raceId: string;
  classId: string;
  subclassId: string;
  backgroundId: string;
  scores: AbilityScores;
  extraSkillIds: SkillId[];
  /** The tool picked for each "one of your choice" grant. */
  toolChoices?: ToolChoices;
  /** The rogue's Expertise, or the Knowledge cleric's two skills. */
  expertiseIds?: (SkillId | ToolId)[];
  cantrips: string[];
  prepared: string[];
  spellbook: string[];
  equipmentChoice: number;
  appearance: string;
  trait: string;
  ideal: string;
  bond: string;
  flaw: string;
};

export const EMPTY_SCORES: AbilityScores = {
  str: 8,
  dex: 8,
  con: 8,
  int: 8,
  wis: 8,
  cha: 8,
};

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;
