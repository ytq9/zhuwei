import assert from "node:assert/strict";
import test from "node:test";
import { compactDeepSeekStrictToolSchema } from "../app/_runtime/lib/kp/deepseek-strict-schema-compaction.ts";
import { deepSeekStrictToolSchemaIssues } from "../app/_runtime/lib/kp/deepseek-strict-tool.ts";
import { SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";

const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const longText = { type: "string", pattern: "^reference:[A-Za-z0-9._-]+$", description: "An exact reference to a supporting authority record, including its original scope and frozen identity." };

function expand(schema) {
  const defs = schema.$def ?? {};
  function node(value, stack = []) {
    if (Array.isArray(value)) return value.map((part) => node(part, stack));
    if (value === null || typeof value !== "object") return value;
    if (typeof value.$ref === "string") {
      assert.match(value.$ref, /^#\/\$def\/[A-Za-z0-9._-]+$/u);
      const name = value.$ref.slice("#/$def/".length);
      assert.ok(defs[name], `unresolved reference ${name}`);
      assert.equal(stack.includes(name), false, `cycle at ${name}`);
      const expanded = node(defs[name], [...stack, name]);
      return value.description === undefined ? expanded : { ...expanded, description: value.description };
    }
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$def").map(([key, part]) => [key, node(part, stack)]));
  }
  return node(schema);
}

function verifyTypedBranches(schema) {
  if (Array.isArray(schema)) return schema.forEach(verifyTypedBranches);
  if (schema === null || typeof schema !== "object") return;
  for (const branch of schema.anyOf ?? []) assert.equal(typeof branch.type, "string");
  for (const definition of Object.values(schema.$def ?? {})) assert.equal(typeof definition.type, "string");
  Object.values(schema).forEach(verifyTypedBranches);
}

test("compaction shares schema structure without changing alternatives, constraints or descriptions", () => {
  const shared = object({ target: longText, observer: longText });
  const input = object({
    first: shared,
    second: shared,
    outcomes: { type: "array", items: { anyOf: [shared, object({ result: longText })] } },
    optional: { anyOf: [longText, { type: "object", properties: { kind: { type: "string", enum: ["none"] } }, required: ["kind"], additionalProperties: false }] },
  });
  const before = JSON.stringify(input);
  const compacted = compactDeepSeekStrictToolSchema(input);
  assert.deepEqual(deepSeekStrictToolSchemaIssues(compacted), []);
  assert.deepEqual(expand(compacted), input);
  assert.equal(JSON.stringify(input), before);
  assert.ok(JSON.stringify(compacted).length < before.length);
  assert.deepEqual(compactDeepSeekStrictToolSchema(input), compacted);
  verifyTypedBranches(compacted);
});

test("distinct constraints and descriptions remain distinct even when their shape matches", () => {
  const variants = [longText, { ...longText, pattern: "^different:" }, { ...longText, description: "Another scope that must not merge with supporting record references." }];
  const input = object(Object.fromEntries(variants.flatMap((schema, index) => [[`left${index}`, schema], [`right${index}`, schema]])));
  assert.deepEqual(expand(compactDeepSeekStrictToolSchema(input)), input);
});

test("existing definitions and references survive generated-name collisions", () => {
  const input = {
    ...object({ existing: { $ref: "#/$def/0" }, first: longText, second: longText, third: longText }),
    $def: { "0": object({ enabled: { type: "boolean" } }) },
  };
  const compacted = compactDeepSeekStrictToolSchema(input);
  assert.deepEqual(compacted.$def["0"], input.$def["0"]);
  assert.equal(compacted.properties.existing.$ref, "#/$def/0");
  assert.deepEqual(deepSeekStrictToolSchemaIssues(compacted), []);
  assert.deepEqual(expand(compacted), expand(input));
});

test("small schemas stay inline and unsupported schemas are not normalized into acceptance", () => {
  const input = object({ a: { type: "boolean" }, b: { type: "boolean" } });
  assert.deepEqual(compactDeepSeekStrictToolSchema(input), input);
  assert.throws(() => compactDeepSeekStrictToolSchema({ ...input, additionalProperties: true }), /false-required/u);
  assert.throws(() => compactDeepSeekStrictToolSchema({ ...input, properties: { a: { $ref: "#/$defs/thing" }, b: { type: "boolean" } } }), /local-def-required/u);
});

test("the full live proposal schema expands identically with all references resolved and typed anyOf branches", () => {
  const compacted = compactDeepSeekStrictToolSchema(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA);
  assert.deepEqual(deepSeekStrictToolSchemaIssues(compacted), []);
  assert.deepEqual(expand(compacted), expand(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA));
  verifyTypedBranches(compacted);
  assert.ok(Buffer.byteLength(JSON.stringify(compacted)) < Buffer.byteLength(JSON.stringify(expand(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA))) * 0.7);
});
