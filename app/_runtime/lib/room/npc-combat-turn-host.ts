import { canonicalHash, isPlainRecord } from "../kp/vnext/canonical-json";
import { NPC_COMBAT_TURN_TOOL_NAME, type NpcCombatTurnRequest } from "../kp/npc-combat-turn";
import type { AuthoritativeWorldState, EventEnvelope, RuntimeProfileManifest } from "../rules";
import type { NpcCombatTurnDue, NpcCombatTurnOptions, NpcCombatTurnStep } from "../rules/authority-read";

/** SPEC 0006 §§6、7: the Room's frame for an NPC's combat-turn decision. The
 * model sees the NPC's own viewer projection and the options Rules computed
 * for it; nothing from the KP's or another viewer's projection. */

export const NPC_COMBAT_TURN_BINDING_HASH = canonicalHash({
  // ADR 0117: the frame adds the NPC's stance, its words, yield and turn, and
  // what it saw of the fight so far.
  format: "zhuwei.npc-combat-turn-host/v3",
  tool: NPC_COMBAT_TURN_TOOL_NAME,
  projection: "rules-npc-viewer/v1",
  options: "rules-npc-combat-turn-options/v1",
  correction: "saved-invalid-plan-and-own-options-diagnostics",
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
  fightSoFar?: readonly NpcFightItem[];
}, runtime: { project(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState,
  viewer: { kind: "npc"; npcId: string; purpose: "kpDecision"; capability: "internal:npc-limited-knowledge" }): unknown }): NpcCombatTurnRequest | undefined {
  const projection = runtime.project(input.profiles, input.state, NPC_VIEWER(input.turn.npcId));
  const viewer = isPlainRecord(projection) && isPlainRecord(projection.viewer) ? projection.viewer : undefined;
  if (!isPlainRecord(projection) || projection.kind === "rejected" || viewer?.kind !== "npc" || viewer.subjectId !== input.turn.npcId) return undefined;
  return { preparedActionId: input.rootActionId, rootActionId: input.rootActionId, options: structuredClone(input.options),
    projection, fightSoFar: structuredClone([...input.fightSoFar ?? []]),
    ...(input.interruption === undefined ? {} : { interruption: structuredClone(input.interruption) }) };
}

const NPC_VIEWER = (npcId: string) => ({ kind: "npc" as const, npcId, purpose: "kpDecision" as const,
  capability: "internal:npc-limited-knowledge" as const });

/** SPEC 0006 §7, SPEC 0012 §3.3 (ADR 0117): how much of the fight an NPC is
 * told it saw and heard on its turn. A round of three or four creatures
 * makes some ten to fifteen items, so twenty cover the last round or two --
 * what a combatant reacts to: who struck whom and how hard, who went down,
 * who yielded or turned, what was said -- and the frame stays one size
 * however long the fight lasts (ADR 0115). Only the last acts are read for
 * it, which bounds the work as well. */
export const NPC_FIGHT_SO_FAR_ITEMS = 20;
export const NPC_FIGHT_SO_FAR_ROOTS = 10;
const NPC_FIGHT_ITEM_CHARACTERS = 240;
/** Bookkeeping a combatant does not need told again: whose turn began, the
 * order, who joined. */
const QUIET_OUTCOMES = new Set(["turnStarted", "initiativeRolled", "joinedEncounter", "surprised"]);

/** One thing the NPC saw or heard: who did it, to whom (refs as its options
 * name them) and what it was, in the words its own Viewer claims carry. */
export type NpcFightItem = { by?: string; to?: string[]; what: string };

function fightItem(claim: unknown): NpcFightItem | undefined {
  if (!isPlainRecord(claim) || !Array.isArray(claim.narrationFacts)) return undefined;
  // That an act was committed at all says nothing of what was seen.
  if (claim.kind === "actionCommitted" || (typeof claim.outcomeCode === "string" && QUIET_OUTCOMES.has(claim.outcomeCode))) return undefined;
  const by = claim.kind === "abilityEffectApplied" ? claim.sourceRef : claim.kind === "sourceClaim" ? claim.speakerRef : claim.actorRef;
  const to = Array.isArray(claim.targetRefs) ? claim.targetRefs.filter((ref): ref is string => typeof ref === "string") : [];
  const what = claim.narrationFacts.filter((fact): fact is string => typeof fact === "string").join("；").slice(0, NPC_FIGHT_ITEM_CHARACTERS);
  return what.length === 0 ? undefined : { ...(typeof by === "string" ? { by } : {}), ...(to.length === 0 ? {} : { to }), what };
}

type FightRuntime = {
  replay(genesis: unknown, events: unknown, options?: { observe?: (event: EventEnvelope, prior: AuthoritativeWorldState, next: AuthoritativeWorldState) => void }): unknown;
  project(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, viewer: unknown, query?: unknown): unknown;
};

