import { canonicalSha256 } from "../profiles/canonical";
import type { RuntimeProfileManifest, Sha256Ref } from "../profiles/types";
import { worldInteractionProfileEnabled } from "../profiles/vnext-world-interaction";
import { authorityReadSetMatches, authorityRevisionOrHash } from "./authority-bindings";
import { heldKnowledgeRecord } from "./knowledge-records";
import type { AuthoritativeWorldState, EventPayloadByType, JsonRecord, KnowledgeAcquiredPayload,
  KnowledgeRecord, RejectedRulesResult, StepResult } from "./model";
import type { NpcMaterializationAccumulator } from "./npc-materialization";
import { rejected } from "./results";
import { isStoryTemporalBasis, isStoryTemporalEvidence, storyTemporalEvidenceIssue, storyTemporalEvidenceRef,
  storyTemporalKnowledgeKind, storyTemporalPosition, storyTemporalReferenceAvailable, type StoryTemporalBasis, type StoryTemporalEvidence } from "./story-temporal-evidence";
import { characterTimelineId } from "./timeline";
import { hasExactKeys, isRecord, isSha256 } from "./validation";
import { isCanonicalReadSet, type VersionedAuthorityBinding } from "./world-interaction-model";

/** Structural source protocol shared with Story preparation. This pure Rules
 * module does not import the Room store, review runner or mutable job state. */
export type StoryAdmissionKnowledgeCandidate = Readonly<{
  ref: string; holderRef: string; factRef: string; layer: "truth" | "sensoryEvidence" | "sourceClaim" | "inference";
  content: string; sourceRef: string; acquisition: StoryTemporalBasis; explanation: string;
}>;
export type StoryAdmissionFactCandidate = Readonly<{
  ref: string; layer: "worldTruth" | "statement"; content: string; subjectRefs: readonly string[];
  occurrence: StoryTemporalBasis; basisRefs: readonly string[];
  creationBasis: "existingEvidence" | "authorizedOpenSpace";
  knowledge: readonly StoryAdmissionKnowledgeCandidate[];
}>;
export type StoryAdmissionBinding = Readonly<{
  ref: string; authorityRef: string; kind: "entity" | "fact" | "knowledge" | "source" | "basis";
}>;
/** Only an existing typed association may become this mechanical boundary.
 * Natural-language initialUnknowns stay the independent review's judgment. */
export type StoryKnowledgeBoundary = Readonly<{
  holderRef: string; knowledgeCandidateRef: string; basisRef: string;
  unknownThrough: StoryTemporalBasis["start"];
}>;
export type StoryKnowledgeBoundaryValue = Readonly<{
  schema: "zhuwei.knowledge-boundary/v1";
  holderRef: string; factRef: string; unknownThrough: StoryTemporalBasis["start"];
}>;
export const STORY_FACTS_ADMISSION_PLAN_SCHEMA = "zhuwei.story-facts-admission-plan/v1" as const;
export type StoryFactsAdmissionPlan = Readonly<{
  schema: typeof STORY_FACTS_ADMISSION_PLAN_SCHEMA;
  proposalRef: string; contextHash: Sha256Ref; preparationHash: Sha256Ref;
  facts: readonly StoryAdmissionFactCandidate[];
  bindings: readonly StoryAdmissionBinding[];
  readSet: readonly VersionedAuthorityBinding[];
  authorizationRefs: readonly string[];
  knowledgeBoundaries: readonly StoryKnowledgeBoundary[];
}>;
export type StoryFactsAdmissionInput = Readonly<{
  kind: "admitStoryFacts"; rootActionId: string; actorCharacterId: string; plan: StoryFactsAdmissionPlan;
}>;
export type StoryFactBody = Readonly<{
  schema: "zhuwei.story-fact-body/v1";
  preparationHash: Sha256Ref; candidateHash: Sha256Ref; rootActionId: string; proposalRef: string; contextHash: Sha256Ref;
  candidate: Omit<StoryAdmissionFactCandidate, "knowledge">;
  bindings: readonly StoryAdmissionBinding[];
  authorizationRefs: readonly string[];
}>;
export type StoryKnowledgeBody = Readonly<{
  schema: "zhuwei.story-knowledge-body/v1";
  preparationHash: Sha256Ref; candidate: StoryAdmissionKnowledgeCandidate; bindings: readonly StoryAdmissionBinding[];
}>;
export type StoryKnowledgeAdmissionMetadata = Readonly<{
  schema: "zhuwei.story-knowledge-admission/v1";
  preparationHash: Sha256Ref; candidateRef: string; factRef: string; sourceRef: string; acquisition: StoryTemporalBasis;
}>;
export type StoryAdmittedKnowledgePayload = Extract<KnowledgeAcquiredPayload, { causeFactId: string }> & {
  storyAdmission: StoryKnowledgeAdmissionMetadata;
};
type DraftBase = { reads: string[]; writes: string[]; creates: string[]; visibilityPolicyId: string;
  secrecy: "internal" | "private" };
export type StoryFactsAdmissionDraft = DraftBase & (
  { eventType: "CanonicalFactDeclared"; payload: EventPayloadByType["CanonicalFactDeclared"] }
  | { eventType: "KnowledgeAcquired"; payload: StoryAdmittedKnowledgePayload }
);
export type PreparedStoryFactsAdmission = Readonly<{
  kind: "prepared"; drafts: readonly StoryFactsAdmissionDraft[];
  factRefs: readonly string[]; createdAuthorityRefs: readonly string[];
}>;
const ref = (value: unknown): value is string => typeof value === "string" && value.length > 0
  && value.length <= 400 && /^\S+$/u.test(value) && value.normalize("NFC") === value;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
  && value.length <= 16_000 && value.normalize("NFC") === value;
const refs = (value: unknown, minimum = 0): value is readonly string[] => Array.isArray(value)
  && value.length >= minimum && value.length <= 128 && value.every(ref) && new Set(value).size === value.length;
