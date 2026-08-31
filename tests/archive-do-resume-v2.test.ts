import { env } from "cloudflare:workers";
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

type RecordValue = Record<string, unknown>;

type FakeArchiveSnapshot = {
  genesis: unknown[][];
  events: unknown[][];
  audits: unknown[][];
  checkpoints?: unknown[][];
  batchSizes: number[];
};

type FakeArchiveHarness = {
  db: D1Database;
  clearEvents(): void;
  snapshot(): FakeArchiveSnapshot;
};

type ArchiveProgressView = {
  progress: {
    genesisArchived: boolean;
    lastEventSeq: string;
    auditCursor: { eventSeq: string; viewerHash: string } | null;
  };
  pending: boolean;
  generation: number;
  nextAttemptAt: number | null;
  pendingSinceAt: number | null;
};

type HarnessAuthority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  applyRoomAdministration(capability: unknown, command: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
  restoreAuthoritativeArchiveFromD1(capability: unknown, locator: unknown): Promise<unknown>;
};

const ARCHIVE_FIXTURE_SCENES = [
  "wills",
  "yard",
  "private-lian",
  "cellar",
  "reveal",
  "confrontation",
] as const;

function archiveFixtureScene(index: number): string {
  return ARCHIVE_FIXTURE_SCENES[index % ARCHIVE_FIXTURE_SCENES.length];
}

function record(value: unknown, label: string): RecordValue {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as RecordValue;
}

