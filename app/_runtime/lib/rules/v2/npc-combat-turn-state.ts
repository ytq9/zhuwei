import { RulesValidationError } from "../errors";
import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState, DueActivityDescriptor, EventEnvelope, JsonRecord } from "./model";
import { characterTimelineId } from "./timeline";
import { hasExactKeys, isNonEmptyString, isRecord } from "./validation";

/** SPEC 0002 §17: an NPC's combat turn is proposed from its own view and
 * carried out by Rules as one root. These are the plan's shapes, the internal
 * events that hold it while dice or a player's answer are awaited, and the due
 * obligation that asks for it when the NPC's turn comes. */

export const NPC_COMBAT_TURN_ROOT_PREFIX = "npc-turn:";
export const NPC_COMBAT_TURN_MAX_STEPS = 8;
export const NPC_READY_EVENTS = ["turnStarted", "movementCommitted", "spellCastingStarted"] as const;
export const NPC_BASIC_ACTIONS = ["dash", "dodge", "disengage", "hide", "search"] as const;

export type NpcCombatTurnPoint = { x: string; y: string };
export type NpcCombatTurnDestination = { kind: "nextTo"; ref: string } | ({ kind: "point" } & NpcCombatTurnPoint);
export type NpcCombatTurnTarget = { kind: "creature"; ref: string } | ({ kind: "point" } & NpcCombatTurnPoint) | { kind: "none" };
export type NpcCombatTurnStep =
  | { kind: "move"; to: NpcCombatTurnDestination }
  | { kind: "ability"; abilityRef: string; target: NpcCombatTurnTarget }
  | { kind: "basic"; action: typeof NPC_BASIC_ACTIONS[number] }
  | { kind: "basic"; action: "help"; allyRef: string; enemyRef: string | null }
  | { kind: "ready"; trigger: { ref: string; event: typeof NPC_READY_EVENTS[number] };
      response: { kind: "move"; to: NpcCombatTurnDestination } | { kind: "ability"; abilityRef: string; target: NpcCombatTurnTarget } }
  | { kind: "endTurn" };

/** The plan Rules holds while its root waits on dice or a pending answer. */
export type NpcCombatTurnPlanRecord = {
  rootActionId: string;
  encounterId: string;
  npcId: string;
  steps: NpcCombatTurnStep[];
  nextStep: number;
};

export type NpcCombatTurnPlannedPayload = { rootActionId: string; encounterId: string; npcCharacterId: string; steps: NpcCombatTurnStep[] };
export type NpcCombatTurnStepTakenPayload = { rootActionId: string; npcCharacterId: string; stepIndex: number };
export type NpcCombatTurnSettledPayload = { rootActionId: string; npcCharacterId: string; outcome: "completed" | "stopped";
  stoppedAtStep: number | null; reason: string | null };

export type NpcCombatTurnDue = { encounterId: string; npcId: string; round: string; turnIndex: string; segment: string };

const ref = (value: unknown): value is string => isNonEmptyString(value) && value.length <= 300 && /^\S+$/u.test(value);
const coordinate = (value: unknown): value is string => typeof value === "string" && /^-?(0|[1-9][0-9]{0,9})$/u.test(value);

function isPoint(value: JsonRecord): boolean {
  return coordinate(value.x) && coordinate(value.y);
}

export function isNpcCombatTurnDestination(value: unknown): value is NpcCombatTurnDestination {
  if (!isRecord(value)) return false;
  if (value.kind === "nextTo") return hasExactKeys(value, ["kind", "ref"]) && ref(value.ref);
  return value.kind === "point" && hasExactKeys(value, ["kind", "x", "y"]) && isPoint(value);
}

export function isNpcCombatTurnTarget(value: unknown): value is NpcCombatTurnTarget {
  if (!isRecord(value)) return false;
  if (value.kind === "creature") return hasExactKeys(value, ["kind", "ref"]) && ref(value.ref);
  if (value.kind === "point") return hasExactKeys(value, ["kind", "x", "y"]) && isPoint(value);
  return value.kind === "none" && hasExactKeys(value, ["kind"]);
}

