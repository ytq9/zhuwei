import { abilityMod } from "@/lib/utils";
import { classById, spellById, SPELLS } from "./catalog";
import type { CharacterSheet } from "./types";
import { itemById } from "./gear";

export type Charge = { max: number; used: number };

export type Resources = {
  slot1: Charge;
  slot2: Charge;
  hitDice: Charge & { die: number };
  channel: Charge;
  rage: Charge & { on: boolean };
  surge: Charge;
  secondWind: Charge;
  superiority: Charge;
  warPriest: Charge;
  breath: Charge;
  relentless: Charge;
  arcaneRecovery: boolean;
  conc: { id: string; name: string } | null;
  ward: number;
  gold: number;
  arrow: number;
  bolt: number;
  torch: number;
  ration: number;
};

export function emptyCharge(): Charge {
  return { max: 0, used: 0 };
}

export function initResources(sheet: Pick<CharacterSheet, "classId" | "subclassId" | "raceId" | "scores" | "equipment" | "backpack" | "equipped">): Resources {
  const cls = classById(sheet.classId);
  const hd = cls?.hitDie ?? 8;
  const caster = cls?.spellcasting;
  const slot1 = caster === "ranger" ? 3 : caster ? 4 : 0;
  const slot2 = caster && caster !== "ranger" ? 2 : 0;
  const wis = abilityMod(sheet.scores?.wis ?? 10);
  const int = abilityMod(sheet.scores?.int ?? 10);
  const gold =
    sheet.equipment
      ?.map((e) => /(\d+)\s*gp/i.exec(e))
      .filter(Boolean)
      .reduce((n, m) => n + Number(m![1]), 0) ?? 0;
  const pack = sheet.backpack ?? [];
  const qty = (id: string) => pack.find((p) => p.itemId === id)?.qty ?? 0;
  const kit = (sheet.equipment ?? []).join(" ");
  const packIds = pack.map((p) => p.itemId);
  const explorer = packIds.includes("explorer-pack") || kit.includes("探险者");
  const priest = packIds.includes("priest-pack") || kit.includes("牧师套装");
  return {
    slot1: { max: slot1, used: 0 },
    slot2: { max: slot2, used: 0 },
    hitDice: { max: 3, used: 0, die: hd },
    channel: { max: cls?.id === "cleric" ? 1 : 0, used: 0 },
    rage: {
      max: cls?.id === "barbarian" ? 3 : 0,
      used: 0,
      on: false,
    },
    surge: { max: cls?.id === "fighter" ? 1 : 0, used: 0 },
    secondWind: { max: cls?.id === "fighter" ? 1 : 0, used: 0 },
    superiority: {
      max: sheet.subclassId === "battlemaster" ? 4 : 0,
      used: 0,
    },
    warPriest: {
      max: sheet.subclassId === "war" ? Math.max(1, wis) : 0,
      used: 0,
    },
    breath: { max: sheet.raceId === "dragonborn" ? 1 : 0, used: 0 },
    relentless: { max: sheet.raceId === "half-orc" ? 1 : 0, used: 0 },
    arcaneRecovery: false,
    conc: null,
    ward: sheet.subclassId === "abjuration" ? 6 + int : 0,
    gold,
    arrow: qty("arrow") || (kit.includes("矢") || kit.includes("箭") ? 20 : 0),
    bolt: qty("bolt") || (kit.includes("弩") ? 20 : 0),
    torch: qty("torch") || (explorer ? 10 : 0),
    ration: qty("ration") || (explorer || priest ? 10 : 0),
  };
}

export function ensureResources(sheet: CharacterSheet): CharacterSheet {
  const base = initResources(sheet);
  if (!sheet.resources?.hitDice) {
    return { ...sheet, resources: base };
  }
  const wis = abilityMod(sheet.scores?.wis ?? 10);
  const warMax = sheet.subclassId === "war" ? Math.max(1, wis) : (sheet.resources.warPriest?.max ?? 0);
  const r = sheet.resources;
  const resources: Resources = {
    ...base,
    ...r,
    warPriest: {
      max: warMax,
      used: Math.min(r.warPriest?.used ?? 0, warMax),
    },
    breath: r.breath ?? base.breath,
    relentless: r.relentless ?? base.relentless,
    channel:
      sheet.channelUsed && r.channel.max && !r.channel.used
        ? { ...r.channel, used: 1 }
        : (r.channel ?? base.channel),
  };
  return { ...sheet, resources };
}

