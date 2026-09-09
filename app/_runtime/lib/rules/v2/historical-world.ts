import { canonicalSha256 } from "../profiles/canonical";
import { resolveRuntimeProfileManifest, type RuntimeProfileRegistry } from "../profiles/registry";
import type { Sha256Ref } from "../profiles/types";
import { initializeAuthoritativeWorld } from "./actions";
import { emptyCorrectionRuntime } from "./correction";
import type { AuthoritativeWorldState, CanonicalFactRecord, EventEnvelope, JsonRecord, KnowledgeRecord,
  ReplayResult, RuntimeGenesis, StepResult } from "./model";
import { emptyMultiplayerRuntime, fictionTimelineIdForScene } from "./multiplayer-model";
import { rejected } from "./results";
import { allocateDynamicCombatantSpawn } from "./spatial-spawn";
import { createDefinitionSnapshot, isStoredSemanticDefinition, storedSemanticDefinition, type StoredSemanticDefinition } from "./semantic-definitions";
import { isStoryTemporalEvidence, storyTemporalEvidenceIssue, storyTemporalEvidenceRef,
  storyTemporalPosition, type StoryTemporalEvidence, type StoryTemporalKnowledge } from "./story-temporal-evidence";
import { hasExactKeys, hashWorldState, isAuthoritativeWorldState, isNonEmptyString, isRecord,
  isRuntimeGenesis, isSha256 } from "./validation";
import { isWorldFactPointer, worldFactDefinition, worldFactPointer, type AuthoredWorldFact } from "./world-facts";

/** Structurally matches the existing authoritative archive. Audit arrays are
 * committed bytes only; they never supply state or historical dates. Rules
 * deliberately has no dependency on the Room archive adapter. */
export type HistoricalSourceArchive = {
  format: "zhuwei.authoritative-room-archive/v2";
  roomId: string;
  signedGenesis: RuntimeGenesis;
  events: readonly EventEnvelope[];
  receiptRefs: readonly unknown[];
  projectionAudits: readonly unknown[];
  head: { eventSeq: string; eventHash: Sha256Ref; stateHash: Sha256Ref; activeBranchId: string };
  archiveHash: Sha256Ref;
};

export type InitializeHistoricalWorldInput = {
  kind: "initializeHistoricalWorld";
  schema: "zhuwei.historical-world-initialization/v1";
  roomId: string;
  runtimeEpochId: string;
  activeBranchId: string;
  sourceArchive: HistoricalSourceArchive;
  cut: { eventSeq: string; focusSceneId: string };
  identity: {
    principal: { id: string; sessionVersion: number };
    seatId: string;
    /** The ordinary initializer validates this one fresh player build. */
    character: JsonRecord;
    originBasisRefs: readonly string[];
  };
};

type DefinitionDerivation = {
  definitionRef: string; sourceRevision: string; sourceHash: Sha256Ref;
  targetRevision: string; targetHash: Sha256Ref;
};
type SupplementOrigin = {
  evidenceRef: string; evidenceHash: Sha256Ref; factRef: string; factHash: Sha256Ref;
  knowledge: Array<{ holderRef: string; knowledgeRef: string; recordHash: Sha256Ref }>;
  definitions: DefinitionDerivation[];
};
export type HistoricalOrigin = {
  schema: "zhuwei.historical-origin/v1";
  source: { roomId: string; runtimeEpochId: string; branchId: string; genesisHash: Sha256Ref;
    archiveHash: Sha256Ref; headEventSeq: string; headEventHash: Sha256Ref; headStateHash: Sha256Ref };
  cut: { eventSeq: string; eventHash: Sha256Ref; stateHash: Sha256Ref; focusSceneId: string };
  timelineMap: Array<{ sourceTimelineId: string; targetTimelineId: string; nowMicros: string }>;
  /** These are source provenance commitments, never target action receipts. */
  evidence: Array<{ evidenceRef: string; recordHash: Sha256Ref }>;
  supplements: SupplementOrigin[];
  identity: { characterId: string; principalId: string; seatId: string; seedHash: Sha256Ref; originBasisRefs: string[] };
};

const sequence = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
const strings = (value: unknown): value is string[] => Array.isArray(value)
  && value.every(isNonEmptyString) && new Set(value).size === value.length;
const empty = (value: object | undefined): boolean => value === undefined || Object.keys(value).length === 0;
const same = (left: unknown, right: unknown): boolean => canonicalSha256(left) === canonicalSha256(right);

