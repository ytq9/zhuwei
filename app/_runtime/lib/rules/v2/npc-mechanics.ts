import type {
  AuthoritativeWorldState,
  CharacterLoadoutRecord,
  CharacterRecord,
  JsonRecord,
} from "./model";
import { canonicalSha256 } from "../profiles/canonical";
import { isRegisteredAbilityRecord } from "../profiles/ability-compiler";
import {
  allowedSlots,
  itemById,
  stowSlot,
  wearItem,
  type GearItem,
  type GearItemResolver,
  type GearSlot,
} from "../../dnd/gear";
import { compileEquippedWeaponAbility } from "./character-abilities";
import {
  hasExactKeys,
  hasOnlyKeys,
  isNonEmptyString,
  isRecord,
} from "./validation";

export const NPC_MECHANICAL_TEMPLATE_KIND = "npcMechanicalTemplate" as const;
export const NPC_MECHANICAL_TEMPLATE_SCHEMA = "zhuwei.npc-mechanical-template/v1" as const;
export const NPC_MECHANICAL_ITEM_KIND = "npcMechanicalItem" as const;
export const NPC_MECHANICAL_ITEM_SCHEMA = "zhuwei.npc-mechanical-item/v1" as const;

const GEAR_SLOTS = [
  "head", "neck", "cloak", "armor", "hands", "belt", "boots",
  "ring1", "ring2", "main", "off", "ammo",
] as const satisfies readonly GearSlot[];
const GEAR_WEAR = [
  ...GEAR_SLOTS.filter((slot) => !["ring1", "ring2", "main"].includes(slot)),
  "weapon",
  "ring",
  "pack",
] as const;

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const DAMAGE_TYPES = [
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder",
] as const;
const MECHANICAL_ENTITY_FIELDS = [
  "mechanicalDefinitionRef",
  "stats",
  "proficiencyBonus",
  "armorClass",
  "hitPoints",
  "speedInches",
  "abilityRefs",
  "equipmentAbilityRefs",
  "resources",
  "deathPolicy",
  "attacksPerAttackAction",
  "damageDefenses",
  "sizeCategory",
  "spellcasting",
] as const;

function canonicalIntegerString(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === "string"
    && /^(?:0|[1-9][0-9]*)$/u.test(value)
    && Number.isSafeInteger(Number(value))
    && Number(value) >= minimum
    && Number(value) <= maximum;
}

function canonicalSignedIntegerString(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === "string"
    && /^(?:0|-?[1-9][0-9]*)$/u.test(value)
    && Number.isSafeInteger(Number(value))
    && Number(value) >= minimum
    && Number(value) <= maximum;
}

function canonicalStringSet(value: unknown, maximum = 100): value is string[] {
  return Array.isArray(value)
    && value.length <= maximum
    && value.every(isNonEmptyString)
    && value.length === new Set(value).size;
}

function canonicalPoint(value: unknown): value is JsonRecord {
  return isRecord(value)
    && hasExactKeys(value, ["elevation", "x", "y"])
    && [value.x, value.y, value.elevation]
      .every((entry) => canonicalSignedIntegerString(entry, -1_000_000, 1_000_000));
}

function canonicalFootprint(value: unknown): value is JsonRecord {
  return isRecord(value)
    && hasExactKeys(value, ["depth", "height", "width"])
    && [value.depth, value.height, value.width]
      .every((entry) => canonicalIntegerString(entry, 1, 100_000));
}

function canonicalDamageDefenses(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || !hasOnlyKeys(value, [], ["immune", "resistant", "vulnerable"])) {
    return false;
  }
  return [value.immune, value.resistant, value.vulnerable]
    .filter((entry) => entry !== undefined)
    .every((entry) => canonicalStringSet(entry, DAMAGE_TYPES.length)
      && entry.every((damageType) => (DAMAGE_TYPES as readonly string[]).includes(damageType)));
}

function canonicalResourceMaximums(value: unknown): value is JsonRecord {
  return isRecord(value)
    && Object.keys(value).length <= 100
    && Object.entries(value).every(([resourceId, maximum]) =>
      isNonEmptyString(resourceId) && canonicalIntegerString(maximum, 0, 1_000_000));
}

function canonicalSpellcasting(value: unknown): boolean {
  return value === undefined || (isRecord(value)
    && hasExactKeys(value, ["ability", "spellAttackBonus", "spellSaveDc"])
    && (ABILITIES as readonly unknown[]).includes(value.ability)
    && canonicalSignedIntegerString(value.spellAttackBonus, -30, 30)
    && canonicalIntegerString(value.spellSaveDc, 0, 30));
}

function canonicalArmorClassModel(value: unknown): value is JsonRecord {
  return isRecord(value)
    && hasExactKeys(value, ["baseArmorClass", "kind", "shieldBonus"])
    && value.kind === "higherOfBaseAndEquipment"
    && canonicalIntegerString(value.baseArmorClass, 1, 30)
    && (value.shieldBonus === "0" || value.shieldBonus === "2");
}

function canonicalNpcMechanicalItemArmor(value: unknown): boolean {
  if (value === null) return true;
  return isRecord(value)
    && hasExactKeys(value, ["acBase", "acDexCap", "kind"])
    && ["light", "medium", "heavy", "shield"].includes(String(value.kind))
    && (value.kind === "shield"
      ? value.acBase === null && value.acDexCap === null
      : canonicalIntegerString(value.acBase, 1, 30)
        && canonicalIntegerString(value.acDexCap, 0, 99));
}

export function canonicalNpcMechanicalItemWeaponBlueprint(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "attackAbility",
      "ammoRef",
      "damageDice",
      "damageType",
      "rangeLongInches",
      "rangeNormalInches",
      "reachInches",
      "requiresSight",
    ])
    || !["str", "dex", "finesse"].includes(String(value.attackAbility))
    || !(value.ammoRef === null || isNonEmptyString(value.ammoRef))
    || typeof value.damageDice !== "string"
    || !/^[1-9][0-9]{0,2}d(?:4|6|8|10|12|20)$/u.test(value.damageDice)
    || !(DAMAGE_TYPES as readonly unknown[]).includes(value.damageType)
    || typeof value.requiresSight !== "boolean") return false;
  const melee = canonicalIntegerString(value.reachInches, 1, 100_000)
    && value.rangeNormalInches === null
    && value.rangeLongInches === null;
  const ranged = value.reachInches === null
    && canonicalIntegerString(value.rangeNormalInches, 1, 1_000_000)
    && canonicalIntegerString(value.rangeLongInches, 1, 1_000_000)
    && Number(value.rangeLongInches) >= Number(value.rangeNormalInches);
  if (melee) return value.ammoRef === null;
  return ranged && (value.ammoRef === null || itemById(String(value.ammoRef))?.wear === "ammo");
}