const same = (left: unknown, right: unknown): boolean => canonicalSha256(left) === canonicalSha256(right);
function point(value: unknown): value is StoryTemporalBasis["start"] {
  return isRecord(value) && hasExactKeys(value, ["timelineId", "micros"]) && ref(value.timelineId)
    && typeof value.micros === "string" && /^(0|[1-9][0-9]*)$/u.test(value.micros);
}
function time(value: unknown): value is StoryTemporalBasis {
  return isStoryTemporalBasis(value) && point(value.start) && (value.end === null || point(value.end))
    && refs(value.basisRefs, 1);
}
function knowledgeCandidate(value: unknown): value is StoryAdmissionKnowledgeCandidate {
  return isRecord(value) && hasExactKeys(value, ["ref", "holderRef", "factRef", "layer", "content", "sourceRef", "acquisition", "explanation"])
    && [value.ref, value.holderRef, value.factRef, value.sourceRef].every(ref)
    && ["truth", "sensoryEvidence", "sourceClaim", "inference"].includes(String(value.layer))
    && text(value.content) && text(value.explanation) && time(value.acquisition);
}
function factCore(value: unknown): value is Omit<StoryAdmissionFactCandidate, "knowledge"> {
  return isRecord(value) && hasExactKeys(value, ["ref", "layer", "content", "subjectRefs", "occurrence", "basisRefs", "creationBasis"])
    && ref(value.ref) && ["worldTruth", "statement"].includes(String(value.layer)) && text(value.content)
    && refs(value.subjectRefs, 1) && refs(value.basisRefs, 1) && time(value.occurrence)
    && ["existingEvidence", "authorizedOpenSpace"].includes(String(value.creationBasis));
}
function factCandidate(value: unknown): value is StoryAdmissionFactCandidate {
  if (!isRecord(value) || !Array.isArray(value.knowledge) || value.knowledge.length > 40) return false;
  const { knowledge, ...core } = value;
  return factCore(core) && knowledge.every(knowledgeCandidate)
    && knowledge.every(entry => entry.factRef === core.ref)
    && new Set(knowledge.map(entry => entry.ref)).size === knowledge.length
    && new Set(knowledge.map(entry => entry.holderRef)).size === knowledge.length;
}
function bindings(value: unknown): value is readonly StoryAdmissionBinding[] {
  return Array.isArray(value) && value.length <= 256 && value.every(entry => isRecord(entry)
    && hasExactKeys(entry, ["ref", "authorityRef", "kind"]) && ref(entry.ref) && ref(entry.authorityRef)
    && ["entity", "fact", "knowledge", "source", "basis"].includes(String(entry.kind)))
    && new Set(value.map(entry => entry.ref)).size === value.length;
}
export function isStoryKnowledgeBoundaryValue(value: unknown): value is StoryKnowledgeBoundaryValue {
  return isRecord(value) && hasExactKeys(value, ["schema", "holderRef", "factRef", "unknownThrough"])
    && value.schema === "zhuwei.knowledge-boundary/v1" && ref(value.holderRef) && ref(value.factRef) && point(value.unknownThrough);
}
export function isStoryFactsAdmissionPlan(value: unknown): value is StoryFactsAdmissionPlan {
  return isRecord(value) && hasExactKeys(value, ["schema", "proposalRef", "contextHash", "preparationHash", "facts",
    "bindings", "readSet", "authorizationRefs", "knowledgeBoundaries"])
    && value.schema === STORY_FACTS_ADMISSION_PLAN_SCHEMA && ref(value.proposalRef)
    && isSha256(value.contextHash) && isSha256(value.preparationHash)
    && Array.isArray(value.facts) && value.facts.length > 0 && value.facts.length <= 40 && value.facts.every(factCandidate)
    && new Set(value.facts.flatMap(fact => [fact.ref, ...fact.knowledge.map(entry => entry.ref)])).size
      === value.facts.reduce((count, fact) => count + 1 + fact.knowledge.length, 0)
    && bindings(value.bindings) && isCanonicalReadSet(value.readSet) && refs(value.authorizationRefs, 1)
    && Array.isArray(value.knowledgeBoundaries) && value.knowledgeBoundaries.length <= 128
    && value.knowledgeBoundaries.every(entry => isRecord(entry)
      && hasExactKeys(entry, ["holderRef", "knowledgeCandidateRef", "basisRef", "unknownThrough"])
      && [entry.holderRef, entry.knowledgeCandidateRef, entry.basisRef].every(ref) && point(entry.unknownThrough));
}
export function isStoryFactBody(value: unknown): value is StoryFactBody {
  return isRecord(value) && hasExactKeys(value, ["schema", "preparationHash", "candidateHash", "rootActionId", "proposalRef", "contextHash", "candidate", "bindings", "authorizationRefs"])
    && value.schema === "zhuwei.story-fact-body/v1" && [value.preparationHash, value.candidateHash, value.contextHash].every(isSha256)
    && ref(value.rootActionId) && ref(value.proposalRef) && factCore(value.candidate) && bindings(value.bindings) && refs(value.authorizationRefs, 1);
}
export function isStoryKnowledgeBody(value: unknown): value is StoryKnowledgeBody {
  return isRecord(value) && hasExactKeys(value, ["schema", "preparationHash", "candidate", "bindings"])
    && value.schema === "zhuwei.story-knowledge-body/v1" && isSha256(value.preparationHash)
    && knowledgeCandidate(value.candidate) && bindings(value.bindings);
}
export function isStoryKnowledgeAdmissionMetadata(value: unknown): value is StoryKnowledgeAdmissionMetadata {
  return isRecord(value) && hasExactKeys(value, ["schema", "preparationHash", "candidateRef", "factRef", "sourceRef", "acquisition"])
    && value.schema === "zhuwei.story-knowledge-admission/v1" && isSha256(value.preparationHash)
    && [value.candidateRef, value.factRef, value.sourceRef].every(ref) && time(value.acquisition);
}
export function storyFactAdmissionRef(preparationHash: string, candidateRef: string): string {
  return `fact:story:${canonicalSha256({ preparationHash, candidateRef }).slice(7)}`;
}
export function storyKnowledgeAdmissionRef(preparationHash: string, candidateRef: string, holderRef: string): string {
  return `knowledge:story:${canonicalSha256({ preparationHash, candidateRef, holderRef }).slice(7)}`;
}
function resolve(bound: readonly StoryAdmissionBinding[], original: string): string {
  return bound.find(entry => entry.ref === original)?.authorityRef ?? original;
}
export function resolveStoryAdmissionTime(value: StoryTemporalBasis, bound: readonly StoryAdmissionBinding[]): StoryTemporalBasis {
  return { ...structuredClone(value),
    start: { ...value.start, timelineId: resolve(bound, value.start.timelineId) },
    end: value.end === null ? null : { ...value.end, timelineId: resolve(bound, value.end.timelineId) },
    basisRefs: [...new Set(value.basisRefs.map(original => resolve(bound, original)))].sort() };
}
function temporalSourceRefs(value: StoryTemporalBasis): string[] {
  return [value.start.timelineId, ...(value.end === null ? [] : [value.end.timelineId]), ...value.basisRefs];
}
function relevantBindings(bound: readonly StoryAdmissionBinding[], sourceRefs: readonly string[]): StoryAdmissionBinding[] {
  const selected = new Set(sourceRefs);
  return bound.filter(entry => selected.has(entry.ref)).map(entry => structuredClone(entry));
}
function upper(value: StoryTemporalBasis): bigint { return BigInt(value.end?.micros ?? value.start.micros); }
function after(source: StoryTemporalBasis, acquisition: StoryTemporalBasis): boolean {
  return source.start.timelineId === acquisition.start.timelineId && acquisition.kind !== "before"
    && upper(source) <= BigInt(acquisition.start.micros);
}
function nowBasis(state: AuthoritativeWorldState, holderRef: string): StoryTemporalBasis | undefined {
  const timelineId = characterTimelineId(state, holderRef);
  return timelineId === undefined ? undefined : { kind: "at", start: { timelineId, micros: state.fictionTimelines[timelineId].nowMicros },
    end: null, basisRefs: [holderRef] };
}
function temporalRefAvailable(state: AuthoritativeWorldState, reference: string): boolean {
  return storyTemporalReferenceAvailable(state, reference);
}
function sourceClaimAtRef(state: AuthoritativeWorldState, reference: string): JsonRecord | undefined {
  const claimRef = reference.startsWith("continuity:sourceClaims:") ? reference.slice("continuity:sourceClaims:".length) : reference;
  return state.campaignRuntime.sourceClaims[claimRef];
}
function knowledgeAtRef(state: AuthoritativeWorldState, reference: string): KnowledgeRecord | undefined {
  const records = Object.entries(state.knowledge).flatMap(([holder, entries]) => Object.keys(entries).flatMap(key => {
    if (![key, `knowledge:${holder}:${key}`, `npc-knowledge:${holder}:${key}`].includes(reference)) return [];
    const record = heldKnowledgeRecord(state, holder, key);
    return record ? [record] : [];
  }));
  return records.length === 1 ? records[0] : undefined;
}
function knowledgeTime(state: AuthoritativeWorldState, record: KnowledgeRecord): StoryTemporalBasis | undefined {
  for (const fact of Object.values(state.canonicalFacts)) if (fact.kind === "storyTemporalEvidence" && isStoryTemporalEvidence(fact.value)) {
    const entry = fact.value.knowledge.find(entry => entry.holderRef === record.characterId && entry.knowledgeRef === record.knowledgeRef);
    if (entry) return entry.acquisition;
  }
  if (isStoryKnowledgeBody(record.content)) return resolveStoryAdmissionTime(record.content.candidate.acquisition, record.content.bindings);
  // Knowing a record now proves its present availability; it does not locate
  // an older acquisition on the holder's current timeline.
  return nowBasis(state, record.characterId);
}
type Source = { kind: "fact" | "knowledge" | "entity" | "claim"; ref: string; holderRef?: string;
  layer?: StoryAdmissionKnowledgeCandidate["layer"]; occurrence: StoryTemporalBasis; subjects: readonly string[];
  communicationChannel?: boolean };
