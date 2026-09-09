import { authorityRevisionOrHash, normalizedProspectiveRef, type AuthoritativeWorldState, type JsonRecord } from "../../rules/authority-read";
import { STORY_FACTS_ADMISSION_PLAN_SCHEMA, storyFactAdmissionRef, storyKnowledgeAdmissionRef,
  isStoryKnowledgeBoundaryValue, type StoryAdmissionBinding, type StoryFactsAdmissionPlan } from "../../rules/v2/story-facts-admission";
import type { StoryPreparation, StoryFactCandidate, StoryReview } from "../../room/story-creation/contracts";
import { storyReviewPassed } from "../../room/story-creation/review";
import { validateStoredReview } from "../../room/story-creation/prompt";
import { npcMaterializationEntityRef } from "../../rules/v2/npc-materialization";
import { canonicalHash, isPlainRecord, deepFreeze } from "./canonical-json";
import { materializationAuthorityBasis } from "./materialization-authority";
import { requiredContextReadBindings } from "./required-context-runtime";
import type { VNextRequiredContext } from "./required-context";
import { decodeVNextStoryDefinitionSteps, type VNextAdjudicationBundle, type VNextProposalBundleEntry,
  type VNextAdmitStoryFactsEntry, type VNextDerivedBundlePlan } from "./proposal-schema";
import { vnextProposalCapabilityForEntry } from "./proposal-capabilities";
import { vnextEntryProducerContract, type VNextProducerKind } from "./proposal-producer-contract";
import type { StoryLibraryMappings } from "../../room/story-library-contracts";
import { validStoryMaterialBindings } from "../../room/story-admission";
import { resolveStoryProducerReferences } from "./story-producer-references";

export type StoryMaterialSelection = Readonly<{ preparationHash: string; candidateRef: string; handle: string; kind: VNextProducerKind }>;
export class StoryMaterializationError extends TypeError {
  constructor(readonly issue: string) { super(issue); }
}
const fail = (issue: string): never => { throw new StoryMaterializationError(issue); };
const unique = (values: readonly string[]) => [...new Set(values)].sort();

/** The hosting wrapper is private and non-citable. Only a matching review of
 * this exact candidate is eligible for the normal world admission path. */
export function preparedStory(context: VNextRequiredContext, preparationHash: string): StoryPreparation {
  const entry = context.entries.find(entry => entry.entryRef === `story-preparation:${preparationHash}`);
  if (entry?.kind !== "known" || !isPlainRecord(entry.value)
    || entry.value.schema !== "zhuwei.prepared-story-context/v1" || entry.value.nature !== "reviewedCandidateOnly"
    || entry.revisionOrHash !== canonicalHash(entry.value) || entry.value.preparationHash !== preparationHash
    || !isPlainRecord(entry.value.preparation) || canonicalHash(entry.value.preparation) !== preparationHash
    || !isPlainRecord(entry.value.review)
    || !context.references.citations.nonCitableRefs.includes(entry.entryRef)) return fail("story:reviewed-preparation-unavailable");
  const preparation = entry.value.preparation as unknown as StoryPreparation, review = entry.value.review as unknown as StoryReview;
  try { validateStoredReview(review); } catch { return fail("story:independent-review-required"); }
  if (review.preparationHash !== preparationHash || review.contextHash !== preparation.contextHash
    || !storyReviewPassed(review)) {
    return fail("story:independent-review-required");
  }
  return preparation;
}

