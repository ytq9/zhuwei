import type {
  DiceFormula,
  SpellDefinition,
  SpellDuration,
  SpellEffectDefinition,
  SpellRange,
  SpellResolution,
  SpellTargets,
} from "./spell-model";

const instant = { kind: "instant" } as const satisfies SpellDuration;
const self = { kind: "self" } as const satisfies SpellRange;
const touch = { kind: "touch" } as const satisfies SpellRange;
const feet = (value: number) => ({ kind: "distance", feet: value }) as const;
const timed = (
  seconds: number,
  options: Pick<Extract<SpellDuration, { kind: "timed" }>, "concentration" | "turnBoundary"> = {},
) => ({ kind: "timed", seconds, ...options }) as const;
const targets = (
  filter: SpellTargets["filter"],
  max: number | null,
  options: Omit<SpellTargets, "filter" | "max"> = {},
) => ({ filter, max, ...options });
const dice = (
  count: number,
  sides: number,
  modifier?: DiceFormula["modifier"],
  perSlotAbove?: number,
): DiceFormula => ({ count, sides, modifier, perSlotAbove });
const effect = (
  tag: string,
  label: string,
  kind: SpellEffectDefinition["kind"],
  value?: number,
): SpellEffectDefinition => ({ tag, label, kind, value });
const attack = (
  attackKind: "melee" | "ranged",
  formula: DiceFormula,
  damageType: NonNullable<SpellResolution["damage"]>["type"],
  effects: SpellEffectDefinition[] = [],
  attacks = 1,
  attacksPerSlotAbove?: number,
): SpellResolution => ({
  mode: "attack",
  attackKind,
  attacks,
  attacksPerSlotAbove,
  damage: { formula, type: damageType },
  effects,
});
const save = (
  ability: NonNullable<SpellResolution["save"]>["ability"],
  onSuccess: NonNullable<SpellResolution["save"]>["onSuccess"],
  options: Omit<SpellResolution, "mode" | "save"> &
    Partial<Pick<NonNullable<SpellResolution["save"]>, "repeats" | "advantageInCombat">> = {},
): SpellResolution => {
  const { repeats, advantageInCombat, ...resolution } = options;
  return {
    mode: "save",
    save: { ability, onSuccess, repeats, advantageInCombat },
    ...resolution,
  };
};

/**
 * SRD 5.1 / D&D 5e 2014 的结构化三级法术目录。
 * 中文名称和长描述仍由 dnd/catalog.ts 提供；数值裁决只读这里。
 */
