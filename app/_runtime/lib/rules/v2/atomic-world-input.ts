import { worldInteractionDiceValid, type WorldInteractionDiceSpec } from "./world-interaction-randomness";
import { canonicalSha256 } from "../profiles/canonical";
import type { RuntimeProfileManifest } from "../profiles/types";
import type { AuthoritativeWorldState, CombatRandomnessRequest, EventEnvelope, EventPayloadByType, JsonRecord, ScopeProof, StepResult, WorldInteractionRandomnessRequest } from "./model";
import type { AppliedWorldInteractionEffect, AtomicWorldInteractionOutcomeBinding, AtomicWorldInteractionStepsPlan } from "./world-interaction-model";
import { isAtomicWorldInteractionStepsPlan, isAppliedEffect, isResolvedCheck } from "./world-interaction-model";
import { hasExactKeys, isAuthoritativeWorldState, isNonEmptyString, isRecord, isSha256 } from "./validation";

export type AtomicLedgerEntry = {
  proposalRef: string;
  outcomeBinding: AtomicWorldInteractionOutcomeBinding;
  status: "applied" | "skipped";
};

export type AtomicNativeRandomness = {
  resolutionId: string;
  continuationCapability: string;
  randomnessRequests: CombatRandomnessRequest[];
};

export function atomicNativeRandomness(result: StepResult): AtomicNativeRandomness | undefined {
  if (result.kind !== "awaitingRandomness" || !isNonEmptyString(result.resolutionId)
    || !isNonEmptyString(result.continuationCapability) || !Array.isArray(result.randomnessRequests)
    || !result.randomnessRequests.every(request => "purposeKey" in request && "dice" in request
      && "frozenParameters" in request && "requestHash" in request)) return undefined;
  return { resolutionId: result.resolutionId, continuationCapability: result.continuationCapability,
    randomnessRequests: result.randomnessRequests as CombatRandomnessRequest[] };
}

export type WorldSettlementCursor = {
  branch: "success" | "failure";
  check: EventPayloadByType["WorldInteractionResolved"]["check"];
  effectIndex: number;
  targetIndex: number;
  targets: Array<{targetRef:string;relationRefs:string[]}> | null;
  windowHandled: boolean;
  appliedEffects: AppliedWorldInteractionEffect[];
  specs: readonly WorldInteractionDiceSpec[];
  faceEntries: Array<[string, number[]]>;
};

/** This record is Rules-private. Only its allowlisted pending mirror can be
 * consumed by Room's trusted-controller binding and Viewer projection. */
export type AtomicWorldContinuation = {
  schema: "zhuwei.atomic-world-continuation/v1";
  rootActionId: string;
  plan: AtomicWorldInteractionStepsPlan;
  branch: "success" | "failure";
  sourceState: AuthoritativeWorldState;
  candidateState: AuthoritativeWorldState;
  events: EventEnvelope[];
  scope: ScopeProof;
  ledger: AtomicLedgerEntry[];
  stepIndex: number;
  phase: number;
  worldCursor: WorldSettlementCursor | null;
  tapes: Array<{ request: WorldInteractionRandomnessRequest; rolls: number[] }>;
  generation: number;
  resumeAtEventSeq: string;
  profilesHash: string;
  authorityBindingHash: string;
  waiting: {
    kind: "input";
    nativePendingInputId: string;
    mirror: JsonRecord;
  } | {
    kind: "randomness";
    native: AtomicNativeRandomness;
    continuationId: string;
  };
};

export function atomicAuthorityBindingHash(state: AuthoritativeWorldState): string {
  return canonicalSha256({
    roomId: state.roomId, runtimeEpochId: state.runtimeEpochId,
    runtimeManifestRef: state.runtimeManifestRef, activeBranchId: state.activeBranchId,
    fictionTimelines: state.fictionTimelines, scenes: state.scenes,
    principals: state.principals, seats: state.seats, characterControls: state.characterControls,
    entities: state.entities, canonicalFacts: state.canonicalFacts, knowledge: state.knowledge,
    campaignRuntime: { ...state.campaignRuntime, activities: Object.fromEntries(Object.entries(state.campaignRuntime.activities)
      .map(([id, activity]) => { const { completionInputInFlight: _input, ...domain } = activity; return [id, domain]; })) },
    combatRuntime: { ...state.combatRuntime, pendingInputs: {} },
    pendingInputs: state.pendingInputs,
  });
}

