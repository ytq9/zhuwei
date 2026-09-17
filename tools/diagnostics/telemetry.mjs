import { buildRoomTelemetryEvent } from "../../app/_runtime/lib/room/telemetry.ts";
import { diagnosticReference, diagnosticReferenceTime } from "../../app/_runtime/lib/platform/diagnostic-reference.ts";

const HASH = /^sha256:[a-f0-9]{64}$/;
const HASH_FIELDS = ["requestId", "rootActionHash", "submissionHash", "receiptHash"];
const TEXT_FIELDS = ["eventName", "severity", "outcomeKind", "errorCode", "failureClass", "failureReason", "failureStage",
  "failureRetryability", "authorityOperation", "authorityResult", "modelTask", "modelResult", "modelStage",
  "modelInvocationPurpose", "modelGroundingReason", "archiveFailureStage", "archiveFailureCode"];
const NUMBER_FIELDS = ["httpStatus", "providerStatus", "durationMs", "modelInputTokens", "modelOutputTokens"];
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function referenceHash(reference) {
  if (!diagnosticReference(reference)) throw new Error("故障编号格式无效。");
  return buildRoomTelemetryEvent({ requestId: reference }).requestId;
}

export function diagnosticTimeframe({ reference, at, minutes = 10 }) {
  const center = reference ? diagnosticReferenceTime(reference) : Date.parse(at);
  if (!Number.isFinite(center) || !Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
    throw new Error("提供故障编号或带时区的 --at 时间；--minutes 必须为 1–60。");
  }
  return { from: Math.max(0, center - minutes * 60_000), to: center + minutes * 60_000 };
}

/** SPEC 0011 §5: select fixed non-content fields; never export raw Cloudflare
 * events, URLs, headers, stacks, messages, identifiers or model payloads. */
export function safeTelemetry(value) {
  if (!record(value) || value.schemaVersion !== "zhuwei.room-telemetry/v1") return undefined;
  const result = {};
  if (typeof value.occurredAt === "string" && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value.occurredAt)) result.occurredAt = value.occurredAt;
  for (const key of HASH_FIELDS) if (typeof value[key] === "string" && HASH.test(value[key])) result[key] = value[key];
  for (const key of TEXT_FIELDS) if (typeof value[key] === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/.test(value[key])) result[key] = value[key];
  for (const key of NUMBER_FIELDS) if (Number.isFinite(value[key]) && value[key] >= 0) result[key] = value[key];
  return result;
}

// Handles structured sources and the JSON string emitted by console.info.
export function telemetryIn(value, depth = 0) {
  if (depth > 6) return [];
  if (typeof value === "string") {
    try { return telemetryIn(JSON.parse(value), depth + 1); } catch { return []; }
  }
  if (Array.isArray(value)) return value.flatMap(entry => telemetryIn(entry, depth + 1));
  if (!record(value)) return [];
  if (value.format === "zhuwei.diagnostic-report/v1" && Array.isArray(value.timeline)) {
    return value.timeline.flatMap(row => {
      const safe = safeTelemetry({ ...row, schemaVersion: "zhuwei.room-telemetry/v1" });
      return safe ? [safe] : [];
    });
  }
  const safe = safeTelemetry(value);
  if (safe) return [safe];
  return ["source", "message", "logs"].flatMap(key => telemetryIn(value[key], depth + 1));
}

export function parseDocuments(text) {
  const values = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (start < 0) { if (char === "{" || char === "[") { start = i; depth = 1; } continue; }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) {
        try { values.push(JSON.parse(text.slice(start, i + 1))); } catch { /* Non-JSON CLI banners are not evidence. */ }
        start = -1;
      }
    }
  }
  return { values, remainder: start < 0 ? "" : text.slice(start) };
}

export function relatedTimeline(events, reference) {
  const expand = value => Array.isArray(value) ? value.flatMap(expand)
    : value?.format === "zhuwei.diagnostic-report/v1" ? (value.timeline ?? []).map(row => ({ ...row, schemaVersion: "zhuwei.room-telemetry/v1" })) : [value];
  const groups = events.flatMap(expand).map(value => telemetryIn(value));
  const clean = groups.flat();
  let selected = clean;
  if (reference) {
    const target = referenceHash(reference), matched = new Set(clean.filter(row => row.requestId === target));
    // Follow only submission/root/receipt identities, never room or principal.
    for (let pass = 0; pass < 3; pass++) {
      const hashes = new Set([...matched].flatMap(row => HASH_FIELDS.map(key => row[key]).filter(Boolean)));
      for (const row of clean) if (HASH_FIELDS.some(key => hashes.has(row[key]))) matched.add(row);
      for (const group of groups) if (group.some(row => matched.has(row))) for (const row of group) matched.add(row);
    }
    selected = [...matched];
  }
  return [...new Map(selected.map(row => [JSON.stringify(row), row])).values()]
    .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
}

export function diagnosticReport(timeline, { reference, timeframe, source, truncated = false }) {
  return { format: "zhuwei.diagnostic-report/v1", source, reference, timeframe,
    status: truncated ? "partial" : timeline.length ? "found" : "no_matching_events",
    notice: truncated ? "已到达查询上限，结果不完整。" : timeline.length ? undefined
      : "未找到匹配记录；可能尚未入库、已过保留期、未被采样，或请求未到达服务端。不能据此判断行动未执行。",
    timeline };
}
