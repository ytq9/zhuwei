import assert from "node:assert/strict";
import test from "node:test";

import { project, replay, step } from "../app/_runtime/lib/rules/index.ts";
import { initialStandardGearEntryId } from "../app/_runtime/lib/rules/v2/item-transitions.ts";

const ALICE = {
  principalId: "principal:rules-multi:alice",
  seatId: "seat:rules-multi:alice",
  characterId: "character:rules-multi:alice",
};
const BOB = {
  principalId: "principal:rules-multi:bob",
  seatId: "seat:rules-multi:bob",
  characterId: "character:rules-multi:bob",
};

function profileRef(profileId, digit) {
  return { profileId, profileHash: `sha256:${digit.repeat(64)}` };
}

function tacticalGeometry(sceneId) {
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
    ],
    obstacles: [{
      featureId: `feature:rules-multiplayer-v2:${sceneId}:wall`,
      kind: "barrier",
      label: "矮墙",
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

function start() {
  const initialized = step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:rules-multiplayer-v2",
    runtimeEpochId: "epoch:rules-multiplayer-v2:1",
    moduleRef: profileRef("module:rules-multiplayer-v2", "d"),
    initialDefinitionCatalogRef: profileRef("definitions:rules-multiplayer-v2", "e"),
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [
      { id: "scene:shrine", name: "神龛", geometry: tacticalGeometry("shrine") },
      { id: "scene:yard", name: "庭院", geometry: tacticalGeometry("yard") },
      { id: "scene:cellar", name: "地窖", geometry: tacticalGeometry("cellar") },
    ],
    principals: [{ id: ALICE.principalId, sessionVersion: 1, role: "host" }],
    seats: [{ id: ALICE.seatId, principalId: ALICE.principalId, status: "active" }],
    characters: [{
      id: ALICE.characterId,
      kind: "player",
      name: "爱丽丝",
      sceneId: "scene:shrine",
      tenureStatus: "active",
    }],
    characterControls: [{ characterId: ALICE.characterId, seatId: ALICE.seatId }],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const replayed = replay(initialized.genesis, []);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return {
    genesis: initialized.genesis,
    profiles: initialized.profiles,
    events: [],
    state: replayed.state,
  };
}

function commit(scenario, input, expectedKind = "committed") {
  const result = step(scenario.profiles, scenario.state, input);
  assert.equal(result.kind, expectedKind, JSON.stringify(result));
  if (result.kind === "rejected") return { scenario, result };
  const events = [...scenario.events, ...result.events];
  const replayed = replay(scenario.genesis, events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return { scenario: { ...scenario, events, state: replayed.state }, result };
}

function administration(scenario, commandId, command, capability) {
  return {
    kind: "applyRoomAdministration",
    roomAdministration: {
      kind: "roomAdministration",
      capability: capability ?? scenario.state.multiplayerRuntime.roomAdministrationCapability,
    },
    commandId,
    command,
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

function withBob(sceneId = "scene:shrine") {
  let scenario = start();
  scenario = commit(scenario, administration(scenario, "admin:join-bob", {
    kind: "grantSeat",
    principal: { id: BOB.principalId, sessionVersion: 1 },
    role: "player",
    seatId: BOB.seatId,
    character: {
      id: BOB.characterId,
      kind: "player",
      name: "鲍勃",
      sceneId,
      tenureStatus: "active",
    },
  })).scenario;
  return scenario;
}

function directAction(scenario, proposalId, characterId, fictionTimeCostMicros) {
  return commit(scenario, {
    kind: "resolveFreeAction",
    proposalId,
    characterId,
    goal: `推进 ${proposalId}`,
    method: "在当前地点采取一项有明确耗时的行动",
    feasibility: {
      kind: "directSuccess",
      publicBasis: "行动可行且没有需要掷骰的不确定性。",
    },
    outcome: { fictionTimeCostMicros },
  });
}

test("service-authoritative membership, Seat, control, host, and pending revocation share one event path", () => {
  let scenario = start();
  const forged = step(scenario.profiles, scenario.state, administration(
    scenario,
    "admin:forged",
    { kind: "grantSeat", principal: { id: BOB.principalId, sessionVersion: 1 }, role: "player", seatId: BOB.seatId },
    `sha256:${"0".repeat(64)}`,
  ));
  assert.equal(forged.kind, "rejected");
  assert.equal(forged.rejection.code, "roomAdministrationUnauthorized");
  assert.deepEqual(forged.events, []);

  const joined = commit(scenario, administration(scenario, "admin:join-bob", {
    kind: "grantSeat",
    principal: { id: BOB.principalId, sessionVersion: 1 },
    role: "player",
    seatId: BOB.seatId,
    character: {
      id: BOB.characterId,
      kind: "player",
      name: "鲍勃",
      sceneId: "scene:shrine",
      tenureStatus: "active",
    },
  }));
  scenario = joined.scenario;
  assert.deepEqual(joined.result.events.map(({ eventType }) => eventType), [
    "MemberJoined",
    "SeatGranted",
    "CharacterControlGranted",
  ]);

  const bobRead = project(scenario.profiles, scenario.state, viewer(BOB));
  assert.equal(bobRead.kind, "projected", JSON.stringify(bobRead));
  assert.equal(bobRead.controlledCharacter.characterId, BOB.characterId);
  assert.deepEqual(bobRead.roomMembers, [
    { principalId: ALICE.principalId, role: "host", characterIds: [ALICE.characterId], seatStatus: "active" },
    { principalId: BOB.principalId, role: "player", characterIds: [BOB.characterId], seatStatus: "active" },
  ]);

  const pending = commit(scenario, {
    kind: "resolveImprovisedAction",
    rootActionId: "root:bob:clarification",
    actorCharacterId: BOB.characterId,
    ruling: {
      kind: "clarification",
      pendingInputId: "pending:bob:clarification",
      question: "你拉警铃还是闸门？",
    },
  }, "awaitingInput");
  scenario = pending.scenario;

  const removed = commit(scenario, administration(scenario, "admin:remove-bob", {
    kind: "removeMember",
    principalId: BOB.principalId,
    reason: "hostRemoved",
  }));
  scenario = removed.scenario;
  assert.deepEqual(removed.result.events.map(({ eventType }) => eventType), [
    "CharacterControlRevoked",
    "PendingInputSuspended",
    "SeatVacated",
    "MemberRemoved",
  ]);
  assert.equal(project(scenario.profiles, scenario.state, viewer(BOB)).kind, "rejected");
  const staleAnswer = step(scenario.profiles, scenario.state, {
    kind: "answerPendingInput",
    pendingInputId: "pending:bob:clarification",
    rootActionId: "root:bob:clarification",
    controllerCharacterId: BOB.characterId,
    answer: { choiceId: "gate" },
    proposal: { kind: "resolveImprovisedAction", ruling: { kind: "directSuccess", outcomeCode: "gate" } },
  });
  assert.equal(staleAnswer.kind, "rejected");
  assert.deepEqual(staleAnswer.events, []);

  const rejoined = commit(scenario, administration(scenario, "admin:rejoin-bob", {
    kind: "grantSeat",
    principal: { id: BOB.principalId, sessionVersion: 2 },
    role: "player",
    seatId: BOB.seatId,
    character: {
      id: BOB.characterId,
      kind: "player",
      name: "鲍勃",
      sceneId: "scene:shrine",
      tenureStatus: "active",
    },
  }));
  scenario = rejoined.scenario;
  assert.deepEqual(rejoined.result.events.map(({ eventType }) => eventType), [
    "MemberJoined",
    "SeatReactivated",
    "CharacterControlGranted",
    "PendingInputResumed",
  ]);
  const bobRejoined = project(scenario.profiles, scenario.state, {
    ...viewer(BOB),
    sessionVersion: 2,
  });
  assert.equal(bobRejoined.kind, "projected", JSON.stringify(bobRejoined));
  assert.deepEqual(bobRejoined.pendingInputs.map(({ pendingInputId }) => pendingInputId), [
    "pending:bob:clarification",
  ]);

  const missingHost = step(scenario.profiles, scenario.state, administration(scenario, "admin:host-missing", {
    kind: "transferHost",
    fromPrincipalId: ALICE.principalId,
    toPrincipalId: "principal:rules-multi:missing",
  }));
  assert.equal(missingHost.kind, "rejected");
  assert.equal(missingHost.rejection.code, "targetSeatUnavailable");
  assert.deepEqual(missingHost.events, []);
});

test("character materialization, semantic gear changes, and host departure stay on authoritative events", () => {
  let scenario = start();
  scenario = commit(scenario, administration(scenario, "admin:seat-bob", {
    kind: "grantSeat",
    principal: { id: BOB.principalId, sessionVersion: 1 },
    role: "player",
    seatId: BOB.seatId,
  })).scenario;

  const materialized = commit(scenario, administration(scenario, "admin:materialize-bob", {
    kind: "materializeCharacter",
    principalId: BOB.principalId,
    seatId: BOB.seatId,
    character: {
      id: BOB.characterId,
      kind: "player",
      name: "鲍勃",
      sceneId: "scene:shrine",
      tenureStatus: "active",
      classId: "fighter",
      raceId: "human",
      level: 3,
      hitPoints: { current: 24, maximum: 24 },
      resources: { "resource:second-wind": 1 },
      abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 13, cha: 8 },
      proficiencyBonus: 2,
      proficientSkills: ["athletics", "perception"],
      expertiseSkills: [],
      proficientSaves: ["str", "con"],
      loadout: {
        armorClass: 17,
        speedFeet: 30,
        equipped: { armor: "chain", main: "warhammer", off: "shield" },
        backpack: [{ itemId: "explorer-pack", quantity: 10 }],
      },
      characterBuild: { classId: "fighter", raceId: "human", cantrips: [], prepared: [] },
    },
  }));
  scenario = materialized.scenario;
  const materializedTypes = materialized.result.events.map(({ eventType }) => eventType);
  assert.equal(materializedTypes[0], "CharacterControlGranted");
  assert.equal(materializedTypes.includes("CharacterMechanicsSynchronized"), false);
  assert.equal(materializedTypes.filter((eventType) => eventType === "ItemDefinitionRegistered").length, 4);
  assert.equal(materializedTypes.filter((eventType) => eventType === "ItemMaterialized").length, 4);
  assert.equal(materializedTypes.filter((eventType) => eventType === "ItemAcquired").length, 4);
  assert.equal(scenario.state.entities[BOB.characterId].abilityScores.str, 16);
  assert.equal(scenario.state.entities[BOB.characterId].loadout.armorClass, 19);

  const stowed = commit(scenario, {
    kind: "changeCharacterGear",
    rootActionId: "root:stow-bob-shield",
    controllerPrincipalId: BOB.principalId,
    actorCharacterId: BOB.characterId,
    action: "stow",
    slot: "off",
  });
  scenario = stowed.scenario;
  assert.deepEqual(stowed.result.events.map(({ eventType }) => eventType), [
    "ActivityStarted",
    "FictionTimeAdvanced",
    "ActivityCompleted",
    "CharacterGearChanged",
  ]);
  assert.equal(scenario.state.entities[BOB.characterId].loadout.armorClass, 17);
  assert.deepEqual(scenario.state.entities[BOB.characterId].loadout.backpack, [
    {
      itemId: initialStandardGearEntryId(BOB.characterId, "explorer-pack", "stack"),
      quantity: 10,
    },
    { itemId: initialStandardGearEntryId(BOB.characterId, "shield", 1), quantity: 1 },
  ]);
  assert.equal(scenario.state.entities[BOB.characterId].hitPoints.current, 24);
  assert.equal(scenario.state.entities[BOB.characterId].resources["resource:second-wind"], 1);
  assert.ok(scenario.state.combatRuntime.entities[BOB.characterId].abilityRefs.some((abilityRef) =>
    abilityRef.startsWith(`ability:${BOB.characterId}:class:second-wind:`)));
  assert.equal(scenario.state.combatRuntime.entities[BOB.characterId].hitPoints.current, "24");

  const departed = commit(scenario, administration(scenario, "admin:host-transfer-depart", {
    kind: "transferHostAndDepart",
    fromPrincipalId: ALICE.principalId,
    toPrincipalId: BOB.principalId,
    reason: "host left the table",
  }));
  scenario = departed.scenario;
  assert.deepEqual(departed.result.events.map(({ eventType }) => eventType), [
    "HostTransferred",
    "CharacterControlRevoked",
    "SeatVacated",
    "MemberDeparted",
  ]);
  assert.equal(scenario.state.multiplayerRuntime.hostPrincipalId, BOB.principalId);
  assert.equal(scenario.state.multiplayerRuntime.members[ALICE.principalId].status, "departed");
  assert.equal(scenario.state.multiplayerRuntime.members[BOB.principalId].role, "host");
  assert.equal(project(scenario.profiles, scenario.state, viewer(ALICE)).kind, "rejected");
});

test("PartyGroup consent gates atomic group movement while personal movement atomically leaves", () => {
  let scenario = withBob();
  const invited = commit(scenario, {
    kind: "invitePartyMember",
    rootActionId: "root:party:invite-bob",
    inviterCharacterId: ALICE.characterId,
    invitedCharacterId: BOB.characterId,
  }, "awaitingInput");
  scenario = invited.scenario;
  assert.deepEqual(invited.result.events.map(({ eventType }) => eventType), [
    "PartyGroupCreated",
    "PartyMemberInvited",
  ]);
  const invitationPendingId = invited.result.pending.pendingInputId;
  assert.deepEqual(
    project(scenario.profiles, scenario.state, viewer(ALICE)).pendingInputs.map(({ pendingInputId, access }) => ({
      pendingInputId,
      access,
    })),
    [{ pendingInputId: invitationPendingId, access: "initiator" }],
  );
  assert.deepEqual(
    project(scenario.profiles, scenario.state, viewer(BOB)).pendingInputs.map(({ pendingInputId }) => pendingInputId),
    [invitationPendingId],
  );

  const accepted = commit(scenario, {
    kind: "answerPartyInvitation",
    rootActionId: "root:party:invite-bob",
    pendingInputId: invitationPendingId,
    controllerCharacterId: BOB.characterId,
    accept: true,
  });
  scenario = accepted.scenario;
  assert.deepEqual(accepted.result.events.map(({ eventType }) => eventType), [
    "PartyInvitationAnswered",
    "PartyMemberJoined",
  ]);
  const aliceGroup = project(scenario.profiles, scenario.state, viewer(ALICE)).partyGroups;
  assert.equal(aliceGroup.length, 1);
  assert.deepEqual(aliceGroup[0].memberCharacterIds, [ALICE.characterId, BOB.characterId]);

  const proposed = commit(scenario, {
    kind: "proposePartyMove",
    rootActionId: "root:party:move-yard",
    leaderCharacterId: ALICE.characterId,
    destinationSceneId: "scene:yard",
    fictionTimeCostMicros: "60000000",
  }, "awaitingInput");
  scenario = proposed.scenario;
  const movePendingId = proposed.result.pending.pendingInputId;
  assert.equal(scenario.state.entities[ALICE.characterId].sceneId, "scene:shrine");
  assert.equal(scenario.state.entities[BOB.characterId].sceneId, "scene:shrine");

  const moved = commit(scenario, {
    kind: "answerPartyMove",
    rootActionId: "root:party:move-yard",
    pendingInputId: movePendingId,
    controllerCharacterId: BOB.characterId,
    accept: true,
  });
  scenario = moved.scenario;
  assert.deepEqual(moved.result.events.map(({ eventType }) => eventType), [
    "PartyMoveConsentRecorded",
    "PartyMoved",
  ]);
  assert.equal(scenario.state.entities[ALICE.characterId].sceneId, "scene:yard");
  assert.equal(scenario.state.entities[BOB.characterId].sceneId, "scene:yard");

  const split = commit(scenario, {
    kind: "moveIndividually",
    rootActionId: "root:party:bob-cellar",
    characterId: BOB.characterId,
    destinationSceneId: "scene:cellar",
    fictionTimeCostMicros: "30000000",
  });
  scenario = split.scenario;
  assert.deepEqual(split.result.events.map(({ eventType }) => eventType), [
    "PartyMemberLeft",
    "CharacterMoved",
  ]);
  assert.equal(scenario.state.entities[ALICE.characterId].sceneId, "scene:yard");
  assert.equal(scenario.state.entities[BOB.characterId].sceneId, "scene:cellar");
  assert.deepEqual(project(scenario.profiles, scenario.state, viewer(BOB)).partyGroups, []);
});

test("an inviter sees only structural outgoing invitation status and can cancel it authoritatively", () => {
  let scenario = withBob();
  const invited = commit(scenario, {
    kind: "invitePartyMember",
    rootActionId: "root:party:cancel-invitation",
    inviterCharacterId: ALICE.characterId,
    invitedCharacterId: BOB.characterId,
  }, "awaitingInput");
  scenario = invited.scenario;
  const pendingInputId = invited.result.pending.pendingInputId;

  const inviterRead = project(scenario.profiles, scenario.state, viewer(ALICE));
  assert.deepEqual(inviterRead.pendingInputs, [{
    pendingInputId,
    kind: "partyInvitation",
    rootActionId: "root:party:cancel-invitation",
    question: "等待对方回应同行邀请。",
    access: "initiator",
    inviterCharacterId: ALICE.characterId,
    invitedCharacterId: BOB.characterId,
  }]);
  const invitedRead = project(scenario.profiles, scenario.state, viewer(BOB));
  assert.deepEqual(invitedRead.pendingInputs, [{
    pendingInputId,
    kind: "partyInvitation",
    rootActionId: "root:party:cancel-invitation",
    question: "是否接受同行邀请？",
    access: "controller",
    inviterCharacterId: ALICE.characterId,
    invitedCharacterId: BOB.characterId,
  }]);

  const cancelled = commit(scenario, {
    kind: "cancelPartyInvitation",
    rootActionId: "root:party:cancel-command",
    pendingInputId,
    inviterCharacterId: ALICE.characterId,
  });
  scenario = cancelled.scenario;
  assert.deepEqual(cancelled.result.events.map(({ eventType }) => eventType), [
    "PartyInvitationCancelled",
    "PartyGroupDisbanded",
  ]);
  assert.deepEqual(project(scenario.profiles, scenario.state, viewer(ALICE)).pendingInputs, []);
  assert.deepEqual(project(scenario.profiles, scenario.state, viewer(BOB)).pendingInputs, []);
  assert.deepEqual(project(scenario.profiles, scenario.state, viewer(ALICE)).partyGroups, []);

  const staleAnswer = step(scenario.profiles, scenario.state, {
    kind: "answerPartyInvitation",
    rootActionId: "root:party:cancel-invitation",
    pendingInputId,
    controllerCharacterId: BOB.characterId,
    accept: true,
  });
  assert.equal(staleAnswer.kind, "rejected");
  assert.deepEqual(staleAnswer.events, []);
});

test("split locations keep independent FictionTimeline/CausalFrontier and Spotlight never advances time", () => {
  let scenario = withBob("scene:yard");

  scenario = directAction(
    scenario,
    "root:timeline:alice-search",
    ALICE.characterId,
    "120000000",
  ).scenario;
  scenario = directAction(
    scenario,
    "root:timeline:bob-listen",
    BOB.characterId,
    "5000000",
  ).scenario;

  const aliceRead = project(scenario.profiles, scenario.state, viewer(ALICE), { channel: "realtime" });
  const bobRead = project(scenario.profiles, scenario.state, viewer(BOB), { channel: "reconnect" });
  assert.equal(aliceRead.kind, "projected", JSON.stringify(aliceRead));
  assert.equal(bobRead.kind, "projected", JSON.stringify(bobRead));
  assert.equal(aliceRead.fictionTime.nowMicros, "120000000");
  assert.equal(bobRead.fictionTime.nowMicros, "5000000");
  assert.equal(aliceRead.causalFrontier.sceneId, "scene:shrine");
  assert.equal(bobRead.causalFrontier.sceneId, "scene:yard");
  assert.equal("causalFrontiers" in aliceRead, false);
  assert.equal("causalFrontiers" in bobRead, false);

  const bobRealtime = project(scenario.profiles, scenario.state, viewer(BOB), { channel: "realtime" });
  assert.deepEqual(bobRealtime, bobRead);

  for (let index = 0; index < 5; index += 1) {
    scenario = directAction(
      scenario,
      `root:spotlight:alice:${index}`,
      ALICE.characterId,
      "1",
    ).scenario;
  }
  const spotlightRead = project(scenario.profiles, scenario.state, viewer(ALICE));
  const beats = Object.values(spotlightRead.spotlightLedger).map(({ decisionBeats }) => BigInt(decisionBeats));
  const gap = beats.reduce((maximum, beat) => beat > maximum ? beat : maximum)
    - beats.reduce((minimum, beat) => beat < minimum ? beat : minimum);
  assert.ok(gap <= 3n);
  assert.equal(spotlightRead.spotlightLedger[BOB.characterId].invited, true);
  assert.equal(spotlightRead.fictionTime.nowMicros, "120000005");
  assert.equal(project(scenario.profiles, scenario.state, viewer(BOB)).fictionTime.nowMicros, "5000000");
});

test("service control transfer rebinds pending input, and personal rest atomically leaves PartyGroup", () => {
  let scenario = withBob();
  scenario = commit(scenario, {
    kind: "resolveImprovisedAction",
    rootActionId: "root:service-transfer:pending",
    actorCharacterId: ALICE.characterId,
    ruling: {
      kind: "clarification",
      pendingInputId: "pending:service-transfer:alice",
      question: "你检查左侧还是右侧？",
    },
  }, "awaitingInput").scenario;

  const transferred = commit(scenario, administration(scenario, "admin:transfer-alice", {
    kind: "transferControl",
    characterId: ALICE.characterId,
    fromSeatId: ALICE.seatId,
    toSeatId: BOB.seatId,
  }));
  scenario = transferred.scenario;
  assert.deepEqual(transferred.result.events.map(({ eventType }) => eventType), [
    "CharacterControlTransferred",
    "PendingInputReassigned",
  ]);
  assert.equal(project(scenario.profiles, scenario.state, viewer(ALICE)).kind, "rejected");
  const bobControlsAlice = project(scenario.profiles, scenario.state, {
    kind: "player",
    principalId: BOB.principalId,
    sessionVersion: 1,
    seatId: BOB.seatId,
    characterId: ALICE.characterId,
  });
  assert.equal(bobControlsAlice.kind, "projected", JSON.stringify(bobControlsAlice));
  assert.deepEqual(
    bobControlsAlice.pendingInputs.map(({ pendingInputId }) => pendingInputId),
    ["pending:service-transfer:alice"],
  );

  const host = commit(scenario, administration(scenario, "admin:host-bob", {
    kind: "transferHost",
    fromPrincipalId: ALICE.principalId,
    toPrincipalId: BOB.principalId,
  }));
  scenario = host.scenario;
  assert.equal(
    project(scenario.profiles, scenario.state, {
      ...viewer(BOB),
      characterId: ALICE.characterId,
    }).roomMembers.find(({ principalId }) => principalId === BOB.principalId).role,
    "host",
  );

  const restored = commit(scenario, administration(scenario, "admin:revoke-alice", {
    kind: "revokeControl",
    characterId: ALICE.characterId,
    seatId: BOB.seatId,
    reason: "seatReassignment",
  }));
  scenario = restored.scenario;
  assert.deepEqual(restored.result.events.map(({ eventType }) => eventType), [
    "CharacterControlRevoked",
    "PendingInputSuspended",
  ]);
  scenario = commit(scenario, administration(scenario, "admin:grant-alice", {
    kind: "grantControl",
    characterId: ALICE.characterId,
    seatId: ALICE.seatId,
  })).scenario;

  const invited = commit(scenario, {
    kind: "invitePartyMember",
    rootActionId: "root:rest-party:invite",
    inviterCharacterId: ALICE.characterId,
    invitedCharacterId: BOB.characterId,
  }, "awaitingInput");
  scenario = invited.scenario;
  scenario = commit(scenario, {
    kind: "answerPartyInvitation",
    rootActionId: "root:rest-party:invite",
    pendingInputId: invited.result.pending.pendingInputId,
    controllerCharacterId: BOB.characterId,
    accept: true,
  }).scenario;
  const rest = commit(scenario, {
    kind: "startRest",
    proposalId: "root:rest-party:bob-short",
    characterId: BOB.characterId,
    restKind: "short",
    intendedDurationMicros: "3600000000",
  });
  scenario = rest.scenario;
  assert.deepEqual(rest.result.events.map(({ eventType }) => eventType), [
    "PartyMemberLeft",
    "RestStarted",
  ]);
  assert.deepEqual(project(scenario.profiles, scenario.state, viewer(BOB)).partyGroups, []);
  assert.equal(scenario.state.campaignRuntime.activities["activity:root:rest-party:bob-short"].status, "active");
});

test("group rest is voluntary per controlled character and freezes one shared fictional instant", () => {
  let scenario = withBob();
  const invited = commit(scenario, {
    kind: "invitePartyMember",
    rootActionId: "root:group-rest:party",
    inviterCharacterId: ALICE.characterId,
    invitedCharacterId: BOB.characterId,
  }, "awaitingInput");
  scenario = invited.scenario;
  scenario = commit(scenario, {
    kind: "answerPartyInvitation",
    rootActionId: "root:group-rest:party",
    pendingInputId: invited.result.pending.pendingInputId,
    controllerCharacterId: BOB.characterId,
    accept: true,
  }).scenario;

  const offered = commit(scenario, {
    kind: "startRest",
    proposalId: "root:group-rest:offer",
    characterId: ALICE.characterId,
    restKind: "short",
    intendedDurationMicros: "3600000000",
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
    memberCharacterIds: [BOB.characterId],
  }, "awaitingInput");
  scenario = offered.scenario;
  assert.deepEqual(offered.result.events.map(({ eventType }) => eventType), [
    "RestStarted",
    "GroupRestOffered",
  ]);
  assert.equal(project(scenario.profiles, scenario.state, viewer(ALICE)).pendingInputs.length, 0);
  const bobPending = project(scenario.profiles, scenario.state, viewer(BOB)).pendingInputs[0];
  assert.equal(bobPending.kind, "groupRestConsent");
  assert.equal(bobPending.options.offeredAtFictionMicros, "0");

  const forged = step(scenario.profiles, scenario.state, {
    kind: "answerGroupRestInvitation",
    proposalId: "root:group-rest:offer",
    pendingInputId: bobPending.pendingInputId,
    controllerCharacterId: ALICE.characterId,
    accept: true,
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
  });
  assert.equal(forged.kind, "rejected");
  assert.ok(scenario.state.pendingInputs[bobPending.pendingInputId]);

  const accepted = commit(scenario, {
    kind: "answerGroupRestInvitation",
    proposalId: "root:group-rest:offer",
    pendingInputId: bobPending.pendingInputId,
    controllerCharacterId: BOB.characterId,
    accept: true,
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
  });
  scenario = accepted.scenario;
  assert.deepEqual(accepted.result.events.map(({ eventType }) => eventType), [
    "RestStarted",
    "GroupRestConsentRecorded",
  ]);
  const aliceActivity = scenario.state.campaignRuntime.activities[
    `activity:root:group-rest:offer:${ALICE.characterId}`
  ];
  const bobActivity = scenario.state.campaignRuntime.activities[
    `activity:root:group-rest:offer:${BOB.characterId}`
  ];
  assert.equal(aliceActivity.startedAtFictionMicros, "0");
  assert.equal(bobActivity.startedAtFictionMicros, "0");
  assert.equal(scenario.state.receipts["root:group-rest:offer"].status, "committed");
  assert.equal(Object.values(scenario.state.multiplayerRuntime.partyGroups)[0].status, "active");

  let declinedScenario = withBob();
  const declineInvite = commit(declinedScenario, {
    kind: "invitePartyMember",
    rootActionId: "root:group-rest:decline-party",
    inviterCharacterId: ALICE.characterId,
    invitedCharacterId: BOB.characterId,
  }, "awaitingInput");
  declinedScenario = declineInvite.scenario;
  declinedScenario = commit(declinedScenario, {
    kind: "answerPartyInvitation",
    rootActionId: "root:group-rest:decline-party",
    pendingInputId: declineInvite.result.pending.pendingInputId,
    controllerCharacterId: BOB.characterId,
    accept: true,
  }).scenario;
  const declineOffer = commit(declinedScenario, {
    kind: "startRest",
    proposalId: "root:group-rest:decline",
    characterId: ALICE.characterId,
    restKind: "short",
    intendedDurationMicros: "3600000000",
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
    memberCharacterIds: [BOB.characterId],
  }, "awaitingInput");
  declinedScenario = declineOffer.scenario;
  const declined = commit(declinedScenario, {
    kind: "answerGroupRestInvitation",
    proposalId: "root:group-rest:decline",
    pendingInputId: declineOffer.result.pending.pendingInputId,
    controllerCharacterId: BOB.characterId,
    accept: false,
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
  });
  assert.deepEqual(declined.result.events.map(({ eventType }) => eventType), [
    "GroupRestConsentRecorded",
  ]);
  assert.equal(
    Object.values(declined.scenario.state.campaignRuntime.activities)
      .some((activity) => activity.characterId === BOB.characterId),
    false,
  );
});

test("world-medium propagation and co-located meeting explicitly join causal frontiers", () => {
  let scenario = withBob("scene:yard");
  scenario = directAction(
    scenario,
    "root:causal:alice-signal",
    ALICE.characterId,
    "120000000",
  ).scenario;
  scenario = commit(scenario, {
    kind: "declareCanonicalFact",
    proposalId: "root:causal:bell-fact",
    fact: {
      factId: "fact:causal:bell-medium",
      factKind: "audibleSignalMedium",
      subjectRefs: [ALICE.characterId],
      value: { sourceSceneId: "scene:shrine", speed: "worldDefined" },
      visibilityPolicy: "public",
      source: "characterAction",
      causalParentIds: [],
    },
  }).scenario;
  scenario = directAction(
    scenario,
    "root:causal:bob-waits",
    BOB.characterId,
    "125000000",
  ).scenario;

  const sourceTimelineId = scenario.state.multiplayerRuntime.characterTimelineIds[ALICE.characterId];
  const targetTimelineId = scenario.state.multiplayerRuntime.characterTimelineIds[BOB.characterId];
  const tooEarly = step(scenario.profiles, scenario.state, {
    kind: "propagateCausalFrontier",
    rootActionId: "root:causal:too-early",
    sourceTimelineId,
    targetTimelineId,
    arrivalMicros: "119999999",
    mediumFactId: "fact:causal:bell-medium",
  });
  assert.equal(tooEarly.kind, "rejected");
  assert.equal(tooEarly.rejection.code, "causalFrontierConflict");
  assert.deepEqual(tooEarly.events, []);

  const propagated = commit(scenario, {
    kind: "propagateCausalFrontier",
    rootActionId: "root:causal:bell-arrives",
    sourceTimelineId,
    targetTimelineId,
    arrivalMicros: "120000000",
    mediumFactId: "fact:causal:bell-medium",
  });
  scenario = propagated.scenario;
  assert.deepEqual(propagated.result.events.map(({ eventType }) => eventType), [
    "CausalFrontierPropagated",
  ]);
  assert.deepEqual(
    project(scenario.profiles, scenario.state, viewer(BOB)).causalFrontier.receivedFromTimelineIds,
    [sourceTimelineId],
  );

  scenario = commit(scenario, {
    kind: "moveIndividually",
    rootActionId: "root:causal:alice-meets-bob",
    characterId: ALICE.characterId,
    destinationSceneId: "scene:yard",
    fictionTimeCostMicros: "5000000",
  }).scenario;
  const met = commit(scenario, {
    kind: "synchronizeFictionTimelines",
    rootActionId: "root:causal:meeting",
    characterIds: [ALICE.characterId, BOB.characterId],
    sceneId: "scene:yard",
    meetingMicros: "125000000",
  });
  scenario = met.scenario;
  assert.deepEqual(met.result.events.map(({ eventType }) => eventType), ["FictionTimelinesMet"]);
  const aliceRead = project(scenario.profiles, scenario.state, viewer(ALICE));
  const bobRead = project(scenario.profiles, scenario.state, viewer(BOB));
  assert.equal(aliceRead.kind, "projected", JSON.stringify(aliceRead));
  assert.equal(bobRead.kind, "projected", JSON.stringify(bobRead));
  assert.equal(aliceRead.fictionTime.nowMicros, "125000000");
  assert.equal(bobRead.fictionTime.nowMicros, "125000000");
  assert.equal(
    aliceRead.causalFrontier.eventHeadId,
    met.result.events[0].eventId,
  );
});
