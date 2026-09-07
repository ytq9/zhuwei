import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState, JsonRecord } from "./model";
import { authorityReadSetMatches, authorityRevisionOrHash } from "./authority-bindings";
import { hasExactKeys, isNonEmptyString, isRecord, isSha256 } from "./validation";
import { isAppliedEffect, isAtomicWorldInteractionStepsPlan, isWorldInteractionFeasibilityRulingPlan,
  type AppliedWorldInteractionEffect, type AtomicWorldInteractionStepsPlan, type WorldInteractionFeasibilityRulingPlan } from "./world-interaction-model";

export const FROZEN_PLAYER_CHOICE_SCHEMA = "zhuwei.frozen-player-choice/vnext-1" as const;
export type FrozenPlayerChoiceContinuation = Readonly<
  | { kind: "adjudication"; plan: AtomicWorldInteractionStepsPlan }
  | { kind: "inWorldRefusal"; plan: WorldInteractionFeasibilityRulingPlan }
  | { kind: "cancel" }
>;
export type FrozenPlayerChoicePlan = Readonly<{
  schema: typeof FROZEN_PLAYER_CHOICE_SCHEMA;
  rootActionId: string; actorCharacterId: string; pendingInputId: string;
  contextHash: string; bundleHash: string; profilesHash: string; question: string;
  readSet: readonly Readonly<{ ref: string; revisionOrHash: string }>[];
  choices: readonly Readonly<{ choiceId: string; label: string; publicRisk: string;
    continuation: FrozenPlayerChoiceContinuation }>[];
}>;
export type FrozenPlayerChoiceRecord = {
  plan: FrozenPlayerChoicePlan;
  readSet: readonly Readonly<{ ref: string; revisionOrHash: string }>[];
  selectedChoiceId: string | null;
  refusalCosts: FrozenPlayerChoiceRefusalCosts;
  inFlightInput: FrozenPlayerChoiceContinuationInput | null;
};
export type FrozenPlayerChoiceRefusalCosts = Record<string, readonly Extract<AppliedWorldInteractionEffect,
  { kind: "itemCost" | "resourceCost" | "fictionTimeCost" }>[]>;

export type FrozenPlayerChoiceAnswerInput = Readonly<{
  kind: "answerFrozenPlayerChoice"; rootActionId: string; controllerCharacterId: string; pendingInputId: string; choiceId: string;
}>;

/** Shared wire shape for live Rules input and the persisted Room recovery.
 * This grants no authority: live answers still bind the saved plan/controller. */
export function isFrozenPlayerChoiceAnswerInput(value: unknown): value is FrozenPlayerChoiceAnswerInput {
  return isRecord(value) && hasExactKeys(value, ["kind", "rootActionId", "controllerCharacterId", "pendingInputId", "choiceId"])
    && value.kind === "answerFrozenPlayerChoice"
    && [value.rootActionId, value.controllerCharacterId, value.pendingInputId, value.choiceId].every(isNonEmptyString);
}

/** External input only; the selected plan and all mechanical results remain
 * owned by the existing executor. Recorded before a continuation executes so
 * replay can verify even a cursor ending inside that execution segment. */
export type FrozenPlayerChoiceContinuationInput =
  | { kind: "randomness"; continuationId: string; rolls: number[] }
  | { kind: "nativeAnswer"; pendingInputId: string; responseId: string; answer: JsonRecord };

export function isFrozenPlayerChoiceContinuationInput(value: unknown): value is FrozenPlayerChoiceContinuationInput {
  if (!isRecord(value)) return false;
  if (value.kind === "randomness") return hasExactKeys(value, ["kind", "continuationId", "rolls"])
    && isNonEmptyString(value.continuationId) && Array.isArray(value.rolls) && value.rolls.every(Number.isSafeInteger);
  return value.kind === "nativeAnswer" && hasExactKeys(value, ["kind", "pendingInputId", "responseId", "answer"])
    && isNonEmptyString(value.pendingInputId) && isNonEmptyString(value.responseId) && isRecord(value.answer);
}

/** Closed saved plan shape only. Mechanical acceptance is still performed by
 * the original atomic compiler and preflight in world-interactions. */
