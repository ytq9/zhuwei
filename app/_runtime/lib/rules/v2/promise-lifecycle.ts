import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState, DueActivityDescriptor, EventEnvelope, JsonRecord } from "./model";
import { characterTimelineId } from "./timeline";
import { hasExactKeys, isNonEmptyString, isRecord } from "./validation";
import { worldFactDefinition, worldHistoryCoverageConform } from "./world-facts";

function promiseInitialObjects(state: AuthoritativeWorldState, terms: PromiseTerms) {
  const refs = new Set(promiseTermsRefs(terms));
  const items = Object.values(state.campaignRuntime.itemSystem.entries).filter(item => refs.has(item.entryId));
  for (const item of items) refs.add(item.definitionRef);
  const definitions = [...refs].flatMap(ref => {
    const definition = state.campaignRuntime.itemSystem.definitions[ref] ?? state.campaignRuntime.definitions[ref];
    return definition ? [definition] : [];
  });
  return { initialItems: structuredClone(items) as unknown as JsonRecord[], initialDefinitions: structuredClone(definitions) as unknown as JsonRecord[] };
}

/** A deadline describes the obligation. It never supplies an action's duration. */
export type PromiseTerms = {
  kind: "result" | "attempt" | "ongoing";
  subjectRefs: string[];
  delivery: null | { sourceRef: string | null; itemRef: string | null; quantity: number;
    destinationKind: "holder" | "scene"; destinationRef: string };
  /** Additional independently tracked requirements of the same undertaking. */
  parts?: Array<{ partId: string; content: string; kind: "result" | "attempt" | "ongoing";
    subjectRefs: string[]; delivery: PromiseTerms["delivery"] }>;
  activation?: null | { content: string; subjectRefs: string[]; requiresKnowledge: boolean;
    windowEndFictionMicros: string | null };
};
export type PromiseEvidence = {
  eventId: string; eventSeq: string; rootActionId: string; eventType: string;
  timelineId: string; atFictionMicros: string; payload: JsonRecord;
  itemsAfter: JsonRecord[];
};
export type PromiseJudgment = {
  outcome: "unchanged" | "progressed" | "conditionMet" | "conditionUnmet" | "fulfilled" | "breached" | "released";
  reason: string; evidenceRefs: string[]; remaining: boolean;
  completedParts?: string[];
};
export type PromiseVersion = { revision: string; content: string; condition: string; terms: PromiseTerms;
  effectiveAtFictionMicros: string; deadlineFictionMicros: string | null; expressionRef: string; reason: string };
export type PromiseChange = { kind: "amend" | "release" | "refusal" | "method"; accepted: boolean;
  reason: string; content: string; condition: string; terms: PromiseTerms | null;
  deadlineFictionMicros: string | null; releasedParts: string[]; remaining: boolean };
export type PromiseLifecycle = {
  schema: "zhuwei.promise-lifecycle/vnext-1";
  revision: string; originalExpressionRef: string; formedByEventId: string; formedByRootActionId: string;
  timelineId: string; fromFictionMicros: string; deadlineFictionMicros: string | null;
  terms: PromiseTerms;
  obligation: "outstanding" | "satisfied";
  versions: PromiseVersion[];
  completedParts: string[];
  releasedParts: string[];
  conditionStatus: "pending" | "met" | "unmet";
  changes: Array<{ eventId: string; revision: string; expressionRef: string; atFictionMicros: string; change: PromiseChange }>;
  history: Array<PromiseJudgment & { reviewRef: string; evidenceFrontier: string;
    atFictionMicros: string; committedByEventId: string; revision: string }>;
  evidence: PromiseEvidence[];
  initialItems: JsonRecord[]; initialDefinitions: JsonRecord[];
  reviewedFrontier: string | null;
};
export type PromiseReviewFrame = {
  schema: "zhuwei.promise-review-context/vnext-1";
  promiseId: string; revision: string; promisorId: string; promiseeId: string;
  content: string; condition: string; terms: PromiseTerms;
  timelineId: string; fromFictionMicros: string; throughFictionMicros: string;
  deadlineFictionMicros: string | null; evidenceFrontier: string;
  history: PromiseLifecycle["history"]; evidence: PromiseEvidence[];
  versions: PromiseVersion[]; changes: PromiseLifecycle["changes"];
  completedParts: string[]; releasedParts: string[]; conditionStatus: PromiseLifecycle["conditionStatus"];
  promisorKnowledgeRefs: string[];
  /** Canonical facts only. Attributed speech is separately labeled in evidence. */
  facts: JsonRecord[]; items: JsonRecord[]; definitions: JsonRecord[];
};

export type PromiseReviewRequest = PromiseReviewFrame | { schema: "zhuwei.promise-review-batch/vnext-1"; promiseId: string; frames: PromiseReviewFrame[] };
export function promiseReviewRequest(state: AuthoritativeWorldState, promiseIds: string[]): PromiseReviewRequest | undefined {
  if (promiseIds.length === 0 || promiseIds.length > 16 || new Set(promiseIds).size !== promiseIds.length) return undefined;
  const frames = promiseIds.map(id => promiseReviewFrame(state, id));
  if (frames.some(frame => !frame)) return undefined;
  const ready = frames as PromiseReviewFrame[];
  if (ready.some(f => f.timelineId !== ready[0].timelineId || f.throughFictionMicros !== ready[0].throughFictionMicros)) return undefined;
  return ready.length === 1 ? ready[0] : { schema: "zhuwei.promise-review-batch/vnext-1", promiseId: promiseIds[0], frames: ready };
}
export function promiseReviewFrames(request: PromiseReviewRequest): PromiseReviewFrame[] {
  return request.schema === "zhuwei.promise-review-batch/vnext-1" ? request.frames : [request];
}

