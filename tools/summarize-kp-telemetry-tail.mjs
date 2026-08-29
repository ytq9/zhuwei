import { pathToFileURL } from "node:url";
import readline from "node:readline";

const TELEMETRY_SCHEMA = "zhuwei.room-telemetry/v1";
const MODEL_EVENT = "room.model.invocation.completed";
const CONTEXT_EVENT = "kp.context.prepared";

export function createKpTelemetryTailAggregator(label = "capture") {
  const normalizedLabel = /^[A-Za-z0-9_-]{1,40}$/u.test(label) ? label : "capture";
  const modelEvents = [];
  const contextEvents = [];
  return Object.freeze({
    ingestTailEnvelope(envelope) {
      if (!record(envelope) || !Array.isArray(envelope.logs)) return;
      for (const log of envelope.logs) {
        if (!record(log) || !Array.isArray(log.message)) continue;
        for (const candidate of log.message) {
          if (typeof candidate !== "string") continue;
          let event;
          try {
            event = JSON.parse(candidate);
          } catch {
            continue;
          }
          if (!record(event) || event.schemaVersion !== TELEMETRY_SCHEMA) continue;
          if (event.eventName === MODEL_EVENT) modelEvents.push(safeModelEvent(event));
          if (event.eventName === CONTEXT_EVENT) contextEvents.push(safeContextEvent(event));
        }
      }
    },
    report() {
      return summarize(normalizedLabel, modelEvents, contextEvents);
    },
  });
}

function safeModelEvent(event) {
  return Object.freeze({
    rootActionHash: text(event.rootActionHash),
    task: event.modelTask === "proposal" || event.modelTask === "narration"
      ? event.modelTask
      : "unknown",
    attempt: integer(event.modelAttempt),
    result: text(event.modelResult) ?? "unknown",
    errorCode: text(event.errorCode),
    durationMs: integer(event.durationMs),
    inputTokens: integer(event.modelInputTokens),
    outputTokens: integer(event.modelOutputTokens),
    modelId: text(event.modelId),
    modelRevision: text(event.modelRevision),
    modelProfileVersion: text(event.modelProfileVersion),
  });
}

function safeContextEvent(event) {
  return Object.freeze({
    plannerMode: text(event.plannerMode),
    plannerStatus: text(event.plannerStatus),
    plannerFallbackUsed: event.plannerFallbackUsed === true,
    retrievalMode: text(event.retrievalMode),
    retrievalStatus: text(event.retrievalStatus),
    retrievalFallbackUsed: event.retrievalFallbackUsed === true,
  });
}

