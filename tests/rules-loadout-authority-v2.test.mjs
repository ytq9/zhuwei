import assert from "node:assert/strict";
import test from "node:test";

import { project, replay, step } from "../app/_runtime/lib/rules/index.ts";

const ALICE = {
  principalId: "principal:loadout:alice",
  seatId: "seat:loadout:alice",
  characterId: "character:loadout:alice",
};

function profileRef(profileId, digit) {
  return { profileId, profileHash: `sha256:${digit.repeat(64)}` };
}

function start(loadout = {
  armorClass: 17,
  speedFeet: 30,
  equipped: { armor: "chain" },
  backpack: [
    { itemId: "dagger", quantity: 1 },
    { itemId: "shield", quantity: 1 },
    { itemId: "torch", quantity: 2 },
  ],
}) {
  const initialized = step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:loadout-authority-v2",
    runtimeEpochId: "epoch:loadout-authority-v2:1",
    moduleRef: profileRef("module:loadout-authority-v2", "d"),
    initialDefinitionCatalogRef: profileRef("definitions:loadout-authority-v2", "e"),
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{ id: "scene:camp", name: "营地" }],
    principals: [{ id: ALICE.principalId, sessionVersion: 1, role: "host" }],
    seats: [{ id: ALICE.seatId, principalId: ALICE.principalId, status: "active" }],
    characters: [{
      id: ALICE.characterId,
      kind: "player",
      name: "爱丽丝",
      sceneId: "scene:camp",
      tenureStatus: "active",
      classId: "fighter",
      level: 3,
      abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
      proficiencyBonus: 2,
      hitPoints: { current: 24, maximum: 24 },
      loadout,
    }],
    characterControls: [{ characterId: ALICE.characterId, seatId: ALICE.seatId }],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const replayed = replay(initialized.genesis, []);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return {
    genesis: initialized.genesis,
    profiles: initialized.profiles,
    events: [],
    state: replayed.state,
  };
}

