import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertDeepSeekStrictToolModelInput,
  createDeepSeekStrictToolBinding,
} from "../app/_runtime/lib/kp/deepseek.ts";
import {
  DEEPSEEK_STRICT_TOOL_BETA_ENDPOINT,
  DEEPSEEK_STRICT_TOOL_ENDPOINT_PROTOCOL,
  DEEPSEEK_STRICT_TOOL_SCHEMA_DIALECT,
  deepSeekStrictToolSchemaIssues,
} from "../app/_runtime/lib/kp/deepseek-strict-tool.ts";
import { stableStructuralHash } from "../app/_runtime/lib/kp/causal-action-program.ts";
import {
  createModelProfileRegistry,
  createStrictToolProviderValidationEvidence,
} from "../app/_runtime/lib/kp/model-registry.ts";

export const DEEPSEEK_STRICT_TOOL_HANDSHAKE_REPORT_SCHEMA =
  "kp-deepseek-strict-tool-handshake-report-v2";

export const DEEPSEEK_STRICT_TOOL_HANDSHAKE_CAPABILITIES = Object.freeze([
  "world-interaction",
  "materialization+world-interaction",
  "shared-ability-check",
  "in-world-refusal",
  "proposal-summary-correction",
]);

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Schema, prompts, parser and cases are deliberately injected by the vNext
 * Proposal module. This tool proves one exact contract against the live beta
 * transport; it does not own or copy the ProposalBundle protocol.
 */
