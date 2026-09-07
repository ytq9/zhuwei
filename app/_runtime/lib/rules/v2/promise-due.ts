import type { AuthoritativeWorldState } from "./model";
import { FICTION_DAWN_OFFSET_MICROS, FICTION_DAY_MICROS } from "../profiles/fiction-time";

/** When a promised act must happen, as one coarse tier the KP picks at
 * promise time. "none" keeps the promise in context only: the world will not
 * act on it by itself. The set is extensible; every tier maps to a duration
 * from the promise instant on the promisor's timeline. */
export const PROMISE_DUE_TIERS = Object.freeze(["none", "1h", "halfDay", "day", "nextDawn"] as const);
export type PromiseDueTier = typeof PROMISE_DUE_TIERS[number];
const FIXED_TIERS: Readonly<Record<string, string>> = Object.freeze({
  "1h": "3600000000", halfDay: "43200000000", day: "86400000000",
});

export function isPromiseDueTier(value: unknown): value is PromiseDueTier {
  return typeof value === "string" && (PROMISE_DUE_TIERS as readonly string[]).includes(value);
}

/** The campaign may pin what time of day its clock origin is; midnight by default. */
function clockOriginTimeOfDayMicros(state: AuthoritativeWorldState): bigint {
  const campaign = state.campaignRuntime.campaign;
  const clock = campaign !== null && typeof campaign === "object" && campaign.fictionClock !== null
    && typeof campaign.fictionClock === "object" ? campaign.fictionClock as Record<string, unknown> : undefined;
  const origin = clock?.originTimeOfDayMicros;
  return typeof origin === "string" && /^(0|[1-9][0-9]*)$/u.test(origin) ? BigInt(origin) % FICTION_DAY_MICROS : 0n;
}

/** Positive microseconds until the tier's deadline; undefined for "none". */
export function promiseDueDurationMicros(state: AuthoritativeWorldState, timelineId: string, due: PromiseDueTier): string | undefined {
  if (due === "none") return undefined;
  if (due in FIXED_TIERS) return FIXED_TIERS[due];
  const timeline = state.fictionTimelines[timelineId];
  if (timeline === undefined) return undefined;
  const timeOfDay = (BigInt(timeline.nowMicros) + clockOriginTimeOfDayMicros(state)) % FICTION_DAY_MICROS;
  // Exactly at dawn, "next dawn" is tomorrow's.
  const untilDawn = timeOfDay < FICTION_DAWN_OFFSET_MICROS
    ? FICTION_DAWN_OFFSET_MICROS - timeOfDay
    : FICTION_DAY_MICROS - timeOfDay + FICTION_DAWN_OFFSET_MICROS;
  return untilDawn.toString();
}
