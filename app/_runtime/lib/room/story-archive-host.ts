import { canonicalHash, isPlainRecord, parseJsonWithUniqueMembers } from "../kp/vnext/canonical-json";
import { roomModelInvocationBinding, roomStoryBudget } from "./story-runtime-policy";
import { proposalRecoveryBinding } from "./proposal-invocation-recovery";
import type { NpcWorkDecisionRequest } from "../kp/vnext/npc-work";
import type { DueActorPlanDecisionRequest, FrozenClaimsNarrationRequest } from "../kp/authoritative-types";
import type { AuthoritativeWorldState, EventEnvelope } from "../rules";
import type { DueActivityDescriptor } from "../rules/v2/model";
import type { PromiseReviewRequest } from "../rules/v2/promise-lifecycle";
import type { AuthoritativeModuleProfile } from "../module/authoritative";
import { verifiedAuthorityCommitRecovery, type AuthorityCommitRecovery } from "./authority-commit-recovery";
import type { AuthoritativeRoomStore, AuthorityStoryHostSnapshot, AuthoritySubmissionRow, AuthorityDueWorkRow } from "./authority-store";
import type { PreparedAuthoritativeAction, PublicReceipt } from "./authority-types";
import type { StoryArchiveHostBinding } from "./story-archive";
import type { StoryStoreArchiveSnapshot } from "./story-creation-invocation";
import type { StoryHash, StoryRecord } from "./story-creation/contracts";
import type { StoryFrozenNpcPendingContext, StoryNpcPendingOwner } from "./story-npc-pending";
import { exportWorldStoryHostBinding, type StoryFrozenWorldContext, type WorldStoryHostPayload } from "./story-world-event-host";

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
  request: Pick<FrozenClaimsNarrationRequest, "rootActionId" | "receipt" | "narrationInputMode" | "narrationPolicy" | "viewerKey" | "renderableClaims" | "narrationContext">;
}>;
/** Immutable protocol evidence references physical calls owned by StoryStore.
 * No dispatch status, send capability, response or budget amount is copied. */
type Stage = Readonly<{
  ordinal: number; contextHash: string; bindingHash: string; requestHash: string;
  repairTicket: StoryRecord | null; invocationId: string; recoveryInvocationId?: string;
}>;
/** SPEC 0016 §9.2: a stage an earlier prompt version made, kept as evidence. */
type SupersededStage = Stage & Readonly<{ round: number }>;
type DueWork = Omit<AuthorityDueWorkRow, "descriptor_json"> & { descriptor: DueActivityDescriptor };
type Submission = Omit<AuthoritySubmissionRow, "prepared_json" | "continuation_json" | "result_json"> & {
  prepared: PreparedAuthoritativeAction;
  /** Only the original authenticated player-intent envelope. NPC continuation
   * is reconstructed exclusively from its validated frozen due-work context. */
  originalInput: StoryRecord | null;
};
type Recovery = { proposalHash: string; recoveryHash: string; recovery: AuthorityCommitRecovery };
type Common = { preparedActionId: string; sourceChain: DueWork[]; stages: Stage[]; supersededStages?: SupersededStage[] };
type ActionPayload = Common & {
  format: "zhuwei.story-prepared-action-host/v1" | "zhuwei.story-prepared-action-host/v2" | "zhuwei.story-prepared-action-host/v3" | "zhuwei.story-npc-decision-host/v1" | "zhuwei.story-npc-decision-host/v2";
  settlement?: Extract<NarrationSettlement, { kind: "cancelled" }>;
  submission: Submission; scopeVersion: number; recovery: Recovery | null;
  admissionInput: StoryRecord | null; moduleProfile: AuthoritativeModuleProfile | null;
  npcContext: StoryFrozenNpcContext | null;
};
export type NarrationSettlement = { kind: "cancelled"; baseEventSeq: string; events: EventEnvelope[];
  receipt: PublicReceipt; submissions: AuthorityStoryHostSnapshot["submissions"] } | { kind: "committed"; receiptId: string };
type NarrationPayload = Common & { narration: StoryFrozenNarrationContext }
  & ({ format: "zhuwei.story-viewer-narration-host/v1" } | { format: "zhuwei.story-viewer-narration-host/v2" }
    | { format: "zhuwei.story-viewer-narration-host/v3"; settlement: NarrationSettlement });
