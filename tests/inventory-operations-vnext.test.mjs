import assert from "node:assert/strict";
import test from "node:test";

import { createVersionedRulesRuntime } from "../app/_runtime/lib/rules/v2-runtime.ts";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/vnext-world-interaction.ts";
import {
  ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
} from "../app/_runtime/lib/rules/profiles/manifests.ts";
import {
  HEALING_POTION_ITEM_DEFINITION_ID,
  itemEntryResourceId,
  itemEntryUseAbilityId,
} from "../app/_runtime/lib/rules/v2/items.ts";

const { step, project, replay } = createVersionedRulesRuntime({
  registrations: [ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST, VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST]
    .map((manifest) => ({ manifest, interpreterKind: "authoritative-v2" })),
  defaultManifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST.manifest,
});

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
  profiles = VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST,
  { includeRecipient = false, vNextSeed, additionalScenes = [] } = {},
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
    scenes: [{ id: SCENE, name: "封存药房", geometry: tacticalGeometry() }, ...additionalScenes],
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
    ...(vNextSeed === undefined ? {} : { vNextSeed }),
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


import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import { authorityRevisionOrHash } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { createInitialItemEntry, emptyItemSystemState, healingPotionItemDefinition, itemDefinitionFromStandardGear } from "../app/_runtime/lib/rules/v2/items.ts";
import { itemById } from "../app/_runtime/lib/dnd/gear.ts";
import { acquireItemQuantity, releaseItemQuantity, transferItemQuantity } from "../app/_runtime/lib/rules/v2/item-transitions.ts";
import { stepInventoryOperation, createInventoryAdjudicationGrant } from "../app/_runtime/lib/rules/v2/inventory-operations.ts";

function inventoryInput(state, rootActionId, operation, actorCharacterId = PLAYER) {
  const refs = [...new Set([actorCharacterId, operation.entryRef, SCENE,
    ...(operation.targetCharacterRef ? [operation.targetCharacterRef] : [])])];
  return { kind: "inventoryOperation", rootActionId, actorCharacterId, plan: {
    schema: "zhuwei.inventory-operation-plan/vnext-1", contextHash: `sha256:${"c".repeat(64)}`,
    readSet: refs.map((ref) => ({ ref, revisionOrHash: authorityRevisionOrHash(state, ref) })),
    basisRefs: [BASIS], summary: "按既定裁决移动或使用物品。", operation,
  } };
}

function materialize(scenario, definition, quantity = 1) {
  const result = step(scenario.profiles, scenario.state, {
    kind: "materializeItem", proposalId: `root:inventory:materialize:${definition.definitionId}`,
    actorCharacterId: PLAYER, definition, entryId: `item-entry:inventory:${definition.definitionId}`,
    quantity, sceneId: SCENE,
  });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return result;
}

function apply(scenario, previous, suffix, operation, actor = PLAYER) {
  const result = step(scenario.profiles, previous.state, inventoryInput(previous.state, `root:inventory:${suffix}`, operation, actor));
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return result;
}

