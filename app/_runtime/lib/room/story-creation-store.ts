import type {
  StoryCheckpoint, StoryFailureCode, StoryHash, StoryPreparation, StoryRecord, StoryRequest, StoryStage,
} from "./story-creation/contracts";
import type {
  CompleteStoryInvocation, CompleteStoryInvocationResult, OpenStoryJob, OpenStoryJobResult,
  ReserveExternalStoryInvocation, ReserveStoryInvocation, StartStoryInvocationResult,
  StoryAdmissionBinding, StoryAdmissionBindingInput, StoryAdmissionBindingResult,
  StoryAdmissionReceipt, StoryAdmissionResult, StoryAdmittedFactBinding, StoryBudgetAmount, StoryBudgetPolicy,
  StoryBudgetSnapshot, StoryCheckpointInput, StoryCheckpointResult, StoryInvocationIdentity,
  StoryInvocationReservation, StoryInvocationResult, StoryInvocationSnapshot,
  StoryInvocationStatus, StoryJobSnapshot, StoryMeasuredUsage, StoryStoreFailure,
  StoryExternalInvocationRead, StoryHistoryMaterialResult, StoryHistoryMaterialSnapshot,
  StoryStoreArchiveResult, StoryStoreArchiveSnapshot, StoryStoreArchiveSource, StoryStoreRestoreResult,
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
  usage_json: string | null; completion_hash: StoryHash | null; external_binding_json: string | null };
