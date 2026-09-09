import type { AuthoritativeWorldState, RuntimeProfileManifest } from "../rules";
import type { VersionedRulesRuntime } from "../rules/v2-runtime";
import { canonicalHash } from "../kp/vnext/canonical-json";
import type { AuthoritativeRoomArchive } from "./archive";
import type { AuthoritativeCharacterSeed, ExperiencedTranscriptMessage, TrustedPrincipalContext } from "./authority-types";
import type { StoryHash, StoryRecord } from "./story-creation/contracts";
import type { StoryHistoryApiFailure, StoryHistoricalStartsInput, StoryHistoricalStartsResult,
  StoryViewerPageInput, StoryViewerPageResult } from "./story-history-api-types";
import type { StoryBranchSeed, StoryHistoricalBranchRequest, StoryHistoricalVerification,
  StoryHistoryHost, StoryHistorySource, StoryHistoryRejection } from "./story-history/contracts";
import { prepareExport, prepareHistoricalBranch } from "./story-history";
import { describeHistoricalCut } from "./story-history/historical-cut";
import { exact, hash, isRecord, text } from "./story-history/validation";
import { StoryHistorySessions, type StoryHistorySessionBinding, type StoryHistorySnapshot,
  type StoryHistoryStartsSession, type StoryHistoryViewerSession, type StoredStoryHistorySession } from "./story-history-sessions";

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

const VIEWER_PAGE_SIZE = 200;
const STARTS_PAGE_SIZE = 12;
const STARTS_SCAN_LIMIT = 24;
const CUTS_PER_PAGE = 2;
const unavailable = (): StoryHistoryRejection => ({ kind: "rejected", code: "STORY_HISTORY_SOURCE_UNAVAILABLE" });
const rejected = (code: string): StoryHistoryApiFailure => ({ kind: "rejected", code });
const retryable = (): StoryHistoryApiFailure => ({ kind: "retryableFailure", code: "STORY_HISTORY_UNAVAILABLE" });
const same = (left: unknown, right: unknown): boolean => canonicalHash(left) === canonicalHash(right);

function sourceOf(snapshot: StoryHistorySnapshot): StoryHistorySource {
  const archive = snapshot.envelope.archive;
  return { roomId: archive.roomId, runtimeEpochId: archive.signedGenesis.runtimeEpochId,
    archiveHash: archive.archiveHash, branchId: archive.head.activeBranchId };
}
function sourceMatches(value: StoryHistorySource, binding: StoryHistorySessionBinding): boolean {
  return exact(value, ["roomId", "runtimeEpochId", "archiveHash", "branchId"]) && hash(value.archiveHash)
    && value.roomId === binding.roomId && value.runtimeEpochId === binding.runtimeEpochId && value.branchId === binding.branchId;
}
function bindingOf(authorization: StoryHistoryAuthorized, viewer: StoryHistoryViewer): StoryHistorySessionBinding {
  return { roomId: authorization.state.roomId, runtimeEpochId: authorization.state.runtimeEpochId,
    branchId: authorization.state.activeBranchId, principalId: authorization.principalId,
    authorizationVersion: authorization.authorizationVersion, characterId: viewer.characterId, viewerKey: viewer.viewerKey };
}

/** A single linear pass finds boundaries without interpreting candidate
 * worlds. A root resumed later prevents every intervening prefix being cut. */
function completeBoundaries(archive: AuthoritativeRoomArchive): string[] {
  const last = new Map<string, number>();
  archive.events.forEach((event, index) => last.set(event.rootActionId, index));
  const result = ["0"];
  let through = -1;
  archive.events.forEach((event, index) => {
    through = Math.max(through, last.get(event.rootActionId)!);
    if (index === through) result.push(event.eventSeq);
  });
  return result;
}

function fictionTimeLabel(state: AuthoritativeWorldState, sceneId: string): string | undefined {
  const timelines = Object.values(state.multiplayerRuntime.causalFrontiers)
    .flatMap(frontier => frontier.sceneId === sceneId && frontier.branchId === state.activeBranchId && text(frontier.timelineId)
      ? [frontier.timelineId] : []);
  if (timelines.length !== 1) return undefined;
  const point = state.fictionTimelines[timelines[0]];
  if (!point || !/^(0|[1-9]\d*)$/.test(point.nowMicros)) return undefined;
  const micros = BigInt(point.nowMicros), seconds = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `虚构时间 ${seconds}${fraction ? `.${fraction}` : ""} 秒`;
}

/** The durable operational session hides paging, source pinning and ordinary
 * Rules verification behind the same three methods used by Room RPC. */
export class RoomStoryHistory implements RoomStoryHistoryModule {
  constructor(private readonly sessions: StoryHistorySessions, private readonly ports: RoomStoryHistoryPorts) {}

