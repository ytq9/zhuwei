/** Private Room Action contract. None of these materials grants world writes
 * or is safe to send to a player without the ordinary Viewer projection. */
export type StoryHash = `sha256:${string}`;
export type StoryJson = null | boolean | number | string | StoryJson[] | { [key: string]: StoryJson };
export type StoryRecord = { [key: string]: StoryJson };
export type StoryVersionRef = Readonly<{ id: string; version: string; hash: StoryHash }>;
export type StoryFictionPoint = Readonly<{ timelineId: string; micros: string }>;
export type StoryReadDependency = Readonly<{
  kind: "entity" | "collection" | "fact" | "knowledge" | "narrativeCommitment" | "timeline";
  ref: string;
  revision: string;
  hash: StoryHash;
}>;

export type StoryRequest = Readonly<{
  format: "zhuwei.story-request/v1";
  jobId: string;
  opportunityId: string;
  source: Readonly<{
    roomId: string; runtimeEpochId: string; branchId: string;
    kind: "playerAction" | "worldEvent";
    sourceId: string;
    budgetAccountId: string;
  }>;
  trigger: Readonly<{
    kind: "developGoal" | "causalDevelopment" | "continuePreparation" | "ordinaryResponse";
    goal: string;
    basisRefs: readonly string[];
  }>;
  scale: "vignette" | "short" | "long";
  connection: "mainStory" | "local" | "personal";
  methods: readonly string[];
  scope: Readonly<{ sceneIds: readonly string[]; entityIds: readonly string[] }>;
  recipeRefs: readonly StoryVersionRef[];
  workflowRef: StoryVersionRef;
  budgetPolicyRef: StoryVersionRef;
}>;

export type StoryContextMaterial = Readonly<{
  ref: string;
  kind: "anchor" | "fact" | "npc" | "location" | "knowledge" | "relationship" | "plan" | "promise" | "narrativeCommitment" | "definition" | "contentBoundary";
  availability: "known" | "scopedAbsent" | "open" | "explicitlyUnknown" | "ambiguous" | "unavailable";
  /** An authorized snapshot, never instructions or an authority patch. */
  content: StoryJson;
  subjectRefs: readonly string[];
  basisRefs: readonly string[];
}>;

export type StoryContext = Readonly<{
  format: "zhuwei.story-context/v1";
  runtimeRef: StoryVersionRef;
  moduleRef: StoryVersionRef;
  materials: readonly StoryContextMaterial[];
  readSet: readonly StoryReadDependency[];
  timelines: readonly StoryFictionPoint[];
  supportedCapabilities: readonly string[];
  /** Missing decisive material blocks before any call; it is not an empty world. */
  missingRequiredRefs: readonly string[];
  contextHash: StoryHash;
}>;

export type StoryRecipe = Readonly<{
  ref: StoryVersionRef;
  dimension: "method" | "scale" | "connection" | "focus";
  instructions: string;
  requiredMaterialKinds: readonly StoryContextMaterial["kind"][];
  requiredCapabilities: readonly string[];
  reviewCriteria: readonly string[];
  excludes: readonly string[];
}>;

/** occurrence and acquisition are independent. A later record of an old event
 * cannot backdate a hearer's knowledge. Uncomparable timelines fail closed. */
export type StoryTemporalBasis = Readonly<{
  kind: "at" | "between" | "before";
  start: StoryFictionPoint;
  end: StoryFictionPoint | null;
  basisRefs: readonly string[];
}>;
export type StoryKnowledgeCandidate = Readonly<{
  ref: string;
  holderRef: string;
  factRef: string;
  layer: "truth" | "sensoryEvidence" | "sourceClaim" | "inference";
  content: string;
  sourceRef: string;
  acquisition: StoryTemporalBasis;
  explanation: string;
}>;
export type StoryFactCandidate = Readonly<{
  ref: string;
  layer: "worldTruth" | "statement";
  content: string;
  subjectRefs: readonly string[];
  occurrence: StoryTemporalBasis;
  basisRefs: readonly string[];
  /** Open historical space need not contain a pre-existing synonym. */
  creationBasis: "existingEvidence" | "authorizedOpenSpace";
  knowledge: readonly StoryKnowledgeCandidate[];
}>;

export type StoryParticipant = Readonly<{
  ref: string;
  identity: "existing" | "new";
  label: string;
  participationReason: string;
  goal: string;
  concerns: readonly string[];
  resources: readonly string[];
  relationships: readonly Readonly<{ otherRef: string; description: string; basisRefs: readonly string[] }>[];
  knowledgeRefs: readonly string[];
  nextIntention: string;
  voice: string;
}>;

/** Executable definitions stay in the host's declared capability vocabulary.
 * The host parses each payload through its normal proposal/Rules consumers. */
export type StoryDefinitionCandidate = Readonly<{
  ref: string;
  kind: "npc" | "location" | "passage" | "sceneFeature" | "item" | "hazard" | "ability";
  capability: string;
  payload: StoryRecord;
  dependsOn: readonly string[];
}>;
export type StoryScene = Readonly<{
  ref: string;
  locationRef: string;
  question: string;
  space: string;
  interactables: readonly Readonly<{ ref: string; description: string; definitionRefs: readonly string[] }>[];
  pressure: string;
  exitConditions: readonly string[];
  participation: string;
}>;
export type StoryEvidence = Readonly<{
  ref: string;
  conclusion: string;
  requiredForProgress: boolean;
  sources: readonly Readonly<{ ref: string; independenceBasis: string; access: string; basisRefs: readonly string[] }>[];
  corroboration: string;
  failureAlternatives: string;
}>;
export type StoryDevelopment = Readonly<{
  ref: string;
  actorRef: string;
  intention: string;
  trigger: string;
  basisRefs: readonly string[];
  knowledgeRefs: readonly string[];
  observableTraces: readonly string[];
  changeConditions: readonly string[];
  /** This is a proposed plan, not a committed future outcome. */
  execution: "pendingWorldAdjudication";
}>;

