import type { AuthoredSourceSchema } from "./authored-materialization";
import { authorityReadSetMatches, characterTimelineAuthorityRef } from "./authority-bindings";
import { stepCombatWorld } from "./combat-actions";
import { activeEncounter, encounterActiveParticipants } from "./combat-encounters";
import { passivePerception } from "./concealment";
import { continueCompoundRoot } from "./internal-compound";
import { itemEntryGearResolver } from "./item-transitions";
import type { AuthoritativeWorldState, JsonRecord, RuleDiagnostic, StepResult } from "./model";
import { isNpcSpatialShell, NPC_MECHANICAL_TEMPLATE_KIND, NPC_MECHANICAL_TEMPLATE_SCHEMA } from "./npc-mechanics";
import { rejected } from "./results";
import { hiddenCondition } from "./spatial-visibility";
import { CONDITION_IDS } from "./condition-vocabulary";
import { worldEffectDefinition, type WorldEffectDefinition } from "./world-effects";
import { hasOnlyKeys, hasExactKeys, isNonEmptyString, isRecord, isSha256 } from "./validation";
import { isCanonicalReadSet, type VersionedAuthorityBinding } from "./world-interaction-model";
import { canonicalSha256 } from "../profiles/canonical";
import type { RuntimeProfileManifest } from "../profiles/types";

/** SPEC 0012 §§3、5: a hostile act against a creature present in the scene,
 * outside an encounter, starts one. The KP names who takes part, who is
 * hostile to whom and, creature by creature, who is surprised; Rules rolls
 * initiative. The act that starts the fight does not itself resolve: the
 * first creature in initiative order acts on its own turn. */
export const COMBAT_START_PLAN_SCHEMA = "zhuwei.combat-start-plan/vnext-1" as const;

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing",
  "poison", "psychic", "radiant", "slashing", "thunder"] as const;
const DEATH_POLICIES = ["deadAtZero", "deathSaves", "defeatedAtZero"] as const;
const MAX_PARTICIPANTS = 24;
type Ability = typeof ABILITIES[number];
type DamageType = typeof DAMAGE_TYPES[number];

export type CombatStartSurprise = Readonly<{ kind: "aware" } | { kind: "surprised"; basis: string }>;
export type CombatStartParticipant = Readonly<{ creatureRef: string; surprise: CombatStartSurprise }>;
export type CombatStartHostility = Readonly<{ fromRefs: readonly string[]; toRefs: readonly string[] }>;
/** One attack of an NPC's first combat statistics, as a stat block writes it:
 * the full damage expression, modifier included. */
export type CombatStartAttack = Readonly<(
  | { kind: "meleeAttack"; label: string; ability: Ability; reachFeet: number; damage: string; damageType: DamageType }
  | { kind: "rangedAttack"; label: string; ability: Ability; normalRangeFeet: number; longRangeFeet: number; damage: string; damageType: DamageType }
  | { kind: "saveEffect"; label: string; saveAbility: Ability; dc: number; rangeFeet: number; damage: string; damageType: DamageType; halfOnSuccess: boolean }
) & { effects?: readonly WorldEffectDefinition[]; effectSave?: readonly { ability: Ability; dc: number }[] }
>;
/** SPEC 0006 §§3、8, SPEC 0012 §3.2: the combat statistics an NPC without any
 * gets when it first takes part in a fight. Ability scores, proficiency, its
 * body and any loadout it already has stay as established. */
