import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TELEMETRY_MODULE = "../app/_runtime/lib/room/telemetry.ts";
const TELEMETRY_SCHEMA = "zhuwei.room-telemetry/v1";

const ALLOWED_OUTPUT_KEYS = Object.freeze([
  "archiveLagBucket",
  "archiveStatus",
  "authorityOperation",
  "authorityResult",
  "contextProfileRef",
  "correctionIntegrity",
  "costBucket",
  "durationMs",
  "errorCode",
  "eventName",
  "eventRange",
  "eventSchemaProfileId",
  "failureClass",
  "latencyBucket",
  "modelId",
  "modelAttempt",
  "modelEndedAt",
  "modelInputTokens",
  "modelOutputTokens",
  "modelProfileVersion",
  "modelProvider",
  "modelRevision",
  "modelResult",
  "modelResponseHash",
  "modelSchemaVersion",
  "modelStartedAt",
  "modelTask",
  "modelTotalTokens",
  "occurredAt",
  "outcomeKind",
  "plannerFallbackUsed",
  "plannerMode",
  "plannerStatus",
  "principalHash",
  "promptPolicyVersion",
  "receiptHash",
  "replayIntegrity",
  "requestId",
  "retrievalFallbackUsed",
  "retrievalHitCountBucket",
  "retrievalMode",
  "retrievalStatus",
  "retryCount",
  "roomHash",
  "rootActionHash",
  "rulesetProfileId",
  "runtimeProfileId",
  "schemaVersion",
  "severity",
  "submissionHash",
]);

const SENSITIVE = Object.freeze({
  cookie: "COOKIE_SECRET_SENTINEL",
  authorization: "AUTHORIZATION_SECRET_SENTINEL",
  token: "TOKEN_SECRET_SENTINEL",
  prompt: "MODEL_PROMPT_SECRET_SENTINEL",
  intent: "NATURAL_LANGUAGE_INTENT_SENTINEL",
  delivery: "DELIVERY_BODY_SECRET_SENTINEL",
  audio: "AUDIO_BYTES_SECRET_SENTINEL",
  transcript: "VOICE_TRANSCRIPT_SECRET_SENTINEL",
  truth: "MODULE_TRUTH_SECRET_SENTINEL",
  knowledge: "UNREVEALED_KNOWLEDGE_SECRET_SENTINEL",
  flag: "INTERNAL_FLAG_SECRET_SENTINEL",
  candidate: "CANDIDATE_DEFINITION_SECRET_SENTINEL",
  projection: "PRIVATE_PROJECTION_SECRET_SENTINEL",
  stack: "ERROR_STACK_SECRET_SENTINEL",
});

