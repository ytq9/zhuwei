import type { AuthoritativeWorldState, EventPayloadByType } from "./model";
import { heldKnowledgeRecord } from "./knowledge-records";
import { hasExactKeys, isNonEmptyString, isRecord } from "./validation";

export type ObservationInference = Readonly<{
  conclusion: string;
  confidence: string;
  evidence: readonly (Readonly<{ kind: "heldKnowledge"; ref: string }>
    | Readonly<{ kind: "sensoryEvidence"; index: number }>)[];
}>;

export type ObservationKnowledgePlan = Readonly<{
  inquiry: string;
  inferences: Readonly<{ success: readonly ObservationInference[]; failure: readonly ObservationInference[] }>;
}>;

export function observationInferenceConform(value: unknown): value is ObservationInference {
  return isRecord(value) && hasExactKeys(value, ["conclusion", "confidence", "evidence"])
    && isNonEmptyString(value.conclusion) && value.conclusion.length <= 2000
    && isNonEmptyString(value.confidence) && value.confidence.length <= 500
    && Array.isArray(value.evidence) && value.evidence.length > 0 && value.evidence.length <= 32
    && value.evidence.every(ref => isRecord(ref) && (
      ref.kind === "heldKnowledge" ? hasExactKeys(ref, ["kind", "ref"]) && isNonEmptyString(ref.ref)
        && !ref.ref.startsWith("prospective:")
      : ref.kind === "sensoryEvidence" && hasExactKeys(ref, ["kind", "index"])
        && Number.isSafeInteger(ref.index) && Number(ref.index) >= 0))
    && new Set(value.evidence.map(ref => ref.kind === "heldKnowledge" ? `held:${ref.ref}` : `sensory:${ref.index}`)).size === value.evidence.length;
}

export function observationKnowledgePlanConform(value: unknown): value is ObservationKnowledgePlan {
  return isRecord(value) && hasExactKeys(value, ["inquiry", "inferences"])
    && isNonEmptyString(value.inquiry) && isRecord(value.inferences)
    && hasExactKeys(value.inferences, ["success", "failure"])
    && [value.inferences.success, value.inferences.failure].every(branch => Array.isArray(branch)
      && branch.length <= 16 && branch.every(observationInferenceConform));
}

/** Runs for both branches before any random request, including atomic steps
 * that would otherwise pause before reaching their inference consumer. */
export function observationKnowledgeIssue(state: AuthoritativeWorldState, plan: {
  actorCharacterId: string; observation?: ObservationKnowledgePlan;
  readSet: readonly { ref: string; revisionOrHash: string }[];
  branches: { success: { sensoryEvidence: readonly { observerRef: string }[] }; failure: { sensoryEvidence: readonly { observerRef: string }[] } };
}): string | undefined {
  if (!plan.observation) return undefined;
  const reads = new Set(plan.readSet.map(record => record.ref));
  for (const name of ["success", "failure"] as const) {
    const sensory = plan.branches[name].sensoryEvidence;
    if (sensory.some(entry => entry.observerRef !== plan.actorCharacterId)) return "observation:foreign-observer";
    for (const inference of plan.observation.inferences[name]) for (const source of inference.evidence) {
      if (source.kind === "sensoryEvidence") {
        if (!sensory[source.index]) return "observation:branch-evidence-index-invalid";
      } else if (!heldKnowledgeRecord(state, plan.actorCharacterId, source.ref)
        || !reads.has(`knowledge:${plan.actorCharacterId}:${source.ref}`)
        || !reads.has(`knowledge-catalog:${plan.actorCharacterId}`)) return "observation:knowledge-not-held-or-frozen";
    }
  }
  return undefined;
}

/** Both the campaign command and observation use this same knowledge gate.
 * A world reference, even a visible one, is not a holder's evidence record. */
export function characterInferencePayload(state: AuthoritativeWorldState,
  input: EventPayloadByType["CharacterInferenceFormed"]): EventPayloadByType["CharacterInferenceFormed"] | undefined {
  const actor = state.entities[input.characterId];
  if (!actor || actor.tenureStatus !== "active" || !isNonEmptyString(input.inferenceId)
    || !isNonEmptyString(input.conclusion) || !isNonEmptyString(input.confidence)
    || !Array.isArray(input.evidenceRefs) || input.evidenceRefs.length === 0
    || input.evidenceRefs.some(ref => !isNonEmptyString(ref) || !heldKnowledgeRecord(state, input.characterId, ref))
    || Object.hasOwn(state.knowledge[input.characterId] ?? {}, input.inferenceId)) return undefined;
  return { ...input, evidenceRefs: [...new Set(input.evidenceRefs)].sort() };
}

export function characterInferenceContent(payload: EventPayloadByType["CharacterInferenceFormed"]) {
  return { schema: "zhuwei.character-inference/v1", conclusion: payload.conclusion, confidence: payload.confidence };
}

export function characterInferenceContentText(value: unknown): string | undefined {
  return isRecord(value) && hasExactKeys(value, ["schema", "conclusion", "confidence"])
    && value.schema === "zhuwei.character-inference/v1" && isNonEmptyString(value.conclusion) && isNonEmptyString(value.confidence)
    ? `推断：${value.conclusion}（置信说明：${value.confidence}）` : undefined;
}
