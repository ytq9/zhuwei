import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthoritativeKpModelError,
  createAuthoritativeKpAdapter,
} from "../app/_runtime/lib/kp/authoritative.ts";
import {
  AUTHORITATIVE_KP_PROFILE,
} from "../app/_runtime/lib/kp/authoritative-policy.ts";
import {
  KP_FORM_IDS,
  buildKpFormToolParameters,
  kpFormIdForToolName,
  kpFormToolName,
} from "../app/_runtime/lib/kp/form-catalog.ts";
const PROFILE = AUTHORITATIVE_KP_PROFILE;

function response(toolName, argumentsValue, index = 1) {
  return {
    choices: [{
      index: 0,
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: `call:narrow-private-form:${index}`,
          type: "function",
          function: {
            name: toolName,
            arguments: typeof argumentsValue === "string"
              ? argumentsValue
              : JSON.stringify(argumentsValue),
          },
        }],
      },
    }],
    usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 },
  };
}

function multipleToolResponse(calls) {
  return {
    choices: [{
      message: {
        tool_calls: calls.map(({ formId, draft }, index) => ({
          id: `call:multiple:${index}`,
          type: "function",
          function: {
            name: kpFormToolName(formId),
            arguments: JSON.stringify(draft),
          },
        })),
      },
    }],
  };
}

function request(text = "我谨慎绕过石门旁的松动机关。") {
  return {
    preparedActionId: "prepared:narrow-private-form",
    rootActionId: "root:narrow-private-form",
    attempt: 1,
    input: {
      kind: "intent",
      submissionId: "submission:narrow-private-form",
      text,
    },
    projection: { kind: "test-projection" },
  };
}

function contextPack() {
  return {
    required: {
      intent: {
        submissionRef: "submission:narrow-private-form",
        text: "玩家自由输入",
      },
      mechanics: { resources: {} },
      established: { factRefs: [], precedentRefs: [], dynamicDefinitionRefs: [] },
      bindings: {
        rulesRef: "rules:test",
        geometryRef: "geometry:test",
        moduleRef: "module:test",
        eventRef: "events:test",
      },
    },
    retrieved: { chunks: [] },
    optional: { items: [] },
  };
}

function ordinaryDraft(overrides = {}) {
  return {
    goal: "安全通过石门",
    method: "先检查松动机关再缓慢通过",
    intendedOutcome: "不触发机关地抵达门后",
    risk: "机关可能发出声响",
    resolution: "check",
    ability: "wis",
    skill: "investigation",
    dc: 13,
    mode: "normal",
    durationUnit: "minute",
    durationValue: 1,
    successConsequence: "角色识别并避开机关。",
    failureConsequence: "机关发出声响并暴露角色位置。",
    ...overrides,
  };
}

function observeDraft(overrides = {}) {
  return {
    goal: "确认石门机关的状态",
    method: "观察磨损、灰尘与连接杆",
    focus: "石门旁的松动机关",
    desiredInformation: "机关是否仍能触发",
    resolution: "direct",
    durationUnit: "minute",
    durationValue: 1,
    ...overrides,
  };
}

function compoundDraft() {
  const ordinary = ordinaryDraft();
  return {
    goal: ordinary.goal,
    method: ordinary.method,
    intendedOutcome: ordinary.intendedOutcome,
    stages: [{
      goal: ordinary.goal,
      method: ordinary.method,
      intendedOutcome: ordinary.intendedOutcome,
      resolution: "check",
      ability: "wis",
      skill: "investigation",
      dc: 13,
      mode: "normal",
      successConsequence: ordinary.successConsequence,
      failureConsequence: ordinary.failureConsequence,
    }],
    resolution: "direct",
    durationUnit: "minute",
    durationValue: 1,
  };
}

function adapterWithResponses(responses, calls, profile = PROFILE) {
  return createAuthoritativeKpAdapter({
    profile,
    prepareV3Context: async (_request, allowedForms) => ({
      contextPack: contextPack(),
      orderedFormIds: allowedForms,
    }),
    ai: {
      async run(_model, input) {
        calls.push(input);
        const next = responses.shift();
        if (next === undefined) throw new Error("unexpected model call");
        return next;
      },
    },
  });
}

function recursiveKeys(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => recursiveKeys(entry, output));
    return output;
  }
  if (value === null || typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value)) {
    output.push(key);
    recursiveKeys(child, output);
  }
  return output;
}

