import type { AuthoritativeWorldState } from "../../rules";
import { planJumpTakeoff, planTerrainTraversal, terrainCheckRequirement } from "../../rules/authority-read";
import { isPlainRecord as isRecord } from "./canonical-json";
import { proposalDiagnostic, diagnosticActual, type ProposalDiagnostic } from "./proposal-diagnostics";
import { commonActionShapeIssue, type VNextApproach, type VNextCommonAction, type VNextOppositionDeclaration, type VNextWorldInteractionBranchProposal,
  type VNextWorldInteractionEntry } from "./proposal-schema";
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
  const checked = commonActionChecks(state, actorId, ordinal, entry, adjudication);
  if (checked.diagnostics.length > 0) return rejected(checked.diagnostics);
  const start = checked.takeoff?.kind === "accepted" ? checked.takeoff.takeoff
    : checked.traversal?.kind === "accepted" ? checked.traversal.start : undefined;
  const effect: VNextWorldSemanticEffect | undefined = effectGrabs(action, holding)
    ? { kind: "grapple", targetRef: target! }
    : action.kind === "carry" && action.option === "putDown" ? { kind: "releaseGrapple", targetRef: target! }
    : action.kind === "release" ? { kind: "releaseGrapple", targetRef: target! }
    : action.kind === "escape" ? { kind: "escapeGrapple", grapplerRef: target! }
    : action.kind === "shove" ? (action.option === "push" ? { kind: "shovePush", targetRef: target! } : { kind: "knockProne", targetRef: target! })
    : action.kind === "door" ? { kind: "portalTransition", featureRef: target!, intent: action.option === "open" ? "open" : "close" }
    : action.kind === "dropProne" ? { kind: "dropProne" }
    : action.kind === "standUp" ? { kind: "standUp" }
    : action.kind === "jump" && action.option === "up" ? { kind: "jumpOnto", featureRef: target! }
    : action.kind === "jump" ? { kind: "jumpOver", featureRef: target!, landProne: false }
    : action.kind === "hide" ? { kind: "hide" }
    : action.kind === "climb" || action.kind === "swim"
      ? { kind: "climbFeature", featureRef: target!, way: action.kind, direction: action.option as "down" | "up" | "across" }
    : action.kind === "fall" ? { kind: "fallFrom", featureRef: target! }
    : undefined;
  // A failed landing roll still lands, prone; a failed clearing roll hits the obstacle and stays.
  // A hide keeps its Stealth total whatever the primary observer saw, so it is written in both outcomes.
  const failureEffect: VNextWorldSemanticEffect | undefined = action.kind === "jump" && action.option !== "up" && adjudication.kind === "check"
    && adjudication.skill === JUMP_LANDING_CHECK.skill ? { kind: "jumpOver", featureRef: target!, landProne: true }
    : action.kind === "hide" ? { kind: "hide" } : undefined;
  // The walk first: to where the jump, climb or swim starts, beside the one
  // acted on, to the place named, or as the KP wrote it. A fall happens where the actor is.
  const approach: VNextApproach | undefined = start !== undefined ? { kind: "point", x: start.x, y: start.y }
    : action.kind === "walkTo" || (action.kind === "carry" && holding)
    ? { kind: "nextTo", ref: action.destinationRef! }
    : action.kind === "grapple" || action.kind === "carry" || action.kind === "shove" || action.kind === "door"
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

function jumpCheck(action: VNextCommonAction, adjudication: WorldInteractionAdjudication & { kind: "check" }): boolean {
  // SRD 5.1 asks no roll of a high jump; the KP may still call for Athletics at its DC.
  if (action.option === "up") return athleticsCheck(adjudication);
  return adjudication.checkKind === "abilityCheck" && adjudication.opposition === undefined && adjudication.concealment === undefined
    && [JUMP_CLEAR_CHECK, JUMP_LANDING_CHECK].some(check => adjudication.ability === check.ability && adjudication.skill === check.skill
      && adjudication.dc === check.dc);
}

/** SPEC 0014 §4 (ADR 0098): a hard climb or rough water takes Athletics at
 * the DC the KP sets from the material or the current. */
