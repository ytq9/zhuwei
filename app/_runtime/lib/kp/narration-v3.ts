import {
  canonicalJson,
  isRecord,
  NarrationGroundingValidationError,
  validateBodyOnlyNarration,
} from "./authoritative-helpers";
import { NARRATION_TOOL_NAME } from "./authoritative-policy";
import type {
  FrozenClaimsNarrationRequest,
  ObserverProjectionNarrationRequest,
} from "./authoritative-types";

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

只调用 submit_current_narration 一次，并且参数只能是 {"body":"非空正文"}。下一步提示若需要，写在 body 末句。不得输出 tts、decisionPrompt、引用、agency、Audience、Receipt 或任何元数据。`;

const BODY_ONLY_NARRATION_GROUNDING_REPLACEMENT_SYSTEM = `你是烛帷 KP。上一份正文已在投递前因事实依据不足被丢弃；不要复述、引用或修补它。
这次只依据当前 Receipt、renderableClaims、pressure 与 opportunities，重新写一份完整回应。只有 renderableClaims 能支持本次结果、新的世界事实与 NPC 反应。如果其中有 checkResolved.result、contestResolved.result、privateInferenceFormed 或新获得的 knowledge，直接、具体地呈现该结果，不要重建场景或重新回答玩家原问题。

清楚呈现已有依据的结果，把决定权交还玩家。没有明确依据的感官、空间、姿态、目光、声音、气味、陈设、NPC 台词或判断一律省略；不得用固定伪成功句掩盖缺失内容。

只调用 submit_current_narration 一次，并且参数只能是 {"body":"非空正文"}。不得输出任何元数据。`;

const FROZEN_CLAIMS_NARRATION_SYSTEM = `你是烛帷 KP。你只叙述当前 Receipt 已提交且该观察者可见的结果。
输入严格只有 Receipt 与 renderableClaims；renderableClaims 是本次所有新事实、机械结果、感官证据、压力与机会的唯一依据。不得补写其中没有的动作、结果、世界事实、NPC 反应、感官或空间细节，也不得替玩家决定思想、情绪、台词或下一步。

把相关 Claims 整合成一段自然、具体且不重复的中文回应，然后把决定权交还玩家。事实句应保留 Claim 中文 payload 的原词或近似原词，不要用文学性同义改写。Claims 已经按观察者投影，不要解释协议、哈希、引用或内部字段。sourceClaim 必须写成“对方声称……”一类有来源的陈述；characterInference 必须写成“你判断……”或“该角色推测……”一类有角色归属的判断；都不得改写成无来源的世界事实。压力与机会只能来自相应 kind 的 Claim。只有 actionCommitted 而没有其他结果时，只确认其可观察行动，不宣称目标已经实现。末句若交还决定权，使用“你接下来怎么做？”这类单纯提问。

只调用 submit_current_narration 一次，并且参数只能是 {"body":"非空正文"}。不得输出任何元数据。`;

const FROZEN_CLAIMS_GROUNDING_REPLACEMENT_SYSTEM = `你是烛帷 KP。上一份正文因超出冻结 Claims 的事实依据而被丢弃；不要复述或修补它。
只根据当前 Receipt 与 renderableClaims 重写完整回应。每个事实分句直接复用一个 Claim 中文 payload 的原词；不得做文学性同义改写，也不得加入 Claims 未明示的动作、结果、世界事实、NPC 反应、感官、空间、思想、情绪、台词或下一步。sourceClaim 使用“对方声称……”格式，characterInference 使用“你判断……”或“该角色推测……”格式。末句如需交还决定权，只写“你接下来怎么做？”。

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
  request: ObserverProjectionNarrationRequest,
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

function safeInlineText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
  return normalized || undefined;
}

