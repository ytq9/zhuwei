import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { authoritativeModuleProfile } from "../app/_runtime/lib/module/authoritative.ts";
import {
  createV3ProductionContextPreparer,
  compileV3ProductionCorpus,
} from "../app/_runtime/lib/kp/v3-production-context.ts";
import {
  CONTEXT_PLANNER_VALIDATION_GATES,
  createContextPlannerRoleValidationEvidence,
  createDeterministicPlannerAdapter,
  createModelPlannerAdapter,
  createModelProfileRegistry,
} from "../app/_runtime/lib/kp/model-registry.ts";
import { CONTEXT_PLANNER_ROLE_VALIDATION_SUITE_VERSION } from "../app/_runtime/lib/kp/context-planner-policy.ts";
import { selectAllowedKpForms } from "../app/_runtime/lib/kp/form-catalog.ts";
import {
  requiredContextFromKpRequest,
  v3FormSelectionSignals,
} from "../app/_runtime/lib/kp/v3-context-runtime.ts";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests.ts";

const ALLOWED_FORMS = Object.freeze([
  "ordinary-check.v1",
  "high-risk-action.v1",
  "materialization.v1",
  "environmental-stunt.v1",
  "compound.v1",
]);
const DYNAMIC_SENTINEL = "动态房间知识绝不能进入静态索引-7f31";

test("arbitrary player ideas always keep the open environmental form available", async () => {
  const profile = await authoritativeModuleProfile("black-oak-will");
  for (const text of [
    "我扯下窗帘裹住追来的守卫。",
    "我掀翻餐桌，想挡住门口。",
    "我冻结排水沟里的水，让地面变滑。",
    "我拆下门板搭在裂缝上当桥。",
  ]) {
    const signals = v3FormSelectionSignals(proposalRequest(profile, text));
    assert.equal(signals.mayUseEnvironment, true);
    assert.ok(selectAllowedKpForms(signals).includes("environmental-stunt.v1"));
  }
});

test("unclassified questions keep observation and dynamic Form choices available to KP", async () => {
  const profile = await authoritativeModuleProfile("black-oak-will");
  for (const text of [
    "这里怎么了，我知道些什么吗",
    "去看看尸体",
    "他怎么死的",
  ]) {
    const signals = v3FormSelectionSignals(proposalRequest(profile, text), {
      socialResolution: true,
    });
    assert.equal(signals.interaction, "free", text);
    assert.equal(signals.serverSelectedForm, undefined, text);
    assert.deepEqual(selectAllowedKpForms(signals), [
      "observe.v1",
      "materialization.v1",
      "npc-exchange.v1",
      "environmental-stunt.v1",
      "clarification.v1",
      "compound.v1",
    ], text);
  }
});

