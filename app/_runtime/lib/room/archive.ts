import {
  type replay,
  type EventEnvelope,
  type ReplayedRulesResult,
  type RuntimeGenesis,
  type RuntimeProfileManifest,
} from "../rules";

// The Room supplies the same registered replay capability that owns its live
// state; an unknown manifest never triggers a fallback to another interpreter.
type ArchiveReplay = typeof replay;

export type RoomServiceCapabilityPurpose =
  | "archiveExport"
  | "disasterRecovery"
  | "correction"
  | "roomAdministration"
  | "roomDeletion";

export type RoomServiceCapability = {
  kind: "roomServiceCapability";
  version: "1";
  purpose: RoomServiceCapabilityPurpose;
  proof: `sha256:${string}`;
};

export type ArchiveReceiptReference = {
  receiptId: string;
  rootActionId: string;
  actorCharacterId?: string;
  status: string;
  activeBranchId: string;
  eventRange: { first: string; last: string } | null;
  scopeVersions: Record<string, string>;
  randomnessCommitmentHash: `sha256:${string}`;
  correctionId?: string;
};

export type ArchiveProjectionAudit = {
  eventSeq: string;
  viewerHash: `sha256:${string}`;
  projectionHash: `sha256:${string}`;
};

export type AuthoritativeRoomArchive = {
  format: "zhuwei.authoritative-room-archive/v2";
  roomId: string;
  signedGenesis: RuntimeGenesis;
  events: EventEnvelope[];
  receiptRefs: ArchiveReceiptReference[];
  projectionAudits: ArchiveProjectionAudit[];
  head: {
    eventSeq: string;
    eventHash: `sha256:${string}`;
    stateHash: `sha256:${string}`;
    activeBranchId: string;
  };
  archiveHash: `sha256:${string}`;
};

export type ValidatedAuthoritativeArchive = {
  archive: AuthoritativeRoomArchive;
  profiles: RuntimeProfileManifest;
  state: Record<string, unknown>;
  replay: ReplayedRulesResult;
};

/**
 * D1 Free allows at most 50 queries from one Worker invocation. Keep archive
 * pages below that ceiling so the caller retains headroom for its directory
 * and request work. One invocation persists at most one atomic archive page.
 */
export const AUTHORITATIVE_ARCHIVE_D1_BATCH_LIMIT = 40;

export type AuthoritativeArchiveAuditCursor = {
  eventSeq: string;
  viewerHash: `sha256:${string}`;
};

/**
 * The Room authority owns and persists this cursor. D1 remains a rebuildable
 * append-only copy; it never becomes the source of the cursor or live state.
 */
export type AuthoritativeArchiveProgress = {
  format: "zhuwei.authoritative-archive-progress/v1";
  roomId: string;
  runtimeEpochId: string;
  genesisArchived: boolean;
  lastEventSeq: string;
  auditCursor: AuthoritativeArchiveAuditCursor | null;
};

export type AuthoritativeArchiveAppendResult = {
  progress: AuthoritativeArchiveProgress;
  caughtUp: boolean;
  statementsWritten: number;
};

export class AuthoritativeArchiveCursorMismatchError extends Error {
  constructor() {
    super("The durable archive cursor is not materialized in D1.");
    this.name = "AuthoritativeArchiveCursorMismatchError";
  }
}

type ArchiveFailureCode =
  | "archiveEventGap"
  | "archiveEventOrder"
  | "archiveIntegrityMismatch"
  | "profileIntegrityMismatch";

export type ArchiveCheck =
  | { ok: true; archive: AuthoritativeRoomArchive }
  | { ok: false; code: ArchiveFailureCode };

export type ArchiveValidation =
  | { ok: true; value: ValidatedAuthoritativeArchive }
  | { ok: false; code: ArchiveFailureCode };

