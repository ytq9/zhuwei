import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  KP_V3_EVAL_REPORT_SCHEMA,
  KP_V3_EVAL_THRESHOLDS,
  runKpV3Evaluation,
  wilson95,
} from "../tools/run-kp-v3-eval.mjs";

const FIXTURE_URL = new URL("./fixtures/kp-v3-gold.json", import.meta.url);
const EXPECTED_CATEGORIES = Object.freeze([
  "观察",
  "NPC",
  "重大歧义",
  "高风险",
  "缺前提",
  "动态事实",
  "隐藏现实",
  "个人知识",
  "NPC有限知识",
  "有意义失败",
  "Activity",
  "战斗",
  "资源",
  "收束",
  "复合动态行动",
]);
const FORM_IDS = new Set([
  "clarification.v1",
  "observe.v1",
  "npc-exchange.v1",
  "ordinary-check.v1",
  "high-risk-action.v1",
  "in-world-refusal.v1",
  "materialization.v1",
  "combat-action.v1",
  "environmental-stunt.v1",
  "compound.v1",
]);
const ROUTES = new Set([
  "activity",
  "awaiting-input",
  "combat",
  "conclusion",
  "executable",
  "resolved-in-world",
]);

const fixture = JSON.parse(await readFile(FIXTURE_URL, "utf8"));
const reportPromise = runKpV3Evaluation();

test("KP V3 gold fixture contains exactly 120 complete Chinese cases", () => {
  assert.equal(fixture.schemaVersion, "zhuwei-kp-v3-gold-v1");
  assert.equal(fixture.caseCount, 120);
  assert.equal(fixture.cases.length, 120);
  assert.deepEqual(fixture.categories.map((category) => category.label), EXPECTED_CATEGORIES);
  assert.ok(fixture.categories.every((category) => category.count === 8));

  const ids = new Set();
  for (const goldCase of fixture.cases) {
    assert.match(goldCase.intent, /\p{Script=Han}/u, goldCase.id);
    assert.equal(ids.has(goldCase.id), false, goldCase.id);
    ids.add(goldCase.id);
    assert.ok(FORM_IDS.has(goldCase.goldForm), goldCase.id);
    assert.ok(Array.isArray(goldCase.requiredRefs) && goldCase.requiredRefs.length > 0, goldCase.id);
    assert.ok(Array.isArray(goldCase.criticalRefs) && goldCase.criticalRefs.length > 0, goldCase.id);
    assert.ok(goldCase.criticalRefs.every((ref) => goldCase.requiredRefs.includes(ref)), goldCase.id);
    assert.ok(goldCase.complexity === "simple" || goldCase.complexity === "complex", goldCase.id);
    assert.ok(ROUTES.has(goldCase.expectedRoute), goldCase.id);
    assert.equal(typeof goldCase.expectedExecutable, "boolean", goldCase.id);
    assert.equal(typeof goldCase.signals, "object", goldCase.id);
    assert.ok(["structure", "alias", "fts"].includes(goldCase.retrievalMode), goldCase.id);
    assert.equal(typeof goldCase.retrievalAlias, "string", goldCase.id);
    assert.equal(typeof goldCase.retrievalQuery, "string", goldCase.id);
    if (goldCase.complexity === "complex") assert.equal(goldCase.goldForm, "compound.v1", goldCase.id);
  }

  for (const category of fixture.categories) {
    assert.equal(
      fixture.cases.filter((goldCase) => goldCase.categoryCode === category.code).length,
      8,
      category.label,
    );
  }
});