export function isNpcCombatTurnStep(value: unknown): value is NpcCombatTurnStep {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "move": return hasExactKeys(value, ["kind", "to"]) && isNpcCombatTurnDestination(value.to);
    case "ability": return hasExactKeys(value, ["abilityRef", "kind", "target"]) && ref(value.abilityRef)
      && isNpcCombatTurnTarget(value.target);
    case "basic":
      if (value.action === "help") return hasExactKeys(value, ["action", "allyRef", "enemyRef", "kind"]) && ref(value.allyRef)
        && (value.enemyRef === null || ref(value.enemyRef));
      return hasExactKeys(value, ["action", "kind"]) && (NPC_BASIC_ACTIONS as readonly unknown[]).includes(value.action);
    case "ready": {
      const trigger = value.trigger, response = value.response;
      return hasExactKeys(value, ["kind", "response", "trigger"]) && isRecord(trigger) && hasExactKeys(trigger, ["event", "ref"])
        && ref(trigger.ref) && (NPC_READY_EVENTS as readonly unknown[]).includes(trigger.event) && isRecord(response)
        && ((response.kind === "move" && hasExactKeys(response, ["kind", "to"]) && isNpcCombatTurnDestination(response.to))
          || (response.kind === "ability" && hasExactKeys(response, ["abilityRef", "kind", "target"]) && ref(response.abilityRef)
            && isNpcCombatTurnTarget(response.target)));
    }
    case "endTurn": return hasExactKeys(value, ["kind"]);
    default: return false;
  }
}

/** A plan is a short ordered list that ends the turn exactly once, at its end. */
export function isNpcCombatTurnSteps(value: unknown): value is NpcCombatTurnStep[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= NPC_COMBAT_TURN_MAX_STEPS
    && value.every(isNpcCombatTurnStep)
    && value.findIndex(step => step.kind === "endTurn") === value.length - 1;
}

export function isNpcCombatTurnPlannedPayload(value: unknown): value is NpcCombatTurnPlannedPayload {
  return isRecord(value) && hasExactKeys(value, ["encounterId", "npcCharacterId", "rootActionId", "steps"])
    && [value.encounterId, value.npcCharacterId, value.rootActionId].every(ref)
    && String(value.rootActionId).startsWith(NPC_COMBAT_TURN_ROOT_PREFIX) && isNpcCombatTurnSteps(value.steps);
}

export function isNpcCombatTurnStepTakenPayload(value: unknown): value is NpcCombatTurnStepTakenPayload {
  return isRecord(value) && hasExactKeys(value, ["npcCharacterId", "rootActionId", "stepIndex"])
    && ref(value.npcCharacterId) && ref(value.rootActionId)
    && Number.isSafeInteger(value.stepIndex) && Number(value.stepIndex) >= 0 && Number(value.stepIndex) < NPC_COMBAT_TURN_MAX_STEPS;
}

export function isNpcCombatTurnSettledPayload(value: unknown): value is NpcCombatTurnSettledPayload {
  return isRecord(value) && hasExactKeys(value, ["npcCharacterId", "outcome", "reason", "rootActionId", "stoppedAtStep"])
    && ref(value.npcCharacterId) && ref(value.rootActionId)
    && ((value.outcome === "completed" && value.stoppedAtStep === null && value.reason === null)
      || (value.outcome === "stopped" && Number.isSafeInteger(value.stoppedAtStep) && Number(value.stoppedAtStep) >= 0
        && isNonEmptyString(value.reason) && String(value.reason).length <= 120));
}

export function npcCombatTurnPlans(state: AuthoritativeWorldState): Record<string, NpcCombatTurnPlanRecord> {
  const plans = (state.combatRuntime as unknown as JsonRecord).npcTurnPlans;
  return isRecord(plans) ? plans as Record<string, NpcCombatTurnPlanRecord> : {};
}

export function npcCombatTurnPlan(state: AuthoritativeWorldState, rootActionId: unknown): NpcCombatTurnPlanRecord | undefined {
  return typeof rootActionId === "string" ? npcCombatTurnPlans(state)[rootActionId] : undefined;
}

/** Folds the three plan events. The plan lives only while its root is open;
 * the collection is removed when empty, so a room that never had an NPC turn
 * keeps the state shape it had. */
