/** 剧场制位置：同一处才能触碰。默认都在当前场景。 */

export function readWhere(flags: Record<string, unknown>): Record<string, string> {
  const raw = flags.where;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const s = String(v ?? "").trim();
    if (s) out[id] = s;
  }
  return out;
}

export function applyWherePatch(
  current: Record<string, string>,
  patch: unknown,
  knownUserIds: Set<string>,
  sceneId: string,
): Record<string, string> {
  const next = { ...current };
  if (!Array.isArray(patch)) return next;
  for (const item of patch) {
    if (!item || typeof item !== "object") continue;
    const p = item as { userId?: unknown; place?: unknown };
    const id = String(p.userId ?? "");
    if (!knownUserIds.has(id)) continue;
    const place = String(p.place ?? "").trim() || sceneId;
    next[id] = place;
  }
  return next;
}

export function placeOf(
  where: Record<string, string>,
  userId: string,
  sceneId: string,
) {
  return where[userId] || sceneId;
}

export function samePlace(
  where: Record<string, string>,
  a: string,
  b: string,
  sceneId: string,
) {
  return placeOf(where, a, sceneId) === placeOf(where, b, sceneId);
}

export function wherePromptBlock(
  where: Record<string, string>,
  names: { userId: string; name: string }[],
  sceneId: string,
) {
  const lines = names.map((n) => {
    const p = placeOf(where, n.userId, sceneId);
    return `- ${n.name} 在 ${p}`;
  });
  return `位置（剧场制，不对玩家显示格子）：
${lines.join("\n") || "- 全员默认在当前场景，可走到触碰"}
- 同一处：能触碰（神导、协助、近战）。短时间能赶到。
- 不在同一处（大厅 vs 后院 vs 酒窖 vs 远处）：不能神导/协助。祝福术 30 尺，也视为同一处才够得到。
- 有人离开或追出去，必须 wherePatch 写下 userId 和新地点（用场景 id，如 wake/yard/cellar）。
- 组队的人没说分开，wherePatch 要写整组。
- 没说离开就不要改。不要因为「方便加骰」把人瞬移过来。`;
}