  async readViewerPage(context: TrustedPrincipalContext, input: StoryViewerPageInput): Promise<StoryViewerPageResult> {
    if (!isRecord(input) || !(input.cursor === null || text(input.cursor))
      || !Object.keys(input).every(key => ["cursor", "characterId"].includes(key))
      || input.characterId !== undefined && !text(input.characterId)) return rejected("STORY_HISTORY_REQUEST_INVALID");
    try {
      let session: StoredStoryHistorySession & StoryHistoryViewerSession;
      let position = 0;
      if (input.cursor === null) {
        const initial = this.access(context, input.characterId);
        if (initial.kind !== "access") return initial;
        const binding = bindingOf(initial.authorization, initial.viewer);
        const upperOrdinal = this.ports.experiencedMessagesUpperOrdinal(binding.viewerKey);
        const readModel = structuredClone(initial.viewer.readModel), projectionHash = initial.viewer.projectionHash;
        if (!Number.isSafeInteger(upperOrdinal) || upperOrdinal < 0) return retryable();
        const source = await this.ports.sourceMetadata();
        if ("kind" in source) return source;
        if (!sourceMatches(source, binding) || !this.matches(context, binding)) return unavailable();
        session = this.sessions.create({ kind: "viewer", binding, source, upperOrdinal, readModel, projectionHash }) as typeof session;
      } else {
        const cursor = this.sessions.readCursor(input.cursor);
        if (cursor?.session.kind !== "viewer" || input.characterId !== undefined && input.characterId !== cursor.session.binding.characterId
          || !this.matches(context, cursor.session.binding) || cursor.position > cursor.session.upperOrdinal) {
          return rejected("STORY_HISTORY_CURSOR_UNAVAILABLE");
        }
        session = cursor.session;
        position = cursor.position;
      }
      const page = this.ports.experiencedMessagesPage(session.binding.viewerKey,
        { afterOrdinal: position, throughOrdinal: session.upperOrdinal, limit: VIEWER_PAGE_SIZE + 1 });
      if (page.length > VIEWER_PAGE_SIZE + 1 || page.some((message, index) => !Number.isSafeInteger(message.ordinal)
        || message.ordinal <= position || message.ordinal > session.upperOrdinal
        || index > 0 && message.ordinal <= page[index - 1].ordinal)) return retryable();
      const transcript = page.slice(0, VIEWER_PAGE_SIZE);
      const nextCursor = page.length > VIEWER_PAGE_SIZE
        ? this.sessions.cursor(session.sessionId, transcript[transcript.length - 1].ordinal) : null;
      const request = { kind: "viewer" as const, access: { principalId: session.binding.principalId,
        authorizationVersion: session.binding.authorizationVersion }, source: session.source,
        characterId: session.binding.characterId, cursor: input.cursor };
      const result = await prepareExport(request, {
        replay: this.ports.rulesRuntime.replay,
        readSource: async () => unavailable(),
        validateHistoricalCut: async () => unavailable(),
        validateNewIdentity: async () => unavailable(),
        readViewerExport: async incoming => {
          if (!this.matches(context, session.binding) || !same(incoming.request, request)) return unavailable();
          return { kind: "available", authorizationBindingHash: incoming.authorizationBindingHash,
            value: { readModel: session.readModel, projectionHash: session.projectionHash, transcript, nextCursor } };
        },
      });
      if (!this.matches(context, session.binding)) return unavailable();
      return result.kind === "viewerExportPrepared" ? { kind: "exported", export: result.record }
        : result.kind === "rejected" ? result : retryable();
    } catch { return retryable(); }
  }

