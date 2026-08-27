import assert from "node:assert/strict";
import test from "node:test";

import {
  project,
  replay,
  step,
} from "../app/_runtime/lib/rules/index.ts";
import { createVersionedRulesRuntime } from "../app/_runtime/lib/rules/v2-runtime.ts";

const AUTHORITATIVE_RULESET_ID = "dnd5e-2014-srd5.1-authoritative-v2";
const LEGACY_RULESET_ID = "dnd5e-2014-srd5.1-v1";
const PRESENTATION_POLICY_ID = "presentation-observer-specific-v1";
const PROJECTION_POLICY_ID = "projection-observer-safe-v1";
const DELIVERY_PROTOCOL_ID = "delivery-single-current-frame-v1";

// These are public conformance inputs, not values produced by a Rules helper.
// The literals pin the canonical SPEC 0013 profile documents independently of
// Registry/hash implementation details.
const CURRENT_PROFILES = {
  manifest: {
    profileId: "runtime-srd51-2014-authoritative-v2",
    profileHash: "sha256:496da17f16d52cbe5dfa3e97facfa8ed7dcf3f4bbb7a882fc0e384d464898051",
  },
  ruleset: {
    profileId: AUTHORITATIVE_RULESET_ID,
    profileHash: "sha256:7651d58190da6bfb6241cabb41b07ef5cfee3266edf3c62b8af443d94daf4af0",
  },
  eventSchema: {
    profileId: "room-world-events-v2",
    profileHash: "sha256:3f1d953752be8981f4f7862ba1a90d6f613d113ecfd2d18dfd983abf974a8a67",
  },
  abilityCompiler: {
    profileId: "ability-srd51-2014-v1",
    profileHash: "sha256:561710d6ae32fc14f0ba22863e0d6cd92d12c6d32b8728a81608561a66b25ba3",
  },
  geometry: {
    profileId: "geometry-2d-feet-2014-v1",
    profileHash: "sha256:59caa4e73c58dc20a92cd9b50370f2c9b275a9b57740c7dd1d519f78cb72611e",
  },
  triggerOrdering: {
    profileId: "trigger-initiative-order-2014-v1",
    profileHash: "sha256:825ef8de6f962f01111c9ce325189c0d203ee71ab305149fd7b2b7485b6b8089",
  },
  fictionCombatTime: {
    profileId: "combat-round-six-seconds-2014-v1",
    profileHash: "sha256:067eb4870fcee1cda2563c7633daac4c2b7249ecd53e0f9b1c986d3de8d12f08",
  },
  extensions: [
    {
      profileId: "combat-srd51-2014-v1",
      profileHash: "sha256:b9e12294db25409844e1ecd63d048e404b315ecfcd8c493cd6af5cb593e4acc6",
    },
    {
      profileId: "damage-death-srd51-2014-v1",
      profileHash: "sha256:37dbf131c6325f2f07e3693ee8c3420372c8d7f9154a757dfafdc6f853537d7a",
    },
    {
      profileId: PRESENTATION_POLICY_ID,
      profileHash: "sha256:86bfdfebe7062d90f87e4add65d1d109cb14dead7b3d758e452af76c13f7457c",
    },
    {
      profileId: PROJECTION_POLICY_ID,
      profileHash: "sha256:972b82b84594386abc2a988a98afb94e5ec925ee1819bc53cd677c722edf8b91",
    },
    {
      profileId: DELIVERY_PROTOCOL_ID,
      profileHash: "sha256:cd0d684841bd43f621665dc538db35b81c25421d8b345e444681054bbc894d7e",
    },
  ],
};

const SYNTHETIC_NEXT_PROFILES = {
  ...structuredClone(CURRENT_PROFILES),
  manifest: {
    profileId: "runtime-srd51-2014-authoritative-test-v3",
    profileHash: `sha256:${"c".repeat(64)}`,
  },
  extensions: [
    ...structuredClone(CURRENT_PROFILES.extensions),
    {
      profileId: "runtime-registry-test-extension-srd51-2014-v1",
      profileHash: `sha256:${"d".repeat(64)}`,
    },
  ],
};