function assertReplay(scenario, events, state) {
  const replayed = replay(scenario.genesis, events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  assert.deepEqual(replayed.state, state);
}

function withCombatFixture(scenario, configure) {
  const state = structuredClone(scenario.state);
  configure(state);
  const domain = { ...state }; delete domain.eventHeadHash; delete domain.lastEventId;
  const initialStateHash = canonicalSha256(domain);
  state.eventHeadHash = initialStateHash;
  const unsigned = { ...scenario.genesis, initialState: state, initialStateHash };
  delete unsigned.genesisHash;
  const genesis = { ...unsigned, genesisHash: canonicalSha256(unsigned) };
  const rebuilt = replay(genesis, []);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  return { ...scenario, state: rebuilt.state, genesis };
}

test("partial release, acquisition and transfer share homogeneous stack identities", () => {
  const definition = healingPotionItemDefinition();
  const itemSystem = emptyItemSystemState();
  itemSystem.definitions[definition.definitionId] = definition;
  const entry = createInitialItemEntry(definition, { entryId: "item-entry:inventory:stack", quantity: 5,
    placement: { kind: "held", holderRef: PLAYER, equippedSlot: null },
    visibilityPolicyRef: `visibility:character-controller:${PLAYER}`, ownership: { kind: "character", ownerRef: PLAYER } });
  itemSystem.entries[entry.entryId] = entry;
  const partial = releaseItemQuantity(itemSystem, { entryId: entry.entryId, holderRef: PLAYER,
    sceneRef: SCENE, quantity: 2, targetEntryId: "item-entry:inventory:dropped" });
  assert.equal("error" in partial, false, JSON.stringify(partial));
  assert.equal(partial.itemSystem.entries[entry.entryId].quantity, 3);
  assert.equal(partial.itemSystem.entries[partial.targetEntryId].quantity, 2);
  assert.equal(partial.itemSystem.entries[partial.targetEntryId].ownership.ownerRef, PLAYER);
  const more = releaseItemQuantity(partial.itemSystem, { entryId: entry.entryId, holderRef: PLAYER,
    sceneRef: SCENE, quantity: 1 });
  assert.equal(more.targetEntryId, partial.targetEntryId);
  const recovered = acquireItemQuantity(more.itemSystem, { entryId: more.targetEntryId, holderRef: PLAYER, quantity: 1 });
  assert.equal(recovered.targetEntryId, entry.entryId);
  assert.equal(recovered.itemSystem.entries[entry.entryId].quantity, 3);
  const wrongOwner = releaseItemQuantity(itemSystem, { entryId: entry.entryId, holderRef: RECIPIENT, sceneRef: SCENE, quantity: 1 });
  assert.equal(wrongOwner.error, "itemHolderMismatch");
  assert.equal(itemSystem.entries[entry.entryId].quantity, 5);
});

test("Rules release and re-acquire preserve entry identity and replay projection", () => {
  const scenario = initialize(undefined, { includeRecipient: true });
  const initial = materialize(scenario, healingPotionItemDefinition());
  const entryRef = Object.keys(initial.state.campaignRuntime.itemSystem.entries)[0];
  const dropped = apply(scenario, initial, "drop", { kind: "release", entryRef, quantity: 1, sceneRef: SCENE, releaseKind: "drop" });
  assert.equal(dropped.state.campaignRuntime.itemSystem.entries[entryRef].disposition, "scene");
  assert.equal(dropped.state.entities[PLAYER].loadout.backpack.length, 0);
  const projected = project(scenario.profiles, dropped.state, { kind: "player", principalId: RECIPIENT_PRINCIPAL,
    sessionVersion: 1, seatId: RECIPIENT_SEAT, characterId: RECIPIENT },
    { channel: "realtime", committedRange: { receiptId: dropped.receipt.receiptId, actorCharacterId: PLAYER,
      priorState: initial.state, events: dropped.events } });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  assert.ok(projected.visibleItems.some((item) => item.itemEntryId === entryRef && item.disposition === "scene"));
  const acquired = apply(scenario, dropped, "acquire", { kind: "acquire", entryRef, quantity: 1 }, RECIPIENT);
  assert.equal(acquired.state.campaignRuntime.itemSystem.entries[entryRef].holderRef, RECIPIENT);
  assert.equal(acquired.state.campaignRuntime.itemSystem.entries[entryRef].ownership.ownerRef, PLAYER);
  assertReplay(scenario, [...initial.events, ...dropped.events, ...acquired.events], acquired.state);
  const duplicate = stepInventoryOperation(scenario.profiles, dropped.state,
    inventoryInput(dropped.state, "root:inventory:drop", { kind: "acquire", entryRef, quantity: 1 }));
  assert.equal(duplicate.rejection.code, "duplicateRootAction");
});

test("equipment removal clears derived loadout and frozen combat abilities after its Activity", () => {
  const scenario = initialize();
  const initial = materialize(scenario, itemDefinitionFromStandardGear(itemById("longsword")));
  const entryRef = Object.keys(initial.state.campaignRuntime.itemSystem.entries)[0];
  const equipped = apply(scenario, initial, "equip", { kind: "equip", entryRef, action: "wear", slot: "main" });
  assert.equal(equipped.state.entities[PLAYER].loadout.equipped.main, entryRef);
  assert.deepEqual(equipped.events.slice(0, 3).map((event) => event.eventType), ["ActivityStarted", "FictionTimeAdvanced", "ActivityCompleted"]);
  const dropped = apply(scenario, equipped, "unequip-drop", { kind: "release", entryRef, quantity: 1, sceneRef: SCENE, releaseKind: "placement" });
  assert.equal(dropped.state.entities[PLAYER].loadout.equipped.main, undefined);
  assert.equal(dropped.state.combatRuntime.entities[PLAYER].abilityRefs.some((ref) => ref.includes(entryRef)), false);
  assertReplay(scenario, [...initial.events, ...equipped.events, ...dropped.events], dropped.state);
});

test("foreign holder, remote placement, stale readset and JSON-forged grant reject atomically", () => {
  const scenario = initialize(undefined, { includeRecipient: true });
  const initial = materialize(scenario, healingPotionItemDefinition());
  const entryRef = Object.keys(initial.state.campaignRuntime.itemSystem.entries)[0];
  const before = canonicalSha256(initial.state);
  const input = inventoryInput(initial.state, "root:inventory:theft", { kind: "transfer", entryRef, quantity: 1,
    targetCharacterRef: RECIPIENT, ownershipDisposition: "preserve" }, RECIPIENT);
  for (const options of [{}, { adjudicationGrant: { authorized: true, kind: "sharedCheckSuccess" } }]) {
    const denied = stepInventoryOperation(scenario.profiles, initial.state, input, options);
    assert.equal(denied.kind, "rejected"); assert.deepEqual(denied.events, []);
  }
  const remote = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:remote", {
    kind: "release", entryRef, quantity: 1, sceneRef: "scene:elsewhere", releaseKind: "loss" }));
  assert.equal(remote.kind, "rejected");
  const stale = inventoryInput(initial.state, "root:inventory:stale", { kind: "release", entryRef, quantity: 1, sceneRef: SCENE, releaseKind: "drop" });
  stale.plan.readSet[0].revisionOrHash = `sha256:${"0".repeat(64)}`;
  assert.equal(stepInventoryOperation(scenario.profiles, initial.state, stale).kind, "rejected");
  assert.equal(canonicalSha256(initial.state), before);
});

test("use executes the exact-entry healing Ability and consumes once after real dice", () => {
  const scenario = initialize();
  const initial = materialize(scenario, healingPotionItemDefinition());
  const entryRef = Object.keys(initial.state.campaignRuntime.itemSystem.entries)[0];
  const input = inventoryInput(initial.state, "root:inventory:use", { kind: "use", entryRef, targetRefs: [PLAYER] });
  const waiting = stepInventoryOperation(scenario.profiles, initial.state, input);
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  assert.deepEqual(waiting.randomnessRequests[0].dice, [{ count: "2", sides: "4" }]);
  assert.equal(waiting.state.campaignRuntime.itemSystem.entries[entryRef].quantity, 1);
  const resolved = step(scenario.profiles, waiting.state, {
    kind: "authoritativeRandomness", resolutionId: waiting.resolutionId, responseId: `authority-response:${waiting.resolutionId}`,
    continuationCapability: waiting.continuationCapability,
    randomnessResults: waiting.randomnessRequests.map((request) => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
      draws: request.dice.map(({ count, sides }) => ({ sides: Number(sides), faces: Array.from({ length: Number(count) }, () => 2) })) })),
  });
  assert.equal(resolved.kind, "committed", JSON.stringify(resolved));
  assert.equal(resolved.state.entities[PLAYER].hitPoints.current, 18);
  assert.equal(resolved.state.campaignRuntime.itemSystem.entries[entryRef].quantity, 0);
  assert.equal(resolved.state.campaignRuntime.itemSystem.entries[entryRef].disposition, "consumed");
  assert.equal(stepInventoryOperation(scenario.profiles, resolved.state, input).rejection.code, "duplicateRootAction");
  assertReplay(scenario, [...initial.events, ...waiting.events, ...resolved.events], resolved.state);
});


test("partial Rules transfer freezes the recipient exact-entry Ability and only merges matching ownership", () => {
  const scenario = initialize(undefined, { includeRecipient: true });
  const initial = materialize(scenario, healingPotionItemDefinition(), 5);
  const entryRef = Object.keys(initial.state.campaignRuntime.itemSystem.entries)[0];
  const transferred = apply(scenario, initial, "partial-transfer", { kind: "transfer", entryRef, quantity: 2,
    targetCharacterRef: RECIPIENT, ownershipDisposition: "preserve" });
  const destination = transferred.events.find((event) => event.eventType === "InventoryOperationApplied").payload.targetEntryId;
  assert.notEqual(destination, entryRef);
  assert.equal(transferred.state.campaignRuntime.itemSystem.entries[entryRef].quantity, 3);
  assert.equal(transferred.state.campaignRuntime.itemSystem.entries[destination].quantity, 2);
  assert.ok(transferred.state.combatRuntime.entities[RECIPIENT].abilityRefs.some((ref) => ref.endsWith(destination)));
  const merged = apply(scenario, transferred, "partial-transfer-merge", { kind: "transfer", entryRef, quantity: 1,
    targetCharacterRef: RECIPIENT, ownershipDisposition: "preserve" });
  assert.equal(merged.state.campaignRuntime.itemSystem.entries[destination].quantity, 3);
  const owned = apply(scenario, merged, "partial-transfer-owner", { kind: "transfer", entryRef, quantity: 1,
    targetCharacterRef: RECIPIENT, ownershipDisposition: "transferToRecipient" });
  const newDestination = owned.events.find((event) => event.eventType === "InventoryOperationApplied").payload.targetEntryId;
  assert.notEqual(newDestination, destination);
  assert.equal(owned.state.campaignRuntime.itemSystem.entries[newDestination].ownership.ownerRef, RECIPIENT);
  assertReplay(scenario, [...initial.events, ...transferred.events, ...merged.events, ...owned.events], owned.state);
});

