import {
  GEAR_SLOTS,
  ITEMS,
  itemById,
  type GearItem,
  type GearItemResolver,
  type GearSlot,
} from "../../dnd/gear";

import type { CharacterLoadoutRecord } from "./model";
import {
  createInitialItemEntry,
  isItemSystemStateV1,
  itemDefinitionFromStandardGear,
  itemStackIdentity,
  itemWeaponPublicDamageText,
  standardGearDefinitionId,
  type ItemDefinitionV1,
  type ItemEntryV1,
  type ItemOwnership,
  type ItemOwnershipDisposition,
  type ItemSystemStateV1,
} from "./items";

const MAX_ITEM_QUANTITY = 1_000_000;
const GEAR_SLOT_IDS = GEAR_SLOTS.map(({ id }) => id);

export type ItemTransitionError = { error: string };

export type ItemLoadoutBasis = {
  holderRef: string;
  classId?: string;
  scores?: { dex?: number; con?: number };
  speedFeet?: number;
};

export type ItemEquipmentAction =
  | { action: "wear"; entryId: string; slot: GearSlot }
  | { action: "stow"; slot: GearSlot };

const SIX_SECONDS_MICROS = 6_000_000n;
const ONE_MINUTE_MICROS = 60_000_000n;
const FIVE_MINUTES_MICROS = 300_000_000n;
const TEN_MINUTES_MICROS = 600_000_000n;

function canonicalString(value: unknown, maximum = 300): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && value.normalize("NFC") === value;
}

function boundedQuantity(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && Number(value) > 0
    && Number(value) <= MAX_ITEM_QUANTITY;
}

function isGearSlot(value: unknown): value is GearSlot {
  return typeof value === "string" && (GEAR_SLOT_IDS as readonly string[]).includes(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJson(value, right[index]));
  }
  if (typeof left !== "object" || left === null
    || typeof right !== "object" || right === null) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) =>
      key === rightKeys[index] && sameJson(leftRecord[key], rightRecord[key]));
}

