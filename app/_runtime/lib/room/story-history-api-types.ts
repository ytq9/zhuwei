import type { DraftSheet } from "../dnd/types";
import type { RuntimeProfileManifest } from "../rules";
import type { ProfileRef } from "../rules/profiles/types";
import type {
  AuthoritativeCharacterSeed,
  TrustedPrincipalContext,
} from "./authority-types";
import type { StoryViewerExport } from "./story-history/contracts";

export type StoryHistoryApiFailure = Readonly<{
  kind: "rejected" | "retryableFailure";
  code: string;
}>;

export type StoryViewerPageInput = Readonly<{
  characterId?: string;
  cursor: string | null;
}>;
export type StoryViewerPageResult = Readonly<{
  kind: "exported";
  export: StoryViewerExport;
}> | StoryHistoryApiFailure;

export type StoryHistoricalStartsInput = Readonly<{ cursor: string | null }>;
export type StoryHistoricalStart = Readonly<{
  startToken: string;
  label: string;
  sceneName: string;
  fictionTimeLabel: string;
}>;
export type StoryHistoricalStartsResult = Readonly<{
  kind: "listed";
  starts: readonly StoryHistoricalStart[];
  nextCursor: string | null;
}> | StoryHistoryApiFailure;

/** Server-compiled build only. Room resolves the actual focus scene from the
 * source token and revalidates the build; staticCard.sceneId grants no origin. */
export type InitializeHistoricalAuthoritativeInput = Readonly<{
  targetRoomId: string;
  submissionId: string;
  requestHash: string;
  source: Readonly<{ roomId: string; startToken: string }>;
  character: AuthoritativeCharacterSeed;
}>;
export type InitializeHistoricalAuthoritativeResult = Readonly<{
  kind: "initialized";
  roomId: string;
  requestHash: string;
  runtimeEpochId: string;
  genesisHash: string;
  moduleRef: ProfileRef;
  runtimeProfiles: RuntimeProfileManifest;
  characterId: string;
  seatId: string;
}> | StoryHistoryApiFailure;

/** Trusted Worker-to-Room RPC. The authenticated route supplies context;
 * Room reauthorizes it. Archives and branch seeds never enter these DTOs. */
export interface StoryHistoryRpc {
  readStoryViewerPage(
    context: TrustedPrincipalContext,
    input: StoryViewerPageInput,
  ): Promise<StoryViewerPageResult>;
  listStoryHistoricalStarts(
    context: TrustedPrincipalContext,
    input: StoryHistoricalStartsInput,
  ): Promise<StoryHistoricalStartsResult>;
  initializeHistoricalAuthoritative(
    context: TrustedPrincipalContext,
    input: InitializeHistoricalAuthoritativeInput,
  ): Promise<InitializeHistoricalAuthoritativeResult>;
}

export type ExportStoryHistoryPageInput = StoryViewerPageInput & Readonly<{ code: string }>;
export type ListHistoricalStartsInput = StoryHistoricalStartsInput & Readonly<{ code: string }>;
export type CreateHistoricalRoomInput = Readonly<{
  code: string;
  submissionId: string;
  startToken: string;
  nickname: string;
  draft: DraftSheet;
}>;
export type CreateHistoricalRoomResult = Readonly<{
  kind: "created";
  code: string;
}> | StoryHistoryApiFailure;
