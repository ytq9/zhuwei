import type {
  StoryCheckpoint, StoryContext, StoryFailureCode, StoryHash, StoryModelRequest,
  StoryPreparation, StoryReadDependency, StoryRecord, StoryRequest, StoryStage, StoryVersionRef,
} from "./story-creation/contracts";
import type { StoryAdmissionOwner, StoryLibraryEntry } from "./story-library-contracts";

/** Budget amounts are finite admission limits. Token/cost reservations are
 * estimates, not a claim about the provider's final invoice. */
export type StoryBudgetAmount = Readonly<{
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: number;
  elapsedMs: number;
}>;
export type StoryBudgetPolicy = Readonly<{
  policyRef: StoryVersionRef;
  roomAccountId: string;
  job: StoryBudgetAmount;
  source: StoryBudgetAmount;
  room: StoryBudgetAmount;
}>;
export type StoryInvocationReservation = Omit<StoryBudgetAmount, "calls">;
export type StoryMeasuredUsage = Readonly<{
  inputTokens?: number;
  outputTokens?: number;
  /** Only supplied when the trusted transport has actual billing evidence. */
  costMicros?: number;
}>;
export type StoryBudgetSnapshot = Readonly<{
  limits: StoryBudgetAmount;
  /** Measured usage, actual/possibly dispatched calls and elapsed duration. */
  spent: StoryBudgetAmount;
  /** Still reserved, including dimensions with unknown provider usage. */
  held: StoryBudgetAmount;
}>;
export type StoryStoreFailure = Readonly<{ kind: "rejected"; code: StoryFailureCode }>;
export type StoryJobSnapshot = Readonly<{
  request: StoryRequest;
  context: StoryContext;
  requestHash: StoryHash;
  modelRef: StoryVersionRef;
  budget: StoryBudgetPolicy;
  stageReservation: StoryInvocationReservation;
  checkpoint: StoryCheckpoint | null;
  usage: StoryBudgetSnapshot;
}>;
export type OpenStoryJob = Readonly<{
  request: StoryRequest;
  context: StoryContext;
  modelRef: StoryVersionRef;
  budget: StoryBudgetPolicy;
  /** Trusted transport upper bound for each stage. A mandatory author/review
   * pair is protected before either stage can consume the shared budget. */
  stageReservation: StoryInvocationReservation;
}>;
export type OpenStoryJobResult =
  | Readonly<{ kind: "opened"; job: StoryJobSnapshot; reused: boolean }>
  | StoryStoreFailure;
export type StoryCheckpointInput = Readonly<{ expectedRevision: number; next: StoryCheckpoint }>;
export type StoryCheckpointResult =
  | Readonly<{ ok: true; checkpoint: StoryCheckpoint }>
  | Readonly<{ ok: false; code: "STORY_CHECKPOINT_CONFLICT" }>;

export type StoryInvocationIdentity = Readonly<{ invocationId: string; capability: string }>;
export type StoryInvocationStatus = "reserved" | "started" | "completed" | "unknown" | "notSent" | "failed";
export type StoryInvocationSnapshot = Readonly<{
  invocationId: string;
  jobId: string | null;
  stage: StoryStage | null;
  attemptId: string;
  purpose: string;
  status: StoryInvocationStatus;
  requestHash: StoryHash;
  providerRequest: StoryRecord;
  modelRef: StoryVersionRef;
  eligible: boolean;
  response?: unknown;
  usage?: StoryMeasuredUsage;
  reservation: StoryInvocationReservation;
  startedAt: number | null;
  completedAt: number | null;
}>;
export type ReserveStoryInvocation = Readonly<{
  request: StoryModelRequest;
  /** Exact serialized provider body after the trusted transport codec. */
  providerRequest: StoryRecord;
  reservation: StoryInvocationReservation;
}>;
export type StoryInvocationResult =
  | Readonly<{ kind: "reserved"; invocationId: string; capability: string }>
  | Readonly<{ kind: "completed"; response: unknown }>
  | Readonly<{ kind: "waiting"; code: StoryFailureCode }>
  | StoryStoreFailure;
