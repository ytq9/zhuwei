import type { CharacterSheet } from "@/lib/dnd/types";
import { abilityMod } from "@/lib/utils";
import { itemById } from "@/lib/dnd/gear";
import type { ModuleDef } from "@/lib/module/schema";
import { placeOf } from "./where";

export type Band = "melee" | "near" | "far";
export type Cover = "none" | "half" | "three" | "total";

export type Hazard = {
  id: string;
  name: string;
  text: string;
  dc?: number;
  save?: string;
  damage?: string;
  when: "enter" | "start" | "move" | "trigger";
};

export type Combatant = {
  id: string;
  name: string;
  kind: "pc" | "npc";
  init: number;
  initDone: boolean;
  band: Band;
  cover: Cover;
  inCombat: boolean;
  /** 本回合已用撤离，离开贴身不吃借机。 */
  disengaged: boolean;
  ac: number;
  hp: number;
  hpMax: number;
  spend: TurnSpend;
};

export type TurnSpend = {
  action: boolean;
  bonus: boolean;
  reaction: boolean;
  attacked: boolean;
};

export function freshSpend(): TurnSpend {
  return { action: true, bonus: true, reaction: true, attacked: false };
}

function patchSpend(c: CombatState, userId: string, spend: TurnSpend): CombatState {
  return {
    ...c,
    order: c.order.map((o) => (o.id === userId ? { ...o, spend } : o)),
  };
}

export function spendCost(
  c: CombatState,
  userId: string,
  cost: "action" | "bonus" | "reaction" | "attack",
  opts?: { classId?: string; subclassId?: string; bonusAttack?: boolean },
): { ok: true; combat: CombatState } | { ok: false; error: string } {
  const me = c.order.find((o) => o.id === userId);
  if (!me?.inCombat) return { ok: false, error: "你不在这场战斗里" };
  const s = me.spend ?? freshSpend();
  if (cost === "attack") {
    const bonusHit = Boolean(opts?.bonusAttack);
    if (bonusHit) {
      if (!s.attacked) {
        return { ok: false, error: "战争祭司要先用动作打出一次，再花附赠" };
      }
      if (!s.bonus) return { ok: false, error: "本回合附赠已经用过" };
      return {
        ok: true,
        combat: patchSpend(c, userId, { ...s, bonus: false }),
      };
    }
    if (s.action) {
      return {
        ok: true,
        combat: patchSpend(c, userId, { ...s, action: false, attacked: true }),
      };
    }
    if (opts?.subclassId === "war" && s.bonus && s.attacked) {
      return {
        ok: true,
        combat: patchSpend(c, userId, { ...s, bonus: false }),
      };
    }
    if (s.attacked && opts?.subclassId === "war") {
      return { ok: false, error: "动作和附赠都用过了，不能再攻击" };
    }
    return {
      ok: false,
      error: "本回合动作已用。攻击或施法各占一个动作，不能叠。战争领域已攻击后可用附赠再打一次。",
    };
  }
  if (cost === "action") {
    if (!s.action) return { ok: false, error: "本回合动作已经用过" };
    return { ok: true, combat: patchSpend(c, userId, { ...s, action: false }) };
  }
  if (cost === "bonus") {
    if (!s.bonus) return { ok: false, error: "本回合附赠动作已经用过" };
    return { ok: true, combat: patchSpend(c, userId, { ...s, bonus: false }) };
  }
  if (!s.reaction) return { ok: false, error: "本回合反应已经用过" };
  return { ok: true, combat: patchSpend(c, userId, { ...s, reaction: false }) };
}

export type CombatState = {
  place: string;
  round: number;
  activeId: string | null;
  waiting: "init" | "turn" | "damage" | "death" | "oa" | "react" | null;
  order: Combatant[];
  hazards: Hazard[];
  reacts?: CombatReact[];
};

export type CombatReact = {
  id: string;
  userId: string;
  kind: "shield";
  from: string;
  attackTotal: number;
  ac: number;
  damage: number;
  text: string;
};

export type PublicCombat = {
  place: string;
  round: number;
  activeId: string | null;
  waiting: CombatState["waiting"];
  hazards: { id: string; name: string; text: string }[];
  order: {
    id: string;
    name: string;
    kind: "pc" | "npc";
    init: number | null;
    band: Band;
    cover: Cover;
    inCombat: boolean;
    spend?: TurnSpend;
  }[];
  reacts?: CombatReact[];
};