export type CombatStartStatistics = Readonly<{
  npcRef: string; armorClass: number; speedFeet: number; hitPointsMaximum: number;
  deathPolicy: typeof DEATH_POLICIES[number]; attacks: readonly CombatStartAttack[];
  damageDefenses?: { immune: readonly DamageType[]; resistant: readonly DamageType[]; vulnerable: readonly DamageType[] };
  /** Indices refer to the attacks in this same first stat block, not an Attack action. */
  multiattack?: readonly { attackIndex: number; count: number }[];
}>;
export type CombatStart = Readonly<{
  participants: readonly CombatStartParticipant[];
  hostilities: readonly CombatStartHostility[];
  combatStatistics: readonly CombatStartStatistics[];
  /** What the opening looks like, for the narration. */
  description: string;
}>;
export type CombatStartPlan = Readonly<{
  schema: typeof COMBAT_START_PLAN_SCHEMA; contextHash: string;
  readSet: readonly VersionedAuthorityBinding[]; start: CombatStart;
}>;

type Schema = AuthoredSourceSchema;
const object = (properties: Record<string, Schema>): Schema => ({ type: "object", properties,
  required: Object.keys(properties), additionalProperties: false });
const text: Schema = { type: "string", pattern: "[\\s\\S]+" };
const values = (...entries: readonly string[]): Schema => ({ type: "string", enum: [...entries] });
const integer = (minimum: number, maximum: number): Schema => ({ type: "integer", minimum, maximum });
const damage: Schema = { type: "string", pattern: "^[1-9][0-9]?d(4|6|8|10|12|20)([+-][1-9][0-9]?)?$" };

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

const ref = (value: unknown): value is string => typeof value === "string" && /^\S+$/u.test(value) && value.length <= 512;
const textValue = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0
  && value.length <= max && value.normalize("NFC") === value;
const intIn = (value: unknown, minimum: number, maximum: number): value is number => Number.isSafeInteger(value)
  && Number(value) >= minimum && Number(value) <= maximum;
const refs = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0
  && value.length <= MAX_PARTICIPANTS && value.every(ref) && new Set(value).size === value.length;

function isAttack(value: unknown): value is CombatStartAttack {
  // A lowercase key such as "dash" or "stabilize" names a built-in mechanic.
  if (!isRecord(value) || !textValue(value.label, 200) || /^[a-z0-9:-]+$/u.test(value.label) || typeof value.damage !== "string"
    || !new RegExp(String(damage.pattern), "u").test(value.damage) || !(DAMAGE_TYPES as readonly unknown[]).includes(value.damageType)) return false;
  if (value.effects !== undefined && (!Array.isArray(value.effects) || value.effects.length > 8
    || !value.effects.every(effect => worldEffectDefinition(effect) !== undefined))) return false;
  if (value.effectSave !== undefined && (!Array.isArray(value.effectSave) || value.effectSave.length > 1
    || (value.kind === "saveEffect" && value.effectSave.length > 0)
    || !value.effectSave.every(save => isRecord(save) && hasExactKeys(save, ["ability", "dc"])
      && (ABILITIES as readonly unknown[]).includes(save.ability) && intIn(save.dc, 1, 30)))) return false;
  if (value.kind === "meleeAttack") return hasOnlyKeys(value, ["kind", "label", "ability", "reachFeet", "damage", "damageType"], ["effects", "effectSave"])
    && (ABILITIES as readonly unknown[]).includes(value.ability) && intIn(value.reachFeet, 5, 15) && Number(value.reachFeet) % 5 === 0;
  if (value.kind === "rangedAttack") return hasOnlyKeys(value, ["kind", "label", "ability", "normalRangeFeet", "longRangeFeet", "damage", "damageType"], ["effects", "effectSave"])
    && (ABILITIES as readonly unknown[]).includes(value.ability) && intIn(value.normalRangeFeet, 5, 600)
    && intIn(value.longRangeFeet, Number(value.normalRangeFeet), 1200);
  return value.kind === "saveEffect" && hasOnlyKeys(value, ["kind", "label", "saveAbility", "dc", "rangeFeet", "damage", "damageType", "halfOnSuccess"], ["effects", "effectSave"])
    && (ABILITIES as readonly unknown[]).includes(value.saveAbility) && intIn(value.dc, 1, 30) && intIn(value.rangeFeet, 5, 600)
    && typeof value.halfOnSuccess === "boolean";
}

