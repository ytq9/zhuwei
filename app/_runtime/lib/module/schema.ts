/**
 * 模组数据结构。撰写规则以 `writing.ts` 为准（修订 7）。
 * 登记新案子时必须能通过 assertModule。
 */
import { WRITING_REVISION } from "./writing";

export type ClueDef = {
  id: string;
  name: string;
  /** 什么行动会碰到这条。写清「看/问」与「再骰」的分界。 */
  revealWhen: string;
  /** 免费层：问、看、听、摸就给，并钉线索板。不骰或失败都停这里。 */
  talkText: string;
  /** 完整层：检定成功。独特载荷只放这里。 */
  playerText: string;
  /**
   * 失败层：仅物理/危险。社交双轨失败不要用惩罚。
   * 写清：仍观察到什么、发生了什么后果、还能换什么方法。
   */
  failText: string;
  /** 钉板时给玩家的下一步提示。不剧透。 */
  hint: string;
  pointsTo: string;
  dc?: { skill: string; value: number };
  consumed?: boolean;
};

export type NpcDef = {
  id: string;
  name: string;
  publicFace: string;
  goal: string;
  /** 问到就说，不要先过 DC。 */
  knows: string[];
  doesNotKnow: string[];
  hostileIf: string;
  /** 写清哪一档才肯给什么、代价是什么。不要「先过 DC 才肯开口」。 */
  canBePersuaded: string;
  stats: string;
  /** 开场态度。默认待客。奈斯这种要利用外乡人的人可设 useful。 */
  startStance?: "guest" | "named" | "useful" | "trusted" | "hostile";
  /** 声口：节奏、用词、停顿。去掉名字也要听得出是谁。 */
  voice: string;
  /** 两句以上「他会这么说」，供 KP 直接套。 */
  lines: string[];
};

export type SceneEnvironmentItemDef = {
  /** 场景内这一份物品的稳定 id，用于防止重复领取。 */
  id: string;
  /** 规则库存 id；必须由服务端物品目录识别。 */
  itemId: string;
  name: string;
  aliases?: string[];
  /** obvious 直接取得；plausible 需要小检定。 */
  availability: "obvious" | "plausible";
  quantity?: number;
  check?: { ability: string; skill?: string; dc: number };
};

export type ScenePhysicalChallengeDef = {
  id: string;
  name: string;
  aliases: string[];
  verbs: string[];
  ruling: "automatic" | "check" | "impossible";
  check?: { ability: string; skill?: string; dc: number };
  alternatives?: string[];
};

export type SceneDef = {
  id: string;
  name: string;
  location: string;
  boxedText: string;
  npcs: string[];
  clues: string[];
  defaultConflict?: string;
  unlockIf?: string;
  /** 可取得的环境物品。未登记的物品不能由 KP 临时写进背包。 */
  environmentItems?: SceneEnvironmentItemDef[];
  /** 需要确定性属性/技能裁决的场景动作。 */
  physicalChallenges?: ScenePhysicalChallengeDef[];
  /** 场地危害。开战时抄进 combat.hazards。 */
  hazards?: {
    id: string;
    name: string;
    text: string;
    dc?: number;
    save?: string;
    damage?: string;
    when: "enter" | "start" | "move" | "trigger";
  }[];
};

export type ChapterDef = {
  id: string;
  name: string;
  intent: string;
  scenes: SceneDef[];
};

export type TriggerDef = { if: string; then: string };

export type ModuleDef = {
  id: string;
  title: string;
  level: number;
  players: string;
  duration: string;
  tone: string;
  failureMeans: string;
  /** 永不进玩家界面。 */
  truth: string;
  chapters: ChapterDef[];
  clues: ClueDef[];
  npcs: NpcDef[];
  triggers: TriggerDef[];
  /** 冷场时 KP 按条取用。至少 2 条，写具体动作。 */
  stallBeats: string[];
  failures: TriggerDef[];
  banned: string[];
  sequelHooks: string[];
  writingRevision: typeof WRITING_REVISION;
};

export function publicNpc(n: NpcDef) {
  return { id: n.id, name: n.name, intro: n.publicFace };
}

