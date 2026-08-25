import { authMiddleware, createServerFn } from "@/lib/platform/server-fn";
import { getSql } from "@/lib/db";
import { abilityMod, roomCode, uid } from "@/lib/utils";
import { compileSheet, ensureGear, casterMod } from "@/lib/dnd/compute";
import { applyCast, applyFeature, applyIncomingDamage, consumeAmmo, dropConcentration, ensureResources, left, longRestSheet, matchSpell, shortRestSheet, spendCharge, spendHitDie, spendHitDice, wantsRest, type FeatId } from "@/lib/dnd/resources";
import type { CharacterSheet, DraftSheet, SkillId } from "@/lib/dnd/types";
import { SKILLS } from "@/lib/dnd/types";
import { acFromGear, stowSlot, wearItem, type GearSlot } from "@/lib/dnd/gear";
import { classById, spellById } from "@/lib/dnd/catalog";
import { d20, d4, eligibleBoosts, rollKind, type BoostId } from "@/lib/dnd/boosts";
import { getModule, listModules } from "@/lib/module";
import { publicNpc } from "@/lib/module/schema";
import type { PendingRoll } from "@/lib/kp/prompt";
import { kpModelConfigurationError, readClueLayer, runKpTurn, KP_BUSY_MSG } from "@/lib/kp/engine";
import { publicPendingRoll } from "@/lib/kp/clue-state";
import { DEFAULT_KP_MODEL, isKpModelId, type KpModelId } from "@/lib/kp/models";
import { projectLocationMessages } from "@/lib/table/message-projection";
import { openingStances } from "@/lib/kp/stance";
import { placeOf, readWhere } from "@/lib/kp/where";
import { publicClocks, readClocks, readRestHold, restRemain, REST_BEATS, clockOf } from "@/lib/kp/clock";
import { isPlaceBusy, sweepBusyPlaces } from "@/lib/kp/busy";
import {
  joinSquad,
  leaveSquad,
  matesOf,
  readSquadInvite,
  readSquadQueue,
  readSquads,
  squadOf,
  squadRecord,
  isCaptain,
  transferCaptain,
  sweepSquadInvite,
} from "@/lib/kp/squad";
import {
  applyInit,
  asCombat,
  coverAc,
  hurtNpc,
  joinCombat as joinCombatState,
  leaveCombat as applyLeave,
  dropFromCombat,
  nextTurn,
  publicCombat,
  rollDiceExpr,
  shotCheck,
  spendCost,
  weaponAttack,
  type LeaveKind,
} from "@/lib/kp/combat";

function spellTimeIsBonus(id: string) {
  return Boolean(spellById(id)?.time?.includes("附赠"));
}

function asJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

async function memberOf(roomId: string, userId: string) {
  const sql = await getSql();
  const rows = await sql<{ is_host: boolean; nickname: string }>`
    select is_host, nickname from room_members
    where room_id = ${roomId} and user_id = ${userId}
  `;
  if (!rows[0]) throw new Error("你不在这一桌");
  return rows[0];
}

async function roomByCode(code: string) {
  const sql = await getSql();
  const rows = await sql<{ id: string; code: string }>`
    select id, code from rooms where code = ${code.toUpperCase()}
  `;
  return rows[0] ?? null;
}

type RestVote = {
  kind: "short" | "long";
  from: string;
  fromName: string;
  agreed: string[];
  hitDice: Record<string, number>;
  arcane: Record<string, number>;
};

function readRestVote(flags: Record<string, unknown>): RestVote | null {
  const raw = flags.restVote;
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Partial<RestVote>;
  if (v.kind !== "short" && v.kind !== "long") return null;
  if (!v.from) return null;
  return {
    kind: v.kind,
    from: String(v.from),
    fromName: String(v.fromName ?? ""),
    agreed: Array.isArray(v.agreed) ? v.agreed.map(String) : [],
    hitDice:
      v.hitDice && typeof v.hitDice === "object" ? (v.hitDice as Record<string, number>) : {},
    arcane:
      v.arcane && typeof v.arcane === "object" ? (v.arcane as Record<string, number>) : {},
  };
}

async function writeFlags(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
  flags: Record<string, unknown>,
) {
  await sql`
    update game_states
    set npc_flags = ${JSON.stringify(flags)}::jsonb, updated_at = now()
    where room_id = ${roomId}
  `;
}

async function settleRest(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
  kind: "short" | "long",
  actorUserId: string,
  actorName: string,
  vote: RestVote,
) {
  const kp = await runKpTurn({
    roomId,
    actorUserId,
    actorName,
    action: `全员已同意${kind === "long" ? "长休（过夜）" : "短休（约一小时）"}。若此地仍有明确敌对或马上要出事，hat=refuse 并说明为什么不能歇。若可以歇，hat=narrate。不要改人物数字，休整由程序结算。`,
    kind: "action",
  });
  if (!kp.ok) return { ok: false as const, error: kp.error };
  if (kp.hat === "refuse") return { ok: true as const };
  const rows = await seatedLocked(sql, roomId);
  for (const row of rows) {
    if (!vote.agreed.includes(row.user_id)) continue;
    let sheet = ensureGear(asJson<CharacterSheet>(row.sheet, {} as CharacterSheet));
    const who = sheet.name || row.user_id;
    if (kind === "long") {
      const done = longRestSheet(sheet);
      sheet = done.sheet;
      await sql`
        update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
        where room_id = ${roomId} and user_id = ${row.user_id}
      `;
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body)
        values (${uid("msg")}, ${roomId}, null, ${"narrate"}, ${"KP"}, ${`${who}：${done.note}`})
      `;
    } else {
      const arcane = (vote.arcane[row.user_id] ?? 0) as 0 | 1 | 2;
      sheet = shortRestSheet(sheet, arcane);
      const n = Math.max(0, vote.hitDice[row.user_id] ?? 0);
      const spent = n ? spendHitDice(sheet, n) : { sheet, note: "没有花生命骰。" };
      sheet = spent.sheet;
      await sql`
        update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
        where room_id = ${roomId} and user_id = ${row.user_id}
      `;
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body)
        values (${uid("msg")}, ${roomId}, null, ${"narrate"}, ${"KP"}, ${`${who} 短休结束。引导、如潮、回气、战术骰已恢复。${spent.note} 生命 ${sheet.hp.current}/${sheet.hp.max}。`})
      `;
    }
  }
  return { ok: true as const };
}

async function requestRestInner(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
  _code: string,
  userId: string,
  name: string,
  kind: "short" | "long",
  text: string,
  opts?: { hitDice?: number; arcane?: 0 | 1 | 2 },
) {
  const st = (
    await sql<{ combat: unknown; npc_flags: unknown }>`
      select combat, npc_flags from game_states where room_id = ${roomId}
    `
  )[0];
  if (asCombat(st?.combat)) {
    return { ok: false as const, error: "战斗中不能休整" };
  }
  const locked = await seatedLocked(sql, roomId);
  const flags = asJson<Record<string, unknown>>(st?.npc_flags, {});
  let vote = readRestVote(flags);

  await sql`
    insert into messages (id, room_id, user_id, kind, name, body)
    values (${uid("msg")}, ${roomId}, ${userId}, ${"say"}, ${name}, ${text})
  `;

  if (locked.length <= 1) {
    const alone: RestVote = {
      kind,
      from: userId,
      fromName: name,
      agreed: [userId],
      hitDice: { [userId]: opts?.hitDice ?? 0 },
      arcane: { [userId]: opts?.arcane ?? 0 },
    };
    return settleRest(sql, roomId, kind, userId, name, alone);
  }

  if (vote && vote.kind !== kind) {
    return {
      ok: false as const,
      error: `桌上正在表决${vote.kind === "long" ? "长休" : "短休"}。先反对或等它结束。`,
    };
  }

  if (!vote) {
    vote = {
      kind,
      from: userId,
      fromName: name,
      agreed: [userId],
      hitDice: { [userId]: opts?.hitDice ?? 0 },
      arcane: { [userId]: opts?.arcane ?? 0 },
    };
    flags.restVote = vote;
    await writeFlags(sql, roomId, flags);
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body)
      values (
        ${uid("msg")}, ${roomId}, null, ${"narrate"}, ${"KP"},
        ${`${name} 提议${kind === "long" ? "长休过夜" : "短休约一小时"}。全员同意才会开始。`}
      )
    `;
    return { ok: true as const };
  }

  if (!vote.agreed.includes(userId)) vote.agreed = [...vote.agreed, userId];
  vote.hitDice = { ...vote.hitDice, [userId]: opts?.hitDice ?? vote.hitDice[userId] ?? 0 };
  vote.arcane = { ...vote.arcane, [userId]: opts?.arcane ?? vote.arcane[userId] ?? 0 };

  if (vote.agreed.length < locked.length) {
    flags.restVote = vote;
    await writeFlags(sql, roomId, flags);
    const waiting = locked
      .filter((r) => !vote!.agreed.includes(r.user_id))
      .map((r) => asJson<CharacterSheet>(r.sheet, {} as CharacterSheet).name || "同伴");
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body)
      values (
        ${uid("msg")}, ${roomId}, null, ${"narrate"}, ${"KP"},
        ${`${name} 同意${kind === "long" ? "长休" : "短休"}。还等：${waiting.join("、")}。`}
      )
    `;
    return { ok: true as const };
  }

  delete flags.restVote;
  const whereNow = readWhere(flags);
  const sceneId = (
    await sql<{ scene_id: string }>`select scene_id from game_states where room_id = ${roomId}`
  )[0]?.scene_id ?? "wake";
  const proposerPlace = placeOf(whereNow, vote.from, sceneId);
  const resters = locked
    .filter((r) => placeOf(whereNow, r.user_id, sceneId) === proposerPlace)
    .map((r) => r.user_id);
  const actives = locked.filter((r) => !resters.includes(r.user_id));
  if (!actives.length) {
    await writeFlags(sql, roomId, flags);
    return settleRest(sql, roomId, kind, userId, name, { ...vote, agreed: resters });
  }
  const clocks = readClocks(flags);
  const startBeats = Math.max(
    0,
    ...locked.map((r) => clockOf(clocks, r.user_id).beats),
  );
  const needBeats = REST_BEATS[kind];
  flags.restHold = {
    kind,
    resters,
    fromName: vote.fromName,
    startBeats,
    needBeats,
    hitDice: vote.hitDice,
    arcane: vote.arcane,
  };
  await writeFlags(sql, roomId, flags);
  const resterNames = resters.map(
    (id) =>
      asJson<CharacterSheet>(
        locked.find((r) => r.user_id === id)?.sheet,
        {} as CharacterSheet,
      ).name || "同伴",
  );
  await sql`
    insert into messages (id, room_id, user_id, kind, name, body, meta)
    values (
      ${uid("msg")}, ${roomId}, null, ${"narrate"}, ${"KP"},
      ${`${resterNames.join("、")} 开始${kind === "long" ? "长休" : "短休"}（${needBeats} 拍）。另一边可以继续行动；走满 ${needBeats} 拍后休息结束，时间对齐。`},
      ${JSON.stringify({ place: "all" })}::jsonb
    )
  `;
  return { ok: true as const };
}

