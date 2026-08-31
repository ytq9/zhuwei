import {
  DUE_NPC_MECHANICAL_PROPOSAL_SCHEMA,
  DUE_NPC_MECHANICAL_PROPOSAL_SCHEMA_DEFINITIONS,
} from "./authoritative-policy";
import {
  ModelOutputValidationError,
  canonicalJson,
  collectStrings,
  isRecord,
  validateNpcMechanicalProposal,
} from "./authoritative-helpers";
import type {
  DueActorPlanDecision,
  DueActorPlanDecisionRequest,
  DueActorPlanRevision,
} from "./authoritative-types";

export const ACTOR_PLAN_DECISION_TOOL_NAME = "submit_due_actor_plan_decision" as const;

const stringArray = {
  type: "array",
  maxItems: 40,
  uniqueItems: true,
  items: { type: "string", minLength: 1, maxLength: 240 },
};

const dueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { const: "fictionTime" },
    atFictionMicros: { type: "string", pattern: "^(0|[1-9][0-9]*)$", maxLength: 40 },
  },
  required: ["kind", "atFictionMicros"],
};

const triggerSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "committedEvent" },
        eventRef: { type: "string", minLength: 1, maxLength: 240 },
      },
      required: ["kind", "eventRef"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "knowledgeAcquired" },
        knowledgeRef: { type: "string", minLength: 1, maxLength: 240 },
      },
      required: ["kind", "knowledgeRef"],
    },
  ],
};

const traceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    factRef: { type: "string", minLength: 1, maxLength: 240 },
    description: { type: "string", minLength: 1, maxLength: 480 },
  },
  required: ["factRef", "description"],
};

const alternateTargetSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    targetRef: { type: "string", minLength: 1, maxLength: 240 },
    reason: { type: "string", minLength: 1, maxLength: 480 },
  },
  required: ["targetRef", "reason"],
};

const revisionProperties = {
  reason: { type: "string", minLength: 1, maxLength: 480 },
  premiseRefs: { ...stringArray, minItems: 1 },
  nextStep: { type: "string", minLength: 1, maxLength: 480 },
  resourceRefs: stringArray,
  trace: traceSchema,
  alternateTarget: alternateTargetSchema,
};

const revisionSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        ...revisionProperties,
        due: dueSchema,
        trigger: { type: "null" },
      },
      required: [
        "reason",
        "premiseRefs",
        "nextStep",
        "resourceRefs",
        "due",
        "trigger",
        "trace",
        "alternateTarget",
      ],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        ...revisionProperties,
        due: { type: "null" },
        trigger: triggerSchema,
      },
      required: [
        "reason",
        "premiseRefs",
        "nextStep",
        "resourceRefs",
        "due",
        "trigger",
        "trace",
        "alternateTarget",
      ],
    },
  ],
};

const planIdSchema = {
  type: "string",
  minLength: 1,
  maxLength: 240,
  description: "逐字复制输入 actorPlan.planId。",
};

function actorPlanDecisionTool(
  definitions: Record<string, unknown>,
  npcActionPlan: Record<string, unknown>,
) {
  return Object.freeze({
    type: "function",
    function: {
      name: ACTOR_PLAN_DECISION_TOOL_NAME,
      description: "Resolve one due finite-knowledge NPC or faction ActorPlan.",
      parameters: {
        $def: definitions,
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: {
              decision: { const: "execute" },
              planId: planIdSchema,
              mechanicalProposal: {
                anyOf: [{ type: "null" }, npcActionPlan],
              },
              targetRef: { type: "string", minLength: 1, maxLength: 240 },
            },
            required: ["decision", "planId", "mechanicalProposal"],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              decision: { const: "revise" },
              planId: planIdSchema,
              mechanicalProposal: { type: "null" },
              revision: revisionSchema,
            },
            required: ["decision", "planId", "mechanicalProposal", "revision"],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              decision: { const: "defer" },
              planId: planIdSchema,
              mechanicalProposal: { type: "null" },
              reason: { type: "string", minLength: 1, maxLength: 480 },
              deferUntilFictionMicros: {
                type: "string",
                pattern: "^(0|[1-9][0-9]*)$",
                maxLength: 40,
              },
            },
            required: [
              "decision",
              "planId",
              "mechanicalProposal",
              "reason",
              "deferUntilFictionMicros",
            ],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              decision: { const: "cancel" },
              planId: planIdSchema,
              mechanicalProposal: { type: "null" },
              reason: { type: "string", minLength: 1, maxLength: 480 },
            },
            required: ["decision", "planId", "mechanicalProposal", "reason"],
          },
        ],
      },
    },
  });
}

