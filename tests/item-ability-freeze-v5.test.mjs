import assert from "node:assert/strict";
import test from "node:test";

import { replay, step } from "../app/_runtime/lib/rules/index.ts";
import { compileAbilityDefinition, registeredAbilityRecord } from "../app/_runtime/lib/rules/profiles/ability-compiler.ts";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests.ts";
import {
  compileCanonicalCharacterCombat,
  planPlayerAbilityCatalog,
} from "../app/_runtime/lib/rules/v2/character-abilities.ts";
import {
  createInitialItemEntry,
  ITEM_DEFINITION_CONTENT_SCHEMA,
  ITEM_DEFINITION_SCHEMA,
  ITEM_SYSTEM_STATE_SCHEMA,
} from "../app/_runtime/lib/rules/v2/items.ts";
import { foldEvent } from "../app/_runtime/lib/rules/v2/events.ts";
import { initialStandardGearEntryId } from "../app/_runtime/lib/rules/v2/item-transitions.ts";

const SCENE = "scene:item-ability-freeze-v5:yard";
const ARCHER = "character:item-ability-freeze-v5:archer";
const SUPPLIER = "character:item-ability-freeze-v5:supplier";

function tacticalGeometry() {
  return {
    schema: "zhuwei.tactical-geometry/v1",
    unit: "inch",
    boundary: {
      kind: "polygon",
      points: [
        { x: "0", y: "0" },
        { x: "900", y: "0" },
        { x: "900", y: "600" },
        { x: "0", y: "600" },
      ],
    },
    spawnPoints: [
      { x: "120", y: "180", elevation: "0" },
      { x: "720", y: "180", elevation: "0" },
    ],
    obstacles: [{
      featureId: "feature:item-ability-freeze-v5:yard-wall",
      kind: "barrier",
      label: "靶场矮墙",
      state: "intact",
      polygon: [
        { x: "300", y: "360" },
        { x: "360", y: "360" },
        { x: "360", y: "480" },
        { x: "300", y: "480" },
      ],
      elevation: "0",
      height: "60",
      opaque: false,
      impassable: true,
      cover: "half",
      propagation: "passes",
      terrain: "normal",
      visibilityPolicyId: "visibility:scene-observers",
    }],
    clearanceZones: [],
  };
}