function existingSource(state: AuthoritativeWorldState, reference: string, actorRef: string): Source | undefined {
  const held = knowledgeAtRef(state, reference);
  if (held) {
    const occurrence = knowledgeTime(state, held);
    return occurrence && { kind: "knowledge", ref: reference, holderRef: held.characterId,
      layer: ({ canonicalFact: "truth", sensoryEvidence: "sensoryEvidence", sourceClaim: "sourceClaim", characterInference: "inference" } as const)[held.objectKind],
      occurrence, subjects: [held.characterId] };
  }
  const fact = state.canonicalFacts[reference];
  if (fact) {
    const occurrence = isStoryFactBody(fact.value) ? resolveStoryAdmissionTime(fact.value.candidate.occurrence, fact.value.bindings)
      : Object.values(state.canonicalFacts).flatMap(entry => entry.kind === "storyTemporalEvidence" && isStoryTemporalEvidence(entry.value)
        && entry.value.factRef === reference ? [entry.value.occurrence] : [])[0] ?? nowBasis(state, actorRef);
    return occurrence && { kind: "fact", ref: reference, occurrence, subjects: fact.subjectRefs,
      communicationChannel: fact.kind === "establishedCommunicationChannel",
      ...(isStoryFactBody(fact.value) && fact.value.candidate.layer === "statement" ? { layer: "sourceClaim" as const } : {}) };
  }
  const claim = sourceClaimAtRef(state, reference);
  if (claim && ref(claim.speakerId)) {
    const occurrence = nowBasis(state, claim.speakerId);
    return occurrence && { kind: "claim", ref: reference, holderRef: claim.speakerId, layer: "sourceClaim", occurrence, subjects: [claim.speakerId] };
  }
  const entity = state.entities[reference], occurrence = nowBasis(state, reference);
  return entity && occurrence ? { kind: "entity", ref: reference, holderRef: reference, occurrence, subjects: [reference] } : undefined;
}
function sourceIssue(state: AuthoritativeWorldState, knowledge: StoryAdmissionKnowledgeCandidate, holder: string,
  source: Source | undefined, fact: Source, acquisition: StoryTemporalBasis, sources: ReadonlyMap<string, Source>, acquisitionRefs: readonly string[]): string | undefined {
  if (!source || !after(source.occurrence, acquisition)) return "story-admission:knowledge-source-time-unproven";
  if (!after(fact.occurrence, acquisition)) return "story-admission:knowledge-precedes-occurrence";
  if (knowledge.layer === "truth" && (fact.layer === "sourceClaim" || source.layer === "sourceClaim" || source.layer === "inference")) {
    return "story-admission:claim-or-inference-cannot-be-promoted-to-truth";
  }
  if (knowledge.layer === "sensoryEvidence" && (source.layer === "sourceClaim" || source.layer === "inference")) {
    return "story-admission:claim-or-inference-cannot-be-promoted-to-perception";
  }
  if (knowledge.layer === "inference" && (source.kind !== "knowledge" || source.holderRef !== holder)) {
    return "story-admission:inference-requires-own-held-evidence";
  }
  const sourceHolder = source.holderRef;
  if (sourceHolder && sourceHolder !== holder) {
    const communicated = acquisitionRefs.some(reference => {
      const channel = sources.get(reference) ?? existingSource(state, reference, holder);
      return channel?.kind === "fact" && channel.communicationChannel === true && channel.layer !== "sourceClaim" && channel.subjects.includes(holder)
        && channel.subjects.includes(sourceHolder) && after(channel.occurrence, acquisition);
    });
    if (!communicated) return "story-admission:foreign-knowledge-needs-an-established-transfer";
  }
  if (source.kind === "fact" && !source.subjects.includes(holder)
    && !acquisitionRefs.some(reference => state.entities[holder]?.semanticDefinitionRef === reference
      || knowledgeAtRef(state, reference)?.characterId === holder
      || (sources.get(reference) ?? existingSource(state, reference, holder))?.subjects.includes(holder))) {
    return "story-admission:knowledge-needs-a-holder-specific-acquisition-basis";
  }
  return undefined;
}
function boundaryIssue(state: AuthoritativeWorldState, holder: string, factRef: string, acquisition: StoryTemporalBasis): string | undefined {
  for (const fact of Object.values(state.canonicalFacts)) {
    const value = fact.value;
    if (!isStoryKnowledgeBoundaryValue(value) || value.holderRef !== holder || value.factRef !== factRef) continue;
    if (value.unknownThrough.timelineId !== acquisition.start.timelineId
      || BigInt(acquisition.start.micros) <= BigInt(value.unknownThrough.micros)) return "story-admission:explicit-unknown-boundary-conflict";
  }
  return undefined;
}