const CAPABILITY_PROOFS: Record<RoomServiceCapabilityPurpose, `sha256:${string}`> = {
  archiveExport: "sha256:9bb64ca5caae13e9bb9a195e89e8e6610e37e75c193c177d51b280c78f8f19a3",
  disasterRecovery: "sha256:f765c059ead3a2491819310735339ffc8902239e5d089638507a3462919f33b0",
  correction: "sha256:d679e6218516913f9a154f58d307e4f04170c09a1c4313d3269fa8f0311c9a1b",
  roomAdministration: "sha256:6b4617b64b5b013b55ebee1a761c3a26d9de68357301564bfa5ac0e61c17377c",
  roomDeletion: "sha256:b9af19096c3f58921683c5ef5cc32077b8ab0eb5bc547e249857785cad61fd06",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  return required.every((key) => key in value)
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

function isSha256(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

/**
 * Serializes directly, because a sorted key order does not survive an object.
 *
 * This used to sort the keys and then rebuild the record with
 * `Object.fromEntries`, which restores JavaScript's own property order:
 * integer-like keys first, in numeric order. Any payload carrying such keys --
 * a compacted tool schema names its `$def` entries "0", "1", ... "10" -- was
 * then serialized as "1","2",...,"10" here while the rules canonicalizer, which
 * builds its string straight from the sorted array, wrote "1","10","2". Two
 * hashes of the same value disagreed, and an archive that verified a proposal
 * invocation's requestHash against this one could never match the hash the
 * store had written. Emitting from the sorted array keeps the order.
 */
function canonicalText(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Only finite JSON numbers are supported");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalText).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalText(value[key])}`).join(",")}}`;
  }
  throw new TypeError("Only JSON values are supported");
}

export function canonicalJson(value: unknown): string {
  return canonicalText(value);
}

export async function archiveSha256(value: unknown): Promise<`sha256:${string}`> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function roomServiceCapabilities(): Record<
  RoomServiceCapabilityPurpose,
  RoomServiceCapability
> {
  return Object.fromEntries(
    (Object.keys(CAPABILITY_PROOFS) as RoomServiceCapabilityPurpose[]).map((purpose) => [
      purpose,
      {
        kind: "roomServiceCapability" as const,
        version: "1" as const,
        purpose,
        proof: CAPABILITY_PROOFS[purpose],
      },
    ]),
  ) as Record<RoomServiceCapabilityPurpose, RoomServiceCapability>;
}

export function hasRoomServiceCapability(
  value: unknown,
  purpose: RoomServiceCapabilityPurpose,
): value is RoomServiceCapability {
  return isRecord(value)
    && Object.keys(value).length === 4
    && value.kind === "roomServiceCapability"
    && value.version === "1"
    && value.purpose === purpose
    && value.proof === CAPABILITY_PROOFS[purpose];
}

/** Copies the room's committed history as it stands. The head comes from the
 * Room's own live replay; exporting does not replay the world again to check
 * it (SPEC 0011 §6, ADR 0054). */
export async function buildAuthoritativeArchive(input: {
  roomId: string;
  signedGenesis: RuntimeGenesis;
  events: EventEnvelope[];
  receiptRefs: ArchiveReceiptReference[];
  head: AuthoritativeRoomArchive["head"];
}): Promise<AuthoritativeRoomArchive> {
  const unsigned = {
    format: "zhuwei.authoritative-room-archive/v2" as const,
    roomId: input.roomId,
    signedGenesis: structuredClone(input.signedGenesis),
    events: structuredClone(input.events),
    receiptRefs: structuredClone(input.receiptRefs),
    projectionAudits: [],
    head: structuredClone(input.head),
  };
  return { ...unsigned, archiveHash: await archiveSha256(unsigned) };
}

function profileFailure(code: string): boolean {
  return code === "invalidRuntimeManifest"
    || code === "profileIntegrityMismatch"
    || code === "profileRegistryConformanceFailure"
    || code === "unsupportedHistoricalProfile"
    || code === "unsupportedProfile";
}

function isCanonicalSequence(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
}

function sameProfiles(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

/** Checks that an archive is well formed: its fields, a contiguous event
 * sequence from 1, and one room and one set of profiles throughout. It does
 * not replay the world (SPEC 0011 §6, ADR 0054); `replayAuthoritativeArchive` derives the
 * state when a reader needs it. */
export async function checkAuthoritativeArchive(value: unknown): Promise<ArchiveCheck> {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "archiveHash",
      "events",
      "format",
      "head",
      "projectionAudits",
      "receiptRefs",
      "roomId",
      "signedGenesis",
    ])
    || value.format !== "zhuwei.authoritative-room-archive/v2"
    || typeof value.roomId !== "string"
    || value.roomId.length === 0
    || !isRecord(value.signedGenesis)
    || !Array.isArray(value.events)
    || !Array.isArray(value.receiptRefs)
    || !Array.isArray(value.projectionAudits)
    || !isRecord(value.head)
    || !hasExactKeys(value.head, ["activeBranchId", "eventHash", "eventSeq", "stateHash"])
    || !isSha256(value.archiveHash)
    || !isSha256(value.head.eventHash)
    || !isSha256(value.head.stateHash)
    || typeof value.head.activeBranchId !== "string"
  ) {
    return { ok: false, code: "archiveIntegrityMismatch" };
  }

  if (!value.receiptRefs.every((entry) => {
    if (
      !isRecord(entry)
      || !hasOnlyKeys(entry, [
        "activeBranchId",
        "eventRange",
        "randomnessCommitmentHash",
        "receiptId",
        "rootActionId",
        "scopeVersions",
        "status",
      ], ["actorCharacterId", "correctionId"])
      || ![entry.receiptId, entry.rootActionId, entry.status, entry.activeBranchId]
        .every((candidate) => typeof candidate === "string" && candidate.length > 0)
      || !isSha256(entry.randomnessCommitmentHash)
      || !isRecord(entry.scopeVersions)
      || !Object.values(entry.scopeVersions).every(isCanonicalSequence)
      || (entry.actorCharacterId !== undefined
        && (typeof entry.actorCharacterId !== "string" || entry.actorCharacterId.length === 0))
      || (entry.correctionId !== undefined
        && (typeof entry.correctionId !== "string" || entry.correctionId.length === 0))
    ) {
      return false;
    }
    return entry.eventRange === null
      || (isRecord(entry.eventRange)
        && hasExactKeys(entry.eventRange, ["first", "last"])
        && isCanonicalSequence(entry.eventRange.first)
        && isCanonicalSequence(entry.eventRange.last));
  })) {
    return { ok: false, code: "archiveIntegrityMismatch" };
  }
  if (
    !value.projectionAudits.every((entry) =>
      isRecord(entry)
      && hasExactKeys(entry, ["eventSeq", "projectionHash", "viewerHash"])
      && isCanonicalSequence(entry.eventSeq)
      && isSha256(entry.projectionHash)
      && isSha256(entry.viewerHash))
  ) {
    return { ok: false, code: "archiveIntegrityMismatch" };
  }

  if (value.signedGenesis.roomId !== value.roomId) {
    return { ok: false, code: "archiveIntegrityMismatch" };
  }

  const eventRecords = value.events.filter(isRecord);
  if (eventRecords.length !== value.events.length) {
    return { ok: false, code: "archiveIntegrityMismatch" };
  }
  const sequences = eventRecords.map((event) => event.eventSeq);
  if (!sequences.every(isCanonicalSequence)) {
    return { ok: false, code: "archiveEventOrder" };
  }
  for (let index = 1; index < sequences.length; index += 1) {
    if (BigInt(sequences[index]) <= BigInt(sequences[index - 1])) {
      return { ok: false, code: "archiveEventOrder" };
    }
  }
  for (let index = 0; index < sequences.length; index += 1) {
    if (BigInt(sequences[index]) !== BigInt(index + 1)) {
      return { ok: false, code: "archiveEventGap" };
    }
  }
  if (
    !isCanonicalSequence(value.head.eventSeq)
    || BigInt(value.head.eventSeq) !== BigInt(sequences.at(-1) ?? "0")
  ) {
    return { ok: false, code: "archiveEventGap" };
  }

  for (const event of eventRecords) {
    if (
      event.roomId !== value.roomId
      || !sameProfiles(event.profiles, value.signedGenesis.profiles)
    ) {
      return {
        ok: false,
        code: event.roomId !== value.roomId
          ? "archiveIntegrityMismatch"
          : "profileIntegrityMismatch",
      };
    }
  }
  for (let index = 1; index < eventRecords.length; index += 1) {
    if (eventRecords[index].previousEventHash !== eventRecords[index - 1].eventHash) {
      return { ok: false, code: "archiveIntegrityMismatch" };
    }
  }

  const { archiveHash, ...unsigned } = value;
  let expectedArchiveHash: string;
  try {
    expectedArchiveHash = await archiveSha256(unsigned);
  } catch {
    return { ok: false, code: "archiveIntegrityMismatch" };
  }
  if (archiveHash !== expectedArchiveHash) {
    return { ok: false, code: "archiveIntegrityMismatch" };
  }

  return { ok: true, archive: value as AuthoritativeRoomArchive };
}

