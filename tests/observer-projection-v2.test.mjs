import assert from "node:assert/strict";
import test from "node:test";

import { project, replay, step } from "../app/_runtime/lib/rules/index.ts";

const ALICE_PRINCIPAL_ID = "principal:alice";
const BOB_PRINCIPAL_ID = "principal:bob";
const CAROL_PRINCIPAL_ID = "principal:carol";
const ALICE_SEAT_ID = "seat:alice";
const BOB_SEAT_ID = "seat:bob";
const CAROL_SEAT_ID = "seat:carol";
const ALICE_CHARACTER_ID = "character:alice";
const BOB_CHARACTER_ID = "character:bob";
const SUCCESSOR_CHARACTER_ID = "character:carol-successor";
const NPC_ID = "npc:archivist";
const ARCHIVE_SCENE_ID = "scene:archive";
const COURTYARD_SCENE_ID = "scene:courtyard";

const PRIVATE_FACT_ID = "fact:smugglers-ledger";
const PRIVATE_KNOWLEDGE_REF = PRIVATE_FACT_ID;
const PRIVATE_KNOWLEDGE_TEXT = "走私账册藏在北墙第三块松动石砖后。";
const NPC_KNOWLEDGE_REF = "knowledge:archivist-closing-duty";
const NPC_KNOWLEDGE_TEXT = "档案员只知道日落后要锁上阅览室。";
const COMMUNICATION_FACT_ID = "fact:paired-whisper-stones";
const OLD_DELIVERY_ID = "delivery:alice-private-discovery";
const OLD_NARRATION = "你独自听见石砖后传来纸页摩擦声。";

function profileRef(profileId, digit) {
  return Object.freeze({
    profileId,
    profileHash: `sha256:${digit.repeat(64)}`,
  });
}

function tacticalGeometry(sceneId) {
  return Object.freeze({
    schema: "zhuwei.tactical-geometry/v1",
    unit: "inch",
    boundary: Object.freeze({
      kind: "polygon",
      points: Object.freeze([
        Object.freeze({ x: "0", y: "0" }),
        Object.freeze({ x: "900", y: "0" }),
        Object.freeze({ x: "900", y: "600" }),
        Object.freeze({ x: "0", y: "600" }),
      ]),
    }),
    spawnPoints: Object.freeze([
      Object.freeze({ x: "120", y: "120", elevation: "0" }),
      Object.freeze({ x: "300", y: "120", elevation: "0" }),
      Object.freeze({ x: "480", y: "120", elevation: "0" }),
    ]),
    obstacles: Object.freeze([Object.freeze({
      featureId: `feature:observer-projection:${sceneId}:wall`,
      kind: "barrier",
      label: "档案馆矮墙",
      state: "intact",
      polygon: Object.freeze([
        Object.freeze({ x: "360", y: "420" }),
        Object.freeze({ x: "420", y: "420" }),
        Object.freeze({ x: "420", y: "480" }),
        Object.freeze({ x: "360", y: "480" }),
      ]),
      elevation: "0",
      height: "60",
      opaque: false,
      impassable: true,
      cover: "half",
      propagation: "passes",
      terrain: "normal",
      visibilityPolicyId: "visibility:scene-observers",
    })]),
    clearanceZones: Object.freeze([]),
  });
}

