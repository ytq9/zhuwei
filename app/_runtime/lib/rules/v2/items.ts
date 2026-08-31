import {
  GEAR_SLOTS,
  allowedSlots,
  type GearItem,
  type GearSlot,
} from "../../dnd/gear";
import {
  compileAbilityDefinition,
  isRegisteredAbilityRecord,
  type CompiledAbilityArtifact,
} from "../profiles/ability-compiler";
import {
  HEALING_POTION_ITEM_DEFINITION_ID,
  HEALING_POTION_USE_ABILITY_REF,
} from "../profiles/item-system";
import type { ProfileRef } from "../profiles/types";
import type { JsonRecord } from "./model";

export {
  HEALING_POTION_ITEM_DEFINITION_ID,
  HEALING_POTION_USE_ABILITY_REF,
} from "../profiles/item-system";

export const ITEM_DEFINITION_SCHEMA = "zhuwei.item-definition/v1" as const;
export const ITEM_DEFINITION_CONTENT_SCHEMA = "zhuwei.item-definition-content/v1" as const;
export const ITEM_ENTRY_SCHEMA = "zhuwei.item-entry/v1" as const;
export const ITEM_SYSTEM_STATE_SCHEMA = "zhuwei.item-system-state/v1" as const;

const MAX_IDENTIFIER_LENGTH = 300;
const MAX_TEXT_LENGTH = 4_000;
const MAX_SET_SIZE = 64;
const MAX_QUANTITY = 1_000_000;
const POSITIVE_REVISION = /^(?:[1-9][0-9]*)$/u;
const SHA256_REF = /^sha256:[0-9a-f]{64}$/u;
const GEAR_SLOT_IDS = GEAR_SLOTS.map(({ id }) => id);

export type ItemCategory =
  | "weapon"
  | "armor"
  | "shield"
  | "ammunition"
  | "consumable"
  | "tool"
  | "currency"
  | "equipment"
  | "object";

export type ItemRulesBasis =
  | "srd5.1-2014"
  | {
      kind: "zhuwei-product-ruling";
      profileRef: ProfileRef;
    };

export type ItemArmorModel = {
  kind: "light" | "medium" | "heavy" | "shield";
  acBase: number | null;
  acDexCap: number | null;
};

export type ItemDamageType =
  | "acid"
  | "bludgeoning"
  | "cold"
  | "fire"
  | "force"
  | "lightning"
  | "necrotic"
  | "piercing"
  | "poison"
  | "psychic"
  | "radiant"
  | "slashing"
  | "thunder";

export type ItemWeaponModel = {
  attackAbility: "str" | "dex" | "finesse";
  ammunitionDefinitionRef: string | null;
  damageDice: string;
  damageType: ItemDamageType;
  reachInches: string | null;
  rangeNormalInches: string | null;
  rangeLongInches: string | null;
  requiresSight: boolean;
};

export type ItemEquipmentModel = {
  allowedSlots: GearSlot[];
  twoHanded: boolean;
  armor: ItemArmorModel | null;
  weapon: ItemWeaponModel | null;
};

/** The item system pays these costs before invoking the frozen ability. */
export type ItemUseActivity = {
  kind: "useObject";
  abilityRef: string;
  quantityCost: number;
  chargeCost: number;
  durabilityCost: number;
};

export type ItemDefinitionContentV1 = {
  schema: typeof ITEM_DEFINITION_CONTENT_SCHEMA;
  label: string;
  description: string;
  category: ItemCategory;
  aliases: string[];
  tags: string[];
  stackable: boolean;
  equipment: ItemEquipmentModel | null;
  equippedAbilityRefs: string[];
  use: ItemUseActivity | null;
  chargesMaximum: number | null;
  durabilityMaximum: number | null;
};

export type ItemDefinitionV1 = {
  schema: typeof ITEM_DEFINITION_SCHEMA;
  definitionKind: "item";
  definitionId: string;
  revision: string;
  rulesBasis: ItemRulesBasis;
  causalBasisRefs: string[];
  visibilityPolicyRef: string;
  content: ItemDefinitionContentV1;
};

