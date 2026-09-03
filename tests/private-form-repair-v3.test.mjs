import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthoritativeKpModelError,
  createAuthoritativeKpAdapter,
} from "../app/_runtime/lib/kp/authoritative.ts";
import { AUTHORITATIVE_KP_PROFILES } from "../app/_runtime/lib/kp/authoritative-policy.ts";
import {
  KP_FORM_IDS,
  kpFormToolName,
} from "../app/_runtime/lib/kp/form-catalog.ts";
import { HEALING_POTION_ITEM_DEFINITION_ID } from "../app/_runtime/lib/rules/v2/items.ts";

const PROFILE = AUTHORITATIVE_KP_PROFILES[0];
const ABILITY_REF = "ability:alice:test-bow";
const FACT_REF = "fact:scene:loose-balcony";

function toolResponse(value, index = 1) {
  const formId = typeof value?.formId === "string" ? value.formId : undefined;
  const knownForm = KP_FORM_IDS.includes(formId);
  return {
    id: `model-response:private-form:${index}`,
    object: "chat.completion",
    created: 1_788_000_000 + index,
    model: PROFILE.modelId,
    choices: [{
      index: 0,
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: `call:private-form:${index}`,
          type: "function",
          function: {
            name: knownForm ? kpFormToolName(formId) : "submit_kp_invented_v1",
            arguments: JSON.stringify(value?.draft ?? value),
          },
        }],
      },
    }],
    usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 },
  };
}

function contextPack() {
  return {
    required: {
      intent: { submissionRef: "submission:private-form", text: "玩家自由输入" },
      mechanics: { resources: { resolve: 2 } },
      established: {
        factRefs: [FACT_REF],
        precedentRefs: [],
        dynamicDefinitionRefs: [ABILITY_REF],
      },
      bindings: {
        rulesRef: "rules:test",
        geometryRef: "geometry:test",
        moduleRef: "module:test",
        eventRef: "events:test",
      },
    },
    retrieved: {
      chunks: [{
        sourceRef: "srd:test:combat",
        profileRef: "rules:test",
        dependencyRefs: ["rules:test"],
        structuralRefs: [ABILITY_REF],
      }],
    },
    optional: { items: [] },
  };
}

function request(text = "我先用木杆试探松动的阳台边缘，再慢慢把重量压上去。") {
  return {
    preparedActionId: "prepared-action:private-form",
    rootActionId: "root-action:private-form",
    attempt: 1,
    input: {
      kind: "intent",
      submissionId: "submission:private-form",
      text,
      answer: { target: "阳台边缘", choice: "先用木杆试探" },
    },
    projection: { kind: "test-projection" },
  };
}

function ordinaryDraft(overrides = {}) {
  return {
    goal: "确认阳台边缘是否承重",
    method: "先用木杆试探，再把重量慢慢压上去",
    intendedOutcome: "找到一条不会踩塌边缘的路线",
    risk: "松动的石块可能坠落",
    resolution: "check",
    ability: "wis",
    skill: "investigation",
    dc: 13,
    mode: "normal",
    durationUnit: "minute",
    durationValue: 1,
    successConsequence: "角色确认安全落脚点。",
    failureConsequence: "石块先行松脱并暴露危险。",
    basisRefs: [FACT_REF],
    ...overrides,
  };
}

function adapterWithResponses(responses, calls) {
  return createAuthoritativeKpAdapter({
    profile: PROFILE,
    prepareV3Context: async (_request, allowedForms) => ({
      contextPack: contextPack(),
      orderedFormIds: allowedForms,
    }),
    ai: {
      async run(_model, input) {
        calls.push(input);
        const response = responses.shift();
        if (response === undefined) throw new Error("unexpected third model call");
        return response;
      },
    },
  });
}

