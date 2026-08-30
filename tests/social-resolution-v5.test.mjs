import assert from "node:assert/strict";
import test from "node:test";

import {
  compileKpFormDraft,
  lowerCausalActionProgram,
} from "../app/_runtime/lib/kp/causal-action-program.ts";
import {
  authoritativeModuleProfile,
  moduleAuthorityFactSeeds,
} from "../app/_runtime/lib/module/authoritative.ts";
import { normalizeRoomKpProposal } from "../app/_runtime/lib/room/proposal-adapter.ts";
import { replay, step } from "../app/_runtime/lib/rules/index.ts";
import {
  ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
} from "../app/_runtime/lib/rules/profiles/manifests.ts";
import {
  DYNAMIC_NPC_DEFAULT_SOCIAL_ARCHETYPE_REF,
  DYNAMIC_NPC_SOCIAL_ARCHETYPES,
} from "../app/_runtime/lib/rules/profiles/social-resolution.ts";
import { socialRelationshipId } from "../app/_runtime/lib/rules/v2/social-model.ts";

const ACTOR = "character:social-v5:alice";
const PRINCIPAL = "principal:social-v5:alice";
const SEAT = "seat:social-v5:alice";
const SCENE = "scene:social-v5:threshold";

function privateEnvelope(formId, draft, requestId) {
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
    modelInvocationReceipt: { provider: "test", requestId },
  };
}

function causalInput(formId, draft, rootActionId, trustedUtterance) {
  const normalized = normalizeRoomKpProposal(
    privateEnvelope(formId, draft, `request:${rootActionId}`),
  );
  assert.ok(normalized, `proposal ${rootActionId} must normalize`);
  return {
    ...normalized,
    rootActionId,
    actorCharacterId: ACTOR,
    ...(trustedUtterance === undefined ? {} : { trustedUtterance }),
  };
}