// Room creation also goes through the public Rules responsibility seam. The
// fixture deliberately supplies no Profile id/hash, state hash, event, die, or
// mutable WorldState; Rules selects the deployed authoritative manifest and
// returns the signed genesis that replay accepts.
const INITIALIZE_WORLD = Object.freeze({
  kind: "initializeAuthoritativeWorld",
  roomId: "room:observer-projection",
  runtimeEpochId: "epoch:observer-projection:1",
  moduleRef: profileRef("module:observer-fixture:v1", "b"),
  initialDefinitionCatalogRef: profileRef("definitions:observer-fixture:v1", "c"),
  activeBranchId: "branch:main",
  fictionInstantMicros: "0",
  scenes: Object.freeze([
    Object.freeze({
      id: ARCHIVE_SCENE_ID,
      name: "旧档案馆",
      geometry: tacticalGeometry(ARCHIVE_SCENE_ID),
    }),
    Object.freeze({
      id: COURTYARD_SCENE_ID,
      name: "庭院",
      geometry: tacticalGeometry(COURTYARD_SCENE_ID),
    }),
  ]),
  principals: Object.freeze([
    Object.freeze({ id: ALICE_PRINCIPAL_ID, sessionVersion: 1 }),
    Object.freeze({ id: BOB_PRINCIPAL_ID, sessionVersion: 1 }),
    Object.freeze({ id: CAROL_PRINCIPAL_ID, sessionVersion: 1 }),
  ]),
  seats: Object.freeze([
    Object.freeze({ id: ALICE_SEAT_ID, principalId: ALICE_PRINCIPAL_ID, status: "active" }),
    Object.freeze({ id: BOB_SEAT_ID, principalId: BOB_PRINCIPAL_ID, status: "active" }),
    Object.freeze({ id: CAROL_SEAT_ID, principalId: CAROL_PRINCIPAL_ID, status: "active" }),
  ]),
  characters: Object.freeze([
    Object.freeze({
      id: ALICE_CHARACTER_ID,
      kind: "player",
      name: "爱丽丝",
      sceneId: ARCHIVE_SCENE_ID,
      tenureStatus: "active",
    }),
    Object.freeze({
      id: BOB_CHARACTER_ID,
      kind: "player",
      name: "鲍勃",
      sceneId: COURTYARD_SCENE_ID,
      tenureStatus: "active",
    }),
    Object.freeze({
      id: NPC_ID,
      kind: "npc",
      name: "档案员",
      sceneId: ARCHIVE_SCENE_ID,
      tenureStatus: "active",
    }),
  ]),
  characterControls: Object.freeze([
    Object.freeze({ seatId: ALICE_SEAT_ID, characterId: ALICE_CHARACTER_ID }),
    Object.freeze({ seatId: BOB_SEAT_ID, characterId: BOB_CHARACTER_ID }),
  ]),
  canonicalFacts: Object.freeze([
    Object.freeze({
      id: PRIVATE_FACT_ID,
      kind: "hiddenObjectLocation",
      subjectRefs: Object.freeze(["artifact:smugglers-ledger"]),
      value: Object.freeze({ sceneId: ARCHIVE_SCENE_ID, hidingPlace: "north-wall-third-stone" }),
      visibilityPolicyId: "visibility:kp-internal",
      source: "moduleAnchor",
    }),
    Object.freeze({
      id: COMMUNICATION_FACT_ID,
      kind: "establishedCommunicationChannel",
      subjectRefs: Object.freeze([ALICE_CHARACTER_ID, BOB_CHARACTER_ID]),
      value: Object.freeze({ medium: "paired-whisper-stones", private: true }),
      visibilityPolicyId: "visibility:channel-participants",
      source: "moduleAnchor",
    }),
  ]),
  initialKnowledge: Object.freeze([
    Object.freeze({
      characterId: NPC_ID,
      knowledgeRef: NPC_KNOWLEDGE_REF,
      kind: "sourceClaim",
      layer: "full",
      content: NPC_KNOWLEDGE_TEXT,
      visibility: "private",
      provenanceChain: Object.freeze(["genesis:npc-duty"]),
    }),
  ]),
});

const ALICE_VIEWER = Object.freeze({
  kind: "player",
  principalId: ALICE_PRINCIPAL_ID,
  sessionVersion: 1,
  seatId: ALICE_SEAT_ID,
  characterId: ALICE_CHARACTER_ID,
});

const BOB_VIEWER = Object.freeze({
  kind: "player",
  principalId: BOB_PRINCIPAL_ID,
  sessionVersion: 1,
  seatId: BOB_SEAT_ID,
  characterId: BOB_CHARACTER_ID,
});

const CAROL_CONTROLS_ALICE_VIEWER = Object.freeze({
  kind: "player",
  principalId: CAROL_PRINCIPAL_ID,
  sessionVersion: 1,
  seatId: CAROL_SEAT_ID,
  characterId: ALICE_CHARACTER_ID,
});

const CAROL_SUCCESSOR_VIEWER = Object.freeze({
  kind: "player",
  principalId: CAROL_PRINCIPAL_ID,
  sessionVersion: 1,
  seatId: CAROL_SEAT_ID,
  characterId: SUCCESSOR_CHARACTER_ID,
});

const NPC_VIEWER = Object.freeze({
  kind: "npc",
  npcId: NPC_ID,
  purpose: "kpDecision",
  capability: "internal:npc-limited-knowledge",
});

const ACQUIRE_PRIVATE_KNOWLEDGE = Object.freeze({
  kind: "acquireSensoryEvidence",
  proposalId: "root:alice-finds-ledger",
  characterId: ALICE_CHARACTER_ID,
  factId: PRIVATE_FACT_ID,
  sense: "hearing",
  clarity: "full",
  publicEvidence: PRIVATE_KNOWLEDGE_TEXT,
});

