import {
  compileEnvironmentFeature,
  ENVIRONMENT_PROFILE,
  type EnvironmentFeature,
  type EnvironmentStateSemantics,
} from "./environment";

const ABILITIES = new Set(["str", "dex", "con", "int", "wis", "cha"]);
const COVERS = new Set(["none", "half", "threeQuarters", "full"]);
const DAMAGE_TYPES = new Set([
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder",
]);
const PROPAGATIONS = new Set(["passes", "blocks"]);
const TERRAINS = new Set(["normal", "rubble"]);
const VISIBILITY_POLICIES = new Set([
  "visibility:public",
  "visibility:scene-observers",
  "visibility:hidden-until-evidence",
]);
const INPUT_KEYS = new Set([
  "areaOriginElevationInches",
  "areaPropagation",
  "areaRadiusInches",
  "armorClass",
  "centerXInches",
  "centerYInches",
  "damageFormula",
  "damageThreshold",
  "damageTransitions",
  "damageType",
  "depthInches",
  "elevationInches",
  "failureStatus",
  "featureId",
  "halfOnSuccess",
  "hazardResolvedState",
  "hazardTransitions",
  "hazardTriggerState",
  "heightInches",
  "immuneDamageTypes",
  "initialState",
  "label",
  "material",
  "maximumDurability",
  "saveAbility",
  "saveDc",
  "sceneId",
  "spreadBudgetInches",
  "states",
  "visibilityPolicyId",
  "widthInches",
]);
const REQUIRED_INPUT_KEYS = [...INPUT_KEYS].filter((key) => key !== "spreadBudgetInches");
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const DAMAGE_FORMULA = /^([1-9]|1[0-9]|20)d(4|6|8|10|12)(?:\+(0|[1-9][0-9]*))?$/;

type Cover = EnvironmentStateSemantics["cover"];
type StatePropagation = EnvironmentStateSemantics["propagation"];
type Terrain = EnvironmentStateSemantics["terrain"];

export type CustomEnvironmentStateInput = Readonly<{
  state: string;
  opaque: boolean;
  impassable: boolean;
  cover: Cover;
  propagation: StatePropagation;
  terrain: Terrain;
}>;

export type CustomEnvironmentDamageTransitionInput = Readonly<{
  fromState: string;
  remainingDurabilityAtOrBelow: number;
  toState: string;
}>;

export type CustomEnvironmentHazardTransitionInput = Readonly<{
  fromState: string;
  toState: string;
}>;

/**
 * A closed transport for one KP-frozen custom environment definition.
 *
 * It intentionally has no product family/category selector and no entity or
 * target list. The Rules geometry layer remains the sole target authority.
 */
export type CustomEnvironmentFeatureDefinitionInput = Readonly<{
  featureId: string;
  sceneId: string;
  label: string;
  material: string;
  centerXInches: number;
  centerYInches: number;
  elevationInches: number;
  widthInches: number;
  depthInches: number;
  heightInches: number;
  visibilityPolicyId: EnvironmentFeature["visibilityPolicyId"];
  armorClass: number;
  maximumDurability: number;
  damageThreshold: number;
  immuneDamageTypes: readonly string[];
  initialState: string;
  states: readonly CustomEnvironmentStateInput[];
  damageTransitions: readonly CustomEnvironmentDamageTransitionInput[];
  hazardTransitions: readonly CustomEnvironmentHazardTransitionInput[];
  hazardTriggerState: string;
  hazardResolvedState: string;
  areaOriginElevationInches: number;
  areaRadiusInches: number;
  areaPropagation: "straight" | "aroundCorners";
  spreadBudgetInches?: number;
  saveAbility: "str" | "dex" | "con" | "int" | "wis" | "cha";
  saveDc: number;
  halfOnSuccess: boolean;
  damageFormula: string;
  damageType: string;
  failureStatus: "none" | "prone";
}>;

type JsonRecord = Record<string, unknown>;

function fail(field: string): never {
  throw new TypeError(`CUSTOM_ENVIRONMENT_DEFINITION_INVALID:${field}`);
}

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function canonicalText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || value.normalize("NFC") !== value
    || value.trim() !== value) fail(field);
  return value;
}

function identifier(value: unknown, field: string, maximum = 200): string {
  const result = canonicalText(value, field, maximum);
  if (!IDENTIFIER.test(result)) fail(field);
  return result;
}

function integer(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value)
    || Object.is(value, -0)
    || Number(value) < minimum
    || Number(value) > maximum) fail(field);
  return Number(value);
}