const refs = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 128
  && value.every(isNonEmptyString) && new Set(value).size === value.length;
const micros = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
export function promiseTermsConform(value: unknown): value is PromiseTerms {
  if (!isRecord(value) || !hasExactKeys(value, ["kind", "subjectRefs", "delivery",
    ...["parts", "activation"].filter(key => Object.hasOwn(value, key))])
    || !["result", "attempt", "ongoing"].includes(String(value.kind)) || !refs(value.subjectRefs) || value.subjectRefs.length === 0) return false;
  if (value.parts !== undefined && (!Array.isArray(value.parts) || value.parts.length > 16
    || new Set(value.parts.map(part => isRecord(part) ? part.partId : null)).size !== value.parts.length
    || value.parts.some(part => !isRecord(part) || !hasExactKeys(part, ["partId", "content", "kind", "subjectRefs", "delivery"])
      || !isNonEmptyString(part.partId) || !isNonEmptyString(part.content)
      || !promiseTermsConform({ kind: part.kind, subjectRefs: part.subjectRefs, delivery: part.delivery })))) return false;
  const a = value.activation;
  if (a !== undefined && a !== null && (!isRecord(a)
    || !hasExactKeys(a, ["content", "subjectRefs", "requiresKnowledge", "windowEndFictionMicros"])
    || !isNonEmptyString(a.content) || !refs(a.subjectRefs) || a.subjectRefs.length === 0
    || typeof a.requiresKnowledge !== "boolean" || !(a.windowEndFictionMicros === null || micros(a.windowEndFictionMicros)))) return false;
  const d = value.delivery;
  return d === null || (isRecord(d) && hasExactKeys(d, ["sourceRef", "itemRef", "quantity", "destinationKind", "destinationRef"])
    && (d.sourceRef === null || isNonEmptyString(d.sourceRef)) && (d.itemRef === null || isNonEmptyString(d.itemRef))
    && Number.isSafeInteger(d.quantity) && Number(d.quantity) > 0
    && ["holder", "scene"].includes(String(d.destinationKind)) && isNonEmptyString(d.destinationRef));
}
export function promiseLifecycle(promise: JsonRecord | undefined): PromiseLifecycle | undefined {
  const value = promise?.lifecycle;
  return isRecord(value) && value.schema === "zhuwei.promise-lifecycle/vnext-1" ? value as unknown as PromiseLifecycle : undefined;
}
export function promiseTermsRefs(terms: PromiseTerms): string[] {
  return [...new Set([...terms.subjectRefs, ...(terms.activation?.subjectRefs ?? []),
    ...(terms.parts ?? []).flatMap(part => promiseTermsRefs(part)), ...(terms.delivery === null ? [] :
    [terms.delivery.sourceRef, terms.delivery.itemRef, terms.delivery.destinationRef].filter(isNonEmptyString))])];
}
export function promiseTermsIssue(state: AuthoritativeWorldState, payload: unknown): string | undefined {
  if (!isRecord(payload) || !hasExactKeys(payload, ["promiseId", "originalExpressionRef", "terms", "timelineId", "fromFictionMicros", "deadlineFictionMicros"])
    || !isNonEmptyString(payload.promiseId) || !isNonEmptyString(payload.originalExpressionRef) || !promiseTermsConform(payload.terms)
    || !micros(payload.fromFictionMicros) || !(payload.deadlineFictionMicros === null || micros(payload.deadlineFictionMicros))) return "promise:terms-invalid";
  const p = state.campaignRuntime.promises[payload.promiseId], timeline = String(payload.timelineId);
  if (!p || p.lifecycle !== undefined || characterTimelineId(state, String(p.promisorId)) !== timeline
    || state.fictionTimelines[timeline]?.nowMicros !== payload.fromFictionMicros
    || (payload.deadlineFictionMicros !== null && BigInt(payload.deadlineFictionMicros) < BigInt(payload.fromFictionMicros))) return "promise:terms-time-or-identity-invalid";
  const expression = state.campaignRuntime.sourceClaims[payload.originalExpressionRef];
  if (expression?.sourceEntityId !== p.promisorId && expression?.sourceCharacterId !== p.promisorId
    && expression?.speakerId !== p.promisorId) return "promise:expression-authority-unavailable";
  const available = (ref: string) => Object.hasOwn(state.entities, ref) || Object.hasOwn(state.scenes, ref)
    || Object.hasOwn(state.canonicalFacts, ref) || Object.hasOwn(state.campaignRuntime.itemSystem.entries, ref)
    || Object.hasOwn(state.campaignRuntime.definitions, ref)
    || Object.values(state.knowledge[String(p.promisorId)] ?? {}).some(k => ref === `knowledge:${p.promisorId}:${k.knowledgeRef}`);
  const terms = payload.terms;
  if (promiseTermsRefs(terms).some(ref => !available(ref))) return "promise:subject-unavailable";
  if (terms.delivery !== null) {
    const d = terms.delivery;
    if ((d.sourceRef !== null && !available(d.sourceRef))
      || (d.itemRef !== null && !Object.hasOwn(state.campaignRuntime.itemSystem.entries, d.itemRef))
      || !Object.hasOwn(d.destinationKind === "holder" ? state.entities : state.scenes, d.destinationRef)) return "promise:delivery-binding-unavailable";
  }
  return undefined;
}

/** Rebuilt by the event interpreter, never populated from model search results.
 * Retaining actual changes preserves early fulfillment after a later transfer.
 * Clock changes trigger a review but do not prove the absence of conduct. */
