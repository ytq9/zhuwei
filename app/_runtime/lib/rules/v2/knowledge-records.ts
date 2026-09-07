import type { AuthoritativeWorldState, KnowledgeRecord } from "./model";

/** A reference only confers the content actually stored for this holder. */
export function heldKnowledgeRecord(state: AuthoritativeWorldState, holder: string, ref: string): KnowledgeRecord | undefined {
  const records = Object.hasOwn(state.knowledge, holder) ? state.knowledge[holder] : undefined;
  const record = records && Object.hasOwn(records, ref) ? records[ref] : undefined;
  return record?.characterId === holder && record.knowledgeRef === ref ? record : undefined;
}

export function knowledgeLayerCanBeShared(source: KnowledgeRecord["layer"], requested: KnowledgeRecord["layer"]): boolean {
  // This existing operation copies exact content. A different layer needs an
  // explicitly authored expression, which this input does not supply.
  return ["hint", "partial", "full"].includes(source) && requested === source;
}

/** Possession only grants held content. The separately authorized NPC
 * decision projection may additionally remember that NPC's own claim origin;
 * hearing or forwarding somebody else's claim never grants their motive. */
export function projectHeldSourceClaims(state: AuthoritativeWorldState, holder: string, viewerKind: "player" | "npc" = "player") {
  return Object.values(state.campaignRuntime.sourceClaims).flatMap(claim => {
    if (typeof claim.claimId !== "string") return [];
    const record = heldKnowledgeRecord(state, holder, claim.claimId);
    if (record?.objectKind !== "sourceClaim") return [];
    return [{ claimId: record.knowledgeRef, semanticContent: structuredClone(record.content), layer: record.layer,
      sourceCharacterId: record.sourceCharacterId, acquiredAtFictionMicros: record.acquiredAtFictionMicros,
      truthStatus: "unresolved",
      ...(claim.speakerId === holder || record.sourceCharacterId === claim.speakerId ? { speakerId: claim.speakerId } : {}),
      ...(viewerKind === "npc" && state.entities[holder]?.kind === "npc" && claim.speakerId === holder
        ? { ownOrigin: { sourceBasis: claim.sourceBasis, motive: claim.motive, formedAtFictionMicros: claim.formedAtFictionMicros } }
        : {}),
    }];
  }).sort((a, b) => a.claimId.localeCompare(b.claimId));
}
