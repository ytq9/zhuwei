export const DEEPSEEK_STRICT_TOOL_BETA_ENDPOINT =
  "https://api.deepseek.com/beta/chat/completions" as const;

export const DEEPSEEK_STRICT_TOOL_ENDPOINT_PROTOCOL =
  "deepseek-chat-completions-beta-strict-tool-v1" as const;

export const DEEPSEEK_STRICT_TOOL_SCHEMA_DIALECT =
  "deepseek-strict-tool-beta-2026-09-02" as const;

export type DeepSeekStrictToolSchema = Record<string, unknown>;

type JsonSchemaRecord = DeepSeekStrictToolSchema;
type ValidationState = {
  nodes: number;
  refs: Set<string>;
  rootDefinitions: Set<string>;
};

const SUPPORTED_TYPES = new Set([
  "object",
  "string",
  "number",
  "integer",
  "boolean",
  "array",
]);

const COMMON_KEYS = new Set(["description"]);
const SCALAR_KEYS = new Set([...COMMON_KEYS, "enum"]);
const OBJECT_KEYS = new Set([
  ...COMMON_KEYS,
  "type",
  "properties",
  "required",
  "additionalProperties",
  "$def",
]);
const STRING_KEYS = new Set([...SCALAR_KEYS, "type", "pattern", "format"]);
const NUMBER_KEYS = new Set([
  ...SCALAR_KEYS,
  "type",
  "const",
  "default",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
]);
const BOOLEAN_KEYS = new Set([...SCALAR_KEYS, "type"]);
const ARRAY_KEYS = new Set([...COMMON_KEYS, "type", "items"]);
const ANY_OF_KEYS = new Set([...COMMON_KEYS, "anyOf"]);
const REF_KEYS = new Set(["$ref", "description"]);
const STRING_FORMATS = new Set(["email", "hostname", "ipv4", "ipv6", "uuid"]);
const MAX_SCHEMA_DEPTH = 32;
const MAX_SCHEMA_NODES = 2_048;

/**
 * Validates the documented DeepSeek strict-tool beta dialect before a
 * production request is sent. This is a transport compatibility check only;
 * domain, reference and Rules validation still happen after generation.
 */
export function assertDeepSeekStrictToolSchema(value: unknown): asserts value is JsonSchemaRecord {
  const state: ValidationState = {
    nodes: 0,
    refs: new Set(),
    rootDefinitions: new Set(),
  };
  validateSchemaNode(value, "$", 0, state, true);
  for (const ref of state.refs) {
    if (!state.rootDefinitions.has(ref)) invalid(`$ref:${ref}:definition-not-found`);
  }
}

export function deepSeekStrictToolSchemaIssues(value: unknown): readonly string[] {
  try {
    assertDeepSeekStrictToolSchema(value);
    return Object.freeze([]);
  } catch (error) {
    return Object.freeze([
      error instanceof Error ? error.message : "DEEPSEEK_STRICT_SCHEMA_INVALID",
    ]);
  }
}

function validateSchemaNode(
  value: unknown,
  path: string,
  depth: number,
  state: ValidationState,
  root = false,
): void {
  if (depth > MAX_SCHEMA_DEPTH) invalid(`${path}:depth-exceeded`);
  state.nodes += 1;
  if (state.nodes > MAX_SCHEMA_NODES) invalid(`${path}:node-budget-exceeded`);
  if (!isRecord(value)) invalid(`${path}:object-required`);

  if (typeof value.$ref === "string") {
    exactKeys(value, REF_KEYS, path);
    const match = /^#\/\$def\/([A-Za-z0-9._-]+)$/u.exec(value.$ref);
    if (match === null) {
      invalid(`${path}.$ref:local-def-required`);
    }
    state.refs.add(match[1]!);
    optionalDescription(value, path);
    return;
  }

  if (Array.isArray(value.anyOf)) {
    exactKeys(value, ANY_OF_KEYS, path);
    if (root) invalid(`${path}:root-object-required`);
    if (value.anyOf.length < 1 || value.anyOf.length > 64) {
      invalid(`${path}.anyOf:bounded-alternatives-required`);
    }
    optionalDescription(value, path);
    value.anyOf.forEach((candidate, index) => {
      if (isRecord(candidate)
        && typeof candidate.type !== "string"
        && typeof candidate.$ref !== "string") {
        invalid(`${path}.anyOf[${index}].type:required-for-anyOf-branch`);
      }
      validateSchemaNode(candidate, `${path}.anyOf[${index}]`, depth + 1, state);
    });
    return;
  }

  if (typeof value.type !== "string" || !SUPPORTED_TYPES.has(value.type)) {
    invalid(`${path}.type:unsupported`);
  }
  if (root && value.type !== "object") invalid(`${path}:root-object-required`);

  if (value.type === "object") {
    exactKeys(value, OBJECT_KEYS, path);
    validateObjectSchema(value, path, depth, state, root);
    return;
  }
  if (value.type === "string") {
    exactKeys(value, STRING_KEYS, path);
    optionalDescription(value, path);
    optionalEnum(value, path, "string");
    if (value.pattern !== undefined && typeof value.pattern !== "string") {
      invalid(`${path}.pattern:string-required`);
    }
    if (value.format !== undefined
      && (typeof value.format !== "string" || !STRING_FORMATS.has(value.format))) {
      invalid(`${path}.format:unsupported`);
    }
    return;
  }
  if (value.type === "number" || value.type === "integer") {
    exactKeys(value, NUMBER_KEYS, path);
    optionalDescription(value, path);
    optionalEnum(value, path, value.type);
    for (const key of [
      "const",
      "default",
      "minimum",
      "maximum",
      "exclusiveMinimum",
      "exclusiveMaximum",
      "multipleOf",
    ]) {
      if (value[key] !== undefined
        && (typeof value[key] !== "number" || !Number.isFinite(value[key]))) {
        invalid(`${path}.${key}:number-required`);
      }
    }
    return;
  }
  if (value.type === "boolean") {
    exactKeys(value, BOOLEAN_KEYS, path);
    optionalDescription(value, path);
    optionalEnum(value, path, "boolean");
    return;
  }

  exactKeys(value, ARRAY_KEYS, path);
  optionalDescription(value, path);
  if (!("items" in value)) invalid(`${path}.items:required`);
  validateSchemaNode(value.items, `${path}.items`, depth + 1, state);
}