test("RequiredContext consumes the real observer projection and rejects incomplete authority", async (t) => {
  const profile = await authoritativeModuleProfile("black-oak-will");
  const request = proposalRequest(profile, "我借着半掩护观察酒窖另一侧。");
  const required = requiredContextFromKpRequest(request);

  assert.equal(required.trustedControl.characterRef, "character:alice");
  assert.equal(required.trustedControl.controllerRef, "character:alice");
  assert.equal(JSON.stringify(required).includes("user:alice"), false);
  assert.deepEqual(required.mechanics.position, {
    elevation: "0",
    x: "120",
    y: "120",
  });
  assert.deepEqual(required.mechanics.conditions, ["life:alive", "state:half-cover"]);
  assert.equal(required.bindings.rulesRef, ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST.ruleset.profileId);
  assert.equal(required.bindings.geometryRef, ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST.geometry.profileId);
  assert.equal(required.bindings.eventRef, ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST.eventSchema.profileId);
  assert.equal(required.bindings.moduleRef, profile.moduleRef.profileId);
  assert.equal(JSON.stringify(required).includes("unavailable"), false);
  assert.equal(required.npcViews.length, 1);

  const crossSceneNamedNpc = structuredClone(request);
  crossSceneNamedNpc.input.text = "我呼唤神龛回声（亡母的嗓音），并询问 npc:black-oak-will:echo 的计划。";
  crossSceneNamedNpc.projection.npcViewers["npc:black-oak-will:echo"]
    .controlledCharacter.sceneId = "attic";
  const crossSceneRequired = requiredContextFromKpRequest(crossSceneNamedNpc);
  assert.deepEqual(crossSceneRequired.npcViews, []);
  const crossSceneSerialized = JSON.stringify(crossSceneRequired);
  assert.equal(crossSceneSerialized.includes("回声只知道自己听见过的音节"), false);
  assert.equal(crossSceneSerialized.includes("诱使在场者应和"), false);

  const incompleteCases = [
    ["missing tactical self position", (candidate) => {
      delete candidate.projection.actorProjection.tacticalProjection.self.position;
    }],
    ["missing tactical self public states", (candidate) => {
      delete candidate.projection.actorProjection.tacticalProjection.self.publicStates;
    }],
    ["mismatched tactical scene", (candidate) => {
      candidate.projection.actorProjection.tacticalProjection.scene.id = "attic";
    }],
    ["missing event schema", (candidate) => {
      delete candidate.projection.actorProjection.runtimeProfiles.eventSchema;
    }],
    ["incomplete module profile", (candidate) => {
      delete candidate.projection.moduleRef.profileHash;
    }],
  ];
  for (const [name, mutate] of incompleteCases) {
    await t.test(name, () => {
      const candidate = structuredClone(request);
      mutate(candidate);
      assert.throws(
        () => requiredContextFromKpRequest(candidate),
        (error) => error instanceof Error && error.message === "CONTEXT_INSUFFICIENT",
      );
    });
  }
});

test("only the V5 KP context receives the relevant hidden dynamic-fact causal closure", async () => {
  const profile = await authoritativeModuleProfile("black-oak-will");
  const request = proposalRequest(profile, "我问回声：我为何来到这里？");
  const hiddenParent = "fact:hidden:invitation-origin";
  const hiddenCurrent = "fact:hidden:arrival-purpose";
  request.projection.dynamicAuthoritativeFacts = {
    [hiddenParent]: {
      id: hiddenParent,
      kind: "typedCharacterPremise",
      source: "mechanicalResolution",
      subjectRefs: ["organization:unseen-apothecary"],
      value: { inviterRef: "organization:unseen-apothecary" },
      causalParentIds: [],
      validFromEventSeq: "41",
    },
    [hiddenCurrent]: {
      id: hiddenCurrent,
      kind: "typedCharacterPremise",
      source: "mechanicalResolution",
      subjectRefs: ["character:alice"],
      value: { purpose: "寻找失踪的信使", sourceFactRef: hiddenParent },
      causalParentIds: [hiddenParent],
      validFromEventSeq: "42",
    },
    "fact:hidden:other-scene": {
      id: "fact:hidden:other-scene",
      kind: "worldState",
      source: "mechanicalResolution",
      subjectRefs: ["npc:remote"],
      value: { sceneRef: "attic", detail: "不相关秘密" },
      causalParentIds: [],
      validFromEventSeq: "43",
    },
  };

  const historical = requiredContextFromKpRequest(request);
  assert.equal("dynamicAuthoritativeFacts" in historical.sceneDynamics, false);
  assert.equal(JSON.stringify(historical).includes("寻找失踪的信使"), false);

  const v5 = requiredContextFromKpRequest(request, {
    includeDynamicAuthoritativeFacts: true,
  });
  assert.deepEqual(
    v5.sceneDynamics.dynamicAuthoritativeFacts.map((fact) => fact.id),
    [hiddenParent, hiddenCurrent],
  );
  assert.ok(v5.established.factRefs.includes(hiddenParent));
  assert.ok(v5.established.factRefs.includes(hiddenCurrent));
  assert.equal(JSON.stringify(v5).includes("不相关秘密"), false);
  assert.equal(JSON.stringify(request.projection.actorProjection).includes("寻找失踪的信使"), false);
  assert.equal(JSON.stringify(v5.npcViews).includes("寻找失踪的信使"), false);
});

