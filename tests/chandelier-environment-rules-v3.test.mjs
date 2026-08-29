import assert from "node:assert/strict";
import test from "node:test";

import { compileEnvironmentFeature } from "../app/_runtime/lib/rules/profiles/environment.ts";
import {
  CURRENT_RUNTIME_PROFILE_MANIFEST,
  ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
} from "../app/_runtime/lib/rules/profiles/manifests.ts";
import { createVersionedRulesRuntime } from "../app/_runtime/lib/rules/v2-runtime.ts";
import { eventHash, validateEventEnvelope } from "../app/_runtime/lib/rules/v2/events.ts";
import { hashWorldState } from "../app/_runtime/lib/rules/v2/validation.ts";
import {
  CHANDELIER_FEATURE_DEFINITION,
  CHANDELIER_ID,
  CRATE_ID,
  chandelierGeometry,
} from "./fixtures/chandelier-environment-v3.mjs";

const ALICE = Object.freeze({
  principalId: "principal:environment:alice",
  seatId: "seat:environment:alice",
  characterId: "character:alice",
});
const ALLY = Object.freeze({
  principalId: "principal:environment:ally",
  seatId: "seat:environment:ally",
  characterId: "character:ally",
});
const ENEMY_ID = "npc:enemy";
const HIDDEN_ID = "npc:hidden";
const NEUTRAL_ID = "npc:neutral";

const runtime = createVersionedRulesRuntime({
  registrations: [{
    manifest: ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
    interpreterKind: "authoritative-v2",
  }],
  defaultManifest: ENVIRONMENT_RUNTIME_PROFILE_MANIFEST.manifest,
});
const legacyRuntime = createVersionedRulesRuntime({
  registrations: [{
    manifest: CURRENT_RUNTIME_PROFILE_MANIFEST,
    interpreterKind: "authoritative-v2",
  }],
  defaultManifest: CURRENT_RUNTIME_PROFILE_MANIFEST.manifest,
});

function profileRef(profileId, digit) {
  return { profileId, profileHash: `sha256:${digit.repeat(64)}` };
}

function player(id, name, overrides = {}) {
  return {
    id,
    kind: "player",
    name,
    sceneId: "scene:gallery",
    tenureStatus: "active",
    classId: "fighter",
    raceId: "human",
    level: 1,
    hitPoints: { current: 12, maximum: 12 },
    abilityScores: { str: 12, dex: 16, con: 12, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    proficientSkills: [],
    resources: {},
    loadout: {
      armorClass: 14,
      speedFeet: 30,
      equipped: { main: "longbow", ammo: "arrow" },
      backpack: [{ itemId: "arrow", quantity: 20 }],
    },
    characterBuild: {
      classId: "fighter",
      raceId: "human",
      cantrips: [],
      prepared: [],
    },
    ...overrides,
  };
}

function npc(id, name, hitPoints, overrides = {}) {
  return {
    id,
    kind: "npc",
    name,
    sceneId: "scene:gallery",
    tenureStatus: "active",
    hitPoints: { current: hitPoints, maximum: hitPoints },
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    ...overrides,
  };
}

function initialize({ existingChandelier = false, rulesRuntime = runtime } = {}) {
  const compiled = compileEnvironmentFeature(CHANDELIER_FEATURE_DEFINITION);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  if (!compiled.ok) throw new Error("chandelier fixture did not compile");
  const initialized = rulesRuntime.step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: `room:environment:${existingChandelier ? "existing" : "blank"}`,
    runtimeEpochId: `epoch:environment:${existingChandelier ? "existing" : "blank"}:1`,
    moduleRef: profileRef("module:environment:tactical-map-v1", "a"),
    initialDefinitionCatalogRef: profileRef("definitions:environment-v3", "b"),
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{
      id: "scene:gallery",
      name: "长廊",
      geometry: chandelierGeometry(
        existingChandelier ? compiled.artifact.tacticalFeature : undefined,
      ),
    }],
    principals: [
      { id: ALICE.principalId, sessionVersion: 1, role: "host" },
      { id: ALLY.principalId, sessionVersion: 1, role: "player" },
    ],
    seats: [
      { id: ALICE.seatId, principalId: ALICE.principalId, status: "active" },
      { id: ALLY.seatId, principalId: ALLY.principalId, status: "active" },
    ],
    characters: [
      player(ALICE.characterId, "阿莱莎"),
      player(ALLY.characterId, "同伴"),
      npc(ENEMY_ID, "敌人", 20),
      npc(HIDDEN_ID, "潜伏者", 5, {
        spatialVisibilityPolicyId: "visibility:hidden-until-evidence",
        spatialVisibilityFactId: "fact:hidden:unrevealed",
      }),
      npc(NEUTRAL_ID, "中立者", 20),
    ],
    characterControls: [
      { characterId: ALICE.characterId, seatId: ALICE.seatId },
      { characterId: ALLY.characterId, seatId: ALLY.seatId },
    ],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const replayed = rulesRuntime.replay(initialized.genesis, []);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  const longbow = Object.values(replayed.state.combatRuntime.definitions)
    .find((definition) => definition.mechanicalKey === "weapon:longbow");
  assert.ok(longbow, "longbow definition");
  return {
    genesis: initialized.genesis,
    profiles: initialized.profiles,
    state: replayed.state,
    events: [],
    abilityRef: longbow.definitionId,
    rulesRuntime,
  };
}