/** Derives the world state an archive ends in, for restoring a room or reading
 * its history. The events are folded as recorded; the result is not compared
 * against the archive's head (ADR 0054). */
export function replayAuthoritativeArchive(
  archive: AuthoritativeRoomArchive,
  replayArchive: ArchiveReplay,
): ArchiveValidation {
  const replayed = replayArchive(archive.signedGenesis, archive.events);
  if (replayed.kind !== "replayed" || !isRecord(replayed.state)) {
    return {
      ok: false,
      code: replayed.kind === "rejected" && profileFailure(replayed.rejection.code)
        ? "profileIntegrityMismatch"
        : "archiveIntegrityMismatch",
    };
  }
  return { ok: true, value: { archive, profiles: replayed.profiles, state: replayed.state, replay: replayed } };
}

function initialArchiveProgress(
  archive: AuthoritativeRoomArchive,
): AuthoritativeArchiveProgress {
  return {
    format: "zhuwei.authoritative-archive-progress/v1",
    roomId: archive.roomId,
    runtimeEpochId: archive.signedGenesis.runtimeEpochId,
    genesisArchived: false,
    lastEventSeq: "0",
    auditCursor: null,
  };
}

function compareSequences(left: string, right: string): number {
  const leftSequence = BigInt(left);
  const rightSequence = BigInt(right);
  return leftSequence < rightSequence ? -1 : leftSequence > rightSequence ? 1 : 0;
}

