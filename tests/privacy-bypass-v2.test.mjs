import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { project, replay, step } from "../app/_runtime/lib/rules/index.ts";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests.ts";

const SCENE_ID = "scene:hidden-gallery";
const ALICE_ID = "character:alice";
const SCOUT_ID = "npc:scout";
const HIDDEN_ENTITY_ID = "npc:hidden-stalker";
const WALL_TARGET_ID = "npc:wall-target";
const HIDDEN_WALL_ID = "terrain:hidden-wall";

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

const INITIAL_DEFINITIONS = Object.freeze({
  "ability:alice-bolt": Object.freeze({
    definitionId: "ability:alice-bolt",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: Object.freeze({ kind: "attack", actionGrant: "attack" }),
    target: Object.freeze({ kind: "creature", count: "1", rangeInches: "600" }),
    attack: Object.freeze({ ability: "dex", proficiency: true }),
    damage: Object.freeze([{ type: "force", formula: "1d4" }]),
  }),
});

const INITIAL_COMBAT_STATE = Object.freeze({
  version: "0",
  activeBranchId: "branch:main",
  fictionTimelines: Object.freeze({
    "branch:main": Object.freeze({ branchId: "branch:main", nowMicros: "0" }),
  }),
  story: Object.freeze({ chapterId: "chapter:hidden-gallery", status: "active", endingCandidates: [] }),
  scenes: Object.freeze({
    [SCENE_ID]: Object.freeze({
      sceneId: SCENE_ID,
      geometry: Object.freeze({
        schema: "zhuwei.tactical-geometry/v1",
        unit: "inch",
        boundary: Object.freeze({
          kind: "polygon",
          points: Object.freeze([
            Object.freeze({ x: "-240", y: "-240" }),
            Object.freeze({ x: "840", y: "-240" }),
            Object.freeze({ x: "840", y: "240" }),
            Object.freeze({ x: "-240", y: "240" }),
          ]),
        }),
        spawnPoints: Object.freeze([
          Object.freeze({ x: "0", y: "0", elevation: "0" }),
          Object.freeze({ x: "-120", y: "0", elevation: "0" }),
          Object.freeze({ x: "120", y: "0", elevation: "0" }),
          Object.freeze({ x: "600", y: "0", elevation: "0" }),
        ]),
        obstacles: Object.freeze([
          Object.freeze({
            featureId: HIDDEN_WALL_ID,
            kind: "barrier",
            label: "隐匿墙体",
            state: "intact",
            polygon: Object.freeze([
              Object.freeze({ x: "480", y: "-60" }),
              Object.freeze({ x: "482", y: "-60" }),
              Object.freeze({ x: "482", y: "60" }),
              Object.freeze({ x: "480", y: "60" }),
            ]),
            elevation: "0",
            height: "120",
            opaque: true,
            impassable: true,
            cover: "full",
            propagation: "blocks",
            terrain: "normal",
            visibilityPolicyId: "visibility:hidden-until-evidence",
          }),
        ]),
        clearanceZones: Object.freeze([]),
      }),
    }),
  }),
  entities: Object.freeze({
    [ALICE_ID]: Object.freeze({
      id: ALICE_ID,
      kind: "player",
      name: "爱丽丝",
      controllerPrincipalId: "principal:alice",
      entityOrdinal: "1",
      sceneId: SCENE_ID,
      position: Object.freeze({ x: "0", y: "0", elevation: "0" }),
      footprint: Object.freeze({ width: "60", depth: "60", height: "60" }),
      stats: Object.freeze({ str: "10", dex: "16", con: "10", int: "10", wis: "10", cha: "10" }),
      proficiencyBonus: "2",
      armorClass: "14",
      hitPoints: Object.freeze({ current: "12", maximum: "12", temporary: "0" }),
      speedInches: Object.freeze({ walk: "360" }),
      abilityRefs: Object.freeze(["ability:alice-bolt"]),
      deathPolicy: "deathSaves",
    }),
    [SCOUT_ID]: Object.freeze({
      id: SCOUT_ID,
      kind: "npc",
      name: "斥候",
      entityOrdinal: "2",
      sceneId: SCENE_ID,
      position: Object.freeze({ x: "-120", y: "0", elevation: "0" }),
      footprint: Object.freeze({ width: "60", depth: "60", height: "60" }),
      armorClass: "12",
      hitPoints: Object.freeze({ current: "8", maximum: "8", temporary: "0" }),
      deathPolicy: "deadAtZero",
    }),
    [HIDDEN_ENTITY_ID]: Object.freeze({
      id: HIDDEN_ENTITY_ID,
      kind: "npc",
      name: "隐匿追猎者",
      entityOrdinal: "3",
      sceneId: SCENE_ID,
      position: Object.freeze({ x: "120", y: "0", elevation: "0" }),
      footprint: Object.freeze({ width: "60", depth: "60", height: "60" }),
      armorClass: "13",
      hitPoints: Object.freeze({ current: "9", maximum: "9", temporary: "0" }),
      visibilityPolicyId: "visibility:kp-internal",
      deathPolicy: "deadAtZero",
    }),
    [WALL_TARGET_ID]: Object.freeze({
      id: WALL_TARGET_ID,
      kind: "npc",
      name: "墙后守卫",
      entityOrdinal: "4",
      sceneId: SCENE_ID,
      position: Object.freeze({ x: "600", y: "0", elevation: "0" }),
      footprint: Object.freeze({ width: "60", depth: "60", height: "60" }),
      armorClass: "13",
      hitPoints: Object.freeze({ current: "9", maximum: "9", temporary: "0" }),
      deathPolicy: "deadAtZero",
    }),
  }),
  definitions: INITIAL_DEFINITIONS,
  encounters: Object.freeze({}),
  effects: Object.freeze({}),
  pendingInputs: Object.freeze({}),
});

