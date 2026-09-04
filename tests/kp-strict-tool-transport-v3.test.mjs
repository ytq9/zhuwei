import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTHORITATIVE_KP_PROFILES,
  kpCallStructuredOutputMode,
  kpStructuredOutputMode,
} from "../app/_runtime/lib/kp/authoritative-policy.ts";
import {
  privateFormProposalModelInput,
  privateFormRepairModelInput,
} from "../app/_runtime/lib/kp/private-form-policy.ts";
import {
  KP_STRICT_TOOL_CAPABLE_FORMS,
  KP_STRICT_TOOL_UNSUPPORTED_FORMS,
  kpFormSupportsStrictTool,
} from "../app/_runtime/lib/kp/form-strict-tool.ts";
import { KP_FORM_IDS } from "../app/_runtime/lib/kp/form-catalog.ts";
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

test("the Form selection call keeps the ordinary transport on every profile", () => {
  // Strict output is opt-in per `modelProfileVersion`, and the shipped
  // profiles have opted in. The opt-in may never reach the selection call:
  // the Form is chosen by which tool the model calls, strict beta carries one
  // function per request, and dropping the other Forms would change the
  // selection protocol SPEC 0015 6.1 freezes. So the selection call must stay
  // byte-identical to what production sends today, while the repair -- the
  // last call before PROPOSAL_REPAIR_EXHAUSTED -- becomes provider-enforced.
  for (const profile of AUTHORITATIVE_KP_PROFILES) {
    assert.equal(kpStructuredOutputMode(profile), "strict-tool", profile.modelProfileVersion);
    assert.equal(
      kpCallStructuredOutputMode(profile, 3),
      "tool",
      profile.modelProfileVersion,
    );
    assert.equal(
      kpCallStructuredOutputMode(profile, 1),
      "strict-tool",
      profile.modelProfileVersion,
    );
  }
  // An unknown profile has not opted in and stays ordinary on every call.
  assert.equal(kpStructuredOutputMode({ modelProfileVersion: "unknown" }), "tool");
  assert.equal(kpCallStructuredOutputMode({ modelProfileVersion: "unknown" }, 1), "tool");
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
  // upgrade path. It used to have no strict encoding and had to fail loudly
  // here; it now has one, built as an `anyOf` over closed branch objects, so
  // the repair that ends in PROPOSAL_REPAIR_EXHAUSTED is constrained for a
  // compound upgrade too.
  const compound = repairInput("compound.v1", "strict-tool");
  assert.equal(compound.tools.length, 1);
  assert.equal(compound.tools[0].function.strict, true);
  assert.doesNotThrow(() => assertDeepSeekStrictToolModelInput(compound));
  assert.doesNotThrow(() => repairInput("compound.v1"));

  // The escape hatch that made compound fail loudly is still the mechanism:
  // a Form with no faithful strict encoding belongs on this list rather than
  // in a strict request that overstates what the provider enforces. It is
  // empty today, so adding a member stays a deliberate, visible act.
  assert.deepEqual([...KP_STRICT_TOOL_UNSUPPORTED_FORMS], []);
  for (const formId of KP_FORM_IDS) {
    assert.equal(kpFormSupportsStrictTool(formId), true, formId);
  }
});
