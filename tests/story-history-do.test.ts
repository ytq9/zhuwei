import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { compileSheet } from "../app/_runtime/lib/dnd/compute";
import type { DraftSheet } from "../app/_runtime/lib/dnd/types";
import { buildAuthoritativeCharacterSeed } from "../app/_runtime/lib/table/authoritative";
import { createStoryHistoryServer } from "../app/_runtime/lib/room/story-history-server";
import { storyHistoricalTargetRoomId, storyRoomIdentityIds } from "../app/_runtime/lib/room/story-history-identity";
import { StoryHistorySessions } from "../app/_runtime/lib/room/story-history-sessions";
import type { StoryHistoryRpc, CreateHistoricalRoomInput } from "../app/_runtime/lib/room/story-history-api-types";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/vnext-world-interaction";
import { VNEXT_KP_PROFILE, VNEXT_KP_WORKFLOW_MANIFEST_JSON } from "../app/_runtime/lib/kp/vnext/runtime-policy";
import { DISABLED_CONTEXT_PLANNER_PROFILE_REF } from "../app/_runtime/lib/kp/model-registry";
import { AUTHORITATIVE_RULESET_VERSION } from "../app/_runtime/lib/rules/ruleset";

const db = (env as unknown as { STORY_ARCHIVE_TEST_DB: D1Database }).STORY_ARCHIVE_TEST_DB;
const migrations = import.meta.glob<string>("../drizzle/*.sql", { eager: true, query: "?raw", import: "default" });
beforeAll(async () => {
  for (const [, sql] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
    for (const statement of sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
}, 30_000);
const draft: DraftSheet = { name: "河港医师", raceId: "human", classId: "fighter", subclassId: "champion", backgroundId: "soldier",
  scores: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 }, extraSkillIds: [], cantrips: [], prepared: [], spellbook: [],
  equipmentChoice: 0, appearance: "带着药包的旅人", trait: "谨慎", ideal: "救助", bond: "故乡", flaw: "好奇" };
const wizard: DraftSheet = { ...draft, name: "档案学者", raceId: "high-elf", classId: "wizard", subclassId: "evocation", backgroundId: "sage",
  scores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, cantrips: ["fire-bolt"], spellbook: ["magic-missile"], prepared: ["magic-missile"] };

async function source() {
  const suffix = crypto.randomUUID(), roomId = `room:history-rpc:${suffix}`, userId = `account:${suffix}`;
  const code = suffix.replaceAll("-", "").slice(0, 8).toUpperCase();
  const stub = env.ROOMS.getByName(roomId);
  const characterId = `character:original:${suffix}`, principal = { principal: { id: userId, sessionVersion: 1 } };
  const initialized = await stub.initializeAuthoritative({ roomId, moduleId: "black-oak-will", moduleVersion: "social-resolution-v1",
    runtimeProfiles: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST,
    members: [{ principalId: userId, role: "host" }], characters: [buildAuthoritativeCharacterSeed({ characterId,
      controllerPrincipalId: userId, sceneId: "wake", sheet: compileSheet(draft), runtimeProfiles: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST })] });
  expect(initialized).toMatchObject({ created: true });
  if (!("created" in initialized)) throw new Error(JSON.stringify(initialized));
  await db.prepare(`INSERT INTO rooms (id, code, host_user_id, title, module_id, ruleset_version, kp_model,
    kp_model_profile, kp_workflow_manifest, kp_context_planner_profile, status, runtime_epoch_id, genesis_hash)
    VALUES (?, ?, ?, '河港旧团', 'black-oak-will', ?, ?, ?, ?, ?, 'play', ?, ?)`)
    .bind(roomId, code, userId, AUTHORITATIVE_RULESET_VERSION, VNEXT_KP_PROFILE.modelId, VNEXT_KP_PROFILE.modelProfileVersion,
      VNEXT_KP_WORKFLOW_MANIFEST_JSON, DISABLED_CONTEXT_PLANNER_PROFILE_REF, initialized.runtimeEpochId, initialized.genesisHash).run();
  await db.prepare("INSERT INTO room_members (room_id,user_id,nickname,is_host) VALUES (?,?,'原角色',1)").bind(roomId,userId).run();
  const api = createStoryHistoryServer({ database: () => db, room: id => env.ROOMS.getByName(id) as unknown as StoryHistoryRpc,
    newRoomCode: () => crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase() });
  return { roomId, code, userId, characterId, principal, stub, api };
}

it("real server → source Room → historical Rules genesis → target Room → D1 publication supports distinct builds and exact retries", async () => {
  const f = await source();
  const initial = await f.stub.observe(f.principal);
  const listed = await f.api.listHistoricalStarts({ userId: f.userId, data: { code: f.code, cursor: null } });
  expect(listed.kind, JSON.stringify(listed)).toBe("listed");
  if (listed.kind !== "listed") throw new Error(listed.code);
  expect(listed.starts.length).toBeGreaterThan(1);
  const requests: CreateHistoricalRoomInput[] = [];
  for (const [index, build] of [draft, wizard].entries()) {
    const request: CreateHistoricalRoomInput = { code: f.code, submissionId: crypto.randomUUID(),
      startToken: listed.starts[index].startToken, nickname: build.name, draft: build };
    requests.push(request);
    const created = await f.api.createHistoricalRoom({ userId: f.userId, data: request });
    expect(created.kind, JSON.stringify(created)).toBe("created");
    const targetId = storyHistoricalTargetRoomId(f.userId, request.submissionId), target = env.ROOMS.getByName(targetId);
    const ids = storyRoomIdentityIds(targetId, f.userId);
    const observed = await target.observe(f.principal);
    expect(JSON.stringify(observed)).toContain(build.name);
    expect(JSON.stringify(observed)).toContain(ids.characterId);
    expect(await target.readStoryViewerPage(f.principal, { cursor: null, characterId: f.characterId }))
      .toMatchObject({ kind: "rejected" });
    const saved = await db.prepare("SELECT id,sheet,locked FROM characters WHERE room_id=? AND user_id=?").bind(targetId,f.userId)
      .first<{id:string;sheet:string;locked:number}>();
    expect(saved?.id).toBe(ids.characterId);
    expect(saved?.locked).toBe(1);
    expect(JSON.parse(saved!.sheet).classId).toBe(build.classId);
    await evictDurableObject(target);
    expect(await f.api.createHistoricalRoom({ userId: f.userId, data: request })).toEqual(created);
    expect(await target.observe(f.principal)).toEqual(observed);
    expect(await f.api.createHistoricalRoom({ userId: f.userId, data: { ...request, nickname: "不同请求" } }))
      .toMatchObject({ kind: "rejected" });
  }
  expect(await f.stub.observe(f.principal)).toEqual(initial);
  // Losing a private source-list session cannot destroy a previously created
  // target's exact idempotency receipt, or admit a changed request.
  await runInDurableObject(f.stub, (_instance, ctx) => new StoryHistorySessions(ctx.storage).clear());
  expect((await f.api.createHistoricalRoom({ userId:f.userId, data:requests[0] })).kind).toBe("created");
});

it("real Room rejects foreign source access and source tokens never grant old-character knowledge", async () => {
  const f = await source(), foreign = { principal: { id: "account:foreign", sessionVersion: 1 } };
  expect(await f.stub.listStoryHistoricalStarts(foreign, { cursor:null })).toMatchObject({kind:"rejected"});
  expect(await f.stub.readStoryViewerPage(foreign, {cursor:null})).toMatchObject({kind:"rejected"});
  const exported = await f.api.exportStoryHistoryPage({userId:f.userId,data:{code:f.code,cursor:null}});
  expect(exported.kind,JSON.stringify(exported)).toBe("exported");
  if(exported.kind!=="exported") throw new Error(exported.code);
  expect(exported.export.characterId).toBe(f.characterId);
  expect(JSON.stringify(exported)).not.toContain("storySnapshot");
  expect(JSON.stringify(exported)).not.toContain("hostBindings");
});
