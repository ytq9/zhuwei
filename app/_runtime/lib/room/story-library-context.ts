import { canonicalHash, deepFreeze, isPlainRecord, type JsonValue } from "../kp/vnext/canonical-json";
import { buildRequiredContext, type VNextRequiredContext } from "../kp/vnext/required-context";
import type { AuthoritativeModuleProfile } from "../module/authoritative";
import type { AuthoritativeWorldState } from "../rules/authority-read";
import type { RuntimeProfileManifest } from "../rules/profiles/types";
import type { StoryContext, StoryContextMaterial, StoryHash, StoryRequest } from "./story-creation/contracts";
import type { StoryLibraryBinding, StoryLibraryCatalog, StoryLibraryEntry, StoryLibraryMappings } from "./story-library-contracts";
import { STORY_LIBRARY_CATALOG_REF, storyLibraryOwner, validateStoryLibraryEntry } from "./story-library";
import { bindStoryPreparationContext } from "./story-action-context";
import { validateRoomStoryContext } from "./story-context";
import { reviewedDefinitionEntry } from "../kp/vnext/story-materialization";

const hash = (value: unknown) => canonicalHash(value) as StoryHash;
export function bindStoryLibraryCatalog(context: VNextRequiredContext, catalog: StoryLibraryCatalog, maxUnits: number) {
  const { contextHash: _hash, ...binding } = context.binding;
  return buildRequiredContext({ intent: context.intent, binding,
    entries: [...context.entries, { kind: "known", entryRef: STORY_LIBRARY_CATALOG_REF, revisionOrHash: hash(catalog), value: catalog as unknown as JsonValue }],
    references: { ...context.references, citations: { ...context.references.citations,
      nonCitableRefs: [...context.references.citations.nonCitableRefs, STORY_LIBRARY_CATALOG_REF] } }, maxUnits });
}

/** The transcript of authorship is never rewritten. Compare the meaning in
 * declared authoritative materials, excluding only historical recording IDs.
 * New/current material and collection witnesses remain in currentContext. */
function meaning(material: StoryContextMaterial): unknown {
  const content = material.content;
  if (!isPlainRecord(content)) return content;
  if (material.kind === "knowledge" && isPlainRecord(content.record)) {
    const record = content.record;
    return { holderRef: content.holderRef, content: record.content, kind: record.objectKind,
      sourceCharacterId: record.sourceCharacterId, provenanceChain: record.provenanceChain };
  }
  if (["fact", "anchor", "narrativeCommitment"].includes(material.kind) && Object.hasOwn(content, "value")) {
    return { kind: content.kind, subjectRefs: content.subjectRefs, value: content.value, source: content.source };
  }
  return content;
}

export function storyLibraryBlockedCandidates(entry: StoryLibraryEntry, mappings: StoryLibraryMappings, current: StoryContext): readonly string[] {
  const { preparation, context: original } = entry.artifact;
  const prior = new Map(original.materials.map(value => [value.ref, value]));
  const now = new Map(current.materials.map(value => [value.ref, value]));
  const admitted = new Set([...mappings.definitions, ...mappings.facts].map(value => value.candidateRef));
  const admittedAuthority = new Set([...mappings.definitions.flatMap(value => [value.authorityRef, ...value.definitionRefs]),
    ...mappings.facts.flatMap(value => [value.factRef, ...value.knowledge.flatMap(known => [known.knowledgeRef,
      `knowledge:${known.holderRef}:${known.knowledgeRef}`])])]);
  const actorMeaning = (material: StoryContextMaterial) => {
    const content = material.content;
    return isPlainRecord(content) && isPlainRecord(content.entity)
      ? { kind: content.entity.kind, name: content.entity.name, tenureStatus: content.entity.tenureStatus }
      : content;
  };
  const changed = (ref: string): boolean => {
    const before = prior.get(ref); if (!before) return false;
    const actual = now.get(ref);
    if (!actual || actual.availability !== before.availability) return true;
    if (before.kind === "npc") return hash(actorMeaning(before)) !== hash(actorMeaning(actual));
    // Time, current entity mechanics and mutable NPC plans are read anew by
    // normal filling/Rules. Established evidence and explicit constraints are
    // never allowed to change meaning under an old reviewed candidate.
    return ["fact", "anchor", "knowledge", "relationship", "promise", "narrativeCommitment", "definition", "contentBoundary"].includes(before.kind)
      && hash(meaning(before)) !== hash(meaning(actual));
  };
  // Re-evaluate collection meaning as well as named records. A newly related
  // fact/person/commitment cannot disappear merely because the old manuscript
  // did not know its ID. Own committed additions are already proven mappings.
  const deltas = current.materials.filter(material => !admittedAuthority.has(material.ref)
    && ["fact", "anchor", "knowledge", "relationship", "promise", "narrativeCommitment", "plan", "npc"].includes(material.kind)
    && (!prior.has(material.ref) || changed(material.ref)));
  const collectionChanged = (refs: readonly string[]) => {
    const selected = new Set(refs);
    for (const value of mappings.definitions) if (selected.has(value.candidateRef)) selected.add(value.authorityRef);
    return deltas.some(material => selected.has(material.ref) || material.subjectRefs.some(ref => selected.has(ref)));
  };
  const blocked = new Set<string>();
  const coreChanged = preparation.existingFactRefs.some(changed)
    || hash(original.moduleRef) !== hash(current.moduleRef) || hash(original.runtimeRef) !== hash(current.runtimeRef);
  for (const candidate of preparation.definitions) if (!admitted.has(candidate.ref)) {
    const producer = reviewedDefinitionEntry(preparation, candidate.ref);
    const refs = [...candidate.dependsOn, ...producer.basisRefs];
    if (coreChanged || refs.some(changed) || collectionChanged(refs)) blocked.add(candidate.ref);
  }
  for (const fact of preparation.facts) if (!admitted.has(fact.ref)) {
    const refs = [...fact.basisRefs, ...fact.subjectRefs, ...fact.occurrence.basisRefs,
      ...fact.knowledge.flatMap(value => [value.holderRef, value.sourceRef, ...value.acquisition.basisRefs])];
    if (coreChanged || refs.some(changed) || collectionChanged(refs)) blocked.add(fact.ref);
  }
  let expanded = true;
  while (expanded) { expanded = false;
    for (const candidate of preparation.definitions) if (!blocked.has(candidate.ref) && candidate.dependsOn.some(ref => blocked.has(ref))) {
      blocked.add(candidate.ref); expanded = true;
    }
  }
  return [...blocked].sort();
}

