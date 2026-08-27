import type { RuntimeProfileManifest } from "../profiles/types";
import { createEventTransition, createScopeProof } from "./events";
import type {
  AuthoritativeWorldState,
  EventEnvelope,
  EventPayloadByType,
  EventType,
  JsonRecord,
  SafetyPresentationAdjustment,
  StepResult,
} from "./model";
import { rejected } from "./results";
import {
  hasExactKeys,
  isNonEmptyString,
} from "./validation";

export const SAFETY_EVENT_TYPES = [
  "SafetyPauseRequested",
  "SafetyPresentationAdjusted",
] as const satisfies readonly EventType[];

const PRESENTATION_ADJUSTMENTS = new Set<SafetyPresentationAdjustment>([
  "fadeToBlack",
  "reduceDetail",
  "skipSensitiveContent",
]);

export function hasActiveSafetyPause(state: AuthoritativeWorldState): boolean {
  return Object.values(state.multiplayerRuntime.safetyPresentations)
    .some((entry) => entry.status === "paused");
}

function controlledByRequester(
  state: AuthoritativeWorldState,
  requesterPrincipalId: unknown,
  actorCharacterId: unknown,
): requesterPrincipalId is string {
  if (!isNonEmptyString(requesterPrincipalId) || !isNonEmptyString(actorCharacterId)) {
    return false;
  }
  const character = state.entities[actorCharacterId];
  const control = state.characterControls[actorCharacterId];
  const seat = control === undefined ? undefined : state.seats[control.seatId];
  return character?.kind === "player"
    && character.tenureStatus === "active"
    && seat?.status === "active"
    && seat.principalId === requesterPrincipalId
    && state.principals[requesterPrincipalId] !== undefined;
}

function freshRootAction(state: AuthoritativeWorldState, rootActionId: unknown): string | undefined {
  return isNonEmptyString(rootActionId) && !(rootActionId in state.receipts)
    ? rootActionId
    : undefined;
}

function requestSafetyPause(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, [
    "kind",
    "actorCharacterId",
    "requesterPrincipalId",
    "rootActionId",
  ])) {
    return rejected("invalidRulesInput", "Safety pause accepts no reason or free-form content.");
  }
  const rootActionId = freshRootAction(state, input.rootActionId);
  if (rootActionId === undefined) {
    return rejected("duplicateRootAction", "The safety pause root action is unavailable.");
  }
  if (!controlledByRequester(state, input.requesterPrincipalId, input.actorCharacterId)) {
    return rejected("viewerUnauthorized", "The safety request controller is unavailable.");
  }
  const actorCharacterId = input.actorCharacterId as string;
  const requesterPrincipalId = input.requesterPrincipalId as string;
  if (state.multiplayerRuntime.safetyPresentations[requesterPrincipalId]?.status === "paused") {
    return rejected("presentationUnavailable", "Presentation is unavailable at the stable state.");
  }
  const payload: EventPayloadByType["SafetyPauseRequested"] = {
    requesterPrincipalId,
    actorCharacterId,
  };
  const scopeProof = createScopeProof(
    state,
    [`control:${actorCharacterId}`, `principal:${requesterPrincipalId}`],
    [`receipt:${rootActionId}`, `safety-presentation:${requesterPrincipalId}`],
    [],
  );
  const transition = createEventTransition(state, profiles, {
    rootActionId,
    eventType: "SafetyPauseRequested",
    payload,
    scopeProof,
    visibilityPolicyId: `visibility:principal:${requesterPrincipalId}`,
    secrecy: "private",
  });
  return {
    kind: "committed",
    events: [transition.event],
    state: transition.state,
    cache: transition.state,
    stateHash: transition.event.stateHashAfter,
    scopeProof,
    receipt: transition.receipt,
  };
}

