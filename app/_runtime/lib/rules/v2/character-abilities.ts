import { itemById, type GearItemResolver } from "../../dnd/gear";
import { spellDefinition } from "../spell-catalog";
import type { DiceFormula, SpellDefinition, SpellRange } from "../spell-model";
import type { TacticalPosition } from "../tactical-projection";
import { characterProficiencyProfileEnabled } from "../profiles/character-proficiency";
import type { RuntimeProfileManifest } from "../profiles/types";

import type { CharacterRecord, JsonRecord } from "./model";
import { isNonEmptyString, isRecord } from "./validation";
import { attackActionsPerTurn } from "./character-progression";

export type CompiledCharacterCombat = {
  abilityRefs: string[];
  definitions: Record<string, JsonRecord>;
  spellcasting?: JsonRecord;
};

export function buildPlayerCombatEntity(
  profiles: RuntimeProfileManifest,
  character: CharacterRecord,
  compiled: CompiledCharacterCombat,
  controllerPrincipalId?: string,
  tacticalPosition?: TacticalPosition,
): JsonRecord {
  const dexterity = character.abilityScores?.dex ?? 10;
  const maximumHitPoints = character.hitPoints?.maximum ?? 1;
  const currentHitPoints = character.hitPoints?.current ?? maximumHitPoints;
  const resources: Record<string, JsonRecord> = Object.fromEntries(
    Object.entries(character.resources ?? {}).map(([resourceId, current]) => [combatResourceId(resourceId), {
      current: String(current),
      maximum: String(character.resourceMaximums?.[resourceId] ?? current),
    }]),
  );
  for (const entry of character.loadout?.backpack ?? []) {
    resources[`item:${entry.itemId}`] = {
      current: String(entry.quantity),
      maximum: String(entry.quantity),
    };
  }
  return {
    id: character.id,
    entityId: character.id,
    kind: "player",
    name: character.name,
    ...(controllerPrincipalId === undefined ? {} : { controllerPrincipalId }),
    entityOrdinal: character.entityOrdinal,
    sceneId: character.sceneId,
    position: structuredClone(tacticalPosition ?? {
      x: String((Number(character.entityOrdinal) - 1) * 60),
      y: "0",
      elevation: "0",
    }),
    footprint: { width: "60", depth: "60", height: "60" },
    stats: Object.fromEntries(
      ["str", "dex", "con", "int", "wis", "cha"].map((ability) => [
        ability,
        String(character.abilityScores?.[ability] ?? 10),
      ]),
    ),
    proficiencyBonus: String(character.proficiencyBonus ?? 0),
    proficientSkills: [...(character.proficientSkills ?? [])].sort(),
    ...(characterProficiencyProfileEnabled(profiles.extensions)
      ? {
          expertiseSkills: [...(character.expertiseSkills ?? [])].sort(),
          proficientSaves: [...(character.proficientSaves ?? [])].sort(),
        }
      : {}),
    armorClass: String(character.loadout?.armorClass ?? (10 + abilityModifier(dexterity))),
    hitPoints: {
      current: String(currentHitPoints),
      maximum: String(maximumHitPoints),
      temporary: "0",
    },
    speedInches: { walk: String((character.loadout?.speedFeet ?? 30) * 12) },
    attacksPerAttackAction: String(attackActionsPerTurn(character)),
    resources,
    abilityRefs: compiled.abilityRefs,
    ...(compiled.spellcasting === undefined ? {} : { spellcasting: compiled.spellcasting }),
    conditions: {},
    concentration: null,
    lifeState: currentHitPoints === 0 ? "unconscious" : "alive",
    deathSaves: { successes: 0, failures: 0 },
    movement: { spentMilliInches: "0" },
    deathPolicy: "deathSaves",
  };
}

export function buildNpcSpatialEntity(
  character: CharacterRecord,
  tacticalPosition: TacticalPosition,
  visibilityPolicyId: string,
  visibilityFactId?: string,
): JsonRecord {
  if (character.kind !== "npc") throw new TypeError("spatial NPC seed is not an NPC");
  return {
    id: character.id,
    entityId: character.id,
    kind: "npc",
    name: character.name,
    entityOrdinal: character.entityOrdinal,
    sceneId: character.sceneId,
    position: structuredClone(tacticalPosition),
    footprint: { width: "60", depth: "60", height: "60" },
    conditions: {},
    concentration: null,
    lifeState: "alive",
    visibilityPolicyId,
    ...(visibilityFactId === undefined ? {} : { visibilityFactId }),
  };
}