test("production corpus deterministically covers all six static authority classes and rejects dynamic inputs", async () => {
  const profile = await authoritativeModuleProfile("black-oak-will");
  const first = compileV3ProductionCorpus(profile);
  const second = compileV3ProductionCorpus(structuredClone(profile));

  assert.equal(first.corpusHash, second.corpusHash);
  assert.deepEqual(first.chunks, second.chunks);
  assert.deepEqual(new Set(first.chunks.map((chunk) => chunk.purpose)), new Set([
    "rules",
    "module",
    "story-bible",
    "ability",
    "enemy",
    "environment",
  ]));
  assert.ok(first.chunks.some((chunk) => chunk.profileRef === profile.moduleRef.profileId));
  assert.ok(first.chunks.some((chunk) => chunk.sensitivity === "kp-only"));
  assert.ok(first.d1Rows.every((row) => !Object.hasOwn(row, "body")));

  for (const forbidden of [
    { sourceKind: "dynamic-room", sourceRef: "room:active:world" },
    { sourceKind: "static", sourceRef: "transcript:active:messages" },
    { sourceKind: "static", sourceRef: "current-tactical:active" },
    { sourceKind: "static", sourceRef: "knowledge:npc:active" },
  ]) {
    assert.throws(() => compileV3ProductionCorpus(profile, {
      additionalSources: [{
        ...forbidden,
        sourceType: "module",
        profileRef: profile.moduleRef.profileId,
        sensitivity: "kp-only",
        body: DYNAMIC_SENTINEL,
      }],
    }), /DYNAMIC_SOURCE_FORBIDDEN/);
  }
});

