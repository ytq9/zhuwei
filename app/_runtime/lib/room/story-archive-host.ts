import { canonicalHash, isPlainRecord, parseJsonWithUniqueMembers, type JsonRecord } from "../kp/vnext/canonical-json";
import { buildRequiredContext, type VNextRequiredContext } from "../kp/vnext/required-context";
import { assertVNextInvocationTransition, type VNextInvocationRequest } from "./vnext-proposal-invocation";
import { parseVNextProposalOfferResponse } from "../kp/vnext/proposal-provider";
import { bindStoryPreparationContext } from "./story-action-context";
import { bindStoryLibrarySelection, roomStoryReuseRequest } from "./story-library-context";
import { buildStoryLibraryCatalog, storyHostingArtifact, storyLibraryCatalog, storyLibraryMappings,
  storyLibraryOwner, validateStoryLibraryEntry, validateStoryLibraryGenesis } from "./story-library";
import type { StoryLibraryBinding } from "./story-library-contracts";
import type { StorySelection } from "../kp/vnext/story-selection";
import { roomStoryRequest, roomStoryCapabilityDescriptions } from "./story-action-request";
import { buildRoomStoryContext } from "./story-context";
import { roomModelInvocationBinding, roomStoryBudget } from "./story-runtime-policy";
import { VNEXT_KP_WORKFLOW_HASH, VNEXT_KP_PROFILE, VNEXT_PROVIDER_BUDGET, VNEXT_RULES_RUNTIME } from "../kp/vnext/runtime-policy";
import { vnextActorPlanDecisionInput, VNEXT_ACTOR_PLAN_DECISION_BINDING_HASH } from "../kp/vnext/actor-plan-decision";
import { promiseReviewModelInput, PROMISE_REVIEW_BINDING_HASH } from "../kp/vnext/promise-review";
import { npcWorkModelInput, parseNpcWorkSelection, npcWorkResponseIsEmpty, prepareNpcWorkRequest, NPC_WORK_BINDING_HASH,
  type NpcWorkDecisionRequest } from "../kp/vnext/npc-work";
import { naturalNarrationModelInput, narrationReviewModelInput, extractFrozenNarrationResponse, validateNarrationCandidate } from "../kp/narration-vnext";
import { frozenNarrationContextConform } from "../kp/narration-context";
import { deepSeekRequestBody } from "../kp/deepseek";
import { assembleProviderInvocation, INITIAL_REPAIR_LEDGER } from "../kp/vnext/invocation/assemble";
import type { DueActorPlanDecisionRequest, FrozenClaimsNarrationRequest } from "../kp/authoritative-types";
import type { AuthoritativeWorldState } from "../rules";
import { frozenRenderableClaimsConform } from "../rules/authority-read";
import { dueActivityDescriptors } from "../rules/v2/due-activities";
import type { DueActivityDescriptor } from "../rules/v2/model";
import type { PromiseReviewRequest } from "../rules/v2/promise-lifecycle";
import { pinnedModuleRef } from "../module/registry";
import type { AuthoritativeModuleProfile } from "../module/authoritative";
import { isCanonicalAuthorityRecoveryInput, verifiedAuthorityCommitRecovery, type AuthorityCommitRecovery } from "./authority-commit-recovery";
import type { AuthoritativeRoomStore, AuthorityStoryHostSnapshot, AuthoritySubmissionRow, AuthorityDueWorkRow } from "./authority-store";
import type { PreparedAuthoritativeAction } from "./authority-types";
import type { AuthoritativeRoomArchive } from "./archive";
import type { StoryArchiveHostBinding } from "./story-archive";
import type { StoryStoreArchiveSnapshot } from "./story-creation-invocation";
import type { StoryHash, StoryRecord } from "./story-creation/contracts";
import { extractStructuredOutput } from "../kp/authoritative-helpers";
import { NPC_PENDING_DECISION_TOOL_NAME, validateNpcPendingDecisionOutput } from "../kp/pending-decision-policy";
import { STORY_NPC_PENDING_BINDING_HASH, storyNpcPendingPreparedActionId, storyNpcPendingRequest,
  storyNpcPendingProviderRequest, storyNpcPendingCanonicalProven, type StoryFrozenNpcPendingContext,
  type StoryNpcPendingOwner } from "./story-npc-pending";
import { isAtomicWorldContinuation } from "../rules/v2/atomic-world-input";
import { exportWorldStoryHostBinding, validateWorldStoryHostPayload,
  type StoryFrozenWorldContext, type WorldStoryHostPayload } from "./story-world-event-host";

export type StoryFrozenNpcContext = Readonly<{
  preparedActionId: string;
  request: DueActorPlanDecisionRequest | PromiseReviewRequest | NpcWorkDecisionRequest;
  dueActivity: DueActivityDescriptor;
  causeRootActionId: string;
  causeEventId: string;
  baseEventSeq: string;
  moduleProfile?: AuthoritativeModuleProfile;
}>;
export type StoryFrozenNarrationContext = Readonly<{
  preparedActionId: string;
  audienceId: string;
  generation: number;
  request: Pick<FrozenClaimsNarrationRequest, "rootActionId" | "receipt" | "narrationInputMode" | "viewerKey" | "renderableClaims" | "narrationContext">;
}>;
/** Immutable protocol evidence references physical calls owned by StoryStore.
 * No dispatch status, send capability, response or budget amount is copied. */
type Stage = Readonly<{
  ordinal: number; contextHash: string; bindingHash: string; requestHash: string;
  repairTicket: StoryRecord | null; invocationId: string;
}>;
type DueWork = Omit<AuthorityDueWorkRow, "descriptor_json"> & { descriptor: DueActivityDescriptor };
type Submission = Omit<AuthoritySubmissionRow, "prepared_json" | "continuation_json" | "result_json"> & {
  prepared: PreparedAuthoritativeAction;
  /** Only the original authenticated player-intent envelope. NPC continuation
   * is reconstructed exclusively from its validated frozen due-work context. */
  originalInput: StoryRecord | null;
};
type Recovery = { proposalHash: string; recoveryHash: string; recovery: AuthorityCommitRecovery };
type Common = { preparedActionId: string; sourceChain: DueWork[]; stages: Stage[] };
type ActionPayload = Common & {
  format: "zhuwei.story-prepared-action-host/v1" | "zhuwei.story-npc-decision-host/v1";
  submission: Submission; scopeVersion: number; recovery: Recovery | null;
  admissionInput: StoryRecord | null; moduleProfile: AuthoritativeModuleProfile | null;
  npcContext: StoryFrozenNpcContext | null;
};
type NarrationPayload = Common & { format: "zhuwei.story-viewer-narration-host/v1"; narration: StoryFrozenNarrationContext };
type NpcPendingPayload = Common & { format: "zhuwei.story-npc-pending-host/v1";
  pending: StoryFrozenNpcPendingContext; owner: StoryNpcPendingOwner; answer: StoryRecord | null };
type Payload = ActionPayload | NarrationPayload | NpcPendingPayload | WorldStoryHostPayload;
type ValidationContext = { archive: AuthoritativeRoomArchive; storySnapshot: StoryStoreArchiveSnapshot };

