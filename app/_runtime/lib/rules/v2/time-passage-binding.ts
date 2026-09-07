import type { AuthoritativeWorldState, JsonRecord } from "./model";
import { isNonEmptyString, isRecord } from "./validation";

/** Only lifecycle events use this frozen timeline after movement/death. */
export function timePassageTimelineId(state: AuthoritativeWorldState, activity: JsonRecord | undefined): string | undefined {
  const completion = activity?.completion;
  return activity?.activityKind === "timePassage" && isRecord(completion) && completion.kind === "timePassage"
    && isNonEmptyString(completion.sourceTimelineId) && completion.sourceTimelineId in state.fictionTimelines
    ? completion.sourceTimelineId : undefined;
}

/** Sustained casting keeps its originating timeline through lifecycle changes. */
export function longSpellcastingTimelineId(state: AuthoritativeWorldState, activity: JsonRecord | undefined): string | undefined {
  const completion = activity?.completion;
  return activity?.activityKind === "longSpellcasting" && isRecord(completion) && completion.kind === "longSpellcasting"
    && isNonEmptyString(completion.sourceTimelineId) && completion.sourceTimelineId in state.fictionTimelines
    ? completion.sourceTimelineId : undefined;
}