test("real SQLite synchronization retrieves structure/aliases through D1 and rehydrates only authorized in-memory prose", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zhuwei-v3-production-context-"));
  const local = new LocalD1Database(join(directory, "context.sqlite"));
  try {
    await applyDrizzleMigrations(local);
    const profile = await authoritativeModuleProfile("black-oak-will");
    const registry = registryWithProfiles();
    const preparer = createV3ProductionContextPreparer({
      moduleProfile: profile,
      database: local,
      registry,
      pinnedPrimaryKpProfileRef: "test-primary-kp-v1",
      plannerAdapter: createDeterministicPlannerAdapter(),
      allowKpOnly: true,
      maxUnits: 64_000,
      retrievalLimit: 12,
    });
    const request = proposalRequest(profile, "我推倒酒桶制造半掩，并观察盐霜会不会被扰动。");
    const result = await preparer.prepare(request, ALLOWED_FORMS);
    assert.equal(local.ftsQueryBinds.length, 1);
    const firstD1Query = structuredClone(local.ftsQueryBinds[0]);

    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_chunks"), preparer.corpus.d1Rows.length);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_chunks_fts"), preparer.corpus.d1Rows.length);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_chunks WHERE body <> ''"), 0);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_chunks WHERE sensitivity = 'kp-only'"), 0);
    assert.equal(result.retrievalReceipt.retrievalMode, "d1-fts");
    assert.equal(result.retrievalReceipt.fallbackUsed, false);
    assert.match(result.retrievalReceipt.selectedReferencesDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.ok(result.contextPack.retrieved.chunks.length > 0);
    assert.ok(result.contextPack.retrieved.chunks.some((chunk) =>
      chunk.purpose === "environment" && chunk.body.includes("酒桶")));
    assert.ok(result.contextPack.retrieved.chunks.every((chunk) =>
      preparer.corpus.authorityByRef[chunk.sourceRef]?.body === chunk.body));
    assert.ok(result.contextPack.retrieved.chunks.every((chunk) =>
      preparer.corpus.authorityByRef[chunk.sourceRef]?.sourceHash === chunk.sourceHash));
    assert.ok(result.contextPack.retrieved.chunks.every((chunk) =>
      preparer.corpus.authorityByRef[chunk.sourceRef]?.profileRef === chunk.profileRef));
    assert.ok(result.contextPack.retrieved.chunks.every((chunk) =>
      preparer.corpus.authorityByRef[chunk.sourceRef]?.sensitivity === chunk.sensitivity));
    assert.deepEqual(new Set(result.orderedFormIds), new Set(ALLOWED_FORMS));
    assert.equal(result.orderedFormIds.at(-1), "compound.v1");

    // Request-local intent, transcript, tactical state and current knowledge
    // enter RequiredContext only; none is ever persisted into the corpus/FTS.
    assert.equal(local.scalar(
      "SELECT count(*) AS value FROM kp_static_chunks WHERE search_text LIKE '%动态房间知识绝不能进入静态索引%'",
    ), 0);
    assert.equal(local.scalar(
      "SELECT count(*) AS value FROM kp_static_chunks_fts WHERE search_text LIKE '%动态房间知识绝不能进入静态索引%'",
    ), 0);
    assert.ok(JSON.stringify(result.contextPack.required).includes(DYNAMIC_SENTINEL));
    assert.equal(JSON.stringify(result.contextPack.required).includes(profile.storyBible.coreTruth), false);
    assert.deepEqual(result.contextPack.required.npcViews, [{
      npcRef: "npc:black-oak-will:echo",
      knowledgeRefs: ["knowledge:npc:echo:heard-song"],
      planRefs: ["plan:npc:echo:finish-song"],
      knowledge: [{
        knowledgeRef: "knowledge:npc:echo:heard-song",
        kind: "claim",
        layer: "full",
        content: "回声只知道自己听见过的音节。",
        provenanceChain: ["event:npc:echo:heard-song"],
      }],
      plans: [{
        planId: "plan:npc:echo:finish-song",
        goal: "诱使在场者应和",
        nextStep: "只复述刚才听见的音节",
        trigger: "有人向回声说话",
        status: "active",
        dueAtMicros: "120000000",
        resourceRefs: [],
        knowledgeRefs: ["knowledge:npc:echo:heard-song"],
      }],
    }]);
    assert.ok(result.contextPack.optional.items.some((item) =>
      item.kind === "voice" && item.ref.includes("npc:black-oak-will:echo")));
    assert.ok(result.contextPack.optional.items.some((item) => item.kind === "theme"));
    assert.ok(result.contextPack.optional.items.some((item) => item.kind === "lightweight-index"));
    const safeReceipts = JSON.stringify({
      plannerReceipt: result.plannerReceipt,
      retrievalReceipt: result.retrievalReceipt,
    });
    assert.equal(safeReceipts.includes(request.input.text), false);
    assert.equal(safeReceipts.includes(profile.storyBible.coreTruth), false);
    assert.equal(safeReceipts.includes("body"), false);

    const changedRoomState = proposalRequest(
      profile,
      "我用只有自己知道的新法术检查侧厅墙缝。",
      {
        preparedActionId: "prepared:production-context:changed-state",
        rootActionId: "root:production-context:changed-state",
      },
    );
    changedRoomState.projection.actorProjection.controlledCharacter.sceneId = "annex";
    changedRoomState.projection.actorProjection.tacticalProjection.scene.id = "annex";
    changedRoomState.projection.actorProjection.tacticalProjection.textualReadout.sceneId = "annex";
    changedRoomState.projection.actorProjection.abilityDefinitions = [{
      definitionId: "ability:current:alice:private-annex-technique",
    }];
    changedRoomState.projection.spatialEvidence.scenes = [{ sceneId: "annex", name: "侧厅" }];
    changedRoomState.projection.spatialEvidence.entities = [{
      entityId: "character:alice",
      sceneId: "annex",
      x: "120",
      y: "120",
    }];
    await preparer.prepare(changedRoomState, ALLOWED_FORMS);
    assert.equal(local.ftsQueryBinds.length, 2);
    assert.deepEqual(
      local.ftsQueryBinds[1],
      firstD1Query,
      "D1 query bindings must not vary with active scene, loadout, or player prose",
    );
    const d1QueryText = JSON.stringify(firstD1Query);
    assert.equal(d1QueryText.includes(request.input.text), false);
    assert.equal(d1QueryText.includes(changedRoomState.input.text), false);
    assert.equal(d1QueryText.includes("cellar"), false);
    assert.equal(d1QueryText.includes("annex"), false);
    assert.equal(d1QueryText.includes("private-annex-technique"), false);

    const publicPreparer = createV3ProductionContextPreparer({
      moduleProfile: profile,
      database: local,
      registry,
      pinnedPrimaryKpProfileRef: "test-primary-kp-v1",
      allowKpOnly: false,
      retrievalLimit: 12,
    });
    const secretRequest = proposalRequest(profile, "我要查明核心真相：死者胸口无伤与黑橡叶意味着什么？");
    const publicResult = await publicPreparer.prepare(secretRequest, ALLOWED_FORMS);
    assert.ok(publicResult.contextPack.retrieved.chunks.every((chunk) => chunk.sensitivity === "public"));

    const kpResult = await preparer.prepare(secretRequest, ALLOWED_FORMS);
    assert.ok(kpResult.contextPack.retrieved.chunks.some((chunk) =>
      chunk.sensitivity === "kp-only" && chunk.purpose === "story-bible"));
  } finally {
    local.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Planner and D1 failures independently fall back without changing RequiredContext or the pinned primary KP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zhuwei-v3-production-fallback-"));
  const local = new LocalD1Database(join(directory, "fallback.sqlite"), { failFtsSearch: true });
  try {
    await applyDrizzleMigrations(local);
    const profile = await authoritativeModuleProfile("black-oak-will");
    const registry = registryWithProfiles();
    let modelPlannerCalls = 0;
    const planner = createModelPlannerAdapter({
      registry,
      profileRef: "test-context-planner-v1",
      async invoke() {
        modelPlannerCalls += 1;
        throw new Error("injected planner outage");
      },
    });
    const preparer = createV3ProductionContextPreparer({
      moduleProfile: profile,
      database: local,
      registry,
      pinnedPrimaryKpProfileRef: "test-primary-kp-v1",
      plannerAdapter: planner,
      allowKpOnly: true,
      retrievalLimit: 12,
    });
    const request = proposalRequest(profile, "我推倒酒桶作为掩体。", {
      rootActionId: "root:fallback:001",
    });
    const result = await preparer.prepare(request, ALLOWED_FORMS);

    assert.equal(modelPlannerCalls, 1);
    assert.equal(result.plannerReceipt.status, "fallback");
    assert.equal(result.plannerReceipt.failureCode, "PLANNER_FAILED");
    assert.equal(result.plannerReceipt.plannerProfileRef, "test-context-planner-v1");
    assert.equal(result.retrievalReceipt.retrievalMode, "deterministic");
    assert.equal(result.retrievalReceipt.status, "fallback");
    assert.equal(result.retrievalReceipt.failureCode, "D1_SEARCH_FAILED");
    assert.ok(result.contextPack.retrieved.chunks.length > 0);
    assert.equal(result.contextPack.required.intent.text, request.input.text);
    assert.equal(result.contextPack.required.trustedControl.characterRef, "character:alice");
    assert.equal(result.contextPack.required.mechanics.hp.current, 9);
    assert.deepEqual(new Set(result.orderedFormIds), new Set(ALLOWED_FORMS));
  } finally {
    local.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a missing deployed D1 schema falls back without request-time DDL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zhuwei-v3-production-no-schema-"));
  const local = new LocalD1Database(join(directory, "no-schema.sqlite"));
  try {
    const profile = await authoritativeModuleProfile("black-oak-will");
    const preparer = createV3ProductionContextPreparer({
      moduleProfile: profile,
      database: local,
      registry: registryWithProfiles(),
      pinnedPrimaryKpProfileRef: "test-primary-kp-v1",
      plannerAdapter: createDeterministicPlannerAdapter(),
      allowKpOnly: true,
    });
    const result = await preparer.prepare(
      proposalRequest(profile, "我把眼前的结构改成一道临时障碍。"),
      ALLOWED_FORMS,
    );
    assert.equal(result.retrievalReceipt.retrievalMode, "deterministic");
    assert.equal(result.retrievalReceipt.failureCode, "D1_SYNC_FAILED");
    assert.ok(result.contextPack.retrieved.chunks.length > 0);
    assert.equal(local.scalar(`
      SELECT count(*) AS value FROM sqlite_master
      WHERE name IN ('kp_static_chunks', 'kp_static_chunks_fts', 'kp_static_corpus_profiles')
    `), 0);
  } finally {
    local.close();
    await rm(directory, { recursive: true, force: true });
  }
});