export type StartStoryInvocationResult =
  | Readonly<{ kind: "ready"; invocationId: string; capability: string; providerRequest: StoryRecord; modelRef: StoryVersionRef }>
  | Readonly<{ kind: "completed"; response: unknown }>
  | Readonly<{ kind: "waiting"; code: StoryFailureCode }>
  | StoryStoreFailure;
export type CompleteStoryInvocation = StoryInvocationIdentity & Readonly<{
  result:
    | Readonly<{ kind: "completed"; response: unknown; usage?: StoryMeasuredUsage }>
    | Readonly<{ kind: "unknown" | "failed"; usage?: StoryMeasuredUsage }>
    /** Host-only proof that no provider call occurred. A timeout is not proof. */
    | Readonly<{ kind: "notSent" }>;
}>;
export type CompleteStoryInvocationResult =
  | Readonly<{ kind: "saved"; eligible: boolean }>
  | StoryStoreFailure;

/** Only the authenticated host may assign these purposes and source bindings.
 * This accounts for existing calls; it does not authorize their execution. */
export type ReserveExternalStoryInvocation = Readonly<{
  source: StoryRequest["source"];
  roomAccountId: string;
  invocationKey: string;
  purpose: "proposal" | "narration" | "npc" | "context";
  modelRef: StoryVersionRef;
  providerRequest: StoryRecord;
  reservation: StoryInvocationReservation;
}>;
export type StoryExternalInvocationRead =
  | Readonly<{ kind: "found"; invocation: StoryInvocationSnapshot }>
  | Readonly<{ kind: "missing" }>
  | StoryStoreFailure;
export type StoryExternalInvocationBinding = ReserveExternalStoryInvocation & Readonly<{
  budget: StoryBudgetPolicy;
}>;
export type StoryExternalInvocationBeginResult =
  | Extract<StartStoryInvocationResult, { kind: "ready" }>
  | Readonly<{ kind: "completed"; invocationId: string; response: unknown }>
  | Readonly<{ kind: "waiting"; invocationId: string; code: StoryFailureCode }>
  | StoryStoreFailure;

/** Frozen before Rules commit. The host supplies the final canonical Rules
 * input hash and its complete transactional read set. This is a binding to a
 * reviewed candidate selection, never permission to append world facts. */
export type StoryAdmissionBindingInput = Readonly<{
  owner: StoryAdmissionOwner;
  /** Authorship provenance, not a claim that a historical job is active. */
  jobId: string;
  preparationHash: StoryHash;
  materialScopeHash: StoryHash;
  preparedActionId: string;
  contextHash: StoryHash;
  /** Original creation context on first admission; a separate current
   * context after reuse. The original artifact always remains unchanged. */
  validation: Readonly<{ request: StoryRequest; context: StoryContext }>;
  priorMappings: import("./story-library-contracts").StoryLibraryMappings;
  selectedMaterialRefs: readonly string[];
  readSet: readonly StoryReadDependency[];
  rulesInputHash: StoryHash;
}>;
export type StoryAdmissionBinding = StoryAdmissionBindingInput & Readonly<{ bindingHash: StoryHash }>;
export type StoryAdmissionBindingResult =
  | Readonly<{ kind: "saved"; binding: StoryAdmissionBinding }>
  | StoryStoreFailure;
/** Actual host-verified Rules references, not candidate identifiers copied
 * into a second fact store. The mapping has the Story History input shape. */
