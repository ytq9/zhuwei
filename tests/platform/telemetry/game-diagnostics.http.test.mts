import { beforeAll, afterEach, expect, it, vi } from "vitest";
import { historyHttpAccount, historyHttpDb, historyHttpPost } from "../../support/fixtures/story-history-http";
import { buildRoomTelemetryEvent } from "../../../app/_runtime/lib/room/telemetry";
import { createDiagnosticReference, diagnosticReference, DIAGNOSTIC_HEADER } from "../../../app/_runtime/lib/platform/diagnostic-reference";

const migrations = import.meta.glob<string>("/drizzle/*.sql", { eager: true, query: "?raw", import: "default" });
beforeAll(async () => {
  for (const [, sql] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
    for (const statement of sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await historyHttpDb.prepare(statement).run();
  }
}, 30_000);
afterEach(() => vi.restoreAllMocks());

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