export function left(c: Charge) {
  return Math.max(0, c.max - c.used);
}

export function spendCharge(c: Charge): Charge | null {
  if (left(c) <= 0) return null;
  return { ...c, used: c.used + 1 };
}

export type StockItem = {
  id: string;
  label: string;
  remain: number;
  max?: number;
  note?: string;
};

export function listStocks(sheet: CharacterSheet): StockItem[] {
  const r = ensureResources(sheet).resources!;
  const items: StockItem[] = [];
  if (r.slot1.max) items.push({ id: "slot1", label: "一环", remain: left(r.slot1), max: r.slot1.max, note: "长休" });
  if (r.slot2.max) items.push({ id: "slot2", label: "二环", remain: left(r.slot2), max: r.slot2.max, note: "长休" });
  if (r.channel.max) items.push({ id: "channel", label: "引导神力", remain: left(r.channel), max: r.channel.max, note: "短休" });
  if (r.rage.max) {
    items.push({
      id: "rage",
      label: "狂暴",
      remain: left(r.rage),
      max: r.rage.max,
      note: r.rage.on ? "进行中" : "长休",
    });
  }
  if (r.surge.max) items.push({ id: "surge", label: "动作如潮", remain: left(r.surge), max: r.surge.max, note: "短休" });
  if (r.secondWind.max) {
    items.push({ id: "secondWind", label: "回气", remain: left(r.secondWind), max: r.secondWind.max, note: "短休" });
  }
  if (r.superiority.max) {
    items.push({ id: "superiority", label: "战术骰", remain: left(r.superiority), max: r.superiority.max, note: "短休" });
  }
  if (r.warPriest.max) {
    items.push({ id: "warPriest", label: "战争祭司", remain: left(r.warPriest), max: r.warPriest.max, note: "感知调整/长休" });
  }
  if (r.breath.max) items.push({ id: "breath", label: "吐息", remain: left(r.breath), max: r.breath.max, note: "短休" });
  if (r.relentless.max) {
    items.push({ id: "relentless", label: "不屈不挠", remain: left(r.relentless), max: r.relentless.max, note: "长休" });
  }
  items.push({
    id: "hitDice",
    label: "生命骰",
    remain: left(r.hitDice),
    max: r.hitDice.max,
    note: `d${r.hitDice.die}`,
  });
  if (r.ward > 0 || sheet.subclassId === "abjuration") {
    items.push({ id: "ward", label: "奥术结界", remain: r.ward, note: "吸收" });
  }
  if (sheet.classId === "wizard") {
    items.push({
      id: "arcane",
      label: "奥术恢复",
      remain: r.arcaneRecovery ? 0 : 1,
      max: 1,
      note: "短休",
    });
  }
  if (sheet.inspiration) {
    items.push({ id: "insp", label: "激励", remain: 1, max: 1 });
  }
  items.push({ id: "gold", label: "金币", remain: r.gold, note: "gp" });
  if (r.arrow) items.push({ id: "arrow", label: "箭", remain: r.arrow });
  if (r.bolt) items.push({ id: "bolt", label: "弩矢", remain: r.bolt });
  items.push({ id: "torch", label: "火把", remain: r.torch });
  items.push({ id: "ration", label: "口粮", remain: r.ration, note: "长休 1 份" });
  return items;
}

export function resourceLine(r: Resources) {
  const bits: string[] = [];
  if (r.slot1.max) bits.push(`一环 ${left(r.slot1)}/${r.slot1.max}`);
  if (r.slot2.max) bits.push(`二环 ${left(r.slot2)}/${r.slot2.max}`);
  if (r.channel.max) bits.push(`引导 ${left(r.channel)}/${r.channel.max}`);
  if (r.rage.max) bits.push(`狂暴 ${left(r.rage)}/${r.rage.max}${r.rage.on ? "·开" : ""}`);
  if (r.surge.max) bits.push(`如潮 ${left(r.surge)}/${r.surge.max}`);
  if (r.secondWind.max) bits.push(`回气 ${left(r.secondWind)}/${r.secondWind.max}`);
  if (r.superiority.max) bits.push(`战术骰 ${left(r.superiority)}/${r.superiority.max}`);
  if (r.warPriest.max) bits.push(`战祭 ${left(r.warPriest)}/${r.warPriest.max}`);
  if (r.breath.max) bits.push(`吐息 ${left(r.breath)}/${r.breath.max}`);
  if (r.relentless.max) bits.push(`不屈 ${left(r.relentless)}/${r.relentless.max}`);
  bits.push(`生命骰 ${left(r.hitDice)}/${r.hitDice.max}`);
  if (r.conc) bits.push(`专注·${r.conc.name}`);
  bits.push(`${r.gold} gp`);
  if (r.arrow) bits.push(`箭 ${r.arrow}`);
  if (r.bolt) bits.push(`矢 ${r.bolt}`);
  bits.push(`火把 ${r.torch} 口粮 ${r.ration}`);
  return bits.join(" · ");
}

