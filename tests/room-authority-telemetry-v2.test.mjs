import assert from "node:assert/strict";
import test from "node:test";

const ROOM_ID = "room:authority-telemetry-private";
const PRINCIPAL_ID = "principal:authority-telemetry-private";
const SUBMISSION_ID = "submission:authority-telemetry-private";

function clockFrom(values) {
  const queue = [...values];
  return () => {
    assert.ok(queue.length > 0, "the telemetry wrapper used an unexpected clock read");
    return queue.shift();
  };
}

test("Room Authority emits one exact SLO sample for prepare, observe, commit, and ack", async () => {
  const { withRoomAuthorityTelemetry } = await import(
    "../app/_runtime/lib/room/authority-telemetry.ts"
  );
  const emitted = [];
  const observeQueries = [];
  const authority = withRoomAuthorityTelemetry({
    async prepare() {
      return { kind: "prepared", preparedActionId: "prepared:private" };
    },
    async observe(_principal, query) {
      observeQueries.push(query);
      return { readModel: { secret: "PRIVATE_PROJECTION_MUST_NOT_REACH_LOGS" } };
    },
    async commit() {
      return {
        kind: "committed",
        receipt: {
          receiptId: "receipt:private",
          rootActionId: "root:private",
        },
      };
    },
    async acknowledge() {
      return { kind: "acknowledged" };
    },
  }, {
    roomId: ROOM_ID,
    principalId: PRINCIPAL_ID,
    requestId: SUBMISSION_ID,
    submissionId: SUBMISSION_ID,
    clock: clockFrom([1_000, 1_012, 2_000, 2_034, 3_000, 3_056, 4_000, 4_078]),
    emit(event) {
      emitted.push(event);
    },
  });

  await authority.prepare({}, { kind: "intent", submissionId: SUBMISSION_ID, text: "SECRET" });
  await authority.observe({}, { sinceEventSeq: 12 });
  await authority.commit({}, "prepared:private", {
    kind: "ActionPlan",
    rootActionId: "root:private",
  });
  await authority.acknowledge({}, "delivery:private");

  assert.deepEqual(observeQueries, [{ sinceEventSeq: 12 }]);

  assert.deepEqual(
    emitted.map((event) => ({
      operation: event.authorityOperation,
      result: event.authorityResult,
      durationMs: event.durationMs,
      eventName: event.eventName,
      outcomeKind: event.outcomeKind,
    })),
    [
      {
        operation: "prepare",
        result: "completed",
        durationMs: 12,
        eventName: "room.authority.prepare.completed",
        outcomeKind: "prepared",
      },
      {
        operation: "observe",
        result: "completed",
        durationMs: 34,
        eventName: "room.authority.observe.completed",
        outcomeKind: "observed",
      },
      {
        operation: "commit",
        result: "completed",
        durationMs: 56,
        eventName: "room.authority.commit.completed",
        outcomeKind: "committed",
      },
      {
        operation: "ack",
        result: "completed",
        durationMs: 78,
        eventName: "room.authority.ack.completed",
        outcomeKind: "acknowledged",
      },
    ],
  );
  for (const event of emitted) {
    const encoded = JSON.stringify(event);
    assert.equal(event.schemaVersion, "zhuwei.room-telemetry/v1");
    assert.match(event.roomHash, /^sha256:[0-9a-f]{64}$/);
    assert.match(event.principalHash, /^sha256:[0-9a-f]{64}$/);
    assert.match(event.requestId, /^sha256:[0-9a-f]{64}$/);
    assert.equal(encoded.includes(ROOM_ID), false);
    assert.equal(encoded.includes(PRINCIPAL_ID), false);
    assert.equal(encoded.includes(SUBMISSION_ID), false);
    assert.equal(encoded.includes("SECRET"), false);
    assert.equal(encoded.includes("PRIVATE_PROJECTION"), false);
  }
});

test("Room Authority retryable returns and thrown calls stay classified without changing results", async () => {
  const { withRoomAuthorityTelemetry } = await import(
    "../app/_runtime/lib/room/authority-telemetry.ts"
  );
  const emitted = [];
  const retryable = { kind: "retryableFailure", code: "authorityTransient" };
  const authority = withRoomAuthorityTelemetry({
    async prepare() {
      return retryable;
    },
    async observe() {
      throw new Error("PRIVATE_AUTHORITY_STACK");
    },
    async commit() {
      throw new Error("not used");
    },
    async acknowledge() {
      throw new Error("not used");
    },
  }, {
    roomId: ROOM_ID,
    principalId: PRINCIPAL_ID,
    requestId: SUBMISSION_ID,
    submissionId: SUBMISSION_ID,
    clock: clockFrom([10, 20, 30, 45]),
    emit(event) {
      emitted.push(event);
    },
  });

  assert.equal(await authority.prepare({}, {
    kind: "intent",
    submissionId: SUBMISSION_ID,
    text: "SECRET",
  }), retryable);
  await assert.rejects(authority.observe({}), /PRIVATE_AUTHORITY_STACK/);

  assert.deepEqual(
    emitted.map((event) => ({
      operation: event.authorityOperation,
      result: event.authorityResult,
      durationMs: event.durationMs,
      failureClass: event.failureClass,
      errorCode: event.errorCode,
    })),
    [
      {
        operation: "prepare",
        result: "retryableFailure",
        durationMs: 10,
        failureClass: "authorityTransient",
        errorCode: "authorityTransient",
      },
      {
        operation: "observe",
        result: "exception",
        durationMs: 15,
        failureClass: "authorityTransient",
        errorCode: "authorityTransient",
      },
    ],
  );
  assert.equal(JSON.stringify(emitted).includes("PRIVATE_AUTHORITY_STACK"), false);
});

