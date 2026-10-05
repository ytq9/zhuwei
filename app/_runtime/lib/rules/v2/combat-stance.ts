import { combatEndIssues } from "./combat-end";
import { authorityReadSetMatches } from "./authority-bindings";
import { stepCombatWorld } from "./combat-actions";
import { activeEncounter, canStillFight, encounterConclusionReason, encounterFightIsOver, encounterHostileTargets, encounterLivingPlayers } from "./combat-encounters";
import { scopeOf } from "./events";
import { continueCompoundRoot } from "./internal-compound";
import type { AuthoritativeWorldState, JsonRecord, RuleDiagnostic, StepResult } from "./model";
import { rejected } from "./results";
import { hasExactKeys, isNonEmptyString, isRecord, isSha256 } from "./validation";
import { isCanonicalReadSet, type VersionedAuthorityBinding } from "./world-interaction-model";
import type { RuntimeProfileManifest } from "../profiles/types";

/** SPEC 0006 §7, SPEC 0012 §§3.3、13 (ADR 0117): an NPC's combat stance in its
 * own reply to words said to it in a fight. Hearing the speaker, the NPC it
 * is fighting may yield to the speaker's side, accept the speaker's
 * surrender, or agree to a truce; one not fighting the speaker may turn on
 * it. Rules records the NPC's own hostility change; when no one hostile to
 * the players can still fight after it, the end is put to them at once. */
export const NPC_COMBAT_STANCE_PLAN_SCHEMA = "zhuwei.npc-combat-stance-plan/vnext-1" as const;
export const NPC_COMBAT_STANCES = ["yield", "acceptSurrender", "truce", "turnOn"] as const;
export type NpcCombatStance = typeof NPC_COMBAT_STANCES[number];
/** What a reply may answer, by whether the NPC is fighting the speaker. The
 * first of each is no change. */
export const NPC_REPLY_STANCES_FIGHTING = ["keepFighting", "yield", "acceptSurrender", "truce"] as const;
export const NPC_REPLY_STANCES_NOT_FIGHTING = ["stayOut", "turnOn"] as const;
/** The reason each stance gives its hostility change and the end it puts to the players. */
const REASONS: Readonly<Record<NpcCombatStance, string>> = {
  yield: "npcSurrendered", acceptSurrender: "playersSurrendered", truce: "truceAgreed", turnOn: "npcTurnedHostile",
};

export type NpcCombatStancePlan = Readonly<{
  schema: typeof NPC_COMBAT_STANCE_PLAN_SCHEMA; contextHash: string;
  readSet: readonly VersionedAuthorityBinding[];
  npcRef: string; speakerRef: string; stance: NpcCombatStance | "unchanged";
  playerStopsFightingRefs?: readonly string[];
}>;

export function isNpcCombatStance(value: unknown): value is NpcCombatStance {
  return (NPC_COMBAT_STANCES as readonly unknown[]).includes(value);
}

export function isNpcCombatStancePlan(value: unknown): value is NpcCombatStancePlan {
  return isRecord(value) && hasExactKeys(value, ["contextHash", "npcRef", "readSet", "schema", "speakerRef", "stance", ...(value.playerStopsFightingRefs === undefined ? [] : ["playerStopsFightingRefs"])])
    && value.schema === NPC_COMBAT_STANCE_PLAN_SCHEMA && isSha256(value.contextHash) && isCanonicalReadSet(value.readSet)
    && isNonEmptyString(value.npcRef) && isNonEmptyString(value.speakerRef) && value.npcRef !== value.speakerRef
    && (value.playerStopsFightingRefs === undefined || Array.isArray(value.playerStopsFightingRefs)
      && value.playerStopsFightingRefs.length > 0 && value.playerStopsFightingRefs.length <= 24
      && value.playerStopsFightingRefs.every(isNonEmptyString) && new Set(value.playerStopsFightingRefs).size === value.playerStopsFightingRefs.length)
    && (isNpcCombatStance(value.stance) || value.stance === "unchanged" && Array.isArray(value.playerStopsFightingRefs));
}

/** A problem with the stance against authority. */
export type NpcCombatStanceIssue = Readonly<{ constraint: string; expected: Readonly<Record<string, unknown>> }>;

