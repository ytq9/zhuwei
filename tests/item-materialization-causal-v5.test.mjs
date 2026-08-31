import assert from "node:assert/strict";
import test from "node:test";

import { compileKpFormDraft } from "../app/_runtime/lib/kp/causal-action-program.ts";
import { project, replay, step } from "../app/_runtime/lib/rules/index.ts";
import {
  ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
} from "../app/_runtime/lib/rules/profiles/manifests.ts";
import {
  HEALING_POTION_ITEM_DEFINITION_ID,
  itemEntryResourceId,
  itemEntryUseAbilityId,
} from "../app/_runtime/lib/rules/v2/items.ts";

const PLAYER = "character:item-materialization-v5:alice";
const PRINCIPAL = "principal:item-materialization-v5:alice";
const SEAT = "seat:item-materialization-v5:alice";
const RECIPIENT = "character:item-materialization-v5:bram";
const RECIPIENT_PRINCIPAL = "principal:item-materialization-v5:bram";
const RECIPIENT_SEAT = "seat:item-materialization-v5:bram";
const SCENE = "scene:item-materialization-v5:apothecary";
const BASIS = "fact:item-materialization-v5:sealed-cabinet";

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
      featureId: "feature:item-materialization-v5:apothecary-wall",
      kind: "barrier",
      label: "药房隔墙",
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