const CAST_ALIASES: { id: string; keys: string[] }[] = SPELLS.map((s) => ({
  id: s.id,
  keys: [s.name, s.id],
}));

export function matchSpell(text: string) {
  const t = text.replace(/\s/g, "");
  let found: { id: string; name: string } | null = null;
  let hitLen = 0;
  for (const s of SPELLS) {
    for (const k of [s.name, s.id]) {
      if (t.includes(k) && k.length > hitLen) {
        found = { id: s.id, name: s.name };
        hitLen = k.length;
      }
    }
  }
  void CAST_ALIASES;
  return found;
}

export function wantsRest(text: string): "short" | "long" | null {
  if (/长休|过夜|睡一觉|扎营过夜|休息到天亮/.test(text)) return "long";
  if (/短休|歇一[小时会]|休息一小时|坐下来包扎/.test(text)) return "short";
  return null;
}

export function isCantrip(id: string) {
  return (spellById(id)?.level ?? 1) === 0;
}

export function isConcentration(id: string) {
  return Boolean(spellById(id)?.duration?.includes("专注"));
}

export function defaultSlot(id: string) {
  const lv = spellById(id)?.level ?? 1;
  if (lv === 0) return 0;
  return lv;
}

export function spendSlot(r: Resources, level: 1 | 2): { ok: true; next: Resources } | { ok: false; error: string } {
  const key = level === 1 ? "slot1" : "slot2";
  const c = spendCharge(r[key]);
  if (!c) {
    if (level === 1 && left(r.slot2) > 0) {
      return {
        ok: true,
        next: { ...r, slot2: spendCharge(r.slot2)! },
      };
    }
    return {
      ok: false,
      error: level === 1 ? "没有一环法术位了。不能当法术放，只能改用医药检定等土办法。" : "没有二环法术位了。",
    };
  }
  return { ok: true, next: { ...r, [key]: c } };
}

export function applyCast(
  sheet: CharacterSheet,
  spellId: string,
  slotLevel?: number,
): { ok: true; sheet: CharacterSheet; note: string } | { ok: false; error: string } {
  const sp = spellById(spellId);
  if (!sp) return { ok: false, error: "没有这个法术" };
  const known = [...sheet.cantrips, ...sheet.prepared, ...sheet.spellbook];
  if (!known.includes(spellId)) return { ok: false, error: `你没准备 ${sp.name}` };
  let r = { ...(sheet.resources ?? initResources(sheet)) };
  if (sp.level === 0) {
    if (isConcentration(spellId)) r.conc = { id: spellId, name: sp.name };
    return {
      ok: true,
      sheet: { ...sheet, resources: r },
      note: `戏法 ${sp.name}，不耗环位。`,
    };
  }
  const want = (slotLevel === 2 ? 2 : defaultSlot(spellId)) as 1 | 2;
  if (want < sp.level) return { ok: false, error: `${sp.name} 至少要 ${sp.level} 环` };
  const spent = spendSlot(r, want);
  if (!spent.ok) return spent;
  r = spent.next;
  if (isConcentration(spellId)) r.conc = { id: spellId, name: sp.name };
  else if (r.conc?.id === spellId) r.conc = null;
  return {
    ok: true,
    sheet: { ...sheet, resources: r },
    note: `消耗 ${want} 环施放 ${sp.name}。还剩一环 ${left(r.slot1)}/${r.slot1.max}${r.slot2.max ? `，二环 ${left(r.slot2)}/${r.slot2.max}` : ""}。`,
  };
}

export type FeatId = "rage" | "surge" | "secondWind" | "channel" | "torch" | "ration" | "breath";

