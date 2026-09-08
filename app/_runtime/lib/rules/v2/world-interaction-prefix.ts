import { canonicalSha256 } from "../profiles/canonical";
import type { RuntimeProfileManifest } from "../profiles/types";
import { authorityCharacterTimeline, authorityReadSetMatches, authorityRevisionOrHash } from "./authority-bindings";
import { combatPendingAnswerOptions, stepCombatWorld } from "./combat-actions";
import { domainStateBeforeAuditRange } from "./correction";
import { frozenChoiceForRoot } from "./frozen-player-choice";
import { stepInventoryOperation } from "./inventory-operations";
import type { AuthoritativeWorldState, CorrectionAuditRecord, JsonRecord, StepResult } from "./model";
import { authoritativeNpcDecisionContext } from "./npc-decision-context";
import { afterFrozenAtomicCosts, firstFrozenAtomicEventSeq, frozenAtomicInitialReadSet, atomicEffectsStart } from "./world-interaction-costs";
import type { AtomicWorldInteractionStepsPlan, WorldInteractionResolutionPlan } from "./world-interaction-model";
import { worldInteractionFaces, type WorldInteractionDiceSpec } from "./world-interaction-randomness";
import { isRecord } from "./validation";

type Audit = CorrectionAuditRecord;
const same = (left: unknown, right: unknown) => canonicalSha256(left ?? null) === canonicalSha256(right ?? null);
const npcDomain = (context: NonNullable<WorldInteractionResolutionPlan["social"]>["npcContext"]) => ({
  npcRef: context.npcRef, knowledgeCatalogRef: context.knowledgeCatalogRef, knowledge: context.knowledge, records: context.records,
});

/** Read only a committed tape whose actual DiceRolled identity and full payload
 * still bind the frozen request. An uncommitted request supplies no proof. */
function frozenNativeAnswer(state: AuthoritativeWorldState, audits: readonly Audit[], root: string,
  proposalRef: string, phase: number, resolution: JsonRecord,
  planningSpecs?: ReadonlyMap<string,WorldInteractionDiceSpec>): JsonRecord | undefined {
  if (!Array.isArray(resolution.randomnessRequests)) return undefined;
  const randomnessResults = [];
  for (const request of resolution.randomnessRequests) {
    if (!isRecord(request) || !Array.isArray(request.dice)) return undefined;
    const spec = { purposeKey: `inventory:${proposalRef}:${phase}:${request.purposeKey}`,
      dice: request.dice, frozenParameters: request.frozenParameters };
    const matches = planningSpecs === undefined ? Object.values(state.internalContinuations).flatMap(entry => {
      if (entry.rootActionId !== root || entry.request.purpose !== "worldInteractionCheck" || !entry.committedDice) return [];
      const { payload, eventId } = entry.committedDice;
      if (payload.requestHash !== entry.request.requestHash
        || payload.frozenParametersHash !== canonicalSha256(entry.request.frozenParameters)
        || payload.formula !== entry.request.diceExpression
        || !entry.request.hazardRolls.some(candidate => same(candidate,spec))
        || audits.filter(audit => audit.eventId === eventId && audit.eventType === "DiceRolled"
          && audit.rootActionId === root && audit.branchId === state.activeBranchId
          && audit.payloadHash === canonicalSha256(payload)).length !== 1) return [];
      const faces = worldInteractionFaces(entry.request,payload.faces)?.get(spec.purposeKey);
      return faces === undefined ? [] : [faces];
    }) : same(planningSpecs.get(spec.purposeKey),spec)
      // Only the existing, discarded shape collector supplies this map. It
      // already executed these exact constant samples; no public proof may
      // receive the collector or accept its samples as committed randomness.
      ? [request.dice.flatMap(die => isRecord(die) ? Array(Number(die.count)).fill(1) : [])] : [];
    if (matches.length !== 1) return undefined;
    const faces = [...matches[0]];
    randomnessResults.push({ randomnessId: request.randomnessId, requestHash: request.requestHash,
      draws: request.dice.map(die => isRecord(die)
        ? { sides: Number(die.sides), faces: faces.splice(0,Number(die.count)) } : null) });
    if (faces.length !== 0) return undefined;
  }
  return { kind: "authoritativeRandomness", resolutionId: resolution.resolutionId,
    continuationCapability: resolution.continuationCapability,
    responseId: `authority-response:${resolution.resolutionId}`, randomnessResults };
}

