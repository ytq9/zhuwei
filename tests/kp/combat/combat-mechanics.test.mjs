import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { project, replay, step } from "../../../app/_runtime/lib/rules/index.ts";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../../../app/_runtime/lib/rules/profiles/manifests.ts";
import { hashWorldState } from "../../../app/_runtime/lib/rules/v2/validation.ts";
import { compileAbilityDefinition, registeredAbilityRecord } from "../../../app/_runtime/lib/rules/profiles/ability-compiler.ts";
import { hideCover, perceptionModifier } from "../../../app/_runtime/lib/rules/v2/hiding.ts";

const ROOM_ID = "room:combat-mechanics-v2";
const ENCOUNTER_ID = "encounter:burning-mill";
const ALICE_ID = "character:alice";
const BOB_ID = "character:bob";
const BRUTE_ID = "enemy:ash-brute";
const SENTINEL_ID = "enemy:cinder-sentinel";

const PROFILES = ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key.normalize("NFC"))}:${canonicalJson(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(typeof value === "string" ? value.normalize("NFC") : value);
}

function fixtureHash(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

const MODULE_FIXTURE = Object.freeze({
  moduleId: "module:burning-mill-v1",
  storyAnchor: "灰烬帮占据旧磨坊；玩家可以战斗、谈判、撤退或接受投降。",
  sceneId: "scene:burning-mill-yard",
});

// SPEC 0013 §4.4: the interpreter executes the graph frozen at registration,
// so reaction spells enter the fixture the way production registers them.
function registered(definition) {
  const compiled = compileAbilityDefinition(definition);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  return registeredAbilityRecord(compiled.artifact);
}

const INITIAL_DEFINITIONS = Object.freeze({
  "ability:alice-longbow": {
    definitionId: "ability:alice-longbow",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "attack", actionGrant: "attack" },
    target: {
      kind: "creature",
      count: "1",
      rangeNormalInches: "120",
      rangeLongInches: "1800",
      requiresSight: true,
    },
    attack: { ability: "dex", proficiency: true },
    damage: [{ type: "piercing", formula: "1d8+3" }],
  },
  "ability:alice-resonant-blade": {
    definitionId: "ability:alice-resonant-blade",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "attack", actionGrant: "attack" },
    target: { kind: "creature", count: "1", reachInches: "60", requiresSight: true },
    costs: [{ kind: "classResource", resourceId: "resource:resonant-blade", amount: "1" }],
    attack: { ability: "str", proficiency: true },
    damage: [
      { type: "slashing", formula: "1d8+3" },
      { type: "poison", formula: "1d6" },
      { type: "thunder", formula: "1d4" },
    ],
  },
  "ability:action-surge": {
    definitionId: "ability:action-surge",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "free", timing: "ownTurn" },
    costs: [{ kind: "classResource", resourceId: "resource:action-surge", amount: "1" }],
    grants: [{ kind: "normalAction", count: "1" }],
  },
  "ability:geometry-sphere": {
    definitionId: "ability:geometry-sphere",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "action" },
    target: { kind: "area", shape: { kind: "sphere", radiusInches: "91", propagation: "straight" } },
    damage: [{ type: "force", formula: "1d4" }],
  },
  "ability:geometry-cylinder": {
    definitionId: "ability:geometry-cylinder",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "action" },
    target: { kind: "area", shape: { kind: "cylinder", radiusInches: "91", heightInches: "60", propagation: "straight" } },
    damage: [{ type: "force", formula: "1d4" }],
  },
  "ability:geometry-cube": {
    definitionId: "ability:geometry-cube",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "action" },
    target: { kind: "area", shape: { kind: "cube", edgeInches: "180", propagation: "straight" } },
    damage: [{ type: "force", formula: "1d4" }],
  },
  "ability:geometry-cone": {
    definitionId: "ability:geometry-cone",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "action" },
    target: { kind: "area", shape: { kind: "cone", lengthInches: "180", propagation: "straight" } },
    damage: [{ type: "force", formula: "1d4" }],
  },
  "ability:geometry-line": {
    definitionId: "ability:geometry-line",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "action" },
    target: { kind: "area", shape: { kind: "line", lengthInches: "180", widthInches: "60", propagation: "straight" } },
    damage: [{ type: "force", formula: "1d4" }],
  },
  "ability:geometry-frozen-origin": {
    definitionId: "ability:geometry-frozen-origin",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "action" },
    target: { kind: "area", rangeInches: "600", shape: { kind: "sphere", radiusInches: "30", propagation: "straight" } },
    damage: [{ type: "force", formula: "1d4" }],
  },
  "ability:geometry-range-120": {
    definitionId: "ability:geometry-range-120",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "attack", actionGrant: "attack" },
    target: { kind: "creature", count: "1", rangeInches: "120" },
    attack: { ability: "str", proficiency: true },
    damage: [{ type: "force", formula: "1d4" }],
  },
  "ability:geometry-point-range-120": {
    definitionId: "ability:geometry-point-range-120",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "action" },
    target: {
      kind: "area",
      rangeInches: "120",
      shape: { kind: "sphere", radiusInches: "1", propagation: "straight" },
    },
    damage: [{ type: "force", formula: "1d4" }],
  },
  "ability:geometry-sphere-240": {
    definitionId: "ability:geometry-sphere-240",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "action" },
    target: { kind: "area", shape: { kind: "sphere", radiusInches: "240", propagation: "straight" } },
    damage: [{ type: "force", formula: "1d4" }],
  },
  "ability:geometry-straight-spread": {
    definitionId: "ability:geometry-straight-spread",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "action" },
    target: { kind: "area", shape: { kind: "sphere", radiusInches: "300", propagation: "straight" } },
    damage: [{ type: "force", formula: "1d4" }],
  },
  "ability:geometry-around-corners": {
    definitionId: "ability:geometry-around-corners",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "action" },
    target: { kind: "area", shape: { kind: "sphere", radiusInches: "300", propagation: "aroundCorners", spreadBudgetInches: "300" } },
    damage: [{ type: "force", formula: "1d4" }],
  },
  "ability:restorative-touch": {
    definitionId: "ability:restorative-touch",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "action" },
    target: { kind: "creature", count: "1", reachInches: "60" },
    healing: { formula: "2d4+2" },
  },
  "spell:hex": {
    definitionId: "spell:hex",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "bonusActionSpell", spellLevel: "1" },
    costs: [{ kind: "spellSlot", level: "1", amount: "1" }],
    target: { kind: "creature", count: "1", rangeInches: "1080" },
    effect: { kind: "concentration", durationMicros: "3600000000" },
  },
  "spell:fire-bolt": {
    definitionId: "spell:fire-bolt",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "actionSpell", spellLevel: "0" },
    target: { kind: "creature", count: "1", rangeInches: "1440" },
    attack: { kind: "spellAttack" },
    damage: [{ type: "fire", formula: "1d10" }],
  },
  "spell:magic-missile": {
    definitionId: "spell:magic-missile",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "actionSpell", spellLevel: "1" },
    costs: [{ kind: "spellSlot", level: "1", amount: "1" }],
    target: { kind: "creature", count: "1", rangeInches: "1440" },
    damage: [{ type: "force", formula: "1d4+1" }],
  },
  "spell:shield": registered({
    definitionId: "spell:shield",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "reactionSpell", spellLevel: "1" },
    costs: [{ kind: "spellSlot", level: "1", amount: "1" }],
    effect: { kind: "shield", duration: "untilOwnNextTurnStart", armorClassBonus: "5", magicMissileImmunity: true },
  }),
  "spell:counterspell": registered({
    definitionId: "spell:counterspell",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "reactionSpell", spellLevel: "3" },
    costs: [{ kind: "spellSlot", level: "3", amount: "1" }],
    effect: { kind: "counterspell", rangeInches: "720" },
  }),
  "spell:shatter": {
    definitionId: "spell:shatter",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "actionSpell", spellLevel: "2" },
    costs: [{ kind: "spellSlot", level: "2", amount: "1" }],
    target: {
      kind: "area",
      rangeInches: "720",
      shape: { kind: "sphere", radiusInches: "120", propagation: "straight" },
    },
    save: { ability: "con", halfOnSuccess: true },
    damage: [{ type: "thunder", formula: "3d8", sharedAcrossTargets: true }],
  },
  "hazard:falling-beam": {
    definitionId: "hazard:falling-beam",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "nonCombatHazard" },
    target: { kind: "creature", count: "1" },
    save: { ability: "dex", dc: "12", halfOnSuccess: true },
    damage: [{ type: "bludgeoning", formula: "2d6" }],
  },
  "ability:alice-unknown-activation": {
    definitionId: "ability:alice-unknown-activation",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "unregisteredActivation" },
    effect: { kind: "narrativeOnly" },
  },
});

const INITIAL_STATE = Object.freeze({
  version: "0",
  activeBranchId: "branch:main",
  fictionTimelines: {
    "branch:main": { branchId: "branch:main", nowMicros: "0" },
  },
  story: { chapterId: "chapter:burning-mill", status: "active", endingCandidates: [] },
  scenes: {
    "scene:burning-mill-yard": {
      sceneId: "scene:burning-mill-yard",
      geometry: {
        unit: "inch",
        obstacles: [
          {
            obstacleId: "terrain:half-cover-wall",
            polygon: [
              { x: "89", y: "-120" },
              { x: "91", y: "-120" },
              { x: "91", y: "120" },
              { x: "89", y: "120" },
            ],
            elevation: "0",
            height: "36",
            opaque: true,
            // This synthetic plane exists to exercise cover rays. It crosses
            // the initial creature occupancies and is not a movement wall.
            impassable: false,
          },
          {
            obstacleId: "terrain:open-high-wall",
            polygon: [
              { x: "-120", y: "299" },
              { x: "120", y: "299" },
              { x: "120", y: "301" },
              { x: "-120", y: "301" },
            ],
            elevation: "-1",
            height: "182",
            opaque: true,
            impassable: true,
          },
          {
            obstacleId: "terrain:around-corner-high-wall",
            polygon: [
              { x: "59", y: "-91" },
              { x: "121", y: "-91" },
              { x: "121", y: "-89" },
              { x: "59", y: "-89" },
            ],
            elevation: "-1",
            height: "182",
            opaque: true,
            impassable: true,
          },
          ...[
            ["left", "149", "-151", "151", "-89"],
            ["right", "209", "-151", "211", "-89"],
            ["bottom", "149", "-151", "211", "-149"],
            ["top", "149", "-91", "211", "-89"],
          ].map(([side, lowX, lowY, highX, highY]) => ({
            obstacleId: `terrain:closed-high-wall:${side}`,
            polygon: [
              { x: lowX, y: lowY },
              { x: highX, y: lowY },
              { x: highX, y: highY },
              { x: lowX, y: highY },
            ],
            elevation: "-1",
            height: "182",
            opaque: true,
            impassable: true,
          })),
        ],
        clearanceZones: [
          {
            zoneId: "terrain:small-clearance-passage",
            polygon: [
              { x: "-30", y: "180" },
              { x: "30", y: "180" },
              { x: "30", y: "360" },
              { x: "-30", y: "360" },
            ],
            elevation: "-1",
            height: "62",
            capacitySize: "small",
          },
          {
            zoneId: "terrain:tiny-clearance-passage",
            polygon: [
              { x: "-240", y: "-30" },
              { x: "-180", y: "-30" },
              { x: "-180", y: "30" },
              { x: "-240", y: "30" },
            ],
            elevation: "-1",
            height: "62",
            capacitySize: "tiny",
          },
        ],
      },
    },
  },
  entities: {
    [ALICE_ID]: {
      id: ALICE_ID,
      kind: "player",
      name: "爱丽丝",
      controllerPrincipalId: "principal:alice",
      entityOrdinal: "1",
      sceneId: "scene:burning-mill-yard",
      position: { x: "0", y: "0", elevation: "0" },
      footprint: { width: "60", depth: "60", height: "60" },
      sizeCategory: "medium",
      stats: { str: "16", dex: "14", con: "14", int: "10", wis: "10", cha: "10" },
      proficiencyBonus: "2",
      proficientSkills: ["athletics"],
      armorClass: "15",
      hitPoints: { current: "7", maximum: "24", temporary: "0" },
      speedInches: { walk: "360" },
      conditions: { poisoned: true },
      attacksPerAttackAction: "2",
      resources: {
        "resource:action-surge": { current: "1", maximum: "1" },
        "resource:resonant-blade": { current: "1", maximum: "1" },
      },
      abilityRefs: [
        "ability:alice-longbow",
        "ability:alice-resonant-blade",
        "ability:action-surge",
        "ability:geometry-sphere",
        "ability:geometry-cylinder",
        "ability:geometry-cube",
        "ability:geometry-cone",
        "ability:geometry-line",
        "ability:geometry-frozen-origin",
        "ability:geometry-range-120",
        "ability:geometry-point-range-120",
        "ability:geometry-sphere-240",
        "ability:geometry-straight-spread",
        "ability:geometry-around-corners",
        "ability:restorative-touch",
        "ability:alice-unknown-activation",
      ],
      deathPolicy: "deathSaves",
    },
    [BOB_ID]: {
      id: BOB_ID,
      kind: "player",
      name: "鲍勃",
      controllerPrincipalId: "principal:bob",
      entityOrdinal: "2",
      sceneId: "scene:burning-mill-yard",
      position: { x: "60", y: "60", elevation: "0" },
      footprint: { width: "60", depth: "60", height: "60" },
      stats: { str: "8", dex: "14", con: "12", int: "16", wis: "12", cha: "10" },
      proficiencyBonus: "2",
      armorClass: "13",
      hitPoints: { current: "18", maximum: "18", temporary: "0" },
      speedInches: { walk: "360" },
      spellcasting: { ability: "int", spellAttackBonus: "5", spellSaveDc: "13" },
      resources: {
        "spellSlot:1": { current: "2", maximum: "2" },
        "spellSlot:2": { current: "1", maximum: "1" },
        "spellSlot:3": { current: "2", maximum: "2" },
      },
      abilityRefs: [
        "spell:hex",
        "spell:fire-bolt",
        "spell:magic-missile",
        "spell:shatter",
        "spell:shield",
        "spell:counterspell",
      ],
      deathPolicy: "deathSaves",
    },
    "environment:burning-mill": {
      id: "environment:burning-mill",
      kind: "environment",
      entityOrdinal: "3",
      sceneId: "scene:burning-mill-yard",
      abilityRefs: ["hazard:falling-beam"],
    },
  },
  definitions: INITIAL_DEFINITIONS,
  encounters: {},
  effects: {},
  pendingInputs: {},
});

const MODULE_REF = Object.freeze({
  profileId: MODULE_FIXTURE.moduleId,
  profileHash: fixtureHash(MODULE_FIXTURE),
});
const CATALOG_REF = Object.freeze({
  profileId: "catalog:burning-mill-v1",
  profileHash: fixtureHash(INITIAL_DEFINITIONS),
});

function v5TacticalGeometry() {
  return {
    schema: "zhuwei.tactical-geometry/v1",
    unit: "inch",
    boundary: {
      kind: "polygon",
      points: [
        { x: "-12000", y: "-12000" },
        { x: "12000", y: "-12000" },
        { x: "12000", y: "12000" },
        { x: "-12000", y: "12000" },
      ],
    },
    spawnPoints: [
      { x: "0", y: "0", elevation: "0" },
      { x: "60", y: "60", elevation: "0" },
    ],
    obstacles: [{
      featureId: "feature:combat-mechanics-v2:fixture-boundary-marker",
      kind: "barrier",
      label: "测试场地边界标记",
      state: "intact",
      polygon: [
        { x: "10000", y: "10000" },
        { x: "10060", y: "10000" },
        { x: "10060", y: "10060" },
        { x: "10000", y: "10060" },
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

function v5CharacterSeed({ id, name, classId, abilityScores, hitPoints, pools = {}, proficientSkills = [] }) {
  return {
    id,
    kind: "player",
    name,
    sceneId: "scene:burning-mill-yard",
    tenureStatus: "active",
    classId,
    raceId: "human",
    level: 3,
    abilityScores,
    proficiencyBonus: 2,
    proficientSkills,
    expertiseSkills: [],
    proficientSaves: [],
    cantripIds: [],
    preparedSpellIds: [],
    featureIds: [],
    hitPoints,
    // A player's combat pool must be backed by exactly one matching key on the
    // record, with the same current and maximum, or spendCosts refuses it.
    resources: Object.fromEntries(Object.entries(pools).map(
      ([key, pool]) => [key, Number(pool.current)],
    )),
    resourceMaximums: Object.fromEntries(Object.entries(pools).map(
      ([key, pool]) => [key, Number(pool.maximum)],
    )),
    loadout: { armorClass: 10, speedFeet: 30, equipped: {}, backpack: [] },
    characterBuild: { classId, raceId: "human", cantrips: [], prepared: [] },
  };
}

function v5WorldStateHash(state) {
  return hashWorldState(state);
}

function v5CombatGeometry(geometry) {
  const canonical = v5TacticalGeometry();
  const converted = (geometry.obstacles ?? []).map((obstacle, index) => {
    if (obstacle.featureId !== undefined) return structuredClone(obstacle);
    const featureId = String(obstacle.obstacleId ?? `feature:legacy-combat-fixture:${index}`);
    return {
      featureId,
      kind: "barrier",
      label: featureId,
      state: "intact",
      polygon: structuredClone(obstacle.polygon),
      elevation: String(obstacle.elevation),
      height: String(obstacle.height),
      opaque: obstacle.opaque === true,
      impassable: obstacle.impassable === true,
      cover: obstacle.opaque === true ? "full" : "none",
      propagation: obstacle.opaque === true ? "blocks" : "passes",
      terrain: "normal",
      visibilityPolicyId: "visibility:scene-observers",
    };
  });
  const marker = canonical.obstacles[0];
  if (!converted.some(({ featureId }) => featureId === marker.featureId)) converted.push(marker);
  return {
    ...canonical,
    obstacles: converted.sort((left, right) => left.featureId.localeCompare(right.featureId)),
  };
}

function v5Genesis(combatState, suffix, { preserveClearanceZones = false } = {}) {
  const runtimeEpochId = `epoch:combat-mechanics-v2:${suffix}`;
  const aliceCombat = combatState.entities[ALICE_ID];
  const bobCombat = combatState.entities[BOB_ID];
  const initialized = step(PROFILES, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: ROOM_ID,
    runtimeEpochId,
    moduleRef: MODULE_REF,
    initialDefinitionCatalogRef: CATALOG_REF,
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{ id: "scene:burning-mill-yard", name: "旧磨坊庭院", geometry: v5TacticalGeometry() }],
    principals: [
      { id: "principal:alice", sessionVersion: 1, role: "host" },
      { id: "principal:bob", sessionVersion: 1, role: "player" },
    ],
    seats: [
      { id: "seat:alice", principalId: "principal:alice", status: "active" },
      { id: "seat:bob", principalId: "principal:bob", status: "active" },
    ],
    characters: [
      v5CharacterSeed({
        id: ALICE_ID,
        name: "爱丽丝",
        classId: "fighter",
        // A 2014 shove is an Athletics contest; proficiency comes from the
        // character record (SPEC 0012 §3.2), not from the special melee attack.
        proficientSkills: ["athletics"],
        abilityScores: Object.fromEntries(Object.entries(aliceCombat.stats).map(
          ([ability, score]) => [ability, Number(score)],
        )),
        hitPoints: {
          current: Number(aliceCombat.hitPoints.current),
          maximum: Number(aliceCombat.hitPoints.maximum),
        },
        pools: aliceCombat.resources,
      }),
      v5CharacterSeed({
        id: BOB_ID,
        name: "鲍勃",
        classId: "wizard",
        abilityScores: Object.fromEntries(Object.entries(bobCombat.stats).map(
          ([ability, score]) => [ability, Number(score)],
        )),
        hitPoints: {
          current: Number(bobCombat.hitPoints.current),
          maximum: Number(bobCombat.hitPoints.maximum),
        },
        pools: bobCombat.resources,
      }),
    ],
    characterControls: [
      { characterId: ALICE_ID, seatId: "seat:alice" },
      { characterId: BOB_ID, seatId: "seat:bob" },
    ],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));

  const initialState = structuredClone(initialized.genesis.initialState);
  assert.equal(
    initialState.campaignRuntime.itemSystem.schema,
    "zhuwei.item-system-state/v1",
    "every V5 combat fixture carries the unified item authority",
  );
  const combatScenes = Object.fromEntries(Object.entries(combatState.scenes).map(
    ([sceneId, scene]) => [sceneId, {
      ...structuredClone(scene),
      geometry: preserveClearanceZones
        ? structuredClone(scene.geometry)
        : v5CombatGeometry(scene.geometry),
    }],
  ));
  initialState.combatRuntime = {
    story: structuredClone(combatState.story),
    scenes: combatScenes,
    entities: structuredClone(combatState.entities),
    definitions: structuredClone(combatState.definitions),
    encounters: structuredClone(combatState.encounters),
    effects: structuredClone(combatState.effects),
    pendingInputs: structuredClone(combatState.pendingInputs),
    randomnessResolutions: structuredClone(combatState.randomnessResolutions ?? {}),
  };
  const initialStateHash = v5WorldStateHash(initialState);
  const unsigned = {
    kind: "roomGenesis",
    roomId: ROOM_ID,
    runtimeEpochId,
    profiles: PROFILES,
    moduleRef: MODULE_REF,
    initialDefinitionCatalogRef: CATALOG_REF,
    initialState,
    initialStateHash,
  };
  return Object.freeze({ ...unsigned, genesisHash: fixtureHash(unsigned) });
}

const ROOM_GENESIS = v5Genesis(INITIAL_STATE, "1");

function geometryGenesis(initialState, suffix, options) {
  return v5Genesis(initialState, suffix, options);
}

function coverSampleBlockers(count, { opaque = true } = {}) {
  const samples = [];
  for (const x of [1850, 1950, 2050, 2150]) {
    for (const y of [-150, -50, 50, 150]) {
      for (const elevation of [50, 150, 250, 350]) {
        const parameter = 0.999;
        samples.push({
          x: parameter * x,
          y: parameter * y,
          elevation: 400 + parameter * (elevation - 400),
        });
      }
    }
  }
  return samples.slice(0, count).map((point, index) => {
    if (!opaque) {
      return {
        id: `entity:soft-cover-sample:${index}`,
        kind: "environment",
        entityOrdinal: String(1000 + index),
        sceneId: "scene:burning-mill-yard",
        lifeState: "conscious",
        position: {
          x: String(Math.round(point.x)),
          y: String(Math.round(point.y)),
          elevation: String(Math.round(point.elevation) - 1),
        },
        footprint: { width: "2", depth: "2", height: "2" },
      };
    }
    const lowX = Math.floor(point.x) - 1;
    const highX = Math.ceil(point.x) + 1;
    const lowY = Math.floor(point.y) - 1;
    const highY = Math.ceil(point.y) + 1;
    const lowElevation = Math.floor(point.elevation) - 1;
    return {
      obstacleId: `terrain:cover-sample-wall:${index}`,
      polygon: [
        { x: String(lowX), y: String(lowY) },
        { x: String(highX), y: String(lowY) },
        { x: String(highX), y: String(highY) },
        { x: String(lowX), y: String(highY) },
      ],
      elevation: String(lowElevation),
      height: String(Math.ceil(point.elevation) + 1 - lowElevation),
      opaque: true,
      impassable: true,
    };
  });
}

const ALICE_VIEWER = Object.freeze({
  kind: "player",
  principalId: "principal:alice",
  sessionVersion: 1,
  seatId: "seat:alice",
  characterId: ALICE_ID,
});
const BOB_VIEWER = Object.freeze({
  kind: "player",
  principalId: "principal:bob",
  sessionVersion: 1,
  seatId: "seat:bob",
  characterId: BOB_ID,
});
const SENTINEL_VIEWER = Object.freeze({
  kind: "npc",
  npcId: SENTINEL_ID,
  purpose: "kpDecision",
  capability: "internal:npc-limited-knowledge",
});

const START_DYNAMIC_ENCOUNTER = Object.freeze({
  kind: "startEncounter",
  rootActionId: "root:start-burning-mill-encounter",
  proposalAttemptId: "proposal:start-burning-mill-encounter:1",
  encounterId: ENCOUNTER_ID,
  sceneId: "scene:burning-mill-yard",
  participantEntityIds: [ALICE_ID, BOB_ID],
  dynamicEntities: [
    {
      entityId: BRUTE_ID,
      name: "灰烬暴徒",
      placement: { position: { x: "60", y: "0", elevation: "0" } },
      mechanics: {
        kind: "bespokeDefinition",
        definition: {
          definitionId: "npc-template:ash-brute",
          revision: "1",
          definitionKind: "npcMechanicalTemplate",
          rulesBasis: "srd5.1-2014",
          causalBasisRefs: ["module:burning-mill-v1"],
          visibilityPolicyRef: "visibility:scene-observers",
          content: {
            schema: "zhuwei.npc-mechanical-template/v1",
            label: "灰烬暴徒",
            footprint: { width: "60", depth: "60", height: "60" },
            stats: { str: "18", dex: "12", con: "16", int: "8", wis: "10", cha: "8" },
            proficiencyBonus: "2",
            armorClass: "14",
            armorClassModel: {
              kind: "higherOfBaseAndEquipment",
              baseArmorClass: "14",
              shieldBonus: "0",
            },
            hitPointsMaximum: "30",
            speedInches: { walk: "360" },
            resourceMaximums: {},
            deathPolicy: "deadAtZero",
            damageDefenses: { resistant: ["slashing"], immune: ["poison"], vulnerable: ["thunder"] },
            intrinsicAbilities: [
              {
                definitionId: "ability:ash-brute-maul",
                revision: "1",
                rulesBasis: "srd5.1-2014",
                activation: { kind: "attack", actionGrant: "attack" },
                target: { kind: "creature", count: "1", reachInches: "60" },
                attack: { ability: "str", proficiency: true },
                damage: [{ type: "bludgeoning", formula: "2d6+4" }],
              },
              {
                definitionId: "ability:ash-brute-cinder-burst",
                revision: "1",
                rulesBasis: "srd5.1-2014",
                activation: { kind: "action" },
                target: { kind: "area", shape: { kind: "sphere", radiusInches: "120", propagation: "straight" } },
                save: { ability: "dex", dc: "13", halfOnSuccess: true },
                damage: [{ type: "fire", formula: "2d6", sharedAcrossTargets: true }],
              },
            ],
            itemDefinitions: [],
            itemDefinitionRefs: [],
            initialLoadout: { entries: [] },
          },
        },
      },
    },
    {
      entityId: SENTINEL_ID,
      name: "余烬哨兵",
      placement: { position: { x: "180", y: "0", elevation: "0" } },
      mechanics: {
        kind: "bespokeDefinition",
        definition: {
          definitionId: "npc-template:cinder-sentinel",
          revision: "1",
          definitionKind: "npcMechanicalTemplate",
          rulesBasis: "srd5.1-2014",
          causalBasisRefs: ["module:burning-mill-v1"],
          visibilityPolicyRef: "visibility:scene-observers",
          content: {
            schema: "zhuwei.npc-mechanical-template/v1",
            label: "余烬哨兵",
            footprint: { width: "60", depth: "60", height: "60" },
            stats: { str: "12", dex: "12", con: "14", int: "10", wis: "12", cha: "8" },
            proficiencyBonus: "2",
            armorClass: "15",
            armorClassModel: {
              kind: "higherOfBaseAndEquipment",
              baseArmorClass: "15",
              shieldBonus: "0",
            },
            hitPointsMaximum: "22",
            speedInches: { walk: "360" },
            resourceMaximums: {},
            deathPolicy: "deadAtZero",
            intrinsicAbilities: [{
              definitionId: "ability:cinder-sentinel-bolt",
              revision: "1",
              rulesBasis: "srd5.1-2014",
              activation: { kind: "attack", actionGrant: "attack" },
              target: { kind: "creature", count: "1", rangeNormalInches: "720" },
              attack: { ability: "dex", proficiency: true },
              damage: [{ type: "piercing", formula: "1d8+1" }],
            }],
            itemDefinitions: [],
            itemDefinitionRefs: [],
            initialLoadout: { entries: [] },
          },
        },
      },
    },
  ],
  initiativeGroups: [
    { entryId: "initiative:alice", combatantEntityIds: [ALICE_ID] },
    { entryId: "initiative:bob", combatantEntityIds: [BOB_ID] },
    { entryId: "initiative:ash-enemies", combatantEntityIds: [BRUTE_ID, SENTINEL_ID] },
  ],
  hostilities: [
    { fromEntityIds: [ALICE_ID, BOB_ID], toEntityIds: [BRUTE_ID, SENTINEL_ID] },
    { fromEntityIds: [BRUTE_ID, SENTINEL_ID], toEntityIds: [ALICE_ID, BOB_ID] },
  ],
  battlefieldFactIds: ["terrain:half-cover-wall"],
});

function hasForbiddenInputKey(value, forbidden) {
  if (Array.isArray(value)) return value.some((entry) => hasForbiddenInputKey(entry, forbidden));
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, nested]) => forbidden.has(key) || hasForbiddenInputKey(nested, forbidden),
  );
}

function assertOrdinaryRulesInput(input) {
  const forbidden = new Set([
    "actorId",
    "principal",
    "principalId",
    "profiles",
    "profileId",
    "profileHash",
    "events",
    "eventLog",
    "state",
    "statePatch",
    "expectedRevision",
    "faces",
    "dieFaces",
    "randomnessResults",
  ]);
  assert.equal(hasForbiddenInputKey(input, forbidden), false, "ordinary Rules input contains authority-owned data");
}

function eventTypes(events) {
  return events.map((event) => event.eventType);
}

function eventsOfType(events, type) {
  return events.filter((event) => event.eventType === type);
}

function assertIncludesEventTypes(events, expected) {
  const actual = eventTypes(events);
  for (const type of expected) {
    assert.ok(actual.includes(type), `expected ${type}; received ${actual.join(", ")}`);
  }
}

function replayed(events, genesis = ROOM_GENESIS) {
  const result = replay(genesis, events);
  assert.equal(result?.kind, "replayed", JSON.stringify(result));
  assert.ok(result.state, "replay must produce the next state");
  return result;
}

function startScenario(genesis = ROOM_GENESIS) {
  const result = replayed([], genesis);
  return Object.freeze({ genesis, eventLog: Object.freeze([]), state: result.state, head: result.head });
}

function appendReturnedEvents(scenario, result) {
  const returned = result.events ?? [];
  assert.ok(Array.isArray(returned), "step events must be an array");
  if (returned.length === 0) return scenario;
  for (const event of returned) {
    assert.equal(typeof event, "object");
    assert.deepEqual(event.profiles, PROFILES, "every committed event pins the complete manifest");
  }
  const eventLog = Object.freeze([...scenario.eventLog, ...returned]);
  const rebuilt = replayed(eventLog, scenario.genesis);
  return Object.freeze({ genesis: scenario.genesis, eventLog, state: rebuilt.state, head: rebuilt.head });
}

class DeterministicRoomAuthority {
  constructor(entropyByPurpose = {}) {
    this.entropyByPurpose = new Map(
      Object.entries(entropyByPurpose).map(([key, values]) => [key, [...values]]),
    );
    this.fulfilled = new Map();
    this.observedRequests = [];
    this.newFulfillmentCount = 0;
  }

  takeEntropy(purposeKey) {
    const tape = this.entropyByPurpose.get(purposeKey) ?? [];
    const next = tape.shift();
    this.entropyByPurpose.set(purposeKey, tape);
    return next ?? 10;
  }

