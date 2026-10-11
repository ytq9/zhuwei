import { CONDITION_IDS, type ConditionId } from "./condition-vocabulary";
import { RulesValidationError } from "../errors";
import { canonicalSha256, sameCanonical } from "../profiles/canonical";
import { isRegisteredAbilityRecord } from "../profiles/ability-compiler";
import { COMBAT_ROUND_MICROS } from "../profiles/fiction-time";
import { combatPhaseExpiryAnchor, remainingCombatPhaseDuration } from "./effect-phase";
import type { AuthoritativeWorldState, EventEnvelope, JsonRecord } from "./model";
import { characterTimelineId } from "./timeline";
import { hasExactKeys, hasOnlyKeys, isNonEmptyString, isRecord, isSha256 } from "./validation";
import { spatialRecordVisibleTo, spatialVisibilityPolicyKind } from "./spatial-visibility";

export const WORLD_EFFECT_SCHEMA = "zhuwei.condition-effect/v1" as const;
export { CONDITION_IDS, type ConditionId } from "./condition-vocabulary";
export type WorldEffectDuration =
  | { kind: "timed"; durationMicros: string }
  | { kind: "untilEnded" }
  | { kind: "turnBoundary"; subject: "source" | "target"; edge: "turnStart" | "turnEnd" };
/** SPEC 0012 §10.1: how a granted condition can end besides its duration. */
export const WORLD_EFFECT_ENDINGS = ["bonusDieUsed", "harmedBySourceSide", "targetAttacked", "targetAttacksOrCasts", "targetDonsArmor"] as const;
export type WorldEffectEnding = typeof WORLD_EFFECT_ENDINGS[number];
export type WorldEffectLifecycle = {
  /** Ends when its source's concentration ends (SPEC 0012 §10.2). */
  concentration?: true;
  /** The target repeats the Ability's saving throw at the end of each of its turns. */
  repeatSave?: { edge: "turnEnd" };
  endsWhen?: WorldEffectEnding[];
  /** Damage the target takes at the start of each of its turns (SRD Ensnaring Strike). */
  turnStartDamage?: { formula: string; type: string };
  /** An action's ability check that frees the target, by it or a creature
   * that can touch it (SRD Ensnaring Strike). */
  escape?: { ability: string };
};
export type WorldEffectDefinition = {
  kind: "grantEffect";
  condition: ConditionId;
  duration: WorldEffectDuration;
  level?: number;
  lifecycle?: WorldEffectLifecycle;
};
/** The record keeps the save it repeats and the check that frees it, frozen
 * when the effect began. */
export type WorldEffectRecordLifecycle = Omit<WorldEffectLifecycle, "repeatSave" | "escape"> & {
  repeatSave?: { edge: "turnEnd"; ability: string; dc: number };
  escape?: { ability: string; dc: number };
};
export type WorldEffectEndDefinition = {
  kind: "endEffect";
  condition: ConditionId;
  sourceRef: string | null;
};
type Expiry =
  | { kind: "fictionTime"; entityId: string; dueMicros: string }
  | { kind: "turnStart" | "turnEnd"; entityId: string; encounterId: string; targetRound: number;
      initiativeOrderHash: string; slotIndex: number; entryCount: number;
      createdAt: { rootActionId: string; roundIndex: number; initiativeOrderHash: string;
        slotIndex: number; edge: "turnStart" | "turnEnd" } }
  | null;
type Suspension = {
  startedAtFictionMicros: string;
  remainingMicros: string | null;
  remainingBoundaries: number | null;
} | null;
export type WorldEffectRecord = JsonRecord & {
  schema: typeof WORLD_EFFECT_SCHEMA;
  effectId: string;
  kind: "condition";
  sourceRef: string;
  sourceDefinitionRef: string;
  targetEntityId: string;
  condition: ConditionId;
  level: number | null;
  duration: WorldEffectDuration;
  startedAtFictionMicros: string;
  pausedMicros: string;
  suspension: Suspension;
  expiresAt: Expiry;
  visibilityPolicyId: string;
  visibilityFactId: string | null;
  lifecycle?: WorldEffectRecordLifecycle;
};
/** SPEC 0012 §10.1: a modifier a lasting effect puts on its target's
 * effective values. Effects of one kind do not stack: the strongest holds. */
export type EffectModifier =
  | { kind: "armorClassBonus"; amount: number }
  | { kind: "unarmoredArmorClass"; base: number }
  | { kind: "speedBonus"; feet: number }
  | { kind: "noReactions" }
  | { kind: "advantageOnNextAttackAgainst" }
  | { kind: "hitPointMaximumBonus"; amount: number }
  | { kind: "d20BonusDie"; sides: number; rolls: ("attack" | "check" | "save")[] }
  | { kind: "weaponDamageDieFromSource"; sides: number }
  | { kind: "weaponHitRider"; save: string; largerSaveAdvantage: boolean };
export type ModifierEffectDefinition = {
  kind: "grantModifier";
  modifier: EffectModifier;
  duration: WorldEffectDuration;
  lifecycle?: WorldEffectLifecycle;
};
export const MODIFIER_EFFECT_SCHEMA = "zhuwei.modifier-effect/v1" as const;
export type ModifierEffectRecord = JsonRecord & {
  schema: typeof MODIFIER_EFFECT_SCHEMA;
  effectId: string;
  kind: "modifier";
  sourceRef: string;
  sourceDefinitionRef: string;
  targetEntityId: string;
  modifier: EffectModifier;
  duration: WorldEffectDuration;
  startedAtFictionMicros: string;
  pausedMicros: "0";
  suspension: null;
  expiresAt: Expiry;
  visibilityPolicyId: string;
  visibilityFactId: string | null;
  lifecycle?: WorldEffectLifecycle;
};
/** SPEC 0012 §10.1: an area an effect fills for its duration (SRD Fog Cloud,
 * Silence), a sphere frozen where it was cast. */
export const ZONE_KINDS = ["heavilyObscured", "silence", "spectralWeapon"] as const;
export type ZoneKind = typeof ZONE_KINDS[number];
export type ZoneEffectDefinition = {
  kind: "createZone";
  zone: { kind: ZoneKind };
  duration: WorldEffectDuration;
  lifecycle?: WorldEffectLifecycle;
  /** Abilities its caster may use while it lasts (SRD Spiritual Weapon). */
  grants?: string[];
};
export const ZONE_EFFECT_SCHEMA = "zhuwei.zone-effect/v1" as const;
/** A zone keeps time and ends by its caster: `targetEntityId` is the caster. */
export type ZoneEffectRecord = JsonRecord & {
  schema: typeof ZONE_EFFECT_SCHEMA;
  effectId: string;
  kind: "zone";
  zone: { kind: ZoneKind };
  sourceRef: string;
  sourceDefinitionRef: string;
  targetEntityId: string;
  sceneId: string;
  origin: { x: string; y: string; elevation: string };
  radiusInches: string;
  duration: WorldEffectDuration;
  startedAtFictionMicros: string;
  pausedMicros: "0";
  suspension: null;
  expiresAt: Expiry;
  visibilityPolicyId: string;
  visibilityFactId: string | null;
  lifecycle?: WorldEffectLifecycle;
  grants?: string[];
};
/** A granted condition, a modifier or a zone: the effects with a duration, a
 * concentration link and early endings. */
export type LastingEffectRecord = WorldEffectRecord | ModifierEffectRecord | ZoneEffectRecord;
export type WorldEffectEndDraft = {
  eventType: "EffectEnded";
  payload: { effectId: string; targetEntityId: string; reason: string };
  visibilityPolicyId: string;
  secrecy: "internal";
};

