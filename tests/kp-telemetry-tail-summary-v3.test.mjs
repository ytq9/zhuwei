import assert from "node:assert/strict";
import test from "node:test";

import { createKpTelemetryTailAggregator } from "../tools/summarize-kp-telemetry-tail.mjs";

test("tail aggregation emits only bounded KPI distributions and classifications", () => {
  const aggregate = createKpTelemetryTailAggregator("G2");
  for (const event of [
    model("root-a", "proposal", 1, "success", 120, 4000, 300),
    model("root-b", "proposal", 1, "modelPermanent", 200, 4100, 200, "proposalSchema"),
    model("root-b", "proposal", 2, "success", 180, 1200, 160),
    model("root-a", "narration", 1, "success", 90, 900, 120),
    context(false, false),
    context(false, true),
  ]) aggregate.ingestTailEnvelope(envelope(event));

  const report = aggregate.report();
  assert.equal(report.label, "G2");
  assert.equal(report.capture.modelEvents, 4);
  assert.equal(report.capture.contextEvents, 2);
  assert.equal(report.proposal.invocations, 3);
  assert.equal(report.proposal.rootActions, 2);
  assert.equal(report.proposal.callsPerRootAction, 1.5);
  assert.deepEqual(report.proposal.firstAttemptSuccess, {
    numerator: 1,
    denominator: 2,
    rate: 0.5,
    wilson95: report.proposal.firstAttemptSuccess.wilson95,
  });
  assert.equal(report.proposal.repairedRootActions.numerator, 1);
  assert.equal(report.proposal.inputTokens.p95, 4100);
  assert.equal(report.narration.inputTokens.p95, 900);
  assert.equal(report.context.fallback.numerator, 1);
  assert.equal(report.context.fallback.denominator, 2);
  const serialized = JSON.stringify(report);
  for (const forbidden of ["root-a", "root-b", "prompt-secret", "cookie-secret", "body-secret"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

function envelope(event) {
  return {
    event: { request: { headers: { cookie: "cookie-secret" } } },
    logs: [{ message: [JSON.stringify(event), "prompt-secret", "body-secret"] }],
  };
}

function model(rootActionHash, task, attempt, result, durationMs, inputTokens, outputTokens, errorCode) {
  return {
    schemaVersion: "zhuwei.room-telemetry/v1",
    eventName: "room.model.invocation.completed",
    rootActionHash,
    modelTask: task,
    modelAttempt: attempt,
    modelResult: result,
    durationMs,
    modelInputTokens: inputTokens,
    modelOutputTokens: outputTokens,
    modelId: "deepseek-v4-flash",
    modelRevision: "deepseek-v4-flash-0731",
    modelProfileVersion: "authoritative-kp-v3",
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

function context(plannerFallbackUsed, retrievalFallbackUsed) {
  return {
    schemaVersion: "zhuwei.room-telemetry/v1",
    eventName: "kp.context.prepared",
    plannerMode: "disabled",
    plannerStatus: "disabled",
    plannerFallbackUsed,
    retrievalMode: retrievalFallbackUsed ? "deterministic" : "d1-fts",
    retrievalStatus: retrievalFallbackUsed ? "fallback" : "selected",
    retrievalFallbackUsed,
  };
}
