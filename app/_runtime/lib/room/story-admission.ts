import { canonicalHash, isPlainRecord } from "../kp/vnext/canonical-json";
import { lowerVNext2ProposalBundle } from "../kp/vnext/proposal-bundle-lowering";
import { validateVNextProposalBundle } from "../kp/vnext/proposal-validator";
import { preparedStoryMappings, reviewedDefinitionEntry } from "../kp/vnext/story-materialization";
import type { VNextRequiredContext } from "../kp/vnext/required-context";
import { registeredAbilityRecord } from "../rules/profiles/ability-compiler";
import type { RuntimeProfileManifest } from "../rules/profiles/types";
import { materializedAuthoredDefinition, materializedAuthoredItem } from "../rules/v2/authored-materialization";
import { isNpcMaterializedPayload, npcMaterializationDefinitionRefs } from "../rules/v2/npc-materialization";
import { materializedSemanticDefinition, semanticDefinitionMaterializedPayload } from "../rules/v2/semantic-definitions";
import { compileAtomicWorldInteractionPlan } from "../rules/v2/world-interactions";
import type { AtomicWorldInteractionStep } from "../rules/v2/world-interaction-model";
import { isStoryFactBody, isStoryFactsAdmissionPlan, isStoryKnowledgeBody, isStoryKnowledgeAdmissionMetadata,
  storyFactAdmissionRef, storyKnowledgeAdmissionRef, type StoryFactsAdmissionPlan } from "../rules/v2/story-facts-admission";
import type { AuthoritativeWorldState, EventEnvelope, JsonRecord } from "../rules/v2/model";
import type { StoryAdmissionBindingInput, StoryAdmissionBinding, StoryAdmissionReceipt, StoryJobSnapshot,
  StoryAdmittedDefinitionBinding, StoryAdmittedFactBinding } from "./story-creation-invocation";
import type { StoryHash, StoryPreparation } from "./story-creation/contracts";
import { validateStoredPreparation, validateStoredReview } from "./story-creation/prompt";
import { storyReviewPassed } from "./story-creation/review";
import type { StoryLibraryBinding, StoryLibraryMappings } from "./story-library-contracts";
import { storyLibraryOwner, validateStoryLibraryEntry } from "./story-library";

