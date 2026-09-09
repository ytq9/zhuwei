import type { AuthoritativeModelBinding } from "../kp/authoritative-types";
import { assertDeepSeekStrictToolModelInput, deepSeekRequestBody, DeepSeekApiError } from "../kp/deepseek";
import { canonicalHash, isPlainRecord } from "../kp/vnext/canonical-json";
import { prepareStory } from "./story-creation";
import type {
  StoryContext, StoryHash, StoryModelRequest, StoryPreparationResult,
  StoryRecipe, StoryRecord, StoryRequest, StoryVersionRef,
} from "./story-creation/contracts";
import type { StoryBudgetPolicy, StoryInvocationReservation, StoryMeasuredUsage } from "./story-creation-invocation";
import type { StoryCreationStore } from "./story-creation-store";

export type StoryTransportPolicy = Readonly<{
  modelId: string;
  modelRevision: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
  /** Host pricing estimates, in millionths of the configured currency per
   * million tokens. They are admission estimates, never provider invoices. */
  estimatedInputMicrosPerMillion: number;
  estimatedOutputMicrosPerMillion: number;
}>;

const hash = (value: unknown): StoryHash => canonicalHash(value) as StoryHash;

export function storyTransportRef(policy: StoryTransportPolicy): StoryVersionRef {
  return {
    id: "zhuwei.story-deepseek-strict-transport", version: "1",
    hash: hash({ codec: "deepseek-strict-tool/v1", policy }),
  };
}

/** One actual host Adapter serves both first execution and recovery. Binding
 * contains credentials; neither recipes nor persisted model outputs do. */
export async function prepareRoomStory(input: Readonly<{
  request: StoryRequest; context: StoryContext; budget: StoryBudgetPolicy;
}>, host: Readonly<{
  store: StoryCreationStore;
  binding: AuthoritativeModelBinding;
  transport: StoryTransportPolicy;
  recipes: readonly StoryRecipe[];
}>): Promise<StoryPreparationResult> {
  const failed = (code: "STORY_IDENTITY_CONFLICT" | "STORY_CAPABILITY_UNSUPPORTED" | "STORY_BUDGET_EXHAUSTED"): StoryPreparationResult =>
    ({ kind: "rejected", code, checkpoint: null });
  if (!validTransport(host.transport)) return failed("STORY_CAPABILITY_UNSUPPORTED");
  const transport = Object.freeze(structuredClone(host.transport));
  const runModel = host.binding.run.bind(host.binding);
  const opened = host.store.openJob({ ...input, modelRef: storyTransportRef(transport),
    stageReservation: estimateReservation(transport, transport.maxInputTokens) });
  if (opened.kind !== "opened") return { kind: "rejected", code: opened.code, checkpoint: null };
  // Use the exact saved snapshots. Caller changes cannot silently refresh a
  // job's constraints or model while another invocation is outstanding.
  const job = opened.job;
  return prepareStory(job.request, job.context, job.checkpoint, {
    recipes: host.recipes,
    hash,
    saveCheckpoint: async (expectedRevision, next) => host.store.checkpoint({ expectedRevision, next }),
    async invoke(request) {
      const body = storyProviderRequest(request, transport);
      // Configuration failure is proved before reserving or dispatching. It
      // must not consume a paid call or turn into a retry with a weaker tool.
      try { assertDeepSeekStrictToolModelInput(body); }
      catch { return { kind: "rejected", code: "STORY_CAPABILITY_UNSUPPORTED" }; }
      // UTF-8 bytes are a conservative admission estimate for current model
      // text. This is deliberately labelled an estimate, not tokenizer usage.
      const estimatedInputTokens = new TextEncoder().encode(JSON.stringify(body)).byteLength;
      if (estimatedInputTokens > transport.maxInputTokens) {
        return { kind: "rejected", code: "STORY_BUDGET_EXHAUSTED" };
      }
      const reserved = host.store.reserveInvocation({ request, providerRequest: body,
        reservation: estimateReservation(transport, estimatedInputTokens),
      });
      if (reserved.kind !== "reserved") return reserved;
      const identity = { invocationId: reserved.invocationId, capability: reserved.capability };
      const started = host.store.startInvocation(identity);
      if (started.kind !== "ready") return started;
      // Only the store's one-time transition permits this call. A worker
      // crash, timeout or lease expiry cannot grant another send permission.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), transport.timeoutMs);
      let response: unknown;
      try {
        response = await runModel(transport.modelId, started.providerRequest, { signal: controller.signal });
      } catch (error) {
        if (error instanceof DeepSeekApiError && error.status >= 400 && error.status < 500) {
          const saved = host.store.completeInvocation({ ...identity, result: { kind: "failed" } });
          if (saved.kind !== "saved") return saved;
          if (!saved.eligible) return { kind: "rejected", code: "STORY_CHECKPOINT_CONFLICT" };
          return { kind: "rejected", code: "STORY_PROVIDER_FAILED" };
        }
        const saved = host.store.completeInvocation({ ...identity, result: { kind: "unknown" } });
        if (saved.kind !== "saved") return saved;
        if (!saved.eligible) return { kind: "rejected", code: "STORY_CHECKPOINT_CONFLICT" };
        return { kind: "waiting", code: "STORY_INVOCATION_UNKNOWN" };
      } finally { clearTimeout(timer); }
      const usage = storyProviderUsage(response);
      const saved = host.store.completeInvocation({ ...identity, result: {
        kind: "completed", response, ...(usage === undefined ? {} : { usage }),
      } });
      if (saved.kind !== "saved") return saved;
      if (!saved.eligible) return { kind: "rejected", code: "STORY_CHECKPOINT_CONFLICT" };
      return { kind: "completed", response };
    },
  });
}

