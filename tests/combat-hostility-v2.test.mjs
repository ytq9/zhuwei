import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { project, replay, step } from "../app/_runtime/lib/rules/index.ts";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests.ts";

const PROFILES = ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST;

const ENCOUNTER_ID = "encounter:three-factions";
const LANTERN_ID = "pc:lantern";
const ASH_ID = "npc:ash";
const TIDE_ID = "npc:tide";

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function combatant(id, factionId, ordinal, kind, controllerPrincipalId) {
  return {
    id,
    kind,
    name: id,
    factionId,
    ...(controllerPrincipalId === undefined ? {} : { controllerPrincipalId }),
    entityOrdinal: String(ordinal),
    sceneId: "scene:crossroads",
    position: { x: String((ordinal - 1) * 120), y: "0", elevation: "0" },
    footprint: { width: "60", depth: "60", height: "60" },
    stats: { str: "10", dex: "10", con: "10", int: "10", wis: "10", cha: "10" },
    proficiencyBonus: "2",
    armorClass: "10",
    hitPoints: { current: "10", maximum: "10", temporary: "0" },
    speedInches: { walk: "360" },
    resources: {},
    abilityRefs: kind === "player" ? ["ability:lantern-strike"] : [],
    conditions: {},
    concentration: null,
    lifeState: "alive",
    deathSaves: { successes: 0, failures: 0 },
    movement: { spentMilliInches: "0" },
    deathPolicy: kind === "player" ? "deathSaves" : "deadAtZero",
    turn: {
      action: kind === "player" ? "1" : "0",
      bonusAction: kind === "player" ? "1" : "0",
      reaction: "1",
      attacksRemaining: kind === "player" ? "1" : "0",
      hasteAction: "0",
      bonusActionSpellCast: false,
      leveledActionSpell: false,
      leveledBonusActionSpell: false,
      surprised: false,
    },
  };
}