const HISTORICAL_PROFILES_WITHOUT_ADAPTER = {
  manifest: {
    profileId: "runtime-srd51-2014-authoritative-preview-v1",
    profileHash: "sha256:8ca8fafaf47777d0aa38e14458c0aa1d64b6442606a815f7f2c7a9f866f4b526",
  },
  ruleset: {
    profileId: "dnd5e-2014-srd5.1-authoritative-preview-v1",
    profileHash: "sha256:66b4387e3a86d01df74955e0bd624954f32a0aed966fd55a2fce7b7d4ad64dd1",
  },
  eventSchema: {
    profileId: "room-world-events-preview-v1",
    profileHash: "sha256:a5bbcf680ee4fb37a44b94e06ed8bae3becada2569f10b1060f40b23fe6264c0",
  },
  abilityCompiler: {
    profileId: "ability-srd51-2014-preview-v1",
    profileHash: "sha256:a6d53a2fa09176b7e615ed9b0ccdb9d9f4be9b9de2386026b8b1609931e6ac58",
  },
  geometry: {
    profileId: "geometry-2d-feet-2014-preview-v0",
    profileHash: "sha256:2f5f6d94f0f28aa29483377ddfce5055db969935d0cc671d0573b71e9fe92c44",
  },
  triggerOrdering: {
    profileId: "trigger-initiative-order-2014-preview-v0",
    profileHash: "sha256:8a24fb0595224f234c544d5388ea41e67ec4ae1181b90204375e1199444d5a13",
  },
  fictionCombatTime: {
    profileId: "combat-round-six-seconds-2014-preview-v0",
    profileHash: "sha256:d2f064f6b7b03bbd651f67201d5b3e55db5ee12b031382768e5704b0df653bf4",
  },
  extensions: [
    {
      profileId: "combat-srd51-2014-preview-v0",
      profileHash: "sha256:86ce64285fd477897fedb84cd7cd4facda6102ef83bc2aa4e0e950f18653c3f1",
    },
    {
      profileId: "damage-death-srd51-2014-preview-v0",
      profileHash: "sha256:a960dcd307aa1536325fd4c167dca767f588ceb9a1bd9a804e25a60c83b9cd97",
    },
  ],
};

const LEGACY_PROFILES = {
  manifest: {
    profileId: "runtime-srd51-2014-legacy-v1",
    profileHash: "sha256:4f00f83f926e5bbe0353955070937cc1607f4962dc28e166c977c262b4c6a603",
  },
  ruleset: {
    profileId: LEGACY_RULESET_ID,
    profileHash: "sha256:bfb70d8ccc12074e8f8cb0c8fb1e619c853b073807f17dfbc085747f4b441826",
  },
  eventSchema: {
    profileId: "legacy-room-events-v1",
    profileHash: "sha256:bb98550510998f3cab540a477c4fb075c3bf7bf097e3edb8db9c9e05a2cdd3c9",
  },
  abilityCompiler: {
    profileId: "legacy-closed-dsl-v1",
    profileHash: "sha256:5cdd2f19e34188c3c6d2ed99a3f5394cc2122a3ea710bc0bcec0d599512ed91e",
  },
  geometry: {
    profileId: "legacy-distance-segments-v1",
    profileHash: "sha256:e9d3882cb3640e7228c7a73995b11d2871352de534af3e9b11224f3334880688",
  },
  triggerOrdering: {
    profileId: "legacy-array-order-v1",
    profileHash: "sha256:67c043a8600cf7eb0468e02aa2bfbb1f7b8ef8efe84a74df3ba0a0c0598536e1",
  },
  fictionCombatTime: {
    profileId: "legacy-beat-clock-v1",
    profileHash: "sha256:853525377d3d0faed8b850ec7d5cf4eadc4774a52bd9f1a091c05a9737d8ef27",
  },
  extensions: [
    {
      profileId: "legacy-d1-combat-v1",
      profileHash: "sha256:46cfadae2fceff67b44d5bc8f25d40def6bc215bd9f123bc13776025ea577ee8",
    },
  ],
};

const MODULE_REF = {
  profileId: "module-runtime-profile-conformance-v1",
  profileHash: "sha256:8ff891731a7676961e038023f35faf8e62e4608b53f69222ad186dad334b1815",
};

const CATALOG_REF = {
  profileId: "catalog-runtime-profile-conformance-v1",
  profileHash: "sha256:353c53c19b42ed3993c63fbc0ef47762b204a2e00e4e260ff09d9252efa81981",
};