export function recordPromiseEvidence(state: AuthoritativeWorldState, event: EventEnvelope): void {
  for (const id of promiseEvidenceTargets(state, event)) {
    const life = promiseLifecycle(state.campaignRuntime.promises[id])!;
    const payload = event.payload as JsonRecord;
    const entryRef = event.eventType === "ItemMaterialized" && isRecord(payload.entry) ? String(payload.entry.entryId)
      : event.eventType === "InventoryOperationApplied" ? String(payload.targetEntryId)
        : event.eventType === "ItemTransferred" ? String(payload.targetItemId) : undefined;
    const item = entryRef === undefined ? undefined : state.campaignRuntime.itemSystem.entries[entryRef];
    life.evidence.push({ eventId: event.eventId, eventSeq: event.eventSeq, rootActionId: event.rootActionId,
      eventType: event.eventType, timelineId: event.fictionTimelineId, atFictionMicros: event.fictionInstantMicros,
      payload: structuredClone(event.payload) as JsonRecord, itemsAfter: item ? [structuredClone(item) as unknown as JsonRecord] : [] });
  }
}

export function promiseEvidenceTargets(state: AuthoritativeWorldState, event: EventEnvelope): string[] {
  if (!/^(CanonicalFactDeclared|SourceClaimCreated|SensoryEvidenceAcquired|KnowledgeAcquired|KnowledgeShared|InventoryOperationApplied|ItemMaterialized|ItemAcquired|ItemTransferred|ItemDefinitionRegistered|AuthoredMaterializationResolved|WorldInteractionResolved|EntityMoved|CharacterMoved|NpcActionCommitted|FactionActionCommitted|ActivityInterrupted)$/.test(event.eventType)) return [];
  if (event.eventType === "CanonicalFactDeclared" && ["promiseReviewResult", "promiseTermsResult"].includes((event.payload as { fact: { kind: string } }).fact.kind)) return [];
  // A Form's settlement marker repeats its plan and speech. Only its actual
  // effects (or the separately committed facts/items/knowledge) are evidence.
  if (event.eventType === "WorldInteractionResolved") {
    const applied = (event.payload as JsonRecord).appliedEffects;
    if (!Array.isArray(applied) || applied.length === 0) return [];
  }
  return Object.entries(state.campaignRuntime.promises).flatMap(([id, p]) => {
    const life = promiseLifecycle(p);
    return life && life.obligation !== "satisfied"
      && event.branchId === state.activeBranchId && BigInt(event.fictionInstantMicros) >= BigInt(life.fromFictionMicros)
      && (event.fictionTimelineId === life.timelineId || eventReferencesPromise(event.payload, p, life)) ? [id] : [];
  });
}

function eventReferencesPromise(payload: unknown, promise: JsonRecord, life: PromiseLifecycle): boolean {
  const subjects = new Set([String(promise.promisorId), String(promise.promiseeId), ...promiseTermsRefs(life.terms)]);
  const visit = (value: unknown): boolean => typeof value === "string" ? subjects.has(value)
    : Array.isArray(value) ? value.some(visit) : isRecord(value) ? Object.values(value).some(visit) : false;
  return visit(payload);
}

export function promiseReviewFrontier(life: PromiseLifecycle, now: string): string {
  return canonicalSha256({ revision: life.revision, conditionStatus: life.conditionStatus,
    lastEvidence: life.evidence.filter(e => BigInt(e.atFictionMicros) <= BigInt(now)).at(-1)?.eventId ?? life.formedByEventId,
    deadlineReached: life.deadlineFictionMicros !== null && BigInt(now) >= BigInt(life.deadlineFictionMicros),
    conditionWindowEnded: life.terms.activation?.windowEndFictionMicros != null
      && BigInt(now) >= BigInt(life.terms.activation.windowEndFictionMicros) });
}