function normalizeArchiveProgress(
  archive: AuthoritativeRoomArchive,
  value: AuthoritativeArchiveProgress | undefined,
): AuthoritativeArchiveProgress {
  if (!isCanonicalSequence(archive.head.eventSeq)) {
    throw new Error("Authoritative archive has a non-canonical head sequence.");
  }
  if (value === undefined) return initialArchiveProgress(archive);
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "auditCursor",
      "format",
      "genesisArchived",
      "lastEventSeq",
      "roomId",
      "runtimeEpochId",
    ])
    || value.format !== "zhuwei.authoritative-archive-progress/v1"
    || value.roomId !== archive.roomId
    || value.runtimeEpochId !== archive.signedGenesis.runtimeEpochId
    || typeof value.genesisArchived !== "boolean"
    || !isCanonicalSequence(value.lastEventSeq)
    || (
      value.auditCursor !== null
      && (
        !isRecord(value.auditCursor)
        || !hasExactKeys(value.auditCursor, ["eventSeq", "viewerHash"])
        || !isCanonicalSequence(value.auditCursor.eventSeq)
        || !isSha256(value.auditCursor.viewerHash)
      )
    )
  ) {
    throw new Error("Authoritative archive progress does not belong to this room and runtime epoch.");
  }
  if (compareSequences(value.lastEventSeq, archive.head.eventSeq) > 0) {
    throw new Error("Authoritative archive progress is ahead of this archive snapshot.");
  }
  if (
    value.auditCursor !== null
    && compareSequences(value.auditCursor.eventSeq, archive.head.eventSeq) > 0
  ) {
    throw new Error("Authoritative archive audit progress is ahead of this archive snapshot.");
  }
  return structuredClone(value as AuthoritativeArchiveProgress);
}

type PendingArchiveWrite =
  | { kind: "genesis"; statement: D1PreparedStatement }
  | { kind: "event"; eventSeq: string; statement: D1PreparedStatement }
  | { kind: "checkpoint"; statement: D1PreparedStatement };

type AuthoritativeArchiveCursorProbe = {
  genesis_hash: string | null;
  archived_event_count: string | number;
  first_event_seq: string | number | null;
  last_event_seq: string | number | null;
  cursor_event_hash: string | null;
  checkpoint_genesis_hash: string | null;
  checkpoint_settled_event_seq: string | number | null;
  checkpoint_event_hash: string | null;
  checkpoint_state_hash: string | null;
  checkpoint_active_branch_id: string | null;
  checkpoint_story_content_hash: string | null;
  checkpoint_materialized_event_hash: string | null;
  checkpoint_materialized_state_hash: string | null;
  checkpoint_materialized_branch_id: string | null;
};

