import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState, CanonicalFactRecord, JsonRecord } from "./model";
import type { VersionedAuthorityBinding } from "./world-interaction-model";

export const NARRATIVE_DETAIL_SCHEMA = "zhuwei.narrative-detail/vnext-1" as const;
export const NARRATIVE_DETAIL_PLAN_SCHEMA = "zhuwei.narrative-detail-plan/vnext-1" as const;
export type NarrativeDetailPlan = Readonly<{
  schema: typeof NARRATIVE_DETAIL_PLAN_SCHEMA;
  proposalRef: string;
  contextHash: string;
  sceneRef: string;
  label: string;
  description: string;
  audience: "sceneObservers" | "actorOnly";
  basisRefs: readonly string[];
  authorizationRefs: readonly string[];
  readSet: readonly VersionedAuthorityBinding[];
}>;
export type NarrativeDetailValue = {
  schema: typeof NARRATIVE_DETAIL_SCHEMA;
  sceneRef: string;
  label: string;
  description: string;
  audience: "sceneObservers" | "actorOnly";
  audienceCharacterIds: string[];
  basisRefs: string[];
};
export type NarrativeDetailCommittedPayload = {
  actorCharacterId: string;
  commitmentRef: string;
  proposalRef: string;
  contextHash: string;
  detail: NarrativeDetailValue;
};
export type NarrativeDetailMaterializedPayload = {
  actorCharacterId: string;
  commitmentRef: string;
  materializedRef: string;
};

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, maximum = 2_000): value is string => typeof value === "string" && value.length > 0
  && value.length <= maximum && value.trim() === value && value.normalize("NFC") === value;
const ref = (value: unknown): value is string => text(value, 500) && /^\S+$/u.test(value);
const refs = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 64
  && value.every(ref) && new Set(value).size === value.length;
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).sort().join("\0") === expected.sort().join("\0");

export function isNarrativeDetailPlan(value: unknown): value is NarrativeDetailPlan {
  return record(value) && keys(value, ["schema", "proposalRef", "contextHash", "sceneRef", "label", "description", "audience", "basisRefs", "authorizationRefs", "readSet"])
    && value.schema === NARRATIVE_DETAIL_PLAN_SCHEMA && ref(value.proposalRef) && /^sha256:[a-f0-9]{64}$/u.test(String(value.contextHash))
    && ref(value.sceneRef) && text(value.label, 500) && text(value.description)
    && ["sceneObservers", "actorOnly"].includes(String(value.audience)) && refs(value.basisRefs) && refs(value.authorizationRefs)
    && Array.isArray(value.readSet) && value.readSet.length <= 256 && value.readSet.every(binding => record(binding)
      && keys(binding, ["ref", "revisionOrHash"]) && ref(binding.ref) && ref(binding.revisionOrHash));
}

export function isNarrativeDetailValue(value: unknown): value is NarrativeDetailValue {
  return record(value) && keys(value, ["schema", "sceneRef", "label", "description", "audience", "audienceCharacterIds", "basisRefs"])
    && value.schema === NARRATIVE_DETAIL_SCHEMA && ref(value.sceneRef) && text(value.label, 500) && text(value.description)
    && ["sceneObservers", "actorOnly"].includes(String(value.audience)) && isNarrativeMaterializationRefs(value.audienceCharacterIds)
    && value.audienceCharacterIds.length > 0 && refs(value.basisRefs);
}

/** A continuity commitment is deliberately not a spatial entity or a fact
 * that can be used to settle mechanics before its materialization binding. */
export function narrativeDetail(state: AuthoritativeWorldState, commitmentRef: string): NarrativeDetailValue | undefined {
  const fact = state.canonicalFacts[commitmentRef];
  return fact?.kind === "narrativeCommitment" && isNarrativeDetailValue(fact.value) ? fact.value : undefined;
}

