import type { TacticalPoint2d } from "../tactical-projection";
import { canonicalSha256 } from "./canonical";
import type {
  CanonicalProfileDocument,
  ProfileRef,
  Sha256Ref,
} from "./types";

/** Immutable first-generation hazard-only environment extension. */
export const LEGACY_ENVIRONMENT_PROFILE = {
  profileId: "environment-feature-fsm-2014-v2",
  profileHash: "sha256:702b2559c821a52e1c7d6a137c6b261cec21d6cc513e3c0301b4b5ab007f7c87",
} as const satisfies ProfileRef;

export const LEGACY_ENVIRONMENT_PROFILE_DOCUMENT: CanonicalProfileDocument = {
  schema: "zhuwei.runtime-profile/v1",
  profileKind: "environmentMechanics",
  profileId: LEGACY_ENVIRONMENT_PROFILE.profileId,
  semanticVersion: "2.0.0",
  normativePayload: {
    conformanceVersion: "1",
    rulesBasis: "srd5.1-2014-plus-versioned-product-ruling",
    trustedPrimitive: "environmental-stunt.v2",
    activationModes: ["attack", "check", "direct"],
    checkAuthority: "server-freezes-ability-skill-dc-and-d20-mode-rules-resolves",
    directAuthority: "server-freezes-trigger-no-precheck-area-randomness-remains-authoritative",
    featureIdentity: "stable-scene-scoped-id-materialized-before-randomness",
    stateModel: "bounded-finite-state-transitions-only",
    targetAuthority: "rules-computes-complete-authoritative-geometry-set",
    callerTargetLists: "forbidden",
    observerProjection: "safe-geometry-only-no-definition-or-hidden-target-cardinality",
    randomnessAuthority: "room-durable-object-only",
    causality: "one-root-action-ordered-event-chain",
    replay: "frozen-profile-and-definition-hashes-no-reroll",
    eventNamespace: [
      "EnvironmentFeatureMaterialized",
      "EnvironmentStuntRefused",
      "EnvironmentFeatureDamaged",
      "EnvironmentHazardTriggered",
      "EnvironmentAreaTargetResolved",
      "EnvironmentAreaFeatureDamaged",
      "EnvironmentFeatureStateChanged",
    ],
  },
};

/** New-room-only environment extension. Its mechanical mode is chosen by KP,
 * not inferred from object names, keywords, families, or player-facing types. */
export const ENVIRONMENT_PROFILE = {
  profileId: "environment-feature-fsm-2014-v3",
  profileHash: "sha256:1656fd548905d6ea886fd4cf97357a9d67c56422be3a2c6bd281fc93a22b4fe6",
} as const satisfies ProfileRef;

export const ENVIRONMENT_PROFILE_DOCUMENT: CanonicalProfileDocument = {
  schema: "zhuwei.runtime-profile/v1",
  profileKind: "environmentMechanics",
  profileId: ENVIRONMENT_PROFILE.profileId,
  semanticVersion: "3.0.0",
  normativePayload: {
    conformanceVersion: "1",
    rulesBasis: "srd5.1-2014-plus-versioned-product-ruling",
    trustedPrimitive: "environmental-stunt.v3",
    activationModes: ["attack", "check", "direct"],
    effectModes: ["state-only", "area-hazard"],
    effectModeAuthority: "kp-freezes-explicit-mechanical-mode-before-randomness",
    objectClassification: "forbidden-no-name-keyword-family-or-archetype-dispatch",
    stateOnlySemantics: "finite-state-terrain-cover-passage-only-no-save-damage-or-hazard",
    areaHazardSemantics: "finite-state-trigger-rules-targeting-save-damage-and-settlement",
    checkAuthority: "server-freezes-ability-skill-dc-and-d20-mode-rules-resolves",
    directAuthority: "server-freezes-trigger-and-state-transition-before-execution",
    featureIdentity: "stable-scene-scoped-id-materialized-before-randomness",
    stateModel: "bounded-finite-state-transitions-only",
    targetAuthority: "rules-computes-complete-authoritative-geometry-set-for-area-hazard-only",
    callerTargetLists: "forbidden",
    observerProjection: "safe-geometry-only-no-definition-or-hidden-target-cardinality",
    randomnessAuthority: "room-durable-object-only",
    causality: "one-root-action-ordered-event-chain",
    replay: "frozen-profile-effect-mode-and-definition-hashes-no-reroll",
    eventNamespace: [
      "EnvironmentFeatureMaterialized",
      "EnvironmentStuntRefused",
      "EnvironmentFeatureDamaged",
      "EnvironmentHazardTriggered",
      "EnvironmentAreaTargetResolved",
      "EnvironmentAreaFeatureDamaged",
      "EnvironmentFeatureStateChanged",
    ],
  },
};

