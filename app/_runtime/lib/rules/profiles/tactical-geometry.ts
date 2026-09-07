import type { TacticalPoint2d, TacticalPosition } from "../tactical-projection";
import {
  environmentBindingMatchesFeature,
  isCompiledEnvironmentBinding,
  type CompiledEnvironmentBinding,
} from "./environment";

export type CanonicalTacticalFeature = {
  featureId: string;
  kind: "barrier" | "terrain" | "interactable" | "destructible" | "portal";
  label: string;
  state: string;
  polygon: TacticalPoint2d[];
  elevation: string;
  height: string;
  opaque: boolean;
  impassable: boolean;
  cover: "none" | "half" | "threeQuarters" | "full";
  propagation: "passes" | "blocks";
  terrain?: "normal" | "rubble";
  durability?: CanonicalTacticalFeatureDurability;
  stateGraph?: CanonicalTacticalFeatureStateGraph;
  environment?: CompiledEnvironmentBinding;
  visibilityPolicyId:
    | "visibility:public"
    | "visibility:scene-observers"
    | "visibility:hidden-until-evidence";
};

export type CanonicalTacticalFeatureState = {
  state: string;
  opaque: boolean;
  impassable: boolean;
  cover: "none" | "half" | "threeQuarters" | "full";
  propagation: "passes" | "blocks";
  terrain?: "normal" | "rubble";
};

export type CanonicalTacticalFeatureDurability = {
  current: string;
  maximum: string;
  armorClass: string;
  damageThreshold: string;
  immuneDamageTypes: string[];
};

export type CanonicalTacticalFeatureStateGraph = {
  definitionId: string;
  states: CanonicalTacticalFeatureState[];
  transitions: Array<{
    fromState: string;
    intent: "open" | "close" | "applyStunt" | "triggerHazard" | "resolveHazard";
    toState: string;
  }>;
  durability?: Omit<CanonicalTacticalFeatureDurability, "current">;
  damageTransitions?: Array<{
    fromState: string;
    remainingDurabilityAtOrBelow: string;
    toState: string;
  }>;
};

export type CanonicalTacticalGeometry = {
  schema: "zhuwei.tactical-geometry/v1";
  unit: "inch";
  boundary: {
    kind: "polygon";
    points: TacticalPoint2d[];
  };
  spawnPoints: TacticalPosition[];
  obstacles: CanonicalTacticalFeature[];
  clearanceZones: [];
};

type UnknownRecord = Record<string, unknown>;

/** Relative failures from the accepting predicate; consumers read actual values
 * from their own authorized source. No KP or repair policy belongs here. */
export type SpatialShapeDiagnostic = Readonly<{
  code: "FIELD_MISSING" | "TYPE_MISMATCH" | "VALUE_INVALID" | "CONSTRAINT_CONFLICT";
  path: readonly (string | number)[];
  expected: Readonly<Record<string, unknown>>;
  constraint: string;
}>;
type ShapePath = SpatialShapeDiagnostic["path"];

function shapeFailure(diagnostics: SpatialShapeDiagnostic[] | undefined, path: ShapePath,
  expected: SpatialShapeDiagnostic["expected"], constraint: string,
  code: SpatialShapeDiagnostic["code"] = "CONSTRAINT_CONFLICT"): false {
  diagnostics?.push({ code, path, expected, constraint });
  return false;
}

function shapeField(value: UnknownRecord, key: string, predicate: (value: unknown) => boolean,
  expected: SpatialShapeDiagnostic["expected"], diagnostics?: SpatialShapeDiagnostic[], path: ShapePath = []): boolean {
  if (predicate(value[key])) return true;
  const actualType = value[key] === null ? "null" : Array.isArray(value[key]) ? "array" : typeof value[key];
  return shapeFailure(diagnostics, [...path, key], expected, "geometry:field-contract",
    !(key in value) ? "FIELD_MISSING" : actualType !== expected.type ? "TYPE_MISMATCH" : "VALUE_INVALID");
}