export function assertModule(mod: ModuleDef) {
  const errors: string[] = [];
  if (mod.writingRevision !== WRITING_REVISION) {
    errors.push(`${mod.id}: writingRevision 应为 ${WRITING_REVISION}`);
  }
  if (mod.chapters.length < 2) errors.push(`${mod.id}: 至少两章`);
  if (mod.stallBeats.length < 2) errors.push(`${mod.id}: stallBeats 至少 2 条`);
  if (mod.sequelHooks.length < 2) errors.push(`${mod.id}: sequelHooks 至少 2 条`);
  if (mod.clues.length === 0) errors.push(`${mod.id}: 需要线索`);
  for (const c of mod.clues) {
    if (!c.talkText.trim()) errors.push(`${mod.id}/${c.id}: 缺 talkText`);
    if (!c.failText.trim()) errors.push(`${mod.id}/${c.id}: 缺 failText`);
    if (!c.hint?.trim() || c.hint.trim().length < 8) {
      errors.push(`${mod.id}/${c.id}: 缺 hint（钉板时给玩家的下一步）`);
    }
    if (c.failText.trim() === c.playerText.trim()) {
      errors.push(`${mod.id}/${c.id}: failText 不能等于 playerText`);
    }
    if (c.failText.trim().length < 20) {
      errors.push(`${mod.id}/${c.id}: failText 太短，三拍写不全`);
    }
    if (/什么都没|没有发现|今晚不能再|再试一次调查/.test(c.failText)) {
      errors.push(`${mod.id}/${c.id}: failText 踩了禁写`);
    }
    if (c.dc && c.dc.value > 15) {
      errors.push(`${mod.id}/${c.id}: DC ${c.dc.value} 过高，3 级桌很少用 16+`);
    }
  }
  for (const chapter of mod.chapters) {
    for (const scene of chapter.scenes) {
      const sourceIds = new Set<string>();
      for (const item of scene.environmentItems ?? []) {
        if (sourceIds.has(item.id)) {
          errors.push(`${mod.id}/${scene.id}: 环境物品 id 重复 ${item.id}`);
        }
        sourceIds.add(item.id);
        if (item.availability === "plausible" && !item.check) {
          errors.push(`${mod.id}/${scene.id}/${item.id}: plausible 物品需要检定`);
        }
        if (item.check && (item.check.dc < 8 || item.check.dc > 15)) {
          errors.push(`${mod.id}/${scene.id}/${item.id}: 临场物品 DC 应为 8–15`);
        }
        if ((item.quantity ?? 1) < 1 || (item.quantity ?? 1) > 9) {
          errors.push(`${mod.id}/${scene.id}/${item.id}: 临场物品数量应为 1–9`);
        }
      }
      for (const challenge of scene.physicalChallenges ?? []) {
        if (challenge.ruling === "check" && !challenge.check) {
          errors.push(`${mod.id}/${scene.id}/${challenge.id}: check 动作缺检定`);
        }
        if (challenge.check && (challenge.check.dc < 8 || challenge.check.dc > 15)) {
          errors.push(`${mod.id}/${scene.id}/${challenge.id}: 场景动作 DC 应为 8–15`);
        }
      }
    }
  }
  const bannedJoin = mod.banned.join("");
  if (!bannedJoin.includes("检定墙") && !bannedJoin.includes("对话")) {
    errors.push(`${mod.id}: banned 应禁止把对话做成检定墙`);
  }
  if (!bannedJoin.includes("外乡人") && !bannedJoin.includes("陌生人")) {
    errors.push(`${mod.id}: banned 应禁止把关键物交给尚未报上来历的外乡人`);
  }
  for (const n of mod.npcs) {
    if (n.startStance && !["guest", "named", "useful", "trusted", "hostile"].includes(n.startStance)) {
      errors.push(`${mod.id}/${n.id}: startStance 不合法`);
    }
    if (!n.voice?.trim() || n.voice.trim().length < 12) {
      errors.push(`${mod.id}/${n.id}: 缺声口 voice`);
    }
    if (!n.lines || n.lines.length < 2) {
      errors.push(`${mod.id}/${n.id}: lines 至少两句会说的话`);
    }
  }
  const hasStall = mod.triggers.some(
    (t) => t.if.includes("冷场") || t.if.includes("卡住"),
  );
  if (!hasStall) errors.push(`${mod.id}: triggers 需要一条冷场推进`);
  if (errors.length) {
    throw new Error(`模组合同未通过：\n- ${errors.join("\n- ")}`);
  }
  return mod;
}
