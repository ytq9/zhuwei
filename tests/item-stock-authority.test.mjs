import assert from "node:assert/strict";
import test from "node:test";
import { createVersionedRulesRuntime } from "../app/_runtime/lib/rules/v2-runtime.ts";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST as PROFILES } from "../app/_runtime/lib/rules/profiles/vnext-world-interaction.ts";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import { initialStandardGearEntryId } from "../app/_runtime/lib/rules/v2/item-transitions.ts";
import { authorityRevisionOrHash } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { standardGearDefinitionId } from "../app/_runtime/lib/rules/v2/items.ts";
import { foldEvent } from "../app/_runtime/lib/rules/v2/events.ts";

const runtime = createVersionedRulesRuntime({
  registrations: [{ manifest: PROFILES, interpreterKind: "authoritative-v2" }], defaultManifest: PROFILES.manifest,
});
const A = "character:stock:archer", B = "character:stock:supplier", SCENE = "scene:stock:yard";
const viewer = (id) => ({ kind: "player", principalId: `principal:${id}`, seatId: `seat:${id}`, characterId: id, sessionVersion: 1 });
function initialize({ extraArrowEntries = [] } = {}) {
  const geometry = { schema: "zhuwei.tactical-geometry/v1", unit: "inch",
    boundary: { kind: "polygon", points: [{ x: "0", y: "0" }, { x: "900", y: "0" }, { x: "900", y: "600" }, { x: "0", y: "600" }] },
    spawnPoints: [{ x: "100", y: "100", elevation: "0" }, { x: "400", y: "100", elevation: "0" }],
    obstacles: [{ featureId: "feature:stock:wall", kind: "barrier", label: "矮墙", state: "intact",
      polygon: [{ x: "600", y: "400" }, { x: "660", y: "400" }, { x: "660", y: "460" }, { x: "600", y: "460" }],
      elevation: "0", height: "60", opaque: false, impassable: true, cover: "half", propagation: "passes", terrain: "normal",
      visibilityPolicyId: "visibility:scene-observers" }], clearanceZones: [] };
  const result = runtime.step(PROFILES, undefined, { kind: "initializeAuthoritativeWorld",
    roomId: "room:stock", runtimeEpochId: "epoch:stock", moduleRef: { profileId: "module:stock", profileHash: `sha256:${"a".repeat(64)}` },
    initialDefinitionCatalogRef: { profileId: "definitions:stock", profileHash: `sha256:${"b".repeat(64)}` },
    activeBranchId: "branch:main", fictionInstantMicros: "0", scenes: [{ id: SCENE, name: "靶场", geometry }],
    principals: [A, B].map((id) => ({ id: `principal:${id}`, sessionVersion: 1, role: id === A ? "host" : "player" })),
    seats: [A, B].map((id) => ({ id: `seat:${id}`, principalId: `principal:${id}`, status: "active" })),
    characters: [A, B].map((id) => ({ id, kind: "player", name: id, sceneId: SCENE, tenureStatus: "active",
      classId: "fighter", raceId: "human", level: 2, abilityScores: { str: 12, dex: 16, con: 12, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2, proficientSkills: [], expertiseSkills: [], proficientSaves: ["str", "con"], hitPoints: { current: 20, maximum: 20 },
      resources: { arrow: 20, bolt: 20, gold: 30, torch: 10, ration: 10, secondWind: 1, surge: 1 },
      resourceMaximums: { arrow: 20, bolt: 20, gold: 30, torch: 10, ration: 10, secondWind: 1, surge: 1 },
      loadout: { armorClass: 13, speedFeet: 30, equipped: id === A ? { main: "longbow" } : {},
        backpack: id === A ? [{ itemId: "explorer-pack", quantity: 1 }] : [{ itemId: "arrow", quantity: 2 }, { itemId: "gp", quantity: 7 }] },
      characterBuild: { classId: "fighter", raceId: "human", cantrips: [], prepared: [] } })),
    characterControls: [A, B].map((id) => ({ characterId: id, seatId: `seat:${id}` })),
    canonicalFacts: [], initialKnowledge: [],
    vNextSeed: { semanticDefinitions: [], itemDefinitions: [], entityDefinitionBindings: [],
      itemEntries: extraArrowEntries.map(([suffix, quantity, visibilityPolicyRef]) => ({
        definitionRef: standardGearDefinitionId("arrow"), entry: { entryId: `item-entry:stock:${suffix}`, quantity,
          placement: { kind: "held", holderRef: B, equippedSlot: null }, visibilityPolicyRef,
          ownership: { kind: "character", ownerRef: B } } })) } });
  assert.equal(result.kind, "initialized", JSON.stringify(result));
  const replayed = runtime.replay(result.genesis, []);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return { ...result, state: replayed.state };
}
function projected(state, id = A) {
  const result = runtime.project(PROFILES, state, viewer(id));
  assert.equal(result.kind, "projected", JSON.stringify(result));
  return result.controlledCharacter;
}
function transfer(scenario, quantity) {
  const entryRef = initialStandardGearEntryId(B, "arrow", "stack");
  const refs = [B, A, SCENE, entryRef];
  const result = runtime.step(PROFILES, scenario.state, { kind: "inventoryOperation", rootActionId: "root:stock:transfer", actorCharacterId: B,
    plan: { schema: "zhuwei.inventory-operation-plan/vnext-1", contextHash: `sha256:${"c".repeat(64)}`,
      readSet: refs.map((ref) => ({ ref, revisionOrHash: authorityRevisionOrHash(scenario.state, ref) })),
      basisRefs: [entryRef], summary: "交付真实箭支。", operation: { kind: "transfer", entryRef, quantity,
        targetCharacterRef: A, ownershipDisposition: "preserve" } } });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return result;
}

test("initial Item import owns physical stocks, expands bundles, and preserves only class pools", () => {
  const scenario = initialize();
  for (const id of [A, B]) {
    assert.deepEqual(scenario.state.entities[id].resources, { secondWind: 1, surge: 1 });
    assert.deepEqual(scenario.state.entities[id].resourceMaximums, { secondWind: 1, surge: 1 });
    assert.equal(scenario.state.combatRuntime.entities[id].resources.arrow, undefined);
  }
  const archer = projected(scenario.state);
  assert.deepEqual(archer.resources, { secondWind: 1, surge: 1, bolt: 0, arrow: 0, torch: 10, ration: 10, gold: 0 });
  assert.equal(archer.inventory.entries.some((entry) => entry.name === "探险者套装"), false);
  assert.equal(projected(scenario.state, B).resources.arrow, 2);
  assert.equal(projected(scenario.state, B).resources.gold, 7);
  assert.equal(scenario.state.combatRuntime.entities[A].abilityRefs.some((ref) => ref.includes(":weapon:")), false);
});

test("transfer and exact-entry ranged consumption update Item, public stocks, and replay together", () => {
  const scenario = initialize();
  const transferred = transfer(scenario, 1);
  assert.equal(projected(transferred.state).resources.arrow, 1);
  assert.equal(projected(transferred.state, B).resources.arrow, 1);
  const bowEntryId = transferred.state.entities[A].loadout.equipped.main;
  const abilityRef = transferred.state.combatRuntime.entities[A].abilityRefs.find((ref) => ref.includes(`:weapon:${bowEntryId}:`));
  assert.ok(abilityRef);
  const waiting = runtime.step(PROFILES, transferred.state, { kind: "invokeAbility", rootActionId: "root:stock:shoot",
    sourceEntityId: A, abilityRef, parameters: { targetEntityId: B } });
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  const resolved = runtime.step(PROFILES, waiting.state, { kind: "authoritativeRandomness", resolutionId: waiting.resolutionId,
    responseId: `response:${waiting.resolutionId}`, continuationCapability: waiting.continuationCapability,
    randomnessResults: waiting.randomnessRequests.map((request) => ({ randomnessId: request.randomnessId,
      requestHash: request.requestHash, draws: request.dice.map(({ count, sides }) => ({ sides: Number(sides),
        faces: Array.from({ length: Number(count) }, () => 1) })) })) });
  assert.equal(resolved.kind, "committed", JSON.stringify(resolved));
  const after = projected(resolved.state);
  assert.equal(after.resources.arrow, 0);
  assert.equal(after.inventory.entries.some((entry) => entry.name === "箭"), false);
  assert.equal(after.resources.secondWind, 1);
  assert.equal(projected(resolved.state, B).resources.arrow, 1);
  const denied = runtime.step(PROFILES, resolved.state, { kind: "invokeAbility", rootActionId: "root:stock:empty",
    sourceEntityId: A, abilityRef, parameters: { targetEntityId: B } });
  assert.equal(denied.kind, "rejected", JSON.stringify(denied));
  const replayed = runtime.replay(scenario.genesis, [...transferred.events, ...waiting.events, ...resolved.events]);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  assert.deepEqual(projected(replayed.state).resources, after.resources);
});

test("generic resource mutation cannot mint or spend stock and class spending still commits", () => {
  const scenario = initialize();
  const before = canonicalSha256(scenario.state);
  for (const resourceId of ["arrow", "gold", "torch", "item:arrow", "item-entry:forged"]) {
    for (const input of [
      { kind: "useResource", amount: 1, purpose: "test" },
      { kind: "changeResource", delta: 1, reason: "test" },
    ]) {
      const result = runtime.step(PROFILES, scenario.state, { ...input, proposalId: `root:stock:${input.kind}:${resourceId}`,
        characterId: A, resourceId });
      assert.equal(result.kind, "rejected", JSON.stringify(result));
    }
  }
  assert.equal(canonicalSha256(scenario.state), before);
  const used = runtime.step(PROFILES, scenario.state, { kind: "useResource", proposalId: "root:stock:class",
    characterId: A, resourceId: "secondWind", amount: 1, purpose: "test class resource" });
  assert.equal(used.kind, "committed", JSON.stringify(used));
  assert.equal(projected(used.state).resources.secondWind, 0);
  const usedEvent = used.events.find((event) => event.eventType === "ResourceUsed");
  const forged = { ...usedEvent, payload: { ...usedEvent.payload, resourceId: "arrow" } };
  assert.throws(() => foldEvent(structuredClone(scenario.state), forged), /physical stock requires item authority/);
});

test("stock counters aggregate visible stacks without disclosing hidden held inventory", () => {
  const scenario = initialize({ extraArrowEntries: [
    ["visible", 3, "visibility:public"], ["hidden", 11, "visibility:room-authority-only"],
  ] });
  const safe = projected(scenario.state, B);
  assert.equal(safe.resources.arrow, 5);
  assert.equal(safe.inventory.entries.some((entry) => entry.entryId === "item-entry:stock:hidden"), false);
  assert.equal(scenario.state.campaignRuntime.itemSystem.entries["item-entry:stock:hidden"].quantity, 11);
});