/** Verification replay uses the existing native interpreter on a private clone,
 * with the original committed faces and uniquely hash-matched pending answer.
 * It requests no entropy and never installs or publishes the returned state or
 * events. Every expected child must match actual identity, order and payload;
 * the existing prefix length bounds replay, including recovery phases. */
function nativePrefix(state: AuthoritativeWorldState, profiles: RuntimeProfileManifest, all: readonly Audit[],
  prefix: readonly Audit[], marker: Audit, proposalRef: string, initial: StepResult,
  before: (seq: string) => AuthoritativeWorldState,
  planningSpecs?: ReadonlyMap<string,WorldInteractionDiceSpec>): Audit[] | undefined {
  let result = initial;
  let index = prefix.findIndex(entry => entry.eventId === marker.eventId) + 1;
  const proved: Audit[] = [];
  let phase = 0;
  for (let attempt = 0; attempt < prefix.length; attempt++) {
    if (result.kind === "committed") return proved;
    const next = prefix[index];
    if (!next || (result.kind !== "awaitingRandomness" && result.kind !== "awaitingInput")) return undefined;
    const source = structuredClone(before(next.eventSeq));
    // domainStateBeforeAuditRange deliberately retains the current envelope
    // frontier. Only this private event identity cursor is set to the audit
    // boundary; no reconstructed chain hash is claimed or committed.
    source.version = String(BigInt(next.eventSeq) - 1n);
    let input: JsonRecord | undefined;
    if (result.kind === "awaitingRandomness" && "resolutionId" in result && typeof result.resolutionId === "string") {
      const resolution = source.combatRuntime.randomnessResolutions[result.resolutionId];
      if (!resolution) return undefined;
      input = frozenNativeAnswer(state,all.filter(entry => BigInt(entry.eventSeq) < BigInt(next.eventSeq)),
        marker.rootActionId,proposalRef,phase,resolution,planningSpecs);
      phase++;
    } else if (result.kind === "awaitingInput" && "pending" in result) {
      const pending = source.combatRuntime.pendingInputs[result.pending.pendingInputId];
      const expected = result.state.combatRuntime.pendingInputs[result.pending.pendingInputId];
      if (!pending || !same(pending,expected) || next.eventType !== "CombatPendingClosed"
        || next.payloadHash !== canonicalSha256({ pendingInputId: pending.pendingInputId })) return undefined;
      const answered = prefix[index + 1];
      const answers = combatPendingAnswerOptions(source,pending).flatMap(option => isRecord(option.answer)
        && answered?.eventType === "ReactionAnswered" && answered.payloadHash === canonicalSha256({
          pendingInputId: pending.pendingInputId, controllerEntityId: pending.controllerEntityId, answer: option.answer })
        ? [option.answer] : []);
      if (answers.length !== 1) return undefined;
      input = { kind: "answerPendingInput", pendingInputId: pending.pendingInputId,
        responseId: `verified-answer:${pending.pendingInputId}`, answer: answers[0] };
    }
    if (!input) return undefined;
    const replayed = stepCombatWorld(profiles,source,input);
    if (!replayed || (replayed.kind !== "committed" && replayed.kind !== "awaitingRandomness" && replayed.kind !== "awaitingInput")
      || replayed.events.length === 0) return undefined;
    for (const event of replayed.events) {
      const actual = prefix[index++];
      if (!actual || event.eventId !== actual.eventId || event.eventSeq !== actual.eventSeq
        || event.eventType !== actual.eventType || (event.resolutionId ?? undefined) !== actual.resolutionId
        || event.rootActionId !== actual.rootActionId || event.branchId !== actual.branchId
        || event.payloadHash !== actual.payloadHash) return undefined;
      proved.push(actual);
    }
    result = replayed;
  }
  return undefined;
}