function unsignedMicros(value: unknown, positive = false): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)
    && (!positive || value !== "0");
}

function conditionId(value: unknown): value is ConditionId {
  return typeof value === "string" && (CONDITION_IDS as readonly string[]).includes(value);
}

export function isConditionImmunities(value: unknown): value is ConditionId[] {
  return Array.isArray(value) && value.every(conditionId)
    && value.length === new Set(value).size
    && value.every((entry, index) => index === 0 || value[index - 1] < entry);
}

export function isWorldEffectDuration(value: unknown): value is WorldEffectDuration {
  if (!isRecord(value)) return false;
  if (value.kind === "untilEnded") return hasExactKeys(value, ["kind"]);
  if (value.kind === "timed") {
    return hasExactKeys(value, ["durationMicros", "kind"])
      && unsignedMicros(value.durationMicros, true);
  }
  return hasExactKeys(value, ["edge", "kind", "subject"])
    && value.kind === "turnBoundary"
    && (value.subject === "source" || value.subject === "target")
    && (value.edge === "turnStart" || value.edge === "turnEnd");
}

const SAVE_ABILITIES = ["cha", "con", "dex", "int", "str", "wis"] as const;

function isWorldEffectLifecycle(value: unknown): value is WorldEffectLifecycle {
  return isRecord(value) && hasOnlyKeys(value, [], ["concentration", "endsWhen", "escape", "repeatSave", "turnStartDamage"])
    && Object.keys(value).length > 0
    && (value.turnStartDamage === undefined || (isRecord(value.turnStartDamage) && hasExactKeys(value.turnStartDamage, ["formula", "type"])
      && typeof value.turnStartDamage.formula === "string" && /^[1-9][0-9]?d(4|6|8|10|12)$/.test(value.turnStartDamage.formula)
      && isNonEmptyString(value.turnStartDamage.type)))
    && (value.escape === undefined || (isRecord(value.escape) && hasExactKeys(value.escape, ["ability"])
      && (SAVE_ABILITIES as readonly unknown[]).includes(value.escape.ability)))
    && (value.concentration === undefined || value.concentration === true)
    && (value.repeatSave === undefined
      || (isRecord(value.repeatSave) && hasExactKeys(value.repeatSave, ["edge"]) && value.repeatSave.edge === "turnEnd"))
    && (value.endsWhen === undefined || (Array.isArray(value.endsWhen) && value.endsWhen.length > 0
      && value.endsWhen.every((ending, index, all) => (WORLD_EFFECT_ENDINGS as readonly unknown[]).includes(ending)
        && (index === 0 || String(all[index - 1]) < String(ending)))));
}

function isWorldEffectRecordLifecycle(value: unknown): value is WorldEffectRecordLifecycle {
  if (!isRecord(value)) return false;
  const frozenDc = (dc: unknown) => Number.isSafeInteger(dc) && Number(dc) >= 0 && Number(dc) <= 30;
  const repeatSave = value.repeatSave, escape = value.escape;
  if (repeatSave !== undefined && (!isRecord(repeatSave) || !hasExactKeys(repeatSave, ["ability", "dc", "edge"])
    || !(SAVE_ABILITIES as readonly unknown[]).includes(repeatSave.ability) || !frozenDc(repeatSave.dc))) return false;
  if (escape !== undefined && (!isRecord(escape) || !hasExactKeys(escape, ["ability", "dc"]) || !frozenDc(escape.dc))) return false;
  return isWorldEffectLifecycle(definitionLifecycle(value as WorldEffectRecordLifecycle));
}

/** The frozen definition a record's lifecycle came from. */
function definitionLifecycle(lifecycle: WorldEffectRecordLifecycle): WorldEffectLifecycle {
  const { repeatSave, escape, ...rest } = lifecycle;
  return { ...rest, ...(repeatSave === undefined ? {} : { repeatSave: { edge: repeatSave.edge } }),
    ...(escape === undefined ? {} : { escape: { ability: escape.ability } }) };
}

/** The Ability Effect family owns this shape; a hazard only references it.
 * A spell's effect also carries its catalog tag and label for narration;
 * the frozen mechanic leaves them out. */
export function worldEffectDefinition(value: unknown): WorldEffectDefinition | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ["condition", "duration", "kind"], ["label", "level", "lifecycle", "on", "tag"])
    || !(value.on === undefined || value.on === "weaponHit")
    || value.kind !== "grantEffect" || !conditionId(value.condition)
    || !isWorldEffectDuration(value.duration)
    || !(value.tag === undefined || isNonEmptyString(value.tag))
    || !(value.label === undefined || isNonEmptyString(value.label))
    || !(value.lifecycle === undefined || isWorldEffectLifecycle(value.lifecycle))) return undefined;
  if (value.condition === "exhaustion"
    ? !Number.isSafeInteger(value.level) || Number(value.level) < 1 || Number(value.level) > 6
    : value.level !== undefined) return undefined;
  // `on` says when the Ability applies it (SRD Ensnaring Strike: on a later
  // weapon hit), not what it is.
  const { tag: _tag, label: _label, on: _on, ...mechanic } = structuredClone(value);
  return mechanic as WorldEffectDefinition;
}

/** The definition a stored record must match in its frozen Ability. */
function recordDefinition(effect: WorldEffectRecord): WorldEffectDefinition {
  return {
    kind: "grantEffect", condition: effect.condition, duration: effect.duration,
    ...(effect.level === null ? {} : { level: effect.level }),
    ...(effect.lifecycle === undefined ? {} : { lifecycle: definitionLifecycle(effect.lifecycle) }),
  };
}

export function worldEffectEndDefinition(value: unknown): WorldEffectEndDefinition | undefined {
  return isRecord(value) && hasExactKeys(value, ["condition", "kind", "sourceRef"])
    && value.kind === "endEffect" && conditionId(value.condition)
    && (value.sourceRef === null || isNonEmptyString(value.sourceRef))
    ? structuredClone(value) as WorldEffectEndDefinition : undefined;
}

const D20_BONUS_ROLLS = ["attack", "check", "save"] as const;
const boundedInteger = (value: unknown, minimum: number, maximum: number): boolean =>
  Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;

export function isEffectModifier(value: unknown): value is EffectModifier {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "armorClassBonus":
    case "hitPointMaximumBonus": return hasExactKeys(value, ["amount", "kind"]) && boundedInteger(value.amount, 1, 99);
    case "unarmoredArmorClass": return hasExactKeys(value, ["base", "kind"]) && boundedInteger(value.base, 1, 99);
    case "speedBonus": return hasExactKeys(value, ["feet", "kind"]) && boundedInteger(value.feet, -1000, 1000)
      && value.feet !== 0 && Number(value.feet) % 5 === 0;
    case "noReactions":
    case "advantageOnNextAttackAgainst": return hasExactKeys(value, ["kind"]);
    case "d20BonusDie": return hasExactKeys(value, ["kind", "rolls", "sides"]) && [4, 6, 8, 10, 12].includes(Number(value.sides))
      && Array.isArray(value.rolls) && value.rolls.length > 0
      && value.rolls.every((roll, index, all) => (D20_BONUS_ROLLS as readonly unknown[]).includes(roll)
        && (index === 0 || String(all[index - 1]) < String(roll)));
    case "weaponDamageDieFromSource": return hasExactKeys(value, ["kind", "sides"]) && [4, 6, 8, 10, 12].includes(Number(value.sides));
    case "weaponHitRider": return hasExactKeys(value, ["kind", "largerSaveAdvantage", "save"])
      && (SAVE_ABILITIES as readonly unknown[]).includes(value.save) && typeof value.largerSaveAdvantage === "boolean";
    default: return false;
  }
}