export type EnvironmentStateSemantics = {
  state: string;
  opaque: boolean;
  impassable: boolean;
  cover: "none" | "half" | "threeQuarters" | "full";
  propagation: "passes" | "blocks";
  terrain: "normal" | "rubble";
};

export type DestructibleDefinition = {
  schema: "zhuwei.destructible-definition/v1";
  definitionId: string;
  armorClass: string;
  maximumDurability: string;
  damageThreshold: string;
  immuneDamageTypes: string[];
};

export type EnvironmentStateGraph = {
  schema: "zhuwei.environment-state-graph/v1";
  definitionId: string;
  states: EnvironmentStateSemantics[];
  transitions: Array<{
    fromState: string;
    trigger: "damageAtOrBelow" | "hazardResolved" | "stuntSucceeded";
    toState: string;
    remainingDurabilityAtOrBelow?: string;
  }>;
};

export type AreaEffect = {
  schema: "zhuwei.area-effect/v1";
  definitionId: string;
  origin: {
    kind: "featureCentroid";
    elevationInches: string;
  };
  shape: {
    kind: "sphere";
    radiusInches: string;
    propagation: "straight" | "aroundCorners";
    spreadBudgetInches?: string;
  };
  save: {
    ability: "str" | "dex" | "con" | "int" | "wis" | "cha";
    dc: string;
    halfOnSuccess: boolean;
  };
  damage: {
    type: string;
    formula: string;
  };
  failureStatus: "none" | "prone";
};

export type TriggeredHazard = {
  schema: "zhuwei.triggered-hazard/v1";
  definitionId: string;
  trigger: {
    kind: "stateEntered";
    state: string;
  };
  areaEffectRef: string;
  resolvedState: string;
};

type EnvironmentFeatureCore = {
  environmentProfile: ProfileRef;
  featureId: string;
  sceneId: string;
  kind: "destructible";
  label: string;
  polygon: TacticalPoint2d[];
  elevation: string;
  height: string;
  visibilityPolicyId:
    | "visibility:public"
    | "visibility:scene-observers"
    | "visibility:hidden-until-evidence";
  initialState: string;
  destructible: DestructibleDefinition;
  stateGraph: EnvironmentStateGraph;
};

export type LegacyEnvironmentFeature = EnvironmentFeatureCore & {
  schema: "zhuwei.environment-feature/v1";
  hazard: TriggeredHazard;
  areaEffect: AreaEffect;
};

export type EnvironmentEffectMode = "state-only" | "area-hazard";

export type EnvironmentFeature = EnvironmentFeatureCore & {
  schema: "zhuwei.environment-feature/v2";
  effectMode: EnvironmentEffectMode;
  hazard: TriggeredHazard | null;
  areaEffect: AreaEffect | null;
};

export type AnyEnvironmentFeature = LegacyEnvironmentFeature | EnvironmentFeature;

export type CompiledEnvironmentBinding = {
  schema: "zhuwei.environment-feature-binding/v1";
  profile: ProfileRef;
  featureDefinition: AnyEnvironmentFeature;
  featureDefinitionHash: Sha256Ref;
  destructibleDefinitionHash: Sha256Ref;
  stateGraphHash: Sha256Ref;
  hazardDefinitionHash: Sha256Ref;
  areaEffectDefinitionHash: Sha256Ref;
  compiledHash: Sha256Ref;
};

export type CompiledEnvironmentTacticalFeature = {
  featureId: string;
  kind: "destructible";
  label: string;
  state: string;
  polygon: TacticalPoint2d[];
  elevation: string;
  height: string;
  opaque: boolean;
  impassable: boolean;
  cover: EnvironmentStateSemantics["cover"];
  propagation: EnvironmentStateSemantics["propagation"];
  terrain: EnvironmentStateSemantics["terrain"];
  durability: {
    current: string;
    maximum: string;
    armorClass: string;
    damageThreshold: string;
    immuneDamageTypes: string[];
  };
  stateGraph: {
    definitionId: string;
    states: EnvironmentStateSemantics[];
    transitions: Array<{
      fromState: string;
      intent: "applyStunt" | "triggerHazard" | "resolveHazard";
      toState: string;
    }>;
    durability: {
      maximum: string;
      armorClass: string;
      damageThreshold: string;
      immuneDamageTypes: string[];
    };
    damageTransitions: Array<{
      fromState: string;
      remainingDurabilityAtOrBelow: string;
      toState: string;
    }>;
  };
  visibilityPolicyId: AnyEnvironmentFeature["visibilityPolicyId"];
  environment: CompiledEnvironmentBinding;
};

