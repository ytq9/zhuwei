import assert from "node:assert/strict";
import test from "node:test";

import { project, replay, step } from "../app/_runtime/lib/rules/index.ts";

const ROOT_ACTION_ID = "root:pending:lever";
const PENDING_INPUT_ID = "pending:pending:lever:which";
const PLAYER_CHOICE_PENDING_INPUT_ID = "pending:pending:lever:choice";
const CHARACTER_ID = "character:pending:alice";
const BOB_CHARACTER_ID = "character:pending:bob";

function profileRef(profileId, digit) {
  return {
    profileId,
    profileHash: `sha256:${digit.repeat(64)}`,
  };
}

function initialize() {
  const initialized = step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:rules-pending-v2",
    runtimeEpochId: "epoch:rules-pending-v2:1",
    moduleRef: profileRef("module:rules-pending-v2", "b"),
    initialDefinitionCatalogRef: profileRef("definitions:rules-pending-v2", "c"),
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{ id: "scene:gatehouse", name: "门楼" }],
    principals: [
      { id: "principal:pending:alice", sessionVersion: 1 },
      { id: "principal:pending:bob", sessionVersion: 1 },
    ],
    seats: [
      { id: "seat:pending:alice", principalId: "principal:pending:alice", status: "active" },
      { id: "seat:pending:bob", principalId: "principal:pending:bob", status: "active" },
    ],
    characters: [{
      id: CHARACTER_ID,
      kind: "player",
      name: "爱丽丝",
      sceneId: "scene:gatehouse",
      tenureStatus: "active",
    }, {
      id: BOB_CHARACTER_ID,
      kind: "player",
      name: "博林",
      sceneId: "scene:gatehouse",
      tenureStatus: "active",
    }],
    characterControls: [
      { characterId: CHARACTER_ID, seatId: "seat:pending:alice" },
      { characterId: BOB_CHARACTER_ID, seatId: "seat:pending:bob" },
    ],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const replayed = replay(initialized.genesis, []);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return { genesis: initialized.genesis, profiles: initialized.profiles, state: replayed.state, events: [] };
}