async function cancelRestInner(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
  userId: string,
  name: string,
) {
  const st = (
    await sql<{ npc_flags: unknown }>`
      select npc_flags from game_states where room_id = ${roomId}
    `
  )[0];
  const flags = asJson<Record<string, unknown>>(st?.npc_flags, {});
  const vote = readRestVote(flags);
  const hold = readRestHold(flags);
  if (!vote && !hold) return { ok: false as const, error: "现在没有休整要表决" };
  delete flags.restVote;
  delete flags.restHold;
  await writeFlags(sql, roomId, flags);
  await sql`
    insert into messages (id, room_id, user_id, kind, name, body)
    values (
      ${uid("msg")}, ${roomId}, ${userId}, ${"say"}, ${name}, ${"不同意这次休整"}
    )
  `;
  await sql`
    insert into messages (id, room_id, user_id, kind, name, body, meta)
    values (
      ${uid("msg")}, ${roomId}, null, ${"narrate"}, ${"KP"},
      ${`${name} 打断了${(hold ?? vote)?.kind === "long" ? "长休" : "短休"}。时间没有为休息过去。`},
      ${JSON.stringify({ place: "all" })}::jsonb
    )
  `;
  return { ok: true as const };
}

export const listMyRooms = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    return sql<{
      id: string;
      code: string;
      title: string;
      status: string;
      is_host: boolean;
      created_at: string;
    }>`
      select r.id, r.code, r.title, r.status, m.is_host, r.created_at
      from rooms r
      join room_members m on m.room_id = r.id
      where m.user_id = ${context.userId}
      order by r.created_at desc
      limit 20
    `;
  });

export const getCatalog = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ modules: listModules() }));

export const createRoom = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { nickname: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const id = uid("room");
    let code = roomCode();
    for (let i = 0; i < 6; i++) {
      const exists = await sql<{ code: string }>`select code from rooms where code = ${code}`;
      if (!exists[0]) break;
      code = roomCode();
    }
    const nick = data.nickname.trim().slice(0, 16) || "房主";
    await sql`
      insert into rooms (id, code, host_user_id, title, module_id, kp_model, status)
      values (${id}, ${code}, ${context.userId}, ${"黑橡居酒屋的第三份遗嘱"}, ${"black-oak-will"}, ${DEFAULT_KP_MODEL}, ${"lobby"})
    `;
    await sql`
      insert into room_members (room_id, user_id, nickname, is_host)
      values (${id}, ${context.userId}, ${nick}, true)
    `;
    await sql`
      insert into game_states (room_id, chapter_id, scene_id)
      values (${id}, ${"ch1"}, ${"wake"})
    `;
    return { ok: true as const, code };
  });

export const joinRoom = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; nickname: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const sql = await getSql();
    const existing = await sql<{ user_id: string }>`
      select user_id from room_members where room_id = ${room.id} and user_id = ${context.userId}
    `;
    if (existing[0]) return { ok: true as const, code: room.code };
    const count = await sql<{ n: number }>`
      select count(*)::int as n from room_members where room_id = ${room.id}
    `;
    if ((count[0]?.n ?? 0) >= 5) return { ok: false as const, error: "这桌已经满了" };
    const nick = data.nickname.trim().slice(0, 16) || "冒险者";
    await sql`
      insert into room_members (room_id, user_id, nickname, is_host)
      values (${room.id}, ${context.userId}, ${nick}, false)
    `;
    await reseatPlayer(sql, room.id, context.userId);
    return { ok: true as const, code: room.code };
  });

export const fetchTable = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: string) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const sql = await getSql();
    const meRow = (
      await sql<{ is_host: boolean; nickname: string }>`
        select is_host, nickname from room_members
        where room_id = ${room.id} and user_id = ${context.userId}
      `
    )[0];
    if (!meRow) {
      return {
        ok: false as const,
        left: true as const,
        error: "你已离开这一桌。人物卡还留着，用房间码可以再进来。",
      };
    }
    const me = meRow;
    const info = (
      await sql<{
        id: string;
        code: string;
        title: string;
        status: string;
        module_id: string;
        kp_model: KpModelId;
      }>`
        select id, code, title, status, module_id, kp_model from rooms where id = ${room.id}
      `
    )[0];
    const members = await sql<{
      user_id: string;
      nickname: string;
      is_host: boolean;
    }>`
      select user_id, nickname, is_host from room_members
      where room_id = ${room.id}
      order by joined_at asc
    `;
    const characters = await sql<{
      user_id: string;
      locked: boolean;
      sheet: unknown;
    }>`
      select c.user_id, c.locked, c.sheet
      from characters c
      join room_members m on m.room_id = c.room_id and m.user_id = c.user_id
      where c.room_id = ${room.id}
    `;
    const messages = await sql<{
      id: string;
      user_id: string | null;
      kind: string;
      name: string;
      body: string;
      tts_text: string | null;
      meta: unknown;
      created_at: string;
    }>`
      select id, user_id, kind, name, body, tts_text, meta, created_at
      from (
        select rowid, id, user_id, kind, name, body, tts_text, meta, created_at
        from messages where room_id = ${room.id}
        order by rowid desc
        limit 400
      )
      order by rowid asc
    `;
    const logs = await sql<{ id: string; entry: string; created_at: string }>`
      select id, entry, created_at from session_logs
      where room_id = ${room.id}
      order by created_at asc
      limit 80
    `;
    const st = (
      await sql<{
        chapter_id: string;
        scene_id: string;
        revealed_clues: unknown;
        npc_flags: unknown;
        combat: unknown;
        pending_rolls: unknown;
        kp_busy: boolean;
      }>`
        select chapter_id, scene_id, revealed_clues, npc_flags, combat, pending_rolls, kp_busy
        from game_states where room_id = ${room.id}
      `
    )[0];
    const module = getModule(info.module_id);
    const revealedIds = asJson<string[]>(st?.revealed_clues, []);
    const flags = asJson<Record<string, unknown>>(st?.npc_flags, {});
    if (sweepBusyPlaces(flags)) {
      void writeFlags(sql, room.id, flags);
    }
    const myPlace = placeOf(readWhere(flags), context.userId, st?.scene_id ?? "wake");
    const visitedRaw = flags.visited;
    const visited: string[] = Array.isArray(
      visitedRaw && typeof visitedRaw === "object"
        ? (visitedRaw as Record<string, unknown>)[context.userId]
        : null,
    )
      ? ((visitedRaw as Record<string, string[]>)[context.userId] ?? [])
      : [myPlace];
    const clueLayer = readClueLayer(flags);
    const clues = module.clues
      .filter((c) => revealedIds.includes(c.id))
      .map((c) => {
        const layer = clueLayer[c.id] ?? "full";
        return {
          id: c.id,
          name: c.name,
          text: layer === "full" ? c.playerText : c.talkText,
          hint: c.hint,
          layer,
        };
      });
    const where = readWhere(flags);
    const allScenes = module.chapters.flatMap((c) => c.scenes);
    const labelOf = (id: string) => {
      const s = allScenes.find((x) => x.id === id);
      if (s?.location) return s.location;
      if (s?.name) return s.name;
      return id;
    };
    const placeNames: Record<string, string> = {};
    for (const c of characters) {
      const pid = placeOf(where, c.user_id, st?.scene_id ?? "wake");
      placeNames[c.user_id] = labelOf(pid);
    }
    const myPlaceIds = new Set(
      characters.map((c) => placeOf(where, c.user_id, st?.scene_id ?? "wake")),
    );
    const partySplit = myPlaceIds.size > 1;
    const chapter = module.chapters.find((c) => c.id === st?.chapter_id);
    const scene = chapter?.scenes.find((s) => s.id === st?.scene_id);
    const sceneHere =
      module.chapters.flatMap((c) => c.scenes).find((s) => s.id === myPlace) ?? scene;
    const metIds = Array.isArray(flags.met)
      ? flags.met.map(String)
      : (sceneHere?.npcs ?? []);
    const npcs = module.npcs
      .filter((n) => metIds.includes(n.id))
      .filter((n) => !sceneHere || sceneHere.npcs.includes(n.id))
      .map(publicNpc);
    const locationLabels = Object.fromEntries(
      allScenes.map((scene) => [scene.id, scene.location || scene.name || scene.id]),
    );
    const projectedMessages = projectLocationMessages({
      rows: messages,
      userId: context.userId,
      currentPlace: myPlace,
      visitedPlaces: visited.length ? visited : [myPlace],
      labels: locationLabels,
      userNames: [
        me.nickname,
        ensureGear(
          asJson<CharacterSheet>(
            characters.find((character) => character.user_id === context.userId)?.sheet,
            {} as CharacterSheet,
          ),
        ).name,
      ].filter(Boolean),
    });
    const publicMessage = (m: (typeof messages)[number]) => {
      const meta = asJson<Record<string, unknown>>(m.meta, {});
      const raw = Array.isArray(meta.clues) ? meta.clues : [];
      const pinned = raw
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const o = row as { id?: string; name?: string; hint?: string };
          if (!o.id || !o.name || !o.hint) return null;
          return { id: String(o.id), name: String(o.name), hint: String(o.hint) };
        })
        .filter((clue): clue is { id: string; name: string; hint: string } => Boolean(clue));
      return {
        id: m.id,
        user_id: m.user_id,
        kind: m.kind,
        name: m.name,
        body: m.body,
        created_at: m.created_at,
        clues: pinned,
      };
    };

    return {
      ok: true as const,
      me: { userId: context.userId, ...me },
      room: info,
      members,
      characters: characters.map((c) => ({
        userId: c.user_id,
        locked: c.locked,
        sheet: ensureGear(asJson<CharacterSheet>(c.sheet, {} as CharacterSheet)),
      })),
      messages: projectedMessages.current.map(publicMessage),
      locationThreads: projectedMessages.history.map((thread) => ({
        placeId: thread.placeId,
        name: thread.name,
        messages: thread.messages.map(publicMessage),
      })),
      logs,
      state: {
        chapterName: chapter?.name ?? "第一章",
        sceneName: sceneHere?.name ?? scene?.name ?? "开场",
        kpBusy: isPlaceBusy(flags, myPlace),
        pendingRolls: asJson<PendingRoll[]>(st?.pending_rolls, []).map(publicPendingRoll),
        clues,
        npcs,
        sceneId: st?.scene_id ?? "wake",
        places: Object.fromEntries(
          characters.map((c) => [
            c.user_id,
            placeOf(where, c.user_id, st?.scene_id ?? "wake"),
          ]),
        ),
        placeNames,
        partySplit,
        clocks: publicClocks(
          readClocks(flags),
          characters.map((c) => c.user_id),
        ),
        restVote: (() => {
          const v = readRestVote(flags);
          if (!v) return null;
          const lockedIds = characters.filter((c) => c.locked).map((c) => c.user_id);
          const waiting = lockedIds.filter((id) => !v.agreed.includes(id));
          return {
            kind: v.kind,
            fromName: v.fromName,
            agreed: v.agreed,
            waiting,
          };
        })(),
        restHold: (() => {
          const h = readRestHold(flags);
          if (!h) return null;
          return {
            kind: h.kind,
            resters: h.resters,
            fromName: h.fromName,
            needBeats: h.needBeats,
            remain: restRemain(h, readClocks(flags), characters.map((c) => c.user_id)),
          };
        })(),
        squads: readSquads(flags).map((s) => ({
          ids: s.ids,
          captain: s.captain,
        })),
        squadInvite: (() => {
          if (sweepSquadInvite(flags)) {
            void writeFlags(sql, room.id, flags);
            return null;
          }
          return readSquadInvite(flags);
        })(),
        squadQueue: (() => {
          const mine = squadRecord(readSquads(flags), context.userId);
          if (!mine) return [];
          return readSquadQueue(flags).filter((q) => mine.ids.includes(q.userId));
        })(),
        combat: publicCombat(asCombat(st?.combat)),
      },
      module: {
        title: module.title,
        chapters: module.chapters.map((c) => ({ id: c.id, name: c.name })),
      },
    };
  });