function stuntInput(world, rootActionId, options = {}) {
  return {
    kind: "invokeEnvironmentalStunt",
    rootActionId,
    actorCharacterId: ALICE.characterId,
    controllerPrincipalId: ALICE.principalId,
    featureId: CHANDELIER_ID,
    abilityRef: world.abilityRef,
    ...options,
  };
}

let responseOrdinal = 0;

function fulfill(world, awaiting, facesForPurpose) {
  assert.equal(awaiting.kind, "awaitingRandomness", JSON.stringify(awaiting));
  const randomnessResults = awaiting.randomnessRequests.map((request) => ({
    randomnessId: request.randomnessId,
    requestHash: request.requestHash,
    draws: request.dice.map((die) => {
      const requested = facesForPurpose(request.purposeKey, Number(die.count), Number(die.sides));
      const faces = Array.isArray(requested)
        ? requested
        : Array.from({ length: Number(die.count) }, () => requested);
      assert.equal(faces.length, Number(die.count), request.purposeKey);
      return { sides: Number(die.sides), faces };
    }),
  }));
  responseOrdinal += 1;
  const resolved = world.rulesRuntime.step(world.profiles, awaiting.state, {
    kind: "authoritativeRandomness",
    resolutionId: awaiting.resolutionId,
    continuationCapability: awaiting.continuationCapability,
    responseId: `response:environment:${responseOrdinal}`,
    randomnessResults,
  });
  const recordedEventIds = new Set(world.events.map(({ eventId }) => eventId));
  for (const event of [...awaiting.events, ...resolved.events]) {
    if (!recordedEventIds.has(event.eventId)) {
      world.events.push(event);
      recordedEventIds.add(event.eventId);
    }
  }
  world.state = resolved.state ?? awaiting.state;
  return resolved;
}

function feature(state, featureId) {
  return state.combatRuntime.scenes["scene:gallery"].geometry.obstacles
    .find((candidate) => candidate.featureId === featureId);
}

function playerProjection(world) {
  const projected = world.rulesRuntime.project(world.profiles, world.state, {
    kind: "player",
    principalId: ALICE.principalId,
    sessionVersion: 1,
    seatId: ALICE.seatId,
    characterId: ALICE.characterId,
  });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  return projected;
}

