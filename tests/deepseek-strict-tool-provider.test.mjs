import assert from "node:assert/strict";
import test from "node:test";

import { stableStructuralHash } from "../app/_runtime/lib/kp/causal-action-program.ts";
import {
  DeepSeekStrictToolConfigurationError,
  createDeepSeekStrictToolBinding,
} from "../app/_runtime/lib/kp/deepseek.ts";
import {
  DEEPSEEK_STRICT_TOOL_BETA_ENDPOINT,
  DEEPSEEK_STRICT_TOOL_ENDPOINT_PROTOCOL,
  DEEPSEEK_STRICT_TOOL_SCHEMA_DIALECT,
  assertDeepSeekStrictToolSchema,
  deepSeekStrictToolSchemaIssues,
} from "../app/_runtime/lib/kp/deepseek-strict-tool.ts";
import { classifyModelError } from "../app/_runtime/lib/kp/authoritative-helpers.ts";
import {
  createModelProfileRegistry,
  createStrictToolProviderValidationEvidence,
} from "../app/_runtime/lib/kp/model-registry.ts";
import {
  createDeepSeekInvalidSchemaProbe,
  runDeepSeekStrictToolHandshake,
} from "../tools/run-deepseek-strict-tool-handshake.mjs";

const STRICT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    bundleKind: Object.freeze({
      type: "string",
      enum: Object.freeze(["proposal-bundle"]),
    }),
    operations: Object.freeze({
      type: "array",
      items: Object.freeze({ $ref: "#/$def/operation" }),
    }),
  }),
  required: Object.freeze(["bundleKind", "operations"]),
  additionalProperties: false,
  $def: Object.freeze({
    operation: Object.freeze({
      type: "object",
      properties: Object.freeze({
        kind: Object.freeze({
          type: "string",
          enum: Object.freeze(["materialization", "world-interaction"]),
        }),
        ref: Object.freeze({ type: "string" }),
      }),
      required: Object.freeze(["kind", "ref"]),
      additionalProperties: false,
    }),
  }),
});

const CORRECTION_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({ summary: Object.freeze({ type: "string" }) }),
  required: Object.freeze(["summary"]),
  additionalProperties: false,
});

function strictModelInput(schema = STRICT_SCHEMA) {
  return {
    messages: [{ role: "user", content: "裁定开放式世界互动" }],
    tools: [{
      type: "function",
      function: {
        name: "submit_proposal_bundle",
        description: "提交一份候选提案束。",
        strict: true,
        parameters: schema,
      },
    }],
    tool_choice: "required",
    parallel_tool_calls: false,
    max_completion_tokens: 1_200,
  };
}

function strictCorrectionModelInput() {
  const input = strictModelInput(CORRECTION_SCHEMA);
  return {
    ...input,
    messages: [{ role: "user", content: "只修正摘要" }],
    tools: [{
      ...input.tools[0],
      function: { ...input.tools[0].function, name: "correct_proposal_bundle" },
    }],
  };
}

function strictProfile(overrides = {}) {
  return {
    profileRef: "kp:deepseek-vnext-strict",
    provider: "deepseek",
    modelId: "deepseek-v4-flash",
    modelRevision: "deepseek-v4-flash-0731",
    supportedRoles: ["primary-kp"],
    validationSuiteVersion: "kp-vnext-provider-handshake-v1",
    validationStatus: "pending",
    structuredOutputMode: "strict-tool",
    contextWindowTokens: 64_000,
    latencyTier: "standard",
    costTier: "standard",
    ...overrides,
  };
}

