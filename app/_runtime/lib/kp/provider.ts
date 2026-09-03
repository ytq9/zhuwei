import { env } from "cloudflare:workers";

import {
  createDeepSeekAuthoritativeBinding,
  createDeepSeekStrictToolBinding,
} from "./deepseek";
import {
  authoritativeKpProfileByModelId,
  kpStructuredOutputMode,
} from "./authoritative-policy";
import type {
  AuthoritativeKpProfile,
  AuthoritativeModelBinding,
} from "./authoritative-types";
import {
  kpModelById,
  type KpModelId,
} from "./models";

function deepSeekApiKey() {
  const secrets = env as typeof env & { DEEPSEEK_API_KEY?: string };
  return secrets.DEEPSEEK_API_KEY;
}

export function authoritativeKpModelBinding(
  profile: AuthoritativeKpProfile,
): AuthoritativeModelBinding {
  if (profile.provider === "deepseek") {
    const apiKey = deepSeekApiKey() ?? "";
    // A profile that declares strict output has to reach the beta endpoint
    // that enforces it. Selecting the transport from anything other than the
    // profile is how a registry can claim `strict-tool` while the request on
    // the wire carries an unconstrained tool.
    return kpStructuredOutputMode(profile) === "strict-tool"
      ? createDeepSeekStrictToolBinding({ apiKey })
      : createDeepSeekAuthoritativeBinding({ apiKey });
  }
  const ai = (env as typeof env & { AI?: Ai }).AI;
  if (!ai) {
    return {
      async run() {
        throw Object.assign(new Error("Workers AI binding is unavailable."), {
          status: 401,
          code: "binding_missing",
        });
      },
    };
  }
  return {
    run(model, input, options) {
      return ai.run(model, input, options);
    },
  };
}

export function kpModelConfigurationError(model: string) {
  const profile = authoritativeKpProfileByModelId(model);
  if (profile?.provider === "cloudflare-workers-ai") {
    const ai = (env as typeof env & { AI?: Ai }).AI;
    return ai ? null : "本桌 KP 模型暂不可用";
  }
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
  if (authoritativeKpProfileByModelId(model)?.provider === "cloudflare-workers-ai") {
    return {
      ok: false as const,
      error: `${kpModelById(model)?.name ?? model} 必须通过 authoritative KP Adapter 调用`,
    };
  }
  const apiKey = deepSeekApiKey();
  const modelName = kpModelById(model)?.name ?? model;
  if (!apiKey) return { ok: false as const, error: `${modelName} 尚未配置 API 密钥` };
  try {
    const response = await createDeepSeekAuthoritativeBinding({ apiKey }).run(model, {
      thinking: { type: "disabled" },
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 1200,
      response_format: { type: "json_object" },
      messages,
    });
    const body = response as {
      choices?: { message?: { content?: string } }[];
    };
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return { ok: false as const, error: `${modelName} 返回了空结果` };
    return { ok: true as const, text };
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error
      && typeof error.status === "number"
      ? error.status
      : undefined;
    if (status !== undefined) {
      return { ok: false as const, error: `${modelName} 无法应答（${status}）` };
    }
    return { ok: false as const, error: `${modelName} 返回了无效结果` };
  }
}