function character(id, name, loadout) {
  return {
    id,
    kind: "player",
    name,
    sceneId: SCENE,
    tenureStatus: "active",
    classId: "fighter",
    raceId: "human",
    level: 2,
    hitPoints: { current: 16, maximum: 16 },
    resources: {},
    resourceMaximums: {},
    abilityScores: { str: 12, dex: 16, con: 12, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    proficientSkills: [],
    expertiseSkills: [],
    proficientSaves: ["str", "con"],
    loadout,
    characterBuild: { classId: "fighter", raceId: "human", cantrips: [], prepared: [] },
  };
}

function initializeAmmoTransfer() {
  const principals = ["archer", "supplier"].map((name) => ({
    id: `principal:item-ability-freeze-v5:${name}`,
    sessionVersion: 1,
    role: name === "archer" ? "host" : "player",
  }));
  const seats = principals.map(({ id }) => ({
    id: id.replace("principal:", "seat:"),
    principalId: id,
    status: "active",
  }));
  const initialized = step(ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:item-ability-freeze-v5",
    runtimeEpochId: "epoch:item-ability-freeze-v5:1",
    moduleRef: { profileId: "module:item-ability-freeze-v5", profileHash: `sha256:${"a".repeat(64)}` },
    initialDefinitionCatalogRef: {
      profileId: "definitions:item-ability-freeze-v5",
      profileHash: `sha256:${"b".repeat(64)}`,
    },
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{ id: SCENE, name: "靶场", geometry: tacticalGeometry() }],
    principals,
    seats,
    characters: [
      character(ARCHER, "弓手", {
        armorClass: 13,
        speedFeet: 30,
        equipped: { main: "longbow" },
        backpack: [],
      }),
      character(SUPPLIER, "补给手", {
        armorClass: 13,
        speedFeet: 30,
        equipped: {},
        backpack: [{ itemId: "arrow", quantity: 2 }],
      }),
    ],
    characterControls: [
      { characterId: ARCHER, seatId: seats[0].id },
      { characterId: SUPPLIER, seatId: seats[1].id },
    ],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const rebuilt = replay(initialized.genesis, []);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  return { genesis: initialized.genesis, profiles: initialized.profiles, state: rebuilt.state };
}

test("V5 registers a newly closed ranged ability before ammunition transfer and replays every prefix", () => {
  const scenario = initializeAmmoTransfer();
  const sourceArrowId = initialStandardGearEntryId(SUPPLIER, "arrow", "stack");
  assert.equal(
    scenario.state.combatRuntime.entities[ARCHER].abilityRefs.some((ref) => ref.includes(":weapon:longbow:")),
    false,
  );

  const transferred = step(scenario.profiles, scenario.state, {
    kind: "transferItem",
    proposalId: "root:item-ability-freeze-v5:give-arrow",
    fromCharacterId: SUPPLIER,
    toCharacterId: ARCHER,
    itemId: sourceArrowId,
    quantity: 1,
    method: "补给手把箭交给弓手",
    ownershipDisposition: "preserve",
  });
  assert.equal(transferred.kind, "committed", JSON.stringify(transferred));
  const transferIndex = transferred.events.findIndex(({ eventType }) => eventType === "ItemTransferred");
  const registrationIndex = transferred.events.findIndex(({ eventType }) =>
    eventType === "DefinitionRegistered");
  assert.ok(
    registrationIndex >= 0 && registrationIndex < transferIndex,
    JSON.stringify(transferred.events.map(({ eventType, payload }) => ({ eventType, definitionId: payload.definition?.definitionId }))),
  );
  const abilityRef = transferred.events[registrationIndex].payload.definition.definitionId;
  assert.ok(transferred.state.combatRuntime.entities[ARCHER].abilityRefs.includes(abilityRef));
  const targetEntryId = transferred.events[transferIndex].payload.targetItemId;
  assert.equal(
    transferred.state.campaignRuntime.itemSystem.entries[targetEntryId].visibilityPolicyRef,
    `visibility:character-controller:${ARCHER}`,
  );
  assert.equal(
    transferred.state.combatRuntime.definitions[abilityRef].definitionId,
    abilityRef,
  );

  for (let length = 1; length <= transferred.events.length; length += 1) {
    const rebuilt = replay(scenario.genesis, transferred.events.slice(0, length));
    assert.equal(rebuilt.kind, "replayed", `${length}: ${JSON.stringify(rebuilt)}`);
  }
  assert.throws(
    () => foldEvent(scenario.state, transferred.events[transferIndex]),
    /not frozen in the authoritative catalog/,
    "ItemTransferred itself must fail closed instead of synthesizing the missing ability",
  );

  const merged = step(scenario.profiles, transferred.state, {
    kind: "transferItem",
    proposalId: "root:item-ability-freeze-v5:give-second-arrow",
    fromCharacterId: SUPPLIER,
    toCharacterId: ARCHER,
    itemId: sourceArrowId,
    quantity: 1,
    method: "补给手把第二支箭交给弓手",
    ownershipDisposition: "preserve",
  });
  assert.equal(merged.kind, "committed", JSON.stringify(merged));
  const mergedTransfer = merged.events.find(({ eventType }) => eventType === "ItemTransferred");
  assert.equal(mergedTransfer.payload.targetItemId, targetEntryId);
  assert.equal(merged.state.campaignRuntime.itemSystem.entries[targetEntryId].quantity, 2);
});

test("equipped item abilities are included only when their portable definition is already frozen", () => {
  const abilityRef = "ability:item-ability-freeze-v5:portable-flare";
  const rawAbility = {
    definitionId: abilityRef,
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "attack", actionGrant: "attack" },
    target: { kind: "creature", count: "1", rangeInches: "600", requiresSight: true },
    attack: { ability: "dex", proficiency: true },
    damage: [{ type: "fire", formula: "1d4" }],
  };
  const compiledAbility = compileAbilityDefinition(rawAbility);
  assert.equal(compiledAbility.ok, true, JSON.stringify(compiledAbility));
  const definition = {
    schema: ITEM_DEFINITION_SCHEMA,
    definitionKind: "item",
    definitionId: "item-definition:item-ability-freeze-v5:flare-ring",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    causalBasisRefs: [],
    visibilityPolicyRef: "visibility:public",
    content: {
      schema: ITEM_DEFINITION_CONTENT_SCHEMA,
      label: "焰光戒指",
      description: "佩戴者可释放一束已冻结的焰光。",
      category: "equipment",
      aliases: [],
      tags: ["ring"],
      stackable: false,
      equipment: { allowedSlots: ["ring1"], twoHanded: false, armor: null, weapon: null },
      equippedAbilityRefs: [abilityRef],
      use: null,
      chargesMaximum: null,
      durabilityMaximum: null,
    },
  };
  const entry = createInitialItemEntry(definition, {
    entryId: "item-entry:item-ability-freeze-v5:flare-ring",
    quantity: 1,
    placement: { kind: "held", holderRef: ARCHER, equippedSlot: "ring1" },
    ownership: { kind: "character", ownerRef: ARCHER },
  });
  const itemSystem = {
    schema: ITEM_SYSTEM_STATE_SCHEMA,
    definitions: { [definition.definitionId]: definition },
    entries: { [entry.entryId]: entry },
  };
  const player = character(ARCHER, "弓手", {
    armorClass: 13,
    speedFeet: 30,
    equipped: { ring1: entry.entryId },
    backpack: [],
  });
  const compiled = compileCanonicalCharacterCombat(player, itemSystem, {});
  assert.ok(compiled.abilityRefs.includes(abilityRef));
  assert.equal(compiled.definitions[abilityRef], undefined);

  const frozenCatalog = {
    ...structuredClone(compiled.definitions),
    [abilityRef]: registeredAbilityRecord(compiledAbility.artifact),
  };
  const accepted = planPlayerAbilityCatalog({ character: player, itemSystem, catalog: frozenCatalog });
  assert.equal("error" in accepted, false, JSON.stringify(accepted));
  const rejected = planPlayerAbilityCatalog({
    character: player,
    itemSystem,
    catalog: compiled.definitions,
  });
  assert.deepEqual(rejected, { error: "portableItemAbilityUnavailable" });
});
