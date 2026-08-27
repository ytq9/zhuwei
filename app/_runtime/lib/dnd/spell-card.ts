import { ABILITY_LABEL } from "./types";
import { formulaAtSlot, spellAreaSize, spellDefinition } from "../rules/spell-catalog";
import type {
  DiceFormula,
  SpellDefinition,
  SpellcastingProfile,
} from "../rules/spell-model";

const DAMAGE_LABEL: Record<string, string> = {
  acid: "强酸",
  bludgeoning: "钝击",
  cold: "冷冻",
  fire: "火焰",
  force: "力场",
  lightning: "闪电",
  necrotic: "暗蚀",
  piercing: "穿刺",
  poison: "毒素",
  psychic: "心灵",
  radiant: "光耀",
  slashing: "挥砍",
  thunder: "雷鸣",
};

const AREA_LABEL: Record<string, string> = {
  cone: "锥状",
  cube: "立方",
  sphere: "半径",
  cylinder: "柱状",
  emanation: "发散",
};

const TARGET_LABEL: Record<string, string> = {
  self: "自身",
  creature: "生物",
  "willing-creature": "自愿生物",
  humanoid: "类人生物",
  "living-creature": "活着的生物",
  "living-at-zero-hp": "0 HP 且仍存活的生物",
  "creature-except-undead-construct": "非不死、非构装生物",
  object: "物体",
  space: "空间",
  area: "区域内生物",
};

export function formatDice(formula: DiceFormula, castingModifier?: number): string {
  const modifier = formula.modifier === "casting" ? (castingModifier ?? 0) : (formula.modifier ?? 0);
  return `${formula.count}d${formula.sides}${modifier === 0 ? "" : modifier > 0 ? `＋${modifier}` : `−${Math.abs(modifier)}`}`;
}

export function spellTargetLine(
  definition: SpellDefinition,
  slotLevel: number = definition.level,
): string {
  const target = TARGET_LABEL[definition.targets.filter] ?? definition.targets.filter;
  const maximum = definition.targets.max === null
    ? "范围内所有"
    : definition.targets.max + Math.max(0, slotLevel - definition.level) * (definition.targets.perSlotAbove ?? 0);
  const area = definition.area
    ? ` · ${spellAreaSize(definition, slotLevel)} 尺${AREA_LABEL[definition.area.shape] ?? definition.area.shape}`
    : "";
  if (definition.targets.filter === "self") return `目标：自身${area}`;
  if (definition.targets.filter === "area") return `目标：${target}${area}`;
  return `目标：${maximum} 个${target}${area}`;
}

export function spellResolutionLine(
  definition: SpellDefinition,
  profile?: SpellcastingProfile,
  slotLevel: number = definition.level,
): string {
  const resolution = definition.resolution;
  const damage = resolution.damage
    ? `${formatDice(formulaAtSlot(resolution.damage.formula, definition.level, slotLevel), profile?.castingModifier)} ${DAMAGE_LABEL[resolution.damage.type] ?? resolution.damage.type}伤害`
    : "";
  const healing = resolution.healing
    ? `${formatDice(formulaAtSlot(resolution.healing, definition.level, slotLevel), profile?.castingModifier)} 生命`
    : "";
  if (resolution.special === "magic-missile") return `自动命中 · 每发 ${damage}`;
  if (resolution.special === "sleep-hp-pool") return `${formatDice(formulaAtSlot(resolution.damage!.formula, definition.level, slotLevel))} 生命值池 · 无豁免`;
  if (resolution.mode === "attack") {
    const count = (resolution.attacks ?? 1) + Math.max(0, slotLevel - definition.level) * (resolution.attacksPerSlotAbove ?? 0);
    return `${resolution.attackKind === "melee" ? "近战" : "远程"}法术攻击${count > 1 ? ` ×${count}` : ""}${profile ? ` ${profile.attackBonus >= 0 ? "+" : ""}${profile.attackBonus}` : ""}${damage ? ` · 命中 ${damage}` : ""}`;
  }
  if (resolution.mode === "save" && resolution.save) {
    const result = resolution.save.onSuccess === "half"
      ? "成功伤害减半"
      : resolution.save.onSuccess === "none"
        ? "成功不受伤害"
        : "成功不受状态";
    return `${ABILITY_LABEL[resolution.save.ability]}豁免${profile ? ` DC ${profile.saveDc}` : ""} · ${result}${damage ? ` · 失败 ${damage}` : ""}`;
  }
  if (healing) return `自动生效 · 恢复 ${healing}`;
  if (resolution.effects?.length) return resolution.effects.map((entry) => entry.label).join("；");
  return "自动生效";
}

export function spellStatusLabels(spellId: string): string[] {
  return spellDefinition(spellId)?.resolution.effects?.map((entry) => entry.label) ?? [];
}

export function spellCardFacts(
  spellId: string,
  profile?: SpellcastingProfile,
  slotLevel?: number,
) {
  const definition = spellDefinition(spellId);
  if (!definition) return undefined;
  return {
    definition,
    target: spellTargetLine(definition, slotLevel ?? definition.level),
    resolution: spellResolutionLine(definition, profile, slotLevel ?? definition.level),
    statuses: spellStatusLabels(spellId),
  };
}
