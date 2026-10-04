import { RulesValidationError } from "../errors";
import type { RuntimeProfileManifest } from "../profiles/types";
import { stepCombatWorld } from "./combat-actions";
import { createEventTransition, scopeOf } from "./events";
import { continueCompoundRoot } from "./internal-compound";
import type { AuthoritativeWorldState, EventType, JsonRecord, StepResult } from "./model";
import {
  isNpcCombatTurnSteps,
  npcCombatTurnPlan,
  npcCombatTurnRootPrefix,
  type NpcCombatTurnStep,
} from "./npc-combat-turn-state";
import { npcCombatTurnOptions, npcCombatTurnPlanIssues, npcCombatTurnStepInput } from "./npc-turn-options";
import { rejected } from "./results";
import { hasExactKeys, isNonEmptyString, isRecord } from "./validation";

/** SPEC 0006 §§6、7: the NPC's turn plan is carried out by the same Rules steps
 * a player's combat input takes, one after another under one root, so its
 * narration covers the whole turn. The plan waits in state while the root
 * waits on dice or a pending answer (a player's opportunity attack, an NPC's
 * own target or knock-out choice) and goes on when they are given. A step
 * that is no longer legal stops the plan; what happened stands, and the
 * NPC's turn is asked again for the rest (a new segment root). */

type Committed = Extract<StepResult, { kind: "committed" }>;

