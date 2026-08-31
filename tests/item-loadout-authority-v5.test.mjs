import assert from "node:assert/strict";
import test from "node:test";

import { replay, step } from "../app/_runtime/lib/rules/index.ts";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests.ts";
import { initialStandardGearEntryId } from "../app/_runtime/lib/rules/v2/item-transitions.ts";

const ALICE = {
  principalId: "principal:item-loadout-v5:alice",
  seatId: "seat:item-loadout-v5:alice",
  characterId: "character:item-loadout-v5:alice",
};
const SCENE_ID = "scene:item-loadout-v5:camp";

function geometry() {
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
    spawnPoints: [{ x: "120", y: "180", elevation: "0" }],
    obstacles: [{
      featureId: "feature:item-loadout-v5:wall",
      kind: "barrier",
      label: "营地矮墙",
      state: "intact",
      polygon: [
        { x: "360", y: "360" },
        { x: "420", y: "360" },
        { x: "420", y: "480" },
        { x: "360", y: "480" },
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

function initialize() {
  const initialized = step(ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:item-loadout-v5",
    runtimeEpochId: "epoch:item-loadout-v5:1",
    moduleRef: {
      profileId: "module:item-loadout-v5",
      profileHash: `sha256:${"a".repeat(64)}`,
    },
    initialDefinitionCatalogRef: {
      profileId: "definitions:item-loadout-v5",
      profileHash: `sha256:${"b".repeat(64)}`,
    },
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{ id: SCENE_ID, name: "营地", geometry: geometry() }],
    principals: [{ id: ALICE.principalId, sessionVersion: 1, role: "host" }],
    seats: [{ id: ALICE.seatId, principalId: ALICE.principalId, status: "active" }],
    characters: [{
      id: ALICE.characterId,
      kind: "player",
      name: "爱丽丝",
      sceneId: SCENE_ID,
      tenureStatus: "active",
      classId: "fighter",
      raceId: "human",
      level: 3,
      abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
      proficiencyBonus: 2,
      proficientSkills: ["athletics", "perception"],
      expertiseSkills: [],
      proficientSaves: ["str", "con"],
      cantripIds: [],
      preparedSpellIds: [],
      featureIds: [],
      hitPoints: { current: 24, maximum: 24 },
      loadout: {
        armorClass: 11,
        speedFeet: 30,
        equipped: {},
        backpack: [{ itemId: "shield", quantity: 1 }],
      },
      characterBuild: { classId: "fighter", raceId: "human", cantrips: [], prepared: [] },
    }],
    characterControls: [{ characterId: ALICE.characterId, seatId: ALICE.seatId }],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const rebuilt = replay(initialized.genesis, []);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  return {
    genesis: initialized.genesis,
    profiles: initialized.profiles,
    events: [],
    state: rebuilt.state,
  };
}

function commit(scenario, input) {
  const result = step(scenario.profiles, scenario.state, input);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  const events = [...scenario.events, ...result.events];
  const rebuilt = replay(scenario.genesis, events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  return { scenario: { ...scenario, events, state: rebuilt.state }, result };
}

test("V5 gear actions reject static catalog ids and equip only exact authoritative entries", () => {
  let scenario = initialize();
  const rejected = step(scenario.profiles, scenario.state, {
    kind: "changeCharacterGear",
    rootActionId: "root:item-loadout-v5:static-shield",
    controllerPrincipalId: ALICE.principalId,
    actorCharacterId: ALICE.characterId,
    action: "wear",
    slot: "off",
    itemId: "shield",
  });
  assert.equal(rejected.kind, "rejected", JSON.stringify(rejected));
  assert.deepEqual(rejected.events, []);

  const shieldEntryId = initialStandardGearEntryId(ALICE.characterId, "shield", 1);
  const worn = commit(scenario, {
    kind: "changeCharacterGear",
    rootActionId: "root:item-loadout-v5:wear-shield",
    controllerPrincipalId: ALICE.principalId,
    actorCharacterId: ALICE.characterId,
    action: "wear",
    slot: "off",
    itemId: shieldEntryId,
  });
  scenario = worn.scenario;
  assert.equal(scenario.state.entities[ALICE.characterId].loadout.armorClass, 13);
  assert.equal(
    scenario.state.campaignRuntime.itemSystem.entries[shieldEntryId].equippedSlot,
    "off",
  );
});
