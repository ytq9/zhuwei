import {
  replay,
  type EventEnvelope,
  type ReplayedRulesResult,
  type RuntimeGenesis,
  type RuntimeProfileManifest,
} from "../rules";

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

export type ArchiveValidation =
  | { ok: true; value: ValidatedAuthoritativeArchive }
  | {
      ok: false;
      code:
        | "archiveEventGap"
        | "archiveEventOrder"
        | "archiveIntegrityMismatch"
        | "profileIntegrityMismatch";
    };

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

function normalizedJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Only finite JSON numbers are supported");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, normalizedJson(value[key])]),
    );
  }
  throw new TypeError("Only JSON values are supported");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizedJson(value));
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

export async function buildAuthoritativeArchive(input: {
  roomId: string;
  signedGenesis: RuntimeGenesis;
  events: EventEnvelope[];
  receiptRefs: ArchiveReceiptReference[];
  projectionAudits: ArchiveProjectionAudit[];
}): Promise<AuthoritativeRoomArchive> {
  const replayed = replay(input.signedGenesis, input.events);
  if (replayed.kind !== "replayed" || !isRecord(replayed.state)) {
    throw new Error("Cannot export an archive that fails authoritative replay.");
  }
  const activeBranchId = replayed.state.activeBranchId;
  if (typeof activeBranchId !== "string") {
    throw new Error("Cannot export an archive without an active branch.");
  }
  const unsigned = {
    format: "zhuwei.authoritative-room-archive/v2" as const,
    roomId: input.roomId,
    signedGenesis: structuredClone(input.signedGenesis),
    events: structuredClone(input.events),
    receiptRefs: structuredClone(input.receiptRefs),
    projectionAudits: structuredClone(input.projectionAudits),
    head: {
      eventSeq: replayed.head.eventSeq,
      eventHash: replayed.head.eventHash,
      stateHash: replayed.head.stateHash,
      activeBranchId,
    },
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

export async function validateAuthoritativeArchive(value: unknown): Promise<ArchiveValidation> {
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
    value.projectionAudits.length === 0
    || !value.projectionAudits.every((entry) =>
      isRecord(entry)
      && hasExactKeys(entry, ["eventSeq", "projectionHash", "viewerHash"])
      && isCanonicalSequence(entry.eventSeq)
      && isSha256(entry.projectionHash)
      && isSha256(entry.viewerHash))
  ) {
    return { ok: false, code: "archiveIntegrityMismatch" };
  }

  const genesisReplay = replay(value.signedGenesis, []);
  if (genesisReplay.kind !== "replayed") {
    return {
      ok: false,
      code: profileFailure(genesisReplay.rejection.code)
        ? "profileIntegrityMismatch"
        : "archiveIntegrityMismatch",
    };
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

  const replayed = replay(value.signedGenesis, value.events);
  if (replayed.kind !== "replayed" || !isRecord(replayed.state)) {
    return {
      ok: false,
      code: replayed.kind === "rejected" && profileFailure(replayed.rejection.code)
        ? "profileIntegrityMismatch"
        : "archiveIntegrityMismatch",
    };
  }
  if (
    value.head.eventSeq !== replayed.head.eventSeq
    || value.head.eventHash !== replayed.head.eventHash
    || value.head.stateHash !== replayed.head.stateHash
    || value.head.activeBranchId !== replayed.state.activeBranchId
  ) {
    return { ok: false, code: "archiveIntegrityMismatch" };
  }

  return {
    ok: true,
    value: {
      archive: value as AuthoritativeRoomArchive,
      profiles: replayed.profiles,
      state: replayed.state,
      replay: replayed,
    },
  };
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

function compareAuditCursor(
  left: AuthoritativeArchiveAuditCursor,
  right: AuthoritativeArchiveAuditCursor,
): number {
  const sequenceOrder = compareSequences(left.eventSeq, right.eventSeq);
  if (sequenceOrder !== 0 || left.viewerHash === right.viewerHash) return sequenceOrder;
  return left.viewerHash < right.viewerHash ? -1 : 1;
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
  | {
      kind: "audit";
      cursor: AuthoritativeArchiveAuditCursor;
      statement: D1PreparedStatement;
    };

type AuthoritativeArchiveCursorProbe = {
  genesis_hash: string | null;
  archived_event_count: string | number;
  first_event_seq: string | number | null;
  last_event_seq: string | number | null;
  cursor_event_hash: string | null;
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
): Promise<void> {
  if (
    !progress.genesisArchived
    && progress.lastEventSeq === "0"
    && progress.auditCursor === null
  ) return;

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
      END) AS cursor_event_hash
    FROM authoritative_room_event_archive
    WHERE room_id = ?1
      AND runtime_epoch_id = ?2
      AND event_seq <= CAST(?3 AS INTEGER)`)
    .bind(archive.roomId, archive.signedGenesis.runtimeEpochId, progress.lastEventSeq)
    .first<AuthoritativeArchiveCursorProbe>();
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
}

export async function appendAuthoritativeArchiveToD1(
  db: D1Database,
  archive: AuthoritativeRoomArchive,
  persistedProgress?: AuthoritativeArchiveProgress,
): Promise<AuthoritativeArchiveAppendResult> {
  const genesis = archive.signedGenesis;
  const progress = normalizeArchiveProgress(archive, persistedProgress);
  await assertArchiveProgressMaterializedInD1(db, archive, progress);
  const pending: PendingArchiveWrite[] = [];

  // The persistence allowlist is intentionally only genesis, Rules events,
  // and projection hashes. Receipt presentation, Delivery frames, model
  // prompts, and raw player intent are not statements and cannot reach D1.
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

  const auditCursor = progress.auditCursor;
  const orderedAudits = archive.projectionAudits
    .map((audit) => ({
      audit,
      cursor: { eventSeq: audit.eventSeq, viewerHash: audit.viewerHash },
    }))
    .sort((left, right) => compareAuditCursor(left.cursor, right.cursor));
  for (const { audit, cursor } of orderedAudits) {
    if (!isCanonicalSequence(audit.eventSeq) || !isSha256(audit.viewerHash)) {
      throw new Error("Authoritative archive contains an invalid projection audit cursor.");
    }
    if (auditCursor !== null && compareAuditCursor(cursor, auditCursor) <= 0) continue;
    pending.push({
      kind: "audit",
      cursor,
      statement: db.prepare(`INSERT OR IGNORE INTO authoritative_projection_audit_archive (
      room_id, runtime_epoch_id, event_seq, viewer_hash, projection_hash
    ) VALUES (?, ?, ?, ?, ?)`)
      .bind(
        archive.roomId,
        genesis.runtimeEpochId,
        audit.eventSeq,
        audit.viewerHash,
        audit.projectionHash,
      ),
    });
  }

  const page = pending.slice(0, AUTHORITATIVE_ARCHIVE_D1_BATCH_LIMIT);
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
      case "audit":
        nextProgress.auditCursor = structuredClone(entry.cursor);
        break;
    }
  }
  return {
    progress: nextProgress,
    caughtUp: page.length === pending.length,
    statementsWritten: page.length,
  };
}
