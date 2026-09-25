import { buildAuthoritativeArchive } from "../../../app/_runtime/lib/room/archive.ts";

/** Builds an archive the way the Room does: the head comes from the Room's own
 * replay of the same events, here a replay of the fixture's history. */
export async function archiveFromEvents({ roomId, signedGenesis, events, receiptRefs = [] }, replay) {
  const replayed = replay(signedGenesis, events);
  if (replayed.kind !== "replayed") throw new Error(`fixture history does not replay: ${replayed.rejection?.code}`);
  return buildAuthoritativeArchive({ roomId, signedGenesis, events, receiptRefs, head: {
    eventSeq: replayed.head.eventSeq, eventHash: replayed.head.eventHash,
    stateHash: replayed.head.stateHash, activeBranchId: replayed.state.activeBranchId,
  } });
}
