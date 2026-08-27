import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  LIVE_KP_CLI_ERROR_CODES,
  LIVE_KP_PROVISION_REPORT_SCHEMA,
  LiveKpProvisionError,
  cleanupProvisionedAuthUsers,
  runProvisionedLiveKpEvalCli,
  runProvisionedLiveKpEvaluation,
} from "../scripts/run-live-kp-eval.mjs";
import { LIVE_KP_EVAL_PRODUCTION_ORIGIN } from "../scripts/live-kp-eval.mjs";

function publicEvaluationReport() {
  return {
    schemaVersion: "zhuwei-live-workers-ai-kp-eval-report-v1",
    status: "pass",
    target: { origin: "https://zhuwei.yinskyriver.workers.dev" },
    execution: {
      liveWorkersAiVerified: true,
      interactionsCompleted: 31,
    },
    redaction: {
      rawIntentStored: false,
      credentialsStored: false,
      narrationStored: false,
      promptStored: false,
      canariesStored: false,
    },
  };
}

async function provisioningServer(options = {}) {
  const calls = [];
  const credentials = [];
  const cookies = ["__Host-zhuwei_session=host-secret", "__Host-zhuwei_session=player-secret"];
  let registrations = 0;
  let eventSeq = 0;
  let sendActionCount = 0;
  let pendingOpen = false;
  let shared = false;
  let concluded = false;
  let secretCanary = "";
  let privatePlanCanary = "";
  const slots = { host: null, player: null };
  const receipts = new Map();
  const knowledge = { host: new Set(), player: new Set() };
  const spotlight = { host: 0, player: 0 };

  function actorFor(request) {
    return request.headers.cookie === cookies[0] ? "host" : "player";
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
          backpack: [],
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
      receipts: [...receipts.values()].map((entry) => entry.receipt),
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
        kp_model: "@cf/zai-org/glm-4.7-flash",
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
          backpack: [],
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
        receipts: [...receipts.values()].map((entry) => entry.receipt),
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
      receipt,
      readModel: readModel(actor),
      delivery: delivery(actor, text, submissionId),
    };
    receipts.set(submissionId, { receipt, outcome });
    return outcome;
  }

  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    calls.push({ path: request.url, cookie: request.headers.cookie, body });
    if (request.url === "/api/auth/register") {
      credentials.push({ email: body.email, password: body.password });
      const cookie = cookies[registrations++];
      response.writeHead(201, {
        "content-type": "application/json",
        "set-cookie": `${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      });
      response.end(JSON.stringify({
        user: {
          userId: registrations === 1
            ? "11111111-1111-4111-8111-111111111111"
            : "22222222-2222-4222-8222-222222222222",
        },
      }));
      return;
    }
    if (request.url === "/api/auth/logout") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.url === "/api/game") {
      const actor = actorFor(request);
      const command = body.command;
      const data = body.data ?? {};
      let result;
      if (command === "createRoom") {
        result = { ok: true, code: "EVAL01" };
      } else if (command === "deleteRoom") {
        result = {
          ok: true,
          code: "EVAL01",
          authorityCleanup: options.authorityCleanup ?? "finalized",
        };
      } else if (["joinRoom", "lockCharacter", "startGame"].includes(command)) {
        result = { ok: true };
      } else if (command === "getRoomManagement") {
        result = {
          ok: true,
          room: {
            code: "EVAL01",
            ruleset_version: "dnd5e-2014-srd5.1-authoritative-v2",
            kp_model: "@cf/zai-org/glm-4.7-flash",
            status: "play",
          },
        };
      } else if (command === "fetchTable") {
        result = table(actor);
      } else if (command === "acknowledgeDelivery") {
        if (slots[actor]?.deliveryId === data.deliveryId) slots[actor] = null;
        result = { ok: true, deliveryId: data.deliveryId };
      } else if (command === "sendAction") {
        sendActionCount += 1;
        if (sendActionCount === options.failSendActionAt) {
          response.writeHead(503, { "content-type": "application/json" });
          response.end(JSON.stringify({
            code: "simulatedUpstreamFailure",
            detail: `${cookies[0]} must never escape`,
          }));
          return;
        }
        const tags = String(data.submissionId).split(":tag=")[1]?.split(",") ?? [];
        const cached = receipts.get(data.submissionId);
        if (cached) {
          result = { ok: true, submissionId: data.submissionId, outcome: cached.outcome };
        } else if (data.pendingInputId === "pending:private-choice" && actor === "player") {
          result = {
            ok: false,
            submissionId: data.submissionId,
            outcomeKind: "rejected",
            error: "当前行动没有被接受",
          };
        } else if (data.pendingInputId === "pending:private-choice" && actor === "host") {
          pendingOpen = false;
          result = {
            ok: true,
            submissionId: data.submissionId,
            outcome: committed(actor, data.submissionId, tags),
          };
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
            receipt,
            readModel: readModel(actor),
            pending: { pendingInputId: "pending:private-choice", kind: "clarification" },
          };
          receipts.set(data.submissionId, { receipt, outcome });
          result = {
            ok: true,
            submissionId: data.submissionId,
            outcome,
          };
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
          result = { ok: true, submissionId: data.submissionId, outcome };
        }
      } else {
        result = { ok: false, error: "unknown command" };
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    credentials,
    cookies,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function routeProductionTo(mock) {
  return (input, init) => {
    const requested = new URL(input);
    const routed = new URL(`${requested.pathname}${requested.search}`, mock.baseUrl);
    return fetch(routed, init);
  };
}

test("provisions two distinct fighter seats, verifies the live report, and exactly reports cleanup", async () => {
  const mock = await provisioningServer();
  let evaluationInput;
  let authCleanupInput;
  try {
    const report = await runProvisionedLiveKpEvaluation({
      baseUrl: mock.baseUrl,
      allowNonProductionTarget: true,
      authCleanup: async (input) => {
        authCleanupInput = input;
        assert.equal(mock.calls.filter((call) => call.path === "/api/auth/logout").length, 2);
        assert.equal(
          mock.calls.filter((call) => call.body?.command === "deleteRoom").length,
          1,
        );
        return { status: "deletedAndVerified" };
      },
      evaluationRunner: async (input) => {
        evaluationInput = input;
        return publicEvaluationReport();
      },
    });

    assert.equal(report.schemaVersion, LIVE_KP_PROVISION_REPORT_SCHEMA);
    assert.equal(report.status, "pass");
    assert.equal(report.evaluation.execution.interactionsCompleted >= 24, true);
    assert.equal(report.evaluation.execution.liveWorkersAiVerified, true);
    assert.deepEqual(report.cleanup, {
      room: {
        status: "deleteRoomConfirmed",
        authorityCleanup: "finalized",
      },
      sessions: { host: "revoked", player: "revoked" },
      authUsers: {
        status: "deletedAndVerified",
        confirmedCount: 2,
        uncertainCount: 0,
      },
    });

    assert.equal(evaluationInput.roomCode, "EVAL01");
    assert.notEqual(evaluationInput.actors.host.cookie, evaluationInput.actors.player.cookie);
    assert.deepEqual(authCleanupInput.users.map((user) => user.role), ["host", "player"]);
    assert.ok(authCleanupInput.users.every((user) => /^[0-9a-f-]{36}$/u.test(user.userId)));

    const commands = mock.calls
      .filter((call) => call.path === "/api/game")
      .map((call) => call.body.command);
    assert.deepEqual(commands, [
      "createRoom",
      "joinRoom",
      "lockCharacter",
      "lockCharacter",
      "startGame",
      "deleteRoom",
    ]);
    const drafts = mock.calls
      .filter((call) => call.body?.command === "lockCharacter")
      .map((call) => call.body.data.draft);
    assert.equal(drafts.length, 2);
    assert.ok(drafts.every((draft) => draft.classId === "fighter"));
    assert.notDeepEqual(drafts[0], drafts[1]);

    const serialized = JSON.stringify(report);
    for (const credential of mock.credentials) {
      assert.equal(serialized.includes(credential.email), false);
      assert.equal(serialized.includes(credential.password), false);
    }
    for (const user of authCleanupInput.users) assert.equal(serialized.includes(user.userId), false);
    for (const cookie of mock.cookies) assert.equal(serialized.includes(cookie), false);
  } finally {
    await mock.close();
  }
});

test("runs the real 31-interaction evaluator through a production-routed mock HTTP lifecycle", async () => {
  const mock = await provisioningServer();
  try {
    const report = await runProvisionedLiveKpEvaluation({
      baseUrl: LIVE_KP_EVAL_PRODUCTION_ORIGIN,
      fetchImpl: routeProductionTo(mock),
      authCleanup: async () => ({ status: "deletedAndVerified" }),
    });

    assert.equal(report.status, "pass");
    assert.equal(report.evaluation.status, "pass");
    assert.equal(report.evaluation.execution.mode, "live");
    assert.equal(report.evaluation.execution.liveWorkersAiVerified, true);
    assert.equal(report.evaluation.execution.interactionsCompleted, 31);
    assert.deepEqual(report.evaluation.authorityEvidence.signals, []);
    assert.equal(
      report.evaluation.authorityEvidence.mutationCount,
      report.evaluation.authorityEvidence.receiptCoveredMutationCount,
    );
    assert.ok(report.evaluation.authorityEvidence.mutationCount > 0);
    assert.deepEqual(report.cleanup.room, {
      status: "deleteRoomConfirmed",
      authorityCleanup: "finalized",
    });
    assert.deepEqual(report.cleanup.sessions, { host: "revoked", player: "revoked" });
    assert.equal(report.cleanup.authUsers.status, "deletedAndVerified");

    const commands = mock.calls
      .filter((call) => call.path === "/api/game")
      .map((call) => call.body.command);
    assert.equal(commands.filter((command) => command === "sendAction").length >= 24, true);
    assert.equal(commands.at(-1), "deleteRoom");
    const logoutCalls = mock.calls.filter((call) => call.path === "/api/auth/logout");
    assert.equal(logoutCalls.length, 2);

    const serialized = JSON.stringify(report);
    for (const credential of mock.credentials) {
      assert.equal(serialized.includes(credential.email), false);
      assert.equal(serialized.includes(credential.password), false);
    }
    for (const cookie of mock.cookies) assert.equal(serialized.includes(cookie), false);
  } finally {
    await mock.close();
  }
});

test("an evaluation HTTP failure still deletes the room and revokes both sessions without leaking details", async () => {
  const mock = await provisioningServer({ failSendActionAt: 12 });
  try {
    let failure;
    try {
      await runProvisionedLiveKpEvaluation({
        baseUrl: LIVE_KP_EVAL_PRODUCTION_ORIGIN,
        fetchImpl: routeProductionTo(mock),
        authCleanup: async () => ({ status: "deletedAndVerified" }),
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof LiveKpProvisionError);
    assert.equal(failure.code, LIVE_KP_CLI_ERROR_CODES.evaluationExecution);
    assert.equal(failure.report.status, "error");
    assert.deepEqual(failure.report.cleanup, {
      room: {
        status: "deleteRoomConfirmed",
        authorityCleanup: "finalized",
      },
      sessions: { host: "revoked", player: "revoked" },
      authUsers: {
        status: "deletedAndVerified",
        confirmedCount: 2,
        uncertainCount: 0,
      },
    });

    const commands = mock.calls
      .filter((call) => call.path === "/api/game")
      .map((call) => call.body.command);
    assert.equal(commands.includes("deleteRoom"), true);
    assert.equal(mock.calls.filter((call) => call.path === "/api/auth/logout").length, 2);

    const serialized = JSON.stringify(failure.report);
    assert.equal(serialized.includes("simulatedUpstreamFailure"), false);
    assert.equal(serialized.includes("must never escape"), false);
    for (const credential of mock.credentials) {
      assert.equal(serialized.includes(credential.email), false);
      assert.equal(serialized.includes(credential.password), false);
    }
    for (const cookie of mock.cookies) assert.equal(serialized.includes(cookie), false);
  } finally {
    await mock.close();
  }
});

test("scheduled room deletion and failed exact auth cleanup cannot produce a passing evaluation", async () => {
  const mock = await provisioningServer({ authorityCleanup: "scheduled" });
  try {
    let failure;
    try {
      await runProvisionedLiveKpEvaluation({
        baseUrl: mock.baseUrl,
        allowNonProductionTarget: true,
        evaluationRunner: async () => publicEvaluationReport(),
        authCleanup: async () => {
          throw new Error(`${mock.credentials[0]?.email ?? "email"} raw wrangler stderr`);
        },
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof LiveKpProvisionError);
    assert.equal(failure.code, LIVE_KP_CLI_ERROR_CODES.cleanupIncomplete);
    assert.deepEqual(failure.report.cleanup.room, {
      status: "deleteRoomScheduled",
      authorityCleanup: "scheduled",
    });
    assert.deepEqual(failure.report.cleanup.authUsers, {
      status: "cleanupUnconfirmed",
      confirmedCount: 2,
      uncertainCount: 0,
    });
    assert.equal(JSON.stringify(failure.report).includes("raw wrangler stderr"), false);
    for (const credential of mock.credentials) {
      assert.equal(JSON.stringify(failure.report).includes(credential.email), false);
    }
  } finally {
    await mock.close();
  }
});

test("exact auth cleanup uses the local Wrangler executable without a shell and verifies zero rows", async () => {
  const calls = [];
  const execFileImpl = (file, args, options, callback) => {
    calls.push({ file, args, options });
    if (calls.length === 1) {
      callback(null, JSON.stringify([{ success: true, results: [] }]), "");
      return;
    }
    callback(null, JSON.stringify([{
      success: true,
      results: [{ auth_users_remaining: 0, auth_sessions_remaining: 0 }],
    }]), "");
  };
  const users = [
    {
      role: "host",
      userId: "11111111-1111-4111-8111-111111111111",
      email: "zhuwei-live-eval-host-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa@example.test",
    },
    {
      role: "player",
      userId: "22222222-2222-4222-8222-222222222222",
      email: "zhuwei-live-eval-player-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb@example.test",
    },
  ];

  const result = await cleanupProvisionedAuthUsers({ users, execFileImpl });

  assert.deepEqual(result, { status: "deletedAndVerified" });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(call.file, /\/node_modules\/\.bin\/wrangler$/u);
    assert.equal(call.options.shell, false);
    assert.deepEqual(call.args.slice(0, 8), [
      "d1",
      "execute",
      "zhuwei-dev",
      "--remote",
      "--config",
      "wrangler.jsonc",
      "--yes",
      "--json",
    ]);
    assert.equal(call.args[8], "--command");
  }
  const deleteSql = calls[0].args[9];
  assert.ok(deleteSql.indexOf("DELETE FROM auth_sessions") < deleteSql.indexOf("DELETE FROM auth_users"));
  for (const user of users) {
    assert.ok(deleteSql.includes(`'${user.userId}'`));
    assert.ok(deleteSql.includes(`'${user.email}'`));
  }
  const verifySql = calls[1].args[9];
  assert.match(verifySql, /auth_users_remaining/u);
  assert.match(verifySql, /auth_sessions_remaining/u);
});

test("exact auth cleanup rejects unsafe identifiers without invoking Wrangler or exposing values", async () => {
  let called = false;
  const unsafeValue = "x'); DROP TABLE auth_users; --";
  await assert.rejects(
    cleanupProvisionedAuthUsers({
      users: [{
        role: "host",
        userId: unsafeValue,
        email: "zhuwei-live-eval-host-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa@example.test",
      }],
      execFileImpl: () => {
        called = true;
      },
    }),
    (error) => {
      assert.equal(error.code, LIVE_KP_CLI_ERROR_CODES.authCleanup);
      assert.equal(error.message.includes(unsafeValue), false);
      return true;
    },
  );
  assert.equal(called, false);
});

test("exact auth cleanup turns Wrangler output and nonzero verification into one stable error", async () => {
  const users = [{
    role: "host",
    userId: "11111111-1111-4111-8111-111111111111",
    email: "zhuwei-live-eval-host-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa@example.test",
  }];
  for (const mode of ["execFailure", "nonzeroVerification"]) {
    let call = 0;
    const rawCanary = `WRANGLER-RAW-${mode}`;
    await assert.rejects(
      cleanupProvisionedAuthUsers({
        users,
        execFileImpl: (_file, _args, _options, callback) => {
          call += 1;
          if (mode === "execFailure") {
            callback(new Error(rawCanary), "", rawCanary);
            return;
          }
          callback(null, call === 1
            ? JSON.stringify([{ success: true, results: [] }])
            : JSON.stringify([{
                success: true,
                results: [{ auth_users_remaining: 1, auth_sessions_remaining: 0 }],
              }]), rawCanary);
        },
      }),
      (error) => {
        assert.equal(error.code, LIVE_KP_CLI_ERROR_CODES.authCleanup);
        assert.equal(error.message.includes(rawCanary), false);
        return true;
      },
    );
  }
});

test("the CLI rejects arguments and unexpected failures with content-free stable codes", async () => {
  const writes = [];
  const usageExit = await runProvisionedLiveKpEvalCli({
    argv: ["--password=must-not-appear"],
    write: (value) => writes.push(value),
  });
  assert.equal(usageExit, 64);
  const usage = JSON.parse(writes.pop());
  assert.equal(usage.error.code, LIVE_KP_CLI_ERROR_CODES.unsupportedArguments);
  assert.equal(JSON.stringify(usage).includes("must-not-appear"), false);

  const runtimeExit = await runProvisionedLiveKpEvalCli({
    argv: [],
    run: async () => {
      throw new Error("__Host-zhuwei_session=forbidden raw narration prompt canary");
    },
    write: (value) => writes.push(value),
  });
  assert.equal(runtimeExit, 1);
  const runtime = JSON.parse(writes.pop());
  assert.equal(runtime.error.code, LIVE_KP_CLI_ERROR_CODES.unexpected);
  const serialized = JSON.stringify(runtime);
  assert.equal(serialized.includes("zhuwei_session"), false);
  assert.equal(serialized.includes("raw narration"), false);
  assert.equal(serialized.includes("prompt"), false);
  assert.equal(serialized.includes("canary"), false);
});
