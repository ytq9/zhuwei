import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";
import {
  directConsequencesProposal,
  productionActionPlanProposal,
} from "./helpers/authoritative-proposal";

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

async function initialize(roomId: string) {
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
        hp: { current: 20, max: 20, temp: 0 },
        ac: 12,
        speed: 30,
        resources: {},
        equipped: {},
        backpack: [],
      },
    }],
  }), `${roomId} initialization`);
  expect(initialized.created).toBe(true);
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
  return record(await handleRoomAction({
    principal: ALICE,
    authority: room,
    kp: {
      async propose(value) {
        const request = record(value, `${submissionId} proposal request`);
        return proposal(String(request.rootActionId), request);
      },
      async narrate() {
        return { body: narration, agencyClaims: [] };
      },
    },
  }, {
    kind: "intent",
    submissionId,
    text,
  }), `${submissionId} outcome`);
}

function endingCandidateProposal(
  rootActionId: string,
  endingCandidateRef: string,
  basisRefs: string[],
) {
  return productionActionPlanProposal(rootActionId, {
    operation: "advanceCampaignLifecycle",
    lifecycleAction: "raiseEndingCandidate",
    endingCandidateRef,
    basisRefs,
    unresolvedRefs: [],
  }, {
    goal: "依据已经固化的冲突结果识别真实收束",
    method: "只引用现有事实提出结局候选",
    scene: {
      question: "当前故事是否已经真实收束？",
      pressure: "",
      opportunities: [],
      conclusionCandidate: endingCandidateRef,
    },
  }) as JsonRecord;
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
  return productionActionPlanProposal(rootActionId, {
    operation: "advanceCampaignLifecycle",
    lifecycleAction: "concludeStory",
    ...input,
  }, {
    goal: "提交当前故事的真实结局与长期后果",
    method: "保留已经发生的胜负、损失和持续后果",
    scene: {
      question: "这个故事怎样结束？",
      pressure: "",
      opportunities: [],
      conclusionCandidate: input.endingCandidateRef,
    },
  }) as JsonRecord;
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
    const victoryFact = "fact:ending:victory-seal-destroyed";
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
      (rootActionId) => directConsequencesProposal(rootActionId, {
        goal: "确认核心冲突已经取得不可撤销的胜利",
        method: "完成仪式并观察封印核心彻底熄灭",
        dynamicMaterializations: [{
          kind: "fact",
          factRef: victoryFact,
          causalBasisRefs: [],
          visibilityPolicyRef: "visibility:scene-observers",
          definition: {
            result: "封印核心已被摧毁",
            permanence: "不会自行复原",
          },
        }],
      }) as JsonRecord,
    );
    expect(victory.kind, JSON.stringify(victory)).toBe("committed");

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

    const retroactiveVillainRef = "fact:ending:retroactive-hidden-villain";
    const retroactive = await act(
      restored,
      "submission:ending:retroactive-villain",
      "我不要求续篇；只停在已经取得的胜利与尾声。",
      (rootActionId) => directConsequencesProposal(rootActionId, {
        goal: "撤销刚刚取得的胜利并强行延长同一个故事",
        method: "事后宣称另有从未固化的幕后黑手",
        dynamicMaterializations: [{
          kind: "fact",
          factRef: retroactiveVillainRef,
          causalBasisRefs: [victoryFact],
          visibilityPolicyRef: "visibility:hidden-until-evidence",
          definition: {
            kind: "retroactiveHiddenVillain",
            claim: "真正的幕后黑手刚刚出现，原胜利无效",
          },
        }],
      }) as JsonRecord,
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
    const room = await initialize("ending-room-irreversible-failure-v2");
    const lossFact = "fact:ending:relic-lost-in-molten-shaft";
    const failureGoal = "goal:ending:recover-relic";
    const endingCandidateRef = "ending:irreversible-relic-loss";
    const storyRef = "story:ending:irreversible-failure";

    const loss = await act(
      room.authority,
      "submission:ending:irreversible-loss",
      "熔井坍塌时遗物永远坠入岩浆，我也被灼伤。",
      (rootActionId) => directConsequencesProposal(rootActionId, {
        goal: "结算已经发生且不可逆的遗物损失与伤势",
        method: "按坍塌和灼伤的既定结果提交后果",
        dynamicMaterializations: [{
          kind: "fact",
          factRef: lossFact,
          causalBasisRefs: [],
          visibilityPolicyRef: "visibility:scene-observers",
          definition: {
            result: "遗物已在熔井中熔毁",
            recoverable: false,
          },
        }],
        success: [{ kind: "changeHitPoints", targetRef: ALICE_ID, amount: -13 }],
      }) as JsonRecord,
    );
    expect(loss.kind, JSON.stringify(loss)).toBe("committed");

    const failure = await act(
      room.authority,
      "submission:ending:meaningful-failure",
      "我承认原目标已经不可逆失败，并决定如何面对这个损失。",
      (rootActionId) => productionActionPlanProposal(rootActionId, {
        operation: "commitMeaningfulFailure",
        precedentRef: failureGoal,
        duration: { unit: "minute", value: 10 },
        basisRefs: [lossFact],
        consequenceRefs: ["遗物永久熔毁", "灼伤保留到后续治疗"],
        newOptions: [{ id: "accept-loss", summary: "接受失败并处理长期后果" }],
      }, {
        goal: "夺回已经熔毁的遗物",
        method: "在熔井凝固后继续徒手寻找同一件遗物",
        scene: {
          question: "失去遗物后，角色如何面对已经失败的目标？",
          pressure: "遗物已经不可恢复。",
          opportunities: ["接受失败并处理伤势与关系后果"],
          conclusionCandidate: endingCandidateRef,
        },
      }) as JsonRecord,
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
    const abandonmentFact = "fact:ending:player-explicitly-abandoned-expedition";
    const endingCandidateRef = "ending:explicit-abandonment";
    const storyRef = "story:ending:abandoned-expedition";

    const abandoned = await act(
      room.authority,
      "submission:ending:explicit-abandonment",
      "我明确放弃追查这次远征，带着现有伤势和知识离开。",
      (rootActionId) => directConsequencesProposal(rootActionId, {
        goal: "记录玩家明确放弃当前冲突与冒险",
        method: "由玩家本人声明停止追查并离开",
        dynamicMaterializations: [{
          kind: "fact",
          factRef: abandonmentFact,
          causalBasisRefs: [],
          visibilityPolicyRef: "visibility:scene-observers",
          definition: {
            decision: "明确放弃当前远征",
          },
        }],
      }) as JsonRecord,
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
      abandonmentRootEvents: expect.arrayContaining(["CanonicalFactDeclared"]),
      conclusion: expect.objectContaining({
        storyId: storyRef,
        outcome: "playerAbandoned",
        longTermConsequences: ["远征在未查明真相时结束"],
      }),
    });
  });

  it("rejects the identical reroll and reorients a stuck player to an already-canonical opportunity", async () => {
    const room = await initialize("ending-room-reorientation-v2");
    const opportunityRef = "opportunity:ending:known-drain-passage";
    const failureBasisRef = "fact:ending:sealed-vault-wheel-broken";
    const failureGoal = "goal:ending:open-sealed-vault";
    const failedMethod = "继续徒手转动已经熔断的同一个轮盘";

    const setup = await act(
      room.authority,
      "submission:ending:canonical-opportunity",
      "我已经发现旧排水渠，同时确认正门轮盘已经熔断。",
      (rootActionId) => directConsequencesProposal(rootActionId, {
        goal: "固化已经发现的旁路机会和正门现状",
        method: "观察排水渠入口并检查熔断轮盘",
        dynamicMaterializations: [
          {
            kind: "opportunity",
            factRef: opportunityRef,
            causalBasisRefs: [],
            visibilityPolicyRef: "visibility:scene-observers",
            definition: {
              summary: "已发现的旧排水渠仍可调查",
              cost: "需要绳索并接受绕行耗时",
            },
          },
          {
            kind: "fact",
            factRef: failureBasisRef,
            causalBasisRefs: [],
            visibilityPolicyRef: "visibility:scene-observers",
            definition: { result: "正门轮盘已经熔断，原路线关闭" },
          },
        ],
      }) as JsonRecord,
    );
    expect(setup.kind, JSON.stringify(setup)).toBe("committed");

    const failure = await act(
      room.authority,
      "submission:ending:route-failure",
      "我徒手继续转动熔断轮盘，原路线仍然关闭。",
      (rootActionId) => productionActionPlanProposal(rootActionId, {
        operation: "commitMeaningfulFailure",
        precedentRef: failureGoal,
        duration: { unit: "minute", value: 1 },
        basisRefs: [failureBasisRef],
        consequenceRefs: ["正门路线永久关闭"],
        newOptions: [{
          id: opportunityRef,
          summary: "转向已经发现的旧排水渠",
        }],
      }, {
        goal: "从正门打开密库",
        method: failedMethod,
        scene: {
          question: "正门路线失败后，玩家选择怎样的新应对？",
          pressure: "正门已经不可再用。",
          opportunities: [`调查已知机会 ${opportunityRef}`],
          conclusionCandidate: null,
        },
      }) as JsonRecord,
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
      (rootActionId) => productionActionPlanProposal(rootActionId, {
        operation: "retryFailedAction",
        precedentRef: failureGoal,
        ability: "str",
        skill: "athletics",
        dc: 15,
        mode: "normal",
        duration: { unit: "minute", value: 1 },
        frozenCosts: [],
        success: [],
        failure: [],
      }, {
        kind: "checkRequired",
        goal: "从正门打开密库",
        method: failedMethod,
        risk: {
          warning: "条件和做法完全未变。",
          successConsequences: ["轮盘打开。"],
          failureConsequences: ["轮盘仍然关闭。"],
          retryGate: ["methodChanged", "situationAdvanced"],
        },
      }) as JsonRecord,
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
        return directConsequencesProposal(rootActionId, {
          goal: "把玩家重新定向到已经固化的可行动机会",
          method: "重述正门失败，并指出已知旧排水渠仍可调查",
          publicBasisRefs: [opportunityRef],
          dynamicMaterializations: [],
          scene: {
            question: "玩家是否调查已经发现的旧排水渠，或提出其他方法？",
            pressure: "正门路线已经关闭。",
            opportunities: [`调查已知机会 ${opportunityRef}`],
            conclusionCandidate: null,
          },
        }) as JsonRecord;
      },
      `正门已经关闭；你已知道 ${opportunityRef} 仍可调查，也可以提出其他方法。`,
    );
    expect(reoriented.kind, JSON.stringify(reoriented)).toBe("committed");

    const archive = await exportArchive(room.authority, room.capabilities.archiveExport);
    const reorientationEvents = rootEvents(archive, reoriented);
    const newlyInventedOpportunities = reorientationEvents
      .filter((event) => event.eventType === "DefinitionRegistered")
      .filter((event) => JSON.stringify(event.payload).includes('"definitionKind":"opportunity"'));
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
