import {
  isCanonicalTacticalGeometry,
  type CanonicalTacticalFeature,
  type CanonicalTacticalFeatureStateGraph,
  type CanonicalTacticalFeatureState,
} from "../profiles/tactical-geometry";
import {
  compileEnvironmentFeature,
  ENVIRONMENT_PROFILE,
  environmentEffectMode,
  environmentBindingMatchesFeature,
  environmentProfileEnabled,
  isCompiledEnvironmentBinding,
  isEnvironmentProfileRef,
  type AreaEffect,
} from "../profiles/environment";
import { compileAbilityDefinition } from "../profiles/ability-compiler";
import { canonicalSha256 } from "../profiles/canonical";
import { resolveCombatAttackRoll } from "../profiles/attack-resolution";
import { characterProficiencyProfileEnabled } from "../profiles/character-proficiency";
import {
  entityCanTargetTacticalFeature,
} from "../profiles/combat-geometry";
import type { ProfileRef, RuntimeProfileManifest } from "../profiles/types";
import { createEventTransition, createScopeProof } from "./events";
import type {
  AuthoritativeWorldState,
  EventEnvelope,
  EventPayloadByType,
  EventType,
  JsonRecord,
  StepResult,
} from "./model";
import { rejected } from "./results";
import { resolveCombatDamage } from "./damage";
import { savingThrowModifier, type ProficiencyAbility } from "./proficiency";
import {
  hasExactKeys,
  isNonEmptyString,
  isRecord,
} from "./validation";
import { environmentAreaTargets } from "./environment-targeting";
import { causalProgramFactRef, isCausalProgramFactValue } from "./causal-model";

export { environmentAreaTargets } from "./environment-targeting";

export const ENVIRONMENT_EVENT_TYPES = [
  "EnvironmentFeatureMaterialized",
  "EnvironmentStuntRefused",
  "EnvironmentFeatureDamaged",
  "EnvironmentFeatureStateChanged",
  "EnvironmentHazardTriggered",
  "EnvironmentAreaTargetResolved",
  "EnvironmentAreaFeatureDamaged",
] as const satisfies readonly EventType[];

type PortalIntent = "open" | "close";
type DamageTransition = NonNullable<CanonicalTacticalFeatureStateGraph["damageTransitions"]>[number];

export function damageTransitionAt(
  graph: CanonicalTacticalFeatureStateGraph | undefined,
  fromState: string | undefined,
  remainingDurability: bigint,
  mostSpecific: boolean,
): DamageTransition | undefined {
  const eligible = graph?.damageTransitions?.filter((candidate) =>
    candidate.fromState === fromState
    && remainingDurability <= BigInt(candidate.remainingDurabilityAtOrBelow));
  if (!mostSpecific) return eligible?.[0];
  return eligible?.reduce<DamageTransition | undefined>((selected, candidate) =>
      selected === undefined
      || BigInt(candidate.remainingDurabilityAtOrBelow)
        < BigInt(selected.remainingDurabilityAtOrBelow)
        ? candidate
        : selected, undefined);
}

export function controlledEnvironmentPlayer(
  state: AuthoritativeWorldState,
  principalId: unknown,
  characterId: unknown,
): characterId is string {
  if (!isNonEmptyString(principalId) || !isNonEmptyString(characterId)) return false;
  const character = state.entities[characterId];
  const control = state.characterControls[characterId];
  const seat = control === undefined ? undefined : state.seats[control.seatId];
  return character?.kind === "player"
    && character.tenureStatus === "active"
    && seat?.status === "active"
    && seat.principalId === principalId
    && state.multiplayerRuntime.members[principalId]?.status === "active";
}

export function currentTacticalFeature(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  featureId: string,
): CanonicalTacticalFeature | undefined {
  const actor = state.entities[actorCharacterId];
  const scene = actor === undefined ? undefined : state.combatRuntime.scenes[actor.sceneId];
  const geometry = isRecord(scene) ? scene.geometry : undefined;
  if (!isCanonicalTacticalGeometry(geometry)) return undefined;
  return geometry.obstacles.find((candidate) => candidate.featureId === featureId);
}

export function profiledEnvironmentFeature(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  featureId: string,
): CanonicalTacticalFeature | undefined {
  const feature = currentTacticalFeature(state, actorCharacterId, featureId);
  return feature?.kind === "destructible"
    && feature.environment !== undefined
    && isCompiledEnvironmentBinding(feature.environment)
    && environmentBindingMatchesFeature(feature.environment, feature)
    && (feature.visibilityPolicyId === "visibility:public"
      || feature.visibilityPolicyId === "visibility:scene-observers")
    ? feature
    : undefined;
}

/**
 * The initialization path gives established NPCs a spatial combat record while
 * keeping their hit points and abilities on the authoritative world identity.
 * Hazards resolve against one deterministic combat-shaped view so they do not
 * need a caller-supplied or separately materialized NPC target.
 */