function internalDraft(state: AuthoritativeWorldState, profiles: RuntimeProfileManifest, rootActionId: string,
  eventType: Extract<EventType, "NpcCombatTurnPlanned" | "NpcCombatTurnStepTaken" | "NpcCombatTurnSettled">,
  payload: JsonRecord): Committed {
  const transition = createEventTransition(state, profiles, { rootActionId, eventType, payload: payload as never,
    visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" });
  return { kind: "committed", events: [transition.event], state: transition.state, cache: transition.state,
    scope: scopeOf(["combat:authoritative-state"], ["combat:authoritative-state", `receipt:${rootActionId}`], []),
    receipt: { ...transition.receipt, eventRange: { fromEventSeq: transition.event.eventSeq, toEventSeq: transition.event.eventSeq } } };
}

/** Joins a later segment of the same root onto what came before it. */
function joined(prefix: Committed, next: StepResult): StepResult {
  if (next.kind === "rejected" || next.kind === "initialized" || next.kind === "needsKp") {
    throw new RulesValidationError("npc-turn:join-invalid");
  }
  return {
    ...next,
    events: [...prefix.events, ...next.events],
    scope: scopeOf([...prefix.scope.reads, ...next.scope.reads], [...prefix.scope.writes, ...next.scope.writes],
      [...prefix.scope.creates, ...next.scope.creates]),
    ...(next.mechanicalResult ?? prefix.mechanicalResult) === undefined ? {} : { mechanicalResult: next.mechanicalResult ?? prefix.mechanicalResult },
  } as StepResult;
}

function settle(profiles: RuntimeProfileManifest, current: Committed, rootActionId: string, npcId: string,
  stoppedAtStep: number | null, reason: string | null): Committed {
  const settled = internalDraft(current.state, profiles, rootActionId, "NpcCombatTurnSettled", {
    rootActionId, npcCharacterId: npcId, outcome: stoppedAtStep === null ? "completed" : "stopped", stoppedAtStep, reason });
  return joined(current, settled) as Committed;
}

/** Takes the plan's remaining steps from a committed point until the root
 * has to wait, the plan ends, or a step can no longer be taken. */
function continuePlan(profiles: RuntimeProfileManifest, from: StepResult, rootActionId: string): StepResult {
  let current = from;
  while (current.kind === "committed") {
    const plan = npcCombatTurnPlan(current.state, rootActionId);
    if (plan === undefined) return current;
    if (plan.nextStep >= plan.steps.length) return settle(profiles, current, rootActionId, plan.npcId, null, null);
    const index = plan.nextStep;
    const step = plan.steps[index];
    const taken = joined(current, internalDraft(current.state, profiles, rootActionId, "NpcCombatTurnStepTaken",
      { rootActionId, npcCharacterId: plan.npcId, stepIndex: index })) as Committed;
    let input: JsonRecord | "stay" | undefined;
    try { input = npcCombatTurnStepInput(profiles, taken.state, plan.encounterId, plan.npcId, rootActionId, step); }
    catch (error) { if (!(error instanceof RulesValidationError)) throw error; input = undefined; }
    if (input === "stay") { current = taken; continue; }
    const next = input === undefined ? undefined : stepCombatWorld(profiles, taken.state, continueCompoundRoot(input, rootActionId));
    if (next === undefined || next.kind === "rejected" || next.kind === "needsKp" || next.kind === "initialized") {
      return settle(profiles, current, rootActionId, plan.npcId, index,
        next?.kind === "rejected" ? `${step.kind}:${next.rejection.code}` : `${step.kind}:unavailable`);
    }
    current = joined(taken, next);
  }
  return current;
}

function startTurn(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["encounterId", "kind", "proposalId", "sourceEntityId", "steps"])
    || ![input.encounterId, input.proposalId, input.sourceEntityId].every(isNonEmptyString) || !isNpcCombatTurnSteps(input.steps)) {
    return rejected("invalidRulesInput", "An NPC combat turn needs its encounter, NPC, root and a plan ending the turn.");
  }
  const rootActionId = String(input.proposalId), npcId = String(input.sourceEntityId), encounterId = String(input.encounterId);
  const encounter = state.combatRuntime.encounters[encounterId];
  if (encounter === undefined || encounter.status === "concluded" || encounter.activeEntityId !== npcId
    || !Array.isArray(encounter.turnOrderEntityIds) || encounter.turnOrderEntityIds[Number(encounter.turnCursor)] !== npcId
    || !rootActionId.startsWith(npcCombatTurnRootPrefix(encounterId, String(encounter.round), String(encounter.turnCursor), npcId))
    || rootActionId in state.receipts) {
    return rejected("invalidRulesInput", "Only the NPC whose turn it is may take this turn, once per segment.");
  }
  if (Object.keys(state.combatRuntime.pendingInputs).length > 0 || Object.keys(state.combatRuntime.randomnessResolutions).length > 0) {
    return rejected("pendingInputUnresolved", "A combat choice or roll is still open.");
  }
  const options = npcCombatTurnOptions(profiles, state, npcId);
  if (options === undefined) return rejected("privateOrUnknownReference", "The NPC's turn options are unavailable.");
  const issues = npcCombatTurnPlanIssues(options, input.steps as NpcCombatTurnStep[]);
  if (issues.length > 0) return rejected("invalidRulesInput", `The NPC turn plan does not fit its options: ${issues.join(", ")}`);
  const planned = internalDraft(state, profiles, rootActionId, "NpcCombatTurnPlanned",
    { rootActionId, encounterId, npcCharacterId: npcId, steps: structuredClone(input.steps) });
  return continuePlan(profiles, planned, rootActionId);
}

/** The root a combat continuation belongs to, when it is a running NPC turn. */
function continuationRoot(state: AuthoritativeWorldState, input: JsonRecord): string | undefined {
  if (input.kind === "authoritativeRandomness" && isNonEmptyString(input.resolutionId)) {
    const resolution = state.combatRuntime.randomnessResolutions[input.resolutionId];
    return isRecord(resolution) && isNonEmptyString(resolution.rootActionId) ? resolution.rootActionId : undefined;
  }
  if (input.kind === "answerPendingInput" && isNonEmptyString(input.pendingInputId)) {
    const pending = state.combatRuntime.pendingInputs[input.pendingInputId];
    return isRecord(pending) && isNonEmptyString(pending.rootActionId) ? pending.rootActionId : undefined;
  }
  return undefined;
}

export function stepNpcCombatTurn(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  if (input.kind === "takeNpcCombatTurn") return startTurn(profiles, state, input);
  const rootActionId = continuationRoot(state, input);
  if (rootActionId === undefined || npcCombatTurnPlan(state, rootActionId) === undefined) return undefined;
  const resumed = stepCombatWorld(profiles, state, input);
  return resumed === undefined ? undefined : continuePlan(profiles, resumed, rootActionId);
}