/** Only the two fields omitted from the Activity payload are reconstructed.
 * The advance's reason remains validated by the original event interpreter;
 * this proof uses its exact inverse clock effect, never an invented payload. */
function activityPayload(start: Audit | undefined, advance: Audit | undefined, completed: Audit | undefined): JsonRecord | undefined {
  if (start?.eventType !== "ActivityStarted" || advance?.eventType !== "FictionTimeAdvanced" || completed?.eventType !== "ActivityCompleted"
    || BigInt(start.eventSeq) + 1n !== BigInt(advance.eventSeq) || BigInt(advance.eventSeq) + 1n !== BigInt(completed.eventSeq)
    || start.effects.length !== 1 || advance.effects.length !== 1 || completed.effects.length !== 1) return undefined;
  const began = start.effects[0], ended = completed.effects[0], clock = advance.effects[0];
  if (began.kind !== "restoreCampaignEntry" || ended.kind !== "restoreCampaignEntry" || began.collection !== "activities"
    || ended.collection !== "activities" || began.entryId !== ended.entryId || began.before !== null
    || ended.before?.status !== "active" || clock.kind !== "restoreFictionTime"
    || ended.before.startedAtFictionMicros !== clock.beforeMicros) return undefined;
  const { status: _status, startedAtFictionMicros: _started, progression: _progression, ...payload } = ended.before;
  return payload.activityId === began.entryId && start.payloadHash === canonicalSha256(payload)
    && completed.payloadHash === canonicalSha256({ activityId: payload.activityId }) ? payload : undefined;
}

/** Rebind only actual, individually proven prefix changes. This is invoked by
 * candidate execution and again by settlement replay. The original plan is
 * never edited, and no unrelated current read binding is refreshed. */
