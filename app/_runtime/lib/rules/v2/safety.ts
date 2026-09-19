import { RulesValidationError } from "../errors";
import type {
  AuthoritativeWorldState,
  EventEnvelope,
  EventPayloadByType,
  EventType,
  JsonRecord,
  SafetyPresentationAdjustment,
} from "./model";
import {
  hasExactKeys,
  isNonEmptyString,
} from "./validation";

/** The content safety pause left the product on 2026-09-19 (ADR 0032). Rooms
 * whose logs already hold these events still replay them into the inert
 * `safetyPresentations` slot; nothing produces them any more. */
export const SAFETY_EVENT_TYPES = [
  "SafetyPauseRequested",
  "SafetyPresentationAdjusted",
] as const satisfies readonly EventType[];

const PRESENTATION_ADJUSTMENTS = new Set<SafetyPresentationAdjustment>([
  "fadeToBlack",
  "reduceDetail",
  "skipSensitiveContent",
]);

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
      throw new RulesValidationError("safety presentation adjustment has no matching private pause");
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