export function publicCombat(c: CombatState | null): PublicCombat | null {
  if (!c) return null;
  return {
    place: c.place,
    round: c.round,
    activeId: c.activeId,
    waiting: c.waiting,
    hazards: (c.hazards ?? []).map((h) => ({
      id: h.id,
      name: h.name,
      text: h.text,
    })),
    reacts: (c.reacts ?? []).map((r) => ({
      id: r.id,
      userId: r.userId,
      kind: r.kind,
      from: r.from,
      attackTotal: r.attackTotal,
      ac: r.ac,
      damage: r.damage,
      text: r.text,
    })),
    order: c.order.map((o) => ({
      id: o.id,
      name: o.name,
      kind: o.kind,
      init: o.initDone ? o.init : null,
      band: o.band,
      cover: o.cover ?? "none",
      inCombat: o.inCombat,
      spend: o.spend ?? freshSpend(),
    })),
  };
}

export function asCombat(v: unknown): CombatState | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Partial<CombatState>;
  if (!c.place || !Array.isArray(c.order)) return null;
  return {
    place: String(c.place),
    round: Number(c.round) || 1,
    activeId: c.activeId ? String(c.activeId) : null,
    waiting: c.waiting ?? "turn",
    order: c.order.map((o) => ({
      id: String(o.id),
      name: String(o.name),
      kind: o.kind === "npc" ? "npc" : "pc",
      init: Number(o.init) || 0,
      initDone: Boolean(o.initDone),
      band: o.band === "near" || o.band === "far" ? o.band : "melee",
      cover: o.cover === "half" || o.cover === "three" || o.cover === "total" ? o.cover : "none",
      inCombat: o.inCombat !== false,
      disengaged: Boolean(o.disengaged),
      ac: Number(o.ac) || 12,
      hp: Number(o.hp) || 1,
      hpMax: Number(o.hpMax) || Number(o.hp) || 1,
      spend: {
        action: o.spend?.action !== false,
        bonus: o.spend?.bonus !== false,
        reaction: o.spend?.reaction !== false,
        attacked: Boolean(o.spend?.attacked),
      },
    })),
    hazards: Array.isArray(c.hazards)
      ? c.hazards.map((h) => ({
          id: String(h.id),
          name: String(h.name),
          text: String(h.text),
          dc: h.dc,
          save: h.save,
          damage: h.damage,
          when: h.when === "start" || h.when === "move" || h.when === "trigger" ? h.when : "enter",
        }))
      : [],
    reacts: Array.isArray(c.reacts)
      ? c.reacts.map((r) => ({
          id: String(r.id),
          userId: String(r.userId),
          kind: "shield" as const,
          from: String(r.from ?? ""),
          attackTotal: Number(r.attackTotal) || 0,
          ac: Number(r.ac) || 10,
          damage: Number(r.damage) || 0,
          text: String(r.text ?? ""),
        }))
      : [],
  };
}

export function parseNpcStats(stats: string) {
  const ac = /AC\s*(\d+)/i.exec(stats);
  const hp = /HP\s*(\d+)/i.exec(stats);
  const dex = /敏捷\s*\+?(-?\d+)/.exec(stats);
  const atk = /([+-]\d+)\s+(\d+d\d+(?:[+-]\d+)?)/.exec(stats);
  return {
    ac: ac ? Number(ac[1]) : 12,
    hp: hp ? Number(hp[1]) : 12,
    dex: dex ? Number(dex[1]) : 1,
    attack: atk ? Number(atk[1]) : 4,
    damage: atk ? atk[2] : "1d8+2",
  };
}

function d20() {
  return 1 + Math.floor(Math.random() * 20);
}

function parseDmg(expr: string) {
  const dice = rollDiceExpr(expr);
  const add = /[+-]\s*(\d+)\s*$/.exec(expr.replace(/\s/g, ""));
  const extra = add && !/d\d+[+-]\d+$/i.test(expr.replace(/\s/g, "")) ? 0 : 0;
  const tail = /d\d+([+-]\d+)/i.exec(expr.replace(/\s/g, ""));
  const flat = tail ? Number(tail[1]) : 0;
  void extra;
  return { total: dice.total + flat, parts: dice.parts, flat };
}

export type NpcDiceLine = {
  npcId: string;
  name: string;
  kind: string;
  text: string;
  hit: boolean;
  damage: number;
  targetId?: string;
  attackTotal?: number;
  ac?: number;
};

