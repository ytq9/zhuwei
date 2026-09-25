// Shared deterministic setup; no test registration or real model calls.
import assert from "node:assert/strict";
import { createVersionedRulesRuntime } from "../../../app/_runtime/lib/rules/v2-runtime.ts";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../../../app/_runtime/lib/rules/profiles/vnext-world-interaction.ts";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../../../app/_runtime/lib/rules/profiles/manifests.ts";
import { canonicalSha256 } from "../../../app/_runtime/lib/rules/profiles/canonical.ts";
import { authorityRevisionOrHash } from "../../../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { healingPotionItemDefinition } from "../../../app/_runtime/lib/rules/v2/items.ts";
import { hashWorldState } from "../../../app/_runtime/lib/rules/v2/validation.ts";


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
  const initialStateHash = hashWorldState(state);
  const unsigned = { ...scenario.genesis, initialState: state, initialStateHash };
  delete unsigned.genesisHash;
  const genesis = { ...unsigned, genesisHash: canonicalSha256(unsigned) };
  const rebuilt = replay(genesis, []);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  return { ...scenario, state: rebuilt.state, genesis };
}


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
export { step, project, replay, PLAYER, PRINCIPAL, SEAT, RECIPIENT, RECIPIENT_PRINCIPAL, RECIPIENT_SEAT, SCENE, BASIS, tacticalGeometry, initialize, inventoryInput, materialize, apply, assertReplay, withCombatFixture, authoredUseItem, resolveItemDice };
