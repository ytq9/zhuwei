import assert from "node:assert/strict";
import test from "node:test";

import {
  KP_FORM_IDS,
  buildKpFormToolParameters,
  validateKpFormDraft,
} from "../app/_runtime/lib/kp/form-catalog.ts";
import {
  KP_STRICT_TOOL_CAPABLE_FORMS,
  KP_STRICT_TOOL_OMITTED_SENTINEL,
  KP_STRICT_TOOL_UNSUPPORTED_FORMS,
  buildKpFormStrictToolParameters,
  decodeKpFormStrictDraft,
  kpFormSupportsStrictTool,
  strictDraftSentinelMisuse,
} from "../app/_runtime/lib/kp/form-strict-tool.ts";
import {
  deepSeekStrictToolSchemaIssues,
} from "../app/_runtime/lib/kp/deepseek-strict-tool.ts";

/** Fills a node with a value the schema accepts, so drafts stay synthetic. */
function sampleForSchema(schema) {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (schema.type === "object") {
    const value = {};
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      value[key] = sampleForSchema(child);
    }
    return value;
  }
  if (schema.type === "array") return [sampleForSchema(schema.items)];
  if (schema.type === "integer" || schema.type === "number") {
    return typeof schema.minimum === "number" ? schema.minimum : 1;
  }
  if (schema.type === "boolean") return true;
  return "x";
}

/**
 * Builds the draft a strict provider would return: every property present,
 * with the sentinel wherever the ordinary schema left the field optional.
 */
function strictSample(strictSchema, ordinarySchema) {
  const required = new Set(ordinarySchema.required ?? []);
  const draft = {};
  for (const [key, child] of Object.entries(strictSchema.properties ?? {})) {
    if (!required.has(key)) {
      draft[key] = KP_STRICT_TOOL_OMITTED_SENTINEL;
      continue;
    }
    draft[key] = sampleForSchema(child);
  }
  return draft;
}

test("every strict-capable Form emits a schema the provider dialect accepts", () => {
  assert.ok(KP_STRICT_TOOL_CAPABLE_FORMS.length > 0);
  for (const formId of KP_STRICT_TOOL_CAPABLE_FORMS) {
    const issues = deepSeekStrictToolSchemaIssues(buildKpFormStrictToolParameters(formId));
    assert.deepEqual(issues, [], `${formId}: ${issues.join(" | ")}`);
  }
});

test("an unsupported Form is refused by name rather than emitted loosely", () => {
  assert.deepEqual([...KP_STRICT_TOOL_CAPABLE_FORMS, ...KP_STRICT_TOOL_UNSUPPORTED_FORMS].sort(), [...KP_FORM_IDS].sort());
  for (const formId of KP_STRICT_TOOL_UNSUPPORTED_FORMS) {
    assert.equal(kpFormSupportsStrictTool(formId), false);
    assert.throws(
      () => buildKpFormStrictToolParameters(formId),
      /KP_STRICT_TOOL_FORM_UNSUPPORTED/u,
      formId,
    );
  }
});

test("the strict schema requires every property it declares", () => {
  for (const formId of KP_STRICT_TOOL_CAPABLE_FORMS) {
    const strict = buildKpFormStrictToolParameters(formId);
    assert.deepEqual(
      [...(strict.required ?? [])].sort(),
      Object.keys(strict.properties ?? {}).sort(),
      formId,
    );
    assert.equal(strict.additionalProperties, false, formId);
  }
});

test("decoding a strict draft reproduces exactly the ordinary draft shape", () => {
  for (const formId of KP_STRICT_TOOL_CAPABLE_FORMS) {
    const ordinary = buildKpFormToolParameters(formId);
    const strict = buildKpFormStrictToolParameters(formId);
    const draft = strictSample(strict, ordinary);

    // The provider's draft carries every field; the local one must not.
    assert.deepEqual(
      Object.keys(draft).sort(),
      Object.keys(ordinary.properties ?? {}).sort(),
      formId,
    );
    const decoded = decodeKpFormStrictDraft(draft);
    assert.deepEqual(
      Object.keys(decoded).sort(),
      [...(ordinary.required ?? [])].sort(),
      formId,
    );
    assert.deepEqual(strictDraftSentinelMisuse(decoded), [], formId);
  }
});

test("a decoded strict draft validates identically to an ordinary draft", () => {
  for (const formId of KP_STRICT_TOOL_CAPABLE_FORMS) {
    const ordinary = buildKpFormToolParameters(formId);
    const strict = buildKpFormStrictToolParameters(formId);

    // The same sample values, once through the strict encoding and once
    // written directly. Strict output must be behaviourally invisible to
    // every local rule, including the presence-forbidden ones that made the
    // sentinel necessary in the first place.
    const decoded = decodeKpFormStrictDraft(strictSample(strict, ordinary));
    const direct = {};
    for (const key of ordinary.required ?? []) {
      direct[key] = sampleForSchema(ordinary.properties[key]);
    }

    assert.deepEqual(decoded, direct, formId);
    assert.deepEqual(
      validateKpFormDraft(formId, decoded),
      validateKpFormDraft(formId, direct),
      formId,
    );
  }
});

test("the sentinel never survives into a field the local validator can see", () => {
  for (const formId of KP_STRICT_TOOL_CAPABLE_FORMS) {
    const ordinary = buildKpFormToolParameters(formId);
    const strict = buildKpFormStrictToolParameters(formId);
    const decoded = decodeKpFormStrictDraft(strictSample(strict, ordinary));
    assert.doesNotMatch(JSON.stringify(decoded), /__none__/u, formId);
    const { errors } = validateKpFormDraft(formId, decoded);
    for (const error of errors) {
      assert.doesNotMatch(error, /:unknown-field$/u, `${formId}: ${error}`);
      assert.doesNotMatch(error, /:authority-field-forbidden$/u, `${formId}: ${error}`);
    }
  }
});

test("the decoder removes sentinels at every depth and rewrites nothing else", () => {
  const draft = {
    goal: "看清门后的走廊",
    skill: "none",
    resolution: "direct",
    ability: KP_STRICT_TOOL_OMITTED_SENTINEL,
    nested: {
      keep: 3,
      drop: KP_STRICT_TOOL_OMITTED_SENTINEL,
      deeper: [{ keep: false, drop: KP_STRICT_TOOL_OMITTED_SENTINEL }],
    },
    refs: ["fact:a", "fact:b"],
  };
  assert.deepEqual(decodeKpFormStrictDraft(draft), {
    goal: "看清门后的走廊",
    // `none` is a real skill value and must survive the decoder untouched.
    skill: "none",
    resolution: "direct",
    nested: { keep: 3, deeper: [{ keep: false }] },
    refs: ["fact:a", "fact:b"],
  });
});

test("a sentinel used as an array element is reported, not silently dropped", () => {
  const misuse = strictDraftSentinelMisuse({
    basisRefs: ["fact:a", KP_STRICT_TOOL_OMITTED_SENTINEL],
  });
  assert.deepEqual(misuse, ["$.basisRefs[1]:sentinel-not-a-field"]);
});

test("the ordinary tool schema is unchanged so the catalog hash stays stable", () => {
  for (const formId of KP_FORM_IDS) {
    const parameters = buildKpFormToolParameters(formId);
    assert.equal(parameters.type, "object");
    // The strict twin must never be the object the ordinary builder returns.
    if (kpFormSupportsStrictTool(formId)) {
      assert.notDeepEqual(parameters, buildKpFormStrictToolParameters(formId), formId);
    }
  }
});
