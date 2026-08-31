import {
  GEAR_SLOTS,
  itemById,
  type GearSlot,
} from "../../dnd/gear";
import { canonicalSha256 } from "../profiles/canonical";

import { compileEquippedWeaponAbility } from "./character-abilities";
import {
  acquireItemQuantity,
  changeItemEquipment,
  changeItemLifecycle,
  deriveCharacterLoadoutFromItems,
  itemEntryGearResolver,
  type ItemLifecycleAction,
} from "./item-transitions";
import {
  createInitialItemEntry,
  isItemDefinitionV1,
  isItemSystemStateV1,
  itemEntryUseAbilityDefinition,
  itemDefinitionFromStandardGear,
  itemEntryResourceId,
  itemUseBaseAbilityDefinition,
  type ItemDefinitionV1,
  type ItemEntryV1,
  type ItemSystemStateV1,
} from "./items";
import type {
  CharacterLoadoutRecord,
  CharacterRecord,
  JsonRecord,
} from "./model";
import { isNonEmptyString, isRecord } from "./validation";

const NPC_MECHANICAL_TEMPLATE_SCHEMA = "zhuwei.npc-mechanical-template/v1";
const SLOT_ORDER = GEAR_SLOTS.map(({ id }) => id);

type TransitionError = { error: string };

export type NpcItemSystemEquipment = {
  definitions: JsonRecord[];
  refs: string[];
};

export type NpcInitialItemMaterialization = {
  entry: ItemEntryV1;
  desiredSlot: GearSlot | null;
};

export type NpcInitialItemAcquisition = {
  sourceEntryId: string;
  targetEntryId: string;
};

export type NpcInitialGearChange = {
  entryId: string;
  slot: GearSlot;
  armorClass: number;
  equipment: NpcItemSystemEquipment;
};

export type NpcInitialItemImportPlan = {
  definitions: ItemDefinitionV1[];
  materializations: NpcInitialItemMaterialization[];
  acquisitions: NpcInitialItemAcquisition[];
  itemSystemAfterMaterialization: ItemSystemStateV1;
  loadoutBeforeAcquisition: CharacterLoadoutRecord;
  gearChanges: NpcInitialGearChange[];
  finalItemSystem: ItemSystemStateV1;
  finalLoadout: CharacterLoadoutRecord;
};

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

function templateContent(value: unknown): JsonRecord | undefined {
  return isRecord(value)
    && isRecord(value.content)
    && value.content.schema === NPC_MECHANICAL_TEMPLATE_SCHEMA
    ? value.content
    : undefined;
}

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function equippedAmmunitionResourceId(
  character: CharacterRecord,
  itemSystem: ItemSystemStateV1,
  ammunitionDefinitionRef: string,
): string | undefined {
  const entryId = character.loadout?.equipped.ammo;
  const entry = entryId === undefined ? undefined : itemSystem.entries[entryId];
  return entry?.disposition === "held"
    && entry.holderRef === character.id
    && entry.condition === "usable"
    && entry.equippedSlot === "ammo"
    && entry.definitionRef === ammunitionDefinitionRef
    ? itemEntryResourceId(entry.entryId)
    : undefined;
}

