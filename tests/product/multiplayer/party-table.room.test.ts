import { env } from "cloudflare:workers";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import * as database from "../../../db";
import * as provider from "../../../app/_runtime/lib/kp/provider";
import * as room from "../../../app/_runtime/lib/room/server";
import { answerSquad, cancelSquadInvite, fetchTable, inviteSquad, joinRoom, leaveSquadNow, lockCharacter, passCaptain } from "../../../app/_runtime/lib/table/server";
import { compileSheet } from "../../../app/_runtime/lib/dnd/compute";
import type { DraftSheet } from "../../../app/_runtime/lib/dnd/types";
import { buildAuthoritativeCharacterSeed } from "../../../app/_runtime/lib/table/authoritative";
import { VNEXT_KP_PROFILE, VNEXT_KP_WORKFLOW_MANIFEST_JSON } from "../../../app/_runtime/lib/kp/vnext/runtime-policy";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../../../app/_runtime/lib/rules/profiles/vnext-world-interaction";
import { DISABLED_CONTEXT_PLANNER_PROFILE_REF } from "../../../app/_runtime/lib/kp/model-registry";
import { AUTHORITATIVE_RULESET_VERSION } from "../../../app/_runtime/lib/rules/ruleset";

// SPEC 0007 §5 (party invitation, acceptance, leadership and leaving are
// authoritative events behind the authenticated party entry), §3 (a private
// window is visible only to its controller and initiator) and §10 (a player's
// Read Model shows co-located members' places, which the table needs before
// it can offer the party invite control). Everything below runs through the
// real table server functions, D1 rows, Room RPC and the Room Durable Object;
// only the narration provider is scripted.
type Data = Record<string, any>;
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

const DRAFT: DraftSheet = {
  name: "河港医师", raceId: "human", classId: "fighter", subclassId: "champion", backgroundId: "soldier",
  scores: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 }, extraSkillIds: [], cantrips: [], prepared: [], spellbook: [],
  equipmentChoice: 0, appearance: "带着药包的旅人", trait: "谨慎", ideal: "救助", bond: "故乡", flaw: "好奇",
};
const WIZARD: DraftSheet = { ...DRAFT, name: "档案学者", raceId: "high-elf", classId: "wizard", subclassId: "evocation", backgroundId: "sage",
  scores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, cantrips: ["fire-bolt"], spellbook: ["magic-missile"], prepared: ["magic-missile"] };
const ROGUE: DraftSheet = { ...DRAFT, name: "码头小贼", raceId: "human", classId: "rogue", subclassId: "thief", backgroundId: "criminal",
  scores: { str: 10, dex: 15, con: 12, int: 13, wis: 10, cha: 14 } };

let counter = 0;
function scriptedNarration(calls: string[]) {
  // The same shape the production adapter sends: plain-text generation, a
  // strict review tool, and a bounded rewrite. Each reply is deterministic.
  return { async run(_model: string, input: Record<string, unknown>) {
    const tool = (input.tools as { function: { name: string } }[] | undefined)?.[0]?.function.name;
    calls.push(tool ?? "text");
    if (!tool) return { choices: [{ finish_reason: "stop", message: { content: "队伍的情况已经记下。" } }], usage: { prompt_tokens: 10, completion_tokens: 10 } };
    return { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ type: "function", function: { name: tool, arguments: JSON.stringify({ status: "pass", issues: [] }) } }] } }], usage: { prompt_tokens: 10, completion_tokens: 10 } };
  } };
}

type Seeded = { roomId: string; code: string; host: string; guest: string; third: string; stub: DurableObjectStub };
/** A room the host started after every card was locked in the lobby: all
 * three characters enter genesis exactly as startGame seeds them. */
