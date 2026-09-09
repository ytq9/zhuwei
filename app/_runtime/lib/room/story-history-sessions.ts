import { canonicalHash, parseJsonWithUniqueMembers } from "../kp/vnext/canonical-json";
import type { AuthoritativeModuleProfile } from "../module/authoritative";
import type { StoryRoomArchive } from "./story-archive";
import type { StoryHistoryMaterialSnapshot } from "./story-creation-invocation";
import type { StoryHash, StoryRecord } from "./story-creation/contracts";
import type { StoryHistorySource } from "./story-history/contracts";

/** A verified source captured by Room. Operational sessions are deliberately
 * absent from recoverable story archives; losing one requires a fresh list. */
export type StoryHistorySnapshot = Readonly<{
  envelope: StoryRoomArchive;
  moduleProfile: AuthoritativeModuleProfile;
  historyMaterials: StoryHistoryMaterialSnapshot;
}>;
export type StoryHistorySessionBinding = Readonly<{
  roomId: string;
  runtimeEpochId: string;
  branchId: string;
  principalId: string;
  authorizationVersion: string;
  characterId: string;
  viewerKey: string;
}>;
export type StoryHistoryViewerSession = Readonly<{
  kind: "viewer";
  binding: StoryHistorySessionBinding;
  source: StoryHistorySource;
  upperOrdinal: number;
  readModel: StoryRecord;
  projectionHash: StoryHash;
}>;
export type StoryHistoryStartsSession = Readonly<{
  kind: "starts";
  binding: StoryHistorySessionBinding;
  snapshot: StoryHistorySnapshot;
  /** Complete action boundaries, computed once without replaying prefixes. */
  cutEventSeqs: readonly string[];
  locations: readonly Readonly<{
    sceneId: string;
    name: string;
    location: string;
    publicOpening: string;
  }>[];
}>;
export type StoryHistorySession = StoryHistoryViewerSession | StoryHistoryStartsSession;
export type StoredStoryHistorySession = StoryHistorySession & Readonly<{ sessionId: string }>;

type SessionRow = { session_id: string; session_json: string; session_hash: string };
type CursorRow = { session_id: string; position: number };
type StartRow = { session_id: string; event_seq: string; scene_id: string };

/** Immutable private handles, not world state or a bearer authorization.
 * Every read must be reauthorized by RoomStoryHistory before any exposure. */
