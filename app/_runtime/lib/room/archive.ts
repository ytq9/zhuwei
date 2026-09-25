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
  head: AuthoritativeArchiveHead;
  archiveHash: `sha256:${string}`;
};

/** Where the archived history ends. Archives exported before ADR 0055 name
 * the head by its event and state hashes instead of the last event id. */
export type AuthoritativeArchiveHead =
  | { eventSeq: string; lastEventId: string | null; activeBranchId: string }
  | { eventSeq: string; eventHash: `sha256:${string}`; stateHash: `sha256:${string}`; activeBranchId: string };

export type ValidatedAuthoritativeArchive = {
  archive: AuthoritativeRoomArchive;
  profiles: RuntimeProfileManifest;
  state: Record<string, unknown>;
  replay: ReplayedRulesResult;
};

export type AuthoritativeArchiveAuditCursor = {
  eventSeq: string;
  viewerHash: `sha256:${string}`;
};

/**
 * The Room persists this progress record. Since ADR 0055 only the story
 * archive and its checkpoint are written, so the cursor fields just follow the
 * published head.
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
    || !isSha256(value.archiveHash)
    || !(hasExactKeys(value.head, ["activeBranchId", "eventSeq", "lastEventId"])
      ? value.head.lastEventId === null || (typeof value.head.lastEventId === "string" && value.head.lastEventId.length > 0)
      : hasExactKeys(value.head, ["activeBranchId", "eventHash", "eventSeq", "stateHash"])
        && isSha256(value.head.eventHash) && isSha256(value.head.stateHash))
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
    if (eventRecords[index].parentEventId !== eventRecords[index - 1].eventId) {
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

export type AuthoritativeArchiveOperationalCheckpoint = Readonly<{
  generation: number;
  contentHash: `sha256:${string}`;
}>;

/** Names the stored story archive at this head. The per-event world rows are
 * no longer written: the story archive carries the whole world archive and no
 * reader used the rows (ADR 0055). A newer generation is never overwritten. */
export async function publishArchiveCheckpoint(
  db: D1Database,
  archive: AuthoritativeRoomArchive,
  story: AuthoritativeArchiveOperationalCheckpoint,
): Promise<AuthoritativeArchiveAppendResult> {
  const genesis = archive.signedGenesis;
  if (!Number.isSafeInteger(story.generation) || story.generation < 0 || !isSha256(story.contentHash)
    || !isCanonicalSequence(archive.head.eventSeq)) throw new TypeError("Invalid operational archive checkpoint.");
  const progress: AuthoritativeArchiveProgress = {
    format: "zhuwei.authoritative-archive-progress/v1",
    roomId: archive.roomId,
    runtimeEpochId: genesis.runtimeEpochId,
    genesisArchived: true,
    lastEventSeq: archive.head.eventSeq,
    auditCursor: null,
  };
  const current = await db.prepare(`SELECT story_generation, story_content_hash, settled_event_seq
    FROM authoritative_room_archive_checkpoint WHERE room_id = ? AND runtime_epoch_id = ?`)
    .bind(archive.roomId, genesis.runtimeEpochId)
    .first<{ story_generation: number; story_content_hash: string | null; settled_event_seq: number | string }>();
  if (current && (current.story_generation > story.generation
    || (current.story_generation === story.generation && current.story_content_hash !== null
      && current.story_content_hash !== story.contentHash))) {
    throw new TypeError("Operational archive generation cannot be overwritten.");
  }
  if (current?.story_generation === story.generation && current.story_content_hash === story.contentHash
    && String(current.settled_event_seq) === archive.head.eventSeq) {
    return { progress, caughtUp: true, statementsWritten: 0 };
  }
  // The legacy NOT NULL hash columns now hold the last event id and nothing.
  const headRef = "lastEventId" in archive.head ? archive.head.lastEventId ?? "genesis" : archive.head.eventHash;
  await db.prepare(`INSERT INTO authoritative_room_archive_checkpoint (
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
    .bind(archive.roomId, genesis.runtimeEpochId, genesis.genesisHash, archive.head.eventSeq,
      headRef, "", archive.head.activeBranchId, Date.now(), story.generation, story.contentHash)
    .run();
  return { progress, caughtUp: true, statementsWritten: 1 };
}