test("existing features reuse stable ids; blank features materialize before randomness; absence resolves in world", () => {
  const legacy = initialize({ rulesRuntime: legacyRuntime });
  const unsupported = legacy.rulesRuntime.step(
    legacy.profiles,
    legacy.state,
    stuntInput(legacy, "root:environment:legacy-profile"),
  );
  assert.equal(unsupported.kind, "rejected");
  assert.equal(unsupported.rejection.code, "unsupportedProfile");

  const existing = initialize({ existingChandelier: true });
  const reused = existing.rulesRuntime.step(
    existing.profiles,
    existing.state,
    stuntInput(existing, "root:environment:reuse"),
  );
  assert.equal(reused.kind, "awaitingRandomness", JSON.stringify(reused));
  assert.deepEqual(reused.events.map(({ eventType }) => eventType), ["RandomnessRequested"]);
  assert.equal(
    feature(reused.state, CHANDELIER_ID).environment.featureDefinitionHash,
    feature(existing.state, CHANDELIER_ID).environment.featureDefinitionHash,
  );

  const blank = initialize();
  const materialized = blank.rulesRuntime.step(
    blank.profiles,
    blank.state,
    stuntInput(blank, "root:environment:materialize", {
      materialization: { featureDefinition: CHANDELIER_FEATURE_DEFINITION },
    }),
  );
  assert.equal(materialized.kind, "awaitingRandomness", JSON.stringify(materialized));
  assert.deepEqual(materialized.events.map(({ eventType }) => eventType), [
    "EnvironmentFeatureMaterialized",
    "RandomnessRequested",
  ]);
  assert.equal(materialized.events[0].secrecy, "internal");
  assert.equal(feature(materialized.state, CHANDELIER_ID).state, "suspended");
  const materializedProjection = playerProjection({ ...blank, state: materialized.state });
  assert.ok(materializedProjection.tacticalProjection.knownFeatures
    .some(({ id }) => id === CHANDELIER_ID));
  assert.ok(!JSON.stringify(materializedProjection).includes("featureDefinitionHash"));
  const forgedLegacyEvent = structuredClone(materialized.events[0]);
  forgedLegacyEvent.profiles = structuredClone(CURRENT_RUNTIME_PROFILE_MANIFEST);
  forgedLegacyEvent.eventHash = eventHash(forgedLegacyEvent);
  assert.equal(validateEventEnvelope(forgedLegacyEvent).ok, false);

  const absent = initialize();
  const refused = absent.rulesRuntime.step(
    absent.profiles,
    absent.state,
    stuntInput(absent, "root:environment:absent"),
  );
  assert.equal(refused.kind, "committed", JSON.stringify(refused));
  assert.deepEqual(refused.events.map(({ eventType }) => eventType), ["EnvironmentStuntRefused"]);
  assert.equal(refused.mechanicalResult.outcome, "resolvedInWorld");
  assert.equal(feature(refused.state, CHANDELIER_ID), undefined);
  assert.equal(refused.state.combatRuntime.randomnessResolutions["root:environment:absent"], undefined);

  const forged = blank.rulesRuntime.step(
    blank.profiles,
    blank.state,
    {
      ...stuntInput(blank, "root:environment:forged", {
        materialization: { featureDefinition: CHANDELIER_FEATURE_DEFINITION },
      }),
      targetEntityIds: [HIDDEN_ID],
    },
  );
  assert.equal(forged.kind, "rejected");
  assert.equal(forged.rejection.code, "invalidRulesInput");
});

test("miss and hit below durability threshold consume the frozen action branch without falling", () => {
  const missWorld = initialize({ existingChandelier: true });
  const missAwaiting = missWorld.rulesRuntime.step(
    missWorld.profiles,
    missWorld.state,
    stuntInput(missWorld, "root:environment:miss"),
  );
  const disconnectedRetry = missWorld.rulesRuntime.step(
    missWorld.profiles,
    missAwaiting.state,
    stuntInput(missWorld, "root:environment:miss"),
  );
  assert.equal(disconnectedRetry.kind, "rejected");
  assert.equal(disconnectedRetry.rejection.code, "duplicateRootAction");
  assert.deepEqual(
    missAwaiting.state.combatRuntime.randomnessResolutions[missAwaiting.resolutionId]
      .randomnessRequests,
    missAwaiting.randomnessRequests,
  );
  const missed = fulfill(missWorld, missAwaiting, (purpose) =>
    purpose.startsWith("attack:environment:") ? 1 : 8);
  assert.equal(missed.kind, "committed", JSON.stringify(missed));
  assert.equal(feature(missed.state, CHANDELIER_ID).state, "suspended");
  assert.equal(feature(missed.state, CHANDELIER_ID).durability.current, "10");
  assert.ok(missed.events.some(({ eventType }) => eventType === "AbilityInvoked"));
  assert.ok(missed.events.some(({ eventType }) => eventType === "ResourceSpent"));
  assert.ok(!missed.events.some(({ eventType }) => eventType === "EnvironmentHazardTriggered"));
  assert.equal(missed.state.combatRuntime.entities[ALICE.characterId].turn.action, "0");
  assert.equal(missed.state.combatRuntime.entities[ALICE.characterId].resources["item:arrow"].current, "19");
  assert.equal(missed.state.entities[ALICE.characterId].loadout.backpack[0].quantity, 19);

  const damagedWorld = initialize({ existingChandelier: true });
  const damagedAwaiting = damagedWorld.rulesRuntime.step(
    damagedWorld.profiles,
    damagedWorld.state,
    stuntInput(damagedWorld, "root:environment:damaged"),
  );
  const damaged = fulfill(damagedWorld, damagedAwaiting, (purpose) =>
    purpose.startsWith("attack:environment:") ? 20 : 1);
  assert.equal(damaged.kind, "committed", JSON.stringify(damaged));
  assert.equal(feature(damaged.state, CHANDELIER_ID).state, "suspended");
  assert.ok(Number(feature(damaged.state, CHANDELIER_ID).durability.current) > 0);
  assert.ok(Number(feature(damaged.state, CHANDELIER_ID).durability.current) < 10);
});

