import { buildRoomTelemetryEvent } from "../room/telemetry";
import { createDiagnosticReference, diagnosticReference, diagnosticReferenceTime, DIAGNOSTIC_HEADER } from "./diagnostic-reference";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** SPEC 0011 §5: bridge one HTTP attempt to the existing submission/receipt
 * hashes. No extra storage, request bodies, error messages or KP content. */
export function gameRequestDiagnostics(request: Request) {
  const supplied = diagnosticReference(request.headers.get(DIAGNOSTIC_HEADER));
  const startedAt = Date.now();
  const reference = supplied && Math.abs(diagnosticReferenceTime(supplied) - startedAt) <= 86_400_000
    ? supplied : createDiagnosticReference(startedAt);
  const readCommands = new Set(["fetchTable", "getCatalog", "getRoomManagement", "listMyRooms", "listHistoricalStarts", "exportStoryHistoryPage"]);
  function emit(command: string, phase: "started" | "completed", userId: string, data: unknown, result?: unknown) {
    const response = record(result), receipt = record(record(response?.outcome)?.receipt);
    const failed = response?.ok === false || typeof response?.error === "string"
      || response?.kind === "rejected" || response?.action === "notCommitted";
    if (readCommands.has(command) && !failed) return;
    try {
      console.info(JSON.stringify(buildRoomTelemetryEvent({
        requestId: reference, occurredAt: new Date().toISOString(),
        eventName: `http.game.${phase}`, severity: failed ? "warn" : "info",
        correlation: { principalId: userId,
          submissionId: response?.submissionId ?? record(data)?.submissionId,
          rootActionId: receipt?.rootActionId, receiptId: receipt?.receiptId },
        outcome: { kind: response?.outcomeKind ?? response?.action ?? response?.kind ?? (failed ? "rejected" : phase) },
        failure: failed ? { code: response?.code } : undefined,
        measurements: { durationMs: Date.now() - startedAt },
      })));
    } catch { /* Telemetry must not change gameplay or retries. */ }
  }
  return {
    reference,
    started(command: string, userId: string, data: unknown) { emit(command, "started", userId, data); },
    completed(command: string, userId: string, data: unknown, result: unknown) { emit(command, "completed", userId, data, result); },
    response(response: Response) { response.headers.set(DIAGNOSTIC_HEADER, reference); return response; },
  };
}
