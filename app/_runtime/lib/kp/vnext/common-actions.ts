import type { AuthoritativeWorldState } from "../../rules";
import { proposalDiagnostic, diagnosticActual, type ProposalDiagnostic } from "./proposal-diagnostics";
import type { VNextApproach, VNextCommonAction, VNextOppositionDeclaration, VNextWorldInteractionBranchProposal,
  VNextWorldInteractionEntry } from "./proposal-schema";
import type { VNextWorldSemanticEffect, WorldInteractionAdjudication } from "./proposals";

/** SPEC 0004 §4: the resistance a grapple or shove meets, and an escape's. */
const GRAPPLE_OPPOSITION: VNextOppositionDeclaration["checks"] = Object.freeze([
  Object.freeze({ ability: "str" as const, skill: "athletics" }), Object.freeze({ ability: "dex" as const, skill: "acrobatics" }),
]);
const ESCAPE_OPPOSITION: VNextOppositionDeclaration["checks"] = Object.freeze([Object.freeze({ ability: "str" as const, skill: "athletics" })]);
/** SPEC 0014 §4: clearing a low obstacle, and landing on difficult ground. */
const JUMP_CLEAR_CHECK = Object.freeze({ ability: "str", skill: "athletics", dc: 10 });
const JUMP_LANDING_CHECK = Object.freeze({ ability: "dex", skill: "acrobatics", dc: 10 });

export type CommonActionLowering =
  | Readonly<{ kind: "accepted"; entry: VNextWorldInteractionEntry }>
  | Readonly<{ kind: "rejected"; code: "PROPOSAL_FORM_INVALID"; issues: readonly string[]; diagnostics: readonly ProposalDiagnostic[] }>;

/** SPEC 0016 §3.1, SPEC 0014 §4, SPEC 0004 §4 (ADR 0092): a registered common
 * action written on a world step becomes that step's walk and effect. The
 * KP's ruling -- no roll, a contest or a check -- and its risk and outcomes
 * stand; a contest must use the checks SRD 5.1 fixes, and a contested action
 * ruled as a plain DC check is sent back for revision. */
