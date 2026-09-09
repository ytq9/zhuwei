import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import migration0013 from "../drizzle/0013_smiling_shinobi_shaw.sql?raw";
import { pinnedModuleRef } from "../app/_runtime/lib/module/registry";
import { replay, step, type EventEnvelope } from "../app/_runtime/lib/rules";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical";
import {
  archiveSha256, buildAuthoritativeArchive, canonicalJson, AuthoritativeArchiveD1ReadError,
  type AuthoritativeArchiveProgress, type AuthoritativeRoomArchive,
} from "../app/_runtime/lib/room/archive";
import { buildStoryArchive, type StoryArchivePorts, type StoryRoomArchive } from "../app/_runtime/lib/room/story-archive";
import { appendStoryArchiveToD1, readStoryArchiveFromD1 } from "../app/_runtime/lib/room/story-archive-d1";
import { StoryCreationStore } from "../app/_runtime/lib/room/story-creation-store";
import type { StoryStoreArchiveSnapshot } from "../app/_runtime/lib/room/story-creation-invocation";

const db = (env as unknown as { STORY_ARCHIVE_TEST_DB: D1Database }).STORY_ARCHIVE_TEST_DB;
const migrations = import.meta.glob<string>("../drizzle/*.sql", { eager: true, query: "?raw", import: "default" });
// Empty host bindings are intentional: this suite exercises real D1 and the
// real ledger, without substituting a permissive fake Room host validator.
const ports: StoryArchivePorts = { replay, validateHostBinding: () => false };
type Locator = { roomId: string; runtimeEpochId: string };
type Part = { part_index: number; part_count: number; part_hash: string; body: string };

async function applyMigration(sql: string) {
  const statements = sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean);
  for (const statement of statements) await db.prepare(statement).run();
}