export const setRoomModel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; model: string }) => input)
  .handler(async ({ context, data }) => {
    if (!isKpModelId(data.model)) {
      return { ok: false as const, error: "这个模型不在本桌支持范围内" };
    }
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const me = await memberOf(room.id, context.userId);
    if (!me.is_host) return { ok: false as const, error: "只有房主能选择模型" };
    const sql = await getSql();
    await sql`
      update rooms set kp_model = ${data.model}
      where id = ${room.id} and host_user_id = ${context.userId} and status = ${"lobby"}
    `;
    const current = (
      await sql<{ status: string; kp_model: string }>`
        select status, kp_model from rooms where id = ${room.id}
      `
    )[0];
    if (current.status !== "lobby") {
      return { ok: false as const, error: "守灵已经开始，整桌模型不能再更换" };
    }
    if (current.kp_model !== data.model) {
      return { ok: false as const, error: "模型没有保存，请再试一次" };
    }
    return { ok: true as const, model: data.model };
  });

export const lockCharacter = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; draft: DraftSheet }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sheet = compileSheet(data.draft);
    const sql = await getSql();
    const existing = await sql<{ id: string; locked: boolean }>`
      select id, locked from characters
      where room_id = ${room.id} and user_id = ${context.userId}
    `;
    if (existing[0]?.locked) {
      return { ok: false as const, error: "人物卡已经锁定" };
    }
    if (existing[0]) {
      await sql`
        update characters
        set sheet = ${JSON.stringify(sheet)}::jsonb, locked = true, updated_at = now()
        where id = ${existing[0].id}
      `;
    } else {
      await sql`
        insert into characters (id, room_id, user_id, sheet, locked)
        values (${uid("pc")}, ${room.id}, ${context.userId}, ${JSON.stringify(sheet)}::jsonb, true)
      `;
    }
    return { ok: true as const, sheet };
  });

export const setGear = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      code: string;
      action: "wear" | "stow";
      slot: GearSlot;
      itemId?: string;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const row = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId}
      `
    )[0];
    if (!row) return { ok: false as const, error: "还没有人物卡" };
    const sheet = ensureGear(asJson<CharacterSheet>(row.sheet, {} as CharacterSheet));
    const equipped = sheet.equipped ?? {};
    const backpack = sheet.backpack ?? [];
    const next =
      data.action === "stow"
        ? stowSlot(equipped, backpack, data.slot)
        : wearItem(equipped, backpack, data.itemId ?? "", data.slot);
    if ("error" in next && next.error) {
      return { ok: false as const, error: next.error };
    }
    sheet.equipped = next.equipped;
    sheet.backpack = next.backpack;
    sheet.ac = acFromGear(sheet.classId, sheet.scores, sheet.equipped);
    await sql`
      update characters
      set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
      where room_id = ${room.id} and user_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const startGame = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: string) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const me = await memberOf(room.id, context.userId);
    if (!me.is_host) return { ok: false as const, error: "只有房主能开始" };
    const sql = await getSql();
    const info = (
      await sql<{ status: string; module_id: string; kp_model: string }>`
        select status, module_id, kp_model from rooms where id = ${room.id}
      `
    )[0];
    if (info.status === "play") return { ok: true as const };
    if (!isKpModelId(info.kp_model)) {
      return { ok: false as const, error: "本桌选择的模型已不可用，请重新选择" };
    }
    const modelError = kpModelConfigurationError(info.kp_model);
    if (modelError) return { ok: false as const, error: modelError };
    const module = getModule(info.module_id);
    const opening = module.chapters[0]?.scenes[0]?.boxedText ?? "蜡烛亮了。你们可以问、看、或动手。";
    const openingNpcs = module.chapters[0]?.scenes[0]?.npcs ?? [];
    const openingScene = module.chapters[0]?.scenes[0]?.id ?? "wake";
    const seated = await sql<{ user_id: string }>`
      select user_id from room_members where room_id = ${room.id}
    `;
    const where: Record<string, string> = {};
    const visited: Record<string, string[]> = {};
    for (const s of seated) {
      where[s.user_id] = openingScene;
      visited[s.user_id] = [openingScene];
    }
    await sql`update rooms set status = ${"play"} where id = ${room.id} and host_user_id = ${context.userId}`;
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, tts_text, meta)
      values (
        ${uid("msg")}, ${room.id}, null, ${"open"}, ${"KP"}, ${opening}, ${opening},
        ${JSON.stringify({ hat: "narrate" })}::jsonb
      )
    `;
    await sql`
      insert into session_logs (id, room_id, entry)
      values (${uid("log")}, ${room.id}, ${"守灵夜开始。"})
    `;
    await sql`
      update game_states
      set npc_flags = ${JSON.stringify({
        met: openingNpcs,
        stance: openingStances(module.npcs),
        where,
        visited,
      })}::jsonb, updated_at = now()
      where room_id = ${room.id}
    `;
    return { ok: true as const };
  });

export const sendAction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; text: string }) => input)
  .handler(async ({ context, data }) => {
    const text = data.text.trim();
    if (!text) return { ok: false as const, error: "空话不会进桌" };
    if (text.length > 1200) return { ok: false as const, error: "太长了，拆开说" };
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const me = await memberOf(room.id, context.userId);
    const sql = await getSql();
    const info = (
      await sql<{ status: string }>`
        select status from rooms where id = ${room.id}
      `
    )[0];
    if (info.status !== "play") return { ok: false as const, error: "这一桌还没开团" };
    const pc = (
      await sql<{ sheet: unknown; locked: boolean }>`
        select sheet, locked from characters
        where room_id = ${room.id} and user_id = ${context.userId}
      `
    )[0];
    if (!pc?.locked) return { ok: false as const, error: "先锁定人物卡" };
    let sheet = ensureGear(asJson<CharacterSheet>(pc.sheet, {} as CharacterSheet));
    const name = sheet.name || me.nickname || "冒险者";
    const flagsNow = asJson<Record<string, unknown>>(
      (
        await sql<{ npc_flags: unknown }>`
          select npc_flags from game_states where room_id = ${room.id}
        `
      )[0]?.npc_flags,
      {},
    );
    const squadsNow = readSquads(flagsNow);
    const mySquad = squadRecord(squadsNow, context.userId);
    if (mySquad && mySquad.captain !== context.userId) {
      const clocks = readClocks(flagsNow);
      const item = {
        id: uid("q"),
        userId: context.userId,
        name,
        body: text,
        beat: clockOf(clocks, mySquad.captain).beats,
      };
      flagsNow.squadQueue = [...readSquadQueue(flagsNow), item];
      await writeFlags(sql, room.id, flagsNow);
      return { ok: true as const, queued: true as const };
    }
    const restKind = wantsRest(text);
    const flagRow = (
      await sql<{ npc_flags: unknown }>`
        select npc_flags from game_states where room_id = ${room.id}
      `
    )[0];
    const voteNow = readRestVote(asJson<Record<string, unknown>>(flagRow?.npc_flags, {}));
    if (restKind) {
      return requestRestInner(sql, room.id, data.code, context.userId, name, restKind, text);
    }
    if (voteNow && /不同意|反对/.test(text) && /休|歇/.test(text)) {
      return cancelRestInner(sql, room.id, context.userId, name);
    }
    const holdNow = readRestHold(asJson<Record<string, unknown>>(flagRow?.npc_flags, {}));
    if (holdNow && /醒来|打断.*休|结束休息/.test(text)) {
      return cancelRestInner(sql, room.id, context.userId, name);
    }
    if (
      voteNow &&
      /同意/.test(text) &&
      /休|歇/.test(text) &&
      !/不同意/.test(text)
    ) {
      return requestRestInner(
        sql,
        room.id,
        data.code,
        context.userId,
        name,
        voteNow.kind,
        text,
      );
    }
    if (/进入狂暴|我狂暴/.test(text)) {
      const feat = applyFeature(sheet, "rage");
      if (!feat.ok) return { ok: false as const, error: feat.error };
      sheet = feat.sheet;
      await sql`
        update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
        where room_id = ${room.id} and user_id = ${context.userId}
      `;
    } else if (/动作如潮/.test(text)) {
      const feat = applyFeature(sheet, "surge");
      if (!feat.ok) return { ok: false as const, error: feat.error };
      sheet = feat.sheet;
      await sql`
        update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
        where room_id = ${room.id} and user_id = ${context.userId}
      `;
      const stC = (
        await sql<{ combat: unknown }>`select combat from game_states where room_id = ${room.id}`
      )[0];
      const combat = asCombat(stC?.combat);
      if (combat) {
        const meC = combat.order.find((o) => o.id === context.userId);
        if (meC) {
          const next = {
            ...combat,
            order: combat.order.map((o) =>
              o.id === context.userId
                ? { ...o, spend: { ...(o.spend ?? { action: false, bonus: true, reaction: true, attacked: false }), action: true } }
                : o,
            ),
          };
          await sql`
            update game_states set combat = ${JSON.stringify(next)}::jsonb where room_id = ${room.id}
          `;
        }
      }
    } else {
      const sp = matchSpell(text);
      if (sp && /施放|使用|给自己|祝福|治愈|神导|光亮|侦测|命令|致伤|神圣火焰|护盾/.test(text)) {
        const slot = /二环|2环/.test(text) ? 2 : undefined;
        const cast = applyCast(sheet, sp.id, slot);
        if (!cast.ok) return { ok: false as const, error: cast.error };
        sheet = cast.sheet;
        await sql`
          update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
          where room_id = ${room.id} and user_id = ${context.userId}
        `;
        const stC = (
          await sql<{ combat: unknown }>`select combat from game_states where room_id = ${room.id}`
        )[0];
        const combat = asCombat(stC?.combat);
        if (combat?.order.some((o) => o.id === context.userId && o.inCombat)) {
          const cost = spellTimeIsBonus(sp.id) ? "bonus" : "action";
          const spent = spendCost(combat, context.userId, cost);
          if (!spent.ok) {
            return { ok: false as const, error: spent.error };
          }
          await sql`
            update game_states set combat = ${JSON.stringify(spent.combat)}::jsonb where room_id = ${room.id}
          `;
        }
      }
    }
    const flagsSay = (
      await sql<{ npc_flags: unknown; scene_id: string }>`
        select npc_flags, scene_id from game_states where room_id = ${room.id}
      `
    )[0];
    const sayPlace = placeOf(
      readWhere(asJson<Record<string, unknown>>(flagsSay?.npc_flags, {})),
      context.userId,
      flagsSay?.scene_id ?? "wake",
    );
    const sayWhere = readWhere(asJson<Record<string, unknown>>(flagsSay?.npc_flags, {}));
    const sayMembers = await sql<{ user_id: string }>`
      select user_id from room_members where room_id = ${room.id}
    `;
    const sayAudience = sayMembers
      .filter(
        (member) =>
          placeOf(sayWhere, member.user_id, flagsSay?.scene_id ?? "wake") === sayPlace,
      )
      .map((member) => member.user_id);
    const sayId = uid("msg");
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, meta)
      values (
        ${sayId}, ${room.id}, ${context.userId}, ${"say"}, ${name}, ${text},
        ${JSON.stringify({ place: sayPlace, audience: sayAudience })}::jsonb
      )
    `;
    let lastErr = KP_BUSY_MSG;
    for (let i = 0; i < 8; i++) {
      const kp = await runKpTurn({
        roomId: room.id,
        actorUserId: context.userId,
        actorName: name,
        action: text,
        kind: "action",
        consumeSayId: sayId,
      });
      if (kp.ok) return { ok: true as const };
      lastErr = kp.error;
      if (kp.error !== KP_BUSY_MSG) return { ok: false as const, error: kp.error };
      await new Promise((r) => setTimeout(r, 700));
    }
    return { ok: false as const, error: lastErr };
  });