export function applyFeature(
  sheet: CharacterSheet,
  feat: FeatId,
): { ok: true; sheet: CharacterSheet; note: string; hp?: number } | { ok: false; error: string } {
  const r = { ...(sheet.resources ?? initResources(sheet)) };
  if (feat === "rage") {
    const c = spendCharge(r.rage);
    if (!c) return { ok: false, error: "今日狂暴次数用完了（长休恢复）" };
    r.rage = { ...c, on: true };
    return { ok: true, sheet: { ...sheet, resources: r }, note: "进入狂暴。" };
  }
  if (feat === "surge") {
    const c = spendCharge(r.surge);
    if (!c) return { ok: false, error: "动作如潮已用，短休后恢复" };
    r.surge = c;
    return { ok: true, sheet: { ...sheet, resources: r }, note: "动作如潮：本回合再获得一个动作。" };
  }
  if (feat === "secondWind") {
    const c = spendCharge(r.secondWind);
    if (!c) return { ok: false, error: "回气已用，短休后恢复" };
    r.secondWind = c;
    const die = 1 + Math.floor(Math.random() * 10);
    const heal = die + 3;
    const hp = Math.min(sheet.hp.max, sheet.hp.current + heal);
    return {
      ok: true,
      sheet: { ...sheet, resources: r, hp: { ...sheet.hp, current: hp } },
      note: `回气 ${die}+3＝${heal}。生命 ${sheet.hp.current}→${hp}。`,
      hp,
    };
  }
  if (feat === "channel") {
    const c = spendCharge(r.channel);
    if (!c) return { ok: false, error: "引导神力已用，短休后恢复" };
    r.channel = c;
    return { ok: true, sheet: { ...sheet, resources: r, channelUsed: true }, note: "引导神力已消耗。" };
  }
  if (feat === "breath") {
    const c = spendCharge(r.breath);
    if (!c) return { ok: false, error: "吐息已用，短休后恢复" };
    r.breath = c;
    const dmg = 1 + Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6);
    return {
      ok: true,
      sheet: { ...sheet, resources: r },
      note: `吐息武器 2d6＝${dmg}。范围内生物做敏捷豁免（DC＝8＋熟练＋体质），失败全伤、成功减半。`,
    };
  }
  if (feat === "torch") {
    if (r.torch <= 0) return { ok: false, error: "没有火把了" };
    r.torch -= 1;
    return { ok: true, sheet: { ...sheet, resources: r }, note: `点燃火把。剩余 ${r.torch}。` };
  }
  if (r.ration <= 0) return { ok: false, error: "没有口粮了" };
  r.ration -= 1;
  return { ok: true, sheet: { ...sheet, resources: r }, note: `吃了一份口粮。剩余 ${r.ration}。` };
}

export function consumeAmmo(sheet: CharacterSheet, kind: "arrow" | "bolt") {
  const r = { ...(sheet.resources ?? initResources(sheet)) };
  if (r[kind] <= 0) return { ok: false as const, error: kind === "arrow" ? "箭矢用尽" : "弩矢用尽" };
  r[kind] -= 1;
  return { ok: true as const, sheet: { ...sheet, resources: r } };
}

export function spendHitDie(sheet: CharacterSheet) {
  const r = { ...(sheet.resources ?? initResources(sheet)) };
  const c = spendCharge(r.hitDice);
  if (!c) return { ok: false as const, error: "生命骰用完了，长休才能补" };
  r.hitDice = { ...c, die: r.hitDice.die };
  const face = 1 + Math.floor(Math.random() * r.hitDice.die);
  const heal = face + abilityMod(sheet.scores.con);
  const hp = Math.min(sheet.hp.max, sheet.hp.current + Math.max(1, heal));
  return {
    ok: true as const,
    sheet: { ...sheet, resources: r, hp: { ...sheet.hp, current: hp } },
    note: `d${r.hitDice.die}=${face}＋${abilityMod(sheet.scores.con)}→${Math.max(1, heal)}（${sheet.hp.current}→${hp}）`,
    face,
    heal: Math.max(1, heal),
  };
}

export function spendHitDice(sheet: CharacterSheet, n: number) {
  let cur = sheet;
  const bits: string[] = [];
  const cap = Math.max(0, Math.min(n, left(cur.resources?.hitDice ?? { max: 0, used: 0 })));
  for (let i = 0; i < cap; i++) {
    const out = spendHitDie(cur);
    if (!out.ok) break;
    cur = out.sheet;
    bits.push(out.note);
  }
  return { sheet: cur, note: bits.length ? `生命骰：${bits.join("；")}` : "没有花生命骰。" };
}