const BASE_INPUT = Object.freeze({
  occurredAt: "2026-08-26T06:30:00.000Z",
  severity: "error",
  eventName: "room.action.failed",
  requestId: "request_01K3ZHUWEI0000000000000000",
  correlation: Object.freeze({
    roomId: "room:telemetry-private-identity",
    principalId: "principal:telemetry-private-identity",
    rootActionId: "root:telemetry-private-identity",
    submissionId: "submission:telemetry-private-identity",
    receiptId: "receipt:telemetry-private-identity",
    eventRange: Object.freeze({ from: 41, to: 44 }),
  }),
  profiles: Object.freeze({
    runtime: Object.freeze({ profileId: "runtime-srd51-2014-authoritative-environment-v5" }),
    ruleset: Object.freeze({ profileId: "dnd5e-2014-srd5.1-authoritative-v2" }),
    eventSchema: Object.freeze({ profileId: "room-world-events-v2-npc-items-v1" }),
  }),
  model: Object.freeze({
    provider: "deepseek",
    modelId: "deepseek-v4-flash",
    revision: "deepseek-v4-flash-0731",
    modelProfileVersion: "authoritative-kp-deepseek-v4-flash-private-tools-v2",
    promptPolicyVersion: "authoritative-kp-private-form-narrow-tools-policy-v2",
    schemaVersion: "authoritative-kp-private-form-narrow-tools-v2",
    task: "proposal",
    attempt: 2,
    startedAt: 1_777_000_000_000,
    endedAt: 1_777_000_045_123,
    result: "modelTransient",
    inputTokens: 16_123,
    outputTokens: 2_123,
    totalTokens: 18_246,
    responseHash: `sha256:${"a".repeat(64)}`,
  }),
  outcome: Object.freeze({ kind: "retryableFailure" }),
  failure: Object.freeze({
    source: "kpProposal",
    code: "AI_TIMEOUT",
    error: Object.freeze({
      name: "Error",
      message: SENSITIVE.prompt,
      stack: `Error: ${SENSITIVE.stack}\n    at secret-module.ts:7:11`,
    }),
  }),
  measurements: Object.freeze({
    operationKind: "kpProposal",
    durationMs: 45_123,
    retryCount: 2,
    aiInputTokens: 16_123,
    aiOutputTokens: 2_123,
    narrationTokens: 823,
    neuronsToday: 10_123,
    estimatedUsdMicros: 987_654,
    archiveLagMs: 650_123,
  }),
  archive: Object.freeze({
    status: "lagging",
    replayIntegrity: "verified",
    correctionIntegrity: "notApplicable",
  }),
  request: Object.freeze({
    headers: Object.freeze({
      Cookie: SENSITIVE.cookie,
      Authorization: SENSITIVE.authorization,
      "X-Session-Token": SENSITIVE.token,
    }),
    body: Object.freeze({
      intent: SENSITIVE.intent,
      audio: SENSITIVE.audio,
      transcript: SENSITIVE.transcript,
    }),
  }),
  modelContext: Object.freeze({ prompt: SENSITIVE.prompt }),
  response: Object.freeze({ deliveryBody: SENSITIVE.delivery }),
  module: Object.freeze({ truth: SENSITIVE.truth }),
  world: Object.freeze({ unrevealedKnowledge: SENSITIVE.knowledge }),
  internal: Object.freeze({ flags: [SENSITIVE.flag] }),
  candidates: Object.freeze([{ definition: SENSITIVE.candidate }]),
  privateProjection: Object.freeze({ facts: [SENSITIVE.projection] }),
  rawWorldEvent: Object.freeze({ payload: SENSITIVE.truth }),
  diceCandidates: Object.freeze([4, 17]),
  unknownFutureField: Object.freeze({ content: "UNKNOWN_FIELD_MUST_BE_DROPPED" }),
});

async function buildRoomTelemetryEvent(input) {
  const telemetry = await import(TELEMETRY_MODULE);
  assert.equal(
    typeof telemetry.buildRoomTelemetryEvent,
    "function",
    "telemetry.ts must expose the production responsibility seam buildRoomTelemetryEvent",
  );
  return telemetry.buildRoomTelemetryEvent(input);
}

function assertPlainRecord(value, label) {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), label);
  return value;
}

function assertRedactedHash(value, original, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.match(value, /^(?:h|sha256):[0-9a-f]{16,64}$/, `${label} must be an opaque hash`);
  assert.notEqual(value, original, `${label} must not expose its source identifier`);
}

function walk(value, visit, path = "telemetry") {
  visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, visit, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      walk(entry, visit, `${path}.${key}`);
    }
  }
}

function withSensitiveVariant(input) {
  const changed = structuredClone(input);
  changed.request.headers.Cookie = "CHANGED_COOKIE_MUST_STILL_BE_IGNORED";
  changed.request.body.intent = "CHANGED_INTENT_MUST_STILL_BE_IGNORED";
  changed.modelContext.prompt = "CHANGED_PROMPT_MUST_STILL_BE_IGNORED";
  changed.response.deliveryBody = "CHANGED_DELIVERY_MUST_STILL_BE_IGNORED";
  changed.privateProjection.facts = ["CHANGED_PRIVATE_PROJECTION_MUST_STILL_BE_IGNORED"];
  changed.unknownFutureField = { arbitrary: "CHANGED_UNKNOWN_MUST_STILL_BE_IGNORED" };
  return changed;
}

