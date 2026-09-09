import type { AuthoritativeWorldState, EventEnvelope, replay } from "../rules";
import { archiveSha256, canonicalJson, validateAuthoritativeArchive, type AuthoritativeRoomArchive } from "./archive";
import type {
  StoryAdmittedFactBinding, StoryHistoryMaterialSnapshot,
  StoryStoreArchiveSnapshot,
} from "./story-creation-invocation";
import type { StoryHash, StoryPreparation, StoryRecord, StoryRequest } from "./story-creation/contracts";
import { exact, hash, isRecord, sequence, text, uniqueStrings, validPreparation } from "./story-history/validation";

/** The host supplies its versioned prepared-action/NPC/narration DTO and
 * validates that exact DTO again on restore. No SQL or arbitrary Rules input
 * is admitted by this envelope. Physical send state/capability remains solely
 * in StoryStore; invocationIds are references to that ledger. */
export type StoryArchiveHostBinding = Readonly<{
  bindingId: string;
  kind: "preparedAction" | "npcDecision" | "viewerNarration";
  source: StoryRequest["source"];
  jobIds: readonly string[];
  invocationIds: readonly string[];
  payload: StoryRecord;
  payloadHash: StoryHash;
}>;
export type StoryRoomArchive = Readonly<{
  format: "zhuwei.story-room-archive/v1";
  audience: "trustedSystemOnly";
  source: Readonly<{
    roomId: string;
    runtimeEpochId: string;
    archiveHash: StoryHash;
    head: AuthoritativeRoomArchive["head"];
  }>;
  /** DO-owned operational revision. Model progress may change this without
   * changing any Rules event or fictional time. */
  generation: string;
  archive: AuthoritativeRoomArchive;
  storySnapshot: StoryStoreArchiveSnapshot;
  hostBindings: readonly StoryArchiveHostBinding[];
  contentHash: StoryHash;
}>;
export type StoryArchiveDispatchQuarantine = Readonly<{
  enforcement: "hostRequiredBeforeRestoreExposure";
  invocationIds: readonly string[];
  /** Fence every archived source, including completed stages: its next stage
   * may have dispatched after the asynchronous backup was captured. This
   * prevents minting a different invocationKey to bypass quarantine. */
  sourceBudgetAccountIds: readonly string[];
}>;
export type StoryArchivePorts = Readonly<{
  replay: typeof replay;
  /** Pure, synchronous and mandatory. Reuse the host's exact frozen DTO and
   * semantic-stage validators; a JSON/hash-only check is not sufficient. */
  validateHostBinding(binding: StoryArchiveHostBinding, context: Readonly<{
    archive: AuthoritativeRoomArchive;
    storySnapshot: StoryStoreArchiveSnapshot;
  }>): boolean;
}>;
export type StoryArchiveFailureCode = "STORY_ARCHIVE_INVALID" | "STORY_ARCHIVE_WORLD_INVALID"
  | "STORY_ARCHIVE_BINDING_INVALID" | "STORY_ARCHIVE_MATERIALS_MISSING" | "STORY_ARCHIVE_HOST_BINDING_INVALID";
export type StoryArchiveRejection = Readonly<{ kind: "rejected"; code: StoryArchiveFailureCode }>;
type CheckedStoryArchive = Readonly<{
  envelope: StoryRoomArchive;
  historyMaterials: StoryHistoryMaterialSnapshot;
  quarantine: StoryArchiveDispatchQuarantine;
}>;
export type StoryArchiveBuildResult = (Readonly<{ kind: "prepared" }> & CheckedStoryArchive) | StoryArchiveRejection;
export type StoryArchiveValidationResult = (Readonly<{ kind: "validated" }> & CheckedStoryArchive) | StoryArchiveRejection;