/** Compiles current NPC equipment directly from the unified item authority. */
export function npcItemSystemEquipmentMechanics(
  character: CharacterRecord,
  itemSystem: ItemSystemStateV1,
): NpcItemSystemEquipment {
  if (!isItemSystemStateV1(itemSystem)) {
    throw new TypeError("NPC item system is invalid");
  }
  const definitions: JsonRecord[] = [];
  const refs = new Set<string>();
  const resolveItem = itemEntryGearResolver(itemSystem);
  for (const slot of ["main", "off"] as const) {
    const entryId = character.loadout?.equipped[slot];
    const entry = entryId === undefined ? undefined : itemSystem.entries[entryId];
    const itemDefinition = entry === undefined
      ? undefined
      : itemSystem.definitions[entry.definitionRef];
    if (entry === undefined
      || itemDefinition === undefined
      || entry.disposition !== "held"
      || entry.holderRef !== character.id
      || entry.condition !== "usable") continue;
    const weapon = compileEquippedWeaponAbility(
      character,
      resolveItem,
      slot,
      (ammunitionDefinitionRef) => equippedAmmunitionResourceId(
        character,
        itemSystem,
        ammunitionDefinitionRef,
      ),
    );
    if (weapon !== undefined) {
      definitions.push(weapon);
      refs.add(String(weapon.definitionId));
    }
  }
  for (const entryId of Object.values(character.loadout?.equipped ?? {})) {
    const entry = itemSystem.entries[entryId];
    const definition = entry === undefined
      ? undefined
      : itemSystem.definitions[entry.definitionRef];
    if (entry?.disposition !== "held"
      || entry.holderRef !== character.id
      || entry.condition !== "usable"
      || definition === undefined) continue;
    for (const abilityRef of definition.content.equippedAbilityRefs) refs.add(abilityRef);
  }
  for (const entry of Object.values(itemSystem.entries)
    .sort((left, right) => left.entryId.localeCompare(right.entryId))) {
    const definition = itemSystem.definitions[entry.definitionRef];
    const use = definition?.content.use;
    const baseAbility = definition === undefined
      ? undefined
      : itemUseBaseAbilityDefinition(definition, {});
    if (entry.disposition !== "held"
      || entry.holderRef !== character.id
      || entry.condition !== "usable"
      || definition === undefined
      || definition.revision !== entry.definitionRevision
      || use === undefined
      || use === null
      || baseAbility === undefined
      || entry.quantity < use.quantityCost
      || (use.chargeCost > 0
        && (entry.charges === null || entry.charges.current < use.chargeCost))
      || (use.durabilityCost > 0
        && (entry.durability === null || entry.durability.current < use.durabilityCost))) continue;
    const ability = itemEntryUseAbilityDefinition(definition, entry.entryId, baseAbility);
    definitions.push(ability);
    refs.add(String(ability.definitionId));
  }
  definitions.sort((left, right) =>
    String(left.definitionId).localeCompare(String(right.definitionId)));
  return { definitions, refs: [...refs].sort() };
}

export function deriveNpcItemSystemLoadout(
  itemSystem: ItemSystemStateV1,
  character: CharacterRecord,
  definition: JsonRecord,
): { loadout: CharacterLoadoutRecord } | TransitionError {
  const content = templateContent(definition);
  if (content === undefined || !isRecord(content.armorClassModel)) {
    return { error: "npcMechanicalTemplateUnavailable" };
  }
  const walkInches = isRecord(content.speedInches)
    ? Number(content.speedInches.walk)
    : 360;
  const derived = deriveCharacterLoadoutFromItems(itemSystem, {
    holderRef: character.id,
    scores: { dex: character.abilityScores?.dex ?? Number((content.stats as JsonRecord).dex) },
    speedFeet: Number.isSafeInteger(walkInches) && walkInches > 0
      ? Math.max(1, Math.floor(walkInches / 12))
      : 30,
  });
  if ("error" in derived) return derived;
  const resolveItem = itemEntryGearResolver(itemSystem);
  const armor = resolveItem(derived.loadout.equipped.armor);
  const dexterity = abilityModifier(
    character.abilityScores?.dex ?? Number((content.stats as JsonRecord).dex),
  );
  const base = Number(content.armorClassModel.baseArmorClass);
  if (!Number.isSafeInteger(base)) return { error: "npcArmorClassUnavailable" };
  const wornArmor = armor?.armor !== undefined
    && armor.armor !== "shield"
    && armor.acBase !== undefined
    ? armor.acBase + (armor.acDexCap === 0
      ? 0
      : Math.min(dexterity, armor.acDexCap ?? 0))
    : base;
  const shield = resolveItem(derived.loadout.equipped.off)?.armor === "shield" ? 2 : 0;
  return {
    loadout: {
      ...derived.loadout,
      armorClass: Math.max(base, wornArmor) + shield,
    },
  };
}

export function changeNpcItemSystemEquipment(
  itemSystem: ItemSystemStateV1,
  character: CharacterRecord,
  definition: JsonRecord,
  action: { action: "wear"; entryId: string; slot: GearSlot }
    | { action: "stow"; slot: GearSlot },
): {
  itemSystem: ItemSystemStateV1;
  loadout: CharacterLoadoutRecord;
  movedEntryId: string;
  equipment: NpcItemSystemEquipment;
} | TransitionError {
  const changed = changeItemEquipment(itemSystem, {
    holderRef: character.id,
    scores: { dex: character.abilityScores?.dex ?? 10 },
    speedFeet: character.loadout?.speedFeet ?? 30,
  }, action);
  if ("error" in changed) return changed;
  const derived = deriveNpcItemSystemLoadout(
    changed.itemSystem,
    { ...structuredClone(character), loadout: changed.loadout },
    definition,
  );
  if ("error" in derived) return derived;
  const nextCharacter = { ...structuredClone(character), loadout: derived.loadout };
  return {
    itemSystem: changed.itemSystem,
    loadout: derived.loadout,
    movedEntryId: changed.movedEntryId,
    equipment: npcItemSystemEquipmentMechanics(nextCharacter, changed.itemSystem),
  };
}