function summarize(label, modelEvents, contextEvents) {
  const proposals = modelEvents.filter((event) => event.task === "proposal");
  const narrations = modelEvents.filter((event) => event.task === "narration");
  const roots = new Map();
  for (const event of proposals) {
    if (event.rootActionHash === undefined) continue;
    const list = roots.get(event.rootActionHash) ?? [];
    list.push(event);
    roots.set(event.rootActionHash, list);
  }
  const firstAttempts = [...roots.values()].map((events) =>
    events.find((event) => event.attempt === 1)).filter(Boolean);
  const firstSuccesses = firstAttempts.filter((event) => event.result === "success").length;
  const repairedRoots = [...roots.values()].filter((events) =>
    events.some((event) => event.attempt === 2 && event.result === "success")).length;
  const proposalFailures = proposals.filter((event) => event.result !== "success");
  const narrationFailures = narrations.filter((event) => event.result !== "success");
  const contextFallbacks = contextEvents.filter((event) =>
    event.plannerFallbackUsed || event.retrievalFallbackUsed).length;
  const modelBindings = countBy(modelEvents, (event) => [
    event.modelId ?? "unknown",
    event.modelRevision ?? "unknown",
    event.modelProfileVersion ?? "unknown",
  ].join("@"));
  return Object.freeze({
    schemaVersion: "zhuwei-kp-tail-aggregate/v1",
    label,
    capture: Object.freeze({
      rawPayloadRetained: false,
      requestHeadersRetained: false,
      identifiersEmitted: false,
      modelEvents: modelEvents.length,
      contextEvents: contextEvents.length,
    }),
    modelBindings,
    proposal: Object.freeze({
      invocations: proposals.length,
      rootActions: roots.size,
      callsPerRootAction: roots.size === 0 ? null : proposals.length / roots.size,
      firstAttemptSuccess: ratio(firstSuccesses, firstAttempts.length),
      repairedRootActions: ratio(repairedRoots, roots.size),
      results: countBy(proposals, (event) => event.result),
      failures: countBy(proposalFailures, (event) => event.errorCode ?? event.result),
      durationMs: distribution(proposals.map((event) => event.durationMs)),
      inputTokens: distribution(proposals.map((event) => event.inputTokens)),
      outputTokens: distribution(proposals.map((event) => event.outputTokens)),
    }),
    narration: Object.freeze({
      invocations: narrations.length,
      results: countBy(narrations, (event) => event.result),
      failures: countBy(narrationFailures, (event) => event.errorCode ?? event.result),
      durationMs: distribution(narrations.map((event) => event.durationMs)),
      inputTokens: distribution(narrations.map((event) => event.inputTokens)),
      outputTokens: distribution(narrations.map((event) => event.outputTokens)),
    }),
    context: Object.freeze({
      preparations: contextEvents.length,
      fallback: ratio(contextFallbacks, contextEvents.length),
      plannerModes: countBy(contextEvents, (event) => event.plannerMode ?? "unknown"),
      plannerStatuses: countBy(contextEvents, (event) => event.plannerStatus ?? "unknown"),
      retrievalModes: countBy(contextEvents, (event) => event.retrievalMode ?? "unknown"),
      retrievalStatuses: countBy(contextEvents, (event) => event.retrievalStatus ?? "unknown"),
    }),
  });
}

function ratio(numerator, denominator) {
  return Object.freeze({
    numerator,
    denominator,
    rate: denominator === 0 ? null : numerator / denominator,
    wilson95: denominator === 0 ? null : wilson95(numerator, denominator),
  });
}

function wilson95(successes, total) {
  const z = 1.959963984540054;
  const p = successes / total;
  const scale = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / scale;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / scale;
  return Object.freeze({ low: Math.max(0, center - margin), high: Math.min(1, center + margin) });
}

function distribution(rawValues) {
  const values = rawValues.filter(Number.isFinite).sort((left, right) => left - right);
  if (values.length === 0) {
    return Object.freeze({ count: 0, min: null, p50: null, p95: null, max: null });
  }
  const at = (quantile) => values[Math.max(0, Math.ceil(values.length * quantile) - 1)];
  return Object.freeze({
    count: values.length,
    min: values[0],
    p50: at(0.50),
    p95: at(0.95),
    max: values.at(-1),
  });
}

function countBy(values, keyFor) {
  const counts = {};
  for (const value of values) {
    const key = keyFor(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.freeze(Object.fromEntries(Object.entries(counts).sort(([left], [right]) =>
    left.localeCompare(right))));
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

async function main() {
  const labelIndex = process.argv.indexOf("--label");
  const label = labelIndex >= 0 ? process.argv[labelIndex + 1] : "capture";
  const aggregator = createKpTelemetryTailAggregator(label);
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let emitted = false;
  const emit = () => {
    if (emitted) return;
    emitted = true;
    process.stdout.write(`${JSON.stringify(aggregator.report())}\n`);
  };
  process.on("SIGINT", () => { emit(); process.exit(0); });
  process.on("SIGTERM", () => { emit(); process.exit(0); });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      aggregator.ingestTailEnvelope(JSON.parse(line));
    } catch {
      // Tail transport noise is never emitted or retained.
    }
  }
  emit();
}

const invoked = process.argv[1] === undefined ? undefined : pathToFileURL(process.argv[1]).href;
if (invoked === import.meta.url) await main();