export function narrativeDetailVisibleTo(state: AuthoritativeWorldState, commitmentRef: string, characterRef: string): boolean {
  const detail = narrativeDetail(state, commitmentRef);
  return detail !== undefined && detail.audienceCharacterIds.includes(characterRef);
}

/** Audience membership and internal bases never leave the authority snapshot. */
export function projectNarrativeFact(fact: CanonicalFactRecord): CanonicalFactRecord {
  if (fact.kind !== "narrativeCommitment" || !isNarrativeDetailValue(fact.value)) return structuredClone(fact);
  const { schema, sceneRef, label, description } = fact.value;
  return { ...structuredClone(fact), value: { schema, sceneRef, label, description } };
}

export function narrativeDetailRef(rootActionId: string, proposalRef: string): string {
  return `narrative-detail:${canonicalSha256({ rootActionId, proposalRef }).slice("sha256:".length)}`;
}
export function narrativeBindingRef(commitmentRef: string): string { return `narrative-binding:${commitmentRef}`; }
export function narrativeMaterializedRef(state: AuthoritativeWorldState, commitmentRef: string): string | undefined {
  const fact = state.canonicalFacts[narrativeBindingRef(commitmentRef)];
  return fact?.kind === "narrativeMaterialization" && record(fact.value) && fact.value.commitmentRef === commitmentRef
    && ref(fact.value.materializedRef) ? fact.value.materializedRef : undefined;
}

export function isNarrativeDetailCommittedPayload(value: unknown): value is NarrativeDetailCommittedPayload {
  return record(value) && keys(value, ["actorCharacterId", "commitmentRef", "proposalRef", "contextHash", "detail"])
    && ref(value.actorCharacterId) && ref(value.commitmentRef) && ref(value.proposalRef)
    && /^sha256:[a-f0-9]{64}$/u.test(String(value.contextHash)) && isNarrativeDetailValue(value.detail);
}
export function isNarrativeDetailMaterializedPayload(value: unknown): value is NarrativeDetailMaterializedPayload {
  return record(value) && keys(value, ["actorCharacterId", "commitmentRef", "materializedRef"])
    && ref(value.actorCharacterId) && ref(value.commitmentRef) && ref(value.materializedRef);
}

export function narrativeSourceRefs(state: AuthoritativeWorldState, sourceRefs: readonly string[]): string[] {
  return [...new Set(sourceRefs.filter(sourceRef => narrativeDetail(state, sourceRef) !== undefined))].sort();
}

/** Frozen obligations and published audiences are complete sets, never recent-N windows. */
export function isNarrativeMaterializationRefs(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(ref) && new Set(value).size === value.length;
}

/** A model may request the source's audience, but never constructs a policy
 * containing another player's identity. The server derives the existing policy. */
export function narrativeMaterializationPolicy(state: AuthoritativeWorldState, input: Readonly<{
  sourceRefs: readonly string[]; actorCharacterId: string; requestedPolicy: string;
}>): string | undefined {
  if (input.requestedPolicy !== "visibility:narrative-audience") return input.requestedPolicy;
  const sources = narrativeSourceRefs(state, input.sourceRefs);
  if (sources.length !== 1) return undefined;
  const detail = narrativeDetail(state, sources[0])!;
  if (!detail.audienceCharacterIds.includes(input.actorCharacterId)) return undefined;
  return detail.audience === "actorOnly" ? `visibility:character-controller:${input.actorCharacterId}` : "visibility:scene-observers";
}

/** Shared by semantic and Item materialization. It checks immutable publication
 * content and its audience; it cannot reinterpret prose as mechanical rules. */
