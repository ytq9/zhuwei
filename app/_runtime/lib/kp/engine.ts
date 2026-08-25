import { env } from "cloudflare:workers";
import { getSql } from "@/lib/db";
import { uid } from "@/lib/utils";
import type { CharacterSheet } from "@/lib/dnd/types";
import { getModule } from "@/lib/module";
import { uniqueSpellIds } from "@/lib/dnd/catalog";
import { applyIncomingDamage, ensureResources, left, longRestSheet, shortRestSheet, spendHitDice } from "@/lib/dnd/resources";
import { ensureGear } from "@/lib/dnd/compute";
import { buildKpMessages, type PendingRoll } from "./prompt";
import {
  parseKpSafe,
  readMemory,
  tooLike,
  writeMemory,
  type KpSpeech,
} from "./sanitize";
import { applyStancePatch, openingStances, readStances } from "./stance";
import { applyWherePatch, placeOf, readWhere } from "./where";
import {
  bumpClocks,
  clockOf,
  isWaitAction,
  minutesForAction,
  readClocks,
  readRestHold,
  restRemain,
  restingRefuseSpeech,
  spotlightRefuseSpeech,
  spotlightSkew,
  syncReunion,
} from "./clock";
import {
  expandWhereWithSquads,
  expireSquadQueue,
  isSplitAction,
  readSquadQueue,
  readSquads,
  splitSquadsOnDiverge,
  squadOf,
} from "./squad";
import { anyPlaceBusy, isPlaceBusy, readBusyPlaces, sweepBusyPlaces } from "./busy";
import {
  asCombat,
  coverAc,
  mergeCombat,
  pullPresentIntoCombat,
  resolveNpcDice,
  spendCost,
  type CombatState,
} from "./combat";

export type { KpSpeech, PendingRoll };

async function chatJson(messages: { role: "system" | "user"; content: string }[]) {
  const secrets = env as typeof env & {
    DEEPSEEK_API_KEY?: string;
    XAI_API_KEY?: string;
  };
  const providers = [
    secrets.DEEPSEEK_API_KEY
      ? {
          name: "DeepSeek",
          url: "https://api.deepseek.com/chat/completions",
          apiKey: secrets.DEEPSEEK_API_KEY,
          body: {
            model: "deepseek-v4-flash",
            thinking: { type: "disabled" },
            temperature: 0.7,
            max_tokens: 1200,
            response_format: { type: "json_object" },
            messages,
          },
        }
      : null,
    secrets.XAI_API_KEY
      ? {
          name: "xAI",
          url: "https://api.x.ai/v1/chat/completions",
          apiKey: secrets.XAI_API_KEY,
          body: {
            model: "grok-4.5",
            temperature: 0.7,
            max_tokens: 1200,
            response_format: { type: "json_object" },
            messages,
          },
        }
      : null,
  ].filter((provider) => provider !== null);

  if (providers.length === 0) {
    return { ok: false as const, error: "AI 密钥未配置" };
  }

  let lastError = "KP 无法应答";
  for (const provider of providers) {
    try {
      const res = await fetch(provider.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(provider.body),
      });
      if (!res.ok) {
        lastError = `${provider.name} 无法应答（${res.status}）`;
        continue;
      }
      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = body.choices?.[0]?.message?.content ?? "";
      return { ok: true as const, data: parseKpSafe(text) };
    } catch {
      lastError = `${provider.name} 返回了无效结果`;
    }
  }
  return { ok: false as const, error: lastError };
}

type StateRow = {
  chapter_id: string;
  scene_id: string;
  revealed_clues: unknown;
  npc_flags: unknown;
  combat: unknown;
  pending_rolls: unknown;
  kp_busy: boolean;
  secret: unknown;
};

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

async function markConsumed(
  sql: Awaited<ReturnType<typeof getSql>>,
  id: string,
) {
  const row = (
    await sql<{ meta: unknown }>`select meta from messages where id = ${id}`
  )[0];
  if (!row) return;
  const meta = {
    ...asJson<Record<string, unknown>>(row.meta, {}),
    consumed: true,
  };
  await sql`
    update messages set meta = ${JSON.stringify(meta)}::jsonb where id = ${id}
  `;
}

async function lockPlace(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
  place: string,
) {
  const row = (
    await sql<{ npc_flags: unknown; updated_at: string }>`
      select npc_flags, updated_at from game_states where room_id = ${roomId}
    `
  )[0];
  const flags = asJson<Record<string, unknown>>(row?.npc_flags, {});
  sweepBusyPlaces(flags);
  if (isPlaceBusy(flags, place)) return false;
  const busy = { ...readBusyPlaces(flags), [place]: Date.now() };
  flags.kpBusyPlaces = busy;
  await sql`
    update game_states
    set npc_flags = ${JSON.stringify(flags)}::jsonb,
        kp_busy = true,
        updated_at = now()
    where room_id = ${roomId}
  `;
  return true;
}

