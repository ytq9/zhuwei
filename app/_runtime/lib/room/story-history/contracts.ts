import type {
  AuthoritativeWorldState, EventEnvelope, RuntimeGenesis, RuntimeProfileManifest,
  replay,
} from "../../rules";
import type { AuthoritativeRoomArchive } from "../archive";
import type { ExperiencedTranscriptMessage } from "../authority-types";
import type {
  StoryFactCandidate, StoryFictionPoint, StoryHash, StoryKnowledgeCandidate,
  StoryPreparation, StoryRecord,
} from "../story-creation/contracts";

/** Constructed by the authenticated Room entry point. These fields never
 * establish access by themselves: every host read/verification reauthorizes. */
export type StoryHistoryAccess = Readonly<{
  principalId: string;
  authorizationVersion: string;
}>;
export type StoryHistorySource = Readonly<{
  roomId: string;
  runtimeEpochId: string;
  archiveHash: StoryHash;
  branchId: string;
}>;
export type StoryHistoryFailureCode =
  | "STORY_HISTORY_REQUEST_INVALID" | "STORY_HISTORY_SOURCE_UNAVAILABLE"
  | "STORY_HISTORY_ARCHIVE_INVALID" | "STORY_HISTORY_PROFILE_UNSUPPORTED"
  | "STORY_HISTORY_MATERIALS_MISSING" | "STORY_HISTORY_BINDING_INVALID"
  | "STORY_HISTORY_CUT_UNSUPPORTED" | "STORY_HISTORY_TIME_UNRESOLVED"
  | "STORY_HISTORY_IDENTITY_UNSUPPORTED" | "STORY_HISTORY_IDENTITY_CONFLICT"
  | "STORY_HISTORY_UNAVAILABLE";
export type StoryHistoryRejection = Readonly<{
  kind: "rejected";
  code: StoryHistoryFailureCode;
}>;
export type StoryHistoryRead<T> = Readonly<{
  kind: "available";
  /** Hash of the exact request supplied to this host operation. */
  authorizationBindingHash: StoryHash;
  value: T;
}> | StoryHistoryRejection;

export type StoryHistoryFactBinding = Readonly<{
  candidateRef: string;
  factRef: string;
  recordedByEventId: string;
  /** The host supplies the complete pinned definition closure for this fact. */
  definitionRefs: readonly string[];
  knowledge: readonly Readonly<{
    candidateRef: string;
    holderRef: string;
    knowledgeRef: string;
    recordedByEventId: string;
  }>[];
}>;
export type StoryHistoryPreparation = Readonly<{
  preparation: StoryPreparation;
  preparationHash: StoryHash;
  /** Receipt-backed Room storage position, not an invented world occurrence. */
  recordedAtEventSeq: string;
  facts: readonly StoryHistoryFactBinding[];
}>;
export type StoryHistorySourceMaterial = Readonly<{
  archive: AuthoritativeRoomArchive;
  preparations: readonly StoryHistoryPreparation[];
  /** The host enumerates required prepared materials even when some are lost. */
  requiredPreparationHashes: readonly StoryHash[];
}>;

export type StoryViewerExportRequest = Readonly<{
  kind: "viewer";
  access: StoryHistoryAccess;
  source: StoryHistorySource;
  characterId: string;
  cursor: string | null;
}>;
export type StorySystemExportRequest = Readonly<{
  kind: "system";
  access: StoryHistoryAccess;
  source: StoryHistorySource;
}>;
export type StoryExportRequest = StoryViewerExportRequest | StorySystemExportRequest;
export type StoryViewerExportMaterial = Readonly<{
  /** Already produced by the ordinary Viewer projector, never raw state. */
  readModel: StoryRecord;
  projectionHash: StoryHash;
  transcript: readonly ExperiencedTranscriptMessage[];
  nextCursor: string | null;
}>;
export type StoryViewerExport = Readonly<{
  format: "zhuwei.story-viewer-export/v1";
  source: StoryHistorySource;
  characterId: string;
  readModel: StoryRecord;
  projectionHash: StoryHash;
  transcript: readonly ExperiencedTranscriptMessage[];
  nextCursor: string | null;
  contentHash: StoryHash;
}>;
export type StorySystemExport = Readonly<{
  format: "zhuwei.story-system-export/v1";
  audience: "trustedSystemOnly";
  source: StoryHistorySource;
  archive: AuthoritativeRoomArchive;
  preparations: readonly StoryHistoryPreparation[];
  contentHash: StoryHash;
}>;

/** This first supported identity is a new world entity. Existing-character
 * control transfer needs its own Rules semantics; it must not clone an NPC or
 * silently convert an old player character into an NPC. The character payload
 * contains world/build data only and still crosses normal Rules validation. */
