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
  ITEMS,
  type GearSlot,
} from "../../dnd/gear";
import {
  isItemDefinitionV1,
  isItemSystemStateV1,
  itemDefinitionFromStandardGear,
  itemEntryResourceId,
  type ItemDefinitionV1,
  type ItemSystemStateV1,
} from "./items";
import { itemEntryGearResolver } from "./item-transitions";
import {
  deriveNpcItemSystemLoadout,
  npcItemSystemEquipmentMechanics,
} from "./npc-item-system";
import {
  hasExactKeys,
  hasOnlyKeys,
  isNonEmptyString,
  isRecord,
} from "./validation";

export const NPC_MECHANICAL_TEMPLATE_KIND = "npcMechanicalTemplate" as const;
export const NPC_MECHANICAL_TEMPLATE_SCHEMA = "zhuwei.npc-mechanical-template/v1" as const;

const GEAR_SLOTS = [
  "head", "neck", "cloak", "armor", "hands", "belt", "boots",
  "ring1", "ring2", "main", "off", "ammo",
] as const satisfies readonly GearSlot[];
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
      || !["standardGear", "itemDefinition"].includes(String(entry.source.kind))
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
      if (resourceId.startsWith("item:")) return false;
      if (resourceId.startsWith("item-entry:")) continue;
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
    !resourceId.startsWith("item:")
      && (resourceId.startsWith("item-entry:") || (isRecord(pool)
        && coreResources[resourceId] === Number(pool.current)
        && coreMaximums[resourceId] === Number(pool.maximum))));
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
      if (!isItemDefinitionV1(item) || item.definitionId !== definitionRef) return false;
      const abilityRefs = [
        ...item.content.equippedAbilityRefs,
        ...(item.content.use === null ? [] : [item.content.use.abilityRef]),
      ];
      const ammunitionDefinitionRef = item.content.equipment?.weapon?.ammunitionDefinitionRef;
      const ammunitionDefinition = ammunitionDefinitionRef === null
        || ammunitionDefinitionRef === undefined
        ? undefined
        : itemDefinitionByRef(ammunitionDefinitionRef, catalog);
      return abilityRefs.every(abilityValid)
        && (ammunitionDefinitionRef === null
          || ammunitionDefinitionRef === undefined
          || ammunitionDefinition?.content.category === "ammunition");
    })) return false;
  const initialLoadout = content.initialLoadout as JsonRecord;
  const equipped = new Map<GearSlot, ItemDefinitionV1>();
  const entriesValid = (initialLoadout.entries as JsonRecord[]).every((entry) => {
    const source = entry.source as JsonRecord;
    const item = source.kind === "standardGear"
      ? standardItemDefinition(String(source.ref))
      : itemDefinitionRefs.includes(String(source.ref))
        ? catalog[String(source.ref)]
        : undefined;
    if (!isItemDefinitionV1(item)
      || (!item.content.stackable && entry.quantity !== 1)) return false;
    if (entry.equippedSlot === null) return true;
    const slot = String(entry.equippedSlot) as GearSlot;
    if (item.content.equipment === null
      || !item.content.equipment.allowedSlots.includes(slot)
      || equipped.has(slot)) return false;
    equipped.set(slot, item);
    return true;
  });
  return entriesValid
    && !(equipped.get("main")?.content.equipment?.twoHanded === true
      && equipped.has("off"));
}

function standardItemDefinition(definitionRef: string): ItemDefinitionV1 | undefined {
  for (const item of ITEMS) {
    const definition = itemDefinitionFromStandardGear(item);
    if (definition.definitionId === definitionRef || item.id === definitionRef) return definition;
  }
  return undefined;
}

function itemDefinitionByRef(
  definitionRef: string,
  catalog: Record<string, JsonRecord>,
): ItemDefinitionV1 | undefined {
  const definition = catalog[definitionRef];
  return isItemDefinitionV1(definition) && definition.definitionId === definitionRef
    ? definition
    : standardItemDefinition(definitionRef);
}

export function itemDefinitionMechanicsClosureValid(
  definition: unknown,
  catalog: Record<string, JsonRecord>,
): boolean {
  if (!isItemDefinitionV1(definition)) return false;
  const abilityRefs = [
    ...definition.content.equippedAbilityRefs,
    ...(definition.content.use === null ? [] : [definition.content.use.abilityRef]),
  ];
  const ammunitionDefinitionRef = definition.content.equipment?.weapon?.ammunitionDefinitionRef;
  const ammunitionDefinition = ammunitionDefinitionRef === null
    || ammunitionDefinitionRef === undefined
    ? undefined
    : itemDefinitionByRef(ammunitionDefinitionRef, catalog);
  return abilityRefs.every((abilityRef) => isRegisteredAbilityRecord(catalog[abilityRef]))
    && (ammunitionDefinitionRef === null
      || ammunitionDefinitionRef === undefined
      || ammunitionDefinition?.content.category === "ammunition");
}

