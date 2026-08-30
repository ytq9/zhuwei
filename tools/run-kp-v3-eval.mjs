import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import {
  compileKpFormDraft,
  lowerCausalActionProgram,
  stableStructuralHash,
} from "../app/_runtime/lib/kp/causal-action-program.ts";
import {
  buildContextPack,
  createRequiredContext,
} from "../app/_runtime/lib/kp/context-pack.ts";
import {
  KP_FORM_IDS,
  buildKpFormToolParameters,
  kpFormToolName,
  selectAllowedKpForms,
  validateKpFormDraft,
} from "../app/_runtime/lib/kp/form-catalog.ts";
import {
  createDeterministicPlannerAdapter,
  createModelProfileRegistry,
  runContextPlanner,
} from "../app/_runtime/lib/kp/model-registry.ts";
import {
  authoritativeStaticCorpusReader,
  compileStaticCorpus,
  createD1StaticCorpusAdapter,
  retrieveStaticReferencesFromD1,
} from "../app/_runtime/lib/kp/static-corpus.ts";
import {
  createDeterministicFtsAdapter,
  createStaticRetrievalRequest,
  publicD1QueryTermsForStructuralRefs,
  rehydrateStaticContext,
  retrieveStaticReferences,
} from "../app/_runtime/lib/kp/static-retrieval.ts";
import { v3FormSelectionSignals } from "../app/_runtime/lib/kp/v3-context-runtime.ts";
import { KP_STATIC_FTS_SCHEMA_SQL } from "../db/schema.ts";

export const KP_V3_EVAL_REPORT_SCHEMA = "zhuwei-kp-v3-local-d1-vector-eval-v2";

export const KP_V3_EVAL_THRESHOLDS = Object.freeze({
  exactCaseCount: 120,
  criticalRecallAt8: 1,
  requiredRecallAt8: 0.98,
  simpleFirstLegal: 0.97,
  compoundFirstLegal: 0.95,
  finalLegal: 0.99,
  executableRouteCoverage: 0.995,
  maximumComplexSimpleMisroutes: 0,
  minimumSchemaMedianReductionFromG0: 0.60,
  minimumInputMedianReductionFromG0: 0.50,
  maximumSimpleInputP95Estimate: 8_000,
  maximumOverallInputP95Estimate: 16_000,
  optionalExperimentMinimumInputReduction: 0.10,
  pairedConfidenceLevel: 0.95,
  rankingFailureMrr: 0.90,
});

const DEFAULT_FIXTURE_URL = new URL("../tests/fixtures/kp-v3-gold.json", import.meta.url);
const GROUP_IDS = Object.freeze(["G0", "G1", "G2", "G3", "G4"]);
const LOCAL_EMBEDDING_PROFILE = "unicode-scalar-tfidf-exact-cosine-v1";
const FROZEN_G0_SUPER_SCHEMA_BASELINE = Object.freeze({
  schemaBytes: 34_177,
  fixedRequestBytes: 60_000,
  source: "pre-0.4 authoritative super-schema structural benchmark",
});
const EVAL_PUBLIC_D1_COVER_TOKEN = "evalpubliccoverv1";
const SOURCE_TYPE_BY_CATEGORY = Object.freeze({
  observation: "srd",
  npc: "module",
  "major-ambiguity": "module",
  "high-risk": "srd",
  "missing-prerequisite": "srd",
  "dynamic-fact": "module",
  "hidden-reality": "story-bible",
  "personal-knowledge": "story-bible",
  "npc-limited-knowledge": "module",
  "meaningful-failure": "module",
  activity: "module",
  combat: "srd",
  resource: "ability",
  conclusion: "story-bible",
  "compound-dynamic": "environment",
});