export type ItemDisposition = "held" | "scene" | "consumed" | "destroyed";
export type ItemCondition = "usable" | "broken";

export type ItemOwnership =
  | { kind: "unowned"; ownerRef: null }
  | { kind: "character" | "party" | "faction"; ownerRef: string };

export type ItemOwnershipDisposition = "preserve" | "transferToRecipient";

export type ItemCounter = {
  current: number;
  maximum: number;
};

/**
 * One globally identified possession/location record. Equipment is a held
 * entry with an equipped slot; it is never copied into a character sidecar.
 */
export type ItemEntryV1 = {
  schema: typeof ITEM_ENTRY_SCHEMA;
  entryId: string;
  definitionRef: string;
  definitionRevision: string;
  disposition: ItemDisposition;
  holderRef: string | null;
  sceneRef: string | null;
  equippedSlot: GearSlot | null;
  quantity: number;
  condition: ItemCondition;
  charges: ItemCounter | null;
  durability: ItemCounter | null;
  visibilityPolicyRef: string;
  ownership: ItemOwnership;
};

export type ItemSystemStateV1 = {
  schema: typeof ITEM_SYSTEM_STATE_SCHEMA;
  definitions: Record<string, ItemDefinitionV1>;
  entries: Record<string, ItemEntryV1>;
};

export type InitialItemPlacement =
  | { kind: "held"; holderRef: string; equippedSlot: GearSlot | null }
  | { kind: "scene"; sceneRef: string };

export type InitialItemEntryInput = {
  entryId: string;
  quantity: number;
  placement: InitialItemPlacement;
  ownership: ItemOwnership;
  visibilityPolicyRef?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isCanonicalString(value: unknown, maximum = MAX_IDENTIFIER_LENGTH): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && value.normalize("NFC") === value;
}

function isBoundedInteger(value: unknown, minimum: number, maximum = MAX_QUANTITY): value is number {
  return Number.isSafeInteger(value)
    && Number(value) >= minimum
    && Number(value) <= maximum;
}

function isCanonicalPositiveIntegerString(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && /^(?:[1-9][0-9]*)$/u.test(value)
    && Number.isSafeInteger(Number(value))
    && Number(value) <= maximum;
}

function isCanonicalStringSet(value: unknown, maximumSize = MAX_SET_SIZE): value is string[] {
  return Array.isArray(value)
    && value.length <= maximumSize
    && value.every((entry) => isCanonicalString(entry))
    && value.every((entry, index) => index === 0 || value[index - 1] < entry);
}

function isProfileRef(value: unknown): value is ProfileRef {
  return isRecord(value)
    && hasExactKeys(value, ["profileHash", "profileId"])
    && isCanonicalString(value.profileId)
    && typeof value.profileHash === "string"
    && SHA256_REF.test(value.profileHash);
}

function isRulesBasis(value: unknown): value is ItemRulesBasis {
  return value === "srd5.1-2014"
    || (isRecord(value)
      && hasExactKeys(value, ["kind", "profileRef"])
      && value.kind === "zhuwei-product-ruling"
      && isProfileRef(value.profileRef));
}

function isGearSlot(value: unknown): value is GearSlot {
  return typeof value === "string" && (GEAR_SLOT_IDS as readonly string[]).includes(value);
}

function gearSlotIndex(slot: GearSlot): number {
  return GEAR_SLOT_IDS.indexOf(slot);
}

function isCanonicalGearSlots(value: unknown): value is GearSlot[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every(isGearSlot)
    && value.every((slot, index) => index === 0
      || gearSlotIndex(value[index - 1]) < gearSlotIndex(slot));
}

function isArmorModel(value: unknown): value is ItemArmorModel {
  if (!isRecord(value)
    || !hasExactKeys(value, ["acBase", "acDexCap", "kind"])
    || !["light", "medium", "heavy", "shield"].includes(String(value.kind))) return false;
  if (value.kind === "shield") return value.acBase === null && value.acDexCap === null;
  return isBoundedInteger(value.acBase, 1, 99)
    && isBoundedInteger(value.acDexCap, 0, 99);
}