beforeAll(async () => {
  // Use the actual preceding migrations, including the current rooms table
  // replacement, rather than recreating a convenient parallel test schema.
  for (const [path, sql] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
    if (Number(path.match(/\/(\d+)_/)?.[1]) < 13) await applyMigration(sql);
  }
  await db.prepare("INSERT INTO rooms (id, code, host_user_id, title) VALUES (?, ?, ?, ?)")
    .bind("room:before-story-migration", "BEFORE", "host:archive", "迁移前房间").run();
  await db.prepare(`INSERT INTO authoritative_room_archive_checkpoint
    (room_id, runtime_epoch_id, genesis_hash, settled_event_seq, event_hash, state_hash, active_branch_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind("room:before-story-migration", "epoch:before-story-migration", canonicalSha256("genesis"), 2,
      canonicalSha256("event"), canonicalSha256("state"), "branch:before-story-migration", 1).run();
  await applyMigration(migration0013);
}, 30_000);

async function fixture(large = false) {
  const suffix = crypto.randomUUID(), roomId = `room:story-d1:${suffix}`, runtimeEpochId = `epoch:story-d1:${suffix}`;
  const initialized = step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld", roomId, runtimeEpochId,
    moduleRef: pinnedModuleRef("black-oak-will", "social-resolution-v1"),
    initialDefinitionCatalogRef: { profileId: "catalog:story-d1", profileHash: canonicalSha256("catalog:story-d1") },
    activeBranchId: "branch:story-d1", fictionInstantMicros: "0",
    scenes: [{ id: "scene:archive", name: "档案室" }],
    principals: [{ id: "principal:archive", sessionVersion: 1, role: "host" }],
    seats: [{ id: "seat:archive", principalId: "principal:archive", status: "active" }],
    characters: [{ id: "character:archive", kind: "player", name: "归档员", sceneId: "scene:archive", tenureStatus: "active" }],
    characterControls: [{ characterId: "character:archive", seatId: "seat:archive" }],
    canonicalFacts: [{ id: "fact:archive", kind: "historyOrigin", subjectRefs: ["scene:archive"],
      value: large ? "世界档案🕯️".repeat(20_000) : "档案室保存本地历史。", source: "moduleAnchor", visibilityPolicyId: "visibility:public" }],
    initialKnowledge: [{ characterId: "character:archive", knowledgeRef: "knowledge:archive-private", kind: "sourceClaim",
      layer: "full", content: "PRIVATE_STORY_ARCHIVE_CANARY", visibility: "private", provenanceChain: ["genesis:archive-private"] }],
  });
  expect(initialized.kind).toBe("initialized");
  if (initialized.kind !== "initialized") throw new Error("Rules world initialization failed");
  const initial = replay(initialized.genesis, []);
  if (initial.kind !== "replayed") throw new Error("Rules genesis replay failed");
  let state = initial.state;
  const events: EventEnvelope[] = [];
  const archive = () => buildAuthoritativeArchive({ roomId, signedGenesis: initialized.genesis, events, receiptRefs: [], projectionAudits: [] });
  const advance = async () => {
    const result = step(initialized.profiles, state, { kind: "resolveFreeAction", proposalId: `root:archive:${events.length}`,
      characterId: "character:archive", goal: "整理现有记录", method: "阅读档案", feasibility: { kind: "directSuccess", publicBasis: "记录在手边。" },
      outcome: { fictionTimeCostMicros: "10" } });
    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") throw new Error("Rules archival action did not commit");
    events.push(...result.events);
    const rebuilt = replay(initialized.genesis, events);
    if (rebuilt.kind !== "replayed") throw new Error("Rules action replay failed");
    expect(rebuilt.state).toEqual(result.state);
    state = rebuilt.state;
    return archive();
  };
  const locator = { roomId, runtimeEpochId };
  const room = env.ROOMS.getByName(`story-d1-ledger:${suffix}`);
  const snapshot = (openBudget = false): Promise<StoryStoreArchiveSnapshot> => runInDurableObject(room, (_instance, context) => {
    const store = new StoryCreationStore(context.storage, { hash: canonicalSha256, now: () => 1_000 });
    store.ensureSchema();
    if (openBudget) {
      const limit = { calls: 4, inputTokens: 4_000, outputTokens: 4_000, estimatedCostMicros: 4_000, elapsedMs: 40_000 };
      expect(store.openBudget({ source: { ...locator, branchId: "branch:story-d1", kind: "playerAction",
        sourceId: "root:archive-budget", budgetAccountId: "budget:archive-source" },
      budget: { policyRef: { id: "budget:archive-policy", version: "1", hash: canonicalSha256("budget:archive-policy") },
        roomAccountId: "budget:archive-room", job: limit, source: limit, room: limit } }).kind).toBe("opened");
    }
    const saved = store.archiveSnapshot(locator);
    if (saved.kind !== "available") throw new Error(`Story ledger capture failed: ${saved.code}`);
    return saved.snapshot;
  });
  await db.prepare("INSERT INTO rooms (id, code, host_user_id, title) VALUES (?, ?, ?, ?)")
    .bind(roomId, suffix, "host:archive", "故事归档测试").run();
  return { locator, advance, archive: await advance(), snapshot };
}

async function envelope(archive: AuthoritativeRoomArchive, snapshot: StoryStoreArchiveSnapshot, generation = "1") {
  const built = await buildStoryArchive({ archive, storySnapshot: snapshot, hostBindings: [], generation }, ports);
  expect(built.kind).toBe("prepared");
  if (built.kind !== "prepared") throw new Error(`Story archive build failed: ${built.code}`);
  return built.envelope;
}

function checkpoint(locator: Locator) {
  return db.prepare("SELECT * FROM authoritative_room_archive_checkpoint WHERE room_id = ? AND runtime_epoch_id = ?")
    .bind(locator.roomId, locator.runtimeEpochId).first<Record<string, string | number | null>>();
}
async function parts(value: StoryRoomArchive) {
  return (await db.prepare(`SELECT part_index, part_count, part_hash, body FROM story_room_archive_part
    WHERE room_id = ? AND runtime_epoch_id = ? AND content_hash = ? ORDER BY part_index`)
    .bind(value.source.roomId, value.source.runtimeEpochId, value.contentHash).all<Part>()).results;
}
async function worldRows(locator: Locator) {
  return (await db.prepare(`SELECT event_seq, event_hash, event_json FROM authoritative_room_event_archive
    WHERE room_id = ? AND runtime_epoch_id = ? ORDER BY event_seq`)
    .bind(locator.roomId, locator.runtimeEpochId).all()).results;
}
async function append(value: StoryRoomArchive, progress?: AuthoritativeArchiveProgress) {
  const result = await appendStoryArchiveToD1(db, value, progress, ports);
  expect(result.caughtUp).toBe(true);
  return result;
}

it("applies migration 0013 to the existing schema while preserving the old checkpoint", async () => {
  expect(await checkpoint({ roomId: "room:before-story-migration", runtimeEpochId: "epoch:before-story-migration" }))
    .toMatchObject({ settled_event_seq: 2, story_generation: 0, story_content_hash: null, updated_at: 1,
      event_hash: canonicalSha256("event"), state_hash: canonicalSha256("state") });
  const columns = (await db.prepare("PRAGMA table_info(story_room_archive_part)").all<{ name: string; pk: number }>()).results;
  expect(columns.filter(value => value.pk > 0).sort((a, b) => a.pk - b.pk).map(value => value.name))
    .toEqual(["room_id", "runtime_epoch_id", "content_hash", "part_index"]);
  await expect(db.prepare(`INSERT INTO story_room_archive_part
    (room_id, runtime_epoch_id, content_hash, part_index, part_count, part_hash, body) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind("missing-room", "epoch", canonicalSha256("missing"), 0, 1, canonicalSha256("body"), "body").run())
    .rejects.toThrow(/FOREIGN KEY constraint failed/);
});

