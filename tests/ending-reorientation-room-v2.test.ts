import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";
import { privateFormProposal } from "./helpers/authoritative-proposal";

type JsonRecord = Record<string, unknown>;

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
  deliveryPublicationStatus(query: unknown): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
  restoreAuthoritativeArchive(capability: unknown, archive: unknown): Promise<unknown>;
};

const ALICE = Object.freeze({
  principal: Object.freeze({
    id: "principal:ending-reorientation:alice",
    sessionVersion: 1,
  }),
});
const ALICE_ID = "character:ending-reorientation:alice";
const CURRENT_SCENE_REF = "wake";
const MATERIALIZATION_BASIS_REF = "fact:ending:shared-wake-context";

function record(value: unknown, label: string): JsonRecord {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as JsonRecord;
}

function list(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), label).toBe(true);
  return value as unknown[];
}

function authority(roomId: string) {
  return env.ROOMS.getByName(roomId) as unknown as Authority;
}

async function acknowledgeCurrentDelivery(
  room: Authority,
  value: unknown,
  label: string,
) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  const delivery = (value as JsonRecord).delivery;
  if (typeof delivery !== "object" || delivery === null || Array.isArray(delivery)) return;
  const current = delivery as JsonRecord;
  if (current.kind !== "current") return;
  const frame = record(current.frame, `${label} delivery frame`);
  const deliveryId = String(frame.deliveryId);
  await expect(room.acknowledge(ALICE, deliveryId)).resolves.toMatchObject({
    kind: "acknowledged",
    deliveryId,
  });
}

async function initialize(roomId: string, hitPointsCurrent = 20) {
  const room = authority(roomId);
  const initialized = record(await room.initializeAuthoritative({
    roomId,
    moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{
      characterId: ALICE_ID,
      controllerPrincipalId: ALICE.principal.id,
      staticCard: {
        name: "阿莱莎",
        sceneId: "wake",
        scores: { str: 12, dex: 12, con: 12, int: 14, wis: 12, cha: 10 },
        proficiency: 2,
        skills: ["investigation"],
        hp: { current: hitPointsCurrent, max: 20, temp: 0 },
        ac: 12,
        speed: 30,
        resources: {},
        equipped: {},
        backpack: [],
      },
    }],
    fixtureFacts: [
      {
        knowledgeRef: "knowledge:ending:lian-witnesses-shared-context",
        holderEntityId: "npc:black-oak-will:lian",
        holderName: "莉安·黑橡",
        sceneId: CURRENT_SCENE_REF,
        content: "莉安与阿莱莎正在同一个公开现场中。",
      },
      {
        factRef: MATERIALIZATION_BASIS_REF,
        kind: "establishedCommunicationChannel",
        participants: [ALICE_ID, "npc:black-oak-will:lian"],
      },
    ],
  }), `${roomId} initialization`);
  expect(initialized.created).toBe(true);
  await acknowledgeCurrentDelivery(
    room,
    await room.observe(ALICE),
    `${roomId} opening`,
  );
  return {
    authority: room,
    capabilities: record(initialized.serviceCapabilities, "service capabilities"),
  };
}

async function act(
  room: Authority,
  submissionId: string,
  text: string,
  proposal: (rootActionId: string, request: JsonRecord) => JsonRecord,
  narration = "权威世界只保留已经提交的结果，并把决定权交还玩家。",
) {
  const outcome = record(await handleRoomAction({
    principal: ALICE,
    authority: room,
    kp: {
      async propose(value) {
        const request = record(value, `${submissionId} proposal request`);
        return proposal(String(request.rootActionId), request);
      },
      async narrate() {
        return { body: narration };
      },
    },
  }, {
    kind: "intent",
    submissionId,
    text,
  }), `${submissionId} outcome`);
  await acknowledgeCurrentDelivery(room, outcome, submissionId);
  return outcome;
}

function endingCandidateProposal(
  rootActionId: string,
  endingCandidateRef: string,
  basisRefs: string[],
) {
  return privateFormProposal(rootActionId, "materialization.v1", {
    goal: "依据已经固化的冲突结果识别真实收束",
    method: "只引用现有事实提出结局候选",
    proposedFact: JSON.stringify({
      schema: "zhuwei.campaign-lifecycle-draft/v1",
      action: "raiseEndingCandidate",
      endingCandidateRef,
      basisRefs,
      unresolvedRefs: [],
    }),
    basisRefs: [CURRENT_SCENE_REF, ...basisRefs],
    resolution: "direct",
    durationUnit: "second",
    durationValue: 1,
  }) as unknown as JsonRecord;
}

