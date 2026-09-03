import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildRoomTelemetryEvent } from "../app/_runtime/lib/room/telemetry.ts";

test("a failed proposal is logged as the Form, the repair state and the fields", () => {
  const event = buildRoomTelemetryEvent({
    eventName: "room.action.completed",
    outcome: { kind: "needsKp" },
    failure: { code: "PROPOSAL_REPAIR_EXHAUSTED" },
    proposal: {
      formId: "observe.v1",
      repairUsed: true,
      diagnostics: ["desiredInformation:required", "focus:type-invalid"],
    },
  });

  assert.equal(event.proposalFormId, "observe.v1");
  assert.equal(event.proposalRepairUsed, true);
  assert.deepEqual(event.proposalDiagnosticFields, [
    { path: "desiredInformation", code: "required" },
    { path: "focus", code: "type-invalid" },
  ]);
  assert.equal(event.errorCode, "PROPOSAL_REPAIR_EXHAUSTED");
  assert.equal(event.failureClass, "modelPermanent");
});

test("a live world reference in a diagnostic never reaches the log line", () => {
  const event = buildRoomTelemetryEvent({
    eventName: "room.action.completed",
    outcome: { kind: "needsKp" },
    proposal: {
      formId: "npc-exchange.v1",
      repairUsed: false,
      diagnostics: [
        "draft.desiredResponse.evidenceRefs:fact:9f3a7c1e-SECRET:not-authoritative",
        "phaseNames:unknown-phase:玩家写的名字",
      ],
    },
  });

  const line = JSON.stringify(event);
  assert.doesNotMatch(line, /SECRET/u);
  assert.doesNotMatch(line, /玩家写的名字/u);
  assert.deepEqual(event.proposalDiagnosticFields, [
    { path: "draft.desiredResponse.evidenceRefs", code: "not-authoritative" },
    { path: "phaseNames", code: "unknown-phase" },
  ]);
});

test("an event that is not a failed proposal carries none of these fields", () => {
  const event = buildRoomTelemetryEvent({
    eventName: "room.action.completed",
    outcome: { kind: "committed" },
  });
  assert.equal(event.proposalFormId, undefined);
  assert.equal(event.proposalRepairUsed, undefined);
  assert.equal(event.proposalDiagnosticFields, undefined);

  // An empty diagnostic set is absent rather than an empty row.
  const empty = buildRoomTelemetryEvent({
    outcome: { kind: "needsKp" },
    proposal: { formId: "observe.v1", repairUsed: false, diagnostics: [] },
  });
  assert.equal(empty.proposalDiagnosticFields, undefined);
  assert.equal(empty.proposalFormId, "observe.v1");
});

test("the Room emits the block and the table never projects it", async () => {
  const server = await readFile(
    new URL("../app/_runtime/lib/room/server.ts", import.meta.url),
    "utf8",
  );
  assert.match(server, /proposal: "proposal" in outcome \? outcome\.proposal : undefined/u);

  // The V3 table response is a fixed key allowlist; the internal block must
  // not be in it, or the diagnostics would reach the player's client.
  const table = await readFile(
    new URL("../app/_runtime/lib/table/server.ts", import.meta.url),
    "utf8",
  );
  const allowlist = /for \(const key of \[\s*"code",\s*"kind",\s*"retryAfter",\s*\]\)/u;
  assert.match(table, allowlist);
  assert.doesNotMatch(table, /"proposal"/u);
});