export function isNpcMechanicalItemDefinition(value: unknown): value is JsonRecord {
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
    || value.definitionKind !== NPC_MECHANICAL_ITEM_KIND
    || !canonicalIntegerString(value.revision, 1, 1_000_000)
    || !["srd5.1-2014", "zhuwei-product-ruling"].includes(String(value.rulesBasis))
    || !canonicalStringSet(value.causalBasisRefs, 40)
    || !isNonEmptyString(value.visibilityPolicyRef)
    || !isRecord(value.content)) return false;
  const content = value.content;
  if (!hasExactKeys(content, [
    "abilityRefs",
    "armor",
    "label",
    "schema",
    "twoHanded",
    "wear",
    "weapon",
  ])
    || content.schema !== NPC_MECHANICAL_ITEM_SCHEMA
    || !isNonEmptyString(content.label)
    || !(GEAR_WEAR as readonly unknown[]).includes(content.wear)
    || typeof content.twoHanded !== "boolean"
    || (content.twoHanded && content.wear !== "weapon")
    || !canonicalNpcMechanicalItemArmor(content.armor)
    || !canonicalNpcMechanicalItemWeaponBlueprint(content.weapon)
    || !canonicalStringSet(content.abilityRefs, 12)) return false;
  // The current inventory authority models ammunition as a stack in the
  // backpack plus an `ammo` selector.  Dynamic mechanical items are
  // non-stackable instances, so accepting one as ammunition would give the
  // same instance two ownership locations.
  if (content.wear === "ammo") return false;
  if (content.weapon !== null && content.wear !== "weapon") return false;
  if (content.armor === null) return true;
  return (content.armor as JsonRecord).kind === "shield"
    ? content.wear === "off"
    : content.wear === "armor";
}

function canonicalInitialLoadout(value: unknown): value is JsonRecord {
  if (!isRecord(value)
    || !hasExactKeys(value, ["entries"])
    || !Array.isArray(value.entries)
    || value.entries.length > 48) return false;
  const entryIds = new Set<string>();
  return value.entries.every((entry) => {
    if (!isRecord(entry)
      || !hasExactKeys(entry, ["entryId", "equippedSlot", "quantity", "source"])
      || !isNonEmptyString(entry.entryId)
      || entryIds.has(entry.entryId)
      || !(entry.equippedSlot === null
        || (GEAR_SLOTS as readonly unknown[]).includes(entry.equippedSlot))
      || !Number.isSafeInteger(entry.quantity)
      || Number(entry.quantity) < 1
      || Number(entry.quantity) > 1_000_000
      || !isRecord(entry.source)
      || !hasExactKeys(entry.source, ["kind", "ref"])
      || !["standardGear", "npcMechanicalItemDefinition"].includes(String(entry.source.kind))
      || !isNonEmptyString(entry.source.ref)) return false;
    entryIds.add(entry.entryId);
    return true;
  });
}

export function isNpcMechanicalTemplateDefinition(value: unknown): value is JsonRecord {
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
    || value.definitionKind !== NPC_MECHANICAL_TEMPLATE_KIND
    || !canonicalIntegerString(value.revision, 1, 1_000_000)
    || !["srd5.1-2014", "zhuwei-product-ruling"].includes(String(value.rulesBasis))
    || !canonicalStringSet(value.causalBasisRefs, 40)
    || !isNonEmptyString(value.visibilityPolicyRef)
    || !isRecord(value.content)) return false;
  const content = value.content;
  if (!hasOnlyKeys(content, [
    "armorClass",
    "armorClassModel",
    "deathPolicy",
    "footprint",
    "hitPointsMaximum",
    "initialLoadout",
    "intrinsicAbilityRefs",
    "itemDefinitionRefs",
    "label",
    "proficiencyBonus",
    "resourceMaximums",
    "schema",
    "speedInches",
    "stats",
  ], [
    "attacksPerAttackAction",
    "damageDefenses",
    "sizeCategory",
    "spellcasting",
  ])
    || content.schema !== NPC_MECHANICAL_TEMPLATE_SCHEMA
    || !isNonEmptyString(content.label)
    || !isRecord(content.stats)
    || !hasExactKeys(content.stats, ABILITIES)
    || !ABILITIES.every((ability) =>
      canonicalIntegerString((content.stats as JsonRecord)[ability], 1, 30))
    || !canonicalIntegerString(content.proficiencyBonus, 2, 9)
    || !canonicalIntegerString(content.armorClass, 1, 30)
    || !canonicalArmorClassModel(content.armorClassModel)
    || (content.armorClassModel as JsonRecord).baseArmorClass !== content.armorClass
    || !canonicalIntegerString(content.hitPointsMaximum, 1, 1_000_000)
    || !canonicalFootprint(content.footprint)
    || !isRecord(content.speedInches)
    || Object.keys(content.speedInches).length === 0
    || !hasOnlyKeys(content.speedInches, [], ["burrow", "climb", "fly", "swim", "walk"])
    || !Object.values(content.speedInches)
      .every((speed) => canonicalIntegerString(speed, 0, 1_000_000))
    || !["deadAtZero", "deathSaves", "defeatedAtZero"].includes(String(content.deathPolicy))
    || !canonicalStringSet(content.intrinsicAbilityRefs, 24)
    || !canonicalStringSet(content.itemDefinitionRefs, 24)
    || !canonicalInitialLoadout(content.initialLoadout)
    || !canonicalResourceMaximums(content.resourceMaximums)
    || !canonicalDamageDefenses(content.damageDefenses)
    || !canonicalSpellcasting(content.spellcasting)
    || !(content.attacksPerAttackAction === undefined
      || canonicalIntegerString(content.attacksPerAttackAction, 1, 100))
    || !(content.sizeCategory === undefined
      || ["tiny", "small", "medium", "large", "huge", "gargantuan"]
        .includes(String(content.sizeCategory)))) return false;
  return true;
}

export function isNpcSpatialShell(value: unknown): value is JsonRecord {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && value.entityId === value.id
    && value.kind === "npc"
    && isNonEmptyString(value.name)
    && isNonEmptyString(value.sceneId)
    && canonicalPoint(value.position)
    && canonicalFootprint(value.footprint)
    && MECHANICAL_ENTITY_FIELDS.every((field) => value[field] === undefined);
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalSha256(left) === canonicalSha256(right);
}

