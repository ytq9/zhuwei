import { NPC_MATERIALIZATION_SOURCE_SCHEMA } from "../../rules/v2/npc-materialization";
import { deepFreeze, isPlainRecord } from "./canonical-json";
import { diagnosticActual, proposalDiagnostic, type ProposalDiagnostic, type ProposalDiagnosticPath } from "./proposal-diagnostics";

type Schema = Readonly<Record<string, unknown>>;
const noneSchema = { type: "object", properties: { kind: { type: "string", enum: ["none"] } },
  required: ["kind"], additionalProperties: false };
const none = () => ({ kind: "none" });
const isNone = (value: unknown) => isPlainRecord(value) && Object.keys(value).length === 1 && value.kind === "none";
const objectSchema = (properties: Record<string, unknown>) => ({ type: "object", properties,
  required: Object.keys(properties), additionalProperties: false });
const optionalSchema = (schema: Schema): Schema => ({ anyOf: [...(Array.isArray(schema.anyOf) ? schema.anyOf : [schema]), noneSchema],
  description: "Use exactly {kind:'none'} when this optional field is absent. Zero and an empty collection are supplied values." });
const schemaRecord = (value: unknown): Schema => {
  if (!isPlainRecord(value)) throw new TypeError("NPC_MATERIALIZATION_SOURCE_SCHEMA_UNSUPPORTED");
  return value;
};
const enumeration = (schema: Schema): readonly unknown[] | undefined => Object.hasOwn(schema, "const")
  ? [schema.const] : Array.isArray(schema.enum) ? schema.enum : undefined;
const nullable = (schema: Schema) => enumeration(schema)?.includes(null) === true;
const scalarType = (schema: Schema): string => {
  if (typeof schema.type === "string") return schema.type;
  const members = enumeration(schema)?.filter(value => value !== null);
  if (!members?.length || !members.every(value => typeof value === typeof members[0])
    || !["string", "number", "boolean"].includes(typeof members[0])) throw new TypeError("NPC_MATERIALIZATION_SOURCE_SCHEMA_UNSUPPORTED");
  return typeof members[0];
};

/** Only representation changes live here. The Rules source schema supplies
 * field names and constraints; isNpcMaterializationSource remains the full
 * accepting validator after decoding, including cross-field mechanics. */
function wireSchema(source: Schema): Schema {
  const constraints = Object.fromEntries(["minLength", "maxLength", "minItems", "maxItems", "uniqueItems",
    "minProperties", "maxProperties", "allOf"].filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]));
  const description = [source.description, ...(Object.keys(constraints).length
    ? [`Required domain constraints: ${JSON.stringify(constraints)}.`] : [])].filter(Boolean).join(" ");
  const annotate = (schema: Schema) => description
    ? { ...schema, description: [schema.description, description].filter(Boolean).join(" ") } : schema;
  if (source.type === "object") {
    if (isPlainRecord(source.additionalProperties)) {
      return annotate({ type: "array", items: objectSchema({ key: wireSchema(schemaRecord(source.propertyNames)),
        value: wireSchema(source.additionalProperties) }),
      description: "Dictionary entries. Each key appears exactly once; [] is an empty dictionary." });
    }
    if (source.additionalProperties !== false) throw new TypeError("NPC_MATERIALIZATION_SOURCE_SCHEMA_UNSUPPORTED");
    const required = new Set(Array.isArray(source.required) ? source.required : []);
    return annotate(objectSchema(Object.fromEntries(Object.entries(schemaRecord(source.properties)).map(([key, child]) => {
      const schema = wireSchema(schemaRecord(child));
      return [key, required.has(key) ? schema : optionalSchema(schema)];
    }))));
  }
  if (source.type === "array") return annotate({ type: "array", items: wireSchema(schemaRecord(source.items)) });
  const scalar: Record<string, unknown> = { type: scalarType(source) };
  const members = enumeration(source)?.filter(value => value !== null);
  if (members) scalar.enum = members;
  for (const key of ["pattern", "format", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"]) {
    if (Object.hasOwn(source, key)) scalar[key] = source[key];
  }
  return annotate(nullable(source) ? { anyOf: [scalar, noneSchema] } : scalar);
}

export const NPC_MATERIALIZATION_WIRE_SCHEMA = deepFreeze(wireSchema(NPC_MATERIALIZATION_SOURCE_SCHEMA));