const SHARE_WITH_FROZEN_BOB = Object.freeze({
  kind: "shareKnowledge",
  proposalId: "root:alice-shares-ledger-location",
  senderCharacterId: ALICE_CHARACTER_ID,
  knowledgeRefs: Object.freeze([PRIVATE_KNOWLEDGE_REF]),
  medium: "paired-whisper-stones",
  mediumFactId: COMMUNICATION_FACT_ID,
  recipientEntityIds: Object.freeze([BOB_CHARACTER_ID]),
  contentLayer: "full",
});

function unwrapReplay(result) {
  assert.ok(result !== null && typeof result === "object", "replay must return a state/cache result");
  assert.notEqual(result.kind, "rejected", JSON.stringify(result));
  return result.state ?? result.cache ?? result;
}

function startScenario() {
  const initialized = step(undefined, undefined, INITIALIZE_WORLD);
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const genesis = initialized.genesis;
  assert.ok(genesis && genesis.kind === "roomGenesis", "Rules must return a signed genesis");
  return Object.freeze({
    genesis,
    profiles: genesis.profiles,
    eventLog: Object.freeze([]),
    state: unwrapReplay(replay(genesis, [])),
  });
}

function advance(scenario, input) {
  const result = step(scenario.profiles, scenario.state, input);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  assert.ok(Array.isArray(result.events) && result.events.length > 0, "step must return committed events");
  const eventLog = Object.freeze([...scenario.eventLog, ...result.events]);
  return Object.freeze({
    ...scenario,
    eventLog,
    state: unwrapReplay(replay(scenario.genesis, eventLog)),
  });
}

function read(scenario, viewer, query = { channel: "realtime" }) {
  const result = project(scenario.profiles, scenario.state, viewer, query);
  assert.ok(result !== null && typeof result === "object");
  assert.notEqual(result.kind, "rejected", JSON.stringify(result));
  return result.readModel ?? result.projection ?? result;
}

function encoded(value) {
  return JSON.stringify(value);
}

function assertContains(value, expected, message) {
  assert.ok(encoded(value).includes(expected), message ?? `projection must contain ${expected}`);
}

function assertOmits(value, forbidden, message) {
  assert.ok(!encoded(value).includes(forbidden), message ?? `projection must omit ${forbidden}`);
}

function hasKeyDeep(value, forbiddenKey) {
  if (Array.isArray(value)) return value.some((entry) => hasKeyDeep(entry, forbiddenKey));
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, nested]) => key === forbiddenKey || hasKeyDeep(nested, forbiddenKey),
  );
}

function assertNoNarrationHistory(value) {
  for (const key of [
    "messages",
    "messageHistory",
    "narrationHistory",
    "deliveryHistory",
    "voiceHistory",
    "transcriptHistory",
  ]) {
    assert.equal(hasKeyDeep(value, key), false, `${key} must not exist in a Viewer Read Model`);
  }
  assertOmits(value, OLD_DELIVERY_ID);
  assertOmits(value, OLD_NARRATION);
}

function scenarioWithPrivateKnowledge() {
  return advance(startScenario(), ACQUIRE_PRIVATE_KNOWLEDGE);
}

function scenarioWithSharedKnowledge() {
  return advance(scenarioWithPrivateKnowledge(), SHARE_WITH_FROZEN_BOB);
}

test("personal knowledge is visible only to Alice while Bob is fictionally absent", () => {
  const scenario = scenarioWithPrivateKnowledge();
  const alice = read(scenario, ALICE_VIEWER);
  const bob = read(scenario, BOB_VIEWER);

  assertContains(alice, PRIVATE_KNOWLEDGE_REF);
  assertContains(alice, PRIVATE_KNOWLEDGE_TEXT);
  assertOmits(bob, PRIVATE_KNOWLEDGE_REF);
  assertOmits(bob, PRIVATE_KNOWLEDGE_TEXT);
  assertNoNarrationHistory(alice);
  assertNoNarrationHistory(bob);

  const realButPrivate = project(scenario.profiles, scenario.state, BOB_VIEWER, {
    channel: "error",
    referenceId: PRIVATE_KNOWLEDGE_REF,
  });
  const neverExisted = project(scenario.profiles, scenario.state, BOB_VIEWER, {
    channel: "error",
    referenceId: "knowledge:guessed-and-never-existed",
  });
  assert.deepEqual(realButPrivate, neverExisted);
});

