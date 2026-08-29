import assert from "node:assert/strict";
import test from "node:test";

import {
  CAUSAL_ACTION_LANGUAGE_PROFILE,
  compileKpFormDraft,
  lowerCausalActionProgram,
  stableStructuralHash,
} from "../app/_runtime/lib/kp/causal-action-program.ts";
import { normalizeRoomKpProposal } from "../app/_runtime/lib/room/proposal-adapter.ts";
import { project, replay, step } from "../app/_runtime/lib/rules/index.ts";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import {
  CURRENT_RUNTIME_PROFILE_MANIFEST,
  ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
  ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
  LEGACY_ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
} from "../app/_runtime/lib/rules/profiles/manifests.ts";
import {
  CAUSAL_ACTION_INTERPRETER_PROFILE,
} from "../app/_runtime/lib/rules/profiles/causal-action-interpreter.ts";
import {
  eventHash,
  validateEventEnvelope,
} from "../app/_runtime/lib/rules/v2/events.ts";
import {
  isCausalActionResolutionPlan,
  validateExecutableCausalActionProgram,
} from "../app/_runtime/lib/rules/v2/causal-model.ts";
import {
  hashWorldState,
  unsignedGenesis,
} from "../app/_runtime/lib/rules/v2/validation.ts";

const ACTOR = "character:causal-v3:alice";
const BOB = "character:causal-v3:bob";
const WORKSHOP_BASIS = "fact:causal-v3:workshop-old-renovations";

function profileRef(profileId, digit) {
  return { profileId, profileHash: `sha256:${digit.repeat(64)}` };
}