export async function runKpV3Evaluation(options = {}) {
  const fixture = await loadFixture(options.fixturePath);
  validateFixture(fixture);
  const corpus = compileEvaluationCorpus(fixture);
  const corpusReader = authoritativeStaticCorpusReader(corpus);
  const allowedProfileRefs = [...new Set(corpus.chunks.map((chunk) => chunk.profileRef))].sort();
  const publicD1CoverTerms = publicD1QueryTermsForStructuralRefs(
    corpus.index,
    ["eval:public-corpus-cover"],
  ).filter((term) => term === EVAL_PUBLIC_D1_COVER_TOKEN);
  if (publicD1CoverTerms.length !== 1) throw new Error("KP_V3_EVAL_D1_PUBLIC_COVER_INVALID");
  const localD1 = createLocalD1EvaluationDatabase();
  try {
  const d1Adapter = createD1StaticCorpusAdapter(localD1, {
    allowedProfileRefs,
    allowKpOnly: true,
  });
  await d1Adapter.upsert(corpus);
  const d1CurrentAfterWrite = await d1Adapter.isCurrent(corpus);
  if (!d1CurrentAfterWrite) {
    throw new Error("KP_V3_EVAL_D1_CORPUS_NOT_CURRENT");
  }
  const g2D1 = createMeasuredD1Adapter(d1Adapter, localD1);
  const g3D1 = createMeasuredD1Adapter(d1Adapter, localD1);
  const g4D1 = createMeasuredD1Adapter(d1Adapter, localD1);
  const vectorSetupStart = performance.now();
  const vectorFts = createLocalExactVectorAdapter(corpus);
  const vectorSetupLatencyMs = performance.now() - vectorSetupStart;
  const registry = evaluationModelRegistry();
  const results = Object.fromEntries(GROUP_IDS.map((groupId) => [groupId, []]));

  for (const goldCase of fixture.cases) {
    const common = evaluateFormAndRequiredContext(goldCase, corpus);
    results.G0.push(evaluateG0(goldCase, common, corpus));
    results.G1.push(evaluateG1(goldCase, common, corpus));
    results.G2.push(await evaluateRetrievalGroup({
      groupId: "G2",
      goldCase,
      common,
      corpus,
      corpusReader,
      allowedProfileRefs,
      publicD1CoverTerms,
      fts: g2D1,
      planner: null,
    }));

    const plannerStart = performance.now();
    const planner = await runContextPlanner({
      registry,
      pinnedPrimaryKpProfileRef: "eval:primary-kp",
      adapter: createDeterministicPlannerAdapter(),
      plannerInput: {
        rootActionRef: `root:${goldCase.id}`,
        allowedFormIds: common.allowedForms,
        structuralRefs: common.staticRequiredRefs,
        baseQueryTerms: [goldCase.retrievalQuery],
      },
    });
    const plannerLatencyMs = performance.now() - plannerStart;
    const g3 = await evaluateRetrievalGroup({
      groupId: "G3",
      goldCase,
      common,
      corpus,
      corpusReader,
      allowedProfileRefs,
      publicD1CoverTerms,
      fts: g3D1,
      planner,
    });
    results.G3.push(Object.freeze({
      ...g3,
      localLatencyMs: g3.localLatencyMs + plannerLatencyMs,
    }));

    const g4 = await evaluateRetrievalGroup({
      groupId: "G4",
      goldCase,
      common,
      corpus,
      corpusReader,
      allowedProfileRefs,
      publicD1CoverTerms,
      fts: g4D1,
      vectorFts: vectorFts.adapterFor(vectorQueryForCase(goldCase, common, planner)),
      planner,
    });
    results.G4.push(Object.freeze({
      ...g4,
      localLatencyMs: g4.localLatencyMs + plannerLatencyMs,
    }));
  }

  const d1DatabaseEvidence = localD1.snapshot();
  const g2D1Stats = g2D1.snapshot();
  const g3D1Stats = g3D1.snapshot();
  const g4D1Stats = g4D1.snapshot();
  const g2RetrievalEvidence = Object.freeze({
    engine: d1DatabaseEvidence.engine,
    adapterContract: d1DatabaseEvidence.adapterContract,
    cloudflareD1Runtime: d1DatabaseEvidence.cloudflareD1Runtime,
    storage: d1DatabaseEvidence.storage,
    schemaSource: "evaluator-minimal-current-schema plus db/schema.ts KP_STATIC_FTS_SCHEMA_SQL; migrations not executed",
    corpusCurrentAfterWrite: d1CurrentAfterWrite,
    publicCorpusRowsWritten: corpus.d1Rows.length,
    storedChunkRows: d1DatabaseEvidence.storedChunkRows,
    storedFtsRows: d1DatabaseEvidence.storedFtsRows,
    storedKpOnlyRows: d1DatabaseEvidence.storedKpOnlyRows,
    storedBodyBytes: d1DatabaseEvidence.storedBodyBytes,
    ftsWriteExecutions: d1DatabaseEvidence.ftsWriteExecutions,
    databaseTotalMatchExecutions: d1DatabaseEvidence.ftsMatchExecutions,
    distinctMatchBindingHashes: d1DatabaseEvidence.distinctMatchBindingHashes,
    matchExecutions: Object.freeze({
      numerator: g2D1Stats.sqlMatchExecutions,
      denominator: fixture.cases.length,
      failures: g2D1Stats.failures,
    }),
    returnedFtsRefs: g2D1Stats.returnedHits,
    authoritativeReReads: sum(results.G2.map((entry) => entry.retrievalEvidence.authoritativeReReads)),
    nonEmptyAuthoritativeBodies: sum(results.G2.map((entry) => entry.retrievalEvidence.nonEmptyAuthoritativeBodies)),
    d1ReturnedRefsRehydrated: sum(results.G2.map((entry) => entry.retrievalEvidence.d1ReturnedRefsRehydrated)),
    ftsRouteHits: sum(results.G2.map((entry) => entry.retrievalEvidence.ftsRouteHits)),
    publicQueryProvenance: "one fixed cross-case server-owned synthetic cover; runtime MATCH does not read the current case target/ref or player/KP/Planner prose",
    privateCorpusPolicy: "KP-only chunks stay in Worker memory and are never written to the local D1 projection",
  });
  const vectorEvidence = Object.freeze({
    ...vectorFts.snapshot(),
    casesWithVectorReordering: count(results.G4, (entry) => entry.retrievalEvidence.vectorReordered),
    setupLatencyMs: vectorSetupLatencyMs,
    evaluatorOnly: true,
    productionEnabled: false,
  });
  const groups = {
    G0: summarizeGroup("G0", "冻结的 0.4 前超级 Schema 与完整静态上下文结构基线", results.G0, false),
    G1: summarizeGroup("G1", "私有小表与完整静态上下文", results.G1, true),
    G2: Object.freeze({
      ...summarizeGroup("G2", "私有小表、三层 Context Pack 与本地 SQLite FTS5/D1 合同检索", results.G2, true),
      retrievalExecution: g2RetrievalEvidence,
    }),
    G3: Object.freeze({
      ...summarizeGroup("G3", "G2 加确定性 Planner 控制；不是模型 Planner 资格证据", results.G3, true),
      plannerQualification: Object.freeze({
        status: "unvalidated",
        realSupportedCandidateCount: 0,
        proxyExecution: "deterministic-control-only",
        generalizableToModelPlanner: false,
        productionEnabled: false,
        reason: "No live-provider Planner Profile was supplied and role-validated for this run.",
      }),
      retrievalExecution: Object.freeze({
        matchExecutions: g3D1Stats.searches,
        sqlMatchExecutions: g3D1Stats.sqlMatchExecutions,
        failures: g3D1Stats.failures,
      }),
    }),
    G4: Object.freeze({
      ...summarizeGroup("G4", "G3 加评测器本地确定性数值 embedding 与精确向量排序对照", results.G4, true),
      vectorExecution: vectorEvidence,
      baseD1Execution: Object.freeze({
        matchExecutions: g4D1Stats.searches,
        sqlMatchExecutions: g4D1Stats.sqlMatchExecutions,
        failures: g4D1Stats.failures,
      }),
    }),
  };
  const g3StructuralGate = optionalGainGate(groups.G2, groups.G3, results.G2, results.G3);
  const gainGates = {
    G3OverG2: Object.freeze({
      ...g3StructuralGate,
      passed: false,
      adopted: false,
      candidateExecution: "offline-deterministic-control",
      candidateProfileRef: null,
      liveRoleValidation: "unvalidated-no-supported-candidate",
      generalizableToModelPlanner: false,
      productionEnabled: false,
      reason: g3StructuralGate.structuralGainPassed
        ? "离线确定性控制达到结构门，但没有真实模型角色验证和运行证据，不能采用 G3。"
        : "离线确定性控制未达到 G3 预注册增益门，且没有真实模型角色验证；产品诚实停在 G2。",
    }),
    G4OverG2: Object.freeze({
      ...optionalGainGate(groups.G2, groups.G4, results.G2, results.G4),
      candidateExecution: "local-deterministic-exact-vector",
      embeddingProfile: LOCAL_EMBEDDING_PROFILE,
      productionEnabled: false,
    }),
  };
  const g5Applicable = groups.G2.retrieval.requiredRecallAt8.rate >= KP_V3_EVAL_THRESHOLDS.requiredRecallAt8
    && groups.G2.retrieval.meanReciprocalRank < KP_V3_EVAL_THRESHOLDS.rankingFailureMrr;
  const G5 = Object.freeze({
    applicable: g5Applicable,
    executed: false,
    adopted: false,
    reason: g5Applicable
      ? "召回充分但排序低于门槛；需要另行接入经过角色验证的 rerank Profile 后执行。"
      : "G2 召回充分且排序未明显失败，按合同不得运行辅助模型 rerank。",
    metrics: null,
  });

  const faultInjection = await evaluateFaultInjection({
    goldCase: fixture.cases[0],
    corpus,
    registry,
    d1Adapter,
    publicD1CoverTerms,
  });
  const hardGates = hardGateReport({ fixture, groups, faultInjection });
  const status = hardGates.every((gate) => gate.pass) ? "pass" : "fail";
  const measurementProtocol = Object.freeze({
    providerTokenizer: Object.freeze({
      status: "not-measured-no-provider-call",
      provider: null,
      tokenizer: null,
      inputTokens: Object.freeze({ measuredDenominator: 0, caseDenominator: fixture.cases.length, p50: null, p95: null }),
      outputTokens: Object.freeze({ measuredDenominator: 0, caseDenominator: fixture.cases.length, p50: null, p95: null }),
      estimateReportedSeparately: true,
    }),
    proposalEndToEndLatencyMs: Object.freeze({
      status: "not-measured-no-provider-call",
      measuredDenominator: 0,
      rootActionDenominator: fixture.cases.length,
      p50: null,
      p95: null,
      localOfflineG2: Object.freeze({
        denominator: groups.G2.localOfflineExecutionLatencyMs.count,
        p50: groups.G2.localOfflineExecutionLatencyMs.p50,
        p95: groups.G2.localOfflineExecutionLatencyMs.p95,
      }),
    }),
    mainProposalCalls: Object.freeze({
      status: "not-measured-no-provider-call",
      observedNetworkCalls: 0,
      measuredRootActionDenominator: 0,
      plannedRootActionDenominator: fixture.cases.length,
      meanCallsPerRootAction: null,
    }),
    normalFallbacks: Object.freeze({
      d1Rag: Object.freeze({
        status: "measured-local-g2",
        ...ratioMetric(g2D1Stats.failures, g2D1Stats.searches),
      }),
      modelPlanner: Object.freeze({
        status: "not-measured-no-supported-candidate",
        numerator: 0,
        denominator: 0,
        rate: null,
        wilson95: null,
      }),
      releaseCombinedRate: null,
    }),
    firstPassFormLegality: Object.freeze({
      offlineGoldDraft: groups.G2.forms.firstLegalOverall,
      offlineGoldDraftSimple: groups.G2.forms.firstLegalSimple,
      offlineGoldDraftCompound: groups.G2.forms.firstLegalCompound,
      liveProvider: Object.freeze({
        status: "not-measured",
        numerator: 0,
        denominator: 0,
        rate: null,
        wilson95: null,
      }),
    }),
    retryAndRepeatStrategy: Object.freeze({
      datasetPasses: 1,
      repeatsPerCase: 1,
      randomSeed: null,
      determinism: "all evaluated adapters and gold drafts are deterministic",
      pairedCaseDenominator: fixture.cases.length,
      initialDraftDenominator: fixture.cases.length,
      narrowRepairNumerator: groups.G2.forms.repairCases,
      narrowRepairDenominator: fixture.cases.length,
      maximumNarrowRepairsPerCase: 1,
      totalDraftValidations: fixture.cases.length + groups.G2.forms.repairCases,
      providerProposalRetries: "not-measured",
    }),
  });

  const report = Object.freeze({
    schemaVersion: KP_V3_EVAL_REPORT_SCHEMA,
    status,
    execution: Object.freeze({
      mode: "offline-structural-local-sqlite-fts5-exact-vector",
      fixtureSchemaVersion: fixture.schemaVersion,
      caseCount: fixture.cases.length,
      productionPureInterfacesInvoked: Object.freeze([
        "selectAllowedKpForms",
        "buildKpFormToolParameters",
        "kpFormToolName",
        "v3FormSelectionSignals",
        "validateKpFormDraft",
        "compileKpFormDraft",
        "lowerCausalActionProgram",
        "createRequiredContext",
        "buildContextPack",
        "compileStaticCorpus",
        "createStaticRetrievalRequest",
        "retrieveStaticReferences",
        "rehydrateStaticContext",
        "runContextPlanner",
      ]),
      productionIoInterfacesInvoked: Object.freeze([
        "createD1StaticCorpusAdapter",
        "D1StaticCorpusAdapter.upsert",
        "D1StaticCorpusAdapter.isCurrent",
        "retrieveStaticReferencesFromD1",
      ]),
      estimates: Object.freeze({
        inputTokens: "UTF-8 request bytes divided by four; not provider token accounting",
        schemaBytes: "UTF-8 serialized tool-parameter bytes",
      }),
      localTiming: "Measured local structural, SQLite FTS5, and exact-vector wall time; not provider latency",
      liveProvider: Object.freeze({
        executed: false,
        calls: 0,
        inputTokens: null,
        outputTokens: null,
        latencyMs: null,
        reason: "This evaluator performs no network or model invocation.",
      }),
    }),
    fixtureCoverage: fixtureCoverage(fixture),
    thresholds: KP_V3_EVAL_THRESHOLDS,
    groups: Object.freeze({ ...groups, G5 }),
    gainGates: Object.freeze(gainGates),
    measurementProtocol,
    faultInjection,
    hardGates: Object.freeze(hardGates),
    qualification: Object.freeze({
      structuralHardGates: status,
      releaseHardGates: "not-evaluated",
      eligibleForReleaseClaim: false,
      missingLiveEvidence: Object.freeze([
        "provider tokenizer input/output counts",
        "Proposal end-to-end p95",
        "main Proposal calls per RootAction",
        "normal live-model Planner and production-runtime RAG fallback rate",
        "live-model first-pass Form legality and paired repeats",
      ]),
    }),
    limitations: Object.freeze([
      "Form legality and routing are gold-draft structural measurements, not live model first-pass accuracy.",
      "Input tokens are an explicit byte-based estimate; provider tokenizer counts require a live evaluation.",
      "Local structural/SQLite/vector timings are not network or provider latency and are excluded from release latency claims.",
      "G2 executes FTS5 and production D1 adapter SQL through an isolated node:sqlite D1 contract shim, not the Cloudflare D1 runtime or migrations.",
      "G3 has no live-provider, role-validated Planner candidate; its deterministic proxy cannot be generalized and production adoption remains disabled.",
      "G4 uses evaluator-only character TF-IDF embeddings and brute-force exact cosine; it is not a provider semantic embedding and no production vector adapter is wired.",
      "G5 is not executed unless G2 recall passes while ranking falls below its applicability threshold.",
    ]),
  });
  return report;
  } finally {
    localD1.close();
  }
}

function vectorQueryForCase(goldCase, common, planner) {
  const structuralRefs = new Set(common.staticRequiredRefs);
  const plannerFreeText = (planner?.suggestion?.queryTerms ?? [])
    .filter((term) => !structuralRefs.has(term));
  return [goldCase.retrievalQuery, ...plannerFreeText].join("\n");
}

async function loadFixture(fixturePath) {
  const target = fixturePath === undefined
    ? DEFAULT_FIXTURE_URL
    : pathToFileURL(String(fixturePath));
  return JSON.parse(await readFile(target, "utf8"));
}