export async function runDeepSeekStrictToolHandshake(options) {
  const definition = validateDefinition(options.definition);
  const executionMode = options.executionMode ?? "live-provider";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TypeError("STRICT_TOOL_HANDSHAKE_TIMEOUT_INVALID");
  }
  if (executionMode !== "live-provider" && executionMode !== "offline-fixture") {
    throw new TypeError("STRICT_TOOL_HANDSHAKE_EXECUTION_MODE_INVALID");
  }

  const contracts = contractEvidenceFor(definition);
  const invalidSchemaIssues = invalidSchemaCaseIssues(definition.invalidSchemaCase);
  if (invalidSchemaIssues.length === 0) {
    throw new TypeError("STRICT_TOOL_HANDSHAKE_NEGATIVE_SCHEMA_MUST_BE_LOCALLY_INVALID");
  }
  const validationSuiteHash = stableStructuralHash({
    reportSchema: DEEPSEEK_STRICT_TOOL_HANDSHAKE_REPORT_SCHEMA,
    endpointProtocol: DEEPSEEK_STRICT_TOOL_ENDPOINT_PROTOCOL,
    schemaDialect: DEEPSEEK_STRICT_TOOL_SCHEMA_DIALECT,
    contracts,
    positives: definition.positiveCases.map((entry) => ({
      caseId: entry.caseId,
      contractId: entry.contractId,
      capability: entry.capability,
      modelInputHash: stableStructuralHash(entry.modelInput),
    })),
    negative: {
      caseId: definition.invalidSchemaCase.caseId,
      modelInputHash: stableStructuralHash(definition.invalidSchemaCase.modelInput),
      issueCodes: [...invalidSchemaIssues].sort(),
    },
  });

  const positiveResults = [];
  let liveProviderCalls = 0;
  for (const validationCase of definition.positiveCases) {
    liveProviderCalls += 1;
    try {
      const response = await invokeWithTimeout(
        options.invoke,
        definition.profile.modelId,
        validationCase.modelInput,
        timeoutMs,
      );
      await validationCase.parse(response);
      positiveResults.push(Object.freeze({
        caseId: validationCase.caseId,
        contractId: validationCase.contractId,
        capability: validationCase.capability,
        passed: true,
        failureCode: null,
      }));
    } catch (error) {
      positiveResults.push(Object.freeze({
        caseId: validationCase.caseId,
        contractId: validationCase.contractId,
        capability: validationCase.capability,
        passed: false,
        failureCode: classifyHandshakeFailure(error),
      }));
    }
  }

  liveProviderCalls += 1;
  let negativeResult;
  try {
    const observed = await invokeWithTimeout(
      options.invokeInvalidSchema,
      definition.profile.modelId,
      definition.invalidSchemaCase.modelInput,
      timeoutMs,
    );
    const passed = isRecord(observed)
      && (observed.status === 400 || observed.status === 422)
      && observed.generatedOutput === false;
    negativeResult = Object.freeze({
      caseId: definition.invalidSchemaCase.caseId,
      passed,
      providerStatus: isRecord(observed) && typeof observed.status === "number"
        ? observed.status
        : null,
      rejectedBeforeGeneration: passed,
      failureCode: passed ? null : "invalid-schema-not-rejected",
    });
  } catch (error) {
    negativeResult = Object.freeze({
      caseId: definition.invalidSchemaCase.caseId,
      passed: false,
      providerStatus: numericStatus(error) ?? null,
      rejectedBeforeGeneration: false,
      failureCode: classifyHandshakeFailure(error),
    });
  }

  const successfulStrictToolCalls = positiveResults.filter((entry) => entry.passed).length;
  const invalidSchemaRejections = negativeResult.passed ? 1 : 0;
  const passed = positiveResults.every((entry) => entry.passed) && negativeResult.passed;
  const evidence = passed
    ? createStrictToolProviderValidationEvidence({
        profile: definition.profile,
        executionMode,
        contracts,
        validationSuiteHash,
        validatedAt: options.validatedAt ?? new Date().toISOString(),
        caseCount: positiveResults.length + 1,
        liveProviderCalls: executionMode === "live-provider" ? liveProviderCalls : 0,
        successfulStrictToolCalls,
        invalidSchemaRejections,
        invalidSchemaRejectedBeforeGeneration: negativeResult.rejectedBeforeGeneration,
      })
    : null;

  let registrationAccepted = false;
  if (evidence !== null && executionMode === "live-provider") {
    createModelProfileRegistry([{
      ...definition.profile,
      strictToolValidation: evidence,
    }]);
    registrationAccepted = true;
  }

  return Object.freeze({
    schemaVersion: DEEPSEEK_STRICT_TOOL_HANDSHAKE_REPORT_SCHEMA,
    status: passed ? "passed" : "failed",
    executionMode,
    endpointProtocol: DEEPSEEK_STRICT_TOOL_ENDPOINT_PROTOCOL,
    schemaDialect: DEEPSEEK_STRICT_TOOL_SCHEMA_DIALECT,
    profile: Object.freeze({
      profileRef: definition.profile.profileRef,
      provider: definition.profile.provider,
      modelId: definition.profile.modelId,
      modelRevision: definition.profile.modelRevision,
    }),
    contractHashes: Object.freeze({
      promptHash: aggregateContractHash(contracts, "promptHash"),
      schemaHash: aggregateContractHash(contracts, "schemaHash"),
      parserHash: aggregateContractHash(contracts, "parserHash"),
      contracts,
      validationSuiteHash,
    }),
    liveProviderCalls: executionMode === "live-provider" ? liveProviderCalls : 0,
    positiveCases: Object.freeze(positiveResults),
    invalidSchemaCase: negativeResult,
    registrationAccepted,
    evidence,
  });
}

/** Validation-only escape hatch: production requests never use this path. */
export function createDeepSeekInvalidSchemaProbe(options) {
  const apiKey = String(options.apiKey ?? "").trim();
  const fetcher = options.fetcher ?? fetch;
  return async function invokeInvalidSchema(model, input, invocationOptions = {}) {
    if (!apiKey) throw Object.assign(new Error("DeepSeek API key is missing."), { status: 401 });
    const localIssues = invalidSchemaCaseIssues({ modelInput: input });
    if (localIssues.length === 0) {
      throw new TypeError("STRICT_TOOL_HANDSHAKE_PROBE_REQUIRES_INVALID_SCHEMA");
    }
    const body = providerRequestBody(model, input);
    const response = await fetcher(DEEPSEEK_STRICT_TOOL_BETA_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: invocationOptions.signal,
    });
    const payload = await response.json().catch(() => undefined);
    return Object.freeze({
      status: response.status,
      generatedOutput: hasGeneratedOutput(payload),
    });
  };
}

