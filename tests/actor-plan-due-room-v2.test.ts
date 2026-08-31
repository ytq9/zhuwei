import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  compileKpFormDraft,
  lowerCausalActionProgram,
} from "../app/_runtime/lib/kp/causal-action-program";
import { handleRoomAction } from "../app/_runtime/lib/room/action";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests";

type JsonRecord = Record<string, unknown>;

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  applyRoomAdministration(capability: unknown, command: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
};

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:actor-plan-due:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:actor-plan-due:bob", sessionVersion: 1 }),
});
const CAROL = Object.freeze({
  principal: Object.freeze({ id: "principal:actor-plan-due:carol", sessionVersion: 1 }),
});
const PLAYER_CHARACTER_ID = "character:actor-plan-due:alice";
const ACTIVITY_CHARACTER_ID = "character:actor-plan-due:carol";
const NPC_ID = "npc:actor-plan-due:watcher";
const NPC_KNOWLEDGE_REF = "knowledge:actor-plan-due:hidden-watch-order";
const NPC_UNFROZEN_KNOWLEDGE_REF = "knowledge:actor-plan-due:unfrozen-watch-secret";
const PLAYER_PRIVATE_REF = "knowledge:actor-plan-due:player-private-route";
const PLAYER_ACTIVITY_ID = "activity:actor-plan-due:player-investigation";
const ACTIVITY_BASIS_REF = "fact:actor-plan-due:shared-wake";
const PLAN_ID = "actor-plan:due:night-watch:close-yard";
const ACTIVITY_ID = "activity:actor-plan-due:close-yard";
const TRACE_FACT_REF = "fact:actor-plan-due:warning-cord";
const REVISED_TRACE_FACT_REF = "fact:actor-plan-due:guarded-wake";

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

function inputOf(request: JsonRecord): JsonRecord {
  return record(request.input, "KP request input");
}

async function unexpectedDueActorPlan(): Promise<never> {
  throw new Error("this action must not reach a due ActorPlan decision");
}

function formationProposal(rootActionId: string): JsonRecord {
  return actorPlanFormationProposal(rootActionId, {
    due: { kind: "activityCompletion" },
    trigger: null,
  });
}

function triggerFormationProposal(rootActionId: string): JsonRecord {
  return actorPlanFormationProposal(rootActionId, {
    due: null,
    trigger: {
      kind: "knowledgeAcquired",
      knowledgeRef: NPC_KNOWLEDGE_REF,
    },
  });
}

function mechanicalFormationProposal(rootActionId: string): JsonRecord {
  return formationProposal(rootActionId);
}

function actorPlanFormationProposal(
  rootActionId: string,
  schedule: {
    due: { kind: "activityCompletion" } | null;
    trigger: { kind: "knowledgeAcquired"; knowledgeRef: string } | null;
  },
  alternateTarget: { targetRef: string; reason: string } = {
    targetRef: "wake",
    reason: "院门已经不可用时，改为守住灵堂入口",
  },
): JsonRecord {
  const proposedFact = JSON.stringify({
    schema: "zhuwei.actor-plan-draft/v1",
    npcRef: NPC_ID,
    factionRef: null,
    planId: PLAN_ID,
    goal: "让守夜人依据自己的密令形成到期封门计划",
    premiseRefs: [NPC_KNOWLEDGE_REF],
    nextStep: "用警戒绳封闭院门",
    resourceRefs: [],
    activity: {
      activityId: ACTIVITY_ID,
      activityKind: "factionOperation",
      intendedDurationMicros: "1000000",
    },
    due: schedule.due,
    trigger: schedule.trigger,
    trace: {
      factRef: TRACE_FACT_REF,
      description: "院门前出现一条新拉起的警戒绳",
      visibilityPolicyRef: "visibility:scene-observers",
    },
    alternateTarget,
  });
  const draft = {
    goal: "让守夜人形成一项有限知识计划",
    method: "formActorPlan",
    proposedFact,
    basisRefs: [...new Set([
      "wake",
      NPC_ID,
      NPC_KNOWLEDGE_REF,
      alternateTarget.targetRef,
    ])],
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
    proposalAttemptId: `proposal:${rootActionId}:form-actor-plan`,
    modelInvocationReceipt: { task: "proposal", result: "success" },
  };
}

function executeDuePlanDecision(rootActionId: string) {
  return {
    kind: "actorPlanDecision",
    decision: "execute",
    planId: PLAN_ID,
    mechanicalProposal: null,
    proposalAttemptId: `proposal:${rootActionId}:execute-actor-plan`,
  };
}

function executeDuePlanCheckDecision(rootActionId: string) {
  return {
    kind: "actorPlanDecision",
    decision: "execute",
    planId: PLAN_ID,
    mechanicalProposal: {
      operation: "resolveNoncombatCheck",
      ability: "wis",
      skill: "perception",
      dc: 12,
      mode: "normal",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [],
      failure: [],
    },
    proposalAttemptId: `proposal:${rootActionId}:execute-actor-plan-check`,
  };
}

function cancelDuePlanDecision(rootActionId: string) {
  return {
    kind: "actorPlanDecision",
    decision: "cancel",
    planId: PLAN_ID,
    reason: "院门已经由城防接管，守夜人的封门行动不再必要",
    mechanicalProposal: null,
    proposalAttemptId: `proposal:${rootActionId}:cancel-actor-plan`,
  };
}

function deferDuePlanDecision(rootActionId: string, untilFictionMicros: string) {
  return {
    kind: "actorPlanDecision",
    decision: "defer",
    planId: PLAN_ID,
    reason: "城防交接尚未完成，等候两秒后再判断",
    deferUntilFictionMicros: untilFictionMicros,
    mechanicalProposal: null,
    proposalAttemptId: `proposal:${rootActionId}:defer-actor-plan`,
  };
}

function reviseDuePlanDecision(rootActionId: string) {
  return {
    kind: "actorPlanDecision",
    decision: "revise",
    planId: PLAN_ID,
    revision: {
      reason: "院门已经由城防接管，改守灵堂入口",
      premiseRefs: [NPC_KNOWLEDGE_REF],
      nextStep: "在灵堂入口拉起警戒绳",
      resourceRefs: [],
      due: { kind: "fictionTime", atFictionMicros: "2000000" },
      trigger: null,
      trace: {
        factRef: REVISED_TRACE_FACT_REF,
        description: "灵堂入口出现一条新拉起的警戒绳",
        visibilityPolicyRef: "visibility:scene-observers",
      },
      alternateTarget: {
        targetRef: "wake",
        reason: "院门不可用时，守住灵堂入口",
      },
    },
    mechanicalProposal: null,
    proposalAttemptId: `proposal:${rootActionId}:revise-actor-plan`,
  };
}