function validateFixture(fixture) {
  if (!isRecord(fixture) || fixture.schemaVersion !== "zhuwei-kp-v3-gold-v1") {
    throw new Error("KP_V3_EVAL_FIXTURE_SCHEMA_INVALID");
  }
  if (!Array.isArray(fixture.cases) || fixture.cases.length !== KP_V3_EVAL_THRESHOLDS.exactCaseCount) {
    throw new Error("KP_V3_EVAL_CASE_COUNT_INVALID");
  }
  if (fixture.caseCount !== fixture.cases.length
    || !Array.isArray(fixture.categories)
    || fixture.categories.length !== Object.keys(SOURCE_TYPE_BY_CATEGORY).length) {
    throw new Error("KP_V3_EVAL_CATEGORY_COVERAGE_INVALID");
  }
  const categoryCodes = fixture.categories.map((category) => category?.code);
  if (new Set(categoryCodes).size !== categoryCodes.length
    || Object.keys(SOURCE_TYPE_BY_CATEGORY).some((code) => !categoryCodes.includes(code))) {
    throw new Error("KP_V3_EVAL_CATEGORY_COVERAGE_INVALID");
  }
  const ids = new Set();
  for (const [index, goldCase] of fixture.cases.entries()) {
    if (!isRecord(goldCase) || typeof goldCase.id !== "string" || ids.has(goldCase.id)) {
      throw new Error(`KP_V3_EVAL_CASE_ID_INVALID:${index}`);
    }
    ids.add(goldCase.id);
    if (typeof goldCase.intent !== "string" || !/\p{Script=Han}/u.test(goldCase.intent)) {
      throw new Error(`KP_V3_EVAL_CHINESE_INTENT_REQUIRED:${goldCase.id}`);
    }
    if (!KP_FORM_IDS.includes(goldCase.goldForm)) throw new Error(`KP_V3_EVAL_FORM_INVALID:${goldCase.id}`);
    if (!Array.isArray(goldCase.requiredRefs) || goldCase.requiredRefs.length === 0
      || !Array.isArray(goldCase.criticalRefs) || goldCase.criticalRefs.length === 0
      || goldCase.criticalRefs.some((ref) => !goldCase.requiredRefs.includes(ref))) {
      throw new Error(`KP_V3_EVAL_REFS_INVALID:${goldCase.id}`);
    }
    if (goldCase.complexity !== "simple" && goldCase.complexity !== "complex") {
      throw new Error(`KP_V3_EVAL_COMPLEXITY_INVALID:${goldCase.id}`);
    }
    if (!["activity", "awaiting-input", "combat", "conclusion", "executable", "resolved-in-world"].includes(goldCase.expectedRoute)
      || typeof goldCase.expectedExecutable !== "boolean") {
      throw new Error(`KP_V3_EVAL_ROUTE_INVALID:${goldCase.id}`);
    }
    if (!isRecord(goldCase.signals)
      || !["structure", "alias", "fts"].includes(goldCase.retrievalMode)
      || typeof goldCase.retrievalAlias !== "string"
      || typeof goldCase.retrievalQuery !== "string"
      || !["valid", "repairable-invalid"].includes(goldCase.initialDraft)) {
      throw new Error(`KP_V3_EVAL_CASE_INPUT_INVALID:${goldCase.id}`);
    }
    if (goldCase.goldForm === "environmental-stunt.v1"
      && ![
        "open-check", "open-attack", "open-direct", "reuse-check", "reuse-direct",
        "explicitly-absent",
      ].includes(goldCase.environmentScenario)) {
      throw new Error(`KP_V3_EVAL_ENVIRONMENT_SCENARIO_INVALID:${goldCase.id}`);
    }
    if (goldCase.complexity === "complex" && goldCase.goldForm !== "compound.v1") {
      throw new Error(`KP_V3_EVAL_COMPLEX_FORM_INVALID:${goldCase.id}`);
    }
  }
  for (const category of fixture.categories) {
    const observed = fixture.cases.filter((goldCase) => goldCase.categoryCode === category.code).length;
    if (category.count !== observed || observed !== 8) {
      throw new Error(`KP_V3_EVAL_CATEGORY_COUNT_INVALID:${category.code}`);
    }
  }
}

function compileEvaluationCorpus(fixture) {
  const sources = fixture.categories.map((category) => {
    const sample = fixture.cases.find((goldCase) => goldCase.categoryCode === category.code);
    const sourceType = SOURCE_TYPE_BY_CATEGORY[category.code];
    if (sample === undefined || sourceType === undefined) throw new Error("KP_V3_EVAL_CATEGORY_SOURCE_MISSING");
    const profileRef = ["srd", "ability", "enemy"].includes(sourceType)
      ? "eval:srd5.1-profile-v1"
      : "eval:module-profile-v1";
    const sensitivity = ["hidden-reality", "personal-knowledge", "conclusion"].includes(category.code)
      ? "kp-only"
      : "public";
    const paragraph = `${sample.retrievalAlias}：${sample.retrievalQuery}。这是用于验证结构引用、中文精确别名与双字词召回的权威静态原文。`;
    return Object.freeze({
      sourceKind: "static",
      sourceType,
      sourceRef: `eval-corpus:${category.code}:source`,
      profileRef,
      sensitivity,
      body: Array.from({ length: 16 }, () => paragraph).join("\n"),
      aliases: [sample.retrievalAlias],
      structuralRefs: [`gold:${category.code}`],
      // Evaluation dependencies must resolve through the same authority gate as
      // production chunks. The synthetic source is bound to its exact pinned
      // Profile instead of carrying an advisory, unresolvable label.
      dependencyRefs: [profileRef],
    });
  });
  sources.push(Object.freeze({
    sourceKind: "static",
    sourceType: "module",
    sourceRef: "eval-corpus:000-public-cover:source",
    profileRef: "eval:module-profile-v1",
    sensitivity: "public",
    body: "公开静态检索覆盖标记。",
    aliases: [EVAL_PUBLIC_D1_COVER_TOKEN],
    structuralRefs: ["eval:public-corpus-cover"],
    dependencyRefs: ["eval:module-profile-v1"],
  }));
  return compileStaticCorpus(sources);
}

function formToolDefinitions(allowedForms) {
  return allowedForms.map((formId) => ({
    type: "function",
    function: {
      name: kpFormToolName(formId),
      parameters: buildKpFormToolParameters(formId),
    },
  }));
}

function evaluateFormAndRequiredContext(goldCase, corpus) {
  const started = performance.now();
  const allowedForms = productionAllowedForms(goldCase);
  const modelParameters = formToolDefinitions(allowedForms);
  const validDraft = goldDraft(goldCase);
  const initialDraft = goldCase.initialDraft === "repairable-invalid"
    ? invalidDraftForRepair(goldCase.goldForm, validDraft)
    : validDraft;
  const initialValidation = validateKpFormDraft(goldCase.goldForm, initialDraft);
  let firstProgram = null;
  if (initialValidation.ok) firstProgram = compileKpFormDraft(goldCase.goldForm, initialDraft);
  const finalDraft = validateKpFormDraft(goldCase.goldForm, validDraft);
  const finalProgram = compileKpFormDraft(goldCase.goldForm, validDraft);
  const lowered = lowerCausalActionProgram(finalProgram);
  const staticRequiredRefs = goldCase.requiredRefs.filter((ref) => corpus.index.structuralRefs[ref] !== undefined);
  const dynamicRequiredRefs = goldCase.requiredRefs.filter((ref) => !staticRequiredRefs.includes(ref));
  const required = createRequiredContext(requiredContextInput(goldCase, dynamicRequiredRefs));
  const derivedRoute = routeFromProgram(goldCase, lowered);
  const derivedExecutable = derivedRoute !== "awaiting-input";
  return {
    allowedForms,
    modelParameters,
    validDraft,
    initialLegal: initialValidation.ok && firstProgram !== null,
    finalLegal: allowedForms.includes(goldCase.goldForm) && finalDraft.ok,
    finalProgram,
    lowered,
    routeMatch: allowedForms.includes(goldCase.goldForm)
      && derivedRoute === goldCase.expectedRoute
      && derivedExecutable === goldCase.expectedExecutable,
    derivedRoute,
    derivedExecutable,
    staticRequiredRefs,
    dynamicRequiredRefs,
    required,
    localLatencyMs: performance.now() - started,
  };
}

function productionAllowedForms(goldCase) {
  return selectAllowedKpForms(v3FormSelectionSignals({
    preparedActionId: `prepared:${goldCase.id}`,
    rootActionId: `root:${goldCase.id}`,
    input: {
      kind: "intent",
      submissionId: `submission:${goldCase.id}`,
      text: goldCase.intent,
    },
    projection: {},
    attempt: 1,
  }));
}

function evaluateG0(goldCase, common, corpus) {
  const started = performance.now();
  const projection = fullProjection(common.required, corpus);
  const variablePayload = {
    proposalAttempt: 1,
    action: { kind: "intent", submissionId: `submission:${goldCase.id}`, text: goldCase.intent },
    rulesDiagnostics: null,
    kpProjection: projection,
  };
  return caseResult({
    goldCase,
    common,
    schemaBytes: FROZEN_G0_SUPER_SCHEMA_BASELINE.schemaBytes,
    inputTokensEstimate: Math.ceil((
      FROZEN_G0_SUPER_SCHEMA_BASELINE.fixedRequestBytes + utf8Bytes(variablePayload)
    ) / 4),
    providedRefs: new Set(goldCase.requiredRefs),
    rank: 1,
    localLatencyMs: common.localLatencyMs + performance.now() - started,
    formMetricsApplicable: false,
  });
}

function evaluateG1(goldCase, common, corpus) {
  const started = performance.now();
  const input = {
    action: { kind: "intent", text: goldCase.intent },
    fullProjection: fullProjection(common.required, corpus),
    formParameters: common.modelParameters,
  };
  return caseResult({
    goldCase,
    common,
    schemaBytes: utf8Bytes(common.modelParameters),
    inputTokensEstimate: estimatedTokens(input),
    providedRefs: new Set(goldCase.requiredRefs),
    rank: 1,
    localLatencyMs: common.localLatencyMs + performance.now() - started,
    formMetricsApplicable: true,
  });
}

