import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthoritativeKpModelError,
  createAuthoritativeKpAdapter,
} from "../app/_runtime/lib/kp/authoritative.ts";
import {
  ACTOR_PLAN_DECISION_TOOL,
  ACTOR_PLAN_DECISION_TOOL_NAME,
  validateActorPlanDecisionOutput,
} from "../app/_runtime/lib/kp/actor-plan-policy.ts";
import { V3_AUTHORITATIVE_KP_PROFILES } from "../app/_runtime/lib/kp/authoritative-policy.ts";
import { handleRoomAction } from "../app/_runtime/lib/room/action.ts";

const ROOT_ACTION_ID = "root-action:due-plan-v3";
const PREPARED_ACTION_ID = "prepared-action:due-plan-v3";
const NPC_ID = "npc:due-plan-v3:warden";
const PLAN_ID = "actor-plan:due-plan-v3:bar-gate";
const KNOWLEDGE_REF = "knowledge:due-plan-v3:gate-order";
const RESOURCE_REF = "resource:due-plan-v3:iron-bar";
const ALTERNATE_TARGET_REF = "scene:due-plan-v3:inner-gate";

const ACTOR_PLAN = Object.freeze({
  planId: PLAN_ID,
  actorKind: "npc",
  actorRef: NPC_ID,
  decisionNpcId: NPC_ID,
  status: "scheduled",
  premiseRefs: Object.freeze([KNOWLEDGE_REF]),
  knowledgeRefs: Object.freeze([KNOWLEDGE_REF]),
  resourceRefs: Object.freeze([RESOURCE_REF]),
  goal: "依照密令封住外院",
  nextStep: "把铁栓推入外院门槽",
  revision: "1",
  activity: Object.freeze({
    activityId: "activity:due-plan-v3:bar-gate",
    activityKind: "factionOperation",
    intendedDurationMicros: "1000000",
  }),
  due: Object.freeze({ kind: "fictionTime", atFictionMicros: "100" }),
  trigger: null,
  trace: Object.freeze({
    factRef: "fact:due-plan-v3:barred-gate",
    description: "外院门槽中出现一根推入的铁栓",
    visibilityPolicyRef: "visibility:scene-observers",
  }),
  alternateTarget: Object.freeze({
    targetRef: ALTERNATE_TARGET_REF,
    reason: "外院门已失守时改守内门",
  }),
});

const NPC_PROJECTION = Object.freeze({
  kind: "projected",
  runtimeProfiles: Object.freeze({ hiddenFromModel: "profile:server-only" }),
  stateVersion: "12",
  activeBranchId: "branch:main",
  viewer: Object.freeze({ kind: "npc", subjectId: NPC_ID }),
  controlledCharacter: Object.freeze({
    id: NPC_ID,
    kind: "npc",
    sceneId: "scene:due-plan-v3:outer-gate",
  }),
  fictionTime: Object.freeze({ branchId: "branch:main", nowMicros: "100" }),
  knowledge: Object.freeze([{ knowledgeRef: KNOWLEDGE_REF }]),
  resources: Object.freeze([{ resourceRef: RESOURCE_REF }]),
  visibleScenes: Object.freeze([{ sceneRef: ALTERNATE_TARGET_REF }]),
  npcPlans: Object.freeze([ACTOR_PLAN]),
  dueActorPlan: ACTOR_PLAN,
  dueActorPlanChildRootActionId: "actor-plan-due:child:v3",
  projectionHash: "projection:due-plan-v3:npc",
});

const DECISION_REQUEST = Object.freeze({
  preparedActionId: PREPARED_ACTION_ID,
  rootActionId: ROOT_ACTION_ID,
  dueActorPlan: ACTOR_PLAN,
  projection: NPC_PROJECTION,
  attempt: 1,
});

function toolResponse(value) {
  return {
    id: "model-response:due-actor-plan-v3",
    object: "chat.completion",
    created: 1_788_000_000,
    model: V3_AUTHORITATIVE_KP_PROFILES[0].modelId,
    choices: [{
      index: 0,
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call:due-actor-plan-v3",
          type: "function",
          function: {
            name: ACTOR_PLAN_DECISION_TOOL_NAME,
            arguments: JSON.stringify(value),
          },
        }],
      },
    }],
    usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 },
  };
}

