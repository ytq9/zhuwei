import { compileCanonicalCharacterCombat, equippedWeaponMechanicalKey } from "./character-abilities";
import { emptyItemSystemState } from "./items";
import { itemPolicyVisibleToViewer } from "./item-projection";
import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState } from "./model";
import type { ItemDefinitionV1, ItemEntryV1 } from "./items";

export type ItemUniquenessBoundPayload = {
  basisRef: string;
  entryRef: string;
  definitionRef: string;
};
export type ItemIdentifiedPayload = {
  characterId: string;
  entryRef: string;
  definitionRef: string;
  definitionHash: string;
  basisRefs: string[];
};
export type VNextItemAuthority = {
  schema: "zhuwei.vnext-item-authority/v1";
  uniqueItems: Record<string, ItemUniquenessBoundPayload>;
  identifications: Record<string, Record<string, ItemIdentifiedPayload>>;
};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const ref = (value: unknown): value is string => typeof value === "string" && /^\S+$/u.test(value) && value.length <= 4000;
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function isItemUniquenessBoundPayload(value: unknown): value is ItemUniquenessBoundPayload {
  return record(value) && exact(value, ["basisRef", "entryRef", "definitionRef"]) && Object.values(value).every(ref);
}
export function isItemIdentifiedPayload(value: unknown): value is ItemIdentifiedPayload {
  return record(value) && exact(value, ["characterId", "entryRef", "definitionRef", "definitionHash", "basisRefs"])
    && [value.characterId, value.entryRef, value.definitionRef].every(ref)
    && typeof value.definitionHash === "string" && /^sha256:[0-9a-f]{64}$/u.test(value.definitionHash)
    && Array.isArray(value.basisRefs) && value.basisRefs.length > 0 && value.basisRefs.every(ref)
    && new Set(value.basisRefs).size === value.basisRefs.length;
}
export function isVNextItemAuthority(value: unknown): value is VNextItemAuthority {
  return record(value) && exact(value, ["schema", "uniqueItems", "identifications"])
    && value.schema === "zhuwei.vnext-item-authority/v1" && record(value.uniqueItems) && record(value.identifications)
    && Object.entries(value.uniqueItems).every(([key, payload]) => isItemUniquenessBoundPayload(payload) && key === payload.basisRef)
    && Object.entries(value.identifications).every(([characterId, entries]) => record(entries)
      && Object.entries(entries).every(([entryRef, payload]) => isItemIdentifiedPayload(payload)
        && payload.characterId === characterId && payload.entryRef === entryRef));
}
export function emptyVNextItemAuthority(): VNextItemAuthority {
  return { schema: "zhuwei.vnext-item-authority/v1", uniqueItems: {}, identifications: {} };
}
export function uniqueItemEntryRef(basisRef: string): string {
  return `item-entry:unique:${canonicalSha256({ basisRef }).slice(7, 39)}`;
}
/** Metadata participates in the same authority read; it never owns quantity or placement. */
export function authorityItemComposite(state: AuthoritativeWorldState, entryRef: string) {
  const entry = state.campaignRuntime.itemSystem.entries[entryRef];
  if (entry === undefined) return undefined;
  const uniqueIdentity = Object.values(state.vNextItemAuthority?.uniqueItems ?? {}).find(identity => identity.entryRef === entryRef);
  const identifications = Object.entries(state.vNextItemAuthority?.identifications ?? {}).flatMap(([characterId, entries]) =>
    entries[entryRef] === undefined ? [] : [[characterId, entries[entryRef]]]);
  if (uniqueIdentity === undefined && identifications.length === 0) return entry;
  return { ...entry, ...(uniqueIdentity === undefined ? {} : { uniqueIdentity }),
    ...(identifications.length === 0 ? {} : { identifications: Object.fromEntries(identifications.sort(([left], [right]) => String(left).localeCompare(String(right)))) }) };
}
export function itemIdentifiedBy(state: AuthoritativeWorldState, characterId: string, entry: ItemEntryV1, definition: ItemDefinitionV1): boolean {
  const grant = state.vNextItemAuthority?.identifications[characterId]?.[entry.entryId];
  return grant !== undefined && grant.definitionRef === definition.definitionId && grant.definitionHash === canonicalSha256(definition);
}