  fulfill(result) {
    assert.equal(result.kind, "awaitingRandomness");
    assert.ok(result.resolutionId, "randomness must bind a stable resolution");
    assert.match(
      result.continuationCapability,
      /^continuation:/,
      "only the Room Authority receives the opaque randomness continuation",
    );
    assert.ok(Array.isArray(result.randomnessRequests) && result.randomnessRequests.length > 0);

    const randomnessResults = result.randomnessRequests.map((request) => {
      this.observedRequests.push(structuredClone(request));
      assert.equal(request.resolutionId, result.resolutionId);
      assert.match(request.randomnessId, /^randomness:/);
      assert.match(request.requestHash, /^sha256:[0-9a-f]{64}$/);
      assert.ok(request.purposeKey, "a frozen request has a stable public-audit purpose key");
      assert.ok(Array.isArray(request.dice) && request.dice.length > 0);
      assert.ok(request.frozenParameters, "DC/mode/targets/costs/consequences freeze before any face exists");

      const cached = this.fulfilled.get(request.randomnessId);
      if (cached) return structuredClone(cached);

      const draws = request.dice.map((term) => {
        const count = Number(term.count);
        const sides = Number(term.sides);
        assert.ok(Number.isInteger(count) && count > 0);
        assert.ok(Number.isInteger(sides) && sides > 1);
        return {
          sides,
          faces: Array.from({ length: count }, () => (this.takeEntropy(request.purposeKey) % sides) + 1),
        };
      });
      const fulfilled = {
        randomnessId: request.randomnessId,
        requestHash: request.requestHash,
        draws,
      };
      this.fulfilled.set(request.randomnessId, fulfilled);
      this.newFulfillmentCount += 1;
      return structuredClone(fulfilled);
    });

    // This is the private deterministic test Adapter for the Room Authority,
    // not a player/KP Rules input. Only this boundary can return rolled faces.
    return {
      kind: "authoritativeRandomness",
      resolutionId: result.resolutionId,
      responseId: `authority-response:${result.resolutionId}`,
      continuationCapability: result.continuationCapability,
      randomnessResults,
    };
  }
}

function drive(scenario, input, authority, { internal = false } = {}) {
  if (!internal) assertOrdinaryRulesInput(input);
  let currentScenario = scenario;
  let result = step(PROFILES, currentScenario.state, input);
  const emitted = [];

  while (true) {
    emitted.push(...(result.events ?? []));
    currentScenario = appendReturnedEvents(currentScenario, result);
    if (result.kind !== "awaitingRandomness") {
      return Object.freeze({ scenario: currentScenario, result, events: Object.freeze(emitted) });
    }
    assertIncludesEventTypes(result.events, ["RandomnessRequested"]);
    const authorityResponse = authority.fulfill(result);
    result = step(PROFILES, currentScenario.state, authorityResponse);
  }
}

function answerPending(scenario, pending, answer, authority, responseId) {
  return drive(scenario, {
    kind: "answerPendingInput",
    pendingInputId: pending.pendingInputId,
    responseId,
    answer,
  }, authority);
}

function requireKind(driven, kind) {
  assert.equal(driven.result?.kind, kind, JSON.stringify(driven.result));
  return driven;
}

/** SPEC 0012 §7.2: a walk out of an adjacent enemy's reach first offers that
 * enemy its opportunity attack. Tests about something else let it decline. */
function opportunityDeclined(driven, authority, controllerEntityId, responseId) {
  const offered = requireKind(driven, "awaitingInput");
  assert.equal(offered.result.pending.choiceKind, "reaction");
  assert.equal(offered.result.pending.controllerEntityId, controllerEntityId);
  return answerPending(offered.scenario, offered.result.pending, { kind: "decline" }, authority, responseId);
}

function openEncounter(authority) {
  return openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER);
}

function openEncounterWithInput(authority, encounterInput, genesis = ROOM_GENESIS) {
  const opening = drive(startScenario(genesis), encounterInput, authority);
  requireKind(opening, "awaitingInput");
  assertIncludesEventTypes(opening.events, [
    "DefinitionRegistered",
    "EntityMaterialized",
    "EncounterStarted",
    "InitiativeRequested",
    "InitiativeEstablished",
  ]);
  assert.deepEqual(
    opening.result.pending,
    {
      pendingInputId: opening.result.pending.pendingInputId,
      kind: "playerChoice",
      choiceKind: "initiativeTieOrder",
      controllerEntityId: ALICE_ID,
      controllerEntityIds: [ALICE_ID, BOB_ID],
      orderedEntityIds: [ALICE_ID, BOB_ID],
    },
  );

  const ordered = answerPending(
    opening.scenario,
    opening.result.pending,
    { orderedEntityIds: [ALICE_ID, BOB_ID] },
    authority,
    "response:initiative-tie-order",
  );
  requireKind(ordered, "committed");
  assertIncludesEventTypes(ordered.events, ["InitiativeTieOrdered", "RoundStarted", "TurnStarted"]);
  return Object.freeze({
    scenario: ordered.scenario,
    events: Object.freeze([...opening.events, ...ordered.events]),
  });
}

test("Geometry measures creature footprints instead of treating combatants as points", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "attack:alice-resonant-blade": [16],
    "damage:alice-resonant-blade": [4, 3, 2],
    "save:shatter:enemy:cinder-sentinel": [4],
    "damage:spell:shatter": [0, 1, 2],
  }));
  const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
  const brute = encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID);
  brute.placement.position = { x: "90", y: "0", elevation: "0" };
  brute.mechanics.definition.content.footprint = { width: "120", depth: "120", height: "120" };
  const sentinel = encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID);
  sentinel.placement.position = { x: "360", y: "0", elevation: "0" };
  sentinel.mechanics.definition.content.footprint = { width: "120", depth: "120", height: "120" };

  let { scenario } = openEncounterWithInput(authority, encounterInput);
  const melee = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:alice-reaches-large-brute-edge",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-resonant-blade",
    parameters: { targetEntityId: BRUTE_ID },
  }, authority), "committed");
  scenario = melee.scenario;

  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:alice-ends-after-edge-reach",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;

  const area = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:bob-shatter-touches-large-sentinel",
    sourceEntityId: BOB_ID,
    abilityRef: "spell:shatter",
    parameters: { slotLevel: "2", areaOrigin: { x: "240", y: "0", elevation: "0" } },
  }, authority), "committed");
  assert.deepEqual(area.result.mechanicalResult.area.affectedEntityIds, [BRUTE_ID, SENTINEL_ID]);
});

test("Geometry G02 accepts five-foot reach when two Medium occupancy boundaries touch", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
  encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID).placement.position = {
    x: "60", y: "0", elevation: "0",
  };
  encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID).placement.position = {
    x: "360", y: "0", elevation: "0",
  };
  const { scenario } = openEncounterWithInput(authority, encounterInput);
  const reached = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:geometry-g02-touching-medium-reach",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-resonant-blade",
    parameters: { targetEntityId: BRUTE_ID },
  }, authority), "committed");
  assert.ok(eventsOfType(reached.events, "AbilityInvoked").length > 0);
  assert.deepEqual(
    replayed(reached.scenario.eventLog).state.combatRuntime,
    reached.scenario.state.combatRuntime,
  );
});

test("Geometry G03 measures a full Medium-space gap as 120 inches", () => {
  const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
  encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID).placement.position = {
    x: "120", y: "0", elevation: "0",
  };
  encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID).placement.position = {
    x: "360", y: "0", elevation: "0",
  };

  {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
    const { scenario } = openEncounterWithInput(authority, encounterInput);
    const shortReach = drive(scenario, {
      kind: "invokeAbility",
      rootActionId: "root:geometry-g03-five-foot-reach-is-short",
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:alice-resonant-blade",
      parameters: { targetEntityId: BRUTE_ID },
    }, authority);
    assert.equal(shortReach.result.kind, "rejected");
    assert.equal(shortReach.result.rejection.code, "privateOrUnknownReference");
    assert.deepEqual(shortReach.events, []);
  }

  {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
    const { scenario } = openEncounterWithInput(authority, encounterInput);
    const exactReach = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: "root:geometry-g03-ten-foot-boundary",
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:geometry-range-120",
      parameters: { targetEntityId: BRUTE_ID },
    }, authority), "committed");
    assert.ok(eventsOfType(exactReach.events, "AbilityInvoked").length > 0);
  }
});

test("Geometry G04 includes a 60-inch vertical core gap in three-dimensional range", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
  encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID).placement.position = {
    x: "0", y: "0", elevation: "60",
  };
  encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID).placement.position = {
    x: "360", y: "0", elevation: "0",
  };
  const { scenario } = openEncounterWithInput(authority, encounterInput);
  const verticalReach = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:geometry-g04-vertical-five-foot-reach",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-resonant-blade",
    parameters: { targetEntityId: BRUTE_ID },
  }, authority), "committed");
  assert.ok(eventsOfType(verticalReach.events, "AbilityInvoked").length > 0);
});

test("Geometry G05 uses Euclidean range for diagonal core gaps", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
  encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID).placement.position = {
    x: "120", y: "120", elevation: "0",
  };
  encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID).placement.position = {
    x: "360", y: "0", elevation: "0",
  };
  const { scenario } = openEncounterWithInput(authority, encounterInput);
  const diagonal = drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:geometry-g05-diagonal-is-outside-ten-feet",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:geometry-range-120",
    parameters: { targetEntityId: BRUTE_ID },
  }, authority);
  assert.equal(diagonal.result.kind, "rejected");
  assert.equal(diagonal.result.rejection.code, "privateOrUnknownReference");
  assert.deepEqual(diagonal.events, []);
});

test("Geometry G06 includes exact point and entity boundaries but excludes one inch beyond", () => {
  for (const [offset, expectedKind] of [["-120", "committed"], ["-121", "rejected"]]) {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
    const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
    encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID).placement.position = {
      x: offset, y: "0", elevation: "0",
    };
    encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID).placement.position = {
      x: "360", y: "0", elevation: "0",
    };
    const { scenario } = openEncounterWithInput(authority, encounterInput);
    const entityRange = drive(scenario, {
      kind: "invokeAbility",
      rootActionId: `root:geometry-g06-entity:${offset}`,
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:geometry-range-120",
      parameters: { targetEntityId: BRUTE_ID },
    }, authority);
    assert.equal(entityRange.result.kind, expectedKind, `entity offset ${offset}`);
    if (expectedKind === "rejected") assert.deepEqual(entityRange.events, []);
  }

  for (const [offset, expectedKind] of [["-120", "committed"], ["-121", "rejected"]]) {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
    const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
    encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID).placement.position = {
      x: "360", y: "0", elevation: "0",
    };
    encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID).placement.position = {
      x: "420", y: "0", elevation: "0",
    };
    const { scenario } = openEncounterWithInput(authority, encounterInput);
    const pointRange = drive(scenario, {
      kind: "invokeAbility",
      rootActionId: `root:geometry-g06-point:${offset}`,
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:geometry-point-range-120",
      // A Medium creature's vertical measurement core collapses to z=30.
      // Keep z on that core so this vector isolates the exact horizontal edge.
      parameters: { areaOrigin: { x: "0", y: offset, elevation: "30" } },
    }, authority);
    assert.equal(pointRange.result.kind, expectedKind, `point offset ${offset}`);
    if (expectedKind === "rejected") assert.deepEqual(pointRange.events, []);
  }
});

test("Geometry G07 canonicalizes a 36/48 segment identically across retry and fragmentation", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  const { scenario } = openEncounter(authority);
  const rootActionId = "root:geometry-g07-fragmented-retry";
  const base = {
    kind: "moveCombatant",
    rootActionId,
    encounterId: ENCOUNTER_ID,
    sourceEntityId: ALICE_ID,
    movementMode: "walk",
  };
  const directInput = {
    ...base,
    path: [
      { x: "0", y: "0", elevation: "0" },
      { x: "-36", y: "-48", elevation: "0" },
    ],
  };
  const fragmentedInput = {
    ...base,
    path: [
      { x: "0", y: "0", elevation: "0" },
      { x: "0", y: "0", elevation: "0" },
      { x: "-18", y: "-24", elevation: "0" },
      { x: "-36", y: "-48", elevation: "0" },
      { x: "-36", y: "-48", elevation: "0" },
    ],
  };
  const direct = step(PROFILES, scenario.state, directInput);
  const retry = step(PROFILES, scenario.state, structuredClone(directInput));
  const fragmented = step(PROFILES, scenario.state, fragmentedInput);
  // SPEC 0012 §7.2: the step out of Brute's reach first offers Brute its
  // opportunity attack, frozen the same for every spelling of the path.
  assert.equal(direct.kind, "awaitingInput", JSON.stringify(direct));
  assert.deepEqual(retry, direct);
  assert.deepEqual(fragmented, direct);
  const decline = (offered) => step(PROFILES, replayed([...scenario.eventLog, ...offered.events]).state, {
    kind: "answerPendingInput", pendingInputId: offered.pending.pendingInputId,
    responseId: "response:g07-brute-declines", answer: { kind: "decline" },
  });
  const directDeclined = decline(direct);
  assert.equal(directDeclined.kind, "committed", JSON.stringify(directDeclined));
  const movement = eventsOfType(directDeclined.events, "MovementSegmentCommitted")[0];
  assert.equal(movement.payload.distanceMilliInches, "60000");
  assert.deepEqual(movement.payload.path, directInput.path);

  const directReplay = replayed([...scenario.eventLog, ...direct.events, ...directDeclined.events]);
  const fragmentedReplay = replayed([...scenario.eventLog, ...fragmented.events, ...decline(fragmented).events]);
  assert.deepEqual(fragmentedReplay.state, directReplay.state);
});

test("Geometry rejects movement beyond speed or into an occupied endpoint before committing a segment", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  const { scenario } = openEncounter(authority);

  const beyondSpeed = drive(scenario, {
    kind: "moveCombatant",
    rootActionId: "root:alice-cannot-exceed-speed",
    encounterId: ENCOUNTER_ID,
    sourceEntityId: ALICE_ID,
    movementMode: "walk",
    path: [
      { x: "0", y: "0", elevation: "0" },
      { x: "361", y: "0", elevation: "0" },
    ],
  }, authority);
  requireKind(beyondSpeed, "rejected");
  assert.equal(beyondSpeed.result.rejection.code, "invalidRulesInput");
  assert.deepEqual(beyondSpeed.events, []);

  const occupied = drive(scenario, {
    kind: "moveCombatant",
    rootActionId: "root:alice-cannot-overlap-bob",
    encounterId: ENCOUNTER_ID,
    sourceEntityId: ALICE_ID,
    movementMode: "walk",
    path: [
      { x: "0", y: "0", elevation: "0" },
      { x: "60", y: "60", elevation: "0" },
    ],
  }, authority);
  requireKind(occupied, "rejected");
  assert.equal(occupied.result.rejection.code, "privateOrUnknownReference");
  assert.deepEqual(occupied.events, []);
});

test("Geometry applies one-size squeezing cost and Dex-save disadvantage, while narrower clearance fails closed", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "attack:alice-longbow": [16, 4],
    "damage:alice-longbow": [3],
    "save:cinder-burst:character:alice": [18, 2],
    "damage:ability:ash-brute-cinder-burst": [3, 3],
  }));
  const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
  const brute = encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID);
  brute.placement.position = { x: "60", y: "240", elevation: "0" };
  const sentinel = encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID);
  sentinel.placement.position = { x: "360", y: "240", elevation: "0" };
  const clearanceGenesis = geometryGenesis(
    structuredClone(INITIAL_STATE),
    "g09-clearance-profile",
    { preserveClearanceZones: true },
  );
  let { scenario } = openEncounterWithInput(authority, encounterInput, clearanceGenesis);

  const tooNarrow = requireKind(drive(scenario, {
    kind: "moveCombatant",
    rootActionId: "root:alice-cannot-enter-tiny-clearance",
    encounterId: ENCOUNTER_ID,
    sourceEntityId: ALICE_ID,
    movementMode: "walk",
    path: [
      { x: "0", y: "0", elevation: "0" },
      { x: "-210", y: "0", elevation: "0" },
    ],
  }, authority), "rejected");
  assert.equal(tooNarrow.result.rejection.code, "privateOrUnknownReference");
  assert.deepEqual(tooNarrow.events, []);

  const squeezed = requireKind(drive(scenario, {
    kind: "moveCombatant",
    rootActionId: "root:alice-squeezes-into-small-clearance",
    encounterId: ENCOUNTER_ID,
    sourceEntityId: ALICE_ID,
    movementMode: "walk",
    path: [
      { x: "0", y: "0", elevation: "0" },
      { x: "0", y: "240", elevation: "0" },
    ],
  }, authority), "committed");
  scenario = squeezed.scenario;
  const movement = eventsOfType(squeezed.events, "MovementSegmentCommitted")[0];
  assert.equal(movement.payload.distanceMilliInches, "300000");
  assert.equal(scenario.state.combatRuntime.entities[ALICE_ID].conditions.squeezing, true);

  const ranged = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:alice-attacks-while-squeezing",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-longbow",
    parameters: { targetEntityId: BRUTE_ID },
  }, authority), "committed");
  scenario = ranged.scenario;
  assert.equal(ranged.result.mechanicalResult.attack.mode, "disadvantage");
  assert.ok(ranged.result.mechanicalResult.attack.disadvantageReasons.includes("sourceCondition2014"));

  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:alice-ends-after-squeezing",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:bob-ends-before-squeezing-save",
    sourceEntityId: BOB_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;

  const dexSave = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:brute-tests-squeezing-dex-save",
    sourceEntityId: BRUTE_ID,
    abilityRef: "ability:ash-brute-cinder-burst",
    parameters: { areaOrigin: { x: "60", y: "240", elevation: "0" } },
  }, authority), "committed");
  const save = dexSave.result.mechanicalResult.saves[ALICE_ID];
  assert.equal(save.mode, "disadvantage");
  assert.deepEqual(save.rolls, [19, 3]);
  assert.equal(save.roll, 3);
});

test("Geometry G10 applies the fixed 31/32/48/64 hard-cover thresholds and caps soft-only cover at half", () => {
  const vectors = [
    { hardSamples: 31, expected: "none" },
    { hardSamples: 32, expected: "half" },
    { hardSamples: 48, expected: "threeQuarters" },
    { hardSamples: 64, expected: "full" },
  ];
  for (const { hardSamples, expected } of vectors) {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
    const initialState = structuredClone(INITIAL_STATE);
    initialState.entities[ALICE_ID].footprint = { width: "400", depth: "400", height: "500" };
    initialState.entities[BOB_ID].position = { x: "0", y: "3000", elevation: "0" };
    initialState.scenes[MODULE_FIXTURE.sceneId].geometry.obstacles = coverSampleBlockers(hardSamples);
    const genesis = geometryGenesis(initialState, `g10-hard-${hardSamples}`);
    const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
    const brute = encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID);
    brute.placement.position = { x: "0", y: "4000", elevation: "0" };
    const sentinel = encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID);
    sentinel.placement.position = { x: "2000", y: "0", elevation: "0" };
    sentinel.mechanics.definition.content.footprint = { width: "400", depth: "400", height: "400" };
    const { scenario } = openEncounterWithInput(authority, encounterInput, genesis);
    const shot = drive(scenario, {
      kind: "invokeAbility",
      rootActionId: `root:g10-hard-cover-${hardSamples}`,
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:alice-longbow",
      parameters: { targetEntityId: SENTINEL_ID },
    }, authority);
    if (expected === "full") {
      requireKind(shot, "rejected");
      assert.equal(shot.result.rejection.code, "privateOrUnknownReference");
      assert.deepEqual(shot.events, []);
    } else {
      requireKind(shot, "committed");
      assert.equal(shot.result.mechanicalResult.attack.cover, expected);
      assert.deepEqual(
        replayed(shot.scenario.eventLog, genesis).state.combatRuntime,
        shot.scenario.state.combatRuntime,
      );
    }
  }

  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  const initialState = structuredClone(INITIAL_STATE);
  initialState.entities[ALICE_ID].footprint = { width: "400", depth: "400", height: "500" };
  initialState.entities[BOB_ID].position = { x: "0", y: "3000", elevation: "0" };
  initialState.scenes[MODULE_FIXTURE.sceneId].geometry.obstacles = [];
  for (const entity of coverSampleBlockers(64, { opaque: false })) initialState.entities[entity.id] = entity;
  const genesis = geometryGenesis(initialState, "g10-soft-64");
  const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
  encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID).placement.position = {
    x: "0", y: "4000", elevation: "0",
  };
  const sentinel = encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID);
  sentinel.placement.position = { x: "2000", y: "0", elevation: "0" };
  sentinel.mechanics.definition.content.footprint = { width: "400", depth: "400", height: "400" };
  const { scenario } = openEncounterWithInput(authority, encounterInput, genesis);
  const softOnly = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:g10-soft-cover-cannot-exceed-half",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-longbow",
    parameters: { targetEntityId: SENTINEL_ID },
  }, authority), "committed");
  assert.equal(softOnly.result.mechanicalResult.attack.cover, "half");
});

test("Geometry treats ally and two-size hostile traversal as difficult, but blocks a nearer-size hostile", () => {
  {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
    const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
    encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID).placement.position = { x: "-300", y: "0", elevation: "0" };
    encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID).placement.position = { x: "300", y: "0", elevation: "0" };
    const { scenario } = openEncounterWithInput(authority, encounterInput);
    const throughAlly = requireKind(drive(scenario, {
      kind: "moveCombatant",
      rootActionId: "root:alice-crosses-bob-space-with-cost",
      encounterId: ENCOUNTER_ID,
      sourceEntityId: ALICE_ID,
      movementMode: "walk",
      path: [
        { x: "0", y: "0", elevation: "0" },
        { x: "60", y: "60", elevation: "0" },
        { x: "0", y: "120", elevation: "0" },
      ],
    }, authority), "committed");
    const distance = BigInt(eventsOfType(throughAlly.events, "MovementSegmentCommitted")[0].payload.distanceMilliInches);
    assert.ok(distance > 169706n, "ally occupancy must add a difficult-terrain surcharge");
  }

  {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
    const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
    const brute = encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID);
    brute.placement.position = { x: "0", y: "-120", elevation: "0" };
    const { scenario } = openEncounterWithInput(authority, encounterInput);
    const blocked = requireKind(drive(scenario, {
      kind: "moveCombatant",
      rootActionId: "root:alice-cannot-cross-near-size-hostile",
      encounterId: ENCOUNTER_ID,
      sourceEntityId: ALICE_ID,
      movementMode: "walk",
      path: [
        { x: "0", y: "0", elevation: "0" },
        { x: "0", y: "-300", elevation: "0" },
      ],
    }, authority), "rejected");
    assert.equal(blocked.result.rejection.code, "privateOrUnknownReference");
  }

  {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
    const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
    const brute = encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID);
    brute.placement.position = { x: "0", y: "-120", elevation: "0" };
    brute.mechanics.definition.content.footprint = { width: "30", depth: "30", height: "30" };
    brute.mechanics.definition.content.sizeCategory = "tiny";
    const { scenario } = openEncounterWithInput(authority, encounterInput);
    const throughTinyHostile = requireKind(drive(scenario, {
      kind: "moveCombatant",
      rootActionId: "root:alice-crosses-two-size-hostile-with-cost",
      encounterId: ENCOUNTER_ID,
      sourceEntityId: ALICE_ID,
      movementMode: "walk",
      path: [
        { x: "0", y: "0", elevation: "0" },
        { x: "0", y: "-240", elevation: "0" },
      ],
    }, authority), "committed");
    const distance = BigInt(eventsOfType(throughTinyHostile.events, "MovementSegmentCommitted")[0].payload.distanceMilliInches);
    assert.ok(distance > 240000n, "traversable hostile occupancy must still cost difficult terrain");
  }
});

test("Geometry blocks swept hostile occupancy even when the mover center misses the hostile footprint", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
  const brute = encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID);
  brute.placement.position = { x: "59", y: "-120", elevation: "0" };
  const sentinel = encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID);
  sentinel.placement.position = { x: "360", y: "0", elevation: "0" };
  const { scenario } = openEncounterWithInput(authority, encounterInput);

  const blocked = requireKind(drive(scenario, {
    kind: "moveCombatant",
    rootActionId: "root:alice-cannot-graze-hostile-occupancy",
    encounterId: ENCOUNTER_ID,
    sourceEntityId: ALICE_ID,
    movementMode: "walk",
    path: [
      { x: "0", y: "0", elevation: "0" },
      { x: "0", y: "-240", elevation: "0" },
    ],
  }, authority), "rejected");
  assert.equal(blocked.result.rejection.code, "privateOrUnknownReference");
  assert.deepEqual(blocked.events, []);
});

test("Geometry G11 includes a 20-foot sphere boundary sample, excludes one inch beyond, and rejects caller target sets", () => {
  for (const { centerX, expected } of [
    { centerX: "243", expected: [SENTINEL_ID] },
    { centerX: "244", expected: [] },
  ]) {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
    const initialState = structuredClone(INITIAL_STATE);
    initialState.scenes[MODULE_FIXTURE.sceneId].geometry.obstacles = [];
    const genesis = geometryGenesis(initialState, `g11-sphere-${centerX}`);
    const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
    encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID).placement.position = {
      x: "600", y: "600", elevation: "0",
    };
    const sentinel = encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID);
    sentinel.placement.position = { x: centerX, y: "3", elevation: "-1" };
    sentinel.mechanics.definition.content.footprint = { width: "8", depth: "8", height: "8" };
    const { scenario } = openEncounterWithInput(authority, encounterInput, genesis);

    const forged = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: `root:g11-forged-targets-${centerX}`,
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:geometry-sphere-240",
      parameters: {
        areaOrigin: { x: "0", y: "0", elevation: "0" },
        targetIds: expected.length === 0 ? [SENTINEL_ID] : [],
      },
    }, authority), "rejected");
    assert.equal(forged.result.rejection.code, "invalidRulesInput");
    assert.deepEqual(forged.events, []);

    const area = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: `root:g11-authoritative-targets-${centerX}`,
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:geometry-sphere-240",
      parameters: { areaOrigin: { x: "0", y: "0", elevation: "0" } },
    }, authority), "committed");
    // Areas are geometric (SPEC 0012 §4.2): the caster standing on the origin
    // and the ally five feet away are inside the 20-foot sphere as well.
    assert.deepEqual(
      [...area.result.mechanicalResult.area.affectedEntityIds].sort(),
      [...expected, ALICE_ID, BOB_ID].sort(),
    );
    assert.deepEqual(
      replayed(area.scenario.eventLog, genesis).state.combatRuntime,
      area.scenario.state.combatRuntime,
    );
  }
});

test("Geometry computes all five closed area shapes and rejects caller-authored affected sets", () => {
  // Areas are geometric (SPEC 0012 §4.2): Alice casts from the origin, so her
  // own space is inside the sphere and cylinder, and so is Bob's five feet to
  // the +x/+y side. A cube, cone or line cast from Alice starts at the edge of
  // her space and points -x (SPEC 0013 §5.6, ADR 0149), so neither she, Bob
  // nor the sentinel beside her is inside; the brute ahead is.
  const vectors = [
    ["sphere", "ability:geometry-sphere", undefined, [BRUTE_ID, SENTINEL_ID, ALICE_ID, BOB_ID]],
    ["cylinder", "ability:geometry-cylinder", undefined, [BRUTE_ID, SENTINEL_ID, ALICE_ID, BOB_ID]],
    ["cube", "ability:geometry-cube", { x: "-2", y: "0", elevation: "0" }, [BRUTE_ID]],
    ["cone", "ability:geometry-cone", { x: "-2", y: "0", elevation: "0" }, [BRUTE_ID]],
    ["line", "ability:geometry-line", { x: "-2", y: "0", elevation: "0" }, [BRUTE_ID]],
  ];
  for (const [shapeKind, abilityRef, areaDirection, expected] of vectors) {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
    const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
    const brute = encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID);
    brute.placement.position = { x: "-111", y: "0", elevation: "0" };
    brute.mechanics.definition.content.footprint = { width: "56", depth: "56", height: "60" };
    const sentinel = encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID);
    sentinel.placement.position = { x: "0", y: "-111", elevation: "0" };
    sentinel.mechanics.definition.content.footprint = { width: "56", depth: "56", height: "60" };
    const { scenario } = openEncounterWithInput(authority, encounterInput);
    const parameters = {
      areaOrigin: { x: "0", y: "0", elevation: "0" },
      ...(areaDirection === undefined ? {} : { areaDirection }),
    };
    const result = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: `root:geometry-shape:${shapeKind}`,
      sourceEntityId: ALICE_ID,
      abilityRef,
      parameters,
    }, authority), "committed");
    assert.equal(result.result.mechanicalResult.area.shape.kind, shapeKind);
    assert.deepEqual([...result.result.mechanicalResult.area.affectedEntityIds].sort(), [...expected].sort(), shapeKind);
    if (areaDirection !== undefined) {
      assert.deepEqual(result.result.mechanicalResult.area.direction, { x: "-1", y: "0", elevation: "0" });
    }
    assert.deepEqual(
      replayed(result.scenario.eventLog).state.combatRuntime,
      result.scenario.state.combatRuntime,
    );
  }

  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  const { scenario } = openEncounter(authority);
  const forgedTargets = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:geometry-caller-cannot-override-area",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:geometry-sphere",
    parameters: {
      areaOrigin: { x: "0", y: "0", elevation: "0" },
      affectedEntityIds: [],
    },
  }, authority), "rejected");
  assert.equal(forgedTargets.result.rejection.code, "invalidRulesInput");
  assert.deepEqual(forgedTargets.events, []);
});

// SRD 5.1 Thunderwave (ADR 0149): a cube cast from the caster starts at the
// edge of its space; a creature that fails the save is pushed 10 feet
// straight away from the caster, one that succeeds is not, and replay lands
// every push where the event says.
test("Thunderwave starts at the caster's edge and pushes a creature that fails its save 10 feet away", () => {
  const THUNDERWAVE = {
    definitionId: "ability:alice-thunderwave",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "action" },
    target: { kind: "area", rangeInches: "0", shape: { kind: "cube", edgeInches: "180", propagation: "straight" } },
    save: { ability: "con", halfOnSuccess: true },
    damage: [{ type: "thunder", formula: "2d8" }],
    effects: [{ tag: "push-10", label: "失败时推开 10 尺", kind: "movement", value: 10 }],
  };
  // The test authority rolls face (entropy mod sides) + 1: a 1 and a 20.
  for (const [label, saveEntropy, pushed] of [["fails", 0, true], ["succeeds", 19, false]]) {
    const initialState = structuredClone(INITIAL_STATE);
    initialState.definitions[THUNDERWAVE.definitionId] = registered(THUNDERWAVE);
    initialState.entities[ALICE_ID].abilityRefs.push(THUNDERWAVE.definitionId);
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
      [`save:${THUNDERWAVE.definitionId}:${BRUTE_ID}`]: [saveEntropy],
    }));
    const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
    const brute = encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID);
    brute.placement.position = { x: "-111", y: "0", elevation: "0" };
    brute.mechanics.definition.content.footprint = { width: "56", depth: "56", height: "60" };
    const sentinel = encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID);
    sentinel.placement.position = { x: "0", y: "-111", elevation: "0" };
    const { scenario } = openEncounterWithInput(authority, encounterInput, geometryGenesis(initialState, `thunderwave-${label}`));
    const cast = requireKind(invoke(scenario, authority, `root:thunderwave:${label}`, ALICE_ID, THUNDERWAVE.definitionId, {
      areaOrigin: { x: "0", y: "0", elevation: "0" },
      areaDirection: { x: "-1", y: "0", elevation: "0" },
    }), "committed");
    const area = cast.result.mechanicalResult.area;
    assert.deepEqual(area.origin, { x: "-30", y: "0", elevation: "0" }, "the cube starts at the edge of Alice's space");
    assert.deepEqual(area.affectedEntityIds, [BRUTE_ID]);
    const pushes = eventsOfType(cast.events, "CreaturePushed");
    if (pushed) {
      assert.deepEqual(pushes.map(({ payload }) => payload), [{ characterId: BRUTE_ID, sceneId: MODULE_FIXTURE.sceneId,
        byCharacterId: ALICE_ID, from: { x: "-111", y: "0", elevation: "0" }, to: { x: "-231", y: "0", elevation: "0" }, distanceInches: "120" }]);
      assert.deepEqual(cast.scenario.state.combatRuntime.entities[BRUTE_ID].position, { x: "-231", y: "0", elevation: "0" });
      assert.deepEqual(cast.result.mechanicalResult.pushed, { [BRUTE_ID]: true });
    } else {
      assert.deepEqual(pushes, []);
      assert.deepEqual(cast.scenario.state.combatRuntime.entities[BRUTE_ID].position, { x: "-111", y: "0", elevation: "0" });
    }
    assert.deepEqual(replayed(cast.scenario.eventLog, geometryGenesis(initialState, `thunderwave-${label}`)).state.combatRuntime,
      cast.scenario.state.combatRuntime);
  }
});

