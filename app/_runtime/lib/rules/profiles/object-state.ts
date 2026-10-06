/** SPEC 0014 §2.3: operations follow the object's declared finite state
 * graph. Object names and storage locations do not select rule behaviour. */
export const OBJECT_OPERATIONS = ["open", "close", "lock", "unlock"] as const;
export type ObjectOperation = typeof OBJECT_OPERATIONS[number];
export const LOCKABLE_OBJECT_STATES = ["closed", "locked", "open"] as const;
export type LockableObjectState = typeof LOCKABLE_OBJECT_STATES[number];
export type ObjectStateGraph = Readonly<{
  definitionId: string;
  states: readonly Readonly<{ state: string }>[];
  transitions: readonly Readonly<{ fromState: string; intent: string; toState: string }>[];
}>;

export function lockableObjectTransitions() {
  return [
    { fromState: "closed", intent: "lock" as const, toState: "locked" },
    { fromState: "closed", intent: "open" as const, toState: "open" },
    { fromState: "locked", intent: "unlock" as const, toState: "closed" },
    { fromState: "open", intent: "close" as const, toState: "closed" },
  ];
}

export function lockableObjectGraph(objectRef: string): ObjectStateGraph {
  return { definitionId: `object-state:${objectRef}:lockable-v1`,
    states: LOCKABLE_OBJECT_STATES.map(state => ({ state })), transitions: lockableObjectTransitions() };
}

/** An explicit attempt to open may include unlocking, after the KP has
 * ruled the method. A plain map-open cannot do this. Unlock alone never
 * implicitly opens anything; the graph must declare each actual step. */
export function objectTransitionPath(graph: ObjectStateGraph, state: string, operation: ObjectOperation, ruled: boolean) {
  const step = (from: string, intent: string) => graph.transitions.find(value => value.fromState === from && value.intent === intent
    && graph.states.some(candidate => candidate.state === value.toState));
  const direct = step(state, operation);
  if (direct) return [direct];
  const unlocked = ruled && operation === "open" ? step(state, "unlock") : undefined;
  const opened = unlocked ? step(unlocked.toState, "open") : undefined;
  return unlocked && opened ? [unlocked, opened] : undefined;
}

export type ItemStateMachine = Readonly<{ schema: "zhuwei.lockable-object-state/v1"; state: LockableObjectState }>;
export function isItemStateMachine(value: unknown): value is ItemStateMachine {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 2 && record.schema === "zhuwei.lockable-object-state/v1"
    && (LOCKABLE_OBJECT_STATES as readonly unknown[]).includes(record.state);
}
