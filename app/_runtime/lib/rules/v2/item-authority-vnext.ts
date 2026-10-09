import { isRecord } from "./validation";
import { authorityGeometryFeatureComposite } from "./authority-bindings";
import { compileCanonicalCharacterCombat, equippedWeaponMechanicalKey } from "./character-abilities";
import { emptyItemSystemState } from "./items";
import { itemPolicyVisibleToViewer } from "./item-projection";
import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState } from "./model";
import type { ItemDefinitionV1, ItemEntryV1 } from "./items";
import { containedItemAccessible } from "./item-containment";
import { isContainerMemory, isTakenFromContainer, type ContainerMemory, type ContainerOrigin, type TakenFromContainer } from "./container-knowledge";

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
  containerMemories?: Record<string, Record<string, ContainerMemory>>;
  containerOrigins?: Record<string, ContainerOrigin>;
  containerAuthorship?: Record<string, string>;
  /** ADR 0134: by taker, then by the item it holds loose. */
  takenFrom?: Record<string, Record<string, TakenFromContainer>>;
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
  return record(value) && exact(value, ["schema", "uniqueItems", "identifications",
    ...["containerMemories", "containerOrigins", "containerAuthorship", "takenFrom"].filter(key => Object.hasOwn(value, key))])
    && value.schema === "zhuwei.vnext-item-authority/v1" && record(value.uniqueItems) && record(value.identifications)
    && Object.entries(value.uniqueItems).every(([key, payload]) => isItemUniquenessBoundPayload(payload) && key === payload.basisRef)
    && Object.entries(value.identifications).every(([characterId, entries]) => record(entries)
      && Object.entries(entries).every(([entryRef, payload]) => isItemIdentifiedPayload(payload)
        && payload.characterId === characterId && payload.entryRef === entryRef))
    && (value.containerMemories === undefined || record(value.containerMemories) && Object.entries(value.containerMemories).every(([observer, memories]) => record(memories)
      && Object.entries(memories).every(([container, memory]) => isContainerMemory(memory) && memory.observerRef === observer && memory.containerRef === container)))
    && (value.containerOrigins === undefined || record(value.containerOrigins) && Object.values(value.containerOrigins).every(origin => record(origin)
      && exact(origin, ["sourceRef", "eventSeq"]) && ref(origin.sourceRef) && typeof origin.eventSeq === "string" && /^\d+$/.test(origin.eventSeq)))
    && (value.containerAuthorship === undefined || record(value.containerAuthorship) && Object.values(value.containerAuthorship).every(ref))
    && (value.takenFrom === undefined || record(value.takenFrom) && Object.entries(value.takenFrom).every(([observer, taken]) => record(taken)
      && Object.values(taken).every(origin => isTakenFromContainer(origin) && origin.observerRef === observer)));
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
  const containment: { ref: string; revisionOrHash: string }[] = [];
  const seen = new Set([entryRef]);
  for (let ref = entry.containerRef; ref !== undefined;) {
    if (seen.has(ref)) return undefined;
    seen.add(ref);
    const parent = state.campaignRuntime.itemSystem.entries[ref];
    const record = parent ?? state.campaignRuntime.definitions[ref] ?? authorityGeometryFeatureComposite(state, ref);
    if (record === undefined) return undefined;
    containment.push({ ref, revisionOrHash: canonicalSha256(record) });
    ref = parent?.containerRef;
  }
  const containerMemories = Object.values(state.vNextItemAuthority?.containerMemories ?? {}).flatMap(memories => memories[entryRef] ? [memories[entryRef]] : []);
  const containerOrigin = state.vNextItemAuthority?.containerOrigins?.[entryRef];
  const containerAuthorship = state.vNextItemAuthority?.containerAuthorship?.[entryRef];
  const takenFrom = Object.keys(state.vNextItemAuthority?.takenFrom ?? {}).sort()
    .flatMap(observer => { const origin = state.vNextItemAuthority!.takenFrom![observer]![entryRef]; return origin ? [origin] : []; });
  if (uniqueIdentity === undefined && identifications.length === 0 && containment.length === 0
    && containerMemories.length === 0 && containerOrigin === undefined && containerAuthorship === undefined && takenFrom.length === 0) return entry;
  return { ...entry, ...(uniqueIdentity === undefined ? {} : { uniqueIdentity }),
    ...(containerMemories.length ? { containerMemories } : {}), ...(takenFrom.length ? { takenFrom } : {}),
    ...(containerOrigin ? { containerOrigin } : {}), ...(containerAuthorship ? { containerAuthorship } : {}),
    ...(containment.length === 0 ? {} : { containment }),
    ...(identifications.length === 0 ? {} : { identifications: Object.fromEntries(identifications.sort(([left], [right]) => String(left).localeCompare(String(right)))) }) };
}
export function itemIdentifiedBy(state: AuthoritativeWorldState, characterId: string, entry: ItemEntryV1, definition: ItemDefinitionV1): boolean {
  const grant = state.vNextItemAuthority?.identifications[characterId]?.[entry.entryId];
  return grant !== undefined && grant.definitionRef === definition.definitionId && grant.definitionHash === canonicalSha256(definition);
}

/** A grant is knowledge of an immutable definition, attached to this physical
 * identity. Completion cannot erase that memory or extend it to new secrets. */
export function identifiedItemDefinition(state: AuthoritativeWorldState, characterId: string, entry: ItemEntryV1): ItemDefinitionV1 | undefined {
  const grant = state.vNextItemAuthority?.identifications[characterId]?.[entry.entryId];
  const known = grant && state.campaignRuntime.itemSystem.definitions[grant.definitionRef];
  return known && canonicalSha256(known) === grant.definitionHash ? known : undefined;
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
  if (definition?.revision !== entry.definitionRevision || definition.content.equipment == null || holder === undefined || combat === undefined) return [];
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
    return ability === undefined || (isRecord(ability.weaponUse) && ability.weaponUse.entryId === entry.entryId)
      || (typeof ability.mechanicalKey === "string" && sourceKeys.has(ability.mechanicalKey));
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
    if (containedItemAccessible(state.campaignRuntime.itemSystem, entry) && (itemIdentifiedBy(state, characterId, entry, definition)
      || itemPolicyVisibleToViewer(definition.visibilityPolicyRef, { kind: character.kind, characterId }, entry))) {
      refs.forEach(ref => visibleGrants.add(ref));
    } else {
      hidden.resourceRefs.add(entry.entryId);
      refs.forEach(ref => hidden.abilityRefs.add(ref));
      const known = containedItemAccessible(state.campaignRuntime.itemSystem, entry)
        ? identifiedItemDefinition(state, characterId, entry) : undefined;
      if (known) {
        if (entry.equippedSlot !== null) known.content.equippedAbilityRefs.filter(ref => refs.includes(ref)).forEach(ref => visibleGrants.add(ref));
        if (known.content.use?.abilityRef === definition.content.use?.abilityRef && known.content.use) {
          visibleGrants.add(`${known.content.use.abilityRef}:entry:${entry.entryId}`);
        }
      }
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
    } }, emptyItemSystemState(), state.combatRuntime.definitions);
    intrinsic.abilityRefs.forEach(ref => visibleGrants.add(ref));
  }
  visibleGrants.forEach(ref => hidden.abilityRefs.delete(ref));
  return hidden;
}