export function isHistoricalOrigin(value: unknown): value is HistoricalOrigin {
  if (!isRecord(value) || !hasExactKeys(value, ["schema", "source", "cut", "timelineMap", "evidence", "supplements", "identity"])
    || value.schema !== "zhuwei.historical-origin/v1" || !isRecord(value.source) || !isRecord(value.cut)
    || !isRecord(value.identity) || !Array.isArray(value.timelineMap) || !Array.isArray(value.evidence)
    || !Array.isArray(value.supplements)) return false;
  const { source, cut, identity } = value;
  if (!hasExactKeys(source, ["roomId", "runtimeEpochId", "branchId", "genesisHash", "archiveHash", "headEventSeq", "headEventHash", "headStateHash"])
    || ![source.roomId, source.runtimeEpochId, source.branchId].every(isNonEmptyString)
    || ![source.genesisHash, source.archiveHash, source.headEventHash, source.headStateHash].every(isSha256)
    || !sequence(source.headEventSeq)
    || !hasExactKeys(cut, ["eventSeq", "eventHash", "stateHash", "focusSceneId"])
    || !sequence(cut.eventSeq) || BigInt(cut.eventSeq) > BigInt(source.headEventSeq)
    || !isSha256(cut.eventHash) || !isSha256(cut.stateHash) || !isNonEmptyString(cut.focusSceneId)
    || !hasExactKeys(identity, ["characterId", "principalId", "seatId", "seedHash", "originBasisRefs"])
    || ![identity.characterId, identity.principalId, identity.seatId].every(isNonEmptyString)
    || !isSha256(identity.seedHash) || !strings(identity.originBasisRefs) || identity.originBasisRefs.length === 0) return false;
  const timelineKeys = new Set<string>(), targetKeys = new Set<string>(), evidenceKeys = new Set<string>(), factKeys = new Set<string>();
  return value.timelineMap.length > 0 && value.timelineMap.every(entry => {
    if (!isRecord(entry) || !hasExactKeys(entry, ["sourceTimelineId", "targetTimelineId", "nowMicros"])
      || !isNonEmptyString(entry.sourceTimelineId) || !isNonEmptyString(entry.targetTimelineId) || !sequence(entry.nowMicros)
      || timelineKeys.has(entry.sourceTimelineId) || targetKeys.has(entry.targetTimelineId)) return false;
    timelineKeys.add(entry.sourceTimelineId); targetKeys.add(entry.targetTimelineId); return true;
  }) && value.evidence.every(entry => {
    if (!isRecord(entry) || !hasExactKeys(entry, ["evidenceRef", "recordHash"])
      || !isNonEmptyString(entry.evidenceRef) || !isSha256(entry.recordHash) || evidenceKeys.has(entry.evidenceRef)) return false;
    evidenceKeys.add(entry.evidenceRef); return true;
  }) && value.supplements.every(entry => {
    if (!isRecord(entry) || !hasExactKeys(entry, ["evidenceRef", "evidenceHash", "factRef", "factHash", "knowledge", "definitions"])
      || !isNonEmptyString(entry.evidenceRef) || !evidenceKeys.has(entry.evidenceRef)
      || !isSha256(entry.evidenceHash) || !isNonEmptyString(entry.factRef) || factKeys.has(entry.factRef)
      || !isSha256(entry.factHash) || !Array.isArray(entry.knowledge) || !Array.isArray(entry.definitions)) return false;
    factKeys.add(entry.factRef);
    const knowledgeKeys = new Set<string>(), definitionKeys = new Set<string>();
    return entry.knowledge.every(k => {
      if (!isRecord(k) || !hasExactKeys(k, ["holderRef", "knowledgeRef", "recordHash"])
        || !isNonEmptyString(k.holderRef) || !isNonEmptyString(k.knowledgeRef) || !isSha256(k.recordHash)) return false;
      const key = `${k.holderRef}\u0000${k.knowledgeRef}`;
      if (knowledgeKeys.has(key)) return false; knowledgeKeys.add(key); return true;
    }) && entry.definitions.every(d => {
      if (!isRecord(d) || !hasExactKeys(d, ["definitionRef", "sourceRevision", "sourceHash", "targetRevision", "targetHash"])
        || !isNonEmptyString(d.definitionRef) || definitionKeys.has(d.definitionRef)
        || !sequence(d.sourceRevision) || !sequence(d.targetRevision) || !isSha256(d.sourceHash) || !isSha256(d.targetHash)) return false;
      definitionKeys.add(d.definitionRef); return true;
    });
  });
}

function archiveConform(value: unknown): value is HistoricalSourceArchive {
  return isRecord(value) && hasExactKeys(value, ["format", "roomId", "signedGenesis", "events", "receiptRefs", "projectionAudits", "head", "archiveHash"])
    && value.format === "zhuwei.authoritative-room-archive/v2" && isNonEmptyString(value.roomId)
    && isRuntimeGenesis(value.signedGenesis) && value.signedGenesis.roomId === value.roomId
    && Array.isArray(value.events) && Array.isArray(value.receiptRefs) && Array.isArray(value.projectionAudits)
    && isRecord(value.head) && hasExactKeys(value.head, ["eventSeq", "eventHash", "stateHash", "activeBranchId"])
    && sequence(value.head.eventSeq) && isSha256(value.head.eventHash) && isSha256(value.head.stateHash)
    && isNonEmptyString(value.head.activeBranchId) && isSha256(value.archiveHash);
}