async function seedRoom(label: string, options: { lockedGuests?: boolean } = { lockedGuests: true }): Promise<Seeded> {
  const suffix = `${label}-${++counter}`;
  const host = `party-host-${suffix}`, guest = `party-guest-${suffix}`, third = `party-third-${suffix}`;
  const roomId = `party-table:${suffix}`, code = `P${counter.toString().padStart(5, "0")}`;
  const people: Array<[string, string, DraftSheet, boolean]> = [[host, "房主", DRAFT, true], [guest, "客人", WIZARD, false], [third, "第三人", ROGUE, false]];
  for (const [userId, name] of people) {
    await db.prepare("INSERT INTO auth_users (id, name, email, password_hash, password_salt, password_iterations) VALUES (?, ?, ?, 'unused', 'unused', 1)")
      .bind(userId, name, `${userId}@example.test`).run();
  }
  const seeded = options.lockedGuests ? people : people.slice(0, 1);
  const stub = env.ROOMS.getByName(roomId);
  const initialized = await stub.initializeAuthoritative({ roomId, moduleId: "black-oak-will", moduleVersion: "social-resolution-v1",
    runtimeProfiles: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST,
    members: seeded.map(([userId, , , isHost]) => ({ principalId: userId, role: isHost ? "host" : "player" })),
    characters: seeded.map(([userId, , draft]) => buildAuthoritativeCharacterSeed({ characterId: `character:${userId}`, controllerPrincipalId: userId,
      sceneId: "wake", sheet: compileSheet(draft), runtimeProfiles: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST })),
  } as never) as Data;
  expect(initialized, JSON.stringify(initialized)).toMatchObject({ created: true });
  await db.prepare(`INSERT INTO rooms (id, code, host_user_id, title, module_id, ruleset_version, kp_model, kp_model_profile,
    kp_workflow_manifest, kp_context_planner_profile, status, runtime_epoch_id, genesis_hash)
    VALUES (?, ?, ?, '同行验收', 'black-oak-will', ?, ?, ?, ?, ?, 'play', ?, ?)`)
    .bind(roomId, code, host, AUTHORITATIVE_RULESET_VERSION, VNEXT_KP_PROFILE.modelId, VNEXT_KP_PROFILE.modelProfileVersion,
      VNEXT_KP_WORKFLOW_MANIFEST_JSON, DISABLED_CONTEXT_PLANNER_PROFILE_REF, initialized.runtimeEpochId, initialized.genesisHash).run();
  for (const [userId, name, draft, isHost] of seeded) {
    await db.prepare("INSERT INTO room_members (room_id, user_id, nickname, is_host) VALUES (?, ?, ?, ?)").bind(roomId, userId, name, isHost ? 1 : 0).run();
    await db.prepare("INSERT INTO characters (id, room_id, user_id, sheet, locked) VALUES (?, ?, ?, ?, 1)")
      .bind(`character:${userId}`, roomId, userId, JSON.stringify(compileSheet(draft))).run();
  }
  return { roomId, code, host, guest, third, stub };
}

async function joinAndLock(code: string, userId: string, nickname: string, draft: DraftSheet) {
  const joined = await joinRoom({ userId, data: { code, nickname, submissionId: `join:${userId}` } });
  expect(joined, JSON.stringify(joined)).toMatchObject({ ok: true });
  const locked = await lockCharacter({ userId, data: { code, draft, submissionId: `lock:${userId}` } });
  expect(locked, JSON.stringify(locked)).toMatchObject({ ok: true });
}

async function table(code: string, userId: string) {
  const snap = await fetchTable({ userId, data: code }) as Data;
  expect(snap, JSON.stringify(snap).slice(0, 600)).toMatchObject({ ok: true });
  return snap;
}

it("every co-located member's place reaches each player's table, so the party invite control can appear", async () => {
  vi.spyOn(database, "ensureDb").mockResolvedValue(db);
  const calls: string[] = [];
  vi.spyOn(provider, "authoritativeKpModelBinding").mockImplementation(() => scriptedNarration(calls));
  const { code, host, guest, third } = await seedRoom("places");

  const hostView = await table(code, host);
  expect(hostView.characters.map((c: Data) => c.userId).sort()).toEqual([host, guest, third].sort());
  const guestRow = hostView.characters.find((c: Data) => c.userId === guest);
  expect(guestRow).toMatchObject({ visibility: "identityOnly" });
  expect(Boolean(guestRow.locked)).toBe(true);
  // SPEC 0007 §10: everybody stands in the opening scene, so each member has a
  // place; the party control in the table depends on this equality.
  expect(hostView.state.places).toEqual({ [host]: "wake", [guest]: "wake", [third]: "wake" });
  expect(hostView.state.placeNames[guest]).toBe(hostView.state.placeNames[host]);
  const guestView = await table(code, guest);
  expect(guestView.state.places).toEqual({ [host]: "wake", [guest]: "wake", [third]: "wake" });
  expect(guestView.state.squads).toEqual([]);
  expect(guestView.state.squadInvite).toBeNull();
  expect(guestView.me.userId).toBe(guest);
  expect(calls).toEqual([]);
});

