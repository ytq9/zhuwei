import { env } from "cloudflare:workers";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import * as database from "../../../db";
import { fetchTable, previewArea } from "../../../app/_runtime/lib/table/server";
import { compileSheet } from "../../../app/_runtime/lib/dnd/compute";
import type { DraftSheet } from "../../../app/_runtime/lib/dnd/types";
import { buildAuthoritativeCharacterSeed } from "../../../app/_runtime/lib/table/authoritative";
import { VNEXT_KP_PROFILE, VNEXT_KP_WORKFLOW_MANIFEST_JSON } from "../../../app/_runtime/lib/kp/vnext/runtime-policy";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../../../app/_runtime/lib/rules/profiles/vnext-world-interaction";
import { DISABLED_CONTEXT_PLANNER_PROFILE_REF } from "../../../app/_runtime/lib/kp/model-registry";
import { AUTHORITATIVE_RULESET_VERSION } from "../../../app/_runtime/lib/rules/ruleset";

// SPEC 0014 §7 (ADR 0148): the map asks Rules what an area picked on it
// would reach. This runs the real table server function, D1 rows, Room RPC
// and the Room Durable Object; nothing is written and no model is called.
type Data = Record<string, any>;
const db = (env as unknown as { STORY_ARCHIVE_TEST_DB: D1Database }).STORY_ARCHIVE_TEST_DB;
const migrations = import.meta.glob<string>("/drizzle/*.sql", { eager: true, query: "?raw", import: "default" });
beforeAll(async () => {
  for (const [, sql] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
    for (const statement of sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}, 30_000);
afterEach(() => vi.restoreAllMocks());

const FIGHTER: DraftSheet = {
  name: "河港医师", raceId: "human", classId: "fighter", subclassId: "champion", backgroundId: "soldier",
  scores: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 }, extraSkillIds: [], cantrips: [], prepared: [], spellbook: [],
  equipmentChoice: 0, appearance: "带着药包的旅人", trait: "谨慎", ideal: "救助", bond: "故乡", flaw: "好奇",
};
// Fog Cloud is a 20-foot sphere at range, which the map picks by its origin.
const RANGER: DraftSheet = { ...FIGHTER, name: "林间斥候", classId: "ranger", subclassId: "hunter", backgroundId: "outlander",
  scores: { str: 10, dex: 15, con: 13, int: 10, wis: 14, cha: 8 }, prepared: ["fog", "cure", "hunters-mark"] };

// Thunderwave and Burning Hands are a cube and a cone cast from the wizard;
// Web waits for its restraint to be carried out (ADR 0149).
const WIZARD: DraftSheet = { ...FIGHTER, name: "档案学者", raceId: "high-elf", classId: "wizard", subclassId: "evocation", backgroundId: "sage",
  scores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, cantrips: ["fire-bolt"],
  spellbook: ["thunderwave", "burning-hands", "web"], prepared: ["thunderwave", "burning-hands", "web"] };

async function seedRoom(label = "room", hostDraft: DraftSheet = RANGER) {
  const host = `area-preview-host-${label}`, guest = `area-preview-guest-${label}`, roomId = `area-preview:${label}`;
  const code = `AREA${label === "room" ? "01" : "02"}`;
  const people: Array<[string, string, DraftSheet, boolean]> = [[host, "施法者", hostDraft, true], [guest, "医师", FIGHTER, false]];
  for (const [userId, name] of people) {
    await db.prepare("INSERT INTO auth_users (id, name, email, password_hash, password_salt, password_iterations) VALUES (?, ?, ?, 'unused', 'unused', 1)")
      .bind(userId, name, `${userId}@example.test`).run();
  }
  const stub = env.ROOMS.getByName(roomId);
  const initialized = await stub.initializeAuthoritative({ roomId, moduleId: "black-oak-will", moduleVersion: "social-resolution-v1",
    runtimeProfiles: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST,
    members: people.map(([userId, , , isHost]) => ({ principalId: userId, role: isHost ? "host" : "player" })),
    characters: people.map(([userId, , draft]) => buildAuthoritativeCharacterSeed({ characterId: `character:${userId}`, controllerPrincipalId: userId,
      sceneId: "wake", sheet: compileSheet(draft), runtimeProfiles: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST })),
  } as never) as Data;
  expect(initialized, JSON.stringify(initialized)).toMatchObject({ created: true });
  await db.prepare(`INSERT INTO rooms (id, code, host_user_id, title, module_id, ruleset_version, kp_model, kp_model_profile,
    kp_workflow_manifest, kp_context_planner_profile, status, runtime_epoch_id, genesis_hash)
    VALUES (?, ?, ?, '范围预览', 'black-oak-will', ?, ?, ?, ?, ?, 'play', ?, ?)`)
    .bind(roomId, code, host, AUTHORITATIVE_RULESET_VERSION, VNEXT_KP_PROFILE.modelId, VNEXT_KP_PROFILE.modelProfileVersion,
      VNEXT_KP_WORKFLOW_MANIFEST_JSON, DISABLED_CONTEXT_PLANNER_PROFILE_REF, initialized.runtimeEpochId, initialized.genesisHash).run();
  for (const [userId, name, draft, isHost] of people) {
    await db.prepare("INSERT INTO room_members (room_id, user_id, nickname, is_host) VALUES (?, ?, ?, ?)").bind(roomId, userId, name, isHost ? 1 : 0).run();
    await db.prepare("INSERT INTO characters (id, room_id, user_id, sheet, locked) VALUES (?, ?, ?, ?, 1)")
      .bind(`character:${userId}`, roomId, userId, JSON.stringify(compileSheet(draft))).run();
  }
  return { code, host, guest };
}

it("the map's area pick is previewed by Rules through the table and Room, names the creatures seen inside, and writes nothing", async () => {
  vi.spyOn(database, "ensureDb").mockResolvedValue(db);
  const { code, host, guest } = await seedRoom();
  const before = await fetchTable({ userId: host, data: code }) as Data;
  expect(before, JSON.stringify(before).slice(0, 600)).toMatchObject({ ok: true });
  const authoritative = before.state.authoritative;
  const fogCloud = (authoritative.combatControls.abilities as Data[]).find((ability) => ability.target.kind === "area");
  expect(fogCloud, JSON.stringify(authoritative.combatControls.abilities)).toBeDefined();
  expect(fogCloud!.target).toMatchObject({ kind: "area", shape: "sphere", origin: "point" });
  const tactical = authoritative.tacticalProjection;
  const companion = (tactical.visibleEntities as Data[]).find((entity) => entity.id === `character:${guest}`);
  expect(companion, JSON.stringify(tactical.visibleEntities)).toBeDefined();

  const query = { abilityRef: fogCloud!.abilityRef, origin: structuredClone(companion!.position) };
  const answered = await previewArea({ userId: host, data: { code, query } }) as Data;
  expect(answered, JSON.stringify(answered)).toMatchObject({ ok: true });
  expect(answered.preview).toMatchObject({ kind: "area", abilityRef: fogCloud!.abilityRef, origin: query.origin,
    spatialRevision: tactical.spatialRevision });
  expect(answered.preview.knownAffectedEntityIds).toContain(`character:${guest}`);
  expect(answered.preview.knownFriendlyEntityIds).toContain(`character:${guest}`);
  expect(answered.preview.readout[0]).toContain(companion!.name);
  expect(answered.preview.readout).toContain(`其中是同伴的：${companion!.name}。`);
  // The same question gets the same answer, and asking changed nothing.
  expect(await previewArea({ userId: host, data: { code, query } })).toEqual(answered);
  const after = await fetchTable({ userId: host, data: code }) as Data;
  expect(after.state.authoritative.stateVersion).toBe(authoritative.stateVersion);
  expect(after.state.authoritative.projectionHash).toBe(authoritative.projectionHash);

  // Only the player's own area abilities are previewed, in a canonical query.
  expect(await previewArea({ userId: guest, data: { code, query } })).toEqual({ ok: true, preview: null });
  expect(await previewArea({ userId: host, data: { code, query: { ...query, targetIds: [`character:${guest}`] } as never } }))
    .toMatchObject({ ok: false });
});

it("a wizard's cube and cone are in the action list and their preview starts at the wizard's edge", async () => {
  vi.spyOn(database, "ensureDb").mockResolvedValue(db);
  const { code, host, guest } = await seedRoom("wizard", WIZARD);
  const snap = await fetchTable({ userId: host, data: code }) as Data;
  expect(snap, JSON.stringify(snap).slice(0, 600)).toMatchObject({ ok: true });
  const abilities = snap.state.authoritative.combatControls.abilities as Data[];
  const areas = abilities.filter((ability) => ability.target.kind === "area");
  const shapes = [...new Set(areas.map((ability) => `${ability.name}:${ability.target.shape}:${ability.target.origin}`))].sort();
  expect(shapes).toEqual(["燃烧之手:cone:self", "雷鸣波:cube:self"]);
  expect(areas.every((ability) => ability.target.needsDirection === true && ability.target.sizeFeet === 15)).toBe(true);

  const tactical = snap.state.authoritative.tacticalProjection;
  const companion = (tactical.visibleEntities as Data[]).find((entity) => entity.id === `character:${guest}`)!;
  const self = tactical.self as Data;
  const burningHands = areas.find((ability) => ability.name === "燃烧之手")!;
  const query = { abilityRef: burningHands.abilityRef, origin: structuredClone(self.position), direction: {
    x: String(Number(companion.position.x) - Number(self.position.x)),
    y: String(Number(companion.position.y) - Number(self.position.y)), elevation: "0" } };
  const answered = await previewArea({ userId: host, data: { code, query } }) as Data;
  expect(answered, JSON.stringify(answered)).toMatchObject({ ok: true });
  expect(answered.preview.knownAffectedEntityIds).toContain(`character:${guest}`);
  expect(answered.preview.knownAffectedEntityIds).not.toContain(`character:${host}`);
  expect(answered.preview.knownSelfEffects).toEqual([]);
});
