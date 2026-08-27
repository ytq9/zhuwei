import type { TacticalPoint2d, TacticalPosition } from "../tactical-projection";

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
    intent: "open" | "close";
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

const INTEGER_PATTERN = /^(0|-?[1-9][0-9]*)$/;
const INT32_MIN = -2_147_483_648n;
const INT32_MAX = 2_147_483_647n;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
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

function point2d(value: unknown): value is TacticalPoint2d {
  return isRecord(value)
    && exactKeys(value, ["x", "y"])
    && canonicalInteger(value.x)
    && canonicalInteger(value.y);
}

function position(value: unknown): value is TacticalPosition {
  return isRecord(value)
    && exactKeys(value, ["elevation", "x", "y"])
    && canonicalInteger(value.x)
    && canonicalInteger(value.y)
    && canonicalInteger(value.elevation);
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
    && (transition.intent === "open" || transition.intent === "close")
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

function feature(value: unknown): value is CanonicalTacticalFeature {
  if (!isRecord(value)) return false;
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
  const optionalKeys = ["durability", "stateGraph", "terrain"];
  if (!keys.every((key) => key in value)
    || Object.keys(value).some((key) => !keys.includes(key) && !optionalKeys.includes(key))) return false;
  if (!(value.stateGraph === undefined
    || ((value.kind === "portal" || value.kind === "destructible")
      && featureStateGraph(value.stateGraph)))) return false;
  const pinnedState = isRecord(value.stateGraph)
    && Array.isArray(value.stateGraph.states)
    ? value.stateGraph.states.find((entry) => isRecord(entry) && entry.state === value.state)
    : undefined;
  const graphDurability = isRecord(value.stateGraph) ? value.stateGraph.durability : undefined;
  return (value.stateGraph === undefined || (isRecord(pinnedState)
      && pinnedState.opaque === value.opaque
      && pinnedState.impassable === value.impassable
      && pinnedState.cover === value.cover
      && pinnedState.propagation === value.propagation
      && (pinnedState.terrain ?? "normal") === (value.terrain ?? "normal")))
    && (value.durability === undefined
      ? graphDurability === undefined
      : featureDurability(value.durability)
        && isRecord(graphDurability)
        && value.durability.maximum === graphDurability.maximum
        && value.durability.armorClass === graphDurability.armorClass
        && value.durability.damageThreshold === graphDurability.damageThreshold
        && JSON.stringify(value.durability.immuneDamageTypes) === JSON.stringify(graphDurability.immuneDamageTypes))
    && nonEmptyString(value.featureId)
    && ["barrier", "terrain", "interactable", "destructible", "portal"]
      .includes(String(value.kind))
    && nonEmptyString(value.label)
    && nonEmptyString(value.state)
    && Array.isArray(value.polygon)
    && value.polygon.length >= 3
    && value.polygon.every(point2d)
    && canonicalInteger(value.elevation)
    && canonicalInteger(value.height)
    && BigInt(value.height) > 0n
    && typeof value.opaque === "boolean"
    && typeof value.impassable === "boolean"
    && ["none", "half", "threeQuarters", "full"].includes(String(value.cover))
    && (value.propagation === "passes" || value.propagation === "blocks")
    && (value.terrain === undefined || value.terrain === "normal" || value.terrain === "rubble")
    && [
      "visibility:public",
      "visibility:scene-observers",
      "visibility:hidden-until-evidence",
    ].includes(String(value.visibilityPolicyId));
}

function featuresAreStrictlySorted(
  value: unknown[],
): value is CanonicalTacticalFeature[] {
  if (!value.every(feature)) return false;
  return value.every((entry, index, entries) => index === 0
    || entries[index - 1].featureId.localeCompare(entry.featureId) < 0);
}

export function isCanonicalTacticalGeometry(
  value: unknown,
): value is CanonicalTacticalGeometry {
  if (!isRecord(value)
    || !exactKeys(value, [
      "boundary",
      "clearanceZones",
      "obstacles",
      "schema",
      "spawnPoints",
      "unit",
    ])
    || value.schema !== "zhuwei.tactical-geometry/v1"
    || value.unit !== "inch"
    || !isRecord(value.boundary)
    || !exactKeys(value.boundary, ["kind", "points"])
    || value.boundary.kind !== "polygon"
    || !Array.isArray(value.boundary.points)
    || value.boundary.points.length < 3
    || value.boundary.points.length > 64
    || !value.boundary.points.every(point2d)
    || !Array.isArray(value.spawnPoints)
    || value.spawnPoints.length === 0
    || value.spawnPoints.length > 64
    || !value.spawnPoints.every(position)
    || !Array.isArray(value.obstacles)
    || value.obstacles.length === 0
    || value.obstacles.length > 200
    || !featuresAreStrictlySorted(value.obstacles)
    || !Array.isArray(value.clearanceZones)
    || value.clearanceZones.length !== 0) return false;
  const featureIds = value.obstacles.map((entry) => entry.featureId);
  const spawnKeys = value.spawnPoints.map((entry) =>
    `${entry.x}\u0000${entry.y}\u0000${entry.elevation}`);
  return featureIds.length === new Set(featureIds).size
    && spawnKeys.length === new Set(spawnKeys).size;
}
