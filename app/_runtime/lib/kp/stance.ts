export const STANCES = ["guest", "named", "useful", "trusted", "hostile"] as const;
export type Stance = (typeof STANCES)[number];

export type StanceRow = { stance: Stance; why: string };

const LABELS: Record<Stance, string> = {
  guest: "待客",
  named: "有名",
  useful: "有用",
  trusted: "受托",
  hostile: "敌对",
};

export function isStance(v: unknown): v is Stance {
  return STANCES.includes(v as Stance);
}

export function readStances(flags: Record<string, unknown>): Record<string, StanceRow> {
  const raw = flags.stance;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, StanceRow> = {};
  for (const [id, row] of Object.entries(raw as Record<string, unknown>)) {
    if (!row || typeof row !== "object") continue;
    const r = row as { stance?: unknown; why?: unknown };
    if (!isStance(r.stance)) continue;
    out[id] = { stance: r.stance, why: String(r.why ?? "") };
  }
  return out;
}

export function openingStances(
  npcs: { id: string; startStance?: Stance }[],
): Record<string, StanceRow> {
  const out: Record<string, StanceRow> = {};
  for (const n of npcs) {
    const stance = n.startStance && isStance(n.startStance) ? n.startStance : "guest";
    out[n.id] = {
      stance,
      why: stance === "useful" ? "他的目标需要你们在场" : "外乡人，尚未报来历",
    };
  }
  return out;
}

export function applyStancePatch(
  current: Record<string, StanceRow>,
  patch: unknown,
  knownIds: Set<string>,
): Record<string, StanceRow> {
  const next = { ...current };
  if (!Array.isArray(patch)) return next;
  for (const item of patch) {
    if (!item || typeof item !== "object") continue;
    const p = item as { npcId?: unknown; stance?: unknown; why?: unknown };
    const id = String(p.npcId ?? "");
    if (!knownIds.has(id) || !isStance(p.stance)) continue;
    next[id] = { stance: p.stance, why: String(p.why ?? "").slice(0, 80) };
  }
  return next;
}

export function stancePromptBlock(
  npcs: { id: string; name: string; startStance?: Stance }[],
  flags: Record<string, unknown>,
) {
  const now = readStances(flags);
  const lines = npcs.map((n) => {
    const row = now[n.id] ?? {
      stance: n.startStance && isStance(n.startStance) ? n.startStance : "guest",
      why: "默认",
    };
    return `- ${n.name}(${n.id}) 态度=${LABELS[row.stance]}（${row.why || "无"}）`;
  });
  return `NPC 态度（只给你看，禁止对玩家报档名、禁止说「好感」「信任值」）：
${lines.join("\n")}

档位只决定「交到手里的东西」，不决定「能不能聊」：
- 待客：公开场合能看见听见的都给。原件、钥匙、后室不给。问来历。
- 有名：肯对坐说话。仍不交把柄。
- 有用：他会主动拿出对自己有利的东西（拉拢），不是听话。
- 受托：钥匙、私房话、带路。不因此改他的人生目标。
- 敌对：赶人、喊人、动手、抽回纸。但话题不封死。

死局禁令：
- 禁止「我不想跟你说了 / 今晚别再问 / 这条线没了」。
- 掉档时：他可能走开、把文件收回、请你们出去透气。同一轮仍要说明玩家还能问谁、去哪里、或等他按自己的目标再开口。禁止把话题封死。
- 待客永远保有公开层。敌对时改去问别人、跟出去、听门缝，不让整桌沉默。
- 报姓名/来由：待客→有名，不掷骰。命令口气要原件：不交，可掉一档，仍让他宣读或否认。
- 全桌将敌对时，用 stallBeats 让世界动，不要冷场死掉。`;
}