class ArchiveInputError extends Error {
  constructor(readonly code: StoryArchiveFailureCode) { super(code); }
}
function invalid(code: StoryArchiveFailureCode = "STORY_ARCHIVE_BINDING_INVALID"): never { throw new ArchiveInputError(code); }
function same(a: unknown, b: unknown): boolean { return canonicalJson(a) === canonicalJson(b); }
function exactOptional(value: unknown, required: readonly string[], optional: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function source(value: unknown): value is StoryRequest["source"] {
  return exact(value, ["roomId", "runtimeEpochId", "branchId", "kind", "sourceId", "budgetAccountId"])
    && [value.roomId, value.runtimeEpochId, value.branchId, value.sourceId, value.budgetAccountId].every(text)
    && ["playerAction", "worldEvent"].includes(String(value.kind));
}
function sourceMatchesRoom(value: StoryRequest["source"], archive: AuthoritativeRoomArchive): boolean {
  return value.roomId === archive.roomId && value.runtimeEpochId === archive.signedGenesis.runtimeEpochId;
}
function ids<T>(values: readonly T[], key: (value: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = key(value);
    if (!text(id) || result.has(id)) invalid();
    result.set(id, value);
  }
  return result;
}
function candidateRefs(preparation: StoryPreparation): Set<string> {
  return new Set([...preparation.facts.flatMap(fact => [fact.ref, ...fact.knowledge.map(item => item.ref)]),
    ...[preparation.definitions, preparation.participants, preparation.opportunities, preparation.scenes,
      preparation.evidence, preparation.developments, preparation.resolutions, preparation.stages]
      .flatMap(values => values.map(value => value.ref))]);
}
function passed(checkpoint: StoryStoreArchiveSnapshot["jobs"][number]["checkpoint"]): boolean {
  const review = checkpoint?.revisedReview ?? checkpoint?.review;
  return checkpoint?.status === "ready" && review !== undefined && review.findings.length > 0
    && review.findings.every(value => value.verdict === "pass") && review.recipeCriteria.every(value => value.verdict === "pass");
}

async function checkSnapshot(snapshot: StoryStoreArchiveSnapshot, archive: AuthoritativeRoomArchive) {
  if (!exact(snapshot, ["format", "source", "accounts", "jobs", "invocations", "admissionBindings", "admissions", "materialManifest", "snapshotHash"])
    || snapshot.format !== "zhuwei.story-store-archive/v1"
    || !same(snapshot.source, { roomId: archive.roomId, runtimeEpochId: archive.signedGenesis.runtimeEpochId })
    || ![snapshot.accounts, snapshot.jobs, snapshot.invocations, snapshot.admissionBindings,
      snapshot.admissions, snapshot.materialManifest].every(Array.isArray)) invalid();
  const { snapshotHash, ...body } = snapshot;
  if (!hash(snapshotHash) || await archiveSha256(body) !== snapshotHash) invalid();
  const accounts = ids(snapshot.accounts, value => value.accountId);
  for (const account of accounts.values()) {
    if (!exact(account, ["accountId", "scopeKey", "kind", "binding", "limits", "spent", "held"])
      || !text(account.scopeKey) || !["job", "source", "room"].includes(account.kind) || !isRecord(account.binding)) invalid();
    for (const amount of [account.limits, account.spent, account.held]) {
      if (!exact(amount, ["calls", "inputTokens", "outputTokens", "estimatedCostMicros", "elapsedMs"])
        || Object.values(amount).some(value => !Number.isSafeInteger(value) || Number(value) < 0)) invalid();
    }
    if (account.kind === "source") {
      if (!source(account.binding.source) || !sourceMatchesRoom(account.binding.source, archive)
        || account.binding.source.budgetAccountId !== account.accountId
        || accounts.get(String(account.binding.roomAccountId))?.kind !== "room") invalid();
    }
    if (account.kind === "room" && (account.binding.roomId !== archive.roomId
      || account.binding.runtimeEpochId !== archive.signedGenesis.runtimeEpochId)) invalid();
  }
  const jobs = ids(snapshot.jobs, value => value.input.request.jobId);
  for (const job of jobs.values()) {
    if (!exact(job, ["input", "opportunityKey", "identityHash", "requestHash", "checkpoint", "unallocated"])
      || !exact(job.input, ["request", "context", "modelRef", "budget", "stageReservation"])
      || !source(job.input.request.source) || !sourceMatchesRoom(job.input.request.source, archive)
      || !accounts.has(`story-job:${job.input.request.jobId}`) || !accounts.has(job.input.request.source.budgetAccountId)
      || !accounts.has(job.input.budget.roomAccountId) || !Array.isArray(job.input.context.readSet)) invalid();
    const { contextHash, ...context } = job.input.context;
    if (await archiveSha256(context) !== contextHash || await archiveSha256(job.input.request) !== job.requestHash) invalid();
    if (job.checkpoint !== null && (job.checkpoint.jobId !== job.input.request.jobId
      || job.checkpoint.requestHash !== job.requestHash || job.checkpoint.contextHash !== contextHash)) invalid();
  }
  const invocations = ids(snapshot.invocations, value => value.invocation.invocationId);
  for (const row of invocations.values()) {
    if (!exact(row, ["invocation", "invocationKey", "externalBinding", "accountIds", "spent", "held", "capability", "leaseUntil", "completionHash"])
      || !uniqueStrings(row.accountIds) || row.accountIds.some(id => !accounts.has(id)) || !text(row.capability)) invalid();
    const call = row.invocation;
    if (!exactOptional(call, ["invocationId", "jobId", "stage", "attemptId", "purpose", "status", "requestHash", "providerRequest",
      "modelRef", "eligible", "reservation", "startedAt", "completedAt"], ["response", "usage"])
      || !["reserved", "started", "completed", "unknown", "notSent", "failed"].includes(String(call.status))
      || typeof call.eligible !== "boolean" || !hash(call.requestHash) || !isRecord(call.providerRequest)) invalid();
    if (call.jobId !== null) {
      const job = jobs.get(call.jobId);
      if (job === undefined || row.externalBinding !== null || !["draft", "review", "revision", "revisionReview"].includes(String(call.stage))
        || !same(call.modelRef, job.input.modelRef)) invalid();
    } else {
      const bound = row.externalBinding;
      if (bound === null || !exact(bound, ["source", "roomAccountId", "invocationKey", "purpose", "modelRef", "providerRequest", "reservation"])
        || !source(bound.source) || !sourceMatchesRoom(bound.source, archive)
        || !same(accounts.get(bound.source.budgetAccountId)?.binding.source, bound.source)
        || call.purpose !== bound.purpose || !same(call.providerRequest, bound.providerRequest)
        || !same(call.modelRef, bound.modelRef) || await archiveSha256(bound) !== call.requestHash) invalid();
    }
  }
  const bindings = ids(snapshot.admissionBindings, value => value.preparedActionId);
  for (const binding of bindings.values()) {
    if (!exact(binding, ["jobId", "preparationHash", "materialScopeHash", "preparedActionId", "contextHash", "selectedMaterialRefs", "readSet", "rulesInputHash", "bindingHash"])
      || !uniqueStrings(binding.selectedMaterialRefs) || !Array.isArray(binding.readSet) || !hash(binding.rulesInputHash)) invalid();
    const { bindingHash, ...body } = binding;
    const job = jobs.get(binding.jobId), draft = job?.checkpoint?.revisedDraft ?? job?.checkpoint?.draft;
    if (job === undefined || draft === undefined || !passed(job.checkpoint)) invalid("STORY_ARCHIVE_MATERIALS_MISSING");
    if (await archiveSha256(body) !== bindingHash || await archiveSha256(draft) !== binding.preparationHash
      || binding.contextHash !== job.input.context.contextHash
      || await archiveSha256(binding.selectedMaterialRefs) !== binding.materialScopeHash) invalid();
    const refs = candidateRefs(draft);
    if (binding.selectedMaterialRefs.some(ref => !refs.has(ref))
      || job.input.context.readSet.some(required => !binding.readSet.some(read => same(read, required)))) invalid();
  }
  const manifest = ids(snapshot.materialManifest, value => value.preparationHash);
  const admissions = ids(snapshot.admissions, value => value.preparedActionId);
  for (const entry of manifest.values()) {
    if (!exact(entry, ["preparationHash", "jobId"]) || !hash(entry.preparationHash) || !jobs.has(entry.jobId)
      || !snapshot.admissions.some(receipt => receipt.jobId === entry.jobId && receipt.preparationHash === entry.preparationHash)) {
      invalid("STORY_ARCHIVE_MATERIALS_MISSING");
    }
  }
  for (const admission of admissions.values()) {
    if (!exact(admission, ["jobId", "preparationHash", "materialScopeHash", "preparedActionId", "receiptId", "bindingHash", "recordedAtEventSeq", "facts"])
      || !text(admission.receiptId) || !sequence(admission.recordedAtEventSeq) || !Array.isArray(admission.facts)) invalid();
    const bound = bindings.get(admission.preparedActionId);
    if (bound === undefined || manifest.get(admission.preparationHash)?.jobId !== admission.jobId) invalid("STORY_ARCHIVE_MATERIALS_MISSING");
    if (bound.bindingHash !== admission.bindingHash || bound.jobId !== admission.jobId
      || bound.preparationHash !== admission.preparationHash || bound.materialScopeHash !== admission.materialScopeHash) invalid();
  }
  return { accounts, jobs, invocations, bindings, admissions, manifest };
}

function checkHosts(envelope: StoryRoomArchive, checked: Awaited<ReturnType<typeof checkSnapshot>>, ports: StoryArchivePorts) {
  const hosts = ids(envelope.hostBindings, value => value.bindingId);
  const owners = new Map<string, StoryArchiveHostBinding>();
  for (const host of hosts.values()) {
    if (!exact(host, ["bindingId", "kind", "source", "jobIds", "invocationIds", "payload", "payloadHash"])
      || !["preparedAction", "npcDecision", "viewerNarration"].includes(host.kind)
      || !source(host.source) || !sourceMatchesRoom(host.source, envelope.archive)
      || !uniqueStrings(host.jobIds) || !uniqueStrings(host.invocationIds) || !isRecord(host.payload) || !hash(host.payloadHash)
      || !same(checked.accounts.get(host.source.budgetAccountId)?.binding.source, host.source)
      || host.jobIds.some(id => !checked.jobs.has(id))
      || ports.validateHostBinding(structuredClone(host), {
        archive: structuredClone(envelope.archive), storySnapshot: structuredClone(envelope.storySnapshot),
      }) !== true) invalid("STORY_ARCHIVE_HOST_BINDING_INVALID");
    for (const id of host.invocationIds) {
      const row = checked.invocations.get(id);
      if (row === undefined || owners.has(id)) invalid("STORY_ARCHIVE_HOST_BINDING_INVALID");
      const bound = row.invocation.jobId === null ? row.externalBinding!.source
        : checked.jobs.get(row.invocation.jobId)!.input.request.source;
      if (!same(bound, host.source)) invalid("STORY_ARCHIVE_HOST_BINDING_INVALID");
      owners.set(id, host);
    }
  }
  if (owners.size !== checked.invocations.size) invalid("STORY_ARCHIVE_HOST_BINDING_INVALID");
  for (const job of checked.jobs.values()) if (![...hosts.values()].some(host =>
    host.jobIds.includes(job.input.request.jobId) && same(host.source, job.input.request.source))) invalid("STORY_ARCHIVE_HOST_BINDING_INVALID");
  for (const binding of checked.bindings.values()) {
    const host = hosts.get(binding.preparedActionId);
    if (host === undefined || !host.jobIds.includes(binding.jobId) || host.kind === "viewerNarration"
      || host.source.branchId !== checked.jobs.get(binding.jobId)!.input.request.source.branchId) invalid("STORY_ARCHIVE_HOST_BINDING_INVALID");
  }
  return { hosts, owners };
}

function factIdentity(value: StoryAdmittedFactBinding): unknown {
  return { candidateRef: value.candidateRef, factRef: value.factRef, recordedByEventId: value.recordedByEventId,
    definitionRefs: [...value.definitionRefs].sort() };
}
function checkKnowledgeSource(preparation: StoryPreparation, mappings: readonly StoryAdmittedFactBinding[],
  fact: StoryAdmittedFactBinding, candidateRef: string, record: AuthoritativeWorldState["knowledge"][string][string]): boolean {
  const candidate = preparation.facts.find(value => value.ref === fact.candidateRef)!
    .knowledge.find(value => value.ref === candidateRef)!;
  const targets = [...mappings.filter(value => value.candidateRef === candidate.sourceRef).map(value => value.factRef),
    ...mappings.flatMap(value => value.knowledge).filter(value => value.candidateRef === candidate.sourceRef).map(value => value.knowledgeRef)];
  if (targets.length > 1) return false;
  const sourceRef = targets[0] ?? candidate.sourceRef;
  return record.provenanceChain.includes(sourceRef) || record.knowledgeRef === sourceRef || record.sourceCharacterId === sourceRef
    || record.sourceCharacterId === null && record.characterId === sourceRef;
}

async function checkAdmissions(envelope: StoryRoomArchive, checked: Awaited<ReturnType<typeof checkSnapshot>>, ports: StoryArchivePorts): Promise<StoryHistoryMaterialSnapshot> {
  const archive = envelope.archive, byEvent = new Map(archive.events.map(event => [event.eventId, event]));
  const receiptRefs = ids(archive.receiptRefs, value => value.receiptId);
  const material = new Map<string, StoryHistoryMaterialSnapshot["preparations"][number]>();
  const prefixes = new Map<string, AuthoritativeWorldState>();
  const recordedFacts = new Map<string, StoryAdmittedFactBinding>(), recordedKnowledge = new Map<string, unknown>();
  const receipts = [...checked.admissions.values()].sort((a, b) => BigInt(a.recordedAtEventSeq) < BigInt(b.recordedAtEventSeq)
    ? -1 : BigInt(a.recordedAtEventSeq) > BigInt(b.recordedAtEventSeq) ? 1 : a.preparedActionId.localeCompare(b.preparedActionId));
  for (const admission of receipts) {
    if (BigInt(admission.recordedAtEventSeq) > BigInt(archive.head.eventSeq)) invalid();
    const job = checked.jobs.get(admission.jobId)!, binding = checked.bindings.get(admission.preparedActionId)!;
    const preparation = (job.checkpoint!.revisedDraft ?? job.checkpoint!.draft)!;
    const part = { preparation, preparationHash: admission.preparationHash, recordedAtEventSeq: admission.recordedAtEventSeq, facts: admission.facts };
    if (!await validPreparation(part, archive.head.eventSeq)) invalid("STORY_ARCHIVE_MATERIALS_MISSING");
    let state = prefixes.get(admission.recordedAtEventSeq);
    if (state === undefined) {
      const replayed = ports.replay(archive.signedGenesis, archive.events.filter(event => BigInt(event.eventSeq) <= BigInt(admission.recordedAtEventSeq)));
      if (replayed.kind !== "replayed" || replayed.head.eventSeq !== admission.recordedAtEventSeq) invalid("STORY_ARCHIVE_WORLD_INVALID");
      state = replayed.state as AuthoritativeWorldState; prefixes.set(admission.recordedAtEventSeq, state);
    }
    const actual = Object.values(state.receipts).find(receipt => receipt.receiptId === admission.receiptId);
    const reference = receiptRefs.get(admission.receiptId);
    if (actual === undefined || reference === undefined || !["committed", "concluded"].includes(actual.status)
      || actual.eventRange.toEventSeq !== admission.recordedAtEventSeq || reference.rootActionId !== actual.rootActionId
      || reference.activeBranchId !== actual.branchId || reference.eventRange === null
      || reference.eventRange.first !== actual.eventRange.fromEventSeq || reference.eventRange.last !== actual.eventRange.toEventSeq) invalid();
    const inReceipt = (event: EventEnvelope | undefined) => event !== undefined && event.rootActionId === actual.rootActionId
      && event.branchId === actual.branchId && BigInt(event.eventSeq) >= BigInt(actual.eventRange.fromEventSeq)
      && BigInt(event.eventSeq) <= BigInt(actual.eventRange.toEventSeq);
    const selected = new Set(binding.selectedMaterialRefs), admitted = new Set<string>();
    for (const mapping of admission.facts) {
      const candidate = preparation.facts.find(fact => fact.ref === mapping.candidateRef)!;
      const event = byEvent.get(mapping.recordedByEventId), fact = state.canonicalFacts[mapping.factRef];
      const payload: unknown = event?.payload;
      const candidateKey = `${admission.preparationHash}\u0000${mapping.candidateRef}`;
      const previous = recordedFacts.get(candidateKey);
      if (!selected.has(mapping.candidateRef) || admitted.has(mapping.candidateRef)
        || event?.eventType !== "CanonicalFactDeclared" || !isRecord(payload) || !isRecord(payload.fact) || payload.fact.id !== mapping.factRef
        || fact === undefined || fact.validFromEventSeq !== event.eventSeq || fact.branchId !== event.branchId
        || (!inReceipt(event) && (previous === undefined || !same(factIdentity(previous), factIdentity(mapping))))
        || previous !== undefined && !same(factIdentity(previous), factIdentity(mapping))
        || mapping.definitionRefs.some(ref => state!.campaignRuntime.definitions[ref] === undefined)) invalid();
      if (isRecord(fact.value) && typeof fact.value.definitionRef === "string"
        && !mapping.definitionRefs.includes(fact.value.definitionRef)) invalid("STORY_ARCHIVE_MATERIALS_MISSING");
      admitted.add(mapping.candidateRef); recordedFacts.set(candidateKey, mapping);
      for (const knowledge of mapping.knowledge) {
        const item = candidate.knowledge.find(value => value.ref === knowledge.candidateRef);
        const event = byEvent.get(knowledge.recordedByEventId), record = state.knowledge[knowledge.holderRef]?.[knowledge.knowledgeRef];
        const key = `${admission.preparationHash}\u0000${knowledge.candidateRef}`, previous = recordedKnowledge.get(key);
        if (item === undefined || !selected.has(knowledge.candidateRef) || admitted.has(knowledge.candidateRef)
          || record === undefined || event === undefined || record.acquiredByEventId !== event.eventId
          || item.holderRef !== knowledge.holderRef || item.factRef !== candidate.ref || record.characterId !== knowledge.holderRef
          || record.knowledgeRef !== knowledge.knowledgeRef || !record.provenanceChain.includes(mapping.factRef)
          || record.objectKind !== ({ truth: "canonicalFact", sensoryEvidence: "sensoryEvidence", sourceClaim: "sourceClaim", inference: "characterInference" } as const)[item.layer]
          || !checkKnowledgeSource(preparation, admission.facts, mapping, knowledge.candidateRef, record)
          || (!inReceipt(event) && (previous === undefined || !same(previous, knowledge)))
          || previous !== undefined && !same(previous, knowledge)) invalid();
        admitted.add(knowledge.candidateRef); recordedKnowledge.set(key, knowledge);
      }
    }
    for (const fact of preparation.facts) {
      if (selected.has(fact.ref) !== admitted.has(fact.ref)) invalid();
      for (const knowledge of fact.knowledge) if (selected.has(knowledge.ref) !== admitted.has(knowledge.ref)) invalid();
    }
    const prior = material.get(admission.preparationHash), merged = new Map((prior?.facts ?? []).map(fact => [fact.candidateRef, fact]));
    for (const fact of admission.facts) {
      const existing = merged.get(fact.candidateRef), knowledge = new Map((existing?.knowledge ?? []).map(value => [value.candidateRef, value]));
      for (const item of fact.knowledge) knowledge.set(item.candidateRef, item);
      merged.set(fact.candidateRef, { ...fact, knowledge: [...knowledge.values()].sort((a, b) => a.candidateRef.localeCompare(b.candidateRef)) });
    }
    material.set(admission.preparationHash, { ...part, recordedAtEventSeq: prior?.recordedAtEventSeq ?? part.recordedAtEventSeq,
      facts: [...merged.values()].sort((a, b) => a.candidateRef.localeCompare(b.candidateRef)) });
  }
  if (material.size !== checked.manifest.size) invalid("STORY_ARCHIVE_MATERIALS_MISSING");
  return { preparations: [...material.values()].sort((a, b) => a.preparationHash.localeCompare(b.preparationHash)),
    requiredPreparationHashes: [...checked.manifest.keys()].sort() as StoryHash[] };
}

/** Pure preparation only. This never restores a Store, grants a send permit,
 * creates a new branch, or produces a Viewer projection. The host must store
 * the returned quarantine atomically with a same-room restore before exposing
 * it, and must use StoryCreationStore.restoreArchiveSnapshot for the final
 * SQLite ledger/budget invariant checks. Historical new rooms receive only
 * validated historyMaterials through
 * the separate Story History/Rules branch initializer, never this envelope. */
export async function validateStoryArchive(value: unknown, ports: StoryArchivePorts): Promise<StoryArchiveValidationResult> {
  try {
    if (!exact(value, ["format", "audience", "source", "generation", "archive", "storySnapshot", "hostBindings", "contentHash"])
      || value.format !== "zhuwei.story-room-archive/v1" || value.audience !== "trustedSystemOnly"
      || !sequence(value.generation) || !hash(value.contentHash) || !Array.isArray(value.hostBindings)
      || typeof ports.replay !== "function" || typeof ports.validateHostBinding !== "function") invalid("STORY_ARCHIVE_INVALID");
    const envelope = structuredClone(value) as StoryRoomArchive, { contentHash, ...body } = envelope;
    if (await archiveSha256(body) !== contentHash) invalid("STORY_ARCHIVE_INVALID");
    const world = await validateAuthoritativeArchive(envelope.archive, ports.replay);
    if (!world.ok) invalid("STORY_ARCHIVE_WORLD_INVALID");
    if (!same(envelope.source, { roomId: envelope.archive.roomId, runtimeEpochId: envelope.archive.signedGenesis.runtimeEpochId,
      archiveHash: envelope.archive.archiveHash, head: envelope.archive.head })) invalid();
    const checked = await checkSnapshot(envelope.storySnapshot, envelope.archive);
    for (const host of envelope.hostBindings) if (await archiveSha256(host.payload) !== host.payloadHash) invalid("STORY_ARCHIVE_HOST_BINDING_INVALID");
    const { hosts } = checkHosts(envelope, checked, ports);
    const historyMaterials = await checkAdmissions(envelope, checked, ports);
    const invocationIds = [...checked.invocations.values()].filter(row => ["reserved", "started", "unknown", "notSent"].includes(row.invocation.status))
      .map(row => row.invocation.invocationId).sort();
    const sourceBudgetAccountIds = [...new Set([...hosts.values()].map(host => host.source.budgetAccountId))].sort();
    return { kind: "validated", envelope, historyMaterials,
      quarantine: { enforcement: "hostRequiredBeforeRestoreExposure", invocationIds, sourceBudgetAccountIds } };
  } catch (error) {
    return { kind: "rejected", code: error instanceof ArchiveInputError ? error.code : "STORY_ARCHIVE_INVALID" };
  }
}

export async function buildStoryArchive(input: Readonly<{
  archive: AuthoritativeRoomArchive;
  storySnapshot: StoryStoreArchiveSnapshot;
  hostBindings: readonly StoryArchiveHostBinding[];
  generation: string;
}>, ports: StoryArchivePorts): Promise<StoryArchiveBuildResult> {
  try {
    const frozen = structuredClone(input);
    const body = { format: "zhuwei.story-room-archive/v1" as const, audience: "trustedSystemOnly" as const,
      source: { roomId: frozen.archive.roomId, runtimeEpochId: frozen.archive.signedGenesis.runtimeEpochId,
        archiveHash: frozen.archive.archiveHash, head: frozen.archive.head }, ...frozen };
    const checked = await validateStoryArchive({ ...body, contentHash: await archiveSha256(body) }, ports);
    return checked.kind === "rejected" ? checked : { ...checked, kind: "prepared" };
  } catch { return { kind: "rejected", code: "STORY_ARCHIVE_INVALID" }; }
}