export function storyFactAdmissionIssue(state: AuthoritativeWorldState, value: unknown, rootActionId?: string): string | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["fact"]) || !isRecord(value.fact) || !isStoryFactBody(value.fact.value)) {
    return "story-admission:fact-body-invalid";
  }
  const fact = value.fact, body = value.fact.value, candidate = body.candidate;
  const occurrence = resolveStoryAdmissionTime(candidate.occurrence, body.bindings);
  const moduleRef = state.campaignRuntime.campaign?.moduleRef;
  if (!isRecord(moduleRef) || typeof moduleRef.profileId !== "string") return "story-admission:module-pin-unavailable";
  const pin = `profile-context:${moduleRef.profileId}`;
  if (fact.kind !== "storyFact" || fact.source !== "dynamicMaterialization" || fact.visibilityPolicyId !== "visibility:kp-internal"
    || fact.id !== storyFactAdmissionRef(body.preparationHash, candidate.ref)
    || body.bindings.find(entry => entry.ref === candidate.ref)?.kind !== "fact"
    || !same(body.bindings, relevantBindings(body.bindings, [candidate.ref, ...candidate.subjectRefs,
      ...candidate.basisRefs, ...temporalSourceRefs(candidate.occurrence)]))
    || resolve(body.bindings, candidate.ref) !== fact.id || (rootActionId !== undefined && rootActionId !== body.rootActionId)
    || !same(fact.subjectRefs, candidate.subjectRefs.map(reference => resolve(body.bindings, reference)))
    || candidate.subjectRefs.some(reference => authorityRevisionOrHash(state, resolve(body.bindings, reference)) === null)
    || !body.authorizationRefs.includes(pin) || body.authorizationRefs.some(reference => authorityRevisionOrHash(state, reference) === null)
    || candidate.basisRefs.some(reference => authorityRevisionOrHash(state, resolve(body.bindings, reference)) === null)
    || !refs(fact.causalParentIds) || fact.causalParentIds.some(reference => state.canonicalFacts[reference] === undefined)
    || authorityRevisionOrHash(state, String(fact.id)) !== null || storyTemporalPosition(occurrence, state) !== "established"
    || !occurrence.basisRefs.every(reference => temporalRefAvailable(state, reference))) {
    return "story-admission:fact-binding-or-occurrence-invalid";
  }
  return undefined;
}

/** Shared by the normal KnowledgeAcquired writer and replay, before its one
 * authoritative record write. The caller adds metadata.sourceRef to the
 * normal provenance chain; acquiredAt remains the actual event write time. */