export class StoryHistorySessions {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly options: Readonly<{ newId?: () => string }> = {},
  ) {}

  ensureSchema(): void {
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS authority_story_history_sessions (
        session_id TEXT PRIMARY KEY,
        session_json TEXT NOT NULL,
        session_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authority_story_history_cursors (
        cursor_token TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        UNIQUE (session_id, position)
      );
      CREATE TABLE IF NOT EXISTS authority_story_history_starts (
        start_token TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        event_seq TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        UNIQUE (session_id, event_seq, scene_id)
      );
    `);
  }

  isEmpty(): boolean {
    return this.storage.sql.exec<{ total: number }>(`
      SELECT (SELECT COUNT(*) FROM authority_story_history_sessions)
        + (SELECT COUNT(*) FROM authority_story_history_cursors)
        + (SELECT COUNT(*) FROM authority_story_history_starts) AS total
    `).toArray()[0]?.total === 0;
  }

  clear(): void {
    this.storage.transactionSync(() => {
      this.storage.sql.exec("DELETE FROM authority_story_history_starts");
      this.storage.sql.exec("DELETE FROM authority_story_history_cursors");
      this.storage.sql.exec("DELETE FROM authority_story_history_sessions");
    });
  }

  create(value: StoryHistorySession): StoredStoryHistorySession {
    const session = { ...structuredClone(value), sessionId: this.id("session") };
    this.storage.sql.exec(
      "INSERT INTO authority_story_history_sessions (session_id, session_json, session_hash) VALUES (?, ?, ?)",
      session.sessionId, JSON.stringify(session), canonicalHash(session),
    );
    return session;
  }

  readCursor(token: string): Readonly<{ session: StoredStoryHistorySession; position: number }> | undefined {
    const row = this.storage.sql.exec<CursorRow>(
      "SELECT session_id, position FROM authority_story_history_cursors WHERE cursor_token = ?", token,
    ).toArray()[0];
    if (row === undefined) return undefined;
    const session = this.read(row.session_id);
    return session === undefined || !Number.isSafeInteger(row.position) || row.position < 0
      ? undefined : { session, position: row.position };
  }

  cursor(sessionId: string, position: number): string {
    if (!Number.isSafeInteger(position) || position < 0) throw new Error("STORY_HISTORY_CURSOR_UNAVAILABLE");
    return this.storage.transactionSync(() => {
      const prior = this.storage.sql.exec<{ cursor_token: string }>(
        "SELECT cursor_token FROM authority_story_history_cursors WHERE session_id = ? AND position = ?", sessionId, position,
      ).toArray()[0];
      if (prior) return prior.cursor_token;
      if (!this.exists(sessionId)) throw new Error("STORY_HISTORY_CURSOR_UNAVAILABLE");
      const token = this.id("cursor");
      this.storage.sql.exec(
        "INSERT INTO authority_story_history_cursors (cursor_token, session_id, position) VALUES (?, ?, ?)", token, sessionId, position,
      );
      return token;
    });
  }

  readStart(token: string): Readonly<{
    session: StoredStoryHistorySession & StoryHistoryStartsSession;
    eventSeq: string;
    sceneId: string;
  }> | undefined {
    const row = this.storage.sql.exec<StartRow>(
      "SELECT session_id, event_seq, scene_id FROM authority_story_history_starts WHERE start_token = ?", token,
    ).toArray()[0];
    if (row === undefined) return undefined;
    const session = this.read(row.session_id);
    return session?.kind !== "starts" || !session.cutEventSeqs.includes(row.event_seq)
      || !session.locations.some(location => location.sceneId === row.scene_id)
      ? undefined : { session, eventSeq: row.event_seq, sceneId: row.scene_id };
  }

  start(sessionId: string, eventSeq: string, sceneId: string): string {
    return this.storage.transactionSync(() => {
      const prior = this.storage.sql.exec<{ start_token: string }>(
        "SELECT start_token FROM authority_story_history_starts WHERE session_id = ? AND event_seq = ? AND scene_id = ?",
        sessionId, eventSeq, sceneId,
      ).toArray()[0];
      if (prior) return prior.start_token;
      // Room has just checked this cut. Loading a large frozen archive once
      // per displayed location would multiply the bounded page's work.
      // readStart checks membership in the immutable session before use.
      if (!this.exists(sessionId)) throw new Error("STORY_HISTORY_START_UNAVAILABLE");
      const token = this.id("start");
      this.storage.sql.exec(
        "INSERT INTO authority_story_history_starts (start_token, session_id, event_seq, scene_id) VALUES (?, ?, ?, ?)",
        token, sessionId, eventSeq, sceneId,
      );
      return token;
    });
  }

  private read(sessionId: string): StoredStoryHistorySession | undefined {
    const row = this.storage.sql.exec<SessionRow>(
      "SELECT session_id, session_json, session_hash FROM authority_story_history_sessions WHERE session_id = ?", sessionId,
    ).toArray()[0];
    if (row === undefined) return undefined;
    try {
      const value = parseJsonWithUniqueMembers(row.session_json) as StoredStoryHistorySession;
      return value.sessionId === row.session_id && ["viewer", "starts"].includes(value.kind)
        && canonicalHash(value) === row.session_hash ? value : undefined;
    } catch { return undefined; }
  }

  private exists(sessionId: string): boolean {
    return this.storage.sql.exec<{ session_id: string }>(
      "SELECT session_id FROM authority_story_history_sessions WHERE session_id = ?", sessionId,
    ).toArray().length === 1;
  }

  private id(kind: "session" | "cursor" | "start"): string {
    return `story-history-${kind}:${this.options.newId?.() ?? crypto.randomUUID()}`;
  }
}