function inputConform(value: unknown): value is InitializeHistoricalWorldInput {
  if (!isRecord(value) || !hasExactKeys(value, ["kind", "schema", "roomId", "runtimeEpochId", "activeBranchId", "sourceArchive", "cut", "identity"])
    || value.kind !== "initializeHistoricalWorld" || value.schema !== "zhuwei.historical-world-initialization/v1"
    || ![value.roomId, value.runtimeEpochId, value.activeBranchId].every(isNonEmptyString)
    || !archiveConform(value.sourceArchive) || !isRecord(value.cut)
    || !hasExactKeys(value.cut, ["eventSeq", "focusSceneId"]) || !sequence(value.cut.eventSeq) || !isNonEmptyString(value.cut.focusSceneId)
    || !isRecord(value.identity) || !hasExactKeys(value.identity, ["principal", "seatId", "character", "originBasisRefs"])) return false;
  const identity = value.identity;
  return isRecord(identity.principal) && hasExactKeys(identity.principal, ["id", "sessionVersion"])
    && isNonEmptyString(identity.principal.id) && Number.isSafeInteger(identity.principal.sessionVersion)
    && Number(identity.principal.sessionVersion) > 0 && isNonEmptyString(identity.seatId)
    && isRecord(identity.character) && strings(identity.originBasisRefs) && identity.originBasisRefs.length > 0;
}

function refAvailable(state: AuthoritativeWorldState, ref: string): boolean {
  return Object.hasOwn(state.entities, ref) || Object.hasOwn(state.scenes, ref) || Object.hasOwn(state.canonicalFacts, ref)
    || Object.hasOwn(state.campaignRuntime.definitions, ref) || Object.hasOwn(state.campaignRuntime.sourceClaims, ref)
    || Object.hasOwn(state.campaignRuntime.itemSystem.entries, ref)
    || Object.entries(state.knowledge).some(([holder, entries]) => Object.hasOwn(entries, ref)
      || Object.keys(entries).some(key => ref === `knowledge:${holder}:${key}`));
}

function containsTemporalBinding(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsTemporalBinding);
  return isRecord(value) && Object.entries(value).some(([key, nested]) =>
    ["timelineId", "branchId", "sourceTimelineId", "destinationTimelineId"].includes(key) || containsTemporalBinding(nested));
}

function supportedCut(state: AuthoritativeWorldState): boolean {
  if (!empty(state.pendingInputs) || !empty(state.internalContinuations) || !empty(state.atomicWorldInteractions)
    || !empty(state.frozenPlayerChoices) || !empty(state.combatRuntime.pendingInputs) || !empty(state.combatRuntime.randomnessResolutions)
    || !empty(state.multiplayerRuntime.suspendedPendingInputs)
    || Object.values(state.receipts).some(r => r.status === "awaitingInput" || r.status === "awaitingRandomness")
    || Object.values(state.combatRuntime.encounters).some(e => e.status !== "concluded")
    || !empty(state.correctionRuntime.corrections) || !empty(state.correctionRuntime.branches)
    || Object.values(state.campaignRuntime.npcPlans).some(p => p.schema === "zhuwei.npc-work/vnext-1" && p.status === "started")
    || Object.values(state.campaignRuntime.definitions).some(containsTemporalBinding)) return false;
  return Object.values(state.campaignRuntime.activities).every(activity => {
    if (activity.status !== "active") return true;
    if (!isRecord(activity.completion) || activity.completion.kind !== "actorPlan"
      || !isNonEmptyString(activity.completion.planId)) return false;
    const plan = state.campaignRuntime.npcPlans[activity.completion.planId];
    return plan?.status === "scheduled" && plan.npcId === activity.characterId
      && isRecord(plan.activity) && plan.activity.activityId === activity.activityId;
  });
}

function timelineTranslation(state: AuthoritativeWorldState, targetBranch: string): HistoricalOrigin["timelineMap"] | undefined {
  const result: HistoricalOrigin["timelineMap"] = [], targets = new Set<string>();
  for (const [sourceTimelineId, timeline] of Object.entries(state.fictionTimelines).sort(([a], [b]) => a.localeCompare(b))) {
    if (timeline.branchId !== state.activeBranchId) return undefined;
    const frontier = state.multiplayerRuntime.causalFrontiers[sourceTimelineId];
    const owners = Object.values(state.entities).filter(e => state.multiplayerRuntime.characterTimelineIds[e.id] === sourceTimelineId);
    const scenes = new Set(owners.map(e => e.sceneId));
    const sceneId = isNonEmptyString(frontier?.sceneId) ? frontier.sceneId : scenes.size === 1 ? [...scenes][0] : undefined;
    if (sceneId === undefined || !state.scenes[sceneId] || [...scenes].some(s => s !== sceneId)) return undefined;
    const targetTimelineId = sourceTimelineId === state.activeBranchId && owners.length === 0
      ? targetBranch : fictionTimelineIdForScene(targetBranch, sceneId);
    // Two existing causal frontiers in one scene cannot be silently merged.
    if (targets.has(targetTimelineId)) return undefined;
    targets.add(targetTimelineId); result.push({ sourceTimelineId, targetTimelineId, nowMicros: timeline.nowMicros });
  }
  return result;
}