export class NpcMaterializationWireError extends TypeError {
  constructor(readonly diagnostics: readonly ProposalDiagnostic[]) { super("NPC_MATERIALIZATION_WIRE_INVALID"); }
}
function fail(code: ProposalDiagnostic["code"], constraint: string, path: ProposalDiagnosticPath, expected: unknown, actual: unknown): never {
  throw new NpcMaterializationWireError([proposalDiagnostic(code, constraint,
    { path, pathBase: "arguments", expected, actual: diagnosticActual(actual) })]);
}
function record(value: unknown, path: ProposalDiagnosticPath): Record<string, unknown> {
  if (!isPlainRecord(value)) fail("TYPE_MISMATCH", "npc-wire:object-required", path, { type: "object" }, value);
  return value;
}
function only(value: Record<string, unknown>, fields: readonly string[], path: ProposalDiagnosticPath): void {
  for (const key of Object.keys(value)) if (!fields.includes(key)) {
    fail("VALUE_INVALID", "npc-wire:additional-field", [...path, key], { allowedFields: fields }, value[key]);
  }
}
function own(value: Record<string, unknown>, key: string, path: ProposalDiagnosticPath): unknown {
  if (!Object.hasOwn(value, key)) fail("FIELD_MISSING", "npc-wire:field-required", [...path, key], "explicit field", undefined);
  return value[key];
}
function list(value: unknown, path: ProposalDiagnosticPath): unknown[] {
  if (!Array.isArray(value)) fail("TYPE_MISMATCH", "npc-wire:entry-array-required", path, { type: "array" }, value);
  return value;
}

function transcode(value: unknown, source: Schema, decode: boolean, path: ProposalDiagnosticPath): unknown {
  if (nullable(source)) {
    if (decode && isNone(value)) return null;
    if (!decode && value === null) return none();
  }
  if (source.type === "object") {
    if (isPlainRecord(source.additionalProperties)) {
      const entrySource = source.additionalProperties, keySource = schemaRecord(source.propertyNames);
      if (!decode) return Object.entries(record(value, path)).map(([key, child]) => ({
        key: transcode(key, keySource, false, [...path, key]), value: transcode(child, entrySource, false, [...path, key]),
      }));
      const seen = new Set<string>();
      const entries = list(value, path).map((raw, index): [string, unknown] => {
        const entryPath = [...path, index], entry = record(raw, entryPath);
        only(entry, ["key", "value"], entryPath);
        const key = transcode(own(entry, "key", entryPath), keySource, true, [...entryPath, "key"]);
        if (typeof key !== "string") fail("TYPE_MISMATCH", "npc-wire:string-key-required", [...entryPath, "key"], { type: "string" }, key);
        if (seen.has(key)) fail("CONSTRAINT_CONFLICT", "npc-wire:duplicate-key", [...entryPath, "key"], "one entry per key", key);
        seen.add(key);
        return [key, transcode(own(entry, "value", entryPath), entrySource, true, [...entryPath, "value"])];
      });
      // Construct only after proving key uniqueness. Object.fromEntries also
      // preserves __proto__ as data without changing the object's prototype.
      return Object.fromEntries(entries);
    }
    const input = record(value, path), properties = schemaRecord(source.properties);
    const required = new Set(Array.isArray(source.required) ? source.required : []);
    only(input, Object.keys(properties), path);
    return Object.fromEntries(Object.entries(properties).flatMap(([key, child]) => {
      const optional = !required.has(key);
      if (!decode && optional && !Object.hasOwn(input, key)) return [[key, none()]];
      const field = own(input, key, path);
      if (decode && optional && isNone(field)) return [];
      return [[key, transcode(field, schemaRecord(child), decode, [...path, key])]];
    }));
  }
  if (source.type === "array") return list(value, path).map((child, index) => transcode(child, schemaRecord(source.items), decode, [...path, index]));
  const type = scalarType(source);
  if (type === "integer" ? !Number.isSafeInteger(value) : typeof value !== type) {
    fail("TYPE_MISMATCH", "npc-wire:scalar-type-required", path, { type }, value);
  }
  // Semantic values are never repaired, clamped, sorted or normalized here.
  // The same complete Rules validator sees the exact submitted scalar.
  return value;
}

export function encodeNpcMaterializationWire(value: unknown): unknown {
  return transcode(value, NPC_MATERIALIZATION_SOURCE_SCHEMA, false, []);
}
export function decodeNpcMaterializationWire(value: unknown): unknown {
  return transcode(value, NPC_MATERIALIZATION_SOURCE_SCHEMA, true, []);
}