/** The Ability Effect family's modifier shape. Like a condition, a spell's
 * modifier carries its catalog tag and label, which the frozen mechanic
 * leaves out; a modifier repeats no save. */
export function modifierEffectDefinition(value: unknown): ModifierEffectDefinition | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ["duration", "kind", "modifier"], ["label", "lifecycle", "tag"])
    || value.kind !== "grantModifier" || !isEffectModifier(value.modifier)
    || !isWorldEffectDuration(value.duration)
    || !(value.tag === undefined || isNonEmptyString(value.tag))
    || !(value.label === undefined || isNonEmptyString(value.label))
    || !(value.lifecycle === undefined || (isWorldEffectLifecycle(value.lifecycle) && value.lifecycle.repeatSave === undefined))) return undefined;
  const { tag: _tag, label: _label, ...mechanic } = structuredClone(value);
  return mechanic as ModifierEffectDefinition;
}

function modifierRecordDefinition(effect: ModifierEffectRecord): ModifierEffectDefinition {
  return { kind: "grantModifier", modifier: effect.modifier, duration: effect.duration,
    ...(effect.lifecycle === undefined ? {} : { lifecycle: effect.lifecycle }) };
}

export function zoneEffectDefinition(value: unknown): ZoneEffectDefinition | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ["duration", "kind", "zone"], ["grants", "label", "lifecycle", "tag"])
    || !(value.grants === undefined || (Array.isArray(value.grants) && value.grants.length > 0 && value.grants.length <= 4
      && value.grants.every((ref, index, all) => isNonEmptyString(ref) && (index === 0 || String(all[index - 1]) < ref))))
    || value.kind !== "createZone" || !isRecord(value.zone) || !hasExactKeys(value.zone, ["kind"])
    || !(ZONE_KINDS as readonly unknown[]).includes(value.zone.kind)
    || !isWorldEffectDuration(value.duration)
    || !(value.tag === undefined || isNonEmptyString(value.tag))
    || !(value.label === undefined || isNonEmptyString(value.label))
    || !(value.lifecycle === undefined || (isWorldEffectLifecycle(value.lifecycle)
      && value.lifecycle.repeatSave === undefined && value.lifecycle.endsWhen === undefined))) return undefined;
  const { tag: _tag, label: _label, ...mechanic } = structuredClone(value);
  return mechanic as ZoneEffectDefinition;
}

function zoneRecordDefinition(effect: ZoneEffectRecord): ZoneEffectDefinition {
  return { kind: "createZone", zone: effect.zone, duration: effect.duration,
    ...(effect.lifecycle === undefined ? {} : { lifecycle: effect.lifecycle }),
    ...(effect.grants === undefined ? {} : { grants: effect.grants }) };
}

export function isWorldEffectRecordCandidate(value: unknown): boolean {
  return isRecord(value) && [WORLD_EFFECT_SCHEMA, MODIFIER_EFFECT_SCHEMA, ZONE_EFFECT_SCHEMA].includes(String(value.schema) as never);
}

function registeredEffectMatches(
  state: AuthoritativeWorldState, sourceDefinitionRef: string,
  definition: WorldEffectDefinition | WorldEffectEndDefinition | ModifierEffectDefinition | ZoneEffectDefinition,
): boolean {
  const source = state.campaignRuntime.definitions[sourceDefinitionRef]
    ?? state.combatRuntime.definitions[sourceDefinitionRef];
  if (!isRegisteredAbilityRecord(source) || !isRecord(source.mechanicGraph)
    || !Array.isArray(source.mechanicGraph.operations)) return false;
  return source.mechanicGraph.operations.some((operation) => {
    if (!isRecord(operation) || operation.family !== "Effect" || !isRecord(operation.input)) return false;
    const input = operation.input.effect ?? operation.input;
    const frozen = worldEffectDefinition(input) ?? worldEffectEndDefinition(input) ?? modifierEffectDefinition(input)
      ?? zoneEffectDefinition(input);
    return frozen !== undefined && sameCanonical(frozen, definition);
  });
}

function validExpiry(value: unknown): value is Expiry {
  if (value === null) return true;
  if (!isRecord(value) || !isNonEmptyString(value.entityId)) return false;
  if (value.kind === "fictionTime") {
    return hasExactKeys(value, ["dueMicros", "entityId", "kind"])
      && unsignedMicros(value.dueMicros);
  }
  return hasExactKeys(value, ["createdAt", "encounterId", "entityId", "entryCount", "initiativeOrderHash", "kind", "slotIndex", "targetRound"])
    && (value.kind === "turnStart" || value.kind === "turnEnd")
    && isNonEmptyString(value.encounterId)
    && Number.isSafeInteger(value.targetRound) && Number(value.targetRound) >= 1
    && isSha256(value.initiativeOrderHash)
    && Number.isSafeInteger(value.entryCount) && Number(value.entryCount) >= 1
    && Number.isSafeInteger(value.slotIndex) && Number(value.slotIndex) >= 0
    && Number(value.slotIndex) < Number(value.entryCount)
    && isRecord(value.createdAt)
    && hasExactKeys(value.createdAt, ["edge", "initiativeOrderHash", "rootActionId", "roundIndex", "slotIndex"])
    && isNonEmptyString(value.createdAt.rootActionId)
    && value.createdAt.initiativeOrderHash === value.initiativeOrderHash
    && Number.isSafeInteger(value.createdAt.roundIndex) && Number(value.createdAt.roundIndex) >= 1
    && Number.isSafeInteger(value.createdAt.slotIndex) && Number(value.createdAt.slotIndex) >= 0
    && Number(value.createdAt.slotIndex) < Number(value.entryCount)
    && (value.createdAt.edge === "turnStart" || value.createdAt.edge === "turnEnd");
}

export function isWorldEffectRecord(value: unknown): value is WorldEffectRecord {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "condition", "duration", "effectId", "expiresAt", "kind", "level", "schema",
    "sourceDefinitionRef", "sourceRef", "startedAtFictionMicros", "targetEntityId", "pausedMicros", "suspension",
    "visibilityFactId", "visibilityPolicyId",
  ], ["lifecycle"]) || value.schema !== WORLD_EFFECT_SCHEMA
    || !(value.lifecycle === undefined || isWorldEffectRecordLifecycle(value.lifecycle)) || value.kind !== "condition"
    || ![value.effectId, value.sourceRef, value.sourceDefinitionRef, value.targetEntityId]
      .every(isNonEmptyString)
    || !unsignedMicros(value.startedAtFictionMicros) || !unsignedMicros(value.pausedMicros)
    || !validExpiry(value.expiresAt)
    || spatialVisibilityPolicyKind(value.visibilityPolicyId) === undefined
    || !(value.visibilityFactId === null || isNonEmptyString(value.visibilityFactId))) return false;
  const definition = worldEffectDefinition(recordDefinition(value as WorldEffectRecord));
  if (definition === undefined) return false;
  if (definition.condition !== "poisoned" && (value.pausedMicros !== "0" || value.suspension !== null)) return false;
  if (value.suspension !== null) {
    const suspended = value.suspension;
    if (!isRecord(suspended) || !hasExactKeys(suspended,
      ["remainingBoundaries", "remainingMicros", "startedAtFictionMicros"])
      || !unsignedMicros(suspended.startedAtFictionMicros)
      || BigInt(suspended.startedAtFictionMicros) < BigInt(value.startedAtFictionMicros)
      || (value.expiresAt === null
        ? suspended.remainingMicros !== null
        : !unsignedMicros(suspended.remainingMicros))
      || (value.expiresAt === null || value.expiresAt.kind === "fictionTime"
        ? suspended.remainingBoundaries !== null
        : !Number.isSafeInteger(suspended.remainingBoundaries) || Number(suspended.remainingBoundaries) < 0)) return false;
  }
  if (value.visibilityPolicyId === "visibility:hidden-until-evidence"
    && !isNonEmptyString(value.visibilityFactId)) return false;
  return expiryMatchesDuration(value as LastingEffectRecord, definition.duration);
}