export function resolveNpcDice(opts: {
  reqs: {
    npcId: string;
    name?: string;
    kind: string;
    bonus?: number;
    dc?: number;
    targetId?: string;
    dice?: string;
    reason: string;
  }[];
  combat: CombatState | null;
  party: { userId: string; sheet: { name: string; ac: number } }[];
  moduleNpcs: { id: string; name: string; stats: string }[];
}): { lines: NpcDiceLine[]; combat: CombatState | null } {
  let combat = opts.combat;
  const lines: NpcDiceLine[] = [];
  for (const r of opts.reqs) {
    const id = r.npcId.startsWith("npc:") ? r.npcId : `npc:${r.npcId}`;
    const def = opts.moduleNpcs.find(
      (n) => n.id === r.npcId || `npc:${n.id}` === id || n.name === r.name,
    );
    const st = def ? parseNpcStats(def.stats) : { attack: 4, damage: "1d8+2", ac: 12, hp: 12, dex: 1 };
    const fighter = combat?.order.find((o) => o.id === id || o.name === def?.name);
    const name = r.name || fighter?.name || def?.name || "敌人";
    const kind = r.kind === "save" || r.kind === "check" || r.kind === "init" ? r.kind : "attack";
    const bonus =
      typeof r.bonus === "number"
        ? r.bonus
        : kind === "save" || kind === "init"
          ? st.dex
          : st.attack;
    const tgt = r.targetId
      ? opts.party.find((p) => p.userId === r.targetId) ||
        combat?.order.find((o) => o.id === r.targetId || o.name === r.targetId)
      : combat?.order.find((o) => o.kind === "pc" && o.inCombat);
    const tgtName =
      tgt && "sheet" in tgt ? tgt.sheet.name : tgt && "name" in tgt ? tgt.name : "";
    const tgtAc =
      tgt && "sheet" in tgt
        ? tgt.sheet.ac
        : tgt && "ac" in tgt
          ? Number(tgt.ac)
          : 13;
    const dc =
      kind === "attack"
        ? r.dc && r.dc > 5
          ? r.dc
          : tgtAc + coverAc(fighter && tgt && "cover" in tgt ? (tgt as { cover?: Cover }).cover : "none")
        : r.dc ?? 13;
    const face = d20();
    const total = face + bonus;
    const hit = face === 20 ? true : face === 1 ? false : total >= dc;
    const vs = kind === "attack" ? `AC ${dc}` : `DC ${dc}`;
    const verb =
      kind === "attack" ? "攻击" : kind === "save" ? "豁免" : kind === "init" ? "先攻" : "检定";
    let dmg = 0;
    let dmgBit = "";
    if (kind === "attack" && hit) {
      const expr = r.dice || st.damage;
      const rolled = parseDmg(expr);
      dmg = Math.max(1, rolled.total);
      dmgBit = ` 伤害 ${expr}=${dmg}`;
      if (combat && r.targetId) combat = hurtNpc(combat, r.targetId, dmg);
    }
    const outcome =
      kind === "init" ? String(total) : hit ? (kind === "attack" ? "命中" : "成功") : kind === "attack" ? "失手" : "失败";
    const who = tgtName && kind === "attack" ? ` → ${tgtName}` : "";
    lines.push({
      npcId: id,
      name,
      kind,
      text: `${name} ${verb}${who}：d20=${face}${bonus >= 0 ? "+" : ""}${bonus}=${total} vs ${vs}，${outcome}。${dmgBit}`.trim(),
      hit,
      damage: dmg,
      targetId: r.targetId,
      attackTotal: kind === "attack" ? total : undefined,
      ac: kind === "attack" ? dc : undefined,
    });
  }
  return { lines, combat };
}

export function weaponAttack(sheet: CharacterSheet) {
  const item = itemById(sheet.equipped?.main);
  const finesse = Boolean(item?.text.includes("灵巧"));
  const ranged = Boolean(item?.text.includes("远程"));
  const thrown = Boolean(item?.text.includes("投掷"));
  const reach = Boolean(item?.text.includes("触及"));
  const str = abilityMod(sheet.scores?.str ?? 10);
  const dex = abilityMod(sheet.scores?.dex ?? 10);
  const ability: "str" | "dex" =
    ranged || (finesse && dex > str) || (thrown && dex > str) ? "dex" : "str";
  const bonus = (ability === "dex" ? dex : str) + (sheet.proficiency ?? 2);
  const span = /(\d+)\s*\/\s*(\d+)/.exec(item?.text ?? "");
  return {
    bonus,
    ability,
    damage: item?.damage ?? "1 钝击",
    weapon: item?.name ?? "徒手",
    ranged,
    thrown,
    reach,
    melee: !ranged,
    normalFt: span ? Number(span[1]) : ranged ? 80 : thrown ? 20 : reach ? 10 : 5,
    longFt: span ? Number(span[2]) : ranged ? 320 : thrown ? 60 : 5,
  };
}