const ITEM_DAMAGE_TYPES: readonly ItemDamageType[] = [
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
];

function isWeaponModel(value: unknown): value is ItemWeaponModel {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "ammunitionDefinitionRef",
      "attackAbility",
      "damageDice",
      "damageType",
      "rangeLongInches",
      "rangeNormalInches",
      "reachInches",
      "requiresSight",
    ])
    || !["str", "dex", "finesse"].includes(String(value.attackAbility))
    || !(value.ammunitionDefinitionRef === null
      || isCanonicalString(value.ammunitionDefinitionRef))
    || typeof value.damageDice !== "string"
    || !/^[1-9][0-9]{0,2}d(?:4|6|8|10|12|20)$/u.test(value.damageDice)
    || !(ITEM_DAMAGE_TYPES as readonly unknown[]).includes(value.damageType)
    || typeof value.requiresSight !== "boolean") return false;
  const melee = isCanonicalPositiveIntegerString(value.reachInches, 100_000)
    && value.rangeNormalInches === null
    && value.rangeLongInches === null;
  const ranged = value.reachInches === null
    && isCanonicalPositiveIntegerString(value.rangeNormalInches, 1_000_000)
    && isCanonicalPositiveIntegerString(value.rangeLongInches, 1_000_000)
    && Number(value.rangeLongInches) >= Number(value.rangeNormalInches);
  return (melee && value.ammunitionDefinitionRef === null) || ranged;
}

function isEquipmentModel(value: unknown): value is ItemEquipmentModel {
  return isRecord(value)
    && hasExactKeys(value, ["allowedSlots", "armor", "twoHanded", "weapon"])
    && isCanonicalGearSlots(value.allowedSlots)
    && typeof value.twoHanded === "boolean"
    && (value.armor === null || isArmorModel(value.armor))
    && (value.weapon === null || isWeaponModel(value.weapon));
}

function isUseActivity(value: unknown): value is ItemUseActivity {
  return isRecord(value)
    && hasExactKeys(value, [
      "abilityRef",
      "chargeCost",
      "durabilityCost",
      "kind",
      "quantityCost",
    ])
    && value.kind === "useObject"
    && isCanonicalString(value.abilityRef)
    && isBoundedInteger(value.quantityCost, 0)
    && isBoundedInteger(value.chargeCost, 0)
    && isBoundedInteger(value.durabilityCost, 0);
}

function contentSemanticsValid(content: ItemDefinitionContentV1): boolean {
  const equipment = content.equipment;
  if (content.stackable
    && (content.chargesMaximum !== null || content.durabilityMaximum !== null)) return false;
  if (content.stackable && equipment !== null && content.category !== "ammunition") return false;
  if (content.equippedAbilityRefs.length > 0 && equipment === null) return false;
  if (content.use !== null) {
    if (!content.stackable && content.use.quantityCost > 1) return false;
    if (content.use.chargeCost > 0
      && (content.chargesMaximum === null
        || content.use.chargeCost > content.chargesMaximum)) return false;
    if (content.use.durabilityCost > 0
      && (content.durabilityMaximum === null
        || content.use.durabilityCost > content.durabilityMaximum)) return false;
  }
  if (content.category === "consumable"
    && content.use !== null
    && content.use.quantityCost === 0
    && content.use.chargeCost === 0
    && content.use.durabilityCost === 0) return false;
  if (content.category === "weapon"
    && (equipment === null
      || (!equipment.allowedSlots.every((slot) => slot === "main" || slot === "off"))
      || equipment.weapon === null)) return false;
  if (content.category !== "weapon" && equipment !== null && equipment.weapon !== null) return false;
  if (content.category === "armor"
    && (equipment === null || equipment.armor === null || equipment.armor.kind === "shield")) return false;
  if (content.category === "shield" && equipment?.armor?.kind !== "shield") return false;
  if (content.category === "ammunition") {
    if (!content.stackable
      || equipment === null
      || equipment.allowedSlots.length !== 1
      || equipment.allowedSlots[0] !== "ammo") return false;
  }
  if (equipment?.twoHanded === true
    && (equipment.allowedSlots.length !== 1 || equipment.allowedSlots[0] !== "main")) return false;
  if (equipment?.armor !== null && equipment?.armor !== undefined) {
    const expectedSlot = equipment.armor.kind === "shield" ? "off" : "armor";
    if (equipment.allowedSlots.length !== 1 || equipment.allowedSlots[0] !== expectedSlot) return false;
  }
  return true;
}