function initialize(
  profiles = ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
  { includeRecipient = false } = {},
) {
  const initialized = step(profiles, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: `room:item-materialization-v5:${profiles.manifest.profileId}`,
    runtimeEpochId: `epoch:item-materialization-v5:${profiles.manifest.profileId}:1`,
    moduleRef: {
      profileId: "module:item-materialization-v5",
      profileHash: `sha256:${"a".repeat(64)}`,
    },
    initialDefinitionCatalogRef: {
      profileId: "definitions:item-materialization-v5",
      profileHash: `sha256:${"b".repeat(64)}`,
    },
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{ id: SCENE, name: "封存药房", geometry: tacticalGeometry() }],
    principals: [
      { id: PRINCIPAL, sessionVersion: 1, role: "host" },
      ...(includeRecipient
        ? [{ id: RECIPIENT_PRINCIPAL, sessionVersion: 1, role: "player" }]
        : []),
    ],
    seats: [
      { id: SEAT, principalId: PRINCIPAL, status: "active" },
      ...(includeRecipient
        ? [{ id: RECIPIENT_SEAT, principalId: RECIPIENT_PRINCIPAL, status: "active" }]
        : []),
    ],
    characters: [
      {
        id: PLAYER,
        kind: "player",
        name: "阿莱莎",
        sceneId: SCENE,
        tenureStatus: "active",
        classId: "fighter",
        level: 2,
        abilityScores: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
        proficiencyBonus: 2,
        proficientSkills: [],
        expertiseSkills: [],
        proficientSaves: ["str", "con"],
        resources: { resolve: 2, "resource:second-wind": 1 },
        resourceMaximums: { resolve: 2, "resource:second-wind": 1 },
        hitPoints: { current: 12, maximum: 20 },
        loadout: { armorClass: 11, speedFeet: 30, equipped: {}, backpack: [] },
        characterBuild: { classId: "fighter", raceId: "human", cantrips: [], prepared: [] },
      },
      ...(includeRecipient
        ? [{
            id: RECIPIENT,
            kind: "player",
            name: "布拉姆",
            sceneId: SCENE,
            tenureStatus: "active",
            classId: "fighter",
            level: 2,
            abilityScores: { str: 12, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
            proficiencyBonus: 2,
            proficientSkills: [],
            expertiseSkills: [],
            proficientSaves: ["str", "con"],
            resources: { resolve: 1 },
            resourceMaximums: { resolve: 1 },
            hitPoints: { current: 8, maximum: 20 },
            loadout: { armorClass: 12, speedFeet: 30, equipped: {}, backpack: [] },
            characterBuild: {
              classId: "fighter",
              raceId: "human",
              cantrips: [],
              prepared: [],
            },
          }]
        : []),
    ],
    characterControls: [
      { characterId: PLAYER, seatId: SEAT },
      ...(includeRecipient
        ? [{ characterId: RECIPIENT, seatId: RECIPIENT_SEAT }]
        : []),
    ],
    canonicalFacts: [{
      id: BASIS,
      kind: "moduleAnchor",
      source: "moduleAnchor",
      subjectRefs: [SCENE],
      value: { description: "封条记录证明柜中留有两瓶治疗药水。" },
      visibilityPolicyId: "visibility:scene-observers",
    }],
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

function materializationInput(rootActionId, proposedFact, overrides = {}) {
  const draft = {
    goal: "取得封存柜中已由记录证明存在的治疗药水",
    method: "materializeItem",
    proposedFact: JSON.stringify(proposedFact),
    basisRefs: [BASIS, SCENE],
    resolution: "direct",
    durationUnit: "minute",
    durationValue: 1,
    ...overrides,
  };
  const program = compileKpFormDraft("materialization.v1", draft);
  return {
    kind: "executeCausalActionProgram",
    actionLanguageRef: program.languageRef,
    actionLanguageHash: program.languageHash,
    actorCharacterId: PLAYER,
    causalActionProgram: program,
    rootActionId,
  };
}

const POTION_DRAFT = Object.freeze({
  schema: "zhuwei.item-materialization-draft/v1",
  definitionRef: HEALING_POTION_ITEM_DEFINITION_ID,
  quantity: 1,
});

test("V5 full-hit-point guard applies only to consumable item healing", () => {
  const scenario = initialize();
  const state = structuredClone(scenario.state);
  const abilityRef = `ability:${PLAYER}:class:second-wind:level:2`;
  state.entities[PLAYER].hitPoints.current = 20;
  state.combatRuntime.entities[PLAYER].hitPoints.current = "20";
  state.combatRuntime.entities[PLAYER].turn = {
    action: "1",
    bonusAction: "1",
    reaction: "1",
    attacksRemaining: "1",
    leveledBonusActionSpell: false,
  };

  const waiting = step(scenario.profiles, state, {
    kind: "invokeAbility",
    rootActionId: "root:item-materialization-v5:full-hp-second-wind",
    sourceEntityId: PLAYER,
    abilityRef,
    parameters: { targetEntityId: PLAYER },
  });
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  assert.deepEqual(waiting.randomnessRequests[0].dice, [{ count: "1", sides: "10" }]);
});

test("V5 materializes, acquires, uses, exhausts, and replays one built-in healing potion", () => {
  const scenario = initialize();
  const outcome = step(
    scenario.profiles,
    scenario.state,
    materializationInput("root:item-materialization-v5:success", POTION_DRAFT),
  );
  assert.equal(outcome.kind, "committed", JSON.stringify(outcome));

  const eventTypes = outcome.events.map(({ eventType }) => eventType);
  for (const eventType of [
    "ActivityStarted",
    "ActivityCompleted",
    "ItemDefinitionRegistered",
    "DefinitionRegistered",
    "ItemMaterialized",
    "ItemAcquired",
    "FictionTimeAdvanced",
  ]) assert.equal(eventTypes.filter((candidate) => candidate === eventType).length, 1, eventType);
  const activityStartIndex = eventTypes.indexOf("ActivityStarted");
  const timeIndex = eventTypes.indexOf("FictionTimeAdvanced");
  const activityCompletedIndex = eventTypes.indexOf("ActivityCompleted");
  const itemDefinitionIndex = eventTypes.indexOf("ItemDefinitionRegistered");
  assert.ok(activityStartIndex >= 0 && activityStartIndex < timeIndex);
  assert.ok(timeIndex < activityCompletedIndex && activityCompletedIndex < itemDefinitionIndex);
  const materialized = outcome.events.find(({ eventType }) => eventType === "ItemMaterialized");
  assert.ok(materialized);
  const entryId = materialized.payload.entry.entryId;
  assert.match(entryId, /^item-entry:materialized:[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(POTION_DRAFT).includes(entryId), false);

  const itemSystem = outcome.state.campaignRuntime.itemSystem;
  assert.equal(itemSystem.definitions[HEALING_POTION_ITEM_DEFINITION_ID].content.use.abilityRef,
    "ability:item:potion-of-healing:drink");
  assert.deepEqual(itemSystem.entries[entryId], {
    ...materialized.payload.entry,
    disposition: "held",
    holderRef: PLAYER,
    sceneRef: null,
    visibilityPolicyRef: `visibility:character-controller:${PLAYER}`,
    ownership: { kind: "character", ownerRef: PLAYER },
  });
  assert.equal(itemSystem.entries[entryId].quantity, 1);
  assert.equal(outcome.state.entities[PLAYER].resources.resolve, 2);
  assert.ok(outcome.state.entities[PLAYER].loadout.backpack.some((entry) =>
    entry.itemId === entryId && entry.quantity === 1));
  const abilityRef = itemEntryUseAbilityId(
    "ability:item:potion-of-healing:drink",
    entryId,
  );
  const resourceId = itemEntryResourceId(entryId);
  assert.ok(outcome.state.campaignRuntime.definitions[abilityRef]);
  assert.deepEqual(outcome.state.combatRuntime.entities[PLAYER].resources[resourceId], {
    current: "1",
    maximum: "1",
  });
  assert.ok(outcome.state.combatRuntime.entities[PLAYER].abilityRefs.includes(abilityRef));
  assert.equal(
    outcome.events.find(({ eventType }) => eventType === "FictionTimeAdvanced")
      .payload.durationMicros,
    "60000000",
  );

  const rebuilt = replay(scenario.genesis, outcome.events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.deepEqual(rebuilt.state.campaignRuntime.itemSystem.entries[entryId],
    outcome.state.campaignRuntime.itemSystem.entries[entryId]);
  const projection = project(scenario.profiles, rebuilt.state, {
    kind: "player",
    principalId: PRINCIPAL,
    sessionVersion: 1,
    seatId: SEAT,
    characterId: PLAYER,
  });
  assert.equal(projection.kind, "projected", JSON.stringify(projection));
  assert.ok(projection.controlledCharacter.inventory.entries.some((entry) =>
    entry.entryId === entryId && entry.name === "治疗药水" && entry.quantity === 1));
  for (let prefixLength = 0; prefixLength <= outcome.events.length; prefixLength += 1) {
    const prefix = replay(scenario.genesis, outcome.events.slice(0, prefixLength));
    assert.equal(prefix.kind, "replayed", `prefix ${prefixLength}: ${JSON.stringify(prefix)}`);
    const prefixProjection = project(scenario.profiles, prefix.state, {
      kind: "player",
      principalId: PRINCIPAL,
      sessionVersion: 1,
      seatId: SEAT,
      characterId: PLAYER,
    });
    assert.equal(
      prefixProjection.kind,
      "projected",
      `prefix ${prefixLength}: ${JSON.stringify(prefixProjection)}`,
    );
  }

  const waiting = step(scenario.profiles, outcome.state, {
    kind: "invokeItemActivity",
    rootActionId: "root:item-materialization-v5:drink",
    sourceEntityId: PLAYER,
    itemEntryId: entryId,
    parameters: { targetEntityId: PLAYER },
  });
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  assert.deepEqual(waiting.events.map(({ eventType }) => eventType), [
    "ActivityStarted",
    "FictionTimeAdvanced",
    "ActivityCompleted",
    "RandomnessRequested",
  ]);
  assert.equal(waiting.state.campaignRuntime.activities[
    "activity:item-use:root:item-materialization-v5:drink"
  ].status, "completed");
  assert.equal(waiting.state.fictionTimelines["branch:main"].nowMicros, "66000000");
  assert.equal(waiting.state.combatRuntime.entities[PLAYER].turn, undefined);
  assert.equal(waiting.randomnessRequests.length, 1);
  assert.deepEqual(waiting.randomnessRequests[0].dice, [{ count: "2", sides: "4" }]);

  const resolved = step(scenario.profiles, waiting.state, {
    kind: "authoritativeRandomness",
    resolutionId: waiting.resolutionId,
    responseId: `authority-response:${waiting.resolutionId}`,
    continuationCapability: waiting.continuationCapability,
    randomnessResults: waiting.randomnessRequests.map((request) => ({
      randomnessId: request.randomnessId,
      requestHash: request.requestHash,
      draws: request.dice.map(({ count, sides }) => ({
        sides: Number(sides),
        faces: Number(sides) === 4 && Number(count) === 2
          ? [2, 3]
          : Array.from({ length: Number(count) }, () => 1),
      })),
    })),
  });
  assert.equal(resolved.kind, "committed", JSON.stringify(resolved));
  assert.deepEqual(resolved.mechanicalResult, {
    healing: { rolled: 7, applied: 7, before: 12, after: 19 },
  });
  assert.equal(resolved.state.entities[PLAYER].hitPoints.current, 19);
  assert.equal(resolved.state.combatRuntime.entities[PLAYER].hitPoints.current, "19");
  assert.equal(resolved.state.combatRuntime.entities[PLAYER].resources[resourceId], undefined);
  assert.equal(resolved.state.combatRuntime.entities[PLAYER].abilityRefs.includes(abilityRef), false);
  assert.equal(resolved.state.combatRuntime.entities[PLAYER].turn, undefined);
  assert.equal(resolved.state.entities[PLAYER].loadout.backpack.some((entry) =>
    entry.itemId === entryId), false);
  assert.deepEqual(resolved.state.campaignRuntime.itemSystem.entries[entryId], {
    ...itemSystem.entries[entryId],
    quantity: 0,
    disposition: "consumed",
    holderRef: null,
    sceneRef: null,
    equippedSlot: null,
  });
  const healingEvent = resolved.events.find(({ eventType }) => eventType === "HealingResolved");
  assert.deepEqual(healingEvent?.payload, { entityId: PLAYER, before: "12", after: "19" });

  const exhaustedProjection = project(scenario.profiles, resolved.state, {
    kind: "player",
    principalId: PRINCIPAL,
    sessionVersion: 1,
    seatId: SEAT,
    characterId: PLAYER,
  });
  assert.equal(exhaustedProjection.kind, "projected", JSON.stringify(exhaustedProjection));
  assert.equal(exhaustedProjection.controlledCharacter.inventory.entries.some((entry) =>
    entry.entryId === entryId), false);

  const allEvents = [...outcome.events, ...waiting.events, ...resolved.events];
  const finalReplay = replay(scenario.genesis, allEvents);
  assert.equal(finalReplay.kind, "replayed", JSON.stringify(finalReplay));
  assert.deepEqual(finalReplay.state, resolved.state);
});

test("V5 partial item transfer freezes a recipient ability before transfer and replays its use", () => {
  const scenario = initialize(ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST, {
    includeRecipient: true,
  });
  const materialized = step(
    scenario.profiles,
    scenario.state,
    materializationInput("root:item-materialization-v5:transfer:create", {
      ...POTION_DRAFT,
      quantity: 2,
    }),
  );
  assert.equal(materialized.kind, "committed", JSON.stringify(materialized));
  const sourceEntryId = materialized.events.find(({ eventType }) =>
    eventType === "ItemMaterialized")?.payload.entry.entryId;
  assert.ok(sourceEntryId);
  assert.equal(
    materialized.state.campaignRuntime.itemSystem.entries[sourceEntryId].quantity,
    2,
  );

  const transferred = step(scenario.profiles, materialized.state, {
    kind: "transferItem",
    proposalId: "root:item-materialization-v5:transfer:partial",
    fromCharacterId: PLAYER,
    toCharacterId: RECIPIENT,
    itemId: sourceEntryId,
    quantity: 1,
    method: "阿莱莎把一瓶治疗药水交给布拉姆",
    ownershipDisposition: "preserve",
  });
  assert.equal(transferred.kind, "committed", JSON.stringify(transferred));
  const transferIndex = transferred.events.findIndex(({ eventType }) =>
    eventType === "ItemTransferred");
  assert.ok(transferIndex >= 0);
  const targetEntryId = transferred.events[transferIndex].payload.targetItemId;
  assert.notEqual(targetEntryId, sourceEntryId);

  const sourceAbilityRef = itemEntryUseAbilityId(
    "ability:item:potion-of-healing:drink",
    sourceEntryId,
  );
  const targetAbilityRef = itemEntryUseAbilityId(
    "ability:item:potion-of-healing:drink",
    targetEntryId,
  );
  const targetRegistrationIndex = transferred.events.findIndex(({ eventType, payload }) =>
    eventType === "DefinitionRegistered"
    && payload.definition?.definitionId === targetAbilityRef);
  assert.ok(targetRegistrationIndex >= 0 && targetRegistrationIndex < transferIndex);
  const targetRegistration = transferred.events[targetRegistrationIndex].payload;
  assert.match(targetRegistration.definitionHash, /^sha256:[0-9a-f]{64}$/u);
  assert.match(targetRegistration.compiledHash, /^sha256:[0-9a-f]{64}$/u);
  assert.ok(targetRegistration.mechanicGraph.operations.length > 0);
  assert.ok(Array.isArray(targetRegistration.referenceClosure));

  const itemSystem = transferred.state.campaignRuntime.itemSystem;
  assert.equal(itemSystem.entries[sourceEntryId].holderRef, PLAYER);
  assert.equal(itemSystem.entries[sourceEntryId].quantity, 1);
  assert.equal(itemSystem.entries[targetEntryId].holderRef, RECIPIENT);
  assert.equal(itemSystem.entries[targetEntryId].quantity, 1);
  assert.equal(
    transferred.state.campaignRuntime.definitions[targetAbilityRef].definitionId,
    targetAbilityRef,
  );

  const sourceResourceId = itemEntryResourceId(sourceEntryId);
  const targetResourceId = itemEntryResourceId(targetEntryId);
  const sourceCombat = transferred.state.combatRuntime.entities[PLAYER];
  const targetCombat = transferred.state.combatRuntime.entities[RECIPIENT];
  assert.deepEqual(sourceCombat.resources[sourceResourceId], { current: "1", maximum: "1" });
  assert.deepEqual(targetCombat.resources[targetResourceId], { current: "1", maximum: "1" });
  assert.ok(sourceCombat.abilityRefs.includes(sourceAbilityRef));
  assert.equal(sourceCombat.abilityRefs.includes(targetAbilityRef), false);
  assert.ok(targetCombat.abilityRefs.includes(targetAbilityRef));
  assert.equal(targetCombat.abilityRefs.includes(sourceAbilityRef), false);

  const waiting = step(scenario.profiles, transferred.state, {
    kind: "invokeAbility",
    rootActionId: "root:item-materialization-v5:transfer:recipient-drink",
    sourceEntityId: RECIPIENT,
    abilityRef: targetAbilityRef,
    parameters: { targetEntityId: RECIPIENT },
  });
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  const resolved = step(scenario.profiles, waiting.state, {
    kind: "authoritativeRandomness",
    resolutionId: waiting.resolutionId,
    responseId: `authority-response:${waiting.resolutionId}`,
    continuationCapability: waiting.continuationCapability,
    randomnessResults: waiting.randomnessRequests.map((request) => ({
      randomnessId: request.randomnessId,
      requestHash: request.requestHash,
      draws: request.dice.map(({ count, sides }) => ({
        sides: Number(sides),
        faces: Number(sides) === 4 && Number(count) === 2
          ? [1, 4]
          : Array.from({ length: Number(count) }, () => 1),
      })),
    })),
  });
  assert.equal(resolved.kind, "committed", JSON.stringify(resolved));
  assert.deepEqual(resolved.mechanicalResult, {
    healing: { rolled: 7, applied: 7, before: 8, after: 15 },
  });
  assert.equal(resolved.state.entities[RECIPIENT].hitPoints.current, 15);
  assert.equal(resolved.state.campaignRuntime.itemSystem.entries[targetEntryId].disposition,
    "consumed");
  assert.equal(resolved.state.combatRuntime.entities[RECIPIENT].resources[targetResourceId],
    undefined);
  assert.equal(
    resolved.state.combatRuntime.entities[RECIPIENT].abilityRefs.includes(targetAbilityRef),
    false,
  );
  assert.equal(resolved.state.campaignRuntime.itemSystem.entries[sourceEntryId].quantity, 1);
  assert.deepEqual(
    resolved.state.combatRuntime.entities[PLAYER].resources[sourceResourceId],
    { current: "1", maximum: "1" },
  );
  assert.ok(resolved.state.combatRuntime.entities[PLAYER].abilityRefs.includes(sourceAbilityRef));

  const allEvents = [
    ...materialized.events,
    ...transferred.events,
    ...waiting.events,
    ...resolved.events,
  ];
  const rebuilt = replay(scenario.genesis, allEvents);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.deepEqual(rebuilt.state, resolved.state);
});

test("item materialization rejects missing causal proof and model-supplied mechanics", () => {
  const scenario = initialize();
  const before = structuredClone(scenario.state);
  const missingProof = step(scenario.profiles, scenario.state, materializationInput(
    "root:item-materialization-v5:no-proof",
    POTION_DRAFT,
    { basisRefs: [SCENE] },
  ));
  assert.equal(missingProof.kind, "rejected");
  assert.equal(missingProof.rejection.code, "privateOrUnknownReference");
  assert.deepEqual(scenario.state, before);

  const modelMechanics = step(scenario.profiles, scenario.state, materializationInput(
    "root:item-materialization-v5:forged-mechanics",
    {
      ...POTION_DRAFT,
      abilityRef: "ability:model:instant-full-heal",
    },
  ));
  assert.equal(modelMechanics.kind, "rejected");
  assert.equal(modelMechanics.rejection.code, "invalidRulesInput");
  assert.deepEqual(scenario.state, before);
});