test("structured telemetry emits only the fixed non-content whitelist and recursively drops secrets", async () => {
  const event = assertPlainRecord(
    await buildRoomTelemetryEvent(structuredClone(BASE_INPUT)),
    "telemetry event must be a plain record",
  );

  assert.deepEqual(Object.keys(event).sort(), [...ALLOWED_OUTPUT_KEYS].sort());
  assert.equal(event.schemaVersion, TELEMETRY_SCHEMA);
  assert.equal(event.occurredAt, BASE_INPUT.occurredAt);
  assert.equal(event.severity, "error");
  assert.equal(event.eventName, "room.action.failed");
  assertRedactedHash(event.requestId, BASE_INPUT.requestId, "requestId");
  assert.deepEqual(event.eventRange, { from: 41, to: 44 });
  assert.equal(event.outcomeKind, "retryableFailure");
  assert.equal(event.failureClass, "modelTransient");
  assert.equal(event.errorCode, "modelTransient");
  assert.equal(event.runtimeProfileId, BASE_INPUT.profiles.runtime.profileId);
  assert.equal(event.rulesetProfileId, BASE_INPUT.profiles.ruleset.profileId);
  assert.equal(event.eventSchemaProfileId, BASE_INPUT.profiles.eventSchema.profileId);
  assert.equal(event.modelProvider, BASE_INPUT.model.provider);
  assert.equal(event.modelId, BASE_INPUT.model.modelId);
  assert.equal(event.modelRevision, BASE_INPUT.model.revision);
  assert.equal(event.modelProfileVersion, BASE_INPUT.model.modelProfileVersion);
  assert.equal(event.promptPolicyVersion, BASE_INPUT.model.promptPolicyVersion);
  assert.equal(event.modelSchemaVersion, BASE_INPUT.model.schemaVersion);
  assert.equal(event.modelTask, BASE_INPUT.model.task);
  assert.equal(event.modelAttempt, BASE_INPUT.model.attempt);
  assert.equal(event.modelStartedAt, BASE_INPUT.model.startedAt);
  assert.equal(event.modelEndedAt, BASE_INPUT.model.endedAt);
  assert.equal(event.modelResult, BASE_INPUT.model.result);
  assert.equal(event.modelInputTokens, BASE_INPUT.model.inputTokens);
  assert.equal(event.modelOutputTokens, BASE_INPUT.model.outputTokens);
  assert.equal(event.modelTotalTokens, BASE_INPUT.model.totalTokens);
  assert.equal(event.modelResponseHash, BASE_INPUT.model.responseHash);
  assert.equal(event.archiveStatus, "lagging");
  assert.equal(event.replayIntegrity, "verified");
  assert.equal(event.correctionIntegrity, "notApplicable");
  assert.equal(event.retryCount, 2);

  assertRedactedHash(event.roomHash, BASE_INPUT.correlation.roomId, "roomHash");
  assertRedactedHash(event.principalHash, BASE_INPUT.correlation.principalId, "principalHash");
  assertRedactedHash(event.rootActionHash, BASE_INPUT.correlation.rootActionId, "rootActionHash");
  assertRedactedHash(event.submissionHash, BASE_INPUT.correlation.submissionId, "submissionHash");
  assertRedactedHash(event.receiptHash, BASE_INPUT.correlation.receiptId, "receiptHash");

  const encoded = JSON.stringify(event);
  for (const sentinel of Object.values(SENSITIVE)) assert.ok(!encoded.includes(sentinel));
  for (const rawId of Object.values(BASE_INPUT.correlation).filter((value) => typeof value === "string")) {
    assert.ok(!encoded.includes(rawId), `raw correlation id leaked: ${rawId}`);
  }
  assert.ok(!encoded.includes("UNKNOWN_FIELD_MUST_BE_DROPPED"));

  const forbiddenKey = /cookie|authorization|token|prompt|intent|delivery|audio|transcript|truth|knowledge|flag|candidate|projection|stack|message|body|email|worldevent|dice/i;
  walk(event, (_value, path) => {
    const key = path.split(".").at(-1)?.replace(/\[\d+\]$/, "") ?? "";
    if (
      key === "promptPolicyVersion"
      || key === "modelInputTokens"
      || key === "modelOutputTokens"
      || key === "modelTotalTokens"
    ) return;
    assert.ok(!forbiddenKey.test(key), `sensitive telemetry key escaped the whitelist: ${path}`);
  });
});

