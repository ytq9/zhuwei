import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { playTableSnapFixture } from "../../support/fixtures/tactical-map-v2.mjs";
import { RETRY_DECLINE_TEXT } from "../../../app/_runtime/lib/kp/vnext/retry-question.ts";

// SPEC 0016 §7.2 (ADR 0081): the KP's one question after a failed
// conversation is answered from the composer in the player's own words, or
// declined with one button that sends the same decline the transcript shows.
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
async function settleUntil(act, done, turns = 100) {
  for (let turn = 0; turn < turns && !done(); turn++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

test("a question waits for words from the composer or a decline from its button", async () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: memoryStorage() });
  const originalFetch = globalThis.fetch, previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body ?? "{}"));
    if (request.command === "sendAction") calls.push(request.data);
    return Response.json({ ok: true, action: "committed", narration: "published", outcome: { kind: "committed" } });
  };
  let renderer, client;
  try {
    const [{ QueryClient, QueryClientProvider }, { compileSheet }, { PlayTable }, { act, create }] = await Promise.all([
      import("@tanstack/react-query"), import("../../../app/_runtime/lib/dnd/compute.ts"),
      import("../../../app/_runtime/components/play-table.tsx"), import("react-test-renderer"),
    ]);
    const snap = playTableSnapFixture(compileSheet);
    snap.state.authoritative.inCombat = false;
    delete snap.state.authoritative.tacticalProjection;
    snap.state.pendingInputs = [{ pendingInputId: "retry-question:press", rootActionId: "root-action:press",
      question: "上次她没有松口，这次有什么不同？", kind: "clarification" }];
    client = new QueryClient();
    await act(async () => { renderer = create(createElement(QueryClientProvider, { client }, createElement(PlayTable, { code: "TACTIC", snap }))); });
    assert.match(JSON.stringify(renderer.toJSON()), /上次她没有松口，这次有什么不同？/);
    // The composer stays open and answers the question in the player's words.
    await act(async () => { renderer.root.findByType("textarea").props.onChange({ target: { value: "我把她父亲留下的信拿给她看。" } }); });
    await act(async () => { renderer.root.findByProps({ "aria-label": "发送行动" }).props.onClick(); });
    await settleUntil(act, () => calls.length >= 1);
    assert.equal(calls[0].pendingInputId, "retry-question:press");
    assert.equal(calls[0].text, "我把她父亲留下的信拿给她看。");
    assert.equal(calls[0].answer, undefined, "the table turns composer words into { text }");
    // The decline is one button.
    await act(async () => { renderer.root.findByProps({ "data-pending-decline": true }).props.onClick(); });
    await settleUntil(act, () => calls.length >= 2);
    assert.deepEqual(calls[1].answer, { decline: true });
    assert.equal(calls[1].pendingInputId, "retry-question:press");
    assert.equal(calls[1].text, RETRY_DECLINE_TEXT);
  } finally {
    if (renderer) { const { act } = await import("react-test-renderer"); await act(async () => renderer.unmount()); }
    client?.clear();
    globalThis.fetch = originalFetch;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    if (previousStorage) Object.defineProperty(globalThis, "sessionStorage", previousStorage); else delete globalThis.sessionStorage;
  }
});