async function applyDrizzleMigrations(local) {
  const directory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(directory))
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
    .sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, directory), "utf8");
    await local.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
}

function registryWithProfiles() {
  const planner = {
    profileRef: "test-context-planner-v1",
    provider: "test-planner",
    modelId: "test-planner",
    modelRevision: "2026-08-29",
    supportedRoles: ["context-planner"],
    validationSuiteVersion: CONTEXT_PLANNER_ROLE_VALIDATION_SUITE_VERSION,
    validationStatus: "passed",
    structuredOutputMode: "strict-tool",
    contextWindowTokens: 32_000,
    latencyTier: "local",
    costTier: "free",
  };
  planner.roleValidation = createContextPlannerRoleValidationEvidence({
    profile: planner,
    executionMode: "offline-fixture",
    validatedAt: "2026-08-29T00:00:00.000Z",
    caseCount: 5,
    liveProviderCalls: 0,
    latencyMs: { p50: 1, p95: 2, budget: 8_000 },
    gates: Object.fromEntries(CONTEXT_PLANNER_VALIDATION_GATES.map((gate) => [gate, true])),
  });
  return createModelProfileRegistry([
    {
      profileRef: "test-primary-kp-v1",
      provider: "test",
      modelId: "test-primary",
      modelRevision: "2026-08-29",
      supportedRoles: ["primary-kp"],
      validationSuiteVersion: "test-suite-v1",
      validationStatus: "passed",
      structuredOutputMode: "strict-tool",
      contextWindowTokens: 128_000,
      latencyTier: "local",
      costTier: "free",
    },
    planner,
  ]);
}

