type ClueRoll = {
  clueId?: string;
  result?: { success?: boolean };
};

export function reconcileClueState({
  knownClueIds,
  previousIds,
  explicitIds,
  calledRolls,
  resolvedRolls,
  layers,
}: {
  knownClueIds: string[];
  previousIds: string[];
  explicitIds: string[];
  calledRolls: ClueRoll[];
  resolvedRolls: ClueRoll[];
  layers: Record<string, "talk" | "full">;
}) {
  const known = new Set(knownClueIds);
  const encountered = [
    ...explicitIds,
    ...calledRolls.map((roll) => roll.clueId),
    ...resolvedRolls.map((roll) => roll.clueId),
  ].filter((id): id is string => Boolean(id && known.has(id)));
  const revealedIds = [...new Set([...previousIds.filter((id) => known.has(id)), ...encountered])];
  const nextLayers = { ...layers };
  for (const id of previousIds) {
    if (known.has(id) && !nextLayers[id]) nextLayers[id] = "full";
  }
  for (const id of encountered) {
    if (!nextLayers[id]) nextLayers[id] = "talk";
  }
  for (const roll of resolvedRolls) {
    if (roll.clueId && known.has(roll.clueId) && roll.result?.success) {
      nextLayers[roll.clueId] = "full";
    }
  }
  const previous = new Set(previousIds);
  return {
    revealedIds,
    layers: nextLayers,
    newIds: revealedIds.filter((id) => !previous.has(id)),
  };
}

export function publicPendingRoll<T extends { clueId?: string; reason: string }>(
  roll: T,
): Omit<T, "clueId"> {
  const { clueId, ...publicRoll } = roll;
  return clueId
    ? { ...publicRoll, reason: "进一步确认眼前的细节。" }
    : publicRoll;
}
