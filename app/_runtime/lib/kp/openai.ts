import type { AuthoritativeModelBinding } from "./authoritative-types";
import { assertDeepSeekStrictToolModelInput } from "./deepseek";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Only schema keywords are translated; field names, descriptions and enum
 * values belong to the product and must survive the transport unchanged. */
function schemaDialect(value: unknown, toOpenAI: boolean): unknown {
  if (!record(value)) return value;
  // OpenAI rejects siblings beside $ref. A single-alternative anyOf keeps
  // both the reference and its field-specific guidance without expanding a
  // recursive definition. Collapse that wrapper for internal validation.
  if (!toOpenAI && Array.isArray(value.anyOf) && value.anyOf.length === 1
    && record(value.anyOf[0]) && Object.keys(value.anyOf[0]).length === 1
    && typeof value.anyOf[0].$ref === "string") {
    const { anyOf, ...rest } = value;
    return schemaDialect({ ...rest, $ref: anyOf[0].$ref }, false);
  }
  const result: RecordValue = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string") {
      result[key] = toOpenAI ? child.replace(/^#\/\$def\//u, "#/$defs/")
        : child.replace(/^#\/\$defs\//u, "#/$def/");
    } else if (["properties", "$def", "$defs"].includes(key) && record(child)) {
      const name = key === "$def" && toOpenAI ? "$defs" : key === "$defs" && !toOpenAI ? "$def" : key;
      if (Object.hasOwn(result, name)) throw new TypeError("MODEL_SCHEMA_DEFINITIONS_CONFLICT");
      result[name] = Object.fromEntries(Object.entries(child).map(([name, schema]) => [name, schemaDialect(schema, toOpenAI)]));
    } else if (["anyOf", "oneOf", "allOf"].includes(key) && Array.isArray(child)) {
      result[key] = child.map(schema => schemaDialect(schema, toOpenAI));
    } else result[key] = key === "items" ? schemaDialect(child, toOpenAI) : child;
  }
  if (toOpenAI && typeof result.$ref === "string" && Object.keys(result).length > 1) {
    const { $ref, ...rest } = result;
    return { ...rest, anyOf: [{ $ref }] };
  }
  return result;
}

function toolsDialect(tools: unknown, toOpenAI: boolean): unknown {
  return Array.isArray(tools) ? tools.map(tool => record(tool) && record(tool.function)
    ? { ...tool, function: { ...tool.function, parameters: schemaDialect(tool.function.parameters, toOpenAI) } }
    : tool) : tools;
}

export function assertOpenAIStrictToolModelInput(input: RecordValue): void {
  // The shared product schema is closed and all fields are required. Reuse
  // that validation after translating standard JSON Schema references back.
  const choice = input.tool_choice;
  const forcedName = record(choice) && choice.type === "function" && record(choice.function) ? choice.function.name : undefined;
  const forcedTool = typeof forcedName === "string"
    && Array.isArray(input.tools) && input.tools.some(tool => record(tool) && record(tool.function)
      && tool.function.name === forcedName);
  assertDeepSeekStrictToolModelInput({ ...input,
    tool_choice: forcedTool ? "required" : choice, tools: toolsDialect(input.tools, false) });
}

/** GPT-6 Luna Chat Completions function calling requires no reasoning.
 * https://developers.openai.com/api/docs/models/gpt-6-luna */
export function openAIRequestBody(model: string, input: RecordValue): RecordValue {
  const body = { ...input };
  const limit = body.max_completion_tokens ?? body.max_tokens;
  delete body.thinking;
  delete body.max_tokens;
  if (body.tools !== undefined) body.tools = toolsDialect(body.tools, true);
  return { ...body, model, reasoning_effort: "none", stream: false, store: false,
    ...(limit === undefined ? {} : { max_completion_tokens: limit }) };
}

export class OpenAIApiError extends Error {
  readonly code: string;
  constructor(readonly status: number, readonly retryAfter?: number, quotaExhausted = false) {
    super(`OpenAI request failed with status ${status}.`);
    this.name = "OpenAIApiError";
    this.code = quotaExhausted ? "quota_exhausted" : status === 429 ? "rate_limit"
      : status >= 500 ? "provider_unavailable" : "request_rejected";
  }
}

export function createOpenAIAuthoritativeBinding(options: {
  apiKey: string;
  fetcher?: typeof fetch;
}): AuthoritativeModelBinding {
  const apiKey = options.apiKey.trim(), fetcher = options.fetcher ?? fetch;
  return { async run(model, input, options) {
    if (!apiKey) throw new OpenAIApiError(401);
    const body = openAIRequestBody(model, input);
    if (Array.isArray(body.tools) && body.tools.some(tool => record(tool) && record(tool.function) && tool.function.strict === true)) {
      assertOpenAIStrictToolModelInput(body);
    }
    const response = await fetcher("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body), signal: options?.signal,
    });
    if (!response.ok) {
      // Read only the bounded error code; raw upstream details never escape.
      let quota = false;
      if (response.status === 429) {
        const reader = response.body?.getReader();
        if (reader) {
          let text = "";
          try {
            const decoder = new TextDecoder();
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              text += decoder.decode(value, { stream: true });
              if (text.length > 8_192) break;
            }
            if (text.length <= 8_192) quota = JSON.parse(text)?.error?.code === "insufficient_quota";
          } catch { /* Unknown 429 stays a transient rate limit. */ }
          finally { await reader.cancel().catch(() => {}); }
        }
      } else await response.body?.cancel();
      const header = response.headers.get("retry-after"), seconds = header === null ? NaN : Number(header);
      throw new OpenAIApiError(response.status, Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined, quota);
    }
    return await response.json();
  } };
}