test("world-internal sharing grants Bob structured knowledge without old narration", () => {
  const scenario = scenarioWithSharedKnowledge();
  const bob = read(scenario, BOB_VIEWER);
  const npc = read(scenario, NPC_VIEWER);

  assertContains(bob, PRIVATE_KNOWLEDGE_REF);
  assertContains(bob, PRIVATE_KNOWLEDGE_TEXT);
  assertContains(bob, ALICE_CHARACTER_ID, "shared knowledge must retain Alice as its source");
  assertNoNarrationHistory(bob);
  assertOmits(npc, PRIVATE_KNOWLEDGE_REF, "the frozen recipient set contains Bob, not the NPC");
});

test("an NPC Viewer contains only that NPC's finite knowledge", () => {
  const scenario = scenarioWithPrivateKnowledge();
  const npc = read(scenario, NPC_VIEWER);

  assertContains(npc, NPC_KNOWLEDGE_REF);
  assertContains(npc, NPC_KNOWLEDGE_TEXT);
  assertOmits(npc, PRIVATE_KNOWLEDGE_REF);
  assertOmits(npc, PRIVATE_KNOWLEDGE_TEXT);
  assertNoNarrationHistory(npc);
});

test("control transfer exposes current character knowledge but no old delivery, and a successor inherits neither", () => {
  let scenario = scenarioWithSharedKnowledge();
  scenario = advance(scenario, Object.freeze({
    kind: "applyRoomAdministration",
    commandId: "transfer-alice-control",
    roomAdministration: Object.freeze({
      kind: "roomAdministration",
      capability: scenario.state.multiplayerRuntime.roomAdministrationCapability,
    }),
    command: Object.freeze({
      kind: "transferControl",
      characterId: ALICE_CHARACTER_ID,
      fromSeatId: ALICE_SEAT_ID,
      toSeatId: CAROL_SEAT_ID,
    }),
  }));

  const newController = read(scenario, CAROL_CONTROLS_ALICE_VIEWER);
  const formerController = project(scenario.profiles, scenario.state, ALICE_VIEWER, {
    channel: "reconnect",
    referenceId: OLD_DELIVERY_ID,
  });
  assertContains(newController, PRIVATE_KNOWLEDGE_REF);
  assertNoNarrationHistory(newController);
  assertOmits(formerController, PRIVATE_KNOWLEDGE_REF);
  assertNoNarrationHistory(formerController);

  scenario = advance(scenario, Object.freeze({
    kind: "retireCharacter",
    proposalId: "root:alice-retires",
    characterId: ALICE_CHARACTER_ID,
    reason: "玩家明确选择让爱丽丝退役",
    continueAsNpc: false,
  }));
  scenario = advance(scenario, Object.freeze({
    kind: "introduceSuccessor",
    proposalId: "root:introduce-carol-successor",
    predecessorCharacterId: ALICE_CHARACTER_ID,
    controllerPrincipalId: CAROL_PRINCIPAL_ID,
    successor: Object.freeze({
      id: SUCCESSOR_CHARACTER_ID,
      kind: "player",
      name: "卡萝尔",
      sceneId: COURTYARD_SCENE_ID,
      tenureStatus: "active",
    }),
    worldEntry: "卡萝尔在庭院正式接过冒险席位",
  }));

  const successor = read(scenario, CAROL_SUCCESSOR_VIEWER, {
    channel: "history",
    referenceId: OLD_DELIVERY_ID,
  });
  const bob = read(scenario, BOB_VIEWER);
  assertOmits(successor, PRIVATE_KNOWLEDGE_REF);
  assertOmits(successor, PRIVATE_KNOWLEDGE_TEXT);
  assertNoNarrationHistory(successor);
  assertContains(bob, PRIVATE_KNOWLEDGE_REF, "Bob remains the frozen share recipient");
});

test("all projection query channels use the same redacted Read Model without narration history", () => {
  const scenario = scenarioWithSharedKnowledge();
  const channels = [
    "realtime",
    "history",
    "reconnect",
    "error",
    "candidates",
    "voice",
    "transcript",
  ];
  const projections = channels.map((channel) =>
    project(scenario.profiles, scenario.state, BOB_VIEWER, { channel }));

  for (const projection of projections.slice(1)) {
    assert.deepEqual(projection, projections[0]);
  }
  for (const projection of projections) {
    assertNoNarrationHistory(projection);
    assertContains(projection, PRIVATE_KNOWLEDGE_REF);
  }
});
