import { canonicalSha256 } from "../rules/profiles/canonical";

function requiredId(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("A nonempty trusted identity is required.");
  }
  return value;
}

/** Same authenticated submission always addresses the same target, including
 * retries after a lost response or a failed directory publication. */
export function storyHistoricalTargetRoomId(principalId: string, submissionId: string): string {
  const digest = canonicalSha256({
    domain: "zhuwei.story-historical-room/v1",
    principalId: requiredId(principalId),
    submissionId: requiredId(submissionId),
  }).slice("sha256:".length);
  return `room:history:${digest}`;
}

/** New identities are room scoped. Existing rooms must read their persisted
 * control/seat mappings instead of reconstructing or renaming those IDs. */
export function storyRoomIdentityIds(roomId: string, principalId: string): Readonly<{
  characterId: string;
  seatId: string;
}> {
  const digest = canonicalSha256({
    domain: "zhuwei.room-identity/v1",
    roomId: requiredId(roomId),
    principalId: requiredId(principalId),
  }).slice("sha256:".length);
  return { characterId: `character:room:${digest}`, seatId: `seat:room:${digest}` };
}