function v5TacticalGeometry() {
  return {
    schema: "zhuwei.tactical-geometry/v1",
    unit: "inch",
    boundary: {
      kind: "polygon",
      points: [
        { x: "-1200", y: "-1200" },
        { x: "1200", y: "-1200" },
        { x: "1200", y: "1200" },
        { x: "-1200", y: "1200" },
      ],
    },
    spawnPoints: [
      { x: "0", y: "0", elevation: "0" },
      { x: "120", y: "0", elevation: "0" },
      { x: "240", y: "0", elevation: "0" },
    ],
    obstacles: [{
      featureId: "feature:combat-hostility-v2:fixture-marker",
      kind: "barrier",
      label: "敌对关系测试场地标记",
      state: "intact",
      polygon: [
        { x: "1000", y: "1000" },
        { x: "1060", y: "1000" },
        { x: "1060", y: "1060" },
        { x: "1000", y: "1060" },
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

function worldStateHash(state) {
  const domainState = { ...state };
  delete domainState.eventHeadHash;
  delete domainState.lastEventId;
  return hash(domainState);
}

function playerSeed(entity) {
  return {
    id: entity.id,
    kind: "player",
    name: entity.name,
    sceneId: entity.sceneId,
    tenureStatus: "active",
    classId: "fighter",
    raceId: "human",
    level: 1,
    abilityScores: Object.fromEntries(Object.entries(entity.stats).map(
      ([ability, score]) => [ability, Number(score)],
    )),
    proficiencyBonus: Number(entity.proficiencyBonus),
    proficientSkills: [],
    expertiseSkills: [],
    proficientSaves: [],
    cantripIds: [],
    preparedSpellIds: [],
    featureIds: [],
    hitPoints: {
      current: Number(entity.hitPoints.current),
      maximum: Number(entity.hitPoints.maximum),
    },
    loadout: { armorClass: 10, speedFeet: 30, equipped: {}, backpack: [] },
    characterBuild: { classId: "fighter", raceId: "human", cantrips: [], prepared: [] },
  };
}

function makeGenesis() {
  const definitions = {
    "ability:lantern-strike": {
      definitionId: "ability:lantern-strike",
      revision: "1",
      rulesBasis: "srd5.1-2014",
      activation: { kind: "attack", actionGrant: "attack" },
      target: { kind: "creature", count: "1", rangeInches: "600", requiresSight: true },
      attack: { ability: "str", proficiency: true },
      damage: [{ type: "bludgeoning", formula: "1d4" }],
    },
  };
  const combatState = {
    version: "0",
    activeBranchId: "branch:main",
    fictionTimelines: { "branch:main": { branchId: "branch:main", nowMicros: "0" } },
    story: { chapterId: "chapter:crossroads", status: "active", endingCandidates: [] },
    scenes: {
      "scene:crossroads": {
        sceneId: "scene:crossroads",
        geometry: v5TacticalGeometry(),
      },
    },
    entities: {
      [LANTERN_ID]: combatant(LANTERN_ID, "faction:lantern", 1, "player", "principal:lantern"),
      [ASH_ID]: combatant(ASH_ID, "faction:ash", 2, "npc"),
      [TIDE_ID]: combatant(TIDE_ID, "faction:tide", 3, "npc"),
    },
    definitions,
    encounters: {
      [ENCOUNTER_ID]: {
        encounterId: ENCOUNTER_ID,
        sceneId: "scene:crossroads",
        status: "starting",
        participantEntityIds: [LANTERN_ID, ASH_ID, TIDE_ID],
        initiativeGroups: [
          { entryId: "initiative:lantern", combatantEntityIds: [LANTERN_ID] },
          { entryId: "initiative:ash", combatantEntityIds: [ASH_ID] },
          { entryId: "initiative:tide", combatantEntityIds: [TIDE_ID] },
        ],
        hostilities: [
          { fromEntityIds: [LANTERN_ID], toEntityIds: [ASH_ID] },
          { fromEntityIds: [LANTERN_ID], toEntityIds: [TIDE_ID] },
          { fromEntityIds: [ASH_ID], toEntityIds: [LANTERN_ID] },
          { fromEntityIds: [TIDE_ID], toEntityIds: [ASH_ID] },
        ],
        battlefieldFactIds: [],
        surprisedEntityIds: [],
        initiative: {
          entries: [
            { entryId: "initiative:lantern", combatantEntityIds: [LANTERN_ID], total: 20 },
            { entryId: "initiative:ash", combatantEntityIds: [ASH_ID], total: 15 },
            { entryId: "initiative:tide", combatantEntityIds: [TIDE_ID], total: 10 },
          ],
          ordered: true,
        },
        round: 1,
        turnCursor: 0,
        activeEntityId: LANTERN_ID,
        turnOrderEntityIds: [LANTERN_ID, ASH_ID, TIDE_ID],
        roundClosed: false,
      },
    },
    effects: {},
    pendingInputs: {},
  };
  const moduleRef = {
    profileId: "module:combat-hostility-v2",
    profileHash: hash({ module: "combat-hostility-v2" }),
  };
  const initialDefinitionCatalogRef = {
    profileId: "catalog:combat-hostility-v2",
    profileHash: hash({ definitions: Object.keys(definitions) }),
  };
  const initialized = step(PROFILES, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:combat-hostility-v2",
    runtimeEpochId: "epoch:combat-hostility-v2",
    moduleRef,
    initialDefinitionCatalogRef,
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{ id: "scene:crossroads", name: "三岔路口", geometry: v5TacticalGeometry() }],
    principals: [{ id: "principal:lantern", sessionVersion: 1, role: "host" }],
    seats: [{ id: "seat:lantern", principalId: "principal:lantern", status: "active" }],
    characters: [playerSeed(combatState.entities[LANTERN_ID])],
    characterControls: [{ characterId: LANTERN_ID, seatId: "seat:lantern" }],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));

  const initialState = structuredClone(initialized.genesis.initialState);
  initialState.combatRuntime = {
    story: structuredClone(combatState.story),
    scenes: structuredClone(combatState.scenes),
    entities: structuredClone(combatState.entities),
    definitions: structuredClone(combatState.definitions),
    encounters: structuredClone(combatState.encounters),
    effects: structuredClone(combatState.effects),
    pendingInputs: structuredClone(combatState.pendingInputs),
    randomnessResolutions: {},
  };
  const initialStateHash = worldStateHash(initialState);
  initialState.eventHeadHash = initialStateHash;
  const unsigned = {
    ...structuredClone(initialized.genesis),
    initialState,
    initialStateHash,
  };
  delete unsigned.genesisHash;
  return { ...unsigned, genesisHash: hash(unsigned) };
}

function scenario() {
  const genesis = makeGenesis();
  const rebuilt = replay(genesis, []);
  assert.equal(rebuilt?.kind, "replayed", JSON.stringify(rebuilt));
  return { genesis, events: [], state: rebuilt.state };
}

function apply(current, input) {
  const result = step(PROFILES, current.state, input);
  const events = [...current.events, ...(result.events ?? [])];
  const rebuilt = replay(current.genesis, events);
  assert.equal(rebuilt?.kind, "replayed", JSON.stringify(rebuilt));
  return { current: { ...current, events, state: rebuilt.state }, result };
}

function lanternView(current) {
  const result = project(PROFILES, current.state, {
    kind: "player",
    principalId: "principal:lantern",
    sessionVersion: 1,
    seatId: "seat:lantern",
    characterId: LANTERN_ID,
  });
  assert.equal(result?.kind, "projected", JSON.stringify(result));
  return result.readModel ?? result;
}

function openTargetChoice(current, suffix) {
  return apply(current, {
    kind: "invokeAbility",
    rootActionId: `root:b07:${suffix}`,
    sourceEntityId: LANTERN_ID,
    abilityRef: "ability:lantern-strike",
    parameters: {},
  });
}

test("B07 projects every independently hostile faction as a target candidate", () => {
  const opened = openTargetChoice(scenario(), "initial-targets");
  assert.equal(opened.result.kind, "awaitingInput", JSON.stringify(opened.result));
  assert.deepEqual(
    lanternView(opened.current).pendingInputs[0].candidateEntityIds,
    [ASH_ID, TIDE_ID],
  );
});

test("B07 changes hostility by event so candidates and explicit target validation replay consistently", () => {
  let current = openTargetChoice(scenario(), "before-truce").current;
  const pendingBefore = lanternView(current).pendingInputs[0];
  const cancelledBefore = apply(current, {
    kind: "answerPendingInput",
    pendingInputId: pendingBefore.pendingInputId,
    responseId: "response:b07:cancel-before-truce",
    answer: { kind: "cancel" },
  });
  assert.equal(cancelledBefore.result.kind, "committed", JSON.stringify(cancelledBefore.result));
  current = cancelledBefore.current;

  const changed = apply(current, {
    kind: "changeEncounterHostility",
    rootActionId: "root:b07:lantern-truce-with-ash",
    encounterId: ENCOUNTER_ID,
    sourceEntityId: LANTERN_ID,
    targetEntityIds: [TIDE_ID],
    reason: "truce",
  });
  assert.equal(changed.result.kind, "committed", JSON.stringify(changed.result));
  assert.deepEqual(changed.result.events.map(({ eventType }) => eventType), ["HostilityChanged"]);
  assert.deepEqual(changed.result.events[0].payload, {
    encounterId: ENCOUNTER_ID,
    sourceEntityId: LANTERN_ID,
    previousTargetEntityIds: [ASH_ID, TIDE_ID],
    targetEntityIds: [TIDE_ID],
    reason: "truce",
  });
  current = changed.current;

  const rebuilt = replay(current.genesis, current.events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.deepEqual(rebuilt.state, current.state);

  const openedAfter = openTargetChoice(current, "after-truce");
  assert.equal(openedAfter.result.kind, "awaitingInput", JSON.stringify(openedAfter.result));
  assert.deepEqual(
    lanternView(openedAfter.current).pendingInputs[0].candidateEntityIds,
    [TIDE_ID],
  );
  const pendingAfter = lanternView(openedAfter.current).pendingInputs[0];
  const cancelledAfter = apply(openedAfter.current, {
    kind: "answerPendingInput",
    pendingInputId: pendingAfter.pendingInputId,
    responseId: "response:b07:cancel-after-truce",
    answer: { kind: "cancel" },
  });
  assert.equal(cancelledAfter.result.kind, "committed", JSON.stringify(cancelledAfter.result));
  current = cancelledAfter.current;

  const formerTarget = step(PROFILES, current.state, {
    kind: "invokeAbility",
    rootActionId: "root:b07:former-target",
    sourceEntityId: LANTERN_ID,
    abilityRef: "ability:lantern-strike",
    parameters: { targetEntityId: ASH_ID },
  });
  assert.equal(formerTarget.kind, "rejected", JSON.stringify(formerTarget));
  assert.equal(formerTarget.rejection.code, "privateOrUnknownReference");

  const remainingTarget = step(PROFILES, current.state, {
    kind: "invokeAbility",
    rootActionId: "root:b07:remaining-target",
    sourceEntityId: LANTERN_ID,
    abilityRef: "ability:lantern-strike",
    parameters: { targetEntityId: TIDE_ID },
  });
  assert.equal(remainingTarget.kind, "awaitingRandomness", JSON.stringify(remainingTarget));
});