export function storyKnowledgeAdmissionIssue(state: AuthoritativeWorldState, value: unknown, rootActionId?: string): string | undefined {
  if (!isRecord(value) || !isStoryKnowledgeAdmissionMetadata(value.storyAdmission) || !isStoryKnowledgeBody(value.content)) {
    return "story-admission:knowledge-metadata-or-body-invalid";
  }
  const metadata = value.storyAdmission, body = value.content, candidate = body.candidate;
  const fact = state.canonicalFacts[metadata.factRef];
  if (!fact || !isStoryFactBody(fact.value) || fact.value.preparationHash !== metadata.preparationHash
    || body.preparationHash !== metadata.preparationHash || metadata.candidateRef !== candidate.ref
    || candidate.factRef !== fact.value.candidate.ref || (rootActionId !== undefined && rootActionId !== fact.value.rootActionId)
    || value.characterId !== resolve(body.bindings, candidate.holderRef)
    || body.bindings.find(entry => entry.ref === candidate.ref)?.kind !== "knowledge"
    || body.bindings.some(entry => entry.ref === candidate.holderRef && entry.kind !== "entity")
    || !same(body.bindings, relevantBindings(body.bindings, [candidate.ref, candidate.holderRef, candidate.factRef,
      candidate.sourceRef, ...temporalSourceRefs(candidate.acquisition)]))
    || value.knowledgeRef !== storyKnowledgeAdmissionRef(metadata.preparationHash, candidate.ref, String(value.characterId))
    || value.causeFactId !== metadata.factRef || resolve(body.bindings, candidate.factRef) !== metadata.factRef
    || metadata.sourceRef !== resolve(body.bindings, candidate.sourceRef)
    || !same(metadata.acquisition, resolveStoryAdmissionTime(candidate.acquisition, body.bindings))
    || value.objectKind !== storyTemporalKnowledgeKind(candidate.layer) || value.layer !== "full"
    || value.visibility !== "private" || !isRecord(value.acquisition)
    || value.acquisition.method !== candidate.explanation || value.acquisition.sense !== "storyAdmission"
    || state.entities[String(value.characterId)]?.sceneId !== value.acquisition.sceneId
    || value.sourceCharacterId !== undefined) return "story-admission:knowledge-binding-invalid";
  const holder = String(value.characterId), acquisition = metadata.acquisition;
  if (!state.entities[holder] || storyTemporalPosition(acquisition, state) !== "established"
    || acquisition.kind === "before" || !acquisition.basisRefs.every(reference => temporalRefAvailable(state, reference))) {
    return "story-admission:knowledge-acquisition-unavailable";
  }
  const holderNow = nowBasis(state, holder);
  if (!holderNow || acquisition.start.timelineId !== holderNow.start.timelineId
    || state.entities[holder].kind === "player" && (acquisition.kind !== "at" || !same(acquisition.start, holderNow.start))) {
    return "story-admission:player-identity-cannot-inherit-past-knowledge";
  }
  const factSource = existingSource(state, metadata.factRef, holder)!;
  return boundaryIssue(state, holder, metadata.factRef, acquisition)
    ?? sourceIssue(state, candidate, holder, existingSource(state, metadata.sourceRef, holder), factSource,
      acquisition, new Map(), acquisition.basisRefs);
}

/** The final evidence must cover every reviewed knower, with the original
 * candidate bytes reconstructed from that holder's own knowledge record. */
export function storyAdmissionEvidenceIssue(state: AuthoritativeWorldState, value: unknown, rootActionId?: string): string | undefined {
  const issue = storyTemporalEvidenceIssue(state, value);
  if (issue || !isStoryTemporalEvidence(value)) return issue ?? "story-admission:evidence-invalid";
  const body = state.canonicalFacts[value.factRef]?.value;
  if (!isStoryFactBody(body) || value.preparationHash !== body.preparationHash || value.candidateRef !== body.candidate.ref
    || (rootActionId !== undefined && rootActionId !== body.rootActionId)
    || !same(value.occurrence, resolveStoryAdmissionTime(body.candidate.occurrence, body.bindings))) return "story-admission:evidence-fact-binding-invalid";
  const knowledge: StoryAdmissionKnowledgeCandidate[] = [];
  for (const binding of value.knowledge) {
    const content = state.knowledge[binding.holderRef]?.[binding.knowledgeRef]?.content;
    if (!isStoryKnowledgeBody(content) || content.preparationHash !== body.preparationHash || content.candidate.ref !== binding.candidateRef
      || resolve(content.bindings, content.candidate.holderRef) !== binding.holderRef
      || resolve(content.bindings, content.candidate.factRef) !== value.factRef
      || resolve(content.bindings, content.candidate.sourceRef) !== binding.sourceRef
      || content.candidate.layer !== binding.layer || !same(binding.acquisition, resolveStoryAdmissionTime(content.candidate.acquisition, content.bindings))) {
      return "story-admission:evidence-knowledge-binding-invalid";
    }
    knowledge.push(content.candidate);
  }
  return canonicalSha256({ ...body.candidate, knowledge }) === body.candidateHash ? undefined : "story-admission:incomplete-reviewed-knowledge";
}