export function canPromoteNpcSpatialShell(shell: unknown, entity: unknown): boolean {
  if (!isNpcSpatialShell(shell)
    || !isRecord(entity)
    || !isNonEmptyString(entity.mechanicalDefinitionRef)) return false;
  return shell.id === entity.id
    && shell.entityId === entity.entityId
    && shell.kind === entity.kind
    && shell.name === entity.name
    && shell.sceneId === entity.sceneId
    && sameJson(shell.position, entity.position)
    && sameJson(shell.footprint, entity.footprint)
    && shell.visibilityPolicyId === entity.visibilityPolicyId
    && shell.visibilityFactId === entity.visibilityFactId;
}

function numericAbilityScores(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)
    || !hasExactKeys(value, ABILITIES)
    || !ABILITIES.every((ability) => canonicalIntegerString(value[ability], 1, 30))) {
    return undefined;
  }
  return Object.fromEntries(ABILITIES.map((ability) => [ability, Number(value[ability])]));
}

export function npcCoreMechanicsCompatible(
  character: CharacterRecord,
  entity: JsonRecord,
): boolean {
  if (character.kind !== "npc") return false;
  const scores = numericAbilityScores(entity.stats);
  const proficiencyBonus = Number(entity.proficiencyBonus);
  if (scores === undefined || !Number.isSafeInteger(proficiencyBonus)) return false;
  const priorScores = character.abilityScores ?? character.socialMechanics?.abilityScores;
  if (priorScores !== undefined
    && ABILITIES.some((ability) => priorScores[ability] !== scores[ability])) return false;
  const priorProficiency = character.proficiencyBonus ?? character.socialMechanics?.proficiencyBonus;
  if (priorProficiency !== undefined && priorProficiency !== proficiencyBonus) return false;
  if (character.hitPoints !== undefined) {
    if (!isRecord(entity.hitPoints)
      || character.hitPoints.current !== Number(entity.hitPoints.current)
      || character.hitPoints.maximum !== Number(entity.hitPoints.maximum)) return false;
  }
  const coreResources = character.resources ?? {};
  const coreMaximums = character.resourceMaximums ?? {};
  if (isRecord(entity.resources)) {
    for (const [resourceId, pool] of Object.entries(entity.resources)) {
      if (resourceId.startsWith("item:")) continue;
      if (!isRecord(pool)) return false;
      if (coreResources[resourceId] !== undefined
        && coreResources[resourceId] !== Number(pool.current)) return false;
      if (coreMaximums[resourceId] !== undefined
        && coreMaximums[resourceId] !== Number(pool.maximum)) return false;
    }
  }
  return true;
}

export function npcCoreCombatRuntimeMatches(
  character: CharacterRecord,
  entity: JsonRecord,
): boolean {
  if (!npcCoreMechanicsCompatible(character, entity)
    || !isRecord(entity.hitPoints)
    || character.hitPoints?.current !== Number(entity.hitPoints.current)
    || character.hitPoints.maximum !== Number(entity.hitPoints.maximum)
    || !isRecord(entity.resources)) return false;
  const coreResources = character.resources ?? {};
  const coreMaximums = character.resourceMaximums ?? {};
  return Object.entries(entity.resources).every(([resourceId, pool]) =>
    resourceId.startsWith("item:") || (isRecord(pool)
      && coreResources[resourceId] === Number(pool.current)
      && coreMaximums[resourceId] === Number(pool.maximum)));
}

export function npcMechanicalDefinitionClosureValid(
  definition: unknown,
  catalog: Record<string, JsonRecord>,
): boolean {
  if (!isNpcMechanicalTemplateDefinition(definition)) return false;
  const content = definition.content as JsonRecord;
  const resourceMaximums = content.resourceMaximums as JsonRecord;
  const abilityValid = (abilityRef: string): boolean => {
    const ability = catalog[abilityRef];
    if (!isRegisteredAbilityRecord(ability)) return false;
    if (!Array.isArray(ability.costs)) return true;
    return ability.costs.every((cost) => !isRecord(cost)
      || !isNonEmptyString(cost.resourceId)
      || cost.resourceId in resourceMaximums);
  };
  const itemDefinitionRefs = content.itemDefinitionRefs as string[];
  if (!(content.intrinsicAbilityRefs as string[]).every(abilityValid)
    || !itemDefinitionRefs.every((definitionRef) => {
      const item = catalog[definitionRef];
      return isNpcMechanicalItemDefinition(item)
        && (item.content as JsonRecord).abilityRefs instanceof Array
        && ((item.content as JsonRecord).abilityRefs as string[]).every(abilityValid);
    })) return false;
  const initialLoadout = content.initialLoadout as JsonRecord;
  const equipped = new Map<string, GearItem>();
  const entriesValid = (initialLoadout.entries as JsonRecord[]).every((entry) => {
    const source = entry.source as JsonRecord;
    const gear = source.kind === "standardGear"
      ? itemById(String(source.ref))
      : npcMechanicalItemGear(catalog[String(source.ref)], String(source.ref));
    if (gear === undefined
      || (source.kind === "npcMechanicalItemDefinition"
        && !itemDefinitionRefs.includes(String(source.ref)))) return false;
    const stackableStandard = source.kind === "standardGear"
      && (gear.wear === "pack" || gear.wear === "ammo");
    if ((!stackableStandard && entry.quantity !== 1)
      || (source.kind === "npcMechanicalItemDefinition" && entry.quantity !== 1)) return false;
    if (entry.equippedSlot === null) return true;
    const slot = String(entry.equippedSlot) as GearSlot;
    if (gear.wear === "ammo") {
      if (slot !== "ammo") return false;
      equipped.set(slot, gear);
      return true;
    }
    if (entry.quantity !== 1) return false;
    if (equipped.has(slot) || !allowedSlots(gear).includes(slot)) return false;
    equipped.set(slot, gear);
    return true;
  });
  return entriesValid
    && !(equipped.get("main")?.twoHanded === true && equipped.has("off"));
}

export function npcMechanicalItemDefinitionClosureValid(
  definition: unknown,
  catalog: Record<string, JsonRecord>,
): boolean {
  if (!isNpcMechanicalItemDefinition(definition)) return false;
  return ((definition.content as JsonRecord).abilityRefs as string[]).every((abilityRef) =>
    isRegisteredAbilityRecord(catalog[abilityRef]));
}

