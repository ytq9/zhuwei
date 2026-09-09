import type {
  StoryCheckpoint, StoryFailureCode, StoryHash, StoryRecord, StoryRequest, StoryStage,
} from "./story-creation/contracts";
import type {
  CompleteStoryInvocation, CompleteStoryInvocationResult, OpenStoryJob, OpenStoryJobResult,
  ReserveExternalStoryInvocation, ReserveStoryInvocation, StartStoryInvocationResult,
  StoryAdmissionReceipt, StoryAdmissionResult, StoryBudgetAmount, StoryBudgetPolicy,
  StoryBudgetSnapshot, StoryCheckpointInput, StoryCheckpointResult, StoryInvocationIdentity,
  StoryInvocationReservation, StoryInvocationResult, StoryInvocationSnapshot,
  StoryInvocationStatus, StoryJobSnapshot, StoryMeasuredUsage, StoryStoreFailure,
} from "./story-creation-invocation";

type AccountRow = { account_id: string; scope_key: string; kind: string; binding_json: string;
  limits_json: string; spent_json: string; held_json: string };
type JobRow = { job_id: string; opportunity_key: string; identity_hash: string; input_json: string;
  request_hash: StoryHash; checkpoint_json: string | null; account_id: string; source_account_id: string; room_account_id: string;
  unallocated_json: string };
type InvocationRow = { invocation_id: string; invocation_key: string; job_id: string | null; stage: StoryStage | null;
  attempt_id: string; purpose: string; request_hash: StoryHash; provider_request_json: string; model_ref_json: string;
  reservation_json: string; account_ids_json: string; spent_json: string; held_json: string;
  capability: string; status: StoryInvocationStatus; eligible: number; started_at: number | null;
  lease_until: number | null; completed_at: number | null; response_json: string | null;
  usage_json: string | null; completion_hash: StoryHash | null };

const DIMENSIONS = ["calls", "inputTokens", "outputTokens", "estimatedCostMicros", "elapsedMs"] as const;
const STAGES: readonly StoryStage[] = ["draft", "review", "revision", "revisionReview"];
const ZERO: StoryBudgetAmount = { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0, elapsedMs: 0 };
class StoreInputError extends Error {
  constructor(readonly code: StoryFailureCode) { super(code); }
}
function invalid(code: StoryFailureCode = "STORY_IDENTITY_CONFLICT"): never { throw new StoreInputError(code); }
const parse = <T>(value: string): T => JSON.parse(value) as T;
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const nonnegative = (value: number) => Number.isSafeInteger(value) && value >= 0;
const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** A host-owned operational journal in the Room's SQLite storage. It never
 * appends world events or determines knowledge, mechanics, or Viewer access. */
export class StoryCreationStore {
  constructor(private readonly storage: DurableObjectStorage, private readonly ports: {
    hash(value: unknown): StoryHash; now?: () => number; newId?: () => string;
  }) {}

