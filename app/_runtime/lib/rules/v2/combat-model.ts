import type { CombatRuntimeState, JsonRecord } from "./model";

export function emptyCombatRuntime(): CombatRuntimeState {
  return {
    story: null,
    scenes: {},
    entities: {},
    definitions: {},
    encounters: {},
    effects: {},
    pendingInputs: {},
    randomnessResolutions: {},
  };
}

export function cloneJsonRecords(value: unknown): Record<string, JsonRecord> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("combat collection must be a record");
  }
  const result: Record<string, JsonRecord> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("combat collection entry must be a record");
    }
    result[key] = structuredClone(entry) as JsonRecord;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