export type EnvironmentCompilation = {
  ok: true;
  artifact: {
    featureDefinitionHash: Sha256Ref;
    destructibleDefinitionHash: Sha256Ref;
    stateGraphHash: Sha256Ref;
    hazardDefinitionHash: Sha256Ref;
    areaEffectDefinitionHash: Sha256Ref;
    compiledHash: Sha256Ref;
    tacticalFeature: CompiledEnvironmentTacticalFeature;
  };
} | {
  ok: false;
  error: string;
};

type JsonRecord = Record<string, unknown>;

const UNSIGNED_INTEGER = /^(0|[1-9][0-9]*)$/;
const FORMULA = /^([1-9]|1[0-9]|20)d(4|6|8|10|12)(?:\+(0|[1-9][0-9]*))?$/;
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

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function only(value: JsonRecord, required: readonly string[], optional: readonly string[]): boolean {
  return required.every((key) => key in value)
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.normalize("NFC") === value;
}

function unsigned(value: unknown, maximum = 1_000_000): value is string {
  return typeof value === "string"
    && UNSIGNED_INTEGER.test(value)
    && BigInt(value) <= BigInt(maximum);
}

function positive(value: unknown, maximum = 1_000_000): value is string {
  return unsigned(value, maximum) && value !== "0";
}

function point(value: unknown): value is TacticalPoint2d {
  return record(value)
    && exact(value, ["x", "y"])
    && typeof value.x === "string"
    && /^-?(0|[1-9][0-9]*)$/.test(value.x)
    && typeof value.y === "string"
    && /^-?(0|[1-9][0-9]*)$/.test(value.y);
}

export function isEnvironmentProfileRef(value: unknown): value is ProfileRef {
  return record(value)
    && exact(value, ["profileHash", "profileId"])
    && ((value.profileId === ENVIRONMENT_PROFILE.profileId
        && value.profileHash === ENVIRONMENT_PROFILE.profileHash)
      || (value.profileId === LEGACY_ENVIRONMENT_PROFILE.profileId
        && value.profileHash === LEGACY_ENVIRONMENT_PROFILE.profileHash));
}

function canonicalStrings(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value)
    && value.length <= maximum
    && value.every(nonEmpty)
    && new Set(value).size === value.length
    && value.every((entry, index) => index === 0 || value[index - 1] < entry);
}

function stateSemantics(value: unknown): value is EnvironmentStateSemantics {
  return record(value)
    && exact(value, ["cover", "impassable", "opaque", "propagation", "state", "terrain"])
    && nonEmpty(value.state)
    && typeof value.opaque === "boolean"
    && typeof value.impassable === "boolean"
    && ["none", "half", "threeQuarters", "full"].includes(String(value.cover))
    && (value.propagation === "passes" || value.propagation === "blocks")
    && (value.terrain === "normal" || value.terrain === "rubble");
}

function destructible(value: unknown): value is DestructibleDefinition {
  return record(value)
    && exact(value, [
      "armorClass",
      "damageThreshold",
      "definitionId",
      "immuneDamageTypes",
      "maximumDurability",
      "schema",
    ])
    && value.schema === "zhuwei.destructible-definition/v1"
    && nonEmpty(value.definitionId)
    && positive(value.armorClass, 30)
    && positive(value.maximumDurability)
    && unsigned(value.damageThreshold)
    && BigInt(String(value.damageThreshold)) <= BigInt(String(value.maximumDurability))
    && canonicalStrings(value.immuneDamageTypes, 16)
    && value.immuneDamageTypes.every((entry) => DAMAGE_TYPES.has(entry));
}

