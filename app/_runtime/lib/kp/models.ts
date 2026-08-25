export const DEFAULT_KP_MODEL = "deepseek-v4-flash" as const;

export const KP_MODELS = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    summary: "响应更快，适合节奏紧凑、频繁互动的跑团。",
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    summary: "复杂叙事与长线推理更强，但响应与消耗更高。",
  },
] as const;

export type KpModelId = (typeof KP_MODELS)[number]["id"];

export function isKpModelId(value: unknown): value is KpModelId {
  return KP_MODELS.some((model) => model.id === value);
}

export function kpModelById(id: string) {
  return KP_MODELS.find((model) => model.id === id);
}