test("lifecycle and opaque dropped-item projection preserve the same authoritative entry", () => {
  const scenario = initialize(undefined, { includeRecipient: true });
  const definition = itemDefinitionFromStandardGear(itemById("longsword"));
  definition.visibilityPolicyRef = `visibility:character-controller:${PLAYER}`;
  const initial = materialize(scenario, definition);
  const entryRef = Object.keys(initial.state.campaignRuntime.itemSystem.entries)[0];
  const broken = apply(scenario, initial, "break", { kind: "lifecycle", entryRef, action: "break" });
  assert.equal(broken.state.campaignRuntime.itemSystem.entries[entryRef].condition, "broken");
  const repaired = apply(scenario, broken, "repair", { kind: "lifecycle", entryRef, action: "repair" });
  assert.equal(repaired.state.campaignRuntime.itemSystem.entries[entryRef].condition, "usable");
  const dropped = apply(scenario, repaired, "private-drop", { kind: "release", entryRef, quantity: 1, sceneRef: SCENE, releaseKind: "drop" });
  const projected = project(scenario.profiles, dropped.state, { kind: "player", principalId: RECIPIENT_PRINCIPAL,
    sessionVersion: 1, seatId: RECIPIENT_SEAT, characterId: RECIPIENT },
    { channel: "realtime", committedRange: { receiptId: dropped.receipt.receiptId, actorCharacterId: PLAYER,
      priorState: repaired.state, events: dropped.events } });
  const visible = projected.visibleItems.find((item) => item.itemEntryId === entryRef);
  assert.equal(visible.kind, "opaque"); assert.equal(visible.name, undefined); assert.equal(visible.definitionRef, undefined);
  const outcome = projected.renderableClaims.claims.find(claim => claim.kind === "inventoryOutcome");
  assert.ok(outcome);
  assert.match(outcome.summary, /1 件该物品/);
  assert.equal(JSON.stringify(outcome).includes(definition.content.label), false);
  assert.equal(JSON.stringify(outcome).includes(JSON.stringify(definition.definitionId)), false);
  const destroyed = apply(scenario, dropped, "destroy", { kind: "lifecycle", entryRef, action: "destroy" });
  assert.equal(destroyed.state.campaignRuntime.itemSystem.entries[entryRef].disposition, "destroyed");
  assertReplay(scenario, [...initial.events, ...broken.events, ...repaired.events, ...dropped.events, ...destroyed.events], destroyed.state);
});


test("only a successful same-root shared check grants a foreign-held transfer and replay verifies its proof", () => {
  const definition = itemDefinitionFromStandardGear(itemById("longsword"));
  const entry = createInitialItemEntry(definition, { entryId: "item-entry:inventory:contested-blade", quantity: 1,
    placement: { kind: "held", holderRef: PLAYER, equippedSlot: null }, ownership: { kind: "character", ownerRef: PLAYER },
    visibilityPolicyRef: "visibility:public" });
  const scenario = initialize(VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST, { includeRecipient: true,
    vNextSeed: { semanticDefinitions: [], itemDefinitions: [definition], itemEntries: [{ definitionRef: definition.definitionId, entry: {
      entryId: entry.entryId, quantity: 1, placement: { kind: "held", holderRef: PLAYER, equippedSlot: null },
      ownership: entry.ownership, visibilityPolicyRef: "visibility:public" } }], entityDefinitionBindings: [] } });
  const rootActionId = "root:inventory:contested-transfer";
  const contextHash = `sha256:${"c".repeat(64)}`;
  const refs = [RECIPIENT, PLAYER, SCENE, entry.entryId].sort();
  const branch = (outcomeCode) => ({ outcomeCode, summary: "冻结裁决结果", effects: [], sensoryEvidence: [], pressures: [], opportunities: [] });
  const plan = { schema: "zhuwei.world-interaction-resolution-plan/v1", resolutionId: "resolution:inventory:contest",
    interactionRef: "interaction:inventory:contest", actorCharacterId: RECIPIENT, sceneRef: SCENE, abilityRef: null, contextHash,
    readSet: refs.map((ref) => ({ ref, revisionOrHash: authorityRevisionOrHash(scenario.state, ref) })),
    targetRefs: [entry.entryId], directTargetRefs: [entry.entryId], instrumentRefs: [], basisRefs: [entry.entryId],
    intent: "取回手中的物品", method: "准确把握松手的时机", costs: [],
    ruling: { kind: "check", resolutionKind: "abilityCheck", randomnessId: "randomness:inventory:contest",
      check: { kind: "skill", ability: "dexterity", skill: "sleight", dc: "10", modifier: "2", mode: "normal", costs: [],
        goal: "取得物品", method: "把握时机", risk: "未能拿到", successOutcome: "取得物品", failureOutcome: "物品保持原状" } },
    branches: { success: branch("inventory:success"), failure: branch("inventory:failure") } };
  const waiting = step(scenario.profiles, scenario.state, { kind: "resolveWorldInteraction", rootActionId, actorCharacterId: RECIPIENT, plan });
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  const resolved = step(scenario.profiles, waiting.state, { kind: "fulfillAuthoritativeRandomness", continuation: waiting.continuation, rolls: [20] });
  assert.equal(resolved.kind, "committed", JSON.stringify(resolved));
  const event = resolved.events.find((event) => event.eventType === "WorldInteractionResolved");
  const binding = { rootActionId, actorCharacterId: RECIPIENT, contextHash, outcomeBinding: "onSuccess" };
  const grant = createInventoryAdjudicationGrant(resolved.state, event, binding);
  assert.ok(grant);
  assert.equal(createInventoryAdjudicationGrant(resolved.state, event, { ...binding, rootActionId: "root:unrelated" }), undefined);
  assert.equal(createInventoryAdjudicationGrant(resolved.state, event, { ...binding, outcomeBinding: "always" }), undefined);
  const input = inventoryInput(resolved.state, rootActionId, { kind: "transfer", entryRef: entry.entryId, quantity: 1,
    targetCharacterRef: RECIPIENT, ownershipDisposition: "preserve" }, RECIPIENT);
  const forged = stepInventoryOperation(scenario.profiles, resolved.state, input, { continuedRoot: true, adjudicationGrant: JSON.parse(JSON.stringify(grant)) });
  assert.equal(forged.kind, "rejected");
  const transferred = stepInventoryOperation(scenario.profiles, resolved.state, input, { continuedRoot: true, adjudicationGrant: grant });
  assert.equal(transferred.kind, "committed", JSON.stringify(transferred));
  assert.equal(transferred.state.campaignRuntime.itemSystem.entries[entry.entryId].holderRef, RECIPIENT);
  assert.equal(transferred.state.campaignRuntime.itemSystem.entries[entry.entryId].ownership.ownerRef, PLAYER);
  assertReplay(scenario, [...waiting.events, ...resolved.events, ...transferred.events], transferred.state);
  const tampered = structuredClone(event); tampered.payload.check.succeeded = false;
  assert.equal(createInventoryAdjudicationGrant(resolved.state, tampered, binding), undefined);
});

