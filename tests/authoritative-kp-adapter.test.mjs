import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTHORITATIVE_KP_PROFILE,
  AuthoritativeKpModelError,
  createAuthoritativeKpAdapter,
} from "../app/_runtime/lib/kp/authoritative.ts";
import { authoritativeKpProfileByBinding } from "../app/_runtime/lib/kp/authoritative-policy.ts";
import {
  narrationProjection,
  normalizeRoomKpProposal,
} from "../app/_runtime/lib/room/proposal-adapter.ts";
import { replay, step } from "../app/_runtime/lib/rules/index.ts";

const ROOT_ACTION_ID = "root:free-action:001";
const PREPARED_ACTION_ID = "prepared:free-action:001";
const PRIVATE_FACT = "truth:the-regent-forged-the-seal";
const GEMMA_KP_PROFILE = authoritativeKpProfileByBinding(
  "@cf/google/gemma-4-26b-a4b-it",
  "authoritative-kp-model-gemma-4-26b-a4b-it-v1",
);
if (GEMMA_KP_PROFILE === undefined) throw new Error("historical Gemma profile is missing");

const KP_PROJECTION = Object.freeze({
  viewer: Object.freeze({ kind: "kp" }),
  projectionHash: "projection:kp:17",
  storyAnchors: Object.freeze(["anchor:the-regent-cannot-change-the-old-oath"]),
  canonicalFacts: Object.freeze(["fact:ordinary-courtyard-door-is-unlocked"]),
  privateFacts: Object.freeze([PRIVATE_FACT]),
  npcViewers: Object.freeze({
    "npc:warden": Object.freeze({
      viewer: Object.freeze({ kind: "npc", npcId: "npc:warden" }),
      knowledgeRefs: Object.freeze(["claim:warden-heard-a-bell"]),
      goalRefs: Object.freeze(["goal:warden-protects-the-yard"]),
    }),
  }),
});

const INTENT = Object.freeze({
  kind: "intent",
  submissionId: "submission:free-action:001",
  characterId: "character:alice",
  text: "我不用现成入口，想把雨披铺在泥地上，从墙根悄悄拖过钟架。",
});

function proposal(overrides = {}) {
  return {
    kind: "checkRequired",
    goal: "把钟架移到墙根且不让院内守卫听见",
    method: "用雨披隔开泥地和金属底座后缓慢拖动",
    publicBasisRefs: ["fact:ordinary-courtyard-door-is-unlocked"],
    privateBasisRefs: [],
    estimatedFictionTime: { unit: "minute", value: 10 },
    risk: {
      warning: "钟架很重；拖动时雨披可能撕裂并发出金属摩擦声。",
      successConsequences: ["钟架抵达墙根"],
      failureConsequences: ["守卫获得声响证据", "雨披受损"],
      retryGate: ["methodChanged", "materialAssistance"],
    },
    pendingInput: null,
    dynamicMaterializations: [],
    npcActions: [
      {
        npcId: "npc:warden",
        goal: "确认院内是否出现异常声响",
        method: "沿回廊继续巡查并留意钟架方向",
        knowledgeRefs: ["claim:warden-heard-a-bell"],
        mechanicalProposal: null,
      },
    ],
    mechanicalProposal: {
      operation: "resolveNoncombatCheck",
      ability: "dex",
      skill: "stealth",
      dc: 15,
      mode: "normal",
      duration: { unit: "minute", value: 10 },
      frozenCosts: [{ kind: "consumeArtifact", artifactRef: "item:rain-cape", count: 1 }],
      success: [{
        kind: "acquireEvidence",
        evidenceRef: "evidence:bell-frame-reached-wall",
        evidence: "钟架已被拖到墙根。",
      }],
      failure: [{ kind: "alertNpc", npcId: "npc:warden", status: "heard-metal-scrape" }],
    },
    scene: {
      question: "Alice 能否在不惊动守卫的情况下移动钟架？",
      pressure: "守卫正沿回廊巡查。",
      opportunities: ["换用木杆撬动", "请同伴在另一侧制造可解释的声响"],
      conclusionCandidate: null,
    },
    ...overrides,
  };
}

function officialToolResponse(name, value, usage = {}) {
  return {
    id: `model-response:${name}`,
    object: "chat.completion",
    created: 1_787_690_000,
    model: AUTHORITATIVE_KP_PROFILE.modelId,
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        logprobs: null,
        message: {
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: `call:${name}`,
              type: "function",
              function: { name, arguments: JSON.stringify(value) },
            },
          ],
        },
      },
    ],
    usage: {
      prompt_tokens: 321,
      completion_tokens: 123,
      total_tokens: 444,
      ...usage,
    },
  };
}

function scriptedAi(responses) {
  const calls = [];
  const queue = [...responses];
  return {
    calls,
    async run(model, input, options) {
      calls.push({ model, input, options });
      assert.ok(queue.length > 0, "AI binding was called more often than scripted");
      const next = queue.shift();
      if (next instanceof Error) throw next;
      if (typeof next === "function") return next({ model, input, options });
      return next;
    },
  };
}

function schemaInvalidTwice(responses) {
  return responses.flatMap((response) => [response, response]);
}

function proposalRequest(overrides = {}) {
  return {
    preparedActionId: PREPARED_ACTION_ID,
    rootActionId: ROOT_ACTION_ID,
    input: INTENT,
    projection: KP_PROJECTION,
    attempt: 1,
    ...overrides,
  };
}

function monotonicClock(start = 1_787_690_000_000) {
  let value = start;
  return () => {
    const current = value;
    value += 11;
    return current;
  };
}

function serialized(value) {
  return JSON.stringify(value);
}

function initializeObservationWorld() {
  const profileRef = (profileId, digit) => ({
    profileId,
    profileHash: `sha256:${digit.repeat(64)}`,
  });
  const initialized = step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:kp-observation-seam",
    runtimeEpochId: "epoch:kp-observation-seam:1",
    moduleRef: profileRef("module:kp-observation-seam", "a"),
    initialDefinitionCatalogRef: profileRef("definitions:kp-observation-seam", "b"),
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{ id: "scene:hall", name: "大厅" }],
    principals: [{ id: "principal:alice", sessionVersion: 1, role: "host" }],
    seats: [{ id: "seat:alice", principalId: "principal:alice", status: "active" }],
    characters: [{
      id: "character:alice",
      kind: "player",
      name: "阿莱莎",
      sceneId: "scene:hall",
      tenureStatus: "active",
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 12, cha: 10 },
      proficiencyBonus: 2,
      resources: {},
    }],
    characterControls: [{ characterId: "character:alice", seatId: "seat:alice" }],
    canonicalFacts: [{
      id: "fact:ordinary-courtyard-door-is-unlocked",
      kind: "visibleExit",
      source: "moduleAnchor",
      subjectRefs: ["scene:hall"],
      value: { description: "大厅东侧有一扇普通且没有上锁的门。" },
      visibilityPolicyId: "visibility:public",
    }],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const replayed = replay(initialized.genesis, []);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return { profiles: initialized.profiles, state: replayed.state };
}

test("authoritative KP invokes and receipts the room-pinned model profile", async () => {
  const ai = scriptedAi([
    officialToolResponse("submit_kp_proposal", proposal()),
  ]);
  const adapter = createAuthoritativeKpAdapter({
    ai,
    now: monotonicClock(),
    profile: GEMMA_KP_PROFILE,
  });

  const result = await adapter.propose(proposalRequest());

  assert.deepEqual(
    {
      invokedModel: ai.calls[0]?.model,
      receiptModel: result.modelInvocationReceipt.modelId,
      receiptProfile: result.modelInvocationReceipt.modelProfileVersion,
    },
    {
      invokedModel: GEMMA_KP_PROFILE.modelId,
      receiptModel: GEMMA_KP_PROFILE.modelId,
      receiptProfile: GEMMA_KP_PROFILE.modelProfileVersion,
    },
  );
});

test("authoritative KP rejects a mismatched room model/profile pair before invocation", () => {
  const ai = scriptedAi([]);

  assert.throws(
    () => createAuthoritativeKpAdapter({
      ai,
      profile: {
        ...GEMMA_KP_PROFILE,
        modelProfileVersion: AUTHORITATIVE_KP_PROFILE.modelProfileVersion,
      },
    }),
    /registered authoritative KP model profile/,
  );
  assert.equal(ai.calls.length, 0);
});

