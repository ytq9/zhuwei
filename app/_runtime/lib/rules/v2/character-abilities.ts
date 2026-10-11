import { RulesValidationError } from "../errors";
import { CLASS_RESOURCE_CATALOG } from "../../dnd/class-resources";
import { nonItemResources } from "./item-resources";
import type { GearItemResolver } from "../../dnd/gear";
import { spellDefinition, formulaAtSlot, spellMaxTargets, spellAreaSize, spellDurationAtSlot, spellEffectValueAtSlot } from "../spell-catalog";
import { savePushFeet } from "./creature-push";
import type { DiceFormula, SpellDefinition, SpellEffectDefinition, SpellRange } from "../spell-model";
import { CONDITION_IDS } from "./condition-vocabulary";
import type { TacticalPosition } from "../tactical-projection";
import {
  compileAbilityDefinition,
  isRegisteredAbilityRecord,
  registeredAbilityRecord,
  type CompiledAbilityArtifact,
  registeredAbilityDefinition,
} from "../profiles/ability-compiler";
import { canonicalSha256, sameCanonical } from "../profiles/canonical";
import { characterProficiencyProfileEnabled } from "../profiles/character-proficiency";
import type { RuntimeProfileManifest } from "../profiles/types";

import type { CharacterRecord, JsonRecord } from "./model";
import { isNonEmptyString, isRecord } from "./validation";
import { attackActionsPerTurn } from "./character-progression";
import { LEGACY_IMPROVISED_STRIKE_KEY, UNARMED_STRIKE_KEY } from "./combat-ability-names";
import {
  itemEntryUseAbilityDefinition,
  itemEntryResourceId,
  itemUseBaseAbilityDefinition,
  type ItemEntryV1,
  type ItemSystemStateV1,
} from "./items";
import { itemEntryGearResolver } from "./item-transitions";
import type { CombatWeaponUse } from "./combat-weapon-variants";

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
    return isRegisteredAbilityRecord(expected)
      ? registered.definitionHash === expected.definitionHash
      : sameCanonical(registeredAbilityDefinition(registered), expected);
  }
  return isRecord(registered)
    && !isRegisteredAbilityRecord(expected)
    && sameCanonical(registered, expected);
}

/**
 * Plans the exact DefinitionRegistered artifacts required by a player's next
 * item-derived combat closure. An already-compiled record cannot be recreated
 * from current code: it must already exist in the frozen room catalog.
 */