export function isItemDefinitionV1(value: unknown): value is ItemDefinitionV1 {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "causalBasisRefs",
      "content",
      "definitionId",
      "definitionKind",
      "revision",
      "rulesBasis",
      "schema",
      "visibilityPolicyRef",
    ])
    || value.schema !== ITEM_DEFINITION_SCHEMA
    || value.definitionKind !== "item"
    || !isCanonicalString(value.definitionId)
    || typeof value.revision !== "string"
    || !POSITIVE_REVISION.test(value.revision)
    || !isRulesBasis(value.rulesBasis)
    || !isCanonicalStringSet(value.causalBasisRefs)
    || !isCanonicalString(value.visibilityPolicyRef)
    || !isRecord(value.content)) return false;

  const content = value.content;
  if (!hasExactKeys(content, [
    "aliases",
    "category",
    "chargesMaximum",
    "description",
    "durabilityMaximum",
    "equipment",
    "equippedAbilityRefs",
    "label",
    "schema",
    "stackable",
    "tags",
    "use",
  ])
    || content.schema !== ITEM_DEFINITION_CONTENT_SCHEMA
    || !isCanonicalString(content.label)
    || !isCanonicalString(content.description, MAX_TEXT_LENGTH)
    || ![
      "weapon", "armor", "shield", "ammunition", "consumable",
      "tool", "currency", "equipment", "object",
    ].includes(String(content.category))
    || !isCanonicalStringSet(content.aliases)
    || !isCanonicalStringSet(content.tags)
    || typeof content.stackable !== "boolean"
    || !(content.equipment === null || isEquipmentModel(content.equipment))
    || !isCanonicalStringSet(content.equippedAbilityRefs)
    || !(content.use === null || isUseActivity(content.use))
    || !(content.chargesMaximum === null
      || isBoundedInteger(content.chargesMaximum, 1))
    || !(content.durabilityMaximum === null
      || isBoundedInteger(content.durabilityMaximum, 1))) return false;

  return contentSemanticsValid(content as ItemDefinitionContentV1);
}

function isOwnership(value: unknown): value is ItemOwnership {
  if (!isRecord(value) || !hasExactKeys(value, ["kind", "ownerRef"])) return false;
  if (value.kind === "unowned") return value.ownerRef === null;
  return ["character", "party", "faction"].includes(String(value.kind))
    && isCanonicalString(value.ownerRef);
}

function isCounter(value: unknown): value is ItemCounter {
  return isRecord(value)
    && hasExactKeys(value, ["current", "maximum"])
    && isBoundedInteger(value.maximum, 1)
    && isBoundedInteger(value.current, 0, Number(value.maximum));
}

