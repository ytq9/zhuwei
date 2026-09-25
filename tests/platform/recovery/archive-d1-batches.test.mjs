// SPEC 0011 §6: D1 keeps the story archive and one checkpoint row per room
// epoch. No genesis, per-event world or projection-audit rows are written.
import assert from "node:assert/strict";
import test from "node:test";

import { publishArchiveCheckpoint } from "../../../app/_runtime/lib/room/archive.ts";
import { step, replay } from "../../../app/_runtime/lib/rules/index.ts";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../../../app/_runtime/lib/rules/profiles/manifests.ts";
import { createEventTransition } from "../../../app/_runtime/lib/rules/v2/events.ts";

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
      lastEventId: events.at(-1)?.eventId ?? null,
      activeBranchId: "branch:main",
    },
    archiveHash: sha(8),
  };
}

/** Records every statement and keeps the checkpoint table with the upsert's
 * monotonic guard, as D1 applies it. */
class FakeD1 {
  constructor() {
    this.statements = [];
    this.checkpoints = new Map();
  }

  prepare(sql) {
    const { statements, checkpoints } = this;
    const statement = {
      sql,
      bindings: [],
      bind(...bindings) { statement.bindings = bindings; return statement; },
      async first() {
        statements.push({ sql, bindings: structuredClone(statement.bindings) });
        const row = checkpoints.get(`${statement.bindings[0]}\u0000${statement.bindings[1]}`);
        return row === undefined ? null : {
          story_generation: row.story_generation,
          story_content_hash: row.story_content_hash,
          settled_event_seq: row.settled_event_seq,
        };
      },
      async run() {
        statements.push({ sql, bindings: structuredClone(statement.bindings) });
        if (!sql.includes("INSERT INTO authoritative_room_archive_checkpoint")) throw new Error(`unexpected write: ${sql}`);
        const [roomId, runtimeEpochId, genesisHash, settledEventSeq, eventHash, stateHash, activeBranchId, updatedAt,
          storyGeneration, storyContentHash] = statement.bindings;
        const key = `${roomId}\u0000${runtimeEpochId}`, current = checkpoints.get(key);
        if (current && (BigInt(settledEventSeq) < BigInt(current.settled_event_seq)
          || storyGeneration < current.story_generation)) return { success: true };
        checkpoints.set(key, { genesis_hash: genesisHash, settled_event_seq: settledEventSeq, event_hash: eventHash,
          state_hash: stateHash, active_branch_id: activeBranchId, updated_at: updatedAt,
          story_generation: storyGeneration, story_content_hash: storyContentHash });
        return { success: true };
      },
    };
    return statement;
  }

  writes() {
    return this.statements.filter((statement) => !statement.sql.trimStart().startsWith("SELECT"));
  }
}

const checkpointOf = (db, archive) => db.checkpoints.get(`${archive.roomId}\u0000${archive.signedGenesis.runtimeEpochId}`);

test("a published archive writes one checkpoint row and no genesis, event or audit rows", async () => {
  const archive = archiveWith(85, 17);
  const db = new FakeD1();

  const result = await publishArchiveCheckpoint(db, archive, { generation: 1, contentHash: sha(1) });

  assert.equal(result.caughtUp, true);
  assert.equal(result.statementsWritten, 1);
  assert.equal(result.progress.lastEventSeq, "85");
  const writes = db.writes();
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /INSERT INTO authoritative_room_archive_checkpoint/);
  assert.equal(db.statements.some((statement) =>
    /authoritative_room_event_archive|authoritative_room_genesis_archive|authoritative_projection_audit_archive/
      .test(statement.sql)), false);
  // The legacy NOT NULL hash columns hold the last event id and nothing.
  assert.deepEqual(checkpointOf(db, archive), {
    genesis_hash: archive.signedGenesis.genesisHash, settled_event_seq: "85",
    event_hash: archive.events.at(-1).eventId, state_hash: "", active_branch_id: "branch:main",
    updated_at: checkpointOf(db, archive).updated_at, story_generation: 1, story_content_hash: sha(1),
  });
  assert.doesNotMatch(JSON.stringify(db.statements),
    /RAW_INTENT_MUST_NOT_BE_ARCHIVED|PROMPT_MUST_NOT_BE_ARCHIVED|DELIVERY_MUST_NOT_BE_ARCHIVED/);
});

test("an unchanged checkpoint is a zero-write no-op and a later head advances it", async () => {
  const db = new FakeD1();
  const first = archiveWith(3, 1);
  await publishArchiveCheckpoint(db, first, { generation: 1, contentHash: sha(1) });

  const unchanged = await publishArchiveCheckpoint(db, first, { generation: 1, contentHash: sha(1) });
  assert.equal(unchanged.statementsWritten, 0);
  assert.equal(db.writes().length, 1);

  const later = archiveWith(5, 1);
  const advanced = await publishArchiveCheckpoint(db, later, { generation: 2, contentHash: sha(2) });
  assert.equal(advanced.statementsWritten, 1);
  assert.equal(checkpointOf(db, later).settled_event_seq, "5");
  assert.equal(checkpointOf(db, later).event_hash, later.events.at(-1).eventId);
  assert.equal(checkpointOf(db, later).story_generation, 2);
});

test("an older generation or different content at the same generation is never written over", async () => {
  const db = new FakeD1();
  const archive = archiveWith(3, 1);
  await publishArchiveCheckpoint(db, archive, { generation: 2, contentHash: sha(2) });
  const written = db.writes().length;

  await assert.rejects(publishArchiveCheckpoint(db, archive, { generation: 1, contentHash: sha(1) }),
    /Operational archive generation cannot be overwritten/);
  await assert.rejects(publishArchiveCheckpoint(db, archive, { generation: 2, contentHash: sha(3) }),
    /Operational archive generation cannot be overwritten/);
  assert.equal(db.writes().length, written);
  assert.equal(checkpointOf(db, archive).story_content_hash, sha(2));
});

test("a room with no events records the genesis as its head", async () => {
  const db = new FakeD1();
  const archive = archiveWith(0, 0);
  await publishArchiveCheckpoint(db, archive, { generation: 1, contentHash: sha(1) });
  assert.equal(checkpointOf(db, archive).settled_event_seq, "0");
  assert.equal(checkpointOf(db, archive).event_hash, "genesis");
});