export function planPlayerAbilityCatalog(input: {
  character: CharacterRecord;
  characterBuild?: unknown;
  itemSystem: ItemSystemStateV1;
  catalog: Record<string, JsonRecord>;
}): PlayerAbilityCatalogPlan | { error: string } {
  const compiled = input.characterBuild === undefined
    ? compileCanonicalCharacterCombat(input.character, input.itemSystem, input.catalog)
    : compileStaticCharacterCombat(
        input.character, input.characterBuild, input.itemSystem, input.catalog,
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
    Object.entries(nonItemResources(character.resources ?? {})).map(([resourceId, current]) => [combatResourceId(resourceId), {
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
          conditionImmunities: [...(character.conditionImmunities ?? [])].sort(),
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
  if (character.kind !== "npc") throw new RulesValidationError("spatial NPC seed is not an NPC");
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
    conditionImmunities: _conditionImmunities,
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
    ...(initial.conditionImmunities === undefined ? {} : { conditionImmunities: structuredClone(initial.conditionImmunities) }),
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

function activation(definition: SpellDefinition, slotLevel: number = definition.level): JsonRecord | undefined {
  if (definition.actionCost === "action") {
    return { kind: "actionSpell", spellLevel: String(slotLevel),
      ...(definition.castingSeconds > 6 || definition.ritual === true
        ? { castingTimeMicros: String(definition.castingSeconds * 1_000_000), ritual: definition.ritual === true } : {}) };
  }
  if (definition.actionCost === "bonusAction") {
    return { kind: "bonusActionSpell", spellLevel: String(slotLevel) };
  }
  if (definition.actionCost === "reaction") {
    return { kind: "reactionSpell", spellLevel: String(slotLevel) };
  }
  return undefined;
}

function spellTarget(definition: SpellDefinition, slotLevel: number = definition.level): JsonRecord | undefined {
  const distance = rangeInches(definition.range);
  if (definition.area !== undefined) {
    // SPEC 0013 §5.6 (ADR 0149): a sphere by its radius, a cube by its edge,
    // a cone or line by its length, a line also by its width.
    const size = String(spellAreaSize(definition, slotLevel)! * 12);
    const area = definition.area;
    const shape = area.shape === "sphere" || area.shape === "emanation" ? { kind: area.shape, radiusInches: size }
      : area.shape === "cube" ? { kind: "cube", edgeInches: size }
        : area.shape === "cone" ? { kind: "cone", lengthInches: size }
          : area.shape === "line" ? { kind: "line", lengthInches: size, widthInches: String((area.widthFeet ?? 5) * 12) }
            : undefined;
    if (shape === undefined) return undefined;
    return {
      kind: "area",
      ...(distance === undefined ? {} : { rangeInches: String(distance) }),
      shape: { ...shape, propagation: "straight" },
    };
  }
  const maximum = spellMaxTargets(definition, slotLevel);
  if (maximum === null || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 64
    || definition.targets.allowsRepeat === true) return undefined;
  return {
    kind: definition.targets.filter === "creature-or-object"
      ? "creatureOrEnvironmentFeature"
      : "creature",
    count: String(maximum),
    ...(definition.targets.filter === "self" ? { selfOnly: true } : {}),
    ...(definition.range.kind === "touch"
      ? { reachInches: String(distance) }
      : distance === undefined ? {} : { rangeInches: String(distance) }),
    ...(definition.targets.requiresSight === true ? { requiresSight: true } : {}),
  };
}

/** How long a spell's lasting condition holds, from its catalog duration
 * (SPEC 0012 §10.1); an instantaneous spell leaves none. */
function spellEffectDuration(source: SpellDefinition, slotLevel: number): JsonRecord | undefined {
  const duration = source.duration;
  if (duration.kind === "special") return { kind: "untilEnded" };
  if (duration.kind !== "timed") return undefined;
  if (duration.turnBoundary !== undefined) {
    return { kind: "turnBoundary", subject: duration.turnBoundary.startsWith("caster") ? "source" : "target",
      edge: duration.turnBoundary.endsWith("Start") ? "turnStart" : "turnEnd" };
  }
  return { kind: "timed", durationMicros: String(spellDurationAtSlot(source, slotLevel)! * 1_000_000) };
}

/** SPEC 0012 §10.1: a catalog effect Rules can carry out becomes its frozen
 * mechanic, keeping its tag and label for narration; any other stays a
 * descriptive record, which Rules refuses to cast. */
function compiledSpellEffect(source: SpellDefinition, effect: SpellEffectDefinition, slotLevel: number): JsonRecord {
  const duration = spellEffectDuration(source, slotLevel);
  const lifecycle = (repeats: boolean): JsonRecord => ({
    ...(source.duration.kind !== "instant" && source.duration.concentration === true ? { concentration: true } : {}),
    ...(repeats && source.resolution.save?.repeats === "turnEnd" ? { repeatSave: { edge: "turnEnd" } } : {}),
    ...(effect.endsWhen === undefined || effect.endsWhen.length === 0 ? {} : { endsWhen: [...effect.endsWhen].sort() }),
  });
  const value = spellEffectValueAtSlot(effect, source.level, slotLevel);
  const modifier = effect.modifier === undefined ? undefined
    : effect.modifier.kind === "armorClassBonus" || effect.modifier.kind === "hitPointMaximumBonus"
      ? value === undefined ? undefined : { kind: effect.modifier.kind, amount: value }
      : effect.modifier.kind === "unarmoredArmorClass" ? value === undefined ? undefined : { kind: effect.modifier.kind, base: value }
        : effect.modifier.kind === "speedBonus" ? value === undefined ? undefined : { kind: effect.modifier.kind, feet: value }
          : effect.modifier.kind === "d20BonusDie"
            ? { kind: effect.modifier.kind, sides: effect.modifier.sides, rolls: [...effect.modifier.rolls].sort() }
            : effect.modifier.kind === "weaponDamageDieFromSource" ? { kind: effect.modifier.kind, sides: effect.modifier.sides }
              : { kind: effect.modifier.kind };
  if (modifier !== undefined && duration !== undefined) {
    const kept = lifecycle(false);
    return { kind: "grantModifier", tag: effect.tag, label: effect.label, modifier, duration,
      ...(Object.keys(kept).length === 0 ? {} : { lifecycle: kept }) };
  }
  if (effect.kind === "condition" && (CONDITION_IDS as readonly string[]).includes(effect.tag) && duration !== undefined) {
    const kept = lifecycle(true);
    return { kind: "grantEffect", tag: effect.tag, label: effect.label, condition: effect.tag, duration,
      ...(Object.keys(kept).length === 0 ? {} : { lifecycle: kept }) };
  }
  return {
    tag: effect.tag,
    label: effect.label,
    kind: effect.kind,
    ...(effect.value === undefined ? {} : { value: spellEffectValueAtSlot(effect, source.level, slotLevel) }),
  };
}

function compileSpell(
  character: CharacterRecord,
  build: JsonRecord,
  spellId: string,
  slotLevel: number,
): JsonRecord | undefined {
  const source = spellDefinition(spellId);
  const spellActivation = source === undefined ? undefined : activation(source, slotLevel);
  const target = source === undefined ? undefined : spellTarget(source, slotLevel);
  if (source === undefined || spellActivation === undefined || target === undefined) return undefined;
  const resolution = source.resolution;
  const isPersistentAreaUtility = resolution.mode === "utility"
    && target.kind === "area"
    && source.duration.kind !== "instant"
    && resolution.effects?.some((effect) => effect.kind === "area") === true;
  // ADR 0149: a cube, cone or line spell is compiled only when Rules can carry
  // out each of its effects -- none, or a push on a failed save. Web's
  // restraint and difficult terrain wait for their mechanics.
  if (target.kind === "area" && isRecord(target.shape) && ["cube", "cone", "line"].includes(String(target.shape.kind))
    && (resolution.effects ?? []).some((effect) => resolution.save === undefined || savePushFeet(effect) === undefined)) {
    return undefined;
  }
  if (resolution.special !== undefined || Number(resolution.attacks ?? 1) > 1 || (!isPersistentAreaUtility
    && !["attack", "save", "automatic"].includes(resolution.mode)
    && resolution.healing === undefined)) {
    return undefined;
  }
  const castingAbility = spellcastingAbility(build, spellId);
  const castingModifier = abilityModifier(character.abilityScores?.[castingAbility] ?? 10);
  const castingIdentity = spellActivation.castingTimeMicros === undefined ? ""
    : `:casting:${spellActivation.castingTimeMicros}:ritual:${spellActivation.ritual === true}`;
  const definitionId = `ability:${character.id}:spell:${spellId}:level:${character.level ?? 1}:modifier:${castingModifier}:proficiency:${character.proficiencyBonus ?? 0}${castingIdentity}:slot:${slotLevel}:compiled-v3`;
  const compiled: JsonRecord = {
    definitionId,
    revision: "1",
    rulesBasis: "srd5.1-2014",
    mechanicalKey: `spell:${spellId}`,
    sourceSpellId: spellId,
    activation: spellActivation,
    target,
    ...(source.level === 0 ? {} : {
      costs: [{ kind: "spellSlot", level: String(slotLevel), amount: "1" }],
    }),
  };
  if (resolution.mode === "attack") compiled.attack = { kind: "spellAttack" };
  if (resolution.save !== undefined) {
    compiled.save = {
      ability: resolution.save.ability,
      halfOnSuccess: resolution.save.onSuccess === "half",
      onSuccess: resolution.save.onSuccess,
      ...(resolution.save.advantageInCombat === true ? { advantageWhileFightingSource: true } : {}),
    };
  }
  if (resolution.damage !== undefined) {
    compiled.damage = [{
      type: resolution.damage.type,
      formula: formula(formulaAtSlot(resolution.damage.formula, source.level, slotLevel), castingModifier),
    }];
  }
  if (resolution.healing !== undefined) {
    compiled.healing = { formula: formula(formulaAtSlot(resolution.healing, source.level, slotLevel), castingModifier) };
  }
  if (source.duration.kind !== "instant" && source.duration.concentration === true) {
    compiled.effect = {
      kind: "concentration",
      durationMicros: source.duration.kind === "timed"
        ? String(spellDurationAtSlot(source, slotLevel)! * 1_000_000)
        : null,
    };
  }
  if (Array.isArray(resolution.effects) && resolution.effects.length > 0) {
    compiled.effects = resolution.effects.map((effect) => compiledSpellEffect(source, effect, slotLevel));
  }
  return compiled;
}

/** Stable source identity shared by compilation and frozen-catalog lookup. */
export function equippedWeaponMechanicalKey(entryRef: string, slot: "main" | "off"): string {
  return `weapon:${entryRef}${slot === "main" ? "" : ":off"}`;
}

/** SPEC 0004 §4 (2014): a character whose record lists its weapon
 * proficiencies adds its proficiency bonus only with a weapon of a listed
 * category or kind; one without the list (an NPC's stat block) is proficient
 * with what it wields. A weapon of the standard catalog is its own kind. */
export function weaponProficient(
  character: Pick<CharacterRecord, "proficientWeapons">,
  weapon: { category: string; kind?: string },
  catalogId: string,
): boolean {
  const listed = character.proficientWeapons;
  return listed === undefined || listed.includes(weapon.category) || listed.includes(weapon.kind ?? catalogId);
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
  const proficient = weaponProficient(character, weapon, item.id);
  const compiled: JsonRecord = {
    definitionId: `ability:${character.id}:weapon:${item.id}${slotIdentity}:level:${character.level ?? 1}:modifier:${modifier}:proficiency:${character.proficiencyBonus ?? 0}${proficient ? "" : ":not-proficient"}`,
    revision: "1",
    rulesBasis: "srd5.1-2014",
    mechanicalKey: equippedWeaponMechanicalKey(item.id, slot),
    weaponUse: { entryId: item.id, slot, mode: ranged ? "ranged" : "melee", light: weapon.light === true, bonusAttack: false } satisfies CombatWeaponUse,
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
    attack: { ability, proficiency: proficient },
    damage: [{
      type: weapon.damageType,
      formula: `${weapon.damageDice}${signed(modifier)}`,
    }],
  };
  compiled.definitionId = `${compiled.definitionId}:weapon-v2:${canonicalSha256({ weapon, slot, ability, proficient, ammunitionResourceId: ammunitionResourceId ?? null }).slice(7, 23)}`;
  return compiled;
}

/** Ordinary attacks in either hand are independent of the bonus-attack
 * entitlement. Variants retain one source key, but distinct frozen IDs. */
export function compileEquippedWeaponAbilities(
  character: CharacterRecord, resolveItem: GearItemResolver, slot: "main" | "off",
  resolveAmmunitionResourceId?: (ref: string) => string | undefined,
): JsonRecord[] {
  const item = resolveItem(character.loadout?.equipped[slot]);
  const weapon = item?.weapon;
  if (item === undefined || weapon === undefined) return [];
  const ordinary = compileEquippedWeaponAbility(character, resolveItem, slot, resolveAmmunitionResourceId);
  const variants = ordinary === undefined ? [] : [ordinary];
  const make = (base: JsonRecord, mode: CombatWeaponUse["mode"], damageDice: string, damageModifier: number,
    attackAbility: string, target: JsonRecord, bonusAttack = false, proficient?: boolean) => {
    const { costs: _costs, ...copy } = structuredClone(base);
    const variant: JsonRecord = { ...copy, definitionId: `${base.definitionId}:${mode}${bonusAttack ? ":two-weapon-bonus" : ""}`,
      activation: bonusAttack ? { kind: "bonusAction" } : { kind: "attack", actionGrant: "attack" }, target,
      weaponUse: { entryId: item.id, slot, mode, light: !mode.startsWith("improvised") && weapon.light === true, bonusAttack } satisfies CombatWeaponUse,
      attack: { ability: attackAbility, proficiency: proficient ?? (isRecord(base.attack) && base.attack.proficiency === true) },
      damage: [{ type: mode.startsWith("improvised") ? "bludgeoning" : weapon.damageType, formula: `${damageDice}${signed(damageModifier)}` }] };
    variant.definitionId = `${variant.definitionId}:${canonicalSha256({ damage: variant.damage, attack: variant.attack, target, bonusAttack }).slice(7, 23)}`;
    variants.push(variant);
    return variant;
  };
  const strength = abilityModifier(character.abilityScores?.str ?? 10);
  const dexterity = abilityModifier(character.abilityScores?.dex ?? 10);
  const chosen = weapon.attackAbility === "dex" || (weapon.attackAbility === "finesse" && dexterity > strength) ? "dex" : "str";
  const modifier = chosen === "dex" ? dexterity : strength;
  const basis = ordinary ?? { definitionId: `ability:${character.id}:weapon:${item.id}:${slot}:improvised-v1:modifier:${strength}:${dexterity}`,
    revision: "1", rulesBasis: "srd5.1-2014", mechanicalKey: equippedWeaponMechanicalKey(item.id, slot) };
  if (weapon.reachInches !== undefined && weapon.thrown !== undefined) {
    const thrown = make(basis, "thrown", weapon.damageDice, modifier, chosen,
      { kind: "creatureOrEnvironmentFeature", count: "1", ...weapon.thrown });
    if (weapon.light === true) make(thrown, "thrown", weapon.damageDice, Math.min(0, modifier), chosen, thrown.target as JsonRecord, true);
  } else if (weapon.reachInches !== undefined) {
    make(basis, "improvisedThrown", "1d4", dexterity, "dex",
      { kind: "creatureOrEnvironmentFeature", count: "1", rangeNormalInches: "240", rangeLongInches: "720" }, false,
      character.proficientWeapons?.includes("improvised") === true);
  } else {
    make(basis, "improvisedMelee", "1d4", strength, "str",
      { kind: "creatureOrEnvironmentFeature", count: "1", reachInches: "60" }, false,
      character.proficientWeapons?.includes("improvised") === true);
  }
  if (ordinary !== undefined && weapon.light === true && weapon.reachInches !== undefined)
    make(ordinary, "melee", weapon.damageDice, Math.min(0, modifier), chosen, ordinary.target as JsonRecord, true);
  return variants;
}

/** A real object explicitly held in a hand, with no invented weapon
 * proficiency. Carrying it in a backpack does not grant attacks. */
export function compileImprovisedItemAbilities(character: CharacterRecord, entry: ItemEntryV1, itemSystem: ItemSystemStateV1): JsonRecord[] {
  const item = itemSystem.definitions[entry.definitionRef];
  if (item === undefined || item.revision !== entry.definitionRevision || entry.disposition !== "held" || entry.holderRef !== character.id
    || entry.condition !== "usable" || entry.assemblyRef !== undefined
    || (entry.equippedSlot !== "main" && entry.equippedSlot !== "off")
    || character.loadout?.equipped[entry.equippedSlot] !== entry.entryId
    || !["tool", "object", "equipment", "consumable"].includes(item.content.category)) return [];
  const slot = entry.equippedSlot;
  return (["improvisedMelee", "improvisedThrown"] as const).map(mode => {
    const ability = mode === "improvisedMelee" ? "str" : "dex";
    const modifier = abilityModifier(character.abilityScores?.[ability] ?? 10);
    const proficient = character.proficientWeapons?.includes("improvised") === true;
    return { definitionId: `ability:${character.id}:item:${entry.entryId}:${slot}:${mode}:v1:modifier:${modifier}:proficiency:${proficient ? character.proficiencyBonus ?? 0 : "none"}`,
      revision: "1", rulesBasis: "srd5.1-2014", mechanicalKey: equippedWeaponMechanicalKey(entry.entryId, slot),
      weaponUse: { entryId: entry.entryId, slot, mode, light: false, bonusAttack: false } satisfies CombatWeaponUse,
      activation: { kind: "attack", actionGrant: "attack" },
      target: { kind: "creatureOrEnvironmentFeature", count: "1", ...(mode === "improvisedMelee"
        ? { reachInches: "60" } : { rangeNormalInches: "240", rangeLongInches: "720" }) },
      attack: { ability, proficiency: proficient }, damage: [{ type: "bludgeoning", formula: `1d4${signed(modifier)}` }] };
  });
}

export function combatResourceId(resourceId: string): string {
  const slot = /^slot([1-9])$/.exec(resourceId);
  return slot === null ? (Object.hasOwn(CLASS_RESOURCE_CATALOG, resourceId)
    ? CLASS_RESOURCE_CATALOG[resourceId]!.resourceId : resourceId) : `spellSlot:${slot[1]}`;
}

/** Resolve the one existing player pool represented by a combat resource. */
export function playerResourceKeyForCombatPool(
  character: CharacterRecord,
  resourceId: string,
  pool: JsonRecord,
): string | undefined {
  const keys = Object.keys(character.resources ?? {})
    .filter((key) => combatResourceId(key) === resourceId);
  if (keys.length !== 1) return undefined;
  const key = keys[0];
  const current = character.resources![key];
  const maximum = character.resourceMaximums?.[key];
  const combatCurrent = Number(pool.current);
  const combatMaximum = Number(pool.maximum);
  if (!Number.isSafeInteger(current) || current < 0
    || !Number.isSafeInteger(combatCurrent) || combatCurrent !== current
    || !Number.isSafeInteger(combatMaximum) || combatMaximum < current
    || (maximum !== undefined && maximum !== combatMaximum)) return undefined;
  return key;
}

export function compileStaticCharacterCombat(
  character: CharacterRecord,
  buildValue: unknown,
  itemSystem: ItemSystemStateV1,
  itemAbilityCatalog: Record<string, JsonRecord>,
): CompiledCharacterCombat {
  const build = isRecord(buildValue) ? buildValue : {};
  const definitions: Record<string, JsonRecord> = {};
  for (const slot of ["main", "off"] as const) {
    for (const weapon of compileEquippedWeaponAbilities(character, itemEntryGearResolver(itemSystem), slot,
      ref => heldAmmunitionResourceId(itemSystem, character, ref))) definitions[String(weapon.definitionId)] = weapon;
  }

  for (const entry of usableHeldItemEntries(itemSystem, character.id)) {
    for (const ability of compileImprovisedItemAbilities(character, entry, itemSystem)) definitions[String(ability.definitionId)] = ability;
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
      throw new RulesValidationError("item use ability is not frozen in the current catalog");
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
    const source = spellDefinition(spellId);
    if (source === undefined) continue;
    const slots = source.level === 0 ? [0] : Object.entries(character.resourceMaximums ?? {})
      .flatMap(([key, maximum]) => { const level = /^slot([1-9])$/.exec(key); return level !== null && Number.isSafeInteger(maximum) && maximum > 0 && Number(level[1]) >= source.level ? [Number(level[1])] : []; });
    for (const slotLevel of slots.sort((a, b) => a - b)) {
      const compiled = compileSpell(character, build, spellId, slotLevel);
      if (compiled !== undefined) definitions[String(compiled.definitionId)] = compiled;
    }
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

  // SPEC 0012 §9.1 (ADR 0113), SRD 5.1 (2014) Unarmed Strike: a melee attack
  // every creature is proficient with, dealing 1 + its Strength modifier
  // bludgeoning damage and no dice. A room whose catalog already froze this
  // character's former fallback strike (1d4 + Strength) keeps compiling that
  // one, so the events it recorded replay unchanged.
  const strengthModifier = abilityModifier(character.abilityScores?.str ?? 10);
  const legacyStrike = Object.keys(itemAbilityCatalog)
    .some((ref) => ref.startsWith(`ability:${character.id}:${LEGACY_IMPROVISED_STRIKE_KEY}:`));
  const strikeKey = legacyStrike ? LEGACY_IMPROVISED_STRIKE_KEY : UNARMED_STRIKE_KEY;
  const strike = `ability:${character.id}:${strikeKey}:level:${character.level ?? 1}:modifier:${strengthModifier}:proficiency:${character.proficiencyBonus ?? 0}`;
  definitions[strike] = {
    definitionId: strike,
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "attack", actionGrant: "attack" },
    target: { kind: "creatureOrEnvironmentFeature", count: "1", reachInches: "60" },
    attack: { ability: "str", proficiency: true },
    mechanicalKey: strikeKey,
    damage: [{ type: "bludgeoning", formula: `${legacyStrike ? "1d4" : "1"}${signed(strengthModifier)}` }],
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