function athleticsCheck(adjudication: WorldInteractionAdjudication & { kind: "check" }): boolean {
  return adjudication.checkKind === "abilityCheck" && adjudication.opposition === undefined && adjudication.concealment === undefined
    && adjudication.ability === "str" && adjudication.skill === "athletics";
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

/** Every way this common action's ruling fails what SRD 5.1 fixes, at once,
 * so one revision is told about all of them. Without `state` (a draft read
 * before Room lowers it) the checks that depend on who holds whom or on the
 * map are left out. */
export function commonActionDiagnostics(state: AuthoritativeWorldState | undefined, actorId: string, ordinal: number,
  entry: VNextWorldInteractionEntry & { commonAction: VNextCommonAction }, adjudication: WorldInteractionAdjudication): ProposalDiagnostic[] {
  return commonActionChecks(state, actorId, ordinal, entry, adjudication).diagnostics;
}

function commonActionChecks(state: AuthoritativeWorldState | undefined, actorId: string, ordinal: number,
  entry: VNextWorldInteractionEntry & { commonAction: VNextCommonAction }, adjudication: WorldInteractionAdjudication) {
  const action = entry.commonAction;
  const target = action.targetRef;
  const holding = state === undefined || target === null ? undefined : heldBy(state, target) === actorId;
  const grabs = action.kind === "grapple" || (action.kind === "carry" && holding === false);
  const contested = action.kind === "shove" || action.kind === "escape" || grabs;
  const repair = { allowed: true, reason: "uncommitted-proposal-may-be-revised-once" } as const;
  const diagnostics: ProposalDiagnostic[] = [];
  // SPEC 0004 §4 (ADR 0086): a grab, a shove or breaking free is decided by a contest against that creature.
  if (contested && !(adjudication.kind === "check" && adjudication.opposition !== undefined)) {
    diagnostics.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:contest-required", {
      path: ["proposals", ordinal, "commonAction", "kind"], actual: diagnosticActual(action.kind),
      expected: { requirement: "decision.kind contest with opponentRef this common action's targetRef, checked on this step" }, repair }));
  }
  // SPEC 0006 §7: the one grabbed reacts from what it felt, which only the KP can write.
  if (grabs && !entry.branches.success.sensoryEvidence.some(evidence => evidence.observerRef === target)) {
    diagnostics.push(proposalDiagnostic("FIELD_MISSING", "commonAction:grabbed-creature-perception", {
      path: ["proposals", ordinal, "branches", "success", "sensoryEvidence"], actual: diagnosticActual(entry.branches.success.sensoryEvidence),
      expected: { requirement: "a sensoryEvidence entry whose observerRef is the creature grabbed, saying what it felt", observerRef: target }, repair }));
  }
  // SPEC 0014 §4, SPEC 0004 §4: walking, dropping prone, standing and letting go take no roll.
  // A fall's only dice are its damage, which Rules rolls.
  const noRoll = action.kind === "walkTo" || action.kind === "dropProne" || action.kind === "standUp" || action.kind === "release"
    || action.kind === "fall";
  if (noRoll && adjudication.kind === "check") {
    diagnostics.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:no-roll", {
      path: ["proposals", ordinal, "commonAction", "kind"], actual: diagnosticActual(action.kind),
      expected: { requirement: "this common action takes no roll; put the check on the step that is uncertain, or rule directSuccess" }, repair }));
  }
  // SPEC 0014 §4: a jump's only rolls are Athletics DC 10 to clear a low
  // obstacle and Acrobatics DC 10 to land on difficult ground; Rules checks
  // which one this jump needs.
  if (action.kind === "jump" && adjudication.kind === "check" && !jumpCheck(action, adjudication)) {
    diagnostics.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:jump-check", {
      path: ["adjudication", "skill"], actual: diagnosticActual({ ability: adjudication.ability, skill: adjudication.skill, dc: adjudication.dc }),
      expected: action.option === "up" ? { ability: "str", skill: "athletics", requirement: "no opposition; or rule directSuccess" }
        : { oneOf: [JUMP_CLEAR_CHECK, JUMP_LANDING_CHECK], requirement: "no opposition; or rule directSuccess" }, repair }));
  }
  // SPEC 0014 §4 (ADR 0098): climbing and swimming roll only Athletics.
  if ((action.kind === "climb" || action.kind === "swim") && adjudication.kind === "check" && !athleticsCheck(adjudication)) {
    diagnostics.push(proposalDiagnostic("CONSTRAINT_CONFLICT", `commonAction:${action.kind}-check`, {
      path: ["adjudication", "skill"], actual: diagnosticActual({ ability: adjudication.ability, skill: adjudication.skill }),
      expected: { ability: "str", skill: "athletics", requirement: "no opposition, DC from the material or the current; or rule directSuccess" }, repair }));
  }
  // SPEC 0014 §4 (ADR 0100): within the climber's own height there is no
  // check; above it, a material (or current) the map records fixes the DC.
  // Only a feature the map says nothing about leaves both to the KP.
  const required = (action.kind === "climb" || action.kind === "swim") && state !== undefined && target !== null
    ? terrainCheckRequirement(state, actorId, target, action.kind) : undefined;
  const checked = adjudication.kind === "check" ? { ability: adjudication.ability, skill: adjudication.skill, dc: adjudication.dc } : adjudication.kind;
  if (required?.kind === "none" && adjudication.kind === "check") {
    diagnostics.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:terrain-no-check", {
      path: ["adjudication"], actual: diagnosticActual(checked),
      expected: { reason: required.reason, bodyHeightInches: required.bodyHeightInches,
        requirement: "this climb or swim takes no check here; rule directSuccess" }, repair }));
  }
  if (required?.kind === "athletics" && !(adjudication.kind === "check" && athleticsCheck(adjudication) && adjudication.dc === required.dc)) {
    diagnostics.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:terrain-dc", {
      path: ["adjudication"], actual: diagnosticActual(checked),
      expected: { ability: "str", skill: "athletics", dc: required.dc, basis: required.basis,
        requirement: "the map's record fixes this check; write both outcomes, the failure as it would go here (staying put, a fall, sliding into the ditch or water)" }, repair }));
  }
  // SPEC 0004 §4 (ADR 0097): hiding is a concealed Stealth check; Rules
  // keeps its total, and opponents who can see the hider roll Perception
  // against it after each action.
  if (action.kind === "hide" && !(adjudication.kind === "check" && adjudication.concealment !== undefined
    && adjudication.ability === "dex" && adjudication.skill === "stealth")) {
    diagnostics.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:hide-check", {
      path: ["proposals", ordinal, "commonAction", "kind"], actual: diagnosticActual(adjudication.kind === "check"
        ? { ability: adjudication.ability, skill: adjudication.skill, concealed: adjudication.concealment !== undefined } : adjudication.kind),
      expected: { requirement: "decision.kind concealedCheck with ability dex and skill stealth, checked on this step" }, repair }));
  }
  // SPEC 0014 §4: the jump starts from a spot beside the feature it can be
  // made from (round 163 walked to the nearest one and ran out of reach);
  // when there is none the KP is told, so it can rule it impossible.
  const takeoff = action.kind === "jump" && action.option !== "up" && state !== undefined && target !== null
    ? planJumpTakeoff(state, actorId, target) : undefined;
  if (takeoff?.kind === "rejected") {
    diagnostics.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:jump-impossible", {
      path: ["proposals", ordinal, "commonAction", "targetRef"], actual: diagnosticActual(target),
      expected: { reason: takeoff.reason, requirement: "this jump cannot be made from anywhere beside the feature; rule it impossible in the world, or write another act" },
      repair }));
  }
  // SPEC 0014 §4 (ADR 0098): where a climb, a swim or a high jump starts, and
  // whether it can be made at all, as for the long jump.
  const move = action.kind === "climb" || action.kind === "swim" ? { kind: action.kind, direction: action.option as "down" | "up" | "across" }
    : action.kind === "jump" && action.option === "up" ? { kind: "jumpOnto" as const } : undefined;
  const traversal = move !== undefined && state !== undefined && target !== null ? planTerrainTraversal(state, actorId, target, move) : undefined;
  if (traversal?.kind === "rejected") {
    diagnostics.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:terrain-impossible", {
      path: ["proposals", ordinal, "commonAction"], actual: diagnosticActual(action),
      expected: { reason: traversal.reason, requirement: "this cannot be done here; rule it impossible in the world, pick another option, or write another act" },
      repair }));
  }
  // SRD 5.1 fixes who rolls what; a contest written otherwise goes back for revision.
  if (contested && adjudication.kind === "check" && adjudication.opposition !== undefined) {
    const escapeSkill = action.option === "acrobatics" ? { ability: "dex", skill: "acrobatics" } : { ability: "str", skill: "athletics" };
    const actorCheck = action.kind === "escape" ? escapeSkill : { ability: "str", skill: "athletics" };
    const opposing = action.kind === "escape" ? ESCAPE_OPPOSITION : GRAPPLE_OPPOSITION;
    const key = (check: Readonly<{ ability: string; skill: string | null }>) => `${check.ability}:${check.skill}`;
    const written = adjudication.opposition.checks.map(key).sort(), fixed = opposing.map(key).sort();
    if (adjudication.opposition.opponentRef !== target) diagnostics.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:contest-opponent", {
      path: ["adjudication", "opposition", "opponentRef"], actual: diagnosticActual(adjudication.opposition.opponentRef), expected: { const: target }, repair }));
    if (adjudication.ability !== actorCheck.ability || adjudication.skill !== actorCheck.skill) diagnostics.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:contest-terms", {
      path: ["adjudication", "skill"], actual: diagnosticActual({ ability: adjudication.ability, skill: adjudication.skill }), expected: actorCheck, repair }));
    if (written.length !== fixed.length || written.some((check, index) => check !== fixed[index])) diagnostics.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:contest-terms", {
      path: ["adjudication", "opposition", "checks"], actual: diagnosticActual(adjudication.opposition.checks), expected: { checks: opposing }, repair }));
  }
  return { diagnostics, takeoff, traversal };
}

