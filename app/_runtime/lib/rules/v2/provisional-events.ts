import { canonicalSha256 } from "../profiles/canonical";
import type { RuntimeProfileManifest } from "../profiles/types";
import { createEventTransition, createScopeProof, foldEvent, validateEventEnvelope } from "./events";
import type { AuthoritativeWorldState, EventEnvelope, JsonRecord, StepResult, ScopeProof } from "./model";
import { rejected } from "./results";
import { hasExactKeys, hashWorldState, isAuthoritativeWorldState } from "./validation";

/** Room-only persisted preparation. No proposal normalizer accepts this
 * command. Re-sequence already verified Rules events after unrelated scopes
 * advance; the Room revalidates the original read set before calling it.
 * Neither dice, event payload decisions nor player choices are resampled. */
export function rebaseProvisionalEvents(profiles: RuntimeProfileManifest, current: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["kind", "baseState", "events", "scopeProofs"])
    || !Array.isArray(input.scopeProofs) || !isAuthoritativeWorldState(input.baseState) || !Array.isArray(input.events) || input.events.length === 0
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
  const proofs = input.scopeProofs as ScopeProof[];
  if (proofs.some(proof => !proof || !hasExactKeys(proof, ["basisStateVersion", "basisStateHash", "reads", "writes", "creates", "proofHash"])
    || ![proof.reads, proof.writes, proof.creates].every(refs => Array.isArray(refs) && refs.every(ref => typeof ref === "string" && ref.length > 0))
    || proof.proofHash !== canonicalSha256({ basisStateVersion: proof.basisStateVersion, basisStateHash: proof.basisStateHash,
      reads: proof.reads, writes: proof.writes, creates: proof.creates })))
    return rejected("invalidRulesInput", "Invalid provisional scope proof.");
  const scopeProof = createScopeProof(current, proofs.flatMap(proof => proof.reads), proofs.flatMap(proof => proof.writes), proofs.flatMap(proof => proof.creates));
  const preparationStates = new Map([[original.version, hashWorldState(original)]]);
  try {
    for (const value of input.events) {
      const checked = validateEventEnvelope(value);
      if (!checked.ok || canonicalSha256(checked.event.profiles) !== canonicalSha256(profiles)
        || checked.event.previousEventHash !== original.eventHeadHash
        || checked.event.stateBeforeHash !== hashWorldState(original)) throw new Error("Invalid provisional event chain.");
      const event = checked.event;
      original = foldEvent(original, event);
      preparationStates.set(original.version, hashWorldState(original));
      if (hashWorldState(original) !== event.stateHashAfter) throw new Error("Invalid provisional state.");
      const newSequence = (BigInt(state.version) + 1n).toString();
      refs.set(event.eventId, `event:${state.runtimeEpochId}:${newSequence}`);
      sequences.set(event.eventSeq, newSequence);
      const transition = createEventTransition(state, profiles, { rootActionId: event.rootActionId,
        ...(event.resolutionId === null ? {} : { resolutionId: event.resolutionId }), eventType: event.eventType,
        payload: remap(event.payload) as EventEnvelope["payload"], scopeProof,
        secrecy: event.secrecy, visibilityPolicyId: event.visibilityPolicyId });
      refs.set(event.eventHash, transition.event.eventHash);
      events.push(transition.event); state = transition.state; receipt = transition.receipt;
    }
  } catch { return rejected("invalidWorldState", "The frozen provisional events cannot be rebased on this state."); }
  if (proofs.some(proof => preparationStates.get(proof.basisStateVersion) !== proof.basisStateHash))
    return rejected("invalidRulesInput", "The provisional scope proof has no matching preparation state.");
  return { kind: "committed", events, state, cache: state, stateHash: hashWorldState(state), receipt: receipt!, scopeProof };
}