function stateGraph(
  value: unknown,
  minimumStates: 2 | 3,
  minimumTransitions: 1 | 2,
  requireDeterministicSelectors = false,
): value is EnvironmentStateGraph {
  if (!record(value)
    || !exact(value, ["definitionId", "schema", "states", "transitions"])
    || value.schema !== "zhuwei.environment-state-graph/v1"
    || !nonEmpty(value.definitionId)
    || !Array.isArray(value.states)
    || value.states.length < minimumStates
    || value.states.length > 16
    || !value.states.every(stateSemantics)
    || !value.states.every((entry, index, entries) => index === 0
      || String(entries[index - 1].state).localeCompare(String(entry.state)) < 0)
    || !Array.isArray(value.transitions)
    || value.transitions.length < minimumTransitions
    || value.transitions.length > 32) return false;
  const states = new Set(value.states.map((entry) => entry.state));
  const canonicalTransitions = value.transitions.every((transition, index, transitions) => {
    if (!record(transition)
      || !only(transition, ["fromState", "toState", "trigger"], ["remainingDurabilityAtOrBelow"])
      || !nonEmpty(transition.fromState)
      || !nonEmpty(transition.toState)
      || transition.fromState === transition.toState
      || !states.has(transition.fromState)
      || !states.has(transition.toState)
      || !["damageAtOrBelow", "hazardResolved", "stuntSucceeded"]
        .includes(String(transition.trigger))) {
      return false;
    }
    if (transition.trigger === "damageAtOrBelow") {
      if (!exact(transition, ["fromState", "remainingDurabilityAtOrBelow", "toState", "trigger"])
        || !unsigned(transition.remainingDurabilityAtOrBelow)) return false;
    } else if (!exact(transition, ["fromState", "toState", "trigger"])) {
      return false;
    }
    if (index === 0) return true;
    const key = `${String(transition.fromState)}\u0000${String(transition.trigger)}\u0000${String(transition.remainingDurabilityAtOrBelow ?? "")}\u0000${String(transition.toState)}`;
    const previous = transitions[index - 1];
    const previousKey = `${String(previous.fromState)}\u0000${String(previous.trigger)}\u0000${String(previous.remainingDurabilityAtOrBelow ?? "")}\u0000${String(previous.toState)}`;
    return previousKey.localeCompare(key) < 0;
  });
  if (!canonicalTransitions || !requireDeterministicSelectors) return canonicalTransitions;
  const selectors = value.transitions.map((transition) =>
    `${String(transition.fromState)}\u0000${String(transition.trigger)}\u0000${String(
      transition.trigger === "damageAtOrBelow"
        ? transition.remainingDurabilityAtOrBelow
        : "",
    )}`);
  return new Set(selectors).size === selectors.length;
}

function areaEffect(value: unknown): value is AreaEffect {
  if (!record(value)
    || !exact(value, ["damage", "definitionId", "failureStatus", "origin", "save", "schema", "shape"])
    || value.schema !== "zhuwei.area-effect/v1"
    || !nonEmpty(value.definitionId)
    || !record(value.origin)
    || !exact(value.origin, ["elevationInches", "kind"])
    || value.origin.kind !== "featureCentroid"
    || typeof value.origin.elevationInches !== "string"
    || !/^-?(0|[1-9][0-9]*)$/.test(value.origin.elevationInches)
    || !record(value.shape)
    || !only(value.shape, ["kind", "propagation", "radiusInches"], ["spreadBudgetInches"])
    || value.shape.kind !== "sphere"
    || !positive(value.shape.radiusInches, 12_000)
    || (value.shape.propagation !== "straight" && value.shape.propagation !== "aroundCorners")
    || !record(value.save)
    || !exact(value.save, ["ability", "dc", "halfOnSuccess"])
    || !["str", "dex", "con", "int", "wis", "cha"].includes(String(value.save.ability))
    || !positive(value.save.dc, 30)
    || typeof value.save.halfOnSuccess !== "boolean"
    || !record(value.damage)
    || !exact(value.damage, ["formula", "type"])
    || !nonEmpty(value.damage.type)
    || !DAMAGE_TYPES.has(value.damage.type)
    || typeof value.damage.formula !== "string"
    || !FORMULA.test(value.damage.formula)
    || (value.failureStatus !== "none" && value.failureStatus !== "prone")) return false;
  return value.shape.propagation === "aroundCorners"
    ? positive(value.shape.spreadBudgetInches, 12_000)
    : value.shape.spreadBudgetInches === undefined;
}

