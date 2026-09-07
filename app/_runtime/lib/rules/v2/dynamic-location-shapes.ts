import { isCanonicalTacticalGeometry, type CanonicalTacticalGeometry, type SpatialShapeDiagnostic } from "../profiles/tactical-geometry";
import type { JsonRecord } from "./model";

export type DynamicPassage = Readonly<{
  fromLocationRef: string;
  toLocationRef: string;
  bidirectional: boolean;
  traversal: string;
  travelDurationMicros: string;
}>;

export type PassageTraversalBinding = Readonly<{
  passageRef: string;
  passageHash: string;
  sourceSceneRef: string;
  destinationSceneRef: string;
  travelDurationMicros: string;
}>;

export function passageFactRef(passageRef: string): string { return `passage-fact:${passageRef}`; }

export function passageTraversalBindingConform(value: unknown): value is PassageTraversalBinding {
  return record(value) && exact(value, ["passageRef", "passageHash", "sourceSceneRef", "destinationSceneRef", "travelDurationMicros"])
    && [value.passageRef, value.sourceSceneRef, value.destinationSceneRef].every(ref)
    && value.sourceSceneRef !== value.destinationSceneRef && typeof value.passageHash === "string"
    && /^sha256:[0-9a-f]{64}$/u.test(value.passageHash) && typeof value.travelDurationMicros === "string"
    && /^[1-9][0-9]{0,17}$/u.test(value.travelDurationMicros);
}

export function dynamicLocationSceneRef(definitionRef: string): string {
  return `scene:${definitionRef}`;
}

export function dynamicLocationContentConform(value: unknown): value is JsonRecord & {
  scopeRef: string; geometry: CanonicalTacticalGeometry;
} {
  return record(value) && ref(value.scopeRef) && isCanonicalTacticalGeometry(value.geometry);
}

export function dynamicPassageConform(value: unknown, diagnostics?: SpatialShapeDiagnostic[]): value is DynamicPassage {
  if (!record(value)) return passageFailure(diagnostics, "TYPE_MISMATCH", [], { type: "object" }, "passage:object-required");
  const keys = ["fromLocationRef", "toLocationRef", "bidirectional", "traversal", "travelDurationMicros"];
  if (!exact(value, keys)) {
    for (const key of keys) if (!Object.hasOwn(value, key))
      passageFailure(diagnostics, "FIELD_MISSING", [key], { required: true }, "passage:field-required");
    for (const key of Object.keys(value)) if (!keys.includes(key))
      passageFailure(diagnostics, "VALUE_INVALID", [key], { allowedFields: keys }, "passage:additional-field");
    return false;
  }
  // This describes the original reference predicate without granting the KP
  // prose normalizer permission to rewrite opaque endpoint identities.
  const reference = { type: "string", minLength: 1, maxLength: 300, canonical: "NFC-without-surrounding-whitespace" };
  return passageField(value, "fromLocationRef", ref, reference, diagnostics)
    && passageField(value, "toLocationRef", ref, reference, diagnostics)
    && (value.fromLocationRef !== value.toLocationRef || passageFailure(diagnostics, "CONSTRAINT_CONFLICT", ["toLocationRef"],
      { differentFromField: "fromLocationRef" }, "passage:distinct-endpoints"))
    && passageField(value, "bidirectional", entry => typeof entry === "boolean", { type: "boolean" }, diagnostics)
    && passageField(value, "traversal", entry => typeof entry === "string" && entry.trim().length > 0 && entry.length <= 1_000,
      { type: "string", nonWhitespace: true, maxLength: 1_000 }, diagnostics)
    && passageField(value, "travelDurationMicros", entry => typeof entry === "string" && /^[1-9][0-9]{0,17}$/u.test(entry),
      { type: "string", pattern: "^[1-9][0-9]{0,17}$" }, diagnostics);
}

function passageFailure(diagnostics: SpatialShapeDiagnostic[] | undefined, code: SpatialShapeDiagnostic["code"],
  path: SpatialShapeDiagnostic["path"], expected: SpatialShapeDiagnostic["expected"], constraint: string): false {
  diagnostics?.push({ code, path, expected, constraint });
  return false;
}
function passageField(value: Record<string, unknown>, key: string, predicate: (value: unknown) => boolean,
  expected: SpatialShapeDiagnostic["expected"], diagnostics?: SpatialShapeDiagnostic[]): boolean {
  if (predicate(value[key])) return true;
  const actualType = value[key] === null ? "null" : Array.isArray(value[key]) ? "array" : typeof value[key];
  return passageFailure(diagnostics, actualType === expected.type ? "VALUE_INVALID" : "TYPE_MISMATCH",
    [key], expected, "passage:field-contract");
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function ref(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 300 && value.trim() === value && value.normalize("NFC") === value; }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
