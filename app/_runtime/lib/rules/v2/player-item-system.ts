import { GEAR_SLOTS, type GearSlot } from "../../dnd/gear";
import {
  compileAbilityDefinition,
  type CompiledAbilityArtifact,
} from "../profiles/ability-compiler";
import { canonicalSha256 } from "../profiles/canonical";

import { compileCanonicalCharacterCombat } from "./character-abilities";
import {
  acquireItemQuantity,
  changeItemEquipment,
  deriveCharacterLoadoutFromItems,
  mergeInitialStandardLoadout,
} from "./item-transitions";
import {
  createInitialItemEntry,
  isItemSystemStateV1,
  type ItemDefinitionV1,
  type ItemEntryV1,
  type ItemSystemStateV1,
} from "./items";
import type {
  CharacterLoadoutRecord,
  CharacterRecord,
  EventEnvelope,
  EventPayloadByType,
  EventType,
  JsonRecord,
} from "./model";

const SLOT_ORDER = GEAR_SLOTS.map(({ id }) => id);

type TransitionError = { error: string };

export type PlayerInitialItemMaterialization = {
  entry: ItemEntryV1;
  desiredSlot: GearSlot | null;
};

export type PlayerInitialItemAcquisition = {
  sourceEntryId: string;
  targetEntryId: string;
};

export type PlayerInitialGearChange = {
  entryId: string;
  slot: GearSlot;
  armorClass: number;
  abilityArtifacts: CompiledAbilityArtifact[];
};

export type PlayerInitialItemImportPlan = {
  characterBeforeAcquisition: CharacterRecord;
  definitions: ItemDefinitionV1[];
  materializations: PlayerInitialItemMaterialization[];
  acquisitions: PlayerInitialItemAcquisition[];
  gearChanges: PlayerInitialGearChange[];
  finalItemSystem: ItemSystemStateV1;
  finalLoadout: CharacterLoadoutRecord;
};

export type PlayerInitialItemEventDraft = {
  eventType: EventType;
  payload: EventPayloadByType[EventType];
  reads?: string[];
  writes?: string[];
  creates?: string[];
  visibilityPolicyId?: string;
  secrecy?: EventEnvelope["secrecy"];
};

function loadoutBasis(character: CharacterRecord, speedFeet: number) {
  return {
    holderRef: character.id,
    ...(character.classId === undefined ? {} : { classId: character.classId }),
    scores: {
      dex: character.abilityScores?.dex ?? 10,
      con: character.abilityScores?.con ?? 10,
    },
    speedFeet,
  };
}

/**
 * Plans the one-time import of a new player's standard starting equipment.
 * Every entry first exists in the character's scene, is explicitly acquired,
 * and is then explicitly equipped. The character event therefore starts from
 * the loadout derived from the current ItemSystem rather than a second item
 * authority embedded in the submitted character seed.
 */