export type StoryAdmittedFactBinding = Readonly<{
  candidateRef: string;
  factRef: string;
  recordedByEventId: string;
  definitionRefs: readonly string[];
  knowledge: readonly Readonly<{
    candidateRef: string;
    holderRef: string;
    knowledgeRef: string;
    recordedByEventId: string;
  }>[];
}>;
export type StoryAdmittedDefinitionBinding = Readonly<{
  candidateRef: string;
  authorityRef: string;
  recordedByEventId: string;
  definitionRefs: readonly string[];
}>;
export type StoryAdmissionReceipt = Readonly<{
  owner: StoryAdmissionOwner;
  jobId: string;
  preparationHash: StoryHash;
  materialScopeHash: StoryHash;
  preparedActionId: string;
  receiptId: string;
  bindingHash: StoryHash;
  recordedAtEventSeq: string;
  definitions: readonly StoryAdmittedDefinitionBinding[];
  facts: readonly StoryAdmittedFactBinding[];
}>;
export type StoryAdmissionResult =
  | Readonly<{ kind: "saved"; admission: StoryAdmissionReceipt }>
  | StoryStoreFailure;

export type StoryHistoryMaterialSnapshot = Readonly<{
  preparations: readonly Readonly<{
    preparation: StoryPreparation;
    preparationHash: StoryHash;
    recordedAtEventSeq: string;
    definitions: readonly StoryAdmittedDefinitionBinding[];
    facts: readonly StoryAdmittedFactBinding[];
  }>[];
  requiredPreparationHashes: readonly StoryHash[];
}>;
export type StoryHistoryMaterialResult =
  | (Readonly<{ kind: "available" }> & StoryHistoryMaterialSnapshot)
  | StoryStoreFailure;

export type StoryStoreArchiveSource = Readonly<{ roomId: string; runtimeEpochId: string }>;
/** Derived by the trusted archive validator before same-room restoration.
 * Fences survive eviction without rewriting the archived invocation ledger. */
export type StoryStoreDispatchQuarantine = Readonly<{
  invocationIds: readonly string[];
  sourceBudgetAccountIds: readonly string[];
  enforcement?: "hostRequiredBeforeRestoreExposure";
}>;
/** Private same-room disaster recovery, including unfinished jobs, budget
 * holds and dispatch permits. This is broader than admitted history material:
 * only the trusted system archive may store it. Never use it as a Viewer
 * export or import it into a historical branch/new room or epoch. Provider
 * bodies contain exact model inputs, not transport headers or credentials. */
export type StoryStoreArchiveSnapshot = Readonly<{
  format: "zhuwei.story-store-archive/v1";
  source: StoryStoreArchiveSource;
  /** Immutable library evidence only; never historical jobs or call ledgers. */
  hostingArtifacts: readonly StoryLibraryEntry[];
  accounts: readonly Readonly<{
    accountId: string; scopeKey: string; kind: "job" | "source" | "room";
    binding: StoryRecord; limits: StoryBudgetAmount; spent: StoryBudgetAmount; held: StoryBudgetAmount;
  }>[];
  jobs: readonly Readonly<{
    input: OpenStoryJob; opportunityKey: string; identityHash: StoryHash; requestHash: StoryHash;
    checkpoint: StoryCheckpoint | null; unallocated: StoryBudgetAmount;
  }>[];
  invocations: readonly Readonly<{
    invocation: StoryInvocationSnapshot;
    invocationKey: string;
    externalBinding: ReserveExternalStoryInvocation | null;
    accountIds: readonly string[];
    spent: StoryBudgetAmount;
    held: StoryBudgetAmount;
    capability: string;
    leaseUntil: number | null;
    completionHash: StoryHash | null;
  }>[];
  admissionBindings: readonly StoryAdmissionBinding[];
  admissions: readonly StoryAdmissionReceipt[];
  /** Independent inventory detects missing preparation or admission rows. */
  materialManifest: readonly Readonly<{ preparationHash: StoryHash; jobId: string; owner: StoryAdmissionOwner }>[];
  snapshotHash: StoryHash;
}>;
export type StoryStoreArchiveResult =
  | Readonly<{ kind: "available"; snapshot: StoryStoreArchiveSnapshot }>
  | StoryStoreFailure;
export type StoryStoreRestoreResult =
  | Readonly<{ kind: "restored"; snapshotHash: StoryHash }>
  | StoryStoreFailure;