test("Room Authority classifies the actual public codes emitted by Rules and Room outcomes", async () => {
  const { withRoomAuthorityTelemetry } = await import(
    "../app/_runtime/lib/room/authority-telemetry.ts"
  );
  const cases = [
    [{ kind: "rejected", code: "unauthenticated", explanation: "safe" }, "authentication"],
    [{ kind: "rejected", code: "seatInactive", explanation: "safe" }, "authentication"],
    [{ kind: "rejected", code: "notController", explanation: "safe" }, "authorization"],
    [{ kind: "rejected", code: "invalidRulesInput", explanation: "safe" }, "validation"],
    [{ kind: "rejected", code: "scopeConflict", explanation: "safe" }, "scopeConflict"],
    [{ kind: "needsKp", receipt: { receiptId: "receipt:diagnostic" }, diagnostics: [{}] }, "mechanicalDiagnostic"],
    [{ kind: "needsKp", code: "correctionRequired", receipt: { receiptId: "receipt:reported" }, diagnostics: [] }, "correctionRequired"],
    [{ kind: "rejected", code: "missingPrerequisite", explanation: "safe" }, "worldInfeasible"],
    [{ kind: "rejected", code: "modelPermanent", explanation: "safe" }, "modelPermanent"],
    [{ kind: "retryableFailure", code: "modelTransient" }, "modelTransient"],
    [{ kind: "retryableFailure", code: "authorityTransient" }, "authorityTransient"],
    [{ kind: "retryableFailure", code: "projectionFailure" }, "projectionIntegrity"],
    [{ kind: "retryableFailure", code: "correctionRequired" }, "correctionRequired"],
    [{ kind: "retryableFailure", code: "quotaExhausted" }, "quotaExhausted"],
  ];
  const emitted = [];
  let cursor = 0;
  const authority = withRoomAuthorityTelemetry({
    async prepare() {
      return cases[cursor++][0];
    },
    async observe() {
      throw new Error("not used");
    },
    async commit() {
      throw new Error("not used");
    },
    async acknowledge() {
      throw new Error("not used");
    },
  }, {
    roomId: ROOM_ID,
    principalId: PRINCIPAL_ID,
    clock: () => cursor * 10,
    emit(event) {
      emitted.push(event);
    },
  });

  for (let index = 0; index < cases.length; index += 1) {
    await authority.prepare({}, {
      kind: "intent",
      submissionId: `${SUBMISSION_ID}:${index}`,
      text: "SECRET",
    });
  }
  assert.deepEqual(
    emitted.map((event) => event.failureClass),
    cases.map(([, expected]) => expected),
  );
});

test("Room Authority telemetry preserves delivery recovery capabilities without logging payloads", async () => {
  const { withRoomAuthorityTelemetry } = await import(
    "../app/_runtime/lib/room/authority-telemetry.ts"
  );
  const calls = [];
  const emitted = [];
  const authority = withRoomAuthorityTelemetry({
    async prepare() {
      throw new Error("not used");
    },
    async observe() {
      throw new Error("not used");
    },
    async commit() {
      throw new Error("not used");
    },
    async acknowledge() {
      throw new Error("not used");
    },
    async deliveryPublicationStatus(query) {
      calls.push(["status", query]);
      return { kind: "published", frameIds: ["frame:stable"] };
    },
    async publishDelivery(authorization, publication) {
      calls.push(["publish", authorization, publication]);
      return { kind: "published", frameIds: ["frame:stable"] };
    },
  }, {
    roomId: ROOM_ID,
    principalId: PRINCIPAL_ID,
    emit(event) {
      emitted.push(event);
    },
  });

  assert.equal(typeof authority.deliveryPublicationStatus, "function");
  assert.equal(typeof authority.publishDelivery, "function");
  assert.deepEqual(
    await authority.deliveryPublicationStatus({ publishCapability: "PRIVATE_CAPABILITY" }),
    { kind: "published", frameIds: ["frame:stable"] },
  );
  assert.deepEqual(
    await authority.publishDelivery(
      { publishCapability: "PRIVATE_CAPABILITY" },
      { frames: [{ privateNarration: "PRIVATE_FRAME" }] },
    ),
    { kind: "published", frameIds: ["frame:stable"] },
  );
  assert.deepEqual(calls, [
    ["status", { publishCapability: "PRIVATE_CAPABILITY" }],
    [
      "publish",
      { publishCapability: "PRIVATE_CAPABILITY" },
      { frames: [{ privateNarration: "PRIVATE_FRAME" }] },
    ],
  ]);
  assert.deepEqual(emitted, []);
});
