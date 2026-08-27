import type { AuthoritativeModelBinding } from "./authoritative-types";

type DeepSeekFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type DeepSeekBindingOptions = {
  apiKey: string;
  fetcher?: DeepSeekFetcher;
};

export class DeepSeekApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter?: number;

  constructor(status: number, retryAfter?: number) {
    super(`DeepSeek request failed with status ${status}.`);
    this.name = "DeepSeekApiError";
    this.status = status;
    this.code = status === 402
      ? "quota_exhausted"
      : status === 429
        ? "rate_limit"
        : status >= 500
          ? "provider_unavailable"
          : "request_rejected";
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (raw === null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function hasInsufficientSystemResource(response: unknown): boolean {
  if (!response || typeof response !== "object") return false;
  const choices = (response as { choices?: unknown }).choices;
  return Array.isArray(choices) && choices.some((choice) => (
    choice !== null
    && typeof choice === "object"
    && (choice as { finish_reason?: unknown }).finish_reason === "insufficient_system_resource"
  ));
}

function requestBody(model: string, input: Record<string, unknown>) {
  const supported = { ...input };
  const maxCompletionTokens = supported.max_completion_tokens;
  delete supported.max_completion_tokens;
  delete supported.parallel_tool_calls;
  return {
    ...supported,
    model,
    ...(typeof maxCompletionTokens === "number"
      ? { max_tokens: maxCompletionTokens }
      : {}),
    thinking: { type: "disabled" },
    stream: false,
  };
}

export function createDeepSeekAuthoritativeBinding(
  options: DeepSeekBindingOptions,
): AuthoritativeModelBinding {
  const apiKey = options.apiKey.trim();
  const fetcher = options.fetcher ?? fetch;
  return {
    async run(model, input, runOptions) {
      // Defer configuration failures to the invocation boundary so the
      // authoritative adapter can classify them without bypassing its
      // failure receipt and no-commit path.
      if (!apiKey) throw new DeepSeekApiError(401);
      const response = await fetcher("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody(model, input)),
        signal: runOptions?.signal,
      });
      if (!response.ok) {
        throw new DeepSeekApiError(response.status, retryAfterSeconds(response));
      }
      const body: unknown = await response.json();
      if (hasInsufficientSystemResource(body)) throw new DeepSeekApiError(503);
      return body;
    },
  };
}
