import { RulesValidationError } from "../errors";
import type {
  AuthoritativeWorldState,
  EventEnvelope,
  EventPayloadByType,
  EventType,
  JsonRecord,
} from "./model";
import { fictionTimelineIdForScene } from "./multiplayer-model";
import { timePassageTimelineId, longSpellcastingTimelineId } from "./time-passage-binding";
import { allocateDynamicCombatantSpawn } from "./spatial-spawn";
import { isDynamicLocationScene, resolvePassageTraversal, passageTraversalMatches, passageActivityBinding,
  type PassageTraversalBinding } from "./dynamic-locations";

export type MovementPlan = {
  sourceTimelineId: string;
  destinationTimelineId: string;
  departureMicros: string;
  arrivalMicros: string;
  passage?: PassageTraversalBinding;
  activityId?: string;
};

function requiresPassage(state: AuthoritativeWorldState, actorIds: readonly string[], destination: string): boolean {
  return isDynamicLocationScene(state, destination) || actorIds.some(id => isDynamicLocationScene(state, state.entities[id]?.sceneId ?? ""));
}

function passageActivityDue(state: AuthoritativeWorldState, actorId: string, activityId: string,
  passage: PassageTraversalBinding, completed: boolean): boolean {
  const activity = state.campaignRuntime.activities[activityId], timeline = characterTimelineId(state, actorId);
  const binding = passageActivityBinding(activity);
  return activity !== undefined && activity.characterId === actorId && activity.status === (completed ? "completed" : "active")
    && binding !== undefined && binding.passageRef === passage.passageRef && binding.passageHash === passage.passageHash
    && binding.sourceSceneRef === passage.sourceSceneRef && binding.destinationSceneRef === passage.destinationSceneRef
    && binding.travelDurationMicros === passage.travelDurationMicros && activity.intendedDurationMicros === passage.travelDurationMicros
    && typeof activity.startedAtFictionMicros === "string" && /^(0|[1-9][0-9]*)$/.test(activity.startedAtFictionMicros)
    && timeline !== undefined && BigInt(state.fictionTimelines[timeline].nowMicros)
      >= BigInt(activity.startedAtFictionMicros) + BigInt(passage.travelDurationMicros);
}

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
  const effect = payload.effect;
  if (effect !== null && typeof effect === "object" && !Array.isArray(effect)) {
    const target = (effect as JsonRecord).targetEntityId;
    if (typeof target === "string" && target in state.entities) return target;
  }
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
    payload.targetEntityId,
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
  // A review stays on the obligation's frozen timeline even if a participant
  // has since joined another scene whose clock is further ahead.
  const promiseId = _eventType === "PromiseReviewed" || _eventType === "PromiseChanged" ? record.promiseId
    : _eventType === "CanonicalFactDeclared" && record.fact !== null && typeof record.fact === "object" && !Array.isArray(record.fact)
      && ["promiseReviewResult", "promiseTermsResult"].includes(String((record.fact as JsonRecord).kind))
      ? ((record.fact as JsonRecord).value as JsonRecord)?.promiseId : undefined;
  if (typeof promiseId === "string") {
    const life = state.campaignRuntime.promises[promiseId]?.lifecycle as JsonRecord | undefined;
    if (life?.schema === "zhuwei.promise-lifecycle/vnext-1" && typeof life.timelineId === "string"
      && life.timelineId in state.fictionTimelines) return life.timelineId;
  }
  if (_eventType === "PromiseTermsEstablished" && typeof record.timelineId === "string"
    && record.timelineId in state.fictionTimelines) return record.timelineId;
  if (["FictionTimeAdvanced", "ActivityInterrupted", "ActivityCompleted", "ActivityAttentionRequested", "ActivityAttentionAcknowledged"].includes(_eventType)
    && typeof record.activityId === "string") {
    const activity = state.campaignRuntime.activities[record.activityId];
    const timeline = timePassageTimelineId(state, activity) ?? longSpellcastingTimelineId(state, activity)
      ?? (activity === undefined ? undefined : characterTimelineId(state, String(activity.characterId)));
    if (timeline !== undefined) return timeline;
  }
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
    || event.eventType === "KnowledgeReviewed"
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
  if (timeline === undefined) throw new RulesValidationError("event fiction timeline is unavailable");
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
  passageRef?: string,
): MovementPlan | undefined {
  if (!(destinationSceneId in state.scenes) || !/^[1-9][0-9]*$/.test(durationMicros)) return undefined;
  const passage = passageRef === undefined ? undefined : resolvePassageTraversal(state, characterIds[0], passageRef);
  if (passageRef !== undefined && (passage === undefined || passage.destinationSceneRef !== destinationSceneId
    || durationMicros !== passage.travelDurationMicros || !passageTraversalMatches(state, characterIds, passage))) return undefined;
  if (passage === undefined && requiresPassage(state, characterIds, destinationSceneId)) return undefined;
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
  return { sourceTimelineId, destinationTimelineId, departureMicros, arrivalMicros, ...(passage === undefined ? {} : { passage }) };
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
  passage?: PassageTraversalBinding,
  activityId?: string,
): MovementPlan | undefined {
  if (!(destinationSceneId in state.scenes)) return undefined;
  if (passage === undefined && requiresPassage(state, [characterId], destinationSceneId)) return undefined;
  if (passage !== undefined && (passage.destinationSceneRef !== destinationSceneId || activityId === undefined
    || !passageTraversalMatches(state, [characterId], passage) || !passageActivityDue(state, characterId, activityId, passage, false))) return undefined;
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
    ...(passage === undefined ? {} : { passage, activityId }),
  };
}

