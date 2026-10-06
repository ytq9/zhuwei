import type { AuthoredSourceSchema } from "./authored-materialization";
import { authorityReadSetMatches, characterTimelineAuthorityRef } from "./authority-bindings";
import { stepCombatWorld } from "./combat-actions";
import { COMBAT_START_CREATURE_SLOT } from "./combat-start";
import { activeEncounter, encounterConclusionReason, encounterFightIsOver, encounterHostileTargets } from "./combat-encounters";
import { scopeOf } from "./events";
import { continueCompoundRoot } from "./internal-compound";
import type { AuthoritativeWorldState, JsonRecord, RuleDiagnostic, StepResult } from "./model";
import { rejected } from "./results";
import { hasExactKeys, isNonEmptyString, isRecord, isSha256 } from "./validation";
import { isCanonicalReadSet, type VersionedAuthorityBinding } from "./world-interaction-model";
import type { RuntimeProfileManifest } from "../profiles/types";

/** SPEC 0012 §§3.3、13 (ADR 0112, ADR 0117): the KP's ruling, inside an
 * encounter, about the actor's own side of a fight or about the fight
 * itself: the actor surrenders to the NPCs it names (it stops fighting them;
 * whether they accept is each NPC's own decision, on its turn or in its
 * reply), the players got away, the foes are beaten, or the fight no longer
 * needs initiative. The KP never decides an NPC's side. The end is put to
 * every living player, who each accept or decline; after a surrender only
 * once no one hostile to the players can still fight. Rules never ends it
 * for them. */
export const COMBAT_END_PLAN_SCHEMA = "zhuwei.combat-end-plan/vnext-1" as const;

export const COMBAT_END_OUTCOMES = ["foesDefeated", "actorSurrenders", "conflictOver"] as const;
export type CombatEndOutcome = typeof COMBAT_END_OUTCOMES[number];
/** The reason each outcome gives the proposal and, once accepted, the end. */
const REASONS: Readonly<Record<CombatEndOutcome, string>> = {
  foesDefeated: "hostilesDefeated", actorSurrenders: "playersSurrendered", conflictOver: "conflictNoLongerNeeded",
};
const MAX_CREATURES = 24;

export type CombatEnd = Readonly<{
  outcome: CombatEndOutcome;
  /** For a surrender, the NPCs in the encounter the actor surrenders to and
   * stops fighting. [] for the other outcomes. */
  stopFightingRefs: readonly string[];
  /** What the moment looks like, for the narration. */
  description: string;
}>;
export type CombatEndPlan = Readonly<{
  schema: typeof COMBAT_END_PLAN_SCHEMA; contextHash: string;
  readSet: readonly VersionedAuthorityBinding[]; end: CombatEnd;
}>;

type Schema = AuthoredSourceSchema;
/** The form's source schema. Its creature slot is the start form's, so a
 * request narrows it to the frozen creatures the same way. */
export const COMBAT_END_SOURCE_SCHEMA: Schema = { type: "object", properties: {
  outcome: { type: "string", enum: [...COMBAT_END_OUTCOMES] },
  stopFightingRefs: { type: "array", items: COMBAT_START_CREATURE_SLOT },
  description: { type: "string", pattern: "[\\s\\S]+" },
}, required: ["outcome", "stopFightingRefs", "description"], additionalProperties: false };

const ref = (value: unknown): value is string => typeof value === "string" && /^\S+$/u.test(value) && value.length <= 512;

/** Shape only; `combatEndIssues` judges it against authority. */
export function isCombatEnd(value: unknown): value is CombatEnd {
  return isRecord(value) && hasExactKeys(value, ["outcome", "stopFightingRefs", "description"])
    && (COMBAT_END_OUTCOMES as readonly unknown[]).includes(value.outcome)
    && Array.isArray(value.stopFightingRefs) && value.stopFightingRefs.length <= MAX_CREATURES
    && value.stopFightingRefs.every(ref) && new Set(value.stopFightingRefs).size === value.stopFightingRefs.length
    && typeof value.description === "string" && value.description.trim().length > 0 && value.description.length <= 2_000
    && value.description.normalize("NFC") === value.description;
}