const same = (left: unknown, right: unknown): boolean => canonicalHash(left) === canonicalHash(right);
// This host belongs to the versioned vNext Room runtime. Its registry includes
// the inherited manifests; an unregistered manifest fails without fallback.
const { replay, project } = VNEXT_RULES_RUNTIME;
const fail = (): never => { throw new TypeError("STORY_ARCHIVE_HOST_BINDING_INVALID"); };
const check: (condition: unknown) => asserts condition = condition => { if (!condition) fail(); };
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const seq = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
const hash = (value: unknown): value is StoryHash => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const parse = <T>(value: string): T => parseJsonWithUniqueMembers(value) as T;
function keys(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  return isPlainRecord(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function unique(values: readonly string[]): boolean { return values.every(text) && values.length === new Set(values).size; }
function parsedContext<T>(snapshot: AuthorityStoryHostSnapshot, id: string, kind: string): T | null {
  const rows = snapshot.contexts.filter(row => row.prepared_action_id === id && row.context_kind === kind);
  check(rows.length <= 1);
  return rows.length === 0 ? null : parse<T>(rows[0].context_json);
}
function sourceChain(snapshot: AuthorityStoryHostSnapshot, root: string): DueWork[] {
  const chain: DueWork[] = [], seen = new Set<string>();
  while (true) {
    check(!seen.has(root)); seen.add(root);
    const row = snapshot.dueWork.find(row => row.child_root_action_id === root);
    if (row === undefined) return chain;
    const { descriptor_json, ...body } = row;
    chain.push({ ...body, descriptor: parse<DueActivityDescriptor>(descriptor_json) });
    root = row.cause_root_action_id;
  }
}
function submissionDto(row: AuthorityStoryHostSnapshot["submissions"][number]): Submission {
  const { prepared_json, continuation_json, ...body } = row;
  const prepared = parse<PreparedAuthoritativeAction>(prepared_json);
  const continuation = continuation_json === null ? null : parse<Record<string, unknown>>(continuation_json);
  let originalInput: StoryRecord | null = null;
  if (row.input_kind === "intent" && continuation !== null) {
    check(keys(continuation, ["originalInput"]));
    originalInput = continuation.originalInput as StoryRecord;
  } else if (row.input_kind !== "dueActivity") check(continuation === null);
  return { ...body, prepared, originalInput };
}

/** Capture only owners of actual StoryStore work. Frozen narration premises
 * survive plan cleanup; no published frame or publication result is read. */
export function exportStoryArchiveHostBindings(store: Pick<AuthoritativeRoomStore, "storyArchiveHostSnapshot">,
  storySnapshot: StoryStoreArchiveSnapshot): readonly StoryArchiveHostBinding[] {
  const snapshot = store.storyArchiveHostSnapshot();
  const grouped = new Map<string, Stage[]>();
  const worldOwners = new Map<string, string>();
  for (const row of snapshot.contexts.filter(row => row.context_kind === "world")) {
    const world = parse<StoryFrozenWorldContext>(row.context_json);
    check(world.preparedActionId === row.prepared_action_id && !grouped.has(row.prepared_action_id));
    grouped.set(row.prepared_action_id, []);
    const binding = exportWorldStoryHostBinding(world, { sourceChain: [], stages: [], storySnapshot });
    for (const jobId of binding.jobIds) {
      check(!worldOwners.has(jobId)); worldOwners.set(jobId, row.prepared_action_id);
    }
  }
  for (const proof of snapshot.proofs) {
    const call = storySnapshot.invocations.find(row => row.invocation.invocationId === proof.invocation_id);
    check(call?.externalBinding !== null && call !== undefined);
    const full = parse<Record<string, unknown>>(proof.external_binding_json), { budget, ...external } = full;
    check(same(external, call!.externalBinding) && same(budget, roomStoryBudget(call!.externalBinding!.source)));
    const stages = grouped.get(proof.prepared_action_id) ?? [];
    stages.push({ ordinal: proof.ordinal, contextHash: proof.context_hash, bindingHash: proof.binding_hash,
      requestHash: proof.request_hash, repairTicket: proof.repair_ticket_json === null ? null : parse<StoryRecord>(proof.repair_ticket_json),
      invocationId: proof.invocation_id });
    grouped.set(proof.prepared_action_id, stages);
  }
  for (const job of storySnapshot.jobs) {
    if (worldOwners.has(job.input.request.jobId)) continue;
    const possible = snapshot.submissions.filter(row => row.root_action_id === job.input.request.source.sourceId && row.input_kind === "intent");
    check(possible.length === 1);
    if (!grouped.has(possible[0].prepared_action_id)) grouped.set(possible[0].prepared_action_id, []);
  }
  for (const context of snapshot.contexts.filter(row => row.context_kind === "npcPending")) {
    if (!grouped.has(context.prepared_action_id)) grouped.set(context.prepared_action_id, []);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, stages]) => {
    stages.sort((a, b) => a.ordinal - b.ordinal);
    const narration = parsedContext<StoryFrozenNarrationContext>(snapshot, id, "narration");
    const pending = parsedContext<StoryFrozenNpcPendingContext>(snapshot, id, "npcPending");
    const world = parsedContext<StoryFrozenWorldContext>(snapshot, id, "world");
    const row = snapshot.submissions.find(row => row.prepared_action_id === id);
    const root = world?.trigger.due.childRootActionId ?? narration?.request.rootActionId ?? pending?.request.rootActionId ?? row?.root_action_id;
    check(text(root));
    const chain = sourceChain(snapshot, root!);
    const sourceRoot = chain.at(-1)?.cause_root_action_id ?? root!;
    const account = storySnapshot.accounts.filter(row => row.kind === "source" && isPlainRecord(row.binding.source)
      && row.binding.source.sourceId === sourceRoot);
    check(account.length === 1);
    const source = account[0].binding.source as StoryArchiveHostBinding["source"];
    if (world !== null) {
      check(narration === null && pending === null && row === undefined && same(source, world.trigger.source));
      return exportWorldStoryHostBinding(world, { sourceChain: chain, stages, storySnapshot });
    }
    const jobIds = narration !== null || pending !== null ? [] : storySnapshot.jobs.filter(job => same(job.input.request.source, source)
      && row?.root_action_id === source.sourceId && !worldOwners.has(job.input.request.jobId)).map(job => job.input.request.jobId).sort();
    const invocationIds = [...stages.map(stage => stage.invocationId), ...storySnapshot.invocations
      .filter(call => call.invocation.jobId !== null && jobIds.includes(call.invocation.jobId)).map(call => call.invocation.invocationId)].sort();
    let payload: Payload, kind: StoryArchiveHostBinding["kind"];
    if (pending !== null) {
      check(narration === null && row === undefined); kind = "npcDecision";
      const owner = parsedContext<StoryNpcPendingOwner>(snapshot, id, "npcPendingOwner"); check(owner !== null);
      payload = { format: "zhuwei.story-npc-pending-host/v1", preparedActionId: id, sourceChain: chain, stages, pending, owner: owner!,
        answer: parsedContext<StoryRecord>(snapshot, id, "npcPendingAnswer") };
    } else if (narration !== null) {
      check(row === undefined); kind = "viewerNarration";
      payload = { format: "zhuwei.story-viewer-narration-host/v1", preparedActionId: id, sourceChain: chain, stages, narration };
    } else {
      check(row !== undefined);
      const priorHost = parsedContext<ActionPayload>(snapshot, id, "npcPendingOwnerHost");
      const npcContext = parsedContext<StoryFrozenNpcContext>(snapshot, id, "npc");
      kind = npcContext === null ? "preparedAction" : "npcDecision";
      const saved = snapshot.recoveries.find(row => row.prepared_action_id === id);
      const recovery = saved === undefined ? null : verifiedAuthorityCommitRecovery(saved);
      check(recovery !== undefined);
      const hasPendingOwner = snapshot.contexts.some(context => context.context_kind === "npcPendingOwner"
        && parse<StoryNpcPendingOwner>(context.context_json).prepared_action_id === id);
      // The original waiting status remains in npcPendingOwner. This host is
      // the frozen model evidence; no absent random batch is reconstructed.
      const current = { ...row!, status: hasPendingOwner && row!.status === "awaitingRandomness" ? "prepared" : row!.status };
      const terminal = ["committed", "concluded"].includes(current.status);
      if (priorHost !== null) {
        kind = priorHost.npcContext === null ? "preparedAction" : "npcDecision";
        payload = { ...priorHost, sourceChain: chain, stages,
          submission: { ...priorHost.submission, status: current.status,
            originalInput: terminal ? null : priorHost.submission.originalInput },
          scopeVersion: snapshot.scopes.find(scope => scope.scope_id === row!.scene_scope)?.version ?? priorHost.scopeVersion };
      } else {
        payload = { format: kind === "preparedAction" ? "zhuwei.story-prepared-action-host/v1" : "zhuwei.story-npc-decision-host/v1",
          preparedActionId: id, sourceChain: chain, stages, submission: submissionDto(current),
          scopeVersion: snapshot.scopes.find(scope => scope.scope_id === row!.scene_scope)?.version ?? 0,
          recovery: saved === undefined ? null : { proposalHash: saved.proposal_hash, recoveryHash: saved.recovery_hash, recovery: recovery! },
          admissionInput: parsedContext<StoryRecord>(snapshot, id, "admission"),
          moduleProfile: parsedContext<AuthoritativeModuleProfile>(snapshot, id, "preparationModule")
            ?? parse<PreparedAuthoritativeAction>(row!.prepared_json).storyPreparation?.moduleProfile ?? null,
          npcContext };
      }
    }
    return { bindingId: id, kind, source, jobIds, invocationIds,
      payload: payload as unknown as StoryRecord, payloadHash: canonicalHash(payload) as StoryHash };
  });
}

