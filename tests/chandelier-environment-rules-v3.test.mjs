import assert from "node:assert/strict";
import test from "node:test";

import { compileKpFormDraft } from "../app/_runtime/lib/kp/causal-action-program.ts";
import {
  compileEnvironmentFeature,
  ENVIRONMENT_PROFILE,
  LEGACY_ENVIRONMENT_PROFILE,
} from "../app/_runtime/lib/rules/profiles/environment.ts";
import {
  buildCustomEnvironmentFeatureDefinition,
} from "../app/_runtime/lib/rules/profiles/environment-definition-builder.ts";
import { customEnvironmentDefinitionInputFromDraft } from "../app/_runtime/lib/rules/profiles/environment-form-lowering.ts";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import {
  CURRENT_RUNTIME_PROFILE_MANIFEST,
  ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
  LEGACY_ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
} from "../app/_runtime/lib/rules/profiles/manifests.ts";
import { createVersionedRulesRuntime } from "../app/_runtime/lib/rules/v2-runtime.ts";
import { eventHash, validateEventEnvelope } from "../app/_runtime/lib/rules/v2/events.ts";
import { hashWorldState } from "../app/_runtime/lib/rules/v2/validation.ts";
import {
  CHANDELIER_FEATURE_DEFINITION,
  CHANDELIER_ID,
  CRATE_ID,
  CUSTOM_SCENERY_WALL_FEATURE_DEFINITION,
  CUSTOM_SCENERY_WALL_ID,
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
const legacyEnvironmentRuntime = createVersionedRulesRuntime({
  registrations: [{
    manifest: LEGACY_ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
    interpreterKind: "authoritative-v2",
  }],
  defaultManifest: LEGACY_ENVIRONMENT_RUNTIME_PROFILE_MANIFEST.manifest,
});

function legacyChandelierDefinition() {
  const definition = structuredClone(CHANDELIER_FEATURE_DEFINITION);
  definition.schema = "zhuwei.environment-feature/v1";
  definition.environmentProfile = structuredClone(LEGACY_ENVIRONMENT_PROFILE);
  delete definition.effectMode;
  return definition;
}

function stateOnlyThreePhaseDefinition() {
  const definition = structuredClone(CUSTOM_SCENERY_WALL_FEATURE_DEFINITION);
  definition.featureId = "feature:gallery:three-phase-screen";
  definition.label = "可分两次展开的榆木屏风";
  definition.effectMode = "state-only";
  definition.initialState = "folded";
  definition.stateGraph.definitionId = "environment-state-graph:gallery:three-phase-screen";
  definition.stateGraph.states = [
    {
      state: "folded", opaque: false, impassable: false, cover: "none",
      propagation: "passes", terrain: "normal",
    },
    {
      state: "half-open", opaque: true, impassable: false, cover: "half",
      propagation: "blocks", terrain: "normal",
    },
    {
      state: "open", opaque: true, impassable: true, cover: "full",
      propagation: "blocks", terrain: "normal",
    },
  ];
  definition.stateGraph.transitions = [
    { fromState: "folded", trigger: "damageAtOrBelow", remainingDurabilityAtOrBelow: "0", toState: "half-open" },
    { fromState: "folded", trigger: "stuntSucceeded", toState: "half-open" },
    { fromState: "half-open", trigger: "damageAtOrBelow", remainingDurabilityAtOrBelow: "0", toState: "open" },
    { fromState: "half-open", trigger: "stuntSucceeded", toState: "open" },
  ];
  definition.hazard = null;
  definition.areaEffect = null;
  return definition;
}

function v3MultiThresholdCrateDefinition() {
  const definition = structuredClone(CUSTOM_SCENERY_WALL_FEATURE_DEFINITION);
  definition.featureId = CRATE_ID;
  definition.label = "多阈值木箱";
  definition.effectMode = "state-only";
  definition.polygon = [
    { x: "30", y: "-6" },
    { x: "30", y: "6" },
    { x: "42", y: "6" },
    { x: "42", y: "-6" },
  ];
  definition.elevation = "0";
  definition.height = "24";
  definition.initialState = "intact";
  definition.destructible.definitionId = "destructible:gallery:multi-threshold-crate";
  definition.destructible.armorClass = "10";
  definition.destructible.maximumDurability = "12";
  definition.destructible.damageThreshold = "0";
  definition.stateGraph.definitionId = "environment-state-graph:gallery:multi-threshold-crate";
  definition.stateGraph.states = [
    {
      state: "damaged", opaque: false, impassable: true, cover: "half",
      propagation: "passes", terrain: "normal",
    },
    {
      state: "destroyed", opaque: false, impassable: false, cover: "none",
      propagation: "passes", terrain: "rubble",
    },
    {
      state: "intact", opaque: false, impassable: true, cover: "half",
      propagation: "passes", terrain: "normal",
    },
  ];
  definition.stateGraph.transitions = [
    {
      fromState: "intact", trigger: "damageAtOrBelow",
      remainingDurabilityAtOrBelow: "10", toState: "damaged",
    },
    {
      fromState: "intact", trigger: "damageAtOrBelow",
      remainingDurabilityAtOrBelow: "2", toState: "destroyed",
    },
  ];
  definition.hazard = null;
  definition.areaEffect = null;
  return definition;
}

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
    resources: { resolve: 2 },
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

function initialize({
  existingChandelier = false,
  featureDefinition = CHANDELIER_FEATURE_DEFINITION,
  rulesRuntime = runtime,
} = {}) {
  const compiled = compileEnvironmentFeature(featureDefinition);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  if (!compiled.ok) throw new Error("environment fixture did not compile");
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
    featureId: compiled.artifact.tacticalFeature.featureId,
    rulesRuntime,
  };
}

