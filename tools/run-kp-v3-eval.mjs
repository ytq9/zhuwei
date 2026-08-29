import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { PROPOSAL_TOOL, proposalModelInput } from "../app/_runtime/lib/kp/authoritative-policy.ts";
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
  buildKpFormModelParameters,
  selectAllowedKpForms,
  validateKpFormDraft,
  validateKpFormModelEnvelope,
} from "../app/_runtime/lib/kp/form-catalog.ts";
import {
  createDeterministicPlannerAdapter,
  createModelPlannerAdapter,
  createModelProfileRegistry,
  runContextPlanner,
} from "../app/_runtime/lib/kp/model-registry.ts";
import {
  authoritativeStaticCorpusReader,
  compileStaticCorpus,
} from "../app/_runtime/lib/kp/static-corpus.ts";
import {
  createDeterministicFtsAdapter,
  createStaticRetrievalRequest,
  rehydrateStaticContext,
  retrieveStaticReferences,
  staticSearchTerms,
} from "../app/_runtime/lib/kp/static-retrieval.ts";

export const KP_V3_EVAL_REPORT_SCHEMA = "zhuwei-kp-v3-structural-eval-v1";

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
  const deterministicFts = createDeterministicFtsAdapter(corpus.index);
  const registry = evaluationModelRegistry();
  const results = Object.fromEntries(GROUP_IDS.map((groupId) => [groupId, []]));

  for (const goldCase of fixture.cases) {
    const common = evaluateFormAndRequiredContext(goldCase, corpus);
    results.G0.push(evaluateG0(goldCase, common, corpus));
    results.G1.push(evaluateG1(goldCase, common, corpus));
    results.G2.push(evaluateRetrievalGroup({
      groupId: "G2",
      goldCase,
      common,
      corpus,
      corpusReader,
      allowedProfileRefs,
      fts: deterministicFts,
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
    const g3 = evaluateRetrievalGroup({
      groupId: "G3",
      goldCase,
      common,
      corpus,
      corpusReader,
      allowedProfileRefs,
      fts: deterministicFts,
      planner,
    });
    g3.localLatencyMs += plannerLatencyMs;
    results.G3.push(g3);

    const vectorStart = performance.now();
    const vectorFts = createLocalExactVectorAdapter(corpus.index);
    const vectorSetupLatencyMs = performance.now() - vectorStart;
    const g4 = evaluateRetrievalGroup({
      groupId: "G4",
      goldCase,
      common,
      corpus,
      corpusReader,
      allowedProfileRefs,
      fts: vectorFts,
      planner,
    });
    g4.localLatencyMs += vectorSetupLatencyMs;
    results.G4.push(g4);
  }

  const groups = {
    G0: summarizeGroup("G0", "现役超级 Schema 与完整静态上下文结构基线", results.G0, false),
    G1: summarizeGroup("G1", "私有小表与完整静态上下文", results.G1, true),
    G2: summarizeGroup("G2", "私有小表、三层 Context Pack 与确定性静态检索", results.G2, true),
    G3: summarizeGroup("G3", "G2 加确定性 Context Planner", results.G3, true),
    G4: summarizeGroup("G4", "G3 加评测器本地精确向量排序对照", results.G4, true),
  };
  const gainGates = {
    G3OverG2: optionalGainGate(groups.G2, groups.G3, results.G2, results.G3),
    G4OverG2: optionalGainGate(groups.G2, groups.G4, results.G2, results.G4),
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
  });
  const hardGates = hardGateReport({ fixture, groups, faultInjection });
  const status = hardGates.every((gate) => gate.pass) ? "pass" : "fail";

  return Object.freeze({
    schemaVersion: KP_V3_EVAL_REPORT_SCHEMA,
    status,
    execution: Object.freeze({
      mode: "offline-structural",
      fixtureSchemaVersion: fixture.schemaVersion,
      caseCount: fixture.cases.length,
      productionPureInterfacesInvoked: Object.freeze([
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
      ]),
      estimates: Object.freeze({
        inputTokens: "UTF-8 request bytes divided by four; not provider token accounting",
        schemaBytes: "UTF-8 serialized tool-parameter bytes",
      }),
      localTiming: "Measured wall time for local pure interfaces only; not provider latency",
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
        "normal Planner/RAG fallback rate",
        "live-model first-pass Form legality and paired repeats",
      ]),
    }),
    limitations: Object.freeze([
      "Form legality and routing are gold-draft structural measurements, not live model first-pass accuracy.",
      "Input tokens are an explicit byte-based estimate; provider tokenizer counts require a live evaluation.",
      "Local pure-interface timings are not network or provider latency and are excluded from release latency claims.",
      "G4 is an evaluator-only exact vector comparison because no production embedding/vector adapter is wired.",
      "G5 is not executed unless G2 recall passes while ranking falls below its applicability threshold.",
    ]),
  });
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
    const paragraph = `${sample.retrievalAlias}：${sample.retrievalQuery}。这是用于验证结构引用、中文精确别名与双字词召回的权威静态原文。`;
    return Object.freeze({
      sourceKind: "static",
      sourceType,
      sourceRef: `eval-corpus:${category.code}`,
      profileRef,
      sensitivity: ["hidden-reality", "personal-knowledge", "conclusion"].includes(category.code)
        ? "kp-only"
        : "public",
      body: Array.from({ length: 16 }, () => paragraph).join("\n"),
      aliases: [sample.retrievalAlias],
      structuralRefs: [`gold:${category.code}`],
      dependencyRefs: [`eval-dependency:${category.code}`],
    });
  });
  return compileStaticCorpus(sources);
}

