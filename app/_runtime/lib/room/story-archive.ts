import { isKpModelId, type KpModelId } from "../kp/models";
import { archiveSha256, canonicalJson, checkAuthoritativeArchive, type AuthoritativeRoomArchive } from "./archive";
import type {
  StoryAdmittedDefinitionBinding, StoryAdmittedFactBinding, StoryHistoryMaterialSnapshot,
  StoryStoreArchiveSnapshot,
} from "./story-creation-invocation";
import type { StoryHash, StoryPreparation, StoryRecord, StoryRequest } from "./story-creation/contracts";
import { exact, hash, isRecord, sequence, text, uniqueStrings, validPreparation } from "./story-history/validation";
import { validStoryMaterialBindings } from "./story-admission";
import type { StoryAdmissionOwner, StoryLibraryEntry } from "./story-library-contracts";
import { storyHostingArtifact, storyLibraryEntry, storyLibraryOwner, validStoryAdmissionOwner, validateStoryLibraryEntry,
  validateStoryLibraryGenesis } from "./story-library";
import { validateStoredReview } from "./story-creation/prompt";
import { storyReviewPassed } from "./story-creation/review";
import { validateStoryInspectionFailure } from "./story-creation";
import { canonicalHash } from "../kp/vnext/canonical-json";

/** The host supplies its versioned prepared-action/NPC/narration DTO. No SQL
 * or arbitrary Rules input is admitted by this envelope. Physical send
 * state/capability remains solely in StoryStore; invocationIds are references
 * to that ledger. */
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
  kpModelId?: KpModelId;
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
export type StoryArchiveFailureCode = "STORY_ARCHIVE_INVALID" | "STORY_ARCHIVE_WORLD_INVALID"
  | "STORY_ARCHIVE_BINDING_INVALID" | "STORY_ARCHIVE_MATERIALS_MISSING" | "STORY_ARCHIVE_HOST_BINDING_INVALID";
export type StoryArchiveRejection = Readonly<{ kind: "rejected"; code: StoryArchiveFailureCode }>;
type CheckedStoryArchive = Readonly<{
  envelope: StoryRoomArchive;
  historyMaterials: StoryHistoryMaterialSnapshot;
  quarantine: StoryArchiveDispatchQuarantine;
}>;
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
  if (checkpoint?.status !== "ready" || !review) return false;
  try { validateStoredReview(review); return storyReviewPassed(review); } catch { return false; }
}