/** The stored expiry is the one its duration gives from its start. */
function expiryMatchesDuration(value: LastingEffectRecord, duration: WorldEffectDuration): boolean {
  if (duration.kind === "untilEnded") return value.expiresAt === null;
  if (value.expiresAt === null) return false;
  if (duration.kind === "timed") {
    return value.expiresAt.kind === "fictionTime"
      && value.expiresAt.entityId === value.targetEntityId
      && BigInt(value.expiresAt.dueMicros)
        === BigInt(value.startedAtFictionMicros) + BigInt(duration.durationMicros) + BigInt(value.pausedMicros);
  }
  const expectedSubject = duration.subject === "target"
    ? value.targetEntityId : value.sourceRef;
  return value.expiresAt.entityId === expectedSubject
    && (value.expiresAt.kind === duration.edge
      || value.expiresAt.kind === "fictionTime");
}

export function isModifierEffectRecord(value: unknown): value is ModifierEffectRecord {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "duration", "effectId", "expiresAt", "kind", "modifier", "pausedMicros", "schema",
    "sourceDefinitionRef", "sourceRef", "startedAtFictionMicros", "suspension", "targetEntityId",
    "visibilityFactId", "visibilityPolicyId",
  ], ["lifecycle"]) || value.schema !== MODIFIER_EFFECT_SCHEMA || value.kind !== "modifier"
    || ![value.effectId, value.sourceRef, value.sourceDefinitionRef, value.targetEntityId].every(isNonEmptyString)
    || !unsignedMicros(value.startedAtFictionMicros) || value.pausedMicros !== "0" || value.suspension !== null
    || !validExpiry(value.expiresAt)
    || spatialVisibilityPolicyKind(value.visibilityPolicyId) === undefined
    || !(value.visibilityFactId === null || isNonEmptyString(value.visibilityFactId))
    || (value.visibilityPolicyId === "visibility:hidden-until-evidence" && !isNonEmptyString(value.visibilityFactId))) return false;
  const definition = modifierEffectDefinition(modifierRecordDefinition(value as ModifierEffectRecord));
  return definition !== undefined && expiryMatchesDuration(value as LastingEffectRecord, definition.duration);
}

const integerString = (value: unknown): value is string => typeof value === "string" && /^-?(0|[1-9][0-9]*)$/.test(value) && value !== "-0";

export function isZoneEffectRecord(value: unknown): value is ZoneEffectRecord {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "duration", "effectId", "expiresAt", "kind", "origin", "pausedMicros", "radiusInches", "sceneId", "schema",
    "sourceDefinitionRef", "sourceRef", "startedAtFictionMicros", "suspension", "targetEntityId",
    "visibilityFactId", "visibilityPolicyId", "zone",
  ], ["grants", "lifecycle"]) || value.schema !== ZONE_EFFECT_SCHEMA || value.kind !== "zone"
    || ![value.effectId, value.sourceRef, value.sourceDefinitionRef, value.targetEntityId, value.sceneId].every(isNonEmptyString)
    || value.targetEntityId !== value.sourceRef
    || !isRecord(value.origin) || !hasExactKeys(value.origin, ["elevation", "x", "y"])
    || ![value.origin.x, value.origin.y, value.origin.elevation].every(integerString)
    || !unsignedMicros(value.radiusInches, true)
    || !unsignedMicros(value.startedAtFictionMicros) || value.pausedMicros !== "0" || value.suspension !== null
    || !validExpiry(value.expiresAt)
    || spatialVisibilityPolicyKind(value.visibilityPolicyId) === undefined
    || !(value.visibilityFactId === null || isNonEmptyString(value.visibilityFactId))) return false;
  const definition = zoneEffectDefinition(zoneRecordDefinition(value as ZoneEffectRecord));
  return definition !== undefined && expiryMatchesDuration(value as LastingEffectRecord, definition.duration);
}

export function isLastingEffectRecord(value: unknown): value is LastingEffectRecord {
  return isWorldEffectRecord(value) || isModifierEffectRecord(value) || isZoneEffectRecord(value);
}

/** SRD Ensnaring Strike: the conditions on a creature that hurt it as each
 * of its turns starts, in a stable order. */
export function turnStartDamageEffects(state: AuthoritativeWorldState, targetEntityId: string): WorldEffectRecord[] {
  return Object.values(state.combatRuntime.effects)
    .filter((effect): effect is WorldEffectRecord => isWorldEffectRecord(effect)
      && effect.targetEntityId === targetEntityId && effect.lifecycle?.turnStartDamage !== undefined)
    .sort((left, right) => left.effectId.localeCompare(right.effectId));
}

/** SRD Ensnaring Strike: the conditions on a creature an action's check can end. */
export function escapableEffects(state: AuthoritativeWorldState, targetEntityId: string): WorldEffectRecord[] {
  return Object.values(state.combatRuntime.effects)
    .filter((effect): effect is WorldEffectRecord => isWorldEffectRecord(effect)
      && effect.targetEntityId === targetEntityId && effect.lifecycle?.escape !== undefined)
    .sort((left, right) => left.effectId.localeCompare(right.effectId));
}

/** SRD Spiritual Weapon: the abilities a creature may use because an effect
 * it made still lasts, in a stable order. */
export function grantedAbilityRefs(state: AuthoritativeWorldState, entityId: string): string[] {
  return [...new Set(Object.values(state.combatRuntime.effects).flatMap((effect) =>
    isZoneEffectRecord(effect) && effect.sourceRef === entityId && effect.grants !== undefined ? effect.grants : []))].sort();
}

/** The zone a creature's own frozen Ability made, if it still lasts. */
export function ownZoneOf(state: AuthoritativeWorldState, sourceRef: string, sourceDefinitionRef: string): ZoneEffectRecord | undefined {
  return Object.values(state.combatRuntime.effects).find((effect): effect is ZoneEffectRecord => isZoneEffectRecord(effect)
    && effect.sourceRef === sourceRef && effect.sourceDefinitionRef === sourceDefinitionRef);
}

/** SRD Spiritual Weapon: the weapon moved to a new place. */
export type EffectZoneMovedPayload = { effectId: string; sourceRef: string; origin: { x: string; y: string; elevation: string } };

export function isEffectZoneMovedPayload(value: unknown): value is EffectZoneMovedPayload {
  return isRecord(value) && hasExactKeys(value, ["effectId", "origin", "sourceRef"])
    && isNonEmptyString(value.effectId) && isNonEmptyString(value.sourceRef)
    && isRecord(value.origin) && hasExactKeys(value.origin, ["elevation", "x", "y"])
    && [value.origin.x, value.origin.y, value.origin.elevation].every(integerString);
}

export function applyEffectZoneMovedEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  if (event.eventType !== "EffectZoneMoved") return false;
  const payload: unknown = event.payload;
  if (!isEffectZoneMovedPayload(payload)) throw new RulesValidationError("Only a lasting spectral weapon moves.");
  const effect = state.combatRuntime.effects[payload.effectId];
  if (!isZoneEffectRecord(effect) || effect.sourceRef !== payload.sourceRef
    || effect.zone.kind !== "spectralWeapon") throw new RulesValidationError("Only a lasting spectral weapon moves.");
  effect.origin = structuredClone(payload.origin);
  return true;
}