function evidenceFor(profile, overrides = {}) {
  return createStrictToolProviderValidationEvidence({
    profile,
    executionMode: "live-provider",
    contracts: [{
      contractId: "submit-proposal-bundle",
      toolName: "submit_proposal_bundle",
      promptHash: stableStructuralHash({ prompt: "vnext-proposal-bundle-v2" }),
      schemaHash: stableStructuralHash(STRICT_SCHEMA),
      parserHash: stableStructuralHash({ parser: "vnext-proposal-bundle-v2" }),
      caseIds: ["world-interaction-only", "materialize-then-interact"],
    }, {
      contractId: "correct-proposal-bundle",
      toolName: "correct_proposal_bundle",
      promptHash: stableStructuralHash({ prompt: "vnext-proposal-correction-v1" }),
      schemaHash: stableStructuralHash(CORRECTION_SCHEMA),
      parserHash: stableStructuralHash({ parser: "vnext-proposal-bundle-v2" }),
      caseIds: ["summary-only-correction"],
    }],
    validationSuiteHash: stableStructuralHash({ suite: "strict-tool-handshake-v1" }),
    validatedAt: "2026-09-02T00:00:00.000Z",
    caseCount: 4,
    liveProviderCalls: 4,
    successfulStrictToolCalls: 3,
    invalidSchemaRejections: 1,
    invalidSchemaRejectedBeforeGeneration: true,
    ...overrides,
  });
}

function toolResponse(argumentsValue = {
  bundleKind: "proposal-bundle",
  operations: [{ kind: "world-interaction", ref: "object:chain" }],
}) {
  return {
    choices: [{
      message: {
        tool_calls: [{
          type: "function",
          function: {
            name: "submit_proposal_bundle",
            arguments: JSON.stringify(argumentsValue),
          },
        }],
      },
    }],
  };
}

function correctionToolResponse(summary = "检查完成。") {
  return {
    choices: [{
      message: {
        tool_calls: [{
          type: "function",
          function: {
            name: "correct_proposal_bundle",
            arguments: JSON.stringify({ summary }),
          },
        }],
      },
    }],
  };
}

function parseToolResponse(response, expectedKinds) {
  const calls = response?.choices?.[0]?.message?.tool_calls;
  assert.equal(calls?.length, 1);
  assert.equal(calls[0]?.function?.name, "submit_proposal_bundle");
  const parsed = JSON.parse(calls[0].function.arguments);
  assert.equal(parsed.bundleKind, "proposal-bundle");
  assert.deepEqual(parsed.operations.map((entry) => entry.kind), expectedKinds);
  return parsed;
}

function parseCorrectionToolResponse(response) {
  const calls = response?.choices?.[0]?.message?.tool_calls;
  assert.equal(calls?.length, 1);
  assert.equal(calls[0]?.function?.name, "correct_proposal_bundle");
  const parsed = JSON.parse(calls[0].function.arguments);
  assert.equal(parsed.summary, "检查完成。");
  return parsed;
}

