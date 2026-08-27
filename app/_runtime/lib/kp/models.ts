export const AUTHORITATIVE_KP_MODEL = "@cf/zai-org/glm-4.7-flash" as const;
export const DEFAULT_KP_MODEL = AUTHORITATIVE_KP_MODEL;

export const KP_MODELS = [
  {
    id: AUTHORITATIVE_KP_MODEL,
    name: "GLM 4.7 Flash（Workers AI）",
    summary: "权威规则房间的免费额度默认模型；支持长上下文与工具调用。",
    runtime: "authoritative" as const,
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    summary: "响应更快，适合节奏紧凑、频繁互动的跑团。",
    runtime: "legacy" as const,
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    summary: "复杂叙事与长线推理更强，但响应与消耗更高。",
    runtime: "legacy" as const,
  },
] as const;

export type KpModelId = (typeof KP_MODELS)[number]["id"];

export function isKpModelId(value: unknown): value is KpModelId {
  return KP_MODELS.some((model) => model.id === value);
}

export function kpModelById(id: string) {
  return KP_MODELS.find((model) => model.id === id);
}

export function isAuthoritativeKpModel(value: unknown): value is typeof AUTHORITATIVE_KP_MODEL {
  return value === AUTHORITATIVE_KP_MODEL;
}