export function isItemEntryV1(value: unknown): value is ItemEntryV1 {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "charges",
      "condition",
      "definitionRef",
      "definitionRevision",
      "disposition",
      "durability",
      "entryId",
      "equippedSlot",
      "holderRef",
      "ownership",
      "quantity",
      "sceneRef",
      "schema",
      "visibilityPolicyRef",
    ])
    || value.schema !== ITEM_ENTRY_SCHEMA
    || !isCanonicalString(value.entryId)
    || !value.entryId.startsWith("item-entry:")
    || value.entryId.length === "item-entry:".length
    || !isCanonicalString(value.definitionRef)
    || typeof value.definitionRevision !== "string"
    || !POSITIVE_REVISION.test(value.definitionRevision)
    || !["held", "scene", "consumed", "destroyed"].includes(String(value.disposition))
    || !(value.holderRef === null || isCanonicalString(value.holderRef))
    || !(value.sceneRef === null || isCanonicalString(value.sceneRef))
    || !(value.equippedSlot === null || isGearSlot(value.equippedSlot))
    || !isBoundedInteger(value.quantity, 0)
    || !["usable", "broken"].includes(String(value.condition))
    || !(value.charges === null || isCounter(value.charges))
    || !(value.durability === null || isCounter(value.durability))
    || !isCanonicalString(value.visibilityPolicyRef)
    || !isOwnership(value.ownership)) return false;

  if (value.disposition === "held") {
    if (value.holderRef === null || value.sceneRef !== null || value.quantity < 1) return false;
  } else if (value.disposition === "scene") {
    if (value.holderRef !== null
      || value.sceneRef === null
      || value.equippedSlot !== null
      || value.quantity < 1) return false;
  } else if (value.holderRef !== null
    || value.sceneRef !== null
    || value.equippedSlot !== null
    || value.quantity !== 0) return false;

  if (value.equippedSlot !== null && value.condition !== "usable") return false;
  if (value.condition === "broken"
    && value.durability !== null
    && value.durability.current !== 0) return false;
  if (value.disposition === "destroyed"
    && value.durability !== null
    && value.durability.current !== 0) return false;
  return true;
}

export function itemEntryMatchesDefinition(
  entry: unknown,
  definition: unknown,
): entry is ItemEntryV1 {
  if (!isItemEntryV1(entry)
    || !isItemDefinitionV1(definition)
    || entry.definitionRef !== definition.definitionId
    || entry.definitionRevision !== definition.revision) return false;
  const content = definition.content;
  if (!content.stackable && entry.quantity > 1) return false;
  if (entry.charges === null) {
    if (content.chargesMaximum !== null) return false;
  } else if (content.chargesMaximum === null
    || entry.charges.maximum !== content.chargesMaximum) return false;
  if (entry.durability === null) {
    if (content.durabilityMaximum !== null) return false;
  } else if (content.durabilityMaximum === null
    || entry.durability.maximum !== content.durabilityMaximum) return false;
  if (entry.equippedSlot !== null) {
    if (content.equipment === null
      || !content.equipment.allowedSlots.includes(entry.equippedSlot)) return false;
  }
  if (["held", "scene"].includes(entry.disposition)
    && entry.condition === "usable"
    && entry.durability !== null
    && entry.durability.current === 0) return false;
  return true;
}

/** Complete immutable identity for deciding whether two active stacks may merge. */
export function itemStackIdentity(entry: ItemEntryV1): string {
  return JSON.stringify([
    entry.definitionRef,
    entry.definitionRevision,
    entry.disposition,
    entry.holderRef,
    entry.sceneRef,
    entry.equippedSlot,
    entry.condition,
    entry.charges === null ? null : [entry.charges.current, entry.charges.maximum],
    entry.durability === null ? null : [entry.durability.current, entry.durability.maximum],
    entry.visibilityPolicyRef,
    entry.ownership.kind,
    entry.ownership.ownerRef,
  ]);
}

export function isItemSystemStateV1(value: unknown): value is ItemSystemStateV1 {
  if (!isRecord(value)
    || !hasExactKeys(value, ["definitions", "entries", "schema"])
    || value.schema !== ITEM_SYSTEM_STATE_SCHEMA
    || !isRecord(value.definitions)
    || !isRecord(value.entries)) return false;
  const definitions = value.definitions;
  const entries = value.entries;
  if (!Object.entries(definitions).every(([definitionId, definition]) =>
    isItemDefinitionV1(definition) && definition.definitionId === definitionId)) return false;
  if (!Object.entries(entries).every(([entryId, entry]) => {
    if (!isItemEntryV1(entry) || entry.entryId !== entryId) return false;
    return itemEntryMatchesDefinition(entry, definitions[entry.definitionRef]);
  })) return false;

  const occupiedSlots = new Set<string>();
  const activeStacks = new Set<string>();
  for (const entry of Object.values(entries) as ItemEntryV1[]) {
    if (entry.disposition === "held" && entry.equippedSlot !== null) {
      const slotKey = `${entry.holderRef}:${entry.equippedSlot}`;
      if (occupiedSlots.has(slotKey)) return false;
      occupiedSlots.add(slotKey);
    }
    const definition = definitions[entry.definitionRef] as ItemDefinitionV1;
    if (!definition.content.stackable
      || (entry.disposition !== "held" && entry.disposition !== "scene")) continue;
    const stackKey = itemStackIdentity(entry);
    if (activeStacks.has(stackKey)) return false;
    activeStacks.add(stackKey);
  }
  return true;
}