export function coverAc(cover: Cover | undefined) {
  if (cover === "half") return 2;
  if (cover === "three") return 5;
  if (cover === "total") return 99;
  return 0;
}

/** 剧场制：贴身≈5尺 近≈30尺 远≈80–120尺。超出当前场景＝不够。 */
export function shotCheck(
  attacker: Combatant,
  target: Combatant,
  w: ReturnType<typeof weaponAttack>,
): { ok: boolean; disadvantage: boolean; reason: string } {
  if (target.cover === "total") {
    return { ok: false, disadvantage: false, reason: "全掩体：看不见，不能选为目标" };
  }
  const a = attacker.band;
  const t = target.band;
  const close = a === "melee" && t === "melee";
  const adjacent = close || (w.reach && (a === "near" || t === "near") && a !== "far" && t !== "far");

  if (w.ranged && !w.thrown) {
    if (close) {
      return { ok: true, disadvantage: true, reason: "贴身拉弓：劣势（5e）" };
    }
    if (a === "far" && t === "far") {
      return { ok: true, disadvantage: true, reason: "远距：长射程，劣势" };
    }
    return { ok: true, disadvantage: false, reason: "射程内" };
  }
  if (w.thrown) {
    if (close) {
      return { ok: true, disadvantage: false, reason: "贴身改为近战投掷武器" };
    }
    if (a === "far" || t === "far") {
      return { ok: true, disadvantage: true, reason: "投掷长射程：劣势" };
    }
    return { ok: true, disadvantage: false, reason: "投掷正常射程" };
  }
  if (w.melee) {
    if (adjacent) return { ok: true, disadvantage: false, reason: "近战够得到" };
    return { ok: false, disadvantage: false, reason: "近战够不到，先靠近（贴身）或换远程" };
  }
  return { ok: true, disadvantage: false, reason: "" };
}

export type LeaveKind = "disengage" | "flee" | "withdraw" | "surrender";

export function dropFromCombat(c: CombatState, userId: string): CombatState | null {
  const order = c.order.map((o) =>
    o.id === userId ? { ...o, inCombat: false } : o,
  );
  const fighting = order.filter((o) => o.inCombat);
  const reacts = (c.reacts ?? []).filter((r) => r.userId !== userId);
  if (!fighting.some((o) => o.kind === "pc")) return null;
  let activeId = c.activeId;
  if (activeId === userId) {
    activeId = fighting.find((o) => o.id !== userId)?.id ?? null;
  }
  return { ...c, order, reacts, activeId };
}

