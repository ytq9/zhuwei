import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect } from "vitest";
import { headersContextFromRequest, runWithHeadersContext } from "vinext/shims/headers";
import { POST as gamePost } from "../../app/api/game/route";
import { POST as registerPost } from "../../app/api/auth/register/route";
import { compileSheet } from "../../app/_runtime/lib/dnd/compute";
import type { DraftSheet } from "../../app/_runtime/lib/dnd/types";
import { buildAuthoritativeCharacterSeed } from "../../app/_runtime/lib/table/authoritative";
import { AuthoritativeRoomStore } from "../../app/_runtime/lib/room/authority-store";
import type { AuthoritativeWorldState, RuntimeGenesis } from "../../app/_runtime/lib/rules";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../../app/_runtime/lib/rules/profiles/vnext-world-interaction";
import { VNEXT_KP_PROFILE, VNEXT_KP_WORKFLOW_MANIFEST_JSON } from "../../app/_runtime/lib/kp/vnext/runtime-policy";
import { DISABLED_CONTEXT_PLANNER_PROFILE_REF } from "../../app/_runtime/lib/kp/model-registry";
import { AUTHORITATIVE_RULESET_VERSION } from "../../app/_runtime/lib/rules/ruleset";

export type HttpRecord = Record<string, unknown>;
export type HttpAccount = { userId: string; cookie: string };
export const historyHttpDb = (env as unknown as { DB: D1Database }).DB;
export const historyHttpDraft: DraftSheet = {
  name: "河港医师", raceId: "human", classId: "fighter", subclassId: "champion", backgroundId: "soldier",
  scores: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 }, extraSkillIds: [], cantrips: [], prepared: [], spellbook: [],
  equipmentChoice: 0, appearance: "带着药包的旅人", trait: "谨慎", ideal: "救助", bond: "故乡", flaw: "好奇",
};
export const historyHttpWizard: DraftSheet = { ...historyHttpDraft, name: "档案学者", raceId: "high-elf", classId: "wizard",
  subclassId: "evocation", backgroundId: "sage", scores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  cantrips: ["fire-bolt"], spellbook: ["magic-missile"], prepared: ["magic-missile"] };
export function httpRecord(value: unknown): HttpRecord {
  expect(value).not.toBeNull(); expect(typeof value).toBe("object"); expect(Array.isArray(value)).toBe(false);
  return value as HttpRecord;
}

/** Actual route handlers and request-local Vinext headers. No auth, service,
 * database, Room RPC, Rules result or publication is replaced by a test double. */
export async function historyHttpPost(command: string, data: unknown, account?: HttpAccount,
  extraHeaders: Record<string, string> = {}) {
  const request = new Request("https://zhuwei.test/api/game", { method: "POST",
    headers: { "content-type": "application/json", origin: "https://zhuwei.test",
      ...(account ? { cookie: account.cookie } : {}), ...extraHeaders }, body: JSON.stringify({ command, data }) });
  const response = await runWithHeadersContext(headersContextFromRequest(request), () => gamePost(request));
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  expect(response.headers.get("pragma")).toBe("no-cache");
  return { response, body: httpRecord(await response.json()) };
}

export async function historyHttpAccount(name: string): Promise<HttpAccount> {
  const request = new Request("https://zhuwei.test/api/auth/register", { method: "POST",
    headers: { "content-type": "application/json", origin: "https://zhuwei.test" },
    body: JSON.stringify({ name, email: `history-${crypto.randomUUID()}@example.test`, password: "local-http-fixture-password" }) });
  const response = await registerPost(request), body = httpRecord(await response.json());
  expect(response.status, JSON.stringify(body)).toBe(201);
  const setCookie = response.headers.get("set-cookie") ?? "";
  expect(setCookie).toMatch(/^__Host-zhuwei_session=/); expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("Secure"); expect(setCookie).toContain("SameSite=Lax");
  return { userId: String(httpRecord(body.user).userId), cookie: setCookie.split(";", 1)[0] };
}

/** Explicit initial Room and directory fixture. The tested operation begins
 * at the authenticated player-facing history routes, not at room creation. */
export async function historyHttpSource(owner: HttpAccount, peer?: HttpAccount) {
  const roomId = `room:history-http:${crypto.randomUUID()}`, code = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const people = peer ? [owner, peer] : [owner], stub = env.ROOMS.getByName(roomId);
  const members = people.map((person, index) => ({ principalId: person.userId, role: index === 0 ? "host" as const : "player" as const }));
  const characters = people.map((person, index) => buildAuthoritativeCharacterSeed({
    characterId: `character:history-http-original:${roomId}:${person.userId}`, controllerPrincipalId: person.userId,
    sceneId: "wake", sheet: compileSheet({ ...historyHttpDraft, name: index === 0 ? "原团旅人" : "同桌见证人" }),
    runtimeProfiles: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST,
  }));
  const initialized = await stub.initializeAuthoritative({ roomId, moduleId: "black-oak-will", moduleVersion: "social-resolution-v1",
    runtimeProfiles: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST, members, characters });
  expect(initialized, JSON.stringify(initialized)).toMatchObject({ created: true });
  if (!("created" in initialized)) throw new Error(JSON.stringify(initialized));
  await historyHttpDb.prepare(`INSERT INTO rooms (id, code, host_user_id, title, module_id, ruleset_version, kp_model,
    kp_model_profile, kp_workflow_manifest, kp_context_planner_profile, status, runtime_epoch_id, genesis_hash)
    VALUES (?, ?, ?, '河港旧团', 'black-oak-will', ?, ?, ?, ?, ?, 'play', ?, ?)`)
    .bind(roomId, code, owner.userId, AUTHORITATIVE_RULESET_VERSION, VNEXT_KP_PROFILE.modelId, VNEXT_KP_PROFILE.modelProfileVersion,
      VNEXT_KP_WORKFLOW_MANIFEST_JSON, DISABLED_CONTEXT_PLANNER_PROFILE_REF, initialized.runtimeEpochId, initialized.genesisHash).run();
  for (const [index, person] of people.entries()) {
    await historyHttpDb.batch([
      historyHttpDb.prepare("INSERT INTO room_members (room_id,user_id,nickname,is_host,seated) VALUES (?,?,?,?,1)")
        .bind(roomId, person.userId, index === 0 ? "原团旅人" : "同桌见证人", index === 0 ? 1 : 0),
      historyHttpDb.prepare("INSERT INTO characters (id,room_id,user_id,sheet,locked) VALUES (?,?,?,?,1)")
        .bind(characters[index].characterId, roomId, person.userId, JSON.stringify(compileSheet(historyHttpDraft))),
    ]);
  }
  return { roomId, code, stub, owner, peer, characters,
    principal: { principal: { id: owner.userId, sessionVersion: 1 } } };
}

/** Read the actual persisted authority solely for acceptance assertions. */
export async function historyHttpAuthority(roomId: string) {
  return runInDurableObject(env.ROOMS.getByName(roomId), (_instance, ctx) => {
    const store = new AuthoritativeRoomStore(ctx.storage), row = store.room();
    if (!row) return null;
    return { genesis: JSON.parse(row.genesis_json) as RuntimeGenesis,
      state: JSON.parse(row.state_json) as AuthoritativeWorldState, events: store.events() };
  });
}