it("persists and reads every private chunk together with the real Rules archive", async () => {
  const value = await fixture(true), saved = await envelope(value.archive, await value.snapshot());
  await append(saved);
  const stored = await parts(saved);
  expect(stored.length).toBeGreaterThan(1);
  expect(stored.map(part => part.part_index)).toEqual(stored.map((_part, index) => index));
  for (const part of stored) {
    expect(part.part_count).toBe(stored.length);
    expect(part.part_hash).toBe(await archiveSha256(part.body));
    expect(new TextDecoder().decode(new TextEncoder().encode(part.body))).toBe(part.body);
  }
  expect(stored.map(part => part.body).join("")).toBe(canonicalJson(saved));
  const read = await readStoryArchiveFromD1(db, value.locator, ports);
  expect(read.envelope).toEqual(saved);
  expect(canonicalJson(read.envelope)).toContain("PRIVATE_STORY_ARCHIVE_CANARY");
  expect((await worldRows(value.locator)).length).toBe(saved.archive.events.length);
}, 20_000);

it("publishes ledger-only generation changes at the same world checkpoint and retries without new writes", async () => {
  const value = await fixture(), first = await envelope(value.archive, await value.snapshot());
  const initial = await append(first), world = await worldRows(value.locator);
  const next = await envelope(value.archive, await value.snapshot(true), "2");
  expect(first.storySnapshot.accounts).toHaveLength(0);
  expect(next.storySnapshot.accounts).toHaveLength(2);
  expect(next.archive).toEqual(first.archive);
  const updated = await append(next, initial.progress);
  expect(updated.progress).toEqual(initial.progress);
  expect(updated.statementsWritten).toBe(1);
  expect(await checkpoint(value.locator)).toMatchObject({ story_generation: 2, story_content_hash: next.contentHash,
    settled_event_seq: Number(first.archive.head.eventSeq), event_hash: first.archive.head.eventHash });
  expect(await worldRows(value.locator)).toEqual(world);
  expect((await readStoryArchiveFromD1(db, value.locator, ports)).envelope).toEqual(next);
  const beforeRetry = await parts(next), committed = await checkpoint(value.locator);
  expect((await append(next, updated.progress)).statementsWritten).toBe(0);
  expect(await parts(next)).toEqual(beforeRetry);
  expect(await checkpoint(value.locator)).toEqual(committed);
  await expect(appendStoryArchiveToD1(db, first, updated.progress, ports)).rejects.toThrow(/generation cannot be overwritten/);
  const alias = await envelope(value.archive, first.storySnapshot, "2");
  await expect(appendStoryArchiveToD1(db, alias, updated.progress, ports)).rejects.toThrow(/generation cannot be overwritten/);
  expect((await readStoryArchiveFromD1(db, value.locator, ports)).envelope).toEqual(next);
});

