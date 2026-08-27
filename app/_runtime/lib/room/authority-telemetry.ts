import type { RoomActionInput, RoomAuthorityCapability } from "./action";
import {
  buildRoomTelemetryEvent,
  type RoomTelemetryEvent,
} from "./telemetry";

type UnknownRecord = Record<string, unknown>;
type AuthorityOperation = NonNullable<RoomTelemetryEvent["authorityOperation"]>;
type AuthorityResult = NonNullable<RoomTelemetryEvent["authorityResult"]>;

export type RoomAuthorityTelemetryContext = {
  roomId: string;
  principalId: string;
  requestId?: string;
  submissionId?: string;
  clock?: () => number;
  emit(event: RoomTelemetryEvent): void;
};

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function callResult(value: unknown): AuthorityResult {
  return record(value)?.kind === "retryableFailure" ? "retryableFailure" : "completed";
}

function outcomeKind(operation: AuthorityOperation, value: unknown): string {
  const kind = stringValue(record(value)?.kind);
  if (kind !== undefined) return kind;
  return operation === "observe" ? "observed" : "completed";
}

function callFailure(value: unknown): unknown {
  const candidate = record(value);
  return candidate?.kind === "needsKp"
    ? { code: stringValue(candidate.code) ?? "mechanicalDiagnostic" }
    : candidate?.kind === "retryableFailure"
    ? { code: candidate.code }
    : candidate?.kind === "rejected" && typeof candidate.code === "string"
      ? { code: candidate.code }
      : undefined;
}

function receiptCorrelation(value: unknown): {
  receiptId?: string;
  rootActionId?: string;
  eventRange?: unknown;
} {
  const receipt = record(record(value)?.receipt);
  return {
    ...(stringValue(receipt?.receiptId) === undefined
      ? {}
      : { receiptId: stringValue(receipt?.receiptId) }),
    ...(stringValue(receipt?.rootActionId) === undefined
      ? {}
      : { rootActionId: stringValue(receipt?.rootActionId) }),
    ...(receipt?.eventRange === undefined ? {} : { eventRange: receipt.eventRange }),
  };
}

function emitSafely(
  emit: (event: RoomTelemetryEvent) => void,
  event: RoomTelemetryEvent,
) {
  try {
    emit(event);
  } catch {
    // Telemetry is evidence, never a second authority or a reason to change an
    // already obtained Room result.
  }
}

/**
 * Adds one fixed-schema SLO sample around each public Room Authority operation.
 * The wrapper never serializes arguments, return bodies, projections, or errors.
 */
export function withRoomAuthorityTelemetry(
  authority: RoomAuthorityCapability,
  context: RoomAuthorityTelemetryContext,
): RoomAuthorityCapability {
  const clock = context.clock ?? Date.now;

  const measure = async <T>(
    operation: AuthorityOperation,
    suppliedRootActionId: string | undefined,
    invoke: () => Promise<T>,
  ): Promise<T> => {
    const startedAt = clock();
    try {
      const value = await invoke();
      const endedAt = clock();
      const result = callResult(value);
      const receipt = receiptCorrelation(value);
      emitSafely(context.emit, buildRoomTelemetryEvent({
        occurredAt: new Date(endedAt).toISOString(),
        severity: result === "completed" ? "info" : "warn",
        eventName: `room.authority.${operation}.completed`,
        requestId: context.requestId,
        correlation: {
          roomId: context.roomId,
          principalId: context.principalId,
          submissionId: context.submissionId,
          rootActionId: receipt.rootActionId ?? suppliedRootActionId,
          receiptId: receipt.receiptId,
          eventRange: receipt.eventRange,
        },
        authority: { operation, result },
        outcome: { kind: outcomeKind(operation, value) },
        failure: callFailure(value),
        measurements: {
          operationKind: operation,
          durationMs: Math.max(0, Math.trunc(endedAt - startedAt)),
        },
      }));
      return value;
    } catch (error) {
      const endedAt = clock();
      emitSafely(context.emit, buildRoomTelemetryEvent({
        occurredAt: new Date(endedAt).toISOString(),
        severity: "error",
        eventName: `room.authority.${operation}.failed`,
        requestId: context.requestId,
        correlation: {
          roomId: context.roomId,
          principalId: context.principalId,
          submissionId: context.submissionId,
          rootActionId: suppliedRootActionId,
        },
        authority: { operation, result: "exception" },
        outcome: { kind: "retryableFailure" },
        failure: { code: "AUTHORITY_UNAVAILABLE" },
        measurements: {
          operationKind: operation,
          durationMs: Math.max(0, Math.trunc(endedAt - startedAt)),
        },
      }));
      throw error;
    }
  };

  return {
    prepare(principal: unknown, input: RoomActionInput) {
      return measure("prepare", undefined, () => authority.prepare(principal, input));
    },
    observe(principal: unknown, query?: unknown) {
      return measure("observe", undefined, () => authority.observe(principal, query));
    },
    commit(principal: unknown, preparedActionId: string, rulesInput: UnknownRecord) {
      return measure(
        "commit",
        stringValue(rulesInput.rootActionId),
        () => authority.commit(principal, preparedActionId, rulesInput),
      );
    },
    acknowledge(principal: unknown, deliveryId: string) {
      return measure("ack", undefined, () => authority.acknowledge(principal, deliveryId));
    },
    ...(authority.publishDelivery === undefined
      ? {}
      : {
          publishDelivery(authorization: unknown, publication: UnknownRecord) {
            return authority.publishDelivery!(authorization, publication);
          },
        }),
    ...(authority.deliveryPublicationStatus === undefined
      ? {}
      : {
          deliveryPublicationStatus(query: { publishCapability: unknown }) {
            return authority.deliveryPublicationStatus!(query);
          },
        }),
  };
}