export function leaveCombat(
  c: CombatState,
  userId: string,
  kind: LeaveKind,
  classId?: string,
): {
  combat: CombatState;
  oa: boolean;
  note: string;
} {
  const me = c.order.find((o) => o.id === userId);
  if (!me || !me.inCombat) {
    return { combat: c, oa: false, note: "你不在这场战斗里" };
  }
  const threatened = me.band === "melee" && c.order.some((o) => o.inCombat && o.kind !== me.kind && o.band === "melee" && o.hp > 0);
  const rogue = classId === "rogue";

  if (kind === "disengage") {
    const order = c.order.map((o) =>
      o.id === userId
        ? { ...o, disengaged: true, band: (o.band === "melee" ? "near" : o.band) as Band }
        : o,
    );
    return {
      combat: { ...c, order },
      oa: false,
      note: rogue
        ? "灵巧动作撤离：离开贴身，不吃借机。仍在战场。"
        : "撤离（动作）：离开贴身，不吃借机。仍在战场，本回合不再攻击。",
    };
  }
  if (kind === "surrender") {
    const order = c.order.map((o) =>
      o.id === userId ? { ...o, inCombat: false, band: "near" as Band } : o,
    );
    return { combat: { ...c, order, waiting: c.activeId === userId ? "turn" : c.waiting }, oa: false, note: "投降。武器放下，不再参战。" };
  }
  if (kind === "flee") {
    const oa = threatened && !me.disengaged;
    const order = c.order.map((o) =>
      o.id === userId ? { ...o, band: "far" as const, disengaged: false } : o,
    );
    return {
      combat: { ...c, order },
      oa,
      note: oa
        ? "从贴身直接跑：吃一次借机攻击，然后到远处。仍在战场。"
        : "撤到远处。仍在战场，除非再退出。",
    };
  }
  // withdraw: leave the fight entirely (must not be melee, or eat OA)
  const oa = threatened && !me.disengaged;
  const order = c.order.map((o) =>
    o.id === userId ? { ...o, inCombat: false, band: "far" as const } : o,
  );
  const live = order.filter((o) => o.inCombat && (o.kind === "npc" ? o.hp > 0 : true));
  const ended = !live.some((o) => o.kind === "npc") || !live.some((o) => o.kind === "pc");
  return {
    combat: ended
      ? { ...c, order, waiting: null, activeId: null }
      : { ...c, order, activeId: c.activeId === userId ? (live[0]?.id ?? null) : c.activeId },
    oa,
    note: oa
      ? "在贴身退出战场：吃一次借机，然后离开这一处。"
      : "退出战场。你不再参战；要回去得再加入。",
  };
}

export function sceneHazards(module: ModuleDef, place: string): Hazard[] {
  for (const ch of module.chapters) {
    for (const s of ch.scenes) {
      if (s.id === place && s.hazards?.length) return s.hazards;
    }
  }
  return [];
}

export function rollDiceExpr(expr: string, crit = false) {
  const m = /(\d+)d(\d+)/i.exec(expr);
  if (!m) {
    const n = Number.parseInt(expr, 10);
    return { total: Number.isFinite(n) ? n : 1, parts: [] as number[] };
  }
  const count = Number(m[1]) * (crit ? 2 : 1);
  const die = Number(m[2]);
  const parts = Array.from(
    { length: count },
    () => 1 + Math.floor(Math.random() * die),
  );
  return { total: parts.reduce((a, b) => a + b, 0), parts };
}

export function mergeCombat(opts: {
  prev: CombatState | null;
  raw: unknown;
  actorUserId: string;
  actorName: string;
  where: Record<string, string>;
  sceneId: string;
  party: { userId: string; sheet: CharacterSheet }[];
  module: ModuleDef;
}): CombatState | null {
  const { prev, raw, actorUserId, where, sceneId, party, module } = opts;
  if (raw == null) return prev;
  if (typeof raw === "object" && raw && "ended" in raw && (raw as { ended?: boolean }).ended) {
    return null;
  }

  const actorPlace = placeOf(where, actorUserId, sceneId);
  let next = prev;

  const r = raw as {
    start?: boolean;
    place?: string;
    round?: number;
    activeId?: string;
    enemies?: string[];
    order?: unknown;
    waiting?: CombatState["waiting"];
  };

  const wantStart =
    Boolean(r.start) ||
    (!prev && (Array.isArray(r.enemies) || Array.isArray(r.order) || r.round));

  if (wantStart && !prev) {
    const place = String(r.place || actorPlace);
    const order: Combatant[] = [];
    for (const p of party) {
      if (placeOf(where, p.userId, sceneId) !== place) continue;
      const isActor = p.userId === actorUserId;
      order.push({
        id: p.userId,
        name: p.sheet.name,
        kind: "pc",
        init: 0,
        initDone: false,
        band: isActor ? "melee" : "near",
        cover: "none",
        inCombat: true,
        disengaged: false,
        ac: p.sheet.ac,
        hp: p.sheet.hp.current,
        hpMax: p.sheet.hp.max,
        spend: freshSpend(),
      });
    }
    const enemyNames = [
      ...(Array.isArray(r.enemies) ? r.enemies.map(String) : []),
      ...(Array.isArray(r.order)
        ? (r.order as unknown[]).map((x) =>
            typeof x === "string" ? x : String((x as { name?: string }).name ?? ""),
          )
        : []),
    ];
    for (const npc of module.npcs) {
      const hit = enemyNames.some(
        (n) => n === npc.id || n === npc.name || npc.name.includes(n) || n.includes(npc.name),
      );
      if (!hit && enemyNames.length) continue;
      if (!hit) continue;
      const st = parseNpcStats(npc.stats);
      const init = d20() + st.dex;
      order.push({
        id: `npc:${npc.id}`,
        name: npc.name,
        kind: "npc",
        init,
        initDone: true,
        band: "melee",
        cover: "none",
        inCombat: true,
        disengaged: false,
        ac: st.ac,
        hp: st.hp,
        hpMax: st.hp,
        spend: freshSpend(),
      });
    }
    if (!order.some((o) => o.kind === "npc") && module.npcs.length) {
      const npc =
        module.npcs.find((n) => enemyNames.some((e) => n.name.includes(e))) ??
        module.npcs.find((n) => n.id === "naes") ??
        module.npcs[0];
      const st = parseNpcStats(npc.stats);
      order.push({
        id: `npc:${npc.id}`,
        name: npc.name,
        kind: "npc",
        init: d20() + st.dex,
        initDone: true,
        band: "melee",
        cover: "none",
        inCombat: true,
        disengaged: false,
        ac: st.ac,
        hp: st.hp,
        hpMax: st.hp,
        spend: freshSpend(),
      });
    }
    next = {
      place,
      round: 1,
      activeId: null,
      waiting: "init",
      order,
      hazards: sceneHazards(module, place),
    };
  }

  if (!next) return null;
  if (r.place) next = { ...next, place: String(r.place) };
  if (r.round) next = { ...next, round: Number(r.round) || next.round };
  if (r.activeId) {
    const id = String(r.activeId);
    const changed = id !== next.activeId;
    next = {
      ...next,
      activeId: id,
      order: changed
        ? next.order.map((o) => (o.id === id ? { ...o, spend: freshSpend() } : o))
        : next.order,
    };
  }
  if (r.waiting) next = { ...next, waiting: r.waiting };
  return next;
}

