import {
  assertDeepSeekStrictToolSchema,
  type DeepSeekStrictToolSchema,
} from "./deepseek-strict-tool";

type Schema = DeepSeekStrictToolSchema;
type Candidate = { schema: Schema; count: number };

const encoder = new TextEncoder();

/**
 * Shares identical schema nodes using DeepSeek's documented singular `$def`:
 * https://api-docs.deepseek.com/guides/tool_calls/#ref-and-def
 *
 * This changes serialization only. Descriptions, constraints, required fields
 * and every alternative remain intact. A definition and an immediate anyOf
 * branch retain their literal type: ref-only branches failed the real strict
 * endpoint even though references elsewhere are documented and supported.
 *
 * `$def` is documented for tool calls, not for the strict beta alone, so the
 * sharing pass itself is dialect-neutral. Only this entry point asserts the
 * strict dialect, on the way in and on the way out.
 */
export function compactDeepSeekStrictToolSchema(input: Schema): Schema {
  assertDeepSeekStrictToolSchema(input);
  const result = shareIdenticalSchemaNodes(input);
  assertDeepSeekStrictToolSchema(result);
  return result;
}

/**
 * The same sharing pass for an ordinary, non-strict tool schema. The provider
 * does not enforce an ordinary schema, so no dialect assertion applies; the
 * keywords the strict dialect forbids (`allOf`, `if`/`then`, `minLength`,
 * `maxItems`) ride inside whichever node is hoisted and are never rewritten.
 */
export function compactDeepSeekToolSchema(input: Schema): Schema {
  return shareIdenticalSchemaNodes(input);
}

function shareIdenticalSchemaNodes(input: Schema): Schema {
  const source = JSON.parse(JSON.stringify(input)) as Schema;
  const candidates = new Map<string, Candidate>();
  visit(source, false, (schema, replaceable) => {
    if (!replaceable || typeof schema.type !== "string") return;
    const key = JSON.stringify(schema);
    const candidate = candidates.get(key);
    if (candidate) candidate.count += 1;
    else candidates.set(key, { schema, count: 1 });
  });

  const occupied = new Set(Object.keys(definitions(source)));
  const selected = new Map<string, string>();
  const generated = new Map<string, Schema>();
  let sequence = 0;
  for (const [key, candidate] of candidates) {
    if (candidate.count < 2) continue;
    // Local definition names have no domain meaning. Short deterministic
    // symbols reduce every repeated reference while preserving existing names.
    while (occupied.has(sequence.toString(36))) sequence += 1;
    const name = sequence.toString(36);
    const bodyBytes = bytes(key);
    const refBytes = bytes(JSON.stringify(reference(name)));
    const definitionBytes = bytes(JSON.stringify({ [name]: candidate.schema })) - 2;
    if (candidate.count * (bodyBytes - refBytes) <= definitionBytes + 10) continue;
    selected.set(key, name);
    generated.set(name, candidate.schema);
    occupied.add(name);
    sequence += 1;
  }

  if (generated.size === 0) return source;
  const replace = (schema: Schema, replaceable: boolean): Schema => {
    const name = replaceable ? selected.get(JSON.stringify(schema)) : undefined;
    return name ? reference(name) : mapChildren(schema, replace);
  };
  let result = replace(source, false);
  result.$def = {
    ...definitions(result),
    ...Object.fromEntries([...generated].map(([name, schema]) => [name, replace(schema, false)])),
  };

  // Hoisting a parent can make a nested definition unused or unprofitable.
  // Remove those definitions using their actual remaining reference count.
  let changed = true;
  while (changed) {
    changed = false;
    const counts = new Map<string, number>();
    visit(result, false, (schema) => {
      const name = generatedReferenceName(schema, generated);
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    for (const name of generated.keys()) {
      const body = definitions(result)[name]!;
      const count = counts.get(name) ?? 0;
      const bodyBytes = bytes(JSON.stringify(body));
      const refBytes = bytes(JSON.stringify(reference(name)));
      const definitionBytes = bytes(JSON.stringify({ [name]: body })) - 1;
      if (count > 1 && count * (bodyBytes - refBytes) > definitionBytes) continue;
      const inline = (schema: Schema): Schema => {
        if (generatedReferenceName(schema, generated) === name) return mapChildren(body, inline);
        return mapChildren(schema, inline);
      };
      result = inline(result);
      delete definitions(result)[name];
      generated.delete(name);
      changed = true;
      break;
    }
  }

  if (Object.keys(definitions(result)).length === 0) delete result.$def;
  // A tiny input may not recover the root definitions-container overhead.
  if (bytes(JSON.stringify(result)) >= bytes(JSON.stringify(source))) return source;
  return result;
}

function definitions(schema: Schema): Record<string, Schema> {
  return (schema.$def ?? {}) as Record<string, Schema>;
}

function reference(name: string): Schema {
  return { $ref: `#/$def/${name}` };
}

function generatedReferenceName(schema: Schema, generated: ReadonlyMap<string, Schema>): string | undefined {
  if (typeof schema.$ref !== "string") return undefined;
  const name = schema.$ref.slice("#/$def/".length);
  return generated.has(name) ? name : undefined;
}

function bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

function visit(schema: Schema, replaceable: boolean, consume: (node: Schema, replaceable: boolean) => void): void {
  consume(schema, replaceable);
  mapChildren(schema, (child, mayReplace) => {
    visit(child, mayReplace, consume);
    return child;
  });
}

function mapChildren(schema: Schema, transform: (node: Schema, replaceable: boolean) => Schema): Schema {
  const result = { ...schema };
  if (schema.type === "object") {
    // The strict dialect requires `properties` on every object; an ordinary
    // schema may describe an object without listing any.
    if (schema.properties !== undefined) {
      result.properties = Object.fromEntries(
        Object.entries(schema.properties as Record<string, Schema>)
          .map(([name, child]) => [name, transform(child, true)]),
      );
    }
    if (schema.$def) {
      result.$def = Object.fromEntries(
        Object.entries(definitions(schema)).map(([name, child]) => [name, transform(child, false)]),
      );
    }
  } else if (schema.type === "array") {
    if (schema.items !== undefined) result.items = transform(schema.items as Schema, true);
  } else if (Array.isArray(schema.anyOf)) {
    result.anyOf = (schema.anyOf as Schema[]).map((child) => transform(child, false));
  }
  return result;
}