test("one narrow repair cannot change goal, method, target semantics, or player choices", async () => {
  const calls = [];
  const initial = ordinaryDraft();
  delete initial.durationValue;
  const adapter = adapterWithResponses([
    toolResponse({ formId: "ordinary-check.v1", draft: initial }, 1),
    toolResponse({
      formId: "ordinary-check.v1",
      draft: ordinaryDraft({ intendedOutcome: "改为直接翻过护栏袭击下面的人" }),
    }, 2),
  ], calls);

  await assert.rejects(adapter.propose(request()), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.publicCode, "PROPOSAL_REPAIR_EXHAUSTED");
    assert.equal(error.modelInvocationReceipt.failureStage, "proposalSchema");
    return true;
  });
  assert.equal(calls.length, 2);
  const repairPayload = JSON.parse(calls[1].messages[1].content);
  assert.deepEqual(repairPayload.rejectedDraft, initial);
  assert.equal(repairPayload.originalForm, "ordinary-check.v1");
  assert.equal(repairPayload.selectedForm, "ordinary-check.v1");
  assert.equal(typeof repairPayload.semanticFreezeHash, "string");
  assert.equal("contextPack" in repairPayload, false);
  assert.equal("projection" in repairPayload, false);
});

test("V5 materialization rejects model-authored item mechanics before Rules", async () => {
  const calls = [];
  const sceneRef = "scene:private-form:apothecary";
  const materializationContext = contextPack();
  materializationContext.required.sceneDynamics = { sceneRef };
  const base = {
    goal: "取得药柜中因先前线索而存在的治疗药水",
    method: "materializeItem",
    basisRefs: [sceneRef, FACT_REF],
    resolution: "direct",
    durationUnit: "minute",
    durationValue: 1,
  };
  const invalid = {
    ...base,
    proposedFact: JSON.stringify({
      schema: "zhuwei.item-materialization-draft/v1",
      definitionRef: "item-definition:model-invented:greater-healing",
      quantity: 1,
      healing: "20d20+200",
    }),
  };
  const repaired = {
    ...base,
    proposedFact: JSON.stringify({
      schema: "zhuwei.item-materialization-draft/v1",
      definitionRef: HEALING_POTION_ITEM_DEFINITION_ID,
      quantity: 1,
    }),
  };
  const adapter = createAuthoritativeKpAdapter({
    profile: PROFILE,
    prepareV3Context: async (_request, allowedForms) => ({
      contextPack: materializationContext,
      orderedFormIds: allowedForms,
    }),
    ai: {
      async run(_model, input) {
        calls.push(input);
        return calls.length === 1
          ? toolResponse({ formId: "materialization.v1", draft: invalid }, 1)
          : toolResponse({ formId: "materialization.v1", draft: repaired }, 2);
      },
    },
  });

  await assert.rejects(adapter.propose(request("我拿起线索所指药柜里的治疗药水。")), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.publicCode, "PROPOSAL_REPAIR_EXHAUSTED");
    assert.equal(error.modelInvocationReceipt.failureStage, "proposalSchema");
    return true;
  });
  assert.equal(calls.length, 2);
  const repairPayload = JSON.parse(calls[1].messages[1].content);
  assert.ok(repairPayload.errors.includes("draft.proposedFact:item-materialization-schema-invalid"));
  assert.equal(JSON.stringify(repairPayload).includes("20d20+200"), true);
  assert.equal(JSON.stringify(repairPayload.finiteReferences).includes("greater-healing"), false);
});