test("authoritative KP proposes open-world mechanics and revises only from Rules diagnostics", async () => {
  const first = proposal();
  const revised = proposal({
    kind: "highRiskFeasible",
    risk: {
      warning: "旧雨披无法完全隔音；继续会提高暴露风险。",
      successConsequences: ["钟架抵达墙根"],
      failureConsequences: ["守卫定位到 Alice", "雨披被撕毁"],
      retryGate: ["methodChanged", "positionChanged"],
    },
    mechanicalProposal: {
      operation: "resolveNoncombatCheck",
      ability: "str",
      skill: "athletics",
      dc: 17,
      mode: "normal",
      duration: { unit: "minute", value: 10 },
      frozenCosts: [{ kind: "consumeArtifact", artifactRef: "item:rain-cape" }],
      success: [{
        kind: "acquireEvidence",
        evidenceRef: "evidence:bell-frame-reached-wall",
        evidence: "钟架已被拖到墙根。",
      }],
      failure: [{ kind: "alertNpc", npcId: "npc:warden", status: "heard-metal-scrape" }],
    },
  });
  const allKnowingNpc = proposal({
    npcActions: [
      {
        npcId: "npc:warden",
        goal: "截断玩家尚未暴露的计划",
        method: "预先封住只有 KP 知道的暗门",
        knowledgeRefs: [PRIVATE_FACT],
        mechanicalProposal: null,
      },
    ],
  });
  const ai = scriptedAi([
    officialToolResponse("submit_kp_proposal", first),
    officialToolResponse("submit_kp_proposal", revised),
    officialToolResponse("submit_kp_proposal", allKnowingNpc),
  ]);
  const adapter = createAuthoritativeKpAdapter({ ai, now: monotonicClock() });

  const initialResult = await adapter.propose(proposalRequest());
  const diagnostics = [
    {
      code: "unsupported_stealth_for_heavy_drag",
      publicPath: "这个做法需要按搬运重物处理。",
      revisionHint: "use a strength check and retain the frozen ten-minute duration",
      secrecy: "kp",
    },
  ];
  const revisedResult = await adapter.propose(proposalRequest({ attempt: 2, diagnostics }));

  assert.equal(ai.calls.length, 2);
  assert.ok(ai.calls.every((call) => call.model === AUTHORITATIVE_KP_PROFILE.modelId));
  for (const call of ai.calls) {
    assert.equal(call.input.tool_choice, "required");
    assert.equal(call.input.parallel_tool_calls, false);
    assert.equal("response_format" in call.input, false, "provider JSON mode must not be assumed");
    assert.equal(call.input.tools.length, 1);
    assert.equal(call.input.tools[0].function.name, "submit_kp_proposal");
    const system = call.input.messages[0].content;
    assert.match(system, /directSuccess/);
    assert.match(system, /checkRequired/);
    assert.match(system, /highRiskFeasible/);
    assert.match(system, /missingPrerequisite/);
    assert.match(system, /worldLawViolation/);
    assert.match(system, /命令翻译器|白名单/);
    assert.match(system, /不得.*代替玩家|不能.*代替玩家/);
    assert.match(system, /逐字复制/);
    assert.match(system, /观察、查看、环顾或检查明显可见内容/);
    assert.match(system, /estimatedFictionTime.*完全相同.*duration/);
    assert.match(system, /没有结构化状态变化时 success=\[\]/);
    assert.match(
      call.input.tools[0].function.parameters.properties.publicBasisRefs.description,
      /逐字复制/,
    );
  }
  assert.match(ai.calls[0].input.messages[1].content, /雨披铺在泥地/);
  assert.match(ai.calls[0].input.messages[1].content, new RegExp(PRIVATE_FACT));
  assert.match(ai.calls[1].input.messages[1].content, /unsupported_stealth_for_heavy_drag/);

  assert.equal(initialResult.kind, "checkRequired");
  assert.deepEqual(initialResult.npcActions[0].knowledgeRefs, ["claim:warden-heard-a-bell"]);
  assert.equal(initialResult.proposalAttemptId, `${ROOT_ACTION_ID}:kp:1`);
  assert.equal(revisedResult.kind, "highRiskFeasible");
  assert.equal(revisedResult.proposalAttemptId, `${ROOT_ACTION_ID}:kp:2`);
  assert.equal(revisedResult.mechanicalProposal.dc, 17);
  assert.equal(revisedResult.modelInvocationReceipt.result, "success");
  assert.equal(revisedResult.modelInvocationReceipt.provider, "deepseek");
  assert.equal(revisedResult.modelInvocationReceipt.modelId, AUTHORITATIVE_KP_PROFILE.modelId);
  assert.equal(
    revisedResult.modelInvocationReceipt.promptPolicyVersion,
    AUTHORITATIVE_KP_PROFILE.promptPolicyVersion,
  );
  assert.equal(revisedResult.modelInvocationReceipt.inputTokens, 321);
  assert.equal(revisedResult.modelInvocationReceipt.outputTokens, 123);
  assert.match(revisedResult.modelInvocationReceipt.responseHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(serialized(revisedResult.modelInvocationReceipt).includes(PRIVATE_FACT), false);

  const finiteKnowledgeResult = await adapter.propose(
    proposalRequest({ attempt: 3, diagnostics }),
  );
  assert.deepEqual(
    finiteKnowledgeResult.npcActions,
    [],
    "an NPC action citing KP-only knowledge must be omitted",
  );

  await assert.rejects(
    adapter.propose(proposalRequest({ attempt: 4, diagnostics })),
    (error) => {
      assert.ok(error instanceof AuthoritativeKpModelError);
      assert.equal(error.code, "modelPermanent");
      return true;
    },
  );
  assert.equal(ai.calls.length, 3, "Rules revisions do not receive a second model call");
});

test("a schema-invalid proposal is discarded and receives one bounded same-profile replacement", async () => {
  const invalidDraftCanary = "model-output:missing-failure-array";
  const invalidDraft = proposal({
    goal: invalidDraftCanary,
    mechanicalProposal: {
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [],
    },
  });
  const replacement = proposal();
  const receipts = [];
  const ai = scriptedAi([
    officialToolResponse("submit_kp_proposal", { kpProjection: invalidDraft }),
    officialToolResponse("submit_kp_proposal", { proposal: replacement }),
  ]);
  const adapter = createAuthoritativeKpAdapter({
    ai,
    now: monotonicClock(),
    onInvocationReceipt(value) {
      receipts.push(value);
    },
  });

  const result = await adapter.propose(proposalRequest());

  assert.equal(result.kind, "checkRequired");
  assert.equal(ai.calls.length, 2);
  assert.ok(ai.calls.every(({ model }) => model === AUTHORITATIVE_KP_PROFILE.modelId));
  assert.match(ai.calls[1].input.messages[1].content, /proposalSchemaCorrection/);
  assert.equal(ai.calls[1].input.temperature, 0);
  const correctionPayload = JSON.parse(ai.calls[1].input.messages[1].content);
  assert.deepEqual(correctionPayload.action, INTENT);
  assert.equal(
    Object.hasOwn(
      correctionPayload.proposalSchemaCorrection,
      "validCompleteSimpleObservationExample",
    ),
    false,
  );
  assert.match(
    correctionPayload.proposalSchemaCorrection.requirements.join("\n"),
    /保持 action 的原始目标、做法、对象、风险、资源选择与语义范围/,
  );
  assert.doesNotMatch(
    ai.calls[1].input.messages[1].content,
    /站在原地观察/,
    "schema correction must not carry a generic action that can replace the player's intent",
  );
  assert.doesNotMatch(
    ai.calls[1].input.messages[1].content,
    new RegExp(invalidDraftCanary),
    "the rejected model output must not be copied into the replacement prompt",
  );
  assert.deepEqual(
    receipts.map(({ result: receiptResult, failureStage }) => ({
      result: receiptResult,
      failureStage,
    })),
    [
      { result: "modelPermanent", failureStage: "proposalSchema" },
      { result: "success", failureStage: undefined },
    ],
  );
});

test("a single provider proposal envelope is accepted only when its inner proposal is closed and unambiguous", async () => {
  const replacement = proposal();
  const acceptedAi = scriptedAi([
    officialToolResponse("submit_kp_proposal", { proposal: replacement }),
    officialToolResponse("submit_kp_proposal", { kpProjection: replacement }),
  ]);
  const acceptedAdapter = createAuthoritativeKpAdapter({
    ai: acceptedAi,
    now: monotonicClock(),
  });
  const accepted = await acceptedAdapter.propose(proposalRequest());
  assert.equal(accepted.kind, replacement.kind);
  const alternateEnvelope = await acceptedAdapter.propose(proposalRequest());
  assert.equal(alternateEnvelope.kind, replacement.kind);
  assert.equal(acceptedAi.calls.length, 2);

  const ambiguousEnvelope = {
    proposal: replacement,
    kpProjection: { viewer: { kind: "kp" } },
  };
  const rejectedAi = scriptedAi(schemaInvalidTwice([
    officialToolResponse("submit_kp_proposal", ambiguousEnvelope),
  ]));
  const rejectedAdapter = createAuthoritativeKpAdapter({
    ai: rejectedAi,
    now: monotonicClock(),
  });
  await assert.rejects(rejectedAdapter.propose(proposalRequest()), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.modelInvocationReceipt.failureStage, "proposalSchema");
    return true;
  });
  assert.equal(rejectedAi.calls.length, 2);
});

test("a schema replacement cannot start a fresh invocation timeout window", async () => {
  const invalidDraft = proposal({
    mechanicalProposal: {
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [],
    },
  });
  const clockValues = [1_000, 45_999, 46_000];
  const ai = scriptedAi([
    officialToolResponse("submit_kp_proposal", invalidDraft),
  ]);
  const adapter = createAuthoritativeKpAdapter({
    ai,
    now: () => clockValues.shift() ?? 46_000,
  });

  await assert.rejects(adapter.propose(proposalRequest()), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.modelInvocationReceipt.failureStage, "proposalSchema");
    return true;
  });
  assert.equal(ai.calls.length, 1);
});

