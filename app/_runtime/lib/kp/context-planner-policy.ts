import { stableStructuralHash } from "./causal-action-program";
import { KP_FORM_IDS, type KpFormId } from "./form-catalog";

export const CONTEXT_PLANNER_POLICY_VERSION =
  "kp-context-planner-policy-v1" as const;
export const CONTEXT_PLANNER_SCHEMA_VERSION =
  "kp-context-planner-suggestion-v1" as const;
export const CONTEXT_PLANNER_TOOL_NAME = "suggest_context_order" as const;
export const CONTEXT_PLANNER_ROLE_VALIDATION_SUITE_VERSION =
  "kp-context-planner-role-validation-v1" as const;

export const CONTEXT_PLANNER_DEFAULT_TIMEOUT_MS = 8_000;
export const CONTEXT_PLANNER_MAX_TIMEOUT_MS = 12_000;
export const CONTEXT_PLANNER_MAX_STRUCTURAL_REFS = 24;
export const CONTEXT_PLANNER_MAX_QUERY_TERMS = 12;

const QUERY_TERM_PATTERN = "^[^\\u0000-\\u001f\\u007f]{1,120}$";
const SECRET_CANARY_MARKER = "ZHUWEI_SECRET_CANARY_";

const BASE_OUTPUT_SCHEMA = deepFreeze({
  type: "object",
  additionalProperties: false,
  properties: {
    orderedFormIds: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      uniqueItems: true,
      items: { enum: KP_FORM_IDS },
    },
    queryTerms: {
      type: "array",
      maxItems: CONTEXT_PLANNER_MAX_QUERY_TERMS,
      uniqueItems: true,
      items: {
        type: "string",
        minLength: 1,
        maxLength: 120,
        pattern: QUERY_TERM_PATTERN,
      },
    },
  },
  required: ["orderedFormIds", "queryTerms"],
});

export const CONTEXT_PLANNER_OUTPUT_SCHEMA = BASE_OUTPUT_SCHEMA;
export const CONTEXT_PLANNER_SCHEMA_HASH = stableStructuralHash({
  schemaVersion: CONTEXT_PLANNER_SCHEMA_VERSION,
  schema: BASE_OUTPUT_SCHEMA,
});

const SYSTEM_POLICY = `你是烛帷的只读 Context Planner，不是 KP，也不是 Rules。
你只能做两件事：
1. 将服务端给出的 Form allowlist 完整重排；不得新增、删除或改写 Form，compound.v1 必须保留。
2. 建议用于检索版本化静态规则或模组语料的短查询词。

不得判断行动是否可行，不得给出 DC、危险、失败后果、NPC 台词、世界事实、敌人、实际区域目标、Audience、可见性、骰面、事件、状态或补丁。不得解释或改写玩家意图。不得把带有 ${SECRET_CANARY_MARKER} 标记的值复制到输出。必须且只能调用指定工具一次。`;

export const CONTEXT_PLANNER_POLICY_HASH = stableStructuralHash({
  policyVersion: CONTEXT_PLANNER_POLICY_VERSION,
  systemPolicy: SYSTEM_POLICY,
  schemaVersion: CONTEXT_PLANNER_SCHEMA_VERSION,
  schemaHash: CONTEXT_PLANNER_SCHEMA_HASH,
});

export type ContextPlannerPolicyInput = Readonly<{
  allowedFormIds: readonly KpFormId[];
  structuralRefs: readonly string[];
  baseQueryTerms: readonly string[];
}>;

export type ContextPlannerModelRequest = Readonly<{
  policyVersion: typeof CONTEXT_PLANNER_POLICY_VERSION;
  schemaVersion: typeof CONTEXT_PLANNER_SCHEMA_VERSION;
  modelInput: Readonly<{
    messages: readonly Readonly<{
      role: "system" | "user";
      content: string;
    }>[];
    tools: readonly Readonly<{
      type: "function";
      function: Readonly<{
        name: typeof CONTEXT_PLANNER_TOOL_NAME;
        description: string;
        parameters: Readonly<Record<string, unknown>>;
      }>;
    }>[];
    tool_choice: Readonly<{
      type: "function";
      function: Readonly<{ name: typeof CONTEXT_PLANNER_TOOL_NAME }>;
    }>;
    parallel_tool_calls: false;
    temperature: 0;
    max_completion_tokens: 400;
  }>;
}>;

