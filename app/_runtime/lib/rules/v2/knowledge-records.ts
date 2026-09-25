import type { AuthoritativeWorldState, KnowledgeRecord } from "./model";

/** A reference only confers the content actually stored for this holder. */
export function heldKnowledgeRecord(state: AuthoritativeWorldState, holder: string, ref: string): KnowledgeRecord | undefined {
  const records = Object.hasOwn(state.knowledge, holder) ? state.knowledge[holder] : undefined;
  const record = records && Object.hasOwn(records, ref) ? records[ref] : undefined;
  return record?.characterId === holder && record.knowledgeRef === ref ? record : undefined;
}

/** How many of a holder's latest rounds of play its decision view carries in
 * full (SPEC 0016 §4.2; the user's limit, ADR 0048). */
export const RECENT_MEMORY_ROUNDS = 6;

/** Learned through an event of the room's own history, as opposed to what the
 * module or a fixture gave the character before play began. Runtime events
 * are named `event:<runtime epoch>:<seq>`; genesis knowledge carries the id
 * of its authored source. */
export function acquiredInPlay(record: Readonly<Pick<KnowledgeRecord, "acquiredByEventId">>): boolean {
  return record.acquiredByEventId.startsWith("event:");
}

/** A round of play is one moment of the holder's fiction time at which it
 * perceived something, was told something or drew an inference; outside an
 * encounter every act advances the clock, and inside one the clock moves by
 * combat rounds. A world fact a story hands the holder is background it
 * knows, not a round it lived, so a story admitted mid-action never moves
 * the window. */
export function isRoundMemory(record: Readonly<Pick<KnowledgeRecord, "acquiredByEventId" | "objectKind" | "acquiredAtFictionMicros">>): boolean {
  return acquiredInPlay(record) && record.objectKind !== "canonicalFact" && /^(0|[1-9][0-9]*)$/u.test(record.acquiredAtFictionMicros);
}

/** The moments of the holder's latest rounds of play. */
export function recentMemoryRounds(records: Iterable<Readonly<Pick<KnowledgeRecord, "acquiredByEventId" | "objectKind" | "acquiredAtFictionMicros">>>,
  rounds: number = RECENT_MEMORY_ROUNDS): ReadonlySet<string> {
  const moments = new Set<string>();
  for (const record of records) if (isRoundMemory(record)) moments.add(record.acquiredAtFictionMicros);
  return new Set([...moments].sort((left, right) => {
    const a = BigInt(left), b = BigInt(right);
    return a < b ? 1 : a > b ? -1 : 0;
  }).slice(0, rounds));
}

/** A memory of an earlier round than the holder's latest ones. */
export function isPastRoundMemory(record: Readonly<Pick<KnowledgeRecord, "acquiredByEventId" | "objectKind" | "acquiredAtFictionMicros">>,
  recent: ReadonlySet<string>): boolean {
  return isRoundMemory(record) && !recent.has(record.acquiredAtFictionMicros);
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