it.each([
  { mode: "missing" as const, code: "STORY_ARCHIVE_MATERIALS_MISSING" },
  { mode: "changed" as const, code: "STORY_ARCHIVE_BINDING_INVALID" },
  { mode: "rehashed" as const, code: "STORY_ARCHIVE_INVALID" },
])("rejects $mode private bytes instead of exposing an incomplete archive", async ({ mode, code }) => {
  const value = await fixture(true), saved = await envelope(value.archive, await value.snapshot());
  await append(saved);
  const stored = await parts(saved), last = stored.at(-1)!;
  if (mode === "missing") {
    await db.prepare(`DELETE FROM story_room_archive_part
      WHERE room_id = ? AND runtime_epoch_id = ? AND content_hash = ? AND part_index = ?`)
      .bind(value.locator.roomId, value.locator.runtimeEpochId, saved.contentHash, last.part_index).run();
  } else {
    // Equal-length generation corruption keeps all chunk boundaries intact.
    // Rehashing each changed SQL cell still cannot forge the envelope hash.
    const target = mode === "rehashed" ? stored.find(part => part.body.includes('"generation":"1"'))! : last;
    const body = mode === "rehashed" ? target.body.replace('"generation":"1"', '"generation":"7"') : `${target.body}x`;
    await db.prepare(`UPDATE story_room_archive_part SET body = ?, part_hash = ?
      WHERE room_id = ? AND runtime_epoch_id = ? AND content_hash = ? AND part_index = ?`)
      .bind(body, mode === "rehashed" ? await archiveSha256(body) : target.part_hash,
        value.locator.roomId, value.locator.runtimeEpochId, saved.contentHash, target.part_index).run();
    await expect(appendStoryArchiveToD1(db, saved, undefined, ports)).rejects.toMatchObject({ code: "STORY_ARCHIVE_BINDING_INVALID" });
  }
  await expect(readStoryArchiveFromD1(db, value.locator, ports)).rejects.toMatchObject({ code });
}, 20_000);

it("rejects an incomplete embedded world even when its archive, envelope and SQL chunk are all rehashed", async () => {
  const value = await fixture(), saved = await envelope(value.archive, await value.snapshot());
  await append(saved);
  const damaged = structuredClone(saved);
  damaged.archive.events.pop();
  const { archiveHash: _archiveHash, ...unsignedWorld } = damaged.archive;
  damaged.archive.archiveHash = await archiveSha256(unsignedWorld);
  const body = { ...damaged, source: { ...damaged.source, archiveHash: damaged.archive.archiveHash } };
  const { contentHash: _contentHash, ...unsignedEnvelope } = body;
  const forged = { ...unsignedEnvelope, contentHash: await archiveSha256(unsignedEnvelope) };
  const bytes = canonicalJson(forged);
  await db.prepare(`INSERT INTO story_room_archive_part
    (room_id, runtime_epoch_id, content_hash, part_index, part_count, part_hash, body) VALUES (?, ?, ?, 0, 1, ?, ?)`)
    .bind(value.locator.roomId, value.locator.runtimeEpochId, forged.contentHash, await archiveSha256(bytes), bytes).run();
  await db.prepare(`UPDATE authoritative_room_archive_checkpoint SET story_content_hash = ?
    WHERE room_id = ? AND runtime_epoch_id = ?`).bind(forged.contentHash, value.locator.roomId, value.locator.runtimeEpochId).run();
  await expect(readStoryArchiveFromD1(db, value.locator, ports)).rejects.toMatchObject({ code: "STORY_ARCHIVE_WORLD_INVALID" });
});

