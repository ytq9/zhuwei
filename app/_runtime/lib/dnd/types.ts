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

/** SPEC 0004 §4: the tools a class or background here makes a character
 * proficient with (SRD 5.1). A check that uses one adds the proficiency
 * bonus, as a skill does. "One kind of" gaming set or instrument is kept as
 * the kind, since the builder offers no choice of which. */
export const TOOLS = [
  { id: "thieves-tools", label: "盗贼工具" },
  { id: "disguise-kit", label: "易容工具" },
  { id: "navigator-tools", label: "导航工具" },
  { id: "gaming-set", label: "一种赌具" },
  { id: "musical-instrument", label: "一种乐器" },
  { id: "land-vehicles", label: "陆载载具" },
  { id: "water-vehicles", label: "水载载具" },
] as const;

export type ToolId = (typeof TOOLS)[number]["id"];

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
};

export type SubclassDef = {
  id: string;
  name: string;
  summary: string;
  features: string[];
};

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
  toolProficiencies?: ToolId[];
  summary: string;
  features: string[];
  subclasses: SubclassDef[];
  spellcasting?: "wizard" | "cleric" | "ranger";
};

export type BackgroundDef = {
  id: string;
  name: string;
  skills: SkillId[];
  tools: string;
  toolProficiencies: ToolId[];
  summary: string;
  equipment: string[];
};

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
  expertise: SkillId[];
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