test("Geometry G12 freezes a wall-blocked origin atomically before exposing its target set", () => {
  {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
    const { scenario } = openEncounter(authority);
    const frozen = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: "root:geometry-freezes-origin-before-wall",
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:geometry-frozen-origin",
      parameters: { areaOrigin: { x: "0", y: "480", elevation: "0" } },
    }, authority), "committed");
    assert.deepEqual(frozen.result.mechanicalResult.area.origin, {
      x: "0",
      y: "299",
      elevation: { numerator: "181", denominator: "10" },
    });
    const frozenEvent = eventsOfType(frozen.events, "AbilityInvoked")[0];
    assert.deepEqual(frozenEvent.payload.mechanicalResult.area, frozen.result.mechanicalResult.area);
    const changedAfterObservation = step(PROFILES, frozen.scenario.state, {
      kind: "invokeAbility",
      rootActionId: "root:geometry-freezes-origin-before-wall",
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:geometry-frozen-origin",
      parameters: { areaOrigin: { x: "0", y: "0", elevation: "0" } },
    });
    assert.equal(changedAfterObservation.kind, "rejected");
    assert.deepEqual(changedAfterObservation.events, []);
    assert.deepEqual(
      replayed(frozen.scenario.eventLog).state.combatRuntime,
      frozen.scenario.state.combatRuntime,
    );
  }
});

test("Geometry G13 keeps straight, around-corner, and sealed propagation stable under obstacle-order perturbation", () => {
  const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
  const brute = encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID);
  brute.placement.position = { x: "120", y: "-150", elevation: "0" };
  brute.mechanics.definition.content.footprint = { width: "2", depth: "2", height: "60" };
  const sentinel = encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID);
  sentinel.placement.position = { x: "180", y: "-120", elevation: "0" };
  sentinel.mechanics.definition.content.footprint = { width: "2", depth: "2", height: "60" };

  {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
    const { scenario } = openEncounterWithInput(authority, encounterInput);
    const straight = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: "root:geometry-straight-cannot-cross-walls",
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:geometry-straight-spread",
      parameters: { areaOrigin: { x: "0", y: "0", elevation: "0" } },
    }, authority), "committed");
    // The walls seal the enemies off; the caster and her ally stand inside
    // the sphere with nothing between them and the origin (SPEC 0012 §4.2).
    assert.deepEqual([...straight.result.mechanicalResult.area.affectedEntityIds].sort(), [ALICE_ID, BOB_ID].sort());
  }

  {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
    const { scenario } = openEncounterWithInput(authority, encounterInput);
    const around = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: "root:geometry-around-open-corner-not-sealed-room",
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:geometry-around-corners",
      parameters: { areaOrigin: { x: "0", y: "0", elevation: "0" } },
    }, authority), "committed");
    assert.deepEqual([...around.result.mechanicalResult.area.affectedEntityIds].sort(), [BRUTE_ID, ALICE_ID, BOB_ID].sort());
    assert.deepEqual(
      replayed(around.scenario.eventLog).state.combatRuntime,
      around.scenario.state.combatRuntime,
    );
  }

  {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
    const initialState = structuredClone(INITIAL_STATE);
    initialState.scenes[MODULE_FIXTURE.sceneId].geometry.obstacles.reverse();
    const genesis = geometryGenesis(initialState, "g13-reversed-obstacles");
    const { scenario } = openEncounterWithInput(authority, encounterInput, genesis);
    const perturbed = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: "root:geometry-around-corners-reversed-obstacles",
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:geometry-around-corners",
      parameters: { areaOrigin: { x: "0", y: "0", elevation: "0" } },
    }, authority), "committed");
    assert.deepEqual([...perturbed.result.mechanicalResult.area.affectedEntityIds].sort(), [BRUTE_ID, ALICE_ID, BOB_ID].sort());
    assert.deepEqual(
      replayed(perturbed.scenario.eventLog, genesis).state.combatRuntime,
      perturbed.scenario.state.combatRuntime,
    );
  }
});

test("2014 surprise is per combatant and grapple is an Attack replacement contest, not a saving throw", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "check:grapple:character:alice": [14],
    "check:grapple:enemy:ash-brute": [5],
  }));
  const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
  encounterInput.surprisedEntityIds = [BOB_ID];
  let { scenario } = openEncounterWithInput(authority, encounterInput);

  const grapple = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:alice-grapples-brute-2014",
    sourceEntityId: ALICE_ID,
    abilityRef: "action:grapple",
    parameters: { targetEntityId: BRUTE_ID, defenderContestAbility: "acrobatics" },
  }, authority), "committed");
  scenario = grapple.scenario;
  assert.equal(grapple.result.mechanicalResult.contest.kind, "opposedAbilityCheck2014");
  assert.equal(grapple.result.mechanicalResult.contest.defenderAbility, "acrobatics");
  assert.equal(combatEntity(read(scenario, ALICE_VIEWER), BRUTE_ID).conditions.grappledBy, ALICE_ID);

  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:alice-ends-before-surprised-bob",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  const bob = combatEntity(read(scenario, BOB_VIEWER), BOB_ID);
  assert.equal(bob.turn.surprised, true);
  assert.equal(bob.turn.action, "0");
  assert.equal(bob.turn.bonusAction, "0");
  assert.equal(bob.turn.reaction, "0");

  const surprisedAction = drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:bob-cannot-act-while-surprised",
    sourceEntityId: BOB_ID,
    abilityRef: "spell:fire-bolt",
    parameters: { targetEntityId: BRUTE_ID },
  }, authority);
  requireKind(surprisedAction, "rejected");
  assert.deepEqual(surprisedAction.events, []);

  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:bob-finishes-surprised-turn",
    sourceEntityId: BOB_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  assert.equal(combatEntity(read(scenario, BOB_VIEWER), BOB_ID).turn.surprised, false);
  assert.equal(combatEntity(read(scenario, BOB_VIEWER), BOB_ID).turn.reaction, "1");
});

// SPEC 0014 §4 (ADR 0090): a grappler drags the creature it holds; the
// held creature stops beside it after the segment, and dragging a creature
// of its own size halves the grappler's speed (2014 semantics).
test("a grappler drags the held creature at half speed, and the held creature stops beside it", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "check:grapple:character:alice": [14],
    "check:grapple:enemy:ash-brute": [5],
  }));
  let { scenario } = openEncounter(authority);
  scenario = requireKind(drive(scenario, {
    kind: "invokeAbility", rootActionId: "root:alice-grapples-brute-to-drag", sourceEntityId: ALICE_ID,
    abilityRef: "action:grapple", parameters: { targetEntityId: BRUTE_ID, defenderContestAbility: "acrobatics" },
  }, authority), "committed").scenario;
  assert.equal(combatEntity(read(scenario, ALICE_VIEWER), BRUTE_ID).conditions.grappledBy, ALICE_ID);
  const move = (rootActionId, to) => drive(scenario, { kind: "moveCombatant", rootActionId, encounterId: ENCOUNTER_ID,
    sourceEntityId: ALICE_ID, movementMode: "walk", path: [{ x: "0", y: "0", elevation: "0" }, { x: to, y: "0", elevation: "0" }] }, authority);

  // SPEC 0012 §7.2 (ADR 0090): the held brute moves with her, so walking off
  // its old place offers it no opportunity attack.
  const dragged = requireKind(move("root:alice-drags-brute", "-120"), "committed");
  const segment = dragged.events.find(event => event.eventType === "MovementSegmentCommitted");
  assert.equal(segment.payload.distanceMilliInches, "240000", "ten feet dragging a Medium creature costs twenty");
  assert.deepEqual(segment.payload.carried, [{ characterId: BRUTE_ID, position: { x: "-60", y: "0", elevation: "0" } }]);
  const view = read(dragged.scenario, ALICE_VIEWER);
  assert.deepEqual(combatEntity(view, ALICE_ID).position, { x: "-120", y: "0", elevation: "0" });
  assert.deepEqual(combatEntity(view, BRUTE_ID).position, { x: "-60", y: "0", elevation: "0" }, "the brute trails beside Alice");
  assert.equal(combatEntity(view, BRUTE_ID).conditions.grappledBy, ALICE_ID);

  // Without dragging, thirty feet would have covered this; with it the
  // remaining ten feet of speed is five feet of dragging.
  scenario = dragged.scenario;
  const tooFar = drive(scenario, { kind: "moveCombatant", rootActionId: "root:alice-drags-too-far", encounterId: ENCOUNTER_ID,
    sourceEntityId: ALICE_ID, movementMode: "walk", path: [{ x: "-120", y: "0", elevation: "0" }, { x: "-210", y: "0", elevation: "0" }] }, authority);
  requireKind(tooFar, "rejected");
  assert.deepEqual(tooFar.events, []);
});

function read(scenario, viewer, query = { channel: "realtime" }) {
  const result = project(PROFILES, scenario.state, viewer, query);
  assert.equal(result?.kind, "projected", JSON.stringify(result));
  return result.readModel ?? result;
}

function combatEntity(view, entityId) {
  const entities = view.entities ?? view.combat?.entities;
  assert.ok(entities?.[entityId], `projection must contain ${entityId}`);
  return entities[entityId];
}

function encounterView(view) {
  const encounter = view.encounters?.[ENCOUNTER_ID] ?? view.combat?.encounter;
  assert.ok(encounter, "projection must contain the active encounter");
  return encounter;
}

function commonInitiativeEntropy(extra = {}) {
  return {
    "initiative:character:alice": [9],
    "initiative:character:bob": [9],
    "initiative:group:initiative:ash-enemies": [8],
    ...extra,
  };
}

function reactionEncounterInput() {
  const input = structuredClone(START_DYNAMIC_ENCOUNTER);
  const sentinel = input.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID);
  const sentinelContent = sentinel.mechanics.definition.content;
  sentinelContent.spellcasting = { ability: "int", spellAttackBonus: "4", spellSaveDc: "12" };
  sentinelContent.resourceMaximums = {
    "spellSlot:1": "1",
    "spellSlot:3": "1",
    "spellSlot:4": "1",
  };
  sentinelContent.intrinsicAbilities.push(
    {
      definitionId: "spell:cinder-sentinel-magic-missile",
      revision: "1",
      rulesBasis: "srd5.1-2014",
      mechanicalKey: "magic-missile",
      activation: { kind: "actionSpell", spellLevel: "1" },
      costs: [{ kind: "spellSlot", level: "1", amount: "1" }],
      target: { kind: "creature", count: "1", rangeInches: "1440", requiresSight: true },
      damage: [{ type: "force", formula: "1d4+1" }],
    },
    {
      definitionId: "spell:cinder-sentinel-force-wave",
      revision: "1",
      rulesBasis: "srd5.1-2014",
      activation: { kind: "actionSpell", spellLevel: "4" },
      costs: [{ kind: "spellSlot", level: "4", amount: "1" }],
      target: { kind: "creature", count: "1", rangeInches: "1440", requiresSight: true },
      damage: [{ type: "force", formula: "1d8" }],
    },
    {
      definitionId: "spell:cinder-sentinel-counterspell",
      revision: "1",
      rulesBasis: "srd5.1-2014",
      mechanicalKey: "counterspell",
      activation: { kind: "reactionSpell", spellLevel: "3" },
      costs: [{ kind: "spellSlot", level: "3", amount: "1" }],
      effect: { kind: "counterspell", rangeInches: "720" },
    },
  );
  return input;
}

function advanceToSentinel(scenario, authority, suffix) {
  for (const sourceEntityId of [ALICE_ID, BOB_ID, BRUTE_ID]) {
    const ended = requireKind(drive(scenario, {
      kind: "endTurn",
      rootActionId: `root:${suffix}:end:${sourceEntityId}`,
      sourceEntityId,
      encounterId: ENCOUNTER_ID,
    }, authority), "committed");
    scenario = ended.scenario;
  }
  assert.equal(encounterView(read(scenario, BOB_VIEWER)).activeEntityId, SENTINEL_ID);
  return scenario;
}

test("dynamic combat definitions fail closed before they can solidify invalid mechanics", () => {
  const invalidDefinitions = [
    {
      label: "ability score above the SRD 2014 creature bound",
      mutate(entity) { entity.mechanics.definition.content.stats.dex = "100"; },
    },
    {
      label: "current hit points above maximum",
      mutate(entity) { entity.initialState = { hitPointsCurrent: "31" }; },
    },
    {
      label: "authority-owned die faces hidden in the materialization",
      mutate(entity) { entity.faces = [20]; },
    },
    {
      label: "non-canonical damage formula",
      mutate(entity) {
        entity.mechanics.definition.content.intrinsicAbilities[0].damage[0].formula = "999999999d20";
      },
    },
    {
      label: "unsupported attack ability",
      mutate(entity) {
        entity.mechanics.definition.content.intrinsicAbilities[0].attack.ability = "luck";
      },
    },
  ];

  for (const fixture of invalidDefinitions) {
    const input = structuredClone(START_DYNAMIC_ENCOUNTER);
    fixture.mutate(input.dynamicEntities[0]);
    const scenario = startScenario();
    const stateBefore = structuredClone(scenario.state);
    const outcome = step(PROFILES, scenario.state, input);
    assert.equal(outcome.kind, "rejected", `${fixture.label}: ${JSON.stringify(outcome)}`);
    assert.deepEqual(outcome.events ?? [], [], fixture.label);
    assert.deepEqual(scenario.state, stateBefore, `${fixture.label} must not mutate the Rules input state`);
  }

  const invalidEncounters = [
    {
      label: "duplicate encounter participant",
      mutate(input) { input.participantEntityIds.push(ALICE_ID); },
    },
    {
      label: "participant missing from initiative",
      mutate(input) { input.initiativeGroups[2].combatantEntityIds.pop(); },
    },
    {
      label: "hostility refers to a non-participant",
      mutate(input) { input.hostilities[0].toEntityIds.push("enemy:forged"); },
    },
    {
      label: "ability definition id reused by two dynamic creatures",
      mutate(input) {
        input.dynamicEntities[1].mechanics.definition.content.intrinsicAbilities[0].definitionId =
          input.dynamicEntities[0].mechanics.definition.content.intrinsicAbilities[0].definitionId;
      },
    },
  ];
  for (const fixture of invalidEncounters) {
    const input = structuredClone(START_DYNAMIC_ENCOUNTER);
    fixture.mutate(input);
    const scenario = startScenario();
    const stateBefore = structuredClone(scenario.state);
    const outcome = step(PROFILES, scenario.state, input);
    assert.equal(outcome.kind, "rejected", `${fixture.label}: ${JSON.stringify(outcome)}`);
    assert.deepEqual(outcome.events ?? [], [], fixture.label);
    assert.deepEqual(scenario.state, stateBefore, `${fixture.label} must not mutate the Rules input state`);
  }
});

test("dynamic encounter solidification, 2014 initiative tie, and one Geometry profile determine path, cover, and area", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "attack:alice-longbow": [16],
    "damage:alice-longbow": [4],
    "save:shatter:enemy:cinder-sentinel": [4],
    "damage:spell:shatter": [0, 1, 2],
  }));
  let { scenario, events: openingEvents } = openEncounter(authority);

  assert.equal(eventsOfType(openingEvents, "InitiativeRequested").length, 3, "the enemy group rolls once");
  let view = read(scenario, ALICE_VIEWER);
  assert.deepEqual(
    encounterView(view).initiative.entries.map((entry) => ({
      entryId: entry.entryId,
      combatantEntityIds: entry.combatantEntityIds,
      total: entry.total,
    })),
    [
      { entryId: "initiative:alice", combatantEntityIds: [ALICE_ID], total: 12 },
      { entryId: "initiative:bob", combatantEntityIds: [BOB_ID], total: 12 },
      { entryId: "initiative:ash-enemies", combatantEntityIds: [BRUTE_ID, SENTINEL_ID], total: 10 },
    ],
  );

  const unsupported = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:alice-unknown-activation",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-unknown-activation",
    parameters: {},
  }, authority), "rejected");
  assert.equal(unsupported.result.rejection.code, "invalidRulesInput");
  assert.deepEqual(unsupported.events, []);

  const shot = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:alice-shoots-sentinel",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-longbow",
    parameters: { targetEntityId: SENTINEL_ID },
  }, authority), "committed");
  scenario = shot.scenario;
  assert.equal(shot.result.mechanicalResult.attack.mode, "disadvantage");
  assert.deepEqual(shot.result.mechanicalResult.attack.disadvantageReasons, [
    "hostileWithinFiveFeet2014",
    "longRange2014",
    "poisoned2014",
  ]);
  assert.equal(shot.result.mechanicalResult.attack.cover, "half");
  assert.equal(shot.result.mechanicalResult.attack.baseArmorClass, 15);
  assert.equal(shot.result.mechanicalResult.attack.effectiveArmorClass, 17);

  const moved = requireKind(opportunityDeclined(drive(scenario, {
    kind: "moveCombatant",
    rootActionId: "root:alice-moves-five-feet",
    encounterId: ENCOUNTER_ID,
    sourceEntityId: ALICE_ID,
    movementMode: "walk",
    path: [
      { x: "0", y: "0", elevation: "0" },
      { x: "-36", y: "48", elevation: "0" },
    ],
  }, authority), authority, BRUTE_ID, "response:brute-lets-alice-step-away"), "committed");
  scenario = moved.scenario;
  assertIncludesEventTypes(moved.events, ["MovementSegmentCommitted"]);
  view = read(scenario, ALICE_VIEWER);
  assert.deepEqual(combatEntity(view, ALICE_ID).position, { x: "-36", y: "48", elevation: "0" });
  assert.equal(combatEntity(view, ALICE_ID).movement.spentMilliInches, "60000");

  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:alice-ends-turn",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;

  const area = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:bob-casts-shatter",
    sourceEntityId: BOB_ID,
    abilityRef: "spell:shatter",
    parameters: { slotLevel: "2", areaOrigin: { x: "240", y: "0", elevation: "0" } },
  }, authority), "committed");
  assert.deepEqual(area.result.mechanicalResult.area, {
    origin: { x: "240", y: "0", elevation: "0" },
    shape: { kind: "sphere", radiusInches: "120", propagation: "straight" },
    affectedEntityIds: [SENTINEL_ID],
  });
  assertIncludesEventTypes(area.events, ["AbilityInvoked", "DamagePacketResolved"]);
});

test("action economy derives advantage/disadvantage and atomically spends spell and class resources through damage and concentration", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "check:shove:character:alice": [14],
    "check:shove:enemy:ash-brute": [9],
    "attack:alice-resonant-blade": [16],
    // SPEC 0012 §11 step 2: an attack's damage batch reserves the critical
    // die of every component, so the tape carries a pair per component and
    // a normal hit spends the first face of each pair.
    "damage:alice-resonant-blade": [4, 4, 3, 3, 2, 2],
    "healing:ability:restorative-touch": [2, 3],
    "attack:spell:fire-bolt": [17, 5],
    "damage:spell:fire-bolt": [6],
    "save:cinder-burst:character:alice": [7],
    "damage:ability:ash-brute-cinder-burst": [3, 3],
    "attack:ability:cinder-sentinel-bolt": [16],
    "damage:ability:cinder-sentinel-bolt": [5],
    "save:concentration:character:bob": [4],
  }));
  let { scenario } = openEncounter(authority);

  const shoved = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:alice-shoves-brute",
    sourceEntityId: ALICE_ID,
    abilityRef: "action:shove",
    parameters: { targetEntityId: BRUTE_ID, defenderContestAbility: "athletics" },
  }, authority), "committed");
  scenario = shoved.scenario;
  assert.equal(shoved.result.mechanicalResult.contest.winnerEntityId, ALICE_ID);
  assert.equal(combatEntity(read(scenario, ALICE_VIEWER), BRUTE_ID).conditions.prone, true);

  const blade = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:alice-strikes-prone-brute",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-resonant-blade",
    parameters: { targetEntityId: BRUTE_ID },
  }, authority), "committed");
  scenario = blade.scenario;
  assert.equal(blade.result.mechanicalResult.attack.mode, "normal", "one or more advantages and disadvantages cancel");
  assert.deepEqual(blade.result.mechanicalResult.attack.advantageReasons, ["targetProne2014"]);
  assert.deepEqual(blade.result.mechanicalResult.attack.disadvantageReasons, ["poisoned2014"]);
  assert.deepEqual(blade.result.mechanicalResult.damage.components, [
    { type: "slashing", rolled: 8, defense: "resistance", applied: 4 },
    { type: "poison", rolled: 4, defense: "immunity", applied: 0 },
    { type: "thunder", rolled: 3, defense: "vulnerability", applied: 6 },
  ]);
  assert.equal(blade.result.mechanicalResult.damage.totalApplied, 10);

  scenario = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:alice-action-surges",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:action-surge",
    parameters: {},
  }, authority), "committed").scenario;
  scenario = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:alice-restorative-touch",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:restorative-touch",
    parameters: { targetEntityId: ALICE_ID },
  }, authority), "committed").scenario;
  let alice = combatEntity(read(scenario, ALICE_VIEWER), ALICE_ID);
  assert.equal(alice.resources["resource:action-surge"].current, "0");
  assert.equal(alice.resources["resource:resonant-blade"].current, "0");
  assert.equal(alice.hitPoints.current, "16");

  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:alice-ends-after-surge",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  scenario = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:bob-casts-hex",
    sourceEntityId: BOB_ID,
    abilityRef: "spell:hex",
    parameters: { slotLevel: "1", targetEntityId: BRUTE_ID },
  }, authority), "committed").scenario;

  const illegalLeveledSpell = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:bob-illegal-second-leveled-spell",
    sourceEntityId: BOB_ID,
    abilityRef: "spell:magic-missile",
    parameters: { slotLevel: "1", targetEntityId: BRUTE_ID },
  }, authority), "rejected");
  assert.equal(illegalLeveledSpell.result.rejection.code, "bonusActionSpellRestriction2014");
  assert.deepEqual(illegalLeveledSpell.events, []);

  const cantrip = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:bob-fire-bolt-prone-brute",
    sourceEntityId: BOB_ID,
    abilityRef: "spell:fire-bolt",
    parameters: { targetEntityId: BRUTE_ID },
  }, authority), "committed");
  scenario = cantrip.scenario;
  // 2014: a ranged attack on a prone target within 5 feet has advantage, and a
  // ranged attack with a hostile within 5 feet has disadvantage; Bob stands
  // 5 feet from the prone brute, so the two cancel (SPEC 0012 §2.1).
  assert.equal(cantrip.result.mechanicalResult.attack.mode, "normal");
  assert.deepEqual(cantrip.result.mechanicalResult.attack.advantageReasons, ["targetProne2014"]);
  assert.deepEqual(cantrip.result.mechanicalResult.attack.disadvantageReasons, ["hostileWithinFiveFeet2014"]);
  assert.equal(combatEntity(read(scenario, BOB_VIEWER), BOB_ID).resources["spellSlot:1"].current, "1");

  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:bob-ends-turn",
    sourceEntityId: BOB_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  const savingThrow = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:brute-uses-cinder-burst",
    sourceEntityId: BRUTE_ID,
    abilityRef: "ability:ash-brute-cinder-burst",
    parameters: { areaOrigin: { x: "60", y: "0", elevation: "0" } },
  }, authority), "committed");
  scenario = savingThrow.scenario;
  assert.equal(savingThrow.result.mechanicalResult.saves[ALICE_ID].ability, "dex");
  assert.equal(savingThrow.result.mechanicalResult.saves[ALICE_ID].success, false);

  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:brute-ends-after-cinder-burst",
    sourceEntityId: BRUTE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;

  const concentrationHitOffered = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:sentinel-shoots-bob",
    sourceEntityId: SENTINEL_ID,
    abilityRef: "ability:cinder-sentinel-bolt",
    parameters: { targetEntityId: BOB_ID },
  }, authority), "awaitingInput");
  scenario = concentrationHitOffered.scenario;
  assert.equal(concentrationHitOffered.result.pending.reactionKind, "shield");
  assertIncludesEventTypes(concentrationHitOffered.events, ["AbilityInvoked", "ReactionOpportunityOpened"]);
  const concentrationHit = requireKind(answerPending(
    scenario,
    concentrationHitOffered.result.pending,
    { kind: "decline" },
    authority,
    "response:bob-declines-shield-before-concentration-save",
  ), "committed");
  scenario = concentrationHit.scenario;
  assertIncludesEventTypes(concentrationHit.events, ["DamagePacketResolved", "ConcentrationEnded"]);
  assert.equal(combatEntity(read(scenario, BOB_VIEWER), BOB_ID).concentration, null);
  assert.deepEqual(replayed(structuredClone(scenario.eventLog)).state, scenario.state);
});

test("B11 Extra Attack permits attack-move-retarget-attack but never turns one remaining attack into Cast a Spell", () => {
  {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
      "attack:alice-longbow": [18, 18],
      "damage:alice-longbow": [3, 4],
    }));
    const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
    encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID).placement.position = {
      x: "-60", y: "0", elevation: "0",
    };
    encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID).placement.position = {
      x: "0", y: "180", elevation: "0",
    };
    let { scenario } = openEncounterWithInput(authority, encounterInput);
    scenario = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: "root:b11-alice-first-attack",
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:alice-longbow",
      parameters: { targetEntityId: BRUTE_ID },
    }, authority), "committed").scenario;
    scenario = requireKind(opportunityDeclined(drive(scenario, {
      kind: "moveCombatant",
      rootActionId: "root:b11-alice-moves-between-attacks",
      encounterId: ENCOUNTER_ID,
      sourceEntityId: ALICE_ID,
      movementMode: "walk",
      path: [
        { x: "0", y: "0", elevation: "0" },
        { x: "0", y: "120", elevation: "0" },
      ],
    }, authority), authority, BRUTE_ID, "response:b11-brute-lets-alice-move"), "committed").scenario;
    const second = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: "root:b11-alice-retargets-second-attack",
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:alice-longbow",
      parameters: { targetEntityId: SENTINEL_ID },
    }, authority), "committed");
    assert.equal(eventsOfType(second.events, "DamagePacketResolved")[0].payload.targetEntityId, SENTINEL_ID);
    assert.equal(combatEntity(read(second.scenario, ALICE_VIEWER), ALICE_ID).turn.action, "0");
  }

  {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
      "attack:alice-longbow": [18],
      "damage:alice-longbow": [3],
    }));
    const initialState = structuredClone(INITIAL_STATE);
    initialState.entities[ALICE_ID].abilityRefs.push("spell:fire-bolt");
    initialState.entities[ALICE_ID].spellcasting = { ability: "int", spellAttackBonus: "2", spellSaveDc: "10" };
    const genesis = geometryGenesis(initialState, "b11-no-spell-for-remaining-attack");
    let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, genesis);
    scenario = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: "root:b11-alice-starts-attack-action",
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:alice-longbow",
      parameters: { targetEntityId: BRUTE_ID },
    }, authority), "committed").scenario;
    const leakedSpell = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: "root:b11-remaining-attack-is-not-cast-a-spell",
      sourceEntityId: ALICE_ID,
      abilityRef: "spell:fire-bolt",
      parameters: { targetEntityId: BRUTE_ID },
    }, authority), "rejected");
    assert.equal(leakedSpell.result.rejection.code, "invalidRulesInput");
    assert.deepEqual(leakedSpell.events, []);
  }
});

test("B12 haste creates one restricted action without refreshing bonus action, reaction, or Extra Attack", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "attack:alice-longbow": [18, 18, 18],
    "damage:alice-longbow": [3, 3, 3],
  }));
  const initialState = structuredClone(INITIAL_STATE);
  initialState.entities[ALICE_ID].conditions.hasted = true;
  const genesis = geometryGenesis(initialState, "b12-haste-grant");
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, genesis);
  let alice = combatEntity(read(scenario, ALICE_VIEWER), ALICE_ID);
  assert.equal(alice.turn.hasteAction, "1");
  assert.equal(alice.turn.bonusAction, "1");
  assert.equal(alice.turn.reaction, "1");

  for (const [index, targetEntityId] of [BRUTE_ID, SENTINEL_ID].entries()) {
    scenario = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: `root:b12-normal-extra-attack-${index}`,
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:alice-longbow",
      parameters: { targetEntityId },
    }, authority), "committed").scenario;
  }
  scenario = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:b12-one-haste-weapon-attack",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-longbow",
    parameters: { targetEntityId: BRUTE_ID, actionGrant: "haste" },
  }, authority), "committed").scenario;
  alice = combatEntity(read(scenario, ALICE_VIEWER), ALICE_ID);
  assert.equal(alice.turn.hasteAction, "0");
  assert.equal(alice.turn.bonusAction, "1");
  assert.equal(alice.turn.reaction, "1");

  const fourthAttack = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:b12-haste-does-not-grant-extra-attack",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-longbow",
    parameters: { targetEntityId: BRUTE_ID, actionGrant: "haste" },
  }, authority), "rejected");
  assert.deepEqual(fourthAttack.events, []);
});

test("B17 bonus-action spell limits work in both orders while Action Surge permits two action spells", () => {
  {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
      "damage:spell:magic-missile": [2],
    }));
    let { scenario } = openEncounter(authority);
    scenario = requireKind(drive(scenario, {
      kind: "endTurn",
      rootActionId: "root:b17-alice-yields-to-bob",
      sourceEntityId: ALICE_ID,
      encounterId: ENCOUNTER_ID,
    }, authority), "committed").scenario;
    scenario = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: "root:b17-bob-casts-action-level-spell-first",
      sourceEntityId: BOB_ID,
      abilityRef: "spell:magic-missile",
      parameters: { slotLevel: "1", targetEntityId: BRUTE_ID },
    }, authority), "committed").scenario;
    const reverseOrder = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: "root:b17-bob-cannot-add-bonus-level-spell",
      sourceEntityId: BOB_ID,
      abilityRef: "spell:hex",
      parameters: { slotLevel: "1", targetEntityId: BRUTE_ID },
    }, authority), "rejected");
    assert.equal(reverseOrder.result.rejection.code, "bonusActionSpellRestriction2014");
    assert.deepEqual(reverseOrder.events, []);
  }

  {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
      "damage:spell:magic-missile": [2],
      "save:shatter:enemy:cinder-sentinel": [2],
      "damage:spell:shatter": [1, 1, 1],
    }));
    const initialState = structuredClone(INITIAL_STATE);
    initialState.entities[BOB_ID].abilityRefs.push("ability:action-surge");
    initialState.entities[BOB_ID].resources["resource:action-surge"] = { current: "1", maximum: "1" };
    const genesis = geometryGenesis(initialState, "b17-action-surge-spells");
    let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, genesis);
    scenario = requireKind(drive(scenario, {
      kind: "endTurn",
      rootActionId: "root:b17-alice-yields-for-action-surge",
      sourceEntityId: ALICE_ID,
      encounterId: ENCOUNTER_ID,
    }, authority), "committed").scenario;
    scenario = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: "root:b17-bob-first-action-spell",
      sourceEntityId: BOB_ID,
      abilityRef: "spell:magic-missile",
      parameters: { slotLevel: "1", targetEntityId: BRUTE_ID },
    }, authority), "committed").scenario;
    scenario = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: "root:b17-bob-action-surges",
      sourceEntityId: BOB_ID,
      abilityRef: "ability:action-surge",
      parameters: {},
    }, authority), "committed").scenario;
    const secondSpell = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: "root:b17-bob-second-action-spell",
      sourceEntityId: BOB_ID,
      abilityRef: "spell:shatter",
      parameters: { slotLevel: "2", areaOrigin: { x: "240", y: "0", elevation: "0" } },
    }, authority), "committed");
    assertIncludesEventTypes(secondSpell.events, ["SpellCastingStarted", "SpellResolved"]);
  }
});

