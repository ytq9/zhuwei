import type { AuthoritativeWorldState, EventEnvelope, EventPayloadByType } from "./model";
import type { AtomicWorldInteractionStepsPlan, WorldInteractionCost, WorldInteractionResolutionPlan } from "./world-interaction-model";
import { canonicalSha256 } from "../profiles/canonical";
import type { RuntimeProfileManifest } from "../profiles/types";
import { authorityReadSetMatches, authorityRevisionOrHash } from "./authority-bindings";
import { domainStateBeforeAuditRange } from "./correction";
import { atomicAuthorityBindingHash } from "./atomic-world-input";
import { frozenChoiceForRoot, frozenChoicePublicOptions, selectedFrozenContinuation } from "./frozen-player-choice";
import { materializedSemanticDefinition, semanticDefinitionMaterializedPayload } from "./semantic-definitions";

export const ATOMIC_ACCEPTED_COST_PURPOSE = "atomicWorldInteraction:acceptedCosts";

/** Payload construction is shared by the executor and its frozen-prefix
 * proof. Ownership, availability and the actual write remain in Rules. */
export function worldInteractionItemCostPayload(state: AuthoritativeWorldState, characterId: string,
  cost: WorldInteractionCost, purpose: string): EventPayloadByType["ItemUsed"] | undefined {
  const entry = state.campaignRuntime.itemSystem.entries[cost.entryRef];
  if (!entry) return undefined;
  const chargesBefore = entry.charges?.current ?? null, durabilityBefore = entry.durability?.current ?? null;
  return { characterId, entryId: cost.entryRef, purpose,
    quantityBefore: entry.quantity, quantityAfter: entry.quantity - cost.quantity,
    chargesBefore, chargesAfter: chargesBefore === null ? null : chargesBefore - cost.charges,
    durabilityBefore, durabilityAfter: durabilityBefore === null ? null : durabilityBefore - cost.durability };
}

export function worldInteractionResourceCostPayload(characterId: string, resourceId: string, amount: number,
  purpose: string): EventPayloadByType["ResourceUsed"] {
  return { characterId, resourceId, amount, purpose };
}

/** The act's own duration is paid like any other accepted cost: one
 * FictionTimeAdvanced whose reason is the shared cost purpose. */
export function worldInteractionFictionTimeCostPayload(characterId: string, durationMicros: string, purpose: string): EventPayloadByType["FictionTimeAdvanced"] {
  return { durationMicros, reason: purpose, characterId };
}

type AttemptCostLike = { kind: "item"; entryRef: string; quantity: number; charges: number; durability: number }
  | { kind: "resource"; resourceId: string; amount: number } | { kind: "fictionTime"; durationMicros: string };

/** Expected event type and payload for one frozen execution cost, evaluated
 * against the state just before that cost was paid. */
export function expectedWorldInteractionCostEvent(before: AuthoritativeWorldState, characterId: string,
  cost: AttemptCostLike, purpose: string): { eventType: "ItemUsed" | "ResourceUsed" | "FictionTimeAdvanced"; payload: unknown } | undefined {
  if (cost.kind === "item") {
    const payload = worldInteractionItemCostPayload(before, characterId, cost, purpose);
    return payload === undefined ? undefined : { eventType: "ItemUsed", payload };
  }
  if (cost.kind === "fictionTime") return { eventType: "FictionTimeAdvanced", payload: worldInteractionFictionTimeCostPayload(characterId, cost.durationMicros, purpose) };
  return { eventType: "ResourceUsed", payload: worldInteractionResourceCostPayload(characterId, cost.resourceId, cost.amount, purpose) };
}

export type FrozenAtomicExecutionBoundary = Pick<EventEnvelope<"WorldInteractionResolved">, "rootActionId" | "branchId" | "eventSeq">
  & { payload: Pick<EventEnvelope<"WorldInteractionResolved">["payload"], "branch"> };

type Audit = AuthoritativeWorldState["correctionRuntime"]["audit"][string];

/** A consumed definition created earlier in this exact frozen transaction is
 * not an initial-state read. Verify its original producer and actual event;
 * all other missing or stale dependencies remain invalid. */
