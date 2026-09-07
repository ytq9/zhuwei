import type { AuthoritativeWorldState, JsonRecord } from "./model";

/** Shared read-only encounter membership; does not invoke combat settlement. */
export function activeEncounter(state: AuthoritativeWorldState, sourceId: string): JsonRecord | undefined {
  return Object.values(state.combatRuntime.encounters).find(encounter => encounter.status !== "concluded"
    && Array.isArray(encounter.participantEntityIds) && encounter.participantEntityIds.includes(sourceId));
}