function authoredUseItem(scenario, suffix, mechanic) {
  const abilityRef = `ability:inventory:authored-${suffix}`;
  const registered = step(scenario.profiles, scenario.state, { kind: "registerDynamicDefinition",
    proposalId: `root:inventory:register-${suffix}`, definition: {
      definitionId: abilityRef, definitionKind: "ability", revision: "1", rulesBasis: "srd5.1-2014",
      activation: { kind: "useObject", actionGrant: "normalAction" }, ...mechanic,
    } });
  assert.equal(registered.kind, "committed", JSON.stringify(registered));
  const definition = healingPotionItemDefinition();
  definition.definitionId = `item-definition:inventory:authored-${suffix}`;
  definition.content.label = "自定义器具";
  definition.content.use.abilityRef = abilityRef;
  const initial = materialize({ ...scenario, state: registered.state }, definition);
  return { ...initial, events: [...registered.events, ...initial.events],
    entryRef: Object.values(initial.state.campaignRuntime.itemSystem.entries).find((entry) => entry.definitionRef === definition.definitionId).entryId };
}

function resolveItemDice(scenario, waiting, face = 3) {
  return step(scenario.profiles, waiting.state, {
    kind: "authoritativeRandomness", resolutionId: waiting.resolutionId, responseId: `authority-response:${waiting.resolutionId}`,
    continuationCapability: waiting.continuationCapability,
    randomnessResults: waiting.randomnessRequests.map((request) => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
      draws: request.dice.map(({ count, sides }) => ({ sides: Number(sides), faces: Array.from({ length: Number(count) }, (_, index) => Math.min(typeof face === "function" ? face(request, index) : face, Number(sides))) })) })),
  });
}

test("authored area item delegates geometry and two independent saves while spending its item only once", () => {
  const scenario = initialize(undefined, { includeRecipient: true });
  const initial = authoredUseItem(scenario, "area", {
    target: { kind: "area", rangeInches: "900", shape: { kind: "sphere", radiusInches: "720", propagation: "straight" } },
    save: { ability: "dex", dc: "10", halfOnSuccess: true }, damage: [{ type: "force", formula: "1d4" }],
  });
  const operation = { kind: "use", entryRef: initial.entryRef, targetRefs: [],
    area: { origin: { x: "120", y: "180", elevation: "0" } } };
  const waiting = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:area-use", operation));
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  assert.equal(waiting.randomnessRequests.filter((request) => request.purposeKey.startsWith("save:")).length, 2);
  assert.equal(waiting.randomnessRequests.filter((request) => request.purposeKey.startsWith("damage:")).length, 1);
  const resolved = resolveItemDice(scenario, waiting);
  assert.equal(resolved.kind, "committed", JSON.stringify(resolved));
  assert.deepEqual(resolved.mechanicalResult.area.affectedEntityIds.sort(), [PLAYER, RECIPIENT].sort());
  assert.equal(resolved.state.entities[PLAYER].hitPoints.current, 9);
  assert.equal(resolved.state.entities[RECIPIENT].hitPoints.current, 5);
  assert.equal(resolved.events.filter((event) => event.eventType === "ItemUsed").length, 1);
  assert.equal(resolved.state.campaignRuntime.itemSystem.entries[initial.entryRef].quantity, 0);
  assertReplay(scenario, [...initial.events, ...waiting.events, ...resolved.events], resolved.state);
  const forbidden = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:forged-area-targets", { ...operation, targetRefs: [PLAYER] }));
  assert.equal(forbidden.kind, "rejected");
  const remote = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:remote-area", {
    ...operation, area: { origin: { x: "9000", y: "180", elevation: "0" } } }));
  assert.equal(remote.kind, "rejected"); assert.deepEqual(remote.events, []);
});

test("effect-only Item applies and ends grants in frozen order for multiple creatures", () => {
  const scenario = initialize(undefined, { includeRecipient: true });
  const initial = authoredUseItem(scenario, "ordered-effects", {
    target: { kind: "creature", count: "2", rangeInches: "900" },
    effects: [
      { kind: "grantEffect", condition: "blinded", duration: { kind: "untilEnded" } },
      { kind: "endEffect", condition: "blinded", sourceRef: null },
      { kind: "grantEffect", condition: "poisoned", duration: { kind: "timed", durationMicros: "60000000" } },
    ],
  });
  const used = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:ordered-effects", {
    kind: "use", entryRef: initial.entryRef, targetRefs: [PLAYER, RECIPIENT],
  }));
  assert.equal(used.kind, "committed", JSON.stringify(used));
  assert.equal(used.events.filter((event) => event.eventType === "EffectApplied").length, 4);
  assert.equal(used.events.filter((event) => event.eventType === "EffectEnded").length, 2);
  assert.deepEqual(Object.values(used.state.combatRuntime.effects).map((effect) => effect.condition), ["poisoned", "poisoned"]);
  assert.equal(used.state.campaignRuntime.itemSystem.entries[initial.entryRef].quantity, 0);
  assert.equal(used.events.filter((event) => event.eventType === "ActivityStarted").length, 1);
  assertReplay(scenario, [...initial.events, ...used.events], used.state);
});