export function synchronizePlayerCombatEntity(
  existing: JsonRecord | undefined,
  initial: JsonRecord,
): JsonRecord {
  if (existing === undefined) return structuredClone(initial);
  const {
    expertiseSkills: _expertiseSkills,
    proficientSaves: _proficientSaves,
    spellcasting: _spellcasting,
    ...prior
  } = existing;
  return {
    ...structuredClone(prior),
    name: initial.name,
    sceneId: initial.sceneId,
    stats: structuredClone(initial.stats),
    proficiencyBonus: initial.proficiencyBonus,
    proficientSkills: structuredClone(initial.proficientSkills ?? []),
    ...(initial.expertiseSkills === undefined
      ? {}
      : { expertiseSkills: structuredClone(initial.expertiseSkills) }),
    ...(initial.proficientSaves === undefined
      ? {}
      : { proficientSaves: structuredClone(initial.proficientSaves) }),
    armorClass: initial.armorClass,
    hitPoints: structuredClone(initial.hitPoints),
    speedInches: structuredClone(initial.speedInches),
    attacksPerAttackAction: initial.attacksPerAttackAction,
    resources: structuredClone(initial.resources),
    abilityRefs: structuredClone(initial.abilityRefs),
    ...(initial.spellcasting === undefined ? {} : { spellcasting: structuredClone(initial.spellcasting) }),
  };
}

const DAMAGE_TYPES: Record<string, string> = {
  "挥砍": "slashing",
  "穿刺": "piercing",
  "钝击": "bludgeoning",
};

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function signed(value: number): string {
  return value === 0 ? "" : value > 0 ? `+${value}` : String(value);
}

function formula(value: DiceFormula, castingModifier: number): string {
  const modifier = value.modifier === "casting"
    ? castingModifier
    : typeof value.modifier === "number" ? value.modifier : 0;
  return `${value.count}d${value.sides}${signed(modifier)}`;
}

function rangeInches(range: SpellRange): number | undefined {
  if (range.kind === "distance") return range.feet * 12;
  if (range.kind === "touch") return 60;
  return range.kind === "self" ? 0 : undefined;
}

function canonicalStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter(isNonEmptyString))].sort()
    : [];
}

function spellcastingAbility(build: JsonRecord, spellId: string): "int" | "wis" | "cha" {
  if (build.raceId === "high-elf" && spellId === "prestidigitation" && build.classId !== "wizard") {
    return "int";
  }
  if (build.raceId === "tiefling" && ["thaumaturgy", "hellish-rebuke"].includes(spellId)) {
    return "cha";
  }
  if (build.classId === "wizard") return "int";
  if (build.classId === "cleric" || build.classId === "ranger") return "wis";
  return "wis";
}

function activation(definition: SpellDefinition): JsonRecord | undefined {
  if (definition.actionCost === "action") {
    return { kind: "actionSpell", spellLevel: String(definition.level) };
  }
  if (definition.actionCost === "bonusAction") {
    return { kind: "bonusActionSpell", spellLevel: String(definition.level) };
  }
  if (definition.actionCost === "reaction") {
    return { kind: "reactionSpell", spellLevel: String(definition.level) };
  }
  return undefined;
}

function spellTarget(definition: SpellDefinition): JsonRecord | undefined {
  const distance = rangeInches(definition.range);
  if (definition.area !== undefined) {
    if (!["sphere", "emanation"].includes(definition.area.shape)) return undefined;
    return {
      kind: "area",
      ...(distance === undefined ? {} : { rangeInches: String(distance) }),
      shape: {
        kind: definition.area.shape,
        radiusInches: String(definition.area.sizeFeet * 12),
        propagation: "straight",
      },
    };
  }
  if (definition.targets.max !== 1) return undefined;
  return {
    kind: "creature",
    count: "1",
    ...(definition.targets.filter === "self" ? { selfOnly: true } : {}),
    ...(definition.range.kind === "touch"
      ? { reachInches: String(distance) }
      : distance === undefined ? {} : { rangeInches: String(distance) }),
    ...(definition.targets.requiresSight === true ? { requiresSight: true } : {}),
  };
}

