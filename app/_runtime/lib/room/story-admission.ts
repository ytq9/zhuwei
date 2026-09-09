import { canonicalHash, isPlainRecord } from "../kp/vnext/canonical-json";
import { storyFactAdmissionRef, storyKnowledgeAdmissionRef } from "../rules/v2/story-facts-admission";
import type { AuthoritativeWorldState, EventEnvelope, JsonRecord } from "../rules";
import type { StoryAdmissionBindingInput, StoryAdmissionBinding, StoryAdmissionReceipt, StoryJobSnapshot } from "./story-creation-invocation";
import type { StoryHash, StoryPreparation } from "./story-creation/contracts";

const fail = (): never => { throw new TypeError("STORY_ADMISSION_BINDING_INVALID"); };
/** Only the real, closed wrappers may carry child story admissions. Never
 * recursively search prose/metadata for objects whose kind happens to match. */
export function storyFactPlans(input: JsonRecord): JsonRecord[] {
  if (input.kind === "admitStoryFacts") return isPlainRecord(input.plan) ? [input.plan] : fail();
  if (input.kind === "startActionActivity") return isPlainRecord(input.completionInput) ? storyFactPlans(input.completionInput) : fail();
  if (input.kind === "applyAtomicWorldInteractionSteps") {
    if (!isPlainRecord(input.plan) || !Array.isArray(input.plan.steps)) return fail();
    return input.plan.steps.flatMap(step => isPlainRecord(step) && isPlainRecord(step.rulesInput) ? storyFactPlans(step.rulesInput) : fail());
  }
  return [];
}

export function prepareStoryAdmissionBinding(input: Readonly<{
  job: StoryJobSnapshot; preparationHash: string; preparedActionId: string; proposal: unknown; rulesInput: JsonRecord;
}>): StoryAdmissionBindingInput | undefined {
  const { job } = input, checkpoint = job.checkpoint, preparation = checkpoint?.revisedDraft ?? checkpoint?.draft;
  if (checkpoint?.status !== "ready" || !preparation || canonicalHash(preparation) !== input.preparationHash) return fail();
  const selected = new Set<string>();
  const proposal = input.proposal;
  if (isPlainRecord(proposal) && proposal.mode === "adjudication" && Array.isArray(proposal.proposals)) {
    for (const entry of proposal.proposals) {
      if (!isPlainRecord(entry)) return fail();
      if (entry.kind === "materializeStory") {
        if (!isPlainRecord(entry.source) || entry.source.preparationHash !== input.preparationHash
          || typeof entry.source.candidateRef !== "string") return fail();
        const sourceRef = entry.source.candidateRef;
        if (!preparation.definitions.some(value => value.ref === sourceRef)) return fail();
        selected.add(entry.source.candidateRef);
      }
      if (entry.kind === "admitStoryFacts") {
        if (entry.preparationHash !== input.preparationHash || !Array.isArray(entry.candidateRefs)) return fail();
        for (const ref of entry.candidateRefs) {
          const fact = preparation.facts.find(value => value.ref === ref);
          if (!fact || selected.has(fact.ref)) return fail();
          selected.add(fact.ref); fact.knowledge.forEach(value => selected.add(value.ref));
        }
      }
    }
  }
  const plans = storyFactPlans(input.rulesInput), actual = new Set<string>();
  for (const plan of plans) {
    if (plan.preparationHash !== input.preparationHash || !Array.isArray(plan.facts)) return fail();
    for (const fact of plan.facts) {
      if (!isPlainRecord(fact) || typeof fact.ref !== "string" || actual.has(fact.ref)) return fail();
      const candidate = preparation.facts.find(value => value.ref === fact.ref);
      if (!candidate || !selected.has(candidate.ref) || canonicalHash(fact) !== canonicalHash(candidate)) return fail();
      actual.add(fact.ref);
    }
  }
  if (preparation.facts.some(fact => selected.has(fact.ref) !== actual.has(fact.ref))) return fail();
  if (!selected.size) return undefined;
  const selectedMaterialRefs = [...selected].sort();
  return { jobId: job.request.jobId, preparationHash: input.preparationHash as StoryHash,
    materialScopeHash: canonicalHash(selectedMaterialRefs) as StoryHash,
    preparedActionId: input.preparedActionId, contextHash: job.context.contextHash,
    selectedMaterialRefs, readSet: job.context.readSet, rulesInputHash: canonicalHash(input.rulesInput) as StoryHash };
}

/** Build mapping evidence exclusively from the actual Rules state and events.
 * Call recordAdmission with this result in the same transaction as Receipt.
 * A delayed Activity legitimately has no admitted materials until completion. */
export function storyAdmissionReceipt(input: Readonly<{
  binding: StoryAdmissionBinding; preparation: StoryPreparation; state: AuthoritativeWorldState;
  events: readonly EventEnvelope[]; receiptId: string; recordedAtEventSeq: string;
}>): StoryAdmissionReceipt {
  const { binding, state, preparation } = input;
  if (canonicalHash(preparation) !== binding.preparationHash) return fail();
  const selected = new Set(binding.selectedMaterialRefs);
  const facts = preparation.facts.filter(candidate => selected.has(candidate.ref)).map(candidate => {
    const factRef = storyFactAdmissionRef(binding.preparationHash, candidate.ref), fact = state.canonicalFacts[factRef];
    if (!fact || !isPlainRecord(fact.value) || fact.value.schema !== "zhuwei.story-fact-body/v1"
      || fact.value.preparationHash !== binding.preparationHash || fact.value.candidateHash !== canonicalHash(candidate)
      || !Array.isArray(fact.value.bindings)) return fail();
    const event = input.events.find(value => value.eventSeq === fact.validFromEventSeq
      && value.eventType === "CanonicalFactDeclared" && isPlainRecord(value.payload.fact) && value.payload.fact.id === factRef);
    if (!event) return fail();
    const knowledge = candidate.knowledge.map(value => {
      const matches = Object.values(state.knowledge).flatMap(records => Object.values(records)).filter(record =>
        isPlainRecord(record.content) && record.content.schema === "zhuwei.story-knowledge-body/v1"
        && record.content.preparationHash === binding.preparationHash && isPlainRecord(record.content.candidate)
        && record.content.candidate.ref === value.ref);
      if (matches.length !== 1) return fail();
      const record = matches[0], holderRef = record.characterId;
      const knowledgeRef = storyKnowledgeAdmissionRef(binding.preparationHash, value.ref, holderRef);
      const evidence = record && input.events.find(item => item.eventId === record.acquiredByEventId && item.eventType === "KnowledgeAcquired");
      if (!record || !evidence || !isPlainRecord(record.content) || record.content.schema !== "zhuwei.story-knowledge-body/v1"
        || record.knowledgeRef !== knowledgeRef || evidence.rootActionId !== event.rootActionId
        || canonicalHash(record.content.candidate) !== canonicalHash(value) || !record.provenanceChain.includes(factRef)) return fail();
      return { candidateRef: value.ref, holderRef, knowledgeRef, recordedByEventId: evidence.eventId };
    });
    return { candidateRef: candidate.ref, factRef, recordedByEventId: event.eventId, definitionRefs: [], knowledge };
  });
  return { jobId: binding.jobId, preparationHash: binding.preparationHash, materialScopeHash: binding.materialScopeHash,
    preparedActionId: binding.preparedActionId, receiptId: input.receiptId, bindingHash: binding.bindingHash,
    recordedAtEventSeq: input.recordedAtEventSeq, facts };
}
