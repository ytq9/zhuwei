import type { GearSlot } from "../../dnd/gear";
import {
  isItemSystemStateV1,
  itemEntryMatchesDefinition,
  itemWeaponPublicDamageText,
  type ItemDefinitionV1,
  type ItemEntryV1,
  type ItemSystemStateV1,
} from "./items";

export type ProjectedItemCounter = {
  current: number;
  maximum: number;
};

export type ProjectedInventoryActivityDisabledReason =
  | "itemBroken"
  | "insufficientQuantity"
  | "insufficientCharges"
  | "insufficientDurability";

export type ProjectedInventoryActivity = {
  activityId: "use";
  label: "使用";
  enabled: boolean;
  disabledReason: ProjectedInventoryActivityDisabledReason | null;
};

type ProjectedInventoryEntryShell = {
  entryId: string;
  quantity: number;
  condition: ItemEntryV1["condition"];
  equippedSlot: GearSlot | null;
};

export type ProjectedOpaqueInventoryEntry = ProjectedInventoryEntryShell & {
  kind: "opaque";
};

export type ProjectedIdentifiedInventoryEntry = ProjectedInventoryEntryShell & {
  kind: "identified";
  name: string;
  description: string;
  category: ItemDefinitionV1["content"]["category"];
  charges: ProjectedItemCounter | null;
  durability: ProjectedItemCounter | null;
  allowedSlots: GearSlot[];
  twoHanded: boolean;
  publicDamageText: string | null;
  activities: ProjectedInventoryActivity[];
};

export type ProjectedInventoryEntry =
  | ProjectedOpaqueInventoryEntry
  | ProjectedIdentifiedInventoryEntry;

export type ProjectedInventory = {
  entries: ProjectedInventoryEntry[];
};

export type ItemInventoryViewer = {
  kind: "player" | "npc";
  characterId: string;
};

function useDisabledReason(
  definition: ItemDefinitionV1,
  entry: ItemEntryV1,
): ProjectedInventoryActivityDisabledReason | null {
  const use = definition.content.use;
  if (use === null) return null;
  if (entry.condition !== "usable") return "itemBroken";
  if (entry.quantity < use.quantityCost) return "insufficientQuantity";
  if (use.chargeCost > 0
    && (entry.charges === null || entry.charges.current < use.chargeCost)) {
    return "insufficientCharges";
  }
  if (use.durabilityCost > 0
    && (entry.durability === null || entry.durability.current < use.durabilityCost)) {
    return "insufficientDurability";
  }
  return null;
}

function projectEntry(
  definition: ItemDefinitionV1,
  entry: ItemEntryV1,
  viewer: ItemInventoryViewer,
): ProjectedInventoryEntry {
  const shell: ProjectedInventoryEntryShell = {
    entryId: entry.entryId,
    quantity: entry.quantity,
    condition: entry.condition,
    equippedSlot: entry.equippedSlot,
  };
  if (!itemPolicyVisibleToViewer(definition.visibilityPolicyRef, viewer, entry)) {
    return { kind: "opaque", ...shell };
  }

  const equipment = definition.content.equipment;
  const use = definition.content.use;
  const disabledReason = use === null
    ? null
    : useDisabledReason(definition, entry);
  return {
    kind: "identified",
    ...shell,
    name: definition.content.label,
    description: definition.content.description,
    category: definition.content.category,
    charges: entry.charges === null ? null : { ...entry.charges },
    durability: entry.durability === null ? null : { ...entry.durability },
    allowedSlots: equipment === null ? [] : [...equipment.allowedSlots],
    twoHanded: equipment?.twoHanded ?? false,
    publicDamageText: itemWeaponPublicDamageText(equipment?.weapon ?? null),
    activities: use === null
      ? []
      : [{
          activityId: "use",
          label: "使用",
          enabled: disabledReason === null,
          disabledReason,
        }],
  };
}

/**
 * Item definitions and entries carry independent visibility policies. Only
 * policies that identify this character, or are explicitly public to its
 * current scene, may disclose mechanics. Unknown policies fail closed.
 */
export function itemPolicyVisibleToViewer(
  policyRef: string,
  viewer: ItemInventoryViewer,
  entry?: ItemEntryV1,
): boolean {
  return policyRef.startsWith("visibility:public")
    || policyRef === "visibility:scene-observers"
    || (policyRef === "visibility:item-holder"
      && entry?.disposition === "held"
      && entry.holderRef === viewer.characterId)
    || policyRef === `visibility:character-controller:${viewer.characterId}`
    || policyRef === `visibility:knowledge-holder:${viewer.characterId}`
    || (viewer.kind === "npc" && policyRef === `visibility:npc:${viewer.characterId}`);
}

/**
 * Projects only the safe, displayable inventory fields for one holder.
 * Invalid or unresolved authority state fails closed instead of exposing ids.
 */
export function projectHeldInventory(
  itemSystem: ItemSystemStateV1,
  viewer: ItemInventoryViewer,
): ProjectedInventory {
  if (viewer.characterId.length === 0 || !isItemSystemStateV1(itemSystem)) {
    throw new TypeError("item inventory cannot be projected from invalid state");
  }

  const entries = Object.values(itemSystem.entries)
    .filter((entry) => entry.disposition === "held"
      && entry.holderRef === viewer.characterId
      && itemPolicyVisibleToViewer(entry.visibilityPolicyRef, viewer, entry))
    .sort((left, right) => left.entryId < right.entryId ? -1 : left.entryId > right.entryId ? 1 : 0)
    .map((entry) => {
      const definition = itemSystem.definitions[entry.definitionRef];
      if (definition === undefined || !itemEntryMatchesDefinition(entry, definition)) {
        throw new TypeError("item inventory contains an unresolved definition");
      }
      return projectEntry(definition, entry, viewer);
    });

  return { entries };
}