export function lowerCommonAction(state: AuthoritativeWorldState, actorId: string, ordinal: number,
  entry: VNextWorldInteractionEntry & { commonAction: VNextCommonAction }, adjudication: WorldInteractionAdjudication): CommonActionLowering {
  const action = entry.commonAction;
  const target = action.targetRef;
  const holding = target !== null && heldBy(state, target) === actorId;
  const contested = action.kind === "grapple" || action.kind === "shove" || action.kind === "escape" || (action.kind === "carry" && !holding);
  const repair = { allowed: true, reason: "uncommitted-proposal-may-be-revised-once" } as const;
  // SPEC 0004 §4 (ADR 0086): a grab, a shove or breaking free is decided by a contest against that creature.
  if (contested && !(adjudication.kind === "check" && adjudication.opposition !== undefined)) {
    const constraint = "commonAction:contest-required";
    return rejected([proposalDiagnostic("CONSTRAINT_CONFLICT", constraint, {
      path: ["proposals", ordinal, "commonAction", "kind"], actual: diagnosticActual(action.kind),
      expected: { requirement: "decision.kind contest with opponentRef this common action's targetRef, checked on this step" }, repair })]);
  }
  // SPEC 0006 §7: the one grabbed reacts from what it felt, which only the KP can write.
  if (effectGrabs(action, holding) && !entry.branches.success.sensoryEvidence.some(evidence => evidence.observerRef === target)) {
    return rejected([proposalDiagnostic("FIELD_MISSING", "commonAction:grabbed-creature-perception", {
      path: ["proposals", ordinal, "branches", "success", "sensoryEvidence"], actual: diagnosticActual(entry.branches.success.sensoryEvidence),
      expected: { requirement: "a sensoryEvidence entry whose observerRef is the creature grabbed, saying what it felt", observerRef: target }, repair })]);
  }
  // SPEC 0014 §4, SPEC 0004 §4: walking, dropping prone, standing and letting go take no roll.
  const noRoll = action.kind === "walkTo" || action.kind === "dropProne" || action.kind === "standUp" || action.kind === "release";
  if (noRoll && adjudication.kind === "check") {
    return rejected([proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:no-roll", {
      path: ["proposals", ordinal, "commonAction", "kind"], actual: diagnosticActual(action.kind),
      expected: { requirement: "this common action takes no roll; put the check on the step that is uncertain, or rule directSuccess" }, repair })]);
  }
  // SPEC 0014 §4: a jump's only rolls are Athletics DC 10 to clear a low
  // obstacle and Acrobatics DC 10 to land on difficult ground; Rules checks
  // which one this jump needs.
  if (action.kind === "jump" && adjudication.kind === "check" && !jumpCheck(adjudication)) {
    return rejected([proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:jump-check", {
      path: ["adjudication", "skill"], actual: diagnosticActual({ ability: adjudication.ability, skill: adjudication.skill, dc: adjudication.dc }),
      expected: { oneOf: [JUMP_CLEAR_CHECK, JUMP_LANDING_CHECK], requirement: "no opposition; or rule directSuccess" }, repair })]);
  }
  // SPEC 0004 §4 (ADR 0093, 0094): hiding is a concealed Stealth check; Rules
  // compares its total with each NPC's passive Perception adjusted by cover.
  if (action.kind === "hide" && !(adjudication.kind === "check" && adjudication.concealment !== undefined
    && adjudication.ability === "dex" && adjudication.skill === "stealth")) {
    return rejected([proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:hide-check", {
      path: ["proposals", ordinal, "commonAction", "kind"], actual: diagnosticActual(adjudication.kind === "check"
        ? { ability: adjudication.ability, skill: adjudication.skill, concealed: adjudication.concealment !== undefined } : adjudication.kind),
      expected: { requirement: "decision.kind concealedCheck with ability dex and skill stealth, checked on this step" }, repair })]);
  }
  // SRD 5.1 fixes who rolls what; a contest written otherwise goes back for revision.
  if (contested && adjudication.kind === "check" && adjudication.opposition !== undefined) {
    const escapeSkill = action.option === "acrobatics" ? { ability: "dex", skill: "acrobatics" } : { ability: "str", skill: "athletics" };
    const actorCheck = action.kind === "escape" ? escapeSkill : { ability: "str", skill: "athletics" };
    const opposing = action.kind === "escape" ? ESCAPE_OPPOSITION : GRAPPLE_OPPOSITION;
    const key = (check: Readonly<{ ability: string; skill: string | null }>) => `${check.ability}:${check.skill}`;
    const written = adjudication.opposition.checks.map(key).sort(), fixed = opposing.map(key).sort();
    const diagnostics = [
      ...(adjudication.opposition.opponentRef === target ? [] : [proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:contest-opponent", {
        path: ["adjudication", "opposition", "opponentRef"], actual: diagnosticActual(adjudication.opposition.opponentRef), expected: { const: target }, repair })]),
      ...(adjudication.ability === actorCheck.ability && adjudication.skill === actorCheck.skill ? [] : [proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:contest-terms", {
        path: ["adjudication", "skill"], actual: diagnosticActual({ ability: adjudication.ability, skill: adjudication.skill }), expected: actorCheck, repair })]),
      ...(written.length === fixed.length && written.every((check, index) => check === fixed[index]) ? [] : [proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:contest-terms", {
        path: ["adjudication", "opposition", "checks"], actual: diagnosticActual(adjudication.opposition.checks), expected: { checks: opposing }, repair })]),
    ];
    if (diagnostics.length > 0) return rejected(diagnostics);
  }
  const effect: VNextWorldSemanticEffect | undefined = effectGrabs(action, holding)
    ? { kind: "grapple", targetRef: target! }
    : action.kind === "release" ? { kind: "releaseGrapple", targetRef: target! }
    : action.kind === "escape" ? { kind: "escapeGrapple", grapplerRef: target! }
    : action.kind === "shove" ? (action.option === "push" ? { kind: "shovePush", targetRef: target! } : { kind: "knockProne", targetRef: target! })
    : action.kind === "door" ? { kind: "portalTransition", featureRef: target!, intent: action.option === "open" ? "open" : "close" }
    : action.kind === "dropProne" ? { kind: "dropProne" }
    : action.kind === "standUp" ? { kind: "standUp" }
    : action.kind === "jump" ? { kind: "jumpOver", featureRef: target!, landProne: false }
    : action.kind === "hide" ? { kind: "hide" }
    : undefined;
  // A failed landing roll still lands, prone; a failed clearing roll hits the obstacle and stays.
  // A hide is settled per NPC whatever the primary observer saw, so it is written in both outcomes.
  const failureEffect: VNextWorldSemanticEffect | undefined = action.kind === "jump" && adjudication.kind === "check"
    && adjudication.skill === JUMP_LANDING_CHECK.skill ? { kind: "jumpOver", featureRef: target!, landProne: true }
    : action.kind === "hide" ? { kind: "hide" } : undefined;
  // The walk first: beside the one acted on, to the place named, or as the KP wrote it.
  const approach: VNextApproach | undefined = action.kind === "walkTo" || (action.kind === "carry" && holding)
    ? { kind: "nextTo", ref: action.destinationRef! }
    : action.kind === "grapple" || action.kind === "carry" || action.kind === "shove" || action.kind === "door" || action.kind === "jump"
      ? { kind: "nextTo", ref: target! }
      : entry.approach ?? undefined;
  const withEffect = (branch: VNextWorldInteractionBranchProposal, added = effect): VNextWorldInteractionBranchProposal => added === undefined ? branch : {
    ...branch, effects: [...branch.effects.filter(written => !sameEffectGroup(written, added)), added] };
  // A walk, or lying down and getting up, acts on the actor itself.
  const targets = [target ?? actorId];
  const lowered: VNextWorldInteractionEntry = {
    ...withoutCommonAction(entry),
    ...(approach === undefined ? {} : { approach }),
    targetRefs: [...new Set([...entry.targetRefs, ...targets])],
    directTargetRefs: [...new Set([...entry.directTargetRefs, ...targets])],
    branches: { success: withEffect(entry.branches.success),
      failure: entry.branches.failure === null || failureEffect === undefined ? entry.branches.failure : withEffect(entry.branches.failure, failureEffect) },
  };
  return { kind: "accepted", entry: lowered };
}

