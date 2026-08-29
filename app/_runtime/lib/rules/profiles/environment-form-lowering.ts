import type { CustomEnvironmentFeatureDefinitionInput } from "./environment-definition-builder";

type JsonRecord = Record<string, unknown>;
type StateInput = CustomEnvironmentFeatureDefinitionInput["states"][number];

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string =>
    typeof entry === "string" && entry.length > 0) : [];
}

/**
 * Converts one validated private environmental Form draft into the sole open
 * custom-definition builder input. Room lowering and Rules verification share
 * this adapter so an archived causal program cannot describe mechanics that
 * differ from the materialized feature.
 */
export function customEnvironmentDefinitionInputFromDraft(input: Readonly<{
  draft: Readonly<JsonRecord>;
  featureId: string;
  sceneId: string;
}>): CustomEnvironmentFeatureDefinitionInput {
  const phaseNames = stringList(input.draft.phaseNames);
  const opaque = Array.isArray(input.draft.phaseOpaque) ? input.draft.phaseOpaque : [];
  const impassable = Array.isArray(input.draft.phaseImpassable) ? input.draft.phaseImpassable : [];
  const covers = Array.isArray(input.draft.phaseCover) ? input.draft.phaseCover : [];
  const propagations = Array.isArray(input.draft.phaseEffectPropagation)
    ? input.draft.phaseEffectPropagation
    : [];
  const terrains = Array.isArray(input.draft.phaseTerrain) ? input.draft.phaseTerrain : [];
  const damageFrom = stringList(input.draft.damageFromPhases);
  const damageTo = stringList(input.draft.damageToPhases);
  const thresholds = Array.isArray(input.draft.damageRemainingAtOrBelow)
    ? input.draft.damageRemainingAtOrBelow
    : [];
  const stuntFrom = stringList(input.draft.stuntFromPhases);
  const stuntTo = stringList(input.draft.stuntToPhases);
  const hazardFrom = stringList(input.draft.hazardFromPhases);
  const hazardTo = stringList(input.draft.hazardToPhases);
  const effectMode = input.draft.effectMode;
  if (effectMode !== "state-only" && effectMode !== "area-hazard") {
    throw new TypeError("CUSTOM_ENVIRONMENT_DEFINITION_INVALID:effectMode");
  }
  const common = {
    featureId: input.featureId,
    sceneId: input.sceneId,
    label: String(input.draft.featureDescription),
    material: String(input.draft.material),
    centerXInches: Number(input.draft.centerXInches),
    centerYInches: Number(input.draft.centerYInches),
    elevationInches: Number(input.draft.elevationInches),
    widthInches: Number(input.draft.widthInches),
    depthInches: Number(input.draft.depthInches),
    heightInches: Number(input.draft.heightInches),
    visibilityPolicyId: "visibility:scene-observers" as const,
    armorClass: Number(input.draft.objectAc),
    maximumDurability: Number(input.draft.objectHitPoints),
    damageThreshold: Number(input.draft.damageThreshold),
    immuneDamageTypes: stringList(input.draft.immuneDamageTypes),
    initialState: String(input.draft.initialPhase),
    states: phaseNames.map((state, index) => ({
      state,
      opaque: opaque[index] as boolean,
      impassable: impassable[index] as boolean,
      cover: covers[index] as StateInput["cover"],
      propagation: propagations[index] as StateInput["propagation"],
      terrain: terrains[index] as StateInput["terrain"],
    })),
    damageTransitions: damageFrom.map((fromState, index) => ({
      fromState,
      remainingDurabilityAtOrBelow: Number(thresholds[index]),
      toState: String(damageTo[index]),
    })),
    stuntTransitions: stuntFrom.map((fromState, index) => ({
      fromState,
      toState: String(stuntTo[index]),
    })),
  } as const;
  if (effectMode === "state-only") return { ...common, effectMode };
  return {
    ...common,
    effectMode,
    hazardTransitions: hazardFrom.map((fromState, index) => ({
      fromState,
      toState: String(hazardTo[index]),
    })),
    hazardTriggerState: String(input.draft.hazardTriggerPhase),
    hazardResolvedState: String(input.draft.hazardResolvedPhase),
    areaOriginElevationInches: Number(input.draft.areaOriginElevationInches),
    areaRadiusInches: Number(input.draft.areaRadiusInches),
    areaPropagation: input.draft.propagation as "straight" | "aroundCorners",
    ...(input.draft.spreadBudgetInches === undefined
      ? {}
      : { spreadBudgetInches: Number(input.draft.spreadBudgetInches) }),
    saveAbility: input.draft.saveAbility as "str" | "dex" | "con" | "int" | "wis" | "cha",
    saveDc: Number(input.draft.saveDc),
    halfOnSuccess: input.draft.halfOnSuccess as boolean,
    damageFormula: String(input.draft.damage),
    damageType: String(input.draft.damageType),
    failureStatus: input.draft.condition as "none" | "prone",
  };
}
