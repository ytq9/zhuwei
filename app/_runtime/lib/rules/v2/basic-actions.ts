import { activeEncounter } from "./combat-encounters";
import type { AuthoritativeWorldState, JsonRecord } from "./model";
import { isRecord } from "./validation";

// SPEC 0012 §6.3: Dash, Disengage and Dodge with their 2014 semantics. Each
// takes the creature's action on its own combat turn, and no stat block has to
// list it. What each leaves behind is plain entity state. Dash and Disengage
// are written on the turn record, which TurnStarted replaces; Dodge is a flag
// beside the conditions, because attack rolls and saving throws read them and
// it outlasts the turn until the creature's next one starts.

export type BasicActionKey = "dash" | "disengage" | "dodge";

const BASIC_ACTIONS: Readonly<Record<string, BasicActionKey>> = Object.freeze({
  "action:dash": "dash",
  "action:disengage": "disengage",
  "action:dodge": "dodge",
});

export function basicActionKey(abilityRef: string): BasicActionKey | undefined {
  return Object.hasOwn(BASIC_ACTIONS, abilityRef) ? BASIC_ACTIONS[abilityRef] : undefined;
}

// SPEC 0014 §4 (ADR 0092): dropping prone and standing up on the creature's
// own turn, from the map. Neither takes its action; standing spends movement.
export type PostureActionKey = "standUp" | "dropProne";

const POSTURE_ACTIONS: Readonly<Record<string, PostureActionKey>> = Object.freeze({
  "action:stand-up": "standUp",
  "action:drop-prone": "dropProne",
});

export function postureActionKey(abilityRef: string): PostureActionKey | undefined {
  return Object.hasOwn(POSTURE_ACTIONS, abilityRef) ? POSTURE_ACTIONS[abilityRef] : undefined;
}

/** Names of the actions Rules defines itself, which no stored definition
 * carries, for what observers are told. */
export const BUILTIN_ACTION_NAMES: Readonly<Record<string, string>> = Object.freeze({
  "action:dash": "疾走", "action:disengage": "撤离", "action:dodge": "闪避", "action:grapple": "擒抱",
  "action:shove": "推撞", "action:shove-away": "推开", "action:stand-up": "起身", "action:drop-prone": "趴下",
});

/** SRD 5.1: standing up costs movement equal to half the creature's speed,
 * in milli-inches as movement is counted. */
export function standUpCostMilliInches(speed: string): bigint {
  return BigInt(speed) * 1_000n / 2n;
}

/** How many times the creature has taken Dash on its current turn. */
export function dashesThisTurn(entity: JsonRecord): number {
  const dashes = isRecord(entity.turn) ? entity.turn.dashes : undefined;
  return typeof dashes === "string" && /^(0|[1-9][0-9]*)$/.test(dashes) ? Number(dashes) : 0;
}

/** SRD 5.1 Dash: each Dash adds movement equal to the creature's speed after
 * modifiers, so its own turn allows that speed once more per Dash taken. A
 * readied move is not its turn and keeps the plain speed. */
export function turnMovementLimitMilliInches(entity: JsonRecord, speed: string): bigint {
  return BigInt(speed) * 1_000n * BigInt(1 + dashesThisTurn(entity));
}

/** SRD 5.1 Disengage: for the rest of the creature's turn its movement does
 * not provoke opportunity attacks. Movement outside its own turn still does. */
export function disengagedThisTurn(state: AuthoritativeWorldState, entityId: string): boolean {
  const entity = state.combatRuntime.entities[entityId];
  return entity !== undefined && isRecord(entity.turn) && entity.turn.disengaged === true
    && activeEncounter(state, entityId)?.activeEntityId === entityId;
}

/** SRD 5.1 Dodge, from its action until the start of the creature's next turn,
 * unless it is incapacitated or its speed drops to 0 first. */
export function isDodging(conditions: unknown): boolean {
  return isRecord(conditions) && conditions.dodging === true;
}

export function withoutDodge(conditions: unknown): JsonRecord {
  const { dodging: _ended, ...rest } = isRecord(conditions) ? conditions : {};
  return rest;
}
