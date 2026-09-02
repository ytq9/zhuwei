import type { GearItemResolver } from "../../dnd/gear";
import { spellDefinition } from "../spell-catalog";
import type { DiceFormula, SpellDefinition, SpellRange } from "../spell-model";
import type { TacticalPosition } from "../tactical-projection";
import {
  compileAbilityDefinition,
  isRegisteredAbilityRecord,
  registeredAbilityRecord,
  type CompiledAbilityArtifact,
} from "../profiles/ability-compiler";
import { canonicalSha256 } from "../profiles/canonical";
import { characterProficiencyProfileEnabled } from "../profiles/character-proficiency";
import type { RuntimeProfileManifest } from "../profiles/types";

import type { CharacterRecord, JsonRecord } from "./model";
import { isNonEmptyString, isRecord } from "./validation";
import { attackActionsPerTurn } from "./character-progression";
import {
  itemEntryUseAbilityDefinition,
  itemEntryResourceId,
  itemUseBaseAbilityDefinition,
  type ItemEntryV1,
  type ItemSystemStateV1,
} from "./items";
import { itemEntryGearResolver } from "./item-transitions";

export type CompiledCharacterCombat = {
  abilityRefs: string[];
  definitions: Record<string, JsonRecord>;
  spellcasting?: JsonRecord;
};

export type PlayerAbilityCatalogPlan = {
  compiled: CompiledCharacterCombat;
  registrations: CompiledAbilityArtifact[];
};

export function frozenPlayerAbilityMatches(
  expected: JsonRecord,
  registered: unknown,
): boolean {
  if (isRegisteredAbilityRecord(registered)) {
    return registered.definitionHash === (isRegisteredAbilityRecord(expected)
      ? expected.definitionHash
      : canonicalSha256(expected));
  }
  return isRecord(registered)
    && !isRegisteredAbilityRecord(expected)
    && canonicalSha256(registered) === canonicalSha256(expected);
}

/**
 * Plans the exact DefinitionRegistered artifacts required by a player's next
 * item-derived combat closure. An already-compiled record cannot be recreated
 * from current code: it must already exist in the frozen room catalog.
 */
export function planPlayerAbilityCatalog(input: {
  character: CharacterRecord;
  itemSystem: ItemSystemStateV1;
  catalog: Record<string, JsonRecord>;
}): PlayerAbilityCatalogPlan | { error: string } {
  const compiled = compileCanonicalCharacterCombat(
    input.character,
    input.itemSystem,
    input.catalog,
  );
  const catalog = structuredClone(input.catalog);
  const registrations: CompiledAbilityArtifact[] = [];
  for (const [definitionId, definition] of Object.entries(compiled.definitions)
    .sort(([left], [right]) => left.localeCompare(right))) {
    const prior = catalog[definitionId];
    if (prior !== undefined) {
      if (!frozenPlayerAbilityMatches(definition, prior)) {
        return { error: "playerAbilityDefinitionConflict" };
      }
      continue;
    }
    if (isRegisteredAbilityRecord(definition)) {
      return { error: "playerAbilityRegistrationUnavailable" };
    }
    const compiledDefinition = compileAbilityDefinition(definition);
    if (!compiledDefinition.ok) return { error: "playerAbilityDefinitionInvalid" };
    registrations.push(compiledDefinition.artifact);
    catalog[definitionId] = registeredAbilityRecord(compiledDefinition.artifact);
  }
  for (const abilityRef of compiled.abilityRefs) {
    if (compiled.definitions[abilityRef] !== undefined) continue;
    if (!isRegisteredAbilityRecord(catalog[abilityRef])) {
      return { error: "portableItemAbilityUnavailable" };
    }
  }
  return { compiled, registrations };
}

function usableHeldItemEntries(
  itemSystem: ItemSystemStateV1,
  characterId: string,
): ItemEntryV1[] {
  return Object.values(itemSystem.entries)
    .filter((entry) => entry.disposition === "held"
      && entry.holderRef === characterId
      && entry.condition === "usable")
    .sort((left, right) => left.entryId.localeCompare(right.entryId));
}

function heldAmmunitionResourceId(
  itemSystem: ItemSystemStateV1,
  character: CharacterRecord,
  ammunitionDefinitionRef: string,
): string | undefined {
  const equippedEntryId = character.loadout?.equipped.ammo;
  const matching = usableHeldItemEntries(itemSystem, character.id)
    .filter((entry) => entry.definitionRef === ammunitionDefinitionRef);
  const entry = matching.find(({ entryId }) => entryId === equippedEntryId) ?? matching[0];
  return entry === undefined ? undefined : itemEntryResourceId(entry.entryId);
}