test("A06 player and KP choices stay pending; disconnect never auto-targets, passes, or changes deterministic reaction order", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "attack:opportunity:character:bob": [15],
    "damage:opportunity:character:bob": [3],
  }));
  let { scenario } = openEncounter(authority);

  const missingPlayerTarget = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:alice-attacks-without-target",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-longbow",
    parameters: {},
  }, authority), "awaitingInput");
  scenario = missingPlayerTarget.scenario;
  assert.deepEqual(missingPlayerTarget.result.pending, {
    pendingInputId: missingPlayerTarget.result.pending.pendingInputId,
    kind: "playerChoice",
    choiceKind: "target",
    controllerEntityId: ALICE_ID,
    candidateEntityIds: [BRUTE_ID, SENTINEL_ID],
    maximumTargetCount: 1,
  });
  assert.equal(missingPlayerTarget.result.pending.selectedEntityId, undefined);

  const beforeDisconnect = read(scenario, ALICE_VIEWER, { channel: "reconnect" });
  const drawsBeforeDisconnect = authority.newFulfillmentCount;
  const reconstructed = replayed(scenario.eventLog);
  const afterDisconnectScenario = { ...scenario, state: reconstructed.state, head: reconstructed.head };
  assert.deepEqual(read(afterDisconnectScenario, ALICE_VIEWER, { channel: "reconnect" }), beforeDisconnect);
  assert.equal(authority.newFulfillmentCount, drawsBeforeDisconnect);

  const forbiddenPass = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:disconnect-must-not-pass",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "rejected");
  assert.equal(forbiddenPass.result.rejection.code, "pendingInputUnresolved");
  assert.deepEqual(forbiddenPass.events, []);

  const selectedPlayerTarget = requireKind(answerPending(
    scenario,
    missingPlayerTarget.result.pending,
    { kind: "selectTarget", targetEntityId: SENTINEL_ID },
    authority,
    "response:alice-selects-target",
  ), "committed");
  assertIncludesEventTypes(selectedPlayerTarget.events, [
    "CombatPendingClosed",
    "RandomnessRequested",
    "AbilityInvoked",
  ]);
  scenario = selectedPlayerTarget.scenario;
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:alice-explicitly-ends-turn",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:bob-explicitly-ends-turn",
    sourceEntityId: BOB_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;

  const missingNpcTarget = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:brute-needs-kp-target",
    sourceEntityId: BRUTE_ID,
    abilityRef: "ability:ash-brute-maul",
    parameters: {},
  }, authority), "awaitingInput");
  scenario = missingNpcTarget.scenario;
  assert.deepEqual(missingNpcTarget.result.pending, {
    pendingInputId: missingNpcTarget.result.pending.pendingInputId,
    kind: "kpDecision",
    choiceKind: "target",
    controllerEntityId: BRUTE_ID,
    candidateEntityIds: [ALICE_ID, BOB_ID],
    maximumTargetCount: 1,
  });
  assert.equal(missingNpcTarget.result.pending.selectedEntityId, undefined, "no first/nearest/lowest-HP default");
  scenario = requireKind(answerPending(
    scenario,
    missingNpcTarget.result.pending,
    { kind: "cancel" },
    authority,
    "response:kp-cancels-maul",
  ), "committed").scenario;

  const movement = requireKind(drive(scenario, {
    kind: "moveCombatant",
    rootActionId: "root:brute-leaves-two-threatened-spaces",
    encounterId: ENCOUNTER_ID,
    sourceEntityId: BRUTE_ID,
    movementMode: "walk",
    path: [
      { x: "60", y: "0", elevation: "0" },
      { x: "180", y: "0", elevation: "0" },
      { x: "240", y: "60", elevation: "0" },
    ],
  }, authority), "awaitingInput");
  scenario = movement.scenario;
  assert.equal(movement.result.pending.choiceKind, "reaction");
  assert.equal(movement.result.pending.controllerEntityId, ALICE_ID);
  assert.deepEqual(movement.result.pending.candidateAbilityRefs, ["action:opportunity-attack"]);
  assert.deepEqual(
    scenario.state.combatRuntime.entities[BRUTE_ID].position,
    { x: "60", y: "0", elevation: "0" },
    "a reaction window must not persist the mover on the sentinel's occupied intermediate waypoint",
  );

  const aliceDeclines = requireKind(answerPending(
    scenario,
    movement.result.pending,
    { kind: "decline" },
    authority,
    "response:alice-declines-opportunity",
  ), "awaitingInput");
  scenario = aliceDeclines.scenario;
  assert.equal(aliceDeclines.result.pending.controllerEntityId, BOB_ID);
  assert.deepEqual(
    scenario.state.combatRuntime.entities[BRUTE_ID].position,
    { x: "60", y: "0", elevation: "0" },
  );

  const bobReacts = requireKind(answerPending(
    scenario,
    aliceDeclines.result.pending,
    { kind: "useReaction", abilityRef: "action:opportunity-attack", targetEntityId: BRUTE_ID },
    authority,
    "response:bob-opportunity-attack",
  ), "committed");
  assertIncludesEventTypes(bobReacts.events, ["ReactionAnswered", "MovementSegmentCommitted"]);
  assert.deepEqual(
    bobReacts.scenario.state.combatRuntime.entities[BRUTE_ID].position,
    { x: "240", y: "60", elevation: "0" },
  );
  const reactionAnswers = eventsOfType(
    [...movement.events, ...aliceDeclines.events, ...bobReacts.events],
    "ReactionAnswered",
  );
  assert.deepEqual(reactionAnswers.map((event) => event.payload.controllerEntityId), [ALICE_ID, BOB_ID]);

  const firstUsesAuthority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "attack:opportunity:character:alice": [15],
    "damage:opportunity:character:alice": [1],
  }));
  let firstUsesScenario = openEncounter(firstUsesAuthority).scenario;
  firstUsesScenario = requireKind(drive(firstUsesScenario, {
    kind: "endTurn",
    rootActionId: "root:alice-ends-before-first-reaction-use",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, firstUsesAuthority), "committed").scenario;
  firstUsesScenario = requireKind(drive(firstUsesScenario, {
    kind: "endTurn",
    rootActionId: "root:bob-ends-before-first-reaction-use",
    sourceEntityId: BOB_ID,
    encounterId: ENCOUNTER_ID,
  }, firstUsesAuthority), "committed").scenario;
  const firstReaction = requireKind(drive(firstUsesScenario, {
    kind: "moveCombatant",
    rootActionId: "root:brute-leaves-after-first-reaction-use",
    encounterId: ENCOUNTER_ID,
    sourceEntityId: BRUTE_ID,
    movementMode: "walk",
    path: [
      { x: "60", y: "0", elevation: "0" },
      { x: "240", y: "0", elevation: "0" },
    ],
  }, firstUsesAuthority), "awaitingInput");
  assert.equal(firstReaction.result.pending.controllerEntityId, ALICE_ID);
  const firstReactionUsed = requireKind(answerPending(
    firstReaction.scenario,
    firstReaction.result.pending,
    { kind: "useReaction", abilityRef: "action:opportunity-attack", targetEntityId: BRUTE_ID },
    firstUsesAuthority,
    "response:alice-uses-first-opportunity",
  ), "awaitingInput");
  assert.equal(firstReactionUsed.result.pending.controllerEntityId, BOB_ID);
  assert.equal(eventsOfType(firstReactionUsed.events, "MovementSegmentCommitted").length, 0);
  const secondReactionDeclined = requireKind(answerPending(
    firstReactionUsed.scenario,
    firstReactionUsed.result.pending,
    { kind: "decline" },
    firstUsesAuthority,
    "response:bob-declines-second-opportunity",
  ), "committed");
  assert.deepEqual(
    secondReactionDeclined.scenario.state.combatRuntime.entities[BRUTE_ID].position,
    { x: "240", y: "0", elevation: "0" },
  );
});

test("movement after a reaction is not precommitted and an incapacitating reaction cancels the unpassed path", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "attack:opportunity:character:alice": [19],
    "damage:opportunity:character:alice": [5],
  }));
  const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
  const brute = encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID);
  brute.mechanics.definition.content.hitPointsMaximum = "1";
  let { scenario } = openEncounterWithInput(authority, encounterInput);
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:alice-ends-before-lethal-opportunity",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:bob-ends-before-lethal-opportunity",
    sourceEntityId: BOB_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;

  const offered = requireKind(drive(scenario, {
    kind: "moveCombatant",
    rootActionId: "root:brute-path-pauses-before-opportunity",
    encounterId: ENCOUNTER_ID,
    sourceEntityId: BRUTE_ID,
    movementMode: "walk",
    path: [
      { x: "60", y: "0", elevation: "0" },
      { x: "240", y: "0", elevation: "0" },
    ],
  }, authority), "awaitingInput");
  scenario = offered.scenario;
  assert.equal(eventsOfType(offered.events, "MovementSegmentCommitted").length, 0);
  assert.deepEqual(combatEntity(read(scenario, ALICE_VIEWER), BRUTE_ID).position, { x: "60", y: "0", elevation: "0" });

  const stopped = requireKind(answerPending(
    scenario,
    offered.result.pending,
    { kind: "useReaction", abilityRef: "action:opportunity-attack", targetEntityId: BRUTE_ID },
    authority,
    "response:alice-stops-brute-before-unpassed-path",
  ), "committed");
  assert.equal(eventsOfType(stopped.events, "MovementSegmentCommitted").length, 0);
  const finalBrute = combatEntity(read(stopped.scenario, ALICE_VIEWER), BRUTE_ID);
  assert.equal(finalBrute.lifeState, "dead");
  assert.deepEqual(finalBrute.position, { x: "60", y: "0", elevation: "0" });
});

test("Geometry G14 commits only a passed movement prefix when a readied grapple reduces speed to zero", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "check:grapple:character:bob": [19],
    "check:grapple:enemy:ash-brute": [0],
  }));
  const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
  encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID).placement.position = {
    x: "0", y: "0", elevation: "0",
  };
  encounterInput.dynamicEntities.find(({ entityId }) => entityId === SENTINEL_ID).placement.position = {
    x: "360", y: "0", elevation: "0",
  };
  const initialState = structuredClone(INITIAL_STATE);
  initialState.entities[ALICE_ID].position = { x: "-120", y: "0", elevation: "0" };
  const genesis = geometryGenesis(initialState, "g14-segmented-ready-grapple");
  let { scenario } = openEncounterWithInput(authority, encounterInput, genesis);

  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:g14-alice-yields-to-bob",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  const readied = requireKind(drive(scenario, {
    kind: "readyAction",
    rootActionId: "root:g14-bob-readies-grapple",
    encounterId: ENCOUNTER_ID,
    sourceEntityId: BOB_ID,
    trigger: { kind: "perceivable", event: "movementCommitted", sourceEntityId: BRUTE_ID },
    response: {
      kind: "invokeAbility",
      abilityRef: "action:grapple",
      parameters: { targetEntityId: BRUTE_ID, defenderContestAbility: "acrobatics" },
    },
  }, authority), "committed");
  scenario = readied.scenario;
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:g14-bob-yields-after-ready",
    sourceEntityId: BOB_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;

  const start = { x: "0", y: "0", elevation: "0" };
  const passedPrefix = { x: "0", y: "60", elevation: "0" };
  const unpassedEndpoint = { x: "0", y: "-60", elevation: "0" };
  const offered = requireKind(drive(scenario, {
    kind: "moveCombatant",
    rootActionId: "root:g14-brute-multisegment-move",
    encounterId: ENCOUNTER_ID,
    sourceEntityId: BRUTE_ID,
    movementMode: "walk",
    path: [start, passedPrefix, unpassedEndpoint],
  }, authority), "awaitingInput");
  scenario = offered.scenario;
  assert.equal(offered.result.pending.reactionKind, "ready");
  assert.equal(offered.result.pending.controllerEntityId, BOB_ID);
  assert.deepEqual(offered.result.pending.candidateAbilityRefs, ["action:grapple"]);
  const prefixEvents = eventsOfType(offered.events, "MovementSegmentCommitted");
  assert.equal(prefixEvents.length, 1);
  assert.deepEqual(prefixEvents[0].payload.path, [start, passedPrefix]);
  assert.equal(prefixEvents[0].payload.distanceMilliInches, "60000");
  assert.deepEqual(combatEntity(read(scenario, ALICE_VIEWER), BRUTE_ID).position, passedPrefix);
  assert.equal(scenario.state.combatRuntime.entities[BRUTE_ID].movement.spentMilliInches, "60000");
  assert.deepEqual(
    project(PROFILES, replayed(scenario.eventLog, genesis).state, ALICE_VIEWER, { channel: "reconnect" }),
    project(PROFILES, scenario.state, ALICE_VIEWER, { channel: "realtime" }),
  );

  const grappled = requireKind(answerPending(
    scenario,
    offered.result.pending,
    { kind: "useReaction" },
    authority,
    "response:g14-bob-grapples-moving-brute",
  ), "committed");
  scenario = grappled.scenario;
  assertIncludesEventTypes(grappled.events, [
    "ReactionAnswered",
    "ReadiedActionExpired",
    "AbilityInvoked",
    "ConditionChanged",
  ]);
  assert.equal(eventsOfType(grappled.events, "MovementSegmentCommitted").length, 0);
  const finalBrute = combatEntity(read(scenario, ALICE_VIEWER), BRUTE_ID);
  assert.equal(finalBrute.conditions.grappledBy, BOB_ID);
  assert.deepEqual(finalBrute.position, passedPrefix);
  assert.equal(scenario.state.combatRuntime.entities[BRUTE_ID].movement.spentMilliInches, "60000");
  const finalBob = combatEntity(read(scenario, BOB_VIEWER), BOB_ID);
  assert.equal(finalBob.turn.action, "0", "the readied grapple does not consume a second normal action");
  assert.equal(finalBob.turn.reaction, "0");

  const rebuilt = replayed(scenario.eventLog, genesis);
  assert.deepEqual(rebuilt.state, scenario.state);
  assert.deepEqual(
    combatEntity(project(PROFILES, rebuilt.state, ALICE_VIEWER, { channel: "history" }), BRUTE_ID).position,
    passedPrefix,
  );

  const oneInchAfterGrapple = drive(scenario, {
    kind: "moveCombatant",
    rootActionId: "root:g14-brute-cannot-move-after-grapple",
    encounterId: ENCOUNTER_ID,
    sourceEntityId: BRUTE_ID,
    movementMode: "walk",
    path: [passedPrefix, { x: "0", y: "59", elevation: "0" }],
  }, authority);
  assert.equal(oneInchAfterGrapple.result.kind, "rejected");
  assert.equal(oneInchAfterGrapple.result.rejection.code, "invalidRulesInput");
  assert.deepEqual(oneInchAfterGrapple.events, []);
});

test("creature targets are frozen from hostility and Geometry range before any authority draw", () => {
  const directAuthority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  const directScenario = openEncounter(directAuthority).scenario;
  const drawsBeforeIllegalTarget = directAuthority.newFulfillmentCount;
  const outOfReach = requireKind(drive(directScenario, {
    kind: "invokeAbility",
    rootActionId: "root:alice-cannot-blade-distant-sentinel",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-resonant-blade",
    parameters: { targetEntityId: SENTINEL_ID },
  }, directAuthority), "rejected");
  assert.equal(outOfReach.result.rejection.code, "privateOrUnknownReference");
  assert.deepEqual(outOfReach.events, []);
  assert.equal(
    directAuthority.newFulfillmentCount,
    drawsBeforeIllegalTarget,
    "an illegal target must not consume an action, resource, or random face",
  );

  const pendingAuthority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  const pendingScenario = openEncounter(pendingAuthority).scenario;
  const targetChoice = requireKind(drive(pendingScenario, {
    kind: "invokeAbility",
    rootActionId: "root:alice-chooses-reachable-blade-target",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-resonant-blade",
    parameters: {},
  }, pendingAuthority), "awaitingInput");
  assert.deepEqual(targetChoice.result.pending.candidateEntityIds, [BRUTE_ID]);
});

test("damage, death saves, non-combat hazards, six-second rounds, encounter conclusion, and replay share one deterministic event chain", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "attack:ability:ash-brute-maul": [17, 17],
    "damage:ability:ash-brute-maul": [5, 5, 2, 2],
    "death-save:character:alice": [0],
    "save:hazard:falling-beam:character:bob": [5],
    "damage:hazard:falling-beam": [3, 4],
  }));
  let { scenario } = openEncounter(authority);
  const initialTime = read(scenario, ALICE_VIEWER).fictionTime.nowMicros;
  assert.equal(initialTime, "0");

  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:alice-holds-position",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:bob-holds-position",
    sourceEntityId: BOB_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;

  const downedChoice = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:brute-downs-alice",
    sourceEntityId: BRUTE_ID,
    abilityRef: "ability:ash-brute-maul",
    parameters: { targetEntityId: ALICE_ID },
  }, authority), "awaitingInput");
  assert.deepEqual(downedChoice.result.pending, {
    pendingInputId: downedChoice.result.pending.pendingInputId,
    kind: "kpDecision",
    choiceKind: "knockOut",
    controllerEntityId: BRUTE_ID,
    targetEntityId: ALICE_ID,
  });
  assert.equal(eventsOfType(downedChoice.events, "DamagePacketResolved").length, 0);
  const downed = requireKind(answerPending(
    downedChoice.scenario,
    downedChoice.result.pending,
    { kind: "dealLethalDamage" },
    authority,
    "response:brute-deals-lethal-damage-to-alice",
  ), "committed");
  scenario = downed.scenario;
  let alice = combatEntity(read(scenario, ALICE_VIEWER), ALICE_ID);
  assert.equal(alice.hitPoints.current, "0");
  assert.equal(alice.conditions.unconscious, true);
  assert.equal(alice.conditions.prone, true);

  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:brute-ends-round-one",
    sourceEntityId: BRUTE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  const sentinelEnds = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:sentinel-ends-round-one",
    sourceEntityId: SENTINEL_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed");
  scenario = sentinelEnds.scenario;
  assertIncludesEventTypes(sentinelEnds.events, ["RoundEnded", "RoundStarted", "DeathSaveResolved"]);
  assert.equal(read(scenario, BOB_VIEWER).fictionTime.nowMicros, "6000000");
  alice = combatEntity(read(scenario, ALICE_VIEWER), ALICE_ID);
  assert.deepEqual(alice.deathSaves, { successes: 0, failures: 2 });

  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:alice-ends-after-death-save",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:bob-ends-round-two-turn",
    sourceEntityId: BOB_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  const fatalHit = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:brute-hits-unconscious-alice",
    sourceEntityId: BRUTE_ID,
    abilityRef: "ability:ash-brute-maul",
    parameters: { targetEntityId: ALICE_ID },
  }, authority), "committed");
  scenario = fatalHit.scenario;
  assertIncludesEventTypes(fatalHit.events, ["DamagePacketResolved", "CreatureDied"]);
  assert.equal(combatEntity(read(scenario, BOB_VIEWER), ALICE_ID).lifeState, "dead");

  const surrender = requireKind(drive(scenario, {
    kind: "proposeEncounterConclusion",
    rootActionId: "root:ash-enemies-surrender",
    encounterId: ENCOUNTER_ID,
    proposal: { reason: "npcSurrendered", npcEntityIds: [BRUTE_ID, SENTINEL_ID] },
  }, authority), "awaitingInput");
  scenario = surrender.scenario;
  assert.equal(surrender.result.pending.controllerEntityId, BOB_ID);
  const concluded = requireKind(answerPending(
    scenario,
    surrender.result.pending,
    { kind: "acceptEncounterConclusion" },
    authority,
    "response:bob-accepts-surrender",
  ), "committed");
  scenario = concluded.scenario;
  assertIncludesEventTypes(concluded.events, ["EncounterConcluded"]);
  let view = read(scenario, BOB_VIEWER);
  assert.equal(encounterView(view).status, "concluded");
  assert.equal(view.story.status, "active", "ending an Encounter is not a story conclusion");
  assert.equal(view.fictionTime.nowMicros, "12000000", "the interrupted second round closes exactly once");

  const hazard = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:beam-falls-after-combat",
    sourceEntityId: "environment:burning-mill",
    abilityRef: "hazard:falling-beam",
    parameters: { targetEntityId: BOB_ID },
  }, authority), "committed");
  scenario = hazard.scenario;
  const hazardDamage = eventsOfType(hazard.events, "DamagePacketResolved");
  assert.equal(hazardDamage.length, 1);
  assert.equal(hazardDamage[0].payload.encounterId, null);
  assert.equal(hazardDamage[0].payload.pipelineProfileId, "damage-death-srd51-2014-v1");

  const fulfillmentsBeforeReplay = authority.newFulfillmentCount;
  const firstReplay = replayed(scenario.eventLog);
  const secondReplay = replayed(structuredClone(scenario.eventLog));
  assert.deepEqual(secondReplay.state, firstReplay.state);
  assert.deepEqual(secondReplay.head, firstReplay.head);
  assert.equal(authority.newFulfillmentCount, fulfillmentsBeforeReplay, "replay never asks the authority to reroll");
  assert.deepEqual(
    project(PROFILES, firstReplay.state, BOB_VIEWER, { channel: "reconnect" }),
    project(PROFILES, secondReplay.state, BOB_VIEWER, { channel: "history" }),
  );
});

test("B30 records each living player's truce choice and keeps the same Encounter active after a rejection", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  let { scenario } = openEncounter(authority);

  const proposed = requireKind(drive(scenario, {
    kind: "proposeEncounterConclusion",
    rootActionId: "root:ash-enemies-offer-truce",
    encounterId: ENCOUNTER_ID,
    proposal: {
      reason: "truceOffered",
      npcEntityIds: [BRUTE_ID, SENTINEL_ID],
      factRefs: ["fact:ash-enemies-lowered-weapons"],
    },
  }, authority), "awaitingInput");
  scenario = proposed.scenario;
  assert.equal(proposed.result.pending.controllerEntityId, ALICE_ID);
  assert.notEqual(encounterView(read(scenario, ALICE_VIEWER)).status, "concluded");

  const aliceAccepted = requireKind(answerPending(
    scenario,
    proposed.result.pending,
    { kind: "acceptEncounterConclusion" },
    authority,
    "response:alice-accepts-truce",
  ), "awaitingInput");
  scenario = aliceAccepted.scenario;
  assert.equal(aliceAccepted.result.pending.controllerEntityId, BOB_ID);
  assert.equal(eventsOfType(aliceAccepted.events, "EncounterConcluded").length, 0);
  assert.notEqual(encounterView(read(scenario, ALICE_VIEWER)).status, "concluded");
  assert.equal(
    read(scenario, ALICE_VIEWER).pendingInputs.some(({ choiceKind }) =>
      choiceKind === "encounterConclusion"),
    false,
    "Alice cannot answer Bob's independent choice",
  );
  assert.equal(
    read(scenario, BOB_VIEWER).pendingInputs.some(({ pendingInputId }) =>
      pendingInputId === aliceAccepted.result.pending.pendingInputId),
    true,
  );

  const bobRejected = requireKind(answerPending(
    scenario,
    aliceAccepted.result.pending,
    { kind: "rejectEncounterConclusion" },
    authority,
    "response:bob-rejects-truce",
  ), "committed");
  scenario = bobRejected.scenario;
  assertIncludesEventTypes(bobRejected.events, ["ReactionAnswered", "CombatPendingClosed"]);
  assert.equal(eventsOfType(bobRejected.events, "EncounterConcluded").length, 0);
  assert.notEqual(encounterView(read(scenario, BOB_VIEWER)).status, "concluded");
  assert.equal(read(scenario, BOB_VIEWER).pendingInputs.length, 0);
  assert.deepEqual(
    eventsOfType(scenario.eventLog, "ReactionAnswered")
      .filter(({ rootActionId }) => rootActionId === "root:ash-enemies-offer-truce")
      .map(({ payload }) => ({
        controllerEntityId: payload.controllerEntityId,
        choice: payload.answer.kind,
      })),
    [
      { controllerEntityId: ALICE_ID, choice: "acceptEncounterConclusion" },
      { controllerEntityId: BOB_ID, choice: "rejectEncounterConclusion" },
    ],
  );

  const rebuiltAfterRejection = replayed(structuredClone(scenario.eventLog));
  assert.deepEqual(rebuiltAfterRejection.state, scenario.state);
  assert.deepEqual(
    project(PROFILES, rebuiltAfterRejection.state, BOB_VIEWER, { channel: "history" }),
    project(PROFILES, scenario.state, BOB_VIEWER, { channel: "realtime" }),
  );

  const continued = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:alice-continues-after-rejected-truce",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed");
  assertIncludesEventTypes(continued.events, ["TurnEnded", "TurnStarted"]);
  assert.notEqual(encounterView(read(continued.scenario, BOB_VIEWER)).status, "concluded");
});

test("B29 concludes a surrender only after every living player accepts and preserves lasting combat facts", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  let { scenario } = openEncounter(authority);
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:alice-yields-the-floor-before-surrender",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  scenario = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:bob-hexes-before-surrender",
    sourceEntityId: BOB_ID,
    abilityRef: "spell:hex",
    parameters: { slotLevel: "1", targetEntityId: BRUTE_ID },
  }, authority), "committed").scenario;

  const beforeConclusion = read(scenario, BOB_VIEWER);
  const beforeAlice = structuredClone(combatEntity(beforeConclusion, ALICE_ID));
  const beforeBob = structuredClone(combatEntity(beforeConclusion, BOB_ID));
  assert.equal(beforeBob.resources["spellSlot:1"].current, "1");
  assert.ok(beforeBob.concentration);

  const proposed = requireKind(drive(scenario, {
    kind: "proposeEncounterConclusion",
    rootActionId: "root:both-players-consider-surrender",
    encounterId: ENCOUNTER_ID,
    proposal: {
      reason: "npcSurrendered",
      npcEntityIds: [BRUTE_ID, SENTINEL_ID],
      factRefs: ["fact:ash-enemies-surrendered"],
    },
  }, authority), "awaitingInput");
  scenario = proposed.scenario;
  assert.equal(proposed.result.pending.controllerEntityId, ALICE_ID);

  const aliceAccepted = requireKind(answerPending(
    scenario,
    proposed.result.pending,
    { kind: "acceptEncounterConclusion" },
    authority,
    "response:alice-accepts-surrender",
  ), "awaitingInput");
  scenario = aliceAccepted.scenario;
  assert.equal(aliceAccepted.result.pending.controllerEntityId, BOB_ID);
  assertIncludesEventTypes(aliceAccepted.events, ["ReactionAnswered", "CombatPendingOpened"]);
  assert.equal(eventsOfType(aliceAccepted.events, "EncounterConcluded").length, 0);

  const bobAccepted = requireKind(answerPending(
    scenario,
    aliceAccepted.result.pending,
    { kind: "acceptEncounterConclusion" },
    authority,
    "response:bob-accepts-surrender",
  ), "committed");
  scenario = bobAccepted.scenario;
  assertIncludesEventTypes(bobAccepted.events, ["ReactionAnswered", "EncounterConcluded"]);
  assert.equal(eventsOfType(bobAccepted.events, "EncounterConcluded").length, 1);
  assert.deepEqual(
    eventsOfType(scenario.eventLog, "ReactionAnswered")
      .filter(({ rootActionId }) => rootActionId === "root:both-players-consider-surrender")
      .map(({ payload }) => payload.controllerEntityId),
    [ALICE_ID, BOB_ID],
  );

  const afterConclusion = read(scenario, BOB_VIEWER);
  assert.equal(encounterView(afterConclusion).status, "concluded");
  assert.equal(afterConclusion.story.status, "active");
  for (const key of ["hitPoints", "resources", "position", "conditions"]) {
    assert.deepEqual(combatEntity(afterConclusion, ALICE_ID)[key], beforeAlice[key]);
    assert.deepEqual(combatEntity(afterConclusion, BOB_ID)[key], beforeBob[key]);
  }
  assert.deepEqual(combatEntity(afterConclusion, BOB_ID).concentration, beforeBob.concentration);

  const rebuilt = replayed(structuredClone(scenario.eventLog));
  assert.deepEqual(rebuilt.state, scenario.state);
  assert.deepEqual(
    project(PROFILES, rebuilt.state, BOB_VIEWER, { channel: "history" }),
    project(PROFILES, scenario.state, BOB_VIEWER, { channel: "realtime" }),
  );
});

test("B29 concludes a completed escape only from a matching authoritative fact and keeps its lasting state", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  let { scenario } = openEncounter(authority);
  const escapeFactId = "fact:burning-mill-escape-completed";

  const unsupported = requireKind(drive(scenario, {
    kind: "proposeEncounterConclusion",
    rootActionId: "root:unsupported-escape-conclusion",
    encounterId: ENCOUNTER_ID,
    proposal: {
      reason: "playersEscaped",
      escapedEntityIds: [ALICE_ID, BOB_ID],
      factRefs: [escapeFactId],
    },
  }, authority), "rejected");
  assert.equal(unsupported.result.rejection.code, "privateOrUnknownReference");
  assert.deepEqual(unsupported.events, []);

  scenario = requireKind(drive(scenario, {
    kind: "declareCanonicalFact",
    proposalId: "proposal:burning-mill-escape-completed",
    fact: {
      factId: escapeFactId,
      factKind: "encounterEscapeCompleted",
      subjectRefs: [ALICE_ID, BOB_ID],
      value: { encounterId: ENCOUNTER_ID },
      visibilityPolicy: "public",
      source: "mechanicalResolution",
      causalParentIds: [],
    },
  }, authority), "committed").scenario;
  const before = read(scenario, ALICE_VIEWER);
  const lastingBefore = Object.fromEntries([ALICE_ID, BOB_ID].map((id) => {
    const entity = combatEntity(before, id);
    return [id, structuredClone({
      hitPoints: entity.hitPoints,
      resources: entity.resources,
      position: entity.position,
      conditions: entity.conditions,
    })];
  }));

  let proposed = requireKind(drive(scenario, {
    kind: "proposeEncounterConclusion",
    rootActionId: "root:fact-backed-escape-conclusion",
    encounterId: ENCOUNTER_ID,
    proposal: {
      reason: "playersEscaped",
      escapedEntityIds: [ALICE_ID, BOB_ID],
      factRefs: [escapeFactId],
    },
  }, authority), "awaitingInput");
  scenario = proposed.scenario;
  for (const [index, responseId] of [
    "response:alice-confirms-completed-escape",
    "response:bob-confirms-completed-escape",
  ].entries()) {
    const answered = requireKind(answerPending(
      scenario,
      proposed.result.pending,
      { kind: "acceptEncounterConclusion" },
      authority,
      responseId,
    ), index === 0 ? "awaitingInput" : "committed");
    scenario = answered.scenario;
    proposed = answered;
  }

  const after = read(scenario, ALICE_VIEWER);
  assert.equal(encounterView(after).status, "concluded");
  for (const id of [ALICE_ID, BOB_ID]) {
    const entity = combatEntity(after, id);
    assert.deepEqual({
      hitPoints: entity.hitPoints,
      resources: entity.resources,
      position: entity.position,
      conditions: entity.conditions,
    }, lastingBefore[id]);
  }
  const rebuilt = replayed(structuredClone(scenario.eventLog));
  assert.deepEqual(rebuilt.state, scenario.state);
  assert.deepEqual(
    project(PROFILES, rebuilt.state, ALICE_VIEWER, { channel: "history" }),
    project(PROFILES, scenario.state, ALICE_VIEWER, { channel: "realtime" }),
  );
});