test("authoritative KP accepts only versioned closed semantic ActionPlan operations", async () => {
  const productionCheck = {
    operation: "resolveNoncombatCheck",
    ability: "int",
    skill: "investigation",
    dc: 13,
    mode: "normal",
    duration: { unit: "minute", value: 10 },
    frozenCosts: [],
    success: [
      { kind: "acquireEvidence", evidenceRef: "evidence:chandelier-cut" },
      {
        kind: "recordDebt",
        debtRef: "debt:repair-bell-frame",
        targetRef: "npc:warden",
        value: "修复拖动时损坏的钟架。",
        status: "下一次月圆前",
        definitionRef: "fact:ordinary-courtyard-door-is-unlocked",
      },
    ],
    failure: [{ kind: "alertNpc", npcId: "npc:warden" }],
  };
  const withPlans = (mechanicalProposal, npcMechanicalProposal = null) => proposal({
    mechanicalProposal,
    npcActions: [{
      npcId: "npc:warden",
      goal: "依据自己的巡视职责确认大厅异常",
      method: "检查自己听见的声响来源",
      knowledgeRefs: ["claim:warden-heard-a-bell"],
      mechanicalProposal: npcMechanicalProposal,
    }],
  });
  const ai = scriptedAi([
    officialToolResponse(
      "submit_kp_proposal",
      withPlans(productionCheck, { ...productionCheck, dc: 11 }),
    ),
    officialToolResponse("submit_kp_proposal", proposal({
      kind: "directSuccess",
      risk: null,
      mechanicalProposal: {
        operation: "advanceCampaignLifecycle",
        lifecycleAction: "transitionChapter",
        chapterRef: "chapter:second",
        activityTransitions: [{
          activityId: "activity:chapter-boundary-rest",
          disposition: "complete",
        }],
      },
    })),
    ...schemaInvalidTwice([
      officialToolResponse("submit_kp_proposal", withPlans({
        ...productionCheck,
        operation: "rewriteAuthoritativeState",
      })),
      officialToolResponse("submit_kp_proposal", withPlans({
        ...productionCheck,
        internalDirective: "commit without Rules diagnostics",
      })),
      officialToolResponse("submit_kp_proposal", withPlans({
        ...productionCheck,
        dice: [{ sides: 20 }],
        faces: [20],
      })),
      officialToolResponse("submit_kp_proposal", withPlans(
        productionCheck,
        { ...productionCheck, operation: "rewriteAuthoritativeState" },
      )),
    ]),
  ]);
  const adapter = createAuthoritativeKpAdapter({ ai, now: monotonicClock() });

  const accepted = await adapter.propose(proposalRequest());
  assert.deepEqual(accepted.mechanicalProposal, productionCheck);
  assert.deepEqual(accepted.npcActions[0].mechanicalProposal, { ...productionCheck, dc: 11 });
  const acceptedTransition = await adapter.propose(proposalRequest());
  assert.deepEqual(acceptedTransition.mechanicalProposal, {
    operation: "advanceCampaignLifecycle",
    lifecycleAction: "transitionChapter",
    chapterRef: "chapter:second",
    activityTransitions: [{
      activityId: "activity:chapter-boundary-rest",
      disposition: "complete",
    }],
  });
  for (const label of ["unknown operation", "extra mechanical key", "model dice/faces", "NPC unknown operation"]) {
    await assert.rejects(adapter.propose(proposalRequest()), (error) => {
      assert.ok(error instanceof AuthoritativeKpModelError, label);
      assert.equal(error.code, "modelPermanent", label);
      return true;
    });
  }
  assert.equal(ai.calls.length, 10);

  const serializedProposalToolBytes = Buffer.byteLength(
    JSON.stringify(ai.calls[0].input.tools[0]),
    "utf8",
  );
  assert.ok(
    serializedProposalToolBytes < 60_000,
    `proposal tool schema must stay compact, received ${serializedProposalToolBytes} bytes`,
  );

  assert.equal(AUTHORITATIVE_KP_PROFILE.promptPolicyVersion, "authoritative-kp-prompt-policy-v8");
  assert.equal(GEMMA_KP_PROFILE.promptPolicyVersion, "authoritative-kp-prompt-policy-v8");
  assert.equal(AUTHORITATIVE_KP_PROFILE.proposalSchemaVersion, "authoritative-kp-proposal-v2");
  assert.equal(AUTHORITATIVE_KP_PROFILE.actionPlanSchemaVersion, "authoritative-kp-action-plan-v1");
  assert.equal(AUTHORITATIVE_KP_PROFILE.narrationSchemaVersion, "authoritative-kp-narration-v3");

  const proposalParameters = ai.calls[0].input.tools[0].function.parameters;
  const definitions = proposalParameters.$def;
  const dereference = (schema) => schema.$ref
    ? definitions[schema.$ref.split("/").at(-1)]
    : schema;
  const planSchema = proposalParameters.properties.mechanicalProposal.anyOf[1];
  const planBranches = planSchema.anyOf.map(dereference);
  const strictPlan = (operation) => planBranches.find((branch) =>
    branch.properties?.operation?.const === operation);
  const directSchema = strictPlan("resolveDirectConsequences");
  const checkSchema = strictPlan("resolveNoncombatCheck");
  const saveSchema = strictPlan("resolveNoncombatSave");
  const retrySchemas = planBranches.filter((branch) =>
    branch.properties?.operation?.const === "retryFailedAction");
  const unchangedRetrySchema = retrySchemas.find((branch) => branch.required.length === 2);
  const retrySchema = retrySchemas.find((branch) => branch.required.length > 2);
  const reservedSchema = planBranches.find((branch) =>
    Array.isArray(branch.properties?.operation?.enum));
  assert.deepEqual(directSchema.required, [
    "operation",
    "duration",
    "frozenCosts",
    "success",
    "failure",
  ]);
  assert.equal(directSchema.additionalProperties, false);
  assert.equal(directSchema.properties.duration.properties.value.type, "integer");
  assert.equal(directSchema.properties.frozenCosts.maxItems, 0);
  assert.equal(directSchema.properties.failure.maxItems, 0);
  assert.deepEqual(checkSchema.required, [
    "operation",
    "ability",
    "skill",
    "dc",
    "mode",
    "duration",
    "frozenCosts",
    "success",
    "failure",
  ]);
  assert.deepEqual(saveSchema.required, [
    "operation",
    "saveAbility",
    "dc",
    "mode",
    "duration",
    "frozenCosts",
    "success",
    "failure",
  ]);
  assert.ok("targetEntityRef" in saveSchema.properties);
  assert.equal(saveSchema.required.includes("targetEntityRef"), false);
  assert.deepEqual(retrySchema.required, [...checkSchema.required, "precedentRef"]);
  assert.deepEqual(unchangedRetrySchema.required, ["operation", "precedentRef"]);
  assert.equal(unchangedRetrySchema.additionalProperties, false);
  assert.deepEqual(reservedSchema.properties.operation.enum, [
    "resolveNoncombatContest",
    "commitMeaningfulFailure",
    "rejectInfeasibleAction",
    "startActivity",
    "interruptActivity",
    "completeActivity",
    "startCombat",
    "invokeCombatAction",
    "moveCombatant",
    "endCombatTurn",
    "proposeEncounterConclusion",
    "resolveReaction",
    "resolveRest",
    "changeResource",
    "useItem",
    "acquireArtifact",
    "useArtifact",
    "transferArtifact",
    "changeKnowledge",
    "changeParty",
    "advanceCampaignLifecycle",
  ]);
  assert.deepEqual(
    definitions.actionPlanCost.anyOf.map((branch) => branch.properties.kind.const),
    ["consumeResource", "consumeArtifact", "fictionTime"],
  );
  assert.ok(definitions.actionPlanCost.anyOf.every((branch) =>
    branch.additionalProperties === false));
  assert.deepEqual(
    definitions.actionPlanEffect.anyOf.map((branch) => branch.properties.kind.const),
    [
      "acquireEvidence",
      "acquireKnowledge",
      "changeResource",
      "changeHitPoints",
      "alertNpc",
      "moveEntity",
      "advanceFictionTime",
      "updateRelationship",
      "recordCommitment",
      "recordDebt",
    ],
  );
  assert.ok(definitions.actionPlanEffect.anyOf.every((branch) =>
    branch.additionalProperties === false));
  assert.deepEqual(reservedSchema.properties.experienceAmount, {
    type: "integer",
    minimum: 1,
    maximum: 1_000_000,
  });
  assert.deepEqual(reservedSchema.properties.lifecycleAction.enum, [
    "grantMilestone",
    "awardExperience",
    "concludeChapter",
    "startChapter",
    "transitionChapter",
    "retireCharacter",
    "establishInheritanceSource",
    "transferInheritance",
    "raiseEndingCandidate",
    "concludeStory",
    "recordEpilogueChoice",
    "startSequel",
  ]);
  assert.deepEqual(
    reservedSchema.properties.activityTransitions.items.properties.disposition.enum,
    ["continue", "summarize", "interrupt", "complete"],
  );
  const npcPlanSchema = proposalParameters.properties.npcActions.items.properties.mechanicalProposal.anyOf[1];
  const npcPlanBranches = npcPlanSchema.anyOf.map(dereference);
  const npcSaveSchema = npcPlanBranches.find((branch) =>
    branch.properties?.operation?.const === "resolveNoncombatSave");
  const npcReservedSchema = npcPlanBranches.find((branch) =>
    Array.isArray(branch.properties?.operation?.enum));
  assert.equal("targetEntityRef" in npcSaveSchema.properties, false);
  assert.equal(npcPlanBranches.some((branch) =>
    branch.properties?.operation?.const === "retryFailedAction"), false);
  assert.equal(npcReservedSchema.properties.operation.enum.includes("resolveNoncombatContest"), false);
  assert.equal(npcReservedSchema.properties.operation.enum.includes("advanceFactionPlan"), true);
});