async function evaluateRetrievalGroup(input) {
  const started = performance.now();
  const request = retrievalRequestForCase(
    input.goldCase,
    input.common.staticRequiredRefs,
    input.planner,
    input.publicD1CoverTerms,
  );
  const d1SearchesBefore = input.fts.mode === "d1-fts" ? input.fts.snapshot().searches : 0;
  const baseHits = input.fts.mode === "d1-fts"
    ? await retrieveStaticReferencesFromD1(input.corpus.index, request, input.fts)
    : retrieveStaticReferences(input.corpus.index, request, input.fts);
  const vectorHits = input.vectorFts === undefined
    ? Object.freeze([])
    : retrieveStaticReferences(input.corpus.index, request, input.vectorFts);
  const hits = input.vectorFts === undefined
    ? baseHits
    : exactVectorRerank(baseHits, vectorHits);
  const d1Snapshot = input.fts.mode === "d1-fts" ? input.fts.snapshot() : null;
  const d1SearchExecuted = d1Snapshot !== null && d1Snapshot.searches === d1SearchesBefore + 1;
  const d1ReturnedRefs = new Set(d1SearchExecuted ? d1Snapshot.lastHitRefs : []);
  const retrieved = rehydrateStaticContext(hits, input.corpusReader, {
    allowedProfileRefs: input.allowedProfileRefs,
    allowKpOnly: true,
  });
  const contextPack = buildContextPack({
    required: input.common.required,
    retrieved,
    optional: [
      { ref: `voice:${input.goldCase.categoryCode}`, kind: "voice", body: "中文、克制、具体。", priority: 10 },
      { ref: `theme:${input.goldCase.categoryCode}`, kind: "theme", body: input.goldCase.category, priority: 5 },
    ],
    maxUnits: 16_000,
  });
  const orderedForms = input.planner?.suggestion?.orderedFormIds ?? input.common.allowedForms;
  const modelParameters = formToolDefinitions(orderedForms);
  const modelInput = {
    action: { kind: "intent", text: input.goldCase.intent },
    contextPack,
    formParameters: modelParameters,
    ...(input.planner === null ? {} : {
      planner: {
        orderedFormIds: input.planner.suggestion.orderedFormIds,
        queryTerms: input.planner.suggestion.queryTerms,
        receipt: input.planner.receipt,
      },
    }),
  };
  const providedRefs = new Set(input.common.dynamicRequiredRefs);
  const rehydratedRefs = new Set(retrieved.map((chunk) => chunk.sourceRef));
  for (const hit of hits) {
    if (!rehydratedRefs.has(hit.sourceRef)) continue;
    providedRefs.add(hit.sourceRef);
    hit.structuralRefs.forEach((ref) => providedRefs.add(ref));
    hit.dependencyRefs.forEach((ref) => providedRefs.add(ref));
  }
  const rank = targetRank(
    hits.filter((hit) => rehydratedRefs.has(hit.sourceRef)),
    input.common.staticRequiredRefs,
  );
  return Object.freeze({
    ...caseResult({
    goldCase: input.goldCase,
    common: input.common,
    schemaBytes: utf8Bytes(modelParameters),
    inputTokensEstimate: estimatedTokens(modelInput),
    providedRefs,
    rank,
    localLatencyMs: input.common.localLatencyMs + performance.now() - started,
    formMetricsApplicable: true,
    }),
    retrievalEvidence: Object.freeze({
      d1SearchExecuted,
      d1ReturnedHits: d1ReturnedRefs.size,
      d1ReturnedRefsRehydrated: count(retrieved, (chunk) => d1ReturnedRefs.has(chunk.sourceRef)),
      ftsRouteHits: count(hits, (hit) => hit.routes.includes("fts")),
      vectorCandidateHits: vectorHits.length,
      vectorReordered: hits.some((hit, index) => hit.sourceRef !== baseHits[index]?.sourceRef),
      authoritativeReReads: retrieved.length,
      nonEmptyAuthoritativeBodies: count(retrieved, (chunk) => chunk.body.length > 0),
    }),
  });
}

function exactVectorRerank(baseHits, vectorHits) {
  const vectorRank = new Map(vectorHits.map((hit, index) => [hit.sourceRef, index]));
  const baseRank = new Map(baseHits.map((hit, index) => [hit.sourceRef, index]));
  // Reranking never changes membership, so a dependency closure selected by
  // G3 cannot be truncated. The exact-vector arm affects ordering only.
  return Object.freeze([...baseHits].sort((left, right) =>
    (vectorRank.get(left.sourceRef) ?? Number.POSITIVE_INFINITY)
      - (vectorRank.get(right.sourceRef) ?? Number.POSITIVE_INFINITY)
    || baseRank.get(left.sourceRef) - baseRank.get(right.sourceRef)));
}

function caseResult(input) {
  const requiredHits = input.goldCase.requiredRefs.filter((ref) => input.providedRefs.has(ref)).length;
  const criticalHits = input.goldCase.criticalRefs.filter((ref) => input.providedRefs.has(ref)).length;
  return {
    id: input.goldCase.id,
    complexity: input.goldCase.complexity,
    goldForm: input.goldCase.goldForm,
    schemaBytes: input.schemaBytes,
    inputTokensEstimate: input.inputTokensEstimate,
    localLatencyMs: input.localLatencyMs,
    requiredHits,
    requiredTotal: input.goldCase.requiredRefs.length,
    criticalHits,
    criticalTotal: input.goldCase.criticalRefs.length,
    rank: input.rank,
    formMetricsApplicable: input.formMetricsApplicable,
    firstLegal: input.common.initialLegal,
    finalLegal: input.common.finalLegal,
    routeMatch: input.common.routeMatch,
    complexSimpleMisroute: input.goldCase.complexity === "complex" && input.goldCase.goldForm !== "compound.v1",
  };
}

function retrievalRequestForCase(goldCase, staticRequiredRefs, planner, publicD1CoverTerms) {
  const plannerTerms = planner?.suggestion?.queryTerms ?? [];
  const base = {
    plannerQueryTerms: plannerTerms,
    // This fixed cross-case cover is server-owned synthetic corpus metadata.
    // The current case's target/ref and player/KP/Planner prose never cross D1.
    publicD1QueryTerms: publicD1CoverTerms,
    limit: 8,
  };
  if (goldCase.retrievalMode === "structure") {
    return createStaticRetrievalRequest({ ...base, structuralRefs: staticRequiredRefs });
  }
  if (goldCase.retrievalMode === "alias") {
    return createStaticRetrievalRequest({ ...base, exactAliases: [goldCase.retrievalAlias] });
  }
  return createStaticRetrievalRequest({ ...base, queryText: goldCase.retrievalQuery });
}

function requiredContextInput(goldCase, dynamicRequiredRefs) {
  const dialogue = Array.from({ length: 12 }, (_, index) => ({
    messageRef: `dialogue:${goldCase.id}:${index + 1}`,
    speakerRef: index % 2 === 0 ? "character:alice" : "npc:warden",
    body: `与本次行动直接相关的第 ${index + 1} 条亲历中文对话。`,
    fictionalTimeRef: `fiction:${goldCase.id}:${index + 1}`,
  }));
  return {
    intent: { submissionRef: `submission:${goldCase.id}`, text: goldCase.intent },
    trustedControl: {
      characterRef: "character:alice",
      controllerRef: "user:alice",
      controlProofRef: `control-proof:${goldCase.id}`,
    },
    sceneDynamics: {
      sceneRef: `scene:${goldCase.id}`,
      worldHash: `world:${goldCase.id}:frozen`,
      dynamicRefs: dynamicRequiredRefs,
    },
    mechanics: {
      encounter: { active: goldCase.categoryCode === "combat" },
      turn: { ordinal: 3 },
      actionEconomy: { actionAvailable: true, reactionAvailable: true },
      position: { zoneRef: `zone:${goldCase.id}` },
      hp: { current: 17, maximum: 24 },
      resources: { primary: 3, secondary: 1 },
      conditions: [],
    },
    npcViews: [{
      npcRef: "npc:warden",
      knowledgeRefs: [`npc-knowledge:${goldCase.categoryCode}`],
      planRefs: [`npc-plan:${goldCase.categoryCode}`],
    }],
    temporal: {
      pendingRefs: [],
      activityRefs: goldCase.categoryCode === "activity" ? [`activity:${goldCase.id}`] : [],
      fictionalTime: { minute: 12 },
    },
    established: {
      factRefs: dynamicRequiredRefs,
      precedentRefs: [`precedent:${goldCase.categoryCode}`],
      dynamicDefinitionRefs: goldCase.categoryCode === "dynamic-fact" ? [`definition:${goldCase.id}`] : [],
    },
    bindings: {
      rulesRef: "dnd5e-2014-srd5.1-authoritative-v2",
      geometryRef: "geometry-profile-v1",
      moduleRef: "eval-module-profile-v1",
      eventRef: "room-event-profile-v2",
    },
    truthConstraintRefs: [`truth-constraint:${goldCase.categoryCode}`],
    contentBoundaries: ["boundary:no-graphic-gore"],
    recentDialogue: dialogue,
    recentDialogueLimit: 10,
  };
}

function fullProjection(required, corpus) {
  return {
    required,
    completeStaticCorpus: corpus.chunks.map((chunk) => ({
      sourceRef: chunk.sourceRef,
      body: chunk.body,
      profileRef: chunk.profileRef,
      sensitivity: chunk.sensitivity,
    })),
    experiencedTranscript: Array.from({ length: 48 }, (_, index) => ({
      messageRef: `full-history:${index + 1}`,
      body: `完整历史中的第 ${index + 1} 条中文消息，用于结构体积基线。`,
    })),
  };
}