test("model invocation receipts become one complete redacted evidence event", async () => {
  const telemetry = await import(TELEMETRY_MODULE);
  assert.equal(typeof telemetry.buildModelInvocationTelemetryEvent, "function");

  const receipt = {
    provider: "cloudflare-workers-ai",
    modelId: "@cf/zai-org/glm-4.7-flash",
    modelRevision: "workers-ai-catalog-2026-08-26",
    modelProfileVersion: "authoritative-kp-model/v1",
    promptPolicyVersion: "authoritative-kp-policy/v1",
    schemaVersion: "authoritative-kp-proposal/v1",
    task: "proposal",
    rootActionId: "root:private-model-action",
    attempt: 1,
    startedAt: 1_777_100_000_000,
    endedAt: 1_777_100_012_345,
    result: "modelPermanent",
    failureStage: "proposalSchema",
    inputTokens: 321,
    outputTokens: 123,
    totalTokens: 444,
    responseHash: `sha256:${"b".repeat(64)}`,
    prompt: SENSITIVE.prompt,
    privateProjection: SENSITIVE.projection,
  };
  const event = telemetry.buildModelInvocationTelemetryEvent({
    roomId: "room:private-model-room",
    principalId: "principal:private-model-principal",
    receipt,
  });

  assert.deepEqual(Object.keys(event).sort(), [...ALLOWED_OUTPUT_KEYS].sort());
  assert.equal(event.eventName, "room.model.invocation.completed");
  assert.equal(event.severity, "error");
  assert.equal(event.modelId, receipt.modelId);
  assert.equal(event.modelTask, "proposal");
  assert.equal(event.modelResult, "modelPermanent");
  assert.equal(event.failureClass, "modelPermanent");
  assert.equal(event.errorCode, "proposalSchema");
  assert.equal(event.modelInputTokens, 321);
  assert.equal(event.modelOutputTokens, 123);
  assert.equal(event.modelTotalTokens, 444);
  assert.equal(event.modelResponseHash, receipt.responseHash);
  assert.equal(event.latencyBucket, "withinBudget");
  assert.equal(event.costBucket, "withinFreeBudget");
  assertRedactedHash(event.rootActionHash, receipt.rootActionId, "rootActionHash");
  assertRedactedHash(event.roomHash, "room:private-model-room", "roomHash");
  assertRedactedHash(
    event.principalHash,
    "principal:private-model-principal",
    "principalHash",
  );
  assert.equal(JSON.stringify(event).includes(SENSITIVE.prompt), false);
  assert.equal(JSON.stringify(event).includes(SENSITIVE.projection), false);
  for (const failureStage of ["structuredOutput", "projectionBinding"]) {
    const stageEvent = telemetry.buildModelInvocationTelemetryEvent({
      roomId: "room:model-stage",
      principalId: "principal:model-stage",
      receipt: { ...receipt, failureStage },
    });
    assert.equal(stageEvent.failureClass, "modelPermanent");
    assert.equal(stageEvent.errorCode, failureStage);
  }
});

test("client-controlled request ids are never emitted as log content", async () => {
  const malicious = structuredClone(BASE_INPUT);
  malicious.requestId = "REQUEST_ID_PRIVATE_CANARY: reveal the module truth";
  const event = await buildRoomTelemetryEvent(malicious);
  assert.notEqual(event.requestId, malicious.requestId);
  assertRedactedHash(event.requestId, malicious.requestId, "requestId");
  assert.equal(JSON.stringify(event).includes("REQUEST_ID_PRIVATE_CANARY"), false);
});

