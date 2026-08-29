import { ENVIRONMENT_PROFILE } from "../../app/_runtime/lib/rules/profiles/environment.ts";

export const CHANDELIER_ID = "feature:gallery:chandelier";
export const CRATE_ID = "feature:gallery:crate";
export const CUSTOM_SCENERY_WALL_ID = "feature:gallery:custom-scenery-wall";

export const CHANDELIER_FEATURE_DEFINITION = Object.freeze({
  schema: "zhuwei.environment-feature/v1",
  environmentProfile: ENVIRONMENT_PROFILE,
  featureId: CHANDELIER_ID,
  sceneId: "scene:gallery",
  kind: "destructible",
  label: "旧铜吊灯",
  polygon: [
    { x: "-12", y: "-12" },
    { x: "-12", y: "12" },
    { x: "12", y: "12" },
    { x: "12", y: "-12" },
  ],
  elevation: "120",
  height: "24",
  visibilityPolicyId: "visibility:scene-observers",
  initialState: "suspended",
  destructible: {
    schema: "zhuwei.destructible-definition/v1",
    definitionId: "destructible:gallery:chandelier-chain",
    armorClass: "10",
    maximumDurability: "10",
    damageThreshold: "0",
    immuneDamageTypes: ["poison", "psychic"],
  },
  stateGraph: {
    schema: "zhuwei.environment-state-graph/v1",
    definitionId: "environment-state-graph:gallery:chandelier",
    states: [
      {
        state: "debris",
        opaque: false,
        impassable: true,
        cover: "half",
        propagation: "passes",
        terrain: "rubble",
      },
      {
        state: "falling",
        opaque: false,
        impassable: false,
        cover: "none",
        propagation: "passes",
        terrain: "normal",
      },
      {
        state: "suspended",
        opaque: false,
        impassable: false,
        cover: "none",
        propagation: "passes",
        terrain: "normal",
      },
    ],
    transitions: [
      {
        fromState: "falling",
        trigger: "hazardResolved",
        toState: "debris",
      },
      {
        fromState: "suspended",
        trigger: "damageAtOrBelow",
        remainingDurabilityAtOrBelow: "0",
        toState: "falling",
      },
    ],
  },
  hazard: {
    schema: "zhuwei.triggered-hazard/v1",
    definitionId: "hazard:gallery:falling-chandelier",
    trigger: { kind: "stateEntered", state: "falling" },
    areaEffectRef: "area-effect:gallery:falling-chandelier",
    resolvedState: "debris",
  },
  areaEffect: {
    schema: "zhuwei.area-effect/v1",
    definitionId: "area-effect:gallery:falling-chandelier",
    origin: { kind: "featureCentroid", elevationInches: "0" },
    shape: {
      kind: "sphere",
      radiusInches: "120",
      propagation: "straight",
    },
    save: { ability: "dex", dc: "12", halfOnSuccess: false },
    damage: { type: "bludgeoning", formula: "2d6" },
    failureStatus: "prone",
  },
});

