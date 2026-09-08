import assert from "node:assert/strict";
import test from "node:test";

import {
  KP_DIAGNOSTIC_CODES,
  KP_DIAGNOSTIC_OTHER_CODE,
  KP_DIAGNOSTIC_UNRECOGNIZED_PATH,
  desensitizeKpDiagnostic,
  desensitizeKpDiagnostics,
  kpProposalFailureTelemetry,
} from "../app/_runtime/lib/kp/diagnostic-telemetry.ts";

test("structured vNext diagnostics preserve schema fields and codes without copying evidence or candidates", () => {
  const secret = 'HIDDEN-ITEM-CANARY';
  const common = { code: 'REFERENCE_UNAVAILABLE', actual: secret,
    expected: { candidates: [secret] }, constraint: secret, message: secret,
    repair: { changes: [{ value: secret }] } };
  assert.deepEqual(desensitizeKpDiagnostic({ ...common, pathBase: 'rulesInput',
    path: ['steps', '1', 'rulesInput', 'plan', 'operation', 'entryRef'] }), {
    path: 'rulesInput.steps[].rulesInput.plan.operation.entryRef', code: 'REFERENCE_UNAVAILABLE',
  });
  assert.deepEqual(desensitizeKpDiagnostic({ ...common, path: ['proposals', 7, 'operation', 'entryRef'] }), {
    path: 'proposals[].operation.entryRef', code: 'REFERENCE_UNAVAILABLE',
  });
  for (const [pathBase, path, expected] of [
    ['arguments', ['steps', 3, 'otherTargetRefs', 1], 'arguments.steps[].otherTargetRefs[]'],
    ['arguments', ['results', 1, 'entries', 0, 'recordKind'], 'arguments.results[].entries[].recordKind'],
    ['arguments', ['decision', 'choices', 0, 'continuation', 'results', 1, 'responseBasis', 0], 'arguments.decision.choices[].continuation.results[].responseBasis[]'],
    [undefined, ['proposals', 1, 'consumes', 0, 'ref'], 'proposals[].consumes[].ref'],
    [undefined, ['proposals', 1, 'branches', 'failure', 'effects', 0, 'kind'], 'proposals[].branches.failure.effects[].kind'],
  ]) {
    assert.deepEqual(desensitizeKpDiagnostic({ ...common, pathBase, path }), {
      path: expected, code: 'REFERENCE_UNAVAILABLE',
    });
  }
  for (const path of [[secret], ['proposals', 0, secret, 'entryRef'], ['proposals.operation', secret]]) {
    assert.equal(JSON.stringify(desensitizeKpDiagnostic({ ...common, path })).includes(secret), false);
  }
});

test("a diagnostic reduces to the field it names and the rule it broke", () => {
  assert.deepEqual(desensitizeKpDiagnostic("goal:required"), {
    path: "goal",
    code: "required",
  });
  assert.deepEqual(desensitizeKpDiagnostic("ability:direct-forbidden"), {
    path: "ability",
    code: "direct-forbidden",
  });
  assert.deepEqual(desensitizeKpDiagnostic("semantic-freeze:goal:unproven"), {
    path: "semantic-freeze",
    code: "unproven",
  });
  assert.deepEqual(desensitizeKpDiagnostic("draft:json-parse-failed"), {
    path: "draft",
    code: "json-parse-failed",
  });
});

test("an array index is normalised so one field is one row", () => {
  assert.deepEqual(desensitizeKpDiagnostic("basisRefs[3]:type-invalid"), {
    path: "basisRefs[]",
    code: "type-invalid",
  });
  const fields = desensitizeKpDiagnostics([
    "basisRefs[0]:type-invalid",
    "basisRefs[7]:type-invalid",
  ]);
  assert.deepEqual(fields, [{ path: "basisRefs[]", code: "type-invalid" }]);
});

test("a world reference in the diagnostic never reaches telemetry", () => {
  // The shape Rules actually emits: the middle segments are a live fact ref.
  const field = desensitizeKpDiagnostic(
    "draft.desiredResponse.evidenceRefs:fact:9f3a7c1e-secret:not-authoritative",
  );
  assert.deepEqual(field, {
    path: "draft.desiredResponse.evidenceRefs",
    code: "not-authoritative",
  });
});