export type StoryBranchIdentity = Readonly<{
  kind: "newCharacter";
  characterId: string;
  sceneId: string;
  originBasisRefs: readonly string[];
  character: StoryRecord;
}>;
export type StoryHistoricalBranchRequest = Readonly<{
  access: StoryHistoryAccess;
  source: StoryHistorySource;
  cut: Readonly<{ eventSeq: string; focusSceneId: string }>;
  identity: StoryBranchIdentity;
}>;
export type StoryHistoricalKnowledge = Readonly<{
  candidate: StoryKnowledgeCandidate;
  record: AuthoritativeWorldState["knowledge"][string][string];
  recordedBy: EventEnvelope;
}>;
export type StoryHistoricalFact = Readonly<{
  preparationHash: StoryHash;
  /** The fact body; eligible knowledge is carried separately below. */
  candidate: Omit<StoryFactCandidate, "knowledge">;
  record: AuthoritativeWorldState["canonicalFacts"][string];
  recordedBy: EventEnvelope;
  definitions: AuthoritativeWorldState["campaignRuntime"]["definitions"];
  knowledge: readonly StoryHistoricalKnowledge[];
}>;
export type StoryHistoricalCut = Readonly<{
  eventSeq: string;
  eventHash: StoryHash;
  stateHash: StoryHash;
  branchId: string;
  focusSceneId: string;
  timelines: readonly StoryFictionPoint[];
  causalFrontiersHash: StoryHash;
}>;
export type StoryHistoricalVerification = Readonly<{
  request: StoryHistoricalBranchRequest;
  sourceArchive: AuthoritativeRoomArchive;
  sourceState: AuthoritativeWorldState;
  cut: StoryHistoricalCut;
  cutState: AuthoritativeWorldState;
  lateFacts: readonly StoryHistoricalFact[];
  /** Only preparations recorded by the cut are eligible as hosting material.
   * Later preparation contributes individually validated historical records. */
  preparations: readonly StoryHistoryPreparation[];
}>;
export type StoryHistoryVerified = Readonly<{
  kind: "verified";
  authorizationBindingHash: StoryHash;
  /** Hash of { purpose: historicalCut | newIdentity, contentHash }, where
   * contentHash covers the exact StoryHistoricalVerification below. */
  verificationHash: StoryHash;
}> | StoryHistoryRejection;
export type StoryBranchSeed = Readonly<{
  format: "zhuwei.story-branch-seed/v1";
  audience: "trustedSystemOnly";
  source: StoryHistorySource;
  sourceHead: AuthoritativeRoomArchive["head"];
  profiles: RuntimeProfileManifest;
  moduleRef: RuntimeGenesis["moduleRef"];
  sourceGenesis: RuntimeGenesis;
  prefixEvents: readonly EventEnvelope[];
  cut: StoryHistoricalCut;
  cutState: AuthoritativeWorldState;
  preparations: readonly StoryHistoryPreparation[];
  lateFacts: readonly StoryHistoricalFact[];
  identity: StoryBranchIdentity;
  /** Core initialization re-reads the pinned source when lateFacts are present:
   * individual event hashes are not a Merkle inclusion proof. No future event
   * stream, old control grant, delivery, or budget becomes new-room authority. */
  verification: Readonly<{
    authorizationBindingHash: StoryHash;
    cutVerificationHash: StoryHash;
    identityVerificationHash: StoryHash;
    lateFactsRequireSourceArchive: boolean;
  }>;
  seedHash: StoryHash;
}>;

export type StoryHistoryHost = Readonly<{
  replay: typeof replay;
  /** Reauthorize against the live principal/version and require the exact
   * source Module to be available. Unknown source and denied source share the
   * SOURCE_UNAVAILABLE rejection; no raw archive is exposed to the requester. */
  readSource(input: Readonly<{
    purpose: "systemExport" | "historicalBranch";
    request: StorySystemExportRequest | StoryHistoricalBranchRequest;
    authorizationBindingHash: StoryHash;
  }>): Promise<StoryHistoryRead<StoryHistorySourceMaterial>>;
  readViewerExport(input: Readonly<{
    request: StoryViewerExportRequest;
    authorizationBindingHash: StoryHash;
  }>): Promise<StoryHistoryRead<StoryViewerExportMaterial>>;
  /** Verify the exact module, transaction/correction/definition/causal closure,
   * supported Activities, and consistency of admitted temporal supplements.
   * A hash binds this trusted decision; it is not a semantic proof itself. */
  validateHistoricalCut(input: Readonly<{
    value: StoryHistoricalVerification;
    authorizationBindingHash: StoryHash;
    verificationHash: StoryHash;
  }>): Promise<StoryHistoryVerified>;
  /** Reauthorize, validate the normal build, legitimate origin and absence of
   * copied NPC identities/unique possessions. Existing control is never copied. */
  validateNewIdentity(input: Readonly<{
    value: StoryHistoricalVerification;
    authorizationBindingHash: StoryHash;
    verificationHash: StoryHash;
  }>): Promise<StoryHistoryVerified>;
}>;
export type StoryExportResult =
  | Readonly<{ kind: "viewerExportPrepared"; record: StoryViewerExport }>
  | Readonly<{ kind: "systemExportPrepared"; record: StorySystemExport }>
  | StoryHistoryRejection;
export type StoryHistoricalBranchResult =
  | Readonly<{ kind: "branchPrepared"; seed: StoryBranchSeed }>
  | StoryHistoryRejection;
