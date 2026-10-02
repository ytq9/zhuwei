import { compareCodeUnits, isPlainRecord } from "./canonical-json";

// SPEC 0001 §19 (ADR 0083): the questions the acting character's earlier
// actions asked and had answered, as Room recorded them. The selection may not
// ask again about a ruling already asked about, nor about a ruling an answered
// action made. Room freezes this with the action's context, so the Adapter and
// Room read the same history; the model is not sent it.

export const VNEXT_RETRY_HISTORY_SCHEMA = "zhuwei.retry-question-history/v1" as const;

export type VNextRetryHistory = Readonly<{
  /** The rulings questions named: conversation threads and precedent ids. */
  askedRefs: readonly string[];
  /** The roots of the actions that asked and then ruled on the answer. */
  answeredRootActionIds: readonly string[];
}>;

export function retryHistoryEntryRef(actorRef: string): string {
  return `retry-history:${actorRef}`;
}

export function isRetryHistoryEntryRef(entryRef: string): boolean {
  return entryRef.startsWith("retry-history:");
}

/** The frozen value, or undefined when no question was ever answered. */
export function retryHistoryValue(actorRef: string, history: VNextRetryHistory | undefined) {
  if (history === undefined || (history.askedRefs.length === 0 && history.answeredRootActionIds.length === 0)) return undefined;
  const sorted = (values: readonly string[]) => [...new Set(values)].sort(compareCodeUnits);
  return { schema: VNEXT_RETRY_HISTORY_SCHEMA, actorRef, askedRefs: sorted(history.askedRefs),
    answeredRootActionIds: sorted(history.answeredRootActionIds) };
}

/** The history a context froze for its actor; empty when it froze none. */
export function frozenRetryHistory(entries: readonly unknown[], actorRef: string): VNextRetryHistory {
  for (const entry of entries) {
    if (!isPlainRecord(entry) || entry.kind !== "known" || entry.entryRef !== retryHistoryEntryRef(actorRef)) continue;
    const value = entry.value;
    if (isPlainRecord(value) && value.schema === VNEXT_RETRY_HISTORY_SCHEMA && value.actorRef === actorRef
      && Array.isArray(value.askedRefs) && Array.isArray(value.answeredRootActionIds)) {
      return { askedRefs: value.askedRefs.filter((ref): ref is string => typeof ref === "string"),
        answeredRootActionIds: value.answeredRootActionIds.filter((ref): ref is string => typeof ref === "string") };
    }
  }
  return { askedRefs: [], answeredRootActionIds: [] };
}

/** Whether a record was made by an action that answered a question. An action
 * that took fictional time records its results under its completion root. */
export function madeByAnsweredAction(rootActionId: unknown, history: VNextRetryHistory): boolean {
  if (typeof rootActionId !== "string") return false;
  const bare = rootActionId.startsWith("activity-result:") ? rootActionId.slice("activity-result:".length) : rootActionId;
  return history.answeredRootActionIds.includes(bare);
}