/** The zones of a kind in a scene, in a stable order. */
export function zoneEffectsIn(state: AuthoritativeWorldState, sceneId: string, kind: ZoneKind): ZoneEffectRecord[] {
  return Object.values(state.combatRuntime.effects)
    .filter((effect): effect is ZoneEffectRecord => isZoneEffectRecord(effect) && effect.sceneId === sceneId && effect.zone.kind === kind)
    .sort((left, right) => left.effectId.localeCompare(right.effectId));
}

/** The modifiers on a target, in a stable order. */
export function modifierEffectsOn(state: AuthoritativeWorldState, targetEntityId: string): ModifierEffectRecord[] {
  return Object.values(state.combatRuntime.effects)
    .filter((effect): effect is ModifierEffectRecord => isModifierEffectRecord(effect) && effect.targetEntityId === targetEntityId)
    .sort((left, right) => left.effectId.localeCompare(right.effectId));
}

export function entityConditionImmune(
  state: AuthoritativeWorldState, entityId: string, condition: ConditionId,
): boolean {
  const core = state.entities[entityId] as unknown as JsonRecord | undefined;
  const combat = state.combatRuntime.entities[entityId];
  return (condition === "poisoned" && effectiveConditions(state, entityId).petrified === true)
    || [core?.conditionImmunities, combat?.conditionImmunities].some((value) =>
    Array.isArray(value) && value.includes(condition));
}

function entityInstant(state: AuthoritativeWorldState, entityId: string): string | undefined {
  const timelineId = characterTimelineId(state, entityId);
  return timelineId === undefined ? undefined : state.fictionTimelines[timelineId]?.nowMicros;
}

function expiryFor(
  state: AuthoritativeWorldState, targetEntityId: string, sourceRef: string,
  duration: WorldEffectDuration, startedAtFictionMicros: string, rootActionId: string,
): Expiry | undefined {
  if (duration.kind === "untilEnded") return null;
  if (duration.kind === "timed") return {
    kind: "fictionTime", entityId: targetEntityId,
    dueMicros: (BigInt(startedAtFictionMicros) + BigInt(duration.durationMicros)).toString(),
  };
  const entityId = duration.subject === "target" ? targetEntityId : sourceRef;
  if (state.entities[entityId] === undefined && state.combatRuntime.entities[entityId] === undefined) {
    return undefined;
  }
  const encounter = Object.values(state.combatRuntime.encounters).find((entry) =>
    entry.status !== "concluded" && Array.isArray(entry.participantEntityIds)
      && entry.participantEntityIds.includes(entityId));
  // Outside initiative, one turn is the registered six seconds of fiction.
  if (encounter === undefined) {
    const now = entityInstant(state, entityId);
    return now === undefined ? undefined : {
      kind: "fictionTime", entityId, dueMicros: (BigInt(now) + COMBAT_ROUND_MICROS).toString(),
    };
  }
  const anchor: JsonRecord = { ...combatPhaseExpiryAnchor(state, entityId, duration.edge, rootActionId),
    encounterId: String(encounter.encounterId) };
  // "Until the end of its next turn": begun during the subject's own turn,
  // the end of that turn is not the next one (SRD Guiding Bolt).
  const created = anchor.createdAt;
  if (duration.edge === "turnEnd" && isRecord(created) && created.edge === "turnStart"
    && created.slotIndex === anchor.slotIndex && created.roundIndex === anchor.targetRound) {
    anchor.targetRound = Number(anchor.targetRound) + 1;
  }
  return validExpiry(anchor) ? anchor : undefined;
}

export function planWorldEffect(state: AuthoritativeWorldState, input: {
  rootActionId: string;
  sourceRef: string;
  sourceDefinitionRef: string;
  targetEntityId: string;
  effect: unknown;
  index: number;
  occurrenceKey?: string;
  visibilityPolicyId?: string;
  visibilityFactId?: string;
  /** The saving throw a `repeatSave` effect repeats, as the Ability froze it. */
  repeatSave?: { ability: string; dc: number };
  /** The DC of the check that frees the target of an `escape` effect. */
  escapeDc?: number;
}): { kind: "applied"; effectRecord: WorldEffectRecord }
  | { kind: "immune"; condition: ConditionId }
  | { kind: "rejected"; message: string } {
  const definition = worldEffectDefinition(input.effect);
  const now = entityInstant(state, input.targetEntityId);
  if (definition === undefined || now === undefined
    || ![input.rootActionId, input.sourceRef, input.sourceDefinitionRef, input.targetEntityId]
      .every(isNonEmptyString)
    || !Number.isSafeInteger(input.index) || input.index < 0
    || !registeredEffectMatches(state, input.sourceDefinitionRef, definition)
    || (state.entities[input.targetEntityId] === undefined
      && state.combatRuntime.entities[input.targetEntityId] === undefined)) {
    return { kind: "rejected", message: "The condition effect or its target is unavailable." };
  }
  if (entityConditionImmune(state, input.targetEntityId, definition.condition)) {
    return { kind: "immune", condition: definition.condition };
  }
  const expiresAt = expiryFor(state, input.targetEntityId, input.sourceRef, definition.duration, now, input.rootActionId);
  if (expiresAt === undefined) return { kind: "rejected", message: "The effect duration has no authoritative subject." };
  if ((definition.lifecycle?.repeatSave === undefined) !== (input.repeatSave === undefined)) {
    return { kind: "rejected", message: "A repeated saving throw needs the save its Ability froze." };
  }
  if ((definition.lifecycle?.escape === undefined) !== (input.escapeDc === undefined)) {
    return { kind: "rejected", message: "A check that frees the target needs its DC." };
  }
  const { repeatSave: repeated, escape, ...ending } = definition.lifecycle ?? {};
  const lifecycle: WorldEffectRecordLifecycle | undefined = definition.lifecycle === undefined ? undefined : {
    ...ending,
    ...(repeated === undefined || input.repeatSave === undefined ? {}
      : { repeatSave: { edge: repeated.edge, ability: input.repeatSave.ability, dc: input.repeatSave.dc } }),
    ...(escape === undefined || input.escapeDc === undefined ? {} : { escape: { ability: escape.ability, dc: input.escapeDc } }),
  };
  const effectRecord: WorldEffectRecord = {
    schema: WORLD_EFFECT_SCHEMA,
    effectId: `effect:${canonicalSha256({ rootActionId: input.rootActionId,
      sourceRef: input.sourceRef, sourceDefinitionRef: input.sourceDefinitionRef,
      targetEntityId: input.targetEntityId, index: input.index, ...(input.occurrenceKey===undefined?{}:{occurrenceKey:input.occurrenceKey}) }).slice("sha256:".length)}`,
    kind: "condition", sourceRef: input.sourceRef, sourceDefinitionRef: input.sourceDefinitionRef,
    targetEntityId: input.targetEntityId, condition: definition.condition,
    level: definition.level ?? null, duration: definition.duration, startedAtFictionMicros: now,
    pausedMicros: "0", suspension: null,
    expiresAt, visibilityPolicyId: input.visibilityPolicyId ?? "visibility:scene-observers",
    visibilityFactId: input.visibilityFactId ?? null,
    ...(lifecycle === undefined ? {} : { lifecycle }),
  };
  if (!isWorldEffectRecord(effectRecord) || state.combatRuntime.effects[effectRecord.effectId] !== undefined) {
    return { kind: "rejected", message: "The condition effect identity or visibility is invalid." };
  }
  return { kind: "applied", effectRecord };
}

