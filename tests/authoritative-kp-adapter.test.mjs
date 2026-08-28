import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTHORITATIVE_KP_PROFILE,
  AuthoritativeKpModelError,
  createAuthoritativeKpAdapter,
} from "../app/_runtime/lib/kp/authoritative.ts";
import { authoritativeKpProfileByBinding } from "../app/_runtime/lib/kp/authoritative-policy.ts";
import { normalizeRoomKpProposal } from "../app/_runtime/lib/room/proposal-adapter.ts";

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
      frozenCosts: [{ kind: "artifactDurabilityRisk", artifactRef: "item:rain-cape" }],
      success: [{ kind: "moveArtifact", artifactRef: "artifact:bell-frame", to: "place:wall" }],
      failure: [{ kind: "sensoryEvidence", observerRef: "npc:warden", evidence: "metal-scrape" }],
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
      success: [{ kind: "moveArtifact", artifactRef: "artifact:bell-frame", to: "place:wall" }],
      failure: [{ kind: "sensoryEvidence", observerRef: "npc:warden", evidence: "metal-scrape" }],
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

  await assert.rejects(
    adapter.propose(proposalRequest({ attempt: 3, diagnostics })),
    (error) => {
      assert.ok(error instanceof AuthoritativeKpModelError);
      assert.equal(error.code, "modelPermanent");
      return true;
    },
    "an NPC action must not cite knowledge available only to the KP viewer",
  );

  await assert.rejects(
    adapter.propose(proposalRequest({ attempt: 4, diagnostics })),
    (error) => {
      assert.ok(error instanceof AuthoritativeKpModelError);
      assert.equal(error.code, "modelPermanent");
      return true;
    },
  );
  assert.equal(ai.calls.length, 3, "more than two diagnostic revisions must not invoke the model");
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
  assert.equal(ai.calls.length, 6);

  assert.equal(AUTHORITATIVE_KP_PROFILE.promptPolicyVersion, "authoritative-kp-prompt-policy-v4");
  assert.equal(AUTHORITATIVE_KP_PROFILE.proposalSchemaVersion, "authoritative-kp-proposal-v2");
  assert.equal(AUTHORITATIVE_KP_PROFILE.actionPlanSchemaVersion, "authoritative-kp-action-plan-v1");
  assert.equal(AUTHORITATIVE_KP_PROFILE.narrationSchemaVersion, "authoritative-kp-narration-v3");

  const planSchema = ai.calls[0].input.tools[0].function.parameters
    .properties.mechanicalProposal.anyOf[1];
  assert.equal(planSchema.additionalProperties, false);
  assert.deepEqual(planSchema.properties.operation.enum, [
    "resolveNoncombatCheck",
    "resolveNoncombatContest",
    "resolveNoncombatSave",
    "resolveDirectConsequences",
    "commitMeaningfulFailure",
    "retryFailedAction",
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
    "advanceFactionPlan",
    "changeKnowledge",
    "changeParty",
    "advanceCampaignLifecycle",
  ]);
  assert.equal(planSchema.properties.frozenCosts.items.additionalProperties, false);
  assert.deepEqual(planSchema.properties.experienceAmount, {
    type: "integer",
    minimum: 1,
    maximum: 1_000_000,
  });
  assert.deepEqual(planSchema.properties.lifecycleAction.enum, [
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
    planSchema.properties.activityTransitions.items.properties.disposition.enum,
    ["continue", "summarize", "interrupt", "complete"],
  );
  assert.equal(planSchema.properties.success.items.additionalProperties, false);
  assert.equal(planSchema.properties.failure.items.additionalProperties, false);
});

test("post-commit narration is generated once from each audience's isolated projection", async () => {
  const aliceProjection = {
    viewer: { kind: "player", viewerKey: "character:alice" },
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
    viewer: { kind: "player", viewerKey: "character:bob" },
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
    officialToolResponse("submit_current_narration", {
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
    }),
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

test("post-commit narration fails closed on undeclared or player-owned agency claims", async () => {
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
  const allowed = {
    ...baseNarration,
    body: "你推开的门已经敞开；冷风从门后的走廊迎面吹来。",
    agencyClaims: [
      playerClaim("committedObservableAction"),
      playerClaim("sensoryConsequence"),
    ],
  };
  const ai = scriptedAi([
    officialToolResponse("submit_current_narration", {
      ...baseNarration,
      body: "你认定门后绝对安全。",
    }),
    ...forbidden.map(([claimKind, body]) => officialToolResponse("submit_current_narration", {
      ...baseNarration,
      body,
      agencyClaims: [playerClaim(claimKind)],
    })),
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
  await assert.doesNotReject(async () => {
    const narration = await adapter.narrate(request);
    assert.deepEqual(narration.agencyClaims, allowed.agencyClaims);
  });

  const schema = ai.calls.at(-1).input.tools[0].function.parameters;
  assert.ok(schema.required.includes("agencyClaims"));
  assert.equal(schema.properties.agencyClaims.items.additionalProperties, false);
  assert.deepEqual(schema.properties.agencyClaims.items.properties.subjectKind.enum, [
    "playerCharacter",
    "npc",
    "world",
  ]);
  assert.deepEqual(schema.properties.agencyClaims.items.properties.claimKind.enum, [
    "committedObservableAction",
    "sensoryConsequence",
    "thought",
    "emotion",
    "dialogue",
    "nextAction",
  ]);
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
  const ai = scriptedAi([
    officialToolResponse("submit_kp_proposal", directButRolled),
    officialToolResponse("submit_kp_proposal", uncertainButDeterministic),
  ]);
  const adapter = createAuthoritativeKpAdapter({ ai, now: monotonicClock() });

  for (const label of ["direct success with a roll", "uncertainty without an uncertain operation"]) {
    await assert.rejects(adapter.propose(proposalRequest()), (error) => {
      assert.ok(error instanceof AuthoritativeKpModelError, label);
      assert.equal(error.code, "modelPermanent", label);
      return true;
    });
  }
  assert.equal(ai.calls.length, 2);
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

  const forgedAuthorityAi = scriptedAi([
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
  ]);
  const forgedAuthorityAdapter = createAuthoritativeKpAdapter({
    ai: forgedAuthorityAi,
    now: monotonicClock(),
  });
  await assert.rejects(forgedAuthorityAdapter.propose(proposalRequest()), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.code, "modelPermanent");
    assert.equal(error.modelInvocationReceipt.failureStage, "proposalSchema");
    return true;
  });

  const unboundReferenceAdapter = createAuthoritativeKpAdapter({
    ai: scriptedAi([
      officialToolResponse("submit_kp_proposal", proposal({
        publicBasisRefs: ["fact:not-in-the-kp-projection"],
      })),
    ]),
    now: monotonicClock(),
  });
  await assert.rejects(unboundReferenceAdapter.propose(proposalRequest()), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.code, "modelPermanent");
    assert.equal(error.modelInvocationReceipt.failureStage, "projectionBinding");
    return true;
  });

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