function naturalList(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join("、")}和${values.at(-1)}`;
}

function premiseBindings(change: JsonRecord): ReadonlyMap<string, string[]> {
  const bindings = new Map<string, string[]>();
  if (!Array.isArray(change.bindings)) return bindings;
  for (const binding of change.bindings) {
    if (!isRecord(binding) || typeof binding.slotRef !== "string") continue;
    const displayName = safeInlineText(binding.displayName, 120);
    if (displayName === undefined) continue;
    const current = bindings.get(binding.slotRef) ?? [];
    if (!current.includes(displayName)) current.push(displayName);
    bindings.set(binding.slotRef, current);
  }
  return bindings;
}

function deterministicPremiseLine(change: JsonRecord): string | undefined {
  if (change.kind !== "characterPremiseResolved" || typeof change.predicate !== "string") {
    return undefined;
  }
  const bindings = premiseBindings(change);
  const names = (slotRef: string): string => naturalList(bindings.get(slotRef) ?? []);
  const sentence = (...clauses: Array<string | undefined>): string | undefined => {
    const present = clauses.filter((clause): clause is string => clause !== undefined);
    return present.length === 0 ? undefined : `${present.join("，")}。`;
  };
  switch (change.predicate) {
    case "arrivalPurpose": {
      const requester = names("requester");
      const objective = names("objective");
      const destination = names("destination");
      const beneficiary = names("beneficiary");
      return sentence(
        requester ? `你受${requester}所托` : undefined,
        objective ? `此行与${objective}有关` : undefined,
        destination ? `目的地是${destination}` : undefined,
        beneficiary ? `也是为了${beneficiary}` : undefined,
      );
    }
    case "priorKnowledge": {
      const knownSubject = names("knownSubject");
      return knownSubject ? `你此前就知道${knownSubject}。` : undefined;
    }
    case "priorRelationship": {
      const counterparty = names("counterparty");
      return counterparty ? `你过去与${counterparty}有过来往。` : undefined;
    }
    case "obligation": {
      const obligee = names("obligee");
      const subject = names("subject");
      if (obligee && subject) return `你对${obligee}负有一项与${subject}有关的义务。`;
      if (obligee) return `你对${obligee}负有义务。`;
      return subject ? `你负有一项与${subject}有关的义务。` : undefined;
    }
    case "affiliation": {
      const organization = names("organization");
      const sponsor = names("sponsor");
      return sentence(
        organization ? `你隶属于${organization}` : undefined,
        sponsor ? `由${sponsor}引荐` : undefined,
      );
    }
    case "identityBackground": {
      const origin = names("origin");
      const mentor = names("mentor");
      const formerAssociate = names("formerAssociate");
      return sentence(
        origin ? `你来自${origin}` : undefined,
        mentor ? `曾受${mentor}指点` : undefined,
        formerAssociate ? `过去与${formerAssociate}共事` : undefined,
      );
    }
    default:
      return undefined;
  }
}

/** Facts in these changes have already been validated and committed by Rules.
 * V5 renders only their closed public fields instead of asking a model to
 * reinterpret success, identity, trust, permission, or private inference. */
function deterministicOutcomeLines(projection: JsonRecord): string[] {
  const delta = isRecord(projection.committedDelta) ? projection.committedDelta : {};
  const changes = Array.isArray(delta.changes) ? delta.changes.filter(isRecord) : [];
  const lines: string[] = [];
  const add = (value: unknown): void => {
    const normalized = safeInlineText(value, 1_200);
    if (normalized && !lines.includes(normalized)) lines.push(normalized);
  };
  for (const change of changes) {
    if (["checkResolved", "contestResolved"].includes(String(change.kind))) {
      add(change.result);
      continue;
    }
    if (change.kind === "socialResolutionChanged") {
      if (change.resolution === "reframed") {
        add("你改换了说法，之前那次检定已经取消。");
      } else if (change.resolution !== "direct") {
        add(change.result);
      }
      continue;
    }
    if (change.kind === "socialBehaviorObserved") {
      if (change.responseReaction === "silence" && change.responseClaimRef === null) {
        add("对方没有回答。");
      } else if (typeof change.responseClaimRef !== "string") {
        add(change.immediateBehavior);
      }
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
  const changes = Array.isArray(delta.changes) ? delta.changes.filter(isRecord) : [];
  const actorCharacterId = typeof delta.actorCharacterId === "string"
    ? delta.actorCharacterId
    : undefined;
  const viewerCharacterId = typeof delta.viewerCharacterId === "string"
    ? delta.viewerCharacterId
    : undefined;
  const responseClaimRefs = new Set(changes.flatMap((change) =>
    (change.kind === "socialBehaviorObserved" || change.kind === "socialResolutionChanged")
      && typeof change.responseClaimRef === "string"
      ? [change.responseClaimRef]
      : []));
  const seen = new Set<string>();
  return changes.flatMap((change) => {
    if (change.kind !== "spokenClaimHeard"
      || typeof change.claimRef !== "string"
      || !responseClaimRefs.has(change.claimRef)
      || seen.has(change.claimRef)
      || typeof change.speakerCharacterId !== "string"
      || change.speakerCharacterId === actorCharacterId) return [];
    const utterance = safeInlineText(change.utterance, 1_200);
    if (utterance === undefined) return [];
    seen.add(change.claimRef);
    const safeSpeakerName = safeInlineText(change.speakerName, 80)
      ?.replace(/[:："“”]+/gu, "")
      .trim();
    const speaker = change.speakerCharacterId === viewerCharacterId
      ? "你"
      : safeSpeakerName
        ? safeSpeakerName
        : "对方";
    // The server owns both delimiters and the paragraph boundary. Embedded
    // delimiters are reduced to ordinary quotes so one claim cannot forge a
    // second attributed speaker line.
    return [`${speaker}说：“${utterance.replace(/[“”]/gu, "\"")}”`];
  });
}

export function bodyOnlyNarrationModelInput(
  request: ObserverProjectionNarrationRequest,
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
  request: ObserverProjectionNarrationRequest,
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

/** Reduces the vNext request to its frozen Viewer facts. Unlike the legacy
 * observer path there is no ambient projection or transcript to consult. */
export function frozenClaimsNarrationContext(
  request: FrozenClaimsNarrationRequest,
): JsonRecord {
  return {
    receipt: safeReceipt(request.receipt),
    viewerKey: request.viewerKey,
    renderableClaims: structuredClone(request.renderableClaims) as unknown as JsonRecord,
  };
}

export function frozenClaimsNarrationModelInput(
  request: FrozenClaimsNarrationRequest,
): Record<string, unknown> {
  return {
    messages: [
      { role: "system", content: FROZEN_CLAIMS_NARRATION_SYSTEM },
      { role: "user", content: canonicalJson(frozenClaimsNarrationContext(request)) },
    ],
    tools: [BODY_ONLY_NARRATION_TOOL],
    tool_choice: "required",
    parallel_tool_calls: false,
    temperature: 0,
    max_completion_tokens: 800,
  };
}

export function frozenClaimsNarrationGroundingReplacementModelInput(
  request: FrozenClaimsNarrationRequest,
): Record<string, unknown> {
  return {
    messages: [
      { role: "system", content: FROZEN_CLAIMS_GROUNDING_REPLACEMENT_SYSTEM },
      { role: "user", content: canonicalJson(frozenClaimsNarrationContext(request)) },
    ],
    tools: [BODY_ONLY_NARRATION_TOOL],
    tool_choice: "required",
    parallel_tool_calls: false,
    temperature: 0,
    max_completion_tokens: 800,
  };
}

export function validateFrozenClaimsNarrationOutput(
  value: unknown,
  request: FrozenClaimsNarrationRequest,
): { body: string } {
  const result = validateBodyOnlyNarration(value, {
    renderableClaims: request.renderableClaims as unknown as JsonRecord,
  });
  assertFrozenClaimsNarrationGrounded(result.body, request);
  return result;
}

type FrozenClaimTextEvidence = Readonly<{
  claimRef: string;
  kind: string;
  texts: readonly string[];
}>;

const CLAIM_SENTENCE_BOUNDARY = /[。！？!?；;\n]+/u;
const CLAIM_COMPOUND_BOUNDARY = /(?:[，,、]+|并且|而且|与此同时|随后|然后|但是|不过|却|并|且|同时|又|从而|所以|因此|因而|导致|迫使|令|让)/u;
const INTERNAL_REFERENCE_ASSERTION = /(?:sha256|claim|event|receipt|root|character|npc|feature|scene|definition|relation|visibility|prospective|item-entry|objective|story):/iu;
const PLAYER_AGENCY_ASSERTION = /你(?:已经|正在|随后|然后|立刻|马上|最终|必须|不得|应该|将要|会)?(?:感到|觉得|认为|相信|怀疑|意识到|想起|决定|选择|打算|准备|想要|愿意|害怕|恐惧|愤怒|悲伤|高兴|说|回答|承诺|发誓|转身|冲|跑|逃|攻击|挥动|进入|离开|追赶|躲藏)/u;
const SOURCE_ATTRIBUTION = /^(?:(?:据(?:对方|该人物|此人|该消息来源|消息来源|该文献|文献|该记录|记录|传闻)(?:所说|所称|所述|记载))|(?:对方|有人|消息来源|文献|记录|传闻|该人物|此人)(?:明确)?(?:说|声称|表示|写道|记载|提到|宣称|自称|断言|认为))/u;
const INFERENCE_ATTRIBUTION = /^(?:你|该角色|此人|有人)(?:判断|推测|认为|觉得|怀疑|估计|得出|意识到)/u;

function frozenClaimTextEvidence(claim: unknown): FrozenClaimTextEvidence | undefined {
  if (!isRecord(claim) || typeof claim.kind !== "string") return undefined;
  const texts: unknown[] = [];
  switch (claim.kind) {
    case "mechanicalOutcome": {
      texts.push(claim.summary);
      const check = isRecord(claim.check) ? claim.check : undefined;
      if (check !== undefined) {
        if (check.kind === "attack") {
          texts.push(check.result === "success" ? "攻击命中" : "攻击未命中");
        } else {
          texts.push(check.result === "success" ? "检定成功" : "检定失败");
        }
        if (typeof check.total === "number") texts.push(`检定总值为 ${check.total}`);
        if (typeof check.dc === "number") texts.push(`难度为 ${check.dc}`);
      }
      break;
    }
    case "definitionRevised":
    case "objectiveContinuity":
    case "storyContinuity":
    case "actionCommitted":
      texts.push(claim.summary);
      break;
    case "abilityEffectApplied": {
      if (typeof claim.abilityName === "string") texts.push(`能力 ${claim.abilityName}`);
      if (isRecord(claim.effect)) {
        texts.push(claim.effect.summary);
        if (typeof claim.abilityName === "string" && typeof claim.effect.summary === "string") {
          texts.push(`${claim.abilityName}：${claim.effect.summary}`);
        }
        if (typeof claim.effect.bonusDice === "string") {
          texts.push(`额外骰为 ${claim.effect.bonusDice}`);
        }
        if (typeof claim.effect.duration === "string") {
          texts.push(`持续时间为 ${claim.effect.duration}`);
        }
        if (claim.effect.concentration === true) texts.push("需要专注");
      }
      break;
    }
    case "sensoryEvidence":
      texts.push(claim.evidence);
      break;
    case "sourceClaim":
      texts.push(claim.statement);
      break;
    case "characterInference":
      texts.push(claim.inference);
      break;
    case "sceneFeature":
      texts.push(claim.description, claim.state, claim.interactionHint);
      break;
    case "relationChanged":
      texts.push(claim.description);
      break;
    case "inventoryOutcome":
      texts.push(claim.summary);
      for (const [field, label] of [
        ["quantity", "数量"],
        ["charges", "充能次数"],
        ["durability", "耐久"],
      ] as const) {
        const transition = isRecord(claim[field]) ? claim[field] : undefined;
        if (typeof transition?.before === "number" && typeof transition.after === "number") {
          texts.push(`${label}由 ${transition.before} 变为 ${transition.after}`);
        }
      }
      if (typeof claim.state === "string") texts.push(`物品状态为 ${claim.state}`);
      break;
    case "pressure":
      texts.push(claim.description);
      break;
    case "opportunity":
      texts.push(claim.description, claim.actionHint);
      break;
    default:
      return undefined;
  }
  const normalizedTexts = [...new Set(texts.filter((text): text is string =>
    typeof text === "string" && normalizeGroundingText(text).length >= 1))];
  return normalizedTexts.length === 0 || typeof claim.claimRef !== "string"
    ? undefined
    : { claimRef: claim.claimRef, kind: claim.kind, texts: normalizedTexts };
}

function normalizeGroundingText(value: string): string {
  return (value.normalize("NFKC").toLowerCase().match(/\p{Script=Han}+|[a-z0-9]+/gu) ?? [])
    .join("");
}

function narrationFactCore(value: string): string {
  let text = value.trim().replace(/^[“”"'「」『』（）()\s]+|[“”"'「」『』（）()\s]+$/gu, "");
  text = text.replace(/^(?:据(?:对方|该人物|此人|该消息来源|消息来源|该文献|文献|该记录|记录|传闻)(?:所说|所称|所述|记载)|(?:对方|有人|消息来源|文献|记录|传闻|该人物|此人)(?:明确)?(?:说|声称|表示|写道|记载|提到|宣称|自称|断言|认为))[：:，,\s]*/u, "");
  text = text.replace(/^(?:你|该角色|此人|有人)(?:判断|推测|认为|觉得|怀疑|估计|得出(?:了)?(?:结论)?|意识到)[：:\s]*/u, "");
  text = text.replace(/^(?:你)?(?:清楚地)?(?:看见|看到|听见|听到|闻到|察觉到|发现)[：:，,\s]*/u, "");
  text = text.replace(/^(?:结果|事实|情况)(?:是|为)[：:\s]*/u, "");
  return normalizeGroundingText(text);
}

function withoutTerminalAspectParticle(value: string): string {
  return value.replace(/[了着呢]$/u, "");
}

function claimTextSupportsClause(clause: string, evidenceText: string): boolean {
  const body = narrationFactCore(clause);
  const evidence = normalizeGroundingText(evidenceText);
  if (body.length < 1 || evidence.length < 1) return false;
  // vNext narration is intentionally extractive: an accepted fact must be a
  // complete Claim payload (apart from a harmless Chinese aspect particle),
  // never merely overlap it. Coverage scores allow a short invented suffix to
  // hitchhike on a longer true sentence.
  return body === evidence
    || withoutTerminalAspectParticle(body) === withoutTerminalAspectParticle(evidence);
}

function isDecisionReturnClause(clause: string): boolean {
  const normalized = normalizeGroundingText(clause);
  return /^(?:那么)?(?:你)?(?:(?:现在|接下来|下一步))?(?:打算|准备|想要|想|要|会|选择)?(?:怎么做|做什么|如何行动|采取什么行动|怎么办)$/u.test(normalized)
    || /^(?:请)?(?:你)?决定(?:你的)?下一步(?:行动)?$/u.test(normalized)
    || /^(?:你的)?下一步是什么$/u.test(normalized);
}

function assertFrozenClaimsNarrationGrounded(
  body: string,
  request: FrozenClaimsNarrationRequest,
): void {
  if (INTERNAL_REFERENCE_ASSERTION.test(body)) throw new NarrationGroundingValidationError();
  const evidence = request.renderableClaims.claims
    .map(frozenClaimTextEvidence)
    .filter((entry): entry is FrozenClaimTextEvidence => entry !== undefined);
  const clauses = body.split(CLAIM_SENTENCE_BOUNDARY).map((clause) => clause.trim()).filter(Boolean);
  if (clauses.length === 0) throw new NarrationGroundingValidationError();
  const renderedClaimRefs = new Set<string>();

  const validateClause = (clause: string, maySplit: boolean): void => {
    if (isDecisionReturnClause(clause)) return;
    if (PLAYER_AGENCY_ASSERTION.test(clause)) throw new NarrationGroundingValidationError();
    const matching = evidence.filter((entry) =>
      entry.texts.some((text) => claimTextSupportsClause(clause, text)));
    if (matching.length === 0) {
      const parts = maySplit
        ? clause.split(CLAIM_COMPOUND_BOUNDARY).map((part) => part.trim()).filter(Boolean)
        : [];
      if (parts.length < 2) throw new NarrationGroundingValidationError();
      for (const part of parts) validateClause(part, false);
      return;
    }

    const sourceOnly = matching.every(({ kind }) => kind === "sourceClaim");
    if (sourceOnly && !SOURCE_ATTRIBUTION.test(clause.trim())) {
      throw new NarrationGroundingValidationError();
    }
    const inferenceOnly = matching.every(({ kind }) => kind === "characterInference");
    if (inferenceOnly && !INFERENCE_ATTRIBUTION.test(clause.trim())) {
      throw new NarrationGroundingValidationError();
    }
    for (const entry of matching) renderedClaimRefs.add(entry.claimRef);
  };

  for (const clause of clauses) validateClause(clause, true);

  const substantiveClaims = evidence.filter(({ kind }) => kind !== "actionCommitted");
  const requiredClaims = substantiveClaims.length > 0 ? substantiveClaims : evidence;
  if (requiredClaims.some(({ claimRef }) => !renderedClaimRefs.has(claimRef))) {
    throw new NarrationGroundingValidationError();
  }
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