type SelectedSupplement = { evidenceRecord: CanonicalFactRecord; evidence: StoryTemporalEvidence;
  fact: CanonicalFactRecord; sourceState: AuthoritativeWorldState; lateFact: boolean;
  knowledge: Array<{ binding: StoryTemporalKnowledge; record: KnowledgeRecord }> };

function selectSupplements(archive: HistoricalSourceArchive, cutState: AuthoritativeWorldState,
  readAt: (seq: string) => AuthoritativeWorldState | undefined): SelectedSupplement[] | undefined {
  const events = archive.events, byId = new Map(events.map(event => [event.eventId, event]));
  const selected: SelectedSupplement[] = [], factKeys = new Set<string>();
  for (const event of events) {
    if (event.eventType !== "CanonicalFactDeclared") continue;
    const payload = event.payload as { fact: CanonicalFactRecord };
    if (payload.fact.kind !== "storyTemporalEvidence") continue;
    const evidence = payload.fact.value;
    if (!isStoryTemporalEvidence(evidence) || payload.fact.id !== storyTemporalEvidenceRef(evidence.preparationHash, evidence.candidateRef)
      || payload.fact.visibilityPolicyId !== "visibility:kp-internal" || event.secrecy !== "internal"
      || payload.fact.source !== "dynamicMaterialization"
      || event.visibilityPolicyId !== "visibility:kp-internal" || !same(payload.fact.causalParentIds, [evidence.factRef])
      || factKeys.has(evidence.factRef)) return undefined;
    factKeys.add(evidence.factRef);
    const sourceState = readAt(event.eventSeq), record = sourceState?.canonicalFacts[payload.fact.id];
    if (!sourceState || !record || storyTemporalEvidenceIssue(sourceState, evidence) !== undefined) return undefined;
    const fact = sourceState.canonicalFacts[evidence.factRef];
    const declared = events.find(e => e.eventSeq === fact.validFromEventSeq);
    // Retrospective dates must be frozen with the actual fact and acquisitions,
    // never attached in a later action after its consequences are known.
    if (!declared || declared.rootActionId !== event.rootActionId || declared.eventType !== "CanonicalFactDeclared"
      || events.some(e => BigInt(e.eventSeq) >= BigInt(declared.eventSeq) && BigInt(e.eventSeq) <= BigInt(event.eventSeq)
        && e.rootActionId !== event.rootActionId)) return undefined;
    // Once the whole evidence action is already in the cut, replay owns its
    // current fact revision and later legitimate knowledge changes. Importing
    // the creation snapshot again would overwrite that established history.
    if (BigInt(event.eventSeq) <= BigInt(cutState.version)) continue;
    const occurrence = storyTemporalPosition(evidence.occurrence, cutState);
    if (occurrence === "unresolved") return undefined;
    const knowledge: SelectedSupplement["knowledge"] = [];
    for (const binding of evidence.knowledge) {
      const held = sourceState.knowledge[binding.holderRef]?.[binding.knowledgeRef];
      const acquired = held === undefined ? undefined : byId.get(held.acquiredByEventId);
      if (!held || !acquired || acquired.rootActionId !== event.rootActionId || BigInt(acquired.eventSeq) > BigInt(event.eventSeq)) return undefined;
      const position = storyTemporalPosition(binding.acquisition, cutState);
      if (position === "unresolved") return undefined;
      if (position === "established" && occurrence !== "established") return undefined;
      if (occurrence !== "established" || position === "after" || BigInt(acquired.eventSeq) <= BigInt(cutState.version)) continue;
      if (!cutState.entities[binding.holderRef]) return undefined;
      knowledge.push({ binding: structuredClone(binding), record: structuredClone(held) });
    }
    if (occurrence !== "established") continue;
    const lateFact = BigInt(fact.validFromEventSeq) > BigInt(cutState.version);
    if (!lateFact && (!cutState.canonicalFacts[fact.id] || !same(cutState.canonicalFacts[fact.id], fact))) return undefined;
    if (lateFact || knowledge.length > 0) selected.push({ evidenceRecord: record, evidence, fact, sourceState, lateFact, knowledge });
  }
  return selected;
}

