import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTEXT_PLANNER_POLICY_HASH,
  CONTEXT_PLANNER_ROLE_VALIDATION_SUITE_VERSION,
  CONTEXT_PLANNER_SCHEMA_HASH,
  CONTEXT_PLANNER_TOOL_NAME,
  ContextPlannerPolicyError,
  classifyContextPlannerProviderError,
  contextPlannerModelRequest,
  parseContextPlannerModelResponse,
} from "../app/_runtime/lib/kp/context-planner-policy.ts";
import {
  CONTEXT_PLANNER_VALIDATION_GATES,
  DEEPSEEK_V4_FLASH_CONTEXT_PLANNER_CANDIDATE,
  createContextPlannerRoleValidationEvidence,
  createModelPlannerAdapter,
  createModelProfileRegistry,
  productionSelectableProfilesForRole,
  runContextPlanner,
  validatedProfilesForRole,
} from "../app/_runtime/lib/kp/model-registry.ts";
import {
  CONTEXT_PLANNER_LIVE_VALIDATION_CASES,
  runContextPlannerRoleValidation,
} from "../tools/run-context-planner-role-validation.mjs";

const ALLOWED_FORMS = Object.freeze([
  "observe.v1",
  "ordinary-check.v1",
  "materialization.v1",
  "compound.v1",
]);

test("Planner policy sends only a closed Form allowlist and static query surface", () => {
  const request = contextPlannerModelRequest({
    allowedFormIds: ALLOWED_FORMS,
    structuralRefs: ["scene:钟楼", "rule:object-damage"],
    baseQueryTerms: ["钟架痕迹", "对象耐久"],
  });
  assert.match(CONTEXT_PLANNER_POLICY_HASH, /^fnv1a64:/u);
  assert.match(CONTEXT_PLANNER_SCHEMA_HASH, /^fnv1a64:/u);
  assert.deepEqual(Object.keys(request).sort(), ["modelInput", "policyVersion", "schemaVersion"]);
  assert.deepEqual(Object.keys(request.modelInput).sort(), [
    "max_completion_tokens",
    "messages",
    "parallel_tool_calls",
    "temperature",
    "tool_choice",
    "tools",
  ]);
  assert.equal(request.modelInput.tools.length, 1);
  assert.equal(request.modelInput.tools[0].function.name, CONTEXT_PLANNER_TOOL_NAME);
  const schema = request.modelInput.tools[0].function.parameters;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties).sort(), ["orderedFormIds", "queryTerms"]);
  assert.deepEqual(schema.properties.orderedFormIds.items.enum, ALLOWED_FORMS);
  assert.equal(schema.properties.orderedFormIds.minItems, ALLOWED_FORMS.length);
  assert.equal(schema.properties.orderedFormIds.maxItems, ALLOWED_FORMS.length);
  const serialized = JSON.stringify(request);
  for (const forbidden of [
    "rootActionRef", "playerIntent", "worldState", "audience", "dice", "events", "statePatch",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.match(serialized, /Form allowlist/u);
  assert.match(serialized, /静态规则或模组语料/u);
});

test("Planner response accepts one exact tool call and rejects every authority expansion", () => {
  const valid = plannerToolResponse({
    orderedFormIds: [...ALLOWED_FORMS].reverse(),
    queryTerms: ["钟架", "对象耐久"],
  });
  assert.deepEqual(parseContextPlannerModelResponse(valid, ALLOWED_FORMS), {
    orderedFormIds: [...ALLOWED_FORMS].reverse(),
    queryTerms: ["钟架", "对象耐久"],
  });
  for (const invalid of [
    { choices: [{ message: { content: JSON.stringify(valid) } }] },
    plannerToolResponse({ orderedFormIds: ALLOWED_FORMS.slice(0, -1), queryTerms: [] }),
    plannerToolResponse({ orderedFormIds: ALLOWED_FORMS, queryTerms: [], dc: 18 }),
    plannerToolResponse({ orderedFormIds: ALLOWED_FORMS, queryTerms: [], npcDialogue: "答应他" }),
    plannerToolResponse({
      orderedFormIds: ALLOWED_FORMS,
      queryTerms: ["ZHUWEI_SECRET_CANARY_ROLE_SUITE_7F31"],
    }),
    { tool_calls: [
      toolCall({ orderedFormIds: ALLOWED_FORMS, queryTerms: [] }),
      toolCall({ orderedFormIds: ALLOWED_FORMS, queryTerms: [] }),
    ] },
  ]) {
    assert.throws(
      () => parseContextPlannerModelResponse(invalid, ALLOWED_FORMS),
      /CONTEXT_PLANNER_OUTPUT_INVALID/u,
    );
  }
});

