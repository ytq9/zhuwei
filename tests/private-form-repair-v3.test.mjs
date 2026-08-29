import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthoritativeKpModelError,
  createAuthoritativeKpAdapter,
} from "../app/_runtime/lib/kp/authoritative.ts";
import { V3_AUTHORITATIVE_KP_PROFILES } from "../app/_runtime/lib/kp/authoritative-policy.ts";
import { PRIVATE_FORM_PROPOSAL_TOOL_NAME } from "../app/_runtime/lib/kp/private-form-policy.ts";

const PROFILE = V3_AUTHORITATIVE_KP_PROFILES[0];
const ABILITY_REF = "ability:alice:test-bow";
const FACT_REF = "fact:scene:loose-balcony";

function toolResponse(value, index = 1) {
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
            name: PRIVATE_FORM_PROPOSAL_TOOL_NAME,
            arguments: JSON.stringify(value),
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
  assert.deepEqual(repairPayload.finiteReferences.artifactRefs, []);
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
