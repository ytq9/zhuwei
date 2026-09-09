import { env } from "cloudflare:workers";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { createStoryHistoryServer } from "../app/_runtime/lib/room/story-history-server";
import { storyHistoricalTargetRoomId, storyRoomIdentityIds } from "../app/_runtime/lib/room/story-history-identity";
import type { CreateHistoricalRoomInput, InitializeHistoricalAuthoritativeInput, InitializeHistoricalAuthoritativeResult, StoryHistoryRpc } from "../app/_runtime/lib/room/story-history-api-types";
import type { StoryViewerExport } from "../app/_runtime/lib/room/story-history/contracts";
import type { DraftSheet } from "../app/_runtime/lib/dnd/types";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/vnext-world-interaction";
import { VNEXT_KP_PROFILE, VNEXT_KP_WORKFLOW_MANIFEST_JSON } from "../app/_runtime/lib/kp/vnext/runtime-policy";
import { DISABLED_CONTEXT_PLANNER_PROFILE_REF } from "../app/_runtime/lib/kp/model-registry";
import { AUTHORITATIVE_RULESET_VERSION } from "../app/_runtime/lib/rules/ruleset";
import { pinnedModuleRef } from "../app/_runtime/lib/module/registry";
import { collectStoryViewerExport, createHistoricalRoom } from "../app/_runtime/lib/table/story-history-client";