export function environmentDamageTarget(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  targetEntityId: string,
): JsonRecord | undefined {
  const spatial = state.combatRuntime.entities[targetEntityId];
  if (spatial === undefined) return undefined;
  if (isRecord(spatial.hitPoints)) return spatial;
  const identity = state.entities[targetEntityId];
  if (identity?.kind !== "npc" || identity.hitPoints === undefined) return undefined;
  const scores = identity.abilityScores ?? {};
  return {
    ...structuredClone(spatial),
    stats: Object.fromEntries(
      ["str", "dex", "con", "int", "wis", "cha"].map((ability) => [
        ability,
        String(scores[ability] ?? 10),
      ]),
    ),
    proficiencyBonus: String(identity.proficiencyBonus ?? 2),
    ...(characterProficiencyProfileEnabled(profiles.extensions)
      ? {
          expertiseSkills: [...(identity.expertiseSkills ?? [])].sort(),
          proficientSaves: [...(identity.proficientSaves ?? [])].sort(),
          proficientSkills: [...(identity.proficientSkills ?? [])].sort(),
        }
      : {}),
    hitPoints: {
      current: String(identity.hitPoints.current),
      maximum: String(identity.hitPoints.maximum),
      temporary: "0",
    },
    deathPolicy: "deadAtZero",
  };
}

function environmentCondition(target: JsonRecord, conditionId: string): boolean {
  return isRecord(target.conditions) && target.conditions[conditionId] === true;
}

function environmentSaveMode(
  target: JsonRecord,
  ability: string,
): "normal" | "disadvantage" {
  return ability === "dex"
    && ["restrained", "squeezing"].some((conditionId) =>
      environmentCondition(target, conditionId))
    ? "disadvantage"
    : "normal";
}

/** Shared target calculation used both when producing and replay-validating hazard events. */
export function resolveEnvironmentAreaTarget(
  profiles: RuntimeProfileManifest,
  target: JsonRecord,
  areaEffect: AreaEffect,
  rolledDamage: number,
  saveRolls: number[],
): {
  saveMode: "normal" | "disadvantage";
  selectedSaveRoll: number;
  saveModifier: number;
  saveTotal: number;
  saveSucceeded: boolean;
  appliedDamage: number;
  statusApplied: "none" | "prone";
  targetPatch: JsonRecord;
  components: ReturnType<typeof resolveCombatDamage>["components"];
  died: boolean;
} {
  if (!Number.isSafeInteger(rolledDamage) || rolledDamage < 0) {
    throw new TypeError("environment area damage is not canonical");
  }
  const saveMode = environmentSaveMode(target, areaEffect.save.ability);
  const expectedRollCount = saveMode === "normal" ? 1 : 2;
  if (saveRolls.length !== expectedRollCount
    || !saveRolls.every((roll) => Number.isInteger(roll) && roll >= 1 && roll <= 20)) {
    throw new TypeError("environment area save faces are unavailable");
  }
  const selectedSaveRoll = saveMode === "disadvantage"
    ? Math.min(...saveRolls)
    : saveRolls[0];
  const saveModifier = savingThrowModifier(
    profiles,
    target,
    areaEffect.save.ability as ProficiencyAbility,
  ) ?? 0;
  const saveTotal = selectedSaveRoll + saveModifier;
  const saveSucceeded = saveTotal >= Number(areaEffect.save.dc);
  const damageBeforeMitigation = saveSucceeded
    ? areaEffect.save.halfOnSuccess ? Math.floor(rolledDamage / 2) : 0
    : rolledDamage;
  const resolution = resolveCombatDamage(
    target,
    [{ type: areaEffect.damage.type, rolled: damageBeforeMitigation }],
  );
  const targetPatch = structuredClone(resolution.targetPatch);
  if (!isRecord(target.hitPoints) || !isRecord(targetPatch.hitPoints)) {
    throw new TypeError("environment area target lacks hit points");
  }
  const beforeCurrent = Number(target.hitPoints.current);
  const temporaryBefore = Number(target.hitPoints.temporary ?? 0);
  const hitPointDamage = Math.max(0, resolution.totalApplied - temporaryBefore);
  const afterCurrent = Number(targetPatch.hitPoints.current);
  let died = false;
  if (afterCurrent === 0) {
    const conditions = { ...(isRecord(targetPatch.conditions) ? targetPatch.conditions : {}) };
    delete conditions.stable;
    targetPatch.conditions = { ...conditions, unconscious: true, prone: true };
    const maximum = Number(targetPatch.hitPoints.maximum);
    const massiveDamage = beforeCurrent > 0 && hitPointDamage - beforeCurrent >= maximum;
    if (targetPatch.deathPolicy === "deadAtZero" || massiveDamage) {
      targetPatch.lifeState = "dead";
      died = true;
    } else if (beforeCurrent === 0 && hitPointDamage > 0) {
      const saves = isRecord(targetPatch.deathSaves)
        ? targetPatch.deathSaves
        : { successes: 0, failures: 0 };
      saves.failures = Number(saves.failures ?? 0) + 1;
      targetPatch.deathSaves = saves;
      if (Number(saves.failures) >= 3) {
        targetPatch.lifeState = "dead";
        died = true;
      }
    }
    if (!died) targetPatch.lifeState = "unconscious";
  }
  const statusApplied = !saveSucceeded
    && areaEffect.failureStatus === "prone"
    && !died
    ? "prone" as const
    : "none" as const;
  if (statusApplied === "prone") {
    targetPatch.conditions = {
      ...(isRecord(targetPatch.conditions) ? targetPatch.conditions : {}),
      prone: true,
    };
  }
  return {
    saveMode,
    selectedSaveRoll,
    saveModifier,
    saveTotal,
    saveSucceeded,
    appliedDamage: resolution.totalApplied,
    statusApplied,
    targetPatch,
    components: resolution.components,
    died,
  };
}

