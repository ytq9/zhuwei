import { sameCanonical } from "../profiles/canonical";
import type { RuntimeProfileManifest } from "../profiles/types";
import { createEventTransition, scopeOf, foldEvent, validateEventEnvelope } from "./events";
import type { AuthoritativeWorldState, EventEnvelope, JsonRecord, StepResult, TransactionScope } from "./model";
import { rejected } from "./results";
import { hasExactKeys, isAuthoritativeWorldState } from "./validation";

/** Room-only persisted preparation. No proposal normalizer accepts this
 * command. Re-sequence already verified Rules events after unrelated scopes
 * advance; the Room revalidates the original read set before calling it.
 * Neither dice, event payload decisions nor player choices are resampled. */
export function rebaseProvisionalEvents(profiles: RuntimeProfileManifest, current: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["kind", "baseState", "events", "scopes"])
    || !Array.isArray(input.scopes) || !isAuthoritativeWorldState(input.baseState) || !Array.isArray(input.events) || input.events.length === 0
    || input.baseState.roomId !== current.roomId || input.baseState.runtimeEpochId !== current.runtimeEpochId
    || input.baseState.activeBranchId !== current.activeBranchId) return rejected("invalidRulesInput", "Invalid provisional preparation.");
  let original = input.baseState, state = current;
  const events: EventEnvelope[] = [], refs = new Map<string, string>();
  const sequences = new Map<string, string>();
  const remap = (value: unknown, key = ""): unknown => {
    if (typeof value === "string") return refs.get(value)
      ?? (["eventSeq", "fromEventSeq", "toEventSeq", "sourceEventSeq"].includes(key) ? sequences.get(value) ?? value : value);
    if (Array.isArray(value)) return value.map(entry => remap(entry));
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, entry]) => [refs.get(name) ?? name, remap(entry, name)]));
    return value;
  };
  let receipt;
  // Scopes saved before ADR 0055 also carry hash fields; only the lists count.
  const saved = input.scopes as TransactionScope[];
  if (saved.some(entry => !entry || typeof entry !== "object"
    || ![entry.reads, entry.writes, entry.creates].every(refs => Array.isArray(refs) && refs.every(ref => typeof ref === "string" && ref.length > 0))))
    return rejected("invalidRulesInput", "Invalid provisional scope.");
  const scope = scopeOf(saved.flatMap(entry => entry.reads), saved.flatMap(entry => entry.writes), saved.flatMap(entry => entry.creates));
  try {
    for (const value of input.events) {
      const checked = validateEventEnvelope(value);
      // The staged events follow each other by event id; nothing is re-hashed (ADR 0055).
      if (!checked.ok || !sameCanonical(checked.event.profiles, profiles)
        || checked.event.parentEventId !== original.lastEventId) throw new Error("Invalid provisional event chain.");
      const event = checked.event;
      original = foldEvent(original, event);
      const newSequence = (BigInt(state.version) + 1n).toString();
      refs.set(event.eventId, `event:${state.runtimeEpochId}:${newSequence}`);
      sequences.set(event.eventSeq, newSequence);
      const transition = createEventTransition(state, profiles, { rootActionId: event.rootActionId,
        ...(event.resolutionId === null ? {} : { resolutionId: event.resolutionId }), eventType: event.eventType,
        payload: remap(event.payload) as EventEnvelope["payload"],
        secrecy: event.secrecy, visibilityPolicyId: event.visibilityPolicyId });
      events.push(transition.event); state = transition.state; receipt = transition.receipt;
    }
  } catch { return rejected("invalidWorldState", "The frozen provisional events cannot be rebased on this state."); }
  return { kind: "committed", events, state, cache: state, receipt: receipt!, scope };
}