/** 5e：同一处的人都在这场遭遇里。被发现、拔刀、NPC 动手，在场即进先攻，没有同处围观。 */
export function pullPresentIntoCombat(
  c: CombatState,
  party: { userId: string; sheet: CharacterSheet }[],
  where: Record<string, string>,
  sceneId: string,
): CombatState {
  let order = c.order;
  let waiting = c.waiting;
  let changed = false;
  for (const p of party) {
    if (placeOf(where, p.userId, sceneId) !== c.place) continue;
    const existing = order.find((o) => o.id === p.userId);
    if (!existing) {
      changed = true;
      waiting = "init";
      order = [
        ...order,
        {
          id: p.userId,
          name: p.sheet.name,
          kind: "pc",
          init: 0,
          initDone: false,
          band: "near",
          cover: "none",
          inCombat: true,
          disengaged: false,
          ac: p.sheet.ac,
          hp: p.sheet.hp.current,
          hpMax: p.sheet.hp.max,
          spend: freshSpend(),
        },
      ];
    } else if (!existing.inCombat) {
      changed = true;
      order = order.map((o) =>
        o.id === p.userId ? { ...o, inCombat: true } : o,
      );
      if (!existing.initDone) waiting = "init";
    }
  }
  if (!changed) return c;
  return { ...c, order, waiting };
}

export function applyInit(c: CombatState, userId: string, total: number): CombatState {
  const order = c.order.map((o) =>
    o.id === userId ? { ...o, init: total, initDone: true } : o,
  );
  const pcs = order.filter((o) => o.kind === "pc" && o.inCombat);
  const ready = pcs.every((o) => o.initDone);
  if (!ready) return { ...c, order, waiting: "init" };
  const sorted = [...order].sort((a, b) => b.init - a.init || a.name.localeCompare(b.name));
  const first = sorted.find((o) => o.inCombat) ?? null;
  return {
    ...c,
    order: sorted,
    waiting: "turn",
    activeId: first?.id ?? null,
    round: 1,
  };
}

export function nextTurn(c: CombatState): CombatState {
  const live = c.order.filter((o) => o.inCombat && (o.kind === "npc" ? o.hp > 0 : true));
  if (!live.length) return { ...c, waiting: null, activeId: null };
  const idx = live.findIndex((o) => o.id === c.activeId);
  const next = live[(idx + 1) % live.length];
  const wrapped = idx >= 0 && (idx + 1) % live.length === 0;
  const order = (wrapped
    ? c.order.map((o) => ({ ...o, disengaged: false }))
    : c.order
  ).map((o) => (o.id === next.id ? { ...o, spend: freshSpend() } : o));
  return {
    ...c,
    order,
    activeId: next.id,
    waiting: next.hp <= 0 && next.kind === "pc" ? "death" : "turn",
    round: wrapped ? c.round + 1 : c.round,
  };
}

