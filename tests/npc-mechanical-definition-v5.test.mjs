import assert from "node:assert/strict";
import test from "node:test";

import { project, replay, step } from "../app/_runtime/lib/rules/index.ts";
import {
  ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
  ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
} from "../app/_runtime/lib/rules/profiles/manifests.ts";
import { buildV3ContextPack } from "../app/_runtime/lib/kp/v3-context-runtime.ts";
import { compileKpFormDraft } from "../app/_runtime/lib/kp/causal-action-program.ts";

const PLAYER = "character:npc-mechanics-v5:player";
const PRINCIPAL = "principal:npc-mechanics-v5:player";
const SEAT = "seat:npc-mechanics-v5:player";
const SCENE = "scene:npc-mechanics-v5:yard";
const STATIC_NPC = "npc:npc-mechanics-v5:warden";
const YARD_BASIS = "fact:npc-mechanics-v5:yard-basis";

const WARDEN_SOCIAL = {
  abilityScores: { str: 14, dex: 12, con: 14, int: 10, wis: 12, cha: 10 },
  proficiencyBonus: 2,
  skillModifiers: { insight: 3 },
  initialTrust: 0,
  authorityModifier: 1,
  stakesSensitivity: 1,
  maximumInfluenceDegree: "fullSuccess",
};

function initialize({
  withSpatialNpc = false,
  npcOverrides = {},
  playerBackpack = [],
  profiles = ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
  withCausalBasis = false,
} = {}) {
  const initialized = step(profiles, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: `room:npc-mechanics-v5:${withSpatialNpc ? "shell" : "shared"}`,
    runtimeEpochId: `epoch:npc-mechanics-v5:${withSpatialNpc ? "shell" : "shared"}:1`,
    moduleRef: {
      profileId: "module:npc-mechanics-v5",
      profileHash: `sha256:${"a".repeat(64)}`,
    },
    initialDefinitionCatalogRef: {
      profileId: "definitions:npc-mechanics-v5",
      profileHash: `sha256:${"b".repeat(64)}`,
    },
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{
      id: SCENE,
      name: "演武院",
      geometry: {
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
          featureId: "feature:npc-mechanics-v5:yard-wall",
          kind: "barrier",
          label: "演武院矮墙",
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
    principals: [{ id: PRINCIPAL, sessionVersion: 1, role: "host" }],
    seats: [{ id: SEAT, principalId: PRINCIPAL, status: "active" }],
    characters: [{
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
      resources: {},
      resourceMaximums: {},
      hitPoints: { current: 20, maximum: 20 },
      loadout: {
        armorClass: 15,
        speedFeet: 30,
        equipped: {},
        backpack: structuredClone(playerBackpack),
      },
      characterBuild: { classId: "fighter", raceId: "human", cantrips: [], prepared: [] },
    }, ...(withSpatialNpc ? [{
      id: STATIC_NPC,
      kind: "npc",
      name: "院墙守卫",
      sceneId: SCENE,
      tenureStatus: "active",
      abilityScores: structuredClone(WARDEN_SOCIAL.abilityScores),
      proficiencyBonus: WARDEN_SOCIAL.proficiencyBonus,
      socialMechanics: structuredClone(WARDEN_SOCIAL),
      spatialVisibilityPolicyId: "visibility:scene-observers",
      ...structuredClone(npcOverrides),
    }] : [])],
    characterControls: [{ characterId: PLAYER, seatId: SEAT }],
    canonicalFacts: withCausalBasis ? [{
      id: YARD_BASIS,
      kind: "moduleAnchor",
      source: "moduleAnchor",
      subjectRefs: [SCENE],
      value: { description: "演武院当前可供人物当面交接装备，也可能爆发冲突。" },
      visibilityPolicyId: "visibility:scene-observers",
    }] : [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const rebuilt = replay(initialized.genesis, []);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  return { genesis: initialized.genesis, profiles: initialized.profiles, state: rebuilt.state, events: [] };
}

function causalMaterializationInput(rootActionId, draft) {
  const program = compileKpFormDraft("materialization.v1", draft);
  return {
    kind: "resolveCompoundActionPlan",
    actionPlanVersion: program.languageRef,
    actionLanguageHash: program.languageHash,
    causalActionProgram: program,
    rootActionId,
    actorCharacterId: PLAYER,
  };
}

function appendAndReplay(scenario, outcome) {
  assert.notEqual(outcome.kind, "rejected", JSON.stringify(outcome));
  const events = [...scenario.events, ...outcome.events];
  const rebuilt = replay(scenario.genesis, events);
  if (rebuilt.kind !== "replayed") {
    const firstRejectedPrefix = events.findIndex((_, index) =>
      replay(scenario.genesis, events.slice(0, index + 1)).kind !== "replayed");
    assert.fail(JSON.stringify({ rebuilt, firstRejectedPrefix, event: events[firstRejectedPrefix] }));
  }
  return { ...scenario, events, state: rebuilt.state };
}

function settleRoomRandomness(scenario, waiting) {
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  let current = appendAndReplay(scenario, waiting);
  let outcome = waiting;
  while (outcome.kind === "awaitingRandomness") {
    outcome = step(current.profiles, current.state, {
      kind: "authoritativeRandomness",
      resolutionId: outcome.resolutionId,
      responseId: `authority-response:${outcome.resolutionId}`,
      continuationCapability: outcome.continuationCapability,
      randomnessResults: outcome.randomnessRequests.map((request, requestIndex) => ({
        randomnessId: request.randomnessId,
        requestHash: request.requestHash,
        draws: request.dice.map(({ count, sides }) => ({
          sides: Number(sides),
          faces: Array.from(
            { length: Number(count) },
            () => Math.min(10 + requestIndex, Number(sides)),
          ),
        })),
      })),
    });
    current = appendAndReplay(current, outcome);
  }
  while (outcome.kind === "awaitingInput") {
    assert.equal(outcome.pending.choiceKind, "initiativeTieOrder", JSON.stringify(outcome));
    outcome = step(current.profiles, current.state, {
      kind: "answerPendingInput",
      pendingInputId: outcome.pending.pendingInputId,
      responseId: `response:${outcome.pending.pendingInputId}:ordered`,
      answer: { orderedEntityIds: outcome.pending.orderedEntityIds },
    });
    current = appendAndReplay(current, outcome);
  }
  assert.equal(outcome.kind, "committed", JSON.stringify(outcome));
  return current;
}

function concludeEncounter(scenario, encounterId, suffix) {
  let outcome = step(scenario.profiles, scenario.state, {
    kind: "proposeEncounterConclusion",
    rootActionId: `root:${suffix}:propose-conclusion`,
    encounterId,
    proposal: { reason: "hostilitiesEnded" },
  });
  assert.equal(outcome.kind, "awaitingInput", JSON.stringify(outcome));
  let current = appendAndReplay(scenario, outcome);
  let responseIndex = 0;
  while (outcome.kind === "awaitingInput") {
    assert.equal(outcome.pending.choiceKind, "encounterConclusion");
    responseIndex += 1;
    outcome = step(current.profiles, current.state, {
      kind: "answerPendingInput",
      pendingInputId: outcome.pending.pendingInputId,
      responseId: `response:${suffix}:accept-conclusion:${responseIndex}`,
      answer: { kind: "acceptEncounterConclusion" },
    });
    current = appendAndReplay(current, outcome);
  }
  assert.equal(outcome.kind, "committed", JSON.stringify(outcome));
  assert.equal(current.state.combatRuntime.encounters[encounterId].status, "concluded");
  return current;
}

function templateDefinition(definitionId, abilityId, overrides = {}) {
  const stats = {
    str: "14", dex: "12", con: "14", int: "10", wis: "12", cha: "10",
    ...(overrides.stats ?? {}),
  };
  return {
    definitionId,
    revision: "1",
    definitionKind: "npcMechanicalTemplate",
    rulesBasis: "srd5.1-2014",
    causalBasisRefs: [],
    visibilityPolicyRef: "visibility:room-authority-only",
    content: {
      schema: "zhuwei.npc-mechanical-template/v1",
      label: "院墙守卫",
      stats,
      proficiencyBonus: "2",
      armorClass: overrides.armorClass ?? "14",
      armorClassModel: {
        kind: "higherOfBaseAndEquipment",
        baseArmorClass: overrides.armorClass ?? "14",
        shieldBonus: "2",
      },
      hitPointsMaximum: "18",
      footprint: { width: "60", depth: "60", height: "60" },
      speedInches: structuredClone(overrides.speedInches ?? { walk: "360" }),
      resourceMaximums: { "resource:brace": "1" },
      deathPolicy: "defeatedAtZero",
      ...(overrides.attacksPerAttackAction === undefined
        ? {}
        : { attacksPerAttackAction: overrides.attacksPerAttackAction }),
      intrinsicAbilities: structuredClone(overrides.intrinsicAbilities ?? [{
        definitionId: abilityId,
        revision: "1",
        rulesBasis: "srd5.1-2014",
        mechanicalKey: "warden-spear",
        activation: { kind: "attack", actionGrant: "attack" },
        target: { kind: "creature", count: "1", reachInches: "60", requiresSight: true },
        attack: { ability: "str", proficiency: true },
        damage: [{ type: "piercing", formula: "1d6+2" }],
      }]),
      itemDefinitions: structuredClone(overrides.itemDefinitions ?? []),
      itemDefinitionRefs: structuredClone(overrides.itemDefinitionRefs ?? []),
      initialLoadout: structuredClone(overrides.initialLoadout ?? { entries: [] }),
    },
  };
}

function bespokeEntity({ entityId, name, definitionId, abilityId, position, initialState, overrides }) {
  return {
    entityId,
    name,
    placement: position === null ? null : { position },
    mechanics: {
      kind: "bespokeDefinition",
      definition: templateDefinition(definitionId, abilityId, overrides),
    },
    ...(initialState === undefined ? {} : { initialState }),
  };
}

function encounterInput(rootActionId, encounterId, dynamicEntities, npcIds) {
  const participants = [PLAYER, ...npcIds];
  return {
    kind: "startEncounter",
    rootActionId,
    proposalAttemptId: `proposal:${rootActionId}:1`,
    encounterId,
    sceneId: SCENE,
    participantEntityIds: participants,
    dynamicEntities,
    initiativeGroups: participants.map((entityId) => ({
      entryId: `initiative:${encounterId}:${entityId}`,
      combatantEntityIds: [entityId],
    })),
    hostilities: [
      { fromEntityIds: [PLAYER], toEntityIds: [...npcIds] },
      { fromEntityIds: [...npcIds], toEntityIds: [PLAYER] },
    ],
    battlefieldFactIds: [],
  };
}

test("a V5 private materialization Form starts one frozen NPC encounter while V4 stays isolated", () => {
  const rootActionId = "root:npc-mechanics-v5:causal-encounter";
  const encounterId = "encounter:npc-mechanics-v5:causal";
  const enemyId = "npc:npc-mechanics-v5:causal-warden";
  const proposedFact = JSON.stringify({
    schema: "zhuwei.npc-mechanical-encounter-draft/v1",
    encounterRef: encounterId,
    alliedEntityRefs: [],
    hostileEntityRefs: [enemyId],
    entries: [bespokeEntity({
      entityId: enemyId,
      name: "突入演武院的卫兵",
      definitionId: "npc-mechanics:causal-warden:1",
      abilityId: "ability:npc-mechanics:causal-warden:spear",
      position: { x: "480", y: "180", elevation: "0" },
    })],
  });
  assert.ok(proposedFact.length <= 2_000, "the draft must fit the model-visible Form field");
  const draft = {
    goal: "让突然闯入的卫兵进入权威战斗",
    method: "materializeNpcMechanicalEncounter",
    proposedFact,
    basisRefs: [SCENE, YARD_BASIS],
    resolution: "direct",
    durationUnit: "minute",
    durationValue: 1,
  };
  const input = causalMaterializationInput(rootActionId, draft);

  const v5 = initialize({ withCausalBasis: true });
  const opened = step(v5.profiles, v5.state, input);
  assert.equal(opened.kind, "awaitingRandomness", JSON.stringify(opened));
  assert.equal(opened.events[0].eventType, "ImprovisedActionResolved");
  assert.equal(
    opened.events.filter(({ eventType }) => eventType === "DefinitionRegistered").length,
    2,
  );
  assert.equal(
    opened.events.filter(({ eventType }) => eventType === "EntityMaterialized").length,
    1,
  );
  assert.equal(
    opened.events.filter(({ eventType }) => eventType === "FictionTimeAdvanced").length,
    0,
  );
  assert.deepEqual(
    opened.state.combatRuntime.encounters[encounterId].participantEntityIds,
    [PLAYER, enemyId].sort(),
  );
  assert.deepEqual(
    opened.state.combatRuntime.encounters[encounterId].hostilities,
    [
      { fromEntityIds: [PLAYER], toEntityIds: [enemyId] },
      { fromEntityIds: [enemyId], toEntityIds: [PLAYER] },
    ],
  );
  assert.equal(opened.state.fictionTimelines["branch:main"].nowMicros, "0");
  settleRoomRandomness(v5, opened);

  const v4 = initialize({ profiles: ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST, withCausalBasis: true });
  const beforeV4 = structuredClone(v4.state);
  const isolated = step(v4.profiles, v4.state, input);
  assert.equal(isolated.kind, "rejected", JSON.stringify(isolated));
  assert.deepEqual(isolated.events ?? [], []);
  assert.deepEqual(v4.state, beforeV4);
});

test("one bespoke NPC definition can back multiple independent runtime entities", () => {
  let scenario = initialize();
  const definitionId = "npc-mechanics:yard-warden:1";
  const abilityId = "ability:npc-mechanics:yard-warden:spear";
  const firstId = "npc:npc-mechanics-v5:warden:a";
  const secondId = "npc:npc-mechanics-v5:warden:b";
  const first = bespokeEntity({
    entityId: firstId,
    name: "甲号院卫",
    definitionId,
    abilityId,
    position: { x: "360", y: "180", elevation: "0" },
    initialState: {
      hitPointsCurrent: "18",
      temporaryHitPoints: "0",
      resourcesCurrent: { "resource:brace": "1" },
    },
  });
  const second = {
    entityId: secondId,
    name: "乙号院卫",
    placement: { position: { x: "480", y: "180", elevation: "0" } },
    mechanics: { kind: "templateRef", definitionRef: definitionId },
    initialState: {
      hitPointsCurrent: "7",
      temporaryHitPoints: "0",
      resourcesCurrent: { "resource:brace": "0" },
    },
  };
  const opened = step(
    scenario.profiles,
    scenario.state,
    encounterInput(
      "root:npc-mechanics-v5:shared",
      "encounter:npc-mechanics-v5:shared",
      [first, second],
      [firstId, secondId],
    ),
  );
  assert.equal(opened.kind, "awaitingRandomness", JSON.stringify(opened));
  assert.equal(opened.events.filter(({ eventType }) => eventType === "DefinitionRegistered").length, 2);
  assert.equal(opened.events.filter(({ eventType }) => eventType === "EntityMaterialized").length, 2);
  scenario = appendAndReplay(scenario, opened);

  const firstRuntime = scenario.state.combatRuntime.entities[firstId];
  const secondRuntime = scenario.state.combatRuntime.entities[secondId];
  assert.equal(firstRuntime.mechanicalDefinitionRef, definitionId);
  assert.equal(secondRuntime.mechanicalDefinitionRef, definitionId);
  assert.equal(firstRuntime.hitPoints.current, "18");
  assert.equal(secondRuntime.hitPoints.current, "7");
  assert.equal(firstRuntime.resources["resource:brace"].current, "1");
  assert.equal(secondRuntime.resources["resource:brace"].current, "0");
  assert.equal(scenario.state.entities[firstId].hitPoints.current, 18);
  assert.equal(scenario.state.entities[secondId].hitPoints.current, 7);

  const playerProjection = project(scenario.profiles, scenario.state, {
    kind: "player",
    principalId: PRINCIPAL,
    sessionVersion: 1,
    seatId: SEAT,
    characterId: PLAYER,
  });
  assert.equal(playerProjection.kind, "projected", JSON.stringify(playerProjection));
  assert.equal(JSON.stringify(playerProjection).includes(definitionId), false);

  const kpProjection = project(scenario.profiles, scenario.state, {
    kind: "kp",
    capability: "internal:kp-spatial-evidence",
  });
  assert.equal(kpProjection.kind, "projected", JSON.stringify(kpProjection));
  assert.equal(
    kpProjection.npcMechanicalDefinitions[definitionId].definitionRef,
    definitionId,
  );
  const contextPack = buildV3ContextPack({
    rootActionId: "root:npc-mechanics-v5:context",
    preparedActionId: "prepared:npc-mechanics-v5:context",
    attempt: 1,
    input: { text: "又有一名同类院卫加入战斗" },
    projection: {
      ...kpProjection,
      actorProjection: playerProjection,
      moduleRef: scenario.genesis.moduleRef,
      npcViewers: {},
    },
  });
  assert.equal(
    contextPack.required.sceneDynamics.npcMechanics.definitions[0].definitionRef,
    definitionId,
  );
  assert.deepEqual(
    contextPack.required.sceneDynamics.npcMechanics.entities.map((entry) => ({
      entityRef: entry.entityRef,
      mechanicalDefinitionRef: entry.mechanicalDefinitionRef,
    })),
    [
      { entityRef: firstId, mechanicalDefinitionRef: definitionId },
      { entityRef: secondId, mechanicalDefinitionRef: definitionId },
    ],
  );
  assert.ok(contextPack.required.established.dynamicDefinitionRefs.includes(definitionId));
});

test("a KP compound combat proposal is lowered into a frozen NPC template before initiative", () => {
  let scenario = initialize();
  const rootActionId = "root:npc-mechanics-v5:compound";
  const enemyId = "npc:npc-mechanics-v5:compound-sentinel";
  const abilityId = "ability:npc-mechanics-v5:compound-sentinel:spear";
  const factRef = "fact:npc-mechanics-v5:compound-sentinel";
  const definition = templateDefinition("unused:compound-wrapper", abilityId);
  const content = definition.content;
  const proposed = step(scenario.profiles, scenario.state, {
    kind: "resolveCompoundActionPlan",
    actionPlanVersion: "authoritative-kp-action-plan-v1",
    feasibilityKind: "checkRequired",
    rootActionId,
    actorCharacterId: PLAYER,
    goal: "迎战突然现身的陌生哨兵",
    method: "拔出武器并保持戒备",
    risk: {
      warning: "哨兵已经表现出明确敌意。",
      successConsequences: ["进入战斗"],
      failureConsequences: ["进入战斗"],
      retryGate: ["situationAdvanced"],
    },
    dynamicMaterializations: [{
      kind: "enemy",
      factRef,
      causalBasisRefs: [],
      visibilityPolicyRef: "visibility:scene-observers",
      definition: {
        entityId: enemyId,
        entityKind: "npc",
        name: "陌生哨兵",
        position: { x: "480", y: "180", elevation: "0" },
        footprint: structuredClone(content.footprint),
        stats: structuredClone(content.stats),
        proficiencyBonus: content.proficiencyBonus,
        armorClass: content.armorClass,
        hitPoints: { current: "11", maximum: content.hitPointsMaximum, temporary: "0" },
        speedInches: structuredClone(content.speedInches),
        resources: { "resource:brace": { current: "1", maximum: "1" } },
        deathPolicy: content.deathPolicy,
        abilities: structuredClone(content.intrinsicAbilities),
      },
    }],
    npcActions: [],
    scene: {
      question: "双方谁先行动？",
      pressure: "敌意已经公开。",
      opportunities: ["寻找掩护"],
      conclusionCandidate: null,
    },
    mechanicalProposal: {
      operation: "startCombat",
      encounterRef: "encounter:npc-mechanics-v5:compound",
      targetEntityRefs: [enemyId],
    },
  });
  assert.equal(proposed.kind, "awaitingRandomness", JSON.stringify(proposed));
  const mechanicalRef = `npc-mechanics:${factRef}:1`;
  const registered = proposed.events.filter(({ eventType }) => eventType === "DefinitionRegistered");
  assert.equal(
    registered.filter(({ payload }) =>
      payload.definition?.definitionKind === "npcMechanicalTemplate").length,
    1,
  );
  assert.ok(
    proposed.events.find(({ eventType }) => eventType === "EntityMaterialized")
      .payload.entity.mechanicalDefinitionRef === mechanicalRef,
  );
  const firstRandomnessIndex = proposed.events.findIndex(({ eventType }) =>
    eventType === "RandomnessRequested");
  const templateIndex = proposed.events.findIndex(({ payload }) =>
    payload.definition?.definitionId === mechanicalRef);
  assert.ok(templateIndex >= 0 && templateIndex < firstRandomnessIndex);
  scenario = appendAndReplay(scenario, proposed);
  assert.equal(
    scenario.state.combatRuntime.entities[enemyId].mechanicalDefinitionRef,
    mechanicalRef,
  );
});

test("the NPC mechanics fields do not alter the previous V4 KP projection or Context Pack", () => {
  const scenario = initialize({ profiles: ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST });
  const playerProjection = project(scenario.profiles, scenario.state, {
    kind: "player",
    principalId: PRINCIPAL,
    sessionVersion: 1,
    seatId: SEAT,
    characterId: PLAYER,
  });
  const kpProjection = project(scenario.profiles, scenario.state, {
    kind: "kp",
    capability: "internal:kp-spatial-evidence",
  });
  assert.equal(playerProjection.kind, "projected", JSON.stringify(playerProjection));
  assert.equal(kpProjection.kind, "projected", JSON.stringify(kpProjection));
  assert.equal(kpProjection.npcMechanicalDefinitions, undefined);
  assert.equal(kpProjection.spatialEvidence.entities[PLAYER].name, undefined);
  assert.equal(
    kpProjection.spatialEvidence.entities[PLAYER].mechanicalDefinitionRef,
    undefined,
  );
  const contextPack = buildV3ContextPack({
    rootActionId: "root:npc-mechanics-v4:context",
    preparedActionId: "prepared:npc-mechanics-v4:context",
    attempt: 1,
    input: { text: "观察庭院" },
    projection: {
      ...kpProjection,
      actorProjection: playerProjection,
      moduleRef: scenario.genesis.moduleRef,
      npcViewers: {},
    },
  });
  assert.equal(contextPack.required.sceneDynamics.npcMechanics, undefined);
  assert.equal(contextPack.required.mechanics.loadout, undefined);
});

test("a spatial NPC shell is promoted once without relocation and then reused without respec", () => {
  let scenario = initialize({ withSpatialNpc: true });
  const shell = structuredClone(scenario.state.combatRuntime.entities[STATIC_NPC]);
  assert.equal(shell.stats, undefined);
  assert.equal(shell.mechanicalDefinitionRef, undefined);

  const promoted = step(
    scenario.profiles,
    scenario.state,
    encounterInput(
      "root:npc-mechanics-v5:promote",
      "encounter:npc-mechanics-v5:promote",
      [bespokeEntity({
        entityId: STATIC_NPC,
        name: "院墙守卫",
        definitionId: "npc-mechanics:static-warden:1",
        abilityId: "ability:npc-mechanics:static-warden:spear",
        position: { y: "180", elevation: "0", x: "720" },
      })],
      [STATIC_NPC],
    ),
  );
  assert.equal(promoted.kind, "awaitingRandomness", JSON.stringify(promoted));
  scenario = appendAndReplay(scenario, promoted);
  const runtime = scenario.state.combatRuntime.entities[STATIC_NPC];
  assert.deepEqual(runtime.position, shell.position);
  assert.deepEqual(runtime.footprint, shell.footprint);
  assert.equal(runtime.visibilityPolicyId, shell.visibilityPolicyId);
  assert.equal(runtime.mechanicalDefinitionRef, "npc-mechanics:static-warden:1");

  const respec = step(
    scenario.profiles,
    scenario.state,
    encounterInput(
      "root:npc-mechanics-v5:respec",
      "encounter:npc-mechanics-v5:respec",
      [bespokeEntity({
        entityId: STATIC_NPC,
        name: "院墙守卫",
        definitionId: "npc-mechanics:static-warden:2",
        abilityId: "ability:npc-mechanics:static-warden:axe",
        position: null,
      })],
      [STATIC_NPC],
    ),
  );
  assert.equal(respec.kind, "rejected", JSON.stringify(respec));
  assert.deepEqual(respec.events ?? [], []);

  const reused = step(
    scenario.profiles,
    scenario.state,
    encounterInput(
      "root:npc-mechanics-v5:reuse",
      "encounter:npc-mechanics-v5:reuse",
      [],
      [STATIC_NPC],
    ),
  );
  assert.equal(reused.kind, "awaitingRandomness", JSON.stringify(reused));
  assert.equal(reused.events.some(({ eventType }) => eventType === "EntityMaterialized"), false);
  assert.equal(
    scenario.state.combatRuntime.entities[STATIC_NPC].mechanicalDefinitionRef,
    "npc-mechanics:static-warden:1",
  );
});

test("promotion preserves established NPC hit points and unrelated noncombat resources", () => {
  let scenario = initialize({
    withSpatialNpc: true,
    npcOverrides: {
      hitPoints: { current: 5, maximum: 18 },
      resources: { "resource:brace": 0, "resource:rumor": 2 },
      resourceMaximums: { "resource:brace": 1, "resource:rumor": 3 },
    },
  });
  const promoted = step(
    scenario.profiles,
    scenario.state,
    encounterInput(
      "root:npc-mechanics-v5:preserve-runtime",
      "encounter:npc-mechanics-v5:preserve-runtime",
      [bespokeEntity({
        entityId: STATIC_NPC,
        name: "院墙守卫",
        definitionId: "npc-mechanics:preserved-warden:1",
        abilityId: "ability:npc-mechanics:preserved-warden:spear",
        position: null,
      })],
      [STATIC_NPC],
    ),
  );
  assert.equal(promoted.kind, "awaitingRandomness", JSON.stringify(promoted));
  scenario = appendAndReplay(scenario, promoted);
  assert.equal(scenario.state.combatRuntime.entities[STATIC_NPC].hitPoints.current, "5");
  assert.equal(
    scenario.state.combatRuntime.entities[STATIC_NPC].resources["resource:brace"].current,
    "0",
  );
  assert.equal(scenario.state.entities[STATIC_NPC].resources["resource:rumor"], 2);
  assert.equal(scenario.state.entities[STATIC_NPC].resourceMaximums["resource:rumor"], 3);

  const recoveredBrace = step(scenario.profiles, scenario.state, {
    kind: "changeResource",
    proposalId: "root:npc-mechanics-v5:recover-brace",
    characterId: STATIC_NPC,
    resourceId: "resource:brace",
    delta: 1,
    reason: "守卫重新稳住长矛",
  });
  assert.equal(recoveredBrace.kind, "committed", JSON.stringify(recoveredBrace));
  scenario = appendAndReplay(scenario, recoveredBrace);
  assert.equal(scenario.state.entities[STATIC_NPC].resources["resource:brace"], 1);
  assert.equal(
    scenario.state.combatRuntime.entities[STATIC_NPC].resources["resource:brace"].current,
    "1",
  );
  assert.equal(scenario.state.entities[STATIC_NPC].resources["resource:rumor"], 2);
});

test("a first combat definition cannot contradict an NPC's frozen noncombat attributes", () => {
  const scenario = initialize({ withSpatialNpc: true });
  const before = structuredClone(scenario.state);
  const mismatched = step(
    scenario.profiles,
    scenario.state,
    encounterInput(
      "root:npc-mechanics-v5:mismatch",
      "encounter:npc-mechanics-v5:mismatch",
      [bespokeEntity({
        entityId: STATIC_NPC,
        name: "院墙守卫",
        definitionId: "npc-mechanics:mismatched-warden:1",
        abilityId: "ability:npc-mechanics:mismatched-warden:spear",
        position: null,
        overrides: { stats: { wis: "18" } },
      })],
      [STATIC_NPC],
    ),
  );
  assert.equal(mismatched.kind, "rejected", JSON.stringify(mismatched));
  assert.deepEqual(mismatched.events ?? [], []);
  assert.deepEqual(scenario.state, before);

  const malformedEntity = bespokeEntity({
    entityId: STATIC_NPC,
    name: "院墙守卫",
    definitionId: "npc-mechanics:malformed-ac-warden:1",
    abilityId: "ability:npc-mechanics:malformed-ac-warden:spear",
    position: null,
  });
  malformedEntity.mechanics.definition.content.armorClassModel = {
    kind: "model-supplied-arbitrary-ac",
    baseArmorClass: "30",
    shieldBonus: "9",
  };
  const malformedArmorClass = step(
    scenario.profiles,
    scenario.state,
    encounterInput(
      "root:npc-mechanics-v5:malformed-ac",
      "encounter:npc-mechanics-v5:malformed-ac",
      [malformedEntity],
      [STATIC_NPC],
    ),
  );
  assert.equal(malformedArmorClass.kind, "rejected", JSON.stringify(malformedArmorClass));
  assert.deepEqual(malformedArmorClass.events ?? [], []);
  assert.deepEqual(scenario.state, before, "an invalid model definition must fail closed without mutation");

  const unknownItem = bespokeEntity({
    entityId: STATIC_NPC,
    name: "院墙守卫",
    definitionId: "npc-mechanics:unknown-item-warden:1",
    abilityId: "ability:npc-mechanics:unknown-item-warden:claw",
    position: null,
    overrides: {
      initialLoadout: {
        entries: [{
          entryId: "unknown-weapon",
          equippedSlot: "main",
          quantity: 1,
          source: {
            kind: "npcMechanicalItemDefinition",
            ref: "npc-item-definition:missing:1",
          },
        }],
      },
    },
  });
  const unavailableItem = step(
    scenario.profiles,
    scenario.state,
    encounterInput(
      "root:npc-mechanics-v5:unknown-item",
      "encounter:npc-mechanics-v5:unknown-item",
      [unknownItem],
      [STATIC_NPC],
    ),
  );
  assert.equal(unavailableItem.kind, "rejected", JSON.stringify(unavailableItem));
  assert.deepEqual(unavailableItem.events ?? [], []);
  assert.deepEqual(scenario.state, before);
});

test("NPC inventory transfer and semantic gear changes keep equipment mechanics authoritative", () => {
  let scenario = initialize({
    playerBackpack: [
      { itemId: "longsword", quantity: 1 },
      { itemId: "shield", quantity: 2 },
    ],
  });
  const npcId = "npc:npc-mechanics-v5:equipped-warden";
  const encounterId = "encounter:npc-mechanics-v5:equipment";
  const definitionId = "npc-mechanics:equipped-warden:1";
  const intrinsicAbilityId = "ability:npc-mechanics:equipped-warden:spear";
  const opened = step(
    scenario.profiles,
    scenario.state,
    encounterInput(
      "root:npc-mechanics-v5:equipment:start",
      encounterId,
      [bespokeEntity({
        entityId: npcId,
        name: "执盾院卫",
        definitionId,
        abilityId: intrinsicAbilityId,
        position: { x: "480", y: "180", elevation: "0" },
        overrides: { speedInches: { walk: "360", fly: "240" } },
      })],
      [npcId],
    ),
  );
  scenario = settleRoomRandomness(scenario, opened);
  scenario = concludeEncounter(scenario, encounterId, "npc-mechanics-v5:equipment");

  const transfer = (itemId, suffix, throughPrivateForm = false) => {
    const rootActionId = `root:npc-mechanics-v5:equipment:${suffix}`;
    const outcome = step(scenario.profiles, scenario.state, throughPrivateForm
      ? causalMaterializationInput(rootActionId, {
          goal: "把手里的装备交给院卫",
          method: "transferItem",
          proposedFact: JSON.stringify({
            schema: "zhuwei.item-transfer-draft/v1",
            toCharacterRef: npcId,
            itemRef: itemId,
            quantity: 1,
          }),
          basisRefs: [SCENE, npcId, itemId],
          resolution: "direct",
          durationUnit: "second",
          durationValue: 6,
        })
      : {
          kind: "transferItem",
          proposalId: rootActionId,
          fromCharacterId: PLAYER,
          toCharacterId: npcId,
          itemId,
          quantity: 1,
          method: "阿莱莎当面把装备交给院卫",
        });
    assert.equal(outcome.kind, "committed", JSON.stringify(outcome));
    assert.equal(
      outcome.events.filter(({ eventType }) => eventType === "ItemTransferred").length,
      1,
    );
    const transferEvent = outcome.events.find(({ eventType }) =>
      eventType === "ItemTransferred");
    scenario = appendAndReplay(scenario, outcome);
    return transferEvent.payload.targetItemId;
  };

  const shieldItemId = transfer("shield", "transfer-shield", true);
  let npc = scenario.state.entities[npcId];
  let combatNpc = scenario.state.combatRuntime.entities[npcId];
  assert.deepEqual(npc.loadout, {
    armorClass: 14,
    speedFeet: 30,
    equipped: {},
    backpack: [{ itemId: shieldItemId, quantity: 1 }],
    mechanicalItems: {
      [shieldItemId]: { sourceKind: "standardGear", definitionRef: "shield", status: "usable" },
    },
  });
  assert.equal(combatNpc.armorClass, "14", "inventory transfer does not auto-equip a shield");
  assert.deepEqual(combatNpc.abilityRefs, [intrinsicAbilityId]);
  assert.deepEqual(combatNpc.equipmentAbilityRefs, []);

  const actorProjection = project(scenario.profiles, scenario.state, {
    kind: "player",
    principalId: PRINCIPAL,
    sessionVersion: 1,
    seatId: SEAT,
    characterId: PLAYER,
  });
  const npcProjection = project(scenario.profiles, scenario.state, {
    kind: "npc",
    npcId,
    purpose: "kpDecision",
    capability: "internal:npc-limited-knowledge",
  });
  const kpProjection = project(scenario.profiles, scenario.state, {
    kind: "kp",
    capability: "internal:kp-spatial-evidence",
  });
  assert.equal(actorProjection.kind, "projected", JSON.stringify(actorProjection));
  assert.equal(npcProjection.kind, "projected", JSON.stringify(npcProjection));
  assert.equal(kpProjection.kind, "projected", JSON.stringify(kpProjection));
  const inventoryContext = buildV3ContextPack({
    rootActionId: "root:npc-mechanics-v5:inventory-context",
    preparedActionId: "prepared:npc-mechanics-v5:inventory-context",
    attempt: 1,
    input: { text: "把长剑也交给院卫，让他换上盾牌" },
    projection: {
      ...kpProjection,
      actorProjection,
      moduleRef: scenario.genesis.moduleRef,
      npcViewers: { [npcId]: npcProjection },
    },
  });
  assert.deepEqual(inventoryContext.required.mechanics.loadout.backpack, [
    { itemRef: "longsword", quantity: 1 },
    { itemRef: "shield", quantity: 1 },
  ]);
  assert.deepEqual(
    inventoryContext.required.npcViews.find(({ npcRef }) => npcRef === npcId).loadout.backpack,
    [{ itemRef: shieldItemId, quantity: 1 }],
  );

  const longswordItemId = transfer("longsword", "transfer-longsword");
  npc = scenario.state.entities[npcId];
  combatNpc = scenario.state.combatRuntime.entities[npcId];
  assert.deepEqual(npc.loadout.backpack, [
    { itemId: longswordItemId, quantity: 1 },
    { itemId: shieldItemId, quantity: 1 },
  ].sort((left, right) => left.itemId.localeCompare(right.itemId)));
  assert.equal(combatNpc.armorClass, "14", "inventory transfer does not derive equipment AC");
  assert.deepEqual(combatNpc.abilityRefs, [intrinsicAbilityId]);
  assert.deepEqual(combatNpc.equipmentAbilityRefs, []);

  const beforeMissingItem = structuredClone(scenario.state);
  const missingItem = step(scenario.profiles, scenario.state, {
    kind: "changeNpcGear",
    rootActionId: "root:npc-mechanics-v5:equipment:missing-item",
    npcCharacterId: npcId,
    action: "wear",
    slot: "main",
    itemId: "dagger",
  });
  assert.equal(missingItem.kind, "rejected", JSON.stringify(missingItem));
  assert.deepEqual(missingItem.events ?? [], []);
  assert.deepEqual(scenario.state, beforeMissingItem);

  const shieldWorn = step(scenario.profiles, scenario.state, causalMaterializationInput(
    "root:npc-mechanics-v5:equipment:wear-shield",
    {
      goal: "让院卫装备刚收到的盾牌",
      method: "changeNpcGear",
      proposedFact: JSON.stringify({
        schema: "zhuwei.npc-gear-change-draft/v1",
        npcRef: npcId,
        action: "wear",
        slot: "off",
        itemRef: shieldItemId,
      }),
      basisRefs: [SCENE, npcId, shieldItemId],
      resolution: "direct",
      durationUnit: "second",
      durationValue: 6,
    },
  ));
  assert.equal(shieldWorn.kind, "committed", JSON.stringify(shieldWorn));
  assert.equal(
    shieldWorn.events.some(({ eventType }) => eventType === "DefinitionRegistered"),
    false,
    "a shield changes AC without inventing an attack ability",
  );
  scenario = appendAndReplay(scenario, shieldWorn);
  combatNpc = scenario.state.combatRuntime.entities[npcId];
  assert.equal(scenario.state.entities[npcId].loadout.armorClass, 16);
  assert.equal(combatNpc.armorClass, "16");
  assert.deepEqual(combatNpc.speedInches, { walk: "360", fly: "240" });
  assert.deepEqual(combatNpc.abilityRefs, [intrinsicAbilityId]);
  assert.deepEqual(combatNpc.equipmentAbilityRefs, []);

  const weaponWorn = step(scenario.profiles, scenario.state, {
    kind: "changeNpcGear",
    rootActionId: "root:npc-mechanics-v5:equipment:wear-longsword",
    npcCharacterId: npcId,
    action: "wear",
    slot: "main",
    itemId: longswordItemId,
  });
  assert.equal(weaponWorn.kind, "committed", JSON.stringify(weaponWorn));
  const weaponGearEvent = weaponWorn.events.find(({ eventType }) =>
    eventType === "NpcGearChanged");
  assert.ok(weaponGearEvent, JSON.stringify(weaponWorn));
  assert.equal(weaponGearEvent.payload.equipmentAbilityRefs.length, 1);
  const equipmentAbilityRef = weaponGearEvent.payload.equipmentAbilityRefs[0];
  assert.match(equipmentAbilityRef, new RegExp(`^ability:${npcId}:weapon:longsword:`));
  assert.equal(
    weaponWorn.events.filter(({ eventType }) => eventType === "DefinitionRegistered").length,
    1,
  );
  scenario = appendAndReplay(scenario, weaponWorn);
  npc = scenario.state.entities[npcId];
  combatNpc = scenario.state.combatRuntime.entities[npcId];
  assert.deepEqual(npc.loadout, {
    armorClass: 16,
    speedFeet: 30,
    equipped: { main: longswordItemId, off: shieldItemId },
    backpack: [],
    mechanicalItems: {
      [longswordItemId]: {
        sourceKind: "standardGear", definitionRef: "longsword", status: "usable",
      },
      [shieldItemId]: { sourceKind: "standardGear", definitionRef: "shield", status: "usable" },
    },
  });
  assert.equal(combatNpc.armorClass, "16");
  assert.deepEqual(combatNpc.equipmentAbilityRefs, [equipmentAbilityRef]);
  assert.ok(combatNpc.abilityRefs.includes(intrinsicAbilityId), "intrinsic template ability remains");
  assert.ok(combatNpc.abilityRefs.includes(equipmentAbilityRef), "equipped weapon ability is added");
  assert.equal(
    scenario.state.combatRuntime.definitions[equipmentAbilityRef].mechanicalKey,
    "weapon:longsword",
  );
  assert.deepEqual(
    scenario.state.combatRuntime.definitions[equipmentAbilityRef].damage,
    [{ type: "slashing", formula: "1d8+2" }],
    "the weapon ability is derived from the frozen NPC strength, not supplied by KP",
  );

  const shieldStowed = step(scenario.profiles, scenario.state, {
    kind: "changeNpcGear",
    rootActionId: "root:npc-mechanics-v5:equipment:stow-shield",
    npcCharacterId: npcId,
    action: "stow",
    slot: "off",
  });
  assert.equal(shieldStowed.kind, "committed", JSON.stringify(shieldStowed));
  scenario = appendAndReplay(scenario, shieldStowed);
  combatNpc = scenario.state.combatRuntime.entities[npcId];
  assert.equal(combatNpc.armorClass, "14");
  assert.deepEqual(combatNpc.equipmentAbilityRefs, [equipmentAbilityRef]);
  assert.ok(combatNpc.abilityRefs.includes(intrinsicAbilityId));

  const weaponStowed = step(scenario.profiles, scenario.state, {
    kind: "changeNpcGear",
    rootActionId: "root:npc-mechanics-v5:equipment:stow-longsword",
    npcCharacterId: npcId,
    action: "stow",
    slot: "main",
  });
  assert.equal(weaponStowed.kind, "committed", JSON.stringify(weaponStowed));
  scenario = appendAndReplay(scenario, weaponStowed);
  npc = scenario.state.entities[npcId];
  combatNpc = scenario.state.combatRuntime.entities[npcId];
  assert.deepEqual(npc.loadout.equipped, {});
  assert.deepEqual(npc.loadout.backpack, [
    { itemId: longswordItemId, quantity: 1 },
    { itemId: shieldItemId, quantity: 1 },
  ].sort((left, right) => left.itemId.localeCompare(right.itemId)));
  assert.equal(combatNpc.armorClass, "14");
  assert.deepEqual(combatNpc.equipmentAbilityRefs, []);
  assert.deepEqual(combatNpc.abilityRefs, [intrinsicAbilityId]);

  const secondShieldItemId = transfer("shield", "transfer-second-shield");
  assert.notEqual(secondShieldItemId, shieldItemId);
  assert.equal(
    scenario.state.entities[npcId].loadout.mechanicalItems[secondShieldItemId].definitionRef,
    "shield",
  );
});

test("frozen initial equipment is independently instantiated and its lifecycle drives AC and actions", () => {
  let scenario = initialize({ withCausalBasis: true });
  const encounterId = "encounter:npc-mechanics-v5:initial-loadout";
  const definitionId = "npc-mechanics:initial-loadout:1";
  const firstNpc = "npc:npc-mechanics-v5:loadout:a";
  const secondNpc = "npc:npc-mechanics-v5:loadout:b";
  const receiverNpc = "npc:npc-mechanics-v5:loadout:receiver";
  const intrinsicAbilityId = "ability:npc-mechanics-v5:loadout:claw";
  const pikeDefinitionId = "npc-item-definition:npc-mechanics-v5:ember-pike:1";
  const armorDefinitionId = "npc-item-definition:npc-mechanics-v5:guard-plate:1";
  const intrinsicAbility = {
    definitionId: intrinsicAbilityId,
    revision: "1",
    rulesBasis: "srd5.1-2014",
    mechanicalKey: "intrinsic-claw",
    activation: { kind: "attack", actionGrant: "attack" },
    target: { kind: "creature", count: "1", reachInches: "60", requiresSight: true },
    attack: { ability: "str", proficiency: true },
    damage: [{ type: "slashing", formula: "1d4+2" }],
  };
  const itemDefinitions = [{
    definitionId: pikeDefinitionId,
    revision: "1",
    definitionKind: "npcMechanicalItem",
    rulesBasis: "srd5.1-2014",
    causalBasisRefs: [],
    visibilityPolicyRef: "visibility:room-authority-only",
    content: {
      schema: "zhuwei.npc-mechanical-item/v1",
      label: "余烬长枪",
      wear: "weapon",
      twoHanded: false,
      armor: null,
      weapon: {
        attackAbility: "str",
        ammoRef: null,
        damageDice: "1d8",
        damageType: "piercing",
        reachInches: "120",
        rangeNormalInches: null,
        rangeLongInches: null,
        requiresSight: true,
      },
      abilities: [],
    },
  }, {
    definitionId: armorDefinitionId,
    revision: "1",
    definitionKind: "npcMechanicalItem",
    rulesBasis: "srd5.1-2014",
    causalBasisRefs: [],
    visibilityPolicyRef: "visibility:room-authority-only",
    content: {
      schema: "zhuwei.npc-mechanical-item/v1",
      label: "守卫板甲",
      wear: "armor",
      twoHanded: false,
      armor: { kind: "heavy", acBase: "16", acDexCap: "0" },
      weapon: null,
      abilities: [],
    },
  }];
  const overrides = {
    intrinsicAbilities: [intrinsicAbility],
    itemDefinitions,
    initialLoadout: {
      entries: [
        {
          entryId: "primary-weapon",
          equippedSlot: "main",
          quantity: 1,
          source: { kind: "npcMechanicalItemDefinition", ref: pikeDefinitionId },
        },
        {
          entryId: "worn-armor",
          equippedSlot: "armor",
          quantity: 1,
          source: { kind: "npcMechanicalItemDefinition", ref: armorDefinitionId },
        },
        {
          entryId: "shield",
          equippedSlot: "off",
          quantity: 1,
          source: { kind: "standardGear", ref: "shield" },
        },
        {
          entryId: "arrows",
          equippedSlot: "ammo",
          quantity: 20,
          source: { kind: "standardGear", ref: "arrow" },
        },
      ],
    },
  };
  const first = bespokeEntity({
    entityId: firstNpc,
    name: "甲号余烬卫",
    definitionId,
    abilityId: intrinsicAbilityId,
    position: { x: "420", y: "180", elevation: "0" },
    overrides,
  });
  const second = {
    entityId: secondNpc,
    name: "乙号余烬卫",
    placement: { position: { x: "600", y: "180", elevation: "0" } },
    mechanics: { kind: "templateRef", definitionRef: definitionId },
  };
  const receiver = bespokeEntity({
    entityId: receiverNpc,
    name: "瘦弱的接装卫",
    definitionId: "npc-mechanics:initial-loadout:receiver:1",
    abilityId: "ability:npc-mechanics-v5:loadout:receiver-claw",
    position: { x: "720", y: "180", elevation: "0" },
    overrides: { stats: { str: "8" } },
  });
  const proposedFact = JSON.stringify({
    schema: "zhuwei.npc-mechanical-encounter-draft/v1",
    encounterRef: encounterId,
    alliedEntityRefs: [],
    hostileEntityRefs: [firstNpc, secondNpc, receiverNpc],
    entries: [first, second, receiver],
  });
  assert.ok(proposedFact.length <= 8_000, "one complete custom loadout must fit the V5 Form field");
  const opened = step(scenario.profiles, scenario.state, causalMaterializationInput(
    "root:npc-mechanics-v5:initial-loadout:start",
    {
      goal: "三名携带不同初始装备的守卫进入战斗",
      method: "materializeNpcMechanicalEncounter",
      proposedFact,
      basisRefs: [SCENE, YARD_BASIS],
      resolution: "direct",
      durationUnit: "second",
      durationValue: 1,
    },
  ));
  assert.equal(opened.kind, "awaitingRandomness", JSON.stringify(opened));
  const templateIndex = opened.events.findIndex(({ payload }) =>
    payload.definition?.definitionId === definitionId);
  const itemIndex = opened.events.findIndex(({ payload }) =>
    payload.definition?.definitionId === pikeDefinitionId);
  const entityIndex = opened.events.findIndex(({ eventType }) => eventType === "EntityMaterialized");
  assert.ok(itemIndex >= 0 && itemIndex < templateIndex && templateIndex < entityIndex);
  scenario = settleRoomRandomness(scenario, opened);

  const equipmentAbilityByNpc = {};
  for (const npcId of [firstNpc, secondNpc]) {
    const character = scenario.state.entities[npcId];
    const combat = scenario.state.combatRuntime.entities[npcId];
    assert.equal(character.loadout.armorClass, 18);
    assert.equal(combat.armorClass, "18");
    assert.deepEqual(character.loadout.backpack, [{ itemId: "arrow", quantity: 20 }]);
    assert.equal(combat.resources["item:arrow"].current, "20");
    assert.equal(combat.equipmentAbilityRefs.length, 1);
    equipmentAbilityByNpc[npcId] = combat.equipmentAbilityRefs[0];
    assert.match(
      combat.equipmentAbilityRefs[0],
      new RegExp(`^ability:${npcId}:npc-item:${pikeDefinitionId}:modifier:2:proficiency:2$`),
    );
    assert.deepEqual(
      scenario.state.combatRuntime.definitions[combat.equipmentAbilityRefs[0]].damage,
      [{ type: "piercing", formula: "1d8+2" }],
    );
    assert.deepEqual(combat.abilityRefs, [intrinsicAbilityId, combat.equipmentAbilityRefs[0]].sort());
  }
  const firstLoadout = scenario.state.entities[firstNpc].loadout;
  const secondLoadout = scenario.state.entities[secondNpc].loadout;
  const firstPike = firstLoadout.equipped.main;
  const secondPike = secondLoadout.equipped.main;
  const firstArmor = firstLoadout.equipped.armor;
  const firstShield = firstLoadout.equipped.off;
  assert.notEqual(firstPike, secondPike, "shared templates must mint independent runtime items");
  assert.equal(firstLoadout.mechanicalItems[firstPike].definitionRef, pikeDefinitionId);
  assert.equal(secondLoadout.mechanicalItems[secondPike].definitionRef, pikeDefinitionId);
  const actorProjection = project(scenario.profiles, scenario.state, {
    kind: "player",
    principalId: PRINCIPAL,
    sessionVersion: 1,
    seatId: SEAT,
    characterId: PLAYER,
  });
  const npcProjection = project(scenario.profiles, scenario.state, {
    kind: "npc",
    npcId: firstNpc,
    purpose: "kpDecision",
    capability: "internal:npc-limited-knowledge",
  });
  const kpProjection = project(scenario.profiles, scenario.state, {
    kind: "kp",
    capability: "internal:kp-spatial-evidence",
  });
  const context = buildV3ContextPack({
    rootActionId: "root:npc-mechanics-v5:initial-loadout:context",
    preparedActionId: "prepared:npc-mechanics-v5:initial-loadout:context",
    attempt: 1,
    input: { text: "观察两名余烬卫的装备" },
    projection: {
      ...kpProjection,
      actorProjection,
      moduleRef: scenario.genesis.moduleRef,
      npcViewers: { [firstNpc]: npcProjection },
    },
  });
  assert.ok(
    context.required.sceneDynamics.npcMechanics.itemDefinitions
      .some(({ definitionRef }) => definitionRef === pikeDefinitionId),
  );
  assert.equal(
    context.required.npcViews.find(({ npcRef }) => npcRef === firstNpc)
      .loadout.mechanicalItems[firstPike].status,
    "usable",
  );

  scenario = concludeEncounter(scenario, encounterId, "npc-mechanics-v5:initial-loadout");
  const transferredAmmo = step(scenario.profiles, scenario.state, {
    kind: "transferItem",
    proposalId: "root:npc-mechanics-v5:initial-loadout:transfer-ammo",
    fromCharacterId: firstNpc,
    toCharacterId: receiverNpc,
    itemId: "arrow",
    quantity: 20,
    method: "甲号余烬卫把整束箭交给接装卫",
  });
  assert.equal(transferredAmmo.kind, "committed", JSON.stringify(transferredAmmo));
  scenario = appendAndReplay(scenario, transferredAmmo);
  assert.equal(scenario.state.entities[firstNpc].loadout.equipped.ammo, undefined);
  assert.equal(scenario.state.combatRuntime.entities[firstNpc].resources["item:arrow"], undefined);
  const selectedAmmo = step(scenario.profiles, scenario.state, {
    kind: "changeNpcGear",
    rootActionId: "root:npc-mechanics-v5:initial-loadout:select-ammo",
    npcCharacterId: receiverNpc,
    action: "wear",
    slot: "ammo",
    itemId: "arrow",
  });
  assert.equal(selectedAmmo.kind, "committed", JSON.stringify(selectedAmmo));
  scenario = appendAndReplay(scenario, selectedAmmo);
  const usedAmmo = step(scenario.profiles, scenario.state, {
    kind: "useItem",
    proposalId: "root:npc-mechanics-v5:initial-loadout:use-ammo",
    characterId: receiverNpc,
    itemId: "arrow",
    quantity: 20,
    purpose: "在战后靶场消耗整束箭",
  });
  assert.equal(usedAmmo.kind, "committed", JSON.stringify(usedAmmo));
  scenario = appendAndReplay(scenario, usedAmmo);
  assert.equal(scenario.state.entities[receiverNpc].loadout.equipped.ammo, undefined);
  assert.equal(scenario.state.combatRuntime.entities[receiverNpc].resources["item:arrow"], undefined);

  const broken = step(scenario.profiles, scenario.state, {
    kind: "changeNpcItemState",
    rootActionId: "root:npc-mechanics-v5:initial-loadout:break-pike",
    npcCharacterId: firstNpc,
    itemId: firstPike,
    action: "break",
  });
  assert.equal(broken.kind, "committed", JSON.stringify(broken));
  assert.equal(
    broken.events.filter(({ eventType }) => eventType === "NpcMechanicalItemStateChanged").length,
    1,
  );
  scenario = appendAndReplay(scenario, broken);
  let firstCharacter = scenario.state.entities[firstNpc];
  let firstCombat = scenario.state.combatRuntime.entities[firstNpc];
  assert.equal(firstCharacter.loadout.equipped.main, undefined);
  assert.equal(firstCharacter.loadout.mechanicalItems[firstPike].status, "broken");
  assert.deepEqual(firstCombat.equipmentAbilityRefs, []);
  assert.deepEqual(firstCombat.abilityRefs, [intrinsicAbilityId]);

  const repair = step(scenario.profiles, scenario.state, {
    kind: "changeNpcItemState",
    rootActionId: "root:npc-mechanics-v5:initial-loadout:repair-pike",
    npcCharacterId: firstNpc,
    itemId: firstPike,
    action: "repair",
  });
  assert.equal(repair.kind, "committed", JSON.stringify(repair));
  scenario = appendAndReplay(scenario, repair);
  const reworn = step(scenario.profiles, scenario.state, {
    kind: "changeNpcGear",
    rootActionId: "root:npc-mechanics-v5:initial-loadout:rewear-pike",
    npcCharacterId: firstNpc,
    action: "wear",
    slot: "main",
    itemId: firstPike,
  });
  assert.equal(reworn.kind, "committed", JSON.stringify(reworn));
  scenario = appendAndReplay(scenario, reworn);
  assert.deepEqual(
    scenario.state.combatRuntime.entities[firstNpc].equipmentAbilityRefs,
    [equipmentAbilityByNpc[firstNpc]],
  );

  const destroyedArmor = step(scenario.profiles, scenario.state, {
    kind: "changeNpcItemState",
    rootActionId: "root:npc-mechanics-v5:initial-loadout:destroy-armor",
    npcCharacterId: firstNpc,
    itemId: firstArmor,
    action: "destroy",
  });
  assert.equal(destroyedArmor.kind, "committed", JSON.stringify(destroyedArmor));
  scenario = appendAndReplay(scenario, destroyedArmor);
  firstCharacter = scenario.state.entities[firstNpc];
  firstCombat = scenario.state.combatRuntime.entities[firstNpc];
  assert.equal(firstCharacter.loadout.mechanicalItems[firstArmor], undefined);
  assert.equal(firstCharacter.loadout.armorClass, 16, "base AC plus the still-equipped shield remains");
  assert.equal(firstCombat.armorClass, "16");

  const unrelatedLossCause = step(scenario.profiles, scenario.state, causalMaterializationInput(
    "root:npc-mechanics-v5:initial-loadout:unrelated-loss-cause",
    {
      goal: "不能用无关场景事实宣称盾牌已经遗失",
      method: "changeNpcItemState",
      proposedFact: JSON.stringify({
        schema: "zhuwei.npc-item-state-change-draft/v1",
        npcRef: firstNpc,
        itemRef: firstShield,
        action: "lose",
        causeFactRef: YARD_BASIS,
      }),
      basisRefs: [SCENE, firstNpc, firstShield, YARD_BASIS],
      resolution: "direct",
      durationUnit: "second",
      durationValue: 1,
    },
  ));
  assert.equal(unrelatedLossCause.kind, "rejected", JSON.stringify(unrelatedLossCause));
  assert.deepEqual(unrelatedLossCause.events ?? [], []);

  const shieldLossFactId = "fact:npc-mechanics-v5:initial-loadout:shield-lost";
  const shieldLossCause = step(scenario.profiles, scenario.state, {
    kind: "declareCanonicalFact",
    proposalId: "root:npc-mechanics-v5:initial-loadout:shield-loss-cause",
    fact: {
      factId: shieldLossFactId,
      factKind: "npcMechanicalItemStateCause",
      subjectRefs: [firstNpc, firstShield],
      value: {
        schema: "zhuwei.npc-mechanical-item-state-cause/v1",
        npcRef: firstNpc,
        itemRef: firstShield,
        action: "lose",
      },
      source: "observedEvent",
      visibilityPolicy: "public",
      causalParentIds: [],
    },
  });
  assert.equal(shieldLossCause.kind, "committed", JSON.stringify(shieldLossCause));
  scenario = appendAndReplay(scenario, shieldLossCause);
  const lostShield = step(scenario.profiles, scenario.state, causalMaterializationInput(
    "root:npc-mechanics-v5:initial-loadout:lose-shield",
    {
      goal: "记录余烬卫已经失去盾牌",
      method: "changeNpcItemState",
      proposedFact: JSON.stringify({
        schema: "zhuwei.npc-item-state-change-draft/v1",
        npcRef: firstNpc,
        itemRef: firstShield,
        action: "lose",
        causeFactRef: shieldLossFactId,
      }),
      basisRefs: [SCENE, firstNpc, firstShield, shieldLossFactId],
      resolution: "direct",
      durationUnit: "second",
      durationValue: 1,
    },
  ));
  assert.equal(lostShield.kind, "committed", JSON.stringify(lostShield));
  scenario = appendAndReplay(scenario, lostShield);
  assert.equal(scenario.state.entities[firstNpc].loadout.armorClass, 14);
  assert.equal(scenario.state.combatRuntime.entities[firstNpc].armorClass, "14");

  const stowed = step(scenario.profiles, scenario.state, {
    kind: "changeNpcGear",
    rootActionId: "root:npc-mechanics-v5:initial-loadout:stow-pike",
    npcCharacterId: firstNpc,
    action: "stow",
    slot: "main",
  });
  assert.equal(stowed.kind, "committed", JSON.stringify(stowed));
  scenario = appendAndReplay(scenario, stowed);
  const transferred = step(scenario.profiles, scenario.state, {
    kind: "transferItem",
    proposalId: "root:npc-mechanics-v5:initial-loadout:transfer-pike",
    fromCharacterId: firstNpc,
    toCharacterId: receiverNpc,
    itemId: firstPike,
    quantity: 1,
    method: "甲号余烬卫把长枪交给瘦弱的接装卫",
  });
  assert.equal(transferred.kind, "committed", JSON.stringify(transferred));
  scenario = appendAndReplay(scenario, transferred);
  assert.equal(scenario.state.entities[firstNpc].loadout.mechanicalItems?.[firstPike], undefined);
  assert.equal(
    scenario.state.entities[receiverNpc].loadout.mechanicalItems[firstPike].definitionRef,
    pikeDefinitionId,
  );
  const receiverWears = step(scenario.profiles, scenario.state, {
    kind: "changeNpcGear",
    rootActionId: "root:npc-mechanics-v5:initial-loadout:receiver-wears-pike",
    npcCharacterId: receiverNpc,
    action: "wear",
    slot: "main",
    itemId: firstPike,
  });
  assert.equal(receiverWears.kind, "committed", JSON.stringify(receiverWears));
  scenario = appendAndReplay(scenario, receiverWears);
  const receiverEquipmentRef = scenario.state.combatRuntime.entities[receiverNpc]
    .equipmentAbilityRefs[0];
  assert.match(receiverEquipmentRef, /modifier:-1:proficiency:2$/);
  assert.deepEqual(
    scenario.state.combatRuntime.definitions[receiverEquipmentRef].damage,
    [{ type: "piercing", formula: "1d8-1" }],
    "a transferred custom weapon is rebound to the receiving NPC's frozen ability score",
  );
  const receiverStows = step(scenario.profiles, scenario.state, {
    kind: "changeNpcGear",
    rootActionId: "root:npc-mechanics-v5:initial-loadout:receiver-stows-pike",
    npcCharacterId: receiverNpc,
    action: "stow",
    slot: "main",
  });
  assert.equal(receiverStows.kind, "committed", JSON.stringify(receiverStows));
  scenario = appendAndReplay(scenario, receiverStows);
  const unsupportedPlayerTransfer = step(scenario.profiles, scenario.state, {
    kind: "transferItem",
    proposalId: "root:npc-mechanics-v5:initial-loadout:player-takes-pike",
    fromCharacterId: receiverNpc,
    toCharacterId: PLAYER,
    itemId: firstPike,
    quantity: 1,
    method: "玩家尝试接过动态机械武器",
  });
  assert.equal(unsupportedPlayerTransfer.kind, "rejected", JSON.stringify(unsupportedPlayerTransfer));
  assert.deepEqual(unsupportedPlayerTransfer.events ?? [], []);
});

test("first mechanical materialization normalizes established NPC equipment and heavy armor AC", () => {
  const establishedScores = { ...WARDEN_SOCIAL.abilityScores, dex: 6 };
  let scenario = initialize({
    withSpatialNpc: true,
    npcOverrides: {
      abilityScores: establishedScores,
      socialMechanics: { ...WARDEN_SOCIAL, abilityScores: establishedScores },
      loadout: {
        armorClass: 12,
        speedFeet: 99,
        equipped: { armor: "chain", main: "longsword", ammo: "arrow" },
        backpack: [
          { itemId: "arrow", quantity: 2 },
          { itemId: "shield", quantity: 1 },
        ],
      },
    },
  });
  const encounterId = "encounter:npc-mechanics-v5:normalize-established";
  const opened = step(scenario.profiles, scenario.state, encounterInput(
    "root:npc-mechanics-v5:normalize-established:start",
    encounterId,
    [bespokeEntity({
      entityId: STATIC_NPC,
      name: "院墙守卫",
      definitionId: "npc-mechanics:normalize-established:1",
      abilityId: "ability:npc-mechanics:normalize-established:spear",
      position: null,
      overrides: { stats: { dex: "6" }, armorClass: "10" },
    })],
    [STATIC_NPC],
  ));
  scenario = settleRoomRandomness(scenario, opened);

  const npc = scenario.state.entities[STATIC_NPC];
  const combat = scenario.state.combatRuntime.entities[STATIC_NPC];
  assert.equal(npc.loadout.armorClass, 16, "heavy armor ignores a negative Dexterity modifier");
  assert.equal(combat.armorClass, "16");
  assert.equal(npc.loadout.speedFeet, 30, "the frozen template walk speed is the core view");
  assert.equal(npc.loadout.equipped.ammo, "arrow");
  assert.deepEqual(
    npc.loadout.backpack.filter(({ itemId }) => itemId === "arrow"),
    [{ itemId: "arrow", quantity: 2 }],
  );
  const frozenStandardRefs = Object.values(npc.loadout.mechanicalItems)
    .map(({ definitionRef }) => definitionRef)
    .sort();
  assert.deepEqual(frozenStandardRefs, ["chain", "longsword", "shield"]);
  assert.notEqual(npc.loadout.equipped.armor, "chain");
  assert.notEqual(npc.loadout.equipped.main, "longsword");
  for (const [itemId, item] of Object.entries(npc.loadout.mechanicalItems)) {
    const inPack = npc.loadout.backpack.some((entry) => entry.itemId === itemId);
    const equipped = Object.values(npc.loadout.equipped).includes(itemId);
    assert.equal(Number(inPack) + Number(equipped), 1, item.definitionRef);
  }
});

test("custom ranged weapons accept only pinned ammunition and replay the last shot cleanly", () => {
  let scenario = initialize();
  const npcId = "npc:npc-mechanics-v5:ammo-warden";
  const encounterId = "encounter:npc-mechanics-v5:ammo";
  const itemDefinitionId = "npc-item-definition:npc-mechanics-v5:ash-bow:1";
  const rangedItem = {
    definitionId: itemDefinitionId,
    revision: "1",
    definitionKind: "npcMechanicalItem",
    rulesBasis: "srd5.1-2014",
    causalBasisRefs: [],
    visibilityPolicyRef: "visibility:room-authority-only",
    content: {
      schema: "zhuwei.npc-mechanical-item/v1",
      label: "灰木弓",
      wear: "weapon",
      twoHanded: true,
      armor: null,
      weapon: {
        attackAbility: "dex",
        ammoRef: "arrow",
        damageDice: "1d6",
        damageType: "piercing",
        reachInches: null,
        rangeNormalInches: "1200",
        rangeLongInches: "3600",
        requiresSight: true,
      },
      abilities: [],
    },
  };
  const rangedOverrides = {
    intrinsicAbilities: [],
    itemDefinitions: [rangedItem],
    attacksPerAttackAction: "2",
    initialLoadout: {
      entries: [{
        entryId: "bow",
        equippedSlot: "main",
        quantity: 1,
        source: { kind: "npcMechanicalItemDefinition", ref: itemDefinitionId },
      }, {
        entryId: "one-arrow",
        equippedSlot: "ammo",
        quantity: 1,
        source: { kind: "standardGear", ref: "arrow" },
      }],
    },
  };

  const invalidItem = structuredClone(rangedItem);
  invalidItem.definitionId = "npc-item-definition:npc-mechanics-v5:invalid-ammo:1";
  invalidItem.content.weapon.ammoRef = "longsword";
  const invalid = step(scenario.profiles, scenario.state, encounterInput(
    "root:npc-mechanics-v5:invalid-ammo:start",
    "encounter:npc-mechanics-v5:invalid-ammo",
    [bespokeEntity({
      entityId: "npc:npc-mechanics-v5:invalid-ammo",
      name: "错误弹药守卫",
      definitionId: "npc-mechanics:invalid-ammo:1",
      abilityId: "ability:npc-mechanics:invalid-ammo:unused",
      position: { x: "480", y: "180", elevation: "0" },
      overrides: {
        ...rangedOverrides,
        itemDefinitions: [invalidItem],
        initialLoadout: {
          entries: [{
            entryId: "invalid-bow",
            equippedSlot: "main",
            quantity: 1,
            source: {
              kind: "npcMechanicalItemDefinition",
              ref: invalidItem.definitionId,
            },
          }],
        },
      },
    })],
    ["npc:npc-mechanics-v5:invalid-ammo"],
  ));
  assert.equal(invalid.kind, "rejected", JSON.stringify(invalid));
  assert.deepEqual(invalid.events ?? [], []);

  const opened = step(scenario.profiles, scenario.state, encounterInput(
    "root:npc-mechanics-v5:ammo:start",
    encounterId,
    [bespokeEntity({
      entityId: npcId,
      name: "灰木弓卫",
      definitionId: "npc-mechanics:ammo-warden:1",
      abilityId: "ability:npc-mechanics:ammo-warden:unused",
      position: { x: "480", y: "180", elevation: "0" },
      overrides: rangedOverrides,
    })],
    [npcId],
  ));
  scenario = settleRoomRandomness(scenario, opened);
  for (let index = 0; index < 2
    && scenario.state.combatRuntime.encounters[encounterId].activeEntityId !== npcId;
    index += 1) {
    const activeEntityId = scenario.state.combatRuntime.encounters[encounterId].activeEntityId;
    const ended = step(scenario.profiles, scenario.state, {
      kind: "endTurn",
      rootActionId: `root:npc-mechanics-v5:ammo:end-${index}`,
      sourceEntityId: activeEntityId,
      encounterId,
    });
    assert.equal(ended.kind, "committed", JSON.stringify(ended));
    scenario = appendAndReplay(scenario, ended);
  }
  assert.equal(scenario.state.combatRuntime.encounters[encounterId].activeEntityId, npcId);
  const abilityRef = scenario.state.combatRuntime.entities[npcId].equipmentAbilityRefs[0];
  assert.deepEqual(
    scenario.state.combatRuntime.definitions[abilityRef].costs,
    [{ kind: "item", resourceId: "item:arrow", amount: "1" }],
  );
  const fired = step(scenario.profiles, scenario.state, {
    kind: "invokeAbility",
    rootActionId: "root:npc-mechanics-v5:ammo:last-shot",
    sourceEntityId: npcId,
    abilityRef,
    parameters: { targetEntityId: PLAYER },
  });
  assert.equal(fired.kind, "awaitingRandomness", JSON.stringify(fired));
  scenario = settleRoomRandomness(scenario, fired);
  const npc = scenario.state.entities[npcId];
  const combat = scenario.state.combatRuntime.entities[npcId];
  assert.equal(npc.loadout.backpack.some(({ itemId }) => itemId === "arrow"), false);
  assert.equal(npc.loadout.equipped.ammo, undefined);
  assert.equal(combat.resources["item:arrow"], undefined);

  const empty = step(scenario.profiles, scenario.state, {
    kind: "invokeAbility",
    rootActionId: "root:npc-mechanics-v5:ammo:empty",
    sourceEntityId: npcId,
    abilityRef,
    parameters: { targetEntityId: PLAYER },
  });
  assert.equal(empty.kind, "rejected", JSON.stringify(empty));
  assert.equal(empty.rejection.code, "insufficientResource");
  assert.deepEqual(empty.events ?? [], []);
});