  ensureSchema(): void {
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS story_creation_accounts (
        account_id TEXT PRIMARY KEY, scope_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
        binding_json TEXT NOT NULL, limits_json TEXT NOT NULL, spent_json TEXT NOT NULL, held_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS story_creation_jobs (
        job_id TEXT PRIMARY KEY, opportunity_key TEXT NOT NULL UNIQUE, identity_hash TEXT NOT NULL,
        input_json TEXT NOT NULL, request_hash TEXT NOT NULL, checkpoint_json TEXT,
        account_id TEXT NOT NULL, source_account_id TEXT NOT NULL, room_account_id TEXT NOT NULL,
        unallocated_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS story_creation_invocations (
        invocation_id TEXT PRIMARY KEY, invocation_key TEXT NOT NULL UNIQUE, job_id TEXT, stage TEXT,
        attempt_id TEXT NOT NULL, purpose TEXT NOT NULL, request_hash TEXT NOT NULL,
        provider_request_json TEXT NOT NULL, model_ref_json TEXT NOT NULL, reservation_json TEXT NOT NULL,
        account_ids_json TEXT NOT NULL, spent_json TEXT NOT NULL, held_json TEXT NOT NULL,
        capability TEXT NOT NULL, status TEXT NOT NULL, eligible INTEGER NOT NULL,
        started_at INTEGER, lease_until INTEGER, completed_at INTEGER,
        response_json TEXT, usage_json TEXT, completion_hash TEXT
      );
      CREATE INDEX IF NOT EXISTS story_creation_invocations_job_idx ON story_creation_invocations(job_id, stage);
      CREATE TABLE IF NOT EXISTS story_creation_admissions (
        admission_key TEXT PRIMARY KEY, job_id TEXT NOT NULL, prepared_action_id TEXT NOT NULL UNIQUE,
        receipt_json TEXT NOT NULL
      );
    `);
  }

  openBudget(input: { source: StoryRequest["source"]; budget: StoryBudgetPolicy }):
    { kind: "opened"; source: StoryBudgetSnapshot; room: StoryBudgetSnapshot } | StoryStoreFailure {
    return this.atomic<{ kind: "opened"; source: StoryBudgetSnapshot; room: StoryBudgetSnapshot }>(() => {
      this.ensureBudget(input.source, input.budget);
      return { kind: "opened", source: this.readBudget(input.source.budgetAccountId)!,
        room: this.readBudget(input.budget.roomAccountId)! };
    });
  }

  openJob(input: OpenStoryJob): OpenStoryJobResult {
    return this.atomic<OpenStoryJobResult>(() => {
      const { request, context, budget, stageReservation } = input;
      const ordinary = request.trigger.kind === "ordinaryResponse";
      if (request.format !== "zhuwei.story-request/v1" || context.format !== "zhuwei.story-context/v1"
        || !nonempty(request.jobId) || !nonempty(request.opportunityId)) invalid();
      const { contextHash, ...contextBody } = context;
      if (this.hash(contextBody) !== contextHash) invalid();
      if (!ordinary && context.missingRequiredRefs.length > 0) invalid("STORY_CONTEXT_INSUFFICIENT");
      if (this.hash(request.budgetPolicyRef) !== this.hash(budget.policyRef)) invalid();
      if (!ordinary && (budget.job.calls < 2 || budget.job.calls > 4)) invalid();
      this.validateAmount(budget.job); this.validateAmount(budget.source); this.validateAmount(budget.room);
      this.validateReservation(stageReservation);
      const { jobId: _jobId, ...requestIdentity } = request;
      const identityHash = this.hash({ request: requestIdentity, context, budget, modelRef: input.modelRef, stageReservation });
      const opportunityKey = this.hash({ roomId: request.source.roomId, epoch: request.source.runtimeEpochId,
        branch: request.source.branchId, opportunity: request.opportunityId });
      const existing = this.jobRow(request.jobId) ?? this.storage.sql.exec<JobRow>(
        "SELECT * FROM story_creation_jobs WHERE opportunity_key = ?", opportunityKey).toArray()[0];
      if (existing !== undefined) {
        if (existing.opportunity_key !== opportunityKey || existing.identity_hash !== identityHash) invalid();
        return { kind: "opened", job: this.snapshot(existing), reused: true };
      }
      this.ensureBudget(request.source, budget);
      this.ensureAccount(`story-job:${request.jobId}`, `job:${request.jobId}`, "job",
        { identityHash, policyRef: budget.policyRef }, budget.job);
      // Protect every dimension of draft + mandatory review atomically, so
      // another job or ordinary call cannot consume the review's allowance.
      const unallocated = ordinary ? ZERO : stageAmount(stageReservation, 2);
      this.changeAccounts([`story-job:${request.jobId}`, request.source.budgetAccountId, budget.roomAccountId],
        ZERO, ZERO, ZERO, unallocated, !ordinary);
      this.storage.sql.exec(`INSERT INTO story_creation_jobs
        (job_id, opportunity_key, identity_hash, input_json, request_hash, checkpoint_json,
         account_id, source_account_id, room_account_id, unallocated_json) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      request.jobId, opportunityKey, identityHash, this.json(input), this.hash(request),
      `story-job:${request.jobId}`, request.source.budgetAccountId, budget.roomAccountId, this.json(unallocated));
      return { kind: "opened", job: this.readJob(request.jobId)!, reused: false };
    });
  }

  readJob(jobId: string): StoryJobSnapshot | undefined {
    const row = this.jobRow(jobId);
    return row === undefined ? undefined : this.snapshot(row);
  }

  readBudget(accountId: string): StoryBudgetSnapshot | undefined {
    const row = this.accountRow(accountId);
    return row === undefined ? undefined : { limits: parse(row.limits_json), spent: parse(row.spent_json), held: parse(row.held_json) };
  }

  checkpoint(input: StoryCheckpointInput): StoryCheckpointResult {
    const result = this.atomic(() => {
      const { expectedRevision, next } = input, row = this.jobRow(next.jobId);
      if (row === undefined) invalid("STORY_CHECKPOINT_CONFLICT");
      const previous = row.checkpoint_json === null ? null : parse<StoryCheckpoint>(row.checkpoint_json);
      if (previous !== null && this.hash(previous) === this.hash(next)) return { ok: true as const, checkpoint: previous };
      const job = this.snapshot(row);
      if (!nonnegative(expectedRevision) || !positive(next.revision) || next.revision !== expectedRevision + 1
        || (previous?.revision ?? 0) !== expectedRevision || next.requestHash !== row.request_hash
        || next.contextHash !== job.context.contextHash || next.format !== "zhuwei.story-checkpoint/v1"
        || (previous !== null && previous.status !== "preparing")) invalid("STORY_CHECKPOINT_CONFLICT");
      const fields = ["draft", "review", "revisedDraft", "revisedReview"] as const;
      for (let index = 0; index < fields.length; index++) {
        const field = fields[index], old = previous?.[field], value = next[field];
        if (old !== undefined && (value === undefined || this.hash(old) !== this.hash(value))) invalid("STORY_CHECKPOINT_CONFLICT");
        if (old === undefined && value !== undefined) {
          const invocation = this.stageInvocation(next.jobId, STAGES[index]);
          if (invocation?.status !== "completed" || invocation.eligible !== 1) invalid("STORY_CHECKPOINT_CONFLICT");
        }
      }
      for (const draft of [next.draft, next.revisedDraft]) {
        if (draft !== undefined && (draft.jobId !== next.jobId || draft.requestHash !== next.requestHash
          || draft.contextHash !== next.contextHash)) invalid("STORY_CHECKPOINT_CONFLICT");
      }
      for (const [draft, review] of [[next.draft, next.review], [next.revisedDraft, next.revisedReview]] as const) {
        if (review !== undefined && (draft === undefined || review.contextHash !== next.contextHash
          || review.preparationHash !== this.hash(draft))) invalid("STORY_CHECKPOINT_CONFLICT");
      }
      if (next.status === "ready" && !reviewPassed(next.revisedReview ?? next.review)) invalid("STORY_CHECKPOINT_CONFLICT");
      this.storage.sql.exec("UPDATE story_creation_jobs SET checkpoint_json = ? WHERE job_id = ?", this.json(next), next.jobId);
      if (next.status !== "preparing") {
        this.rebookJob(row, ZERO);
        // A reserved call has never received a dispatch permit. Closing its
        // checkpoint can safely release it; dispatched/unknown costs remain.
        for (const pending of this.storage.sql.exec<InvocationRow>(
          "SELECT * FROM story_creation_invocations WHERE job_id = ? AND status = 'reserved'", next.jobId).toArray()) {
          this.rebook(pending, ZERO, ZERO);
          this.storage.sql.exec("UPDATE story_creation_invocations SET status = 'notSent' WHERE invocation_id = ?", pending.invocation_id);
        }
        this.storage.sql.exec(`UPDATE story_creation_invocations SET eligible = 0
          WHERE job_id = ? AND status <> 'completed'`, next.jobId);
      }
      return { ok: true as const, checkpoint: structuredClone(next) };
    });
    return "kind" in result ? { ok: false, code: "STORY_CHECKPOINT_CONFLICT" } : result;
  }

  reserveInvocation(input: ReserveStoryInvocation): StoryInvocationResult {
    return this.atomic<StoryInvocationResult>(() => {
      const { request } = input, row = this.jobRow(request.jobId);
      if (row === undefined || !STAGES.includes(request.stage)) invalid();
      const job = this.snapshot(row);
      if (request.requestHash !== row.request_hash || request.contextHash !== job.context.contextHash) invalid();
      if (job.request.trigger.kind === "ordinaryResponse") invalid("STORY_CHECKPOINT_CONFLICT");
      this.validateReservation(input.reservation);
      if (DIMENSIONS.some(field => field !== "calls" && input.reservation[field] > job.stageReservation[field])) invalid("STORY_BUDGET_EXHAUSTED");
      const requestHash = this.hash({ request, providerRequest: input.providerRequest, modelRef: job.modelRef });
      const key = this.hash({ job: request.jobId, stage: request.stage });
      const existing = this.invocationByKey(key);
      if (existing !== undefined) return this.resumeReservation(existing, requestHash, input.reservation);
      if (!stageAllowed(job.checkpoint, request.stage)) invalid("STORY_CHECKPOINT_CONFLICT");
      let unallocated = parse<StoryBudgetAmount>(row.unallocated_json);
      if (request.stage === "revision") {
        if (DIMENSIONS.some(field => unallocated[field] !== 0)) invalid("STORY_CHECKPOINT_CONFLICT");
        unallocated = stageAmount(job.stageReservation, 2);
        this.rebookJob(row, unallocated, true);
      }
      const remaining = { ...unallocated }, stage = stageAmount(job.stageReservation, 1);
      for (const field of DIMENSIONS) {
        remaining[field] -= stage[field];
        if (!nonnegative(remaining[field])) invalid("STORY_CHECKPOINT_CONFLICT");
      }
      this.rebookJob({ ...row, unallocated_json: this.json(unallocated) }, remaining);
      return this.reserve({ key, jobId: request.jobId, stage: request.stage, purpose: request.stage,
        requestHash, providerRequest: input.providerRequest, modelRef: job.modelRef, reservation: input.reservation,
        accountIds: [row.account_id, row.source_account_id, row.room_account_id] });
    });
  }

  reserveExternalInvocation(input: ReserveExternalStoryInvocation): StoryInvocationResult {
    return this.atomic<StoryInvocationResult>(() => {
      if (!["proposal", "narration", "npc", "context"].includes(input.purpose) || !nonempty(input.invocationKey)) invalid();
      const source = this.accountRow(input.source.budgetAccountId), room = this.accountRow(input.roomAccountId);
      if (source === undefined || room === undefined || source.scope_key !== this.sourceKey(input.source)
        || room.scope_key !== this.roomKey(input.source) || source.kind !== "source" || room.kind !== "room") invalid();
      const sourceBinding = parse<{ roomAccountId: string }>(source.binding_json);
      if (sourceBinding.roomAccountId !== input.roomAccountId) invalid();
      const requestHash = this.hash(input), key = this.hash({ source: this.sourceKey(input.source), key: input.invocationKey });
      const existing = this.invocationByKey(key);
      if (existing !== undefined) return this.resumeReservation(existing, requestHash, input.reservation);
      return this.reserve({ key, jobId: null, stage: null, purpose: input.purpose, requestHash,
        providerRequest: input.providerRequest, modelRef: input.modelRef, reservation: input.reservation,
        accountIds: [input.source.budgetAccountId, input.roomAccountId] });
    });
  }

  startInvocation(input: StoryInvocationIdentity): StartStoryInvocationResult {
    return this.atomic<StartStoryInvocationResult>(() => {
      const row = this.ownedInvocation(input);
      if (row.status !== "reserved") return this.resumeResult(row);
      if (!this.currentlyEligible(row)) invalid("STORY_CHECKPOINT_CONFLICT");
      const now = this.now(), reserve = parse<StoryInvocationReservation>(row.reservation_json);
      const leaseUntil = now + reserve.elapsedMs;
      if (!Number.isSafeInteger(leaseUntil)) invalid();
      this.rebook(row, { ...ZERO, calls: 1 }, { ...reserve, calls: 0 });
      this.storage.sql.exec(`UPDATE story_creation_invocations SET status = 'started', started_at = ?, lease_until = ?
        WHERE invocation_id = ?`, now, leaseUntil, row.invocation_id);
      return { kind: "ready", invocationId: row.invocation_id, capability: row.capability,
        providerRequest: parse<StoryRecord>(row.provider_request_json), modelRef: parse(row.model_ref_json) };
    });
  }

  completeInvocation(input: CompleteStoryInvocation): CompleteStoryInvocationResult {
    return this.atomic<CompleteStoryInvocationResult>(() => {
      const row = this.ownedInvocation(input), completionHash = this.hash(input.result);
      if (!["completed", "unknown", "failed", "notSent"].includes(input.result.kind)) invalid();
      if (row.completion_hash === completionHash) return { kind: "saved", eligible: row.eligible === 1 };
      const result = input.result;
      const supplement = (row.status === "completed" || row.status === "failed") && result.kind === row.status;
      if (row.status !== "started" && !(row.status === "unknown" && result.kind === "completed") && !supplement) invalid();
      if (supplement && result.kind === "completed" && this.hash(parse(row.response_json!)) !== this.hash(result.response)) invalid();
      const reportedUsage = "usage" in result ? result.usage : undefined;
      this.validateUsage(reportedUsage);
      const priorUsage = row.usage_json === null ? undefined : parse<StoryMeasuredUsage>(row.usage_json);
      for (const dimension of ["inputTokens", "outputTokens", "costMicros"] as const) {
        if (priorUsage?.[dimension] !== undefined && reportedUsage?.[dimension] !== undefined
          && priorUsage[dimension] !== reportedUsage[dimension]) invalid();
      }
      // A later response can fill unknown dimensions, never erase or revise
      // the provider measurements already preserved for this invocation.
      const usage = priorUsage === undefined && reportedUsage === undefined
        ? undefined : { ...priorUsage, ...reportedUsage };
      if (supplement && this.hash(priorUsage ?? {}) === this.hash(usage ?? {})) {
        return { kind: "saved", eligible: row.eligible === 1 };
      }
      // Billing evidence may arrive after a checkpoint has moved on. It does
      // not change dispatch eligibility, response, duration, or call count.
      const completedAt = supplement ? row.completed_at : this.now();
      if (completedAt === null) invalid();
      const eligible = supplement ? row.eligible === 1 : this.currentlyEligible(row);
      if (result.kind === "notSent") {
        this.rebook(row, ZERO, ZERO);
      } else {
        const { spent, held } = this.settlement(row, usage, completedAt);
        this.rebook(row, spent, held);
      }
      if (result.kind === "failed" && row.job_id !== null) this.rebookJob(this.jobRow(row.job_id)!, ZERO);
      this.storage.sql.exec(`UPDATE story_creation_invocations SET status = ?, eligible = ?, completed_at = ?,
        lease_until = NULL, response_json = ?, usage_json = ?, completion_hash = ? WHERE invocation_id = ?`,
      result.kind, eligible ? 1 : 0, completedAt, result.kind === "completed" ? this.json(result.response) : null,
      usage === undefined ? null : this.json(usage), completionHash, row.invocation_id);
      return { kind: "saved", eligible };
    });
  }

  readInvocation(invocationId: string): StoryInvocationSnapshot | undefined {
    const row = this.invocationRow(invocationId);
    return row === undefined ? undefined : { invocationId: row.invocation_id, jobId: row.job_id, stage: row.stage,
      attemptId: row.attempt_id, purpose: row.purpose, status: row.status, requestHash: row.request_hash,
      providerRequest: parse(row.provider_request_json), modelRef: parse(row.model_ref_json), eligible: row.eligible === 1,
      reservation: parse(row.reservation_json), startedAt: row.started_at, completedAt: row.completed_at,
      ...(row.response_json === null ? {} : { response: parse(row.response_json) }),
      ...(row.usage_json === null ? {} : { usage: parse(row.usage_json) }) };
  }

  /** The host invokes this inside the same outer Room transaction that saves
   * the verified world Receipt. Nested SQLite writes roll back with that owner. */
  recordAdmission(input: StoryAdmissionReceipt): StoryAdmissionResult {
    return this.atomic<StoryAdmissionResult>(() => {
      const job = this.readJob(input.jobId);
      if (job?.checkpoint?.status !== "ready" || !nonempty(input.preparedActionId)
        || !nonempty(input.receiptId) || !nonempty(input.materialScopeHash)
        || this.hash(job.checkpoint.revisedDraft ?? job.checkpoint.draft) !== input.preparationHash) invalid();
      const key = this.hash({ jobId: input.jobId, preparationHash: input.preparationHash, materialScopeHash: input.materialScopeHash });
      const previous = this.storage.sql.exec<{ admission_key: string; receipt_json: string }>(
        "SELECT admission_key, receipt_json FROM story_creation_admissions WHERE admission_key = ? OR prepared_action_id = ?",
        key, input.preparedActionId).toArray()[0];
      if (previous !== undefined) {
        if (previous.admission_key !== key || this.hash(parse(previous.receipt_json)) !== this.hash(input)) invalid();
        return { kind: "saved", admission: parse<StoryAdmissionReceipt>(previous.receipt_json) };
      }
      this.storage.sql.exec(`INSERT INTO story_creation_admissions
        (admission_key, job_id, prepared_action_id, receipt_json) VALUES (?, ?, ?, ?)`,
      key, input.jobId, input.preparedActionId, this.json(input));
      return { kind: "saved", admission: structuredClone(input) };
    });
  }

  readAdmissions(jobId: string): StoryAdmissionReceipt[] {
    return this.storage.sql.exec<{ receipt_json: string }>(
      "SELECT receipt_json FROM story_creation_admissions WHERE job_id = ? ORDER BY admission_key", jobId)
      .toArray().map(row => parse<StoryAdmissionReceipt>(row.receipt_json));
  }

  isEmpty(): boolean {
    return this.storage.sql.exec<{ count: number }>(`SELECT
      (SELECT COUNT(*) FROM story_creation_accounts) + (SELECT COUNT(*) FROM story_creation_jobs)
      + (SELECT COUNT(*) FROM story_creation_invocations) + (SELECT COUNT(*) FROM story_creation_admissions) AS count`).one().count === 0;
  }

  clearForRoomDeletion(): void {
    this.storage.transactionSync(() => this.storage.sql.exec(`DELETE FROM story_creation_admissions;
      DELETE FROM story_creation_invocations; DELETE FROM story_creation_jobs; DELETE FROM story_creation_accounts;`));
  }

  private ensureBudget(source: StoryRequest["source"], budget: StoryBudgetPolicy): void {
    if (Object.values(source).some(value => !nonempty(value)) || !["playerAction", "worldEvent"].includes(source.kind)
      || !nonempty(budget.roomAccountId) || budget.roomAccountId === source.budgetAccountId) invalid();
    this.validateAmount(budget.job); this.validateAmount(budget.source); this.validateAmount(budget.room);
    this.ensureAccount(budget.roomAccountId, this.roomKey(source), "room", { policyRef: budget.policyRef }, budget.room);
    this.ensureAccount(source.budgetAccountId, this.sourceKey(source), "source",
      { policyRef: budget.policyRef, roomAccountId: budget.roomAccountId }, budget.source);
  }

  private ensureAccount(id: string, scopeKey: string, kind: string, binding: unknown, limits: StoryBudgetAmount): void {
    this.validateAmount(limits);
    const row = this.storage.sql.exec<AccountRow>(
      "SELECT * FROM story_creation_accounts WHERE account_id = ? OR scope_key = ?", id, scopeKey).toArray()[0];
    if (row !== undefined) {
      if (row.account_id !== id || row.scope_key !== scopeKey || row.kind !== kind
        || this.hash(parse(row.binding_json)) !== this.hash(binding) || this.hash(parse(row.limits_json)) !== this.hash(limits)) invalid();
      return;
    }
    this.storage.sql.exec(`INSERT INTO story_creation_accounts
      (account_id, scope_key, kind, binding_json, limits_json, spent_json, held_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, scopeKey, kind, this.json(binding), this.json(limits), this.json(ZERO), this.json(ZERO));
  }

  private reserve(input: { key: string; jobId: string | null; stage: StoryStage | null; purpose: string;
    requestHash: StoryHash; providerRequest: StoryRecord; modelRef: unknown; reservation: StoryInvocationReservation;
    accountIds: string[] }): StoryInvocationResult {
    this.validateReservation(input.reservation);
    const held = { ...input.reservation, calls: 1 };
    this.changeAccounts(input.accountIds, ZERO, ZERO, ZERO, held, true);
    const invocationId = this.newId(), capability = this.newId(), attemptId = this.newId();
    this.storage.sql.exec(`INSERT INTO story_creation_invocations (invocation_id, invocation_key, job_id, stage,
      attempt_id, purpose, request_hash, provider_request_json, model_ref_json, reservation_json, account_ids_json,
      spent_json, held_json, capability, status, eligible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', 1)`,
    invocationId, input.key, input.jobId, input.stage, attemptId, input.purpose, input.requestHash,
    this.json(input.providerRequest), this.json(input.modelRef), this.json(input.reservation), this.json(input.accountIds),
    this.json(ZERO), this.json(held), capability);
    return { kind: "reserved", invocationId, capability };
  }

  private resumeReservation(row: InvocationRow, requestHash: StoryHash, reservation: StoryInvocationReservation): StoryInvocationResult {
    if (row.request_hash !== requestHash || this.hash(parse(row.reservation_json)) !== this.hash(reservation)) invalid();
    if (row.status === "notSent") {
      if (!this.currentlyEligible(row)) invalid("STORY_CHECKPOINT_CONFLICT");
      this.rebook(row, ZERO, { ...reservation, calls: 1 }, true);
      const capability = this.newId();
      this.storage.sql.exec(`UPDATE story_creation_invocations SET status = 'reserved', capability = ?,
        started_at = NULL, completed_at = NULL, completion_hash = NULL WHERE invocation_id = ?`, capability, row.invocation_id);
      return { kind: "reserved", invocationId: row.invocation_id, capability };
    }
    if (row.status === "reserved") {
      if (!this.currentlyEligible(row)) invalid("STORY_CHECKPOINT_CONFLICT");
      return { kind: "reserved", invocationId: row.invocation_id, capability: row.capability };
    }
    return this.resumeResult(row);
  }

  private resumeResult(row: InvocationRow): Exclude<StoryInvocationResult, { kind: "reserved" }> {
    if (row.status === "completed") return row.eligible === 1
      ? { kind: "completed", response: parse(row.response_json!) }
      : { kind: "rejected", code: "STORY_CHECKPOINT_CONFLICT" };
    if (row.status === "started" && row.lease_until !== null && row.lease_until > this.now()) {
      return { kind: "waiting", code: "STORY_INVOCATION_PENDING" };
    }
    if (row.status === "started") {
      const now = this.now(), { spent, held } = this.settlement(row, undefined, now);
      this.rebook(row, spent, held);
      this.storage.sql.exec(`UPDATE story_creation_invocations SET status = 'unknown', completed_at = ?, lease_until = NULL
        WHERE invocation_id = ?`, now, row.invocation_id);
      return { kind: "waiting", code: "STORY_INVOCATION_UNKNOWN" };
    }
    return row.status === "unknown" ? { kind: "waiting", code: "STORY_INVOCATION_UNKNOWN" }
      : { kind: "rejected", code: "STORY_PROVIDER_FAILED" };
  }

  private settlement(row: InvocationRow, usage: StoryMeasuredUsage | undefined, now: number):
    { spent: StoryBudgetAmount; held: StoryBudgetAmount } {
    const reservation = parse<StoryInvocationReservation>(row.reservation_json);
    const elapsedMs = Math.max(0, now - (row.started_at ?? now));
    if (!nonnegative(elapsedMs)) invalid();
    return { spent: { calls: 1, inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0,
      estimatedCostMicros: usage?.costMicros ?? 0, elapsedMs },
    held: { calls: 0, inputTokens: usage?.inputTokens === undefined ? reservation.inputTokens : 0,
      outputTokens: usage?.outputTokens === undefined ? reservation.outputTokens : 0,
      estimatedCostMicros: usage?.costMicros === undefined ? reservation.estimatedCostMicros : 0, elapsedMs: 0 } };
  }

  private currentlyEligible(row: InvocationRow): boolean {
    if (row.eligible !== 1) return false;
    if (row.job_id === null) return true;
    const job = this.readJob(row.job_id);
    return job !== undefined && row.stage !== null && stageAllowed(job.checkpoint, row.stage);
  }

  private rebook(row: InvocationRow, spent: StoryBudgetAmount, held: StoryBudgetAmount, limit = false): void {
    this.changeAccounts(parse(row.account_ids_json), parse(row.spent_json), parse(row.held_json), spent, held, limit);
    this.storage.sql.exec("UPDATE story_creation_invocations SET spent_json = ?, held_json = ? WHERE invocation_id = ?",
      this.json(spent), this.json(held), row.invocation_id);
  }

  private rebookJob(row: JobRow, held: StoryBudgetAmount, limit = false): void {
    this.changeAccounts([row.account_id, row.source_account_id, row.room_account_id], ZERO,
      parse(row.unallocated_json), ZERO, held, limit);
    this.storage.sql.exec("UPDATE story_creation_jobs SET unallocated_json = ? WHERE job_id = ?", this.json(held), row.job_id);
  }

  private changeAccounts(ids: string[], oldSpent: StoryBudgetAmount, oldHeld: StoryBudgetAmount,
    spent: StoryBudgetAmount, held: StoryBudgetAmount, limit: boolean): void {
    if (new Set(ids).size !== ids.length) invalid();
    for (const id of ids) {
      const row = this.accountRow(id);
      if (row === undefined) invalid();
      const priorSpent = parse<StoryBudgetAmount>(row.spent_json), priorHeld = parse<StoryBudgetAmount>(row.held_json);
      const limits = parse<StoryBudgetAmount>(row.limits_json), nextSpent = { ...ZERO }, nextHeld = { ...ZERO };
      for (const field of DIMENSIONS) {
        nextSpent[field] = priorSpent[field] - oldSpent[field] + spent[field];
        nextHeld[field] = priorHeld[field] - oldHeld[field] + held[field];
        if (!nonnegative(nextSpent[field]) || !nonnegative(nextHeld[field])
          || !Number.isSafeInteger(nextSpent[field] + nextHeld[field])) invalid();
        if (limit && nextSpent[field] + nextHeld[field] > limits[field]) invalid("STORY_BUDGET_EXHAUSTED");
      }
      this.storage.sql.exec("UPDATE story_creation_accounts SET spent_json = ?, held_json = ? WHERE account_id = ?",
        this.json(nextSpent), this.json(nextHeld), id);
    }
  }

  private ownedInvocation(input: StoryInvocationIdentity): InvocationRow {
    const row = this.invocationRow(input.invocationId);
    if (row === undefined || row.capability !== input.capability) invalid();
    return row;
  }
  private jobRow(id: string): JobRow | undefined {
    return this.storage.sql.exec<JobRow>("SELECT * FROM story_creation_jobs WHERE job_id = ?", id).toArray()[0];
  }
  private accountRow(id: string): AccountRow | undefined {
    return this.storage.sql.exec<AccountRow>("SELECT * FROM story_creation_accounts WHERE account_id = ?", id).toArray()[0];
  }
  private invocationRow(id: string): InvocationRow | undefined {
    return this.storage.sql.exec<InvocationRow>("SELECT * FROM story_creation_invocations WHERE invocation_id = ?", id).toArray()[0];
  }
  private invocationByKey(key: string): InvocationRow | undefined {
    return this.storage.sql.exec<InvocationRow>("SELECT * FROM story_creation_invocations WHERE invocation_key = ?", key).toArray()[0];
  }
  private stageInvocation(jobId: string, stage: StoryStage): InvocationRow | undefined {
    return this.invocationByKey(this.hash({ job: jobId, stage }));
  }
  private snapshot(row: JobRow): StoryJobSnapshot {
    const input = parse<OpenStoryJob>(row.input_json);
    return { ...input, requestHash: row.request_hash, checkpoint: row.checkpoint_json === null ? null : parse(row.checkpoint_json),
      usage: this.readBudget(row.account_id)! };
  }
  private sourceKey(source: StoryRequest["source"]): string {
    return this.hash({ roomId: source.roomId, epoch: source.runtimeEpochId, branch: source.branchId,
      kind: source.kind, sourceId: source.sourceId });
  }
  private roomKey(source: StoryRequest["source"]): string {
    return this.hash({ roomId: source.roomId, epoch: source.runtimeEpochId });
  }
  private validateAmount(amount: StoryBudgetAmount): void {
    if (DIMENSIONS.some(field => !positive(amount[field]))) invalid();
  }
  private validateReservation(amount: StoryInvocationReservation): void {
    if (DIMENSIONS.filter(field => field !== "calls").some(field => !nonnegative(amount[field]))
      || !positive(amount.elapsedMs)) invalid();
  }
  private validateUsage(usage: StoryMeasuredUsage | undefined): void {
    if (usage !== undefined && Object.entries(usage).some(([key, value]) =>
      !["inputTokens", "outputTokens", "costMicros"].includes(key) || !nonnegative(value))) invalid();
  }
  private hash(value: unknown): StoryHash { return this.ports.hash(value); }
  private json(value: unknown): string {
    this.hash(value);
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") invalid();
    return serialized;
  }
  private now(): number {
    const now = (this.ports.now ?? Date.now)();
    if (!nonnegative(now)) invalid();
    return now;
  }
  private newId(): string { return (this.ports.newId ?? (() => crypto.randomUUID()))(); }
  private atomic<T>(operation: () => T): T | StoryStoreFailure {
    try { return this.storage.transactionSync(operation); }
    catch (error) { if (error instanceof StoreInputError) return { kind: "rejected", code: error.code }; throw error; }
  }
}