export function shortRestSheet(sheet: CharacterSheet, arcane: 0 | 1 | 2 = 0) {
  const r = { ...(sheet.resources ?? initResources(sheet)) };
  r.channel = { ...r.channel, used: 0 };
  r.surge = { ...r.surge, used: 0 };
  r.secondWind = { ...r.secondWind, used: 0 };
  r.superiority = { ...r.superiority, used: 0 };
  r.breath = { ...r.breath, used: 0 };
  if (sheet.classId === "wizard" && !r.arcaneRecovery && arcane) {
    if (arcane === 1 && r.slot1.used > 0) r.slot1 = { ...r.slot1, used: r.slot1.used - 1 };
    if (arcane === 2 && r.slot2.used > 0) r.slot2 = { ...r.slot2, used: r.slot2.used - 1 };
    if (arcane === 2 && r.slot2.used === 0 && r.slot1.used >= 2) {
      r.slot1 = { ...r.slot1, used: r.slot1.used - 2 };
    }
    r.arcaneRecovery = true;
  }
  r.rage = { ...r.rage, on: false };
  return { ...sheet, resources: r, channelUsed: false };
}

export function longRestSheet(sheet: CharacterSheet) {
  const r = { ...(sheet.resources ?? initResources(sheet)) };
  const noFood = r.ration <= 0;
  if (r.ration > 0) r.ration -= 1;
  r.slot1 = { ...r.slot1, used: 0 };
  r.slot2 = { ...r.slot2, used: 0 };
  r.channel = { ...r.channel, used: 0 };
  r.rage = { max: r.rage.max, used: 0, on: false };
  r.surge = { ...r.surge, used: 0 };
  r.secondWind = { ...r.secondWind, used: 0 };
  r.superiority = { ...r.superiority, used: 0 };
  r.warPriest = { ...r.warPriest, used: 0 };
  r.breath = { ...r.breath, used: 0 };
  r.relentless = { ...r.relentless, used: 0 };
  r.arcaneRecovery = false;
  r.conc = null;
  const recoverHd = Math.max(1, Math.floor(r.hitDice.max / 2));
  r.hitDice = {
    ...r.hitDice,
    used: Math.max(0, r.hitDice.used - recoverHd),
  };
  const int = abilityMod(sheet.scores.int);
  if (sheet.subclassId === "abjuration") r.ward = 6 + int;
  const hp = noFood
    ? Math.min(sheet.hp.max, sheet.hp.current + Math.ceil((sheet.hp.max - sheet.hp.current) / 2))
    : sheet.hp.max;
  return {
    sheet: {
      ...sheet,
      resources: r,
      hp: { ...sheet.hp, current: hp },
      deathSaves: { success: 0, fail: 0 },
      conditions: sheet.conditions.filter((c) => c !== "昏迷" && c !== "稳定"),
      channelUsed: false,
    },
    note: noFood
      ? "没有口粮：长休只恢复一半失去的生命，环位仍回满。"
      : "长休完成。生命与环位、每日次数已恢复。",
  };
}

export function dropConcentration(sheet: CharacterSheet) {
  const r = { ...(sheet.resources ?? initResources(sheet)) };
  r.conc = null;
  return { ...sheet, resources: r };
}

/** 生命将到 0 时，半兽人不屈不挠改为 1 点。掷出/生效时才扣。 */
export function applyIncomingDamage(sheet: CharacterSheet, dmg: number) {
  const live = ensureResources(sheet);
  const from = live.hp.current;
  const raw = Math.max(0, from - dmg);
  if (raw > 0) {
    return {
      sheet: { ...live, hp: { ...live.hp, current: raw } },
      note: `伤害 ${dmg}，生命 ${from}→${raw}`,
      relentless: false,
    };
  }
  const r = live.resources!;
  if (live.raceId === "half-orc" && from > 0 && left(r.relentless) > 0) {
    const spent = spendCharge(r.relentless)!;
    return {
      sheet: {
        ...live,
        resources: { ...r, relentless: spent },
        hp: { ...live.hp, current: 1 },
        conditions: live.conditions.filter((c) => c !== "昏迷"),
      },
      note: `不屈不挠：本应倒地，改为剩 1 点生命。`,
      relentless: true,
    };
  }
  const conditions = live.conditions.includes("昏迷")
    ? live.conditions
    : [...live.conditions, "昏迷"];
  return {
    sheet: { ...live, hp: { ...live.hp, current: 0 }, conditions },
    note: `伤害 ${dmg}，生命 ${from}→0`,
    relentless: false,
  };
}
