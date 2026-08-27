import { env } from "cloudflare:workers";
import {
  authMiddleware,
  createServerFn,
  PublicServerError,
} from "@/lib/platform/server-fn";
import { getSql } from "@/lib/db";
import { observeAuthoritativeRoom } from "@/lib/room/server";
import {
  AUTHORITATIVE_RULESET_VERSION,
  LEGACY_RULESET_VERSION,
} from "@/lib/rules/ruleset";
import { synthesizeCurrentDeliveryNarration } from "./current-delivery";

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function assertMember(roomId: string, userId: string) {
  const sql = await getSql();
  const rows = await sql<{ user_id: string }>`
    select user_id from room_members where room_id = ${roomId} and user_id = ${userId}
  `;
  if (!rows[0]) throw new PublicServerError("不在这一桌");
}

function narrationUnavailable() {
  return { ok: false as const, error: "这段旁白已经不可回看" };
}

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { mime: string; b64: string }) => input)
  .handler(async ({ data }) => {
    if (!data.b64 || data.b64.length > 2_800_000) {
      return { ok: false as const, error: "录音过长，请说得更短一些" };
    }
    try {
      const result = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
        audio: data.b64,
        task: "transcribe",
        language: "zh",
        vad_filter: true,
        initial_prompt: "中文 D&D 跑团，人物、地点、法术、装备、检定与骰点。",
        beam_size: 5,
        condition_on_previous_text: false,
      });
      const text = result.text.trim();
      if (!text) return { ok: false as const, error: "没听清，请再试一次" };
      return { ok: true as const, text };
    } catch {
      return { ok: false as const, error: "语音识别失败，请再试一次" };
    }
  });

export const speakNarration = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { roomId: string; messageId: string }) => input)
  .handler(async ({ data, context }) => {
    const sql = await getSql();
    const room = (
      await sql<{ ruleset_version: string }>`
        select ruleset_version from rooms where id = ${data.roomId}
      `
    )[0];

    if (room?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      try {
        await assertMember(data.roomId, context.userId);
      } catch {
        return narrationUnavailable();
      }
      let result;
      try {
        result = await synthesizeCurrentDeliveryNarration({
          messageId: data.messageId,
          observe: (query) => observeAuthoritativeRoom(
            data.roomId,
            context.userId,
            query,
          ),
          synthesize: async (text) => await env.AI.run(
            "@cf/myshell-ai/melotts",
            { prompt: text, lang: "zh" },
            { returnRawResponse: true },
          ),
        });
      } catch {
        return { ok: false as const, error: "语音播报失败，请再试一次" };
      }
      if (result.kind === "unavailable") return narrationUnavailable();
      if (result.kind === "synthesisFailed") {
        return {
          ok: false as const,
          error: result.empty
            ? "播报没有生成音频"
            : `播报失败（${result.status ?? 500}）`,
        };
      }
      return {
        ok: true as const,
        b64: bytesToBase64(result.bytes),
        mime: result.mime,
      };
    }

    if (room?.ruleset_version !== LEGACY_RULESET_VERSION) {
      return narrationUnavailable();
    }

    // Legacy rooms retain their exact message-table presentation contract.
    await assertMember(data.roomId, context.userId);
    const rows = await sql<{ tts_text: string | null; body: string; kind: string }>`
      select tts_text, body, kind from messages
      where id = ${data.messageId} and room_id = ${data.roomId}
    `;
    const row = rows[0];
    if (!row) return { ok: false as const, error: "没有这段旁白" };
    if (
      row.kind !== "narrate"
      && row.kind !== "refuse"
      && row.kind !== "call_roll"
      && row.kind !== "open"
    ) {
      return { ok: false as const, error: "这段不必朗读" };
    }
    const text = (row.tts_text || row.body).slice(0, 800);
    if (!text) return { ok: false as const, error: "空旁白" };

    try {
      const res = await env.AI.run(
        "@cf/myshell-ai/melotts",
        { prompt: text, lang: "zh" },
        { returnRawResponse: true },
      );
      if (!res.ok) {
        return { ok: false as const, error: `播报失败（${res.status}）` };
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0) {
        return { ok: false as const, error: "播报没有生成音频" };
      }
      const contentType = res.headers.get("content-type")?.split(";")[0];
      const mime = contentType?.startsWith("audio/") ? contentType : "audio/mpeg";
      return { ok: true as const, b64: bytesToBase64(bytes), mime };
    } catch {
      return { ok: false as const, error: "语音播报失败，请再试一次" };
    }
  });