function stageAmount(reservation: StoryInvocationReservation, calls: number): StoryBudgetAmount {
  return { calls, inputTokens: calls * reservation.inputTokens, outputTokens: calls * reservation.outputTokens,
    estimatedCostMicros: calls * reservation.estimatedCostMicros, elapsedMs: calls * reservation.elapsedMs };
}

function reviewPassed(review: StoryCheckpoint["review"]): boolean {
  return review !== undefined && review.findings.length > 0
    && review.findings.every(finding => finding.verdict === "pass")
    && review.recipeCriteria.every(criterion => criterion.verdict === "pass");
}
function allowsRevision(review: StoryCheckpoint["review"]): boolean {
  const findings = review?.findings.filter(finding => finding.verdict !== "pass") ?? [];
  return findings.length > 0 && findings.every(finding => finding.repairable);
}
function stageAllowed(checkpoint: StoryCheckpoint | null, stage: StoryStage): boolean {
  if (checkpoint !== null && checkpoint.status !== "preparing") return false;
  switch (stage) {
    case "draft": return checkpoint?.draft === undefined;
    case "review": return checkpoint?.draft !== undefined && checkpoint.review === undefined;
    case "revision": return allowsRevision(checkpoint?.review) && checkpoint?.revisedDraft === undefined;
    case "revisionReview": return checkpoint?.revisedDraft !== undefined && checkpoint.revisedReview === undefined;
  }
}
