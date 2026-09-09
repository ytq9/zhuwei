import type { StoryAdmissionReceipt, StoryAdmittedDefinitionBinding, StoryAdmittedFactBinding, StoryJobSnapshot } from "./story-creation-invocation";
import type { StoryContext, StoryHash, StoryPreparation, StoryRequest, StoryReview } from "./story-creation/contracts";
import type { StoryHistorySource } from "./story-history/contracts";

/** Immutable, reviewed hosting material. Its original source request/context
 * remain evidence of authorship; neither is a new job or a spending permit. */
export type StoryHostingArtifact = Readonly<{
  format: "zhuwei.story-hosting-artifact/v1";
  request: StoryRequest;
  context: StoryContext;
  preparation: StoryPreparation;
  review: StoryReview;
  preparationHash: StoryHash;
  artifactHash: StoryHash;
}>;

export type StoryLibraryRoom = Readonly<{ roomId: string; runtimeEpochId: string; branchId: string }>;
export type StoryAdmissionOwner =
  | Readonly<{ kind: "creationJob"; jobId: string }>
  | Readonly<{ kind: "hostingArtifact"; libraryRef: StoryHash }>;
export type StoryLibraryMappings = Readonly<{
  definitions: readonly StoryAdmittedDefinitionBinding[];
  facts: readonly StoryAdmittedFactBinding[];
}>;
export type StoryLibraryOrigin =
  | Readonly<{ kind: "creationJob"; jobId: string }>
  | Readonly<{ kind: "historicalSeed"; source: StoryHistorySource; seedHash: StoryHash;
      cutEventSeq: string; baseline: StoryLibraryMappings }>;

/** Only historical seed mappings are retained here, as immutable source
 * evidence. Current maps always come from the current Room's Rules receipts. */
export type StoryLibraryEntry = Readonly<{
  format: "zhuwei.story-library-entry/v1";
  room: StoryLibraryRoom;
  libraryRef: StoryHash;
  artifact: StoryHostingArtifact;
  origin: StoryLibraryOrigin;
  entryHash: StoryHash;
}>;

export type StoryLibraryOffer = Readonly<{
  libraryRef: StoryHash;
  opportunityId: string;
  owner: StoryAdmissionOwner;
  status: "preparing" | "ready" | "rejected" | "noStory";
  preparationHash: StoryHash | null;
  title: string;
  centralQuestion: string;
  sceneRefs: readonly string[];
  entityRefs: readonly string[];
}>;
export type StoryLibraryCatalog = Readonly<{
  format: "zhuwei.story-library-catalog/v1";
  room: StoryLibraryRoom;
  offers: readonly StoryLibraryOffer[];
  catalogHash: StoryHash;
}>;
export type StoryLibrarySnapshot = Readonly<{
  format: "zhuwei.story-library-snapshot/v1";
  room: StoryLibraryRoom;
  entries: readonly StoryLibraryEntry[];
  snapshotHash: StoryHash;
}>;

/** These are reads of the current Room's existing operational journal. No
 * adapter may mint a checkpoint, replace its source budget, or infer maps. */
export type StoryLibraryJournal = Readonly<{
  listCreationJobs(): readonly StoryJobSnapshot[];
  readCreationJob(jobId: string): StoryJobSnapshot | undefined;
  readAdmissions(owner: StoryAdmissionOwner): readonly StoryAdmissionReceipt[];
}>;
export type StoryLibraryFailureCode = "STORY_LIBRARY_UNAVAILABLE" | "STORY_LIBRARY_BINDING_INVALID"
  | "STORY_LIBRARY_MATERIALS_MISSING" | "STORY_CONTEXT_STALE" | "STORY_CONTEXT_INSUFFICIENT";
export type StoryLibraryRejection = Readonly<{ kind: "rejected"; code: StoryLibraryFailureCode }>;
export type StoryLibraryResolution =
  | Readonly<{ kind: "ready"; entry: StoryLibraryEntry; owner: StoryAdmissionOwner; mappings: StoryLibraryMappings }>
  | Readonly<{ kind: "resume"; owner: Extract<StoryAdmissionOwner, { kind: "creationJob" }>; job: StoryJobSnapshot }>
  | StoryLibraryRejection;

/** Frozen only after selecting an existing preparation. The source artifact
 * is kept byte-for-byte and the current validation context has its own full
 * read set. Neither a changed global version nor an old query witness alone
 * authorizes dropping the source's decisive constraints. */
export type StoryLibraryBinding = Readonly<{
  entry: StoryLibraryEntry;
  owner: StoryAdmissionOwner;
  mappings: StoryLibraryMappings;
  currentRequest: StoryRequest;
  currentContext: StoryContext;
  validationHash: StoryHash;
}>;