test("healing Item retains its additional frozen condition effects", () => {
  const scenario = initialize();
  const initial = authoredUseItem(scenario, "recovery-effect", {
    target: { kind: "creature", count: "1", rangeInches: "900" },
    healing: { formula: "1d4" },
    effect: { kind: "grantEffect", condition: "invisible", duration: { kind: "untilEnded" } },
  });
  const waiting = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:recovery-effect", {
    kind: "use", entryRef: initial.entryRef, targetRefs: [PLAYER],
  }));
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  const used = resolveItemDice(scenario, waiting, 2);
  assert.equal(used.kind, "committed", JSON.stringify(used));
  assert.equal(used.state.entities[PLAYER].hitPoints.current, 14);
  assert.ok(Object.values(used.state.combatRuntime.effects).some((effect) => effect.condition === "invisible"));
  assertReplay(scenario, [...initial.events, ...waiting.events, ...used.events], used.state);
});

test("multiple attacks freeze critical reserve before hit results and apply only each target's dice", () => {
  const scenario = initialize(undefined, { includeRecipient: true });
  const initial = authoredUseItem(scenario, "multi-attack", {
    target: { kind: "creature", count: "2", rangeInches: "900" },
    attack: { ability: "str", proficient: true },
    damage: [{ type: "force", formula: "1d4+1" }, { type: "fire", formula: "1d4" }],
  });
  const waiting = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:multi-attack", {
    kind: "use", entryRef: initial.entryRef, targetRefs: [PLAYER, RECIPIENT],
  }));
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  assert.equal(waiting.randomnessRequests.filter((request) => request.purposeKey.startsWith("attack:")).length, 2);
  for (const request of waiting.randomnessRequests.filter((request) => request.purposeKey.startsWith("damage:"))) {
    assert.deepEqual(request.dice, [{ count: "2", sides: "4" }, { count: "2", sides: "4" }]);
  }
  for (const attackRoll of [1, 15, 20]) {
    const used = resolveItemDice(scenario, waiting, (request) => request.purposeKey.startsWith("attack:") ? attackRoll : 1);
    assert.equal(used.kind, "committed", JSON.stringify(used));
    assert.equal(used.state.entities[PLAYER].hitPoints.current, 12 - (attackRoll === 1 ? 0 : attackRoll === 20 ? 5 : 3));
    assert.equal(used.state.entities[RECIPIENT].hitPoints.current, 8 - (attackRoll === 1 ? 0 : attackRoll === 20 ? 5 : 3));
    assert.equal(used.state.campaignRuntime.itemSystem.entries[initial.entryRef].quantity, 0);
    assertReplay(scenario, [...initial.events, ...waiting.events, ...used.events], used.state);
  }
});

test("automatic Dexterity save failure requests no die and only failed targets receive the effect", () => {
  const scenario = withCombatFixture(initialize(undefined, { includeRecipient: true }), (state) => {
    state.combatRuntime.entities[RECIPIENT].conditions = { paralyzed: true };
  });
  const initial = authoredUseItem(scenario, "condition-save", {
    target: { kind: "creature", count: "2", rangeInches: "900" },
    save: { ability: "dex", dc: "10", halfOnSuccess: false },
    damage: [{ type: "force", formula: "1d4" }],
    effect: { kind: "grantEffect", condition: "blinded", duration: { kind: "untilEnded" } },
  });
  const waiting = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:condition-save", {
    kind: "use", entryRef: initial.entryRef, targetRefs: [PLAYER, RECIPIENT],
  }));
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  const saves = waiting.randomnessRequests.filter((request) => request.purposeKey.startsWith("save:"));
  assert.equal(saves.length, 1); assert.equal(saves[0].frozenParameters.targetEntityId, PLAYER);
  const used = resolveItemDice(scenario, waiting, (request) => request.purposeKey.startsWith("save:") ? 20 : 2);
  assert.equal(used.kind, "committed", JSON.stringify(used));
  assert.equal(used.mechanicalResult.saves[RECIPIENT].automaticFailure, true);
  assert.equal(used.mechanicalResult.saves[RECIPIENT].roll, null);
  assert.equal(used.mechanicalResult.saves[RECIPIENT].total, null);
  assert.equal(used.state.entities[PLAYER].hitPoints.current, 12);
  assert.equal(used.state.entities[RECIPIENT].hitPoints.current, 6);
  assert.deepEqual(Object.values(used.state.combatRuntime.effects).map((effect) => effect.targetEntityId), [RECIPIENT]);
  assertReplay(scenario, [...initial.events, ...waiting.events, ...used.events], used.state);
});

test("concentration reserves keep the initial batch fixed across miss, damage and critical DCs", () => {
  const scenario = withCombatFixture(initialize(undefined, { includeRecipient: true }), (state) => {
    state.combatRuntime.entities[RECIPIENT].concentration = { abilityRef: "spell:fixture-concentration" };
    state.combatRuntime.entities[RECIPIENT].hitPoints = { current: "60", maximum: "60", temporary: "0" };
    state.entities[RECIPIENT].hitPoints = { current: 60, maximum: 60 };
  });
  const initial = authoredUseItem(scenario, "concentration-reserve", {
    target: { kind: "creature", count: "1", rangeInches: "900" },
    attack: { ability: "str", proficiency: true },
    damage: [{ type: "force", formula: "4d4" }],
    effect: { kind: "grantEffect", condition: "blinded", duration: { kind: "untilEnded" } },
  });
  const waiting = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:concentration-reserve", {
    kind: "use", entryRef: initial.entryRef, targetRefs: [RECIPIENT],
  }));
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  assert.equal(waiting.randomnessRequests.filter((request) => request.frozenParameters.potentialDamage === true).length, 1);
  for (const attackRoll of [1, 15, 20]) {
    const used = resolveItemDice(scenario, waiting, (request) => request.purposeKey.startsWith("attack:") ? attackRoll
      : request.purposeKey.startsWith("damage:") ? 4 : 11);
    assert.equal(used.kind, "committed", JSON.stringify(used));
    assert.equal(used.events.filter((event) => event.eventType === "RandomnessRequested").length, 0);
    const tested = used.events.find((event) => event.eventType === "ConcentrationTested");
    if (attackRoll === 1) assert.equal(tested, undefined);
    else {
      assert.equal(tested.payload.dc, attackRoll === 20 ? 16 : 10);
      assert.equal(tested.payload.succeeded, attackRoll !== 20);
      assert.ok(used.events.indexOf(tested) < used.events.findIndex((event) => event.eventType === "EffectApplied"));
    }
    assertReplay(scenario, [...initial.events, ...waiting.events, ...used.events], used.state);
  }
});