export const ACTOR_PLAN_DECISION_TOOL = actorPlanDecisionTool(
  DUE_NPC_MECHANICAL_PROPOSAL_SCHEMA_DEFINITIONS,
  DUE_NPC_MECHANICAL_PROPOSAL_SCHEMA,
);

const ACTOR_PLAN_SYSTEM = `你是烛帷中一个独立的、仅在服务器内运行的到期 ActorPlan 决策边界。这里不是玩家行动提案，也不使用私有 Form、RequiredContext、检索或 Planner。

你只能依据 actorPlan 与 npcViewer 中该 NPC 已知或能感知的有限事实决定：
- execute：条件仍成立时执行被冻结的 nextStep；只有确需 Rules 结算时才附一个闭合 NPC mechanicalProposal，否则为 null；targetRef 只能省略或使用被冻结的 alternateTarget.targetRef。
- revise：新获得的有限知识使原步骤不再合适时，提交一个完整替代计划。premiseRefs、resourceRefs、trigger 与 alternateTarget 只能引用本次有限视图已有 ref；due 与 trigger 必须恰有一个非 null。
- defer：NPC 有世界内理由等待，并给出晚于当前虚构时刻的 deferUntilFictionMicros。
- cancel：计划目标或前提已明确消失，并给出世界内理由。

不得使用玩家未向该 NPC 暴露的意图或秘密，不得假设 KP 全知内容，不得输出 Principal、Audience、Profile、骰面、事件、状态补丁、rootActionId、proposalAttemptId 或额外字段。只调用 submit_due_actor_plan_decision 一次，不输出解释文字。`;

const REQUEST_KEYS = [
  "attempt",
  "dueActorPlan",
  "preparedActionId",
  "projection",
  "rootActionId",
] as const;

const FORBIDDEN_AUTHORITY_KEYS = new Set([
  "audience",
  "audienceid",
  "audiences",
  "npcviewers",
  "principal",
  "principalid",
  "principals",
]);

const PRIVATE_CONTROL_KEYS = new Set([
  "activeBranchId",
  "dueActorPlan",
  "dueActorPlanChildRootActionId",
  "projectionHash",
  "runtimeProfiles",
  "stateVersion",
]);

function invalid(): never {
  throw new ModelOutputValidationError();
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) invalid();
  if (required.some((key) => !Object.hasOwn(value, key))) invalid();
}

function boundedString(value: unknown, maxLength = 240): string {
  if (typeof value !== "string") invalid();
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maxLength) invalid();
  return normalized;
}

function unsignedMicros(value: unknown): string {
  const normalized = boundedString(value, 40);
  if (!/^(0|[1-9][0-9]*)$/.test(normalized)) invalid();
  return normalized;
}

function canonicalStrings(
  value: unknown,
  options: { min?: number; max?: number } = {},
): string[] {
  if (!Array.isArray(value)) invalid();
  const min = options.min ?? 0;
  const max = options.max ?? 40;
  if (value.length < min || value.length > max) invalid();
  const strings = value.map((entry) => boundedString(entry));
  if (new Set(strings).size !== strings.length) invalid();
  return strings;
}

function assertNoAuthorityLeak(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value === "string") {
    if (/^(?:audience|principal):/iu.test(value.trim())) invalid();
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) invalid();
    seen.add(value);
    for (const entry of value) assertNoAuthorityLeak(entry, seen);
    seen.delete(value);
    return;
  }
  if (!isRecord(value)) return;
  if (seen.has(value)) invalid();
  seen.add(value);
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_AUTHORITY_KEYS.has(key.toLowerCase().replaceAll(/[^a-z]/g, ""))) invalid();
    assertNoAuthorityLeak(entry, seen);
  }
  seen.delete(value);
}