function prefix(context: ValidationContext, eventSeq: string) {
  check(seq(eventSeq) && BigInt(eventSeq) <= BigInt(context.archive.head.eventSeq));
  const result = replay(context.archive.signedGenesis, context.archive.events.filter(event => BigInt(event.eventSeq) <= BigInt(eventSeq)));
  if (result.kind !== "replayed" || result.head.eventSeq !== eventSeq) return fail();
  return { ...result, state: result.state as unknown as AuthoritativeWorldState };
}
function validModule(profile: AuthoritativeModuleProfile, state: AuthoritativeWorldState): void {
  check(keys(profile, ["moduleId", "moduleVersion", "compatibleRulesetVersion", "moduleRef", "title", "tone", "storyBible"]));
  const pinned = pinnedModuleRef(profile.moduleId, profile.moduleVersion);
  const { moduleRef, ...body } = profile;
  check(pinned !== undefined && same(moduleRef, pinned) && same(moduleRef, state.campaignRuntime.campaign?.moduleRef)
    && canonicalHash({ ...body, moduleRef: { profileId: moduleRef.profileId } }) === moduleRef.profileHash);
}
function requiredContext(value: VNextRequiredContext, context: ValidationContext, stateHashMode: "rulesHead" | "npcWorkFrame" = "rulesHead") {
  check(keys(value, ["schema", "intent", "entries", "references", "binding"]));
  const { contextHash, ...binding } = value.binding;
  const rebuilt = buildRequiredContext({ ...value, binding, maxUnits: 48_000 });
  check(rebuilt.kind === "accepted" && same(rebuilt.context, value) && hash(contextHash));
  const base = prefix(context, binding.baseEventSeq);
  check(binding.roomEpochRef === base.state.runtimeEpochId && binding.stateHash === (stateHashMode === "rulesHead" ? base.head.stateHash : canonicalHash(base.state)));
  const profiles = Object.values(base.profiles).flatMap(value => Array.isArray(value) ? value : [value])
    .map(ref => ({ profileRef: ref.profileId, profileHash: ref.profileHash })).sort((a, b) => a.profileRef.localeCompare(b.profileRef));
  check(same([...binding.profiles].sort((a, b) => a.profileRef.localeCompare(b.profileRef)), profiles));
  return base;
}
function validateSourceChain(binding: StoryArchiveHostBinding, payload: Payload, context: ValidationContext, root: string): void {
  check(Array.isArray(payload.sourceChain));
  const seen = new Set<string>();
  for (const row of payload.sourceChain) {
    check(keys(row, ["child_root_action_id", "cause_root_action_id", "cause_event_id", "timeline_id", "completion_fiction_micros",
      "activity_id", "work_kind", "work_ref", "status", "next_attempt_at", "descriptor"]));
    check(row.child_root_action_id === root && !seen.has(root)); seen.add(root);
    const event = context.archive.events.find(event => event.eventId === row.cause_event_id);
    check(event?.rootActionId === row.cause_root_action_id && event !== undefined);
    const actual = dueActivityDescriptors(prefix(context, event!.eventSeq).state).find(due => due.childRootActionId === root);
    check(actual !== undefined && same(actual, row.descriptor) && row.timeline_id === actual.timelineId
      && row.completion_fiction_micros === actual.completionFictionMicros && row.activity_id === actual.activityId
      && row.work_kind === (actual.promiseReview ? "promiseReview" : actual.npcWork ? "npcWork" : "activity")
      && row.work_ref === (actual.promiseReview?.promiseId ?? actual.npcWork?.planId ?? actual.activityId)
      && ["pending", "committed", "cancelled"].includes(row.status)
      && (row.next_attempt_at === null || Number.isSafeInteger(row.next_attempt_at) && row.next_attempt_at >= 0));
    if (row.status === "committed") check(context.archive.receiptRefs.some(receipt => receipt.rootActionId === root
      && ["committed", "concluded"].includes(receipt.status)));
    root = row.cause_root_action_id;
  }
  check(!seen.has(root) && binding.source.sourceId === root && binding.source.kind === "playerAction"
    && binding.source.roomId === context.archive.roomId && binding.source.runtimeEpochId === context.archive.signedGenesis.runtimeEpochId
    && binding.source.budgetAccountId === `source-budget:${binding.source.runtimeEpochId}:${root}`);
}
function ledgerCall(context: ValidationContext, id: string) {
  const rows = context.storySnapshot.invocations.filter(row => row.invocation.invocationId === id);
  if (rows.length !== 1) return fail();
  return rows[0];
}
function validateStages(binding: StoryArchiveHostBinding, payload: Payload, context: ValidationContext): void {
  check(Array.isArray(payload.stages) && payload.stages.length <= 4);
  const all = payload.stages.map(stage => stage.invocationId);
  check(unique(all));
  for (const [index, stage] of payload.stages.entries()) {
    check(keys(stage, ["ordinal", "contextHash", "bindingHash", "requestHash", "repairTicket", "invocationId"])
      && stage.ordinal === index + 1 && [stage.contextHash, stage.bindingHash, stage.requestHash].every(hash)
      && (stage.repairTicket === null || isPlainRecord(stage.repairTicket)));
    const row = ledgerCall(context, stage.invocationId), external = row.externalBinding;
    check(external !== null && row.invocation.jobId === null && same(external?.source, binding.source)
      && canonicalHash(row.invocation.providerRequest) === stage.requestHash);
    const key = binding.kind === "preparedAction" ? `proposal:${binding.bindingId}:${stage.ordinal}`
      : binding.kind === "npcDecision" ? `npc:${binding.bindingId}:${stage.ordinal}` : `${binding.bindingId}:${stage.ordinal}`;
    const purpose = binding.kind === "preparedAction" ? "proposal" : binding.kind === "npcDecision" ? "npc" : "narration";
    const generated = roomModelInvocationBinding({ roomId: binding.source.roomId, runtimeEpochId: binding.source.runtimeEpochId,
      activeBranchId: binding.source.branchId } as AuthoritativeWorldState, binding.source.sourceId, key, purpose, row.invocation.providerRequest);
    const { budget: _policy, ...expected } = generated;
    check(same(external, expected) && row.invocation.purpose === purpose);
  }
  const jobCalls = context.storySnapshot.invocations.filter(row => row.invocation.jobId !== null && binding.jobIds.includes(row.invocation.jobId));
  check(same([...all, ...jobCalls.map(row => row.invocation.invocationId)].sort(), [...binding.invocationIds].sort()));
}
function priorStage(payload: Payload, context: ValidationContext, ordinal: number) {
  const stage = payload.stages.find(stage => stage.ordinal === ordinal);
  if (!stage) return undefined;
  const invocation = ledgerCall(context, stage.invocationId).invocation;
  return { status: invocation.status, context_hash: stage.contextHash, binding_hash: stage.bindingHash,
    response_json: invocation.response === undefined ? null : JSON.stringify(invocation.response) };
}
function completedResponse(payload: Payload, context: ValidationContext, ordinal: number): unknown {
  const saved = priorStage(payload, context, ordinal);
  check(saved?.status === "completed" && saved.response_json !== null);
  return parse(saved!.response_json!);
}
function validateSubmission(payload: ActionPayload, context: ValidationContext): void {
  const row = payload.submission, prepared = row.prepared;
  check(keys(row, ["submission_id", "principal_id", "payload_hash", "input_kind", "root_action_id", "prepared_action_id", "character_id",
    "scene_scope", "prepared_scope_version", "status", "proposal_hash", "prepared", "originalInput"]));
  check([row.submission_id, row.root_action_id, row.prepared_action_id, row.character_id, row.scene_scope].every(text)
    && hash(row.payload_hash) && (row.proposal_hash === null || hash(row.proposal_hash))
    && ["prepared", "committed", "concluded", "needsKp"].includes(row.status)
    && Number.isSafeInteger(row.prepared_scope_version) && row.prepared_scope_version >= 0
    && Number.isSafeInteger(payload.scopeVersion) && payload.scopeVersion >= row.prepared_scope_version
    && row.prepared_action_id === payload.preparedActionId);
  check(keys(prepared, ["kind", "preparedActionId", "rootActionId", "kpProjection"],
    ["requiredContext", "storyPreparation", "resolutionMode", "phase", "dueActorPlan", "receipt"])
    && prepared.kind === "prepared" && prepared.preparedActionId === row.prepared_action_id && prepared.rootActionId === row.root_action_id);
  const state = prefix(context, context.archive.head.eventSeq).state;
  if (row.principal_id !== null) {
    check(text(row.principal_id) && state.principals[row.principal_id] !== undefined);
  }
  if (row.status === "committed" || row.status === "concluded") {
    check(context.archive.receiptRefs.some(receipt => receipt.rootActionId === row.root_action_id && receipt.status === row.status));
    check(row.originalInput === null);
  }
  if (row.originalInput !== null) {
    check(row.input_kind === "intent" && keys(row.originalInput, ["kind", "submissionId", "text"], ["acknowledgementId"])
      && row.originalInput.kind === "intent" && row.originalInput.submissionId === row.submission_id && text(row.originalInput.text)
      && same(row.payload_hash, canonicalHash(row.originalInput)));
  }
  if (payload.recovery !== null) {
    check(keys(payload.recovery, ["proposalHash", "recoveryHash", "recovery"]));
    check(verifiedAuthorityCommitRecovery({ prepared_action_id: row.prepared_action_id, proposal_hash: payload.recovery.proposalHash,
      recovery_hash: payload.recovery.recoveryHash, recovery_json: JSON.stringify(payload.recovery.recovery) }) !== undefined);
    check(row.proposal_hash === null || row.proposal_hash === payload.recovery.proposalHash);
    const input = payload.recovery.recovery.rulesInput;
    if (input.rootActionId !== undefined) check(input.rootActionId === row.root_action_id);
    if (input.proposalId !== undefined) check(input.proposalId === row.root_action_id);
    if (input.actorCharacterId !== undefined) check(input.actorCharacterId === row.character_id);
  }
  const admission = context.storySnapshot.admissionBindings.find(value => value.preparedActionId === row.prepared_action_id);
  check((admission === undefined) === (payload.admissionInput === null));
  if (admission !== undefined) {
    check(isCanonicalAuthorityRecoveryInput(payload.admissionInput) && canonicalHash(payload.admissionInput) === admission.rulesInputHash);
    check(payload.admissionInput.rootActionId === row.root_action_id && payload.admissionInput.actorCharacterId === row.character_id);
    if (payload.recovery !== null) check(same(payload.recovery.recovery.rulesInput, payload.admissionInput));
  }
}
function validatePrepared(binding: StoryArchiveHostBinding, payload: ActionPayload, context: ValidationContext): void {
  check(payload.npcContext === null && payload.submission.input_kind === "intent" && text(payload.submission.principal_id));
  const prepared = payload.submission.prepared, frozen = prepared.requiredContext;
  check(frozen !== undefined);
  const base = requiredContext(frozen!, context), original = prepared.storyPreparation?.selectionContext ?? frozen!;
  if (original !== frozen) requiredContext(original, context);
  check(frozen!.binding.preparedActionId === payload.preparedActionId && frozen!.binding.rootActionId === prepared.rootActionId
    && frozen!.intent.submissionRef === payload.submission.submission_id && frozen!.intent.actorRef === payload.submission.character_id
    && base.state.entities[frozen!.intent.actorRef]?.kind === "player" && base.state.activeBranchId === binding.source.branchId);
  const control = base.state.characterControls[frozen!.intent.actorRef];
  check(control !== undefined && base.state.seats[control.seatId]?.principalId === payload.submission.principal_id);
  const projected = project(base.profiles, base.state, { kind: "kp", capability: "internal:kp-spatial-evidence" });
  check(projected.kind !== "rejected" && projected.projectionHash === frozen!.binding.projectionHash
    && isPlainRecord(prepared.kpProjection) && prepared.kpProjection.projectionHash === projected.projectionHash
    && prepared.kpProjection.stateVersion === base.state.version && prepared.kpProjection.activeBranchId === base.state.activeBranchId);
  if (payload.submission.originalInput !== null) check(payload.submission.originalInput.text === frozen!.intent.text);
  if (payload.moduleProfile !== null) validModule(payload.moduleProfile, base.state);
  for (const stage of payload.stages) {
    check(stage.bindingHash === VNEXT_KP_WORKFLOW_HASH && stage.contextHash === (stage.ordinal === 1 ? original : frozen!).binding.contextHash);
    const request = ledgerCall(context, stage.invocationId).invocation.providerRequest;
    check(request.model === VNEXT_KP_PROFILE.modelId);
    assertVNextInvocationTransition({ ordinal: stage.ordinal, contextHash: stage.contextHash, bindingHash: stage.bindingHash,
      requestHash: stage.requestHash, request, ...(stage.repairTicket === null ? {} : { repairTicket: stage.repairTicket }) } as VNextInvocationRequest,
      ordinal => priorStage(payload, context, ordinal), frozen!, prepared.storyPreparation);
  }
  const offer = binding.jobIds.length || prepared.storyPreparation !== undefined
    ? parseVNextProposalOfferResponse(completedResponse(payload, context, 1), original) : undefined;
  for (const jobId of binding.jobIds) {
    const job = context.storySnapshot.jobs.find(job => job.input.request.jobId === jobId);
    check(job !== undefined && offer?.story !== undefined && payload.moduleProfile !== null);
    check(same(roomStoryRequest(original, base.state, offer!.story!), job!.input.request));
    const marker = job!.input.context.materials.find(material => material.ref === "story-context:binding")?.content;
    check(isPlainRecord(marker) && Number.isSafeInteger(marker.maxUnits));
    const built = buildRoomStoryContext({ request: job!.input.request, requiredContext: original, state: base.state, profiles: base.profiles,
      moduleProfile: payload.moduleProfile!, capabilityDescriptions: roomStoryCapabilityDescriptions(), maxUnits: Number((marker as StoryRecord).maxUnits) });
    check(built.kind === "ready" && same(built.context, job!.input.context));
  }
  if (prepared.storyPreparation !== undefined) {
    const bound = prepared.storyPreparation;
    check(offer?.story !== undefined && payload.moduleProfile !== null);
    if (bound.library !== undefined) {
      validatePreparedLibrary(bound.library, offer!.story!, original, frozen!, payload.moduleProfile!, base, context, bound);
      return;
    }
    const job = context.storySnapshot.jobs.find(job => job.input.request.jobId === bound.jobId);
    check(job !== undefined && binding.jobIds.includes(bound.jobId) && job.checkpoint?.status === "ready" && payload.moduleProfile !== null);
    const preparation = job!.checkpoint!.revisedDraft ?? job!.checkpoint!.draft;
    const review = job!.checkpoint!.revisedReview ?? job!.checkpoint!.review;
    check(preparation !== undefined && review !== undefined);
    const built = bindStoryPreparationContext({ selectionContext: original, moduleProfile: payload.moduleProfile!, preparation: preparation!, review: review!,
      storyContext: job!.input.context, state: base.state, maxUnits: 48_000 });
    check(built.kind === "ready" && same(built.binding, bound) && same(built.context, frozen));
  }
}

