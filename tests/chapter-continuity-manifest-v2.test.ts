import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical";
import { isCampaignContinuityManifest } from "../app/_runtime/lib/rules/v2/campaign-continuity";
import { privateFormProposal } from "./helpers/authoritative-proposal";

type JsonRecord = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:continuity-manifest:alice", sessionVersion: 1 }),
});
const PLAYER_ID = "character:continuity-manifest:alice";
const NPC_ID = "npc:continuity-manifest:watcher";
const NPC_KNOWLEDGE_REF = "knowledge:continuity-manifest:watch-order";
const FACTION_REF = "faction:continuity-manifest:watch";
const RESOURCE_REF = "resource:continuity-manifest:warning-cord";
const PLAN_ID = "actor-plan:continuity-manifest:close-yard";
const ACTIVITY_ID = "activity:continuity-manifest:close-yard";

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
};

function record(value: unknown, label: string): JsonRecord {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as JsonRecord;
}

function list(value: unknown, label: string): JsonRecord[] {
  expect(Array.isArray(value), label).toBe(true);
  return (value as unknown[]).map((entry) => record(entry, label));
}

async function runAction(
  authority: Authority,
  submissionId: string,
  text: string,
  propose: (rootActionId: string) => JsonRecord,
) {
  return record(await handleRoomAction({
    principal: ALICE,
    authority,
    kp: {
      async propose(request) {
        return propose(String(record(request, "KP request").rootActionId));
      },
      async narrate() {
        return { body: "本章的权威事实仍然连续。" };
      },
    },
  }, {
    kind: "intent",
    submissionId,
    characterId: PLAYER_ID,
    text,
  } as never), `${submissionId} outcome`);
}

function factionDefinitionProposal(rootActionId: string) {
  return privateFormProposal(rootActionId, "materialization.v1", {
    goal: "依据守夜人的有限知识登记夜巡会",
    method: "registerFactionDefinition",
    proposedFact: JSON.stringify({
      schema: "zhuwei.faction-definition-draft/v1",
      factionRef: FACTION_REF,
      name: "夜巡会",
      goal: "不惊动灵堂地封闭院门",
      memberRefs: [NPC_ID],
      resourceRefs: [RESOURCE_REF],
      causalBasisRefs: [NPC_KNOWLEDGE_REF],
    }),
    basisRefs: ["wake", NPC_ID, NPC_KNOWLEDGE_REF],
    resolution: "direct",
    durationUnit: "second",
    durationValue: 1,
  }) as unknown as JsonRecord;
}

function precedentProposal(rootActionId: string) {
  return privateFormProposal(rootActionId, "materialization.v1", {
    goal: "检查门轴是否能被徒手推开",
    method: "recordAdjudicationPrecedent",
    proposedFact: JSON.stringify({
      schema: "zhuwei.adjudication-precedent-draft/v1",
      action: "record",
      publicRuleBasis: ["SRD 5.1：力量（运动）检定可用于以蛮力突破障碍。"],
      publicBasisRefs: [],
      privateBasisRefs: [],
      applicabilityScope: { kind: "scene", ref: "wake" },
    }),
    basisRefs: ["wake"],
    risk: "门轴可能保持卡死。",
    resolution: "check",
    ability: "str",
    skill: "athletics",
    dc: 10,
    mode: "normal",
    successConsequence: "门轴可以被稳定推开。",
    failureConsequence: "门轴仍然卡死。",
    durationUnit: "second",
    durationValue: 1,
  }) as unknown as JsonRecord;
}

function factionActorPlanProposal(rootActionId: string) {
  return privateFormProposal(rootActionId, "materialization.v1", {
    goal: "让守夜人按有限知识形成封门计划",
    method: "formActorPlan",
    proposedFact: JSON.stringify({
      schema: "zhuwei.actor-plan-draft/v1",
      npcRef: NPC_ID,
      factionRef: FACTION_REF,
      planId: PLAN_ID,
      goal: "钟响后封闭院门",
      premiseRefs: [NPC_KNOWLEDGE_REF],
      nextStep: "用警戒绳封闭院门",
      resourceRefs: [FACTION_REF, RESOURCE_REF],
      activity: {
        activityId: ACTIVITY_ID,
        activityKind: "factionOperation",
        intendedDurationMicros: "2000000",
      },
      due: { kind: "activityCompletion" },
      trigger: null,
      trace: {
        factRef: "fact:continuity-manifest:warning-cord",
        description: "院门前出现新拉起的警戒绳",
        visibilityPolicyRef: "visibility:scene-observers",
      },
      alternateTarget: {
        targetRef: "wake",
        reason: "院门不可用时退守灵堂入口",
      },
    }),
    basisRefs: [
      "wake",
      NPC_ID,
      NPC_KNOWLEDGE_REF,
      FACTION_REF,
      RESOURCE_REF,
    ],
    resolution: "direct",
    durationUnit: "second",
    durationValue: 1,
  }) as unknown as JsonRecord;
}

