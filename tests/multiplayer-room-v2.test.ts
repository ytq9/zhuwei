import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

type RecordValue = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:multi:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:multi:bob", sessionVersion: 1 }),
});
const CHARLIE = Object.freeze({
  principal: Object.freeze({ id: "principal:multi:charlie", sessionVersion: 1 }),
});

type RoomAdministrationCapability = unknown;

type MultiplayerAuthority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  applyRoomAdministration(capability: RoomAdministrationCapability, command: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
};

type Initialized = {
  stub: MultiplayerAuthority;
  administration: RoomAdministrationCapability;
};

function record(value: unknown, label: string): RecordValue {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as RecordValue;
}

function list(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), label).toBe(true);
  return value as unknown[];
}

function room(name: string): MultiplayerAuthority {
  return env.ROOMS.getByName(name) as unknown as MultiplayerAuthority;
}

function character(
  id: string,
  principalId: string,
  sceneId: "shrine" | "yard" | "cellar" = "shrine",
) {
  return {
    characterId: id,
    controllerPrincipalId: principalId,
    staticCard: {
      name: id,
      sceneId,
      abilityScores: { str: 12, dex: 12, con: 12, int: 12, wis: 12, cha: 12 },
      proficiencyBonus: 2,
      proficientSkills: [],
      resources: { resolve: 1 },
    },
  };
}

function campaignCharacter(id: string, principalId: string, currentHitPoints = 7) {
  return {
    characterId: id,
    controllerPrincipalId: principalId,
    staticCard: {
      name: id,
      sceneId: "shrine",
      classId: "rogue",
      raceId: "human",
      subclassId: "thief",
      level: 3,
      scores: { str: 10, dex: 16, con: 12, int: 12, wis: 12, cha: 10 },
      proficiency: 2,
      skills: ["stealth"],
      cantrips: [],
      prepared: [],
      features: ["feature:cunning-action", "feature:sneak-attack"],
      hp: { current: currentHitPoints, max: 18, temp: 0 },
      ac: 14,
      speed: 30,
      resources: {
        hitDice: { max: 3, used: 1 },
        resolve: 1,
      },
    },
  };
}

function wizardCampaignCharacter(id: string, principalId: string) {
  return {
    characterId: id,
    controllerPrincipalId: principalId,
    staticCard: {
      name: id,
      sceneId: "shrine",
      classId: "wizard",
      raceId: "human",
      subclassId: "school-of-evocation",
      level: 9,
      scores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
      proficiency: 4,
      skills: ["arcana"],
      cantrips: ["fire-bolt"],
      prepared: ["magic-missile"],
      features: ["feature:arcane-recovery"],
      hp: { current: 32, max: 38, temp: 0 },
      ac: 13,
      speed: 30,
      resources: {
        hitDice: { max: 9, used: 0 },
        arcaneRecovery: { max: 1, used: 0 },
        slot1: { max: 4, used: 2 },
        slot2: { max: 3, used: 0 },
        slot3: { max: 3, used: 1 },
        resolve: 1,
      },
    },
  };
}

async function initialize(
  name: string,
  input: {
    members: Array<{ principalId: string; role: "host" | "player" | "observer" }>;
    characters: ReturnType<typeof character>[];
  },
): Promise<Initialized> {
  const stub = room(name);
  const initialized = record(await stub.initializeAuthoritative({
    roomId: name,
    moduleId: "black-oak-will",
    moduleVersion: "legacy-anchor-v1",
    members: input.members,
    characters: input.characters,
  }), "multiplayer initialization");
  expect(initialized).toMatchObject({ created: true });
  const capabilities = record(initialized.serviceCapabilities, "service capabilities");
  expect(capabilities.roomAdministration).toBeDefined();
  return { stub, administration: capabilities.roomAdministration };
}

function readModel(value: unknown): RecordValue {
  return record(record(value, "observation").readModel, "read model");
}

function prepared(value: unknown): RecordValue & {
  preparedActionId: string;
  rootActionId: string;
} {
  const result = record(value, "prepare outcome");
  expect(result).toMatchObject({
    kind: "prepared",
    preparedActionId: expect.any(String),
    rootActionId: expect.any(String),
  });
  return result as RecordValue & { preparedActionId: string; rootActionId: string };
}

function kpProposal(
  rootActionId: string,
  attemptId: string,
  mechanicalProposal: RecordValue,
) {
  return {
    kind: "directSuccess",
    rootActionId,
    proposalAttemptId: attemptId,
    goal: "执行玩家明确声明的多人行动。",
    method: "按控制权与当前位置执行。",
    publicBasisRefs: [],
    privateBasisRefs: [],
    risk: {
      warning: "本次行动只提交已声明的结构变化。",
      successConsequences: [],
      failureConsequences: [],
      retryGate: [],
    },
    pendingInput: null,
    dynamicMaterializations: [],
    npcActions: [],
    mechanicalProposal: structuredClone(mechanicalProposal),
    scene: {
      question: "多人状态改变后，各角色接下来怎么做？",
      pressure: "局势会继续推进，玩家仍保有下一项决定。",
      opportunities: [],
      conclusionCandidate: null,
    },
  };
}

