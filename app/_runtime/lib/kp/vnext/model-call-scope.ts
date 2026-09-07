import type { AuthoritativeModelBinding } from "../authoritative-types";

type LocalModelCallEvent = Readonly<{
  eventName: "kp.local.probe.call";
  roomId: string;
  limit: number;
  ordinal: number;
}>;

/** One HTTP request owns one scope shared by proposal, NPC and narration
 * bindings. Local instrumentation never changes model inputs or outputs. */
export function createVNextModelCallScope(options: Readonly<{
  roomId: string;
  limit?: string;
  captureUrl?: string;
  emit?: (event: LocalModelCallEvent) => void;
  /** Testable transport for the explicitly configured private local sink. */
  fetch?: typeof fetch;
}>): Readonly<{ bind(binding: AuthoritativeModelBinding): AuthoritativeModelBinding }> {
  const limit = options.limit === undefined ? undefined : Number(options.limit);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 12)) {
    throw new Error("LOCAL_MODEL_PROBE_LIMIT_INVALID");
  }
  let remaining = limit ?? Infinity;
  const captureUrl = options.captureUrl !== undefined
    && /^http:\/\/(?:127\.0\.0\.1|localhost):[0-9]+\/capture$/u.test(options.captureUrl)
    ? options.captureUrl : undefined;
  const emit = options.emit ?? ((event: LocalModelCallEvent) => console.info(JSON.stringify(event)));
  return {
    bind(binding) {
      return {
        async run(model, request, runOptions) {
          if (remaining <= 0) throw Object.assign(new Error("LOCAL_MODEL_PROBE_LIMIT_EXHAUSTED"), {
            code: "localProbeBudgetExhausted",
          });
          // Reserve before the first await, so concurrent bindings share the
          // same budget. Failed provider attempts also consume their slot.
          remaining -= 1;
          if (limit !== undefined) {
            try {
              emit({ eventName: "kp.local.probe.call", roomId: options.roomId, limit, ordinal: limit - remaining });
            } catch { /* Instrumentation cannot prevent the authorized call. */ }
          }
          const response = await binding.run(model, request, runOptions);
          if (captureUrl !== undefined) {
            try {
              await (options.fetch ?? globalThis.fetch)(captureUrl, {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ roomId: options.roomId, model, request, response }),
                signal: AbortSignal.timeout(1000),
              });
            } catch { /* The private local evidence sink cannot change a result. */ }
          }
          return response;
        },
      };
    },
  };
}