function importWorldFactDefinition(target: AuthoritativeWorldState, selected: SelectedSupplement,
  mapping: Map<string, string>, origin: SupplementOrigin): StoredSemanticDefinition | undefined {
  const original = worldFactDefinition(selected.sourceState, selected.fact);
  if (!original || !isStoredSemanticDefinition(original)) return undefined;
  const content = structuredClone(original.content), body = content.worldFact as unknown as AuthoredWorldFact;
  const eligibleHolders = new Set(selected.knowledge.map(k => k.binding.holderRef));
  // A later authoring record may include a person who only learned this after
  // the cut. Derive a new branch revision rather than importing that metadata.
  const initialKnowledge = body.initialKnowledge.filter(k => eligibleHolders.has(k.holderRef));
  if (initialKnowledge.some(k => k.acquisitionBasisRefs.some(ref => !refAvailable(target, ref)))) return undefined;
  const coverage = body.historyCoverage;
  let translatedCoverage = coverage;
  if (coverage != null) {
    const timelineId = mapping.get(coverage.timelineId);
    const cutNow = target.fictionTimelines[coverage.timelineId]?.nowMicros;
    if (!timelineId || cutNow === undefined || BigInt(coverage.throughFictionMicros) > BigInt(cutNow)) return undefined;
    translatedCoverage = { ...coverage, timelineId };
  }
  const revisedContent = { ...content, worldFact: { ...structuredClone(body), initialKnowledge,
    ...(coverage === undefined ? {} : { historyCoverage: translatedCoverage }) } };
  const revision = (BigInt(original.revision) + 1n).toString();
  // Static template pins are verified by source replay. They are not world
  // instances and need not be present in the campaign's live catalog.
  const template = target.campaignRuntime.definitions[original.templateRef];
  if (template !== undefined && original.templateRef !== original.definitionId
    && (!isStoredSemanticDefinition(template) || template.definitionHash !== original.templateHash)) return undefined;
  const derived = storedSemanticDefinition("worldFact", original.visibilityPolicyRef,
    createDefinitionSnapshot(original.definitionId, revision, revisedContent), original.templateRef === original.definitionId ? undefined
      : { templateRef: original.templateRef, templateHash: original.templateHash });
  origin.definitions.push({ definitionRef: original.definitionId, sourceRevision: original.revision,
    sourceHash: original.definitionHash as Sha256Ref, targetRevision: derived.revision, targetHash: derived.definitionHash as Sha256Ref });
  target.campaignRuntime.definitions[derived.definitionId] = structuredClone(derived) as unknown as JsonRecord;
  return derived;
}

function mergeFreshRecord<T>(target: Record<string, T>, additions: Record<string, T>): boolean {
  for (const [id, value] of Object.entries(additions)) {
    if (Object.hasOwn(target, id) && !same(target[id], value)) return false;
    target[id] = structuredClone(value);
  }
  return true;
}

/** Pure historical initialization. Only replayed source truth enters the new
 * genesis; Story Seed snapshots and model-proposed target state are rejected.
 * Source event logs remain immutable evidence, separate from the new stream. */