function validateDefinition(value) {
  if (!isRecord(value) || !isRecord(value.profile)) {
    throw new TypeError("STRICT_TOOL_HANDSHAKE_DEFINITION_INVALID");
  }
  const profile = value.profile;
  if (profile.provider !== "deepseek" || profile.structuredOutputMode !== "strict-tool") {
    throw new TypeError("STRICT_TOOL_HANDSHAKE_PROFILE_INVALID");
  }
  for (const field of [
    "profileRef", "modelId", "modelRevision", "validationSuiteVersion",
  ]) {
    if (typeof profile[field] !== "string" || profile[field].trim().length === 0) {
      throw new TypeError("STRICT_TOOL_HANDSHAKE_PROFILE_INVALID");
    }
  }
  if (!Array.isArray(value.contracts) || value.contracts.length < 2) {
    throw new TypeError("STRICT_TOOL_HANDSHAKE_CONTRACTS_REQUIRED");
  }
  const contracts = new Map();
  for (const contract of value.contracts) {
    if (!isRecord(contract)
      || typeof contract.contractId !== "string"
      || contract.contractId.trim().length === 0
      || contracts.has(contract.contractId)
      || !validHash(contract.promptHash)
      || !validHash(contract.parserHash)) {
      throw new TypeError("STRICT_TOOL_HANDSHAKE_CONTRACT_HASH_INVALID");
    }
    contracts.set(contract.contractId, contract);
  }
  if (!Array.isArray(value.positiveCases) || value.positiveCases.length < 2) {
    throw new TypeError("STRICT_TOOL_HANDSHAKE_POSITIVE_CASES_REQUIRED");
  }
  const capabilities = new Set(value.positiveCases.map((entry) => entry?.capability));
  if (DEEPSEEK_STRICT_TOOL_HANDSHAKE_CAPABILITIES.some((entry) => !capabilities.has(entry))) {
    throw new TypeError("STRICT_TOOL_HANDSHAKE_CAPABILITY_COVERAGE_REQUIRED");
  }
  const caseIds = new Set();
  for (const entry of value.positiveCases) {
    if (!isRecord(entry)
      || typeof entry.caseId !== "string"
      || entry.caseId.trim().length === 0
      || caseIds.has(entry.caseId)
      || typeof entry.contractId !== "string"
      || !contracts.has(entry.contractId)
      || !isRecord(entry.modelInput)
      || typeof entry.parse !== "function") {
      throw new TypeError("STRICT_TOOL_HANDSHAKE_POSITIVE_CASE_INVALID");
    }
    caseIds.add(entry.caseId);
  }
  for (const contractId of contracts.keys()) {
    if (!value.positiveCases.some((entry) => entry.contractId === contractId)) {
      throw new TypeError("STRICT_TOOL_HANDSHAKE_CONTRACT_CASE_REQUIRED");
    }
  }
  if (!isRecord(value.invalidSchemaCase)
    || typeof value.invalidSchemaCase.caseId !== "string"
    || value.invalidSchemaCase.caseId.trim().length === 0
    || caseIds.has(value.invalidSchemaCase.caseId)
    || !isRecord(value.invalidSchemaCase.modelInput)) {
    throw new TypeError("STRICT_TOOL_HANDSHAKE_NEGATIVE_CASE_INVALID");
  }
  return value;
}

function contractEvidenceFor(definition) {
  return Object.freeze([...definition.contracts]
    .sort((left, right) => left.contractId.localeCompare(right.contractId))
    .map((contract) => {
      const cases = definition.positiveCases.filter((entry) =>
        entry.contractId === contract.contractId);
      const schemas = new Set();
      const toolNames = new Set();
      for (const entry of cases) {
        assertDeepSeekStrictToolModelInput(entry.modelInput);
        const tools = entry.modelInput.tools;
        if (!Array.isArray(tools) || tools.length !== 1 || !isRecord(tools[0]?.function)) {
          throw new TypeError("STRICT_TOOL_HANDSHAKE_SINGLE_SCHEMA_REQUIRED");
        }
        schemas.add(stableStructuralHash(tools[0].function.parameters));
        toolNames.add(tools[0].function.name);
      }
      if (schemas.size !== 1 || toolNames.size !== 1) {
        throw new TypeError("STRICT_TOOL_HANDSHAKE_CONTRACT_SCHEMA_MISMATCH");
      }
      return Object.freeze({
        contractId: contract.contractId,
        toolName: [...toolNames][0],
        promptHash: contract.promptHash,
        schemaHash: [...schemas][0],
        parserHash: contract.parserHash,
        caseIds: Object.freeze(cases.map((entry) => entry.caseId).sort()),
      });
    }));
}

