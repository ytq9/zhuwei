import type { AuthoritativeModelBinding } from "./authoritative-types";
import {
  DEEPSEEK_STRICT_TOOL_BETA_ENDPOINT,
  assertDeepSeekStrictToolSchema,
} from "./deepseek-strict-tool";

type DeepSeekFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type DeepSeekBindingOptions = {
  apiKey: string;
  fetcher?: DeepSeekFetcher;
};

type UnknownRecord = Record<string, unknown>;

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

export class DeepSeekStrictToolConfigurationError extends Error {
  readonly status = 422;
  readonly code = "strict_tool_configuration_invalid";

  constructor(reason: string) {
    super(`DeepSeek strict-tool request is invalid: ${reason}.`);
    this.name = "DeepSeekStrictToolConfigurationError";
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

/**
 * DeepSeek's strict function schema is a beta transport, not a label for
 * ordinary tool calling. This adapter owns the beta endpoint and rejects any
 * request that would silently fall back to unconstrained tool output before
 * performing network I/O.
 */
export function createDeepSeekStrictToolBinding(
  options: DeepSeekBindingOptions,
): AuthoritativeModelBinding {
  const apiKey = options.apiKey.trim();
  const fetcher = options.fetcher ?? fetch;
  return {
    async run(model, input, runOptions) {
      if (!apiKey) throw new DeepSeekApiError(401);
      assertDeepSeekStrictToolModelInput(input);
      const response = await fetcher(DEEPSEEK_STRICT_TOOL_BETA_ENDPOINT, {
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

export function assertDeepSeekStrictToolModelInput(
  input: Record<string, unknown>,
): void {
  if (input.tool_choice !== "required") strictConfigurationInvalid("tool-choice-required");
  if (input.parallel_tool_calls !== undefined && input.parallel_tool_calls !== false) {
    strictConfigurationInvalid("parallel-tool-calls-must-be-false");
  }
  if (input.response_format !== undefined) {
    strictConfigurationInvalid("response-format-conflicts-with-tool-output");
  }
  if (!Array.isArray(input.tools) || input.tools.length !== 1) {
    strictConfigurationInvalid("single-function-tool-required");
  }
  for (const [index, candidate] of input.tools.entries()) {
    if (!isRecord(candidate)
      || candidate.type !== "function"
      || !hasOnlyKeys(candidate, ["type", "function"])) {
      strictConfigurationInvalid(`tools-${index}-function-required`);
    }
    const definition = candidate.function;
    if (!isRecord(definition)
      || !hasOnlyKeys(definition, ["name", "description", "strict", "parameters"])) {
      strictConfigurationInvalid(`tools-${index}-definition-invalid`);
    }
    if (typeof definition.name !== "string"
      || !/^[A-Za-z0-9_-]{1,64}$/u.test(definition.name)) {
      strictConfigurationInvalid(`tools-${index}-name-invalid`);
    }
    if (definition.description !== undefined
      && (typeof definition.description !== "string" || definition.description.length > 4_096)) {
      strictConfigurationInvalid(`tools-${index}-description-invalid`);
    }
    if (definition.strict !== true) {
      strictConfigurationInvalid(`tools-${index}-strict-required`);
    }
    try {
      assertDeepSeekStrictToolSchema(definition.parameters);
    } catch {
      strictConfigurationInvalid(`tools-${index}-schema-invalid`);
    }
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function strictConfigurationInvalid(reason: string): never {
  throw new DeepSeekStrictToolConfigurationError(reason);
}