/** Shape only. Who may take part, hostility and surprise are judged against
 * authority by `combatStartIssues`. */
export function isCombatStart(value: unknown): value is CombatStart {
  return isRecord(value) && hasExactKeys(value, ["participants", "hostilities", "combatStatistics", "description"])
    && Array.isArray(value.participants) && value.participants.length <= MAX_PARTICIPANTS
    && value.participants.every(entry => isRecord(entry) && hasExactKeys(entry, ["creatureRef", "surprise"]) && ref(entry.creatureRef)
      && isRecord(entry.surprise) && ((entry.surprise.kind === "aware" && hasExactKeys(entry.surprise, ["kind"]))
        || (entry.surprise.kind === "surprised" && hasExactKeys(entry.surprise, ["kind", "basis"]) && textValue(entry.surprise.basis, 2_000))))
    && Array.isArray(value.hostilities) && value.hostilities.length <= 100
    && value.hostilities.every(entry => isRecord(entry) && hasExactKeys(entry, ["fromRefs", "toRefs"]) && refs(entry.fromRefs) && refs(entry.toRefs))
    && Array.isArray(value.combatStatistics) && value.combatStatistics.length <= MAX_PARTICIPANTS
    && value.combatStatistics.every(entry => isRecord(entry)
      && hasOnlyKeys(entry, ["npcRef", "armorClass", "speedFeet", "hitPointsMaximum", "deathPolicy", "attacks"], ["damageDefenses", "multiattack"])
      && ref(entry.npcRef) && intIn(entry.armorClass, 1, 30) && intIn(entry.speedFeet, 0, 200) && Number(entry.speedFeet) % 5 === 0
      && intIn(entry.hitPointsMaximum, 1, 1_000_000) && (DEATH_POLICIES as readonly unknown[]).includes(entry.deathPolicy)
      && Array.isArray(entry.attacks) && entry.attacks.length <= 8 && entry.attacks.every(isAttack)
      && (entry.damageDefenses === undefined || (isRecord(entry.damageDefenses)
        && hasExactKeys(entry.damageDefenses, ["immune", "resistant", "vulnerable"])
        && Object.values(entry.damageDefenses).every(types => Array.isArray(types) && new Set(types).size === types.length
          && types.every(type => (DAMAGE_TYPES as readonly unknown[]).includes(type)))))
      && (entry.multiattack === undefined || (Array.isArray(entry.multiattack) && entry.multiattack.length <= 8
        && new Set(entry.multiattack.map(attack => isRecord(attack) ? attack.attackIndex : null)).size === entry.multiattack.length
        && entry.multiattack.every(attack => isRecord(attack) && hasExactKeys(attack, ["attackIndex", "count"])
          && intIn(attack.attackIndex, 0, (entry.attacks as unknown[]).length - 1) && intIn(attack.count, 1, 99)
          && (entry.attacks as CombatStartAttack[])[Number(attack.attackIndex)]?.kind !== "saveEffect"))))
    && textValue(value.description, 2_000);
}

export function isCombatStartPlan(value: unknown): value is CombatStartPlan {
  return isRecord(value) && hasExactKeys(value, ["schema", "contextHash", "readSet", "start"])
    && value.schema === COMBAT_START_PLAN_SCHEMA && isSha256(value.contextHash)
    && isCanonicalReadSet(value.readSet) && isCombatStart(value.start);
}

/** A problem with a start against authority: the constraint, where in the
 * start it sits, and what would satisfy it. Paths are relative to the start. */
export type CombatStartIssue = Readonly<{ constraint: string; path: readonly (string | number)[]; expected: Readonly<Record<string, unknown>>; actual?: unknown }>;

/** Who the act would fight alongside or against, and whether that is a new
 * encounter or one already running (SPEC 0012 §3.4). */
