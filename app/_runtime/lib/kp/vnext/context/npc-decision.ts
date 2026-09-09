import type { RuntimeProfileManifest } from "../../../rules/profiles/types";
import type { AuthoritativeWorldState } from "../../../rules/authority-read";
import { freezeNpcDecisionEntry as freezeRulesNpcDecisionEntry } from "../../../rules/v2/npc-decision-context";
import type { RequiredContextEntry } from "../required-context";

export { NPC_DECISION_CONTEXT_SCHEMA, npcDecisionContext, npcDecisionEntryRef, npcDecisionEvidenceRef,
  type NpcDecisionRecord, type NpcDecisionContext } from "../../../rules/v2/npc-decision-context";

/** Adapt the Rules-owned immutable snapshot into the KP context entry union. */
export function freezeNpcDecisionEntry(state: AuthoritativeWorldState, profiles: RuntimeProfileManifest,
  npcRef: string, projection: unknown, entries: readonly RequiredContextEntry[]): RequiredContextEntry {
  return freezeRulesNpcDecisionEntry(state, profiles, npcRef, projection, entries) as unknown as RequiredContextEntry;
}