test("the production KP adapter emits actual receipts instead of hard-coded model claims", async () => {
  const server = await readFile(
    new URL("../app/_runtime/lib/room/server.ts", import.meta.url),
    "utf8",
  );
  assert.match(server, /onInvocationReceipt\(receipt\)/);
  assert.match(server, /buildModelInvocationTelemetryEvent\(\{/);
  assert.match(server, /receipt,\s*\}\)\)\)/);

  const completionStart = server.indexOf("async function executeAuthoritativeRoomAction");
  const completionEnd = server.indexOf("type AuthoritativeAdministrationResult", completionStart);
  const completion = server.slice(completionStart, completionEnd);
  assert.doesNotMatch(completion, /model:\s*\{\s*provider:/);
  assert.doesNotMatch(completion, /AUTHORITATIVE_KP_MODEL/);
  assert.match(completion, /outcome\.kind === "needsKp"[^]*code: "mechanicalDiagnostic"/);
});

test("party narration emits its own redacted model invocation receipt", async () => {
  const server = await readFile(
    new URL("../app/_runtime/lib/room/server.ts", import.meta.url),
    "utf8",
  );
  const partyStart = server.indexOf("export async function runAuthoritativePartyAction");
  const partyEnd = server.indexOf("export function observeAuthoritativeRoom", partyStart);
  assert.notEqual(partyStart, -1);
  assert.notEqual(partyEnd, -1);
  const party = server.slice(partyStart, partyEnd);
  const narrationStart = party.indexOf("const narration = createAuthoritativeKpAdapter");
  const narrationEnd = party.indexOf("return executeAuthoritativeRoomAction", narrationStart);
  assert.notEqual(narrationStart, -1);
  assert.notEqual(narrationEnd, -1);
  const narrationAdapter = party.slice(narrationStart, narrationEnd);
  assert.match(narrationAdapter, /onInvocationReceipt\(receipt\)/);
  assert.match(narrationAdapter, /roomId: input\.roomId/);
  assert.match(narrationAdapter, /principalId: input\.userId/);
  assert.match(narrationAdapter, /buildModelInvocationTelemetryEvent\(\{[^]*receipt,/);
});

test("unknown and sensitive content cannot affect a stable telemetry event or become a covert content hash", async () => {
  const first = await buildRoomTelemetryEvent(structuredClone(BASE_INPUT));
  const identical = await buildRoomTelemetryEvent(structuredClone(BASE_INPUT));
  const sensitiveVariant = await buildRoomTelemetryEvent(withSensitiveVariant(BASE_INPUT));
  assert.deepEqual(identical, first, "the same input must produce the same telemetry record");
  assert.deepEqual(
    sensitiveVariant,
    first,
    "discarded content must not alter output fields or hashes",
  );

  const otherRoom = structuredClone(BASE_INPUT);
  otherRoom.correlation.roomId = "room:a-different-private-identity";
  const changedCorrelation = await buildRoomTelemetryEvent(otherRoom);
  assert.notEqual(changedCorrelation.roomHash, first.roomHash);
  assert.equal(changedCorrelation.rootActionHash, first.rootActionHash);
  assert.equal(changedCorrelation.receiptHash, first.receiptHash);
});

test("free-tier latency, cost, and archive budgets expose buckets rather than raw measurements", async () => {
  const overBudget = await buildRoomTelemetryEvent(structuredClone(BASE_INPUT));
  assert.equal(overBudget.latencyBucket, "overBudget");
  assert.equal(overBudget.costBucket, "overFreeBudget");
  assert.equal(overBudget.archiveLagBucket, "alert");

  const withinInput = structuredClone(BASE_INPUT);
  withinInput.outcome = { kind: "committed" };
  withinInput.failure = undefined;
  withinInput.measurements = {
    operationKind: "roomAuthority",
    durationMs: 740,
    retryCount: 0,
    aiInputTokens: 15_900,
    aiOutputTokens: 1_900,
    narrationTokens: 700,
    neuronsToday: 9_900,
    estimatedUsdMicros: 0,
    archiveLagMs: 59_000,
  };
  const withinBudget = await buildRoomTelemetryEvent(withinInput);
  assert.equal(withinBudget.latencyBucket, "withinBudget");
  assert.equal(withinBudget.costBucket, "withinFreeBudget");
  assert.equal(withinBudget.archiveLagBucket, "withinTarget");

  assert.equal(overBudget.durationMs, 45_123);
  assert.equal(withinBudget.durationMs, 740);

  const forbiddenMeasurementKeys = [
    "aiInputTokens",
    "aiOutputTokens",
    "narrationTokens",
    "neuronsToday",
    "estimatedUsdMicros",
    "archiveLagMs",
  ];
  for (const event of [overBudget, withinBudget]) {
    for (const key of forbiddenMeasurementKeys) assert.equal(event[key], undefined);
  }
});

test("all thirteen failure classifications remain globally consistent across room operations", async () => {
  const cases = [
    {
      code: "SESSION_EXPIRED",
      expectedClass: "authentication",
      publicCode: "authenticationRequired",
      outcomeKind: "rejected",
    },
    {
      code: "NOT_CONTROLLER",
      expectedClass: "authorization",
      publicCode: "notAuthorized",
      outcomeKind: "rejected",
    },
    {
      code: "INVALID_ACTION_SCHEMA",
      expectedClass: "validation",
      publicCode: "invalidRequest",
      outcomeKind: "rejected",
    },
    {
      code: "SCOPE_VERSION_CHANGED",
      expectedClass: "scopeConflict",
      publicCode: "scopeConflict",
      outcomeKind: "retryableFailure",
    },
    {
      code: "MECHANICAL_DIAGNOSTIC",
      expectedClass: "mechanicalDiagnostic",
      publicCode: "mechanicalDiagnostic",
      outcomeKind: "needsKp",
    },
    {
      code: "WORLD_INFEASIBLE",
      expectedClass: "worldInfeasible",
      publicCode: "worldInfeasible",
      outcomeKind: "rejected",
    },
    {
      code: "AI_TIMEOUT",
      expectedClass: "modelTransient",
      publicCode: "modelTransient",
      outcomeKind: "retryableFailure",
    },
    {
      code: "AI_MODEL_UNAVAILABLE",
      expectedClass: "modelPermanent",
      publicCode: "modelUnavailable",
      outcomeKind: "rejected",
    },
    {
      code: "AUTHORITY_UNAVAILABLE",
      expectedClass: "authorityTransient",
      publicCode: "authorityTransient",
      outcomeKind: "retryableFailure",
    },
    {
      code: "ARCHIVE_APPEND_FAILED",
      expectedClass: "archiveFailure",
      publicCode: "archiveFailure",
      outcomeKind: "committed",
    },
    {
      code: "PROJECTION_HASH_MISMATCH",
      expectedClass: "projectionIntegrity",
      publicCode: "projectionIntegrity",
      outcomeKind: "retryableFailure",
    },
    {
      code: "CORRECTION_REQUIRED",
      expectedClass: "correctionRequired",
      publicCode: "correctionRequired",
      outcomeKind: "needsKp",
    },
    {
      code: "AI_FREE_QUOTA_EXHAUSTED",
      expectedClass: "quotaExhausted",
      publicCode: "quotaExhausted",
      outcomeKind: "retryableFailure",
    },
  ];

  for (const fault of cases) {
    const prepareInput = structuredClone(BASE_INPUT);
    prepareInput.eventName = "room.prepare.failed";
    prepareInput.outcome = { kind: fault.outcomeKind };
    prepareInput.failure = { source: "roomAction", code: fault.code };

    const observeInput = structuredClone(prepareInput);
    observeInput.eventName = "room.observe.failed";
    observeInput.failure = { source: "roomAuthority", code: fault.code };

    const prepareEvent = await buildRoomTelemetryEvent(prepareInput);
    const observeEvent = await buildRoomTelemetryEvent(observeInput);
    for (const event of [prepareEvent, observeEvent]) {
      assert.equal(event.failureClass, fault.expectedClass, fault.code);
      assert.equal(event.errorCode, fault.publicCode, fault.code);
      assert.equal(event.outcomeKind, fault.outcomeKind, fault.code);
    }
  }
});