/** Reuse owns a current action and read set, while the exact reviewed source
 * remains immutable. A historical source job is provenance, never a required
 * operational job or a spending permit in this Room. */
function validatePreparedLibrary(library: StoryLibraryBinding, selection: StorySelection,
  original: VNextRequiredContext, frozen: VNextRequiredContext, moduleProfile: AuthoritativeModuleProfile,
  base: ReturnType<typeof prefix>, context: ValidationContext,
  bound: NonNullable<PreparedAuthoritativeAction["storyPreparation"]>): void {
  const entry = library.entry, room = { roomId: base.state.roomId, runtimeEpochId: base.state.runtimeEpochId, branchId: base.state.activeBranchId };
  validateStoryLibraryEntry(entry, room);
  const saved = context.storySnapshot.hostingArtifacts.filter(value => value.libraryRef === entry.libraryRef);
  check(saved.length === 1 && same(saved[0], entry));
  const sourceJobId = entry.origin.kind === "creationJob" ? entry.origin.jobId : undefined;
  const sourceJob = sourceJobId === undefined ? undefined
    : context.storySnapshot.jobs.find(job => job.input.request.jobId === sourceJobId);
  if (entry.origin.kind === "creationJob") {
    check(sourceJob !== undefined && same(storyHostingArtifact({ ...sourceJob!.input, checkpoint: sourceJob!.checkpoint }), entry.artifact));
  } else validateStoryLibraryGenesis(entry, context.archive.signedGenesis);

  const owner = storyLibraryOwner(entry);
  const receipts = context.storySnapshot.admissions.filter(receipt => same(receipt.owner, owner)
    && BigInt(receipt.recordedAtEventSeq) <= BigInt(original.binding.baseEventSeq));
  const mappings = storyLibraryMappings(entry, receipts);
  if ("libraryRef" in selection) {
    const catalog = storyLibraryCatalog(original), selected = catalog?.offers.find(offer => offer.libraryRef === selection.libraryRef);
    check(catalog !== undefined && same(catalog!.room, room) && selected !== undefined && selection.libraryRef === entry.libraryRef
      && selected!.opportunityId === entry.artifact.request.opportunityId && same(selected!.owner, owner));
    if (selected!.status === "ready") {
      const rebuilt = buildStoryLibraryCatalog({ room, requiredContext: original, entries: [entry], jobs: [],
        journal: { readAdmissions: () => receipts } });
      check(rebuilt.offers.length === 1 && same(rebuilt.offers[0], selected));
    } else {
      // The initial offer may have frozen an unfinished creation job which
      // subsequently completed. Its final archive cannot replace that offer.
      check(selected!.status === "preparing" && sourceJob !== undefined && selected!.preparationHash === null
        && same(selected!.sceneRefs, sourceJob!.input.request.scope.sceneIds)
        && same(selected!.entityRefs, sourceJob!.input.request.scope.entityIds));
      const versions = [sourceJob!.checkpoint?.draft, sourceJob!.checkpoint?.revisedDraft].filter(value => value !== undefined);
      check(selected!.title === sourceJob!.input.request.trigger.goal && selected!.centralQuestion === sourceJob!.input.request.trigger.goal
        || versions.some(value => selected!.title === value!.title && selected!.centralQuestion === value!.centralQuestion));
    }
  } else {
    // A repeated create offer resolves the same stable opportunity to its
    // ready job. The new source root belongs to reuse, not original authorship.
    const requested = roomStoryRequest(original, base.state, selection), authored = entry.artifact.request;
    check(entry.origin.kind === "creationJob" && requested.jobId === authored.jobId && requested.opportunityId === authored.opportunityId
      && requested.scale === authored.scale && requested.connection === authored.connection && same(requested.methods, authored.methods));
  }
  const currentRequest = roomStoryReuseRequest(original, base.state, entry, mappings);
  const marker = library.currentContext.materials.find(material => material.ref === "story-context:binding")?.content;
  check(isPlainRecord(marker) && Number.isSafeInteger(marker.maxUnits));
  const current = buildRoomStoryContext({ request: currentRequest, requiredContext: original, state: base.state, profiles: base.profiles,
    moduleProfile, capabilityDescriptions: roomStoryCapabilityDescriptions(), maxUnits: Number((marker as StoryRecord).maxUnits) });
  check(current.kind === "ready");
  const rebuilt = bindStoryLibrarySelection({ entry, mappings, currentRequest, currentContext: current.context,
    selectionContext: original, moduleProfile, state: base.state, profiles: base.profiles, maxUnits: 48_000 });
  check(rebuilt.kind === "ready" && same(rebuilt.binding, bound) && same(rebuilt.context, frozen));
}
function npcWork(request: StoryFrozenNpcContext["request"]): request is NpcWorkDecisionRequest {
  return "schema" in request && request.schema === "zhuwei.npc-work-decision/vnext-1";
}
function promiseReview(request: StoryFrozenNpcContext["request"]): request is PromiseReviewRequest {
  return "schema" in request && ["zhuwei.promise-review-context/vnext-1", "zhuwei.promise-review-batch/vnext-1"].includes(request.schema);
}
function npcProviderRequest(request: StoryFrozenNpcContext["request"], selection?: unknown, reemit = false) {
  const input = npcWork(request) ? npcWorkModelInput(request, selection, reemit) : promiseReview(request)
    ? promiseReviewModelInput(request) : vnextActorPlanDecisionInput(request);
  const assembled = assembleProviderInvocation({ providerBody: deepSeekRequestBody(VNEXT_KP_PROFILE.modelId, input) as JsonRecord,
    invocationKind: "initial", ledger: INITIAL_REPAIR_LEDGER, budgetProfile: VNEXT_PROVIDER_BUDGET });
  if (assembled.kind !== "ready") return fail();
  return assembled.providerBody;
}
function validateNpc(binding: StoryArchiveHostBinding, payload: ActionPayload, context: ValidationContext): void {
  const frozen = payload.npcContext;
  check(frozen !== null && binding.jobIds.length === 0 && payload.submission.input_kind === "dueActivity" && payload.submission.principal_id === null);
  check(keys(frozen, ["preparedActionId", "request", "dueActivity", "causeRootActionId", "causeEventId", "baseEventSeq"], ["moduleProfile"]));
  const saved = frozen!, request = saved.request, base = prefix(context, saved.baseEventSeq);
  check(saved.preparedActionId === payload.preparedActionId && saved.dueActivity.childRootActionId === payload.preparedActionId
    && base.state.activeBranchId === binding.source.branchId && same(saved.dueActivity, payload.sourceChain[0]?.descriptor)
    && saved.causeRootActionId === payload.sourceChain[0]?.cause_root_action_id && saved.causeEventId === payload.sourceChain[0]?.cause_event_id
    && dueActivityDescriptors(base.state).some(due => same(due, saved.dueActivity)));
  let expected: unknown;
  if (npcWork(request)) {
    check(saved.moduleProfile !== undefined); validModule(saved.moduleProfile!, base.state);
    expected = prepareNpcWorkRequest(base.state, base.profiles, saved.moduleProfile!, saved.preparedActionId, saved.dueActivity.npcWork!.planId);
    requiredContext(request.context, context, "npcWorkFrame");
  } else if (promiseReview(request)) {
    const due = saved.dueActivity.promiseReview;
    check(due !== undefined);
    const projected = project(base.profiles, base.state, { kind: "kp", capability: "internal:kp-spatial-evidence" },
      due!.promiseIds ? { promiseReviewBatchFor: due!.promiseIds } : { promiseReviewFor: due!.promiseId });
    check(projected.kind !== "rejected" && "promiseReview" in projected);
    expected = "promiseReview" in projected ? projected.promiseReview : undefined;
  } else {
    const projected = project(base.profiles, base.state, { kind: "kp", capability: "internal:kp-spatial-evidence" },
      { dueActorPlanFor: { affectedCharacterId: saved.dueActivity.ownerEntityId } });
    check(projected.kind !== "rejected" && "dueActorPlan" in projected);
    expected = { preparedActionId: saved.preparedActionId, rootActionId: saved.preparedActionId,
      dueActorPlan: "dueActorPlan" in projected ? projected.dueActorPlan : null, projection: projected, attempt: 1 };
  }
  check(expected !== undefined && same(expected, request));
  const bindingHash = npcWork(request) ? NPC_WORK_BINDING_HASH : promiseReview(request) ? PROMISE_REVIEW_BINDING_HASH : VNEXT_ACTOR_PLAN_DECISION_BINDING_HASH;
  for (const stage of payload.stages) {
    check(stage.contextHash === canonicalHash(request) && stage.bindingHash === bindingHash && stage.ordinal <= (npcWork(request) ? 3 : 1));
    let selection: unknown, ticket: unknown = null;
    if (stage.ordinal >= 2) {
      selection = completedResponse(payload, context, 1); parseNpcWorkSelection(selection);
      ticket = { kind: "npcWorkSelection", responseHash: canonicalHash(selection) };
    }
    if (stage.ordinal === 3) {
      const response = completedResponse(payload, context, 2); check(npcWorkResponseIsEmpty(response));
      ticket = { kind: "emptyNpcWorkResponse", responseHash: canonicalHash(response), selectionResponseHash: canonicalHash(selection) };
    }
    check(same(stage.repairTicket, ticket)
      && same(ledgerCall(context, stage.invocationId).invocation.providerRequest, npcProviderRequest(request, selection, stage.ordinal === 3)));
  }
}
function validateNarration(binding: StoryArchiveHostBinding, payload: NarrationPayload, context: ValidationContext): void {
  const frozen = payload.narration, request = frozen.request;
  check(keys(frozen, ["preparedActionId", "audienceId", "generation", "request"])
    && keys(request, ["rootActionId", "receipt", "narrationInputMode", "viewerKey", "renderableClaims", "narrationContext"]));
  check(binding.jobIds.length === 0 && frozen.preparedActionId === payload.preparedActionId && text(frozen.audienceId)
    && Number.isSafeInteger(frozen.generation) && frozen.generation >= 1
    && payload.preparedActionId === `narration:${request.rootActionId}:${frozen.audienceId}:${frozen.generation}`
    && request.narrationInputMode === "frozenRenderableClaims-vnext-1" && frozenRenderableClaimsConform(request.renderableClaims)
    && frozenNarrationContextConform(request.narrationContext, request.renderableClaims)
    && request.viewerKey === request.renderableClaims.viewerKey && request.rootActionId === request.renderableClaims.rootActionId);
  const receipt = context.archive.receiptRefs.find(receipt => receipt.receiptId === request.renderableClaims.receiptId);
  check(receipt !== undefined && receipt.rootActionId === request.rootActionId && receipt.activeBranchId === binding.source.branchId
    && isPlainRecord(request.receipt) && request.receipt.receiptId === receipt.receiptId && request.receipt.rootActionId === receipt.rootActionId);
  check(receipt.eventRange !== null && text(receipt.actorCharacterId));
  // A Room restored from its ordinary event archive holds the exact minimal
  // ReceiptReference until a fresh action commits a full public receipt.
  const referenceReceipt = keys(request.receipt, ["receiptId", "rootActionId", "status", "activeBranchId", "eventRange", "scopeVersions", "randomnessCommitmentHash"],
    ["actorCharacterId", "correctionId"]) && same(request.receipt, receipt);
  check(referenceReceipt || keys(request.receipt, ["receiptId", "rootActionId", "status", "runtimeEpochId", "activeBranchId", "eventRange", "scopeVersions", "randomnessCommitments"],
    ["actorCharacterId", "pendingInputId", "correctionId", "projectionHash", "meaningfulFailure", "newOptions", "resolutionDisposition"])
    && request.receipt.status === receipt.status && request.receipt.runtimeEpochId === binding.source.runtimeEpochId
    && request.receipt.activeBranchId === receipt.activeBranchId && request.receipt.actorCharacterId === receipt.actorCharacterId
    && same(request.receipt.scopeVersions, receipt.scopeVersions) && canonicalHash(request.receipt.randomnessCommitments) === receipt.randomnessCommitmentHash
    && isPlainRecord(request.receipt.eventRange) && request.receipt.eventRange.first === receipt.eventRange.first && request.receipt.eventRange.last === receipt.eventRange.last);
  const range = receipt.eventRange, before = prefix(context, (BigInt(range.first) - 1n).toString()), after = prefix(context, range.last);
  const [principalId, characterId, ...extra] = request.viewerKey.split("\u001f");
  check(text(principalId) && text(characterId) && extra.length === 0);
  const control = after.state.characterControls[characterId], seat = control === undefined ? undefined : after.state.seats[control.seatId];
  check(seat?.principalId === principalId && after.state.principals[principalId] !== undefined);
  const events = context.archive.events.filter(event => BigInt(event.eventSeq) >= BigInt(range.first) && BigInt(event.eventSeq) <= BigInt(range.last));
  const projected = project(after.profiles, after.state, { kind: "player", principalId, characterId,
    sessionVersion: after.state.principals[principalId].sessionVersion, seatId: seat!.id },
  { committedRange: { receiptId: receipt.receiptId, actorCharacterId: receipt.actorCharacterId, priorState: before.state, events } });
  check(projected.kind !== "rejected" && "renderableClaims" in projected && same(projected.renderableClaims, request.renderableClaims));
  for (const stage of payload.stages) {
    check(stage.ordinal <= 2 && stage.repairTicket === null && stage.contextHash === request.renderableClaims.projectionHash && stage.bindingHash === VNEXT_KP_WORKFLOW_HASH);
    const input = stage.ordinal === 1 ? naturalNarrationModelInput(request, VNEXT_KP_PROFILE.modelId)
      : narrationReviewModelInput(request, validateNarrationCandidate(extractFrozenNarrationResponse(completedResponse(payload, context, 1), "generation")).body, VNEXT_KP_PROFILE.modelId);
    check(same(ledgerCall(context, stage.invocationId).invocation.providerRequest, deepSeekRequestBody(VNEXT_KP_PROFILE.modelId, input)));
  }
}