export function emptyItemSystemState(): ItemSystemStateV1 {
  return { schema: ITEM_SYSTEM_STATE_SCHEMA, definitions: {}, entries: {} };
}

function sortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sortedGearSlots(values: readonly GearSlot[]): GearSlot[] {
  return [...new Set(values)].sort((left, right) => gearSlotIndex(left) - gearSlotIndex(right));
}

export function standardGearDefinitionId(itemId: string): string {
  if (!isCanonicalString(itemId)) throw new TypeError("standard gear id is not canonical");
  return `item-definition:standard-gear:${itemId}:1`;
}

/** Resource identity used to bind one frozen ability cost to one exact entry. */
export function itemEntryResourceId(entryId: string): string {
  if (!isCanonicalString(entryId)
    || !entryId.startsWith("item-entry:")
    || entryId.length === "item-entry:".length) {
    throw new TypeError("item entry id is not canonical");
  }
  return entryId;
}

/** Per-entry ability identity prevents one inventory instance spending another. */
export function itemEntryUseAbilityId(baseAbilityRef: string, entryId: string): string {
  if (!isCanonicalString(baseAbilityRef)) {
    throw new TypeError("item use ability binding is not canonical");
  }
  return `${baseAbilityRef}:entry:${itemEntryResourceId(entryId)}`;
}

/** Pure conversion from the pinned standard GearItem catalog. */
export function itemDefinitionFromStandardGear(item: GearItem): ItemDefinitionV1 {
  const category = item.category;
  const slots = sortedGearSlots(allowedSlots(item));
  const equipment: ItemEquipmentModel | null = slots.length === 0
    ? null
    : {
        allowedSlots: slots,
        twoHanded: item.twoHanded === true,
        armor: item.armor === undefined
          ? null
          : {
              kind: item.armor,
              acBase: item.armor === "shield" ? null : item.acBase ?? null,
              acDexCap: item.armor === "shield" ? null : item.acDexCap ?? null,
            },
        weapon: item.weapon === undefined
          ? null
          : {
              attackAbility: item.weapon.attackAbility,
              ammunitionDefinitionRef: item.weapon.ammunitionId === undefined
                ? null
                : standardGearDefinitionId(item.weapon.ammunitionId),
              damageDice: item.weapon.damageDice,
              damageType: item.weapon.damageType,
              reachInches: item.weapon.reachInches ?? null,
              rangeNormalInches: item.weapon.rangeNormalInches ?? null,
              rangeLongInches: item.weapon.rangeLongInches ?? null,
              requiresSight: item.weapon.requiresSight
                ?? item.weapon.rangeNormalInches !== undefined,
            },
      };
  const definition: ItemDefinitionV1 = {
    schema: ITEM_DEFINITION_SCHEMA,
    definitionKind: "item",
    definitionId: standardGearDefinitionId(item.id),
    revision: "1",
    rulesBasis: "srd5.1-2014",
    causalBasisRefs: [],
    visibilityPolicyRef: "visibility:public",
    content: {
      schema: ITEM_DEFINITION_CONTENT_SCHEMA,
      label: item.name,
      description: item.text,
      category,
      aliases: sortedStrings(item.aliases ?? []),
      tags: sortedStrings(["standard-gear", category]),
      stackable: item.stackable,
      equipment,
      equippedAbilityRefs: [],
      use: null,
      chargesMaximum: null,
      durabilityMaximum: null,
    },
  };
  if (!isItemDefinitionV1(definition)) {
    throw new TypeError(`standard gear cannot compile to ItemDefinition v1: ${item.id}`);
  }
  return definition;
}