const MODULE_REF = Object.freeze({
  profileId: "module:hidden-gallery-v1",
  profileHash: fixtureHash({ sceneId: SCENE_ID }),
});
const CATALOG_REF = Object.freeze({
  profileId: "catalog:hidden-gallery-v1",
  profileHash: fixtureHash(INITIAL_DEFINITIONS),
});

const initializedWorld = step(PROFILES, undefined, {
  kind: "initializeAuthoritativeWorld",
  roomId: "room:privacy-bypass-v2",
  runtimeEpochId: "epoch:privacy-bypass-v2:1",
  moduleRef: MODULE_REF,
  initialDefinitionCatalogRef: CATALOG_REF,
  activeBranchId: "branch:main",
  fictionInstantMicros: "0",
  scenes: [{
    id: SCENE_ID,
    name: "隐秘画廊",
    geometry: INITIAL_COMBAT_STATE.scenes[SCENE_ID].geometry,
  }],
  principals: [{ id: "principal:alice", sessionVersion: 1, role: "host" }],
  seats: [{ id: "seat:alice", principalId: "principal:alice", status: "active" }],
  characters: [
    {
      id: ALICE_ID,
      kind: "player",
      name: "爱丽丝",
      sceneId: SCENE_ID,
      tenureStatus: "active",
      classId: "fighter",
      raceId: "human",
      level: 1,
      hitPoints: { current: 12, maximum: 12 },
      abilityScores: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      proficientSkills: [],
      expertiseSkills: [],
      proficientSaves: [],
      featureIds: [],
      loadout: { armorClass: 14, speedFeet: 30, equipped: {}, backpack: [] },
      characterBuild: { classId: "fighter", raceId: "human", cantrips: [], prepared: [] },
    },
    ...[
      [SCOUT_ID, "斥候"],
      [HIDDEN_ENTITY_ID, "隐匿追猎者"],
      [WALL_TARGET_ID, "墙后守卫"],
    ].map(([id, name]) => ({
      id,
      kind: "npc",
      name,
      sceneId: SCENE_ID,
      tenureStatus: "active",
      hitPoints: { current: 9, maximum: 9 },
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
    })),
  ],
  characterControls: [{ characterId: ALICE_ID, seatId: "seat:alice" }],
  canonicalFacts: [],
  initialKnowledge: [],
});
assert.equal(initializedWorld.kind, "initialized", JSON.stringify(initializedWorld));

const INITIAL_STATE = structuredClone(initializedWorld.genesis.initialState);
INITIAL_STATE.combatRuntime = {
  story: structuredClone(INITIAL_COMBAT_STATE.story),
  scenes: structuredClone(INITIAL_COMBAT_STATE.scenes),
  entities: structuredClone(INITIAL_COMBAT_STATE.entities),
  definitions: structuredClone(INITIAL_COMBAT_STATE.definitions),
  encounters: structuredClone(INITIAL_COMBAT_STATE.encounters),
  effects: structuredClone(INITIAL_COMBAT_STATE.effects),
  pendingInputs: structuredClone(INITIAL_COMBAT_STATE.pendingInputs),
  randomnessResolutions: {},
};
const initialStateHashSource = { ...INITIAL_STATE };
delete initialStateHashSource.eventHeadHash;
delete initialStateHashSource.lastEventId;
const initialStateHash = fixtureHash(initialStateHashSource);
INITIAL_STATE.eventHeadHash = initialStateHash;
const UNSIGNED_GENESIS = structuredClone(initializedWorld.genesis);
delete UNSIGNED_GENESIS.genesisHash;
UNSIGNED_GENESIS.initialState = INITIAL_STATE;
UNSIGNED_GENESIS.initialStateHash = initialStateHash;
const GENESIS = Object.freeze({ ...UNSIGNED_GENESIS, genesisHash: fixtureHash(UNSIGNED_GENESIS) });