function hazard(value: unknown): value is TriggeredHazard {
  return record(value)
    && exact(value, ["areaEffectRef", "definitionId", "resolvedState", "schema", "trigger"])
    && value.schema === "zhuwei.triggered-hazard/v1"
    && nonEmpty(value.definitionId)
    && nonEmpty(value.areaEffectRef)
    && nonEmpty(value.resolvedState)
    && record(value.trigger)
    && exact(value.trigger, ["kind", "state"])
    && value.trigger.kind === "stateEntered"
    && nonEmpty(value.trigger.state);
}

function environmentFeatureCore(value: JsonRecord, expectedKeys: readonly string[]): boolean {
  return exact(value, expectedKeys)
    && isEnvironmentProfileRef(value.environmentProfile)
    && nonEmpty(value.featureId)
    && nonEmpty(value.sceneId)
    && value.kind === "destructible"
    && nonEmpty(value.label)
    && Array.isArray(value.polygon)
    && value.polygon.length >= 3
    && value.polygon.length <= 32
    && value.polygon.every(point)
    && typeof value.elevation === "string"
    && /^-?(0|[1-9][0-9]*)$/.test(value.elevation)
    && positive(value.height, 12_000)
    && [
      "visibility:public",
      "visibility:scene-observers",
      "visibility:hidden-until-evidence",
    ].includes(String(value.visibilityPolicyId))
    && nonEmpty(value.initialState)
    && destructible(value.destructible);
}

function legacyEnvironmentFeature(value: unknown): value is LegacyEnvironmentFeature {
  if (!record(value)
    || !environmentFeatureCore(value, [
      "areaEffect",
      "destructible",
      "elevation",
      "environmentProfile",
      "featureId",
      "hazard",
      "height",
      "initialState",
      "kind",
      "label",
      "polygon",
      "sceneId",
      "schema",
      "stateGraph",
      "visibilityPolicyId",
    ])
    || value.schema !== "zhuwei.environment-feature/v1"
    || !record(value.environmentProfile)
    || value.environmentProfile.profileId !== LEGACY_ENVIRONMENT_PROFILE.profileId
    || value.environmentProfile.profileHash !== LEGACY_ENVIRONMENT_PROFILE.profileHash
    || !stateGraph(value.stateGraph, 3, 2)
    || !hazard(value.hazard)
    || !areaEffect(value.areaEffect)) return false;
  const definition = value as unknown as LegacyEnvironmentFeature;
  const stateIds = new Set(definition.stateGraph.states.map((entry) => entry.state));
  const damageTransitions = definition.stateGraph.transitions.filter((entry) =>
    entry.trigger === "damageAtOrBelow");
  const hazardTransitions = definition.stateGraph.transitions.filter((entry) =>
    entry.trigger === "hazardResolved");
  const stuntTransitions = definition.stateGraph.transitions.filter((entry) =>
    entry.trigger === "stuntSucceeded");
  return stateIds.has(definition.initialState)
    && definition.hazard.areaEffectRef === definition.areaEffect.definitionId
    && stateIds.has(definition.hazard.trigger.state)
    && stateIds.has(definition.hazard.resolvedState)
    && (damageTransitions.some((entry) => entry.fromState === definition.initialState
        && entry.toState === definition.hazard.trigger.state
        && BigInt(entry.remainingDurabilityAtOrBelow ?? "0")
          <= BigInt(definition.destructible.maximumDurability))
      || stuntTransitions.some((entry) => entry.fromState === definition.initialState
        && entry.toState === definition.hazard.trigger.state))
    && hazardTransitions.some((entry) => entry.fromState === definition.hazard.trigger.state
      && entry.toState === definition.hazard.resolvedState);
}