export function narrativeMaterializationIssue(state: AuthoritativeWorldState, input: Readonly<{
  sourceRefs: readonly string[];
  actorCharacterId: string;
  sceneRef: string;
  label: string;
  description: string;
  visibilityPolicyRef: string;
}>): string | undefined {
  const sources = narrativeSourceRefs(state, input.sourceRefs);
  if (sources.length > 1) return "narrative:one-commitment-per-materialization";
  for (const sourceRef of sources) {
    const detail = narrativeDetail(state, sourceRef)!;
    if (!detail.audienceCharacterIds.includes(input.actorCharacterId)) return "narrative:commitment-not-visible";
    if (narrativeMaterializedRef(state, sourceRef) !== undefined) return "narrative:already-materialized";
    if (detail.sceneRef !== input.sceneRef || detail.label !== input.label || detail.description !== input.description) {
      return "narrative:committed-description-conflict";
    }
    const allowedPolicy = detail.audience === "sceneObservers"
      ? input.visibilityPolicyRef === "visibility:scene-observers"
      : input.visibilityPolicyRef === `visibility:character-controller:${input.actorCharacterId}`
        || input.visibilityPolicyRef === `visibility:knowledge-holder:${input.actorCharacterId}`;
    if (!allowedPolicy) return "narrative:materialization-audience-conflict";
  }
  return undefined;
}

export function unmaterializedNarrativeRefs(state: AuthoritativeWorldState, candidateRefs: readonly string[]): string[] {
  return narrativeSourceRefs(state, candidateRefs).filter(sourceRef => narrativeMaterializedRef(state, sourceRef) === undefined);
}

export function committedNarrativeFact(payload: NarrativeDetailCommittedPayload, metadata: Readonly<{
  branchId: string; eventSeq: string; eventId: string;
}>): CanonicalFactRecord {
  return { id: payload.commitmentRef, kind: "narrativeCommitment", subjectRefs: [payload.detail.sceneRef],
    value: structuredClone(payload.detail), visibilityPolicyId: `visibility:narrative:${payload.commitmentRef}`,
    source: "dynamicMaterialization", branchId: metadata.branchId, validFromEventSeq: metadata.eventSeq,
    causalParentIds: [metadata.eventId] };
}

export function bindNarrativeMaterialization(state: AuthoritativeWorldState, payload: NarrativeDetailMaterializedPayload,
  metadata: Readonly<{ branchId: string; eventSeq: string; eventId: string }>): void {
  const detail = narrativeDetail(state, payload.commitmentRef);
  if (detail === undefined || !detail.audienceCharacterIds.includes(payload.actorCharacterId)
    || narrativeMaterializedRef(state, payload.commitmentRef) !== undefined
    || (state.campaignRuntime.definitions[payload.materializedRef] === undefined
      && state.campaignRuntime.itemSystem.entries[payload.materializedRef] === undefined)) {
    throw new TypeError("narrative materialization binding is unavailable or duplicated");
  }
  const id = narrativeBindingRef(payload.commitmentRef);
  const semantic = state.campaignRuntime.definitions[payload.materializedRef];
  const item = state.campaignRuntime.itemSystem.entries[payload.materializedRef];
  const itemDefinition = item === undefined ? undefined : state.campaignRuntime.itemSystem.definitions[item.definitionRef];
  const content = record(semantic?.content) ? semantic.content : itemDefinition?.content;
  const issue = !record(content) ? "narrative:materialized-content-unavailable" : narrativeMaterializationIssue(state, {
    sourceRefs: [payload.commitmentRef], actorCharacterId: payload.actorCharacterId,
    sceneRef: item === undefined ? String((content as Record<string, unknown>).sceneRef) : item.sceneRef ?? state.entities[item.holderRef ?? ""]?.sceneId ?? "",
    label: String(content.label), description: String(content.description),
    visibilityPolicyRef: String(item === undefined ? semantic?.visibilityPolicyRef : item.visibilityPolicyRef),
  });
  if (issue !== undefined) throw new TypeError(issue);
  state.canonicalFacts[id] = { id, kind: "narrativeMaterialization", subjectRefs: [payload.commitmentRef, payload.materializedRef],
    value: { commitmentRef: payload.commitmentRef, materializedRef: payload.materializedRef } as JsonRecord,
    visibilityPolicyId: `visibility:narrative:${payload.commitmentRef}`, source: "dynamicMaterialization",
    branchId: metadata.branchId, validFromEventSeq: metadata.eventSeq, causalParentIds: [metadata.eventId] };
}