type Resolved = Readonly<{ sceneId: string; joining?: JsonRecord }>;

/** Every authority check of a start, shared by lowering (as revision
 * diagnostics) and Rules (as the rejection). */
export function combatStartIssues(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, actorId: string,
  start: CombatStart): readonly CombatStartIssue[] {
  return resolveCombatStart(profiles, state, actorId, start).issues;
}

function resolveCombatStart(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, actorId: string,
  start: CombatStart): Readonly<{ issues: readonly CombatStartIssue[]; resolved?: Resolved }> {
  const issues: CombatStartIssue[] = [];
  const actor = state.entities[actorId];
  const sceneId = actor?.sceneId;
  if (actor?.tenureStatus !== "active" || !isNonEmptyString(sceneId)) {
    return { issues: [{ constraint: "combat-start:actor-unavailable", path: [], expected: { requirement: "an active actor in a scene" } }] };
  }
  // SPEC 0012 §3.1: one active encounter per creature at a time; an actor
  // already fighting acts on its turn (abilityOperation or the map).
  if (activeEncounter(state, actorId) !== undefined) {
    issues.push({ constraint: "combat-start:actor-already-in-encounter", path: [],
      expected: { requirement: "the actor is not yet in a running encounter; in one, it attacks on its turn with abilityOperation or the map" } });
  }
  const refsInStart = start.participants.map(entry => entry.creatureRef);
  const participants = new Set(refsInStart);
  if (participants.size !== refsInStart.length) {
    issues.push({ constraint: "combat-start:participant-repeated", path: ["participants"], expected: { requirement: "each creature listed once" } });
  }
  if (participants.size < 2) issues.push({ constraint: "combat-start:two-participants-required", path: ["participants"],
    expected: { requirement: "the actor and at least one other creature present" } });
  if (!participants.has(actorId)) issues.push({ constraint: "combat-start:actor-must-take-part", path: ["participants"],
    expected: { requirement: "the actor whose act starts the fight is a participant", ref: actorId } });
  const encounters = new Map<string, JsonRecord>();
  start.participants.forEach((entry, index) => {
    const entity = state.entities[entry.creatureRef], body = state.combatRuntime.entities[entry.creatureRef];
    if (entity === undefined || (entity.kind !== "player" && entity.kind !== "npc") || entity.tenureStatus !== "active"
      || entity.sceneId !== sceneId || body === undefined || body.lifeState === "dead") {
      issues.push({ constraint: "combat-start:participant-not-present", path: ["participants", index, "creatureRef"],
        expected: { requirement: "a living creature present in the actor's scene" }, actual: entry.creatureRef });
      return;
    }
    const running = entry.creatureRef === actorId ? undefined : activeEncounter(state, entry.creatureRef);
    if (running !== undefined) encounters.set(String(running.encounterId), running);
  });
  // SPEC 0012 §3.4: someone not yet in a running encounter who turns on a
  // creature in it joins that encounter; it is not a second fight.
  if (encounters.size > 1) issues.push({ constraint: "combat-start:participants-in-different-encounters", path: ["participants"],
    expected: { requirement: "the creatures already fighting belong to one running encounter" } });
  const joining = encounters.size === 1 ? [...encounters.values()][0] : undefined;
  const members = new Set(joining === undefined ? [] : encounterActiveParticipants(joining));
  if (joining !== undefined) {
    start.participants.forEach((entry, index) => {
      if (entry.surprise.kind === "surprised") issues.push({ constraint: "combat-start:surprise-only-when-the-fight-begins",
        path: ["participants", index, "surprise"], expected: { kind: "aware", requirement: "SPEC 0012 §5.1: surprise is decided when a fight begins; joining a running one surprises no one" } });
    });
  }
  // SPEC 0012 §3.3: hostility is explicit and directed; the actor's act puts
  // it on one side or the other.
  if (start.hostilities.length === 0) issues.push({ constraint: "combat-start:hostility-required", path: ["hostilities"],
    expected: { requirement: "at least one directed hostility between participants" } });
  let actorHostile = false;
  start.hostilities.forEach((hostility, index) => {
    const sides = [...hostility.fromRefs, ...hostility.toRefs];
    if (sides.some(entry => !participants.has(entry))) issues.push({ constraint: "combat-start:hostility-outside-participants",
      path: ["hostilities", index], expected: { requirement: "both sides list only participants", refs: [...participants].sort() } });
    if (hostility.fromRefs.some(entry => hostility.toRefs.includes(entry))) issues.push({ constraint: "combat-start:hostility-toward-itself",
      path: ["hostilities", index], expected: { requirement: "no creature on both sides of one hostility" } });
    if (sides.includes(actorId)) actorHostile = true;
    if (joining !== undefined && sides.every(entry => members.has(entry))) issues.push({ constraint: "combat-start:hostility-must-involve-a-newcomer",
      path: ["hostilities", index], expected: { requirement: "a joining act records only hostilities of the creatures joining the running encounter" } });
  });
  if (start.hostilities.length > 0 && !actorHostile) issues.push({ constraint: "combat-start:actor-hostility-required", path: ["hostilities"],
    expected: { requirement: "the actor is on one side of at least one hostility", ref: actorId } });
  // SPEC 0006 §7, SPEC 0012 §13 (ADR 0118): an NPC starting a fight from its
  // own view decides only its own hostility. It names whom it attacks; they
  // and it are the participants. Whether they fight back is theirs to decide.
  if (actor.kind === "npc") {
    start.hostilities.forEach((hostility, index) => {
      if (hostility.fromRefs.length !== 1 || hostility.fromRefs[0] !== actorId) issues.push({ constraint: "combat-start:npc-names-only-its-own-hostility",
        path: ["hostilities", index, "fromRefs"], expected: { requirement: "an NPC starting a fight writes only its own hostility: fromRefs is the NPC alone", refs: [actorId] } });
    });
    const targets = new Set(start.hostilities.flatMap(hostility => hostility.toRefs));
    const expected = [...new Set([actorId, ...targets])].sort();
    if (expected.length !== participants.size || expected.some(ref => !participants.has(ref))) issues.push({ constraint: "combat-start:npc-participants-are-it-and-its-targets",
      path: ["participants"], expected: { requirement: "an NPC starting a fight lists itself and the creatures it is hostile to, no one else", refs: expected } });
  }
  // SPEC 0012 §5.1: a creature is surprised only when it noticed no threat.
  // Every participant hostile to it must be hidden from it, its Stealth total
  // at or above its passive Perception; who is hidden comes from authority.
  start.participants.forEach((entry, index) => {
    if (entry.surprise.kind !== "surprised") return;
    const threats = start.hostilities.filter(hostility => hostility.toRefs.includes(entry.creatureRef)).flatMap(hostility => hostility.fromRefs);
    const passive = passivePerception(profiles, state, entry.creatureRef);
    const noticed = [...new Set(threats)].filter(threat => {
      const total = hiddenCondition(state.combatRuntime.entities[threat]?.conditions)?.stealthTotal;
      return total === undefined || Number(total) < passive;
    }).sort();
    if (threats.length === 0 || noticed.length > 0) issues.push({ constraint: "combat-start:surprise-needs-unnoticed-threats",
      path: ["participants", index, "surprise"], expected: { kind: "aware", requirement: "a creature is surprised only when every participant hostile to it is hidden from it with a Stealth total at or above its passive Perception",
        passivePerception: passive, noticedThreatRefs: noticed } });
  });
  // SPEC 0006 §§3、8: an NPC fighting for the first time gets its combat
  // statistics now, once; one that has them keeps them.
  const needing = new Set(start.participants.map(entry => entry.creatureRef)
    .filter(entry => state.entities[entry]?.kind === "npc" && isNpcSpatialShell(state.combatRuntime.entities[entry])));
  const written = new Set<string>();
  start.combatStatistics.forEach((statistics, index) => {
    if (!needing.has(statistics.npcRef) || written.has(statistics.npcRef)) {
      issues.push({ constraint: "combat-start:combat-statistics-not-needed", path: ["combatStatistics", index, "npcRef"],
        expected: { requirement: "statistics only for a participating NPC that has none yet, once each", refs: [...needing].sort() }, actual: statistics.npcRef });
      return;
    }
    written.add(statistics.npcRef);
    const entity = state.entities[statistics.npcRef]!;
    const scores = entity.abilityScores ?? entity.socialMechanics?.abilityScores;
    const proficiency = entity.proficiencyBonus ?? entity.socialMechanics?.proficiencyBonus;
    if (scores === undefined || proficiency === undefined) {
      issues.push({ constraint: "combat-start:npc-ability-scores-unavailable", path: ["combatStatistics", index, "npcRef"],
        expected: { requirement: "an NPC whose ability scores and proficiency are established" }, actual: statistics.npcRef });
    }
    const loadout = entity.loadout;
    if (loadout !== undefined && (statistics.armorClass !== loadout.armorClass || statistics.speedFeet !== loadout.speedFeet)) {
      issues.push({ constraint: "combat-start:statistics-differ-from-established-loadout", path: ["combatStatistics", index],
        expected: { requirement: "armorClass and speedFeet as the NPC's established loadout records them", armorClass: loadout.armorClass, speedFeet: loadout.speedFeet } });
    }
    if (entity.hitPoints !== undefined && statistics.hitPointsMaximum !== entity.hitPoints.maximum) {
      issues.push({ constraint: "combat-start:hit-points-differ-from-established", path: ["combatStatistics", index, "hitPointsMaximum"],
        expected: { hitPointsMaximum: entity.hitPoints.maximum } });
    }
  });
  const missing = [...needing].filter(entry => !written.has(entry)).sort();
  if (missing.length > 0) issues.push({ constraint: "combat-start:combat-statistics-required", path: ["combatStatistics"],
    expected: { requirement: "combat statistics for each participating NPC that has none yet", refs: missing } });
  return { issues, ...(issues.length === 0 ? { resolved: { sceneId, ...(joining === undefined ? {} : { joining }) } } : {}) };
}

