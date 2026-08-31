import assert from "node:assert/strict";
import test from "node:test";

import { project, replay, step } from "../app/_runtime/lib/rules/index.ts";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests.ts";

const CHARACTER = "character:item-correction-v5:alice";
const PRINCIPAL = "principal:item-correction-v5:alice";
const SEAT = "seat:item-correction-v5:alice";
const SCENE = "scene:item-correction-v5:camp";

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
    spawnPoints: [{ x: "120", y: "180", elevation: "0" }],
    obstacles: [{
      featureId: "feature:item-correction-v5:camp-wall",
      kind: "barrier",
      label: "营地矮墙",
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

function viewer() {
  return {
    kind: "player",
    principalId: PRINCIPAL,
    sessionVersion: 1,
    seatId: SEAT,
    characterId: CHARACTER,
  };
}

function initialize() {
  const initialized = step(ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:item-correction-v5",
    runtimeEpochId: "epoch:item-correction-v5:1",
    moduleRef: {
      profileId: "module:item-correction-v5",
      profileHash: `sha256:${"a".repeat(64)}`,
    },
    initialDefinitionCatalogRef: {
      profileId: "definitions:item-correction-v5",
      profileHash: `sha256:${"b".repeat(64)}`,
    },
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{ id: SCENE, name: "营地", geometry: tacticalGeometry() }],
    principals: [{ id: PRINCIPAL, sessionVersion: 1, role: "host" }],
    seats: [{ id: SEAT, principalId: PRINCIPAL, status: "active" }],
    characters: [{
      id: CHARACTER,
      kind: "player",
      name: "爱丽丝",
      sceneId: SCENE,
      tenureStatus: "active",
      classId: "fighter",
      level: 2,
      abilityScores: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      proficientSkills: [],
      expertiseSkills: [],
      proficientSaves: ["str", "con"],
      resources: { resolve: 2 },
      resourceMaximums: { resolve: 2 },
      hitPoints: { current: 20, maximum: 20 },
      loadout: {
        armorClass: 11,
        speedFeet: 30,
        equipped: {},
        backpack: [{ itemId: "shield", quantity: 1 }],
      },
      characterBuild: { classId: "fighter", raceId: "human", cantrips: [], prepared: [] },
    }],
    characterControls: [{ characterId: CHARACTER, seatId: SEAT }],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const rebuilt = replay(initialized.genesis, []);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  return {
    genesis: initialized.genesis,
    profiles: initialized.profiles,
    state: rebuilt.state,
  };
}

test("V5 gear correction restores the item entry authority and every event prefix replays and projects", () => {
  const scenario = initialize();
  const shield = Object.values(scenario.state.campaignRuntime.itemSystem.entries)
    .find((entry) => entry.holderRef === CHARACTER);
  assert.ok(shield);
  assert.equal(shield.equippedSlot, null);

  const worn = step(scenario.profiles, scenario.state, {
    kind: "changeCharacterGear",
    rootActionId: "root:item-correction-v5:wear-shield",
    controllerPrincipalId: PRINCIPAL,
    actorCharacterId: CHARACTER,
    action: "wear",
    slot: "off",
    itemId: shield.entryId,
  });
  assert.equal(worn.kind, "committed", JSON.stringify(worn));
  assert.deepEqual(worn.events.map(({ eventType }) => eventType), [
    "ActivityStarted",
    "FictionTimeAdvanced",
    "ActivityCompleted",
    "CharacterGearChanged",
  ]);
  assert.equal(worn.events[0].payload.intendedDurationMicros, "6000000");
  assert.equal(worn.events[1].payload.durationMicros, "6000000");
  assert.equal(worn.state.campaignRuntime.itemSystem.entries[shield.entryId].equippedSlot, "off");
  assert.equal(worn.state.entities[CHARACTER].loadout.armorClass, 13);

  const wornReplay = replay(scenario.genesis, worn.events);
  assert.equal(wornReplay.kind, "replayed", JSON.stringify(wornReplay));
  const targetReceipt = wornReplay.state.receipts["root:item-correction-v5:wear-shield"];
  assert.ok(targetReceipt);

  const corrected = step(scenario.profiles, wornReplay.state, {
    kind: "applyServiceCorrection",
    correctionAuthority: {
      kind: "roomCorrectionAuthority",
      capability: wornReplay.state.correctionRuntime.authorityCapability,
    },
    correctionId: "correction:item-correction-v5:wear-shield",
    targetReceiptId: targetReceipt.receiptId,
    actorCharacterId: CHARACTER,
    errorKind: "rulesMisapplication",
    publicExplanation: "盾牌换装裁决有误，恢复换装前状态。",
    basis: {
      stateHash: wornReplay.head.stateHash,
      eventHash: wornReplay.head.eventHash,
    },
  });
  assert.equal(corrected.kind, "committed", JSON.stringify(corrected));
  assert.equal(corrected.strategy, "causalBranch");
  assert.deepEqual(corrected.events.map(({ eventType }) => eventType), [
    "CorrectionBranchOpened",
    "BranchActivated",
  ]);
  const branchActivation = corrected.events.find(({ eventType }) => eventType === "BranchActivated");
  assert.ok(branchActivation.payload.effects.some((effect) =>
    effect.kind === "restoreCampaignEntry"
    && effect.collection === "itemSystem"
    && effect.entryId === "entries"));
  assert.equal(corrected.state.campaignRuntime.itemSystem.entries[shield.entryId].equippedSlot, null);
  assert.equal(corrected.state.entities[CHARACTER].loadout.armorClass, 11);

  const events = [...worn.events, ...corrected.events];
  for (let prefixLength = 0; prefixLength <= events.length; prefixLength += 1) {
    const rebuilt = replay(scenario.genesis, events.slice(0, prefixLength));
    assert.equal(rebuilt.kind, "replayed", `prefix ${prefixLength}: ${JSON.stringify(rebuilt)}`);
    const projection = project(scenario.profiles, rebuilt.state, viewer());
    assert.equal(
      projection.kind,
      "projected",
      `prefix ${prefixLength}: ${JSON.stringify(projection)}`,
    );
  }

  const finalReplay = replay(scenario.genesis, events);
  assert.equal(finalReplay.kind, "replayed", JSON.stringify(finalReplay));
  assert.deepEqual(finalReplay.state, corrected.state);
  const finalProjection = project(scenario.profiles, finalReplay.state, viewer());
  assert.equal(finalProjection.kind, "projected", JSON.stringify(finalProjection));
  assert.equal(finalProjection.controlledCharacter.loadout.equipped.off, undefined);
  assert.ok(finalProjection.controlledCharacter.inventory.entries.some((entry) =>
    entry.entryId === shield.entryId && entry.equippedSlot === null));
});

test("V5 rejects a gear change while the same character has an active Activity", () => {
  const scenario = initialize();
  const resting = step(scenario.profiles, scenario.state, {
    kind: "startRest",
    proposalId: "root:item-correction-v5:start-rest",
    characterId: CHARACTER,
    restKind: "short",
    intendedDurationMicros: "3600000000",
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
  });
  assert.equal(resting.kind, "committed", JSON.stringify(resting));
  const shield = Object.values(resting.state.campaignRuntime.itemSystem.entries)
    .find((entry) => entry.holderRef === CHARACTER);
  assert.ok(shield);

  const blocked = step(scenario.profiles, resting.state, {
    kind: "changeCharacterGear",
    rootActionId: "root:item-correction-v5:gear-during-rest",
    controllerPrincipalId: PRINCIPAL,
    actorCharacterId: CHARACTER,
    action: "wear",
    slot: "off",
    itemId: shield.entryId,
  });
  assert.equal(blocked.kind, "rejected", JSON.stringify(blocked));
  assert.equal(blocked.rejection.code, "pendingInputUnresolved");
  assert.deepEqual(blocked.events, []);
});
