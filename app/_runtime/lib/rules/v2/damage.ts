import type { AuthoritativeWorldState } from "./model";
import { isRecord } from "./validation";
import type { CharacterRecord } from "./model";
import type { JsonRecord } from "./model";

export type FixedDamageResolution = {
  before: number;
  after: number;
  maximum: number;
  died: boolean;
};

/** Shared SRD 5.1 damage primitive for hazards and the later combat adapter. */
export function resolveFixedDamage(
  target: CharacterRecord,
  amount: number,
): FixedDamageResolution {
  if (
    !Number.isSafeInteger(amount)
    || amount < 0
    || target.hitPoints === undefined
    || !Number.isSafeInteger(target.hitPoints.current)
    || !Number.isSafeInteger(target.hitPoints.maximum)
  ) {
    throw new TypeError("fixed damage requires canonical hit points and a non-negative integer");
  }
  const before = target.hitPoints.current;
  const after = Math.max(0, before - amount);
  return { before, after, maximum: target.hitPoints.maximum, died: before > 0 && after === 0 };
}
export type DamageDefense = { immune:boolean;resistant:boolean;vulnerable:boolean };
export type CombatDamageComponent = {
  type: string;
  rolled: number;
  defense: "none" | "resistance" | "immunity" | "vulnerability";
  applied: number;
};

/** Shared SRD 5.1 component pipeline for combat and non-combat hazards. */
export function resolveCombatDamage(
  target: JsonRecord,
  rolled: Array<{ type: string; rolled: number }>,
  defenseFor?: (type:string)=>DamageDefense,
): { components: CombatDamageComponent[]; totalApplied: number; targetPatch: JsonRecord } {
  const hitPoints = target.hitPoints;
  if (!hitPoints || typeof hitPoints !== "object" || Array.isArray(hitPoints)) {
    throw new TypeError("combat damage target lacks hit points");
  }
  const defenses = target.damageDefenses;
  const defenseRecord = defenses && typeof defenses === "object" && !Array.isArray(defenses)
    ? defenses as JsonRecord
    : {};
  const contains = (key: string, type: string) => Array.isArray(defenseRecord[key])
    && (defenseRecord[key] as unknown[]).includes(type);
  const components = rolled.map(({ type, rolled: amount }) => {
    const flags=defenseFor?.(type)??{immune:contains("immune",type),resistant:contains("resistant",type),vulnerable:contains("vulnerable",type)};
    const defense: CombatDamageComponent["defense"] = flags.immune
      ? "immunity"
      : flags.resistant
        ? "resistance"
        : flags.vulnerable
          ? "vulnerability"
          : "none";
    const applied = flags.immune ? 0 : (flags.resistant ? Math.floor(amount / 2) : amount) * (flags.vulnerable ? 2 : 1);
    return { type, rolled: amount, defense, applied };
  });
  const totalApplied = components.reduce((sum, component) => sum + component.applied, 0);
  const patch = structuredClone(target);
  const current = Number((patch.hitPoints as JsonRecord).current);
  const temporary = Number((patch.hitPoints as JsonRecord).temporary ?? 0);
  const absorbed = Math.min(temporary, totalApplied);
  (patch.hitPoints as JsonRecord).temporary = String(temporary - absorbed);
  (patch.hitPoints as JsonRecord).current = String(Math.max(0, current - (totalApplied - absorbed)));
  return { components, totalApplied, targetPatch: patch };
}


export type ParsedDamageFormula = { count: number; sides: number; modifier: number };

export function parseDamageFormula(value: unknown): ParsedDamageFormula | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^([1-9][0-9]*)d([1-9][0-9]*)([+-][0-9]+)?$/.exec(value);
  if (match === null) return undefined;
  const parsed = { count: Number(match[1]), sides: Number(match[2]), modifier: Number(match[3] ?? 0) };
  return Object.values(parsed).every(Number.isSafeInteger) && parsed.sides > 1 ? parsed : undefined;
}

