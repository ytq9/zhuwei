import type {
  AuthoritativeWorldState,
  EventEnvelope,
  EventPayloadByType,
  EventType,
  JsonRecord,
} from "./model";
import { fictionTimelineIdForScene } from "./multiplayer-model";

export type MovementPlan = {
  sourceTimelineId: string;
  destinationTimelineId: string;
  departureMicros: string;
  arrivalMicros: string;
};

export function characterTimelineId(
  state: AuthoritativeWorldState,
  characterId: string,
): string | undefined {
  const timelineId = state.multiplayerRuntime.characterTimelineIds[characterId] ?? state.activeBranchId;
  return timelineId in state.fictionTimelines ? timelineId : undefined;
}

export function sceneTimelineId(state: AuthoritativeWorldState, sceneId: string): string {
  return fictionTimelineIdForScene(state.activeBranchId, sceneId);
}

function payloadCharacterId(state: AuthoritativeWorldState, payload: JsonRecord): string | undefined {
  const direct = [
    payload.actorCharacterId,
    payload.characterId,
    payload.sourceCharacterId,
    payload.initiatorId,
    payload.triggeringEntityId,
    payload.sourceEntityId,
    payload.leaderCharacterId,
    payload.npcId,
    payload.actingNpcId,
    payload.targetId,
  ].find((value) => typeof value === "string" && value in state.entities);
  if (typeof direct === "string") return direct;
  if (typeof payload.activityId === "string") {
    const activityCharacterId = state.campaignRuntime.activities[payload.activityId]?.characterId;
    if (typeof activityCharacterId === "string" && activityCharacterId in state.entities) {
      return activityCharacterId;
    }
  }
  if (typeof payload.pendingInputId === "string") {
    const pendingCharacterId = state.pendingInputs[payload.pendingInputId]?.controllerCharacterId;
    if (pendingCharacterId !== undefined) return pendingCharacterId;
  }
  return undefined;
}

export function eventFictionTimelineId(
  state: AuthoritativeWorldState,
  _eventType: EventType,
  payload: EventPayloadByType[EventType],
  rootActionId: string,
): string {
  const record = payload as JsonRecord;
  if (typeof record.sourceTimelineId === "string"
    && record.sourceTimelineId in state.fictionTimelines) {
    return record.sourceTimelineId;
  }
  if (typeof record.meetingTimelineId === "string"
    && record.meetingTimelineId in state.fictionTimelines) {
    return record.meetingTimelineId;
  }
  const subject = payloadCharacterId(state, record)
    ?? state.receipts[rootActionId]?.subjectCharacterIds[0];
  const subjectTimeline = subject === undefined ? undefined : characterTimelineId(state, subject);
  if (subjectTimeline !== undefined) return subjectTimeline;

  if (typeof record.encounterId === "string") {
    const sceneId = state.combatRuntime.encounters[record.encounterId]?.sceneId;
    if (typeof sceneId === "string") {
      const timelineId = sceneTimelineId(state, sceneId);
      if (timelineId in state.fictionTimelines) return timelineId;
    }
  }
  return state.activeBranchId;
}

function spotlightSubject(state: AuthoritativeWorldState, event: EventEnvelope): string | undefined {
  const characterId = payloadCharacterId(state, event.payload as JsonRecord);
  return characterId !== undefined
    && state.entities[characterId]?.kind === "player"
    && state.characterControls[characterId] !== undefined
    ? characterId
    : undefined;
}

export function recordSpotlightDecision(
  state: AuthoritativeWorldState,
  event: EventEnvelope,
  firstEventForRoot: boolean,
): void {
  if (!firstEventForRoot
    || event.secrecy === "internal"
    || event.eventType === "SafetyPauseRequested"
    || event.eventType === "SafetyPresentationAdjusted") return;
  const actorCharacterId = spotlightSubject(state, event);
  if (actorCharacterId === undefined) return;
  const activeCharacterIds = Object.keys(state.characterControls)
    .filter((characterId) => state.entities[characterId]?.kind === "player"
      && state.entities[characterId]?.tenureStatus === "active")
    .sort();
  if (activeCharacterIds.length === 0) return;
  for (const characterId of activeCharacterIds) {
    const control = state.characterControls[characterId];
    state.multiplayerRuntime.spotlightLedger[characterId] ??= {
      characterId,
      seatId: control.seatId,
      decisionBeats: "0",
      invited: false,
      lastInvitedBeat: null,
      explicitSkips: "0",
      sceneId: state.entities[characterId].sceneId,
    };
  }
  const minimum = activeCharacterIds.reduce((current, characterId) => {
    const beat = BigInt(String(state.multiplayerRuntime.spotlightLedger[characterId].decisionBeats));
    return beat < current ? beat : current;
  }, BigInt(String(state.multiplayerRuntime.spotlightLedger[activeCharacterIds[0]].decisionBeats)));
  const actor = state.multiplayerRuntime.spotlightLedger[actorCharacterId];
  const attempted = BigInt(String(actor.decisionBeats)) + 1n;
  actor.decisionBeats = (attempted > minimum + 3n ? minimum + 3n : attempted).toString();
  actor.invited = false;
  actor.sceneId = state.entities[actorCharacterId].sceneId;
  if (attempted >= minimum + 3n) {
    for (const characterId of activeCharacterIds) {
      if (characterId === actorCharacterId) continue;
      const entry = state.multiplayerRuntime.spotlightLedger[characterId];
      if (BigInt(String(entry.decisionBeats)) === minimum) {
        entry.invited = true;
        entry.lastInvitedBeat = actor.decisionBeats;
      }
    }
  }
}