function goldDraft(goldCase) {
  const basisRefs = [goldCase.requiredRefs[0]];
  const common = { goal: goldCase.intent, method: "按照玩家明确描述的方法在当前虚构中尝试" };
  switch (goldCase.goldForm) {
    case "clarification.v1":
      return { goal: goldCase.intent, question: "你要优先达成哪一个结果？", choices: ["优先第一目标", "优先第二目标"] };
    case "observe.v1":
      return {
        ...common,
        focus: "与意图直接相关的可感知细节",
        desiredInformation: "足以支持下一步决定的事实",
        resolution: "direct",
        durationUnit: "second",
        durationValue: 6,
        basisRefs,
      };
    case "npc-exchange.v1":
      return {
        ...common,
        utterance: goldCase.intent,
        desiredResponse: "NPC 依据有限知识作出可信回应",
        npcResponse: "NPC 只依据自身已经知道的事实作出回应。",
        resolution: "direct",
        durationUnit: "second",
        durationValue: 6,
        basisRefs,
      };
    case "ordinary-check.v1":
      return {
        ...common,
        intendedOutcome: "在合理成本内达成玩家目标",
        risk: "失败会消耗时间或资源",
        resolution: "check",
        ability: "dex",
        skill: "sleight",
        dc: 12,
        mode: "normal",
        durationUnit: "round",
        durationValue: 1,
        successConsequence: "行动按玩家的方法取得预期进展。",
        failureConsequence: "局势推进且产生已冻结的时间或资源后果。",
        basisRefs,
      };
    case "high-risk-action.v1":
      return {
        ...common,
        intendedOutcome: "承担风险后推进目标",
        risk: "失败产生不可忽略的世界后果",
        stakes: "局势、资源或人员安全会改变",
        resolution: "check",
        ability: "str",
        skill: "athletics",
        dc: 16,
        mode: "normal",
        durationUnit: "round",
        durationValue: 1,
        successConsequence: "角色承担风险并推进目标。",
        failureConsequence: "冻结的危险后果在世界中落实。",
        basisRefs,
      };
    case "in-world-refusal.v1":
      return {
        ...common,
        reason: "当前世界事实或资源不满足必要前提",
        alternatives: ["寻找缺失前提", "改用符合世界规律的方法"],
        durationUnit: "second",
        durationValue: 6,
        basisRefs,
      };
    case "materialization.v1":
      return {
        ...common,
        proposedFact: "固化一个符合场景用途且未被既有事实否定的普通物件",
        resolution: "direct",
        durationUnit: "second",
        durationValue: 6,
        basisRefs,
      };
    case "combat-action.v1":
      return {
        ...common,
        intendedOutcome: "在本回合取得战术优势",
        combatApproach: "使用当前装备、位置和行动经济执行",
        abilityRef: "ability:gold:current-equipped-action",
        basisRefs,
      };
    case "environmental-stunt.v1":
      if (goldCase.environmentScenario === "explicitly-absent") return {
        ...common,
        featureDescription: "玩家设想但当前权威场景明确不存在的环境要素",
        intendedOutcome: "改变地形或局势",
        featureDisposition: "explicitly-absent",
        basisRefs,
      };
      if (goldCase.environmentScenario === "reuse-check") return {
        ...common,
        featureDescription: "当前权威状态中已有稳定 ID 的自定义环境要素",
        intendedOutcome: "再次利用其当前阶段改变局势",
        featureDisposition: "reuse-existing",
        activation: "check",
        checkAbility: "int",
        checkSkill: "investigation",
        checkDc: 13,
        checkMode: "normal",
        checkSuccessConsequence: "既有要素按其冻结定义进入下一阶段。",
        checkFailureConsequence: "既有要素保持当前阶段，时间照常推进。",
        basisRefs,
      };
      if (goldCase.environmentScenario === "reuse-direct") return {
        ...common,
        featureDescription: "当前权威状态中已有稳定 ID 的自定义环境要素",
        intendedOutcome: "直接操作其既有机关改变局势",
        featureDisposition: "reuse-existing",
        activation: "direct",
        basisRefs,
      };
      return openBlankEnvironmentDraft(goldCase, common, basisRefs);
    case "compound.v1":
      return {
        ...common,
        stages: [
          { goal: "建立必要条件", method: "先完成意图中的前置步骤", intendedOutcome: "后续步骤可以合法执行", resolution: "direct" },
          { goal: "完成主要目标", method: "执行意图中的核心步骤", intendedOutcome: "产生可结算的世界结果", resolution: "direct" },
        ],
        intendedOutcome: "同一 RootAction 内形成有界因果结果",
        resolution: "direct",
        durationUnit: "round",
        durationValue: 1,
        basisRefs,
      };
    default:
      throw new Error(`KP_V3_EVAL_GOLD_FORM_UNSUPPORTED:${goldCase.goldForm}`);
  }
}

function openBlankEnvironmentDraft(goldCase, common, basisRefs) {
  const activation = goldCase.environmentScenario === "open-attack" ? "attack"
    : goldCase.environmentScenario === "open-direct" ? "direct"
      : "check";
  const effectMode = goldCase.environmentScenario === "open-direct"
    ? "state-only"
    : "area-hazard";
  const activationFields = activation === "attack"
    ? { attackApproach: "ranged", abilityRef: "ability:gold:current-equipped-action" }
    : activation === "check"
      ? {
          checkAbility: "int",
          checkSkill: "investigation",
          checkDc: 14,
          checkMode: "normal",
          checkSuccessConsequence: "玩家的方法触发了骰前冻结的环境变化。",
          checkFailureConsequence: "环境要素没有被成功触发，局势和时间照常推进。",
        }
      : {};
  const base = {
    ...common,
    featureDescription: `KP 根据本次任意描述定义的环境要素：${goldCase.intent}`,
    intendedOutcome: effectMode === "state-only"
      ? "按玩家的具体想法改变环境状态、通行与掩体，不凭空生成区域伤害"
      : "按玩家的具体想法改变局势，并由 Rules 计算实际影响范围",
    featureDisposition: "reasonable-open-blank",
    effectMode,
    activation,
    ...activationFields,
    material: "由 KP 依据场景与玩家方法即时裁定的复合材质",
    centerXInches: 120,
    centerYInches: -48,
    elevationInches: 36,
    widthInches: 72,
    depthInches: 24,
    heightInches: 84,
    objectAc: 12,
    objectHitPoints: 14,
    damageThreshold: 2,
    immuneDamageTypes: ["poison", "psychic"],
    initialPhase: "ready",
    phaseNames: effectMode === "state-only" ? ["ready", "changed"] : ["ready", "released", "debris"],
    phaseOpaque: effectMode === "state-only" ? [false, true] : [false, false, false],
    phaseImpassable: effectMode === "state-only" ? [false, true] : [false, false, true],
    phaseCover: effectMode === "state-only" ? ["none", "half"] : ["none", "none", "half"],
    phaseEffectPropagation: effectMode === "state-only"
      ? ["passes", "blocks"]
      : ["passes", "passes", "passes"],
    phaseTerrain: effectMode === "state-only" ? ["normal", "normal"] : ["normal", "normal", "rubble"],
    damageFromPhases: ["ready"],
    damageRemainingAtOrBelow: [0],
    damageToPhases: [effectMode === "state-only" ? "changed" : "released"],
    stuntFromPhases: ["ready"],
    stuntToPhases: [effectMode === "state-only" ? "changed" : "released"],
    trigger: "玩家描述的方法成功作用于该环境要素",
    basisRefs,
  };
  if (effectMode === "state-only") return base;
  return {
    ...base,
    hazardFromPhases: ["released"],
    hazardToPhases: ["debris"],
    hazardTriggerPhase: "released",
    hazardResolvedPhase: "debris",
    areaOriginElevationInches: 0,
    areaRadiusInches: 96,
    propagation: "straight",
    saveAbility: "dex",
    saveDc: 13,
    halfOnSuccess: false,
    damage: "2d6",
    damageType: "bludgeoning",
    condition: "prone",
    debrisOutcome: "残留物形成半掩护与瓦砾地形，后续继续使用同一稳定状态。",
  };
}

function invalidDraftForRepair(formId, validDraft) {
  const draft = structuredClone(validDraft);
  const requiredField = formId === "high-risk-action.v1" ? "stakes"
    : formId === "ordinary-check.v1" ? "risk"
      : formId === "compound.v1" ? "stages"
        : "goal";
  delete draft[requiredField];
  return draft;
}

function routeFromProgram(goldCase, lowered) {
  const primitives = new Set(lowered.steps.map((step) => step.primitive));
  if (primitives.has("requestClarification")) return "awaiting-input";
  if (primitives.has("refuseInWorld")) return "resolved-in-world";
  if (primitives.has("resolveCombatIntent")) return "combat";
  if (goldCase.categoryCode === "activity") return "activity";
  if (goldCase.categoryCode === "conclusion") return "conclusion";
  return "executable";
}

function summarizeGroup(groupId, description, caseResults, formMetricsApplicable) {
  const requiredHits = sum(caseResults.map((entry) => entry.requiredHits));
  const requiredTotal = sum(caseResults.map((entry) => entry.requiredTotal));
  const criticalHits = sum(caseResults.map((entry) => entry.criticalHits));
  const criticalTotal = sum(caseResults.map((entry) => entry.criticalTotal));
  const simple = caseResults.filter((entry) => entry.complexity === "simple");
  const compound = caseResults.filter((entry) => entry.complexity === "complex");
  const ranks = caseResults.map((entry) => entry.rank).filter((rank) => Number.isInteger(rank) && rank > 0);
  return Object.freeze({
    groupId,
    description,
    applicable: true,
    measurementKind: groupId === "G2" || groupId === "G3" || groupId === "G4"
      ? "offline-structural-with-local-retrieval"
      : "offline-structural-estimate",
    schemaBytes: distribution(caseResults.map((entry) => entry.schemaBytes), "bytes"),
    inputTokensEstimate: Object.freeze({
      ...distribution(caseResults.map((entry) => entry.inputTokensEstimate), "estimated tokens"),
      simpleP95: percentile(simple.map((entry) => entry.inputTokensEstimate), 0.95),
      estimator: "ceil(UTF-8 serialized request bytes / 4)",
    }),
    localOfflineExecutionLatencyMs: Object.freeze({
      ...distribution(caseResults.map((entry) => entry.localLatencyMs), "milliseconds"),
      providerLatency: null,
    }),
    retrieval: Object.freeze({
      requiredRecallAt8: ratioMetric(requiredHits, requiredTotal),
      criticalRecallAt8: ratioMetric(criticalHits, criticalTotal),
      meanReciprocalRank: ranks.length === 0 ? null : mean(ranks.map((rank) => 1 / rank)),
      rankedCases: ranks.length,
      totalCases: caseResults.length,
    }),
    forms: formMetricsApplicable ? Object.freeze({
      firstLegalOverall: ratioMetric(count(caseResults, (entry) => entry.firstLegal), caseResults.length),
      firstLegalSimple: ratioMetric(count(simple, (entry) => entry.firstLegal), simple.length),
      firstLegalCompound: ratioMetric(count(compound, (entry) => entry.firstLegal), compound.length),
      finalLegalAfterAtMostOneRepair: ratioMetric(count(caseResults, (entry) => entry.finalLegal), caseResults.length),
      repairCases: count(caseResults, (entry) => !entry.firstLegal),
    }) : null,
    routing: formMetricsApplicable ? Object.freeze({
      executableCoverage: ratioMetric(count(caseResults, (entry) => entry.routeMatch), caseResults.length),
      complexSimpleMisroutes: count(caseResults, (entry) => entry.complexSimpleMisroute),
      complexCases: compound.length,
      measurement: "gold-form compiler/lowering route; not live model form choice",
    }) : null,
  });
}