export function applyNpcCombatTurnEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  const runtime = state.combatRuntime as unknown as JsonRecord;
  if (event.eventType === "NpcCombatTurnPlanned") {
    const payload = event.payload;
    if (!isNpcCombatTurnPlannedPayload(payload) || payload.rootActionId !== event.rootActionId
      || npcCombatTurnPlan(state, payload.rootActionId) !== undefined) throw new RulesValidationError("npc-turn:plan-invalid");
    runtime.npcTurnPlans = { ...npcCombatTurnPlans(state), [payload.rootActionId]: {
      rootActionId: payload.rootActionId, encounterId: payload.encounterId, npcId: payload.npcCharacterId,
      steps: structuredClone(payload.steps), nextStep: 0 } };
    return true;
  }
  if (event.eventType === "NpcCombatTurnStepTaken") {
    const payload = event.payload;
    const plan = isNpcCombatTurnStepTakenPayload(payload) ? npcCombatTurnPlan(state, payload.rootActionId) : undefined;
    if (plan === undefined || !isNpcCombatTurnStepTakenPayload(payload) || plan.npcId !== payload.npcCharacterId
      || payload.stepIndex !== plan.nextStep || payload.stepIndex >= plan.steps.length) throw new RulesValidationError("npc-turn:step-invalid");
    plan.nextStep = payload.stepIndex + 1;
    return true;
  }
  if (event.eventType === "NpcCombatTurnSettled") {
    const payload = event.payload;
    const plan = isNpcCombatTurnSettledPayload(payload) ? npcCombatTurnPlan(state, payload.rootActionId) : undefined;
    if (plan === undefined || !isNpcCombatTurnSettledPayload(payload) || plan.npcId !== payload.npcCharacterId) {
      throw new RulesValidationError("npc-turn:settle-invalid");
    }
    const plans = npcCombatTurnPlans(state);
    delete plans[payload.rootActionId];
    if (Object.keys(plans).length === 0) delete runtime.npcTurnPlans;
    return true;
  }
  return false;
}

export function npcCombatTurnRootPrefix(encounterId: string, round: string, turnIndex: string, npcId: string): string {
  return `${NPC_COMBAT_TURN_ROOT_PREFIX}${encounterId}:${round}:${turnIndex}:${npcId}:`;
}

export function npcCombatTurnOf(descriptor: unknown): NpcCombatTurnDue | undefined {
  return isRecord(descriptor) && isRecord(descriptor.npcCombatTurn) ? descriptor.npcCombatTurn as NpcCombatTurnDue : undefined;
}

/** SPEC 0002 §17: when an encounter's active combatant is an NPC, its turn is
 * owed. A turn may take more than one plan when something stops the first
 * (a reaction, a death, a target that moved); each plan is its own segment
 * root. A new segment waits until no other combat choice or dice are open;
 * a segment already running keeps its identity while it waits on them. */
export function npcCombatTurnDescriptors(state: AuthoritativeWorldState): DueActivityDescriptor[] {
  const due: DueActivityDescriptor[] = [];
  for (const [encounterId, encounter] of Object.entries(state.combatRuntime.encounters)) {
    if (encounter.status === "concluded" || !Array.isArray(encounter.turnOrderEntityIds)
      || !Number.isSafeInteger(encounter.turnCursor) || !Number.isSafeInteger(encounter.round)) continue;
    const npcId = encounter.activeEntityId;
    if (!isNonEmptyString(npcId) || encounter.turnOrderEntityIds[Number(encounter.turnCursor)] !== npcId) continue;
    const npc = state.entities[npcId];
    if (npc?.kind !== "npc" || state.combatRuntime.entities[npcId] === undefined) continue;
    const round = String(encounter.round), turnIndex = String(encounter.turnCursor);
    const prefix = npcCombatTurnRootPrefix(encounterId, round, turnIndex, npcId);
    const roots = Object.keys(state.receipts).filter(root => root.startsWith(prefix));
    const running = Object.keys(npcCombatTurnPlans(state)).find(root => root.startsWith(prefix))
      ?? roots.find(root => ["awaitingInput", "awaitingRandomness"].includes(state.receipts[root].status));
    if (running === undefined && (Object.keys(state.combatRuntime.pendingInputs).length > 0
      || Object.keys(state.combatRuntime.randomnessResolutions).length > 0)) continue;
    const segment = running === undefined ? String(roots.length) : running.slice(prefix.length);
    const timelineId = characterTimelineId(state, npcId);
    if (timelineId === undefined || !/^(0|[1-9][0-9]*)$/u.test(segment)) continue;
    const identity: NpcCombatTurnDue = { encounterId, npcId, round, turnIndex, segment };
    due.push({ activityId: null, ownerEntityId: npcId, timelineId,
      completionFictionMicros: state.fictionTimelines[timelineId].nowMicros,
      childRootActionId: `${prefix}${segment}`, activityHash: canonicalSha256(identity),
      sceneIds: [npc.sceneId], npcCombatTurn: identity });
  }
  return due;
}