test("narrow profile exposes one direct-argument tool per allowed Form with a bijective name map", async () => {
  const names = KP_FORM_IDS.map(kpFormToolName);
  assert.equal(new Set(names).size, KP_FORM_IDS.length);
  for (const formId of KP_FORM_IDS) {
    assert.equal(kpFormIdForToolName(kpFormToolName(formId)), formId);
    const parameters = buildKpFormToolParameters(formId);
    const keys = recursiveKeys(parameters);
    assert.equal(keys.includes("oneOf"), false, formId);
    assert.equal(keys.includes("formId"), false, formId);
    assert.equal(keys.includes("draft"), false, formId);
  }
  assert.equal(kpFormIdForToolName("submit_kp_invented_v1"), undefined);

  const calls = [];
  const adapter = adapterWithResponses([
    response(kpFormToolName("ordinary-check.v1"), ordinaryDraft()),
  ], calls);
  await adapter.propose(request());
  const input = calls[0];
  const payload = JSON.parse(input.messages[1].content);
  assert.equal(input.tools.length, payload.allowedForms.length);
  assert.deepEqual(
    input.tools.map((tool) => kpFormIdForToolName(tool.function.name)),
    payload.allowedForms.map(({ id }) => id),
  );
  for (const tool of input.tools) {
    const keys = recursiveKeys(tool.function.parameters);
    assert.equal(keys.includes("oneOf"), false);
    assert.equal(keys.includes("formId"), false);
    assert.equal(keys.includes("draft"), false);
  }
  assert.equal(input.parallel_tool_calls, false);
  assert.equal(input.tool_choice, "required");
  assert.doesNotMatch(input.messages[0].content, /submit_private_kp_form/u);
});

test("different allowed tool names deterministically recover and compile their existing Forms", async () => {
  for (const [formId, draft, text] of [
    ["ordinary-check.v1", ordinaryDraft(), "我谨慎通过石门。"],
    ["observe.v1", observeDraft(), "我检查石门旁的机关。"],
  ]) {
    const calls = [];
    const adapter = adapterWithResponses([
      response(kpFormToolName(formId), draft),
    ], calls);
    const result = await adapter.propose(request(text));
    assert.equal(result.formId, formId);
    assert.deepEqual(result.draft, draft);
    assert.equal(result.causalActionProgram.formRef, formId);
    assert.equal(result.repairUsed, false);
    assert.equal(calls.length, 1);
  }
});

test("missing and unknown fields enter one same-tool repair and preserve parsed semantics", async () => {
  for (const invalid of [
    (() => {
      const value = ordinaryDraft();
      delete value.durationValue;
      return value;
    })(),
    ordinaryDraft({ unexpected: "must be rejected" }),
  ]) {
    const calls = [];
    const adapter = adapterWithResponses([
      response(kpFormToolName("ordinary-check.v1"), invalid, 1),
      response(kpFormToolName("ordinary-check.v1"), ordinaryDraft(), 2),
    ], calls);
    const result = await adapter.propose(request());
    assert.equal(result.formId, "ordinary-check.v1");
    assert.equal(result.repairUsed, true);
    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls[1].tools.map((tool) => tool.function.name),
      [kpFormToolName("ordinary-check.v1")],
    );
    const repairPayload = JSON.parse(calls[1].messages[1].content);
    assert.deepEqual(repairPayload.rejectedDraft, invalid);
    assert.equal(repairPayload.selectedForm, "ordinary-check.v1");
    assert.ok(repairPayload.errors.length > 0);
  }
});

test("unparseable arguments can repair syntax only when raw values prove every semantic field", async () => {
  const draft = ordinaryDraft();
  const rawArguments = JSON.stringify(draft).slice(0, -1);
  const calls = [];
  const adapter = adapterWithResponses([
    response(kpFormToolName("ordinary-check.v1"), rawArguments, 1),
    response(kpFormToolName("ordinary-check.v1"), draft, 2),
  ], calls);
  const result = await adapter.propose(request());
  assert.equal(result.formId, "ordinary-check.v1");
  assert.equal(result.repairUsed, true);
  assert.deepEqual(result.draft, draft);
  const repairPayload = JSON.parse(calls[1].messages[1].content);
  assert.deepEqual(repairPayload.rejectedDraft, {});
  assert.equal(repairPayload.rejectedRawArguments.kind, "unparseableJson");
  assert.equal(repairPayload.rejectedRawArguments.truncated, false);
  assert.equal(repairPayload.rejectedRawArguments.value, rawArguments);
  assert.ok(repairPayload.errors.includes("draft:json-parse-failed"));
  assert.equal("contextPack" in repairPayload, false);
});

test("nested raw members cannot prove repaired top-level semantics", async () => {
  const draft = ordinaryDraft();
  const nestedRawArguments = `{"junk":${JSON.stringify(draft)}`;
  const calls = [];
  const adapter = adapterWithResponses([
    response(kpFormToolName("ordinary-check.v1"), nestedRawArguments, 1),
    response(kpFormToolName("ordinary-check.v1"), draft, 2),
  ], calls);
  await assert.rejects(adapter.propose(request()), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.publicCode, "PROPOSAL_REPAIR_EXHAUSTED");
    return true;
  });
  assert.equal(calls.length, 2);
});

