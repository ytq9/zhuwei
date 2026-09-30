import { beforeAll, afterEach, expect, it, vi } from "vitest";
import { historyHttpAccount, historyHttpAuthority, historyHttpDb, historyHttpPost, historyHttpSource } from "../../support/fixtures/story-history-http";
import * as proposalAdapter from "../../../app/_runtime/lib/kp/vnext/adapter";
import { buildRoomTelemetryEvent } from "../../../app/_runtime/lib/room/telemetry";
import { createDiagnosticReference, diagnosticReference, DIAGNOSTIC_HEADER } from "../../../app/_runtime/lib/platform/diagnostic-reference";

const migrations = import.meta.glob<string>("/drizzle/*.sql", { eager: true, query: "?raw", import: "default" });
beforeAll(async () => {
  for (const [, sql] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
    for (const statement of sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await historyHttpDb.prepare(statement).run();
  }
}, 30_000);
afterEach(() => vi.restoreAllMocks());

it("the authenticated action route explains terminal errors, accepts edited intentions, and keeps private diagnostics on the server", async () => {
  // SPEC 0011 §1, SPEC 0003 §1: real local HTTP/auth/D1/Room boundaries;
  // only the model's failed response is supplied deterministically.
  const originalAdapter = proposalAdapter.createVNextKpAdapter;
  const seen: { root: string; text: string }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("TEST_OUTBOUND_DISABLED"); });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(proposalAdapter, "createVNextKpAdapter").mockImplementation(options => ({ ...originalAdapter(options),
    async propose(request) {
      const value = request as unknown as { rootActionId: string; requiredContext: { intent: { text: string } } };
      seen.push({ root: value.rootActionId, text: value.requiredContext.intent.text });
      throw proposalAdapter.vnextProposalFailure("PROPOSAL_REPAIR_EXHAUSTED", false, undefined, {
        issues: ["PRIVATE_MODEL_REASON"], diagnostics: [{ code: "CONSTRAINT_CONFLICT",
          constraint: seen.length === 1 ? "NPC_REVIEW_INVALID" : "concealment:hidden-act-is-not-the-talk-with-its-observer",
          path: ["PRIVATE_SCHEMA_PATH"], actual: "PRIVATE_NPC_MEMORY", expected: "PRIVATE_WORLD_TRUTH",
          repair: { allowed: false, reason: "PRIVATE_REPAIR_REASON" } }],
      });
    },
  }));
  const account = await historyHttpAccount("修改行动测试"), room = await historyHttpSource(account);
  const before = await historyHttpAuthority(room.roomId);
  const original = { code: room.code, submissionId: crypto.randomUUID(), text: "我低声问莉安，她父亲近日有什么反常举动。" };
  const first = await historyHttpPost("sendAction", original, account);
  expect(first.response.status).toBe(200);
  expect(first.body).toMatchObject({ action: "notCommitted", retryable: false, code: "PROPOSAL_REPAIR_EXHAUSTED" });
  expect(first.body.error).toMatch(/NPC.*审核.*格式/);
  const amended = { ...original, submissionId: crypto.randomUUID(), text: "我靠近莉安问她父亲近日的习惯，希望旁人听不到。" };
  const second = await historyHttpPost("sendAction", amended, account);
  expect(second.body).toMatchObject({ action: "notCommitted", retryable: false });
  expect(second.body.error).toMatch(/交谈对象.*希望谁听不到/);
  expect(seen.map(row => row.text)).toEqual([original.text, amended.text]);
  expect(seen[0].root).not.toBe(seen[1].root);
  expect(await historyHttpAuthority(room.roomId)).toEqual(before);
  for (const body of [first.body, second.body]) {
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_|diagnostics|proposal|CONSTRAINT_CONFLICT/);
  }
});

// SPEC 0011 §§1、5: actual authenticated route, local D1 and public outcomes.
it("the real game route correlates a business rejection and keeps successful reads intact", async () => {
  const account = await historyHttpAccount("故障排查测试");
  const logs: string[] = [];
  vi.spyOn(console, "info").mockImplementation(value => logs.push(String(value)));
  const reference = createDiagnosticReference();
  const submissionId = crypto.randomUUID();
  const failed = await historyHttpPost("sendAction", { code: "MISSING", submissionId, text: "" }, account,
    { [DIAGNOSTIC_HEADER]: reference });
  expect(failed.response.headers.get(DIAGNOSTIC_HEADER)).toBe(reference);
  expect(failed.body.error).toEqual(expect.any(String));
  const hashed = buildRoomTelemetryEvent({ requestId: reference, correlation: { submissionId } });
  const events = logs.map(value => JSON.parse(value));
  expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ requestId: hashed.requestId, submissionHash: hashed.submissionHash })]));
  expect(logs.join(" ")).not.toContain(account.userId);
  expect(logs.join(" ")).not.toContain(account.cookie);
  const catalog = await historyHttpPost("getCatalog", undefined, account);
  expect(catalog.response.status).toBe(200);
  expect(catalog.body.error).toBeUndefined();
  expect(diagnosticReference(catalog.response.headers.get(DIAGNOSTIC_HEADER))).toBeDefined();
});

it("a diagnostic reference grants no authentication and the failure can be located without exposing inputs", async () => {
  const logs: string[] = [];
  vi.spyOn(console, "error").mockImplementation(value => logs.push(String(value)));
  const reference = createDiagnosticReference();
  const denied = await historyHttpPost("sendAction", { text: "PRIVATE_PLAYER_INPUT", submissionId: "PRIVATE_SUBMISSION" }, undefined,
    { [DIAGNOSTIC_HEADER]: reference });
  expect(denied.response.status).toBe(401);
  expect(denied.response.headers.get(DIAGNOSTIC_HEADER)).toBe(reference);
  expect(logs.map(value => JSON.parse(value))).toEqual(expect.arrayContaining([expect.objectContaining({
    requestId: buildRoomTelemetryEvent({ requestId: reference }).requestId, eventName: "http.request.failed", httpStatus: 401,
  })]));
  expect(logs.join(" ")).not.toContain("PRIVATE_");
  const forged = await historyHttpPost("getCatalog", null, undefined, { [DIAGNOSTIC_HEADER]: "PRIVATE_HEADER" });
  expect(forged.response.status).toBe(401);
  expect(diagnosticReference(forged.response.headers.get(DIAGNOSTIC_HEADER))).toBeDefined();
  expect(logs.join(" ")).not.toContain("PRIVATE_HEADER");
});