function publicPortal(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  featureId: string,
): CanonicalTacticalFeature | undefined {
  const feature = currentTacticalFeature(state, actorCharacterId, featureId);
  return feature?.kind === "portal"
    && (feature.visibilityPolicyId === "visibility:public"
      || feature.visibilityPolicyId === "visibility:scene-observers")
    && feature.stateGraph !== undefined
    ? feature
    : undefined;
}

export function publicDamageableFeature(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  featureId: string,
): CanonicalTacticalFeature | undefined {
  const feature = currentTacticalFeature(state, actorCharacterId, featureId);
  return (feature?.kind === "portal" || feature?.kind === "destructible")
    && feature.environment === undefined
    && (feature.visibilityPolicyId === "visibility:public"
      || feature.visibilityPolicyId === "visibility:scene-observers")
    && feature.stateGraph?.durability !== undefined
    && feature.stateGraph.damageTransitions !== undefined
    && feature.durability !== undefined
    ? feature
    : undefined;
}

function transitionFor(
  feature: CanonicalTacticalFeature,
  intent: PortalIntent,
): { toState: string; semantics: CanonicalTacticalFeatureState } | undefined {
  const graph = feature.stateGraph;
  const transition = graph?.transitions.find((candidate) =>
    candidate.fromState === feature.state && candidate.intent === intent);
  const semantics = transition === undefined
    ? undefined
    : graph?.states.find((candidate) => candidate.state === transition.toState);
  return transition === undefined || semantics === undefined
    ? undefined
    : { toState: transition.toState, semantics };
}

function environmentTransitionResult(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  actorCharacterId: string,
  featureId: string,
  intent: PortalIntent,
  authorityScope: string | undefined,
): StepResult {
  const actor = state.entities[actorCharacterId];
  if (actor?.kind !== "player" || actor.tenureStatus !== "active") {
    return rejected("privateOrUnknownReference", "The environment actor is unavailable.");
  }
  const feature = publicPortal(state, actorCharacterId, featureId);
  if (feature === undefined) {
    return rejected("privateOrUnknownReference", "The environment feature is unavailable.");
  }
  const transition = transitionFor(feature, intent);
  if (transition === undefined) {
    return rejected("worldLawViolation", "The requested environment transition is unavailable.");
  }
  const payload: EventPayloadByType["EnvironmentFeatureStateChanged"] = {
    actorCharacterId,
    sceneId: actor.sceneId,
    featureId,
    definitionId: feature.stateGraph!.definitionId,
    intent,
    fromState: feature.state,
    toState: transition.toState,
  };
  const scopeProof = createScopeProof(
    state,
    [
      authorityScope ?? `entity:${actorCharacterId}`,
      `scene:${actor.sceneId}`,
      `environment-definition:${feature.stateGraph!.definitionId}`,
    ],
    [`environment-feature:${featureId}`, `receipt:${rootActionId}`],
    [],
  );
  const transitionResult = createEventTransition(state, profiles, {
    rootActionId,
    eventType: "EnvironmentFeatureStateChanged",
    payload,
    scopeProof,
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
  });
  return {
    kind: "committed",
    events: [transitionResult.event],
    state: transitionResult.state,
    cache: transitionResult.state,
    stateHash: transitionResult.event.stateHashAfter,
    scopeProof,
    receipt: transitionResult.receipt,
    mechanicalResult: {
      kind: "environmentFeatureStateChanged",
      sceneId: actor.sceneId,
      featureId,
      fromState: feature.state,
      toState: transition.toState,
    },
  };
}

/** Rules-internal direct transition for an already authenticated causal actor.
 * The caller supplies no principal, viewer, audience, target list, or patch. */
export function resolveCausalEnvironmentTransition(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  actorCharacterId: string,
  featureId: string,
  intent: PortalIntent,
): StepResult {
  if (![rootActionId, actorCharacterId, featureId].every(isNonEmptyString)
    || (intent !== "open" && intent !== "close")) {
    return rejected("invalidRulesInput", "The causal environment transition is not canonical.");
  }
  return environmentTransitionResult(
    profiles,
    state,
    rootActionId,
    actorCharacterId,
    featureId,
    intent,
    undefined,
  );
}

function interactEnvironmentFeature(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, [
    "actorCharacterId",
    "controllerPrincipalId",
    "featureId",
    "intent",
    "kind",
    "rootActionId",
  ])
    || !isNonEmptyString(input.actorCharacterId)
    || !isNonEmptyString(input.controllerPrincipalId)
    || !isNonEmptyString(input.featureId)
    || !isNonEmptyString(input.rootActionId)
    || (input.intent !== "open" && input.intent !== "close")) {
    return rejected("invalidRulesInput", "Environment interaction is not canonical.");
  }
  if (input.rootActionId in state.receipts) {
    return rejected("duplicateRootAction", "The environment interaction root action is already used.");
  }
  if (!controlledEnvironmentPlayer(state, input.controllerPrincipalId, input.actorCharacterId)) {
    return rejected("viewerUnauthorized", "The environment interaction controller is unavailable.");
  }
  return environmentTransitionResult(
    profiles,
    state,
    input.rootActionId as string,
    input.actorCharacterId as string,
    input.featureId as string,
    input.intent as PortalIntent,
    `control:${input.actorCharacterId as string}`,
  );
}

export function stepEnvironmentWorld(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  return input.kind === "interactEnvironmentFeature"
    ? interactEnvironmentFeature(profiles, state, input)
    : undefined;
}