test("ordinary spell Ability retains critical reserves and applies its condition after damage", () => {
  const initialized = initialize(undefined, { includeRecipient: true });
  const abilityRef = "ability:inventory:ordinary-spell";
  const registered = step(initialized.profiles, initialized.state, { kind: "registerDynamicDefinition", proposalId: "root:inventory:ordinary-spell-definition", definition: {
    definitionId: abilityRef, definitionKind: "ability", revision: "1", rulesBasis: "srd5.1-2014",
    activation: { kind: "actionSpell", spellLevel: "0" },
    target: { kind: "creature", count: "1", rangeInches: "900" },
    attack: { kind: "spellAttack" },
    damage: [{ type: "force", formula: "1d4+1" }, { type: "fire", formula: "1d4" }],
    effect: { kind: "grantEffect", condition: "blinded", duration: { kind: "untilEnded" } },
  } });
  assert.equal(registered.kind, "committed", JSON.stringify(registered));
  const scenario = withCombatFixture(initialized, (state) => {
    state.combatRuntime.definitions[abilityRef] = registered.state.combatRuntime.definitions[abilityRef];
    state.campaignRuntime.definitions[abilityRef] = registered.state.campaignRuntime.definitions[abilityRef];
    state.combatRuntime.entities[PLAYER].abilityRefs.push(abilityRef);
    state.combatRuntime.entities[PLAYER].spellcasting = { ability: "int", spellAttackBonus: "3", spellSaveDc: "11" };
  });
  const waiting = step(scenario.profiles, scenario.state, { kind: "invokeAbility", rootActionId: "root:inventory:ordinary-spell",
    sourceEntityId: PLAYER, abilityRef, parameters: { targetEntityId: RECIPIENT } });
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  const used = resolveItemDice(scenario, waiting, (request) => request.purposeKey.startsWith("attack:") ? 20 : 1);
  assert.equal(used.kind, "committed", JSON.stringify(used));
  assert.equal(used.state.entities[RECIPIENT].hitPoints.current, 3);
  assert.equal(used.events.filter((event) => event.eventType === "SpellResolved").length, 1);
  assert.ok(Object.values(used.state.combatRuntime.effects).some((effect) => effect.condition === "blinded"));
  assertReplay(scenario, [...waiting.events, ...used.events], used.state);
});

test("multiple Shield decisions reuse the original damage reserve without repeating Item costs", () => {
  const initialized = initialize(undefined, { includeRecipient: true });
  const abilityRef = "spell:shield";
  const otherTarget = "character:item-materialization-v5:second-mage";
  const registered = step(initialized.profiles, initialized.state, { kind: "registerDynamicDefinition", proposalId: "root:inventory:shield-definition", definition: {
    definitionId: abilityRef, definitionKind: "ability", revision: "1", rulesBasis: "srd5.1-2014",
    mechanicalKey: "shield", activation: { kind: "reactionSpell", spellLevel: "1" },
    costs: [{ kind: "spellSlot", level: "1", amount: "1" }],
    effect: { kind: "shield", duration: "untilOwnNextTurnStart", armorClassBonus: "5", magicMissileImmunity: true },
  } });
  assert.equal(registered.kind, "committed", JSON.stringify(registered));
  const scenario = withCombatFixture(initialized, (state) => {
    state.combatRuntime.definitions[abilityRef] = registered.state.combatRuntime.definitions[abilityRef];
    state.campaignRuntime.definitions[abilityRef] = registered.state.campaignRuntime.definitions[abilityRef];
    state.entities[otherTarget] = { ...structuredClone(state.entities[RECIPIENT]), id: otherTarget, name: "第二位法师" };
    state.combatRuntime.entities[otherTarget] = { ...structuredClone(state.combatRuntime.entities[RECIPIENT]), id: otherTarget, entityId: otherTarget, entityOrdinal: "3" };
    for (const target of [RECIPIENT, otherTarget]) {
      state.combatRuntime.entities[target].abilityRefs.push(abilityRef);
      state.combatRuntime.entities[target].resources["spellSlot:1"] = { current: "2", maximum: "2" };
      state.entities[target].resources["spellSlot:1"] = 2;
      state.entities[target].resourceMaximums["spellSlot:1"] = 2;
    }
  });
  const initial = authoredUseItem(scenario, "multi-shield", {
    target: { kind: "creature", count: "2", rangeInches: "900" },
    attack: { ability: "str", proficiency: true }, damage: [{ type: "force", formula: "1d4" }],
  });
  const waiting = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:multi-shield", {
    kind: "use", entryRef: initial.entryRef, targetRefs: [RECIPIENT, otherTarget],
  }));
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  let result = resolveItemDice(scenario, waiting, (request) => request.purposeKey.startsWith("attack:") ? 10 : 2);
  const events = [...initial.events, ...waiting.events, ...result.events];
  for (const target of [RECIPIENT, otherTarget]) {
    assert.equal(result.kind, "awaitingInput", JSON.stringify(result));
    assert.equal(result.pending.targetEntityId, target);
    result = step(scenario.profiles, result.state, { kind: "answerPendingInput", pendingInputId: result.pending.pendingInputId,
      responseId: `response:inventory:shield:${target}`, answer: { kind: "useReaction", abilityRef: result.pending.candidateAbilityRefs[0], slotLevel: "1" } });
    events.push(...result.events);
  }
  assert.equal(result.kind, "committed", JSON.stringify(result));
  assert.equal(result.state.entities[otherTarget].hitPoints.current, 8);
  assert.equal(result.state.entities[RECIPIENT].hitPoints.current, 8);
  assert.equal(events.filter((event) => event.eventType === "ItemUsed").length, 1);
  assert.equal(events.filter((event) => event.eventType === "RandomnessRequested").length, waiting.events.filter((event) => event.eventType === "RandomnessRequested").length);
  assertReplay(scenario, events, result.state);
});