function stuntInput(world, rootActionId, options = {}) {
  let normalizedOptions = structuredClone(options);
  const activation = normalizedOptions.activation ?? { kind: "attack" };
  const v3 = world.profiles.extensions.some((profile) =>
    profile.profileId === ENVIRONMENT_PROFILE.profileId
    && profile.profileHash === ENVIRONMENT_PROFILE.profileHash);
  let causalBinding = {};
  if (v3) {
    normalizedOptions.activation ??= structuredClone(activation);
    const suppliedDefinition = normalizedOptions.materialization?.featureDefinition;
    const definition = suppliedDefinition === undefined ? undefined : structuredClone(suppliedDefinition);
    const base = {
      goal: "按玩家的自定义想法改变当前环境",
      method: "由 KP 冻结具体对象与机械后执行",
      featureDescription: definition?.label ?? feature(world.state, world.featureId)?.label ?? "既有环境对象",
      intendedOutcome: "结算已冻结的环境变化",
      featureDisposition: definition === undefined ? "reuse-existing" : "reasonable-open-blank",
      activation: activation.kind,
      basisRefs: [definition === undefined ? world.featureId : definition.sceneId],
      ...(activation.kind === "attack"
        ? { attackApproach: "any", abilityRef: world.abilityRef }
        : activation.kind === "check"
          ? {
              checkAbility: activation.ability,
              checkSkill: activation.skill,
              checkDc: Number(activation.dc),
              checkMode: activation.mode,
              checkSuccessConsequence: "环境按冻结的成功分支变化。",
              checkFailureConsequence: "环境保持当前状态。",
            }
          : {}),
      ...(normalizedOptions.resourceCost === undefined ? {} : {
        resourceRef: normalizedOptions.resourceCost.resourceRef,
        resourceAmount: normalizedOptions.resourceCost.amount,
      }),
    };
    let draft = base;
    if (definition !== undefined) {
      const xs = definition.polygon.map(({ x }) => Number(x));
      const ys = definition.polygon.map(({ y }) => Number(y));
      const damageTransitions = definition.stateGraph.transitions.filter((entry) =>
        entry.trigger === "damageAtOrBelow");
      const stuntTransitions = definition.stateGraph.transitions.filter((entry) =>
        entry.trigger === "stuntSucceeded");
      const hazardTransitions = definition.stateGraph.transitions.filter((entry) =>
        entry.trigger === "hazardResolved");
      draft = {
        ...base,
        effectMode: definition.effectMode,
        material: "fixture-frozen-material",
        centerXInches: (Math.min(...xs) + Math.max(...xs)) / 2,
        centerYInches: (Math.min(...ys) + Math.max(...ys)) / 2,
        elevationInches: Number(definition.elevation),
        widthInches: Math.max(...xs) - Math.min(...xs),
        depthInches: Math.max(...ys) - Math.min(...ys),
        heightInches: Number(definition.height),
        objectAc: Number(definition.destructible.armorClass),
        objectHitPoints: Number(definition.destructible.maximumDurability),
        damageThreshold: Number(definition.destructible.damageThreshold),
        immuneDamageTypes: [...definition.destructible.immuneDamageTypes],
        initialPhase: definition.initialState,
        phaseNames: definition.stateGraph.states.map(({ state }) => state),
        phaseOpaque: definition.stateGraph.states.map(({ opaque }) => opaque),
        phaseImpassable: definition.stateGraph.states.map(({ impassable }) => impassable),
        phaseCover: definition.stateGraph.states.map(({ cover }) => cover),
        phaseEffectPropagation: definition.stateGraph.states.map(({ propagation }) => propagation),
        phaseTerrain: definition.stateGraph.states.map(({ terrain }) => terrain ?? "normal"),
        damageFromPhases: damageTransitions.map(({ fromState }) => fromState),
        damageRemainingAtOrBelow: damageTransitions.map(({ remainingDurabilityAtOrBelow }) =>
          Number(remainingDurabilityAtOrBelow)),
        damageToPhases: damageTransitions.map(({ toState }) => toState),
        ...(stuntTransitions.length === 0 ? {} : {
          stuntFromPhases: stuntTransitions.map(({ fromState }) => fromState),
          stuntToPhases: stuntTransitions.map(({ toState }) => toState),
        }),
        trigger: "KP 冻结的具体环境触发条件",
        ...(definition.effectMode === "state-only" ? {} : {
          hazardFromPhases: hazardTransitions.map(({ fromState }) => fromState),
          hazardToPhases: hazardTransitions.map(({ toState }) => toState),
          hazardTriggerPhase: definition.hazard.trigger.state,
          hazardResolvedPhase: definition.hazard.resolvedState,
          areaOriginElevationInches: Number(definition.areaEffect.origin.elevationInches),
          areaRadiusInches: Number(definition.areaEffect.shape.radiusInches),
          propagation: definition.areaEffect.shape.propagation,
          ...(definition.areaEffect.shape.spreadBudgetInches === undefined ? {} : {
            spreadBudgetInches: Number(definition.areaEffect.shape.spreadBudgetInches),
          }),
          saveAbility: definition.areaEffect.save.ability,
          saveDc: Number(definition.areaEffect.save.dc),
          halfOnSuccess: definition.areaEffect.save.halfOnSuccess,
          damage: definition.areaEffect.damage.formula,
          damageType: definition.areaEffect.damage.type,
          condition: definition.areaEffect.failureStatus,
          debrisOutcome: "进入 KP 冻结的最终环境状态。",
        }),
      };
      normalizedOptions.materialization.featureDefinition = buildCustomEnvironmentFeatureDefinition(
        customEnvironmentDefinitionInputFromDraft({
          draft,
          featureId: world.featureId,
          sceneId: definition.sceneId,
        }),
      );
    }
    const program = compileKpFormDraft("environmental-stunt.v1", draft);
    causalBinding = {
      actionPlanVersion: program.languageRef,
      actionLanguageHash: program.languageHash,
      causalActionProgram: program,
    };
  }
  const input = {
    kind: "invokeEnvironmentalStunt",
    rootActionId,
    actorCharacterId: ALICE.characterId,
    controllerPrincipalId: ALICE.principalId,
    featureId: world.featureId,
    ...causalBinding,
    ...normalizedOptions,
  };
  if (activation.kind !== "check" && activation.kind !== "direct") {
    input.abilityRef = world.abilityRef;
  }
  return input;
}