export function validateEnvironmentEventPayload(
  eventType: EventType,
  value: unknown,
): boolean {
  switch (eventType) {
    case "EnvironmentFeatureMaterialized":
      return validateEnvironmentMaterializedPayload(value);
    case "EnvironmentStuntRefused":
      return isRecord(value)
        && hasExactKeys(value, ["actorCharacterId", "featureId", "reason", "sceneId"])
        && [value.actorCharacterId, value.featureId, value.sceneId].every(isNonEmptyString)
        && value.reason === "featureAbsent";
    case "EnvironmentFeatureDamaged":
      return validateEnvironmentDamagePayload(value);
    case "EnvironmentFeatureStateChanged":
      return isRecord(value)
        && hasExactKeys(value, [
          "actorCharacterId",
          "definitionId",
          "featureId",
          "fromState",
          "intent",
          "sceneId",
          "toState",
        ])
        && [
          value.actorCharacterId,
          value.definitionId,
          value.featureId,
          value.fromState,
          value.sceneId,
          value.toState,
        ].every(isNonEmptyString)
        && ["open", "close", "applyStunt", "triggerHazard", "resolveHazard"].includes(String(value.intent))
        && value.fromState !== value.toState;
    case "EnvironmentHazardTriggered":
      return validateEnvironmentHazardPayload(value);
    case "EnvironmentAreaTargetResolved":
      return validateEnvironmentAreaTargetPayload(value);
    case "EnvironmentAreaFeatureDamaged":
      return validateEnvironmentAreaFeaturePayload(value);
    default:
      return false;
  }
}

function sha256(value: unknown): boolean {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function canonicalIds(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 512
    && value.every(isNonEmptyString)
    && new Set(value).size === value.length
    && value.every((entry, index) => index === 0 || value[index - 1] < entry);
}

function validateEnvironmentMaterializedPayload(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const baseKeys = [
      "actorCharacterId",
      "compiledHash",
      "environmentProfile",
      "feature",
      "featureDefinition",
      "featureDefinitionHash",
      "featureId",
      "sceneId",
    ];
  const v3 = sameProfileRef(value.environmentProfile, ENVIRONMENT_PROFILE);
  if (!hasExactKeys(value, v3
    ? [...baseKeys, "causalProgramFactRef", "causalProgramHash"]
    : baseKeys)
    || ![value.actorCharacterId, value.featureId, value.sceneId].every(isNonEmptyString)
    || !isEnvironmentProfileRef(value.environmentProfile)
    || !isRecord(value.featureDefinition)
    || !isRecord(value.feature)
    || !sha256(value.featureDefinitionHash)
    || !sha256(value.compiledHash)
    || (v3 && (
      !isNonEmptyString(value.causalProgramFactRef)
      || !/^fnv1a64:[0-9a-f]{16}$/u.test(String(value.causalProgramHash))
    ))) return false;
  const compiled = compileEnvironmentFeature(value.featureDefinition);
  return compiled.ok
    && sameProfileRef(
      value.environmentProfile,
      compiled.artifact.tacticalFeature.environment.profile,
    )
    && value.featureDefinition.sceneId === value.sceneId
    && value.featureDefinition.featureId === value.featureId
    && value.featureDefinitionHash === compiled.artifact.featureDefinitionHash
    && value.compiledHash === compiled.artifact.compiledHash
    && canonicalSha256(value.feature) === canonicalSha256(compiled.artifact.tacticalFeature);
}

function sameProfileRef(left: unknown, right: ProfileRef): boolean {
  return isRecord(left)
    && left.profileId === right.profileId
    && left.profileHash === right.profileHash;
}

function eventEnablesEnvironmentProfile(event: EventEnvelope, expected: ProfileRef): boolean {
  return environmentProfileEnabled(event.profiles.extensions, expected);
}

function validateEnvironmentHazardPayload(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, [
      "actorCharacterId",
      "areaEffectDefinition",
      "areaEffectDefinitionHash",
      "entityTargetIds",
      "environmentProfile",
      "featureDefinitionHash",
      "featureId",
      "featureTargetIds",
      "hazardDefinition",
      "hazardDefinitionHash",
      "origin",
      "sceneId",
    ])
    && [value.actorCharacterId, value.featureId, value.sceneId].every(isNonEmptyString)
    && isEnvironmentProfileRef(value.environmentProfile)
    && isRecord(value.hazardDefinition)
    && isRecord(value.areaEffectDefinition)
    && [
      value.featureDefinitionHash,
      value.hazardDefinitionHash,
      value.areaEffectDefinitionHash,
    ].every(sha256)
    && canonicalSha256(value.hazardDefinition) === value.hazardDefinitionHash
    && canonicalSha256(value.areaEffectDefinition) === value.areaEffectDefinitionHash
    && isRecord(value.origin)
    && hasExactKeys(value.origin, ["elevation", "x", "y"])
    && [value.origin.x, value.origin.y, value.origin.elevation]
      .every((entry) => typeof entry === "string" && /^-?(0|[1-9][0-9]*)$/.test(entry))
    && canonicalIds(value.entityTargetIds)
    && canonicalIds(value.featureTargetIds);
}