test("every melee target reduced to zero gets its own knock-out choice before damage commits", () => {
  const scenario = withCombatFixture(initialize(undefined, { includeRecipient: true }), (state) => {
    for (const id of [PLAYER, RECIPIENT]) {
      state.entities[id].hitPoints = { current: 1, maximum: 20 };
      state.combatRuntime.entities[id].hitPoints = { current: "1", maximum: "20", temporary: "0" };
    }
  });
  const initial = authoredUseItem(scenario, "multi-knockout", {
    target: { kind: "creature", count: "2", reachInches: "900" },
    attack: { ability: "str", proficiency: true }, damage: [{ type: "force", formula: "1d4" }],
    effect: { kind: "grantEffect", condition: "blinded", duration: { kind: "untilEnded" } },
  });
  const waiting = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:multi-knockout", {
    kind: "use", entryRef: initial.entryRef, targetRefs: [PLAYER, RECIPIENT],
  }));
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  let result = resolveItemDice(scenario, waiting, (request) => request.purposeKey.startsWith("attack:") ? 15 : 2);
  const events = [...initial.events, ...waiting.events, ...result.events];
  assert.equal(result.kind, "awaitingInput", JSON.stringify(result));
  assert.equal(result.state.entities[PLAYER].hitPoints.current, 1);
  assert.equal(result.state.entities[RECIPIENT].hitPoints.current, 1);
  for (const target of [PLAYER, RECIPIENT]) {
    assert.equal(result.kind, "awaitingInput", JSON.stringify(result));
    assert.equal(result.pending.targetEntityId, target);
    result = step(scenario.profiles, result.state, { kind: "answerPendingInput", pendingInputId: result.pending.pendingInputId,
      responseId: `response:inventory:knockout:${target}`, answer: { kind: "dealLethalDamage" } });
    events.push(...result.events);
  }
  assert.equal(result.kind, "committed", JSON.stringify(result));
  assert.equal(result.state.entities[PLAYER].hitPoints.current, 0);
  assert.equal(result.state.entities[RECIPIENT].hitPoints.current, 0);
  assert.equal(events.filter((event) => event.eventType === "ItemUsed").length, 1);
  assert.equal(events.filter((event) => event.eventType === "EffectApplied").length, 2);
  assertReplay(scenario, events, result.state);
});

test("incapacitated actors cannot acquire an item through the shared inventory transition",()=>{
  const scenario=initialize(),created=materialize(scenario,healingPotionItemDefinition());
  const entry=Object.values(created.state.campaignRuntime.itemSystem.entries).find(entry=>entry.definitionRef===HEALING_POTION_ITEM_DEFINITION_ID);
  const released=step(scenario.profiles,created.state,inventoryInput(created.state,'root:inventory:before-stun',
    {kind:'release',entryRef:entry.entryId,quantity:1,sceneRef:SCENE,releaseKind:'placement'}));
  assert.equal(released.kind,'committed',JSON.stringify(released));
  const frozen=structuredClone(released.state);
  frozen.combatRuntime.entities[PLAYER].conditions={stunned:true};
  const result=step(scenario.profiles,frozen,inventoryInput(frozen,'root:inventory:stunned',{kind:'acquire',entryRef:entry.entryId,quantity:1}));
  assert.equal(result.kind,'rejected');
  assert.deepEqual(result.events,[]);
  assert.equal(frozen.campaignRuntime.itemSystem.entries[entry.entryId].disposition,'scene');
});

test("committed inventory outcomes reach authorized Viewer Claims without the internal event envelope", () => {
  for (const [gearId, quantity, policy] of [
    ['bolt', 20, 'visibility:scene-observers'],
    ['rope-50ft', 1, 'visibility:scene-observers'],
    ['bolt', 20, `visibility:character-controller:${PLAYER}`],
  ]) {
    const definition = itemDefinitionFromStandardGear(itemById(gearId));
    const entry = createInitialItemEntry(definition, { entryId: `item-entry:claims:${gearId}`, quantity,
      placement: { kind: 'held', holderRef: PLAYER, equippedSlot: null },
      visibilityPolicyRef: policy, ownership: { kind: 'character', ownerRef: PLAYER } });
    const scenario = initialize(undefined, { includeRecipient: true, vNextSeed: {
      semanticDefinitions: [], itemDefinitions: [definition], itemEntries: [{ definitionRef: definition.definitionId, entry: {
        entryId: entry.entryId, quantity, placement: { kind: "held", holderRef: PLAYER, equippedSlot: null },
        ownership: entry.ownership, visibilityPolicyRef: policy } }], entityDefinitionBindings: [],
    } });
    const result = apply(scenario, scenario, 'claims-release', {
      kind: 'release', entryRef: entry.entryId, quantity: 1, sceneRef: SCENE, releaseKind: 'placement',
    });
    const releasedRef = result.events.find(event => event.eventType === 'InventoryOperationApplied').payload.targetEntryId;
    const view = (characterId, principalId, seatId) => project(scenario.profiles, result.state,
      { kind: 'player', characterId, principalId, seatId, sessionVersion: 1 },
      { channel: 'realtime', committedRange: { receiptId: result.receipt.receiptId, actorCharacterId: PLAYER,
        priorState: scenario.state, events: result.events } });
    const actorView = view(PLAYER, PRINCIPAL, SEAT);
    assert.equal(actorView.kind, 'projected', JSON.stringify(actorView));
    const claim = actorView.renderableClaims.claims.find(claim => claim.kind === 'inventoryOutcome' && claim.itemRef === releasedRef);
    assert.ok(claim, 'the actual placement must be narrated, not only actionCommitted');
    assert.equal(claim.itemRef, releasedRef);
    assert.match(claim.summary, /1/);
    assert.ok(claim.narrationFacts.some(text => text.includes(definition.content.label)));
    assert.equal(claim.operation.actorRef, PLAYER);
    assert.ok(claim.narrationFacts.includes(`${claim.displayNames[PLAYER] ?? '行动角色'}已将 1 件${definition.content.label}放置在场景中`));
    assert.equal(JSON.stringify(claim).includes('room-authority-only'), false);
    assert.equal(JSON.stringify(claim).includes('contextHash'), false);
    const other = view(RECIPIENT, RECIPIENT_PRINCIPAL, RECIPIENT_SEAT);
    assert.equal(other.kind, 'projected', JSON.stringify(other));
    assert.ok(other.renderableClaims.claims.some(claim => claim.kind === 'inventoryOutcome' && claim.itemRef === releasedRef));
    if (quantity > 1) {
      const source = actorView.renderableClaims.claims.find(claim => claim.kind === 'inventoryOutcome' && claim.itemRef === entry.entryId);
      assert.ok(source);
      assert.equal(source.state, undefined, 'the remaining held stack was not put down');
      assert.equal(other.renderableClaims.claims.some(claim => claim.kind === 'inventoryOutcome' && claim.itemRef === entry.entryId), policy === 'visibility:scene-observers');
    }
    assertReplay(scenario, result.events, result.state);
  }
});