export function isCombatEndPlan(value: unknown): value is CombatEndPlan {
  return isRecord(value) && hasExactKeys(value, ["schema", "contextHash", "readSet", "end"])
    && value.schema === COMBAT_END_PLAN_SCHEMA && isSha256(value.contextHash)
    && isCanonicalReadSet(value.readSet) && isCombatEnd(value.end);
}

/** A problem with the ruling against authority; paths are relative to it. */
export type CombatEndIssue = Readonly<{ constraint: string; path: readonly (string | number)[]; expected: Readonly<Record<string, unknown>>; actual?: unknown }>;

/** Every authority check of the ruling, shared by lowering (as revision
 * diagnostics) and Rules (as the rejection). */
export function combatEndIssues(state: AuthoritativeWorldState, actorId: string, end: CombatEnd): readonly CombatEndIssue[] {
  return resolveCombatEnd(state, actorId, end).issues;
}

function resolveCombatEnd(state: AuthoritativeWorldState, actorId: string, end: CombatEnd):
  Readonly<{ issues: readonly CombatEndIssue[]; encounter?: JsonRecord }> {
  const encounter = state.entities[actorId]?.tenureStatus === "active" ? activeEncounter(state, actorId) : undefined;
  if (encounter === undefined) return { issues: [{ constraint: "combat-end:actor-not-in-encounter", path: [],
    expected: { requirement: "the actor is in a running encounter; outside one there is no fight to end" } }] };
  const issues: CombatEndIssue[] = [];
  if (Object.keys(state.combatRuntime.pendingInputs).length > 0 || Object.keys(state.combatRuntime.randomnessResolutions).length > 0) {
    issues.push({ constraint: "combat-end:combat-choice-open", path: [],
      expected: { requirement: "no combat choice or roll is waiting; the fight's end is put to the players after them" } });
  }
  const participants = (encounter.participantEntityIds as unknown[]).filter(isNonEmptyString);
  const npcs = participants.filter(id => state.combatRuntime.entities[id]?.kind !== "player").sort();
  const surrenders = end.outcome === "actorSurrenders";
  if (!surrenders && end.stopFightingRefs.length > 0) issues.push({ constraint: "combat-end:no-one-stops-for-this-outcome", path: ["stopFightingRefs"],
    expected: { requirement: "stopFightingRefs is [] unless the outcome is actorSurrenders", refs: [] } });
  if (surrenders && end.stopFightingRefs.length === 0) issues.push({ constraint: "combat-end:who-stops-required", path: ["stopFightingRefs"],
    expected: { requirement: "the NPCs in the encounter the actor surrenders to", refs: npcs } });
  // ADR 0117: the actor surrenders only to those it is fighting; whether they
  // accept is theirs to decide.
  const fought = encounterHostileTargets(encounter, actorId);
  if (surrenders) end.stopFightingRefs.forEach((npcRef, index) => {
    if (!npcs.includes(npcRef)) {
      issues.push({ constraint: "combat-end:not-an-npc-in-the-encounter", path: ["stopFightingRefs", index],
        expected: { requirement: "an NPC taking part in the actor's encounter", refs: npcs }, actual: npcRef });
    } else if (!fought.includes(npcRef)) {
      issues.push({ constraint: "combat-end:actor-not-fighting", path: ["stopFightingRefs", index],
        expected: { requirement: "an NPC the actor is fighting; the actor surrenders only to those", refs: npcs.filter(ref => fought.includes(ref)) }, actual: npcRef });
    }
  });
  return { issues, ...(issues.length === 0 ? { encounter } : {}) };
}

/** The authority the ruling reads: the actor, its scene and timeline (the end
 * closes the round at its moment), and each NPC named as stopping. */
export function combatEndReadRefs(state: AuthoritativeWorldState, actorId: string, end: CombatEnd): readonly string[] | undefined {
  const sceneId = state.entities[actorId]?.sceneId;
  if (!isNonEmptyString(sceneId)) return undefined;
  return [...new Set([actorId, sceneId, characterTimelineAuthorityRef(actorId), ...end.stopFightingRefs])].sort();
}

function diagnostics(issues: readonly CombatEndIssue[]): RuleDiagnostic[] {
  return issues.map(issue => ({ code: "CONSTRAINT_CONFLICT", message: issue.constraint, constraint: issue.constraint,
    path: `/plan/end${issue.path.map(part => `/${String(part)}`).join("")}`, expected: issue.expected,
    source: "SPEC 0016", visibility: "public" }));
}

