import { placeOf } from "./where";
import { clockOf, type Clock } from "./clock";

export type Squad = { ids: string[]; captain: string };

export type SquadInvite = { from: string; to: string; fromName: string; at: number };

export const SQUAD_INVITE_MS = 60_000;

export type SquadQueueItem = {
  id: string;
  userId: string;
  name: string;
  body: string;
  beat: number;
};

export function readSquads(flags: Record<string, unknown>): Squad[] {
  const raw = flags.squads;
  if (!Array.isArray(raw)) return [];
  const out: Squad[] = [];
  for (const g of raw) {
    if (Array.isArray(g)) {
      const ids = [...new Set(g.map((x) => String(x)))].filter(Boolean);
      if (ids.length >= 2) out.push({ ids, captain: ids[0] });
      continue;
    }
    if (!g || typeof g !== "object") continue;
    const o = g as { ids?: unknown; captain?: unknown };
    const ids = Array.isArray(o.ids)
      ? [...new Set(o.ids.map((x) => String(x)))].filter(Boolean)
      : [];
    if (ids.length < 2) continue;
    const captain = o.captain && ids.includes(String(o.captain)) ? String(o.captain) : ids[0];
    out.push({ ids, captain });
  }
  return out;
}

export function readSquadInvite(flags: Record<string, unknown>): SquadInvite | null {
  const raw = flags.squadInvite;
  if (!raw || typeof raw !== "object") return null;
  const v = raw as { from?: unknown; to?: unknown; fromName?: unknown; at?: unknown };
  if (!v.from || !v.to) return null;
  const at = Number(v.at);
  if (!Number.isFinite(at) || Date.now() - at > SQUAD_INVITE_MS) return null;
  return {
    from: String(v.from),
    to: String(v.to),
    fromName: String(v.fromName ?? ""),
    at,
  };
}

export function sweepSquadInvite(flags: Record<string, unknown>) {
  if (!flags.squadInvite) return false;
  if (readSquadInvite(flags)) return false;
  delete flags.squadInvite;
  return true;
}

export function readSquadQueue(flags: Record<string, unknown>): SquadQueueItem[] {
  const raw = flags.squadQueue;
  if (!Array.isArray(raw)) return [];
  const out: SquadQueueItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Partial<SquadQueueItem>;
    if (!o.id || !o.userId || !o.body) continue;
    out.push({
      id: String(o.id),
      userId: String(o.userId),
      name: String(o.name ?? ""),
      body: String(o.body),
      beat: Math.max(0, Math.floor(Number(o.beat) || 0)),
    });
  }
  return out;
}

export function squadOf(squads: Squad[], userId: string): string[] {
  const g = squads.find((s) => s.ids.includes(userId));
  return g ? [...g.ids] : [userId];
}

export function squadRecord(squads: Squad[], userId: string): Squad | null {
  return squads.find((s) => s.ids.includes(userId)) ?? null;
}

export function matesOf(squads: Squad[], userId: string): string[] {
  return squadOf(squads, userId).filter((id) => id !== userId);
}

export function isCaptain(squads: Squad[], userId: string) {
  return squads.some((s) => s.captain === userId);
}

export function captainOf(squads: Squad[], userId: string): string | null {
  return squadRecord(squads, userId)?.captain ?? null;
}

export function isSplitAction(text: string) {
  return /分开|离队|我留下|你们先|我自己|我不跟|独自|一个人去/.test(text);
}

export function joinSquad(squads: Squad[], a: string, b: string): Squad[] {
  const ga = squads.find((s) => s.ids.includes(a));
  const gb = squads.find((s) => s.ids.includes(b));
  if (ga && gb && ga === gb) return squads;
  if (gb) return squads;
  if (ga) {
    return squads.map((s) =>
      s === ga ? { ...s, ids: [...new Set([...s.ids, b])] } : s,
    );
  }
  return [...squads, { ids: [a, b], captain: a }];
}

export function transferCaptain(squads: Squad[], from: string, to: string): Squad[] | null {
  const g = squads.find((s) => s.captain === from && s.ids.includes(to));
  if (!g) return null;
  return squads.map((s) => (s === g ? { ...s, captain: to } : s));
}