test("model boundary rejects resolution ActionPlans that the compound Rules contract cannot execute", async () => {
  const directProposal = (mechanicalProposal) => proposal({
    kind: "directSuccess",
    risk: null,
    npcActions: [],
    mechanicalProposal,
  });
  const ai = scriptedAi(schemaInvalidTwice([
    officialToolResponse("submit_kp_proposal", directProposal({
      operation: "resolveDirectConsequences",
    })),
    officialToolResponse("submit_kp_proposal", directProposal({
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [{
        kind: "sensoryEvidence",
        observerRef: "character:alice",
        evidence: "大厅东侧有一扇明显可见的门。",
      }],
      failure: [],
    })),
    officialToolResponse("submit_kp_proposal", directProposal({
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [],
      failure: [],
      ability: "wis",
    })),
    officialToolResponse("submit_kp_proposal", directProposal({
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [
        { kind: "changeHitPoints", amount: -1 },
        { kind: "changeHitPoints", amount: -1 },
      ],
      failure: [],
    })),
    officialToolResponse("submit_kp_proposal", proposal({
      mechanicalProposal: {
        operation: "resolveNoncombatCheck",
        ability: "wis",
        skill: "perception",
        dc: 10,
        mode: "normal",
        duration: { unit: "second", value: 1 },
        frozenCosts: [],
        success: [],
      },
    })),
    officialToolResponse("submit_kp_proposal", proposal({
      mechanicalProposal: {
        operation: "resolveNoncombatSave",
        saveAbility: "dex",
        dc: 10,
        mode: "normal",
        duration: { unit: "second", value: 1 },
        frozenCosts: [],
        success: [],
      },
    })),
    officialToolResponse("submit_kp_proposal", proposal({
      mechanicalProposal: {
        operation: "retryFailedAction",
        ability: "wis",
        skill: "perception",
        dc: 10,
        mode: "normal",
        duration: { unit: "second", value: 1 },
        frozenCosts: [],
        success: [],
        failure: [],
      },
    })),
    officialToolResponse("submit_kp_proposal", proposal({
      npcActions: [{
        npcId: "npc:warden",
        goal: "避开落下的碎石",
        method: "向侧面闪避",
        knowledgeRefs: ["claim:warden-heard-a-bell"],
        mechanicalProposal: {
          operation: "resolveNoncombatSave",
          saveAbility: "dex",
          dc: 10,
          mode: "normal",
          duration: { unit: "second", value: 1 },
          frozenCosts: [],
          success: [],
          failure: [],
          targetEntityRef: "character:alice",
        },
      }],
    })),
    officialToolResponse("submit_kp_proposal", proposal({
      npcActions: [{
        npcId: "npc:warden",
        goal: "重复搜查",
        method: "沿原路线再次搜查",
        knowledgeRefs: ["claim:warden-heard-a-bell"],
        mechanicalProposal: {
          operation: "retryFailedAction",
          ability: "wis",
          skill: "perception",
          dc: 10,
          mode: "normal",
          duration: { unit: "second", value: 1 },
          frozenCosts: [],
          success: [],
          failure: [],
          precedentRef: "failure:npc-search",
        },
      }],
    })),
    officialToolResponse("submit_kp_proposal", directProposal({
      operation: "advanceFactionPlan",
      factionRef: "faction:watch",
      basisRefs: ["fact:ordinary-courtyard-door-is-unlocked"],
    })),
    officialToolResponse("submit_kp_proposal", proposal({
      npcActions: [{
        npcId: "npc:warden",
        goal: "阻止阿莱莎穿过大厅",
        method: "与阿莱莎角力",
        knowledgeRefs: ["claim:warden-heard-a-bell"],
        mechanicalProposal: {
          operation: "resolveNoncombatContest",
          ability: "str",
          skill: "athletics",
          opposedAbility: "str",
          opposedSkill: "athletics",
          targetEntityRef: "character:alice",
        },
      }],
    })),
    officialToolResponse("submit_kp_proposal", directProposal({
      operation: "startActivity",
      activityRef: "activity:watch-door",
      duration: { unit: "minute", value: 1 },
      success: [{ kind: "advanceFictionTime", duration: { unit: "minute", value: 1 } }],
      failure: [],
    })),
    officialToolResponse("submit_kp_proposal", directProposal({
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [{ kind: "changeHitPoints", amount: Number.MAX_SAFE_INTEGER + 1 }],
      failure: [],
    })),
    officialToolResponse("submit_kp_proposal", proposal({
      mechanicalProposal: {
        operation: "resolveNoncombatCheck",
        ability: "wis",
        skill: "perception",
        dc: 10,
        mode: "normal",
        duration: { unit: "second", value: 1 },
        frozenCosts: [{
          kind: "consumeResource",
          resourceRef: "resource:focus",
          amount: Number.MAX_SAFE_INTEGER + 1,
        }],
        success: [],
        failure: [],
      },
    })),
    officialToolResponse("submit_kp_proposal", directProposal({
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [{ kind: "acquireKnowledge", knowledgeRef: "knowledge:visible-exit", value: null }],
      failure: [],
    })),
  ]));
  const adapter = createAuthoritativeKpAdapter({ ai, now: monotonicClock() });

  for (const label of [
    "missing direct frozen plan",
    "unsupported direct effect",
    "additional direct field",
    "duplicate authority-owned hit-point effect",
    "incomplete check",
    "incomplete save",
    "retry without precedent",
    "NPC save cannot target another entity",
    "NPC retry is not a Rules operation",
    "player cannot submit an NPC faction plan",
    "NPC contest has no registered compound protocol",
    "Activity duration cannot also be an outcome time effect",
    "unsafe hit-point amount",
    "unsafe frozen resource cost",
    "null knowledge content would be rewritten by Rules",
  ]) {
    await assert.rejects(adapter.propose(proposalRequest()), (error) => {
      assert.ok(error instanceof AuthoritativeKpModelError, label);
      assert.equal(error.code, "modelPermanent", label);
      assert.equal(error.modelInvocationReceipt.failureStage, "proposalSchema", label);
      return true;
    });
  }
  assert.equal(ai.calls.length, 30);
});

test("model boundary accepts complete saves and both Rules-valid retry shapes", async () => {
  const frozenOutcome = {
    dc: 12,
    mode: "normal",
    duration: { unit: "second", value: 1 },
    frozenCosts: [],
    success: [],
    failure: [],
  };
  const ai = scriptedAi([
    officialToolResponse("submit_kp_proposal", proposal({
      mechanicalProposal: {
        operation: "resolveNoncombatSave",
        saveAbility: "dex",
        ...frozenOutcome,
      },
    })),
    officialToolResponse("submit_kp_proposal", proposal({
      mechanicalProposal: {
        operation: "retryFailedAction",
        precedentRef: "failure:unchanged-search",
      },
    })),
    officialToolResponse("submit_kp_proposal", proposal({
      mechanicalProposal: {
        operation: "retryFailedAction",
        ability: "wis",
        skill: "perception",
        precedentRef: "failure:blocked-search",
        ...frozenOutcome,
      },
    })),
  ]);
  const adapter = createAuthoritativeKpAdapter({ ai, now: monotonicClock() });

  const savingThrow = await adapter.propose(proposalRequest());
  const unchangedRetry = await adapter.propose(proposalRequest());
  const retry = await adapter.propose(proposalRequest());

  assert.equal(savingThrow.mechanicalProposal.operation, "resolveNoncombatSave");
  assert.deepEqual(unchangedRetry.mechanicalProposal, {
    operation: "retryFailedAction",
    precedentRef: "failure:unchanged-search",
  });
  assert.equal(retry.mechanicalProposal.operation, "retryFailedAction");
});

test("a simple observation draft crosses the model, Room normalization, and real Rules step seams", async () => {
  const draft = proposal({
    kind: "directSuccess",
    goal: "看清大厅里有哪些明显出口",
    method: "站在原地环顾大厅",
    estimatedFictionTime: { unit: "second", value: 1 },
    risk: null,
    npcActions: [],
    mechanicalProposal: {
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [],
      failure: [],
    },
    scene: {
      question: "阿莱莎看见了哪些明显出口？",
      pressure: "",
      opportunities: ["查看东侧没有上锁的门"],
      conclusionCandidate: null,
    },
  });
  const ai = scriptedAi([officialToolResponse("submit_kp_proposal", draft)]);
  const adapter = createAuthoritativeKpAdapter({ ai, now: monotonicClock() });
  const modelDraft = await adapter.propose(proposalRequest());
  const rulesProposal = normalizeRoomKpProposal(modelDraft);
  assert.ok(rulesProposal);
  const world = initializeObservationWorld();

  const outcome = step(world.profiles, world.state, {
    ...rulesProposal,
    rootActionId: ROOT_ACTION_ID,
    actorCharacterId: "character:alice",
  });

  assert.equal(outcome.kind, "committed", JSON.stringify(outcome));
  assert.ok(outcome.events.some(({ eventType }) => eventType === "FictionTimeAdvanced"));
});

test("post-commit narration is generated once from each audience's isolated projection", async () => {
  const aliceProjection = {
    viewer: { kind: "player", viewerKey: "character:alice", characterId: "character:alice" },
    projectionHash: "projection:alice:after-commit",
    committedDelta: {
      schema: "zhuwei.observer-committed-delta/v1",
      actorCharacterId: "character:alice",
      viewerCharacterId: "character:alice",
      receipt: { receiptId: "receipt:door-open", rootActionId: ROOT_ACTION_ID, status: "committed" },
      changes: [{ kind: "checkResolved", outcome: "success", result: "门已经打开。" }],
    },
    committedFacts: ["fact:door-open", "knowledge:alice-only-chalk-mark"],
    pressure: "巡逻者正在回廊尽头转身。",
  };
  const bobProjection = {
    viewer: { kind: "player", viewerKey: "character:bob", characterId: "character:bob" },
    projectionHash: "projection:bob:after-commit",
    committedDelta: {
      schema: "zhuwei.observer-committed-delta/v1",
      actorCharacterId: "character:alice",
      viewerCharacterId: "character:bob",
      receipt: { receiptId: "receipt:door-open", rootActionId: ROOT_ACTION_ID, status: "committed" },
      changes: [{ kind: "projectionFieldChanged", field: "visibleFacts", after: ["fact:door-open"] }],
    },
    committedFacts: ["fact:door-open", "knowledge:bob-only-footprint"],
    pressure: "院外的雨声盖住了短暂响动。",
  };
  const ai = scriptedAi([
    officialToolResponse("submit_current_narration", { narration: {
      body: "门已经打开。Alice 还看见门框内侧有一道粉笔记号。",
      tts: "门打开了，门框内侧留着一道粉笔记号。",
      decisionPrompt: "巡逻者正在转身，你要继续进门还是先隐藏？",
      referencedProjectionRefs: ["fact:door-open", "knowledge:alice-only-chalk-mark"],
      agencyClaims: [
        {
          subjectKind: "playerCharacter",
          subjectRef: "character:alice",
          claimKind: "committedObservableAction",
          basisRefs: ["fact:door-open"],
        },
        {
          subjectKind: "playerCharacter",
          subjectRef: "character:alice",
          claimKind: "sensoryConsequence",
          basisRefs: ["knowledge:alice-only-chalk-mark"],
        },
      ],
    } }),
    officialToolResponse("submit_current_narration", {
      body: "门已经打开，院外的雨声仍在继续。",
      tts: "门已经打开，雨声仍在继续。",
      decisionPrompt: "你要留在院外观察，还是走近门口？",
      referencedProjectionRefs: ["fact:door-open", "knowledge:bob-only-footprint"],
      agencyClaims: [{
        subjectKind: "playerCharacter",
        subjectRef: "character:bob",
        claimKind: "sensoryConsequence",
        basisRefs: ["fact:door-open"],
      }],
    }),
  ]);
  const adapter = createAuthoritativeKpAdapter({ ai, now: monotonicClock() });
  const base = {
    rootActionId: ROOT_ACTION_ID,
    receipt: { receiptId: "receipt:door-open", status: "committed" },
  };

  const alice = await adapter.narrate({ ...base, projection: aliceProjection });
  const bob = await adapter.narrate({ ...base, projection: bobProjection });

  assert.equal(ai.calls.length, 2);
  const alicePrompt = ai.calls[0].input.messages[1].content;
  const bobPrompt = ai.calls[1].input.messages[1].content;
  assert.match(alicePrompt, /knowledge:alice-only-chalk-mark/);
  assert.match(alicePrompt, /"outcome":"success"/);
  assert.match(alicePrompt, /"committedReceipt"/);
  assert.doesNotMatch(alicePrompt, /knowledge:bob-only-footprint/);
  assert.match(bobPrompt, /knowledge:bob-only-footprint/);
  assert.doesNotMatch(bobPrompt, /knowledge:alice-only-chalk-mark/);
  assert.ok(ai.calls.every((call) => call.input.tools[0].function.name === "submit_current_narration"));
  assert.ok(ai.calls.every((call) => call.input.tool_choice === "required"));
  assert.equal(alice.audience.viewerKey, "character:alice");
  assert.equal(alice.audience.projectionHash, "projection:alice:after-commit");
  assert.equal(bob.audience.viewerKey, "character:bob");
  assert.equal(bob.body.includes("粉笔记号"), false);
  assert.equal(alice.modelInvocationReceipt.task, "narration");
  assert.equal(serialized(alice.modelInvocationReceipt).includes("粉笔记号"), false);

  const ungroundedProjection = { ...aliceProjection };
  delete ungroundedProjection.committedDelta;
  await assert.rejects(
    adapter.narrate({ ...base, projection: ungroundedProjection }),
    (error) => error instanceof AuthoritativeKpModelError && error.code === "modelPermanent",
  );
  assert.equal(ai.calls.length, 2, "an ungrounded narration must fail before model I/O");
});

