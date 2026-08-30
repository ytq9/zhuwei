import {
  GEAR_SLOTS,
  acFromGear,
  stowSlot,
  wearItem,
  type GearSlot,
} from "../../dnd/gear";

import type { CharacterLoadoutRecord, CharacterRecord } from "./model";

export type CharacterGearAction =
  | { action: "wear"; slot: GearSlot; itemId: string }
  | { action: "stow"; slot: GearSlot };

export type CharacterGearTransition = {
  loadout: CharacterLoadoutRecord;
  movedItemId: string;
};

export function isGearSlot(value: unknown): value is GearSlot {
  return typeof value === "string" && GEAR_SLOTS.some(({ id }) => id === value);
}

function canonicalLoadout(
  character: CharacterRecord,
  equipped: Record<string, string>,
  backpack: Array<{ itemId: string; qty: number }>,
): CharacterLoadoutRecord {
  const abilityScores = character.abilityScores ?? {};
  const canonicalEquipped = Object.fromEntries(
    Object.entries(equipped)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    armorClass: acFromGear(
      character.classId ?? "",
      {
        dex: abilityScores.dex ?? 10,
        con: abilityScores.con ?? 10,
      },
      canonicalEquipped,
    ),
    speedFeet: character.loadout?.speedFeet ?? 30,
    equipped: canonicalEquipped,
    backpack: backpack
      .filter(({ qty }) => qty > 0)
      .sort((left, right) => left.itemId.localeCompare(right.itemId))
      .map(({ itemId, qty }) => ({ itemId, quantity: qty })),
    ...(character.loadout?.mechanicalItems === undefined
      ? {}
      : { mechanicalItems: structuredClone(character.loadout.mechanicalItems) }),
  };
}

/**
 * Derive one semantic equipment transition exclusively from the active Rules
 * character. Static cards and client-provided loadout snapshots are not inputs.
 */
export function changeCharacterGear(
  character: CharacterRecord,
  action: CharacterGearAction,
): CharacterGearTransition | { error: string } {
  const current = character.loadout;
  if (current === undefined) return { error: "characterLoadoutUnavailable" };
  const equipped = { ...current.equipped };
  const backpack = current.backpack.map(({ itemId, quantity }) => ({ itemId, qty: quantity }));

  if (action.action === "stow") {
    const movedItemId = equipped[action.slot];
    if (movedItemId === undefined) return { error: "unchangedGear" };
    // The ammo slot selects which ammunition is in use; its quantity already
    // remains in the backpack. Legacy stowSlot models physical equipment and
    // would mint one round when clearing this selector.
    const next = action.slot === "ammo"
      ? {
          equipped: Object.fromEntries(
            Object.entries(equipped).filter(([slot]) => slot !== "ammo"),
          ),
          backpack,
        }
      : stowSlot(equipped, backpack, action.slot);
    return {
      movedItemId,
      loadout: canonicalLoadout(character, next.equipped, next.backpack),
    };
  }

  if (equipped[action.slot] === action.itemId) return { error: "unchangedGear" };
  const next = wearItem(equipped, backpack, action.itemId, action.slot);
  if (next.error !== undefined) return { error: next.error };
  return {
    movedItemId: action.itemId,
    loadout: canonicalLoadout(character, next.equipped, next.backpack),
  };
}