const ALICE_VIEWER = Object.freeze({
  kind: "player",
  principalId: "principal:alice",
  sessionVersion: 1,
  seatId: "seat:alice",
  characterId: ALICE_ID,
});
const SCOUT_VIEWER = Object.freeze({
  kind: "npc",
  npcId: SCOUT_ID,
  purpose: "kpDecision",
  capability: "internal:npc-limited-knowledge",
});
const KP_SPATIAL_VIEWER = Object.freeze({
  kind: "kp",
  capability: "internal:kp-spatial-evidence",
});

function replayState() {
  const result = replay(GENESIS, []);
  assert.equal(result.kind, "replayed", JSON.stringify(result));
  return result.state;
}

function encoded(value) {
  return JSON.stringify(value);
}

test("Geometry G15 keeps hidden spatial truth service-only and makes guessed targets indistinguishable", () => {
  const state = replayState();
  const replayedAgain = replayState();
  assert.deepEqual(replayedAgain, state, "empty replay must deterministically rebuild hidden spatial truth");

  const player = project(PROFILES, state, ALICE_VIEWER, { channel: "realtime" });
  assert.equal(player.kind, "projected", JSON.stringify(player));
  assert.ok(encoded(player).includes(WALL_TARGET_ID), "visible entity behind a hidden wall stays identifiable");
  assert.ok(!encoded(player).includes(HIDDEN_ENTITY_ID), "player projection must hide the entity identity");
  assert.ok(!encoded(player).includes(HIDDEN_WALL_ID), "player projection must hide wall geometry");

  const npc = project(PROFILES, state, SCOUT_VIEWER, { channel: "realtime" });
  assert.equal(npc.kind, "projected", JSON.stringify(npc));
  assert.ok(!encoded(npc).includes(HIDDEN_ENTITY_ID), "finite NPC knowledge must not become KP omniscience");
  assert.ok(!encoded(npc).includes(HIDDEN_WALL_ID), "finite NPC projection must hide unknown wall geometry");

  const unauthorizedKp = project(PROFILES, state, { kind: "kp" });
  assert.equal(unauthorizedKp.kind, "rejected");
  assert.equal(unauthorizedKp.rejection.code, "viewerUnauthorized");

  const kp = project(PROFILES, state, KP_SPATIAL_VIEWER, { channel: "realtime" });
  assert.equal(kp.kind, "projected", JSON.stringify(kp));
  assert.deepEqual(kp.viewer, { kind: "kp", subjectId: "kp" });
  assert.deepEqual(kp.spatialEvidence.entities[HIDDEN_ENTITY_ID], {
    id: HIDDEN_ENTITY_ID,
    name: "隐匿追猎者",
    sceneId: SCENE_ID,
    position: { x: "120", y: "0", elevation: "0" },
    footprint: { width: "60", depth: "60", height: "60" },
    visibilityPolicyId: "visibility:kp-internal",
  });
  assert.deepEqual(
    kp.spatialEvidence.scenes[SCENE_ID].geometry.obstacles[0],
    INITIAL_COMBAT_STATE.scenes[SCENE_ID].geometry.obstacles[0],
  );
  assert.ok(encoded(kp).includes("隐匿追猎者"), "authorized KP evidence keeps the exact hidden NPC identity");
  assert.ok(!encoded(kp).includes("ability:alice-bolt"), "KP spatial evidence must not include mechanics");
  assert.deepEqual(
    project(PROFILES, replayedAgain, KP_SPATIAL_VIEWER, { channel: "reconnect" }),
    kp,
    "KP spatial evidence must be replay deterministic and query-channel invariant",
  );

  const guessedHidden = step(PROFILES, state, {
    kind: "invokeAbility",
    rootActionId: "root:alice-guesses-private-target",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-bolt",
    parameters: { targetEntityId: HIDDEN_ENTITY_ID },
  });
  const guessedMissing = step(PROFILES, state, {
    kind: "invokeAbility",
    rootActionId: "root:alice-guesses-private-target",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-bolt",
    parameters: { targetEntityId: "npc:not-present" },
  });
  const targetBehindHiddenWall = step(PROFILES, state, {
    kind: "invokeAbility",
    rootActionId: "root:alice-guesses-private-target",
    sourceEntityId: ALICE_ID,
    abilityRef: "ability:alice-bolt",
    parameters: { targetEntityId: WALL_TARGET_ID },
  });
  assert.deepEqual(guessedHidden, guessedMissing);
  assert.deepEqual(targetBehindHiddenWall, guessedMissing);
  assert.deepEqual(guessedHidden, {
    kind: "rejected",
    rejection: {
      code: "privateOrUnknownReference",
      message: "Ability target is unavailable.",
    },
    events: [],
  });
  assert.ok(!encoded(guessedHidden).includes(HIDDEN_ENTITY_ID));
  assert.ok(!/"(?:x|y|elevation)"/.test(encoded(guessedHidden)));

  assert.deepEqual(
    project(PROFILES, state, ALICE_VIEWER, { channel: "error", referenceId: HIDDEN_ENTITY_ID }),
    project(PROFILES, state, ALICE_VIEWER, { channel: "error", referenceId: "npc:not-present" }),
    "projection must not reveal whether a guessed private reference exists",
  );
});