export const resolveRoll = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; rollId: string; boostIds?: string[] }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const st = (
      await sql<{ pending_rolls: unknown; kp_busy: boolean }>`
        select pending_rolls, kp_busy from game_states where room_id = ${room.id}
      `
    )[0];
    const rolls = asJson<PendingRoll[]>(st.pending_rolls, []);
    const roll = rolls.find((r) => r.id === data.rollId);
    if (!roll) return { ok: false as const, error: "没有这个检定" };
    if (roll.userId !== context.userId) {
      return { ok: false as const, error: "这颗骰不是你的" };
    }
    if (roll.result) return { ok: true as const };

    const charRows = await seatedLocked(sql, room.id);
    const party = charRows.map((c) => ({
      userId: c.user_id,
      sheet: asJson<CharacterSheet>(c.sheet, {} as CharacterSheet),
    }));
    const pc = party.find((p) => p.userId === context.userId);
    let sheet = ensureGear(pc?.sheet ?? ({} as CharacterSheet));
    const stFull = (
      await sql<{ npc_flags: unknown; scene_id: string; combat: unknown }>`
        select npc_flags, scene_id, combat from game_states where room_id = ${room.id}
      `
    )[0];
    const where = readWhere(asJson<Record<string, unknown>>(stFull?.npc_flags, {}));
    const offered = eligibleBoosts(party, roll, {
      where,
      sceneId: stFull?.scene_id ?? "wake",
      inCombat: Boolean(asCombat(stFull?.combat)),
      activeId: asCombat(stFull?.combat)?.activeId ?? null,
      spendAction: Object.fromEntries(
        (asCombat(stFull?.combat)?.order ?? []).map((o) => [
          o.id,
          o.spend?.action !== false,
        ]),
      ),
    });
    const allowed = new Set(
      offered.filter((b) => !b.blocked).map((b) => b.id as string),
    );
    const chosen = (data.boostIds ?? []).filter((id): id is BoostId => allowed.has(id));
    const boostFrom = (id: BoostId) => offered.find((b) => b.id === id);

    const kind0 = rollKind(roll);
    const kind =
      (kind0 === "damage" || kind0 === "check") &&
      /治愈|治疗|疗伤|cure|heal/i.test(`${roll.reason ?? ""} ${roll.dice ?? ""}`)
        ? "heal"
        : kind0;
    const myPlace = placeOf(where, context.userId, stFull?.scene_id ?? "wake");
    const rollAudience = party
      .filter(
        (member) =>
          placeOf(where, member.userId, stFull?.scene_id ?? "wake") === myPlace,
      )
      .map((member) => member.userId);
    const placeFree = !isPlaceBusy(
      asJson<Record<string, unknown>>(stFull?.npc_flags, {}),
      myPlace,
    );
    let combat = asCombat(stFull?.combat);

    if (kind === "heal") {
      const spell = /真言/.test(roll.reason) ? "治愈真言" : "治愈伤口";
      const expr = roll.dice || (/真言/.test(roll.reason) ? "1d4" : "1d8");
      const dice = rollDiceExpr(expr);
      const { mod, ability } = casterMod(sheet);
      const heal = Math.max(0, dice.total + mod);
      const nextHp = Math.min(sheet.hp.max, sheet.hp.current + heal);
      sheet.hp = { ...sheet.hp, current: nextHp };
      await sql`
        update characters
        set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
        where room_id = ${room.id} and user_id = ${context.userId}
      `;
      roll.result = {
        d20: 0,
        total: heal,
        success: true,
        bonus: mod,
        parts: [`${expr}=${dice.parts.join("+") || dice.total}`, `${mod >= 0 ? "+" : ""}${mod}${ability}`],
      };
      const next = rolls.map((r) => (r.id === roll.id ? roll : r));
      await sql`
        update game_states
        set pending_rolls = ${JSON.stringify(next)}::jsonb,
            combat = ${combat ? JSON.stringify(combat) : null}::jsonb,
            updated_at = now()
        where room_id = ${room.id}
      `;
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body, meta)
        values (
          ${uid("msg")}, ${room.id}, ${context.userId}, ${"roll"}, ${sheet.name ?? "冒险者"},
          ${`治疗 ${heal}（${spell} ${expr}${mod >= 0 ? "+" : ""}${mod}）生命 ${sheet.hp.current - heal}→${nextHp}`},
          ${JSON.stringify({ place: myPlace, audience: rollAudience, heal, spell })}::jsonb
        )
      `;
      if (next.every((r) => r.result) && placeFree) {
        const kp = await runKpTurn({
          roomId: room.id,
          actorUserId: context.userId,
          actorName: sheet.name ?? "冒险者",
          action: `治疗已掷：${spell}恢复 ${heal} 点生命，当前 ${nextHp}/${sheet.hp.max}。请叙述伤口收拢，不要改这个数字，不要把它说成武器伤害。`,
          kind: "roll-followup",
        });
        return { ok: true as const, roll: roll.result, kp };
      }
      return { ok: true as const, roll: roll.result };
    }

    if (kind === "damage") {
      const w = weaponAttack(sheet);
      const crit = Boolean(
        rolls.find((r) => r.kind === "attack" && r.targetId === roll.targetId && r.result?.d20 === 20),
      );
      const dice = rollDiceExpr(roll.dice || w.damage, crit);
      const mod =
        w.ability === "dex"
          ? abilityMod(sheet.scores?.dex ?? 10)
          : abilityMod(sheet.scores?.str ?? 10);
      let extraDmg = 0;
      const extraParts: string[] = [];
      if (chosen.includes("guided-strike")) {
        extraDmg += 10;
        extraParts.push("导向+10");
        const ch = applyFeature(sheet, "channel");
        if (!ch.ok) return { ok: false as const, error: ch.error };
        sheet = ch.sheet;
        await sql`
          update characters
          set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
          where room_id = ${room.id} and user_id = ${context.userId}
        `;
      }
      if (chosen.includes("sneak")) {
        const s = rollDiceExpr("2d6");
        extraDmg += s.total;
        extraParts.push(`偷袭2d6=${s.parts.join("+")}`);
      }
      if (chosen.includes("superiority")) {
        const wr = ensureResources(sheet).resources!;
        const c = spendCharge(wr.superiority);
        if (!c) return { ok: false as const, error: "战术骰用完了，短休后恢复" };
        const s = rollDiceExpr("1d8");
        extraDmg += s.total;
        extraParts.push(`战术骰1d8=${s.parts.join("+") || s.total}`);
        sheet = { ...sheet, resources: { ...wr, superiority: c } };
        await sql`
          update characters
          set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
          where room_id = ${room.id} and user_id = ${context.userId}
        `;
      }
      const dmg = Math.max(0, dice.total + mod + extraDmg);
      if (combat && roll.targetId) {
        combat = hurtNpc(combat, roll.targetId, dmg);
        const t = combat.order.find(
          (o) => o.id === roll.targetId || o.name === roll.targetId,
        );
        if (t?.kind === "pc") {
          const row = charRows.find((c) => c.user_id === t.id);
          if (row) {
            const ts = asJson<CharacterSheet>(row.sheet, {} as CharacterSheet);
            const hit = applyIncomingDamage(ts, dmg);
            await sql`
              update characters
              set sheet = ${JSON.stringify(hit.sheet)}::jsonb, updated_at = now()
              where room_id = ${room.id} and user_id = ${t.id}
            `;
            if (hit.relentless) {
              extraParts.push("不屈不挠");
            }
          }
        }
      }
      roll.result = {
        d20: 0,
        total: dmg,
        success: true,
        bonus: mod,
        parts: [
          `${roll.dice || w.damage}=${dice.parts.join("+") || dice.total}`,
          `${mod >= 0 ? "+" : ""}${mod}`,
          ...extraParts,
        ],
      };
      const next = rolls.map((r) => (r.id === roll.id ? roll : r));
      await sql`
        update game_states
        set pending_rolls = ${JSON.stringify(next)}::jsonb,
            combat = ${combat ? JSON.stringify(combat) : null}::jsonb,
            updated_at = now()
        where room_id = ${room.id}
      `;
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body, meta)
        values (
          ${uid("msg")}, ${room.id}, ${context.userId}, ${"roll"}, ${sheet.name ?? "冒险者"},
          ${`伤害 ${dmg}（${w.weapon}${crit ? " 重击" : ""}${extraParts.length ? " " + extraParts.join(" ") : ""}）`},
          ${JSON.stringify({ place: myPlace, audience: rollAudience, dmg, targetId: roll.targetId })}::jsonb
        )
      `;
      if (next.every((r) => r.result) && placeFree) {
        const kp = await runKpTurn({
          roomId: room.id,
          actorUserId: context.userId,
          actorName: sheet.name ?? "冒险者",
          action: `伤害已掷：${dmg} 点打在 ${roll.targetId ?? "目标"} 上。请叙述伤口，不要改这个数字。若目标未倒，不要替玩家结束回合。`,
          kind: "roll-followup",
        });
        return { ok: true as const, roll: roll.result, kp };
      }
      return { ok: true as const, roll: roll.result };
    }

    const ability = (roll.ability || "str") as keyof CharacterSheet["scores"];
    const score = sheet.scores?.[ability] ?? 10;
    let bonus = abilityMod(score);
    const prof = sheet.proficiency ?? 2;
    const parts: string[] = [];

    if (kind === "check" && roll.skill) {
      const skill = SKILLS.find((s) => s.id === (roll.skill as SkillId));
      if (skill) {
        bonus = abilityMod(sheet.scores?.[skill.ability] ?? 10);
        if (sheet.skills?.includes(skill.id)) bonus += prof;
        if (sheet.expertise?.includes(skill.id)) bonus += prof;
      }
    } else if (kind === "save" || kind === "death") {
      const cls = classById(sheet.classId);
      if (kind === "save" && cls?.saves.includes(ability)) bonus += prof;
      if (kind === "death") bonus = 0;
    } else if (kind === "attack") {
      const w = weaponAttack(sheet);
      bonus = w.bonus;
    } else if (kind === "init") {
      bonus = abilityMod(sheet.scores?.dex ?? 10);
    }

    parts.push(`${bonus >= 0 ? "+" : ""}${bonus}`);

    const useHelp =
      Boolean(roll.advantage) ||
      chosen.includes("help") ||
      chosen.includes("inspiration");
    let disadv = Boolean(roll.disadvantage);
    if (kind === "attack" && combat) {
      const atk = combat.order.find((o) => o.id === context.userId);
      const tgt = combat.order.find(
        (o) => o.id === roll.targetId || o.name === roll.targetId || o.id === `npc:${roll.targetId}`,
      );
      if (atk && tgt) {
        const shot = shotCheck(atk, tgt, weaponAttack(sheet));
        if (!shot.ok) return { ok: false as const, error: shot.reason };
        disadv = disadv || shot.disadvantage;
        if (combat.hazards.some((h) => h.id === "rain") && weaponAttack(sheet).ranged && (atk.band === "far" || tgt.band === "far")) {
          disadv = true;
        }
        roll.dc = tgt.ac + coverAc(tgt.cover);
      }
      const meAtk = combat.order.find((o) => o.id === context.userId);
      const warExtra =
        sheet.subclassId === "war" &&
        Boolean(meAtk?.spend?.attacked) &&
        meAtk?.spend?.action === false &&
        meAtk?.spend?.bonus !== false;
      const bonusAttack =
        warExtra || /附赠|战争祭司|再抢|再来一/.test(roll.reason ?? "");
      if (bonusAttack && sheet.subclassId === "war") {
        const wr = ensureResources(sheet).resources!;
        if (left(wr.warPriest) <= 0) {
          return { ok: false as const, error: "战争祭司次数用完了（长休恢复）" };
        }
      }
      const spent = spendCost(combat, context.userId, "attack", {
        classId: sheet.classId,
        subclassId: sheet.subclassId,
        bonusAttack,
      });
      if (!spent.ok) return { ok: false as const, error: spent.error };
      combat = spent.combat;
      if (bonusAttack && sheet.subclassId === "war") {
        const wr = ensureResources(sheet).resources!;
        const c = spendCharge(wr.warPriest);
        if (!c) return { ok: false as const, error: "战争祭司次数用完了（长休恢复）" };
        sheet = { ...sheet, resources: { ...wr, warPriest: c } };
      }
      const wAtk = weaponAttack(sheet);
      let sheetDirty = Boolean(bonusAttack && sheet.subclassId === "war");
      if (wAtk.ranged) {
        const ammo = consumeAmmo(sheet, /弩/.test(wAtk.weapon) ? "bolt" : "arrow");
        if (!ammo.ok) return { ok: false as const, error: ammo.error };
        sheet = ammo.sheet;
        sheetDirty = true;
      }
      if (sheetDirty) {
        await sql`
          update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
          where room_id = ${room.id} and user_id = ${context.userId}
        `;
      }
    }
    const useAdv = useHelp && !disadv;
    disadv = disadv && !useHelp;
    let a = d20();
    let b = useAdv || disadv ? d20() : a;
    let face = useAdv ? Math.max(a, b) : disadv ? Math.min(a, b) : a;
    if (chosen.includes("lucky") && face === 1) {
      const reroll = d20();
      parts.push(`幸运1→${reroll}`);
      if (useAdv) {
        if (a === 1) a = reroll;
        else b = reroll;
        face = Math.max(a, b);
      } else if (disadv) {
        if (a === 1) a = reroll;
        else b = reroll;
        face = Math.min(a, b);
      } else {
        face = reroll;
      }
    }

    let extra = 0;
    const concId = sheet.resources?.conc?.id;
    if ((kind === "attack" || kind === "save" || kind === "death") && concId === "bless") {
      const g = d4();
      extra += g;
      parts.push(`祝福1d4=${g}`);
    }
    if ((kind === "check" || kind === "init") && concId === "guidance") {
      const g = d4();
      extra += g;
      parts.push(`神导1d4=${g}`);
      sheet = dropConcentration(sheet);
      await sql`
        update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
        where room_id = ${room.id} and user_id = ${context.userId}
      `;
    } else if ((kind === "check" || kind === "init") && chosen.includes("guidance")) {
      const g = d4();
      extra += g;
      parts.push(`神导1d4=${g}`);
      const casterId = boostFrom("guidance")?.fromUserId ?? context.userId;
      if (combat) {
        const spent = spendCost(combat, casterId, "action");
        if (!spent.ok) return { ok: false as const, error: spent.error };
        combat = spent.combat;
      }
    }

    const total = face + bonus + extra;
    const vs = kind === "death" ? 10 : roll.dc;
    const success =
      kind === "init"
        ? true
        : face === 20
          ? true
          : face === 1
            ? false
            : total >= vs;
    roll.result = {
      d20: face,
      total,
      success,
      bonus: bonus + extra,
      parts,
    };
    let next = rolls.map((r) => (r.id === roll.id ? roll : r));

    if (kind === "init" && combat) {
      combat = applyInit(combat, context.userId, total);
    }
    if (kind === "attack" && success) {
      const w = weaponAttack(sheet);
      next = [
        ...next,
        {
          id: uid("roll"),
          userId: context.userId,
          name: sheet.name ?? "冒险者",
          ability: w.ability,
          kind: "damage",
          dc: 0,
          dice: w.damage,
          targetId: roll.targetId,
          sneakOk:
            useAdv ||
            Boolean(
              combat?.order.some(
                (o) =>
                  o.kind === "pc" &&
                  o.inCombat &&
                  o.id !== context.userId &&
                  o.band === "melee",
              ) && combat.order.find((o) => o.id === context.userId)?.band === "melee",
            ),
          reason: `伤害：${w.weapon}（${w.damage}）命中后可勾选导向打击/偷袭`,
        },
      ];
      if (combat) combat = { ...combat, waiting: "damage" };
    }
    if (kind === "death" && pc) {
      const ds = { ...(sheet.deathSaves ?? { success: 0, fail: 0 }) };
      if (face === 20) {
        sheet.hp = { ...sheet.hp, current: 1 };
        sheet.conditions = sheet.conditions.filter((x) => x !== "昏迷");
        ds.success = 0;
        ds.fail = 0;
      } else if (face === 1) ds.fail += 2;
      else if (success) ds.success += 1;
      else ds.fail += 1;
      sheet.deathSaves = ds;
      if (ds.fail >= 3) sheet.conditions = Array.from(new Set([...sheet.conditions, "死亡"]));
      if (ds.success >= 3) {
        sheet.conditions = sheet.conditions.filter((x) => x !== "昏迷");
        sheet.conditions = Array.from(new Set([...sheet.conditions, "稳定"]));
      }
      await sql`
        update characters
        set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
        where room_id = ${room.id} and user_id = ${context.userId}
      `;
    }

    await sql`
      update game_states
      set pending_rolls = ${JSON.stringify(next)}::jsonb,
          combat = ${combat ? JSON.stringify(combat) : null}::jsonb,
          updated_at = now()
      where room_id = ${room.id}
    `;

    if (chosen.includes("inspiration") && pc) {
      const nextSheet = { ...pc.sheet, inspiration: false };
      await sql`
        update characters
        set sheet = ${JSON.stringify(nextSheet)}::jsonb, updated_at = now()
        where room_id = ${room.id} and user_id = ${context.userId}
      `;
    }

    const skillLabel =
      kind === "init"
        ? "先攻"
        : kind === "death"
          ? "死亡豁免"
          : (SKILLS.find((s) => s.id === roll.skill)?.label ??
            (kind === "save" ? `${roll.ability}豁免` : kind === "attack" ? "攻击" : roll.ability));
    const advBit = useAdv ? ` 优势(${a}/${b})` : disadv ? ` 劣势(${a}/${b})` : "";
    const formula =
      kind === "init"
        ? `d20=${face}${advBit} ${parts.join(" ")} = ${total}`
        : `d20=${face}${advBit} ${parts.join(" ")} = ${total} vs DC ${kind === "death" ? 10 : roll.dc}`;
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, meta)
      values (
        ${uid("msg")}, ${room.id}, ${context.userId}, ${"roll"}, ${sheet.name ?? "冒险者"},
        ${`${skillLabel} ${kind === "init" ? total : face === 20 ? "大成功" : face === 1 ? "大失败" : success ? "成功" : "失败"}：${formula}`},
        ${JSON.stringify({ d20: face, bonus: bonus + extra, total, dc: roll.dc, success, boosts: chosen, parts, place: myPlace, audience: rollAudience })}::jsonb
      )
    `;

    if (next.every((r) => r.result) && placeFree) {
      const summary = next
        .map((r) => {
          const lab = SKILLS.find((s) => s.id === r.skill)?.label ?? r.ability;
          const p = r.result?.parts?.join(" ") ?? "";
          const clue = r.clueId ? ` clueId=${r.clueId}` : "";
          return `${r.name} 的${lab}：d20=${r.result!.d20} ${p} → ${r.result!.total} vs DC ${r.dc}（${r.result!.success ? "成功" : "失败"}）${clue}`;
        })
        .join("；");
      const kp = await runKpTurn({
        roomId: room.id,
        actorUserId: context.userId,
        actorName: sheet.name ?? "冒险者",
        action: `检定已全部掷完：${summary}。加值已计入总分。双轨：成功则写该 clueId 的完整层（playerText），失败则停留在已说出的免费层，不要惩罚、不要重复免费层。不要再要同一批骰。旁白用清楚完整的现代中文，禁止点名收尾。`,
        kind: "roll-followup",
      });
      return { ok: true as const, roll: roll.result, kp };
    }
    return { ok: true as const, roll: roll.result };
  });

export const joinCombat = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const st = (
      await sql<{ combat: unknown; npc_flags: unknown; scene_id: string; pending_rolls: unknown }>`
        select combat, npc_flags, scene_id, pending_rolls from game_states where room_id = ${room.id}
      `
    )[0];
    const combat0 = asCombat(st?.combat);
    if (!combat0) return { ok: false as const, error: "现在没有战斗" };
    const where = readWhere(asJson<Record<string, unknown>>(st.npc_flags, {}));
    const here = placeOf(where, context.userId, st.scene_id);
    if (here !== combat0.place) {
      return { ok: false as const, error: "你不在战场上，先过去才能加入" };
    }
    const row = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId} and locked = true
      `
    )[0];
    if (!row) return { ok: false as const, error: "没有人物卡" };
    const sheet = asJson<CharacterSheet>(row.sheet, {} as CharacterSheet);
    const combat = joinCombatState(combat0, { userId: context.userId, sheet });
    const rolls = asJson<PendingRoll[]>(st.pending_rolls, []);
    if (combat.waiting === "init" && !rolls.some((r) => r.userId === context.userId && r.kind === "init" && !r.result)) {
      rolls.push({
        id: uid("roll"),
        userId: context.userId,
        name: sheet.name,
        ability: "dex",
        kind: "init",
        dc: 0,
        reason: "先攻：同处的人都要掷。被发现或开打，在场即参战。",
      });
    }
    await sql`
      update game_states
      set combat = ${JSON.stringify(combat)}::jsonb,
          pending_rolls = ${JSON.stringify(rolls)}::jsonb,
          updated_at = now()
      where room_id = ${room.id}
    `;
    return { ok: true as const };
  });