function optionalGainGate(base, candidate, baseCases, candidateCases) {
  const pairedDifferences = Object.freeze({
    requiredRecallAt8: pairedDifference(baseCases, candidateCases, (entry) => entry.requiredHits / entry.requiredTotal),
    criticalRecallAt8: pairedDifference(baseCases, candidateCases, (entry) => entry.criticalHits / entry.criticalTotal),
    firstLegal: pairedDifference(baseCases, candidateCases, (entry) => Number(entry.firstLegal)),
  });
  const inputMedianReduction = 1 - candidate.inputTokensEstimate.median / base.inputTokensEstimate.median;
  const inputP95Reduction = 1 - candidate.inputTokensEstimate.p95 / base.inputTokensEstimate.p95;
  const positivePairedQualityGain = Object.values(pairedDifferences).some((metric) => metric.ci95.low > 0);
  const inputGain = inputP95Reduction >= KP_V3_EVAL_THRESHOLDS.optionalExperimentMinimumInputReduction;
  const safetyStable = candidate.retrieval.criticalRecallAt8.rate >= base.retrieval.criticalRecallAt8.rate
    && candidate.forms.finalLegalAfterAtMostOneRepair.rate >= base.forms.finalLegalAfterAtMostOneRepair.rate
    && candidate.routing.executableCoverage.rate >= base.routing.executableCoverage.rate
    && candidate.routing.complexSimpleMisroutes <= base.routing.complexSimpleMisroutes;
  const structuralGainPassed = (positivePairedQualityGain || inputGain) && safetyStable;
  return Object.freeze({
    passed: false,
    adopted: false,
    structuralGainPassed,
    pairedDifferences,
    inputMedianReduction,
    inputP95Reduction,
    endToEndP95Reduction: null,
    safetyStable,
    operationalEvidence: "not-evaluated-offline",
    reason: structuralGainPassed
      ? "结构增益达到门槛，但缺少真实调用数、回退率和端到端证据，不具备采用资格。"
      : "相对 G2 的配对质量置信区间与输入降幅均未达到采用门。",
    thresholds: Object.freeze({
      pairedDifferenceCiLowerBound: 0,
      confidenceLevel: KP_V3_EVAL_THRESHOLDS.pairedConfidenceLevel,
      minimumInputOrEndToEndP95Reduction: KP_V3_EVAL_THRESHOLDS.optionalExperimentMinimumInputReduction,
    }),
  });
}

function pairedDifference(baseCases, candidateCases, valueOf) {
  if (baseCases.length !== candidateCases.length || baseCases.length === 0) {
    throw new Error("KP_V3_EVAL_PAIRED_CASES_INVALID");
  }
  const candidateById = new Map(candidateCases.map((entry) => [entry.id, entry]));
  const differences = baseCases.map((baseEntry) => {
    const candidateEntry = candidateById.get(baseEntry.id);
    if (candidateEntry === undefined) throw new Error(`KP_V3_EVAL_PAIRED_CASE_MISSING:${baseEntry.id}`);
    return valueOf(candidateEntry) - valueOf(baseEntry);
  });
  const difference = mean(differences);
  const variance = differences.length <= 1
    ? 0
    : sum(differences.map((value) => (value - difference) ** 2)) / (differences.length - 1);
  const margin = 1.959963984540054 * Math.sqrt(variance / differences.length);
  return Object.freeze({
    numerator: sum(differences),
    denominator: differences.length,
    difference,
    improved: count(differences, (value) => value > 0),
    regressed: count(differences, (value) => value < 0),
    tied: count(differences, (value) => value === 0),
    ci95: Object.freeze({ low: difference - margin, high: difference + margin }),
  });
}

async function evaluateFaultInjection({ goldCase, corpus, registry, d1Adapter, publicD1CoverTerms }) {
  const allowedForms = productionAllowedForms(goldCase);
  const program = compileKpFormDraft(goldCase.goldForm, goldDraft(goldCase));
  const required = createRequiredContext(requiredContextInput(goldCase, [goldCase.requiredRefs[0], goldCase.requiredRefs[2]]));
  const frozen = Object.freeze({
    intent: goldCase.intent,
    world: stableStructuralHash(required.sceneDynamics),
    resource: stableStructuralHash(required.mechanics.resources),
    fictionalTime: stableStructuralHash(required.temporal.fictionalTime),
    semanticHash: program.semanticHash,
  });
  const beforeFrozen = structuredClone(frozen);
  const request = createStaticRetrievalRequest({
    structuralRefs: [goldCase.requiredRefs[1]],
    queryText: goldCase.retrievalQuery,
    publicD1QueryTerms: publicD1CoverTerms,
    limit: 8,
  });
  const deterministic = () => retrieveStaticReferences(
    corpus.index,
    request,
    createDeterministicFtsAdapter(corpus.index),
  );
  const stages = [];

  const failingPlanner = Object.freeze({
    mode: "deterministic",
    profileRef: "context-planner-deterministic-v1",
    async plan() { throw new Error("injected planner failure"); },
  });
  const plannerResult = await runContextPlanner({
    registry,
    pinnedPrimaryKpProfileRef: "eval:primary-kp",
    adapter: failingPlanner,
    plannerInput: {
      rootActionRef: `root:${goldCase.id}:fault`,
      allowedFormIds: allowedForms,
      structuralRefs: [goldCase.requiredRefs[1]],
      baseQueryTerms: [goldCase.retrievalQuery],
    },
  });
  stages.push(faultResult({
    stage: "planner",
    productionAdapterAvailable: true,
    beforeFrozen,
    afterFrozen: frozen,
    fallbackA: plannerResult.suggestion,
    fallbackB: (await runContextPlanner({
      registry,
      pinnedPrimaryKpProfileRef: "eval:primary-kp",
      adapter: createDeterministicPlannerAdapter(),
      plannerInput: {
        rootActionRef: `root:${goldCase.id}:fault`,
        allowedFormIds: allowedForms,
        structuralRefs: [goldCase.requiredRefs[1]],
        baseQueryTerms: [goldCase.retrievalQuery],
      },
    })).suggestion,
    fallbackUsed: plannerResult.receipt.fallbackUsed,
  }));

  try {
    await retrieveStaticReferencesFromD1(corpus.index, request, {
      mode: "d1-fts",
      allowKpOnly: d1Adapter.allowKpOnly,
      async search() { throw new Error("injected rag failure"); },
    });
  } catch {
    const fallback = deterministic();
    stages.push(faultResult({
      stage: "rag",
      productionAdapterAvailable: true,
      beforeFrozen,
      afterFrozen: frozen,
      fallbackA: fallback,
      fallbackB: deterministic(),
      fallbackUsed: true,
    }));
  }
  for (const stage of ["embedding", "vector", "rerank"]) {
    try {
      if (stage === "rerank") throw new Error("injected rerank failure");
      retrieveStaticReferences(corpus.index, request, {
        mode: "deterministic",
        search() { throw new Error(`injected ${stage} failure`); },
      });
    } catch {
      stages.push(faultResult({
        stage,
        productionAdapterAvailable: false,
        beforeFrozen,
        afterFrozen: frozen,
        fallbackA: deterministic(),
        fallbackB: deterministic(),
        fallbackUsed: true,
      }));
    }
  }
  return Object.freeze({
    cases: Object.freeze(stages),
    passCount: count(stages, (stage) => stage.pass),
    totalCount: stages.length,
    safeFallbackRate: ratioMetric(count(stages, (stage) => stage.pass), stages.length),
  });
}

function faultResult(input) {
  const before = stableStructuralHash(input.beforeFrozen);
  const after = stableStructuralHash(input.afterFrozen);
  const fields = Object.freeze({
    intent: input.beforeFrozen.intent === input.afterFrozen.intent,
    world: input.beforeFrozen.world === input.afterFrozen.world,
    resource: input.beforeFrozen.resource === input.afterFrozen.resource,
    fictionalTime: input.beforeFrozen.fictionalTime === input.afterFrozen.fictionalTime,
    semanticHash: input.beforeFrozen.semanticHash === input.afterFrozen.semanticHash,
  });
  const deterministicFallback = stableStructuralHash(input.fallbackA) === stableStructuralHash(input.fallbackB);
  const frozenUnchanged = before === after && Object.values(fields).every(Boolean);
  return Object.freeze({
    stage: input.stage,
    injected: true,
    productionAdapterAvailable: input.productionAdapterAvailable,
    fallback: "production deterministic static retrieval/planner",
    fallbackUsed: input.fallbackUsed,
    deterministicFallback,
    frozenFieldsUnchanged: fields,
    beforeHash: before,
    afterHash: after,
    pass: input.fallbackUsed && deterministicFallback && frozenUnchanged,
  });
}