function createFakeArchiveHarness(
  initial?: FakeArchiveSnapshot,
  failNextBatch = false,
): FakeArchiveHarness {
  const genesis = new Map<string, unknown[]>();
  const events = new Map<string, unknown[]>();
  const audits = new Map<string, unknown[]>();
  const checkpoints = new Map<string, unknown[]>();
  const batchSizes = [...(initial?.batchSizes ?? [])];
  for (const bindings of initial?.genesis ?? []) {
    genesis.set(`${String(bindings[0])}\u0000${String(bindings[1])}`, structuredClone(bindings));
  }
  for (const bindings of initial?.events ?? []) {
    events.set(
      `${String(bindings[0])}\u0000${String(bindings[1])}\u0000${String(bindings[2])}`,
      structuredClone(bindings),
    );
  }
  for (const bindings of initial?.audits ?? []) {
    audits.set(
      `${String(bindings[0])}\u0000${String(bindings[1])}\u0000${String(bindings[2])}`
        + `\u0000${String(bindings[3])}`,
      structuredClone(bindings),
    );
  }
  for (const bindings of initial?.checkpoints ?? []) {
    checkpoints.set(
      `${String(bindings[0])}\u0000${String(bindings[1])}`,
      structuredClone(bindings),
    );
  }
  let shouldFail = failNextBatch;
  const db = {
    prepare(sql: string) {
      const statement = {
        sql,
        bindings: [] as unknown[],
        bind(...bindings: unknown[]) {
          statement.bindings = bindings;
          return statement;
        },
        async first<T>() {
          if (statement.sql.includes("authoritative_archive_head_genesis")) {
            const row = genesis.get(
              `${String(statement.bindings[0])}\u0000${String(statement.bindings[1])}`,
            );
            return (row === undefined ? null : {
              genesis_hash: row[2],
              genesis_json: row[13],
            }) as T;
          }
          if (statement.sql.includes("authoritative_room_archive_checkpoint")
            && !statement.sql.includes("authoritative_archive_cursor_probe")) {
            const checkpoint = checkpoints.get(
              `${String(statement.bindings[0])}\u0000${String(statement.bindings[1])}`,
            );
            return (checkpoint === undefined ? null : {
              room_id: checkpoint[0],
              runtime_epoch_id: checkpoint[1],
              genesis_hash: checkpoint[2],
              settled_event_seq: checkpoint[3],
              event_hash: checkpoint[4],
              state_hash: checkpoint[5],
              active_branch_id: checkpoint[6],
            }) as T;
          }
          if (statement.sql.includes("SELECT genesis_json")) {
            const genesisRow = genesis.get(
              `${String(statement.bindings[0])}\u0000${String(statement.bindings[1])}`,
            );
            return (genesisRow === undefined ? null : { genesis_json: genesisRow[13] }) as T;
          }
          if (!statement.sql.includes("authoritative_archive_cursor_probe")) {
            throw new Error(`unexpected archive query: ${statement.sql}`);
          }
          const roomId = String(statement.bindings[0]);
          const runtimeEpochId = String(statement.bindings[1]);
          const cursor = BigInt(String(statement.bindings[2]));
          const roomEpoch = `${roomId}\u0000${runtimeEpochId}`;
          const prefix = [...events.values()]
            .filter((bindings) =>
              String(bindings[0]) === roomId
              && String(bindings[1]) === runtimeEpochId
              && BigInt(String(bindings[2])) <= cursor)
            .sort((left, right) => Number(left[2]) - Number(right[2]));
          const cursorEvent = prefix.find((bindings) => BigInt(String(bindings[2])) === cursor);
          const checkpoint = checkpoints.get(roomEpoch);
          const checkpointEvent = checkpoint === undefined
            ? undefined
            : events.get(`${roomEpoch}\u0000${String(checkpoint[3])}`);
          return {
            genesis_hash: genesis.get(roomEpoch)?.[2] ?? null,
            archived_event_count: String(prefix.length),
            first_event_seq: prefix.length === 0 ? null : String(prefix[0][2]),
            last_event_seq: prefix.length === 0 ? null : String(prefix.at(-1)![2]),
            cursor_event_hash: cursorEvent?.[18] ?? null,
            checkpoint_genesis_hash: checkpoint?.[2] ?? null,
            checkpoint_settled_event_seq: checkpoint?.[3] ?? null,
            checkpoint_event_hash: checkpoint?.[4] ?? null,
            checkpoint_state_hash: checkpoint?.[5] ?? null,
            checkpoint_active_branch_id: checkpoint?.[6] ?? null,
            checkpoint_materialized_event_hash: checkpointEvent?.[18] ?? null,
            checkpoint_materialized_state_hash: checkpointEvent?.[17] ?? null,
            checkpoint_materialized_branch_id: checkpointEvent?.[5] ?? null,
          } as T;
        },
        async all<T>() {
          const roomId = String(statement.bindings[0]);
          const runtimeEpochId = String(statement.bindings[1]);
          const roomEpoch = `${roomId}\u0000${runtimeEpochId}`;
          if (statement.sql.includes("authoritative_archive_head_events")) {
            const settled = BigInt(String(statement.bindings[2]));
            const results = [...events.values()]
              .filter((bindings) => String(bindings[0]) === roomId
                && String(bindings[1]) === runtimeEpochId
                && BigInt(String(bindings[2])) <= settled)
              .sort((left, right) => Number(left[2]) - Number(right[2]))
              .map((bindings) => ({
                event_seq: bindings[2],
                event_hash: bindings[18],
                state_hash_after: bindings[17],
                branch_id: bindings[5],
                event_json: bindings[19],
              }));
            return { results } as T;
          }
          if (statement.sql.includes("SELECT event_json")) {
            const settled = BigInt(String(statement.bindings[2]));
            const results = [...events.values()]
              .filter((bindings) => String(bindings[0]) === roomId
                && String(bindings[1]) === runtimeEpochId
                && BigInt(String(bindings[2])) <= settled)
              .sort((left, right) => Number(left[2]) - Number(right[2]))
              .map((bindings) => ({ event_json: bindings[19] }));
            return { results } as T;
          }
          if (statement.sql.includes("SELECT event_seq, viewer_hash, projection_hash")) {
            const settled = String(statement.bindings[2]);
            const results = [...audits.values()]
              .filter((bindings) => String(bindings[0]) === roomId
                && String(bindings[1]) === runtimeEpochId
                && String(bindings[2]) === settled)
              .sort((left, right) => String(left[3]).localeCompare(String(right[3])))
              .map((bindings) => ({
                event_seq: bindings[2],
                viewer_hash: bindings[3],
                projection_hash: bindings[4],
              }));
            return { results } as T;
          }
          throw new Error(`unexpected archive rows query for ${roomEpoch}`);
        },
      };
      return statement;
    },
    async batch(statements: Array<{ sql: string; bindings: unknown[] }>) {
      batchSizes.push(statements.length);
      if (shouldFail) {
        shouldFail = false;
        throw new Error("synthetic D1 archive outage");
      }
      for (const statement of statements) {
        const bindings = structuredClone(statement.bindings);
        const roomEpoch = `${String(bindings[0])}\u0000${String(bindings[1])}`;
        if (statement.sql.includes("authoritative_room_genesis_archive")) {
          if (!genesis.has(roomEpoch)) genesis.set(roomEpoch, bindings);
        } else if (statement.sql.includes("authoritative_room_event_archive")) {
          const key = `${roomEpoch}\u0000${String(bindings[2])}`;
          if (!events.has(key)) events.set(key, bindings);
        } else if (statement.sql.includes("authoritative_projection_audit_archive")) {
          const key = `${roomEpoch}\u0000${String(bindings[2])}\u0000${String(bindings[3])}`;
          if (!audits.has(key)) audits.set(key, bindings);
        } else if (statement.sql.includes("authoritative_room_archive_checkpoint")) {
          checkpoints.set(roomEpoch, bindings);
        } else {
          throw new Error(`unexpected archive SQL: ${statement.sql}`);
        }
      }
      return statements.map(() => ({ success: true }));
    },
  } as unknown as D1Database;
  return {
    db,
    clearEvents() {
      events.clear();
      checkpoints.clear();
    },
    snapshot() {
      return {
        genesis: [...genesis.values()].map((entry) => structuredClone(entry)),
        events: [...events.values()].map((entry) => structuredClone(entry)),
        audits: [...audits.values()].map((entry) => structuredClone(entry)),
        checkpoints: [...checkpoints.values()].map((entry) => structuredClone(entry)),
        batchSizes: [...batchSizes],
      };
    },
  };
}

