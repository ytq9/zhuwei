import type { AuthoritativeWorldState } from "../../rules";
import { planJumpTakeoff, planPlaceDeparture, placesReachableFrom, planTerrainTraversal, objectOperationPlan, objectMechanismTarget, terrainCheckRequirement } from "../../rules/authority-read";
import { isPlainRecord as isRecord } from "./canonical-json";
import { proposalDiagnostic, diagnosticActual, type ProposalDiagnostic } from "./proposal-diagnostics";
import { commonActionShapeIssue, VNEXT_COMMON_ACTION_KINDS, type VNextApproach, type VNextCommonAction, type VNextOppositionDeclaration, type VNextWorldInteractionBranchProposal,
  type VNextWorldInteractionEntry } from "./proposal-schema";
import type { WorldInteractionAdjudication } from "./proposals";

/** An effect as a step's branch carries it. */
type BranchEffect = VNextWorldInteractionBranchProposal["effects"][number];

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

/** Private compilation of a state-graph prefix; no event, resource or dice
 * is applied. Later close/unlock checks consume that declared state. */
export function previewObjectOperation(state: AuthoritativeWorldState, actorId: string, action: VNextCommonAction): AuthoritativeWorldState {
  if (action.kind !== "operateObject" || !action.targetRef) return state;
  const planned = objectOperationPlan(state, actorId, action.targetRef, action.option as "open" | "close" | "lock" | "unlock", true);
  if (planned.kind !== "accepted") return state;
  const next = structuredClone(state);
  if (planned.storage === "item") next.campaignRuntime.itemSystem.entries[action.targetRef].stateMachine = {
    schema: "zhuwei.lockable-object-state/v1", state: planned.toState as "open" | "closed" | "locked" };
  else {
    const feature = objectMechanismTarget(next, actorId, action.targetRef);
    if (feature?.storage === "feature") feature.feature.state = planned.toState;
  }
  return next;
}

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
  // SPEC 0014 §4 (ADR 0103): a passage the KP created has no door on the
  // map; the door script sets its own record open or closed.
  const passage = checked.passage;
  const effect: BranchEffect | undefined = effectGrabs(action, holding)
    ? { kind: "grapple", targetRef: target! }
    : action.kind === "carry" && action.option === "putDown" ? { kind: "releaseGrapple", targetRef: target! }
    : action.kind === "release" ? { kind: "releaseGrapple", targetRef: target! }
    : action.kind === "escape" ? { kind: "escapeGrapple", grapplerRef: target! }
    : action.kind === "shove" ? (action.option === "push" ? { kind: "shovePush", targetRef: target! } : { kind: "knockProne", targetRef: target! })
    : action.kind === "operateObject" && passage !== undefined ? { kind: "definitionRevision", definitionRef: target!,
      operations: [{ kind: "set", path: ["observableState"], value: action.option === "open" ? "open" : "closed" }], summary: entry.branches.success.summary }
    : action.kind === "operateObject" ? { kind: "objectStateTransition", targetRef: target!, intent: action.option as "open" | "close" | "lock" | "unlock" }
    : action.kind === "dropProne" ? { kind: "dropProne" }
    : action.kind === "standUp" ? { kind: "standUp" }
    : action.kind === "jump" && action.option === "up" ? { kind: "jumpOnto", featureRef: target! }
    : action.kind === "jump" ? { kind: "jumpOver", featureRef: target!, landProne: false }
    : action.kind === "hide" ? { kind: "hide" }
    : action.kind === "climb" || action.kind === "swim"
      ? { kind: "climbFeature", featureRef: target!, way: action.kind, direction: action.option as "down" | "up" | "across" }
    : action.kind === "fall" ? { kind: "fallFrom", featureRef: target! }
    : action.kind === "help" ? { kind: "grantHelp", allyRef: target! }
    : action.kind === "goTo" ? { kind: "travelTo", destinationRef: target! }
    : undefined;
  // A failed landing roll still lands, prone; a failed clearing roll hits the obstacle and stays.
  // A hide keeps its Stealth total whatever the primary observer saw, so it is written in both outcomes.
  const failureEffect: BranchEffect | undefined = action.kind === "jump" && action.option !== "up" && adjudication.kind === "check"
    && adjudication.skill === JUMP_LANDING_CHECK.skill ? { kind: "jumpOver", featureRef: target!, landProne: true }
    : action.kind === "hide" ? { kind: "hide" } : undefined;
  // The walk first: to where the jump, climb or swim starts, beside the one
  // acted on, to the place named, or as the KP wrote it. A fall happens where the actor is.
  // SPEC 0014 §4 (ADR 0103): a move to another place first walks to the
  // departure door, unless the actor already stands at it.
  const departure = checked.departure?.kind === "accepted" ? checked.departure : undefined;
  const approach: VNextApproach | undefined = departure !== undefined
    ? departure.walkTo === null ? undefined : { kind: "point", x: departure.walkTo.x, y: departure.walkTo.y }
    : start !== undefined ? { kind: "point", x: start.x, y: start.y }
    : action.kind === "walkTo" || (action.kind === "carry" && holding)
    ? { kind: "nextTo", ref: action.destinationRef! }
    : action.kind === "grapple" || action.kind === "carry" || action.kind === "shove"  || action.kind === "help"
      ? { kind: "nextTo", ref: target! }
      : action.kind === "operateObject" && passage === undefined
        ? (() => { const ref = objectMechanismTarget(state, actorId, target!)?.approachRef; return ref ? { kind: "nextTo" as const, ref } : entry.approach ?? undefined; })()
        : entry.approach ?? undefined;
  const withEffect = (branch: VNextWorldInteractionBranchProposal, added = effect): VNextWorldInteractionBranchProposal => added === undefined ? branch : {
    ...branch, effects: [...branch.effects.filter(written => !sameEffectGroup(written, added)), added] };
  // A walk, lying down and getting up, and going elsewhere act on the actor itself.
  const targets = [action.kind === "goTo" ? actorId : target ?? actorId];
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
  // A fall's only dice are its damage, which Rules rolls; helping is the KP's
  // judgement that the actor can help, and the ally rolls.
  const noRoll = action.kind === "walkTo" || action.kind === "dropProne" || action.kind === "standUp" || action.kind === "release"
    || action.kind === "fall" || action.kind === "help" || action.kind === "goTo";
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
  // SPEC 0014 §4 (ADR 0092): a door moves only along its own state graph.
  // Rules would refuse any other move at commit as a world ruling, which
  // the KP never gets to revise (round 167 opened the open yard door to go
  // out to the yard). The step is the KP's ruling, so a locked door opens
  // (SPEC 0004 §4). A passage the KP created opens unless it is open, and
  // closes when it is.
  const passage = action.kind === "operateObject" && state !== undefined && target !== null ? kpPassageState(state, target) : undefined;
  const portal = action.kind === "operateObject" && state !== undefined && target !== null && passage === undefined
    ? objectOperationPlan(state, actorId, target, action.option as "open" | "close" | "lock" | "unlock", true) : undefined;
  const unmoved = passage !== undefined
    ? (!["open", "close"].includes(String(action.option)) || (action.option === "open") === (passage === "open")) ? { fromState: passage, intents: [passage === "open" ? "close" : "open"] } : undefined
    : portal?.kind === "rejected" && portal.reason === "object:transition-unavailable" ? { fromState: portal.fromState, intents: portal.intents ?? [] } : undefined;
  // SPEC 0015 §11.1: a door of a place the KP created has no state graph or
  // durability until the KP completes it, in the act that first uses it.
  if (portal?.kind === "rejected" && portal.reason === "object:incomplete") {
    diagnostics.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:object-incomplete", {
      path: ["proposals", ordinal, "commonAction", "targetRef"], actual: diagnosticActual(target),
      expected: { requirement: "this object has no state mechanism: add completeObject with its existing reference and initial open, closed or locked state; declare map geometry/durability or retain the item's existing mechanics" },
      repair }));
  }
  // SPEC 0014 §4: the door script moves a door on this scene's map or a
  // passage the KP created. Anything else Rules would refuse at commit,
  // where the KP could not revise it.
  if (portal?.kind === "rejected" && portal.reason === "object:unavailable") {
    diagnostics.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:object-unknown", {
      path: ["proposals", ordinal, "commonAction", "targetRef"], actual: diagnosticActual(target),
      expected: { requirement: "an existing visible usable object with a declared state graph, or a passage from reachablePlaces",
        objects: sceneObjectRefs(state!, actorId) }, repair }));
  }
  if (unmoved !== undefined) {
    diagnostics.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:object-state", {
      path: ["proposals", ordinal, "commonAction", "option"], actual: diagnosticActual(action.option),
      expected: { objectState: unmoved.fromState, options: unmoved.intents,
        requirement: "an operation allowed by this object's current state graph; unlock removes the lock but leaves it closed; going to another place uses goTo" },
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
  // SPEC 0014 §4 (ADR 0103): going to another place follows the place map;
  // when Rules finds no open way the KP is told why, and where it can go.
  // SPEC 0006 §7: an NPC goes elsewhere by its own moveNpc.
  const npcGoes = action.kind === "goTo" && state?.entities[actorId]?.kind === "npc";
  if (npcGoes) diagnostics.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "place:player-actor-only", {
    path: ["proposals", ordinal, "commonAction", "kind"], actual: diagnosticActual(action.kind),
    expected: { requirement: "an NPC goes to another place with its own moveNpc effect" }, repair }));
  const departure = action.kind === "goTo" && state !== undefined && target !== null && !npcGoes
    ? planPlaceDeparture(state, actorId, target) : undefined;
  if (departure?.kind === "rejected") {
    const places = placesReachableFrom(state!, actorId).map(({ placeRef, label, open }) => ({ placeRef, label, open }));
    const closed = departure.closedRef === undefined ? undefined
      : placesReachableFrom(state!, actorId).find(place => place.closedRef === departure.closedRef);
    diagnostics.push(proposalDiagnostic("CONSTRAINT_CONFLICT", departure.reason, {
      path: ["proposals", ordinal, "commonAction", "targetRef"], actual: diagnosticActual(target),
      expected: { requirement: placeRequirement(departure.reason), reachablePlaces: places,
        ...(departure.closedRef === undefined ? {} : { closedRef: departure.closedRef,
          ...(closed?.closedLabel === undefined ? {} : { closedLabel: closed.closedLabel }) }) }, repair }));
  }
  return { diagnostics, takeoff, traversal, departure, passage };
}