export function isFrozenPlayerChoicePlan(value: unknown): value is FrozenPlayerChoicePlan {
  if (!isRecord(value) || !hasExactKeys(value, ["schema", "rootActionId", "actorCharacterId", "pendingInputId",
    "contextHash", "bundleHash", "profilesHash", "question", "choices", "readSet"])
    || value.schema !== FROZEN_PLAYER_CHOICE_SCHEMA
    || ![value.rootActionId, value.actorCharacterId, value.pendingInputId, value.question].every(isNonEmptyString)
    || ![value.contextHash, value.bundleHash, value.profilesHash].every(isSha256)
    || !Array.isArray(value.readSet) || !value.readSet.every(binding => isRecord(binding)
      && hasExactKeys(binding, ["ref", "revisionOrHash"]) && isNonEmptyString(binding.ref) && isNonEmptyString(binding.revisionOrHash))
    || new Set(value.readSet.map(binding => binding.ref)).size !== value.readSet.length
    || !Array.isArray(value.choices) || value.choices.length < 2 || value.choices.length > 8) return false;
  return value.choices.every(choice => {
    if (!isRecord(choice) || !hasExactKeys(choice, ["choiceId", "label", "publicRisk", "continuation"])
      || ![choice.choiceId, choice.label, choice.publicRisk].every(isNonEmptyString)
      || !isRecord(choice.continuation)) return false;
    const next = choice.continuation;
    if (next.kind === "cancel") return hasExactKeys(next, ["kind"]);
    if (!hasExactKeys(next, ["kind", "plan"])) return false;
    if (next.kind === "adjudication") return isAtomicWorldInteractionStepsPlan(next.plan)
      && next.plan.rootActionId === value.rootActionId && next.plan.actorCharacterId === value.actorCharacterId
      && next.plan.contextHash === value.contextHash;
    return next.kind === "inWorldRefusal" && isWorldInteractionFeasibilityRulingPlan(next.plan)
      && next.plan.actorCharacterId === value.actorCharacterId && next.plan.contextHash === value.contextHash;
  }) && new Set(value.choices.map(choice => choice.choiceId)).size === value.choices.length;
}

export function isFrozenPlayerChoiceRecord(value: unknown): value is FrozenPlayerChoiceRecord {
  return isRecord(value) && hasExactKeys(value, ["plan", "readSet", "selectedChoiceId", "refusalCosts", "inFlightInput"])
    && isFrozenPlayerChoicePlan(value.plan) && Array.isArray(value.readSet)
    && value.readSet.every(binding => isRecord(binding) && hasExactKeys(binding, ["ref", "revisionOrHash"])
      && isNonEmptyString(binding.ref) && isNonEmptyString(binding.revisionOrHash))
    && new Set(value.readSet.map(binding => binding.ref)).size === value.readSet.length
    && (value.selectedChoiceId === null || value.plan.choices.some(choice => choice.choiceId === value.selectedChoiceId))
    && (value.inFlightInput === null || (value.selectedChoiceId !== null && isFrozenPlayerChoiceContinuationInput(value.inFlightInput)))
    && isRecord(value.refusalCosts)
    && hasExactKeys(value.refusalCosts, value.plan.choices.filter(choice => choice.continuation.kind === "inWorldRefusal").map(choice => choice.choiceId))
    && Object.values(value.refusalCosts).every(costs => Array.isArray(costs) && costs.every(effect => isAppliedEffect(effect)
      && (effect.kind === "itemCost" || effect.kind === "resourceCost" || effect.kind === "fictionTimeCost")));
}

export function frozenChoiceForRoot(state: AuthoritativeWorldState, root: string): FrozenPlayerChoiceRecord | undefined {
  return Object.values(state.frozenPlayerChoices ?? {}).find(record => record.plan.rootActionId === root);
}
export function selectedFrozenContinuation(record: FrozenPlayerChoiceRecord): FrozenPlayerChoiceContinuation | undefined {
  return record.plan.choices.find(choice => choice.choiceId === record.selectedChoiceId)?.continuation;
}
export function frozenChoiceReadSetMatches(state: AuthoritativeWorldState, record: FrozenPlayerChoiceRecord): boolean {
  return authorityReadSetMatches(state, record.readSet);
}
export function frozenChoiceReadSet(state: AuthoritativeWorldState, plan: FrozenPlayerChoicePlan) {
  const refs = new Set<string>([plan.actorCharacterId, ...plan.readSet.map(binding => binding.ref)]);
  for (const choice of plan.choices) {
    const next = choice.continuation;
    const bindings = next.kind === "cancel" ? [] : next.kind === "inWorldRefusal" ? next.plan.readSet
      : [...(next.plan.executionCosts?.readSet ?? []), ...next.plan.steps.flatMap(step => step.rulesInput.plan.readSet)];
    for (const binding of bindings) if (authorityRevisionOrHash(state, binding.ref) !== null) refs.add(binding.ref);
  }
  return [...refs].sort().flatMap(ref => {
    const revisionOrHash = authorityRevisionOrHash(state, ref);
    return revisionOrHash === null ? [] : [{ ref, revisionOrHash }];
  });
}
export function frozenChoicePublicOptions(plan: FrozenPlayerChoicePlan) {
  return plan.choices.map(choice => ({ choiceId: choice.choiceId, label: choice.label, consequence: choice.publicRisk }));
}
export function frozenChoicePublicBindingMatches(record: FrozenPlayerChoiceRecord, value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.actorCharacterId === record.plan.actorCharacterId && value.pendingInputId === record.plan.pendingInputId
    && value.question === record.plan.question && canonicalSha256(value.choices) === canonicalSha256(frozenChoicePublicOptions(record.plan));
}