/**
 * SPEC 0006 §7: the timeline an arriving NPC joins. Characters already in the
 * destination keep their clock and the NPC takes theirs (a player's first,
 * then the latest clock, then the smallest id); an empty scene uses its own.
 */
export function npcArrivalTimelineId(state: AuthoritativeWorldState, npcId: string, destinationSceneId: string): string {
  const present = Object.values(state.entities).filter((entity) => entity.id !== npcId
    && entity.sceneId === destinationSceneId && entity.tenureStatus === "active");
  const ranked = [...new Set(present.flatMap((entity) => {
    const timelineId = characterTimelineId(state, entity.id);
    return timelineId === undefined ? [] : [timelineId];
  }))].map((timelineId) => ({
    timelineId,
    player: present.some((entity) => entity.kind === "player" && characterTimelineId(state, entity.id) === timelineId),
    now: BigInt(state.fictionTimelines[timelineId].nowMicros),
  })).sort((left, right) => Number(right.player) - Number(left.player)
    || (left.now > right.now ? -1 : left.now < right.now ? 1 : 0)
    || (left.timelineId < right.timelineId ? -1 : left.timelineId > right.timelineId ? 1 : 0));
  return ranked[0]?.timelineId ?? sceneTimelineId(state, destinationSceneId);
}

/**
 * SPEC 0006 §7: an NPC leaves at its own clock and is in the destination from
 * the move on. It arrives after the travel time, or at the destination's own
 * clock when that is later (the way took it longer); like any arrival it may
 * bring an earlier destination clock forward. A passage fixes its own time.
 */