/** Read only registered abilities belonging to this exact currently equipped
 * source. Catalog presence never grants an ability to its holder. */
export function authorityEquippedItemWeaponAbilityRefs(
  state: AuthoritativeWorldState,
  entryRef: string,
  admitScan: (count: number) => boolean = () => true,
): readonly string[] {
  const entry = state.campaignRuntime.itemSystem.entries[entryRef];
  if (entry?.disposition !== "held" || entry.condition !== "usable" || entry.holderRef === null) return [];
  const definition = state.campaignRuntime.itemSystem.definitions[entry.definitionRef];
  const holder = state.entities[entry.holderRef];
  const combat = state.combatRuntime.entities[entry.holderRef];
  if (definition?.revision !== entry.definitionRevision || definition.content.equipment?.weapon === null
    || definition.content.equipment?.weapon === undefined || holder === undefined || combat === undefined) return [];
  const sourceKeys = new Set((["main", "off"] as const)
    .filter(slot => entry.equippedSlot === slot && holder.loadout?.equipped[slot] === entry.entryId)
    .map(slot => equippedWeaponMechanicalKey(entry.entryId, slot)));
  if (sourceKeys.size === 0) return [];
  const abilityRefs = Array.isArray(combat.abilityRefs) ? combat.abilityRefs : [];
  // Let the context owner reject the scan before work. Its exhausted-budget
  // state must block preparation, never turn this into proof of absence.
  if (!admitScan(abilityRefs.length)) return [];
  return abilityRefs.filter((abilityRef): abilityRef is string => {
    if (typeof abilityRef !== "string") return false;
    const ability = state.combatRuntime.definitions[abilityRef];
    // Returning a broken entitlement lets the existing decisive closure reject
    // it instead of silently interpreting a missing catalog record as absence.
    return ability === undefined || (typeof ability.mechanicalKey === "string" && sourceKeys.has(ability.mechanicalKey));
  });
}

/** Viewer filtering changes presentation only; Rules keep every held ability executable. */
export function hiddenItemPresentation(state: AuthoritativeWorldState, characterId: string): { abilityRefs: Set<string>; resourceRefs: Set<string> } {
  const hidden = { abilityRefs: new Set<string>(), resourceRefs: new Set<string>() };
  if (state.atomicWorldInteractions === undefined) return hidden;
  const character = state.entities[characterId];
  if (character === undefined) return hidden;
  const visibleGrants = new Set<string>();
  for (const entry of Object.values(state.campaignRuntime.itemSystem.entries)) {
    if (entry.disposition !== "held" || entry.holderRef !== characterId) continue;
    const definition = state.campaignRuntime.itemSystem.definitions[entry.definitionRef];
    if (definition === undefined) continue;
    const refs = [...(entry.equippedSlot === null ? [] : definition.content.equippedAbilityRefs),
      ...(definition.content.use === null ? [] : [`${definition.content.use.abilityRef}:entry:${entry.entryId}`])];
    if (itemIdentifiedBy(state, characterId, entry, definition)
      || itemPolicyVisibleToViewer(definition.visibilityPolicyRef, { kind: character.kind, characterId }, entry)) {
      refs.forEach(ref => visibleGrants.add(ref));
    } else {
      hidden.resourceRefs.add(entry.entryId);
      refs.forEach(ref => hidden.abilityRefs.add(ref));
    }
  }
  const combat = state.combatRuntime.entities[characterId];
  const template = typeof combat?.mechanicalDefinitionRef === "string" ? state.combatRuntime.definitions[combat.mechanicalDefinitionRef] : undefined;
  if (record(template?.content) && Array.isArray(template.content.intrinsicAbilityRefs)) {
    template.content.intrinsicAbilityRefs.filter(ref).forEach(ref => visibleGrants.add(ref));
  }
  if (character.kind === "player" && hidden.abilityRefs.size > 0) {
    const intrinsic = compileCanonicalCharacterCombat({ ...character, loadout: {
      armorClass: character.loadout?.armorClass ?? 10, speedFeet: character.loadout?.speedFeet ?? 30, equipped: {}, backpack: [],
    } }, emptyItemSystemState(), {});
    intrinsic.abilityRefs.forEach(ref => visibleGrants.add(ref));
  }
  visibleGrants.forEach(ref => hidden.abilityRefs.delete(ref));
  return hidden;
}