function npcMechanicalLoadoutEquipmentValid(
  loadout: CharacterLoadoutRecord,
  itemSystem: ItemSystemStateV1,
): boolean {
  const resolveItem = itemEntryGearResolver(itemSystem);
  for (const [slotValue, itemId] of Object.entries(loadout.equipped)) {
    if (!(GEAR_SLOTS as readonly string[]).includes(slotValue)) return false;
    if (slotValue === "ammo") {
      if (resolveItem(itemId)?.wear !== "ammo"
        || !loadout.backpack.some((entry) => entry.itemId === itemId)) return false;
      continue;
    }
    const item = resolveItem(itemId);
    if (item === undefined || !allowedSlots(item).includes(slotValue as GearSlot)) return false;
  }
  return !(resolveItem(loadout.equipped.main)?.twoHanded === true
    && loadout.equipped.off !== undefined);
}

export function npcMechanicalEntityMatchesTemplate(
  entity: unknown,
  definition: unknown,
  catalog: Record<string, JsonRecord>,
  character: CharacterRecord,
  itemSystem: ItemSystemStateV1,
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
  const derived = deriveNpcItemSystemLoadout(itemSystem, character, definition);
  if ("error" in derived) return false;
  if (character.loadout !== undefined && !sameJson(character.loadout, derived.loadout)) {
    return false;
  }
  const effectiveCharacter = { ...character, loadout: derived.loadout };
  const equipment = npcItemSystemEquipmentMechanics(effectiveCharacter, itemSystem);
  const expectedEquipmentAbilityRefs = equipment.refs;
  const expectedAbilityRefs = [
    ...(content.intrinsicAbilityRefs as string[]),
    ...expectedEquipmentAbilityRefs,
  ].filter((ref, index, all) => all.indexOf(ref) === index).sort();
  const derivedArmorClass = npcArmorClassForLoadout(
    definition,
    effectiveCharacter.loadout,
    itemSystem,
  );
  const expectedSpeedFeet = Math.max(1, Math.floor(Number(
    (content.speedInches as JsonRecord).walk ?? 360,
  ) / 12));
  if (effectiveCharacter.loadout === undefined
    || !npcMechanicalLoadoutEquipmentValid(effectiveCharacter.loadout, itemSystem)
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
  if (Object.keys(entityResources).some((resourceId) => resourceId.startsWith("item:"))) {
    return false;
  }
  const mechanicalResources = Object.fromEntries(
    Object.entries(entityResources).filter(([resourceId]) =>
      !resourceId.startsWith("item-entry:")),
  );
  const itemResources = Object.fromEntries(
    Object.entries(entityResources).filter(([resourceId]) =>
      resourceId.startsWith("item-entry:")),
  );
  const expectedItems = Object.values(itemSystem.entries)
      .filter((entry) => entry.disposition === "held"
        && entry.holderRef === effectiveCharacter.id
        && entry.condition === "usable")
      .map((entry) => ({
        resourceId: itemEntryResourceId(entry.entryId),
        quantity: entry.quantity,
      }));
  const itemResourcesMatch = Object.keys(itemResources).length === expectedItems.length
    && expectedItems.every(({ resourceId, quantity }) => {
      const pool = itemResources[resourceId];
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

function npcArmorClassForLoadout(
  definition: JsonRecord,
  loadout: CharacterLoadoutRecord,
  itemSystem: ItemSystemStateV1,
): number {
  const content = npcMechanicalTemplateContent(definition);
  if (content === undefined || !canonicalArmorClassModel(content.armorClassModel)) {
    throw new TypeError("NPC armor class model is unavailable");
  }
  const model = content.armorClassModel;
  const base = Number(model.baseArmorClass);
  const resolveItem = itemEntryGearResolver(itemSystem);
  const armor = resolveItem(loadout.equipped.armor);
  const dexterity = Math.floor((Number((content.stats as JsonRecord).dex) - 10) / 2);
  const wornArmor = armor?.armor !== undefined
    && armor.armor !== "shield"
    && armor.acBase !== undefined
    ? armor.acBase + (armor.acDexCap === 0
      ? 0
      : Math.min(dexterity, armor.acDexCap ?? 0))
    : base;
  const shield = resolveItem(loadout.equipped.off)?.armor === "shield" ? 2 : 0;
  return Math.max(base, wornArmor) + shield;
}

export function synchronizeCombatItemResources(
  entity: JsonRecord | undefined,
  itemSystem: ItemSystemStateV1,
): void {
  if (entity === undefined) return;
  if (!isItemSystemStateV1(itemSystem)) {
    throw new TypeError("combat item resources require the unified item system");
  }
  const prior = isRecord(entity.resources) ? entity.resources : {};
  if (Object.keys(prior).some((resourceId) => resourceId.startsWith("item:"))) {
    throw new TypeError("non-entry item resource identities are unavailable");
  }
  const resources: JsonRecord = Object.fromEntries(
    Object.entries(prior).filter(([resourceId]) =>
      !resourceId.startsWith("item-entry:")),
  );
  const itemEntries = Object.values(itemSystem.entries)
      .filter((entry) => entry.disposition === "held"
        && entry.holderRef === entity.entityId
        && entry.condition === "usable")
      .map((entry) => ({ entryId: entry.entryId, quantity: entry.quantity }));
  for (const { entryId, quantity } of itemEntries) {
    const resourceId = itemEntryResourceId(entryId);
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

export function synchronizeCoreNpcCombatState(
  state: AuthoritativeWorldState,
  entity: JsonRecord,
): void {
  if (!isNonEmptyString(entity.mechanicalDefinitionRef)
    || !isNonEmptyString(entity.entityId)) return;
  const character = state.entities[entity.entityId];
  if (character?.kind !== "npc") {
    throw new TypeError("combat NPC mechanics conflict with its established world identity");
  }
  const synchronized = structuredClone(character);
  if (isRecord(entity.hitPoints)
    && canonicalIntegerString(entity.hitPoints.current, 0, 1_000_000)
    && canonicalIntegerString(entity.hitPoints.maximum, 1, 1_000_000)) {
    const maximum = Number(entity.hitPoints.maximum);
    if (synchronized.hitPoints !== undefined
      && synchronized.hitPoints.maximum !== maximum) {
      throw new TypeError("combat NPC hit-point maximum conflicts with its established mechanics");
    }
    synchronized.hitPoints = {
      current: Number(entity.hitPoints.current),
      maximum,
    };
  }
  if (isRecord(entity.resources)) {
    const resources: Record<string, number> = { ...(synchronized.resources ?? {}) };
    const resourceMaximums: Record<string, number> = {
      ...(synchronized.resourceMaximums ?? {}),
    };
    for (const [resourceId, pool] of Object.entries(entity.resources)) {
      if (resourceId.startsWith("item:")) {
        throw new TypeError("non-entry item resource identities are unavailable");
      }
      if (resourceId.startsWith("item-entry:")) continue;
      if (!isRecord(pool)
        || !canonicalIntegerString(pool.current, 0, 1_000_000)
        || !canonicalIntegerString(pool.maximum, 0, 1_000_000)) {
        throw new TypeError("combat NPC resource pool is not canonical");
      }
      const maximum = Number(pool.maximum);
      if (resourceMaximums[resourceId] !== undefined
        && resourceMaximums[resourceId] !== maximum) {
        throw new TypeError("combat NPC resource maximum conflicts with its established mechanics");
      }
      resources[resourceId] = Number(pool.current);
      resourceMaximums[resourceId] = maximum;
    }
    synchronized.resources = resources;
    synchronized.resourceMaximums = resourceMaximums;
  }
  if (!npcCoreMechanicsCompatible(synchronized, entity)) {
    throw new TypeError("combat NPC mechanics conflict with its established world identity");
  }
  const scores = numericAbilityScores(entity.stats)!;
  character.abilityScores = scores;
  character.proficiencyBonus = Number(entity.proficiencyBonus);
  character.hitPoints = synchronized.hitPoints;
  character.resources = synchronized.resources;
  character.resourceMaximums = synchronized.resourceMaximums;
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
  itemSystem: ItemSystemStateV1;
  entityId: string;
  name: string;
  sceneId: string;
  position: JsonRecord;
  initialState?: JsonRecord;
  loadout: CharacterLoadoutRecord;
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
  const loadout = input.loadout;
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
  const equipment = npcItemSystemEquipmentMechanics(character, input.itemSystem);
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
    armorClass: String(npcArmorClassForLoadout(
      input.definition,
      loadout,
      input.itemSystem,
    )),
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