test("transfer Claims keep each participant's own stack identity across splits and full merges", () => {
  const scenario = initialize(undefined, { includeRecipient: true });
  const initial = materialize(scenario, itemDefinitionFromStandardGear(itemById('bolt')), 20);
  const sourceRef = Object.keys(initial.state.campaignRuntime.itemSystem.entries)[0];
  let previous = initial, targetRef;
  const events = [...initial.events];
  for (const quantity of [7, 2, 11]) {
    const result = apply(scenario, previous, `claims-transfer-${quantity}`, { kind: 'transfer', entryRef: sourceRef,
      quantity, targetCharacterRef: RECIPIENT, ownershipDisposition: 'transferToRecipient' });
    targetRef ??= result.events.find(event => event.eventType === 'InventoryOperationApplied').payload.targetEntryId;
    for (const [characterId, principalId, seatId, ownRef, privateRef] of [
      [PLAYER, PRINCIPAL, SEAT, sourceRef, targetRef],
      [RECIPIENT, RECIPIENT_PRINCIPAL, RECIPIENT_SEAT, targetRef, sourceRef],
    ]) {
      const view = project(scenario.profiles, result.state, { kind: 'player', characterId, principalId, seatId, sessionVersion: 1 },
        { channel: 'realtime', committedRange: { receiptId: result.receipt.receiptId, actorCharacterId: PLAYER,
          priorState: previous.state, events: result.events } });
      assert.equal(view.kind, 'projected', JSON.stringify(view));
      const claims = view.renderableClaims.claims.filter(claim => claim.kind === 'inventoryOutcome');
      assert.equal(claims.length, 1, JSON.stringify(claims));
      assert.equal(claims[0].itemRef, ownRef);
      assert.equal(claims[0].operation.actorRef, PLAYER);
      assert.equal(claims[0].operation.recipientRef, RECIPIENT);
      assert.ok(claims[0].narrationFacts.includes(`${claims[0].displayNames[PLAYER] ?? '行动角色'}已将 ${quantity} 件${claims[0].displayNames[ownRef] ?? '该物品'}交给${claims[0].displayNames[RECIPIENT] ?? '接收角色'}`));
      assert.match(claims[0].summary, new RegExp(`${quantity} 件`));
      assert.equal(claims[0].quantity, undefined, 'do not invent per-event before/after totals from a whole committed range');
      assert.equal(JSON.stringify(claims).includes(privateRef), false);
    }
    previous = result; events.push(...result.events);
  }
  assert.equal(previous.state.campaignRuntime.itemSystem.entries[sourceRef], undefined);
  assert.equal(previous.state.campaignRuntime.itemSystem.entries[targetRef].quantity, 20);
  assertReplay(scenario, events, previous.state);
});

test("Rules inventory reference diagnostics hide missing and unavailable ground entries without mutation", () => {
  for (const definition of [healingPotionItemDefinition(), itemDefinitionFromStandardGear(itemById("rope-50ft"))]) {
    const remoteScene = "scene:inventory-diagnostics:private-room";
    const entries = [
      { entryId: "item-entry:inventory-diagnostics:available", sceneRef: SCENE, policy: "visibility:public" },
      { entryId: "item-entry:inventory-diagnostics:hidden-local", sceneRef: SCENE, policy: `visibility:character-controller:${RECIPIENT}` },
      { entryId: "item-entry:inventory-diagnostics:hidden-remote", sceneRef: remoteScene, policy: `visibility:character-controller:${RECIPIENT}` },
    ];
    const scenario = initialize(undefined, { includeRecipient: true,
      additionalScenes: [{ id: remoteScene, name: "未公开的私人房间" }],
      vNextSeed: { semanticDefinitions: [], itemDefinitions: [definition], entityDefinitionBindings: [],
        itemEntries: entries.map(({ entryId, sceneRef, policy }) => ({ definitionRef: definition.definitionId,
          entry: { entryId, quantity: 1, placement: { kind: "scene", sceneRef },
            ownership: { kind: "unowned", ownerRef: null }, visibilityPolicyRef: policy } })),
      },
    });
    const before = structuredClone(scenario.state);
    const beforeHash = canonicalSha256(scenario.state);
    const unavailableRefs = [definition.definitionId, "item-entry:inventory-diagnostics:missing", entries[1].entryId, entries[2].entryId];
    const expectedRejection = { code: "invalidRulesInput", message: "inventoryReferenceUnavailable", diagnostics: [{
      code: "REFERENCE_UNAVAILABLE", path: "/plan/operation/entryRef",
      constraint: "inventory:entry-ref-must-resolve-to-item-entry", expected: { referenceKind: "itemEntry" },
      message: "The inventory operation entryRef must resolve to an ItemEntry instance.",
      source: "SPEC 0013", visibility: "public",
    }] };
    for (const [index, entryRef] of unavailableRefs.entries()) {
      const input = inventoryInput(scenario.state, `root:inventory:diagnostic-reject:${index}`,
        { kind: "acquire", entryRef: entries[0].entryId, quantity: 1 });
      input.plan.operation.entryRef = entryRef;
      // Freeze only authorized reads; do not retrieve a hidden entry's hash or
      // invent a revision for a missing ref merely to reach the Rules validator.
      input.plan.readSet = [PLAYER, SCENE, definition.definitionId, entries[0].entryId]
        .map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(scenario.state, ref) }));
      const denied = step(scenario.profiles, scenario.state, input);
      assert.equal(denied.kind, "rejected", JSON.stringify(denied));
      assert.deepEqual(denied.rejection, expectedRejection);
      assert.deepEqual(denied.events, []);
      assert.deepEqual(scenario.state, before);
      assert.equal(canonicalSha256(scenario.state), beforeHash);
      const diagnosticText = JSON.stringify(denied.rejection);
      for (const privateValue of [...unavailableRefs, remoteScene, RECIPIENT, definition.content.label, "未公开的私人房间"]) {
        assert.equal(diagnosticText.includes(privateValue), false, privateValue);
      }
    }
    assertReplay(scenario, [], scenario.state);
    const acquired = apply(scenario, scenario, "diagnostic-valid-acquire", { kind: "acquire", entryRef: entries[0].entryId, quantity: 1 });
    assert.equal(acquired.state.campaignRuntime.itemSystem.entries[entries[0].entryId].holderRef, PLAYER);
    const projected = project(scenario.profiles, acquired.state, { kind: "player", principalId: PRINCIPAL,
      sessionVersion: 1, seatId: SEAT, characterId: PLAYER },
      { channel: "realtime", committedRange: { receiptId: acquired.receipt.receiptId, actorCharacterId: PLAYER,
        priorState: scenario.state, events: acquired.events } });
    assert.equal(projected.kind, "projected", JSON.stringify(projected));
    assert.ok(projected.visibleItems.some(item => item.itemEntryId === entries[0].entryId));
    assert.equal(projected.visibleItems.some(item => [entries[1].entryId, entries[2].entryId].includes(item.itemEntryId)), false);
    assertReplay(scenario, acquired.events, acquired.state);
  }
});