export function bindStoryLibrarySelection(input: Readonly<{
  entry: StoryLibraryEntry; mappings: StoryLibraryMappings; currentRequest: StoryRequest; currentContext: StoryContext;
  selectionContext: VNextRequiredContext; moduleProfile: AuthoritativeModuleProfile; profiles: RuntimeProfileManifest;
  state: AuthoritativeWorldState; maxUnits: number;
}>) {
  try {
    validateStoryLibraryEntry(input.entry, { roomId: input.state.roomId, runtimeEpochId: input.state.runtimeEpochId, branchId: input.state.activeBranchId });
    const checked = validateRoomStoryContext({ request: input.currentRequest, context: input.currentContext,
      state: input.state, profiles: input.profiles, moduleProfile: input.moduleProfile });
    if (checked.kind !== "valid") return { kind: "rejected" as const, code: "STORY_CONTEXT_STALE" };
    const body = { entry: input.entry, owner: storyLibraryOwner(input.entry), mappings: input.mappings,
      currentRequest: input.currentRequest, currentContext: input.currentContext,
      blockedCandidateRefs: storyLibraryBlockedCandidates(input.entry, input.mappings, input.currentContext) };
    const library: StoryLibraryBinding = deepFreeze({ ...body, validationHash: hash(body) });
    return bindStoryPreparationContext({ selectionContext: input.selectionContext, moduleProfile: input.moduleProfile,
      preparation: input.entry.artifact.preparation, review: input.entry.artifact.review, storyContext: input.currentContext,
      state: input.state, maxUnits: input.maxUnits, library });
  } catch { return { kind: "rejected" as const, code: "STORY_LIBRARY_BINDING_INVALID" }; }
}

export function roomStoryReuseRequest(context: VNextRequiredContext, state: AuthoritativeWorldState, entry: StoryLibraryEntry,
  mappings: StoryLibraryMappings): StoryRequest {
  const actor = state.entities[context.intent.actorRef];
  if (!actor) throw new TypeError("STORY_CONTEXT_INSUFFICIENT");
  const request = entry.artifact.request;
  return { ...request, source: { roomId: state.roomId, runtimeEpochId: state.runtimeEpochId, branchId: state.activeBranchId,
    kind: "playerAction", sourceId: context.binding.rootActionId, budgetAccountId: `source-budget:${state.runtimeEpochId}:${context.binding.rootActionId}` },
    trigger: { kind: "continuePreparation", goal: context.intent.text, basisRefs: [actor.id, actor.sceneId] },
    scope: { sceneIds: [...new Set([...request.scope.sceneIds, actor.sceneId])].sort(),
      entityIds: [...new Set([...request.scope.entityIds, actor.id, ...mappings.definitions.filter(value => state.entities[value.authorityRef]).map(value => value.authorityRef)])].sort() } };
}
