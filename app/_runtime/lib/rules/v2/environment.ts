import {
  isCanonicalTacticalGeometry,
  type CanonicalTacticalFeature,
  type CanonicalTacticalFeatureState,
} from "../profiles/tactical-geometry";
import { compileAbilityDefinition } from "../profiles/ability-compiler";
import { canonicalSha256 } from "../profiles/canonical";
import { resolveCombatAttackRoll } from "../profiles/attack-resolution";
import { entityCanTargetTacticalFeature } from "../profiles/combat-geometry";
import type { RuntimeProfileManifest } from "../profiles/types";
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
import {
  hasExactKeys,
  isNonEmptyString,
  isRecord,
} from "./validation";

export const ENVIRONMENT_EVENT_TYPES = [
  "EnvironmentFeatureDamaged",
  "EnvironmentFeatureStateChanged",
] as const satisfies readonly EventType[];

type PortalIntent = "open" | "close";

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

function publicPortal(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  featureId: string,
): CanonicalTacticalFeature | undefined {
  const moduleRef = state.campaignRuntime.campaign?.moduleRef;
  if (!isRecord(moduleRef)
    || !isNonEmptyString(moduleRef.profileId)
    || !moduleRef.profileId.endsWith(":tactical-map-v1")) {
    return undefined;
  }
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
  const moduleRef = state.campaignRuntime.campaign?.moduleRef;
  if (!isRecord(moduleRef)
    || !isNonEmptyString(moduleRef.profileId)
    || !moduleRef.profileId.endsWith(":tactical-map-v1")) return undefined;
  const feature = currentTacticalFeature(state, actorCharacterId, featureId);
  return (feature?.kind === "portal" || feature?.kind === "destructible")
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
  const actorCharacterId = input.actorCharacterId as string;
  const featureId = input.featureId as string;
  const feature = publicPortal(state, actorCharacterId, featureId);
  if (feature === undefined) {
    return rejected("privateOrUnknownReference", "The environment feature is unavailable.");
  }
  const transition = transitionFor(feature, input.intent as PortalIntent);
  if (transition === undefined) {
    return rejected("worldLawViolation", "The requested environment transition is unavailable.");
  }
  const actor = state.entities[actorCharacterId];
  const payload: EventPayloadByType["EnvironmentFeatureStateChanged"] = {
    actorCharacterId,
    sceneId: actor.sceneId,
    featureId,
    definitionId: feature.stateGraph!.definitionId,
    intent: input.intent as PortalIntent,
    fromState: feature.state,
    toState: transition.toState,
  };
  const scopeProof = createScopeProof(
    state,
    [
      `control:${actorCharacterId}`,
      `scene:${actor.sceneId}`,
      `environment-definition:${feature.stateGraph!.definitionId}`,
    ],
    [`environment-feature:${featureId}`, `receipt:${input.rootActionId as string}`],
    [],
  );
  const transitionResult = createEventTransition(state, profiles, {
    rootActionId: input.rootActionId as string,
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
  if (eventType === "EnvironmentFeatureDamaged") {
    return validateEnvironmentDamagePayload(value);
  }
  return eventType === "EnvironmentFeatureStateChanged"
    && isRecord(value)
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
    && (value.intent === "open" || value.intent === "close")
    && value.fromState !== value.toState;
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
    const graph = feature?.stateGraph;
    const durability = feature?.durability;
    if (!compiled.ok
      || compiled.artifact.definitionHash !== payload.abilityDefinitionHash
      || compiled.artifact.compiledHash !== payload.compiledHash
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
    const damageTransition = graph.damageTransitions?.find((candidate) =>
      candidate.fromState === payload.fromState
      && expectedAfter <= BigInt(candidate.remainingDurabilityAtOrBelow));
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
  if (feature?.kind !== "portal"
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