  async listStarts(context: TrustedPrincipalContext, input: StoryHistoricalStartsInput): Promise<StoryHistoricalStartsResult> {
    if (!exact(input, ["cursor"]) || !(input.cursor === null || text(input.cursor))) return rejected("STORY_HISTORY_REQUEST_INVALID");
    try {
      let session: StoredStoryHistorySession & StoryHistoryStartsSession;
      let position = 0;
      if (input.cursor === null) {
        const initial = this.access(context);
        if (initial.kind !== "access") return initial;
        const binding = bindingOf(initial.authorization, initial.viewer), snapshot = await this.ports.readSnapshot();
        if ("kind" in snapshot) return snapshot;
        if (!this.matches(context, binding) || !sourceMatches(sourceOf(snapshot), binding)
          || !same(snapshot.moduleProfile.moduleRef, snapshot.envelope.archive.signedGenesis.moduleRef)
          || !same(initial.authorization.profiles, snapshot.envelope.archive.signedGenesis.profiles)) return unavailable();
        const locations = snapshot.moduleProfile.storyBible.storyAnchors.locations.map(({ sceneId, name, location, publicOpening }) =>
          ({ sceneId, name, location, publicOpening })).sort((a, b) => a.sceneId.localeCompare(b.sceneId));
        if (new Set(locations.map(location => location.sceneId)).size !== locations.length) return unavailable();
        session = this.sessions.create({ kind: "starts", binding, snapshot,
          cutEventSeqs: completeBoundaries(snapshot.envelope.archive), locations }) as typeof session;
      } else {
        const cursor = this.sessions.readCursor(input.cursor);
        if (cursor?.session.kind !== "starts" || !this.matches(context, cursor.session.binding)) return rejected("STORY_HISTORY_CURSOR_UNAVAILABLE");
        session = cursor.session;
        position = cursor.position;
      }
      const archive = session.snapshot.envelope.archive, locations = session.locations;
      const total = session.cutEventSeqs.length * locations.length;
      if (!Number.isSafeInteger(total) || position > total) return rejected("STORY_HISTORY_CURSOR_UNAVAILABLE");
      const starts: Extract<StoryHistoricalStartsResult, { kind: "listed" }>["starts"][number][] = [];
      const cuts = new Map<string, ReturnType<VersionedRulesRuntime["replay"]>>();
      let scanned = 0;
      while (position < total && scanned < STARTS_SCAN_LIMIT && starts.length < STARTS_PAGE_SIZE) {
        const eventSeq = session.cutEventSeqs[Math.floor(position / locations.length)], location = locations[position % locations.length];
        let prefix = cuts.get(eventSeq);
        if (prefix === undefined) {
          if (cuts.size >= CUTS_PER_PAGE) break;
          prefix = this.ports.rulesRuntime.replay(archive.signedGenesis, archive.events.slice(0, Number(eventSeq)));
          cuts.set(eventSeq, prefix);
        }
        position += 1; scanned += 1;
        if (prefix.kind !== "replayed") return rejected("STORY_HISTORY_ARCHIVE_INVALID");
        const state = prefix.state as AuthoritativeWorldState;
        const timeLabel = fictionTimeLabel(state, location.sceneId);
        if (timeLabel === undefined) continue;
        const cut = await describeHistoricalCut(state, prefix.head, location.sceneId);
        if ("kind" in cut) continue;
        starts.push({ startToken: this.sessions.start(session.sessionId, eventSeq, location.sceneId), sceneName: location.name,
          fictionTimeLabel: timeLabel, label: [location.location, location.publicOpening].filter(Boolean).join(" · ") || location.name });
      }
      if (!this.matches(context, session.binding)) return unavailable();
      return { kind: "listed", starts, nextCursor: position < total ? this.sessions.cursor(session.sessionId, position) : null };
    } catch { return retryable(); }
  }

  async prepareBranch(context: TrustedPrincipalContext, input: StoryHistoryPrepareBranchInput): Promise<StoryHistoryPrepareBranchResult> {
    if (!exact(input, ["startToken", "character", "target"]) || !text(input.startToken)
      || !exact(input.character, ["characterId", "controllerPrincipalId", "staticCard"])
      || !text(input.character.characterId) || !isRecord(input.character.staticCard)
      || !exact(input.target, ["roomId", "runtimeEpochId", "activeBranchId", "seatId"])
      || !Object.values(input.target).every(text)) return rejected("STORY_HISTORY_REQUEST_INVALID");
    try {
      const start = this.sessions.readStart(input.startToken);
      if (!start || !this.matches(context, start.session.binding)) return rejected("STORY_HISTORY_START_UNAVAILABLE");
      const { session, sceneId, eventSeq } = start, snapshot = session.snapshot;
      if (input.character.controllerPrincipalId !== session.binding.principalId) return rejected("STORY_HISTORY_IDENTITY_CONFLICT");
      const character: AuthoritativeCharacterSeed = { ...structuredClone(input.character),
        staticCard: { ...structuredClone(input.character.staticCard), sceneId } };
      const built = this.ports.buildCharacter(character, sceneId, snapshot.envelope.archive.signedGenesis.profiles);
      if (!built || built.id !== character.characterId || built.kind !== "player" || built.sceneId !== sceneId || built.tenureStatus !== "active") {
        return rejected("STORY_HISTORY_IDENTITY_UNSUPPORTED");
      }
      const request: StoryHistoricalBranchRequest = {
        access: { principalId: session.binding.principalId, authorizationVersion: session.binding.authorizationVersion }, source: sourceOf(snapshot),
        cut: { eventSeq, focusSceneId: sceneId }, identity: { kind: "newCharacter", characterId: character.characterId,
          sceneId, originBasisRefs: [sceneId], character: structuredClone(built) },
      };
      const host = this.branchHost(context, session, request, input);
      const result = await prepareHistoricalBranch(request, host);
      if (!this.matches(context, session.binding)) return unavailable();
      if (result.kind !== "branchPrepared") return result;
      return { kind: "prepared", seed: result.seed, sourceArchive: structuredClone(snapshot.envelope.archive), character };
    } catch { return retryable(); }
  }