export const extraAttack = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; targetId: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const st = (
      await sql<{ combat: unknown; pending_rolls: unknown }>`
        select combat, pending_rolls from game_states where room_id = ${room.id}
      `
    )[0];
    const combat = asCombat(st?.combat);
    if (!combat) return { ok: false as const, error: "现在没有战斗" };
    if (combat.activeId !== context.userId) {
      return { ok: false as const, error: "还没轮到你" };
    }
    const meC = combat.order.find((o) => o.id === context.userId);
    if (!meC?.inCombat) return { ok: false as const, error: "你不在这场战斗里" };
    const spend = meC.spend ?? { action: true, bonus: true, reaction: true, attacked: false };
    if (!spend.attacked || spend.action) {
      return { ok: false as const, error: "战争祭司要先用动作打出一次，再花附赠" };
    }
    if (!spend.bonus) return { ok: false as const, error: "本回合附赠已经用过" };
    const row = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId} and locked = true
      `
    )[0];
    if (!row) return { ok: false as const, error: "没有人物卡" };
    const sheet = ensureGear(asJson<CharacterSheet>(row.sheet, {} as CharacterSheet));
    if (sheet.subclassId !== "war") {
      return { ok: false as const, error: "你没有战争祭司" };
    }
    const wr = ensureResources(sheet).resources!;
    const remain = left(wr.warPriest);
    if (remain <= 0) {
      return { ok: false as const, error: "战争祭司次数用完了（长休恢复）" };
    }
    const tgt = combat.order.find(
      (o) =>
        o.inCombat &&
        (o.id === data.targetId ||
          o.id === `npc:${data.targetId}` ||
          o.name === data.targetId),
    );
    if (!tgt) return { ok: false as const, error: "找不到这个目标" };
    const rolls = asJson<PendingRoll[]>(st.pending_rolls, []);
    if (rolls.some((r) => r.userId === context.userId && !r.result)) {
      return { ok: false as const, error: "先把桌上这颗骰掷完" };
    }
    const w = weaponAttack(sheet);
    rolls.push({
      id: uid("roll"),
      userId: context.userId,
      name: sheet.name,
      ability: w.ability,
      kind: "attack",
      dc: tgt.ac + coverAc(tgt.cover),
      targetId: tgt.id,
      reason: `战争祭司附赠再攻：${tgt.name}（还剩 ${remain} 次，掷出才扣）`,
    });
    await sql`
      update game_states
      set pending_rolls = ${JSON.stringify(rolls)}::jsonb, updated_at = now()
      where room_id = ${room.id}
    `;
    return { ok: true as const };
  });

export const endTurn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const me = await memberOf(room.id, context.userId);
    const sql = await getSql();
    const st = (
      await sql<{ combat: unknown }>`
        select combat from game_states where room_id = ${room.id}
      `
    )[0];
    let combat = asCombat(st?.combat);
    if (!combat) return { ok: false as const, error: "现在没有战斗" };
    if (combat.activeId !== context.userId && !me.is_host) {
      return { ok: false as const, error: "还没轮到你" };
    }
    combat = nextTurn(combat);
    await sql`
      update game_states
      set combat = ${JSON.stringify(combat)}::jsonb, updated_at = now()
      where room_id = ${room.id}
    `;
    const active = combat.order.find((o) => o.id === combat?.activeId);
    if (active?.kind === "npc") {
      await runKpTurn({
        roomId: room.id,
        actorUserId: context.userId,
        actorName: active.name,
        action: `现在是 ${active.name} 的回合。按它的目标出手（hat=oppose 或要玩家豁免）。不要替玩家行动。地点仍是 ${combat.place}。`,
        kind: "action",
      });
    } else if (active && combat.waiting === "death") {
      const death = [
        {
          id: uid("roll"),
          userId: active.id,
          name: active.name,
          ability: "con",
          kind: "death" as const,
          dc: 10,
          reason: "死亡豁免：d20，10 成功。不要加体质。",
        },
      ];
      await sql`
        update game_states
        set pending_rolls = ${JSON.stringify(death)}::jsonb, updated_at = now()
        where room_id = ${room.id}
      `;
    }
    return { ok: true as const };
  });

export const leaveFight = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; kind: LeaveKind }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const st = (
      await sql<{ combat: unknown }>`
        select combat from game_states where room_id = ${room.id}
      `
    )[0];
    const combat0 = asCombat(st?.combat);
    if (!combat0) return { ok: false as const, error: "现在没有战斗" };
    const row = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId}
      `
    )[0];
    const sheet = asJson<CharacterSheet>(row?.sheet, {} as CharacterSheet);
    const cost =
      data.kind === "disengage"
        ? sheet.classId === "rogue"
          ? "bonus"
          : "action"
        : data.kind === "flee"
          ? "action"
          : data.kind === "surrender"
            ? null
            : "action";
    let combatBase = combat0;
    if (cost) {
      const spent = spendCost(combat0, context.userId, cost, {
        classId: sheet.classId,
      });
      if (!spent.ok) return { ok: false as const, error: spent.error };
      combatBase = spent.combat;
    }
    const { combat, oa, note } = applyLeave(
      combatBase,
      context.userId,
      data.kind,
      sheet.classId,
    );
    await sql`
      update game_states
      set combat = ${JSON.stringify(combat)}::jsonb, updated_at = now()
      where room_id = ${room.id}
    `;
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, meta)
      values (
        ${uid("msg")}, ${room.id}, ${context.userId}, ${"say"}, ${sheet.name ?? "冒险者"},
        ${note},
        ${JSON.stringify({ place: combat.place, leave: data.kind })}::jsonb
      )
    `;
    if (oa) {
      await runKpTurn({
        roomId: room.id,
        actorUserId: context.userId,
        actorName: sheet.name ?? "冒险者",
        action: `${sheet.name} 从贴身离开且未撤离。贴身的敌人获得一次借机攻击。请立刻 call_roll 攻击（dc=其 AC，targetId=${context.userId}）。不要跳过这颗骰。`,
        kind: "action",
      });
    } else {
      await runKpTurn({
        roomId: room.id,
        actorUserId: context.userId,
        actorName: sheet.name ?? "冒险者",
        action: `${sheet.name}：${note}。请用一句旁白交代场面，不要拦已经合法的脱离。`,
        kind: "action",
      });
    }
    return { ok: true as const };
  });

export const resolveReact = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; reactId: string; use: boolean }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const st = (
      await sql<{ combat: unknown }>`
        select combat from game_states where room_id = ${room.id}
      `
    )[0];
    const combat0 = asCombat(st?.combat);
    if (!combat0) return { ok: false as const, error: "没有待处理的反应" };
    const react = (combat0.reacts ?? []).find(
      (r) => r.id === data.reactId && r.userId === context.userId,
    );
    if (!react) return { ok: false as const, error: "没有这个反应" };
    let combatWork = combat0;
    if (data.use && react.kind === "shield") {
      const spent = spendCost(combat0, context.userId, "reaction");
      if (!spent.ok) return { ok: false as const, error: spent.error };
      combatWork = spent.combat;
    }
    const row = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId}
      `
    )[0];
    const sheet = asJson<CharacterSheet>(row?.sheet, {} as CharacterSheet);
    let note = "没有用护盾。";
    let dmg = react.damage;
    if (data.use && react.kind === "shield") {
      const newAc = react.ac + 5;
      if (react.attackTotal < newAc) {
        dmg = 0;
        note = `护盾术：AC ${react.ac}→${newAc}，这次打不中。`;
      } else {
        note = `护盾术：AC ${react.ac}→${newAc}，仍被命中。`;
      }
    }
    if (dmg > 0) {
      const hit = applyIncomingDamage(sheet, dmg);
      Object.assign(sheet, hit.sheet);
      if (hit.relentless) note = `${note} ${hit.note}`;
      await sql`
        update characters
        set sheet = ${JSON.stringify(hit.sheet)}::jsonb, updated_at = now()
        where room_id = ${room.id} and user_id = ${context.userId}
      `;
    }
    const reacts = (combatWork.reacts ?? []).filter((r) => r.id !== react.id);
    const combat = {
      ...combatWork,
      reacts,
      waiting: reacts.length ? "react" : "turn",
    };
    await sql`
      update game_states
      set combat = ${JSON.stringify(combat)}::jsonb, updated_at = now()
      where room_id = ${room.id}
    `;
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, meta)
      values (
        ${uid("msg")}, ${room.id}, ${context.userId}, ${"roll"}, ${sheet.name ?? "冒险者"},
        ${note}${dmg ? ` 伤害 ${dmg}` : ""},
        ${JSON.stringify({ place: combat.place, react: react.kind, use: data.use })}::jsonb
      )
    `;
    return { ok: true as const };
  });

export const restNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; kind: "short" | "long"; hitDice?: number; arcane?: 0 | 1 | 2 }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const me = await memberOf(room.id, context.userId);
    const sql = await getSql();
    const pc = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId} and locked = true
      `
    )[0];
    const sheet = ensureGear(asJson<CharacterSheet>(pc?.sheet, {} as CharacterSheet));
    return requestRestInner(
      sql,
      room.id,
      data.code,
      context.userId,
      sheet.name || me.nickname,
      data.kind,
      data.kind === "long" ? "我想长休过夜" : "我想短休一小时",
      { hitDice: data.hitDice, arcane: data.arcane },
    );
  });

