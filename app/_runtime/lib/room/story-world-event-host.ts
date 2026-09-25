import { canonicalHash, deepFreeze, isPlainRecord } from "../kp/vnext/canonical-json";
import type { AuthoritativeModuleProfile } from "../module/authoritative";
import type { AuthoritativeWorldState, RuntimeProfileManifest } from "../rules";
import type { VersionedRulesRuntime } from "../rules/v2-runtime";
import type { AuthorityDueWorkRow } from "./authority-store";
import type { StoryArchiveHostBinding } from "./story-archive";
import type { StoryAdmissionReceipt, StoryExternalInvocationBinding, StoryJobSnapshot, StoryStoreArchiveSnapshot } from "./story-creation-invocation";
import type { StoryCheckpoint, StoryContext, StoryHash, StoryJson, StoryRecord, StoryRequest } from "./story-creation/contracts";
import type { StoryLibraryCatalog, StoryLibraryEntry, StoryLibraryOffer } from "./story-library-contracts";
import { buildStoryLibraryCatalogForScope } from "./story-library";
import { createStoryRequest, roomStoryCapabilityDescriptions } from "./story-action-request";
import { buildRoomWorldStoryContext } from "./story-context";
import { roomStoryBudget } from "./story-runtime-policy";
import { verifyWorldStoryTrigger, worldStoryRequestInput, worldStorySelectionInvocationBinding, type RoomWorldStoryCommit, type RoomWorldStoryDueOrigin, type RoomWorldStoryTrigger, type RoomWorldStorySelection } from "./story-world-event";
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
  profiles: RuntimeProfileManifest, modelId?: string): StoryExternalInvocationBinding {
  assertFrozen(frozen);
  return worldStorySelectionInvocationBinding(state, profiles, frozen.trigger, frozen.library.catalog, modelId);
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