function proposalRequest(profile, text, overrides = {}) {
  return {
    preparedActionId: "prepared:production-context:001",
    rootActionId: "root:production-context:001",
    attempt: 1,
    input: {
      kind: "intent",
      submissionId: "submission:production-context:001",
      characterId: "character:alice",
      text,
    },
    projection: {
      moduleRef: profile.moduleRef,
      storyBible: {
        coreTruth: "当前行动只需保持模组核心真相约束。",
        storyAnchors: { activeChapterRef: "chapter:ch2" },
        contentBoundary: profile.storyBible.contentBoundary,
      },
      spatialEvidence: {
        scenes: [{ sceneId: "cellar", name: "打开酒窖" }],
        entities: [{ entityId: "character:alice", sceneId: "cellar", x: "120", y: "120" }],
      },
      experiencedTranscript: {
        messages: [{
          messageId: "message:experienced:001",
          speakerCharacterId: "character:alice",
          body: "我刚才亲眼看见酒桶后的盐霜。",
          fictionalTimeRef: "fiction:001",
        }],
      },
      npcViewers: {
        "npc:black-oak-will:echo": {
          viewer: { kind: "npc", subjectId: "npc:black-oak-will:echo" },
          controlledCharacter: {
            characterId: "npc:black-oak-will:echo",
            name: "神龛回声（亡母的嗓音）",
            sceneId: "cellar",
          },
          knowledge: [{
            knowledgeRef: "knowledge:npc:echo:heard-song",
            kind: "claim",
            layer: "full",
            content: "回声只知道自己听见过的音节。",
            provenanceChain: ["event:npc:echo:heard-song"],
          }],
          npcPlans: [{
            planId: "plan:npc:echo:finish-song",
            goal: "诱使在场者应和",
            nextStep: "只复述刚才听见的音节",
            trigger: "有人向回声说话",
            status: "active",
            dueAtMicros: "120000000",
            resourceRefs: [],
            knowledgeRefs: ["knowledge:npc:echo:heard-song"],
          }],
        },
      },
      actorProjection: {
        viewer: {
          kind: "player",
          characterId: "character:alice",
        },
        controlledCharacter: {
          characterId: "character:alice",
          sceneId: "cellar",
          hitPoints: { current: 9, maximum: 12 },
          resources: { action: 1, movementFeet: 30 },
        },
        visibleFacts: [{ id: "fact:cellar-barrels-visible", body: "酒桶在场。" }],
        knowledge: [{ id: "knowledge:current:alice", content: DYNAMIC_SENTINEL }],
        pendingInputs: [],
        activities: [],
        encounters: [],
        abilityDefinitions: [{ definitionId: "ability:current:alice:improvised-cover" }],
        fictionTime: { elapsedSeconds: 120 },
        runtimeProfiles: structuredClone(ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST),
        tacticalProjection: {
          schema: "zhuwei.tactical-projection/v1",
          scene: {
            id: "cellar",
            name: "打开酒窖",
            boundary: {
              kind: "polygon",
              points: [
                { x: "0", y: "0" },
                { x: "1200", y: "0" },
                { x: "1200", y: "1200" },
              ],
            },
            gridInches: 60,
          },
          self: {
            id: "character:alice",
            name: "爱丽丝",
            kind: "player",
            position: { x: "120", y: "120", elevation: "0" },
            footprint: { width: "60", depth: "60", height: "66" },
            relation: "self",
            publicStates: ["life:alive", "state:half-cover"],
          },
          visibleEntities: [],
          knownFeatures: [],
          knownZones: [],
          encounter: null,
          preview: null,
          textualReadout: {
            sceneId: "cellar",
            summary: "爱丽丝位于打开酒窖。",
            entities: [],
            features: [],
          },
          spatialRevision: `sha256:${"1".repeat(64)}`,
        },
      },
    },
    ...overrides,
  };
}