function executeDecision() {
  return {
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
  };
}

test("V3 due ActorPlan uses an isolated finite-NPC tool boundary without Form/Context", async () => {
  const calls = [];
  let contextPreparationCalls = 0;
  const adapter = createAuthoritativeKpAdapter({
    profile: V3_AUTHORITATIVE_KP_PROFILES[0],
    prepareV3Context: async () => {
      contextPreparationCalls += 1;
      throw new Error("due ActorPlan must not prepare player Form context");
    },
    ai: {
      async run(model, input) {
        calls.push({ model, input });
        return toolResponse(executeDecision());
      },
    },
  });

  assert.equal(typeof adapter.decideDueActorPlan, "function");
  const result = await adapter.decideDueActorPlan(DECISION_REQUEST);

  assert.equal(contextPreparationCalls, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(result, {
    kind: "actorPlanDecision",
    decision: "execute",
    planId: PLAN_ID,
    mechanicalProposal: executeDecision().mechanicalProposal,
    proposalAttemptId: `${ROOT_ACTION_ID}:kp:actor-plan:1`,
    rootActionId: ROOT_ACTION_ID,
  });
  assert.equal("modelInvocationReceipt" in result, false);

  const modelInput = calls[0].input;
  assert.equal(modelInput.tools[0].function.name, ACTOR_PLAN_DECISION_TOOL_NAME);
  const userPayload = JSON.parse(modelInput.messages[1].content);
  assert.deepEqual(Object.keys(userPayload), ["actorPlan", "npcViewer"]);
  assert.deepEqual(userPayload.npcViewer.viewer, { kind: "npc", subjectId: NPC_ID });
  for (const privateControl of [
    "runtimeProfiles",
    "projectionHash",
    "stateVersion",
    "activeBranchId",
    "dueActorPlan",
    "dueActorPlanChildRootActionId",
  ]) assert.equal(privateControl in userPayload.npcViewer, false, privateControl);
  const serializedPayload = JSON.stringify(userPayload);
  assert.doesNotMatch(serializedPayload, /principal|audience|RequiredContext|contextPack|privateForm/iu);
});

test("due ActorPlan schema and validator cover four exact lifecycle variants", () => {
  const parameters = ACTOR_PLAN_DECISION_TOOL.function.parameters;
  assert.deepEqual(
    parameters.anyOf.map((variant) => variant.properties.decision.const),
    ["execute", "revise", "defer", "cancel"],
  );
  assert.ok(parameters.anyOf.every((variant) => variant.additionalProperties === false));
  const executeVariant = parameters.anyOf.find((variant) =>
    variant.properties.decision.const === "execute");
  const proposalSchemas = executeVariant.properties.mechanicalProposal.anyOf[1].anyOf;
  const npcOperations = proposalSchemas.flatMap((schemaRef) => {
    const name = schemaRef.$ref.split("/").at(-1);
    const operation = parameters.$def[name].properties.operation;
    return operation.enum ?? [operation.const];
  });
  assert.equal(npcOperations.includes("advanceCampaignLifecycle"), false);

  const cancel = validateActorPlanDecisionOutput({
    decision: "cancel",
    planId: PLAN_ID,
    mechanicalProposal: null,
    reason: "密令已由该 NPC 知道的后续命令撤销",
  }, DECISION_REQUEST);
  assert.equal(cancel.decision, "cancel");

  const defer = validateActorPlanDecisionOutput({
    decision: "defer",
    planId: PLAN_ID,
    mechanicalProposal: null,
    reason: "先等待门外巡逻经过",
    deferUntilFictionMicros: "200",
  }, DECISION_REQUEST);
  assert.equal(defer.decision, "defer");

  const revise = validateActorPlanDecisionOutput({
    decision: "revise",
    planId: PLAN_ID,
    mechanicalProposal: null,
    revision: {
      reason: "外院门已经失守，改守已知的内门",
      premiseRefs: [KNOWLEDGE_REF],
      nextStep: "把铁栓转移到内门门槽",
      resourceRefs: [RESOURCE_REF],
      due: null,
      trigger: { kind: "knowledgeAcquired", knowledgeRef: KNOWLEDGE_REF },
      trace: {
        factRef: "fact:due-plan-v3:inner-gate-barred",
        description: "内门门槽中出现一根推入的铁栓",
      },
      alternateTarget: {
        targetRef: ALTERNATE_TARGET_REF,
        reason: "外院门已失守时守住内门",
      },
    },
  }, DECISION_REQUEST);
  assert.equal(revise.decision, "revise");
  assert.equal(revise.revision.trace.visibilityPolicyRef, "visibility:scene-observers");

  assert.throws(() => validateActorPlanDecisionOutput({
    decision: "revise",
    planId: PLAN_ID,
    mechanicalProposal: null,
    revision: {
      reason: "试图扩大痕迹受众",
      premiseRefs: [KNOWLEDGE_REF],
      nextStep: "把铁栓转移到内门门槽",
      resourceRefs: [RESOURCE_REF],
      due: null,
      trigger: { kind: "knowledgeAcquired", knowledgeRef: KNOWLEDGE_REF },
      trace: {
        factRef: "fact:due-plan-v3:forged-visibility",
        description: "内门门槽中出现一根推入的铁栓",
        visibilityPolicyRef: "visibility:public",
      },
      alternateTarget: {
        targetRef: ALTERNATE_TARGET_REF,
        reason: "外院门已失守时守住内门",
      },
    },
  }, DECISION_REQUEST));

  assert.throws(() => validateActorPlanDecisionOutput({
    decision: "defer",
    planId: PLAN_ID,
    mechanicalProposal: null,
    reason: "不能推迟到当前时刻",
    deferUntilFictionMicros: "100",
  }, DECISION_REQUEST));
  assert.throws(() => validateActorPlanDecisionOutput({
    decision: "cancel",
    planId: PLAN_ID,
    mechanicalProposal: null,
    reason: "无效扩展字段",
    principal: "principal:forged",
  }, DECISION_REQUEST));
});

test("invalid due ActorPlan model output fails closed without a Form repair", async () => {
  let calls = 0;
  const adapter = createAuthoritativeKpAdapter({
    profile: V3_AUTHORITATIVE_KP_PROFILES[0],
    ai: {
      async run() {
        calls += 1;
        return toolResponse({
          decision: "cancel",
          planId: PLAN_ID,
          mechanicalProposal: null,
          reason: "伪造权限字段",
          audienceId: "audience:forged",
        });
      },
    },
  });

  await assert.rejects(adapter.decideDueActorPlan(DECISION_REQUEST), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.code, "modelPermanent");
    assert.equal(error.modelInvocationReceipt.failureStage, "proposalSchema");
    return true;
  });
  assert.equal(calls, 1);
});