test("a social Form repair cannot replace the typed goal, assertion, or NPC response", async () => {
  const calls = [];
  const npcRef = "npc:varo";
  const actorRef = "character:alice";
  const invalidEvidenceRef = "fact:not-authoritative";
  const originalIntent = {
    schema: "zhuwei.social-intent-draft/v1",
    npcRef,
    influenceGoal: "deemphasize",
    desiredBehavior: "不再追问猎魔人身份，转回眼前事务",
    addressedThreadRef: null,
    evidenceRefs: [invalidEvidenceRef],
    assertion: null,
  };
  const baseDraft = {
    goal: "让瓦罗不再紧抓猎魔人身份",
    method: "说明身份并不影响今天前来帮忙",
    utterance: "我对瓦罗说：是不是猎魔人都不重要，我今天是来这里帮忙的。",
    desiredResponse: JSON.stringify(originalIntent),
    npcResponse: JSON.stringify({
      schema: "zhuwei.npc-response-draft/v1",
      mode: "reaction",
      reaction: "redirect",
    }),
    basisRefs: [npcRef],
    resolution: "direct",
    durationUnit: "minute",
    durationValue: 1,
  };
  const maliciousRepair = {
    ...baseDraft,
    desiredResponse: JSON.stringify({
      ...originalIntent,
      influenceGoal: "beBelieved",
      desiredBehavior: "相信我是剑湾法庭猎魔人",
      evidenceRefs: [],
      assertion: {
        subjectRef: actorRef,
        predicate: "isA",
        polarity: "affirm",
        object: { referenceKind: "unresolvedLabel", label: "剑湾法庭猎魔人" },
      },
    }),
    npcResponse: JSON.stringify({
      schema: "zhuwei.npc-response-draft/v1",
      mode: "reaction",
      reaction: "acknowledge",
    }),
  };
  const socialContext = contextPack();
  socialContext.required.trustedControl = {
    characterRef: actorRef,
    controllerRef: actorRef,
  };
  socialContext.required.npcViews = [{ npcRef, knowledgeRefs: [] }];
  const adapter = createAuthoritativeKpAdapter({
    profile: PROFILE,
    prepareV3Context: async (_request, allowedForms) => ({
      contextPack: socialContext,
      orderedFormIds: allowedForms,
    }),
    ai: {
      async run(_model, input) {
        calls.push(input);
        return calls.length === 1
          ? toolResponse({ formId: "npc-exchange.v1", draft: baseDraft }, 1)
          : toolResponse({ formId: "npc-exchange.v1", draft: maliciousRepair }, 2);
      },
    },
  });

  await assert.rejects(adapter.propose({
    ...request(baseDraft.utterance),
    input: {
      kind: "intent",
      submissionId: "submission:private-form",
      characterId: actorRef,
      text: baseDraft.utterance,
    },
  }), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.publicCode, "PROPOSAL_REPAIR_EXHAUSTED");
    assert.equal(error.modelInvocationReceipt.failureStage, "proposalSchema");
    return true;
  });
  assert.equal(calls.length, 2);
});

test("a social Form repair may only remove the specifically invalid evidence leaf", async () => {
  const calls = [];
  const npcRef = "npc:varo";
  const actorRef = "character:alice";
  const invalidEvidenceRef = "fact:not-authoritative";
  const intent = {
    schema: "zhuwei.social-intent-draft/v1",
    npcRef,
    influenceGoal: "beBelieved",
    desiredBehavior: "暂时按玩家陈述的身份继续交谈",
    addressedThreadRef: null,
    evidenceRefs: [invalidEvidenceRef],
    assertion: {
      subjectRef: actorRef,
      predicate: "isA",
      polarity: "affirm",
      object: { referenceKind: "unresolvedLabel", label: "剑湾法庭猎魔人" },
    },
  };
  const initial = {
    goal: "让瓦罗暂时相信我的自述身份",
    method: "清楚说明来由",
    utterance: "我对瓦罗说：我是剑湾法庭的一名猎魔人。",
    desiredResponse: JSON.stringify(intent),
    npcResponse: JSON.stringify({
      schema: "zhuwei.npc-response-draft/v1",
      mode: "reaction",
      reaction: "acknowledge",
    }),
    basisRefs: [npcRef],
    resolution: "direct",
    durationUnit: "minute",
    durationValue: 1,
  };
  const repaired = {
    ...initial,
    desiredResponse: JSON.stringify({ ...intent, evidenceRefs: [] }),
  };
  const socialContext = contextPack();
  socialContext.required.trustedControl = {
    characterRef: actorRef,
    controllerRef: actorRef,
  };
  socialContext.required.npcViews = [{ npcRef, knowledgeRefs: [] }];
  const adapter = createAuthoritativeKpAdapter({
    profile: PROFILE,
    prepareV3Context: async (_request, allowedForms) => ({
      contextPack: socialContext,
      orderedFormIds: allowedForms,
    }),
    ai: {
      async run(_model, input) {
        calls.push(input);
        return calls.length === 1
          ? toolResponse({ formId: "npc-exchange.v1", draft: initial }, 1)
          : toolResponse({ formId: "npc-exchange.v1", draft: repaired }, 2);
      },
    },
  });

  const result = await adapter.propose({
    ...request(initial.utterance),
    input: {
      kind: "intent",
      submissionId: "submission:private-form",
      characterId: actorRef,
      text: initial.utterance,
    },
  });
  assert.equal(result.repairUsed, true);
  assert.deepEqual(JSON.parse(result.draft.desiredResponse).evidenceRefs, []);
  assert.notEqual(result.finalSemanticHash, result.semanticFreezeHash);
  assert.equal(calls.length, 2);
});

