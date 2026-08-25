import type { NpcRollReq, PendingRoll } from "./prompt";
import type { ActionProposal } from "./action-ruling";

export type KpSpeech = {
  hat: "refuse" | "call_roll" | "narrate" | "oppose";
  speech: string;
  tts: string;
  actionProposal: ActionProposal | null;
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
};

const SPEECH_CAP = 560;

const ROLLCALL =
  /(莉安.{0,16}(铜钥|攥)|奈斯.{0,16}(风帽|低着头)|瓦罗.{0,12}(清嗓|袖口|清了清嗓))/;

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

export function parseKpSafe(raw: string): KpSpeech {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const json = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  let v: Partial<KpSpeech> = {};
  try {
    v = JSON.parse(json) as Partial<KpSpeech>;
  } catch {
    const speech = stripRepeat(raw.replace(/```json|```/g, "").trim()).slice(0, SPEECH_CAP);
    return fallbackSpeech(speech || "请再说一次你要做什么。");
  }
  const hat =
    v.hat === "refuse" ||
    v.hat === "call_roll" ||
    v.hat === "narrate" ||
    v.hat === "oppose"
      ? v.hat
      : "narrate";
  const speech = stripStatusRollcall(stripRepeat(String(v.speech ?? "").trim())).slice(0, SPEECH_CAP);
  const tts = stripStatusRollcall(stripRepeat(String(v.tts ?? speech).trim())).slice(0, 320);
  return {
    hat,
    speech: speech || "现场暂时安静。你们还可以问、看、或动手。",
    tts: tts || speech,
    actionProposal: parseActionProposal(v.actionProposal),
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
  };
}

function parseActionProposal(value: unknown): ActionProposal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const kind = String(raw.kind ?? "");
  const intent = String(raw.intent ?? "");
  if (!["none", "allow", "check", "refuse"].includes(kind)) return null;
  if (!["find_item", "physical", "other"].includes(intent)) return null;
  return {
    kind: kind as ActionProposal["kind"],
    intent: intent as ActionProposal["intent"],
    sourceId: typeof raw.sourceId === "string" ? raw.sourceId.slice(0, 80) : undefined,
    ability: typeof raw.ability === "string" ? raw.ability.slice(0, 12) : undefined,
    skill: typeof raw.skill === "string" ? raw.skill.slice(0, 32) : undefined,
    dc: typeof raw.dc === "number" && Number.isFinite(raw.dc) ? raw.dc : undefined,
    reason: typeof raw.reason === "string" ? raw.reason.slice(0, 160) : undefined,
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

function fallbackSpeech(speech: string): KpSpeech {
  return {
    hat: "narrate",
    speech,
    tts: speech.slice(0, 180),
    actionProposal: null,
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