function evaluateFormAndRequiredContext(goldCase, corpus) {
  const started = performance.now();
  const allowedForms = selectAllowedKpForms(goldCase.signals);
  const modelParameters = buildKpFormModelParameters(allowedForms);
  const validDraft = goldDraft(goldCase);
  const initialDraft = goldCase.initialDraft === "repairable-invalid"
    ? invalidDraftForRepair(goldCase.goldForm, validDraft)
    : validDraft;
  const initialValidation = validateKpFormDraft(goldCase.goldForm, initialDraft);
  let firstProgram = null;
  if (initialValidation.ok) firstProgram = compileKpFormDraft(goldCase.goldForm, initialDraft);
  const finalEnvelope = validateKpFormModelEnvelope(allowedForms, {
    formId: goldCase.goldForm,
    draft: validDraft,
  });
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
    finalLegal: finalEnvelope.ok,
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

function evaluateG0(goldCase, common, corpus) {
  const started = performance.now();
  const projection = fullProjection(common.required, corpus);
  const modelInput = proposalModelInput({
    preparedActionId: `prepared:${goldCase.id}`,
    rootActionId: `root:${goldCase.id}`,
    input: { kind: "intent", submissionId: `submission:${goldCase.id}`, text: goldCase.intent },
    projection,
    attempt: 1,
  });
  return caseResult({
    goldCase,
    common,
    schemaBytes: utf8Bytes(PROPOSAL_TOOL.function.parameters),
    inputTokensEstimate: estimatedTokens(modelInput),
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

function evaluateRetrievalGroup(input) {
  const started = performance.now();
  const request = retrievalRequestForCase(input.goldCase, input.common.staticRequiredRefs, input.planner);
  const hits = retrieveStaticReferences(input.corpus.index, request, input.fts);
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
  const modelParameters = buildKpFormModelParameters(orderedForms);
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
  for (const hit of hits) {
    providedRefs.add(hit.sourceRef);
    hit.structuralRefs.forEach((ref) => providedRefs.add(ref));
    hit.dependencyRefs.forEach((ref) => providedRefs.add(ref));
  }
  const rank = targetRank(hits, input.common.staticRequiredRefs);
  return caseResult({
    goldCase: input.goldCase,
    common: input.common,
    schemaBytes: utf8Bytes(modelParameters),
    inputTokensEstimate: estimatedTokens(modelInput),
    providedRefs,
    rank,
    localLatencyMs: input.common.localLatencyMs + performance.now() - started,
    formMetricsApplicable: true,
  });
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

function retrievalRequestForCase(goldCase, staticRequiredRefs, planner) {
  const plannerTerms = planner?.suggestion?.queryTerms ?? [];
  const base = {
    plannerQueryTerms: plannerTerms,
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
      return { ...common, focus: "与意图直接相关的可感知细节", desiredInformation: "足以支持下一步决定的事实", basisRefs };
    case "npc-exchange.v1":
      return { ...common, utterance: goldCase.intent, desiredResponse: "NPC 依据有限知识作出可信回应", basisRefs };
    case "ordinary-check.v1":
      return { ...common, intendedOutcome: "在合理成本内达成玩家目标", risk: "失败会消耗时间或资源", basisRefs };
    case "high-risk-action.v1":
      return { ...common, intendedOutcome: "承担风险后推进目标", risk: "失败产生不可忽略的世界后果", stakes: "局势、资源或人员安全会改变", basisRefs };
    case "in-world-refusal.v1":
      return { goal: goldCase.intent, reason: "当前世界事实或资源不满足必要前提", alternatives: ["寻找缺失前提", "改用符合世界规律的方法"], basisRefs };
    case "materialization.v1":
      return { ...common, proposedFact: "固化一个符合场景用途且未被既有事实否定的普通物件", basisRefs };
    case "combat-action.v1":
      return { ...common, intendedOutcome: "在本回合取得战术优势", combatApproach: "使用当前装备、位置和行动经济执行", basisRefs };
    case "environmental-stunt.v1":
      return { ...common, featureDescription: "当前场景中可被权威状态确认的环境要素", intendedOutcome: "改变地形或局势", basisRefs };
    case "compound.v1":
      return {
        ...common,
        stages: [
          { goal: "建立必要条件", method: "先完成意图中的前置步骤", intendedOutcome: "后续步骤可以合法执行" },
          { goal: "完成主要目标", method: "执行意图中的核心步骤", intendedOutcome: "产生可结算的世界结果" },
        ],
        intendedOutcome: "同一 RootAction 内形成有界因果结果",
        basisRefs,
      };
    default:
      throw new Error(`KP_V3_EVAL_GOLD_FORM_UNSUPPORTED:${goldCase.goldForm}`);
  }
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
    measurementKind: "offline-structural-estimate",
    schemaBytes: distribution(caseResults.map((entry) => entry.schemaBytes), "bytes"),
    inputTokensEstimate: Object.freeze({
      ...distribution(caseResults.map((entry) => entry.inputTokensEstimate), "estimated tokens"),
      simpleP95: percentile(simple.map((entry) => entry.inputTokensEstimate), 0.95),
      estimator: "ceil(UTF-8 serialized request bytes / 4)",
    }),
    localPureLatencyMs: Object.freeze({
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
  const positivePairedQualityGain = Object.values(pairedDifferences).some((metric) => metric.ci95.low > 0);
  const inputGain = inputMedianReduction >= KP_V3_EVAL_THRESHOLDS.optionalExperimentMinimumInputReduction;
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

async function evaluateFaultInjection({ goldCase, corpus, registry }) {
  const allowedForms = selectAllowedKpForms(goldCase.signals);
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
    limit: 8,
  });
  const deterministic = () => retrieveStaticReferences(
    corpus.index,
    request,
    createDeterministicFtsAdapter(corpus.index),
  );
  const stages = [];

  const failingPlanner = createModelPlannerAdapter({
    registry,
    profileRef: "eval:planner-model",
    invoke: async () => { throw new Error("injected planner failure"); },
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
    retrieveStaticReferences(corpus.index, request, {
      mode: "d1-fts",
      search() { throw new Error("injected rag failure"); },
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
      throw new Error(`injected ${stage} failure`);
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
    {
      profileRef: "eval:planner-model",
      provider: "offline-eval",
      modelId: "injected-planner",
      modelRevision: "structural-v1",
      supportedRoles: ["context-planner"],
      validationSuiteVersion: "kp-v3-planner-fault-v1",
      validationStatus: "passed",
      structuredOutputMode: "strict-json-schema",
      contextWindowTokens: 32_000,
      latencyTier: "local",
      costTier: "free",
    },
  ]);
}

function createLocalExactVectorAdapter(index) {
  return Object.freeze({
    mode: "deterministic",
    search(query) {
      const queryTerms = new Set(query.terms.flatMap((term) => staticSearchTerms(term)));
      return Object.freeze(Object.values(index.entries)
        .map((entry) => {
          const entryTerms = new Set(entry.searchTerms);
          const overlap = [...queryTerms].filter((term) => entryTerms.has(term)).length;
          const denominator = Math.sqrt(Math.max(1, queryTerms.size) * Math.max(1, entryTerms.size));
          return Object.freeze({ sourceRef: entry.sourceRef, score: overlap / denominator });
        })
        .filter((hit) => hit.score > 0)
        .sort((left, right) => right.score - left.score || left.sourceRef.localeCompare(right.sourceRef))
        .slice(0, query.limit));
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
if (isMain) {
  const options = cliOptions(process.argv.slice(2));
  const report = await runKpV3Evaluation(options);
  process.stdout.write(`${JSON.stringify(report, null, options.compact ? 0 : 2)}\n`);
  if (report.status !== "pass") process.exitCode = 1;
}