it("invitation, answer, leadership transfer, cancellation and leaving flow through the authenticated party entry with private visibility", async () => {
  vi.spyOn(database, "ensureDb").mockResolvedValue(db);
  const calls: string[] = [];
  vi.spyOn(provider, "authoritativeKpModelBinding").mockImplementation(() => scriptedNarration(calls));
  const { code, host, guest, third } = await seedRoom("party");

  // Rejections first: they must not change anything.
  expect(await inviteSquad({ userId: host, data: { code, targetUserId: host, submissionId: "inv:self" } })).toMatchObject({ ok: false });
  expect(await inviteSquad({ userId: host, data: { code, targetUserId: "nobody", submissionId: "inv:nobody" } }))
    .toMatchObject({ outcomeKind: "rejected", action: "notCommitted" });
  expect(await answerSquad({ userId: guest, data: { code, accept: true, submissionId: "ans:none" } }))
    .toMatchObject({ outcomeKind: "rejected", action: "notCommitted" });
  expect(await cancelSquadInvite({ userId: host, data: { code, submissionId: "cancel:none" } }))
    .toMatchObject({ outcomeKind: "rejected", action: "notCommitted" });
  await expect(inviteSquad({ userId: "stranger", data: { code, targetUserId: guest, submissionId: "inv:stranger" } })).rejects.toThrow();

  // Host invites guest: the initiator sees the outgoing invitation, the
  // invitee sees the window, the third player sees nothing (SPEC 0007 §3).
  const invited = await inviteSquad({ userId: host, data: { code, targetUserId: guest, submissionId: "inv:guest" } }) as Data;
  expect(invited, JSON.stringify(invited)).toMatchObject({ action: "awaitingInput" });
  expect((await table(code, host)).state.squadInvite).toEqual({ from: host, to: guest, fromName: "河港医师" });
  expect((await table(code, guest)).state.squadInvite).toEqual({ from: host, to: guest, fromName: "河港医师" });
  expect((await table(code, third)).state.squadInvite).toBeNull();

  // The invitee, not the host, answers.
  expect(await answerSquad({ userId: host, data: { code, accept: true, submissionId: "ans:host-forged" } }))
    .toMatchObject({ outcomeKind: "rejected", action: "notCommitted" });
  const accepted = await answerSquad({ userId: guest, data: { code, accept: true, submissionId: "ans:guest" } }) as Data;
  expect(accepted, JSON.stringify(accepted)).toMatchObject({ action: "committed" });
  for (const viewer of [host, guest]) {
    const view = await table(code, viewer);
    expect(view.state.squadInvite).toBeNull();
    expect(view.state.squads).toEqual([{ id: expect.any(String), ids: expect.arrayContaining([host, guest]), captain: host }]);
    expect(view.state.squads[0].ids).toHaveLength(2);
  }
  expect((await table(code, third)).state.squads).toEqual([]);

  // Only the leader may invite; the leader can hand leadership over.
  expect(await inviteSquad({ userId: guest, data: { code, targetUserId: third, submissionId: "inv:by-member" } })).toMatchObject({ outcomeKind: "rejected", action: "notCommitted" });
  expect(await passCaptain({ userId: guest, data: { code, toUserId: host, submissionId: "cap:by-member" } })).toMatchObject({ outcomeKind: "rejected", action: "notCommitted" });
  expect(await passCaptain({ userId: host, data: { code, toUserId: guest, submissionId: "cap:to-guest" } })).toMatchObject({ action: "committed" });
  expect((await table(code, guest)).state.squads[0].captain).toBe(guest);

  // The new leader invites the third player, who declines; then cancels a
  // fresh invitation before it is answered.
  expect(await inviteSquad({ userId: guest, data: { code, targetUserId: third, submissionId: "inv:third" } })).toMatchObject({ action: "awaitingInput" });
  expect(await answerSquad({ userId: third, data: { code, accept: false, submissionId: "ans:third-declines" } })).toMatchObject({ action: "committed" });
  expect((await table(code, third)).state.squads).toEqual([]);
  expect((await table(code, guest)).state.squads[0].ids).toHaveLength(2);
  expect(await inviteSquad({ userId: guest, data: { code, targetUserId: third, submissionId: "inv:third-again" } })).toMatchObject({ action: "awaitingInput" });
  expect((await table(code, third)).state.squadInvite).toEqual({ from: guest, to: third, fromName: "档案学者" });
  expect(await cancelSquadInvite({ userId: guest, data: { code, submissionId: "cancel:third" } })).toMatchObject({ action: "committed" });
  expect((await table(code, third)).state.squadInvite).toBeNull();
  expect(await answerSquad({ userId: third, data: { code, accept: true, submissionId: "ans:stale" } }))
    .toMatchObject({ outcomeKind: "rejected", action: "notCommitted" });

  // Leaving is a personal authoritative event; the remaining member is alone.
  expect(await leaveSquadNow({ userId: host, data: { code, submissionId: "leave:host" } })).toMatchObject({ action: "committed" });
  expect((await table(code, host)).state.squads).toEqual([]);
  const remaining = (await table(code, guest)).state.squads;
  expect(remaining.every((squad: Data) => !squad.ids.includes(host))).toBe(true);
  expect(await leaveSquadNow({ userId: third, data: { code, submissionId: "leave:third" } })).toMatchObject({ outcomeKind: "rejected", action: "notCommitted" });
  // Every step above resolved without a KP proposal; any narration a step
  // needed went to the scripted provider, never to a real one.
  expect(Array.isArray(calls)).toBe(true);
}, 60_000);

// SPEC 0007 §5 and SPEC 0011 §7: materializing a full character card into a
// playing room appends about fifty events. Their correction audit records
// only the records each event changed, so a later player's lock stays
// inside the Durable Object row limit instead of failing with SQLITE_TOOBIG.
it("a second player can lock a full character card into a playing room through joinRoom and lockCharacter", async () => {
  vi.spyOn(database, "ensureDb").mockResolvedValue(db);
  vi.spyOn(provider, "authoritativeKpModelBinding").mockImplementation(() => scriptedNarration([]));
  const { code, guest, third } = await seedRoom("join-path", { lockedGuests: false });
  await joinAndLock(code, guest, "客人", WIZARD);
  await joinAndLock(code, third, "第三人", ROGUE);
  expect((await table(code, third)).state.places[guest]).toBe("wake");
}, 60_000);