function normalizeState(value: unknown, index: number): EnvironmentStateSemantics {
  const field = `states[${index}]`;
  if (!record(value)
    || !exactKeys(value, ["cover", "impassable", "opaque", "propagation", "state", "terrain"])) {
    fail(field);
  }
  const state = identifier(value.state, `${field}.state`, 80);
  if (typeof value.opaque !== "boolean") fail(`${field}.opaque`);
  if (typeof value.impassable !== "boolean") fail(`${field}.impassable`);
  if (!COVERS.has(String(value.cover))) fail(`${field}.cover`);
  if (!PROPAGATIONS.has(String(value.propagation))) fail(`${field}.propagation`);
  if (!TERRAINS.has(String(value.terrain))) fail(`${field}.terrain`);
  return {
    state,
    opaque: value.opaque,
    impassable: value.impassable,
    cover: value.cover as Cover,
    propagation: value.propagation as StatePropagation,
    terrain: value.terrain as Terrain,
  };
}

function normalizeDamageTransition(
  value: unknown,
  index: number,
  maximumDurability: number,
) {
  const field = `damageTransitions[${index}]`;
  if (!record(value)
    || !exactKeys(value, ["fromState", "remainingDurabilityAtOrBelow", "toState"])) fail(field);
  return {
    fromState: identifier(value.fromState, `${field}.fromState`, 80),
    trigger: "damageAtOrBelow" as const,
    remainingDurabilityAtOrBelow: String(integer(
      value.remainingDurabilityAtOrBelow,
      `${field}.remainingDurabilityAtOrBelow`,
      0,
      maximumDurability,
    )),
    toState: identifier(value.toState, `${field}.toState`, 80),
  };
}

function normalizeHazardTransition(value: unknown, index: number) {
  const field = `hazardTransitions[${index}]`;
  if (!record(value) || !exactKeys(value, ["fromState", "toState"])) fail(field);
  return {
    fromState: identifier(value.fromState, `${field}.fromState`, 80),
    trigger: "hazardResolved" as const,
    toState: identifier(value.toState, `${field}.toState`, 80),
  };
}

function transitionKey(value: {
  fromState: string;
  trigger: string;
  remainingDurabilityAtOrBelow?: string;
  toState: string;
}): string {
  return `${value.fromState}\u0000${value.trigger}\u0000${value.remainingDurabilityAtOrBelow ?? ""}\u0000${value.toState}`;
}

/**
 * Builds one arbitrary, bounded environment feature from KP-frozen mechanics.
 * Numeric inputs are accepted only as safe integers and emitted as Rules
 * integer strings. The existing compiler performs the final profile check.
 */