const INITIAL_STATE = {
  version: "0",
  activeBranchId: "root",
  fictionTimelines: {
    root: { branchId: "root", nowMicros: "0" },
  },
  entities: {
    "pc-1": {
      id: "pc-1",
      kind: "player",
      name: "测试角色",
      controllerPrincipalId: "principal-1",
    },
  },
};

const INITIAL_STATE_HASH = "sha256:fb9fec69dd2e23c3654cd9657c8097d5a47dcbf0c4b7ca02a8b75d45829cca95";

const VIEWER = {
  kind: "player",
  principalId: "principal-1",
  characterId: "pc-1",
};

function genesis(profiles, runtimeEpochId, genesisHash) {
  return {
    kind: "roomGenesis",
    roomId: "runtime-profile-conformance-room",
    runtimeEpochId,
    profiles,
    moduleRef: MODULE_REF,
    initialDefinitionCatalogRef: CATALOG_REF,
    initialState: INITIAL_STATE,
    initialStateHash: INITIAL_STATE_HASH,
    genesisHash,
  };
}

const CURRENT_GENESIS_HASH = "sha256:b34ffa3854aee471b2ba568bcd489974571cd89c191bb5c3b1ad7b82587ea71f";

function currentGenesis(profiles = CURRENT_PROFILES) {
  return genesis(profiles, "epoch-1", CURRENT_GENESIS_HASH);
}

function assertReplayAccepted(result) {
  assert.equal(
    result?.kind,
    "replayed",
    `expected replayed, received ${result?.kind ?? typeof result}`,
  );
  assert.ok(result.state, "replay must return the reconstructed state");
  assert.equal(result.profiles?.ruleset?.profileId, AUTHORITATIVE_RULESET_ID);
  return result;
}

function assertFailedClosed(result, expectedCode) {
  assert.equal(
    result?.kind,
    "rejected",
    `expected fail-closed ${expectedCode}, received ${result?.kind ?? typeof result}`,
  );
  assert.equal(result.rejection?.code, expectedCode);
  assert.equal(result.state, undefined, "a rejected replay/step must not expose a usable state");
}

test("P01 canonical manifest key order is stable and exposes the authoritative-v2 ruleset", () => {
  const reorderedProfiles = {
    extensions: CURRENT_PROFILES.extensions,
    fictionCombatTime: CURRENT_PROFILES.fictionCombatTime,
    triggerOrdering: CURRENT_PROFILES.triggerOrdering,
    geometry: CURRENT_PROFILES.geometry,
    abilityCompiler: CURRENT_PROFILES.abilityCompiler,
    eventSchema: CURRENT_PROFILES.eventSchema,
    ruleset: CURRENT_PROFILES.ruleset,
    manifest: CURRENT_PROFILES.manifest,
  };

  const first = assertReplayAccepted(replay(currentGenesis(), []));
  const reordered = assertReplayAccepted(replay(currentGenesis(reorderedProfiles), []));
  const firstView = project(CURRENT_PROFILES, first.state, VIEWER);
  const reorderedView = project(reorderedProfiles, reordered.state, VIEWER);

  assert.equal(first.head?.stateHash, INITIAL_STATE_HASH);
  assert.equal(reordered.head?.stateHash, INITIAL_STATE_HASH);
  assert.equal(firstView.runtimeProfiles.ruleset.profileId, AUTHORITATIVE_RULESET_ID);
  assert.equal(reorderedView.runtimeProfiles.ruleset.profileId, AUTHORITATIVE_RULESET_ID);
  assert.deepEqual(
    firstView.runtimeProfiles.extensions.slice(2).map(({ profileId }) => profileId),
    [PRESENTATION_POLICY_ID, PROJECTION_POLICY_ID, DELIVERY_PROTOCOL_ID],
  );
  assert.equal(
    firstView.runtimeProfiles.manifest.profileHash,
    reorderedView.runtimeProfiles.manifest.profileHash,
  );
});

test("P02 a known ruleset id with the wrong hash fails closed", () => {
  const wrongHashGenesis = currentGenesis(structuredClone(CURRENT_PROFILES));
  wrongHashGenesis.profiles.ruleset.profileHash = `sha256:${"0".repeat(64)}`;
  wrongHashGenesis.genesisHash = "sha256:a7e3d0a6465748f716e33d9477d6b5ababb4e70e432895f8c80455788201b73f";

  assertFailedClosed(replay(wrongHashGenesis, []), "profileIntegrityMismatch");
});