function actorPlanAndNpcViewer(request: DueActorPlanDecisionRequest): {
  actorPlan: Record<string, unknown>;
  npcViewer: Record<string, unknown>;
} {
  if (!isRecord(request)) invalid();
  exactKeys(request, REQUEST_KEYS);
  boundedString(request.preparedActionId);
  boundedString(request.rootActionId);
  if (request.attempt !== 1 || !isRecord(request.dueActorPlan) || !isRecord(request.projection)) {
    invalid();
  }
  const actorPlan = request.dueActorPlan;
  const projection = request.projection;
  const viewer = isRecord(projection.viewer) ? projection.viewer : undefined;
  const planId = boundedString(actorPlan.planId);
  const actorRef = typeof actorPlan.decisionNpcId === "string"
    ? actorPlan.decisionNpcId
    : undefined;
  if (
    viewer?.kind !== "npc"
    || typeof viewer.subjectId !== "string"
    || actorRef === undefined
    || viewer.subjectId !== actorRef
    || !isRecord(projection.dueActorPlan)
    || projection.dueActorPlan.planId !== planId
    || canonicalJson(projection.dueActorPlan) !== canonicalJson(actorPlan)
  ) invalid();
  assertNoAuthorityLeak(actorPlan);
  assertNoAuthorityLeak(projection);
  const npcViewer = Object.fromEntries(
    Object.entries(projection)
      .filter(([key]) => !PRIVATE_CONTROL_KEYS.has(key))
      .map(([key, value]) => [key, structuredClone(value)]),
  );
  return { actorPlan: structuredClone(actorPlan), npcViewer };
}

export function actorPlanDecisionModelInput(
  request: DueActorPlanDecisionRequest,
): Record<string, unknown> {
  const { actorPlan, npcViewer } = actorPlanAndNpcViewer(request);
  return {
    messages: [
      { role: "system", content: ACTOR_PLAN_SYSTEM },
      {
        role: "user",
        content: canonicalJson({
          actorPlan,
          npcViewer,
        }),
      },
    ],
    tools: [ACTOR_PLAN_DECISION_TOOL],
    tool_choice: "required",
    parallel_tool_calls: false,
    temperature: 0.1,
    max_completion_tokens: 1_100,
  };
}

function currentFictionMicros(projection: Record<string, unknown>): bigint {
  const fictionTime = isRecord(projection.fictionTime) ? projection.fictionTime : undefined;
  const nowMicros = unsignedMicros(fictionTime?.nowMicros);
  return BigInt(nowMicros);
}

function referenceSet(request: DueActorPlanDecisionRequest): Set<string> {
  return collectStrings({
    actorPlan: request.dueActorPlan,
    npcViewer: request.projection,
  });
}

function trace(
  value: unknown,
  actorPlan: Record<string, unknown>,
): DueActorPlanRevision["trace"] {
  if (!isRecord(value)) invalid();
  exactKeys(value, ["description", "factRef"]);
  const frozenTrace = isRecord(actorPlan.trace) ? actorPlan.trace : undefined;
  return {
    factRef: boundedString(value.factRef),
    description: boundedString(value.description, 480),
    visibilityPolicyRef: boundedString(frozenTrace?.visibilityPolicyRef),
  };
}

function alternateTarget(
  value: unknown,
  finiteRefs: ReadonlySet<string>,
): DueActorPlanRevision["alternateTarget"] {
  if (!isRecord(value)) invalid();
  exactKeys(value, ["reason", "targetRef"]);
  const targetRef = boundedString(value.targetRef);
  if (!finiteRefs.has(targetRef)) invalid();
  return { targetRef, reason: boundedString(value.reason, 480) };
}