export type ParsedContextPlannerSuggestion = Readonly<{
  orderedFormIds: readonly KpFormId[];
  queryTerms: readonly string[];
}>;

export type ContextPlannerProviderFailureClass =
  | "timeout"
  | "transient"
  | "permanent"
  | "unknown";

export class ContextPlannerPolicyError extends Error {
  readonly code:
    | "CONTEXT_PLANNER_OUTPUT_INVALID"
    | "CONTEXT_PLANNER_TIMEOUT";

  constructor(code: ContextPlannerPolicyError["code"]) {
    super(code);
    this.name = "ContextPlannerPolicyError";
    this.code = code;
  }
}

/**
 * Builds the complete model boundary. The provider receives only a Form
 * allowlist plus static-reference/query seeds; it receives no Room state,
 * player prose, KP context, target set, Audience, event or patch surface.
 */
export function contextPlannerModelRequest(
  input: ContextPlannerPolicyInput,
): ContextPlannerModelRequest {
  const allowedFormIds = Object.freeze([...input.allowedFormIds]);
  const structuralRefs = normalizedStrings(
    input.structuralRefs,
    CONTEXT_PLANNER_MAX_STRUCTURAL_REFS,
    160,
  );
  const baseQueryTerms = normalizedStrings(
    input.baseQueryTerms,
    CONTEXT_PLANNER_MAX_QUERY_TERMS,
    120,
  );
  const parameters = outputSchemaForAllowedForms(allowedFormIds);
  const staticInput = JSON.stringify({
    allowedFormIds,
    structuralRefs,
    baseQueryTerms,
  });
  return Object.freeze({
    policyVersion: CONTEXT_PLANNER_POLICY_VERSION,
    schemaVersion: CONTEXT_PLANNER_SCHEMA_VERSION,
    modelInput: Object.freeze({
      messages: Object.freeze([
        Object.freeze({ role: "system" as const, content: SYSTEM_POLICY }),
        Object.freeze({
          role: "user" as const,
          content: `只按协议处理这份静态检索输入：${staticInput}`,
        }),
      ]),
      tools: Object.freeze([Object.freeze({
        type: "function" as const,
        function: Object.freeze({
          name: CONTEXT_PLANNER_TOOL_NAME,
          description: "完整重排允许的 Form，并给出有限静态语料查询词。",
          parameters,
        }),
      })]),
      tool_choice: Object.freeze({
        type: "function" as const,
        function: Object.freeze({ name: CONTEXT_PLANNER_TOOL_NAME }),
      }),
      parallel_tool_calls: false as const,
      temperature: 0 as const,
      max_completion_tokens: 400 as const,
    }),
  });
}

/**
 * Accepts exactly one named tool call. Text/JSON fallbacks, provider wrapper
 * siblings and extra output fields are deliberately rejected.
 */
