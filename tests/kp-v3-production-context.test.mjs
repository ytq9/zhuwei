import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
  createDeterministicPlannerAdapter,
  createModelPlannerAdapter,
  createModelProfileRegistry,
} from "../app/_runtime/lib/kp/model-registry.ts";
import { RULESET_PROFILE } from "../app/_runtime/lib/rules/profiles/manifests.ts";

const ALLOWED_FORMS = Object.freeze([
  "ordinary-check.v1",
  "high-risk-action.v1",
  "materialization.v1",
  "environmental-stunt.v1",
  "compound.v1",
]);
const DYNAMIC_SENTINEL = "动态房间知识绝不能进入静态索引-7f31";

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

    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_chunks"), preparer.corpus.chunks.length);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_chunks_fts"), preparer.corpus.chunks.length);
    assert.equal(local.scalar("SELECT count(*) AS value FROM kp_static_chunks WHERE body <> ''"), 0);
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
    const safeReceipts = JSON.stringify({
      plannerReceipt: result.plannerReceipt,
      retrievalReceipt: result.retrievalReceipt,
    });
    assert.equal(safeReceipts.includes(request.input.text), false);
    assert.equal(safeReceipts.includes(profile.storyBible.coreTruth), false);
    assert.equal(safeReceipts.includes("body"), false);

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

function registryWithProfiles() {
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
    {
      profileRef: "test-context-planner-v1",
      provider: "test",
      modelId: "test-planner",
      modelRevision: "2026-08-29",
      supportedRoles: ["context-planner"],
      validationSuiteVersion: "test-suite-v1",
      validationStatus: "passed",
      structuredOutputMode: "strict-json-schema",
      contextWindowTokens: 32_000,
      latencyTier: "local",
      costTier: "free",
    },
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
        "npc:echo": {
          knowledgeRefs: ["npc-static-view:echo:heard-song"],
          goalRefs: ["npc-static-view:echo:finish-song"],
        },
      },
      actorProjection: {
        viewer: {
          principalId: "user:alice",
          subjectId: "character:alice",
        },
        controlledCharacter: {
          characterId: "character:alice",
          sceneId: "cellar",
          hitPoints: { current: 9, maximum: 12 },
          resources: { action: 1, movementFeet: 30 },
          conditions: [],
        },
        visibleFacts: [{ id: "fact:cellar-barrels-visible", body: "酒桶在场。" }],
        knowledge: [{ id: "knowledge:current:alice", content: DYNAMIC_SENTINEL }],
        pendingInputs: [],
        activities: [],
        encounters: [],
        abilityDefinitions: [{ definitionId: "ability:current:alice:improvised-cover" }],
        fictionTime: { elapsedSeconds: 120 },
        runtimeProfiles: {
          ruleset: RULESET_PROFILE,
          geometry: { profileId: "geometry-2d-feet-2014-v1" },
          events: { profileId: "room-world-events-v2" },
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
