import type { JsonRecord } from "./model";
import {
  hasExactKeys,
  isNonEmptyString,
  isRecord,
} from "./validation";

/**
 * The structural contract for a hazard the KP creates during play.
 *
 * SPEC 0001 section 8 says the KP may invent traps and environmental dangers
 * but "必须确定触发条件、可感知迹象、调查或解除方法、攻击或豁免、影响范围、
 * 伤害、状态、持续时间和环境后果" -- nine properties, all of them settled
 * before the danger is real. Until now none of them were required: a hazard
 * definition only had to carry an id, a revision and a kind, so a danger could
 * be frozen with no sign a character could notice and no way to deal with it.
 *
 * This validates structure and never magnitude. Section 8 is explicit that
 * "高 AC、高 HP、高攻击或高伤害本身不能作为拒绝理由", and section 10 adds that
 * the world does not balance itself around party level, so every bound below
 * is a representability limit -- what the rest of the kernel can carry through
 * a die roll or a canonical integer -- and never a judgement about whether a
 * danger is too strong for the party that walked into it.
 */
export const ENVIRONMENT_HAZARD_KIND = "environmentHazard" as const;
export const ENVIRONMENT_HAZARD_SCHEMA = "zhuwei.environment-hazard-definition/v1" as const;

const SAVE_ABILITIES = new Set(["str", "dex", "con", "int", "wis", "cha"]);

/** `NdM` with an optional signed modifier, the one damage-formula shape the
 * rest of the kernel parses. The ceilings match `canonicalFormula` in
 * combat-actions so a hazard cannot freeze a roll the dice path would refuse. */
const DAMAGE_FORMULA_PATTERN = /^([1-9][0-9]*)d([1-9][0-9]*)([+-][0-9]+)?$/;

function canonicalIntegerString(value: unknown, minimum: number, maximum: number): boolean {
  if (typeof value !== "string" || !/^(0|-?[1-9][0-9]*)$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum;
}

function boundedTextList(
  value: unknown,
  { minimum, maximum = 16 }: { minimum: number; maximum?: number },
): value is string[] {
  return Array.isArray(value)
    && value.length >= minimum
    && value.length <= maximum
    && value.every((entry) => isNonEmptyString(entry) && entry.length <= 400);
}

function canonicalDamageFormula(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = DAMAGE_FORMULA_PATTERN.exec(value);
  if (match === null) return false;
  const count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[3] === undefined ? 0 : Number(match[3]);
  return count <= 100 && sides <= 100 && Math.abs(modifier) <= 1000;
}

/** 触发条件. Each kind names one frozen reference, so a trigger can never be
 * a free-text condition the kernel cannot evaluate. */
function isTrigger(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["kind", "ref"])
    && ["enterZone", "contactFeature", "disturbFeature"].includes(String(value.kind))
    && isNonEmptyString(value.ref);
}

/**
 * 攻击或豁免. A hazard resolves one way or the other and never both, and
 * never neither -- "致命危险必须通过规则结算；KP 不能跳过机械直接宣布角色死亡".
 */
function isResolution(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === "save") {
    return hasExactKeys(value, ["ability", "dc", "kind", "onSuccess"])
      && SAVE_ABILITIES.has(String(value.ability))
      && canonicalIntegerString(value.dc, 1, 30)
      && ["half", "none"].includes(String(value.onSuccess));
  }
  return value.kind === "attack"
    && hasExactKeys(value, ["kind", "modifier"])
    && canonicalIntegerString(value.modifier, -30, 30);
}

/** 影响范围. */
function isArea(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === "burst") {
    return hasExactKeys(value, ["centerRef", "kind", "radiusInches"])
      && isNonEmptyString(value.centerRef)
      && canonicalIntegerString(value.radiusInches, 1, 100_000);
  }
  return ["zone", "single"].includes(String(value.kind))
    && hasExactKeys(value, ["kind", "ref"])
    && isNonEmptyString(value.ref);
}