test("a secret is dropped wherever a diagnostic interpolates it", () => {
  const secret = "SECRET-9f3a7c1e";
  const shapes = [
    `goal:${secret}`,
    `${secret}:required`,
    `phaseNames:unknown-phase:${secret}`,
    `draft.${secret}.evidenceRefs:not-authoritative`,
    `${secret}`,
    `resourceRef:${secret}:pair-required`,
    `semantic-freeze:${secret}:changed`,
    `$.${secret}:authority-field-forbidden`,
  ];
  for (const shape of shapes) {
    const field = desensitizeKpDiagnostic(shape);
    assert.doesNotMatch(JSON.stringify(field), /SECRET/u, shape);
  }
  // And through the batch entry point, which is what telemetry will call.
  assert.doesNotMatch(
    JSON.stringify(desensitizeKpDiagnostics(shapes)),
    /SECRET/u,
  );
});

test("a code in a trailing position is still found, not mistaken for content", () => {
  // `<field>:unknown-phase:<model-authored name>` puts the code in the middle,
  // so position alone cannot identify it.
  assert.deepEqual(desensitizeKpDiagnostic("phaseNames:unknown-phase:凛冬"), {
    path: "phaseNames",
    code: "unknown-phase",
  });
});

test("an unfamiliar diagnostic degrades instead of leaking", () => {
  const field = desensitizeKpDiagnostic("someNewThing:some-new-rule-nobody-registered");
  assert.deepEqual(field, {
    path: KP_DIAGNOSTIC_UNRECOGNIZED_PATH,
    code: KP_DIAGNOSTIC_OTHER_CODE,
  });
  assert.deepEqual(desensitizeKpDiagnostic(undefined), {
    path: KP_DIAGNOSTIC_UNRECOGNIZED_PATH,
    code: KP_DIAGNOSTIC_OTHER_CODE,
  });
  assert.deepEqual(desensitizeKpDiagnostic({ nested: "object" }), {
    path: KP_DIAGNOSTIC_UNRECOGNIZED_PATH,
    code: KP_DIAGNOSTIC_OTHER_CODE,
  });
});

test("the emitted vocabulary is closed", () => {
  const codes = new Set([...KP_DIAGNOSTIC_CODES, KP_DIAGNOSTIC_OTHER_CODE]);
  const noisy = [
    "goal:required",
    "draft.desiredResponse.evidenceRefs:fact:x:not-authoritative",
    "totally:unknown:thing",
    "phaseNames:unknown-phase:名字",
  ];
  for (const field of desensitizeKpDiagnostics(noisy)) {
    assert.ok(codes.has(field.code), field.code);
  }
});

test("the diagnostic set is bounded and de-duplicated", () => {
  const many = Array.from({ length: 50 }, (_, index) => `goal:required:${index}`);
  assert.equal(desensitizeKpDiagnostics(many).length, 1);

  const varied = KP_DIAGNOSTIC_CODES.map((code) => `goal:${code}`);
  assert.equal(desensitizeKpDiagnostics(varied).length, 8);
  assert.equal(desensitizeKpDiagnostics(varied, 3).length, 3);
  assert.deepEqual(desensitizeKpDiagnostics("not-an-array"), []);
});

test("a failed proposal yields the Form, the repair state and the fields", () => {
  assert.deepEqual(
    kpProposalFailureTelemetry({
      formId: "observe.v1",
      repairUsed: true,
      diagnostics: ["desiredInformation:required", "focus:type-invalid"],
    }),
    {
      proposalFormId: "observe.v1",
      repairUsed: true,
      diagnosticFields: [
        { path: "desiredInformation", code: "required" },
        { path: "focus", code: "type-invalid" },
      ],
    },
  );

  // An unknown Form id is not echoed back as a free string.
  assert.equal(
    kpProposalFailureTelemetry({ formId: "made-up.v9" }).proposalFormId,
    undefined,
  );
  assert.equal(kpProposalFailureTelemetry({}).repairUsed, undefined);
});