function explicitAbsenceInput(rootActionId) {
  const program = compileKpFormDraft("environmental-stunt.v1", {
    goal: "利用当前场景中不存在的对象",
    method: "尝试触发该对象",
    featureDescription: "并不存在的环境对象",
    intendedOutcome: "在世界内确认该前提不成立",
    featureDisposition: "explicitly-absent",
  });
  return {
    kind: "resolveCompoundActionPlan",
    rootActionId,
    actorCharacterId: ALICE.characterId,
    actionPlanVersion: program.languageRef,
    actionLanguageHash: program.languageHash,
    causalActionProgram: program,
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

function eventWithPayload(event, payload) {
  const forged = structuredClone(event);
  forged.payload = structuredClone(payload);
  forged.payloadHash = canonicalSha256(forged.payload);
  forged.eventHash = eventHash(forged);
  return forged;
}

function genesisWithEnvironmentFeature(genesis, tacticalFeature) {
  const forged = structuredClone(genesis);
  const geometry = forged.initialState.combatRuntime.scenes["scene:gallery"].geometry;
  geometry.obstacles = geometry.obstacles
    .map((feature) => feature.featureId === tacticalFeature.featureId
      ? structuredClone(tacticalFeature)
      : feature)
    .sort((left, right) => left.featureId.localeCompare(right.featureId));
  forged.initialStateHash = hashWorldState(forged.initialState);
  forged.initialState.eventHeadHash = forged.initialStateHash;
  const { genesisHash: _genesisHash, ...unsigned } = forged;
  forged.genesisHash = canonicalSha256(unsigned);
  return forged;
}

function installMultiThresholdCrate(world, targetGeneration = "unprofiled") {
  const geometry = world.state.combatRuntime.scenes["scene:gallery"].geometry;
  let crate;
  if (targetGeneration === "v3") {
    const compiled = compileEnvironmentFeature(v3MultiThresholdCrateDefinition());
    assert.equal(compiled.ok, true, JSON.stringify(compiled));
    if (!compiled.ok) throw new Error("V3 multi-threshold crate did not compile");
    crate = structuredClone(compiled.artifact.tacticalFeature);
  } else {
    crate = structuredClone(geometry.obstacles.find((entry) => entry.featureId === CRATE_ID));
    assert.ok(crate);
    crate.state = "intact";
    crate.durability.current = "12";
    crate.durability.maximum = "12";
    crate.stateGraph.durability.maximum = "12";
    crate.stateGraph.states = [
      {
        state: "damaged", opaque: false, impassable: true, cover: "half",
        propagation: "passes", terrain: "normal",
      },
      {
        state: "destroyed", opaque: false, impassable: false, cover: "none",
        propagation: "passes", terrain: "rubble",
      },
      {
        state: "intact", opaque: false, impassable: true, cover: "half",
        propagation: "passes", terrain: "normal",
      },
    ];
    crate.stateGraph.damageTransitions = [
      { fromState: "intact", remainingDurabilityAtOrBelow: "10", toState: "damaged" },
      { fromState: "intact", remainingDurabilityAtOrBelow: "2", toState: "destroyed" },
    ];
    crate.stateGraph.transitions = [];
  }
  world.genesis = genesisWithEnvironmentFeature(world.genesis, crate);
  const rebuilt = world.rulesRuntime.replay(world.genesis, []);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  world.state = rebuilt.state;
  return crate;
}

test("environment bindings and materialization events reject both cross-generation directions", () => {
  const legacyDefinition = legacyChandelierDefinition();
  const v3Blank = initialize();
  const v2Blank = initialize({
    featureDefinition: legacyDefinition,
    rulesRuntime: legacyEnvironmentRuntime,
  });
  const v3Materialized = v3Blank.rulesRuntime.step(
    v3Blank.profiles,
    v3Blank.state,
    stuntInput(v3Blank, "root:environment:cross-v3", {
      materialization: { featureDefinition: CHANDELIER_FEATURE_DEFINITION },
    }),
  );
  const v2Materialized = v2Blank.rulesRuntime.step(
    v2Blank.profiles,
    v2Blank.state,
    stuntInput(v2Blank, "root:environment:cross-v2", {
      materialization: { featureDefinition: legacyDefinition },
    }),
  );
  assert.equal(v3Materialized.kind, "awaitingRandomness", JSON.stringify(v3Materialized));
  assert.equal(v2Materialized.kind, "awaitingRandomness", JSON.stringify(v2Materialized));
  const v3Event = v3Materialized.events.find((event) =>
    event.eventType === "EnvironmentFeatureMaterialized");
  const v2Event = v2Materialized.events.find((event) =>
    event.eventType === "EnvironmentFeatureMaterialized");
  assert.ok(v3Event);
  assert.ok(v2Event);

  for (const [target, donor, world] of [
    [v3Event, v2Event, v3Blank],
    [v2Event, v3Event, v2Blank],
  ]) {
    const forged = eventWithPayload(target, donor.payload);
    assert.equal(validateEventEnvelope(forged).ok, false);
    const replayed = world.rulesRuntime.replay(world.genesis, [forged]);
    assert.equal(replayed.kind, "rejected", JSON.stringify(replayed));
    assert.equal(replayed.rejection.code, "invalidEventEnvelope");
  }

  const v3Existing = initialize({ existingChandelier: true });
  const v2Existing = initialize({
    existingChandelier: true,
    featureDefinition: legacyDefinition,
    rulesRuntime: legacyEnvironmentRuntime,
  });
  const v3Compiled = compileEnvironmentFeature(CHANDELIER_FEATURE_DEFINITION);
  const v2Compiled = compileEnvironmentFeature(legacyDefinition);
  assert.equal(v3Compiled.ok, true);
  assert.equal(v2Compiled.ok, true);
  if (!v3Compiled.ok || !v2Compiled.ok) return;
  for (const [world, donorFeature] of [
    [v3Existing, v2Compiled.artifact.tacticalFeature],
    [v2Existing, v3Compiled.artifact.tacticalFeature],
  ]) {
    const replayed = world.rulesRuntime.replay(
      genesisWithEnvironmentFeature(world.genesis, donorFeature),
      [],
    );
    assert.equal(replayed.kind, "rejected", JSON.stringify(replayed));
    assert.equal(replayed.rejection.code, "profileIntegrityMismatch");
  }
});

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
  assert.deepEqual(reused.events.map(({ eventType }) => eventType), [
    "ImprovisedActionResolved",
    "RandomnessRequested",
  ]);
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
    "ImprovisedActionResolved",
    "EnvironmentFeatureMaterialized",
    "RandomnessRequested",
  ]);
  assert.equal(materialized.events[1].secrecy, "internal");
  assert.equal(feature(materialized.state, CHANDELIER_ID).state, "suspended");
  const materializedProjection = playerProjection({ ...blank, state: materialized.state });
  assert.ok(materializedProjection.tacticalProjection.knownFeatures
    .some(({ id }) => id === CHANDELIER_ID));
  assert.ok(!JSON.stringify(materializedProjection).includes("featureDefinitionHash"));
  const forgedLegacyEvent = structuredClone(materialized.events[1]);
  forgedLegacyEvent.profiles = structuredClone(CURRENT_RUNTIME_PROFILE_MANIFEST);
  forgedLegacyEvent.eventHash = eventHash(forgedLegacyEvent);
  assert.equal(validateEventEnvelope(forgedLegacyEvent).ok, false);
  const forgedCausalLink = eventWithPayload(materialized.events[1], {
    ...materialized.events[1].payload,
    causalProgramHash: "fnv1a64:0000000000000000",
  });
  assert.equal(validateEventEnvelope(forgedCausalLink).ok, true);
  const forgedReplay = blank.rulesRuntime.replay(
    blank.genesis,
    [materialized.events[0], forgedCausalLink],
  );
  assert.equal(forgedReplay.kind, "rejected", JSON.stringify(forgedReplay));

  const absent = initialize();
  const refused = absent.rulesRuntime.step(
    absent.profiles,
    absent.state,
    explicitAbsenceInput("root:environment:absent"),
  );
  assert.equal(refused.kind, "committed", JSON.stringify(refused));
  assert.deepEqual(refused.events.map(({ eventType }) => eventType), [
    "ImprovisedActionResolved",
    "ImprovisedActionResolved",
    "KnowledgeAcquired",
  ]);
  assert.equal(refused.mechanicalResult.disposition, "inWorldRefusal");
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