test("KP V3 runner invokes pure production seams and passes structural hard gates", async () => {
  const report = await reportPromise;
  assert.equal(report.schemaVersion, KP_V3_EVAL_REPORT_SCHEMA);
  assert.equal(report.status, "pass");
  assert.equal(report.execution.mode, "offline-structural");
  assert.equal(report.execution.caseCount, KP_V3_EVAL_THRESHOLDS.exactCaseCount);
  assert.deepEqual(report.execution.productionPureInterfacesInvoked, [
    "selectAllowedKpForms",
    "buildKpFormModelParameters",
    "validateKpFormDraft",
    "validateKpFormModelEnvelope",
    "compileKpFormDraft",
    "lowerCausalActionProgram",
    "createRequiredContext",
    "buildContextPack",
    "compileStaticCorpus",
    "createStaticRetrievalRequest",
    "retrieveStaticReferences",
    "rehydrateStaticContext",
    "runContextPlanner",
  ]);
  assert.deepEqual(report.execution.liveProvider, {
    executed: false,
    calls: 0,
    inputTokens: null,
    outputTokens: null,
    latencyMs: null,
    reason: "This evaluator performs no network or model invocation.",
  });
  assert.match(report.execution.estimates.inputTokens, /not provider token accounting/);
  assert.match(report.execution.localTiming, /not provider latency/);

  assert.deepEqual(report.fixtureCoverage.categories, Object.fromEntries(EXPECTED_CATEGORIES.map((label) => [label, 8])));
  assert.deepEqual(report.fixtureCoverage.complexity, { simple: 88, complex: 32 });
  assert.equal(report.fixtureCoverage.repairableInitialDrafts, 3);

  for (const groupId of ["G0", "G1", "G2", "G3", "G4"]) {
    const group = report.groups[groupId];
    assert.equal(group.applicable, true, groupId);
    assert.equal(group.measurementKind, "offline-structural-estimate", groupId);
    assert.equal(group.schemaBytes.count, 120, groupId);
    assert.equal(group.inputTokensEstimate.count, 120, groupId);
    assert.equal(group.localPureLatencyMs.count, 120, groupId);
    assert.equal(group.localPureLatencyMs.providerLatency, null, groupId);
    assert.ok(group.schemaBytes.p50 <= group.schemaBytes.p95, groupId);
    assert.ok(group.inputTokensEstimate.p50 <= group.inputTokensEstimate.p95, groupId);
    assert.ok(group.localPureLatencyMs.p50 <= group.localPureLatencyMs.p95, groupId);
  }

  const G0 = report.groups.G0;
  const G2 = report.groups.G2;
  assert.deepEqual(G2.retrieval.requiredRecallAt8, {
    numerator: 360,
    denominator: 360,
    rate: 1,
    wilson95: wilson95(360, 360),
  });
  assert.deepEqual(G2.retrieval.criticalRecallAt8, {
    numerator: 240,
    denominator: 240,
    rate: 1,
    wilson95: wilson95(240, 240),
  });
  assert.deepEqual(G2.forms.firstLegalOverall, {
    numerator: 117,
    denominator: 120,
    rate: 117 / 120,
    wilson95: wilson95(117, 120),
  });
  assert.deepEqual(G2.forms.firstLegalSimple, {
    numerator: 86,
    denominator: 88,
    rate: 86 / 88,
    wilson95: wilson95(86, 88),
  });
  assert.deepEqual(G2.forms.firstLegalCompound, {
    numerator: 31,
    denominator: 32,
    rate: 31 / 32,
    wilson95: wilson95(31, 32),
  });
  assert.deepEqual(G2.forms.finalLegalAfterAtMostOneRepair, {
    numerator: 120,
    denominator: 120,
    rate: 1,
    wilson95: wilson95(120, 120),
  });
  assert.deepEqual(G2.routing.executableCoverage, {
    numerator: 120,
    denominator: 120,
    rate: 1,
    wilson95: wilson95(120, 120),
  });
  assert.equal(G2.routing.complexSimpleMisroutes, 0);
  assert.equal(G2.routing.complexCases, 32);
  assert.ok(1 - G2.schemaBytes.median / G0.schemaBytes.median >= KP_V3_EVAL_THRESHOLDS.minimumSchemaMedianReductionFromG0);
  assert.ok(1 - G2.inputTokensEstimate.median / G0.inputTokensEstimate.median >= KP_V3_EVAL_THRESHOLDS.minimumInputMedianReductionFromG0);
  assert.ok(G2.inputTokensEstimate.simpleP95 <= KP_V3_EVAL_THRESHOLDS.maximumSimpleInputP95Estimate);
  assert.ok(G2.inputTokensEstimate.p95 <= KP_V3_EVAL_THRESHOLDS.maximumOverallInputP95Estimate);

  for (const gate of Object.values(report.gainGates)) {
    assert.equal(gate.passed, false);
    assert.equal(gate.adopted, false);
    assert.equal(gate.structuralGainPassed, false);
    assert.equal(gate.inputMedianReduction < 0, true);
    assert.equal(gate.endToEndP95Reduction, null);
    assert.equal(gate.safetyStable, true);
    assert.equal(gate.operationalEvidence, "not-evaluated-offline");
    for (const paired of Object.values(gate.pairedDifferences)) {
      assert.deepEqual(paired, {
        numerator: 0,
        denominator: 120,
        difference: 0,
        improved: 0,
        regressed: 0,
        tied: 120,
        ci95: { low: 0, high: 0 },
      });
    }
  }
  assert.deepEqual(report.groups.G5, {
    applicable: false,
    executed: false,
    adopted: false,
    reason: "G2 召回充分且排序未明显失败，按合同不得运行辅助模型 rerank。",
    metrics: null,
  });

  assert.equal(report.faultInjection.passCount, 5);
  assert.equal(report.faultInjection.totalCount, 5);
  assert.deepEqual(report.faultInjection.safeFallbackRate, {
    numerator: 5,
    denominator: 5,
    rate: 1,
    wilson95: wilson95(5, 5),
  });
  assert.deepEqual(report.faultInjection.cases.map((entry) => entry.stage), [
    "planner",
    "rag",
    "embedding",
    "vector",
    "rerank",
  ]);
  for (const injected of report.faultInjection.cases) {
    assert.equal(injected.injected, true, injected.stage);
    assert.equal(injected.fallbackUsed, true, injected.stage);
    assert.equal(injected.deterministicFallback, true, injected.stage);
    assert.ok(Object.values(injected.frozenFieldsUnchanged).every(Boolean), injected.stage);
    assert.equal(injected.beforeHash, injected.afterHash, injected.stage);
    assert.equal(injected.pass, true, injected.stage);
  }

  assert.equal(report.hardGates.length, 13);
  assert.ok(report.hardGates.every((gate) => gate.pass));
  assert.deepEqual(report.qualification, {
    structuralHardGates: "pass",
    releaseHardGates: "not-evaluated",
    eligibleForReleaseClaim: false,
    missingLiveEvidence: [
      "provider tokenizer input/output counts",
      "Proposal end-to-end p95",
      "main Proposal calls per RootAction",
      "normal Planner/RAG fallback rate",
      "live-model first-pass Form legality and paired repeats",
    ],
  });
  assert.ok(report.limitations.some((entry) => entry.includes("not live model")));
  assert.ok(report.limitations.some((entry) => entry.includes("provider tokenizer")));
  assert.ok(report.limitations.some((entry) => entry.includes("not network or provider latency")));
});

test("Wilson interval validates its numerator and denominator", () => {
  const interval = wilson95(120, 120);
  assert.ok(interval.low > 0.96 && interval.high === 1);
  assert.throws(() => wilson95(2, 1), /KP_V3_EVAL_WILSON_INPUT_INVALID/);
  assert.throws(() => wilson95(0, 0), /KP_V3_EVAL_WILSON_INPUT_INVALID/);
});