test("Room Action prefers the dedicated due-plan method, then reprojects player intent", async () => {
  const trace = [];
  const continuedPrepared = {
    kind: "prepared",
    phase: "playerIntent",
    preparedActionId: PREPARED_ACTION_ID,
    rootActionId: ROOT_ACTION_ID,
    kpProjection: { viewer: { kind: "kp" }, projectionHash: "projection:kp:after-due" },
  };
  let commitCount = 0;
  const authority = {
    async prepare() {
      return {
        kind: "prepared",
        phase: "dueActorPlan",
        preparedActionId: PREPARED_ACTION_ID,
        rootActionId: ROOT_ACTION_ID,
        dueActorPlan: ACTOR_PLAN,
        kpProjection: NPC_PROJECTION,
      };
    },
    async commit(_principal, preparedActionId, proposal) {
      trace.push({ operation: "commit", preparedActionId, proposal });
      commitCount += 1;
      if (commitCount === 1) return { kind: "continue", prepared: continuedPrepared };
      return {
        kind: "committed",
        receipt: { receiptId: "receipt:due-plan-v3", rootActionId: ROOT_ACTION_ID },
      };
    },
    async observe() {
      return { readModel: { projectionHash: "projection:player:after-due" } };
    },
    async acknowledge() {
      throw new Error("not used");
    },
  };
  const kp = {
    async decideDueActorPlan(request) {
      trace.push({ operation: "decideDueActorPlan", request });
      return validateActorPlanDecisionOutput({
        decision: "execute",
        planId: PLAN_ID,
        mechanicalProposal: null,
      }, request);
    },
    async propose(request) {
      trace.push({ operation: "propose", request });
      return {
        kind: "directSuccess",
        proposalAttemptId: `${ROOT_ACTION_ID}:kp:1`,
        mechanicalProposal: null,
      };
    },
    async narrate() {
      throw new Error("no delivery plan");
    },
  };

  const outcome = await handleRoomAction({
    principal: { id: "principal:trusted", sessionVersion: 1 },
    authority,
    kp,
  }, {
    kind: "intent",
    submissionId: "submission:due-plan-v3",
    text: "我检查外院门。",
  });

  assert.equal(outcome.kind, "committed", JSON.stringify({ outcome, trace }));
  assert.deepEqual(trace.map(({ operation }) => operation), [
    "decideDueActorPlan",
    "commit",
    "propose",
    "commit",
  ]);
  const dueRequest = trace[0].request;
  assert.deepEqual(Object.keys(dueRequest).sort(), [
    "attempt",
    "dueActorPlan",
    "preparedActionId",
    "projection",
    "rootActionId",
  ]);
  assert.equal("input" in dueRequest, false);
  assert.equal(trace[2].request.input.text, "我检查外院门。");
  assert.deepEqual(Object.keys(trace[1].proposal).sort(), [
    "decision",
    "kind",
    "mechanicalProposal",
    "planId",
    "proposalAttemptId",
    "rootActionId",
  ]);
});