export type StoryPreparation = Readonly<{
  format: "zhuwei.story-preparation/v1";
  jobId: string;
  version: "1" | "2";
  requestHash: StoryHash;
  contextHash: StoryHash;
  recipeRefs: readonly StoryVersionRef[];
  title: string;
  cause: string;
  centralQuestion: string;
  worldConnection: string;
  existingFactRefs: readonly string[];
  facts: readonly StoryFactCandidate[];
  participants: readonly StoryParticipant[];
  definitions: readonly StoryDefinitionCandidate[];
  opportunities: readonly Readonly<{ ref: string; contact: string; understandableStake: string; basisRefs: readonly string[] }>[];
  scenes: readonly StoryScene[];
  evidence: readonly StoryEvidence[];
  developments: readonly StoryDevelopment[];
  resolutions: readonly Readonly<{ ref: string; condition: string; result: string; persistentConsequences: readonly string[] }>[];
  stages: readonly Readonly<{ ref: string; question: string; result: string; continuation: string; stoppingPoint: string }>[];
  /** Explain absent categories instead of inventing content to fill a form. */
  notApplicable: readonly Readonly<{ path: string; reason: string }>[];
  hostingNotes: string;
}>;

export type StoryReviewFinding = Readonly<{
  category: "completeness" | "worldConsistency" | "knowledge" | "playability" | "mechanics" | "playerAgency";
  verdict: "pass" | "conflict" | "uncertain";
  candidatePaths: readonly string[];
  constraintRefs: readonly string[];
  explanation: string;
  repairable: boolean;
}>;
export type StoryReview = Readonly<{
  format: "zhuwei.story-review/v1";
  preparationHash: StoryHash;
  contextHash: StoryHash;
  findings: readonly StoryReviewFinding[];
  recipeCriteria: readonly Readonly<{ recipeId: string; criterion: string; verdict: "pass" | "conflict" | "uncertain"; explanation: string }>[];
}>;
export type StoryStage = "draft" | "review" | "revision" | "revisionReview";
export type StoryFailureCode =
  | "STORY_CONTEXT_INSUFFICIENT" | "STORY_CONTEXT_STALE" | "STORY_BUDGET_EXHAUSTED"
  | "STORY_RECIPE_UNAVAILABLE" | "STORY_RECIPE_CONFLICT" | "STORY_CAPABILITY_UNSUPPORTED"
  | "STORY_OUTPUT_INVALID" | "STORY_REVIEW_REJECTED" | "STORY_REVISION_EXHAUSTED"
  | "STORY_INVOCATION_PENDING" | "STORY_INVOCATION_UNKNOWN" | "STORY_PROVIDER_FAILED"
  | "STORY_IDENTITY_CONFLICT" | "STORY_CHECKPOINT_CONFLICT";

/** Private evidence of a failed structural inspection. candidateHash names
 * the host-bound candidate reconstructed from the saved invocation response; it is
 * not a usable draft, world fact, review verdict or player-facing message. */
export type StoryInspectionFailure = Readonly<{
  stage: "draft" | "revision";
  candidateHash: StoryHash;
  findings: readonly StoryReviewFinding[];
}>;

export type StoryCheckpoint = Readonly<{
  format: "zhuwei.story-checkpoint/v1";
  jobId: string;
  revision: number;
  requestHash: StoryHash;
  contextHash: StoryHash;
  status: "preparing" | "ready" | "noStory" | "rejected";
  /** Persist each immutable draft/review before proceeding to the next call. */
  draft?: StoryPreparation;
  review?: StoryReview;
  revisedDraft?: StoryPreparation;
  revisedReview?: StoryReview;
  failureCode?: StoryFailureCode;
  inspectionFailure?: StoryInspectionFailure;
}>;
export type StoryModelRequest = Readonly<{
  jobId: string;
  stage: StoryStage;
  requestHash: StoryHash;
  contextHash: StoryHash;
  /** One closed tool. The host owns the model binding and transport. */
  toolName: string;
  schema: StoryRecord;
  messages: readonly Readonly<{ role: "system" | "user"; content: string }>[];
}>;
export type StoryInvocationOutcome =
  | Readonly<{ kind: "completed"; response: unknown }>
  | Readonly<{ kind: "waiting" | "rejected"; code: StoryFailureCode }>;
export type StoryCreationPorts = Readonly<{
  recipes: readonly StoryRecipe[];
  hash(value: unknown): StoryHash;
  invoke(request: StoryModelRequest): Promise<StoryInvocationOutcome>;
  saveCheckpoint(expectedRevision: number, next: StoryCheckpoint): Promise<
    { ok: true; checkpoint: StoryCheckpoint } | { ok: false; code: "STORY_CHECKPOINT_CONFLICT" }>;
}>;
export type StoryPreparationResult =
  | Readonly<{ kind: "ready"; preparation: StoryPreparation; review: StoryReview; checkpoint: StoryCheckpoint }>
  | Readonly<{ kind: "noStory"; checkpoint: StoryCheckpoint }>
  | Readonly<{ kind: "waiting" | "rejected"; code: StoryFailureCode; checkpoint: StoryCheckpoint | null }>;