export function promiseReviewFrame(state: AuthoritativeWorldState, promiseId: string): PromiseReviewFrame | undefined {
  const p = state.campaignRuntime.promises[promiseId], life = promiseLifecycle(p);
  if (!life || life.obligation === "satisfied" || state.fictionTimelines[life.timelineId]?.branchId !== state.activeBranchId) return undefined;
  const now = state.fictionTimelines[life.timelineId].nowMicros;
  const frontier = promiseReviewFrontier(life, now);
  if (life.reviewedFrontier === frontier) return undefined;
  const deadlineReached = life.deadlineFictionMicros !== null && BigInt(now) >= BigInt(life.deadlineFictionMicros);
  const conditionWindowEnded = life.terms.activation?.windowEndFictionMicros != null
    && BigInt(now) >= BigInt(life.terms.activation.windowEndFictionMicros);
  if (!deadlineReached && !conditionWindowEnded && !life.evidence.some(e => BigInt(e.atFictionMicros) <= BigInt(now))) return undefined;
  const subjects = new Set([String(p.promisorId), String(p.promiseeId), ...promiseTermsRefs(life.terms)]);
  const evidence = life.evidence.filter(e => BigInt(e.atFictionMicros) <= BigInt(now));
  const factIds = new Set(evidence.flatMap(e => e.eventType === "CanonicalFactDeclared" && isRecord(e.payload.fact) ? [String(e.payload.fact.id)] : []));
  const facts = Object.values(state.canonicalFacts).filter(f => f.branchId === state.activeBranchId
    && factIds.has(f.id) && f.subjectRefs.some(ref => subjects.has(ref)));
  const itemMap = new Map(life.initialItems.map(item => [String(item.entryId), item]));
  for (const entry of evidence) for (const item of entry.itemsAfter) itemMap.set(String(item.entryId), item);
  const entries = [...itemMap.values()];
  const definitions = new Map(life.initialDefinitions.map(d => [String(d.definitionId ?? d.ref), d]));
  for (const entry of evidence) if (entry.eventType === "ItemDefinitionRegistered" && isRecord(entry.payload.definition)) {
    const definition = entry.payload.definition; definitions.set(String(definition.definitionId ?? definition.ref), definition);
  }
  return { schema: "zhuwei.promise-review-context/vnext-1", promiseId, revision: life.revision,
    promisorId: String(p.promisorId), promiseeId: String(p.promiseeId), content: String(p.content), condition: String(p.condition),
    terms: structuredClone(life.terms), timelineId: life.timelineId, fromFictionMicros: life.fromFictionMicros,
    throughFictionMicros: now, deadlineFictionMicros: life.deadlineFictionMicros, evidenceFrontier: frontier,
    history: structuredClone(life.history), versions: structuredClone(life.versions), changes: structuredClone(life.changes),
    completedParts: [...life.completedParts], releasedParts: [...life.releasedParts], conditionStatus: life.conditionStatus,
    promisorKnowledgeRefs: Object.values(state.knowledge[String(p.promisorId)] ?? {}).filter(k => BigInt(k.acquiredAtFictionMicros) <= BigInt(now)).map(k => k.knowledgeRef).sort(),
    evidence: structuredClone(evidence), facts: facts.map(f => {
      const definition = worldFactDefinition(state, f), body = definition?.content.worldFact;
      const coverage = isRecord(body) ? body.historyCoverage : undefined;
      return { ...structuredClone(f), ...(coverage === undefined ? {} : { historyCoverage: structuredClone(coverage) }) };
    }) as unknown as JsonRecord[],
    items: structuredClone(entries), definitions: structuredClone([...definitions.values()]) };

}

export function promiseReviewDeadlines(state: AuthoritativeWorldState): Array<{ promiseId: string; timelineId: string; at: string }> {
  return Object.entries(state.campaignRuntime.promises).flatMap(([promiseId, p]) => {
    const life = promiseLifecycle(p);
    if (life?.obligation !== "outstanding" || state.fictionTimelines[life.timelineId] === undefined) return [];
    return [...new Set([life.deadlineFictionMicros, life.conditionStatus === "pending" ? life.terms.activation?.windowEndFictionMicros : null])]
      .filter((at): at is string => at != null && BigInt(at) > BigInt(state.fictionTimelines[life.timelineId].nowMicros))
      .map(at => ({ promiseId, timelineId: life.timelineId, at }));
  });
}

export function promiseReviewDescriptors(state: AuthoritativeWorldState, otherWork: DueActivityDescriptor[]): DueActivityDescriptor[] {
  const individual: DueActivityDescriptor[] = Object.keys(state.campaignRuntime.promises).sort().flatMap(promiseId => {
    const frame = promiseReviewFrame(state, promiseId);
    if (!frame || Object.values(state.combatRuntime.encounters).some(encounter => encounter.status !== "concluded"
      && Array.isArray(encounter.participantEntityIds) && encounter.participantEntityIds.some(id =>
        typeof id === "string" && characterTimelineId(state, id) === frame.timelineId))) return [];
    // Settle real actions at the boundary first. Advancing an activity is not
    // such an action: it must wait for the review of the current boundary.
    if (otherWork.some(work => work.timelineId === frame.timelineId
      && !work.timePassage && !work.npcWork && work.activityProgress?.phase !== "advance"
      && BigInt(work.completionFictionMicros) <= BigInt(frame.throughFictionMicros))
      || Object.values(state.pendingInputs).some(p => characterTimelineId(state, p.controllerCharacterId) === frame.timelineId)
      || Object.values(state.receipts).some(r => ["awaitingInput", "awaitingRandomness"].includes(r.status)
        && (r.subjectCharacterIds.length === 0 || r.subjectCharacterIds.some(id => characterTimelineId(state, id) === frame.timelineId)))) return [];
    const hash = canonicalSha256(frame);
    return [{ activityId: null, ownerEntityId: frame.promisorId, timelineId: frame.timelineId,
      completionFictionMicros: frame.throughFictionMicros, childRootActionId: `promise-review:${promiseId}:${frame.evidenceFrontier}`,
      activityHash: hash, sceneIds: [state.entities[frame.promisorId].sceneId],
      promiseReview: { promiseId, revision: frame.revision, frameHash: hash } }];
  });
  const groups: DueActivityDescriptor[][] = [];
  for (const descriptor of individual) {
    const group = groups.find(g => g.length < 16 && g[0].timelineId === descriptor.timelineId
      && JSON.stringify(promiseReviewRequest(state, [...g, descriptor].map(d => d.promiseReview!.promiseId))).length <= 160_000);
    if (group) group.push(descriptor); else groups.push([descriptor]);
  }
  return groups.map(group => {
    if (group.length === 1) return group[0];
    const promiseIds = group.map(d => d.promiseReview!.promiseId), request = promiseReviewRequest(state, promiseIds)!;
    const hash = canonicalSha256(request), first = group[0];
    return { activityId: null, ownerEntityId: first.ownerEntityId, timelineId: first.timelineId,
      completionFictionMicros: first.completionFictionMicros, activityHash: hash, childRootActionId: `promise-review-batch:${hash}`,
      sceneIds: [...new Set(group.flatMap(d => d.sceneIds))].sort(),
      promiseReview: { ...first.promiseReview!, frameHash: hash, promiseIds } };
  });
}