const fail = (): never => { throw new TypeError("STORY_ADMISSION_BINDING_INVALID"); };
const same = (left: unknown, right: unknown) => canonicalHash(left) === canonicalHash(right);
const unique = (values: readonly string[]) => [...new Set(values)].sort();
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => isPlainRecord(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const strings = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every(text) && new Set(value).size === value.length;

/** Only a real closed wrapper exposes children. The ordinary Rules compiler
 * resolves the same producer graph used by execution, including item sources. */
function atomicPlan(input: JsonRecord) {
  let raw = input;
  if (input.kind === "startActionActivity") {
    if (!exact(input, ["kind", "rootActionId", "actorCharacterId", "completionInput"])
      || !text(input.rootActionId) || !isPlainRecord(input.completionInput)
      || input.actorCharacterId !== input.completionInput.actorCharacterId) return fail();
    raw = input.completionInput as JsonRecord;
  }
  const compiled = compileAtomicWorldInteractionPlan(raw);
  return compiled.kind === "accepted" ? compiled.plan : fail();
}
export function storyFactPlans(input: JsonRecord): StoryFactsAdmissionPlan[] {
  if (input.kind === "admitStoryFacts") return isStoryFactsAdmissionPlan(input.plan) ? [input.plan] : fail();
  if (input.kind !== "startActionActivity" && input.kind !== "applyAtomicWorldInteractionSteps") return [];
  return atomicPlan(input).steps.flatMap(step => step.rulesInput.kind === "admitStoryFacts" ? [step.rulesInput.plan] : []);
}

export function prepareStoryAdmissionBinding(input: Readonly<{
  job?: StoryJobSnapshot; library?: StoryLibraryBinding;
  preparationHash: string; preparedActionId: string; proposal: unknown; rulesInput: JsonRecord;
  requiredContext: VNextRequiredContext; state: AuthoritativeWorldState; profiles?: RuntimeProfileManifest;
}>): StoryAdmissionBindingInput | undefined {
  const { job, library } = input, checkpoint = job?.checkpoint;
  if (!!job === !!library) return fail();
  if (library) {
    validateStoryLibraryEntry(library.entry, { roomId: input.state.roomId, runtimeEpochId: input.state.runtimeEpochId, branchId: input.state.activeBranchId });
    const { validationHash, ...body } = library;
    if (canonicalHash(body) !== validationHash || !same(library.owner, storyLibraryOwner(library.entry))) return fail();
  }
  const preparation = library?.entry.artifact.preparation ?? checkpoint?.revisedDraft ?? checkpoint?.draft;
  const review = library?.entry.artifact.review ?? checkpoint?.revisedReview ?? checkpoint?.review;
  if (!library && checkpoint?.status !== "ready" || !preparation || !review || canonicalHash(preparation) !== input.preparationHash) return fail();
  validateStoredPreparation(preparation); validateStoredReview(review);
  if (!storyReviewPassed(review) || review.preparationHash !== input.preparationHash
    || review.contextHash !== preparation.contextHash
    || preparation.contextHash !== (library?.entry.artifact.context ?? job!.context).contextHash) return fail();
  const parsed = validateVNextProposalBundle(input.proposal);
  if (parsed.kind !== "accepted") return fail();
  const selected = new Set<string>();
  const add = (ref: string) => { if (selected.has(ref)) return fail(); selected.add(ref); };
  if (parsed.bundle.mode === "adjudication") for (const entry of parsed.bundle.proposals) {
    if (entry.kind === "materializeStory") {
      if (entry.source.preparationHash !== input.preparationHash) return fail();
      reviewedDefinitionEntry(preparation, entry.source.candidateRef); add(entry.source.candidateRef);
    }
    if (entry.kind === "admitStoryFacts") {
      if (entry.preparationHash !== input.preparationHash) return fail();
      for (const ref of entry.candidateRefs) {
        const fact = preparation.facts.find(value => value.ref === ref);
        if (!fact) return fail();
        add(fact.ref); fact.knowledge.forEach(value => add(value.ref));
      }
    }
  }
  if (!selected.size) return undefined;
  const lowered = lowerVNext2ProposalBundle({ value: parsed.bundle, requiredContext: input.requiredContext,
    state: input.state, profiles: input.profiles, rootActionId: input.requiredContext.binding.rootActionId,
    actorCharacterId: input.requiredContext.intent.actorRef });
  if (lowered.kind !== "accepted" || lowered.command.kind !== "rulesStep" || !same(lowered.command.rulesInput, input.rulesInput)) return fail();
  atomicPlan(input.rulesInput);
  const selectedMaterialRefs = [...selected].sort();
  const validation = library ? { request: library.currentRequest, context: library.currentContext } : { request: job!.request, context: job!.context };
  const priorMappings = preparedStoryMappings(input.requiredContext, input.preparationHash);
  if (!same(priorMappings, library?.mappings ?? { definitions: [], facts: [] })) return fail();
  return { owner: library?.owner ?? { kind: "creationJob", jobId: job!.request.jobId }, jobId: preparation.jobId,
    preparationHash: input.preparationHash as StoryHash, validation, priorMappings,
    materialScopeHash: canonicalHash(selectedMaterialRefs) as StoryHash,
    preparedActionId: input.preparedActionId, contextHash: validation.context.contextHash,
    selectedMaterialRefs, readSet: validation.context.readSet, rulesInputHash: canonicalHash(input.rulesInput) as StoryHash };
}

export function storyDefinitionAvailable(state: AuthoritativeWorldState, ref: string): boolean {
  return state.campaignRuntime.definitions[ref] !== undefined || state.combatRuntime.definitions[ref] !== undefined
    || state.campaignRuntime.itemSystem.definitions[ref] !== undefined;
}

/** Existing NPCs keep their identities; missing new NPCs never fall back to
 * treating a candidate name as an authority identity. */
export function storyMappedReference(preparation: StoryPreparation, definitions: readonly StoryAdmittedDefinitionBinding[],
  facts: readonly StoryAdmittedFactBinding[], reference: string): string {
  const matches = [...definitions.filter(value => value.candidateRef === reference).map(value => value.authorityRef),
    ...definitions.filter(value => reviewedDefinitionEntry(preparation, value.candidateRef).produces[0].handle === reference).map(value => value.authorityRef),
    ...facts.filter(value => value.candidateRef === reference).map(value => value.factRef),
    ...facts.flatMap(value => value.knowledge).filter(value => value.candidateRef === reference).map(value => value.knowledgeRef)];
  if (matches.length > 1 || matches.length === 0 && preparation.definitions.some(value => value.ref === reference)) return fail();
  return matches[0] ?? reference;
}

/** Shared persisted DTO closure; it never certifies events or writes facts.
 * The live host and archive additionally verify actual Rules evidence. */
export function validStoryMaterialBindings(preparation: StoryPreparation, definitions: unknown, facts: unknown,
  selectedMaterialRefs?: readonly string[], priorMappings: StoryLibraryMappings = { definitions: [], facts: [] }): boolean {
  try {
    if (!Array.isArray(definitions) || !Array.isArray(facts)) return false;
    const candidates = new Set<string>(), targets = new Set<string>();
    const add = (candidate: string, target: string) => {
      if (candidates.has(candidate) || targets.has(target)) return fail();
      candidates.add(candidate); targets.add(target);
    };
    for (const value of definitions) {
      if (!exact(value, ["candidateRef", "authorityRef", "recordedByEventId", "definitionRefs"])
        || !text(value.candidateRef) || !text(value.authorityRef) || !text(value.recordedByEventId)
        || !strings(value.definitionRefs) || value.definitionRefs.length === 0) return false;
      reviewedDefinitionEntry(preparation, value.candidateRef); add(value.candidateRef, `definition:${value.authorityRef}`);
    }
    for (const value of facts) {
      if (!exact(value, ["candidateRef", "factRef", "recordedByEventId", "definitionRefs", "knowledge"])
        || !text(value.candidateRef) || !text(value.factRef) || !text(value.recordedByEventId)
        || !strings(value.definitionRefs) || !Array.isArray(value.knowledge)) return false;
      const candidate = preparation.facts.find(fact => fact.ref === value.candidateRef);
      if (!candidate) return false;
      add(value.candidateRef, `fact:${value.factRef}`);
      for (const known of value.knowledge) {
        if (!exact(known, ["candidateRef", "holderRef", "knowledgeRef", "recordedByEventId"])
          || ![known.candidateRef, known.holderRef, known.knowledgeRef, known.recordedByEventId].every(text)) return false;
        const proposed = candidate.knowledge.find(item => item.ref === known.candidateRef);
        if (!proposed || proposed.factRef !== candidate.ref
          || storyMappedReference(preparation, [...priorMappings.definitions, ...definitions], [...priorMappings.facts, ...facts], proposed.holderRef) !== known.holderRef) return false;
        add(String(known.candidateRef), `knowledge:${known.holderRef}\u0000${known.knowledgeRef}`);
      }
    }
    if (selectedMaterialRefs !== undefined && (!strings(selectedMaterialRefs)
      || !same([...candidates].sort(), [...selectedMaterialRefs].sort()))) return false;
    return true;
  } catch { return false; }
}

function definitionReceipt(candidateRef: string, step: AtomicWorldInteractionStep, state: AuthoritativeWorldState,
  events: readonly EventEnvelope[]): StoryAdmittedDefinitionBinding {
  const input = step.rulesInput;
  const one = (matches: readonly EventEnvelope[]) => matches.length === 1 ? matches[0] : fail();
  let authorityRef: string, definitionRefs: string[], event: EventEnvelope;
  if (input.kind === "materializeNpc") {
    authorityRef = input.plan.prospectiveRef;
    event = one(events.filter(value => value.eventType === "NpcMaterialized" && isNpcMaterializedPayload(value.payload)
      && same(value.payload, { actorCharacterId: input.actorCharacterId, plan: input.plan })));
    const refs = npcMaterializationDefinitionRefs(input.rootActionId, authorityRef);
    const entity = state.entities[authorityRef];
    if (entity?.kind !== "npc" || entity.semanticDefinitionRef !== refs.semanticDefinitionRef) return fail();
    definitionRefs = unique([refs.semanticDefinitionRef, refs.mechanicalDefinitionRef,
      ...input.plan.source.mechanicalTemplate.intrinsicAbilityRefs, ...input.plan.source.mechanicalTemplate.itemDefinitionRefs]);
  } else if (input.kind === "materializeSemanticDefinition") {
    const result = materializedSemanticDefinition(input.rootActionId, input.plan);
    authorityRef = result.definitionRef; definitionRefs = [authorityRef];
    const payload = semanticDefinitionMaterializedPayload(input.actorCharacterId, input.plan, result);
    event = one(events.filter(value => value.eventType === "SemanticDefinitionMaterialized" && same(value.payload, payload)));
  } else if (input.kind === "materializeDefinition") {
    const result = materializedAuthoredDefinition(input.rootActionId, input.plan);
    if (!result) return fail();
    authorityRef = result.definitionRef; definitionRefs = [authorityRef];
    const payload = result.artifact ?? { definition: result.definition };
    event = one(events.filter(value => value.eventType === (result.kind === "itemDefinition" ? "ItemDefinitionRegistered" : "DefinitionRegistered")
      && same(value.payload, payload)));
    const actual = result.kind === "itemDefinition" ? state.campaignRuntime.itemSystem.definitions[authorityRef]
      : state.campaignRuntime.definitions[authorityRef];
    if (!actual || !same(actual, result.artifact ? registeredAbilityRecord(result.artifact) : result.definition)) return fail();
  } else if (input.kind === "materializeItem") {
    const definition = state.campaignRuntime.itemSystem.definitions[input.plan.definitionRef];
    const result = definition && materializedAuthoredItem(input.rootActionId, input.plan, definition);
    if (!result) return fail();
    authorityRef = result.entryRef; definitionRefs = [input.plan.definitionRef];
    event = one(events.filter(value => value.eventType === "ItemMaterialized" && same(value.payload, { entry: result.entry })));
    if (state.campaignRuntime.itemSystem.entries[authorityRef]?.definitionRef !== input.plan.definitionRef) return fail();
  } else return fail();
  if (definitionRefs.some(ref => !storyDefinitionAvailable(state, ref))) return fail();
  return { candidateRef, authorityRef, recordedByEventId: event.eventId, definitionRefs };
}

/** Evidence projection from the original frozen command and actual Rules
 * receipt. Activity completion uses its real completion root. The host saves
 * this mapping in the same transaction as that world receipt. */
export function storyAdmissionReceipt(input: Readonly<{
  binding: StoryAdmissionBinding; preparation: StoryPreparation; state: AuthoritativeWorldState;
  events: readonly EventEnvelope[]; receiptId: string; recordedAtEventSeq: string; rulesInput: JsonRecord;
}>): StoryAdmissionReceipt {
  const { binding, state, preparation } = input, { bindingHash, ...bound } = binding;
  validateStoredPreparation(preparation);
  if (canonicalHash(preparation) !== binding.preparationHash || canonicalHash(bound) !== bindingHash
    || canonicalHash(input.rulesInput) !== binding.rulesInputHash || canonicalHash(binding.selectedMaterialRefs) !== binding.materialScopeHash) return fail();
  const plan = atomicPlan(input.rulesInput);
  const admissionActor = plan.actorCharacterId;
  const receipt = state.receipts[plan.rootActionId];
  if (!receipt || receipt.receiptId !== input.receiptId || !["committed", "concluded"].includes(receipt.status)
    || receipt.eventRange.toEventSeq !== input.recordedAtEventSeq) return fail();
  const events = input.events.filter(event => event.rootActionId === plan.rootActionId
    && BigInt(event.eventSeq) >= BigInt(receipt.eventRange.fromEventSeq) && BigInt(event.eventSeq) <= BigInt(receipt.eventRange.toEventSeq));
  if (!events.length || new Set(events.map(event => event.eventId)).size !== events.length
    || events.some(event => event.roomId !== state.roomId || event.runtimeEpochId !== state.runtimeEpochId
      || event.branchId !== receipt.branchId || canonicalHash(event.payload) !== event.payloadHash)) return fail();
  const selected = new Set(binding.selectedMaterialRefs);
  const definitions = preparation.definitions.filter(value => selected.has(value.ref)).map(candidate => {
    const decoded = reviewedDefinitionEntry(preparation, candidate.ref), produced = decoded.produces[0];
    const matches = plan.steps.filter(step => step.outcomeBinding === "always"
      && step.produces.some(value => value.handle === produced.handle && value.kind === produced.kind));
    if (matches.length !== 1) return fail();
    return definitionReceipt(candidate.ref, matches[0], state, events);
  });
  const factPlans = plan.steps.flatMap(step => step.rulesInput.kind === "admitStoryFacts" ? [step.rulesInput.plan] : []);
  const facts = preparation.facts.filter(candidate => selected.has(candidate.ref)).map(candidate => {
    const plans = factPlans.filter(value => value.preparationHash === binding.preparationHash
      && value.facts.some(fact => same(fact, candidate)));
    if (plans.length !== 1) return fail();
    const plan = plans[0], actual = (ref: string) => plan.bindings.find(value => value.ref === ref)?.authorityRef ?? ref;
    const factRef = storyFactAdmissionRef(binding.preparationHash, candidate.ref), fact = state.canonicalFacts[factRef];
    const { knowledge: _knowledge, ...core } = candidate;
    if (!fact || !isStoryFactBody(fact.value) || fact.value.preparationHash !== binding.preparationHash
      || fact.value.candidateHash !== canonicalHash(candidate) || !same(fact.value.candidate, core)
      || fact.value.proposalRef !== plan.proposalRef || fact.value.contextHash !== plan.contextHash
      || fact.value.rootActionId !== receipt.rootActionId || fact.value.actorCharacterId !== admissionActor
      || !same(fact.subjectRefs, candidate.subjectRefs.map(actual))) return fail();
    const matches = events.filter(value => { const payload: unknown = value.payload;
      return value.eventSeq === fact.validFromEventSeq && value.eventType === "CanonicalFactDeclared"
        && isPlainRecord(payload) && isPlainRecord(payload.fact) && payload.fact.id === factRef && same(payload.fact.value, fact.value); });
    if (matches.length !== 1) return fail();
    const knowledge = candidate.knowledge.map(value => {
      const holderRef = actual(value.holderRef), knowledgeRef = storyKnowledgeAdmissionRef(binding.preparationHash, value.ref, holderRef);
      const record = state.knowledge[holderRef]?.[knowledgeRef];
      const evidence = record && events.filter(item => { const payload: unknown = item.payload;
        return item.eventId === record.acquiredByEventId && item.eventType === "KnowledgeAcquired" && isPlainRecord(payload)
          && payload.characterId === holderRef && payload.knowledgeRef === knowledgeRef && same(payload.content, record.content); });
      if (!record || evidence?.length !== 1 || !isStoryKnowledgeBody(record.content)
        || record.characterId !== holderRef || record.content.preparationHash !== binding.preparationHash
        || !same(record.content.candidate, value) || !record.provenanceChain.includes(factRef)
        || !record.provenanceChain.includes(actual(value.sourceRef))) return fail();
      const payload: unknown = evidence[0].payload;
      const metadata = isPlainRecord(payload) ? payload.storyAdmission : undefined;
      if (!isStoryKnowledgeAdmissionMetadata(metadata) || metadata.preparationHash !== binding.preparationHash
        || metadata.candidateRef !== value.ref || metadata.factRef !== factRef || metadata.sourceRef !== actual(value.sourceRef)) return fail();
      return { candidateRef: value.ref, holderRef, knowledgeRef, recordedByEventId: evidence[0].eventId };
    });
    const used = new Set([...candidate.subjectRefs, ...candidate.basisRefs, ...candidate.occurrence.basisRefs,
      ...candidate.knowledge.flatMap(value => [value.holderRef, value.sourceRef, ...value.acquisition.basisRefs])]);
    const definitionRefs = unique([...binding.priorMappings.definitions, ...definitions].filter(value => used.has(value.candidateRef)
      || used.has(reviewedDefinitionEntry(preparation, value.candidateRef).produces[0].handle)).flatMap(value => value.definitionRefs));
    return { candidateRef: candidate.ref, factRef, recordedByEventId: matches[0].eventId, definitionRefs, knowledge };
  });
  if (!validStoryMaterialBindings(preparation, definitions, facts, binding.selectedMaterialRefs, binding.priorMappings)) return fail();
  return { owner: binding.owner, jobId: binding.jobId, preparationHash: binding.preparationHash, materialScopeHash: binding.materialScopeHash,
    preparedActionId: binding.preparedActionId, receiptId: input.receiptId, bindingHash: binding.bindingHash,
    recordedAtEventSeq: input.recordedAtEventSeq, definitions, facts };
}