function validateEnvironmentAreaTargetPayload(value: unknown): boolean {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "actorCharacterId",
      "appliedDamage",
      "areaEffectDefinitionHash",
      "damageType",
      "rolledDamage",
      "saveAbility",
      "saveDc",
      "saveMode",
      "saveModifier",
      "saveRolls",
      "saveSucceeded",
      "saveTotal",
      "sceneId",
      "selectedSaveRoll",
      "sourceFeatureId",
      "statusApplied",
      "targetBeforeHash",
      "targetEntityId",
      "targetPatch",
    ])
    || ![
      value.actorCharacterId,
      value.damageType,
      value.sceneId,
      value.sourceFeatureId,
      value.targetEntityId,
    ].every(isNonEmptyString)
    || !sha256(value.areaEffectDefinitionHash)
    || !sha256(value.targetBeforeHash)
    || !["str", "dex", "con", "int", "wis", "cha"].includes(String(value.saveAbility))
    || !["normal", "advantage", "disadvantage"].includes(String(value.saveMode))
    || ![value.saveDc, value.rolledDamage, value.appliedDamage]
      .every((entry) => typeof entry === "string" && /^(0|[1-9][0-9]*)$/.test(entry))
    || ![value.saveModifier, value.saveTotal]
      .every((entry) => typeof entry === "string" && /^-?(0|[1-9][0-9]*)$/.test(entry))
    || !Array.isArray(value.saveRolls)
    || value.saveRolls.length !== (value.saveMode === "normal" ? 1 : 2)
    || !value.saveRolls.every((roll) => Number.isInteger(roll) && roll >= 1 && roll <= 20)
    || !Number.isInteger(value.selectedSaveRoll)
    || !value.saveRolls.includes(value.selectedSaveRoll)
    || typeof value.saveSucceeded !== "boolean"
    || !["none", "prone"].includes(String(value.statusApplied))
    || !isRecord(value.targetPatch)) return false;
  return value.targetPatch.id === value.targetEntityId
    && BigInt(String(value.appliedDamage)) <= BigInt(String(value.rolledDamage));
}

function validateEnvironmentAreaFeaturePayload(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, [
      "actorCharacterId",
      "appliedDamage",
      "areaEffectDefinitionHash",
      "damageType",
      "durabilityAfter",
      "durabilityBefore",
      "fromState",
      "rolledDamage",
      "sceneId",
      "sourceFeatureId",
      "targetFeatureId",
      "toState",
    ])
    && [
      value.actorCharacterId,
      value.damageType,
      value.fromState,
      value.sceneId,
      value.sourceFeatureId,
      value.targetFeatureId,
      value.toState,
    ].every(isNonEmptyString)
    && sha256(value.areaEffectDefinitionHash)
    && [
      value.appliedDamage,
      value.durabilityAfter,
      value.durabilityBefore,
      value.rolledDamage,
    ].every((entry) => typeof entry === "string" && /^(0|[1-9][0-9]*)$/.test(entry));
}

function validateEnvironmentDamagePayload(value: unknown): boolean {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "abilityDefinition",
      "abilityDefinitionHash",
      "abilityRef",
      "actorCharacterId",
      "appliedDamage",
      "armorClass",
      "attackBonus",
      "attackRolls",
      "attackTotal",
      "compiledHash",
      "damageThreshold",
      "damageType",
      "definitionId",
      "durabilityAfter",
      "durabilityBefore",
      "environmentDefinition",
      "environmentDefinitionHash",
      "featureId",
      "fromState",
      "immuneDamageTypes",
      "hit",
      "rolledDamage",
      "rangeInches",
      "sceneId",
      "selectedAttackRoll",
      "toState",
    ])
    || ![
      value.abilityDefinitionHash,
      value.abilityRef,
      value.actorCharacterId,
      value.armorClass,
      value.attackBonus,
      value.attackTotal,
      value.compiledHash,
      value.damageType,
      value.definitionId,
      value.environmentDefinitionHash,
      value.featureId,
      value.fromState,
      value.rangeInches,
      value.sceneId,
      value.toState,
    ].every(isNonEmptyString)
    || ![value.appliedDamage, value.damageThreshold, value.durabilityAfter, value.durabilityBefore, value.rolledDamage]
      .every((entry) => typeof entry === "string" && /^(0|[1-9][0-9]*)$/.test(entry))
    || !Array.isArray(value.immuneDamageTypes)
    || !value.immuneDamageTypes.every(isNonEmptyString)
    || value.immuneDamageTypes.length !== new Set(value.immuneDamageTypes).size
    || !isRecord(value.abilityDefinition)
    || !isRecord(value.environmentDefinition)
    || !Array.isArray(value.attackRolls)
    || value.attackRolls.length !== 1
    || !value.attackRolls.every((roll) => Number.isInteger(roll) && Number(roll) >= 1 && Number(roll) <= 20)
    || !Number.isInteger(value.selectedAttackRoll)
    || !value.attackRolls.includes(value.selectedAttackRoll)
    || !/^-?(0|[1-9][0-9]*)$/.test(String(value.attackBonus))
    || !/^-?(0|[1-9][0-9]*)$/.test(String(value.attackTotal))
    || typeof value.hit !== "boolean"
    || value.abilityRef !== value.abilityDefinition.definitionId
    || value.environmentDefinitionHash !== canonicalSha256(value.environmentDefinition)) return false;
  const compiled = compileAbilityDefinition(value.abilityDefinition);
  return compiled.ok
    && compiled.artifact.definitionHash === value.abilityDefinitionHash
    && compiled.artifact.compiledHash === value.compiledHash;
}

