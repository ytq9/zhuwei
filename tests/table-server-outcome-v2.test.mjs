import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

import {
  publicAuthoritativeOutcomeError,
  publicNarrationFailureReason,
  publicNarrationRecoveryReason,
  publicV3FailureCode,
  V3_PUBLIC_FAILURE_CODES,
} from "../app/_runtime/lib/table/authoritative.ts";
import { failureCodeIsRetryable } from "../app/_runtime/lib/room/telemetry.ts";

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
    "publicV3FailureCode",
    "publicNarrationFailureReason",
    "failureCodeIsRetryable",
    `${compiled}\nreturn authoritativeTableOutcome;`,
  )(
    () => "暂时无法完成这次行动",
    publicV3FailureCode,
    publicNarrationFailureReason,
    failureCodeIsRetryable,
  );
}

async function viewerNarrationOutcomeMapper() {
  const server = await readFile(
    new URL("../app/_runtime/lib/table/server.ts", import.meta.url),
    "utf8",
  );
  const start = server.indexOf("function viewerNarrationRecoveryTableOutcome(");
  const end = server.indexOf("\nfunction publicActionInputFailure(", start);
  assert.notEqual(start, -1, "viewer narration recovery mapper is missing");
  assert.notEqual(end, -1, "viewer narration recovery mapper boundary is missing");
  const compiled = ts.transpileModule(server.slice(start, end), {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return Function(
    "publicV3FailureCode",
    "publicNarrationFailureReason",
    `${compiled}\nreturn viewerNarrationRecoveryTableOutcome;`,
  )(publicV3FailureCode, publicNarrationFailureReason);
}

test("narration recovery explains cause separately from the retry action", () => {
  assert.equal(
    publicNarrationFailureReason("NARRATION_PROVIDER_TIMEOUT"),
    "KP 服务暂时不可用，或本次响应超过时限",
  );
  assert.equal(
    publicNarrationFailureReason("NARRATION_BODY_INVALID"),
    "KP 服务配置或返回内容未通过有效性检查",
  );
  assert.equal(
    publicNarrationFailureReason("NARRATION_GROUNDING_REJECTED"),
    "KP 回复与已经结算的事实不一致",
  );
  assert.equal(
    publicNarrationFailureReason("NARRATION_PUBLICATION_FAILED"),
    "KP 回复生成或传送过程中出现故障",
  );
  assert.equal(
    publicNarrationFailureReason("PRIVATE_FAILURE"),
    "KP 回复暂未完成，原因尚未确认",
  );
  assert.equal(
    publicNarrationRecoveryReason("retryableFailure"),
    "KP 服务或回复发布暂时失败；这不代表一定等待超时。",
  );
});

test("committed and concluded actions expose a pending Delivery as an explicit same-id retry", async () => {
  const mapOutcome = await tableOutcomeMapper();

  for (const kind of ["committed", "concluded"]) {
    const submissionId = `submission:pending-delivery:${kind}`;
    const outcome = {
      kind,
      receipt: { receiptId: `receipt:${kind}` },
      readModel: {},
      deliveryPending: true,
    };
    assert.deepEqual(mapOutcome(submissionId, outcome), {
      ok: false,
      submissionId,
      outcomeKind: kind,
      action: kind,
      narration: "retryableFailure",
      committed: true,
      retryable: true,
      error: "行动已经提交；KP 回复暂未完成，原因尚未确认。请重试；不会重复执行行动。",
    });
    assert.deepEqual(mapOutcome(submissionId, outcome, true), {
      submissionId,
      outcomeKind: kind,
      action: kind,
      narration: "retryableFailure",
      retryable: true,
      error: "行动已经提交；KP 回复暂未完成，原因尚未确认。请重试；不会重复执行行动。",
    });
  }
});

test("a committed action remains successful once its Delivery is available", async () => {
  const mapOutcome = await tableOutcomeMapper();
  const receipt = {
    receiptId: "receipt:published",
    rootActionId: "root:published",
    status: "committed",
    runtimeEpochId: "epoch:published",
    activeBranchId: "branch:main",
  };
  const outcome = {
    kind: "committed",
    receipt,
    readModel: {},
    delivery: { kind: "current", frame: { deliveryId: "delivery:published" } },
  };

  assert.deepEqual(mapOutcome("submission:published", outcome), {
    ok: true,
    submissionId: "submission:published",
    action: "committed",
    narration: "published",
    outcome,
  });
  assert.deepEqual(mapOutcome("submission:published", outcome, true), {
    submissionId: "submission:published",
    action: "committed",
    narration: "published",
    outcome: {
      kind: "committed",
      receipt,
    },
  });
});

test("a V3 receipt has fixed public cardinality when hidden area targets differ", async () => {
  const mapOutcome = await tableOutcomeMapper();
  const core = {
    receiptId: "receipt:area-hazard",
    rootActionId: "root:area-hazard",
    status: "committed",
    runtimeEpochId: "epoch:area-hazard",
    activeBranchId: "branch:main",
  };
  const oneHiddenTarget = mapOutcome("submission:one-hidden", {
    kind: "committed",
    receipt: {
      ...core,
      eventRange: { first: "event:1", last: "event:8", from: 1, to: 8 },
      scopeVersions: { "entity:hidden-a": "1" },
      randomnessCommitments: [{ randomnessId: "randomness:hidden-a", requestHash: "secret-a" }],
    },
  }, true);
  const twoHiddenTargets = mapOutcome("submission:two-hidden", {
    kind: "committed",
    receipt: {
      ...core,
      eventRange: { first: "event:1", last: "event:13", from: 1, to: 13 },
      scopeVersions: { "entity:hidden-a": "1", "entity:hidden-b": "1" },
      randomnessCommitments: [
        { randomnessId: "randomness:hidden-a", requestHash: "secret-a" },
        { randomnessId: "randomness:hidden-b", requestHash: "secret-b" },
      ],
    },
  }, true);

  assert.deepEqual(oneHiddenTarget.outcome.receipt, core);
  assert.deepEqual(twoHiddenTargets.outcome.receipt, core);
  for (const mapped of [oneHiddenTarget, twoHiddenTargets]) {
    const serialized = JSON.stringify(mapped);
    assert.equal(serialized.includes("eventRange"), false);
    assert.equal(serialized.includes("randomnessCommitments"), false);
    assert.equal(serialized.includes("entity:hidden"), false);
  }
});

test("a V3 awaiting-input response never carries pending choice internals", async () => {
  const mapOutcome = await tableOutcomeMapper();
  const visibleProjection = mapOutcome("submission:visible-pending", {
    kind: "awaitingInput",
    action: "awaitingInput",
    narration: "notApplicable",
    pending: {
      pendingInputId: "pending:combat-target",
      kind: "combatChoice",
      choiceKind: "target",
      candidateEntityIds: ["enemy:visible"],
    },
  }, true);
  const authorityOutcome = {
    kind: "awaitingInput",
    action: "awaitingInput",
    narration: "notApplicable",
    pending: {
      pendingInputId: "pending:combat-target",
      kind: "combatChoice",
      choiceKind: "target",
      candidateEntityIds: ["enemy:visible", "enemy:hidden-a", "enemy:hidden-b"],
      operation: { abilityRef: "ability:private" },
      reactionQueue: ["character:private-controller"],
      spellFrame: { privateContinuation: true },
    },
  };
  const authorityInternals = mapOutcome(
    "submission:authority-shape",
    authorityOutcome,
    true,
  );

  assert.deepEqual(visibleProjection, {
    submissionId: "submission:visible-pending",
    action: "awaitingInput",
    narration: "notApplicable",
    outcome: { kind: "awaitingInput" },
  });
  assert.deepEqual(authorityInternals, {
    submissionId: "submission:authority-shape",
    action: "awaitingInput",
    narration: "notApplicable",
    outcome: { kind: "awaitingInput" },
  });
  const serialized = JSON.stringify(authorityInternals);
  assert.equal(serialized.includes("enemy:hidden"), false);
  assert.equal(serialized.includes("ability:private"), false);
  assert.equal(serialized.includes("character:private-controller"), false);
  assert.equal(serialized.includes("privateContinuation"), false);
  assert.equal(Object.hasOwn(authorityInternals.outcome, "pending"), false);
  assert.deepEqual(mapOutcome("submission:legacy-shape", authorityOutcome), {
    ok: true,
    submissionId: "submission:legacy-shape",
    action: "awaitingInput",
    narration: "notApplicable",
    outcome: authorityOutcome,
  });
});

test("a V3 success exposes only the public outcome allowlist and never Audience journal state", async () => {
  const mapOutcome = await tableOutcomeMapper();
  const outcome = {
    kind: "committed",
    receipt: { receiptId: "receipt:private-audiences" },
    readModel: { viewerKey: "viewer:alice" },
    delivery: { kind: "none" },
    audienceNarrations: [{
      audienceId: "audience:bob-secret",
      deliveryGeneration: 4,
      state: "published",
    }],
    narrationFailureState: "retryableFailure",
    action: "committed",
    narration: "retryableFailure",
  };

  const mapped = mapOutcome("submission:private-audiences", outcome, true);
  assert.deepEqual(mapped, {
    submissionId: "submission:private-audiences",
    action: "committed",
    narration: "retryableFailure",
    retryable: true,
    error: "行动已经提交；KP 回复暂未完成，原因尚未确认。请重试；不会重复执行行动。",
    outcomeKind: "committed",
  });
  assert.equal(JSON.stringify(mapped).includes("audience:bob-secret"), false);
});

test("a permanently failed proposal asks for a different action, not the same one", () => {
  for (const code of ["PROPOSAL_REPAIR_EXHAUSTED", "PROPOSAL_RULES_DIAGNOSTIC"]) {
    const message = publicAuthoritativeOutcomeError({ kind: "needsKp", code });
    assert.match(message, /未提交/u, code);
    assert.doesNotMatch(message, /用同一行动重试/u, code);
    assert.equal(failureCodeIsRetryable(code), false, code);
  }

  // An unclassified `needsKp` keeps the existing retry affordance: narrowing
  // retryability must not strip recovery from codes this fix did not target.
  assert.equal(failureCodeIsRetryable(undefined), true);
  assert.equal(failureCodeIsRetryable("correctionRequired"), true);
  assert.equal(failureCodeIsRetryable("projectionFailure"), true);

  // Transient upstream faults keep the "retry the same action" instruction.
  for (const code of ["modelTransient", "authorityTransient", "quotaExhausted"]) {
    assert.match(
      publicAuthoritativeOutcomeError({ kind: "retryableFailure", code }),
      /用同一行动重试/u,
      code,
    );
  }
});

test("uncommitted failures advertise retry only when an identical resubmission can clear them", async () => {
  const mapOutcome = await tableOutcomeMapper();
  const uncommitted = (kind, code) => mapOutcome(`submission:${code}`, {
    kind,
    code,
    receipt: { receiptId: `receipt:${code}` },
    action: "notCommitted",
    narration: "notApplicable",
  }, false);

  // A structural rejection of this exact draft is not cleared by sending the
  // same draft again; advertising retry walks the player back into it.
  for (const code of ["PROPOSAL_REPAIR_EXHAUSTED", "PROPOSAL_RULES_DIAGNOSTIC"]) {
    const mapped = uncommitted("needsKp", code);
    assert.equal(mapped.retryable, false, code);
    assert.equal(mapped.ok, false, code);
  }

  // Transient upstream faults keep the unchanged-resubmission affordance.
  const transient = uncommitted("retryableFailure", "PROPOSAL_PROVIDER_TIMEOUT");
  assert.equal(transient.retryable, true);

  // A code this fix did not classify keeps the retry it has today.
  const unclassified = mapOutcome("submission:unknown", {
    kind: "needsKp",
    receipt: { receiptId: "receipt:unknown" },
    action: "notCommitted",
    narration: "notApplicable",
  }, false);
  assert.equal(unclassified.retryable, true);
});

test("V3 error DTOs expose all and only the ten stable public pipeline codes", async () => {
  const mapOutcome = await tableOutcomeMapper();
  const proposalKinds = {
    PROPOSAL_PROVIDER_TIMEOUT: "retryableFailure",
    PROPOSAL_FORM_INVALID: "rejected",
    PROPOSAL_REFERENCE_INVALID: "rejected",
    PROPOSAL_RULES_DIAGNOSTIC: "needsKp",
    PROPOSAL_REPAIR_EXHAUSTED: "needsKp",
    CONTEXT_INSUFFICIENT: "rejected",
  };
  const narrationStates = {
    NARRATION_PROVIDER_TIMEOUT: "retryableFailure",
    NARRATION_BODY_INVALID: "rejected",
    NARRATION_GROUNDING_REJECTED: "rejected",
    NARRATION_PUBLICATION_FAILED: "retryableFailure",
  };

  const observed = [];
  for (const [code, kind] of Object.entries(proposalKinds)) {
    const mapped = mapOutcome(`submission:${code}`, {
      kind,
      code,
      ...(kind === "rejected" ? { explanation: "公开且不含私密细节的提示" } : {}),
      ...(kind === "needsKp" ? { receipt: { receiptId: `receipt:${code}` } } : {}),
      action: "notCommitted",
      narration: "notApplicable",
    }, true);
    assert.equal(mapped.code, code);
    assert.equal(mapped.action, "notCommitted");
    assert.equal(mapped.narration, "notApplicable");
    observed.push(mapped.code);
  }

  for (const [code, narration] of Object.entries(narrationStates)) {
    const mapped = mapOutcome(`submission:${code}`, {
      kind: "committed",
      receipt: { receiptId: `receipt:${code}` },
      action: "committed",
      narration,
      narrationFailureCode: code,
    }, true);
    assert.equal(mapped.code, code);
    assert.equal(mapped.action, "committed");
    assert.equal(mapped.narration, narration);
    observed.push(mapped.code);
  }

  assert.deepEqual(observed.sort(), [...V3_PUBLIC_FAILURE_CODES].sort());
  const unlisted = mapOutcome("submission:private", {
    kind: "retryableFailure",
    code: "PRIVATE_PROVIDER_DETAIL",
    action: "notCommitted",
    narration: "notApplicable",
  }, true);
  assert.equal("code" in unlisted, false);
  assert.equal(JSON.stringify(unlisted).includes("PRIVATE_PROVIDER_DETAIL"), false);
});

test("viewer-local narration retry preserves its exact safe failure code", async () => {
  const mapRecovery = await viewerNarrationOutcomeMapper();
  assert.deepEqual(mapRecovery({
    kind: "committed",
    action: "committed",
    narration: "rejected",
    narrationFailureCode: "NARRATION_GROUNDING_REJECTED",
  }), {
    action: "committed",
    narration: "rejected",
    code: "NARRATION_GROUNDING_REJECTED",
    error: "行动保持已提交；KP 回复与已经结算的事实不一致。重试只恢复回复，不会重新裁定、掷骰或消耗资源。",
  });
  const privateFailure = mapRecovery({
    kind: "committed",
    action: "committed",
    narration: "retryableFailure",
    narrationFailureCode: "PRIVATE_PROVIDER_DETAIL",
  });
  assert.equal("code" in privateFailure, false);
  assert.equal(JSON.stringify(privateFailure).includes("PRIVATE_PROVIDER_DETAIL"), false);
});