function chapterTransitionProposal(rootActionId: string) {
  return privateFormProposal(rootActionId, "materialization.v1", {
    goal: "结束当前章并保持全部权威连续性",
    method: "以当前事实、裁定和未到期计划作为下一章锚点",
    proposedFact: JSON.stringify({
      schema: "zhuwei.campaign-lifecycle-draft/v1",
      action: "transitionChapter",
      chapterRef: "chapter:continuity-manifest:second",
      storyAnchorRefs: [],
      sceneQuestion: "下一章如何承接仍未到期的封门计划？",
      activityTransitions: [{ activityId: ACTIVITY_ID, disposition: "continue" }],
    }),
    basisRefs: ["wake", ACTIVITY_ID],
    resolution: "direct",
    durationUnit: "second",
    durationValue: 1,
  }) as unknown as JsonRecord;
}

describe("chapter continuity manifest responsibility", () => {
  it("accepts the current v2 shape and rejects the retired v1 shape", () => {
    const v2Core = {
      schema: "zhuwei.campaign-continuity-manifest/v2",
      characterStates: [],
      itemStates: [],
      knowledgeStates: [],
      relationshipStates: [],
      debtStates: [],
      promiseStates: [],
      activityStates: [],
      canonicalFactStates: [],
      definitionStates: [],
      precedentStates: [],
      combatEffectStates: [],
      fictionTimelineStates: [],
      causalFrontierStates: [],
      unresolvedThreatRefs: [],
      activityTransitions: [],
      actorPlanStates: [],
      factionPlanStates: [],
    };
    expect(isCampaignContinuityManifest({
      ...v2Core,
      manifestHash: canonicalSha256(v2Core),
    })).toBe(true);

    const v1Body = Object.fromEntries(Object.entries(v2Core).filter(([key]) =>
      key !== "actorPlanStates" && key !== "factionPlanStates"));
    const v1Core = {
      ...v1Body,
      schema: "zhuwei.campaign-continuity-manifest/v1",
    };
    expect(isCampaignContinuityManifest({
      ...v1Core,
      manifestHash: canonicalSha256(v1Core),
    })).toBe(false);
  });

  it("pins adjudication precedent plus pending NPC/faction plans across a real Room chapter transition", async () => {
    const roomId = "chapter-continuity-manifest-v2";
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [{
        characterId: PLAYER_ID,
        controllerPrincipalId: ALICE.principal.id,
        staticCard: {
          name: "连续性记录者",
          sceneId: "wake",
          abilityScores: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
          proficiencyBonus: 2,
          proficientSkills: ["athletics"],
        },
      }],
      fixtureFacts: [{
        knowledgeRef: NPC_KNOWLEDGE_REF,
        holderEntityId: NPC_ID,
        holderName: "守夜人",
        sceneId: "wake",
        content: "守夜人知道钟响后要用警戒绳封闭院门。",
      }],
    }), "continuity room initialization");
    const capabilities = record(initialized.serviceCapabilities, "service capabilities");

    const precedent = await runAction(
      authority,
      "submission:continuity-manifest:precedent",
      "我按既定裁定检查门轴是否能被徒手推开。",
      precedentProposal,
    );
    expect(precedent.kind, JSON.stringify(precedent)).toBe("committed");

    const faction = await runAction(
      authority,
      "submission:continuity-manifest:faction",
      "我确认守夜人与夜巡会正在按既有职责准备警戒绳。",
      factionDefinitionProposal,
    );
    expect(faction.kind, JSON.stringify(faction)).toBe("committed");

    const formed = await runAction(
      authority,
      "submission:continuity-manifest:form",
      "我留意守夜人的例行准备。",
      factionActorPlanProposal,
    );
    expect(formed.kind, JSON.stringify(formed)).toBe("committed");

    const transitioned = await runAction(
      authority,
      "submission:continuity-manifest:transition",
      "我确认本章结果，并让守夜人的既定计划延续到下一章。",
      chapterTransitionProposal,
    );
    expect(transitioned.kind, JSON.stringify(transitioned)).toBe("committed");

    const exported = record(await authority.exportAuthoritativeArchive(
      capabilities.archiveExport,
    ), "continuity archive export");
    const events = list(record(exported.archive, "continuity archive").events, "archive event");
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "AdjudicationPrecedentRecorded",
      "NpcPlanFormed",
      "FactionPlanFormed",
      "ChapterContinuityRecorded",
    ]));
    const continuity = events.find((event) => event.eventType === "ChapterContinuityRecorded");
    const manifest = record(record(continuity?.payload, "continuity payload").manifest, "manifest");
    expect(manifest.schema).toBe("zhuwei.campaign-continuity-manifest/v2");
    expect(isCampaignContinuityManifest(manifest)).toBe(true);
    expect(list(manifest.precedentStates, "precedent state").some((entry) =>
      String(entry.ref).startsWith("adjudication-precedent:"))).toBe(true);
    expect(list(manifest.actorPlanStates, "actor plan state")).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: `actor-plan:${PLAN_ID}` }),
    ]));
    expect(list(manifest.factionPlanStates, "faction plan state")).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: `faction-plan:${PLAN_ID}` }),
    ]));
    expect(list(manifest.activityStates, "activity state")).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: `activity:${ACTIVITY_ID}` }),
    ]));

  });
});