test("Room Action retains the historical generic-propose fallback for test adapters", async () => {
  const proposalRequests = [];
  let commitCount = 0;
  const authority = {
    async prepare() {
      return {
        kind: "prepared",
        phase: "dueActorPlan",
        preparedActionId: PREPARED_ACTION_ID,
        rootActionId: ROOT_ACTION_ID,
        dueActorPlan: ACTOR_PLAN,
        kpProjection: NPC_PROJECTION,
      };
    },
    async commit() {
      commitCount += 1;
      return commitCount === 1
        ? {
            kind: "continue",
            prepared: {
              kind: "prepared",
              phase: "playerIntent",
              preparedActionId: PREPARED_ACTION_ID,
              rootActionId: ROOT_ACTION_ID,
              kpProjection: { viewer: { kind: "kp" } },
            },
          }
        : {
            kind: "committed",
            receipt: { receiptId: "receipt:due-plan-v3:fallback", rootActionId: ROOT_ACTION_ID },
          };
    },
    async observe() {
      return { readModel: { projectionHash: "projection:player:fallback" } };
    },
    async acknowledge() {
      throw new Error("not used");
    },
  };
  const kp = {
    async propose(request) {
      proposalRequests.push(structuredClone(request));
      return request.phase === "dueActorPlan"
        ? {
            kind: "actorPlanDecision",
            decision: "execute",
            planId: PLAN_ID,
            mechanicalProposal: null,
            proposalAttemptId: `${ROOT_ACTION_ID}:legacy-test-adapter`,
          }
        : {
            kind: "directSuccess",
            proposalAttemptId: `${ROOT_ACTION_ID}:kp:1`,
            mechanicalProposal: null,
          };
    },
    async narrate() {
      throw new Error("no delivery plan");
    },
  };

  const outcome = await handleRoomAction({
    principal: { id: "principal:trusted", sessionVersion: 1 },
    authority,
    kp,
  }, {
    kind: "intent",
    submissionId: "submission:due-plan-v3:fallback",
    text: "我检查外院门。",
  });

  assert.equal(outcome.kind, "committed", JSON.stringify(outcome));
  assert.deepEqual(proposalRequests.map(({ phase }) => phase ?? "playerIntent"), [
    "dueActorPlan",
    "playerIntent",
  ]);
  assert.equal("input" in proposalRequests[0], false);
  assert.equal(proposalRequests[1].input.text, "我检查外院门。");
});