export function npcMovementPlan(
  state: AuthoritativeWorldState,
  npcId: string,
  destinationSceneId: string,
  travelDurationMicros: string,
  passage?: PassageTraversalBinding,
): MovementPlan | undefined {
  const npc = state.entities[npcId];
  if (npc?.kind !== "npc" || npc.tenureStatus !== "active" || npc.sceneId === destinationSceneId
    || !(destinationSceneId in state.scenes) || !/^(0|[1-9][0-9]*)$/.test(travelDurationMicros)) return undefined;
  if (passage === undefined ? requiresPassage(state, [npcId], destinationSceneId)
    : passage.destinationSceneRef !== destinationSceneId || passage.travelDurationMicros !== travelDurationMicros
      || !passageTraversalMatches(state, [npcId], passage)) return undefined;
  const combatEntity = state.combatRuntime.entities[npcId];
  if (combatEntity !== undefined && (combatEntity.sceneId !== npc.sceneId
    || allocateDynamicCombatantSpawn(state, destinationSceneId).kind === "unavailable")) return undefined;
  const sourceTimelineId = characterTimelineId(state, npcId);
  if (sourceTimelineId === undefined) return undefined;
  const destinationTimelineId = npcArrivalTimelineId(state, npcId, destinationSceneId);
  const departureMicros = state.fictionTimelines[sourceTimelineId].nowMicros;
  const travelled = BigInt(departureMicros) + BigInt(travelDurationMicros);
  const existing = state.fictionTimelines[destinationTimelineId];
  const arrivalMicros = destinationTimelineId === sourceTimelineId ? departureMicros
    : existing !== undefined && BigInt(existing.nowMicros) > travelled ? existing.nowMicros : travelled.toString();
  return { sourceTimelineId, destinationTimelineId, departureMicros, arrivalMicros, ...(passage === undefined ? {} : { passage }) };
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
    throw new RulesValidationError("movement source timeline changed");
  }
  // SPEC 0006 §7: an NPC's own move may arrive later than its way takes,
  // never earlier, and joins its destination's clock without resetting it.
  const npcMove = plan.activityId === undefined && characterIds.length === 1
    && state.entities[characterIds[0]]?.kind === "npc";
  if (npcMove && BigInt(plan.arrivalMicros) < BigInt(plan.departureMicros)) {
    throw new RulesValidationError("movement arrives before it departs");
  }
  if (plan.passage === undefined) {
    if (plan.activityId !== undefined || requiresPassage(state, characterIds, destinationSceneId)) throw new RulesValidationError("passage:explicit-connection-required");
  } else {
    const elapsed = BigInt(plan.arrivalMicros) - BigInt(plan.departureMicros);
    const travel = BigInt(plan.passage.travelDurationMicros);
    if (plan.passage.destinationSceneRef !== destinationSceneId || !passageTraversalMatches(state, characterIds, plan.passage)
      || (plan.activityId === undefined
        ? npcMove ? elapsed < travel && plan.sourceTimelineId !== plan.destinationTimelineId : elapsed !== travel
        : elapsed !== 0n || characterIds.length !== 1 || !passageActivityDue(state, characterIds[0], plan.activityId, plan.passage, true))) {
      throw new RulesValidationError("passage:frozen-traversal-or-paid-duration-invalid");
    }
  }
  const existing = state.fictionTimelines[plan.destinationTimelineId];
  if (existing === undefined) {
    state.fictionTimelines[plan.destinationTimelineId] = {
      branchId: state.activeBranchId,
      nowMicros: plan.arrivalMicros,
    };
  } else if (BigInt(existing.nowMicros) > BigInt(plan.arrivalMicros)) {
    throw new RulesValidationError("movement destination causal frontier conflicts");
  } else {
    existing.nowMicros = plan.arrivalMicros;
  }
  for (const characterId of characterIds) {
    const character = state.entities[characterId];
    if (character === undefined || characterTimelineId(state, characterId) !== plan.sourceTimelineId) {
      throw new RulesValidationError("movement character left the frozen timeline");
    }
    const combatEntity = state.combatRuntime.entities[characterId];
    if (combatEntity !== undefined) {
      if (combatEntity.sceneId !== character.sceneId) {
        throw new RulesValidationError("movement character tactical scene is stale");
      }
      if (character.sceneId !== destinationSceneId) {
        const spawn = allocateDynamicCombatantSpawn(state, destinationSceneId);
        if (spawn.kind === "unavailable") {
          throw new RulesValidationError("movement destination has no available tactical spawn");
        }
        combatEntity.sceneId = destinationSceneId;
        combatEntity.position = structuredClone(spawn.position);
      }
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
  const joined = state.multiplayerRuntime.causalFrontiers[plan.destinationTimelineId];
  // An NPC joining characters already there keeps what their frontier had
  // received; only its own departure becomes one more causal parent.
  state.multiplayerRuntime.causalFrontiers[plan.destinationTimelineId] = npcMove && joined !== undefined
    ? { ...structuredClone(joined), ...frontier, causalParentTimelineIds: [...new Set([
      ...(Array.isArray(joined.causalParentTimelineIds) ? joined.causalParentTimelineIds.filter((id): id is string => typeof id === "string") : []),
      plan.sourceTimelineId])].sort() }
    : frontier;
}