export function leaveSquad(squads: Squad[], userId: string): Squad[] {
  const next: Squad[] = [];
  for (const s of squads) {
    if (!s.ids.includes(userId)) {
      next.push(s);
      continue;
    }
    const ids = s.ids.filter((id) => id !== userId);
    if (ids.length < 2) continue;
    next.push({
      ids,
      captain: s.captain === userId ? ids[0] : s.captain,
    });
  }
  return next;
}

export function expandWhereWithSquads(
  patch: unknown,
  squads: Squad[],
  split: boolean,
): { userId: string; place: string }[] {
  if (!Array.isArray(patch)) return [];
  const items: { userId: string; place: string }[] = [];
  for (const item of patch) {
    if (!item || typeof item !== "object") continue;
    const p = item as { userId?: unknown; place?: unknown };
    const userId = String(p.userId ?? "");
    const place = String(p.place ?? "").trim();
    if (!userId || !place) continue;
    items.push({ userId, place });
  }
  if (split || !items.length) return items;
  const byUser = new Map(items.map((i) => [i.userId, i.place]));
  const placesInSquad = new Map<string, Set<string>>();
  for (const { userId, place } of items) {
    const key = squadOf(squads, userId).sort().join(",");
    const set = placesInSquad.get(key) ?? new Set();
    set.add(place);
    placesInSquad.set(key, set);
  }
  const extra: { userId: string; place: string }[] = [];
  for (const { userId, place } of items) {
    const key = squadOf(squads, userId).sort().join(",");
    if ((placesInSquad.get(key)?.size ?? 0) > 1) continue;
    for (const mate of squadOf(squads, userId)) {
      if (!byUser.has(mate)) extra.push({ userId: mate, place });
    }
  }
  return [...items, ...extra];
}

export function splitSquadsOnDiverge(
  squads: Squad[],
  where: Record<string, string>,
  sceneId: string,
): Squad[] {
  const next: Squad[] = [];
  for (const g of squads) {
    const buckets = new Map<string, string[]>();
    for (const id of g.ids) {
      const p = placeOf(where, id, sceneId);
      buckets.set(p, [...(buckets.get(p) ?? []), id]);
    }
    for (const ids of buckets.values()) {
      if (ids.length < 2) continue;
      next.push({
        ids,
        captain: ids.includes(g.captain) ? g.captain : ids[0],
      });
    }
  }
  return next;
}

export function expireSquadQueue(
  queue: SquadQueueItem[],
  squads: Squad[],
  clocks: Record<string, Clock>,
): { keep: SquadQueueItem[]; dropped: SquadQueueItem[] } {
  const keep: SquadQueueItem[] = [];
  const dropped: SquadQueueItem[] = [];
  for (const q of queue) {
    const cap = captainOf(squads, q.userId);
    if (!cap) {
      dropped.push(q);
      continue;
    }
    if (clockOf(clocks, cap).beats > q.beat) dropped.push(q);
    else keep.push(q);
  }
  return { keep, dropped };
}

export function squadPromptBlock(
  squads: Squad[],
  names: { userId: string; name: string }[],
) {
  const label = (id: string) => names.find((n) => n.userId === id)?.name || id;
  if (!squads.length) {
    return `组队：目前没人组队。各自行动。有人明确说「我们一起」且已在同一处，可以 wherePatch 整组。`;
  }
  const lines = squads.map((g) => {
    const cap = label(g.captain);
    const rest = g.ids.filter((id) => id !== g.captain).map(label);
    return `- 队长 ${cap}，队员 ${rest.join("、") || "无"}。队长开口＝整队行动。队员经队长批准后的话标了【独自】：只写那一个人，不代表整队，不要 wherePatch 整组。`;
  });
  return `组队（队长负责整队去留；队员独自发问不带动队伍）：
${lines.join("\n")}
- 队长行动且没说分开：wherePatch 必须带上整组每一个人。
- 【独自】：只裁决这个队员。不要写成「你们」。
- 有人说「分开 / 离队 / 我留下 / 我自己去」才拆开。`;
}