test("an invalid or missing initial Form selection fails without an implicit compound repair", async () => {
  for (const candidate of [
    { formId: "invented-object-family.v1", draft: ordinaryDraft() },
    { draft: ordinaryDraft() },
  ]) {
    const calls = [];
    const adapter = adapterWithResponses([toolResponse(candidate)], calls);
    await assert.rejects(adapter.propose(request()), (error) => {
      assert.ok(error instanceof AuthoritativeKpModelError);
      assert.equal(error.publicCode, "PROPOSAL_FORM_INVALID");
      return true;
    });
    assert.equal(calls.length, 1);
  }
});

test("typed finite references repair an invented combat ability without resending full context", async () => {
  const calls = [];
  const base = {
    goal: "压制门边的敌人",
    method: "用手中的弓进行压制射击",
    intendedOutcome: "迫使敌人离开门边",
    combatApproach: "远程压制",
  };
  const adapter = adapterWithResponses([
    toolResponse({
      formId: "combat-action.v1",
      draft: { ...base, abilityRef: "ability:invented:orbital-cannon" },
    }, 1),
    toolResponse({
      formId: "combat-action.v1",
      draft: { ...base, abilityRef: ABILITY_REF },
    }, 2),
  ], calls);

  const result = await adapter.propose(request("我攻击门边的敌人，用手中的弓压制他。"));
  assert.equal(result.formId, "combat-action.v1");
  assert.equal(result.draft.abilityRef, ABILITY_REF);
  assert.equal(result.repairUsed, true);
  assert.equal(calls.length, 2);

  const repairPayload = JSON.parse(calls[1].messages[1].content);
  assert.deepEqual(repairPayload.finiteReferences.abilityRefs, [ABILITY_REF]);
  assert.ok(repairPayload.finiteReferences.basisRefs.includes(FACT_REF));
  assert.deepEqual(repairPayload.finiteReferences.resourceRefs, ["resolve"]);
  assert.deepEqual(repairPayload.finiteReferences.itemRefs, []);
  assert.equal(JSON.stringify(repairPayload).includes("invented-object-family"), false);
});

test("a Rules repair is refused before another model call when the frozen scope/Profile binding changes", async () => {
  const calls = [];
  const adapter = adapterWithResponses([
    toolResponse({ formId: "ordinary-check.v1", draft: ordinaryDraft() }, 1),
  ], calls);
  const firstRequest = {
    ...request(),
    projection: {
      kind: "test-projection",
      stateVersion: "7",
      activeBranchId: "branch:main",
      projectionHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      runtimeProfiles: { ruleset: { profileId: "rules:test", profileHash: "sha256:test" } },
      moduleRef: { profileId: "module:test", profileHash: "sha256:module" },
    },
  };
  const priorProposal = await adapter.propose(firstRequest);
  assert.equal(priorProposal.repairUsed, false);

  await assert.rejects(adapter.propose({
    ...firstRequest,
    attempt: 2,
    diagnostics: [{ code: "PROPOSAL_RULES_DIAGNOSTIC" }],
    priorProposal,
    projection: { ...firstRequest.projection, stateVersion: "8" },
  }), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.publicCode, "PROPOSAL_REPAIR_EXHAUSTED");
    return true;
  });
  assert.equal(calls.length, 1);
});

