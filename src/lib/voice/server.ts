import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";

const ttsCache = new Map<string, string>();

async function assertMember(roomId: string, userId: string) {
  const sql = await getSql();
  const rows = await sql<{ user_id: string }>`
    select user_id from room_members where room_id = ${roomId} and user_id = ${userId}
  `;
  if (!rows[0]) throw new Error("不在这一桌");
}

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { mime: string; b64: string }) => input)
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "语音识别暂不可用" };
    if (!data.b64 || data.b64.length > 2_800_000) {
      return { ok: false as const, error: "录音过长，请说得更短一些" };
    }
    const bin = Buffer.from(data.b64, "base64");
    const mime = data.mime || "audio/webm";
    const ext = mime.includes("mp4") ? "mp4" : mime.includes("mpeg") ? "mp3" : "webm";
    const form = new FormData();
    form.append(
      "file",
      new Blob([bin], { type: mime }),
      `take.${ext}`,
    );
    form.append("model", "grok-stt");
    const tryUrls = ["https://api.x.ai/v1/stt", "https://api.x.ai/v1/audio/transcriptions"];
    let lastErr = "语音识别失败";
    for (const url of tryUrls) {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!res.ok) {
        lastErr = `语音识别失败（${res.status}）`;
        continue;
      }
      const body = (await res.json()) as { text?: string };
      const text = (body.text ?? "").trim();
      if (!text) return { ok: false as const, error: "没听清，请再试一次" };
      return { ok: true as const, text };
    }
    return { ok: false as const, error: lastErr };
  });

export const speakNarration = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { roomId: string; messageId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertMember(data.roomId, context.userId);
    const cacheKey = data.messageId;
    const cached = ttsCache.get(cacheKey);
    if (cached) return { ok: true as const, b64: cached, mime: "audio/mpeg" };

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "语音播报暂不可用" };

    const sql = await getSql();
    const rows = await sql<{ tts_text: string | null; body: string; kind: string }>`
      select tts_text, body, kind from messages
      where id = ${data.messageId} and room_id = ${data.roomId}
    `;
    const row = rows[0];
    if (!row) return { ok: false as const, error: "没有这段旁白" };
    if (row.kind !== "narrate" && row.kind !== "refuse" && row.kind !== "call_roll" && row.kind !== "open") {
      return { ok: false as const, error: "这段不必朗读" };
    }
    const text = (row.tts_text || row.body).slice(0, 800);
    if (!text) return { ok: false as const, error: "空旁白" };

    const res = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        text,
        voice_id: "orion",
        language: "zh",
      }),
    });
    if (!res.ok) {
      return { ok: false as const, error: `播报失败（${res.status}）` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString("base64");
    if (ttsCache.size > 80) {
      const first = ttsCache.keys().next().value;
      if (first) ttsCache.delete(first);
    }
    ttsCache.set(cacheKey, b64);
    return { ok: true as const, b64, mime: "audio/mpeg" };
  });
