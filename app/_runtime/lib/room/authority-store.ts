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
import type { DueActivityDescriptor } from "../rules/v2/model";
import { canonicalHash, parseJsonWithUniqueMembers } from "../kp/vnext/canonical-json";
import { isCanonicalAuthorityRecoveryInput } from "./authority-commit-recovery";
import type { StoryFrozenNpcContext, StoryFrozenNarrationContext } from "./story-archive-host";
import { storyNpcPendingOwner, storyNpcPendingPreparedActionId, type StoryFrozenNpcPendingContext } from "./story-npc-pending";
import type { StoryFrozenWorldContext } from "./story-world-event-host";
import type { AuthoritativeModuleProfile } from "../module/authoritative";

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

export type AuthorityEventHead = {
  eventCount: number;
  eventSeq: string;
  eventId: string;
  eventJson: string;
};

export type AuthoritySubmissionRow = {
  submission_id: string;
  principal_id: string | null;
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

export type AuthorityDueWorkRow = {
  child_root_action_id: string;
  cause_root_action_id: string;
  cause_event_id: string;
  descriptor_json: string;
  timeline_id: string;
  completion_fiction_micros: string;
  activity_id: string | null;
  work_kind: "activity" | "npcWork" | "promiseReview";
  work_ref: string;
  status: "pending" | "committed" | "cancelled";
  next_attempt_at: number | null;
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

export type AuthorityRandomnessAuthorizationRow = {
  prepared_action_id: string;
  randomness_id: string;
  principal_id: string;
  character_id: string;
};

export type AuthorityProposalRecoveryRow = {
  prepared_action_id: string;
  proposal_hash: string;
  recovery_hash: string;
  recovery_json: string;
};

export type AuthorityVNextStageProofRow = {
  prepared_action_id: string;
  ordinal: number;
  context_hash: string;
  binding_hash: string;
  request_hash: string;
  repair_ticket_json: string | null;
  invocation_id: string;
  external_binding_json: string;
};

export type AuthorityNpcDecisionRow = {
  prepared_action_id: string;
  capability: string;
  pending_input_id: string;
  proposal_hash: string;
  wave_index: number;
  input_json: string;
  request_json: string;
  answer_json: string | null;
};

/** Exact private operational rows. Published results/Delivery are deliberately
 * absent; a trusted archive retains frozen model premises, not old UI output. */
export type AuthorityStoryHostContextRow = {
  prepared_action_id: string;
  context_kind: "npc" | "narration" | "admission" | "preparationModule" | "npcPending" | "npcPendingAnswer" | "npcPendingOwner" | "npcPendingOwnerHost" | "world" | "worldOutcome";
  context_json: string;
};
export type AuthorityStoryHostSnapshot = {
  submissions: Omit<AuthoritySubmissionRow, "result_json">[];
  dueWork: AuthorityDueWorkRow[];
  recoveries: AuthorityProposalRecoveryRow[];
  proofs: AuthorityVNextStageProofRow[];
  contexts: AuthorityStoryHostContextRow[];
  scopes: { scope_id: string; version: number }[];
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
  kind: "player" | "kp" | "roll";
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
        principal_id TEXT CHECK (principal_id IS NOT NULL OR input_kind = 'dueActivity'),
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
      CREATE TABLE IF NOT EXISTS authority_due_work (
        child_root_action_id TEXT PRIMARY KEY,
        cause_root_action_id TEXT NOT NULL,
        cause_event_id TEXT NOT NULL,
        descriptor_json TEXT NOT NULL,
        timeline_id TEXT NOT NULL,
        completion_fiction_micros TEXT NOT NULL,
        activity_id TEXT,
        work_kind TEXT NOT NULL DEFAULT 'activity',
        work_ref TEXT NOT NULL,
        next_attempt_at INTEGER,
        status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'cancelled'))
      );
      CREATE INDEX IF NOT EXISTS authority_due_work_pending_idx
        ON authority_due_work(status, timeline_id);
      CREATE TABLE IF NOT EXISTS authority_npc_decisions (
        prepared_action_id TEXT PRIMARY KEY,
        capability TEXT NOT NULL UNIQUE,
        pending_input_id TEXT NOT NULL,
        proposal_hash TEXT NOT NULL,
        wave_index INTEGER NOT NULL,
        input_json TEXT NOT NULL,
        request_json TEXT NOT NULL,
        answer_json TEXT
      );
      CREATE TABLE IF NOT EXISTS authority_vnext_stage_proofs (
        prepared_action_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK (ordinal IN (1, 2, 3, 4)),
        context_hash TEXT NOT NULL, binding_hash TEXT NOT NULL, request_hash TEXT NOT NULL,
        repair_ticket_json TEXT, invocation_id TEXT NOT NULL UNIQUE,
        external_binding_json TEXT NOT NULL,
        PRIMARY KEY (prepared_action_id, ordinal)
      );
      CREATE TABLE IF NOT EXISTS authority_story_host_contexts (
        prepared_action_id TEXT NOT NULL,
        context_kind TEXT NOT NULL CHECK (context_kind IN ('npc', 'narration', 'admission', 'preparationModule',
          'npcPending', 'npcPendingAnswer', 'npcPendingOwner', 'npcPendingOwnerHost', 'world', 'worldOutcome')),
        context_json TEXT NOT NULL,
        PRIMARY KEY (prepared_action_id, context_kind)
      );
      CREATE TABLE IF NOT EXISTS authority_vnext_invocation_audits (
        capability TEXT PRIMARY KEY,
        prepared_action_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        outcome_json TEXT,
        revision_json TEXT
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
      CREATE TABLE IF NOT EXISTS authority_randomness_authorizations (
        prepared_action_id TEXT NOT NULL,
        randomness_id TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        PRIMARY KEY (prepared_action_id, randomness_id, character_id)
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
        kind TEXT NOT NULL CHECK (kind IN ('player', 'kp', 'roll')),
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
    const authorizationColumns = this.storage.sql.exec<{ name: string; pk: number }>(
      "PRAGMA table_info(authority_randomness_authorizations)",
    ).toArray();
    if (!authorizationColumns.some(column => column.name === "character_id" && column.pk > 0)) {
      this.storage.transactionSync(() => this.storage.sql.exec(`
        ALTER TABLE authority_randomness_authorizations RENAME TO authority_randomness_authorizations_single_owner;
        CREATE TABLE authority_randomness_authorizations (
          prepared_action_id TEXT NOT NULL, randomness_id TEXT NOT NULL,
          principal_id TEXT NOT NULL, character_id TEXT NOT NULL,
          PRIMARY KEY (prepared_action_id, randomness_id, character_id)
        );
        INSERT INTO authority_randomness_authorizations
          SELECT prepared_action_id, randomness_id, principal_id, character_id FROM authority_randomness_authorizations_single_owner;
        DROP TABLE authority_randomness_authorizations_single_owner;
      `));
    }
    const transcriptSchema = this.storage.sql.exec<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'authority_experienced_messages'",
    ).one().sql;
    if (!transcriptSchema.includes("'roll'")) {
      // SQLite cannot extend a CHECK in place. Keep every message and ordinal
      // while adding the derived dice-message kind in one local transaction.
      this.storage.transactionSync(() => this.storage.sql.exec(`
        ALTER TABLE authority_experienced_messages RENAME TO authority_experienced_messages_before_dice;
        CREATE TABLE authority_experienced_messages (
          ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
          viewer_key TEXT NOT NULL, message_id TEXT NOT NULL, scene_ids_json TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('player', 'kp', 'roll')),
          speaker_character_id TEXT, speaker_name TEXT NOT NULL, body TEXT NOT NULL,
          source_event_seq TEXT NOT NULL, receipt_id TEXT NOT NULL
        );
        INSERT INTO authority_experienced_messages
          SELECT ordinal, viewer_key, message_id, scene_ids_json, kind, speaker_character_id,
            speaker_name, body, source_event_seq, receipt_id FROM authority_experienced_messages_before_dice;
        DROP TABLE authority_experienced_messages_before_dice;
        CREATE UNIQUE INDEX authority_experienced_messages_identity_idx ON authority_experienced_messages(viewer_key, message_id);
        CREATE INDEX authority_experienced_messages_viewer_order_idx ON authority_experienced_messages(viewer_key, ordinal);
      `));
    }
    const dueColumns = this.storage.sql.exec<{ name: string }>("PRAGMA table_info(authority_due_work)").toArray();
    if (!dueColumns.some(column => column.name === "work_kind")) {
      // Preserve the exact descriptors, roots, causes and retry states of all
      // outstanding work while removing the Activity-only storage constraint.
      this.storage.transactionSync(() => this.storage.sql.exec(`
        ALTER TABLE authority_due_work RENAME TO authority_due_work_activity_only;
        DROP INDEX authority_due_work_pending_idx;
        CREATE TABLE authority_due_work (
          child_root_action_id TEXT PRIMARY KEY, cause_root_action_id TEXT NOT NULL,
          cause_event_id TEXT NOT NULL, descriptor_json TEXT NOT NULL, timeline_id TEXT NOT NULL,
          completion_fiction_micros TEXT NOT NULL, activity_id TEXT,
          work_kind TEXT NOT NULL DEFAULT 'activity', work_ref TEXT NOT NULL,
          next_attempt_at INTEGER, status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'cancelled'))
        );
        INSERT INTO authority_due_work SELECT child_root_action_id, cause_root_action_id, cause_event_id,
          descriptor_json, timeline_id, completion_fiction_micros, activity_id, 'activity', activity_id,
          next_attempt_at, status FROM authority_due_work_activity_only;
        DROP TABLE authority_due_work_activity_only;
        CREATE INDEX authority_due_work_pending_idx ON authority_due_work(status, timeline_id);
      `));
    }
    const principalColumn = this.storage.sql.exec<{ name: string; notnull: number }>(
      "PRAGMA table_info(authority_submissions)",
    ).toArray().find(column => column.name === "principal_id");
    if (principalColumn?.notnull === 1) {
      // SQLite cannot remove NOT NULL in place. Preserve every existing row
      // atomically; CREATE IF NOT EXISTS alone cannot evolve this constraint.
      this.storage.transactionSync(() => this.storage.sql.exec(`
        ALTER TABLE authority_submissions RENAME TO authority_submissions_principal_required;
        DROP INDEX authority_submissions_root_idx;
        CREATE TABLE authority_submissions (
          submission_id TEXT PRIMARY KEY,
          principal_id TEXT CHECK (principal_id IS NOT NULL OR input_kind = 'dueActivity'),
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
        INSERT INTO authority_submissions (
          submission_id, principal_id, payload_hash, input_kind, root_action_id,
          prepared_action_id, character_id, scene_scope, prepared_scope_version,
          status, proposal_hash, prepared_json, continuation_json, result_json
        ) SELECT submission_id, principal_id, payload_hash, input_kind, root_action_id,
          prepared_action_id, character_id, scene_scope, prepared_scope_version,
          status, proposal_hash, prepared_json, continuation_json, result_json
          FROM authority_submissions_principal_required;
        DROP TABLE authority_submissions_principal_required;
        CREATE INDEX authority_submissions_root_idx ON authority_submissions(root_action_id);
      `));
    }
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
        + (SELECT COUNT(*) FROM authority_due_work)
        + (SELECT COUNT(*) FROM authority_proposal_recovery)
        + (SELECT COUNT(*) FROM authority_vnext_stage_proofs)
        + (SELECT COUNT(*) FROM authority_story_host_contexts)
        + (SELECT COUNT(*) FROM authority_vnext_invocation_audits)
        + (SELECT COUNT(*) FROM authority_npc_decisions)
        + (SELECT COUNT(*) FROM authority_randomness_batches)
        + (SELECT COUNT(*) FROM authority_randomness_authorizations)
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
    // Rules already validated the supplied state. Mirror its exact identities;
    // historical rooms deliberately create room-scoped seats and fresh control.
    const state = input.state as AuthoritativeWorldState;
    const members = input.members.map(member => {
      const seats = Object.values(state.seats).filter(seat => seat.principalId === member.principalId && seat.status === "active");
      const principal = state.principals[member.principalId];
      if (seats.length !== 1 || principal === undefined || !Number.isSafeInteger(principal.sessionVersion) || principal.sessionVersion <= 0) {
        throw new Error("AUTHORITATIVE_MEMBER_IDENTITY_INVALID");
      }
      return { ...member, seatId: seats[0].id, sessionVersion: principal.sessionVersion };
    });
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
    for (const member of members) {
      this.storage.sql.exec(
        `INSERT INTO authority_members (principal_id, role, session_version, seat_id)
         VALUES (?, ?, ?, ?)`,
        member.principalId,
        member.role,
        member.sessionVersion,
        member.seatId,
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

  /** `dueAt` is when this room may next spend its Durable Object on archiving.
   * Ordinary play passes a coalescing delay so a burst of commits produces one
   * later page instead of one page per commit; an operation that must read a
   * current archive passes `nowMs` and waits for it. An earlier deadline
   * already recorded always wins, so a flush can only bring work forward. */
  markArchivePending(nowMs: number, dueAt: number = nowMs): AuthorityArchiveProgressState | undefined {
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
      dueAt,
      dueAt,
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

  eventHead(): AuthorityEventHead | undefined {
    const row = this.storage.sql.exec<{
      event_count: number;
      event_seq: string;
      event_id: string;
      event_json: string;
    }>(`
      SELECT event_seq, event_id, event_json, COUNT(*) OVER () AS event_count
      FROM authority_events
      ORDER BY length(event_seq) DESC, event_seq DESC
      LIMIT 1
    `).toArray()[0];
    return row === undefined
      ? undefined
      : {
          eventCount: row.event_count,
          eventSeq: row.event_seq,
          eventId: row.event_id,
          eventJson: row.event_json,
        };
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

  submissionByRoot(rootActionId: string): AuthoritySubmissionRow | undefined {
    const rows = this.storage.sql.exec<AuthoritySubmissionRow>(
      "SELECT * FROM authority_submissions WHERE root_action_id = ? LIMIT 2", rootActionId,
    ).toArray();
    if (rows.length > 1) throw new TypeError("STORY_ARCHIVE_HOST_IDENTITY_CONFLICT");
    return rows[0];
  }

  awaitingRandomnessSubmissions(): AuthoritySubmissionRow[] {
    return this.storage.sql.exec<AuthoritySubmissionRow>(`
      SELECT submission_id, principal_id, payload_hash, input_kind,
             root_action_id, prepared_action_id, character_id, scene_scope,
             prepared_scope_version, status, proposal_hash, prepared_json,
             continuation_json, result_json
      FROM authority_submissions
      WHERE status = 'awaitingRandomness'
      ORDER BY prepared_action_id
    `).toArray();
  }

  actionStage(preparedActionId: string): AuthorityActionStageRow | undefined {
    return this.storage.sql.exec<AuthorityActionStageRow>(`
      SELECT prepared_action_id, submission_id, phase, target_id,
             child_root_action_id, status, proposal_hash, result_json
      FROM authority_action_stages WHERE prepared_action_id = ?
    `, preparedActionId).toArray()[0];
  }

  enqueueDueWork(input: { causeRootActionId: string; causeEventId: string; activity: DueActivityDescriptor }): void {
    const due = input.activity;
    this.storage.sql.exec(`INSERT INTO authority_due_work (
      child_root_action_id, cause_root_action_id, cause_event_id, descriptor_json,
      timeline_id, completion_fiction_micros, activity_id, work_kind, work_ref, status, next_attempt_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0) ON CONFLICT(child_root_action_id) DO NOTHING`,
    due.childRootActionId, input.causeRootActionId, input.causeEventId, JSON.stringify(due),
    due.timelineId, due.completionFictionMicros, due.activityId,
    due.promiseReview ? "promiseReview" : due.npcWork ? "npcWork" : "activity",
    due.promiseReview ? due.promiseReview.promiseId : due.npcWork ? due.npcWork.planId : due.activityId);
  }

  dueWorkByRoot(rootActionId: string): AuthorityDueWorkRow | undefined {
    return this.storage.sql.exec<AuthorityDueWorkRow>(
      `SELECT * FROM authority_due_work WHERE child_root_action_id = ?`, rootActionId,
    ).toArray()[0];
  }

  pendingDueWork(): AuthorityDueWorkRow[] {
    return this.storage.sql.exec<AuthorityDueWorkRow>(`SELECT * FROM authority_due_work WHERE status = 'pending'
      ORDER BY length(completion_fiction_micros), completion_fiction_micros,
      CASE work_kind WHEN 'promiseReview' THEN 1 ELSE 0 END,
      COALESCE(json_extract(descriptor_json, '$.actorPlan.planId'), work_ref)`).toArray();
  }

  /** Reconstruct delivery children from committed causal work, including
   * descendants completed by an earlier HTTP request. No outcomes are copied
   * into a second ledger and UNION terminates even a corrupt cyclic chain. */
  committedDueDescendantResults(rootActionId: string): string[] {
    return this.storage.sql.exec<{ result_json: string }>(`
      WITH RECURSIVE descendants(child_root_action_id) AS (
        SELECT child_root_action_id FROM authority_due_work WHERE cause_root_action_id = ?
        UNION
        SELECT work.child_root_action_id FROM authority_due_work work
        JOIN descendants parent ON work.cause_root_action_id = parent.child_root_action_id
      )
      SELECT submission.result_json FROM descendants
      JOIN authority_due_work work USING (child_root_action_id)
      JOIN authority_submissions submission ON submission.root_action_id = work.child_root_action_id
      WHERE work.status = 'committed' AND submission.result_json IS NOT NULL
        AND work.child_root_action_id != ?
      ORDER BY length(json_extract(submission.result_json, '$.receipt.eventRange.first')),
        json_extract(submission.result_json, '$.receipt.eventRange.first'), work.child_root_action_id
    `, rootActionId, rootActionId).toArray().map(row => row.result_json);
  }

  finishDueWork(rootActionId: string, status: "committed" | "cancelled"): void {
    this.storage.sql.exec(`UPDATE authority_due_work SET status = ?, next_attempt_at = NULL
      WHERE child_root_action_id = ? AND status = 'pending'`, status, rootActionId);
  }

  deferDueWork(rootActionId: string, nextAttemptAt: number | null): void {
    this.storage.sql.exec(`UPDATE authority_due_work SET next_attempt_at = ?
      WHERE child_root_action_id = ? AND status = 'pending'`, nextAttemptAt, rootActionId);
  }

  dueWorkAlarmAt(): number | null {
    const seen = new Set<string>();
    let next: number | null = null;
    for (const row of this.pendingDueWork()) {
      if (seen.has(row.timeline_id)) continue;
      seen.add(row.timeline_id);
      if (row.next_attempt_at !== null) next = Math.min(next ?? row.next_attempt_at, row.next_attempt_at);
    }
    return next;
  }

  hasPendingDueWorkInTimelines(timelineIds: string[], excludingChildRoot?: string): boolean {
    const timelines = [...new Set(timelineIds)];
    if (timelines.length === 0) return false;
    return this.storage.sql.exec<{ held: number }>(`SELECT 1 AS held FROM authority_due_work
      WHERE status = 'pending' AND timeline_id IN (${timelines.map(() => "?").join(",")})
      AND child_root_action_id <> ? LIMIT 1`, ...timelines, excludingChildRoot ?? "").toArray()[0] !== undefined;
  }

  actionStageByChildRoot(childRootActionId: string): AuthorityActionStageRow | undefined {
    return this.storage.sql.exec<AuthorityActionStageRow>(`
      SELECT prepared_action_id, submission_id, phase, target_id,
             child_root_action_id, status, proposal_hash, result_json
      FROM authority_action_stages WHERE child_root_action_id = ?
    `, childRootActionId).toArray()[0];
  }

  hasSuspendedActionStage(): boolean {
    return this.storage.sql.exec<{ held: number }>(`
      SELECT 1 AS held
      FROM authority_action_stages
      WHERE status = 'prepared'
        AND result_json IS NOT NULL
      LIMIT 1
    `).toArray()[0] !== undefined;
  }

  hasSuspendedActionStageInScopes(sceneScopes: string[]): boolean {
    const scopes = [...new Set(sceneScopes)].sort();
    if (scopes.length === 0) return false;
    const placeholders = scopes.map(() => "?").join(", ");
    return this.storage.sql.exec<{ held: number }>(`
      SELECT 1 AS held
      FROM authority_action_stages stage
      JOIN authority_submissions submission
        ON submission.prepared_action_id = stage.prepared_action_id
      WHERE stage.status = 'prepared'
        AND stage.result_json IS NOT NULL
        AND submission.scene_scope IN (${placeholders})
      LIMIT 1
    `, ...scopes).toArray()[0] !== undefined;
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
           AND stage.result_json IS NULL
           AND submission.scene_scope IN (${placeholders})
       )`,
      ...scopes,
    );
    this.storage.sql.exec(
      `DELETE FROM authority_action_stages
       WHERE status = 'prepared'
         AND result_json IS NULL
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

  saveSuspendedActionStage(
    preparedActionId: string,
    proposalHash: string,
    result: unknown,
  ): void {
    this.storage.sql.exec(
      `UPDATE authority_action_stages
       SET proposal_hash = ?, result_json = ?
       WHERE prepared_action_id = ?
         AND status = 'prepared'
         AND (proposal_hash IS NULL OR proposal_hash = ?)`,
      proposalHash,
      JSON.stringify(result),
      preparedActionId,
      proposalHash,
    );
  }

  bindPreparedStory(preparedActionId: string, originalPrepared: unknown, prepared: unknown): boolean {
    const cursor = this.storage.sql.exec(
      `UPDATE authority_submissions SET prepared_json = ?
       WHERE prepared_action_id = ? AND status = 'prepared' AND proposal_hash IS NULL
         AND prepared_json = ? RETURNING prepared_action_id`,
      JSON.stringify(prepared), preparedActionId, JSON.stringify(originalPrepared));
    return cursor.toArray().length === 1;
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

  vnextInvocationProof(preparedActionId: string, ordinal: number): AuthorityVNextStageProofRow | undefined {
    return this.storage.sql.exec<AuthorityVNextStageProofRow>(
      "SELECT * FROM authority_vnext_stage_proofs WHERE prepared_action_id = ? AND ordinal = ?",
      preparedActionId, ordinal,
    ).toArray()[0];
  }

  vnextInvocationProofs(): AuthorityVNextStageProofRow[] {
    return this.storage.sql.exec<AuthorityVNextStageProofRow>("SELECT * FROM authority_vnext_stage_proofs ORDER BY prepared_action_id, ordinal").toArray();
  }

  private saveStoryHostContext(row: AuthorityStoryHostContextRow): void {
    const prior = this.storage.sql.exec<AuthorityStoryHostContextRow>(
      "SELECT prepared_action_id, context_kind, context_json FROM authority_story_host_contexts WHERE prepared_action_id = ? AND context_kind = ?",
      row.prepared_action_id, row.context_kind,
    ).toArray()[0];
    const value = parseJsonWithUniqueMembers(row.context_json);
    if (prior !== undefined) {
      if (canonicalHash(parseJsonWithUniqueMembers(prior.context_json)) !== canonicalHash(value)) {
        throw new TypeError("STORY_ARCHIVE_HOST_IDENTITY_CONFLICT");
      }
      return;
    }
    this.storage.sql.exec("INSERT INTO authority_story_host_contexts (prepared_action_id, context_kind, context_json) VALUES (?, ?, ?)",
      row.prepared_action_id, row.context_kind, row.context_json);
  }

  saveStoryNarrationContext(input: StoryFrozenNarrationContext): void {
    this.saveStoryHostContext({ prepared_action_id: input.preparedActionId, context_kind: "narration", context_json: JSON.stringify(input) });
  }

  saveStoryNpcContext(input: StoryFrozenNpcContext): void {
    this.saveStoryHostContext({ prepared_action_id: input.preparedActionId, context_kind: "npc", context_json: JSON.stringify(input) });
  }

  saveStoryWorldContext(input: StoryFrozenWorldContext): void {
    this.saveStoryHostContext({ prepared_action_id: input.preparedActionId, context_kind: "world", context_json: JSON.stringify(input) });
  }

  storyWorldContext(preparedActionId: string): StoryFrozenWorldContext | undefined {
    const row = this.storage.sql.exec<AuthorityStoryHostContextRow>(
      "SELECT * FROM authority_story_host_contexts WHERE prepared_action_id = ? AND context_kind = 'world'", preparedActionId,
    ).toArray()[0];
    return row === undefined ? undefined : parseJsonWithUniqueMembers(row.context_json) as unknown as StoryFrozenWorldContext;
  }

  pendingStoryWorldContexts(): StoryFrozenWorldContext[] {
    return this.storage.sql.exec<AuthorityStoryHostContextRow>(`SELECT frozen.* FROM authority_story_host_contexts frozen
      WHERE frozen.context_kind = 'world' AND NOT EXISTS (
        SELECT 1 FROM authority_story_host_contexts outcome WHERE outcome.prepared_action_id = frozen.prepared_action_id
          AND outcome.context_kind = 'worldOutcome') ORDER BY frozen.prepared_action_id`).toArray()
      .map(row => parseJsonWithUniqueMembers(row.context_json) as unknown as StoryFrozenWorldContext);
  }

  /** Terminal operational result only. World truth is still in Rules events;
   * the immutable context and invocation ledger can reconstruct this cache. */
  saveStoryWorldOutcome(preparedActionId: string, outcome: Record<string, unknown>): void {
    if (this.storyWorldContext(preparedActionId) === undefined) throw new TypeError("STORY_CONTEXT_INSUFFICIENT");
    this.saveStoryHostContext({ prepared_action_id: preparedActionId, context_kind: "worldOutcome", context_json: JSON.stringify(outcome) });
  }

  saveStoryNpcPendingContext(input: StoryFrozenNpcPendingContext): void {
    if (input.preparedActionId !== storyNpcPendingPreparedActionId(input.decision.prepared_action_id, input.decision.pending_input_id)
      || input.decision.answer_json !== null) throw new TypeError("NPC_PENDING_DECISION_CONTEXT_INVALID");
    const owner = this.submissionByPrepared(input.decision.prepared_action_id);
    if (owner === undefined || owner.root_action_id !== input.request.rootActionId
      || owner.proposal_hash !== input.decision.proposal_hash) throw new TypeError("NPC_PENDING_DECISION_CONTEXT_INVALID");
    this.saveStoryHostContext({ prepared_action_id: input.preparedActionId, context_kind: "npcPending", context_json: JSON.stringify(input) });
    this.saveStoryHostContext({ prepared_action_id: input.preparedActionId, context_kind: "npcPendingOwner",
      context_json: JSON.stringify(storyNpcPendingOwner(owner, this.scopeVersion(owner.scene_scope))) });
  }

  storyNpcPendingContext(preparedActionId: string): StoryFrozenNpcPendingContext | undefined {
    const row = this.storage.sql.exec<AuthorityStoryHostContextRow>(
      "SELECT * FROM authority_story_host_contexts WHERE prepared_action_id = ? AND context_kind = 'npcPending'", preparedActionId,
    ).toArray()[0];
    return row === undefined ? undefined : parseJsonWithUniqueMembers(row.context_json) as unknown as StoryFrozenNpcPendingContext;
  }

  /** The complete host validator selects the last operational decision for
   * each owner. Earlier frozen contexts remain provenance, never overwrite it. */
  restoreStoryNpcPendingDecision(row: AuthorityNpcDecisionRow): void {
    const prior = this.npcDecision(row.prepared_action_id);
    if (prior !== undefined) {
      if (canonicalHash(prior) !== canonicalHash(row)) throw new TypeError("STORY_ARCHIVE_HOST_IDENTITY_CONFLICT");
      return;
    }
    this.saveNpcDecision(row);
  }

  saveStoryPreparationModule(preparedActionId: string, moduleProfile: AuthoritativeModuleProfile): void {
    this.saveStoryHostContext({ prepared_action_id: preparedActionId, context_kind: "preparationModule", context_json: JSON.stringify(moduleProfile) });
  }

  saveStoryAdmissionInput(preparedActionId: string, rulesInput: Record<string, unknown>): void {
    if (!isCanonicalAuthorityRecoveryInput(rulesInput)) throw new TypeError("STORY_ARCHIVE_HOST_BINDING_INVALID");
    this.saveStoryHostContext({ prepared_action_id: preparedActionId, context_kind: "admission", context_json: JSON.stringify(rulesInput) });
  }

  storyAdmissionInput(preparedActionId: string): Record<string, unknown> | undefined {
    const row = this.storage.sql.exec<AuthorityStoryHostContextRow>(
      "SELECT * FROM authority_story_host_contexts WHERE prepared_action_id = ? AND context_kind = 'admission'", preparedActionId,
    ).toArray()[0];
    if (row === undefined) return undefined;
    const input = parseJsonWithUniqueMembers(row.context_json);
    if (!isCanonicalAuthorityRecoveryInput(input)) throw new TypeError("STORY_ARCHIVE_HOST_BINDING_INVALID");
    return input;
  }

  /** Called in the DO's same synchronous capture transaction as StoryStore. */
  storyArchiveHostSnapshot(): AuthorityStoryHostSnapshot {
    return {
      submissions: this.storage.sql.exec<Omit<AuthoritySubmissionRow, "result_json">>(`SELECT submission_id, principal_id,
        payload_hash, input_kind, root_action_id, prepared_action_id, character_id, scene_scope, prepared_scope_version,
        status, proposal_hash, prepared_json, continuation_json FROM authority_submissions ORDER BY prepared_action_id`).toArray(),
      dueWork: this.storage.sql.exec<AuthorityDueWorkRow>("SELECT * FROM authority_due_work ORDER BY child_root_action_id").toArray(),
      recoveries: this.storage.sql.exec<AuthorityProposalRecoveryRow>("SELECT * FROM authority_proposal_recovery ORDER BY prepared_action_id").toArray(),
      proofs: this.vnextInvocationProofs(),
      contexts: this.storage.sql.exec<AuthorityStoryHostContextRow>("SELECT * FROM authority_story_host_contexts ORDER BY prepared_action_id, context_kind").toArray(),
      scopes: this.storage.sql.exec<{ scope_id: string; version: number }>("SELECT scope_id, version FROM authority_scope_versions ORDER BY scope_id").toArray(),
    };
  }

  /** Private typed restoration after semantic host validation. The caller owns
   * the outer Room + StoryStore transaction; conflicts abort that transaction.
   * Terminal submissions deliberately get no result_json or Delivery rows. */
  restoreStoryArchiveHostSnapshot(snapshot: AuthorityStoryHostSnapshot): void {
    for (const row of snapshot.submissions) {
      const prior = this.submissionByPrepared(row.prepared_action_id);
      if (prior !== undefined) {
        const { result_json: _published, ...operational } = prior;
        if (canonicalHash(operational) !== canonicalHash(row)) throw new TypeError("STORY_ARCHIVE_HOST_IDENTITY_CONFLICT");
        continue;
      }
      this.storage.sql.exec(`INSERT INTO authority_submissions (submission_id, principal_id, payload_hash, input_kind,
        root_action_id, prepared_action_id, character_id, scene_scope, prepared_scope_version, status, proposal_hash,
        prepared_json, continuation_json, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      row.submission_id, row.principal_id, row.payload_hash, row.input_kind, row.root_action_id, row.prepared_action_id,
      row.character_id, row.scene_scope, row.prepared_scope_version, row.status, row.proposal_hash, row.prepared_json, row.continuation_json);
    }
    for (const row of snapshot.dueWork) {
      const prior = this.dueWorkByRoot(row.child_root_action_id);
      if (prior !== undefined) {
        if (canonicalHash(prior) !== canonicalHash(row)) throw new TypeError("STORY_ARCHIVE_HOST_IDENTITY_CONFLICT");
        continue;
      }
      this.storage.sql.exec(`INSERT INTO authority_due_work (child_root_action_id, cause_root_action_id, cause_event_id,
        descriptor_json, timeline_id, completion_fiction_micros, activity_id, work_kind, work_ref, status, next_attempt_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, row.child_root_action_id, row.cause_root_action_id, row.cause_event_id,
      row.descriptor_json, row.timeline_id, row.completion_fiction_micros, row.activity_id, row.work_kind, row.work_ref, row.status, row.next_attempt_at);
    }
    for (const row of snapshot.recoveries) {
      const prior = this.proposalRecovery(row.prepared_action_id);
      if (prior !== undefined) {
        if (canonicalHash(prior) !== canonicalHash(row)) throw new TypeError("STORY_ARCHIVE_HOST_IDENTITY_CONFLICT");
        continue;
      }
      this.storage.sql.exec("INSERT INTO authority_proposal_recovery (prepared_action_id, proposal_hash, recovery_hash, recovery_json) VALUES (?, ?, ?, ?)",
        row.prepared_action_id, row.proposal_hash, row.recovery_hash, row.recovery_json);
    }
    for (const proof of snapshot.proofs) this.saveVnextInvocationProof(proof);
    for (const row of snapshot.contexts) this.saveStoryHostContext(row);
    for (const row of snapshot.scopes) {
      const prior = this.storage.sql.exec<{ version: number }>("SELECT version FROM authority_scope_versions WHERE scope_id = ?", row.scope_id).toArray()[0];
      if (prior !== undefined && prior.version !== row.version) throw new TypeError("STORY_ARCHIVE_HOST_IDENTITY_CONFLICT");
      if (prior === undefined) this.setScopeVersion(row.scope_id, row.version);
    }
  }

  saveVnextInvocationProof(row: AuthorityVNextStageProofRow): void {
    const previous = this.vnextInvocationProof(row.prepared_action_id, row.ordinal);
    if (previous !== undefined) {
      if (Object.keys(row).some(key => row[key as keyof AuthorityVNextStageProofRow] !== previous[key as keyof AuthorityVNextStageProofRow])) {
        throw new TypeError("PROPOSAL_INVOCATION_IDENTITY_CONFLICT");
      }
      return;
    }
    this.storage.sql.exec(`INSERT INTO authority_vnext_stage_proofs (
      prepared_action_id, ordinal, context_hash, binding_hash, request_hash,
      repair_ticket_json, invocation_id, external_binding_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, row.prepared_action_id, row.ordinal,
      row.context_hash, row.binding_hash, row.request_hash, row.repair_ticket_json,
      row.invocation_id, row.external_binding_json);
  }

  beginVnextInvocationAudit(row: Readonly<{ capability: string; prepared_action_id: string; ordinal: number }>, startedAt: number): void {
    this.storage.sql.exec(`INSERT INTO authority_vnext_invocation_audits
      (capability, prepared_action_id, ordinal, started_at) VALUES (?, ?, ?, ?)`,
    row.capability, row.prepared_action_id, row.ordinal, startedAt);
  }

  completeVnextInvocationAudit(preparedActionId: string, capability: string, outcome: Readonly<{
    completedAt: number; result: string; usage: Record<string, unknown> | null; code?: string;
  }>, revision?: unknown): void {
    const attempts = this.vnextInvocationAudits(preparedActionId);
    const cumulative = { admittedCalls: attempts.length, elapsedMs: 0, knownInputTokens: 0, knownOutputTokens: 0,
      knownCacheHitTokens: 0, unknownUsageCalls: 0, cost: null };
    for (const attempt of attempts) {
      const result = attempt.capability === capability ? outcome : attempt.outcome_json === null ? null : JSON.parse(attempt.outcome_json);
      cumulative.elapsedMs += Math.max(0, (result?.completedAt ?? outcome.completedAt) - attempt.started_at);
      const usage = result?.usage;
      if (!usage || !Number.isSafeInteger(usage.prompt_tokens) || usage.prompt_tokens < 0
        || !Number.isSafeInteger(usage.completion_tokens) || usage.completion_tokens < 0) cumulative.unknownUsageCalls++;
      else {
        cumulative.knownInputTokens += usage.prompt_tokens;
        cumulative.knownOutputTokens += usage.completion_tokens;
        if (Number.isSafeInteger(usage.prompt_cache_hit_tokens) && usage.prompt_cache_hit_tokens >= 0)
          cumulative.knownCacheHitTokens += usage.prompt_cache_hit_tokens;
      }
    }
    this.storage.sql.exec(`UPDATE authority_vnext_invocation_audits SET outcome_json = ?, revision_json = ? WHERE capability = ?`,
      JSON.stringify({ ...outcome, cumulative }), revision === undefined ? null : JSON.stringify(revision), capability);
  }

  vnextInvocationAudits(preparedActionId: string): { capability: string; ordinal: number; started_at: number; outcome_json: string | null; revision_json: string | null }[] {
    return this.storage.sql.exec<{ capability: string; ordinal: number; started_at: number; outcome_json: string | null; revision_json: string | null }>(
      "SELECT capability, ordinal, started_at, outcome_json, revision_json FROM authority_vnext_invocation_audits WHERE prepared_action_id = ? ORDER BY started_at, rowid",
      preparedActionId).toArray();
  }

  npcDecision(preparedActionId: string): AuthorityNpcDecisionRow | undefined {
    return this.storage.sql.exec<AuthorityNpcDecisionRow>(
      "SELECT * FROM authority_npc_decisions WHERE prepared_action_id = ?",
      preparedActionId,
    ).toArray()[0];
  }

  saveNpcDecision(row: AuthorityNpcDecisionRow): void {
    this.storage.sql.exec(`INSERT INTO authority_npc_decisions (
      prepared_action_id, capability, pending_input_id, proposal_hash, wave_index,
      input_json, request_json, answer_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(prepared_action_id) DO UPDATE SET
      capability = excluded.capability, pending_input_id = excluded.pending_input_id,
      proposal_hash = excluded.proposal_hash, wave_index = excluded.wave_index,
      input_json = excluded.input_json, request_json = excluded.request_json,
      answer_json = excluded.answer_json`,
    row.prepared_action_id, row.capability, row.pending_input_id, row.proposal_hash,
    row.wave_index, row.input_json, row.request_json, row.answer_json);
  }

  answerNpcDecision(preparedActionId: string, capability: string, answer: unknown): void {
    this.storage.sql.exec(`UPDATE authority_npc_decisions SET answer_json = ?
      WHERE prepared_action_id = ? AND capability = ? AND answer_json IS NULL`,
    JSON.stringify(answer), preparedActionId, capability);
    const saved = this.npcDecision(preparedActionId);
    if (saved?.capability !== capability || saved.answer_json === null) return;
    const id = storyNpcPendingPreparedActionId(preparedActionId, saved.pending_input_id);
    if (this.storyNpcPendingContext(id) !== undefined) {
      this.saveStoryHostContext({ prepared_action_id: id, context_kind: "npcPendingAnswer", context_json: saved.answer_json });
    }
  }

  freezeNpcDecisionProposal(preparedActionId: string, proposalHash: string): void {
    this.storage.sql.exec(`UPDATE authority_submissions SET proposal_hash = ?
      WHERE prepared_action_id = ? AND proposal_hash IS NULL`, proposalHash, preparedActionId);
  }

  appendRandomnessDecisionEvents(preparedActionId: string, events: EventEnvelope[]): void {
    const batch = this.randomnessBatch(preparedActionId);
    if (batch === undefined) return;
    const prior = JSON.parse(batch.request_events_json) as EventEnvelope[];
    this.storage.sql.exec(`UPDATE authority_randomness_batches SET request_events_json = ?
      WHERE prepared_action_id = ?`, JSON.stringify([...prior, ...events]), preparedActionId);
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
    principalId: string | null;
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

  randomnessBatch(preparedActionId: string): AuthorityRandomnessBatchJournalRow | undefined {
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

  randomnessAuthorizations(
    preparedActionId: string,
  ): AuthorityRandomnessAuthorizationRow[] {
    return this.storage.sql.exec<AuthorityRandomnessAuthorizationRow>(`
      SELECT prepared_action_id, randomness_id, principal_id, character_id
      FROM authority_randomness_authorizations
      WHERE prepared_action_id = ?
      ORDER BY randomness_id
    `, preparedActionId).toArray();
  }

  randomnessAuthorizationsByRandomnessId(
    randomnessId: string,
  ): AuthorityRandomnessAuthorizationRow[] {
    return this.storage.sql.exec<AuthorityRandomnessAuthorizationRow>(`
      SELECT prepared_action_id, randomness_id, principal_id, character_id
      FROM authority_randomness_authorizations
      WHERE randomness_id = ?
      ORDER BY prepared_action_id
    `, randomnessId).toArray();
  }

  authorizeRandomness(input: AuthorityRandomnessAuthorizationRow): void {
    this.storage.sql.exec(
      `INSERT INTO authority_randomness_authorizations (
         prepared_action_id, randomness_id, principal_id, character_id
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT(prepared_action_id, randomness_id, character_id) DO NOTHING`,
      input.prepared_action_id,
      input.randomness_id,
      input.principal_id,
      input.character_id,
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

  finishSubmission(
    preparedActionId: string,
    status: "awaitingInput" | "committed" | "concluded",
    proposalHash: string,
    result: unknown,
  ): void {
    this.storage.sql.exec(
      `UPDATE authority_submissions
       SET status = ?, proposal_hash = ?,
           continuation_json = CASE WHEN input_kind = 'dueActivity' AND ? = 'awaitingInput'
             THEN continuation_json ELSE NULL END,
           result_json = ?
       WHERE prepared_action_id = ?`,
      status,
      proposalHash,
      status,
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
  recoverableDeliveryAudience(viewerKey: string, oldestFirst = false): AuthorityDeliveryAudienceRow | undefined {
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
      ORDER BY length(plan.source_event_seq) ${oldestFirst ? "ASC" : "DESC"},
               plan.source_event_seq ${oldestFirst ? "ASC" : "DESC"}, audience.audience_id
      LIMIT 1
    `, viewerKey).toArray()[0];
  }

  /** Lists unfinished journals whose frozen ViewerKey belongs to one
   * principal. The Room still has to revalidate the exact frozen Seat,
   * Character, session, projection hash, and plan before authorizing use. */
  recoverableDeliveryAudiencesForPrincipal(
    principalId: string,
    oldestFirst = false,
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
      ORDER BY length(plan.source_event_seq) ${oldestFirst ? "ASC" : "DESC"},
               plan.source_event_seq ${oldestFirst ? "ASC" : "DESC"},
               audience.audience_id
    `, viewerKeyPrefix).toArray();
  }

  /** Verifies that the product-0.4 publication journal was created atomically
   * with its frozen plan. Missing or mismatched rows are integrity failures. */
  ensureDeliveryAudiences(plan: DeliveryPlan): AuthorityDeliveryAudienceRow[] {
    const rows = this.deliveryAudiences(plan.publishCapability);
    const rowByAudienceId = new Map(rows.map((row) => [row.audience_id, row]));
    if (rows.length !== plan.audiences.length || plan.audiences.some((audience) => {
      const row = rowByAudienceId.get(audience.audienceId);
      return row === undefined
        || row.viewer_key !== `${audience.principalId}\u001f${audience.characterId}`
        || row.projection_hash !== audience.projectionHash;
    })) {
      throw new Error("Delivery audience journal does not match its frozen plan.");
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

  experiencedMessagesUpperOrdinal(viewerKey: string): number {
    return this.storage.sql.exec<{ upper_ordinal: number }>(
      "SELECT COALESCE(MAX(ordinal), 0) AS upper_ordinal FROM authority_experienced_messages WHERE viewer_key = ?", viewerKey,
    ).toArray()[0]?.upper_ordinal ?? 0;
  }

  experiencedMessagesPage(viewerKey: string, input: {
    afterOrdinal: number;
    throughOrdinal: number;
    limit: number;
  }): ExperiencedTranscriptMessage[] {
    if (!Number.isSafeInteger(input.afterOrdinal) || input.afterOrdinal < 0
      || !Number.isSafeInteger(input.throughOrdinal) || input.throughOrdinal < input.afterOrdinal
      || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
      throw new Error("STORY_HISTORY_TRANSCRIPT_RANGE_INVALID");
    }
    return this.storage.sql.exec<AuthorityExperiencedMessageRow>(`
      SELECT ordinal, viewer_key, message_id, scene_ids_json, kind,
             speaker_character_id, speaker_name, body, source_event_seq, receipt_id
      FROM authority_experienced_messages
      WHERE viewer_key = ? AND ordinal > ? AND ordinal <= ?
      ORDER BY ordinal
      LIMIT ?
    `, viewerKey, input.afterOrdinal, input.throughOrdinal, input.limit).toArray().map(row => ({
      ordinal: row.ordinal, messageId: row.message_id, sceneIds: parseJson<string[]>(row.scene_ids_json), kind: row.kind,
      speakerCharacterId: row.speaker_character_id, speakerName: row.speaker_name, body: row.body,
      sourceEventSeq: row.source_event_seq, receiptId: row.receipt_id,
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
      DELETE FROM authority_randomness_authorizations;
      DELETE FROM authority_randomness_batches;
      DELETE FROM authority_proposal_recovery;
      DELETE FROM authority_vnext_stage_proofs;
      DELETE FROM authority_story_host_contexts;
      DELETE FROM authority_vnext_invocation_audits;
      DELETE FROM authority_npc_decisions;
      DELETE FROM authority_action_stages;
      DELETE FROM authority_due_work;
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