function environmentFeature(value: unknown): value is AnyEnvironmentFeature {
  if (legacyEnvironmentFeature(value)) return true;
  if (!record(value)
    || !environmentFeatureCore(value, [
      "areaEffect",
      "destructible",
      "effectMode",
      "elevation",
      "environmentProfile",
      "featureId",
      "hazard",
      "height",
      "initialState",
      "kind",
      "label",
      "polygon",
      "sceneId",
      "schema",
      "stateGraph",
      "visibilityPolicyId",
    ])
    || value.schema !== "zhuwei.environment-feature/v2"
    || !record(value.environmentProfile)
    || value.environmentProfile.profileId !== ENVIRONMENT_PROFILE.profileId
    || value.environmentProfile.profileHash !== ENVIRONMENT_PROFILE.profileHash
    || (value.effectMode !== "state-only" && value.effectMode !== "area-hazard")
    || !stateGraph(value.stateGraph, 2, 1, true)) return false;
  const definition = value as unknown as EnvironmentFeature;
  const stateIds = new Set(definition.stateGraph.states.map((entry) => entry.state));
  const damageTransitions = definition.stateGraph.transitions.filter((entry) =>
    entry.trigger === "damageAtOrBelow");
  const hazardTransitions = definition.stateGraph.transitions.filter((entry) =>
    entry.trigger === "hazardResolved");
  const stuntTransitions = definition.stateGraph.transitions.filter((entry) =>
    entry.trigger === "stuntSucceeded");
  if (!stateIds.has(definition.initialState)
    || ![...damageTransitions, ...stuntTransitions]
      .some((entry) => entry.fromState === definition.initialState)) return false;
  if (definition.effectMode === "state-only") {
    return definition.hazard === null
      && definition.areaEffect === null
      && hazardTransitions.length === 0
      && stuntTransitions.filter((entry) => entry.fromState === definition.initialState).length <= 1;
  }
  if (!hazard(definition.hazard) || !areaEffect(definition.areaEffect)) return false;
  return definition.hazard.areaEffectRef === definition.areaEffect.definitionId
    && stateIds.has(definition.hazard.trigger.state)
    && stateIds.has(definition.hazard.resolvedState)
    && (damageTransitions.some((entry) => entry.fromState === definition.initialState
        && entry.toState === definition.hazard!.trigger.state
        && BigInt(entry.remainingDurabilityAtOrBelow ?? "0")
          <= BigInt(definition.destructible.maximumDurability))
      || stuntTransitions.some((entry) => entry.fromState === definition.initialState
        && entry.toState === definition.hazard!.trigger.state))
    && hazardTransitions.some((entry) => entry.fromState === definition.hazard!.trigger.state
      && entry.toState === definition.hazard!.resolvedState);
}

export function environmentEffectMode(
  definition: AnyEnvironmentFeature,
): EnvironmentEffectMode {
  return definition.schema === "zhuwei.environment-feature/v1"
    ? "area-hazard"
    : definition.effectMode;
}

function tacticalCore(definition: AnyEnvironmentFeature) {
  const initial = definition.stateGraph.states.find((entry) =>
    entry.state === definition.initialState)!;
  const destructibleDefinition = definition.destructible;
  return {
    featureId: definition.featureId,
    kind: "destructible" as const,
    label: definition.label,
    state: definition.initialState,
    polygon: structuredClone(definition.polygon),
    elevation: definition.elevation,
    height: definition.height,
    opaque: initial.opaque,
    impassable: initial.impassable,
    cover: initial.cover,
    propagation: initial.propagation,
    terrain: initial.terrain,
    durability: {
      current: destructibleDefinition.maximumDurability,
      maximum: destructibleDefinition.maximumDurability,
      armorClass: destructibleDefinition.armorClass,
      damageThreshold: destructibleDefinition.damageThreshold,
      immuneDamageTypes: [...destructibleDefinition.immuneDamageTypes],
    },
    stateGraph: {
      definitionId: definition.stateGraph.definitionId,
      states: structuredClone(definition.stateGraph.states),
      transitions: definition.stateGraph.transitions
        .filter((entry) => entry.trigger === "hazardResolved" || entry.trigger === "stuntSucceeded")
        .map((entry) => ({
          fromState: entry.fromState,
          intent: entry.trigger === "hazardResolved"
            ? "resolveHazard" as const
            : environmentEffectMode(definition) === "state-only"
              ? "applyStunt" as const
              : "triggerHazard" as const,
          toState: entry.toState,
        })),
      durability: {
        maximum: destructibleDefinition.maximumDurability,
        armorClass: destructibleDefinition.armorClass,
        damageThreshold: destructibleDefinition.damageThreshold,
        immuneDamageTypes: [...destructibleDefinition.immuneDamageTypes],
      },
      damageTransitions: definition.stateGraph.transitions
        .filter((entry) => entry.trigger === "damageAtOrBelow")
        .map((entry) => ({
          fromState: entry.fromState,
          remainingDurabilityAtOrBelow: entry.remainingDurabilityAtOrBelow!,
          toState: entry.toState,
        })),
    },
    visibilityPolicyId: definition.visibilityPolicyId,
  };
}