/** Whom the NPC fights after the stance, or the issues that stop it. */
function resolveStance(state: AuthoritativeWorldState, npcRef: string, speakerRef: string, stance: NpcCombatStance | "unchanged"):
  Readonly<{ issues: readonly NpcCombatStanceIssue[]; encounter?: JsonRecord; targets?: string[] }> {
  const encounter = activeEncounter(state, npcRef);
  if (encounter === undefined || state.entities[npcRef]?.kind !== "npc"
    || !(encounter.participantEntityIds as unknown[]).includes(speakerRef)) return { issues: [{ constraint: "npc-stance:not-in-the-speaker's-encounter",
      expected: { requirement: "the NPC and the speaker take part in the same running encounter" } }] };
  if (Object.keys(state.combatRuntime.pendingInputs).length > 0 || Object.keys(state.combatRuntime.randomnessResolutions).length > 0) {
    return { issues: [{ constraint: "npc-stance:combat-choice-open", expected: { requirement: "no combat choice or roll is waiting" } }] };
  }
  if (stance === "unchanged") return { issues: [], encounter, targets: encounterHostileTargets(encounter, npcRef) };
  if (!canStillFight(state, encounter, npcRef)) return { issues: [{ constraint: "npc-stance:cannot-act",
    expected: { requirement: "an NPC that can still act (present, alive, conscious)" } }] };
  const current = encounterHostileTargets(encounter, npcRef);
  const fighting = current.includes(speakerRef);
  if (stance === "turnOn") {
    return fighting ? { issues: [{ constraint: "npc-stance:already-fighting", expected: { requirement: "turnOn needs an NPC not fighting the speaker" } }] }
      : { issues: [], encounter, targets: [...current, speakerRef].sort() };
  }
  if (!fighting) return { issues: [{ constraint: "npc-stance:not-fighting-the-speaker",
    expected: { requirement: "yield, acceptSurrender and truce need an NPC fighting the speaker" } }] };
  // A yield or truce is with the speaker's side: the speaker and the player
  // characters it fights. Accepting a surrender is the speaker's alone.
  const players = new Set(encounterLivingPlayers(state, encounter));
  const stops = stance === "acceptSurrender" ? [speakerRef] : current.filter(target => target === speakerRef || players.has(target));
  return { issues: [], encounter, targets: current.filter(target => !stops.includes(target)) };
}

export function npcCombatStanceIssues(state: AuthoritativeWorldState, npcRef: string, speakerRef: string,
  stance: NpcCombatStance | "unchanged", playerStopsFightingRefs: readonly string[] = []): readonly NpcCombatStanceIssue[] {
  const player = playerStopsFightingRefs.length === 0 ? [] : state.entities[speakerRef]?.kind !== "player"
    ? [{ constraint: "npc-stance:player-required", expected: { requirement: "only the acting player declares their own surrender" } }]
    : combatEndIssues(state, speakerRef, { outcome: "actorSurrenders", stopFightingRefs: playerStopsFightingRefs, description: "本人明确投降。" });
  return [...player, ...resolveStance(state, npcRef, speakerRef, stance).issues];
}

/** The authority the stance reads: the NPC, the speaker and the scene. */
export function npcCombatStanceReadRefs(state: AuthoritativeWorldState, npcRef: string, speakerRef: string, playerStopsFightingRefs: readonly string[] = []): readonly string[] | undefined {
  const sceneId = state.entities[npcRef]?.sceneId;
  return isNonEmptyString(sceneId) ? [...new Set([npcRef, speakerRef, sceneId, ...playerStopsFightingRefs])].sort() : undefined;
}

function diagnostics(issues: readonly NpcCombatStanceIssue[]): RuleDiagnostic[] {
  return issues.map(issue => ({ code: "CONSTRAINT_CONFLICT", message: issue.constraint, constraint: issue.constraint,
    path: "/plan/stance", expected: issue.expected, source: "SPEC 0016", visibility: "public" }));
}

type Committed = Extract<StepResult, { kind: "committed" }>;

/** Authority binding and the NPC's stance: its own hostility change, then,
 * when it stopped fighting and no one hostile can still fight, the end put to
 * each living player. Nothing ends until they accept. */
