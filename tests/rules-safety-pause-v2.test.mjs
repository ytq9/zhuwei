import assert from "node:assert/strict";
import test from "node:test";

import { project, replay, step } from "../app/_runtime/lib/rules/index.ts";

const ALICE = Object.freeze({
  principalId: "principal:safety:alice",
  seatId: "seat:safety:alice",
  characterId: "character:safety:alice",
});
const BOB = Object.freeze({
  principalId: "principal:safety:bob",
  seatId: "seat:safety:bob",
  characterId: "character:safety:bob",
});

function profileRef(profileId, digit) {
  return { profileId, profileHash: `sha256:${digit.repeat(64)}` };
}

function tacticalGeometry() {
  return {
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
      { x: "420", y: "120", elevation: "0" },
    ],
    obstacles: [{
      featureId: "feature:rules-safety-pause-v2:hall-wall",
      kind: "barrier",
      label: "大厅侧墙",
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
  };
}

function viewer(person) {
  return {
    kind: "player",
    principalId: person.principalId,
    sessionVersion: 1,
    seatId: person.seatId,
    characterId: person.characterId,
  };
}

function administration(scenario, commandId, command) {
  return {
    kind: "applyRoomAdministration",
    commandId,
    roomAdministration: {
      kind: "roomAdministration",
      capability: scenario.state.multiplayerRuntime.roomAdministrationCapability,
    },
    command,
  };
}

function start() {
  const initialized = step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:safety-pause-v2",
    runtimeEpochId: "epoch:safety-pause-v2:1",
    moduleRef: profileRef("module:safety-pause-v2", "d"),
    initialDefinitionCatalogRef: profileRef("definitions:safety-pause-v2", "e"),
    activeBranchId: "branch:main",
    fictionInstantMicros: "60000000",
    scenes: [{ id: "scene:hall", name: "大厅", geometry: tacticalGeometry() }],
    principals: [
      { id: ALICE.principalId, sessionVersion: 1, role: "host" },
      { id: BOB.principalId, sessionVersion: 1, role: "player" },
    ],
    seats: [
      { id: ALICE.seatId, principalId: ALICE.principalId, status: "active" },
      { id: BOB.seatId, principalId: BOB.principalId, status: "active" },
    ],
    characters: [
      {
        id: ALICE.characterId,
        kind: "player",
        name: "爱丽丝",
        sceneId: "scene:hall",
        tenureStatus: "active",
        hitPoints: { current: 7, maximum: 11 },
        resources: { hitDice: 1 },
      },
      {
        id: BOB.characterId,
        kind: "player",
        name: "鲍勃",
        sceneId: "scene:hall",
        tenureStatus: "active",
        hitPoints: { current: 9, maximum: 12 },
        resources: { hitDice: 2 },
      },
    ],
    characterControls: [
      { characterId: ALICE.characterId, seatId: ALICE.seatId },
      { characterId: BOB.characterId, seatId: BOB.seatId },
    ],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const replayed = replay(initialized.genesis, []);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return {
    genesis: initialized.genesis,
    profiles: initialized.profiles,
    state: replayed.state,
    events: [],
  };
}

function commit(scenario, input) {
  const priorState = structuredClone(scenario.state);
  const result = step(scenario.profiles, scenario.state, input);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  const events = [...scenario.events, ...result.events];
  const replayed = replay(scenario.genesis, events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  assert.deepEqual(replayed.state, result.state);
  return {
    scenario: { ...scenario, state: replayed.state, events },
    priorState,
    result,
  };
}

function mechanicsAndFiction(state) {
  return {
    fictionTimelines: state.fictionTimelines,
    entities: state.entities,
    characterControls: state.characterControls,
    canonicalFacts: state.canonicalFacts,
    knowledge: state.knowledge,
    pendingInputs: state.pendingInputs,
    internalContinuations: state.internalContinuations,
    campaignRuntime: state.campaignRuntime,
    combatRuntime: state.combatRuntime,
    spotlightLedger: state.multiplayerRuntime.spotlightLedger,
  };
}

test("safety pause is a private replayable authority event, not a character action or resource/time mutation", () => {
  let scenario = start();
  const before = structuredClone(scenario.state);
  const invalidReason = step(scenario.profiles, scenario.state, {
    kind: "requestSafetyPause",
    rootActionId: "root:safety:reason-must-not-enter",
    requesterPrincipalId: ALICE.principalId,
    actorCharacterId: ALICE.characterId,
    reason: "this must never be accepted or persisted",
  });
  assert.equal(invalidReason.kind, "rejected");
  assert.deepEqual(invalidReason.events, []);

  const paused = commit(scenario, {
    kind: "requestSafetyPause",
    rootActionId: "root:safety:pause:1",
    requesterPrincipalId: ALICE.principalId,
    actorCharacterId: ALICE.characterId,
  });
  scenario = paused.scenario;
  assert.deepEqual(paused.result.events.map(({ eventType }) => eventType), ["SafetyPauseRequested"]);
  assert.equal(paused.result.events[0].secrecy, "private");
  assert.equal(
    paused.result.events[0].visibilityPolicyId,
    `visibility:principal:${ALICE.principalId}`,
  );
  assert.equal(JSON.stringify(paused.result.events).includes("reason"), false);
  assert.deepEqual(mechanicsAndFiction(scenario.state), mechanicsAndFiction(before));

  const aliceView = project(scenario.profiles, scenario.state, viewer(ALICE));
  assert.equal(aliceView.kind, "projected", JSON.stringify(aliceView));
  assert.deepEqual(aliceView.safetyPresentation, {
    status: "paused",
    presentationAdjustment: null,
  });

  for (const channel of ["realtime", "history", "reconnect", "error", "candidates", "voice", "transcript"]) {
    const bobView = project(scenario.profiles, scenario.state, viewer(BOB), { channel });
    assert.equal(bobView.kind, "projected", JSON.stringify(bobView));
    assert.equal("safetyPresentation" in bobView, false, channel);
    assert.equal(JSON.stringify(bobView).includes("SafetyPauseRequested"), false, channel);
    assert.equal(JSON.stringify(bobView).includes("root:safety:pause:1"), false, channel);
  }

  const aliceDelta = project(scenario.profiles, scenario.state, viewer(ALICE), {
    channel: "realtime",
    committedRange: {
      receiptId: paused.result.receipt.receiptId,
      actorCharacterId: ALICE.characterId,
      priorState: paused.priorState,
      events: paused.result.events,
    },
  });
  assert.equal(aliceDelta.kind, "projected", JSON.stringify(aliceDelta));
  assert.deepEqual(aliceDelta.committedDelta?.changes, [
    {
      kind: "projectionFieldChanged",
      field: "safetyPresentation",
      after: { status: "paused", presentationAdjustment: null },
    },
  ]);

  const bobDelta = project(scenario.profiles, scenario.state, viewer(BOB), {
    channel: "realtime",
    committedRange: {
      receiptId: paused.result.receipt.receiptId,
      actorCharacterId: ALICE.characterId,
      priorState: paused.priorState,
      events: paused.result.events,
    },
  });
  assert.equal(bobDelta.kind, "projected", JSON.stringify(bobDelta));
  assert.equal("committedDelta" in bobDelta, false);

  const duplicate = step(scenario.profiles, scenario.state, {
    kind: "requestSafetyPause",
    rootActionId: "root:safety:pause:1",
    requesterPrincipalId: ALICE.principalId,
    actorCharacterId: ALICE.characterId,
  });
  assert.equal(duplicate.kind, "rejected");
  assert.equal(duplicate.rejection.code, "duplicateRootAction");
  assert.deepEqual(duplicate.events, []);
});

test("only the bound requester can submit a minimized presentation adjustment and resume", () => {
  let scenario = start();
  scenario = commit(scenario, {
    kind: "requestSafetyPause",
    rootActionId: "root:safety:pause:2",
    requesterPrincipalId: ALICE.principalId,
    actorCharacterId: ALICE.characterId,
  }).scenario;

  const unauthorized = step(scenario.profiles, scenario.state, {
    kind: "adjustSafetyPresentation",
    rootActionId: "root:safety:adjust:forged",
    requesterPrincipalId: BOB.principalId,
    actorCharacterId: BOB.characterId,
    presentationAdjustment: "fadeToBlack",
  });
  assert.equal(unauthorized.kind, "rejected");
  assert.deepEqual(unauthorized.events, []);

  const beforeAdjustment = structuredClone(scenario.state);
  const adjusted = commit(scenario, {
    kind: "adjustSafetyPresentation",
    rootActionId: "root:safety:adjust:1",
    requesterPrincipalId: ALICE.principalId,
    actorCharacterId: ALICE.characterId,
    presentationAdjustment: "fadeToBlack",
  });
  scenario = adjusted.scenario;
  assert.deepEqual(adjusted.result.events.map(({ eventType }) => eventType), [
    "SafetyPresentationAdjusted",
  ]);
  assert.equal(JSON.stringify(adjusted.result.events).includes("reason"), false);
  assert.deepEqual(mechanicsAndFiction(scenario.state), mechanicsAndFiction(beforeAdjustment));

  const aliceView = project(scenario.profiles, scenario.state, viewer(ALICE));
  assert.equal(aliceView.kind, "projected", JSON.stringify(aliceView));
  assert.deepEqual(aliceView.safetyPresentation, {
    status: "resumed",
    presentationAdjustment: "fadeToBlack",
  });
  const bobView = project(scenario.profiles, scenario.state, viewer(BOB));
  assert.equal(bobView.kind, "projected", JSON.stringify(bobView));
  assert.equal("safetyPresentation" in bobView, false);
});

test("a minimized safety preference stays with the Principal across control changes and succession", () => {
  let transferredScenario = start();
  transferredScenario = commit(transferredScenario, {
    kind: "requestSafetyPause",
    rootActionId: "root:safety:principal-transfer:pause",
    requesterPrincipalId: ALICE.principalId,
    actorCharacterId: ALICE.characterId,
  }).scenario;
  transferredScenario = commit(transferredScenario, {
    kind: "adjustSafetyPresentation",
    rootActionId: "root:safety:principal-transfer:adjust",
    requesterPrincipalId: ALICE.principalId,
    actorCharacterId: ALICE.characterId,
    presentationAdjustment: "reduceDetail",
  }).scenario;
  transferredScenario = commit(transferredScenario, administration(
    transferredScenario,
    "admin:safety:transfer-alice-to-bob",
    {
      kind: "transferControl",
      characterId: ALICE.characterId,
      fromSeatId: ALICE.seatId,
      toSeatId: BOB.seatId,
    },
  )).scenario;
  const bobControlsAlice = project(transferredScenario.profiles, transferredScenario.state, {
    ...viewer(BOB),
    characterId: ALICE.characterId,
  });
  assert.equal(bobControlsAlice.kind, "projected", JSON.stringify(bobControlsAlice));
  assert.equal("safetyPresentation" in bobControlsAlice, false);

  let successorScenario = start();
  successorScenario = commit(successorScenario, {
    kind: "requestSafetyPause",
    rootActionId: "root:safety:successor:pause",
    requesterPrincipalId: ALICE.principalId,
    actorCharacterId: ALICE.characterId,
  }).scenario;
  successorScenario = commit(successorScenario, {
    kind: "adjustSafetyPresentation",
    rootActionId: "root:safety:successor:adjust",
    requesterPrincipalId: ALICE.principalId,
    actorCharacterId: ALICE.characterId,
    presentationAdjustment: "skipSensitiveContent",
  }).scenario;
  successorScenario = commit(successorScenario, {
    kind: "retireCharacter",
    proposalId: "root:safety:successor:retire",
    characterId: ALICE.characterId,
    reason: "玩家明确选择退役",
    continueAsNpc: false,
  }).scenario;
  const lifecycleView = project(successorScenario.profiles, successorScenario.state, {
    ...viewer(ALICE),
    purpose: "lifecycle",
  });
  assert.equal(lifecycleView.kind, "projected", JSON.stringify(lifecycleView));
  assert.deepEqual(lifecycleView.safetyPresentation, {
    status: "resumed",
    presentationAdjustment: "skipSensitiveContent",
  });

  const successorId = "character:safety:alice-successor";
  successorScenario = commit(successorScenario, {
    kind: "introduceSuccessor",
    proposalId: "root:safety:successor:introduce",
    controllerPrincipalId: ALICE.principalId,
    predecessorCharacterId: ALICE.characterId,
    successor: {
      id: successorId,
      kind: "player",
      name: "艾琳",
      sceneId: "scene:hall",
      tenureStatus: "active",
    },
    worldEntry: "艾琳在大厅接过冒险席位",
  }).scenario;
  const successorView = project(successorScenario.profiles, successorScenario.state, {
    ...viewer(ALICE),
    characterId: successorId,
  });
  assert.equal(successorView.kind, "projected", JSON.stringify(successorView));
  assert.deepEqual(successorView.safetyPresentation, {
    status: "resumed",
    presentationAdjustment: "skipSensitiveContent",
  });
});