export const cancelRest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const me = await memberOf(room.id, context.userId);
    const sql = await getSql();
    const pc = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId} and locked = true
      `
    )[0];
    const sheet = ensureGear(asJson<CharacterSheet>(pc?.sheet, {} as CharacterSheet));
    return cancelRestInner(
      sql,
      room.id,
      context.userId,
      sheet.name || me.nickname,
    );
  });

export const castSpell = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; spellId: string; slot?: number }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const row = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId} and locked = true
      `
    )[0];
    if (!row) return { ok: false as const, error: "没有人物卡" };
    const sheet0 = ensureGear(asJson<CharacterSheet>(row.sheet, {} as CharacterSheet));
    const st = (
      await sql<{ combat: unknown }>`select combat from game_states where room_id = ${room.id}`
    )[0];
    let combat = asCombat(st?.combat);
    const sp = spellById(data.spellId);
    if (combat?.order.some((o) => o.id === context.userId && o.inCombat) && sp) {
      const react = Boolean(sp.time?.includes("反应"));
      const cost = react ? "reaction" : spellTimeIsBonus(data.spellId) ? "bonus" : "action";
      const spent = spendCost(combat, context.userId, cost);
      if (!spent.ok) return { ok: false as const, error: spent.error };
      combat = spent.combat;
    }
    const cast = applyCast(sheet0, data.spellId, data.slot);
    if (!cast.ok) return { ok: false as const, error: cast.error };
    await sql`
      update characters set sheet = ${JSON.stringify(cast.sheet)}::jsonb, updated_at = now()
      where room_id = ${room.id} and user_id = ${context.userId}
    `;
    if (combat) {
      await sql`
        update game_states set combat = ${JSON.stringify(combat)}::jsonb where room_id = ${room.id}
      `;
    }
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body)
      values (
        ${uid("msg")}, ${room.id}, ${context.userId}, ${"say"}, ${cast.sheet.name},
        ${`施放${sp?.name ?? data.spellId}。${cast.note}`}
      )
    `;
    const kp = await runKpTurn({
      roomId: room.id,
      actorUserId: context.userId,
      actorName: cast.sheet.name,
      action: `${cast.sheet.name} 已由系统扣资源：${cast.note} 请叙述效果。需要治疗骰则 hat=call_roll kind=heal。不要再扣环，也不要改库存数字。`,
      kind: "action",
    });
    if (!kp.ok) return { ok: false as const, error: kp.error };
    return { ok: true as const };
  });

export const useFeature = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; feat: FeatId }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const row = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId} and locked = true
      `
    )[0];
    if (!row) return { ok: false as const, error: "没有人物卡" };
    let sheet = ensureGear(asJson<CharacterSheet>(row.sheet, {} as CharacterSheet));
    if (data.feat === "surge") {
      const feat = applyFeature(sheet, "surge");
      if (!feat.ok) return { ok: false as const, error: feat.error };
      sheet = feat.sheet;
      const st = (
        await sql<{ combat: unknown }>`select combat from game_states where room_id = ${room.id}`
      )[0];
      const combat = asCombat(st?.combat);
      if (combat) {
        const next = {
          ...combat,
          order: combat.order.map((o) =>
            o.id === context.userId
              ? {
                  ...o,
                  spend: {
                    ...(o.spend ?? { action: false, bonus: true, reaction: true, attacked: false }),
                    action: true,
                  },
                }
              : o,
          ),
        };
        await sql`update game_states set combat = ${JSON.stringify(next)}::jsonb where room_id = ${room.id}`;
      }
      await sql`
        update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
        where room_id = ${room.id} and user_id = ${context.userId}
      `;
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body)
        values (${uid("msg")}, ${room.id}, ${context.userId}, ${"say"}, ${sheet.name}, ${"动作如潮：本回合再获得一个动作。"})
      `;
      return { ok: true as const };
    }
    const feat = applyFeature(sheet, data.feat);
    if (!feat.ok) return { ok: false as const, error: feat.error };
    if (data.feat === "breath") {
      const st = (
        await sql<{ combat: unknown }>`select combat from game_states where room_id = ${room.id}`
      )[0];
      const combat = asCombat(st?.combat);
      if (combat?.order.some((o) => o.id === context.userId && o.inCombat)) {
        const spent = spendCost(combat, context.userId, "action");
        if (!spent.ok) return { ok: false as const, error: spent.error };
        await sql`update game_states set combat = ${JSON.stringify(spent.combat)}::jsonb where room_id = ${room.id}`;
      }
    }
    await sql`
      update characters set sheet = ${JSON.stringify(feat.sheet)}::jsonb, updated_at = now()
      where room_id = ${room.id} and user_id = ${context.userId}
    `;
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body)
      values (${uid("msg")}, ${room.id}, ${context.userId}, ${"say"}, ${feat.sheet.name}, ${feat.note})
    `;
    return { ok: true as const };
  });