test("observation narration deterministically binds valid agency bases omitted from top-level references", async () => {
  const projection = {
    viewer: { kind: "player", viewerKey: "character:alice", characterId: "character:alice" },
    projectionHash: "projection:alice:visible-exit",
    committedDelta: {
      schema: "zhuwei.observer-committed-delta/v1",
      actorCharacterId: "character:alice",
      viewerCharacterId: "character:alice",
      receipt: { receiptId: "receipt:visible-exit", rootActionId: ROOT_ACTION_ID, status: "committed" },
      changes: [{ kind: "fictionTimeAdvanced", durationMicros: "1000000" }],
    },
    committedFacts: ["fact:ordinary-courtyard-door-is-unlocked"],
    visibleOpportunities: ["查看东侧没有上锁的门"],
  };
  const observationNarration = {
    body: "你环顾大厅，东侧那扇普通木门清楚可见，门闩没有扣上。",
    tts: "东侧有一扇没有上锁的普通木门。",
    decisionPrompt: "你要走近木门，还是继续观察大厅其他方向？",
    referencedProjectionRefs: [],
    agencyClaims: [{
      subjectKind: "world",
      subjectRef: null,
      claimKind: "sensoryConsequence",
      basisRefs: ["fact:ordinary-courtyard-door-is-unlocked"],
    }],
  };
  const ai = scriptedAi([
    officialToolResponse("submit_current_narration", observationNarration),
    ...schemaInvalidTwice([
      officialToolResponse("submit_current_narration", {
        ...observationNarration,
        agencyClaims: [{
          ...observationNarration.agencyClaims[0],
          basisRefs: ["fact:not-in-the-audience-projection"],
        }],
      }),
    ]),
  ]);
  const adapter = createAuthoritativeKpAdapter({ ai, now: monotonicClock() });

  const narration = await adapter.narrate({
    rootActionId: ROOT_ACTION_ID,
    receipt: { receiptId: "receipt:visible-exit", status: "committed" },
    projection,
  });

  assert.deepEqual(narration.referencedProjectionRefs, [
    "fact:ordinary-courtyard-door-is-unlocked",
  ]);
  assert.equal(narration.agencyClaims[0].subjectKind, "world");
  await assert.rejects(
    adapter.narrate({
      rootActionId: ROOT_ACTION_ID,
      receipt: { receiptId: "receipt:visible-exit", status: "committed" },
      projection,
    }),
    (error) => error instanceof AuthoritativeKpModelError && error.code === "modelPermanent",
  );

  const system = ai.calls[0].input.messages[0].content;
  assert.equal(ai.calls[0].input.temperature, 0);
  assert.match(system, /每个 basisRef.*同时列入 referencedProjectionRefs/);
  assert.match(system, /world.*subjectRef=null.*sensoryConsequence/);
  assert.match(system, /tacticalProjection.*UI 的机械数据.*不是默认旁白稿/s);
  assert.match(system, /没有明确 facing.*不得从 x\/y 推断左右、前后、身后/s);
  assert.match(system, /可见 NPC 的存在和位置不表示其正在注视谁/);
  assert.match(system, /feature 的 label\/state 只证明该要素及其已投影状态/);
  assert.match(system, /experiencedTranscript.*只用于延续.*不是当前空间、状态、感官证据/s);
});

test("narration rejects unsupported sensory extrapolations from tactical labels", async () => {
  const unsupportedBodies = [
    "你脚下有一片带泥的湿地。",
    "泥土的痕迹从门口一路拖进来。",
    "三人的目光越过你，望向你身后。",
    "拼起的长桌上铺着白布。",
    "炉台里的火苗噼啪作响。",
    "石砌炉台投下暗影，三人都保持着守灵的姿态。",
    "空气里弥漫着蜡烛与潮湿泥土的气味。",
    "莉安站在你左前方。",
  ];
  const projection = {
    viewer: { kind: "player", characterId: "character:alice" },
    projectionHash: "projection:alice:wake-grounding",
    committedDelta: {
      schema: "zhuwei.observer-committed-delta/v1",
      actorCharacterId: "character:alice",
      viewerCharacterId: "character:alice",
      receipt: {
        receiptId: "receipt:wake-grounding",
        rootActionId: ROOT_ACTION_ID,
        status: "committed",
      },
      changes: [{
        kind: "actionRuled",
        goal: "环顾大厅里明显可见的环境",
        method: "站在原地环顾，低头看向脚下后再转向左前方，不触碰物品",
        feasibility: "directSuccess",
        publicBasis: "",
      }],
    },
    tacticalProjection: {
      self: {
        id: "character:alice",
        name: "阿莱莎",
        kind: "player",
        position: { x: "-300", y: "-240", elevation: "0" },
      },
      visibleEntities: [
        { id: "npc:lian", name: "莉安", kind: "npc", position: { x: "-180", y: "-240" } },
        { id: "npc:naes", name: "奈斯", kind: "npc", position: { x: "-60", y: "-240" } },
        { id: "npc:varo", name: "瓦罗", kind: "npc", position: { x: "60", y: "-240" } },
      ],
      knownFeatures: [
        { id: "feature:tables", label: "拼起的长桌", state: "intact" },
        { id: "feature:wet-floor", label: "带泥湿地", state: "wet" },
        { id: "feature:hearth", label: "石砌炉台", state: "intact" },
      ],
      textualReadout: {
        summary: "你可见三个其他单位与三个已知环境要素。",
        entities: ["莉安与我约距 10 尺。", "奈斯与我约距 20 尺。", "瓦罗与我约距 30 尺。"],
        features: ["拼起的长桌。", "带泥湿地。", "石砌炉台。"],
      },
    },
    experiencedTranscript: [{
      deliveryId: "delivery:old",
      text: unsupportedBodies.join(""),
    }],
  };
  const narration = (body) => ({
    body,
    tts: "你看清了当前环境。",
    decisionPrompt: "你接下来怎么做？",
    referencedProjectionRefs: [],
    agencyClaims: [],
  });
  const groundedBody = unsupportedBodies.join("");
  const actionOnlyBody = "你低头看向脚下，又转向左前方。";
  const safeReplacementBody = "你完成了观察；目前没有更多可以确认的细节。";
  const rejectedNarrationCanary = "无效输出回填金丝雀";
  const receipts = [];
  const ai = scriptedAi([
    officialToolResponse(
      "submit_current_narration",
      narration(`${unsupportedBodies[0]}${rejectedNarrationCanary}`),
    ),
    officialToolResponse("submit_current_narration", narration(safeReplacementBody)),
    ...schemaInvalidTwice(unsupportedBodies.map((body) =>
      officialToolResponse("submit_current_narration", narration(body)))),
    ...schemaInvalidTwice([
      officialToolResponse("submit_current_narration", {
        ...narration("你看清了当前环境。"),
        tts: unsupportedBodies[0],
      }),
    ]),
    officialToolResponse("submit_current_narration", narration(actionOnlyBody)),
    officialToolResponse("submit_current_narration", narration(groundedBody)),
  ]);
  const adapter = createAuthoritativeKpAdapter({
    ai,
    now: monotonicClock(),
    onInvocationReceipt(value) {
      receipts.push(value);
    },
  });
  const request = {
    rootActionId: ROOT_ACTION_ID,
    receipt: { receiptId: "receipt:wake-grounding", status: "committed" },
    projection,
  };

  const repaired = await adapter.narrate(request);
  assert.equal(repaired.body, safeReplacementBody);
  assert.equal(ai.calls[0].model, AUTHORITATIVE_KP_PROFILE.modelId);
  assert.equal(ai.calls[1].model, AUTHORITATIVE_KP_PROFILE.modelId);
  assert.equal(ai.calls[1].input.temperature, 0);
  const correctionPayload = JSON.parse(ai.calls[1].input.messages[1].content);
  assert.equal(
    correctionPayload.narrationOutputCorrection.previousNarrationStatus,
    "discardedBeforeDelivery",
  );
  assert.match(
    correctionPayload.narrationOutputCorrection.requirements.join("\n"),
    /只呈现当前投影明确支持.*没有就省略/s,
  );
  assert.doesNotMatch(
    ai.calls[1].input.messages[1].content,
    new RegExp(rejectedNarrationCanary),
    "the rejected narration must not be copied into the replacement prompt",
  );
  assert.deepEqual(
    receipts.map(({ result }) => result),
    ["modelPermanent", "success"],
    "the discarded invocation and its successful replacement are both observable",
  );

  const fallbackBody = "刚才的尝试已经结算。眼下没有更多可以确认的新变化。";
  for (const body of unsupportedBodies) {
    const fallback = await adapter.narrate(request);
    assert.equal(fallback.body, fallbackBody, body);
    assert.equal(fallback.body.includes(body), false);
    assert.equal(fallback.modelInvocationReceipt.failureStage, "narrationGrounding");
  }
  const ttsFallback = await adapter.narrate(request);
  assert.equal(ttsFallback.body, fallbackBody, "tts grounding failure must also degrade safely");
  assert.equal(ttsFallback.modelInvocationReceipt.failureStage, "narrationGrounding");
  const actionOnly = await adapter.narrate(request);
  assert.equal(actionOnly.body, actionOnlyBody, "the guard must not be a bare phrase blacklist");

  const groundedProjection = {
    ...projection,
    projectionHash: "projection:alice:wake-grounded",
    visibleFacts: [{
      id: "fact:wake-current-sensory-evidence",
      kind: "sensoryEvidence",
      value: [
        "你脚下有一片带泥的湿地。",
        "泥土的痕迹从门口一路拖进来。",
        "三人的目光越过你，望向你身后。",
        "长桌上铺着白布。",
        "炉台里的火苗噼啪作响。",
        "石砌炉台投下暗影，三人都保持着守灵的姿态。",
        "空气里弥漫着蜡烛与潮湿泥土的气味。",
        "莉安站在你左前方。",
      ],
    }],
  };
  const result = await adapter.narrate({ ...request, projection: groundedProjection });
  assert.equal(result.body, groundedBody);
  assert.equal(ai.calls.length, 2 + unsupportedBodies.length * 2 + 2 + 2);
});