export function buildPlayerCombatEntity(
  profiles: RuntimeProfileManifest,
  character: CharacterRecord,
  compiled: CompiledCharacterCombat,
  controllerPrincipalId: string | undefined,
  tacticalPosition: TacticalPosition | undefined,
  itemSystem: ItemSystemStateV1,
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
  for (const entry of usableHeldItemEntries(itemSystem, character.id)) {
    resources[itemEntryResourceId(entry.entryId)] = {
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
    kind: definition.targets.filter === "creature-or-object"
      ? "creatureOrEnvironmentFeature"
      : "creature",
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
  resolveItem: GearItemResolver,
  slot: "main" | "off" = "main",
  resolveAmmunitionResourceId?: (ammunitionItemRef: string) => string | undefined,
): JsonRecord | undefined {
  const itemId = character.loadout?.equipped[slot];
  const item = resolveItem(itemId);
  const weapon = item?.weapon;
  if (item === undefined || item.wear !== "weapon" || weapon === undefined) return undefined;
  const ranged = weapon.rangeNormalInches !== undefined;
  const strength = abilityModifier(character.abilityScores?.str ?? 10);
  const dexterity = abilityModifier(character.abilityScores?.dex ?? 10);
  const ability = weapon.attackAbility === "dex"
    ? "dex"
    : weapon.attackAbility === "finesse" && dexterity > strength ? "dex" : "str";
  const modifier = ability === "dex" ? dexterity : strength;
  const slotIdentity = slot === "main" ? "" : ":off";
  const ammunitionResourceId = weapon.ammunitionId === undefined
    ? undefined
    : resolveAmmunitionResourceId?.(weapon.ammunitionId);
  if (weapon.ammunitionId !== undefined && ammunitionResourceId === undefined) return undefined;
  const requiresSight = weapon.requiresSight ?? ranged;
  return {
    definitionId: `ability:${character.id}:weapon:${item.id}${slotIdentity}:level:${character.level ?? 1}:modifier:${modifier}:proficiency:${character.proficiencyBonus ?? 0}`,
    revision: "1",
    rulesBasis: "srd5.1-2014",
    mechanicalKey: `weapon:${item.id}${slotIdentity}`,
    activation: { kind: "attack", actionGrant: "attack" },
    target: ranged
      ? {
          kind: "creatureOrEnvironmentFeature",
          count: "1",
          rangeNormalInches: weapon.rangeNormalInches,
          rangeLongInches: weapon.rangeLongInches,
          ...(requiresSight ? { requiresSight: true } : {}),
        }
      : {
          kind: "creatureOrEnvironmentFeature",
          count: "1",
          reachInches: weapon.reachInches ?? "60",
          ...(requiresSight ? { requiresSight: true } : {}),
        },
    ...(ammunitionResourceId === undefined ? {} : {
      costs: [{ kind: "item", resourceId: ammunitionResourceId, amount: "1" }],
    }),
    attack: { ability, proficiency: true },
    damage: [{
      type: weapon.damageType,
      formula: `${weapon.damageDice}${signed(modifier)}`,
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
  itemSystem: ItemSystemStateV1,
  itemAbilityCatalog: Record<string, JsonRecord>,
): CompiledCharacterCombat {
  const build = isRecord(buildValue) ? buildValue : {};
  const definitions: Record<string, JsonRecord> = {};
  const weapon = compileEquippedWeaponAbility(
    character,
    itemEntryGearResolver(itemSystem),
    "main",
    (ammunitionDefinitionRef) => heldAmmunitionResourceId(
      itemSystem,
      character,
      ammunitionDefinitionRef,
    ),
  );
  if (weapon !== undefined) definitions[String(weapon.definitionId)] = weapon;

  for (const entry of usableHeldItemEntries(itemSystem, character.id)) {
    const itemDefinition = itemSystem.definitions[entry.definitionRef];
    const use = itemDefinition?.content.use;
    if (itemDefinition === undefined
      || itemDefinition.revision !== entry.definitionRevision
      || use === null
      || entry.quantity < use.quantityCost
      || (use.chargeCost > 0
        && (entry.charges === null || entry.charges.current < use.chargeCost))
      || (use.durabilityCost > 0
        && (entry.durability === null || entry.durability.current < use.durabilityCost))) continue;
    const baseAbility = itemUseBaseAbilityDefinition(itemDefinition, itemAbilityCatalog);
    if (baseAbility === undefined) {
      throw new TypeError("item use ability is not frozen in the current catalog");
    }
    const wrapped = itemEntryUseAbilityDefinition(itemDefinition, entry.entryId, baseAbility);
    definitions[String(wrapped.definitionId)] = wrapped;
  }

  const portableEquippedAbilityRefs = [...new Set(
    Object.values(character.loadout?.equipped ?? {}).flatMap((entryId) => {
      const entry = itemSystem.entries[entryId];
      const definition = entry === undefined
        ? undefined
        : itemSystem.definitions[entry.definitionRef];
      return entry?.disposition === "held"
        && entry.holderRef === character.id
        && entry.condition === "usable"
        && definition?.revision === entry.definitionRevision
        ? definition.content.equippedAbilityRefs
        : [];
    }),
  )].sort();

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
    target: { kind: "creatureOrEnvironmentFeature", count: "1", reachInches: "60" },
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
    abilityRefs: [...new Set([
      ...Object.keys(definitions),
      ...portableEquippedAbilityRefs,
    ])].sort(),
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
  itemSystem: ItemSystemStateV1,
  itemAbilityCatalog: Record<string, JsonRecord>,
): CompiledCharacterCombat {
  return compileStaticCharacterCombat(character, {
    ...(character.classId === undefined ? {} : { classId: character.classId }),
    ...(character.raceId === undefined ? {} : { raceId: character.raceId }),
    cantrips: [...(character.cantripIds ?? [])],
    prepared: [...(character.preparedSpellIds ?? [])],
    features: [...(character.featureIds ?? [])],
  }, itemSystem, itemAbilityCatalog);
}