/** The authority this start reads: the actor, its scene and timeline (the
 * fight opens at its moment), and every participant. */
export function combatStartReadRefs(state: AuthoritativeWorldState, actorId: string, start: CombatStart): readonly string[] | undefined {
  const sceneId = state.entities[actorId]?.sceneId;
  if (!isNonEmptyString(sceneId)) return undefined;
  return [...new Set([actorId, sceneId, characterTimelineAuthorityRef(actorId), ...start.participants.map(entry => entry.creatureRef)])].sort();
}

const hash32 = (value: unknown) => canonicalSha256(value).slice("sha256:".length, "sha256:".length + 32);

/** The attack's name travels as its mechanical key, the field the table and
 * the claims read an NPC ability's name from. */
function attackDefinition(definitionId: string, attack: CombatStartAttack): JsonRecord {
  const common = { definitionId, revision: "1", rulesBasis: "srd5.1-2014", mechanicalKey: attack.label,
    ...(attack.effects?.length ? { effects: structuredClone(attack.effects) } : {}),
    ...(attack.effectSave?.[0] === undefined ? {} : { save: { ability: attack.effectSave[0].ability, dc: String(attack.effectSave[0].dc), halfOnSuccess: false,
      effectsOnly: true } }),
  };
  const hit = [{ type: attack.damageType, formula: attack.damage }];
  if (attack.kind === "meleeAttack") return { ...common, activation: { kind: "attack", actionGrant: "attack" },
    target: { kind: "creature", count: "1", reachInches: String(attack.reachFeet * 12) },
    attack: { ability: attack.ability, proficiency: true }, damage: hit };
  if (attack.kind === "rangedAttack") return { ...common, activation: { kind: "attack", actionGrant: "attack" },
    target: { kind: "creature", count: "1", rangeNormalInches: String(attack.normalRangeFeet * 12),
      rangeLongInches: String(attack.longRangeFeet * 12), requiresSight: true },
    attack: { ability: attack.ability, proficiency: true }, damage: hit };
  return { ...common, activation: { kind: "action" },
    target: { kind: "creature", count: "1", rangeInches: String(attack.rangeFeet * 12), requiresSight: true },
    save: { ability: attack.saveAbility, dc: String(attack.dc), halfOnSuccess: attack.halfOnSuccess }, damage: hit };
}