function validateNpcPending(binding: StoryArchiveHostBinding, payload: NpcPendingPayload, context: ValidationContext): void {
  const frozen = payload.pending;
  check(keys(frozen, ["preparedActionId", "baseEventSeq", "request", "decision"]));
  const row = frozen.decision, request = frozen.request;
  check(keys(row, ["prepared_action_id", "capability", "pending_input_id", "proposal_hash", "wave_index", "input_json", "request_json", "answer_json"])
    && keys(request, ["preparedActionId", "rootActionId", "capability", "pending", "projection"])
    && binding.jobIds.length === 0 && payload.stages.length <= 1
    && [row.prepared_action_id, row.capability, row.pending_input_id, request.rootActionId].every(text)
    && hash(row.proposal_hash) && Number.isSafeInteger(row.wave_index) && row.wave_index >= -1
    && row.answer_json === null && typeof row.input_json === "string" && typeof row.request_json === "string"
    && frozen.preparedActionId === payload.preparedActionId
    && frozen.preparedActionId === storyNpcPendingPreparedActionId(row.prepared_action_id, row.pending_input_id)
    && request.preparedActionId === row.prepared_action_id && request.capability === row.capability);
  const base = prefix(context, frozen.baseEventSeq);
  check(base.state.activeBranchId === binding.source.branchId);
  const expected = storyNpcPendingRequest({ state: base.state, profiles: base.profiles,
    preparedActionId: row.prepared_action_id, rootActionId: request.rootActionId,
    pendingInputId: row.pending_input_id, capability: row.capability }, VNEXT_RULES_RUNTIME);
  check(same(expected, request) && same(parse(row.request_json), { pending: expected.pending, projection: expected.projection })
    && storyNpcPendingCanonicalProven(frozen, base.state));
  validateNpcPendingOwner(payload, base.state);
  for (const stage of payload.stages) {
    check(stage.ordinal === 1 && stage.repairTicket === null
      && stage.contextHash === canonicalHash(request) && stage.bindingHash === STORY_NPC_PENDING_BINDING_HASH
      && same(ledgerCall(context, stage.invocationId).invocation.providerRequest,
        storyNpcPendingProviderRequest(request, VNEXT_KP_PROFILE.modelId)));
  }
  if (payload.answer !== null) {
    check(isPlainRecord(payload.answer) && payload.stages.length === 1);
    const decision = validateNpcPendingDecisionOutput(extractStructuredOutput(
      completedResponse(payload, context, 1), NPC_PENDING_DECISION_TOOL_NAME), request);
    check(same(decision.answer, payload.answer));
  }
}