test("strict-tool beta Adapter validates the dialect and preserves strict function transport", async () => {
  const calls = [];
  const binding = createDeepSeekStrictToolBinding({
    apiKey: "test-key",
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(toolResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const signal = new AbortController().signal;
  const response = await binding.run(
    "deepseek-v4-flash",
    strictModelInput(),
    { signal },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, DEEPSEEK_STRICT_TOOL_BETA_ENDPOINT);
  assert.equal(calls[0].init.signal, signal);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.tools[0].function.strict, true);
  assert.deepEqual(body.tools[0].function.parameters, STRICT_SCHEMA);
  assert.equal(body.tool_choice, "required");
  assert.equal(body.max_tokens, 1_200);
  assert.equal("max_completion_tokens" in body, false);
  assert.equal("parallel_tool_calls" in body, false);
  assert.equal(response.choices.length, 1);
});

test("strict-tool beta Adapter rejects unconstrained or unsupported schemas before fetch", async () => {
  let fetchCount = 0;
  const binding = createDeepSeekStrictToolBinding({
    apiKey: "test-key",
    fetcher: async () => {
      fetchCount += 1;
      throw new Error("must not fetch invalid strict-tool input");
    },
  });
  const unsupportedArraySchema = {
    ...STRICT_SCHEMA,
    properties: {
      ...STRICT_SCHEMA.properties,
      operations: {
        ...STRICT_SCHEMA.properties.operations,
        minItems: 1,
      },
    },
  };
  const requests = [
    { ...strictModelInput(), tool_choice: "auto" },
    {
      ...strictModelInput(),
      tools: [strictModelInput().tools[0], strictModelInput().tools[0]],
    },
    {
      ...strictModelInput(),
      tools: [{
        ...strictModelInput().tools[0],
        function: { ...strictModelInput().tools[0].function, strict: false },
      }],
    },
    strictModelInput(unsupportedArraySchema),
  ];
  for (const request of requests) {
    await assert.rejects(
      binding.run("deepseek-v4-flash", request),
      (error) => {
        assert.ok(error instanceof DeepSeekStrictToolConfigurationError);
        assert.equal(classifyModelError(error), "modelPermanent");
        return true;
      },
    );
  }
  assert.equal(fetchCount, 0);
  assert.match(deepSeekStrictToolSchemaIssues(unsupportedArraySchema)[0], /minItems/u);
});

test("DeepSeek strict dialect accepts documented $def refs and rejects unresolved or standard $defs refs", () => {
  assert.doesNotThrow(() => assertDeepSeekStrictToolSchema(STRICT_SCHEMA));
  const unresolved = structuredClone(STRICT_SCHEMA);
  unresolved.properties.operations.items.$ref = "#/$def/missing";
  assert.throws(
    () => assertDeepSeekStrictToolSchema(unresolved),
    /definition-not-found/u,
  );
  const standardDefs = structuredClone(STRICT_SCHEMA);
  standardDefs.$defs = standardDefs.$def;
  delete standardDefs.$def;
  standardDefs.properties.operations.items.$ref = "#/$defs/operation";
  assert.throws(
    () => assertDeepSeekStrictToolSchema(standardDefs),
    /unsupported-keyword|local-def-required/u,
  );
});

test("Registry fails closed unless strict-tool has matching live beta evidence", () => {
  const toolProfile = { ...strictProfile(), structuredOutputMode: "tool" };
  assert.doesNotThrow(() => createModelProfileRegistry([toolProfile]));
  assert.throws(
    () => createModelProfileRegistry([strictProfile()]),
    /STRICT_TOOL_EVIDENCE_REQUIRED/u,
  );

  const profile = strictProfile();
  const offline = evidenceFor(profile, {
    executionMode: "offline-fixture",
    liveProviderCalls: 0,
  });
  assert.throws(
    () => createModelProfileRegistry([{ ...profile, strictToolValidation: offline }]),
    /STRICT_TOOL_LIVE_EVIDENCE_REQUIRED/u,
  );

  const wrongEndpoint = evidenceFor(profile, {
    endpointProtocol: "deepseek-chat-completions-standard-tool-v1",
  });
  assert.throws(
    () => createModelProfileRegistry([{ ...profile, strictToolValidation: wrongEndpoint }]),
    /STRICT_TOOL_EVIDENCE_INVALID/u,
  );

  const boundToOtherRevision = evidenceFor(profile);
  assert.throws(
    () => createModelProfileRegistry([{
      ...profile,
      modelRevision: "deepseek-v4-flash-other",
      strictToolValidation: boundToOtherRevision,
    }]),
    /STRICT_TOOL_EVIDENCE_INVALID/u,
  );

  const validBeforeTamper = evidenceFor(profile);
  assert.throws(
    () => createModelProfileRegistry([{
      ...profile,
      strictToolValidation: {
        ...validBeforeTamper,
        contracts: validBeforeTamper.contracts.map((contract, index) => index === 0
          ? { ...contract, promptHash: stableStructuralHash({ prompt: "tampered" }) }
          : contract),
      },
    }]),
    /STRICT_TOOL_EVIDENCE_INVALID/u,
  );

  const evidence = evidenceFor(profile);
  const registry = createModelProfileRegistry([{
    ...profile,
    strictToolValidation: evidence,
  }]);
  assert.equal(
    registry.profiles[profile.profileRef].strictToolValidation.endpointProtocol,
    DEEPSEEK_STRICT_TOOL_ENDPOINT_PROTOCOL,
  );
  assert.equal(
    registry.profiles[profile.profileRef].strictToolValidation.schemaDialect,
    DEEPSEEK_STRICT_TOOL_SCHEMA_DIALECT,
  );
  assert.match(registry.profiles[profile.profileRef].profileHash, /^fnv1a64:/u);
});

test("injected handshake covers both vNext shapes plus Provider-side pre-generation rejection", async () => {
  const profile = strictProfile();
  const invalidSchema = {
    ...STRICT_SCHEMA,
    properties: {
      ...STRICT_SCHEMA.properties,
      operations: {
        ...STRICT_SCHEMA.properties.operations,
        minItems: 1,
      },
    },
  };
  const calls = [];
  const definition = {
    profile,
    contracts: [{
      contractId: "submit-proposal-bundle",
      promptHash: stableStructuralHash({ prompt: "vnext-proposal-bundle-v2" }),
      parserHash: stableStructuralHash({ parser: "vnext-proposal-bundle-v2" }),
    }, {
      contractId: "correct-proposal-bundle",
      promptHash: stableStructuralHash({ prompt: "vnext-proposal-correction-v1" }),
      parserHash: stableStructuralHash({ parser: "vnext-proposal-bundle-v2" }),
    }],
    positiveCases: [
      {
        caseId: "world-interaction-only",
        contractId: "submit-proposal-bundle",
        capability: "world-interaction",
        modelInput: strictModelInput(),
        parse: (response) => parseToolResponse(response, ["world-interaction"]),
      },
      {
        caseId: "materialize-then-interact",
        contractId: "submit-proposal-bundle",
        capability: "materialization+world-interaction",
        modelInput: {
          ...strictModelInput(),
          messages: [{ role: "user", content: "抓起场景中的椅子砸向守卫" }],
        },
        parse: (response) => parseToolResponse(response, [
          "materialization",
          "world-interaction",
        ]),
      },
      {
        caseId: "summary-only-correction",
        contractId: "correct-proposal-bundle",
        capability: "proposal-summary-correction",
        modelInput: strictCorrectionModelInput(),
        parse: parseCorrectionToolResponse,
      },
    ],
    invalidSchemaCase: {
      caseId: "provider-rejects-min-items",
      modelInput: strictModelInput(invalidSchema),
    },
  };
  const report = await runDeepSeekStrictToolHandshake({
    definition,
    executionMode: "live-provider",
    validatedAt: "2026-09-02T00:00:00.000Z",
    invoke: async (model, input, { signal }) => {
      calls.push({ kind: "positive", model, input, signal });
      if (input.tools[0].function.name === "correct_proposal_bundle") {
        return correctionToolResponse();
      }
      return input.messages[0].content.includes("椅子")
        ? toolResponse({
            bundleKind: "proposal-bundle",
            operations: [
              { kind: "materialization", ref: "object:chair:1" },
              { kind: "world-interaction", ref: "object:chair:1" },
            ],
          })
        : toolResponse();
    },
    invokeInvalidSchema: async (model, input, { signal }) => {
      calls.push({ kind: "negative", model, input, signal });
      return { status: 422, generatedOutput: false };
    },
  });

  assert.equal(report.status, "passed");
  assert.equal(report.registrationAccepted, true);
  assert.equal(report.liveProviderCalls, 4);
  assert.equal(report.positiveCases.length, 3);
  assert.ok(report.positiveCases.every((entry) => entry.passed));
  assert.equal(report.invalidSchemaCase.rejectedBeforeGeneration, true);
  assert.equal(report.evidence.successfulStrictToolCalls, 3);
  assert.equal(report.evidence.invalidSchemaRejections, 1);
  assert.equal(report.evidence.contracts.length, 2);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((entry) => entry.signal instanceof AbortSignal));
  assert.equal(JSON.stringify(report).includes("抓起场景中的椅子"), false);
});

test("validation-only invalid-schema probe uses beta transport without exposing Provider body", async () => {
  const calls = [];
  const probe = createDeepSeekInvalidSchemaProbe({
    apiKey: "probe-key",
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        error: { message: "private provider schema detail" },
      }), {
        status: 422,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const observed = await probe(
    "deepseek-v4-flash",
    strictModelInput({
      ...STRICT_SCHEMA,
      properties: {
        ...STRICT_SCHEMA.properties,
        operations: { ...STRICT_SCHEMA.properties.operations, minItems: 1 },
      },
    }),
  );
  assert.equal(calls[0].url, DEEPSEEK_STRICT_TOOL_BETA_ENDPOINT);
  assert.equal(observed.status, 422);
  assert.equal(observed.generatedOutput, false);
  assert.equal(JSON.stringify(observed).includes("private provider schema detail"), false);
  await assert.rejects(
    probe("deepseek-v4-flash", strictModelInput()),
    /PROBE_REQUIRES_INVALID_SCHEMA/u,
  );
  assert.equal(calls.length, 1);
});