export function promiseJudgmentConform(value: unknown): value is PromiseJudgment {
  return isRecord(value) && hasExactKeys(value, ["outcome", "reason", "evidenceRefs", "remaining", ...(Object.hasOwn(value, "completedParts") ? ["completedParts"] : [])])
    && ["unchanged", "progressed", "conditionMet", "conditionUnmet", "fulfilled", "breached", "released"].includes(String(value.outcome)) && isNonEmptyString(value.reason)
    && value.reason.length <= 4000 && refs(value.evidenceRefs) && typeof value.remaining === "boolean";
}

/** Coverage is an explicit, scoped world fact established by the ordinary
 * world-authoring path. The review itself cannot author a negative fact. */
function intervalCovered(frame: PromiseReviewFrame, evidenceRefs: string[]): boolean {
  if (frame.deadlineFictionMicros === null || BigInt(frame.throughFictionMicros) < BigInt(frame.deadlineFictionMicros)) return false;
  return frame.facts.some(f => {
    const c = f.historyCoverage;
    return evidenceRefs.includes(String(f.id)) && worldHistoryCoverageConform(c) && c.timelineId === frame.timelineId
      && BigInt(c.fromFictionMicros) <= BigInt(frame.fromFictionMicros) && BigInt(c.throughFictionMicros) >= BigInt(frame.deadlineFictionMicros!)
      && BigInt(c.throughFictionMicros) <= BigInt(frame.throughFictionMicros)
      && [frame.promisorId, ...frame.terms.subjectRefs].every(ref => c.subjectRefs.includes(ref));
  });
}

export function promiseJudgmentIssue(frame: PromiseReviewFrame, value: unknown): string | undefined {
  if (!promiseJudgmentConform(value)) return "promise:judgment-invalid";
  if (value.completedParts !== undefined && !refs(value.completedParts)) return "promise:parts-invalid";
  const available = new Set([...frame.evidence.map(e => e.eventId), ...frame.facts.map(f => String(f.id)), ...frame.items.map(i => String(i.entryId))]);
  if (value.evidenceRefs.some(ref => !available.has(ref))) return "promise:evidence-unavailable";
  if (value.outcome === "unchanged") return value.remaining ? undefined : "promise:unchanged-cannot-release";
  if (["fulfilled", "conditionUnmet"].includes(value.outcome) && value.remaining) return "promise:terminal-cannot-remain";
  if (["progressed", "conditionMet"].includes(value.outcome) && !value.remaining) return "promise:progress-cannot-release";
  if (value.evidenceRefs.length === 0) return "promise:evidence-unavailable";
  const decisiveFacts = frame.facts.filter(f => f.kind !== "npcPlanTrace");
  const actual = frame.evidence.filter(e => value.evidenceRefs.includes(e.eventId)
    && !["FictionTimeAdvanced", "NpcActionCommitted", "FactionActionCommitted", "SourceClaimCreated", "ActivityCompleted"].includes(e.eventType)
    && !(e.eventType === "CanonicalFactDeclared" && isRecord(e.payload.fact) && e.payload.fact.kind === "npcPlanTrace")
    && (e.eventType !== "KnowledgeAcquired" || e.payload.sourceCharacterId === frame.promisorId || e.payload.characterId === frame.promisorId)
    && (e.eventType !== "WorldInteractionResolved" || (Array.isArray(e.payload.appliedEffects) && e.payload.appliedEffects.length > 0)));
  if (actual.length === 0 && !decisiveFacts.some(f => value.evidenceRefs.includes(String(f.id)))) return "promise:actual-outcome-required";
  const activation = frame.terms.activation;
  if (value.outcome === "conditionMet") {
    if (!activation || frame.conditionStatus !== "pending") return "promise:condition-not-pending";
    if (activation.requiresKnowledge && !value.evidenceRefs.some(ref => frame.promisorKnowledgeRefs.includes(ref)
      || actual.some(e => e.eventId === ref && e.eventType === "KnowledgeAcquired" && e.payload.characterId === frame.promisorId)))
      return "promise:condition-knowledge-required";
    return undefined;
  }
  if (value.outcome === "conditionUnmet") {
    return activation && frame.conditionStatus === "pending" && activation.windowEndFictionMicros !== null
      && intervalCovered({ ...frame, deadlineFictionMicros: activation.windowEndFictionMicros }, value.evidenceRefs)
      ? undefined : "promise:condition-window-evidence-required";
  }
  if (activation && frame.conditionStatus !== "met" && value.outcome !== "released") return "promise:condition-not-met";
  const parts = frame.terms.parts ?? [], completed = new Set([...frame.completedParts, ...(value.completedParts ?? [])]);
  if ((value.completedParts ?? []).some(id => !parts.some(part => part.partId === id))) return "promise:part-unavailable";
  for (const id of value.completedParts ?? []) {
    if (frame.completedParts.includes(id)) continue;
    const part = parts.find(p => p.partId === id)!;
    const issue = promiseJudgmentIssue({ ...frame, terms: { kind: part.kind, subjectRefs: part.subjectRefs, delivery: part.delivery },
      completedParts: [], releasedParts: [] }, { ...value, outcome: "fulfilled", remaining: false, completedParts: [] });
    if (issue) return issue;
  }
  if (value.outcome === "fulfilled" && parts.some(part => !completed.has(part.partId) && !frame.releasedParts.includes(part.partId)))
    return "promise:required-parts-outstanding";
  if (value.outcome === "fulfilled" && frame.terms.kind === "ongoing" && !intervalCovered(frame, value.evidenceRefs)) return "promise:interval-evidence-insufficient";
  if (value.outcome === "breached") {
    const directFact = decisiveFacts.some(f => value.evidenceRefs.includes(String(f.id))
      && actual.some(e => e.eventType === "CanonicalFactDeclared" && isRecord(e.payload.fact) && e.payload.fact.id === f.id));
    const conduct = actual.some(e => (e.eventType === "KnowledgeShared" && e.payload.senderCharacterId === frame.promisorId)
      || (e.eventType === "KnowledgeAcquired" && e.payload.sourceCharacterId === frame.promisorId
        && ![frame.promisorId, frame.promiseeId].includes(String(e.payload.characterId))));
    if (!directFact && !conduct && !intervalCovered(frame, value.evidenceRefs)) return "promise:absence-evidence-insufficient";
  }
  const d = frame.terms.delivery;
  if (value.outcome === "fulfilled" && d !== null) {
    const actualEntries = actual.flatMap(e => e.itemsAfter.map(item => ({ item, event: e })));
    const delivery = actualEntries.find(({ item: i }) => value.evidenceRefs.includes(String(i.entryId))
      && (d.itemRef === null || i.entryId === d.itemRef) && Number(i.quantity) >= d.quantity
      && (d.destinationKind === "holder" ? i.disposition === "held" && i.holderRef === d.destinationRef
        : i.disposition === "scene" && i.sceneRef === d.destinationRef));
    if (!delivery) return "promise:actual-delivery-required";
    const entry = delivery.item;
    if (frame.deadlineFictionMicros !== null && BigInt(delivery.event.atFictionMicros) > BigInt(frame.deadlineFictionMicros)
      && !frame.history.some(h => h.outcome === "breached")) return "promise:late-delivery-needs-breach";
    if (d.sourceRef !== null) {
      if (!frame.evidence.some(e => e.eventType === "AuthoredMaterializationResolved"
        && e.payload.ref === entry.definitionRef && Array.isArray(e.payload.sourceRefs) && e.payload.sourceRefs.includes(d.sourceRef!))) return "promise:delivery-source-unavailable";
    }
  }
  return undefined;
}