function jumpCheck(adjudication: WorldInteractionAdjudication & { kind: "check" }): boolean {
  return adjudication.checkKind === "abilityCheck" && adjudication.opposition === undefined && adjudication.concealment === undefined
    && [JUMP_CLEAR_CHECK, JUMP_LANDING_CHECK].some(check => adjudication.ability === check.ability && adjudication.skill === check.skill
      && adjudication.dc === check.dc);
}

function rejected(diagnostics: readonly ProposalDiagnostic[]): CommonActionLowering {
  return { kind: "rejected", code: "PROPOSAL_FORM_INVALID", issues: [...new Set(diagnostics.map(diagnostic => diagnostic.constraint))], diagnostics };
}

/** carry of someone not yet held: where the actor then walks with them, as a
 * step after the grab that runs only once the grab holds. */
export function carryDestination(state: AuthoritativeWorldState, actorId: string, action: VNextCommonAction): VNextApproach | undefined {
  return action.kind === "carry" && action.destinationRef !== null && action.targetRef !== null
    && heldBy(state, action.targetRef) !== actorId ? { kind: "nextTo", ref: action.destinationRef } : undefined;
}

/** The walk that carries the one just grabbed to where the player named,
 * only once the grab has succeeded. */
export function carryFollowUpEntry(entry: VNextWorldInteractionEntry & { commonAction: VNextCommonAction }, carryTo: VNextApproach,
  outcomeBinding: VNextWorldInteractionEntry["outcomeBinding"]): VNextWorldInteractionEntry {
  const target = entry.commonAction.targetRef!;
  return {
    ...withoutCommonAction(entry),
    consumes: [], produces: [], outcomeBinding,
    approach: carryTo,
    targetRefs: [target], directTargetRefs: [target], instrumentRefs: [], abilityRef: null,
    branches: { success: { outcomeCode: `${entry.branches.success.outcomeCode}:carried`, summary: entry.branches.success.summary,
      effects: [], sensoryEvidence: [], pressures: [], opportunities: [] }, failure: null },
  };
}

function effectGrabs(action: VNextCommonAction, holding: boolean): boolean {
  return action.kind === "grapple" || (action.kind === "carry" && !holding);
}

function withoutCommonAction(entry: VNextWorldInteractionEntry): VNextWorldInteractionEntry {
  const { commonAction: _script, ...rest } = entry;
  return rest;
}

function heldBy(state: AuthoritativeWorldState, creatureRef: string): string | undefined {
  const conditions = state.combatRuntime.entities[creatureRef]?.conditions;
  return conditions !== null && typeof conditions === "object" && !Array.isArray(conditions)
    ? (conditions as Record<string, unknown>).grappledBy as string | undefined : undefined;
}

/** One change of hold, posture or door per outcome: the script's replaces any
 * the KP also wrote of the same kind. */
function sameEffectGroup(left: VNextWorldSemanticEffect, right: VNextWorldSemanticEffect): boolean {
  const group = (effect: VNextWorldSemanticEffect) => ["grapple", "knockProne", "releaseGrapple", "escapeGrapple", "shovePush"].includes(effect.kind)
    ? "hold" : ["dropProne", "standUp", "jumpOver"].includes(effect.kind) ? "posture" : effect.kind === "portalTransition" ? "door" : effect.kind;
  return group(left) === group(right);
}