type NpcPendingPayload = Common & { format: "zhuwei.story-npc-pending-host/v1";
  pending: StoryFrozenNpcPendingContext; owner: StoryNpcPendingOwner; answer: StoryRecord | null };
type CancelledPayload = Common & { format: "zhuwei.story-cancelled-preparation-host/v1"; rootActionId: string;
  settlement: Extract<NarrationSettlement, { kind: "cancelled" }> };
type Payload = CancelledPayload | ActionPayload | NarrationPayload | NpcPendingPayload | WorldStoryHostPayload;

const same = (left: unknown, right: unknown): boolean => canonicalHash(left) === canonicalHash(right);
const fail = (): never => { throw new TypeError("STORY_ARCHIVE_HOST_BINDING_INVALID"); };
const check: (condition: unknown) => asserts condition = condition => { if (!condition) fail(); };
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const parse = <T>(value: string): T => parseJsonWithUniqueMembers(value) as T;
function keys(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  return isPlainRecord(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
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
  const stageOf = (proof: AuthorityStoryHostSnapshot["proofs"][number]): Stage => {
    const call = storySnapshot.invocations.find(row => row.invocation.invocationId === proof.invocation_id);
    check(call?.externalBinding !== null && call !== undefined);
    const full = parse<Record<string, unknown>>(proof.external_binding_json), { budget, ...external } = full;
    check(same(external, call!.externalBinding) && same(budget, roomStoryBudget(call!.externalBinding!.source)));
    const replacementKey = proposalRecoveryBinding(call!.externalBinding!).invocationKey;
    const replacement = call!.externalBinding!.purpose === "proposal" ? storySnapshot.invocations.find(row =>
      row.externalBinding?.invocationKey === replacementKey
      && row.externalBinding.source.budgetAccountId === call!.externalBinding!.source.budgetAccountId) : undefined;
    if (replacement !== undefined) check(same(replacement.externalBinding, proposalRecoveryBinding(call!.externalBinding!)));
    return { ordinal: proof.ordinal, contextHash: proof.context_hash, bindingHash: proof.binding_hash,
      requestHash: proof.request_hash, repairTicket: proof.repair_ticket_json === null ? null : parse<StoryRecord>(proof.repair_ticket_json),
      invocationId: proof.invocation_id,
      ...(replacement === undefined ? {} : { recoveryInvocationId: replacement.invocation.invocationId }) };
  };
  for (const proof of snapshot.proofs) {
    const stages = grouped.get(proof.prepared_action_id) ?? [];
    stages.push(stageOf(proof));
    grouped.set(proof.prepared_action_id, stages);
  }
  const supersededByWork = new Map<string, SupersededStage[]>();
  for (const proof of snapshot.supersededProofs) {
    const { round, ...active } = proof;
    supersededByWork.set(proof.prepared_action_id, [...supersededByWork.get(proof.prepared_action_id) ?? [], { ...stageOf(active), round }]);
    if (!grouped.has(proof.prepared_action_id)) grouped.set(proof.prepared_action_id, []);
  }
  for (const job of storySnapshot.jobs) {
    if (worldOwners.has(job.input.request.jobId)) continue;
    const possible = snapshot.submissions.filter(row => row.root_action_id === job.input.request.source.sourceId && row.input_kind === "intent");
    check(possible.length === 1);
    if (!grouped.has(possible[0].prepared_action_id)) grouped.set(possible[0].prepared_action_id, []);
  }
  for (const context of snapshot.contexts.filter(row => row.context_kind === "npcPending" || row.context_kind === "narrationSettlement")) {
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
    const settlement = parsedContext<NarrationSettlement>(snapshot, id, "narrationSettlement");
    const chain = sourceChain(snapshot, root!).map(work => {
      if (settlement?.kind !== "cancelled") return work;
      const cause = settlement.events.findLast(event => event.rootActionId === work.cause_root_action_id);
      return cause ? { ...work, cause_event_id: cause.eventId } : work;
    });
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
    const superseded = supersededByWork.get(id) ?? [];
    const invocationIds = [...[...stages, ...superseded].flatMap(stage => stage.recoveryInvocationId === undefined
      ? [stage.invocationId] : [stage.invocationId, stage.recoveryInvocationId]), ...storySnapshot.invocations
      .filter(call => call.invocation.jobId !== null && jobIds.includes(call.invocation.jobId)).map(call => call.invocation.invocationId)].sort();
    let payload: Payload, kind: StoryArchiveHostBinding["kind"];
    if (settlement?.kind === "cancelled" && narration === null && pending === null && stages.length === 0 && jobIds.length === 0) {
      kind = "preparedAction";
      payload = { format: "zhuwei.story-cancelled-preparation-host/v1", preparedActionId: id, rootActionId: root!, sourceChain: chain, stages, settlement };
    } else if (pending !== null) {
      check(narration === null && row === undefined); kind = "npcDecision";
      const owner = parsedContext<StoryNpcPendingOwner>(snapshot, id, "npcPendingOwner"); check(owner !== null);
      payload = { format: "zhuwei.story-npc-pending-host/v1", preparedActionId: id, sourceChain: chain, stages, pending, owner: owner!,
        answer: parsedContext<StoryRecord>(snapshot, id, "npcPendingAnswer") };
    } else if (narration !== null) {
      check(row === undefined); kind = "viewerNarration";
      if (narration.request.narrationPolicy === "plainText-v1") {
        const settlement = parsedContext<NarrationSettlement>(snapshot, id, "narrationSettlement");
        check(settlement !== null);
        payload = { format: "zhuwei.story-viewer-narration-host/v3", preparedActionId: id, sourceChain: chain, stages, narration, settlement: settlement! };
      } else payload = { format: stages.length > 2 ? "zhuwei.story-viewer-narration-host/v2" : "zhuwei.story-viewer-narration-host/v1", preparedActionId: id, sourceChain: chain, stages, narration };
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
        payload = { format: kind === "preparedAction"
          ? stages.some(stage => stage.recoveryInvocationId !== undefined) ? "zhuwei.story-prepared-action-host/v2" : "zhuwei.story-prepared-action-host/v1"
          : "zhuwei.story-npc-decision-host/v1",
          preparedActionId: id, sourceChain: chain, stages, submission: submissionDto(current),
          scopeVersion: snapshot.scopes.find(scope => scope.scope_id === row!.scene_scope)?.version ?? 0,
          recovery: saved === undefined ? null : { proposalHash: saved.proposal_hash, recoveryHash: saved.recovery_hash, recovery: recovery! },
          admissionInput: parsedContext<StoryRecord>(snapshot, id, "admission"),
          moduleProfile: parsedContext<AuthoritativeModuleProfile>(snapshot, id, "preparationModule")
            ?? parse<PreparedAuthoritativeAction>(row!.prepared_json).storyPreparation?.moduleProfile ?? null,
          npcContext };
      }
    }
    if (settlement?.kind === "cancelled" && "submission" in payload) {
      payload = { ...payload, format: kind === "preparedAction" ? "zhuwei.story-prepared-action-host/v3" : "zhuwei.story-npc-decision-host/v2", settlement };
    }
    // Absent unless a version change happened, so every other payload hash stays put.
    if (superseded.length > 0) {
      check(payload.format !== "zhuwei.story-cancelled-preparation-host/v1");
      payload = { ...payload, supersededStages: [...superseded].sort((a, b) => a.round - b.round || a.ordinal - b.ordinal) } as Payload;
    }
    return { bindingId: id, kind, source, jobIds, invocationIds,
      payload: payload as unknown as StoryRecord, payloadHash: canonicalHash(payload) as StoryHash };
  });
}