async function checkSnapshot(snapshot: StoryStoreArchiveSnapshot, archive: AuthoritativeRoomArchive) {
  if (!exact(snapshot, ["format", "source", "accounts", "jobs", "invocations", "admissionBindings", "admissions", "materialManifest", "hostingArtifacts", "snapshotHash"])
    || snapshot.format !== "zhuwei.story-store-archive/v1"
    || !same(snapshot.source, { roomId: archive.roomId, runtimeEpochId: archive.signedGenesis.runtimeEpochId })
    || ![snapshot.accounts, snapshot.jobs, snapshot.invocations, snapshot.admissionBindings,
      snapshot.admissions, snapshot.materialManifest, snapshot.hostingArtifacts].every(Array.isArray)) invalid();
  if (!hash(snapshot.snapshotHash)) invalid();
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
    const { contextHash } = job.input.context;
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
        || !same(call.modelRef, bound.modelRef)) invalid();
    }
  }
  for (const job of jobs.values()) {
    if (job.checkpoint === null || !Object.hasOwn(job.checkpoint, "inspectionFailure")) continue;
    try { validateStoryInspectionFailure(job.checkpoint, { request: job.input.request, context: job.input.context,
      invocations: snapshot.invocations.map(row => row.invocation), hash: value => canonicalHash(value) as StoryHash }); }
    catch { invalid(); }
  }
  const artifacts = ids(snapshot.hostingArtifacts, value => value.libraryRef);
  for (const entry of artifacts.values()) {
    try {
      validateStoryLibraryEntry(entry);
      if (entry.room.roomId !== archive.roomId || entry.room.runtimeEpochId !== archive.signedGenesis.runtimeEpochId) invalid();
      if (entry.origin.kind === "historicalSeed") validateStoryLibraryGenesis(entry, archive.signedGenesis);
      else {
        const job = jobs.get(entry.origin.jobId);
        if (!job || !same(storyHostingArtifact({ ...job.input, checkpoint: job.checkpoint }), entry.artifact)) invalid();
      }
    } catch { invalid("STORY_ARCHIVE_MATERIALS_MISSING"); }
  }
  const sourceEntry = (owner: StoryAdmissionOwner, jobId: string, preparationHash: StoryHash): StoryLibraryEntry => {
    if (!validStoryAdmissionOwner(owner)) return invalid();
    let entry: StoryLibraryEntry | undefined;
    if (owner.kind === "creationJob") {
      const job = jobs.get(owner.jobId);
      if (!job || jobId !== owner.jobId || !passed(job.checkpoint)) return invalid("STORY_ARCHIVE_MATERIALS_MISSING");
      const { source } = job.input.request;
      entry = storyLibraryEntry({ roomId: source.roomId, runtimeEpochId: source.runtimeEpochId, branchId: source.branchId },
        storyHostingArtifact({ ...job.input, checkpoint: job.checkpoint }), { kind: "creationJob", jobId });
    } else entry = artifacts.get(owner.libraryRef);
    if (!entry || entry.artifact.preparationHash !== preparationHash || entry.artifact.preparation.jobId !== jobId
      || !same(storyLibraryOwner(entry), owner)) return invalid("STORY_ARCHIVE_MATERIALS_MISSING");
    return entry;
  };
  const bindings = ids(snapshot.admissionBindings, value => value.preparedActionId);
  for (const binding of bindings.values()) {
    if (!exact(binding, ["owner", "jobId", "preparationHash", "materialScopeHash", "preparedActionId", "contextHash", "validation", "priorMappings",
      "selectedMaterialRefs", "readSet", "rulesInputHash", "bindingHash"])
      || !uniqueStrings(binding.selectedMaterialRefs) || !Array.isArray(binding.readSet) || !hash(binding.rulesInputHash)
      || !exact(binding.validation, ["request", "context"]) || !isRecord(binding.validation.context)
      || !exact(binding.priorMappings, ["definitions", "facts"])) invalid();
    const entry = sourceEntry(binding.owner, binding.jobId, binding.preparationHash);
    const draft = entry.artifact.preparation;
    if (binding.contextHash !== binding.validation.context.contextHash
      || !source(binding.validation.request.source) || !sourceMatchesRoom(binding.validation.request.source, archive)
      || binding.validation.request.source.branchId !== entry.room.branchId
      || !validStoryMaterialBindings(draft, binding.priorMappings.definitions, binding.priorMappings.facts)) invalid();
    const refs = candidateRefs(draft);
    if (binding.selectedMaterialRefs.some(ref => !refs.has(ref))
      || binding.validation.context.readSet.some(required => !binding.readSet.some(read => same(read, required)))) invalid();
  }
  const manifest = ids(snapshot.materialManifest, value => value.preparationHash);
  const admissions = ids(snapshot.admissions, value => value.preparedActionId);
  for (const entry of manifest.values()) {
    if (!exact(entry, ["preparationHash", "jobId", "owner"]) || !hash(entry.preparationHash)
      || !snapshot.admissions.some(receipt => receipt.jobId === entry.jobId && receipt.preparationHash === entry.preparationHash
        && same(receipt.owner, entry.owner))) invalid("STORY_ARCHIVE_MATERIALS_MISSING");
    sourceEntry(entry.owner, entry.jobId, entry.preparationHash);
  }
  for (const admission of admissions.values()) {
    if (!exact(admission, ["owner", "jobId", "preparationHash", "materialScopeHash", "preparedActionId", "receiptId", "bindingHash", "recordedAtEventSeq", "definitions", "facts"])
      || !text(admission.receiptId) || !sequence(admission.recordedAtEventSeq)
      || !Array.isArray(admission.definitions) || !Array.isArray(admission.facts)) invalid();
    const bound = bindings.get(admission.preparedActionId), declared = manifest.get(admission.preparationHash);
    if (bound === undefined || declared?.jobId !== admission.jobId || !same(declared.owner, admission.owner)) invalid("STORY_ARCHIVE_MATERIALS_MISSING");
    if (bound.bindingHash !== admission.bindingHash || bound.jobId !== admission.jobId || !same(bound.owner, admission.owner)
      || bound.preparationHash !== admission.preparationHash || bound.materialScopeHash !== admission.materialScopeHash) invalid();
  }
  return { accounts, jobs, invocations, bindings, admissions, manifest, artifacts, sourceEntry };
}