/** 伤害. A flat amount and a rolled formula are separate closed shapes so a
 * hazard can never freeze both and leave the settlement to choose. */
function isDamage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === "fixed") {
    return hasExactKeys(value, ["amount", "damageType", "kind"])
      && canonicalIntegerString(value.amount, 1, 1_000_000)
      && isNonEmptyString(value.damageType);
  }
  return value.kind === "roll"
    && hasExactKeys(value, ["damageType", "formula", "kind"])
    && canonicalDamageFormula(value.formula)
    && isNonEmptyString(value.damageType);
}

export function isEnvironmentHazardDefinition(value: unknown): value is JsonRecord {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "causalBasisRefs",
      "content",
      "definitionId",
      "definitionKind",
      "revision",
      "rulesBasis",
      "visibilityPolicyRef",
    ])
    || !isNonEmptyString(value.definitionId)
    || value.definitionKind !== ENVIRONMENT_HAZARD_KIND
    || !canonicalIntegerString(value.revision, 1, 1_000_000)
    || !["srd5.1-2014", "zhuwei-product-ruling"].includes(String(value.rulesBasis))
    || !boundedTextList(value.causalBasisRefs, { minimum: 0, maximum: 40 })
    || !isNonEmptyString(value.visibilityPolicyRef)
    || !isRecord(value.content)) return false;

  const content = value.content;
  // Every one of section 8's nine properties, plus the schema tag and a label
  // to name the danger. `hasExactKeys` rather than `hasOnlyKeys`: a hazard with
  // a property left out is one the KP did not settle, which is the failure the
  // specification names.
  if (!hasExactKeys(content, [
    "area",
    "conditions",
    "damage",
    "disableMethods",
    "durationMicros",
    "environmentalConsequences",
    "label",
    "perceptibleSigns",
    "resolution",
    "schema",
    "trigger",
  ])) return false;

  return content.schema === ENVIRONMENT_HAZARD_SCHEMA
    && isNonEmptyString(content.label)
    && String(content.label).length <= 200
    // 触发条件
    && isTrigger(content.trigger)
    // 可感知迹象 and 调查或解除方法 are required to be non-empty, not merely
    // present. Section 10 requires a risk with a perceptible basis to be
    // foreshadowed "以痕迹、传闻、环境、NPC 反应或其他世界内方式", and a danger
    // with no sign and no way to deal with it is unfair by construction rather
    // than by design -- which is the one thing "不怜悯" does not license.
    && boundedTextList(content.perceptibleSigns, { minimum: 1 })
    && boundedTextList(content.disableMethods, { minimum: 1 })
    // 攻击或豁免
    && isResolution(content.resolution)
    // 影响范围
    && isArea(content.area)
    // 伤害
    && isDamage(content.damage)
    // 状态 and 环境后果 may legitimately be none -- a dart trap leaves neither
    // -- but the KP still has to have settled the question, so the field is
    // required and an empty list is the explicit answer.
    && boundedTextList(content.conditions, { minimum: 0 })
    && boundedTextList(content.environmentalConsequences, { minimum: 0 })
    // 持续时间. "0" is an instantaneous hazard, which is most of them.
    && canonicalIntegerString(content.durationMicros, 0, 86_400_000_000);
}

/**
 * A definition claims this contract by tagging its content with the schema,
 * not merely by calling itself a hazard.
 *
 * The distinction matters because `environmentHazard` was free text before
 * this contract existed: definitions already in play carry that kind with an
 * Ability-shaped body, and they are still triggerable. Keying on the schema
 * lets the contract bind exactly the definitions written against it, so the
 * older shape neither breaks nor is quietly blessed as conforming.
 */
export function isEnvironmentHazardDefinitionCandidate(value: unknown): boolean {
  return isRecord(value)
    && value.definitionKind === ENVIRONMENT_HAZARD_KIND
    && isRecord(value.content)
    && value.content.schema === ENVIRONMENT_HAZARD_SCHEMA;
}