test("an explicit too-narrow diagnostic can upgrade an ordinary Form to compound without changing intent", async () => {
  const calls = [];
  const original = ordinaryDraft();
  const compound = {
    goal: original.goal,
    method: original.method,
    intendedOutcome: original.intendedOutcome,
    stages: [
      {
        goal: "先验证边缘的承重点",
        method: original.method,
        intendedOutcome: "找出可承重的落脚点",
        resolution: "check",
        ability: "wis",
        skill: "investigation",
        dc: 13,
        mode: "normal",
        successConsequence: "确认落脚点。",
        failureConsequence: "石块先行松脱。",
        basisRefs: [FACT_REF],
      },
      {
        goal: "沿已确认的位置通过",
        method: "只把重量压在已确认的落脚点上",
        intendedOutcome: original.intendedOutcome,
        resolution: "direct",
        basisRefs: [FACT_REF],
      },
    ],
    composition: {
      schema: "zhuwei.compound-composition-draft/v1",
      before: [],
      onSuccess: [],
      onFailure: [],
    },
    resolution: "direct",
    durationUnit: "minute",
    durationValue: 1,
    basisRefs: [FACT_REF],
  };
  const adapter = adapterWithResponses([
    toolResponse({ formId: "ordinary-check.v1", draft: original }, 1),
    toolResponse({ formId: "compound.v1", draft: compound }, 2),
  ], calls);
  const initialRequest = request();
  const priorProposal = await adapter.propose(initialRequest);
  const upgraded = await adapter.propose({
    ...initialRequest,
    attempt: 2,
    diagnostics: [{ code: "FORM_TOO_NARROW", path: "causal-program" }],
    priorProposal,
  });

  assert.equal(upgraded.formId, "compound.v1");
  assert.equal(upgraded.repairUsed, true);
  assert.equal(upgraded.semanticFreezeHash, priorProposal.semanticFreezeHash);
  assert.equal(upgraded.draft.goal, original.goal);
  assert.equal(upgraded.draft.method, original.method);
  assert.equal(upgraded.draft.intendedOutcome, original.intendedOutcome);
  const repairPayload = JSON.parse(calls[1].messages[1].content);
  assert.equal(repairPayload.originalForm, "ordinary-check.v1");
  assert.equal(repairPayload.selectedForm, "compound.v1");
  assert.equal(calls.length, 2);
});

// Test level: T1 — exercises the deterministic repair provenance boundary.
test("an unreadable first draft fails closed instead of accepting repaired semantics", async () => {
  const calls = [];
  // The real trigger: the first tool call's arguments do not parse, so no
  // draft is frozen. The in-attempt schema repair then writes semantics the
  // server has nothing to check against, which is `semantic-freeze:*:unproven`.
  const malformed = toolResponse({ formId: "ordinary-check.v1", draft: {} }, 1);
  malformed.choices[0].message.tool_calls[0].function.arguments = "{\"goal\": \"确认阳台";

  const adapter = adapterWithResponses([
    malformed,
    toolResponse({ formId: "ordinary-check.v1", draft: ordinaryDraft() }, 2),
  ], calls);

  await assert.rejects(adapter.propose(request()), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.publicCode, "PROPOSAL_REPAIR_EXHAUSTED");
    return true;
  });
  // Repair still consumes at most the two invocations SPEC 0015 §6.1 allows.
  assert.equal(calls.length, 2);
});

test("a repair that overwrites frozen intent stays terminal instead of becoming a question", async () => {
  const calls = [];
  const adapter = adapterWithResponses([
    toolResponse({ formId: "ordinary-check.v1", draft: ordinaryDraft() }, 1),
    toolResponse({
      formId: "ordinary-check.v1",
      draft: ordinaryDraft({ goal: "改成完全不同的目标" }),
    }, 2),
  ], calls);

  const first = await adapter.propose(request());
  await assert.rejects(
    adapter.propose({
      ...request(),
      attempt: 2,
      diagnostics: { errors: ["dc:type-invalid"] },
      priorProposal: first,
    }),
    (error) => error instanceof AuthoritativeKpModelError,
    "a changed semantic is the violation the freeze exists for",
  );
  assert.equal(calls.length, 2);
});