function supersededStagesOf(payload: Payload): readonly SupersededStage[] | undefined {
  return "supersededStages" in payload ? payload.supersededStages : undefined;
}
function ledgerCall(storySnapshot: StoryStoreArchiveSnapshot, id: string) {
  const rows = storySnapshot.invocations.filter(row => row.invocation.invocationId === id);
  if (rows.length !== 1) return fail();
  return rows[0];
}

/** Writes an archive's host bindings back into an empty Room, as recorded.
 * They are not validated against a replay of the world (SPEC 0011 §6, ADR 0054); `head`
 * is the state the Room itself replayed from the archive, used only to see
 * which NPC decisions are still waiting. */
export function restoreStoryArchiveHostBindings(store: Pick<AuthoritativeRoomStore, "restoreStoryArchiveHostSnapshot" | "restoreStoryNpcPendingDecision">,
  bindings: readonly StoryArchiveHostBinding[], context: Readonly<{ storySnapshot: StoryStoreArchiveSnapshot; head: AuthoritativeWorldState }>): void {
  const snapshot: AuthorityStoryHostSnapshot = { submissions: [], dueWork: [], recoveries: [], proofs: [], supersededProofs: [], contexts: [], scopes: [] };
  const pendingPayloads: NpcPendingPayload[] = [];
  const add = <T>(list: T[], row: T, key: (value: T) => string) => {
    if (!list.some(value => key(value) === key(row))) list.push(row);
  };
  for (const binding of bindings) {
    const payload = binding.payload as unknown as Payload;
    for (const row of payload.sourceChain) {
      const { descriptor, ...body } = row;
      add(snapshot.dueWork, { ...body, descriptor_json: JSON.stringify(descriptor) }, row => row.child_root_action_id);
    }
    const proofOf = (stage: Stage) => {
      const call = ledgerCall(context.storySnapshot, stage.invocationId), source = binding.source;
      const external = roomModelInvocationBinding({ roomId: source.roomId, runtimeEpochId: source.runtimeEpochId, activeBranchId: source.branchId } as AuthoritativeWorldState,
        source.sourceId, call.externalBinding!.invocationKey, call.externalBinding!.purpose, call.invocation.providerRequest);
      return { prepared_action_id: binding.bindingId, ordinal: stage.ordinal, context_hash: stage.contextHash,
        binding_hash: stage.bindingHash, request_hash: stage.requestHash, repair_ticket_json: stage.repairTicket === null ? null : JSON.stringify(stage.repairTicket),
        invocation_id: stage.invocationId, external_binding_json: JSON.stringify(external) };
    };
    for (const stage of payload.stages) snapshot.proofs.push(proofOf(stage));
    for (const { round, ...stage } of supersededStagesOf(payload) ?? []) snapshot.supersededProofs.push({ ...proofOf(stage), round });
    if ("settlement" in payload && payload.settlement?.kind === "cancelled") {
      snapshot.contexts.push({ prepared_action_id: binding.bindingId, context_kind: "narrationSettlement", context_json: JSON.stringify(payload.settlement) });
      for (const row of payload.settlement.submissions) add(snapshot.submissions, row, row => row.prepared_action_id);
    }
    if (payload.format === "zhuwei.story-cancelled-preparation-host/v1") continue;
    if (payload.format === "zhuwei.story-viewer-narration-host/v1" || payload.format === "zhuwei.story-viewer-narration-host/v2" || payload.format === "zhuwei.story-viewer-narration-host/v3") {
      snapshot.contexts.push({ prepared_action_id: binding.bindingId, context_kind: "narration", context_json: JSON.stringify(payload.narration) });
      if (payload.format === "zhuwei.story-viewer-narration-host/v3" && payload.settlement.kind !== "cancelled") {
        snapshot.contexts.push({ prepared_action_id: binding.bindingId, context_kind: "narrationSettlement", context_json: JSON.stringify(payload.settlement) });
      }
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
    if (!payload.settlement) add(snapshot.submissions, { ...row, prepared_json: JSON.stringify(prepared), continuation_json: continuation === null ? null : JSON.stringify(continuation) }, row => row.prepared_action_id);
    add(snapshot.scopes, { scope_id: row.scene_scope, version: payload.scopeVersion }, scope => scope.scope_id);
    if (payload.recovery !== null) snapshot.recoveries.push({ prepared_action_id: binding.bindingId, proposal_hash: payload.recovery.proposalHash,
      recovery_hash: payload.recovery.recoveryHash, recovery_json: JSON.stringify(payload.recovery.recovery) });
    for (const [kind, value] of [["npc", payload.npcContext], ["admission", payload.admissionInput], ["preparationModule", payload.moduleProfile]] as const) {
      if (value !== null) snapshot.contexts.push({ prepared_action_id: binding.bindingId, context_kind: kind, context_json: JSON.stringify(value) });
    }
  }
  const pendingRows = pendingPayloads.filter(payload => context.head.combatRuntime.pendingInputs[payload.pending.decision.pending_input_id] !== undefined)
    .map(payload => {
      const row = payload.pending.decision;
      const { scopeVersion, ...identity } = payload.owner;
      const original = snapshot.submissions.find(value => value.prepared_action_id === row.prepared_action_id);
      if (original !== undefined) {
        const host = bindings.find(value => value.bindingId === row.prepared_action_id);
        check(host !== undefined);
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
  store.restoreStoryArchiveHostSnapshot(snapshot);
  for (const row of pendingRows) store.restoreStoryNpcPendingDecision(row);
}