const INTEGER_PATTERN = /^(0|-?[1-9][0-9]*)$/;
const INT32_MIN = -2_147_483_648n;
const INT32_MAX = 2_147_483_647n;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: UnknownRecord, keys: readonly string[],
  diagnostics?: SpatialShapeDiagnostic[], path: ShapePath = []): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length === expected.length && actual.every((key, index) => key === expected[index])) return true;
  for (const key of expected) if (!actual.includes(key))
    shapeFailure(diagnostics, [...path, key], { required: true }, "geometry:field-required", "FIELD_MISSING");
  for (const key of actual) if (!expected.includes(key))
    shapeFailure(diagnostics, [...path, key], { allowedFields: expected }, "geometry:additional-field", "VALUE_INVALID");
  return false;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function canonicalInteger(value: unknown): value is string {
  if (typeof value !== "string" || !INTEGER_PATTERN.test(value)) return false;
  const parsed = BigInt(value);
  return parsed >= INT32_MIN && parsed <= INT32_MAX;
}

function canonicalUnsignedInteger(value: unknown): value is string {
  return typeof value === "string"
    && /^(0|[1-9][0-9]*)$/.test(value)
    && BigInt(value) <= INT32_MAX;
}

function point2d(value: unknown, diagnostics?: SpatialShapeDiagnostic[], path: ShapePath = []): value is TacticalPoint2d {
  if (!isRecord(value)) return shapeFailure(diagnostics, path, { type: "object" }, "geometry:point-required", "TYPE_MISMATCH");
  return exactKeys(value, ["x", "y"], diagnostics, path)
    && shapeField(value, "x", canonicalInteger, coordinateRequirement(), diagnostics, path)
    && shapeField(value, "y", canonicalInteger, coordinateRequirement(), diagnostics, path);
}

function position(value: unknown, diagnostics?: SpatialShapeDiagnostic[], path: ShapePath = []): value is TacticalPosition {
  if (!isRecord(value)) return shapeFailure(diagnostics, path, { type: "object" }, "geometry:position-required", "TYPE_MISMATCH");
  return exactKeys(value, ["elevation", "x", "y"], diagnostics, path)
    && shapeField(value, "x", canonicalInteger, coordinateRequirement(), diagnostics, path)
    && shapeField(value, "y", canonicalInteger, coordinateRequirement(), diagnostics, path)
    && shapeField(value, "elevation", canonicalInteger, coordinateRequirement(), diagnostics, path);
}

function coordinateRequirement(): Readonly<Record<string, unknown>> {
  return { type: "string", pattern: INTEGER_PATTERN.source, minimum: String(INT32_MIN), maximum: String(INT32_MAX) };
}

function featureState(value: unknown): value is CanonicalTacticalFeatureState {
  return isRecord(value)
    && (exactKeys(value, ["cover", "impassable", "opaque", "propagation", "state"])
      || exactKeys(value, ["cover", "impassable", "opaque", "propagation", "state", "terrain"]))
    && nonEmptyString(value.state)
    && typeof value.opaque === "boolean"
    && typeof value.impassable === "boolean"
    && ["none", "half", "threeQuarters", "full"].includes(String(value.cover))
    && (value.propagation === "passes" || value.propagation === "blocks")
    && (value.terrain === undefined || value.terrain === "normal" || value.terrain === "rubble");
}

function featureDurabilityDefinition(value: unknown): value is Omit<CanonicalTacticalFeatureDurability, "current"> {
  return isRecord(value)
    && exactKeys(value, ["armorClass", "damageThreshold", "immuneDamageTypes", "maximum"])
    && canonicalUnsignedInteger(value.maximum)
    && BigInt(value.maximum) > 0n
    && canonicalUnsignedInteger(value.armorClass)
    && BigInt(value.armorClass) > 0n
    && BigInt(value.armorClass) <= 30n
    && canonicalUnsignedInteger(value.damageThreshold)
    && Array.isArray(value.immuneDamageTypes)
    && value.immuneDamageTypes.length === new Set(value.immuneDamageTypes).size
    && value.immuneDamageTypes.every(nonEmptyString)
    && value.immuneDamageTypes.every((entry, index, entries) => index === 0
      || String(entries[index - 1]).localeCompare(String(entry)) < 0);
}

function featureDurability(value: unknown): value is CanonicalTacticalFeatureDurability {
  return isRecord(value)
    && exactKeys(value, ["armorClass", "current", "damageThreshold", "immuneDamageTypes", "maximum"])
    && canonicalUnsignedInteger(value.current)
    && featureDurabilityDefinition({
      maximum: value.maximum,
      armorClass: value.armorClass,
      damageThreshold: value.damageThreshold,
      immuneDamageTypes: value.immuneDamageTypes,
    })
    && BigInt(value.current) <= BigInt(String(value.maximum));
}

