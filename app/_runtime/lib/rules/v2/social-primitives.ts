import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState, CharacterRecord, FrozenCheck } from "./model";
import { characterTimelineId } from "./timeline";

export function normalizedSocialUtterance(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\p{P}\p{S}\p{Z}]+/gu, "");
}

export function socialUtteranceFingerprint(value: string): string {
  return canonicalSha256({ utterance: normalizedSocialUtterance(value) });
}

/** Same place is insufficient while split-party causal timelines have not
 * explicitly rejoined. Social exchange and hearing require both conditions. */
export function socialParticipantsCoPresent(
  state: AuthoritativeWorldState,
  left: CharacterRecord,
  right: CharacterRecord,
): boolean {
  if (left.sceneId !== right.sceneId) return false;
  const leftTimelineId = characterTimelineId(state, left.id);
  const rightTimelineId = characterTimelineId(state, right.id);
  return leftTimelineId !== undefined && leftTimelineId === rightTimelineId;
}

/** A retry method is the mechanical approach plus the normalized fictional
 * method. Punctuation-only rewrites and restating the same speech do not open
 * another roll, while a genuinely different described approach can. */
export function socialMethodFingerprint(
  value: Pick<FrozenCheck, "ability" | "skill" | "method">,
): string {
  return canonicalSha256({
    ability: value.ability,
    skill: value.skill,
    method: normalizedSocialUtterance(value.method),
  });
}