export function preparedStoryMappings(context: VNextRequiredContext, preparationHash: string): StoryLibraryMappings {
  const preparation = preparedStory(context, preparationHash);
  const entry = context.entries.find(value => value.entryRef === `story-preparation:${preparationHash}`)!;
  const wrapper = (entry as { value: Record<string, unknown> }).value;
  if (!Object.hasOwn(wrapper, "admitted")) return { definitions: [], facts: [] };
  if (!isPlainRecord(wrapper.admitted) || Object.keys(wrapper.admitted).sort().join() !== "definitions,facts"
    || !validStoryMaterialBindings(preparation, wrapper.admitted.definitions, wrapper.admitted.facts)
    || !Array.isArray(wrapper.blockedCandidateRefs) || wrapper.blockedCandidateRefs.some(value => typeof value !== "string")
    || typeof wrapper.revalidationHash !== "string" || typeof wrapper.currentContextHash !== "string") return fail("story:library-bindings-invalid");
  return wrapper.admitted as unknown as StoryLibraryMappings;
}

function selectable(context: VNextRequiredContext, preparationHash: string, candidateRef: string): void {
  const mappings = preparedStoryMappings(context, preparationHash);
  if ([...mappings.definitions, ...mappings.facts].some(value => value.candidateRef === candidateRef)) return fail("story:candidate-already-admitted");
  const entry = context.entries.find(value => value.entryRef === `story-preparation:${preparationHash}`)!;
  const wrapper = (entry as { value: Record<string, unknown> }).value;
  if (Array.isArray(wrapper.blockedCandidateRefs) && wrapper.blockedCandidateRefs.includes(candidateRef)) return fail("story:candidate-context-changed");
}

function savedIdentities(preparation: StoryPreparation, mappings: StoryLibraryMappings): Map<string, string> {
  const result = new Map<string, string>();
  for (const value of mappings.definitions) {
    result.set(value.candidateRef, value.authorityRef);
    result.set(reviewedDefinitionEntry(preparation, value.candidateRef).produces[0].handle, value.authorityRef);
  }
  for (const value of mappings.facts) {
    result.set(value.candidateRef, value.factRef);
    for (const known of value.knowledge) result.set(known.candidateRef, known.knowledgeRef);
  }
  return result;
}

export function reviewedDefinitionEntry(preparation: StoryPreparation, candidateRef: string): VNextProposalBundleEntry {
  const candidate = preparation.definitions.find(value => value.ref === candidateRef);
  if (!candidate || Object.keys(candidate.payload).join() !== "steps") return fail("story:definition-candidate-unavailable");
  const [decoded] = decodeVNextStoryDefinitionSteps(candidate.payload.steps);
  if (!isPlainRecord(decoded) || !["materializeNpc", "materializeObject", "materializeDefinition", "materializeItem"].includes(String(decoded.kind))
    || vnextProposalCapabilityForEntry(decoded) !== candidate.capability
    || vnextEntryProducerContract(decoded)?.count !== 1 || decoded.outcomeBinding !== "always"
    || !Array.isArray(decoded.produces) || decoded.produces.length !== 1) return fail("story:definition-producer-contract-invalid");
  return decoded as VNextProposalBundleEntry;
}

/** Expansion copies exact reviewed operations; it does not repair, improve or
 * author any submitted story content. The resulting complete Bundle goes
 * through the ordinary source/dependency validator and Rules lowering. */