function initialize(
  profiles = ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
  suffix = "environment",
  actorOverrides = {},
) {
  const initialized = step(profiles, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: `room:causal-action-rules-v3:${suffix}`,
    runtimeEpochId: `epoch:causal-action-rules-v3:${suffix}:1`,
    moduleRef: profileRef("module:causal-action-rules-v3", "a"),
    initialDefinitionCatalogRef: profileRef("definitions:causal-action-rules-v3", "b"),
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [
      { id: "scene:workshop", name: "废弃工坊" },
      { id: "scene:annex", name: "工坊侧厅" },
    ],
    principals: [
      { id: "principal:causal-v3:alice", sessionVersion: 1, role: "host" },
      { id: "principal:causal-v3:bob", sessionVersion: 1, role: "player" },
    ],
    seats: [
      { id: "seat:causal-v3:alice", principalId: "principal:causal-v3:alice", status: "active" },
      { id: "seat:causal-v3:bob", principalId: "principal:causal-v3:bob", status: "active" },
    ],
    characters: [{
      id: ACTOR,
      kind: "player",
      name: "阿莱莎",
      sceneId: "scene:workshop",
      tenureStatus: "active",
      classId: "fighter",
      level: 3,
      abilityScores: { str: 14, dex: 12, con: 12, int: 16, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      proficientSkills: ["animal", "investigation", "sleight"],
      resources: { resolve: 2 },
      resourceMaximums: { resolve: 2 },
      hitPoints: { current: 20, maximum: 20 },
      loadout: {
        armorClass: 14,
        speedFeet: 30,
        equipped: { main: "shortsword" },
        backpack: [{ itemId: "crowbar", quantity: 2 }],
      },
      characterBuild: { classId: "fighter", raceId: "human", cantrips: [], prepared: [] },
      ...actorOverrides,
    }, {
      id: BOB,
      kind: "player",
      name: "柏舟",
      sceneId: "scene:workshop",
      tenureStatus: "active",
      classId: "cleric",
      level: 3,
      abilityScores: { str: 10, dex: 10, con: 12, int: 10, wis: 16, cha: 12 },
      proficiencyBonus: 2,
      proficientSkills: ["insight"],
      resources: { "spellSlot:1": 2 },
      resourceMaximums: { "spellSlot:1": 2 },
      hitPoints: { current: 18, maximum: 18 },
      loadout: { armorClass: 16, speedFeet: 30, equipped: {}, backpack: [] },
      characterBuild: {
        classId: "cleric",
        raceId: "human",
        cantrips: ["sacred-flame"],
        prepared: ["guiding-bolt"],
      },
    }],
    characterControls: [
      { characterId: ACTOR, seatId: "seat:causal-v3:alice" },
      { characterId: BOB, seatId: "seat:causal-v3:bob" },
    ],
    canonicalFacts: [{
      id: WORKSHOP_BASIS,
      kind: "moduleAnchor",
      source: "moduleAnchor",
      subjectRefs: ["scene:workshop"],
      value: { description: "工坊侧墙留有多次封堵和翻修的旧痕迹。" },
      visibilityPolicyId: "visibility:scene-observers",
    }],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const rebuilt = replay(initialized.genesis, []);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  return { genesis: initialized.genesis, profiles: initialized.profiles, state: rebuilt.state };
}

function observationInput(rootActionId, overrides = {}) {
  const draft = {
    goal: "检查门轴",
    method: "观察磨损并试推",
    focus: "门轴上的新鲜划痕",
    desiredInformation: "最近是否有人使用这扇门",
    resolution: "check",
    ability: "int",
    skill: "investigation",
    dc: 12,
    mode: "normal",
    durationUnit: "minute",
    durationValue: 1,
    successConsequence: "确认门轴刚被使用。",
    failureConsequence: "无法判断划痕的新旧。",
    ...overrides,
  };
  const normalized = normalizeRoomKpProposal(privateEnvelope("observe.v1", draft));
  assert.ok(normalized);
  return { ...normalized, rootActionId, actorCharacterId: ACTOR };
}

function rehashProgram(program) {
  program.semanticHash = stableStructuralHash({
    languageRef: program.languageRef,
    languageHash: program.languageHash,
    formRef: program.formRef,
    formHash: program.formHash,
    nodes: program.nodes,
    resultNodeIds: program.resultNodeIds,
  });
}

function privateEnvelope(formId, draft) {
  const program = compileKpFormDraft(formId, draft);
  return {
    kind: "privateFormProposal",
    formId,
    draft,
    causalActionProgram: program,
    loweredCausalProgram: lowerCausalActionProgram(program),
    semanticFreezeHash: program.semanticHash,
    repairUsed: false,
    proposalAttemptId: `proposal:${program.semanticHash}`,
    modelInvocationReceipt: { provider: "test", requestId: "request:causal-v3" },
  };
}

function causalMarkerEvent(outcome, label) {
  assert.ok("events" in outcome, `${label} must return canonical events`);
  const markers = outcome.events.filter((event) =>
    event.eventType === "ImprovisedActionResolved"
    && event.payload?.outcomeCode === "causal-program-frozen");
  assert.equal(markers.length, 1, `${label} must emit exactly one causal marker`);
  return markers[0];
}

function assertExactCausalMarker({
  room,
  input,
  outcome,
  formId,
  actorCharacterId,
  rootActionId,
  basisRefs,
  label,
}) {
  const marker = causalMarkerEvent(outcome, label);
  const program = input.causalActionProgram;
  assert.deepEqual(marker.profiles, room.profiles, `${label} must retain the V3 manifest`);
  assert.equal(marker.rootActionId, rootActionId);
  assert.equal(marker.resolutionId, null);
  assert.equal(marker.visibilityPolicyId, "visibility:room-authority-only");
  assert.equal(marker.secrecy, "internal");
  assert.deepEqual(marker.payload, {
    actorCharacterId,
    outcomeCode: "causal-program-frozen",
    fact: {
      id: `fact:v3-causal-program:${rootActionId}:${program.semanticHash.slice("fnv1a64:".length)}`,
      kind: "causalActionProgram",
      subjectRefs: [actorCharacterId],
      value: {
        interpreterProfile: { ...CAUSAL_ACTION_INTERPRETER_PROFILE },
        languageRef: CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef,
        languageHash: CAUSAL_ACTION_LANGUAGE_PROFILE.languageHash,
        formRef: formId,
        formHash: program.formHash,
        programHash: program.semanticHash,
        basisRefs,
      },
      visibilityPolicyId: "visibility:room-authority-only",
      source: "characterAction",
    },
  }, `${label} must emit the exact V3 causal marker`);
  return marker;
}

function injectCausalMarkerIntoGenesis(genesis, marker) {
  const injected = structuredClone(genesis);
  injected.initialState.canonicalFacts[marker.payload.fact.id] = {
    ...structuredClone(marker.payload.fact),
    branchId: injected.initialState.activeBranchId,
    validFromEventSeq: "0",
    causalParentIds: [],
  };
  injected.initialStateHash = hashWorldState(injected.initialState);
  injected.initialState.eventHeadHash = injected.initialStateHash;
  injected.genesisHash = canonicalSha256(unsignedGenesis(injected));
  return injected;
}

test("V3 compound program executes every direct/check stage, one frozen cost, and branch effects", () => {
  const room = initialize();
  const draft = {
    goal: "先固定滑轮，再沿检修梁拉开沉重隔板",
    method: "分阶段使用撬棍、绳结和对重",
    stages: [
      {
        goal: "固定滑轮",
        method: "把撬棍横插入支架并锁住绳结",
        intendedOutcome: "滑轮不再回转",
        resolution: "direct",
      },
      {
        goal: "辨认正确对重",
        method: "检查磨痕后拉动对应绳索",
        intendedOutcome: "隔板开始离开卡槽",
        risk: "误认对重会让隔板继续卡死",
        resolution: "check",
        ability: "int",
        skill: "investigation",
        dc: 12,
        mode: "normal",
        successConsequence: "正确对重受力，隔板离开卡槽。",
        failureConsequence: "错误对重受力，隔板仍然卡住。",
      },
    ],
    intendedOutcome: "隔板被完全拉开，队伍可以通过",
    risk: "最后的同步拉动若失败，隔板会重新落回卡槽",
    resolution: "check",
    ability: "str",
    skill: "none",
    dc: 15,
    mode: "normal",
    durationUnit: "minute",
    durationValue: 2,
    successConsequence: "隔板稳定在开启位置。",
    failureConsequence: "隔板重新落回卡槽，但前两阶段留下的结果仍然成立。",
    resourceRef: "resolve",
    resourceAmount: 1,
    artifactRef: "item:crowbar",
    artifactCount: 1,
  };
  const normalized = normalizeRoomKpProposal(privateEnvelope("compound.v1", draft));
  assert.ok(normalized);
  assert.equal(normalized.kind, "resolveCompoundActionPlan");
  assert.equal(normalized.actionPlanVersion, "causal-action-program-v3");
  assert.equal("actorCharacterId" in normalized, false);
  assert.equal("rootActionId" in normalized, false);
  assert.equal("mechanicalProposal" in normalized, false);
  assert.equal(JSON.stringify(normalized).includes("authoritative-kp-action-plan-v1"), false);

  const rootActionId = "root:causal-v3:compound:1";
  const pending = step(room.profiles, room.state, {
    ...normalized,
    rootActionId,
    actorCharacterId: ACTOR,
  });
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  assert.deepEqual(pending.randomnessRequests.map((request) => request.resolutionId), [
    `${"resolution:" + rootActionId}:causal:n02`,
    `${"resolution:" + rootActionId}:causal:n03`,
  ]);
  assert.equal(pending.state.entities[ACTOR].resources.resolve, 1);
  assert.equal(pending.state.entities[ACTOR].loadout.backpack[0].quantity, 1);
  assert.equal(pending.events.filter((event) => event.eventType === "ResourceReserved").length, 1);
  assert.equal(pending.events.filter((event) => event.eventType === "ItemUsed").length, 1);
  assert.ok(pending.events.every((event) => event.scopeProofHash.startsWith("sha256:")));

  const completed = step(room.profiles, pending.state, {
    kind: "fulfillAuthoritativeRandomnessBatch",
    results: pending.continuations.map((continuation, index) => ({
      continuation,
      rolls: [index === 0 ? 18 : 1],
    })),
  });
  assert.equal(completed.kind, "committed", JSON.stringify(completed));
  assert.deepEqual(completed.mechanicalResult.nodes.map((node) => ({
    nodeRef: node.nodeRef,
    resolution: node.resolution,
    branch: node.branch,
  })), [
    { nodeRef: "n01", resolution: "direct", branch: "success" },
    { nodeRef: "n02", resolution: "check", branch: "success" },
    { nodeRef: "n03", resolution: "check", branch: "failure" },
  ]);
  const contents = Object.values(completed.state.knowledge[ACTOR]).map((entry) => entry.content);
  assert.ok(contents.includes("滑轮不再回转"));
  assert.ok(contents.includes("正确对重受力，隔板离开卡槽。"));
  assert.ok(contents.includes("隔板重新落回卡槽，但前两阶段留下的结果仍然成立。"));
  assert.equal(completed.events.filter((event) => event.eventType === "DiceRolled").length, 2);
  assert.equal(completed.events.filter((event) => event.eventType === "ImprovisedCheckResolved").length, 2);
  assert.equal(completed.events.filter((event) => event.eventType === "FictionTimeAdvanced").length, 1);
  assert.equal(JSON.stringify([...pending.events, ...completed.events]).includes("authoritative-kp-action-plan-v1"), false);

  const archive = [...pending.events, ...completed.events];
  const rebuilt = replay(room.genesis, archive);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.equal(rebuilt.head.stateHash, completed.stateHash);
  const repeated = step(room.profiles, completed.state, {
    kind: "fulfillAuthoritativeRandomnessBatch",
    results: pending.continuations.map((continuation, index) => ({
      continuation,
      rolls: [index === 0 ? 18 : 1],
    })),
  });
  assert.equal(repeated.kind, "rejected");
});

test("a failed causal prerequisite skips its dependent closure without success effects", () => {
  const draft = {
    goal: "先辨认承重销，再拔销打开隔板",
    method: "按先决顺序检查并操作",
    stages: [{
      goal: "辨认承重销",
      method: "检查磨损方向",
      intendedOutcome: "确认正确的承重销",
      risk: "误判会阻止后续操作",
      resolution: "check",
      ability: "int",
      skill: "investigation",
      dc: 20,
      mode: "normal",
      successConsequence: "正确承重销已确认。",
      failureConsequence: "无法确认哪一枚是承重销。",
    }, {
      goal: "拔出承重销",
      method: "用撬棍卸力后拔销",
      intendedOutcome: "隔板锁止解除",
      resolution: "direct",
    }],
    intendedOutcome: "隔板可以被推开",
    resolution: "direct",
    durationUnit: "minute",
    durationValue: 1,
  };
  const normalized = normalizeRoomKpProposal(privateEnvelope("compound.v1", draft));
  assert.ok(normalized);

  const failedRoom = initialize(undefined, "compound-prerequisite-failure");
  const failedPending = step(failedRoom.profiles, failedRoom.state, {
    ...normalized,
    rootActionId: "root:causal-v3:compound-prerequisite:failure",
    actorCharacterId: ACTOR,
  });
  assert.equal(failedPending.kind, "awaitingRandomness", JSON.stringify(failedPending));
  const failed = step(failedRoom.profiles, failedPending.state, {
    kind: "fulfillAuthoritativeRandomness",
    continuation: failedPending.continuation,
    rolls: [1],
  });
  assert.equal(failed.kind, "committed", JSON.stringify(failed));
  assert.deepEqual(failed.mechanicalResult.nodes.map((node) => ({
    nodeRef: node.nodeRef,
    succeeded: node.succeeded,
    skipped: node.skipped === true,
  })), [
    { nodeRef: "n01", succeeded: false, skipped: false },
    { nodeRef: "n02", succeeded: false, skipped: true },
    { nodeRef: "n03", succeeded: false, skipped: true },
  ]);
  const failedKnowledge = JSON.stringify(failed.state.knowledge[ACTOR]);
  assert.ok(failedKnowledge.includes("无法确认哪一枚是承重销。"));
  assert.equal(failedKnowledge.includes("隔板锁止解除"), false);
  assert.equal(failedKnowledge.includes("隔板可以被推开"), false);

  const successfulRoom = initialize(undefined, "compound-prerequisite-success");
  const successfulPending = step(successfulRoom.profiles, successfulRoom.state, {
    ...normalized,
    rootActionId: "root:causal-v3:compound-prerequisite:success",
    actorCharacterId: ACTOR,
  });
  assert.equal(successfulPending.kind, "awaitingRandomness", JSON.stringify(successfulPending));
  const successful = step(successfulRoom.profiles, successfulPending.state, {
    kind: "fulfillAuthoritativeRandomness",
    continuation: successfulPending.continuation,
    rolls: [20],
  });
  assert.equal(successful.kind, "committed", JSON.stringify(successful));
  assert.ok(successful.mechanicalResult.nodes.every((node) => node.succeeded && node.skipped !== true));
  const successfulKnowledge = JSON.stringify(successful.state.knowledge[ACTOR]);
  assert.ok(successfulKnowledge.includes("隔板锁止解除"));
  assert.ok(successfulKnowledge.includes("隔板可以被推开"));
  const rebuilt = replay(successfulRoom.genesis, [
    ...successfulPending.events,
    ...successful.events,
  ]);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.equal(rebuilt.head.stateHash, successful.stateHash);
});

test("V3 causal input fails closed under legacy manifest and semantic-hash tampering", () => {
  const room = initialize();
  const draft = {
    goal: "检查门轴",
    method: "观察磨损并试推",
    focus: "门轴上的新鲜划痕",
    desiredInformation: "最近是否有人使用这扇门",
    resolution: "check",
    ability: "int",
    skill: "investigation",
    dc: 12,
    mode: "normal",
    durationUnit: "minute",
    durationValue: 1,
    successConsequence: "确认门轴刚被使用。",
    failureConsequence: "无法判断划痕的新旧。",
  };
  const normalized = normalizeRoomKpProposal(privateEnvelope("observe.v1", draft));
  assert.ok(normalized);
  const input = {
    ...normalized,
    rootActionId: "root:causal-v3:tamper",
    actorCharacterId: ACTOR,
  };
  const legacyRoom = initialize(CURRENT_RUNTIME_PROFILE_MANIFEST, "legacy");
  const legacy = step(legacyRoom.profiles, legacyRoom.state, input);
  assert.equal(legacy.kind, "rejected");
  assert.equal(legacy.rejection.code, "unsupportedOperation");

  const tampered = structuredClone(input);
  tampered.causalActionProgram.nodes[0].arguments.dc = 30;
  const rejected = step(room.profiles, room.state, tampered);
  assert.equal(rejected.kind, "rejected");
  assert.equal(rejected.rejection.code, "invalidRulesInput");
});

test("a normal V3 form uses the same Rules language and one authoritative continuation", () => {
  const room = initialize(undefined, "normal-form");
  const draft = {
    goal: "检查门轴",
    method: "观察磨损并试推",
    focus: "门轴上的新鲜划痕",
    desiredInformation: "最近是否有人使用这扇门",
    resolution: "check",
    ability: "int",
    skill: "investigation",
    dc: 12,
    mode: "normal",
    durationUnit: "minute",
    durationValue: 1,
    successConsequence: "确认门轴刚被使用。",
    failureConsequence: "无法判断划痕的新旧。",
  };
  const normalized = normalizeRoomKpProposal(privateEnvelope("observe.v1", draft));
  assert.ok(normalized);
  const firstInput = {
    ...normalized,
    rootActionId: "root:causal-v3:normal-form",
    actorCharacterId: ACTOR,
  };
  const pending = step(room.profiles, room.state, firstInput);
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  assert.equal(pending.randomnessRequests.length, 1);
  const completed = step(room.profiles, pending.state, {
    kind: "fulfillAuthoritativeRandomness",
    continuation: pending.continuation,
    rolls: [20],
  });
  assert.equal(completed.kind, "committed", JSON.stringify(completed));
  assert.equal(completed.mechanicalResult.formRef, "observe.v1");
  assert.equal(completed.mechanicalResult.nodes[0].branch, "success");
  assert.ok(Object.values(completed.state.knowledge[ACTOR])
    .some((entry) => entry.content === "确认门轴刚被使用。"));

  const duplicateRoot = step(room.profiles, completed.state, firstInput);
  assert.equal(duplicateRoot.kind, "rejected");

  const secondInput = {
    ...firstInput,
    rootActionId: "root:causal-v3:normal-form:repeat",
  };
  const secondPending = step(room.profiles, completed.state, secondInput);
  assert.equal(secondPending.kind, "awaitingRandomness", JSON.stringify(secondPending));
  const secondCompleted = step(room.profiles, secondPending.state, {
    kind: "fulfillAuthoritativeRandomness",
    continuation: secondPending.continuation,
    rolls: [20],
  });
  assert.equal(secondCompleted.kind, "committed", JSON.stringify(secondCompleted));
  assert.equal(Object.keys(secondCompleted.state.canonicalFacts)
    .filter((factRef) => factRef.startsWith("fact:v3-causal-program:")).length, 2);
  assert.equal(Object.values(secondCompleted.state.knowledge[ACTOR])
    .filter((entry) => entry.content === "确认门轴刚被使用。").length, 2);

  const rebuilt = replay(room.genesis, [
    ...pending.events,
    ...completed.events,
    ...secondPending.events,
    ...secondCompleted.events,
  ]);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.equal(rebuilt.head.stateHash, secondCompleted.stateHash);
});

test("causal continuations and events are isolated to the exact V3 profile", () => {
  const room = initialize(undefined, "profile-isolation");
  const pending = step(
    room.profiles,
    room.state,
    observationInput("root:causal-v3:profile-isolation"),
  );
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  const requestEvent = pending.events.find((event) => event.eventType === "RandomnessRequested");
  assert.ok(requestEvent);
  for (const legacyProfiles of [
    CURRENT_RUNTIME_PROFILE_MANIFEST,
    LEGACY_ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
  ]) {
    const legacyEvent = structuredClone(requestEvent);
    legacyEvent.profiles = structuredClone(legacyProfiles);
    legacyEvent.eventHash = eventHash(legacyEvent);
    const validation = validateEventEnvelope(legacyEvent);
    assert.equal(validation.ok, false);

    const legacyGenesis = structuredClone(room.genesis);
    legacyGenesis.profiles = structuredClone(legacyProfiles);
    legacyGenesis.initialState.runtimeManifestRef = structuredClone(legacyProfiles.manifest);
    legacyGenesis.initialState.internalContinuations = structuredClone(
      pending.state.internalContinuations,
    );
    legacyGenesis.initialStateHash = hashWorldState(legacyGenesis.initialState);
    legacyGenesis.initialState.eventHeadHash = legacyGenesis.initialStateHash;
    legacyGenesis.genesisHash = canonicalSha256(unsignedGenesis(legacyGenesis));
    const rebuilt = replay(legacyGenesis, []);
    assert.equal(rebuilt.kind, "rejected");
    assert.equal(rebuilt.rejection.code, "profileIntegrityMismatch");
  }
});

test("every causal root carries the exact V3 marker and fails closed under either legacy manifest", async (t) => {
  const legacyRooms = [
    [
      "current-v2",
      CURRENT_RUNTIME_PROFILE_MANIFEST,
      initialize(CURRENT_RUNTIME_PROFILE_MANIFEST, "profile-matrix-current-v2"),
    ],
    [
      "legacy-environment-v2",
      LEGACY_ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
      initialize(
        LEGACY_ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
        "profile-matrix-legacy-environment-v2",
      ),
    ],
  ];
  const cases = [
    {
      label: "ordinary-direct",
      formId: "observe.v1",
      actorCharacterId: ACTOR,
      expectedKind: "committed",
      basisRefs: [],
      draft: () => ({
        goal: "直接查看门轴",
        method: "观察表面磨损",
        focus: "门轴上的新鲜划痕",
        desiredInformation: "最近是否有人使用这扇门",
        resolution: "direct",
        durationUnit: "minute",
        durationValue: 1,
      }),
    },
    {
      label: "materialization",
      formId: "materialization.v1",
      actorCharacterId: ACTOR,
      expectedKind: "committed",
      basisRefs: [WORKSHOP_BASIS],
      draft: () => ({
        goal: "确认旧检修口",
        method: "沿墙检查旧灰缝",
        proposedFact: "侧墙存在一扇长期封闭的小型检修门。",
        basisRefs: [WORKSHOP_BASIS],
        resolution: "direct",
        durationUnit: "minute",
        durationValue: 1,
      }),
    },
    {
      label: "in-world-refusal",
      formId: "in-world-refusal.v1",
      actorCharacterId: ACTOR,
      expectedKind: "committed",
      basisRefs: [],
      draft: () => ({
        goal: "直接穿过石墙",
        method: "从没有开口的墙体中走过去",
        reason: "石墙没有可供通过的开口。",
        alternatives: ["寻找门"],
        durationUnit: "minute",
        durationValue: 1,
      }),
    },
    {
      label: "clarification",
      formId: "clarification.v1",
      actorCharacterId: ACTOR,
      expectedKind: "awaitingInput",
      basisRefs: [],
      draft: () => ({
        goal: "确认检查目标",
        question: "你先检查门轴，还是门锁？",
        choices: ["门轴", "门锁"],
      }),
    },
    {
      label: "combat",
      formId: "combat-action.v1",
      actorCharacterId: BOB,
      expectedKind: "awaitingInput",
      basisRefs: [],
      draft: (room) => {
        const abilityRef = room.state.combatRuntime.entities[BOB].abilityRefs.find((candidate) =>
          candidate.includes("guiding-bolt"));
        assert.ok(abilityRef);
        return {
          goal: "以引导箭逼退对手",
          method: "施放本人已经准备的法术",
          intendedOutcome: "迫使对方离开门口",
          combatApproach: "远程法术攻击",
          abilityRef,
        };
      },
    },
  ];

  for (const rootCase of cases) {
    await t.test(rootCase.label, () => {
      const room = initialize(undefined, `profile-matrix-${rootCase.label}`);
      const rootActionId = `root:causal-v3:profile-matrix:${rootCase.label}`;
      const normalized = normalizeRoomKpProposal(privateEnvelope(
        rootCase.formId,
        rootCase.draft(room),
      ));
      assert.ok(normalized);
      const input = {
        ...normalized,
        rootActionId,
        actorCharacterId: rootCase.actorCharacterId,
      };
      const outcome = step(room.profiles, room.state, input);
      assert.equal(outcome.kind, rootCase.expectedKind, JSON.stringify(outcome));
      const marker = assertExactCausalMarker({
        room,
        input,
        outcome,
        formId: rootCase.formId,
        actorCharacterId: rootCase.actorCharacterId,
        rootActionId,
        basisRefs: rootCase.basisRefs,
        label: rootCase.label,
      });
      const validation = validateEventEnvelope(marker);
      assert.equal(validation.ok, true, validation.message);
      const rebuilt = replay(room.genesis, outcome.events);
      assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
      assert.equal(rebuilt.head.stateHash, outcome.stateHash);

      for (const [legacyLabel, legacyProfiles, legacyRoom] of legacyRooms) {
        const rebound = structuredClone(marker);
        rebound.profiles = structuredClone(legacyProfiles);
        rebound.eventHash = eventHash(rebound);
        const reboundValidation = validateEventEnvelope(rebound);
        assert.equal(
          reboundValidation.ok,
          false,
          `${rootCase.label}/${legacyLabel} event validation must fail closed`,
        );
        assert.equal(
          reboundValidation.message,
          "Event requires the pinned V3 causal action interpreter Profile.",
        );
        const reboundReplay = replay(room.genesis, [rebound]);
        assert.equal(reboundReplay.kind, "rejected");
        assert.equal(reboundReplay.rejection.code, "invalidEventEnvelope");

        const injectedGenesis = injectCausalMarkerIntoGenesis(legacyRoom.genesis, marker);
        const injectedReplay = replay(injectedGenesis, []);
        assert.equal(injectedReplay.kind, "rejected");
        assert.equal(injectedReplay.rejection.code, "profileIntegrityMismatch");
      }
    });
  }
});

test("frozen causal plans revalidate executable semantics, duration, actor, and request", () => {
  const room = initialize(undefined, "frozen-binding");
  const rootActionId = "root:causal-v3:frozen-binding";
  const pending = step(room.profiles, room.state, observationInput(rootActionId));
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  const continuationId = pending.continuation.continuationId;
  const stored = pending.state.internalContinuations[continuationId];
  assert.ok(isCausalActionResolutionPlan(stored.resolutionPlan));

  const wrongDuration = structuredClone(stored.resolutionPlan);
  wrongDuration.durationMicros = "1";
  assert.equal(isCausalActionResolutionPlan(wrongDuration), false);

  const wrongRequestState = structuredClone(pending.state);
  wrongRequestState.internalContinuations[continuationId].request.frozenCheck.dc = "1";
  const requestProjection = project(
    room.profiles,
    wrongRequestState,
    { kind: "kp", capability: "internal:kp-spatial-evidence" },
  );
  assert.equal(requestProjection.kind, "rejected");
  assert.equal(requestProjection.rejection.code, "profileIntegrityMismatch");

  const wrongActorState = structuredClone(pending.state);
  const otherActorId = "character:causal-v3:other";
  wrongActorState.entities[otherActorId] = {
    ...structuredClone(wrongActorState.entities[ACTOR]),
    id: otherActorId,
    name: "另一名同场角色",
  };
  wrongActorState.internalContinuations[continuationId].resolutionPlan.actorCharacterId = otherActorId;
  const actorProjection = project(
    room.profiles,
    wrongActorState,
    { kind: "kp", capability: "internal:kp-spatial-evidence" },
  );
  assert.equal(actorProjection.kind, "rejected");
  assert.equal(actorProjection.rejection.code, "profileIntegrityMismatch");

  const requestIndex = pending.events.findIndex((event) => event.eventType === "RandomnessRequested");
  assert.ok(requestIndex >= 0);
  const beforeRequest = replay(room.genesis, pending.events.slice(0, requestIndex));
  assert.equal(beforeRequest.kind, "replayed", JSON.stringify(beforeRequest));
  const forgedEvent = structuredClone(pending.events[requestIndex]);
  forgedEvent.payload.request.frozenCheck.modifier = "99";
  forgedEvent.payload.continuation.capability = canonicalSha256({
    kind: "roomAuthorityRandomness",
    roomId: beforeRequest.state.roomId,
    runtimeEpochId: beforeRequest.state.runtimeEpochId,
    stateHash: hashWorldState(beforeRequest.state),
    rootActionId,
    request: forgedEvent.payload.request,
    resolutionPlan: forgedEvent.payload.resolutionPlan,
  });
  forgedEvent.payloadHash = canonicalSha256(forgedEvent.payload);
  forgedEvent.eventHash = eventHash(forgedEvent);
  const forgedReplay = replay(room.genesis, [
    ...pending.events.slice(0, requestIndex),
    forgedEvent,
  ]);
  assert.equal(forgedReplay.kind, "rejected");
  assert.equal(forgedReplay.rejection.code, "invalidEventEnvelope");
});

test("a recomputed check-to-direct program cannot bypass authoritative randomness", () => {
  const room = initialize(undefined, "direct-bypass");
  const input = observationInput("root:causal-v3:direct-bypass");
  const forged = structuredClone(input);
  forged.causalActionProgram.nodes[0].arguments.resolution = "direct";
  rehashProgram(forged.causalActionProgram);
  const outcome = step(room.profiles, room.state, forged);
  assert.equal(outcome.kind, "rejected");
  assert.equal(outcome.rejection.code, "invalidRulesInput");
});

test("Rules exhaustively rejects forged required scalars for every causal primitive", () => {
  const direct = { resolution: "direct", durationUnit: "minute", durationValue: 1 };
  const check = {
    resolution: "check",
    ability: "int",
    skill: "investigation",
    dc: 12,
    mode: "normal",
    durationUnit: "minute",
    durationValue: 1,
    successConsequence: "成功后果",
    failureConsequence: "失败后果",
  };
  const cases = [
    ["clarification.v1", { goal: "澄清目标", question: "选择哪一种？", choices: ["甲", "乙"] }, "question"],
    ["observe.v1", {
      goal: "观察", method: "仔细查看", focus: "门轴", desiredInformation: "是否刚被使用", ...direct,
    }, "focus"],
    ["npc-exchange.v1", {
      goal: "交涉", method: "说明来意", utterance: "请让我们通过", desiredResponse: "守卫放行",
      npcResponse: "守卫要求出示凭证", ...direct,
    }, "npcResponse"],
    ["ordinary-check.v1", {
      goal: "开锁", method: "使用工具", intendedOutcome: "锁被打开", risk: "工具可能折断", ...check,
    }, "intendedOutcome"],
    ["high-risk-action.v1", {
      goal: "跨越裂隙", method: "助跑跳跃", intendedOutcome: "抵达对面", risk: "可能坠落",
      stakes: "坠落会受伤", ...check,
    }, "stakes"],
    ["in-world-refusal.v1", {
      goal: "穿墙", method: "直接走过去", reason: "石墙没有开口", alternatives: ["寻找门"],
      durationUnit: "minute", durationValue: 1,
    }, "reason"],
    ["materialization.v1", {
      goal: "确认旧检修口", method: "检查旧灰缝", proposedFact: "侧墙存在封闭检修口",
      basisRefs: [WORKSHOP_BASIS], ...direct,
    }, "proposedFact"],
    ["combat-action.v1", {
      goal: "压制敌人", method: "施放法术", intendedOutcome: "迫使敌人后退",
      combatApproach: "spell", abilityRef: "ability:guiding-bolt",
    }, "abilityRef"],
    ["environmental-stunt.v1", {
      goal: "利用不存在的机关", method: "拉动机关", featureDescription: "墙上的机关",
      intendedOutcome: "门被打开", featureDisposition: "explicitly-absent",
    }, "featureDescription"],
  ];
  for (const [formId, draft, forgedKey] of cases) {
    const program = structuredClone(compileKpFormDraft(formId, draft));
    program.nodes[0].arguments[forgedKey] = 42;
    rehashProgram(program);
    assert.equal(
      validateExecutableCausalActionProgram(program),
      false,
      `${formId} must reject a forged ${forgedKey} scalar`,
    );
    assert.equal(isCausalActionResolutionPlan({
      schema: "zhuwei.causal-action-resolution-plan/v3",
      rootActionId: `root:forged:${formId}`,
      actorCharacterId: ACTOR,
      sourceSceneId: "scene:workshop",
      languageRef: program.languageRef,
      languageHash: program.languageHash,
      programHash: program.semanticHash,
      program,
      checkNodeRefs: [],
      durationMicros: "60000000",
      programFactRef: `fact:v3-causal-program:root:forged:${formId}:${program.semanticHash.slice("fnv1a64:".length)}`,
    }), false);
  }

  const compound = structuredClone(compileKpFormDraft("compound.v1", {
    goal: "分阶段行动",
    method: "依次执行",
    stages: [{ goal: "第一步", method: "操作", intendedOutcome: "完成第一步", resolution: "direct" }],
    intendedOutcome: "全部完成",
    resolution: "direct",
    durationUnit: "minute",
    durationValue: 1,
  }));
  compound.nodes[0].arguments.goal = false;
  rehashProgram(compound);
  assert.equal(validateExecutableCausalActionProgram(compound), false);
});

test("canonical animal and sleight skill ids apply the actor proficiency bonus", () => {
  for (const [skill, ability, expectedModifier] of [
    ["animal", "wis", "2"],
    ["sleight", "dex", "3"],
  ]) {
    const room = initialize(undefined, `skill-${skill}`);
    const pending = step(room.profiles, room.state, observationInput(
      `root:causal-v3:skill:${skill}`,
      { skill, ability },
    ));
    assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
    assert.equal(pending.randomnessRequest.frozenCheck.skill, skill);
    assert.equal(pending.randomnessRequest.frozenCheck.modifier, expectedModifier);
  }
});

test("only environment-v4 grants Expertise while environment-v3 replay remains one PB", () => {
  const historical = initialize(ENVIRONMENT_RUNTIME_PROFILE_MANIFEST, "expertise-v3");
  const historicalPending = step(
    historical.profiles,
    historical.state,
    observationInput("root:causal-v3:expertise-historical"),
  );
  assert.equal(historicalPending.kind, "awaitingRandomness", JSON.stringify(historicalPending));
  assert.equal(historicalPending.randomnessRequest.frozenCheck.modifier, "5");
  const historicalReplay = replay(historical.genesis, historicalPending.events);
  assert.equal(historicalReplay.kind, "replayed", JSON.stringify(historicalReplay));
  assert.equal(
    historicalReplay.state.internalContinuations[historicalPending.continuation.continuationId]
      .request.frozenCheck.modifier,
    "5",
  );

  const current = initialize(
    ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
    "expertise-v4",
    { expertiseSkills: ["investigation"], proficientSaves: ["str", "con"] },
  );
  const pending = step(
    current.profiles,
    current.state,
    observationInput("root:causal-v4:expertise"),
  );
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  assert.equal(pending.randomnessRequest.frozenCheck.modifier, "7");
  const rebuilt = replay(current.genesis, pending.events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.equal(
    rebuilt.state.internalContinuations[pending.continuation.continuationId]
      .request.frozenCheck.modifier,
    "7",
  );

  const rejected = initialize.bind(null, ENVIRONMENT_RUNTIME_PROFILE_MANIFEST, "expertise-v3-forged", {
    expertiseSkills: ["investigation"],
  });
  assert.throws(rejected, /initialized/);
});

test("checked materialization requires a real visible basis and commits a registered safe fact only on success", () => {
  const room = initialize(undefined, "checked-materialization");
  const draft = {
    goal: "确认侧墙是否有合理的旧检修口",
    method: "沿墙敲击并查看旧灰缝",
    proposedFact: "侧墙上存在一扇长期封闭的小型检修门。",
    basisRefs: [WORKSHOP_BASIS],
    resolution: "check",
    ability: "int",
    skill: "investigation",
    dc: 12,
    mode: "normal",
    durationUnit: "minute",
    durationValue: 1,
    successConsequence: "检修门的位置和旧铰链被确认。",
    failureConsequence: "现有痕迹不足以确认检修门。",
  };
  const normalized = normalizeRoomKpProposal(privateEnvelope("materialization.v1", draft));
  assert.ok(normalized);
  const forgedBasis = structuredClone(normalized);
  forgedBasis.causalActionProgram.nodes[0].arguments.basisRefs = ["fact:causal-v3:invented-basis"];
  rehashProgram(forgedBasis.causalActionProgram);
  forgedBasis.actionLanguageHash = forgedBasis.causalActionProgram.languageHash;
  const invented = step(room.profiles, room.state, {
    ...forgedBasis,
    rootActionId: "root:causal-v3:checked-materialization:invented-basis",
    actorCharacterId: ACTOR,
  });
  assert.equal(invented.kind, "rejected", JSON.stringify(invented));
  assert.equal(invented.rejection.code, "privateOrUnknownReference");

  const rootActionId = "root:causal-v3:checked-materialization:success";
  const pending = step(room.profiles, room.state, {
    ...normalized,
    rootActionId,
    actorCharacterId: ACTOR,
  });
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  const completed = step(room.profiles, pending.state, {
    kind: "fulfillAuthoritativeRandomness",
    continuation: pending.continuation,
    rolls: [20],
  });
  assert.equal(completed.kind, "committed", JSON.stringify(completed));
  const materialized = Object.values(completed.state.canonicalFacts).find((fact) =>
    fact.kind === "dynamicOpenFact" && fact.id.includes(rootActionId));
  assert.ok(materialized);
  assert.deepEqual(materialized.value, { description: draft.proposedFact });
  assert.deepEqual(materialized.subjectRefs, [ACTOR, "scene:workshop"].sort());
  const registered = completed.state.campaignRuntime.definitions[materialized.id];
  assert.equal(registered.definitionKind, "materializedOpenFact");
  assert.deepEqual(registered.causalBasisRefs, [WORKSHOP_BASIS]);
  assert.deepEqual(registered.definitionProfile, {
    profileId: "causal-action-interpreter-2014-v3",
    profileHash: room.profiles.extensions.find((profile) =>
      profile.profileId === "causal-action-interpreter-2014-v3").profileHash,
  });
  const privateProgramFact = Object.values(completed.state.canonicalFacts).find((fact) =>
    fact.kind === "causalActionProgram" && fact.id.includes(rootActionId));
  assert.ok(privateProgramFact);
  assert.deepEqual(privateProgramFact.value.basisRefs, [WORKSHOP_BASIS]);

  const bobViewer = {
    kind: "player",
    principalId: "principal:causal-v3:bob",
    sessionVersion: 1,
    seatId: "seat:causal-v3:bob",
    characterId: BOB,
  };
  const sameScene = project(room.profiles, completed.state, bobViewer);
  assert.equal(sameScene.kind, "projected", JSON.stringify(sameScene));
  assert.ok(JSON.stringify(sameScene).includes(draft.proposedFact));
  assert.equal(JSON.stringify(sameScene).includes("definitionKind"), false);
  assert.equal(JSON.stringify(sameScene).includes("materialization.v1"), false);

  const otherSceneState = structuredClone(completed.state);
  otherSceneState.entities[BOB].sceneId = "scene:annex";
  otherSceneState.combatRuntime.entities[BOB].sceneId = "scene:annex";
  const otherScene = project(room.profiles, otherSceneState, bobViewer);
  assert.equal(otherScene.kind, "projected", JSON.stringify(otherScene));
  assert.equal(JSON.stringify(otherScene).includes(draft.proposedFact), false);

  const failedRoot = "root:causal-v3:checked-materialization:failure";
  const failedPending = step(room.profiles, completed.state, {
    ...normalized,
    rootActionId: failedRoot,
    actorCharacterId: ACTOR,
  });
  assert.equal(failedPending.kind, "awaitingRandomness", JSON.stringify(failedPending));
  const failed = step(room.profiles, failedPending.state, {
    kind: "fulfillAuthoritativeRandomness",
    continuation: failedPending.continuation,
    rolls: [1],
  });
  assert.equal(failed.kind, "committed", JSON.stringify(failed));
  assert.equal(Object.values(failed.state.canonicalFacts).some((fact) =>
    fact.kind === "dynamicOpenFact" && fact.id.includes(failedRoot)), false);

  const rebuilt = replay(room.genesis, [...pending.events, ...completed.events]);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.equal(rebuilt.head.stateHash, completed.stateHash);
});

test("a V3 clarification answer continues through the causal interpreter under the same root", () => {
  const room = initialize(undefined, "clarification-continuation");
  const rootActionId = "root:causal-v3:clarification-continuation";
  const clarificationProposal = normalizeRoomKpProposal(privateEnvelope("clarification.v1", {
    goal: "确认玩家想检查门轴还是门锁",
    question: "你先检查门轴，还是门锁？",
    choices: ["门轴", "门锁"],
  }));
  assert.ok(clarificationProposal);
  const opened = step(room.profiles, room.state, {
    ...clarificationProposal,
    rootActionId,
    actorCharacterId: ACTOR,
  });
  assert.equal(opened.kind, "awaitingInput", JSON.stringify(opened));
  const normalizedNext = normalizeRoomKpProposal(privateEnvelope("observe.v1", {
    goal: "检查门轴",
    method: "观察磨损并试推",
    focus: "门轴上的新鲜划痕",
    desiredInformation: "最近是否有人使用这扇门",
    resolution: "direct",
    durationUnit: "minute",
    durationValue: 1,
  }));
  assert.ok(normalizedNext);
  const nextProposal = { ...normalizedNext, rootActionId, actorCharacterId: ACTOR };
  const completed = step(room.profiles, opened.state, {
    kind: "answerPendingInput",
    pendingInputId: opened.pending.pendingInputId,
    rootActionId,
    controllerCharacterId: ACTOR,
    answer: { text: "先检查门轴" },
    proposal: nextProposal,
  });
  assert.equal(completed.kind, "committed", JSON.stringify(completed));
  assert.ok(completed.events.some((event) => event.eventType === "PendingInputAnswered"));
  assert.ok(completed.events.some((event) => event.eventType === "ImprovisedActionResolved"));
  const rebuilt = replay(room.genesis, [...opened.events, ...completed.events]);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.equal(rebuilt.head.stateHash, completed.stateHash);
});

test("causal combat cannot invoke another character's installed ability", () => {
  const room = initialize(undefined, "combat-ability-ownership");
  const bobAbilityRef = room.state.combatRuntime.entities[BOB].abilityRefs.find((abilityRef) =>
    abilityRef.includes("guiding-bolt"));
  assert.ok(bobAbilityRef);
  const normalized = normalizeRoomKpProposal(privateEnvelope("combat-action.v1", {
    goal: "以引导箭逼退对手",
    method: "施放本人已经准备的法术",
    intendedOutcome: "迫使对方离开门口",
    combatApproach: "远程法术攻击",
    abilityRef: bobAbilityRef,
  }));
  assert.ok(normalized);
  const forged = step(room.profiles, room.state, {
    ...normalized,
    rootActionId: "root:causal-v3:combat-ability-ownership:forged",
    actorCharacterId: ACTOR,
  });
  assert.equal(forged.kind, "rejected");
  assert.equal(forged.rejection.code, "privateOrUnknownReference", JSON.stringify(forged));

  const owned = step(room.profiles, room.state, {
    ...normalized,
    rootActionId: "root:causal-v3:combat-ability-ownership:owned",
    actorCharacterId: BOB,
  });
  assert.equal(owned.kind, "awaitingInput", JSON.stringify(owned));
  assert.equal(owned.pending.kind, "playerChoice");
});

test("a concluded story rejects ordinary causal forms while lifecycle continuation stays explicit", () => {
  const room = initialize(undefined, "concluded-story-gate");
  const concluded = structuredClone(room.state);
  concluded.campaignRuntime.stories = {
    "story:causal-v3:complete": { storyId: "story:causal-v3:complete", status: "concluded" },
  };
  const outcome = step(
    room.profiles,
    concluded,
    observationInput("root:causal-v3:concluded-story"),
  );
  assert.equal(outcome.kind, "rejected");
  assert.equal(outcome.rejection.code, "missingPrerequisite");
});
