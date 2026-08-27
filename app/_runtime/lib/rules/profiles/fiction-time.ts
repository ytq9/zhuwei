import type { CanonicalProfileDocument, ProfileRef } from "./types";

export const FICTION_COMBAT_TIME_PROFILE = {
  profileId: "combat-round-six-seconds-2014-v1",
  profileHash: "sha256:067eb4870fcee1cda2563c7633daac4c2b7249ecd53e0f9b1c986d3de8d12f08",
} as const satisfies ProfileRef;

export const FICTION_COMBAT_TIME_PROFILE_DOCUMENT: CanonicalProfileDocument = {
  schema: "zhuwei.runtime-profile/v1",
  profileKind: "fictionCombatTime",
  profileId: FICTION_COMBAT_TIME_PROFILE.profileId,
  semanticVersion: "1.0.0",
  normativePayload: {
    conformanceVersion: "1",
    spec: "SPEC 0013",
    authorityUnit: "integer-microsecond",
    timeline: "per-fiction-branch",
    combatRoundMicros: "6000000",
    combatAdvance: "once-per-closed-round",
    combatMoment: "round-index-initiative-order-hash-slot-index-turn-edge",
    encounterConclusion: "close-current-round-once-and-freeze-phase-tasks",
    residualPhaseMapping: "saved-entry-count-slot-edge-and-target-round",
    residualPhaseOrder: "due-instant-then-initiative-slot-edge-effect-id",
    residualPhaseEffect: "expire-effect-only-no-combat-action-grants",
    realTimeEffect: "none",
    timeoutEffect: "none",
  },
};

export const COMBAT_ROUND_MICROS = 6_000_000n;
export const MAX_INITIATIVE_ENTRIES = 4_096;

export function combatMomentOffsetMicros(
  slotIndex: number,
  entryCount: number,
  edge: "turnStart" | "turnEnd",
): bigint {
  if (!Number.isSafeInteger(slotIndex) || !Number.isSafeInteger(entryCount)
    || entryCount < 1 || entryCount > MAX_INITIATIVE_ENTRIES
    || slotIndex < 0 || slotIndex >= entryCount) {
    throw new TypeError("combat moment is outside the pinned time profile");
  }
  const numerator = BigInt(edge === "turnStart" ? slotIndex : slotIndex + 1);
  return (COMBAT_ROUND_MICROS * numerator) / BigInt(entryCount);
}

export function encounterEntryLimitDiagnostic(entryCount: number): string | undefined {
  return entryCount > MAX_INITIATIVE_ENTRIES
    ? "An Encounter supports at most 4096 initiative entries; group similar combatants into mechanically justified shared initiative entries."
    : undefined;
}