class LocalD1PreparedStatement {
  constructor(owner, sql, failAll = false) {
    this.owner = owner;
    this.sql = sql;
    this.values = [];
    this.failAll = failAll;
  }

  bind(...values) {
    this.values = values;
    if (this.sql.includes("kp_static_chunks_fts MATCH ?")) {
      this.owner.ftsQueryBinds.push(structuredClone(values));
    }
    return this;
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    return this.owner.database.prepare(this.sql).run(...this.values);
  }

  async all() {
    if (this.failAll) throw new Error("injected D1 FTS outage");
    return { results: this.owner.database.prepare(this.sql).all(...this.values) };
  }
}

class LocalD1Database {
  constructor(path, options = {}) {
    this.database = new DatabaseSync(path);
    this.failFtsSearch = options.failFtsSearch === true;
    this.ftsQueryBinds = [];
  }

  async exec(sql) {
    this.database.exec(sql);
    return { count: 1, duration: 0 };
  }

  prepare(sql) {
    const failAll = this.failFtsSearch && sql.includes("kp_static_chunks_fts MATCH ?");
    return new LocalD1PreparedStatement(this, sql, failAll);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => {
        assert.ok(statement instanceof LocalD1PreparedStatement);
        assert.strictEqual(statement.owner, this);
        return statement.runSync();
      });
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  scalar(sql) {
    return Number(this.database.prepare(sql).get().value);
  }

  close() {
    this.database.close();
  }
}
