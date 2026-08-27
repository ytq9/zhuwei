import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { authoritativeModuleProfile } from "../app/_runtime/lib/module/authoritative";
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
    const dynamicFactRef = "hazard:wake:loose-chandelier";

    const proposal = {
      kind: "checkRequired",
      goal: "在不惊动守灵人的情况下确认吊灯绳是否被人割过",
      method: "借烛台阴影观察绳结并用镜片检查切口",
      publicBasisRefs: [],
      privateBasisRefs: [],
      estimatedFictionTime: { unit: "minute", value: 10 },
      risk: {
        warning: "靠近悬挂点可能让已经松动的吊灯摇晃。",
        successConsequences: ["确认绳索切口的方向"],
        failureConsequences: ["吊灯发出声响并让守灵人警觉"],
        retryGate: ["methodChanged", "situationAdvanced"],
      },
      pendingInput: null,
      dynamicMaterializations: [{
        kind: "hazard",
        factRef: dynamicFactRef,
        causalBasisRefs: [],
        visibilityPolicyRef: "visibility:public",
        definition: {
          name: "松动的吊灯",
          warningEvidence: "吊链偶尔发出轻微摩擦声",
          trigger: "施力或失败时摇晃",
        },
      }],
      npcActions: [{
        npcId: npc!.entityId,
        goal: "依照自己已知的职责留意大厅异常",
        method: "继续原有巡视，不预知玩家未暴露的打算",
        knowledgeRefs: [npcKnowledgeRef],
        mechanicalProposal: null,
      }],
      mechanicalProposal: {
        operation: "resolveNoncombatCheck",
        ability: "int",
        skill: "investigation",
        dc: 13,
        mode: "normal",
        duration: { unit: "minute", value: 10 },
        frozenCosts: [],
        success: [{ kind: "acquireEvidence", evidenceRef: "evidence:chandelier-cut" }],
        failure: [{ kind: "alertNpc", npcId: npc!.entityId }],
      },
      scene: {
        question: "阿莱莎能否在不引起注意的情况下确认吊灯绳的切口？",
        pressure: "守灵人仍在大厅来回照看烛台。",
        opportunities: ["换一个角度观察", "请同伴制造合理的遮掩"],
        conclusionCandidate: null,
      },
      proposalAttemptId: "proposal:compound:1",
      modelInvocationReceipt: {
        provider: "cloudflare-workers-ai",
        modelId: "@cf/zai-org/glm-4.7-flash",
        modelRevision: "cloudflare-managed",
        modelProfileVersion: "authoritative-kp-profile-v1",
        promptPolicyVersion: "authoritative-kp-prompt-policy-v1",
        schemaVersion: "authoritative-kp-proposal-v1",
        task: "proposal",
        rootActionId: "assigned-by-room-action",
        attempt: 1,
        startedAt: 1,
        endedAt: 2,
        result: "success",
      },
    };
    const outcome = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        propose: async () => proposal,
        narrate: async () => ({ body: "吊链轻响，但你的观察已经得到权威结算。", agencyClaims: [] }),
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
      "NpcPlanFormed",
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
