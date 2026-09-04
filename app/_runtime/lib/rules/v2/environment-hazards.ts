import type { JsonRecord } from "./model";
import { isRegisteredAbilityRecord } from "../profiles/ability-compiler";
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
 * 伤害、状态、持续时间和环境后果" -- nine properties, all settled before the
 * danger is real. Until this contract existed none of them were required: a
 * definition only had to carry an id, a revision and a kind, so a danger could
 * be frozen with no sign a character could notice and no way to deal with it.
 *
 * The nine split in two, and the split is the whole design.
 *
 * Four are about how the danger meets the fiction -- what sets it off, what it
 * shows, how it can be found or defused, what it leaves behind -- and nothing
 * else in the kernel models them, so they live here.
 *
 * The other five -- attack or save, area, damage, conditions, duration -- are
 * mechanics, and the kernel already has a general way to express and execute
 * mechanics: a compiled ability definition. That compiler validates saves,
 * attack rolls, area targets, damage components, granted effects and their
 * durations against the 2014 rules and lowers them into the primitives the
 * kernel executes. Restating those five as bespoke fields here would hand the
 * KP a narrow template in place of a vocabulary it already has, so a hazard
 * names an ability instead, through `mechanicsRef`.
 *
 * That reference has to be registered already. Section 10 says a danger
 * "只在事实已经存在或已按第 7 节固化后生效", and an ability is frozen by its
 * own registration, so a hazard citing an unregistered one is a danger whose
 * numbers were never settled.
 */
export const ENVIRONMENT_HAZARD_KIND = "environmentHazard" as const;
export const ENVIRONMENT_HAZARD_SCHEMA = "zhuwei.environment-hazard-definition/v1" as const;

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

/** 触发条件. Each kind names one frozen reference, so a trigger can never be a
 * free-text condition the kernel has no way to evaluate. */
function isTrigger(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["kind", "ref"])
    && ["enterZone", "contactFeature", "disturbFeature"].includes(String(value.kind))
    && isNonEmptyString(value.ref);
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
  // `hasExactKeys` rather than `hasOnlyKeys`: a hazard missing a property is
  // one the KP did not finish settling, which is the failure section 8 names.
  if (!hasExactKeys(content, [
    "disableMethods",
    "environmentalConsequences",
    "label",
    "mechanicsRef",
    "perceptibleSigns",
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
    // 环境后果 may legitimately be none -- a dart trap leaves nothing behind --
    // but the KP still has to have settled the question, so the field is
    // required and an empty list is the explicit answer.
    && boundedTextList(content.environmentalConsequences, { minimum: 0 })
    // 攻击或豁免、影响范围、伤害、状态、持续时间, all five, by reference.
    && isNonEmptyString(content.mechanicsRef);
}

/**
 * A definition claims this contract by tagging its content with the schema,
 * not merely by calling itself a hazard.
 *
 * The distinction matters because `environmentHazard` was free text before
 * this contract existed: definitions already in play carry that kind with an
 * Ability-shaped body and are still triggerable. Keying on the schema binds
 * the contract to exactly the definitions written against it, so the older
 * shape is neither broken nor quietly counted as conforming.
 */
export function isEnvironmentHazardDefinitionCandidate(value: unknown): boolean {
  return isRecord(value)
    && value.definitionKind === ENVIRONMENT_HAZARD_KIND
    && isRecord(value.content)
    && value.content.schema === ENVIRONMENT_HAZARD_SCHEMA;
}

/**
 * The frozen mechanics a hazard settles through, or undefined when the danger
 * cites something that was never registered as an executable ability.
 */
export function environmentHazardMechanics(
  definitions: Readonly<Record<string, unknown>>,
  hazard: unknown,
): JsonRecord | undefined {
  if (!isEnvironmentHazardDefinition(hazard)) return undefined;
  const content = hazard.content as JsonRecord;
  const mechanics = definitions[String(content.mechanicsRef)];
  return isRegisteredAbilityRecord(mechanics) ? mechanics as JsonRecord : undefined;
}