test("B29 never concludes through an unresolved combat choice or authoritative randomness", () => {
  {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
    const { scenario } = openEncounter(authority);
    const targetChoice = requireKind(drive(scenario, {
      kind: "invokeAbility",
      rootActionId: "root:alice-target-choice-before-conclusion",
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:alice-resonant-blade",
      parameters: {},
    }, authority), "awaitingInput");
    const blocked = step(PROFILES, targetChoice.scenario.state, {
      kind: "proposeEncounterConclusion",
      rootActionId: "root:conclusion-cannot-bypass-target-choice",
      encounterId: ENCOUNTER_ID,
      proposal: { reason: "npcSurrendered" },
    });
    assert.equal(blocked.kind, "rejected");
    assert.equal(blocked.rejection.code, "pendingInputUnresolved");
    assert.deepEqual(blocked.events, []);
    assert.deepEqual(replayed(targetChoice.scenario.eventLog).state, targetChoice.scenario.state);
  }

  {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
    const { scenario } = openEncounter(authority);
    const randomnessInput = {
      kind: "invokeAbility",
      rootActionId: "root:alice-attack-randomness-before-conclusion",
      sourceEntityId: ALICE_ID,
      abilityRef: "ability:alice-resonant-blade",
      parameters: { targetEntityId: BRUTE_ID },
    };
    assertOrdinaryRulesInput(randomnessInput);
    const waiting = step(PROFILES, scenario.state, randomnessInput);
    assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
    const waitingScenario = appendReturnedEvents(scenario, waiting);
    const blocked = step(PROFILES, waitingScenario.state, {
      kind: "proposeEncounterConclusion",
      rootActionId: "root:conclusion-cannot-bypass-randomness",
      encounterId: ENCOUNTER_ID,
      proposal: { reason: "npcSurrendered" },
    });
    assert.equal(blocked.kind, "rejected");
    assert.equal(blocked.rejection.code, "pendingInputUnresolved");
    assert.deepEqual(blocked.events, []);
    assert.deepEqual(replayed(waitingScenario.eventLog).state, waitingScenario.state);
  }
});

test("Ready freezes a perceptible trigger, requires explicit use or decline, and never refunds a held spell", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  let { scenario } = openEncounter(authority);

  const readiedMove = requireKind(drive(scenario, {
    kind: "readyAction",
    rootActionId: "root:alice-readies-step-back",
    encounterId: ENCOUNTER_ID,
    sourceEntityId: ALICE_ID,
    trigger: { kind: "perceivable", event: "turnStarted", sourceEntityId: BRUTE_ID },
    response: {
      kind: "move",
      movementMode: "walk",
      path: [
        { x: "0", y: "0", elevation: "0" },
        { x: "-60", y: "0", elevation: "0" },
      ],
    },
  }, authority), "committed");
  scenario = readiedMove.scenario;
  assertIncludesEventTypes(readiedMove.events, ["ReadiedActionCreated"]);
  assert.equal(combatEntity(read(scenario, ALICE_VIEWER), ALICE_ID).turn.action, "0");

  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:alice-ends-after-ready",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  const trigger = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:bob-opens-alice-ready-trigger",
    sourceEntityId: BOB_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "awaitingInput");
  scenario = trigger.scenario;
  assertIncludesEventTypes(trigger.events, ["TurnStarted", "ReactionOpportunityOpened"]);
  assert.equal(trigger.result.pending.controllerEntityId, ALICE_ID);
  assert.equal(trigger.result.pending.reactionKind, "ready");
  assert.equal(read(scenario, ALICE_VIEWER).pendingInputs.some(
    ({ pendingInputId }) => pendingInputId === trigger.result.pending.pendingInputId,
  ), true);
  assert.equal(read(scenario, BOB_VIEWER).pendingInputs.some(
    ({ pendingInputId }) => pendingInputId === trigger.result.pending.pendingInputId,
  ), false, "a readied response remains private to its controller");

  const afterReconnect = replayed(scenario.eventLog);
  assert.deepEqual(
    project(PROFILES, afterReconnect.state, ALICE_VIEWER, { channel: "reconnect" }),
    project(PROFILES, scenario.state, ALICE_VIEWER, { channel: "realtime" }),
  );
  const used = requireKind(answerPending(
    scenario,
    trigger.result.pending,
    { kind: "useReaction" },
    authority,
    "response:alice-uses-readied-step",
  ), "committed");
  scenario = used.scenario;
  assertIncludesEventTypes(used.events, ["ReactionAnswered", "ReadiedActionExpired", "MovementSegmentCommitted"]);
  assert.deepEqual(combatEntity(read(scenario, ALICE_VIEWER), ALICE_ID).position, {
    x: "-60", y: "0", elevation: "0",
  });
  assert.equal(combatEntity(read(scenario, ALICE_VIEWER), ALICE_ID).turn.reaction, "0");

  const spellAuthority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  ({ scenario } = openEncounter(spellAuthority));
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:alice-yields-for-readied-spell",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, spellAuthority), "committed").scenario;
  const held = requireKind(drive(scenario, {
    kind: "readyAction",
    rootActionId: "root:bob-readies-shatter",
    encounterId: ENCOUNTER_ID,
    sourceEntityId: BOB_ID,
    trigger: { kind: "perceivable", event: "movementCommitted", sourceEntityId: SENTINEL_ID },
    response: {
      kind: "invokeAbility",
      abilityRef: "spell:shatter",
      parameters: { slotLevel: "2", areaOrigin: { x: "240", y: "0", elevation: "0" } },
    },
  }, spellAuthority), "committed");
  scenario = held.scenario;
  assertIncludesEventTypes(held.events, ["SpellCastingStarted", "ReadiedActionCreated", "ConcentrationStarted"]);
  let bob = combatEntity(read(scenario, BOB_VIEWER), BOB_ID);
  assert.equal(bob.resources["spellSlot:2"].current, "0", "the readied spell slot is spent immediately");
  assert.equal(bob.concentration.kind, "readiedSpell");

  for (const sourceEntityId of [BOB_ID, BRUTE_ID, SENTINEL_ID, ALICE_ID]) {
    const expired = requireKind(drive(scenario, {
      kind: "endTurn",
      rootActionId: `root:expire-readied-spell:${sourceEntityId}`,
      sourceEntityId,
      encounterId: ENCOUNTER_ID,
    }, spellAuthority), "committed");
    scenario = expired.scenario;
    if (sourceEntityId === ALICE_ID) {
      assertIncludesEventTypes(expired.events, ["ReadiedActionExpired", "ConcentrationEnded", "TurnStarted"]);
    }
  }
  bob = combatEntity(read(scenario, BOB_VIEWER), BOB_ID);
  assert.equal(bob.concentration, null);
  assert.equal(bob.resources["spellSlot:2"].current, "0", "expiry does not refund the committed slot");
});

test("Shield opens only after a hit and before damage, is controller-private, and shares one effective AC until next turn", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "attack:ability:cinder-sentinel-bolt": [11],
    "damage:ability:cinder-sentinel-bolt": [7],
  }));
  let { scenario } = openEncounter(authority);
  scenario = advanceToSentinel(scenario, authority, "shield");

  const hit = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:sentinel-hits-bob-before-shield",
    sourceEntityId: SENTINEL_ID,
    abilityRef: "ability:cinder-sentinel-bolt",
    parameters: { targetEntityId: BOB_ID },
  }, authority), "awaitingInput");
  scenario = hit.scenario;
  assert.equal(hit.result.pending.reactionKind, "shield");
  assert.equal(hit.result.pending.controllerEntityId, BOB_ID);
  assert.equal(
    authority.observedRequests.some(({ purposeKey }) => purposeKey === "damage:ability:cinder-sentinel-bolt"),
    true,
    "damage entropy is reserved before the Shield window without applying damage",
  );
  assert.equal(read(scenario, BOB_VIEWER).pendingInputs.some(
    ({ pendingInputId }) => pendingInputId === hit.result.pending.pendingInputId,
  ), true);
  assert.equal(read(scenario, ALICE_VIEWER).pendingInputs.some(
    ({ pendingInputId }) => pendingInputId === hit.result.pending.pendingInputId,
  ), false);

  const shielded = requireKind(answerPending(
    scenario,
    hit.result.pending,
    { kind: "useReaction", abilityRef: "spell:shield", slotLevel: "1" },
    authority,
    "response:bob-casts-shield",
  ), "committed");
  scenario = shielded.scenario;
  assertIncludesEventTypes(shielded.events, ["SpellCastingStarted", "EffectApplied", "SpellResolved"]);
  assert.equal(eventsOfType(shielded.events, "DamagePacketResolved").length, 0, "AC +5 turns the triggering hit into a miss");
  let bob = combatEntity(read(scenario, BOB_VIEWER), BOB_ID);
  assert.equal(bob.effectiveArmorClass, 18);
  assert.equal(bob.resources["spellSlot:1"].current, "1");
  assert.equal(bob.turn.reaction, "0");

  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:sentinel-ends-after-shield",
    sourceEntityId: SENTINEL_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:alice-ends-before-shield-expiry",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  bob = combatEntity(read(scenario, BOB_VIEWER), BOB_ID);
  assert.equal(bob.effectiveArmorClass, 13);
});

test("Counterspell freezes visibility/range, uses the 2014 ability check, nests finitely, and never refunds committed slots", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "check:counterspell:character:bob": [10],
    "damage:spell:cinder-sentinel-force-wave": [7],
  }));
  let { scenario } = openEncounterWithInput(authority, reactionEncounterInput());
  scenario = advanceToSentinel(scenario, authority, "counterspell-check");

  const casting = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:sentinel-casts-fourth-level-force-wave",
    sourceEntityId: SENTINEL_ID,
    abilityRef: "spell:cinder-sentinel-force-wave",
    parameters: { slotLevel: "4", targetEntityId: ALICE_ID },
  }, authority), "awaitingInput");
  scenario = casting.scenario;
  assertIncludesEventTypes(casting.events, ["ResourceSpent", "SpellCastingStarted", "ReactionOpportunityOpened"]);
  assert.equal(casting.result.pending.reactionKind, "counterspell");
  assert.equal(casting.result.pending.controllerEntityId, BOB_ID);
  assert.equal(combatEntity(read(scenario, SENTINEL_VIEWER), SENTINEL_ID).resources["spellSlot:4"].current, "0");
  assert.equal(
    authority.observedRequests.some(({ purposeKey }) => purposeKey === "damage:spell:cinder-sentinel-force-wave"),
    false,
    "the original spell has no effect before Counterspell resolves",
  );

  const bobCounters = requireKind(answerPending(
    scenario,
    casting.result.pending,
    { kind: "useReaction", abilityRef: "spell:counterspell", slotLevel: "3" },
    authority,
    "response:bob-counterspells-level-four",
  ), "awaitingInput");
  scenario = bobCounters.scenario;
  assert.equal(bobCounters.result.pending.controllerEntityId, SENTINEL_ID, "the counterspell itself may be countered");
  assert.equal(read(scenario, SENTINEL_VIEWER).pendingInputs.some(
    ({ pendingInputId }) => pendingInputId === bobCounters.result.pending.pendingInputId,
  ), true);

  const kpDeclinesNested = requireKind(answerPending(
    scenario,
    bobCounters.result.pending,
    { kind: "decline" },
    authority,
    "response:sentinel-declines-nested-counterspell",
  ), "committed");
  scenario = kpDeclinesNested.scenario;
  const counterCheck = authority.observedRequests.find(
    ({ purposeKey }) => purposeKey === "check:counterspell:character:bob",
  );
  assert.equal(counterCheck.frozenParameters.ability, "int");
  assert.equal(counterCheck.frozenParameters.dc, 14);
  assertIncludesEventTypes(kpDeclinesNested.events, ["SpellCountered"]);
  assert.equal(eventsOfType(kpDeclinesNested.events, "DamagePacketResolved").length, 0);
  assert.equal(combatEntity(read(scenario, BOB_VIEWER), BOB_ID).resources["spellSlot:3"].current, "1");
  assert.equal(combatEntity(read(scenario, SENTINEL_VIEWER), SENTINEL_ID).resources["spellSlot:4"].current, "0");

  const nestedAuthority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "damage:spell:cinder-sentinel-force-wave": [7],
  }));
  ({ scenario } = openEncounterWithInput(nestedAuthority, reactionEncounterInput()));
  scenario = advanceToSentinel(scenario, nestedAuthority, "nested-counterspell");
  const original = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:nested-counterspell-chain",
    sourceEntityId: SENTINEL_ID,
    abilityRef: "spell:cinder-sentinel-force-wave",
    parameters: { slotLevel: "4", targetEntityId: ALICE_ID },
  }, nestedAuthority), "awaitingInput");
  scenario = original.scenario;
  const firstCounter = requireKind(answerPending(
    scenario,
    original.result.pending,
    { kind: "useReaction", abilityRef: "spell:counterspell", slotLevel: "3" },
    nestedAuthority,
    "response:bob-starts-counter-chain",
  ), "awaitingInput");
  scenario = firstCounter.scenario;
  const nestedCounter = requireKind(answerPending(
    scenario,
    firstCounter.result.pending,
    { kind: "useReaction", abilityRef: "spell:cinder-sentinel-counterspell", slotLevel: "3" },
    nestedAuthority,
    "response:sentinel-counters-counterspell",
  ), "committed");
  scenario = nestedCounter.scenario;
  assert.equal(eventsOfType(
    [...original.events, ...firstCounter.events, ...nestedCounter.events],
    "SpellCastingStarted",
  ).length, 3);
  assert.ok(eventsOfType(nestedCounter.events, "SpellCountered").some(
    ({ payload }) => payload.abilityRef === "spell:counterspell",
  ));
  assert.equal(eventsOfType(nestedCounter.events, "DamagePacketResolved").length, 1, "the original spell resumes after its counterspell is countered");
  assert.equal(combatEntity(read(scenario, BOB_VIEWER), BOB_ID).resources["spellSlot:3"].current, "1");
  const sentinel = combatEntity(read(scenario, SENTINEL_VIEWER), SENTINEL_ID);
  assert.equal(sentinel.resources["spellSlot:4"].current, "0");
  assert.equal(sentinel.resources["spellSlot:3"].current, "0");
  assert.ok(nestedCounter.events.length < 32, "the explicit parent/child chain terminates without recursive reopening");
});

test("B19 environmental disruption freezes a DC 10 Constitution concentration save before authority randomness", () => {
  const firstCauseFactId = "fact:storm-wave-rocks-the-mill";
  const secondCauseFactId = "fact:collapsing-gear-strikes-the-floor";
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    [`save:concentration:environment:${BOB_ID}:${firstCauseFactId}`]: [14],
    [`save:concentration:environment:${BOB_ID}:${secondCauseFactId}`]: [3],
  }));
  let { scenario } = openEncounter(authority);
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:b19-alice-yields-turn",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  scenario = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:b19-bob-starts-concentration",
    sourceEntityId: BOB_ID,
    abilityRef: "spell:hex",
    parameters: { slotLevel: "1", targetEntityId: BRUTE_ID },
  }, authority), "committed").scenario;

  const weathered = requireKind(drive(scenario, {
    kind: "testConcentration",
    rootActionId: "root:b19-first-environment-tests-bob",
    sourceEntityId: BOB_ID,
    causeFactId: firstCauseFactId,
  }, authority), "committed");
  scenario = weathered.scenario;
  assert.ok(combatEntity(read(scenario, BOB_VIEWER), BOB_ID).concentration);
  assert.equal(eventsOfType(weathered.events, "ConcentrationTested")[0].payload.succeeded, true);

  const disrupted = requireKind(drive(scenario, {
    kind: "testConcentration",
    rootActionId: "root:b19-second-environment-tests-bob",
    sourceEntityId: BOB_ID,
    causeFactId: secondCauseFactId,
  }, authority), "committed");
  const request = authority.observedRequests.find(
    ({ purposeKey }) => purposeKey === `save:concentration:environment:${BOB_ID}:${secondCauseFactId}`,
  );
  assert.deepEqual(request.frozenParameters, {
    sourceEntityId: BOB_ID,
    causeFactId: secondCauseFactId,
    ability: "con",
    dc: 10,
    modifier: 1,
    mode: "normal",
  });
  assertIncludesEventTypes(disrupted.events, ["RandomnessRequested", "ConcentrationEnded"]);
  assert.equal(disrupted.result.mechanicalResult.dc, 10);
  assert.equal(
    authority.observedRequests.filter(({ purposeKey }) =>
      purposeKey.startsWith(`save:concentration:environment:${BOB_ID}:`)).length,
    2,
  );
  assert.equal(combatEntity(read(disrupted.scenario, BOB_VIEWER), BOB_ID).concentration, null);
  assert.deepEqual(replayed(structuredClone(disrupted.scenario.eventLog)).state, disrupted.scenario.state);
});

test("B19 a new concentration ends the old effect first and voluntary ending needs no action grant", () => {
  const initialState = structuredClone(INITIAL_STATE);
  initialState.definitions["spell:focus-flame"] = {
    definitionId: "spell:focus-flame",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "actionSpell", spellLevel: "0" },
    target: { kind: "creature", count: "1", rangeInches: "1080" },
    effect: { kind: "concentration", durationMicros: "60000000" },
  };
  initialState.entities[BOB_ID].abilityRefs.push("spell:focus-flame");
  const genesis = geometryGenesis(initialState, "b19-concentration-replacement-and-voluntary-end");
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, genesis);
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:b19-replacement-alice-yields",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  scenario = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:b19-replacement-hex",
    sourceEntityId: BOB_ID,
    abilityRef: "spell:hex",
    parameters: { slotLevel: "1", targetEntityId: BRUTE_ID },
  }, authority), "committed").scenario;

  const replaced = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:b19-replacement-focus-flame",
    sourceEntityId: BOB_ID,
    abilityRef: "spell:focus-flame",
    parameters: { targetEntityId: SENTINEL_ID },
  }, authority), "committed");
  scenario = replaced.scenario;
  const concentrationEvents = replaced.events.filter(({ eventType }) =>
    eventType === "ConcentrationEnded" || eventType === "ConcentrationStarted");
  assert.deepEqual(concentrationEvents.map(({ eventType }) => eventType), [
    "ConcentrationEnded",
    "ConcentrationStarted",
  ]);
  assert.equal(concentrationEvents[0].payload.reason, "replacedByNewConcentration");
  assert.equal(scenario.state.combatRuntime.entities[BOB_ID].concentration.abilityRef, "spell:focus-flame");

  const actionBefore = scenario.state.combatRuntime.entities[BOB_ID].turn.action;
  const ended = requireKind(drive(scenario, {
    kind: "endConcentration",
    rootActionId: "root:b19-voluntary-end",
    sourceEntityId: BOB_ID,
  }, authority), "committed");
  assert.equal(eventsOfType(ended.events, "ConcentrationEnded")[0].payload.reason, "voluntarilyEnded");
  assert.equal(ended.scenario.state.combatRuntime.entities[BOB_ID].turn.action, actionBefore);
  assert.equal(ended.scenario.state.combatRuntime.entities[BOB_ID].concentration, null);
  assert.deepEqual(replayed(structuredClone(ended.scenario.eventLog), genesis).state, ended.scenario.state);
});

test("B19 each independent damage source triggers exactly one concentration save after applied damage", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "attack:ability:ash-brute-maul": [16],
    "damage:ability:ash-brute-maul": [1, 1],
    "attack:ability:cinder-sentinel-bolt": [16],
    "damage:ability:cinder-sentinel-bolt": [1],
    [`save:concentration:${BOB_ID}`]: [14, 0],
  }));
  let { scenario } = openEncounter(authority);
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:b19-two-sources-alice-yields",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  scenario = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:b19-two-sources-bob-hexes",
    sourceEntityId: BOB_ID,
    abilityRef: "spell:hex",
    parameters: { slotLevel: "1", targetEntityId: BRUTE_ID },
  }, authority), "committed").scenario;
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:b19-two-sources-bob-yields",
    sourceEntityId: BOB_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;

  const firstHit = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:b19-first-damage-source",
    sourceEntityId: BRUTE_ID,
    abilityRef: "ability:ash-brute-maul",
    parameters: { targetEntityId: BOB_ID },
  }, authority), "awaitingInput");
  const firstResolved = requireKind(answerPending(
    firstHit.scenario,
    firstHit.result.pending,
    { kind: "decline" },
    authority,
    "response:b19-bob-declines-first-shield",
  ), "committed");
  scenario = firstResolved.scenario;
  assert.equal(eventsOfType(firstResolved.events, "ConcentrationTested").length, 1);
  assert.equal(eventsOfType(firstResolved.events, "ConcentrationTested")[0].payload.succeeded, true);
  assert.ok(scenario.state.combatRuntime.entities[BOB_ID].concentration);

  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:b19-two-sources-brute-yields",
    sourceEntityId: BRUTE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  const secondHit = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:b19-second-damage-source",
    sourceEntityId: SENTINEL_ID,
    abilityRef: "ability:cinder-sentinel-bolt",
    parameters: { targetEntityId: BOB_ID },
  }, authority), "awaitingInput");
  const secondResolved = requireKind(answerPending(
    secondHit.scenario,
    secondHit.result.pending,
    { kind: "decline" },
    authority,
    "response:b19-bob-declines-second-shield",
  ), "committed");
  assert.equal(eventsOfType(secondResolved.events, "ConcentrationTested").length, 1);
  assert.equal(eventsOfType(secondResolved.events, "ConcentrationTested")[0].payload.succeeded, false);
  assert.equal(secondResolved.scenario.state.combatRuntime.entities[BOB_ID].concentration, null);
  assert.equal(
    authority.observedRequests.filter(({ purposeKey }) =>
      purposeKey === `save:concentration:${BOB_ID}`).length,
    2,
  );
  assert.deepEqual(replayed(structuredClone(secondResolved.scenario.eventLog)).state, secondResolved.scenario.state);
});

test("B19/B21 temporary hit points absorb damage without reviving or removing stable unconscious state", () => {
  const initialState = structuredClone(INITIAL_STATE);
  initialState.entities[ALICE_ID].hitPoints.current = "0";
  initialState.entities[ALICE_ID].conditions = { stable: true, unconscious: true, prone: true };
  initialState.entities[ALICE_ID].lifeState = "unconscious";
  initialState.entities[ALICE_ID].deathSaves = { successes: 0, failures: 0 };
  initialState.definitions["spell:heroism-temporary"] = {
    definitionId: "spell:heroism-temporary",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "actionSpell", spellLevel: "1" },
    costs: [{ kind: "spellSlot", level: "1", amount: "1" }],
    target: { kind: "creature", count: "1", rangeInches: "120" },
    temporaryHitPoints: { formula: "1d4+2" },
  };
  initialState.entities[BOB_ID].abilityRefs.push("spell:heroism-temporary");
  const genesis = geometryGenesis(initialState, "b19-temporary-hit-points");
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "temporary-hit-points:spell:heroism-temporary": [1],
  }));
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, genesis);
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:b19-alice-unconscious-turn-ends",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;

  const granted = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:b19-bob-grants-temporary-hit-points",
    sourceEntityId: BOB_ID,
    abilityRef: "spell:heroism-temporary",
    parameters: { slotLevel: "1", targetEntityId: ALICE_ID },
  }, authority), "committed");
  const alice = combatEntity(read(granted.scenario, ALICE_VIEWER), ALICE_ID);
  assertIncludesEventTypes(granted.events, ["AbilityInvoked", "TemporaryHitPointsGranted"]);
  assert.equal(alice.hitPoints.temporary, "4");
  assert.equal(alice.hitPoints.current, "0");
  assert.equal(alice.conditions.stable, true);
  assert.equal(alice.conditions.unconscious, true);
  assert.equal(alice.lifeState, "unconscious");
  assert.deepEqual(replayed(structuredClone(granted.scenario.eventLog), genesis).state, granted.scenario.state);
});

test("B22 melee knock-out choice precedes massive damage and remains controller-private", () => {
  const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
  const brute = encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID);
  brute.mechanics.definition.content.hitPointsMaximum = "5";
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "attack:alice-resonant-blade": [16],
    "damage:alice-resonant-blade": [4, 3, 2],
    [`stable-recovery:${BRUTE_ID}`]: [1],
  }));
  let { scenario } = openEncounterWithInput(authority, encounterInput);

  const offered = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:b22-alice-drops-brute",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-resonant-blade",
    parameters: { targetEntityId: BRUTE_ID },
  }, authority), "awaitingInput");
  scenario = offered.scenario;
  assert.equal(offered.result.pending.choiceKind, "knockOut");
  assert.equal(offered.result.pending.controllerEntityId, ALICE_ID);
  assert.equal(offered.result.pending.targetEntityId, BRUTE_ID);
  assert.equal(eventsOfType(offered.events, "DamagePacketResolved").length, 0);
  assert.equal(eventsOfType(offered.events, "CreatureDied").length, 0);
  assert.equal(
    read(scenario, ALICE_VIEWER).pendingInputs.some(
      ({ pendingInputId }) => pendingInputId === offered.result.pending.pendingInputId,
    ),
    true,
  );
  assert.equal(
    read(scenario, BOB_VIEWER).pendingInputs.some(
      ({ pendingInputId }) => pendingInputId === offered.result.pending.pendingInputId,
    ),
    false,
  );

  const lethal = requireKind(answerPending(
    scenario,
    offered.result.pending,
    { kind: "dealLethalDamage" },
    authority,
    "response:b22-alice-keeps-massive-damage-lethal",
  ), "committed");
  assertIncludesEventTypes(lethal.events, ["DamagePacketResolved", "CreatureDied"]);
  assert.equal(lethal.scenario.state.combatRuntime.entities[BRUTE_ID].lifeState, "dead");

  const knockedOut = requireKind(answerPending(
    scenario,
    offered.result.pending,
    { kind: "knockOut" },
    authority,
    "response:b22-alice-chooses-knock-out",
  ), "committed");
  const target = knockedOut.scenario.state.combatRuntime.entities[BRUTE_ID];
  assertIncludesEventTypes(knockedOut.events, [
    "CombatPendingClosed",
    "ReactionAnswered",
    "DamagePacketResolved",
    "ActivityStarted",
  ]);
  assert.equal(eventsOfType(knockedOut.events, "CreatureDied").length, 0);
  assert.equal(target.hitPoints.current, "0");
  assert.equal(target.conditions.stable, true);
  assert.equal(target.conditions.unconscious, true);
  assert.equal(target.lifeState, "unconscious");
  assert.equal(
    knockedOut.scenario.state.campaignRuntime.activities[
      Object.keys(knockedOut.scenario.state.campaignRuntime.activities).find((activityId) =>
        activityId.includes(BRUTE_ID))
    ].intendedDurationMicros,
    "7200000000",
  );
  assert.deepEqual(replayed(structuredClone(knockedOut.scenario.eventLog)).state, knockedOut.scenario.state);
});

test("B22 an important NPC death-save policy is frozen before damage and survives a lethal-choice drop to zero", () => {
  const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
  const brute = encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID);
  brute.initialState = { hitPointsCurrent: "5" };
  brute.mechanics.definition.content.deathPolicy = "deathSaves";
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "attack:alice-resonant-blade": [16],
    "damage:alice-resonant-blade": [4, 3, 2],
  }));
  const { scenario } = openEncounterWithInput(authority, encounterInput);
  const offered = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:b22-important-npc-dropped",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-resonant-blade",
    parameters: { targetEntityId: BRUTE_ID },
  }, authority), "awaitingInput");
  const resolved = requireKind(answerPending(
    offered.scenario,
    offered.result.pending,
    { kind: "dealLethalDamage" },
    authority,
    "response:b22-important-npc-lethal-choice",
  ), "committed");
  const target = resolved.scenario.state.combatRuntime.entities[BRUTE_ID];
  assert.equal(eventsOfType(resolved.events, "CreatureDied").length, 0);
  assert.equal(target.deathPolicy, "deathSaves");
  assert.equal(target.hitPoints.current, "0");
  assert.equal(target.lifeState, "unconscious");
  assert.equal(target.conditions.stable, undefined);
  assert.deepEqual(target.deathSaves, { successes: 0, failures: 0 });
  assert.deepEqual(replayed(structuredClone(resolved.scenario.eventLog)).state, resolved.scenario.state);
});

test("B21 Medicine stabilizes at DC 10 and untreated stability recovers 1 HP after the authoritative 1d4 hours", () => {
  const initialState = structuredClone(INITIAL_STATE);
  initialState.entities[ALICE_ID].hitPoints.current = "0";
  initialState.entities[ALICE_ID].conditions = { unconscious: true, prone: true };
  initialState.entities[ALICE_ID].lifeState = "unconscious";
  initialState.entities[ALICE_ID].deathSaves = { successes: 1, failures: 1 };
  initialState.entities[BOB_ID].proficientSkills = ["medicine"];
  initialState.entities[BOB_ID].position = { x: "0", y: "60", elevation: "0" };
  const genesis = geometryGenesis(initialState, "b21-medicine-stable-recovery");
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    [`check:medicine:${BOB_ID}`]: [6],
    [`stable-recovery:${ALICE_ID}`]: [2],
  }));
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, genesis);
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:b21-alice-unconscious-turn-ends",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;

  const stabilized = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:b21-bob-medicine-stabilizes-alice",
    sourceEntityId: BOB_ID,
    abilityRef: "action:stabilize",
    parameters: { targetEntityId: ALICE_ID },
  }, authority), "committed");
  scenario = stabilized.scenario;
  const medicineRequest = authority.observedRequests.find(
    ({ purposeKey }) => purposeKey === `check:medicine:${BOB_ID}`,
  );
  assert.deepEqual(medicineRequest.frozenParameters, {
    sourceEntityId: BOB_ID,
    targetEntityId: ALICE_ID,
    ability: "wis",
    skill: "medicine",
    dc: 10,
    modifier: 3,
    mode: "normal",
  });
  assertIncludesEventTypes(stabilized.events, [
    "AbilityInvoked",
    "DeathSaveResolved",
    "ActivityStarted",
  ]);
  let alice = scenario.state.combatRuntime.entities[ALICE_ID];
  assert.equal(alice.conditions.stable, true);
  assert.deepEqual(alice.deathSaves, { successes: 0, failures: 0 });
  const recoveryActivity = Object.values(scenario.state.campaignRuntime.activities).find(
    ({ activityKind, characterId }) => activityKind === "stableRecovery2014" && characterId === ALICE_ID,
  );
  assert.equal(recoveryActivity.intendedDurationMicros, "10800000000");

  const elapsed = requireKind(drive(scenario, {
    kind: "resolveFreeAction",
    proposalId: "proposal:b21-three-hours-elapse",
    characterId: BOB_ID,
    goal: "等待未治疗的稳定角色自然苏醒",
    method: "在安全位置照看三小时",
    feasibility: { kind: "directSuccess", publicBasis: "这段虚构时间没有中断。" },
    outcome: { publicResult: "三小时过去。", fictionTimeCostMicros: "10800000000" },
  }, authority), "committed");
  scenario = elapsed.scenario;
  const due = requireKind(drive(scenario, {
    kind: "resolveFreeAction",
    proposalId: "proposal:b21-settle-due-recovery-before-next-intent",
    characterId: BOB_ID,
    goal: "确认同伴状态",
    method: "观察同伴是否苏醒",
    feasibility: { kind: "directSuccess", publicBasis: "可以直接观察。" },
    outcome: { publicResult: "准备观察。" },
  }, authority), "committed");
  assertIncludesEventTypes(due.events, ["ActivityCompleted", "HealingResolved"]);
  assert.equal(due.result.mechanicalResult.retryOriginalIntent, true);
  alice = due.scenario.state.combatRuntime.entities[ALICE_ID];
  assert.equal(alice.hitPoints.current, "1");
  assert.equal(alice.conditions.stable, undefined);
  assert.equal(alice.conditions.unconscious, undefined);
  assert.equal(alice.lifeState, "alive");
  assert.deepEqual(replayed(structuredClone(due.scenario.eventLog), genesis).state, due.scenario.state);
});