it("verifies actual committed world rows even when the private envelope is intact", async () => {
  const value = await fixture(), saved = await envelope(value.archive, await value.snapshot());
  await append(saved);
  const event = saved.archive.events.at(-1)!;
  await db.prepare("DELETE FROM authoritative_room_event_archive WHERE room_id = ? AND runtime_epoch_id = ? AND event_seq = ?")
    .bind(value.locator.roomId, value.locator.runtimeEpochId, event.eventSeq).run();
  expect((await parts(saved)).map(part => part.body).join("")).toBe(canonicalJson(saved));
  await expect(readStoryArchiveFromD1(db, value.locator, ports)).rejects.toBeInstanceOf(AuthoritativeArchiveD1ReadError);
});

it("rolls back the joint world/private publication on a real D1 batch failure and safely retries", async () => {
  const value = await fixture(), first = await envelope(value.archive, await value.snapshot());
  const initial = await append(first), oldCheckpoint = await checkpoint(value.locator), oldWorld = await worldRows(value.locator);
  const next = await envelope(await value.advance(), await value.snapshot(true), "2");
  expect(Number(next.archive.head.eventSeq)).toBeGreaterThan(Number(first.archive.head.eventSeq));
  const sqlByStatement = new WeakMap<D1PreparedStatement, string>();
  let publications = 0;
  // All queries and results still go through the real local D1. The wrapper
  // only adds a failing SQL statement to the adapter's publication batch.
  const faultDb = new Proxy(db, { get(target, property) {
    if (property === "prepare") return (sql: string) => new Proxy(target.prepare(sql), { get(statement, key) {
      if (key === "bind") return (...values: unknown[]) => {
        const bound = statement.bind(...values); sqlByStatement.set(bound, sql); return bound;
      };
      const member = Reflect.get(statement, key, statement);
      return typeof member === "function" ? member.bind(statement) : member;
    } });
    if (property === "batch") return async (statements: D1PreparedStatement[]) => {
      if (statements.some(statement => sqlByStatement.get(statement)?.includes("INSERT INTO authoritative_room_archive_checkpoint"))) {
        publications++;
        expect(statements.some(statement => sqlByStatement.get(statement)?.includes("authoritative_room_event_archive"))).toBe(true);
        expect((await parts(next)).length).toBeGreaterThan(0);
        expect(await checkpoint(value.locator)).toEqual(oldCheckpoint);
        expect((await readStoryArchiveFromD1(db, value.locator, ports)).envelope).toEqual(first);
        return target.batch([...statements, target.prepare("INSERT INTO rooms (id, code, host_user_id, title) VALUES (?, ?, ?, ?)")
          .bind(value.locator.roomId, "atomic-failure", "host:archive", "故障注入")]);
      }
      return target.batch(statements);
    };
    const member = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  await expect(appendStoryArchiveToD1(faultDb, next, initial.progress, ports)).rejects.toThrow(/UNIQUE constraint failed/);
  expect(publications).toBe(1);
  expect(await checkpoint(value.locator)).toEqual(oldCheckpoint);
  expect(await worldRows(value.locator)).toEqual(oldWorld);
  expect((await readStoryArchiveFromD1(db, value.locator, ports)).envelope).toEqual(first);
  const uploaded = await parts(next);
  const retried = await append(next, initial.progress);
  expect(await parts(next)).toEqual(uploaded);
  expect((await readStoryArchiveFromD1(db, value.locator, ports)).envelope).toEqual(next);
  expect((await worldRows(value.locator)).length).toBe(next.archive.events.length);
  expect((await append(next, retried.progress)).statementsWritten).toBe(0);
});
