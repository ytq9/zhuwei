import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { callGame } from "../../../app/_runtime/lib/platform/game-client.ts";
import { gameRequestDiagnostics } from "../../../app/_runtime/lib/platform/game-request-diagnostics.ts";
import { createDiagnosticReference, diagnosticCopyText, diagnosticMessage, diagnosticReferenceFromMessage,
  DIAGNOSTIC_HEADER } from "../../../app/_runtime/lib/platform/diagnostic-reference.ts";
import { buildRoomTelemetryEvent, failureCodeIsRetryable } from "../../../app/_runtime/lib/room/telemetry.ts";
import { PROPOSAL_PUBLIC_FAILURE_CODES } from "../../../app/_runtime/lib/kp/public-failure-codes.ts";
import { publicAuthoritativeOutcomeError } from "../../../app/_runtime/lib/table/authoritative.ts";
import { referenceHash, relatedTimeline, parseDocuments, diagnosticReport, diagnosticTimeframe } from "../../../tools/diagnostics/telemetry.mjs";
import { queryHistory } from "../../../tools/diagnose-game.mjs";

test("a public business error leads from the real client through diagnostics to an isolated log timeline", async () => {
  const originalFetch = globalThis.fetch, originalInfo = console.info, logs = [], requests = [];
  console.info = value => logs.push(JSON.parse(value));
  globalThis.fetch = async (_url, init) => {
    const request = new Request("https://zhuwei.test/api/game", init), body = await request.json();
    requests.push(body);
    const diagnostics = gameRequestDiagnostics(request);
    diagnostics.started(body.command, "PRIVATE_USER", body.data);
    const result = { action: "notCommitted", retryable: true, code: "STORY_OUTPUT_INVALID",
      error: publicAuthoritativeOutcomeError({ kind: "rejected", code: "STORY_OUTPUT_INVALID" }) };
    diagnostics.completed(body.command, "PRIVATE_USER", body.data, result);
    return diagnostics.response(Response.json(result));
  };
  try {
    const data = { text: "PRIVATE_DRAFT", submissionId: "PRIVATE_STABLE_SUBMISSION" };
    const first = await callGame("sendAction", data), second = await callGame("sendAction", data);
    const firstRef = diagnosticReferenceFromMessage(first.error), secondRef = diagnosticReferenceFromMessage(second.error);
    assert.ok(firstRef); assert.notEqual(firstRef, secondRef);
    assert.deepEqual(requests.map(row => row.data), [data, data]);
    assert.equal(first.action, "notCommitted"); assert.equal(first.retryable, true);
    const timeline = relatedTimeline(logs, firstRef);
    assert.ok(timeline.some(row => row.requestId === referenceHash(firstRef) && row.errorCode === "STORY_OUTPUT_INVALID"));
    assert.ok(timeline.some(row => row.requestId === referenceHash(secondRef)), "same submission retry remains traceable");
    assert.doesNotMatch(JSON.stringify(timeline), /PRIVATE_|PRIVATE_DRAFT/);
    assert.doesNotMatch(diagnosticCopyText(first.error), /PRIVATE_|本次生成内容/);
  } finally { globalThis.fetch = originalFetch; console.info = originalInfo; }
});

test("all story public codes retain their explanations and log codes without changing retry policy", () => {
  for (const code of PROPOSAL_PUBLIC_FAILURE_CODES.filter(code => code.startsWith("STORY_"))) {
    assert.doesNotMatch(publicAuthoritativeOutcomeError({ kind: "retryableFailure", code }), /没有提供可公开的具体原因/, code);
    assert.equal(buildRoomTelemetryEvent({ failure: { code } }).errorCode, code);
    assert.equal(failureCodeIsRetryable(code), true, "diagnostic-only mappings must not change recovery affordances");
  }
  const provider = buildRoomTelemetryEvent({ failure: { code: "STORY_PROVIDER_FAILED" } });
  assert.equal(provider.failureClass, undefined, "an unspecified provider failure is not evidence of a transient cause");
  assert.equal(provider.failureRetryability, "unknown");
  assert.match(publicAuthoritativeOutcomeError({ kind: "rejected", code: "PRIVATE_EXCEPTION" }), /没有提供可公开的具体原因/);
});

test("network and malformed responses retain attempt references without surfacing gateway contents", async () => {
  const original = globalThis.fetch;
  try {
    for (const fail of [async () => { throw new Error("PRIVATE_NETWORK"); }, async () => new Response("PRIVATE_GATEWAY", { status: 502 })]) {
      let reference;
      globalThis.fetch = async (...args) => { reference = args[1].headers[DIAGNOSTIC_HEADER]; return fail(); };
      await assert.rejects(() => callGame("sendAction", { text: "PRIVATE_DRAFT" }), error => {
        assert.equal(diagnosticReferenceFromMessage(error.message), reference);
        assert.doesNotMatch(error.message, /PRIVATE_/); return true;
      });
    }
  } finally { globalThis.fetch = original; }
});

test("offline reports isolate references and never export headers, messages or unknown fields", () => {
  const first = createDiagnosticReference(), second = createDiagnosticReference();
  const row = ref => buildRoomTelemetryEvent({ requestId: ref, occurredAt: new Date().toISOString(), eventName: "http.game.completed" });
  const docs = parseDocuments(JSON.stringify({ source: JSON.stringify(row(first)), $metadata: { message: "PRIVATE_BODY", url: "PRIVATE_URL" } })
    + "\n" + JSON.stringify({ logs: [{ message: [JSON.stringify(row(second))] }], request: { headers: "PRIVATE_COOKIE" } }));
  assert.equal(relatedTimeline(docs.values, first).length, 1);
  const report = diagnosticReport(relatedTimeline(docs.values), { source: "file" });
  assert.equal(relatedTimeline([report], first).length, 1);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|headers|url/);
  assert.equal(diagnosticReport([], { source: "history" }).status, "no_matching_events");
});