test("B19 fully negated damage never consumes an unused concentration draw", () => {
  const initialState = structuredClone(INITIAL_STATE);
  initialState.entities[BOB_ID].damageDefenses = { immune: ["piercing"] };
  const genesis = geometryGenesis(initialState, "b19-zero-damage-no-concentration-draw");
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "attack:ability:cinder-sentinel-bolt": [16],
    "damage:ability:cinder-sentinel-bolt": [5],
    [`save:concentration:${BOB_ID}`]: [1],
  }));
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, genesis);
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:b19-zero-alice-ends",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  scenario = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:b19-zero-bob-hexes",
    sourceEntityId: BOB_ID,
    abilityRef: "spell:hex",
    parameters: { slotLevel: "1", targetEntityId: BRUTE_ID },
  }, authority), "committed").scenario;
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:b19-zero-bob-ends",
    sourceEntityId: BOB_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:b19-zero-brute-ends",
    sourceEntityId: BRUTE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  const offered = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:b19-zero-sentinel-shoots-bob",
    sourceEntityId: SENTINEL_ID,
    abilityRef: "ability:cinder-sentinel-bolt",
    parameters: { targetEntityId: BOB_ID },
  }, authority), "awaitingInput");
  const resolved = requireKind(answerPending(
    offered.scenario,
    offered.result.pending,
    { kind: "decline" },
    authority,
    "response:b19-zero-bob-declines-shield",
  ), "committed");
  assert.equal(resolved.result.mechanicalResult.damage.totalApplied, 0);
  // SPEC 0012 §10.2: the save die is reserved in the damage batch; fully
  // negated damage leaves it unconsumed, so no concentration test is recorded.
  assert.equal(
    resolved.result.events.some(({ eventType }) => ["ConcentrationTested", "ConcentrationEnded"].includes(eventType)),
    false,
  );
  assert.ok(resolved.scenario.state.combatRuntime.entities[BOB_ID].concentration);
  assert.deepEqual(replayed(structuredClone(resolved.scenario.eventLog), genesis).state, resolved.scenario.state);
});

test("B21 healing or later damage explicitly interrupts a stable creature's pending natural recovery", () => {
  const initialState = structuredClone(INITIAL_STATE);
  initialState.entities[ALICE_ID].hitPoints.current = "0";
  initialState.entities[ALICE_ID].conditions = { unconscious: true, prone: true };
  initialState.entities[ALICE_ID].lifeState = "unconscious";
  initialState.entities[ALICE_ID].deathSaves = { successes: 0, failures: 0 };
  initialState.entities[BOB_ID].proficientSkills = ["medicine"];
  initialState.entities[BOB_ID].position = { x: "0", y: "60", elevation: "0" };
  initialState.entities[BOB_ID].abilityRefs.push("ability:restorative-touch");
  const genesis = geometryGenesis(initialState, "b21-stable-recovery-interruption");
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    [`check:medicine:${BOB_ID}`]: [7],
    [`stable-recovery:${ALICE_ID}`]: [3],
    "healing:ability:restorative-touch": [1, 1],
    "attack:ability:ash-brute-maul": [17],
    "damage:ability:ash-brute-maul": [1, 1],
  }));
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, genesis);
  scenario = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:b21-interrupt-alice-yields",
    sourceEntityId: ALICE_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  const stabilized = requireKind(drive(scenario, {
    kind: "invokeAbility",
    rootActionId: "root:b21-interrupt-medicine",
    sourceEntityId: BOB_ID,
    abilityRef: "action:stabilize",
    parameters: { targetEntityId: ALICE_ID },
  }, authority), "committed");
  const recovery = Object.values(stabilized.scenario.state.campaignRuntime.activities).find(
    ({ activityKind, characterId }) => activityKind === "stableRecovery2014" && characterId === ALICE_ID,
  );
  assert.equal(recovery.status, "active");

  let healedScenario = stabilized.scenario;
  for (const sourceEntityId of [BOB_ID, BRUTE_ID, SENTINEL_ID, ALICE_ID]) {
    healedScenario = requireKind(drive(healedScenario, {
      kind: "endTurn",
      rootActionId: `root:b21-healing-advance:${sourceEntityId}`,
      sourceEntityId,
      encounterId: ENCOUNTER_ID,
    }, authority), "committed").scenario;
  }
  const healed = requireKind(drive(healedScenario, {
    kind: "invokeAbility",
    rootActionId: "root:b21-healing-interrupts-recovery",
    sourceEntityId: BOB_ID,
    abilityRef: "ability:restorative-touch",
    parameters: { targetEntityId: ALICE_ID },
  }, authority), "committed");
  assertIncludesEventTypes(healed.events, ["ActivityInterrupted", "HealingResolved"]);
  assert.equal(healed.scenario.state.campaignRuntime.activities[recovery.activityId].status, "interrupted");
  assert.equal(healed.scenario.state.combatRuntime.entities[ALICE_ID].lifeState, "alive");

  let damagedScenario = stabilized.scenario;
  damagedScenario = requireKind(drive(damagedScenario, {
    kind: "endTurn",
    rootActionId: "root:b21-damage-bob-yields",
    sourceEntityId: BOB_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed").scenario;
  const damaged = requireKind(drive(damagedScenario, {
    kind: "invokeAbility",
    rootActionId: "root:b21-damage-interrupts-recovery",
    sourceEntityId: BRUTE_ID,
    abilityRef: "ability:ash-brute-maul",
    parameters: { targetEntityId: ALICE_ID },
  }, authority), "committed");
  assertIncludesEventTypes(damaged.events, ["ActivityInterrupted", "DamagePacketResolved"]);
  assert.equal(damaged.scenario.state.campaignRuntime.activities[recovery.activityId].status, "interrupted");
  assert.equal(damaged.scenario.state.combatRuntime.entities[ALICE_ID].conditions.stable, undefined);
  assert.deepEqual(replayed(structuredClone(damaged.scenario.eventLog), genesis).state, damaged.scenario.state);
});

test("B21 natural 20 restores 1 HP while a third success stabilizes and schedules the authoritative 1d4 hours", () => {
  const initialState = structuredClone(INITIAL_STATE);
  for (const entityId of [ALICE_ID, BOB_ID]) {
    initialState.entities[entityId].hitPoints.current = "0";
    initialState.entities[entityId].conditions = { unconscious: true, prone: true };
    initialState.entities[entityId].lifeState = "unconscious";
  }
  initialState.entities[ALICE_ID].deathSaves = { successes: 2, failures: 2 };
  initialState.entities[BOB_ID].deathSaves = { successes: 2, failures: 1 };
  const genesis = geometryGenesis(initialState, "b21-natural-twenty-and-third-success");
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    [`death-save:${ALICE_ID}`]: [19],
    [`death-save:${BOB_ID}`]: [9],
    [`stable-recovery:${BOB_ID}`]: [3],
  }));
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, genesis);
  for (const sourceEntityId of [ALICE_ID, BOB_ID, BRUTE_ID]) {
    scenario = requireKind(drive(scenario, {
      kind: "endTurn",
      rootActionId: `root:b21-death-save-advance:${sourceEntityId}`,
      sourceEntityId,
      encounterId: ENCOUNTER_ID,
    }, authority), "committed").scenario;
  }
  const round = requireKind(drive(scenario, {
    kind: "endTurn",
    rootActionId: "root:b21-resolve-natural-twenty-and-third-success",
    sourceEntityId: SENTINEL_ID,
    encounterId: ENCOUNTER_ID,
  }, authority), "committed");
  assert.equal(eventsOfType(round.events, "DeathSaveResolved").length, 2);
  assertIncludesEventTypes(round.events, ["ActivityStarted", "RoundStarted", "TurnStarted"]);

  const alice = round.scenario.state.combatRuntime.entities[ALICE_ID];
  assert.equal(alice.hitPoints.current, "1");
  assert.equal(alice.lifeState, "alive");
  assert.equal(alice.conditions.unconscious, undefined);
  assert.deepEqual(alice.deathSaves, { successes: 0, failures: 0 });

  const bob = round.scenario.state.combatRuntime.entities[BOB_ID];
  assert.equal(bob.hitPoints.current, "0");
  assert.equal(bob.lifeState, "unconscious");
  assert.equal(bob.conditions.stable, true);
  assert.deepEqual(bob.deathSaves, { successes: 0, failures: 0 });
  const recovery = Object.values(round.scenario.state.campaignRuntime.activities).find(
    ({ activityKind, characterId }) => activityKind === "stableRecovery2014" && characterId === BOB_ID,
  );
  assert.equal(recovery.intendedDurationMicros, "14400000000");
  assert.deepEqual(replayed(structuredClone(round.scenario.eventLog), genesis).state, round.scenario.state);
});

// SPEC 0012 §6.3: Dash, Disengage and Dodge take the creature's action on its
// own turn through the ordinary ability input; no stat block has to list them.
function endTurns(scenario, authority, suffix, entityIds) {
  for (const sourceEntityId of entityIds) {
    scenario = requireKind(drive(scenario, {
      kind: "endTurn",
      rootActionId: `root:${suffix}:end:${sourceEntityId}`,
      sourceEntityId,
      encounterId: ENCOUNTER_ID,
    }, authority), "committed").scenario;
  }
  return scenario;
}

function invoke(scenario, authority, rootActionId, sourceEntityId, abilityRef, parameters = {}) {
  return drive(scenario, { kind: "invokeAbility", rootActionId, sourceEntityId, abilityRef, parameters }, authority);
}

test("Dash adds the creature's speed to this turn's movement once per action, and the next turn starts without it", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  let { scenario } = openEncounter(authority);
  const walkSouth = (rootActionId, fromY, toY) => drive(scenario, {
    kind: "moveCombatant", rootActionId, encounterId: ENCOUNTER_ID, sourceEntityId: ALICE_ID, movementMode: "walk",
    path: [{ x: "0", y: fromY, elevation: "0" }, { x: "0", y: toY, elevation: "0" }],
  }, authority);

  scenario = requireKind(opportunityDeclined(walkSouth("root:alice-walks-her-speed", "0", "-360"), authority, BRUTE_ID,
    "response:brute-lets-alice-walk-south"), "committed").scenario;
  assert.deepEqual(requireKind(walkSouth("root:alice-cannot-pass-her-speed", "-360", "-361"), "rejected").events, []);
  const offTurn = requireKind(invoke(scenario, authority, "root:bob-cannot-dash-on-alice-turn", BOB_ID, "action:dash"), "rejected");
  assert.deepEqual(offTurn.events, []);

  const dashed = requireKind(invoke(scenario, authority, "root:alice-dashes", ALICE_ID, "action:dash"), "committed");
  scenario = dashed.scenario;
  assert.deepEqual(eventTypes(dashed.events), ["AbilityInvoked"]);
  let alice = combatEntity(read(scenario, ALICE_VIEWER), ALICE_ID);
  assert.equal(alice.turn.action, "0");
  assert.equal(alice.turn.dashes, "1");

  // Every committed segment is replayed, so the replay check honours the Dash too.
  scenario = requireKind(walkSouth("root:alice-walks-her-dash", "-360", "-720"), "committed").scenario;
  assert.deepEqual(requireKind(walkSouth("root:alice-cannot-pass-one-dash", "-720", "-721"), "rejected").events, []);
  const noAction = requireKind(invoke(scenario, authority, "root:alice-has-no-action-left", ALICE_ID, "action:dash"), "rejected");
  assert.deepEqual(noAction.events, []);

  // Action Surge returns an action; a second Dash adds the speed once more.
  scenario = requireKind(invoke(scenario, authority, "root:alice-surges-to-dash", ALICE_ID, "ability:action-surge"), "committed").scenario;
  scenario = requireKind(invoke(scenario, authority, "root:alice-dashes-again", ALICE_ID, "action:dash"), "committed").scenario;
  scenario = requireKind(walkSouth("root:alice-walks-her-second-dash", "-720", "-1080"), "committed").scenario;
  assert.equal(scenario.state.combatRuntime.entities[ALICE_ID].movement.spentMilliInches, "1080000");

  scenario = endTurns(scenario, authority, "dash-round", [ALICE_ID, BOB_ID, BRUTE_ID, SENTINEL_ID]);
  assert.equal(encounterView(read(scenario, ALICE_VIEWER)).activeEntityId, ALICE_ID);
  alice = combatEntity(read(scenario, ALICE_VIEWER), ALICE_ID);
  assert.equal(alice.turn.dashes, undefined);
  assert.deepEqual(requireKind(walkSouth("root:alice-next-turn-has-only-her-speed", "-1080", "-1441"), "rejected").events, []);
});

test("Disengage keeps a creature's movement this turn from opening an opportunity attack", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  let { scenario } = openEncounter(authority);
  scenario = endTurns(scenario, authority, "disengage", [ALICE_ID, BOB_ID]);
  const leaveAlice = (rootActionId) => drive(scenario, {
    kind: "moveCombatant", rootActionId, encounterId: ENCOUNTER_ID, sourceEntityId: BRUTE_ID, movementMode: "walk",
    path: [{ x: "60", y: "0", elevation: "0" }, { x: "240", y: "0", elevation: "0" }],
  }, authority);
  const provoked = requireKind(leaveAlice("root:brute-leaves-alice-reach-provoking"), "awaitingInput");
  assert.equal(provoked.result.pending.controllerEntityId, ALICE_ID);

  const offTurn = requireKind(invoke(scenario, authority, "root:alice-cannot-disengage-on-brute-turn", ALICE_ID, "action:disengage"), "rejected");
  assert.deepEqual(offTurn.events, []);
  scenario = requireKind(invoke(scenario, authority, "root:brute-disengages", BRUTE_ID, "action:disengage"), "committed").scenario;
  assert.equal(scenario.state.combatRuntime.entities[BRUTE_ID].turn.disengaged, true);
  const noAction = requireKind(invoke(scenario, authority, "root:brute-cannot-disengage-twice", BRUTE_ID, "action:disengage"), "rejected");
  assert.deepEqual(noAction.events, []);

  const left = requireKind(leaveAlice("root:brute-leaves-alice-reach-disengaged"), "committed");
  assert.deepEqual(eventTypes(left.events), ["MovementSegmentCommitted"]);
  assert.deepEqual(combatEntity(read(left.scenario, ALICE_VIEWER), BRUTE_ID).position, { x: "240", y: "0", elevation: "0" });
});

// SPEC 0012 §7.2 (user ruling 2026-10-04, "NPC 自己决定"): opportunity attacks
// are symmetric. A player leaving an NPC's reach offers the NPC the attack,
// and the NPC answers its own KP decision.
const BRUTE_VIEWER = Object.freeze({
  kind: "npc",
  npcId: BRUTE_ID,
  purpose: "kpDecision",
  capability: "internal:npc-limited-knowledge",
});

function aliceWalksAwayFromBrute(scenario, authority, rootActionId) {
  return drive(scenario, {
    kind: "moveCombatant", rootActionId, encounterId: ENCOUNTER_ID, sourceEntityId: ALICE_ID, movementMode: "walk",
    path: [{ x: "0", y: "0", elevation: "0" }, { x: "0", y: "-240", elevation: "0" }],
  }, authority);
}

test("a player walking out of an NPC's reach offers that NPC an opportunity attack it decides itself", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "attack:opportunity:enemy:ash-brute": [14],
    "damage:opportunity:enemy:ash-brute": [0, 0],
  }));
  let { scenario } = openEncounter(authority);
  const offered = requireKind(aliceWalksAwayFromBrute(scenario, authority, "root:alice-walks-away-from-brute"), "awaitingInput");
  scenario = offered.scenario;
  assert.deepEqual(eventTypes(offered.events), ["ReactionOffered"]);
  assert.deepEqual(offered.result.pending, {
    pendingInputId: offered.result.pending.pendingInputId,
    kind: "kpDecision",
    choiceKind: "reaction",
    controllerEntityId: BRUTE_ID,
    candidateAbilityRefs: ["action:opportunity-attack"],
  });
  assert.deepEqual(scenario.state.combatRuntime.entities[ALICE_ID].position, { x: "0", y: "0", elevation: "0" },
    "the walk waits before it crosses the edge of Brute's reach");
  // The NPC's own decision view offers the attack on Alice and a decline;
  // Alice is not asked anything.
  const choice = read(scenario, BRUTE_VIEWER).pendingInputs
    .find(({ pendingInputId }) => pendingInputId === offered.result.pending.pendingInputId);
  assert.deepEqual(choice.answerOptions.map(({ answer }) => answer), [
    { kind: "useReaction", abilityRef: "action:opportunity-attack", targetEntityId: ALICE_ID },
    { kind: "decline" },
  ]);
  assert.equal(read(scenario, ALICE_VIEWER).pendingInputs.some(({ kind }) => kind === "combatChoice"), false);
  assert.equal(requireKind(drive(scenario, { kind: "endTurn", rootActionId: "root:alice-cannot-end-mid-walk",
    sourceEntityId: ALICE_ID, encounterId: ENCOUNTER_ID }, authority), "rejected").result.rejection.code, "pendingInputUnresolved");

  // Brute swings its maul: 15 + 6 hits AC 15 for 1 + 1 + 4, then the walk goes on.
  const attacked = requireKind(answerPending(scenario, offered.result.pending, choice.answerOptions[0].answer, authority,
    "response:brute-takes-opportunity"), "committed");
  assertIncludesEventTypes(attacked.events, ["ReactionAnswered", "RandomnessRequested", "AbilityInvoked",
    "DamagePacketResolved", "MovementSegmentCommitted"]);
  const invoked = eventsOfType(attacked.events, "AbilityInvoked")[0].payload;
  assert.equal(invoked.sourceEntityId, BRUTE_ID);
  assert.equal(invoked.abilityRef, "action:opportunity-attack");
  assert.deepEqual([invoked.mechanicalResult.attackAbilityRef, invoked.mechanicalResult.attack],
    ["ability:ash-brute-maul", { mode: "normal", roll: 15, total: 21, hit: true }]);
  const alice = combatEntity(read(attacked.scenario, ALICE_VIEWER), ALICE_ID);
  assert.equal(alice.hitPoints.current, "1");
  assert.deepEqual(alice.position, { x: "0", y: "-240", elevation: "0" });
  assert.equal(attacked.scenario.state.combatRuntime.entities[BRUTE_ID].turn.reaction, "0");
  assert.deepEqual(replayed(attacked.scenario.eventLog).state, attacked.result.state, "replay rebuilds the same state");

  // Declining lets the walk go on untouched.
  const declineAuthority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  const declineStart = openEncounter(declineAuthority).scenario;
  const declined = requireKind(opportunityDeclined(aliceWalksAwayFromBrute(declineStart, declineAuthority,
    "root:alice-walks-past-a-declining-brute"), declineAuthority, BRUTE_ID, "response:brute-declines"), "committed");
  assert.deepEqual(eventTypes(declined.events), ["CombatPendingClosed", "ReactionAnswered", "MovementSegmentCommitted"]);
  assert.deepEqual(declined.scenario.state.combatRuntime.entities[ALICE_ID].position, { x: "0", y: "-240", elevation: "0" });
  assert.equal(declined.scenario.state.combatRuntime.entities[BRUTE_ID].turn.reaction, "1");
  assert.deepEqual(replayed(declined.scenario.eventLog).state, declined.result.state);

  // After Disengage her walk opens nothing.
  const disengageAuthority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  let disengaged = openEncounter(disengageAuthority).scenario;
  disengaged = requireKind(invoke(disengaged, disengageAuthority, "root:alice-disengages", ALICE_ID, "action:disengage"), "committed").scenario;
  const free = requireKind(aliceWalksAwayFromBrute(disengaged, disengageAuthority, "root:alice-walks-away-disengaged"), "committed");
  assert.deepEqual(eventTypes(free.events), ["MovementSegmentCommitted"]);
});

test("an opportunity attack that drops the walking player to 0 HP stops the rest of the walk", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "attack:opportunity:enemy:ash-brute": [14],
    "damage:opportunity:enemy:ash-brute": [3],
  }));
  const initialState = structuredClone(INITIAL_STATE);
  initialState.entities[ALICE_ID].hitPoints.current = "3";
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, geometryGenesis(initialState, "opportunity-drop"));
  const offered = requireKind(aliceWalksAwayFromBrute(scenario, authority, "root:wounded-alice-walks-away"), "awaitingInput");
  const dropped = requireKind(answerPending(offered.scenario, offered.result.pending,
    { kind: "useReaction", abilityRef: "action:opportunity-attack", targetEntityId: ALICE_ID }, authority,
    "response:brute-drops-alice"), "committed");
  assert.equal(eventsOfType(dropped.events, "MovementSegmentCommitted").length, 0);
  const alice = dropped.scenario.state.combatRuntime.entities[ALICE_ID];
  assert.equal(alice.hitPoints.current, "0");
  assert.deepEqual(alice.position, { x: "0", y: "0", elevation: "0" });
});

test("an NPC whose maul reaches ten feet gets its opportunity attack at ten feet", () => {
  const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
  const brute = encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID);
  brute.placement.position = { x: "120", y: "0", elevation: "0" };
  const walkWest = (scenario, authority) => drive(scenario, {
    kind: "moveCombatant", rootActionId: "root:alice-walks-out-of-ten-feet", encounterId: ENCOUNTER_ID, sourceEntityId: ALICE_ID,
    movementMode: "walk", path: [{ x: "0", y: "0", elevation: "0" }, { x: "-120", y: "0", elevation: "0" }],
  }, authority);
  // Ten feet away, a five-foot reach never held her.
  const shortAuthority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  assert.deepEqual(eventTypes(requireKind(walkWest(openEncounterWithInput(shortAuthority, encounterInput).scenario,
    shortAuthority), "committed").events), ["MovementSegmentCommitted"]);

  brute.mechanics.definition.content.intrinsicAbilities[0].target.reachInches = "120";
  const longAuthority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  const offered = requireKind(walkWest(openEncounterWithInput(longAuthority, encounterInput).scenario, longAuthority), "awaitingInput");
  assert.equal(offered.result.pending.controllerEntityId, BRUTE_ID);
});

test("an NPC that cannot see the player walking away gets no opportunity attack", () => {
  // Bob walks out of Brute's reach after his blinding dust took Brute's sight.
  const initialState = structuredClone(INITIAL_STATE);
  initialState.definitions["ability:bob-blinding-dust"] = registered({
    definitionId: "ability:bob-blinding-dust",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "action" },
    target: { kind: "creature", count: "1", reachInches: "60" },
    effect: { kind: "grantEffect", condition: "blinded", duration: { kind: "untilEnded" } },
  });
  initialState.entities[BOB_ID].abilityRefs.push("ability:bob-blinding-dust");
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, geometryGenesis(initialState, "blinded-reactor"));
  scenario = endTurns(scenario, authority, "blinded-reactor", [ALICE_ID]);
  const bobWalksAway = (current, rootActionId) => drive(current, {
    kind: "moveCombatant", rootActionId, encounterId: ENCOUNTER_ID, sourceEntityId: BOB_ID, movementMode: "walk",
    path: [{ x: "60", y: "60", elevation: "0" }, { x: "60", y: "240", elevation: "0" }],
  }, authority);
  // While Brute can see, the same walk offers it the attack.
  assert.equal(requireKind(bobWalksAway(scenario, "root:bob-walks-away-seen"), "awaitingInput").result.pending.controllerEntityId, BRUTE_ID);

  scenario = requireKind(invoke(scenario, authority, "root:bob-blinds-brute", BOB_ID, "ability:bob-blinding-dust",
    { targetEntityId: BRUTE_ID }), "committed").scenario;
  const walked = requireKind(bobWalksAway(scenario, "root:bob-walks-away-unseen"), "committed");
  assert.deepEqual(eventTypes(walked.events), ["MovementSegmentCommitted"]);
  assert.deepEqual(replayed(walked.scenario.eventLog, walked.scenario.genesis).state, walked.result.state);
});

test("a player offered an opportunity attack by an NPC walking away sees the attack among the choices", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  let { scenario } = openEncounter(authority);
  scenario = endTurns(scenario, authority, "player-choice", [ALICE_ID, BOB_ID]);
  const offered = requireKind(drive(scenario, {
    kind: "moveCombatant", rootActionId: "root:brute-walks-away-from-alice", encounterId: ENCOUNTER_ID,
    sourceEntityId: BRUTE_ID, movementMode: "walk",
    path: [{ x: "60", y: "0", elevation: "0" }, { x: "240", y: "0", elevation: "0" }],
  }, authority), "awaitingInput");
  assert.equal(offered.result.pending.kind, "playerChoice");
  const choice = read(offered.scenario, ALICE_VIEWER).pendingInputs
    .find(({ pendingInputId }) => pendingInputId === offered.result.pending.pendingInputId);
  assert.deepEqual(choice.answerOptions.map(({ answer }) => answer), [
    { kind: "useReaction", abilityRef: "action:opportunity-attack", targetEntityId: BRUTE_ID },
    { kind: "decline" },
  ]);
});

test("Dodge gives attacks the dodger can see disadvantage and its Dexterity saves advantage until its next turn starts", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "attack:ability:ash-brute-maul": [0, 0],
    "save:cinder-burst:character:alice": [2, 17],
    "damage:ability:ash-brute-cinder-burst": [0, 0],
  }));
  let { scenario } = openEncounter(authority);
  const targeted = requireKind(invoke(scenario, authority, "root:alice-dodge-takes-no-target", ALICE_ID, "action:dodge",
    { targetEntityId: BRUTE_ID }), "rejected");
  assert.deepEqual(targeted.events, []);
  const dodged = requireKind(invoke(scenario, authority, "root:alice-dodges", ALICE_ID, "action:dodge"), "committed");
  scenario = dodged.scenario;
  assert.equal(dodged.result.mechanicalResult.dodging, true);
  assert.equal(combatEntity(read(scenario, BOB_VIEWER), ALICE_ID).conditions.dodging, true, "others see the Dodge");
  assert.deepEqual(requireKind(invoke(scenario, authority, "root:alice-cannot-dodge-twice", ALICE_ID, "action:dodge"), "rejected").events, []);

  scenario = endTurns(scenario, authority, "dodge-round-1", [ALICE_ID, BOB_ID]);
  const maul = requireKind(invoke(scenario, authority, "root:brute-mauls-dodging-alice", BRUTE_ID, "ability:ash-brute-maul",
    { targetEntityId: ALICE_ID }), "committed");
  scenario = maul.scenario;
  assert.equal(maul.result.mechanicalResult.attack.mode, "disadvantage");
  assert.deepEqual(maul.result.mechanicalResult.attack.disadvantageReasons, ["targetDodging2014"]);

  scenario = endTurns(scenario, authority, "dodge-round-1-brute", [BRUTE_ID]);
  const nextTurn = requireKind(drive(scenario, {
    kind: "endTurn", rootActionId: "root:sentinel-ends-before-alice-turn", sourceEntityId: SENTINEL_ID, encounterId: ENCOUNTER_ID,
  }, authority), "committed");
  scenario = nextTurn.scenario;
  const ended = eventsOfType(nextTurn.events, "ConditionChanged").filter(({ payload }) => payload.entityId === ALICE_ID);
  assert.equal(ended.length, 1);
  assert.equal(ended[0].payload.conditions.dodging, undefined);
  assert.equal(scenario.state.combatRuntime.entities[ALICE_ID].conditions.dodging, undefined, "Dodge ends as her next turn starts");
  assert.equal(scenario.state.combatRuntime.entities[ALICE_ID].conditions.poisoned, true);

  scenario = requireKind(invoke(scenario, authority, "root:alice-dodges-again", ALICE_ID, "action:dodge"), "committed").scenario;
  scenario = endTurns(scenario, authority, "dodge-round-2", [ALICE_ID, BOB_ID]);
  const burst = requireKind(invoke(scenario, authority, "root:brute-bursts-near-dodging-alice", BRUTE_ID,
    "ability:ash-brute-cinder-burst", { areaOrigin: { x: "60", y: "0", elevation: "0" } }), "committed");
  const aliceSave = burst.result.mechanicalResult.saves[ALICE_ID];
  assert.equal(aliceSave.mode, "advantage");
  assert.deepEqual(aliceSave.rolls, [3, 18]);
  assert.equal(aliceSave.roll, 18);
  assert.equal(burst.result.mechanicalResult.saves[BOB_ID].mode, "normal");
});

// SPEC 0014 §4, SPEC 0004 §4 (ADR 0092): from the combat map a creature lies
// down for no movement and stands up for half its speed, neither taking its
// action; a won shove-away pushes the target 5 feet straight away.
test("on its own turn a creature lies down for nothing and stands for half its speed; a won shove-away pushes 5 feet", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "check:shove:character:alice": [14],
    "check:shove:enemy:ash-brute": [9],
  }));
  let { scenario } = openEncounter(authority);
  assert.deepEqual(requireKind(invoke(scenario, authority, "root:alice-is-not-prone", ALICE_ID, "action:stand-up"), "rejected").events, []);
  const lying = requireKind(invoke(scenario, authority, "root:alice-drops-prone", ALICE_ID, "action:drop-prone"), "committed");
  scenario = lying.scenario;
  assert.deepEqual(eventTypes(lying.events), ["AbilityInvoked", "ConditionChanged"]);
  let alice = combatEntity(read(scenario, ALICE_VIEWER), ALICE_ID);
  assert.equal(alice.conditions.prone, true);
  assert.equal(alice.turn.action, "1", "lying down takes no action");
  assert.equal(scenario.state.combatRuntime.entities[ALICE_ID].movement.spentMilliInches, "0");
  assert.deepEqual(requireKind(invoke(scenario, authority, "root:alice-already-prone", ALICE_ID, "action:drop-prone"), "rejected").events, []);

  const stood = requireKind(invoke(scenario, authority, "root:alice-stands-up", ALICE_ID, "action:stand-up"), "committed");
  scenario = stood.scenario;
  assert.deepEqual(eventTypes(stood.events), ["AbilityInvoked", "ConditionChanged"]);
  alice = combatEntity(read(scenario, ALICE_VIEWER), ALICE_ID);
  assert.equal(alice.conditions.prone, undefined);
  assert.equal(alice.turn.action, "1", "standing takes no action");
  assert.equal(scenario.state.combatRuntime.entities[ALICE_ID].movement.spentMilliInches, "180000", "half of 30 feet");

  // Brute stands 5 feet east; a won shove-away moves it to 10 feet, and the
  // push replays though Brute exists only in the encounter.
  const pushed = requireKind(invoke(scenario, authority, "root:alice-shoves-brute-away", ALICE_ID, "action:shove-away",
    { targetEntityId: BRUTE_ID, defenderContestAbility: "athletics" }), "committed");
  scenario = pushed.scenario;
  assert.equal(pushed.result.mechanicalResult.contest.winnerEntityId, ALICE_ID);
  assert.equal(pushed.result.mechanicalResult.pushed, true);
  assertIncludesEventTypes(pushed.events, ["CreaturePushed"]);
  const brute = combatEntity(read(scenario, ALICE_VIEWER), BRUTE_ID);
  assert.deepEqual(brute.position, { x: "120", y: "0", elevation: "0" });
  assert.equal(brute.conditions?.prone, undefined, "pushed, not knocked down");

  // With 20 of 30 feet walked, half the speed is no longer left to stand.
  const walker = new DeterministicRoomAuthority(commonInitiativeEntropy());
  let { scenario: spent } = openEncounter(walker);
  spent = requireKind(opportunityDeclined(drive(spent, { kind: "moveCombatant", rootActionId: "root:alice-walks-20-feet", encounterId: ENCOUNTER_ID,
    sourceEntityId: ALICE_ID, movementMode: "walk", path: [{ x: "0", y: "0", elevation: "0" }, { x: "0", y: "-240", elevation: "0" }] }, walker),
  walker, BRUTE_ID, "response:brute-lets-alice-walk"), "committed").scenario;
  spent = requireKind(invoke(spent, walker, "root:alice-drops-after-walking", ALICE_ID, "action:drop-prone"), "committed").scenario;
  assert.deepEqual(requireKind(invoke(spent, walker, "root:alice-cannot-stand", ALICE_ID, "action:stand-up"), "rejected").events, []);
});