function validateObjectSchema(
  value: JsonSchemaRecord,
  path: string,
  depth: number,
  state: ValidationState,
  root: boolean,
): void {
  optionalDescription(value, path);
  if (!isRecord(value.properties)) invalid(`${path}.properties:object-required`);
  if (!Array.isArray(value.required)
    || value.required.some((entry) => typeof entry !== "string")) {
    invalid(`${path}.required:string-array-required`);
  }
  if (value.additionalProperties !== false) {
    invalid(`${path}.additionalProperties:false-required`);
  }
  const propertyNames = Object.keys(value.properties).sort();
  const required = [...new Set(value.required as string[])].sort();
  if (required.length !== (value.required as string[]).length
    || propertyNames.length !== required.length
    || propertyNames.some((name, index) => name !== required[index])) {
    invalid(`${path}.required:all-properties-required`);
  }
  if (value.$def !== undefined) {
    if (!root) invalid(`${path}.$def:root-only`);
    if (!isRecord(value.$def)) invalid(`${path}.$def:object-required`);
    for (const name of Object.keys(value.$def)) {
      if (!/^[A-Za-z0-9._-]+$/u.test(name)) invalid(`${path}.$def:invalid-name`);
      state.rootDefinitions.add(name);
    }
  }
  for (const [name, schema] of Object.entries(value.properties)) {
    validateSchemaNode(schema, `${path}.properties.${name}`, depth + 1, state);
  }
  if (isRecord(value.$def)) {
    for (const [name, schema] of Object.entries(value.$def)) {
      validateSchemaNode(schema, `${path}.$def.${name}`, depth + 1, state);
    }
  }
}

function optionalDescription(value: JsonSchemaRecord, path: string): void {
  if (value.description !== undefined && typeof value.description !== "string") {
    invalid(`${path}.description:string-required`);
  }
}

function optionalEnum(
  value: JsonSchemaRecord,
  path: string,
  expectedType: "string" | "number" | "integer" | "boolean",
): void {
  if (value.enum === undefined) return;
  if (!Array.isArray(value.enum) || value.enum.length === 0) {
    invalid(`${path}.enum:non-empty-array-required`);
  }
  const serialized = value.enum.map((entry) => {
    const matchesType = expectedType === "integer"
      ? Number.isInteger(entry)
      : expectedType === "number"
        ? typeof entry === "number" && Number.isFinite(entry)
        : typeof entry === expectedType;
    if (!matchesType) invalid(`${path}.enum:${expectedType}-values-required`);
    return JSON.stringify(entry);
  });
  if (new Set(serialized).size !== serialized.length) invalid(`${path}.enum:unique-required`);
}

function exactKeys(value: JsonSchemaRecord, allowed: ReadonlySet<string>, path: string): void {
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key));
  if (unsupported.length > 0) invalid(`${path}.${unsupported.sort()[0]}:unsupported-keyword`);
}

function isRecord(value: unknown): value is JsonSchemaRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(issue: string): never {
  throw new TypeError(`DEEPSEEK_STRICT_SCHEMA_INVALID:${issue}`);
}