/** Codec is host-owned and frozen in the stored exact provider request. */
export function storyProviderRequest(request: StoryModelRequest, policy: StoryTransportPolicy): StoryRecord {
  return deepSeekRequestBody(policy.modelId, {
    messages: request.messages,
    tools: [{ type: "function", function: {
      name: request.toolName,
      description: "Return the complete material requested by the current story preparation stage.",
      strict: true, parameters: request.schema,
    } }],
    tool_choice: "required", parallel_tool_calls: false,
    max_completion_tokens: policy.maxOutputTokens,
    thinking: { type: "disabled" },
  }) as StoryRecord;
}

function validTransport(policy: StoryTransportPolicy): boolean {
  return typeof policy.modelId === "string" && policy.modelId.length > 0
    && typeof policy.modelRevision === "string" && policy.modelRevision.length > 0
    && [policy.maxInputTokens, policy.maxOutputTokens, policy.timeoutMs,
      policy.estimatedInputMicrosPerMillion, policy.estimatedOutputMicrosPerMillion]
      .every(value => Number.isSafeInteger(value) && value > 0)
    && Number.isSafeInteger(estimateReservation(policy, policy.maxInputTokens).estimatedCostMicros)
    && policy.timeoutMs <= 120_000;
}

function estimateReservation(policy: StoryTransportPolicy, inputTokens: number): StoryInvocationReservation {
  return { inputTokens, outputTokens: policy.maxOutputTokens, elapsedMs: policy.timeoutMs,
    estimatedCostMicros: Math.ceil((inputTokens * policy.estimatedInputMicrosPerMillion
      + policy.maxOutputTokens * policy.estimatedOutputMicrosPerMillion) / 1_000_000) };
}

function storyProviderUsage(response: unknown): StoryMeasuredUsage | undefined {
  if (!isPlainRecord(response) || !isPlainRecord(response.usage)) return undefined;
  const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const inputTokens = response.usage.prompt_tokens;
  const outputTokens = response.usage.completion_tokens;
  if (!integer(inputTokens) && !integer(outputTokens)) return undefined;
  return { ...(integer(inputTokens) ? { inputTokens } : {}), ...(integer(outputTokens) ? { outputTokens } : {}) };
}