test("Dodge imposes no disadvantage on an attacker the dodger cannot see", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({ "attack:ability:ash-brute-maul": [0, 0] }));
  const initialState = structuredClone(INITIAL_STATE);
  initialState.entities[ALICE_ID].conditions = { poisoned: true, blinded: true };
  const genesis = geometryGenesis(initialState, "blinded-dodger");
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, genesis);
  scenario = requireKind(invoke(scenario, authority, "root:blinded-alice-dodges", ALICE_ID, "action:dodge"), "committed").scenario;
  scenario = endTurns(scenario, authority, "blinded-dodge", [ALICE_ID, BOB_ID]);
  const maul = requireKind(invoke(scenario, authority, "root:brute-mauls-blinded-dodger", BRUTE_ID, "ability:ash-brute-maul",
    { targetEntityId: ALICE_ID }), "committed");
  assert.equal(maul.result.mechanicalResult.attack.mode, "advantage");
  assert.deepEqual(maul.result.mechanicalResult.attack.advantageReasons, ["targetCondition2014"]);
  assert.deepEqual(maul.result.mechanicalResult.attack.disadvantageReasons, []);
});

test("Dodge ends once the dodger's speed drops to 0, and a grappled creature gains nothing from it", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "check:grapple:enemy:ash-brute": [18],
    "check:grapple:character:alice": [0, 0],
  }));
  let { scenario } = openEncounter(authority);
  scenario = requireKind(invoke(scenario, authority, "root:alice-dodges-before-grapple", ALICE_ID, "action:dodge"), "committed").scenario;
  scenario = endTurns(scenario, authority, "dodge-grapple", [ALICE_ID, BOB_ID]);

  // SPEC 0012 §6.3: the target player privately chooses, before either die.
  const pending = requireKind(invoke(scenario, authority, "root:brute-grapples-dodging-alice", BRUTE_ID, "action:grapple",
    { targetEntityId: ALICE_ID }), "awaitingInput");
  const grappled = requireKind(answerPending(pending.scenario, pending.result.pending,
    { kind: "contestDefense", skill: "acrobatics" }, authority, "response:alice-defends-grapple"), "committed");
  scenario = grappled.scenario;
  assert.equal(grappled.result.mechanicalResult.contest.winnerEntityId, BRUTE_ID);
  const changes = eventsOfType(grappled.events, "ConditionChanged").map(({ payload }) => payload.conditions);
  assert.equal(changes.length, 2);
  assert.equal(changes[0].dodging, true);
  assert.equal(changes[1].dodging, undefined, "the grapple's 0 speed ends the Dodge");
  assert.deepEqual(scenario.state.combatRuntime.entities[ALICE_ID].conditions, { poisoned: true, grappledBy: BRUTE_ID });

  scenario = endTurns(scenario, authority, "dodge-grapple-rest", [BRUTE_ID, SENTINEL_ID]);
  const useless = requireKind(invoke(scenario, authority, "root:grappled-alice-dodges", ALICE_ID, "action:dodge"), "committed");
  assert.equal(useless.result.mechanicalResult.dodging, false);
  assert.equal(useless.scenario.state.combatRuntime.entities[ALICE_ID].turn.action, "0");
  assert.equal(useless.scenario.state.combatRuntime.entities[ALICE_ID].conditions.dodging, undefined);
});

test("grapple and shove let an NPC target resist with its better skill, and stay Attack replacements", () => {
  const entropy = {
    "check:grapple:character:alice": [14, 14],
    "check:grapple:enemy:ash-brute": [0],
    "check:shove:character:alice": [14, 14],
    "check:shove:enemy:ash-brute": [0],
  };
  {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy(entropy));
    let { scenario } = openEncounter(authority);
    const offTurn = requireKind(invoke(scenario, authority, "root:bob-cannot-grapple-on-alice-turn", BOB_ID, "action:grapple",
      { targetEntityId: BRUTE_ID }), "rejected");
    assert.deepEqual(offTurn.events, []);

    // The brute's Strength 18 beats its Dexterity 12, so it resists with Athletics.
    const grapple = requireKind(invoke(scenario, authority, "root:alice-grapples-brute-unnamed", ALICE_ID, "action:grapple",
      { targetEntityIds: [BRUTE_ID] }), "committed");
    scenario = grapple.scenario;
    assert.equal(grapple.result.mechanicalResult.contest.defenderAbility, "athletics");
    const request = authority.observedRequests.find(({ purposeKey }) => purposeKey === "check:grapple:enemy:ash-brute");
    assert.equal(request.frozenParameters.ability, "athletics");
    assert.equal(request.frozenParameters.modifier, 4);
    assert.equal(scenario.state.combatRuntime.entities[BRUTE_ID].conditions.grappledBy, ALICE_ID);

    // The second attack of the same Attack action shoves under the same rule.
    const shove = requireKind(invoke(scenario, authority, "root:alice-shoves-brute-unnamed", ALICE_ID, "action:shove",
      { targetEntityId: BRUTE_ID }), "committed");
    scenario = shove.scenario;
    assert.equal(shove.result.mechanicalResult.contest.defenderAbility, "athletics");
    assert.equal(scenario.state.combatRuntime.entities[BRUTE_ID].conditions.prone, true);

    const spent = requireKind(invoke(scenario, authority, "root:alice-has-no-attack-left", ALICE_ID, "action:grapple",
      { targetEntityId: BRUTE_ID }), "rejected");
    assert.deepEqual(spent.events, []);
  }
  {
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy(entropy));
    const encounterInput = structuredClone(START_DYNAMIC_ENCOUNTER);
    const brute = encounterInput.dynamicEntities.find(({ entityId }) => entityId === BRUTE_ID);
    // A weak brute (Strength 6, Dexterity 12) resists with Acrobatics instead;
    // its initiative, which reads Dexterity, is unchanged.
    brute.mechanics.definition.content.stats = { str: "6", dex: "12", con: "16", int: "8", wis: "10", cha: "8" };
    const { scenario } = openEncounterWithInput(authority, encounterInput);
    const grapple = requireKind(invoke(scenario, authority, "root:alice-grapples-weak-brute", ALICE_ID, "action:grapple",
      { targetEntityId: BRUTE_ID }), "committed");
    assert.equal(grapple.result.mechanicalResult.contest.defenderAbility, "acrobatics");
    const request = authority.observedRequests.find(({ purposeKey }) => purposeKey === "check:grapple:enemy:ash-brute");
    assert.equal(request.frozenParameters.ability, "acrobatics");
    assert.equal(request.frozenParameters.modifier, 1);
  }
});

// SPEC 0012 §6.3, SPEC 0004 §4 (ADR 0097): Hide on the combat map rolls
// Dexterity (Stealth); from then on each opponent that can see the hider rolls
// Perception, with the Room's dice, at the start of its turn. A total plus the
// cover adjustment that reaches the Stealth total finds the hider.
const YARD = "scene:burning-mill-yard";
const perceptionKey = (hiderRef, perceiverRef) => `hidden-perception:${hiderRef}:${perceiverRef}`;
/** The tape entry that makes `face` the d20 face (DeterministicRoomAuthority adds one). */
const faceEntropy = (face) => face - 1;

function endTurn(scenario, authority, rootActionId, sourceEntityId) {
  return requireKind(drive(scenario, { kind: "endTurn", rootActionId, sourceEntityId, encounterId: ENCOUNTER_ID }, authority), "committed");
}

test("Hide rolls Stealth on the map; a creature's turn start rolls Perception and finds the hider only at or above the total", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "check:stealth:character:alice": [14, 14],
    [perceptionKey(ALICE_ID, SENTINEL_ID)]: [0, 0],
  }));
  let { scenario } = openEncounter(authority);
  const offTurn = requireKind(invoke(scenario, authority, "root:bob-cannot-hide-on-alice-turn", BOB_ID, "action:hide"), "rejected");
  assert.deepEqual(offTurn.events, []);
  const hid = requireKind(invoke(scenario, authority, "root:alice-hides", ALICE_ID, "action:hide"), "committed");
  scenario = hid.scenario;
  const stealth = authority.observedRequests.find(({ purposeKey }) => purposeKey === "check:stealth:character:alice");
  // The player rolls her own check; poison gives it disadvantage.
  assert.equal(stealth.frozenParameters.sourceEntityId, ALICE_ID);
  assert.deepEqual([stealth.frozenParameters.ability, stealth.frozenParameters.skill, stealth.frozenParameters.mode], ["dex", "stealth", "disadvantage"]);
  const stealthTotal = 15 + stealth.frozenParameters.modifier;
  assert.deepEqual(hid.result.mechanicalResult, { abilityRef: "action:hide", activation: "action", hidden: true });
  assert.deepEqual(scenario.state.combatRuntime.entities[ALICE_ID].conditions.hidden, { stealthTotal: String(stealthTotal) });
  assert.equal(scenario.state.combatRuntime.entities[ALICE_ID].turn.action, "0", "Hide takes the action");
  assert.doesNotMatch(JSON.stringify(eventsOfType(hid.events, "AbilityInvoked")), new RegExp(`"stealthTotal"`));
  // The brute no longer sees her; her ally still does.
  const bruteView = read(scenario, BRUTE_VIEWER);
  assert.equal((bruteView.entities ?? bruteView.combat?.entities)?.[ALICE_ID], undefined);
  assert.ok(combatEntity(read(scenario, BOB_VIEWER), ALICE_ID));

  const modifier = perceptionModifier(PROFILES, scenario.state, BRUTE_ID);
  const below = stealthTotal - 5 - modifier - 1, at = stealthTotal - 5 - modifier;
  authority.entropyByPurpose.set(perceptionKey(ALICE_ID, BRUTE_ID), [faceEntropy(below), faceEntropy(at)]);
  scenario = endTurn(scenario, authority, "root:hide:end:alice", ALICE_ID).scenario;
  const bruteTurn = endTurn(scenario, authority, "root:hide:end:bob", BOB_ID);
  scenario = bruteTurn.scenario;
  // Bob is her ally and rolled nothing at his turn start; the brute, beside
  // her with no cover between, rolls at its own.
  assert.deepEqual(eventsOfType(bruteTurn.events, "HiddenPerceptionRolled").map(({ payload }) => payload), [{
    hiderRef: ALICE_ID, sceneRef: YARD, stealthTotal: String(stealthTotal),
    rolls: [{ perceiverRef: BRUTE_ID, roll: below, modifier, coverAdjustment: 5, total: stealthTotal - 1 }], foundByRef: null,
  }]);
  assert.equal(eventTypes(bruteTurn.events).indexOf("TurnStarted") < eventTypes(bruteTurn.events).indexOf("HiddenPerceptionRolled"), true);
  assert.ok(scenario.state.combatRuntime.entities[ALICE_ID].conditions.hidden, "one below the total does not find her");
  const request = authority.observedRequests.find(({ purposeKey }) => purposeKey === perceptionKey(ALICE_ID, BRUTE_ID));
  assert.deepEqual(request.frozenParameters, { hiderRef: ALICE_ID, perceiverRef: BRUTE_ID, sceneRef: YARD });
  assert.deepEqual(scenario.state.combatRuntime.randomnessResolutions, {}, "the roll settles its resolution");

  for (const [rootActionId, sourceEntityId] of [["root:hide:end:brute", BRUTE_ID], ["root:hide:end:sentinel", SENTINEL_ID],
    ["root:hide:end:alice-2", ALICE_ID]]) scenario = endTurn(scenario, authority, rootActionId, sourceEntityId).scenario;
  const found = endTurn(scenario, authority, "root:hide:end:bob-2", BOB_ID);
  scenario = found.scenario;
  assert.deepEqual(eventsOfType(found.events, "HiddenPerceptionRolled").map(({ payload }) => [payload.rolls[0].total, payload.foundByRef]),
    [[stealthTotal, BRUTE_ID]]);
  assert.equal(scenario.state.combatRuntime.entities[ALICE_ID].conditions.hidden, undefined, "reaching the total ends the hiding");
  assert.equal(scenario.state.combatRuntime.entities[ALICE_ID].conditions.poisoned, true);
  // Replaying the stored events rebuilds the very state the step returned.
  assert.deepEqual(replayed(found.scenario.eventLog).state, found.result.state);
});

const BLINDING_DUST = Object.freeze({
  definitionId: "ability:bob-blinding-dust",
  revision: "1",
  rulesBasis: "srd5.1-2014",
  activation: { kind: "action" },
  target: { kind: "creature", count: "1", reachInches: "60" },
  effect: { kind: "grantEffect", condition: "blinded", duration: { kind: "untilEnded" } },
});

test("a creature that is blinded, or that the hider is behind full cover from, rolls nothing at its turn start", () => {
  {
    // Alice hides inside the closed walls north-east of the brute.
    const initialState = structuredClone(INITIAL_STATE);
    initialState.entities[ALICE_ID].position = { x: "180", y: "-120", elevation: "0" };
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({ "check:stealth:character:alice": [9, 9] }));
    let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, geometryGenesis(initialState, "hide-full-cover"));
    scenario = requireKind(invoke(scenario, authority, "root:walled-alice-hides", ALICE_ID, "action:hide"), "committed").scenario;
    assert.equal(hideCover(scenario.state, BRUTE_ID, ALICE_ID), "full");
    assert.equal(hideCover(scenario.state, SENTINEL_ID, ALICE_ID), "full");
    const events = [];
    for (const [rootActionId, sourceEntityId] of [["root:walled:end:alice", ALICE_ID], ["root:walled:end:bob", BOB_ID],
      ["root:walled:end:brute", BRUTE_ID]]) {
      const ended = endTurn(scenario, authority, rootActionId, sourceEntityId);
      events.push(...ended.events);
      scenario = ended.scenario;
    }
    assert.deepEqual(eventTypes(events).filter((type) => ["RandomnessRequested", "HiddenPerceptionRolled"].includes(type)), []);
    assert.ok(scenario.state.combatRuntime.entities[ALICE_ID].conditions.hidden);
  }
  {
    // Bob's dust takes the brute's sight before its turn; the sentinel still looks.
    const initialState = structuredClone(INITIAL_STATE);
    initialState.definitions[BLINDING_DUST.definitionId] = registered(BLINDING_DUST);
    initialState.entities[BOB_ID].abilityRefs.push(BLINDING_DUST.definitionId);
    const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
      "check:stealth:character:alice": [9, 9],
      [perceptionKey(ALICE_ID, SENTINEL_ID)]: [0],
    }));
    let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, geometryGenesis(initialState, "hide-blinded"));
    scenario = requireKind(invoke(scenario, authority, "root:alice-hides-from-blind-brute", ALICE_ID, "action:hide"), "committed").scenario;
    scenario = endTurn(scenario, authority, "root:blind:end:alice", ALICE_ID).scenario;
    scenario = requireKind(invoke(scenario, authority, "root:bob-blinds-brute-for-alice", BOB_ID, BLINDING_DUST.definitionId,
      { targetEntityId: BRUTE_ID }), "committed").scenario;
    const bruteTurn = endTurn(scenario, authority, "root:blind:end:bob", BOB_ID);
    assert.deepEqual(eventsOfType(bruteTurn.events, "HiddenPerceptionRolled"), []);
    const sentinelTurn = endTurn(bruteTurn.scenario, authority, "root:blind:end:brute", BRUTE_ID);
    assert.deepEqual(eventsOfType(sentinelTurn.events, "HiddenPerceptionRolled")
      .map(({ payload }) => [payload.rolls.map(({ perceiverRef }) => perceiverRef), payload.foundByRef]), [[[SENTINEL_ID], null]]);
    assert.ok(sentinelTurn.scenario.state.combatRuntime.entities[ALICE_ID].conditions.hidden);
  }
});

/** The brute hides on its turn; nobody finds it before Alice's next turn. */
function bruteHidden(extraEntropy = {}, genesis = ROOM_GENESIS) {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "check:stealth:enemy:ash-brute": [9],
    [perceptionKey(BRUTE_ID, ALICE_ID)]: [0],
    ...extraEntropy,
  }));
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, genesis);
  scenario = endTurns(scenario, authority, "brute-hides", [ALICE_ID, BOB_ID]);
  const hid = requireKind(invoke(scenario, authority, "root:brute-hides", BRUTE_ID, "action:hide"), "committed");
  scenario = hid.scenario;
  const stealth = authority.observedRequests.find(({ purposeKey }) => purposeKey === "check:stealth:enemy:ash-brute");
  scenario = endTurns(scenario, authority, "brute-hides-round", [BRUTE_ID, SENTINEL_ID]);
  return { authority, scenario, stealth, stealthTotal: 10 + stealth.frozenParameters.modifier, hid };
}

test("Search rolls Perception and finds a hider in sight whose Stealth total it reaches, ending the hiding for everyone", () => {
  const { authority, scenario: hidden, stealth, stealthTotal } = bruteHidden({ "check:perception:character:alice": [19, 19] });
  let scenario = hidden;
  assert.equal(stealth.frozenParameters.mode, "normal");
  // An NPC's hiding hides it from the players; its own side still sees it.
  const aliceView = read(scenario, ALICE_VIEWER);
  assert.equal((aliceView.entities ?? aliceView.combat?.entities)?.[BRUTE_ID], undefined);
  assert.ok(combatEntity(read(scenario, SENTINEL_VIEWER), BRUTE_ID));
  assert.ok(scenario.state.combatRuntime.entities[BRUTE_ID].conditions.hidden, "Alice's turn-start roll fell short");

  const searched = requireKind(invoke(scenario, authority, "root:alice-searches", ALICE_ID, "action:search"), "committed");
  scenario = searched.scenario;
  const request = authority.observedRequests.find(({ purposeKey }) => purposeKey === "check:perception:character:alice");
  assert.deepEqual([request.frozenParameters.sourceEntityId, request.frozenParameters.skill, request.frozenParameters.mode],
    [ALICE_ID, "perception", "disadvantage"]);
  const modifier = request.frozenParameters.modifier;
  assert.deepEqual(searched.result.mechanicalResult, { abilityRef: "action:search", activation: "action", foundRefs: [BRUTE_ID] });
  assert.deepEqual(eventsOfType(searched.events, "HiddenPerceptionRolled").map(({ payload }) => payload), [{
    hiderRef: BRUTE_ID, sceneRef: YARD, stealthTotal: String(stealthTotal),
    rolls: [{ perceiverRef: ALICE_ID, roll: 20, modifier, coverAdjustment: 5, total: 25 + modifier }], foundByRef: ALICE_ID,
  }]);
  assert.equal(scenario.state.combatRuntime.entities[BRUTE_ID].conditions.hidden, undefined);
  assert.ok(combatEntity(read(scenario, BOB_VIEWER), BRUTE_ID), "found by one, seen by all");
  assert.equal(scenario.state.combatRuntime.entities[ALICE_ID].turn.action, "0", "Search takes the action");
  assert.deepEqual(replayed(searched.scenario.eventLog).state, searched.result.state);
});

const ALICE_SWORD = Object.freeze({
  definitionId: "ability:alice-shortsword",
  revision: "1",
  rulesBasis: "srd5.1-2014",
  activation: { kind: "attack", actionGrant: "attack" },
  target: { kind: "creature", count: "1", reachInches: "60" },
  attack: { ability: "str", proficiency: true },
  damage: [{ type: "piercing", formula: "1d6+3" }],
});

/** The operation an attack froze with its dice, which only Rules reads. */
function aimedOperation(events, abilityRef) {
  return eventsOfType(events, "RandomnessRequested").map(({ payload }) => payload.resolution.operation)
    .find((operation) => operation.abilityRef === abilityRef);
}

function swordGenesis(suffix, edit = () => {}) {
  const initialState = structuredClone(INITIAL_STATE);
  initialState.definitions[ALICE_SWORD.definitionId] = registered(ALICE_SWORD);
  initialState.entities[ALICE_ID].abilityRefs.push(ALICE_SWORD.definitionId);
  edit(initialState);
  return geometryGenesis(initialState, suffix);
}

test("an attack at a creature the attacker cannot see names a point: disadvantage there, a miss anywhere else", () => {
  const { authority, scenario: hidden } = bruteHidden({ ["attack:alice-shortsword"]: [19, 19, 19, 19] },
    swordGenesis("aimed-attack"));
  let scenario = hidden;
  const bruteHp = Number(scenario.state.combatRuntime.entities[BRUTE_ID].hitPoints.current);
  // The brute is no legal target by name, and a point out of reach is refused.
  assert.deepEqual(requireKind(invoke(scenario, authority, "root:alice-names-hidden-brute", ALICE_ID, ALICE_SWORD.definitionId,
    { targetEntityId: BRUTE_ID }), "rejected").events, []);
  assert.deepEqual(requireKind(invoke(scenario, authority, "root:alice-aims-too-far", ALICE_ID, ALICE_SWORD.definitionId,
    { targetPoint: { x: "600", y: "0", elevation: "0" } }), "rejected").events, []);
  // A weapon that needs its target in sight cannot be aimed at a point.
  assert.deepEqual(requireKind(invoke(scenario, authority, "root:alice-aims-sighted-blade", ALICE_ID, "ability:alice-resonant-blade",
    { targetPoint: { x: "60", y: "0", elevation: "0" } }), "rejected").events, []);

  const right = requireKind(invoke(scenario, authority, "root:alice-aims-at-brute", ALICE_ID, ALICE_SWORD.definitionId,
    { targetPoint: { x: "60", y: "0", elevation: "0" } }), "committed");
  scenario = right.scenario;
  // Her roll names only the point; Rules keeps the real mode to itself.
  const frozen = authority.observedRequests.filter(({ purposeKey }) => purposeKey === "attack:alice-shortsword");
  assert.deepEqual([frozen[0].diceExpression, Object.keys(frozen[0].frozenParameters).sort()],
    ["2d20", ["aimedPoint", "attackBonus", "sourceEntityId"]]);
  assert.deepEqual(frozen[0].frozenParameters.aimedPoint, { x: "60", y: "0", elevation: "0" });
  const rightOperation = aimedOperation(right.events, ALICE_SWORD.definitionId);
  assert.equal(rightOperation.mechanical.attack.mode, "disadvantage");
  assert.deepEqual(rightOperation.mechanical.attack.disadvantageReasons, ["poisoned2014", "unseenTarget2014"]);
  const ATTACK_KEYS = ["aimedPoint", "attackBonus", "cover", "criticalIfHit", "hit", "rolls", "selected", "total"];
  assert.deepEqual(Object.keys(right.result.mechanicalResult.attack).sort(), ATTACK_KEYS);
  assert.equal(right.result.mechanicalResult.attack.hit, true);
  assert.equal(eventsOfType(right.events, "DamagePacketResolved")[0].payload.targetEntityId, BRUTE_ID);
  assert.ok(Number(scenario.state.combatRuntime.entities[BRUTE_ID].hitPoints.current) < bruteHp);
  assert.ok(scenario.state.combatRuntime.entities[BRUTE_ID].conditions.hidden, "being hit does not reveal the hider");

  // Her second attack guesses an empty square: the same twenties miss, and
  // the record has the same keys a right guess leaves.
  const wrong = requireKind(invoke(scenario, authority, "root:alice-aims-at-nothing", ALICE_ID, ALICE_SWORD.definitionId,
    { targetPoint: { x: "-60", y: "0", elevation: "0" } }), "committed");
  assert.deepEqual(Object.keys(wrong.result.mechanicalResult.attack).sort(), ATTACK_KEYS);
  assert.deepEqual([wrong.result.mechanicalResult.attack.selected, wrong.result.mechanicalResult.attack.hit], [20, false]);
  assert.deepEqual(eventsOfType(wrong.events, "DamagePacketResolved"), []);
  const missFrozen = authority.observedRequests.filter(({ purposeKey }) => purposeKey === "attack:alice-shortsword")[1];
  assert.deepEqual([missFrozen.diceExpression, Object.keys(missFrozen.frozenParameters).sort()],
    [frozen[0].diceExpression, Object.keys(frozen[0].frozenParameters).sort()]);
  assert.equal(aimedOperation(wrong.events, ALICE_SWORD.definitionId).mechanical.attack.mode, "disadvantage");
  // Damage dice are asked for either way, so the count of rolls tells nothing.
  assert.equal(authority.observedRequests.filter(({ purposeKey }) => purposeKey === "damage:alice-shortsword").length, 2);
  assert.equal(wrong.scenario.state.combatRuntime.entities[ALICE_ID].turn.attacksRemaining, "0");
  assert.deepEqual(replayed(wrong.scenario.eventLog, wrong.scenario.genesis).state, wrong.result.state);
});

test("a hidden attacker attacks with advantage and is revealed, hit or miss; an NPC aims at a hidden player by a point", () => {
  const genesis = swordGenesis("hidden-attacker", (state) => {
    state.entities[ALICE_ID].conditions = {};
    state.entities[ALICE_ID].hitPoints.current = "24";
  });
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "check:stealth:character:alice": [19],
    [perceptionKey(ALICE_ID, BRUTE_ID)]: [0, 0],
    [perceptionKey(ALICE_ID, SENTINEL_ID)]: [0, 0],
    "attack:ability:ash-brute-maul": [18, 18],
    ["attack:alice-shortsword"]: [0, 0],
  }));
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, genesis);
  scenario = requireKind(invoke(scenario, authority, "root:alice-hides-to-strike", ALICE_ID, "action:hide"), "committed").scenario;
  scenario = endTurns(scenario, authority, "hidden-attacker", [ALICE_ID, BOB_ID]);

  // The brute cannot name her; Rules offers it a point instead, and the
  // right point is an attack with disadvantage.
  const asked = requireKind(invoke(scenario, authority, "root:brute-looks-for-alice", BRUTE_ID, "ability:ash-brute-maul"), "awaitingInput");
  assert.equal(asked.result.pending.kind, "kpDecision");
  assert.equal(asked.result.pending.pointAimAllowed, true);
  assert.equal(asked.result.pending.candidateEntityIds.includes(ALICE_ID), false);
  const mauled = requireKind(answerPending(asked.scenario, asked.result.pending, { kind: "selectPoint", point: { x: "0", y: "0" } },
    authority, "response:brute-swings-at-alice-square"), "committed");
  scenario = mauled.scenario;
  const maul = aimedOperation(mauled.events, "ability:ash-brute-maul");
  assert.deepEqual([maul.targetEntityIds, maul.mechanical.attack.mode, maul.mechanical.attack.disadvantageReasons],
    [[ALICE_ID], "disadvantage", ["unseenTarget2014"]]);
  assert.equal(eventsOfType(mauled.events, "DamagePacketResolved")[0].payload.targetEntityId, ALICE_ID);
  assert.ok(scenario.state.combatRuntime.entities[ALICE_ID].conditions.hidden, "the brute's blow does not reveal her");

  scenario = endTurns(scenario, authority, "hidden-attacker-round", [BRUTE_ID, SENTINEL_ID]);
  const struck = requireKind(invoke(scenario, authority, "root:hidden-alice-strikes", ALICE_ID, ALICE_SWORD.definitionId,
    { targetEntityId: BRUTE_ID }), "committed");
  assert.deepEqual([struck.result.mechanicalResult.attack.mode, struck.result.mechanicalResult.attack.advantageReasons],
    ["advantage", ["unseenAttacker2014"]]);
  assert.equal(struck.result.mechanicalResult.attack.hit, false);
  const revealed = eventsOfType(struck.events, "ConditionChanged").filter(({ payload }) => payload.entityId === ALICE_ID);
  assert.equal(revealed.length, 1);
  assert.equal(revealed[0].payload.conditions.hidden, undefined, "the attack reveals her though it missed");
  assert.equal(struck.scenario.state.combatRuntime.entities[ALICE_ID].conditions.hidden, undefined);
  assert.deepEqual(replayed(struck.scenario.eventLog, struck.scenario.genesis).state, struck.result.state);
});

// SPEC 0012 §6.3 (ADR 0099 decision 1), SRD 5.1 Help.
const BOB_DAGGER = Object.freeze({
  definitionId: "ability:bob-dagger",
  revision: "1",
  rulesBasis: "srd5.1-2014",
  activation: { kind: "attack", actionGrant: "attack" },
  target: { kind: "creature", count: "1", reachInches: "60" },
  attack: { ability: "dex", proficiency: true },
  damage: [{ type: "piercing", formula: "1d4+2" }],
});

function daggerGenesis(suffix) {
  const initialState = structuredClone(INITIAL_STATE);
  initialState.definitions[BOB_DAGGER.definitionId] = registered(BOB_DAGGER);
  initialState.entities[BOB_ID].abilityRefs.push(BOB_DAGGER.definitionId);
  return geometryGenesis(initialState, suffix);
}

