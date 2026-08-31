import assert from "node:assert/strict";
import test from "node:test";

import { project, replay, step } from "../app/_runtime/lib/rules/index.ts";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests.ts";
import { initialStandardGearEntryId } from "../app/_runtime/lib/rules/v2/item-transitions.ts";

const ALICE = {
  principalId: "principal:player-items-v5:alice",
  seatId: "seat:player-items-v5:alice",
  characterId: "character:player-items-v5:alice",
};
const BOB = {
  principalId: "principal:player-items-v5:bob",
  seatId: "seat:player-items-v5:bob",
  characterId: "character:player-items-v5:bob",
};
const SUCCESSOR = {
  ...ALICE,
  characterId: "character:player-items-v5:alice-successor",
};
const SCENE = "scene:player-items-v5:yard";

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
      featureId: "feature:player-items-v5:yard-wall",
      kind: "barrier",
      label: "庭院矮墙",
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

function viewer(person) {
  return {
    kind: "player",
    principalId: person.principalId,
    sessionVersion: 1,
    seatId: person.seatId,
    characterId: person.characterId,
  };
}

function characterSeed(characterId, name) {
  return {
    id: characterId,
    kind: "player",
    name,
    sceneId: SCENE,
    tenureStatus: "active",
    classId: "fighter",
    raceId: "human",
    level: 3,
    hitPoints: { current: 24, maximum: 24 },
    resources: { "resource:second-wind": 1 },
    resourceMaximums: { "resource:second-wind": 1 },
    abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 13, cha: 8 },
    proficiencyBonus: 2,
    proficientSkills: ["athletics", "perception"],
    expertiseSkills: [],
    proficientSaves: ["str", "con"],
    cantripIds: [],
    preparedSpellIds: [],
    featureIds: [],
    loadout: {
      armorClass: 1,
      speedFeet: 30,
      equipped: { armor: "chain", main: "warhammer", off: "shield" },
      backpack: [{ itemId: "explorer-pack", quantity: 2 }],
    },
    characterBuild: {
      classId: "fighter",
      raceId: "human",
      cantrips: [],
      prepared: [],
    },
  };
}