/** SPEC 0016 §3.1 (ADR 0092): a common action is written once per act; the
 * step that carries it, with the act's ruling, settles it. Rounds 162 and
 * 163 wrote the same carry or jump again in steps bound to success or
 * failure, and the repeat ran a second time. */
export function repeatedCommonActionDiagnostics(proposals: readonly unknown[]): ProposalDiagnostic[] {
  const seen = new Map<string, number>();
  return proposals.flatMap((entry, ordinal) => {
    if (!isRecord(entry) || entry.kind !== "worldInteraction" || !isRecord(entry.commonAction)) return [];
    const { kind, targetRef, destinationRef, option } = entry.commonAction;
    const key = JSON.stringify([kind, targetRef, destinationRef, option]);
    const first = seen.get(key);
    if (first === undefined) { seen.set(key, ordinal); return []; }
    return [proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:repeated", {
      path: ["proposals", ordinal, "commonAction"], actual: diagnosticActual(entry.commonAction),
      expected: { requirement: "this common action is already written on another step of this act, which settles it with the act's ruling; remove this step" },
      repair: { allowed: true, reason: "uncommitted-proposal-may-be-revised-once" } })];
  });
}

/** SPEC 0016 §3.1 (ADR 0092): the common-action problems a draft shows on
 * its own, read when it is refused before Room lowers it, so that revision
 * hears of them as well. The step a check decides is the one with a failure
 * result; the checks that need the room's state wait for lowering. */