async function initialize(suffix) {
  const moduleProfile = await authoritativeModuleProfile(
    "black-oak-will",
    "social-resolution-v1",
  );
  const initialized = step(ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: `room:social-v5:${suffix}`,
    runtimeEpochId: `epoch:social-v5:${suffix}:1`,
    moduleRef: moduleProfile.moduleRef,
    initialDefinitionCatalogRef: {
      profileId: `definitions:social-v5:${suffix}`,
      profileHash: `sha256:${"b".repeat(64)}`,
    },
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [
      { id: SCENE, name: "门槛厅" },
      { id: "scene:social-v5:annex", name: "侧厅" },
    ],
    principals: [{ id: PRINCIPAL, sessionVersion: 1, role: "host" }],
    seats: [{ id: SEAT, principalId: PRINCIPAL, status: "active" }],
    characters: [{
      id: ACTOR,
      kind: "player",
      name: "阿莱莎",
      sceneId: SCENE,
      tenureStatus: "active",
      classId: "bard",
      level: 3,
      abilityScores: { str: 10, dex: 12, con: 12, int: 12, wis: 10, cha: 16 },
      proficiencyBonus: 2,
      proficientSkills: ["deception", "persuasion"],
      expertiseSkills: ["persuasion"],
      resources: {},
      resourceMaximums: {},
      hitPoints: { current: 18, maximum: 18 },
      loadout: { armorClass: 13, speedFeet: 30, equipped: {}, backpack: [] },
      characterBuild: { classId: "bard", raceId: "human", cantrips: [], prepared: [] },
    }],
    characterControls: [{ characterId: ACTOR, seatId: SEAT }],
    canonicalFacts: moduleAuthorityFactSeeds(moduleProfile).map((fact) =>
      structuredClone(fact)),
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const rebuilt = replay(initialized.genesis, []);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  return {
    genesis: initialized.genesis,
    profiles: initialized.profiles,
    state: rebuilt.state,
    events: [],
    catalog: moduleProfile.storyBible.premiseCatalog,
  };
}

function appendAndReplay(room, outcome) {
  assert.notEqual(outcome.kind, "rejected", JSON.stringify(outcome));
  assert.notEqual(outcome.kind, "initialized", JSON.stringify(outcome));
  const events = [...room.events, ...outcome.events];
  const rebuilt = replay(room.genesis, events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  return { ...room, events, state: rebuilt.state };
}

function premiseDraft(catalog, personAlias, taskAlias) {
  const policy = catalog.policies.find((candidate) =>
    candidate.predicate === "arrivalPurpose");
  const person = catalog.archetypes.find((candidate) =>
    candidate.semanticCategory === "localProfessional");
  const task = catalog.archetypes.find((candidate) =>
    candidate.semanticCategory === "investigation");
  assert.ok(policy && person && task);
  return {
    policy,
    person,
    task,
    draft: {
      goal: "回答角色抵达此地的外部来由",
      method: "establishCharacterPremise",
      proposedFact: JSON.stringify({
        schema: "zhuwei.character-premise-draft/v2",
        policyRef: policy.policyRef,
        predicate: policy.predicate,
        anchorRefs: [catalog.anchorRefs[0]],
        bindings: [{
          slotRef: "requester",
          referenceKind: "openArchetype",
          archetypeRef: person.archetypeRef,
          displayAlias: personAlias,
        }, {
          slotRef: "objective",
          referenceKind: "openArchetype",
          archetypeRef: task.archetypeRef,
          displayAlias: taskAlias,
        }],
      }),
      basisRefs: [
        policy.policyRef,
        catalog.anchorRefs[0],
        person.archetypeRef,
        task.archetypeRef,
      ],
      resolution: "direct",
      durationUnit: "minute",
      durationValue: 1,
    },
  };
}

async function establishAndMaterializePremiseNpc(suffix, personAlias, taskAlias) {
  let room = await initialize(suffix);
  const premise = premiseDraft(room.catalog, personAlias, taskAlias);
  const established = step(
    room.profiles,
    room.state,
    causalInput(
      "materialization.v1",
      premise.draft,
      `root:social-v5:${suffix}:premise`,
    ),
  );
  assert.equal(established.kind, "committed", JSON.stringify(established));
  room = appendAndReplay(room, established);

  const premiseFact = Object.values(room.state.canonicalFacts).find((fact) =>
    fact.kind === "characterPremise"
    && fact.subjectRefs.includes(ACTOR)
    && fact.value?.predicate === "arrivalPurpose");
  assert.ok(premiseFact);
  const personBinding = premiseFact.value.bindings.find((binding) =>
    binding.slotRef === "requester");
  const taskBinding = premiseFact.value.bindings.find((binding) =>
    binding.slotRef === "objective");
  assert.ok(personBinding && taskBinding);
  const assertionFact = Object.values(room.state.canonicalFacts).find((fact) =>
    fact.kind === "typedAssertionFact"
    && fact.value?.sourcePremiseFactRef === premiseFact.id
    && fact.value?.assertion?.object?.ref === personBinding.entityRef);
  const grantFact = Object.values(room.state.canonicalFacts).find((fact) =>
    fact.kind === "dynamicEntityKnowledgeGrant"
    && fact.value?.recipientEntityRef === personBinding.entityRef);
  assert.ok(assertionFact && grantFact);

  const sourceFactRefs = [premiseFact.id, grantFact.id];
  const materialized = step(
    room.profiles,
    room.state,
    causalInput("materialization.v1", {
      goal: "让此前定义的人物进入当前场景",
      method: "materializeDynamicNpc",
      proposedFact: JSON.stringify({
        schema: "zhuwei.dynamic-npc-materialization-draft/v2",
        definitionRef: personBinding.entityRef,
        entityRef: personBinding.entityRef,
        sourceFactRefs,
        initialKnowledgeFactRefs: [grantFact.id],
        sceneRef: SCENE,
      }),
      basisRefs: [...new Set([personBinding.entityRef, SCENE, ...sourceFactRefs])],
      resolution: "direct",
      durationUnit: "minute",
      durationValue: 1,
    }, `root:social-v5:${suffix}:materialize`),
  );
  assert.equal(materialized.kind, "committed", JSON.stringify(materialized));
  room = appendAndReplay(room, materialized);
  return {
    room,
    premise,
    premiseFact,
    personBinding,
    taskBinding,
    assertionFact,
    grantFact,
  };
}

function legacyDirectPlan(rootActionId, dynamicMaterializations, success = []) {
  return {
    kind: "resolveCompoundActionPlan",
    actionPlanVersion: "authoritative-kp-action-plan-v1",
    rootActionId,
    actorCharacterId: ACTOR,
    feasibilityKind: "directSuccess",
    goal: "固化当前因果允许的动态世界内容",
    method: "沿既有通用动态定义协议登记",
    risk: null,
    dynamicMaterializations,
    npcActions: [],
    scene: {
      question: "这些动态定义将如何进入后续场景？",
      pressure: "",
      opportunities: [],
      conclusionCandidate: null,
    },
    mechanicalProposal: {
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success,
      failure: [],
    },
  };
}

function socialDraft({
  npcRef,
  utterance,
  influenceGoal = "beBelieved",
  addressedThreadRef = null,
  evidenceRefs = [],
  assertion,
  resolution = "check",
  method = "清楚说明可由对方核对的来由",
  reaction = "acknowledge",
}) {
  return {
    goal: influenceGoal === "deemphasize"
      ? "让对方不再紧抓旧身份主张"
      : "让对方暂时相信这项来由",
    method,
    utterance,
    desiredResponse: JSON.stringify({
      schema: "zhuwei.social-intent-draft/v1",
      npcRef,
      influenceGoal,
      desiredBehavior: influenceGoal === "deemphasize"
        ? "不再追问旧身份主张，转回眼前事务"
        : "暂时按玩家陈述的来由采取行动",
      addressedThreadRef,
      evidenceRefs,
      assertion,
    }),
    npcResponse: JSON.stringify({
      schema: "zhuwei.npc-response-draft/v1",
      mode: "reaction",
      reaction,
    }),
    basisRefs: [...new Set([
      npcRef,
      ...(addressedThreadRef === null ? [] : [addressedThreadRef]),
      ...evidenceRefs,
    ])],
    resolution,
    durationUnit: "minute",
    durationValue: 1,
    ...(resolution === "direct" ? {} : {
      risk: "失败可能强化当前怀疑，但不会把主张变成事实。",
      ability: "cha",
      skill: "persuasion",
      dc: 15,
      mode: "normal",
      successConsequence: "对方按差值作出有限至充分回应。",
      failureConsequence: "对方维持或强化当前怀疑。",
    }),
  };
}

test("typed character premises create arbitrary generic definitions and materialize NPCs without keyword routing", async () => {
  const variants = [
    ["折光记录员", "第七码簿"],
    ["潮汐测绘师", "北岸缺页"],
  ];
  for (const [index, [personAlias, taskAlias]] of variants.entries()) {
    const result = await establishAndMaterializePremiseNpc(
      `generic-${index + 1}`,
      personAlias,
      taskAlias,
    );
    const { room, premise, premiseFact, personBinding, taskBinding, assertionFact } = result;
    assert.equal(room.state.campaignRuntime.definitions[personBinding.entityRef].definitionKind, "npc");
    assert.equal(room.state.campaignRuntime.definitions[personBinding.entityRef].content.name, personAlias);
    assert.equal(room.state.campaignRuntime.definitions[taskBinding.entityRef].definitionKind, "opportunity");
    assert.equal(room.state.campaignRuntime.definitions[taskBinding.entityRef].content.displayAlias, taskAlias);
    assert.equal(room.state.entities[personBinding.entityRef].name, personAlias);
    assert.deepEqual(
      room.state.entities[personBinding.entityRef].socialMechanics,
      DYNAMIC_NPC_SOCIAL_ARCHETYPES[premise.person.socialArchetypeRef],
    );
    assert.equal(
      room.state.knowledge[personBinding.entityRef][assertionFact.id].content.relationKind,
      "requestedBy",
    );
    assert.equal(room.state.knowledge[personBinding.entityRef][premiseFact.id], undefined);
    assert.equal(premiseFact.value.schema, "zhuwei.character-premise/v2");
    assert.equal("statement" in premiseFact.value, false);
    assert.equal("role" in premiseFact.value, false);
  }
});

test("pre-existing generic dynamic:npc and opportunity definitions remain the shared branch protocol", async () => {
  let room = await initialize("existing-generic");
  const npcRef = "dynamic:social-v5:amber-indexer";
  const opportunityRef = "dynamic:social-v5:quiet-ledger";
  const registered = step(room.profiles, room.state, legacyDirectPlan(
    "root:social-v5:existing-generic:register",
    [{
      kind: "npc",
      factRef: npcRef,
      causalBasisRefs: [],
      visibilityPolicyRef: "visibility:scene-observers",
      definition: { name: "琥珀索引者", description: "在门槛厅等待核对一份旧索引。" },
    }, {
      kind: "opportunity",
      factRef: opportunityRef,
      causalBasisRefs: [],
      visibilityPolicyRef: "visibility:scene-observers",
      definition: { name: "静默账页", description: "一项可以继续追查的账页缺口。" },
    }],
  ));
  assert.equal(registered.kind, "committed", JSON.stringify(registered));
  room = appendAndReplay(room, registered);
  assert.equal(room.state.campaignRuntime.definitions[npcRef].definitionKind, "npc");
  assert.equal(room.state.campaignRuntime.definitions[opportunityRef].definitionKind, "opportunity");
  assert.equal(room.state.canonicalFacts[npcRef].kind, "dynamic:npc");
  assert.equal(room.state.canonicalFacts[opportunityRef].kind, "dynamic:opportunity");

  const activation = step(room.profiles, room.state, causalInput("materialization.v1", {
    goal: "让已登记人物进入当前场景",
    method: "materializeDynamicNpc",
    proposedFact: JSON.stringify({
      schema: "zhuwei.dynamic-npc-materialization-draft/v2",
      definitionRef: npcRef,
      entityRef: npcRef,
      sourceFactRefs: [npcRef],
      initialKnowledgeFactRefs: [],
      sceneRef: SCENE,
    }),
    basisRefs: [npcRef, SCENE],
    resolution: "direct",
    durationUnit: "minute",
    durationValue: 1,
  }, "root:social-v5:existing-generic:activate"));
  assert.equal(activation.kind, "committed", JSON.stringify(activation));
  room = appendAndReplay(room, activation);
  assert.equal(room.state.entities[npcRef].name, "琥珀索引者");
  assert.deepEqual(
    room.state.entities[npcRef].socialMechanics,
    DYNAMIC_NPC_SOCIAL_ARCHETYPES[DYNAMIC_NPC_DEFAULT_SOCIAL_ARCHETYPE_REF],
  );
  assert.equal(room.state.knowledge[npcRef][npcRef], undefined);
});

test("social boundaries combine NPC mechanics, relationship, evidence and the roll margin", async () => {
  const setup = await establishAndMaterializePremiseNpc(
    "boundary",
    "镜面校订者",
    "无声页码",
  );
  let room = setup.room;
  const npcRef = setup.personBinding.entityRef;
  const assertion = structuredClone(setup.assertionFact.value.assertion);
  const common = {
    npcRef,
    utterance: "你此前请我核对这份记录。",
    assertion,
  };
  const baseline = step(room.profiles, room.state, causalInput(
    "npc-exchange.v1",
    socialDraft(common),
    "root:social-v5:boundary:baseline",
    common.utterance,
  ));
  assert.equal(baseline.kind, "awaitingInput", JSON.stringify(baseline));
  assert.equal(baseline.events.some((event) => event.eventType === "RandomnessRequested"), false);
  const baselinePlan = baseline.events.find((event) =>
    event.eventType === "SocialResolutionOffered").payload.plan;
  assert.equal(baselinePlan.frozenBoundary.npcInsightModifier, 3);
  assert.equal(baselinePlan.frozenBoundary.relationshipModifier, 0);
  assert.equal(baselinePlan.frozenBoundary.evidenceModifier, 0);
  assert.equal(baselinePlan.frozenBoundary.stakesModifier, 3);

  const relationshipRef = socialRelationshipId(ACTOR, npcRef);
  const relationFactRef = "fact:social-v5:boundary:prior-cooperation";
  const relationship = step(room.profiles, room.state, legacyDirectPlan(
    "root:social-v5:boundary:relationship",
    [{
      kind: "fact",
      factRef: relationFactRef,
      causalBasisRefs: [],
      visibilityPolicyRef: "visibility:scene-observers",
      definition: { name: "此前的可靠合作" },
    }],
    [{
      kind: "updateRelationship",
      relationshipRef,
      recipientRefs: [npcRef],
      value: "socialTrust:2",
      definitionRef: relationFactRef,
    }],
  ));
  assert.equal(relationship.kind, "committed", JSON.stringify(relationship));
  room = appendAndReplay(room, relationship);

  const related = step(room.profiles, room.state, causalInput(
    "npc-exchange.v1",
    socialDraft(common),
    "root:social-v5:boundary:related",
    common.utterance,
  ));
  assert.equal(related.kind, "awaitingInput", JSON.stringify(related));
  const relatedPlan = related.events.find((event) =>
    event.eventType === "SocialResolutionOffered").payload.plan;
  assert.equal(relatedPlan.frozenBoundary.relationshipModifier, -4);
  assert.equal(
    related.mechanicalResult.boundary,
    baseline.mechanicalResult.boundary - 4,
  );

  const evidencedDraft = socialDraft({
    ...common,
    evidenceRefs: [setup.assertionFact.id],
  });
  const evidenced = step(room.profiles, room.state, causalInput(
    "npc-exchange.v1",
    evidencedDraft,
    "root:social-v5:boundary:evidenced",
    common.utterance,
  ));
  assert.equal(evidenced.kind, "awaitingInput", JSON.stringify(evidenced));
  const evidencedPlan = evidenced.events.find((event) =>
    event.eventType === "SocialResolutionOffered").payload.plan;
  assert.equal(evidencedPlan.frozenBoundary.evidenceModifier, -2);
  assert.equal(
    evidenced.mechanicalResult.boundary,
    related.mechanicalResult.boundary - 2,
  );
  room = appendAndReplay(room, evidenced);

  const pressed = step(room.profiles, room.state, {
    kind: "answerSocialResolution",
    rootActionId: evidenced.receipt.rootActionId,
    pendingInputId: evidenced.pending.pendingInputId,
    controllerCharacterId: ACTOR,
    choice: "press",
  });
  assert.equal(pressed.kind, "awaitingRandomness", JSON.stringify(pressed));
  room = appendAndReplay(room, pressed);
  const resolved = step(room.profiles, room.state, {
    kind: "fulfillAuthoritativeRandomness",
    continuation: pressed.continuation,
    rolls: [20],
  });
  assert.equal(resolved.kind, "committed", JSON.stringify(resolved));
  assert.equal(resolved.mechanicalResult.marginDegree, "strongSuccess");
  assert.equal(resolved.mechanicalResult.degree, "fullSuccess");
  assert.equal(resolved.mechanicalResult.relationshipBefore, 2);
  assert.equal(resolved.mechanicalResult.relationshipDelta, 1);
  const npcClaim = resolved.events.find((event) =>
    event.eventType === "SourceClaimCreated"
    && event.payload.speakerId === npcRef);
  assert.equal(npcClaim.payload.semanticContent, "我愿意先按你的说法采取有限行动。");
  room = appendAndReplay(room, resolved);
  assert.equal(
    Object.values(room.state.canonicalFacts).some((fact) =>
      JSON.stringify(fact.value).includes(common.utterance)),
    false,
  );
});

test("a player can accept the status quo or reframe before any social roll", async () => {
  const setup = await establishAndMaterializePremiseNpc(
    "reframe",
    "雨线誊录人",
    "空白航标",
  );
  const npcRef = setup.personBinding.entityRef;
  const claimedIdentity = {
    subjectRef: ACTOR,
    predicate: "affiliatedWith",
    polarity: "affirm",
    object: { referenceKind: "unresolvedLabel", label: "雾潮巡回庭" },
  };
  const originalUtterance = "我是雾潮巡回庭派来的。";
  const originalDraft = socialDraft({
    npcRef,
    utterance: originalUtterance,
    assertion: claimedIdentity,
    method: "仅凭口头自述身份",
  });

  let statusRoom = setup.room;
  const statusOffer = step(statusRoom.profiles, statusRoom.state, causalInput(
    "npc-exchange.v1",
    originalDraft,
    "root:social-v5:status-quo",
    originalUtterance,
  ));
  assert.equal(statusOffer.kind, "awaitingInput", JSON.stringify(statusOffer));
  statusRoom = appendAndReplay(statusRoom, statusOffer);
  const accepted = step(statusRoom.profiles, statusRoom.state, {
    kind: "answerSocialResolution",
    rootActionId: statusOffer.receipt.rootActionId,
    pendingInputId: statusOffer.pending.pendingInputId,
    controllerCharacterId: ACTOR,
    choice: "acceptStatusQuo",
  });
  assert.equal(accepted.kind, "committed", JSON.stringify(accepted));
  assert.equal(accepted.events.some((event) => event.eventType === "RandomnessRequested"), false);
  assert.equal(accepted.mechanicalResult.disposition, "active");

  let reframeRoom = setup.room;
  const reframeRoot = "root:social-v5:reframe";
  const reframeOffer = step(reframeRoom.profiles, reframeRoom.state, causalInput(
    "npc-exchange.v1",
    originalDraft,
    reframeRoot,
    originalUtterance,
  ));
  assert.equal(reframeOffer.kind, "awaitingInput", JSON.stringify(reframeOffer));
  reframeRoom = appendAndReplay(reframeRoom, reframeOffer);
  const oldThreadRef = reframeOffer.mechanicalResult.threadRef;
  const newUtterance = "这个称号不重要，我今天是来协助眼前事务的。";
  const replacement = causalInput("npc-exchange.v1", socialDraft({
    npcRef,
    utterance: newUtterance,
    influenceGoal: "deemphasize",
    addressedThreadRef: oldThreadRef,
    assertion: null,
    resolution: "direct",
    method: "放下身份争议并转回当前事务",
    reaction: "redirect",
  }), reframeRoot, newUtterance);
  const reframed = step(reframeRoom.profiles, reframeRoom.state, {
    kind: "answerPendingInput",
    rootActionId: reframeRoot,
    pendingInputId: reframeOffer.pending.pendingInputId,
    controllerCharacterId: ACTOR,
    answer: { text: newUtterance },
    proposal: replacement,
  });
  assert.equal(reframed.kind, "committed", JSON.stringify(reframed));
  assert.equal(reframed.events.some((event) => event.eventType === "RandomnessRequested"), false);
  assert.ok(reframed.events.some((event) =>
    event.eventType === "SocialResolutionDeclined"
    && event.payload.reason === "reframed"));
  reframeRoom = appendAndReplay(reframeRoom, reframed);
  assert.equal(reframeRoom.state.pendingInputs[reframeOffer.pending.pendingInputId], undefined);
  assert.equal(
    reframeRoom.state.campaignRuntime.conversationThreads[oldThreadRef].status,
    "deemphasized",
  );
  assert.equal(
    reframeRoom.state.campaignRuntime.sourceClaims[reframeOffer.mechanicalResult.claimRef]
      .semanticContent,
    originalUtterance,
  );
});
