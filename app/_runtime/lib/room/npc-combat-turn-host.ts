import { canonicalHash, isPlainRecord } from "../kp/vnext/canonical-json";
import { NPC_COMBAT_TURN_TOOL_NAME, type NpcCombatTurnRequest } from "../kp/npc-combat-turn";
import type { AuthoritativeWorldState, EventEnvelope, RuntimeProfileManifest } from "../rules";
import type { NpcCombatTurnDue, NpcCombatTurnOptions, NpcCombatTurnStep } from "../rules/authority-read";

/** SPEC 0006 §§6、7: the Room's frame for an NPC's combat-turn decision. The
 * model sees the NPC's own viewer projection and the options Rules computed
 * for it; nothing from the KP's or another viewer's projection. */

export const NPC_COMBAT_TURN_BINDING_HASH = canonicalHash({
  format: "zhuwei.npc-combat-turn-host/v1",
  tool: NPC_COMBAT_TURN_TOOL_NAME,
  projection: "rules-npc-viewer/v1",
  options: "rules-npc-combat-turn-options/v1",
  transport: "deepseek-strict-tool/v1",
});

/** Distinct calls for the same uncommitted turn segment, each on its own
 * ordinal; a call whose outcome is unknown is never sent again. */
export const NPC_COMBAT_TURN_MAX_ATTEMPTS = 10;

/** How many NPC turns one request's due tail decides before it stops. */
export const NPC_COMBAT_TURNS_PER_REQUEST = 6;

/** The earlier plan of this same turn and where it stopped, read from the
 * events of the previous segment's root. */
export function npcCombatTurnInterruption(previousRootEvents: readonly EventEnvelope[]): NpcCombatTurnRequest["interruption"] {
  const planned: unknown = previousRootEvents.find(event => event.eventType === "NpcCombatTurnPlanned")?.payload;
  const settled: unknown = previousRootEvents.find(event => event.eventType === "NpcCombatTurnSettled")?.payload;
  if (!isPlainRecord(planned) || !isPlainRecord(settled) || settled.outcome !== "stopped"
    || !Array.isArray(planned.steps) || typeof settled.stoppedAtStep !== "number" || typeof settled.reason !== "string") return undefined;
  return { stoppedPlan: structuredClone(planned.steps) as NpcCombatTurnStep[], stoppedAtStep: settled.stoppedAtStep, reason: settled.reason };
}

export function previousNpcCombatTurnRoot(rootActionId: string, turn: NpcCombatTurnDue): string | undefined {
  const segment = Number(turn.segment);
  if (!Number.isSafeInteger(segment) || segment < 1 || !rootActionId.endsWith(`:${turn.segment}`)) return undefined;
  return `${rootActionId.slice(0, rootActionId.length - turn.segment.length)}${segment - 1}`;
}

export function npcCombatTurnRequest(input: {
  state: AuthoritativeWorldState;
  profiles: RuntimeProfileManifest;
  rootActionId: string;
  turn: NpcCombatTurnDue;
  options: NpcCombatTurnOptions;
  interruption?: NpcCombatTurnRequest["interruption"];
}, runtime: { project(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState,
  viewer: { kind: "npc"; npcId: string; purpose: "kpDecision"; capability: "internal:npc-limited-knowledge" }): unknown }): NpcCombatTurnRequest | undefined {
  const projection = runtime.project(input.profiles, input.state, {
    kind: "npc", npcId: input.turn.npcId, purpose: "kpDecision", capability: "internal:npc-limited-knowledge",
  });
  const viewer = isPlainRecord(projection) && isPlainRecord(projection.viewer) ? projection.viewer : undefined;
  if (!isPlainRecord(projection) || projection.kind === "rejected" || viewer?.kind !== "npc" || viewer.subjectId !== input.turn.npcId) return undefined;
  return { preparedActionId: input.rootActionId, rootActionId: input.rootActionId, options: structuredClone(input.options),
    projection, ...(input.interruption === undefined ? {} : { interruption: structuredClone(input.interruption) }) };
}

export function takeNpcCombatTurnInput(rootActionId: string, turn: NpcCombatTurnDue, steps: readonly NpcCombatTurnStep[]) {
  return { kind: "takeNpcCombatTurn", proposalId: rootActionId, encounterId: turn.encounterId,
    sourceEntityId: turn.npcId, steps: structuredClone(steps) as NpcCombatTurnStep[] };
}