test("P02b a genesis event missing one core ProfileRef is rejected before state is exposed", () => {
  const missingRefGenesis = currentGenesis(structuredClone(CURRENT_PROFILES));
  delete missingRefGenesis.profiles.eventSchema;
  missingRefGenesis.genesisHash = "sha256:d74a54f8009d3d63aea857a2a103cc304934c7658dea21e6f77a27e8491bea68";

  assertFailedClosed(replay(missingRefGenesis, []), "invalidRuntimeManifest");
});

test("an authoritative manifest missing any observer policy fails closed", () => {
  for (const [offset, policyId] of [
    PRESENTATION_POLICY_ID,
    PROJECTION_POLICY_ID,
    DELIVERY_PROTOCOL_ID,
  ].entries()) {
    const missingPolicy = currentGenesis(structuredClone(CURRENT_PROFILES));
    missingPolicy.profiles.extensions.splice(2 + offset, 1);
    missingPolicy.genesisHash = `sha256:${String(offset + 1).repeat(64)}`;

    assertFailedClosed(replay(missingPolicy, []), "invalidRuntimeManifest");
    assert.ok(
      !missingPolicy.profiles.extensions.some(({ profileId }) => profileId === policyId),
      `fixture must omit ${policyId}`,
    );
  }
});

test("observer policies in the wrong manifest slots fail closed", () => {
  const wrongPolicyOrder = currentGenesis(structuredClone(CURRENT_PROFILES));
  const policies = wrongPolicyOrder.profiles.extensions.splice(2, 3);
  wrongPolicyOrder.profiles.extensions.push(policies[1], policies[2], policies[0]);
  wrongPolicyOrder.genesisHash = `sha256:${"2".repeat(64)}`;

  assertFailedClosed(replay(wrongPolicyOrder, []), "invalidRuntimeManifest");
});

test("every observer policy id with a wrong hash fails closed", () => {
  for (const index of [2, 3, 4]) {
    const wrongPolicyHash = currentGenesis(structuredClone(CURRENT_PROFILES));
    wrongPolicyHash.profiles.extensions[index].profileHash = `sha256:${"0".repeat(64)}`;
    wrongPolicyHash.genesisHash = `sha256:${String(index + 1).repeat(64)}`;

    assertFailedClosed(replay(wrongPolicyHash, []), "profileIntegrityMismatch");
  }
});

test("an unavailable historical profile is not reinterpreted with the deployed current profile", () => {
  const historicalGenesis = genesis(
    HISTORICAL_PROFILES_WITHOUT_ADAPTER,
    "historical-epoch",
    "sha256:58b8c41bd83dbc83cde5cdb8e379bf14c9fa67b4989c1d95ae271d994a9672cd",
  );

  assertFailedClosed(replay(historicalGenesis, []), "unsupportedHistoricalProfile");
});

test("P08 the legacy ruleset is handled only by an explicit Legacy Adapter or rejected", () => {
  const legacyGenesis = genesis(
    LEGACY_PROFILES,
    "legacy-epoch",
    "sha256:24d234a1bab99b52c0fb1691dc7f95547c67b84b6f9b2caa8e6f41df5793b7fa",
  );
  const result = replay(legacyGenesis, []);

  if (result?.kind === "replayed") {
    assert.equal(result.interpreterKind, "legacy");
    assert.equal(result.profiles?.ruleset?.profileId, LEGACY_RULESET_ID);
    assert.notEqual(result.profiles?.ruleset?.profileId, AUTHORITATIVE_RULESET_ID);
    return;
  }

  assert.equal(result?.kind, "rejected");
  assert.ok(
    ["legacyAdapterRequired", "unsupportedHistoricalProfile"].includes(result.rejection?.code),
    `unexpected Legacy rejection: ${result.rejection?.code ?? "missing code"}`,
  );
  assert.equal(result.state, undefined);
});

test("A08 a 2024 AbilityDefinition is rejected without events or mechanical effects", () => {
  const replayResult = replay(currentGenesis(), []);
  const state = replayResult?.kind === "replayed"
    ? replayResult.state
    : replayResult?.initialState;
  assert.ok(state, "public replay input must yield an initial state for step");

  const decision = step(CURRENT_PROFILES, state, {
    kind: "registerAbilityDefinition",
    proposalId: "proposal-2024-weapon-mastery",
    actorId: "pc-1",
    definition: {
      definitionId: "weapon-mastery-nick",
      revision: "1",
      rulesBasis: "dnd2024",
      activation: { kind: "attack" },
      target: { kind: "entity", count: 1 },
      effects: [{ kind: "weaponMastery", mastery: "nick" }],
    },
  });

  assertFailedClosed(decision, "unsupportedRulesBasis");
  assert.deepEqual(decision.events ?? [], []);
});

