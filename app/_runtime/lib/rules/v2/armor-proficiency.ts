import type { AuthoritativeWorldState } from "./model";

/** The reason a roll is made with disadvantage in armor worn without its proficiency. */
export const ARMOR_NOT_PROFICIENT_2014 = "armorNotProficient2014";

/** SPEC 0004 §4 (2014): the armor kinds a character wears without the
 * proficiency, read from its equipped body armor and off-hand shield in the
 * item authority. A creature whose record lists no armor proficiencies (an
 * NPC's stat block) wears what it is proficient with. */
export function armorWornWithoutProficiency(state: AuthoritativeWorldState, entityId: string): string[] {
  const record = state.entities[entityId];
  const listed = record?.proficientArmor;
  if (record === undefined || listed === undefined) return [];
  const system = state.campaignRuntime.itemSystem;
  return ["armor", "off"].flatMap((slot) => {
    const entryId = record.loadout?.equipped[slot];
    const entry = entryId === undefined ? undefined : system?.entries[entryId];
    const kind = entry === undefined ? undefined : system.definitions[entry.definitionRef]?.content.equipment?.armor?.kind;
    return kind !== undefined && !listed.includes(kind) ? [kind] : [];
  });
}

/** Disadvantage on a check, save or attack roll that uses Strength or
 * Dexterity while wearing armor without its proficiency. */
export function armorRollDisadvantage(state: AuthoritativeWorldState, entityId: string, ability: string | undefined): string[] {
  const short = ability === "strength" ? "str" : ability === "dexterity" ? "dex" : ability;
  return (short === "str" || short === "dex") && armorWornWithoutProficiency(state, entityId).length > 0
    ? [ARMOR_NOT_PROFICIENT_2014] : [];
}
