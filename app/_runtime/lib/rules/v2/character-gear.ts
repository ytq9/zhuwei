import { GEAR_SLOTS, type GearSlot } from "../../dnd/gear";

export function isGearSlot(value: unknown): value is GearSlot {
  return typeof value === "string" && GEAR_SLOTS.some(({ id }) => id === value);
}
