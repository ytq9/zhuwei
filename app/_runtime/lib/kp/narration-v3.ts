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
