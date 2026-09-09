import { env } from "cloudflare:workers";
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createVersionedRulesRuntime, project, replay, step, type VersionedRulesRuntime } from "../app/_runtime/lib/rules/v2-runtime";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical";
import { AuthoritativeRoomStore } from "../app/_runtime/lib/room/authority-store";

import {
  compileKpFormDraft,
  lowerCausalActionProgram,
} from "../app/_runtime/lib/kp/causal-action-program";

type DirectoryRow = {
  id: string;
  host_user_id: string;
  status: string;
};

type MutableDirectory = {
  row: DirectoryRow | null;
  failReads: boolean;
  db: D1Database;
};

type DeletionAuthority = DurableObjectStub & {
  initializeAuthoritative(input: unknown): Promise<Record<string, unknown>>;
  prepare(context: unknown, action: unknown): Promise<Record<string, unknown>>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<Record<string, unknown>>;
  applyRoomAdministration(capability: unknown, command: unknown): Promise<Record<string, unknown>>;
  exportAuthoritativeArchive(capability: unknown): Promise<Record<string, unknown>>;
  prepareDeletion(capability: unknown, context: unknown): Promise<Record<string, unknown>>;
  cancelDeletion(capability: unknown, context: unknown): Promise<Record<string, unknown>>;
  finalizeDeletion(capability: unknown): Promise<Record<string, unknown>>;
  observe(context: unknown): Promise<Record<string, unknown>>;
};

const HOST = { principal: { id: "principal:deletion-host", sessionVersion: 1 } };
const PLAYER = { principal: { id: "principal:deletion-player", sessionVersion: 1 } };
const RETIRED_MANIFEST = {
  ...ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
  manifest: {
    profileId: "runtime:deletion-test-retired-v1",
    profileHash: canonicalSha256({ fixture: "deletion-test-retired-v1", base: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST }),
  },
};
const RETIRED_RUNTIME = createVersionedRulesRuntime({
  registrations: [{ manifest: RETIRED_MANIFEST, interpreterKind: "authoritative-v2" }],
  defaultManifest: RETIRED_MANIFEST.manifest,
});

