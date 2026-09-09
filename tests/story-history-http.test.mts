/// <reference path="../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { storyHistoricalTargetRoomId, storyRoomIdentityIds } from "../app/_runtime/lib/room/story-history-identity";
import { StoryHistorySessions } from "../app/_runtime/lib/room/story-history-sessions";
import type { CreateHistoricalRoomInput, StoryHistoricalStart } from "../app/_runtime/lib/room/story-history-api-types";
import { historyHttpAccount, historyHttpAuthority, historyHttpDb, historyHttpDraft, historyHttpPost,
  historyHttpSource, historyHttpWizard, httpRecord } from "./fixtures/story-history-http";

// Run with tests/fixtures/story-history-http.config.mjs. The real handlers use
// Vinext request-local headers, real auth sessions, local D1 and real Room DOs.
// No Provider credentials are configured; mechanical outcomes are asserted
// independently from any recoverable narration failure.
const migrations = import.meta.glob<string>("../drizzle/*.sql", { eager: true, query: "?raw", import: "default" });
beforeAll(async () => {
  for (const [, sql] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
    for (const statement of sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) {
      await historyHttpDb.prepare(statement).run();
    }
  }
}, 30_000);
beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    throw new Error(`HTTP_HISTORY_TEST_OUTBOUND_DISABLED:${url.origin}${url.pathname}`);
  });
});
afterEach(() => vi.restoreAllMocks());

it("real authenticated POST exports Viewer records and enters an independently playable historical Room through the same route", async () => {
  const owner = await historyHttpAccount("历史接口验收"), source = await historyHttpSource(owner);
  const outbound = vi.mocked(globalThis.fetch);
  const listed = await historyHttpPost("listHistoricalStarts", { code: source.code, cursor: null }, owner);
  expect(listed.response.status).toBe(200); expect(listed.body.kind, JSON.stringify(listed.body)).toBe("listed");
  const starts = listed.body.starts as StoryHistoricalStart[]; expect(starts.length).toBeGreaterThan(1);

  const oldAction = await historyHttpPost("setGear", { code: source.code, submissionId: crypto.randomUUID(), action: "stow", slot: "main" }, owner);
  expect(oldAction.response.status).toBe(200); expect(oldAction.body.action, JSON.stringify(oldAction.body)).toBe("committed");
  const sourceAfterAction = await historyHttpAuthority(source.roomId); expect(sourceAfterAction!.events.length).toBeGreaterThan(0);
  const exported = await historyHttpPost("exportStoryHistoryPage", { code: source.code, cursor: null }, owner);
  expect(exported.response.status).toBe(200); expect(exported.body.kind, JSON.stringify(exported.body)).toBe("exported");
  const viewer = httpRecord(exported.body.export);
  expect(viewer.characterId).toBe(source.characters[0].characterId);
  expect(httpRecord(viewer.source).roomId).toBe(source.roomId);
  expect(viewer.format).toBe("zhuwei.story-viewer-export/v1"); expect(Array.isArray(viewer.transcript)).toBe(true);
  expect(JSON.stringify(exported.body)).not.toMatch(/storySnapshot|hostBindings|sourceStoryArchive|storyBible/);

  const createdRequests: CreateHistoricalRoomInput[] = [];
  for (const [index, draft] of [historyHttpDraft, historyHttpWizard].entries()) {
    const request: CreateHistoricalRoomInput = { code: source.code, submissionId: crypto.randomUUID(),
      startToken: starts[index].startToken, nickname: draft.name, draft };
    createdRequests.push(request);
    const created = await historyHttpPost("createHistoricalRoom", request, owner);
    expect(created.response.status).toBe(200); expect(created.body.kind, JSON.stringify(created.body)).toBe("created");
    const targetId = storyHistoricalTargetRoomId(owner.userId, request.submissionId), ids = storyRoomIdentityIds(targetId, owner.userId);
    const target = await historyHttpAuthority(targetId); expect(target).not.toBeNull();
    expect(target!.genesis.historicalOrigin?.source.roomId).toBe(source.roomId);
    expect(target!.genesis.historicalOrigin?.cut.eventSeq).toBe("0");
    expect(target!.state.runtimeEpochId).not.toBe(sourceAfterAction!.state.runtimeEpochId);
    expect(target!.state.activeBranchId).not.toBe(sourceAfterAction!.state.activeBranchId);
    expect(target!.state.entities[ids.characterId]).toMatchObject({ kind: "player", name: draft.name, tenureStatus: "active" });
    expect(target!.state.characterControls[source.characters[0].characterId]).toBeUndefined();

    const targetCode = String(created.body.code), table = await historyHttpPost("fetchTable", targetCode, owner);
    expect(table.response.status).toBe(200); expect(table.body.ok, JSON.stringify(table.body)).toBe(true);
    expect(httpRecord(table.body.state).sceneId).toBe(target!.state.entities[ids.characterId].sceneId);
    const own = (table.body.characters as unknown[]).map(httpRecord).find(value => value.userId === owner.userId);
    expect(own).toMatchObject({ locked: true }); expect(httpRecord(own!.sheet)).toMatchObject({ name: draft.name, classId: draft.classId });

    const action = { code: targetCode, submissionId: crypto.randomUUID(), action: "stow", slot: "main" };
    const acted = await historyHttpPost("setGear", action, owner);
    expect(acted.response.status).toBe(200); expect(acted.body.action, JSON.stringify(acted.body)).toBe("committed");
    const changed = await historyHttpAuthority(targetId); expect(changed!.events.length).toBeGreaterThan(target!.events.length);
    expect(changed!.state.entities[ids.characterId].loadout?.equipped.main).toBeUndefined();
    expect(await historyHttpAuthority(source.roomId)).toEqual(sourceAfterAction);
    const replayed = await historyHttpPost("setGear", action, owner);
    expect(replayed.body.action).toBe("committed");
    expect(await historyHttpAuthority(targetId)).toEqual(changed);

    await evictDurableObject(env.ROOMS.getByName(targetId));
    expect((await historyHttpPost("createHistoricalRoom", request, owner)).body).toEqual(created.body);
    expect(await historyHttpAuthority(targetId)).toEqual(changed);
    const oldIdentity = await historyHttpPost("exportStoryHistoryPage", { code: targetCode, cursor: null,
      characterId: source.characters[0].characterId }, owner);
    expect(oldIdentity.body.kind).toBe("rejected");
    const saved = await historyHttpDb.prepare("SELECT id,sheet,locked FROM characters WHERE room_id=? AND user_id=?")
      .bind(targetId, owner.userId).first<{ id: string; sheet: string; locked: number }>();
    expect(saved).toMatchObject({ id: ids.characterId, locked: 1 }); expect(JSON.parse(saved!.sheet).classId).toBe(draft.classId);
  }
  await runInDurableObject(source.stub, (_instance, ctx) => new StoryHistorySessions(ctx.storage).clear());
  expect((await historyHttpPost("createHistoricalRoom", createdRequests[0], owner)).body.kind).toBe("created");
  expect(await historyHttpAuthority(source.roomId)).toEqual(sourceAfterAction);
  expect(outbound).not.toHaveBeenCalled();
}, 30_000);