async function installFakeArchiveDb(
  stub: DurableObjectStub,
  initial?: FakeArchiveSnapshot,
  failNextBatch = false,
) {
  return runInDurableObject(stub as never, async (instance, state) => {
    const target = instance as unknown as {
      authorityArchiveDatabaseOverride?: D1Database;
      authorityArchiveTestHarness?: FakeArchiveHarness;
      authorityStore: {
        archiveProgress(): ArchiveProgressView | undefined;
        deferArchive(nextAttemptAt: number, nowMs: number): void;
      };
    };
    const harness = createFakeArchiveHarness(initial, failNextBatch);
    target.authorityArchiveDatabaseOverride = harness.db;
    target.authorityArchiveTestHarness = harness;
    const now = Date.now();
    target.authorityStore.deferArchive(now - 1, now - 1);
    await state.storage.setAlarm(now + 10_000);
    return target.authorityStore.archiveProgress();
  });
}

async function archiveHarnessState(stub: DurableObjectStub) {
  return runInDurableObject(stub as never, async (instance, state) => {
    const target = instance as unknown as {
      authorityArchiveTestHarness?: FakeArchiveHarness;
      authorityStore: { archiveProgress(): ArchiveProgressView | undefined };
    };
    return {
      progress: target.authorityStore.archiveProgress(),
      snapshot: target.authorityArchiveTestHarness?.snapshot(),
      alarm: await state.storage.getAlarm(),
    };
  });
}

async function forceArchiveAlarmDue(stub: DurableObjectStub) {
  await runInDurableObject(stub as never, async (instance, state) => {
    const target = instance as unknown as {
      authorityStore: { deferArchive(nextAttemptAt: number, nowMs: number): void };
    };
    const now = Date.now();
    target.authorityStore.deferArchive(now - 1, now - 1);
    await state.storage.setAlarm(now + 10_000);
  });
  // Miniflare may consume an alarm scheduled at the current logical instant
  // before this helper polls it. Either path invokes the production alarm().
  await runDurableObjectAlarm(stub);
}

async function pauseArchiveAlarm(stub: DurableObjectStub) {
  await runInDurableObject(stub as never, async (instance, state) => {
    const target = instance as unknown as {
      authorityStore: { deferArchive(nextAttemptAt: number, nowMs: number): void };
    };
    const now = Date.now();
    const pausedUntil = now + 60_000;
    target.authorityStore.deferArchive(pausedUntil, now);
    await state.storage.setAlarm(pausedUntil);
  });
}