/** The visible doors and openings of the actor's scene map, those in `states` if given. */
function sceneObjectRefs(state: AuthoritativeWorldState, actorId: string): string[] {
  const sceneId = state.entities[actorId]?.sceneId;
  const scene = sceneId === undefined ? undefined : state.combatRuntime.scenes[sceneId];
  const obstacles = isRecord(scene) && isRecord(scene.geometry) && Array.isArray(scene.geometry.obstacles) ? scene.geometry.obstacles : [];
  const refs = [...obstacles.flatMap(feature => isRecord(feature) && typeof feature.featureId === "string" ? [feature.featureId] : []),
    ...Object.keys(state.campaignRuntime.itemSystem.entries)];
  return refs.filter(ref => objectMechanismTarget(state, actorId, ref)?.graph).sort();
}

/** The open, closed or blocked a passage the KP created records, or
 * undefined when `ref` is not one. */
function kpPassageState(state: AuthoritativeWorldState, ref: string): string | undefined {
  const definition = state.campaignRuntime.definitions[ref];
  return definition?.semanticKind === "passage" && isRecord(definition.content) && typeof definition.content.observableState === "string"
    ? definition.content.observableState : undefined;
}

function placeRequirement(reason: string): string {
  switch (reason) {
    case "place:no-open-route": return "every way there passes a closed or locked door: this act can only open it (commonAction operateObject, targetRef closedRef; locked or stuck: a check to pick it (skill thieves-tools) or force it, at your DC; no check with its key) and the next act go through, or rule in the world that the actor cannot get there";
    case "place:no-route": return "a place connected to this one, from reachablePlaces";
    case "place:unknown-destination": return "a placeRef from reachablePlaces; a place not listed there is created with materializeObject location and passage first";
    case "place:already-here": return "a place other than the one the actor is in";
    case "place:in-encounter": return "outside an encounter; inside one the actor moves on its turn";
    case "place:actor-cannot-move": return "an actor able to move";
    case "place:no-room-at-departure": return "the way out is taken by others standing at the door; rule that the actor cannot get through now";
    default: return "a place the actor can go to now";
  }
}