/** The items one committed act gives an NPC: its Viewer claims of the act's
 * whole event range, between the states before and after it. */
export function npcFightItemsOfAct(input: { profiles: RuntimeProfileManifest; npcId: string; priorState: AuthoritativeWorldState;
  state: AuthoritativeWorldState; events: readonly EventEnvelope[]; receiptId: string; actorCharacterId: string }, runtime: FightRuntime): NpcFightItem[] {
  const projection = runtime.project(input.profiles, input.state, NPC_VIEWER(input.npcId), { committedRange: { receiptId: input.receiptId,
    actorCharacterId: input.actorCharacterId, priorState: input.priorState, events: [...input.events] } });
  const claims = isPlainRecord(projection) && isPlainRecord(projection.renderableClaims) && Array.isArray(projection.renderableClaims.claims)
    ? projection.renderableClaims.claims : [];
  return claims.flatMap(claim => { const item = fightItem(claim); return item === undefined ? [] : [item]; });
}

/** A memo of `npcFightItemsOfAct`, keyed by NPC and the act's last event.
 * Only a cache: what it holds is what the function returns for that act. */
export type NpcFightMemo = Map<string, NpcFightItem[]>;
export const npcFightMemoKey = (npcId: string, lastEventId: string) => `${npcId}\u001f${lastEventId}`;

/** SPEC 0006 §7, SPEC 0012 §3.3 (ADR 0117): what the NPC perceived of this
 * encounter so far, most recent first: the claims its own Viewer projection
 * draws from each of the last acts since the fight began -- the same
 * projection a player's reply is written from, so it holds nothing the NPC
 * could not perceive. Acts the memo lacks are read from one replay pass,
 * which gives the states around each act. */
export function npcFightSoFar(input: {
  profiles: RuntimeProfileManifest;
  genesis: unknown;
  events: readonly EventEnvelope[];
  npcId: string;
  encounterId: string;
  /** The character an act is told about, as its receipt records it. */
  actorOf: (receiptId: string, rootActionId: string, subjects: readonly string[]) => string | undefined;
  memo?: NpcFightMemo;
}, runtime: FightRuntime): NpcFightItem[] {
  const { events } = input;
  const start = events.findIndex(event => {
    const payload: unknown = event.payload;
    return event.eventType === "EncounterStarted" && isPlainRecord(payload) && isPlainRecord(payload.encounter)
      && payload.encounter.encounterId === input.encounterId;
  });
  if (start < 0) return [];
  const first = new Map<string, number>(), last = new Map<string, number>();
  events.forEach((event, index) => { if (!first.has(event.rootActionId)) first.set(event.rootActionId, index); last.set(event.rootActionId, index); });
  const roots = [...new Set(events.slice(start).map(event => event.rootActionId))]
    .sort((left, right) => last.get(left)! - last.get(right)!).slice(-NPC_FIGHT_SO_FAR_ROOTS);
  const memo = input.memo ?? new Map<string, NpcFightItem[]>();
  const keyOf = (root: string) => npcFightMemoKey(input.npcId, events[last.get(root)!]!.eventId);
  const missing = new Set(roots.filter(root => !memo.has(keyOf(root))));
  if (missing.size > 0) {
    const priors = new Map<string, AuthoritativeWorldState>();
    let index = -1;
    const replayed = runtime.replay(input.genesis, events, { observe(event, prior, next) {
      index += 1;
      const root = event.rootActionId;
      if (!missing.has(root)) return;
      if (index === first.get(root)) priors.set(root, prior);
      if (index !== last.get(root)) return;
      const before = priors.get(root), receipt = next.receipts[root];
      priors.delete(root);
      const actorCharacterId = receipt === undefined ? undefined : input.actorOf(receipt.receiptId, root, receipt.subjectCharacterIds);
      memo.set(keyOf(root), before === undefined || receipt === undefined || actorCharacterId === undefined ? []
        : npcFightItemsOfAct({ profiles: input.profiles, npcId: input.npcId, priorState: before, state: next,
          events: events.slice(first.get(root)!, index + 1), receiptId: receipt.receiptId, actorCharacterId }, runtime));
    } });
    if (!isPlainRecord(replayed) || replayed.kind !== "replayed") return [];
  }
  return roots.flatMap(root => memo.get(keyOf(root)) ?? []).slice(-NPC_FIGHT_SO_FAR_ITEMS).reverse();
}

export function takeNpcCombatTurnInput(rootActionId: string, turn: NpcCombatTurnDue, steps: readonly NpcCombatTurnStep[]) {
  return { kind: "takeNpcCombatTurn", proposalId: rootActionId, encounterId: turn.encounterId,
    sourceEntityId: turn.npcId, steps: structuredClone(steps) as NpcCombatTurnStep[] };
}