const PUBLIC_DAMAGE_TYPE_LABELS: Readonly<Record<ItemDamageType, string>> = {
  acid: "强酸",
  bludgeoning: "钝击",
  cold: "寒冷",
  fire: "火焰",
  force: "力场",
  lightning: "闪电",
  necrotic: "黯蚀",
  piercing: "穿刺",
  poison: "毒素",
  psychic: "心灵",
  radiant: "光耀",
  slashing: "挥砍",
  thunder: "雷鸣",
};

export function itemWeaponPublicDamageText(weapon: ItemWeaponModel | null): string | null {
  return weapon === null
    ? null
    : `${weapon.damageDice} ${PUBLIC_DAMAGE_TYPE_LABELS[weapon.damageType]}`;
}

/** Pure constructor for a new active held or scene entry. */
export function createInitialItemEntry(
  definition: ItemDefinitionV1,
  input: InitialItemEntryInput,
): ItemEntryV1 {
  if (!isItemDefinitionV1(definition)) throw new TypeError("item definition is invalid");
  const entry: ItemEntryV1 = {
    schema: ITEM_ENTRY_SCHEMA,
    entryId: input.entryId,
    definitionRef: definition.definitionId,
    definitionRevision: definition.revision,
    disposition: input.placement.kind,
    holderRef: input.placement.kind === "held" ? input.placement.holderRef : null,
    sceneRef: input.placement.kind === "scene" ? input.placement.sceneRef : null,
    equippedSlot: input.placement.kind === "held" ? input.placement.equippedSlot : null,
    quantity: input.quantity,
    condition: "usable",
    charges: definition.content.chargesMaximum === null
      ? null
      : {
          current: definition.content.chargesMaximum,
          maximum: definition.content.chargesMaximum,
        },
    durability: definition.content.durabilityMaximum === null
      ? null
      : {
          current: definition.content.durabilityMaximum,
          maximum: definition.content.durabilityMaximum,
        },
    visibilityPolicyRef: input.visibilityPolicyRef ?? definition.visibilityPolicyRef,
    ownership: structuredClone(input.ownership),
  };
  if (!itemEntryMatchesDefinition(entry, definition)) {
    throw new TypeError("initial item entry does not match its definition");
  }
  return entry;
}

/** Pure convenience conversion for one standard catalog entry and placement. */
export function initialItemEntryFromStandardGear(
  item: GearItem,
  input: InitialItemEntryInput,
): ItemEntryV1 {
  return createInitialItemEntry(itemDefinitionFromStandardGear(item), input);
}

export function healingPotionItemDefinition(): ItemDefinitionV1 {
  const definition: ItemDefinitionV1 = {
    schema: ITEM_DEFINITION_SCHEMA,
    definitionKind: "item",
    definitionId: HEALING_POTION_ITEM_DEFINITION_ID,
    revision: "1",
    rulesBasis: "srd5.1-2014",
    causalBasisRefs: [],
    visibilityPolicyRef: "visibility:public",
    content: {
      schema: ITEM_DEFINITION_CONTENT_SCHEMA,
      label: "治疗药水",
      description: "饮用后恢复 2d4+2 点生命值。",
      category: "consumable",
      aliases: ["治疗药水"],
      tags: ["consumable", "healing", "potion"],
      stackable: true,
      equipment: null,
      equippedAbilityRefs: [],
      use: {
        kind: "useObject",
        abilityRef: HEALING_POTION_USE_ABILITY_REF,
        quantityCost: 1,
        chargeCost: 0,
        durabilityCost: 0,
      },
      chargesMaximum: null,
      durabilityMaximum: null,
    },
  };
  if (!isItemDefinitionV1(definition)) throw new TypeError("healing potion definition is invalid");
  return definition;
}