export const useHitDie = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const row = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId} and locked = true
      `
    )[0];
    if (!row) return { ok: false as const, error: "没有人物卡" };
    const sheet = ensureGear(asJson<CharacterSheet>(row.sheet, {} as CharacterSheet));
    const out = spendHitDie(sheet);
    if (!out.ok) return { ok: false as const, error: out.error };
    await sql`
      update characters set sheet = ${JSON.stringify(out.sheet)}::jsonb, updated_at = now()
      where room_id = ${room.id} and user_id = ${context.userId}
    `;
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body)
      values (${uid("msg")}, ${room.id}, ${context.userId}, ${"roll"}, ${out.sheet.name}, ${out.note})
    `;
    return { ok: true as const };
  });

export const kickMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; userId: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const me = await memberOf(room.id, context.userId);
    if (!me.is_host) return { ok: false as const, error: "只有房主能请离" };
    if (data.userId === context.userId) return { ok: false as const, error: "房主不能请离自己" };
    const sql = await getSql();
    const there = (
      await sql<{ user_id: string }>`
        select user_id from room_members where room_id = ${room.id} and user_id = ${data.userId}
      `
    )[0];
    if (!there) return { ok: false as const, error: "这人不在桌上" };
    await detachSeated(sql, room.id, data.userId);
    return { ok: true as const };
  });

export const leaveTable = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const sql = await getSql();
    const there = (
      await sql<{ user_id: string }>`
        select user_id from room_members
        where room_id = ${room.id} and user_id = ${context.userId}
      `
    )[0];
    if (!there) return { ok: true as const };
    await detachSeated(sql, room.id, context.userId);
    return { ok: true as const };
  });

async function seatedLocked(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
) {
  return sql<{ user_id: string; sheet: unknown }>`
    select c.user_id, c.sheet
    from characters c
    join room_members m on m.room_id = c.room_id and m.user_id = c.user_id
    where c.room_id = ${roomId} and c.locked = true
  `;
}