  private access(context: TrustedPrincipalContext, characterId?: string): Readonly<{
    kind: "access"; authorization: StoryHistoryAuthorized; viewer: StoryHistoryViewer;
  }> | StoryHistoryApiFailure {
    const authorization = this.ports.authorize(context);
    if (authorization.kind !== "authorized") return authorization;
    if (authorization.principalId !== context.principal.id || !text(authorization.authorizationVersion)
      || authorization.state.principals[authorization.principalId]?.sessionVersion !== context.principal.sessionVersion) return unavailable();
    const viewer = this.ports.viewer(context, characterId);
    if (viewer.kind !== "viewed") return viewer;
    if (characterId !== undefined && viewer.characterId !== characterId || !text(viewer.characterId)
      || !text(viewer.viewerKey) || !isRecord(viewer.readModel) || !hash(viewer.projectionHash)) return unavailable();
    return { kind: "access", authorization, viewer };
  }

  private matches(context: TrustedPrincipalContext, binding: StoryHistorySessionBinding): boolean {
    const current = this.access(context, binding.characterId);
    return current.kind === "access" && same(bindingOf(current.authorization, current.viewer), binding);
  }

  private branchHost(context: TrustedPrincipalContext, session: StoredStoryHistorySession & StoryHistoryStartsSession,
    request: StoryHistoricalBranchRequest, input: StoryHistoryPrepareBranchInput): StoryHistoryHost {
    const snapshot = session.snapshot;
    // The two verification purposes inspect the same exact semantic value.
    // Their shared normal Rules initialization is retained only in this call.
    let verifiedContent: StoryHash | undefined;
    const verify = async (purpose: "historicalCut" | "newIdentity", value: StoryHistoricalVerification,
      authorizationBindingHash: StoryHash, verificationHash: StoryHash) => {
      if (!this.matches(context, session.binding) || !same(value.request, request)
        || !same(value.sourceArchive, snapshot.envelope.archive)
        || authorizationBindingHash !== canonicalHash({ purpose: "historicalBranch", request })
        || verificationHash !== canonicalHash({ purpose, contentHash: canonicalHash(value) })) return unavailable();
      const content = canonicalHash(value);
      if (verifiedContent !== content) {
        const initialized = this.ports.rulesRuntime.step(undefined, undefined, {
          kind: "initializeHistoricalWorld", schema: "zhuwei.historical-world-initialization/v1",
          roomId: input.target.roomId, runtimeEpochId: input.target.runtimeEpochId, activeBranchId: input.target.activeBranchId,
          sourceArchive: snapshot.envelope.archive, cut: request.cut,
          identity: { principal: structuredClone(context.principal), seatId: input.target.seatId,
            character: request.identity.character, originBasisRefs: request.identity.originBasisRefs },
        });
        if (initialized.kind !== "initialized") {
          const code = initialized.kind === "rejected" ? initialized.rejection.code : "invalidInitialization";
          const mapped: StoryHistoryRejection["code"] = code === "pendingInputUnresolved" ? "STORY_HISTORY_CUT_UNSUPPORTED"
            : code === "archiveIntegrityMismatch" ? "STORY_HISTORY_ARCHIVE_INVALID"
            : code === "profileIntegrityMismatch" || code === "unsupportedProfile" ? "STORY_HISTORY_PROFILE_UNSUPPORTED"
            : code === "causalFrontierConflict" ? "STORY_HISTORY_TIME_UNRESOLVED" : "STORY_HISTORY_IDENTITY_UNSUPPORTED";
          return { kind: "rejected" as const, code: mapped };
        }
        verifiedContent = content;
      }
      return { kind: "verified" as const, authorizationBindingHash, verificationHash };
    };
    return {
      replay: this.ports.rulesRuntime.replay,
      readViewerExport: async () => unavailable(),
      readSource: async incoming => {
        if (incoming.purpose !== "historicalBranch" || !this.matches(context, session.binding)
          || !same(incoming.request, request)) return unavailable();
        return { kind: "available", authorizationBindingHash: incoming.authorizationBindingHash,
          value: { archive: snapshot.envelope.archive, ...snapshot.historyMaterials } };
      },
      validateHistoricalCut: incoming => verify("historicalCut", incoming.value, incoming.authorizationBindingHash, incoming.verificationHash),
      validateNewIdentity: incoming => verify("newIdentity", incoming.value, incoming.authorizationBindingHash, incoming.verificationHash),
    };
  }
}