/** SPEC 0016 §3.1 (ADR 0092): a common action is written once per act; the
 * step that carries it, with the act's ruling, settles it. Rounds 162 and
 * 163 wrote the same carry or jump again in steps bound to success or
 * failure, and the repeat ran a second time. */
export function repeatedCommonActionDiagnostics(proposals: readonly unknown[]): ProposalDiagnostic[] {
  const seen = new Map<string, number>(), terrain = new Set<string>();
  const repair = { allowed: true, reason: "uncommitted-proposal-may-be-revised-once" } as const;
  return proposals.flatMap((entry, ordinal) => {
    if (!isRecord(entry) || entry.kind !== "worldInteraction" || !isRecord(entry.commonAction)
      || !(VNEXT_COMMON_ACTION_KINDS as readonly string[]).includes(String(entry.commonAction.kind))) return [];
    const { kind, targetRef, destinationRef, option } = entry.commonAction;
    const key = JSON.stringify([kind, targetRef, destinationRef, option]);
    const first = seen.get(key);
    if (first !== undefined) return [proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:repeated", {
      path: ["proposals", ordinal, "commonAction"], actual: diagnosticActual(entry.commonAction),
      expected: { requirement: "this common action is already written on another step of this act, which settles it with the act's ruling; remove this step" },
      repair })];
    seen.set(key, ordinal);
    // SPEC 0014 §4 (ADR 0098): each climb or swim is planned from where the
    // actor stands before the act, so a second one of the same feature in
    // the act cannot be (round 167 wrote down, then up the far side, and the
    // second step was refused because the actor was not yet in the ditch).
    if (kind !== "climb" && kind !== "swim") return [];
    const feature = JSON.stringify([kind, targetRef]);
    if (!terrain.has(feature)) { terrain.add(feature); return []; }
    return [proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:terrain-one-per-act", {
      path: ["proposals", ordinal, "commonAction"], actual: diagnosticActual(entry.commonAction),
      expected: { requirement: `one ${kind} of this feature per act: down into it and out the far side is a single step with option across; any other second ${kind} of it waits for the next act, so remove this step` },
      repair })];
  });
}