function commit(scenario, input) {
  const result = step(scenario.profiles, scenario.state, input);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  const events = [...scenario.events, ...result.events];
  const replayed = replay(scenario.genesis, events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return { ...scenario, events, state: replayed.state };
}

function driveWithRoomRandomness(scenario, input) {
  let current = scenario;
  let result = step(current.profiles, current.state, input);
  while (true) {
    const events = [...current.events, ...(result.events ?? [])];
    const replayed = replay(current.genesis, events);
    assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
    current = { ...current, events, state: replayed.state };
    if (result.kind !== "awaitingRandomness") return { scenario: current, result };
    // This is the deterministic Room-authority boundary. Player/KP inputs do
    // not contain faces, and committed state is still rebuilt only by replay.
    result = step(current.profiles, current.state, {
      kind: "authoritativeRandomness",
      resolutionId: result.resolutionId,
      responseId: `authority-response:${result.resolutionId}`,
      continuationCapability: result.continuationCapability,
      randomnessResults: result.randomnessRequests.map((request) => ({
        randomnessId: request.randomnessId,
        requestHash: request.requestHash,
        draws: request.dice.map(({ count, sides }) => ({
          sides: Number(sides),
          faces: Array.from(
            { length: Number(count) },
            () => Math.min(10, Number(sides)),
          ),
        })),
      })),
    });
  }
}

function viewer() {
  return {
    kind: "player",
    principalId: ALICE.principalId,
    sessionVersion: 1,
    seatId: ALICE.seatId,
    characterId: ALICE.characterId,
  };
}

test("semantic wear and stow derive from the current authoritative loadout after item consumption", () => {
  let scenario = start();
  scenario = commit(scenario, {
    kind: "useItem",
    proposalId: "root:consume-torch",
    characterId: ALICE.characterId,
    itemId: "torch",
    quantity: 1,
    purpose: "点燃营火",
  });

  scenario = commit(scenario, {
    kind: "changeCharacterGear",
    rootActionId: "root:wear-shield",
    controllerPrincipalId: ALICE.principalId,
    actorCharacterId: ALICE.characterId,
    action: "wear",
    slot: "off",
    itemId: "shield",
  });

  let projected = project(scenario.profiles, scenario.state, viewer());
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  assert.deepEqual(projected.controlledCharacter.loadout, {
    armorClass: 19,
    speedFeet: 30,
    equipped: { armor: "chain", off: "shield" },
    backpack: [
      { itemId: "dagger", quantity: 1 },
      { itemId: "torch", quantity: 1 },
    ],
  });
  assert.equal(
    projected.controlledCharacter.combat.resources["item:torch"].current,
    "1",
    "the combat cache must not retain a second consumable quantity",
  );

  scenario = commit(scenario, {
    kind: "changeCharacterGear",
    rootActionId: "root:stow-shield",
    controllerPrincipalId: ALICE.principalId,
    actorCharacterId: ALICE.characterId,
    action: "stow",
    slot: "off",
  });
  projected = project(scenario.profiles, scenario.state, viewer());
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  assert.deepEqual(projected.controlledCharacter.loadout, {
    armorClass: 17,
    speedFeet: 30,
    equipped: { armor: "chain" },
    backpack: [
      { itemId: "dagger", quantity: 1 },
      { itemId: "shield", quantity: 1 },
      { itemId: "torch", quantity: 1 },
    ],
  });
});

test("stowing and re-wearing the ammo selector cannot recreate consumed ammunition", () => {
  let scenario = start({
    armorClass: 17,
    speedFeet: 30,
    equipped: { ammo: "arrow", armor: "chain" },
    backpack: [{ itemId: "arrow", quantity: 2 }],
  });
  scenario = commit(scenario, {
    kind: "useItem",
    proposalId: "root:consume-arrow",
    characterId: ALICE.characterId,
    itemId: "arrow",
    quantity: 1,
    purpose: "射出一箭",
  });
  scenario = commit(scenario, {
    kind: "changeCharacterGear",
    rootActionId: "root:stow-arrow-selector",
    controllerPrincipalId: ALICE.principalId,
    actorCharacterId: ALICE.characterId,
    action: "stow",
    slot: "ammo",
  });
  let projected = project(scenario.profiles, scenario.state, viewer());
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  assert.deepEqual(projected.controlledCharacter.loadout.backpack, [
    { itemId: "arrow", quantity: 1 },
  ]);
  assert.deepEqual(projected.controlledCharacter.loadout.equipped, { armor: "chain" });

  scenario = commit(scenario, {
    kind: "changeCharacterGear",
    rootActionId: "root:wear-arrow-selector",
    controllerPrincipalId: ALICE.principalId,
    actorCharacterId: ALICE.characterId,
    action: "wear",
    slot: "ammo",
    itemId: "arrow",
  });
  projected = project(scenario.profiles, scenario.state, viewer());
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  assert.deepEqual(projected.controlledCharacter.loadout.backpack, [
    { itemId: "arrow", quantity: 1 },
  ]);
  assert.deepEqual(projected.controlledCharacter.loadout.equipped, {
    ammo: "arrow",
    armor: "chain",
  });
});

test("combat item costs decrement the same loadout that later gear actions derive", () => {
  let scenario = start({
    armorClass: 17,
    speedFeet: 30,
    equipped: { ammo: "arrow", armor: "chain", main: "longbow" },
    backpack: [{ itemId: "arrow", quantity: 2 }],
  });
  const encounter = driveWithRoomRandomness(scenario, {
    kind: "startEncounter",
    rootActionId: "root:loadout-combat:start",
    proposalAttemptId: "proposal:loadout-combat:start:1",
    encounterId: "encounter:loadout-combat",
    sceneId: "scene:camp",
    participantEntityIds: [ALICE.characterId],
    dynamicEntities: [{
      entityId: "enemy:loadout-target",
      entityKind: "npc",
      name: "箭靶傀儡",
      position: { x: "60", y: "0", elevation: "0" },
      footprint: { width: "60", depth: "60", height: "60" },
      stats: { str: "10", dex: "10", con: "10", int: "3", wis: "10", cha: "3" },
      proficiencyBonus: "2",
      armorClass: "10",
      hitPoints: { current: "20", maximum: "20", temporary: "0" },
      speedInches: { walk: "360" },
      deathPolicy: "deadAtZero",
      abilities: [],
    }],
    initiativeGroups: [
      { entryId: "initiative:alice", combatantEntityIds: [ALICE.characterId] },
      { entryId: "initiative:target", combatantEntityIds: ["enemy:loadout-target"] },
    ],
    hostilities: [
      { fromEntityIds: [ALICE.characterId], toEntityIds: ["enemy:loadout-target"] },
      { fromEntityIds: ["enemy:loadout-target"], toEntityIds: [ALICE.characterId] },
    ],
    battlefieldFactIds: [],
  });
  assert.equal(encounter.result.kind, "committed", JSON.stringify(encounter.result));
  scenario = encounter.scenario;

  const abilityRef = `ability:${ALICE.characterId}:weapon:longbow:level:3:modifier:1:proficiency:2`;
  const attack = driveWithRoomRandomness(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:loadout-combat:shoot",
    sourceEntityId: ALICE.characterId,
    abilityRef,
    parameters: { targetEntityId: "enemy:loadout-target" },
  });
  assert.equal(attack.result.kind, "committed", JSON.stringify(attack.result));
  scenario = attack.scenario;
  scenario = commit(scenario, {
    kind: "changeCharacterGear",
    rootActionId: "root:loadout-combat:stow-ammo",
    controllerPrincipalId: ALICE.principalId,
    actorCharacterId: ALICE.characterId,
    action: "stow",
    slot: "ammo",
  });

  const projected = project(scenario.profiles, scenario.state, viewer());
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  assert.deepEqual(projected.controlledCharacter.loadout.backpack, [
    { itemId: "arrow", quantity: 1 },
  ]);
  assert.equal(
    projected.controlledCharacter.combat.resources["item:arrow"].current,
    "1",
  );
});

test("the authoritative rules interface rejects a stale full-loadout administration patch", () => {
  let scenario = start();
  scenario = commit(scenario, {
    kind: "useItem",
    proposalId: "root:consume-before-forgery",
    characterId: ALICE.characterId,
    itemId: "torch",
    quantity: 1,
    purpose: "照亮营地",
  });

  const forged = step(scenario.profiles, scenario.state, {
    kind: "applyRoomAdministration",
    roomAdministration: {
      kind: "roomAdministration",
      capability: scenario.state.multiplayerRuntime.roomAdministrationCapability,
    },
    commandId: "admin:stale-full-card",
    command: {
      kind: "updateCharacterCard",
      principalId: ALICE.principalId,
      characterId: ALICE.characterId,
      characterBuild: { classId: "fighter" },
      loadout: {
        armorClass: 17,
        speedFeet: 30,
        equipped: { armor: "chain" },
        backpack: [
          { itemId: "dagger", quantity: 1 },
          { itemId: "shield", quantity: 1 },
          { itemId: "torch", quantity: 2 },
        ],
      },
    },
  });
  assert.equal(forged.kind, "rejected", JSON.stringify(forged));
  assert.deepEqual(forged.events, []);
  assert.equal(
    scenario.state.entities[ALICE.characterId].loadout.backpack
      .find(({ itemId }) => itemId === "torch").quantity,
    1,
  );
});