test("F02 different real observation times never advance Fiction Time", () => {
  const replayResult = replay(currentGenesis(), []);
  const state = replayResult?.kind === "replayed"
    ? replayResult.state
    : replayResult?.initialState;
  assert.ok(state, "public replay input must yield an initial state for project");

  const before = project(CURRENT_PROFILES, state, VIEWER, {
    observedAtUnixMs: "0",
  });
  const oneDayLater = project(CURRENT_PROFILES, state, VIEWER, {
    observedAtUnixMs: "86400000",
  });

  assert.equal(before.runtimeProfiles.ruleset.profileId, AUTHORITATIVE_RULESET_ID);
  assert.equal(before.fictionTime.branchId, "root");
  assert.equal(before.fictionTime.nowMicros, "0");
  assert.deepEqual(oneDayLater.fictionTime, before.fictionTime);
});

function registryRuntime(defaultManifest) {
  return createVersionedRulesRuntime({
    registrations: [
      { manifest: CURRENT_PROFILES, interpreterKind: "authoritative-v2" },
      { manifest: SYNTHETIC_NEXT_PROFILES, interpreterKind: "authoritative-v2" },
    ],
    defaultManifest,
  });
}

function initializeRegistryScenario(runtime, suffix) {
  const initialized = runtime.step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: `runtime-registry-room:${suffix}`,
    runtimeEpochId: `runtime-registry-epoch:${suffix}`,
    moduleRef: {
      profileId: "module:runtime-registry-test-v1",
      profileHash: `sha256:${"e".repeat(64)}`,
    },
    initialDefinitionCatalogRef: {
      profileId: "definitions:runtime-registry-test-v1",
      profileHash: `sha256:${"f".repeat(64)}`,
    },
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{ id: "scene:hall", name: "回放厅" }],
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
    }],
    characterControls: [{ characterId: "character:alice", seatId: "seat:alice" }],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const replayed = runtime.replay(initialized.genesis, []);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return { initialized, replayed };
}

test("P03 building a Registry with one profileId bound to two hashes fails closed", () => {
  const conflicting = structuredClone(CURRENT_PROFILES);
  conflicting.manifest.profileHash = `sha256:${"7".repeat(64)}`;

  assert.throws(
    () => createVersionedRulesRuntime({
      registrations: [
        { manifest: CURRENT_PROFILES, interpreterKind: "authoritative-v2" },
        { manifest: conflicting, interpreterKind: "authoritative-v2" },
      ],
      defaultManifest: CURRENT_PROFILES.manifest,
    }),
    /profileId can be registered only once|more than one hash/i,
  );
});

test("P04 replay rejects an event missing a ProfileRef, type version, or previous hash", () => {
  const runtime = registryRuntime(CURRENT_PROFILES.manifest);
  const room = initializeRegistryScenario(runtime, "event-envelope");
  const committed = runtime.step(
    room.initialized.profiles,
    room.replayed.state,
    {
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
    },
  );
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  assert.equal(committed.events.length, 1);

  for (const [label, mutate] of [
    ["ProfileRef", (event) => { delete event.profiles.eventSchema; }],
    ["eventTypeVersion", (event) => { delete event.eventTypeVersion; }],
    ["previousEventHash", (event) => { delete event.previousEventHash; }],
  ]) {
    const event = structuredClone(committed.events[0]);
    mutate(event);
    const replayed = runtime.replay(room.initialized.genesis, [event]);
    assert.equal(replayed.kind, "rejected", `${label}: ${JSON.stringify(replayed)}`);
    assert.equal(replayed.state, undefined, `${label} must not expose state`);
    assert.notEqual(
      replayed.rejection?.code,
      "unsupportedHistoricalProfile",
      `${label} must not route through Legacy/latest`,
    );
  }
});