test("history lookup uses bounded queries, follows verified correlations and distinguishes access failures", async () => {
  const reference = createDiagnosticReference(), timeframe = diagnosticTimeframe({ reference });
  const anchor = buildRoomTelemetryEvent({ requestId: reference, correlation: { submissionId: "opaque" },
    occurredAt: new Date().toISOString(), eventName: "http.game.completed" });
  const related = buildRoomTelemetryEvent({ correlation: { submissionId: "opaque" }, eventName: "room.model.invocation.completed",
    occurredAt: new Date().toISOString(), failure: { code: "STORY_OUTPUT_INVALID" } });
  const requests = [];
  const result = await queryHistory({ reference, timeframe, query: async body => {
    requests.push(body);
    return { events: [{ source: requests.length === 1 ? anchor : related, $metadata: { id: "event-id", requestId: "cf-request" } }] };
  } });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].parameters.needle.value, referenceHash(reference));
  assert.ok(requests.every(row => row.dry === true && row.limit === 200 && row.timeframe === timeframe));
  assert.ok(result.timeline.some(row => row.errorCode === "STORY_OUTPUT_INVALID"));
  await assert.rejects(() => queryHistory({ reference, timeframe, query: async () => { throw new Error("HTTP 403"); } }), /403/);
  let pages = 0;
  const limited = await queryHistory({ timeframe, query: async () => {
    pages++; return { events: Array.from({ length: 200 }, (_, i) => ({ source: anchor, $metadata: { id: `${pages}-${i}` } })) };
  } });
  assert.equal(pages, 3); assert.equal(limited.truncated, true);
});

test("history correlates indexed structured fields when application requestId overrides metadata", async () => {
  // SPEC 0011 §5: Cloudflare indexes JSON fields directly; metadata.message
  // is absent and metadata.requestId may contain our application hash.
  const reference = createDiagnosticReference(), timeframe = diagnosticTimeframe({ reference });
  const event = (eventName, requestId, submissionId) => buildRoomTelemetryEvent({
    requestId, eventName, occurredAt: new Date().toISOString(),
    correlation: { submissionId, roomId: "same-room" },
  });
  const row = (id, source, workerRequest) => ({ source,
    $workers: { requestId: workerRequest },
    $metadata: { id, service: "zhuwei", requestId: source.requestId ?? workerRequest },
  });
  const anchor = row("anchor", event("http.game.completed", reference, "submission"), "cf-current");
  const retry = row("retry", event("http.game.started", createDiagnosticReference(), "submission"), "cf-prior");
  const proposal = row("proposal", event("kp.vnext.invocation", undefined, "submission"), "cf-current");
  const sameRequest = row("same-request", event("room.model.invocation.completed", undefined, undefined), "cf-current");
  const unrelated = row("unrelated", event("room.action.completed", createDiagnosticReference(), "other"), "cf-other");
  const otherService = { ...proposal, $metadata: { ...proposal.$metadata, id: "other-service", service: "other-worker" } };
  const rows = [anchor, retry, proposal, sameRequest, unrelated, otherService], requests = [];
  function matches(row, filter) {
    if (filter.kind === "group") return filter.filterCombination === "or"
      ? filter.filters.some(child => matches(row, child)) : filter.filters.every(child => matches(row, child));
    const value = filter.key.startsWith("$")
      ? filter.key.split(".").reduce((value, key) => value?.[key], row) : row.source[filter.key];
    return filter.operation === "eq" ? value === filter.value
      : filter.operation === "includes" && typeof value === "string" && value.includes(filter.value);
  }
  const result = await queryHistory({ reference, timeframe, query: async body => {
    requests.push(body);
    return { events: rows.filter(row => body.parameters.filters.every(filter => matches(row, filter))
      && (!body.parameters.needle || JSON.stringify(row).includes(body.parameters.needle.value))) };
  } });
  assert.deepEqual(result.timeline.map(row => row.eventName).sort(),
    [anchor, retry, proposal, sameRequest].map(row => row.source.eventName).sort());
  assert.equal(requests.length, 2);
  assert.equal(result.truncated, false);
  assert.doesNotMatch(JSON.stringify(result.timeline), /same-room|cf-current|other-worker/);
});

test("copying diagnostic information uses the clipboard and reports clipboard failure honestly", async () => {
  const { DiagnosticCopy } = await import("../../../app/_runtime/components/diagnostic-copy.tsx");
  const { act, create } = await import("react-test-renderer");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator"), previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, copied;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async value => { copied = value; } } } });
  try {
    const message = diagnosticMessage("PRIVATE_BODY", createDiagnosticReference());
    await act(async () => { renderer = create(createElement(DiagnosticCopy, { message })); });
    await act(async () => renderer.root.findByType("button").props.onClick());
    assert.equal(copied, diagnosticCopyText(message)); assert.doesNotMatch(copied, /PRIVATE_BODY/);
    assert.match(JSON.stringify(renderer.toJSON()), /已复制/);
    navigator.clipboard.writeText = async () => { throw new Error("denied"); };
    await act(async () => renderer.root.findByType("button").props.onClick());
    assert.match(JSON.stringify(renderer.toJSON()), /未能复制/);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else delete globalThis.navigator;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
});
