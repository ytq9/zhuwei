import assert from "node:assert/strict";
import test from "node:test";

import { buildRoomTelemetryEvent } from "../app/_runtime/lib/room/telemetry.ts";

const EXPECTED = Object.freeze({
  PROPOSAL_PROVIDER_TIMEOUT: "modelTransient",
  PROPOSAL_FORM_INVALID: "modelPermanent",
  PROPOSAL_REFERENCE_INVALID: "modelPermanent",
  PROPOSAL_RULES_DIAGNOSTIC: "mechanicalDiagnostic",
  PROPOSAL_REPAIR_EXHAUSTED: "modelPermanent",
  CONTEXT_INSUFFICIENT: "validation",
  NARRATION_PROVIDER_TIMEOUT: "modelTransient",
  NARRATION_BODY_INVALID: "modelPermanent",
  NARRATION_GROUNDING_REJECTED: "modelPermanent",
  NARRATION_PUBLICATION_FAILED: "authorityTransient",
});

test("V3 public failure codes survive the fixed telemetry allowlist with stable classes", () => {
  for (const [code, failureClass] of Object.entries(EXPECTED)) {
    const event = buildRoomTelemetryEvent({
      eventName: "room.v3.failure",
      failure: {
        code,
        prompt: "must-not-log",
        playerText: "must-not-log",
        secret: "must-not-log",
      },
    });
    assert.equal(event.failureClass, failureClass, code);
    assert.equal(event.errorCode, code, code);
    const serialized = JSON.stringify(event);
    assert.doesNotMatch(serialized, /must-not-log|prompt|playerText|secret/u, code);
  }
});

test("new V3 proposal reference and context stages are classified instead of dropped", () => {
  assert.deepEqual(
    ["proposalReference", "contextPack"].map((code) => {
      const event = buildRoomTelemetryEvent({ failure: { code } });
      return [code, event.failureClass, event.errorCode];
    }),
    [
      ["proposalReference", "modelPermanent", "proposalReference"],
      ["contextPack", "validation", "contextPack"],
    ],
  );
});