function validateNpcPendingOwner(payload: NpcPendingPayload, state: AuthoritativeWorldState): void {
  const owner = payload.owner, frozen = payload.pending, row = frozen.decision;
  check(keys(owner, ["submission_id", "principal_id", "payload_hash", "input_kind", "root_action_id", "prepared_action_id",
    "character_id", "scene_scope", "prepared_scope_version", "status", "proposal_hash", "scopeVersion"])
    && [owner.submission_id, owner.input_kind, owner.character_id, owner.scene_scope].every(text)
    && hash(owner.payload_hash) && owner.proposal_hash === row.proposal_hash
    && owner.prepared_action_id === row.prepared_action_id && owner.root_action_id === frozen.request.rootActionId
    && ["prepared", "awaitingRandomness"].includes(owner.status)
    && Number.isSafeInteger(owner.prepared_scope_version) && owner.prepared_scope_version >= 0
    && Number.isSafeInteger(owner.scopeVersion) && owner.scopeVersion >= owner.prepared_scope_version);
  const atomic = state.atomicWorldInteractions?.[owner.root_action_id];
  check(isAtomicWorldContinuation(atomic) && atomic.plan.actorCharacterId === owner.character_id
    && state.entities[owner.character_id] !== undefined
    && owner.scene_scope === `scene:${state.entities[owner.character_id].sceneId}`);
  const control = state.characterControls[owner.character_id], seat = control === undefined ? undefined : state.seats[control.seatId];
  if (owner.principal_id === null) check(owner.input_kind === "dueActivity" && state.entities[owner.character_id].kind === "npc");
  else check(text(owner.principal_id) && state.principals[owner.principal_id] !== undefined
    && seat?.principalId === owner.principal_id && seat.status === "active");
  const canonical = parse<StoryRecord>(row.input_json), input = canonical.input as StoryRecord;
  if (owner.input_kind === "dueActivity") {
    const work = payload.sourceChain[0];
    check(work !== undefined && work.child_root_action_id === owner.root_action_id
      && work.descriptor.ownerEntityId === owner.character_id && work.descriptor.activityId === input.activityId
      && owner.submission_id === `due-submission:${owner.root_action_id}` && owner.prepared_action_id === owner.root_action_id
      && input.kind === "completeActionActivity" && owner.payload_hash === canonicalHash(input) && owner.proposal_hash === canonicalHash(input));
  } else {
    check(["intent", "answer", "gear", "itemActivity", "environmentInteract", "environmentAbility"].includes(owner.input_kind)
      && input.kind !== "completeActionActivity");
  }
}