export function draftCommonActionDiagnostics(draft: unknown): ProposalDiagnostic[] {
  if (!isRecord(draft) || draft.mode !== "adjudication" || !Array.isArray(draft.proposals) || !isRecord(draft.adjudication)) return [];
  const ruling = draft.adjudication;
  const decided = draft.proposals.flatMap((entry, ordinal) => isRecord(entry) && ["worldInteraction", "observe", "social"].includes(String(entry.kind))
    && isRecord(entry.branches) && isRecord(entry.branches.failure) ? [ordinal] : []);
  const owner = ruling.kind === "check" && decided.length === 1 ? decided[0] : undefined;
  const direct = { kind: "directSuccess", risk: "", successOutcome: "", failureOutcome: "" } as WorldInteractionAdjudication;
  return [...draft.proposals.flatMap((entry, ordinal) => {
    if (!isRecord(entry) || entry.kind !== "worldInteraction" || commonActionShapeIssue(entry.commonAction) !== undefined
      || !isRecord(entry.branches) || !isRecord(entry.branches.success) || !Array.isArray(entry.branches.success.sensoryEvidence)) return [];
    try {
      return commonActionDiagnostics(undefined, "", ordinal, entry as unknown as VNextWorldInteractionEntry & { commonAction: VNextCommonAction },
        (ordinal === owner ? ruling : direct) as unknown as WorldInteractionAdjudication);
    } catch { return []; }
  }), ...repeatedCommonActionDiagnostics(draft.proposals)];
}

/** The walk that carries the one just grabbed to where the player named,
 * only once the grab has succeeded. */
export function carryFollowUpEntry(entry: VNextWorldInteractionEntry & { commonAction: VNextCommonAction }, carryTo: VNextApproach,
  outcomeBinding: VNextWorldInteractionEntry["outcomeBinding"]): VNextWorldInteractionEntry {
  const target = entry.commonAction.targetRef!;
  // Round 165: "扛到炉边再放下" -- option putDown lets go on arrival, in the same step.
  const putDown: VNextWorldInteractionBranchProposal["effects"] = entry.commonAction.option === "putDown" ? [{ kind: "releaseGrapple", targetRef: target }] : [];
  return {
    ...withoutCommonAction(entry),
    consumes: [], produces: [], outcomeBinding,
    approach: carryTo,
    targetRefs: [target], directTargetRefs: [target], instrumentRefs: [], abilityRef: null,
    branches: { success: { outcomeCode: `${entry.branches.success.outcomeCode}:carried`, summary: entry.branches.success.summary,
      effects: putDown, sensoryEvidence: [], pressures: [], opportunities: [] }, failure: null },
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
    ? "hold" : ["dropProne", "standUp", "jumpOver", "jumpOnto", "climbFeature", "fallFrom"].includes(effect.kind) ? "posture" : effect.kind === "portalTransition" ? "door" : effect.kind;
  return group(left) === group(right);
}
