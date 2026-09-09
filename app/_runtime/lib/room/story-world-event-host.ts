import { canonicalHash, deepFreeze, isPlainRecord } from "../kp/vnext/canonical-json";
import type { AuthoritativeModuleProfile } from "../module/authoritative";
import type { AuthoritativeWorldState, RuntimeProfileManifest } from "../rules";
import type { VersionedRulesRuntime } from "../rules/v2-runtime";
import type { AuthoritativeRoomArchive } from "./archive";
import type { AuthorityDueWorkRow } from "./authority-store";
import type { StoryArchiveHostBinding } from "./story-archive";
import type { StoryAdmissionReceipt, StoryExternalInvocationBinding, StoryJobSnapshot, StoryStoreArchiveSnapshot } from "./story-creation-invocation";
import type { StoryCheckpoint, StoryContext, StoryHash, StoryJson, StoryRecord, StoryRequest } from "./story-creation/contracts";
import type { StoryLibraryCatalog, StoryLibraryEntry, StoryLibraryOffer } from "./story-library-contracts";
import { buildStoryLibraryCatalogForScope } from "./story-library";
import { createStoryRequest, roomStoryCapabilityDescriptions } from "./story-action-request";
import { buildRoomWorldStoryContext } from "./story-context";
import { roomStoryBudget } from "./story-runtime-policy";
import { storyReviewAllowsRevision } from "./story-creation/review";
import { verifyWorldStoryTrigger, worldStoryRequestInput, worldStorySelectionInvocationBinding,
  parseWorldStorySelection, WORLD_STORY_SELECTION_BINDING_HASH,
  type RoomWorldStoryCommit, type RoomWorldStoryDueOrigin, type RoomWorldStoryTrigger, type RoomWorldStorySelection } from "./story-world-event";
import type { DueActivityDescriptor } from "../rules/v2/model";

