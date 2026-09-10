import {
  appendAuthoritativeArchiveToD1, archiveSha256, canonicalJson, readAuthoritativeArchiveFromD1,
  type AuthoritativeArchiveProgress,
} from "./archive";
import { validateStoryArchive, type StoryArchivePorts, type StoryRoomArchive } from "./story-archive";
import { parseJsonWithUniqueMembers } from "../kp/vnext/canonical-json";

const PART_UNITS = 48_000;
const BATCH_PARTS = 24;
type Locator = Readonly<{ roomId: string; runtimeEpochId: string }>;
type Checkpoint = { story_generation: number; story_content_hash: string | null;
  genesis_hash: string; settled_event_seq: number | string; event_hash: string; state_hash: string; active_branch_id: string };
type Part = { part_index: number; part_count: number; part_hash: string; body: string };

export class StoryArchiveD1Error extends Error {
  constructor(readonly code: "STORY_ARCHIVE_MATERIALS_MISSING" | "STORY_ARCHIVE_BINDING_INVALID"
    | "STORY_ARCHIVE_WORLD_INVALID" | "STORY_ARCHIVE_HOST_BINDING_INVALID" | "STORY_ARCHIVE_INVALID") { super(code); }
}
function fail(code: StoryArchiveD1Error["code"] = "STORY_ARCHIVE_BINDING_INVALID"): never { throw new StoryArchiveD1Error(code); }
function chunks(value: string): string[] {
  const result: string[] = [];
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(offset + PART_UNITS, value.length);
    // A D1 binding must not receive half a UTF-16 surrogate pair.
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--;
    result.push(value.slice(offset, end)); offset = end;
  }
  return result;
}
function checkpoint(db: D1Database, locator: Locator) {
  return db.prepare(`SELECT story_generation, story_content_hash, genesis_hash,
    settled_event_seq, event_hash, state_hash, active_branch_id
    FROM authoritative_room_archive_checkpoint WHERE room_id = ? AND runtime_epoch_id = ?`)
    .bind(locator.roomId, locator.runtimeEpochId).first<Checkpoint>();
}

/** Upload immutable private parts before the normal world checkpoint. Only
 * its final atomic batch publishes the pair (world head, private hash).
 * Repeating an upload of a published generation checks existing bytes; it
 * cannot overwrite corruption. Paging the world archive re-enters this
 * function once per page, so a generation whose parts are already stored
 * whole and not yet published skips that check: it was verified when it was
 * written, no reader can reach it until the checkpoint names it, and every
 * read re-hashes the bytes it returns. */
