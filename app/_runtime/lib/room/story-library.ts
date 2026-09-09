import { canonicalHash, deepFreeze, isPlainRecord } from "../kp/vnext/canonical-json";
import type { VNextRequiredContext } from "../kp/vnext/required-context";
import type { StoryJobSnapshot, StoryAdmissionReceipt } from "./story-creation-invocation";
import type { StoryHash, StoryRequest } from "./story-creation/contracts";
import { validateStoredPreparation, validateStoredReview } from "./story-creation/prompt";
import { storyReviewPassed } from "./story-creation/review";
import { storyDefinitionAvailable, storyMappedReference, validStoryMaterialBindings } from "./story-admission";
import type { AuthoritativeWorldState } from "../rules";
import type { AuthoritativeRoomArchive } from "./archive";
import { isHistoricalOrigin } from "../rules/v2/historical-world";
import { isStoryFactBody, isStoryKnowledgeBody, storyFactAdmissionRef } from "../rules/v2/story-facts-admission";
import { reviewedDefinitionEntry } from "../kp/vnext/story-materialization";
import type { StoryBranchSeed } from "./story-history/contracts";
import type { StoryArchiveValidationResult } from "./story-archive";
import type { StoryAdmissionOwner, StoryHostingArtifact, StoryLibraryCatalog, StoryLibraryEntry, StoryLibraryJournal,
  StoryLibraryMappings, StoryLibraryOffer, StoryLibraryOrigin, StoryLibraryResolution, StoryLibraryRoom } from "./story-library-contracts";