function featureStateGraph(value: unknown): value is CanonicalTacticalFeatureStateGraph {
  const requiredKeys = ["definitionId", "states", "transitions"];
  const optionalKeys = ["damageTransitions", "durability"];
  if (!isRecord(value)
    || !requiredKeys.every((key) => key in value)
    || Object.keys(value).some((key) => !requiredKeys.includes(key) && !optionalKeys.includes(key))
    || !nonEmptyString(value.definitionId)
    || !Array.isArray(value.states)
    || value.states.length < 2
    || value.states.length > 16
    || !value.states.every(featureState)
    || !value.states.every((entry, index, states) => index === 0
      || String((states[index - 1] as UnknownRecord).state).localeCompare(String(entry.state)) < 0)
    || !Array.isArray(value.transitions)
    || value.transitions.length > 32) return false;
  const states = value.states as CanonicalTacticalFeatureState[];
  const transitions = value.transitions as unknown[];
  const stateIds = new Set(states.map((entry) => entry.state));
  const canonicalPortalTransitions = transitions.every((transition, index) =>
    isRecord(transition)
    && exactKeys(transition, ["fromState", "intent", "toState"])
    && nonEmptyString(transition.fromState)
    && (transition.intent === "open"
      || transition.intent === "close"
      || transition.intent === "applyStunt"
      || transition.intent === "triggerHazard"
      || transition.intent === "resolveHazard")
    && nonEmptyString(transition.toState)
    && transition.fromState !== transition.toState
    && stateIds.has(transition.fromState)
    && stateIds.has(transition.toState)
    && (index === 0 || `${String((transitions[index - 1] as UnknownRecord).fromState)}\u0000${String((transitions[index - 1] as UnknownRecord).intent)}\u0000${String((transitions[index - 1] as UnknownRecord).toState)}`
      .localeCompare(`${String(transition.fromState)}\u0000${String(transition.intent)}\u0000${String(transition.toState)}`) < 0));
  if (!canonicalPortalTransitions) return false;
  if (value.durability === undefined || value.damageTransitions === undefined) {
    return value.durability === undefined
      && value.damageTransitions === undefined
      && transitions.length >= 2;
  }
  if (!featureDurabilityDefinition(value.durability)
    || !Array.isArray(value.damageTransitions)
    || value.damageTransitions.length === 0
    || value.damageTransitions.length > 32) return false;
  const damageTransitions = value.damageTransitions as unknown[];
  return damageTransitions.every((transition, index) =>
    isRecord(transition)
    && exactKeys(transition, ["fromState", "remainingDurabilityAtOrBelow", "toState"])
    && nonEmptyString(transition.fromState)
    && canonicalUnsignedInteger(transition.remainingDurabilityAtOrBelow)
    && BigInt(transition.remainingDurabilityAtOrBelow) <= BigInt(String((value.durability as UnknownRecord).maximum))
    && nonEmptyString(transition.toState)
    && transition.fromState !== transition.toState
    && stateIds.has(transition.fromState)
    && stateIds.has(transition.toState)
    && (index === 0 || `${String((damageTransitions[index - 1] as UnknownRecord).fromState)}\u0000${String((damageTransitions[index - 1] as UnknownRecord).remainingDurabilityAtOrBelow)}\u0000${String((damageTransitions[index - 1] as UnknownRecord).toState)}`
      .localeCompare(`${String(transition.fromState)}\u0000${String(transition.remainingDurabilityAtOrBelow)}\u0000${String(transition.toState)}`) < 0));
}