export function atomicContinuationCanResume(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState,
  stored: AtomicWorldContinuation): boolean {
  // Every legitimate authority change has an event. A paused candidate cannot
  // overwrite even an unrelated later action; the caller must resolve that
  // causal conflict explicitly. Our own suspension checkpoint is the sole
  // event sequence accepted here.
  return state.version === stored.resumeAtEventSeq
    && stored.profilesHash === canonicalSha256(profiles)
    && stored.authorityBindingHash === atomicAuthorityBindingHash(state)
    && (stored.waiting.kind !== "input"
      || canonicalSha256(state.combatRuntime.pendingInputs[String(stored.waiting.mirror.pendingInputId)] ?? null)
        === canonicalSha256(stored.waiting.mirror));
}

export function isAtomicWorldContinuation(value: unknown): value is AtomicWorldContinuation {
  if (!isRecord(value) || !hasExactKeys(value, ["schema", "rootActionId", "plan", "branch", "sourceState",
    "candidateState", "events", "scope", "ledger", "stepIndex", "phase", "tapes", "generation",
    "resumeAtEventSeq", "profilesHash", "authorityBindingHash", "waiting", "worldCursor"])
    || value.schema !== "zhuwei.atomic-world-continuation/v1"
    || !isNonEmptyString(value.rootActionId) || !isAtomicWorldInteractionStepsPlan(value.plan)
    || value.plan.rootActionId !== value.rootActionId || !["success", "failure"].includes(String(value.branch))
    || !isSha256(value.profilesHash) || !isSha256(value.authorityBindingHash)
    || typeof value.resumeAtEventSeq !== "string" || !/^[1-9][0-9]*$/u.test(value.resumeAtEventSeq)
    || !Number.isInteger(value.stepIndex) || Number(value.stepIndex) < 0 || Number(value.stepIndex) >= value.plan.steps.length
    || !Number.isInteger(value.phase) || Number(value.phase) < 0
    || !Number.isInteger(value.generation) || Number(value.generation) < 1
    || !Array.isArray(value.events) || !value.events.every(event => isRecord(event) && event.rootActionId === value.rootActionId)
    || !isRecord(value.scope) || !isSha256(value.scope.proofHash)
    || !Array.isArray(value.ledger) || value.ledger.length !== value.stepIndex
    || !Array.isArray(value.tapes)
    || !(value.worldCursor === null || isWorldSettlementCursor(value.worldCursor, value.plan.steps[Number(value.stepIndex)]))
    || !isRecord(value.sourceState) || !isRecord(value.candidateState)
    // Snapshots cannot recursively retain prior private continuations.
    || !isRecord(value.sourceState.atomicWorldInteractions) || Object.keys(value.sourceState.atomicWorldInteractions).length > 0
    || !isRecord(value.candidateState.atomicWorldInteractions) || Object.keys(value.candidateState.atomicWorldInteractions).length > 0
    || !isAuthoritativeWorldState(value.sourceState) || !isAuthoritativeWorldState(value.candidateState)
    || !isRecord(value.waiting)) return false;
  const waiting = value.waiting;
  if (waiting.kind === "randomness") return hasExactKeys(waiting, ["kind", "native", "continuationId"])
    && isNonEmptyString(waiting.continuationId) && isRecord(waiting.native)
    && hasExactKeys(waiting.native, ["resolutionId", "continuationCapability", "randomnessRequests"])
    && isNonEmptyString(waiting.native.resolutionId) && isNonEmptyString(waiting.native.continuationCapability)
    && Array.isArray(waiting.native.randomnessRequests) && waiting.native.randomnessRequests.length > 0;
  if (waiting.kind !== "input" || !hasExactKeys(waiting, ["kind", "nativePendingInputId", "mirror"])
    || !isNonEmptyString(waiting.nativePendingInputId) || !isRecord(waiting.mirror)) return false;
  const mirror = waiting.mirror;
  const allowed = ["pendingInputId", "rootActionId", "kind", "choiceKind", "controllerEntityId", "reactionKind",
    "triggerKind", "answerOptions", "candidateAbilityRefs", "candidateEntityIds", "targetEntityId", "maximumTargetCount"];
  return Object.keys(mirror).every(key => allowed.includes(key))
    && isNonEmptyString(mirror.pendingInputId) && mirror.rootActionId === value.rootActionId
    && ["playerChoice", "kpDecision"].includes(String(mirror.kind)) && isNonEmptyString(mirror.choiceKind)
    && isNonEmptyString(mirror.controllerEntityId)
    && isRecord(value.candidateState.combatRuntime.pendingInputs[waiting.nativePendingInputId]);
}