async function unlockPlace(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
  place: string,
) {
  const row = (
    await sql<{ npc_flags: unknown }>`
      select npc_flags from game_states where room_id = ${roomId}
    `
  )[0];
  const flags = asJson<Record<string, unknown>>(row?.npc_flags, {});
  const busy = readBusyPlaces(flags);
  delete busy[place];
  const still = Object.keys(busy).length > 0;
  flags.kpBusyPlaces = busy;
  await sql`
    update game_states
    set npc_flags = ${JSON.stringify(flags)}::jsonb,
        kp_busy = ${still},
        updated_at = now()
    where room_id = ${roomId}
  `;
}

export const KP_BUSY_MSG = "KP 正在思考，稍等片刻";

type OpenSay = { id: string; userId: string; name: string; body: string };

async function listOpenSays(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
  place?: string,
): Promise<OpenSay[]> {
  const rows = await sql<{
    id: string;
    user_id: string | null;
    kind: string;
    name: string;
    body: string;
    meta: unknown;
  }>`
    select id, user_id, kind, name, body, meta
    from messages where room_id = ${roomId}
    order by created_at desc
    limit 40
  `;
  const chrono = [...rows].reverse();
  let lastKp = -1;
  for (let i = 0; i < chrono.length; i++) {
    const k = chrono[i].kind;
    if (
      !chrono[i].user_id &&
      (k === "narrate" || k === "refuse" || k === "call_roll" || k === "open")
    ) {
      lastKp = i;
    }
  }
  const out: OpenSay[] = [];
  for (let i = lastKp + 1; i < chrono.length; i++) {
    const m = chrono[i];
    if (m.kind !== "say" || !m.user_id) continue;
    const meta = asJson<Record<string, unknown>>(m.meta, {});
    if (meta.consumed) continue;
    const p = meta.place ? String(meta.place) : "";
    if (place && p && p !== "all" && p !== place) continue;
    out.push({ id: m.id, userId: m.user_id, name: m.name, body: m.body });
  }
  return out;
}

function formatSameBeat(
  says: OpenSay[],
  fallback: { name: string; action: string; userId: string },
) {
  const list = says.length
    ? says
    : [
        {
          id: "",
          userId: fallback.userId,
          name: fallback.name,
          body: fallback.action,
        },
      ];
  if (list.length === 1) {
    return {
      actorName: list[0].name,
      actorUserId: list[0].userId,
      action: list[0].body,
      ids: says.map((s) => s.id).filter(Boolean),
    };
  }
  return {
    actorName: list.map((s) => s.name).join("、"),
    actorUserId: fallback.userId,
    action: `【同时行动】这些人几乎同时行动。用一段旁白写完，每个人都要有着落，不要只写第一个，不要让后开口的人蒸发。用完整句。\n${list.map((s) => `- ${s.name}：${s.body}`).join("\n")}`,
    ids: says.map((s) => s.id),
  };
}