async function commitIntent(
  stub: MultiplayerAuthority,
  context: typeof ALICE | typeof BOB | typeof CHARLIE,
  submissionId: string,
  characterId: string,
  text: string,
  mechanicalProposal: RecordValue,
) {
  const action = prepared(await stub.prepare(context, {
    kind: "intent",
    submissionId,
    characterId,
    text,
  }));
  return record(await stub.commit(
    context,
    action.preparedActionId,
    kpProposal(action.rootActionId, `${submissionId}:proposal:1`, mechanicalProposal),
  ), "multiplayer commit");
}

async function answerPending(
  stub: MultiplayerAuthority,
  context: typeof ALICE | typeof BOB | typeof CHARLIE,
  submissionId: string,
  pendingInputId: string,
  answer: unknown,
) {
  const action = prepared(await stub.prepare(context, {
    kind: "answer",
    submissionId,
    pendingInputId,
    answer,
  }));
  expect(action.resolutionMode).toBe("authorityDirect");
  return record(await stub.commit(
    context,
    action.preparedActionId,
    { kind: "authenticatedPendingAnswer", rootActionId: action.rootActionId },
  ), "pending answer commit");
}

describe("authoritative multiplayer room, group, time, and spotlight", () => {
  it("freezes a personal wizard's canonical multi-slot Arcane Recovery choice", async () => {
    const characterId = "character:multi:personal-arcane-recovery";
    const initialized = await initialize("multiplayer-v2-personal-arcane-recovery", {
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [wizardCampaignCharacter(characterId, ALICE.principal.id)],
    });

    const started = await commitIntent(
      initialized.stub,
      ALICE,
      "submission:personal-arcane-recovery:start",
      "forged:actor-is-ignored",
      "我短休一小时，并明确用奥术恢复取回两个一环和一个三环法术位。",
      {
        operation: "resolveRest",
        restKind: "short",
        hitDiceToSpend: 0,
        arcaneRecoverySlotLevels: [3, 1, 1],
      },
    );
    expect(started.kind, JSON.stringify(started)).toBe("committed");

    const observed = readModel(await initialized.stub.observe(ALICE));
    expect(list(observed.activities, "personal rest activities")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        characterId,
        restKind: "short",
        recoveryChoice: {
          hitDiceToSpend: 0,
          arcaneRecoverySlotLevels: [1, 1, 3],
        },
        status: "active",
      }),
    ]));
  });

  it("owns short-rest hit-die faces and commits recovery only after fictional time", async () => {
    const characterId = "character:multi:resting-fighter";
    const base = campaignCharacter(characterId, ALICE.principal.id, 4);
    const initialized = await initialize("multiplayer-v2-authoritative-rest", {
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [{
        ...base,
        staticCard: {
          ...base.staticCard,
          classId: "fighter",
          subclassId: "champion",
          scores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
          hp: { current: 4, max: 20, temp: 0 },
          resources: {
            hitDice: { max: 3, used: 1 },
            surge: { max: 1, used: 1 },
            slot1: { max: 2, used: 2 },
            resolve: 1,
          },
        },
      }],
    });

    const started = await commitIntent(
      initialized.stub,
      ALICE,
      "submission:rest:start",
      "forged:actor-is-ignored",
      "我安静休息一小时，并明确花一枚生命骰疗伤。",
      {
        operation: "resolveRest",
        restKind: "short",
        hitDiceToSpend: 1,
        arcaneRecoverySlotLevels: [],
      },
    );
    expect(started.kind, JSON.stringify(started)).toBe("committed");
    const startRoot = String(record(started.receipt, "rest start receipt").rootActionId);
    const activityId = `activity:${startRoot}`;

    const premature = await commitIntent(
      initialized.stub,
      ALICE,
      "submission:rest:premature",
      characterId,
      "这一小时还没过去，现在就结算休整。",
      { operation: "completeActivity", activityRef: activityId },
    );
    expect(premature).toMatchObject({ kind: "rejected", code: "missingPrerequisite" });

    const passage = prepared(await initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:rest:time-passage",
      characterId,
      text: "保持休息，直到完整一小时过去。",
    }));
    const elapsed = record(await initialized.stub.commit(ALICE, passage.preparedActionId, {
      ...kpProposal(
        passage.rootActionId,
        "proposal:rest:time-passage",
        {
          operation: "resolveDirectConsequences",
          duration: { unit: "hour", value: 1 },
          frozenCosts: [],
          success: [],
          failure: [],
        },
      ),
      goal: "完成不受打扰的一小时短休。",
      method: "在安全处包扎并补水。",
    }), "fictional rest time");
    expect(elapsed.kind, JSON.stringify(elapsed)).toBe("committed");

    const completed = await commitIntent(
      initialized.stub,
      ALICE,
      "submission:rest:complete",
      characterId,
      "一小时已经过去，现在结算我明确选择的一枚生命骰。",
      { operation: "completeActivity", activityRef: activityId },
    );
    expect(completed.kind, JSON.stringify(completed)).toBe("committed");
    const commitments = list(
      record(completed.receipt, "rest completion receipt").randomnessCommitments,
      "rest randomness commitments",
    );
    expect(commitments).toHaveLength(1);
    const restDraw = record(commitments[0], "rest draw");
    expect(restDraw).not.toHaveProperty("faces");
    const mechanical = record(
      record(completed.kpProjection, "rest KP projection").mechanicalResult,
      "rest mechanical result",
    );
    const randomDraws = list(mechanical.randomness, "rest authoritative draws");
    const faces = list(record(randomDraws[0], "rest authoritative draw").faces, "rest faces");
    expect(faces).toHaveLength(1);
    expect(Number(faces[0])).toBeGreaterThanOrEqual(1);
    expect(Number(faces[0])).toBeLessThanOrEqual(10);

    const observed = readModel(await initialized.stub.observe(ALICE));
    const rested = record(observed.controlledCharacter, "rested fighter");
    expect(record(rested.hitPoints, "rested hit points").current)
      .toBe(Math.min(20, 4 + Number(faces[0]) + 2));
    expect(record(rested.resources, "rested resources")).toMatchObject({
      hitDice: 1,
      surge: 1,
      slot1: 0,
      resolve: 1,
    });
  });

  it("routes group-rest consent through trusted pending ownership without auto-resting another player", async () => {
    const aliceId = "character:multi:group-rest:alice";
    const bobId = "character:multi:group-rest:bob";
    const initialized = await initialize("multiplayer-v2-authoritative-group-rest", {
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        campaignCharacter(aliceId, ALICE.principal.id, 10),
        wizardCampaignCharacter(bobId, BOB.principal.id),
      ],
    });
    const invitation = await commitIntent(
      initialized.stub,
      ALICE,
      "submission:group-rest:invite",
      "forged:ignored",
      "我邀请鲍勃同行。",
      { operation: "changeParty", partyAction: "inviteMember", memberRefs: [bobId] },
    );
    const partyPendingId = String(record(invitation.pending, "party pending").pendingInputId);
    await expect(answerPending(
      initialized.stub,
      BOB,
      "submission:group-rest:join",
      partyPendingId,
      { accept: true },
    )).resolves.toMatchObject({ kind: "committed" });

    const offered = await commitIntent(
      initialized.stub,
      ALICE,
      "submission:group-rest:offer",
      "forged:ignored",
      "我提议我们在这里短休一小时；我自己不花生命骰。",
      {
        operation: "resolveRest",
        restKind: "short",
        hitDiceToSpend: 0,
        arcaneRecoverySlotLevels: [],
        memberRefs: [bobId],
      },
    );
    expect(offered.kind, JSON.stringify(offered)).toBe("awaitingInput");
    const bobRead = readModel(await initialized.stub.observe(BOB));
    const groupPending = list(bobRead.pendingInputs, "Bob group rest pending")
      .map((entry) => record(entry, "group pending entry"))
      .find((entry) => entry.kind === "groupRestConsent");
    expect(groupPending).toBeDefined();
    const groupPendingId = String(groupPending!.pendingInputId);
    expect(record(groupPending!.options, "group rest options")).toMatchObject({
      initiatorCharacterId: aliceId,
      restKind: "short",
      offeredAtFictionMicros: "0",
    });

    await expect(initialized.stub.prepare(ALICE, {
      kind: "answer",
      submissionId: "submission:group-rest:forged-answer",
      pendingInputId: groupPendingId,
      answer: { kind: "restNow", restKind: "short", mode: "group", hitDice: 1, arcane: 0 },
    })).resolves.toMatchObject({ kind: "rejected", code: "pendingInputUnauthorized" });
    expect(list(readModel(await initialized.stub.observe(BOB)).pendingInputs, "pending survives forged answer"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ pendingInputId: groupPendingId })]));

    const legacyArcane = await answerPending(
      initialized.stub,
      BOB,
      "submission:group-rest:legacy-arcane",
      groupPendingId,
      { kind: "restNow", restKind: "short", mode: "group", hitDice: 0, arcane: 1 },
    );
    expect(legacyArcane).toMatchObject({ kind: "rejected", code: "invalidPendingResolution" });

    const invalidArcane = await answerPending(
      initialized.stub,
      BOB,
      "submission:group-rest:invalid-arcane",
      groupPendingId,
      {
        kind: "restNow",
        restKind: "short",
        mode: "group",
        hitDice: 0,
        arcaneRecoverySlotLevels: [0, 6, 1.5],
      },
    );
    expect(invalidArcane).toMatchObject({ kind: "rejected", code: "invalidPendingResolution" });

    const reconnected = room("multiplayer-v2-authoritative-group-rest");
    expect(list(readModel(await reconnected.observe(BOB)).pendingInputs, "pending after reconnect"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ pendingInputId: groupPendingId })]));

    const accepted = await answerPending(
      reconnected,
      BOB,
      "submission:group-rest:accept",
      groupPendingId,
      {
        kind: "restNow",
        restKind: "short",
        mode: "group",
        hitDice: 0,
        arcaneRecoverySlotLevels: [3, 1, 1],
      },
    );
    expect(accepted.kind, JSON.stringify(accepted)).toBe("committed");
    const after = readModel(await initialized.stub.observe(BOB));
    expect(list(after.pendingInputs, "pending after consent")).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ pendingInputId: groupPendingId })]),
    );
    expect(list(after.activities, "Bob activities")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        characterId: bobId,
        restKind: "short",
        recoveryChoice: { hitDiceToSpend: 0, arcaneRecoverySlotLevels: [1, 1, 3] },
        startedAtFictionMicros: "0",
        status: "active",
      }),
    ]));
  });

  it("rejects Arcane Recovery choices from a private long-rest consent", async () => {
    const aliceId = "character:multi:long-rest:alice";
    const bobId = "character:multi:long-rest:bob";
    const initialized = await initialize("multiplayer-v2-authoritative-long-rest", {
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        campaignCharacter(aliceId, ALICE.principal.id, 10),
        wizardCampaignCharacter(bobId, BOB.principal.id),
      ],
    });
    const invitation = await commitIntent(
      initialized.stub,
      ALICE,
      "submission:long-rest:invite",
      "forged:ignored",
      "我邀请鲍勃同行。",
      { operation: "changeParty", partyAction: "inviteMember", memberRefs: [bobId] },
    );
    await expect(answerPending(
      initialized.stub,
      BOB,
      "submission:long-rest:join",
      String(record(invitation.pending, "long-rest party pending").pendingInputId),
      { accept: true },
    )).resolves.toMatchObject({ kind: "committed" });

    const offered = await commitIntent(
      initialized.stub,
      ALICE,
      "submission:long-rest:offer",
      "forged:ignored",
      "我提议我们完整长休八小时。",
      {
        operation: "resolveRest",
        restKind: "long",
        hitDiceToSpend: 0,
        arcaneRecoverySlotLevels: [],
        memberRefs: [bobId],
      },
    );
    expect(offered.kind, JSON.stringify(offered)).toBe("awaitingInput");
    const pendingInputId = String(record(offered.pending, "long-rest consent pending").pendingInputId);

    const invalid = await answerPending(
      initialized.stub,
      BOB,
      "submission:long-rest:invalid-arcane-recovery",
      pendingInputId,
      {
        kind: "restNow",
        restKind: "long",
        mode: "group",
        hitDice: 0,
        arcaneRecoverySlotLevels: [1],
      },
    );
    expect(invalid).toMatchObject({ kind: "rejected", code: "invalidPendingResolution" });

    await expect(answerPending(
      initialized.stub,
      BOB,
      "submission:long-rest:accept",
      pendingInputId,
      {
        kind: "restNow",
        restKind: "long",
        mode: "group",
        hitDice: 0,
        arcaneRecoverySlotLevels: [],
      },
    )).resolves.toMatchObject({ kind: "committed" });
  });

  it("commits advancement, retirement, and a provenance-clean successor through Room authority", async () => {
    const predecessorId = "character:multi:campaign-predecessor";
    const successorId = "character:multi:campaign-successor";
    const witnessId = "character:multi:campaign-witness";
    const predecessorKnowledgeRef = "knowledge:campaign:predecessor-private-sigil";
    const predecessorRelationshipRef = "relationship:campaign:predecessor-witness";
    const predecessorPromiseRef = "promise:campaign:predecessor-witness";
    const predecessorDebtRef = "debt:campaign:predecessor-witness";
    const initialized = await initialize("multiplayer-v2-long-campaign", {
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        campaignCharacter(predecessorId, ALICE.principal.id),
        campaignCharacter(witnessId, BOB.principal.id),
      ],
    });

    const milestone = await commitIntent(
      initialized.stub,
      ALICE,
      "submission:campaign:milestone",
      "forged:actor-is-ignored",
      "这一章的目标已经达成，我要结算里程碑成长。",
      { operation: "advanceCampaignLifecycle", lifecycleAction: "grantMilestone" },
    );
    expect(milestone.kind, JSON.stringify(milestone)).toBe("awaitingInput");
    const milestonePending = record(milestone.pending, "advancement pending");
    expect(milestonePending).toMatchObject({
      kind: "advancementChoice",
      options: {
        classId: "rogue",
        newLevel: 4,
        hitPointMethod: "fixed2014",
        abilityScoreBudget: 2,
      },
    });
    const advanced = await answerPending(
      initialized.stub,
      ALICE,
      "submission:campaign:advancement-choice",
      String(milestonePending.pendingInputId),
      {
        classId: "rogue",
        newLevel: 4,
        hitPointMethod: "fixed2014",
        selectedFeatureIds: ["feature:ability-score-improvement"],
        abilityScoreIncreases: { dex: 2 },
      },
    );
    expect(advanced.kind).toBe("committed");
    const advancedRead = readModel(await initialized.stub.observe(ALICE));
    expect(record(advancedRead.controlledCharacter, "advanced character")).toMatchObject({
      characterId: predecessorId,
      level: 4,
      abilityScores: { dex: 18 },
      hitPoints: { current: 7, maximum: 24 },
      proficiencyBonus: 2,
      resourceMaximums: { hitDice: 4 },
    });

    await expect(commitIntent(
      initialized.stub,
      ALICE,
      "submission:campaign:predecessor-private-continuity",
      predecessorId,
      "我辨认暗号、与见证人建立关系，并明确记录承诺和债务。",
      {
        operation: "resolveDirectConsequences",
        duration: { unit: "second", value: 1 },
        frozenCosts: [],
        success: [
          {
            kind: "acquireKnowledge",
            knowledgeRef: predecessorKnowledgeRef,
            value: "银叶暗号指向旧王室密道",
          },
          {
            kind: "updateRelationship",
            relationshipRef: predecessorRelationshipRef,
            recipientRefs: [witnessId],
            value: "共同守护神龛的私人信任",
          },
          {
            kind: "recordCommitment",
            commitmentRef: predecessorPromiseRef,
            targetRef: witnessId,
            value: "在月圆前守住神龛",
            status: "下一次月圆前",
          },
          {
            kind: "recordDebt",
            debtRef: predecessorDebtRef,
            targetRef: witnessId,
            value: "偿还重铸神龛门锁的费用",
            status: "下一次月圆前",
          },
        ],
        failure: [],
      },
    )).resolves.toMatchObject({ kind: "committed" });

    const transitioned = await commitIntent(
      initialized.stub,
      ALICE,
      "submission:campaign:transition-chapter",
      predecessorId,
      "我确认本章结果，并进入以既有后果为锚点的下一章。",
      {
        operation: "advanceCampaignLifecycle",
        lifecycleAction: "transitionChapter",
        chapterRef: "chapter:campaign:second",
        activityTransitions: [],
      },
    );
    expect(transitioned.kind, JSON.stringify(transitioned)).toBe("committed");
    const chapterRead = readModel(await initialized.stub.observe(ALICE));
    expect(list(chapterRead.chapters, "chapter continuity projection")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chapterId: "chapter:opening",
          status: "concluded",
          continuityManifestHash: expect.stringMatching(/^sha256:/),
          nextChapterId: "chapter:campaign:second",
        }),
        expect.objectContaining({
          chapterId: "chapter:campaign:second",
          status: "active",
        }),
      ]),
    );
    expect(list(chapterRead.knowledge, "cross-chapter predecessor knowledge")).toEqual(
      expect.arrayContaining([expect.objectContaining({ knowledgeRef: predecessorKnowledgeRef })]),
    );
    expect(list(chapterRead.relationships, "cross-chapter predecessor relationships")).toEqual(
      expect.arrayContaining([expect.objectContaining({ relationshipId: predecessorRelationshipRef })]),
    );
    expect(list(chapterRead.promises, "cross-chapter predecessor promises")).toEqual(
      expect.arrayContaining([expect.objectContaining({ promiseId: predecessorPromiseRef })]),
    );
    expect(list(chapterRead.debts, "cross-chapter predecessor debts")).toEqual(
      expect.arrayContaining([expect.objectContaining({ debtId: predecessorDebtRef })]),
    );

    const retired = await commitIntent(
      initialized.stub,
      ALICE,
      "submission:campaign:retire",
      predecessorId,
      "我选择留在这里重建守钥人组织，并结束冒险者生涯。",
      { operation: "advanceCampaignLifecycle", lifecycleAction: "retireCharacter" },
    );
    expect(retired.kind, JSON.stringify(retired)).toBe("committed");
    await expect(initialized.stub.observe(ALICE)).resolves.toMatchObject({
      readModel: {
        controlledCharacter: null,
        lifecycle: {
          kind: "successorRequired",
          defaultPredecessorCharacterId: predecessorId,
        },
      },
    });
    await expect(initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:campaign:retired-predecessor-cannot-act",
      characterId: predecessorId,
      text: "我仍以已经退役的前任身份行动。",
    })).resolves.toMatchObject({ kind: "rejected", code: "notController" });

    const successorSeed = campaignCharacter(successorId, ALICE.principal.id, 18);
    await expect(initialized.stub.applyRoomAdministration(initialized.administration, {
      commandId: "room-admin:introduce-campaign-successor",
      kind: "introduceSuccessor",
      principalId: ALICE.principal.id,
      predecessorCharacterId: predecessorId,
      character: successorSeed,
      worldEntry: "受守钥人邀请来到神龛，明确接过下一章的冒险席位。",
    })).resolves.toMatchObject({ kind: "committed" });

    const successorRead = readModel(await room("multiplayer-v2-long-campaign").observe(ALICE));
    expect(record(successorRead.controlledCharacter, "successor character")).toMatchObject({
      characterId: successorId,
      level: 3,
      hitPoints: { current: 18, maximum: 18 },
    });
    expect(list(successorRead.knowledge, "successor knowledge")).toEqual([]);
    expect(record(successorRead.controlledCharacter, "successor mechanics").combat).toBeDefined();

    const unrelatedInheritance = await commitIntent(
      initialized.stub,
      BOB,
      "submission:campaign:unrelated-seat-cannot-authorize-inheritance",
      witnessId,
      "我试图以无关席位替前任授权继承。",
      {
        operation: "advanceCampaignLifecycle",
        lifecycleAction: "establishInheritanceSource",
        sourceEntityRef: predecessorId,
        inheritanceSourceKind: "will",
        publicClause: "无关席位伪造的条款",
        inheritanceAuthorization: {
          authorizationId: "inheritance-authorization:forged-by-unrelated-seat",
          kind: "knowledge",
          sourceRef: predecessorKnowledgeRef,
          targetRef: predecessorKnowledgeRef,
          scope: "acquireExactKnowledge",
        },
      },
    );
    expect(unrelatedInheritance).toMatchObject({
      kind: "needsKp",
      diagnostics: [expect.objectContaining({ code: "invalidRulesInput" })],
    });
    const unrelatedAfterAttempt = readModel(await initialized.stub.observe(BOB));
    expect(list(unrelatedAfterAttempt.visibleFacts, "facts after forged inheritance attempt"))
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "inheritanceSource" }),
      ]));

    const authorizationId = "inheritance-authorization:room-private-sigil";
    const established = await commitIntent(
      initialized.stub,
      ALICE,
      "submission:campaign:establish-exact-inheritance-source",
      predecessorId,
      "我在现场宣读前任留下的精确遗嘱条款，只授权继承这一条知识。",
      {
        operation: "advanceCampaignLifecycle",
        lifecycleAction: "establishInheritanceSource",
        sourceEntityRef: predecessorId,
        inheritanceSourceKind: "will",
        publicClause: "仅将银叶暗号的含义告知苍岚",
        inheritanceAuthorization: {
          authorizationId,
          kind: "knowledge",
          sourceRef: predecessorKnowledgeRef,
          targetRef: predecessorKnowledgeRef,
          scope: "acquireExactKnowledge",
        },
      },
    );
    expect(established.kind, JSON.stringify(established)).toBe("committed");
    const afterSource = readModel(await initialized.stub.observe(ALICE));
    expect(list(afterSource.knowledge, "knowledge before exact transfer")).toEqual([]);
    const sourceFact = list(afterSource.visibleFacts, "visible inheritance facts")
      .map((entry) => record(entry, "visible inheritance fact"))
      .find((entry) => entry.kind === "inheritanceSource");
    expect(sourceFact).toBeDefined();
    const unrelatedViewerAfterSource = readModel(await initialized.stub.observe(BOB));
    expect(list(unrelatedViewerAfterSource.visibleFacts, "unrelated inheritance facts"))
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "inheritanceSource" }),
      ]));

    const transferred = await commitIntent(
      initialized.stub,
      ALICE,
      "submission:campaign:consume-exact-inheritance-source",
      predecessorId,
      "我依照已宣读条款取得这一条知识，不取得其他前任私有状态。",
      {
        operation: "advanceCampaignLifecycle",
        lifecycleAction: "transferInheritance",
        sourceEntityRef: predecessorId,
        inheritanceSourceFactRef: String(sourceFact?.id),
        inheritanceAuthorizationRef: authorizationId,
      },
    );
    expect(transferred.kind, JSON.stringify(transferred)).toBe("committed");
    const inheritedRead = readModel(await initialized.stub.observe(ALICE));
    expect(list(inheritedRead.knowledge, "exact inherited knowledge")).toEqual([
      expect.objectContaining({ knowledgeRef: predecessorKnowledgeRef }),
    ]);
    expect(list(inheritedRead.relationships, "non-inherited relationships")).toEqual([]);
    expect(list(inheritedRead.promises, "non-inherited promises")).toEqual([]);
    expect(list(inheritedRead.debts, "non-inherited debts")).toEqual([]);

    await expect(initialized.stub.applyRoomAdministration(initialized.administration, {
      commandId: "room-admin:introduce-campaign-successor",
      kind: "introduceSuccessor",
      principalId: ALICE.principal.id,
      predecessorCharacterId: predecessorId,
      character: successorSeed,
      worldEntry: "受守钥人邀请来到神龛，明确接过下一章的冒险席位。",
    })).resolves.toMatchObject({ kind: "committed" });

    await expect(initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:campaign:successor-forged-actor",
      characterId: predecessorId,
      text: "我调查新章节的入口。",
    })).resolves.toMatchObject({
      kind: "prepared",
      kpProjection: {
        actorProjection: {
          controlledCharacter: { characterId: successorId },
        },
      },
    });
  });

  it("revokes a dead character's control after a fatal noncombat Room Action", async () => {
    const predecessorId = "character:multi:dead-predecessor";
    const successorId = "character:multi:death-successor";
    const initialized = await initialize("multiplayer-v2-death-successor", {
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [campaignCharacter(predecessorId, ALICE.principal.id, 1)],
    });

    const fatal = await commitIntent(
      initialized.stub,
      ALICE,
      "submission:campaign:fatal-noncombat-consequence",
      "forged:actor-is-ignored",
      "坍落的石梁击中我；这一已冻结后果足以致命。",
      {
        operation: "resolveDirectConsequences",
        duration: { unit: "second", value: 1 },
        frozenCosts: [],
        success: [{ kind: "changeHitPoints", targetRef: predecessorId, amount: -1 }],
        failure: [],
      },
    );
    expect(fatal.kind, JSON.stringify(fatal)).toBe("committed");
    expect(record(fatal.kpProjection, "fatal KP projection")).toMatchObject({
      lifecycleTransition: {
        characterId: predecessorId,
        tenureStatus: "dead",
        successorRequired: true,
      },
    });

    await expect(initialized.stub.observe(ALICE)).resolves.toMatchObject({
      readModel: {
        controlledCharacter: null,
        lifecycle: {
          kind: "successorRequired",
          defaultPredecessorCharacterId: predecessorId,
          eligiblePredecessors: [expect.objectContaining({
            characterId: predecessorId,
            tenureStatus: "dead",
          })],
        },
      },
    });
    await expect(initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:campaign:dead-predecessor-cannot-act",
      characterId: predecessorId,
      text: "我仍以已经死亡的前任身份行动。",
    })).resolves.toMatchObject({ kind: "rejected", code: "notController" });

    const successorSeed = campaignCharacter(successorId, ALICE.principal.id, 18);
    await expect(initialized.stub.applyRoomAdministration(initialized.administration, {
      commandId: "room-admin:introduce-death-successor",
      kind: "introduceSuccessor",
      principalId: ALICE.principal.id,
      predecessorCharacterId: predecessorId,
      character: successorSeed,
      worldEntry: "在确认前任死亡后，作为独立人物加入下一章。",
    })).resolves.toMatchObject({ kind: "committed" });
    await expect(initialized.stub.observe(ALICE)).resolves.toMatchObject({
      readModel: {
        controlledCharacter: {
          characterId: successorId,
          tenureStatus: "active",
        },
        knowledge: [],
      },
    });
  });

  it("makes membership, Seat, host, and CharacterControl changes service-authoritative", async () => {
    const initialized = await initialize("multiplayer-v2-seat-lifecycle", {
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [character("character:multi:alice", ALICE.principal.id)],
    });

    await expect(initialized.stub.applyRoomAdministration(ALICE, {
      commandId: "room-admin:forged-join",
      kind: "grantSeat",
      principal: BOB.principal,
    })).resolves.toMatchObject({ kind: "rejected", code: "roomAdministrationUnauthorized" });

    await expect(initialized.stub.applyRoomAdministration(initialized.administration, {
      commandId: "room-admin:join-bob",
      kind: "grantSeat",
      principal: BOB.principal,
      role: "player",
      character: character("character:multi:bob", BOB.principal.id),
    })).resolves.toMatchObject({ kind: "committed" });

    const bobRead = readModel(await initialized.stub.observe(BOB));
    expect(record(bobRead.controlledCharacter, "Bob character").characterId)
      .toBe("character:multi:bob");
    expect(list(bobRead.roomMembers, "public room members")).toEqual(expect.arrayContaining([
      expect.objectContaining({ principalId: ALICE.principal.id, role: "host", seatStatus: "active" }),
      expect.objectContaining({ principalId: BOB.principal.id, role: "player", seatStatus: "active" }),
    ]));

    await expect(initialized.stub.prepare(BOB, {
      kind: "intent",
      submissionId: "submission:multi:bob-forges-alice",
      characterId: "character:multi:alice",
      text: "我替爱丽丝行动。",
    })).resolves.toMatchObject({
      kind: "prepared",
      kpProjection: {
        actorProjection: {
          controlledCharacter: { characterId: "character:multi:bob" },
        },
      },
    });

    const pendingPrepared = prepared(await initialized.stub.prepare(BOB, {
      kind: "intent",
      submissionId: "submission:multi:bob-pending",
      characterId: "character:multi:bob",
      text: "我检查两根外观相同的拉杆。",
    }));
    const pendingSource = record(await initialized.stub.commit(
      BOB,
      pendingPrepared.preparedActionId,
      {
        kind: "directSuccess",
        rootActionId: pendingPrepared.rootActionId,
        proposalAttemptId: "submission:multi:bob-pending:proposal:1",
        goal: "检查并拉动玩家选择的拉杆",
        method: "先确认玩家指的是哪一根拉杆",
        publicBasisRefs: [],
        privateBasisRefs: [],
        risk: null,
        pendingInput: {
          kind: "clarification",
          prompt: "你要拉警铃还是闸门？",
          choices: [
            { id: "alarm", label: "警铃", consequence: "拉响警铃。" },
            { id: "gate", label: "闸门", consequence: "触发闸门机构。" },
          ],
        },
        dynamicMaterializations: [],
        npcActions: [],
        mechanicalProposal: null,
        scene: {
          question: "鲍勃选择哪一根拉杆？",
          pressure: "",
          opportunities: [],
          conclusionCandidate: null,
        },
      },
    ), "Bob pending commit");
    expect(pendingSource.kind).toBe("awaitingInput");
    const pendingInputId = String(record(pendingSource.pending, "Bob pending").pendingInputId);

    await expect(initialized.stub.applyRoomAdministration(initialized.administration, {
      commandId: "room-admin:remove-bob",
      kind: "removeMember",
      principalId: BOB.principal.id,
      reason: "hostRemoved",
    })).resolves.toMatchObject({ kind: "committed" });
    await expect(initialized.stub.observe(BOB)).resolves.toMatchObject({
      kind: "rejected",
      code: "seatInactive",
    });
    await expect(initialized.stub.prepare(BOB, {
      kind: "answer",
      submissionId: "submission:multi:removed-answer",
      pendingInputId,
      answer: "gate",
    })).resolves.toMatchObject({ kind: "rejected" });

    await expect(initialized.stub.applyRoomAdministration(initialized.administration, {
      commandId: "room-admin:transfer-host",
      kind: "transferHost",
      fromPrincipalId: ALICE.principal.id,
      toPrincipalId: CHARLIE.principal.id,
    })).resolves.toMatchObject({ kind: "rejected", code: "targetSeatUnavailable" });
  });

  it("requires every member's consent for atomic group movement and lets one character atomically leave", async () => {
    const initialized = await initialize("multiplayer-v2-party-group", {
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        character("character:multi:alice", ALICE.principal.id, "shrine"),
        character("character:multi:bob", BOB.principal.id, "shrine"),
      ],
    });

    const invitation = await commitIntent(
      initialized.stub,
      ALICE,
      "submission:multi:invite-bob",
      "character:multi:alice",
      "我邀请鲍勃同行。",
      {
        operation: "changeParty",
        partyAction: "inviteMember",
        memberRefs: ["character:multi:bob"],
      },
    );
    expect(invitation.kind).toBe("awaitingInput");
    const invitePendingId = String(record(invitation.pending, "party invitation").pendingInputId);
    expect(list(readModel(await initialized.stub.observe(ALICE)).pendingInputs, "Alice pending"))
      .toEqual(expect.arrayContaining([expect.objectContaining({
        pendingInputId: invitePendingId,
        access: "initiator",
        question: "等待对方回应同行邀请。",
      })]));
    expect(list(readModel(await initialized.stub.observe(BOB)).pendingInputs, "Bob pending"))
      .toEqual(expect.arrayContaining([expect.objectContaining({
        pendingInputId: invitePendingId,
        access: "controller",
      })]));

    await expect(answerPending(
      initialized.stub,
      BOB,
      "submission:multi:accept-party",
      invitePendingId,
      { accept: true },
    )).resolves.toMatchObject({ kind: "committed" });

    const moveProposal = await commitIntent(
      initialized.stub,
      ALICE,
      "submission:multi:group-move",
      "character:multi:alice",
      "我组织同行者一起前往庭院。",
      {
        operation: "changeParty",
        partyAction: "proposeMove",
        destinationRef: "yard",
        duration: { unit: "minute", value: 1 },
      },
    );
    expect(moveProposal.kind).toBe("awaitingInput");
    const movePendingId = String(record(moveProposal.pending, "group move pending").pendingInputId);
    expect(record(readModel(await initialized.stub.observe(ALICE)).controlledCharacter, "Alice before move").sceneId)
      .toBe("shrine");
    expect(record(readModel(await initialized.stub.observe(BOB)).controlledCharacter, "Bob before move").sceneId)
      .toBe("shrine");

    await expect(answerPending(
      initialized.stub,
      BOB,
      "submission:multi:accept-move",
      movePendingId,
      { accept: true },
    )).resolves.toMatchObject({ kind: "committed" });
    expect(record(readModel(await initialized.stub.observe(ALICE)).controlledCharacter, "Alice after move").sceneId)
      .toBe("yard");
    expect(record(readModel(await initialized.stub.observe(BOB)).controlledCharacter, "Bob after move").sceneId)
      .toBe("yard");

    await expect(commitIntent(
      initialized.stub,
      BOB,
      "submission:multi:individual-move",
      "character:multi:bob",
      "我独自进入地窖。",
      {
        operation: "changeParty",
        partyAction: "moveIndividually",
        destinationRef: "cellar",
        duration: { unit: "second", value: 30 },
      },
    )).resolves.toMatchObject({ kind: "committed" });
    const aliceAfterSplit = readModel(await initialized.stub.observe(ALICE));
    const bobAfterSplit = readModel(await initialized.stub.observe(BOB));
    expect(record(aliceAfterSplit.controlledCharacter, "Alice split location").sceneId).toBe("yard");
    expect(record(bobAfterSplit.controlledCharacter, "Bob split location").sceneId).toBe("cellar");
    expect(list(bobAfterSplit.partyGroups, "Bob groups")).toEqual([]);
  });

  it("keeps split-location fictional time and causal frontiers separate while spotlight stays within three beats", async () => {
    const initialized = await initialize("multiplayer-v2-time-frontier", {
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        character("character:multi:alice", ALICE.principal.id, "shrine"),
        character("character:multi:bob", BOB.principal.id, "yard"),
      ],
    });

    await expect(commitIntent(
      initialized.stub,
      ALICE,
      "submission:multi:alice-two-minutes",
      "character:multi:alice",
      "我花两分钟仔细检查神龛。",
      {
        operation: "resolveDirectConsequences",
        duration: { unit: "minute", value: 2 },
        frozenCosts: [],
        success: [],
        failure: [],
      },
    )).resolves.toMatchObject({ kind: "committed" });
    await expect(commitIntent(
      initialized.stub,
      BOB,
      "submission:multi:bob-five-seconds",
      "character:multi:bob",
      "我花五秒确认院门是否上锁。",
      {
        operation: "resolveDirectConsequences",
        duration: { unit: "second", value: 5 },
        frozenCosts: [],
        success: [],
        failure: [],
      },
    )).resolves.toMatchObject({ kind: "committed" });

    const aliceRead = readModel(await initialized.stub.observe(ALICE));
    const bobRead = readModel(await initialized.stub.observe(BOB));
    expect(record(aliceRead.fictionTime, "Alice time").nowMicros).toBe("120000000");
    expect(record(bobRead.fictionTime, "Bob time").nowMicros).toBe("5000000");
    expect(record(aliceRead.causalFrontier, "Alice frontier").sceneId).toBe("shrine");
    expect(record(bobRead.causalFrontier, "Bob frontier").sceneId).toBe("yard");

    const ledger = record(aliceRead.spotlightLedger, "spotlight ledger");
    const aliceBeat = Number(record(ledger["character:multi:alice"], "Alice spotlight").decisionBeats);
    const bobBeat = Number(record(ledger["character:multi:bob"], "Bob spotlight").decisionBeats);
    expect(Math.abs(aliceBeat - bobBeat)).toBeLessThanOrEqual(3);

    const beforeDisconnect = structuredClone(bobRead);
    const reconnected = readModel(await room("multiplayer-v2-time-frontier").observe(
      BOB,
      { channel: "reconnect" },
    ));
    expect(reconnected.fictionTime).toEqual(beforeDisconnect.fictionTime);
    expect(reconnected.causalFrontier).toEqual(beforeDisconnect.causalFrontier);
    expect(reconnected.spotlightLedger).toEqual(beforeDisconnect.spotlightLedger);
  });
});