function revision(
  value: unknown,
  request: DueActorPlanDecisionRequest,
): DueActorPlanRevision {
  if (!isRecord(value)) invalid();
  exactKeys(value, [
    "alternateTarget",
    "due",
    "nextStep",
    "premiseRefs",
    "reason",
    "resourceRefs",
    "trace",
    "trigger",
  ]);
  const finiteRefs = referenceSet(request);
  const premiseRefs = canonicalStrings(value.premiseRefs, { min: 1 });
  const resourceRefs = canonicalStrings(value.resourceRefs);
  if ([...premiseRefs, ...resourceRefs].some((ref) => !finiteRefs.has(ref))) invalid();
  let due: DueActorPlanRevision["due"] = null;
  if (value.due !== null) {
    if (!isRecord(value.due)) invalid();
    exactKeys(value.due, ["atFictionMicros", "kind"]);
    const atFictionMicros = unsignedMicros(value.due.atFictionMicros);
    if (value.due.kind !== "fictionTime" || BigInt(atFictionMicros) <= currentFictionMicros(
      request.projection as Record<string, unknown>,
    )) invalid();
    due = { kind: "fictionTime", atFictionMicros };
  }
  let trigger: DueActorPlanRevision["trigger"] = null;
  if (value.trigger !== null) {
    if (!isRecord(value.trigger)) invalid();
    if (value.trigger.kind === "committedEvent") {
      exactKeys(value.trigger, ["eventRef", "kind"]);
      const eventRef = boundedString(value.trigger.eventRef);
      if (!finiteRefs.has(eventRef)) invalid();
      trigger = { kind: "committedEvent", eventRef };
    } else if (value.trigger.kind === "knowledgeAcquired") {
      exactKeys(value.trigger, ["kind", "knowledgeRef"]);
      const knowledgeRef = boundedString(value.trigger.knowledgeRef);
      if (!finiteRefs.has(knowledgeRef)) invalid();
      trigger = { kind: "knowledgeAcquired", knowledgeRef };
    } else invalid();
  }
  if ((due === null) === (trigger === null)) invalid();
  return {
    reason: boundedString(value.reason, 480),
    premiseRefs,
    nextStep: boundedString(value.nextStep, 480),
    resourceRefs,
    due,
    trigger,
    trace: trace(value.trace, request.dueActorPlan as Record<string, unknown>),
    alternateTarget: alternateTarget(value.alternateTarget, finiteRefs),
  };
}

/** Validates model-owned decision fields and derives all server-owned envelope
 * fields so the returned value can be passed directly to commitDueActorPlan. */
export function validateActorPlanDecisionOutput(
  value: unknown,
  request: DueActorPlanDecisionRequest,
  options: Readonly<{ npcEquipment?: boolean }> = {},
): DueActorPlanDecision {
  actorPlanAndNpcViewer(request);
  if (!isRecord(value)) invalid();
  assertNoAuthorityLeak(value);
  const actorPlan = request.dueActorPlan as Record<string, unknown>;
  const planId = boundedString(value.planId);
  if (planId !== actorPlan.planId) invalid();
  const base = {
    kind: "actorPlanDecision" as const,
    planId,
    proposalAttemptId: `${request.rootActionId}:kp:actor-plan:1`,
    rootActionId: request.rootActionId,
  };
  if (value.decision === "execute") {
    exactKeys(value, ["decision", "mechanicalProposal", "planId", "targetRef"], [
      "decision",
      "mechanicalProposal",
      "planId",
    ]);
    const targetRef = value.targetRef === undefined
      ? undefined
      : boundedString(value.targetRef);
    const frozenAlternate = isRecord(actorPlan.alternateTarget)
      ? actorPlan.alternateTarget.targetRef
      : undefined;
    if (targetRef !== undefined && targetRef !== frozenAlternate) invalid();
    const mechanicalProposal = validateNpcMechanicalProposal(value.mechanicalProposal);
    if (options.npcEquipment !== true
      && mechanicalProposal !== null
      && ["transferItem", "changeNpcGear"].includes(mechanicalProposal.operation)) invalid();
    return {
      ...base,
      decision: "execute",
      mechanicalProposal,
      ...(targetRef === undefined ? {} : { targetRef }),
    };
  }
  if (value.decision === "revise") {
    exactKeys(value, ["decision", "mechanicalProposal", "planId", "revision"]);
    if (value.mechanicalProposal !== null) invalid();
    return {
      ...base,
      decision: "revise",
      mechanicalProposal: null,
      revision: revision(value.revision, request),
    };
  }
  if (value.decision === "defer") {
    exactKeys(value, [
      "decision",
      "deferUntilFictionMicros",
      "mechanicalProposal",
      "planId",
      "reason",
    ]);
    if (value.mechanicalProposal !== null) invalid();
    const deferUntilFictionMicros = unsignedMicros(value.deferUntilFictionMicros);
    if (BigInt(deferUntilFictionMicros) <= currentFictionMicros(
      request.projection as Record<string, unknown>,
    )) invalid();
    return {
      ...base,
      decision: "defer",
      mechanicalProposal: null,
      reason: boundedString(value.reason, 480),
      deferUntilFictionMicros,
    };
  }
  if (value.decision === "cancel") {
    exactKeys(value, ["decision", "mechanicalProposal", "planId", "reason"]);
    if (value.mechanicalProposal !== null) invalid();
    return {
      ...base,
      decision: "cancel",
      mechanicalProposal: null,
      reason: boundedString(value.reason, 480),
    };
  }
  invalid();
}
