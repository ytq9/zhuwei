import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTHORITATIVE_ARCHIVE_D1_BATCH_LIMIT,
  appendAuthoritativeArchiveToD1,
} from "../app/_runtime/lib/room/archive.ts";

const sha = (number) => `sha256:${number.toString(16).padStart(64, "0")}`;

function archiveWith(eventCount, audienceCount) {
  const roomId = "room:incremental-archive";
  const runtimeEpochId = "epoch:incremental-archive";
  const profiles = {
    manifest: { profileId: "manifest:v2", profileHash: sha(1) },
    ruleset: { profileId: "rules:v2", profileHash: sha(2) },
    eventSchema: { profileId: "events:v2", profileHash: sha(3) },
  };
  const events = Array.from({ length: eventCount }, (_, index) => {
    const eventSeq = String(index + 1);
    return {
      roomId,
      runtimeEpochId,
      eventSeq,
      eventId: `event:${eventSeq}`,
      rootActionId: `root:${Math.floor(index / 3)}`,
      branchId: "branch:main",
      eventType: "WorldFactEstablished",
      eventTypeVersion: "1",
      profiles,
      payloadHash: sha(1000 + index),
      previousEventHash: index === 0 ? sha(10) : sha(2000 + index - 1),
      stateBeforeHash: sha(3000 + index),
      stateHashAfter: sha(4000 + index),
      eventHash: sha(2000 + index),
      payload: { factId: `fact:${eventSeq}`, publicSummary: `事实 ${eventSeq}` },
    };
  });
  const projectionAudits = Array.from({ length: audienceCount }, (_, index) => ({
    eventSeq: String(eventCount),
    viewerHash: sha(10_000 + index),
    projectionHash: sha(20_000 + index),
  }));
  return {
    format: "zhuwei.authoritative-room-archive/v2",
    roomId,
    signedGenesis: {
      roomId,
      runtimeEpochId,
      genesisHash: sha(4),
      profiles,
      moduleRef: { profileId: "module:v1", profileHash: sha(5) },
      initialDefinitionCatalogRef: { profileId: "definitions:v1", profileHash: sha(6) },
      initialState: {},
      initialStateHash: sha(7),
    },
    events,
    // These presentation/input sentinels deliberately live outside the persisted
    // genesis/event/audit allowlist. The incremental writer must never serialize them.
    receiptRefs: [{
      receiptId: "receipt:sensitive",
      rawIntent: "RAW_INTENT_MUST_NOT_BE_ARCHIVED",
      prompt: "PROMPT_MUST_NOT_BE_ARCHIVED",
      delivery: "DELIVERY_MUST_NOT_BE_ARCHIVED",
    }],
    projectionAudits,
    head: {
      eventSeq: String(eventCount),
      eventHash: events.at(-1)?.eventHash ?? sha(10),
      stateHash: events.at(-1)?.stateHashAfter ?? sha(7),
      activeBranchId: "branch:main",
    },
    archiveHash: sha(8),
  };
}

class FakeStatement {
  constructor(sql, first) {
    this.sql = sql;
    this.bindings = [];
    this.queryFirst = first;
  }

  bind(...bindings) {
    this.bindings = bindings;
    return this;
  }

  async first() {
    return this.queryFirst(this);
  }
}

class FakeD1 {
  constructor() {
    this.batches = [];
    this.genesis = new Map();
    this.events = new Map();
    this.audits = new Map();
    this.failNextBatch = false;
  }

  prepare(sql) {
    return new FakeStatement(sql, async (statement) => {
      if (!statement.sql.includes("authoritative_archive_cursor_probe")) {
        throw new Error(`unexpected query: ${statement.sql}`);
      }
      const roomId = String(statement.bindings[0]);
      const epochId = String(statement.bindings[1]);
      const cursor = BigInt(String(statement.bindings[2]));
      const prefix = [...this.events.values()]
        .filter((bindings) =>
          String(bindings[0]) === roomId
          && String(bindings[1]) === epochId
          && BigInt(String(bindings[2])) <= cursor)
        .sort((left, right) => Number(left[2]) - Number(right[2]));
      const cursorEvent = prefix.find((bindings) => BigInt(String(bindings[2])) === cursor);
      return {
        genesis_hash: this.genesis.get(`${roomId}\u0000${epochId}`)?.[2] ?? null,
        archived_event_count: String(prefix.length),
        first_event_seq: prefix.length === 0 ? null : String(prefix[0][2]),
        last_event_seq: prefix.length === 0 ? null : String(prefix.at(-1)[2]),
        cursor_event_hash: cursorEvent?.[18] ?? null,
      };
    });
  }

  async batch(statements) {
    const captured = statements.map((statement) => ({
      sql: statement.sql,
      bindings: structuredClone(statement.bindings),
    }));
    this.batches.push(captured);
    if (this.failNextBatch) {
      this.failNextBatch = false;
      throw new Error("synthetic atomic D1 batch failure");
    }
    for (const statement of captured) {
      const [roomId, epochId, eventSeq, viewerHash] = statement.bindings;
      if (statement.sql.includes("authoritative_room_genesis_archive")) {
        this.genesis.set(`${roomId}\u0000${epochId}`, statement.bindings);
      } else if (statement.sql.includes("authoritative_room_event_archive")) {
        this.events.set(`${roomId}\u0000${epochId}\u0000${eventSeq}`, statement.bindings);
      } else if (statement.sql.includes("authoritative_projection_audit_archive")) {
        this.audits.set(`${roomId}\u0000${epochId}\u0000${eventSeq}\u0000${viewerHash}`, statement.bindings);
      } else {
        throw new Error(`unexpected statement: ${statement.sql}`);
      }
    }
    return captured.map(() => ({ success: true }));
  }

