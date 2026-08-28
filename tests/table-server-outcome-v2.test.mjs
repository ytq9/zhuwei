import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

async function tableOutcomeMapper() {
  const server = await readFile(
    new URL("../app/_runtime/lib/table/server.ts", import.meta.url),
    "utf8",
  );
  const start = server.indexOf("function authoritativeTableOutcome(");
  const end = server.indexOf("\nfunction authoritativeAdministrationError(", start);
  assert.notEqual(start, -1, "authoritative table outcome mapper is missing");
  assert.notEqual(end, -1, "authoritative table outcome mapper boundary is missing");
  const source = server.slice(start, end);
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return Function(
    "publicAuthoritativeOutcomeError",
    `${compiled}\nreturn authoritativeTableOutcome;`,
  )(() => "暂时无法完成这次行动");
}

test("committed and concluded actions expose a pending Delivery as an explicit same-id retry", async () => {
  const mapOutcome = await tableOutcomeMapper();

  for (const kind of ["committed", "concluded"]) {
    const submissionId = `submission:pending-delivery:${kind}`;
    assert.deepEqual(mapOutcome(submissionId, {
      kind,
      receipt: { receiptId: `receipt:${kind}` },
      readModel: {},
      deliveryPending: true,
    }), {
      ok: false,
      submissionId,
      outcomeKind: kind,
      committed: true,
      retryable: true,
      error: "行动已经提交，但 KP 回应尚未送达。请重试；不会重复执行行动。",
    });
  }
});

test("a committed action remains successful once its Delivery is available", async () => {
  const mapOutcome = await tableOutcomeMapper();
  const outcome = {
    kind: "committed",
    receipt: { receiptId: "receipt:published" },
    readModel: {},
    delivery: { kind: "current", frame: { deliveryId: "delivery:published" } },
  };

  assert.deepEqual(mapOutcome("submission:published", outcome), {
    ok: true,
    submissionId: "submission:published",
    outcome,
  });
});