/** Mandatory synchronous semantic check used both on archive creation and on
 * trusted recovery. Replays actual prefixes and rebuilds model surfaces. */
export function validateStoryArchiveHostBinding(binding: StoryArchiveHostBinding, context: ValidationContext): boolean {
  try {
    check(keys(binding, ["bindingId", "kind", "source", "jobIds", "invocationIds", "payload", "payloadHash"])
      && Array.isArray(binding.jobIds) && Array.isArray(binding.invocationIds) && unique(binding.jobIds) && unique(binding.invocationIds)
      && (binding.jobIds.length + binding.invocationIds.length > 0
        || binding.kind === "npcDecision" && ["zhuwei.story-npc-pending-host/v1", "zhuwei.story-world-event-host/v1"].includes(String(binding.payload?.format)))
      && hash(binding.payloadHash) && canonicalHash(binding.payload) === binding.payloadHash);
    const payload = binding.payload as unknown as Payload;
    check(text(binding.bindingId) && payload.preparedActionId === binding.bindingId);
    if (binding.kind === "npcDecision" && payload.format === "zhuwei.story-world-event-host/v1") {
      validateSourceChain(binding, payload, context, payload.world.trigger.due.childRootActionId);
      validModule(payload.world.moduleProfile, prefix(context, payload.world.trigger.after.eventSeq).state);
      check(validateWorldStoryHostPayload(binding, context, VNEXT_RULES_RUNTIME));
    } else if (binding.kind === "npcDecision" && payload.format === "zhuwei.story-npc-pending-host/v1") {
      check(keys(payload, ["format", "preparedActionId", "sourceChain", "stages", "pending", "owner", "answer"]));
      validateSourceChain(binding, payload, context, payload.pending.request.rootActionId);
      validateStages(binding, payload, context); validateNpcPending(binding, payload, context);
    } else if (binding.kind === "viewerNarration") {
      check(keys(payload, ["format", "preparedActionId", "sourceChain", "stages", "narration"]) && payload.format === "zhuwei.story-viewer-narration-host/v1");
      const narration = payload as NarrationPayload;
      validateSourceChain(binding, narration, context, narration.narration.request.rootActionId);
      validateStages(binding, narration, context); validateNarration(binding, narration, context);
    } else {
      check(keys(payload, ["format", "preparedActionId", "sourceChain", "stages", "submission", "scopeVersion", "recovery", "admissionInput", "moduleProfile", "npcContext"])
        && ["preparedAction", "npcDecision"].includes(binding.kind)
        && payload.format === (binding.kind === "preparedAction" ? "zhuwei.story-prepared-action-host/v1" : "zhuwei.story-npc-decision-host/v1"));
      const action = payload as ActionPayload;
      validateSourceChain(binding, action, context, action.submission.root_action_id);
      validateStages(binding, action, context); validateSubmission(action, context);
      if (binding.kind === "preparedAction") validatePrepared(binding, action, context); else validateNpc(binding, action, context);
    }
    return true;
  } catch { return false; }
}

/** The archive validator receives only the actual closed lowered input after
 * validating this host's frozen action and semantic-stage association. */
export function readStoryArchiveAdmissionRulesInput(binding: StoryArchiveHostBinding, context: ValidationContext): Record<string, unknown> | undefined {
  if (!validateStoryArchiveHostBinding(binding, context) || binding.kind === "viewerNarration"
    || binding.payload.format === "zhuwei.story-npc-pending-host/v1" || binding.payload.format === "zhuwei.story-world-event-host/v1") return undefined;
  const input = (binding.payload as unknown as ActionPayload).admissionInput;
  return input === null ? undefined : structuredClone(input);
}