function npcMechanicalRuntimeItemId(
  entityId: string,
  source: "initial" | "established" | "transfer",
  identity: JsonRecord,
): string {
  return `npc-item:${entityId}:${source}:${canonicalSha256(identity).slice("sha256:".length)}`;
}

export function transferredNpcMechanicalItemId(
  toCharacterId: string,
  sourceItemId: string,
  rootActionId: string,
): string {
  return npcMechanicalRuntimeItemId(toCharacterId, "transfer", {
    rootActionId,
    sourceItemId,
    toCharacterId,
  });
}

function npcMechanicalItemGear(
  definition: unknown,
  itemId: string,
): GearItem | undefined {
  if (!isNpcMechanicalItemDefinition(definition)) return undefined;
  const content = definition.content as JsonRecord;
  const armor = isRecord(content.armor) ? content.armor : undefined;
  return {
    id: itemId,
    name: String(content.label),
    wear: content.wear as GearItem["wear"],
    twoHanded: content.twoHanded === true,
    ...(armor === undefined ? {} : {
      armor: armor.kind as GearItem["armor"],
      ...(armor.acBase === null ? {} : { acBase: Number(armor.acBase) }),
      ...(armor.acDexCap === null ? {} : { acDexCap: Number(armor.acDexCap) }),
    }),
    text: "Frozen NPC mechanical item.",
  };
}

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function signed(value: number): string {
  return value === 0 ? "" : value > 0 ? `+${value}` : String(value);
}

function compileNpcMechanicalItemWeaponAbility(
  character: CharacterRecord,
  definition: JsonRecord,
): JsonRecord | undefined {
  if (!isNpcMechanicalItemDefinition(definition)) return undefined;
  const content = definition.content as JsonRecord;
  if (!isRecord(content.weapon)) return undefined;
  const weapon = content.weapon;
  const strength = abilityModifier(character.abilityScores?.str ?? 10);
  const dexterity = abilityModifier(character.abilityScores?.dex ?? 10);
  const ability = weapon.attackAbility === "finesse"
    ? (dexterity > strength ? "dex" : "str")
    : String(weapon.attackAbility) as "str" | "dex";
  const modifier = ability === "dex" ? dexterity : strength;
  return {
    definitionId: `ability:${character.id}:npc-item:${String(definition.definitionId)}:modifier:${modifier}:proficiency:${character.proficiencyBonus ?? 0}`,
    revision: "1",
    rulesBasis: "srd5.1-2014",
    mechanicalKey: `npc-item-weapon:${String(definition.definitionId)}`,
    activation: { kind: "attack", actionGrant: "attack" },
    target: weapon.reachInches === null
      ? {
          kind: "creatureOrEnvironmentFeature",
          count: "1",
          rangeNormalInches: weapon.rangeNormalInches,
          rangeLongInches: weapon.rangeLongInches,
          requiresSight: weapon.requiresSight,
        }
      : {
          kind: "creatureOrEnvironmentFeature",
          count: "1",
          reachInches: weapon.reachInches,
          requiresSight: weapon.requiresSight,
        },
    attack: { ability, proficiency: true },
    ...(weapon.ammoRef === null ? {} : {
      costs: [{ kind: "item", resourceId: `item:${String(weapon.ammoRef)}`, amount: "1" }],
    }),
    damage: [{
      type: weapon.damageType,
      formula: `${String(weapon.damageDice)}${signed(modifier)}`,
    }],
  };
}

export function npcMechanicalItemResolver(
  loadout: CharacterLoadoutRecord | undefined,
  catalog: Record<string, JsonRecord>,
): GearItemResolver {
  return (itemId) => {
    if (!isNonEmptyString(itemId)) return undefined;
    const instance = loadout?.mechanicalItems?.[itemId];
    if (instance === undefined) return itemById(itemId);
    if (instance.status !== "usable") return undefined;
    if (instance.sourceKind === "standardGear") {
      const standard = itemById(instance.definitionRef);
      return standard === undefined ? undefined : { ...standard, id: instance.definitionRef };
    }
    return npcMechanicalItemGear(catalog[instance.definitionRef], instance.definitionRef);
  };
}

function npcMechanicalLoadoutEquipmentValid(
  loadout: CharacterLoadoutRecord,
  catalog: Record<string, JsonRecord>,
): boolean {
  const resolveItem = npcMechanicalItemResolver(loadout, catalog);
  for (const [slotValue, itemId] of Object.entries(loadout.equipped)) {
    if (!(GEAR_SLOTS as readonly string[]).includes(slotValue)) return false;
    if (slotValue === "ammo") {
      if (itemById(itemId)?.wear !== "ammo"
        || !loadout.backpack.some((entry) => entry.itemId === itemId)) return false;
      continue;
    }
    const item = resolveItem(itemId);
    if (item === undefined || !allowedSlots(item).includes(slotValue as GearSlot)) return false;
  }
  return !(resolveItem(loadout.equipped.main)?.twoHanded === true
    && loadout.equipped.off !== undefined);
}

export function npcEquipmentMechanics(
  character: CharacterRecord,
  catalog: Record<string, JsonRecord>,
): { definitions: JsonRecord[]; refs: string[] } {
  const definitions: JsonRecord[] = [];
  const refs = new Set<string>();
  const loadout = character.loadout;
  const resolveItem = npcMechanicalItemResolver(loadout, catalog);
  const standardWeapon = compileEquippedWeaponAbility(character, resolveItem);
  const mainItemId = loadout?.equipped.main;
  const mainInstance = mainItemId === undefined
    ? undefined
    : loadout?.mechanicalItems?.[mainItemId];
  if (standardWeapon !== undefined
    && (mainInstance === undefined || mainInstance.sourceKind === "standardGear")) {
    definitions.push(standardWeapon);
    refs.add(String(standardWeapon.definitionId));
  }
  if (mainInstance?.status === "usable"
    && mainInstance.sourceKind === "npcMechanicalItemDefinition") {
    const itemDefinition = catalog[mainInstance.definitionRef];
    const itemWeapon = isRecord(itemDefinition)
      ? compileNpcMechanicalItemWeaponAbility(character, itemDefinition)
      : undefined;
    if (itemWeapon !== undefined) {
      definitions.push(itemWeapon);
      refs.add(String(itemWeapon.definitionId));
    }
  }
  for (const itemId of Object.values(loadout?.equipped ?? {})) {
    const instance = loadout?.mechanicalItems?.[itemId];
    if (instance?.status !== "usable"
      || instance.sourceKind !== "npcMechanicalItemDefinition") continue;
    const definition = catalog[instance.definitionRef];
    if (!isNpcMechanicalItemDefinition(definition)) continue;
    for (const abilityRef of (definition.content as JsonRecord).abilityRefs as string[]) {
      refs.add(abilityRef);
    }
  }
  return { definitions, refs: [...refs].sort() };
}