export function compileEnvironmentFeature(value: unknown): EnvironmentCompilation {
  if (!environmentFeature(value)) {
    return { ok: false, error: "EnvironmentFeature is not canonical." };
  }
  const definition = structuredClone(value);
  const featureDefinitionHash = canonicalSha256(definition);
  const destructibleDefinitionHash = canonicalSha256(definition.destructible);
  const stateGraphHash = canonicalSha256(definition.stateGraph);
  const hazardDefinitionHash = canonicalSha256(definition.hazard);
  const areaEffectDefinitionHash = canonicalSha256(definition.areaEffect);
  const core = tacticalCore(definition);
  const compiledHash = canonicalSha256({
    profile: definition.environmentProfile,
    featureDefinitionHash,
    destructibleDefinitionHash,
    stateGraphHash,
    hazardDefinitionHash,
    areaEffectDefinitionHash,
    tacticalFeature: core,
  });
  const environment: CompiledEnvironmentBinding = {
    schema: "zhuwei.environment-feature-binding/v1",
    profile: structuredClone(definition.environmentProfile),
    featureDefinition: definition,
    featureDefinitionHash,
    destructibleDefinitionHash,
    stateGraphHash,
    hazardDefinitionHash,
    areaEffectDefinitionHash,
    compiledHash,
  };
  return {
    ok: true,
    artifact: {
      featureDefinitionHash,
      destructibleDefinitionHash,
      stateGraphHash,
      hazardDefinitionHash,
      areaEffectDefinitionHash,
      compiledHash,
      tacticalFeature: { ...core, environment },
    },
  };
}

export function isCompiledEnvironmentBinding(value: unknown): value is CompiledEnvironmentBinding {
  if (!record(value)
    || !exact(value, [
      "areaEffectDefinitionHash",
      "compiledHash",
      "destructibleDefinitionHash",
      "featureDefinition",
      "featureDefinitionHash",
      "hazardDefinitionHash",
      "profile",
      "schema",
      "stateGraphHash",
    ])
    || value.schema !== "zhuwei.environment-feature-binding/v1"
    || !isEnvironmentProfileRef(value.profile)) return false;
  const compiled = compileEnvironmentFeature(value.featureDefinition);
  if (!compiled.ok) return false;
  return canonicalSha256(value)
    === canonicalSha256(compiled.artifact.tacticalFeature.environment)
    && value.featureDefinitionHash === compiled.artifact.featureDefinitionHash
    && value.destructibleDefinitionHash === compiled.artifact.destructibleDefinitionHash
    && value.stateGraphHash === compiled.artifact.stateGraphHash
    && value.hazardDefinitionHash === compiled.artifact.hazardDefinitionHash
    && value.areaEffectDefinitionHash === compiled.artifact.areaEffectDefinitionHash
    && value.compiledHash === compiled.artifact.compiledHash;
}

export function environmentBindingMatchesFeature(
  bindingValue: unknown,
  featureValue: unknown,
): boolean {
  if (!isCompiledEnvironmentBinding(bindingValue) || !record(featureValue)) return false;
  const compiled = compileEnvironmentFeature(bindingValue.featureDefinition);
  if (!compiled.ok) return false;
  const expected = compiled.artifact.tacticalFeature;
  const graph = featureValue.stateGraph;
  const durability = featureValue.durability;
  return featureValue.featureId === expected.featureId
    && featureValue.kind === expected.kind
    && featureValue.label === expected.label
    && canonicalSha256(featureValue.polygon) === canonicalSha256(expected.polygon)
    && featureValue.elevation === expected.elevation
    && featureValue.height === expected.height
    && featureValue.visibilityPolicyId === expected.visibilityPolicyId
    && record(graph)
    && canonicalSha256(graph) === canonicalSha256(expected.stateGraph)
    && record(durability)
    && durability.maximum === expected.durability.maximum
    && durability.armorClass === expected.durability.armorClass
    && durability.damageThreshold === expected.durability.damageThreshold
    && canonicalSha256(durability.immuneDamageTypes) === canonicalSha256(expected.durability.immuneDamageTypes)
    && unsigned(durability.current)
    && BigInt(durability.current) <= BigInt(expected.durability.maximum);
}

export function environmentProfileEnabled(
  extensions: readonly ProfileRef[],
  expected?: ProfileRef,
): boolean {
  return extensions.some((extension) => isEnvironmentProfileRef(extension)
    && (expected === undefined
      || (extension.profileId === expected.profileId
        && extension.profileHash === expected.profileHash)));
}