/** SPEC 0012 §10.1: a modifier from a frozen Ability on its target, with
 * the same duration and lifecycle rules as a granted condition. */
export function planModifierEffect(state: AuthoritativeWorldState, input: {
  rootActionId: string;
  sourceRef: string;
  sourceDefinitionRef: string;
  targetEntityId: string;
  effect: unknown;
  index: number;
}): { kind: "applied"; effectRecord: ModifierEffectRecord } | { kind: "rejected"; message: string } {
  const definition = modifierEffectDefinition(input.effect);
  const now = entityInstant(state, input.targetEntityId);
  if (definition === undefined || now === undefined
    || ![input.rootActionId, input.sourceRef, input.sourceDefinitionRef, input.targetEntityId].every(isNonEmptyString)
    || !Number.isSafeInteger(input.index) || input.index < 0
    || !registeredEffectMatches(state, input.sourceDefinitionRef, definition)
    || (state.entities[input.targetEntityId] === undefined
      && state.combatRuntime.entities[input.targetEntityId] === undefined)) {
    return { kind: "rejected", message: "The modifier effect or its target is unavailable." };
  }
  const expiresAt = expiryFor(state, input.targetEntityId, input.sourceRef, definition.duration, now, input.rootActionId);
  if (expiresAt === undefined) return { kind: "rejected", message: "The effect duration has no authoritative subject." };
  const effectRecord: ModifierEffectRecord = {
    schema: MODIFIER_EFFECT_SCHEMA,
    effectId: `effect:${canonicalSha256({ rootActionId: input.rootActionId, sourceRef: input.sourceRef,
      sourceDefinitionRef: input.sourceDefinitionRef, targetEntityId: input.targetEntityId, index: input.index }).slice("sha256:".length)}`,
    kind: "modifier", sourceRef: input.sourceRef, sourceDefinitionRef: input.sourceDefinitionRef,
    targetEntityId: input.targetEntityId, modifier: definition.modifier, duration: definition.duration,
    startedAtFictionMicros: now, pausedMicros: "0", suspension: null, expiresAt,
    visibilityPolicyId: "visibility:scene-observers", visibilityFactId: null,
    ...(definition.lifecycle === undefined ? {} : { lifecycle: definition.lifecycle }),
  };
  if (!isModifierEffectRecord(effectRecord) || state.combatRuntime.effects[effectRecord.effectId] !== undefined) {
    return { kind: "rejected", message: "The modifier effect identity is invalid." };
  }
  return { kind: "applied", effectRecord };
}

/** SPEC 0012 §10.1: the zone a frozen Ability fills, a sphere around the
 * area origin it was cast at. It keeps its caster's clock. */
export function planZoneEffect(state: AuthoritativeWorldState, input: {
  rootActionId: string;
  sourceRef: string;
  sourceDefinitionRef: string;
  effect: unknown;
  index: number;
  sceneId: string;
  origin: unknown;
  radiusInches: unknown;
}): { kind: "applied"; effectRecord: ZoneEffectRecord } | { kind: "rejected"; message: string } {
  const definition = zoneEffectDefinition(input.effect);
  const now = entityInstant(state, input.sourceRef);
  if (definition === undefined || now === undefined
    || ![input.rootActionId, input.sourceRef, input.sourceDefinitionRef, input.sceneId].every(isNonEmptyString)
    || !Number.isSafeInteger(input.index) || input.index < 0
    || !registeredEffectMatches(state, input.sourceDefinitionRef, definition)) {
    return { kind: "rejected", message: "The zone effect or its caster is unavailable." };
  }
  const expiresAt = expiryFor(state, input.sourceRef, input.sourceRef, definition.duration, now, input.rootActionId);
  if (expiresAt === undefined) return { kind: "rejected", message: "The effect duration has no authoritative subject." };
  const origin = isRecord(input.origin) ? { x: String(input.origin.x), y: String(input.origin.y), elevation: String(input.origin.elevation) } : undefined;
  const effectRecord: ZoneEffectRecord = {
    schema: ZONE_EFFECT_SCHEMA,
    effectId: `effect:${canonicalSha256({ rootActionId: input.rootActionId, sourceRef: input.sourceRef,
      sourceDefinitionRef: input.sourceDefinitionRef, zone: true, index: input.index }).slice("sha256:".length)}`,
    kind: "zone", zone: definition.zone, sourceRef: input.sourceRef, sourceDefinitionRef: input.sourceDefinitionRef,
    targetEntityId: input.sourceRef, sceneId: input.sceneId, origin: origin!, radiusInches: String(input.radiusInches),
    duration: definition.duration, startedAtFictionMicros: now, pausedMicros: "0", suspension: null, expiresAt,
    visibilityPolicyId: "visibility:scene-observers", visibilityFactId: null,
    ...(definition.lifecycle === undefined ? {} : { lifecycle: definition.lifecycle }),
    ...(definition.grants === undefined ? {} : { grants: definition.grants }),
  };
  if (origin === undefined || !isZoneEffectRecord(effectRecord) || state.combatRuntime.effects[effectRecord.effectId] !== undefined) {
    return { kind: "rejected", message: "The zone effect's place or identity is invalid." };
  }
  return { kind: "applied", effectRecord };
}

/** Effect records are the single source for granted conditions. Existing
 * native conditions remain independent: ending a grant never clears a fall,
 * injury, or another still-active source of the same condition. */
export function effectiveConditions(
  state: AuthoritativeWorldState, entityId: string, viewerCharacterId?: string,
): JsonRecord {
  const native = state.combatRuntime.entities[entityId]?.conditions;
  const result: JsonRecord = isRecord(native) ? structuredClone(native) : {};
  for (const effect of Object.values(state.combatRuntime.effects)) {
    if (!isWorldEffectRecord(effect) || effect.targetEntityId !== entityId
      || (viewerCharacterId !== undefined && !spatialRecordVisibleTo(state, effect, viewerCharacterId))) continue;
    if (effect.condition === "exhaustion") {
      result.exhaustion = String(Math.min(6, Number(result.exhaustion ?? 0) + effect.level!));
    } else result[effect.condition] = true;
    if (effect.condition === "grappled" && !isNonEmptyString(result.grappledBy)) {
      result.grappledBy = effect.sourceRef;
    }
  }
  if (result.paralyzed === true || result.stunned === true || result.unconscious === true
    || result.petrified === true) result.incapacitated = true;
  if (result.unconscious === true) result.prone = true;
  if (result.petrified === true) delete result.poisoned;
  return result;
}

export function worldEffectIds(state: AuthoritativeWorldState, input: {
  targetEntityId: string; condition?: ConditionId; sourceRef?: string;
}): string[] {
  return Object.values(state.combatRuntime.effects)
    .filter((effect) => isWorldEffectRecord(effect)
      && effect.targetEntityId === input.targetEntityId
      && (input.condition === undefined || effect.condition === input.condition)
      && (input.sourceRef === undefined || effect.sourceRef === input.sourceRef))
    .map((effect) => String(effect.effectId)).sort();
}

/** SPEC 0012 §10.2: the granted conditions that end with `sourceRef`'s concentration. */
export function concentrationLinkedEffectIds(state: AuthoritativeWorldState, sourceRef: string): string[] {
  return Object.values(state.combatRuntime.effects)
    .filter((effect) => isLastingEffectRecord(effect) && effect.sourceRef === sourceRef
      && effect.lifecycle?.concentration === true)
    .map((effect) => String(effect.effectId)).sort();
}