export function promiseChangeConform(value: unknown): value is PromiseChange {
  return isRecord(value) && hasExactKeys(value, ["kind", "accepted", "reason", "content", "condition", "terms", "deadlineFictionMicros", "releasedParts", "remaining"])
    && ["amend", "release", "refusal", "method"].includes(String(value.kind)) && typeof value.accepted === "boolean"
    && isNonEmptyString(value.reason) && isNonEmptyString(value.content) && isNonEmptyString(value.condition)
    && (value.terms === null || promiseTermsConform(value.terms)) && (value.deadlineFictionMicros === null || micros(value.deadlineFictionMicros))
    && refs(value.releasedParts) && typeof value.remaining === "boolean";
}

export function promiseChangeIssue(state: AuthoritativeWorldState, payload: unknown, frozenExpression?: JsonRecord): string | undefined {
  if (!isRecord(payload) || !hasExactKeys(payload, ["promiseId", "revision", "expressionRef", "change"])
    || !promiseChangeConform(payload.change)) return "promise:change-invalid";
  const promise = state.campaignRuntime.promises[String(payload.promiseId)], life = promiseLifecycle(promise);
  const expression = frozenExpression ?? state.campaignRuntime.sourceClaims[String(payload.expressionRef)], change = payload.change;
  if (!life || life.revision !== payload.revision || !expression
    || ![promise.promisorId, promise.promiseeId].includes(expression.speakerId)) return "promise:change-authority-unavailable";
  if (!change.accepted) return undefined;
  if (change.kind === "amend") {
    if (!change.terms || life.obligation === "satisfied" || !change.remaining || change.releasedParts.length)
      return "promise:amendment-obligation-unavailable";
    if (state.entities[String(promise.promisorId)]?.kind === "player" && expression.speakerId !== promise.promisorId
      && (change.content !== promise.content || change.condition !== promise.condition || canonicalSha256(change.terms) !== canonicalSha256(life.terms)
        || (life.deadlineFictionMicros !== null && change.deadlineFictionMicros !== null
          && BigInt(change.deadlineFictionMicros) < BigInt(life.deadlineFictionMicros)))) return "promise:player-intent-required";
    const refs = promiseTermsRefs(change.terms);
    if (refs.some(ref => !state.entities[ref] && !state.scenes[ref] && !state.canonicalFacts[ref]
      && !state.campaignRuntime.itemSystem.entries[ref] && !state.campaignRuntime.definitions[ref])) return "promise:change-reference-unavailable";
  } else if (change.terms !== null) return "promise:non-amendment-cannot-rewrite-terms";
  if (change.releasedParts.some(id => !life.terms.parts?.some(part => part.partId === id))) return "promise:release-part-unavailable";
  if (change.kind !== "amend" && (change.content !== promise.content || change.condition !== promise.condition
    || change.deadlineFictionMicros !== life.deadlineFictionMicros)) return "promise:non-amendment-cannot-rewrite-terms";
  if (change.kind === "refusal" && expression.speakerId !== promise.promisorId) return "promise:refusal-expression-required";
  if (change.kind === "release" && change.remaining && change.releasedParts.length === 0) return "promise:release-scope-required";
  if (change.kind !== "release" && change.releasedParts.length > 0) return "promise:release-kind-required";
  if (change.kind === "method" && !change.remaining)
    return "promise:method-cannot-change-obligation";
  return undefined;
}

