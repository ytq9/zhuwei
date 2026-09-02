import type { Ability, D20Mode } from "./ruleset";

export type SpellLevel = 0 | 1 | 2;
export type SpellActionCost = "action" | "bonusAction" | "reaction";

export type SpellRange =
  | { kind: "self" }
  | { kind: "touch" }
  | { kind: "distance"; feet: number };

export type SpellArea = {
  shape: "cone" | "cube" | "sphere" | "cylinder" | "emanation";
  sizeFeet: number;
  origin: "self" | "point";
  perSlotAboveFeet?: number;
};

export type SpellDuration =
  | { kind: "instant" }
  | {
      kind: "timed";
      seconds: number;
      concentration?: boolean;
      /** 2014 规则中“直到施法者/目标下回合开始或结束”的持续时间。 */
      turnBoundary?: "casterStart" | "casterEnd" | "targetStart" | "targetEnd";
    }
  | { kind: "special"; concentration?: boolean };

export type SpellTargetFilter =
  | "self"
  | "creature"
  | "creature-or-object"
  | "willing-creature"
  | "humanoid"
  | "living-creature"
  | "living-at-zero-hp"
  | "creature-except-undead-construct"
  | "object"
  | "space"
  | "area";

export type SpellTargets = {
  filter: SpellTargetFilter;
  /** null 表示范围内不设数量上限。 */
  max: number | null;
  min?: number;
  perSlotAbove?: number;
  requiresSight?: boolean;
  allowsRepeat?: boolean;
};

export type DiceFormula = {
  count: number;
  sides: number;
  modifier?: number | "casting";
  perSlotAbove?: number;
};

export type SpellDamage = {
  formula: DiceFormula;
  type:
    | "acid"
    | "bludgeoning"
    | "cold"
    | "fire"
    | "force"
    | "lightning"
    | "necrotic"
    | "piercing"
    | "poison"
    | "psychic"
    | "radiant"
    | "slashing"
    | "thunder";
};

export type SpellSave = {
  ability: Ability;
  onSuccess: "none" | "half" | "negates-status" | "special";
  repeats?: "turnStart" | "turnEnd" | "action-check";
  advantageInCombat?: boolean;
};

export type SpellEffectDefinition = {
  tag: string;
  label: string;
  kind:
    | "condition"
    | "modifier"
    | "sense"
    | "summon"
    | "area"
    | "movement"
    | "resource"
    | "utility"
    | "special";
  value?: number;
};

export type SpellResolution = {
  mode: "attack" | "save" | "automatic" | "utility" | "special";
  attackKind?: "melee" | "ranged";
  attacks?: number;
  attacksPerSlotAbove?: number;
  save?: SpellSave;
  damage?: SpellDamage;
  healing?: DiceFormula;
  effects?: SpellEffectDefinition[];
  /** 只用于确实不能由通用攻击/豁免/效果原语表达的 SRD 机制。 */
  special?:
    | "light"
    | "minor-illusion"
    | "stabilize"
    | "magic-missile"
    | "sleep-hp-pool"
    | "identify"
    | "misty-step"
    | "mirror-image"
    | "goodberry"
    | "lesser-restoration";
};

export type SpellDefinition = {
  id: string;
  level: SpellLevel;
  actionCost: SpellActionCost;
  castingSeconds: number;
  ritual?: boolean;
  range: SpellRange;
  area?: SpellArea;
  targets: SpellTargets;
  duration: SpellDuration;
  resolution: SpellResolution;
};

export type SpellcastingProfile = {
  ability: Ability;
  castingModifier: number;
  attackBonus: number;
  saveDc: number;
};

export type SpellCastRolls = {
  attack?: Array<{ mode: D20Mode; faces: number[] }>;
  saves?: Record<string, { mode: D20Mode; faces: number[] }>;
  effect?: number[];
};

export type SpellEffectState = {
  id: string;
  spellId: string;
  sourceId: string;
  targetId: string;
  label: string;
  tags: string[];
  concentration: boolean;
  startedAtSeconds: number;
  expiresAtSeconds?: number;
  turnBoundary?: "casterStart" | "casterEnd" | "targetStart" | "targetEnd";
  expiresOnTurn?: {
    entityId: string;
    phase: "start" | "end";
    round: number;
  };
  area?: {
    sceneId: string;
    shape: SpellArea["shape"];
    sizeFeet: number;
    originFeet?: number;
  };
  modifiers?: {
    acBonus?: number;
    baseAc?: number;
    speedFeet?: number;
    maxHp?: number;
  };
};
