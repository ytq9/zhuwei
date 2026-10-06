import type { AuthoredSourceSchema } from "./authored-materialization";
import { CONDITION_IDS } from "./condition-vocabulary";

// Shared wire grammar has no dependency on the combat executor.
export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing",
  "poison", "psychic", "radiant", "slashing", "thunder"] as const;
export const DEATH_POLICIES = ["deadAtZero", "deathSaves", "defeatedAtZero"] as const;

type Schema = AuthoredSourceSchema;
const object = (properties: Record<string, Schema>): Schema => ({ type: "object", properties,
  required: Object.keys(properties), additionalProperties: false });
const text: Schema = { type: "string", pattern: "[\\s\\S]+" };
const values = (...entries: readonly string[]): Schema => ({ type: "string", enum: [...entries] });
const integer = (minimum: number, maximum: number): Schema => ({ type: "integer", minimum, maximum });
export const COMBAT_DAMAGE_PATTERN = "^[1-9][0-9]?d(4|6|8|10|12|20)([+-][1-9][0-9]?)?$";
const damage: Schema = { type: "string", pattern: COMBAT_DAMAGE_PATTERN };

/** The creature slot of the start's source schema. A request narrows every
 * occurrence of this very object to its frozen creature choices; the
 * predicate and `combatStartIssues` below stay the accepting authority. */
export const COMBAT_START_CREATURE_SLOT: Schema = Object.freeze({ type: "string", pattern: "^\\S+$" });

function combatStartSourceProperties(): Record<string, Schema> {
  const creature = COMBAT_START_CREATURE_SLOT;
  const duration: Schema = { anyOf: [
    object({ kind: values("timed"), durationMicros: { type: "string", pattern: "^[1-9][0-9]*$" } }),
    object({ kind: values("untilEnded") }),
    object({ kind: values("turnBoundary"), subject: values("source", "target"), edge: values("turnStart", "turnEnd") }),
  ] };
  const effects: Schema = { type: "array", items: { anyOf: [
    object({ kind: values("grantEffect"), condition: values(...CONDITION_IDS.filter(value => value !== "exhaustion")), duration }),
    object({ kind: values("grantEffect"), condition: values("exhaustion"), duration, level: integer(1, 6) }),
  ] } };
  const attackVariants: Schema[] = [
    object({ kind: values("meleeAttack"), label: text, ability: values(...ABILITIES), reachFeet: integer(5, 15),
      damage, damageType: values(...DAMAGE_TYPES) }),
    object({ kind: values("rangedAttack"), label: text, ability: values(...ABILITIES), normalRangeFeet: integer(5, 600),
      longRangeFeet: integer(5, 1200), damage, damageType: values(...DAMAGE_TYPES) }),
    object({ kind: values("saveEffect"), label: text, saveAbility: values(...ABILITIES), dc: integer(1, 30),
      rangeFeet: integer(5, 600), damage, damageType: values(...DAMAGE_TYPES), halfOnSuccess: { type: "boolean" } }),
  ];
  const attack: Schema = { anyOf: attackVariants.flatMap(variant => [variant,
    object({ ...variant.properties as Record<string, Schema>, effects,
      effectSave: { type: "array", items: object({ ability: values(...ABILITIES), dc: integer(1, 30) }) } })]) };
  const statistics = { npcRef: creature, armorClass: integer(1, 30), speedFeet: integer(0, 200),
    hitPointsMaximum: integer(1, 1_000_000), deathPolicy: values(...DEATH_POLICIES), attacks: { type: "array", items: attack } };
  return {
    participants: { type: "array", items: object({ creatureRef: creature, surprise: { anyOf: [
      object({ kind: values("aware") }), object({ kind: values("surprised"), basis: text })] } }) },
    hostilities: { type: "array", items: object({ fromRefs: { type: "array", items: creature }, toRefs: { type: "array", items: creature } }) },
    combatStatistics: { type: "array", items: { anyOf: [object(statistics), object({ ...statistics,
      damageDefenses: object(Object.fromEntries(["immune", "resistant", "vulnerable"].map(key => [key, { type: "array", items: values(...DAMAGE_TYPES) }]))),
      multiattack: { type: "array", items: object({ attackIndex: integer(0, 7), count: integer(1, 99) }) },
    })] } },
    description: text,
  };
}
export const COMBAT_START_SOURCE_SCHEMA: Schema = object(combatStartSourceProperties());