function topological<T>(values: readonly T[], id: (value: T) => string, dependencies: (value: T) => readonly string[]): T[] | undefined {
  const remaining = new Map(values.map(value => [id(value), value])), completed = new Set<string>(), result: T[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter(value => dependencies(value).every(ref => !remaining.has(ref) || completed.has(ref)));
    if (ready.length === 0) return undefined;
    for (const value of ready) { remaining.delete(id(value)); completed.add(id(value)); result.push(value); }
  }
  return result;
}
export function prepareStoryFactsAdmission(state: AuthoritativeWorldState, value: unknown): PreparedStoryFactsAdmission | RejectedRulesResult {
  if (!isRecord(value) || !hasExactKeys(value, ["kind", "rootActionId", "actorCharacterId", "plan"])
    || value.kind !== "admitStoryFacts" || !ref(value.rootActionId) || !ref(value.actorCharacterId) || !isStoryFactsAdmissionPlan(value.plan)) {
    return rejected("invalidRulesInput", "story-admission:noncanonical-plan");
  }
  const input = value as unknown as StoryFactsAdmissionInput, plan = input.plan, bound = plan.bindings;
  const fail = (message: string, conflict = false) => rejected(conflict ? "causalFrontierConflict" : "privateOrUnknownReference", message);
  const actor = state.entities[input.actorCharacterId];
  if (actor?.tenureStatus !== "active") return fail("story-admission:actor-unavailable");
  if (!authorityReadSetMatches(state, plan.readSet)) return fail("story-admission:frozen-reads-changed", true);
  const moduleRef = state.campaignRuntime.campaign?.moduleRef;
  if (!isRecord(moduleRef) || typeof moduleRef.profileId !== "string") return fail("story-admission:module-pin-unavailable");
  const pin = `profile-context:${moduleRef.profileId}`;
  if (!plan.authorizationRefs.includes(pin) || plan.authorizationRefs.some(reference => authorityRevisionOrHash(state, reference) === null)) {
    return fail("story-admission:creation-authorization-unavailable");
  }
  const selectedFacts = new Map<string, Source>(), selectedKnowledge = new Map<string, Source>(), usedRefs = new Set<string>([
    input.actorCharacterId, `character-timeline:${input.actorCharacterId}`, ...plan.authorizationRefs,
  ]);
  for (const candidate of plan.facts) {
    const actualRef = resolve(bound, candidate.ref), occurrence = resolveStoryAdmissionTime(candidate.occurrence, bound);
    if (bound.find(entry => entry.ref === candidate.ref)?.kind !== "fact"
      || actualRef !== storyFactAdmissionRef(plan.preparationHash, candidate.ref) || authorityRevisionOrHash(state, actualRef) !== null
      || state.canonicalFacts[storyTemporalEvidenceRef(plan.preparationHash, candidate.ref)] !== undefined) return fail("story-admission:new-fact-identity-required");
    if (storyTemporalPosition(occurrence, state) !== "established") return fail("story-admission:future-or-unresolved-occurrence");
    selectedFacts.set(actualRef, { kind: "fact", ref: actualRef, occurrence,
      subjects: candidate.subjectRefs.map(reference => resolve(bound, reference)),
      ...(candidate.layer === "statement" ? { layer: "sourceClaim" as const } : {}) });
    for (const knowledge of candidate.knowledge) {
      const holder = resolve(bound, knowledge.holderRef), knowledgeRef = resolve(bound, knowledge.ref);
      const acquisition = resolveStoryAdmissionTime(knowledge.acquisition, bound);
      if (bound.find(entry => entry.ref === knowledge.ref)?.kind !== "knowledge"
        || bound.some(entry => entry.ref === knowledge.holderRef && entry.kind !== "entity")
        || knowledgeRef !== storyKnowledgeAdmissionRef(plan.preparationHash, knowledge.ref, holder)
        || !state.entities[holder] || state.entities[holder].tenureStatus !== "active" || state.knowledge[holder]?.[knowledgeRef]) {
        return fail("story-admission:new-knowledge-or-holder-required");
      }
      if (acquisition.kind === "before" || storyTemporalPosition(acquisition, state) !== "established"
        || !after(occurrence, acquisition)) return fail("story-admission:future-or-unresolved-acquisition");
      const holderNow = nowBasis(state, holder);
      if (!holderNow || acquisition.start.timelineId !== holderNow.start.timelineId
        || state.entities[holder].kind === "player" && (acquisition.kind !== "at" || !same(acquisition.start, holderNow.start))) {
        return fail("story-admission:player-identity-cannot-inherit-past-knowledge");
      }
      selectedKnowledge.set(knowledgeRef, { kind: "knowledge", ref: knowledgeRef, holderRef: holder,
        layer: knowledge.layer, occurrence: acquisition, subjects: [holder] });
      [holder, `character-timeline:${holder}`, `knowledge-catalog:${holder}`].forEach(reference => usedRefs.add(reference));
      const identity = state.entities[holder].semanticDefinitionRef;
      if (identity) usedRefs.add(identity);
    }
  }
  const sources = new Map([...selectedFacts, ...selectedKnowledge]);
  const get = (reference: string) => sources.get(reference) ?? existingSource(state, reference, input.actorCharacterId);
  for (const binding of bound) {
    const valid = binding.kind === "entity" ? state.entities[binding.authorityRef] !== undefined
      : binding.kind === "fact" ? selectedFacts.has(binding.authorityRef) || state.canonicalFacts[binding.authorityRef] !== undefined
      : binding.kind === "knowledge" ? selectedKnowledge.has(binding.authorityRef) || knowledgeAtRef(state, binding.authorityRef) !== undefined
      : binding.kind === "source" ? get(binding.authorityRef) !== undefined
      : authorityRevisionOrHash(state, binding.authorityRef) !== null
        || authorityRevisionOrHash(state, `fiction-timeline:${binding.authorityRef}`) !== null;
    if (!valid) return fail("story-admission:binding-kind-or-reference-invalid");
  }
  for (const candidate of plan.facts) for (const temporal of [candidate.occurrence, ...candidate.knowledge.map(value => value.acquisition)]) {
    for (const original of [temporal.start.timelineId, ...(temporal.end === null ? [] : [temporal.end.timelineId])]) {
      const mapped = bound.find(binding => binding.ref === original);
      if (mapped === undefined) continue;
      if (mapped.kind !== "basis" || authorityRevisionOrHash(state, `fiction-timeline:${mapped.authorityRef}`) === null) {
        return fail("story-admission:timeline-binding-invalid");
      }
      usedRefs.add(`fiction-timeline:${mapped.authorityRef}`);
    }
  }
  const requiredTemporalRefs: string[] = [];
  for (const candidate of plan.facts) {
    const factRef = resolve(bound, candidate.ref), factSource = selectedFacts.get(factRef)!;
    const basis = candidate.basisRefs.map(reference => resolve(bound, reference));
    if (candidate.creationBasis === "existingEvidence" && !basis.some(reference => {
      const source = get(reference); return source?.kind === "fact" || source?.kind === "knowledge";
    })) return fail("story-admission:existing-evidence-required");
    [...candidate.subjectRefs, ...candidate.basisRefs, ...candidate.occurrence.basisRefs]
      .map(reference => resolve(bound, reference)).forEach(reference => usedRefs.add(reference));
    requiredTemporalRefs.push(...factSource.occurrence.basisRefs);
    for (const knowledge of candidate.knowledge) {
      const holder = resolve(bound, knowledge.holderRef), sourceRef = resolve(bound, knowledge.sourceRef);
      const acquisition = resolveStoryAdmissionTime(knowledge.acquisition, bound), refs = acquisition.basisRefs;
      const issue = boundaryIssue(state, holder, factRef, acquisition)
        ?? sourceIssue(state, knowledge, holder, get(sourceRef), factSource, acquisition, sources, refs);
      if (issue) return fail(issue);
      for (const record of Object.values(state.canonicalFacts)) {
        const boundary = record.value;
        if (!isStoryKnowledgeBoundaryValue(boundary) || boundary.holderRef !== holder || boundary.factRef !== factRef) continue;
        if (!plan.knowledgeBoundaries.some(entry => entry.basisRef === record.id && entry.holderRef === holder
          && entry.knowledgeCandidateRef === knowledge.ref && same(entry.unknownThrough, boundary.unknownThrough))) {
          return fail("story-admission:typed-unknown-boundary-omitted", true);
        }
        usedRefs.add(record.id);
      }
      usedRefs.add(sourceRef); refs.forEach(reference => usedRefs.add(reference)); requiredTemporalRefs.push(...refs);
    }
  }
  for (const entry of plan.knowledgeBoundaries) {
    const fact = state.canonicalFacts[entry.basisRef], knowledge = plan.facts.flatMap(fact => fact.knowledge).find(k => k.ref === entry.knowledgeCandidateRef);
    if (!knowledge || !isStoryKnowledgeBoundaryValue(fact?.value) || fact.value.holderRef !== entry.holderRef
      || resolve(bound, knowledge.holderRef) !== entry.holderRef || resolve(bound, knowledge.factRef) !== fact.value.factRef
      || !same(entry.unknownThrough, fact.value.unknownThrough)) return fail("story-admission:typed-unknown-boundary-invalid");
  }
  if (requiredTemporalRefs.some(reference => !sources.has(reference) && !temporalRefAvailable(state, reference))) {
    return fail("story-admission:temporal-basis-unavailable");
  }
  const frozenReads = new Set<string>();
  for (const reference of usedRefs) {
    if (sources.has(reference)) continue;
    const held = knowledgeAtRef(state, reference);
    const authorityRef = authorityRevisionOrHash(state, reference) !== null ? reference
      : held ? `knowledge:${held.characterId}:${held.knowledgeRef}`
      : sourceClaimAtRef(state, reference) ? `continuity:sourceClaims:${reference}` : reference;
    if (authorityRevisionOrHash(state, authorityRef) === null) return fail("story-admission:reference-unavailable");
    if (!plan.readSet.some(entry => entry.ref === authorityRef)) return fail("story-admission:complete-read-set-required", true);
    frozenReads.add(authorityRef);
  }
  const facts = topological(plan.facts, candidate => candidate.ref,
    candidate => [...candidate.subjectRefs, ...candidate.basisRefs, ...temporalSourceRefs(candidate.occurrence)]);
  const knowledge = topological(plan.facts.flatMap(fact => fact.knowledge), candidate => candidate.ref, candidate => [candidate.sourceRef]);
  if (!facts || !knowledge) return fail("story-admission:cyclic-candidate-dependencies");
  const drafts: StoryFactsAdmissionDraft[] = [], createdAuthorityRefs: string[] = [];
  const reads = [...frozenReads].sort();
  for (const candidate of facts) {
    const { knowledge: _knowledge, ...core } = candidate, actualRef = resolve(bound, candidate.ref);
    const factBindings = relevantBindings(bound, [candidate.ref, ...candidate.subjectRefs, ...candidate.basisRefs, ...temporalSourceRefs(candidate.occurrence)]);
    const body: StoryFactBody = { schema: "zhuwei.story-fact-body/v1", preparationHash: plan.preparationHash,
      candidateHash: canonicalSha256(candidate), rootActionId: input.rootActionId, proposalRef: plan.proposalRef,
      contextHash: plan.contextHash, candidate: structuredClone(core), bindings: factBindings, authorizationRefs: [...plan.authorizationRefs] };
    const causalParentIds = [...new Set(candidate.basisRefs.map(reference => resolve(bound, reference)))]
      .filter(reference => reference !== actualRef && (selectedFacts.has(reference) || state.canonicalFacts[reference] !== undefined)).sort();
    drafts.push({ eventType: "CanonicalFactDeclared", payload: { fact: { id: actualRef, kind: "storyFact", value: body,
      subjectRefs: [...selectedFacts.get(actualRef)!.subjects], source: "dynamicMaterialization", causalParentIds,
      visibilityPolicyId: "visibility:kp-internal" } }, reads, writes: [`receipt:${input.rootActionId}`],
      creates: [`fact:${actualRef}`], visibilityPolicyId: "visibility:kp-internal", secrecy: "internal" });
    createdAuthorityRefs.push(actualRef);
  }
  for (const candidate of knowledge) {
    const holder = resolve(bound, candidate.holderRef), factRef = resolve(bound, candidate.factRef), knowledgeRef = resolve(bound, candidate.ref);
    const body: StoryKnowledgeBody = { schema: "zhuwei.story-knowledge-body/v1", preparationHash: plan.preparationHash,
      candidate: structuredClone(candidate), bindings: relevantBindings(bound, [candidate.ref, candidate.holderRef, candidate.factRef,
        candidate.sourceRef, ...temporalSourceRefs(candidate.acquisition)]) };
    drafts.push({ eventType: "KnowledgeAcquired", payload: { characterId: holder, knowledgeRef,
      objectKind: storyTemporalKnowledgeKind(candidate.layer), layer: "full", content: body, causeFactId: factRef,
      acquisition: { sense: "storyAdmission", sceneId: state.entities[holder].sceneId, method: candidate.explanation }, visibility: "private",
      storyAdmission: { schema: "zhuwei.story-knowledge-admission/v1", preparationHash: plan.preparationHash, candidateRef: candidate.ref,
        factRef, sourceRef: resolve(bound, candidate.sourceRef), acquisition: resolveStoryAdmissionTime(candidate.acquisition, bound) } },
      reads: [holder, factRef, resolve(bound, candidate.sourceRef)], writes: [`receipt:${input.rootActionId}`],
      creates: [`knowledge:${holder}:${knowledgeRef}`], visibilityPolicyId: `visibility:knowledge-holder:${holder}`, secrecy: "private" });
    createdAuthorityRefs.push(knowledgeRef, `knowledge:${holder}:${knowledgeRef}`);
  }
  for (const candidate of facts) {
    const evidence: StoryTemporalEvidence = { schema: "zhuwei.story-temporal-evidence/v1", preparationHash: plan.preparationHash,
      candidateRef: candidate.ref, factRef: resolve(bound, candidate.ref), occurrence: resolveStoryAdmissionTime(candidate.occurrence, bound),
      knowledge: candidate.knowledge.map(knowledge => ({ candidateRef: knowledge.ref, holderRef: resolve(bound, knowledge.holderRef),
        knowledgeRef: resolve(bound, knowledge.ref), sourceRef: resolve(bound, knowledge.sourceRef), layer: knowledge.layer,
        acquisition: resolveStoryAdmissionTime(knowledge.acquisition, bound) })) };
    const evidenceRef = storyTemporalEvidenceRef(plan.preparationHash, candidate.ref);
    drafts.push({ eventType: "CanonicalFactDeclared", payload: { fact: { id: evidenceRef, kind: "storyTemporalEvidence", value: evidence,
      subjectRefs: [...selectedFacts.get(evidence.factRef)!.subjects], source: "dynamicMaterialization", causalParentIds: [evidence.factRef],
      visibilityPolicyId: "visibility:kp-internal" } }, reads: [evidence.factRef, ...evidence.knowledge.map(k => `knowledge:${k.holderRef}:${k.knowledgeRef}`)],
      writes: [`receipt:${input.rootActionId}`], creates: [`fact:${evidenceRef}`], visibilityPolicyId: "visibility:kp-internal", secrecy: "internal" });
    createdAuthorityRefs.push(evidenceRef);
  }
  return { kind: "prepared", drafts, factRefs: facts.map(candidate => resolve(bound, candidate.ref)), createdAuthorityRefs };
}

