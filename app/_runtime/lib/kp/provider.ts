import { env } from "cloudflare:workers";

import { kpModelById, type KpModelId } from "./models";

function deepSeekApiKey() {
  const secrets = env as typeof env & { DEEPSEEK_API_KEY?: string };
  return secrets.DEEPSEEK_API_KEY;
}

export function kpModelConfigurationError(model: KpModelId) {
  if (!deepSeekApiKey()) {
    return `${kpModelById(model)?.name ?? model} 尚未配置 API 密钥`;
  }
  return null;
}

export async function chatModelText(
  model: KpModelId,
  messages: { role: "system" | "user"; content: string }[],
  options: { temperature?: number; maxTokens?: number } = {},
) {
  const apiKey = deepSeekApiKey();
  const modelName = kpModelById(model)?.name ?? model;
  if (!apiKey) return { ok: false as const, error: `${modelName} 尚未配置 API 密钥` };
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        thinking: { type: "disabled" },
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 1200,
        response_format: { type: "json_object" },
        messages,
      }),
    });
    if (!response.ok) {
      return { ok: false as const, error: `${modelName} 无法应答（${response.status}）` };
    }
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return { ok: false as const, error: `${modelName} 返回了空结果` };
    return { ok: true as const, text };
  } catch {
    return { ok: false as const, error: `${modelName} 返回了无效结果` };
  }
}