export function joinCombat(
  c: CombatState,
  pc: { userId: string; sheet: CharacterSheet },
): CombatState {
  if (c.order.some((o) => o.id === pc.userId)) {
    return {
      ...c,
      order: c.order.map((o) =>
        o.id === pc.userId ? { ...o, inCombat: true } : o,
      ),
    };
  }
  return {
    ...c,
    waiting: "init",
    order: [
      ...c.order,
      {
        id: pc.userId,
        name: pc.sheet.name,
        kind: "pc",
        init: 0,
        initDone: false,
        band: "near",
        cover: "none",
        inCombat: true,
        disengaged: false,
        ac: pc.sheet.ac,
        hp: pc.sheet.hp.current,
        hpMax: pc.sheet.hp.max,
        spend: freshSpend(),
      },
    ],
  };
}

export function hurtNpc(c: CombatState, targetId: string, dmg: number): CombatState {
  const order = c.order.map((o) => {
    if (o.id !== targetId && o.name !== targetId && o.id !== `npc:${targetId}`) return o;
    const hp = Math.max(0, o.hp - dmg);
    return { ...o, hp, inCombat: hp > 0 ? o.inCombat : o.kind === "pc" };
  });
  const liveNpc = order.some((o) => o.kind === "npc" && o.hp > 0 && o.inCombat);
  if (!liveNpc) return { ...c, order, waiting: null, activeId: null };
  return { ...c, order };
}

export function combatPromptBlock(c: CombatState | null, actorUserId: string, actorPlace: string) {
  if (!c) {
    return `战斗：无。有人拔武器、施敌对法术、潜行被发现、或 NPC 动手时，combat.start=true，并写 enemies 的模组 id（如 naes）。同一处的 PC 全部 inCombat=true、全部掷先攻。别处的人听不见细节，不要拉进先攻。`;
  }
  const here = actorPlace === c.place;
  const lines = c.order
    .map((o) => {
      const s = o.spend ?? freshSpend();
      const eco = o.inCombat
        ? ` 资源${s.action ? "动作" : ""}${s.bonus ? "附赠" : ""}${s.reaction ? "反应" : ""}${!s.action && !s.bonus && !s.reaction ? "耗尽" : ""}`
        : "";
      return `- ${o.name}(${o.id}) ${o.kind} 先攻${o.initDone ? o.init : "未掷"} 距离${o.band} ${o.inCombat ? "参战" : "未参战"} ${o.kind === "npc" ? `AC${o.ac} HP${o.hp}/${o.hpMax}` : ""}${eco}`;
    })
    .join("\n");
  const hz = (c.hazards ?? []).map((h) => `· ${h.name}：${h.text}`).join("\n");
  return `战斗进行中：地点 ${c.place} 第 ${c.round} 轮 当前 ${c.activeId ?? "无"} waiting=${c.waiting}
${lines}
场地：${hz || "无特殊危害"}
- 行动者在 ${actorPlace}。${here ? "你只写这一处。" : "行动者不在战场：不要推进回合、不要让他隔空砍人。他听见的只是远处动静。"}
- 距离只有贴身 / 近 / 远。近战须贴身（触及武器可近）。远程贴身劣势；投掷到远为长射程劣势；全掩体不能打。
- 半掩 AC+2，四分之三 +5。写在目标 cover 上，命中 dc 要用加算后的 AC。
- 每回合 1 动作、1 附赠、1 反应。祝福/神导/攻击都占动作，同一回合不能又祝福又挥剑。战争领域：动作打过一次后可用附赠再打一次，次数＝感知调整，第二下掷出才扣。盗贼撤离可用附赠。护盾占反应。
- 脱离：撤离不吃借机但仍在场。逃跑到远：若从贴身且未撤离，吃借机。退出战场：离开这一处，未撤离贴身则吃借机。投降不吃借机。
- 同一处即参战。没有「同处围观」。不想打就撤离、跑开、退出或投降。
- 战斗中可以说话：短句、喊话随时可说，不耗动作，即使不是自己的回合。长谈、谈判检定才占动作，须轮到。
- 命中对 AC，伤害用武器骰。结束时 combat.ended=true。`;
}