export type StoryFactsAdmissionStepOptions = Readonly<{
  accumulator?: NpcMaterializationAccumulator; skipDuplicateCheck?: boolean;
  appendTransition?: (accumulator: NpcMaterializationAccumulator, profiles: RuntimeProfileManifest,
    rootActionId: string, draft: StoryFactsAdmissionDraft) => void;
}>;
export function stepAdmitStoryFacts(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState,
  input: unknown, options?: StoryFactsAdmissionStepOptions): StepResult {
  if (!worldInteractionProfileEnabled(profiles.extensions)) return rejected("unsupportedOperation", "story-admission:profile-unavailable");
  const accumulator: NpcMaterializationAccumulator = options?.accumulator ?? { state, events: [] };
  if (isRecord(input) && ref(input.rootActionId) && !options?.skipDuplicateCheck && input.rootActionId in accumulator.state.receipts) {
    return rejected("duplicateRootAction", "story-admission:root-already-committed");
  }
  const prepared = prepareStoryFactsAdmission(accumulator.state, input);
  if (prepared.kind === "rejected") return prepared;
  if (!options?.appendTransition) return rejected("unsupportedOperation", "story-admission:authority-transition-port-required");
  const root = (input as StoryFactsAdmissionInput).rootActionId;
  const staged: NpcMaterializationAccumulator = { ...accumulator, state: structuredClone(accumulator.state), events: [...accumulator.events],
    ...(accumulator.transactionReads ? { transactionReads: new Set(accumulator.transactionReads) } : {}),
    ...(accumulator.transactionWrites ? { transactionWrites: new Set(accumulator.transactionWrites) } : {}),
    ...(accumulator.transactionCreates ? { transactionCreates: new Set(accumulator.transactionCreates) } : {}),
    ...(accumulator.transactionCreatedAuthorityRefs ? { transactionCreatedAuthorityRefs: new Set(accumulator.transactionCreatedAuthorityRefs) } : {}) };
  try {
    for (const draft of prepared.drafts) {
      const issue = draft.eventType === "KnowledgeAcquired" ? storyKnowledgeAdmissionIssue(staged.state, draft.payload, root)
        : draft.payload.fact.kind === "storyTemporalEvidence" ? storyAdmissionEvidenceIssue(staged.state, draft.payload.fact.value, root)
        : storyFactAdmissionIssue(staged.state, draft.payload, root);
      if (issue) return rejected("invalidWorldState", issue);
      options.appendTransition(staged, profiles, root, draft);
    }
  } catch { return rejected("invalidWorldState", "story-admission:authority-transition-failed"); }
  prepared.createdAuthorityRefs.forEach(reference => staged.transactionCreatedAuthorityRefs?.add(reference));
  Object.assign(accumulator, staged);
  return { kind: "committed", events: accumulator.events, state: accumulator.state, cache: accumulator.state,
    stateHash: accumulator.events.at(-1)!.stateHashAfter, scopeProof: accumulator.scopeProof!, receipt: accumulator.state.receipts[root]!,
    mechanicalResult: { kind: "admitStoryFacts", factRefs: [...prepared.factRefs] } };
}

