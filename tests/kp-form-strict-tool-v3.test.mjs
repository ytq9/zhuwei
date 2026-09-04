import assert from "node:assert/strict";
import test from "node:test";

import {
  KP_FORM_IDS,
  buildKpFormToolParameters,
  validateKpFormDraft,
} from "../app/_runtime/lib/kp/form-catalog.ts";
import {
  KP_STRICT_TOOL_CAPABLE_FORMS,
  KP_STRICT_TOOL_NULL_SENTINEL,
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
  // A union reaches here from the strict encoding of a discriminated union.
  // The sentinel alternatives are what the decoder removes, so a sample that
  // is meant to survive decoding has to come from a real branch.
  if (Array.isArray(schema.anyOf)) {
    const real = schema.anyOf.filter((branch) => !isSentinelSchema(branch));
    return sampleForSchema(real[0] ?? schema.anyOf[0]);
  }
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

function isSentinelSchema(branch) {
  return branch !== null
    && typeof branch === "object"
    && Array.isArray(branch.enum)
    && branch.enum.length === 1
    && (branch.enum[0] === KP_STRICT_TOOL_OMITTED_SENTINEL
      || branch.enum[0] === KP_STRICT_TOOL_NULL_SENTINEL);
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

/**
 * For every Form except `compound.v1` the strict encoding differs from the
 * ordinary one only by the sentinel on optional fields, so the same sample
 * walked through both must come out identical. `compound.v1` is excluded
 * because its encodings are deliberately not structurally parallel: the
 * ordinary one flattens a discriminated union into one object carrying every
 * branch's field names, which is not a draft any branch could legally produce,
 * while the strict one is an `anyOf` over closed branches. Sampling the two
 * cannot agree, and the meaningful round trip is asserted separately below.
 */
const STRUCTURALLY_PARALLEL_FORMS = KP_STRICT_TOOL_CAPABLE_FORMS
  .filter((formId) => formId !== "compound.v1");

test("a decoded strict draft validates identically to an ordinary draft", () => {
  for (const formId of STRUCTURALLY_PARALLEL_FORMS) {
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
  for (const formId of STRUCTURALLY_PARALLEL_FORMS) {
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

/**
 * The round trip `compound.v1` is excluded from above, asserted directly.
 * A compound draft is branch-shaped in both dialects -- only the *schema*
 * differs -- so a strict draft is the same draft with the sentinel standing in
 * for the optional top-level fields, and decoding must return exactly the
 * draft written by hand.
 */
test("a strict compound draft decodes to the ordinary compound draft", () => {
  const direct = {
    goal: "撬开压住链条的石板",
    method: "先固定撬棍再逐段发力",
    stages: [{
      goal: "固定撬棍",
      method: "把撬棍卡进石板缝隙",
      intendedOutcome: "撬棍不会滑脱",
      resolution: "direct",
    }],
    intendedOutcome: "石板被撬开",
    resolution: "direct",
    durationUnit: "minute",
    durationValue: 1,
    composition: {
      schema: "zhuwei.compound-composition-draft/v1",
      before: [],
      onSuccess: [],
      onFailure: [],
    },
  };

  const ordinary = buildKpFormToolParameters("compound.v1");
  const required = new Set(ordinary.required ?? []);
  const strict = {};
  for (const key of Object.keys(ordinary.properties ?? {})) {
    strict[key] = required.has(key) ? direct[key] : KP_STRICT_TOOL_OMITTED_SENTINEL;
  }
  // Every property is present in a strict draft, including the optional ones.
  assert.equal(
    Object.keys(strict).length,
    Object.keys(ordinary.properties ?? {}).length,
  );
  assert.ok(Object.keys(strict).length > Object.keys(direct).length);

  const decoded = decodeKpFormStrictDraft(strict);
  assert.deepEqual(decoded, direct);
  assert.doesNotMatch(JSON.stringify(decoded), /__none__/u);
  assert.deepEqual(
    validateKpFormDraft("compound.v1", decoded),
    validateKpFormDraft("compound.v1", direct),
  );
  assert.equal(validateKpFormDraft("compound.v1", direct).errors.length, 0);
});

test("the null sentinel decodes to a null value and keeps its key", () => {
  const decoded = decodeKpFormStrictDraft({
    npcRef: "npc:1",
    factionRef: KP_STRICT_TOOL_NULL_SENTINEL,
    note: KP_STRICT_TOOL_OMITTED_SENTINEL,
  });
  // `null` is a value an actor plan really carries, and `validateActorPlan`
  // checks the key set exactly, so the key must survive where an omitted
  // field's key is removed.
  assert.deepEqual(decoded, { npcRef: "npc:1", factionRef: null });
  assert.equal("factionRef" in decoded, true);
  assert.equal("note" in decoded, false);
});