test("area damage uses the target generation for multi-threshold semantics and replay", () => {
  for (const [label, targetGeneration, expectedState] of [
    ["unprofiled-target", "unprofiled", "damaged"],
    ["v3-target", "v3", "destroyed"],
  ]) {
    const world = initialize({ existingChandelier: true });
    installMultiThresholdCrate(world, targetGeneration);
    const attack = world.rulesRuntime.step(
      world.profiles,
      world.state,
      stuntInput(world, `root:environment:multi-threshold:${label}`),
    );
    assert.equal(attack.kind, "awaitingRandomness", JSON.stringify(attack));
    assert.ok(attack.state.combatRuntime.randomnessResolutions[attack.resolutionId]);
    const hazard = fulfill(world, attack, (purpose) =>
      purpose.startsWith("attack:environment:") ? 20 : 8);
    assert.equal(hazard.kind, "awaitingRandomness", JSON.stringify(hazard));
    const resolved = fulfill(world, hazard, (purpose, count) =>
      purpose.startsWith("damage:environment-hazard:")
        ? [5, 6].slice(0, count)
        : Array(count).fill(20));
    assert.equal(resolved.kind, "committed", JSON.stringify(resolved));
    const crate = feature(resolved.state, CRATE_ID);
    assert.equal(crate.durability.current, "1");
    assert.equal(crate.state, expectedState, label);
    const damaged = world.events.find((event) =>
      event.eventType === "EnvironmentAreaFeatureDamaged"
      && event.payload.targetFeatureId === CRATE_ID);
    assert.equal(damaged.payload.toState, expectedState, label);
    const replayed = world.rulesRuntime.replay(world.genesis, world.events);
    assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
    assert.equal(feature(replayed.state, CRATE_ID).state, expectedState, `${label}:replay`);
  }
});