function checkHosts(envelope: StoryRoomArchive, checked: Awaited<ReturnType<typeof checkSnapshot>>) {
  const hosts = ids(envelope.hostBindings, value => value.bindingId);
  const owners = new Map<string, StoryArchiveHostBinding>();
  for (const host of hosts.values()) {
    if (!exact(host, ["bindingId", "kind", "source", "jobIds", "invocationIds", "payload", "payloadHash"])
      || !["preparedAction", "npcDecision", "viewerNarration"].includes(host.kind)
      || !source(host.source) || !sourceMatchesRoom(host.source, envelope.archive)
      || !uniqueStrings(host.jobIds) || !uniqueStrings(host.invocationIds) || !isRecord(host.payload) || !hash(host.payloadHash)
      || !same(checked.accounts.get(host.source.budgetAccountId)?.binding.source, host.source)
      || host.jobIds.some(id => !checked.jobs.has(id))) invalid("STORY_ARCHIVE_HOST_BINDING_INVALID");
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
    if (host === undefined || host.kind === "viewerNarration"
      || !same(host.source, binding.validation.request.source)) invalid("STORY_ARCHIVE_HOST_BINDING_INVALID");
  }
  return { hosts, owners };
}

/** Collects the admitted story materials as recorded. Each admission is not
 * re-derived by replaying the world to its receipt (SPEC 0011 §6, ADR 0054). */
async function checkAdmissions(envelope: StoryRoomArchive, checked: Awaited<ReturnType<typeof checkSnapshot>>): Promise<StoryHistoryMaterialSnapshot> {
  const archive = envelope.archive;
  const material = new Map<string, StoryHistoryMaterialSnapshot["preparations"][number]>();
  for (const entry of checked.artifacts.values()) if (entry.origin.kind === "historicalSeed") {
    if (material.has(entry.artifact.preparationHash)) invalid();
    material.set(entry.artifact.preparationHash, { preparation: entry.artifact.preparation,
      preparationHash: entry.artifact.preparationHash, recordedAtEventSeq: "0", ...entry.origin.baseline });
  }
  const receipts = [...checked.admissions.values()].sort((a, b) => BigInt(a.recordedAtEventSeq) < BigInt(b.recordedAtEventSeq)
    ? -1 : BigInt(a.recordedAtEventSeq) > BigInt(b.recordedAtEventSeq) ? 1 : a.preparedActionId.localeCompare(b.preparedActionId));
  for (const admission of receipts) {
    if (BigInt(admission.recordedAtEventSeq) > BigInt(archive.head.eventSeq)) invalid();
    const entry = checked.sourceEntry(admission.owner, admission.jobId, admission.preparationHash);
    const binding = checked.bindings.get(admission.preparedActionId)!;
    const preparation = entry.artifact.preparation;
    const previous = material.get(admission.preparationHash);
    if (!same(binding.priorMappings, { definitions: previous?.definitions ?? [], facts: previous?.facts ?? [] })) invalid();
    const part = { preparation, preparationHash: admission.preparationHash, recordedAtEventSeq: admission.recordedAtEventSeq,
      definitions: admission.definitions, facts: admission.facts };
    if (!await validPreparation(part, archive.head.eventSeq)) invalid("STORY_ARCHIVE_MATERIALS_MISSING");
    const prior = material.get(admission.preparationHash);
    const definitions = new Map<string, StoryAdmittedDefinitionBinding>((prior?.definitions ?? []).map(value => [value.candidateRef, value]));
    const facts = new Map<string, StoryAdmittedFactBinding>((prior?.facts ?? []).map(value => [value.candidateRef, value]));
    for (const definition of admission.definitions) {
      const previous = definitions.get(definition.candidateRef);
      if (previous && !same(previous, definition)) invalid();
      definitions.set(definition.candidateRef, definition);
    }
    for (const fact of admission.facts) {
      const previous = facts.get(fact.candidateRef);
      if (previous && !same(previous, fact)) invalid();
      facts.set(fact.candidateRef, fact);
    }
    material.set(admission.preparationHash, { ...part, recordedAtEventSeq: prior?.recordedAtEventSeq ?? part.recordedAtEventSeq,
      definitions: [...definitions.values()].sort((a, b) => a.candidateRef.localeCompare(b.candidateRef)),
      facts: [...facts.values()].sort((a, b) => a.candidateRef.localeCompare(b.candidateRef)) });
  }
  if ([...checked.manifest.keys()].some(ref => !material.has(ref))) invalid("STORY_ARCHIVE_MATERIALS_MISSING");
  return { preparations: [...material.values()].sort((a, b) => a.preparationHash.localeCompare(b.preparationHash)),
    requiredPreparationHashes: [...material.keys()].sort() as StoryHash[] };
}

