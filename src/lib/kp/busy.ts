export const KP_BUSY_MS = 45_000;

export function readBusyPlaces(
  flags: Record<string, unknown>,
): Record<string, number> {
  const raw = flags.kpBusyPlaces;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [place, at] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(at);
    if (place && Number.isFinite(n)) out[place] = n;
  }
  return out;
}

export function isPlaceBusy(flags: Record<string, unknown>, place: string) {
  const at = readBusyPlaces(flags)[place];
  if (!at) return false;
  return Date.now() - at < KP_BUSY_MS;
}

export function anyPlaceBusy(flags: Record<string, unknown>) {
  const now = Date.now();
  return Object.values(readBusyPlaces(flags)).some((at) => now - at < KP_BUSY_MS);
}

export function sweepBusyPlaces(flags: Record<string, unknown>) {
  const busy = readBusyPlaces(flags);
  const now = Date.now();
  let changed = false;
  for (const [place, at] of Object.entries(busy)) {
    if (now - at >= KP_BUSY_MS) {
      delete busy[place];
      changed = true;
    }
  }
  if (changed) flags.kpBusyPlaces = busy;
  return changed;
}