test("narration rejects unsolicited tactical distance readouts but allows an explicit distance question", async () => {
  const distanceBody = "莉安与你相距十尺，奈斯与你相距二十尺，瓦罗与你相距三十尺。";
  const distanceRequest = "我想知道这三个人分别与我相距多少尺。";
  const narration = {
    body: distanceBody,
    tts: distanceBody,
    decisionPrompt: "你接下来怎么做？",
    referencedProjectionRefs: [],
    agencyClaims: [],
  };
  const projection = {
    viewer: { kind: "player", characterId: "character:alice" },
    projectionHash: "projection:alice:distance-readout",
    committedDelta: {
      schema: "zhuwei.observer-committed-delta/v1",
      actorCharacterId: "character:alice",
      viewerCharacterId: "character:alice",
      receipt: {
        receiptId: "receipt:distance-readout",
        rootActionId: ROOT_ACTION_ID,
        status: "committed",
      },
      changes: [{ kind: "actionCommitted", status: "committed" }],
    },
    tacticalProjection: {
      textualReadout: {
        entities: ["莉安与你相距十尺。", "奈斯与你相距二十尺。", "瓦罗与你相距三十尺。"],
      },
    },
    experiencedTranscript: {
      schema: "zhuwei.experienced-transcript/v1",
      messages: [{
        messageId: "action:current:alice",
        kind: "player",
        body: "我环顾大厅，只确认眼前可见的事物。",
        sourceEventSeq: "current",
        receiptId: "current",
      }],
    },
  };
  const ai = scriptedAi([
    officialToolResponse("submit_current_narration", narration),
    officialToolResponse("submit_current_narration", narration),
    officialToolResponse("submit_current_narration", {
      ...narration,
      referencedProjectionRefs: [distanceRequest],
    }),
  ]);
  const adapter = createAuthoritativeKpAdapter({ ai, now: monotonicClock() });
  const request = {
    rootActionId: ROOT_ACTION_ID,
    receipt: { receiptId: "receipt:distance-readout", status: "committed" },
    projection,
  };

  const fallback = await adapter.narrate(request);
  assert.equal(fallback.body, "刚才的尝试已经结算。眼下没有更多可以确认的新变化。");
  assert.equal(fallback.body.includes(distanceBody), false);
  assert.equal(fallback.modelInvocationReceipt.failureStage, "narrationGrounding");
  const requestedProjection = structuredClone(projection);
  requestedProjection.projectionHash = "projection:alice:distance-requested";
  requestedProjection.experiencedTranscript.messages[0].body = distanceRequest;
  const accepted = await adapter.narrate({ ...request, projection: requestedProjection });
  assert.equal(accepted.body, distanceBody);
  assert.equal(ai.calls.length, 3);
});

test("a narration replacement cannot start a fresh invocation timeout window", async () => {
  const projection = {
    viewer: { kind: "player", characterId: "character:alice" },
    projectionHash: "projection:alice:narration-timeout",
    committedDelta: {
      schema: "zhuwei.observer-committed-delta/v1",
      actorCharacterId: "character:alice",
      viewerCharacterId: "character:alice",
      receipt: {
        receiptId: "receipt:narration-timeout",
        rootActionId: ROOT_ACTION_ID,
        status: "committed",
      },
      changes: [{ kind: "fictionTimeAdvanced", durationMicros: "1000000" }],
    },
  };
  const ai = scriptedAi([
    officialToolResponse("submit_current_narration", {
      body: "缺少其余必填字段。",
    }),
  ]);
  const clockValues = [1_000, 45_999, 46_000];
  const adapter = createAuthoritativeKpAdapter({
    ai,
    now: () => clockValues.shift() ?? 46_000,
    invocationTimeoutMs: 45_000,
  });

  await assert.rejects(adapter.narrate({
    rootActionId: ROOT_ACTION_ID,
    receipt: { receiptId: "receipt:narration-timeout", status: "committed" },
    projection,
  }), (error) => error instanceof AuthoritativeKpModelError && error.code === "modelPermanent");
  assert.equal(ai.calls.length, 1);
});

test("narration projection carries typed noncombat subjects without exposing hidden entities", async () => {
  const projection = narrationProjection({
    kind: "projected",
    projectionHash: "projection:alice:noncombat-npc",
    viewer: { kind: "player", subjectId: "character:alice" },
    controlledCharacter: { characterId: "character:alice", sceneId: "scene:hall" },
    visibleFacts: [{
      id: "fact:warden-spoke-about-door",
      kind: "npcStatement",
      subjectRefs: ["npc:warden"],
      value: "守卫说东侧的门没有上锁。",
    }],
    committedDelta: {
      schema: "zhuwei.observer-committed-delta/v1",
      actorCharacterId: "npc:warden",
      viewerCharacterId: "character:alice",
      receipt: { receiptId: "receipt:warden-speaks", rootActionId: ROOT_ACTION_ID, status: "committed" },
      changes: [{ kind: "factCommitted", factId: "fact:warden-spoke-about-door" }],
    },
  }, "character:alice", "receipt:warden-speaks", {
    "character:alice": { id: "character:alice", kind: "player" },
    "npc:warden": { id: "npc:warden", kind: "npc" },
    "npc:hidden-spy": { id: "npc:hidden-spy", kind: "npc" },
  });

  assert.deepEqual(projection.agencySubjects, [
    { subjectKind: "playerCharacter", subjectRef: "character:alice" },
    { subjectKind: "npc", subjectRef: "npc:warden" },
  ]);
  assert.equal(JSON.stringify(projection).includes("npc:hidden-spy"), false);
  assert.equal("entities" in projection, false, "noncombat narration must not need combat entities");

  const baseNarration = {
    body: "守卫看向你说：‘东侧的门没有上锁。’",
    tts: "守卫告诉你，东侧的门没有上锁。",
    decisionPrompt: "你要走向东侧的门，还是继续询问守卫？",
    referencedProjectionRefs: ["fact:warden-spoke-about-door"],
  };
  const ai = scriptedAi([
    ...schemaInvalidTwice([
      officialToolResponse("submit_current_narration", {
        ...baseNarration,
        agencyClaims: [{
          subjectKind: "playerCharacter",
          subjectRef: "npc:warden",
          claimKind: "committedObservableAction",
          basisRefs: ["fact:warden-spoke-about-door"],
        }],
      }),
    ]),
    officialToolResponse("submit_current_narration", {
      ...baseNarration,
      agencyClaims: [{
        subjectKind: "npc",
        subjectRef: "npc:warden",
        claimKind: "dialogue",
        basisRefs: ["fact:warden-spoke-about-door"],
      }],
    }),
  ]);
  const adapter = createAuthoritativeKpAdapter({ ai, now: monotonicClock() });
  const request = {
    rootActionId: ROOT_ACTION_ID,
    receipt: { receiptId: "receipt:warden-speaks", status: "committed" },
    projection,
  };

  await assert.rejects(
    adapter.narrate(request),
    (error) => error instanceof AuthoritativeKpModelError && error.code === "modelPermanent",
  );
  await assert.doesNotReject(() => adapter.narrate(request));
  assert.match(ai.calls.at(-1).input.messages[0].content, /audienceProjection\.agencySubjects/);
});