function aggregateContractHash(contracts, field) {
  return stableStructuralHash(contracts.map((contract) => ({
    contractId: contract.contractId,
    [field]: contract[field],
  })));
}

function invalidSchemaCaseIssues(validationCase) {
  const tools = validationCase.modelInput.tools;
  if (!Array.isArray(tools)) return Object.freeze(["tools-required"]);
  if (validationCase.modelInput.tool_choice !== "required"
    || (validationCase.modelInput.parallel_tool_calls !== undefined
      && validationCase.modelInput.parallel_tool_calls !== false)) {
    throw new TypeError("STRICT_TOOL_HANDSHAKE_NEGATIVE_TRANSPORT_INVALID");
  }
  const issues = [];
  for (const tool of tools) {
    if (!isRecord(tool) || !isRecord(tool.function)) {
      issues.push("function-tool-required");
      continue;
    }
    if (tool.type !== "function" || tool.function.strict !== true) {
      throw new TypeError("STRICT_TOOL_HANDSHAKE_NEGATIVE_TRANSPORT_INVALID");
    }
    issues.push(...deepSeekStrictToolSchemaIssues(tool.function.parameters));
  }
  return Object.freeze(issues);
}

async function invokeWithTimeout(invoke, model, input, timeoutMs) {
  if (typeof invoke !== "function") {
    throw new TypeError("STRICT_TOOL_HANDSHAKE_INVOKER_REQUIRED");
  }
  const abortController = new AbortController();
  let timer;
  try {
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        abortController.abort();
        const error = new Error("Strict-tool handshake timed out.");
        error.name = "AbortError";
        reject(error);
      }, timeoutMs);
    });
    return await Promise.race([
      invoke(model, input, { signal: abortController.signal }),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function providerRequestBody(model, input) {
  const supported = { ...input };
  const maxCompletionTokens = supported.max_completion_tokens;
  delete supported.max_completion_tokens;
  delete supported.parallel_tool_calls;
  return {
    ...supported,
    model,
    ...(typeof maxCompletionTokens === "number" ? { max_tokens: maxCompletionTokens } : {}),
    thinking: { type: "disabled" },
    stream: false,
  };
}

function hasGeneratedOutput(value) {
  return isRecord(value) && Array.isArray(value.choices) && value.choices.length > 0;
}

function classifyHandshakeFailure(error) {
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  const status = numericStatus(error);
  if (status === 429 || (status !== undefined && status >= 500)) return "provider-transient";
  if (status !== undefined && status >= 400) return "provider-permanent";
  return "output-or-parser-invalid";
}

function numericStatus(value) {
  return isRecord(value) && typeof value.status === "number" ? value.status : undefined;
}

function validHash(value) {
  return typeof value === "string"
    && /^(?:fnv1a64:[0-9a-f]{16}|sha256:[0-9a-f]{64})$/u.test(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const definitionPath = process.argv[2];
  if (!apiKey || !definitionPath) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: DEEPSEEK_STRICT_TOOL_HANDSHAKE_REPORT_SCHEMA,
      status: "blocked",
      liveProviderCalls: 0,
      evidence: null,
      reason: !apiKey ? "DEEPSEEK_API_KEY_MISSING" : "HANDSHAKE_DEFINITION_MODULE_REQUIRED",
    }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }
  const imported = await import(pathToFileURL(resolve(definitionPath)).href);
  const definition = imported.strictToolHandshakeDefinition ?? imported.default;
  const binding = createDeepSeekStrictToolBinding({ apiKey });
  const report = await runDeepSeekStrictToolHandshake({
    definition,
    invoke: (model, input, invocationOptions) => binding.run(model, input, invocationOptions),
    invokeInvalidSchema: createDeepSeekInvalidSchemaProbe({ apiKey }),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "passed" ? 0 : 1;
}

const invokedPath = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) await main();
