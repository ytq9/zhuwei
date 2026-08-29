import assert from "node:assert/strict";
import test from "node:test";

import { project, replay, step } from "../app/_runtime/lib/rules/index.ts";
import { ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests.ts";

const ALICE = {
  principalId: "principal:compound-rules:alice",
  seatId: "seat:compound-rules:alice",
  characterId: "character:compound-rules:alice",
};
const BOB = {
  principalId: "principal:compound-rules:bob",
  seatId: "seat:compound-rules:bob",
  characterId: "character:compound-rules:bob",
};
const WARDEN_ID = "npc:compound-rules:warden";
const WARDEN_KNOWLEDGE = "knowledge:compound-rules:warden-duty";
const HAZARD_REF = "hazard:compound-rules:loose-chandelier";
const EVIDENCE_REF = "evidence:compound-rules:chandelier-cut";
const ROOT_ACTION_ID = "root:compound-rules:inspect-chandelier";

function profileRef(profileId, digit) {
  return { profileId, profileHash: `sha256:${digit.repeat(64)}` };
}

function initialize(aliceOverrides = {}, advancementProfile, entityOverrides = {}, profiles) {
  const initialized = step(profiles, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:rules-compound-v2",
    runtimeEpochId: "epoch:rules-compound-v2:1",
    moduleRef: profileRef("module:rules-compound-v2", "a"),
    initialDefinitionCatalogRef: profileRef("definitions:rules-compound-v2", "b"),
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    ...(advancementProfile === undefined ? {} : { advancementProfile }),
    scenes: [
      { id: "scene:wake", name: "守灵厅" },
      { id: "scene:gallery", name: "回廊" },
    ],
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
        name: "阿莱莎",
        sceneId: "scene:wake",
        tenureStatus: "active",
        classId: "fighter",
        level: 1,
        hitPoints: { current: 8, maximum: 10 },
        abilityScores: { str: 10, dex: 14, con: 12, int: 14, wis: 12, cha: 10 },
        proficiencyBonus: 2,
        proficientSkills: ["investigation"],
        resources: { resolve: 2, surge: 1, arrow: 20 },
        loadout: {
          armorClass: 14,
          speedFeet: 30,
          equipped: { main: "longbow", ammo: "arrow" },
          backpack: [
            { itemId: "arrow", quantity: 20 },
            { itemId: "crowbar", quantity: 2 },
            { itemId: "torch", quantity: 2 },
          ],
        },
        characterBuild: {
          classId: "fighter",
          raceId: "human",
          cantrips: [],
          prepared: [],
        },
        ...aliceOverrides,
      },
      {
        id: BOB.characterId,
        kind: "player",
        name: "柏舟",
        sceneId: "scene:wake",
        tenureStatus: "active",
        abilityScores: { str: 14, dex: 12, con: 12, int: 10, wis: 14, cha: 10 },
        proficiencyBonus: 2,
        proficientSkills: ["athletics"],
        resources: { resolve: 1, slot1: 2 },
        characterBuild: {
          classId: "cleric",
          raceId: "human",
          cantrips: ["sacred-flame"],
          prepared: ["guiding-bolt"],
        },
        ...(entityOverrides.bob ?? {}),
      },
      {
        id: WARDEN_ID,
        kind: "npc",
        name: "守灵人",
        sceneId: "scene:wake",
        tenureStatus: "active",
        abilityScores: { str: 12, dex: 12, con: 12, int: 10, wis: 14, cha: 10 },
        proficiencyBonus: 2,
        ...(entityOverrides.warden ?? {}),
      },
    ],
    characterControls: [
      { characterId: ALICE.characterId, seatId: ALICE.seatId },
      { characterId: BOB.characterId, seatId: BOB.seatId },
    ],
    canonicalFacts: [{
      id: "fact:compound-rules:warden-duty",
      kind: "npcDuty",
      source: "moduleAnchor",
      subjectRefs: [WARDEN_ID],
      value: { duty: "照看守灵厅，不让访客破坏陈设" },
      visibilityPolicyId: "visibility:kp-internal",
    }],
    initialKnowledge: [{
      characterId: WARDEN_ID,
      knowledgeRef: WARDEN_KNOWLEDGE,
      kind: "canonicalFact",
      layer: "full",
      content: { duty: "照看守灵厅，不让访客破坏陈设" },
      visibility: "private",
      provenanceChain: ["fact:compound-rules:warden-duty"],
    }],
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

function validPlan(overrides = {}) {
  return {
    kind: "resolveCompoundActionPlan",
    actionPlanVersion: "authoritative-kp-action-plan-v1",
    feasibilityKind: "checkRequired",
    rootActionId: ROOT_ACTION_ID,
    actorCharacterId: ALICE.characterId,
    goal: "在不惊动守灵人的情况下确认吊灯绳是否被人割过",
    method: "借烛台阴影观察绳结并用镜片检查切口",
    risk: {
      warning: "靠近悬挂点可能让已经松动的吊灯摇晃。",
      successConsequences: ["确认绳索切口的方向"],
      failureConsequences: ["吊灯发出声响并让守灵人警觉"],
      retryGate: ["methodChanged", "situationAdvanced"],
    },
    dynamicMaterializations: [{
      kind: "hazard",
      factRef: HAZARD_REF,
      causalBasisRefs: [],
      visibilityPolicyRef: "visibility:public",
      definition: {
        name: "松动的吊灯",
        warningEvidence: "吊链偶尔发出轻微摩擦声",
        trigger: "施力或失败时摇晃",
      },
    }],
    npcActions: [{
      npcId: WARDEN_ID,
      goal: "依照自己已知的职责留意大厅异常",
      method: "继续原有巡视，不预知玩家未暴露的打算",
      knowledgeRefs: [WARDEN_KNOWLEDGE],
      mechanicalProposal: null,
    }],
    scene: {
      question: "阿莱莎能否在不引起注意的情况下确认吊灯绳的切口？",
      pressure: "守灵人仍在大厅来回照看烛台。",
      opportunities: ["换一个角度观察", "请同伴制造合理的遮掩"],
      conclusionCandidate: null,
    },
    mechanicalProposal: {
      operation: "resolveNoncombatCheck",
      ability: "int",
      skill: "investigation",
      dc: 13,
      mode: "normal",
      duration: { unit: "minute", value: 10 },
      frozenCosts: [],
      success: [
        {
          kind: "acquireEvidence",
          evidenceRef: EVIDENCE_REF,
          evidence: "绳股切口朝向一致，明显不是自然磨损。",
          definitionRef: HAZARD_REF,
        },
        {
          kind: "changeResource",
          targetRef: ALICE.characterId,
          resourceRef: "resolve",
          amount: -1,
        },
        {
          kind: "alertNpc",
          npcId: WARDEN_ID,
          status: "suspicious",
        },
        {
          kind: "moveEntity",
          entityRef: ALICE.characterId,
          sceneRef: "scene:gallery",
        },
      ],
      failure: [{ kind: "alertNpc", npcId: WARDEN_ID, status: "alerted" }],
    },
    ...overrides,
  };
}

test("HiddenReality candidates are validated as one frozen set before any random draw", () => {
  const scenario = initialize();
  const plan = validPlan({
    dynamicMaterializations: [],
    mechanicalProposal: {
      operation: "resolveNoncombatCheck",
      ability: "int",
      skill: "investigation",
      dc: 13,
      mode: "normal",
      duration: { unit: "minute", value: 10 },
      frozenCosts: [],
      success: [],
      failure: [],
    },
    hiddenRealityCandidateSet: {
      candidateSetId: "hidden:behind-door:1",
      candidates: [
        {
          candidateId: "candidate:empty-shrine",
          hiddenWeight: 2,
          kind: "fact",
          factRef: "fact:hidden:empty-shrine",
          causalBasisRefs: [],
          visibilityPolicyRef: "visibility:scene-observers",
          definition: { name: "废弃神龛", description: "门后只有积尘的神龛。" },
        },
        {
          candidateId: "candidate:watcher",
          hiddenWeight: 1,
          kind: "fact",
          factRef: "fact:hidden:watcher",
          causalBasisRefs: [],
          visibilityPolicyRef: "visibility:scene-observers",
          definition: { name: "沉默守望者", disposition: "wary" },
        },
      ],
    },
  });
  const frozen = step(scenario.profiles, scenario.state, plan);
  assert.equal(frozen.kind, "awaitingRandomness", JSON.stringify(frozen));
  assert.equal(frozen.randomnessRequest.purpose, "hiddenRealitySelection");
  assert.equal(frozen.randomnessRequest.diceExpression, "1d3");
  assert.deepEqual(frozen.events.map((event) => event.eventType), ["RandomnessRequested"]);
  const materialized = step(scenario.profiles, frozen.state, {
    kind: "fulfillAuthoritativeRandomness",
    continuation: frozen.continuation,
    rolls: [3],
  });
  assert.notEqual(materialized.kind, "rejected", JSON.stringify(materialized));
  assert.deepEqual(materialized.events.slice(0, 3).map((event) => event.eventType), [
    "DiceRolled", "HiddenRealityCandidatesFrozen", "HiddenRealityMaterialized",
  ]);
  const hiddenReplay = replay(scenario.genesis, [...frozen.events, ...materialized.events]);
  assert.equal(hiddenReplay.kind, "replayed", JSON.stringify(hiddenReplay));
  const playerProjection = project(scenario.profiles, hiddenReplay.state, aliceViewer());
  assert.equal(JSON.stringify(playerProjection).includes("fact:hidden:empty-shrine"), false);
  assert.equal(JSON.stringify(playerProjection).includes("fact:hidden:watcher"), true);

  const invalid = step(scenario.profiles, scenario.state, {
    ...plan,
    rootActionId: `${ROOT_ACTION_ID}:invalid-hidden`,
    hiddenRealityCandidateSet: {
      ...plan.hiddenRealityCandidateSet,
      candidates: [
        plan.hiddenRealityCandidateSet.candidates[0],
        { ...plan.hiddenRealityCandidateSet.candidates[1], hiddenWeight: 0 },
      ],
    },
  });
  assert.equal(invalid.kind, "rejected");
  assert.deepEqual(invalid.events, []);
});

function semanticPlan(rootActionId, mechanicalProposal, overrides = {}) {
  const factRef = mechanicalProposal.operation === "changeKnowledge"
    ? mechanicalProposal.knowledgeRef
    : `fact:semantic:${rootActionId.replace(/[^a-zA-Z0-9:-]/g, "-")}`;
  return validPlan({
    rootActionId,
    feasibilityKind: [
      "resolveNoncombatContest",
      "resolveNoncombatSave",
      "startCombat",
      "invokeCombatAction",
      "resolveReaction",
    ].includes(mechanicalProposal.operation) ? "checkRequired" : "directSuccess",
    goal: `执行 ${mechanicalProposal.operation}`,
    method: `按已声明方式执行 ${mechanicalProposal.operation}`,
    dynamicMaterializations: [{
      kind: "fact",
      factRef,
      causalBasisRefs: [],
      visibilityPolicyRef: "visibility:scene-observers",
      definition: { name: `行动依据 ${mechanicalProposal.operation}` },
    }],
    npcActions: [],
    mechanicalProposal,
    ...overrides,
  });
}

function appendAndReplay(scenario, result) {
  assert.notEqual(result.kind, "rejected", JSON.stringify(result));
  const events = [...scenario.events, ...result.events];
  const replayed = replay(scenario.genesis, events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return { ...scenario, events, state: replayed.state };
}

function aliceViewer() {
  return {
    kind: "player",
    principalId: ALICE.principalId,
    sessionVersion: 1,
    seatId: ALICE.seatId,
    characterId: ALICE.characterId,
  };
}

function bobViewer() {
  return {
    kind: "player",
    principalId: BOB.principalId,
    sessionVersion: 1,
    seatId: BOB.seatId,
    characterId: BOB.characterId,
  };
}

test("a static character card compiles once into versioned player-owned AbilityDefinitions", () => {
  const scenario = initialize();
  const alice = project(scenario.profiles, scenario.state, aliceViewer());
  const bob = project(scenario.profiles, scenario.state, bobViewer());
  assert.equal(alice.kind, "projected", JSON.stringify(alice));
  assert.equal(bob.kind, "projected", JSON.stringify(bob));
  assert.equal(alice.campaign.advancementProfile, "milestone");

  const aliceDefinitions = Object.values(alice.controlledCharacter.combat.definitions);
  assert.deepEqual(aliceDefinitions.map(({ mechanicalKey }) => mechanicalKey).sort(), [
    "action-surge",
    "improvised-strike",
    "weapon:longbow",
  ]);
  assert.ok(alice.controlledCharacter.combat.abilityRefs.every((abilityRef) =>
    abilityRef.startsWith(`ability:${ALICE.characterId}:`)));
  assert.equal(aliceDefinitions.find(({ mechanicalKey }) => mechanicalKey === "weapon:longbow").rulesBasis,
    "srd5.1-2014");
  const bobDefinitions = Object.values(bob.controlledCharacter.combat.definitions);
  assert.deepEqual(bobDefinitions.map(({ mechanicalKey }) => mechanicalKey).sort(), [
    "improvised-strike",
    "spell:guiding-bolt",
    "spell:sacred-flame",
  ]);
  assert.ok(bob.controlledCharacter.combat.abilityRefs.every((abilityRef) =>
    abilityRef.startsWith(`ability:${BOB.characterId}:`)));
  assert.equal(bob.controlledCharacter.combat.spellcasting.spellSaveDc, "12");
  assert.equal(bob.controlledCharacter.combat.resources["spellSlot:1"].current, "2");
});

test("direct ActionPlan consequences commit typed knowledge, relationship, debt, promise, and time events in one root", () => {
  const scenario = initialize();
  const rootActionId = "root:semantic:direct-world-consequences";
  const factRef = "fact:semantic:warden-confession";
  const outcome = step(scenario.profiles, scenario.state, semanticPlan(
    rootActionId,
    {
      operation: "resolveDirectConsequences",
      duration: { unit: "minute", value: 1 },
      frozenCosts: [],
      success: [
        {
          kind: "acquireKnowledge",
          knowledgeRef: "knowledge:semantic:warden-confession",
          value: "守灵人承认昨夜听见吊链断裂声。",
          definitionRef: factRef,
        },
        {
          kind: "updateRelationship",
          relationshipRef: "relationship:semantic:alice-warden",
          recipientRefs: [WARDEN_ID],
          value: "守灵人愿意相信阿莱莎会谨慎调查。",
          definitionRef: factRef,
        },
        {
          kind: "recordCommitment",
          commitmentRef: "promise:semantic:protect-warden",
          targetRef: WARDEN_ID,
          value: "在调查期间保护守灵人。",
          status: "直到吊灯危险解除",
        },
        {
          kind: "recordDebt",
          debtRef: "debt:semantic:repair-warden-door",
          targetRef: WARDEN_ID,
          value: "修复调查期间损坏的守灵人房门。",
          status: "下一次月圆前",
          definitionRef: factRef,
        },
      ],
      failure: [],
    },
    {
      dynamicMaterializations: [{
        kind: "fact",
        factRef,
        causalBasisRefs: [],
        visibilityPolicyRef: "visibility:scene-observers",
        definition: { name: "守灵人的现场陈述" },
      }],
    },
  ));
  assert.equal(outcome.kind, "committed", JSON.stringify(outcome));
  assert.deepEqual(outcome.events.map(({ eventType }) => eventType), [
    "DefinitionRegistered",
    "CanonicalFactDeclared",
    "SceneQuestionOpened",
    "FeasibilityRuled",
    "KnowledgeAcquired",
    "RelationshipChanged",
    "PromiseMade",
    "DebtIncurred",
    "FictionTimeAdvanced",
  ]);
  assert.ok(outcome.events.every((event) => event.rootActionId === rootActionId));
  const replayed = appendAndReplay(scenario, outcome);
  assert.equal(
    replayed.state.knowledge[ALICE.characterId]["knowledge:semantic:warden-confession"].content,
    "守灵人承认昨夜听见吊链断裂声。",
  );
  assert.equal(
    replayed.state.campaignRuntime.relationships["relationship:semantic:alice-warden"].value,
    "守灵人愿意相信阿莱莎会谨慎调查。",
  );
  assert.equal(
    replayed.state.campaignRuntime.promises["promise:semantic:protect-warden"].promiseeId,
    WARDEN_ID,
  );
  assert.equal(
    replayed.state.campaignRuntime.debts["debt:semantic:repair-warden-door"].debtorId,
    ALICE.characterId,
  );
});

test("direct ActionPlan may commit only fictional time without inventing a generic world fact outcome", () => {
  const scenario = initialize();
  const rootActionId = "root:semantic:wait-without-extra-effect";
  const outcome = step(scenario.profiles, scenario.state, semanticPlan(
    rootActionId,
    {
      operation: "resolveDirectConsequences",
      duration: { unit: "minute", value: 10 },
      frozenCosts: [],
      success: [],
      failure: [],
    },
    {
      risk: null,
      scene: {
        question: "等待会让虚构时间怎样推进？",
        pressure: "",
        opportunities: [],
        conclusionCandidate: null,
      },
    },
  ));
  assert.equal(outcome.kind, "committed", JSON.stringify(outcome));
  assert.deepEqual(outcome.events.map(({ eventType }) => eventType), [
    "DefinitionRegistered",
    "CanonicalFactDeclared",
    "SceneQuestionOpened",
    "FeasibilityRuled",
    "FictionTimeAdvanced",
  ]);
  const replayed = appendAndReplay(scenario, outcome);
  assert.equal(
    replayed.state.fictionTimelines[replayed.state.activeBranchId].nowMicros,
    "600000000",
  );
});

test("missing prerequisite and world-law violation reject through typed ActionPlans without events", () => {
  const scenario = initialize();
  for (const [feasibilityKind, code] of [
    ["missingPrerequisite", "missingPrerequisite"],
    ["worldLawViolation", "worldLawViolation"],
  ]) {
    const outcome = step(scenario.profiles, scenario.state, semanticPlan(
      `root:semantic:${feasibilityKind}`,
      { operation: "rejectInfeasibleAction" },
      {
        feasibilityKind,
        risk: {
          warning: feasibilityKind === "missingPrerequisite"
            ? "必须先取得锁匠工具。"
            : "凡人不能徒手穿过完整石墙。",
          successConsequences: [],
          failureConsequences: [],
          retryGate: feasibilityKind === "missingPrerequisite" ? ["factsChanged"] : [],
        },
      },
    ));
    assert.equal(outcome.kind, "rejected", JSON.stringify(outcome));
    assert.equal(outcome.rejection.code, code);
    assert.deepEqual(outcome.events ?? [], []);
  }
});

test("feasibility categories cannot contradict the frozen mechanical operation", () => {
  const scenario = initialize();
  const directCheck = validPlan({
    feasibilityKind: "directSuccess",
    risk: null,
  });
  const uncertainDirectConsequences = semanticPlan(
    "root:semantic:uncertain-direct-consequences",
    {
      operation: "resolveDirectConsequences",
      duration: { unit: "minute", value: 1 },
      frozenCosts: [],
      success: [],
      failure: [],
    },
    {
      feasibilityKind: "checkRequired",
      risk: {
        warning: "结果存在真实不确定性。",
        successConsequences: ["成功"],
        failureConsequences: ["失败"],
        retryGate: ["methodChanged"],
      },
    },
  );

  for (const plan of [directCheck, uncertainDirectConsequences]) {
    const outcome = step(scenario.profiles, scenario.state, plan);
    assert.equal(outcome.kind, "rejected", JSON.stringify(outcome));
    assert.equal(outcome.rejection.code, "invalidRulesInput");
    assert.deepEqual(outcome.events, []);
  }
});

test("campaign lifecycle ActionPlans raise a real ending, conclude it, and record a player epilogue", () => {
  let scenario = initialize();
  const basisFactRef = "fact:semantic:ending-basis";
  const endingCandidateRef = "ending:semantic:warden-safe";
  const storyRef = "story:semantic:warden-safe";
  const raised = step(scenario.profiles, scenario.state, semanticPlan(
    "root:semantic:raise-ending",
    {
      operation: "advanceCampaignLifecycle",
      lifecycleAction: "raiseEndingCandidate",
      endingCandidateRef,
      basisRefs: [basisFactRef],
      unresolvedRefs: ["threat:semantic:unknown-cutter"],
    },
    {
      dynamicMaterializations: [{
        kind: "fact",
        factRef: basisFactRef,
        causalBasisRefs: [],
        visibilityPolicyRef: "visibility:public",
        definition: { name: "吊灯危险已经解除，守灵人安全" },
      }],
    },
  ));
  assert.equal(raised.kind, "committed", JSON.stringify(raised));
  assert.ok(raised.events.some(({ eventType }) => eventType === "EndingCandidateRaised"));
  scenario = appendAndReplay(scenario, raised);

  const concluded = step(scenario.profiles, scenario.state, semanticPlan(
    "root:semantic:conclude-story",
    {
      operation: "advanceCampaignLifecycle",
      lifecycleAction: "concludeStory",
      endingCandidateRef,
      storyRef,
      outcome: "守灵厅的核心危险已经真实解除。",
      consequenceRefs: ["守灵人恢复夜间巡查", "未知割绳者仍是续篇威胁"],
    },
  ));
  assert.equal(concluded.kind, "concluded", JSON.stringify(concluded));
  assert.ok(concluded.events.some(({ eventType }) => eventType === "StoryConcluded"));
  scenario = appendAndReplay(scenario, concluded);

  const epilogue = step(scenario.profiles, scenario.state, semanticPlan(
    "root:semantic:record-epilogue",
    {
      operation: "advanceCampaignLifecycle",
      lifecycleAction: "recordEpilogueChoice",
      storyRef,
      choice: "阿莱莎留下修好吊灯，再把线索交给守夜人。",
    },
  ));
  assert.equal(epilogue.kind, "committed", JSON.stringify(epilogue));
  assert.ok(epilogue.events.some(({ eventType }) => eventType === "EpilogueChoiceRecorded"));
  scenario = appendAndReplay(scenario, epilogue);
  assert.equal(scenario.state.campaignRuntime.stories[storyRef].endingCandidateId, endingCandidateRef);
  assert.equal(
    scenario.state.campaignRuntime.epilogues[`${storyRef}:${ALICE.characterId}`].storyId,
    storyRef,
  );
});

test("campaign lifecycle ActionPlan awards bounded SRD XP and opens the player's advancement choice", () => {
  const scenario = initialize({ experiencePoints: 0 }, "srdXp2014");
  const outcome = step(scenario.profiles, scenario.state, semanticPlan(
    "root:semantic:award-xp",
    {
      operation: "advanceCampaignLifecycle",
      lifecycleAction: "awardExperience",
      experienceAmount: 300,
    },
  ));
  assert.equal(outcome.kind, "awaitingInput", JSON.stringify(outcome));
  assert.deepEqual(
    outcome.events.find(({ eventType }) => eventType === "ExperienceAwarded")?.payload,
    {
      amount: 300,
      campaignId: "campaign:room:rules-compound-v2",
      characterId: ALICE.characterId,
      sourceFactIds: ["fact:semantic:root:semantic:award-xp"],
      total: 300,
    },
  );
  const replayed = appendAndReplay(scenario, outcome);
  const projected = project(replayed.profiles, replayed.state, aliceViewer());
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  assert.equal(projected.controlledCharacter.experiencePoints, 300);
  assert.equal(projected.campaign.advancementProfile, "srdXp2014");
  assert.equal(projected.pendingInputs[0].kind, "advancementChoice");
});

test("campaign lifecycle ActionPlan transitions chapters in one continuity transaction", () => {
  const scenario = initialize();
  const outcome = step(scenario.profiles, scenario.state, semanticPlan(
    "root:semantic:transition-chapter",
    {
      operation: "advanceCampaignLifecycle",
      lifecycleAction: "transitionChapter",
      chapterRef: "chapter:second",
      activityTransitions: [],
    },
  ));
  assert.equal(outcome.kind, "committed", JSON.stringify(outcome));
  assert.deepEqual(
    outcome.events
      .filter(({ eventType }) => eventType.startsWith("Chapter"))
      .map(({ eventType }) => eventType),
    ["ChapterConcluded", "ChapterContinuityRecorded", "ChapterStarted"],
  );
  assert.ok(outcome.events.every(({ rootActionId }) =>
    rootActionId === "root:semantic:transition-chapter"));
  const replayed = appendAndReplay(scenario, outcome);
  assert.equal(replayed.state.campaignRuntime.campaign.currentChapterId, "chapter:second");
  assert.equal(
    replayed.state.campaignRuntime.chapters["chapter:opening"].continuityManifestHash,
    outcome.events.find(({ eventType }) => eventType === "ChapterContinuityRecorded")
      .payload.manifest.manifestHash,
  );
});

test("meaningful failure and unchanged retry use typed ActionPlans without a second adjudication path", () => {
  let scenario = initialize();
  const precedentRef = "precedent:semantic:broken-gallery-stairs";
  const causeFactRef = "fact:semantic:gallery-stairs-collapsed";
  const method = "沿已经坍塌的楼梯原路冲上画廊";
  const failed = step(scenario.profiles, scenario.state, semanticPlan(
    "root:semantic:meaningful-failure",
    {
      operation: "commitMeaningfulFailure",
      precedentRef,
      duration: { unit: "minute", value: 2 },
      basisRefs: [causeFactRef],
      consequenceRefs: ["route:gallery-stairs"],
      newOptions: [
        { id: "rope", summary: "用绳索从侧廊攀上去" },
        { id: "service", summary: "寻找仆役通道" },
      ],
    },
    {
      method,
      dynamicMaterializations: [{
        kind: "fact",
        factRef: causeFactRef,
        causalBasisRefs: [],
        visibilityPolicyRef: "visibility:scene-observers",
        definition: { name: "画廊楼梯已经坍塌" },
      }],
    },
  ));
  assert.equal(failed.kind, "committed", JSON.stringify(failed));
  assert.ok(failed.events.some(({ eventType }) => eventType === "MeaningfulFailureCommitted"));
  scenario = appendAndReplay(scenario, failed);
  assert.deepEqual(
    scenario.state.campaignRuntime.meaningfulFailures[precedentRef].consequences.newOptions,
    [
      { optionId: "rope", summary: "用绳索从侧廊攀上去" },
      { optionId: "service", summary: "寻找仆役通道" },
    ],
  );

  const beforeHash = JSON.stringify(scenario.state);
  const retried = step(scenario.profiles, scenario.state, semanticPlan(
    "root:semantic:unchanged-retry",
    { operation: "retryFailedAction", precedentRef },
    {
      feasibilityKind: "checkRequired",
      method,
      risk: {
        warning: "原路重试仍有同一真实风险。",
        successConsequences: ["越过坍塌楼梯"],
        failureConsequences: ["再次受阻"],
        retryGate: ["methodChanged"],
      },
    },
  ));
  assert.equal(retried.kind, "rejected", JSON.stringify(retried));
  assert.equal(retried.rejection.code, "unchangedRetry");
  assert.equal(JSON.stringify(scenario.state), beforeHash);

  const retryFactRef = "fact:semantic:gallery-side-corridor-open";
  const changedMethod = "改走侧廊，用镜片检查仆役门锁的磨损再安静开门";
  const changed = step(scenario.profiles, scenario.state, semanticPlan(
    "root:semantic:changed-retry",
    {
      operation: "retryFailedAction",
      precedentRef,
      ability: "int",
      skill: "investigation",
      dc: 17,
      mode: "advantage",
      duration: { unit: "minute", value: 5 },
      frozenCosts: [],
      success: [{
        kind: "acquireEvidence",
        evidenceRef: "evidence:semantic:servant-lock",
        evidence: "仆役门锁最近从内侧反复使用过。",
        definitionRef: retryFactRef,
      }],
      failure: [{ kind: "alertNpc", npcId: WARDEN_ID, status: "suspicious" }],
    },
    {
      feasibilityKind: "checkRequired",
      method: changedMethod,
      risk: {
        warning: "侧廊可行，但门锁检查可能惊动守灵人。",
        successConsequences: ["确认仆役门的使用痕迹"],
        failureConsequences: ["守灵人察觉门边动静"],
        retryGate: ["methodChanged"],
      },
      dynamicMaterializations: [{
        kind: "fact",
        factRef: retryFactRef,
        causalBasisRefs: [causeFactRef],
        visibilityPolicyRef: "visibility:scene-observers",
        definition: { name: "侧廊仆役门仍可接近" },
      }],
    },
  ));
  assert.equal(changed.kind, "awaitingRandomness", JSON.stringify(changed));
  assert.equal(changed.randomnessRequest.frozenCheck.kind, "skill");
  assert.equal(changed.randomnessRequest.frozenCheck.ability, "intelligence");
  assert.equal(changed.randomnessRequest.frozenCheck.skill, "investigation");
  assert.equal(changed.randomnessRequest.frozenCheck.dc, "17");
  assert.equal(changed.randomnessRequest.frozenCheck.mode, "advantage");
  assert.ok(changed.events.some(({ eventType }) => eventType === "RetryConditionChanged"));
  scenario = appendAndReplay(scenario, changed);
  assert.equal(scenario.state.campaignRuntime.retryChanges[precedentRef].change, "methodChanged");

  const resolvedRetry = step(scenario.profiles, scenario.state, {
    kind: "fulfillAuthoritativeRandomness",
    continuation: changed.continuation,
    rolls: [16, 4],
  });
  assert.equal(resolvedRetry.kind, "committed", JSON.stringify(resolvedRetry));
  scenario = appendAndReplay(scenario, resolvedRetry);
  assert.equal(
    scenario.state.knowledge[ALICE.characterId]["evidence:semantic:servant-lock"].content,
    "仆役门锁最近从内侧反复使用过。",
  );
});

test("one versioned ActionPlan freezes and commits dynamic world, NPC, scene, dice, mechanics, and typed consequences", () => {
  let scenario = initialize();
  const requested = step(scenario.profiles, scenario.state, validPlan());
  assert.equal(requested.kind, "awaitingRandomness", JSON.stringify(requested));
  assert.deepEqual(requested.events.map(({ eventType }) => eventType), [
    "DefinitionRegistered",
    "CanonicalFactDeclared",
    "NpcPlanFormed",
    "SceneQuestionOpened",
    "FeasibilityRuled",
    "CheckFrozen",
    "RandomnessRequested",
  ]);
  assert.equal(requested.randomnessRequests.length, 1);
  assert.equal(requested.continuations.length, 1);
  assert.ok(!JSON.stringify(requested.events).includes('"faces"'));
  assert.ok(!JSON.stringify(requested.events).includes('"face"'));
  for (const event of requested.events) {
    assert.equal(event.rootActionId, ROOT_ACTION_ID);
    assert.equal(event.branchId, "branch:main");
    assert.equal(event.fictionTimelineId, "branch:main");
    assert.deepEqual(event.profiles, scenario.profiles);
  }
  scenario = appendAndReplay(scenario, requested);

  const beforeFaces = project(scenario.profiles, scenario.state, aliceViewer(), { channel: "reconnect" });
  assert.equal(beforeFaces.kind, "projected", JSON.stringify(beforeFaces));
  assert.ok(!JSON.stringify(beforeFaces).includes("selectedFace"));
  assert.ok(!JSON.stringify(beforeFaces).includes('"faces"'));

  const resolved = step(scenario.profiles, scenario.state, {
    kind: "fulfillAuthoritativeRandomness",
    continuation: requested.continuation,
    rolls: [15],
  });
  assert.equal(resolved.kind, "committed", JSON.stringify(resolved));
  assert.deepEqual(resolved.events.map(({ eventType }) => eventType), [
    "DiceRolled",
    "ImprovisedCheckResolved",
    "KnowledgeAcquired",
    "ResourceUsed",
    "KnowledgeAcquired",
    "NpcPlanFormed",
    "CharacterMoved",
  ]);
  const rolled = resolved.events.find(({ eventType }) => eventType === "DiceRolled");
  assert.deepEqual(rolled.payload.faces, [15]);
  assert.equal(rolled.payload.selectedFace, 15);
  assert.equal(rolled.payload.randomnessId, requested.randomnessRequest.randomnessId);
  assert.equal(rolled.payload.resolutionId, requested.randomnessRequest.resolutionId);
  assert.match(rolled.payload.requestHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(rolled.payload.frozenParametersHash, /^sha256:[0-9a-f]{64}$/);
  assert.ok(resolved.events.every(({ rootActionId }) => rootActionId === ROOT_ACTION_ID));
  assert.ok(resolved.events.every(({ branchId }) => branchId === "branch:main"));
  assert.ok(resolved.events.every(({ fictionTimelineId }) => fictionTimelineId === "branch:main"));
  assert.equal(resolved.receipt.rootActionId, ROOT_ACTION_ID);
  assert.equal(resolved.receipt.status, "committed");

  scenario = appendAndReplay(scenario, resolved);
  assert.equal(scenario.state.entities[ALICE.characterId].sceneId, "scene:gallery");
  assert.equal(scenario.state.entities[ALICE.characterId].resources.resolve, 1);
  assert.equal(scenario.state.knowledge[ALICE.characterId][EVIDENCE_REF].visibility, "private");
  assert.equal(scenario.state.knowledge[WARDEN_ID][`knowledge:alert:${ROOT_ACTION_ID}`].visibility, "private");
  assert.equal(
    scenario.state.campaignRuntime.npcPlans[`npc-plan:alert:${ROOT_ACTION_ID}:${WARDEN_ID}`].nextAction,
    "suspicious",
  );

  const aliceRead = project(scenario.profiles, scenario.state, aliceViewer(), { channel: "history" });
  assert.equal(aliceRead.kind, "projected", JSON.stringify(aliceRead));
  assert.equal(aliceRead.controlledCharacter.sceneId, "scene:gallery");
  assert.equal(aliceRead.controlledCharacter.resources.resolve, 1);
  assert.ok(aliceRead.knowledge.some(({ knowledgeRef }) => knowledgeRef === EVIDENCE_REF));
  assert.ok(!JSON.stringify(aliceRead).includes('"faces"'));
  assert.ok(!JSON.stringify(aliceRead).includes("selectedFace"));

  const npcRead = project(scenario.profiles, scenario.state, {
    kind: "npc",
    npcId: WARDEN_ID,
    purpose: "kpDecision",
    capability: "internal:npc-limited-knowledge",
  });
  assert.equal(npcRead.kind, "projected", JSON.stringify(npcRead));
  assert.ok(npcRead.knowledge.some(({ knowledgeRef }) => knowledgeRef === `knowledge:alert:${ROOT_ACTION_ID}`));

  const targetReceiptId = scenario.state.receipts[ROOT_ACTION_ID].receiptId;
  const correction = step(scenario.profiles, scenario.state, {
    kind: "applyServiceCorrection",
    correctionAuthority: {
      kind: "roomCorrectionAuthority",
      capability: scenario.state.correctionRuntime.authorityCapability,
    },
    correctionId: "correction:compound-rules:consequential",
    targetReceiptId,
    actorCharacterId: ALICE.characterId,
    errorKind: "rulesMisapplication",
    publicExplanation: "检定参数有误，后果必须从正确因果点重建。",
    basis: {
      stateHash: replay(scenario.genesis, scenario.events).head.stateHash,
      eventHash: replay(scenario.genesis, scenario.events).head.eventHash,
    },
  });
  assert.equal(correction.kind, "committed", JSON.stringify(correction));
  assert.equal(correction.strategy, "causalBranch");
  assert.deepEqual(correction.events.map(({ eventType }) => eventType), [
    "CorrectionBranchOpened",
    "BranchActivated",
  ]);
});

test("a noncombat save freezes its item cost and fighter saving-throw proficiency before authoritative dice", () => {
  let scenario = initialize();
  const rootActionId = "root:compound-rules:falling-chandelier-save";
  const requested = step(scenario.profiles, scenario.state, semanticPlan(
    rootActionId,
    {
      operation: "resolveNoncombatSave",
      saveAbility: "con",
      dc: 14,
      mode: "advantage",
      duration: { unit: "minute", value: 1 },
      frozenCosts: [{ kind: "consumeArtifact", artifactRef: "item:crowbar", count: 1 }],
      success: [{
        kind: "moveEntity",
        entityRef: ALICE.characterId,
        sceneRef: "scene:gallery",
      }],
      failure: [
        {
          kind: "changeHitPoints",
          targetRef: ALICE.characterId,
          amount: -3,
        },
        {
          kind: "moveEntity",
          entityRef: ALICE.characterId,
          sceneRef: "scene:gallery",
        },
      ],
    },
    {
      goal: "在吊灯坠下时用撬棍格挡并扑进回廊",
      method: "横举撬棍承受冲击后立即翻滚离开",
      risk: {
        warning: "格挡仍可能让吊灯砸伤阿莱莎。",
        successConsequences: ["阿莱莎避开重击并进入回廊"],
        failureConsequences: ["阿莱莎受伤但仍被冲击带入回廊"],
        retryGate: ["situationAdvanced"],
      },
    },
  ));
  assert.equal(requested.kind, "awaitingRandomness", JSON.stringify(requested));
  assert.deepEqual(requested.events.map(({ eventType }) => eventType), [
    "DefinitionRegistered",
    "CanonicalFactDeclared",
    "SceneQuestionOpened",
    "FeasibilityRuled",
    "CheckFrozen",
    "ItemUsed",
    "RandomnessRequested",
  ]);
  assert.equal(requested.randomnessRequest.purpose, "savingThrow");
  assert.equal(requested.randomnessRequest.diceExpression, "2d20kh1");
  assert.equal(requested.randomnessRequest.frozenCheck.kind, "savingThrow");
  assert.equal(requested.randomnessRequest.frozenCheck.modifier, "3");
  assert.ok(!JSON.stringify(requested.events).includes('"faces"'));
  scenario = appendAndReplay(scenario, requested);
  assert.equal(
    scenario.state.entities[ALICE.characterId].loadout.backpack
      .find(({ itemId }) => itemId === "crowbar").quantity,
    1,
  );

  const resolved = step(scenario.profiles, scenario.state, {
    kind: "fulfillAuthoritativeRandomness",
    continuation: requested.continuation,
    rolls: [3, 4],
  });
  assert.equal(resolved.kind, "committed", JSON.stringify(resolved));
  assert.equal(resolved.events.filter(({ eventType }) => eventType === "ItemUsed").length, 0);
  assert.deepEqual(resolved.events.map(({ eventType }) => eventType), [
    "DiceRolled",
    "ImprovisedCheckResolved",
    "HitPointsChanged",
    "CharacterMoved",
    "MeaningfulFailureCommitted",
  ]);
  const check = resolved.events.find(({ eventType }) => eventType === "ImprovisedCheckResolved");
  assert.equal(check.payload.total, 7);
  assert.equal(check.payload.succeeded, false);
  scenario = appendAndReplay(scenario, resolved);
  assert.equal(scenario.state.entities[ALICE.characterId].hitPoints.current, 5);
  assert.equal(scenario.state.combatRuntime.entities[ALICE.characterId].hitPoints.current, "5");
  assert.equal(scenario.state.entities[ALICE.characterId].sceneId, "scene:gallery");
  assert.equal(
    scenario.state.entities[ALICE.characterId].loadout.backpack
      .find(({ itemId }) => itemId === "crowbar").quantity,
    1,
  );
});

test("SRD 2014 class saving-throw proficiencies determine save modifiers instead of skill proficiency", () => {
  const proficiencies = {
    fighter: ["str", "con"],
    barbarian: ["str", "con"],
    rogue: ["dex", "int"],
    wizard: ["int", "wis"],
    cleric: ["wis", "cha"],
    ranger: ["str", "dex"],
  };
  for (const [classId, abilities] of Object.entries(proficiencies)) {
    for (const ability of abilities) {
      const scenario = initialize({
        classId,
        abilityScores: { str: 12, dex: 12, con: 12, int: 12, wis: 12, cha: 12 },
        proficiencyBonus: 2,
        proficientSkills: [],
      });
      const requested = step(scenario.profiles, scenario.state, semanticPlan(
        `root:compound-rules:save-proficiency:${classId}:${ability}`,
        {
          operation: "resolveNoncombatSave",
          saveAbility: ability,
          dc: 12,
          mode: "normal",
          duration: { unit: "round", value: 1 },
          frozenCosts: [],
          success: [],
          failure: [],
        },
      ));
      assert.equal(requested.kind, "awaitingRandomness", JSON.stringify(requested));
      assert.equal(requested.randomnessRequest.frozenCheck.modifier, "3", `${classId} ${ability}`);
    }
  }
});

test("environment-v4 noncombat saves use the explicit proficientSaves field", () => {
  const scenario = initialize({
    classId: "fighter",
    abilityScores: { str: 12, dex: 14, con: 12, int: 12, wis: 12, cha: 12 },
    proficiencyBonus: 2,
    proficientSkills: ["investigation"],
    expertiseSkills: ["investigation"],
    proficientSaves: ["dex"],
  }, undefined, {}, ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST);
  const requested = step(scenario.profiles, scenario.state, semanticPlan(
    "root:compound-rules:v4-explicit-save",
    {
      operation: "resolveNoncombatSave",
      saveAbility: "dex",
      dc: 12,
      mode: "normal",
      duration: { unit: "round", value: 1 },
      frozenCosts: [],
      success: [],
      failure: [],
    },
  ));
  assert.equal(requested.kind, "awaitingRandomness", JSON.stringify(requested));
  assert.equal(requested.randomnessRequest.frozenCheck.modifier, "4");
});

test("a successful noncombat save commits its separately frozen movement branch", () => {
  let scenario = initialize();
  const requested = step(scenario.profiles, scenario.state, semanticPlan(
    "root:compound-rules:falling-chandelier-save-success",
    {
      operation: "resolveNoncombatSave",
      saveAbility: "con",
      dc: 14,
      mode: "normal",
      duration: { unit: "minute", value: 1 },
      frozenCosts: [],
      success: [{
        kind: "moveEntity",
        entityRef: ALICE.characterId,
        sceneRef: "scene:gallery",
      }],
      failure: [{
        kind: "changeHitPoints",
        targetRef: ALICE.characterId,
        amount: -3,
      }],
    },
  ));
  assert.equal(requested.kind, "awaitingRandomness", JSON.stringify(requested));
  scenario = appendAndReplay(scenario, requested);
  const resolved = step(scenario.profiles, scenario.state, {
    kind: "fulfillAuthoritativeRandomness",
    continuation: requested.continuation,
    rolls: [11],
  });
  assert.equal(resolved.kind, "committed", JSON.stringify(resolved));
  assert.ok(resolved.events.some(({ eventType }) => eventType === "CharacterMoved"));
  assert.ok(!resolved.events.some(({ eventType }) => eventType === "HitPointsChanged"));
  scenario = appendAndReplay(scenario, resolved);
  assert.equal(scenario.state.entities[ALICE.characterId].hitPoints.current, 8);
  assert.equal(scenario.state.entities[ALICE.characterId].sceneId, "scene:gallery");
});

test("an invalid NPC basis, operation, extra field, or injected face rejects the whole plan with zero events", () => {
  const scenario = initialize();
  const invalidPlans = [
    validPlan({
      npcActions: [{
        npcId: WARDEN_ID,
        goal: "针对玩家未暴露的计划设伏",
        method: "读取玩家秘密",
        knowledgeRefs: ["knowledge:player-secret"],
        mechanicalProposal: null,
      }],
    }),
    validPlan({ mechanicalProposal: { ...validPlan().mechanicalProposal, operation: "inventOutcome" } }),
    { ...validPlan(), statePatch: { entities: {} } },
    validPlan({ mechanicalProposal: { ...validPlan().mechanicalProposal, faces: [20] } }),
  ];
  const before = structuredClone(scenario.state);
  for (const input of invalidPlans) {
    const result = step(scenario.profiles, scenario.state, input);
    assert.equal(result.kind, "rejected", JSON.stringify(result));
    assert.deepEqual(result.events, []);
    assert.deepEqual(scenario.state, before);
  }
});

test("a dynamic artifact is acquired, held, transferred, used, replayed, and projected only to an eligible viewer", () => {
  let scenario = initialize();
  const artifactId = "artifact:semantic:moon-key";
  const artifactFactRef = "fact:semantic:moon-key";
  const acquired = step(scenario.profiles, scenario.state, semanticPlan(
    "root:semantic:acquire-moon-key",
    {
      operation: "acquireArtifact",
      artifactRef: artifactId,
    },
    {
      goal: "从灵柩暗格中取出唯一的月银钥匙",
      method: "确认暗格没有机关后亲手拿起钥匙",
      dynamicMaterializations: [{
        kind: "item",
        factRef: artifactFactRef,
        causalBasisRefs: [],
        visibilityPolicyRef: "visibility:artifact-holder",
        definition: {
          artifactId,
          name: "月银钥匙",
          sceneRef: "scene:wake",
        },
      }],
    },
  ));
  assert.equal(acquired.kind, "committed", JSON.stringify(acquired));
  assert.ok(acquired.events.every(({ rootActionId }) => rootActionId === "root:semantic:acquire-moon-key"));
  assert.deepEqual(
    acquired.events.filter(({ eventType }) => eventType.startsWith("Artifact"))
      .map(({ eventType }) => eventType),
    ["ArtifactMaterialized", "ArtifactAcquired"],
  );
  scenario = appendAndReplay(scenario, acquired);
  assert.deepEqual(
    scenario.state.campaignRuntime.artifacts[artifactId],
    {
      artifactId,
      definitionRef: artifactFactRef,
      name: "月银钥匙",
      status: "held",
      quantity: 1,
      holderId: ALICE.characterId,
      visibilityPolicyId: "visibility:artifact-holder",
      materializedByEventId: acquired.events.find(({ eventType }) =>
        eventType === "ArtifactMaterialized").eventId,
      acquiredByEventId: acquired.events.find(({ eventType }) =>
        eventType === "ArtifactAcquired").eventId,
    },
  );
  const aliceAfterAcquire = project(scenario.profiles, scenario.state, aliceViewer());
  const bobAfterAcquire = project(scenario.profiles, scenario.state, bobViewer());
  assert.equal(aliceAfterAcquire.kind, "projected", JSON.stringify(aliceAfterAcquire));
  assert.equal(bobAfterAcquire.kind, "projected", JSON.stringify(bobAfterAcquire));
  assert.deepEqual(aliceAfterAcquire.artifacts, [{
    artifactId,
    definitionRef: artifactFactRef,
    name: "月银钥匙",
    status: "held",
    quantity: 1,
    holderId: ALICE.characterId,
  }]);
  assert.ok(!JSON.stringify(bobAfterAcquire).includes(artifactId));

  const transferred = step(scenario.profiles, scenario.state, semanticPlan(
    "root:semantic:transfer-moon-key",
    {
      operation: "transferArtifact",
      artifactRef: artifactId,
      targetEntityRef: BOB.characterId,
    },
    {
      goal: "把月银钥匙交给柏舟保管",
      method: "在守灵厅内当面交到柏舟手中",
    },
  ));
  assert.equal(transferred.kind, "committed", JSON.stringify(transferred));
  assert.equal(
    transferred.events.filter(({ eventType }) => eventType === "ArtifactTransferred").length,
    1,
  );
  scenario = appendAndReplay(scenario, transferred);
  assert.equal(scenario.state.campaignRuntime.artifacts[artifactId].holderId, BOB.characterId);
  assert.ok(!JSON.stringify(project(scenario.profiles, scenario.state, aliceViewer())).includes(artifactId));
  assert.ok(JSON.stringify(project(scenario.profiles, scenario.state, bobViewer())).includes(artifactId));

  const used = step(scenario.profiles, scenario.state, semanticPlan(
    "root:semantic:consume-moon-key",
    {
      operation: "useArtifact",
      artifactRef: artifactId,
      artifactUse: "consume",
    },
    {
      actorCharacterId: BOB.characterId,
      goal: "用月银钥匙开启一次性的月门",
      method: "把钥匙嵌入锁孔并完整转动",
    },
  ));
  assert.equal(used.kind, "committed", JSON.stringify(used));
  const usedEvent = used.events.find(({ eventType }) => eventType === "ArtifactUsed");
  assert.deepEqual(usedEvent.payload, {
    artifactId,
    characterId: BOB.characterId,
    purpose: "用月银钥匙开启一次性的月门",
    beforeStatus: "held",
    afterStatus: "consumed",
    remainingQuantity: 0,
  });
  scenario = appendAndReplay(scenario, used);
  assert.equal(scenario.state.campaignRuntime.artifacts[artifactId].status, "consumed");
  assert.equal(scenario.state.campaignRuntime.artifacts[artifactId].quantity, 0);
  assert.equal(scenario.state.campaignRuntime.artifacts[artifactId].holderId, undefined);
  assert.ok(!JSON.stringify(project(scenario.profiles, scenario.state, bobViewer())).includes(artifactId));

  const fullReplay = replay(scenario.genesis, scenario.events);
  assert.equal(fullReplay.kind, "replayed", JSON.stringify(fullReplay));
  assert.deepEqual(fullReplay.state.campaignRuntime.artifacts[artifactId],
    scenario.state.campaignRuntime.artifacts[artifactId]);

  const correction = step(scenario.profiles, scenario.state, {
    kind: "applyServiceCorrection",
    correctionAuthority: {
      kind: "roomCorrectionAuthority",
      capability: scenario.state.correctionRuntime.authorityCapability,
    },
    correctionId: "correction:semantic:consume-moon-key",
    targetReceiptId: scenario.state.receipts["root:semantic:consume-moon-key"].receiptId,
    actorCharacterId: BOB.characterId,
    errorKind: "rulesMisapplication",
    publicExplanation: "本次一次性消耗判定有误，恢复使用前的物件状态。",
    basis: {
      eventHash: scenario.state.eventHeadHash,
      stateHash: used.events.at(-1).stateHashAfter,
    },
  });
  assert.equal(correction.kind, "committed", JSON.stringify(correction));
  scenario = appendAndReplay(scenario, correction);
  assert.equal(scenario.state.campaignRuntime.artifacts[artifactId].status, "held");
  assert.equal(scenario.state.campaignRuntime.artifacts[artifactId].quantity, 1);
  assert.equal(scenario.state.campaignRuntime.artifacts[artifactId].holderId, BOB.characterId);
});

test("forged artifact references and cross-scene physical transfers reject the whole ActionPlan", () => {
  const unknown = initialize();
  const unknownResult = step(unknown.profiles, unknown.state, semanticPlan(
    "root:semantic:forge-artifact-ref",
    { operation: "acquireArtifact", artifactRef: "artifact:semantic:does-not-exist" },
  ));
  assert.equal(unknownResult.kind, "rejected", JSON.stringify(unknownResult));
  assert.equal(unknownResult.rejection.code, "privateOrUnknownReference");
  assert.deepEqual(unknownResult.events, []);

  let remote = initialize({}, undefined, { bob: { sceneId: "scene:gallery" } });
  const artifactId = "artifact:semantic:remote-key";
  const acquired = step(remote.profiles, remote.state, semanticPlan(
    "root:semantic:acquire-remote-key",
    { operation: "acquireArtifact", artifactRef: artifactId },
    {
      dynamicMaterializations: [{
        kind: "item",
        factRef: "fact:semantic:remote-key",
        causalBasisRefs: [],
        visibilityPolicyRef: "visibility:artifact-holder",
        definition: { artifactId, name: "远门钥匙", sceneRef: "scene:wake" },
      }],
    },
  ));
  assert.equal(acquired.kind, "committed", JSON.stringify(acquired));
  remote = appendAndReplay(remote, acquired);
  const before = structuredClone(remote.state);
  const crossScene = step(remote.profiles, remote.state, semanticPlan(
    "root:semantic:cross-scene-artifact-transfer",
    {
      operation: "transferArtifact",
      artifactRef: artifactId,
      targetEntityRef: BOB.characterId,
    },
  ));
  assert.equal(crossScene.kind, "rejected", JSON.stringify(crossScene));
  assert.equal(crossScene.rejection.code, "privateOrUnknownReference");
  assert.deepEqual(crossScene.events, []);
  assert.deepEqual(remote.state, before);
});

test("a lore-only dynamic item remains an open-world definition without inventing artifact state", () => {
  const scenario = initialize();
  const factRef = "fact:semantic:visitor-ledger";
  const outcome = step(scenario.profiles, scenario.state, semanticPlan(
    "root:semantic:define-visitor-ledger",
    {
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [],
      failure: [],
    },
    {
      dynamicMaterializations: [{
        kind: "item",
        factRef,
        causalBasisRefs: [],
        visibilityPolicyRef: "visibility:scene-observers",
        definition: { name: "访客登记簿", description: "前厅用于登记来客的普通账册。" },
      }],
    },
  ));
  assert.equal(outcome.kind, "committed", JSON.stringify(outcome));
  assert.equal(outcome.events.some(({ eventType }) => eventType === "ArtifactMaterialized"), false);
  const replayed = appendAndReplay(scenario, outcome);
  assert.equal(replayed.state.campaignRuntime.definitions[factRef].content.name, "访客登记簿");
  assert.deepEqual(replayed.state.campaignRuntime.artifacts, {});
});

test("an offscreen NPC advances a faction plan through the same compound transaction using only finite knowledge", () => {
  const scenario = initialize({}, undefined, { warden: { sceneId: "scene:gallery" } });
  const rootActionId = "root:semantic:offscreen-watch-plan";
  const factionRef = "faction:semantic:night-watch";
  const advanced = step(scenario.profiles, scenario.state, semanticPlan(
    rootActionId,
    {
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [],
      failure: [],
    },
    {
      dynamicMaterializations: [{
        kind: "faction",
        factRef: factionRef,
        causalBasisRefs: [],
        visibilityPolicyRef: `visibility:npc:${WARDEN_ID}`,
        definition: {
          factionId: factionRef,
          name: "夜巡会",
          goal: "按既定职责封闭危险回廊",
          memberRefs: [WARDEN_ID],
          resourceRefs: ["resource:night-watch:lanterns"],
        },
      }],
      npcActions: [{
        npcId: WARDEN_ID,
        goal: "依据守灵职责推进夜巡会的封锁计划",
        method: "在回廊远端架起警戒绳并留下可观察痕迹",
        knowledgeRefs: [WARDEN_KNOWLEDGE],
        mechanicalProposal: {
          operation: "advanceFactionPlan",
          factionRef,
          basisRefs: [WARDEN_KNOWLEDGE],
        },
      }],
    },
  ));
  assert.equal(advanced.kind, "committed", JSON.stringify(advanced));
  assert.ok(advanced.events.every(({ rootActionId: eventRoot }) => eventRoot === rootActionId));
  assert.equal(advanced.events.filter(({ eventType }) => eventType === "FactionPlanAdvanced").length, 1);
  const replayed = appendAndReplay(scenario, advanced);
  const factionAdvance = Object.values(replayed.state.campaignRuntime.factionPlans)[0];
  assert.equal(factionAdvance.actingNpcId, WARDEN_ID);
  assert.deepEqual(factionAdvance.causeFactIds, [WARDEN_KNOWLEDGE]);
  assert.equal(factionAdvance.status, "advanced");

  const npcProjection = project(replayed.profiles, replayed.state, {
    kind: "npc",
    npcId: WARDEN_ID,
    purpose: "kpDecision",
    capability: "internal:npc-limited-knowledge",
  });
  assert.equal(npcProjection.kind, "projected", JSON.stringify(npcProjection));
  assert.equal(npcProjection.controlledCharacter.sceneId, "scene:gallery");
  assert.equal(npcProjection.factions[0].factionId, factionRef);
  assert.equal(npcProjection.factionPlans[0].actingNpcId, WARDEN_ID);
  assert.ok(!JSON.stringify(project(replayed.profiles, replayed.state, aliceViewer()))
    .includes("架起警戒绳"));

  const forged = step(scenario.profiles, scenario.state, semanticPlan(
    "root:semantic:offscreen-forged-knowledge",
    {
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [],
      failure: [],
    },
    {
      dynamicMaterializations: [{
        kind: "faction",
        factRef: "faction:semantic:forged-watch",
        causalBasisRefs: [],
        visibilityPolicyRef: `visibility:npc:${WARDEN_ID}`,
        definition: {
          factionId: "faction:semantic:forged-watch",
          name: "伪造夜巡会",
          goal: "读取玩家未公开的计划",
          memberRefs: [WARDEN_ID],
          resourceRefs: [],
        },
      }],
      npcActions: [{
        npcId: WARDEN_ID,
        goal: "针对玩家未公开的计划行动",
        method: "提前封锁玩家秘密选择的路线",
        knowledgeRefs: [WARDEN_KNOWLEDGE],
        mechanicalProposal: {
          operation: "advanceFactionPlan",
          factionRef: "faction:semantic:forged-watch",
          basisRefs: ["knowledge:player-secret"],
        },
      }],
    },
  ));
  assert.equal(forged.kind, "rejected", JSON.stringify(forged));
  assert.equal(forged.rejection.code, "npcKnowledgeInsufficient");
  assert.deepEqual(forged.events, []);
});

test("an ActorPlan may cite the NPC's relationship, promise, and debt as finite social premises", () => {
  let scenario = initialize();
  const relationshipRef = "relationship:actor-plan:alice-warden";
  const promiseRef = "promise:actor-plan:alice-warden";
  const debtRef = "debt:actor-plan:alice-warden";
  const socialFactRef = "fact:actor-plan:social-premises";
  const social = step(scenario.profiles, scenario.state, semanticPlan(
    "root:actor-plan:social-premises",
    {
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [
        {
          kind: "updateRelationship",
          relationshipRef,
          recipientRefs: [WARDEN_ID],
          value: "守灵人信任阿莱莎会谨慎处理院门。",
          definitionRef: socialFactRef,
        },
        {
          kind: "recordCommitment",
          commitmentRef: promiseRef,
          targetRef: WARDEN_ID,
          value: "阿莱莎答应不让城防惊动灵堂。",
          status: "本次守夜结束前",
        },
        {
          kind: "recordDebt",
          debtRef,
          targetRef: WARDEN_ID,
          value: "阿莱莎欠守灵人一次修缮院门的人情。",
          status: "院门修好前",
          definitionRef: socialFactRef,
        },
      ],
      failure: [],
    },
    {
      dynamicMaterializations: [{
        kind: "fact",
        factRef: socialFactRef,
        causalBasisRefs: [],
        visibilityPolicyRef: "visibility:relationship-participants",
        definition: { name: "院门交接产生的社会义务" },
      }],
    },
  ));
  assert.equal(social.kind, "committed", JSON.stringify(social));
  scenario = appendAndReplay(scenario, social);

  const planId = "actor-plan:social-premises:warden";
  const activityId = "activity:actor-plan:social-premises:warden";
  const planned = step(scenario.profiles, scenario.state, semanticPlan(
    "root:actor-plan:form-from-social-premises",
    {
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [],
      failure: [],
    },
    {
      npcActions: [{
        npcId: WARDEN_ID,
        goal: "兑现彼此已经形成的信任与义务",
        method: "守住院门并等待阿莱莎完成修缮",
        knowledgeRefs: [WARDEN_KNOWLEDGE],
        actorPlan: {
          planId,
          premiseRefs: [WARDEN_KNOWLEDGE, relationshipRef, promiseRef, debtRef],
          nextStep: "在院门前拉起警戒绳",
          resourceRefs: [],
          activity: {
            activityId,
            activityKind: "socialObligation",
            intendedDurationMicros: "1000000",
          },
          due: { kind: "fictionTime", atFictionMicros: "2000000" },
          trigger: null,
          trace: {
            factRef: "fact:actor-plan:social-premises:trace",
            description: "院门前出现守灵人拉起的警戒绳",
            visibilityPolicyRef: "visibility:scene-observers",
          },
          alternateTarget: {
            targetRef: "scene:wake",
            reason: "院门不可守时退回守灵厅入口",
          },
        },
        mechanicalProposal: null,
      }],
    },
  ));
  assert.equal(planned.kind, "committed", JSON.stringify(planned));
  const formed = planned.events.find(({ eventType }) => eventType === "NpcPlanFormed");
  assert.deepEqual(formed.payload.premiseRefs, [
    debtRef,
    WARDEN_KNOWLEDGE,
    promiseRef,
    relationshipRef,
  ].sort());
  scenario = appendAndReplay(scenario, planned);
  const npcRead = project(scenario.profiles, scenario.state, {
    kind: "npc",
    npcId: WARDEN_ID,
    purpose: "kpDecision",
    capability: "internal:npc-limited-knowledge",
  });
  assert.equal(npcRead.kind, "projected", JSON.stringify(npcRead));
  assert.deepEqual(npcRead.npcPlans[0].premiseRefs, formed.payload.premiseRefs);
  assert.ok(npcRead.relationships.some(({ relationshipId }) => relationshipId === relationshipRef));
  assert.ok(npcRead.promises.some(({ promiseId }) => promiseId === promiseRef));
  assert.ok(npcRead.debts.some(({ debtId }) => debtId === debtRef));
});

test("a faction ActorPlan freezes its agent and resources, then executes through the due Rules transaction", () => {
  let scenario = initialize();
  const factionRef = "faction:actor-plan:night-watch";
  const resourceRef = "resource:actor-plan:night-watch:warning-cord";
  const planId = "actor-plan:faction:night-watch:close-yard";
  const activityId = "activity:actor-plan:faction:night-watch:close-yard";
  const traceRef = "fact:actor-plan:faction:warning-cord";
  const planned = step(scenario.profiles, scenario.state, semanticPlan(
    "root:actor-plan:faction:form",
    {
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [],
      failure: [],
    },
    {
      dynamicMaterializations: [{
        kind: "faction",
        factRef: factionRef,
        causalBasisRefs: [],
        visibilityPolicyRef: `visibility:npc:${WARDEN_ID}`,
        definition: {
          factionId: factionRef,
          name: "夜巡会",
          goal: "不惊动守灵厅地封闭院门",
          memberRefs: [WARDEN_ID],
          resourceRefs: [resourceRef],
        },
      }],
      npcActions: [{
        npcId: WARDEN_ID,
        goal: "代表夜巡会封闭院门",
        method: "使用夜巡会的警戒绳封住院门",
        knowledgeRefs: [WARDEN_KNOWLEDGE],
        actorPlan: {
          factionRef,
          planId,
          premiseRefs: [WARDEN_KNOWLEDGE],
          nextStep: "使用夜巡会的警戒绳封住院门",
          resourceRefs: [factionRef, resourceRef],
          activity: {
            activityId,
            activityKind: "factionOperation",
            intendedDurationMicros: "1000000",
          },
          due: { kind: "fictionTime", atFictionMicros: "1000000" },
          trigger: null,
          trace: {
            factRef: traceRef,
            description: "院门前出现夜巡会的警戒绳",
            visibilityPolicyRef: "visibility:scene-observers",
          },
          alternateTarget: {
            targetRef: "scene:wake",
            reason: "院门不可守时封住守灵厅入口",
          },
        },
        mechanicalProposal: null,
      }],
    },
  ));
  assert.equal(planned.kind, "committed", JSON.stringify(planned));
  assert.deepEqual(planned.events.filter(({ eventType }) =>
    eventType === "NpcPlanFormed" || eventType === "FactionPlanFormed"
  ).map(({ eventType }) => eventType), ["NpcPlanFormed", "FactionPlanFormed"]);
  scenario = appendAndReplay(scenario, planned);
  assert.deepEqual(scenario.state.campaignRuntime.factionPlans[planId], {
    factionId: factionRef,
    planId,
    actingNpcId: WARDEN_ID,
    premiseRefs: [WARDEN_KNOWLEDGE],
    resourceRefs: [factionRef, resourceRef],
    status: "scheduled",
    revision: "1",
    formedAtEventId: planned.events.find(({ eventType }) => eventType === "FactionPlanFormed").eventId,
  });

  const due = project(scenario.profiles, scenario.state, {
    kind: "kp",
    capability: "internal:kp-spatial-evidence",
  }, { dueActorPlanFor: { affectedCharacterId: ALICE.characterId } });
  assert.equal(due.kind, "projected", JSON.stringify(due));
  assert.equal(due.dueActorPlan.planId, planId);
  assert.equal(due.factionPlans[0].factionId, factionRef);
  const executed = step(scenario.profiles, scenario.state, {
    kind: "resolveDueActorPlan",
    proposalId: due.dueActorPlanChildRootActionId,
    causedByRootActionId: "root:actor-plan:faction:affected-player",
    affectedCharacterId: ALICE.characterId,
    planId,
    decision: "execute",
    targetRef: "scene:wake",
    mechanicalProposal: null,
  });
  assert.equal(executed.kind, "committed", JSON.stringify(executed));
  assert.deepEqual(executed.events.map(({ eventType }) => eventType), [
    "FactionActionCommitted",
    "CanonicalFactDeclared",
    "ActivityCompleted",
  ]);
  assert.deepEqual(executed.events[0].payload, {
    factionId: factionRef,
    planId,
    actingNpcId: WARDEN_ID,
    decision: "execute",
    causedByRootActionId: "root:actor-plan:faction:affected-player",
    nextStep: "使用夜巡会的警戒绳封住院门",
    traceFactRef: traceRef,
    targetRef: "scene:wake",
    resourceRefs: [factionRef, resourceRef],
  });
  scenario = appendAndReplay(scenario, executed);
  assert.equal(scenario.state.campaignRuntime.factionPlans[planId].status, "resolved");
});

test("a consenting retired PC becomes a finite-knowledge NPC whose due ActorPlan still executes", () => {
  let scenario = initialize();
  const retainedKnowledgeRef = "knowledge:retired-npc:yard-order";
  const knowledge = step(scenario.profiles, scenario.state, semanticPlan(
    "root:retired-npc:learn-order",
    {
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [{
        kind: "acquireKnowledge",
        knowledgeRef: retainedKnowledgeRef,
        value: "阿莱莎知道钟响后要守住院门。",
        definitionRef: "fact:retired-npc:yard-order",
      }],
      failure: [],
    },
    {
      dynamicMaterializations: [{
        kind: "fact",
        factRef: "fact:retired-npc:yard-order",
        causalBasisRefs: [],
        visibilityPolicyRef: `visibility:npc:${ALICE.characterId}`,
        definition: { name: "院门守卫命令" },
      }],
    },
  ));
  assert.equal(knowledge.kind, "committed", JSON.stringify(knowledge));
  scenario = appendAndReplay(scenario, knowledge);

  const retired = step(scenario.profiles, scenario.state, semanticPlan(
    "root:retired-npc:retire",
    {
      operation: "advanceCampaignLifecycle",
      lifecycleAction: "retireCharacter",
      continueAsNpc: true,
    },
  ));
  assert.equal(retired.kind, "committed", JSON.stringify(retired));
  scenario = appendAndReplay(scenario, retired);
  assert.equal(scenario.state.entities[ALICE.characterId].kind, "npc");
  assert.equal(scenario.state.entities[ALICE.characterId].tenureStatus, "npcTransitioned");
  assert.equal(scenario.state.characterControls[ALICE.characterId], undefined);

  const planId = "actor-plan:retired-npc:guard-yard";
  const activityId = "activity:retired-npc:guard-yard";
  const planned = step(scenario.profiles, scenario.state, semanticPlan(
    "root:retired-npc:form-plan",
    {
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [],
      failure: [],
    },
    {
      actorCharacterId: BOB.characterId,
      npcActions: [{
        npcId: ALICE.characterId,
        goal: "按退休前已经知道的命令守住院门",
        method: "在院门前拉起警戒绳",
        knowledgeRefs: [retainedKnowledgeRef],
        actorPlan: {
          planId,
          premiseRefs: [retainedKnowledgeRef],
          nextStep: "在院门前拉起警戒绳",
          resourceRefs: [],
          activity: {
            activityId,
            activityKind: "retiredNpcDuty",
            intendedDurationMicros: "1000000",
          },
          due: { kind: "fictionTime", atFictionMicros: "2000000" },
          trigger: null,
          trace: {
            factRef: "fact:retired-npc:guard-trace",
            description: "院门前出现阿莱莎拉起的警戒绳",
            visibilityPolicyRef: "visibility:scene-observers",
          },
          alternateTarget: {
            targetRef: "scene:wake",
            reason: "院门不可守时退回守灵厅入口",
          },
        },
        mechanicalProposal: null,
      }],
    },
  ));
  assert.equal(planned.kind, "committed", JSON.stringify(planned));
  scenario = appendAndReplay(scenario, planned);

  const due = project(scenario.profiles, scenario.state, {
    kind: "kp",
    capability: "internal:kp-spatial-evidence",
  }, { dueActorPlanFor: { affectedCharacterId: BOB.characterId } });
  assert.equal(due.kind, "projected", JSON.stringify(due));
  assert.equal(due.dueActorPlan.planId, planId);
  assert.equal(due.dueActorPlan.actorRef, ALICE.characterId);
  assert.ok(due.knowledge.some(({ knowledgeRef }) =>
    knowledgeRef === retainedKnowledgeRef));
  const executed = step(scenario.profiles, scenario.state, {
    kind: "resolveDueActorPlan",
    proposalId: due.dueActorPlanChildRootActionId,
    causedByRootActionId: "root:retired-npc:affected-bob-intent",
    affectedCharacterId: BOB.characterId,
    planId,
    decision: "execute",
    mechanicalProposal: null,
  });
  assert.equal(executed.kind, "committed", JSON.stringify(executed));
  assert.deepEqual(executed.events.map(({ eventType }) => eventType), [
    "NpcActionCommitted",
    "CanonicalFactDeclared",
    "ActivityCompleted",
  ]);
});

test("a randomized player check and finite-knowledge NPC check share one Root Action and one authority batch", () => {
  let scenario = initialize();
  const rootActionId = "root:compound-rules:player-and-npc-check";
  const npcObservationRef = "knowledge:compound-rules:warden-heard-chain";
  const requested = step(scenario.profiles, scenario.state, validPlan({
    rootActionId,
    npcActions: [{
      npcId: WARDEN_ID,
      goal: "判断大厅里的轻响是否值得中断巡视",
      method: "只依据守灵职责和当下可听见的动静保持警觉",
      knowledgeRefs: [WARDEN_KNOWLEDGE],
        mechanicalProposal: {
          operation: "resolveNoncombatSave",
          saveAbility: "wis",
          dc: 11,
          mode: "normal",
          duration: { unit: "second", value: 6 },
          frozenCosts: [],
          success: [{
            kind: "acquireKnowledge",
            knowledgeRef: npcObservationRef,
            value: "守灵人确认轻响来自吊链，而不是访客脚步。",
            definitionRef: HAZARD_REF,
          }],
          failure: [],
        },
    }],
  }));
  assert.equal(requested.kind, "awaitingRandomness", JSON.stringify(requested));
  assert.equal(requested.randomnessRequests.length, 2);
  assert.equal(requested.continuations.length, 2);
  assert.ok(requested.events.every(({ rootActionId: eventRoot }) => eventRoot === rootActionId));
  assert.equal(requested.events.filter(({ eventType }) => eventType === "RandomnessRequested").length, 2);
  scenario = appendAndReplay(scenario, requested);

  const resolved = step(scenario.profiles, scenario.state, {
    kind: "fulfillAuthoritativeRandomnessBatch",
    results: requested.continuations.map((continuation, index) => ({
      continuation,
      rolls: [index === 0 ? 12 : 15],
    })),
  });
  assert.equal(resolved.kind, "committed", JSON.stringify(resolved));
  assert.equal(resolved.events.filter(({ eventType }) => eventType === "DiceRolled").length, 2);
  assert.equal(resolved.events.filter(({ eventType }) => eventType === "ImprovisedCheckResolved").length, 2);
  assert.ok(resolved.events.every(({ rootActionId: eventRoot }) => eventRoot === rootActionId));
  assert.equal(resolved.mechanicalResult.kind, "continuationBatch");
  assert.equal(resolved.mechanicalResult.resolutions.length, 2);
  scenario = appendAndReplay(scenario, resolved);
  assert.equal(Object.keys(scenario.state.internalContinuations).length, 0);
  assert.equal(scenario.state.receipts[rootActionId].status, "committed");
  assert.equal(
    scenario.state.knowledge[WARDEN_ID][npcObservationRef].content,
    "守灵人确认轻响来自吊链，而不是访客脚步。",
  );
});

test("every non-check semantic ActionPlan operation is registered on the same Rules transaction", () => {
  const cases = [
    {
      id: "contest",
      kind: "awaitingRandomness",
      mechanical: {
        operation: "resolveNoncombatContest",
        targetEntityRef: WARDEN_ID,
        ability: "str",
        skill: null,
        opposedAbility: "str",
        opposedSkill: null,
        mode: "normal",
      },
    },
    {
      id: "save",
      kind: "awaitingRandomness",
      mechanical: {
        operation: "resolveNoncombatSave",
        saveAbility: "dex",
        dc: 12,
        mode: "normal",
        duration: { unit: "round", value: 1 },
        frozenCosts: [],
        success: [],
        failure: [],
      },
    },
    {
      id: "activity",
      kind: "committed",
      mechanical: {
        operation: "startActivity",
        activityRef: "activity:semantic:search",
        duration: { unit: "minute", value: 10 },
        success: [{ kind: "acquireKnowledge", knowledgeRef: "knowledge:search-result" }],
        failure: [],
      },
    },
    {
      id: "rest",
      kind: "committed",
      mechanical: { operation: "resolveRest", restKind: "short" },
    },
    {
      id: "resource",
      kind: "committed",
      mechanical: { operation: "changeResource", resourceRef: "resolve", amount: 1 },
    },
    {
      id: "item",
      kind: "committed",
      mechanical: { operation: "useItem", itemRef: "torch", amount: 1 },
    },
    {
      id: "knowledge",
      kind: "committed",
      mechanical: { operation: "changeKnowledge", knowledgeRef: "fact:semantic:knowledge" },
    },
    {
      id: "party",
      kind: "awaitingInput",
      mechanical: { operation: "changeParty", memberRefs: [BOB.characterId] },
    },
    {
      id: "lifecycle",
      kind: "committed",
      mechanical: {
        operation: "advanceCampaignLifecycle",
        lifecycleAction: "retireCharacter",
        continueAsNpc: true,
      },
    },
  ];

  for (const fixture of cases) {
    const scenario = initialize();
    const rootActionId = `root:semantic:${fixture.id}`;
    const outcome = step(
      scenario.profiles,
      scenario.state,
      semanticPlan(rootActionId, fixture.mechanical),
    );
    assert.equal(outcome.kind, fixture.kind, `${fixture.id}: ${JSON.stringify(outcome)}`);
    assert.ok(outcome.events.length > 2, fixture.id);
    assert.ok(outcome.events.every((event) => event.rootActionId === rootActionId), fixture.id);
    assert.equal(outcome.events[0].eventType, "DefinitionRegistered", fixture.id);
    if (fixture.id === "lifecycle") {
      assert.equal(outcome.events.find(({ eventType }) => eventType === "CharacterRetired")
        .payload.continueAsNpc, true);
      assert.equal(outcome.state.entities[ALICE.characterId].tenureStatus, "npcTransitioned");
    }
    assert.ok(outcome.events.some((event) => event.eventType === "FeasibilityRuled"), fixture.id);
    appendAndReplay(scenario, outcome);
  }
});

test("all six typed partyAction variants resolve through the compound ActionPlan seam", () => {
  let cancelled = initialize();
  const cancellationInvite = step(cancelled.profiles, cancelled.state, semanticPlan(
    "root:typed-party:cancel-invite",
    {
      operation: "changeParty",
      partyAction: "inviteMember",
      memberRefs: [BOB.characterId],
    },
  ));
  assert.equal(cancellationInvite.kind, "awaitingInput", JSON.stringify(cancellationInvite));
  cancelled = appendAndReplay(cancelled, cancellationInvite);
  const cancellation = step(cancelled.profiles, cancelled.state, semanticPlan(
    "root:typed-party:cancel",
    {
      operation: "changeParty",
      partyAction: "cancelInvitation",
      pendingInputRef: cancellationInvite.pending.pendingInputId,
    },
  ));
  assert.equal(cancellation.kind, "committed", JSON.stringify(cancellation));
  cancelled = appendAndReplay(cancelled, cancellation);
  assert.deepEqual(project(cancelled.profiles, cancelled.state, aliceViewer()).pendingInputs, []);
  assert.deepEqual(project(cancelled.profiles, cancelled.state, bobViewer()).pendingInputs, []);

  let coordinated = initialize();
  const invitation = step(coordinated.profiles, coordinated.state, semanticPlan(
    "root:typed-party:invite",
    {
      operation: "changeParty",
      partyAction: "inviteMember",
      memberRefs: [BOB.characterId],
    },
  ));
  assert.equal(invitation.kind, "awaitingInput", JSON.stringify(invitation));
  coordinated = appendAndReplay(coordinated, invitation);
  const joined = step(coordinated.profiles, coordinated.state, {
    kind: "answerPartyInvitation",
    rootActionId: "root:typed-party:invite",
    pendingInputId: invitation.pending.pendingInputId,
    controllerCharacterId: BOB.characterId,
    accept: true,
  });
  assert.equal(joined.kind, "committed", JSON.stringify(joined));
  coordinated = appendAndReplay(coordinated, joined);

  const transferred = step(coordinated.profiles, coordinated.state, semanticPlan(
    "root:typed-party:transfer",
    {
      operation: "changeParty",
      partyAction: "transferLeadership",
      memberRefs: [BOB.characterId],
    },
  ));
  assert.equal(transferred.kind, "committed", JSON.stringify(transferred));
  coordinated = appendAndReplay(coordinated, transferred);
  assert.equal(
    Object.values(coordinated.state.multiplayerRuntime.partyGroups)[0].leaderCharacterId,
    BOB.characterId,
  );

  const proposedMove = step(coordinated.profiles, coordinated.state, semanticPlan(
    "root:typed-party:move",
    {
      operation: "changeParty",
      partyAction: "proposeMove",
      destinationRef: "scene:gallery",
      duration: { unit: "minute", value: 1 },
    },
    { actorCharacterId: BOB.characterId },
  ));
  assert.equal(proposedMove.kind, "awaitingInput", JSON.stringify(proposedMove));
  coordinated = appendAndReplay(coordinated, proposedMove);
  const moved = step(coordinated.profiles, coordinated.state, {
    kind: "answerPartyMove",
    rootActionId: "root:typed-party:move",
    pendingInputId: proposedMove.pending.pendingInputId,
    controllerCharacterId: ALICE.characterId,
    accept: true,
  });
  assert.equal(moved.kind, "committed", JSON.stringify(moved));
  coordinated = appendAndReplay(coordinated, moved);
  assert.equal(coordinated.state.entities[ALICE.characterId].sceneId, "scene:gallery");
  assert.equal(coordinated.state.entities[BOB.characterId].sceneId, "scene:gallery");

  const split = step(coordinated.profiles, coordinated.state, semanticPlan(
    "root:typed-party:split",
    {
      operation: "changeParty",
      partyAction: "moveIndividually",
      destinationRef: "scene:wake",
      duration: { unit: "second", value: 30 },
    },
  ));
  assert.equal(split.kind, "committed", JSON.stringify(split));
  coordinated = appendAndReplay(coordinated, split);
  assert.equal(coordinated.state.entities[ALICE.characterId].sceneId, "scene:wake");
  assert.equal(coordinated.state.entities[BOB.characterId].sceneId, "scene:gallery");
  assert.deepEqual(project(coordinated.profiles, coordinated.state, aliceViewer()).partyGroups, []);

  let departed = initialize();
  const leaveInvite = step(departed.profiles, departed.state, semanticPlan(
    "root:typed-party:leave-invite",
    {
      operation: "changeParty",
      partyAction: "inviteMember",
      memberRefs: [BOB.characterId],
    },
  ));
  departed = appendAndReplay(departed, leaveInvite);
  const leaveJoined = step(departed.profiles, departed.state, {
    kind: "answerPartyInvitation",
    rootActionId: "root:typed-party:leave-invite",
    pendingInputId: leaveInvite.pending.pendingInputId,
    controllerCharacterId: BOB.characterId,
    accept: true,
  });
  departed = appendAndReplay(departed, leaveJoined);
  const left = step(departed.profiles, departed.state, semanticPlan(
    "root:typed-party:leave",
    { operation: "changeParty", partyAction: "leave" },
  ));
  assert.equal(left.kind, "committed", JSON.stringify(left));
  departed = appendAndReplay(departed, left);
  assert.deepEqual(project(departed.profiles, departed.state, aliceViewer()).partyGroups, []);
});

test("semantic group rest enters the same campaign transaction and opens private consent", () => {
  let scenario = initialize();
  const invitation = step(scenario.profiles, scenario.state, {
    kind: "invitePartyMember",
    rootActionId: "root:semantic:group-rest-party",
    inviterCharacterId: ALICE.characterId,
    invitedCharacterId: BOB.characterId,
  });
  assert.equal(invitation.kind, "awaitingInput", JSON.stringify(invitation));
  scenario = appendAndReplay(scenario, invitation);
  const joined = step(scenario.profiles, scenario.state, {
    kind: "answerPartyInvitation",
    rootActionId: "root:semantic:group-rest-party",
    pendingInputId: invitation.pending.pendingInputId,
    controllerCharacterId: BOB.characterId,
    accept: true,
  });
  assert.equal(joined.kind, "committed", JSON.stringify(joined));
  scenario = appendAndReplay(scenario, joined);

  const groupRest = step(scenario.profiles, scenario.state, semanticPlan(
    "root:semantic:group-rest",
    {
      operation: "resolveRest",
      restKind: "short",
      hitDiceToSpend: 0,
      arcaneRecoverySlotLevels: [],
      memberRefs: [BOB.characterId],
    },
  ));
  assert.equal(groupRest.kind, "awaitingInput", JSON.stringify(groupRest));
  assert.deepEqual(groupRest.events.slice(-2).map(({ eventType }) => eventType), [
    "RestStarted",
    "GroupRestOffered",
  ]);
  scenario = appendAndReplay(scenario, groupRest);
  assert.equal(project(scenario.profiles, scenario.state, bobViewer()).pendingInputs[0].kind, "groupRestConsent");
});

test("Activity interruption and completion remain event-backed and do not apply completion at start", () => {
  let interrupted = initialize();
  const startedForInterruption = step(interrupted.profiles, interrupted.state, semanticPlan(
    "root:semantic:activity-start-interrupt",
    {
      operation: "startActivity",
      activityRef: "activity:semantic:interruptible",
      duration: { unit: "hour", value: 1 },
      success: [{ kind: "changeResource", resourceRef: "resolve", amount: -1 }],
      failure: [],
    },
  ));
  assert.equal(startedForInterruption.kind, "committed", JSON.stringify(startedForInterruption));
  interrupted = appendAndReplay(interrupted, startedForInterruption);
  assert.equal(interrupted.state.campaignRuntime.activities["activity:semantic:interruptible"].status, "active");
  assert.equal(interrupted.state.entities[ALICE.characterId].resources.resolve, 2);
  const interruption = step(interrupted.profiles, interrupted.state, semanticPlan(
    "root:semantic:activity-interrupt",
    { operation: "interruptActivity", activityRef: "activity:semantic:interruptible" },
  ));
  assert.equal(interruption.kind, "committed", JSON.stringify(interruption));
  interrupted = appendAndReplay(interrupted, interruption);
  assert.equal(interrupted.state.campaignRuntime.activities["activity:semantic:interruptible"].status, "interrupted");
  assert.equal(interrupted.state.entities[ALICE.characterId].resources.resolve, 2);

  let completed = initialize();
  const startedForCompletion = step(completed.profiles, completed.state, semanticPlan(
    "root:semantic:activity-start-complete",
    {
      operation: "startActivity",
      activityRef: "activity:semantic:completable",
      duration: { unit: "hour", value: 1 },
      success: [{ kind: "acquireKnowledge", knowledgeRef: "knowledge:activity-completed" }],
      failure: [],
    },
  ));
  completed = appendAndReplay(completed, startedForCompletion);
  const premature = step(completed.profiles, completed.state, semanticPlan(
    "root:semantic:activity-complete",
    { operation: "completeActivity", activityRef: "activity:semantic:completable" },
  ));
  assert.equal(premature.kind, "rejected", JSON.stringify(premature));
  assert.equal(premature.rejection.code, "missingPrerequisite");
  const elapsed = step(completed.profiles, completed.state, {
    kind: "resolveFreeAction",
    proposalId: "root:semantic:activity-hour-elapsed",
    characterId: ALICE.characterId,
    goal: "完成一小时不受打扰的 Activity",
    method: "持续执行已冻结的方法",
    feasibility: { kind: "directSuccess", publicBasis: "一小时内没有发生中断。" },
    outcome: { fictionTimeCostMicros: "3600000000" },
  });
  assert.equal(elapsed.kind, "committed", JSON.stringify(elapsed));
  completed = appendAndReplay(completed, elapsed);
  const completion = step(completed.profiles, completed.state, semanticPlan(
    "root:semantic:activity-complete-after-time",
    { operation: "completeActivity", activityRef: "activity:semantic:completable" },
  ));
  assert.equal(completion.kind, "committed", JSON.stringify(completion));
  assert.ok(completion.events.some(({ eventType }) => eventType === "KnowledgeAcquired"));
  completed = appendAndReplay(completed, completion);
  assert.equal(completed.state.campaignRuntime.activities["activity:semantic:completable"].status, "completed");
  assert.equal(
    completed.state.knowledge[ALICE.characterId]["knowledge:activity-completed"].content,
    "knowledge:activity-completed",
  );
});

function enemyMaterialization(rootActionId) {
  const enemyId = `enemy:${rootActionId}:sentinel`;
  return {
    enemyId,
    materialization: {
      kind: "enemy",
      factRef: `fact:${rootActionId}:sentinel`,
      causalBasisRefs: [],
      visibilityPolicyRef: "visibility:scene-observers",
      definition: {
        entityId: enemyId,
        entityKind: "npc",
        name: "灰烬哨兵",
        // Start exactly adjacent to both player footprints. The earlier
        // x=48 fixture overlapped Alice and Bob by positive volume, so a
        // swept-volume mover correctly could not leave through that space.
        position: { x: "0", y: "60", elevation: "0" },
        footprint: { width: "60", depth: "60", height: "60" },
        stats: { str: "12", dex: "8", con: "12", int: "8", wis: "10", cha: "8" },
        proficiencyBonus: "2",
        armorClass: "12",
        hitPoints: { current: "12", maximum: "12", temporary: "0" },
        speedInches: { walk: "360" },
        resources: {},
        deathPolicy: "defeatedAtZero",
        abilities: [{
          definitionId: `ability:${rootActionId}:sentinel-club`,
          revision: "1",
          rulesBasis: "srd5.1-2014",
          activation: { kind: "attack", actionGrant: "attack" },
          target: { kind: "creature", count: "1", reachInches: "60", requiresSight: true },
          attack: { ability: "str", proficiency: true },
          damage: [{ type: "bludgeoning", formula: "1d4+1" }],
        }],
      },
    },
  };
}

function startedCombatScenario(suffix) {
  let scenario = initialize();
  const rootActionId = `root:semantic:combat-start:${suffix}`;
  const enemy = enemyMaterialization(rootActionId);
  const encounterId = `encounter:semantic:${suffix}`;
  const request = step(scenario.profiles, scenario.state, semanticPlan(
    rootActionId,
    {
      operation: "startCombat",
      encounterRef: encounterId,
      targetEntityRefs: [enemy.enemyId],
    },
    { dynamicMaterializations: [enemy.materialization] },
  ));
  assert.equal(request.kind, "awaitingRandomness", JSON.stringify(request));
  assert.equal(request.randomnessRequests.length, 2);
  scenario = appendAndReplay(scenario, request);
  const randomnessResults = request.randomnessRequests.map((entry) => ({
    randomnessId: entry.randomnessId,
    requestHash: entry.requestHash,
    draws: entry.dice.map(({ count, sides }) => ({
      sides: Number(sides),
      faces: Array.from({ length: Number(count) }, () => 10),
    })),
  }));
  const fulfilled = step(scenario.profiles, scenario.state, {
    kind: "authoritativeRandomness",
    resolutionId: request.resolutionId,
    continuationCapability: request.continuationCapability,
    responseId: `response:${rootActionId}`,
    randomnessResults,
  });
  assert.equal(fulfilled.kind, "committed", JSON.stringify(fulfilled));
  scenario = appendAndReplay(scenario, fulfilled);
  return { scenario, encounterId, enemyId: enemy.enemyId };
}

test("semantic multiplayer combat start freezes every explicit member as hostile to each target", () => {
  const scenario = initialize();
  const rootActionId = "root:semantic:combat-start:multiplayer-hostility";
  const enemy = enemyMaterialization(rootActionId);
  const request = step(scenario.profiles, scenario.state, semanticPlan(
    rootActionId,
    {
      operation: "startCombat",
      encounterRef: "encounter:semantic:multiplayer-hostility",
      memberRefs: [BOB.characterId],
      targetEntityRefs: [enemy.enemyId],
    },
    { dynamicMaterializations: [enemy.materialization] },
  ));
  assert.equal(request.kind, "awaitingRandomness", JSON.stringify(request));
  const encounterStarted = request.events.find(({ eventType }) => eventType === "EncounterStarted");
  assert.deepEqual(encounterStarted.payload.encounter.hostilities, [
    {
      fromEntityIds: [ALICE.characterId, BOB.characterId],
      toEntityIds: [enemy.enemyId],
    },
    {
      fromEntityIds: [enemy.enemyId],
      toEntityIds: [ALICE.characterId, BOB.characterId],
    },
  ]);
  const replayed = appendAndReplay(scenario, request);
  assert.deepEqual(
    replayed.state.combatRuntime.encounters["encounter:semantic:multiplayer-hostility"].hostilities,
    encounterStarted.payload.encounter.hostilities,
  );
});

test("semantic combat start, movement, action, reaction, and end-turn reuse the combat kernel", () => {
  const movementSetup = startedCombatScenario("movement");
  let movementScenario = movementSetup.scenario;
  const moved = step(movementScenario.profiles, movementScenario.state, semanticPlan(
    "root:semantic:combat-move",
    {
      operation: "moveCombatant",
      encounterRef: movementSetup.encounterId,
      destinationRef: "west",
      destinationFeet: 5,
    },
  ));
  assert.equal(moved.kind, "committed", JSON.stringify(moved));
  assert.ok(moved.events.some(({ eventType }) => eventType === "MovementSegmentCommitted"));
  movementScenario = appendAndReplay(movementScenario, moved);
  const ended = step(movementScenario.profiles, movementScenario.state, semanticPlan(
    "root:semantic:combat-end-turn",
    { operation: "endCombatTurn", encounterRef: movementSetup.encounterId },
  ));
  assert.equal(ended.kind, "committed", JSON.stringify(ended));
  assert.ok(ended.events.some(({ eventType }) => eventType === "TurnEnded"));
  appendAndReplay(movementScenario, ended);

  for (const [operation, field] of [
    ["invokeCombatAction", "abilityRef"],
    ["resolveReaction", "reactionRef"],
  ]) {
    const setup = startedCombatScenario(operation);
    const abilityRef = Object.values(setup.scenario.state.combatRuntime.definitions)
      .find((definition) => definition.mechanicalKey === "improvised-strike"
        && String(definition.definitionId).startsWith(`ability:${ALICE.characterId}:`))
      .definitionId;
    const outcome = step(setup.scenario.profiles, setup.scenario.state, semanticPlan(
      `root:semantic:${operation}`,
      {
        operation,
        [field]: abilityRef,
        targetEntityRef: setup.enemyId,
      },
    ));
    assert.equal(outcome.kind, "awaitingRandomness", `${operation}: ${JSON.stringify(outcome)}`);
    assert.ok(outcome.events.some(({ eventType }) => eventType === "RandomnessRequested"), operation);
    assert.ok(outcome.events.every(({ rootActionId }) => rootActionId === `root:semantic:${operation}`), operation);
  }
});

test("Geometry G01 makes five feet identical to sixty inches and rejects fractional-inch feet", () => {
  const feetSetup = startedCombatScenario("geometry-g01-feet");
  const feet = step(feetSetup.scenario.profiles, feetSetup.scenario.state, semanticPlan(
    "root:semantic:geometry-g01-five-feet",
    {
      operation: "moveCombatant",
      encounterRef: feetSetup.encounterId,
      destinationRef: "west",
      destinationFeet: 5,
    },
  ));
  assert.equal(feet.kind, "committed", JSON.stringify(feet));
  const feetMovement = feet.events.find(({ eventType }) => eventType === "MovementSegmentCommitted");
  assert.equal(feetMovement.payload.distanceMilliInches, "60000");
  assert.deepEqual(feetMovement.payload.path, [
    { x: "0", y: "0", elevation: "0" },
    { x: "-60", y: "0", elevation: "0" },
  ]);

  const inchesSetup = startedCombatScenario("geometry-g01-inches");
  const inches = step(inchesSetup.scenario.profiles, inchesSetup.scenario.state, {
    kind: "moveCombatant",
    rootActionId: "root:combat:geometry-g01-sixty-inches",
    encounterId: inchesSetup.encounterId,
    sourceEntityId: ALICE.characterId,
    movementMode: "walk",
    path: [
      { x: "0", y: "0", elevation: "0" },
      { x: "-60", y: "0", elevation: "0" },
    ],
  });
  assert.equal(inches.kind, "committed", JSON.stringify(inches));
  const inchesMovement = inches.events.find(({ eventType }) => eventType === "MovementSegmentCommitted");
  assert.equal(inchesMovement.payload.distanceMilliInches, feetMovement.payload.distanceMilliInches);
  assert.deepEqual(inchesMovement.payload.path, feetMovement.payload.path);

  const fractionalSetup = startedCombatScenario("geometry-g01-fractional-inch");
  const fractional = step(
    fractionalSetup.scenario.profiles,
    fractionalSetup.scenario.state,
    semanticPlan(
      "root:semantic:geometry-g01-fractional-inch",
      {
        operation: "moveCombatant",
        encounterRef: fractionalSetup.encounterId,
        destinationRef: "west",
        destinationFeet: 1 / 24,
      },
    ),
  );
  assert.equal(fractional.kind, "rejected", JSON.stringify(fractional));
  assert.equal(fractional.rejection.code, "invalidRulesInput");
  assert.deepEqual(fractional.events, []);
});

test("a finite-knowledge NPC mechanical action can follow a player effect in the same Root Action and wait for that player's reaction", () => {
  let scenario = initialize();
  const startRoot = "root:semantic:npc-combat-start";
  const enemy = enemyMaterialization(startRoot);
  enemy.enemyId = WARDEN_ID;
  enemy.materialization.definition.entityId = WARDEN_ID;
  enemy.materialization.definition.name = "守灵人";
  const encounterId = "encounter:semantic:npc-response";
  const opening = step(scenario.profiles, scenario.state, semanticPlan(
    startRoot,
    {
      operation: "startCombat",
      encounterRef: encounterId,
      targetEntityRefs: [WARDEN_ID],
    },
    { dynamicMaterializations: [enemy.materialization] },
  ));
  assert.equal(opening.kind, "awaitingRandomness", JSON.stringify(opening));
  scenario = appendAndReplay(scenario, opening);
  const openingRandomness = step(scenario.profiles, scenario.state, {
    kind: "authoritativeRandomness",
    resolutionId: opening.resolutionId,
    continuationCapability: opening.continuationCapability,
    responseId: "response:semantic:npc-combat-start",
    randomnessResults: opening.randomnessRequests.map((entry) => ({
      randomnessId: entry.randomnessId,
      requestHash: entry.requestHash,
      draws: entry.dice.map(({ count, sides }) => ({
        sides: Number(sides),
        faces: Array.from({ length: Number(count) }, () => 10),
      })),
    })),
  });
  assert.equal(openingRandomness.kind, "committed", JSON.stringify(openingRandomness));
  scenario = appendAndReplay(scenario, openingRandomness);

  const aliceEnds = step(scenario.profiles, scenario.state, semanticPlan(
    "root:semantic:npc-combat-alice-ends",
    { operation: "endCombatTurn", encounterRef: encounterId },
  ));
  assert.equal(aliceEnds.kind, "committed", JSON.stringify(aliceEnds));
  scenario = appendAndReplay(scenario, aliceEnds);
  assert.ok(
    scenario.state.knowledge[WARDEN_ID]?.[WARDEN_KNOWLEDGE],
    JSON.stringify(scenario.state.knowledge[WARDEN_ID]),
  );

  const compoundRoot = "root:semantic:npc-moves-and-player-gains";
  const npcResponse = step(scenario.profiles, scenario.state, semanticPlan(
    compoundRoot,
    { operation: "changeResource", resourceRef: "resolve", amount: 1 },
    {
      npcActions: [{
        npcId: WARDEN_ID,
        goal: "离开阿莱莎的威胁范围",
        method: "向东移动十尺",
        knowledgeRefs: [WARDEN_KNOWLEDGE],
        mechanicalProposal: {
          operation: "moveCombatant",
          encounterRef: encounterId,
          destinationRef: "east",
          destinationFeet: 10,
        },
      }],
    },
  ));
  assert.equal(npcResponse.kind, "awaitingInput", JSON.stringify(npcResponse));
  assert.ok(npcResponse.events.every(({ rootActionId }) => rootActionId === compoundRoot));
  assert.ok(npcResponse.events.some(({ eventType }) => eventType === "ResourceChanged"));
  assert.ok(npcResponse.events.some(({ eventType }) => eventType === "ReactionOffered"));
  assert.equal(npcResponse.pending.controllerEntityId, ALICE.characterId);
  scenario = appendAndReplay(scenario, npcResponse);
  assert.equal(scenario.state.entities[ALICE.characterId].resources.resolve, 3);

  const declined = step(scenario.profiles, scenario.state, {
    kind: "answerPendingInput",
    pendingInputId: npcResponse.pending.pendingInputId,
    responseId: "response:semantic:alice-declines-reaction",
    answer: { kind: "decline" },
  });
  assert.equal(declined.kind, "committed", JSON.stringify(declined));
  assert.ok(declined.events.some(({ eventType }) => eventType === "MovementSegmentCommitted"));
  appendAndReplay(scenario, declined);
});
