import { canonicalHash, deepFreeze } from "../kp/vnext/canonical-json";
import { AUTHORITATIVE_KP_PROFILE } from "../kp/authoritative-policy";
import type { StoryBudgetPolicy } from "./story-creation-invocation";
import type { StoryHash, StoryRequest } from "./story-creation/contracts";
import type { StoryTransportPolicy } from "./story-preparation-host";
import { conservativeInputTokens } from "../kp/vnext/invocation/budget";
import type { AuthoritativeWorldState } from "../rules";
import type { StoryRecord } from "./story-creation/contracts";
import type { StoryExternalInvocationBinding, StoryMeasuredUsage } from "./story-creation-invocation";

/** Development admission ceilings, not provider prices or a billing promise.
 * One immutable policy governs creation and every call sharing its source. */
export const ROOM_STORY_TRANSPORT = deepFreeze({
  modelId: AUTHORITATIVE_KP_PROFILE.modelId,
  modelRevision: AUTHORITATIVE_KP_PROFILE.modelRevision,
  // The complete registered-module request measures about 67k estimated
  // input tokens after lossless schema compaction. Reserve room for the
  // independent review and the one permitted revision without truncating it.
  maxInputTokens: 96_000, maxOutputTokens: 12_000, timeoutMs: 45_000,
  estimatedInputMicrosPerMillion: 8_000_000,
  estimatedOutputMicrosPerMillion: 16_000_000,
} satisfies StoryTransportPolicy);
const amounts = (calls: number) => ({ calls, inputTokens: calls * ROOM_STORY_TRANSPORT.maxInputTokens,
  outputTokens: calls * ROOM_STORY_TRANSPORT.maxOutputTokens,
  estimatedCostMicros: calls * Math.ceil((ROOM_STORY_TRANSPORT.maxInputTokens * ROOM_STORY_TRANSPORT.estimatedInputMicrosPerMillion
    + ROOM_STORY_TRANSPORT.maxOutputTokens * ROOM_STORY_TRANSPORT.estimatedOutputMicrosPerMillion) / 1_000_000),
  elapsedMs: calls * ROOM_STORY_TRANSPORT.timeoutMs });
const limits = deepFreeze({ job: amounts(4), source: amounts(24), room: amounts(1_024) });
export const ROOM_STORY_BUDGET_REF = deepFreeze({ id: "zhuwei.room-story-budget", version: "1",
  hash: canonicalHash({ transport: ROOM_STORY_TRANSPORT, inputCounter: "conservative-v1", limits }) as StoryHash });
export function roomStoryBudget(source: StoryRequest["source"]): StoryBudgetPolicy {
  return { policyRef: ROOM_STORY_BUDGET_REF,
    roomAccountId: `model-budget:${source.roomId}:${source.runtimeEpochId}`, ...limits };
}

export function roomModelInvocationBinding(state: AuthoritativeWorldState, sourceRootActionId: string,
  invocationKey: string, purpose: StoryExternalInvocationBinding["purpose"], providerRequest: StoryRecord): StoryExternalInvocationBinding {
  const source: StoryRequest["source"] = { roomId: state.roomId, runtimeEpochId: state.runtimeEpochId,
    branchId: state.activeBranchId, kind: "playerAction", sourceId: sourceRootActionId,
    budgetAccountId: `source-budget:${state.runtimeEpochId}:${sourceRootActionId}` };
  const budget = roomStoryBudget(source);
  const inputTokens = conservativeInputTokens(JSON.stringify(providerRequest));
  const rawOutput = providerRequest.max_completion_tokens ?? providerRequest.max_tokens;
  if (typeof rawOutput !== "number" || !Number.isSafeInteger(rawOutput) || rawOutput <= 0) throw new TypeError("STORY_BUDGET_EXHAUSTED");
  const outputTokens = rawOutput;
  return { source, budget, roomAccountId: budget.roomAccountId, invocationKey, purpose, providerRequest,
    modelRef: { id: String(providerRequest.model), version: AUTHORITATIVE_KP_PROFILE.modelRevision,
      hash: canonicalHash({ model: providerRequest.model, revision: AUTHORITATIVE_KP_PROFILE.modelRevision,
        codec: "deepseek-strict-tool/v1", budget: ROOM_STORY_BUDGET_REF }) as StoryHash },
    reservation: { inputTokens, outputTokens, elapsedMs: 50_000,
      estimatedCostMicros: Math.ceil((inputTokens * ROOM_STORY_TRANSPORT.estimatedInputMicrosPerMillion
        + outputTokens * ROOM_STORY_TRANSPORT.estimatedOutputMicrosPerMillion) / 1_000_000) } };
}

export function roomModelUsage(response: unknown): StoryMeasuredUsage | undefined {
  if (response === null || typeof response !== "object" || !("usage" in response)) return undefined;
  const usage = response.usage;
  if (usage === null || typeof usage !== "object") return undefined;
  const valid = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const input = "prompt_tokens" in usage ? usage.prompt_tokens : undefined;
  const output = "completion_tokens" in usage ? usage.completion_tokens : undefined;
  return valid(input) || valid(output) ? { ...(valid(input) ? { inputTokens: input } : {}),
    ...(valid(output) ? { outputTokens: output } : {}) } : undefined;
}

/** Absent provider telemetry is an absent field, never undefined JSON or
 * zero usage. The journal retains its unknown-dimension reservations. */
export function roomModelUsageFields(response: unknown): { usage?: StoryMeasuredUsage } {
  const usage = roomModelUsage(response);
  return usage === undefined ? {} : { usage };
}