export function rebindFrozenSocialPrefix(state: AuthoritativeWorldState, profiles: RuntimeProfileManifest,
  atomic: AtomicWorldInteractionStepsPlan, sourcePlan: WorldInteractionResolutionPlan, branch: "success" | "failure",
  endEventSeq: string, executionSource?: AuthoritativeWorldState,
  planningSpecs?: ReadonlyMap<string,WorldInteractionDiceSpec>): WorldInteractionResolutionPlan | undefined {
  const social = sourcePlan.social;
  if (!social || atomic.actorCharacterId !== sourcePlan.actorCharacterId) return undefined;
  const stepIndex = atomic.steps.findIndex(step => step.rulesInput.kind === "resolveWorldInteraction"
    && step.rulesInput.plan.resolutionId === sourcePlan.resolutionId);
  if (stepIndex < 0 || !same(atomic.steps[stepIndex].rulesInput.plan, sourcePlan)) return undefined;
  const all = Object.values(state.correctionRuntime.audit).filter(entry => BigInt(entry.eventSeq) < BigInt(endEventSeq))
    .sort((a,b) => BigInt(a.eventSeq) < BigInt(b.eventSeq) ? -1 : 1);
  const boundary = { rootActionId: atomic.rootActionId, branchId: state.activeBranchId, eventSeq: endEventSeq, payload: { branch } };
  // Execution alone may supply its already validated private transaction source.
  // Replay has to recover the persisted Dice/choice/suspension binding.
  const boundStart = firstFrozenAtomicEventSeq(state, profiles, boundary, atomic, all);
  const hasPersistedAnchor = state.atomicWorldInteractions?.[atomic.rootActionId] !== undefined
    || frozenChoiceForRoot(state,atomic.rootActionId)?.selectedChoiceId != null
    || Object.values(state.internalContinuations).some(entry => entry.rootActionId === atomic.rootActionId
      && same(entry.resolutionPlan,atomic) && entry.committedDice !== undefined);
  if (boundStart === undefined && hasPersistedAnchor) return undefined;
  const start = boundStart ?? (executionSource === undefined ? undefined : atomicEffectsStart(atomic.rootActionId, BigInt(executionSource.version) + 1n, all));
  if (start === undefined || start > BigInt(endEventSeq)) return undefined;
  const audits = all.filter(entry => BigInt(entry.eventSeq) >= start);
  if (audits.length !== Number(BigInt(endEventSeq) - start) || audits.some((entry,index) =>
    entry.rootActionId !== atomic.rootActionId || entry.branchId !== state.activeBranchId || BigInt(entry.eventSeq) !== start + BigInt(index))) return undefined;
  const snapshots = new Map<string, AuthoritativeWorldState>();
  const before = (seq: string): AuthoritativeWorldState => {
    let value = snapshots.get(seq);
    if (value === undefined) { value = domainStateBeforeAuditRange(state, seq); snapshots.set(seq,value); }
    return value;
  };
  const initial = before(String(start)), current = before(endEventSeq);
  const initialReads = frozenAtomicInitialReadSet(initial, current, atomic, sourcePlan, String(start), endEventSeq);
  if (!initialReads || !authorityReadSetMatches(initial, initialReads)) return undefined;
  const initialNpc = authoritativeNpcDecisionContext(initial, profiles, social.npcRef);
  if (!initialNpc || !same(npcDomain(initialNpc), npcDomain(social.npcContext))) return undefined;
  const afterCosts = atomic.executionCosts === undefined ? sourcePlan
    : afterFrozenAtomicCosts(state, boundary, atomic, sourcePlan, profiles, String(start));
  if (!afterCosts) return undefined;
  const prefix = audits.slice(atomic.executionCosts?.costs.length ?? 0);
  const actor = sourcePlan.actorCharacterId;
  const actorChanges = prefix.filter(entry => authorityRevisionOrHash(before(entry.eventSeq), actor)
    !== authorityRevisionOrHash(before(String(BigInt(entry.eventSeq) + 1n)), actor));
  const approvedActorEvents = new Set<string>();
  const approvedClockEvents = new Set<string>();
  const approvedNativeEvents = new Set<string>();
  let previousStepSeq = start - 1n;
  for (const step of atomic.steps.slice(0, stepIndex)) {
    if (step.outcomeBinding !== "always" && step.outcomeBinding !== (branch === "success" ? "onSuccess" : "onFailure")) continue;
    if (step.rulesInput.kind !== "inventoryOperation") continue;
    const input = step.rulesInput;
    const matches: Array<{ marker: Audit; planned: Exclude<ReturnType<typeof stepInventoryOperation>, {kind:"rejected"}|{kind:"initialized"}>; activity?: Audit[] }> = [];
    for (const [index, entry] of prefix.entries()) {
      if (BigInt(entry.eventSeq) <= previousStepSeq || entry.eventType !== (input.plan.operation.kind === "use" ? "RandomnessRequested" : ["assemble", "disassemble"].includes(input.plan.operation.kind) ? "ItemAssemblyChanged" : "InventoryOperationApplied")) continue;
      const activity = activityPayload(prefix[index - 3], prefix[index - 2], prefix[index - 1]);
      const first = activity === undefined ? entry : prefix[index - 3];
      const local = structuredClone(before(first.eventSeq));
      // The same native planner constructs the exact frozen operation. Any
      // continuation is verified below using already committed input only.
      const planned = stepInventoryOperation(profiles, local, input, { continuedRoot: true, readSetAlreadyValidated: true });
      if (planned.kind !== "awaitingRandomness" && planned.kind !== "committed") continue;
      const marker = planned.events.find(candidate => candidate.eventType === entry.eventType && candidate.payloadHash === entry.payloadHash);
      if (!marker) continue;
      const plannedActivity = planned.events.find(candidate => candidate.eventType === "ActivityStarted");
      if (plannedActivity !== undefined) {
        if (!activity) continue;
        const { activityId: _actualId, ...actualBody } = activity;
        const { activityId: _expectedId, ...expectedBody } = plannedActivity.payload as JsonRecord;
        if (!same(actualBody, expectedBody)) continue;
      } else if (activity !== undefined) continue;
      matches.push({ marker: entry, planned, ...(activity === undefined ? {} : { activity: prefix.slice(index-3,index) }) });
    }
    if (matches.length !== 1) return undefined;
    const { marker, planned, activity } = matches[0];
    if (activity) approvedClockEvents.add(activity[1].eventId);
    if (input.plan.operation.kind !== "use") {
      approvedActorEvents.add(marker.eventId);
      previousStepSeq = BigInt(marker.eventSeq);
      continue;
    }
    const native = nativePrefix(state,profiles,all,prefix,marker,step.proposalRef,planned,before,planningSpecs);
    if (!native?.length) return undefined;
    for (const entry of native) { approvedActorEvents.add(entry.eventId); approvedNativeEvents.add(entry.eventId); }
    previousStepSeq = BigInt(native.at(-1)!.eventSeq);
  }
  if (actorChanges.some(entry => !approvedActorEvents.has(entry.eventId))) return undefined;
  // Earlier WorldInteractionResolved segments retain their own exact damage
  // settlement. Only proven native children may be excluded from this social
  // segment; same-root or same-resolution labels alone authorize nothing.
  const rootAudits = all.filter(entry => entry.rootActionId === atomic.rootActionId && entry.branchId === state.activeBranchId);
  const priorResolution = rootAudits.filter(entry => entry.eventType === "WorldInteractionResolved").at(-1);
  if (rootAudits.some(entry => BigInt(entry.eventSeq) > BigInt(priorResolution?.eventSeq ?? "0")
    && ["DamagePacketResolved","HitPointsChanged","CreatureDied"].includes(entry.eventType)
    && !approvedNativeEvents.has(entry.eventId))) return undefined;
  const timelines = afterCosts.readSet.filter(binding => binding.ref.startsWith("character-timeline:"));
  for (const binding of timelines) {
    const characterId = binding.ref.slice("character-timeline:".length);
    const original = authorityCharacterTimeline(initial,characterId), final = authorityCharacterTimeline(current,characterId);
    if (!original || !final) return undefined;
    const withoutClock = (value: typeof original) => ({ ...value, timeline: { ...value.timeline, nowMicros: null } });
    if (!same(withoutClock(original), withoutClock(final))) return undefined;
    let clock = original.timeline.nowMicros;
    // The act's own duration was paid in the cost segment before this prefix
    // and already verified there cost by cost. It advanced the actor's
    // timeline, so every binding on that timeline -- the NPC's included, when
    // they share a scene -- starts this walk from the advanced clock.
    const actorTimeline = authorityCharacterTimeline(initial, actor)?.timelineId;
    if (original.timelineId === actorTimeline) {
      for (const cost of atomic.executionCosts?.costs ?? []) {
        if (cost.kind === "fictionTime") clock = (BigInt(clock) + BigInt(cost.durationMicros)).toString();
      }
    }
    for (const [index, entry] of prefix.entries()) {
      if (!entry.effects.some(effect => effect.kind === "restoreFictionTime" && effect.timelineId === original.timelineId)) continue;
      const payload = activityPayload(prefix[index-1],entry,prefix[index+1]);
      if (!approvedClockEvents.has(entry.eventId) || !payload || payload.characterId !== actor) return undefined;
      const rewind = entry.effects[0];
      const next = authorityCharacterTimeline(before(String(BigInt(entry.eventSeq)+1n)),characterId);
      if (rewind.kind !== "restoreFictionTime" || rewind.beforeMicros !== clock || !next
        || BigInt(next.timeline.nowMicros)-BigInt(clock) !== BigInt(String(payload.intendedDurationMicros))) return undefined;
      clock = next.timeline.nowMicros;
    }
    if (clock !== final.timeline.nowMicros) return undefined;
  }
  const npc = authoritativeNpcDecisionContext(current, profiles, social.npcRef);
  const timeline = npc?.records.find(record => record.kind === "timeline");
  if (!timeline) return undefined;
  const allowed = new Set([actor,...timelines.map(binding => binding.ref)]);
  const readSet = afterCosts.readSet.map(binding => allowed.has(binding.ref)
    ? { ...binding, revisionOrHash: authorityRevisionOrHash(current,binding.ref) ?? binding.revisionOrHash } : binding);
  return { ...afterCosts, readSet, social: { ...social, npcContext: { ...social.npcContext,
    records: social.npcContext.records.map(record => record.kind === "timeline" ? timeline : record) } } };
}