  serializedWrites() {
    return JSON.stringify([
      ...this.genesis.values(),
      ...this.events.values(),
      ...this.audits.values(),
    ]);
  }
}

async function drain(db, archive, startProgress) {
  let progress = startProgress;
  const pages = [];
  for (let guard = 0; guard < 100; guard += 1) {
    const result = await appendAuthoritativeArchiveToD1(db, archive, progress);
    pages.push(result);
    progress = result.progress;
    if (result.caughtUp) return { pages, progress };
  }
  throw new Error("incremental archive did not converge");
}

test("archives 80+ events and multiple audiences as cursor-only batches of at most 40 statements", async () => {
  assert.equal(AUTHORITATIVE_ARCHIVE_D1_BATCH_LIMIT, 40);
  const archive = archiveWith(85, 17);
  const db = new FakeD1();

  const { pages, progress } = await drain(db, archive);

  assert.deepEqual(pages.map((page) => page.statementsWritten), [40, 40, 23]);
  assert.ok(db.batches.every((batch) => batch.length <= 40));
  assert.equal(db.genesis.size, 1);
  assert.equal(db.events.size, 85);
  assert.equal(db.audits.size, 17);
  assert.equal(progress.genesisArchived, true);
  assert.equal(progress.lastEventSeq, "85");
  assert.deepEqual(progress.auditCursor, {
    eventSeq: "85",
    viewerHash: sha(10_016),
  });
  assert.equal(pages.at(-1).caughtUp, true);
  assert.doesNotMatch(
    db.serializedWrites(),
    /RAW_INTENT_MUST_NOT_BE_ARCHIVED|PROMPT_MUST_NOT_BE_ARCHIVED|DELIVERY_MUST_NOT_BE_ARCHIVED/,
  );
});

test("paginates the latest projection-audit head without replaying already archived events", async () => {
  const archive = archiveWith(5, 90);
  const db = new FakeD1();

  const { pages } = await drain(db, archive);

  assert.deepEqual(pages.map((page) => page.statementsWritten), [40, 40, 16]);
  assert.deepEqual(pages.map((page) => page.progress.lastEventSeq), ["5", "5", "5"]);
  assert.equal(db.events.size, 5);
  assert.equal(db.audits.size, 90);
  assert.ok(pages[0].progress.auditCursor);
  assert.equal(pages[0].progress.auditCursor.eventSeq, "5");
});

test("a caught-up cursor writes only a later archive delta and becomes a zero-write no-op", async () => {
  const db = new FakeD1();
  const firstArchive = archiveWith(42, 4);
  const first = await drain(db, firstArchive);
  const batchesAfterFirstHead = db.batches.length;

  const unchanged = await appendAuthoritativeArchiveToD1(db, firstArchive, first.progress);
  assert.deepEqual(unchanged, {
    progress: first.progress,
    caughtUp: true,
    statementsWritten: 0,
  });
  assert.equal(db.batches.length, batchesAfterFirstHead);

  const nextArchive = archiveWith(87, 6);
  const next = await drain(db, nextArchive, first.progress);
  assert.deepEqual(next.pages.map((page) => page.statementsWritten), [40, 11]);
  assert.ok(
    db.batches.slice(batchesAfterFirstHead).flat()
      .filter((statement) => statement.sql.includes("authoritative_room_event_archive"))
      .every((statement) => Number(statement.bindings[2]) >= 43),
  );
  assert.equal(db.events.size, 87);
  assert.equal(db.audits.size, 10);
});

test("a failed atomic batch returns no advanced progress and the same cursor retries safely", async () => {
  const archive = archiveWith(85, 3);
  const db = new FakeD1();
  const callerProgress = undefined;
  db.failNextBatch = true;

  await assert.rejects(
    appendAuthoritativeArchiveToD1(db, archive, callerProgress),
    /synthetic atomic D1 batch failure/,
  );
  assert.equal(db.genesis.size, 0);
  assert.equal(db.events.size, 0);
  assert.equal(db.audits.size, 0);

  const first = await appendAuthoritativeArchiveToD1(db, archive, callerProgress);
  assert.equal(first.statementsWritten, 40);
  assert.equal(first.progress.lastEventSeq, "39");

  const rowCounts = [db.genesis.size, db.events.size, db.audits.size];
  const repeated = await appendAuthoritativeArchiveToD1(db, archive, callerProgress);
  assert.deepEqual(repeated, first);
  assert.deepEqual([db.genesis.size, db.events.size, db.audits.size], rowCounts);

  const { pages } = await drain(db, archive, first.progress);
  assert.equal(pages.at(-1).caughtUp, true);
  assert.equal(db.genesis.size, 1);
  assert.equal(db.events.size, 85);
  assert.equal(db.audits.size, 3);
});

test("rejects a cursor from another room or epoch before issuing a D1 batch", async () => {
  const archive = archiveWith(1, 1);
  const db = new FakeD1();
  const wrongProgress = {
    format: "zhuwei.authoritative-archive-progress/v1",
    roomId: archive.roomId,
    runtimeEpochId: "epoch:wrong",
    genesisArchived: true,
    lastEventSeq: "1",
    auditCursor: null,
  };

  await assert.rejects(
    appendAuthoritativeArchiveToD1(db, archive, wrongProgress),
    /archive progress does not belong/i,
  );
  assert.equal(db.batches.length, 0);
});
