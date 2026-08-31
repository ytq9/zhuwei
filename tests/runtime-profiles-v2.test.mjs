import assert from "node:assert/strict";
import test from "node:test";

import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import {
  ABILITY_COMPILER_PROFILE,
  ABILITY_COMPILER_PROFILE_DOCUMENT,
  ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE,
  ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE_DOCUMENT,
  ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
  profileRegistryMatchesCanonicalDocuments,
} from "../app/_runtime/lib/rules/profiles/manifests.ts";
import { createVersionedRulesRuntime } from "../app/_runtime/lib/rules/v2-runtime.ts";

const PROFILES = ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST;
const VIEWER = {
  kind: "player",
  principalId: "principal:alice",
  sessionVersion: 1,
  seatId: "seat:alice",
  characterId: "character:alice",
};

function runtime() {
  return createVersionedRulesRuntime({
    registrations: [{ manifest: PROFILES, interpreterKind: "authoritative-v2" }],
    defaultManifest: PROFILES.manifest,
  });
}

function initialize(label) {
  const rules = runtime();
  const initialized = rules.step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: `runtime-profile-room:${label}`,
    runtimeEpochId: `runtime-profile-epoch:${label}`,
    moduleRef: {
      profileId: "module:runtime-profile-current",
      profileHash: `sha256:${"e".repeat(64)}`,
    },
    initialDefinitionCatalogRef: {
      profileId: "definitions:runtime-profile-current",
      profileHash: `sha256:${"f".repeat(64)}`,
    },
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{
      id: "scene:hall",
      name: "回放厅",
      geometry: {
        schema: "zhuwei.tactical-geometry/v1",
        unit: "inch",
        boundary: {
          kind: "polygon",
          points: [
            { x: "0", y: "0" },
            { x: "600", y: "0" },
            { x: "600", y: "600" },
            { x: "0", y: "600" },
          ],
        },
        spawnPoints: [{ x: "120", y: "120", elevation: "0" }],
        obstacles: [{
          featureId: "feature:runtime-profile:wall",
          kind: "barrier",
          label: "回放厅矮墙",
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
      },
    }],
    principals: [{ id: "principal:alice", sessionVersion: 1, role: "host" }],
    seats: [{
      id: "seat:alice",
      principalId: "principal:alice",
      status: "active",
    }],
    characters: [{
      id: "character:alice",
      kind: "player",
      name: "阿莱莎",
      sceneId: "scene:hall",
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
      loadout: { armorClass: 11, speedFeet: 30, equipped: {}, backpack: [] },
      characterBuild: { classId: "fighter", raceId: "human", cantrips: [], prepared: [] },
    }],
    characterControls: [{ characterId: "character:alice", seatId: "seat:alice" }],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const replayed = rules.replay(initialized.genesis, []);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return { rules, initialized, replayed };
}

function assertRejected(result, code) {
  assert.equal(result?.kind, "rejected", JSON.stringify(result));
  assert.equal(result.rejection?.code, code);
  assert.equal(result.state, undefined);
}

test("the current Ability Compiler and runtime manifest close over exact Item semantics", () => {
  assert.equal(ABILITY_COMPILER_PROFILE.profileId, "ability-srd51-2014-v2");
  assert.equal(ABILITY_COMPILER_PROFILE_DOCUMENT.semanticVersion, "2.0.0");
  assert.deepEqual(ABILITY_COMPILER_PROFILE_DOCUMENT.normativePayload.mechanicOpFamilies, [
    "Guard",
    "Choice",
    "Cost",
    "Grant",
    "Random",
    "Damage",
    "Recovery",
    "Effect",
    "Spatial",
    "Item",
    "Resource",
    "Entity",
    "Encounter",
    "Activity",
    "Time",
    "Evidence",
    "Knowledge",
    "Trigger",
  ]);
  assert.deepEqual(ABILITY_COMPILER_PROFILE_DOCUMENT.normativePayload.itemCostAuthority, {
    kind: "item",
    resourceId: "item-entry:<non-empty-entry-id>",
    amountAndOptionalCounters: "canonical-non-negative-integer-strings",
    optionalCounters: ["chargeCost", "durabilityCost"],
    duplicateExactEntrySpend: "reject",
    genericItemResource: "reject",
    retiredItemChargeKind: "reject",
  });
  assert.equal(canonicalSha256(ABILITY_COMPILER_PROFILE_DOCUMENT), ABILITY_COMPILER_PROFILE.profileHash);
  assert.equal(ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE_DOCUMENT.semanticVersion, "5.4.0");
  assert.deepEqual(
    ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE_DOCUMENT.normativePayload.abilityCompiler,
    ABILITY_COMPILER_PROFILE,
  );
  assert.equal(
    canonicalSha256(ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE_DOCUMENT),
    ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE.profileHash,
  );
  assert.equal(profileRegistryMatchesCanonicalDocuments(), true);
});

test("product 0.4 initializes, replays, and projects only the exact current runtime closure", () => {
  const { rules, initialized, replayed } = initialize("current");
  assert.deepEqual(initialized.genesis.profiles, PROFILES);
  assert.deepEqual(replayed.profiles, PROFILES);
  const projection = rules.project(PROFILES, replayed.state, VIEWER);
  assert.equal(projection.kind, "projected", JSON.stringify(projection));
  assert.deepEqual(projection.runtimeProfiles, PROFILES);
  assert.deepEqual(projection.fictionTime, {
    branchId: "branch:main",
    nowMicros: "0",
  });
});

test("product 0.4 fails closed for a changed hash or retired manifest", () => {
  const { rules, initialized, replayed } = initialize("reject-retired");
  const wrongHash = structuredClone(PROFILES);
  wrongHash.ruleset.profileHash = `sha256:${"0".repeat(64)}`;
  assertRejected(rules.project(wrongHash, replayed.state, VIEWER), "profileIntegrityMismatch");

  const retired = structuredClone(PROFILES);
  retired.manifest = {
    profileId: "runtime-srd51-2014-authoritative-retired",
    profileHash: `sha256:${"9".repeat(64)}`,
  };
  assertRejected(rules.project(retired, replayed.state, VIEWER), "unsupportedProfile");

  const retiredGenesis = structuredClone(initialized.genesis);
  retiredGenesis.profiles = retired;
  assertRejected(rules.replay(retiredGenesis, []), "unsupportedProfile");
});

test("current replay rejects an incomplete event envelope", () => {
  const { rules, initialized, replayed } = initialize("event-envelope");
  const committed = rules.step(PROFILES, replayed.state, {
    kind: "declareCanonicalFact",
    proposalId: "proposal:event-envelope",
    fact: {
      factId: "fact:event-envelope",
      factKind: "observedState",
      subjectRefs: ["scene:hall"],
      value: "事件封套必须保持完整",
      source: "observedEvent",
      causalParentIds: [],
      visibilityPolicy: "public",
    },
  });
  assert.equal(committed.kind, "committed", JSON.stringify(committed));

  for (const mutate of [
    (event) => { delete event.profiles.eventSchema; },
    (event) => { delete event.eventTypeVersion; },
    (event) => { delete event.previousEventHash; },
  ]) {
    const event = structuredClone(committed.events[0]);
    mutate(event);
    const result = rules.replay(initialized.genesis, [event]);
    assert.equal(result.kind, "rejected", JSON.stringify(result));
    assert.equal(result.state, undefined);
  }
});