export function npcMechanicalEntityMatchesTemplate(
  entity: unknown,
  definition: unknown,
  catalog: Record<string, JsonRecord>,
  character?: CharacterRecord,
): boolean {
  if (!isRecord(entity)
    || !isNpcMechanicalTemplateDefinition(definition)
    || !npcMechanicalDefinitionClosureValid(definition, catalog)
    || entity.mechanicalDefinitionRef !== definition.definitionId
    || !isRecord(entity.hitPoints)
    || !isRecord(entity.resources)) return false;
  const entityResources = entity.resources;
  const content = definition.content as JsonRecord;
  const equipmentAbilityRefs = Array.isArray(entity.equipmentAbilityRefs)
    ? entity.equipmentAbilityRefs
    : undefined;
  const effectiveCharacter = character ?? {
    id: String(entity.entityId),
    kind: "npc",
    name: String(entity.name),
    sceneId: String(entity.sceneId),
    tenureStatus: "active",
    entityOrdinal: "1",
    abilityScores: numericAbilityScores(content.stats),
    proficiencyBonus: Number(content.proficiencyBonus),
    loadout: initialNpcMechanicalLoadout(definition, entity, catalog),
  } satisfies CharacterRecord;
  const equipment = npcEquipmentMechanics(effectiveCharacter, catalog);
  const expectedEquipmentAbilityRefs = equipment.refs;
  const expectedAbilityRefs = [
    ...(content.intrinsicAbilityRefs as string[]),
    ...expectedEquipmentAbilityRefs,
  ].filter((ref, index, all) => all.indexOf(ref) === index).sort();
  const derivedArmorClass = npcArmorClassForLoadout(
    definition,
    effectiveCharacter.loadout,
    catalog,
  );
  const expectedSpeedFeet = Math.max(1, Math.floor(Number(
    (content.speedInches as JsonRecord).walk ?? 360,
  ) / 12));
  if (effectiveCharacter.loadout === undefined
    || !npcMechanicalLoadoutEquipmentValid(effectiveCharacter.loadout, catalog)
    || !sameJson(entity.stats, content.stats)
    || entity.proficiencyBonus !== content.proficiencyBonus
    || entity.armorClass !== String(derivedArmorClass)
    || effectiveCharacter.loadout?.armorClass !== derivedArmorClass
    || effectiveCharacter.loadout?.speedFeet !== expectedSpeedFeet
    || entity.hitPoints.maximum !== content.hitPointsMaximum
    || Number(entity.hitPoints.current) > Number(entity.hitPoints.maximum)
    || !sameJson(entity.footprint, content.footprint)
    || !sameJson(entity.speedInches, content.speedInches)
    || entity.deathPolicy !== content.deathPolicy
    || !sameJson(equipmentAbilityRefs, expectedEquipmentAbilityRefs)
    || !sameJson(entity.abilityRefs, expectedAbilityRefs)
    || equipment.definitions.some((equipmentDefinition) => {
      const abilityRef = String(equipmentDefinition.definitionId);
      const registered = catalog[abilityRef];
      return !isRegisteredAbilityRecord(registered)
        || registered.definitionHash !== canonicalSha256(equipmentDefinition);
    })
    || entity.attacksPerAttackAction !== content.attacksPerAttackAction
    || !sameJson(entity.damageDefenses, content.damageDefenses)
    || entity.sizeCategory !== content.sizeCategory
    || !sameJson(entity.spellcasting, content.spellcasting)) return false;
  const maximums = content.resourceMaximums as JsonRecord;
  const mechanicalResources = Object.fromEntries(
    Object.entries(entityResources).filter(([resourceId]) => !resourceId.startsWith("item:")),
  );
  const itemResources = Object.fromEntries(
    Object.entries(entityResources).filter(([resourceId]) => resourceId.startsWith("item:")),
  );
  const backpack = effectiveCharacter.loadout?.backpack ?? [];
  const itemResourcesMatch = Object.keys(itemResources).length === backpack.length
    && backpack.every(({ itemId, quantity }) => {
      const pool = itemResources[`item:${itemId}`];
      return isRecord(pool)
        && canonicalIntegerString(pool.current, 0, 1_000_000)
        && canonicalIntegerString(pool.maximum, 0, 1_000_000)
        && Number(pool.current) === quantity
        && Number(pool.maximum) >= quantity;
    });
  return itemResourcesMatch
    && Object.keys(mechanicalResources).length === Object.keys(maximums).length
    && Object.entries(maximums).every(([resourceId, maximum]) => {
      const pool = entityResources[resourceId];
      return isRecord(pool)
        && pool.maximum === maximum
        && Number(pool.current) <= Number(pool.maximum);
    });
}

export function npcArmorClassForLoadout(
  definition: JsonRecord,
  loadout: CharacterLoadoutRecord | undefined,
  catalog: Record<string, JsonRecord> = {},
): number {
  const content = npcMechanicalTemplateContent(definition);
  if (content === undefined || !canonicalArmorClassModel(content.armorClassModel)) {
    throw new TypeError("NPC armor class model is unavailable");
  }
  const model = content.armorClassModel;
  const base = Number(model.baseArmorClass);
  if (loadout === undefined) return base;
  const resolveItem = npcMechanicalItemResolver(loadout, catalog);
  const armor = resolveItem(loadout.equipped.armor);
  const dexterity = Math.floor((Number((content.stats as JsonRecord).dex) - 10) / 2);
  const wornArmor = armor?.armor !== undefined
    && armor.armor !== "shield"
    && armor.acBase !== undefined
    ? armor.acBase + (armor.acDexCap === 0
      ? 0
      : Math.min(dexterity, armor.acDexCap ?? 0))
    : base;
  const shield = resolveItem(loadout.equipped.off)?.armor === "shield"
    ? Number(model.shieldBonus)
    : 0;
  return Math.max(base, wornArmor) + shield;
}