function feature(value: unknown, diagnostics?: SpatialShapeDiagnostic[], path: ShapePath = []): value is CanonicalTacticalFeature {
  if (!isRecord(value)) return shapeFailure(diagnostics, path, { type: "object" }, "geometry:feature-required", "TYPE_MISMATCH");
  const keys = [
      "cover",
      "elevation",
      "featureId",
      "height",
      "impassable",
      "kind",
      "label",
      "opaque",
      "polygon",
      "propagation",
      "state",
      "visibilityPolicyId",
    ];
  const optionalKeys = ["durability", "environment", "stateGraph", "terrain"];
  if (!keys.every((key) => key in value)
    || Object.keys(value).some((key) => !keys.includes(key) && !optionalKeys.includes(key))) {
    for (const key of keys) if (!(key in value))
      shapeFailure(diagnostics, [...path, key], { required: true }, "geometry:field-required", "FIELD_MISSING");
    for (const key of Object.keys(value)) if (!keys.includes(key) && !optionalKeys.includes(key))
      shapeFailure(diagnostics, [...path, key], { allowedFields: [...keys, ...optionalKeys] }, "geometry:additional-field", "VALUE_INVALID");
    return false;
  }
  if (value.stateGraph !== undefined) {
    if (value.kind !== "portal" && value.kind !== "destructible") return shapeFailure(diagnostics, [...path, "stateGraph"],
      { featureKinds: ["portal", "destructible"] }, "geometry:state-graph-feature-kind");
    if (!shapeField(value, "stateGraph", featureStateGraph,
      { type: "object", contract: "canonical-feature-state-graph" }, diagnostics, path)) return false;
  }
  if (value.environment !== undefined) {
    if (value.kind !== "destructible") return shapeFailure(diagnostics, [...path, "environment"],
      { featureKinds: ["destructible"] }, "geometry:environment-feature-kind");
    if (!shapeField(value, "environment", isCompiledEnvironmentBinding,
      { type: "object", contract: "compiled-environment-binding" }, diagnostics, path)) return false;
    if (!environmentBindingMatchesFeature(value.environment as CompiledEnvironmentBinding, value)) return shapeFailure(diagnostics,
      [...path, "environment"], { matches: "containing-feature" }, "geometry:environment-feature-binding");
  }
  const pinnedState = isRecord(value.stateGraph)
    && Array.isArray(value.stateGraph.states)
    ? value.stateGraph.states.find((entry) => isRecord(entry) && entry.state === value.state)
    : undefined;
  const graphDurability = isRecord(value.stateGraph) ? value.stateGraph.durability : undefined;
  if (!(value.stateGraph === undefined || (isRecord(pinnedState)
      && pinnedState.opaque === value.opaque
      && pinnedState.impassable === value.impassable
      && pinnedState.cover === value.cover
      && pinnedState.propagation === value.propagation
      && (pinnedState.terrain ?? "normal") === (value.terrain ?? "normal")))) return shapeFailure(diagnostics,
        path, { matches: "stateGraph.states entry selected by state" }, "geometry:pinned-state-matches-feature");
  if (value.durability === undefined) {
    if (graphDurability !== undefined) return shapeFailure(diagnostics, [...path, "durability"],
      { required: true, matches: "stateGraph.durability" }, "geometry:durability-binding");
  } else {
    if (!shapeField(value, "durability", featureDurability,
      { type: "object", contract: "canonical-feature-durability" }, diagnostics, path)) return false;
    const durability = value.durability as CanonicalTacticalFeatureDurability;
    if (!(isRecord(graphDurability)
      && durability.maximum === graphDurability.maximum
      && durability.armorClass === graphDurability.armorClass
      && durability.damageThreshold === graphDurability.damageThreshold
      && JSON.stringify(durability.immuneDamageTypes) === JSON.stringify(graphDurability.immuneDamageTypes))) return shapeFailure(diagnostics,
        [...path, "durability"], { matches: "stateGraph.durability" }, "geometry:durability-binding");
  }
  return shapeField(value, "featureId", nonEmptyString, { type: "string", minLength: 1 }, diagnostics, path)
    && shapeField(value, "kind", entry => ["barrier", "terrain", "interactable", "destructible", "portal"].includes(String(entry)),
      { type: "string", enum: ["barrier", "terrain", "interactable", "destructible", "portal"] }, diagnostics, path)
    && shapeField(value, "label", nonEmptyString, { type: "string", minLength: 1 }, diagnostics, path)
    && shapeField(value, "state", nonEmptyString, { type: "string", minLength: 1 }, diagnostics, path)
    && shapeField(value, "polygon", entry => Array.isArray(entry) && entry.length >= 3, { type: "array", minItems: 3 }, diagnostics, path)
    && (value.polygon as unknown[]).every((entry, index) => point2d(entry, diagnostics, [...path, "polygon", index]))
    && shapeField(value, "elevation", canonicalInteger, coordinateRequirement(), diagnostics, path)
    && shapeField(value, "height", canonicalInteger, coordinateRequirement(), diagnostics, path)
    && (BigInt(String(value.height)) > 0n || shapeFailure(diagnostics, [...path, "height"],
      { type: "string", minimum: "1", maximum: String(INT32_MAX) }, "geometry:positive-height", "VALUE_INVALID"))
    && shapeField(value, "opaque", entry => typeof entry === "boolean", { type: "boolean" }, diagnostics, path)
    && shapeField(value, "impassable", entry => typeof entry === "boolean", { type: "boolean" }, diagnostics, path)
    && shapeField(value, "cover", entry => ["none", "half", "threeQuarters", "full"].includes(String(entry)),
      { type: "string", enum: ["none", "half", "threeQuarters", "full"] }, diagnostics, path)
    && shapeField(value, "propagation", entry => entry === "passes" || entry === "blocks",
      { type: "string", enum: ["passes", "blocks"] }, diagnostics, path)
    && (value.terrain === undefined || shapeField(value, "terrain", entry => entry === "normal" || entry === "rubble",
      { type: "string", enum: ["normal", "rubble"] }, diagnostics, path))
    && shapeField(value, "visibilityPolicyId", entry => [
      "visibility:public",
      "visibility:scene-observers",
      "visibility:hidden-until-evidence",
    ].includes(String(entry)), { type: "string", enum: ["visibility:public", "visibility:scene-observers", "visibility:hidden-until-evidence"] }, diagnostics, path);
}