function isWorldSettlementCursor(value: unknown, step: AtomicWorldInteractionStepsPlan["steps"][number]): value is WorldSettlementCursor {
  if (step.rulesInput.kind !== "resolveWorldInteraction" || !isRecord(value)
    || !hasExactKeys(value,["branch","check","effectIndex","targetIndex","targets","windowHandled","appliedEffects","specs","faceEntries"])
    || !["success","failure"].includes(String(value.branch))
    || !Number.isSafeInteger(value.effectIndex) || Number(value.effectIndex) < 0
    || !Number.isSafeInteger(value.targetIndex) || Number(value.targetIndex) < 0
    || value.windowHandled !== true || !Array.isArray(value.targets)
    || Number(value.targetIndex) >= value.targets.length
    || !value.targets.every(target => isRecord(target) && hasExactKeys(target,["targetRef","relationRefs"])
      && isNonEmptyString(target.targetRef) && Array.isArray(target.relationRefs) && target.relationRefs.every(isNonEmptyString))
    || !Array.isArray(value.appliedEffects) || !value.appliedEffects.every(isAppliedEffect)
    || !Array.isArray(value.specs) || !Array.isArray(value.faceEntries)) return false;
  const plan=step.rulesInput.plan;
  if (plan.branches[value.branch as "success"|"failure"].effects[Number(value.effectIndex)]?.kind !== "registeredHazard"
    || (plan.ruling.kind === "directSuccess" ? value.branch !== "success" || value.check !== null
      : !isResolvedCheck(value.check) || value.branch !== (value.check.succeeded ? "success" : "failure"))) return false;
  const faces=new Map<string,number[]>();
  for(const entry of value.faceEntries) {
    if(!Array.isArray(entry)||entry.length!==2||!isNonEmptyString(entry[0])||faces.has(entry[0])
      ||!Array.isArray(entry[1])||!entry[1].every(Number.isSafeInteger))return false;
    faces.set(entry[0],entry[1]);
  }
  const keys=new Set<string>();
  for(const spec of value.specs) {
    if(!isRecord(spec)||!hasExactKeys(spec,["purposeKey","dice","frozenParameters"])
      ||!isNonEmptyString(spec.purposeKey)||keys.has(spec.purposeKey)||!isRecord(spec.frozenParameters)
      ||!Array.isArray(spec.dice)||!spec.dice.every(die=>isRecord(die)&&hasExactKeys(die,["count","sides"])
        &&typeof die.count==="string"&&/^[1-9][0-9]*$/.test(die.count)&&typeof die.sides==="string"&&/^[1-9][0-9]*$/.test(die.sides))
      ||!worldInteractionDiceValid(spec.dice as WorldInteractionDiceSpec["dice"],faces.get(spec.purposeKey)??[]))return false;
    keys.add(spec.purposeKey);
  }
  return faces.size===keys.size;
}