export function changeNpcItemSystemLifecycle(
  itemSystem: ItemSystemStateV1,
  character: CharacterRecord,
  definition: JsonRecord,
  entryId: string,
  action: ItemLifecycleAction,
): {
  itemSystem: ItemSystemStateV1;
  loadout: CharacterLoadoutRecord;
  equipment: NpcItemSystemEquipment;
} | TransitionError {
  const changed = changeItemLifecycle(itemSystem, {
    entryId,
    action,
    holderRef: character.id,
  });
  if ("error" in changed) return changed;
  const derived = deriveNpcItemSystemLoadout(changed.itemSystem, character, definition);
  if ("error" in derived) return derived;
  const nextCharacter = { ...structuredClone(character), loadout: derived.loadout };
  return {
    itemSystem: changed.itemSystem,
    loadout: derived.loadout,
    equipment: npcItemSystemEquipmentMechanics(nextCharacter, changed.itemSystem),
  };
}

function initialEntryId(
  entityId: string,
  templateDefinitionId: string,
  identities: string[],
): string {
  return `item-entry:npc-initial:${canonicalSha256({
    entityId,
    identities: [...identities].sort(),
    templateDefinitionId,
  }).slice("sha256:".length)}`;
}

function addDefinition(
  itemSystem: ItemSystemStateV1,
  definition: ItemDefinitionV1,
  additions: Map<string, ItemDefinitionV1>,
): boolean {
  const existing = itemSystem.definitions[definition.definitionId]
    ?? additions.get(definition.definitionId);
  if (existing !== undefined) return sameJson(existing, definition);
  additions.set(definition.definitionId, definition);
  return true;
}

/**
 * Plans the one-time template inventory import as scene materialization,
 * acquisition, then explicit equipment changes. The returned states are pure
 * simulations used to freeze each event payload; reducers remain authoritative.
 */
