import { placeOf } from "./where";
import type { KpSpeech } from "./sanitize";

export type Clock = { beats: number; minutes: number };

const MAX_SKEW_BEATS = 3;

/** 短休约一小时，长休过夜。用拍来对齐分头，不拿现实打字速度算。 */
export const REST_BEATS = { short: 6, long: 18 } as const;

export type RestHold = {
  kind: "short" | "long";
  resters: string[];
  fromName: string;
  startBeats: number;
  needBeats: number;
  hitDice: Record<string, number>;
  arcane: Record<string, number>;
};

export function readRestHold(flags: Record<string, unknown>): RestHold | null {
  const raw = flags.restHold;
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Partial<RestHold>;
  if (v.kind !== "short" && v.kind !== "long") return null;
  if (!Array.isArray(v.resters) || !v.resters.length) return null;
  const need = REST_BEATS[v.kind];
  return {
    kind: v.kind,
    resters: v.resters.map(String),
    fromName: String(v.fromName ?? ""),
    startBeats: Math.max(0, Math.floor(Number(v.startBeats) || 0)),
    needBeats: Math.max(1, Math.floor(Number(v.needBeats) || need)),
    hitDice:
      v.hitDice && typeof v.hitDice === "object"
        ? (v.hitDice as Record<string, number>)
        : {},
    arcane:
      v.arcane && typeof v.arcane === "object"
        ? (v.arcane as Record<string, number>)
        : {},
  };
}

export function restRemain(
  hold: RestHold,
  clocks: Record<string, Clock>,
  partyIds: string[],
) {
  const active = partyIds.filter((id) => !hold.resters.includes(id));
  const maxA = active.length
    ? Math.max(...active.map((id) => clockOf(clocks, id).beats))
    : clockOf(clocks, hold.resters[0] ?? "").beats;
  return Math.max(0, hold.startBeats + hold.needBeats - maxA);
}

export function readClocks(flags: Record<string, unknown>): Record<string, Clock> {
  const raw = flags.clock;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, Clock> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const c = v as { beats?: unknown; minutes?: unknown };
    out[id] = {
      beats: Math.max(0, Math.floor(Number(c.beats) || 0)),
      minutes: Math.max(0, Math.floor(Number(c.minutes) || 0)),
    };
  }
  return out;
}

export function clockOf(clocks: Record<string, Clock>, userId: string): Clock {
  return clocks[userId] ?? { beats: 0, minutes: 0 };
}

export function isWaitAction(text: string) {
  return /我(在这[里边]?|这边)?等|等到(他们|汇合)|先等一[会下]|原地等/.test(text);
}

export function minutesForAction(text: string) {
  if (isWaitAction(text)) return 0;
  if (/民兵|叫人|报官|找人来/.test(text)) return 20;
  if (/搜|翻|调查|仔细|沿|往里/.test(text)) return 10;
  if (/走|去|离开|出去|分开|跟上/.test(text)) return 5;
  if (/说|问|听|看一眼/.test(text)) return 2;
  return 5;
}

export function bumpClocks(
  clocks: Record<string, Clock>,
  userIds: string[],
  addBeats: number,
  addMinutes: number,
): Record<string, Clock> {
  const next = { ...clocks };
  for (const id of userIds) {
    const cur = clockOf(next, id);
    next[id] = {
      beats: cur.beats + addBeats,
      minutes: cur.minutes + addMinutes,
    };
  }
  return next;
}

export function waitSync(
  clocks: Record<string, Clock>,
  userId: string,
  partyIds: string[],
): Record<string, Clock> {
  let maxBeats = 0;
  let maxMin = 0;
  for (const id of partyIds) {
    const c = clockOf(clocks, id);
    if (c.beats > maxBeats) maxBeats = c.beats;
    if (c.minutes > maxMin) maxMin = c.minutes;
  }
  return {
    ...clocks,
    [userId]: { beats: maxBeats, minutes: maxMin },
  };
}

/** 汇合：同一处的人对齐到该处最领先的钟。 */
export function syncReunion(
  clocks: Record<string, Clock>,
  whereBefore: Record<string, string>,
  whereAfter: Record<string, string>,
  sceneId: string,
  partyIds: string[],
): Record<string, Clock> {
  let next = { ...clocks };
  const dests = new Set<string>();
  for (const id of partyIds) {
    const a = placeOf(whereBefore, id, sceneId);
    const b = placeOf(whereAfter, id, sceneId);
    if (a !== b) dests.add(b);
  }
  if (!dests.size) return next;
  for (const dest of dests) {
    const here = partyIds.filter((id) => placeOf(whereAfter, id, sceneId) === dest);
    let maxBeats = 0;
    let maxMin = 0;
    for (const id of here) {
      const c = clockOf(next, id);
      if (c.beats > maxBeats) maxBeats = c.beats;
      if (c.minutes > maxMin) maxMin = c.minutes;
    }
    for (const id of here) {
      next = { ...next, [id]: { beats: maxBeats, minutes: maxMin } };
    }
  }
  return next;
}