/** SPEC 0012 §10.1: the effects on a target whose saving throw it repeats at
 * the end of each of its turns, in a stable order. */
export function repeatSaveEffects(state: AuthoritativeWorldState, targetEntityId: string): WorldEffectRecord[] {
  return Object.values(state.combatRuntime.effects)
    .filter((effect): effect is WorldEffectRecord => isWorldEffectRecord(effect)
      && effect.targetEntityId === targetEntityId && effect.lifecycle?.repeatSave !== undefined)
    .sort((left, right) => left.effectId.localeCompare(right.effectId));
}

/** The effects on a target that a given kind of act ends. */
export function worldEffectsEndingWhen(
  state: AuthoritativeWorldState, targetEntityId: string, ending: WorldEffectEnding,
): LastingEffectRecord[] {
  return Object.values(state.combatRuntime.effects)
    .filter((effect): effect is LastingEffectRecord => isLastingEffectRecord(effect)
      && effect.targetEntityId === targetEntityId && effect.lifecycle?.endsWhen?.includes(ending) === true)
    .sort((left, right) => left.effectId.localeCompare(right.effectId));
}

/** Read-only mechanical/projection view. Never persist this derived record as
 * an entity patch; native conditions and granted sources must stay separate. */
export function effectiveConditionEntity(
  state: AuthoritativeWorldState, entityId: string, entity: JsonRecord, viewerCharacterId?: string,
): JsonRecord {
  return { ...entity, conditions: effectiveConditions(state, entityId, viewerCharacterId) };
}

export function worldEffectEndDrafts(
  state: AuthoritativeWorldState, effectIds: readonly string[], reason: string,
): WorldEffectEndDraft[] {
  if (!isNonEmptyString(reason)) throw new RulesValidationError("Effect ending requires a reason.");
  return [...new Set(effectIds)].sort().flatMap((effectId) => {
    const effect = state.combatRuntime.effects[effectId];
    return !isLastingEffectRecord(effect) ? [] : [{
      eventType: "EffectEnded" as const,
      payload: { effectId, targetEntityId: effect.targetEntityId, reason },
      visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" as const,
    }];
  });
}

/** A frozen Ability may end grants only within its selected target and the
 * condition/source selector in its Effect operation. Native conditions are
 * independent facts and are never erased as a side effect of ending a grant. */
export function planWorldEffectEnd(state: AuthoritativeWorldState, input: {
  sourceDefinitionRef: string;
  targetEntityId: string;
  effect: unknown;
}): { kind: "ended"; effectIds: string[]; drafts: WorldEffectEndDraft[] }
  | { kind: "rejected"; message: string } {
  const definition = worldEffectEndDefinition(input.effect);
  if (definition === undefined
    || !isNonEmptyString(input.targetEntityId)
    || (state.entities[input.targetEntityId] === undefined
      && state.combatRuntime.entities[input.targetEntityId] === undefined)
    || !registeredEffectMatches(state, input.sourceDefinitionRef, definition)) {
    return { kind: "rejected", message: "The ending effect does not match its frozen Ability and target." };
  }
  const effectIds = worldEffectIds(state, { targetEntityId: input.targetEntityId,
    condition: definition.condition,
    ...(definition.sourceRef === null ? {} : { sourceRef: definition.sourceRef }),
  });
  return { kind: "ended", effectIds, drafts: worldEffectEndDrafts(state, effectIds, "abilityEffectEnded") };
}

function residualExpiryMicros(state: AuthoritativeWorldState, effect: LastingEffectRecord): string | undefined {
  if (effect.expiresAt === null || effect.expiresAt.kind === "fictionTime") return undefined;
  const tasks = state.combatRuntime.encounters[effect.expiresAt.encounterId]?.residualPhaseTasks;
  const task = Array.isArray(tasks) ? tasks.find((entry) => isRecord(entry) && entry.effectId === effect.effectId) : undefined;
  return isRecord(task) && unsignedMicros(task.dueMicros) ? task.dueMicros : undefined;
}

/** A deterministic consequence of changing the petrified condition. Native
 * ConditionChanged/HP folds call this too; EffectApplied/Ended call it below.
 * No new poison can enter while stone, and existing sources are never erased. */
export function synchronizeWorldEffectSuspensions(
  state: AuthoritativeWorldState, targetEntityId: string, transitionInstantMicros?: string,
): void {
  const petrified = effectiveConditions(state, targetEntityId).petrified === true;
  for (const effect of Object.values(state.combatRuntime.effects)) {
    if (!isWorldEffectRecord(effect) || effect.targetEntityId !== targetEntityId || effect.condition !== "poisoned") continue;
    const clockEntity = effect.expiresAt?.entityId ?? targetEntityId;
    const observedNow = entityInstant(state, clockEntity);
    const sameTimeline = characterTimelineId(state, clockEntity) === characterTimelineId(state, targetEntityId);
    const now = transitionInstantMicros !== undefined && sameTimeline ? transitionInstantMicros : observedNow;
    if (now === undefined || !unsignedMicros(now)) throw new RulesValidationError("A suspended poison needs its authoritative fiction clock.");
    if (petrified && effect.suspension === null) {
      let remainingMicros: string | null = null;
      let remainingBoundaries: number | null = null;
      if (effect.expiresAt !== null) {
        if (effect.expiresAt.kind === "fictionTime") {
          const remaining = BigInt(effect.expiresAt.dueMicros) - BigInt(now);
          remainingMicros = (remaining > 0n ? remaining : 0n).toString();
        } else {
          const residual = residualExpiryMicros(state, effect);
          if (residual !== undefined) {
            const remaining = BigInt(residual) - BigInt(now);
            remainingMicros = (remaining > 0n ? remaining : 0n).toString();
            // The Encounter already mapped this phase to fiction time.
            effect.expiresAt = { kind: "fictionTime", entityId: clockEntity, dueMicros: residual };
          } else {
            const remaining = remainingCombatPhaseDuration(state, effect.expiresAt);
            if (remaining === undefined) throw new RulesValidationError("A suspended poison lost its frozen phase anchor.");
            ({ remainingMicros, remainingBoundaries } = remaining);
          }
        }
      }
      effect.suspension = { startedAtFictionMicros: now, remainingMicros, remainingBoundaries };
      for (const encounter of Object.values(state.combatRuntime.encounters)) {
        if (Array.isArray(encounter.residualPhaseTasks)) encounter.residualPhaseTasks =
          encounter.residualPhaseTasks.filter((task) => !isRecord(task) || task.effectId !== effect.effectId);
      }
    } else if (!petrified && effect.suspension !== null) {
      const suspended = effect.suspension;
      const elapsed = BigInt(now) - BigInt(suspended.startedAtFictionMicros);
      if (elapsed < 0n) throw new RulesValidationError("A poison suspension cannot resume before it began.");
      effect.pausedMicros = (BigInt(effect.pausedMicros) + elapsed).toString();
      if (effect.expiresAt !== null && suspended.remainingMicros !== null) {
        const expiry = effect.expiresAt;
        if (expiry.kind === "fictionTime") {
          effect.expiresAt = { ...expiry, dueMicros: (BigInt(expiry.dueMicros) + elapsed).toString() };
        } else {
          const encounter = state.combatRuntime.encounters[expiry.encounterId];
          if (encounter?.status !== "concluded" && (suspended.remainingBoundaries ?? 0) > 0) {
            const anchor = { ...combatPhaseExpiryAnchor(state, expiry.entityId, expiry.kind,
              expiry.createdAt.rootActionId), encounterId: expiry.encounterId };
            if (!validExpiry(anchor) || anchor === null) {
              throw new RulesValidationError("A resumed poison lost its authoritative phase subject.");
            }
            // Preserve the original creation cause and frozen ordering. Only
            // the remaining number of subject boundaries is rescheduled.
            effect.expiresAt = { ...expiry, targetRound: anchor.targetRound + suspended.remainingBoundaries! - 1 };
          } else {
            effect.expiresAt = { kind: "fictionTime", entityId: expiry.entityId,
              dueMicros: (BigInt(now) + BigInt(suspended.remainingMicros)).toString() };
          }
        }
      }
      effect.suspension = null;
    }
  }
}