test("falling chandelier resolves complete authority geometry, hidden death, debris, replay, correction, and duplicate root", () => {
  const world = initialize();
  const beforeProjection = playerProjection(world);
  assert.ok(!JSON.stringify(beforeProjection).includes(HIDDEN_ID));
  const input = stuntInput(world, "root:environment:full-chain", {
    materialization: { featureDefinition: CHANDELIER_FEATURE_DEFINITION },
  });
  const attackAwaiting = world.rulesRuntime.step(world.profiles, world.state, input);
  const hazardAwaiting = fulfill(world, attackAwaiting, (purpose) =>
    purpose.startsWith("attack:environment:") ? 20 : 8);
  assert.equal(hazardAwaiting.kind, "awaitingRandomness", JSON.stringify(hazardAwaiting));
  assert.equal(feature(hazardAwaiting.state, CHANDELIER_ID).state, "falling");

  const resolved = fulfill(world, hazardAwaiting, (purpose, count) => {
    if (purpose.startsWith("damage:environment-hazard:")) return Array(count).fill(6);
    if (purpose.endsWith(`:${ALICE.characterId}`)) return 20;
    if (purpose.endsWith(`:${ENEMY_ID}`)) return 20;
    return 1;
  });
  assert.equal(resolved.kind, "committed", JSON.stringify(resolved));
  const eventTypes = world.events.map(({ eventType }) => eventType);
  assert.ok(world.events.every(({ rootActionId }) => rootActionId === input.rootActionId));
  assert.ok(world.events.every((event, index, events) => index === 0
    || BigInt(events[index - 1].eventSeq) + 1n === BigInt(event.eventSeq)));
  assert.deepEqual(eventTypes.slice(0, 2), [
    "EnvironmentFeatureMaterialized",
    "RandomnessRequested",
  ]);
  assert.ok(eventTypes.includes("ResourceSpent"));
  assert.ok(eventTypes.includes("AbilityInvoked"));
  assert.ok(eventTypes.includes("EnvironmentFeatureDamaged"));
  assert.ok(eventTypes.includes("EnvironmentHazardTriggered"));
  assert.ok(eventTypes.includes("EnvironmentAreaTargetResolved"));
  assert.ok(eventTypes.includes("EnvironmentAreaFeatureDamaged"));
  assert.ok(eventTypes.includes("CreatureDied"));
  assert.equal(eventTypes.at(-1), "EnvironmentFeatureStateChanged");

  const hazard = world.events.find(({ eventType }) => eventType === "EnvironmentHazardTriggered");
  assert.deepEqual(hazard.payload.entityTargetIds, [
    ALICE.characterId,
    ALLY.characterId,
    ENEMY_ID,
    HIDDEN_ID,
    NEUTRAL_ID,
  ].sort());
  assert.ok(hazard.payload.featureTargetIds.includes(CRATE_ID));
  assert.equal(hazard.secrecy, "internal");
  const targetEvents = world.events.filter(({ eventType }) =>
    eventType === "EnvironmentAreaTargetResolved");
  assert.equal(targetEvents.length, 5);
  assert.deepEqual(
    targetEvents.map(({ payload }) => payload.targetEntityId).sort(),
    hazard.payload.entityTargetIds,
  );
  assert.ok(targetEvents.every(({ secrecy }) => secrecy === "internal"));
  assert.equal(
    targetEvents.find(({ payload }) => payload.targetEntityId === ALICE.characterId)
      .payload.saveSucceeded,
    true,
  );
  assert.equal(
    targetEvents.find(({ payload }) => payload.targetEntityId === HIDDEN_ID)
      .payload.saveSucceeded,
    false,
  );
  assert.equal(world.state.combatRuntime.entities[HIDDEN_ID].lifeState, "dead");
  assert.equal(world.state.entities[HIDDEN_ID].tenureStatus, "dead");
  assert.equal(world.state.combatRuntime.entities[ALLY.characterId].conditions.prone, true);
  assert.equal(world.state.combatRuntime.entities[ALICE.characterId].lifeState, "alive");
  assert.equal(feature(world.state, CHANDELIER_ID).state, "debris");
  assert.equal(feature(world.state, CHANDELIER_ID).terrain, "rubble");
  assert.equal(feature(world.state, CHANDELIER_ID).cover, "half");
  assert.equal(feature(world.state, CHANDELIER_ID).impassable, true);
  assert.equal(feature(world.state, CRATE_ID).state, "destroyed");
  assert.equal(feature(world.state, CRATE_ID).terrain, "rubble");

  const afterProjection = playerProjection(world);
  assert.ok(!JSON.stringify(afterProjection).includes(HIDDEN_ID));
  assert.ok(!JSON.stringify(afterProjection).includes("entityTargetIds"));
  assert.ok(!JSON.stringify(afterProjection).includes("affectedEntityCount"));
  assert.ok(!JSON.stringify(resolved.mechanicalResult).includes("affectedEntityCount"));
  assert.equal(
    afterProjection.tacticalProjection.knownFeatures
      .find(({ id }) => id === CHANDELIER_ID).state,
    "debris",
  );

  const replayed = world.rulesRuntime.replay(world.genesis, world.events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  assert.equal(hashWorldState(replayed.state), hashWorldState(world.state));

  const duplicateStateHash = hashWorldState(world.state);
  const duplicate = world.rulesRuntime.step(world.profiles, world.state, input);
  assert.equal(duplicate.kind, "rejected");
  assert.equal(duplicate.rejection.code, "duplicateRootAction");
  assert.equal(hashWorldState(world.state), duplicateStateHash);

  const targetReceipt = world.state.receipts["root:environment:full-chain"];
  const corrected = world.rulesRuntime.step(world.profiles, world.state, {
    kind: "applyServiceCorrection",
    actorCharacterId: ALICE.characterId,
    correctionAuthority: {
      kind: "roomCorrectionAuthority",
      capability: world.state.correctionRuntime.authorityCapability,
    },
    correctionId: "correction:environment:full-chain",
    targetReceiptId: targetReceipt.receiptId,
    errorKind: "incorrectEnvironmentRuling",
    publicExplanation: "吊灯链条的权威裁定被撤回。",
    basis: {
      eventHash: world.state.eventHeadHash,
      stateHash: hashWorldState(world.state),
    },
  });
  assert.equal(corrected.kind, "committed", JSON.stringify(corrected));
  assert.equal(feature(corrected.state, CHANDELIER_ID), undefined);
  assert.equal(feature(corrected.state, CRATE_ID).state, "intact");
  assert.equal(corrected.state.combatRuntime.entities[HIDDEN_ID].lifeState, "alive");
  const correctedEvents = [...world.events, ...corrected.events];
  const correctedReplay = world.rulesRuntime.replay(world.genesis, correctedEvents);
  assert.equal(correctedReplay.kind, "replayed", JSON.stringify(correctedReplay));
  assert.equal(hashWorldState(correctedReplay.state), hashWorldState(corrected.state));
});
