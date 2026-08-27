import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { project, replay, step } from "../app/_runtime/lib/rules/index.ts";

const SCENE_ID = "scene:hidden-gallery";
const ALICE_ID = "character:alice";
const SCOUT_ID = "npc:scout";
const HIDDEN_ENTITY_ID = "npc:hidden-stalker";
const WALL_TARGET_ID = "npc:wall-target";
const HIDDEN_WALL_ID = "terrain:hidden-wall";

const PROFILES = Object.freeze({
  manifest: {
    profileId: "runtime-srd51-2014-authoritative-v2",
    profileHash: "sha256:496da17f16d52cbe5dfa3e97facfa8ed7dcf3f4bbb7a882fc0e384d464898051",
  },
  ruleset: {
    profileId: "dnd5e-2014-srd5.1-authoritative-v2",
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
      profileId: "presentation-observer-specific-v1",
      profileHash: "sha256:86bfdfebe7062d90f87e4add65d1d109cb14dead7b3d758e452af76c13f7457c",
    },
    {
      profileId: "projection-observer-safe-v1",
      profileHash: "sha256:972b82b84594386abc2a988a98afb94e5ec925ee1819bc53cd677c722edf8b91",
    },
    {
      profileId: "delivery-single-current-frame-v1",
      profileHash: "sha256:cd0d684841bd43f621665dc538db35b81c25421d8b345e444681054bbc894d7e",
    },
  ],
});

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

const INITIAL_STATE = Object.freeze({
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
        unit: "inch",
        obstacles: Object.freeze([
          Object.freeze({
            obstacleId: HIDDEN_WALL_ID,
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
            visibilityPolicyId: "visibility:kp-internal",
          }),
        ]),
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
const UNSIGNED_GENESIS = Object.freeze({
  kind: "roomGenesis",
  roomId: "room:privacy-bypass-v2",
  runtimeEpochId: "epoch:privacy-bypass-v2:1",
  profiles: PROFILES,
  moduleRef: MODULE_REF,
  initialDefinitionCatalogRef: CATALOG_REF,
  initialState: INITIAL_STATE,
  initialStateHash: fixtureHash(INITIAL_STATE),
});
const GENESIS = Object.freeze({
  ...UNSIGNED_GENESIS,
  genesisHash: fixtureHash(UNSIGNED_GENESIS),
});

const ALICE_VIEWER = Object.freeze({
  kind: "player",
  principalId: "principal:alice",
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
    sceneId: SCENE_ID,
    position: { x: "120", y: "0", elevation: "0" },
    footprint: { width: "60", depth: "60", height: "60" },
    visibilityPolicyId: "visibility:kp-internal",
  });
  assert.deepEqual(
    kp.spatialEvidence.scenes[SCENE_ID].geometry.obstacles[0],
    INITIAL_STATE.scenes[SCENE_ID].geometry.obstacles[0],
  );
  assert.ok(!encoded(kp).includes("隐匿追猎者"), "KP spatial evidence must not include narrative identity");
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