test("registry requires bound role evidence and never exposes pending or offline-only Planners", () => {
  const pendingRegistry = createModelProfileRegistry([
    primaryProfile(),
    DEEPSEEK_V4_FLASH_CONTEXT_PLANNER_CANDIDATE,
  ]);
  assert.deepEqual(validatedProfilesForRole(pendingRegistry, "context-planner"), []);
  assert.deepEqual(productionSelectableProfilesForRole(pendingRegistry, "context-planner"), []);

  const missingEvidence = plannerProfile("test-planner", "passed");
  assert.throws(
    () => createModelProfileRegistry([primaryProfile(), missingEvidence]),
    /VALIDATION_EVIDENCE_REQUIRED/u,
  );

  const offline = withEvidence(plannerProfile("offline-planner", "passed"), "offline-fixture");
  const offlineRegistry = createModelProfileRegistry([primaryProfile(), offline]);
  assert.deepEqual(
    validatedProfilesForRole(offlineRegistry, "context-planner").map((profile) => profile.profileRef),
    [offline.profileRef],
  );
  assert.deepEqual(productionSelectableProfilesForRole(offlineRegistry, "context-planner"), []);

  const live = withEvidence({
    ...plannerProfile("deepseek", "passed"),
    profileRef: "planner:live",
  }, "live-provider");
  const liveRegistry = createModelProfileRegistry([primaryProfile(), live]);
  assert.deepEqual(
    productionSelectableProfilesForRole(liveRegistry, "context-planner")
      .map((profile) => profile.profileRef),
    ["planner:live"],
  );
  assert.match(liveRegistry.profiles["planner:live"].profileHash, /^fnv1a64:/u);

  const tampered = {
    ...live,
    roleValidation: { ...live.roleValidation, liveProviderCalls: 4 },
  };
  assert.throws(
    () => createModelProfileRegistry([primaryProfile(), tampered]),
    /VALIDATION_EVIDENCE_INVALID/u,
  );
});

test("strict model Adapter classifies invalid output and timeout, then deterministically preserves the pinned KP", async () => {
  const planner = withEvidence(plannerProfile("offline-planner", "passed"), "offline-fixture");
  const registry = createModelProfileRegistry([primaryProfile(), planner]);
  const plannerInput = {
    rootActionRef: "root:planner:001",
    allowedFormIds: ALLOWED_FORMS,
    structuralRefs: ["scene:钟楼"],
    baseQueryTerms: ["观察钟架"],
  };
  const model = createModelPlannerAdapter({
    registry,
    profileRef: planner.profileRef,
    invoke(request, profile, { signal }) {
      assert.equal(profile.profileRef, planner.profileRef);
      assert.equal(signal.aborted, false);
      assert.equal(JSON.stringify(request).includes(plannerInput.rootActionRef), false);
      return plannerToolResponse({
        orderedFormIds: [...ALLOWED_FORMS].reverse(),
        queryTerms: ["钟架", "痕迹"],
      });
    },
  });
  const success = await runContextPlanner({
    registry,
    pinnedPrimaryKpProfileRef: "kp:primary",
    adapter: model,
    plannerInput,
  });
  assert.equal(success.receipt.status, "suggested");
  assert.equal(success.pinnedPrimaryKpProfileRef, "kp:primary");

  const invalid = createModelPlannerAdapter({
    registry,
    profileRef: planner.profileRef,
    invoke: () => plannerToolResponse({
      orderedFormIds: ALLOWED_FORMS,
      queryTerms: [],
      damage: "8d10",
    }),
  });
  const invalidResult = await runContextPlanner({
    registry,
    pinnedPrimaryKpProfileRef: "kp:primary",
    adapter: invalid,
    plannerInput,
  });
  assert.equal(invalidResult.receipt.failureCode, "PLANNER_OUTPUT_INVALID");
  assert.equal(invalidResult.receipt.fallbackUsed, true);
  assert.equal(invalidResult.pinnedPrimaryKpProfileRef, "kp:primary");

  const timedOut = createModelPlannerAdapter({
    registry,
    profileRef: planner.profileRef,
    timeoutMs: 5,
    invoke: () => new Promise(() => {}),
  });
  const timeoutResult = await runContextPlanner({
    registry,
    pinnedPrimaryKpProfileRef: "kp:primary",
    adapter: timedOut,
    plannerInput,
  });
  assert.equal(timeoutResult.receipt.failureCode, "PLANNER_TIMEOUT");
  assert.equal(timeoutResult.receipt.fallbackUsed, true);
  assert.equal(timeoutResult.pinnedPrimaryKpProfileRef, "kp:primary");
  assert.deepEqual(new Set(timeoutResult.suggestion.orderedFormIds), new Set(ALLOWED_FORMS));
});