test("post-commit narration rejects missing, mis-typed, or player-owned agency claims", async () => {
  const projection = {
    viewer: { kind: "player", viewerKey: "character:alice", characterId: "character:alice" },
    projectionHash: "projection:alice:agency",
    committedDelta: {
      schema: "zhuwei.observer-committed-delta/v1",
      actorCharacterId: "character:alice",
      viewerCharacterId: "character:alice",
      receipt: { receiptId: "receipt:door-open", rootActionId: ROOT_ACTION_ID, status: "committed" },
      changes: [{ kind: "checkResolved", outcome: "success", result: "门已经打开。" }],
    },
    committedFacts: ["fact:door-open"],
    agencySubjects: [
      { subjectKind: "playerCharacter", subjectRef: "character:alice" },
      { subjectKind: "npc", subjectRef: "npc:warden" },
    ],
  };
  const baseNarration = {
    tts: "门打开了。",
    decisionPrompt: "门后的走廊已经显露，你要怎么做？",
    referencedProjectionRefs: ["fact:door-open"],
  };
  const playerClaim = (claimKind) => ({
    subjectKind: "playerCharacter",
    subjectRef: "character:alice",
    claimKind,
    basisRefs: ["fact:door-open"],
  });
  const forbidden = [
    ["thought", "你认定门后绝对安全。"],
    ["emotion", "你因成功而感到狂喜。"],
    ["dialogue", "你说：‘大家跟我来。’"],
    ["nextAction", "你决定立刻冲进走廊。"],
  ];
  const misTyped = [
    {
      subjectKind: "npc",
      subjectRef: "character:alice",
      claimKind: "dialogue",
      basisRefs: ["fact:door-open"],
    },
    {
      subjectKind: "playerCharacter",
      subjectRef: "npc:warden",
      claimKind: "committedObservableAction",
      basisRefs: ["fact:door-open"],
    },
    {
      subjectKind: "npc",
      subjectRef: "fact:door-open",
      claimKind: "dialogue",
      basisRefs: ["fact:door-open"],
    },
  ];
  const allowed = {
    ...baseNarration,
    body: "你推开的门已经敞开；冷风从门后的走廊迎面吹来。",
    agencyClaims: [
      playerClaim("committedObservableAction"),
      playerClaim("sensoryConsequence"),
    ],
  };
  const ai = scriptedAi([
    ...schemaInvalidTwice([
      officialToolResponse("submit_current_narration", {
        ...baseNarration,
        body: "你认定门后绝对安全。",
      }),
      ...forbidden.map(([claimKind, body]) => officialToolResponse("submit_current_narration", {
        ...baseNarration,
        body,
        agencyClaims: [playerClaim(claimKind)],
      })),
      ...misTyped.map((claim) => officialToolResponse("submit_current_narration", {
        ...baseNarration,
        body: "门边传来一句简短回应。",
        agencyClaims: [claim],
      })),
    ]),
    officialToolResponse("submit_current_narration", allowed),
  ]);
  const adapter = createAuthoritativeKpAdapter({ ai, now: monotonicClock() });
  const request = {
    rootActionId: ROOT_ACTION_ID,
    receipt: { receiptId: "receipt:door-open", status: "committed" },
    projection,
  };

  await assert.rejects(adapter.narrate(request), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.code, "modelPermanent");
    return true;
  });
  for (const [claimKind] of forbidden) {
    await assert.rejects(adapter.narrate(request), (error) => {
      assert.ok(error instanceof AuthoritativeKpModelError, claimKind);
      assert.equal(error.code, "modelPermanent", claimKind);
      return true;
    });
  }
  for (const claim of misTyped) {
    await assert.rejects(adapter.narrate(request), (error) => {
      assert.ok(error instanceof AuthoritativeKpModelError, JSON.stringify(claim));
      assert.equal(error.code, "modelPermanent", JSON.stringify(claim));
      return true;
    });
  }
  await assert.doesNotReject(async () => {
    const narration = await adapter.narrate(request);
    assert.deepEqual(narration.agencyClaims, allowed.agencyClaims);
  });

  const schema = ai.calls.at(-1).input.tools[0].function.parameters;
  assert.ok(schema.required.includes("agencyClaims"));
  assert.equal(schema.properties.referencedProjectionRefs.uniqueItems, true);
  assert.equal(schema.properties.agencyClaims.uniqueItems, true);
  const agencyBranches = schema.properties.agencyClaims.items.anyOf;
  const agencyBranch = (subjectKind) => agencyBranches.find((branch) =>
    branch.properties.subjectKind.const === subjectKind);
  assert.ok(agencyBranches.every((branch) => branch.additionalProperties === false));
  assert.deepEqual(agencyBranch("playerCharacter").properties.claimKind.enum, [
    "committedObservableAction",
    "sensoryConsequence",
  ]);
  assert.deepEqual(agencyBranch("npc").properties.claimKind.enum, [
    "committedObservableAction",
    "sensoryConsequence",
    "thought",
    "emotion",
    "dialogue",
    "nextAction",
  ]);
  assert.deepEqual(agencyBranch("world").properties.subjectRef, { type: "null" });
  assert.deepEqual(agencyBranch("world").properties.claimKind, { const: "sensoryConsequence" });
  assert.equal(schema.properties.body.pattern, "\\S");
});

test("strict text fallback accepts only a complete schema-valid JSON object", async () => {
  const value = proposal({
    kind: "directSuccess",
    risk: null,
    mechanicalProposal: {
      operation: "resolveDirectConsequences",
      duration: { unit: "minute", value: 10 },
      frozenCosts: [],
      success: [],
      failure: [],
    },
  });
  const ai = scriptedAi([
    {
      response: JSON.stringify(value),
      usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
    },
  ]);
  const adapter = createAuthoritativeKpAdapter({ ai, now: monotonicClock() });

  const result = await adapter.propose(proposalRequest());

  assert.equal(result.kind, "directSuccess");
  assert.equal(result.modelInvocationReceipt.inputTokens, 12);
  assert.equal(result.modelInvocationReceipt.outputTokens, 34);
  assert.equal("response_format" in ai.calls[0].input, false);
});

test("Room proposal normalization admits only typed production drafts and the exact pending capability", () => {
  const rootActionId = "root:normalizer:typed";
  const compound = normalizeRoomKpProposal({
    ...proposal(),
    rootActionId,
    proposalAttemptId: "proposal:normalizer:1",
  });
  assert.equal(compound?.kind, "resolveCompoundActionPlan");
  assert.equal(compound?.actionPlanVersion, "authoritative-kp-action-plan-v1");
  assert.equal(compound?.mechanicalProposal?.operation, "resolveNoncombatCheck");

  const pending = normalizeRoomKpProposal({
    ...proposal({
      kind: "directSuccess",
      risk: null,
      npcActions: [],
      pendingInput: {
        kind: "clarification",
        prompt: "你选择左侧还是右侧？",
        choices: [
          { id: "left", label: "左侧", consequence: "沿左侧继续。" },
          { id: "right", label: "右侧", consequence: "沿右侧继续。" },
        ],
      },
      mechanicalProposal: null,
    }),
    rootActionId,
  });
  assert.equal(pending?.kind, "clarification");
  assert.deepEqual(pending?.choices, [
    { choiceId: "left", label: "左侧" },
    { choiceId: "right", label: "右侧" },
  ]);

  const playerChoice = normalizeRoomKpProposal({
    ...proposal({
      kind: "directSuccess",
      risk: null,
      npcActions: [],
      pendingInput: {
        kind: "playerChoice",
        prompt: "你明确拉哪一根拉杆？",
        choices: [
          { id: "alarm", label: "拉警铃", consequence: "警铃会通知守卫。" },
          { id: "gate", label: "拉闸门杆", consequence: "东侧闸门会升起。" },
        ],
      },
      mechanicalProposal: null,
    }),
    rootActionId,
  });
  assert.deepEqual(playerChoice, {
    kind: "playerChoice",
    prompt: "你明确拉哪一根拉杆？",
    choices: [
      { choiceId: "alarm", label: "拉警铃", consequence: "警铃会通知守卫。" },
      { choiceId: "gate", label: "拉闸门杆", consequence: "东侧闸门会升起。" },
    ],
  });

  for (const compact of [
    { kind: "resolveImprovisedAction", rootActionId },
    { kind: "resolveContest", rootActionId },
    { kind: "startEncounter", rootActionId },
    { kind: "invitePartyMember", rootActionId },
    { kind: "moveIndividually", rootActionId },
    { kind: "resolveMeaningfulFailure", rootActionId },
    { kind: "concludeStory", rootActionId },
  ]) assert.equal(normalizeRoomKpProposal(compact), undefined);

  assert.deepEqual(normalizeRoomKpProposal({
    kind: "authenticatedPendingAnswer",
    rootActionId,
  }), {
    kind: "authenticatedPendingAnswer",
    rootActionId,
  });
  assert.equal(normalizeRoomKpProposal({
    kind: "authenticatedPendingAnswer",
    rootActionId,
    forged: true,
  }), undefined);
});

test("production infeasible rulings use a typed rejection ActionPlan", async () => {
  const value = proposal({
    kind: "missingPrerequisite",
    risk: {
      warning: "必须先取得能承受钟架重量的撬杆。",
      successConsequences: [],
      failureConsequences: [],
      retryGate: ["materialAssistance"],
    },
    npcActions: [],
    mechanicalProposal: { operation: "rejectInfeasibleAction" },
  });
  const ai = scriptedAi([officialToolResponse("submit_kp_proposal", value)]);
  const adapter = createAuthoritativeKpAdapter({ ai, now: monotonicClock() });

  const result = await adapter.propose(proposalRequest());

  assert.equal(result.kind, "missingPrerequisite");
  assert.deepEqual(result.mechanicalProposal, { operation: "rejectInfeasibleAction" });
});

test("feasibility rulings and mechanical operations cannot contradict each other", async () => {
  const directButRolled = proposal({
    kind: "directSuccess",
    risk: null,
  });
  const uncertainButDeterministic = proposal({
    kind: "checkRequired",
    mechanicalProposal: {
      operation: "resolveDirectConsequences",
      duration: { unit: "minute", value: 1 },
      frozenCosts: [],
      success: [],
      failure: [],
    },
  });
  const ai = scriptedAi(schemaInvalidTwice([
    officialToolResponse("submit_kp_proposal", directButRolled),
    officialToolResponse("submit_kp_proposal", uncertainButDeterministic),
  ]));
  const adapter = createAuthoritativeKpAdapter({ ai, now: monotonicClock() });

  for (const label of ["direct success with a roll", "uncertainty without an uncertain operation"]) {
    await assert.rejects(adapter.propose(proposalRequest()), (error) => {
      assert.ok(error instanceof AuthoritativeKpModelError, label);
      assert.equal(error.code, "modelPermanent", label);
      return true;
    });
  }
  assert.equal(ai.calls.length, 4);
});