/** Built-in base mechanic. Item identity and costs are added by the generic wrapper. */
export function healingPotionUseAbilityDefinition(): JsonRecord {
  return {
    definitionId: HEALING_POTION_USE_ABILITY_REF,
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "useObject", actionGrant: "normalAction" },
    target: {
      kind: "creature",
      count: "1",
      rangeInches: "0",
      selfOnly: true,
    },
    healing: { formula: "2d4+2" },
  };
}

/** Resolves only definitions shipped by the pinned item catalog. */
export function builtinItemUseAbilityDefinition(abilityRef: string): JsonRecord | undefined {
  return abilityRef === HEALING_POTION_USE_ABILITY_REF
    ? healingPotionUseAbilityDefinition()
    : undefined;
}

/** Reads the immutable base mechanic from the built-in or frozen room catalog. */
export function itemUseBaseAbilityDefinition(
  definition: ItemDefinitionV1,
  catalog: Record<string, JsonRecord>,
): JsonRecord | undefined {
  if (!isItemDefinitionV1(definition) || definition.content.use === null) return undefined;
  const abilityRef = definition.content.use.abilityRef;
  const builtin = builtinItemUseAbilityDefinition(abilityRef);
  if (builtin !== undefined) return builtin;
  const registered = catalog[abilityRef];
  if (!isRegisteredAbilityRecord(registered)) return undefined;
  const metadataKeys = new Set([
    "compiledHash",
    "compilerProfile",
    "definitionHash",
    "mechanicGraph",
    "referenceClosure",
  ]);
  const base = Object.fromEntries(
    Object.entries(registered).filter(([key]) => !metadataKeys.has(key)),
  );
  return base.definitionId === abilityRef ? structuredClone(base) : undefined;
}

/**
 * Binds one frozen base ability to one exact item entry and its complete use
 * cost. No caller-supplied quantity or counter cost can enter this wrapper.
 */
export function itemEntryUseAbilityDefinition(
  definition: ItemDefinitionV1,
  entryId: string,
  baseAbilityDefinition: JsonRecord,
): JsonRecord {
  if (!isItemDefinitionV1(definition) || definition.content.use === null) {
    throw new TypeError("item use definition is unavailable");
  }
  const use = definition.content.use;
  if (baseAbilityDefinition.definitionId !== use.abilityRef
    || typeof baseAbilityDefinition.revision !== "string"
    || !isRecord(baseAbilityDefinition.activation)
    || baseAbilityDefinition.activation.kind !== use.kind
    || (!Array.isArray(baseAbilityDefinition.costs)
      && baseAbilityDefinition.costs !== undefined)) {
    throw new TypeError("item use base ability does not match the item definition");
  }
  if (Array.isArray(baseAbilityDefinition.costs)
    && baseAbilityDefinition.costs.some((cost) => isRecord(cost) && cost.kind === "item")) {
    throw new TypeError("item use base ability already carries item-entry authority");
  }
  return {
    ...structuredClone(baseAbilityDefinition),
    definitionId: itemEntryUseAbilityId(use.abilityRef, entryId),
    costs: [
      ...(Array.isArray(baseAbilityDefinition.costs)
        ? structuredClone(baseAbilityDefinition.costs)
        : []),
      {
        kind: "item",
        resourceId: itemEntryResourceId(entryId),
        amount: String(use.quantityCost),
        chargeCost: String(use.chargeCost),
        durabilityCost: String(use.durabilityCost),
      },
    ],
  };
}

/** Compiles any frozen item use through the pinned AbilityDefinition compiler. */
export function compileItemEntryUseAbility(
  definition: ItemDefinitionV1,
  entryId: string,
  baseAbilityDefinition: JsonRecord,
): CompiledAbilityArtifact {
  const compiled = compileAbilityDefinition(itemEntryUseAbilityDefinition(
    definition,
    entryId,
    baseAbilityDefinition,
  ));
  if (!compiled.ok) {
    throw new TypeError(`item use ability cannot compile: ${compiled.code}`);
  }
  return compiled.artifact;
}
