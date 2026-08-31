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
const CHARLIE = {
  principalId: "principal:rules-multi:charlie",
  seatId: "seat:rules-multi:charlie",
  characterId: "character:rules-multi:charlie",
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
      { x: "420", y: "180", elevation: "0" },
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

function withBobAndCharlie() {
  let scenario = withBob();
  scenario = commit(scenario, administration(scenario, "admin:join-charlie", {
    kind: "grantSeat",
    principal: { id: CHARLIE.principalId, sessionVersion: 1 },
    role: "player",
    seatId: CHARLIE.seatId,
    character: {
      id: CHARLIE.characterId,
      kind: "player",
      name: "查理",
      sceneId: "scene:shrine",
      tenureStatus: "active",
    },
  })).scenario;
  return scenario;
}

function withBobAndCharlieInParty(rootPrefix) {
  let scenario = withBobAndCharlie();
  for (const person of [BOB, CHARLIE]) {
    const rootActionId = `${rootPrefix}:${person === BOB ? "bob" : "charlie"}`;
    const invited = commit(scenario, {
      kind: "invitePartyMember",
      rootActionId,
      inviterCharacterId: ALICE.characterId,
      invitedCharacterId: person.characterId,
    }, "awaitingInput");
    scenario = invited.scenario;
    scenario = commit(scenario, {
      kind: "answerPartyInvitation",
      rootActionId,
      pendingInputId: invited.result.pending.pendingInputId,
      controllerCharacterId: person.characterId,
      accept: true,
    }).scenario;
  }
  return scenario;
}

function withBobInParty(rootActionId) {
  let scenario = withBob();
  const invited = commit(scenario, {
    kind: "invitePartyMember",
    rootActionId,
    inviterCharacterId: ALICE.characterId,
    invitedCharacterId: BOB.characterId,
  }, "awaitingInput");
  scenario = invited.scenario;
  return commit(scenario, {
    kind: "answerPartyInvitation",
    rootActionId,
    pendingInputId: invited.result.pending.pendingInputId,
    controllerCharacterId: BOB.characterId,
    accept: true,
  }).scenario;
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

function fulfillSyntheticStrenuousMove(scenario, suffix) {
  const state = structuredClone(scenario.state);
  const rootActionId = `actor-plan-due:group-rest-scope:${suffix}`;
  const resolutionId = `resolution:${rootActionId}:move`;
  const continuationId = `continuation:${resolutionId}`;
  const request = {
    randomnessId: `randomness:${rootActionId}:move`,
    resolutionId,
    actorCharacterId: ALICE.characterId,
    purpose: "improvisedCheck",
    diceExpression: "1d20",
    frozenCheck: {
      kind: "ability",
      ability: "strength",
      skill: null,
      dc: "1",
      modifier: "0",
      mode: "normal",
      goal: "连续赶路一小时",
      method: "从神龛赶往庭院",
      risk: "长休会被剧烈活动中断",
      successOutcome: "抵达庭院",
      failureOutcome: "未能抵达庭院",
      costs: [],
    },
  };
  const continuation = {
    kind: "roomAuthorityRandomness",
    continuationId,
    capability: `sha256:${"0".repeat(64)}`,
  };
  state.internalContinuations[continuationId] = {
    continuation,
    rootActionId,
    request,
    resolutionPlan: {
      schema: "zhuwei.compound-resolution-plan/v1",
      actorCharacterId: ALICE.characterId,
      goal: "连续赶路一小时",
      method: "从神龛赶往庭院",
      sourceSceneId: "scene:shrine",
      durationMicros: "3600000000",
      primaryFactRef: "fact:group-rest:scope:strenuous-move",
      frozenCosts: [],
      successEffects: [{
        kind: "moveEntity",
        entityRef: ALICE.characterId,
        sceneRef: "scene:yard",
      }],
      failureEffects: [],
    },
  };
  const resolved = step(scenario.profiles, state, {
    kind: "fulfillAuthoritativeRandomnessBatch",
    results: [{ continuation, rolls: [20] }],
  });
  assert.equal(resolved?.kind, "committed", JSON.stringify(resolved));
  return resolved;
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
        backpack: [{ itemId: "gp", quantity: 10 }],
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
      itemId: initialStandardGearEntryId(BOB.characterId, "gp", "stack"),
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

  const interruptedAfterAllAnswered = commit(scenario, {
    kind: "interruptActivity",
    proposalId: "root:group-rest:interrupt-after-all-answered",
    activityId: `activity:root:group-rest:offer:${ALICE.characterId}`,
    cause: { kind: "playerCancelledRest", characterId: ALICE.characterId },
  });
  scenario = interruptedAfterAllAnswered.scenario;
  assert.equal(
    scenario.state.campaignRuntime.activities[`activity:root:group-rest:offer:${ALICE.characterId}`].status,
    "interrupted",
  );
  assert.equal(
    scenario.state.campaignRuntime.activities[`activity:root:group-rest:offer:${BOB.characterId}`].status,
    "active",
  );
  assert.equal(scenario.state.receipts["root:group-rest:offer"].status, "committed");

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

test("group rest remains awaiting while its only remaining invitation is suspended", () => {
  let scenario = withBobAndCharlieInParty("root:group-rest:suspended-only-party");
  const rootActionId = "root:group-rest:suspended-only-offer";
  const offered = commit(scenario, {
    kind: "startRest",
    proposalId: rootActionId,
    characterId: ALICE.characterId,
    restKind: "short",
    intendedDurationMicros: "3600000000",
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
    memberCharacterIds: [BOB.characterId, CHARLIE.characterId],
  }, "awaitingInput");
  scenario = offered.scenario;
  const bobPendingInputId = `pending:group-rest:${rootActionId}:${BOB.characterId}`;
  const charliePendingInputId = `pending:group-rest:${rootActionId}:${CHARLIE.characterId}`;
  assert.ok(scenario.state.pendingInputs[bobPendingInputId]);
  assert.ok(scenario.state.pendingInputs[charliePendingInputId]);

  scenario = commit(scenario, administration(scenario, "admin:group-rest:suspend-charlie", {
    kind: "removeMember",
    principalId: CHARLIE.principalId,
    reason: "temporaryDisconnect",
  })).scenario;
  assert.equal(scenario.state.pendingInputs[charliePendingInputId], undefined);
  assert.ok(scenario.state.multiplayerRuntime.suspendedPendingInputs[charliePendingInputId]);

  const bobAnswered = commit(scenario, {
    kind: "answerGroupRestInvitation",
    proposalId: rootActionId,
    pendingInputId: bobPendingInputId,
    controllerCharacterId: BOB.characterId,
    accept: true,
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
  }, "awaitingInput");
  scenario = bobAnswered.scenario;
  assert.deepEqual(bobAnswered.result.pending, {
    pendingInputId: charliePendingInputId,
    kind: "groupRestConsent",
    question: "是否自愿加入短休？请自行选择恢复资源。",
    controller: { kind: "character", characterId: CHARLIE.characterId },
    options: {
      initiatorCharacterId: ALICE.characterId,
      restKind: "short",
      intendedDurationMicros: "3600000000",
      offeredAtFictionMicros: "0",
    },
  });
  assert.ok(bobAnswered.result.scopeProof.reads.includes(`pending:${bobPendingInputId}`));
  assert.ok(bobAnswered.result.scopeProof.reads.includes(`pending:${charliePendingInputId}`));
  assert.equal(scenario.state.receipts[rootActionId].status, "awaitingInput");
  assert.equal(
    scenario.state.campaignRuntime.activities[`activity:${rootActionId}:${BOB.characterId}`].status,
    "active",
  );

  scenario = commit(scenario, administration(scenario, "admin:group-rest:resume-charlie", {
    kind: "grantSeat",
    principal: { id: CHARLIE.principalId, sessionVersion: 2 },
    role: "player",
    seatId: CHARLIE.seatId,
    character: {
      id: CHARLIE.characterId,
      kind: "player",
      name: "查理",
      sceneId: "scene:shrine",
      tenureStatus: "active",
    },
  })).scenario;
  assert.ok(scenario.state.pendingInputs[charliePendingInputId]);
  assert.equal(
    scenario.state.multiplayerRuntime.suspendedPendingInputs[charliePendingInputId],
    undefined,
  );
  const charlieAnswered = commit(scenario, {
    kind: "answerGroupRestInvitation",
    proposalId: rootActionId,
    pendingInputId: charliePendingInputId,
    controllerCharacterId: CHARLIE.characterId,
    accept: true,
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
  });
  assert.equal(charlieAnswered.scenario.state.receipts[rootActionId].status, "committed");
  assert.equal(
    charlieAnswered.scenario.state.campaignRuntime.activities[
      `activity:${rootActionId}:${CHARLIE.characterId}`
    ].status,
    "active",
  );
});

test("interrupting a group-rest initiator closes active and suspended unanswered invitations", () => {
  let activeScenario = withBobInParty("root:group-rest:interrupt-active-party");
  const activeOffer = commit(activeScenario, {
    kind: "startRest",
    proposalId: "root:group-rest:interrupt-active-offer",
    characterId: ALICE.characterId,
    restKind: "short",
    intendedDurationMicros: "3600000000",
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
    memberCharacterIds: [BOB.characterId],
  }, "awaitingInput");
  activeScenario = activeOffer.scenario;
  const activePendingInputId = activeOffer.result.pending.pendingInputId;
  const activeInterrupted = commit(activeScenario, {
    kind: "interruptActivity",
    proposalId: "root:group-rest:interrupt-active",
    activityId: `activity:root:group-rest:interrupt-active-offer:${ALICE.characterId}`,
    cause: { kind: "playerCancelledRest", characterId: ALICE.characterId },
  });
  activeScenario = activeInterrupted.scenario;
  assert.equal(activeScenario.state.pendingInputs[activePendingInputId], undefined);
  assert.equal(
    activeScenario.state.receipts["root:group-rest:interrupt-active-offer"].status,
    "superseded",
  );
  assert.ok(activeInterrupted.result.scopeProof.writes.includes(`pending:${activePendingInputId}`));
  assert.ok(activeInterrupted.result.scopeProof.writes.includes(
    "receipt:root:group-rest:interrupt-active-offer",
  ));
  const staleAnswer = step(activeScenario.profiles, activeScenario.state, {
    kind: "answerGroupRestInvitation",
    proposalId: "root:group-rest:interrupt-active-offer",
    pendingInputId: activePendingInputId,
    controllerCharacterId: BOB.characterId,
    accept: true,
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
  });
  assert.equal(staleAnswer.kind, "rejected");

  let suspendedScenario = withBobInParty("root:group-rest:interrupt-suspended-party");
  const suspendedOffer = commit(suspendedScenario, {
    kind: "startRest",
    proposalId: "root:group-rest:interrupt-suspended-offer",
    characterId: ALICE.characterId,
    restKind: "short",
    intendedDurationMicros: "3600000000",
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
    memberCharacterIds: [BOB.characterId],
  }, "awaitingInput");
  suspendedScenario = suspendedOffer.scenario;
  const suspendedPendingInputId = suspendedOffer.result.pending.pendingInputId;
  suspendedScenario = commit(suspendedScenario, administration(
    suspendedScenario,
    "admin:group-rest:suspend-bob",
    {
      kind: "revokeControl",
      characterId: BOB.characterId,
      seatId: BOB.seatId,
      reason: "temporaryDisconnect",
    },
  )).scenario;
  assert.equal(suspendedScenario.state.pendingInputs[suspendedPendingInputId], undefined);
  assert.ok(suspendedScenario.state.multiplayerRuntime.suspendedPendingInputs[suspendedPendingInputId]);

  const suspendedInterrupted = commit(suspendedScenario, {
    kind: "interruptActivity",
    proposalId: "root:group-rest:interrupt-suspended",
    activityId: `activity:root:group-rest:interrupt-suspended-offer:${ALICE.characterId}`,
    cause: { kind: "playerCancelledRest", characterId: ALICE.characterId },
  });
  suspendedScenario = suspendedInterrupted.scenario;
  assert.equal(
    suspendedScenario.state.multiplayerRuntime.suspendedPendingInputs[suspendedPendingInputId],
    undefined,
  );
  assert.equal(
    suspendedScenario.state.receipts["root:group-rest:interrupt-suspended-offer"].status,
    "superseded",
  );
  assert.ok(suspendedInterrupted.result.scopeProof.writes.includes(`pending:${suspendedPendingInputId}`));

  const interruptedReplay = replay(suspendedScenario.genesis, suspendedScenario.events);
  assert.equal(interruptedReplay.kind, "replayed", JSON.stringify(interruptedReplay));
  const interruptionReceipt = suspendedScenario.state.receipts[
    "root:group-rest:interrupt-suspended"
  ];
  const corrected = commit(suspendedScenario, {
    kind: "applyServiceCorrection",
    correctionAuthority: {
      kind: "roomCorrectionAuthority",
      capability: suspendedScenario.state.correctionRuntime.authorityCapability,
    },
    correctionId: "correction:group-rest:interrupt-suspended",
    targetReceiptId: interruptionReceipt.receiptId,
    actorCharacterId: ALICE.characterId,
    errorKind: "rulesMisapplication",
    publicExplanation: "撤销错误的团体休息中断裁决。",
    basis: {
      stateHash: interruptedReplay.head.stateHash,
      eventHash: interruptedReplay.head.eventHash,
    },
  });
  assert.equal(corrected.result.strategy, "causalBranch");
  assert.ok(corrected.result.events
    .find(({ eventType }) => eventType === "BranchActivated")
    .payload.effects.some((effect) => effect.kind === "restoreGroupRestInterruption"));
  assert.equal(
    corrected.scenario.state.campaignRuntime.activities[
      `activity:root:group-rest:interrupt-suspended-offer:${ALICE.characterId}`
    ].status,
    "active",
  );
  assert.ok(
    corrected.scenario.state.multiplayerRuntime.suspendedPendingInputs[suspendedPendingInputId],
  );
  assert.equal(
    corrected.scenario.state.receipts["root:group-rest:interrupt-suspended-offer"].status,
    "awaitingInput",
  );
});

test("strenuous long-rest movement scopes active and suspended group-rest invitations", () => {
  let activeScenario = withBobInParty("root:group-rest:scope-active-party");
  const activeOffer = commit(activeScenario, {
    kind: "startRest",
    proposalId: "root:group-rest:scope-active-offer",
    characterId: ALICE.characterId,
    restKind: "long",
    intendedDurationMicros: "28800000000",
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
    memberCharacterIds: [BOB.characterId],
  }, "awaitingInput");
  activeScenario = activeOffer.scenario;
  const activePendingInputId = activeOffer.result.pending.pendingInputId;
  const activeMove = fulfillSyntheticStrenuousMove(activeScenario, "active");
  assert.deepEqual(
    activeMove.events.filter(({ eventType }) => eventType === "ActivityInterrupted")
      .map(({ payload }) => payload.cause.kind),
    ["longRestStrenuousTravel2014"],
  );
  assert.ok(activeMove.scopeProof.reads.includes(`pending:${activePendingInputId}`));
  assert.ok(activeMove.scopeProof.writes.includes(`pending:${activePendingInputId}`));
  assert.ok(activeMove.scopeProof.reads.includes("receipt:root:group-rest:scope-active-offer"));
  assert.ok(activeMove.scopeProof.writes.includes("receipt:root:group-rest:scope-active-offer"));
  assert.equal(activeMove.state.pendingInputs[activePendingInputId], undefined);
  assert.equal(
    activeMove.state.receipts["root:group-rest:scope-active-offer"].status,
    "superseded",
  );
  assert.equal(
    activeMove.scopeProof.writes.includes("receipt:root:group-rest:scope-active-party"),
    false,
  );

  let suspendedScenario = withBobInParty("root:group-rest:scope-suspended-party");
  const suspendedOffer = commit(suspendedScenario, {
    kind: "startRest",
    proposalId: "root:group-rest:scope-suspended-offer",
    characterId: ALICE.characterId,
    restKind: "long",
    intendedDurationMicros: "28800000000",
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
    memberCharacterIds: [BOB.characterId],
  }, "awaitingInput");
  suspendedScenario = suspendedOffer.scenario;
  const suspendedPendingInputId = suspendedOffer.result.pending.pendingInputId;
  suspendedScenario = commit(suspendedScenario, administration(
    suspendedScenario,
    "admin:group-rest:scope-suspend-bob",
    {
      kind: "revokeControl",
      characterId: BOB.characterId,
      seatId: BOB.seatId,
      reason: "temporaryDisconnect",
    },
  )).scenario;
  const suspendedMove = fulfillSyntheticStrenuousMove(suspendedScenario, "suspended");
  assert.ok(suspendedMove.scopeProof.reads.includes(`pending:${suspendedPendingInputId}`));
  assert.ok(suspendedMove.scopeProof.writes.includes(`pending:${suspendedPendingInputId}`));
  assert.ok(suspendedMove.scopeProof.reads.includes(
    "receipt:root:group-rest:scope-suspended-offer",
  ));
  assert.ok(suspendedMove.scopeProof.writes.includes(
    "receipt:root:group-rest:scope-suspended-offer",
  ));
  assert.equal(
    suspendedMove.state.multiplayerRuntime.suspendedPendingInputs[suspendedPendingInputId],
    undefined,
  );
  assert.equal(
    suspendedMove.state.receipts["root:group-rest:scope-suspended-offer"].status,
    "superseded",
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