/** Pure preparation only. This never restores a Store, grants a send permit,
 * creates a new branch, or produces a Viewer projection. The host must store
 * the returned quarantine atomically with a same-room restore before exposing
 * it, and must use StoryCreationStore.restoreArchiveSnapshot for the final
 * SQLite ledger/budget invariant checks. Historical new rooms receive only
 * validated historyMaterials through
 * the separate Story History/Rules branch initializer, never this envelope. */
export async function validateStoryArchive(value: unknown): Promise<StoryArchiveValidationResult> {
  try {
    if (!exactOptional(value, ["format", "audience", "source", "generation", "archive", "storySnapshot", "hostBindings", "contentHash"], ["kpModelId"])
      || (value.kpModelId !== undefined && !isKpModelId(value.kpModelId))
      || value.format !== "zhuwei.story-room-archive/v1" || value.audience !== "trustedSystemOnly"
      || !sequence(value.generation) || !hash(value.contentHash) || !Array.isArray(value.hostBindings)) invalid("STORY_ARCHIVE_INVALID");
    // The content hash names this generation in D1; it is not recomputed (ADR 0056).
    const envelope = structuredClone(value) as StoryRoomArchive;
    const world = await checkAuthoritativeArchive(envelope.archive);
    if (!world.ok) invalid("STORY_ARCHIVE_WORLD_INVALID");
    if (!same(envelope.source, { roomId: envelope.archive.roomId, runtimeEpochId: envelope.archive.signedGenesis.runtimeEpochId,
      archiveHash: envelope.archive.archiveHash, head: envelope.archive.head })) invalid();
    const checked = await checkSnapshot(envelope.storySnapshot, envelope.archive);
    if (envelope.kpModelId !== undefined && envelope.storySnapshot.invocations.some(row => row.invocation.providerRequest.model !== envelope.kpModelId)) invalid();
    const { hosts } = checkHosts(envelope, checked);
    const historyMaterials = await checkAdmissions(envelope, checked);
    const invocationIds = [...checked.invocations.values()].filter(row => ["reserved", "started", "unknown", "notSent"].includes(row.invocation.status))
      .map(row => row.invocation.invocationId).sort();
    const sourceBudgetAccountIds = [...new Set([...hosts.values()].map(host => host.source.budgetAccountId))].sort();
    return { kind: "validated", envelope, historyMaterials,
      quarantine: { enforcement: "hostRequiredBeforeRestoreExposure", invocationIds, sourceBudgetAccountIds } };
  } catch (error) {
    return { kind: "rejected", code: error instanceof ArchiveInputError ? error.code : "STORY_ARCHIVE_INVALID" };
  }
}

/** Assembles the envelope from what the Room holds. It is not validated on
 * the way out (ADR 0054). */
export async function buildStoryArchive(input: Readonly<{
  kpModelId?: KpModelId;
  archive: AuthoritativeRoomArchive;
  storySnapshot: StoryStoreArchiveSnapshot;
  hostBindings: readonly StoryArchiveHostBinding[];
  generation: string;
}>): Promise<StoryRoomArchive> {
  const frozen = structuredClone(input);
  const body = { format: "zhuwei.story-room-archive/v1" as const, audience: "trustedSystemOnly" as const,
    source: { roomId: frozen.archive.roomId, runtimeEpochId: frozen.archive.signedGenesis.runtimeEpochId,
      archiveHash: frozen.archive.archiveHash, head: frozen.archive.head }, ...frozen };
  return { ...body, contentHash: await archiveSha256(body) };
}