function hardGateReport({ fixture, groups, faultInjection }) {
  const G0 = groups.G0;
  const G2 = groups.G2;
  const schemaReduction = 1 - G2.schemaBytes.median / G0.schemaBytes.median;
  const inputReduction = 1 - G2.inputTokensEstimate.median / G0.inputTokensEstimate.median;
  return [
    gate("exact-120-cases", fixture.cases.length === 120, fixture.cases.length, 120),
    gate("critical-ref-recall-at-8", G2.retrieval.criticalRecallAt8.rate >= KP_V3_EVAL_THRESHOLDS.criticalRecallAt8, G2.retrieval.criticalRecallAt8, KP_V3_EVAL_THRESHOLDS.criticalRecallAt8),
    gate("required-ref-recall-at-8", G2.retrieval.requiredRecallAt8.rate >= KP_V3_EVAL_THRESHOLDS.requiredRecallAt8, G2.retrieval.requiredRecallAt8, KP_V3_EVAL_THRESHOLDS.requiredRecallAt8),
    gate("simple-first-legal", G2.forms.firstLegalSimple.rate >= KP_V3_EVAL_THRESHOLDS.simpleFirstLegal, G2.forms.firstLegalSimple, KP_V3_EVAL_THRESHOLDS.simpleFirstLegal),
    gate("compound-first-legal", G2.forms.firstLegalCompound.rate >= KP_V3_EVAL_THRESHOLDS.compoundFirstLegal, G2.forms.firstLegalCompound, KP_V3_EVAL_THRESHOLDS.compoundFirstLegal),
    gate("final-legal-after-one-repair", G2.forms.finalLegalAfterAtMostOneRepair.rate >= KP_V3_EVAL_THRESHOLDS.finalLegal, G2.forms.finalLegalAfterAtMostOneRepair, KP_V3_EVAL_THRESHOLDS.finalLegal),
    gate("executable-route-coverage", G2.routing.executableCoverage.rate >= KP_V3_EVAL_THRESHOLDS.executableRouteCoverage, G2.routing.executableCoverage, KP_V3_EVAL_THRESHOLDS.executableRouteCoverage),
    gate("complex-simple-misroutes", G2.routing.complexSimpleMisroutes <= KP_V3_EVAL_THRESHOLDS.maximumComplexSimpleMisroutes, G2.routing.complexSimpleMisroutes, KP_V3_EVAL_THRESHOLDS.maximumComplexSimpleMisroutes),
    gate("schema-median-reduction", schemaReduction >= KP_V3_EVAL_THRESHOLDS.minimumSchemaMedianReductionFromG0, schemaReduction, KP_V3_EVAL_THRESHOLDS.minimumSchemaMedianReductionFromG0),
    gate("input-median-reduction", inputReduction >= KP_V3_EVAL_THRESHOLDS.minimumInputMedianReductionFromG0, inputReduction, KP_V3_EVAL_THRESHOLDS.minimumInputMedianReductionFromG0),
    gate("simple-input-p95-estimate", G2.inputTokensEstimate.simpleP95 <= KP_V3_EVAL_THRESHOLDS.maximumSimpleInputP95Estimate, G2.inputTokensEstimate.simpleP95, KP_V3_EVAL_THRESHOLDS.maximumSimpleInputP95Estimate),
    gate("overall-input-p95-estimate", G2.inputTokensEstimate.p95 <= KP_V3_EVAL_THRESHOLDS.maximumOverallInputP95Estimate, G2.inputTokensEstimate.p95, KP_V3_EVAL_THRESHOLDS.maximumOverallInputP95Estimate),
    gate(
      "g2-local-d1-fts-write-match-rehydrate",
      G2.retrievalExecution.corpusCurrentAfterWrite
        && G2.retrievalExecution.publicCorpusRowsWritten > 0
        && G2.retrievalExecution.storedChunkRows === G2.retrievalExecution.publicCorpusRowsWritten
        && G2.retrievalExecution.storedFtsRows === G2.retrievalExecution.publicCorpusRowsWritten
        && G2.retrievalExecution.ftsWriteExecutions === G2.retrievalExecution.publicCorpusRowsWritten
        && G2.retrievalExecution.matchExecutions.numerator === fixture.cases.length
        && G2.retrievalExecution.matchExecutions.failures === 0
        && G2.retrievalExecution.distinctMatchBindingHashes === 1
        && G2.retrievalExecution.storedKpOnlyRows === 0
        && G2.retrievalExecution.storedBodyBytes === 0
        && G2.retrievalExecution.d1ReturnedRefsRehydrated > 0
        && G2.retrievalExecution.authoritativeReReads === G2.retrievalExecution.nonEmptyAuthoritativeBodies,
      G2.retrievalExecution,
      "public-only FTS5 write + 120 SQL MATCH + non-empty authoritative re-read",
    ),
    gate(
      "g3-unvalidated-planner-not-generalized",
      groups.G3.plannerQualification.status === "unvalidated"
        && groups.G3.plannerQualification.realSupportedCandidateCount === 0
        && groups.G3.plannerQualification.generalizableToModelPlanner === false
        && groups.G3.plannerQualification.productionEnabled === false,
      groups.G3.plannerQualification,
      "no supported live Planner; deterministic proxy unqualified and disabled",
    ),
    gate(
      "g4-local-exact-vector-executed",
      groups.G4.vectorExecution.profile === LOCAL_EMBEDDING_PROFILE
        && groups.G4.vectorExecution.metric === "exact-cosine"
        && groups.G4.vectorExecution.indexKind === "brute-force-no-ann"
        && groups.G4.vectorExecution.searches === fixture.cases.length
        && groups.G4.vectorExecution.exactComparisons === fixture.cases.length * (fixture.categories.length + 1)
        && groups.G4.vectorExecution.casesWithVectorReordering > 0
        && groups.G4.vectorExecution.evaluatorOnly
        && groups.G4.vectorExecution.productionEnabled === false,
      groups.G4.vectorExecution,
      "120 raw-query character TF-IDF exact-cosine scans; evaluator-only",
    ),
    gate("fault-injection-safe-fallback", faultInjection.safeFallbackRate.rate === 1, faultInjection.safeFallbackRate, 1),
  ];
}

function gate(id, pass, observed, threshold) {
  return Object.freeze({ id, pass, observed, threshold });
}

function fixtureCoverage(fixture) {
  return Object.freeze({
    total: fixture.cases.length,
    categories: Object.freeze(Object.fromEntries(fixture.categories.map((category) => [
      category.label,
      fixture.cases.filter((goldCase) => goldCase.categoryCode === category.code).length,
    ]))),
    complexity: Object.freeze({
      simple: fixture.cases.filter((goldCase) => goldCase.complexity === "simple").length,
      complex: fixture.cases.filter((goldCase) => goldCase.complexity === "complex").length,
    }),
    forms: Object.freeze(Object.fromEntries(KP_FORM_IDS.map((formId) => [
      formId,
      fixture.cases.filter((goldCase) => goldCase.goldForm === formId).length,
    ]))),
    environmentScenarios: Object.freeze(Object.fromEntries(
      [...new Set(fixture.cases.flatMap((goldCase) =>
        typeof goldCase.environmentScenario === "string" ? [goldCase.environmentScenario] : []))]
        .sort()
        .map((scenario) => [
          scenario,
          fixture.cases.filter((goldCase) => goldCase.environmentScenario === scenario).length,
        ]),
    )),
    repairableInitialDrafts: fixture.cases.filter((goldCase) => goldCase.initialDraft === "repairable-invalid").length,
  });
}

function evaluationModelRegistry() {
  return createModelProfileRegistry([
    {
      profileRef: "eval:primary-kp",
      provider: "offline-eval",
      modelId: "no-live-provider",
      modelRevision: "structural-v1",
      supportedRoles: ["primary-kp"],
      validationSuiteVersion: "kp-v3-structural-eval-v1",
      validationStatus: "passed",
      structuredOutputMode: "strict-tool",
      contextWindowTokens: 128_000,
      latencyTier: "local",
      costTier: "free",
    },
  ]);
}

class LocalD1EvaluationStatement {
  constructor(owner, sql, values = []) {
    this.owner = owner;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new LocalD1EvaluationStatement(this.owner, this.sql, values);
  }

  async run() {
    return this.runSync();
  }

  async all() {
    this.owner.recordExecution(this.sql, this.values);
    return {
      success: true,
      results: this.owner.database.prepare(this.sql).all(...this.values),
    };
  }

