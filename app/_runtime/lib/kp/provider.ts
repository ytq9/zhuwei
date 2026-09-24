import { env } from "cloudflare:workers";
import { createOpenAIAuthoritativeBinding } from "./openai";

import {
  createDeepSeekAuthoritativeBinding,
  createDeepSeekStrictToolBinding,
} from "./deepseek";
import {
  authoritativeKpProfileByModelId,
  kpRequestDeclaresStrictTool,
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

function openAIApiKey() {
  return (env as typeof env & { OPENAI_API_KEY?: string }).OPENAI_API_KEY;
}

export function authoritativeKpModelBinding(
  profile: AuthoritativeKpProfile,
): AuthoritativeModelBinding {
  const binding = bindingForProfile(profile);
  return { run(model, input, options) {
    if (model !== profile.modelId) throw Object.assign(new Error("MODEL_PROFILE_UNAVAILABLE"), {
      status: 404, code: "model_not_found",
    });
    return binding.run(model, input, options);
  } };
}

function bindingForProfile(profile: AuthoritativeKpProfile): AuthoritativeModelBinding {
  if (profile.provider === "openai") {
    return createOpenAIAuthoritativeBinding({ apiKey: openAIApiKey() ?? "" });
  }
  if (profile.provider === "deepseek") {
    const apiKey = deepSeekApiKey() ?? "";
    const ordinary = createDeepSeekAuthoritativeBinding({ apiKey });
    // The request owns its transport. A vNext narration review explicitly
    // declares strict even when the shared generation profile uses ordinary
    // Forms. Profile-level routing would silently skip strict enforcement.
    // Ordinary generation and Form selection keep their original endpoint.
    const strict = createDeepSeekStrictToolBinding({ apiKey });
    return {
      run(model, input, options) {
        return kpRequestDeclaresStrictTool(input)
          ? strict.run(model, input, options)
          : ordinary.run(model, input, options);
      },
    };
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
  if (!profile) return "本桌 KP 模型暂不可用";
  if (profile?.provider === "cloudflare-workers-ai") {
    const ai = (env as typeof env & { AI?: Ai }).AI;
    return ai ? null : "本桌 KP 模型暂不可用";
  }
  if (!(profile.provider === "openai" ? openAIApiKey() : deepSeekApiKey())?.trim()) {
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
  const profile = authoritativeKpProfileByModelId(model);
  const modelName = kpModelById(model)?.name ?? model;
  const configurationError = kpModelConfigurationError(model);
  if (!profile || configurationError) return { ok: false as const, error: configurationError ?? "本桌 KP 模型暂不可用" };
  try {
    const response = await authoritativeKpModelBinding(profile).run(model, {
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
