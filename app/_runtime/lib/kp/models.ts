export const AUTHORITATIVE_KP_MODEL = "deepseek-v4-flash" as const;
export const ALTERNATIVE_AUTHORITATIVE_KP_MODEL = "deepseek-v4-pro" as const;
export const DEFAULT_KP_MODEL = AUTHORITATIVE_KP_MODEL;

/** Product 0.4's complete public KP model catalog. */
export const AUTHORITATIVE_KP_MODELS = [
  {
    id: AUTHORITATIVE_KP_MODEL,
    name: "DeepSeek V4 Flash",
    summary: "响应更快，适合节奏紧凑、频繁互动的跑团。",
    runtime: "authoritative" as const,
  },
  {
    id: ALTERNATIVE_AUTHORITATIVE_KP_MODEL,
    name: "DeepSeek V4 Pro",
    summary: "复杂叙事与长线推理更强，但响应与消耗更高。",
    runtime: "authoritative" as const,
  },
] as const;

export const KP_MODELS = AUTHORITATIVE_KP_MODELS;

export type AuthoritativeKpModelId = (typeof AUTHORITATIVE_KP_MODELS)[number]["id"];
export type KpModelId = AuthoritativeKpModelId;

export function isKpModelId(value: unknown): value is KpModelId {
  return KP_MODELS.some((model) => model.id === value);
}

export function publicKpModelId(value: unknown): KpModelId | null {
  return isKpModelId(value) ? value : null;
}

export function kpModelById(id: unknown) {
  return KP_MODELS.find((model) => model.id === id);
}

export function isAuthoritativeKpModel(value: unknown): value is AuthoritativeKpModelId {
  return AUTHORITATIVE_KP_MODELS.some((model) => model.id === value);
}