export function frozenAtomicInitialReadSet(initial: AuthoritativeWorldState, state: AuthoritativeWorldState,
  atomic: AtomicWorldInteractionStepsPlan, sourcePlan: WorldInteractionResolutionPlan, fromEventSeq: string, endEventSeq: string) {
  const stepIndex = atomic.steps.findIndex(step => step.rulesInput.kind === "resolveWorldInteraction"
    && canonicalSha256(step.rulesInput.plan) === canonicalSha256(sourcePlan));
  if (stepIndex < 0) return undefined;
  const consumer = atomic.steps[stepIndex];
  const reads = [];
  for (const binding of sourcePlan.readSet) {
    const original = authorityRevisionOrHash(initial, binding.ref);
    if (original === binding.revisionOrHash) { reads.push(binding); continue; }
    if (original !== null) return undefined;
    const producers = atomic.steps.slice(0, stepIndex).filter(step => step.outcomeBinding === "always"
      && step.rulesInput.kind === "materializeSemanticDefinition" && step.rulesInput.plan.semanticKind === "worldFact"
      && consumer.consumes.some(ref => ref.kind === "prospective" && step.produces.some(p => p.handle === ref.handle)));
    const matches = producers.flatMap(step => {
      if (step.rulesInput.kind !== "materializeSemanticDefinition") return [];
      const materialized = materializedSemanticDefinition(atomic.rootActionId, step.rulesInput.plan);
      if (materialized.definitionRef !== binding.ref || materialized.definition.definitionHash !== binding.revisionOrHash
        || canonicalSha256(state.campaignRuntime.definitions[binding.ref] ?? null) !== canonicalSha256(materialized.definition)) return [];
      const payload = semanticDefinitionMaterializedPayload(atomic.actorCharacterId, step.rulesInput.plan, materialized);
      return Object.values(state.correctionRuntime.audit).filter(event => event.rootActionId === atomic.rootActionId
        && event.branchId === initial.activeBranchId && event.eventType === "SemanticDefinitionMaterialized"
        && BigInt(event.eventSeq) >= BigInt(fromEventSeq) && BigInt(event.eventSeq) < BigInt(endEventSeq)
        && event.payloadHash === canonicalSha256(payload));
    });
    if (matches.length !== 1) return undefined;
  }
  return reads;
}

/** Resolve a formally bound execution boundary. Candidate snapshots retain
 * their original dice/choice; suspended publication uses its saved frontier. */
export function firstFrozenAtomicEventSeq(state: AuthoritativeWorldState, profiles: RuntimeProfileManifest,
  event: FrozenAtomicExecutionBoundary, atomic: AtomicWorldInteractionStepsPlan,
  audits: readonly Audit[]): bigint | undefined {
  const samePlan = (value: unknown) => value !== undefined && canonicalSha256(value) === canonicalSha256(atomic);
  const continuation = Object.values(state.internalContinuations).find(entry => entry.rootActionId === event.rootActionId
    && samePlan(entry.resolutionPlan));
  const dice = continuation?.committedDice;
  if (dice) {
    const anchors = audits.filter(entry => entry.eventId === dice.eventId && entry.eventType === "DiceRolled"
      && entry.branchId === event.branchId && entry.rootActionId === event.rootActionId
      && entry.payloadHash === canonicalSha256(dice.payload));
    return anchors.length === 1 ? BigInt(anchors[0]!.eventSeq) + 1n : undefined;
  }
  const suspended = state.atomicWorldInteractions?.[event.rootActionId];
  if (suspended) {
    if (!samePlan(suspended.plan) || suspended.branch !== event.payload.branch
      || suspended.profilesHash !== canonicalSha256(profiles)
      || suspended.sourceState.activeBranchId !== event.branchId) return undefined;
    const start = BigInt(suspended.resumeAtEventSeq) + 1n;
    const checkpoints = audits.filter(entry => entry.eventSeq === suspended.resumeAtEventSeq
      && entry.rootActionId === event.rootActionId && entry.branchId === event.branchId);
    if (checkpoints.length !== 1) return undefined;
    const checkpoint = checkpoints[0]!;
    if (checkpoint.eventType === "AtomicWorldInteractionSuspended") {
      if (checkpoint.payloadHash !== canonicalSha256({ continuation: suspended })) return undefined;
    } else {
      const choice = frozenChoiceForRoot(state, event.rootActionId);
      if (checkpoint.eventType !== "FrozenPlayerChoiceInputRecorded" || !choice?.inFlightInput
        || checkpoint.payloadHash !== canonicalSha256({ input: choice.inFlightInput })) return undefined;
      // InputRecorded is the sole transition that moves this checkpoint while
      // preserving its private candidate. Verify the preceding stored record.
      const origins = audits.filter(entry => entry.eventType === "AtomicWorldInteractionSuspended"
        && entry.rootActionId === event.rootActionId && entry.branchId === event.branchId
        && BigInt(entry.eventSeq) < BigInt(checkpoint.eventSeq)
        && entry.payloadHash === canonicalSha256({ continuation: { ...suspended, resumeAtEventSeq: entry.eventSeq } }));
      if (origins.length !== 1) return undefined;
    }
    const before = domainStateBeforeAuditRange(state, String(start));
    if (atomicAuthorityBindingHash(before) !== suspended.authorityBindingHash) return undefined;
    // The private candidate must itself have paid exactly the frozen prefix.
    // Its event identities are not reused as final publication identities.
    for (const [index, cost] of (atomic.executionCosts?.costs ?? []).entries()) {
      const paid = suspended.events[index];
      if (!paid || BigInt(paid.eventSeq) !== BigInt(suspended.sourceState.version) + BigInt(index + 1)
        || paid.rootActionId !== atomic.rootActionId || paid.branchId !== event.branchId) return undefined;
      const original = domainStateBeforeAuditRange(suspended.candidateState, paid.eventSeq);
      const expected = expectedWorldInteractionCostEvent(original, atomic.actorCharacterId, cost, ATOMIC_ACCEPTED_COST_PURPOSE);
      if (!expected || paid.eventType !== expected.eventType
        || paid.payloadHash !== canonicalSha256(expected.payload) || paid.payloadHash !== canonicalSha256(paid.payload)) return undefined;
    }
    return start;
  }
  const choice = frozenChoiceForRoot(state, event.rootActionId);
  const selected = choice && selectedFrozenContinuation(choice);
  if (!choice || selected?.kind !== "adjudication" || !samePlan(selected.plan)
    || choice.plan.actorCharacterId !== atomic.actorCharacterId || choice.plan.profilesHash !== canonicalSha256(profiles)) return undefined;
  const requestedPayload: EventPayloadByType["PlayerChoiceRequested"] = { actorCharacterId: atomic.actorCharacterId,
    pendingInputId: choice.plan.pendingInputId, question: choice.plan.question, choices: frozenChoicePublicOptions(choice.plan) };
  const requests = audits.filter(entry => entry.eventType === "PlayerChoiceRequested" && entry.rootActionId === event.rootActionId
    && entry.branchId === event.branchId && entry.payloadHash === canonicalSha256(requestedPayload));
  if (requests.length !== 1) return undefined;
  const answeredPayload: EventPayloadByType["PendingInputAnswered"] = { actorCharacterId: atomic.actorCharacterId,
    pendingInputId: choice.plan.pendingInputId, openedByEventId: requests[0]!.eventId, answer: { choiceId: choice.selectedChoiceId! } };
  const answers = audits.filter(entry => entry.eventType === "PendingInputAnswered" && entry.rootActionId === event.rootActionId
    && entry.branchId === event.branchId && BigInt(entry.eventSeq) > BigInt(requests[0]!.eventSeq)
    && entry.payloadHash === canonicalSha256(answeredPayload));
  return answers.length === 1 ? BigInt(answers[0]!.eventSeq) + 1n : undefined;
}