// Evidence boundary: real D1 schema, batch atomicity, compilation and public
// transport; Room RPC is a test double. Rules/Room history semantics have a
// separate integration suite and are not claimed by these adapter checks.
const db = (env as unknown as { STORY_ARCHIVE_TEST_DB: D1Database }).STORY_ARCHIVE_TEST_DB;
const migrations = import.meta.glob<string>("../drizzle/*.sql", { eager: true, query: "?raw", import: "default" });
beforeAll(async () => {
  for (const [, sql] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
    for (const statement of sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}, 30_000);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const draft: DraftSheet = {
  name: "林舟", raceId: "human", classId: "fighter", subclassId: "champion", backgroundId: "soldier",
  scores: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 }, extraSkillIds: [], cantrips: [], prepared: [],
  spellbook: [], equipmentChoice: 0, appearance: "旅行者", trait: "谨慎", ideal: "求知", bond: "故乡", flaw: "好奇",
};
const moduleRef = pinnedModuleRef("black-oak-will", "social-resolution-v1")!;
type Initialized = Extract<InitializeHistoricalAuthoritativeResult, { kind: "initialized" }>;

async function fixture() {
  const suffix = crypto.randomUUID();
  const sourceId = `room:source:${suffix}`, userId = `account:${suffix}`;
  const code = suffix.replaceAll("-", "").slice(0, 8).toUpperCase();
  await db.prepare(`INSERT INTO rooms (id, code, host_user_id, title, module_id, ruleset_version, kp_model,
    kp_model_profile, kp_workflow_manifest, kp_context_planner_profile, status, runtime_epoch_id, genesis_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'play', ?, ?)`)
    .bind(sourceId, code, userId, "河港事件", "black-oak-will", AUTHORITATIVE_RULESET_VERSION,
      VNEXT_KP_PROFILE.modelId, VNEXT_KP_PROFILE.modelProfileVersion, VNEXT_KP_WORKFLOW_MANIFEST_JSON,
      DISABLED_CONTEXT_PLANNER_PROFILE_REF, `epoch:source:${suffix}`, canonicalSha256({ sourceId })).run();
  await db.prepare("INSERT INTO room_members (room_id, user_id, nickname, is_host) VALUES (?, ?, ?, 1)")
    .bind(sourceId, userId, "旧团人物").run();
  const inputs: Array<{ target: string; principalId: string; input: InitializeHistoricalAuthoritativeInput }> = [];
  const accepted = new Map<string, Initialized>();
  const calls: string[] = [];
  const rpc: StoryHistoryRpc = {
    async readStoryViewerPage() { return { kind: "rejected", code: "STORY_HISTORY_SOURCE_UNAVAILABLE" }; },
    async listStoryHistoricalStarts(context, input) {
      calls.push("starts");
      expect(context.principal.id).toBe(userId);
      expect(input).toEqual({ cursor: null });
      return { kind: "listed", starts: [{ startToken: "opaque:harbor", label: "渡口的清晨", sceneName: "渡口", fictionTimeLabel: "第一天清晨" }], nextCursor: null };
    },
    async initializeHistoricalAuthoritative(context, input) {
      calls.push("initialize");
      inputs.push({ target: input.targetRoomId, principalId: context.principal.id, input: structuredClone(input) });
      const prior = accepted.get(input.targetRoomId);
      if (prior) return prior.requestHash === input.requestHash ? prior : { kind: "rejected", code: "STORY_HISTORY_REQUEST_CONFLICT" };
      const value: Initialized = { kind: "initialized", roomId: input.targetRoomId, requestHash: input.requestHash,
        runtimeEpochId: `epoch:${input.targetRoomId}`, genesisHash: canonicalSha256(input), moduleRef,
        runtimeProfiles: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST, ...storyRoomIdentityIds(input.targetRoomId, context.principal.id) };
      accepted.set(input.targetRoomId, value);
      return value;
    },
  };
  const generatedCodes: string[] = [];
  const api = createStoryHistoryServer({ database: () => db, room: target => {
    calls.push(`room:${target}`);
    return rpc;
  }, newRoomCode: () => generatedCodes.shift() ?? crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase() });
  const request: CreateHistoricalRoomInput = { code, submissionId: crypto.randomUUID(), startToken: "opaque:harbor",
    nickname: "新团称呼", draft: structuredClone(draft) };
  return { sourceId, userId, code, rpc, api, request, inputs, accepted, calls, generatedCodes };
}

it("creates two ordinary builds through the same adapter with distinct room-scoped identities and pinned bindings", async () => {
  const f = await fixture();
  const starts = await f.api.listHistoricalStarts({ userId: f.userId, data: { code: f.code, cursor: null } });
  expect(starts.kind).toBe("listed");
  const wizard: DraftSheet = { ...draft, name: "沈星", raceId: "high-elf", classId: "wizard", subclassId: "evocation",
    backgroundId: "sage", scores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    cantrips: ["fire-bolt"], spellbook: ["magic-missile"], prepared: ["magic-missile"] };
  for (const character of [draft, wizard]) {
    const request = { ...f.request, submissionId: crypto.randomUUID(), draft: character };
    const result = await f.api.createHistoricalRoom({ userId: f.userId, data: request });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error(`Creation failed: ${result.code}`);
    const target = storyHistoricalTargetRoomId(f.userId, request.submissionId);
    const room = await db.prepare("SELECT * FROM rooms WHERE id = ?").bind(target).first<Record<string, unknown>>();
    expect(room).toMatchObject({ code: result.code, status: "play", host_user_id: f.userId,
      kp_model: VNEXT_KP_PROFILE.modelId, kp_model_profile: VNEXT_KP_PROFILE.modelProfileVersion,
      kp_workflow_manifest: VNEXT_KP_WORKFLOW_MANIFEST_JSON, kp_context_planner_profile: DISABLED_CONTEXT_PLANNER_PROFILE_REF });
    const saved = await db.prepare("SELECT id, sheet, locked FROM characters WHERE room_id = ? AND user_id = ?")
      .bind(target, f.userId).first<{ id: string; sheet: string; locked: number }>();
    expect(saved?.id).toBe(storyRoomIdentityIds(target, f.userId).characterId);
    expect(JSON.parse(saved!.sheet)).toMatchObject({ name: character.name, classId: character.classId });
    expect(saved?.locked).toBe(1);
    expect(f.inputs.at(-1)).toMatchObject({ principalId: f.userId, input: { source: { roomId: f.sourceId, startToken: request.startToken },
      character: { controllerPrincipalId: f.userId, characterId: saved?.id } } });
    expect(f.inputs.at(-1)!.input.character.staticCard.sceneId).toBe("scene:historical-origin-pending");
  }
  const targets = [...f.accepted.keys()];
  expect(targets).toHaveLength(2);
  expect(storyRoomIdentityIds(targets[0], f.userId)).not.toEqual(storyRoomIdentityIds(targets[1], f.userId));
  expect(storyHistoricalTargetRoomId("other-account", f.request.submissionId)).not.toBe(storyHistoricalTargetRoomId(f.userId, f.request.submissionId));
});

it("rolls back all D1 publication rows on a real statement failure and retries the same initialized target", async () => {
  const f = await fixture();
  const target = storyHistoricalTargetRoomId(f.userId, f.request.submissionId);
  await db.prepare(`CREATE TRIGGER fail_history_publication BEFORE INSERT ON characters WHEN NEW.room_id = '${target}'
    BEGIN SELECT RAISE(ABORT, 'PRIVATE_D1_FAILURE_CANARY'); END`).run();
  try {
    const failed = await f.api.createHistoricalRoom({ userId: f.userId, data: f.request });
    expect(failed).toEqual({ kind: "retryableFailure", code: "STORY_HISTORY_PUBLICATION_PENDING" });
    for (const table of ["rooms", "room_members", "characters"]) {
      const key = table === "rooms" ? "id" : "room_id";
      expect(await db.prepare(`SELECT count(*) AS count FROM ${table} WHERE ${key} = ?`).bind(target).first<number>("count")).toBe(0);
    }
    expect(f.accepted.size).toBe(1);
  } finally { await db.prepare("DROP TRIGGER fail_history_publication").run(); }
  const retried = await f.api.createHistoricalRoom({ userId: f.userId, data: f.request });
  const replayed = await f.api.createHistoricalRoom({ userId: f.userId, data: f.request });
  expect(retried.kind).toBe("created");
  expect(replayed).toEqual(retried);
  expect(f.accepted.size).toBe(1);
  expect(new Set(f.inputs.map(entry => entry.input.requestHash)).size).toBe(1);
  expect(new Set(f.inputs.map(entry => entry.target)).size).toBe(1);
});

it("reselects a colliding directory code without another Room initialization and rejects changed retry content", async () => {
  const f = await fixture();
  const availableCode = `N${f.code}`;
  f.generatedCodes.push(f.code, availableCode);
  const created = await f.api.createHistoricalRoom({ userId: f.userId, data: f.request });
  expect(created).toEqual({ kind: "created", code: availableCode });
  expect(f.inputs).toHaveLength(1);
  const changed = await f.api.createHistoricalRoom({ userId: f.userId, data: { ...f.request, nickname: "不同称呼" } });
  expect(changed).toEqual({ kind: "rejected", code: "STORY_HISTORY_REQUEST_CONFLICT" });
  expect(f.accepted.size).toBe(1);
});

it("recovers a lost initializer response by preserving the submission and validates the returned identity before publishing", async () => {
  const f = await fixture();
  const initialize = f.rpc.initializeHistoricalAuthoritative;
  let dropResponse = true;
  f.rpc.initializeHistoricalAuthoritative = async (context, input) => {
    const value = await initialize(context, input);
    if (dropResponse) { dropResponse = false; throw new Error("PRIVATE_RPC_BODY_CANARY"); }
    return value;
  };
  expect(await f.api.createHistoricalRoom({ userId: f.userId, data: f.request }))
    .toEqual({ kind: "retryableFailure", code: "STORY_HISTORY_UNAVAILABLE" });
  expect((await f.api.createHistoricalRoom({ userId: f.userId, data: f.request })).kind).toBe("created");
  expect(f.accepted.size).toBe(1);
  const another = { ...f.request, submissionId: crypto.randomUUID() };
  f.rpc.initializeHistoricalAuthoritative = async (context, input) => {
    const value = await initialize(context, input);
    return value.kind === "initialized" ? { ...value, seatId: `seat:${context.principal.id}` } : value;
  };
  expect(await f.api.createHistoricalRoom({ userId: f.userId, data: another }))
    .toEqual({ kind: "rejected", code: "STORY_HISTORY_BINDING_INVALID" });
  expect(await db.prepare("SELECT id FROM rooms WHERE id = ?")
    .bind(storyHistoricalTargetRoomId(f.userId, another.submissionId)).first()).toBeNull();
});

it("rejects untrusted payloads, unauthorized sources and invalid server bindings before calling Room", async () => {
  const f = await fixture();
  expect(await f.api.createHistoricalRoom({ userId: "outsider", data: f.request }))
    .toEqual({ kind: "rejected", code: "STORY_HISTORY_SOURCE_UNAVAILABLE" });
  expect(await f.api.exportStoryHistoryPage({ userId: f.userId, data: { code: "UNKNOWN", cursor: null } }))
    .toEqual({ kind: "rejected", code: "STORY_HISTORY_SOURCE_UNAVAILABLE" });
  for (const data of [{ ...f.request, principal: { id: f.userId } }, { ...f.request, archive: {} },
    { ...f.request, draft: { ...draft, raceId: "invented-race" } },
    { ...f.request, draft: { ...draft, sceneId: "secret-scene" } }]) {
    expect(await f.api.createHistoricalRoom({ userId: f.userId, data })).toEqual({ kind: "rejected", code: "STORY_HISTORY_REQUEST_INVALID" });
  }
  await db.prepare("UPDATE rooms SET kp_workflow_manifest = ? WHERE id = ?").bind("unregistered", f.sourceId).run();
  expect(await f.api.createHistoricalRoom({ userId: f.userId, data: f.request }))
    .toEqual({ kind: "rejected", code: "STORY_HISTORY_BINDING_INVALID" });
  expect(f.calls).toEqual([]);
});

function viewerPage(sourceId: string, ordinal: number, nextCursor: string | null): StoryViewerExport {
  return { format: "zhuwei.story-viewer-export/v1",
    source: { roomId: sourceId, runtimeEpochId: "epoch:export", archiveHash: canonicalSha256("source"), branchId: "branch:export" },
    characterId: "character:viewer", readModel: { viewer: { characterId: "character:viewer" } },
    projectionHash: canonicalSha256("projection"), contentHash: canonicalSha256({ ordinal }), nextCursor,
    transcript: [{ ordinal, messageId: `message:${ordinal}`, sceneIds: ["harbor"], kind: ordinal === 2 ? "roll" : "kp",
      speakerCharacterId: null, speakerName: "KP", body: ordinal === 2 ? "察觉检定：17" : "你抵达了渡口。",
      sourceEventSeq: String(ordinal), receiptId: `receipt:${ordinal}` }] };
}
function routeTransport(api: ReturnType<typeof createStoryHistoryServer>, userId: string) {
  const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
    const payload = JSON.parse(String(init.body));
    const handler = api[payload.command as keyof typeof api];
    return Response.json(await handler({ userId, data: payload.data }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

it("collects every Viewer page including rolls, forwards cursors, and excludes sibling system materials", async () => {
  const f = await fixture();
  const cursors: Array<string | null> = [];
  f.rpc.readStoryViewerPage = async (context, input) => {
    expect(context.principal.id).toBe(f.userId);
    cursors.push(input.cursor);
    return { kind: "exported", export: { ...viewerPage(f.sourceId, input.cursor === null ? 1 : 2, input.cursor === null ? "opaque:page2" : null),
      systemSeed: "PRIVATE_SEED_CANARY" }, systemArchive: "PRIVATE_ARCHIVE_CANARY" } as Awaited<ReturnType<StoryHistoryRpc["readStoryViewerPage"]>>;
  };
  routeTransport(f.api, f.userId);
  const pages = await collectStoryViewerExport(f.code);
  expect(pages.flatMap(page => page.transcript).map(message => message.kind)).toEqual(["kp", "roll"]);
  expect(cursors).toEqual([null, "opaque:page2"]);
  expect(JSON.stringify(pages)).not.toContain("PRIVATE_");
  f.rpc.readStoryViewerPage = async () => ({ kind: "rejected", code: "PRIVATE_DIAGNOSTIC_CANARY" });
  expect(await f.api.exportStoryHistoryPage({ userId: f.userId, data: { code: f.code, cursor: null } }))
    .toEqual({ kind: "rejected", code: "STORY_HISTORY_UNAVAILABLE" });
});

it("refuses a changing Viewer snapshot or repeated cursor instead of downloading a partial export", async () => {
  const f = await fixture();
  routeTransport(f.api, f.userId);
  f.rpc.readStoryViewerPage = async (_context, input) => ({ kind: "exported",
    export: { ...viewerPage(f.sourceId, 1, "same-cursor"),
      projectionHash: canonicalSha256(input.cursor === null ? "before" : "after") } });
  await expect(collectStoryViewerExport(f.code)).rejects.toThrow("历史快照发生变化");
  f.rpc.readStoryViewerPage = async () => ({ kind: "exported", export: viewerPage(f.sourceId, 1, "same-cursor") });
  await expect(collectStoryViewerExport(f.code)).rejects.toThrow("历史分页未能继续");
});

it("keeps the browser submission on retryable publication failures and clears it only after success", async () => {
  const f = await fixture();
  const saved = new Map<string, string>();
  vi.stubGlobal("window", { sessionStorage: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
  } });
  const seen: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    const payload = JSON.parse(String(init.body));
    seen.push(payload.data.submissionId);
    return Response.json(seen.length === 1 ? { kind: "retryableFailure", code: "STORY_HISTORY_PUBLICATION_PENDING" }
      : { kind: "created", code: "NEWROOM" });
  }));
  const { submissionId: _submissionId, ...data } = f.request;
  expect((await createHistoricalRoom(data)).kind).toBe("retryableFailure");
  expect(saved.size).toBe(1);
  expect(await createHistoricalRoom(data)).toEqual({ kind: "created", code: "NEWROOM" });
  expect(seen[0]).toBe(seen[1]);
  expect(saved.size).toBe(0);
});