export function spotlightSkew(
  clocks: Record<string, Clock>,
  partyIds: string[],
  where: Record<string, string>,
  sceneId: string,
  actorUserId: string,
  names: Record<string, string>,
  resters: string[] = [],
): {
  blocked: boolean;
  reason: "skew" | "resting" | null;
  aheadBeats: number;
  behindNames: string[];
  minBeats: number;
  actorBeats: number;
} {
  const actorBeats = clockOf(clocks, actorUserId).beats;
  const empty = {
    blocked: false,
    reason: null as "skew" | "resting" | null,
    aheadBeats: 0,
    behindNames: [] as string[],
    minBeats: actorBeats,
    actorBeats,
  };
  if (resters.includes(actorUserId)) {
    return { ...empty, blocked: true, reason: "resting" };
  }
  const activeIds = partyIds.filter((id) => !resters.includes(id));
  if (activeIds.length < 2) return empty;
  const actorPlace = placeOf(where, actorUserId, sceneId);
  const others = activeIds.filter((id) => id !== actorUserId);
  const split = others.some((id) => placeOf(where, id, sceneId) !== actorPlace);
  if (!split) return empty;
  let minBeats = actorBeats;
  const behind: string[] = [];
  for (const id of others) {
    const b = clockOf(clocks, id).beats;
    if (b < minBeats) minBeats = b;
    if (placeOf(where, id, sceneId) !== actorPlace && b < actorBeats) {
      behind.push(names[id] || "同伴");
    }
  }
  const aheadBeats = actorBeats - minBeats;
  return {
    blocked: aheadBeats >= MAX_SKEW_BEATS,
    reason: aheadBeats >= MAX_SKEW_BEATS ? "skew" : null,
    aheadBeats,
    behindNames: behind,
    minBeats,
    actorBeats,
  };
}

export function restingRefuseSpeech(): KpSpeech {
  const speech =
    "你还在休息。要等另一边的人把这段时间过完，你才会醒来。若要提前起来，说「我醒来」或反对这次休整。";
  return {
    hat: "refuse",
    speech,
    tts: speech,
    rolls: [],
    revealClues: [],
    revealNpcs: [],
    scene: null,
    characterUpdates: [],
    secretPatch: {},
    stancePatch: [],
    wherePatch: [],
    log: "休息中的人没有起身。",
    npcRolls: [],
    spendPatch: null,
    combat: null,
  };
}

export function spotlightRefuseSpeech(skew: {
  behindNames: string[];
  aheadBeats: number;
}): KpSpeech {
  const who = skew.behindNames.join("、") || "另一边的人";
  const speech = `另一边的人还没做完这一轮。请先等 ${who} 行动，或写「我在这里等」。`;
  return {
    hat: "refuse",
    speech,
    tts: speech,
    rolls: [],
    revealClues: [],
    revealNpcs: [],
    scene: null,
    characterUpdates: [],
    secretPatch: {},
    stancePatch: [],
    wherePatch: [],
    log: "请先等落后的一边行动。",
    npcRolls: [],
    spendPatch: null,
    combat: null,
  };
}

export function clockPromptBlock(
  clocks: Record<string, Clock>,
  where: Record<string, string>,
  sceneId: string,
  party: { userId: string; name: string }[],
  hold?: RestHold | null,
) {
  if (party.length < 2) return "时间线：全员同处，不必切镜头。";
  const lines = party.map((p) => {
    const c = clockOf(clocks, p.userId);
    const rest = hold?.resters.includes(p.userId)
      ? hold.kind === "long"
        ? " · 长休中"
        : " · 短休中"
      : "";
    return `- ${p.name} 在 ${placeOf(where, p.userId, sceneId)} · 第 ${c.beats} 拍 · 约 ${c.minutes} 分钟${rest}`;
  });
  const beats = party.map((p) => clockOf(clocks, p.userId).beats);
  const gap = Math.max(...beats) - Math.min(...beats);
  const restLine = hold
    ? `- 休息：${hold.fromName}那边正在${hold.kind === "long" ? "长休" : "短休"}（${hold.needBeats} 拍）。不要写他们起身做事。另一边每推进一拍，填这格时间。满拍后休息结束、两边钟对齐。`
    : "";
  return `时间线（同一世界钟，分头不是各玩各的）：
${lines.join("\n")}
- 一拍＝一边一次有意义的推进。领先已 ${gap} 拍。
- 领先达到 ${MAX_SKEW_BEATS} 拍：不要再给领先的人开新事件，hat=refuse，请先等落后的一边行动，或让他们写「我在这里等」。
- 战斗整场大约算 1 拍（轮次是六秒，不拿来甩开另一边）。
- 短休＝${REST_BEATS.short} 拍，长休＝${REST_BEATS.long} 拍。只有休息的那一边真正歇着；另一边可以行动。
${restLine}
- 汇合：钟差写成等待、路上耗时。不要把两边都写成「刚好同时发生」。落后的人补拍时，不要剧透另一边还没演完的事。`;
}

export function publicClocks(
  clocks: Record<string, Clock>,
  partyIds: string[],
): Record<string, { beats: number; minutes: number; lag: number }> {
  const min = partyIds.reduce(
    (m, id) => Math.min(m, clockOf(clocks, id).beats),
    Infinity,
  );
  const floor = Number.isFinite(min) ? min : 0;
  const out: Record<string, { beats: number; minutes: number; lag: number }> = {};
  for (const id of partyIds) {
    const c = clockOf(clocks, id);
    out[id] = { beats: c.beats, minutes: c.minutes, lag: c.beats - floor };
  }
  return out;
}
