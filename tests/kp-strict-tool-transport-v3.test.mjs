import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTHORITATIVE_KP_PROFILES,
  kpStructuredOutputMode,
} from "../app/_runtime/lib/kp/authoritative-policy.ts";
import {
  privateFormProposalModelInput,
  privateFormRepairModelInput,
} from "../app/_runtime/lib/kp/private-form-policy.ts";
import {
  KP_STRICT_TOOL_CAPABLE_FORMS,
} from "../app/_runtime/lib/kp/form-strict-tool.ts";
import {
  assertDeepSeekStrictToolModelInput,
} from "../app/_runtime/lib/kp/deepseek.ts";

const finiteReferences = {
  basisRefs: ["fact:a"],
  abilityRefs: [],
  resourceRefs: [],
  itemRefs: [],
};

function repairInput(selectedForm, structuredOutputMode) {
  return privateFormRepairModelInput({
    rootActionRef: "action:1",
    originalForm: selectedForm,
    selectedForm,
    rejectedDraft: { goal: "x" },
    errors: ["goal:required"],
    finiteReferences,
    semanticFreezeHash: "sha256:abc",
    ...(structuredOutputMode === undefined ? {} : { structuredOutputMode }),
  });
}

test("every shipped KP profile still uses the ordinary tool transport", () => {
  // Strict output is opt-in per `modelProfileVersion`. Until a profile opts
  // in, production must be byte-identical to what it sends today.
  for (const profile of AUTHORITATIVE_KP_PROFILES) {
    assert.equal(kpStructuredOutputMode(profile), "tool", profile.modelProfileVersion);
  }
  assert.equal(kpStructuredOutputMode({ modelProfileVersion: "unknown" }), "tool");
});

test("the ordinary transport never declares strict output", () => {
  const input = repairInput("observe.v1");
  assert.equal(input.tools.length, 1);
  assert.equal(input.tools[0].function.strict, undefined);
  assert.deepEqual(
    Object.keys(input.tools[0].function).sort(),
    ["description", "name", "parameters"],
  );
  // The ordinary tool is not in the beta dialect and must not claim to be.
  assert.throws(
    () => assertDeepSeekStrictToolModelInput(input),
    /strict-tool request is invalid/u,
  );
});

test("a strict repair request satisfies the provider's own precondition", () => {
  for (const formId of KP_STRICT_TOOL_CAPABLE_FORMS) {
    const input = repairInput(formId, "strict-tool");
    assert.equal(input.tools[0].function.strict, true, formId);
    // The binding runs this check before any network I/O; passing it is what
    // makes the difference between declared and enforced strict output.
    assert.doesNotThrow(() => assertDeepSeekStrictToolModelInput(input), formId);
  }
});

test("the initial proposal call cannot be strict under the current selection protocol", () => {
  const request = { rootActionId: "action:1", attempt: 1 };
  // `assertAllowedFormSet` requires three to six Forms and always includes
  // `compound.v1`, so the initial call offers several tools by construction.
  const allowedForms = ["observe.v1", "npc-exchange.v1", "compound.v1"];

  const ordinary = privateFormProposalModelInput({
    request,
    allowedForms,
    contextPack: {},
  });
  assert.equal(ordinary.tools.length, 3);
  for (const tool of ordinary.tools) {
    assert.equal(tool.function.strict, undefined);
  }

  // Strict beta carries exactly one function. Dropping the other Forms to fit
  // would change which Forms the model was allowed to choose, and the one
  // Form every allowlist must contain — `compound.v1` — has no strict
  // encoding at all. The request is refused rather than quietly reshaped.
  assert.throws(
    () => privateFormProposalModelInput({
      request,
      allowedForms,
      contextPack: {},
      structuredOutputMode: "strict-tool",
    }),
    /KP_STRICT_TOOL_FORM_SELECTION_UNSUPPORTED/u,
  );
});

test("the narrow repair is the call strict output can actually constrain", () => {
  // The repair sends the one Form the server already chose, which is the
  // shape strict beta accepts — and it is the last call before
  // PROPOSAL_REPAIR_EXHAUSTED, so a schema error there ends the action.
  const strict = repairInput("observe.v1", "strict-tool");
  assert.equal(strict.tools.length, 1);
  assert.equal(strict.tools[0].function.strict, true);
  assert.doesNotThrow(() => assertDeepSeekStrictToolModelInput(strict));

  // `compound.v1` is reachable as a repair target through the ordinary
  // upgrade path, and has no strict encoding, so it must fail loudly.
  assert.throws(
    () => repairInput("compound.v1", "strict-tool"),
    /KP_STRICT_TOOL_FORM_UNSUPPORTED/u,
  );
  assert.doesNotThrow(() => repairInput("compound.v1"));
});
