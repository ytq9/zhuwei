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
};

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
          return {
            genesis_hash: genesis.get(roomEpoch)?.[2] ?? null,
            archived_event_count: String(prefix.length),
            first_event_seq: prefix.length === 0 ? null : String(prefix[0][2]),
            last_event_seq: prefix.length === 0 ? null : String(prefix.at(-1)![2]),
            cursor_event_hash: cursorEvent?.[18] ?? null,
          } as T;
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
    },
    snapshot() {
      return {
        genesis: [...genesis.values()].map((entry) => structuredClone(entry)),
        events: [...events.values()].map((entry) => structuredClone(entry)),
        audits: [...audits.values()].map((entry) => structuredClone(entry)),
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
      moduleVersion: "legacy-anchor-v1",
      members: [
        { principalId: "principal:archive-telemetry:host", role: "host" },
        { principalId: removablePrincipalId, role: "player" },
      ],
      characters: [
        {
          characterId: "character:archive-telemetry:host",
          controllerPrincipalId: "principal:archive-telemetry:host",
          staticCard: { name: "归档遥测角色", sceneId: "yard" },
        },
        ...Array.from({ length: 42 }, (_, index) => ({
          characterId: `character:archive-telemetry:bulk:${index}`,
          controllerPrincipalId: removablePrincipalId,
          staticCard: {
            name: `ARCHIVE_PRIVATE_SENTINEL_${index}`,
            sceneId: "yard",
          },
        })),
      ],
    }), "archive telemetry room initialization");
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

  it("preserves the pending-age clock while upgrading a pre-telemetry DO cursor table", async () => {
    const roomId = "archive-do-progress-upgrade-v2";
    const stub = env.ROOMS.getByName(roomId) as unknown as HarnessAuthority & DurableObjectStub;
    await stub.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "legacy-anchor-v1",
      members: [{ principalId: "principal:archive-progress-upgrade", role: "host" }],
      characters: [{
        characterId: "character:archive-progress-upgrade",
        controllerPrincipalId: "principal:archive-progress-upgrade",
        staticCard: { name: "旧游标迁移角色", sceneId: "yard" },
      }],
    });

    const oldUpdatedAt = Date.now() - 321_000;
    await runInDurableObject(stub as never, async (instance, state) => {
      const target = instance as unknown as {
        authorityStore: { deferArchive(nextAttemptAt: number, nowMs: number): void };
      };
      target.authorityStore.deferArchive(oldUpdatedAt, oldUpdatedAt);
      state.storage.sql.exec(`
        CREATE TABLE authority_archive_progress_legacy (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          room_id TEXT NOT NULL,
          runtime_epoch_id TEXT NOT NULL,
          progress_json TEXT NOT NULL,
          pending INTEGER NOT NULL CHECK (pending IN (0, 1)),
          generation INTEGER NOT NULL,
          next_attempt_at INTEGER,
          updated_at INTEGER NOT NULL,
          UNIQUE(room_id, runtime_epoch_id)
        );
        INSERT INTO authority_archive_progress_legacy (
          singleton, room_id, runtime_epoch_id, progress_json,
          pending, generation, next_attempt_at, updated_at
        )
        SELECT singleton, room_id, runtime_epoch_id, progress_json,
               pending, generation, next_attempt_at, updated_at
        FROM authority_archive_progress;
        DROP TABLE authority_archive_progress;
        ALTER TABLE authority_archive_progress_legacy
          RENAME TO authority_archive_progress;
      `);
      await state.storage.setAlarm(Date.now() + 60_000);
    });

    await evictDurableObject(stub as never);
    const upgraded = await runInDurableObject(stub as never, async (instance, state) => {
      const target = instance as unknown as {
        authorityStore: { archiveProgress(): ArchiveProgressView | undefined };
      };
      const columns = state.storage.sql.exec<{ name: string }>(
        "PRAGMA table_info(authority_archive_progress)",
      ).toArray().map((column) => column.name);
      return { columns, progress: target.authorityStore.archiveProgress() };
    });
    expect(upgraded.columns).toContain("pending_since_at");
    expect(upgraded.progress).toMatchObject({
      pending: true,
      pendingSinceAt: oldUpdatedAt,
    });
  });

  it("rebuilds every DO event after D1 is cleared behind a caught-up cursor", async () => {
    const roomId = "archive-do-cleared-d1-rebuild-v2";
    const firstRemovedPrincipalId = "principal:archive-rebuild:first-removed";
    const removedPrincipalId = "principal:archive-rebuild:removed";
    const stub = env.ROOMS.getByName(roomId) as unknown as HarnessAuthority & DurableObjectStub;
    const initialized = record(await stub.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "legacy-anchor-v1",
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
      moduleVersion: "legacy-anchor-v1",
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

  it("resumes 80+ events through bounded alarms, retries failure, survives eviction, and preserves TTL", async () => {
    const roomId = "archive-do-resume-v2";
    const stub = env.ROOMS.getByName(roomId) as unknown as HarnessAuthority & DurableObjectStub;
    const stablePrincipals = Array.from({ length: 48 }, (_, index) => ({
      principalId: `principal:archive-resume:${index}`,
      role: index === 0 ? "host" : "player",
    }));
    const removablePrincipal = {
      principalId: "principal:archive-resume:bulk",
      role: "player",
    };
    const stableCharacters = stablePrincipals.map((principal, index) => ({
      characterId: `character:archive-resume:${index}`,
      controllerPrincipalId: principal.principalId,
      staticCard: { name: `归档角色${index}`, sceneId: "yard" },
    }));
    const removableCharacters = Array.from({ length: 83 }, (_, index) => ({
      characterId: `character:archive-bulk:${index}`,
      controllerPrincipalId: removablePrincipal.principalId,
      staticCard: { name: `待移除归档角色${index}`, sceneId: "yard" },
    }));
    const initialized = record(await stub.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "legacy-anchor-v1",
      members: [...stablePrincipals, removablePrincipal],
      characters: [...stableCharacters, ...removableCharacters],
    }), "archive room initialization");
    const capabilities = record(initialized.serviceCapabilities, "service capabilities");

    const removed = record(await stub.applyRoomAdministration(capabilities.roomAdministration, {
      kind: "removeMember",
      commandId: "archive-admin:bulk-remove",
      principalId: removablePrincipal.principalId,
      reason: "archiveFixture",
    }), "bulk archive administration");
    expect(removed.kind).toBe("committed");
    const exported = record(
      await stub.exportAuthoritativeArchive(capabilities.archiveExport),
      "archive export",
    );
    const archive = record(exported.archive, "archive");
    const eventCount = (archive.events as unknown[]).length;
    expect(eventCount).toBeGreaterThanOrEqual(85);

    const legacyExpiry = Date.now() + 60_000;
    await runInDurableObject(stub as never, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO ux_status (scope_id, phase, ticket_id, expires_at)
         VALUES ('test:legacy-expiry', 'idle', 'test:ticket', ?)`,
        legacyExpiry,
      );
    });

    const initialProgress = await installFakeArchiveDb(stub, undefined, true);
    expect(initialProgress?.progress).toMatchObject({
      genesisArchived: false,
      lastEventSeq: "0",
      auditCursor: null,
    });
    await forceArchiveAlarmDue(stub);
    const afterFailure = await archiveHarnessState(stub);
    expect(afterFailure.progress?.progress).toEqual(initialProgress?.progress);
    expect(afterFailure.snapshot?.batchSizes).toEqual([40]);
    expect(afterFailure.snapshot?.events).toHaveLength(0);

    await forceArchiveAlarmDue(stub);
    await pauseArchiveAlarm(stub);
    const firstPage = await archiveHarnessState(stub);
    expect(firstPage.progress?.progress).toMatchObject({
      genesisArchived: true,
      lastEventSeq: "39",
    });
    expect(firstPage.snapshot?.events).toHaveLength(39);
    expect(firstPage.snapshot?.batchSizes).toEqual([40, 40]);

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
    expect(completed.alarm).toBe(legacyExpiry);

    const persisted = JSON.stringify(completed.snapshot);
    expect(persisted).not.toMatch(/delivery:opening|publishCapability|narrationPolicyVersion/);
  }, 60_000);
});