function executeAlternateDuePlanDecision(rootActionId: string) {
  return {
    ...executeDuePlanDecision(rootActionId),
    targetRef: "wake",
  };
}

function playerIntentProposal(rootActionId: string): JsonRecord {
  const draft = {
    goal: "从灵堂走向院门",
    method: "沿着同一场景中的石径走向院门",
    focus: "院门方向刚出现的变化",
    desiredInformation: "前往院门的路径现在是否仍然通畅",
    resolution: "direct",
    durationUnit: "second",
    durationValue: 1,
  };
  const program = compileKpFormDraft("observe.v1", draft);
  return {
    kind: "privateFormProposal",
    formId: "observe.v1",
    draft,
    causalActionProgram: program,
    loweredCausalProgram: lowerCausalActionProgram(program),
    semanticFreezeHash: program.semanticHash,
    repairUsed: false,
    proposalAttemptId: `proposal:${rootActionId}:player-intent`,
    modelInvocationReceipt: { provider: "test", requestId: `request:${rootActionId}` },
  };
}

async function initializeRoom(
  roomId: string,
  options: { withActivityCharacter?: boolean } = {},
): Promise<{
  authority: Authority;
  administrationCapability: unknown;
  archiveCapability: unknown;
}> {
  const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
  const initialized = record(await authority.initializeAuthoritative({
    roomId,
    moduleId: "black-oak-will",
    runtimeProfiles: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
    members: [
      { principalId: ALICE.principal.id, role: "host" },
      { principalId: BOB.principal.id, role: "player" },
      ...(options.withActivityCharacter
        ? [{ principalId: CAROL.principal.id, role: "player" }]
        : []),
    ],
    characters: [{
      characterId: PLAYER_CHARACTER_ID,
      controllerPrincipalId: ALICE.principal.id,
      staticCard: {
        name: "阿莱莎",
        sceneId: "wake",
        abilityScores: { str: 10, dex: 12, con: 12, int: 14, wis: 12, cha: 10 },
        proficiencyBonus: 2,
      },
    }, ...(options.withActivityCharacter
      ? [{
          characterId: ACTIVITY_CHARACTER_ID,
          controllerPrincipalId: CAROL.principal.id,
          staticCard: {
            name: "卡萝",
            sceneId: "wake",
            abilityScores: { str: 10, dex: 12, con: 12, int: 12, wis: 12, cha: 10 },
            proficiencyBonus: 2,
          },
        }]
      : [])],
    fixtureFacts: [{
      knowledgeRef: NPC_KNOWLEDGE_REF,
      holderEntityId: NPC_ID,
      holderName: "守夜人",
      sceneId: "wake",
      content: "只有守夜人知道：钟响后封闭院门，但不要惊动灵堂。",
    }, {
      knowledgeRef: NPC_UNFROZEN_KNOWLEDGE_REF,
      holderEntityId: NPC_ID,
      content: "只有守夜人知道：北墙后还藏着另一份未写入计划的密令。",
    }, {
      knowledgeRef: PLAYER_PRIVATE_REF,
      holderEntityId: PLAYER_CHARACTER_ID,
      content: "只有阿莱莎知道：她准备从侧门秘密离开。",
    }, {
      factRef: ACTIVITY_BASIS_REF,
      kind: "establishedCommunicationChannel",
      participants: [PLAYER_CHARACTER_ID, NPC_ID],
    }],
  }), "due ActorPlan room initialization");
  const capabilities = record(initialized.serviceCapabilities, "service capabilities");
  return {
    authority,
    administrationCapability: capabilities.roomAdministration,
    archiveCapability: capabilities.archiveExport,
  };
}

async function initializeMechanicalRoom(roomId: string): Promise<{
  authority: Authority;
  archiveCapability: unknown;
}> {
  const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
  const initialized = record(await authority.initializeAuthoritative({
    roomId,
    moduleId: "black-oak-will",
    runtimeProfiles: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
    members: [
      { principalId: ALICE.principal.id, role: "host" },
      { principalId: BOB.principal.id, role: "player" },
    ],
    characters: [{
      characterId: PLAYER_CHARACTER_ID,
      controllerPrincipalId: ALICE.principal.id,
      staticCard: {
        name: "阿莱莎",
        sceneId: "wake",
        abilityScores: { str: 10, dex: 12, con: 12, int: 14, wis: 12, cha: 10 },
        proficiencyBonus: 2,
      },
    }, {
      characterId: NPC_ID,
      controllerPrincipalId: BOB.principal.id,
      staticCard: {
        name: "守夜人",
        sceneId: "wake",
        abilityScores: { str: 12, dex: 12, con: 12, int: 10, wis: 14, cha: 10 },
        proficiencyBonus: 2,
        proficientSkills: ["perception"],
      },
    }],
    fixtureFacts: [{
      knowledgeRef: NPC_KNOWLEDGE_REF,
      holderEntityId: NPC_ID,
      content: "只有守夜人知道：钟响后封闭院门，但不要惊动灵堂。",
    }, {
      knowledgeRef: PLAYER_PRIVATE_REF,
      holderEntityId: PLAYER_CHARACTER_ID,
      content: "只有阿莱莎知道：她准备从侧门秘密离开。",
    }, {
      factRef: ACTIVITY_BASIS_REF,
      kind: "establishedCommunicationChannel",
      participants: [PLAYER_CHARACTER_ID, NPC_ID],
    }],
  }), "mechanical ActorPlan room initialization");
  const capabilities = record(initialized.serviceCapabilities, "mechanical service capabilities");
  return { authority, archiveCapability: capabilities.archiveExport };
}

async function retireMechanicalNpc(authority: Authority): Promise<void> {
  const outcome = record(await handleRoomAction({
    principal: BOB,
    authority,
    kp: {
      decideDueActorPlan: unexpectedDueActorPlan,
      async propose() {
        return {
          kind: "authenticatedCampaignAction",
          action: "retireCharacter",
          reason: "守夜人明确交还玩家控制权并继续留在故事中",
          continueAsNpc: true,
        };
      },
      async narrate() {
        return { body: "守夜人交还席位，但仍留在院中值守。", agencyClaims: [] };
      },
    },
  }, {
    kind: "intent",
    submissionId: "submission:actor-plan-due:retire-watcher",
    text: "我退席，但让守夜人继续留在故事中。",
  } as never), "retired mechanical NPC outcome");
  expect(outcome.kind, JSON.stringify(outcome)).toBe("committed");
}