export function initializeHistoricalWorld(registry: RuntimeProfileRegistry, profilesValue: unknown,
  stateValue: unknown, inputValue: unknown, replaySource: (genesis: unknown, events: unknown) => ReplayResult): StepResult {
  if (stateValue !== undefined || !inputConform(inputValue)) return rejected("invalidInitialization", "Historical initialization requires a canonical request and an empty target.");
  try {
    const input = inputValue, archive = input.sourceArchive;
    const { archiveHash: _archiveHash, ...archiveBytes } = archive;
    if (canonicalSha256(archiveBytes) !== archive.archiveHash) return rejected("archiveIntegrityMismatch", "Historical source archive commitment does not match its bytes.");
    if (input.roomId === archive.roomId || input.runtimeEpochId === archive.signedGenesis.runtimeEpochId
      || input.activeBranchId === archive.head.activeBranchId) return rejected("invalidInitialization", "Historical initialization requires a new room, epoch and branch.");
    const resolved = resolveRuntimeProfileManifest(registry, archive.signedGenesis.profiles);
    if (!resolved.ok) return rejected(resolved.rejection.code, resolved.rejection.message);
    if (profilesValue !== undefined && !same(profilesValue, resolved.profiles)) return rejected("profileIntegrityMismatch", "A historical branch must retain the exact source runtime manifest.");
    const head = replaySource(archive.signedGenesis, archive.events);
    if (head.kind !== "replayed" || !isAuthoritativeWorldState(head.state)
      || !same(archive.head, { eventSeq: head.head.eventSeq, eventHash: head.head.eventHash,
        stateHash: head.head.stateHash, activeBranchId: head.state.activeBranchId })) return rejected("archiveIntegrityMismatch", "Historical source replay does not match its declared head.");
    if (BigInt(input.cut.eventSeq) > BigInt(archive.head.eventSeq)) return rejected("invalidInitialization", "Historical cut lies beyond the source head.");
    const prefix = archive.events.filter(event => BigInt(event.eventSeq) <= BigInt(input.cut.eventSeq));
    const roots = new Set(prefix.map(event => event.rootActionId));
    if (archive.events.some(event => event.branchId !== archive.head.activeBranchId
      || BigInt(event.eventSeq) > BigInt(input.cut.eventSeq) && roots.has(event.rootActionId))) return rejected("pendingInputUnresolved", "Historical cut must end at a complete source action boundary.");
    const snapshots = new Map<string, AuthoritativeWorldState>([[head.state.version, head.state]]);
    const readAt = (seq: string): AuthoritativeWorldState | undefined => {
      const cached = snapshots.get(seq); if (cached) return cached;
      const rebuilt = replaySource(archive.signedGenesis, archive.events.filter(event => BigInt(event.eventSeq) <= BigInt(seq)));
      if (rebuilt.kind !== "replayed" || !isAuthoritativeWorldState(rebuilt.state) || rebuilt.state.version !== seq) return undefined;
      snapshots.set(seq, rebuilt.state); return rebuilt.state;
    };
    const cut = readAt(input.cut.eventSeq);
    if (!cut || !cut.scenes[input.cut.focusSceneId] || !supportedCut(cut)) return rejected("pendingInputUnresolved", "Historical cut has an unsupported active transaction, activity, combat or immutable temporal binding.");
    const timelineMap = timelineTranslation(cut, input.activeBranchId);
    if (!timelineMap) return rejected("causalFrontierConflict", "Historical causal frontiers cannot be translated without merging distinct clocks.");
    const mapping = new Map(timelineMap.map(m => [m.sourceTimelineId, m.targetTimelineId]));
    const identity = input.identity, character = identity.character;
    if (!isNonEmptyString(character.id) || character.kind !== "player" || character.tenureStatus !== "active"
      || character.sceneId !== input.cut.focusSceneId || Object.hasOwn(head.state.entities, character.id)
      || Object.hasOwn(cut.seats, identity.seatId) || Object.hasOwn(character, "lastControllerSeatId")
      || Object.hasOwn(character, "lastLongRestCompletedAtMicros")) return rejected("invalidInitialization", "Historical identity must be a fresh player character with no inherited control or tenure.");
    const target = structuredClone(cut), selected = selectSupplements(archive, cut, readAt);
    if (!selected) return rejected("archiveIntegrityMismatch", "Historical occurrence or knowledge evidence is unavailable, inconsistent or ambiguous.");
    const origin: HistoricalOrigin = {
      schema: "zhuwei.historical-origin/v1", source: { roomId: archive.roomId, runtimeEpochId: archive.signedGenesis.runtimeEpochId,
        branchId: archive.head.activeBranchId, genesisHash: archive.signedGenesis.genesisHash, archiveHash: archive.archiveHash,
        headEventSeq: archive.head.eventSeq, headEventHash: archive.head.eventHash, headStateHash: archive.head.stateHash },
      cut: { eventSeq: cut.version, eventHash: cut.eventHeadHash, stateHash: hashWorldState(cut), focusSceneId: input.cut.focusSceneId },
      timelineMap, evidence: Object.values(head.state.canonicalFacts).filter(f => f.kind === "storyTemporalEvidence")
        .sort((a, b) => a.id.localeCompare(b.id)).map(f => ({ evidenceRef: f.id, recordHash: canonicalSha256(f) })),
      supplements: [], identity: { characterId: character.id, principalId: identity.principal.id, seatId: identity.seatId,
        seedHash: canonicalSha256(identity.character), originBasisRefs: [...identity.originBasisRefs] },
    };
    for (const item of selected) {
      const provenance: SupplementOrigin = { evidenceRef: item.evidenceRecord.id, evidenceHash: canonicalSha256(item.evidenceRecord),
        factRef: item.fact.id, factHash: canonicalSha256(item.fact), knowledge: [], definitions: [] };
      let definition: StoredSemanticDefinition | undefined;
      if (item.lateFact) {
        if (Object.hasOwn(target.canonicalFacts, item.fact.id) || item.fact.subjectRefs.some(ref => !refAvailable(target, ref))
          || item.fact.causalParentIds.some(ref => !Object.hasOwn(target.canonicalFacts, ref))) return rejected("privateOrUnknownReference", "Historical fact depends on an unavailable subject or cause.");
        if (isWorldFactPointer(item.fact.value)) {
          definition = importWorldFactDefinition(target, item, mapping, provenance);
          if (!definition) return rejected("invalidInitialization", "Historical fact definition cannot be inherited without future metadata or an unavailable template.");
        }
        target.canonicalFacts[item.fact.id] = { ...structuredClone(item.fact), ...(definition ? { value: worldFactPointer(definition) } : {}) };
      }
      for (const k of item.knowledge) {
        if (Object.hasOwn(target.knowledge[k.binding.holderRef] ?? {}, k.record.knowledgeRef)) return rejected("invalidInitialization", "Historical knowledge conflicts with a record already present at the cut.");
        const held = structuredClone(k.record);
        if (definition && isWorldFactPointer(held.content)) held.content = worldFactPointer(definition);
        held.acquiredAtFictionMicros = k.binding.acquisition.end?.micros ?? k.binding.acquisition.start.micros;
        target.knowledge[k.binding.holderRef] ??= {};
        target.knowledge[k.binding.holderRef][held.knowledgeRef] = held;
        provenance.knowledge.push({ holderRef: held.characterId, knowledgeRef: held.knowledgeRef, recordHash: canonicalSha256(k.record) });
      }
      origin.supplements.push(provenance);
    }
    for (const item of selected) if (item.evidence.occurrence.basisRefs.some(ref => !refAvailable(target, ref))
      || item.knowledge.some(k => k.binding.acquisition.basisRefs.some(ref => !refAvailable(target, ref))
        || !refAvailable(target, k.binding.sourceRef))) return rejected("privateOrUnknownReference", "Historical evidence relies on a source unavailable at the selected cut.");
    if (identity.originBasisRefs.some(ref => !refAvailable(target, ref))) return rejected("privateOrUnknownReference", "Historical new identity has no available origin basis.");
    // Temporal dossiers contain later acquisition dates. Retain their source
    // commitments in origin; do not expose those future records as live facts.
    const temporalRefs = new Set(Object.values(target.canonicalFacts).filter(f => f.kind === "storyTemporalEvidence").map(f => f.id));
    if (Object.values(target.canonicalFacts).some(f => f.kind !== "storyTemporalEvidence" && f.causalParentIds.some(ref => temporalRefs.has(ref)))
      || Object.values(target.knowledge).some(entries => Object.values(entries).some(k => temporalRefs.has(k.knowledgeRef)
        || k.provenanceChain.some(ref => temporalRefs.has(ref))))) return rejected("invalidInitialization", "Historical temporal dossiers were used as playable facts.");
    for (const ref of temporalRefs) delete target.canonicalFacts[ref];
    const focusSource = timelineMap.find(m => m.targetTimelineId === fictionTimelineIdForScene(input.activeBranchId, input.cut.focusSceneId));
    if (!focusSource) return rejected("causalFrontierConflict", "Historical starting scene lacks an established clock.");
    const fresh = initializeAuthoritativeWorld(resolved.profiles, undefined, undefined, {
      kind: "initializeAuthoritativeWorld", roomId: input.roomId, runtimeEpochId: input.runtimeEpochId,
      activeBranchId: input.activeBranchId, moduleRef: archive.signedGenesis.moduleRef,
      initialDefinitionCatalogRef: archive.signedGenesis.initialDefinitionCatalogRef, fictionInstantMicros: focusSource.nowMicros,
      advancementProfile: target.campaignRuntime.campaign?.advancementProfile,
      scenes: [{ ...target.scenes[input.cut.focusSceneId], geometry: target.combatRuntime.scenes[input.cut.focusSceneId]?.geometry }],
      principals: [{ ...identity.principal, role: "host" }], seats: [{ id: identity.seatId, principalId: identity.principal.id, status: "active" }],
      characters: [structuredClone(character)], characterControls: [{ characterId: character.id, seatId: identity.seatId }],
      canonicalFacts: [], initialKnowledge: [],
    });
    if (fresh.kind !== "initialized" || !isAuthoritativeWorldState(fresh.genesis.initialState)) return rejected("invalidInitialization", "Historical new character failed the ordinary build and inventory rules.");
    const freshState = fresh.genesis.initialState, spawn = allocateDynamicCombatantSpawn(target, input.cut.focusSceneId);
    if (spawn.kind === "unavailable") return rejected("spatialCapacityUnavailable", "Historical starting scene has no available tactical position.");
    if (!mergeFreshRecord(target.campaignRuntime.itemSystem.definitions, freshState.campaignRuntime.itemSystem.definitions)
      || Object.keys(freshState.campaignRuntime.itemSystem.entries).some(id => Object.hasOwn(target.campaignRuntime.itemSystem.entries, id))
      || !mergeFreshRecord(target.campaignRuntime.itemSystem.entries, freshState.campaignRuntime.itemSystem.entries)
      || !mergeFreshRecord(target.combatRuntime.definitions, freshState.combatRuntime.definitions)) return rejected("invalidInitialization", "Historical new equipment or ability definitions conflict with inherited unique state.");
    const ordinal = (Object.values(target.entities).reduce((max, e) => BigInt(e.entityOrdinal) > max ? BigInt(e.entityOrdinal) : max, 0n) + 1n).toString();
    for (const entity of Object.values(target.entities)) { delete entity.controllerPrincipalId; delete entity.lastControllerSeatId; }
    for (const entity of Object.values(target.combatRuntime.entities)) { delete entity.controllerPrincipalId; delete entity.lastControllerSeatId; }
    target.entities[character.id] = { ...freshState.entities[character.id], entityOrdinal: ordinal };
    target.combatRuntime.entities[character.id] = { ...freshState.combatRuntime.entities[character.id], entityOrdinal: ordinal, position: spawn.position };
    target.knowledge[character.id] = {};
    target.roomId = input.roomId; target.runtimeEpochId = input.runtimeEpochId; target.activeBranchId = input.activeBranchId;
    target.version = "0"; target.lastEventId = null;
    target.principals = freshState.principals; target.seats = freshState.seats; target.characterControls = freshState.characterControls;
    target.receipts = {}; target.pendingInputs = {}; target.internalContinuations = {};
    if (target.frozenPlayerChoices !== undefined) target.frozenPlayerChoices = {};
    if (target.atomicWorldInteractions !== undefined) target.atomicWorldInteractions = {};
    target.correctionRuntime = emptyCorrectionRuntime(input.roomId, input.runtimeEpochId);
    target.campaignRuntime.inheritanceSources = {}; target.campaignRuntime.retryChanges = {};
    target.campaignRuntime.campaign!.campaignId = `campaign:${input.roomId}`;
    target.fictionTimelines = Object.fromEntries(timelineMap.map(m => [m.targetTimelineId, { branchId: input.activeBranchId, nowMicros: m.nowMicros }]));
    target.fictionTimelines[input.activeBranchId] = { branchId: input.activeBranchId, nowMicros: cut.fictionTimelines[cut.activeBranchId].nowMicros };
    const multiplayer = emptyMultiplayerRuntime(input.roomId, input.runtimeEpochId,
      { [identity.principal.id]: { ...identity.principal, role: "host" } }, target.seats, target.entities,
      target.characterControls, input.activeBranchId, target.scenes, focusSource.nowMicros);
    multiplayer.partyGroups = structuredClone(cut.multiplayerRuntime.partyGroups);
    multiplayer.characterTimelineIds = Object.fromEntries(Object.keys(cut.entities).map(id => {
      const sourceId = cut.multiplayerRuntime.characterTimelineIds[id] ?? cut.activeBranchId, mapped = mapping.get(sourceId);
      if (!mapped) throw new TypeError("historical character timeline unavailable"); return [id, mapped];
    }));
    multiplayer.characterTimelineIds[character.id] = focusSource.targetTimelineId;
    multiplayer.causalFrontiers = {};
    for (const m of timelineMap) {
      const old = cut.multiplayerRuntime.causalFrontiers[m.sourceTimelineId];
      if (!old || !isNonEmptyString(old.sceneId)) throw new TypeError("historical frontier unavailable");
      multiplayer.causalFrontiers[m.targetTimelineId] = { timelineId: m.targetTimelineId, sceneId: old.sceneId,
        branchId: input.activeBranchId, nowMicros: m.nowMicros, eventHeadId: null,
        causalParentTimelineIds: Array.isArray(old.causalParentTimelineIds) ? old.causalParentTimelineIds.map(id => {
          const mapped = mapping.get(String(id)); if (!mapped) throw new TypeError("historical causal parent unavailable"); return mapped;
        }) : [] };
    }
    multiplayer.causalFrontiers[input.activeBranchId] = { timelineId: input.activeBranchId,
      sceneId: String(cut.multiplayerRuntime.causalFrontiers[cut.activeBranchId]?.sceneId ?? input.cut.focusSceneId),
      branchId: input.activeBranchId, nowMicros: target.fictionTimelines[input.activeBranchId].nowMicros, eventHeadId: null, causalParentTimelineIds: [] };
    target.multiplayerRuntime = multiplayer;
    for (const fact of Object.values(target.canonicalFacts)) { fact.branchId = input.activeBranchId; fact.validFromEventSeq = "0"; }
    for (const promise of Object.values(target.campaignRuntime.promises)) if (isRecord(promise.lifecycle)) {
      const timeline = mapping.get(String(promise.lifecycle.timelineId)); if (!timeline) throw new TypeError("historical promise timeline unavailable");
      promise.lifecycle.timelineId = timeline;
    }
    for (const activity of Object.values(target.campaignRuntime.activities)) if (activity.status === "active" && isRecord(activity.progression)) {
      const timeline = mapping.get(String(activity.progression.timelineId)); if (!timeline) throw new TypeError("historical activity timeline unavailable");
      activity.progression.timelineId = timeline;
      if (isRecord(activity.progression.timelineAtStart)) activity.progression.timelineAtStart.branchId = input.activeBranchId;
    }
    if (!isHistoricalOrigin(origin) || !isAuthoritativeWorldState(target)) return rejected("invalidInitialization", "Historical genesis derivation did not produce valid authority state.");
    const initialStateHash = hashWorldState(target); target.eventHeadHash = initialStateHash;
    const unsigned = { kind: "roomGenesis" as const, roomId: input.roomId, runtimeEpochId: input.runtimeEpochId,
      profiles: structuredClone(resolved.profiles), moduleRef: structuredClone(archive.signedGenesis.moduleRef),
      initialDefinitionCatalogRef: structuredClone(archive.signedGenesis.initialDefinitionCatalogRef), initialState: target,
      initialStateHash, historicalOrigin: origin };
    const genesis = { ...unsigned, genesisHash: canonicalSha256(unsigned) };
    // The public dispatcher/replay validates the same additive origin protocol.
    return { kind: "initialized", profiles: structuredClone(resolved.profiles), genesis };
  } catch {
    return rejected("invalidInitialization", "Historical initialization could not establish a canonical, causally complete target genesis.");
  }
}
