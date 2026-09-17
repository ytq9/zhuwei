import assert from "node:assert/strict";

export const schemaVariants = schema => schema.anyOf ?? [schema];

/** Test-only semantic expansion: schema assertions inspect the same contract
 * whether the wire shares repeated definitions or keeps them inline. */
export function expandDeepSeekSchema(schema) {
  const definitions = schema.$def ?? {};
  function visit(value, stack = []) {
    if (Array.isArray(value)) return value.map(child => visit(child, stack));
    if (value === null || typeof value !== "object") return value;
    if (typeof value.$ref === "string") {
      assert.match(value.$ref, /^#\/\$def\/[A-Za-z0-9._-]+$/u);
      const name = value.$ref.slice("#/$def/".length);
      assert.ok(definitions[name], `unresolved schema reference ${name}`);
      assert.equal(stack.includes(name), false, `cyclic schema reference ${name}`);
      const expanded = visit(definitions[name], [...stack, name]);
      return value.description === undefined ? expanded : { ...expanded, description: value.description };
    }
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$def")
      .map(([key, child]) => [key, visit(child, stack)]));
  }
  return visit(schema);
}
