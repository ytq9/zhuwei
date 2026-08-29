import {
  canonicalJson,
  isRecord,
  validateBodyOnlyNarration,
} from "./authoritative-helpers";
import { NARRATION_TOOL_NAME } from "./authoritative-policy";
import type { KpNarrationRequest } from "./authoritative-types";

type JsonRecord = Record<string, unknown>;

export const BODY_ONLY_NARRATION_SCHEMA_VERSION =
  "authoritative-kp-body-only-narration-v1" as const;

export const BODY_ONLY_NARRATION_TOOL = Object.freeze({
  type: "function",
  function: {
    name: NARRATION_TOOL_NAME,
    description: "Write one grounded current response for one frozen viewer.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        body: { type: "string", minLength: 1, maxLength: 1_600, pattern: "\\S" },
      },
      required: ["body"],
    },
  },
});

const BODY_ONLY_NARRATION_SYSTEM = `你是烛帷 KP。你只叙述已经提交、且当前冻结观察者能够感知的结果。
输入严格只有当前 Receipt、actorAction、renderableClaims、pressure、opportunities 与有限 recentDialogue；没有完整 WorldState、Story Bible、其他受众资料或完整历史。renderableClaims 是唯一的新事实依据，recentDialogue 只维持措辞连续性。

清楚说明行动造成的可见变化，再呈现当前压力或机会，把决定权交还玩家。不得改判机械、补写新事实、泄露隐藏信息，或替玩家决定思想、情绪、台词与下一步。没有明确感官、空间、姿态、目光、声音、气味或陈设证据时省略；不得从坐标或机械标签扩写文学细节。故事已经真实收束时可以邀请尾声、续篇或结束，不得强行追加幕后黑手。

只调用 submit_current_narration 一次，并且参数只能是 {"body":"非空正文"}。下一步提示若需要，写在 body 末句。不得输出 tts、decisionPrompt、引用、agency、Audience、Receipt 或任何元数据。`;

function safeReceipt(value: unknown): JsonRecord {
  if (!isRecord(value)) return {};
  const safe: JsonRecord = {};
  for (const key of [
    "receiptId",
    "rootActionId",
    "status",
    "runtimeEpochId",
    "activeBranchId",
  ]) {
    if (typeof value[key] === "string" && value[key].length > 0) safe[key] = value[key];
  }
  if (value.eventRange === null) safe.eventRange = null;
  else if (isRecord(value.eventRange)) {
    const range: JsonRecord = {};
    for (const key of ["first", "last"]) {
      if (typeof value.eventRange[key] === "string") range[key] = value.eventRange[key];
    }
    for (const key of ["from", "to"]) {
      if (Number.isSafeInteger(value.eventRange[key])) range[key] = value.eventRange[key];
    }
    if (Object.keys(range).length > 0) safe.eventRange = range;
  }
  if (typeof value.meaningfulFailure === "boolean") {
    safe.meaningfulFailure = value.meaningfulFailure;
  }
  return safe;
}

function recentDialogue(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .flatMap((message) => {
      const kind = message.kind;
      const body = message.body;
      if ((kind !== "player" && kind !== "kp") || typeof body !== "string" || !body.trim()) {
        return [];
      }
      return [{
        kind,
        body: body.slice(0, 800),
        ...(typeof message.speakerName === "string"
          ? { speakerName: message.speakerName.slice(0, 80) }
          : {}),
      }];
    })
    .slice(-8);
}

function stringArray(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
        .slice(0, limit)
    : [];
}

function safeActorAction(
  projection: JsonRecord,
  delta: JsonRecord,
  rootActionId: string,
): JsonRecord {
  const frozen = isRecord(projection.actorAction) ? projection.actorAction : {};
  const actorCharacterId = typeof delta.actorCharacterId === "string"
    ? delta.actorCharacterId
    : undefined;
  const base: JsonRecord = {
    ...(actorCharacterId === undefined ? {} : { actorCharacterId }),
    rootActionId,
  };
  if (
    frozen.kind === "actorDisplay"
    && frozen.actorCharacterId === actorCharacterId
    && typeof frozen.displayBody === "string"
    && frozen.displayBody.trim()
  ) {
    return {
      ...base,
      kind: "actorDisplay",
      displayBody: frozen.displayBody.slice(0, 1_200),
    };
  }
  return {
    ...base,
    kind: "observerClaims",
    observableActionKinds: stringArray(frozen.observableActionKinds, 24),
  };
}

/** Reduces an observer-safe Room projection to the only fields the narration
 * model is allowed to see. */
export function bodyOnlyNarrationContext(request: KpNarrationRequest): JsonRecord {
  const projection = isRecord(request.projection) ? request.projection : {};
  const delta = isRecord(projection.committedDelta) ? projection.committedDelta : {};
  const changes = Array.isArray(delta.changes)
    ? delta.changes.filter(isRecord).slice(0, 48)
    : [];
  const narration = isRecord(projection.narration) ? projection.narration : {};
  return {
    receipt: safeReceipt(request.receipt),
    actorAction: safeActorAction(projection, delta, request.rootActionId),
    renderableClaims: structuredClone(changes),
    pressure: typeof narration.pressure === "string"
      ? narration.pressure.slice(0, 480)
      : "",
    opportunities: stringArray(narration.opportunities, 8),
    recentDialogue: recentDialogue(projection.experiencedTranscript),
  };
}

export function bodyOnlyNarrationModelInput(
  request: KpNarrationRequest,
): Record<string, unknown> {
  return {
    messages: [
      { role: "system", content: BODY_ONLY_NARRATION_SYSTEM },
      { role: "user", content: canonicalJson(bodyOnlyNarrationContext(request)) },
    ],
    tools: [BODY_ONLY_NARRATION_TOOL],
    tool_choice: "required",
    parallel_tool_calls: false,
    temperature: 0,
    max_completion_tokens: 800,
  };
}

export function validateBodyOnlyNarrationOutput(
  value: unknown,
  projection: unknown,
): { body: string } {
  return validateBodyOnlyNarration(value, projection);
}