type AdmissionBindingRow = { prepared_action_id: string; binding_json: string };
type MaterialManifestRow = { preparation_hash: StoryHash; job_id: string };

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
        response_json TEXT, usage_json TEXT, completion_hash TEXT, external_binding_json TEXT
      );
      CREATE INDEX IF NOT EXISTS story_creation_invocations_job_idx ON story_creation_invocations(job_id, stage);
      CREATE TABLE IF NOT EXISTS story_creation_admissions (
        admission_key TEXT PRIMARY KEY, job_id TEXT NOT NULL, prepared_action_id TEXT NOT NULL UNIQUE,
        receipt_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS story_creation_admission_bindings (
        prepared_action_id TEXT PRIMARY KEY, binding_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS story_creation_material_manifest (
        preparation_hash TEXT PRIMARY KEY, job_id TEXT NOT NULL
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
      this.validateExternalBinding(input);
      const requestHash = this.hash(input), key = this.hash({ source: this.sourceKey(input.source), key: input.invocationKey });
      const existing = this.invocationByKey(key);
      if (existing !== undefined) return this.resumeReservation(existing, requestHash, input.reservation);
      return this.reserve({ key, jobId: null, stage: null, purpose: input.purpose, requestHash,
        providerRequest: input.providerRequest, modelRef: input.modelRef, reservation: input.reservation,
        accountIds: [input.source.budgetAccountId, input.roomAccountId], externalBinding: input });
    });
  }

  /** Lookup never grants a dispatch permit or changes an expired lease. A
   * saved protocol mapping can supply invocationId to reject cross-scope reads. */
  readExternalInvocation(input: ReserveExternalStoryInvocation, invocationId?: string): StoryExternalInvocationRead {
    return this.atomic<StoryExternalInvocationRead>(() => {
      this.validateExternalBinding(input);
      const key = this.hash({ source: this.sourceKey(input.source), key: input.invocationKey });
      const row = invocationId === undefined ? this.invocationByKey(key) : this.invocationRow(invocationId);
      if (row === undefined) return invocationId === undefined ? { kind: "missing" } : invalid();
      if (row.job_id !== null || row.invocation_key !== key || row.request_hash !== this.hash(input)
        || row.external_binding_json === null || this.hash(parse(row.external_binding_json)) !== this.hash(input)) invalid();
      return { kind: "found", invocation: this.readInvocation(row.invocation_id)! };
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

  prepareAdmission(input: StoryAdmissionBindingInput): StoryAdmissionBindingResult {
    return this.atomic<StoryAdmissionBindingResult>(() => {
      this.validateAdmissionBinding(input);
      const binding = { ...input, bindingHash: this.hash(input) };
      const previous = this.readAdmissionBinding(input.preparedActionId);
      if (previous !== undefined) {
        if (this.hash(previous) !== this.hash(binding)) invalid();
        return { kind: "saved", binding: previous };
      }
      this.storage.sql.exec(`INSERT INTO story_creation_admission_bindings
        (prepared_action_id, binding_json) VALUES (?, ?)`, input.preparedActionId, this.json(binding));
      return { kind: "saved", binding: structuredClone(binding) };
    });
  }

  readAdmissionBinding(preparedActionId: string): StoryAdmissionBinding | undefined {
    const row = this.storage.sql.exec<AdmissionBindingRow>(
      "SELECT * FROM story_creation_admission_bindings WHERE prepared_action_id = ?", preparedActionId).toArray()[0];
    return row === undefined ? undefined : parse(row.binding_json);
  }

  /** The host invokes this inside the same outer Room transaction that saves
   * the verified world Receipt. Nested SQLite writes roll back with that owner.
   * Callers must abort that transaction when this returns rejected. */
  recordAdmission(input: StoryAdmissionReceipt): StoryAdmissionResult {
    return this.atomic<StoryAdmissionResult>(() => {
      this.validateAdmissionReceipt(input);
      const key = this.admissionKey(input);
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
      const manifest = this.storage.sql.exec<MaterialManifestRow>(
        "SELECT * FROM story_creation_material_manifest WHERE preparation_hash = ?", input.preparationHash).toArray()[0];
      if (manifest !== undefined && manifest.job_id !== input.jobId) invalid();
      this.storage.sql.exec(`INSERT OR IGNORE INTO story_creation_material_manifest
        (preparation_hash, job_id) VALUES (?, ?)`, input.preparationHash, input.jobId);
      // A later scope may admit more knowledge about an existing candidate;
      // it cannot remap a candidate to another authoritative fact or event.
      this.historyMaterials();
      return { kind: "saved", admission: structuredClone(input) };
    });
  }

  readAdmissions(jobId: string): StoryAdmissionReceipt[] {
    return this.storage.sql.exec<{ receipt_json: string }>(
      "SELECT receipt_json FROM story_creation_admissions WHERE job_id = ? ORDER BY admission_key", jobId)
      .toArray().map(row => parse<StoryAdmissionReceipt>(row.receipt_json));
  }

  exportHistoryMaterials(): StoryHistoryMaterialResult {
    return this.atomic<StoryHistoryMaterialResult>(() => ({ kind: "available", ...this.historyMaterials() }));
  }

  archiveSnapshot(source: StoryStoreArchiveSource): StoryStoreArchiveResult {
    return this.atomic<StoryStoreArchiveResult>(() => {
      const snapshot = this.captureArchive(source);
      this.validateArchive(snapshot, source);
      this.historyMaterials();
      return { kind: "available", snapshot };
    });
  }

  /** Host authentication, Room emptiness, signed archive/head validation and
   * the outer restore transaction belong to the Room adapter. */
  restoreArchiveSnapshot(input: { source: StoryStoreArchiveSource; snapshot: StoryStoreArchiveSnapshot }): StoryStoreRestoreResult {
    return this.atomic<StoryStoreRestoreResult>(() => {
      if (!this.isEmpty()) invalid();
      this.validateArchive(input.snapshot, input.source);
      const snapshot = input.snapshot;
      for (const row of snapshot.accounts) {
        this.storage.sql.exec(`INSERT INTO story_creation_accounts
          (account_id, scope_key, kind, binding_json, limits_json, spent_json, held_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        row.accountId, row.scopeKey, row.kind, this.json(row.binding), this.json(row.limits), this.json(row.spent), this.json(row.held));
      }
      for (const row of snapshot.jobs) {
        const { request, budget } = row.input;
        this.storage.sql.exec(`INSERT INTO story_creation_jobs (job_id, opportunity_key, identity_hash, input_json,
          request_hash, checkpoint_json, account_id, source_account_id, room_account_id, unallocated_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, request.jobId, row.opportunityKey, row.identityHash,
        this.json(row.input), row.requestHash, row.checkpoint === null ? null : this.json(row.checkpoint),
        `story-job:${request.jobId}`, request.source.budgetAccountId, budget.roomAccountId, this.json(row.unallocated));
      }
      for (const row of snapshot.invocations) {
        const call = row.invocation;
        this.storage.sql.exec(`INSERT INTO story_creation_invocations (invocation_id, invocation_key, job_id, stage,
          attempt_id, purpose, request_hash, provider_request_json, model_ref_json, reservation_json, account_ids_json,
          spent_json, held_json, capability, status, eligible, started_at, lease_until, completed_at, response_json,
          usage_json, completion_hash, external_binding_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        call.invocationId, row.invocationKey, call.jobId, call.stage, call.attemptId, call.purpose, call.requestHash,
        this.json(call.providerRequest), this.json(call.modelRef), this.json(call.reservation), this.json(row.accountIds),
        this.json(row.spent), this.json(row.held), row.capability, call.status, call.eligible ? 1 : 0,
        call.startedAt, row.leaseUntil, call.completedAt, call.response === undefined ? null : this.json(call.response),
        call.usage === undefined ? null : this.json(call.usage), row.completionHash,
        row.externalBinding === null ? null : this.json(row.externalBinding));
      }
      for (const binding of snapshot.admissionBindings) {
        const { bindingHash, ...body } = binding;
        const result = this.prepareAdmission(body);
        if (result.kind !== "saved" || result.binding.bindingHash !== bindingHash) invalid();
      }
      // Restore the independent manifest before validating all receipts as a
      // whole. Missing data must never be reinterpreted as an empty history.
      for (const row of snapshot.materialManifest) this.storage.sql.exec(`INSERT INTO story_creation_material_manifest
        (preparation_hash, job_id) VALUES (?, ?)`, row.preparationHash, row.jobId);
      for (const receipt of snapshot.admissions) {
        this.validateAdmissionReceipt(receipt);
        this.storage.sql.exec(`INSERT INTO story_creation_admissions
          (admission_key, job_id, prepared_action_id, receipt_json) VALUES (?, ?, ?, ?)`,
        this.admissionKey(receipt), receipt.jobId, receipt.preparedActionId, this.json(receipt));
      }
      this.historyMaterials();
      // No replay of reserve/start/complete is permitted during restoration.
      if (this.captureArchive(input.source).snapshotHash !== snapshot.snapshotHash) invalid();
      return { kind: "restored", snapshotHash: snapshot.snapshotHash };
    });
  }

  isEmpty(): boolean {
    return this.storage.sql.exec<{ count: number }>(`SELECT
      (SELECT COUNT(*) FROM story_creation_accounts) + (SELECT COUNT(*) FROM story_creation_jobs)
      + (SELECT COUNT(*) FROM story_creation_invocations) + (SELECT COUNT(*) FROM story_creation_admissions)
      + (SELECT COUNT(*) FROM story_creation_admission_bindings) + (SELECT COUNT(*) FROM story_creation_material_manifest) AS count`).one().count === 0;
  }

  clearForRoomDeletion(): void {
    this.storage.transactionSync(() => this.storage.sql.exec(`DELETE FROM story_creation_material_manifest;
      DELETE FROM story_creation_admissions; DELETE FROM story_creation_admission_bindings;
      DELETE FROM story_creation_invocations; DELETE FROM story_creation_jobs; DELETE FROM story_creation_accounts;`));
  }

  private readyPreparation(jobId: string, preparationHash: StoryHash): StoryPreparation {
    const checkpoint = this.readJob(jobId)?.checkpoint;
    const preparation = checkpoint?.revisedDraft ?? checkpoint?.draft;
    if (checkpoint?.status !== "ready" || preparation === undefined
      || !reviewPassed(checkpoint.revisedReview ?? checkpoint.review) || this.hash(preparation) !== preparationHash) invalid();
    return preparation;
  }

  private validateAdmissionBinding(input: StoryAdmissionBindingInput): void {
    if (!exact(input, ["jobId", "preparationHash", "materialScopeHash", "preparedActionId", "contextHash",
      "selectedMaterialRefs", "readSet", "rulesInputHash"]) || !nonempty(input.preparedActionId)
      || !isHash(input.rulesInputHash) || !uniqueStrings(input.selectedMaterialRefs)
      || this.hash(input.selectedMaterialRefs) !== input.materialScopeHash || !Array.isArray(input.readSet)) invalid();
    const preparation = this.readyPreparation(input.jobId, input.preparationHash);
    const job = this.readJob(input.jobId)!;
    if (input.contextHash !== job.context.contextHash || preparation.contextHash !== input.contextHash) invalid();
    const candidates = new Set(materialRefs(preparation));
    const selected = new Set(input.selectedMaterialRefs);
    if (input.selectedMaterialRefs.some(ref => !candidates.has(ref))) invalid();
    for (const fact of preparation.facts) for (const knowledge of fact.knowledge) {
      if (selected.has(knowledge.ref) && !selected.has(fact.ref)) invalid();
    }
    for (const definition of preparation.definitions) if (selected.has(definition.ref)) {
      if (definition.dependsOn.some(ref => candidates.has(ref) && !selected.has(ref))) invalid();
    }
    const reads = new Map<string, StoryAdmissionBindingInput["readSet"][number]>();
    for (const read of input.readSet) {
      if (!exact(read, ["kind", "ref", "revision", "hash"]) || !nonempty(read.ref) || !nonempty(read.revision)
        || !isHash(read.hash) || !["entity", "collection", "fact", "knowledge", "narrativeCommitment", "timeline"].includes(read.kind)) invalid();
      const key = `${read.kind}:${read.ref}`;
      if (reads.has(key)) invalid();
      reads.set(key, read);
    }
    for (const required of job.context.readSet) {
      const supplied = reads.get(`${required.kind}:${required.ref}`);
      if (supplied === undefined || this.hash(required) !== this.hash(supplied)) invalid();
    }
  }

  private validateAdmissionReceipt(input: StoryAdmissionReceipt): void {
    if (!exact(input, ["jobId", "preparationHash", "materialScopeHash", "preparedActionId", "receiptId", "bindingHash",
      "recordedAtEventSeq", "facts"]) || !nonempty(input.receiptId) || !sequence(input.recordedAtEventSeq)
      || !Array.isArray(input.facts)) invalid();
    const binding = this.readAdmissionBinding(input.preparedActionId);
    if (binding === undefined || binding.bindingHash !== input.bindingHash || binding.jobId !== input.jobId
      || binding.preparationHash !== input.preparationHash || binding.materialScopeHash !== input.materialScopeHash) invalid();
    const { bindingHash, ...body } = binding;
    if (this.hash(body) !== bindingHash) invalid();
    this.validateAdmissionBinding(body);
    const preparation = this.readyPreparation(input.jobId, input.preparationHash);
    const selected = new Set(binding.selectedMaterialRefs);
    const facts = new Map(preparation.facts.map(fact => [fact.ref, fact]));
    const factRefs = new Set<string>(), knowledgeRefs = new Set<string>();
    const factTargets = new Set<string>(), knowledgeTargets = new Set<string>();
    for (const fact of input.facts) {
      if (!exact(fact, ["candidateRef", "factRef", "recordedByEventId", "definitionRefs", "knowledge"])
        || !nonempty(fact.factRef) || !nonempty(fact.recordedByEventId) || !uniqueStrings(fact.definitionRefs)
        || !Array.isArray(fact.knowledge) || factRefs.has(fact.candidateRef) || factTargets.has(fact.factRef)
        || !selected.has(fact.candidateRef)) invalid();
      const candidate = facts.get(fact.candidateRef);
      if (candidate === undefined) invalid();
      factRefs.add(fact.candidateRef); factTargets.add(fact.factRef);
      for (const knowledge of fact.knowledge) {
        if (!exact(knowledge, ["candidateRef", "holderRef", "knowledgeRef", "recordedByEventId"])
          || !nonempty(knowledge.knowledgeRef) || !nonempty(knowledge.recordedByEventId)
          || knowledgeRefs.has(knowledge.candidateRef) || knowledgeTargets.has(knowledge.knowledgeRef)
          || !selected.has(knowledge.candidateRef)) invalid();
        const proposed = candidate.knowledge.find(value => value.ref === knowledge.candidateRef);
        if (proposed === undefined || proposed.holderRef !== knowledge.holderRef || proposed.factRef !== candidate.ref) invalid();
        knowledgeRefs.add(knowledge.candidateRef); knowledgeTargets.add(knowledge.knowledgeRef);
      }
    }
    for (const fact of preparation.facts) {
      if (selected.has(fact.ref) !== factRefs.has(fact.ref)) invalid();
      for (const knowledge of fact.knowledge) if (selected.has(knowledge.ref) !== knowledgeRefs.has(knowledge.ref)) invalid();
    }
  }

  private admissionKey(input: StoryAdmissionReceipt): string {
    return this.hash({ jobId: input.jobId, preparationHash: input.preparationHash, materialScopeHash: input.materialScopeHash });
  }

  private historyMaterials(): StoryHistoryMaterialSnapshot {
    const manifest = this.storage.sql.exec<MaterialManifestRow>(
      "SELECT * FROM story_creation_material_manifest ORDER BY preparation_hash").toArray();
    const admissions = this.storage.sql.exec<{ receipt_json: string }>(
      "SELECT receipt_json FROM story_creation_admissions ORDER BY admission_key").toArray().map(row => parse<StoryAdmissionReceipt>(row.receipt_json));
    const required = new Set(manifest.map(row => row.preparation_hash));
    if (admissions.some(value => !required.has(value.preparationHash))) invalid("STORY_CONTEXT_INSUFFICIENT");
    const preparations: StoryHistoryMaterialSnapshot["preparations"][number][] = [];
    for (const row of manifest) {
      const job = this.readJob(row.job_id);
      const preparation = job?.checkpoint?.revisedDraft ?? job?.checkpoint?.draft;
      if (job?.checkpoint?.status !== "ready" || preparation === undefined || this.hash(preparation) !== row.preparation_hash) {
        invalid("STORY_CONTEXT_INSUFFICIENT");
      }
      const receipts = admissions.filter(receipt => receipt.preparationHash === row.preparation_hash);
      if (receipts.length === 0 || receipts.some(receipt => receipt.jobId !== row.job_id)) invalid("STORY_CONTEXT_INSUFFICIENT");
      for (const receipt of receipts) this.validateAdmissionReceipt(receipt);
      const merged = new Map<string, StoryAdmittedFactBinding>();
      for (const receipt of receipts) for (const fact of receipt.facts) {
        const previous = merged.get(fact.candidateRef);
        if (previous === undefined) { merged.set(fact.candidateRef, structuredClone(fact)); continue; }
        if (previous.factRef !== fact.factRef || previous.recordedByEventId !== fact.recordedByEventId
          || this.hash([...previous.definitionRefs].sort()) !== this.hash([...fact.definitionRefs].sort())) invalid();
        const knowledge = new Map(previous.knowledge.map(value => [value.candidateRef, value]));
        for (const value of fact.knowledge) {
          const prior = knowledge.get(value.candidateRef);
          if (prior !== undefined && this.hash(prior) !== this.hash(value)) invalid();
          knowledge.set(value.candidateRef, value);
        }
        merged.set(fact.candidateRef, { ...previous, knowledge: [...knowledge.values()].sort(byCandidate) });
      }
      const firstSeq = receipts.map(receipt => receipt.recordedAtEventSeq)
        .reduce((minimum, value) => BigInt(value) < BigInt(minimum) ? value : minimum);
      preparations.push({ preparation, preparationHash: row.preparation_hash, recordedAtEventSeq: firstSeq,
        facts: [...merged.values()].sort(byCandidate) });
    }
    return { preparations, requiredPreparationHashes: manifest.map(row => row.preparation_hash) };
  }

  private captureArchive(source: StoryStoreArchiveSource): StoryStoreArchiveSnapshot {
    const accounts = this.storage.sql.exec<AccountRow>("SELECT * FROM story_creation_accounts ORDER BY account_id").toArray()
      .map(row => ({ accountId: row.account_id, scopeKey: row.scope_key, kind: row.kind as "job" | "source" | "room",
        binding: parse<StoryRecord>(row.binding_json), limits: parse<StoryBudgetAmount>(row.limits_json),
        spent: parse<StoryBudgetAmount>(row.spent_json), held: parse<StoryBudgetAmount>(row.held_json) }));
    const jobs = this.storage.sql.exec<JobRow>("SELECT * FROM story_creation_jobs ORDER BY job_id").toArray()
      .map(row => ({ input: parse<OpenStoryJob>(row.input_json), opportunityKey: row.opportunity_key,
        identityHash: row.identity_hash as StoryHash, requestHash: row.request_hash,
        checkpoint: row.checkpoint_json === null ? null : parse<StoryCheckpoint>(row.checkpoint_json),
        unallocated: parse<StoryBudgetAmount>(row.unallocated_json) }));
    const invocations = this.storage.sql.exec<InvocationRow>("SELECT * FROM story_creation_invocations ORDER BY invocation_id").toArray()
      .map(row => ({ invocation: this.readInvocation(row.invocation_id)!, invocationKey: row.invocation_key,
        externalBinding: row.external_binding_json === null ? null : parse<ReserveExternalStoryInvocation>(row.external_binding_json),
        accountIds: parse<string[]>(row.account_ids_json), spent: parse<StoryBudgetAmount>(row.spent_json),
        held: parse<StoryBudgetAmount>(row.held_json), capability: row.capability,
        leaseUntil: row.lease_until, completionHash: row.completion_hash }));
    const admissionBindings = this.storage.sql.exec<AdmissionBindingRow>(
      "SELECT * FROM story_creation_admission_bindings ORDER BY prepared_action_id").toArray()
      .map(row => parse<StoryAdmissionBinding>(row.binding_json));
    const admissions = this.storage.sql.exec<{ receipt_json: string }>(
      "SELECT receipt_json FROM story_creation_admissions ORDER BY admission_key").toArray()
      .map(row => parse<StoryAdmissionReceipt>(row.receipt_json));
    const materialManifest = this.storage.sql.exec<MaterialManifestRow>(
      "SELECT * FROM story_creation_material_manifest ORDER BY preparation_hash").toArray()
      .map(row => ({ preparationHash: row.preparation_hash, jobId: row.job_id }));
    const unsigned = { format: "zhuwei.story-store-archive/v1" as const, source: structuredClone(source),
      accounts, jobs, invocations, admissionBindings, admissions, materialManifest };
    return { ...unsigned, snapshotHash: this.hash(unsigned) };
  }

  private validateArchive(snapshot: StoryStoreArchiveSnapshot, source: StoryStoreArchiveSource): void {
    if (!exact(source, ["roomId", "runtimeEpochId"]) || !nonempty(source.roomId) || !nonempty(source.runtimeEpochId)
      || !exact(snapshot, ["format", "source", "accounts", "jobs", "invocations", "admissionBindings", "admissions", "materialManifest", "snapshotHash"])
      || snapshot.format !== "zhuwei.story-store-archive/v1" || this.hash(snapshot.source) !== this.hash(source)
      || ![snapshot.accounts, snapshot.jobs, snapshot.invocations, snapshot.admissionBindings,
        snapshot.admissions, snapshot.materialManifest].every(Array.isArray)) invalid();
    const { snapshotHash, ...body } = snapshot;
    if (this.hash(body) !== snapshotHash) invalid();
    const accounts = new Map<string, StoryStoreArchiveSnapshot["accounts"][number]>();
    const scopeKeys = new Set<string>();
    const totals = new Map<string, { spent: Record<(typeof DIMENSIONS)[number], number>; held: Record<(typeof DIMENSIONS)[number], number> }>();
    for (const row of snapshot.accounts) {
      if (!exact(row, ["accountId", "scopeKey", "kind", "binding", "limits", "spent", "held"])
        || !nonempty(row.accountId) || !nonempty(row.scopeKey) || !["job", "source", "room"].includes(row.kind)
        || accounts.has(row.accountId) || scopeKeys.has(row.scopeKey)) invalid();
      this.validateAmount(row.limits); this.validateLedgerAmount(row.spent); this.validateLedgerAmount(row.held);
      accounts.set(row.accountId, row); scopeKeys.add(row.scopeKey);
      totals.set(row.accountId, { spent: { ...ZERO }, held: { ...ZERO } });
      if (row.kind === "room") {
        if (!exact(row.binding, ["roomId", "runtimeEpochId", "policyRef"])
          || row.binding.roomId !== source.roomId || row.binding.runtimeEpochId !== source.runtimeEpochId
          || row.scopeKey !== this.hash({ roomId: source.roomId, epoch: source.runtimeEpochId })) invalid();
      } else if (row.kind === "source") {
        if (!exact(row.binding, ["source", "policyRef", "roomAccountId"])) invalid();
        const bound = row.binding.source as StoryRequest["source"];
        this.validateSource(bound);
        if (bound.roomId !== source.roomId || bound.runtimeEpochId !== source.runtimeEpochId
          || bound.budgetAccountId !== row.accountId || row.scopeKey !== this.sourceKey(bound)) invalid();
      } else if (!exact(row.binding, ["identityHash", "policyRef"])) invalid();
    }
    for (const row of snapshot.accounts) if (row.kind === "source") {
      const room = accounts.get(String(row.binding.roomAccountId));
      if (room?.kind !== "room" || this.hash(room.binding.policyRef) !== this.hash(row.binding.policyRef)) invalid();
    }
    const add = (ids: readonly string[], spent: StoryBudgetAmount, held: StoryBudgetAmount) => {
      if (!uniqueStrings(ids)) invalid();
      this.validateLedgerAmount(spent); this.validateLedgerAmount(held);
      for (const id of ids) {
        const total = totals.get(id);
        if (total === undefined) invalid();
        for (const field of DIMENSIONS) {
          total.spent[field] += spent[field]; total.held[field] += held[field];
          if (!nonnegative(total.spent[field]) || !nonnegative(total.held[field])) invalid();
        }
      }
    };
    const jobs = new Map<string, StoryStoreArchiveSnapshot["jobs"][number]>(), opportunities = new Set<string>();
    for (const row of snapshot.jobs) {
      if (!exact(row, ["input", "opportunityKey", "identityHash", "requestHash", "checkpoint", "unallocated"])
        || !exact(row.input, ["request", "context", "modelRef", "budget", "stageReservation"])) invalid();
      const { request, context, budget, modelRef, stageReservation } = row.input;
      if (!record(request) || !record(context) || !record(budget)) invalid();
      this.validateSource(request.source);
      if (!nonempty(request.jobId) || !nonempty(request.opportunityId) || request.source.roomId !== source.roomId
        || request.source.runtimeEpochId !== source.runtimeEpochId || jobs.has(request.jobId)
        || opportunities.has(row.opportunityKey) || request.format !== "zhuwei.story-request/v1"
        || context.format !== "zhuwei.story-context/v1") invalid();
      this.validateAmount(budget.job); this.validateAmount(budget.source); this.validateAmount(budget.room);
      this.validateReservation(stageReservation); this.validateLedgerAmount(row.unallocated);
      const { jobId: _jobId, ...requestIdentity } = request, { contextHash, ...contextBody } = context;
      if (this.hash(contextBody) !== contextHash || this.hash(request) !== row.requestHash
        || this.hash(request.budgetPolicyRef) !== this.hash(budget.policyRef)
        || this.hash({ request: requestIdentity, context, budget, modelRef, stageReservation }) !== row.identityHash
        || row.opportunityKey !== this.hash({ roomId: source.roomId, epoch: source.runtimeEpochId,
          branch: request.source.branchId, opportunity: request.opportunityId })) invalid();
      const jobAccount = accounts.get(`story-job:${request.jobId}`), sourceAccount = accounts.get(request.source.budgetAccountId);
      const roomAccount = accounts.get(budget.roomAccountId);
      if (jobAccount?.kind !== "job" || jobAccount.scopeKey !== `job:${request.jobId}`
        || this.hash(jobAccount.binding) !== this.hash({ identityHash: row.identityHash, policyRef: budget.policyRef })
        || this.hash(jobAccount.limits) !== this.hash(budget.job) || sourceAccount?.kind !== "source"
        || this.hash(sourceAccount.binding) !== this.hash({ source: request.source, policyRef: budget.policyRef, roomAccountId: budget.roomAccountId })
        || this.hash(sourceAccount.limits) !== this.hash(budget.source) || roomAccount?.kind !== "room"
        || this.hash(roomAccount.limits) !== this.hash(budget.room)) invalid();
      if (row.checkpoint !== null) {
        const saved = row.checkpoint;
        if (!record(saved) || saved.format !== "zhuwei.story-checkpoint/v1" || saved.jobId !== request.jobId
          || saved.requestHash !== row.requestHash || saved.contextHash !== contextHash || !positive(saved.revision)
          || !["preparing", "ready", "noStory", "rejected"].includes(saved.status)) invalid();
        if (saved.status === "ready" && !reviewPassed(saved.revisedReview ?? saved.review)) invalid();
        if (saved.status !== "preparing" && this.hash(row.unallocated) !== this.hash(ZERO)) invalid();
        for (const [draft, review] of [[saved.draft, saved.review], [saved.revisedDraft, saved.revisedReview]] as const) {
          if (draft !== undefined && (draft.jobId !== request.jobId || draft.contextHash !== contextHash
            || draft.requestHash !== row.requestHash)) invalid();
          if (review !== undefined && (draft === undefined || review.preparationHash !== this.hash(draft)
            || review.contextHash !== contextHash)) invalid();
        }
      }
      jobs.set(request.jobId, row); opportunities.add(row.opportunityKey);
      add([jobAccount.accountId, sourceAccount.accountId, roomAccount.accountId], ZERO, row.unallocated);
    }
    for (const account of snapshot.accounts) if (account.kind === "job"
      && ![...jobs.keys()].some(id => account.accountId === `story-job:${id}`)) invalid();
    const invocationIds = new Set<string>(), invocationKeys = new Set<string>();
    for (const row of snapshot.invocations) {
      if (!exact(row, ["invocation", "invocationKey", "externalBinding", "accountIds", "spent", "held", "capability", "leaseUntil", "completionHash"])) invalid();
      const call = row.invocation;
      if (!exact(call, ["invocationId", "jobId", "stage", "attemptId", "purpose", "status", "requestHash", "providerRequest",
        "modelRef", "eligible", "reservation", "startedAt", "completedAt"], ["response", "usage"])
        || !nonempty(call.invocationId) || !nonempty(call.attemptId) || !nonempty(row.capability) || !nonempty(row.invocationKey)
        || invocationIds.has(call.invocationId) || invocationKeys.has(row.invocationKey) || typeof call.eligible !== "boolean"
        || !["reserved", "started", "completed", "unknown", "notSent", "failed"].includes(call.status)
        || !isHash(call.requestHash) || !(row.completionHash === null || isHash(row.completionHash))
        || ![call.startedAt, call.completedAt, row.leaseUntil].every(value => value === null || nonnegative(value))
        || !record(call.providerRequest) || !uniqueStrings(row.accountIds)) invalid();
      invocationIds.add(call.invocationId); invocationKeys.add(row.invocationKey);
      this.validateReservation(call.reservation); this.validateUsage(call.usage);
      const resolved = ["completed", "failed", "unknown"].includes(call.status);
      if ((call.status === "completed") !== Object.hasOwn(call, "response")
        || (resolved && (call.startedAt === null || call.completedAt === null || row.leaseUntil !== null))
        || (call.status === "reserved" && (call.startedAt !== null || call.completedAt !== null || row.leaseUntil !== null))
        || (call.status === "started" && (call.startedAt === null || call.completedAt !== null || row.leaseUntil === null))
        || (call.status === "notSent" && row.leaseUntil !== null)) invalid();
      if (call.jobId === null) {
        const bound = row.externalBinding;
        if (bound === null || !exact(bound, ["source", "roomAccountId", "invocationKey", "purpose", "modelRef", "providerRequest", "reservation"])) invalid();
        this.validateSource(bound.source);
        const account = accounts.get(bound.source.budgetAccountId);
        if (account?.kind !== "source" || this.hash(account.binding.source) !== this.hash(bound.source)
          || account.binding.roomAccountId !== bound.roomAccountId || call.stage !== null
          || !["proposal", "narration", "npc", "context"].includes(bound.purpose) || call.purpose !== bound.purpose
          || call.requestHash !== this.hash(bound) || this.hash(call.modelRef) !== this.hash(bound.modelRef)
          || this.hash(call.providerRequest) !== this.hash(bound.providerRequest)
          || this.hash(call.reservation) !== this.hash(bound.reservation)
          || row.invocationKey !== this.hash({ source: this.sourceKey(bound.source), key: bound.invocationKey })
          || this.hash(row.accountIds) !== this.hash([bound.source.budgetAccountId, bound.roomAccountId])) invalid();
      } else {
        const job = jobs.get(call.jobId);
        if (job === undefined || call.stage === null || !STAGES.includes(call.stage) || call.purpose !== call.stage
          || row.externalBinding !== null || row.invocationKey !== this.hash({ job: call.jobId, stage: call.stage })
          || this.hash(call.modelRef) !== this.hash(job.input.modelRef)
          || this.hash(row.accountIds) !== this.hash([`story-job:${call.jobId}`, job.input.request.source.budgetAccountId, job.input.budget.roomAccountId])) invalid();
      }
      // Validate the per-call settlement as well as the aggregate account sum.
      const expected = call.status === "reserved" ? { spent: ZERO, held: { ...call.reservation, calls: 1 } }
        : call.status === "started" ? { spent: { ...ZERO, calls: 1 }, held: { ...call.reservation, calls: 0 } }
        : call.status === "notSent" ? { spent: ZERO, held: ZERO }
        : this.settlement({ reservation_json: this.json(call.reservation), started_at: call.startedAt } as InvocationRow,
          call.usage, call.completedAt!);
      if (this.hash(row.spent) !== this.hash(expected.spent) || this.hash(row.held) !== this.hash(expected.held)) invalid();
      add(row.accountIds, row.spent, row.held);
    }
    for (const row of snapshot.accounts) if (this.hash(row.spent) !== this.hash(totals.get(row.accountId)!.spent)
      || this.hash(row.held) !== this.hash(totals.get(row.accountId)!.held)) invalid();
    if (!uniqueStrings(snapshot.admissionBindings.map(value => value?.preparedActionId))
      || !uniqueStrings(snapshot.admissions.map(value => value?.preparedActionId))
      || !uniqueStrings(snapshot.admissions.map(value => this.admissionKey(value)))
      || !uniqueStrings(snapshot.materialManifest.map(value => value?.preparationHash))) invalid();
    for (const value of snapshot.admissionBindings) {
      if (!record(value) || !jobs.has(value.jobId)) invalid("STORY_CONTEXT_INSUFFICIENT");
      const { bindingHash, ...unsigned } = value;
      if (!isHash(bindingHash) || this.hash(unsigned) !== bindingHash) invalid();
    }
    const manifest = new Map(snapshot.materialManifest.map(value => [value.preparationHash, value.jobId]));
    for (const value of snapshot.materialManifest) {
      if (!exact(value, ["preparationHash", "jobId"]) || !isHash(value.preparationHash) || !jobs.has(value.jobId)
        || !snapshot.admissions.some(receipt => receipt.preparationHash === value.preparationHash && receipt.jobId === value.jobId)) {
        invalid("STORY_CONTEXT_INSUFFICIENT");
      }
    }
    for (const receipt of snapshot.admissions) if (manifest.get(receipt.preparationHash) !== receipt.jobId
      || !snapshot.admissionBindings.some(binding => binding.preparedActionId === receipt.preparedActionId
        && binding.bindingHash === receipt.bindingHash)) invalid("STORY_CONTEXT_INSUFFICIENT");
  }

  private ensureBudget(source: StoryRequest["source"], budget: StoryBudgetPolicy): void {
    this.validateSource(source);
    if (!nonempty(budget.roomAccountId) || budget.roomAccountId === source.budgetAccountId) invalid();
    this.validateAmount(budget.job); this.validateAmount(budget.source); this.validateAmount(budget.room);
    this.ensureAccount(budget.roomAccountId, this.roomKey(source), "room",
      { roomId: source.roomId, runtimeEpochId: source.runtimeEpochId, policyRef: budget.policyRef }, budget.room);
    this.ensureAccount(source.budgetAccountId, this.sourceKey(source), "source",
      { source, policyRef: budget.policyRef, roomAccountId: budget.roomAccountId }, budget.source);
  }

  private validateExternalBinding(input: ReserveExternalStoryInvocation): void {
    if (!exact(input, ["source", "roomAccountId", "invocationKey", "purpose", "modelRef", "providerRequest", "reservation"])
      || !["proposal", "narration", "npc", "context"].includes(input.purpose) || !nonempty(input.invocationKey)) invalid();
    this.validateSource(input.source);
    this.validateReservation(input.reservation);
    const source = this.accountRow(input.source.budgetAccountId), room = this.accountRow(input.roomAccountId);
    if (source === undefined || room === undefined || source.scope_key !== this.sourceKey(input.source)
      || room.scope_key !== this.roomKey(input.source) || source.kind !== "source" || room.kind !== "room") invalid();
    const binding = parse<{ source: StoryRequest["source"]; roomAccountId: string }>(source.binding_json);
    if (binding.roomAccountId !== input.roomAccountId || this.hash(binding.source) !== this.hash(input.source)) invalid();
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
    accountIds: string[]; externalBinding?: ReserveExternalStoryInvocation }): StoryInvocationResult {
    this.validateReservation(input.reservation);
    const held = { ...input.reservation, calls: 1 };
    this.changeAccounts(input.accountIds, ZERO, ZERO, ZERO, held, true);
    const invocationId = this.newId(), capability = this.newId(), attemptId = this.newId();
    this.storage.sql.exec(`INSERT INTO story_creation_invocations (invocation_id, invocation_key, job_id, stage,
      attempt_id, purpose, request_hash, provider_request_json, model_ref_json, reservation_json, account_ids_json,
      spent_json, held_json, capability, status, eligible, external_binding_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', 1, ?)`,
    invocationId, input.key, input.jobId, input.stage, attemptId, input.purpose, input.requestHash,
    this.json(input.providerRequest), this.json(input.modelRef), this.json(input.reservation), this.json(input.accountIds),
    this.json(ZERO), this.json(held), capability, input.externalBinding === undefined ? null : this.json(input.externalBinding));
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
  private validateSource(source: StoryRequest["source"]): void {
    if (!exact(source, ["roomId", "runtimeEpochId", "branchId", "kind", "sourceId", "budgetAccountId"])
      || Object.values(source).some(value => !nonempty(value)) || !["playerAction", "worldEvent"].includes(source.kind)) invalid();
  }
  private validateLedgerAmount(amount: StoryBudgetAmount): void {
    if (!exact(amount, DIMENSIONS) || DIMENSIONS.some(field => !nonnegative(amount[field]))) invalid();
  }
  private validateAmount(amount: StoryBudgetAmount): void {
    if (!exact(amount, DIMENSIONS) || DIMENSIONS.some(field => !positive(amount[field]))) invalid();
  }
  private validateReservation(amount: StoryInvocationReservation): void {
    if (!exact(amount, DIMENSIONS.filter(field => field !== "calls"))
      || DIMENSIONS.filter(field => field !== "calls").some(field => !nonnegative(amount[field]))
      || !positive(amount.elapsedMs)) invalid();
  }
  private validateUsage(usage: StoryMeasuredUsage | undefined): void {
    if (usage !== undefined && Object.entries(usage).some(([key, value]) =>
      !["inputTokens", "outputTokens", "costMicros"].includes(key) || !nonnegative(value))) invalid();
  }
  private hash(value: unknown): StoryHash {
    try { return this.ports.hash(value); }
    catch (error) { if (error instanceof TypeError) invalid(); throw error; }
  }
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

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  return record(value) && keys.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => keys.includes(key) || optional.includes(key));
}
function uniqueStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(nonempty) && new Set(value).size === value.length;
}
function isHash(value: unknown): value is StoryHash {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}
function sequence(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
}
function byCandidate(a: { candidateRef: string }, b: { candidateRef: string }): number {
  return a.candidateRef < b.candidateRef ? -1 : a.candidateRef > b.candidateRef ? 1 : 0;
}
function materialRefs(preparation: StoryPreparation): string[] {
  return [...preparation.facts.flatMap(fact => [fact.ref, ...fact.knowledge.map(knowledge => knowledge.ref)]),
    ...[preparation.definitions, preparation.participants, preparation.opportunities, preparation.scenes,
      preparation.evidence, preparation.developments, preparation.resolutions, preparation.stages]
      .flatMap(values => values.map(value => value.ref))];
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
