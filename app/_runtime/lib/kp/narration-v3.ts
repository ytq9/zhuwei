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
export const V5_BODY_ONLY_NARRATION_SCHEMA_VERSION =
  "authoritative-kp-body-only-narration-v2" as const;

type BodyOnlyNarrationOptions = Readonly<{
  /** Enabled only by the exact V5 workflow/profile binding. */
  socialResolution?: boolean;
}>;

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

只调用 submit_current_narration 一次，并且参数只能是 {"body":"非空正文"}。下一步提示若需要，写在 body 末句。不得输出 tts、decisionPrompt、引用、agency、Audience、Receipt 或任何元数据。正文必须是现代汉语跑团旁白，不得写出 SourceClaim、CanonicalFact、requester=、objective=、slotRef 或其他内部协议词。`;

const BODY_ONLY_NARRATION_GROUNDING_REPLACEMENT_SYSTEM = `你是烛帷 KP。上一份正文已在投递前因事实依据不足被丢弃；不要复述、引用或修补它。
这次只依据当前 Receipt、renderableClaims、pressure 与 opportunities，重新写一份完整回应。只有 renderableClaims 能支持本次结果、新的世界事实与 NPC 反应。如果其中有 checkResolved.result、contestResolved.result、privateInferenceFormed 或新获得的 knowledge，直接、具体地呈现该结果，不要重建场景或重新回答玩家原问题。

清楚呈现已有依据的结果，把决定权交还玩家。没有明确依据的感官、空间、姿态、目光、声音、气味、陈设、NPC 台词或判断一律省略；不得用固定伪成功句掩盖缺失内容。