test("bounded role suite covers Chinese, allowlist, secret canary, latency, errors and safe fault fallback", async () => {
  let clock = 0;
  const profile = plannerProfile("test-provider", "pending");
  const report = await runContextPlannerRoleValidation({
    profile,
    executionMode: "offline-fixture",
    validatedAt: "2026-08-29T00:00:00.000Z",
    now: () => {
      clock += 5;
      return clock;
    },
    invoke(request) {
      const schema = request.modelInput.tools[0].function.parameters;
      return plannerToolResponse({
        orderedFormIds: [...schema.properties.orderedFormIds.items.enum].reverse(),
        queryTerms: ["静态检索"],
      });
    },
  });
  assert.equal(report.callBudget, 5);
  assert.equal(report.liveProviderCalls, 0);
  assert.equal(report.status, "passed");
  assert.equal(report.cases.length, CONTEXT_PLANNER_LIVE_VALIDATION_CASES.length);
  assert.ok(CONTEXT_PLANNER_VALIDATION_GATES.every((gate) => report.gates[gate]));
  assert.equal(report.fallbackInvariant.pass, true);
  assert.ok(report.cases.every((entry) => entry.passed && entry.failureCode === null));
  assert.equal(JSON.stringify(report).includes("ZHUWEI_SECRET_CANARY_ROLE_SUITE_7F31"), false);
  assert.equal(report.evidence.executionMode, "offline-fixture");
});

test("Planner error classification is stable and never copies provider details", () => {
  assert.equal(
    classifyContextPlannerProviderError(new ContextPlannerPolicyError("CONTEXT_PLANNER_TIMEOUT")),
    "timeout",
  );
  assert.equal(classifyContextPlannerProviderError({ status: 429, body: "secret" }), "transient");
  assert.equal(classifyContextPlannerProviderError({ status: 503, body: "secret" }), "transient");
  assert.equal(classifyContextPlannerProviderError({ status: 422, body: "secret" }), "permanent");
});

function primaryProfile() {
  return {
    profileRef: "kp:primary",
    provider: "test-primary",
    modelId: "primary",
    modelRevision: "v1",
    supportedRoles: ["primary-kp"],
    validationSuiteVersion: "primary-v1",
    validationStatus: "passed",
    structuredOutputMode: "strict-tool",
    contextWindowTokens: 128_000,
    latencyTier: "local",
    costTier: "free",
  };
}

function plannerProfile(provider, validationStatus) {
  return {
    profileRef: `planner:${provider}`,
    provider,
    modelId: "planner",
    modelRevision: "v1",
    supportedRoles: ["context-planner"],
    validationSuiteVersion: CONTEXT_PLANNER_ROLE_VALIDATION_SUITE_VERSION,
    validationStatus,
    structuredOutputMode: "strict-tool",
    contextWindowTokens: 32_000,
    latencyTier: "low",
    costTier: "low",
  };
}

function withEvidence(profile, executionMode) {
  return {
    ...profile,
    roleValidation: createContextPlannerRoleValidationEvidence({
      profile,
      executionMode,
      validatedAt: "2026-08-29T00:00:00.000Z",
      caseCount: 5,
      liveProviderCalls: executionMode === "live-provider" ? 5 : 0,
      latencyMs: { p50: 100, p95: 200, budget: 8_000 },
      gates: Object.fromEntries(CONTEXT_PLANNER_VALIDATION_GATES.map((gate) => [gate, true])),
    }),
  };
}

function toolCall(argumentsValue) {
  return {
    type: "function",
    function: {
      name: CONTEXT_PLANNER_TOOL_NAME,
      arguments: JSON.stringify(argumentsValue),
    },
  };
}

function plannerToolResponse(argumentsValue) {
  return { choices: [{ message: { tool_calls: [toolCall(argumentsValue)] } }] };
}