/** Only the exact costs at the bound execution boundary may account for
 * changed dependencies. Never refresh from the later social/current state. */
export function afterFrozenAtomicCosts(state: AuthoritativeWorldState, event: FrozenAtomicExecutionBoundary,
  atomic: AtomicWorldInteractionStepsPlan, sourcePlan: WorldInteractionResolutionPlan,
  profiles: RuntimeProfileManifest, fromEventSeq?: string): WorldInteractionResolutionPlan | undefined {
  if (!atomic.executionCosts || atomic.rootActionId !== event.rootActionId || atomic.actorCharacterId !== sourcePlan.actorCharacterId) return undefined;
  const audits = Object.values(state.correctionRuntime.audit).filter(entry => BigInt(entry.eventSeq) < BigInt(event.eventSeq))
    .sort((a, b) => BigInt(a.eventSeq) < BigInt(b.eventSeq) ? -1 : 1);
  const start = fromEventSeq === undefined ? firstFrozenAtomicEventSeq(state, profiles, event, atomic, audits) : BigInt(fromEventSeq);
  if (start === undefined) return undefined;
  const { costs, readSet } = atomic.executionCosts;
  const paid = audits.filter(entry => BigInt(entry.eventSeq) >= start && BigInt(entry.eventSeq) < start + BigInt(costs.length));
  if (paid.length !== costs.length || paid.length === 0) return undefined;
  const before = domainStateBeforeAuditRange(state, paid[0].eventSeq);
  const initialReads = frozenAtomicInitialReadSet(before, state, atomic, sourcePlan, String(start), event.eventSeq);
  if (!initialReads || !authorityReadSetMatches(before, readSet) || !authorityReadSetMatches(before, initialReads)) return undefined;
  for (const [index, cost] of costs.entries()) {
    const actual = paid[index];
    if (actual.rootActionId !== event.rootActionId || actual.branchId !== event.branchId
      || BigInt(actual.eventSeq) !== start + BigInt(index)) return undefined;
    const expected = expectedWorldInteractionCostEvent(domainStateBeforeAuditRange(state, actual.eventSeq), atomic.actorCharacterId, cost, ATOMIC_ACCEPTED_COST_PURPOSE);
    if (!expected || actual.eventType !== expected.eventType
      || actual.payloadHash !== canonicalSha256(expected.payload)) return undefined;
  }
  const after = domainStateBeforeAuditRange(state, String(BigInt(paid.at(-1)!.eventSeq) + 1n));
  return { ...sourcePlan, readSet: sourcePlan.readSet.map(binding => ({ ref: binding.ref,
    revisionOrHash: authorityRevisionOrHash(after, binding.ref) ?? binding.revisionOrHash })) };
}
