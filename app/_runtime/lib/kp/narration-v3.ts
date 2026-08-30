import {
  canonicalJson,
  isRecord,
  NarrationGroundingValidationError,
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
输入严格只有当前 Receipt、actorAction、renderableClaims、pressure、opportunities 与有限 recentDialogue；没有完整 WorldState、Story Bible、其他受众资料或完整历史。actorAction 只证明玩家刚才声明或做了什么，不证明其中的世界断言成立；renderableClaims 是唯一的新事实依据，recentDialogue 只维持措辞连续性。

清楚说明行动造成的可见变化，再呈现当前压力或机会，把决定权交还玩家。不得改判机械、补写新事实、泄露隐藏信息，或替玩家决定思想、情绪、台词与下一步。没有明确感官、空间、姿态、目光、声音、气味或陈设证据时省略；不得从坐标或机械标签扩写文学细节。故事已经真实收束时可以邀请尾声、续篇或结束，不得强行追加幕后黑手。

只调用 submit_current_narration 一次，并且参数只能是 {"body":"非空正文"}。下一步提示若需要，写在 body 末句。不得输出 tts、decisionPrompt、引用、agency、Audience、Receipt 或任何元数据。`;

const BODY_ONLY_NARRATION_GROUNDING_REPLACEMENT_SYSTEM = `你是烛帷 KP。上一份正文已在投递前因事实依据不足被丢弃；不要复述、引用或修补它。
这次只依据当前 Receipt、renderableClaims、pressure 与 opportunities，重新写一份完整回应。只有 renderableClaims 能支持本次结果、新的世界事实与 NPC 反应。如果其中有 checkResolved.result、contestResolved.result、privateInferenceFormed 或新获得的 knowledge，直接、具体地呈现该结果，不要重建场景或重新回答玩家原问题。

清楚呈现已有依据的结果，把决定权交还玩家。没有明确依据的感官、空间、姿态、目光、声音、气味、陈设、NPC 台词或判断一律省略；不得用固定伪成功句掩盖缺失内容。

只调用 submit_current_narration 一次，并且参数只能是 {"body":"非空正文"}。不得输出任何元数据。`;

const SOCIAL_SOURCE_ATTRIBUTION_POLICY = `
SourceClaim 只证明某个 speaker 说过某句话，不证明其语义为真；必须用“某人说/自称/声称/认为”等明确归因呈现，绝不能改写成无主语的世界事实。CharacterInference 也只代表对应角色当前的判断。socialResolutionChanged 的 result 只描述立场、注意力或权限内的配合，不得据此宣称门、物品、身份、地点、人物或线索已经产生或改变。`;

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
  const messages = Array.isArray(value)
    ? value
    : isRecord(value)
      && value.schema === "zhuwei.experienced-transcript/v1"
      && Array.isArray(value.messages)
      ? value.messages
      : [];
  return messages
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

function changedArrayEntries(
  change: JsonRecord,
  identityKey: string,
  kind: string,
): JsonRecord[] | undefined {
  if (!Array.isArray(change.before) || !Array.isArray(change.after)) return undefined;
  const before = new Map(change.before.filter(isRecord).flatMap((entry) =>
    typeof entry[identityKey] === "string" ? [[entry[identityKey], canonicalJson(entry)]] : []));
  const changed = change.after.filter(isRecord).filter((entry) =>
    typeof entry[identityKey] === "string"
    && before.get(entry[identityKey]) !== canonicalJson(entry)).slice(0, 16);
  return changed.length === 0 ? [] : [{ kind, entries: structuredClone(changed) }];
}

function changedSocialThreadEntries(change: JsonRecord): JsonRecord[] | undefined {
  if (!Array.isArray(change.before) || !Array.isArray(change.after)) return undefined;
  const before = new Map(change.before.filter(isRecord).flatMap((entry) =>
    typeof entry.threadRef === "string" ? [[entry.threadRef, canonicalJson(entry)]] : []));
  const entries = change.after.filter(isRecord).filter((entry) =>
    typeof entry.threadRef === "string"
    && before.get(entry.threadRef) !== canonicalJson(entry)).slice(0, 16).map((entry) => {
      const safe: JsonRecord = {};
      for (const key of [
        "threadRef", "actorCharacterId", "npcCharacterId", "claimRef", "responseClaimRef",
        "claimTruthStatus", "resolution", "status", "degree", "marginDegree",
        "maximumInfluenceDegree", "immediateBehavior", "outcome",
      ]) {
        if (entry[key] !== undefined) safe[key] = structuredClone(entry[key]);
      }
      return safe;
    });
  return entries.length === 0 ? [] : [{ kind: "conversationThreadsChanged", entries }];
}

function currentProjectionIsSocial(projection: JsonRecord): boolean {
  const delta = isRecord(projection.committedDelta) ? projection.committedDelta : {};
  const changes = Array.isArray(delta.changes) ? delta.changes.filter(isRecord) : [];
  return changes.some((change) =>
    change.kind === "spokenClaimHeard"
    || change.kind === "socialBehaviorObserved"
    || change.kind === "socialResolutionChanged");
}

function renderableClaims(
  value: unknown,
  options: Readonly<{ socialResolution?: boolean }> = {},
): JsonRecord[] {
  const changes = Array.isArray(value) ? value.filter(isRecord).slice(0, 48) : [];
  return changes.flatMap((change) => {
    if (options.socialResolution === true && change.kind === "spokenClaimHeard") return [];
    if (options.socialResolution === true && change.kind === "projectionFieldChanged") {
      const narrowed = change.field === "sourceClaims"
        ? []
        : change.field === "conversationThreads"
          ? changedSocialThreadEntries(change)
          : change.field === "visibleFacts"
            ? changedArrayEntries(change, "id", "visibleFactsChanged")
            : undefined;
      if (narrowed !== undefined) return narrowed;
    }
    if (
      change.kind !== "projectionFieldChanged"
      || change.field !== "knowledge"
      || !Array.isArray(change.before)
      || !Array.isArray(change.after)
    ) return [structuredClone(change)];
    const before = new Set(change.before.map((entry) => canonicalJson(entry)));
    const acquired = change.after
      .filter((entry) => !before.has(canonicalJson(entry)))
      .filter((entry) => options.socialResolution !== true
        || !isRecord(entry)
        || (entry.objectKind !== "sourceClaim"
          && !(typeof entry.knowledgeRef === "string"
            && entry.knowledgeRef.startsWith("claim:social"))))
      .slice(0, 16);
    return acquired.length === 0
      ? []
      : [{ kind: "knowledgeAcquired", knowledge: structuredClone(acquired) }];
  });
}

function safeActorAction(
  projection: JsonRecord,
  delta: JsonRecord,
  rootActionId: string,
  options: Readonly<{ socialResolution?: boolean }> = {},
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
    options.socialResolution !== true
    &&
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
export function bodyOnlyNarrationContext(
  request: KpNarrationRequest,
  options: Readonly<{ socialResolution?: boolean }> = {},
): JsonRecord {
  const projection = isRecord(request.projection) ? request.projection : {};
  const delta = isRecord(projection.committedDelta) ? projection.committedDelta : {};
  const narration = isRecord(projection.narration) ? projection.narration : {};
  const currentSocialAction = options.socialResolution === true
    && currentProjectionIsSocial(projection);
  const currentOptions = { socialResolution: currentSocialAction };
  return {
    receipt: safeReceipt(request.receipt),
    actorAction: safeActorAction(projection, delta, request.rootActionId, currentOptions),
    renderableClaims: renderableClaims(delta.changes, currentOptions),
    pressure: typeof narration.pressure === "string"
      ? narration.pressure.slice(0, 480)
      : "",
    opportunities: stringArray(narration.opportunities, 8),
    recentDialogue: currentSocialAction
      ? []
      : recentDialogue(projection.experiencedTranscript),
  };
}

function deterministicSocialClaimLines(projection: JsonRecord): string[] {
  const delta = isRecord(projection.committedDelta) ? projection.committedDelta : {};
  const changes = Array.isArray(delta.changes) ? delta.changes.filter(isRecord) : [];
  const actorCharacterId = typeof delta.actorCharacterId === "string"
    ? delta.actorCharacterId
    : undefined;
  const reactionByClaim = new Map(changes.flatMap((change) =>
    change.kind === "socialBehaviorObserved"
      && typeof change.responseClaimRef === "string"
      && typeof change.responseReaction === "string"
      ? [[change.responseClaimRef, change.responseReaction]]
      : []));
  const seen = new Set<string>();
  return changes.flatMap((change) => {
    if (change.kind !== "spokenClaimHeard"
      || typeof change.claimRef !== "string"
      || seen.has(change.claimRef)
      || typeof change.speakerCharacterId !== "string"
      || typeof change.utterance !== "string"
      || !change.utterance.trim()) return [];
    seen.add(change.claimRef);
    const speaker = change.speakerCharacterId === actorCharacterId
      ? "你"
      : typeof change.speakerName === "string" && change.speakerName.trim()
        ? change.speakerName.trim().slice(0, 80)
        : "对方";
    if (reactionByClaim.get(change.claimRef) === "silence") {
      return [`${speaker}没有作答。`];
    }
    const utterance = change.utterance.trim().replace(/[\r\n]+/gu, " ");
    return [`${speaker}说：“${utterance}”`];
  });
}

export function bodyOnlyNarrationModelInput(
  request: KpNarrationRequest,
  options: Readonly<{ socialResolution?: boolean }> = {},
): Record<string, unknown> {
  return {
    messages: [
      {
        role: "system",
        content: options.socialResolution === true
          ? `${BODY_ONLY_NARRATION_SYSTEM}${SOCIAL_SOURCE_ATTRIBUTION_POLICY}`
          : BODY_ONLY_NARRATION_SYSTEM,
      },
      { role: "user", content: canonicalJson(bodyOnlyNarrationContext(request, options)) },
    ],
    tools: [BODY_ONLY_NARRATION_TOOL],
    tool_choice: "required",
    parallel_tool_calls: false,
    temperature: 0,
    max_completion_tokens: 800,
  };
}

/** One bounded replacement after a grounding-only rejection. Historical
 * dialogue is intentionally absent because it controls voice, not facts. */
export function bodyOnlyNarrationGroundingReplacementModelInput(
  request: KpNarrationRequest,
  options: Readonly<{ socialResolution?: boolean }> = {},
): Record<string, unknown> {
  const {
    actorAction: _actorAction,
    recentDialogue: _recentDialogue,
    ...groundedContext
  } = bodyOnlyNarrationContext(request, options);
  return {
    messages: [
      {
        role: "system",
        content: options.socialResolution === true
          ? `${BODY_ONLY_NARRATION_GROUNDING_REPLACEMENT_SYSTEM}${SOCIAL_SOURCE_ATTRIBUTION_POLICY}`
          : BODY_ONLY_NARRATION_GROUNDING_REPLACEMENT_SYSTEM,
      },
      { role: "user", content: canonicalJson(groundedContext) },
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
  options: Readonly<{ socialResolution?: boolean }> = {},
): { body: string } {
  const result = validateBodyOnlyNarration(value, projection);
  if (options.socialResolution !== true
    || !isRecord(projection)
    || !currentProjectionIsSocial(projection)) return result;
  const delta = isRecord(projection.committedDelta) ? projection.committedDelta : {};
  const changes = Array.isArray(delta.changes) ? delta.changes.filter(isRecord) : [];
  for (const change of changes) {
    if (change.kind !== "spokenClaimHeard"
      || typeof change.utterance !== "string") continue;
    const utterance = change.utterance.trim();
    // Raw SourceClaim content is deliberately absent from the model input and
    // rendered below by the server. If the free prose nevertheless reproduces
    // it, reject instead of allowing an unbound paraphrase to compete with the
    // deterministic attribution.
    if (utterance.length >= 3 && result.body.includes(utterance)) {
      throw new NarrationGroundingValidationError();
    }
  }
  const attributedClaims = deterministicSocialClaimLines(projection);
  return {
    body: [...attributedClaims, result.body].filter((entry) => entry.trim()).join("\n\n"),
  };
}