test("only V3 supports resource-priced successor-state environmental stunts", () => {
  const definition = stateOnlyThreePhaseDefinition();
  const world = initialize({ existingChandelier: true, featureDefinition: definition });
  const first = world.rulesRuntime.step(world.profiles, world.state, stuntInput(
    world,
    "root:environment:three-phase:first",
    {
      activation: { kind: "direct" },
      resourceCost: { resourceRef: "resolve", amount: 1 },
    },
  ));
  assert.equal(first.kind, "committed", JSON.stringify(first));
  assert.equal(feature(first.state, definition.featureId).state, "half-open");
  assert.equal(first.state.entities[ALICE.characterId].resources.resolve, 1);
  assert.equal(first.events.filter((event) => event.eventType === "ResourceReserved").length, 1);

  const nextEligibleTurn = structuredClone(first.state);
  nextEligibleTurn.combatRuntime.entities[ALICE.characterId].turn.action = "1";
  const second = world.rulesRuntime.step(world.profiles, nextEligibleTurn, stuntInput(
    world,
    "root:environment:three-phase:second",
    {
      activation: { kind: "direct" },
      resourceCost: { resourceRef: "resolve", amount: 1 },
    },
  ));
  assert.equal(second.kind, "committed", JSON.stringify(second));
  assert.equal(feature(second.state, definition.featureId).state, "open");
  assert.equal(second.state.entities[ALICE.characterId].resources.resolve, 0);
  assert.equal(second.events.filter((event) => event.eventType === "ResourceReserved").length, 1);

  const noEdge = world.rulesRuntime.step(world.profiles, second.state, stuntInput(
    world,
    "root:environment:three-phase:no-edge",
    { activation: { kind: "direct" } },
  ));
  assert.equal(noEdge.kind, "rejected", JSON.stringify(noEdge));
  assert.equal(noEdge.rejection.code, "worldLawViolation");
  assert.equal(noEdge.events.length, 0);

  const insufficientWorld = initialize({ existingChandelier: true, featureDefinition: definition });
  const insufficient = insufficientWorld.rulesRuntime.step(
    insufficientWorld.profiles,
    insufficientWorld.state,
    stuntInput(insufficientWorld, "root:environment:three-phase:insufficient", {
      activation: { kind: "direct" },
      resourceCost: { resourceRef: "resolve", amount: 3 },
    }),
  );
  assert.equal(insufficient.kind, "rejected", JSON.stringify(insufficient));
  assert.equal(insufficient.rejection.code, "insufficientResource");
  assert.equal(insufficient.events.length, 0);
  assert.equal(insufficientWorld.state.entities[ALICE.characterId].resources.resolve, 2);

  const legacyDefinition = legacyChandelierDefinition();
  legacyDefinition.stateGraph.transitions.push({
    fromState: "debris",
    trigger: "stuntSucceeded",
    toState: "falling",
  });
  legacyDefinition.stateGraph.transitions.sort((left, right) =>
    `${left.fromState}\u0000${left.trigger}\u0000${left.remainingDurabilityAtOrBelow ?? ""}\u0000${left.toState}`
      .localeCompare(`${right.fromState}\u0000${right.trigger}\u0000${right.remainingDurabilityAtOrBelow ?? ""}\u0000${right.toState}`));
  const legacyWorld = initialize({
    existingChandelier: true,
    featureDefinition: legacyDefinition,
    rulesRuntime: legacyEnvironmentRuntime,
  });
  const legacyCost = legacyWorld.rulesRuntime.step(
    legacyWorld.profiles,
    legacyWorld.state,
    stuntInput(legacyWorld, "root:environment:legacy-resource", {
      activation: { kind: "direct" },
      resourceCost: { resourceRef: "resolve", amount: 1 },
    }),
  );
  assert.equal(legacyCost.kind, "rejected", JSON.stringify(legacyCost));
  assert.equal(legacyCost.rejection.code, "invalidRulesInput");
  assert.equal(legacyCost.events.length, 0);
  assert.equal(legacyWorld.state.entities[ALICE.characterId].resources.resolve, 2);

  const legacyAttack = legacyWorld.rulesRuntime.step(
    legacyWorld.profiles,
    legacyWorld.state,
    stuntInput(legacyWorld, "root:environment:legacy-to-debris"),
  );
  const legacyHazard = fulfill(legacyWorld, legacyAttack, (purpose) =>
    purpose.startsWith("attack:environment:") ? 20 : 8);
  const legacyResolved = fulfill(legacyWorld, legacyHazard, (purpose, count) =>
    purpose.startsWith("damage:environment-hazard:")
      ? Array(count).fill(1)
      : Array(count).fill(20));
  assert.equal(legacyResolved.kind, "committed", JSON.stringify(legacyResolved));
  assert.equal(feature(legacyResolved.state, legacyDefinition.featureId).state, "debris");
  const legacySuccessor = legacyWorld.rulesRuntime.step(
    legacyWorld.profiles,
    legacyResolved.state,
    stuntInput(legacyWorld, "root:environment:legacy-successor", { activation: { kind: "direct" } }),
  );
  assert.equal(legacySuccessor.kind, "rejected", JSON.stringify(legacySuccessor));
  assert.equal(legacySuccessor.rejection.code, "worldLawViolation");
  assert.equal(legacySuccessor.events.length, 0);
});

