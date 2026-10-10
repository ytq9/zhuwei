import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect } from "vitest";
import { headersContextFromRequest, runWithHeadersContext } from "vinext/shims/headers";
import { POST as gamePost } from "../../../app/api/game/route";
import { POST as registerPost } from "../../../app/api/auth/register/route";
import { compileSheet } from "../../../app/_runtime/lib/dnd/compute";
import type { DraftSheet } from "../../../app/_runtime/lib/dnd/types";
import { buildAuthoritativeCharacterSeed } from "../../../app/_runtime/lib/table/authoritative";
import { AuthoritativeRoomStore } from "../../../app/_runtime/lib/room/authority-store";
import type { AuthoritativeWorldState, RuntimeGenesis } from "../../../app/_runtime/lib/rules";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../../../app/_runtime/lib/rules/profiles/vnext-world-interaction";
import { VNEXT_KP_PROFILE, VNEXT_KP_WORKFLOW_MANIFEST_JSON, VNEXT_RULES_RUNTIME } from "../../../app/_runtime/lib/kp/vnext/runtime-policy";
import { DISABLED_CONTEXT_PLANNER_PROFILE_REF } from "../../../app/_runtime/lib/kp/model-registry";
import { AUTHORITATIVE_RULESET_VERSION } from "../../../app/_runtime/lib/rules/ruleset";
import { healingPotionItemDefinition } from "../../../app/_runtime/lib/rules/v2/items";
import { assertContainerLiveStep, carriedReferenceSeed, containerLiveSeed } from "./dynamic-object-live";
import { archiveSha256, buildAuthoritativeArchive, roomServiceCapabilities } from "../../../app/_runtime/lib/room/archive";
import { buildStoryArchive } from "../../../app/_runtime/lib/room/story-archive";
import { exportStoryArchiveHostBindings } from "../../../app/_runtime/lib/room/story-archive-host";

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
export async function historyHttpSource(owner: HttpAccount, peer?: HttpAccount,
  options: { draft?: DraftSheet; injured?: boolean; groundHealingPotion?: boolean; moduleVersion?: string; containerProbe?: boolean; carriedProbe?: boolean } = {}) {
  const roomId = `room:history-http:${crypto.randomUUID()}`, code = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const people = peer ? [owner, peer] : [owner], stub = env.ROOMS.getByName(roomId);
  const members = people.map((person, index) => ({ principalId: person.userId, role: index === 0 ? "host" as const : "player" as const }));
  const sheets = people.map((_, index) => {
    const sheet = compileSheet({ ...(index === 0 ? options.draft ?? historyHttpDraft : historyHttpDraft),
      name: index === 0 ? "原团旅人" : "同桌见证人" });
    // Declared test precondition, before genesis; never a fabricated action result.
    if (index === 0 && options.injured) sheet.hp.current = 1;
    return sheet;
  });
  const characters = people.map((person, index) => buildAuthoritativeCharacterSeed({
    // The product mints `character:<userId>` (server.ts:103) and never embeds
    // the room. Repeating roomId here made this id 123 characters, and the
    // knowledge entryRef built from it (`knowledge:<actorRef>:<knowledgeRef>`)
    // then passed the 300-character bound required-context.ts:623 enforces, so
    // every action in this fixture's rooms was rejected CONTEXT_INSUFFICIENT
    // before reaching a provider. The principal id already makes this unique.
    characterId: `character:history-http-original:${person.userId}`, controllerPrincipalId: person.userId,
    sceneId: "wake", sheet: sheets[index],
    runtimeProfiles: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST,
  }));
  const initialized = httpRecord(await stub.initializeAuthoritative({ roomId, moduleId: "black-oak-will", moduleVersion: options.moduleVersion ?? "social-resolution-v1",
    runtimeProfiles: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST, members, characters,
    ...(options.containerProbe ? { vNextSeed: containerLiveSeed(characters[0].characterId) }
      : options.carriedProbe && characters[1] !== undefined ? { vNextSeed: carriedReferenceSeed(characters[0].characterId, characters[1].characterId) } : options.groundHealingPotion ? { vNextSeed: { semanticDefinitions: [], entityDefinitionBindings: [],
      itemDefinitions: [healingPotionItemDefinition()], itemEntries: [{ definitionRef: healingPotionItemDefinition().definitionId,
        entry: { entryId: "item-entry:daily:healing-potion", quantity: 1, placement: { kind: "scene", sceneRef: "wake" },
          ownership: { kind: "unowned", ownerRef: null }, visibilityPolicyRef: "visibility:public" } }] } } : {}),
  }));
  expect(initialized, JSON.stringify(initialized)).toMatchObject({ created: true });
  if (initialized.created !== true || typeof initialized.runtimeEpochId !== "string" || !initialized.runtimeEpochId
    || typeof initialized.genesisHash !== "string" || !initialized.genesisHash) throw new Error("HTTP_FIXTURE_INITIALIZATION_INVALID");
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
        .bind(characters[index].characterId, roomId, person.userId, JSON.stringify(sheets[index])),
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

/** Continue a saved real success without another model sample. Only local
 * authentication and D1 directory data are recreated; world/StoryStore restore
 * uses the production archive validators and replay. No response is fabricated. */
export async function historyHttpRestoredContainerSource(captured: Record<string, any>, completedStep = 1) {
  const saved = captured.after, actor = captured.initial.characterId;
  // Lock down the old false test failure before spending on the next action.
  assertContainerLiveStep(captured.initial.authority, captured.initial.authority, saved, actor, completedStep);
  const replay = VNEXT_RULES_RUNTIME.replay(saved.genesis, saved.events);
  expect(replay.kind).toBe("replayed");
  if (replay.kind !== "replayed") throw new Error("PROBE_RESUME_REPLAY_INVALID");
  expect(replay.state).toEqual(saved.state);
  const receiptRefs = await Promise.all(saved.privateReceipts.map(async (row: Record<string, any>) => {
    const receipt = JSON.parse(row.receipt_json);
    return { receiptId: receipt.receiptId, rootActionId: receipt.rootActionId,
      ...(receipt.actorCharacterId === undefined ? {} : { actorCharacterId: receipt.actorCharacterId }),
      status: receipt.status, activeBranchId: receipt.activeBranchId,
      eventRange: receipt.eventRange === null ? null : { first: receipt.eventRange.first, last: receipt.eventRange.last },
      scopeVersions: receipt.scopeVersions ?? {},
      randomnessCommitmentHash: receipt.randomnessCommitmentHash ?? await archiveSha256(receipt.randomnessCommitments ?? []),
      ...(receipt.correctionId === undefined ? {} : { correctionId: receipt.correctionId }) };
  }));
  const archive = await buildAuthoritativeArchive({ roomId: saved.state.roomId, signedGenesis: saved.genesis,
    events: saved.events, receiptRefs, head: { eventSeq: replay.head.eventSeq, lastEventId: replay.head.lastEventId, activeBranchId: saved.state.activeBranchId } });
  const envelope = await buildStoryArchive({ archive, storySnapshot: saved.storyArchive.snapshot,
    hostBindings: exportStoryArchiveHostBindings({ storyArchiveHostSnapshot: () => saved.privateHost }, saved.storyArchive.snapshot),
    // The captured source contains the complete content but not its operational
    // archive revision; this newly assembled recovery envelope starts at one.
    generation: "1" });
  const roomId = saved.state.roomId, stub = env.ROOMS.getByName(roomId);
  const controls = Object.values(saved.state.characterControls) as Record<string, any>[];
  const ordered = [controls.find(control => control.characterId === actor)!, ...controls.filter(control => control.characterId !== actor)];
  expect(ordered).toHaveLength(2);
  const people: HttpAccount[] = [];
  const characters = [];
  const code = String(captured.initial.table.room.code);
  expect(code).toMatch(/^[A-F0-9]{8}$/);
  for (const [index, control] of ordered.entries()) {
    const originalPrincipal = saved.state.seats[control.seatId].principalId;
    const fresh = await historyHttpAccount(index === 0 ? "存档继续验收" : "存档同桌验收");
    // Explicit local auth fixture: retain the newly registered password and
    // session, bind it to its archived principal. Route auth is not mocked.
    await historyHttpDb.batch([
      historyHttpDb.prepare(`INSERT INTO auth_users (id,name,email,password_hash,password_salt,password_iterations)
        SELECT ?,name,?,password_hash,password_salt,password_iterations FROM auth_users WHERE id=?`)
        .bind(originalPrincipal, `recovery-${originalPrincipal}@example.test`, fresh.userId),
      historyHttpDb.prepare("UPDATE auth_sessions SET user_id=? WHERE user_id=?").bind(originalPrincipal, fresh.userId),
    ]);
    people.push({ userId: originalPrincipal, cookie: fresh.cookie });
    const sheet = compileSheet({ ...historyHttpDraft, name: saved.state.entities[control.characterId].name });
    characters.push(buildAuthoritativeCharacterSeed({ characterId: control.characterId, controllerPrincipalId: originalPrincipal,
      sceneId: saved.state.entities[control.characterId].sceneId, sheet, runtimeProfiles: saved.genesis.profiles }));
  }
  const [owner, peer] = people as [HttpAccount, HttpAccount];
  await historyHttpDb.prepare(`INSERT INTO rooms (id,code,host_user_id,title,module_id,ruleset_version,kp_model,
    kp_model_profile,kp_workflow_manifest,kp_context_planner_profile,status,runtime_epoch_id,genesis_hash)
    VALUES (?,?,?,'存档继续验收','black-oak-will',?,?,?,?,?,'play',?,?)`)
    .bind(roomId, code, owner.userId, AUTHORITATIVE_RULESET_VERSION, VNEXT_KP_PROFILE.modelId, VNEXT_KP_PROFILE.modelProfileVersion,
      VNEXT_KP_WORKFLOW_MANIFEST_JSON, DISABLED_CONTEXT_PLANNER_PROFILE_REF, saved.state.runtimeEpochId, saved.genesis.genesisHash).run();
  for (const [index, person] of people.entries()) {
    const sheet = compileSheet({ ...historyHttpDraft, name: saved.state.entities[characters[index].characterId].name });
    await historyHttpDb.batch([
      historyHttpDb.prepare("INSERT INTO room_members (room_id,user_id,nickname,is_host,seated) VALUES (?,?,?,?,1)")
        .bind(roomId, person.userId, sheet.name, index === 0 ? 1 : 0),
      historyHttpDb.prepare("INSERT INTO characters (id,room_id,user_id,sheet,locked) VALUES (?,?,?,?,1)")
        .bind(characters[index].characterId, roomId, person.userId, JSON.stringify(sheet)),
    ]);
  }
  // The restore schedules an archive alarm. Establish its local D1 directory
  // first so background archiving cannot race an absent room row.
  expect(await stub.restoreAuthoritativeArchive(roomServiceCapabilities().disasterRecovery, envelope)).toMatchObject({ kind: "restored" });
  const restored = await historyHttpAuthority(roomId);
  expect(restored?.state).toEqual(saved.state); expect(restored?.events).toEqual(saved.events);
  return { roomId, code, stub, owner, peer, characters, principal: { principal: { id: owner.userId, sessionVersion: 1 } } };
}