export function expandStorySelections(bundle: VNextAdjudicationBundle, context: VNextRequiredContext) {
  const materials: StoryMaterialSelection[] = [];
  const facts = new Set<string>();
  const proposals = bundle.proposals.map(entry => {
    if (entry.kind !== "materializeStory") return entry;
    if (entry.basisRefs.length || entry.consumes.length) return fail("story:selector-dependencies-are-host-owned");
    const { preparationHash, candidateRef } = entry.source;
    selectable(context, preparationHash, candidateRef);
    const preparation = preparedStory(context, preparationHash);
    const decoded = resolveStoryProducerReferences(reviewedDefinitionEntry(preparation, candidateRef),
      savedIdentities(preparation, preparedStoryMappings(context, preparationHash)));
    const produced = decoded.produces[0];
    if (produced.kind !== entry.source.kind || canonicalHash(decoded.produces) !== canonicalHash(entry.produces)
      || materials.some(value => value.preparationHash === preparationHash && value.candidateRef === candidateRef)) {
      return fail("story:exact-candidate-producer-required");
    }
    materials.push({ preparationHash, candidateRef, handle: produced.handle, kind: produced.kind });
    return decoded;
  });
  for (const selection of materials) {
    const preparation = preparedStory(context, selection.preparationHash);
    const admitted = preparedStoryMappings(context, selection.preparationHash);
    const candidate = preparation.definitions.find(value => value.ref === selection.candidateRef)!;
    if (candidate.dependsOn.some(ref => preparation.definitions.some(value => value.ref === ref)
      && !materials.some(value => value.preparationHash === selection.preparationHash && value.candidateRef === ref)
      && !admitted.definitions.some(value => value.candidateRef === ref))) {
      fail("story:required-definition-selection-missing");
    }
  }
  const expanded = proposals.map(entry => {
    if (entry.kind !== "admitStoryFacts") return entry;
    if (entry.basisRefs.length || entry.consumes.length) return fail("story:selector-dependencies-are-host-owned");
    if (facts.has(entry.preparationHash)) return fail("story:one-atomic-fact-selection-required");
    facts.add(entry.preparationHash);
    const preparation = preparedStory(context, entry.preparationHash);
    if (entry.candidateRefs.some(ref => !preparation.facts.some(value => value.ref === ref))) return fail("story:fact-candidate-unavailable");
    for (const ref of entry.candidateRefs) selectable(context, entry.preparationHash, ref);
    const handles = materials.filter(value => value.preparationHash === entry.preparationHash).map(value => value.handle);
    return { ...entry, basisRefs: handles, consumes: handles.map(handle => ({ kind: "prospective" as const, handle })) };
  });
  return deepFreeze({ bundle: { ...bundle, proposals: expanded }, materials });
}

function factReferences(fact: StoryFactCandidate): string[] {
  return unique([fact.ref, ...fact.subjectRefs, ...fact.basisRefs, ...fact.occurrence.basisRefs,
    ...fact.knowledge.flatMap(value => [value.ref, value.holderRef, value.factRef, value.sourceRef, ...value.acquisition.basisRefs])]);
}