export function initialNpcMechanicalLoadout(
  definition: JsonRecord,
  entity: JsonRecord,
  catalog: Record<string, JsonRecord> = {},
): CharacterLoadoutRecord {
  const walkInches = isRecord(entity.speedInches)
    ? Number(entity.speedInches.walk)
    : 360;
  const content = npcMechanicalTemplateContent(definition);
  if (content === undefined || !canonicalInitialLoadout(content.initialLoadout)) {
    throw new TypeError("NPC initial loadout is unavailable");
  }
  const equipped: Record<string, string> = {};
  const backpack: CharacterLoadoutRecord["backpack"] = [];
  const mechanicalItems: NonNullable<CharacterLoadoutRecord["mechanicalItems"]> = {};
  for (const rawEntry of (content.initialLoadout as JsonRecord).entries as JsonRecord[]) {
    const source = rawEntry.source as JsonRecord;
    const quantity = Number(rawEntry.quantity);
    const standard = source.kind === "standardGear" ? itemById(String(source.ref)) : undefined;
    if (standard !== undefined && (standard.wear === "pack" || standard.wear === "ammo")) {
      const itemId = String(source.ref);
      const existing = backpack.find((entry) => entry.itemId === itemId);
      if (existing === undefined) backpack.push({ itemId, quantity });
      else existing.quantity += quantity;
      if (rawEntry.equippedSlot === "ammo") equipped.ammo = itemId;
      continue;
    }
    const itemId = npcMechanicalRuntimeItemId(String(entity.entityId), "initial", {
      entityId: String(entity.entityId),
      entryId: String(rawEntry.entryId),
    });
    mechanicalItems[itemId] = {
      sourceKind: source.kind as "standardGear" | "npcMechanicalItemDefinition",
      definitionRef: String(source.ref),
      status: "usable",
    };
    if (rawEntry.equippedSlot === null) {
      backpack.push({ itemId, quantity: 1 });
    } else {
      equipped[String(rawEntry.equippedSlot)] = itemId;
    }
  }
  backpack.sort((left, right) => left.itemId.localeCompare(right.itemId));
  const provisional: CharacterLoadoutRecord = {
    armorClass: Number((content.armorClassModel as JsonRecord).baseArmorClass),
    speedFeet: Number.isSafeInteger(walkInches) && walkInches > 0
      ? Math.max(1, Math.floor(walkInches / 12))
      : 30,
    equipped,
    backpack,
    ...(Object.keys(mechanicalItems).length === 0 ? {} : { mechanicalItems }),
  };
  return {
    ...provisional,
    armorClass: npcArmorClassForLoadout(definition, provisional, catalog),
  };
}

/**
 * Freezes a pre-combat NPC inventory into the same per-instance ownership
 * model used by a template's initial loadout.  Standard pack items and
 * ammunition remain quantity based; every equippable standard item receives
 * a deterministic owner-scoped identity before the combat entity is emitted.
 */
export function materializeNpcMechanicalLoadout(
  definition: JsonRecord,
  entity: JsonRecord,
  catalog: Record<string, JsonRecord>,
  current?: CharacterLoadoutRecord,
): CharacterLoadoutRecord | undefined {
  if (current === undefined) return initialNpcMechanicalLoadout(definition, entity, catalog);
  const entityId = String(entity.entityId);
  const content = npcMechanicalTemplateContent(definition);
  if (!isNonEmptyString(entityId) || content === undefined) return undefined;
  const equipped: Record<string, string> = {};
  const backpack: CharacterLoadoutRecord["backpack"] = [];
  const mechanicalItems: NonNullable<CharacterLoadoutRecord["mechanicalItems"]> =
    structuredClone(current.mechanicalItems ?? {});
  let newInstanceCount = 0;
  const addStandardInstance = (
    standardRef: string,
    identity: JsonRecord,
    destination: { kind: "equipped"; slot: string } | { kind: "backpack" },
  ): boolean => {
    newInstanceCount += 1;
    if (newInstanceCount > 48) return false;
    const itemId = npcMechanicalRuntimeItemId(entityId, "established", identity);
    if (mechanicalItems[itemId] !== undefined) return false;
    mechanicalItems[itemId] = {
      sourceKind: "standardGear",
      definitionRef: standardRef,
      status: "usable",
    };
    if (destination.kind === "equipped") equipped[destination.slot] = itemId;
    else backpack.push({ itemId, quantity: 1 });
    return true;
  };

  for (const [slot, itemId] of Object.entries(current.equipped)
    .sort(([left], [right]) => left.localeCompare(right))) {
    if (slot === "ammo") {
      if (itemById(itemId)?.wear !== "ammo") return undefined;
      equipped[slot] = itemId;
      continue;
    }
    if (current.mechanicalItems?.[itemId] !== undefined) {
      equipped[slot] = itemId;
      continue;
    }
    const standard = itemById(itemId);
    if (standard === undefined || standard.wear === "pack" || standard.wear === "ammo") {
      equipped[slot] = itemId;
      continue;
    }
    if (!addStandardInstance(itemId, { entityId, itemId, location: "equipped", slot }, {
      kind: "equipped",
      slot,
    })) return undefined;
  }

  for (const entry of current.backpack) {
    if (current.mechanicalItems?.[entry.itemId] !== undefined) {
      backpack.push(structuredClone(entry));
      continue;
    }
    const standard = itemById(entry.itemId);
    if (standard === undefined || standard.wear === "pack" || standard.wear === "ammo") {
      backpack.push(structuredClone(entry));
      continue;
    }
    if (entry.quantity > 48 || newInstanceCount + entry.quantity > 48) return undefined;
    for (let index = 0; index < entry.quantity; index += 1) {
      if (!addStandardInstance(entry.itemId, {
        entityId,
        index,
        itemId: entry.itemId,
        location: "backpack",
      }, { kind: "backpack" })) return undefined;
    }
  }
  backpack.sort((left, right) => left.itemId.localeCompare(right.itemId));
  if (equipped.ammo !== undefined
    && !backpack.some((entry) => entry.itemId === equipped.ammo)) {
    delete equipped.ammo;
  }
  const walkInches = isRecord(content.speedInches)
    ? Number(content.speedInches.walk)
    : 360;
  const provisional: CharacterLoadoutRecord = {
    armorClass: current.armorClass,
    speedFeet: Number.isSafeInteger(walkInches) && walkInches > 0
      ? Math.max(1, Math.floor(walkInches / 12))
      : 30,
    equipped,
    backpack,
    ...(Object.keys(mechanicalItems).length === 0 ? {} : { mechanicalItems }),
  };
  if (!npcMechanicalLoadoutEquipmentValid(provisional, catalog)) return undefined;
  return {
    ...provisional,
    armorClass: npcArmorClassForLoadout(definition, provisional, catalog),
  };
}