export const SPELL_DEFINITIONS = {
  light: {
    id: "light", level: 0, actionCost: "action", castingSeconds: 6,
    range: touch, targets: targets("object", 1), duration: timed(60 * 60),
    resolution: { mode: "special", special: "light", effects: [effect("light", "20 尺明亮光照＋20 尺微光", "utility")] },
  },
  prestidigitation: {
    id: "prestidigitation", level: 0, actionCost: "action", castingSeconds: 6,
    range: feet(10), targets: targets("area", 1), duration: timed(60 * 60),
    resolution: { mode: "utility", effects: [effect("prestidigitation", "至多三个无害魔法效果", "utility")] },
  },
  "mage-hand": {
    id: "mage-hand", level: 0, actionCost: "action", castingSeconds: 6,
    range: feet(30), targets: targets("space", 1), duration: timed(60),
    resolution: { mode: "utility", effects: [effect("mage-hand", "法师之手（负重 10 磅）", "summon")] },
  },
  "fire-bolt": {
    id: "fire-bolt", level: 0, actionCost: "action", castingSeconds: 6,
    range: feet(120), targets: targets("creature", 1, { requiresSight: true }), duration: instant,
    resolution: attack("ranged", dice(1, 10), "fire"),
  },
  "ray-frost": {
    id: "ray-frost", level: 0, actionCost: "action", castingSeconds: 6,
    range: feet(60), targets: targets("creature", 1), duration: timed(6, { turnBoundary: "casterStart" }),
    resolution: attack("ranged", dice(1, 8), "cold", [effect("speed-10", "速度 −10 尺", "modifier", -10)]),
  },
  shocking: {
    id: "shocking", level: 0, actionCost: "action", castingSeconds: 6,
    range: touch, targets: targets("creature", 1), duration: timed(6, { turnBoundary: "targetStart" }),
    resolution: attack("melee", dice(1, 8), "lightning", [effect("no-reactions", "不能使用反应", "condition")]),
  },
  "minor-illusion": {
    id: "minor-illusion", level: 0, actionCost: "action", castingSeconds: 6,
    range: feet(30), targets: targets("space", 1), duration: timed(60),
    resolution: { mode: "special", special: "minor-illusion", effects: [effect("minor-illusion", "声音或 5 尺立方静止影像", "utility")] },
  },
  guidance: {
    id: "guidance", level: 0, actionCost: "action", castingSeconds: 6,
    range: touch, targets: targets("willing-creature", 1), duration: timed(60, { concentration: true }),
    resolution: { mode: "automatic", effects: [effect("guidance", "一次属性检定 +1d4", "modifier")] },
  },
  "sacred-flame": {
    id: "sacred-flame", level: 0, actionCost: "action", castingSeconds: 6,
    range: feet(60), targets: targets("creature", 1, { requiresSight: true }), duration: instant,
    resolution: save("dex", "none", { damage: { formula: dice(1, 8), type: "radiant" } }),
  },
  thaumaturgy: {
    id: "thaumaturgy", level: 0, actionCost: "action", castingSeconds: 6,
    range: feet(30), targets: targets("area", 1), duration: timed(60),
    resolution: { mode: "utility", effects: [effect("thaumaturgy", "至多三个神迹征象", "utility")] },
  },
  spare: {
    id: "spare", level: 0, actionCost: "action", castingSeconds: 6,
    range: touch, targets: targets("living-at-zero-hp", 1), duration: instant,
    resolution: { mode: "special", special: "stabilize", effects: [effect("stable", "伤势稳定", "condition")] },
  },
  "mage-armor": {
    id: "mage-armor", level: 1, actionCost: "action", castingSeconds: 6,
    range: touch, targets: targets("willing-creature", 1), duration: timed(8 * 60 * 60),
    resolution: { mode: "automatic", effects: [effect("mage-armor", "基础 AC 13＋敏捷调整值", "modifier", 13)] },
  },
  shield: {
    id: "shield", level: 1, actionCost: "reaction", castingSeconds: 0,
    range: self, targets: targets("self", 1), duration: timed(6, { turnBoundary: "casterStart" }),
    resolution: { mode: "automatic", effects: [effect("shield-ac", "AC +5", "modifier", 5), effect("magic-missile-immunity", "免疫魔法飞弹", "condition")] },
  },
  "magic-missile": {
    id: "magic-missile", level: 1, actionCost: "action", castingSeconds: 6,
    range: feet(120), targets: targets("creature", 3, { requiresSight: true, perSlotAbove: 1, allowsRepeat: true }), duration: instant,
    resolution: { mode: "special", special: "magic-missile", damage: { formula: dice(1, 4, 1), type: "force" } },
  },
  sleep: {
    id: "sleep", level: 1, actionCost: "action", castingSeconds: 6,
    range: feet(90), area: { shape: "sphere", sizeFeet: 20, origin: "point" },
    targets: targets("area", null), duration: timed(60),
    resolution: { mode: "special", special: "sleep-hp-pool", damage: { formula: dice(5, 8, undefined, 2), type: "psychic" }, effects: [effect("magical-sleep", "昏迷；受伤或被动作唤醒时结束", "condition")] },
  },
  "detect-magic": {
    id: "detect-magic", level: 1, actionCost: "action", castingSeconds: 6, ritual: true,
    range: self, area: { shape: "emanation", sizeFeet: 30, origin: "self" }, targets: targets("self", 1),
    duration: timed(10 * 60, { concentration: true }),
    resolution: { mode: "utility", effects: [effect("detect-magic", "感知 30 尺内魔法及学派", "sense")] },
  },
  identify: {
    id: "identify", level: 1, actionCost: "action", castingSeconds: 60, ritual: true,
    range: touch, targets: targets("object", 1), duration: instant,
    resolution: { mode: "special", special: "identify", effects: [effect("identified", "得知魔法属性、用法与同调", "utility")] },
  },
  charm: {
    id: "charm", level: 1, actionCost: "action", castingSeconds: 6,
    range: feet(30), targets: targets("humanoid", 1, { requiresSight: true, perSlotAbove: 1 }), duration: timed(60 * 60),
    resolution: save("wis", "negates-status", { advantageInCombat: true, effects: [effect("charmed", "被施法者魅惑", "condition")] }),
  },
  disguise: {
    id: "disguise", level: 1, actionCost: "action", castingSeconds: 6,
    range: self, targets: targets("self", 1), duration: timed(60 * 60),
    resolution: { mode: "utility", effects: [effect("disguise-self", "外貌与衣着幻象", "utility")] },
  },
  thunderwave: {
    id: "thunderwave", level: 1, actionCost: "action", castingSeconds: 6,
    range: self, area: { shape: "cube", sizeFeet: 15, origin: "self" }, targets: targets("area", null), duration: instant,
    resolution: save("con", "half", { damage: { formula: dice(2, 8, undefined, 1), type: "thunder" }, effects: [effect("push-10", "失败时推开 10 尺", "movement", 10)] }),
  },
  "burning-hands": {
    id: "burning-hands", level: 1, actionCost: "action", castingSeconds: 6,
    range: self, area: { shape: "cone", sizeFeet: 15, origin: "self" }, targets: targets("area", null), duration: instant,
    resolution: save("dex", "half", { damage: { formula: dice(3, 6, undefined, 1), type: "fire" } }),
  },
  "healing-word": {
    id: "healing-word", level: 1, actionCost: "bonusAction", castingSeconds: 6,
    range: feet(60), targets: targets("creature-except-undead-construct", 1, { requiresSight: true }), duration: instant,
    resolution: { mode: "automatic", healing: dice(1, 4, "casting", 1) },
  },
  cure: {
    id: "cure", level: 1, actionCost: "action", castingSeconds: 6,
    range: touch, targets: targets("creature-except-undead-construct", 1), duration: instant,
    resolution: { mode: "automatic", healing: dice(1, 8, "casting", 1) },
  },
  bless: {
    id: "bless", level: 1, actionCost: "action", castingSeconds: 6,
    range: feet(30), targets: targets("creature", 3, { perSlotAbove: 1 }), duration: timed(60, { concentration: true }),
    resolution: { mode: "automatic", effects: [effect("bless", "攻击与豁免 +1d4", "modifier")] },
  },
  "guiding-bolt": {
    id: "guiding-bolt", level: 1, actionCost: "action", castingSeconds: 6,
    range: feet(120), targets: targets("creature", 1), duration: timed(6, { turnBoundary: "casterEnd" }),
    resolution: attack("ranged", dice(4, 6, undefined, 1), "radiant", [effect("guiding-bolt-advantage", "下一次对目标的攻击具有优势", "modifier")]),
  },
  inflict: {
    id: "inflict", level: 1, actionCost: "action", castingSeconds: 6,
    range: touch, targets: targets("creature", 1), duration: instant,
    resolution: attack("melee", dice(3, 10, undefined, 1), "necrotic"),
  },
  "shield-faith": {
    id: "shield-faith", level: 1, actionCost: "bonusAction", castingSeconds: 6,
    range: feet(60), targets: targets("creature", 1, { requiresSight: true }), duration: timed(10 * 60, { concentration: true }),
    resolution: { mode: "automatic", effects: [effect("shield-of-faith", "AC +2", "modifier", 2)] },
  },
  command: {
    id: "command", level: 1, actionCost: "action", castingSeconds: 6,
    range: feet(60), targets: targets("creature", 1, { perSlotAbove: 1 }), duration: timed(6, { turnBoundary: "targetEnd" }),
    resolution: save("wis", "negates-status", { effects: [effect("commanded", "下回合执行一个不直接有害的单词命令", "condition")] }),
  },
  "detect-evil": {
    id: "detect-evil", level: 1, actionCost: "action", castingSeconds: 6,
    range: self, area: { shape: "emanation", sizeFeet: 30, origin: "self" }, targets: targets("self", 1),
    duration: timed(10 * 60, { concentration: true }),
    resolution: { mode: "utility", effects: [effect("detect-evil-good", "感知特定异界生物、不死与祝圣/亵渎", "sense")] },
  },
  "hunters-mark": {
    id: "hunters-mark", level: 1, actionCost: "bonusAction", castingSeconds: 6,
    range: feet(90), targets: targets("creature", 1, { requiresSight: true }), duration: timed(60 * 60, { concentration: true }),
    resolution: { mode: "automatic", effects: [effect("hunters-mark", "武器命中额外 1d6；追踪检定优势", "modifier")] },
  },
  goodberry: {
    id: "goodberry", level: 1, actionCost: "action", castingSeconds: 6,
    range: touch, targets: targets("self", 1), duration: instant,
    resolution: { mode: "special", special: "goodberry", effects: [effect("goodberries", "生成 10 颗神莓，24 小时内每颗恢复 1 HP", "resource", 10)] },
  },
  ensnaring: {
    id: "ensnaring", level: 1, actionCost: "bonusAction", castingSeconds: 6,
    range: self, targets: targets("self", 1), duration: timed(60, { concentration: true }),
    resolution: { mode: "automatic", effects: [effect("ensnaring-strike", "下一次武器命中触发力量豁免；失败则束缚并每回合 1d6 穿刺", "special")] },
  },
  fog: {
    id: "fog", level: 1, actionCost: "action", castingSeconds: 6,
    range: feet(120), area: { shape: "sphere", sizeFeet: 20, origin: "point", perSlotAboveFeet: 20 }, targets: targets("area", null),
    duration: timed(60 * 60, { concentration: true }),
    resolution: { mode: "utility", effects: [effect("heavily-obscured", "重度遮掩浓雾", "area")] },
  },
  "speak-animals": {
    id: "speak-animals", level: 1, actionCost: "action", castingSeconds: 6, ritual: true,
    range: self, targets: targets("self", 1), duration: timed(10 * 60),
    resolution: { mode: "utility", effects: [effect("speak-with-animals", "理解并与野兽口头交谈", "sense")] },
  },
  misty: {
    id: "misty", level: 2, actionCost: "bonusAction", castingSeconds: 6,
    range: self, targets: targets("space", 1, { requiresSight: true }), duration: instant,
    resolution: { mode: "special", special: "misty-step", effects: [effect("teleport-30", "传送至 30 尺内可见未占据空间", "movement", 30)] },
  },
  scorching: {
    id: "scorching", level: 2, actionCost: "action", castingSeconds: 6,
    range: feet(120), targets: targets("creature", 3, { requiresSight: true, allowsRepeat: true }), duration: instant,
    resolution: attack("ranged", dice(2, 6), "fire", [], 3, 1),
  },
  "hold-person": {
    id: "hold-person", level: 2, actionCost: "action", castingSeconds: 6,
    range: feet(60), targets: targets("humanoid", 1, { requiresSight: true, perSlotAbove: 1 }), duration: timed(60, { concentration: true }),
    resolution: save("wis", "negates-status", { repeats: "turnEnd", effects: [effect("paralyzed", "麻痹；每回合结束重试豁免", "condition")] }),
  },
  invisibility: {
    id: "invisibility", level: 2, actionCost: "action", castingSeconds: 6,
    range: touch, targets: targets("creature", 1, { perSlotAbove: 1 }), duration: timed(60 * 60, { concentration: true }),
    resolution: { mode: "automatic", effects: [effect("invisible", "隐形；攻击或施法时结束", "condition")] },
  },
  "mirror-image": {
    id: "mirror-image", level: 2, actionCost: "action", castingSeconds: 6,
    range: self, targets: targets("self", 1), duration: timed(60),
    resolution: { mode: "special", special: "mirror-image", effects: [effect("mirror-images", "三具镜影分身", "special", 3)] },
  },
  web: {
    id: "web", level: 2, actionCost: "action", castingSeconds: 6,
    range: feet(60), area: { shape: "cube", sizeFeet: 20, origin: "point" }, targets: targets("area", null),
    duration: timed(60 * 60, { concentration: true }),
    resolution: save("dex", "negates-status", { repeats: "action-check", effects: [effect("restrained", "束缚；动作做力量检定可挣脱", "condition"), effect("difficult-terrain", "困难地形", "area")] }),
  },
  spiritual: {
    id: "spiritual", level: 2, actionCost: "bonusAction", castingSeconds: 6,
    range: feet(60), targets: targets("creature", 1, { requiresSight: true }), duration: timed(60),
    resolution: attack("melee", dice(1, 8, "casting"), "force", [effect("spiritual-weapon", "每回合可用附赠动作移动 20 尺并再次攻击", "summon")]),
  },
  aid: {
    id: "aid", level: 2, actionCost: "action", castingSeconds: 6,
    range: feet(30), targets: targets("creature", 3), duration: timed(8 * 60 * 60),
    resolution: { mode: "automatic", effects: [effect("aid", "当前与最大生命值各 +5", "modifier", 5)] },
  },
  "lesser-restoration": {
    id: "lesser-restoration", level: 2, actionCost: "action", castingSeconds: 6,
    range: touch, targets: targets("creature", 1), duration: instant,
    resolution: { mode: "special", special: "lesser-restoration", effects: [effect("remove-condition", "结束一项疾病，或目盲、耳聋、麻痹、中毒之一", "special")] },
  },
  silence: {
    id: "silence", level: 2, actionCost: "action", castingSeconds: 6, ritual: true,
    range: feet(120), area: { shape: "sphere", sizeFeet: 20, origin: "point" }, targets: targets("area", null),
    duration: timed(10 * 60, { concentration: true }),
    resolution: { mode: "utility", effects: [effect("silenced", "区域无声、耳聋，含言语成分法术无法施放", "area")] },
  },
  prayer: {
    id: "prayer", level: 2, actionCost: "action", castingSeconds: 10 * 60,
    range: feet(30), targets: targets("creature-except-undead-construct", 6, { requiresSight: true }), duration: instant,
    resolution: { mode: "automatic", healing: dice(2, 8, "casting", 1) },
  },
} as const satisfies Record<string, SpellDefinition>;