export function applyEnvironmentEvent(
  state: AuthoritativeWorldState,
  event: EventEnvelope,
): boolean {
  if (event.eventType === "EnvironmentFeatureMaterialized") {
    const payload = event.payload as EventPayloadByType["EnvironmentFeatureMaterialized"];
    const actor = state.entities[payload.actorCharacterId];
    const scene = state.combatRuntime.scenes[payload.sceneId];
    const geometry = isRecord(scene) ? scene.geometry : undefined;
    const compiled = compileEnvironmentFeature(payload.featureDefinition);
    const causalFact = payload.causalProgramFactRef === undefined
      ? undefined
      : state.canonicalFacts[payload.causalProgramFactRef];
    const causalValue = causalFact?.value;
    let causalProgramMatches = false;
    if (causalFact?.kind === "causalActionProgram"
      && causalFact.source === "characterAction"
      && causalFact.subjectRefs.length === 1
      && causalFact.subjectRefs[0] === payload.actorCharacterId
      && isCausalProgramFactValue(causalValue)
      && isRecord(causalValue)) {
      causalProgramMatches = causalValue.formRef === "environmental-stunt.v1"
        && causalValue.programHash === payload.causalProgramHash
        && payload.causalProgramFactRef === causalProgramFactRef(
          event.rootActionId,
          payload.causalProgramHash ?? "",
        );
    }
    const v3 = compiled.ok && sameProfileRef(
      compiled.artifact.tacticalFeature.environment.profile,
      ENVIRONMENT_PROFILE,
    );
    if (actor?.sceneId !== payload.sceneId
      || !isCanonicalTacticalGeometry(geometry)
      || !compiled.ok
      || !sameProfileRef(
        payload.environmentProfile,
        compiled.artifact.tacticalFeature.environment.profile,
      )
      || !eventEnablesEnvironmentProfile(
        event,
        compiled.artifact.tacticalFeature.environment.profile,
      )
      || compiled.artifact.featureDefinitionHash !== payload.featureDefinitionHash
      || compiled.artifact.compiledHash !== payload.compiledHash
      || canonicalSha256(compiled.artifact.tacticalFeature) !== canonicalSha256(payload.feature)
      || (v3 && !causalProgramMatches)
      || geometry.obstacles.some(({ featureId }) => featureId === payload.featureId)) {
      throw new TypeError("environment feature materialization is unavailable");
    }
    geometry.obstacles.push(structuredClone(compiled.artifact.tacticalFeature));
    geometry.obstacles.sort((left, right) => left.featureId.localeCompare(right.featureId));
    if (!isCanonicalTacticalGeometry(geometry)) {
      throw new TypeError("environment feature materialization violates canonical geometry");
    }
    return true;
  }
  if (event.eventType === "EnvironmentStuntRefused") {
    const payload = event.payload as EventPayloadByType["EnvironmentStuntRefused"];
    const actor = state.entities[payload.actorCharacterId];
    if (actor?.sceneId !== payload.sceneId
      || currentTacticalFeature(state, payload.actorCharacterId, payload.featureId) !== undefined) {
      throw new TypeError("environment refusal contradicts authoritative geometry");
    }
    return true;
  }
  if (event.eventType === "EnvironmentFeatureDamaged") {
    const payload = event.payload as EventPayloadByType["EnvironmentFeatureDamaged"];
    const actor = state.entities[payload.actorCharacterId];
    const source = state.combatRuntime.entities[payload.actorCharacterId];
    const definition = state.combatRuntime.definitions[payload.abilityRef];
    const scene = state.combatRuntime.scenes[payload.sceneId];
    const geometry = isRecord(scene) ? scene.geometry : undefined;
    if (actor?.sceneId !== payload.sceneId
      || source?.sceneId !== payload.sceneId
      || !Array.isArray(source.abilityRefs)
      || !source.abilityRefs.includes(payload.abilityRef)
      || definition === undefined
      || canonicalSha256(definition) !== canonicalSha256(payload.abilityDefinition)
      || !isCanonicalTacticalGeometry(geometry)) {
      throw new TypeError("environment damage authority is unavailable");
    }
    const compiled = compileAbilityDefinition(definition);
    const feature = geometry.obstacles.find((candidate) => candidate.featureId === payload.featureId);
    const binding = feature?.environment;
    const graph = feature?.stateGraph;
    const durability = feature?.durability;
    if (!compiled.ok
      || compiled.artifact.definitionHash !== payload.abilityDefinitionHash
      || compiled.artifact.compiledHash !== payload.compiledHash
      || (binding !== undefined && !eventEnablesEnvironmentProfile(event, binding.profile))
      || graph?.definitionId !== payload.definitionId
      || canonicalSha256(graph) !== payload.environmentDefinitionHash
      || canonicalSha256(graph) !== canonicalSha256(payload.environmentDefinition)
      || durability === undefined
      || durability.current !== payload.durabilityBefore
      || durability.damageThreshold !== payload.damageThreshold
      || durability.armorClass !== payload.armorClass
      || JSON.stringify(durability.immuneDamageTypes) !== JSON.stringify(payload.immuneDamageTypes)
      || feature?.state !== payload.fromState
      || !entityCanTargetTacticalFeature(scene, source, feature, payload.rangeInches)) {
      throw new TypeError("environment damage frozen definition is unavailable");
    }
    const attack = resolveCombatAttackRoll(
      source,
      definition,
      Number(payload.armorClass),
      payload.attackRolls,
      "normal",
    );
    const rolledDamage = BigInt(payload.rolledDamage);
    const expectedApplied = !attack.hit || payload.immuneDamageTypes.includes(payload.damageType)
      || rolledDamage < BigInt(payload.damageThreshold)
      ? 0n
      : rolledDamage;
    const expectedAfter = BigInt(payload.durabilityBefore) > expectedApplied
      ? BigInt(payload.durabilityBefore) - expectedApplied
      : 0n;
    const damageTransition = damageTransitionAt(
      graph,
      payload.fromState,
      expectedAfter,
      binding?.profile.profileId === ENVIRONMENT_PROFILE.profileId
        && binding.profile.profileHash === ENVIRONMENT_PROFILE.profileHash,
    );
    const expectedToState = damageTransition?.toState ?? payload.fromState;
    const semantics = graph.states.find((candidate) => candidate.state === expectedToState);
    if (payload.selectedAttackRoll !== attack.selected
      || payload.attackBonus !== String(attack.attackBonus)
      || payload.attackTotal !== String(attack.total)
      || payload.hit !== attack.hit
      || payload.appliedDamage !== expectedApplied.toString()
      || payload.durabilityAfter !== expectedAfter.toString()
      || payload.toState !== expectedToState
      || semantics === undefined) {
      throw new TypeError("environment damage result violates its pinned definition");
    }
    durability.current = payload.durabilityAfter;
    feature.state = semantics.state;
    feature.opaque = semantics.opaque;
    feature.impassable = semantics.impassable;
    feature.cover = semantics.cover;
    feature.propagation = semantics.propagation;
    feature.terrain = semantics.terrain ?? "normal";
    if (!isCanonicalTacticalGeometry(geometry)) {
      throw new TypeError("environment damage violates canonical tactical geometry");
    }
    return true;
  }
  if (event.eventType === "EnvironmentHazardTriggered") {
    const payload = event.payload as EventPayloadByType["EnvironmentHazardTriggered"];
    const actor = state.entities[payload.actorCharacterId];
    const feature = profiledEnvironmentFeature(
      state,
      payload.actorCharacterId,
      payload.featureId,
    );
    const binding = feature?.environment;
    const definition = binding?.featureDefinition;
    const hazardDefinition = definition?.hazard;
    const areaEffectDefinition = definition?.areaEffect;
    const targets = definition === undefined
      || hazardDefinition === undefined
      || hazardDefinition === null
      || areaEffectDefinition === undefined
      || areaEffectDefinition === null
      ? undefined
      : environmentAreaTargets(
          state,
          payload.sceneId,
          payload.featureId,
          areaEffectDefinition,
        );
    if (actor?.sceneId !== payload.sceneId
      || definition === undefined
      || environmentEffectMode(definition) !== "area-hazard"
      || hazardDefinition === undefined
      || hazardDefinition === null
      || areaEffectDefinition === undefined
      || areaEffectDefinition === null
      || feature?.state !== hazardDefinition.trigger.state
      || binding === undefined
      || !sameProfileRef(payload.environmentProfile, binding.profile)
      || !eventEnablesEnvironmentProfile(event, binding.profile)
      || binding?.featureDefinitionHash !== payload.featureDefinitionHash
      || binding?.hazardDefinitionHash !== payload.hazardDefinitionHash
      || binding?.areaEffectDefinitionHash !== payload.areaEffectDefinitionHash
      || canonicalSha256(hazardDefinition) !== canonicalSha256(payload.hazardDefinition)
      || canonicalSha256(areaEffectDefinition) !== canonicalSha256(payload.areaEffectDefinition)
      || targets === undefined
      || canonicalSha256(targets.origin) !== canonicalSha256(payload.origin)
      || canonicalSha256(targets.entityTargetIds) !== canonicalSha256(payload.entityTargetIds)
      || canonicalSha256(targets.featureTargetIds) !== canonicalSha256(payload.featureTargetIds)) {
      throw new TypeError("environment hazard targets violate authoritative geometry");
    }
    return true;
  }
  if (event.eventType === "EnvironmentAreaTargetResolved") {
    const payload = event.payload as EventPayloadByType["EnvironmentAreaTargetResolved"];
    const target = environmentDamageTarget(event.profiles, state, payload.targetEntityId);
    const feature = profiledEnvironmentFeature(
      state,
      payload.actorCharacterId,
      payload.sourceFeatureId,
    );
    const areaEffect = feature?.environment?.featureDefinition.areaEffect;
    const binding = feature?.environment;
    const outcome = target === undefined || areaEffect === undefined || areaEffect === null
      ? undefined
      : resolveEnvironmentAreaTarget(
          event.profiles,
          target,
          areaEffect,
          Number(payload.rolledDamage),
          payload.saveRolls,
        );
    if (target?.sceneId !== payload.sceneId
      || canonicalSha256(target) !== payload.targetBeforeHash
      || binding === undefined
      || !eventEnablesEnvironmentProfile(event, binding.profile)
      || feature?.environment?.areaEffectDefinitionHash !== payload.areaEffectDefinitionHash
      || areaEffect?.save.ability !== payload.saveAbility
      || areaEffect.save.dc !== payload.saveDc
      || areaEffect.damage.type !== payload.damageType
      || outcome === undefined
      || outcome.saveMode !== payload.saveMode
      || outcome.selectedSaveRoll !== payload.selectedSaveRoll
      || String(outcome.saveModifier) !== payload.saveModifier
      || String(outcome.saveTotal) !== payload.saveTotal
      || outcome.saveSucceeded !== payload.saveSucceeded
      || String(outcome.appliedDamage) !== payload.appliedDamage
      || outcome.statusApplied !== payload.statusApplied
      || payload.targetPatch.id !== payload.targetEntityId
      || canonicalSha256(outcome.targetPatch) !== canonicalSha256(payload.targetPatch)) {
      throw new TypeError("environment area target resolution is unavailable");
    }
    return true;
  }
  if (event.eventType === "EnvironmentAreaFeatureDamaged") {
    const payload = event.payload as EventPayloadByType["EnvironmentAreaFeatureDamaged"];
    const actor = state.entities[payload.actorCharacterId];
    const scene = state.combatRuntime.scenes[payload.sceneId];
    const geometry = isRecord(scene) ? scene.geometry : undefined;
    const source = isCanonicalTacticalGeometry(geometry)
      ? geometry.obstacles.find(({ featureId }) => featureId === payload.sourceFeatureId)
      : undefined;
    const sourceAreaHash = source?.environment?.areaEffectDefinitionHash;
    const sourceBinding = source?.environment;
    const target = isCanonicalTacticalGeometry(geometry)
      ? geometry.obstacles.find(({ featureId }) => featureId === payload.targetFeatureId)
      : undefined;
    const durability = target?.durability;
    const graph = target?.stateGraph;
    const rolled = BigInt(payload.rolledDamage);
    const expectedApplied = durability === undefined
      || durability.immuneDamageTypes.includes(payload.damageType)
      || rolled < BigInt(durability.damageThreshold)
      ? 0n
      : rolled;
    const expectedAfter = durability === undefined
      ? 0n
      : BigInt(durability.current) > expectedApplied
        ? BigInt(durability.current) - expectedApplied
        : 0n;
    const transition = damageTransitionAt(
      graph,
      target?.state,
      expectedAfter,
      target?.environment?.profile.profileId === ENVIRONMENT_PROFILE.profileId
        && target.environment.profile.profileHash === ENVIRONMENT_PROFILE.profileHash,
    );
    const expectedState = transition?.toState ?? target?.state;
    const semantics = graph?.states.find(({ state: stateId }) => stateId === expectedState);
    if (actor?.sceneId !== payload.sceneId
      || sourceBinding === undefined
      || !eventEnablesEnvironmentProfile(event, sourceBinding.profile)
      || sourceAreaHash !== payload.areaEffectDefinitionHash
      || target === undefined
      || durability === undefined
      || target.state !== payload.fromState
      || durability.current !== payload.durabilityBefore
      || expectedApplied.toString() !== payload.appliedDamage
      || expectedAfter.toString() !== payload.durabilityAfter
      || expectedState !== payload.toState
      || semantics === undefined) {
      throw new TypeError("environment area feature damage violates its frozen definition");
    }
    durability.current = payload.durabilityAfter;
    target.state = semantics.state;
    target.opaque = semantics.opaque;
    target.impassable = semantics.impassable;
    target.cover = semantics.cover;
    target.propagation = semantics.propagation;
    target.terrain = semantics.terrain ?? "normal";
    if (!isCanonicalTacticalGeometry(geometry)) {
      throw new TypeError("environment area damage violates canonical tactical geometry");
    }
    return true;
  }
  if (event.eventType !== "EnvironmentFeatureStateChanged") return false;
  const payload = event.payload as EventPayloadByType["EnvironmentFeatureStateChanged"];
  const actor = state.entities[payload.actorCharacterId];
  const scene = state.combatRuntime.scenes[payload.sceneId];
  const geometry = isRecord(scene) ? scene.geometry : undefined;
  if (actor?.sceneId !== payload.sceneId || !isCanonicalTacticalGeometry(geometry)) {
    throw new TypeError("environment feature scene is unavailable");
  }
  const feature = geometry.obstacles.find((candidate) => candidate.featureId === payload.featureId);
  const graph = feature?.stateGraph;
  const transition = graph?.transitions.find((candidate) =>
    candidate.fromState === payload.fromState
    && candidate.intent === payload.intent
    && candidate.toState === payload.toState);
  const semantics = graph?.states.find((candidate) => candidate.state === payload.toState);
  const validFeatureKind = payload.intent === "resolveHazard"
    || payload.intent === "triggerHazard"
    || payload.intent === "applyStunt"
    ? feature?.kind === "destructible" && feature.environment !== undefined
    : feature?.kind === "portal";
  const environmentIntent = payload.intent === "applyStunt"
    || payload.intent === "triggerHazard"
    || payload.intent === "resolveHazard";
  if (feature === undefined
    || !validFeatureKind
    || (environmentIntent
      && (feature.environment === undefined
        || !eventEnablesEnvironmentProfile(event, feature.environment.profile)))
    || graph?.definitionId !== payload.definitionId
    || feature.state !== payload.fromState
    || transition === undefined
    || semantics === undefined) {
    throw new TypeError("environment feature transition is unavailable");
  }
  feature.state = semantics.state;
  feature.opaque = semantics.opaque;
  feature.impassable = semantics.impassable;
  feature.cover = semantics.cover;
  feature.propagation = semantics.propagation;
  feature.terrain = semantics.terrain ?? "normal";
  if (!isCanonicalTacticalGeometry(geometry)) {
    throw new TypeError("environment feature transition violates its pinned definition");
  }
  return true;
}