export function synchronizeCombatItemResources(
  entity: JsonRecord | undefined,
  loadout: CharacterLoadoutRecord,
): void {
  if (entity === undefined) return;
  const prior = isRecord(entity.resources) ? entity.resources : {};
  const resources: JsonRecord = Object.fromEntries(
    Object.entries(prior).filter(([resourceId]) => !resourceId.startsWith("item:")),
  );
  for (const { itemId, quantity } of loadout.backpack) {
    const resourceId = `item:${itemId}`;
    const previous = isRecord(prior[resourceId]) ? prior[resourceId] : undefined;
    const previousMaximum = Number(previous?.maximum ?? 0);
    resources[resourceId] = {
      current: String(quantity),
      maximum: String(Math.max(
        quantity,
        Number.isSafeInteger(previousMaximum) ? previousMaximum : 0,
      )),
    };
  }
  entity.resources = resources;
}

export function changeNpcMechanicalGear(
  character: CharacterRecord,
  definition: JsonRecord,
  catalog: Record<string, JsonRecord>,
  action: { action: "wear"; slot: GearSlot; itemId: string }
    | { action: "stow"; slot: GearSlot },
): {
  loadout: CharacterLoadoutRecord;
  movedItemId: string;
  equipmentDefinitions: JsonRecord[];
  equipmentAbilityRefs: string[];
}
  | { error: string } {
  const current = character.loadout;
  if (current === undefined) return { error: "characterLoadoutUnavailable" };
  const equipped = { ...current.equipped };
  const backpack = current.backpack.map(({ itemId, quantity }) => ({ itemId, qty: quantity }));
  let movedItemId: string | undefined;
  let next: { equipped: Record<string, string | undefined>; backpack: Array<{ itemId: string; qty: number }>; error?: string };
  if (action.action === "stow") {
    movedItemId = equipped[action.slot];
    if (movedItemId === undefined) return { error: "unchangedGear" };
    next = action.slot === "ammo"
      ? {
          equipped: Object.fromEntries(Object.entries(equipped)
            .filter(([slot]) => slot !== "ammo")),
          backpack,
        }
      : stowSlot(equipped, backpack, action.slot);
  } else {
    movedItemId = action.itemId;
    if (equipped[action.slot] === action.itemId) return { error: "unchangedGear" };
    next = wearItem(
      equipped,
      backpack,
      action.itemId,
      action.slot,
      npcMechanicalItemResolver(current, catalog),
    );
    if (next.error !== undefined) return { error: next.error };
  }
  const canonicalEquipped = Object.fromEntries(
    Object.entries(next.equipped)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const provisional: CharacterLoadoutRecord = {
    armorClass: current.armorClass,
    speedFeet: current.speedFeet,
    equipped: canonicalEquipped,
    backpack: next.backpack
      .filter(({ qty }) => qty > 0)
      .sort((left, right) => left.itemId.localeCompare(right.itemId))
      .map(({ itemId, qty }) => ({ itemId, quantity: qty })),
    ...(current.mechanicalItems === undefined
      ? {}
      : { mechanicalItems: structuredClone(current.mechanicalItems) }),
  };
  const loadout = {
    ...provisional,
    armorClass: npcArmorClassForLoadout(definition, provisional, catalog),
  };
  const equipment = npcEquipmentMechanics({
    ...structuredClone(character),
    loadout,
  }, catalog);
  return {
    loadout,
    movedItemId,
    equipmentDefinitions: equipment.definitions,
    equipmentAbilityRefs: equipment.refs,
  };
}

export function changeNpcMechanicalItemState(
  character: CharacterRecord,
  definition: JsonRecord,
  catalog: Record<string, JsonRecord>,
  itemId: string,
  action: "break" | "repair" | "destroy" | "lose",
): {
  loadout: CharacterLoadoutRecord;
  equipmentDefinitions: JsonRecord[];
  equipmentAbilityRefs: string[];
} | { error: string } {
  const current = character.loadout;
  const currentItem = current?.mechanicalItems?.[itemId];
  if (current === undefined || currentItem === undefined) return { error: "mechanicalItemUnavailable" };
  if ((action === "break" && currentItem.status !== "usable")
    || (action === "repair" && currentItem.status !== "broken")) {
    return { error: "unchangedItemState" };
  }
  const equipped = { ...current.equipped };
  const backpack = current.backpack.map((entry) => ({ ...entry }));
  const mechanicalItems = structuredClone(current.mechanicalItems!);
  const equippedSlot = Object.entries(equipped).find(([, equippedId]) => equippedId === itemId)?.[0];
  if (equippedSlot !== undefined) {
    delete equipped[equippedSlot];
    if (!backpack.some((entry) => entry.itemId === itemId)) {
      backpack.push({ itemId, quantity: 1 });
    }
  }
  if (action === "destroy" || action === "lose") {
    delete mechanicalItems[itemId];
    const backpackIndex = backpack.findIndex((entry) => entry.itemId === itemId);
    if (backpackIndex >= 0) backpack.splice(backpackIndex, 1);
  } else {
    mechanicalItems[itemId].status = action === "break" ? "broken" : "usable";
  }
  backpack.sort((left, right) => left.itemId.localeCompare(right.itemId));
  const provisional: CharacterLoadoutRecord = {
    armorClass: current.armorClass,
    speedFeet: current.speedFeet,
    equipped: Object.fromEntries(Object.entries(equipped).sort(([left], [right]) => left.localeCompare(right))),
    backpack,
    ...(Object.keys(mechanicalItems).length === 0 ? {} : { mechanicalItems }),
  };
  const loadout = {
    ...provisional,
    armorClass: npcArmorClassForLoadout(definition, provisional, catalog),
  };
  const equipment = npcEquipmentMechanics({ ...structuredClone(character), loadout }, catalog);
  return {
    loadout,
    equipmentDefinitions: equipment.definitions,
    equipmentAbilityRefs: equipment.refs,
  };
}

export function synchronizeCoreNpcCombatState(
  state: AuthoritativeWorldState,
  entity: JsonRecord,
): void {
  if (!isNonEmptyString(entity.mechanicalDefinitionRef)
    || !isNonEmptyString(entity.entityId)) return;
  const character = state.entities[entity.entityId];
  if (character?.kind !== "npc" || !npcCoreMechanicsCompatible(character, entity)) {
    throw new TypeError("combat NPC mechanics conflict with its established world identity");
  }
  const scores = numericAbilityScores(entity.stats)!;
  character.abilityScores = scores;
  character.proficiencyBonus = Number(entity.proficiencyBonus);
  if (isRecord(entity.hitPoints)
    && canonicalIntegerString(entity.hitPoints.current, 0, 1_000_000)
    && canonicalIntegerString(entity.hitPoints.maximum, 1, 1_000_000)) {
    character.hitPoints = {
      current: Number(entity.hitPoints.current),
      maximum: Number(entity.hitPoints.maximum),
    };
  }
  if (isRecord(entity.resources)) {
    const resources: Record<string, number> = { ...(character.resources ?? {}) };
    const resourceMaximums: Record<string, number> = { ...(character.resourceMaximums ?? {}) };
    for (const [resourceId, pool] of Object.entries(entity.resources)) {
      if (resourceId.startsWith("item:")) continue;
      if (!isRecord(pool)
        || !canonicalIntegerString(pool.current, 0, 1_000_000)
        || !canonicalIntegerString(pool.maximum, 0, 1_000_000)) continue;
      resources[resourceId] = Number(pool.current);
      resourceMaximums[resourceId] = Number(pool.maximum);
    }
    character.resources = resources;
    character.resourceMaximums = resourceMaximums;
  }
}

export function npcMechanicalTemplateContent(value: unknown): JsonRecord | undefined {
  return isNpcMechanicalTemplateDefinition(value) ? value.content as JsonRecord : undefined;
}

export function canonicalNpcMechanicalPoint(value: unknown): value is JsonRecord {
  return canonicalPoint(value);
}

export function canonicalNpcMechanicalInitialState(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)
    || !hasOnlyKeys(value, [], ["hitPointsCurrent", "resourcesCurrent", "temporaryHitPoints"])
    || !(value.hitPointsCurrent === undefined
      || canonicalIntegerString(value.hitPointsCurrent, 0, 1_000_000))
    || !(value.temporaryHitPoints === undefined
      || canonicalIntegerString(value.temporaryHitPoints, 0, 1_000_000))) return false;
  return value.resourcesCurrent === undefined || (isRecord(value.resourcesCurrent)
    && Object.entries(value.resourcesCurrent).every(([resourceId, current]) =>
      isNonEmptyString(resourceId) && canonicalIntegerString(current, 0, 1_000_000)));
}