export function promiseKnownSnapshot(promise: JsonRecord): JsonRecord {
  const life = promiseLifecycle(promise)!;
  return { promiseId: String(promise.promiseId), content: String(promise.content), condition: String(promise.condition),
    status: String(promise.status), revision: life.revision, terms: structuredClone(life.terms) as unknown as JsonRecord,
    deadlineFictionMicros: life.deadlineFictionMicros, remaining: life.obligation === "outstanding",
    completedParts: [...life.completedParts], releasedParts: [...life.releasedParts], conditionStatus: life.conditionStatus,
    outcome: life.history.at(-1)?.outcome ?? "unchanged", atFictionMicros: life.history.at(-1)?.atFictionMicros ?? life.fromFictionMicros };
}

export function promiseChangeDescription(promise: JsonRecord, change: PromiseChange): string {
  const life = promiseLifecycle(promise)!, at = life.changes.at(-1)!.atFictionMicros;
  const remaining = life.deadlineFictionMicros === null ? null : BigInt(life.deadlineFictionMicros) - BigInt(at);
  const time = remaining === null ? "未约定截止时间。" : remaining <= 0n ? "约定的截止时间已经到达。"
    : `自本次变更生效起，约定期限还剩${Number(remaining) / 60_000_000}分钟。`;
  const disposition = change.kind === "release" ? change.remaining ? "仅解除此次说明的部分义务。" : "剩余义务已解除。"
    : change.kind === "refusal" ? "此次明确拒绝被裁定为违约。" : change.kind === "method" ? "仅调整履行方法。" : "此次改约成立。";
  return `${disposition}当前约定：${promise.content}；条件：${promise.condition}。${time}`;
}

/** Disclosing a new agreement does not disclose previously hidden conduct. */
export function promiseChangeSnapshot(promise: JsonRecord, change: PromiseChange): JsonRecord {
  const life = promiseLifecycle(promise)!;
  return { promiseId: promise.promiseId, content: promise.content, condition: promise.condition, revision: life.revision,
    terms: structuredClone(life.terms) as unknown as JsonRecord, deadlineFictionMicros: life.deadlineFictionMicros,
    remaining: change.remaining,
    ...(change.kind === "release" ? { releasedParts: [...change.releasedParts], ...(!change.remaining ? { status: "released" } : {}) } : {}),
    ...(change.kind === "refusal" ? { status: "breached", outcome: "breached", atFictionMicros: life.history.at(-1)!.atFictionMicros } : {}) };
}

/** Viewer and NPC premises share one knowledge-based version selection. */
export function promiseKnownTo(state: AuthoritativeWorldState, promise: JsonRecord, holder: string): JsonRecord | undefined {
  const life = promiseLifecycle(promise);
  if (!life) return undefined;
  const results = Object.values(state.knowledge[holder] ?? {}).flatMap(k => {
    const fact = state.canonicalFacts[k.knowledgeRef];
    return k.layer === "full" && ["canonicalFact", "sensoryEvidence"].includes(k.objectKind)
      && fact?.branchId === state.activeBranchId && ["promiseReviewResult", "promiseTermsResult"].includes(fact.kind)
      && isRecord(fact.value) && fact.value.promiseId === promise.promiseId ? [fact] : [];
  }).sort((a, b) => BigInt(a.validFromEventSeq) < BigInt(b.validFromEventSeq) ? -1 : 1);
  const original = life.versions[0];
  if (!original) return undefined;
  const known: JsonRecord = { promiseId: promise.promiseId, content: original.content, condition: original.condition,
    status: "active", revision: original.revision, terms: structuredClone(original.terms) as unknown as JsonRecord,
    deadlineFictionMicros: original.deadlineFictionMicros, remaining: true, completedParts: [], releasedParts: [],
    conditionStatus: original.terms.activation ? "pending" : "met", history: [] };
  if (isRecord(promise.inheritedKnownPromise)) Object.assign(known, structuredClone(promise.inheritedKnownPromise));
  const history: JsonRecord[] = [];
  for (const fact of results) {
    Object.assign(known, structuredClone(fact.value));
    const value = fact.value as JsonRecord;
    if (isNonEmptyString(value.outcome) && value.outcome !== "unchanged") history.push({ outcome: value.outcome, atFictionMicros: value.atFictionMicros, revision: value.revision });
  }
  return { ...known, history };

}

export function applyPromiseJudgment(promise: JsonRecord, judgment: PromiseJudgment, context: {
  eventId: string; frontier: string; at: string;
}): void {
  const life = promiseLifecycle(promise)!;
  life.reviewedFrontier = context.frontier;
  life.history.push({ ...structuredClone(judgment), reviewRef: context.eventId, evidenceFrontier: context.frontier,
    atFictionMicros: context.at, committedByEventId: context.eventId, revision: life.revision });
  if (judgment.outcome === "unchanged") return;
  life.completedParts = [...new Set([...life.completedParts, ...(judgment.completedParts ?? [])])];
  if (judgment.outcome === "conditionMet") life.conditionStatus = "met";
  if (judgment.outcome === "conditionUnmet") life.conditionStatus = "unmet";
  life.obligation = judgment.remaining ? "outstanding" : "satisfied";
  if (!["progressed", "conditionMet"].includes(judgment.outcome)) promise.status = judgment.outcome;
}