function conclusionProposal(
  rootActionId: string,
  input: {
    endingCandidateRef: string;
    storyRef: string;
    outcome: string;
    consequenceRefs: string[];
  },
) {
  return privateFormProposal(rootActionId, "materialization.v1", {
    goal: "提交当前故事的真实结局与长期后果",
    method: "保留已经发生的胜负、损失和持续后果",
    proposedFact: JSON.stringify({
      schema: "zhuwei.campaign-lifecycle-draft/v1",
      action: "concludeStory",
      ...input,
    }),
    basisRefs: [CURRENT_SCENE_REF, input.endingCandidateRef],
    resolution: "direct",
    durationUnit: "second",
    durationValue: 1,
  }) as unknown as JsonRecord;
}

function materializedFactProposal(
  rootActionId: string,
  input: {
    goal: string;
    method: string;
    fact: JsonRecord;
    basisRefs?: string[];
  },
) {
  const proposal = privateFormProposal(rootActionId, "materialization.v1", {
    goal: input.goal,
    method: input.method,
    proposedFact: JSON.stringify(input.fact),
    basisRefs: [MATERIALIZATION_BASIS_REF, ...(input.basisRefs ?? [])],
    resolution: "direct",
    durationUnit: "second",
    durationValue: 1,
  });
  const step = proposal.loweredCausalProgram.steps[0];
  if (step === undefined) throw new Error("materialization Form produced no causal step");
  return {
    proposal: proposal as unknown as JsonRecord,
    factRef: `fact:v3-materialization:${rootActionId}:${proposal.causalActionProgram.semanticHash.slice("fnv1a64:".length)}:${step.nodeRef}`,
  };
}

function meaningfulFailureProposal(
  rootActionId: string,
  input: {
    precedentRef: string;
    basisRefs: string[];
    consequenceRefs: string[];
    newOptions: Array<{ optionId: string; summary: string }>;
    goal: string;
    method: string;
    durationValue: number;
  },
) {
  return privateFormProposal(rootActionId, "materialization.v1", {
    goal: input.goal,
    method: input.method,
    proposedFact: JSON.stringify({
      schema: "zhuwei.campaign-lifecycle-draft/v1",
      action: "commitMeaningfulFailure",
      precedentRef: input.precedentRef,
      basisRefs: input.basisRefs,
      consequenceRefs: input.consequenceRefs,
      newOptions: input.newOptions,
    }),
    basisRefs: [
      CURRENT_SCENE_REF,
      ...input.basisRefs,
      ...input.newOptions.map(({ optionId }) => optionId),
    ],
    resolution: "direct",
    durationUnit: "minute",
    durationValue: input.durationValue,
  }) as unknown as JsonRecord;
}

function unchangedRetryProposal(
  rootActionId: string,
  input: {
    precedentRef: string;
    goal: string;
    method: string;
  },
) {
  return privateFormProposal(rootActionId, "materialization.v1", {
    goal: input.goal,
    method: input.method,
    proposedFact: JSON.stringify({
      schema: "zhuwei.campaign-lifecycle-draft/v1",
      action: "retryFailedAction",
      precedentRef: input.precedentRef,
      changeKind: null,
      evidenceRefs: [],
    }),
    basisRefs: [CURRENT_SCENE_REF],
    resolution: "check",
    ability: "str",
    skill: "athletics",
    dc: 15,
    mode: "normal",
    successConsequence: "轮盘打开。",
    failureConsequence: "轮盘仍然关闭。",
    durationUnit: "minute",
    durationValue: 1,
  }) as unknown as JsonRecord;
}

async function exportArchive(room: Authority, capability: unknown) {
  const exported = record(
    await room.exportAuthoritativeArchive(capability),
    "authoritative archive export",
  );
  expect(exported.kind).toBe("exported");
  return record(exported.archive, "authoritative archive");
}

function archiveEvents(archive: JsonRecord) {
  return list(archive.events, "archive events")
    .map((entry) => record(entry, "archive event"));
}