export function buildCustomEnvironmentFeatureDefinition(
  input: CustomEnvironmentFeatureDefinitionInput,
): EnvironmentFeature {
  if (!record(input)) fail("input");
  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.has(key)) fail(`${key}:unknown`);
  }
  for (const key of REQUIRED_INPUT_KEYS) {
    if (!Object.hasOwn(input, key)) fail(`${key}:required`);
  }

  const featureId = identifier(input.featureId, "featureId");
  const sceneId = identifier(input.sceneId, "sceneId");
  const label = canonicalText(input.label, "label", 160);
  const material = canonicalText(input.material, "material", 160);
  const centerX = integer(input.centerXInches, "centerXInches", -1_000_000, 1_000_000);
  const centerY = integer(input.centerYInches, "centerYInches", -1_000_000, 1_000_000);
  const elevation = integer(input.elevationInches, "elevationInches", -1_000_000, 1_000_000);
  const width = integer(input.widthInches, "widthInches", 1, 12_000);
  const depth = integer(input.depthInches, "depthInches", 1, 12_000);
  const height = integer(input.heightInches, "heightInches", 1, 12_000);
  if (width % 2 !== 0) fail("widthInches:must-be-even");
  if (depth % 2 !== 0) fail("depthInches:must-be-even");
  if (!VISIBILITY_POLICIES.has(String(input.visibilityPolicyId))) fail("visibilityPolicyId");

  const armorClass = integer(input.armorClass, "armorClass", 1, 30);
  const maximumDurability = integer(input.maximumDurability, "maximumDurability", 1, 1_000_000);
  const damageThreshold = integer(
    input.damageThreshold,
    "damageThreshold",
    0,
    maximumDurability,
  );
  if (!Array.isArray(input.immuneDamageTypes) || input.immuneDamageTypes.length > 16) {
    fail("immuneDamageTypes");
  }
  const immuneDamageTypes = input.immuneDamageTypes.map((value, index) => {
    const damageType = canonicalText(value, `immuneDamageTypes[${index}]`, 40);
    if (!DAMAGE_TYPES.has(damageType)) fail(`immuneDamageTypes[${index}]`);
    return damageType;
  });
  if (new Set(immuneDamageTypes).size !== immuneDamageTypes.length) fail("immuneDamageTypes:duplicate");
  immuneDamageTypes.sort();

  const initialState = identifier(input.initialState, "initialState", 80);
  if (!Array.isArray(input.states) || input.states.length < 3 || input.states.length > 16) {
    fail("states:bounded");
  }
  const states = input.states.map(normalizeState)
    .sort((left, right) => left.state.localeCompare(right.state));
  if (new Set(states.map((state) => state.state)).size !== states.length) fail("states:duplicate");

  if (!Array.isArray(input.damageTransitions) || !Array.isArray(input.hazardTransitions)) {
    fail("transitions");
  }
  const transitions = [
    ...input.damageTransitions.map((value, index) =>
      normalizeDamageTransition(value, index, maximumDurability)),
    ...input.hazardTransitions.map(normalizeHazardTransition),
  ];
  if (transitions.length < 2 || transitions.length > 32) fail("transitions:bounded");
  transitions.sort((left, right) => transitionKey(left).localeCompare(transitionKey(right)));
  const transitionKeys = transitions.map(transitionKey);
  if (new Set(transitionKeys).size !== transitionKeys.length) fail("transitions:duplicate");

  const hazardTriggerState = identifier(input.hazardTriggerState, "hazardTriggerState", 80);
  const hazardResolvedState = identifier(input.hazardResolvedState, "hazardResolvedState", 80);
  const areaOriginElevation = integer(
    input.areaOriginElevationInches,
    "areaOriginElevationInches",
    -1_000_000,
    1_000_000,
  );
  const areaRadius = integer(input.areaRadiusInches, "areaRadiusInches", 1, 12_000);
  if (input.areaPropagation !== "straight" && input.areaPropagation !== "aroundCorners") {
    fail("areaPropagation");
  }
  let spreadBudget: number | undefined;
  if (input.areaPropagation === "aroundCorners") {
    spreadBudget = integer(input.spreadBudgetInches, "spreadBudgetInches", 1, 12_000);
  } else if (input.spreadBudgetInches !== undefined) {
    fail("spreadBudgetInches:straight-forbidden");
  }
  if (!ABILITIES.has(String(input.saveAbility))) fail("saveAbility");
  const saveDc = integer(input.saveDc, "saveDc", 1, 30);
  if (typeof input.halfOnSuccess !== "boolean") fail("halfOnSuccess");
  const damageFormula = canonicalText(input.damageFormula, "damageFormula", 40);
  if (!DAMAGE_FORMULA.test(damageFormula)) fail("damageFormula");
  const damageType = canonicalText(input.damageType, "damageType", 40);
  if (!DAMAGE_TYPES.has(damageType)) fail("damageType");
  if (input.failureStatus !== "none" && input.failureStatus !== "prone") fail("failureStatus");

  // The closed EnvironmentFeature schema has no free-form material property.
  // Preserve the exact KP-frozen material in stable private definition IDs;
  // the public tactical feature continues to expose only its safe label.
  const definitionScope = `${sceneId}:${featureId}:material=${encodeURIComponent(material)}`;
  const areaEffectDefinitionId = `area-effect:${definitionScope}`;
  const definition: EnvironmentFeature = {
    schema: "zhuwei.environment-feature/v1",
    environmentProfile: ENVIRONMENT_PROFILE,
    featureId,
    sceneId,
    kind: "destructible",
    label,
    polygon: [
      { x: String(centerX - width / 2), y: String(centerY - depth / 2) },
      { x: String(centerX - width / 2), y: String(centerY + depth / 2) },
      { x: String(centerX + width / 2), y: String(centerY + depth / 2) },
      { x: String(centerX + width / 2), y: String(centerY - depth / 2) },
    ],
    elevation: String(elevation),
    height: String(height),
    visibilityPolicyId: input.visibilityPolicyId,
    initialState,
    destructible: {
      schema: "zhuwei.destructible-definition/v1",
      definitionId: `destructible:${definitionScope}`,
      armorClass: String(armorClass),
      maximumDurability: String(maximumDurability),
      damageThreshold: String(damageThreshold),
      immuneDamageTypes,
    },
    stateGraph: {
      schema: "zhuwei.environment-state-graph/v1",
      definitionId: `environment-state-graph:${definitionScope}`,
      states,
      transitions,
    },
    hazard: {
      schema: "zhuwei.triggered-hazard/v1",
      definitionId: `hazard:${definitionScope}`,
      trigger: { kind: "stateEntered", state: hazardTriggerState },
      areaEffectRef: areaEffectDefinitionId,
      resolvedState: hazardResolvedState,
    },
    areaEffect: {
      schema: "zhuwei.area-effect/v1",
      definitionId: areaEffectDefinitionId,
      origin: { kind: "featureCentroid", elevationInches: String(areaOriginElevation) },
      shape: {
        kind: "sphere",
        radiusInches: String(areaRadius),
        propagation: input.areaPropagation,
        ...(spreadBudget === undefined ? {} : { spreadBudgetInches: String(spreadBudget) }),
      },
      save: {
        ability: input.saveAbility,
        dc: String(saveDc),
        halfOnSuccess: input.halfOnSuccess,
      },
      damage: { type: damageType, formula: damageFormula },
      failureStatus: input.failureStatus,
    },
  };

  const compiled = compileEnvironmentFeature(definition);
  if (!compiled.ok) fail("profile-compiler");
  return compiled.artifact.tacticalFeature.environment.featureDefinition;
}