只调用 submit_current_narration 一次，并且参数只能是 {"body":"非空正文"}。不得输出任何元数据。`;

const SOCIAL_SOURCE_ATTRIBUTION_POLICY = `
有来源的口头说法只证明某人说过这句话，不证明语义为真；必须用“某人说/自称/声称/认为”明确归因，绝不能改写成无主语的世界事实。角色推断也只代表对应角色当前的判断。社交结果只描述立场、注意力或权限内的配合，不得据此宣称门、物品、身份、地点、人物或线索已经产生或改变。正文里不得出现 SourceClaim、CanonicalFact 或其他内部类型名。`;

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

function recentDialogue(value: unknown, allowEnvelope: boolean): JsonRecord[] {
  const messages = Array.isArray(value)
    ? value
    : allowEnvelope
      && isRecord(value)
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
  options: BodyOnlyNarrationOptions = {},
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
  options: BodyOnlyNarrationOptions = {},
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
  options: BodyOnlyNarrationOptions = {},
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
      : recentDialogue(projection.experiencedTranscript, options.socialResolution === true),
  };
}

const PREMISE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  affiliation: "所属",
  arrivalPurpose: "来意",
  identityBackground: "身份背景",
  obligation: "义务",
  priorKnowledge: "既有认知",
  priorRelationship: "既有关系",
});

const PREMISE_SLOT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  requester: "委托人",
  inviter: "委托人",
  objective: "所求",
  destination: "去处",
  beneficiary: "受益人",
  knownSubject: "已知对象",
  counterparty: "对方",
  obligee: "受诺人",
  subject: "事由",
  organization: "组织",
  sponsor: "举荐人",
  origin: "来处",
  mentor: "师承",
  formerAssociate: "旧识",
});

function attributedSpeech(speaker: string, utterance: string): string {
  const safe = utterance
    .replace(/[「」『』\u201c\u201d"]/gu, "")
    .replace(/[\r\n]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 1_200);
  return `${speaker}说：「${safe}」`;
}

function deterministicPremiseLine(change: JsonRecord): string | undefined {
  if (change.kind !== "characterPremiseResolved" || typeof change.predicate !== "string") {
    return undefined;
  }
  const bindings = Array.isArray(change.bindings)
    ? change.bindings.filter(isRecord).flatMap((binding) => {
        const displayName = typeof binding.displayName === "string"
          ? binding.displayName.trim()
          : "";
        if (!displayName) return [];
        const slotRef = typeof binding.slotRef === "string" ? binding.slotRef.trim() : "";
        const slot = slotRef ? PREMISE_SLOT_LABELS[slotRef] : undefined;
        return [slot ? `${slot}是${displayName}` : displayName];
      })
    : [];
  const label = PREMISE_LABELS[change.predicate] ?? "来历";
  const resolution = change.resolution === "recalled" ? "确认" : "记下";
  return bindings.length === 0
    ? `你的${label}已经${resolution}。`
    : `你的${label}已经${resolution}：${bindings.join("，")}。`;
}

/** Facts in these changes have already been validated and committed by Rules.
 * V5 renders them verbatim or from closed fields instead of asking a model to
 * paraphrase success, identity, trust, permission, or private inference. */
function deterministicOutcomeLines(projection: JsonRecord): string[] {
  const delta = isRecord(projection.committedDelta) ? projection.committedDelta : {};
  const changes = Array.isArray(delta.changes) ? delta.changes.filter(isRecord) : [];
  const lines: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value !== "string") return;
    const normalized = value.trim();
    if (normalized && !lines.includes(normalized)) lines.push(normalized);
  };
  for (const change of changes) {
    if (["checkResolved", "contestResolved", "socialResolutionChanged"].includes(
      String(change.kind),
    )) {
      add(change.result);
      continue;
    }
    if (change.kind === "socialBehaviorObserved") {
      add(change.immediateBehavior);
      continue;
    }
    if (change.kind === "privateInferenceFormed") {
      if (typeof change.conclusion === "string" && change.conclusion.trim()) {
        add(`你形成了判断：${change.conclusion.trim()}。`);
      }
      continue;
    }
    add(deterministicPremiseLine(change));
  }
  return lines;
}

function takeSections(sections: readonly string[], maximum: number): string {
  if (maximum <= 0) return "";
  let body = "";
  for (const section of sections) {
    const normalized = section.trim();
    if (!normalized) continue;
    const separator = body ? "\n\n" : "";
    const remaining = maximum - body.length - separator.length;
    if (remaining <= 0) break;
    body += `${separator}${normalized.slice(0, remaining)}`;
  }
  return body.trim();
}

function deterministicV5Body(projection: JsonRecord): string | undefined {
  const outcomes = deterministicOutcomeLines(projection);
  const claims = deterministicSocialClaimLines(projection);
  if (outcomes.length === 0 && claims.length === 0) return undefined;
  const outcomeBody = takeSections(outcomes, 1_600);
  const claimBudget = Math.max(0, 1_600 - outcomeBody.length - (outcomeBody ? 2 : 0));
  const claimBody = takeSections(claims, claimBudget);
  return [claimBody, outcomeBody].filter(Boolean).join("\n\n").slice(0, 1_600);
}

function deterministicSocialClaimLines(projection: JsonRecord): string[] {
  const delta = isRecord(projection.committedDelta) ? projection.committedDelta : {};
  const viewerCharacterId = typeof delta.viewerCharacterId === "string"
    ? delta.viewerCharacterId
    : undefined;
  const reactionByClaim = new Map(changesFrom(delta).flatMap((change) =>
    change.kind === "socialBehaviorObserved"
      && typeof change.responseClaimRef === "string"
      && typeof change.responseReaction === "string"
      ? [[change.responseClaimRef, change.responseReaction]]
      : []));
  const seen = new Set<string>();
  return changesFrom(delta).flatMap((change) => {
    if (change.kind !== "spokenClaimHeard"
      || typeof change.claimRef !== "string"
      || seen.has(change.claimRef)
      || typeof change.speakerCharacterId !== "string"
      || typeof change.utterance !== "string"
      || !change.utterance.trim()) return [];
    seen.add(change.claimRef);
    if (change.speakerCharacterId === viewerCharacterId) return [];
    const speaker = typeof change.speakerName === "string" && change.speakerName.trim()
      ? change.speakerName.trim().slice(0, 80)
      : "对方";
    if (reactionByClaim.get(change.claimRef) === "silence") {
      return [`${speaker}没有作答。`];
    }
    return [attributedSpeech(speaker, change.utterance.trim())];
  });
}

function changesFrom(delta: JsonRecord): JsonRecord[] {
  return Array.isArray(delta.changes) ? delta.changes.filter(isRecord) : [];
}

/** Player-facing body compiled from already-committed typed outcomes. When this
 * returns a string, the model must not be asked to paraphrase the same result. */
export function typedOutcomeNarrationBody(projection: unknown): string | undefined {
  return isRecord(projection) ? deterministicV5Body(projection) : undefined;
}

export function bodyOnlyNarrationModelInput(
  request: KpNarrationRequest,
  options: BodyOnlyNarrationOptions = {},
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
  options: BodyOnlyNarrationOptions = {},
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
  options: BodyOnlyNarrationOptions = {},
): { body: string } {
  if (options.socialResolution === true && isRecord(projection)) {
    const deterministic = deterministicV5Body(projection);
    if (deterministic !== undefined) {
      // Validate only the frozen tool contract. The model prose is discarded;
      // no semantic claim from it can compete with the typed Rules result.
      validateBodyOnlyNarration(value, projection, { skipGrounding: true });
      return { body: deterministic };
    }
  }
  const result = validateBodyOnlyNarration(value, projection, {
    excludeActorActionFromGrounding: options.socialResolution === true,
  });
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
    body: takeSections([...attributedClaims, result.body], 1_600),
  };
}