export type SpellId = keyof typeof SPELL_DEFINITIONS;

export function spellDefinition(id: string): SpellDefinition | undefined {
  return SPELL_DEFINITIONS[id as SpellId];
}

export function assertSpellDefinitions(ids: readonly string[]): string[] {
  const errors: string[] = [];
  const expected = new Set(ids);
  for (const id of ids) {
    const definition = spellDefinition(id);
    if (!definition) errors.push(`${id}: 缺少结构化法术定义`);
    else if (definition.id !== id) errors.push(`${id}: definition.id 不一致`);
  }
  for (const id of Object.keys(SPELL_DEFINITIONS)) {
    if (!expected.has(id)) errors.push(`${id}: 结构化定义没有对应人物卡法术`);
  }
  return errors;
}

export function spellMaxTargets(definition: SpellDefinition, slotLevel: number): number | null {
  if (definition.targets.max === null) return null;
  const above = Math.max(0, slotLevel - definition.level);
  return definition.targets.max + above * (definition.targets.perSlotAbove ?? 0);
}

export function spellAreaSize(definition: SpellDefinition, slotLevel: number): number | undefined {
  if (!definition.area) return undefined;
  return definition.area.sizeFeet +
    Math.max(0, slotLevel - definition.level) * (definition.area.perSlotAboveFeet ?? 0);
}

export function formulaAtSlot(
  formula: DiceFormula,
  spellLevel: number,
  slotLevel: number,
): DiceFormula {
  return {
    ...formula,
    count: formula.count + Math.max(0, slotLevel - spellLevel) * (formula.perSlotAbove ?? 0),
  };
}
