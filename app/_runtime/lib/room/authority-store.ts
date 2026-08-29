import type { AuthoritativeWorldState, EventEnvelope } from "../rules";
import type {
  AuthoritativeCharacterSeed,
  AuthoritativeMemberSeed,
  DeliveryAudienceState,
  DeliveryFrame,
  DeliveryPlan,
  ExperiencedTranscriptMessage,
  ExperiencedTranscriptMessageInput,
  JsonObject,
  PublicReceipt,
} from "./authority-types";
import type { AuthoritativeArchiveProgress } from "./archive";
import { authorityPendingBindings } from "./pending-bindings";

export type { ExperiencedTranscriptMessage };

export type AuthorityRoomRow = {
  room_id: string;
  module_id: string;
  profiles_json: string;
  genesis_json: string;
  state_json: string;
};

export type AuthorityCharacterRow = {
  character_id: string;
  controller_principal_id: string;
  scene_id: string;
  static_card_json: string;
};

export type AuthoritySubmissionRow = {
  submission_id: string;
  principal_id: string;
  payload_hash: string;
  input_kind: string;
  root_action_id: string;
  prepared_action_id: string;
  character_id: string;
  scene_scope: string;
  prepared_scope_version: number;
  status: string;
  proposal_hash: string | null;
  prepared_json: string;
  continuation_json: string | null;
  result_json: string | null;
};

export type AuthorityActionStageRow = {
  prepared_action_id: string;
  submission_id: string;
  phase: "dueActorPlan";
  target_id: string;
  child_root_action_id: string;
  status: "prepared" | "committed";
  proposal_hash: string | null;
  result_json: string | null;
};

export type AuthorityRandomnessJournalRow = {
  prepared_action_id: string;
  randomness_id: string;
  proposal_hash: string;
  request_hash: string;
  frozen_parameters_hash: string;
  request_json: string;
  continuation_json: string;
  request_events_json: string;
  answered_pending_input_id: string | null;
  candidate_faces_json: string | null;
  status: "requestCommitted" | "candidateCommitted" | "finalized";
};

export type AuthorityRandomnessBatchJournalRow = {
  prepared_action_id: string;
  proposal_hash: string;
  requests_json: string;
  fulfillment_json: string;
  request_events_json: string;
  answered_pending_input_id: string | null;
  candidates_json: string | null;
  status: "requestCommitted" | "candidateCommitted" | "finalized";
};

export type AuthorityProposalRecoveryRow = {
  prepared_action_id: string;
  proposal_hash: string;
  recovery_hash: string;
  recovery_json: string;
};

export type AuthorityPendingRow = {
  pending_input_id: string;
  root_action_id: string;
  controller_character_id: string;
  controller_principal_id: string;
  pending_json: string;
  status: string;
};

export type AuthorityDeliveryPlanRow = {
  publish_capability: string;
  receipt_id: string;
  root_action_id: string;
  active_branch_id: string;
  source_event_seq: string;
  plan_json: string;
  publication_hash: string | null;
  publication_result_json: string | null;
  status: string;
};

export type AuthorityDeliveryPlanTombstoneRow = {
  publish_capability: string;
  receipt_id: string;
  root_action_id: string;
  reason: string;
};

export type AuthorityDeliveryAudienceRow = {
  publish_capability: string;
  audience_id: string;
  viewer_key: string;
  projection_hash: string;
  delivery_generation: number;
  status: DeliveryAudienceState;
  attempt_hash: string | null;
  result_json: string | null;
  error_code: string | null;
};

export type AuthorityDeliverySlotRow = {
  viewer_key: string;
  principal_id: string;
  character_id: string;
  delivery_id: string;
  source_event_seq: string;
  frame_json: string;
};

export type AuthorityExperiencedMessageRow = {
  ordinal: number;
  viewer_key: string;
  message_id: string;
  scene_ids_json: string;
  kind: "player" | "kp";
  speaker_character_id: string | null;
  speaker_name: string;
  body: string;
  source_event_seq: string;
  receipt_id: string;
};

export type AuthorityAcknowledgementRow = {
  acknowledgement_id: string;
  principal_id: string;
  payload_hash: string;
  result_json: string;
};

export type AuthorityCorrectionRow = {
  correction_id: string;
  payload_hash: string;
  target_receipt_id: string;
  result_json: string;
};

export type AuthorityAdministrationRow = {
  command_id: string;
  payload_hash: string;
  result_json: string;
};

export type AuthorityRoomDeletionRow = {
  room_id: string;
  principal_id: string;
  prepared_at: number;
};

export type AuthorityArchiveProgressState = {
  progress: AuthoritativeArchiveProgress;
  pending: boolean;
  generation: number;
  nextAttemptAt: number | null;
  pendingSinceAt: number | null;
};

type AuthorityArchiveProgressRow = {
  room_id: string;
  runtime_epoch_id: string;
  progress_json: string;
  pending: number;
  generation: number;
  next_attempt_at: number | null;
  pending_since_at: number | null;
};

type CreateAuthorityRoom = {
  roomId: string;
  moduleId: string;
  profiles: unknown;
  genesis: unknown;
  state: unknown;
  members: AuthoritativeMemberSeed[];
  characters: AuthoritativeCharacterSeed[];
};

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

/**
 * Private SQLite adapter for the authoritative-v2 Room responsibility. It does
 * not interpret events or project viewers; those operations stay behind the
 * Rules step/project/replay interface.
 */
