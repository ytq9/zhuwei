import assert from "node:assert/strict";
import test from "node:test";
import { fetchTable, sendAction } from "../app/_runtime/lib/table/client.ts";
import { transcribeAudio } from "../app/_runtime/lib/voice/client.ts";
import { projectAuthoritativeTableObservation } from "../app/_runtime/lib/table/authoritative.ts";

test("player error feedback explains transport failures and how to recover without exposing raw responses", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("<html>PRIVATE_PROXY_DIAGNOSTIC</html>", { status: 502 });
    await assert.rejects(() => fetchTable({ data: "ERRORS" }), error => {
      assert.match(error.message, /服务|网关/);
      assert.match(error.message, /刷新|重试/);
      assert.doesNotMatch(error.message, /PRIVATE_|Unexpected token|html/);
      return true;
    });
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch PRIVATE_TRANSPORT_DETAIL"); };
    await assert.rejects(() => fetchTable({ data: "ERRORS" }), error => {
      assert.match(error.message, /网络|连接/);
      assert.match(error.message, /检查|重试|刷新/);
      assert.doesNotMatch(error.message, /PRIVATE_|Failed to fetch/);
      return true;
    });
  } finally { globalThis.fetch = original; }
});

test("player error feedback preserves public explanations and adds guidance for HTTP failures", async () => {
  const original = globalThis.fetch;
  try {
    for (const [status, expected] of [[401, /会话.*重新登录/], [403, /权限.*房主/], [429, /频繁|额度/], [504, /时限.*确认结果/]]) {
      globalThis.fetch = async () => Response.json({ error: "服务端的公开原因。" }, { status });
      await assert.rejects(() => fetchTable({ data: "ERRORS" }), error => {
        assert.match(error.message, /服务端的公开原因/);
        assert.match(error.message, expected);
        return true;
      });
    }
    globalThis.fetch = async () => new Response("PRIVATE_INVALID_JSON", { status: 200 });
    await assert.rejects(() => transcribeAudio({ data: { b64: "audio" } }), error => {
      assert.match(error.message, /无法识别|完整读取/);
      assert.match(error.message, /确认结果/);
      assert.doesNotMatch(error.message, /PRIVATE|Unexpected/);
      return true;
    });
    globalThis.fetch = async () => Response.json({ ok: true, text: "我观察门闩。" });
    assert.deepEqual(await transcribeAudio({ data: { b64: "audio" } }), { ok: true, text: "我观察门闩。" });
    const rejection = { action: "notCommitted", narration: "notApplicable", error: "请先完成掷骰。" };
    globalThis.fetch = async () => Response.json(rejection);
    assert.deepEqual(await fetchTable({ data: "ERRORS" }), rejection, "business failures must retain their server-owned status and explanation");
  } finally { globalThis.fetch = original; }
});

test("an uncertain action response retains the same submission for an explicit retry", async () => {
  const original = globalThis.fetch, originalWindow = globalThis.window;
  const storage = new Map(), calls = [];
  globalThis.window = { sessionStorage: { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
  try {
    globalThis.fetch = async (_url, init) => {
      calls.push(JSON.parse(init.body));
      if (calls.length === 1) return new Response("<html>gateway failed</html>", { status: 502 });
      return Response.json({ action: "committed", narration: "published" });
    };
    const data = { code: "ERRORS", text: "我观察门闩。" };
    await assert.rejects(() => sendAction({ data }), /确认结果.*原操作的重试入口/);
    assert.equal(calls.length, 1, "a transport error must not automatically resend an action");
    assert.equal(storage.size, 1);
    assert.deepEqual(await sendAction({ data }), { action: "committed", narration: "published" });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].data.submissionId, calls[1].data.submissionId);
    assert.equal(storage.size, 0);
  } finally { globalThis.fetch = original; globalThis.window = originalWindow; }
});

test("recovery projections admit only public failure codes and never attach an old failure to pending", () => {
  const recovery = { kind: "available", capability: "recovery:player-errors", state: "rejected", failureCode: "NARRATION_BODY_INVALID" };
  const project = value => projectAuthoritativeTableObservation({ userId: "alice", members: ["alice"], locationLabels: {},
    observation: { readModel: null, narrationRecovery: value, transcript: [], delivery: { kind: "none" } } });
  assert.deepEqual(project(recovery).narrationRecovery, recovery);
  assert.throws(() => project({ ...recovery, failureCode: "PRIVATE_PROMPT" }), /failure code is invalid/);
  assert.throws(() => project({ ...recovery, diagnostics: "PRIVATE_PROMPT" }), /projection is invalid/);
  assert.throws(() => project({ ...recovery, state: "pending" }), /failure code is invalid/);
});