export function planNpcInitialItemImport(input: {
  itemSystem: ItemSystemStateV1;
  character: CharacterRecord;
  definition: JsonRecord;
  catalog: Record<string, JsonRecord>;
  sceneId: string;
}): NpcInitialItemImportPlan | TransitionError {
  if (!isItemSystemStateV1(input.itemSystem)
    || !isNonEmptyString(input.character.id)
    || !isNonEmptyString(input.sceneId)) return { error: "invalidNpcItemImport" };
  const content = templateContent(input.definition);
  const initialLoadout = content?.initialLoadout;
  if (!isRecord(initialLoadout) || !Array.isArray(initialLoadout.entries)) {
    return { error: "npcInitialLoadoutUnavailable" };
  }

  const additions = new Map<string, ItemDefinitionV1>();
  const blueprints = new Map<string, {
    definition: ItemDefinitionV1;
    identities: string[];
    quantity: number;
    desiredSlot: GearSlot | null;
  }>();
  for (const raw of initialLoadout.entries) {
    if (!isRecord(raw) || !isRecord(raw.source) || !isNonEmptyString(raw.entryId)) {
      return { error: "invalidNpcInitialLoadout" };
    }
    const source = raw.source;
    let definition: ItemDefinitionV1;
    if (source.kind === "standardGear") {
      const standard = itemById(String(source.ref));
      if (standard === undefined) return { error: "unknownStandardGear" };
      definition = itemDefinitionFromStandardGear(standard);
    } else if (source.kind === "itemDefinition") {
      const candidate = input.catalog[String(source.ref)];
      if (!isItemDefinitionV1(candidate)
        || candidate.definitionId !== source.ref) return { error: "itemDefinitionUnavailable" };
      definition = structuredClone(candidate);
    } else {
      return { error: "itemDefinitionUnavailable" };
    }
    if (!addDefinition(input.itemSystem, definition, additions)) {
      return { error: "itemDefinitionConflict" };
    }
    const quantity = Number(raw.quantity);
    const desiredSlot = raw.equippedSlot === null
      ? null
      : raw.equippedSlot as GearSlot;
    const groupingKey = definition.content.stackable
      ? definition.definitionId
      : `${definition.definitionId}\u0000${String(raw.entryId)}`;
    const existing = blueprints.get(groupingKey);
    if (existing === undefined) {
      blueprints.set(groupingKey, {
        definition,
        identities: [String(raw.entryId)],
        quantity,
        desiredSlot,
      });
    } else {
      if (!definition.content.stackable
        || (existing.desiredSlot !== null
          && desiredSlot !== null
          && existing.desiredSlot !== desiredSlot)) {
        return { error: "invalidNpcInitialLoadout" };
      }
      existing.identities.push(String(raw.entryId));
      existing.quantity += quantity;
      if (desiredSlot !== null) existing.desiredSlot = desiredSlot;
    }
  }

  const afterMaterialization = structuredClone(input.itemSystem);
  for (const definition of additions.values()) {
    afterMaterialization.definitions[definition.definitionId] = structuredClone(definition);
  }
  const materializations: NpcInitialItemMaterialization[] = [];
  for (const blueprint of [...blueprints.values()].sort((left, right) =>
    left.identities[0].localeCompare(right.identities[0]))) {
    let entry: ItemEntryV1;
    try {
      entry = createInitialItemEntry(blueprint.definition, {
        entryId: initialEntryId(
          input.character.id,
          String(input.definition.definitionId),
          blueprint.identities,
        ),
        quantity: blueprint.quantity,
        placement: { kind: "scene", sceneRef: input.sceneId },
        ownership: { kind: "unowned", ownerRef: null },
      });
    } catch {
      return { error: "invalidNpcInitialLoadout" };
    }
    if (afterMaterialization.entries[entry.entryId] !== undefined) {
      return { error: "itemEntryConflict" };
    }
    afterMaterialization.entries[entry.entryId] = structuredClone(entry);
    materializations.push({ entry, desiredSlot: blueprint.desiredSlot });
  }
  if (!isItemSystemStateV1(afterMaterialization)) {
    return { error: "invalidNpcItemMaterialization" };
  }
  const base = deriveNpcItemSystemLoadout(
    afterMaterialization,
    input.character,
    input.definition,
  );
  if ("error" in base) return base;

  let current = afterMaterialization;
  const acquisitions: NpcInitialItemAcquisition[] = [];
  const acquiredEntryBySource = new Map<string, string>();
  for (const { entry } of materializations) {
    const acquired = acquireItemQuantity(current, {
      entryId: entry.entryId,
      holderRef: input.character.id,
      quantity: entry.quantity,
    });
    if ("error" in acquired) return acquired;
    current = acquired.itemSystem;
    acquisitions.push({ sourceEntryId: entry.entryId, targetEntryId: acquired.targetEntryId });
    acquiredEntryBySource.set(entry.entryId, acquired.targetEntryId);
  }
  let currentLoadoutResult = deriveNpcItemSystemLoadout(current, input.character, input.definition);
  if ("error" in currentLoadoutResult) return currentLoadoutResult;
  let currentLoadout = currentLoadoutResult.loadout;
  const desired = materializations
    .filter((entry): entry is NpcInitialItemMaterialization & { desiredSlot: GearSlot } =>
      entry.desiredSlot !== null)
    .sort((left, right) => SLOT_ORDER.indexOf(left.desiredSlot) - SLOT_ORDER.indexOf(right.desiredSlot));
  const gearChanges: NpcInitialGearChange[] = [];
  for (const materialization of desired) {
    const entryId = acquiredEntryBySource.get(materialization.entry.entryId);
    if (entryId === undefined) return { error: "npcItemAcquisitionMismatch" };
    const changed = changeNpcItemSystemEquipment(
      current,
      { ...structuredClone(input.character), loadout: currentLoadout },
      input.definition,
      { action: "wear", entryId, slot: materialization.desiredSlot },
    );
    if ("error" in changed) return changed;
    current = changed.itemSystem;
    currentLoadout = changed.loadout;
    gearChanges.push({
      entryId: changed.movedEntryId,
      slot: materialization.desiredSlot,
      armorClass: changed.loadout.armorClass,
      equipment: changed.equipment,
    });
  }
  return {
    definitions: [...additions.values()].sort((left, right) =>
      left.definitionId.localeCompare(right.definitionId)),
    materializations,
    acquisitions,
    itemSystemAfterMaterialization: afterMaterialization,
    loadoutBeforeAcquisition: base.loadout,
    gearChanges,
    finalItemSystem: current,
    finalLoadout: currentLoadout,
  };
}