export class AuthoritativeRoomStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  ensureSchema(): void {
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS authority_rooms (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        room_id TEXT NOT NULL UNIQUE,
        module_id TEXT NOT NULL,
        profiles_json TEXT NOT NULL,
        genesis_json TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authority_members (
        principal_id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        session_version INTEGER NOT NULL,
        seat_id TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS authority_characters (
        character_id TEXT PRIMARY KEY,
        controller_principal_id TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        static_card_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS authority_characters_controller_idx
        ON authority_characters(controller_principal_id, character_id);
      CREATE TABLE IF NOT EXISTS authority_events (
        event_seq TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        root_action_id TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS authority_events_root_idx
        ON authority_events(root_action_id, length(event_seq), event_seq);
      CREATE TABLE IF NOT EXISTS authority_submissions (
        submission_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        input_kind TEXT NOT NULL,
        root_action_id TEXT NOT NULL,
        prepared_action_id TEXT NOT NULL UNIQUE,
        character_id TEXT NOT NULL,
        scene_scope TEXT NOT NULL,
        prepared_scope_version INTEGER NOT NULL,
        status TEXT NOT NULL,
        proposal_hash TEXT,
        prepared_json TEXT NOT NULL,
        continuation_json TEXT,
        result_json TEXT
      );
      CREATE INDEX IF NOT EXISTS authority_submissions_root_idx
        ON authority_submissions(root_action_id);
      CREATE TABLE IF NOT EXISTS authority_action_stages (
        prepared_action_id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL UNIQUE,
        phase TEXT NOT NULL CHECK (phase IN ('dueActorPlan')),
        target_id TEXT NOT NULL,
        child_root_action_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('prepared', 'committed')),
        proposal_hash TEXT,
        result_json TEXT
      );
      CREATE TABLE IF NOT EXISTS authority_proposal_recovery (
        prepared_action_id TEXT PRIMARY KEY,
        proposal_hash TEXT NOT NULL,
        recovery_hash TEXT NOT NULL,
        recovery_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authority_randomness_journal (
        prepared_action_id TEXT PRIMARY KEY,
        randomness_id TEXT NOT NULL UNIQUE,
        proposal_hash TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        frozen_parameters_hash TEXT NOT NULL,
        request_json TEXT NOT NULL,
        continuation_json TEXT NOT NULL,
        request_events_json TEXT NOT NULL,
        answered_pending_input_id TEXT,
        candidate_faces_json TEXT,
        status TEXT NOT NULL CHECK (
          status IN ('requestCommitted', 'candidateCommitted', 'finalized')
        )
      );
      CREATE TABLE IF NOT EXISTS authority_randomness_batches (
        prepared_action_id TEXT PRIMARY KEY,
        proposal_hash TEXT NOT NULL,
        requests_json TEXT NOT NULL,
        fulfillment_json TEXT NOT NULL,
        request_events_json TEXT NOT NULL,
        answered_pending_input_id TEXT,
        candidates_json TEXT,
        status TEXT NOT NULL CHECK (
          status IN ('requestCommitted', 'candidateCommitted', 'finalized')
        )
      );
      CREATE TABLE IF NOT EXISTS authority_scope_versions (
        scope_id TEXT PRIMARY KEY,
        version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authority_receipts (
        receipt_id TEXT PRIMARY KEY,
        root_action_id TEXT NOT NULL,
        receipt_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authority_pending_inputs (
        pending_input_id TEXT PRIMARY KEY,
        root_action_id TEXT NOT NULL,
        controller_character_id TEXT NOT NULL,
        controller_principal_id TEXT NOT NULL,
        pending_json TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authority_delivery_plans (
        publish_capability TEXT PRIMARY KEY,
        receipt_id TEXT NOT NULL,
        root_action_id TEXT NOT NULL,
        active_branch_id TEXT NOT NULL,
        source_event_seq TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        publication_hash TEXT,
        publication_result_json TEXT,
        status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authority_delivery_audiences (
        publish_capability TEXT NOT NULL,
        audience_id TEXT NOT NULL,
        viewer_key TEXT NOT NULL,
        projection_hash TEXT NOT NULL,
        delivery_generation INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (
          status IN ('pending', 'published', 'rejected', 'retryableFailure', 'superseded')
        ),
        attempt_hash TEXT,
        result_json TEXT,
        error_code TEXT,
        PRIMARY KEY (publish_capability, audience_id)
      );
      CREATE INDEX IF NOT EXISTS idx_authority_delivery_audiences_viewer
        ON authority_delivery_audiences (viewer_key, status);
      CREATE TABLE IF NOT EXISTS authority_delivery_slots (
        viewer_key TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        delivery_id TEXT NOT NULL UNIQUE,
        source_event_seq TEXT NOT NULL,
        frame_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authority_experienced_messages (
        ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
        viewer_key TEXT NOT NULL,
        message_id TEXT NOT NULL,
        scene_ids_json TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('player', 'kp')),
        speaker_character_id TEXT,
        speaker_name TEXT NOT NULL,
        body TEXT NOT NULL,
        source_event_seq TEXT NOT NULL,
        receipt_id TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS authority_experienced_messages_identity_idx
        ON authority_experienced_messages(viewer_key, message_id);
      CREATE INDEX IF NOT EXISTS authority_experienced_messages_viewer_order_idx
        ON authority_experienced_messages(viewer_key, ordinal);
      CREATE TABLE IF NOT EXISTS authority_delivery_watermarks (
        viewer_key TEXT PRIMARY KEY,
        source_event_seq TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authority_delivery_tombstones (
        delivery_id TEXT PRIMARY KEY,
        viewer_key TEXT NOT NULL,
        receipt_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        reason TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authority_delivery_plan_tombstones (
        publish_capability TEXT PRIMARY KEY,
        receipt_id TEXT NOT NULL,
        root_action_id TEXT NOT NULL,
        reason TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authority_delivery_acknowledgements (
        acknowledgement_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        result_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authority_corrections (
        correction_id TEXT PRIMARY KEY,
        payload_hash TEXT NOT NULL,
        target_receipt_id TEXT NOT NULL,
        result_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authority_room_administration (
        command_id TEXT PRIMARY KEY,
        payload_hash TEXT NOT NULL,
        result_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authority_archive_progress (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        room_id TEXT NOT NULL,
        runtime_epoch_id TEXT NOT NULL,
        progress_json TEXT NOT NULL,
        pending INTEGER NOT NULL CHECK (pending IN (0, 1)),
        generation INTEGER NOT NULL,
        next_attempt_at INTEGER,
        pending_since_at INTEGER,
        updated_at INTEGER NOT NULL,
        UNIQUE(room_id, runtime_epoch_id)
      );
      CREATE TABLE IF NOT EXISTS authority_room_deletion (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        room_id TEXT NOT NULL UNIQUE,
        principal_id TEXT NOT NULL,
        prepared_at INTEGER NOT NULL
      );
    `);
    const archiveProgressColumns = this.storage.sql.exec<{ name: string }>(
      "PRAGMA table_info(authority_archive_progress)",
    ).toArray();
    if (!archiveProgressColumns.some((column) => column.name === "pending_since_at")) {
      this.storage.sql.exec(
        "ALTER TABLE authority_archive_progress ADD COLUMN pending_since_at INTEGER",
      );
    }
    // A pre-migration pending generation started no later than its last durable
    // progress update. Keep that conservative age instead of resetting its SLO
    // clock merely because this object was reconstructed on newer code.
    this.storage.sql.exec(`
      UPDATE authority_archive_progress
      SET pending_since_at = CASE
        WHEN pending = 1 THEN COALESCE(pending_since_at, updated_at)
        ELSE NULL
      END
      WHERE singleton = 1
    `);
    const existing = this.storage.sql.exec<{
      room_id: string;
      genesis_json: string;
    }>(`
      SELECT room_id, genesis_json FROM authority_rooms WHERE singleton = 1
    `).toArray()[0];
    if (existing !== undefined && this.archiveProgress() === undefined) {
      const genesis = parseJson<{ runtimeEpochId?: unknown }>(existing.genesis_json);
      if (typeof genesis.runtimeEpochId !== "string" || genesis.runtimeEpochId.length === 0) {
        throw new Error("Existing authoritative room has no runtime epoch for archive recovery.");
      }
      // Existing authoritative-v2 objects predate the cursor table. Replaying
      // their archive once is safe because every D1 insert is INSERT OR IGNORE.
      this.initializeArchiveProgress(existing.room_id, genesis.runtimeEpochId, Date.now());
    }
  }

  private initializeArchiveProgress(roomId: string, runtimeEpochId: string, now: number): void {
    const progress: AuthoritativeArchiveProgress = {
      format: "zhuwei.authoritative-archive-progress/v1",
      roomId,
      runtimeEpochId,
      genesisArchived: false,
      lastEventSeq: "0",
      auditCursor: null,
    };
    this.storage.sql.exec(
      `INSERT OR IGNORE INTO authority_archive_progress (
         singleton, room_id, runtime_epoch_id, progress_json,
         pending, generation, next_attempt_at, pending_since_at, updated_at
       ) VALUES (1, ?, ?, ?, 1, 0, ?, ?, ?)`,
      roomId,
      runtimeEpochId,
      JSON.stringify(progress),
      now,
      now,
      now,
    );
  }

  transaction<T>(callback: () => T): T {
    return this.storage.transactionSync(callback);
  }

  room(): AuthorityRoomRow | undefined {
    return this.storage.sql.exec<AuthorityRoomRow>(`
      SELECT room_id, module_id, profiles_json, genesis_json, state_json
      FROM authority_rooms WHERE singleton = 1
    `).toArray()[0];
  }

  isAuthorityEmpty(): boolean {
    const row = this.storage.sql.exec<{ total: number }>(`
      SELECT
        (SELECT COUNT(*) FROM authority_rooms)
        + (SELECT COUNT(*) FROM authority_members)
        + (SELECT COUNT(*) FROM authority_characters)
        + (SELECT COUNT(*) FROM authority_events)
        + (SELECT COUNT(*) FROM authority_submissions)
        + (SELECT COUNT(*) FROM authority_action_stages)
        + (SELECT COUNT(*) FROM authority_proposal_recovery)
        + (SELECT COUNT(*) FROM authority_randomness_journal)
        + (SELECT COUNT(*) FROM authority_randomness_batches)
        + (SELECT COUNT(*) FROM authority_scope_versions)
        + (SELECT COUNT(*) FROM authority_receipts)
        + (SELECT COUNT(*) FROM authority_pending_inputs)
        + (SELECT COUNT(*) FROM authority_delivery_plans)
        + (SELECT COUNT(*) FROM authority_delivery_audiences)
        + (SELECT COUNT(*) FROM authority_delivery_slots)
        + (SELECT COUNT(*) FROM authority_experienced_messages)
        + (SELECT COUNT(*) FROM authority_delivery_watermarks)
        + (SELECT COUNT(*) FROM authority_delivery_tombstones)
        + (SELECT COUNT(*) FROM authority_delivery_plan_tombstones)
        + (SELECT COUNT(*) FROM authority_delivery_acknowledgements)
        + (SELECT COUNT(*) FROM authority_corrections)
        + (SELECT COUNT(*) FROM authority_room_administration)
        + (SELECT COUNT(*) FROM authority_archive_progress)
        + (SELECT COUNT(*) FROM authority_room_deletion)
        AS total
    `).toArray()[0];
    return row?.total === 0;
  }

  createRoom(input: CreateAuthorityRoom): void {
    const now = Date.now();
    this.storage.sql.exec(
      `INSERT INTO authority_rooms (
         singleton, room_id, module_id, profiles_json, genesis_json, state_json, updated_at
       ) VALUES (1, ?, ?, ?, ?, ?, ?)`,
      input.roomId,
      input.moduleId,
      JSON.stringify(input.profiles),
      JSON.stringify(input.genesis),
      JSON.stringify(input.state),
      now,
    );
    for (const member of input.members) {
      this.storage.sql.exec(
        `INSERT INTO authority_members (principal_id, role, session_version, seat_id)
         VALUES (?, ?, 1, ?)`,
        member.principalId,
        member.role,
        `seat:${member.principalId}`,
      );
    }
    for (const character of input.characters) {
      this.storage.sql.exec(
        `INSERT INTO authority_characters (
           character_id, controller_principal_id, scene_id, static_card_json
         ) VALUES (?, ?, ?, ?)`,
        character.characterId,
        character.controllerPrincipalId,
        character.staticCard.sceneId,
        JSON.stringify(character.staticCard),
      );
    }
    if (
      input.genesis === null
      || typeof input.genesis !== "object"
      || Array.isArray(input.genesis)
      || typeof (input.genesis as { runtimeEpochId?: unknown }).runtimeEpochId !== "string"
      || (input.genesis as { runtimeEpochId: string }).runtimeEpochId.length === 0
    ) {
      throw new Error("Authoritative genesis requires a runtime epoch for archive progress.");
    }
    this.initializeArchiveProgress(
      input.roomId,
      (input.genesis as { runtimeEpochId: string }).runtimeEpochId,
      now,
    );
  }

  archiveProgress(): AuthorityArchiveProgressState | undefined {
    const row = this.storage.sql.exec<AuthorityArchiveProgressRow>(`
      SELECT room_id, runtime_epoch_id, progress_json, pending,
             generation, next_attempt_at, pending_since_at
      FROM authority_archive_progress WHERE singleton = 1
    `).toArray()[0];
    if (row === undefined) return undefined;
    const progress = parseJson<AuthoritativeArchiveProgress>(row.progress_json);
    if (progress.roomId !== row.room_id || progress.runtimeEpochId !== row.runtime_epoch_id) {
      throw new Error("Persisted archive progress identity is inconsistent.");
    }
    return {
      progress,
      pending: row.pending === 1,
      generation: row.generation,
      nextAttemptAt: row.next_attempt_at,
      pendingSinceAt: row.pending_since_at,
    };
  }

  markArchivePending(nowMs: number): AuthorityArchiveProgressState | undefined {
    this.storage.sql.exec(
      `UPDATE authority_archive_progress
       SET pending = 1,
           generation = generation + 1,
           pending_since_at = CASE
             WHEN pending = 1 AND pending_since_at IS NOT NULL THEN pending_since_at
             ELSE ?
           END,
           next_attempt_at = CASE
             WHEN next_attempt_at IS NULL OR next_attempt_at > ? THEN ?
             ELSE next_attempt_at
           END,
           updated_at = ?
       WHERE singleton = 1`,
      nowMs,
      nowMs,
      nowMs,
      nowMs,
    );
    return this.archiveProgress();
  }

  ensureArchivePending(nowMs: number): AuthorityArchiveProgressState | undefined {
    const current = this.archiveProgress();
    if (current === undefined || current.pending) return current;
    return this.markArchivePending(nowMs);
  }

  restartArchiveFromAuthority(nowMs: number): AuthorityArchiveProgressState | undefined {
    const current = this.archiveProgress();
    if (current === undefined) return undefined;
    const progress: AuthoritativeArchiveProgress = {
      ...current.progress,
      genesisArchived: false,
      lastEventSeq: "0",
      auditCursor: null,
    };
    this.storage.sql.exec(
      `UPDATE authority_archive_progress
       SET progress_json = ?, pending = 1, generation = generation + 1,
           next_attempt_at = ?, pending_since_at = COALESCE(pending_since_at, ?),
           updated_at = ?
       WHERE singleton = 1`,
      JSON.stringify(progress),
      nowMs,
      nowMs,
      nowMs,
    );
    return this.archiveProgress();
  }

  archiveAlarmAt(): number | null {
    const row = this.storage.sql.exec<{ next_attempt_at: number | null }>(`
      SELECT next_attempt_at FROM authority_archive_progress
      WHERE singleton = 1 AND pending = 1
    `).toArray()[0];
    return row?.next_attempt_at ?? null;
  }

  saveArchivePage(input: {
    progress: AuthoritativeArchiveProgress;
    observedGeneration: number;
    caughtUp: boolean;
    nowMs: number;
    nextPageAt: number;
  }): AuthorityArchiveProgressState {
    const current = this.archiveProgress();
    if (current === undefined) throw new Error("Archive progress is unavailable.");
    if (
      input.progress.roomId !== current.progress.roomId
      || input.progress.runtimeEpochId !== current.progress.runtimeEpochId
    ) {
      throw new Error("Archive page progress belongs to another room or runtime epoch.");
    }
    const currentEvent = BigInt(current.progress.lastEventSeq);
    const pageEvent = BigInt(input.progress.lastEventSeq);
    const auditOrder = (
      left: AuthoritativeArchiveProgress["auditCursor"],
      right: AuthoritativeArchiveProgress["auditCursor"],
    ): number => {
      if (left === null) return right === null ? 0 : -1;
      if (right === null) return 1;
      const leftEvent = BigInt(left.eventSeq);
      const rightEvent = BigInt(right.eventSeq);
      if (leftEvent !== rightEvent) return leftEvent < rightEvent ? -1 : 1;
      if (left.viewerHash === right.viewerHash) return 0;
      return left.viewerHash < right.viewerHash ? -1 : 1;
    };
    const progress: AuthoritativeArchiveProgress = {
      ...current.progress,
      genesisArchived: current.progress.genesisArchived || input.progress.genesisArchived,
      lastEventSeq: pageEvent > currentEvent
        ? input.progress.lastEventSeq
        : current.progress.lastEventSeq,
      auditCursor: auditOrder(input.progress.auditCursor, current.progress.auditCursor) > 0
        ? structuredClone(input.progress.auditCursor)
        : structuredClone(current.progress.auditCursor),
    };
    const generationUnchanged = current.generation === input.observedGeneration;
    const pending = !(input.caughtUp && generationUnchanged);
    const nextAttemptAt = pending
      ? generationUnchanged ? input.nextPageAt : Math.min(current.nextAttemptAt ?? input.nowMs, input.nowMs)
      : null;
    const pendingSinceAt = pending ? current.pendingSinceAt ?? input.nowMs : null;
    this.storage.sql.exec(
      `UPDATE authority_archive_progress
       SET progress_json = ?, pending = ?, next_attempt_at = ?,
           pending_since_at = ?, updated_at = ?
       WHERE singleton = 1`,
      JSON.stringify(progress),
      pending ? 1 : 0,
      nextAttemptAt,
      pendingSinceAt,
      input.nowMs,
    );
    const saved = this.archiveProgress();
    if (saved === undefined) throw new Error("Archive page progress was not saved.");
    return saved;
  }

  deferArchive(nextAttemptAt: number, nowMs: number): void {
    this.storage.sql.exec(
      `UPDATE authority_archive_progress
       SET pending = 1,
           pending_since_at = CASE
             WHEN pending = 1 AND pending_since_at IS NOT NULL THEN pending_since_at
             ELSE ?
           END,
           next_attempt_at = ?, updated_at = ?
       WHERE singleton = 1`,
      nowMs,
      nextAttemptAt,
      nowMs,
    );
  }

  pauseArchiveUntilAuthorityChanges(nowMs: number): void {
    this.storage.sql.exec(
      `UPDATE authority_archive_progress
       SET pending = 1,
           pending_since_at = CASE
             WHEN pending = 1 AND pending_since_at IS NOT NULL THEN pending_since_at
             ELSE ?
           END,
           next_attempt_at = NULL, updated_at = ?
       WHERE singleton = 1`,
      nowMs,
      nowMs,
    );
  }

  updateState(state: unknown): void {
    this.storage.sql.exec(
      "UPDATE authority_rooms SET state_json = ?, updated_at = ? WHERE singleton = 1",
      JSON.stringify(state),
      Date.now(),
    );
  }

  saveStaticCharacter(input: AuthoritativeCharacterSeed): void {
    this.storage.sql.exec(
      `INSERT INTO authority_characters (
         character_id, controller_principal_id, scene_id, static_card_json
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT(character_id) DO UPDATE SET
         controller_principal_id = excluded.controller_principal_id,
         scene_id = excluded.scene_id,
         static_card_json = excluded.static_card_json`,
      input.characterId,
      input.controllerPrincipalId,
      input.staticCard.sceneId,
      JSON.stringify(input.staticCard),
    );
  }

  syncAuthorityIndex(state: AuthoritativeWorldState): void {
    this.storage.sql.exec("DELETE FROM authority_members");
    for (const member of Object.values(state.multiplayerRuntime.members)
      .filter((entry) => entry.status === "active")
      .sort((left, right) => left.principalId.localeCompare(right.principalId))) {
      const principal = state.principals[member.principalId];
      const seat = Object.values(state.seats)
        .filter((entry) =>
          entry.principalId === member.principalId && entry.status === "active")
        .sort((left, right) => left.id.localeCompare(right.id))[0];
      if (principal === undefined || seat === undefined) continue;
      this.storage.sql.exec(
        `INSERT INTO authority_members (principal_id, role, session_version, seat_id)
         VALUES (?, ?, ?, ?)`,
        member.principalId,
        member.role,
        principal.sessionVersion,
        seat.id,
      );
    }
    for (const control of Object.values(state.characterControls)) {
      const seat = state.seats[control.seatId];
      if (seat === undefined) continue;
      this.storage.sql.exec(
        `UPDATE authority_characters
         SET controller_principal_id = ?, scene_id = ?
         WHERE character_id = ?`,
        seat.principalId,
        state.entities[control.characterId]?.sceneId ?? "",
        control.characterId,
      );
    }
  }

  syncPendingAuthority(state: AuthoritativeWorldState): void {
    this.storage.sql.exec(
      "UPDATE authority_pending_inputs SET status = 'suspended' WHERE status = 'open'",
    );
    for (const binding of authorityPendingBindings(state)) this.savePending(binding);
  }

  events(): EventEnvelope[] {
    return this.storage.sql.exec<{ event_json: string }>(`
      SELECT event_json FROM authority_events
      ORDER BY length(event_seq), event_seq
    `).toArray().map(({ event_json }) => parseJson<EventEnvelope>(event_json));
  }

  appendEvents(events: EventEnvelope[]): void {
    for (const event of events) {
      this.storage.sql.exec(
        `INSERT INTO authority_events (event_seq, event_id, root_action_id, event_json)
         VALUES (?, ?, ?, ?)`,
        event.eventSeq,
        event.eventId,
        event.rootActionId,
        JSON.stringify(event),
      );
    }
  }

  rootEvents(rootActionId: string): EventEnvelope[] {
    return this.storage.sql.exec<{ event_json: string }>(`
      SELECT event_json FROM authority_events WHERE root_action_id = ?
      ORDER BY length(event_seq), event_seq
    `, rootActionId).toArray().map(({ event_json }) => parseJson<EventEnvelope>(event_json));
  }

  character(characterId: string): AuthorityCharacterRow | undefined {
    return this.storage.sql.exec<AuthorityCharacterRow>(`
      SELECT character_id, controller_principal_id, scene_id, static_card_json
      FROM authority_characters WHERE character_id = ?
    `, characterId).toArray()[0];
  }

  staticCard(characterId: string): JsonObject | undefined {
    const row = this.character(characterId);
    return row === undefined ? undefined : parseJson<JsonObject>(row.static_card_json);
  }

  spotlightLedger(state: AuthoritativeWorldState): Record<string, { decisionBeats: number }> {
    const roots = new Map<string, Set<string>>();
    const playerIds = new Set(Object.values(state.entities)
      .filter((entry) => entry.kind === "player")
      .map((entry) => entry.id));
    for (const event of this.events()) {
      const payload = event.payload as Record<string, unknown>;
      const request = payload.request !== null && typeof payload.request === "object"
        && !Array.isArray(payload.request)
        ? payload.request as Record<string, unknown>
        : undefined;
      const candidates = [
        payload.actorCharacterId,
        payload.characterId,
        payload.controllerCharacterId,
        request?.actorCharacterId,
      ].filter((entry): entry is string => typeof entry === "string" && playerIds.has(entry));
      for (const characterId of candidates) {
        const characterRoots = roots.get(characterId) ?? new Set<string>();
        characterRoots.add(event.rootActionId);
        roots.set(characterId, characterRoots);
      }
    }
    return Object.fromEntries(
      Object.values(state.entities)
        .filter((entry) => entry.kind === "player")
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((entry) => [entry.id, { decisionBeats: roots.get(entry.id)?.size ?? 0 }]),
    );
  }

  submission(submissionId: string): AuthoritySubmissionRow | undefined {
    return this.storage.sql.exec<AuthoritySubmissionRow>(`
      SELECT submission_id, principal_id, payload_hash, input_kind,
             root_action_id, prepared_action_id, character_id, scene_scope,
             prepared_scope_version, status, proposal_hash, prepared_json,
             continuation_json, result_json
      FROM authority_submissions WHERE submission_id = ?
    `, submissionId).toArray()[0];
  }

  submissionByPrepared(preparedActionId: string): AuthoritySubmissionRow | undefined {
    return this.storage.sql.exec<AuthoritySubmissionRow>(`
      SELECT submission_id, principal_id, payload_hash, input_kind,
             root_action_id, prepared_action_id, character_id, scene_scope,
             prepared_scope_version, status, proposal_hash, prepared_json,
             continuation_json, result_json
      FROM authority_submissions WHERE prepared_action_id = ?
    `, preparedActionId).toArray()[0];
  }

  actionStage(preparedActionId: string): AuthorityActionStageRow | undefined {
    return this.storage.sql.exec<AuthorityActionStageRow>(`
      SELECT prepared_action_id, submission_id, phase, target_id,
             child_root_action_id, status, proposal_hash, result_json
      FROM authority_action_stages WHERE prepared_action_id = ?
    `, preparedActionId).toArray()[0];
  }

  insertActionStage(input: {
    preparedActionId: string;
    submissionId: string;
    targetId: string;
    childRootActionId: string;
  }): void {
    this.storage.sql.exec(
      `INSERT INTO authority_action_stages (
         prepared_action_id, submission_id, phase, target_id,
         child_root_action_id, status, proposal_hash, result_json
       ) VALUES (?, ?, 'dueActorPlan', ?, ?, 'prepared', NULL, NULL)`,
      input.preparedActionId,
      input.submissionId,
      input.targetId,
      input.childRootActionId,
    );
  }

  invalidatePreparedActionStagesInScopes(sceneScopes: string[]): void {
    const scopes = [...new Set(sceneScopes)].sort();
    if (scopes.length === 0) return;
    const placeholders = scopes.map(() => "?").join(", ");
    this.storage.sql.exec(
      `DELETE FROM authority_proposal_recovery
       WHERE prepared_action_id IN (
         SELECT stage.child_root_action_id
         FROM authority_action_stages stage
         JOIN authority_submissions submission
           ON submission.prepared_action_id = stage.prepared_action_id
         WHERE stage.status = 'prepared'
           AND submission.scene_scope IN (${placeholders})
       )`,
      ...scopes,
    );
    this.storage.sql.exec(
      `DELETE FROM authority_action_stages
       WHERE status = 'prepared'
         AND prepared_action_id IN (
           SELECT prepared_action_id
           FROM authority_submissions
           WHERE scene_scope IN (${placeholders})
         )`,
      ...scopes,
    );
  }

  finishActionStage(
    preparedActionId: string,
    proposalHash: string,
    result: unknown,
  ): void {
    this.storage.sql.exec(
      `UPDATE authority_action_stages
       SET status = 'committed', proposal_hash = ?, result_json = ?
       WHERE prepared_action_id = ? AND status = 'prepared'`,
      proposalHash,
      JSON.stringify(result),
      preparedActionId,
    );
  }

  advancePreparedSubmission(input: {
    preparedActionId: string;
    preparedScopeVersion: number;
    prepared: unknown;
  }): void {
    this.storage.sql.exec(
      `UPDATE authority_submissions
       SET status = 'prepared', prepared_scope_version = ?, proposal_hash = NULL,
           prepared_json = ?, result_json = NULL
       WHERE prepared_action_id = ?`,
      input.preparedScopeVersion,
      JSON.stringify(input.prepared),
      input.preparedActionId,
    );
  }

  hasRandomnessSettlementInScene(
    sceneScope: string,
    excludingPreparedActionId: string,
  ): boolean {
    return this.storage.sql.exec<{ held: number }>(`
      SELECT 1 AS held
      FROM authority_submissions
      WHERE scene_scope = ?
        AND status = 'awaitingRandomness'
        AND prepared_action_id <> ?
      LIMIT 1
    `, sceneScope, excludingPreparedActionId).toArray()[0] !== undefined;
  }

  proposalRecovery(preparedActionId: string): AuthorityProposalRecoveryRow | undefined {
    return this.storage.sql.exec<AuthorityProposalRecoveryRow>(`
      SELECT prepared_action_id, proposal_hash, recovery_hash, recovery_json
      FROM authority_proposal_recovery WHERE prepared_action_id = ?
    `, preparedActionId).toArray()[0];
  }

  saveProposalRecovery(input: {
    preparedActionId: string;
    proposalHash: string;
    recoveryHash: string;
    recovery: unknown;
  }): void {
    this.storage.sql.exec(
      `INSERT INTO authority_proposal_recovery (
         prepared_action_id, proposal_hash, recovery_hash, recovery_json
       ) VALUES (?, ?, ?, ?)`,
      input.preparedActionId,
      input.proposalHash,
      input.recoveryHash,
      JSON.stringify(input.recovery),
    );
  }

  insertSubmission(input: {
    submissionId: string;
    principalId: string;
    payloadHash: string;
    inputKind: string;
    rootActionId: string;
    preparedActionId: string;
    characterId: string;
    sceneScope: string;
    preparedScopeVersion: number;
    prepared: unknown;
    continuation?: unknown;
  }): void {
    this.storage.sql.exec(
      `INSERT INTO authority_submissions (
         submission_id, principal_id, payload_hash, input_kind, root_action_id,
         prepared_action_id, character_id, scene_scope, prepared_scope_version,
         status, proposal_hash, prepared_json, continuation_json, result_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', NULL, ?, ?, NULL)`,
      input.submissionId,
      input.principalId,
      input.payloadHash,
      input.inputKind,
      input.rootActionId,
      input.preparedActionId,
      input.characterId,
      input.sceneScope,
      input.preparedScopeVersion,
      JSON.stringify(input.prepared),
      input.continuation === undefined ? null : JSON.stringify(input.continuation),
    );
  }

  markAwaitingRandomness(
    preparedActionId: string,
    proposalHash: string,
  ): void {
    this.storage.sql.exec(
      `UPDATE authority_submissions
       SET status = 'awaitingRandomness', proposal_hash = ?
       WHERE prepared_action_id = ?`,
      proposalHash,
      preparedActionId,
    );
  }

  randomnessJournal(preparedActionId: string): AuthorityRandomnessJournalRow | undefined {
    return this.storage.sql.exec<AuthorityRandomnessJournalRow>(`
      SELECT prepared_action_id, randomness_id, proposal_hash, request_hash,
             frozen_parameters_hash, request_json, continuation_json,
             request_events_json, answered_pending_input_id,
             candidate_faces_json, status
      FROM authority_randomness_journal WHERE prepared_action_id = ?
    `, preparedActionId).toArray()[0];
  }

  randomnessBatch(preparedActionId: string): AuthorityRandomnessBatchJournalRow | undefined {
    const current = this.storage.sql.exec<AuthorityRandomnessBatchJournalRow>(`
      SELECT prepared_action_id, proposal_hash, requests_json, fulfillment_json,
             request_events_json, answered_pending_input_id,
             candidates_json, status
      FROM authority_randomness_batches WHERE prepared_action_id = ?
    `, preparedActionId).toArray()[0];
    if (current !== undefined) return current;

    // A v2 object may have been evicted while the original one-request journal
    // was in flight.  Promote that durable row losslessly on first access; the
    // old table remains read-only migration evidence and can still be archived.
    const legacy = this.randomnessJournal(preparedActionId);
    if (legacy === undefined) return undefined;
    const request = parseJson<unknown>(legacy.request_json);
    const candidates = legacy.candidate_faces_json === null
      ? null
      : [{
          randomnessId: legacy.randomness_id,
          faces: parseJson<number[]>(legacy.candidate_faces_json),
        }];
    this.storage.sql.exec(
      `INSERT OR IGNORE INTO authority_randomness_batches (
         prepared_action_id, proposal_hash, requests_json, fulfillment_json,
         request_events_json, answered_pending_input_id, candidates_json, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      legacy.prepared_action_id,
      legacy.proposal_hash,
      JSON.stringify([{
        randomnessId: legacy.randomness_id,
        requestHash: legacy.request_hash,
        frozenParametersHash: legacy.frozen_parameters_hash,
        request,
      }]),
      JSON.stringify({
        kind: "singleContinuation",
        continuation: parseJson<unknown>(legacy.continuation_json),
      }),
      legacy.request_events_json,
      legacy.answered_pending_input_id,
      candidates === null ? null : JSON.stringify(candidates),
      legacy.status,
    );
    return this.storage.sql.exec<AuthorityRandomnessBatchJournalRow>(`
      SELECT prepared_action_id, proposal_hash, requests_json, fulfillment_json,
             request_events_json, answered_pending_input_id,
             candidates_json, status
      FROM authority_randomness_batches WHERE prepared_action_id = ?
    `, preparedActionId).toArray()[0];
  }

  saveRandomnessBatchRequest(input: {
    preparedActionId: string;
    proposalHash: string;
    requests: unknown[];
    fulfillment: unknown;
    requestEvents: EventEnvelope[];
    answeredPendingInputId?: string;
  }): void {
    this.storage.sql.exec(
      `INSERT INTO authority_randomness_batches (
         prepared_action_id, proposal_hash, requests_json, fulfillment_json,
         request_events_json, answered_pending_input_id, candidates_json, status
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'requestCommitted')`,
      input.preparedActionId,
      input.proposalHash,
      JSON.stringify(input.requests),
      JSON.stringify(input.fulfillment),
      JSON.stringify(input.requestEvents),
      input.answeredPendingInputId ?? null,
    );
  }

  saveRandomnessBatchCandidates(
    preparedActionId: string,
    candidates: unknown[],
  ): void {
    this.storage.sql.exec(
      `UPDATE authority_randomness_batches
       SET candidates_json = ?,
           status = CASE
             WHEN status = 'requestCommitted' THEN 'candidateCommitted'
             ELSE status
           END
       WHERE prepared_action_id = ?`,
      JSON.stringify(candidates),
      preparedActionId,
    );
  }

  advanceRandomnessBatchWave(input: {
    preparedActionId: string;
    requests: unknown[];
    fulfillment: unknown;
    requestEvents: EventEnvelope[];
    candidates: unknown[];
  }): void {
    this.storage.sql.exec(
      `UPDATE authority_randomness_batches
       SET requests_json = ?, fulfillment_json = ?, request_events_json = ?,
           candidates_json = ?, status = 'requestCommitted'
       WHERE prepared_action_id = ?`,
      JSON.stringify(input.requests),
      JSON.stringify(input.fulfillment),
      JSON.stringify(input.requestEvents),
      JSON.stringify(input.candidates),
      input.preparedActionId,
    );
  }

  finalizeRandomnessBatch(preparedActionId: string): void {
    this.storage.sql.exec(
      `UPDATE authority_randomness_batches SET status = 'finalized'
       WHERE prepared_action_id = ?`,
      preparedActionId,
    );
  }

  saveRandomnessRequest(input: {
    preparedActionId: string;
    randomnessId: string;
    proposalHash: string;
    requestHash: string;
    frozenParametersHash: string;
    request: unknown;
    continuation: unknown;
    requestEvents: EventEnvelope[];
    answeredPendingInputId?: string;
  }): void {
    this.storage.sql.exec(
      `INSERT INTO authority_randomness_journal (
         prepared_action_id, randomness_id, proposal_hash, request_hash,
         frozen_parameters_hash, request_json, continuation_json,
         request_events_json, answered_pending_input_id,
         candidate_faces_json, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'requestCommitted')`,
      input.preparedActionId,
      input.randomnessId,
      input.proposalHash,
      input.requestHash,
      input.frozenParametersHash,
      JSON.stringify(input.request),
      JSON.stringify(input.continuation),
      JSON.stringify(input.requestEvents),
      input.answeredPendingInputId ?? null,
    );
  }

  saveRandomnessCandidate(preparedActionId: string, faces: number[]): void {
    this.storage.sql.exec(
      `UPDATE authority_randomness_journal
       SET candidate_faces_json = COALESCE(candidate_faces_json, ?),
           status = CASE
             WHEN status = 'requestCommitted' THEN 'candidateCommitted'
             ELSE status
           END
       WHERE prepared_action_id = ?`,
      JSON.stringify(faces),
      preparedActionId,
    );
  }

  finalizeRandomness(preparedActionId: string): void {
    this.storage.sql.exec(
      `UPDATE authority_randomness_journal SET status = 'finalized'
       WHERE prepared_action_id = ?`,
      preparedActionId,
    );
  }

  finishSubmission(
    preparedActionId: string,
    status: "awaitingInput" | "committed" | "concluded",
    proposalHash: string,
    result: unknown,
  ): void {
    this.storage.sql.exec(
      `UPDATE authority_submissions
       SET status = ?, proposal_hash = ?, continuation_json = NULL, result_json = ?
       WHERE prepared_action_id = ?`,
      status,
      proposalHash,
      JSON.stringify(result),
      preparedActionId,
    );
  }

  finishErrorReport(preparedActionId: string, result: unknown): void {
    this.storage.sql.exec(
      `UPDATE authority_submissions
       SET status = 'needsKp', result_json = ?
       WHERE prepared_action_id = ? AND status = 'prepared'`,
      JSON.stringify(result),
      preparedActionId,
    );
  }

  scopeVersion(scopeId: string): number {
    return this.storage.sql.exec<{ version: number }>(
      "SELECT version FROM authority_scope_versions WHERE scope_id = ?",
      scopeId,
    ).toArray()[0]?.version ?? 0;
  }

  advanceScope(scopeId: string): number {
    const next = this.scopeVersion(scopeId) + 1;
    this.storage.sql.exec(
      `INSERT INTO authority_scope_versions (scope_id, version) VALUES (?, ?)
       ON CONFLICT(scope_id) DO UPDATE SET version = excluded.version`,
      scopeId,
      next,
    );
    return next;
  }

  setScopeVersion(scopeId: string, version: number): void {
    this.storage.sql.exec(
      `INSERT INTO authority_scope_versions (scope_id, version) VALUES (?, ?)
       ON CONFLICT(scope_id) DO UPDATE SET version = MAX(version, excluded.version)`,
      scopeId,
      version,
    );
  }

  saveReceipt(receipt: PublicReceipt): void {
    this.storage.sql.exec(
      `INSERT INTO authority_receipts (receipt_id, root_action_id, receipt_json)
       VALUES (?, ?, ?)
       ON CONFLICT(receipt_id) DO UPDATE SET receipt_json = excluded.receipt_json`,
      receipt.receiptId,
      receipt.rootActionId,
      JSON.stringify(receipt),
    );
  }

  receipts(): PublicReceipt[] {
    return this.storage.sql.exec<{ receipt_json: string }>(`
      SELECT receipt_json FROM authority_receipts ORDER BY receipt_id
    `).toArray().map(({ receipt_json }) => parseJson<PublicReceipt>(receipt_json));
  }

  receipt(receiptId: string): PublicReceipt | undefined {
    const row = this.storage.sql.exec<{ receipt_json: string }>(`
      SELECT receipt_json FROM authority_receipts WHERE receipt_id = ?
    `, receiptId).toArray()[0];
    return row === undefined ? undefined : parseJson<PublicReceipt>(row.receipt_json);
  }

  supersedeReceipts(rootActionIds: string[]): PublicReceipt[] {
    const roots = new Set(rootActionIds);
    const superseded: PublicReceipt[] = [];
    for (const receipt of this.receipts()) {
      if (!roots.has(receipt.rootActionId)) continue;
      const next: PublicReceipt = { ...receipt, status: "superseded" };
      this.saveReceipt(next);
      superseded.push(next);
    }
    return superseded;
  }

  saveReceiptReference(receiptId: string, rootActionId: string, reference: unknown): void {
    this.storage.sql.exec(
      `INSERT INTO authority_receipts (receipt_id, root_action_id, receipt_json)
       VALUES (?, ?, ?)
       ON CONFLICT(receipt_id) DO UPDATE SET receipt_json = excluded.receipt_json`,
      receiptId,
      rootActionId,
      JSON.stringify(reference),
    );
  }

  savePending(input: {
    pendingInputId: string;
    rootActionId: string;
    controllerCharacterId: string;
    controllerPrincipalId: string;
    pending: unknown;
  }): void {
    this.storage.sql.exec(
      `INSERT INTO authority_pending_inputs (
         pending_input_id, root_action_id, controller_character_id,
         controller_principal_id, pending_json, status
       ) VALUES (?, ?, ?, ?, ?, 'open')
       ON CONFLICT(pending_input_id) DO UPDATE SET
         root_action_id = excluded.root_action_id,
         controller_character_id = excluded.controller_character_id,
         controller_principal_id = excluded.controller_principal_id,
         pending_json = excluded.pending_json,
         status = 'open'`,
      input.pendingInputId,
      input.rootActionId,
      input.controllerCharacterId,
      input.controllerPrincipalId,
      JSON.stringify(input.pending),
    );
  }

  pending(pendingInputId: string): AuthorityPendingRow | undefined {
    return this.storage.sql.exec<AuthorityPendingRow>(`
      SELECT pending_input_id, root_action_id, controller_character_id,
             controller_principal_id, pending_json, status
      FROM authority_pending_inputs WHERE pending_input_id = ?
    `, pendingInputId).toArray()[0];
  }

  closePending(pendingInputId: string): void {
    this.storage.sql.exec(
      "UPDATE authority_pending_inputs SET status = 'closed' WHERE pending_input_id = ? AND status = 'open'",
      pendingInputId,
    );
  }

  saveDeliveryPlan(plan: DeliveryPlan, sourceEventSeq: string): void {
    this.storage.sql.exec(
      `INSERT INTO authority_delivery_plans (
         publish_capability, receipt_id, root_action_id, active_branch_id,
         source_event_seq, plan_json, publication_hash,
         publication_result_json, status
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'open')`,
      plan.publishCapability,
      plan.receiptId,
      plan.rootActionId,
      plan.activeBranchId,
      sourceEventSeq,
      JSON.stringify(plan),
    );
    for (const audience of plan.audiences) {
      this.storage.sql.exec(
        `INSERT INTO authority_delivery_audiences (
           publish_capability, audience_id, viewer_key, projection_hash,
           delivery_generation, status, attempt_hash, result_json, error_code
         ) VALUES (?, ?, ?, ?, 0, 'pending', NULL, NULL, NULL)`,
        plan.publishCapability,
        audience.audienceId,
        `${audience.principalId}\u001f${audience.characterId}`,
        audience.projectionHash,
      );
    }
  }

  deliveryPlan(publishCapability: string): AuthorityDeliveryPlanRow | undefined {
    return this.storage.sql.exec<AuthorityDeliveryPlanRow>(`
      SELECT publish_capability, receipt_id, root_action_id, active_branch_id,
             source_event_seq, plan_json, publication_hash,
             publication_result_json, status
      FROM authority_delivery_plans WHERE publish_capability = ?
    `, publishCapability).toArray()[0];
  }

  deliveryAudiences(publishCapability: string): AuthorityDeliveryAudienceRow[] {
    return this.storage.sql.exec<AuthorityDeliveryAudienceRow>(`
      SELECT publish_capability, audience_id, viewer_key, projection_hash,
             delivery_generation, status, attempt_hash, result_json, error_code
      FROM authority_delivery_audiences
      WHERE publish_capability = ?
      ORDER BY audience_id
    `, publishCapability).toArray();
  }

  deliveryAudience(
    publishCapability: string,
    audienceId: string,
  ): AuthorityDeliveryAudienceRow | undefined {
    return this.storage.sql.exec<AuthorityDeliveryAudienceRow>(`
      SELECT publish_capability, audience_id, viewer_key, projection_hash,
             delivery_generation, status, attempt_hash, result_json, error_code
      FROM authority_delivery_audiences
      WHERE publish_capability = ? AND audience_id = ?
    `, publishCapability, audienceId).toArray()[0];
  }

  /** Returns at most one unfinished publication owned by this exact frozen
   * ViewerKey. Ordering is by authoritative source sequence, not insertion
   * timing, so Durable Object eviction cannot change which recovery is shown. */
  recoverableDeliveryAudience(viewerKey: string): AuthorityDeliveryAudienceRow | undefined {
    return this.storage.sql.exec<AuthorityDeliveryAudienceRow>(`
      SELECT audience.publish_capability, audience.audience_id,
             audience.viewer_key, audience.projection_hash,
             audience.delivery_generation, audience.status,
             audience.attempt_hash, audience.result_json, audience.error_code
      FROM authority_delivery_audiences AS audience
      JOIN authority_delivery_plans AS plan
        ON plan.publish_capability = audience.publish_capability
      WHERE audience.viewer_key = ?
        AND audience.status IN ('pending', 'rejected', 'retryableFailure')
        AND plan.status = 'open'
      ORDER BY length(plan.source_event_seq) DESC, plan.source_event_seq DESC
      LIMIT 1
    `, viewerKey).toArray()[0];
  }

  /** Lists unfinished journals whose frozen ViewerKey belongs to one
   * principal. The Room still has to revalidate the exact frozen Seat,
   * Character, session, projection hash, and plan before authorizing use. */
  recoverableDeliveryAudiencesForPrincipal(
    principalId: string,
  ): AuthorityDeliveryAudienceRow[] {
    const viewerKeyPrefix = `${principalId}\u001f`;
    return this.storage.sql.exec<AuthorityDeliveryAudienceRow>(`
      SELECT audience.publish_capability, audience.audience_id,
             audience.viewer_key, audience.projection_hash,
             audience.delivery_generation, audience.status,
             audience.attempt_hash, audience.result_json, audience.error_code
      FROM authority_delivery_audiences AS audience
      JOIN authority_delivery_plans AS plan
        ON plan.publish_capability = audience.publish_capability
      WHERE instr(audience.viewer_key, ?) = 1
        AND audience.status IN ('pending', 'rejected', 'retryableFailure')
        AND plan.status = 'open'
      ORDER BY length(plan.source_event_seq) DESC, plan.source_event_seq DESC,
               audience.audience_id
    `, viewerKeyPrefix).toArray();
  }

  /** Backfills open plans created by the immediately preceding delivery
   * protocol. Their frozen plan remains the source for viewer identity. */
  ensureDeliveryAudiences(plan: DeliveryPlan): AuthorityDeliveryAudienceRow[] {
    let rows = this.deliveryAudiences(plan.publishCapability);
    if (rows.length === plan.audiences.length) return rows;
    if (rows.length !== 0) {
      throw new Error("Delivery audience journal is only partially initialized.");
    }
    for (const audience of plan.audiences) {
      this.storage.sql.exec(
        `INSERT OR IGNORE INTO authority_delivery_audiences (
           publish_capability, audience_id, viewer_key, projection_hash,
           delivery_generation, status, attempt_hash, result_json, error_code
         ) VALUES (?, ?, ?, ?, 0, 'pending', NULL, NULL, NULL)`,
        plan.publishCapability,
        audience.audienceId,
        `${audience.principalId}\u001f${audience.characterId}`,
        audience.projectionHash,
      );
    }
    rows = this.deliveryAudiences(plan.publishCapability);
    if (rows.length !== plan.audiences.length) {
      throw new Error("Delivery audience journal could not be initialized.");
    }
    return rows;
  }

  beginDeliveryAudienceAttempt(
    publishCapability: string,
    audienceId: string,
  ): number | undefined {
    this.storage.sql.exec(
      `UPDATE authority_delivery_audiences
       SET delivery_generation = delivery_generation + 1,
           status = 'pending', attempt_hash = NULL,
           result_json = NULL, error_code = NULL
       WHERE publish_capability = ? AND audience_id = ?
         AND status IN ('pending', 'rejected', 'retryableFailure')`,
      publishCapability,
      audienceId,
    );
    return this.storage.sql.exec<{ delivery_generation: number }>(`
      SELECT delivery_generation FROM authority_delivery_audiences
      WHERE publish_capability = ? AND audience_id = ?
    `, publishCapability, audienceId).toArray()[0]?.delivery_generation;
  }

  finishDeliveryAudience(input: {
    publishCapability: string;
    audienceId: string;
    attemptHash: string;
    state: "published" | "superseded";
    result: unknown;
  }): void {
    this.storage.sql.exec(
      `UPDATE authority_delivery_audiences
       SET status = ?, attempt_hash = ?, result_json = ?, error_code = NULL
       WHERE publish_capability = ? AND audience_id = ?`,
      input.state,
      input.attemptHash,
      JSON.stringify(input.result),
      input.publishCapability,
      input.audienceId,
    );
  }

  failDeliveryAudience(input: {
    publishCapability: string;
    audienceId: string;
    state: "rejected" | "retryableFailure";
    errorCode: string;
  }): void {
    this.storage.sql.exec(
      `UPDATE authority_delivery_audiences
       SET status = ?, attempt_hash = NULL, result_json = NULL, error_code = ?
       WHERE publish_capability = ? AND audience_id = ?
         AND status <> 'published' AND status <> 'superseded'`,
      input.state,
      input.errorCode,
      input.publishCapability,
      input.audienceId,
    );
  }

  deliveryPlanTombstone(
    publishCapability: string,
  ): AuthorityDeliveryPlanTombstoneRow | undefined {
    return this.storage.sql.exec<AuthorityDeliveryPlanTombstoneRow>(`
      SELECT publish_capability, receipt_id, root_action_id, reason
      FROM authority_delivery_plan_tombstones WHERE publish_capability = ?
    `, publishCapability).toArray()[0];
  }

  supersedeOpenDeliveryPlan(publishCapability: string): boolean {
    const plan = this.deliveryPlan(publishCapability);
    if (plan === undefined || plan.status !== "open") return false;
    this.storage.sql.exec(
      `INSERT OR IGNORE INTO authority_delivery_plan_tombstones (
         publish_capability, receipt_id, root_action_id, reason
       ) VALUES (?, ?, ?, 'superseded')`,
      plan.publish_capability,
      plan.receipt_id,
      plan.root_action_id,
    );
    this.storage.sql.exec(
      "DELETE FROM authority_delivery_audiences WHERE publish_capability = ?",
      publishCapability,
    );
    this.storage.sql.exec(
      "DELETE FROM authority_delivery_plans WHERE publish_capability = ? AND status = 'open'",
      publishCapability,
    );
    return this.deliveryPlan(publishCapability) === undefined;
  }

  finishDeliveryPlan(
    publishCapability: string,
    publicationHash: string,
    status: "published" | "superseded",
    result: unknown,
  ): void {
    this.storage.sql.exec(
      `UPDATE authority_delivery_plans
       SET publication_hash = ?, publication_result_json = ?, status = ?
       WHERE publish_capability = ?`,
      publicationHash,
      JSON.stringify(result),
      status,
      publishCapability,
    );
  }

  deliverySlot(viewerKey: string): AuthorityDeliverySlotRow | undefined {
    return this.storage.sql.exec<AuthorityDeliverySlotRow>(`
      SELECT viewer_key, principal_id, character_id, delivery_id,
             source_event_seq, frame_json
      FROM authority_delivery_slots WHERE viewer_key = ?
    `, viewerKey).toArray()[0];
  }

  deliveryWatermark(viewerKey: string): string | undefined {
    return this.storage.sql.exec<{ source_event_seq: string }>(`
      SELECT source_event_seq FROM authority_delivery_watermarks WHERE viewer_key = ?
    `, viewerKey).toArray()[0]?.source_event_seq;
  }

  advanceDeliveryWatermark(viewerKey: string, sourceEventSeq: string): void {
    this.storage.sql.exec(
      `INSERT INTO authority_delivery_watermarks (viewer_key, source_event_seq)
       VALUES (?, ?)
       ON CONFLICT(viewer_key) DO UPDATE SET source_event_seq = excluded.source_event_seq`,
      viewerKey,
      sourceEventSeq,
    );
  }

  replaceDeliverySlot(input: {
    viewerKey: string;
    principalId: string;
    characterId: string;
    sourceEventSeq: string;
    frame: DeliveryFrame;
  }): void {
    this.storage.sql.exec(
      `INSERT INTO authority_delivery_slots (
         viewer_key, principal_id, character_id, delivery_id,
         source_event_seq, frame_json
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(viewer_key) DO UPDATE SET
         principal_id = excluded.principal_id,
         character_id = excluded.character_id,
         delivery_id = excluded.delivery_id,
         source_event_seq = excluded.source_event_seq,
         frame_json = excluded.frame_json`,
      input.viewerKey,
      input.principalId,
      input.characterId,
      input.frame.deliveryId,
      input.sourceEventSeq,
      JSON.stringify(input.frame),
    );
  }

  appendExperiencedMessage(input: ExperiencedTranscriptMessageInput): boolean {
    const result = this.storage.sql.exec(
      `INSERT INTO authority_experienced_messages (
         viewer_key, message_id, scene_ids_json, kind, speaker_character_id,
         speaker_name, body, source_event_seq, receipt_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(viewer_key, message_id) DO NOTHING`,
      input.viewerKey,
      input.messageId,
      JSON.stringify(input.sceneIds),
      input.kind,
      input.speakerCharacterId,
      input.speakerName,
      input.body,
      input.sourceEventSeq,
      input.receiptId,
    );
    return result.rowsWritten > 0;
  }

  experiencedMessages(viewerKey: string, limit = 240): ExperiencedTranscriptMessage[] {
    const boundedLimit = Math.max(1, Math.min(1_000, Math.trunc(limit)));
    return this.storage.sql.exec<AuthorityExperiencedMessageRow>(`
      SELECT ordinal, viewer_key, message_id, scene_ids_json, kind,
             speaker_character_id, speaker_name, body, source_event_seq, receipt_id
      FROM (
        SELECT ordinal, viewer_key, message_id, scene_ids_json, kind,
               speaker_character_id, speaker_name, body, source_event_seq, receipt_id
        FROM authority_experienced_messages
        WHERE viewer_key = ?
        ORDER BY ordinal DESC
        LIMIT ?
      )
      ORDER BY ordinal
    `, viewerKey, boundedLimit).toArray().map((row) => ({
      ordinal: row.ordinal,
      messageId: row.message_id,
      sceneIds: parseJson<string[]>(row.scene_ids_json),
      kind: row.kind,
      speakerCharacterId: row.speaker_character_id,
      speakerName: row.speaker_name,
      body: row.body,
      sourceEventSeq: row.source_event_seq,
      receiptId: row.receipt_id,
    }));
  }

  experiencedMessagesForScene(
    viewerKey: string,
    sceneId: string,
    limit = 48,
  ): ExperiencedTranscriptMessage[] {
    const boundedLimit = Math.max(1, Math.min(240, Math.trunc(limit)));
    return this.storage.sql.exec<AuthorityExperiencedMessageRow>(`
      SELECT ordinal, viewer_key, message_id, scene_ids_json, kind,
             speaker_character_id, speaker_name, body, source_event_seq, receipt_id
      FROM (
        SELECT message.ordinal, message.viewer_key, message.message_id,
               message.scene_ids_json, message.kind, message.speaker_character_id,
               message.speaker_name, message.body, message.source_event_seq,
               message.receipt_id
        FROM authority_experienced_messages AS message
        WHERE message.viewer_key = ?
          AND EXISTS (
            SELECT 1
            FROM json_each(message.scene_ids_json) AS scene
            WHERE scene.value = ?
          )
        ORDER BY message.ordinal DESC
        LIMIT ?
      )
      ORDER BY ordinal
    `, viewerKey, sceneId, boundedLimit).toArray().map((row) => ({
      ordinal: row.ordinal,
      messageId: row.message_id,
      sceneIds: parseJson<string[]>(row.scene_ids_json),
      kind: row.kind,
      speakerCharacterId: row.speaker_character_id,
      speakerName: row.speaker_name,
      body: row.body,
      sourceEventSeq: row.source_event_seq,
      receiptId: row.receipt_id,
    }));
  }

  tombstoneDelivery(
    slot: AuthorityDeliverySlotRow,
    receiptId: string,
    payloadHash: string,
    reason: "acknowledged" | "superseded",
  ): void {
    this.storage.sql.exec(
      `INSERT OR IGNORE INTO authority_delivery_tombstones (
         delivery_id, viewer_key, receipt_id, payload_hash, reason
       ) VALUES (?, ?, ?, ?, ?)`,
      slot.delivery_id,
      slot.viewer_key,
      receiptId,
      payloadHash,
      reason,
    );
  }

  deleteDeliverySlot(viewerKey: string): void {
    this.storage.sql.exec("DELETE FROM authority_delivery_slots WHERE viewer_key = ?", viewerKey);
  }

  acknowledgement(acknowledgementId: string): AuthorityAcknowledgementRow | undefined {
    return this.storage.sql.exec<AuthorityAcknowledgementRow>(`
      SELECT acknowledgement_id, principal_id, payload_hash, result_json
      FROM authority_delivery_acknowledgements WHERE acknowledgement_id = ?
    `, acknowledgementId).toArray()[0];
  }

  saveAcknowledgement(input: {
    acknowledgementId: string;
    principalId: string;
    payloadHash: string;
    result: unknown;
  }): void {
    this.storage.sql.exec(
      `INSERT INTO authority_delivery_acknowledgements (
         acknowledgement_id, principal_id, payload_hash, result_json
       ) VALUES (?, ?, ?, ?)`,
      input.acknowledgementId,
      input.principalId,
      input.payloadHash,
      JSON.stringify(input.result),
    );
  }

  supersedeCharacterDeliveries(characterIds: string[]): void {
    const affected = new Set(characterIds);
    if (affected.size === 0) return;
    for (const plan of this.storage.sql.exec<AuthorityDeliveryPlanRow>(`
      SELECT publish_capability, receipt_id, root_action_id, active_branch_id,
             source_event_seq, plan_json, publication_hash,
             publication_result_json, status
      FROM authority_delivery_plans
    `).toArray()) {
      const parsed = parseJson<DeliveryPlan>(plan.plan_json);
      if (!parsed.audiences.some((audience) => affected.has(audience.characterId))) continue;
      this.storage.sql.exec(
        `INSERT OR IGNORE INTO authority_delivery_plan_tombstones (
           publish_capability, receipt_id, root_action_id, reason
         ) VALUES (?, ?, ?, 'superseded')`,
        plan.publish_capability,
        plan.receipt_id,
        plan.root_action_id,
      );
      this.storage.sql.exec(
        "DELETE FROM authority_delivery_audiences WHERE publish_capability = ?",
        plan.publish_capability,
      );
      this.storage.sql.exec(
        "DELETE FROM authority_delivery_plans WHERE publish_capability = ?",
        plan.publish_capability,
      );
    }
    for (const slot of this.storage.sql.exec<AuthorityDeliverySlotRow>(`
      SELECT viewer_key, principal_id, character_id, delivery_id,
             source_event_seq, frame_json
      FROM authority_delivery_slots
    `).toArray()) {
      if (!affected.has(slot.character_id)) continue;
      const frame = parseJson<DeliveryFrame>(slot.frame_json);
      this.tombstoneDelivery(slot, frame.receiptId, frame.payloadHash, "superseded");
      this.deleteDeliverySlot(slot.viewer_key);
    }
  }

  supersedeDeliveries(rootActionIds: string[]): void {
    const roots = new Set(rootActionIds);
    const plans = this.storage.sql.exec<AuthorityDeliveryPlanRow>(`
      SELECT publish_capability, receipt_id, root_action_id, active_branch_id,
             source_event_seq, plan_json, publication_hash,
             publication_result_json, status
      FROM authority_delivery_plans
    `).toArray().filter((plan) => roots.has(plan.root_action_id));
    const receiptIds = new Set([
      ...plans.map((plan) => plan.receipt_id),
      ...this.receipts()
        .filter((receipt) => roots.has(receipt.rootActionId))
        .map((receipt) => receipt.receiptId),
    ]);
    for (const plan of plans) {
      this.storage.sql.exec(
        `INSERT OR IGNORE INTO authority_delivery_plan_tombstones (
           publish_capability, receipt_id, root_action_id, reason
         ) VALUES (?, ?, ?, 'superseded')`,
        plan.publish_capability,
        plan.receipt_id,
        plan.root_action_id,
      );
      this.storage.sql.exec(
        "DELETE FROM authority_delivery_audiences WHERE publish_capability = ?",
        plan.publish_capability,
      );
      this.storage.sql.exec(
        "DELETE FROM authority_delivery_plans WHERE publish_capability = ?",
        plan.publish_capability,
      );
    }
    for (const slot of this.storage.sql.exec<AuthorityDeliverySlotRow>(`
      SELECT viewer_key, principal_id, character_id, delivery_id,
             source_event_seq, frame_json
      FROM authority_delivery_slots
    `).toArray()) {
      const frame = parseJson<DeliveryFrame>(slot.frame_json);
      if (!receiptIds.has(frame.receiptId)) continue;
      this.tombstoneDelivery(slot, frame.receiptId, frame.payloadHash, "superseded");
      this.deleteDeliverySlot(slot.viewer_key);
    }
  }

  deliverySlotsForRootActions(rootActionIds: string[]): AuthorityDeliverySlotRow[] {
    const roots = new Set(rootActionIds);
    if (roots.size === 0) return [];
    const receiptIds = new Set(this.receipts()
      .filter((receipt) => roots.has(receipt.rootActionId))
      .map((receipt) => receipt.receiptId));
    if (receiptIds.size === 0) return [];
    return this.storage.sql.exec<AuthorityDeliverySlotRow>(`
      SELECT viewer_key, principal_id, character_id, delivery_id,
             source_event_seq, frame_json
      FROM authority_delivery_slots
      ORDER BY viewer_key
    `).toArray().filter((slot) => {
      const frame = parseJson<DeliveryFrame>(slot.frame_json);
      return receiptIds.has(frame.receiptId);
    });
  }

  correction(correctionId: string): AuthorityCorrectionRow | undefined {
    return this.storage.sql.exec<AuthorityCorrectionRow>(`
      SELECT correction_id, payload_hash, target_receipt_id, result_json
      FROM authority_corrections WHERE correction_id = ?
    `, correctionId).toArray()[0];
  }

  saveCorrection(input: {
    correctionId: string;
    payloadHash: string;
    targetReceiptId: string;
    result: unknown;
  }): void {
    this.storage.sql.exec(
      `INSERT INTO authority_corrections (
         correction_id, payload_hash, target_receipt_id, result_json
       ) VALUES (?, ?, ?, ?)`,
      input.correctionId,
      input.payloadHash,
      input.targetReceiptId,
      JSON.stringify(input.result),
    );
  }

  administration(commandId: string): AuthorityAdministrationRow | undefined {
    return this.storage.sql.exec<AuthorityAdministrationRow>(`
      SELECT command_id, payload_hash, result_json
      FROM authority_room_administration WHERE command_id = ?
    `, commandId).toArray()[0];
  }

  saveAdministration(input: {
    commandId: string;
    payloadHash: string;
    result: unknown;
  }): void {
    this.storage.sql.exec(
      `INSERT INTO authority_room_administration (
         command_id, payload_hash, result_json
       ) VALUES (?, ?, ?)`,
      input.commandId,
      input.payloadHash,
      JSON.stringify(input.result),
    );
  }

  roomDeletion(): AuthorityRoomDeletionRow | undefined {
    return this.storage.sql.exec<AuthorityRoomDeletionRow>(`
      SELECT room_id, principal_id, prepared_at
      FROM authority_room_deletion WHERE singleton = 1
    `).toArray()[0];
  }

  prepareRoomDeletion(roomId: string, principalId: string, preparedAt: number): void {
    this.storage.sql.exec(
      `INSERT INTO authority_room_deletion (
         singleton, room_id, principal_id, prepared_at
       ) VALUES (1, ?, ?, ?)
       ON CONFLICT(singleton) DO NOTHING`,
      roomId,
      principalId,
      preparedAt,
    );
  }

  cancelRoomDeletion(roomId: string, principalId: string): void {
    this.storage.sql.exec(
      `DELETE FROM authority_room_deletion
       WHERE singleton = 1 AND room_id = ? AND principal_id = ?`,
      roomId,
      principalId,
    );
  }

  /**
   * Explicitly erases every authoritative-v2 application table. This list is
   * intentionally kept beside ensureSchema so room deletion cannot silently
   * leave a newly introduced authority table behind.
   */
  clearAllRowsForDeletion(): void {
    this.storage.sql.exec(`
      DELETE FROM authority_delivery_acknowledgements;
      DELETE FROM authority_delivery_slots;
      DELETE FROM authority_experienced_messages;
      DELETE FROM authority_delivery_watermarks;
      DELETE FROM authority_delivery_tombstones;
      DELETE FROM authority_delivery_plan_tombstones;
      DELETE FROM authority_delivery_audiences;
      DELETE FROM authority_delivery_plans;
      DELETE FROM authority_pending_inputs;
      DELETE FROM authority_randomness_batches;
      DELETE FROM authority_randomness_journal;
      DELETE FROM authority_proposal_recovery;
      DELETE FROM authority_action_stages;
      DELETE FROM authority_submissions;
      DELETE FROM authority_corrections;
      DELETE FROM authority_room_administration;
      DELETE FROM authority_receipts;
      DELETE FROM authority_scope_versions;
      DELETE FROM authority_events;
      DELETE FROM authority_characters;
      DELETE FROM authority_members;
      DELETE FROM authority_archive_progress;
      DELETE FROM authority_rooms;
      DELETE FROM authority_room_deletion;
    `);
  }
}