async function startPlayerActivity(authority: Authority): Promise<void> {
  const submissionId = "submission:actor-plan-due:start-player-activity";
  const outcome = record(await handleRoomAction({
    principal: CAROL,
    authority,
    kp: {
      decideDueActorPlan: unexpectedDueActorPlan,
      async propose() {
        return {
          kind: "authenticatedCampaignAction",
          action: "startActivity",
          activityId: PLAYER_ACTIVITY_ID,
          activityKind: "investigation",
          intendedDurationMicros: "3600000000",
          completion: {
            method: "阿莱莎独自拓印并核对每一道刻痕",
            primaryFactRef: ACTIVITY_BASIS_REF,
            sourceSceneId: "wake",
            success: [],
            failure: [],
          },
        };
      },
      async narrate() {
        return { body: "阿莱莎开始逐段拓印院墙上的旧刻痕。", agencyClaims: [] };
      },
    },
  }, {
    kind: "intent",
    submissionId,
    text: "我开始拓印院墙上的旧刻痕。",
  } as never), "player Activity start outcome");
  expect(outcome.kind, JSON.stringify(outcome)).toBe("committed");
}

async function formDuePlan(
  authority: Authority,
  submissionId: string,
  proposalForRoot: (rootActionId: string) => ReturnType<typeof formationProposal> = formationProposal,
): Promise<void> {
  const formationInput = {
    kind: "intent",
    submissionId,
    text: "我在灵堂里观察守夜人的例行巡视。",
  };
  const preparedFormation = record(
    await authority.prepare(ALICE, formationInput),
    "ActorPlan formation preparation",
  );
  const formedProposal = proposalForRoot(String(preparedFormation.rootActionId));
  const outcome = record(await authority.commit(
    ALICE,
    String(preparedFormation.preparedActionId),
    {
      ...formedProposal,
      rootActionId: preparedFormation.rootActionId,
    },
  ), "ActorPlan formation outcome");
  expect(outcome.kind, JSON.stringify(outcome)).toBe("committed");
}

async function archiveEvents(authority: Authority, archiveCapability: unknown): Promise<JsonRecord[]> {
  const exported = record(
    await authority.exportAuthoritativeArchive(archiveCapability),
    "ActorPlan archive export",
  );
  const archive = record(exported.archive, "ActorPlan archive");
  return list(archive.events, "ActorPlan archive events")
    .map((event) => record(event, "ActorPlan archive event"));
}

