import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTHORITATIVE_ARCHIVE_D1_BATCH_LIMIT,
  appendAuthoritativeArchiveToD1,
} from "../app/_runtime/lib/room/archive.ts";
import { step, replay } from "../app/_runtime/lib/rules/index.ts";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests.ts";
import {
  createEventTransition,
  createScopeProof,
} from "../app/_runtime/lib/rules/v2/events.ts";

const sha = (number) => `sha256:${number.toString(16).padStart(64, "0")}`;

function archiveWith(eventCount, audienceCount) {
  const roomId = "room:incremental-archive";
  const runtimeEpochId = "epoch:incremental-archive";
  const initialized = step(ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId,
    runtimeEpochId,
    moduleRef: { profileId: "module:archive-test:v1", profileHash: sha(5) },
    initialDefinitionCatalogRef: {
      profileId: "definitions:archive-test:v1",
      profileHash: sha(6),
    },
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{ id: "scene:archive", name: "归档测试场景" }],
    principals: [{ id: "principal:archive", sessionVersion: 1, role: "host" }],
    seats: [{
      id: "seat:archive",
      principalId: "principal:archive",
      status: "active",
    }],
    characters: [{
      id: "character:archive",
      kind: "player",
      name: "归档员",
      sceneId: "scene:archive",
      tenureStatus: "active",
      classId: "fighter",
      level: 1,
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      proficientSkills: [],
      resources: {},
      resourceMaximums: {},
      hitPoints: { current: 10, maximum: 10 },
      loadout: { armorClass: 10, speedFeet: 30, equipped: {}, backpack: [] },
      characterBuild: {
        classId: "fighter",
        raceId: "human",
        cantrips: [],
        prepared: [],
      },
    }],
    characterControls: [{
      characterId: "character:archive",
      seatId: "seat:archive",
    }],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const initialReplay = replay(initialized.genesis, []);
  assert.equal(initialReplay.kind, "replayed", JSON.stringify(initialReplay));
  const profiles = initialized.profiles;
  let state = initialReplay.state;
  const events = Array.from({ length: eventCount }, (_, index) => {
    const eventSeq = String(index + 1);
    const factId = `fact:archive:${eventSeq}`;
    const transition = createEventTransition(state, profiles, {
      rootActionId: `root:archive:${eventSeq}`,
      eventType: "ImprovisedActionResolved",
      payload: {
        actorCharacterId: "character:archive",
        outcomeCode: "archiveFixture",
        fact: {
          id: factId,
          kind: "archiveFixture",
          source: "dynamicMaterialization",
          subjectRefs: ["scene:archive"],
          value: { publicSummary: `事实 ${eventSeq}` },
          visibilityPolicyId: "visibility:public",
        },
      },
      scopeProof: createScopeProof(state, ["scene:archive"], [factId], [factId]),
      visibilityPolicyId: "visibility:public",
      secrecy: "public",
    });
    state = transition.state;
    return transition.event;
  });
  const projectionAudits = Array.from({ length: audienceCount }, (_, index) => ({
    eventSeq: String(eventCount),
    viewerHash: sha(10_000 + index),
    projectionHash: sha(20_000 + index),
  }));
  return {
    format: "zhuwei.authoritative-room-archive/v2",
    roomId,
    signedGenesis: initialized.genesis,
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
      stateHash: events.at(-1)?.stateHashAfter ?? initialized.genesis.initialStateHash,
      activeBranchId: "branch:main",
    },
    archiveHash: sha(8),
  };
}

class FakeStatement {
  constructor(sql, first, all = async () => ({ results: [] })) {
    this.sql = sql;
    this.bindings = [];
    this.queryFirst = first;
    this.queryAll = all;
  }

  bind(...bindings) {
    this.bindings = bindings;
    return this;
  }

  async first() {
    return this.queryFirst(this);
  }

  async all() {
    return this.queryAll(this);
  }
}

class FakeD1 {
  constructor() {
    this.batches = [];
    this.genesis = new Map();
    this.events = new Map();
    this.audits = new Map();
    this.checkpoints = new Map();
    this.failNextBatch = false;
  }