/** The NPC's first combat statistics as the existing NPC mechanical template:
 * scores, proficiency and body as established, its loadout's armour class
 * and speed, and the KP's hit points, death policy and attacks. */
function npcCombatant(state: AuthoritativeWorldState, rootActionId: string, statistics: CombatStartStatistics): JsonRecord {
  const entity = state.entities[statistics.npcRef]!, body = state.combatRuntime.entities[statistics.npcRef]!;
  const scores = (entity.abilityScores ?? entity.socialMechanics?.abilityScores)!;
  const identity = hash32({ schema: COMBAT_START_PLAN_SCHEMA, rootActionId, npcRef: statistics.npcRef });
  // A shield the NPC already holds in its off hand adds its 2 on top of the base.
  const shield = entity.loadout === undefined ? 0
    : itemEntryGearResolver(state.campaignRuntime.itemSystem)(entity.loadout.equipped.off)?.armor === "shield" ? 2 : 0;
  const base = String(statistics.armorClass - shield);
  const intrinsicAbilities = statistics.attacks.map((attack, index) => attackDefinition(`ability:combat-start:${identity}:${index}`, attack));
  if (statistics.multiattack?.length) intrinsicAbilities.push({
    definitionId: `ability:combat-start:${identity}:multiattack`, revision: "1", rulesBasis: "srd5.1-2014",
    mechanicalKey: "multiattack", activation: { kind: "action" },
    grants: [{ kind: "multiattack", attacks: statistics.multiattack.map(attack => ({
      abilityRef: `ability:combat-start:${identity}:${attack.attackIndex}`, count: String(attack.count),
    })) }],
  });
  return { entityId: statistics.npcRef, name: entity.name, placement: null, mechanics: { kind: "bespokeDefinition", definition: {
    definitionId: `npc-template:combat-start:${identity}`, revision: "1", definitionKind: NPC_MECHANICAL_TEMPLATE_KIND,
    rulesBasis: "srd5.1-2014", causalBasisRefs: [isNonEmptyString(entity.semanticDefinitionRef) ? entity.semanticDefinitionRef : statistics.npcRef],
    visibilityPolicyRef: "visibility:room-authority-only",
    content: { schema: NPC_MECHANICAL_TEMPLATE_SCHEMA, label: entity.name,
      stats: Object.fromEntries(ABILITIES.map(ability => [ability, String(scores[ability])])),
      proficiencyBonus: String(entity.proficiencyBonus ?? entity.socialMechanics?.proficiencyBonus),
      armorClass: base, armorClassModel: { kind: "higherOfBaseAndEquipment", baseArmorClass: base, shieldBonus: "0" },
      hitPointsMaximum: String(statistics.hitPointsMaximum), footprint: structuredClone(body.footprint),
      speedInches: { walk: String(statistics.speedFeet * 12) }, resourceMaximums: {}, deathPolicy: statistics.deathPolicy,
      ...(statistics.damageDefenses === undefined ? {} : { damageDefenses: structuredClone(statistics.damageDefenses) }),
      intrinsicAbilities,
      itemDefinitions: [], itemDefinitionRefs: [], initialLoadout: { entries: [] } } } } };
}

