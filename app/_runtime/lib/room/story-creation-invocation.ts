import type {
  StoryCheckpoint, StoryContext, StoryFailureCode, StoryHash, StoryModelRequest,
  StoryRecord, StoryRequest, StoryStage, StoryVersionRef,
} from "./story-creation/contracts";

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
  checkpoint: StoryCheckpoint | null;
  usage: StoryBudgetSnapshot;
}>;
export type OpenStoryJob = Readonly<{
  request: StoryRequest;
  context: StoryContext;
  modelRef: StoryVersionRef;
  budget: StoryBudgetPolicy;
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
export type StoryAdmissionReceipt = Readonly<{
  jobId: string;
  preparationHash: StoryHash;
  materialScopeHash: StoryHash;
  preparedActionId: string;
  receiptId: string;
}>;
export type StoryAdmissionResult =
  | Readonly<{ kind: "saved"; admission: StoryAdmissionReceipt }>
  | StoryStoreFailure;