export function stepNpcCombatStance(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord,
  options: Readonly<{ continuedRoot?: true }> = {}): StepResult {
  if (!hasExactKeys(input, ["actorCharacterId", "kind", "plan", "rootActionId"]) || input.kind !== "npcCombatStance"
    || !isNonEmptyString(input.rootActionId) || !isNonEmptyString(input.actorCharacterId) || !isNpcCombatStancePlan(input.plan)
    || input.plan.speakerRef !== input.actorCharacterId) {
    return rejected("invalidRulesInput", "The frozen NPC combat stance is not canonical.");
  }
  const { npcRef, speakerRef, stance, readSet, playerStopsFightingRefs = [] } = input.plan, rootActionId = input.rootActionId;
  const reads = npcCombatStanceReadRefs(state, npcRef, speakerRef, playerStopsFightingRefs);
  if (reads === undefined || !reads.every(entry => readSet.some(binding => binding.ref === entry)) || !authorityReadSetMatches(state, readSet)) {
    return rejected("causalFrontierConflict", "The frozen NPC combat stance dependencies changed.");
  }
  const { encounter, targets } = resolveStance(state, npcRef, speakerRef, stance);
  const issues = npcCombatStanceIssues(state, npcRef, speakerRef, stance, playerStopsFightingRefs);
  if (issues.length || encounter === undefined || targets === undefined) return rejected("invalidRulesInput", "The NPC combat stance does not hold against authority.", diagnostics(issues));
  const root = <T extends JsonRecord>(command: T): T => options.continuedRoot ? continueCompoundRoot(command, rootActionId) : command;
  const encounterId = String(encounter.encounterId);
  let changed: StepResult | undefined;
  if (playerStopsFightingRefs.length) {
    changed = stepCombatWorld(profiles, state, root({ kind: "changeEncounterHostility", rootActionId, encounterId,
      sourceEntityId: speakerRef, targetEntityIds: encounterHostileTargets(encounter, speakerRef).filter(ref => !playerStopsFightingRefs.includes(ref)),
      reason: "playersSurrendered" }));
    if (changed?.kind !== "committed") return changed ?? rejected("invalidRulesInput", "The player surrender cannot be recorded.");
  }
  if (stance !== "unchanged") {
    const npcChanged = stepCombatWorld(profiles, changed?.kind === "committed" ? changed.state : state,
      root({ kind: "changeEncounterHostility", rootActionId, encounterId, sourceEntityId: npcRef, targetEntityIds: targets, reason: REASONS[stance] }));
    if (!npcChanged) return rejected("invalidRulesInput", "The NPC combat stance cannot change hostility.");
    if (npcChanged.kind !== "committed") return npcChanged;
    changed = changed?.kind === "committed" ? { ...npcChanged, events: [...changed.events, ...npcChanged.events],
      scope: scopeOf([...changed.scope.reads, ...npcChanged.scope.reads], [...changed.scope.writes, ...npcChanged.scope.writes], [...changed.scope.creates, ...npcChanged.scope.creates]) } : npcChanged;
  }
  if (changed?.kind !== "committed") return rejected("invalidRulesInput", "No combat stance was declared.");
  const after = changed.state.combatRuntime.encounters[encounterId]!;
  // Both independent declarations are now facts. Only now can the shared
  // end be offered; an NPC turning on the surrendered player keeps it open.
  if (!encounterFightIsOver(changed.state, after)) return changed;
  const reason = stance === "unchanged" ? encounterConclusionReason(changed.state, after) : REASONS[stance];
  const proposed = stepCombatWorld(profiles, changed.state, root({ kind: "proposeEncounterConclusion", rootActionId, encounterId,
    proposal: { reason, npcEntityIds: [npcRef] } }));
  if (proposed === undefined || proposed.kind === "rejected" || proposed.kind === "initialized" || proposed.kind === "needsKp") return changed;
  const prefix = changed as Committed;
  return { ...proposed, events: [...prefix.events, ...proposed.events],
    scope: scopeOf([...prefix.scope.reads, ...proposed.scope.reads], [...prefix.scope.writes, ...proposed.scope.writes],
      [...prefix.scope.creates, ...proposed.scope.creates]) } as StepResult;
}