export function applyPromiseLifecycleEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  if (event.eventType === "PromiseTermsEstablished") {
    const payload = event.payload as unknown as JsonRecord;
    const issue = promiseTermsIssue(state, payload);
    if (issue || event.secrecy !== "internal" || event.visibilityPolicyId !== "visibility:room-authority-only") throw new TypeError(issue ?? "promise:terms-authority-policy");
    state.campaignRuntime.promises[String(payload.promiseId)].lifecycle = {
      schema: "zhuwei.promise-lifecycle/vnext-1", revision: "1", originalExpressionRef: payload.originalExpressionRef,
      formedByEventId: event.eventId, formedByRootActionId: event.rootActionId, timelineId: payload.timelineId, fromFictionMicros: payload.fromFictionMicros,
      deadlineFictionMicros: payload.deadlineFictionMicros, terms: structuredClone(payload.terms),
      obligation: "outstanding", history: [], evidence: [], reviewedFrontier: null,
      ...promiseInitialObjects(state, payload.terms as PromiseTerms),
      versions: [{ revision: "1", content: state.campaignRuntime.promises[String(payload.promiseId)].content,
        condition: state.campaignRuntime.promises[String(payload.promiseId)].condition, terms: structuredClone(payload.terms),
        effectiveAtFictionMicros: payload.fromFictionMicros, deadlineFictionMicros: payload.deadlineFictionMicros,
        expressionRef: payload.originalExpressionRef, reason: "original expression" }],
      completedParts: [], releasedParts: [], changes: [], conditionStatus: (payload.terms as PromiseTerms).activation ? "pending" : "met",
    };
    return true;
  }
  if (event.eventType === "PromiseReviewed") {
    const payload = event.payload as unknown as JsonRecord, frame = promiseReviewFrame(state, String(payload.promiseId));
    if (!frame || !hasExactKeys(payload, ["promiseId", "frameHash", "judgment"]) || canonicalSha256(frame) !== payload.frameHash
      || promiseJudgmentIssue(frame, payload.judgment) || event.secrecy !== "internal" || event.visibilityPolicyId !== "visibility:room-authority-only") throw new TypeError("promise:review-integrity-invalid");
    const promise = state.campaignRuntime.promises[frame.promiseId];
    const judgment = payload.judgment as PromiseJudgment;
    applyPromiseJudgment(promise, judgment, { eventId: event.eventId, frontier: frame.evidenceFrontier, at: frame.throughFictionMicros });
    return true;
  }
  if (event.eventType === "PromiseChanged") {
    const payload = event.payload as unknown as JsonRecord, issue = promiseChangeIssue(state, payload);
    if (issue || event.secrecy !== "internal" || event.visibilityPolicyId !== "visibility:room-authority-only") throw new TypeError(issue ?? "promise:change-policy-invalid");
    const promise = state.campaignRuntime.promises[String(payload.promiseId)], life = promiseLifecycle(promise)!;
    const change = payload.change as PromiseChange;
    if (change.accepted && change.kind === "amend" && change.terms) {
      const objects = promiseInitialObjects(state, change.terms);
      for (const item of objects.initialItems) if (!life.initialItems.some(i => i.entryId === item.entryId)) life.initialItems.push(item);
      for (const d of objects.initialDefinitions) if (!life.initialDefinitions.some(i => (i.definitionId ?? i.ref) === (d.definitionId ?? d.ref))) life.initialDefinitions.push(d);
    }
    applyPromiseChange(promise, change, { eventId: event.eventId, at: event.fictionInstantMicros, expressionRef: String(payload.expressionRef) });
    return true;
  }
  return false;
}

export function applyPromiseChange(promise: JsonRecord, change: PromiseChange, context: { eventId: string; at: string; expressionRef: string }): void {
  const life = promiseLifecycle(promise)!;
    life.changes.push({ eventId: context.eventId, revision: life.revision, expressionRef: context.expressionRef,
      atFictionMicros: context.at, change: structuredClone(change) });
    if (!change.accepted || change.kind === "method") return;
    if (change.kind === "amend") {
      // Preserve completed requirements only while their exact meaning stays
      // the same; a revision never silently retcons old completion evidence.
      const oldParts = life.terms.parts ?? [];
      life.completedParts = life.completedParts.filter(id => {
        const before = oldParts.find(part => part.partId === id), after = change.terms!.parts?.find(part => part.partId === id);
        return before && after && canonicalSha256(before) === canonicalSha256(after);
      });
      life.releasedParts = life.releasedParts.filter(id => {
        const before = oldParts.find(part => part.partId === id), after = change.terms!.parts?.find(part => part.partId === id);
        return before && after && canonicalSha256(before) === canonicalSha256(after);
      });
      const activationChanged = canonicalSha256(life.terms.activation ?? null) !== canonicalSha256(change.terms!.activation ?? null);
      life.terms = structuredClone(change.terms!); life.deadlineFictionMicros = change.deadlineFictionMicros;
      promise.content = change.content; promise.condition = change.condition;
      if (activationChanged) life.conditionStatus = life.terms.activation ? "pending" : "met";
      life.revision = String(BigInt(life.revision) + 1n); life.reviewedFrontier = null;
      life.versions.push({ revision: life.revision, content: change.content, condition: change.condition, terms: structuredClone(life.terms),
        effectiveAtFictionMicros: context.at, deadlineFictionMicros: life.deadlineFictionMicros,
        expressionRef: context.expressionRef, reason: change.reason });
    }
    if (change.kind === "release") {
      life.releasedParts = [...new Set([...life.releasedParts, ...change.releasedParts])];
      if (!change.remaining) promise.status = "released";
    }
    if (change.kind === "refusal") {
      applyPromiseJudgment(promise, { outcome: "breached", reason: change.reason, evidenceRefs: [context.expressionRef], remaining: change.remaining },
        { eventId: context.eventId, frontier: promiseReviewFrontier(life, context.at), at: context.at });
    }
    life.obligation = change.remaining ? "outstanding" : "satisfied";
}