  prepare(sql) {
    return new FakeStatement(sql, async (statement) => {
      if (statement.sql.includes("authoritative_archive_head_genesis")) {
        const row = this.genesis.get(
          `${String(statement.bindings[0])}\u0000${String(statement.bindings[1])}`,
        );
        return row === undefined ? null : {
          genesis_hash: row[2],
          genesis_json: row[13],
        };
      }
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
        checkpoint_genesis_hash: this.checkpoints.get(`${roomId}\u0000${epochId}`)?.[2] ?? null,
        checkpoint_settled_event_seq: this.checkpoints.get(`${roomId}\u0000${epochId}`)?.[3] ?? null,
        checkpoint_event_hash: this.checkpoints.get(`${roomId}\u0000${epochId}`)?.[4] ?? null,
        checkpoint_state_hash: this.checkpoints.get(`${roomId}\u0000${epochId}`)?.[5] ?? null,
        checkpoint_active_branch_id: this.checkpoints.get(`${roomId}\u0000${epochId}`)?.[6] ?? null,
        checkpoint_materialized_event_hash: this.events.get(
          `${roomId}\u0000${epochId}\u0000${this.checkpoints.get(`${roomId}\u0000${epochId}`)?.[3]}`,
        )?.[18] ?? null,
        checkpoint_materialized_state_hash: this.events.get(
          `${roomId}\u0000${epochId}\u0000${this.checkpoints.get(`${roomId}\u0000${epochId}`)?.[3]}`,
        )?.[17] ?? null,
        checkpoint_materialized_branch_id: this.events.get(
          `${roomId}\u0000${epochId}\u0000${this.checkpoints.get(`${roomId}\u0000${epochId}`)?.[3]}`,
        )?.[5] ?? null,
      };
    }, async (statement) => {
      if (statement.sql.includes("authoritative_archive_head_events")) {
        const roomId = String(statement.bindings[0]);
        const epochId = String(statement.bindings[1]);
        const head = BigInt(String(statement.bindings[2]));
        const results = [...this.events.values()]
          .filter((bindings) => String(bindings[0]) === roomId
            && String(bindings[1]) === epochId
            && BigInt(String(bindings[2])) <= head)
          .sort((left, right) => Number(left[2]) - Number(right[2]))
          .map((bindings) => ({
            event_seq: bindings[2],
            event_hash: bindings[18],
            state_hash_after: bindings[17],
            branch_id: bindings[5],
            event_json: bindings[19],
          }));
        return { results };
      }
      if (statement.sql.includes("authoritative_archive_checkpoint_prefix_replay")) {
        const roomId = String(statement.bindings[0]);
        const epochId = String(statement.bindings[1]);
        const checkpoint = BigInt(String(statement.bindings[2]));
        const results = [...this.events.values()]
          .filter((bindings) => String(bindings[0]) === roomId
            && String(bindings[1]) === epochId
            && BigInt(String(bindings[2])) <= checkpoint)
          .sort((left, right) => Number(left[2]) - Number(right[2]))
          .map((bindings) => ({ event_json: bindings[19] }));
        return { results };
      }
      if (!statement.sql.includes("authoritative_projection_audit_archive")) {
        throw new Error(`unexpected rows query: ${statement.sql}`);
      }
      const roomId = String(statement.bindings[0]);
      const epochId = String(statement.bindings[1]);
      const eventSeq = String(statement.bindings[2]);
      const results = [...this.audits.values()]
        .filter((bindings) => String(bindings[0]) === roomId
          && String(bindings[1]) === epochId
          && String(bindings[2]) === eventSeq)
        .sort((left, right) => String(left[3]).localeCompare(String(right[3])))
        .map((bindings) => ({
          event_seq: bindings[2],
          viewer_hash: bindings[3],
          projection_hash: bindings[4],
        }));
      return { results };
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
        const key = `${roomId}\u0000${epochId}`;
        if (!this.genesis.has(key)) this.genesis.set(key, statement.bindings);
      } else if (statement.sql.includes("authoritative_room_event_archive")) {
        const key = `${roomId}\u0000${epochId}\u0000${eventSeq}`;
        if (!this.events.has(key)) this.events.set(key, statement.bindings);
      } else if (statement.sql.includes("authoritative_projection_audit_archive")) {
        const key = `${roomId}\u0000${epochId}\u0000${eventSeq}\u0000${viewerHash}`;
        if (!this.audits.has(key)) this.audits.set(key, statement.bindings);
      } else if (statement.sql.includes("authoritative_room_archive_checkpoint")) {
        this.checkpoints.set(`${roomId}\u0000${epochId}`, statement.bindings);
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
      ...this.checkpoints.values(),
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

  assert.deepEqual(pages.map((page) => page.statementsWritten), [39, 39, 26]);
  assert.ok(db.batches.every((batch) => batch.length <= 40));
  assert.equal(db.genesis.size, 1);
  assert.equal(db.events.size, 85);
  assert.equal(db.audits.size, 17);
  assert.equal(db.checkpoints.size, 1);
  assert.equal(db.batches[0].some((statement) =>
    statement.sql.includes("authoritative_room_archive_checkpoint")), false);
  assert.equal(db.batches.at(-1).some((statement) =>
    statement.sql.includes("authoritative_room_archive_checkpoint")), true);
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

  assert.deepEqual(pages.map((page) => page.statementsWritten), [39, 39, 19]);
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
  assert.deepEqual(next.pages.map((page) => page.statementsWritten), [39, 13]);
  assert.ok(
    db.batches.slice(batchesAfterFirstHead).flat()
      .filter((statement) => statement.sql.includes("authoritative_room_event_archive"))
      .every((statement) => Number(statement.bindings[2]) >= 43),
  );
  assert.equal(db.events.size, 87);
  assert.equal(db.audits.size, 10);
});

test("backfills a missing checkpoint without rewriting a caught-up archive", async () => {
  const archive = archiveWith(3, 2);
  const db = new FakeD1();
  const completed = await drain(db, archive);
  db.checkpoints.clear();
  const batchesBeforeBackfill = db.batches.length;

  const backfilled = await appendAuthoritativeArchiveToD1(db, archive, completed.progress);

  assert.equal(backfilled.caughtUp, true);
  assert.equal(backfilled.statementsWritten, 1);
  assert.equal(db.batches.length, batchesBeforeBackfill + 1);
  assert.equal(db.batches.at(-1).length, 1);
  assert.equal(db.batches.at(-1)[0].sql.includes("authoritative_room_archive_checkpoint"), true);
  assert.equal(db.events.size, 3);
  assert.equal(db.audits.size, 2);
  assert.equal(db.checkpoints.size, 1);
});

test("rejects a checkpoint that would roll back or conflict with the archive head", async () => {
  const archive = archiveWith(3, 2);
  const db = new FakeD1();
  const completed = await drain(db, archive);
  const checkpoint = db.checkpoints.get(`${archive.roomId}\u0000${archive.signedGenesis.runtimeEpochId}`);
  checkpoint[4] = sha(999_999);

  await assert.rejects(
    appendAuthoritativeArchiveToD1(db, archive, completed.progress),
    /archive cursor is not materialized/i,
  );
});

test("rejects a checkpoint whose materialized D1 event prefix no longer replays", async () => {
  const archive = archiveWith(3, 2);
  const db = new FakeD1();
  const completed = await drain(db, archive);
  const firstKey = `${archive.roomId}\u0000${archive.signedGenesis.runtimeEpochId}\u00001`;
  const first = db.events.get(firstKey);
  const corrupted = JSON.parse(first[19]);
  corrupted.payload.fact.value.publicSummary = "被篡改的归档事实";
  first[19] = JSON.stringify(corrupted);

  await assert.rejects(
    appendAuthoritativeArchiveToD1(db, archive, completed.progress),
    /archive cursor is not materialized/i,
  );
});

test("rejects an ahead same-sequence event conflict before advancing a checkpoint", async () => {
  const archive = archiveWith(3, 2);
  const db = new FakeD1();
  await drain(db, archive);
  db.checkpoints.clear();
  const secondKey = `${archive.roomId}\u0000${archive.signedGenesis.runtimeEpochId}\u00002`;
  const second = db.events.get(secondKey);
  const conflicting = JSON.parse(second[19]);
  conflicting.payload.fact.value.publicSummary = "同序冲突事件";
  second[19] = JSON.stringify(conflicting);

  await assert.rejects(
    appendAuthoritativeArchiveToD1(db, archive),
    /archive cursor is not materialized/i,
  );
  assert.equal(db.checkpoints.size, 0);
});

test("rejects a same-key conflicting genesis before advancing a checkpoint", async () => {
  const archive = archiveWith(1, 1);
  const db = new FakeD1();
  await drain(db, archive);
  db.checkpoints.clear();
  const genesisKey = `${archive.roomId}\u0000${archive.signedGenesis.runtimeEpochId}`;
  const genesis = db.genesis.get(genesisKey);
  genesis[2] = sha(999_998);

  await assert.rejects(
    appendAuthoritativeArchiveToD1(db, archive),
    /archive cursor is not materialized/i,
  );
  assert.equal(db.checkpoints.size, 0);
});

test("fails closed when a forged caught-up audit cursor has missing head rows", async () => {
  const archive = archiveWith(3, 2);
  const db = new FakeD1();
  const completed = await drain(db, archive);
  db.audits.clear();
  db.checkpoints.clear();

  await assert.rejects(
    appendAuthoritativeArchiveToD1(db, archive, completed.progress),
    /archive cursor is not materialized/i,
  );
  assert.equal(db.checkpoints.size, 0);
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
  assert.equal(first.statementsWritten, 39);
  assert.equal(first.progress.lastEventSeq, "38");

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