  runSync() {
    this.owner.recordExecution(this.sql, this.values);
    const result = this.owner.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class LocalD1EvaluationDatabase {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.statementExecutions = 0;
    this.ftsMatchExecutions = 0;
    this.ftsWriteExecutions = 0;
    this.matchBindingHashes = new Set();
    this.database.exec(`
CREATE TABLE kp_static_chunks (
  source_ref TEXT PRIMARY KEY NOT NULL,
  source_hash TEXT NOT NULL,
  source_span TEXT NOT NULL,
  profile_ref TEXT NOT NULL,
  corpus_profile_ref TEXT,
  corpus_profile_hash TEXT,
  corpus_hash TEXT,
  sensitivity TEXT NOT NULL,
  dependency_refs TEXT NOT NULL,
  structural_refs TEXT,
  aliases TEXT NOT NULL,
  purpose TEXT NOT NULL,
  source_type TEXT,
  body TEXT NOT NULL,
  search_text TEXT NOT NULL,
  rebuilt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_kp_static_chunks_profile ON kp_static_chunks(profile_ref);
CREATE INDEX idx_kp_static_chunks_hash ON kp_static_chunks(source_hash);
CREATE TABLE kp_static_corpus_profiles (
  profile_ref TEXT PRIMARY KEY NOT NULL,
  profile_hash TEXT NOT NULL,
  corpus_hash TEXT,
  compiler_version TEXT,
  chunk_count INTEGER NOT NULL,
  rebuilt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
${KP_STATIC_FTS_SCHEMA_SQL};
`);
  }

  prepare(sql) {
    return new LocalD1EvaluationStatement(this, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => {
        if (!(statement instanceof LocalD1EvaluationStatement) || statement.owner !== this) {
          throw new Error("KP_V3_EVAL_D1_STATEMENT_OWNER_INVALID");
        }
        return statement.runSync();
      });
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  recordExecution(sql, values) {
    this.statementExecutions += 1;
    if (/\bMATCH\s+\?/u.test(sql)) {
      this.ftsMatchExecutions += 1;
      this.matchBindingHashes.add(stableStructuralHash(values));
    }
    if (/INSERT\s+INTO\s+kp_static_chunks_fts/iu.test(sql)) this.ftsWriteExecutions += 1;
  }

  snapshot() {
    const scalar = (sql) => Number(this.database.prepare(sql).get().value ?? 0);
    return Object.freeze({
      engine: "node:sqlite-fts5",
      adapterContract: "D1CorpusDatabase-shim",
      cloudflareD1Runtime: false,
      storage: "isolated-in-memory",
      statementExecutions: this.statementExecutions,
      ftsMatchExecutions: this.ftsMatchExecutions,
      ftsWriteExecutions: this.ftsWriteExecutions,
      distinctMatchBindingHashes: this.matchBindingHashes.size,
      storedChunkRows: scalar("SELECT COUNT(*) AS value FROM kp_static_chunks"),
      storedFtsRows: scalar("SELECT COUNT(*) AS value FROM kp_static_chunks_fts"),
      storedKpOnlyRows: scalar("SELECT COUNT(*) AS value FROM kp_static_chunks WHERE sensitivity = 'kp-only'"),
      storedBodyBytes: scalar("SELECT COALESCE(SUM(length(CAST(body AS BLOB))), 0) AS value FROM kp_static_chunks"),
    });
  }

  close() {
    this.database.close();
  }
}

function createLocalD1EvaluationDatabase() {
  return new LocalD1EvaluationDatabase();
}

function createMeasuredD1Adapter(adapter, localDatabase) {
  let searches = 0;
  let sqlMatchExecutions = 0;
  let failures = 0;
  let returnedHits = 0;
  let lastHitRefs = Object.freeze([]);
  return Object.freeze({
    mode: "d1-fts",
    allowKpOnly: adapter.allowKpOnly,
    isCurrent: (corpus) => adapter.isCurrent(corpus),
    upsert: (corpus) => adapter.upsert(corpus),
    rebuild: (corpus) => adapter.rebuild(corpus),
    async search(query) {
      searches += 1;
      const sqlMatchesBefore = localDatabase.ftsMatchExecutions;
      try {
        const hits = await adapter.search(query);
        sqlMatchExecutions += localDatabase.ftsMatchExecutions - sqlMatchesBefore;
        returnedHits += hits.length;
        lastHitRefs = Object.freeze(hits.map((hit) => hit.sourceRef));
        return hits;
      } catch (error) {
        sqlMatchExecutions += localDatabase.ftsMatchExecutions - sqlMatchesBefore;
        failures += 1;
        lastHitRefs = Object.freeze([]);
        throw error;
      }
    },
    snapshot() {
      return Object.freeze({
        searches,
        sqlMatchExecutions,
        failures,
        returnedHits,
        lastHitRefs,
      });
    },
  });
}

/** Builds a deterministic character TF-IDF embedding and performs exact cosine
 * search. This is an evaluator-only numeric vector baseline, not a semantic
 * provider embedding and not an overlap score over production search terms. */
export function createDeterministicLocalVectorIndex(documents) {
  if (!Array.isArray(documents) || documents.length === 0
    || documents.some((document) => typeof document?.sourceRef !== "string"
      || document.sourceRef.length === 0 || typeof document.text !== "string")) {
    throw new Error("KP_V3_EVAL_VECTOR_DOCUMENTS_INVALID");
  }
  const ordered = [...documents].sort((left, right) => left.sourceRef.localeCompare(right.sourceRef));
  if (new Set(ordered.map((document) => document.sourceRef)).size !== ordered.length) {
    throw new Error("KP_V3_EVAL_VECTOR_SOURCE_REF_DUPLICATE");
  }
  const scalarsByDocument = ordered.map((document) => unicodeScalarCounts(document.text));
  const vocabulary = [...new Set(scalarsByDocument.flatMap((counts) => [...counts.keys()]))].sort();
  const vocabularyIndex = new Map(vocabulary.map((scalar, index) => [scalar, index]));
  const inverseDocumentFrequency = Float64Array.from(vocabulary, (scalar) => {
    const documentFrequency = count(scalarsByDocument, (counts) => counts.has(scalar));
    return Math.log((1 + ordered.length) / (1 + documentFrequency)) + 1;
  });
  const vectorize = (text) => normalizedTfIdfVector(
    unicodeScalarCounts(text),
    vocabularyIndex,
    inverseDocumentFrequency,
  );
  const embedded = ordered.map((document, index) => Object.freeze({
    sourceRef: document.sourceRef,
    vector: normalizedTfIdfVector(
      scalarsByDocument[index],
      vocabularyIndex,
      inverseDocumentFrequency,
    ),
  }));
  return Object.freeze({
    profile: LOCAL_EMBEDDING_PROFILE,
    dimensions: vocabulary.length,
    vectorize,
    search(queryText, limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 32) {
        throw new Error("KP_V3_EVAL_VECTOR_LIMIT_INVALID");
      }
      const queryVector = vectorize(queryText);
      return Object.freeze(embedded
        .map((entry) => Object.freeze({
          sourceRef: entry.sourceRef,
          score: exactCosineSimilarity(queryVector, entry.vector),
        }))
        .filter((hit) => hit.score > 0)
        .sort((left, right) => right.score - left.score || left.sourceRef.localeCompare(right.sourceRef))
        .slice(0, limit));
    },
  });
}

export function exactCosineSimilarity(left, right) {
  if (!(left instanceof Float64Array) || !(right instanceof Float64Array)
    || left.length !== right.length || left.length === 0) {
    throw new Error("KP_V3_EVAL_EMBEDDING_VECTOR_INVALID");
  }
  let dot = 0;
  let leftMagnitudeSquared = 0;
  let rightMagnitudeSquared = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitudeSquared += left[index] ** 2;
    rightMagnitudeSquared += right[index] ** 2;
  }
  if (leftMagnitudeSquared === 0 || rightMagnitudeSquared === 0) return 0;
  return dot / Math.sqrt(leftMagnitudeSquared * rightMagnitudeSquared);
}

function unicodeScalarCounts(text) {
  const counts = new Map();
  for (const scalar of String(text).normalize("NFKC").toLowerCase()) {
    if (!/[\p{Letter}\p{Number}]/u.test(scalar)) continue;
    counts.set(scalar, (counts.get(scalar) ?? 0) + 1);
  }
  return counts;
}

function normalizedTfIdfVector(counts, vocabularyIndex, inverseDocumentFrequency) {
  const vector = new Float64Array(vocabularyIndex.size);
  for (const [scalar, frequency] of counts) {
    const index = vocabularyIndex.get(scalar);
    if (index !== undefined) vector[index] = (1 + Math.log(frequency)) * inverseDocumentFrequency[index];
  }
  let magnitudeSquared = 0;
  for (const value of vector) magnitudeSquared += value ** 2;
  const magnitude = Math.sqrt(magnitudeSquared);
  if (magnitude > 0) {
    for (let index = 0; index < vector.length; index += 1) vector[index] /= magnitude;
  }
  return vector;
}

function createLocalExactVectorAdapter(corpus) {
  const index = createDeterministicLocalVectorIndex(corpus.chunks.map((chunk) => ({
    sourceRef: chunk.sourceRef,
    text: `${chunk.body}\n${chunk.aliases.join("\n")}`,
  })));
  let searches = 0;
  let exactComparisons = 0;
  let returnedHits = 0;
  return Object.freeze({
    adapterFor(rawQueryText) {
      return Object.freeze({
        mode: "deterministic",
        search(query) {
          searches += 1;
          exactComparisons += corpus.chunks.length;
          const hits = index.search(rawQueryText, query.limit);
          returnedHits += hits.length;
          return hits;
        },
      });
    },
    snapshot() {
      return Object.freeze({
        profile: index.profile,
        dimensions: index.dimensions,
        numericType: "Float64Array",
        metric: "exact-cosine",
        indexKind: "brute-force-no-ann",
        sourceInput: "authoritative chunk body plus aliases",
        queryInput: "raw fixture retrievalQuery plus non-structural deterministic Planner free text",
        searches,
        exactComparisons,
        returnedHits,
      });
    },
  });
}

function targetRank(hits, staticRequiredRefs) {
  if (staticRequiredRefs.length === 0) return 1;
  const index = hits.findIndex((hit) => staticRequiredRefs.some((ref) => hit.structuralRefs.includes(ref)));
  return index < 0 ? null : index + 1;
}

function ratioMetric(numerator, denominator) {
  const rate = denominator === 0 ? null : numerator / denominator;
  return Object.freeze({
    numerator,
    denominator,
    rate,
    wilson95: denominator === 0 ? null : wilson95(numerator, denominator),
  });
}

export function wilson95(successes, total) {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || successes < 0 || total <= 0 || successes > total) {
    throw new Error("KP_V3_EVAL_WILSON_INPUT_INVALID");
  }
  const z = 1.959963984540054;
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator;
  return Object.freeze({ low: Math.max(0, center - margin), high: Math.min(1, center + margin) });
}

function distribution(values, unit) {
  return Object.freeze({
    count: values.length,
    unit,
    min: Math.min(...values),
    median: percentile(values, 0.5),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  });
}

function percentile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

function estimatedTokens(value) {
  return Math.ceil(utf8Bytes(value) / 4);
}

function utf8Bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function count(values, predicate) {
  return values.reduce((total, value) => total + (predicate(value) ? 1 : 0), 0);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values) {
  return values.length === 0 ? null : sum(values) / values.length;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cliOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--fixture") options.fixturePath = argv[++index];
    else if (argv[index] !== "--compact") throw new Error(`Unknown argument: ${argv[index]}`);
  }
  options.compact = argv.includes("--compact");
  return options;
}

const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
async function main() {
  const options = cliOptions(process.argv.slice(2));
  const report = await runKpV3Evaluation(options);
  process.stdout.write(`${JSON.stringify(report, null, options.compact ? 0 : 2)}\n`);
  if (report.status !== "pass") process.exitCode = 1;
}

if (isMain) await main();
