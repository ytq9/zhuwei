import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  compileKpFormDraft,
  lowerCausalActionProgram,
} from "../app/_runtime/lib/kp/causal-action-program";
import { handleRoomAction } from "../app/_runtime/lib/room/action";

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
  principal: Object.freeze({ id: "principal:actor-plan:alice", sessionVersion: 1 }),
});
const PLAYER_CHARACTER_ID = "character:actor-plan:alice";
const NPC_ID = "npc:actor-plan:watcher";
const NPC_KNOWLEDGE_REF = "knowledge:actor-plan:hidden-watch-order";
const PLAN_ID = "actor-plan:night-watch:close-yard";
const ACTIVITY_ID = "activity:actor-plan:close-yard";
const TRACE_FACT_REF = "fact:actor-plan:warning-cord";

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

function formationProposal(rootActionId: string): JsonRecord {
  const proposedFact = JSON.stringify({
    schema: "zhuwei.actor-plan-draft/v1",
    npcRef: NPC_ID,
    factionRef: null,
    planId: PLAN_ID,
    goal: "钟响后封闭院门",
    premiseRefs: [NPC_KNOWLEDGE_REF],
    nextStep: "用警戒绳封闭院门",
    resourceRefs: [],
    activity: {
      activityId: ACTIVITY_ID,
      activityKind: "factionOperation",
      intendedDurationMicros: "1000000",
    },
    due: { kind: "activityCompletion" },
    trigger: null,
    trace: {
      factRef: TRACE_FACT_REF,
      description: "院门前出现一条新拉起的警戒绳",
      visibilityPolicyRef: "visibility:scene-observers",
    },
    alternateTarget: {
      targetRef: "wake",
      reason: "院门已经不可用时，改为守住灵堂入口",
    },
  });
  const draft = {
    goal: "让守夜人依据自己的密令形成到期封门计划",
    method: "formActorPlan",
    proposedFact,
    basisRefs: ["wake", NPC_ID, NPC_KNOWLEDGE_REF],
    resolution: "direct",
    durationUnit: "second",
    durationValue: 1,
  };
  const program = compileKpFormDraft("materialization.v1", draft);
  return {
    kind: "privateFormProposal",
    formId: "materialization.v1",
    draft,
    causalActionProgram: program,
    loweredCausalProgram: lowerCausalActionProgram(program),
    semanticFreezeHash: program.semanticHash,
    repairUsed: false,
    proposalAttemptId: `proposal:${rootActionId}:actor-plan`,
    modelInvocationReceipt: { task: "proposal", result: "success" },
  };
}

describe("due NPC ActorPlan authority", () => {
  it("persists the complete finite-knowledge ActorPlan through Room Action without exposing its secret premise", async () => {
    const roomId = "actor-plan-room-formation-v2";
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [{
        characterId: PLAYER_CHARACTER_ID,
        controllerPrincipalId: ALICE.principal.id,
        staticCard: {
          name: "阿莱莎",
          sceneId: "wake",
          abilityScores: { str: 10, dex: 12, con: 12, int: 14, wis: 12, cha: 10 },
          proficiencyBonus: 2,
        },
      }],
      fixtureFacts: [{
        knowledgeRef: NPC_KNOWLEDGE_REF,
        holderEntityId: NPC_ID,
        holderName: "守夜人",
        sceneId: "wake",
        content: "只有守夜人知道：钟响后封闭院门，但不要惊动灵堂。",
      }],
    }), "ActorPlan room initialization");
    const capabilities = record(initialized.serviceCapabilities, "service capabilities");

    const proposalRequests: JsonRecord[] = [];
    const outcome = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        async propose(request) {
          const proposalRequest = record(request, "ActorPlan proposal request");
          proposalRequests.push(structuredClone(proposalRequest));
          return formationProposal(String(proposalRequest.rootActionId));
        },
        async narrate() {
          return { body: "守夜人仍按自己的职责巡视。", agencyClaims: [] };
        },
      },
    }, {
      kind: "intent",
      submissionId: "submission:actor-plan:form",
      characterId: PLAYER_CHARACTER_ID,
      text: "我在灵堂里继续观察守夜人的例行巡视。",
    } as never), "ActorPlan formation outcome");

    expect(outcome.kind, JSON.stringify(outcome)).toBe("committed");
    expect(proposalRequests).toHaveLength(1);

    const receipt = record(outcome.receipt, "ActorPlan receipt");
    const exported = record(
      await authority.exportAuthoritativeArchive(capabilities.archiveExport),
      "ActorPlan archive export",
    );
    const archive = record(exported.archive, "ActorPlan archive");
    const planEvent = list(archive.events, "ActorPlan archive events")
      .map((event) => record(event, "ActorPlan event"))
      .find((event) =>
        event.rootActionId === receipt.rootActionId && event.eventType === "NpcPlanFormed");
    expect(planEvent, "the Room must persist one structured NpcPlanFormed event").toBeDefined();
    expect(record(planEvent!.payload, "NpcPlanFormed payload")).toMatchObject({
      npcId: NPC_ID,
      planId: PLAN_ID,
      actorKind: "npc",
      actorRef: NPC_ID,
      decisionNpcId: NPC_ID,
      factionRef: null,
      revision: "1",
      status: "scheduled",
      premiseRefs: [NPC_KNOWLEDGE_REF],
      nextStep: "用警戒绳封闭院门",
      resourceRefs: [],
      activity: {
        activityId: ACTIVITY_ID,
        activityKind: "factionOperation",
        intendedDurationMicros: "1000000",
      },
      due: { kind: "fictionTime", atFictionMicros: "1000000" },
      trigger: null,
      trace: { factRef: TRACE_FACT_REF },
      alternateTarget: { targetRef: "wake" },
    });

    const playerSurface = JSON.stringify({
      outcome,
      observation: await authority.observe(ALICE),
    });
    expect(playerSurface).not.toContain(NPC_KNOWLEDGE_REF);
    expect(playerSurface).not.toContain(PLAN_ID);
    expect(playerSurface).not.toContain("院门已经不可用时");
  }, 15_000);
});