function askClarification(scenario) {
  const asked = step(scenario.profiles, scenario.state, {
    kind: "resolveImprovisedAction",
    rootActionId: ROOT_ACTION_ID,
    actorCharacterId: CHARACTER_ID,
    ruling: {
      kind: "clarification",
      pendingInputId: PENDING_INPUT_ID,
      question: "你拉警铃还是闸门拉杆？",
    },
  });
  assert.equal(asked.kind, "awaitingInput", JSON.stringify(asked));
  const events = [...scenario.events, ...asked.events];
  const replayed = replay(scenario.genesis, events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return { ...scenario, state: replayed.state, events };
}

function answerInput(overrides = {}) {
  return {
    kind: "answerPendingInput",
    pendingInputId: PENDING_INPUT_ID,
    rootActionId: ROOT_ACTION_ID,
    controllerCharacterId: CHARACTER_ID,
    answer: { choiceId: "gate" },
    proposal: {
      kind: "resolveImprovisedAction",
      ruling: {
        kind: "directSuccess",
        outcomeCode: "gate-opened",
        fact: {
          id: "fact:gate-opened",
          kind: "passageOpened",
          source: "characterAction",
          subjectRefs: ["scene:gatehouse"],
          value: { passageId: "passage:east-gate", open: true },
          visibilityPolicyId: "visibility:scene-observers",
        },
      },
    },
    ...overrides,
  };
}

function commit(scenario, input, expectedKind = "committed") {
  const result = step(scenario.profiles, scenario.state, input);
  assert.equal(result.kind, expectedKind, JSON.stringify(result));
  const events = [...scenario.events, ...result.events];
  const replayed = replay(scenario.genesis, events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return { scenario: { ...scenario, state: replayed.state, events }, result, replayed };
}

function correctionInput(scenario, correctionId, targetReceiptId, overrides = {}) {
  const replayed = replay(scenario.genesis, scenario.events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return {
    kind: "applyServiceCorrection",
    correctionAuthority: {
      kind: "roomCorrectionAuthority",
      capability: replayed.state.correctionRuntime.authorityCapability,
    },
    correctionId,
    targetReceiptId,
    actorCharacterId: CHARACTER_ID,
    errorKind: "rulesMisapplication",
    publicExplanation: "已提交裁决采用了错误规则，现以可审计事件更正。",
    basis: {
      stateHash: replayed.head.stateHash,
      eventHash: replayed.head.eventHash,
    },
    ...overrides,
  };
}

test("generic pending answer atomically closes clarification and commits its same-root outcome", () => {
  const scenario = askClarification(initialize());
  const answered = step(scenario.profiles, scenario.state, answerInput());

  assert.equal(answered.kind, "committed", JSON.stringify(answered));
  assert.deepEqual(answered.events.map(({ eventType }) => eventType), [
    "PendingInputAnswered",
    "ImprovisedActionResolved",
  ]);
  assert.ok(answered.events.every(({ rootActionId }) => rootActionId === ROOT_ACTION_ID));
  assert.equal(answered.receipt.rootActionId, ROOT_ACTION_ID);

  const eventLog = [...scenario.events, ...answered.events];
  const replayed = replay(scenario.genesis, eventLog);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  assert.equal(replayed.state.pendingInputs[PENDING_INPUT_ID], undefined);
  assert.equal(replayed.state.canonicalFacts["fact:gate-opened"].value.open, true);

  const projected = project(scenario.profiles, replayed.state, {
    kind: "player",
    principalId: "principal:pending:alice",
    sessionVersion: 1,
    seatId: "seat:pending:alice",
    characterId: CHARACTER_ID,
  }, { channel: "reconnect" });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  assert.deepEqual(projected.pendingInputs, []);
});

test("generic pending answer fails closed without emitting a partial close", () => {
  const scenario = askClarification(initialize());

  for (const invalid of [
    answerInput({ rootActionId: "root:other" }),
    answerInput({ controllerCharacterId: "character:other" }),
    answerInput({ pendingInputId: "pending:unknown" }),
    { ...answerInput(), statePatch: { pendingInputs: {} } },
  ]) {
    const result = step(scenario.profiles, scenario.state, invalid);
    assert.equal(result.kind, "rejected", JSON.stringify(result));
    assert.deepEqual(result.events, []);
  }

  assert.ok(scenario.state.pendingInputs[PENDING_INPUT_ID]);
});

test("player choice preserves its closed candidates and rejects a forged answer", () => {
  let scenario = initialize();
  const choices = [
    { choiceId: "alarm", label: "拉下警铃", consequence: "警铃会通知门楼守卫。" },
    { choiceId: "gate", label: "拉下闸门杆", consequence: "东侧闸门会开始升起。" },
  ];
  const asked = step(scenario.profiles, scenario.state, {
    kind: "resolveImprovisedAction",
    rootActionId: ROOT_ACTION_ID,
    actorCharacterId: CHARACTER_ID,
    ruling: {
      kind: "playerChoice",
      pendingInputId: PLAYER_CHOICE_PENDING_INPUT_ID,
      question: "你明确选择哪一根拉杆？",
      choices,
    },
  });
  assert.equal(asked.kind, "awaitingInput", JSON.stringify(asked));
  assert.deepEqual(asked.events.map(({ eventType }) => eventType), ["PlayerChoiceRequested"]);
  scenario = {
    ...scenario,
    events: [...scenario.events, ...asked.events],
  };
  const replayed = replay(scenario.genesis, scenario.events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  scenario.state = replayed.state;

  const projected = project(scenario.profiles, scenario.state, {
    kind: "player",
    principalId: "principal:pending:alice",
    sessionVersion: 1,
    seatId: "seat:pending:alice",
    characterId: CHARACTER_ID,
  }, { channel: "poll" });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  assert.deepEqual(projected.pendingInputs, [{
    pendingInputId: PLAYER_CHOICE_PENDING_INPUT_ID,
    kind: "playerChoice",
    rootActionId: ROOT_ACTION_ID,
    question: "你明确选择哪一根拉杆？",
    choices,
  }]);
  const absentControllerProjection = project(scenario.profiles, scenario.state, {
    kind: "player",
    principalId: "principal:pending:bob",
    sessionVersion: 1,
    seatId: "seat:pending:bob",
    characterId: BOB_CHARACTER_ID,
  }, { channel: "reconnect" });
  assert.equal(absentControllerProjection.kind, "projected", JSON.stringify(absentControllerProjection));
  assert.deepEqual(absentControllerProjection.pendingInputs, []);

  const resolutionProposal = {
    kind: "resolveImprovisedAction",
    ruling: {
      kind: "directSuccess",
      outcomeCode: "gate-opened",
    },
  };
  const forged = step(scenario.profiles, scenario.state, {
    kind: "answerPendingInput",
    pendingInputId: PLAYER_CHOICE_PENDING_INPUT_ID,
    rootActionId: ROOT_ACTION_ID,
    controllerCharacterId: CHARACTER_ID,
    answer: { choiceId: "hidden-third-option" },
    proposal: resolutionProposal,
  });
  assert.equal(forged.kind, "rejected", JSON.stringify(forged));
  assert.deepEqual(forged.events, []);

  const answered = step(scenario.profiles, scenario.state, {
    kind: "answerPendingInput",
    pendingInputId: PLAYER_CHOICE_PENDING_INPUT_ID,
    rootActionId: ROOT_ACTION_ID,
    controllerCharacterId: CHARACTER_ID,
    answer: { choiceId: "gate" },
    proposal: resolutionProposal,
  });
  assert.equal(answered.kind, "committed", JSON.stringify(answered));
  assert.deepEqual(answered.events.map(({ eventType }) => eventType), [
    "PendingInputAnswered",
    "ImprovisedActionResolved",
  ]);
});

test("service correction compensates an isolated reversible effect without rewriting its event", () => {
  let scenario = initialize();
  const advanced = commit(scenario, {
    kind: "resolveFreeAction",
    proposalId: "root:mistaken-time-cost",
    characterId: CHARACTER_ID,
    goal: "查看已经打开的闸门",
    method: "站在原地观察",
    feasibility: {
      kind: "directSuccess",
      publicBasis: "观察没有有意义的失败风险。",
    },
    outcome: { fictionTimeCostMicros: "1000000" },
  });
  scenario = advanced.scenario;
  assert.equal(scenario.state.fictionTimelines[scenario.state.activeBranchId].nowMicros, "1000000");
  const targetReceiptId = scenario.state.receipts["root:mistaken-time-cost"].receiptId;

  const corrected = commit(
    scenario,
    correctionInput(scenario, "correction:mistaken-time-cost", targetReceiptId),
  );
  scenario = corrected.scenario;
  assert.equal(corrected.result.strategy, "forwardCompensation");
  assert.deepEqual(corrected.result.events.map(({ eventType }) => eventType), ["CorrectionApplied"]);
  assert.equal(scenario.state.fictionTimelines[scenario.state.activeBranchId].nowMicros, "0");
  assert.ok(scenario.events.some(({ eventType }) => eventType === "FictionTimeAdvanced"));
});

test("service correction opens a causal branch and removes wrong-branch fact and private knowledge", () => {
  let scenario = initialize();
  const fact = commit(scenario, {
    kind: "resolveImprovisedAction",
    rootActionId: "root:wrong-secret",
    actorCharacterId: CHARACTER_ID,
    ruling: {
      kind: "directSuccess",
      outcomeCode: "wrong-secret-materialized",
      fact: {
        id: "fact:wrong-secret",
        kind: "secretLocation",
        source: "mechanicalResolution",
        subjectRefs: [CHARACTER_ID],
        value: { text: "错误分支的密语是白槲树" },
        visibilityPolicyId: "visibility:kp-internal",
      },
    },
  });
  scenario = fact.scenario;
  const targetReceiptId = scenario.state.receipts["root:wrong-secret"].receiptId;
  scenario = commit(scenario, {
    kind: "acquireSensoryEvidence",
    proposalId: "root:learn-wrong-secret",
    characterId: CHARACTER_ID,
    factId: "fact:wrong-secret",
    sense: "hearing",
    clarity: "full",
    publicEvidence: "错误分支的密语是白槲树",
  }).scenario;
  const oldBranchId = scenario.state.activeBranchId;
  const oldEventIds = scenario.events.map(({ eventId }) => eventId);

  const corrected = commit(
    scenario,
    correctionInput(scenario, "correction:wrong-secret", targetReceiptId),
  );
  scenario = corrected.scenario;
  assert.equal(corrected.result.strategy, "causalBranch");
  assert.deepEqual(corrected.result.events.map(({ eventType }) => eventType), [
    "CorrectionBranchOpened",
    "BranchActivated",
  ]);
  assert.notEqual(scenario.state.activeBranchId, oldBranchId);
  assert.equal(scenario.state.canonicalFacts["fact:wrong-secret"], undefined);
  assert.equal(scenario.state.knowledge[CHARACTER_ID]["fact:wrong-secret"], undefined);
  assert.ok(oldEventIds.every((eventId) => scenario.events.some((event) => event.eventId === eventId)));
  assert.equal(scenario.state.receipts["root:wrong-secret"].status, "superseded");
  assert.equal(scenario.state.receipts["root:learn-wrong-secret"].status, "superseded");

  const projected = project(scenario.profiles, scenario.state, {
    kind: "player",
    principalId: "principal:pending:alice",
    sessionVersion: 1,
    seatId: "seat:pending:alice",
    characterId: CHARACTER_ID,
  });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  assert.equal(projected.activeBranchId, scenario.state.activeBranchId);
  assert.doesNotMatch(JSON.stringify(projected), /白槲树/);

  for (const invalid of [
    { ...correctionInput(scenario, "correction:patch", targetReceiptId), statePatch: {} },
    { ...correctionInput(scenario, "correction:dice", targetReceiptId), rolls: [20] },
    correctionInput(scenario, "correction:unauthorized", targetReceiptId, {
      correctionAuthority: {
        kind: "roomCorrectionAuthority",
        capability: `sha256:${"0".repeat(64)}`,
      },
    }),
  ]) {
    const result = step(scenario.profiles, scenario.state, invalid);
    assert.equal(result.kind, "rejected", JSON.stringify(result));
    assert.deepEqual(result.events, []);
  }
});