function diagnostics(issues: readonly CombatStartIssue[]): RuleDiagnostic[] {
  return issues.map(issue => ({ code: "CONSTRAINT_CONFLICT", message: issue.constraint, constraint: issue.constraint,
    path: `/plan/start${issue.path.map(part => `/${String(part)}`).join("")}`, expected: issue.expected,
    source: "SPEC 0016", visibility: "public" }));
}

/** Authority binding and the KP's choices only. The existing combat executor
 * owns the encounter, the NPCs' first statistics, initiative and its dice. */
export function stepCombatStart(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord,
  options: Readonly<{ continuedRoot?: true }> = {}): StepResult {
  if (!hasExactKeys(input, ["kind", "rootActionId", "actorCharacterId", "plan"]) || input.kind !== "startCombat"
    || !isNonEmptyString(input.rootActionId) || !isNonEmptyString(input.actorCharacterId) || !isCombatStartPlan(input.plan)) {
    return rejected("invalidRulesInput", "The frozen combat start is not canonical.");
  }
  const { start, readSet } = input.plan, actorId = input.actorCharacterId, rootActionId = input.rootActionId;
  const reads = combatStartReadRefs(state, actorId, start);
  if (reads === undefined || !reads.every(entry => readSet.some(binding => binding.ref === entry)) || !authorityReadSetMatches(state, readSet)) {
    return rejected("causalFrontierConflict", "The frozen combat start dependencies changed.");
  }
  const { issues, resolved } = resolveCombatStart(profiles, state, actorId, start);
  if (resolved === undefined) return rejected("invalidRulesInput", "The combat start does not hold against authority.", diagnostics(issues));
  const statistics = new Map(start.combatStatistics.map(entry => [entry.npcRef, entry]));
  const dynamicEntities = start.participants.flatMap(entry => {
    const written = statistics.get(entry.creatureRef);
    return written === undefined ? [] : [npcCombatant(state, rootActionId, written)];
  });
  const established = start.participants.map(entry => entry.creatureRef).filter(entry => !statistics.has(entry));
  const hostilities = start.hostilities.map(hostility => ({ fromEntityIds: [...hostility.fromRefs], toEntityIds: [...hostility.toRefs] }));
  let command: JsonRecord;
  if (resolved.joining !== undefined) {
    const members = new Set(encounterActiveParticipants(resolved.joining));
    const joining = start.participants.map(entry => entry.creatureRef).filter(entry => !members.has(entry));
    command = { kind: "joinEncounter", rootActionId, encounterId: String(resolved.joining.encounterId),
      joiningEntityIds: joining.filter(entry => !statistics.has(entry)),
      dynamicEntities: dynamicEntities.filter(entry => joining.includes(String(entry.entityId))),
      hostilities, description: start.description };
  } else {
    const encounterId = `encounter:${hash32({ schema: COMBAT_START_PLAN_SCHEMA, rootActionId })}`;
    command = { kind: "startEncounter", rootActionId, proposalAttemptId: `proposal:${rootActionId}:combat-start`, encounterId,
      sceneId: resolved.sceneId, participantEntityIds: established, dynamicEntities,
      initiativeGroups: start.participants.map(entry => ({ entryId: `initiative:${encounterId}:${entry.creatureRef}`, combatantEntityIds: [entry.creatureRef] })),
      hostilities, battlefieldFactIds: [],
      surprisedEntityIds: start.participants.filter(entry => entry.surprise.kind === "surprised").map(entry => entry.creatureRef),
      openingDescription: start.description };
  }
  if (options.continuedRoot) command = continueCompoundRoot(command, rootActionId);
  return stepCombatWorld(profiles, state, command) ?? rejected("invalidRulesInput", "The combat start cannot execute.");
}
