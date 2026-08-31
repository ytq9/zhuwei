import type { NpcRollReq, PendingRoll } from "./prompt";

export type KpSpeech = {
  hat: "refuse" | "call_roll" | "narrate" | "oppose";
  speech: string;
  tts: string;
  rolls: PendingRoll[];
  revealClues: string[];
  revealNpcs: string[];
  scene: { chapterId: string; sceneId: string } | null;
  characterUpdates: { userId: string; hp?: number; conditions?: string[] }[];
  secretPatch: Record<string, unknown>;
  stancePatch: { npcId: string; stance: string; why: string }[];
  wherePatch: { userId: string; place: string }[];
  log: string;
  npcRolls: NpcRollReq[];
  spendPatch: { userId: string; action?: boolean; bonus?: boolean; reaction?: boolean } | null;
  combat: unknown;
  metaStripped?: boolean;
};

const SPEECH_CAP = 560;

const ROLLCALL =
  /(莉安.{0,16}(铜钥|攥)|奈斯.{0,16}(风帽|低着头)|瓦罗.{0,12}(清嗓|袖口|清了清嗓))/;

const META_TOKEN =
  /SourceClaim|CanonicalFact|ClaimedFact|wherePatch|secretPatch|stancePatch|revealClues|npcFlags|clueId|userId|JSON\s*对象|提交标识|待决状态|角色前提|书证|口述主张/i;

const META_LINE =
  /SourceClaim|CanonicalFact|ClaimedFact|requester\s*=|objective\s*=|wherePatch|secretPatch|stancePatch|userId\s*=|hat\s*=|clueId\s*=|角色前提|已作为\s*|不是\s*Canonical|明确归属于|提交标识|待决状态|JSON\s*对象|书证层|口头主张|已确认了你的说法/i;

const ECHO_YOU_SAID = /^\s*(你说|玩家说|行动者说)\s*[:：]/;