// Deliberately fixture-local content: production has no object/archetype catalog.
export const CUSTOM_SCENERY_WALL_FEATURE_DEFINITION = Object.freeze({
  schema: "zhuwei.environment-feature/v1",
  environmentProfile: ENVIRONMENT_PROFILE,
  featureId: CUSTOM_SCENERY_WALL_ID,
  sceneId: "scene:gallery",
  kind: "destructible",
  label: "临时拼装的舞台布景墙",
  polygon: [
    { x: "72", y: "-6" },
    { x: "72", y: "6" },
    { x: "84", y: "6" },
    { x: "84", y: "-6" },
  ],
  elevation: "0",
  height: "96",
  visibilityPolicyId: "visibility:scene-observers",
  initialState: "braced",
  destructible: {
    schema: "zhuwei.destructible-definition/v1",
    definitionId: "destructible:gallery:custom-scenery-wall",
    armorClass: "10",
    maximumDurability: "8",
    damageThreshold: "0",
    immuneDamageTypes: ["poison", "psychic"],
  },
  stateGraph: {
    schema: "zhuwei.environment-state-graph/v1",
    definitionId: "environment-state-graph:gallery:custom-scenery-wall",
    states: [
      {
        state: "braced",
        opaque: true,
        impassable: true,
        cover: "full",
        propagation: "blocks",
        terrain: "normal",
      },
      {
        state: "debris",
        opaque: false,
        impassable: true,
        cover: "half",
        propagation: "passes",
        terrain: "rubble",
      },
      {
        state: "toppling",
        opaque: false,
        impassable: false,
        cover: "none",
        propagation: "passes",
        terrain: "normal",
      },
    ],
    transitions: [
      {
        fromState: "braced",
        trigger: "damageAtOrBelow",
        remainingDurabilityAtOrBelow: "0",
        toState: "toppling",
      },
      {
        fromState: "braced",
        trigger: "stuntSucceeded",
        toState: "toppling",
      },
      {
        fromState: "toppling",
        trigger: "hazardResolved",
        toState: "debris",
      },
    ],
  },
  hazard: {
    schema: "zhuwei.triggered-hazard/v1",
    definitionId: "hazard:gallery:custom-scenery-wall-topples",
    trigger: { kind: "stateEntered", state: "toppling" },
    areaEffectRef: "area-effect:gallery:custom-scenery-wall-topples",
    resolvedState: "debris",
  },
  areaEffect: {
    schema: "zhuwei.area-effect/v1",
    definitionId: "area-effect:gallery:custom-scenery-wall-topples",
    origin: { kind: "featureCentroid", elevationInches: "0" },
    shape: {
      kind: "sphere",
      radiusInches: "144",
      propagation: "straight",
    },
    save: { ability: "dex", dc: "11", halfOnSuccess: false },
    damage: { type: "bludgeoning", formula: "1d6" },
    failureStatus: "prone",
  },
});

export const CRATE_FEATURE = Object.freeze({
  featureId: CRATE_ID,
  kind: "destructible",
  label: "木箱",
  state: "intact",
  polygon: [
    { x: "30", y: "-6" },
    { x: "30", y: "6" },
    { x: "42", y: "6" },
    { x: "42", y: "-6" },
  ],
  elevation: "0",
  height: "24",
  opaque: false,
  impassable: true,
  cover: "half",
  propagation: "passes",
  terrain: "normal",
  durability: {
    current: "5",
    maximum: "5",
    armorClass: "10",
    damageThreshold: "0",
    immuneDamageTypes: ["poison", "psychic"],
  },
  stateGraph: {
    definitionId: "environment-state-graph:gallery:crate",
    states: [
      {
        state: "destroyed",
        opaque: false,
        impassable: false,
        cover: "none",
        propagation: "passes",
        terrain: "rubble",
      },
      {
        state: "intact",
        opaque: false,
        impassable: true,
        cover: "half",
        propagation: "passes",
        terrain: "normal",
      },
    ],
    transitions: [],
    durability: {
      maximum: "5",
      armorClass: "10",
      damageThreshold: "0",
      immuneDamageTypes: ["poison", "psychic"],
    },
    damageTransitions: [{
      fromState: "intact",
      remainingDurabilityAtOrBelow: "0",
      toState: "destroyed",
    }],
  },
  visibilityPolicyId: "visibility:scene-observers",
});

export function chandelierGeometry(chandelier) {
  const obstacles = [
    ...(chandelier === undefined ? [] : [structuredClone(chandelier)]),
    structuredClone(CRATE_FEATURE),
  ].sort((left, right) => left.featureId.localeCompare(right.featureId));
  return {
    schema: "zhuwei.tactical-geometry/v1",
    unit: "inch",
    boundary: {
      kind: "polygon",
      points: [
        { x: "-600", y: "-600" },
        { x: "-600", y: "600" },
        { x: "600", y: "600" },
        { x: "600", y: "-600" },
      ],
    },
    spawnPoints: [
      { x: "0", y: "0", elevation: "0" },
      { x: "24", y: "0", elevation: "0" },
      { x: "-24", y: "0", elevation: "0" },
      { x: "0", y: "24", elevation: "0" },
      { x: "0", y: "-24", elevation: "0" },
    ],
    obstacles,
    clearanceZones: [],
  };
}