test("timeout, quota exhaustion, and invalid model output return stable redacted failures", async () => {
  const leakedOutput = `raw-output:${PRIVATE_FACT}`;
  const invalidAi = scriptedAi([{ response: `prefix ${JSON.stringify(proposal())} ${leakedOutput}` }]);
  const invalidAdapter = createAuthoritativeKpAdapter({ ai: invalidAi, now: monotonicClock() });

  await assert.rejects(invalidAdapter.propose(proposalRequest()), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.code, "modelPermanent");
    assert.equal(error.modelInvocationReceipt.result, "modelPermanent");
    assert.equal(error.modelInvocationReceipt.failureStage, "structuredOutput");
    assert.match(error.modelInvocationReceipt.responseHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(serialized(error).includes(leakedOutput), false);
    assert.equal(serialized(error).includes(PRIVATE_FACT), false);
    return true;
  });
  assert.equal(invalidAi.calls.length, 1, "structured-output failures are not repairable");

  const forgedAuthorityReceipts = [];
  const forgedAuthorityAi = scriptedAi(schemaInvalidTwice([
    officialToolResponse(
      "submit_kp_proposal",
      proposal({
        mechanicalProposal: {
          operation: "resolveNoncombatCheck",
          d20Roll: 20,
          events: [{ kind: "FactDeclared", value: "model-authored-state" }],
        },
      }),
    ),
  ]));
  const forgedAuthorityAdapter = createAuthoritativeKpAdapter({
    ai: forgedAuthorityAi,
    now: monotonicClock(),
    onInvocationReceipt(value) {
      forgedAuthorityReceipts.push(value);
    },
  });
  await assert.rejects(forgedAuthorityAdapter.propose(proposalRequest()), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.code, "modelPermanent");
    assert.equal(error.modelInvocationReceipt.failureStage, "proposalSchema");
    return true;
  });
  assert.equal(
    forgedAuthorityAi.calls.length,
    2,
    "one replacement attempt must not turn consecutive invalid proposals into success",
  );
  assert.deepEqual(
    forgedAuthorityReceipts.map(({ result, failureStage }) => ({ result, failureStage })),
    [
      { result: "modelPermanent", failureStage: "proposalSchema" },
      { result: "modelPermanent", failureStage: "proposalSchema" },
    ],
  );

  const deterministicReceipts = [];
  const deterministicallyRepairableAi = scriptedAi([
    officialToolResponse("submit_kp_proposal", proposal({
      publicBasisRefs: [
        "fact:ordinary-courtyard-door-is-unlocked",
        "fact:not-in-the-kp-projection",
      ],
      dynamicMaterializations: [{
        kind: "passage",
        factRef: "fact:newly-seen-exit",
        causalBasisRefs: ["fact:not-in-the-kp-projection"],
        visibilityPolicyRef: "visibility:public",
        definition: { summary: "大厅东侧有一扇明显可见的门。" },
      }],
    })),
  ]);
  const deterministicallyRepairableAdapter = createAuthoritativeKpAdapter({
    ai: deterministicallyRepairableAi,
    now: monotonicClock(),
    onInvocationReceipt(value) {
      deterministicReceipts.push(value);
    },
  });
  const deterministicallyRepaired = await deterministicallyRepairableAdapter.propose(
    proposalRequest(),
  );
  assert.deepEqual(deterministicallyRepaired.publicBasisRefs, [
    "fact:ordinary-courtyard-door-is-unlocked",
  ]);
  assert.deepEqual(
    deterministicallyRepaired.dynamicMaterializations[0].causalBasisRefs,
    [],
  );
  assert.equal(
    deterministicallyRepairableAi.calls.length,
    1,
    "projection-only reference cleanup must not make the model guess refs twice",
  );
  assert.deepEqual(
    deterministicReceipts.map(({ result, failureStage }) => ({ result, failureStage })),
    [{ result: "success", failureStage: undefined }],
  );
  assert.deepEqual(
    deterministicallyRepaired.npcActions,
    proposal().npcActions,
    "valid finite-knowledge NPC actions must remain byte-for-byte equivalent",
  );

  const projectionBoundNormalizationCases = [
    {
      label: "dynamic causal reference",
      draft: proposal({
        dynamicMaterializations: [{
          kind: "passage",
          factRef: "fact:newly-seen-exit",
          causalBasisRefs: ["fact:newly-seen-exit"],
          visibilityPolicyRef: "visibility:public",
          definition: { summary: "大厅东侧有一扇明显可见的门。" },
        }],
      }),
      verify(result) {
        assert.deepEqual(result.dynamicMaterializations[0].causalBasisRefs, []);
      },
    },
    {
      label: "NPC finite-knowledge reference",
      draft: proposal({
        npcActions: [{
          npcId: "npc:warden",
          goal: "检查大厅里的动静",
          method: "沿回廊巡视",
          knowledgeRefs: [PRIVATE_FACT],
          mechanicalProposal: null,
        }],
      }),
      verify(result) {
        assert.deepEqual(result.npcActions, []);
      },
    },
  ];
  for (const { label, draft, verify } of projectionBoundNormalizationCases) {
    const normalizationAi = scriptedAi([
      officialToolResponse("submit_kp_proposal", draft),
    ]);
    const normalizationAdapter = createAuthoritativeKpAdapter({
      ai: normalizationAi,
      now: monotonicClock(),
    });
    const normalizationResult = await normalizationAdapter.propose(proposalRequest());
    assert.equal(normalizationResult.proposalAttemptId, `${ROOT_ACTION_ID}:kp:1`, label);
    assert.equal(normalizationAi.calls.length, 1, label);
    verify(normalizationResult);
  }

  const unknownNpcAi = scriptedAi([
    officialToolResponse("submit_kp_proposal", proposal({
      npcActions: [
        ...proposal().npcActions,
        {
          npcId: "npc:unknown",
          goal: "确认院内是否出现异常声响",
          method: "沿回廊继续巡查并留意钟架方向",
          knowledgeRefs: ["claim:warden-heard-a-bell"],
          mechanicalProposal: null,
        },
      ],
    })),
  ]);
  const unknownNpcAdapter = createAuthoritativeKpAdapter({
    ai: unknownNpcAi,
    now: monotonicClock(),
  });
  const unknownNpcNormalized = await unknownNpcAdapter.propose(proposalRequest());
  assert.deepEqual(unknownNpcNormalized.npcActions, proposal().npcActions);
  assert.equal(unknownNpcAi.calls.length, 1, "an invalid NPC action is omitted, never reassigned");

  const precedentProjection = {
    ...KP_PROJECTION,
    adjudicationPrecedents: [{ precedentId: "precedent:other" }],
  };
  const precedent = {
    kind: "supersede",
    supersededPrecedentId: "precedent:missing",
    materialDifferences: ["场景压力发生实质变化"],
    publicRuleBasis: ["同类裁定应保持一致"],
    applicabilityScope: { kind: "scene", ref: "scene:courtyard" },
  };
  const precedentSwitchAi = scriptedAi([
    officialToolResponse("submit_kp_proposal", proposal({ adjudicationPrecedent: precedent })),
  ]);
  const precedentSwitchAdapter = createAuthoritativeKpAdapter({
    ai: precedentSwitchAi,
    now: monotonicClock(),
  });
  await assert.rejects(precedentSwitchAdapter.propose(proposalRequest({
    projection: precedentProjection,
  })), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.modelInvocationReceipt.failureStage, "projectionBinding");
    return true;
  });
  assert.equal(
    precedentSwitchAi.calls.length,
    1,
    "an invalid precedent remains a failure rather than switching precedent identity",
  );

  const quotaAi = scriptedAi([
    () => {
      const error = new Error(`quota detail must stay private: ${PRIVATE_FACT}`);
      error.status = 429;
      error.code = "quota_exhausted";
      throw error;
    },
  ]);
  const quotaAdapter = createAuthoritativeKpAdapter({ ai: quotaAi, now: monotonicClock() });
  await assert.rejects(quotaAdapter.propose(proposalRequest()), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.code, "quotaExhausted");
    assert.equal(error.modelInvocationReceipt.result, "quotaExhausted");
    assert.equal(serialized(error).includes(PRIVATE_FACT), false);
    return true;
  });

  const timeoutAi = scriptedAi([() => new Promise(() => {})]);
  const timeoutAdapter = createAuthoritativeKpAdapter({
    ai: timeoutAi,
    now: monotonicClock(),
    invocationTimeoutMs: 5,
  });
  await assert.rejects(timeoutAdapter.propose(proposalRequest()), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.code, "modelTransient");
    assert.equal(error.modelInvocationReceipt.result, "modelTransient");
    assert.equal(serialized(error).includes(PRIVATE_FACT), false);
    return true;
  });
});

test("projection-reference normalization never starts a second model timeout window", async () => {
  const ai = scriptedAi([
    officialToolResponse("submit_kp_proposal", proposal({
      publicBasisRefs: ["fact:not-in-the-kp-projection"],
    })),
  ]);
  const adapter = createAuthoritativeKpAdapter({
    ai,
    now: monotonicClock(),
    invocationTimeoutMs: 100,
  });

  const startedAt = Date.now();
  const result = await adapter.propose(proposalRequest());
  const elapsedMs = Date.now() - startedAt;

  assert.deepEqual(result.publicBasisRefs, []);
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].options.signal.aborted, false);
  assert.ok(elapsedMs < 90, `projection normalization exceeded the 100ms budget (${elapsedMs}ms)`);
});

test("every final model task result emits exactly one redacted invocation receipt", async () => {
  const receipts = [];
  const quota = new Error(`private provider detail: ${PRIVATE_FACT}`);
  quota.status = 429;
  quota.code = "quota_exhausted";
  const ai = scriptedAi([
    officialToolResponse("submit_kp_proposal", proposal()),
    quota,
  ]);
  const adapter = createAuthoritativeKpAdapter({
    ai,
    now: monotonicClock(),
    onInvocationReceipt(value) {
      receipts.push(value);
    },
  });

  await adapter.propose(proposalRequest());
  await assert.rejects(adapter.propose(proposalRequest()), AuthoritativeKpModelError);

  assert.equal(receipts.length, 2);
  assert.equal(receipts[0].result, "success");
  assert.equal(receipts[1].result, "quotaExhausted");
  assert.ok(receipts.every((entry) => entry.rootActionId === ROOT_ACTION_ID));
  assert.equal(serialized(receipts).includes(PRIVATE_FACT), false);

  const nonBlocking = createAuthoritativeKpAdapter({
    ai: scriptedAi([officialToolResponse("submit_kp_proposal", proposal())]),
    now: monotonicClock(),
    onInvocationReceipt() {
      throw new Error("telemetry sink unavailable");
    },
  });
  await assert.doesNotReject(nonBlocking.propose(proposalRequest()));
});
