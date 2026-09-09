import type { AuthoritativeWorldState, RuntimeProfileManifest } from "../rules";
import type { VersionedRulesRuntime } from "../rules/v2-runtime";
import type { AuthoritativeRoomArchive } from "./archive";
import type { AuthoritativeCharacterSeed, ExperiencedTranscriptMessage, TrustedPrincipalContext } from "./authority-types";
import type { StoryHash, StoryRecord } from "./story-creation/contracts";
import type { StoryHistoryApiFailure, StoryHistoricalStartsInput, StoryHistoricalStartsResult,
  StoryViewerPageInput, StoryViewerPageResult } from "./story-history-api-types";
import type { StoryBranchSeed, StoryHistorySource } from "./story-history/contracts";
import type { StoryHistorySnapshot } from "./story-history-sessions";

export type StoryHistoryAuthorized = Readonly<{
  kind: "authorized";
  state: AuthoritativeWorldState;
  profiles: RuntimeProfileManifest;
  principalId: string;
  /** Includes the trusted session and relevant seat/control authorization. */
  authorizationVersion: string;
}>;
export type StoryHistoryViewer = Readonly<{
  kind: "viewed";
  characterId: string;
  viewerKey: string;
  readModel: StoryRecord;
  projectionHash: StoryHash;
}>;
export type StoryHistoryTranscriptRange = Readonly<{
  afterOrdinal: number;
  throughOrdinal: number;
  limit: number;
}>;
export type RoomStoryHistoryPorts = Readonly<{
  authorize(context: TrustedPrincipalContext): StoryHistoryAuthorized | StoryHistoryApiFailure;
  /** Uses the ordinary current/former-character Viewer projector. */
  viewer(context: TrustedPrincipalContext, characterId?: string): StoryHistoryViewer | StoryHistoryApiFailure;
  /** Trusted metadata only; Viewer export never reads the private snapshot. */
  sourceMetadata(): Promise<StoryHistorySource | StoryHistoryApiFailure>;
  readSnapshot(): Promise<StoryHistorySnapshot | StoryHistoryApiFailure>;
  experiencedMessagesUpperOrdinal(viewerKey: string): number;
  experiencedMessagesPage(viewerKey: string, input: StoryHistoryTranscriptRange): readonly ExperiencedTranscriptMessage[];
  rulesRuntime: Pick<VersionedRulesRuntime, "step" | "replay">;
  /** Reuses Room's normal static-card compiler with the token's focus scene. */
  buildCharacter(seed: AuthoritativeCharacterSeed, sceneId: string, profiles: RuntimeProfileManifest): StoryRecord | undefined;
}>;
export type StoryHistoryPrepareBranchInput = Readonly<{
  startToken: string;
  character: AuthoritativeCharacterSeed;
  target: Readonly<{ roomId: string; runtimeEpochId: string; activeBranchId: string; seatId: string }>;
}>;
export type StoryHistoryPrepareBranchResult = Readonly<{
  kind: "prepared";
  seed: StoryBranchSeed;
  sourceArchive: AuthoritativeRoomArchive;
  character: AuthoritativeCharacterSeed;
}> | StoryHistoryApiFailure;

/** The three RPC adapters delegate to this Interface. Only prepareBranch is
 * an internal Room-to-Room operation; its private return never reaches UI. */
export interface RoomStoryHistoryModule {
  readViewerPage(context: TrustedPrincipalContext, input: StoryViewerPageInput): Promise<StoryViewerPageResult>;
  listStarts(context: TrustedPrincipalContext, input: StoryHistoricalStartsInput): Promise<StoryHistoricalStartsResult>;
  prepareBranch(context: TrustedPrincipalContext, input: StoryHistoryPrepareBranchInput): Promise<StoryHistoryPrepareBranchResult>;
}