test("P05 shipped manifests retain their pinned interpreter after a new default is selected", () => {
  const oldDefaultRuntime = registryRuntime(CURRENT_PROFILES.manifest);
  const oldRoom = initializeRegistryScenario(oldDefaultRuntime, "old");
  assert.deepEqual(oldRoom.initialized.profiles, CURRENT_PROFILES);

  const committed = oldDefaultRuntime.step(
    oldRoom.initialized.profiles,
    oldRoom.replayed.state,
    {
      kind: "declareCanonicalFact",
      proposalId: "proposal:registry-old-fact",
      fact: {
        factId: "fact:registry-old",
        factKind: "observedState",
        subjectRefs: ["scene:hall"],
        value: "旧房间事件仍由其固定解释器解释",
        source: "observedEvent",
        causalParentIds: [],
        visibilityPolicy: "public",
      },
    },
  );
  assert.equal(committed.kind, "committed", JSON.stringify(committed));

  const nextDefaultRuntime = registryRuntime(SYNTHETIC_NEXT_PROFILES.manifest);
  const replayBeforeSwitch = oldDefaultRuntime.replay(
    oldRoom.initialized.genesis,
    committed.events,
  );
  const replayAfterSwitch = nextDefaultRuntime.replay(
    oldRoom.initialized.genesis,
    committed.events,
  );
  assert.equal(replayBeforeSwitch.kind, "replayed", JSON.stringify(replayBeforeSwitch));
  assert.equal(replayAfterSwitch.kind, "replayed", JSON.stringify(replayAfterSwitch));
  assert.deepEqual(replayAfterSwitch, replayBeforeSwitch);

  const viewer = {
    kind: "player",
    principalId: "principal:alice",
    characterId: "character:alice",
  };
  assert.deepEqual(
    nextDefaultRuntime.project(CURRENT_PROFILES, replayAfterSwitch.state, viewer),
    oldDefaultRuntime.project(CURRENT_PROFILES, replayBeforeSwitch.state, viewer),
  );
  assert.deepEqual(replayAfterSwitch.profiles, CURRENT_PROFILES);

  const newRoom = initializeRegistryScenario(nextDefaultRuntime, "new");
  assert.deepEqual(newRoom.initialized.profiles, SYNTHETIC_NEXT_PROFILES);
  assert.deepEqual(newRoom.replayed.profiles, SYNTHETIC_NEXT_PROFILES);
});

test("P07b step/project fail closed when a registered manifest does not match the state pin", () => {
  const runtime = registryRuntime(CURRENT_PROFILES.manifest);
  const room = initializeRegistryScenario(runtime, "mismatch");
  const viewer = {
    kind: "player",
    principalId: "principal:alice",
    characterId: "character:alice",
  };

  assertFailedClosed(
    runtime.project(SYNTHETIC_NEXT_PROFILES, room.replayed.state, viewer),
    "runtimeProfileMismatch",
  );
  assertFailedClosed(
    runtime.step(SYNTHETIC_NEXT_PROFILES, room.replayed.state, {
      kind: "declareCanonicalFact",
      proposalId: "proposal:wrong-runtime",
      fact: {
        factId: "fact:must-not-commit",
        factKind: "observedState",
        subjectRefs: ["scene:hall"],
        value: "不得提交",
        source: "observedEvent",
        causalParentIds: [],
        visibilityPolicy: "public",
      },
    }),
    "runtimeProfileMismatch",
  );

  const missingPin = structuredClone(room.replayed.state);
  delete missingPin.runtimeManifestRef;
  assertFailedClosed(
    runtime.project(CURRENT_PROFILES, missingPin, viewer),
    "invalidWorldState",
  );
});

test("P07c an unregistered manifest remains unsupported even when another default is active", () => {
  const runtime = registryRuntime(SYNTHETIC_NEXT_PROFILES.manifest);
  const room = initializeRegistryScenario(runtime, "unknown");
  const unknown = structuredClone(SYNTHETIC_NEXT_PROFILES);
  unknown.manifest = {
    profileId: "runtime-srd51-2014-authoritative-unknown-v99",
    profileHash: `sha256:${"9".repeat(64)}`,
  };

  assertFailedClosed(
    runtime.project(unknown, room.replayed.state, {
      kind: "player",
      principalId: "principal:alice",
      characterId: "character:alice",
    }),
    "unsupportedProfile",
  );
  const unknownGenesis = structuredClone(room.initialized.genesis);
  unknownGenesis.profiles = unknown;
  assertFailedClosed(runtime.replay(unknownGenesis, []), "unsupportedProfile");
});
