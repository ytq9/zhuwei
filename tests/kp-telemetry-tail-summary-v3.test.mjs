import assert from "node:assert/strict";
import test from "node:test";

import { createKpTelemetryTailAggregator } from "../tools/summarize-kp-telemetry-tail.mjs";

test("tail aggregation emits only bounded KPI distributions and classifications", () => {
  const aggregate = createKpTelemetryTailAggregator("G2");
  for (const event of [
    model("root-a", "proposal", "initialProposal", 1, "success", 120, 4000, 300),
    model("root-b", "proposal", "initialProposal", 1, "modelPermanent", 200, 4100, 200, "proposalSchema"),
    model("root-b", "proposal", "semanticRepair", 2, "success", 180, 1200, 160),
    model("root-c", "proposal", "initialProposal", 1, "success", 130, 3900, 280),
    model("root-c", "proposal", "clarificationContinuation", 1, "success", 110, 3600, 250),
    model("root-d", "proposal", "actorPlan", 1, "success", 115, 3500, 240),
    model("root-d", "proposal", "initialProposal", 1, "success", 125, 3800, 260),
    model("root-e", "proposal", "proposalRetry", 1, "success", 105, 3300, 230),
    model("root-a", "narration", "initialNarration", 1, "modelPermanent", 90, 900, 120, "narrationGrounding"),
    model("root-a", "narration", "narrationGroundingRepair", 1, "success", 80, 700, 100),
    model("root-b", "narration", "narrationRecovery", 1, "modelPermanent", 85, 800, 110, "narrationGrounding"),
    model("root-b", "narration", "narrationRecoveryGroundingRepair", 1, "success", 75, 650, 90),
    context(false, false),
    context(false, true),
  ]) aggregate.ingestTailEnvelope(envelope(event));

  const report = aggregate.report();
  assert.equal(report.label, "G2");
  assert.equal(report.schemaVersion, "zhuwei-kp-tail-aggregate/v2");
  assert.equal(report.capture.modelEvents, 12);
  assert.equal(report.capture.contextEvents, 2);
  assert.deepEqual(report.invocationsByPurpose, {
    actorPlan: 1,
    clarificationContinuation: 1,
    initialNarration: 1,
    initialProposal: 4,
    narrationGroundingRepair: 1,
    narrationRecovery: 1,
    narrationRecoveryGroundingRepair: 1,
    proposalRetry: 1,
    semanticRepair: 1,
  });
  assert.equal(report.proposal.invocations, 8);
  assert.equal(report.proposal.rootActions, 5);
  assert.equal(report.proposal.callsPerRootAction, 1.6);
  assert.deepEqual(report.proposal.initialFirstPassSuccess, {
    numerator: 3,
    denominator: 4,
    rate: 0.75,
    wilson95: report.proposal.initialFirstPassSuccess.wilson95,
  });
  assert.equal(report.proposal.repairRate.numerator, 1);
  assert.equal(report.proposal.repairRate.denominator, 4);
  assert.equal(report.proposal.clarificationContinuationRate.numerator, 1);
  assert.equal(report.proposal.clarificationContinuationRate.denominator, 4);
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

function model(
  rootActionHash,
  task,
  invocationPurpose,
  attempt,
  result,
  durationMs,
  inputTokens,
  outputTokens,
  errorCode,
) {
  return {
    schemaVersion: "zhuwei.room-telemetry/v1",
    eventName: "room.model.invocation.completed",
    rootActionHash,
    modelTask: task,
    modelInvocationPurpose: invocationPurpose,
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