type NarrativeItemSuccession = Readonly<{
  bindingRef: string;
  commitmentRef: string;
  sourceEntryRef: string;
  targetEntryRef: string;
}>;

/** Binding scopes follow exact entry identity, never a label or description. */
export function narrativeItemBindingRefs(state: AuthoritativeWorldState, entryRef: string): string[] {
  return Object.values(state.canonicalFacts).filter(fact => fact.kind === "narrativeMaterialization"
    && record(fact.value) && fact.value.materializedRef === entryRef
    && ref(fact.value.commitmentRef) && fact.id === narrativeBindingRef(fact.value.commitmentRef))
    .map(fact => fact.id).sort();
}

/** Called only with the before/after item systems of a verified transition.
 * A partial split leaves the bound source alive. A full homogeneous merge
 * retires it and transfers continuity to the exact surviving stack. */
export function planNarrativeItemSuccessions(
  state: AuthoritativeWorldState,
  after: AuthoritativeWorldState["campaignRuntime"]["itemSystem"],
  sourceEntryRef: string,
  targetEntryRef: string,
): NarrativeItemSuccession[] {
  if (sourceEntryRef === targetEntryRef || after.entries[sourceEntryRef] !== undefined) return [];
  const bindings = narrativeItemBindingRefs(state, sourceEntryRef);
  if (bindings.length === 0) return [];
  const before = state.campaignRuntime.itemSystem;
  const source = before.entries[sourceEntryRef], target = after.entries[targetEntryRef];
  const priorTarget = before.entries[targetEntryRef];
  if (source === undefined || target === undefined || priorTarget === undefined
    || source.definitionRef !== target.definitionRef || source.definitionRevision !== target.definitionRevision
    || priorTarget.definitionRef !== target.definitionRef || priorTarget.definitionRevision !== target.definitionRevision
    || target.quantity !== source.quantity + priorTarget.quantity) {
    throw new TypeError("narrative item succession lacks a quantity-preserving authoritative merge");
  }
  return bindings.map(bindingRef => ({ bindingRef,
    commitmentRef: String((state.canonicalFacts[bindingRef].value as JsonRecord).commitmentRef),
    sourceEntryRef, targetEntryRef }));
}

/** The existing Item event is the audit record for this binding transition.
 * Publication prose and audience remain in the unchanged commitment fact. */
export function applyNarrativeItemSuccessions(state: AuthoritativeWorldState, successions: readonly NarrativeItemSuccession[],
  metadata: Readonly<{ branchId: string; eventSeq: string; eventId: string }>): void {
  for (const succession of successions) {
    const fact = state.canonicalFacts[succession.bindingRef];
    if (fact?.kind !== "narrativeMaterialization" || !record(fact.value)
      || fact.value.commitmentRef !== succession.commitmentRef || fact.value.materializedRef !== succession.sourceEntryRef
      || narrativeDetail(state, succession.commitmentRef) === undefined
      || state.campaignRuntime.itemSystem.entries[succession.sourceEntryRef] !== undefined
      || state.campaignRuntime.itemSystem.entries[succession.targetEntryRef] === undefined) {
      throw new TypeError("narrative item succession does not match its binding or item state");
    }
    state.canonicalFacts[succession.bindingRef] = { ...fact,
      subjectRefs: [succession.commitmentRef, succession.targetEntryRef],
      value: { ...fact.value, materializedRef: succession.targetEntryRef,
        originMaterializedRef: fact.value.originMaterializedRef ?? succession.sourceEntryRef,
        predecessorMaterializedRef: succession.sourceEntryRef } as JsonRecord,
      source: "observedEvent", branchId: metadata.branchId, validFromEventSeq: metadata.eventSeq,
      causalParentIds: [metadata.eventId] };
  }
}