function sortedItemSystem(itemSystem: ItemSystemStateV1): ItemSystemStateV1 {
  return {
    schema: itemSystem.schema,
    definitions: Object.fromEntries(
      Object.entries(itemSystem.definitions).sort(([left], [right]) => left.localeCompare(right)),
    ),
    entries: Object.fromEntries(
      Object.entries(itemSystem.entries).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

function validNextItemSystem(
  itemSystem: ItemSystemStateV1,
): { itemSystem: ItemSystemStateV1 } | ItemTransitionError {
  const canonical = sortedItemSystem(itemSystem);
  return isItemSystemStateV1(canonical)
    ? { itemSystem: canonical }
    : { error: "invalidItemSystemTransition" };
}

/** Stable only for the one-time conversion of a character's initial standard loadout. */
export function initialStandardGearEntryId(
  characterId: string,
  itemId: string,
  ordinal: number | "stack",
): string {
  if (!canonicalString(characterId)
    || itemById(itemId) === undefined
    || (ordinal !== "stack" && (!Number.isSafeInteger(ordinal) || ordinal < 1))) {
    throw new TypeError("initial standard gear identity is invalid");
  }
  const suffix = ordinal === "stack"
    ? ordinal
    : `unit-${String(ordinal).padStart(6, "0")}`;
  const entryId = `item-entry:standard:${characterId.length}:${characterId}:${itemId}:${suffix}`;
  if (!canonicalString(entryId)) throw new TypeError("initial standard gear identity is too long");
  return entryId;
}

/**
 * Convert one starting standard-gear loadout into the single global item
 * authority. The conversion is deterministic and idempotent for the same
 * initial input; a conflicting definition or entry is rejected instead of
 * being overwritten.
 */
export function mergeInitialStandardLoadout(
  itemSystem: ItemSystemStateV1,
  characterId: string,
  loadout: CharacterLoadoutRecord,
): { itemSystem: ItemSystemStateV1 } | ItemTransitionError {
  if (!isItemSystemStateV1(itemSystem)) return { error: "invalidItemSystem" };
  if (!canonicalString(characterId)) return { error: "invalidCharacterId" };

  const backpack = new Map<string, number>();
  for (const entry of loadout.backpack) {
    if (!canonicalString(entry.itemId)
      || !boundedQuantity(entry.quantity)
      || backpack.has(entry.itemId)) return { error: "invalidCharacterLoadout" };
    if (itemById(entry.itemId) === undefined) return { error: "unknownStandardGear" };
    backpack.set(entry.itemId, entry.quantity);
  }

  const equipped = new Map<GearSlot, string>();
  for (const [slotValue, itemIdValue] of Object.entries(loadout.equipped)) {
    if (!isGearSlot(slotValue) || !canonicalString(itemIdValue)) {
      return { error: "invalidCharacterLoadout" };
    }
    const item = itemById(itemIdValue);
    if (item === undefined) return { error: "unknownStandardGear" };
    const definition = itemDefinitionFromStandardGear(item);
    if (definition.content.equipment === null
      || !definition.content.equipment.allowedSlots.includes(slotValue)) {
      return { error: "invalidStandardGearSlot" };
    }
    if (slotValue === "ammo" && !backpack.has(item.id)) {
      return { error: "emptySelectedAmmunition" };
    }
    equipped.set(slotValue, item.id);
  }

  const mainItemId = equipped.get("main");
  if (mainItemId !== undefined
    && itemById(mainItemId)?.twoHanded === true
    && equipped.has("off")) return { error: "twoHandedSlotConflict" };

  const referencedItemIds = [...new Set([
    ...equipped.values(),
    ...backpack.keys(),
  ])].sort();
  const next = structuredClone(itemSystem);
  const entries: ItemEntryV1[] = [];

  for (const itemId of referencedItemIds) {
    const item = itemById(itemId);
    if (item === undefined) return { error: "unknownStandardGear" };
    const definition = itemDefinitionFromStandardGear(item);
    const existingDefinition = next.definitions[definition.definitionId];
    if (existingDefinition !== undefined && !sameJson(existingDefinition, definition)) {
      return { error: "itemDefinitionConflict" };
    }
    next.definitions[definition.definitionId] = definition;

    const equippedSlots = GEAR_SLOTS
      .map(({ id }) => id)
      .filter((slot) => equipped.get(slot) === itemId);
    const backpackQuantity = backpack.get(itemId) ?? 0;

    if (definition.content.stackable) {
      if (backpackQuantity === 0) return { error: "invalidCharacterLoadout" };
      const equippedSlot = equippedSlots[0] ?? null;
      if (equippedSlots.length > 1 || (equippedSlot !== null && equippedSlot !== "ammo")) {
        return { error: "invalidStandardGearSlot" };
      }
      try {
        entries.push(createInitialItemEntry(definition, {
          entryId: initialStandardGearEntryId(characterId, itemId, "stack"),
          quantity: backpackQuantity,
          placement: { kind: "held", holderRef: characterId, equippedSlot },
          ownership: { kind: "character", ownerRef: characterId },
          visibilityPolicyRef: `visibility:character-controller:${characterId}`,
        }));
      } catch {
        return { error: "invalidCharacterLoadout" };
      }
      continue;
    }

    let ordinal = 0;
    for (const slot of equippedSlots) {
      ordinal += 1;
      try {
        entries.push(createInitialItemEntry(definition, {
          entryId: initialStandardGearEntryId(characterId, itemId, ordinal),
          quantity: 1,
          placement: { kind: "held", holderRef: characterId, equippedSlot: slot },
          ownership: { kind: "character", ownerRef: characterId },
          visibilityPolicyRef: `visibility:character-controller:${characterId}`,
        }));
      } catch {
        return { error: "invalidCharacterLoadout" };
      }
    }
    for (let index = 0; index < backpackQuantity; index += 1) {
      ordinal += 1;
      try {
        entries.push(createInitialItemEntry(definition, {
          entryId: initialStandardGearEntryId(characterId, itemId, ordinal),
          quantity: 1,
          placement: { kind: "held", holderRef: characterId, equippedSlot: null },
          ownership: { kind: "character", ownerRef: characterId },
          visibilityPolicyRef: `visibility:character-controller:${characterId}`,
        }));
      } catch {
        return { error: "invalidCharacterLoadout" };
      }
    }
  }

  for (const entry of entries) {
    const existingEntry = next.entries[entry.entryId];
    if (existingEntry !== undefined && !sameJson(existingEntry, entry)) {
      return { error: "itemEntryConflict" };
    }
    next.entries[entry.entryId] = entry;
  }
  return validNextItemSystem(next);
}

function armorClassFromItems(
  itemSystem: ItemSystemStateV1,
  equipped: Partial<Record<GearSlot, ItemEntryV1>>,
  classId: string,
  scores: { dex: number; con: number },
): number | undefined {
  if (![scores.dex, scores.con].every(Number.isSafeInteger)) return undefined;
  const dexterity = Math.floor((scores.dex - 10) / 2);
  const constitution = Math.floor((scores.con - 10) / 2);
  const armorEntry = equipped.armor;
  const armor = armorEntry === undefined
    ? null
    : itemSystem.definitions[armorEntry.definitionRef]?.content.equipment?.armor ?? null;
  let armorClass: number;
  if (armor !== null && armor.kind !== "shield"
    && armor.acBase !== null && armor.acDexCap !== null) {
    const dexterityPart = armor.acDexCap === 0
      ? 0
      : Math.min(dexterity, armor.acDexCap);
    armorClass = armor.acBase + dexterityPart;
  } else if (classId === "barbarian") {
    armorClass = 10 + dexterity + constitution;
  } else {
    armorClass = 10 + dexterity;
  }
  const offEntry = equipped.off;
  const offArmor = offEntry === undefined
    ? null
    : itemSystem.definitions[offEntry.definitionRef]?.content.equipment?.armor ?? null;
  if (offArmor?.kind === "shield") armorClass += 2;
  if (classId === "fighter" && armor !== null && armor.kind !== "shield") armorClass += 1;
  return Number.isSafeInteger(armorClass) && armorClass >= 1 && armorClass <= 99
    ? armorClass
    : undefined;
}

/** Derive the character loadout projection; it never owns item mechanics. */
export function deriveCharacterLoadoutFromItems(
  itemSystem: ItemSystemStateV1,
  basis: ItemLoadoutBasis,
): { loadout: CharacterLoadoutRecord } | ItemTransitionError {
  if (!isItemSystemStateV1(itemSystem)) return { error: "invalidItemSystem" };
  if (!canonicalString(basis.holderRef)) return { error: "invalidCharacterId" };
  const speedFeet = basis.speedFeet ?? 30;
  if (!Number.isSafeInteger(speedFeet) || speedFeet <= 0) {
    return { error: "invalidCharacterSpeed" };
  }

  const held = Object.values(itemSystem.entries)
    .filter((entry) => entry.disposition === "held" && entry.holderRef === basis.holderRef)
    .sort((left, right) => left.entryId.localeCompare(right.entryId));
  const equippedEntries: Partial<Record<GearSlot, ItemEntryV1>> = {};
  const equipped: Record<string, string> = {};
  const backpack: Array<{ itemId: string; quantity: number }> = [];
  for (const entry of held) {
    if (entry.equippedSlot !== null) {
      equippedEntries[entry.equippedSlot] = entry;
      equipped[entry.equippedSlot] = entry.entryId;
    }
    if (entry.equippedSlot === null || entry.equippedSlot === "ammo") {
      backpack.push({ itemId: entry.entryId, quantity: entry.quantity });
    }
  }
  backpack.sort((left, right) => left.itemId.localeCompare(right.itemId));

  const armorClass = armorClassFromItems(
    itemSystem,
    equippedEntries,
    basis.classId ?? "",
    {
      dex: basis.scores?.dex ?? 10,
      con: basis.scores?.con ?? 10,
    },
  );
  if (armorClass === undefined) return { error: "invalidArmorClass" };
  return {
    loadout: {
      armorClass,
      speedFeet,
      equipped: Object.fromEntries(
        Object.entries(equipped).sort(([left], [right]) => left.localeCompare(right)),
      ),
      backpack,
    },
  };
}

function dynamicGearWear(definition: ItemDefinitionV1): GearItem["wear"] {
  const equipment = definition.content.equipment;
  if (equipment === null) return "pack";
  if (definition.content.category === "weapon") return "weapon";
  if (definition.content.category === "ammunition") return "ammo";
  if (definition.content.category === "shield") return "off";
  if (equipment.allowedSlots.length === 2
    && equipment.allowedSlots.includes("ring1")
    && equipment.allowedSlots.includes("ring2")) return "ring";
  if (equipment.allowedSlots.length === 1) return equipment.allowedSlots[0];
  return equipment.allowedSlots.includes("main") ? "weapon" : equipment.allowedSlots[0];
}

function gearItemFromDefinition(
  definition: ItemDefinitionV1,
  entryId: string,
): GearItem {
  const standard = ITEMS.find((item) => standardGearDefinitionId(item.id) === definition.definitionId);
  if (standard !== undefined) {
    if (!sameJson(itemDefinitionFromStandardGear(standard), definition)) {
      throw new TypeError("standard item definition conflicts with the pinned catalog");
    }
  }
  const equipment = definition.content.equipment;
  const armor = equipment?.armor ?? null;
  const weapon = equipment?.weapon ?? null;
  return {
    id: entryId,
    name: definition.content.label,
    category: definition.content.category,
    stackable: definition.content.stackable,
    wear: dynamicGearWear(definition),
    ...(equipment?.twoHanded === true ? { twoHanded: true } : {}),
    ...(armor === null ? {} : {
      armor: armor.kind,
      ...(armor.acBase === null ? {} : { acBase: armor.acBase }),
      ...(armor.acDexCap === null ? {} : { acDexCap: armor.acDexCap }),
    }),
    ...(weapon === null ? {} : {
      damage: itemWeaponPublicDamageText(weapon)!,
      weapon: {
        attackAbility: weapon.attackAbility,
        damageDice: weapon.damageDice,
        damageType: weapon.damageType,
        ...(weapon.reachInches === null ? {} : { reachInches: weapon.reachInches }),
        ...(weapon.rangeNormalInches === null
          ? {}
          : { rangeNormalInches: weapon.rangeNormalInches }),
        ...(weapon.rangeLongInches === null
          ? {}
          : { rangeLongInches: weapon.rangeLongInches }),
        ...(weapon.ammunitionDefinitionRef === null
          ? {}
          : { ammunitionId: weapon.ammunitionDefinitionRef }),
        requiresSight: weapon.requiresSight,
      },
    }),
    text: definition.content.description,
    ...(definition.content.aliases.length === 0
      ? {}
      : { aliases: [...definition.content.aliases] }),
  };
}

/** Resolve a global entry id to the GearItem view used by existing compilers. */
export function itemEntryGearResolver(itemSystem: ItemSystemStateV1): GearItemResolver {
  if (!isItemSystemStateV1(itemSystem)) throw new TypeError("item system is invalid");
  return (entryId) => {
    if (!canonicalString(entryId)) return undefined;
    const entry = itemSystem.entries[entryId];
    const definition = entry === undefined
      ? undefined
      : itemSystem.definitions[entry.definitionRef];
    return definition === undefined ? undefined : gearItemFromDefinition(definition, entry.entryId);
  };
}

export function changeItemEquipment(
  itemSystem: ItemSystemStateV1,
  basis: ItemLoadoutBasis,
  action: ItemEquipmentAction,
): {
  itemSystem: ItemSystemStateV1;
  loadout: CharacterLoadoutRecord;
  movedEntryId: string;
} | ItemTransitionError {
  if (!isItemSystemStateV1(itemSystem)) return { error: "invalidItemSystem" };
  if (!canonicalString(basis.holderRef)) return { error: "invalidCharacterId" };
  const next = structuredClone(itemSystem);
  let movedEntryId: string;

  if (action.action === "stow") {
    const entry = Object.values(next.entries).find((candidate) =>
      candidate.disposition === "held"
      && candidate.holderRef === basis.holderRef
      && candidate.equippedSlot === action.slot);
    if (entry === undefined) return { error: "unchangedGear" };
    movedEntryId = entry.entryId;
    entry.equippedSlot = null;
  } else {
    const entry = next.entries[action.entryId];
    if (entry === undefined || entry.disposition !== "held") return { error: "itemUnavailable" };
    if (entry.holderRef !== basis.holderRef) return { error: "itemHolderMismatch" };
    if (entry.condition !== "usable") return { error: "itemNotUsable" };
    const definition = next.definitions[entry.definitionRef];
    if (definition === undefined || definition.revision !== entry.definitionRevision) {
      return { error: "itemDefinitionUnavailable" };
    }
    const equipment = definition.content.equipment;
    if (equipment === null || !equipment.allowedSlots.includes(action.slot)) {
      return { error: "invalidEquipmentSlot" };
    }
    if (entry.equippedSlot === action.slot) return { error: "unchangedGear" };

    for (const candidate of Object.values(next.entries)) {
      if (candidate.entryId !== entry.entryId
        && candidate.disposition === "held"
        && candidate.holderRef === basis.holderRef
        && candidate.equippedSlot === action.slot) candidate.equippedSlot = null;
    }
    if (equipment.twoHanded) {
      for (const candidate of Object.values(next.entries)) {
        if (candidate.disposition === "held"
          && candidate.holderRef === basis.holderRef
          && candidate.equippedSlot === "off") candidate.equippedSlot = null;
      }
    } else if (action.slot === "off") {
      const main = Object.values(next.entries).find((candidate) =>
        candidate.disposition === "held"
        && candidate.holderRef === basis.holderRef
        && candidate.equippedSlot === "main");
      if (main !== undefined
        && next.definitions[main.definitionRef]?.content.equipment?.twoHanded === true) {
        main.equippedSlot = null;
      }
    }
    entry.equippedSlot = action.slot;
    movedEntryId = entry.entryId;
  }

  const validated = validNextItemSystem(next);
  if ("error" in validated) return validated;
  const derived = deriveCharacterLoadoutFromItems(validated.itemSystem, basis);
  if ("error" in derived) return derived;
  return { itemSystem: validated.itemSystem, loadout: derived.loadout, movedEntryId };
}

function equipmentOperationDurationMicros(
  definition: ItemDefinitionV1,
  operation: "don" | "doff",
): bigint {
  const armorKind = definition.content.equipment?.armor?.kind;
  if (armorKind === "light") return ONE_MINUTE_MICROS;
  if (armorKind === "medium") {
    return operation === "don" ? FIVE_MINUTES_MICROS : ONE_MINUTE_MICROS;
  }
  if (armorKind === "heavy") {
    return operation === "don" ? TEN_MINUTES_MICROS : FIVE_MINUTES_MICROS;
  }
  return SIX_SECONDS_MICROS;
}

/**
 * Computes the complete 2014 don/doff time for one already-validated equipment
 * transition. Replaced and automatically cleared equipment both contribute;
 * callers cannot silently make those side effects instantaneous.
 */
export function itemEquipmentTransitionDurationMicros(
  before: ItemSystemStateV1,
  after: ItemSystemStateV1,
  holderRef: string,
): string | undefined {
  if (!isItemSystemStateV1(before)
    || !isItemSystemStateV1(after)
    || !canonicalString(holderRef)) return undefined;

  let duration = 0n;
  const entryIds = [...new Set([
    ...Object.keys(before.entries),
    ...Object.keys(after.entries),
  ])].sort();
  for (const entryId of entryIds) {
    const prior = before.entries[entryId];
    const next = after.entries[entryId];
    const priorSlot = prior?.disposition === "held" && prior.holderRef === holderRef
      ? prior.equippedSlot
      : null;
    const nextSlot = next?.disposition === "held" && next.holderRef === holderRef
      ? next.equippedSlot
      : null;
    if (priorSlot === nextSlot) continue;

    if (priorSlot !== null && prior !== undefined) {
      const definition = before.definitions[prior.definitionRef];
      if (definition === undefined) return undefined;
      duration += equipmentOperationDurationMicros(definition, "doff");
    }
    if (nextSlot !== null && next !== undefined) {
      const definition = after.definitions[next.definitionRef];
      if (definition === undefined) return undefined;
      duration += equipmentOperationDurationMicros(definition, "don");
    }
  }
  return duration > 0n ? duration.toString() : undefined;
}

function moveItemQuantityToHolder(
  itemSystem: ItemSystemStateV1,
  source: ItemEntryV1,
  holderRef: string,
  quantity: number,
  targetEntryId: string | undefined,
  ownership: ItemOwnership,
): { itemSystem: ItemSystemStateV1; targetEntryId: string } | ItemTransitionError {
  const definition = itemSystem.definitions[source.definitionRef];
  if (definition === undefined) return { error: "itemDefinitionUnavailable" };
  if (!boundedQuantity(quantity) || quantity > source.quantity) return { error: "invalidQuantity" };
  if (!definition.content.stackable && (quantity !== 1 || source.quantity !== 1)) {
    return { error: "nonStackableQuantity" };
  }
  const partial = quantity < source.quantity;
  if (partial && !canonicalString(targetEntryId)) return { error: "targetEntryIdRequired" };
  const holderVisibilityPolicyRef = `visibility:character-controller:${holderRef}`;

  const next = structuredClone(itemSystem);
  const nextSource = next.entries[source.entryId];
  const targetIdentity = itemStackIdentity({
    ...structuredClone(source),
    disposition: "held",
    holderRef,
    sceneRef: null,
    equippedSlot: null,
    ownership: structuredClone(ownership),
    visibilityPolicyRef: holderVisibilityPolicyRef,
  });
  const targetStacks = definition.content.stackable
    ? Object.values(next.entries).filter((entry) =>
        entry.entryId !== source.entryId
        && entry.disposition === "held"
        && entry.holderRef === holderRef
        && entry.definitionRef === source.definitionRef
        && entry.definitionRevision === source.definitionRevision
        && itemStackIdentity(entry) === targetIdentity)
    : [];
  if (targetStacks.length > 1) return { error: "targetStackConflict" };
  const targetStack = targetStacks[0];

  if (targetStack !== undefined) {
    if (targetEntryId !== undefined && targetEntryId !== targetStack.entryId) {
      return { error: "targetEntryConflict" };
    }
    if (!Number.isSafeInteger(targetStack.quantity + quantity)
      || targetStack.quantity + quantity > MAX_ITEM_QUANTITY) return { error: "invalidQuantity" };
    targetStack.quantity += quantity;
    targetStack.visibilityPolicyRef = holderVisibilityPolicyRef;
    if (partial) nextSource.quantity -= quantity;
    else delete next.entries[nextSource.entryId];
    const validated = validNextItemSystem(next);
    return "error" in validated
      ? validated
      : { itemSystem: validated.itemSystem, targetEntryId: targetStack.entryId };
  }

  if (!partial) {
    if (targetEntryId !== undefined && targetEntryId !== source.entryId) {
      return { error: "targetEntryIdUnexpected" };
    }
    nextSource.disposition = "held";
    nextSource.holderRef = holderRef;
    nextSource.sceneRef = null;
    nextSource.equippedSlot = null;
    nextSource.ownership = structuredClone(ownership);
    nextSource.visibilityPolicyRef = holderVisibilityPolicyRef;
    const validated = validNextItemSystem(next);
    return "error" in validated
      ? validated
      : { itemSystem: validated.itemSystem, targetEntryId: nextSource.entryId };
  }

  if (next.entries[targetEntryId!] !== undefined) return { error: "targetEntryConflict" };
  nextSource.quantity -= quantity;
  const target: ItemEntryV1 = {
    ...structuredClone(nextSource),
    entryId: targetEntryId!,
    disposition: "held",
    holderRef,
    sceneRef: null,
    equippedSlot: null,
    quantity,
    ownership: structuredClone(ownership),
    visibilityPolicyRef: holderVisibilityPolicyRef,
  };
  next.entries[target.entryId] = target;
  const validated = validNextItemSystem(next);
  return "error" in validated
    ? validated
    : { itemSystem: validated.itemSystem, targetEntryId: target.entryId };
}

/** Transfer possession; scene/co-location and caller permission remain upper-layer checks. */
export function transferItemQuantity(
  itemSystem: ItemSystemStateV1,
  input: {
    entryId: string;
    fromHolderRef: string;
    toHolderRef: string;
    quantity: number;
    targetEntryId?: string;
    ownershipDisposition: ItemOwnershipDisposition;
  },
): { itemSystem: ItemSystemStateV1; targetEntryId: string } | ItemTransitionError {
  if (!isItemSystemStateV1(itemSystem)) return { error: "invalidItemSystem" };
  if (!canonicalString(input.fromHolderRef)
    || !canonicalString(input.toHolderRef)
    || input.fromHolderRef === input.toHolderRef) return { error: "invalidTransferParticipants" };
  const source = itemSystem.entries[input.entryId];
  if (source === undefined || source.disposition !== "held") return { error: "itemUnavailable" };
  if (source.holderRef !== input.fromHolderRef) return { error: "itemHolderMismatch" };
  if (input.ownershipDisposition !== "preserve"
    && input.ownershipDisposition !== "transferToRecipient") {
    return { error: "invalidOwnershipDisposition" };
  }
  return moveItemQuantityToHolder(
    itemSystem,
    source,
    input.toHolderRef,
    input.quantity,
    input.targetEntryId,
    input.ownershipDisposition === "transferToRecipient"
      ? { kind: "character", ownerRef: input.toHolderRef }
      : structuredClone(source.ownership),
  );
}

/** Acquire all or part of a scene entry into one holder's inventory. */
export function acquireItemQuantity(
  itemSystem: ItemSystemStateV1,
  input: {
    entryId: string;
    holderRef: string;
    quantity: number;
    targetEntryId?: string;
  },
): { itemSystem: ItemSystemStateV1; targetEntryId: string } | ItemTransitionError {
  if (!isItemSystemStateV1(itemSystem)) return { error: "invalidItemSystem" };
  if (!canonicalString(input.holderRef)) return { error: "invalidCharacterId" };
  const source = itemSystem.entries[input.entryId];
  if (source === undefined || source.disposition !== "scene") {
    return { error: "itemUnavailable" };
  }
  return moveItemQuantityToHolder(
    itemSystem,
    source,
    input.holderRef,
    input.quantity,
    input.targetEntryId,
    source.ownership.kind === "unowned"
      ? { kind: "character", ownerRef: input.holderRef }
      : structuredClone(source.ownership),
  );
}

export type ItemCostSnapshot = {
  quantityBefore: number;
  quantityAfter: number;
  chargesBefore: number | null;
  chargesAfter: number | null;
  durabilityBefore: number | null;
  durabilityAfter: number | null;
};

/** Atomically pays one frozen exact-entry cost across quantity and counters. */
export function spendItemEntryCosts(
  itemSystem: ItemSystemStateV1,
  input: {
    entryId: string;
    holderRef: string;
    quantityCost: number;
    chargeCost: number;
    durabilityCost: number;
  },
): {
  itemSystem: ItemSystemStateV1;
  entryId: string;
  snapshot: ItemCostSnapshot;
} | ItemTransitionError {
  if (!isItemSystemStateV1(itemSystem)) return { error: "invalidItemSystem" };
  if (!canonicalString(input.holderRef)
    || ![input.quantityCost, input.chargeCost, input.durabilityCost].every((cost) =>
      Number.isSafeInteger(cost) && cost >= 0 && cost <= MAX_ITEM_QUANTITY)) {
    return { error: "invalidItemCost" };
  }
  const source = itemSystem.entries[input.entryId];
  if (source === undefined || source.disposition !== "held") return { error: "itemUnavailable" };
  if (source.holderRef !== input.holderRef) return { error: "itemHolderMismatch" };
  if (source.condition !== "usable") return { error: "itemNotUsable" };
  if (input.quantityCost > source.quantity
    || (input.chargeCost > 0
      && (source.charges === null || input.chargeCost > source.charges.current))
    || (input.durabilityCost > 0
      && (source.durability === null || input.durabilityCost > source.durability.current))) {
    return { error: "insufficientItemCost" };
  }

  const snapshot: ItemCostSnapshot = {
    quantityBefore: source.quantity,
    quantityAfter: source.quantity - input.quantityCost,
    chargesBefore: source.charges?.current ?? null,
    chargesAfter: source.charges === null
      ? null
      : source.charges.current - input.chargeCost,
    durabilityBefore: source.durability?.current ?? null,
    durabilityAfter: source.durability === null
      ? null
      : source.durability.current - input.durabilityCost,
  };
  const next = structuredClone(itemSystem);
  const entry = next.entries[source.entryId];
  entry.quantity = snapshot.quantityAfter;
  if (entry.charges !== null && snapshot.chargesAfter !== null) {
    entry.charges.current = snapshot.chargesAfter;
  }
  if (entry.durability !== null && snapshot.durabilityAfter !== null) {
    entry.durability.current = snapshot.durabilityAfter;
  }
  if (entry.quantity === 0) {
    entry.disposition = "consumed";
    entry.holderRef = null;
    entry.sceneRef = null;
    entry.equippedSlot = null;
  }
  if (entry.durability !== null && entry.durability.current === 0) {
    entry.condition = "broken";
    entry.equippedSlot = null;
  }
  const validated = validNextItemSystem(next);
  return "error" in validated
    ? validated
    : { itemSystem: validated.itemSystem, entryId: entry.entryId, snapshot };
}

export function consumeItemQuantity(
  itemSystem: ItemSystemStateV1,
  input: { entryId: string; holderRef: string; quantity: number },
): { itemSystem: ItemSystemStateV1; entryId: string } | ItemTransitionError {
  if (!isItemSystemStateV1(itemSystem)) return { error: "invalidItemSystem" };
  const source = itemSystem.entries[input.entryId];
  if (source === undefined || source.disposition !== "held") return { error: "itemUnavailable" };
  if (source.holderRef !== input.holderRef) return { error: "itemHolderMismatch" };
  if (source.condition !== "usable") return { error: "itemNotUsable" };
  if (!boundedQuantity(input.quantity) || input.quantity > source.quantity) {
    return { error: "invalidQuantity" };
  }
  const definition = itemSystem.definitions[source.definitionRef];
  if (definition === undefined) return { error: "itemDefinitionUnavailable" };
  if (!definition.content.stackable && input.quantity !== 1) {
    return { error: "nonStackableQuantity" };
  }

  const next = structuredClone(itemSystem);
  const entry = next.entries[source.entryId];
  if (input.quantity < entry.quantity) {
    entry.quantity -= input.quantity;
  } else {
    entry.disposition = "consumed";
    entry.holderRef = null;
    entry.sceneRef = null;
    entry.equippedSlot = null;
    entry.quantity = 0;
    if (entry.charges !== null) entry.charges.current = 0;
    if (entry.durability !== null) entry.durability.current = 0;
  }
  const validated = validNextItemSystem(next);
  return "error" in validated
    ? validated
    : { itemSystem: validated.itemSystem, entryId: entry.entryId };
}

export type ItemLifecycleAction = "break" | "repair" | "destroy";

export function changeItemLifecycle(
  itemSystem: ItemSystemStateV1,
  input: { entryId: string; action: ItemLifecycleAction; holderRef?: string },
): { itemSystem: ItemSystemStateV1; entryId: string } | ItemTransitionError {
  if (!isItemSystemStateV1(itemSystem)) return { error: "invalidItemSystem" };
  const source = itemSystem.entries[input.entryId];
  if (source === undefined
    || source.disposition === "consumed"
    || source.disposition === "destroyed") return { error: "itemUnavailable" };
  if (source.disposition === "held") {
    if (source.holderRef !== input.holderRef) return { error: "itemHolderMismatch" };
  } else if (input.holderRef !== undefined) {
    return { error: "itemHolderMismatch" };
  }

  if ((input.action === "break" && source.condition === "broken")
    || (input.action === "repair" && source.condition === "usable")) {
    return { error: "unchangedItemState" };
  }

  const next = structuredClone(itemSystem);
  const entry = next.entries[source.entryId];
  if (input.action === "break") {
    entry.condition = "broken";
    entry.equippedSlot = null;
    if (entry.durability !== null) entry.durability.current = 0;
  } else if (input.action === "repair") {
    entry.condition = "usable";
    if (entry.durability !== null) entry.durability.current = entry.durability.maximum;
  } else {
    entry.disposition = "destroyed";
    entry.holderRef = null;
    entry.sceneRef = null;
    entry.equippedSlot = null;
    entry.quantity = 0;
    entry.condition = "broken";
    if (entry.charges !== null) entry.charges.current = 0;
    if (entry.durability !== null) entry.durability.current = 0;
  }
  const validated = validNextItemSystem(next);
  return "error" in validated
    ? validated
    : { itemSystem: validated.itemSystem, entryId: entry.entryId };
}