export async function appendStoryArchiveToD1(db: D1Database, value: StoryRoomArchive,
  progress: AuthoritativeArchiveProgress | undefined, ports: StoryArchivePorts) {
  const checked = await validateStoryArchive(value, ports);
  if (checked.kind !== "validated") fail(checked.code);
  const envelope = checked.envelope;
  const generation = Number(envelope.generation);
  if (!Number.isSafeInteger(generation) || generation < 0 || String(generation) !== envelope.generation) fail();
  const locator = { roomId: envelope.source.roomId, runtimeEpochId: envelope.source.runtimeEpochId };
  // Serializing, chunking and re-hashing the whole envelope is what made a
  // long room's archive page cost tens of seconds of Durable Object CPU, and
  // catching up on the world archive repeats it per page. Do it when the
  // parts are not yet stored whole, and when a published generation is being
  // uploaded again, where checking the stored bytes is the point.
  const published = await checkpoint(db, locator);
  if (published?.story_content_hash === envelope.contentHash
    || !await storedWhole(db, locator, envelope.contentHash)) {
    const bodies = chunks(canonicalJson(envelope));
    const partHashes = await Promise.all(bodies.map(body => archiveSha256(body)));
    for (let start = 0; start < bodies.length; start += BATCH_PARTS) {
      const end = Math.min(start + BATCH_PARTS, bodies.length);
      const existing = await db.prepare(`SELECT part_index, part_count, part_hash, body FROM story_room_archive_part
        WHERE room_id = ? AND runtime_epoch_id = ? AND content_hash = ? AND part_index >= ? AND part_index < ?
        ORDER BY part_index`).bind(locator.roomId, locator.runtimeEpochId, envelope.contentHash, start, end).all<Part>();
      if (!existing.success) fail();
      const present = new Set<number>();
      for (const part of existing.results) {
        if (!Number.isSafeInteger(part.part_index) || part.part_index < start || part.part_index >= end
          || present.has(part.part_index) || part.part_count !== bodies.length
          || part.part_hash !== partHashes[part.part_index] || part.body !== bodies[part.part_index]) fail();
        present.add(part.part_index);
      }
      const statements: D1PreparedStatement[] = [];
      for (let index = start; index < end; index++) if (!present.has(index)) {
        statements.push(db.prepare(`INSERT INTO story_room_archive_part
          (room_id, runtime_epoch_id, content_hash, part_index, part_count, part_hash, body)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(locator.roomId, locator.runtimeEpochId, envelope.contentHash,
            index, bodies.length, partHashes[index], bodies[index]));
      }
      if (statements.length) await db.batch(statements);
    }
  }
  const result = await appendAuthoritativeArchiveToD1(db, envelope.archive, progress, ports.replay,
    { generation, contentHash: envelope.contentHash });
  // Only the checkpoint's own content hash is readable, so once it publishes
  // this generation the superseded parts are unreachable bytes. Prune them
  // after that publish, never before, and only against the head we just read.
  if (result.caughtUp) {
    const head = await checkpoint(db, locator);
    if (head?.story_content_hash === envelope.contentHash) {
      await db.prepare(`DELETE FROM story_room_archive_part
        WHERE room_id = ? AND runtime_epoch_id = ? AND content_hash <> ?`)
        .bind(locator.roomId, locator.runtimeEpochId, envelope.contentHash).run();
    }
  }
  return result;
}

/** True when every part of this content hash is already stored. Parts are
 * immutable and keyed by content, so presence of the complete set is proof
 * enough; `readStoryArchiveFromD1` re-hashes every body it reads back. */
async function storedWhole(db: D1Database, locator: Locator, contentHash: string): Promise<boolean> {
  const row = await db.prepare(`SELECT COUNT(*) AS stored, MIN(part_count) AS lowest, MAX(part_count) AS highest
    FROM story_room_archive_part WHERE room_id = ? AND runtime_epoch_id = ? AND content_hash = ?`)
    .bind(locator.roomId, locator.runtimeEpochId, contentHash)
    .first<{ stored: number; lowest: number | null; highest: number | null }>();
  return row !== null && Number.isSafeInteger(row.stored) && row.stored > 0
    && row.lowest === row.highest && row.stored === row.lowest;
}

/** A private recovery read. Its result must stay within trusted service
 * adapters; a player history export always passes through Rules projection. */
export async function readStoryArchiveFromD1(db: D1Database, locator: Locator, ports: StoryArchivePorts) {
  if (Object.keys(locator).sort().join() !== "roomId,runtimeEpochId"
    || !locator.roomId || !locator.runtimeEpochId) fail();
  const head = await checkpoint(db, locator);
  if (!head?.story_content_hash || !Number.isSafeInteger(head.story_generation)) fail("STORY_ARCHIVE_MATERIALS_MISSING");
  const parts: Part[] = [];
  let count: number | undefined;
  for (;;) {
    const page = await db.prepare(`SELECT part_index, part_count, part_hash, body FROM story_room_archive_part
      WHERE room_id = ? AND runtime_epoch_id = ? AND content_hash = ? AND part_index >= ?
      ORDER BY part_index LIMIT ?`).bind(locator.roomId, locator.runtimeEpochId, head.story_content_hash,
        parts.length, BATCH_PARTS).all<Part>();
    if (!page.success || page.results.length === 0) fail("STORY_ARCHIVE_MATERIALS_MISSING");
    for (const part of page.results) {
      if (count === undefined) count = part.part_count;
      if (!Number.isSafeInteger(count) || count < 1 || part.part_count !== count
        || part.part_index !== parts.length || typeof part.body !== "string"
        || await archiveSha256(part.body) !== part.part_hash) fail();
      parts.push(part);
    }
    if (parts.length === count) break;
    if (parts.length > count!) fail();
  }
  let value: unknown;
  try { value = parseJsonWithUniqueMembers(parts.map(part => part.body).join("")); } catch { fail(); }
  const checked = await validateStoryArchive(value, ports);
  if (checked.kind !== "validated") fail(checked.code);
  const { envelope } = checked;
  if (envelope.contentHash !== head.story_content_hash || envelope.generation !== String(head.story_generation)
    || envelope.source.roomId !== locator.roomId || envelope.source.runtimeEpochId !== locator.runtimeEpochId
    || envelope.archive.signedGenesis.genesisHash !== head.genesis_hash
    || envelope.archive.head.eventSeq !== String(head.settled_event_seq)
    || envelope.archive.head.eventHash !== head.event_hash || envelope.archive.head.stateHash !== head.state_hash
    || envelope.archive.head.activeBranchId !== head.active_branch_id) fail();
  // Verify the actual committed world rows, not just the envelope's copy.
  const world = await readAuthoritativeArchiveFromD1(db, locator, ports.replay);
  if (canonicalJson(world.signedGenesis) !== canonicalJson(envelope.archive.signedGenesis)
    || canonicalJson(world.events) !== canonicalJson(envelope.archive.events)
    || canonicalJson(world.projectionAudits) !== canonicalJson(envelope.archive.projectionAudits)) fail("STORY_ARCHIVE_WORLD_INVALID");
  if (canonicalJson(await checkpoint(db, locator)) !== canonicalJson(head)) fail();
  return checked;
}