function initialize() {
  const initialized = step(ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:player-initial-items-v5",
    runtimeEpochId: "epoch:player-initial-items-v5:1",
    moduleRef: {
      profileId: "module:player-initial-items-v5",
      profileHash: `sha256:${"a".repeat(64)}`,
    },
    initialDefinitionCatalogRef: {
      profileId: "definitions:player-initial-items-v5",
      profileHash: `sha256:${"b".repeat(64)}`,
    },
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{ id: SCENE, name: "演武庭院", geometry: tacticalGeometry() }],
    principals: [{ id: ALICE.principalId, sessionVersion: 1, role: "host" }],
    seats: [{ id: ALICE.seatId, principalId: ALICE.principalId, status: "active" }],
    characters: [{
      ...characterSeed(ALICE.characterId, "阿莱莎"),
      loadout: { armorClass: 11, speedFeet: 30, equipped: {}, backpack: [] },
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
  return {
    scenario: { ...scenario, events, state: rebuilt.state },
    result,
  };
}

function administration(scenario, commandId, command) {
  return {
    kind: "applyRoomAdministration",
    roomAdministration: {
      kind: "roomAdministration",
      capability: scenario.state.multiplayerRuntime.roomAdministrationCapability,
    },
    commandId,
    command,
  };
}

function assertImportEventOrder(events, leadingEventTypes) {
  const types = events.map(({ eventType }) => eventType);
  assert.deepEqual(types.slice(0, leadingEventTypes.length), leadingEventTypes);
  const remainder = types.slice(leadingEventTypes.length);
  const groups = [
    ["ItemDefinitionRegistered", 4],
    ["ItemMaterialized", 5],
    ["ItemAcquired", 5],
  ];
  let offset = 0;
  for (const [eventType, count] of groups) {
    assert.deepEqual(remainder.slice(offset, offset + count), Array(count).fill(eventType));
    offset += count;
  }
  const equipmentEvents = remainder.slice(offset);
  assert.equal(
    equipmentEvents.filter((eventType) => eventType === "CharacterGearChanged").length,
    3,
  );
  assert.ok(equipmentEvents.every((eventType, index) =>
    eventType === "CharacterGearChanged"
    || (eventType === "DefinitionRegistered"
      && equipmentEvents[index + 1] === "CharacterGearChanged")));
}

function assertFinalInventory(scenario, person) {
  const expected = {
    armor: initialStandardGearEntryId(person.characterId, "chain", 1),
    main: initialStandardGearEntryId(person.characterId, "warhammer", 1),
    off: initialStandardGearEntryId(person.characterId, "shield", 1),
  };
  const packEntryIds = [1, 2].map((ordinal) =>
    initialStandardGearEntryId(person.characterId, "explorer-pack", ordinal));
  const character = scenario.state.entities[person.characterId];
  assert.deepEqual(character.loadout, {
    armorClass: 19,
    speedFeet: 30,
    equipped: expected,
    backpack: packEntryIds.map((itemId) => ({ itemId, quantity: 1 })),
  });
  assert.equal(character.loadout.mechanicalItems, undefined);
  assert.deepEqual(
    Object.values(scenario.state.campaignRuntime.itemSystem.entries)
      .filter((entry) => entry.disposition === "held" && entry.holderRef === person.characterId)
      .map((entry) => entry.entryId)
      .sort(),
    [...Object.values(expected), ...packEntryIds].sort(),
  );
  const projected = project(scenario.profiles, scenario.state, viewer(person));
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  assert.deepEqual(
    projected.controlledCharacter.inventory.entries.reduce((totals, { name, quantity }) => ({
      ...totals,
      [name]: (totals[name] ?? 0) + quantity,
    }), {}),
    { 链甲: 1, 战锤: 1, 盾牌: 1, 探险者套装: 2 },
  );
}

function assertEveryPrefixReplaysAndProjects(scenarioBefore, result, person) {
  for (let index = 1; index <= result.events.length; index += 1) {
    const rebuilt = replay(
      scenarioBefore.genesis,
      [...scenarioBefore.events, ...result.events.slice(0, index)],
    );
    assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
    const controlled = rebuilt.state.characterControls[person.characterId] !== undefined;
    const read = project(
      scenarioBefore.profiles,
      rebuilt.state,
      viewer(controlled ? person : ALICE),
    );
    assert.equal(read.kind, "projected", `${result.events[index - 1].eventType}: ${JSON.stringify(read)}`);
  }
}

test("V5 grantSeat imports a new player's standard gear through explicit item events", () => {
  const before = initialize();
  const committed = commit(before, administration(before, "admin:player-items-v5:grant-bob", {
    kind: "grantSeat",
    principal: { id: BOB.principalId, sessionVersion: 1 },
    role: "player",
    seatId: BOB.seatId,
    character: characterSeed(BOB.characterId, "布拉姆"),
  }));
  assertImportEventOrder(committed.result.events, [
    "MemberJoined",
    "SeatGranted",
    "CharacterControlGranted",
  ]);
  assert.deepEqual(committed.result.events[2].payload.character.loadout, {
    armorClass: 11,
    speedFeet: 30,
    equipped: {},
    backpack: [],
  });
  assertEveryPrefixReplaysAndProjects(before, committed.result, BOB);
  assertFinalInventory(committed.scenario, BOB);
});

test("V5 materializeCharacter uses the same explicit initial item import", () => {
  let scenario = initialize();
  scenario = commit(scenario, administration(scenario, "admin:player-items-v5:seat-bob", {
    kind: "grantSeat",
    principal: { id: BOB.principalId, sessionVersion: 1 },
    role: "player",
    seatId: BOB.seatId,
  })).scenario;
  const before = scenario;
  const committed = commit(before, administration(before, "admin:player-items-v5:materialize-bob", {
    kind: "materializeCharacter",
    principalId: BOB.principalId,
    seatId: BOB.seatId,
    character: characterSeed(BOB.characterId, "布拉姆"),
  }));
  assertImportEventOrder(committed.result.events, [
    "CharacterControlGranted",
  ]);
  assertEveryPrefixReplaysAndProjects(before, committed.result, BOB);
  assertFinalInventory(committed.scenario, BOB);
});

test("V5 successor creation imports only the successor's submitted standard starting gear", () => {
  let scenario = initialize();
  scenario = commit(scenario, {
    kind: "retireCharacter",
    proposalId: "proposal:player-items-v5:retire-alice",
    characterId: ALICE.characterId,
    reason: "阿莱莎选择留在庭院担任教官",
    continueAsNpc: false,
  }).scenario;
  const before = scenario;
  const committed = commit(before, {
    kind: "introduceSuccessor",
    proposalId: "proposal:player-items-v5:introduce-successor",
    controllerPrincipalId: ALICE.principalId,
    predecessorCharacterId: ALICE.characterId,
    successor: characterSeed(SUCCESSOR.characterId, "苍岚"),
    worldEntry: "受演武院邀请来到庭院",
  });
  assertImportEventOrder(committed.result.events, [
    "SuccessorIntroduced",
  ]);
  assertEveryPrefixReplaysAndProjects(before, committed.result, SUCCESSOR);
  assertFinalInventory(committed.scenario, SUCCESSOR);
  assert.deepEqual(
    Object.values(committed.scenario.state.campaignRuntime.itemSystem.entries)
      .filter((entry) => entry.holderRef === ALICE.characterId),
    [],
  );
});

test("V5 rejects unknown and mechanicalItems starting equipment without partial events", () => {
  const scenario = initialize();
  for (const loadout of [
    {
      armorClass: 10,
      speedFeet: 30,
      equipped: {},
      backpack: [{ itemId: "unknown:future-item", quantity: 1 }],
    },
    {
      armorClass: 10,
      speedFeet: 30,
      equipped: {},
      backpack: [{ itemId: "explorer-pack", quantity: 1 }],
      mechanicalItems: {
        "legacy:item": {
          sourceKind: "standardGear",
          definitionRef: "explorer-pack",
          status: "usable",
        },
      },
    },
  ]) {
    const rejected = step(scenario.profiles, scenario.state, administration(
      scenario,
      `admin:player-items-v5:reject:${Object.keys(loadout).length}:${loadout.backpack[0].itemId}`,
      {
        kind: "grantSeat",
        principal: { id: BOB.principalId, sessionVersion: 1 },
        role: "player",
        seatId: BOB.seatId,
        character: { ...characterSeed(BOB.characterId, "布拉姆"), loadout },
      },
    ));
    assert.equal(rejected.kind, "rejected", JSON.stringify(rejected));
    assert.deepEqual(rejected.events, []);
  }
});