async function ageArchivePending(stub: DurableObjectStub, ageMs: number) {
  return runInDurableObject(stub as never, async (instance, state) => {
    const target = instance as unknown as {
      authorityStore: { archiveProgress(): ArchiveProgressView | undefined };
    };
    const now = Date.now();
    state.storage.sql.exec(
      `UPDATE authority_archive_progress
       SET pending = 1, pending_since_at = ?, next_attempt_at = ?, updated_at = ?
       WHERE singleton = 1`,
      now - ageMs,
      now - 1,
      now - 1,
    );
    await state.storage.setAlarm(now + 10_000);
    return target.authorityStore.archiveProgress();
  });
}

function capturedTelemetry(calls: unknown[][]) {
  return calls.flatMap((args) => args.flatMap((arg) => {
    if (typeof arg === "string") {
      try {
        return [JSON.parse(arg) as RecordValue];
      } catch {
        return [];
      }
    }
    return arg !== null && typeof arg === "object" && !Array.isArray(arg)
      ? [arg as RecordValue]
      : [];
  }));
}

describe("Room DO incremental D1 archive continuation", () => {
  it("emits content-free archive failure, catch-up, caught-up, and lag-bucket telemetry", async () => {
    const roomId = "archive-do-telemetry-v2";
    const removablePrincipalId = "principal:archive-telemetry:removable";
    const stub = env.ROOMS.getByName(roomId) as unknown as HarnessAuthority & DurableObjectStub;
    const initialized = record(await stub.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      members: [
        { principalId: "principal:archive-telemetry:host", role: "host" },
        { principalId: removablePrincipalId, role: "player" },
      ],
      characters: [
        {
          characterId: "character:archive-telemetry:host",
          controllerPrincipalId: "principal:archive-telemetry:host",
          staticCard: { name: "归档遥测角色", sceneId: archiveFixtureScene(0) },
        },
        ...Array.from({ length: 42 }, (_, index) => ({
          characterId: `character:archive-telemetry:bulk:${index}`,
          controllerPrincipalId: removablePrincipalId,
          staticCard: {
            name: `ARCHIVE_PRIVATE_SENTINEL_${index}`,
            sceneId: archiveFixtureScene(index + 1),
          },
        })),
      ],
    }), "archive telemetry room initialization");
    expect(initialized).toMatchObject({ created: true });
    const capabilities = record(initialized.serviceCapabilities, "service capabilities");
    await expect(stub.applyRoomAdministration(capabilities.roomAdministration, {
      kind: "removeMember",
      commandId: "archive-admin:telemetry-bulk-remove",
      principalId: removablePrincipalId,
      reason: "ARCHIVE_REASON_SECRET_SENTINEL",
    })).resolves.toMatchObject({ kind: "committed" });

    await installFakeArchiveDb(stub, undefined, true);
    const aged = await ageArchivePending(stub, 650_000);
    expect(aged?.pendingSinceAt).not.toBeNull();

    const captured: unknown[][] = [];
    const info = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      captured.push(args);
    });
    const error = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      captured.push(args);
    });
    try {
      await runDurableObjectAlarm(stub as never);
      await forceArchiveAlarmDue(stub);
      for (let guard = 0; guard < 10; guard += 1) {
        const current = await archiveHarnessState(stub);
        if (!current.progress?.pending) break;
        await forceArchiveAlarmDue(stub);
      }
      const completed = await archiveHarnessState(stub);
      expect(completed.progress).toMatchObject({ pending: false, pendingSinceAt: null });

      await runInDurableObject(stub as never, async (instance, state) => {
        const target = instance as unknown as {
          authorityStore: {
            markArchivePending(nowMs: number): ArchiveProgressView | undefined;
          };
        };
        const now = Date.now();
        target.authorityStore.markArchivePending(now);
        await state.storage.setAlarm(now + 10_000);
      });
      await forceArchiveAlarmDue(stub);
    } finally {
      info.mockRestore();
      error.mockRestore();
    }

    const telemetry = capturedTelemetry(captured)
      .filter((event) => typeof event.eventName === "string"
        && String(event.eventName).startsWith("room.archive."));
    const failed = telemetry.find((event) => event.eventName === "room.archive.failed");
    expect(failed).toMatchObject({
      schemaVersion: "zhuwei.room-telemetry/v1",
      severity: "error",
      outcomeKind: "retryableFailure",
      failureClass: "archiveFailure",
      archiveStatus: "failed",
      replayIntegrity: "notEvaluated",
      archiveLagBucket: "alert",
    });
    const completedPages = telemetry.filter(
      (event) => event.eventName === "room.archive.page.completed",
    );
    expect(completedPages.some((event) => event.archiveStatus === "catchingUp"
      && event.outcomeKind === "catchingUp"
      && event.archiveLagBucket === "alert")).toBe(true);
    expect(completedPages.some((event) => event.archiveStatus === "caughtUp"
      && event.outcomeKind === "caughtUp"
      && event.archiveLagBucket === "alert")).toBe(true);
    expect(completedPages.some((event) => event.archiveStatus === "caughtUp"
      && event.archiveLagBucket === "withinTarget")).toBe(true);
    expect(JSON.stringify(telemetry)).not.toMatch(
      /archive-do-telemetry-v2|ARCHIVE_PRIVATE_SENTINEL|ARCHIVE_REASON_SECRET_SENTINEL|publishCapability|event_json/,
    );
  }, 60_000);

  it("rebuilds every DO event after D1 is cleared behind a caught-up cursor", async () => {
    const roomId = "archive-do-cleared-d1-rebuild-v2";
    const firstRemovedPrincipalId = "principal:archive-rebuild:first-removed";
    const removedPrincipalId = "principal:archive-rebuild:removed";
    const stub = env.ROOMS.getByName(roomId) as unknown as HarnessAuthority & DurableObjectStub;
    const initialized = record(await stub.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      members: [
        { principalId: "principal:archive-rebuild:host", role: "host" },
        { principalId: firstRemovedPrincipalId, role: "player" },
        { principalId: removedPrincipalId, role: "player" },
      ],
      characters: [{
        characterId: "character:archive-rebuild:host",
        controllerPrincipalId: "principal:archive-rebuild:host",
        staticCard: { name: "归档重建角色", sceneId: "yard" },
      }],
    }), "archive rebuild room initialization");
    const capabilities = record(initialized.serviceCapabilities, "service capabilities");
    await expect(stub.applyRoomAdministration(capabilities.roomAdministration, {
      kind: "removeMember",
      commandId: "archive-admin:before-d1-clear",
      principalId: firstRemovedPrincipalId,
      reason: "archiveRebuildFixture",
    })).resolves.toMatchObject({ kind: "committed" });

    await installFakeArchiveDb(stub);
    for (let guard = 0; guard < 10; guard += 1) {
      const current = await archiveHarnessState(stub);
      if (!current.progress?.pending) break;
      await forceArchiveAlarmDue(stub);
    }
    const caughtUp = await archiveHarnessState(stub);
    expect(caughtUp.progress).toMatchObject({ pending: false });
    expect(caughtUp.progress?.progress.lastEventSeq).not.toBe("0");
    expect(caughtUp.snapshot?.events).toHaveLength(
      Number(caughtUp.progress?.progress.lastEventSeq),
    );

    await runInDurableObject(stub as never, async (instance) => {
      const target = instance as unknown as {
        authorityArchiveTestHarness?: FakeArchiveHarness;
      };
      target.authorityArchiveTestHarness?.clearEvents();
    });
    const cleared = await archiveHarnessState(stub);
    expect(cleared.snapshot?.events).toHaveLength(0);
    expect(cleared.progress?.pending).toBe(false);
    expect(cleared.progress?.progress).toEqual(caughtUp.progress?.progress);

    await expect(stub.applyRoomAdministration(capabilities.roomAdministration, {
      kind: "removeMember",
      commandId: "archive-admin:rebuild-after-clear",
      principalId: removedPrincipalId,
      reason: "archiveRebuildFixture",
    })).resolves.toMatchObject({ kind: "committed" });
    const exported = record(
      await stub.exportAuthoritativeArchive(capabilities.archiveExport),
      "post-clear authoritative archive export",
    );
    const expectedEvents = (record(exported.archive, "post-clear archive").events as unknown[])
      .map((event) => structuredClone(event));

    for (let guard = 0; guard < 10; guard += 1) {
      const current = await archiveHarnessState(stub);
      if (!current.progress?.pending) break;
      await forceArchiveAlarmDue(stub);
    }
    const rebuilt = await archiveHarnessState(stub);
    expect(rebuilt.progress?.pending).toBe(false);
    expect(rebuilt.snapshot?.batchSizes.every((size) => size <= 40)).toBe(true);
    const rebuiltEvents = [...(rebuilt.snapshot?.events ?? [])]
      .sort((left, right) => Number(left[2]) - Number(right[2]))
      .map((bindings) => JSON.parse(String(bindings[19])));
    expect(rebuiltEvents).toEqual(expectedEvents);
    expect(rebuiltEvents.map((event) => record(event, "rebuilt event").eventSeq))
      .toEqual(expectedEvents.map((event) => record(event, "DO event").eventSeq));
  });

  it("keeps a newer archive generation pending when an older single flight completes", async () => {
    const roomId = "archive-do-generation-v2";
    const stub = env.ROOMS.getByName(roomId) as unknown as HarnessAuthority & DurableObjectStub;
    await stub.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      members: [{ principalId: "principal:archive-generation", role: "host" }],
      characters: [{
        characterId: "character:archive-generation",
        controllerPrincipalId: "principal:archive-generation",
        staticCard: { name: "代际测试角色", sceneId: "yard" },
      }],
    });

    const result = await runInDurableObject(stub as never, async (instance) => {
      const target = instance as unknown as {
        authorityStore: {
          archiveProgress(): ArchiveProgressView;
          markArchivePending(nowMs: number): ArchiveProgressView;
          saveArchivePage(input: {
            progress: ArchiveProgressView["progress"] & {
              format: "zhuwei.authoritative-archive-progress/v1";
              roomId: string;
              runtimeEpochId: string;
            };
            observedGeneration: number;
            caughtUp: boolean;
            nowMs: number;
            nextPageAt: number;
          }): ArchiveProgressView;
        };
      };
      const now = Date.now();
      const older = target.authorityStore.markArchivePending(now);
      const newer = target.authorityStore.markArchivePending(now + 1);
      const staleCompletion = target.authorityStore.saveArchivePage({
        progress: older.progress as never,
        observedGeneration: older.generation,
        caughtUp: true,
        nowMs: now + 2,
        nextPageAt: now + 3,
      });
      const currentCompletion = target.authorityStore.saveArchivePage({
        progress: newer.progress as never,
        observedGeneration: newer.generation,
        caughtUp: true,
        nowMs: now + 4,
        nextPageAt: now + 5,
      });
      return { older, newer, staleCompletion, currentCompletion };
    });

    expect(result.newer.generation).toBeGreaterThan(result.older.generation);
    expect(result.staleCompletion).toMatchObject({
      pending: true,
      generation: result.newer.generation,
    });
    expect(result.currentCompletion).toMatchObject({
      pending: false,
      generation: result.newer.generation,
    });

    await runInDurableObject(stub as never, async (_instance, state) => {
      state.storage.sql.exec("DELETE FROM authority_archive_progress");
      await state.storage.deleteAlarm();
    });
    await evictDurableObject(stub as never);
    const backfilled = await runInDurableObject(stub as never, async (instance) => {
      const target = instance as unknown as {
        authorityStore: { archiveProgress(): ArchiveProgressView | undefined };
      };
      return target.authorityStore.archiveProgress();
    });
    expect(backfilled).toMatchObject({
      pending: true,
      progress: { genesisArchived: false, lastEventSeq: "0", auditCursor: null },
    });
  });

  it("checkpoints and restores a legal room with no currently controlled viewer", async () => {
    const roomId = "archive-do-zero-viewer-v2";
    const principalId = "principal:archive-zero-viewer";
    const characterId = "character:archive-zero-viewer";
    const seatId = `seat:${principalId}`;
    const stub = env.ROOMS.getByName(roomId) as unknown as HarnessAuthority & DurableObjectStub;
    const initialized = record(await stub.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      members: [{ principalId, role: "host" }],
      characters: [{
        characterId,
        controllerPrincipalId: principalId,
        staticCard: { name: "暂离席角色", sceneId: "yard" },
      }],
    }), "zero-viewer archive initialization");
    const capabilities = record(initialized.serviceCapabilities, "zero-viewer capabilities");
    await expect(stub.applyRoomAdministration(capabilities.roomAdministration, {
      kind: "revokeControl",
      commandId: "archive-admin:zero-viewer-revoke",
      characterId,
      seatId,
      reason: "successorRequiredGap",
    })).resolves.toMatchObject({ kind: "committed" });
    const exported = record(
      await stub.exportAuthoritativeArchive(capabilities.archiveExport),
      "zero-viewer archive export",
    );
    const archive = record(exported.archive, "zero-viewer archive");
    expect(archive.projectionAudits).toEqual([]);

    await installFakeArchiveDb(stub);
    for (let guard = 0; guard < 10; guard += 1) {
      const current = await archiveHarnessState(stub);
      if (!current.progress?.pending) break;
      await forceArchiveAlarmDue(stub);
    }
    const completed = await archiveHarnessState(stub);
    expect(completed.progress?.pending).toBe(false);
    expect(completed.snapshot?.audits).toEqual([]);
    expect(completed.snapshot?.checkpoints).toHaveLength(1);

    const restoredStub = env.ROOMS.getByName(`${roomId}:restored`) as unknown as (
      HarnessAuthority & DurableObjectStub
    );
    await installFakeArchiveDb(restoredStub, completed.snapshot);
    await expect(restoredStub.restoreAuthoritativeArchiveFromD1(
      capabilities.disasterRecovery,
      {
        roomId,
        runtimeEpochId: String(record(archive.signedGenesis, "zero-viewer genesis").runtimeEpochId),
      },
    )).resolves.toMatchObject({ kind: "restored", projectionIntegrity: "verified" });
  }, 30_000);

  it("resumes 80+ events through bounded alarms, retries failure, survives eviction, and preserves TTL", async () => {
    const roomId = "archive-do-resume-v2";
    const stub = env.ROOMS.getByName(roomId) as unknown as HarnessAuthority & DurableObjectStub;
    const stablePrincipals = Array.from({ length: 48 }, (_, index) => ({
      principalId: `principal:archive-resume:${index}`,
      role: index === 0 ? "host" : "player",
    }));
    const removablePrincipals = Array.from({ length: 43 }, (_, index) => ({
      principalId: `principal:archive-resume:bulk:${index}`,
      role: "player",
    }));
    const stableCharacters = stablePrincipals.map((principal, index) => ({
      characterId: `character:archive-resume:${index}`,
      controllerPrincipalId: principal.principalId,
      staticCard: { name: `归档角色${index}`, sceneId: archiveFixtureScene(index) },
    }));
    const initialized = record(await stub.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      members: [...stablePrincipals, ...removablePrincipals],
      characters: stableCharacters,
    }), "archive room initialization");
    expect(initialized).toMatchObject({ created: true });
    const capabilities = record(initialized.serviceCapabilities, "service capabilities");

    for (const [index, principal] of removablePrincipals.entries()) {
      const removed = record(await stub.applyRoomAdministration(capabilities.roomAdministration, {
        kind: "removeMember",
        commandId: `archive-admin:bulk-remove:${index}`,
        principalId: principal.principalId,
        reason: "archiveFixture",
      }), `bulk archive administration ${index}`);
      expect(removed.kind).toBe("committed");
    }
    const exported = record(
      await stub.exportAuthoritativeArchive(capabilities.archiveExport),
      "archive export",
    );
    const archive = record(exported.archive, "archive");
    const eventCount = (archive.events as unknown[]).length;
    expect(eventCount).toBeGreaterThanOrEqual(85);

    const initialProgress = await installFakeArchiveDb(stub, undefined, true);
    expect(initialProgress?.progress).toMatchObject({
      genesisArchived: false,
      lastEventSeq: "0",
      auditCursor: null,
    });
    await forceArchiveAlarmDue(stub);
    await pauseArchiveAlarm(stub);
    const afterFailure = await archiveHarnessState(stub);
    expect(afterFailure.snapshot?.batchSizes[0]).toBe(39);
    let firstPage = afterFailure;
    if (afterFailure.progress?.progress.lastEventSeq === "0") {
      expect(afterFailure.progress?.progress).toEqual(initialProgress?.progress);
      expect(afterFailure.snapshot?.events).toHaveLength(0);
      await forceArchiveAlarmDue(stub);
      await pauseArchiveAlarm(stub);
      firstPage = await archiveHarnessState(stub);
    }
    expect(firstPage.progress?.progress).toMatchObject({
      genesisArchived: true,
      lastEventSeq: "38",
    });
    expect(firstPage.snapshot?.events).toHaveLength(38);
    expect(firstPage.snapshot?.batchSizes.filter((size) => size === 39).length)
      .toBeGreaterThanOrEqual(2);

    const preEvictionProgress = structuredClone(firstPage.progress?.progress);
    const preEvictionSnapshot = structuredClone(firstPage.snapshot);
    await evictDurableObject(stub as never);
    const restoredProgress = await installFakeArchiveDb(stub, preEvictionSnapshot);
    expect(restoredProgress?.progress).toEqual(preEvictionProgress);

    for (let guard = 0; guard < 10; guard += 1) {
      const current = await archiveHarnessState(stub);
      if (!current.progress?.pending) break;
      await forceArchiveAlarmDue(stub);
    }
    const completed = await archiveHarnessState(stub);
    expect(completed.progress?.pending).toBe(false);
    expect(completed.progress?.progress.lastEventSeq).toBe(String(eventCount));
    expect(completed.snapshot?.genesis).toHaveLength(1);
    expect(completed.snapshot?.events).toHaveLength(eventCount);
    expect(completed.snapshot?.audits).toHaveLength(48);
    expect(completed.snapshot?.batchSizes.every((size) => size <= 40)).toBe(true);
    expect(completed.alarm).toBeNull();

    const persisted = JSON.stringify(completed.snapshot);
    expect(persisted).not.toMatch(/delivery:opening|publishCapability|narrationPolicyVersion/);

    const restoredRoomId = "archive-do-d1-restore-v2";
    const restoredStub = env.ROOMS.getByName(restoredRoomId) as unknown as HarnessAuthority & DurableObjectStub;
    await installFakeArchiveDb(restoredStub, completed.snapshot);
    const restoredFromD1 = await restoredStub.restoreAuthoritativeArchiveFromD1(
      capabilities.disasterRecovery,
      {
        roomId,
        runtimeEpochId: String(record(archive.signedGenesis, "archive genesis").runtimeEpochId),
      },
    );
    expect(restoredFromD1, JSON.stringify(restoredFromD1)).toMatchObject({
      kind: "restored",
      projectionIntegrity: "verified",
    });
    const restoredAuthorityIndex = await runInDurableObject(
      restoredStub as never,
      async (_instance, state) => ({
        members: state.storage.sql.exec<{
          principal_id: string;
          role: string;
          session_version: number;
          seat_id: string;
        }>(`SELECT principal_id, role, session_version, seat_id
            FROM authority_members ORDER BY principal_id`).toArray(),
        characters: state.storage.sql.exec<{ character_id: string }>(
          `SELECT character_id FROM authority_characters ORDER BY character_id`,
        ).toArray(),
      }),
    );
    expect(restoredAuthorityIndex.members).toHaveLength(stablePrincipals.length);
    expect(restoredAuthorityIndex.characters).toHaveLength(stableCharacters.length);
    expect(restoredAuthorityIndex.members).not.toContainEqual(expect.objectContaining({
      principal_id: removablePrincipals[0].principalId,
    }));
    expect(restoredAuthorityIndex.members.find((member) => member.principal_id
      === stablePrincipals[0].principalId)).toMatchObject({
      role: "host",
      session_version: 1,
      seat_id: `seat:${stablePrincipals[0].principalId}`,
    });
  }, 180_000);
});