export function instantiateNpcMechanicalEntity(input: {
  definition: JsonRecord;
  catalog: Record<string, JsonRecord>;
  entityId: string;
  name: string;
  sceneId: string;
  position: JsonRecord;
  initialState?: JsonRecord;
  loadout?: CharacterLoadoutRecord;
  shell?: JsonRecord;
}): JsonRecord | undefined {
  const content = npcMechanicalTemplateContent(input.definition);
  if (content === undefined
    || !isNonEmptyString(input.entityId)
    || !isNonEmptyString(input.name)
    || !isNonEmptyString(input.sceneId)
    || !canonicalPoint(input.position)
    || !canonicalNpcMechanicalInitialState(input.initialState)) return undefined;
  const initialState = input.initialState ?? {};
  const maximumHitPoints = Number(content.hitPointsMaximum);
  const currentHitPoints = Number(initialState.hitPointsCurrent ?? content.hitPointsMaximum);
  const temporaryHitPoints = Number(initialState.temporaryHitPoints ?? "0");
  if (currentHitPoints > maximumHitPoints) return undefined;
  const currentResources = isRecord(initialState.resourcesCurrent)
    ? initialState.resourcesCurrent
    : {};
  const resourceMaximums = content.resourceMaximums as JsonRecord;
  if (Object.keys(currentResources).some((resourceId) => !(resourceId in resourceMaximums)
    || Number(currentResources[resourceId]) > Number(resourceMaximums[resourceId]))) return undefined;
  const resources = Object.fromEntries(Object.entries(resourceMaximums).map(([resourceId, maximum]) => [
    resourceId,
    {
      current: String(currentResources[resourceId] ?? maximum),
      maximum: String(maximum),
    },
  ]));
  const shell = input.shell;
  const loadout = input.loadout ?? initialNpcMechanicalLoadout(input.definition, {
    entityId: input.entityId,
    speedInches: content.speedInches,
  }, input.catalog);
  const character = {
    id: input.entityId,
    kind: "npc",
    name: input.name,
    sceneId: input.sceneId,
    tenureStatus: "active",
    entityOrdinal: "1",
    abilityScores: numericAbilityScores(content.stats),
    proficiencyBonus: Number(content.proficiencyBonus),
    loadout,
  } satisfies CharacterRecord;
  const equipment = npcEquipmentMechanics(character, input.catalog);
  const entity: JsonRecord = {
    id: input.entityId,
    entityId: input.entityId,
    kind: "npc",
    name: input.name,
    sceneId: input.sceneId,
    ...(isRecord(shell) && isNonEmptyString(shell.entityOrdinal)
      ? { entityOrdinal: shell.entityOrdinal }
      : {}),
    position: structuredClone(input.position),
    footprint: structuredClone(content.footprint),
    mechanicalDefinitionRef: input.definition.definitionId,
    stats: structuredClone(content.stats),
    proficiencyBonus: content.proficiencyBonus,
    armorClass: String(npcArmorClassForLoadout(input.definition, loadout, input.catalog)),
    hitPoints: {
      current: String(currentHitPoints),
      maximum: String(maximumHitPoints),
      temporary: String(temporaryHitPoints),
    },
    speedInches: structuredClone(content.speedInches),
    resources,
    deathPolicy: content.deathPolicy,
    abilityRefs: [...new Set([
      ...(content.intrinsicAbilityRefs as string[]),
      ...equipment.refs,
    ])].sort(),
    equipmentAbilityRefs: equipment.refs,
    ...(content.attacksPerAttackAction === undefined
      ? {}
      : { attacksPerAttackAction: content.attacksPerAttackAction }),
    ...(content.damageDefenses === undefined
      ? {}
      : { damageDefenses: structuredClone(content.damageDefenses) }),
    ...(content.sizeCategory === undefined ? {} : { sizeCategory: content.sizeCategory }),
    ...(content.spellcasting === undefined
      ? {}
      : { spellcasting: structuredClone(content.spellcasting) }),
    conditions: isRecord(shell?.conditions) ? structuredClone(shell.conditions) : {},
    concentration: shell?.concentration ?? null,
    lifeState: currentHitPoints === 0 ? "unconscious" : "alive",
    deathSaves: { successes: 0, failures: 0 },
    movement: { spentMilliInches: "0" },
    ...(isNonEmptyString(shell?.visibilityPolicyId)
      ? { visibilityPolicyId: shell.visibilityPolicyId }
      : {}),
    ...(isNonEmptyString(shell?.visibilityFactId)
      ? { visibilityFactId: shell.visibilityFactId }
      : {}),
  };
  return entity;
}