function compileSpell(
  character: CharacterRecord,
  build: JsonRecord,
  spellId: string,
): JsonRecord | undefined {
  const source = spellDefinition(spellId);
  const spellActivation = source === undefined ? undefined : activation(source);
  const target = source === undefined ? undefined : spellTarget(source);
  if (source === undefined || spellActivation === undefined || target === undefined) return undefined;
  const resolution = source.resolution;
  const isPersistentAreaUtility = resolution.mode === "utility"
    && target.kind === "area"
    && source.duration.kind !== "instant"
    && resolution.effects?.some((effect) => effect.kind === "area") === true;
  if (resolution.special !== undefined || (!isPersistentAreaUtility
    && !["attack", "save", "automatic"].includes(resolution.mode)
    && resolution.healing === undefined)) {
    return undefined;
  }
  const castingAbility = spellcastingAbility(build, spellId);
  const castingModifier = abilityModifier(character.abilityScores?.[castingAbility] ?? 10);
  const definitionId = `ability:${character.id}:spell:${spellId}:level:${character.level ?? 1}:modifier:${castingModifier}:proficiency:${character.proficiencyBonus ?? 0}`;
  const compiled: JsonRecord = {
    definitionId,
    revision: "1",
    rulesBasis: "srd5.1-2014",
    mechanicalKey: `spell:${spellId}`,
    sourceSpellId: spellId,
    activation: spellActivation,
    target,
    ...(source.level === 0 ? {} : {
      costs: [{ kind: "spellSlot", level: String(source.level), amount: "1" }],
    }),
  };
  if (resolution.mode === "attack") compiled.attack = { kind: "spellAttack" };
  if (resolution.save !== undefined) {
    compiled.save = {
      ability: resolution.save.ability,
      halfOnSuccess: resolution.save.onSuccess === "half",
      onSuccess: resolution.save.onSuccess,
    };
  }
  if (resolution.damage !== undefined) {
    compiled.damage = [{
      type: resolution.damage.type,
      formula: formula(resolution.damage.formula, castingModifier),
    }];
  }
  if (resolution.healing !== undefined) {
    compiled.healing = { formula: formula(resolution.healing, castingModifier) };
  }
  if (source.duration.kind !== "instant" && source.duration.concentration === true) {
    compiled.effect = {
      kind: "concentration",
      durationMicros: source.duration.kind === "timed"
        ? String(source.duration.seconds * 1_000_000)
        : null,
    };
  }
  if (Array.isArray(resolution.effects) && resolution.effects.length > 0) {
    compiled.effects = resolution.effects.map((effect) => ({
      tag: effect.tag,
      label: effect.label,
      kind: effect.kind,
      ...(effect.value === undefined ? {} : { value: effect.value }),
    }));
  }
  return compiled;
}

export function compileEquippedWeaponAbility(
  character: CharacterRecord,
  resolveItem: GearItemResolver = itemById,
): JsonRecord | undefined {
  const itemId = character.loadout?.equipped.main;
  const item = resolveItem(itemId);
  if (item === undefined || item.wear !== "weapon" || !isNonEmptyString(item.damage)) return undefined;
  const damage = /^(\d+d\d+)\s*(.+)$/.exec(item.damage.trim());
  if (damage === null) return undefined;
  const ranged = /远程|弹药/.test(item.text);
  const finesse = /灵巧/.test(item.text);
  const strength = abilityModifier(character.abilityScores?.str ?? 10);
  const dexterity = abilityModifier(character.abilityScores?.dex ?? 10);
  const ability = ranged ? "dex" : finesse && dexterity > strength ? "dex" : "str";
  const modifier = ability === "dex" ? dexterity : strength;
  const ranges = /[（(](\d+)\/(\d+)[）)]/.exec(item.text);
  const ammoId = item.id === "light-crossbow"
    ? "bolt"
    : ["shortbow", "longbow"].includes(item.id) ? "arrow" : undefined;
  return {
    definitionId: `ability:${character.id}:weapon:${item.id}:level:${character.level ?? 1}:modifier:${modifier}:proficiency:${character.proficiencyBonus ?? 0}`,
    revision: "1",
    rulesBasis: "srd5.1-2014",
    mechanicalKey: `weapon:${item.id}`,
    activation: { kind: "attack", actionGrant: "attack" },
    target: ranged
      ? {
          kind: "creatureOrEnvironmentFeature",
          count: "1",
          rangeNormalInches: String(Number(ranges?.[1] ?? 80) * 12),
          rangeLongInches: String(Number(ranges?.[2] ?? 320) * 12),
          requiresSight: true,
        }
      : { kind: "creatureOrEnvironmentFeature", count: "1", reachInches: /触及/.test(item.text) ? "120" : "60" },
    ...(ammoId === undefined ? {} : {
      costs: [{ kind: "item", resourceId: `item:${ammoId}`, amount: "1" }],
    }),
    attack: { ability, proficiency: true },
    damage: [{
      type: DAMAGE_TYPES[damage[2].trim()] ?? "bludgeoning",
      formula: `${damage[1]}${signed(modifier)}`,
    }],
  };
}

