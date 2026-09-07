import { canonicalSha256 } from "../profiles/canonical";
import { COMBAT_ROUND_MICROS, combatMomentOffsetMicros } from "../profiles/fiction-time";
import type { AuthoritativeWorldState, JsonRecord } from "./model";
import { isNonEmptyString, isRecord } from "./validation";

/** Shared phase anchor for every source-based duration, SPEC 0013 §7.4. */
function initiativePhaseEntries(encounter: JsonRecord): JsonRecord[] {
  const order = Array.isArray(encounter.turnOrderEntityIds)
    ? encounter.turnOrderEntityIds.filter(isNonEmptyString)
    : [];
  const entries = isRecord(encounter.initiative) && Array.isArray(encounter.initiative.entries)
    ? encounter.initiative.entries.filter(isRecord)
    : [];
  return [...entries].sort((left, right) => {
    const leftMembers = Array.isArray(left.combatantEntityIds)
      ? left.combatantEntityIds.filter(isNonEmptyString)
      : [];
    const rightMembers = Array.isArray(right.combatantEntityIds)
      ? right.combatantEntityIds.filter(isNonEmptyString)
      : [];
    const leftIndex = leftMembers.reduce((minimum, id) => {
      const index = order.indexOf(id);
      return index < 0 ? minimum : Math.min(minimum, index);
    }, Number.POSITIVE_INFINITY);
    const rightIndex = rightMembers.reduce((minimum, id) => {
      const index = order.indexOf(id);
      return index < 0 ? minimum : Math.min(minimum, index);
    }, Number.POSITIVE_INFINITY);
    return leftIndex - rightIndex || String(left.entryId).localeCompare(String(right.entryId));
  });
}

export function initiativePhaseOrder(encounter: JsonRecord): {
  entries: JsonRecord[];
  initiativeOrderHash: string;
} {
  const entries = initiativePhaseEntries(encounter);
  return {
    entries,
    initiativeOrderHash: canonicalSha256(entries.map((entry) => ({
      entryId: String(entry.entryId),
      combatantEntityIds: Array.isArray(entry.combatantEntityIds)
        ? entry.combatantEntityIds.filter(isNonEmptyString)
        : [],
    }))),
  };
}

export function phaseSlotForEntity(entries: JsonRecord[], targetEntityId: string): number {
  return entries.findIndex((entry) => Array.isArray(entry.combatantEntityIds)
    && entry.combatantEntityIds.includes(targetEntityId));
}

export function combatPhaseExpiryAnchor(
  state: AuthoritativeWorldState,
  targetEntityId: string,
  edge: "turnStart" | "turnEnd",
  createdRootActionId: string,
): JsonRecord {
  const encounter = Object.values(state.combatRuntime.encounters).find((entry) =>
    entry.status !== "concluded" && Array.isArray(entry.participantEntityIds)
      && entry.participantEntityIds.includes(targetEntityId));
  if (encounter === undefined) return { kind: edge, entityId: targetEntityId };
  const { entries, initiativeOrderHash } = initiativePhaseOrder(encounter);
  const slotIndex = phaseSlotForEntity(entries, targetEntityId);
  const currentSlot = phaseSlotForEntity(entries, String(encounter.activeEntityId));
  if (entries.length === 0 || slotIndex < 0 || currentSlot < 0) {
    return { kind: edge, entityId: targetEntityId };
  }
  const currentRound = Number(encounter.round);
  const currentEdge = isRecord(encounter.combatMoment) && encounter.combatMoment.edge === "turnEnd"
    ? "turnEnd"
    : "turnStart";
  const phaseRemainsInCurrentRound = encounter.roundClosed !== true
    && (slotIndex > currentSlot
      || (slotIndex === currentSlot && currentEdge === "turnStart" && edge === "turnEnd"));
  return {
    kind: edge,
    entityId: targetEntityId,
    targetRound: currentRound + (phaseRemainsInCurrentRound ? 0 : 1),
    initiativeOrderHash,
    slotIndex,
    entryCount: entries.length,
    createdAt: {
      rootActionId: createdRootActionId,
      roundIndex: currentRound,
      initiativeOrderHash,
      slotIndex: currentSlot,
      edge: currentEdge,
    },
  };
}

/** Keep the remaining subject boundaries while an effect is suspended. The
 * microsecond remainder is used only if the Encounter ends during suspension. */
export function remainingCombatPhaseDuration(state: AuthoritativeWorldState, expiry: {
  encounterId: string; entityId: string; targetRound: number;
  slotIndex: number; entryCount: number; initiativeOrderHash: string;
  kind: "turnStart" | "turnEnd";
}): { remainingMicros: string; remainingBoundaries: number } | undefined {
  const encounter = state.combatRuntime.encounters[expiry.encounterId];
  if (encounter === undefined || encounter.status === "concluded") return undefined;
  const { entries, initiativeOrderHash } = initiativePhaseOrder(encounter);
  const currentSlot = phaseSlotForEntity(entries, String(encounter.activeEntityId));
  if (currentSlot < 0 || entries.length !== expiry.entryCount
    || initiativeOrderHash !== expiry.initiativeOrderHash) return undefined;
  const currentEdge = isRecord(encounter.combatMoment) && encounter.combatMoment.edge === "turnEnd"
    ? "turnEnd" : "turnStart";
  const closed = encounter.roundClosed === true;
  const currentOffset = closed ? COMBAT_ROUND_MICROS
    : combatMomentOffsetMicros(currentSlot, entries.length, currentEdge);
  const targetOffset = combatMomentOffsetMicros(expiry.slotIndex, expiry.entryCount, expiry.kind);
  const rounds = expiry.targetRound - Number(encounter.round);
  const remaining = BigInt(rounds) * COMBAT_ROUND_MICROS + targetOffset - currentOffset;
  const targetOrdinal = expiry.slotIndex * 2 + (expiry.kind === "turnEnd" ? 1 : 0);
  const currentOrdinal = closed ? entries.length * 2
    : currentSlot * 2 + (currentEdge === "turnEnd" ? 1 : 0);
  return {
    remainingMicros: (remaining > 0n ? remaining : 0n).toString(),
    remainingBoundaries: Math.max(0, rounds + (targetOrdinal > currentOrdinal ? 1 : 0)),
  };
}