export function lowerStoryFactSelection(input: Readonly<{
  context: VNextRequiredContext; state: AuthoritativeWorldState; rootActionId: string; actorCharacterId: string;
  entry: VNextAdmitStoryFactsEntry; proposalRef: string; bundlePlan: VNextDerivedBundlePlan;
  materials: readonly StoryMaterialSelection[];
}>): JsonRecord {
  const { entry, state, context } = input, preparation = preparedStory(context, entry.preparationHash);
  const selected = entry.candidateRefs.map(ref => preparation.facts.find(value => value.ref === ref)!);
  if (selected.some(value => value === undefined)) return fail("story:fact-candidate-unavailable");
  const generated = input.materials.filter(value => value.preparationHash === entry.preparationHash);
  const bindings = new Map<string, StoryAdmissionBinding>();
  const add = (ref: string, authorityRef: string, kind: StoryAdmissionBinding["kind"]) => {
    const previous = bindings.get(ref);
    if (previous && (previous.authorityRef !== authorityRef || previous.kind !== kind)) fail("story:candidate-reference-conflict");
    bindings.set(ref, { ref, authorityRef, kind });
  };
  for (const value of generated) {
    const prospectiveRef = normalizedProspectiveRef(input.rootActionId, input.bundlePlan.referenceNamespaceHash, value.handle);
    const authorityRef = value.kind === "entity" ? npcMaterializationEntityRef(prospectiveRef) : prospectiveRef;
    add(value.candidateRef, authorityRef, value.kind === "entity" ? "entity" : "basis");
    add(value.handle, authorityRef, value.kind === "entity" ? "entity" : "basis");
  }
  for (const fact of selected) add(fact.ref, storyFactAdmissionRef(entry.preparationHash, fact.ref), "fact");
  const moduleRef = state.campaignRuntime.campaign?.moduleRef;
  if (!isPlainRecord(moduleRef) || typeof moduleRef.profileId !== "string") return fail("story:module-pin-unavailable");
  const pin = `profile-context:${moduleRef.profileId}`;
  const readBindings = requiredContextReadBindings(context);
  const saved = preparedStoryMappings(context, entry.preparationHash);
  for (const [ref, authorityRef] of savedIdentities(preparation, saved)) {
    // Current state and read evidence must prove every reused identity; the
    // old receipt is identity evidence, never a current existence shortcut.
    const relevant = selected.some(fact => factReferences(fact).includes(ref));
    if (!relevant) continue;
    const known = saved.facts.flatMap(value => value.knowledge).find(value => value.candidateRef === ref);
    const readRef = known ? `knowledge:${known.holderRef}:${known.knowledgeRef}` : authorityRef;
    if (!readBindings.has(readRef) || authorityRevisionOrHash(state, readRef) === null) return fail("story:unfrozen-admitted-reference");
    add(ref, authorityRef, state.entities[authorityRef] ? "entity" : state.canonicalFacts[authorityRef] ? "fact"
      : known ? "knowledge" : "basis");
  }
  for (const reference of unique(selected.flatMap(factReferences))) {
    if (bindings.has(reference) || selected.some(fact => fact.knowledge.some(value => value.ref === reference))) continue;
    const actual = reference.startsWith("story-context:open:") ? pin : reference;
    if (!readBindings.has(actual) || authorityRevisionOrHash(state, actual) === null) return fail("story:unfrozen-candidate-reference");
    add(reference, actual, state.entities[actual] ? "entity" : state.canonicalFacts[actual] ? "fact"
      : actual.startsWith("knowledge:") || actual.startsWith("npc-knowledge:") ? "knowledge"
        : actual.startsWith("continuity:sourceClaims:") ? "source" : "basis");
  }
  const actual = (ref: string): string => bindings.get(ref)?.authorityRef ?? fail("story:candidate-binding-missing");
  for (const fact of selected) for (const knowledge of fact.knowledge) {
    add(knowledge.ref, storyKnowledgeAdmissionRef(entry.preparationHash, knowledge.ref, actual(knowledge.holderRef)), "knowledge");
  }
  const authority = materializationAuthorityBasis({ context, state,
    scopeRef: state.entities[input.actorCharacterId]?.sceneId, kind: "worldFact" });
  if (authority.kind !== "accepted") return fail(authority.issues[0]);
  const readSet = [...readBindings.values()].filter(value => authorityRevisionOrHash(state, value.ref) !== null)
    .sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
  const knowledgeBoundaries = Object.values(state.canonicalFacts).flatMap(record => {
    if (!isStoryKnowledgeBoundaryValue(record.value)) return [];
    const boundary = record.value;
    return selected.flatMap(fact => fact.knowledge.filter(value => actual(value.holderRef) === boundary.holderRef
      && actual(fact.ref) === boundary.factRef).map(value => ({ holderRef: boundary.holderRef,
        knowledgeCandidateRef: value.ref, basisRef: record.id, unknownThrough: boundary.unknownThrough })));
  });
  const plan: StoryFactsAdmissionPlan = { schema: STORY_FACTS_ADMISSION_PLAN_SCHEMA,
    proposalRef: input.proposalRef, contextHash: context.binding.contextHash as `sha256:${string}`,
    preparationHash: entry.preparationHash as `sha256:${string}`, facts: selected,
    bindings: [...bindings.values()].sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0),
    readSet, authorizationRefs: authority.basisRefs, knowledgeBoundaries };
  return { kind: "admitStoryFacts", rootActionId: input.rootActionId, actorCharacterId: input.actorCharacterId,
    plan: plan as unknown as JsonRecord };
}