export function scheduledWorldEffectDeadlines(state: AuthoritativeWorldState, input: {
  timelineId?: string;
  turn?: { entityId: string; edge: "turnStart" | "turnEnd"; round: number; encounterId: string };
} = {}): { effectId: string; timelineId: string; dueMicros: string }[] {
  return Object.values(state.combatRuntime.effects).flatMap((effect) => {
    if (!isLastingEffectRecord(effect) || effect.expiresAt === null || effect.suspension !== null) return [];
    const expiry = effect.expiresAt;
    const timelineId = characterTimelineId(state, expiry.entityId);
    const now = timelineId === undefined ? undefined : state.fictionTimelines[timelineId]?.nowMicros;
    if (now === undefined || (input.timelineId !== undefined && input.timelineId !== timelineId)) return [];
    let dueMicros: string | undefined;
    if (expiry.kind === "fictionTime") dueMicros = expiry.dueMicros;
    else {
      const remaining = remainingCombatPhaseDuration(state, expiry);
      const explicitBoundary = input.turn !== undefined && expiry.entityId === input.turn.entityId
        && expiry.kind === input.turn.edge && expiry.encounterId === input.turn.encounterId
        && expiry.targetRound <= input.turn.round;
      dueMicros = explicitBoundary || remaining?.remainingBoundaries === 0
        ? now : residualExpiryMicros(state, effect);
    }
    return dueMicros !== undefined && timelineId !== undefined
      ? [{ effectId: effect.effectId, timelineId, dueMicros }] : [];
  }).sort((left, right) => BigInt(left.dueMicros) < BigInt(right.dueMicros) ? -1
    : BigInt(left.dueMicros) > BigInt(right.dueMicros) ? 1 : left.effectId.localeCompare(right.effectId));
}

export function dueWorldEffectDrafts(state: AuthoritativeWorldState, input: {
  timelineId?: string;
  turn?: { entityId: string; edge: "turnStart" | "turnEnd"; round: number; encounterId: string };
} = {}): WorldEffectEndDraft[] {
  const due = scheduledWorldEffectDeadlines(state, input)
    .filter(deadline => BigInt(state.fictionTimelines[deadline.timelineId].nowMicros) >= BigInt(deadline.dueMicros));
  // The authoritative sequencer asks again after EffectEnded. One deadline at
  // a time lets petrification resume poison before later deadlines are chosen.
  return worldEffectEndDrafts(state, due.length === 0 ? [] : [due[0].effectId], "durationExpired");
}

/** Called before the combat-story guard, since effects can predate an Encounter. */
export function applyWorldEffectEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  const payload = event.payload as JsonRecord;
  if (event.eventType === "EffectApplied" && isRecord(payload.effect) && payload.effect.schema === WORLD_EFFECT_SCHEMA) {
    const effect = payload.effect;
    if (!isWorldEffectRecord(effect) || state.combatRuntime.effects[effect.effectId] !== undefined
      || effect.pausedMicros !== "0" || effect.suspension !== null
      || (state.entities[effect.targetEntityId] === undefined
        && state.combatRuntime.entities[effect.targetEntityId] === undefined)
      || entityConditionImmune(state, effect.targetEntityId, effect.condition)
      || entityInstant(state, effect.targetEntityId) !== effect.startedAtFictionMicros
      || !sameCanonical(effect.expiresAt, expiryFor(state,
        effect.targetEntityId, effect.sourceRef, effect.duration, effect.startedAtFictionMicros, event.rootActionId))
      || !registeredEffectMatches(state, effect.sourceDefinitionRef, recordDefinition(effect))) {
      throw new RulesValidationError("Condition effect does not match its frozen authoritative target.");
    }
    state.combatRuntime.effects[effect.effectId] = structuredClone(effect);
    synchronizeWorldEffectSuspensions(state, effect.targetEntityId);
    return true;
  }
  if (event.eventType === "EffectApplied" && isRecord(payload.effect) && payload.effect.schema === ZONE_EFFECT_SCHEMA) {
    const effect = payload.effect;
    if (!isZoneEffectRecord(effect) || state.combatRuntime.effects[effect.effectId] !== undefined
      || entityInstant(state, effect.sourceRef) !== effect.startedAtFictionMicros
      || !sameCanonical(effect.expiresAt, expiryFor(state,
        effect.sourceRef, effect.sourceRef, effect.duration, effect.startedAtFictionMicros, event.rootActionId))
      || !registeredEffectMatches(state, effect.sourceDefinitionRef, zoneRecordDefinition(effect))) {
      throw new RulesValidationError("Zone effect does not match its frozen authoritative caster.");
    }
    state.combatRuntime.effects[effect.effectId] = structuredClone(effect);
    return true;
  }
  if (event.eventType === "EffectApplied" && isRecord(payload.effect) && payload.effect.schema === MODIFIER_EFFECT_SCHEMA) {
    const effect = payload.effect;
    if (!isModifierEffectRecord(effect) || state.combatRuntime.effects[effect.effectId] !== undefined
      || (state.entities[effect.targetEntityId] === undefined
        && state.combatRuntime.entities[effect.targetEntityId] === undefined)
      || entityInstant(state, effect.targetEntityId) !== effect.startedAtFictionMicros
      || !sameCanonical(effect.expiresAt, expiryFor(state,
        effect.targetEntityId, effect.sourceRef, effect.duration, effect.startedAtFictionMicros, event.rootActionId))
      || !registeredEffectMatches(state, effect.sourceDefinitionRef, modifierRecordDefinition(effect))) {
      throw new RulesValidationError("Modifier effect does not match its frozen authoritative target.");
    }
    state.combatRuntime.effects[effect.effectId] = structuredClone(effect);
    return true;
  }
  if (event.eventType === "EffectEnded") {
    const effect = state.combatRuntime.effects[String(payload.effectId)];
    if (!isLastingEffectRecord(effect)) return false;
    if (payload.targetEntityId !== effect.targetEntityId || !isNonEmptyString(payload.reason)) {
      throw new RulesValidationError("Condition effect ending has a different target.");
    }
    if (effect.suspension !== null && ["durationExpired", "encounterPhaseDue"].includes(String(payload.reason))) {
      throw new RulesValidationError("A suspended poison cannot expire before it resumes.");
    }
    const dueInstant = ["durationExpired", "encounterPhaseDue"].includes(String(payload.reason))
      ? effect.expiresAt?.kind === "fictionTime" ? effect.expiresAt.dueMicros : residualExpiryMicros(state, effect)
      : undefined;
    delete state.combatRuntime.effects[effect.effectId];
    for (const encounter of Object.values(state.combatRuntime.encounters)) {
      if (Array.isArray(encounter.residualPhaseTasks)) encounter.residualPhaseTasks =
        encounter.residualPhaseTasks.filter((task) => !isRecord(task) || task.effectId !== effect.effectId);
    }
    synchronizeWorldEffectSuspensions(state, effect.targetEntityId, dueInstant);
    return true;
  }
  return false;
}