function featuresAreStrictlySorted(
  value: unknown[],
  diagnostics?: SpatialShapeDiagnostic[], path: ShapePath = [],
): value is CanonicalTacticalFeature[] {
  if (!value.every((entry, index): entry is CanonicalTacticalFeature => feature(entry, diagnostics, [...path, index]))) return false;
  return value.every((entry, index, entries) => index === 0
    || entries[index - 1].featureId.localeCompare(entry.featureId) < 0
    || shapeFailure(diagnostics, [...path, index, "featureId"], { order: "strictly-increasing-localeCompare", unique: true }, "geometry:feature-order"));
}

export function isCanonicalTacticalGeometry(
  value: unknown,
  diagnostics?: SpatialShapeDiagnostic[],
): value is CanonicalTacticalGeometry {
  if (!isRecord(value)) return shapeFailure(diagnostics, [], { type: "object" }, "geometry:object-required", "TYPE_MISMATCH");
  if (!exactKeys(value, [
      "boundary",
      "clearanceZones",
      "obstacles",
      "schema",
      "spawnPoints",
      "unit",
    ], diagnostics)
    || !shapeField(value, "schema", entry => entry === "zhuwei.tactical-geometry/v1", { type: "string", const: "zhuwei.tactical-geometry/v1" }, diagnostics)
    || !shapeField(value, "unit", entry => entry === "inch", { type: "string", const: "inch" }, diagnostics)
    || !shapeField(value, "boundary", isRecord, { type: "object" }, diagnostics)) return false;
  const boundary = value.boundary as UnknownRecord;
  if (!exactKeys(boundary, ["kind", "points"], diagnostics, ["boundary"])
    || !shapeField(boundary, "kind", entry => entry === "polygon", { type: "string", const: "polygon" }, diagnostics, ["boundary"])
    || !shapeField(boundary, "points", entry => Array.isArray(entry) && entry.length >= 3 && entry.length <= 64,
      { type: "array", minItems: 3, maxItems: 64 }, diagnostics, ["boundary"])
    || !(boundary.points as unknown[]).every((entry, index) => point2d(entry, diagnostics, ["boundary", "points", index]))
    || !shapeField(value, "spawnPoints", entry => Array.isArray(entry) && entry.length > 0 && entry.length <= 64,
      { type: "array", minItems: 1, maxItems: 64 }, diagnostics)
    || !(value.spawnPoints as unknown[]).every((entry, index) => position(entry, diagnostics, ["spawnPoints", index]))
    || !shapeField(value, "obstacles", entry => Array.isArray(entry) && entry.length > 0 && entry.length <= 200,
      { type: "array", minItems: 1, maxItems: 200 }, diagnostics)
    || !featuresAreStrictlySorted(value.obstacles as unknown[], diagnostics, ["obstacles"])
    || !shapeField(value, "clearanceZones", entry => Array.isArray(entry) && entry.length === 0,
      { type: "array", minItems: 0, maxItems: 0 }, diagnostics)) return false;
  const featureIds = (value.obstacles as CanonicalTacticalFeature[]).map((entry) => entry.featureId);
  const spawnKeys = (value.spawnPoints as TacticalPosition[]).map((entry) =>
    `${entry.x}\u0000${entry.y}\u0000${entry.elevation}`);
  return (featureIds.length === new Set(featureIds).size || shapeFailure(diagnostics, ["obstacles"], { uniqueFeatureIds: true }, "geometry:feature-identities-unique"))
    && (spawnKeys.length === new Set(spawnKeys).size || shapeFailure(diagnostics, ["spawnPoints"], { uniquePositions: true }, "geometry:spawn-points-unique"));
}