export async function runKpTurn(opts: {
  roomId: string;
  actorUserId: string;
  actorName: string;
  action: string;
  kind: "action" | "roll-followup";
  solo?: boolean;
  consumeSayId?: string;
}) {
  const sql = await getSql();
  const rooms = await sql<{ module_id: string; status: string }>`
    select module_id, status from rooms where id = ${opts.roomId}
  `;
  if (!rooms[0] || rooms[0].status !== "play") {
    return { ok: false as const, error: "这一桌还没开团" };
  }
  const peek = (
    await sql<{ npc_flags: unknown; scene_id: string }>`
      select npc_flags, scene_id from game_states where room_id = ${opts.roomId}
    `
  )[0];
  const actorPlace = placeOf(
    readWhere(asJson<Record<string, unknown>>(peek?.npc_flags, {})),
    opts.actorUserId,
    peek?.scene_id ?? "wake",
  );
  const gotLock = await lockPlace(sql, opts.roomId, actorPlace);
  if (!gotLock) {
    return { ok: false as const, error: KP_BUSY_MSG };
  }

  const unlockPlaceNow = () => unlockPlace(sql, opts.roomId, actorPlace);

  try {
    const st = (
      await sql<StateRow>`select * from game_states where room_id = ${opts.roomId}`
    )[0];
    if (!st) throw new Error("桌面状态丢失");

    const chars = await sql<{ user_id: string; sheet: unknown }>`
      select c.user_id, c.sheet
      from characters c
      join room_members m on m.room_id = c.room_id and m.user_id = c.user_id
      where c.room_id = ${opts.roomId} and c.locked = true
    `;
    const flags0 = asJson<Record<string, unknown>>(st.npc_flags, {});
    if (opts.kind === "action") {
      const where0 = readWhere(flags0);
      const othersHere = chars.some(
        (c) =>
          c.user_id !== opts.actorUserId &&
          placeOf(where0, c.user_id, st.scene_id) === actorPlace,
      );
      if (othersHere) {
        await new Promise((r) => setTimeout(r, 900));
      }
    }
    const openSays =
      opts.kind === "action" ? await listOpenSays(sql, opts.roomId, actorPlace) : [];
    const beat = formatSameBeat(openSays, {
      name: opts.actorName,
      action: opts.action,
      userId: opts.actorUserId,
    });
    const recentRows = await sql<{ name: string; kind: string; body: string; meta: unknown }>`
      select name, kind, body, meta from messages
      where room_id = ${opts.roomId}
      order by created_at desc
      limit 24
    `;
    const recent = recentRows
      .filter((m) => {
        const meta = asJson<Record<string, unknown>>(m.meta, {});
        const p = meta.place ? String(meta.place) : "";
        const places = Array.isArray(meta.places) ? meta.places.map(String) : [];
        if (places.includes("all") || places.includes(actorPlace)) return true;
        if (!p || p === "all") return true;
        return p === actorPlace;
      })
      .slice(0, 8);
    const module = getModule(rooms[0].module_id);
    const pending = asJson<PendingRoll[]>(st.pending_rolls, []);
    const resolved = pending.filter((p) => p.result);
    const secret0 = asJson<Record<string, unknown>>(st.secret, {});
    const memory = readMemory(secret0);
    const partyIds = chars.map((c) => c.user_id);
    const namesById: Record<string, string> = {};
    for (const c of chars) {
      namesById[c.user_id] =
        asJson<CharacterSheet>(c.sheet, {} as CharacterSheet).name || "冒险者";
    }
    const clocks0 = readClocks(flags0);
    const whereNow = readWhere(flags0);
    const hold0 = readRestHold(flags0);
    const skew = spotlightSkew(
      clocks0,
      partyIds,
      whereNow,
      st.scene_id,
      opts.actorUserId,
      namesById,
      hold0?.resters ?? [],
    );
    const waiting = isWaitAction(opts.action) || isWaitAction(beat.action);

    let data: KpSpeech;
    if (opts.kind === "action" && skew.blocked && !waiting) {
      data = skew.reason === "resting" ? restingRefuseSpeech() : spotlightRefuseSpeech(skew);
    } else {
      const messages = buildKpMessages({
        module,
        chapterId: st.chapter_id,
        sceneId: st.scene_id,
        revealedClueIds: asJson<string[]>(st.revealed_clues, []),
        npcFlags: asJson<Record<string, unknown>>(st.npc_flags, {}),
        secret: secret0,
        combat: asJson(st.combat, null),
        pendingResolved: opts.kind === "roll-followup" ? resolved : [],
        characters: chars.map((c) => ({
          userId: c.user_id,
          sheet: asJson<CharacterSheet>(c.sheet, {} as CharacterSheet),
        })),
        recent: recent.reverse(),
        actorName: beat.actorName,
        actorUserId: beat.actorUserId,
        action: waiting
          ? `${beat.action}\n（此人对时间线选择等待，不要推进新事件，只写等待的体感。不要描写另一边还没演完的事。）`
          : opts.solo
            ? `【独自】队员 ${opts.actorName} 经队长批准后单独开口，不代表整队：${beat.action}\n只写这个人。不要「你们」。不要 wherePatch 整组。`
            : beat.action,
        memory,
      });

      let out = await chatJson(messages);
      if (!out.ok) {
        await sql`
          insert into messages (id, room_id, user_id, kind, name, body, meta)
          values (
            ${uid("msg")}, ${opts.roomId}, null, ${"refuse"}, ${"KP"},
            ${"这一拍没写成。你刚才那句话还在，再说一次，或换一种做法。"},
            ${JSON.stringify({ place: actorPlace, places: [actorPlace] })}::jsonb
          )
        `;
        if (opts.consumeSayId) await markConsumed(sql, opts.consumeSayId);
        await unlockPlaceNow();
        return out;
      }

      data = out.data;
      if (memory.lastSpeeches.some((s) => tooLike(s, data.speech))) {
        const retry = await chatJson([
          ...messages,
          {
            role: "user",
            content:
              "上一版与近期内容重复。保留本轮事实和行动结果，用自然、完整、直接的中文重新表达。不要增加新的氛围意象，不使用器物代指人物或动作，确保玩家能立刻理解发生了什么以及 NPC 的意思。只要 JSON。",
          },
        ]);
        if (retry.ok) data = retry.data;
      }
    }

    const prevClues = asJson<string[]>(st.revealed_clues, []);
    let nextPending: PendingRoll[] =
      data.hat === "call_roll"
        ? data.rolls.map((r) => {
            const blob = `${r.kind ?? ""} ${r.reason ?? ""} ${r.dice ?? ""} ${r.skill ?? ""}`;
            const heal = /治愈|治疗|疗伤|cure|heal/i.test(blob);
            const weaponish = /钉头|长剑|短剑|伤害|挥砍|穿刺|钝击/.test(blob);
            const inferred = inferClueId(
              { ...r, id: r.id || uid("roll") } as PendingRoll,
              module,
              st.scene_id,
            );
            if (heal && !weaponish) {
              const word = /真言/.test(blob);
              return {
                ...r,
                id: r.id || uid("roll"),
                kind: "heal" as const,
                ability: r.ability || "wis",
                dice:
                  r.dice && /^\d+d\d+/i.test(r.dice) && !weaponish
                    ? r.dice
                    : word
                      ? "1d4"
                      : "1d8",
                dc: 0,
                clueId: r.clueId || inferred,
                reason:
                  r.reason?.includes("治愈") || r.reason?.includes("治疗")
                    ? r.reason
                    : word
                      ? "治愈真言：1d4＋感知"
                      : "治愈伤口：1d8＋施法调整",
              };
            }
            return {
              ...r,
              id: r.id || uid("roll"),
              clueId: r.clueId || inferred,
            };
          })
        : [];
    nextPending = nextPending.filter((r) => {
      if (!/战争祭司|再攻/.test(`${r.reason ?? ""} ${r.kind ?? ""}`)) return true;
      const pc = chars.find((c) => c.user_id === r.userId);
      if (!pc) return true;
      const sheet = asJson<CharacterSheet>(pc.sheet, {} as CharacterSheet);
      return left(ensureResources(sheet).resources!.warPriest) > 0;
    });

    let chapterId = st.chapter_id;
    let sceneId = st.scene_id;
    if (data.scene?.chapterId && data.scene?.sceneId) {
      chapterId = data.scene.chapterId;
      sceneId = data.scene.sceneId;
    }

    const secret = writeMemory(
      {
        ...asJson<Record<string, unknown>>(st.secret, {}),
        ...data.secretPatch,
      },
      {
        log: data.log,
        speech: data.speech,
        scene: `${chapterId}/${sceneId}`,
      },
    );

    const flags = asJson<Record<string, unknown>>(st.npc_flags, {});
    const prevMet = Array.isArray(flags.met) ? flags.met.map(String) : [];
    const sceneNpcs =
      module.chapters
        .find((c) => c.id === chapterId)
        ?.scenes.find((s) => s.id === sceneId)?.npcs ?? [];
    const knownIds = new Set(module.npcs.map((n) => n.id));
    const met = Array.from(
      new Set([
        ...prevMet,
        ...sceneNpcs,
        ...data.revealNpcs.filter((id) => knownIds.has(id)),
      ]),
    );
    const stance = applyStancePatch(
      {
        ...openingStances(module.npcs),
        ...readStances(flags),
      },
      data.stancePatch,
      knownIds,
    );
    const knownUsers = new Set(chars.map((c) => c.user_id));
    const whereBefore = readWhere(flags);
    const squads0 = readSquads(flags);
    const splitMove =
      Boolean(opts.solo) ||
      isSplitAction(opts.action) ||
      isSplitAction(beat.action);
    const wherePatch = expandWhereWithSquads(
      data.wherePatch,
      squads0,
      splitMove,
    );
    const where = applyWherePatch(
      whereBefore,
      wherePatch,
      knownUsers,
      sceneId,
    );
    const squads = splitSquadsOnDiverge(squads0, where, sceneId);
    const visited0 =
      flags.visited && typeof flags.visited === "object"
        ? { ...(flags.visited as Record<string, string[]>) }
        : {};
    for (const [id, place] of Object.entries(where)) {
      const prev = Array.isArray(visited0[id]) ? visited0[id] : [];
      visited0[id] = Array.from(new Set([...prev, place, sceneId]));
    }
    const clueLayer = readClueLayer(flags);
    for (const id of prevClues) {
      if (!clueLayer[id]) clueLayer[id] = "full";
    }
    for (const id of data.revealClues) {
      if (!clueLayer[id]) clueLayer[id] = "talk";
    }
    if (opts.kind === "roll-followup") {
      for (const r of resolved) {
        if (r.result?.success && r.clueId) clueLayer[r.clueId] = "full";
      }
    }

    const beatUserIds = opts.solo
      ? [opts.actorUserId]
      : [
          ...new Set(
            [opts.actorUserId, ...openSays.map((s) => s.userId)].flatMap((id) =>
              squadOf(squads0, id),
            ),
          ),
        ];
    let clocks = clocks0;
    const prevCombat = asCombat(st.combat);
    const combatOngoing = Boolean(
      prevCombat && prevCombat.place === actorPlace && prevCombat.waiting,
    );
    if (opts.kind === "action" && data.hat !== "refuse") {
      if (!waiting) {
        const addBeats = combatOngoing ? 0 : 1;
        const addMin = combatOngoing ? 1 : minutesForAction(opts.action);
        clocks = bumpClocks(clocks, beatUserIds, addBeats, addMin);
      }
    }
    clocks = syncReunion(clocks, whereBefore, where, sceneId, partyIds);

    let hold = hold0;
    const restNotes: string[] = [];
    if (hold && restRemain(hold, clocks, partyIds) <= 0) {
      const active = partyIds.filter((id) => !hold!.resters.includes(id));
      const maxBeats = Math.max(
        ...active.map((id) => clockOf(clocks, id).beats),
        hold.startBeats + hold.needBeats,
      );
      const maxMin = Math.max(
        ...active.map((id) => clockOf(clocks, id).minutes),
        0,
      );
      for (const id of hold.resters) {
        const row = chars.find((c) => c.user_id === id);
        if (!row) continue;
        let sheet = ensureGear(asJson<CharacterSheet>(row.sheet, {} as CharacterSheet));
        const who = sheet.name || namesById[id] || "冒险者";
        if (hold.kind === "long") {
          const done = longRestSheet(sheet);
          sheet = done.sheet;
          restNotes.push(`${who}：${done.note}`);
        } else {
          const arcane = (hold.arcane[id] ?? 0) as 0 | 1 | 2;
          sheet = shortRestSheet(sheet, arcane);
          const n = Math.max(0, hold.hitDice[id] ?? 0);
          const spent = n ? spendHitDice(sheet, n) : { sheet, note: "没有花生命骰。" };
          sheet = spent.sheet;
          restNotes.push(
            `${who} 短休结束。${spent.note} 生命 ${sheet.hp.current}/${sheet.hp.max}。`,
          );
        }
        row.sheet = sheet;
        await sql`
          update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
          where room_id = ${opts.roomId} and user_id = ${id}
        `;
        clocks = {
          ...clocks,
          [id]: { beats: maxBeats, minutes: maxMin },
        };
      }
      hold = null;
    }

    const queueExp = expireSquadQueue(readSquadQueue(flags), squads, clocks);
    const npcFlags = {
      ...flags,
      met,
      stance,
      where,
      visited: visited0,
      clueLayer,
      clock: clocks,
      restHold: hold ?? undefined,
      squads,
      squadQueue: queueExp.keep,
    };
    if (!hold) delete (npcFlags as { restHold?: unknown }).restHold;
    const pinnedClues = data.revealClues
      .filter((id) => !prevClues.includes(id))
      .map((id) => module.clues.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((c) => ({ id: c.id, name: c.name, hint: c.hint }));

    const party = chars.map((c) => ({
      userId: c.user_id,
      sheet: asJson<CharacterSheet>(c.sheet, {} as CharacterSheet),
    }));
    const foreignFight = Boolean(prevCombat && prevCombat.place !== actorPlace);
    let combat: CombatState | null = foreignFight
      ? prevCombat
      : mergeCombat({
          prev: prevCombat,
          raw: data.combat,
          actorUserId: opts.actorUserId,
          actorName: opts.actorName,
          where,
          sceneId,
          party,
          module,
        });
    if (combat && !foreignFight) {
      combat = pullPresentIntoCombat(combat, party, where, sceneId);
    }
    if (combat && !foreignFight) {
      const need = combat.order.filter(
        (o) => o.kind === "pc" && o.inCombat && !o.initDone,
      );
      for (const o of need) {
        const has = nextPending.some(
          (r) => r.userId === o.id && r.kind === "init" && !r.result,
        );
        if (has) continue;
        nextPending = [
          ...nextPending,
          {
            id: uid("roll"),
            userId: o.id,
            name: o.name,
            ability: "dex",
            kind: "init" as const,
            dc: 0,
            reason: "先攻：同处的人都要掷。被发现或开打，在场即参战。",
          },
        ];
      }
      if (need.length && combat.waiting !== "init") {
        combat = { ...combat, waiting: "init" };
      }
    }
    if (combat) {
      nextPending = nextPending.map((r) => {
        if (r.kind !== "attack" || !r.targetId) return r;
        const t = combat!.order.find(
          (o) => o.id === r.targetId || o.name === r.targetId || o.id === `npc:${r.targetId}`,
        );
        if (t) {
          return { ...r, dc: t.ac + coverAc(t.cover), targetId: t.id };
        }
        return r;
      });
    }

    let npcReqs = foreignFight ? [] : (data.npcRolls ?? []);
    if (data.hat === "oppose" && npcReqs.length === 0 && combat) {
      const active =
        combat.order.find((o) => o.id === combat!.activeId && o.kind === "npc") ??
        combat.order.find((o) => o.kind === "npc" && o.inCombat && o.hp > 0);
      const victim = combat.order.find((o) => o.kind === "pc" && o.inCombat);
      if (active && victim) {
        npcReqs = [
          {
            npcId: active.id.replace(/^npc:/, ""),
            name: active.name,
            kind: "attack",
            targetId: victim.id,
            reason: "出手",
          },
        ];
      }
    }
    const npcDice = resolveNpcDice({
      reqs: npcReqs,
      combat,
      party: party.map((p) => ({
        userId: p.userId,
        sheet: { name: p.sheet.name, ac: p.sheet.ac },
      })),
      moduleNpcs: module.npcs,
    });
    combat = npcDice.combat;
    if (npcDice.lines.length) {
      data.speech = data.speech
        .split("\n")
        .filter((ln) => !/d20\s*=/i.test(ln) && !/vs\s*(AC|DC)/i.test(ln))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    if (combat && data.spendPatch?.userId) {
      const uidSpend = data.spendPatch.userId;
      if (data.spendPatch.action) {
        const s = spendCost(combat, uidSpend, "action");
        if (s.ok) combat = s.combat;
      }
      if (data.spendPatch.bonus) {
        const s = spendCost(combat, uidSpend, "bonus");
        if (s.ok) combat = s.combat;
      }
      if (data.spendPatch.reaction) {
        const s = spendCost(combat, uidSpend, "reaction");
        if (s.ok) combat = s.combat;
      }
    }

    const involved = new Set<string>([actorPlace]);
    const beatUsers = new Set<string>([
      opts.actorUserId,
      ...openSays.map((s) => s.userId),
    ]);
    for (const id of beatUsers) {
      involved.add(placeOf(whereBefore, id, sceneId));
      involved.add(placeOf(where, id, sceneId));
    }
    const msgPlaces = [...involved].filter(Boolean);
    const msgPlace = actorPlace;

    const npcHurt: Record<string, number> = {};
    const reacts = [...(combat?.reacts ?? [])];
    for (const line of npcDice.lines) {
      if (!line.targetId || line.damage <= 0 || !line.hit) continue;
      const pc = party.find((p) => p.userId === line.targetId);
      const canShield =
        line.kind === "attack" &&
        pc &&
        uniqueSpellIds(pc.sheet).includes("shield");
      if (canShield && combat) {
        reacts.push({
          id: uid("react"),
          userId: line.targetId,
          kind: "shield",
          from: line.name,
          attackTotal: line.attackTotal ?? 0,
          ac: pc.sheet.ac,
          damage: line.damage,
          text: `${line.name} 打中你（${line.attackTotal} vs AC ${pc.sheet.ac}）。护盾术 AC＋5，耗 1 环。`,
        });
      } else {
        npcHurt[line.targetId] = (npcHurt[line.targetId] ?? 0) + line.damage;
      }
    }
    if (combat && reacts.length) {
      combat = { ...combat, waiting: "react", reacts };
    }
    for (const [userId, dmg] of Object.entries(npcHurt)) {
      const row = chars.find((c) => c.user_id === userId);
      if (!row) continue;
      const sheet0 = asJson<CharacterSheet>(row.sheet, {} as CharacterSheet);
      const hit = applyIncomingDamage(sheet0, dmg);
      row.sheet = hit.sheet;
      await sql`
        update characters set sheet = ${JSON.stringify(hit.sheet)}::jsonb, updated_at = now()
        where room_id = ${opts.roomId} and user_id = ${userId}
      `;
      if (hit.relentless) {
        data.speech = `${data.speech}\n\n${sheet0.name} ${hit.note}`.slice(0, 700);
      }
    }

    for (const u of data.characterUpdates) {
      const row = chars.find((c) => c.user_id === u.userId);
      if (!row) continue;
      const sheet = asJson<CharacterSheet>(row.sheet, {} as CharacterSheet);
      if (typeof u.hp === "number") {
        sheet.hp = {
          ...sheet.hp,
          current: Math.max(0, Math.min(sheet.hp.max, u.hp)),
        };
      }
      if (u.conditions) sheet.conditions = u.conditions;
      await sql`
        update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
        where room_id = ${opts.roomId} and user_id = ${u.userId}
      `;
    }

    const msgId = uid("msg");
    const kind =
      data.hat === "refuse"
        ? "refuse"
        : data.hat === "call_roll"
          ? "call_roll"
          : "narrate";
    const clues = Array.from(new Set([...prevClues, ...data.revealClues]));
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, tts_text, meta)
      values (
        ${msgId}, ${opts.roomId}, null, ${kind}, ${"KP"}, ${data.speech}, ${data.tts},
        ${JSON.stringify({ hat: data.hat, rolls: nextPending, revealClues: data.revealClues, clues: pinnedClues, place: msgPlace, places: msgPlaces, npcRolls: npcDice.lines })}::jsonb
      )
    `;
    for (const note of restNotes) {
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body, meta)
        values (
          ${uid("msg")}, ${opts.roomId}, null, ${"narrate"}, ${"KP"}, ${note},
          ${JSON.stringify({ place: "all" })}::jsonb
        )
      `;
    }
    if (restNotes.length) {
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body, meta)
        values (
          ${uid("msg")}, ${opts.roomId}, null, ${"narrate"}, ${"KP"},
          ${"休息结束。两边的时间对齐了。"},
          ${JSON.stringify({ place: "all" })}::jsonb
        )
      `;
    }
    const destGroups = new Map<string, { names: string[]; froms: string[] }>();
    for (const id of partyIds) {
      const from = placeOf(whereBefore, id, st.scene_id);
      const to = placeOf(where, id, sceneId);
      if (from === to) continue;
      const cur = destGroups.get(to) ?? { names: [], froms: [] };
      cur.names.push(namesById[id] || "有人");
      cur.froms.push(from);
      destGroups.set(to, cur);
    }
    for (const [to, g] of destGroups) {
      const label =
        module.chapters.flatMap((c) => c.scenes).find((s) => s.id === to)
          ?.location ||
        module.chapters.flatMap((c) => c.scenes).find((s) => s.id === to)?.name ||
        to;
      const places = [...new Set([...g.froms, to])];
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body, meta)
        values (
          ${uid("msg")}, ${opts.roomId}, null, ${"stage"}, ${"去向"},
          ${`${g.names.join("、")} 去了 ${label}`},
          ${JSON.stringify({ place: places[0], places })}::jsonb
        )
      `;
    }
    if (queueExp.dropped.length) {
      const who = [...new Set(queueExp.dropped.map((q) => q.name || "队员"))].join("、");
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body, meta)
        values (
          ${uid("msg")}, ${opts.roomId}, null, ${"stage"}, ${"队内"},
          ${`${who} 的队内提议未获队长批准，随这一拍消散。`},
          ${JSON.stringify({ place: actorPlace, places: [actorPlace] })}::jsonb
        )
      `;
    }
    for (const id of [...beat.ids, opts.consumeSayId].filter(Boolean) as string[]) {
      await markConsumed(sql, id);
    }
    for (const line of npcDice.lines) {
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body, meta)
        values (
          ${uid("msg")}, ${opts.roomId}, null, ${"roll"}, ${line.name}, ${line.text},
          ${JSON.stringify({ place: msgPlace, places: msgPlaces, npc: true, kind: line.kind, hit: line.hit, damage: line.damage })}::jsonb
        )
      `;
    }
    if (data.log) {
      await sql`
        insert into session_logs (id, room_id, entry)
        values (${uid("log")}, ${opts.roomId}, ${data.log})
      `;
    }

    const live = (
      await sql<StateRow>`select * from game_states where room_id = ${opts.roomId}`
    )[0];
    const liveFlags = asJson<Record<string, unknown>>(live?.npc_flags, {});
    const liveWhere = readWhere(liveFlags);
    const liveClocks = readClocks(liveFlags);
    const changedIds = new Set([
      ...beatUserIds,
      ...Object.keys(where).filter((id) => where[id] !== whereBefore[id]),
    ]);
    const mergedWhere = { ...liveWhere };
    const mergedClocks = { ...liveClocks };
    for (const id of changedIds) {
      if (where[id]) mergedWhere[id] = where[id];
      if (clocks[id]) mergedClocks[id] = clocks[id];
    }
    const liveVisited =
      liveFlags.visited && typeof liveFlags.visited === "object"
        ? { ...(liveFlags.visited as Record<string, string[]>) }
        : {};
    const mergedVisited = { ...liveVisited };
    for (const [id, places] of Object.entries(visited0)) {
      mergedVisited[id] = Array.from(
        new Set([...(mergedVisited[id] ?? []), ...(places ?? [])]),
      );
    }
    const liveBusy = readBusyPlaces(liveFlags);
    delete liveBusy[actorPlace];
    const liveMet = Array.isArray(liveFlags.met) ? liveFlags.met.map(String) : [];
    const liveHold = readRestHold(liveFlags);
    const mergedFlags: Record<string, unknown> = {
      ...liveFlags,
      ...npcFlags,
      met: Array.from(new Set([...liveMet, ...met])),
      where: mergedWhere,
      clock: mergedClocks,
      visited: mergedVisited,
      kpBusyPlaces: liveBusy,
      restHold: hold ?? liveHold ?? undefined,
      squads: splitSquadsOnDiverge(readSquads(liveFlags), mergedWhere, sceneId),
    };
    if (!mergedFlags.restHold) delete mergedFlags.restHold;

    const liveCombat = asCombat(live?.combat);
    let commitCombat = combat;
    if (liveCombat && liveCombat.place !== actorPlace) {
      commitCombat = liveCombat;
    }

    const livePending = asJson<PendingRoll[]>(live?.pending_rolls, []);
    const ourUsers = new Set(beatUserIds);
    const commitPending = [
      ...livePending.filter((r) => !ourUsers.has(r.userId)),
      ...nextPending,
    ];
    const liveClues = asJson<string[]>(live?.revealed_clues, []);
    const commitClues = Array.from(new Set([...liveClues, ...clues]));
    const liveSecret = asJson<Record<string, unknown>>(live?.secret, {});
    const commitSecret = writeMemory(
      { ...liveSecret, ...data.secretPatch },
      {
        log: data.log,
        speech: data.speech,
        scene: `${chapterId}/${sceneId}`,
      },
    );
    const commitChapter =
      data.scene?.chapterId && data.scene?.sceneId
        ? chapterId
        : (live?.chapter_id ?? chapterId);
    const commitScene =
      data.scene?.chapterId && data.scene?.sceneId
        ? sceneId
        : (live?.scene_id ?? sceneId);

    await sql`
      update game_states set
        chapter_id = ${commitChapter},
        scene_id = ${commitScene},
        revealed_clues = ${JSON.stringify(commitClues)}::jsonb,
        npc_flags = ${JSON.stringify(mergedFlags)}::jsonb,
        combat = ${commitCombat ? JSON.stringify(commitCombat) : null}::jsonb,
        pending_rolls = ${JSON.stringify(commitPending)}::jsonb,
        secret = ${JSON.stringify(commitSecret)}::jsonb,
        kp_busy = ${anyPlaceBusy(mergedFlags)},
        updated_at = now()
      where room_id = ${opts.roomId}
    `;

    return { ok: true as const, messageId: msgId, hat: data.hat, tts: data.tts };
  } catch (err) {
    await unlockPlaceNow();
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "KP 出错了",
    };
  }
}

export function readClueLayer(
  flags: Record<string, unknown>,
): Record<string, "talk" | "full"> {
  const raw = flags.clueLayer;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, "talk" | "full"> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === "talk" || v === "full") out[k] = v;
  }
  return out;
}

function inferClueId(
  roll: PendingRoll,
  module: ReturnType<typeof getModule>,
  sceneId: string,
): string | undefined {
  if (roll.clueId && module.clues.some((c) => c.id === roll.clueId)) return roll.clueId;
  if (roll.kind && roll.kind !== "check") return undefined;
  const sceneClues = new Set(
    module.chapters.flatMap((c) => c.scenes).find((s) => s.id === sceneId)?.clues ??
      module.clues.map((c) => c.id),
  );
  const hits = module.clues.filter(
    (c) => sceneClues.has(c.id) && c.dc && c.dc.skill === roll.skill,
  );
  if (hits.length === 1) return hits[0].id;
  return undefined;
}