export function planPlayerInitialItemImport(input: {
  itemSystem: ItemSystemStateV1;
  character: CharacterRecord;
  itemAbilityCatalog: Record<string, JsonRecord>;
}): PlayerInitialItemImportPlan | TransitionError {
  const { character } = input;
  if (!isItemSystemStateV1(input.itemSystem)
    || character.kind !== "player"
    || character.tenureStatus !== "active") {
    return { error: "invalidPlayerItemImport" };
  }
  if (Object.values(input.itemSystem.entries).some((entry) =>
    entry.holderRef === character.id)) {
    return { error: "existingCharacterItems" };
  }

  const submittedLoadout = character.loadout ?? {
    armorClass: 10,
    speedFeet: 30,
    equipped: {},
    backpack: [],
  };
  const merged = mergeInitialStandardLoadout(
    input.itemSystem,
    character.id,
    submittedLoadout,
  );
  if ("error" in merged) return merged;

  const definitions = Object.values(merged.itemSystem.definitions)
    .filter((definition) => input.itemSystem.definitions[definition.definitionId] === undefined)
    .sort((left, right) => left.definitionId.localeCompare(right.definitionId));
  const desiredEntries = Object.values(merged.itemSystem.entries)
    .filter((entry) => entry.disposition === "held" && entry.holderRef === character.id)
    .sort((left, right) => left.entryId.localeCompare(right.entryId));
  if (desiredEntries.some((entry) => input.itemSystem.entries[entry.entryId] !== undefined)) {
    return { error: "itemEntryConflict" };
  }

  const afterMaterialization = structuredClone(input.itemSystem);
  for (const definition of definitions) {
    afterMaterialization.definitions[definition.definitionId] = structuredClone(definition);
  }
  const materializations: PlayerInitialItemMaterialization[] = [];
  for (const desired of desiredEntries) {
    const definition = merged.itemSystem.definitions[desired.definitionRef];
    let entry: ItemEntryV1;
    try {
      entry = createInitialItemEntry(definition, {
        entryId: desired.entryId,
        quantity: desired.quantity,
        placement: { kind: "scene", sceneRef: character.sceneId },
        ownership: { kind: "unowned", ownerRef: null },
      });
    } catch {
      return { error: "invalidPlayerItemMaterialization" };
    }
    afterMaterialization.entries[entry.entryId] = structuredClone(entry);
    materializations.push({ entry, desiredSlot: desired.equippedSlot });
  }
  if (!isItemSystemStateV1(afterMaterialization)) {
    return { error: "invalidPlayerItemMaterialization" };
  }

  const basis = loadoutBasis(character, submittedLoadout.speedFeet);
  const base = deriveCharacterLoadoutFromItems(afterMaterialization, basis);
  if ("error" in base) return base;
  const characterBeforeAcquisition = {
    ...structuredClone(character),
    loadout: base.loadout,
  };

  let current = afterMaterialization;
  const acquisitions: PlayerInitialItemAcquisition[] = [];
  for (const { entry } of materializations) {
    const acquired = acquireItemQuantity(current, {
      entryId: entry.entryId,
      holderRef: character.id,
      quantity: entry.quantity,
    });
    if ("error" in acquired) return acquired;
    if (acquired.targetEntryId !== entry.entryId) {
      return { error: "playerItemAcquisitionMismatch" };
    }
    current = acquired.itemSystem;
    acquisitions.push({
      sourceEntryId: entry.entryId,
      targetEntryId: acquired.targetEntryId,
    });
  }

  const acquiredLoadout = deriveCharacterLoadoutFromItems(current, basis);
  if ("error" in acquiredLoadout) return acquiredLoadout;
  let currentLoadout = acquiredLoadout.loadout;
  const gearChanges: PlayerInitialGearChange[] = [];
  for (const materialization of materializations
    .filter((entry): entry is PlayerInitialItemMaterialization & { desiredSlot: GearSlot } =>
      entry.desiredSlot !== null)
    .sort((left, right) =>
      SLOT_ORDER.indexOf(left.desiredSlot) - SLOT_ORDER.indexOf(right.desiredSlot))) {
    const changed = changeItemEquipment(current, basis, {
      action: "wear",
      entryId: materialization.entry.entryId,
      slot: materialization.desiredSlot,
    });
    if ("error" in changed) return changed;
    const beforeCompiled = compileCanonicalCharacterCombat(
      { ...structuredClone(character), loadout: currentLoadout },
      current,
      input.itemAbilityCatalog,
    );
    const afterCompiled = compileCanonicalCharacterCombat(
      { ...structuredClone(character), loadout: changed.loadout },
      changed.itemSystem,
      input.itemAbilityCatalog,
    );
    const abilityArtifacts: CompiledAbilityArtifact[] = [];
    for (const [definitionId, definition] of Object.entries(afterCompiled.definitions)
      .sort(([left], [right]) => left.localeCompare(right))) {
      const before = beforeCompiled.definitions[definitionId];
      if (before !== undefined) {
        if (canonicalSha256(before) !== canonicalSha256(definition)) {
          return { error: "playerEquipmentAbilityConflict" };
        }
        continue;
      }
      const compiled = compileAbilityDefinition(definition);
      if (!compiled.ok) return { error: "playerEquipmentAbilityInvalid" };
      abilityArtifacts.push(compiled.artifact);
    }
    current = changed.itemSystem;
    currentLoadout = changed.loadout;
    gearChanges.push({
      entryId: changed.movedEntryId,
      slot: materialization.desiredSlot,
      armorClass: changed.loadout.armorClass,
      abilityArtifacts,
    });
  }

  const final = deriveCharacterLoadoutFromItems(current, basis);
  if ("error" in final) return final;
  if (canonicalSha256(current) !== canonicalSha256(merged.itemSystem)) {
    return { error: "playerItemImportMismatch" };
  }
  return {
    characterBeforeAcquisition,
    definitions,
    materializations,
    acquisitions,
    gearChanges,
    finalItemSystem: current,
    finalLoadout: final.loadout,
  };
}

/** Event assembly shared by Seat grant, deferred materialization, and successor creation. */
export function playerInitialItemEventDrafts(
  plan: PlayerInitialItemImportPlan,
  characterId: string,
  sceneId: string,
): PlayerInitialItemEventDraft[] {
  return [
    ...plan.definitions.map((definition): PlayerInitialItemEventDraft => ({
      eventType: "ItemDefinitionRegistered",
      payload: { definition: structuredClone(definition) },
      visibilityPolicyId: definition.visibilityPolicyRef,
      secrecy: definition.visibilityPolicyRef === "visibility:public" ? "public" : "internal",
      creates: [`item-definition:${definition.definitionId}`],
    })),
    ...plan.materializations.map(({ entry }): PlayerInitialItemEventDraft => ({
      eventType: "ItemMaterialized",
      payload: { entry: structuredClone(entry) },
      visibilityPolicyId: entry.visibilityPolicyRef,
      secrecy: entry.visibilityPolicyRef === "visibility:public" ? "public" : "internal",
      reads: [`scene:${sceneId}`, `entity:${characterId}`],
      creates: [`item-entry:${entry.entryId}`],
    })),
    ...plan.acquisitions.map(({ sourceEntryId }): PlayerInitialItemEventDraft => ({
      eventType: "ItemAcquired",
      payload: {
        entryId: sourceEntryId,
        characterId,
        fromSceneId: sceneId,
      },
      visibilityPolicyId: `visibility:character-controller:${characterId}`,
      secrecy: "private",
      reads: [`item-entry:${sourceEntryId}`, `entity:${characterId}`],
      writes: [
        `item-entry:${sourceEntryId}`,
        `entity:${characterId}`,
        `combat-entity:${characterId}`,
      ],
    })),
    ...plan.gearChanges.flatMap((change): PlayerInitialItemEventDraft[] => [
      ...change.abilityArtifacts.map((artifact): PlayerInitialItemEventDraft => ({
        eventType: "DefinitionRegistered",
        payload: structuredClone(artifact),
        visibilityPolicyId: "visibility:room-authority-only",
        secrecy: "internal",
        creates: [`definition:${artifact.definition.definitionId}`],
      })),
      {
        eventType: "CharacterGearChanged",
        payload: {
          characterId,
          action: "wear",
          slot: change.slot,
          itemId: change.entryId,
          armorClass: change.armorClass,
        },
        reads: [`entity:${characterId}`, `control:${characterId}`],
        writes: [`entity:${characterId}`, `combat-entity:${characterId}`],
      },
    ]),
  ];
}