export const STORY_LIBRARY_CATALOG_REF = "story-library:catalog";
const hash = (value: unknown) => canonicalHash(value) as StoryHash;
const same = (left: unknown, right: unknown) => hash(left) === hash(right);
const isHash = (value: unknown): value is StoryHash => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => isPlainRecord(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = (): never => { throw new TypeError("STORY_LIBRARY_BINDING_INVALID"); };
const emptyMappings = (): StoryLibraryMappings => ({ definitions: [], facts: [] });
export function validStoryAdmissionOwner(value: unknown): value is StoryAdmissionOwner {
  return exact(value, ["kind", "jobId"]) && value.kind === "creationJob" && typeof value.jobId === "string" && value.jobId.length > 0
    || exact(value, ["kind", "libraryRef"]) && value.kind === "hostingArtifact" && isHash(value.libraryRef);
}
export const storyLibraryRef = (request: StoryRequest): StoryHash => hash({ source: {
  roomId: request.source.roomId, runtimeEpochId: request.source.runtimeEpochId, branchId: request.source.branchId }, opportunityId: request.opportunityId });
export const storyLibraryOwner = (entry: StoryLibraryEntry): StoryAdmissionOwner => entry.origin.kind === "creationJob"
  ? { kind: "creationJob", jobId: entry.origin.jobId } : { kind: "hostingArtifact", libraryRef: entry.libraryRef };

export function storyHostingArtifact(job: Pick<StoryJobSnapshot, "request" | "context" | "checkpoint">): StoryHostingArtifact {
  const preparation = job.checkpoint?.revisedDraft ?? job.checkpoint?.draft;
  const review = job.checkpoint?.revisedReview ?? job.checkpoint?.review;
  if (job.checkpoint?.status !== "ready" || !preparation || !review) return fail();
  const body = { format: "zhuwei.story-hosting-artifact/v1" as const, request: job.request, context: job.context,
    preparation, review, preparationHash: hash(preparation) };
  const artifact = { ...body, artifactHash: hash(body) };
  validateStoryHostingArtifact(artifact);
  return deepFreeze(structuredClone(artifact));
}

export function validateStoryHostingArtifact(value: unknown): asserts value is StoryHostingArtifact {
  if (!exact(value, ["format", "request", "context", "preparation", "review", "preparationHash", "artifactHash"])
    || value.format !== "zhuwei.story-hosting-artifact/v1" || !isHash(value.preparationHash) || !isHash(value.artifactHash)
    || !isPlainRecord(value.request) || !isPlainRecord(value.context) || !isPlainRecord(value.preparation) || !isPlainRecord(value.review)) return fail();
  const artifact = value as unknown as StoryHostingArtifact, { artifactHash, ...body } = artifact;
  validateStoredPreparation(artifact.preparation); validateStoredReview(artifact.review);
  const { contextHash, ...context } = artifact.context;
  if (hash(body) !== artifactHash || hash(context) !== contextHash || hash(artifact.preparation) !== artifact.preparationHash
    || artifact.preparation.jobId !== artifact.request.jobId || artifact.preparation.requestHash !== hash(artifact.request)
    || artifact.preparation.contextHash !== contextHash || artifact.review.contextHash !== contextHash
    || artifact.review.preparationHash !== artifact.preparationHash || !storyReviewPassed(artifact.review)) return fail();
}

export function storyLibraryEntry(room: StoryLibraryRoom, artifact: StoryHostingArtifact, origin: StoryLibraryOrigin): StoryLibraryEntry {
  validateStoryHostingArtifact(artifact);
  const libraryRef = origin.kind === "creationJob" ? storyLibraryRef(artifact.request)
    : hash({ source: origin.source, preparationHash: artifact.preparationHash, seedHash: origin.seedHash });
  const body = { format: "zhuwei.story-library-entry/v1" as const, room, libraryRef, artifact, origin };
  const entry = { ...body, entryHash: hash(body) };
  validateStoryLibraryEntry(entry, room);
  return deepFreeze(structuredClone(entry));
}

export function validateStoryLibraryEntry(value: unknown, room?: StoryLibraryRoom): asserts value is StoryLibraryEntry {
  if (!exact(value, ["format", "room", "libraryRef", "artifact", "origin", "entryHash"])
    || value.format !== "zhuwei.story-library-entry/v1" || !isHash(value.libraryRef) || !isHash(value.entryHash)
    || !exact(value.room, ["roomId", "runtimeEpochId", "branchId"])
    || Object.values(value.room).some(item => typeof item !== "string" || !item)) return fail();
  validateStoryHostingArtifact(value.artifact);
  const entry = value as unknown as StoryLibraryEntry, { entryHash, ...body } = entry;
  if (hash(body) !== entryHash || room && !same(entry.room, room)) return fail();
  const origin = entry.origin;
  if (origin.kind === "creationJob") {
    if (!exact(origin, ["kind", "jobId"]) || origin.jobId !== entry.artifact.request.jobId
      || entry.libraryRef !== storyLibraryRef(entry.artifact.request)
      || !same(entry.room, { roomId: entry.artifact.request.source.roomId,
        runtimeEpochId: entry.artifact.request.source.runtimeEpochId, branchId: entry.artifact.request.source.branchId })) return fail();
  } else if (origin.kind === "historicalSeed") {
    if (!exact(origin, ["kind", "source", "seedHash", "cutEventSeq", "baseline", "timelineBindings"]) || !isHash(origin.seedHash)
      || !/^(0|[1-9][0-9]*)$/u.test(origin.cutEventSeq) || !exact(origin.source, ["roomId", "runtimeEpochId", "branchId", "archiveHash"])
      || !isHash(origin.source.archiveHash) || !exact(origin.baseline, ["definitions", "facts"])
      || !validStoryMaterialBindings(entry.artifact.preparation, origin.baseline.definitions, origin.baseline.facts)
      || !Array.isArray(origin.timelineBindings) || new Set(origin.timelineBindings.map(value => value.sourceTimelineId)).size !== origin.timelineBindings.length
      || origin.timelineBindings.some(value => !exact(value, ["sourceTimelineId", "targetTimelineId"])
        || ![value.sourceTimelineId, value.targetTimelineId].every(value => typeof value === "string" && value.length > 0))
      || entry.libraryRef !== hash({ source: origin.source, preparationHash: entry.artifact.preparationHash, seedHash: origin.seedHash })) return fail();
  } else return fail();
}

/** Mappings are a projection of immutable baseline evidence and current
 * receipts. Conflicting identities never get last-writer-wins treatment. */
export function storyLibraryMappings(entry: StoryLibraryEntry, receipts: readonly StoryAdmissionReceipt[]): StoryLibraryMappings {
  validateStoryLibraryEntry(entry);
  const baseline = entry.origin.kind === "historicalSeed" ? entry.origin.baseline : emptyMappings();
  const owner = storyLibraryOwner(entry);
  const definitions = new Map(baseline.definitions.map(value => [value.candidateRef, value]));
  const facts = new Map(baseline.facts.map(value => [value.candidateRef, value]));
  for (const receipt of receipts) {
    if (!same(receipt.owner, owner) || receipt.preparationHash !== entry.artifact.preparationHash
      || receipt.jobId !== entry.artifact.preparation.jobId) return fail();
    for (const definition of receipt.definitions) {
      const prior = definitions.get(definition.candidateRef);
      if (prior && !same(prior, definition)) return fail();
      definitions.set(definition.candidateRef, definition);
    }
    for (const fact of receipt.facts) {
      const prior = facts.get(fact.candidateRef);
      if (prior && !same(prior, fact)) return fail();
      facts.set(fact.candidateRef, fact);
    }
  }
  const result = { definitions: [...definitions.values()].sort((a, b) => a.candidateRef.localeCompare(b.candidateRef)),
    facts: [...facts.values()].sort((a, b) => a.candidateRef.localeCompare(b.candidateRef)) };
  if (!validStoryMaterialBindings(entry.artifact.preparation, result.definitions, result.facts)) return fail();
  return deepFreeze(structuredClone(result));
}

export function buildStoryLibraryCatalog(input: { room: StoryLibraryRoom; requiredContext: VNextRequiredContext;
  entries: readonly StoryLibraryEntry[]; jobs: readonly Pick<StoryJobSnapshot, "request" | "context" | "checkpoint">[];
  journal?: Pick<StoryLibraryJournal, "readAdmissions"> }): StoryLibraryCatalog {
  return buildStoryLibraryCatalogForScope({ ...input, scopeRefs: input.requiredContext.entries.map(value => value.entryRef) });
}

export function buildStoryLibraryCatalogForScope(input: { room: StoryLibraryRoom; scopeRefs: readonly string[];
  entries: readonly StoryLibraryEntry[]; jobs: readonly Pick<StoryJobSnapshot, "request" | "context" | "checkpoint">[];
  journal?: Pick<StoryLibraryJournal, "readAdmissions"> }): StoryLibraryCatalog {
  const refs = new Set(input.scopeRefs);
  const offers = new Map<string, StoryLibraryOffer>();
  const related = (offer: StoryLibraryOffer) => [...offer.sceneRefs, ...offer.entityRefs].some(ref => refs.has(ref));
  const entityRefs = (entry: StoryLibraryEntry) => [...new Set([...entry.artifact.request.scope.entityIds,
    ...storyLibraryMappings(entry, input.journal?.readAdmissions(storyLibraryOwner(entry)) ?? []).definitions
      .filter(value => reviewedDefinitionEntry(entry.artifact.preparation, value.candidateRef).kind === "materializeNpc").map(value => value.authorityRef)])].sort();
  for (const job of input.jobs) {
    if (!same(input.room, { roomId: job.request.source.roomId, runtimeEpochId: job.request.source.runtimeEpochId, branchId: job.request.source.branchId })) continue;
    const preparation = job.checkpoint?.revisedDraft ?? job.checkpoint?.draft;
    const offer: StoryLibraryOffer = { libraryRef: storyLibraryRef(job.request), opportunityId: job.request.opportunityId,
      owner: { kind: "creationJob", jobId: job.request.jobId }, status: job.checkpoint?.status === "ready" ? "ready"
        : job.checkpoint?.status === "rejected" ? "rejected" : job.checkpoint?.status === "noStory" ? "noStory" : "preparing",
      preparationHash: job.checkpoint?.status === "ready" && preparation ? hash(preparation) : null,
      title: preparation?.title ?? job.request.trigger.goal, centralQuestion: preparation?.centralQuestion ?? job.request.trigger.goal,
      sceneRefs: job.request.scope.sceneIds, entityRefs: job.checkpoint?.status === "ready"
        ? entityRefs(storyLibraryEntry(input.room, storyHostingArtifact(job), { kind: "creationJob", jobId: job.request.jobId }))
        : job.request.scope.entityIds };
    if (related(offer)) offers.set(offer.libraryRef, offer);
  }
  for (const entry of input.entries) {
    if (!same(entry.room, input.room)) continue;
    validateStoryLibraryEntry(entry, input.room);
    const { preparation, request } = entry.artifact;
    const offer: StoryLibraryOffer = { libraryRef: entry.libraryRef, opportunityId: request.opportunityId,
      owner: storyLibraryOwner(entry), status: "ready", preparationHash: entry.artifact.preparationHash,
      title: preparation.title, centralQuestion: preparation.centralQuestion, sceneRefs: request.scope.sceneIds, entityRefs: entityRefs(entry) };
    const prior = offers.get(offer.libraryRef);
    if (prior && !same(prior, offer)) return fail();
    if (related(offer)) offers.set(offer.libraryRef, offer);
  }
  const body = { format: "zhuwei.story-library-catalog/v1" as const, room: input.room,
    offers: [...offers.values()].sort((a, b) => a.libraryRef.localeCompare(b.libraryRef)) };
  return deepFreeze({ ...body, catalogHash: hash(body) });
}

export function storyLibraryCatalog(context: VNextRequiredContext): StoryLibraryCatalog | undefined {
  const rows = context.entries.filter(value => value.entryRef === STORY_LIBRARY_CATALOG_REF);
  if (!rows.length) return undefined;
  const row = rows[0], value = row.kind === "known" ? row.value : undefined;
  if (rows.length !== 1 || row.kind !== "known" || !exact(value, ["format", "room", "offers", "catalogHash"])
    || value.format !== "zhuwei.story-library-catalog/v1" || !Array.isArray(value.offers)
    || row.revisionOrHash !== hash(value) || !context.references.citations.nonCitableRefs.includes(STORY_LIBRARY_CATALOG_REF)) return fail();
  const catalog = value as unknown as StoryLibraryCatalog, { catalogHash, ...body } = catalog;
  if (hash(body) !== catalogHash || catalog.room.runtimeEpochId !== context.binding.roomEpochRef
    || new Set(catalog.offers.map(offer => offer.libraryRef)).size !== catalog.offers.length
    || catalog.offers.some(offer => !exact(offer, ["libraryRef", "opportunityId", "owner", "status", "preparationHash", "title", "centralQuestion", "sceneRefs", "entityRefs"])
      || !isHash(offer.libraryRef) || !validStoryAdmissionOwner(offer.owner)
      || !["preparing", "ready", "rejected", "noStory"].includes(offer.status)
      || !(offer.preparationHash === null || isHash(offer.preparationHash))
      || ![offer.opportunityId, offer.title, offer.centralQuestion].every(value => typeof value === "string" && value.length > 0)
      || ![offer.sceneRefs, offer.entityRefs].every(refs => Array.isArray(refs) && refs.every(value => typeof value === "string" && value.length > 0)))) return fail();
  return deepFreeze(structuredClone(catalog));
}

export function resolveStoryLibrarySelection(input: { libraryRef: string; catalog: StoryLibraryCatalog;
  entries: readonly StoryLibraryEntry[]; journal: StoryLibraryJournal }): StoryLibraryResolution {
  try {
    const selected = input.catalog.offers.find(offer => offer.libraryRef === input.libraryRef);
    if (!selected) return { kind: "rejected", code: "STORY_LIBRARY_UNAVAILABLE" };
    let entry = input.entries.find(value => value.libraryRef === selected.libraryRef);
    if (selected.owner.kind === "creationJob") {
      const job = input.journal.readCreationJob(selected.owner.jobId);
      if (!job || storyLibraryRef(job.request) !== selected.libraryRef) return fail();
      if (job.checkpoint?.status !== "ready") return { kind: "resume", owner: selected.owner, job: structuredClone(job) };
      const current = storyLibraryEntry(input.catalog.room, storyHostingArtifact(job), { kind: "creationJob", jobId: job.request.jobId });
      if (entry && !same(entry, current)) return fail();
      entry = current;
    }
    if (!entry || selected.preparationHash !== null && entry.artifact.preparationHash !== selected.preparationHash) return fail();
    validateStoryLibraryEntry(entry, input.catalog.room);
    const owner = storyLibraryOwner(entry), mappings = storyLibraryMappings(entry, input.journal.readAdmissions(owner));
    return { kind: "ready", entry, owner, mappings };
  } catch { return { kind: "rejected", code: "STORY_LIBRARY_BINDING_INVALID" }; }
}

/** Called with the already validated source envelope and prepared seed. This
 * extracts only the exact reviewed manuscripts retained by the historical
 * cut, never source jobs, model responses, accounts or dispatch capability. */
export function extractHistoricalHostingArtifacts(input: { room: StoryLibraryRoom; seed: StoryBranchSeed;
  validated: Extract<StoryArchiveValidationResult, { kind: "validated" }>;
  targetGenesis: AuthoritativeRoomArchive["signedGenesis"] }): readonly StoryLibraryEntry[] {
  const { seed, validated } = input, { seedHash, ...seedBody } = seed;
  const origin = input.targetGenesis.historicalOrigin;
  if (hash(seedBody) !== seedHash || seed.source.archiveHash !== validated.envelope.archive.archiveHash
    || !isHistoricalOrigin(origin) || origin.source.archiveHash !== seed.source.archiveHash || origin.cut.eventSeq !== seed.cut.eventSeq) return fail();
  return deepFreeze(seed.preparations.map(material => {
    const originalMaterial = validated.historyMaterials.preparations.find(value => value.preparationHash === material.preparationHash);
    if (!originalMaterial || !same(originalMaterial.preparation, material.preparation)
      || material.definitions.some(value => !originalMaterial.definitions.some(known => same(known, value)))
      || material.facts.some(value => !originalMaterial.facts.some(known => known.candidateRef === value.candidateRef
        && same({ ...known, knowledge: value.knowledge }, value)
        && value.knowledge.every(held => known.knowledge.some(prior => same(prior, held)))))) return fail();
    const job = validated.envelope.storySnapshot.jobs.find(row => row.input.request.jobId === material.preparation.jobId);
    let artifact: StoryHostingArtifact | undefined = job ? storyHostingArtifact({ ...job.input, checkpoint: job.checkpoint }) : undefined;
    const inherited = validated.envelope.storySnapshot.hostingArtifacts.find(entry => entry.artifact.preparationHash === material.preparationHash);
    if (!artifact) artifact = inherited?.artifact;
    if (!artifact || artifact.preparationHash !== material.preparationHash || !same(artifact.preparation, material.preparation)) return fail();
    const previous = inherited?.origin.kind === "historicalSeed" ? new Map(inherited.origin.timelineBindings.map(value => [value.sourceTimelineId, value.targetTimelineId])) : new Map<string, string>();
    const timelineBindings = artifact.context.timelines.map(value => {
      const sourceTimelineId = value.timelineId, actualSource = previous.get(sourceTimelineId) ?? sourceTimelineId;
      const target = origin.timelineMap.find(value => value.sourceTimelineId === actualSource);
      if (!target) return fail();
      return { sourceTimelineId, targetTimelineId: target.targetTimelineId };
    }).sort((a, b) => a.sourceTimelineId.localeCompare(b.sourceTimelineId));
    const entry = storyLibraryEntry(input.room, artifact, { kind: "historicalSeed", source: seed.source, seedHash,
      cutEventSeq: seed.cut.eventSeq, baseline: { definitions: material.definitions, facts: material.facts }, timelineBindings });
    validateStoryLibraryGenesis(entry, input.targetGenesis);
    return entry;
  }));
}

/** Baseline membership is proved against the new signed genesis, never by
 * inventing source events in the new room's event stream. */
export function validateStoryLibraryGenesis(entry: StoryLibraryEntry, genesis: AuthoritativeRoomArchive["signedGenesis"]): void {
  const state = genesis.initialState as AuthoritativeWorldState;
  validateStoryLibraryEntry(entry, { roomId: genesis.roomId, runtimeEpochId: genesis.runtimeEpochId, branchId: state.activeBranchId });
  if (entry.origin.kind !== "historicalSeed") return;
  const actual = genesis.historicalOrigin, origin = entry.origin;
  if (!isHistoricalOrigin(actual) || origin.cutEventSeq !== actual.cut.eventSeq
    || !same(origin.source, { roomId: actual.source.roomId, runtimeEpochId: actual.source.runtimeEpochId,
      branchId: actual.source.branchId, archiveHash: actual.source.archiveHash })
    || !same([...entry.artifact.context.timelines.map(value => value.timelineId)].sort(), origin.timelineBindings.map(value => value.sourceTimelineId).sort())
    || origin.timelineBindings.some(value => !state.fictionTimelines[value.targetTimelineId]
      || actual.timelineMap.some(mapped => mapped.sourceTimelineId === value.sourceTimelineId && mapped.targetTimelineId !== value.targetTimelineId))) return fail();
  validateStoryGenesisMappings(entry.artifact.preparation, origin.baseline, state);
}

export function validateStoryGenesisMappings(preparation: import("./story-creation/contracts").StoryPreparation,
  mappings: StoryLibraryMappings, state: AuthoritativeWorldState): void {
  if (!validStoryMaterialBindings(preparation, mappings.definitions, mappings.facts)) return fail();
  for (const value of mappings.definitions) {
    const candidate = reviewedDefinitionEntry(preparation, value.candidateRef);
    const actual = candidate.kind === "materializeNpc" ? state.entities[value.authorityRef]?.kind === "npc"
      : candidate.kind === "materializeItem" ? !!state.campaignRuntime.itemSystem.entries[value.authorityRef]
        : storyDefinitionAvailable(state, value.authorityRef);
    if (!actual || value.definitionRefs.some(ref => !storyDefinitionAvailable(state, ref))) return fail();
  }
  const actual = (ref: string) => storyMappedReference(preparation, mappings.definitions, mappings.facts, ref);
  for (const value of mappings.facts) {
    const candidate = preparation.facts.find(item => item.ref === value.candidateRef)!, fact = state.canonicalFacts[value.factRef];
    const { knowledge: _knowledge, ...core } = candidate;
    if (!fact || fact.branchId !== state.activeBranchId || !isStoryFactBody(fact.value)
      || value.factRef !== storyFactAdmissionRef(hash(preparation), candidate.ref)
      || fact.value.candidateHash !== hash(candidate) || !same(fact.value.candidate, core)
      || !same(fact.subjectRefs, candidate.subjectRefs.map(actual))
      || value.definitionRefs.some(ref => !storyDefinitionAvailable(state, ref))) return fail();
    for (const known of value.knowledge) {
      const proposed = candidate.knowledge.find(item => item.ref === known.candidateRef)!;
      const record = state.knowledge[known.holderRef]?.[known.knowledgeRef];
      if (!record || !isStoryKnowledgeBody(record.content) || !same(record.content.candidate, proposed)
        || record.characterId !== actual(proposed.holderRef) || record.knowledgeRef !== known.knowledgeRef
        || record.acquiredByEventId !== known.recordedByEventId || !record.provenanceChain.includes(value.factRef)
        || !record.provenanceChain.includes(actual(proposed.sourceRef))) return fail();
    }
  }
}