test("KP-authored non-chandelier scenery supports attack, check, and direct activation without caller targets or rerolls", () => {
  const attackWorld = initialize({
    existingChandelier: true,
    featureDefinition: CUSTOM_SCENERY_WALL_FEATURE_DEFINITION,
  });
  const attackInput = stuntInput(attackWorld, "root:environment:custom-attack", {
    activation: { kind: "attack" },
  });
  const attackAwaiting = attackWorld.rulesRuntime.step(
    attackWorld.profiles,
    attackWorld.state,
    attackInput,
  );
  assert.equal(attackAwaiting.kind, "awaitingRandomness", JSON.stringify(attackAwaiting));
  assert.deepEqual(
    attackAwaiting.state.combatRuntime.randomnessResolutions[attackAwaiting.resolutionId]
      .operation.activation,
    { kind: "attack" },
  );
  const attackHazard = fulfill(attackWorld, attackAwaiting, (purpose) =>
    purpose.startsWith("attack:environment:") ? 20 : 8);
  assert.equal(attackHazard.kind, "awaitingRandomness", JSON.stringify(attackHazard));
  assert.equal(feature(attackHazard.state, CUSTOM_SCENERY_WALL_ID).state, "toppling");
  assert.ok(attackWorld.events.some(({ eventType }) => eventType === "EnvironmentFeatureDamaged"));

  const failedCheckWorld = initialize({
    existingChandelier: true,
    featureDefinition: CUSTOM_SCENERY_WALL_FEATURE_DEFINITION,
  });
  const failedCheckInput = stuntInput(
    failedCheckWorld,
    "root:environment:custom-check-failure",
    {
      activation: {
        kind: "check",
        ability: "dex",
        skill: "acrobatics",
        dc: "30",
        mode: "advantage",
      },
    },
  );
  const failedCheckAwaiting = failedCheckWorld.rulesRuntime.step(
    failedCheckWorld.profiles,
    failedCheckWorld.state,
    failedCheckInput,
  );
  assert.equal(failedCheckAwaiting.kind, "awaitingRandomness", JSON.stringify(failedCheckAwaiting));
  assert.deepEqual(failedCheckAwaiting.randomnessRequests.map((request) => request.dice), [[{
    count: "2",
    sides: "20",
  }]]);
  assert.deepEqual(failedCheckAwaiting.randomnessRequests[0].frozenParameters, {
    sourceEntityId: ALICE.characterId,
    featureId: CUSTOM_SCENERY_WALL_ID,
    ability: "dex",
    skill: "acrobatics",
    dc: "30",
    mode: "advantage",
    modifier: 3,
    environmentFeatureHash: feature(failedCheckAwaiting.state, CUSTOM_SCENERY_WALL_ID)
      .environment.featureDefinitionHash,
  });
  const failedCheckRetry = failedCheckWorld.rulesRuntime.step(
    failedCheckWorld.profiles,
    failedCheckAwaiting.state,
    failedCheckInput,
  );
  assert.equal(failedCheckRetry.kind, "rejected");
  assert.equal(failedCheckRetry.rejection.code, "duplicateRootAction");
  assert.deepEqual(
    failedCheckAwaiting.state.combatRuntime.randomnessResolutions[failedCheckAwaiting.resolutionId]
      .randomnessRequests,
    failedCheckAwaiting.randomnessRequests,
  );
  const failedCheck = fulfill(failedCheckWorld, failedCheckAwaiting, () => [20, 1]);
  assert.equal(failedCheck.kind, "committed", JSON.stringify(failedCheck));
  assert.deepEqual(failedCheck.mechanicalResult, {
    kind: "environmentalStuntCheckResolved",
    activation: {
      kind: "check",
      ability: "dex",
      skill: "acrobatics",
      dc: "30",
      mode: "advantage",
    },
    featureId: CUSTOM_SCENERY_WALL_ID,
    rolls: [20, 1],
    selectedRoll: 20,
    modifier: 3,
    total: 23,
    succeeded: false,
    outcome: "checkFailed",
  });
  assert.equal(feature(failedCheck.state, CUSTOM_SCENERY_WALL_ID).state, "braced");
  assert.equal(feature(failedCheck.state, CUSTOM_SCENERY_WALL_ID).durability.current, "8");
  assert.equal(failedCheck.state.combatRuntime.entities[ALICE.characterId].turn.action, "0");
  assert.ok(!failedCheckWorld.events.some(({ eventType }) =>
    eventType === "EnvironmentHazardTriggered"));
  const failedCheckReplay = failedCheckWorld.rulesRuntime.replay(
    failedCheckWorld.genesis,
    failedCheckWorld.events,
  );
  assert.equal(failedCheckReplay.kind, "replayed", JSON.stringify(failedCheckReplay));
  assert.equal(hashWorldState(failedCheckReplay.state), hashWorldState(failedCheck.state));

  const successfulCheckWorld = initialize({
    existingChandelier: true,
    featureDefinition: CUSTOM_SCENERY_WALL_FEATURE_DEFINITION,
  });
  const successfulCheckInput = stuntInput(
    successfulCheckWorld,
    "root:environment:custom-check-success",
    {
      activation: {
        kind: "check",
        ability: "str",
        skill: "athletics",
        dc: "12",
        mode: "normal",
      },
    },
  );
  const successfulCheckAwaiting = successfulCheckWorld.rulesRuntime.step(
    successfulCheckWorld.profiles,
    successfulCheckWorld.state,
    successfulCheckInput,
  );
  const successfulCheckHazard = fulfill(successfulCheckWorld, successfulCheckAwaiting, () => 20);
  assert.equal(successfulCheckHazard.kind, "awaitingRandomness", JSON.stringify(successfulCheckHazard));
  assert.equal(successfulCheckHazard.mechanicalResult.outcome, "triggered");
  assert.equal(feature(successfulCheckHazard.state, CUSTOM_SCENERY_WALL_ID).state, "toppling");
  const successfulCheckInvocation = successfulCheckWorld.events.find(({ eventType }) =>
    eventType === "AbilityInvoked");
  assert.equal(successfulCheckInvocation.payload.mechanicalResult.succeeded, true);
  assert.deepEqual(successfulCheckInvocation.payload.mechanicalResult.activation, {
    kind: "check",
    ability: "str",
    skill: "athletics",
    dc: "12",
    mode: "normal",
  });
  const successfulCheckResolved = fulfill(
    successfulCheckWorld,
    successfulCheckHazard,
    (purpose, count) => {
      if (purpose.startsWith("damage:environment-hazard:")) return Array(count).fill(6);
      if (purpose.endsWith(`:${HIDDEN_ID}`)) return 1;
      return 20;
    },
  );
  assert.equal(successfulCheckResolved.kind, "committed", JSON.stringify(successfulCheckResolved));
  assert.equal(feature(successfulCheckResolved.state, CUSTOM_SCENERY_WALL_ID).state, "debris");
  assert.equal(successfulCheckResolved.state.combatRuntime.entities[HIDDEN_ID].lifeState, "dead");
  const successfulCheckHazardEvent = successfulCheckWorld.events.find(({ eventType }) =>
    eventType === "EnvironmentHazardTriggered");
  assert.ok(successfulCheckHazardEvent.payload.entityTargetIds.includes(HIDDEN_ID));
  const successfulCheckReplay = successfulCheckWorld.rulesRuntime.replay(
    successfulCheckWorld.genesis,
    successfulCheckWorld.events,
  );
  assert.equal(successfulCheckReplay.kind, "replayed", JSON.stringify(successfulCheckReplay));
  assert.equal(
    hashWorldState(successfulCheckReplay.state),
    hashWorldState(successfulCheckResolved.state),
  );

  const directWorld = initialize({
    existingChandelier: true,
    featureDefinition: CUSTOM_SCENERY_WALL_FEATURE_DEFINITION,
  });
  const directInput = stuntInput(directWorld, "root:environment:custom-direct", {
    activation: { kind: "direct" },
  });
  const directHazard = directWorld.rulesRuntime.step(
    directWorld.profiles,
    directWorld.state,
    directInput,
  );
  assert.equal(directHazard.kind, "awaitingRandomness", JSON.stringify(directHazard));
  assert.deepEqual(directHazard.events.map(({ eventType }) => eventType), [
    "ImprovisedActionResolved",
    "AbilityInvoked",
    "EnvironmentFeatureStateChanged",
    "RandomnessRequested",
  ]);
  assert.deepEqual(directHazard.mechanicalResult.activation, { kind: "direct" });
  assert.equal(feature(directHazard.state, CUSTOM_SCENERY_WALL_ID).state, "toppling");
  assert.ok(directHazard.randomnessRequests.every(({ purposeKey }) =>
    !purposeKey.startsWith("check:")));
  const directRetry = directWorld.rulesRuntime.step(
    directWorld.profiles,
    directHazard.state,
    directInput,
  );
  assert.equal(directRetry.kind, "rejected");
  assert.equal(directRetry.rejection.code, "duplicateRootAction");
  assert.deepEqual(
    directHazard.state.combatRuntime.randomnessResolutions[directHazard.resolutionId]
      .randomnessRequests,
    directHazard.randomnessRequests,
  );
  const directResolved = fulfill(directWorld, directHazard, (purpose, count) =>
    purpose.startsWith("damage:environment-hazard:") ? Array(count).fill(1) : 20);
  assert.equal(directResolved.kind, "committed", JSON.stringify(directResolved));
  assert.equal(feature(directResolved.state, CUSTOM_SCENERY_WALL_ID).state, "debris");
  const directReplay = directWorld.rulesRuntime.replay(directWorld.genesis, directWorld.events);
  assert.equal(directReplay.kind, "replayed", JSON.stringify(directReplay));
  assert.equal(hashWorldState(directReplay.state), hashWorldState(directResolved.state));
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
  assert.deepEqual(eventTypes.slice(0, 3), [
    "ImprovisedActionResolved",
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
  assert.ok(hazard);
  const forgedHazard = structuredClone(hazard);
  forgedHazard.payload.environmentProfile = structuredClone(LEGACY_ENVIRONMENT_PROFILE);
  forgedHazard.payloadHash = canonicalSha256(forgedHazard.payload);
  forgedHazard.eventHash = eventHash(forgedHazard);
  assert.equal(validateEventEnvelope(forgedHazard).ok, false);
  const hazardIndex = world.events.indexOf(hazard);
  const forgedHazardReplay = world.rulesRuntime.replay(
    world.genesis,
    [...world.events.slice(0, hazardIndex), forgedHazard],
  );
  assert.equal(forgedHazardReplay.kind, "rejected", JSON.stringify(forgedHazardReplay));
  assert.equal(forgedHazardReplay.rejection.code, "invalidEventEnvelope");
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