export function parseContextPlannerModelResponse(
  response: unknown,
  allowedFormIds: readonly KpFormId[],
  options: Readonly<{ forbiddenOutputFragments?: readonly string[] }> = {},
): ParsedContextPlannerSuggestion {
  try {
    const call = singleToolCall(response);
    const functionCall = plainRecord(call.function) ? call.function : call;
    if (functionCall.name !== CONTEXT_PLANNER_TOOL_NAME) invalidOutput();
    const value = typeof functionCall.arguments === "string"
      ? strictJsonObject(functionCall.arguments)
      : functionCall.arguments;
    if (!plainRecord(value)) invalidOutput();
    const keys = Object.keys(value).sort();
    if (keys.length !== 2 || keys[0] !== "orderedFormIds" || keys[1] !== "queryTerms") {
      invalidOutput();
    }
    if (!Array.isArray(value.orderedFormIds)
      || value.orderedFormIds.length !== allowedFormIds.length
      || new Set(value.orderedFormIds).size !== value.orderedFormIds.length
      || value.orderedFormIds.some((entry) =>
        typeof entry !== "string" || !allowedFormIds.includes(entry as KpFormId))) {
      invalidOutput();
    }
    if (!value.orderedFormIds.includes("compound.v1")) invalidOutput();
    if (!Array.isArray(value.queryTerms)
      || value.queryTerms.length > CONTEXT_PLANNER_MAX_QUERY_TERMS
      || value.queryTerms.some((entry) => !validQueryTerm(entry))) {
      invalidOutput();
    }
    const forbidden = [SECRET_CANARY_MARKER, ...(options.forbiddenOutputFragments ?? [])]
      .map((entry) => entry.normalize("NFKC"))
      .filter(Boolean);
    if (value.queryTerms.some((term) => forbidden.some((entry) => term.includes(entry)))) {
      invalidOutput();
    }
    return Object.freeze({
      orderedFormIds: Object.freeze([...(value.orderedFormIds as KpFormId[])]),
      queryTerms: Object.freeze(normalizedStrings(
        value.queryTerms as string[],
        CONTEXT_PLANNER_MAX_QUERY_TERMS,
        120,
      )),
    });
  } catch (error) {
    if (error instanceof ContextPlannerPolicyError) throw error;
    invalidOutput();
  }
}

export function classifyContextPlannerProviderError(
  error: unknown,
): ContextPlannerProviderFailureClass {
  if (error instanceof ContextPlannerPolicyError && error.code === "CONTEXT_PLANNER_TIMEOUT") {
    return "timeout";
  }
  const status = plainRecord(error) && typeof error.status === "number"
    ? error.status
    : undefined;
  if (status === 408 || status === 429 || (status !== undefined && status >= 500)) {
    return "transient";
  }
  if (status !== undefined && status >= 400) return "permanent";
  return "unknown";
}

export function contextPlannerOutputSchemaHashForAllowedForms(
  allowedFormIds: readonly KpFormId[],
): string {
  return stableStructuralHash(outputSchemaForAllowedForms(allowedFormIds));
}

function outputSchemaForAllowedForms(
  allowedFormIds: readonly KpFormId[],
): Readonly<Record<string, unknown>> {
  return deepFreeze({
    type: "object",
    additionalProperties: false,
    properties: {
      orderedFormIds: {
        type: "array",
        minItems: allowedFormIds.length,
        maxItems: allowedFormIds.length,
        uniqueItems: true,
        items: { enum: [...allowedFormIds] },
      },
      queryTerms: {
        type: "array",
        maxItems: CONTEXT_PLANNER_MAX_QUERY_TERMS,
        uniqueItems: true,
        items: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          pattern: QUERY_TERM_PATTERN,
        },
      },
    },
    required: ["orderedFormIds", "queryTerms"],
  });
}

function singleToolCall(response: unknown): Record<string, unknown> {
  if (!plainRecord(response)) invalidOutput();
  let calls: unknown;
  if (Array.isArray(response.tool_calls)) {
    calls = response.tool_calls;
  } else if (Array.isArray(response.choices) && response.choices.length === 1) {
    const choice = response.choices[0];
    if (!plainRecord(choice) || !plainRecord(choice.message)) invalidOutput();
    calls = choice.message.tool_calls;
  }
  if (!Array.isArray(calls) || calls.length !== 1 || !plainRecord(calls[0])) invalidOutput();
  return calls[0];
}

function strictJsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!plainRecord(parsed)) invalidOutput();
  return parsed;
}

function validQueryTerm(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.normalize("NFKC").trim();
  return normalized.length > 0
    && normalized.length <= 120
    && !/[\u0000-\u001f\u007f]/u.test(normalized);
}

function normalizedStrings(
  values: readonly string[],
  limit: number,
  maxLength: number,
): readonly string[] {
  return Object.freeze([...new Set(values.map((value) => value.normalize("NFKC").trim()))]
    .filter((value) => value.length > 0 && value.length <= maxLength)
    .slice(0, limit));
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidOutput(): never {
  throw new ContextPlannerPolicyError("CONTEXT_PLANNER_OUTPUT_INVALID");
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
    return Object.freeze(value);
  }
  if (plainRecord(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    return Object.freeze(value) as T;
  }
  return value;
}