function archiveSequence(value: unknown): string | undefined {
  if (isCanonicalSequence(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === "bigint" && value >= 0n) return String(value);
  return undefined;
}

async function assertArchiveProgressMaterializedInD1(
  db: D1Database,
  archive: AuthoritativeRoomArchive,
  progress: AuthoritativeArchiveProgress,
): Promise<AuthoritativeArchiveCursorProbe> {
  const probe = await db.prepare(`/* authoritative_archive_cursor_probe */
    SELECT
      (SELECT genesis_hash
       FROM authoritative_room_genesis_archive
       WHERE room_id = ?1 AND runtime_epoch_id = ?2
       LIMIT 1) AS genesis_hash,
      CAST(COUNT(*) AS TEXT) AS archived_event_count,
      CAST(MIN(event_seq) AS TEXT) AS first_event_seq,
      CAST(MAX(event_seq) AS TEXT) AS last_event_seq,
      MAX(CASE
        WHEN event_seq = CAST(?3 AS INTEGER) THEN event_hash
        ELSE NULL
      END) AS cursor_event_hash,
      (SELECT genesis_hash
        FROM authoritative_room_archive_checkpoint
        WHERE room_id = ?1 AND runtime_epoch_id = ?2
        LIMIT 1) AS checkpoint_genesis_hash,
      (SELECT CAST(settled_event_seq AS TEXT)
        FROM authoritative_room_archive_checkpoint
        WHERE room_id = ?1 AND runtime_epoch_id = ?2
        LIMIT 1) AS checkpoint_settled_event_seq,
      (SELECT event_hash
        FROM authoritative_room_archive_checkpoint
        WHERE room_id = ?1 AND runtime_epoch_id = ?2
        LIMIT 1) AS checkpoint_event_hash,
      (SELECT state_hash
        FROM authoritative_room_archive_checkpoint
        WHERE room_id = ?1 AND runtime_epoch_id = ?2
        LIMIT 1) AS checkpoint_state_hash,
      (SELECT active_branch_id
        FROM authoritative_room_archive_checkpoint
        WHERE room_id = ?1 AND runtime_epoch_id = ?2
        LIMIT 1) AS checkpoint_active_branch_id,
      (SELECT story_content_hash
        FROM authoritative_room_archive_checkpoint
        WHERE room_id = ?1 AND runtime_epoch_id = ?2
        LIMIT 1) AS checkpoint_story_content_hash,
      (SELECT event_hash
        FROM authoritative_room_event_archive
        WHERE room_id = ?1 AND runtime_epoch_id = ?2
          AND event_seq = (
            SELECT settled_event_seq
            FROM authoritative_room_archive_checkpoint
            WHERE room_id = ?1 AND runtime_epoch_id = ?2
            LIMIT 1)
        LIMIT 1) AS checkpoint_materialized_event_hash,
      (SELECT state_hash_after
        FROM authoritative_room_event_archive
        WHERE room_id = ?1 AND runtime_epoch_id = ?2
          AND event_seq = (
            SELECT settled_event_seq
            FROM authoritative_room_archive_checkpoint
            WHERE room_id = ?1 AND runtime_epoch_id = ?2
            LIMIT 1)
        LIMIT 1) AS checkpoint_materialized_state_hash
      ,(SELECT branch_id
        FROM authoritative_room_event_archive
        WHERE room_id = ?1 AND runtime_epoch_id = ?2
          AND event_seq = (
            SELECT settled_event_seq
            FROM authoritative_room_archive_checkpoint
            WHERE room_id = ?1 AND runtime_epoch_id = ?2
            LIMIT 1)
        LIMIT 1) AS checkpoint_materialized_branch_id
    FROM authoritative_room_event_archive
    WHERE room_id = ?1
      AND runtime_epoch_id = ?2
      AND event_seq <= CAST(?3 AS INTEGER)`)
    .bind(archive.roomId, archive.signedGenesis.runtimeEpochId, progress.lastEventSeq)
    .first<AuthoritativeArchiveCursorProbe>();
  if (probe === null || probe === undefined) {
    throw new AuthoritativeArchiveCursorMismatchError();
  }
  const cursorEvent = progress.lastEventSeq === "0"
    ? undefined
    : archive.events.find((event) => event.eventSeq === progress.lastEventSeq);
  const eventPrefixMatches = progress.lastEventSeq === "0"
    ? archiveSequence(probe?.archived_event_count) === "0"
      && probe?.first_event_seq === null
      && probe?.last_event_seq === null
      && probe?.cursor_event_hash === null
    : cursorEvent !== undefined
      && archiveSequence(probe?.archived_event_count) === progress.lastEventSeq
      && archiveSequence(probe?.first_event_seq) === "1"
      && archiveSequence(probe?.last_event_seq) === progress.lastEventSeq
      && probe?.cursor_event_hash === cursorEvent.eventHash;
  const genesisMatches = !progress.genesisArchived
    || probe?.genesis_hash === archive.signedGenesis.genesisHash;
  if (!genesisMatches || !eventPrefixMatches) {
    throw new AuthoritativeArchiveCursorMismatchError();
  }
  return probe;
}

function checkpointMatchesArchive(
  probe: AuthoritativeArchiveCursorProbe,
  archive: AuthoritativeRoomArchive,
): boolean {
  return probe.checkpoint_genesis_hash === archive.signedGenesis.genesisHash
    && archiveSequence(probe.checkpoint_settled_event_seq) === archive.head.eventSeq
    && probe.checkpoint_event_hash === archive.head.eventHash
    && probe.checkpoint_state_hash === archive.head.stateHash
    && probe.checkpoint_active_branch_id === archive.head.activeBranchId;
}

async function assertCheckpointIsSafe(
  probe: AuthoritativeArchiveCursorProbe,
  archive: AuthoritativeRoomArchive,
): Promise<void> {
  const checkpointFields = [
    probe.checkpoint_genesis_hash,
    probe.checkpoint_settled_event_seq,
    probe.checkpoint_event_hash,
    probe.checkpoint_state_hash,
    probe.checkpoint_active_branch_id,
  ];
  const hasCheckpoint = checkpointFields.some((value) => value !== null);
  if (!hasCheckpoint) return;
  if (checkpointFields.some((value) => value === null)) {
    throw new AuthoritativeArchiveCursorMismatchError();
  }
  const checkpointSeq = archiveSequence(probe.checkpoint_settled_event_seq);
  if (checkpointSeq === undefined
    || compareSequences(checkpointSeq, archive.head.eventSeq) > 0
    || probe.checkpoint_genesis_hash !== archive.signedGenesis.genesisHash
    || !isSha256(probe.checkpoint_event_hash)
    || !isSha256(probe.checkpoint_state_hash)
    || typeof probe.checkpoint_active_branch_id !== "string"
    || probe.checkpoint_active_branch_id.length === 0) {
    throw new AuthoritativeArchiveCursorMismatchError();
  }
  if (checkpointSeq !== "0"
    && (probe.checkpoint_materialized_event_hash !== probe.checkpoint_event_hash
      || probe.checkpoint_materialized_state_hash !== probe.checkpoint_state_hash)) {
    throw new AuthoritativeArchiveCursorMismatchError();
  }
  if (checkpointSeq === archive.head.eventSeq
    && (probe.checkpoint_event_hash !== archive.head.eventHash
      || probe.checkpoint_state_hash !== archive.head.stateHash
      || probe.checkpoint_active_branch_id !== archive.head.activeBranchId)) {
    throw new AuthoritativeArchiveCursorMismatchError();
  }
  if (checkpointSeq !== "0") {
    // The checkpoint must name an event of this history. Whether D1's copy of
    // that prefix replays to it is not checked (ADR 0054).
    const expectedCheckpointEvent = archive.events.find((event) =>
      event.eventSeq === checkpointSeq);
    if (expectedCheckpointEvent === undefined
      || expectedCheckpointEvent.eventHash !== probe.checkpoint_event_hash
      || expectedCheckpointEvent.stateHashAfter !== probe.checkpoint_state_hash
      || expectedCheckpointEvent.branchId !== probe.checkpoint_active_branch_id
      || probe.checkpoint_materialized_branch_id !== probe.checkpoint_active_branch_id) {
      throw new AuthoritativeArchiveCursorMismatchError();
    }
  }
}

function checkpointStatement(
  db: D1Database,
  archive: AuthoritativeRoomArchive,
  story?: AuthoritativeArchiveOperationalCheckpoint,
): D1PreparedStatement {
  return db.prepare(`INSERT INTO authoritative_room_archive_checkpoint (
    room_id, runtime_epoch_id, genesis_hash, settled_event_seq,
    event_hash, state_hash, active_branch_id, updated_at, story_generation, story_content_hash
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(room_id, runtime_epoch_id) DO UPDATE SET
    genesis_hash = excluded.genesis_hash,
    settled_event_seq = excluded.settled_event_seq,
    event_hash = excluded.event_hash,
    state_hash = excluded.state_hash,
    active_branch_id = excluded.active_branch_id,
    updated_at = excluded.updated_at,
    story_generation = excluded.story_generation,
    story_content_hash = excluded.story_content_hash
  WHERE excluded.settled_event_seq >= authoritative_room_archive_checkpoint.settled_event_seq
    AND excluded.story_generation >= authoritative_room_archive_checkpoint.story_generation`)
    .bind(
      archive.roomId,
      archive.signedGenesis.runtimeEpochId,
      archive.signedGenesis.genesisHash,
      archive.head.eventSeq,
      archive.head.eventHash,
      archive.head.stateHash,
      archive.head.activeBranchId,
      Date.now(),
      story?.generation ?? 0,
      story?.contentHash ?? null,
    );
}

type D1ArchiveGenesisMaterializationRow = {
  genesis_hash: string;
  genesis_json: string;
};

type D1ArchiveEventMaterializationRow = {
  event_seq: string | number;
  event_hash: string;
  state_hash_after: string;
  branch_id: string;
  event_json: string;
};

async function assertArchiveHeadEventsMaterializedInD1(
  db: D1Database,
  archive: AuthoritativeRoomArchive,
  pending: PendingArchiveWrite[],
): Promise<void> {
  const pendingGenesis = pending.some((entry) => entry.kind === "genesis");
  const genesisRow = await db.prepare(`/* authoritative_archive_head_genesis */
    SELECT genesis_hash, genesis_json
    FROM authoritative_room_genesis_archive
    WHERE room_id = ?1 AND runtime_epoch_id = ?2
    LIMIT 1`)
    .bind(archive.roomId, archive.signedGenesis.runtimeEpochId)
    .first<D1ArchiveGenesisMaterializationRow>();
  if (genesisRow === null || genesisRow === undefined) {
    if (!pendingGenesis) throw new AuthoritativeArchiveCursorMismatchError();
  } else {
    let persistedGenesis: RuntimeGenesis;
    try {
      persistedGenesis = parseArchiveJson<RuntimeGenesis>(genesisRow.genesis_json);
    } catch {
      throw new AuthoritativeArchiveCursorMismatchError();
    }
    if (genesisRow.genesis_hash !== archive.signedGenesis.genesisHash
      || canonicalJson(persistedGenesis) !== canonicalJson(archive.signedGenesis)) {
      throw new AuthoritativeArchiveCursorMismatchError();
    }
  }

  const rows = await db.prepare(`/* authoritative_archive_head_events */
    SELECT event_seq, event_hash, state_hash_after, branch_id, event_json
    FROM authoritative_room_event_archive
    WHERE room_id = ?1 AND runtime_epoch_id = ?2
      AND event_seq <= CAST(?3 AS INTEGER)
    ORDER BY event_seq ASC`)
    .bind(archive.roomId, archive.signedGenesis.runtimeEpochId, archive.head.eventSeq)
    .all<D1ArchiveEventMaterializationRow>();
  if (!Array.isArray(rows.results)) {
    throw new AuthoritativeArchiveCursorMismatchError();
  }
  const persisted = new Map<string, D1ArchiveEventMaterializationRow>();
  for (const row of rows.results) {
    const eventSeq = archiveSequence(row.event_seq);
    if (eventSeq === undefined || persisted.has(eventSeq)) {
      throw new AuthoritativeArchiveCursorMismatchError();
    }
    persisted.set(eventSeq, row);
  }
  const pendingEventSeqs = new Set(pending.flatMap((entry) =>
    entry.kind === "event" ? [entry.eventSeq] : []));
  for (const event of archive.events) {
    const row = persisted.get(event.eventSeq);
    if (row === undefined) {
      if (!pendingEventSeqs.has(event.eventSeq)) {
        throw new AuthoritativeArchiveCursorMismatchError();
      }
      continue;
    }
    let persistedEvent: EventEnvelope;
    try {
      persistedEvent = parseArchiveJson<EventEnvelope>(row.event_json);
    } catch {
      throw new AuthoritativeArchiveCursorMismatchError();
    }
    if (row.event_hash !== event.eventHash
      || row.state_hash_after !== event.stateHashAfter
      || row.branch_id !== event.branchId
      || canonicalJson(persistedEvent) !== canonicalJson(event)) {
      throw new AuthoritativeArchiveCursorMismatchError();
    }
    persisted.delete(event.eventSeq);
  }
  if (persisted.size !== 0) {
    throw new AuthoritativeArchiveCursorMismatchError();
  }
}

export type AuthoritativeArchiveOperationalCheckpoint = Readonly<{
  generation: number;
  contentHash: `sha256:${string}`;
}>;

export async function appendAuthoritativeArchiveToD1(
  db: D1Database,
  archive: AuthoritativeRoomArchive,
  persistedProgress?: AuthoritativeArchiveProgress,
  operationalCheckpoint?: AuthoritativeArchiveOperationalCheckpoint,
): Promise<AuthoritativeArchiveAppendResult> {
  const genesis = archive.signedGenesis;
  const progress = normalizeArchiveProgress(archive, persistedProgress);
  const probe = await assertArchiveProgressMaterializedInD1(db, archive, progress);
  await assertCheckpointIsSafe(probe, archive);
  if (operationalCheckpoint === undefined && typeof probe.checkpoint_story_content_hash === "string") {
    throw new TypeError("A complete room archive checkpoint cannot be replaced by world rows alone.");
  }
  let operationalMatches = true;
  if (operationalCheckpoint !== undefined) {
    if (!Number.isSafeInteger(operationalCheckpoint.generation) || operationalCheckpoint.generation < 0
      || !isSha256(operationalCheckpoint.contentHash)) throw new TypeError("Invalid operational archive checkpoint.");
    const current = await db.prepare(`SELECT story_generation, story_content_hash
      FROM authoritative_room_archive_checkpoint WHERE room_id = ? AND runtime_epoch_id = ?`)
      .bind(archive.roomId, genesis.runtimeEpochId)
      .first<{ story_generation: number; story_content_hash: string | null }>();
    if (current && (current.story_generation > operationalCheckpoint.generation
      || (current.story_generation === operationalCheckpoint.generation && current.story_content_hash !== null
        && current.story_content_hash !== operationalCheckpoint.contentHash))) {
      throw new TypeError("Operational archive generation cannot be overwritten.");
    }
    operationalMatches = current?.story_generation === operationalCheckpoint.generation
      && current.story_content_hash === operationalCheckpoint.contentHash;
  }
  const checkpointMatches = checkpointMatchesArchive(probe, archive) && operationalMatches;
  const pending: PendingArchiveWrite[] = [];

  // World rows contain genesis and Rules events. Private operational
  // materials are uploaded by the story archive adapter first; this atomic
  // checkpoint then names their content hash at this exact head.
  // Published Delivery frames remain outside both recovery formats.
  if (!progress.genesisArchived) {
    pending.push({
      kind: "genesis",
      statement: db.prepare(`INSERT OR IGNORE INTO authoritative_room_genesis_archive (
      room_id, runtime_epoch_id, genesis_hash,
      manifest_profile_id, manifest_profile_hash,
      ruleset_profile_id, ruleset_profile_hash,
      event_schema_profile_id, event_schema_profile_hash,
      module_profile_id, module_profile_hash,
      definition_profile_id, definition_profile_hash, genesis_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        archive.roomId,
        genesis.runtimeEpochId,
        genesis.genesisHash,
        genesis.profiles.manifest.profileId,
        genesis.profiles.manifest.profileHash,
        genesis.profiles.ruleset.profileId,
        genesis.profiles.ruleset.profileHash,
        genesis.profiles.eventSchema.profileId,
        genesis.profiles.eventSchema.profileHash,
        genesis.moduleRef.profileId,
        genesis.moduleRef.profileHash,
        genesis.initialDefinitionCatalogRef.profileId,
        genesis.initialDefinitionCatalogRef.profileHash,
        JSON.stringify(genesis),
      ),
    });
  }

  for (const event of archive.events) {
    if (!isCanonicalSequence(event.eventSeq)) {
      throw new Error("Authoritative archive contains a non-canonical event sequence.");
    }
    if (compareSequences(event.eventSeq, progress.lastEventSeq) <= 0) continue;
    pending.push({
      kind: "event",
      eventSeq: event.eventSeq,
      statement: db.prepare(`INSERT OR IGNORE INTO authoritative_room_event_archive (
      room_id, runtime_epoch_id, event_seq, event_id, root_action_id, branch_id,
      event_type, event_type_version,
      manifest_profile_id, manifest_profile_hash,
      ruleset_profile_id, ruleset_profile_hash,
      event_schema_profile_id, event_schema_profile_hash,
      payload_hash, previous_event_hash, state_before_hash, state_hash_after,
      event_hash, event_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        archive.roomId,
        event.runtimeEpochId,
        event.eventSeq,
        event.eventId,
        event.rootActionId,
        event.branchId,
        event.eventType,
        event.eventTypeVersion,
        event.profiles.manifest.profileId,
        event.profiles.manifest.profileHash,
        event.profiles.ruleset.profileId,
        event.profiles.ruleset.profileHash,
        event.profiles.eventSchema.profileId,
        event.profiles.eventSchema.profileHash,
        event.payloadHash,
        event.previousEventHash,
        event.stateBeforeHash,
        event.stateHashAfter,
        event.eventHash,
        JSON.stringify(event),
      ),
    });
  }

  const needsCheckpoint = !checkpointMatches;
  const archiveWriteLimit = needsCheckpoint
    ? AUTHORITATIVE_ARCHIVE_D1_BATCH_LIMIT - 1
    : AUTHORITATIVE_ARCHIVE_D1_BATCH_LIMIT;
  const page = pending.slice(0, archiveWriteLimit);
  const archiveWritesComplete = page.length === pending.length;
  if (needsCheckpoint && archiveWritesComplete) {
    await assertArchiveHeadEventsMaterializedInD1(db, archive, page);
    page.push({
      kind: "checkpoint",
      statement: checkpointStatement(db, archive, operationalCheckpoint),
    });
  }
  if (page.length === 0) {
    return { progress, caughtUp: true, statementsWritten: 0 };
  }

  // D1 batch is atomic. Do not construct or return the advanced cursor until
  // it succeeds, so a thrown batch leaves the caller's durable cursor intact.
  await db.batch(page.map((entry) => entry.statement));

  const nextProgress = structuredClone(progress);
  for (const entry of page) {
    switch (entry.kind) {
      case "genesis":
        nextProgress.genesisArchived = true;
        break;
      case "event":
        nextProgress.lastEventSeq = entry.eventSeq;
        break;
      case "checkpoint":
        break;
    }
  }
  return {
    progress: nextProgress,
    caughtUp: archiveWritesComplete
      && (!needsCheckpoint || page.some((entry) => entry.kind === "checkpoint")),
    statementsWritten: page.length,
  };
}


function parseArchiveJson<T>(value: unknown): T {
  if (typeof value !== "string") throw new AuthoritativeArchiveCursorMismatchError();
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new AuthoritativeArchiveCursorMismatchError();
  }
}
