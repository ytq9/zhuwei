import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildKpFormToolParameters,
  validateKpFormDraft,
} from "../app/_runtime/lib/kp/form-catalog.ts";
import {
  KP_STRICT_TOOL_OMITTED_SENTINEL,
  buildKpFormStrictToolParameters,
  decodeKpFormStrictDraft,
  strictDraftSentinelMisuse,
} from "../app/_runtime/lib/kp/form-strict-tool.ts";

/**
 * The decode step lives inside `narrowToolDraft`, which is module-private.
 * The behaviour that matters is observable without it: a strict draft and the
 * ordinary draft it stands for must reach `validateKpFormDraft` identically.
 */
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

test("the adapter decodes strict drafts before anything downstream sees them", async () => {
  const source = await readFile(
    new URL("../app/_runtime/lib/kp/authoritative.ts", import.meta.url),
    "utf8",
  );

  // The decode must sit between the parse and the validation, on both the
  // initial envelope and the repair, or a strict draft reaches the local
  // rules with every optional field still present.
  assert.match(
    source,
    /narrowToolDraft\(\s*formId,\s*toolCall\.arguments,\s*structuredOutputMode,?\s*\)/u,
  );
  assert.match(
    source,
    /narrowToolDraft\(\s*selectedForm,\s*toolCall\.arguments,\s*structuredOutputMode,?\s*\)/u,
  );

  // The transport that builds the request and the decode that reads the
  // response must both come from the profile, never be assumed. The read goes
  // through the per-call helper because the profile's opt-in cannot reach a
  // multi-Form selection call: strict beta carries one function per request.
  const modeReads = source.match(/kpCallStructuredOutputMode\(\s*profile,/gu) ?? [];
  assert.equal(modeReads.length, 4, "request and response paths both read the profile mode");
  // A bare profile read would skip the call-shape decision and could send a
  // strict selection call, so none may remain in the adapter.
  assert.equal((source.match(/kpStructuredOutputMode\(profile\)/gu) ?? []).length, 0);
});

test("a strict draft and its ordinary twin validate identically end to end", () => {
  for (const formId of ["observe.v1", "npc-exchange.v1", "materialization.v1"]) {
    const ordinary = buildKpFormToolParameters(formId);
    const strict = buildKpFormStrictToolParameters(formId);
    const required = new Set(ordinary.required ?? []);

    // What a strict provider returns: every property, sentinels for the rest.
    const strictArguments = {};
    for (const [key, child] of Object.entries(strict.properties ?? {})) {
      strictArguments[key] = required.has(key)
        ? sampleForSchema(child)
        : KP_STRICT_TOOL_OMITTED_SENTINEL;
    }
    // What an ordinary provider returns for the same intent.
    const ordinaryArguments = {};
    for (const key of required) {
      ordinaryArguments[key] = sampleForSchema(ordinary.properties[key]);
    }

    assert.deepEqual(strictDraftSentinelMisuse(strictArguments), [], formId);
    const decoded = decodeKpFormStrictDraft(strictArguments);
    assert.deepEqual(decoded, ordinaryArguments, formId);
    assert.deepEqual(
      validateKpFormDraft(formId, decoded),
      validateKpFormDraft(formId, ordinaryArguments),
      formId,
    );
  }
});

test("a sentinel standing where a value belongs is rejected, not dropped", () => {
  // `basisRefs` is a list of references; a sentinel inside it is a contract
  // error, and silently removing the element would forge a shorter list.
  const misuse = strictDraftSentinelMisuse({
    goal: "看清门后的走廊",
    basisRefs: ["fact:a", KP_STRICT_TOOL_OMITTED_SENTINEL],
  });
  assert.deepEqual(misuse, ["$.basisRefs[1]:sentinel-not-a-field"]);
});

test("an ordinary draft is untouched by the decode path", () => {
  // `none` is a real skill value; the ordinary transport must not lose it,
  // and the decoder must never run on a draft that did not come from strict
  // output.
  const draft = { goal: "x", skill: "none", resolution: "direct" };
  assert.deepEqual(decodeKpFormStrictDraft(draft), draft);
  assert.deepEqual(strictDraftSentinelMisuse(draft), []);
});