/** SPEC 0014 §4 (ADR 0092): a world step aimed at a shut door of the map,
 * in an act where no step opens, shuts or attacks that door, leaves the door
 * shut whatever its texts say (round 175: "the oak door swings open" with no
 * door script, twice). It goes back to the KP, which either moves the door
 * with the script or, when the door stays as it is, takes it out of the
 * step's direct targets. */
export function unmovedObjectDiagnostics(state: AuthoritativeWorldState, actorId: string, proposals: readonly unknown[]): ProposalDiagnostic[] {
  const scene = state.combatRuntime.scenes[state.entities[actorId]?.sceneId];
  const geometry = isRecord(scene?.geometry) && Array.isArray(scene.geometry.obstacles) ? scene.geometry.obstacles : [];
  const refs = [...geometry.flatMap(feature => isRecord(feature) && typeof feature.featureId === "string" ? [feature.featureId] : []),
    ...Object.keys(state.campaignRuntime.itemSystem.entries)];
  const shut = new Set(refs.filter(ref => { const target = objectMechanismTarget(state, actorId, ref); return target?.graph && ["closed", "locked"].includes(String(target.state)); }));
  if (shut.size === 0) return [];
  const steps = proposals.flatMap((entry, ordinal) => isRecord(entry) && entry.kind === "worldInteraction" ? [{ entry, ordinal }] : []);
  const moved = new Set<string>();
  for (const { entry } of steps) {
    if (isRecord(entry.commonAction) && entry.commonAction.kind === "operateObject" && typeof entry.commonAction.targetRef === "string") moved.add(entry.commonAction.targetRef);
    // An attack on the door damages it; Rules settles what that does.
    if (typeof entry.abilityRef === "string" && Array.isArray(entry.directTargetRefs)) for (const ref of entry.directTargetRefs) moved.add(String(ref));
    const branches = isRecord(entry.branches) ? [entry.branches.success, entry.branches.failure] : [];
    for (const branch of branches) if (isRecord(branch) && Array.isArray(branch.effects)) for (const effect of branch.effects) {
      if (isRecord(effect) && effect.kind === "objectStateTransition" && typeof effect.targetRef === "string") moved.add(effect.targetRef);
    }
  }
  const repair = { allowed: true, reason: "uncommitted-proposal-may-be-revised-once" } as const;
  const told = new Set<string>();
  return steps.flatMap(({ entry, ordinal }) => {
    if (isRecord(entry.commonAction) && entry.commonAction.kind !== "none") return [];
    const doors = (Array.isArray(entry.directTargetRefs) ? entry.directTargetRefs : [])
      .filter((ref): ref is string => typeof ref === "string" && shut.has(ref) && !moved.has(ref) && !told.has(ref));
    for (const door of doors) told.add(door);
    return doors.map(door => proposalDiagnostic("CONSTRAINT_CONFLICT", "commonAction:object-unmoved", {
      path: ["proposals", ordinal, "directTargetRefs"], actual: diagnosticActual(door),
      expected: { requirement: "this step targets a closed object but records no operation: use commonAction operateObject with the intended open, close, lock or unlock operation; if the object remains unchanged, remove it from directTargetRefs" },
      repair }));
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
 * the KP also wrote of the same kind, or of the same passage's record. */
function sameEffectGroup(left: BranchEffect, right: BranchEffect): boolean {
  const group = (effect: BranchEffect) => ["grapple", "knockProne", "releaseGrapple", "escapeGrapple", "shovePush"].includes(effect.kind)
    ? "hold" : ["dropProne", "standUp", "jumpOver", "jumpOnto", "climbFeature", "fallFrom"].includes(effect.kind) ? "posture"
    : effect.kind === "objectStateTransition" ? "objectState" : effect.kind === "definitionRevision" ? `revision:${effect.definitionRef}` : effect.kind;
  return group(left) === group(right);
}