function rootEvents(archive: JsonRecord, outcome: JsonRecord) {
  const receipt = record(outcome.receipt, "public receipt");
  return archiveEvents(archive)
    .filter((event) => event.rootActionId === receipt.rootActionId);
}

async function readModel(room: Authority) {
  return record(
    record(await room.observe(ALICE), "Room observation").readModel,
    "viewer read model",
  );
}

function story(read: JsonRecord, storyRef: string) {
  return list(read.stories, "projected stories")
    .map((entry) => record(entry, "projected story"))
    .find((entry) => entry.storyId === storyRef);
}

describe("SPEC 0009 ending and reorientation through the real Room interface", () => {
  it("keeps a victorious conclusion and its long-term consequences durable, without admitting a retroactive hidden villain", async () => {
    const room = await initialize("ending-room-victory-v2");
    let victoryFact = "";
    const endingCandidateRef = "ending:victory-seal-destroyed";
    const storyRef = "story:ending:victory";
    const consequences = [
      "守钥人永久恢复自由",
      "被毁的封印不会自行复原",
    ];

    const victory = await act(
      room.authority,
      "submission:ending:victory-fact",
      "我完成最后的仪式，亲眼确认封印核心已经彻底熄灭。",
      (rootActionId) => {
        const materialization = materializedFactProposal(rootActionId, {
          goal: "确认核心冲突已经取得不可撤销的胜利",
          method: "完成仪式并观察封印核心彻底熄灭",
          fact: {
            result: "封印核心已被摧毁",
            permanence: "不会自行复原",
          },
        });
        victoryFact = materialization.factRef;
        return materialization.proposal;
      },
    );
    expect(victory.kind, JSON.stringify(victory)).toBe("committed");
    expect(victoryFact).toMatch(/^fact:v3-materialization:.+:[^:]+$/u);

    const raised = await act(
      room.authority,
      "submission:ending:victory-candidate",
      "这场围绕封印的冲突已经解决。",
      (rootActionId) => endingCandidateProposal(
        rootActionId,
        endingCandidateRef,
        [victoryFact],
      ),
    );
    expect(raised.kind, JSON.stringify(raised)).toBe("committed");

    const concluded = await act(
      room.authority,
      "submission:ending:victory-conclude",
      "我接受胜利的真实后果，让这个故事在此收束。",
      (rootActionId) => conclusionProposal(rootActionId, {
        endingCandidateRef,
        storyRef,
        outcome: "victory",
        consequenceRefs: consequences,
      }),
    );
    expect(concluded.kind, JSON.stringify(concluded)).toBe("concluded");

    const sourceArchive = await exportArchive(
      room.authority,
      room.capabilities.archiveExport,
    );
    expect(rootEvents(sourceArchive, concluded)
      .find((event) => event.eventType === "StoryConcluded")?.payload)
      .toMatchObject({
        storyId: storyRef,
        outcome: "victory",
        longTermConsequences: consequences,
      });

    const restored = authority("ending-room-victory-restored-v2");
    await expect(restored.restoreAuthoritativeArchive(
      room.capabilities.disasterRecovery,
      structuredClone(sourceArchive),
    )).resolves.toMatchObject({ kind: "restored", projectionIntegrity: "verified" });
    expect(story(await readModel(restored), storyRef)).toMatchObject({
      status: "concluded",
      outcome: "victory",
      longTermConsequences: consequences,
    });

    let retroactiveVillainRef = "";
    const retroactive = await act(
      restored,
      "submission:ending:retroactive-villain",
      "我不要求续篇；只停在已经取得的胜利与尾声。",
      (rootActionId) => {
        const materialization = materializedFactProposal(rootActionId, {
          goal: "撤销刚刚取得的胜利并强行延长同一个故事",
          method: "事后宣称另有从未固化的幕后黑手",
          basisRefs: [victoryFact],
          fact: {
            kind: "retroactiveHiddenVillain",
            claim: "真正的幕后黑手刚刚出现，原胜利无效",
          },
        });
        retroactiveVillainRef = materialization.factRef;
        return materialization.proposal;
      },
    );
    const afterRetroactive = await exportArchive(
      restored,
      room.capabilities.archiveExport,
    );
    const villainEvents = archiveEvents(afterRetroactive)
      .filter((event) => JSON.stringify(event).includes(retroactiveVillainRef))
      .map((event) => event.eventType);

    expect({
      outcomeKind: retroactive.kind,
      stayedConcluded: retroactive.kind !== "committed",
      villainEvents,
      projectedStory: story(await readModel(restored), storyRef),
    }).toEqual({
      outcomeKind: expect.not.stringMatching(/^committed$/),
      stayedConcluded: true,
      villainEvents: [],
      projectedStory: expect.objectContaining({
        status: "concluded",
        outcome: "victory",
        longTermConsequences: consequences,
      }),
    });
  });

  it("concludes an irreversible failure without resetting its canonical loss", async () => {
    // The burn predates this room epoch, so genesis is the single authority
    // for its already-settled HP loss; conclusion and recovery must preserve it.
    const room = await initialize("ending-room-irreversible-failure-v2", 7);
    let lossFact = "";
    let responseOptionRef = "";
    const failureGoal = "goal:ending:recover-relic";
    const endingCandidateRef = "ending:irreversible-relic-loss";
    const storyRef = "story:ending:irreversible-failure";

    const loss = await act(
      room.authority,
      "submission:ending:irreversible-loss",
      "熔井坍塌时遗物永远坠入岩浆。",
      (rootActionId) => {
        const materialization = materializedFactProposal(rootActionId, {
          goal: "固化已经发生且不可逆的遗物损失",
          method: "确认遗物坠入熔井并已经熔毁",
          fact: {
            result: "遗物已在熔井中熔毁",
            recoverable: false,
          },
        });
        lossFact = materialization.factRef;
        return materialization.proposal;
      },
    );
    expect(loss.kind, JSON.stringify(loss)).toBe("committed");

    const responseOption = await act(
      room.authority,
      "submission:ending:loss-response-option",
      "遗物已经无法找回；我仍可选择接受失败并处理伤势与关系后果。",
      (rootActionId) => {
        const materialization = materializedFactProposal(rootActionId, {
          goal: "固化失败后已经存在的可行动应对",
          method: "依据不可逆损失识别仍可采取的应对",
          basisRefs: [lossFact],
          fact: {
            kind: "opportunity",
            summary: "接受失败并处理伤势与关系后果",
          },
        });
        responseOptionRef = materialization.factRef;
        return materialization.proposal;
      },
    );
    expect(responseOption.kind, JSON.stringify(responseOption)).toBe("committed");

    const failure = await act(
      room.authority,
      "submission:ending:meaningful-failure",
      "我承认原目标已经不可逆失败，并决定如何面对这个损失。",
      (rootActionId) => meaningfulFailureProposal(rootActionId, {
        precedentRef: failureGoal,
        basisRefs: [lossFact],
        consequenceRefs: ["遗物永久熔毁", "灼伤保留到后续治疗"],
        newOptions: [{
          optionId: responseOptionRef,
          summary: "接受失败并处理长期后果",
        }],
        goal: "夺回已经熔毁的遗物",
        method: "在熔井凝固后继续徒手寻找同一件遗物",
        durationValue: 10,
      }),
    );
    expect(failure.kind, JSON.stringify(failure)).toBe("committed");

    await expect(act(
      room.authority,
      "submission:ending:failure-candidate",
      "核心目标已经不可逆失败，这个故事可以真实收束。",
      (rootActionId) => endingCandidateProposal(rootActionId, endingCandidateRef, [lossFact]),
    )).resolves.toMatchObject({ kind: "committed" });
    const concluded = await act(
      room.authority,
      "submission:ending:failure-conclude",
      "保留失败与伤势，不把遗物或状态重置回来。",
      (rootActionId) => conclusionProposal(rootActionId, {
        endingCandidateRef,
        storyRef,
        outcome: "irreversibleFailure",
        consequenceRefs: ["遗物永久熔毁", "当前生命值保持为 7"],
      }),
    );
    expect(concluded.kind, JSON.stringify(concluded)).toBe("concluded");

    const archive = await exportArchive(room.authority, room.capabilities.archiveExport);
    const restored = authority("ending-room-irreversible-failure-restored-v2");
    await expect(restored.restoreAuthoritativeArchive(
      room.capabilities.disasterRecovery,
      structuredClone(archive),
    )).resolves.toMatchObject({ kind: "restored", projectionIntegrity: "verified" });
    const restoredRead = await readModel(restored);
    expect({
      hitPoints: record(restoredRead.controlledCharacter, "controlled character").hitPoints,
      lossStillVisible: JSON.stringify(restoredRead.visibleFacts).includes(lossFact),
      story: story(restoredRead, storyRef),
    }).toEqual({
      hitPoints: { current: 7, maximum: 20 },
      lossStillVisible: true,
      story: expect.objectContaining({
        status: "concluded",
        outcome: "irreversibleFailure",
        longTermConsequences: expect.arrayContaining([
          "遗物永久熔毁",
          "当前生命值保持为 7",
        ]),
      }),
    });
  });

  it("concludes only after the player explicitly abandons the current adventure", async () => {
    const room = await initialize("ending-room-explicit-abandonment-v2");
    let abandonmentFact = "";
    const endingCandidateRef = "ending:explicit-abandonment";
    const storyRef = "story:ending:abandoned-expedition";

    const abandoned = await act(
      room.authority,
      "submission:ending:explicit-abandonment",
      "我明确放弃追查这次远征，带着现有伤势和知识离开。",
      (rootActionId) => {
        const materialization = materializedFactProposal(rootActionId, {
          goal: "记录玩家明确放弃当前冲突与冒险",
          method: "由玩家本人声明停止追查并离开",
          fact: {
            decision: "明确放弃当前远征",
          },
        });
        abandonmentFact = materialization.factRef;
        return materialization.proposal;
      },
    );
    expect(abandoned.kind, JSON.stringify(abandoned)).toBe("committed");

    await expect(act(
      room.authority,
      "submission:ending:abandonment-candidate",
      "我的明确放弃已经让当前冒险失去继续意义。",
      (rootActionId) => endingCandidateProposal(
        rootActionId,
        endingCandidateRef,
        [abandonmentFact],
      ),
    )).resolves.toMatchObject({ kind: "committed" });
    const concluded = await act(
      room.authority,
      "submission:ending:abandonment-conclude",
      "按我明确表达的放弃收束，不替我偷偷选择继续。",
      (rootActionId) => conclusionProposal(rootActionId, {
        endingCandidateRef,
        storyRef,
        outcome: "playerAbandoned",
        consequenceRefs: ["远征在未查明真相时结束"],
      }),
    );
    expect(concluded.kind, JSON.stringify(concluded)).toBe("concluded");

    const archive = await exportArchive(room.authority, room.capabilities.archiveExport);
    expect({
      abandonmentRootEvents: rootEvents(archive, abandoned).map((event) => event.eventType),
      conclusion: rootEvents(archive, concluded)
        .find((event) => event.eventType === "StoryConcluded")?.payload,
    }).toEqual({
      abandonmentRootEvents: expect.arrayContaining([
        "DefinitionRegistered",
        "ImprovisedActionResolved",
      ]),
      conclusion: expect.objectContaining({
        storyId: storyRef,
        outcome: "playerAbandoned",
        longTermConsequences: ["远征在未查明真相时结束"],
      }),
    });
  });

  it("rejects the identical reroll and reorients a stuck player to an already-canonical opportunity", async () => {
    const room = await initialize("ending-room-reorientation-v2");
    let opportunityRef = "";
    let failureBasisRef = "";
    const failureGoal = "goal:ending:open-sealed-vault";
    const failedMethod = "继续徒手转动已经熔断的同一个轮盘";

    const opportunitySetup = await act(
      room.authority,
      "submission:ending:canonical-opportunity",
      "我已经发现旧排水渠仍然可以调查。",
      (rootActionId) => {
        const materialization = materializedFactProposal(rootActionId, {
          goal: "固化已经发现的旁路机会",
          method: "观察旧排水渠入口",
          fact: {
            kind: "opportunity",
            summary: "已发现的旧排水渠仍可调查",
            cost: "需要绳索并接受绕行耗时",
          },
        });
        opportunityRef = materialization.factRef;
        return materialization.proposal;
      },
    );
    expect(opportunitySetup.kind, JSON.stringify(opportunitySetup)).toBe("committed");

    const failureBasisSetup = await act(
      room.authority,
      "submission:ending:sealed-wheel-fact",
      "我确认正门轮盘已经熔断，原路线关闭。",
      (rootActionId) => {
        const materialization = materializedFactProposal(rootActionId, {
          goal: "固化正门轮盘的当前状态",
          method: "检查已经熔断的正门轮盘",
          fact: {
            result: "正门轮盘已经熔断，原路线关闭",
          },
        });
        failureBasisRef = materialization.factRef;
        return materialization.proposal;
      },
    );
    expect(failureBasisSetup.kind, JSON.stringify(failureBasisSetup)).toBe("committed");

    const failure = await act(
      room.authority,
      "submission:ending:route-failure",
      "我徒手继续转动熔断轮盘，原路线仍然关闭。",
      (rootActionId) => meaningfulFailureProposal(rootActionId, {
        precedentRef: failureGoal,
        basisRefs: [failureBasisRef],
        consequenceRefs: ["正门路线永久关闭"],
        newOptions: [{
          optionId: opportunityRef,
          summary: "转向已经发现的旧排水渠",
        }],
        goal: "从正门打开密库",
        method: failedMethod,
        durationValue: 1,
      }),
    );
    expect(record(failure.receipt, "failure receipt")).toMatchObject({
      status: "committed",
      meaningfulFailure: true,
      newOptions: [{ optionId: opportunityRef, summary: "转向已经发现的旧排水渠" }],
    });

    const identicalRetry = await act(
      room.authority,
      "submission:ending:identical-reroll",
      "我不改变任何条件，要求再掷一次同样的轮盘检定。",
      (rootActionId) => unchangedRetryProposal(rootActionId, {
        precedentRef: failureGoal,
        goal: "从正门打开密库",
        method: failedMethod,
      }),
    );
    expect(identicalRetry).toMatchObject({ kind: "rejected", code: "unchangedRetry" });

    let preparedProjectionContainedOpportunity = false;
    const reoriented = await act(
      room.authority,
      "submission:ending:reorient-existing-opportunity",
      "我卡住了，请简要重述现状和已经掌握的可行动机会。",
      (rootActionId, request) => {
        preparedProjectionContainedOpportunity = JSON.stringify(request.projection)
          .includes(opportunityRef);
        return privateFormProposal(rootActionId, "observe.v1", {
          goal: "把玩家重新定向到已经固化的可行动机会",
          method: "重述正门失败，并指出已知旧排水渠仍可调查",
          focus: "正门失败后的现有可行动路径",
          desiredInformation: `正门已经关闭；已知机会 ${opportunityRef} 仍可调查。`,
          basisRefs: [CURRENT_SCENE_REF, failureBasisRef, opportunityRef],
          resolution: "direct",
          durationUnit: "second",
          durationValue: 1,
        }) as unknown as JsonRecord;
      },
      `正门已经关闭；你已知道 ${opportunityRef} 仍可调查，也可以提出其他方法。`,
    );
    expect(reoriented.kind, JSON.stringify(reoriented)).toBe("committed");

    const archive = await exportArchive(room.authority, room.capabilities.archiveExport);
    const reorientationEvents = rootEvents(archive, reoriented);
    const newlyInventedOpportunities = reorientationEvents
      .filter((event) => event.eventType === "DefinitionRegistered");
    expect({
      preparedProjectionContainedOpportunity,
      reorientationUsedRandomness: reorientationEvents.some((event) =>
        ["RandomnessRequested", "DiceRolled"].includes(String(event.eventType))),
      newlyInventedOpportunities,
      currentDelivery: reoriented.delivery,
    }).toEqual({
      preparedProjectionContainedOpportunity: true,
      reorientationUsedRandomness: false,
      newlyInventedOpportunities: [],
      currentDelivery: expect.objectContaining({
        kind: "current",
        body: expect.stringContaining(opportunityRef),
      }),
    });
  });

  it("refuses a meaningful failure that changes nothing in the world", async () => {
    // SPEC 0001 21.I asks a failure to change the world proportionately and to
    // open a new situation. The new options were already required; an empty
    // consequence list was not, so a failure could commit having spent fiction
    // time and moved nothing. Both halves are required now, and the contrast
    // below shows the refusal is about the empty delta rather than the fixture.
    const room = await initialize("ending-room-empty-failure-delta-v2");
    const failureGoal = "goal:ending:empty-delta";
    let opportunityRef = "";
    let basisRef = "";

    const opportunitySetup = await act(
      room.authority,
      "submission:ending:empty-delta-opportunity",
      "我已经发现侧墙的检修口仍然可以调查。",
      (rootActionId) => {
        const materialization = materializedFactProposal(rootActionId, {
          goal: "固化已经发现的旁路机会",
          method: "观察侧墙检修口",
          fact: {
            kind: "opportunity",
            summary: "已发现的侧墙检修口仍可调查",
            cost: "需要撬棍并接受噪音",
          },
        });
        opportunityRef = materialization.factRef;
        return materialization.proposal;
      },
    );
    expect(opportunitySetup.kind, JSON.stringify(opportunitySetup)).toBe("committed");

    const basisSetup = await act(
      room.authority,
      "submission:ending:empty-delta-basis",
      "我确认主锁芯已经卡死，这条路线失败了。",
      (rootActionId) => {
        const materialization = materializedFactProposal(rootActionId, {
          goal: "固化主锁芯的当前状态",
          method: "检查卡死的主锁芯",
          fact: { result: "主锁芯已经卡死" },
        });
        basisRef = materialization.factRef;
        return materialization.proposal;
      },
    );
    expect(basisSetup.kind, JSON.stringify(basisSetup)).toBe("committed");

    const emptyDelta = await act(
      room.authority,
      "submission:ending:empty-delta-failure",
      "我承认这次失败了，但世界没有任何变化。",
      (rootActionId) => meaningfulFailureProposal(rootActionId, {
        precedentRef: failureGoal,
        basisRefs: [basisRef],
        consequenceRefs: [],
        newOptions: [{ optionId: opportunityRef, summary: "转向侧墙检修口" }],
        goal: "撬开主锁芯",
        method: "继续徒手扳动已经卡死的同一个锁芯",
        durationValue: 1,
      }),
    );
    // An unrepairable draft comes back as needsKp rather than committing: the
    // player keeps the turn and can restate the failure with a real cost,
    // which is the recovery this refusal is only worth having because of.
    expect(emptyDelta.kind, JSON.stringify(emptyDelta)).toBe("needsKp");

    const realDelta = await act(
      room.authority,
      "submission:ending:real-delta-failure",
      "我承认这次失败了，主锁芯彻底报废，只能改走别处。",
      (rootActionId) => meaningfulFailureProposal(rootActionId, {
        precedentRef: failureGoal,
        basisRefs: [basisRef],
        consequenceRefs: ["主锁芯彻底报废，正面路线永久关闭"],
        newOptions: [{ optionId: opportunityRef, summary: "转向侧墙检修口" }],
        goal: "撬开主锁芯",
        method: "继续徒手扳动已经卡死的同一个锁芯",
        durationValue: 1,
      }),
    );
    expect(record(realDelta.receipt, "real delta receipt")).toMatchObject({
      status: "committed",
      meaningfulFailure: true,
    });
  });

  it("advances neither fiction time nor punishment during real-world wait and DO eviction alone", async () => {
    const roomId = "ending-room-real-wait-eviction-v2";
    const room = await initialize(roomId);
    const beforeRead = await readModel(room.authority);
    const beforeArchive = await exportArchive(
      room.authority,
      room.capabilities.archiveExport,
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    await evictDurableObject(room.authority as never);

    const rebuilt = authority(roomId);
    const afterRead = await readModel(rebuilt);
    const afterArchive = await exportArchive(
      rebuilt,
      room.capabilities.archiveExport,
    );
    const afterEvents = archiveEvents(afterArchive);
    const punishmentTypes = new Set([
      "DamagePacketResolved",
      "FactionPlanAdvanced",
      "FictionTimeAdvanced",
      "HitPointsChanged",
      "MeaningfulFailureCommitted",
    ]);

    expect({
      fictionTime: afterRead.fictionTime,
      eventHead: afterArchive.head,
      events: afterEvents,
      punishmentEvents: afterEvents.filter((event) =>
        punishmentTypes.has(String(event.eventType))),
    }).toEqual({
      fictionTime: beforeRead.fictionTime,
      eventHead: beforeArchive.head,
      events: archiveEvents(beforeArchive),
      punishmentEvents: [],
    });
  });
});