/** Pure conversion after validation; duplicate shared operational rows must
 * agree byte-for-byte after canonical serialization before any SQL mutation. */
export function restoreStoryArchiveHostBindings(store: Pick<AuthoritativeRoomStore, "restoreStoryArchiveHostSnapshot" | "restoreStoryNpcPendingDecision">,
  bindings: readonly StoryArchiveHostBinding[], context: ValidationContext): void {
  check(unique(bindings.map(binding => binding.bindingId)) && bindings.every(binding => validateStoryArchiveHostBinding(binding, context)));
  const owned = bindings.flatMap(binding => binding.invocationIds);
  check(unique(owned) && same([...owned].sort(), context.storySnapshot.invocations.map(row => row.invocation.invocationId).sort()));
  const jobs = bindings.flatMap(binding => binding.jobIds);
  check(unique(jobs) && same([...jobs].sort(), context.storySnapshot.jobs.map(job => job.input.request.jobId).sort()));
  const snapshot: AuthorityStoryHostSnapshot = { submissions: [], dueWork: [], recoveries: [], proofs: [], contexts: [], scopes: [] };
  const pendingPayloads: NpcPendingPayload[] = [];
  const add = <T>(list: T[], row: T, key: (value: T) => string) => {
    const previous = list.find(value => key(value) === key(row));
    if (previous === undefined) list.push(row); else check(same(previous, row));
  };
  for (const binding of bindings) {
    const payload = binding.payload as unknown as Payload;
    for (const row of payload.sourceChain) {
      const { descriptor, ...body } = row;
      add(snapshot.dueWork, { ...body, descriptor_json: JSON.stringify(descriptor) }, row => row.child_root_action_id);
    }
    for (const stage of payload.stages) {
      const call = ledgerCall(context, stage.invocationId), source = binding.source;
      const external = roomModelInvocationBinding({ roomId: source.roomId, runtimeEpochId: source.runtimeEpochId, activeBranchId: source.branchId } as AuthoritativeWorldState,
        source.sourceId, call.externalBinding!.invocationKey, call.externalBinding!.purpose, call.invocation.providerRequest);
      snapshot.proofs.push({ prepared_action_id: binding.bindingId, ordinal: stage.ordinal, context_hash: stage.contextHash,
        binding_hash: stage.bindingHash, request_hash: stage.requestHash, repair_ticket_json: stage.repairTicket === null ? null : JSON.stringify(stage.repairTicket),
        invocation_id: stage.invocationId, external_binding_json: JSON.stringify(external) });
    }
    if (payload.format === "zhuwei.story-viewer-narration-host/v1") {
      snapshot.contexts.push({ prepared_action_id: binding.bindingId, context_kind: "narration", context_json: JSON.stringify(payload.narration) });
      continue;
    }
    if (payload.format === "zhuwei.story-npc-pending-host/v1") {
      pendingPayloads.push(payload);
      snapshot.contexts.push({ prepared_action_id: binding.bindingId, context_kind: "npcPending", context_json: JSON.stringify(payload.pending) });
      snapshot.contexts.push({ prepared_action_id: binding.bindingId, context_kind: "npcPendingOwner", context_json: JSON.stringify(payload.owner) });
      if (payload.answer !== null) snapshot.contexts.push({ prepared_action_id: binding.bindingId,
        context_kind: "npcPendingAnswer", context_json: JSON.stringify(payload.answer) });
      continue;
    }
    if (payload.format === "zhuwei.story-world-event-host/v1") {
      snapshot.contexts.push({ prepared_action_id: binding.bindingId, context_kind: "world", context_json: JSON.stringify(payload.world) });
      continue;
    }
    const { prepared, originalInput, ...row } = payload.submission;
    const continuation = row.status === "committed" || row.status === "concluded" ? null : payload.npcContext !== null
      ? { dueActivity: payload.npcContext.dueActivity, causeRootActionId: payload.npcContext.causeRootActionId,
        causeEventId: payload.npcContext.causeEventId, actorPlanRequest: payload.npcContext.request }
      : originalInput === null ? null : { originalInput };
    snapshot.submissions.push({ ...row, prepared_json: JSON.stringify(prepared), continuation_json: continuation === null ? null : JSON.stringify(continuation) });
    add(snapshot.scopes, { scope_id: row.scene_scope, version: payload.scopeVersion }, scope => scope.scope_id);
    if (payload.recovery !== null) snapshot.recoveries.push({ prepared_action_id: binding.bindingId, proposal_hash: payload.recovery.proposalHash,
      recovery_hash: payload.recovery.recoveryHash, recovery_json: JSON.stringify(payload.recovery.recovery) });
    for (const [kind, value] of [["npc", payload.npcContext], ["admission", payload.admissionInput], ["preparationModule", payload.moduleProfile]] as const) {
      if (value !== null) snapshot.contexts.push({ prepared_action_id: binding.bindingId, context_kind: kind, context_json: JSON.stringify(value) });
    }
  }
  const headPrefix = prefix(context, context.archive.head.eventSeq), head = headPrefix.state;
  const pendingRows = pendingPayloads.filter(payload => head.combatRuntime.pendingInputs[payload.pending.decision.pending_input_id] !== undefined)
    .map(payload => {
      const frozen = payload.pending, row = frozen.decision;
      check(storyNpcPendingCanonicalProven(frozen, head)); validateNpcPendingOwner(payload, head);
      check(same(storyNpcPendingRequest({ state: head, profiles: headPrefix.profiles,
        preparedActionId: row.prepared_action_id, rootActionId: frozen.request.rootActionId,
        pendingInputId: row.pending_input_id, capability: row.capability }, VNEXT_RULES_RUNTIME), frozen.request));
      const { scopeVersion, ...identity } = payload.owner;
      const original = snapshot.submissions.find(value => value.prepared_action_id === row.prepared_action_id);
      if (original !== undefined) {
        for (const key of ["submission_id", "principal_id", "payload_hash", "input_kind", "root_action_id", "prepared_action_id",
          "character_id", "scene_scope", "prepared_scope_version", "proposal_hash"] as const) check(original[key] === identity[key]);
        const host = bindings.find(value => value.bindingId === row.prepared_action_id);
        check(host !== undefined && host.payload.format !== "zhuwei.story-npc-pending-host/v1");
        snapshot.contexts.push({ prepared_action_id: row.prepared_action_id, context_kind: "npcPendingOwnerHost", context_json: JSON.stringify(host!.payload) });
      }
      const work = identity.input_kind === "dueActivity" ? payload.sourceChain[0] : undefined;
      const continuation = work === undefined ? null : { dueActivity: work.descriptor,
        causeRootActionId: work.cause_root_action_id, causeEventId: work.cause_event_id };
      // Recovery derives a pending-only operational owner. The old model host
      // remains private audit evidence; it cannot authorize a new proposal.
      const restoredOwner = { ...identity, status: "prepared", prepared_json: JSON.stringify({ kind: "prepared",
        preparedActionId: identity.prepared_action_id, rootActionId: identity.root_action_id,
        kpProjection: {}, resolutionMode: "authorityDirect" }), continuation_json: continuation === null ? null : JSON.stringify(continuation) };
      snapshot.submissions = snapshot.submissions.filter(value => value.prepared_action_id !== identity.prepared_action_id);
      snapshot.submissions.push(restoredOwner);
      snapshot.recoveries = snapshot.recoveries.filter(value => value.prepared_action_id !== identity.prepared_action_id);
      add(snapshot.scopes, { scope_id: identity.scene_scope, version: scopeVersion }, value => value.scope_id);
      return { ...row, answer_json: payload.answer === null ? null : JSON.stringify(payload.answer) };
    });
  check(unique(pendingRows.map(row => row.prepared_action_id)));
  store.restoreStoryArchiveHostSnapshot(snapshot);
  for (const row of pendingRows) store.restoreStoryNpcPendingDecision(row);
}