function directory(row: DirectoryRow | null): MutableDirectory {
  const mutable: MutableDirectory = {
    row,
    failReads: false,
    db: undefined as unknown as D1Database,
  };
  mutable.db = {
    prepare(sql: string) {
      const statement = {
        bindings: [] as unknown[],
        bind(...bindings: unknown[]) {
          statement.bindings = bindings;
          return statement;
        },
        async first<T>() {
          if (mutable.failReads) throw new Error("synthetic directory outage");
          expect(sql).toMatch(/select\s+id\s*,\s*host_user_id\s*,\s*status\s+from\s+rooms/i);
          const requestedId = String(statement.bindings[0]);
          return (mutable.row?.id === requestedId ? structuredClone(mutable.row) : null) as T | null;
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return mutable;
}

async function authoritativeRoom(label: string, retiredRuntime = false) {
  const roomId = `room:deletion:${label}:${crypto.randomUUID()}`;
  const authority = env.ROOMS.getByName(roomId) as unknown as DeletionAuthority;
  if (retiredRuntime) {
    await runInDurableObject(authority as never, async (instance) => {
      (instance as unknown as { rulesRuntime: VersionedRulesRuntime }).rulesRuntime = RETIRED_RUNTIME;
    });
  }
  const initialized = await authority.initializeAuthoritative({
    roomId,
    moduleId: "black-oak-will",
    ...(retiredRuntime ? { runtimeProfiles: RETIRED_MANIFEST } : {}),
    members: [
      { principalId: HOST.principal.id, role: "host" },
      { principalId: PLAYER.principal.id, role: "player" },
    ],
    characters: [
      {
        characterId: "character:deletion-host",
        controllerPrincipalId: HOST.principal.id,
        staticCard: { name: "房主", sceneId: "wake" },
      },
      {
        characterId: "character:deletion-player",
        controllerPrincipalId: PLAYER.principal.id,
        staticCard: { name: "玩家", sceneId: "wake" },
      },
    ],
  });
  expect(initialized).toMatchObject({ created: true });
  return {
    roomId,
    authority,
    capabilities: initialized.serviceCapabilities as Record<string, unknown>,
  };
}

async function installDirectory(authority: DeletionAuthority, value: MutableDirectory) {
  await runInDurableObject(authority as never, async (instance) => {
    (instance as unknown as { authorityDeletionDatabaseOverride?: D1Database })
      .authorityDeletionDatabaseOverride = value.db;
  });
}

function intent(submissionId: string) {
  return {
    kind: "intent",
    submissionId,
    text: "我检查门闩。",
  };
}

function observeProposal(rootActionId: string) {
  const formId = "observe.v1" as const;
  const draft = {
    goal: "确认门闩当前状态",
    method: "直接观察门闩",
    focus: "门闩",
    desiredInformation: "门闩当前保持原位",
    resolution: "direct",
    durationUnit: "second",
    durationValue: 1,
  };
  const causalActionProgram = compileKpFormDraft(formId, draft);
  return {
    kind: "privateFormProposal",
    formId,
    draft,
    causalActionProgram,
    loweredCausalProgram: lowerCausalActionProgram(causalActionProgram),
    semanticFreezeHash: causalActionProgram.semanticHash,
    repairUsed: false,
    proposalAttemptId: `proposal:${rootActionId}:1`,
    modelInvocationReceipt: { task: "proposal", result: "success" },
    rootActionId,
  };
}

describe("authoritative-v2 recoverable room deletion", () => {
  it("allows the canonical host to prepare deletion after the room interpreter is retired", async () => {
    const { roomId, authority, capabilities } = await authoritativeRoom("retired");
    const d1 = directory({ id: roomId, host_user_id: HOST.principal.id, status: "deleting" });
    await installDirectory(authority, d1);
    await runInDurableObject(authority as never, async (instance) => {
      // Simulate a deployment that no longer registers this room's manifest,
      // without changing any of the room's persisted state or identity.
      const target = instance as unknown as {
        rulesRuntime: VersionedRulesRuntime;
        authoritativeReplayCache: unknown;
      };
      target.rulesRuntime = { project, replay, step };
      target.authoritativeReplayCache = undefined;
    });
    // A stale directory role must not replace the canonical Room identity.
    d1.row!.host_user_id = PLAYER.principal.id;
    await expect(authority.prepareDeletion(capabilities.roomDeletion, PLAYER)).resolves.toMatchObject({
      kind: "rejected",
      code: "roomDeletionUnauthorized",
    });
    await expect(authority.prepareDeletion(capabilities.roomDeletion, {
      principal: { ...HOST.principal, sessionVersion: 2 },
    })).resolves.toMatchObject({ kind: "rejected", code: "roomDeletionUnauthorized" });
    await expect(authority.prepareDeletion(capabilities.roomDeletion, HOST)).resolves.toMatchObject({
      kind: "deletionPrepared",
      roomId,
      principalId: HOST.principal.id,
    });
    await expect(authority.cancelDeletion(capabilities.roomDeletion, HOST)).resolves.toMatchObject({
      kind: "deletionCancelled",
    });
    await runInDurableObject(authority as never, async (instance) => {
      expect(() => (instance as unknown as { observe(context: unknown): unknown }).observe(HOST))
        .toThrow("unsupportedProfile");
    });
  });

  it("boots a retired room after eviction so host deletion can still complete", async () => {
    const { roomId, authority, capabilities } = await authoritativeRoom("retired-cold", true);
    await evictDurableObject(authority as never);
    await expect(authority.prepareDeletion(capabilities.roomDeletion, HOST)).resolves.toMatchObject({
      kind: "deletionPrepared",
      roomId,
    });
    const d1 = directory({ id: roomId, host_user_id: HOST.principal.id, status: "deleting" });
    await installDirectory(authority, d1);
    await expect(authority.finalizeDeletion(capabilities.roomDeletion)).resolves.toMatchObject({
      kind: "rejected",
      code: "roomDirectoryStillPresent",
    });
    d1.failReads = true;
    await expect(authority.finalizeDeletion(capabilities.roomDeletion)).resolves.toMatchObject({
      kind: "retryableFailure",
      code: "roomDirectoryUnavailable",
    });
    d1.failReads = false;
    d1.row!.status = "play";
    await runDurableObjectAlarm(authority as never);
    await runInDurableObject(authority as never, async (_instance, state) => {
      expect(state.storage.sql.exec("SELECT * FROM authority_room_deletion").toArray()).toEqual([]);
      expect(state.storage.sql.exec("SELECT * FROM authority_rooms").toArray()).toHaveLength(1);
    });
    d1.row!.status = "deleting";
    await expect(authority.prepareDeletion(capabilities.roomDeletion, HOST)).resolves.toMatchObject({
      kind: "deletionPrepared",
    });
    await evictDurableObject(authority as never);
    d1.row = null;
    await installDirectory(authority, d1);
    await runDurableObjectAlarm(authority as never);
    await expect(authority.finalizeDeletion(capabilities.roomDeletion)).resolves.toMatchObject({
      kind: "deletionFinalized",
      alreadyFinalized: true,
    });
    await expect(authority.observe(HOST)).resolves.toMatchObject({
      kind: "rejected",
      code: "roomUninitialized",
    });
  });

  it("preserves paused due work and archive scheduling across eviction and deletion cancellation", async () => {
    const { authority, capabilities } = await authoritativeRoom("paused-cancel");
    const paused = await authority.prepare(HOST, { kind: "safetyPause", submissionId: "deletion:pause" });
    expect(paused).toMatchObject({ kind: "prepared", resolutionMode: "authorityDirect" });
    await expect(authority.commit(HOST, String(paused.preparedActionId), {
      kind: "authenticatedSafetyPause",
      rootActionId: paused.rootActionId,
    })).resolves.toMatchObject({ kind: "committed" });

    const archiveAt = Date.now() + 120_000;
    const dueAt = archiveAt - 60_000;
    await runInDurableObject(authority as never, async (_instance, state) => {
      // Seed scheduler work directly; the paused world itself was committed
      // through the real authenticated prepare/commit path above.
      const store = new AuthoritativeRoomStore(state.storage);
      store.enqueueDueWork({
        causeRootActionId: "root:deletion-scheduler", causeEventId: "event:deletion-scheduler",
        activity: {
          activityId: "activity:deletion-scheduler", ownerEntityId: "character:deletion-host",
          timelineId: "timeline:deletion-scheduler", completionFictionMicros: "1",
          childRootActionId: "due:deletion-scheduler", activityHash: canonicalSha256({ fixture: "scheduler" }),
          sceneIds: ["wake"],
        },
      });
      store.deferDueWork("due:deletion-scheduler", dueAt);
      store.deferArchive(archiveAt, Date.now());
    });
    await evictDurableObject(authority as never);
    await runInDurableObject(authority as never, async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBe(archiveAt);
    });
    await expect(authority.prepareDeletion(capabilities.roomDeletion, HOST)).resolves.toMatchObject({
      kind: "deletionPrepared",
    });
    await expect(authority.cancelDeletion(capabilities.roomDeletion, HOST)).resolves.toMatchObject({
      kind: "deletionCancelled",
    });
    await runInDurableObject(authority as never, async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBe(archiveAt);
      const store = new AuthoritativeRoomStore(state.storage);
      expect(store.dueWorkByRoot("due:deletion-scheduler")).toMatchObject({ status: "pending", next_attempt_at: dueAt });
    });
  });

  it("requires the canonical host and freezes action, administration, and archive writes until cancellation", async () => {
    const { authority, capabilities } = await authoritativeRoom("freeze");
    const prepared = await authority.prepare(HOST, intent("submission:deletion:prepared"));
    expect(prepared).toMatchObject({ kind: "prepared" });

    await expect(authority.prepareDeletion(capabilities.roomDeletion, PLAYER)).resolves.toMatchObject({
      kind: "rejected",
      code: "roomDeletionUnauthorized",
    });
    await expect(authority.prepareDeletion({ kind: "forged" }, HOST)).resolves.toMatchObject({
      kind: "rejected",
      code: "roomDeletionUnauthorized",
    });
    await expect(authority.prepareDeletion(capabilities.roomDeletion, HOST)).resolves.toMatchObject({
      kind: "deletionPrepared",
      principalId: HOST.principal.id,
    });

    await expect(authority.prepare(HOST, intent("submission:deletion:blocked"))).resolves.toMatchObject({
      kind: "rejected",
      code: "roomDeleting",
    });
    await expect(authority.commit(
      HOST,
      String(prepared.preparedActionId),
      observeProposal(String(prepared.rootActionId)),
    )).resolves.toMatchObject({ kind: "rejected", code: "roomDeleting" });
    await expect(authority.applyRoomAdministration(capabilities.roomAdministration, {
      commandId: "admin:while-deleting",
      kind: "departMember",
      principalId: PLAYER.principal.id,
      reason: "must be frozen",
    })).resolves.toMatchObject({ kind: "rejected", code: "roomDeleting" });
    await expect(authority.exportAuthoritativeArchive(capabilities.archiveExport)).resolves.toMatchObject({
      kind: "rejected",
      code: "roomDeleting",
    });

    await expect(authority.cancelDeletion(capabilities.roomDeletion, PLAYER)).resolves.toMatchObject({
      kind: "rejected",
      code: "roomDeletionUnauthorized",
    });
    await expect(authority.cancelDeletion(capabilities.roomDeletion, HOST)).resolves.toMatchObject({
      kind: "deletionCancelled",
    });
    await expect(authority.prepare(HOST, intent("submission:deletion:resumed"))).resolves.toMatchObject({
      kind: "prepared",
    });
  });

  it("finalizes only after D1 confirms absence and clears the authoritative room", async () => {
    const { roomId, authority, capabilities } = await authoritativeRoom("finalize");
    const d1 = directory({ id: roomId, host_user_id: HOST.principal.id, status: "deleting" });
    await installDirectory(authority, d1);
    await authority.prepareDeletion(capabilities.roomDeletion, HOST);

    await expect(authority.finalizeDeletion(capabilities.roomDeletion)).resolves.toMatchObject({
      kind: "rejected",
      code: "roomDirectoryStillPresent",
    });
    d1.row = null;
    await expect(authority.finalizeDeletion(capabilities.roomDeletion)).resolves.toMatchObject({
      kind: "deletionFinalized",
      roomId,
    });
    await expect(authority.finalizeDeletion(capabilities.roomDeletion)).resolves.toMatchObject({
      kind: "deletionFinalized",
      alreadyFinalized: true,
    });
    await runInDurableObject(authority as never, async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
    });
    await expect(authority.observe(HOST)).resolves.toMatchObject({
      kind: "rejected",
      code: "roomUninitialized",
    });
    await expect(authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      members: [{ principalId: HOST.principal.id, role: "host" }],
      characters: [{
        characterId: "character:deletion-recreated",
        controllerPrincipalId: HOST.principal.id,
        staticCard: { name: "重建角色", sceneId: "wake" },
      }],
    })).resolves.toMatchObject({ created: true });
  });

  it("uses its alarm to wait on deleting, cancel on restoration, retry D1 outages, and finalize a lost call", async () => {
    const { roomId, authority, capabilities } = await authoritativeRoom("alarm");
    const d1 = directory({ id: roomId, host_user_id: HOST.principal.id, status: "deleting" });
    await installDirectory(authority, d1);
    await authority.prepareDeletion(capabilities.roomDeletion, HOST);

    await runDurableObjectAlarm(authority as never);
    await expect(authority.prepare(HOST, intent("submission:deleting:wait"))).resolves.toMatchObject({
      kind: "rejected",
      code: "roomDeleting",
    });

    d1.failReads = true;
    await runDurableObjectAlarm(authority as never);
    await runInDurableObject(authority as never, async (_instance, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });

    d1.failReads = false;
    d1.row = { id: roomId, host_user_id: HOST.principal.id, status: "play" };
    await runDurableObjectAlarm(authority as never);
    await expect(authority.prepare(HOST, intent("submission:deleting:restored"))).resolves.toMatchObject({
      kind: "prepared",
    });

    await authority.prepareDeletion(capabilities.roomDeletion, HOST);
    d1.row = null;
    await runDurableObjectAlarm(authority as never);
    await expect(authority.observe(HOST)).resolves.toMatchObject({
      kind: "rejected",
      code: "roomUninitialized",
    });
  });
});