test("duplicate raw members cannot prove frozen semantics even when values match", async () => {
  const draft = ordinaryDraft();
  const goalMember = `"goal":${JSON.stringify(draft.goal)}`;
  const duplicateRawArguments = JSON.stringify(draft)
    .replace(goalMember, `${goalMember},${goalMember}`)
    .slice(0, -1);
  const calls = [];
  const adapter = adapterWithResponses([
    response(kpFormToolName("ordinary-check.v1"), duplicateRawArguments, 1),
    response(kpFormToolName("ordinary-check.v1"), draft, 2),
  ], calls);
  await assert.rejects(adapter.propose(request()), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.publicCode, "PROPOSAL_REPAIR_EXHAUSTED");
    return true;
  });
  assert.equal(calls.length, 2);
});

test("unproven malformed or missing semantics cannot become a fresh proposal during repair", async () => {
  const malformedGoal = `{"goal":"${"甲".repeat(5_000)}`;
  const malformedCalls = [];
  const malformed = adapterWithResponses([
    response(kpFormToolName("ordinary-check.v1"), malformedGoal, 1),
    response(kpFormToolName("ordinary-check.v1"), ordinaryDraft(), 2),
  ], malformedCalls);
  await assert.rejects(malformed.propose(request()), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.publicCode, "PROPOSAL_REPAIR_EXHAUSTED");
    return true;
  });
  assert.equal(malformedCalls.length, 2);
  const malformedPayload = JSON.parse(malformedCalls[1].messages[1].content);
  assert.equal(malformedPayload.rejectedRawArguments.truncated, true);
  assert.equal(malformedPayload.rejectedRawArguments.value.length, 4_000);

  const missingGoal = ordinaryDraft();
  delete missingGoal.goal;
  const missingCalls = [];
  const missing = adapterWithResponses([
    response(kpFormToolName("ordinary-check.v1"), missingGoal, 1),
    response(kpFormToolName("ordinary-check.v1"), ordinaryDraft(), 2),
  ], missingCalls);
  await assert.rejects(missing.propose(request()), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.publicCode, "PROPOSAL_REPAIR_EXHAUSTED");
    return true;
  });
  assert.equal(missingCalls.length, 2);
});

test("a second invalid draft exhausts repair without a third invocation", async () => {
  const invalid = ordinaryDraft();
  delete invalid.durationValue;
  const calls = [];
  const adapter = adapterWithResponses([
    response(kpFormToolName("ordinary-check.v1"), invalid, 1),
    response(kpFormToolName("ordinary-check.v1"), invalid, 2),
  ], calls);
  await assert.rejects(adapter.propose(request()), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.publicCode, "PROPOSAL_REPAIR_EXHAUSTED");
    return true;
  });
  assert.equal(calls.length, 2);
});

test("unallowed tools, parallel calls, and changing tools during repair fail closed", async () => {
  for (const invalidResponse of [
    response("submit_kp_invented_v1", ordinaryDraft()),
    multipleToolResponse([
      { formId: "ordinary-check.v1", draft: ordinaryDraft() },
      { formId: "observe.v1", draft: observeDraft() },
    ]),
  ]) {
    const calls = [];
    const adapter = adapterWithResponses([invalidResponse], calls);
    await assert.rejects(adapter.propose(request()), (error) => {
      assert.ok(error instanceof AuthoritativeKpModelError);
      assert.equal(error.publicCode, "PROPOSAL_FORM_INVALID");
      return true;
    });
    assert.equal(calls.length, 1);
  }

  const initial = ordinaryDraft();
  delete initial.durationValue;
  const switchedCalls = [];
  const switched = adapterWithResponses([
    response(kpFormToolName("ordinary-check.v1"), initial, 1),
    response(kpFormToolName("observe.v1"), observeDraft(), 2),
  ], switchedCalls);
  await assert.rejects(switched.propose(request()), (error) => {
    assert.ok(error instanceof AuthoritativeKpModelError);
    assert.equal(error.publicCode, "PROPOSAL_REPAIR_EXHAUSTED");
    return true;
  });
  assert.equal(switchedCalls.length, 2);
});

test("attempt two keeps the existing server-authorized ordinary to compound upgrade", async () => {
  const calls = [];
  const adapter = adapterWithResponses([
    response(kpFormToolName("ordinary-check.v1"), ordinaryDraft(), 1),
    response(kpFormToolName("compound.v1"), compoundDraft(), 2),
  ], calls);
  const initialRequest = request();
  const priorProposal = await adapter.propose(initialRequest);
  const repaired = await adapter.propose({
    ...initialRequest,
    attempt: 2,
    diagnostics: [{ code: "FORM_TOO_NARROW", path: "causal-program" }],
    priorProposal,
  });
  assert.equal(repaired.formId, "compound.v1");
  assert.equal(repaired.repairUsed, true);
  assert.deepEqual(
    calls[1].tools.map((tool) => tool.function.name),
    [kpFormToolName("compound.v1")],
  );
});
