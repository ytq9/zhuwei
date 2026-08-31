import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { authoritativeModuleProfile } from "../app/_runtime/lib/module/authoritative";
import { handleRoomAction } from "../app/_runtime/lib/room/action";
import { privateFormProposal } from "./helpers/authoritative-proposal";

type JsonRecord = Record<string, unknown>;

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
};

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:compound:alice", sessionVersion: 1 }),
});

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

describe("one compound authoritative action transaction", () => {
  it("commits a production KP draft's dynamic fact, NPC plan, scene question, and check under one Root Action", async () => {
    const roomName = "compound-authoritative-action-v2";
    const authority = env.ROOMS.getByName(roomName) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId: roomName,
      moduleId: "black-oak-will",
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [{
        characterId: "character:compound:alice",
        controllerPrincipalId: ALICE.principal.id,
        staticCard: {
          name: "阿莱莎",
          sceneId: "wake",
          abilityScores: { str: 10, dex: 14, con: 12, int: 14, wis: 12, cha: 10 },
          proficiencyBonus: 2,
          proficientSkills: ["investigation"],
        },
      }],
    }), "initialization");
    expect(initialized.created).toBe(true);
    const capabilities = record(initialized.serviceCapabilities, "service capabilities");

    const moduleProfile = await authoritativeModuleProfile("black-oak-will");
    const npc = moduleProfile.storyBible.importantNpcs.find((entry) => entry.initialKnowledge.length > 0);
    expect(npc).toBeDefined();
    const npcKnowledgeRef = `${npc!.entityId}:module-knowledge:01`;
    const dynamicFactRef = "fact:hazard:wake:loose-chandelier";

    const draft = {
      goal: "在不惊动守灵人的情况下确认吊灯绳是否被人割过",
      method: "借烛台阴影观察绳结并用镜片检查切口",
      stages: [{
        goal: "确认吊灯绳切口",
        method: "观察绳结并检查切口方向",
        intendedOutcome: "确认绳索是否被人为割断",
        risk: "靠近悬挂点可能让已经松动的吊灯摇晃。",
        resolution: "check",
        ability: "int",
        skill: "investigation",
        dc: 13,
        mode: "normal",
        successConsequence: "切口方向被确认。",
        failureConsequence: "吊链发出声响，观察未能完成。",
      }],
      intendedOutcome: "完成观察并让世界中的后续力量开始行动",
      resolution: "direct",
      durationUnit: "minute",
      durationValue: 10,
      composition: {
        schema: "zhuwei.compound-composition-draft/v1",
        before: [{
          kind: "declareDynamicFact",
          factRef: dynamicFactRef,
          factKind: "hazard",
          subjectRefs: ["wake"],
          causalBasisRefs: ["wake"],
          summary: "大厅上方的吊灯绳已经松动，并留有可检查的切口。",
          disclosure: "public",
        }, {
          kind: "formActorPlan",
          basisRefs: ["wake", npcKnowledgeRef],
          draft: {
            schema: "zhuwei.compound-actor-plan-draft/v1",
            npcRef: npc!.entityId,
            factionRef: null,
            planRef: "npc-plan:compound:watch-hall",
            goal: "依照自己已知的职责留意大厅异常",
            premiseRefs: [npcKnowledgeRef],
            nextStep: "继续原有巡视，不预知玩家未暴露的打算",
            resourceRefs: [],
            activity: {
              activityRef: "activity:compound:npc-watch-hall",
              activityKind: "watchHall",
              intendedDurationMicros: "600000000",
            },
            schedule: { kind: "knowledgeAcquired", knowledgeRef: npcKnowledgeRef },
            trace: {
              factRef: "fact:compound:npc-watch-hall-result",
              description: "守灵人按自己已经掌握的职责继续巡视大厅。",
            },
            alternate: {
              referenceRef: "wake",
              reason: "若当前观察点不再可用，就转向大厅其余区域。",
            },
          },
        }, {
          kind: "openSceneQuestion",
          sceneQuestionRef: "scene-question:compound:chandelier-cut",
          question: "阿莱莎能否在不引起注意的情况下确认吊灯绳的切口？",
        }],
        onSuccess: [],
        onFailure: [],
      },
    };
    const outcome = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        propose: async (request: JsonRecord) => privateFormProposal(
          String(request.rootActionId),
          "compound.v1",
          draft,
          "proposal:compound:1",
        ),
        narrate: async () => ({ body: "吊链轻响，但你的观察已经得到权威结算。" }),
      },
    }, {
      kind: "intent",
      submissionId: "submission:compound:1",
      characterId: "character:compound:alice",
      text: "我借烛台阴影靠近，用小镜片检查吊灯绳的切口。",
    }), "room action outcome");

    expect(outcome.kind, JSON.stringify(outcome)).toBe("committed");
    const receipt = record(outcome.receipt, "compound receipt");
    expect(list(receipt.randomnessCommitments, "randomness commitments")).toHaveLength(1);

    const exported = record(
      await authority.exportAuthoritativeArchive(capabilities.archiveExport),
      "archive export",
    );
    expect(exported.kind).toBe("exported");
    const archive = record(exported.archive, "archive");
    const events = list(archive.events, "archive events").map((entry) => record(entry, "event"));
    const actionEvents = events.filter((event) => event.rootActionId === receipt.rootActionId);
    const eventTypes = actionEvents.map((event) => event.eventType);
    expect(eventTypes).toEqual(expect.arrayContaining([
      "DefinitionRegistered",
      "CanonicalFactDeclared",
      "NpcPlanFormed",
      "ActivityStarted",
      "SceneQuestionOpened",
      "RandomnessRequested",
      "ImprovisedCheckResolved",
    ]));
    expect(eventTypes.filter((eventType) => eventType === "RandomnessRequested")).toHaveLength(1);
    expect(eventTypes.filter((eventType) => eventType === "DiceRolled")).toHaveLength(1);
    expect(eventTypes.filter((eventType) => eventType === "ImprovisedCheckResolved")).toHaveLength(1);
    expect(new Set(actionEvents.map((event) => event.rootActionId))).toEqual(
      new Set([receipt.rootActionId]),
    );

    const encoded = JSON.stringify(archive);
    expect(encoded).toContain(dynamicFactRef);
    expect(encoded).toContain(npcKnowledgeRef);
    expect(encoded).not.toContain("我借烛台阴影靠近");
  });
});