function adjustSafetyPresentation(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, [
    "kind",
    "presentationAdjustment",
    "actorCharacterId",
    "requesterPrincipalId",
    "rootActionId",
  ])) {
    return rejected("invalidRulesInput", "Safety adjustment must use the closed presentation schema.");
  }
  const rootActionId = freshRootAction(state, input.rootActionId);
  if (rootActionId === undefined) {
    return rejected("duplicateRootAction", "The safety adjustment root action is unavailable.");
  }
  if (!controlledByRequester(state, input.requesterPrincipalId, input.actorCharacterId)) {
    return rejected("viewerUnauthorized", "The safety request controller is unavailable.");
  }
  if (!PRESENTATION_ADJUSTMENTS.has(input.presentationAdjustment as SafetyPresentationAdjustment)) {
    return rejected("invalidRulesInput", "The presentation adjustment is not registered.");
  }
  const actorCharacterId = input.actorCharacterId as string;
  const requesterPrincipalId = input.requesterPrincipalId as string;
  const active = state.multiplayerRuntime.safetyPresentations[requesterPrincipalId];
  if (active?.status !== "paused"
    || active.requesterPrincipalId !== requesterPrincipalId) {
    return rejected("presentationUnavailable", "The private safety adjustment is unavailable.");
  }
  const payload: EventPayloadByType["SafetyPresentationAdjusted"] = {
    requesterPrincipalId,
    actorCharacterId,
    presentationAdjustment: input.presentationAdjustment as SafetyPresentationAdjustment,
  };
  const scopeProof = createScopeProof(
    state,
    [
      `control:${actorCharacterId}`,
      `principal:${requesterPrincipalId}`,
      `safety-presentation:${requesterPrincipalId}`,
    ],
    [`receipt:${rootActionId}`, `safety-presentation:${requesterPrincipalId}`],
    [],
  );
  const transition = createEventTransition(state, profiles, {
    rootActionId,
    eventType: "SafetyPresentationAdjusted",
    payload,
    scopeProof,
    visibilityPolicyId: `visibility:principal:${requesterPrincipalId}`,
    secrecy: "private",
  });
  return {
    kind: "committed",
    events: [transition.event],
    state: transition.state,
    cache: transition.state,
    stateHash: transition.event.stateHashAfter,
    scopeProof,
    receipt: transition.receipt,
  };
}

/** Safety is checked before activity settlement so a pause never advances fiction. */
export function stepSafetyWorld(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  if (input.kind === "requestSafetyPause") {
    return requestSafetyPause(profiles, state, input);
  }
  if (input.kind === "adjustSafetyPresentation") {
    return adjustSafetyPresentation(profiles, state, input);
  }
  return hasActiveSafetyPause(state)
    ? rejected("presentationUnavailable", "Presentation is unavailable at the stable state.")
    : undefined;
}

export function validateSafetyEventPayload(eventType: EventType, value: JsonRecord): boolean {
  if (eventType === "SafetyPauseRequested") {
    return hasExactKeys(value, ["actorCharacterId", "requesterPrincipalId"])
      && isNonEmptyString(value.actorCharacterId)
      && isNonEmptyString(value.requesterPrincipalId);
  }
  if (eventType === "SafetyPresentationAdjusted") {
    return hasExactKeys(value, [
      "presentationAdjustment",
      "actorCharacterId",
      "requesterPrincipalId",
    ])
      && isNonEmptyString(value.actorCharacterId)
      && isNonEmptyString(value.requesterPrincipalId)
      && PRESENTATION_ADJUSTMENTS.has(value.presentationAdjustment as SafetyPresentationAdjustment);
  }
  return false;
}

export function applySafetyEvent(
  state: AuthoritativeWorldState,
  event: EventEnvelope,
): boolean {
  if (event.eventType === "SafetyPauseRequested") {
    const payload = event.payload as EventPayloadByType["SafetyPauseRequested"];
    const prior = state.multiplayerRuntime.safetyPresentations[payload.requesterPrincipalId];
    state.multiplayerRuntime.safetyPresentations[payload.requesterPrincipalId] = {
      requesterPrincipalId: payload.requesterPrincipalId,
      status: "paused",
      presentationAdjustment: prior?.presentationAdjustment ?? null,
    };
    return true;
  }
  if (event.eventType === "SafetyPresentationAdjusted") {
    const payload = event.payload as EventPayloadByType["SafetyPresentationAdjusted"];
    const active = state.multiplayerRuntime.safetyPresentations[payload.requesterPrincipalId];
    if (active?.status !== "paused"
      || active.requesterPrincipalId !== payload.requesterPrincipalId) {
      throw new TypeError("safety presentation adjustment has no matching private pause");
    }
    state.multiplayerRuntime.safetyPresentations[payload.requesterPrincipalId] = {
      requesterPrincipalId: payload.requesterPrincipalId,
      status: "resumed",
      presentationAdjustment: payload.presentationAdjustment,
    };
    return true;
  }
  return false;
}
