import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import {
  LIVE_KP_EVAL_MODEL,
  LIVE_KP_EVAL_PROVIDER,
  LIVE_KP_EVAL_REPORT_SCHEMA,
  LIVE_KP_EVAL_THRESHOLDS,
  assessPublicSingleAuthority,
  buildLiveKpScenario,
  runLiveKpEvaluation,
} from "../tools/live-kp-eval.mjs";

function json(response, status = 200) {
  return { status, body: JSON.stringify(response) };
}

function compactReceipt(receipt) {
  return Object.fromEntries([
    "receiptId",
    "rootActionId",
    "status",
    "runtimeEpochId",
    "activeBranchId",
  ].map((field) => [field, receipt[field]]));
}

function projectedReceipt(receipt) {
  return Object.fromEntries([
    "receiptId",
    "rootActionId",
    "status",
  ].map((field) => [field, receipt[field]]));
}

async function mockAuthoritativeServer(options = {}) {
  const receipts = new Map();
  const calls = [];
  let eventSeq = 0;
  let pendingOpen = false;
  let shared = false;
  let concluded = false;
  let secretCanary = "";
  let privatePlanCanary = "";
  const slots = { host: null, player: null };
  const knowledge = { host: new Set(), player: new Set() };
  const spotlight = { host: 0, player: 0 };
  const d1BackpackQuantity = { host: 1, player: 1 };

  function actorFor(request) {
    return request.headers.cookie === "session=host" ? "host" : "player";
  }

  function responseReceipt(receipt) {
    if (options.compactResponseReceipts !== true) return receipt;
    return compactReceipt(receipt);
  }

  function delivery(actor, text, submissionId) {
    const deliveryId = `delivery:${submissionId}:${actor}`;
    slots[actor] = { deliveryId, text };
    return { kind: "current", frame: { deliveryId, text }, body: text };
  }

  function readModel(actor) {
    return {
      kind: "projected",
      viewer: { kind: "player", subjectId: `character:${actor}` },
      controlledCharacter: {
        characterId: `character:${actor}`,
        sceneId: actor === "host" ? "private-lian" : "yard",
        name: actor,
        hitPoints: { current: 10, maximum: 10 },
        resources: { secondWind: 1 },
        loadout: {
          armorClass: 14,
          speedFeet: 30,
          equipped: {},
          backpack: [{ itemId: "ration", quantity: 1 }],
        },
      },
      stateVersion: String(eventSeq),
      projectionHash: `sha256:${actor === "host" ? "a" : "b"}${String(eventSeq).padStart(63, "0")}`,
      worldRevision: String(eventSeq),
      pendingInputs: actor === "host" && pendingOpen
        ? [{ pendingInputId: "pending:private-choice", kind: "clarification" }]
        : [],
      knowledge: [...knowledge[actor]].map((content, index) => ({
        knowledgeRef: `knowledge:${actor}:${index}`,
        content,
      })),
      spotlightLedger: {
        "character:host": { decisionBeats: spotlight.host },
        "character:player": { decisionBeats: spotlight.player },
      },
      receipts: [...receipts.values()].map((entry) => projectedReceipt(entry.receipt)),
      ...(concluded
        ? { story: { status: "concluded", endingCandidateRef: "ending:test", epilogue: {} } }
        : {}),
    };
  }

  function table(actor) {
    const slot = slots[actor];
    return {
      ok: true,
      me: { userId: `principal:${actor}` },
      room: {
        ruleset_version: "dnd5e-2014-srd5.1-authoritative-v2",
        kp_model: "deepseek-v4-flash",
        status: "play",
      },
      characters: [{
        userId: `principal:${actor}`,
        locked: true,
        sheet: {
          hp: { current: 10, max: 10 },
          resources: { secondWind: { max: 1, used: 0 } },
          ac: 14,
          speed: 30,
          equipped: {},
          backpack: [{ itemId: "ration", qty: d1BackpackQuantity[actor] }],
        },
      }],
      messages: slot ? [{ id: slot.deliveryId, body: slot.text }] : [],
      state: {
        sceneId: actor === "host" ? "private-lian" : "yard",
        currentDeliveryId: slot?.deliveryId,
        pendingInputs: actor === "host" && pendingOpen
          ? [{ pendingInputId: "pending:private-choice", kind: "clarification" }]
          : [],
        clues: [...knowledge[actor]].map((text, index) => ({ id: `clue:${index}`, text })),
        receipts: [...receipts.values()].map((entry) => projectedReceipt(entry.receipt)),
        authoritative: {
          stateVersion: readModel(actor).stateVersion,
          projectionHash: readModel(actor).projectionHash,
          controlledCharacter: readModel(actor).controlledCharacter,
          activities: [],
          inCombat: false,
        },
      },
    };
  }

  function committed(actor, submissionId, tags) {
    eventSeq += 1;
    spotlight[actor] += 1;
    const meaningfulFailure = tags.includes("meaningful-failure");
    const randomnessCommitments = tags.includes("authoritative-randomness")
      ? [{
          randomnessId: `randomness:${submissionId}`,
          requestHash: `sha256:${"1".repeat(64)}`,
          frozenParametersHash: `sha256:${"2".repeat(64)}`,
        }]
      : [];
    const receipt = {
      receiptId: `receipt:${submissionId}`,
      rootActionId: `root:${submissionId}`,
      status: concluded ? "concluded" : "committed",
      runtimeEpochId: "epoch:mock:1",
      activeBranchId: "branch:main",
      eventRange: { first: String(eventSeq), last: String(eventSeq), from: eventSeq, to: eventSeq },
      scopeVersions: { "scene:mock": String(eventSeq) },
      randomnessCommitments,
      ...(meaningfulFailure
        ? { meaningfulFailure: true, newOptions: [{ optionId: "alternate-route" }] }
        : {}),
    };
    const text = concluded
      ? "当前冲突已经真实收束；你可以选择自己的尾声。"
      : `当前结果 ${submissionId} 已经提交，决定权交还给你。`;
    const outcome = {
      kind: concluded ? "concluded" : "committed",
      receipt: responseReceipt(receipt),
      readModel: readModel(actor),
      delivery: delivery(actor, text, submissionId),
    };
    receipts.set(submissionId, { receipt, outcome });
    return outcome;
  }

  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
      : {};
    const actor = actorFor(request);
    const command = payload.command;
    const data = payload.data ?? {};
    calls.push({ path: request.url, command, actor, data });

    let result;
    if (request.url !== "/api/game") {
      result = json({ error: "not found" }, 404);
    } else if (command === "getRoomManagement") {
      result = json({
        ok: true,
        room: {
          code: data.code,
          ruleset_version: "dnd5e-2014-srd5.1-authoritative-v2",
          kp_model: "deepseek-v4-flash",
          status: "play",
        },
      });
    } else if (command === "fetchTable") {
      result = json(table(actor));
    } else if (command === "acknowledgeDelivery") {
      if (slots[actor]?.deliveryId === data.deliveryId) slots[actor] = null;
      result = json({ ok: true, deliveryId: data.deliveryId });
    } else if (command === "sendAction") {
      const tags = String(data.submissionId).split(":tag=")[1]?.split(",") ?? [];
      const cached = receipts.get(data.submissionId);
      if (cached) {
        result = json({ ok: true, submissionId: data.submissionId, outcome: cached.outcome });
      } else if (data.pendingInputId === "pending:private-choice" && actor === "player") {
        if (options.parallelAuthoritySignal === true) d1BackpackQuantity.player = 2;
        result = json({
          ok: false,
          submissionId: data.submissionId,
          outcomeKind: "rejected",
          error: "当前行动没有被接受",
        });
      } else if (data.pendingInputId === "pending:private-choice" && actor === "host") {
        pendingOpen = false;
        result = json({ ok: true, submissionId: data.submissionId, outcome: committed(actor, data.submissionId, tags) });
      } else if (tags.includes("clarification")) {
        eventSeq += 1;
        pendingOpen = true;
        spotlight.host += 1;
        const receipt = {
          receiptId: `receipt:${data.submissionId}`,
          rootActionId: `root:${data.submissionId}`,
          status: "awaitingInput",
          runtimeEpochId: "epoch:mock:1",
          activeBranchId: "branch:main",
          eventRange: { first: String(eventSeq), last: String(eventSeq), from: eventSeq, to: eventSeq },
          scopeVersions: { "scene:mock": String(eventSeq) },
          randomnessCommitments: [],
        };
        const outcome = {
          kind: "awaitingInput",
          receipt: responseReceipt(receipt),
          readModel: readModel(actor),
          pending: { pendingInputId: "pending:private-choice", kind: "clarification" },
        };
        receipts.set(data.submissionId, { receipt, outcome });
        result = json({
          ok: true,
          submissionId: data.submissionId,
          outcome,
        });
      } else {
        if (tags.includes("private-secret")) {
          secretCanary = String(data.text).match(/ZEVAL-[A-Z0-9-]+/)?.[0] ?? "";
          knowledge.host.add(secretCanary);
        }
        if (tags.includes("private-plan")) {
          privatePlanCanary = String(data.text).match(/ZPLAN-[A-Z0-9-]+/)?.[0] ?? "";
          knowledge.player.add(privatePlanCanary);
        }
        if (tags.includes("share-secret")) {
          shared = true;
          if (secretCanary) knowledge.player.add(secretCanary);
        }
        if (tags.includes("conclusion")) concluded = true;
        const outcome = committed(actor, data.submissionId, tags);
        if (shared && actor === "host" && secretCanary) {
          slots.player = {
            deliveryId: `delivery:${data.submissionId}:player`,
            text: `同伴在世界内向你分享了 ${secretCanary}。`,
          };
        }
        result = json({ ok: true, submissionId: data.submissionId, outcome });
      }
    } else {
      result = json({ error: "unknown command" }, 404);
    }

    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(result.body);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    receiptPairs: () => [...receipts.values()].map((entry) => ({
      authoritative: entry.receipt,
      projected: projectedReceipt(entry.receipt),
      response: entry.outcome.receipt,
    })),
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function authorityTable(actor, stateVersion, projectedReceipts = []) {
  const userId = `principal:${actor}`;
  const characterId = `character:${actor}`;
  return {
    me: { userId },
    characters: [{
      userId,
      sheet: {
        hp: { current: 10, max: 10 },
        resources: { secondWind: { max: 1, used: 0 } },
        ac: 14,
        speed: 30,
        equipped: {},
        backpack: [{ itemId: "ration", qty: 1 }],
      },
    }],
    state: {
      sceneId: "scene:shared",
      receipts: projectedReceipts,
      authoritative: {
        stateVersion: String(stateVersion),
        projectionHash: `sha256:${actor === "host" ? "a" : "b"}${String(stateVersion).padStart(63, "0")}`,
        controlledCharacter: {
          characterId,
          sceneId: "scene:shared",
          hitPoints: { current: 10, maximum: 10 },
          resources: { secondWind: 1 },
          loadout: {
            armorClass: 14,
            speedFeet: 30,
            equipped: {},
            backpack: [{ itemId: "ration", quantity: 1 }],
          },
        },
        activities: [],
        inCombat: false,
      },
    },
  };
}

function authorityTraceEntry(responseReceipt, stateVersion, projectedReceipts, actor = "host") {
  return {
    step: { actor },
    response: { outcome: { receipt: responseReceipt } },
    hostTable: authorityTable("host", stateVersion, projectedReceipts),
    playerTable: authorityTable("player", stateVersion, projectedReceipts),
    authorityInputKeys: new Set(),
    forbiddenResponseKeys: new Set(),
    legacyActiveStateKeys: new Set(),
  };
}

function authorityInitialTables() {
  return {
    host: authorityTable("host", 0),
    player: authorityTable("player", 0),
  };
}

function fullReceipt(receiptId, from, to) {
  return {
    receiptId,
    rootActionId: `root:${receiptId}`,
    status: "committed",
    runtimeEpochId: "epoch:mock:1",
    activeBranchId: "branch:main",
    eventRange: { first: String(from), last: String(to), from, to },
    scopeVersions: { "scene:shared": String(to) },
  };
}

test("the live scenario contains exactly 31 player intents or pending responses and no authority payloads", () => {
  const scenario = buildLiveKpScenario({
    runId: "scenario-test",
    secretCanary: "ZEVAL-SCENARIO-SECRET",
    privatePlanCanary: "ZPLAN-SCENARIO-PRIVATE",
  });
  assert.equal(scenario.filter((step) => step.countsAsInteraction).length, 31);
  assert.ok(scenario.every((step) => !JSON.stringify(step).match(/statePatch|events|dieFaces|principalId|actorId/)));
  assert.equal(LIVE_KP_EVAL_THRESHOLDS.minimumTotal, 18);
  assert.equal(LIVE_KP_EVAL_THRESHOLDS.minimumDimension, 1);
});

test("the HTTP runner uses only public table commands, applies hard gates, and emits a content-free report", async () => {
  const mock = await mockAuthoritativeServer();
  try {
    const report = await runLiveKpEvaluation({
      baseUrl: mock.baseUrl,
      roomCode: "EVAL01",
      actors: {
        host: { cookie: "session=host" },
        player: { cookie: "session=player" },
      },
      allowNonProductionTarget: true,
      runId: "runner-test",
      secretCanary: "ZEVAL-RUNNER-SECRET",
      privatePlanCanary: "ZPLAN-RUNNER-PRIVATE",
    });

    assert.equal(report.execution.mode, "selfTest");
    assert.equal(report.execution.liveModelVerified, false);
    assert.equal(report.schemaVersion, LIVE_KP_EVAL_REPORT_SCHEMA);
    assert.equal(report.target.modelId, LIVE_KP_EVAL_MODEL);
    assert.equal(report.target.modelProvider, LIVE_KP_EVAL_PROVIDER);
    assert.equal(report.status, "pass", JSON.stringify({
      hardGates: report.hardGates,
      scores: report.scores,
      metrics: report.metrics,
    }));
    assert.equal(report.hardGates.secretLeak, false);
    assert.equal(report.hardGates.substitutedPlayerChoice, false);
    assert.equal(report.hardGates.postRollChange, false);
    assert.equal(report.hardGates.duplicateRandomnessOrResource, false);
    assert.equal(report.hardGates.secondAuthority, false);
    assert.equal(report.hardGates.fakeConclusion, false);
    assert.deepEqual(report.authorityEvidence.signals, []);
    assert.equal(
      report.authorityEvidence.mutationCount,
      report.authorityEvidence.receiptCoveredMutationCount,
    );
    assert.ok(report.authorityEvidence.mutationCount > 0);
    assert.ok(report.authorityEvidence.projectionChecks > 0);
    assert.ok(report.authorityEvidence.activeCardChecks > 0);
    assert.equal(report.execution.interactionsCompleted, 31);
    assert.ok(report.scores.total >= LIVE_KP_EVAL_THRESHOLDS.minimumTotal);

    const serialized = JSON.stringify(report);
    for (const forbidden of [
      "session=host",
      "session=player",
      "ZEVAL-RUNNER-SECRET",
      "ZPLAN-RUNNER-PRIVATE",
      "当前结果",
      "世界内向你分享",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
    assert.equal(report.redaction.rawIntentStored, false);
    assert.equal(report.redaction.narrationStored, false);
    assert.equal(report.redaction.credentialsStored, false);

    const commands = new Set(mock.calls.map((call) => call.command));
    assert.deepEqual(commands, new Set([
      "getRoomManagement",
      "sendAction",
      "fetchTable",
      "acknowledgeDelivery",
    ]));
    assert.ok(mock.calls.every((call) => call.path === "/api/game"));
    assert.ok(mock.calls
      .filter((call) => call.command === "sendAction")
      .every((call) => !JSON.stringify(call.data).match(/statePatch|events|dieFaces|principalId|actorId/)));
  } finally {
    await mock.close();
  }
});

test("the explicit three-interaction smoke uses the same public evaluator without claiming full quality gates", async () => {
  const mock = await mockAuthoritativeServer({ compactResponseReceipts: true });
  try {
    const report = await runLiveKpEvaluation({
      baseUrl: mock.baseUrl,
      roomCode: "SMOKE3",
      actors: {
        host: { cookie: "session=host" },
        player: { cookie: "session=player" },
      },
      allowNonProductionTarget: true,
      runId: "runner-three-interaction-smoke",
      secretCanary: "ZEVAL-RUNNER-SMOKE",
      privatePlanCanary: "ZPLAN-RUNNER-SMOKE",
      interactionLimit: 3,
    });

    assert.equal(report.status, "pass", JSON.stringify(report.hardGates));
    assert.equal(report.execution.evaluationScope, "three-interaction-smoke");
    assert.equal(report.execution.interactionMinimum, 3);
    assert.equal(report.execution.interactionsCompleted, 3);
    assert.equal(report.execution.totalActionRequests, 3);
    assert.equal(report.execution.qualityThresholdsApplied, false);
    assert.ok(Object.values(report.hardGates).every((failed) => failed === false));
    assert.equal(JSON.stringify(report).includes("ZEVAL-RUNNER-SMOKE"), false);
    assert.equal(JSON.stringify(report).includes("ZPLAN-RUNNER-SMOKE"), false);
    for (const pair of mock.receiptPairs()) {
      assert.deepEqual(pair.response, compactReceipt(pair.authoritative));
      assert.deepEqual(pair.projected, projectedReceipt(pair.authoritative));
      assert.equal("eventRange" in pair.response, false);
      assert.equal("scopeVersions" in pair.response, false);
      assert.equal("runtimeEpochId" in pair.projected, false);
      assert.equal("activeBranchId" in pair.projected, false);
    }
  } finally {
    await mock.close();
  }
});

test("a compact V3 receipt covers one monotonic mutation and fails closed when reused", () => {
  const authoritative = fullReceipt("receipt:compact-once", 1, 1);
  const compact = compactReceipt(authoritative);
  const projected = [projectedReceipt(authoritative)];
  const result = assessPublicSingleAuthority([
    authorityTraceEntry(compact, 1, projected),
    authorityTraceEntry(compact, 2, projected),
  ], authorityInitialTables());

  assert.equal(result.secondAuthority, true);
  assert.deepEqual(result.signals, ["compactReceiptReusedForMutation"]);
  assert.equal(result.mutationCount, 2);
  assert.equal(result.receiptCoveredMutationCount, 1);
});

test("a compact V3 receipt rejects every missing identity or status field", () => {
  const authoritative = fullReceipt("receipt:compact-required-fields", 1, 1);
  for (const field of [
    "receiptId",
    "rootActionId",
    "status",
    "runtimeEpochId",
    "activeBranchId",
  ]) {
    const compact = compactReceipt(authoritative);
    delete compact[field];
    const result = assessPublicSingleAuthority([
      authorityTraceEntry(compact, 1, [projectedReceipt(authoritative)]),
    ], authorityInitialTables());

    assert.equal(result.secondAuthority, true, field);
    assert.deepEqual(result.signals, ["versionAdvancedWithoutDoReceipt"], field);
    assert.equal(result.receiptCoveredMutationCount, 0, field);
  }
});

test("a compact V3 receipt must match the actor projection identity and status", () => {
  const authoritative = fullReceipt("receipt:compact-projection", 1, 1);
  const projected = projectedReceipt(authoritative);
  projected.status = "awaitingInput";
  const result = assessPublicSingleAuthority([
    authorityTraceEntry(compactReceipt(authoritative), 1, [projected]),
  ], authorityInitialTables());

  assert.equal(result.secondAuthority, true);
  assert.deepEqual(result.signals, ["receiptMissingFromActorProjection"]);
  assert.equal(result.receiptCoveredMutationCount, 0);
});

test("a full receipt retains strict event-range validation", () => {
  const valid = fullReceipt("receipt:full-valid", 1, 1);
  const validResult = assessPublicSingleAuthority([
    authorityTraceEntry(valid, 1, [projectedReceipt(valid)]),
  ], authorityInitialTables());
  assert.equal(validResult.secondAuthority, false);
  assert.deepEqual(validResult.signals, []);
  assert.equal(validResult.receiptCoveredMutationCount, 1);

  const invalid = fullReceipt("receipt:full-invalid", 2, 2);
  const invalidResult = assessPublicSingleAuthority([
    authorityTraceEntry(invalid, 1, [projectedReceipt(invalid)]),
  ], authorityInitialTables());
  assert.equal(invalidResult.secondAuthority, true);
  assert.deepEqual(invalidResult.signals, ["receiptDoesNotCoverMutation"]);
  assert.equal(invalidResult.receiptCoveredMutationCount, 0);
});

test("the deterministic runner fails when a D1 card mutates active item quantity outside the DO event and Receipt head", async () => {
  const mock = await mockAuthoritativeServer({ parallelAuthoritySignal: true });
  try {
    const report = await runLiveKpEvaluation({
      baseUrl: mock.baseUrl,
      roomCode: "EVAL02",
      actors: {
        host: { cookie: "session=host" },
        player: { cookie: "session=player" },
      },
      allowNonProductionTarget: true,
      runId: "runner-parallel-authority-test",
      secretCanary: "ZEVAL-RUNNER-PARALLEL",
      privatePlanCanary: "ZPLAN-RUNNER-PARALLEL",
    });

    assert.equal(report.status, "fail");
    assert.equal(report.hardGates.secondAuthority, true);
    assert.ok(report.metrics.singleAuthoritySignals.includes("activeCardDivergedFromProjection"));
    assert.equal(
      report.authorityEvidence.mutationCount,
      report.authorityEvidence.receiptCoveredMutationCount,
    );
  } finally {
    await mock.close();
  }
});