describe("due ActorPlan Room Action phase", () => {
  it("executes one due finite-knowledge NPC plan before reprojecting the affected player intent on the same root", async () => {
    const { authority, archiveCapability } = await initializeRoom("actor-plan-due-execute-v2");
    await formDuePlan(authority, "submission:actor-plan-due:form:execute");

    const proposalRequests: JsonRecord[] = [];
    const requestPhases: string[] = [];
    const dueSubmissionId = "submission:actor-plan-due:execute";
    const outcome = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        async decideDueActorPlan(request) {
          requestPhases.push("dueActorPlan");
          const decisionRequest = structuredClone(record(request, "due decision request"));
          proposalRequests.push(decisionRequest);
          return executeDuePlanDecision(String(decisionRequest.rootActionId));
        },
        async propose(request) {
          const proposalRequest = structuredClone(record(request, "due proposal request"));
          requestPhases.push("playerIntent");
          proposalRequests.push(proposalRequest);
          return playerIntentProposal(String(proposalRequest.rootActionId));
        },
        async narrate() {
          return { body: "钟声落下，院门前已经横起警戒绳。", agencyClaims: [] };
        },
      },
    }, {
      kind: "intent",
      submissionId: dueSubmissionId,
      text: "我从灵堂走向院门。",
    } as never), "due ActorPlan outcome");

    expect(proposalRequests, "due plan must be decided before the player intent is proposed")
      .toHaveLength(2);
    expect(requestPhases).toEqual([
      "dueActorPlan",
      "playerIntent",
    ]);
    expect(outcome.kind, JSON.stringify(outcome)).toBe("committed");

    const dueRequest = proposalRequests[0];
    expect(dueRequest.rootActionId).toBe(`root-action:${dueSubmissionId}`);
    expect(record(dueRequest.dueActorPlan, "due ActorPlan request")).toMatchObject({
      planId: PLAN_ID,
      actorKind: "npc",
      actorRef: NPC_ID,
      decisionNpcId: NPC_ID,
      status: "scheduled",
      premiseRefs: [NPC_KNOWLEDGE_REF],
      nextStep: "用警戒绳封闭院门",
      due: { kind: "fictionTime", atFictionMicros: "1000000" },
      trace: { factRef: TRACE_FACT_REF },
    });
    const npcProjection = record(dueRequest.projection, "due NPC finite-knowledge projection");
    expect(npcProjection.viewer).toEqual({ kind: "npc", subjectId: NPC_ID });
    expect(list(npcProjection.npcPlans, "due NPC plans")).toHaveLength(1);
    expect(record(list(npcProjection.npcPlans, "due NPC plans")[0], "due NPC plan").planId)
      .toBe(PLAN_ID);
    expect(JSON.stringify(dueRequest)).not.toContain(PLAYER_PRIVATE_REF);
    expect(dueRequest).not.toHaveProperty("npcViewers");
    expect(dueRequest).not.toHaveProperty("input");

    const playerRequest = proposalRequests[1];
    expect(playerRequest.rootActionId).toBe(dueRequest.rootActionId);
    expect(inputOf(playerRequest)).toMatchObject({
      kind: "intent",
      submissionId: dueSubmissionId,
      text: "我从灵堂走向院门。",
    });
    const playerProjection = record(playerRequest.projection, "reprojected player-intent context");
    const actorProjection = record(playerProjection.actorProjection, "reprojected player actor");
    expect(BigInt(String(actorProjection.stateVersion)))
      .toBeGreaterThan(BigInt(String(npcProjection.stateVersion)));

    const receipt = record(outcome.receipt, "due ActorPlan receipt");
    expect(receipt.rootActionId).toBe(`root-action:${dueSubmissionId}`);
    const events = await archiveEvents(authority, archiveCapability);
    const npcActionIndex = events.findIndex((event) => {
      if (event.eventType !== "NpcActionCommitted") return false;
      const payload = record(event.payload, "NpcActionCommitted payload");
      return payload.planId === PLAN_ID
        && payload.npcId === NPC_ID
        && payload.causedByRootActionId === receipt.rootActionId;
    });
    const traceIndex = events.findIndex((event) => {
      if (event.eventType !== "CanonicalFactDeclared") return false;
      const payload = record(event.payload, "trace fact payload");
      return record(payload.fact, "trace fact").id === TRACE_FACT_REF;
    });
    const activityCompletedIndex = events.findIndex((event) =>
      event.eventType === "ActivityCompleted"
      && record(event.payload, "due ActivityCompleted payload").activityId === ACTIVITY_ID
    );
    const playerEventIndex = events.findIndex((event) => {
      if (event.eventType !== "ImprovisedActionResolved") return false;
      return event.rootActionId === receipt.rootActionId
        && record(event.payload, "player causal payload").actorCharacterId === PLAYER_CHARACTER_ID;
    });
    expect(npcActionIndex, "the due NPC action must retain explicit outer-root causality")
      .toBeGreaterThanOrEqual(0);
    expect(traceIndex, "the due plan must publish its pre-frozen observable trace").toBeGreaterThanOrEqual(0);
    expect(activityCompletedIndex, "the due ActorPlan activity must resolve").toBeGreaterThanOrEqual(0);
    expect(playerEventIndex, "the original player intent must resume after the due plan").toBeGreaterThanOrEqual(0);
    expect(npcActionIndex).toBeLessThan(playerEventIndex);
    expect(traceIndex).toBeLessThan(playerEventIndex);
    expect(activityCompletedIndex).toBeLessThan(playerEventIndex);
  });

  it("keeps the formation frontier unchanged when the due-plan model call fails", async () => {
    const { authority, archiveCapability } = await initializeRoom("actor-plan-due-model-failure-v2");
    await formDuePlan(authority, "submission:actor-plan-due:form:model-failure");
    const before = await archiveEvents(authority, archiveCapability);

    const dueSubmissionId = "submission:actor-plan-due:model-failure";
    const outcome = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        async decideDueActorPlan() {
          throw Object.assign(new Error("due ActorPlan model unavailable"), { retryAfter: 3 });
        },
        async propose(request) {
          const proposalRequest = record(request, "failing due proposal request");
          return playerIntentProposal(String(proposalRequest.rootActionId));
        },
        async narrate() {
          return { body: "不应生成任何新叙述。", agencyClaims: [] };
        },
      },
    }, {
      kind: "intent",
      submissionId: dueSubmissionId,
      text: "我从灵堂走向院门。",
    } as never), "due ActorPlan model failure outcome");

    expect(outcome).toMatchObject({
      kind: "retryableFailure",
      code: "PROPOSAL_PROVIDER_TIMEOUT",
      retryAfter: 3,
    });
    const after = await archiveEvents(authority, archiveCapability);
    expect(after, "model failure must leave the authoritative event frontier unchanged").toHaveLength(before.length);
    const tail = after.slice(before.length);
    expect(tail).toEqual([]);
    expect(JSON.stringify(tail)).not.toMatch(
      /Attack|Pass|TurnEnded|ActivityCompleted|FictionTimeAdvanced|ImprovisedActionResolved|NpcActionCommitted/,
    );
  });

  it("cancels a due plan explicitly, interrupts its Activity, and then resumes the player intent", async () => {
    const { authority, archiveCapability } = await initializeRoom("actor-plan-due-cancel-v2");
    await formDuePlan(authority, "submission:actor-plan-due:form:cancel");

    const phases: string[] = [];
    const submissionId = "submission:actor-plan-due:cancel";
    const outcome = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        async decideDueActorPlan(request) {
          phases.push("dueActorPlan");
          const decisionRequest = record(request, "cancel due decision request");
          return cancelDuePlanDecision(String(decisionRequest.rootActionId));
        },
        async propose(request) {
          const proposalRequest = record(request, "cancel due proposal request");
          phases.push("playerIntent");
          return playerIntentProposal(String(proposalRequest.rootActionId));
        },
        async narrate() {
          return { body: "城防已经接管院门，守夜人收起了警戒绳。", agencyClaims: [] };
        },
      },
    }, {
      kind: "intent",
      submissionId,
      text: "我从灵堂走向院门。",
    } as never), "cancelled ActorPlan outcome");

    expect(outcome.kind, JSON.stringify(outcome)).toBe("committed");
    expect(phases).toEqual(["dueActorPlan", "playerIntent"]);
    const events = await archiveEvents(authority, archiveCapability);
    const cancellationIndex = events.findIndex((event) =>
      event.eventType === "NpcPlanCancelled"
      && record(event.payload, "NpcPlanCancelled payload").planId === PLAN_ID
    );
    const interruptedIndex = events.findIndex((event) =>
      event.eventType === "ActivityInterrupted"
      && record(event.payload, "cancelled Activity payload").activityId === ACTIVITY_ID
    );
    const playerIndex = events.findIndex((event) =>
      event.eventType === "ImprovisedActionResolved"
      && event.rootActionId === `root-action:${submissionId}`
    );
    expect(cancellationIndex).toBeGreaterThanOrEqual(0);
    expect(interruptedIndex).toBeGreaterThan(cancellationIndex);
    expect(playerIndex).toBeGreaterThan(interruptedIndex);
    expect(JSON.stringify(events)).not.toMatch(/Attack|Pass|TurnEnded/);
  });

  it("rejects a due-plan lifecycle decision prepared by a former controller", async () => {
    const { authority, administrationCapability } = await initializeRoom(
      "actor-plan-due-control-transfer-v2",
    );
    await formDuePlan(authority, "submission:actor-plan-due:form:control-transfer");
    const due = record(await authority.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:actor-plan-due:prepared-before-control-transfer",
      text: "我从灵堂走向院门。",
    }), "prepared due stage before control transfer");
    expect(due).toMatchObject({ kind: "prepared", phase: "dueActorPlan" });
    const decision = {
      ...cancelDuePlanDecision(String(due.rootActionId)),
      rootActionId: due.rootActionId,
    };

    await expect(authority.applyRoomAdministration(administrationCapability, {
      commandId: "room-admin:actor-plan-due-transfer",
      kind: "transferControl",
      characterId: PLAYER_CHARACTER_ID,
      fromSeatId: `seat:${ALICE.principal.id}`,
      toSeatId: `seat:${BOB.principal.id}`,
    })).resolves.toMatchObject({ kind: "committed" });
    await expect(authority.commit(
      ALICE,
      String(due.preparedActionId),
      structuredClone(decision),
    )).resolves.toMatchObject({ kind: "rejected", code: "preparedActionUnauthorized" });
    await expect(authority.commit(
      BOB,
      String(due.preparedActionId),
      structuredClone(decision),
    )).resolves.toMatchObject({ kind: "rejected", code: "preparedActionUnauthorized" });
    await expect(authority.prepare(BOB, {
      kind: "intent",
      submissionId: "submission:actor-plan-due:fresh-after-control-transfer",
      text: "我按当前状态重新处理守夜人的到期计划。",
    })).resolves.toMatchObject({ kind: "prepared", phase: "dueActorPlan" });
  });

  it("defers a due plan to a later fiction instant without completing its Activity or firing early", async () => {
    const { authority, archiveCapability } = await initializeRoom("actor-plan-due-defer-v2");
    await formDuePlan(authority, "submission:actor-plan-due:form:defer");

    const firstPhases: string[] = [];
    const deferred = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        async decideDueActorPlan(request) {
          firstPhases.push("dueActorPlan");
          const decisionRequest = record(request, "defer decision request");
          return deferDuePlanDecision(String(decisionRequest.rootActionId), "3000000");
        },
        async propose(request) {
          const proposalRequest = record(request, "defer proposal request");
          firstPhases.push("playerIntent");
          return playerIntentProposal(String(proposalRequest.rootActionId));
        },
        async narrate() {
          return { body: "守夜人决定再等一会儿。", agencyClaims: [] };
        },
      },
    }, {
      kind: "intent",
      submissionId: "submission:actor-plan-due:defer:first",
      text: "我在灵堂里再等一会儿。",
    } as never), "deferred ActorPlan outcome");
    expect(deferred.kind, JSON.stringify(deferred)).toBe("committed");
    expect(firstPhases).toEqual(["dueActorPlan", "playerIntent"]);

    const beforeDuePhases: string[] = [];
    const beforeDue = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        decideDueActorPlan: unexpectedDueActorPlan,
        async propose(request) {
          const proposalRequest = record(request, "before deferred due request");
          beforeDuePhases.push(String(proposalRequest.phase ?? "playerIntent"));
          return playerIntentProposal(String(proposalRequest.rootActionId));
        },
        async narrate() {
          return { body: "第二秒过去，守夜人尚未行动。", agencyClaims: [] };
        },
      },
    }, {
      kind: "intent",
      submissionId: "submission:actor-plan-due:defer:before-due",
      text: "我继续等一秒。",
    } as never), "before deferred due outcome");
    expect(beforeDue.kind, JSON.stringify(beforeDue)).toBe("committed");
    expect(beforeDuePhases).toEqual(["playerIntent"]);

    const atDuePhases: string[] = [];
    const atDue = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        async decideDueActorPlan(request) {
          atDuePhases.push("dueActorPlan");
          const decisionRequest = record(request, "at deferred due decision request");
          return cancelDuePlanDecision(String(decisionRequest.rootActionId));
        },
        async propose(request) {
          const proposalRequest = record(request, "at deferred due request");
          atDuePhases.push("playerIntent");
          return playerIntentProposal(String(proposalRequest.rootActionId));
        },
        async narrate() {
          return { body: "约定时刻已经抵达。", agencyClaims: [] };
        },
      },
    }, {
      kind: "intent",
      submissionId: "submission:actor-plan-due:defer:at-due",
      text: "我再次观察院门。",
    } as never), "at deferred due outcome");
    expect(atDue.kind, JSON.stringify(atDue)).toBe("committed");
    expect(atDuePhases).toEqual(["dueActorPlan", "playerIntent"]);

    const events = await archiveEvents(authority, archiveCapability);
    const revisions = events.filter((event) =>
      event.eventType === "NpcPlanRevised"
      && record(event.payload, "deferred plan revision").planId === PLAN_ID
    );
    expect(revisions).toHaveLength(1);
    expect(record(revisions[0].payload, "deferred plan payload")).toMatchObject({
      decision: "defer",
      priorRevision: "1",
      revision: "2",
      due: { kind: "fictionTime", atFictionMicros: "3000000" },
      trigger: null,
    });
    expect(events.filter((event) =>
      event.eventType === "ActivityCompleted"
      && record(event.payload, "deferred Activity completion").activityId === ACTIVITY_ID
    )).toHaveLength(0);
  });

  it("revises a due plan from finite knowledge, then explicitly executes its frozen alternate target", async () => {
    const { authority, archiveCapability } = await initializeRoom("actor-plan-due-revise-alternate-v2");
    await formDuePlan(authority, "submission:actor-plan-due:form:revise");

    const revised = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        async decideDueActorPlan(request) {
          const decisionRequest = record(request, "revision decision request");
          return reviseDuePlanDecision(String(decisionRequest.rootActionId));
        },
        async propose(request) {
          const proposalRequest = record(request, "revision proposal request");
          return playerIntentProposal(String(proposalRequest.rootActionId));
        },
        async narrate() {
          return { body: "守夜人把计划改为守住灵堂入口。", agencyClaims: [] };
        },
      },
    }, {
      kind: "intent",
      submissionId: "submission:actor-plan-due:revise",
      text: "我观察院门交接。",
    } as never), "revised ActorPlan outcome");
    expect(revised.kind, JSON.stringify(revised)).toBe("committed");

    const phases: string[] = [];
    const executed = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        async decideDueActorPlan(request) {
          phases.push("dueActorPlan");
          const decisionRequest = record(request, "alternate execution decision request");
          return executeAlternateDuePlanDecision(String(decisionRequest.rootActionId));
        },
        async propose(request) {
          const proposalRequest = record(request, "alternate execution request");
          phases.push("playerIntent");
          return playerIntentProposal(String(proposalRequest.rootActionId));
        },
        async narrate() {
          return { body: "守夜人在灵堂入口拉起警戒绳。", agencyClaims: [] };
        },
      },
    }, {
      kind: "intent",
      submissionId: "submission:actor-plan-due:execute-alternate",
      text: "我走向灵堂入口。",
    } as never), "alternate ActorPlan execution outcome");
    expect(executed.kind, JSON.stringify(executed)).toBe("committed");
    expect(phases).toEqual(["dueActorPlan", "playerIntent"]);

    const events = await archiveEvents(authority, archiveCapability);
    const revision = events.find((event) =>
      event.eventType === "NpcPlanRevised"
      && record(event.payload, "revised plan payload").decision === "revise"
    );
    expect(revision).toBeDefined();
    expect(record(revision!.payload, "revised plan payload")).toMatchObject({
      priorRevision: "1",
      revision: "2",
      nextStep: "在灵堂入口拉起警戒绳",
      alternateTarget: { targetRef: "wake" },
    });
    const action = events.find((event) =>
      event.eventType === "NpcActionCommitted"
      && record(event.payload, "alternate NpcAction payload").planId === PLAN_ID
    );
    expect(action).toBeDefined();
    expect(record(action!.payload, "alternate NpcAction payload")).toMatchObject({
      decision: "execute",
      targetRef: "wake",
      nextStep: "在灵堂入口拉起警戒绳",
      traceFactRef: REVISED_TRACE_FACT_REF,
    });
    const trace = events.find((event) =>
      event.eventType === "CanonicalFactDeclared"
      && record(record(event.payload, "revised trace payload").fact, "revised trace fact").id
        === REVISED_TRACE_FACT_REF
    );
    expect(record(record(trace!.payload, "revised trace payload").fact, "revised trace fact"))
      .toMatchObject({ subjectRefs: [NPC_ID, "wake"] });
  });

  it("executes a knowledge-triggered plan before the affected player intent without advancing real time", async () => {
    const { authority, archiveCapability } = await initializeRoom("actor-plan-trigger-execute-v2");
    const formed = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        decideDueActorPlan: unexpectedDueActorPlan,
        async propose(request) {
          return triggerFormationProposal(String(record(request, "trigger formation request").rootActionId));
        },
        async narrate() {
          return { body: "守夜人得知密令后开始准备。", agencyClaims: [] };
        },
      },
    }, {
      kind: "intent",
      submissionId: "submission:actor-plan-trigger:form",
      text: "我观察守夜人的例行巡视。",
    } as never), "trigger ActorPlan formation outcome");
    expect(formed.kind, JSON.stringify(formed)).toBe("committed");

    const phases: string[] = [];
    const submissionId = "submission:actor-plan-trigger:execute";
    const executed = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        async decideDueActorPlan(request) {
          phases.push("dueActorPlan");
          const decisionRequest = record(request, "trigger execution decision request");
          return executeDuePlanDecision(String(decisionRequest.rootActionId));
        },
        async propose(request) {
          const proposalRequest = record(request, "trigger execution request");
          phases.push("playerIntent");
          return playerIntentProposal(String(proposalRequest.rootActionId));
        },
        async narrate() {
          return { body: "守夜人按已经获得的密令拉起警戒绳。", agencyClaims: [] };
        },
      },
    }, {
      kind: "intent",
      submissionId,
      text: "我走向院门。",
    } as never), "triggered ActorPlan execution outcome");
    expect(executed.kind, JSON.stringify(executed)).toBe("committed");
    expect(phases).toEqual(["dueActorPlan", "playerIntent"]);

    const events = await archiveEvents(authority, archiveCapability);
    const plan = events.find((event) => event.eventType === "NpcPlanFormed");
    expect(record(plan!.payload, "triggered NpcPlanFormed payload")).toMatchObject({
      due: null,
      trigger: { kind: "knowledgeAcquired", knowledgeRef: NPC_KNOWLEDGE_REF },
    });
    const action = events.find((event) =>
      event.eventType === "NpcActionCommitted"
      && event.rootActionId === `actor-plan-due:${PLAN_ID}:trigger:knowledgeAcquired`
    );
    expect(action).toBeDefined();
    expect(record(action!.payload, "triggered NpcAction payload").causedByRootActionId)
      .toBe(`root-action:${submissionId}`);
  });

  it("rejects unfrozen due-plan activities, knowledge, and recipients before lifecycle events", async () => {
    const roomId = "actor-plan-due-capability-guard-v2";
    const { authority, archiveCapability } = await initializeRoom(roomId, {
      withActivityCharacter: true,
    });
    await startPlayerActivity(authority);
    await formDuePlan(
      authority,
      "submission:actor-plan-due:form:capability-guard",
      formationProposal,
    );

    const submissionId = "submission:actor-plan-due:capability-guard";
    const intent = {
      kind: "intent",
      submissionId,
      text: "我走向院门，看看守夜人的计划是否已经完成。",
    };
    const prepared = record(await authority.prepare(ALICE, intent), "prepared guarded due stage");
    expect(prepared).toMatchObject({
      kind: "prepared",
      phase: "dueActorPlan",
      rootActionId: `root-action:${submissionId}`,
    });
    const rootActionId = String(prepared.rootActionId);
    const baseDecision = {
      ...executeDuePlanDecision(rootActionId),
      rootActionId,
    };
    const before = await archiveEvents(authority, archiveCapability);
    const rejectedCapabilities = [{
      label: "interrupt another character's active Activity",
      mechanicalProposal: { operation: "interruptActivity", activityRef: PLAYER_ACTIVITY_ID },
    }, {
      label: "complete another character's active Activity",
      mechanicalProposal: { operation: "completeActivity", activityRef: PLAYER_ACTIVITY_ID },
    }, {
      label: "acquire held but unfrozen knowledge without recipients",
      mechanicalProposal: {
        operation: "changeKnowledge",
        knowledgeRef: NPC_UNFROZEN_KNOWLEDGE_REF,
      },
    }, {
      label: "share held but unfrozen knowledge",
      mechanicalProposal: {
        operation: "changeKnowledge",
        knowledgeRef: NPC_UNFROZEN_KNOWLEDGE_REF,
        recipientRefs: [PLAYER_CHARACTER_ID],
      },
    }, {
      label: "share frozen knowledge with an unfrozen recipient",
      mechanicalProposal: {
        operation: "changeKnowledge",
        knowledgeRef: NPC_KNOWLEDGE_REF,
        recipientRefs: [PLAYER_CHARACTER_ID],
      },
    }];
    for (const candidate of rejectedCapabilities) {
      await expect(authority.commit(ALICE, String(prepared.preparedActionId), {
        ...baseDecision,
        mechanicalProposal: candidate.mechanicalProposal,
      }), candidate.label).resolves.toMatchObject({
        kind: "rejected",
        code: "privateOrUnknownReference",
      });
      expect(
        await archiveEvents(authority, archiveCapability),
        `${candidate.label} must not commit the due lifecycle prefix`,
      ).toEqual(before);
    }

    const continued = record(await authority.commit(ALICE, String(prepared.preparedActionId), {
      ...baseDecision,
      mechanicalProposal: {
        operation: "changeKnowledge",
        knowledgeRef: TRACE_FACT_REF,
      },
    }), "frozen no-recipient knowledge outcome");
    expect(continued).toMatchObject({
      kind: "continue",
      prepared: { phase: "playerIntent" },
    });
    const after = await archiveEvents(authority, archiveCapability);
    expect(after.some((event) =>
      event.eventType === "NpcActionCommitted"
      && record(event.payload, "guarded NpcAction payload").planId === PLAN_ID
    )).toBe(true);
    expect(after.some((event) =>
      event.eventType === "ActivityCompleted"
      && record(event.payload, "guarded plan Activity payload").activityId === ACTIVITY_ID
    )).toBe(true);
    expect(after.some((event) =>
      event.eventType === "SensoryEvidenceAcquired"
      && record(event.payload, "frozen no-recipient knowledge payload").characterId === NPC_ID
      && record(event.payload, "frozen no-recipient knowledge payload").factId === TRACE_FACT_REF
    )).toBe(true);
    expect(after.some((event) =>
      (event.eventType === "ActivityInterrupted" || event.eventType === "ActivityCompleted")
      && record(event.payload, "foreign Activity payload").activityId === PLAYER_ACTIVITY_ID
    )).toBe(false);
  }, 15_000);

  it("shares only plan-frozen knowledge with the exact frozen due target", async () => {
    const roomId = "actor-plan-due-frozen-knowledge-recipient-v2";
    const { authority, archiveCapability } = await initializeRoom(roomId);
    await formDuePlan(
      authority,
      "submission:actor-plan-due:form:frozen-recipient",
      (rootActionId) => actorPlanFormationProposal(rootActionId, {
        due: { kind: "activityCompletion" },
        trigger: null,
      }, {
        targetRef: PLAYER_CHARACTER_ID,
        reason: "院门处的行动需要直接告知在场的阿莱莎",
      }),
    );

    const submissionId = "submission:actor-plan-due:frozen-recipient";
    const prepared = record(await authority.prepare(ALICE, {
      kind: "intent",
      submissionId,
      text: "我留在原地，等守夜人说明行动结果。",
    }), "prepared frozen-recipient due stage");
    expect(prepared).toMatchObject({ kind: "prepared", phase: "dueActorPlan" });
    const rootActionId = String(prepared.rootActionId);
    const continued = record(await authority.commit(ALICE, String(prepared.preparedActionId), {
      ...executeDuePlanDecision(rootActionId),
      rootActionId,
      targetRef: PLAYER_CHARACTER_ID,
      mechanicalProposal: {
        operation: "changeKnowledge",
        knowledgeRef: NPC_KNOWLEDGE_REF,
        recipientRefs: [PLAYER_CHARACTER_ID],
      },
    }), "frozen-recipient knowledge outcome");
    expect(continued).toMatchObject({
      kind: "continue",
      prepared: { phase: "playerIntent" },
    });

    const events = await archiveEvents(authority, archiveCapability);
    const acquired = events.find((event) => {
      if (event.eventType !== "KnowledgeAcquired") return false;
      const payload = record(event.payload, "shared knowledge payload");
      if (payload.characterId !== PLAYER_CHARACTER_ID || !Array.isArray(payload.items)) return false;
      return payload.items.some((item) =>
        record(item, "shared knowledge item").knowledgeRef === NPC_KNOWLEDGE_REF);
    });
    expect(acquired).toBeDefined();
  }, 10_000);

  it("resumes exactly once after eviction both before and after the due-plan commit", async () => {
    const roomId = "actor-plan-due-two-evictions-v2";
    const { authority: initialAuthority, archiveCapability } = await initializeRoom(roomId);
    let authority = initialAuthority;
    await formDuePlan(authority, "submission:actor-plan-due:form:eviction");

    const submissionId = "submission:actor-plan-due:two-evictions";
    const intent = {
      kind: "intent",
      submissionId,
      text: "我从灵堂走向院门。",
    };
    const prepared = record(
      await authority.prepare(ALICE, intent),
      "prepared due stage before eviction",
    );
    expect(prepared).toMatchObject({
      kind: "prepared",
      phase: "dueActorPlan",
      rootActionId: `root-action:${submissionId}`,
    });
    const preparedActionId = String(prepared.preparedActionId);

    await evictDurableObject(authority as never);
    authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const dueDecision = {
      ...executeDuePlanDecision(String(prepared.rootActionId)),
      rootActionId: prepared.rootActionId,
    };
    const continued = record(
      await authority.commit(ALICE, preparedActionId, dueDecision),
      "continued player stage after first eviction",
    );
    expect(continued).toMatchObject({
      kind: "continue",
      prepared: { phase: "playerIntent", preparedActionId },
    });

    await evictDurableObject(authority as never);
    authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const recovered = record(
      await authority.prepare(ALICE, intent),
      "recovered player stage after second eviction",
    );
    expect(recovered).toEqual(record(continued.prepared, "persisted continued stage"));

    const playerProposal = {
      ...playerIntentProposal(String(prepared.rootActionId)),
      rootActionId: prepared.rootActionId,
    };
    const committed = record(
      await authority.commit(ALICE, preparedActionId, playerProposal),
      "committed player intent after recovery",
    );
    expect(committed.kind, JSON.stringify(committed)).toBe("committed");
    const eventsBeforeRetry = await archiveEvents(authority, archiveCapability);

    await evictDurableObject(authority as never);
    authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const retried = record(
      await authority.commit(ALICE, preparedActionId, playerProposal),
      "idempotent final retry after eviction",
    );
    expect(retried).toEqual(committed);

    const events = await archiveEvents(authority, archiveCapability);
    expect(events).toEqual(eventsBeforeRetry);
    expect(events.filter((event) =>
      event.eventType === "NpcActionCommitted"
      && record(event.payload, "eviction NpcAction payload").planId === PLAN_ID
    )).toHaveLength(1);
    expect(events.filter((event) =>
      event.eventType === "CanonicalFactDeclared"
      && record(record(event.payload, "eviction trace payload").fact, "eviction trace fact").id
        === TRACE_FACT_REF
    )).toHaveLength(1);
    expect(events.filter((event) =>
      event.eventType === "ActivityCompleted"
      && record(event.payload, "eviction Activity payload").activityId === ACTIVITY_ID
    )).toHaveLength(1);
    expect(events.filter((event) =>
      event.eventType === "ImprovisedActionResolved"
      && event.rootActionId === `root-action:${submissionId}`
      && record(event.payload, "eviction causal freeze payload").outcomeCode
        === "causal-program-frozen"
    )).toHaveLength(1);
    expect(events.filter((event) =>
      event.eventType === "ImprovisedActionResolved"
      && event.rootActionId === `root-action:${submissionId}`
      && record(event.payload, "eviction causal terminal payload").outcomeCode
        === "causal-node:n01:success"
    )).toHaveLength(1);
  });

  for (const checkpoint of [
    "afterRandomnessRequestCommit",
    "afterRandomnessCandidateCommit",
    "afterOutcomeCommitBeforeResponse",
  ] as const) {
  it(`recovers a due NPC check at ${checkpoint} without rerolling or skipping the player intent`, async () => {
    const suffix = checkpoint.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    const roomId = `actor-plan-due-check-${suffix}-v2`;
    const {
      authority: initialAuthority,
      archiveCapability,
    } = await initializeMechanicalRoom(roomId);
    let authority = initialAuthority;
    await retireMechanicalNpc(authority);
    await formDuePlan(
      authority,
      `submission:actor-plan-due:form:check:${suffix}`,
      mechanicalFormationProposal,
    );

    const submissionId = `submission:actor-plan-due:check:${suffix}`;
    const intent = {
      kind: "intent",
      submissionId,
      text: "我从灵堂走向院门。",
    };
    const prepared = record(await authority.prepare(ALICE, intent), "prepared due check stage");
    expect(prepared).toMatchObject({
      kind: "prepared",
      phase: "dueActorPlan",
      rootActionId: `root-action:${submissionId}`,
    });
    const preparedActionId = String(prepared.preparedActionId);
    const dueDecision = {
      ...executeDuePlanCheckDecision(String(prepared.rootActionId)),
      rootActionId: prepared.rootActionId,
    };
    expect(JSON.stringify(dueDecision)).not.toMatch(/"(?:rolls|faces|selectedRoll)"/);
    if (checkpoint === "afterRandomnessRequestCommit") {
      const mechanical = record(dueDecision.mechanicalProposal, "due check mechanical proposal");
      const forgedCases = [{
        label: "unfrozen NPC premise",
        expectedCode: "privateOrUnknownReference",
        proposal: { ...mechanical, basisRefs: [PLAYER_PRIVATE_REF] },
      }, {
        label: "unfrozen target",
        expectedCode: "privateOrUnknownReference",
        proposal: { ...mechanical, targetEntityRef: PLAYER_CHARACTER_ID },
      }, {
        label: "unfrozen resource cost",
        expectedCode: "privateOrUnknownReference",
        proposal: {
          ...mechanical,
          frozenCosts: [{
            kind: "consumeResource",
            resourceRef: "resource:actor-plan-due:forged",
            amount: 1,
          }],
        },
      }, {
        label: "Rules-illegal DC",
        expectedCode: "invalidRulesInput",
        proposal: { ...mechanical, dc: 31 },
      }, {
        label: "unfrozen secret knowledge effect",
        expectedCode: "privateOrUnknownReference",
        proposal: {
          ...mechanical,
          success: [{
            kind: "acquireKnowledge",
            definitionRef: PLAYER_PRIVATE_REF,
            knowledgeRef: "knowledge:actor-plan-due:forged-player-secret",
          }],
        },
      }, {
        label: "unfrozen resource effect",
        expectedCode: "privateOrUnknownReference",
        proposal: {
          ...mechanical,
          success: [{
            kind: "changeResource",
            resourceRef: "resource:actor-plan-due:forged",
            delta: 1,
          }],
        },
      }, {
        label: "unfrozen movement effect",
        expectedCode: "privateOrUnknownReference",
        proposal: {
          ...mechanical,
          success: [{
            kind: "moveEntity",
            sceneRef: "scene:actor-plan-due:forged",
          }],
        },
      }, {
        label: "campaign lifecycle authority",
        expectedCode: "privateOrUnknownReference",
        proposal: {
          operation: "advanceCampaignLifecycle",
          lifecycleAction: "concludeStory",
        },
      }];
      for (const forged of forgedCases) {
        await expect(authority.commit(ALICE, preparedActionId, {
          ...dueDecision,
          mechanicalProposal: forged.proposal,
        }), forged.label).resolves.toMatchObject({
          kind: "rejected",
          code: forged.expectedCode,
        });
      }
    }

    await expect(runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityRecoveryCheckpoint?: (checkpoint: string) => void;
        commit(context: unknown, id: string, proposal: unknown): Promise<unknown>;
      };
      target.authorityRecoveryCheckpoint = (seenCheckpoint) => {
        if (seenCheckpoint === checkpoint) {
          throw new Error(`actor-plan-due-check-response-loss:${checkpoint}`);
        }
      };
      return target.commit(ALICE, preparedActionId, structuredClone(dueDecision));
    })).rejects.toThrow(`actor-plan-due-check-response-loss:${checkpoint}`);

    await evictDurableObject(authority as never);
    authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const recovered = record(
      await authority.commit(ALICE, preparedActionId, structuredClone(dueDecision)),
      "recovered due check stage",
    );
    expect(recovered).toMatchObject({
      kind: "continue",
      prepared: {
        phase: "playerIntent",
        preparedActionId,
        receipt: {
          status: "committed",
          randomnessCommitments: [expect.any(Object)],
        },
        kpProjection: {
          mechanicalResult: {
            kind: "committed",
            randomness: [{ faces: [expect.any(Number)] }],
          },
        },
      },
    });
    const repeated = record(
      await authority.commit(ALICE, preparedActionId, structuredClone(dueDecision)),
      "idempotent due check retry",
    );
    expect(repeated).toEqual(recovered);

    const playerProposal = {
      ...playerIntentProposal(String(prepared.rootActionId)),
      rootActionId: prepared.rootActionId,
    };
    await expect(authority.commit(ALICE, preparedActionId, playerProposal))
      .resolves.toMatchObject({ kind: "committed" });

    const events = await archiveEvents(authority, archiveCapability);
    const npcAction = events.find((event) =>
      event.eventType === "NpcActionCommitted"
      && record(event.payload, "checked NpcAction payload").planId === PLAN_ID
    );
    expect(npcAction).toBeDefined();
    const childRootActionId = String(npcAction!.rootActionId);
    const childEvents = events.filter((event) => event.rootActionId === childRootActionId);
    expect(childEvents.filter((event) => event.eventType === "RandomnessRequested")).toHaveLength(1);
    expect(childEvents.filter((event) => event.eventType === "DiceRolled")).toHaveLength(1);
    expect(childEvents.filter((event) => event.eventType === "ImprovisedCheckResolved")).toHaveLength(1);
    expect(childEvents.filter((event) => event.eventType === "NpcActionCommitted")).toHaveLength(1);
    expect(childEvents.filter((event) => event.eventType === "ActivityCompleted")).toHaveLength(1);
    const dice = record(
      childEvents.find((event) => event.eventType === "DiceRolled")!.payload,
      "due check DiceRolled payload",
    );
    const recoveredPrepared = record(recovered.prepared, "recovered due check prepared stage");
    const recoveredProjection = record(recoveredPrepared.kpProjection, "recovered due check projection");
    const mechanicalResult = record(recoveredProjection.mechanicalResult, "due check mechanical result");
    const recoveredRandomness = record(
      list(mechanicalResult.randomness, "due check randomness")[0],
      "due check randomness result",
    );
    expect(dice.faces).toEqual(recoveredRandomness.faces);
    const playerEventIndex = events.findIndex((event) =>
      event.eventType === "ImprovisedActionResolved"
      && event.rootActionId === `root-action:${submissionId}`
    );
    expect(events.indexOf(childEvents.find((event) => event.eventType === "ImprovisedCheckResolved")!))
      .toBeLessThan(playerEventIndex);

    const archive = record(
      record(await authority.exportAuthoritativeArchive(archiveCapability), "due check export").archive,
      "due check archive",
    );
    const dueReceipt = record(recoveredPrepared.receipt, "due check Receipt");
    expect(list(archive.receiptRefs, "due check receipt refs").filter((entry) =>
      record(entry, "due check receipt ref").receiptId === dueReceipt.receiptId
    )).toHaveLength(1);
  }, 15_000);
  }
});