/** One ordered damage tape is shared by combat and authored world abilities. */
export function rolledDamageComponents(
  definition: JsonRecord,
  faces: ReadonlyMap<string, readonly number[]>,
  purposeKey: string,
  options: { critical?:boolean; reservedCriticalDice?:boolean } = {},
): Array<{ type: string; rolled: number }> {
  if (!Array.isArray(definition.damage)) return [];
  const tape = [...(faces.get(purposeKey) ?? [])];
  const result = definition.damage.map((value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("damage component is malformed");
    const component = value as JsonRecord;
    const parsed = parseDamageFormula(component.formula);
    if (typeof component.type !== "string" || parsed === undefined || tape.length < parsed.count) {
      throw new TypeError("damage faces are incomplete");
    }
    const reservedCount=parsed.count*(options.reservedCriticalDice?2:1);
    if(tape.length<reservedCount)throw new TypeError("damage faces are incomplete");
    const reserved=tape.splice(0,reservedCount);
    const rolls = reserved.slice(0,parsed.count*(options.critical?2:1));
    if (rolls.some((face) => !Number.isSafeInteger(face) || face < 1 || face > parsed.sides)) {
      throw new TypeError("damage faces do not match their frozen dice");
    }
    return { type: component.type, rolled: Math.max(0, rolls.reduce((sum, face) => sum + face, 0) + parsed.modifier) };
  });
  if (tape.length !== 0) throw new TypeError("damage faces exceed their frozen dice");
  return result;
}

/** Applies the existing 2014 damage and death policies for every creature. */
export function resolveCreatureDamage(target: JsonRecord, rolled: Array<{ type: string; rolled: number }>, defenseFor?: (type:string)=>DamageDefense) {
  const resolution = resolveCombatDamage(target, rolled, defenseFor);
  const targetPatch = resolution.targetPatch;
  const before = target.hitPoints as JsonRecord;
  const after = targetPatch.hitPoints as JsonRecord;
  const hpDamage = Math.max(0, resolution.totalApplied - Number(before.temporary ?? 0));
  let died = target.lifeState === "dead";
  if (Number(after.current) === 0 && resolution.totalApplied > 0 && !died) {
    const conditions = { ...((targetPatch.conditions ?? {}) as JsonRecord) };
    delete conditions.stable;
    targetPatch.conditions = { ...conditions, unconscious: true, prone: true };
    const massive = Number(before.current) > 0 && hpDamage - Number(before.current) >= Number(before.maximum);
    if (targetPatch.deathPolicy === "deadAtZero" || massive) {
      died = true;
    } else if (Number(before.current) === 0 && hpDamage > 0) {
      const saves = { ...((targetPatch.deathSaves ?? { successes: 0, failures: 0 }) as JsonRecord) };
      saves.failures = Number(saves.failures ?? 0) + 1;
      targetPatch.deathSaves = saves;
      died = Number(saves.failures) >= 3;
    }
    targetPatch.lifeState = died ? "dead" : "unconscious";
  }
  return { ...resolution, targetPatch, died, hitPointDamage: Number(before.current) - Number(after.current) };
}

export function worldDamageTarget(state: AuthoritativeWorldState, targetRef: string): JsonRecord | undefined {
  const core = state.entities[targetRef];
  if (core?.hitPoints === undefined) return undefined;
  const combat = state.combatRuntime.entities[targetRef];
  if (combat !== undefined && isRecord(combat.hitPoints)) return structuredClone(combat);
  const spatial = state.combatRuntime.entities[targetRef];
  return {
    ...(spatial ?? {}), id:targetRef, kind:core.kind, name:core.name, sceneId:core.sceneId,
    lifeState:core.tenureStatus === "dead" ? "dead" : "alive",
    conditionImmunities:[...(core.conditionImmunities ?? [])],
    stats: Object.fromEntries(Object.entries(core.abilityScores ?? {}).map(([key,value])=>[key,String(value)])),
    proficiencyBonus:String(core.proficiencyBonus ?? 0),
    proficientSaves:[...(core.proficientSaves ?? [])],
    hitPoints:{current:String(core.hitPoints.current),maximum:String(core.hitPoints.maximum),temporary:"0"},
    armorClass:String(core.loadout?.armorClass ?? 10),
    conditions:isRecord(spatial?.conditions)?structuredClone(spatial.conditions):{},
    deathPolicy:core.kind === "player" ? "deathSaves" : "deadAtZero",
  };
}