/** 砍掉段末点名全场的调度句。 */
export function stripStatusRollcall(text: string) {
  const parts = text
    .split(/(?<=[。！？…])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return text;
  const last = parts[parts.length - 1] ?? "";
  if (last.length <= 42 && ROLLCALL.test(last)) {
    return parts.slice(0, -1).join("");
  }
  return text;
}

/** 去掉模型泄漏的协议句、回声「你说：」。 */
export function stripMetaTalk(text: string) {
  const paras = text.split(/\n{2,}/);
  const keptParas: string[] = [];
  for (const para of paras) {
    const sentences = para
      .split(/(?<=[。！？…\n])/)
      .map((s) => s.trim())
      .filter(Boolean);
    const ok = sentences.filter((s) => {
      if (ECHO_YOU_SAID.test(s)) return false;
      if (META_LINE.test(s)) return false;
      if (/^[A-Za-z][A-Za-z0-9_]*\s*=/.test(s) && s.length < 120) return false;
      if (/^(NPC|KP)\s*的回应/.test(s)) return false;
      return true;
    });
    const joined = ok.join("").trim();
    if (joined) keptParas.push(joined);
  }
  return keptParas.join("\n\n").trim();
}

export function isMetaHeavy(text: string) {
  const t = text.replace(/\s+/g, "");
  if (!t) return true;
  if (META_TOKEN.test(text)) return true;
  if (ECHO_YOU_SAID.test(text.trim())) return true;
  if (/角色前提已/.test(text) && /来意/.test(text)) return true;
  if (/requester\s*=/.test(text) || /objective\s*=/.test(text)) return true;
  return false;
}

export function naturalFallback(actorName: string, action: string) {
  const a = action.replace(/\s+/g, "");
  if (/我知道|知道些什么|我了解什么|我掌握/.test(a)) {
    return "你是受暮烛镇一位老熟人的口信赶来的：黑橡居酒屋的老板赫斯·黑橡死了，今晚守灵。老朋友叫什么由你自己定。此刻大厅点着蜡烛，遗体停在拼起的长桌上，莉安坐在炉边，瓦罗按着一份盖印的文件，奈斯站在楼梯阴影里。";
  }
  if (/谁叫我|谁让我来|谁找我|为什么在这|我为什么来|谁请我/.test(a)) {
    return "镇上的消息传到你耳朵里——一位老熟人请你来一趟。赫斯死了，今晚是守灵。老朋友的名字你还没说出口，那就先别编。大厅里这三个人都看得到你。";
  }
  if (
    /^(lian|莉安).{0,8}(你好|嗨|哈喽|hello|hi)/i.test(a) ||
    /^(你好|嗨).{0,6}(莉安|lian)/i.test(a)
  ) {
    return `莉安抬眼看了${actorName}一眼，手里还握着那枚铜钥。「你们哪位？今晚是守灵，先报个名字。」`;
  }
  return "现场还在。他们听见了。还可以问、看、或动手。";
}

export function parseKpSafe(raw: string): KpSpeech {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const json = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  let v: Partial<KpSpeech> = {};
  try {
    v = JSON.parse(json) as Partial<KpSpeech>;
  } catch {
    const speech = stripRepeat(
      stripMetaTalk(raw.replace(/```json|```/g, "").trim()),
    ).slice(0, SPEECH_CAP);
    const metaStripped = isMetaHeavy(raw) || !speech;
    return fallbackSpeech(
      speech || "请再说一次你要做什么。",
      metaStripped,
    );
  }
  const hat =
    v.hat === "refuse" ||
    v.hat === "call_roll" ||
    v.hat === "narrate" ||
    v.hat === "oppose"
      ? v.hat
      : "narrate";
  const rawSpeech = String(v.speech ?? "").trim();
  const rawTts = String(v.tts ?? "").trim();
  const speech = stripStatusRollcall(
    stripRepeat(stripMetaTalk(rawSpeech)),
  ).slice(0, SPEECH_CAP);
  const tts = stripStatusRollcall(
    stripRepeat(stripMetaTalk(rawTts || speech)),
  ).slice(0, 320);
  const metaStripped = isMetaHeavy(rawSpeech) || isMetaHeavy(raw);
  return {
    hat,
    speech: speech || "现场暂时安静。你们还可以问、看、或动手。",
    tts: tts || speech,
    rolls: Array.isArray(v.rolls) ? (v.rolls as KpSpeech["rolls"]) : [],
    revealClues: Array.isArray(v.revealClues) ? v.revealClues.map(String) : [],
    revealNpcs: Array.isArray(v.revealNpcs) ? v.revealNpcs.map(String) : [],
    scene: v.scene ?? null,
    characterUpdates: Array.isArray(v.characterUpdates) ? v.characterUpdates : [],
    secretPatch:
      v.secretPatch && typeof v.secretPatch === "object" ? v.secretPatch : {},
    stancePatch: Array.isArray(v.stancePatch)
      ? (v.stancePatch as KpSpeech["stancePatch"])
      : [],
    wherePatch: Array.isArray(v.wherePatch)
      ? (v.wherePatch as KpSpeech["wherePatch"])
      : [],
    log: String(v.log ?? "").trim().slice(0, 160),
    npcRolls: Array.isArray(v.npcRolls) ? (v.npcRolls as NpcRollReq[]) : [],
    spendPatch:
      v.spendPatch && typeof v.spendPatch === "object"
        ? (v.spendPatch as KpSpeech["spendPatch"])
        : null,
    combat: v.combat ?? null,
    metaStripped,
  };
}

export function stripRepeat(text: string) {
  const sentences = text
    .split(/(?<=[。！？…])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of sentences) {
    const key = s.replace(/\s+/g, "").slice(0, 24);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  let joined = out.join("");
  const half = Math.floor(joined.length / 2);
  if (half >= 24 && joined.slice(0, half) === joined.slice(half)) {
    joined = joined.slice(0, half);
  }
  return joined;
}

export function tooLike(a: string, b: string) {
  const x = a.replace(/\s+/g, "");
  const y = b.replace(/\s+/g, "");
  if (!x || !y) return false;
  if (x === y) return true;
  const n = Math.min(80, x.length, y.length);
  let hit = 0;
  for (let i = 0; i < n; i += 4) {
    if (x.slice(i, i + 8) && y.includes(x.slice(i, i + 8))) hit += 1;
  }
  return hit >= 6;
}

function fallbackSpeech(speech: string, metaStripped = false): KpSpeech {
  return {
    hat: "narrate",
    speech,
    tts: speech.slice(0, 180),
    rolls: [],
    revealClues: [],
    revealNpcs: [],
    scene: null,
    characterUpdates: [],
    secretPatch: {},
    stancePatch: [],
    wherePatch: [],
    log: "",
    npcRolls: [],
    spendPatch: null,
    combat: null,
    metaStripped,
  };
}

export type TableMemory = {
  recap: string;
  facts: string[];
  lastSpeeches: string[];
};

export function readMemory(secret: Record<string, unknown>): TableMemory {
  const raw = secret.memory;
  if (!raw || typeof raw !== "object") {
    return { recap: "", facts: [], lastSpeeches: [] };
  }
  const m = raw as Partial<TableMemory>;
  return {
    recap: String(m.recap ?? "").slice(0, 900),
    facts: Array.isArray(m.facts) ? m.facts.map(String).slice(-14) : [],
    lastSpeeches: Array.isArray(m.lastSpeeches)
      ? m.lastSpeeches.map(String).slice(-4)
      : [],
  };
}

export function writeMemory(
  secret: Record<string, unknown>,
  patch: {
    log?: string;
    speech?: string;
    scene?: string;
  },
): Record<string, unknown> {
  const mem = readMemory(secret);
  if (patch.log) {
    mem.facts = [...mem.facts, patch.log].slice(-14);
  }
  if (patch.speech) {
    mem.lastSpeeches = [...mem.lastSpeeches, patch.speech].slice(-4);
  }
  const factLine = mem.facts.slice(-6).join("；");
  mem.recap = [patch.scene, factLine].filter(Boolean).join("。").slice(0, 900);
  return { ...secret, memory: mem };
}