export function recordCausalFrontier(state: AuthoritativeWorldState, event: EventEnvelope): void {
  const timeline = state.fictionTimelines[event.fictionTimelineId];
  if (timeline === undefined) throw new TypeError("event fiction timeline is unavailable");
  const previous = state.multiplayerRuntime.causalFrontiers[event.fictionTimelineId];
  const mappedCharacter = Object.keys(state.multiplayerRuntime.characterTimelineIds)
    .sort()
    .find((characterId) =>
      state.multiplayerRuntime.characterTimelineIds[characterId] === event.fictionTimelineId);
  const sceneId = typeof previous?.sceneId === "string"
    ? previous.sceneId
    : mappedCharacter === undefined
      ? Object.keys(state.scenes).sort()[0] ?? "scene:unknown"
      : state.entities[mappedCharacter].sceneId;
  state.multiplayerRuntime.causalFrontiers[event.fictionTimelineId] = {
    ...(previous === undefined ? {} : structuredClone(previous)),
    timelineId: event.fictionTimelineId,
    sceneId,
    branchId: timeline.branchId,
    nowMicros: timeline.nowMicros,
    eventHeadId: event.eventId,
  };
}

export function movementPlan(
  state: AuthoritativeWorldState,
  characterIds: string[],
  destinationSceneId: string,
  durationMicros: string,
): MovementPlan | undefined {
  if (!(destinationSceneId in state.scenes) || !/^[1-9][0-9]*$/.test(durationMicros)) return undefined;
  const sourceIds = [...new Set(characterIds.map((characterId) => characterTimelineId(state, characterId)))];
  if (sourceIds.length !== 1 || sourceIds[0] === undefined) return undefined;
  const sourceTimelineId = sourceIds[0];
  const source = state.fictionTimelines[sourceTimelineId];
  const departureMicros = source.nowMicros;
  const arrivalMicros = (BigInt(departureMicros) + BigInt(durationMicros)).toString();
  const destinationTimelineId = sceneTimelineId(state, destinationSceneId);
  const existing = state.fictionTimelines[destinationTimelineId];
  // Arrival may advance a destination whose causal frontier is still earlier.
  // It may never enter a destination whose frontier is already in the future;
  // that case requires an explicit wait/meeting synchronization decision.
  if (existing !== undefined && BigInt(existing.nowMicros) > BigInt(arrivalMicros)) return undefined;
  return { sourceTimelineId, destinationTimelineId, departureMicros, arrivalMicros };
}

/**
 * Relocates an actor whose travel time was already paid by an Activity.  The
 * completion event changes the actor's scene at the current causal frontier;
 * it must not charge the frozen duration a second time.
 */
export function completedActivityMovementPlan(
  state: AuthoritativeWorldState,
  characterId: string,
  destinationSceneId: string,
): MovementPlan | undefined {
  if (!(destinationSceneId in state.scenes)) return undefined;
  const sourceTimelineId = characterTimelineId(state, characterId);
  if (sourceTimelineId === undefined) return undefined;
  const departureMicros = state.fictionTimelines[sourceTimelineId]?.nowMicros;
  if (departureMicros === undefined) return undefined;
  const destinationTimelineId = sceneTimelineId(state, destinationSceneId);
  const existing = state.fictionTimelines[destinationTimelineId];
  if (existing !== undefined && BigInt(existing.nowMicros) > BigInt(departureMicros)) return undefined;
  return {
    sourceTimelineId,
    destinationTimelineId,
    departureMicros,
    arrivalMicros: departureMicros,
  };
}

export function applyMovement(
  state: AuthoritativeWorldState,
  eventId: string,
  characterIds: string[],
  destinationSceneId: string,
  plan: MovementPlan,
): void {
  const source = state.fictionTimelines[plan.sourceTimelineId];
  if (source === undefined || source.nowMicros !== plan.departureMicros) {
    throw new TypeError("movement source timeline changed");
  }
  const existing = state.fictionTimelines[plan.destinationTimelineId];
  if (existing === undefined) {
    state.fictionTimelines[plan.destinationTimelineId] = {
      branchId: state.activeBranchId,
      nowMicros: plan.arrivalMicros,
    };
  } else if (BigInt(existing.nowMicros) > BigInt(plan.arrivalMicros)) {
    throw new TypeError("movement destination causal frontier conflicts");
  } else {
    existing.nowMicros = plan.arrivalMicros;
  }
  for (const characterId of characterIds) {
    const character = state.entities[characterId];
    if (character === undefined || characterTimelineId(state, characterId) !== plan.sourceTimelineId) {
      throw new TypeError("movement character left the frozen timeline");
    }
    character.sceneId = destinationSceneId;
    state.multiplayerRuntime.characterTimelineIds[characterId] = plan.destinationTimelineId;
  }
  const frontier: JsonRecord = {
    timelineId: plan.destinationTimelineId,
    sceneId: destinationSceneId,
    branchId: state.activeBranchId,
    nowMicros: plan.arrivalMicros,
    eventHeadId: eventId,
    causalParentTimelineIds: [plan.sourceTimelineId],
  };
  state.multiplayerRuntime.causalFrontiers[plan.destinationTimelineId] = frontier;
}