test("Help gives an ally advantage on its next check, spent by that check, and ends when the helper's next turn starts", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({ "check:grapple:character:bob": [0, 19] }));
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, daggerGenesis("help-check"));
  // An enemy is no ally, and an enemy beyond 5 feet of the helper is no help.
  for (const [rootActionId, parameters] of [["root:alice-helps-brute", { targetEntityId: BRUTE_ID }],
    ["root:alice-helps-against-far-sentinel", { targetEntityId: BOB_ID, againstEntityId: SENTINEL_ID }],
    ["root:alice-helps-nobody", {}]]) {
    assert.deepEqual(requireKind(invoke(scenario, authority, rootActionId, ALICE_ID, "action:help", parameters), "rejected").events, []);
  }
  const helped = requireKind(invoke(scenario, authority, "root:alice-helps-bob-check", ALICE_ID, "action:help",
    { targetEntityId: BOB_ID }), "committed");
  scenario = helped.scenario;
  assert.deepEqual(helped.result.mechanicalResult.help, { targetEntityId: BOB_ID, kind: "check" });
  assert.equal(scenario.state.combatRuntime.entities[ALICE_ID].turn.action, "0", "Help takes the action");
  // With Action Surge she helps again, this time against the brute beside her.
  scenario = requireKind(invoke(scenario, authority, "root:alice-surges-to-help", ALICE_ID, "ability:action-surge"), "committed").scenario;
  scenario = requireKind(invoke(scenario, authority, "root:alice-helps-bob-attack", ALICE_ID, "action:help",
    { targetEntityId: BOB_ID, againstEntityId: BRUTE_ID }), "committed").scenario;
  assert.deepEqual(scenario.state.combatRuntime.entities[BOB_ID].conditions.helped, [
    { helperRef: ALICE_ID, kind: "attack", againstRef: BRUTE_ID },
    { helperRef: ALICE_ID, kind: "check" },
  ]);

  scenario = endTurn(scenario, authority, "root:help-check:end:alice", ALICE_ID).scenario;
  const grappled = requireKind(invoke(scenario, authority, "root:helped-bob-grapples", BOB_ID, "action:grapple",
    { targetEntityId: BRUTE_ID }), "committed");
  scenario = grappled.scenario;
  const check = authority.observedRequests.find(({ purposeKey }) => purposeKey === "check:grapple:character:bob");
  assert.equal(check.frozenParameters.mode, "advantage");
  assert.deepEqual(check.dice, [{ count: "2", sides: "20" }]);
  assert.deepEqual(scenario.state.combatRuntime.entities[BOB_ID].conditions.helped,
    [{ helperRef: ALICE_ID, kind: "attack", againstRef: BRUTE_ID }], "the check spends the check help only");

  // Unspent help lasts until the helper's next turn starts.
  for (const [rootActionId, sourceEntityId] of [["root:help-check:end:bob", BOB_ID], ["root:help-check:end:brute", BRUTE_ID]]) {
    scenario = endTurn(scenario, authority, rootActionId, sourceEntityId).scenario;
  }
  assert.ok(scenario.state.combatRuntime.entities[BOB_ID].conditions.helped);
  const aliceTurn = endTurn(scenario, authority, "root:help-check:end:sentinel", SENTINEL_ID);
  assert.equal(aliceTurn.scenario.state.combatRuntime.entities[BOB_ID].conditions.helped, undefined);
  const expired = eventsOfType(aliceTurn.events, "ConditionChanged").filter(({ payload }) => payload.entityId === BOB_ID);
  assert.equal(expired.length, 1);
  assert.deepEqual(replayed(aliceTurn.scenario.eventLog, aliceTurn.scenario.genesis).state, aliceTurn.result.state);
});

test("Help against an enemy beside the helper gives the ally's first attack on it advantage, spent hit or miss", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({ "attack:ability:bob-dagger": [0, 0] }));
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, daggerGenesis("help-attack"));
  scenario = requireKind(invoke(scenario, authority, "root:alice-distracts-brute", ALICE_ID, "action:help",
    { targetEntityId: BOB_ID, againstEntityId: BRUTE_ID }), "committed").scenario;
  scenario = endTurn(scenario, authority, "root:help-attack:end:alice", ALICE_ID).scenario;
  const stabbed = requireKind(invoke(scenario, authority, "root:helped-bob-stabs", BOB_ID, BOB_DAGGER.definitionId,
    { targetEntityId: BRUTE_ID }), "committed");
  assert.deepEqual([stabbed.result.mechanicalResult.attack.mode, stabbed.result.mechanicalResult.attack.advantageReasons],
    ["advantage", ["helpedAttack2014"]]);
  assert.equal(stabbed.result.mechanicalResult.attack.hit, false);
  assert.equal(stabbed.scenario.state.combatRuntime.entities[BOB_ID].conditions.helped, undefined);
  assert.deepEqual(replayed(stabbed.scenario.eventLog, stabbed.scenario.genesis).state, stabbed.result.state);
});

// SPEC 0012 §8.1 (ADR 0099 decision 3): Ready from the map's inputs -- a
// creature, an event and an ability with its target, or a path.
function readySword(scenario, authority, rootActionId, response) {
  return requireKind(drive(scenario, {
    kind: "readyAction", rootActionId, encounterId: ENCOUNTER_ID, sourceEntityId: ALICE_ID,
    trigger: { kind: "perceivable", event: "turnStarted", sourceEntityId: BRUTE_ID },
    response: response ?? { kind: "invokeAbility", abilityRef: ALICE_SWORD.definitionId, parameters: { targetEntityIds: [BRUTE_ID] } },
  }, authority), "committed");
}

test("a readied attack opens at its trigger and the player uses it with the reaction, or declines and keeps it", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({ "attack:alice-shortsword": [19, 19] }));
  const genesis = swordGenesis("ready-attack");
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, genesis);
  scenario = readySword(scenario, authority, "root:alice-readies-sword").scenario;
  assert.equal(scenario.state.combatRuntime.entities[ALICE_ID].turn.action, "0");
  const opened = (current, suffix) => {
    current = endTurn(current, authority, `root:ready-attack:end:alice:${suffix}`, ALICE_ID).scenario;
    const trigger = requireKind(drive(current, { kind: "endTurn", rootActionId: `root:ready-attack:end:bob:${suffix}`,
      sourceEntityId: BOB_ID, encounterId: ENCOUNTER_ID }, authority), "awaitingInput");
    assert.deepEqual([trigger.result.pending.kind, trigger.result.pending.reactionKind, trigger.result.pending.candidateAbilityRefs],
      ["playerChoice", "ready", [ALICE_SWORD.definitionId]]);
    const choice = read(trigger.scenario, ALICE_VIEWER).pendingInputs
      .find(({ pendingInputId }) => pendingInputId === trigger.result.pending.pendingInputId);
    assert.deepEqual(choice.answerOptions.map(({ answer }) => answer), [{ kind: "useReaction" }, { kind: "decline" }]);
    return trigger;
  };
  const trigger = opened(scenario, "use");
  const bruteHp = Number(trigger.scenario.state.combatRuntime.entities[BRUTE_ID].hitPoints.current);
  const used = requireKind(answerPending(trigger.scenario, trigger.result.pending, { kind: "useReaction" }, authority,
    "response:alice-uses-readied-sword"), "committed");
  assertIncludesEventTypes(used.events, ["ReactionAnswered", "ReadiedActionExpired", "AbilityInvoked", "DamagePacketResolved"]);
  assert.equal(eventsOfType(used.events, "ReadiedActionExpired")[0].payload.reason, "used");
  assert.equal(used.scenario.state.combatRuntime.entities[ALICE_ID].turn.reaction, "0", "the readied attack takes her reaction");
  assert.ok(Number(used.scenario.state.combatRuntime.entities[BRUTE_ID].hitPoints.current) < bruteHp);
  assert.equal(encounterView(read(used.scenario, ALICE_VIEWER)).activeEntityId, BRUTE_ID, "the brute's turn goes on");
  assert.deepEqual(replayed(used.scenario.eventLog, genesis).state, used.result.state);

  const declineAuthority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  let { scenario: other } = openEncounterWithInput(declineAuthority, START_DYNAMIC_ENCOUNTER, swordGenesis("ready-decline"));
  other = readySword(other, declineAuthority, "root:alice-readies-sword-to-decline").scenario;
  other = endTurn(other, declineAuthority, "root:ready-decline:end:alice", ALICE_ID).scenario;
  const declineTrigger = requireKind(drive(other, { kind: "endTurn", rootActionId: "root:ready-decline:end:bob",
    sourceEntityId: BOB_ID, encounterId: ENCOUNTER_ID }, declineAuthority), "awaitingInput");
  const declined = requireKind(answerPending(declineTrigger.scenario, declineTrigger.result.pending, { kind: "decline" },
    declineAuthority, "response:alice-declines-readied-sword"), "committed");
  assert.equal(eventsOfType(declined.events, "ReadiedActionExpired")[0].payload.reason, "declined");
  assert.deepEqual(eventsOfType(declined.events, "AbilityInvoked"), []);
  assert.equal(declined.scenario.state.combatRuntime.entities[ALICE_ID].turn.reaction, "1");
});

test("an NPC's readied attack is the NPC's own pending decision when its trigger comes", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({ "attack:ability:ash-brute-maul": [0] }));
  let { scenario } = openEncounter(authority);
  scenario = endTurns(scenario, authority, "npc-ready", [ALICE_ID, BOB_ID]);
  scenario = requireKind(drive(scenario, {
    kind: "readyAction", rootActionId: "root:brute-readies-maul", encounterId: ENCOUNTER_ID, sourceEntityId: BRUTE_ID,
    trigger: { kind: "perceivable", event: "turnStarted", sourceEntityId: ALICE_ID },
    response: { kind: "invokeAbility", abilityRef: "ability:ash-brute-maul", parameters: { targetEntityId: ALICE_ID } },
  }, authority), "committed").scenario;
  scenario = endTurn(scenario, authority, "root:npc-ready:end:brute", BRUTE_ID).scenario;
  const trigger = requireKind(drive(scenario, { kind: "endTurn", rootActionId: "root:npc-ready:end:sentinel",
    sourceEntityId: SENTINEL_ID, encounterId: ENCOUNTER_ID }, authority), "awaitingInput");
  assert.deepEqual([trigger.result.pending.kind, trigger.result.pending.reactionKind, trigger.result.pending.controllerEntityId],
    ["kpDecision", "ready", BRUTE_ID]);
  const choice = read(trigger.scenario, BRUTE_VIEWER).pendingInputs
    .find(({ pendingInputId }) => pendingInputId === trigger.result.pending.pendingInputId);
  assert.deepEqual(choice.answerOptions.map(({ answer }) => answer), [{ kind: "useReaction" }, { kind: "decline" }]);
  const used = requireKind(answerPending(trigger.scenario, trigger.result.pending, { kind: "useReaction" }, authority,
    "response:brute-uses-readied-maul"), "committed");
  assertIncludesEventTypes(used.events, ["ReadiedActionExpired", "AbilityInvoked"]);
  assert.equal(used.scenario.state.combatRuntime.entities[BRUTE_ID].turn.reaction, "0");
  assert.equal(encounterView(read(used.scenario, ALICE_VIEWER)).activeEntityId, ALICE_ID);
});

test("a readied spell is released at its trigger without a new slot, and the triggering move goes on", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy());
  let { scenario } = openEncounter(authority);
  scenario = endTurn(scenario, authority, "root:ready-spell:end:alice", ALICE_ID).scenario;
  scenario = requireKind(drive(scenario, {
    kind: "readyAction", rootActionId: "root:bob-readies-shatter-for-sentinel", encounterId: ENCOUNTER_ID, sourceEntityId: BOB_ID,
    trigger: { kind: "perceivable", event: "movementCommitted", sourceEntityId: SENTINEL_ID },
    response: { kind: "invokeAbility", abilityRef: "spell:shatter",
      parameters: { slotLevel: "2", areaOrigin: { x: "240", y: "0", elevation: "0" } } },
  }, authority), "committed").scenario;
  for (const [rootActionId, sourceEntityId] of [["root:ready-spell:end:bob", BOB_ID], ["root:ready-spell:end:brute", BRUTE_ID]]) {
    scenario = endTurn(scenario, authority, rootActionId, sourceEntityId).scenario;
  }
  const trigger = requireKind(drive(scenario, { kind: "moveCombatant", rootActionId: "root:sentinel-steps-east",
    encounterId: ENCOUNTER_ID, sourceEntityId: SENTINEL_ID, movementMode: "walk",
    path: [{ x: "180", y: "0", elevation: "0" }, { x: "240", y: "0", elevation: "0" }] }, authority), "awaitingInput");
  assert.equal(trigger.result.pending.reactionKind, "ready");
  const released = requireKind(answerPending(trigger.scenario, trigger.result.pending, { kind: "useReaction" }, authority,
    "response:bob-releases-shatter"), "committed");
  assertIncludesEventTypes(released.events, ["ReadiedActionExpired", "ConcentrationEnded", "SpellResolved"]);
  assert.equal(eventsOfType(released.events, "SpellCastingStarted").length, 0, "no new casting to counter");
  const bob = released.scenario.state.combatRuntime.entities[BOB_ID];
  assert.equal(bob.concentration, null);
  assert.equal(bob.resources["spellSlot:2"].current, "0", "the slot was spent once, when it was readied");
  assert.equal(bob.turn.reaction, "0");
  assert.deepEqual(released.scenario.state.combatRuntime.entities[SENTINEL_ID].position, { x: "240", y: "0", elevation: "0" });
  assert.deepEqual(replayed(released.scenario.eventLog).state, released.result.state);
});

test("a hider whose readied move takes it into the active creature's view meets that creature's Perception roll at once", () => {
  const initialState = structuredClone(INITIAL_STATE);
  initialState.entities[ALICE_ID].position = { x: "0", y: "420", elevation: "0" };
  initialState.entities[ALICE_ID].conditions = {};
  const genesis = geometryGenesis(initialState, "ready-into-view");
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "check:stealth:character:alice": [19],
    [perceptionKey(ALICE_ID, BRUTE_ID)]: [0],
  }));
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, genesis);
  scenario = requireKind(invoke(scenario, authority, "root:walled-alice-hides-to-dash", ALICE_ID, "action:hide"), "committed").scenario;
  scenario = requireKind(invoke(scenario, authority, "root:walled-alice-surges", ALICE_ID, "ability:action-surge"), "committed").scenario;
  scenario = readySword(scenario, authority, "root:walled-alice-readies-move", {
    kind: "move", movementMode: "walk", path: [{ x: "0", y: "420", elevation: "0" }, { x: "240", y: "420", elevation: "0" }],
  }).scenario;
  assert.equal(hideCover(scenario.state, BRUTE_ID, ALICE_ID), "full");
  scenario = endTurn(scenario, authority, "root:into-view:end:alice", ALICE_ID).scenario;
  const trigger = requireKind(drive(scenario, { kind: "endTurn", rootActionId: "root:into-view:end:bob",
    sourceEntityId: BOB_ID, encounterId: ENCOUNTER_ID }, authority), "awaitingInput");
  assert.deepEqual(eventsOfType(trigger.events, "HiddenPerceptionRolled"), [], "behind the wall the brute's turn start rolls nothing");
  const moved = requireKind(answerPending(trigger.scenario, trigger.result.pending, { kind: "useReaction" }, authority,
    "response:alice-steps-out"), "committed");
  assert.notEqual(hideCover(moved.scenario.state, BRUTE_ID, ALICE_ID), "full");
  const types = eventTypes(moved.events);
  assert.ok(types.indexOf("MovementSegmentCommitted") < types.indexOf("HiddenPerceptionRolled"), types.join());
  assert.deepEqual(eventsOfType(moved.events, "HiddenPerceptionRolled").map(({ payload }) =>
    [payload.rolls.map(({ perceiverRef }) => perceiverRef), payload.foundByRef]), [[[BRUTE_ID], null]]);
  assert.ok(moved.scenario.state.combatRuntime.entities[ALICE_ID].conditions.hidden);
  assert.deepEqual(replayed(moved.scenario.eventLog, genesis).state, moved.result.state);
});

// SPEC 0012 §7.2: an opportunity attack is one melee attack with the
// reactor's own weapon, its reach and its dice, rolled as that attack is.
test("an opportunity attack is made with the reactor's best melee weapon and its dice; without one, the fixed attack", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "attack:opportunity:character:alice": [0, 0],
    "attack:opportunity:character:bob": [faceEntropy(20)],
    "damage:opportunity:character:bob": [faceEntropy(3), faceEntropy(3)],
  }));
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, daggerGenesis("weapon-opportunity"));
  scenario = endTurns(scenario, authority, "weapon-opportunity", [ALICE_ID, BOB_ID]);
  const offered = requireKind(drive(scenario, { kind: "moveCombatant", rootActionId: "root:brute-backs-off",
    encounterId: ENCOUNTER_ID, sourceEntityId: BRUTE_ID, movementMode: "walk",
    path: [{ x: "60", y: "0", elevation: "0" }, { x: "240", y: "0", elevation: "0" }] }, authority), "awaitingInput");
  assert.equal(offered.result.pending.controllerEntityId, ALICE_ID);
  // Alice's only melee attack costs a resource, so she swings the fixed one,
  // poisoned: two d20, the lower kept.
  const bobOffered = requireKind(answerPending(offered.scenario, offered.result.pending,
    { kind: "useReaction", abilityRef: "action:opportunity-attack", targetEntityId: BRUTE_ID }, authority, "response:alice-swings"), "awaitingInput");
  const aliceAttack = authority.observedRequests.find(({ purposeKey }) => purposeKey === "attack:opportunity:character:alice");
  const aliceDamage = authority.observedRequests.find(({ purposeKey }) => purposeKey === "damage:opportunity:character:alice");
  assert.deepEqual([aliceAttack.diceExpression, aliceAttack.frozenParameters.mode, aliceDamage.diceExpression], ["2d20", "disadvantage", "2d6"]);
  const aliceSwing = eventsOfType(bobOffered.events, "AbilityInvoked").find(({ payload }) => payload.sourceEntityId === ALICE_ID).payload;
  assert.deepEqual(aliceSwing.mechanicalResult, { attack: { mode: "disadvantage", rolls: [1, 1], roll: 1, total: 5, hit: false } });

  // Bob stabs with his dagger: Dexterity 14 and proficiency, 1d4+2 with the
  // critical die frozen beside it; a natural 20 doubles the dice.
  assert.equal(bobOffered.result.pending.controllerEntityId, BOB_ID);
  const stabbed = requireKind(answerPending(bobOffered.scenario, bobOffered.result.pending,
    { kind: "useReaction", abilityRef: "action:opportunity-attack", targetEntityId: BRUTE_ID }, authority, "response:bob-stabs"), "committed");
  const bobAttack = authority.observedRequests.find(({ purposeKey }) => purposeKey === "attack:opportunity:character:bob");
  const bobDamage = authority.observedRequests.find(({ purposeKey }) => purposeKey === "damage:opportunity:character:bob");
  assert.deepEqual([bobAttack.diceExpression, bobAttack.frozenParameters.mode, bobAttack.frozenParameters.attackBonus, bobDamage.diceExpression],
    ["1d20", "normal", 4, "2d4"]);
  const bobStab = eventsOfType(stabbed.events, "AbilityInvoked").find(({ payload }) => payload.sourceEntityId === BOB_ID).payload;
  assert.deepEqual([bobStab.mechanicalResult.attackAbilityRef, bobStab.mechanicalResult.attack],
    [BOB_DAGGER.definitionId, { mode: "normal", roll: 20, total: 24, hit: true }]);
  const packet = eventsOfType(stabbed.events, "DamagePacketResolved")[0].payload;
  assert.deepEqual([packet.targetEntityId, packet.totalApplied, packet.components.map(({ type }) => type)], [BRUTE_ID, 8, ["piercing"]]);
  assert.deepEqual(stabbed.scenario.state.combatRuntime.entities[BRUTE_ID].position, { x: "240", y: "0", elevation: "0" });
  assert.deepEqual(replayed(stabbed.scenario.eventLog, stabbed.scenario.genesis).state, stabbed.result.state);
});

// SPEC 0004 §4, SPEC 0012 §6.3 (ADR 0097): a Perception roll is the
// perceiver's ability check; its conditions set the mode.
test("a poisoned perceiver rolls its turn-start Perception with disadvantage: two d20 frozen, the lower kept", () => {
  const { authority, scenario } = bruteHidden({ [perceptionKey(BRUTE_ID, ALICE_ID)]: [faceEntropy(20), faceEntropy(2)] });
  const alice = authority.observedRequests.find(({ purposeKey }) => purposeKey === perceptionKey(BRUTE_ID, ALICE_ID));
  assert.deepEqual([alice.diceExpression, alice.frozenParameters],
    ["2d20", { hiderRef: BRUTE_ID, perceiverRef: ALICE_ID, sceneRef: "scene:burning-mill-yard", mode: "disadvantage" }]);
  const rolled = eventsOfType(scenario.eventLog, "HiddenPerceptionRolled").at(-1).payload;
  assert.deepEqual([rolled.rolls.map(({ perceiverRef, roll }) => [perceiverRef, roll]), rolled.foundByRef], [[[ALICE_ID, 2]], null],
    "the 20 would have found it");
  assert.ok(scenario.state.combatRuntime.entities[BRUTE_ID].conditions.hidden);
  // Bob is not poisoned: his roll at his turn start is one d20.
  endTurn(scenario, authority, "root:poisoned-perceiver:end:alice", ALICE_ID);
  const bob = authority.observedRequests.find(({ purposeKey }) => purposeKey === perceptionKey(BRUTE_ID, BOB_ID));
  assert.deepEqual([bob.diceExpression, bob.frozenParameters.mode], ["1d20", undefined]);
});

// SPEC 0012 §6.1 (ADR 0097): every turn start rolls Perception, the one the
// round's death saves bring too.
test("the first turn after the round's death saves rolls its Perception even when a save stabilised a creature", () => {
  const initialState = structuredClone(INITIAL_STATE);
  initialState.entities[BOB_ID].hitPoints.current = "0";
  initialState.entities[BOB_ID].conditions = { unconscious: true, prone: true };
  initialState.entities[BOB_ID].lifeState = "unconscious";
  initialState.entities[BOB_ID].deathSaves = { successes: 2, failures: 0 };
  const genesis = geometryGenesis(initialState, "stable-then-perception");
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "check:stealth:enemy:ash-brute": [9],
    [`death-save:${BOB_ID}`]: [faceEntropy(12)],
    [`stable-recovery:${BOB_ID}`]: [0],
    [perceptionKey(BRUTE_ID, ALICE_ID)]: [faceEntropy(20), faceEntropy(20)],
  }));
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, genesis);
  scenario = endTurns(scenario, authority, "stable-then-perception", [ALICE_ID, BOB_ID]);
  scenario = requireKind(invoke(scenario, authority, "root:brute-hides-before-round-end", BRUTE_ID, "action:hide"), "committed").scenario;
  scenario = endTurns(scenario, authority, "stable-then-perception-round", [BRUTE_ID]);
  const round = endTurn(scenario, authority, "root:stable-then-perception:end:sentinel", SENTINEL_ID);
  assert.equal(round.scenario.state.combatRuntime.entities[BOB_ID].conditions.stable, true);
  const types = eventTypes(round.events);
  assert.ok(types.indexOf("ActivityStarted") < types.indexOf("HiddenPerceptionRolled"), types.join());
  assert.deepEqual(eventsOfType(round.events, "HiddenPerceptionRolled").map(({ payload }) =>
    [payload.hiderRef, payload.rolls.map(({ perceiverRef }) => perceiverRef), payload.foundByRef]), [[BRUTE_ID, [ALICE_ID], ALICE_ID]]);
  assert.equal(round.scenario.state.combatRuntime.entities[BRUTE_ID].conditions.hidden, undefined);
  assert.deepEqual(replayed(round.scenario.eventLog, genesis).state, round.result.state);
});

// SPEC 0012 §6.3 (ADR 0099 decision 1): resisting a grapple is the helped
// creature's own ability check.
test("help on a check counts when the helped creature resists a grapple, and that check spends it", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "check:grapple:enemy:ash-brute": [faceEntropy(2)],
    "check:grapple:character:bob": [faceEntropy(3), faceEntropy(18)],
  }));
  let { scenario } = openEncounter(authority);
  scenario = requireKind(invoke(scenario, authority, "root:alice-helps-bob-hold-out", ALICE_ID, "action:help", { targetEntityId: BOB_ID }),
    "committed").scenario;
  scenario = endTurns(scenario, authority, "defender-help", [ALICE_ID, BOB_ID]);
  const pending = requireKind(invoke(scenario, authority, "root:brute-grabs-helped-bob", BRUTE_ID, "action:grapple",
    { targetEntityId: BOB_ID }), "awaitingInput");
  const grabbed = requireKind(answerPending(pending.scenario, pending.result.pending,
    { kind: "contestDefense", skill: "athletics" }, authority, "response:bob-defends-grapple"), "committed");
  const resist = authority.observedRequests.find(({ purposeKey }) => purposeKey === "check:grapple:character:bob");
  assert.deepEqual([resist.diceExpression, resist.frozenParameters.mode], ["2d20", "advantage"]);
  // The better die, 18, holds out where the 3 would not.
  assert.equal(grabbed.result.mechanicalResult.contest.winnerEntityId, BOB_ID);
  const bob = grabbed.scenario.state.combatRuntime.entities[BOB_ID];
  assert.deepEqual([bob.conditions.helped, bob.conditions.grappledBy], [undefined, undefined]);
  assert.deepEqual(replayed(grabbed.scenario.eventLog).state, grabbed.result.state);
});

// SPEC 0012 §6.3 (ADR 0097 decision 4): a guess at a point tells nothing by
// its dice or its record.
test("an attack aimed at a point freezes two d20 and leaves the same record whatever the guessed creature makes the mode", () => {
  const genesis = swordGenesis("aimed-modes", (state) => {
    state.definitions["ability:bob-blinding-dust"] = registered({
      definitionId: "ability:bob-blinding-dust", revision: "1", rulesBasis: "srd5.1-2014", activation: { kind: "action" },
      target: { kind: "creature", count: "1", reachInches: "60" },
      effect: { kind: "grantEffect", condition: "blinded", duration: { kind: "untilEnded" } },
    });
    state.entities[BOB_ID].abilityRefs.push("ability:bob-blinding-dust");
  });
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "check:stealth:enemy:ash-brute": [9],
    [perceptionKey(BRUTE_ID, ALICE_ID)]: [0, 0],
    "attack:alice-shortsword": [faceEntropy(17), faceEntropy(4), faceEntropy(17), faceEntropy(4)],
  }));
  let { scenario } = openEncounterWithInput(authority, START_DYNAMIC_ENCOUNTER, genesis);
  scenario = endTurns(scenario, authority, "aimed-modes", [ALICE_ID]);
  scenario = requireKind(invoke(scenario, authority, "root:bob-blinds-brute-first", BOB_ID, "ability:bob-blinding-dust",
    { targetEntityId: BRUTE_ID }), "committed").scenario;
  scenario = endTurns(scenario, authority, "aimed-modes-bob", [BOB_ID]);
  scenario = requireKind(invoke(scenario, authority, "root:blind-brute-hides", BRUTE_ID, "action:hide"), "committed").scenario;
  scenario = endTurns(scenario, authority, "aimed-modes-round", [BRUTE_ID, SENTINEL_ID]);
  assert.ok(scenario.state.combatRuntime.entities[BRUTE_ID].conditions.hidden);
  // The blinded brute gives her attack advantage, her poison and not seeing
  // it disadvantage: a right guess rolls normally, an empty square with
  // disadvantage.
  const right = requireKind(invoke(scenario, authority, "root:alice-guesses-right", ALICE_ID, ALICE_SWORD.definitionId,
    { targetPoint: { x: "60", y: "0", elevation: "0" } }), "committed");
  const wrong = requireKind(invoke(right.scenario, authority, "root:alice-guesses-wrong", ALICE_ID, ALICE_SWORD.definitionId,
    { targetPoint: { x: "-60", y: "0", elevation: "0" } }), "committed");
  assert.deepEqual([right, wrong].map(({ events }) => aimedOperation(events, ALICE_SWORD.definitionId).mechanical.attack.mode),
    ["normal", "disadvantage"]);
  const requests = authority.observedRequests.filter(({ purposeKey }) => purposeKey === "attack:alice-shortsword");
  assert.deepEqual(requests.map(({ diceExpression, frozenParameters }) => [diceExpression, Object.keys(frozenParameters).sort()]),
    [["2d20", ["aimedPoint", "attackBonus", "sourceEntityId"]], ["2d20", ["aimedPoint", "attackBonus", "sourceEntityId"]]]);
  const [hit, miss] = [right, wrong].map(({ result }) => result.mechanicalResult.attack);
  assert.deepEqual(Object.keys(hit).sort(), Object.keys(miss).sort());
  assert.equal("mode" in hit, false);
  // The real mode still picks the die: the first for the right guess, the lower for the wrong one.
  assert.deepEqual([hit.rolls, hit.selected, hit.hit, miss.rolls, miss.selected, miss.hit], [[17, 4], 17, true, [17, 4], 4, false]);
  assert.deepEqual(replayed(wrong.scenario.eventLog, genesis).state, wrong.result.state);
});

// SPEC 0012 §8.1 (ADR 0099 decision 3): the map readies a grapple or shove
// against one creature it picked.
test("a grapple readied from the map names one creature; the NPC defender picks its skill when it resolves", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "check:grapple:character:alice": [faceEntropy(18), faceEntropy(18)],
    "check:grapple:enemy:ash-brute": [faceEntropy(2)],
  }));
  const { scenario: opened } = openEncounter(authority);
  const readied = requireKind(drive(opened, { kind: "readyAction", rootActionId: "root:alice-readies-grab", encounterId: ENCOUNTER_ID,
    sourceEntityId: ALICE_ID, trigger: { kind: "perceivable", event: "turnStarted", sourceEntityId: BRUTE_ID },
    response: { kind: "invokeAbility", abilityRef: "action:grapple", parameters: { targetEntityIds: [BRUTE_ID] } } }, authority), "committed");
  const ready = Object.values(readied.scenario.state.combatRuntime.effects).find(({ kind }) => kind === "readiedAction");
  assert.deepEqual(ready.response.parameters, { targetEntityId: BRUTE_ID });
  const scenario = endTurns(readied.scenario, authority, "readied-grab", [ALICE_ID]);
  const trigger = requireKind(drive(scenario, { kind: "endTurn", rootActionId: "root:readied-grab:end:bob", sourceEntityId: BOB_ID,
    encounterId: ENCOUNTER_ID }, authority), "awaitingInput");
  assert.deepEqual([trigger.result.pending.reactionKind, trigger.result.pending.controllerEntityId], ["ready", ALICE_ID]);
  const grabbed = requireKind(answerPending(trigger.scenario, trigger.result.pending, { kind: "useReaction" }, authority,
    "response:alice-grabs-the-brute"), "committed");
  const defence = authority.observedRequests.find(({ purposeKey }) => purposeKey === "check:grapple:enemy:ash-brute");
  assert.ok(["athletics", "acrobatics"].includes(defence.frozenParameters.ability));
  assert.equal(grabbed.scenario.state.combatRuntime.entities[BRUTE_ID].conditions.grappledBy, ALICE_ID);
  assert.deepEqual(replayed(grabbed.scenario.eventLog).state, grabbed.result.state);
  // A readied grapple must name one creature.
  assert.equal(requireKind(drive(opened, { kind: "readyAction", rootActionId: "root:alice-readies-two-grabs", encounterId: ENCOUNTER_ID,
    sourceEntityId: ALICE_ID, trigger: { kind: "perceivable", event: "turnStarted", sourceEntityId: BRUTE_ID },
    response: { kind: "invokeAbility", abilityRef: "action:grapple", parameters: { targetEntityIds: [BRUTE_ID, SENTINEL_ID] } } }, authority),
  "rejected").events.length, 0);
});

// SPEC 0012 §5.2: players order only their own characters that tie with one
// another; a tie between a player and an NPC is the KP's. Round 170 asked the
// player to order its one character, tied with an NPC, against nothing, and
// the act waited for an answer it could not give.
test("a player tied only with an NPC is not asked: the fight starts in the order the participants were listed", () => {
  const authority = new DeterministicRoomAuthority(commonInitiativeEntropy({
    "initiative:character:bob": [10],
    "initiative:group:initiative:ash-enemies": [10],
  }));
  const opening = requireKind(drive(startScenario(), START_DYNAMIC_ENCOUNTER, authority), "committed");
  const established = eventsOfType(opening.events, "InitiativeEstablished")[0];
  assert.deepEqual(established.payload.entries.map(entry => [entry.entryId, entry.total]),
    [["initiative:bob", 13], ["initiative:alice", 12], ["initiative:ash-enemies", 12]]);
  assert.deepEqual(eventsOfType(opening.events, "RoundStarted")[0].payload.turnOrderEntityIds, [BOB_ID, ALICE_ID, BRUTE_ID, SENTINEL_ID]);
  assert.equal(eventsOfType(opening.events, "CombatPendingOpened").length, 0);
  assert.equal(opening.result.pending, undefined);
});