type Committed = Extract<StepResult, { kind: "committed" }>;

/** Joins a step taken from the previous one's committed state onto it. */
function joined(prefix: Committed | undefined, next: StepResult): StepResult {
  if (prefix === undefined || next.kind === "rejected" || next.kind === "initialized" || next.kind === "needsKp") return next;
  return { ...next, events: [...prefix.events, ...next.events],
    scope: scopeOf([...prefix.scope.reads, ...next.scope.reads], [...prefix.scope.writes, ...next.scope.writes],
      [...prefix.scope.creates, ...next.scope.creates]) } as StepResult;
}

/** Authority binding and the KP's ruling. The existing combat steps change
 * hostility and open the players' choice; nothing ends until they accept. */
export function stepCombatEnd(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord,
  options: Readonly<{ continuedRoot?: true }> = {}): StepResult {
  if (!hasExactKeys(input, ["kind", "rootActionId", "actorCharacterId", "plan"]) || input.kind !== "endCombat"
    || !isNonEmptyString(input.rootActionId) || !isNonEmptyString(input.actorCharacterId) || !isCombatEndPlan(input.plan)) {
    return rejected("invalidRulesInput", "The frozen combat end is not canonical.");
  }
  const { end, readSet } = input.plan, actorId = input.actorCharacterId, rootActionId = input.rootActionId;
  const reads = combatEndReadRefs(state, actorId, end);
  if (reads === undefined || !reads.every(entry => readSet.some(binding => binding.ref === entry)) || !authorityReadSetMatches(state, readSet)) {
    return rejected("causalFrontierConflict", "The frozen combat end dependencies changed.");
  }
  const { issues, encounter } = resolveCombatEnd(state, actorId, end);
  if (encounter === undefined) return rejected("invalidRulesInput", "The combat end does not hold against authority.", diagnostics(issues));
  const encounterId = String(encounter.encounterId);
  const root = <T extends JsonRecord>(command: T): T => options.continuedRoot ? continueCompoundRoot(command, rootActionId) : command;
  // ADR 0117: a surrender changes only the actor's own side; its description
  // tells the moment.
  const changes: { sourceEntityId: string; targetEntityIds: string[] }[] = end.outcome !== "actorSurrenders" ? []
    : [{ sourceEntityId: actorId, targetEntityIds: encounterHostileTargets(encounter, actorId).filter(target => !end.stopFightingRefs.includes(target)) }];
  let result: Committed | undefined;
  for (const [index, change] of changes.entries()) {
    const next = stepCombatWorld(profiles, result?.state ?? state, root({ kind: "changeEncounterHostility", rootActionId, encounterId,
      sourceEntityId: change.sourceEntityId, targetEntityIds: change.targetEntityIds, reason: REASONS[end.outcome],
      ...(index === 0 ? { description: end.description } : {}) }));
    if (next === undefined) return rejected("invalidRulesInput", "The combat end cannot change hostility.");
    const combined = joined(result, next);
    if (combined.kind !== "committed") return combined;
    result = combined;
  }
  const current = result?.state ?? state;
  const after = current.combatRuntime.encounters[encounterId]!;
  // A surrender while someone hostile can still fight only records it; the
  // fight goes on until they accept it or are beaten (SPEC 0012 §13).
  if (end.outcome === "actorSurrenders" && !encounterFightIsOver(current, after)) {
    return result ?? rejected("invalidRulesInput", "The combat end changes nothing.");
  }
  const proposal: JsonRecord = { reason: end.outcome === "actorSurrenders" ? encounterConclusionReason(current, after) : REASONS[end.outcome],
    ...(end.stopFightingRefs.length === 0 ? {} : { npcEntityIds: [...end.stopFightingRefs].sort() }),
    ...(changes.length === 0 ? { description: end.description } : {}) };
  const proposed = stepCombatWorld(profiles, result?.state ?? state, root({ kind: "proposeEncounterConclusion", rootActionId, encounterId, proposal }));
  if (proposed === undefined) return rejected("invalidRulesInput", "The combat end cannot be proposed.");
  return joined(result, proposed);
}