/** Historical branches remap only these typed protocols. Prose, source hashes
 * and unrecognized values remain unchanged; missing timelines fail closed. */
export function remapStoryTemporalContent(value: unknown, timelineMap: ReadonlyMap<string, string>):
  { kind: "unchanged" | "remapped"; value: unknown } | { kind: "rejected"; code: string } {
  if (!isRecord(value) || !["zhuwei.story-fact-body/v1", "zhuwei.story-knowledge-body/v1", "zhuwei.knowledge-boundary/v1"].includes(String(value.schema))) {
    return { kind: "unchanged", value };
  }
  if (value.schema === "zhuwei.knowledge-boundary/v1") {
    if (!isStoryKnowledgeBoundaryValue(value)) return { kind: "rejected", code: "story-admission:historical-body-invalid" };
    const timelineId = timelineMap.get(value.unknownThrough.timelineId);
    return timelineId === undefined ? { kind: "rejected", code: "story-admission:historical-timeline-unavailable" }
      : { kind: "remapped", value: { ...structuredClone(value), unknownThrough: { ...value.unknownThrough, timelineId } } };
  }
  if (!isStoryFactBody(value) && !isStoryKnowledgeBody(value)) return { kind: "rejected", code: "story-admission:historical-body-invalid" };
  const temporal = isStoryFactBody(value) ? value.candidate.occurrence : value.candidate.acquisition;
  const mappedBindings = structuredClone(value.bindings) as StoryAdmissionBinding[];
  for (const sourceId of new Set([temporal.start.timelineId, ...(temporal.end === null ? [] : [temporal.end.timelineId])])) {
    const prior = mappedBindings.find(binding => binding.ref === sourceId);
    if (prior !== undefined && prior.kind !== "basis") return { kind: "rejected", code: "story-admission:historical-timeline-unavailable" };
    const targetId = timelineMap.get(prior?.authorityRef ?? sourceId);
    if (targetId === undefined) return { kind: "rejected", code: "story-admission:historical-timeline-unavailable" };
    const binding: StoryAdmissionBinding = { kind: "basis", ref: sourceId, authorityRef: targetId };
    if (prior) mappedBindings.splice(mappedBindings.indexOf(prior), 1, binding);
    else mappedBindings.push(binding);
  }
  return { kind: "remapped", value: { ...structuredClone(value), bindings: mappedBindings } };
}