async function detachSeated(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
  userId: string,
) {
  const nameRow = (
    await sql<{ sheet: unknown; nickname: string | null }>`
      select c.sheet, m.nickname
      from room_members m
      left join characters c on c.room_id = m.room_id and c.user_id = m.user_id
      where m.room_id = ${roomId} and m.user_id = ${userId}
    `
  )[0];
  const name =
    asJson<CharacterSheet>(nameRow?.sheet, {} as CharacterSheet).name ||
    nameRow?.nickname ||
    "有人";
  const hostRow = (
    await sql<{ is_host: boolean }>`
      select is_host from room_members where room_id = ${roomId} and user_id = ${userId}
    `
  )[0];
  if (hostRow?.is_host) {
    const nextHost = (
      await sql<{ user_id: string }>`
        select user_id from room_members
        where room_id = ${roomId} and user_id <> ${userId}
        order by joined_at asc
        limit 1
      `
    )[0];
    if (nextHost) {
      await sql`
        update room_members set is_host = false
        where room_id = ${roomId} and user_id = ${userId}
      `;
      await sql`
        update room_members set is_host = true
        where room_id = ${roomId} and user_id = ${nextHost.user_id}
      `;
      await sql`
        update rooms set host_user_id = ${nextHost.user_id} where id = ${roomId}
      `;
    }
  }

  const { flags, sceneId } = await flagsOf(sql, roomId);
  flags.squads = leaveSquad(readSquads(flags), userId);
  flags.squadQueue = readSquadQueue(flags).filter((q) => q.userId !== userId);
  const inv = readSquadInvite(flags);
  if (inv && (inv.from === userId || inv.to === userId)) delete flags.squadInvite;
  const vote = readRestVote(flags);
  if (vote) {
    vote.agreed = vote.agreed.filter((id) => id !== userId);
    if (vote.from === userId || vote.agreed.length === 0) delete flags.restVote;
    else flags.restVote = vote;
  }
  const hold = readRestHold(flags);
  if (hold) {
    const resters = hold.resters.filter((id) => id !== userId);
    if (!resters.length) delete flags.restHold;
    else flags.restHold = { ...hold, resters };
  }
  const where = readWhere(flags);
  delete where[userId];
  flags.where = where;
  const clocks = { ...readClocks(flags) };
  delete clocks[userId];
  flags.clock = clocks;
  await writeFlags(sql, roomId, flags);

  const st = (
    await sql<{ combat: unknown; pending_rolls: unknown }>`
      select combat, pending_rolls from game_states where room_id = ${roomId}
    `
  )[0];
  const combat0 = asCombat(st?.combat);
  const combat = combat0 ? dropFromCombat(combat0, userId) : null;
  const rolls = asJson<PendingRoll[]>(st?.pending_rolls, []).filter(
    (r) => r.userId !== userId,
  );
  await sql`
    update game_states
    set combat = ${combat ? JSON.stringify(combat) : null}::jsonb,
        pending_rolls = ${JSON.stringify(rolls)}::jsonb,
        updated_at = now()
    where room_id = ${roomId}
  `;

  await sql`
    delete from room_members where room_id = ${roomId} and user_id = ${userId}
  `;
  await sql`
    insert into messages (id, room_id, user_id, kind, name, body, meta)
    values (
      ${uid("msg")}, ${roomId}, null, ${"stage"}, ${"离席"},
      ${`${name} 离开了这一桌。人物卡还留着，用房间码可以再进来。`},
      ${JSON.stringify({ place: "all" })}::jsonb
    )
  `;
}

async function reseatPlayer(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
  userId: string,
) {
  const { flags, sceneId } = await flagsOf(sql, roomId);
  const where = readWhere(flags);
  where[userId] = sceneId;
  flags.where = where;
  const clocks = readClocks(flags);
  const others = await sql<{ user_id: string }>`
    select user_id from room_members where room_id = ${roomId} and user_id <> ${userId}
  `;
  const maxB = Math.max(0, ...others.map((r) => clockOf(clocks, r.user_id).beats));
  const maxM = Math.max(0, ...others.map((r) => clockOf(clocks, r.user_id).minutes));
  flags.clock = { ...clocks, [userId]: { beats: maxB, minutes: maxM } };
  await writeFlags(sql, roomId, flags);
}

async function flagsOf(sql: Awaited<ReturnType<typeof getSql>>, roomId: string) {
  const st = (
    await sql<{ npc_flags: unknown; scene_id: string }>`
      select npc_flags, scene_id from game_states where room_id = ${roomId}
    `
  )[0];
  return {
    flags: asJson<Record<string, unknown>>(st?.npc_flags, {}),
    sceneId: st?.scene_id ?? "wake",
  };
}

export const inviteSquad = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; targetUserId: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    if (data.targetUserId === context.userId) {
      return { ok: false as const, error: "不能和自己组队" };
    }
    const sql = await getSql();
    const { flags, sceneId } = await flagsOf(sql, room.id);
    sweepSquadInvite(flags);
    const live = readSquadInvite(flags);
    if (live && live.from !== context.userId) {
      return { ok: false as const, error: "桌上已有一条组队邀请，等它结束或让对方取消" };
    }
    if (live && live.to !== data.targetUserId) {
      return { ok: false as const, error: "先取消现在这条邀请，再邀别人" };
    }
    const where = readWhere(flags);
    if (placeOf(where, context.userId, sceneId) !== placeOf(where, data.targetUserId, sceneId)) {
      return { ok: false as const, error: "要先到同一处才能组队" };
    }
    const squads = readSquads(flags);
    if (squadOf(squads, context.userId).includes(data.targetUserId)) {
      return { ok: false as const, error: "已经在同一组" };
    }
    if (matesOf(squads, data.targetUserId).length) {
      return { ok: false as const, error: "对方已在别的组里，请先让他们离队" };
    }
    const mePc = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId}
      `
    )[0];
    const fromName =
      asJson<CharacterSheet>(mePc?.sheet, {} as CharacterSheet).name || "同伴";
    flags.squadInvite = {
      from: context.userId,
      to: data.targetUserId,
      fromName,
      at: Date.now(),
    };
    await writeFlags(sql, room.id, flags);
    return { ok: true as const };
  });

export const cancelSquadInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const { flags } = await flagsOf(sql, room.id);
    sweepSquadInvite(flags);
    const invite = readSquadInvite(flags);
    if (!invite) return { ok: true as const };
    if (invite.from !== context.userId) {
      return { ok: false as const, error: "只能取消自己发出的邀请" };
    }
    delete flags.squadInvite;
    await writeFlags(sql, room.id, flags);
    return { ok: true as const };
  });

export const answerSquad = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; accept: boolean }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const { flags, sceneId } = await flagsOf(sql, room.id);
    if (sweepSquadInvite(flags)) await writeFlags(sql, room.id, flags);
    const invite = readSquadInvite(flags);
    if (!invite || invite.to !== context.userId) {
      return { ok: false as const, error: "没有发给你的组队邀请" };
    }
    delete flags.squadInvite;
    if (!data.accept) {
      await writeFlags(sql, room.id, flags);
      return { ok: true as const };
    }
    const where = readWhere(flags);
    if (placeOf(where, invite.from, sceneId) !== placeOf(where, invite.to, sceneId)) {
      await writeFlags(sql, room.id, flags);
      return { ok: false as const, error: "已经不在同一处，组队取消" };
    }
    const nextSquads = joinSquad(readSquads(flags), invite.from, invite.to);
    flags.squads = nextSquads;
    await writeFlags(sql, room.id, flags);
    const rows = await sql<{ user_id: string; sheet: unknown }>`
      select user_id, sheet from characters where room_id = ${room.id} and locked = true
    `;
    const g = nextSquads.find((s) => s.ids.includes(context.userId));
    const names = g?.ids.map((id) => {
      const row = rows.find((r) => r.user_id === id);
      return asJson<CharacterSheet>(row?.sheet, {} as CharacterSheet).name || "同伴";
    });
    const capName =
      asJson<CharacterSheet>(
        rows.find((r) => r.user_id === g?.captain)?.sheet,
        {} as CharacterSheet,
      ).name || "队长";
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, meta)
      values (
        ${uid("msg")}, ${room.id}, null, ${"stage"}, ${"组队"},
        ${`${(names ?? []).join("、")} 组成一队，队长是 ${capName}。队员发言先入队内，队长批准才进桌。`},
        ${JSON.stringify({ place: placeOf(where, context.userId, sceneId) })}::jsonb
      )
    `;
    return { ok: true as const };
  });

export const leaveSquadNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const { flags, sceneId } = await flagsOf(sql, room.id);
    const squads = readSquads(flags);
    if (squadOf(squads, context.userId).length < 2) {
      return { ok: false as const, error: "你不在任何组里" };
    }
    const mePc = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId}
      `
    )[0];
    const name =
      asJson<CharacterSheet>(mePc?.sheet, {} as CharacterSheet).name || "有人";
    flags.squads = leaveSquad(squads, context.userId);
    flags.squadQueue = readSquadQueue(flags).filter((q) => q.userId !== context.userId);
    await writeFlags(sql, room.id, flags);
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, meta)
      values (
        ${uid("msg")}, ${room.id}, null, ${"stage"}, ${"离队"},
        ${`${name} 离开了队伍，之后独自行动。`},
        ${JSON.stringify({ place: placeOf(readWhere(flags), context.userId, sceneId) })}::jsonb
      )
    `;
    return { ok: true as const };
  });

export const passCaptain = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; toUserId: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    if (data.toUserId === context.userId) {
      return { ok: false as const, error: "你已经是队长" };
    }
    const sql = await getSql();
    const { flags, sceneId } = await flagsOf(sql, room.id);
    const next = transferCaptain(readSquads(flags), context.userId, data.toUserId);
    if (!next) return { ok: false as const, error: "只能把队长交给同队的人" };
    flags.squads = next;
    await writeFlags(sql, room.id, flags);
    const rows = await sql<{ user_id: string; sheet: unknown }>`
      select user_id, sheet from characters where room_id = ${room.id} and locked = true
    `;
    const nameOf = (id: string) =>
      asJson<CharacterSheet>(
        rows.find((r) => r.user_id === id)?.sheet,
        {} as CharacterSheet,
      ).name || "同伴";
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, meta)
      values (
        ${uid("msg")}, ${room.id}, null, ${"stage"}, ${"队长"},
        ${`${nameOf(context.userId)} 把队长交给 ${nameOf(data.toUserId)}。`},
        ${JSON.stringify({ place: placeOf(readWhere(flags), context.userId, sceneId) })}::jsonb
      )
    `;
    return { ok: true as const };
  });

export const approveSquadQueue = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; queueId: string; accept: boolean }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const { flags, sceneId } = await flagsOf(sql, room.id);
    const squads = readSquads(flags);
    if (!isCaptain(squads, context.userId)) {
      return { ok: false as const, error: "只有队长能批准队内发言" };
    }
    const queue = readSquadQueue(flags);
    const item = queue.find((q) => q.id === data.queueId);
    if (!item) return { ok: false as const, error: "这条已经不在缓冲里" };
    const mine = squadRecord(squads, context.userId);
    if (!mine?.ids.includes(item.userId)) {
      return { ok: false as const, error: "不是你们队的话" };
    }
    flags.squadQueue = queue.filter((q) => q.id !== data.queueId);
    await writeFlags(sql, room.id, flags);
    if (!data.accept) return { ok: true as const };
    const sayPlace = placeOf(readWhere(flags), item.userId, sceneId);
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, meta)
      values (
        ${uid("msg")}, ${room.id}, ${item.userId}, ${"say"}, ${item.name}, ${item.body},
        ${JSON.stringify({ place: sayPlace, solo: true })}::jsonb
      )
    `;
    const kp = await runKpTurn({
      roomId: room.id,
      actorUserId: item.userId,
      actorName: item.name,
      action: item.body,
      kind: "action",
      solo: true,
    });
    if (!kp.ok) return { ok: false as const, error: kp.error };
    return { ok: true as const };
  });
