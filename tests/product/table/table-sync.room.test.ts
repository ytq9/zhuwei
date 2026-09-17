import { env } from "cloudflare:workers";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import * as database from "../../../db";
import * as room from "../../../app/_runtime/lib/room/server";
import { fetchTable } from "../../../app/_runtime/lib/table/server";
import { compileSheet } from "../../../app/_runtime/lib/dnd/compute";
import { buildAuthoritativeCharacterSeed } from "../../../app/_runtime/lib/table/authoritative";
import { VNEXT_KP_PROFILE, VNEXT_KP_WORKFLOW_MANIFEST_JSON } from "../../../app/_runtime/lib/kp/vnext/runtime-policy";
import { playTableSnapFixture } from "../../support/fixtures/tactical-map-v2.mjs";

const db = (env as unknown as { STORY_ARCHIVE_TEST_DB: D1Database }).STORY_ARCHIVE_TEST_DB;
const migrations = import.meta.glob<string>("/drizzle/*.sql", { eager: true, query: "?raw", import: "default" });
beforeAll(async () => {
  expect(Object.keys(migrations).length).toBeGreaterThan(0);
  for (const [, sql] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
    for (const statement of sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}, 30_000);
afterEach(() => vi.restoreAllMocks());

// SPEC 0007 §2, SPEC 0001 §9: temporary read loss and denied Viewer access
// have different recovery behavior; neither can fabricate an observation.
it("the table service distinguishes an unavailable Room RPC from a denied or invalid projection", async () => {
  vi.spyOn(database, "ensureDb").mockResolvedValue(db);
  const snap = playTableSnapFixture(compileSheet);
  const userId = snap.me.userId, roomId = "table-sync:room", code = "SYNC42";
  const sheet = snap.characters[0].sheet;
  const stub = env.ROOMS.getByName(roomId);
  expect(await stub.initializeAuthoritative({ roomId, moduleId: "black-oak-will",
    members: [{ principalId: userId, role: "host" }],
    characters: [buildAuthoritativeCharacterSeed({ characterId: `character:${userId}`,
      controllerPrincipalId: userId, sceneId: "wake", sheet })],
  } as never)).toMatchObject({ created: true });
  await db.prepare("INSERT INTO auth_users (id, name, email, password_hash, password_salt, password_iterations) VALUES (?, '同步验收', 'sync@example.test', 'unused', 'unused', 1)")
    .bind(userId).run();
  await db.prepare(`INSERT INTO rooms (id, code, host_user_id, title, module_id, ruleset_version,
    kp_model, kp_model_profile, kp_workflow_manifest, status)
    VALUES (?, ?, ?, '同步验收', 'black-oak-will', ?, ?, ?, ?, 'play')`)
    .bind(roomId, code, userId, snap.room.ruleset_version, VNEXT_KP_PROFILE.modelId,
      VNEXT_KP_PROFILE.modelProfileVersion, VNEXT_KP_WORKFLOW_MANIFEST_JSON).run();
  await db.prepare("INSERT INTO room_members (room_id, user_id, nickname, is_host) VALUES (?, ?, '同步验收', 1)")
    .bind(roomId, userId).run();
  await db.prepare("INSERT INTO characters (id, room_id, user_id, sheet, locked) VALUES (?, ?, ?, ?, 1)")
    .bind(`character:${userId}`, roomId, userId, JSON.stringify(sheet)).run();
  const input = { userId, data: code };
  const before = await stub.observe(room.trustedRoomPrincipal(userId));
  expect(await fetchTable(input)).toMatchObject({ ok: true });

  const observe = vi.spyOn(room, "observeAuthoritativeRoom");
  observe.mockRejectedValueOnce(new Error("Network connection lost. PRIVATE_INTERNAL_DETAIL"));
  expect(await fetchTable(input)).toEqual({ ok: false, retryable: true,
    error: "房间投影暂时不可用，请稍后刷新" });
  expect(await fetchTable(input)).toMatchObject({ ok: true });

  for (const denied of [
    { kind: "rejected", code: "viewerUnauthorized", message: "PRIVATE_DENIAL_REASON" },
    { readModel: { kind: "projected", viewer: { kind: "player", principalId: "someone-else" } } },
  ]) {
    observe.mockResolvedValueOnce(denied as never);
    const result = await fetchTable(input);
    expect(result).toEqual({ ok: false, error: "房间投影暂时不可用，请稍后刷新" });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|someone-else/);
  }
  expect(await stub.observe(room.trustedRoomPrincipal(userId))).toEqual(before);
});