export function combatResourceId(resourceId: string): string {
  const aliases: Record<string, string> = {
    slot1: "spellSlot:1",
    slot2: "spellSlot:2",
    surge: "resource:action-surge",
    secondWind: "resource:second-wind",
    rage: "resource:rage",
    channel: "resource:channel-divinity",
    superiority: "resource:superiority-die",
    warPriest: "resource:war-priest",
    breath: "resource:breath-weapon",
    relentless: "resource:relentless-endurance",
  };
  const slot = /^slot([1-9])$/.exec(resourceId);
  return slot === null ? aliases[resourceId] ?? resourceId : `spellSlot:${slot[1]}`;
}

export function compileStaticCharacterCombat(
  character: CharacterRecord,
  buildValue: unknown,
): CompiledCharacterCombat {
  const build = isRecord(buildValue) ? buildValue : {};
  const definitions: Record<string, JsonRecord> = {};
  const weapon = compileEquippedWeaponAbility(character);
  if (weapon !== undefined) definitions[String(weapon.definitionId)] = weapon;

  const spellIds = [...new Set([
    ...canonicalStrings(build.cantrips),
    ...canonicalStrings(build.prepared),
  ])].sort();
  for (const spellId of spellIds) {
    const compiled = compileSpell(character, build, spellId);
    if (compiled !== undefined) definitions[String(compiled.definitionId)] = compiled;
  }

  const combatResources = new Set(Object.keys(character.resources ?? {}).map(combatResourceId));
  if (combatResources.has("resource:action-surge")) {
    const definitionId = `ability:${character.id}:class:action-surge`;
    definitions[definitionId] = {
      definitionId,
      revision: "1",
      rulesBasis: "srd5.1-2014",
      mechanicalKey: "action-surge",
      activation: { kind: "free", timing: "ownTurn" },
      costs: [{ kind: "classResource", resourceId: "resource:action-surge", amount: "1" }],
      grants: [{ kind: "normalAction", count: "1" }],
    };
  }
  if (combatResources.has("resource:second-wind")) {
    const definitionId = `ability:${character.id}:class:second-wind:level:${character.level ?? 1}`;
    definitions[definitionId] = {
      definitionId,
      revision: "1",
      rulesBasis: "srd5.1-2014",
      mechanicalKey: "second-wind",
      activation: { kind: "bonusAction" },
      target: { kind: "creature", count: "1", selfOnly: true, rangeInches: "0" },
      costs: [{ kind: "classResource", resourceId: "resource:second-wind", amount: "1" }],
      healing: { formula: `1d10+${character.level ?? 1}` },
    };
  }

  const strengthModifier = abilityModifier(character.abilityScores?.str ?? 10);
  const fallback = `ability:${character.id}:improvised-strike:level:${character.level ?? 1}:modifier:${strengthModifier}:proficiency:${character.proficiencyBonus ?? 0}`;
  definitions[fallback] = {
    definitionId: fallback,
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "attack", actionGrant: "attack" },
    target: { kind: "creature", count: "1", reachInches: "60" },
    attack: { ability: "str", proficiency: true },
    mechanicalKey: "improvised-strike",
    damage: [{ type: "bludgeoning", formula: `1d4${signed(strengthModifier)}` }],
  };

  const representativeSpell = spellIds.find((spellId) => spellDefinition(spellId) !== undefined);
  const castingAbility = representativeSpell === undefined
    ? undefined
    : spellcastingAbility(build, representativeSpell);
  const castingModifier = castingAbility === undefined
    ? undefined
    : abilityModifier(character.abilityScores?.[castingAbility] ?? 10);
  return {
    definitions,
    abilityRefs: Object.keys(definitions).sort(),
    ...(castingAbility === undefined || castingModifier === undefined ? {} : {
      spellcasting: {
        ability: castingAbility,
        spellAttackBonus: String((character.proficiencyBonus ?? 0) + castingModifier),
        spellSaveDc: String(8 + (character.proficiencyBonus ?? 0) + castingModifier),
      },
    }),
  };
}

export function compileCanonicalCharacterCombat(
  character: CharacterRecord,
): CompiledCharacterCombat {
  return compileStaticCharacterCombat(character, {
    ...(character.classId === undefined ? {} : { classId: character.classId }),
    ...(character.raceId === undefined ? {} : { raceId: character.raceId }),
    cantrips: [...(character.cantripIds ?? [])],
    prepared: [...(character.preparedSpellIds ?? [])],
    features: [...(character.featureIds ?? [])],
  });
}