const hash = (value: unknown): StoryHash => canonicalHash(value) as StoryHash;
const same = (left: unknown, right: unknown): boolean => hash(left) === hash(right);
const fail = (): never => { throw new TypeError("STORY_ARCHIVE_HOST_BINDING_INVALID"); };
const check: (condition: unknown) => asserts condition = condition => { if (!condition) fail(); };
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const seq = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
const unique = (refs: readonly string[]): boolean => refs.every(text) && new Set(refs).size === refs.length;
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => isPlainRecord(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export type WorldStoryLibraryRead = Readonly<{
  entries: readonly StoryLibraryEntry[];
  jobs: readonly Pick<StoryJobSnapshot, "request" | "context" | "checkpoint">[];
  admissions: readonly StoryAdmissionReceipt[];
}>;
export type WorldStoryLibraryWitness = Readonly<{
  catalog: StoryLibraryCatalog;
  /** Original request/context are immutable in the actual Story journal. */
  jobs: readonly Readonly<{ jobId: string; checkpoint: StoryCheckpoint | null }>[];
  entries: readonly Readonly<{ libraryRef: StoryHash; entryHash: StoryHash }>[];
  admissionHashes: readonly StoryHash[];
}>;
export type StoryFrozenWorldContext = Readonly<{
  format: "zhuwei.room-world-story-host-context/v1";
  preparedActionId: string;
  baseEventSeq: string;
  rulesInput: StoryJson;
  dueOrigin: RoomWorldStoryDueOrigin | null;
  trigger: RoomWorldStoryTrigger;
  moduleProfile: AuthoritativeModuleProfile;
  library: WorldStoryLibraryWitness;
  maxContextUnits: number;
  contextHash: StoryHash;
}>;
export type WorldStoryHostStage = Readonly<{
  ordinal: number; contextHash: string; bindingHash: string; requestHash: string;
  repairTicket: StoryRecord | null; invocationId: string;
}>;
export type WorldStoryHostSourceRow = Omit<AuthorityDueWorkRow, "descriptor_json"> & { descriptor: DueActivityDescriptor };
export type WorldStoryHostPayload = Readonly<{
  format: "zhuwei.story-world-event-host/v1";
  preparedActionId: string;
  sourceChain: readonly WorldStoryHostSourceRow[];
  stages: readonly WorldStoryHostStage[];
  world: StoryFrozenWorldContext;
}>;
export type WorldStoryHostArchiveContext = Readonly<{
  archive: AuthoritativeRoomArchive;
  storySnapshot: StoryStoreArchiveSnapshot;
}>;
export const worldStoryPreparedActionId = (trigger: RoomWorldStoryTrigger): string => `prepared-world-story:${trigger.triggerRef}`;

function catalog(trigger: RoomWorldStoryTrigger, read: WorldStoryLibraryRead): StoryLibraryCatalog {
  return buildStoryLibraryCatalogForScope({ room: { roomId: trigger.source.roomId, runtimeEpochId: trigger.source.runtimeEpochId,
    branchId: trigger.source.branchId }, scopeRefs: [...trigger.scope.sceneIds, ...trigger.scope.entityIds],
    entries: read.entries, jobs: read.jobs, journal: { readAdmissions: owner => read.admissions.filter(value => same(value.owner, owner)) } });
}

/** Freeze before the one routing invocation. The caller persists this DTO in
 * the same Room journal transaction as its model-source ownership record. */
export function freezeWorldStoryHostContext(input: Readonly<{
  commit: RoomWorldStoryCommit; moduleProfile: AuthoritativeModuleProfile;
  library: WorldStoryLibraryRead; maxContextUnits: number;
}>, rules: Pick<VersionedRulesRuntime, "step"> & Partial<Pick<VersionedRulesRuntime, "replay">>) {
  const verified = verifyWorldStoryTrigger(input.commit, rules);
  if (verified.kind !== "verified") return verified;
  try {
    check(Number.isSafeInteger(input.maxContextUnits) && input.maxContextUnits > 0);
    const trigger = verified.trigger, sourceCatalog = catalog(trigger, input.library);
    const library: WorldStoryLibraryWitness = {
      catalog: sourceCatalog,
      jobs: input.library.jobs.map(job => ({ jobId: job.request.jobId, checkpoint: structuredClone(job.checkpoint) }))
        .sort((left, right) => left.jobId.localeCompare(right.jobId)),
      entries: input.library.entries.map(entry => ({ libraryRef: entry.libraryRef, entryHash: entry.entryHash }))
        .sort((left, right) => left.libraryRef.localeCompare(right.libraryRef)),
      admissionHashes: input.library.admissions.map(hash).sort(),
    };
    check(unique(library.jobs.map(job => job.jobId)) && unique(library.entries.map(entry => entry.libraryRef)) && unique(library.admissionHashes));
    const body = { format: "zhuwei.room-world-story-host-context/v1" as const,
      preparedActionId: worldStoryPreparedActionId(trigger), baseEventSeq: input.commit.beforeState.version,
      rulesInput: structuredClone(input.commit.rulesInput) as StoryJson, trigger,
      dueOrigin: verified.dueOrigin,
      moduleProfile: structuredClone(input.moduleProfile), library, maxContextUnits: input.maxContextUnits };
    return { kind: "frozen" as const, context: deepFreeze({ ...body, contextHash: hash(body) }) };
  } catch { return { kind: "blocked" as const, code: "STORY_CONTEXT_INSUFFICIENT" as const, issue: "world-host:invalid-frozen-library" }; }
}

export function worldStoryHostInvocationBinding(frozen: StoryFrozenWorldContext, state: AuthoritativeWorldState,
  profiles: RuntimeProfileManifest): StoryExternalInvocationBinding {
  assertFrozen(frozen);
  return worldStorySelectionInvocationBinding(state, profiles, frozen.trigger, frozen.library.catalog);
}

export type WorldStoryPreparationInput =
  | Readonly<{ kind: "noStory" }>
  | Readonly<{ kind: "existing"; offer: StoryLibraryOffer }>
  | Readonly<{ kind: "ready"; request: StoryRequest; context: StoryContext; budget: ReturnType<typeof roomStoryBudget> }>
  | Readonly<{ kind: "blocked"; code: string; issues: readonly string[] }>;

/** A known selection opens the existing complete author/reviewer pipeline.
 * An already catalogued opportunity is never re-opened under a new job. */
export function worldStoryHostPreparationInput(frozen: StoryFrozenWorldContext, selection: RoomWorldStorySelection,
  state: AuthoritativeWorldState, profiles: RuntimeProfileManifest): WorldStoryPreparationInput {
  try {
    assertFrozen(frozen);
    if (selection.kind === "noStory") return { kind: "noStory" };
    const request = createStoryRequest(worldStoryRequestInput(frozen.trigger, selection.selection));
    const existing = frozen.library.catalog.offers.find(offer => offer.opportunityId === request.opportunityId);
    if (existing) return { kind: "existing", offer: existing };
    const built = buildRoomWorldStoryContext({ request, trigger: frozen.trigger, state, profiles,
      moduleProfile: frozen.moduleProfile, libraryCatalog: frozen.library.catalog,
      capabilityDescriptions: roomStoryCapabilityDescriptions(), maxUnits: frozen.maxContextUnits });
    return built.kind === "ready" ? { kind: "ready", request, context: built.context, budget: roomStoryBudget(request.source) } : built;
  } catch { return { kind: "blocked", code: "STORY_CONTEXT_INSUFFICIENT", issues: ["world-host:invalid-preparation-context"] }; }
}

function assertFrozen(value: StoryFrozenWorldContext): void {
  check(exact(value, ["format", "preparedActionId", "baseEventSeq", "rulesInput", "dueOrigin", "trigger", "moduleProfile", "library", "maxContextUnits", "contextHash"]));
  const { contextHash, ...body } = value;
  check(value.format === "zhuwei.room-world-story-host-context/v1" && hash(body) === contextHash
    && value.preparedActionId === worldStoryPreparedActionId(value.trigger) && value.baseEventSeq === value.trigger.before.eventSeq
    && seq(value.baseEventSeq) && Number.isSafeInteger(value.maxContextUnits) && value.maxContextUnits > 0
    && exact(value.library, ["catalog", "jobs", "entries", "admissionHashes"]));
}

function checkpointPrefix(captured: unknown, current: StoryCheckpoint | null): StoryCheckpoint | null {
  if (captured === null) return null;
  check(isPlainRecord(captured) && current !== null && typeof captured.revision === "number"
    && Number.isSafeInteger(captured.revision) && captured.revision >= 1 && captured.revision <= current.revision);
  if (captured.status !== "preparing" || captured.revision === current.revision) {
    check(same(captured, current)); return current;
  }
  // Reconstruct a typed prefix only from immutable fields in the actual
  // journal checkpoint. Equality then rejects absent required fields, extra
  // fields or modified nested drafts/reviews rather than casting a witness.
  const prefix: StoryCheckpoint = {
    format: current.format, jobId: current.jobId, revision: captured.revision,
    requestHash: current.requestHash, contextHash: current.contextHash, status: "preparing",
    ...(Object.hasOwn(captured, "draft") && current.draft !== undefined ? { draft: current.draft } : {}),
    ...(Object.hasOwn(captured, "review") && current.review !== undefined ? { review: current.review } : {}),
    ...(Object.hasOwn(captured, "revisedDraft") && current.revisedDraft !== undefined ? { revisedDraft: current.revisedDraft } : {}),
  };
  check((prefix.review === undefined || (prefix.draft !== undefined && storyReviewAllowsRevision(prefix.review)))
    && (prefix.revisedDraft === undefined || prefix.review !== undefined) && same(captured, prefix));
  return prefix;
}

function reconstructLibrary(frozen: StoryFrozenWorldContext, snapshot: StoryStoreArchiveSnapshot): WorldStoryLibraryRead {
  const witness = frozen.library;
  check(Array.isArray(witness.jobs) && Array.isArray(witness.entries) && Array.isArray(witness.admissionHashes)
    && unique(witness.jobs.map(job => job.jobId)) && unique(witness.entries.map(entry => entry.libraryRef)) && unique(witness.admissionHashes));
  const jobs = witness.jobs.map(observed => {
    check(exact(observed, ["jobId", "checkpoint"]));
    const actual = snapshot.jobs.filter(job => job.input.request.jobId === observed.jobId);
    check(actual.length === 1);
    const checkpoint = checkpointPrefix(observed.checkpoint, actual[0].checkpoint);
    return { request: actual[0].input.request, context: actual[0].input.context, checkpoint };
  });
  const entries = witness.entries.map(observed => {
    check(exact(observed, ["libraryRef", "entryHash"]));
    const actual = snapshot.hostingArtifacts.filter(entry => entry.libraryRef === observed.libraryRef && entry.entryHash === observed.entryHash);
    check(actual.length === 1); return actual[0];
  });
  const admissions = witness.admissionHashes.map(observed => {
    const actual = snapshot.admissions.filter(admission => hash(admission) === observed);
    check(actual.length === 1); return actual[0];
  });
  const read = { jobs, entries, admissions };
  check(same(catalog(frozen.trigger, read), witness.catalog));
  return read;
}

/** Rebuild both real journal prefixes, then run the same Rules operation.
 * Frozen catalog rows are resolved against actual immutable library/job data;
 * forged drafts or promoted readiness cannot be justified by rehashing a DTO. */
export function verifyFrozenWorldStoryHostContext(frozen: StoryFrozenWorldContext, context: WorldStoryHostArchiveContext,
  rules: Pick<VersionedRulesRuntime, "step" | "replay">): Readonly<{
    kind: "verified"; state: AuthoritativeWorldState; profiles: RuntimeProfileManifest; binding: StoryExternalInvocationBinding;
  }> | Readonly<{ kind: "blocked"; code: "STORY_ARCHIVE_HOST_BINDING_INVALID" }> {
  try {
    assertFrozen(frozen);
    const through = frozen.trigger.after.eventSeq;
    check(seq(through) && BigInt(through) > BigInt(frozen.baseEventSeq) && BigInt(through) <= BigInt(context.archive.head.eventSeq));
    const before = rules.replay(context.archive.signedGenesis, context.archive.events.filter(event => BigInt(event.eventSeq) <= BigInt(frozen.baseEventSeq)));
    const after = rules.replay(context.archive.signedGenesis, context.archive.events.filter(event => BigInt(event.eventSeq) <= BigInt(through)));
    check(before.kind === "replayed" && after.kind === "replayed" && before.head.eventSeq === frozen.baseEventSeq && after.head.eventSeq === through);
    const beforeState = before.state as unknown as AuthoritativeWorldState;
    const afterState = after.state as unknown as AuthoritativeWorldState;
    const events = context.archive.events.filter(event => BigInt(event.eventSeq) > BigInt(frozen.baseEventSeq) && BigInt(event.eventSeq) <= BigInt(through));
    const verified = verifyWorldStoryTrigger({ beforeState, afterState, due: frozen.trigger.due,
      rulesInput: frozen.rulesInput, committedEvents: events, budgetSource: frozen.trigger.source, profiles: after.profiles,
      ...(frozen.dueOrigin === null ? {} : { continuationProof: { origin: frozen.dueOrigin,
        signedGenesis: context.archive.signedGenesis, events: context.archive.events } }) }, rules);
    check(verified.kind === "verified" && same(verified.trigger, frozen.trigger));
    const { moduleRef, ...body } = frozen.moduleProfile;
    check(same(moduleRef, afterState.campaignRuntime.campaign?.moduleRef)
      && hash({ ...body, moduleRef: { profileId: moduleRef.profileId } }) === moduleRef.profileHash);
    reconstructLibrary(frozen, context.storySnapshot);
    return { kind: "verified", state: afterState, profiles: after.profiles,
      binding: worldStoryHostInvocationBinding(frozen, afterState, after.profiles) };
  } catch { return { kind: "blocked", code: "STORY_ARCHIVE_HOST_BINDING_INVALID" }; }
}

export function exportWorldStoryHostBinding(world: StoryFrozenWorldContext, input: Readonly<{
  sourceChain: readonly WorldStoryHostSourceRow[]; stages: readonly WorldStoryHostStage[]; storySnapshot: StoryStoreArchiveSnapshot;
}>): StoryArchiveHostBinding {
  assertFrozen(world);
  const jobIds = input.storySnapshot.jobs.filter(job => !world.library.jobs.some(observed => observed.jobId === job.input.request.jobId)
    && same(job.input.request.source, world.trigger.source)
    && job.input.request.trigger.basisRefs.includes(world.trigger.triggerRef)).map(job => job.input.request.jobId).sort();
  const invocationIds = [...input.stages.map(stage => stage.invocationId), ...input.storySnapshot.invocations
    .filter(row => row.invocation.jobId !== null && jobIds.includes(row.invocation.jobId)).map(row => row.invocation.invocationId)].sort();
  const payload: WorldStoryHostPayload = { format: "zhuwei.story-world-event-host/v1", preparedActionId: world.preparedActionId,
    sourceChain: input.sourceChain, stages: input.stages, world };
  return { bindingId: world.preparedActionId, kind: "npcDecision", source: world.trigger.source, jobIds, invocationIds,
    payload: payload as unknown as StoryRecord, payloadHash: hash(payload) };
}

/** The shared archive dispatcher checks sourceChain against the actual due
 * queue/causal roots first. This validates the world's distinct content and
 * physical context call, without using an NPC-limited decision template. */
export function validateWorldStoryHostPayload(binding: StoryArchiveHostBinding, context: WorldStoryHostArchiveContext,
  rules: Pick<VersionedRulesRuntime, "step" | "replay">): boolean {
  try {
    const payload = binding.payload as unknown as WorldStoryHostPayload;
    check(binding.kind === "npcDecision" && hash(payload) === binding.payloadHash
      && exact(payload, ["format", "preparedActionId", "sourceChain", "stages", "world"])
      && payload.format === "zhuwei.story-world-event-host/v1" && payload.preparedActionId === binding.bindingId
      && payload.world.preparedActionId === binding.bindingId && same(binding.source, payload.world.trigger.source)
      && Array.isArray(payload.sourceChain) && Array.isArray(payload.stages) && payload.stages.length <= 1
      && Array.isArray(binding.jobIds) && unique(binding.jobIds) && binding.jobIds.length <= 1
      && Array.isArray(binding.invocationIds) && unique(binding.invocationIds));
    const checked = verifyFrozenWorldStoryHostContext(payload.world, context, rules);
    check(checked.kind === "verified");
    const rebuilt = exportWorldStoryHostBinding(payload.world, { sourceChain: payload.sourceChain, stages: payload.stages, storySnapshot: context.storySnapshot });
    check(same(rebuilt, binding));
    const stage = payload.stages[0];
    if (!stage) return binding.jobIds.length === 0;
    check(exact(stage, ["ordinal", "contextHash", "bindingHash", "requestHash", "repairTicket", "invocationId"])
      && stage.ordinal === 1 && stage.contextHash === payload.world.contextHash && stage.bindingHash === WORLD_STORY_SELECTION_BINDING_HASH
      && stage.requestHash === hash(checked.binding.providerRequest) && stage.repairTicket === null);
    const rows = context.storySnapshot.invocations.filter(row => row.invocation.invocationId === stage.invocationId);
    check(rows.length === 1);
    const row = rows[0], { budget, ...external } = checked.binding;
    check(row.invocation.jobId === null && row.invocation.stage === null && row.invocation.purpose === "context"
      && same(row.externalBinding, external) && same(row.invocation.providerRequest, external.providerRequest)
      && row.invocation.requestHash === hash(external));
    if (row.invocation.status !== "completed" || !row.invocation.eligible) return binding.jobIds.length === 0;
    let selection: RoomWorldStorySelection;
    try { selection = parseWorldStorySelection(row.invocation.response); }
    catch { return binding.jobIds.length === 0; }
    const preparation = worldStoryHostPreparationInput(payload.world, selection, checked.state, checked.profiles);
    if (preparation.kind !== "ready") return binding.jobIds.length === 0;
    for (const jobId of binding.jobIds) {
      const jobs = context.storySnapshot.jobs.filter(job => job.input.request.jobId === jobId);
      check(jobs.length === 1 && same(jobs[0].input.request, preparation.request) && same(jobs[0].input.context, preparation.context)
        && same(jobs[0].input.budget, budget));
    }
    return true;
  } catch { return false; }
}