it("the actual game handler enforces cookie identity, same origin, room membership and principal-bound start tokens before publication", async () => {
  const owner = await historyHttpAccount("原房主"), peer = await historyHttpAccount("同桌玩家"), foreign = await historyHttpAccount("陌生账号");
  const source = await historyHttpSource(owner, peer), before = await historyHttpAuthority(source.roomId);
  for (const [account, headers] of [[undefined, {}], [undefined, { "x-user-id": owner.userId }],
    [{ ...owner, cookie: "__Host-zhuwei_session=invented-session" }, {}]] as const) {
    const denied = await historyHttpPost("listHistoricalStarts", { code: source.code, cursor: null }, account, headers);
    expect(denied.response.status).toBe(401); expect(denied.body).toEqual({ error: "请先登录。" });
  }
  const crossOrigin = await historyHttpPost("listHistoricalStarts", { code: source.code, cursor: null }, owner, { origin: "https://foreign.test" });
  expect(crossOrigin.response.status).toBe(403);
  for (const command of ["exportStoryHistoryPage", "listHistoricalStarts"]) {
    const denied = await historyHttpPost(command, { code: source.code, cursor: null }, foreign);
    expect(denied.response.status).toBe(200); expect(denied.body).toEqual({ kind: "rejected", code: "STORY_HISTORY_SOURCE_UNAVAILABLE" });
  }
  const listed = await historyHttpPost("listHistoricalStarts", { code: source.code, cursor: null }, owner);
  expect(listed.body.kind, JSON.stringify(listed.body)).toBe("listed");
  const startToken = (listed.body.starts as StoryHistoricalStart[])[0].startToken;
  for (const [account, token] of [[peer, startToken], [owner, "invented-start-token"]] as const) {
    const request = { code: source.code, submissionId: crypto.randomUUID(), startToken: token, nickname: "新身份", draft: historyHttpDraft };
    const denied = await historyHttpPost("createHistoricalRoom", request, account);
    expect(denied.body.kind, JSON.stringify(denied.body)).toBe("rejected");
    const targetId = storyHistoricalTargetRoomId(account.userId, request.submissionId);
    expect(await historyHttpAuthority(targetId)).toBeNull();
    expect(await historyHttpDb.prepare("SELECT id FROM rooms WHERE id=?").bind(targetId).first()).toBeNull();
  }
  const privateCommand = await historyHttpPost("prepareStoryHistoricalBranch", { startToken }, owner);
  expect(privateCommand.response.status).toBe(404);
  const oldKnowledge = await historyHttpPost("exportStoryHistoryPage", { code: source.code, cursor: null,
    characterId: source.characters[0].characterId }, peer);
  expect(oldKnowledge.body.kind).toBe("rejected");
  expect(await historyHttpAuthority(source.roomId)).toEqual(before);
}, 30_000);
