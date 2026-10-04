import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR }
  from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { authoritativeModuleProfile } from "../../../app/_runtime/lib/module/authoritative.ts";
import { createDefinitionSnapshot, storedSemanticDefinition } from "../../../app/_runtime/lib/rules/v2/semantic-definitions.ts";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { combatJumpOptions } from "../../../app/_runtime/lib/rules/v2/combat-jump.ts";
import { planJump } from "../../../app/_runtime/lib/rules/v2/character-jump.ts";
import { planTerrainFall, planTerrainMove } from "../../../app/_runtime/lib/rules/v2/terrain-traversal.ts";
import { planJumpTakeoff, planTerrainTraversal } from "../../../app/_runtime/lib/rules/authority-read.ts";
import { atomicCompletionInput } from "../../support/fixtures/vnext-action-duration.mjs";
import { committedActionRange } from "../../support/fixtures/vnext-action-lifecycle.mjs";

// SPEC 0014 §4 (ADR 0098), step 3 of 3: the combat map jumps, climbs and
// swims. A long or high jump on the creature's own turn goes straight to
// Rules (ADR 0091) and spends a foot of movement for each foot jumped; a
// running start is 10 feet moved on foot this turn since the last jump, climb
// or stand-up. Clearing a low obstacle takes Athletics DC 10 (a failure hits
// it and stays), landing in difficult terrain Acrobatics DC 10 (a failure
// lands prone); the player rolls them. Climbing, swimming and falling come
// from the KP as world-interaction effects, accepted inside an encounter on
// the actor's own turn, from where it stands, within the movement it has
// left -- double for a climb without a climbing speed.

const SCENE = "yard";
const DITCH = "feature:yard:drainage-ditch";
const WALL = "feature:yard:low-stone-wall";
const RUBBLE = "feature:test:rubble";
const GUARD = "character:probe-guard";
const ENCOUNTER = "encounter:yard-fight";
const SOURCE = "definition:test:yard-terrain";
const point = (x, y, elevation = "0") => ({ x, y, elevation });
const rectangle = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

const yard = (await authoritativeModuleProfile("black-oak-will")).storyBible.storyAnchors.locations
  .find(location => location.sceneId === SCENE).tacticalGeometry;
/** Broken stones west of the ditch, where a jump across it lands. */
const RUBBLE_FEATURE = { featureId: RUBBLE, kind: "terrain", label: "碎石", state: "difficult", polygon: rectangle("-500", "-300", "-421", "-120"),
  elevation: "0", height: "6", opaque: false, impassable: false, cover: "none", propagation: "passes", terrain: "rubble",
  visibilityPolicyId: "visibility:public" };

/** East of the ditch, 10 feet back; flush against the ditch's east side; east
 * of the wall 10 feet back; flush against the wall's west side. */
const RUN_TO_DITCH = point("-210", "-210"), BY_DITCH = point("-330", "-210");
const RUN_TO_WALL = point("210", "-210"), BY_WALL = point("330", "-210");
const STRONG = { abilityScores: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } };

/** The yard with the rubble, the actor at `spawn` with Strength 16 and a
 * guard far off; an encounter starts and it is the actor's turn. */
function fighting(name, spawn, { rubble = false } = {}) {
  const geometry = { ...yard, spawnPoints: [spawn, point("300", "300")],
    obstacles: [...yard.obstacles, ...(rubble ? [RUBBLE_FEATURE] : [])].sort((left, right) => left.featureId.localeCompare(right.featureId)) };
  const source = storedSemanticDefinition("sceneFeature", "visibility:scene-observers", createDefinitionSnapshot(SOURCE, "1", {
    sceneRef: SCENE, label: "后院地形", description: "排水沟与矮石墙。", mechanicDefinitionRefs: [DITCH, WALL],
    observableState: "ready", affordances: ["interact"] }));
  const f = createAuthoredProbeFixture(`combat-terrain:${name}`, { additionalScenes: [{ id: SCENE, name: "后院", geometry }],
    characterScenes: { [ACTOR]: SCENE, [GUARD]: SCENE }, npcCharacters: [{ id: GUARD, name: "守卫" }],
    semanticDefinitions: [source], characterOverrides: { [ACTOR]: STRONG } });
  const events = [];
  let state = f.state;
  const opened = settle(f, state, f.runtime.step(f.profiles, state, { kind: "startEncounter", rootActionId: `root:${name}:fight`,
    proposalAttemptId: `proposal:${name}:fight`, encounterId: ENCOUNTER, sceneId: SCENE, participantEntityIds: [ACTOR, GUARD],
    dynamicEntities: [], initiativeGroups: [{ entryId: "initiative:actor", combatantEntityIds: [ACTOR] },
      { entryId: "initiative:guard", combatantEntityIds: [GUARD] }],
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [GUARD] }, { fromEntityIds: [GUARD], toEntityIds: [ACTOR] }],
    battlefieldFactIds: [] }), { [`initiative:${ACTOR}`]: [20], [`initiative:${GUARD}`]: [1] });
  assert.equal(opened.kind, "committed", JSON.stringify(opened.rejection ?? opened.kind));
  events.push(...opened.events);
  state = opened.state;
  assert.equal(state.combatRuntime.encounters[ENCOUNTER].activeEntityId, ACTOR);
  return { ...f, initial: f.state, state, events };
}

/** Drives a combat step through its authoritative dice: each request takes
 * its faces from `faces` by purpose, else 10s. */
function settle(f, state, result, faces = {}) {
  const events = [...(result.events ?? [])];
  let current = result;
  while (current.kind === "awaitingRandomness") {
    const input = { kind: "authoritativeRandomness", resolutionId: current.resolutionId,
      responseId: `response:${current.resolutionId}`, continuationCapability: current.continuationCapability,
      randomnessResults: current.randomnessRequests.map(request => {
        const tape = [...(faces[request.purposeKey] ?? [])];
        return { randomnessId: request.randomnessId, requestHash: request.requestHash,
          draws: request.dice.map(die => ({ sides: Number(die.sides),
            faces: Array.from({ length: Number(die.count) }, () => tape.shift() ?? 10) })) };
      }) };
    current = f.runtime.step(f.profiles, current.state, input);
    events.push(...(current.events ?? []));
  }
  return { ...current, events };
}

function step(f, scenario, input, faces) {
  const result = settle(f, scenario.state, f.runtime.step(f.profiles, scenario.state, input), faces);
  assert.equal(result.kind, "committed", JSON.stringify(result.rejection ?? result.kind));
  return { ...scenario, state: result.state, events: [...scenario.events, ...result.events], last: result };
}

function walk(f, scenario, suffix, to) {
  const from = scenario.state.combatRuntime.entities[ACTOR].position;
  return step(f, scenario, { kind: "moveCombatant", rootActionId: `root:${suffix}`, encounterId: ENCOUNTER, sourceEntityId: ACTOR,
    movementMode: "walk", path: [from, to] });
}

const jumpInput = (suffix, abilityRef, to) => ({ kind: "invokeAbility", rootActionId: `root:${suffix}`, sourceEntityId: ACTOR, abilityRef,
  parameters: { targetPoint: to } });

const body = scenario => scenario.state.combatRuntime.entities[ACTOR];
const spent = scenario => body(scenario).movement.spentMilliInches;
const ofType = (events, type) => events.filter(event => event.eventType === type);

function replayed(f, scenario) {
  const replay = f.runtime.replay(f.genesis, scenario.events);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  assert.deepEqual(replay.state, scenario.state, "replay rebuilds the same state");
}

test("a running long jump across the ditch and a high jump onto the wall spend a foot of movement per foot", () => {
  let fight = fighting("long-jump", RUN_TO_DITCH);
  const f = fight;
  // Standing still, Strength 16 reaches 8 feet; the ditch's far side is 10
  // feet off, so nothing is offered until it has run 10 feet.
  let walked = walk(f, fight, "walk-east-of-ditch", point("-300", "-210"));
  assert.deepEqual(combatJumpOptions(walked.state, ACTOR).filter(option => option.featureId === DITCH), [],
    "a 7.5-foot run is no running start, and 8 feet standing is short of the far side");
  fight = walk(f, fight, "run-to-ditch", BY_DITCH);
  assert.equal(spent(fight), "120000");
  const [across] = combatJumpOptions(fight.state, ACTOR).filter(option => option.featureId === DITCH);
  assert.deepEqual(across, { abilityRef: "action:long-jump", featureId: DITCH, from: BY_DITCH, to: point("-450", "-210"), running: true,
    costMilliInches: "120000", clearCheck: false, landingCheck: false });
  fight = step(f, fight, jumpInput("jump-ditch", "action:long-jump", across.to));
  assert.deepEqual(ofType(fight.last.events, "CharacterJumped").map(event => event.payload),
    [{ characterId: ACTOR, sceneId: SCENE, featureId: DITCH, from: BY_DITCH, to: across.to, running: true }]);
  assert.deepEqual(body(fight).position, across.to);
  assert.deepEqual(body(fight).movement, { spentMilliInches: "240000", runUpFromMilliInches: "240000" });
  const invoked = ofType(fight.last.events, "AbilityInvoked")[0].payload;
  assert.deepEqual([invoked.abilityRef, invoked.mechanicalResult.jump.outcome, invoked.mechanicalResult.jump.checks],
    ["action:long-jump", "landed", []]);
  // The narration reads the committed jump as it reads any combat action.
  const view = f.runtime.project(f.profiles, fight.state, f.viewer, { channel: "realtime", committedRange: committedActionRange(fight.state, {
    receiptId: fight.last.receipt.receiptId, actorCharacterId: ACTOR, priorState: f.initial, events: fight.events }) });
  assert.equal(view.kind, "projected", JSON.stringify(view));
  assert.ok(view.committedDelta?.changes.length > 0, JSON.stringify(view.committedDelta));
  // The run is spent: a second jump right after is from a standing start.
  assert.equal(planJump(fight.state, ACTOR, DITCH).kind, "rejected");
  replayed(f, fight);

  // High jump: 10 feet run up to the wall, then 3 + 3 = 6 feet clears its 3.
  let wall = fighting("high-jump", RUN_TO_WALL);
  wall = walk(wall, wall, "run-to-wall", BY_WALL);
  const onto = combatJumpOptions(wall.state, ACTOR).find(option => option.abilityRef === "action:high-jump" && option.featureId === WALL);
  assert.deepEqual([onto.to, onto.running, onto.costMilliInches], [point("361", "-210", "36"), true, "67000"]);
  wall = step(wall, wall, jumpInput("jump-wall", "action:high-jump", onto.to));
  assert.deepEqual(ofType(wall.last.events, "CharacterJumpedOnto").map(event => [event.payload.to, event.payload.running]),
    [[onto.to, true]]);
  assert.deepEqual([body(wall).position, spent(wall)], [onto.to, "187000"]);
  replayed(wall, wall);
  // A landing nobody was offered is refused, and so is a jump off its turn.
  assert.equal(f.runtime.step(f.profiles, fight.state, jumpInput("nowhere", "action:long-jump", point("-450", "-270"))).kind, "rejected");
  const waiting = step(f, walked, { kind: "endTurn", rootActionId: "root:actor-ends", encounterId: ENCOUNTER, sourceEntityId: ACTOR });
  assert.deepEqual(combatJumpOptions(waiting.state, ACTOR), []);
  assert.deepEqual(planJump(waiting.state, ACTOR, DITCH), { kind: "rejected", code: "missingPrerequisite", reason: "jump:not-own-turn" });
  // The KP does not write jumps inside an encounter; the map makes them.
  assert.deepEqual(planJumpTakeoff(fight.state, ACTOR, DITCH), { kind: "rejected", code: "missingPrerequisite", reason: "jump:inside-encounter" });
  assert.deepEqual(planTerrainTraversal(wall.state, ACTOR, WALL, { kind: "jumpOnto" }),
    { kind: "rejected", code: "missingPrerequisite", reason: "terrain:inside-encounter" });
});

test("clearing a low obstacle takes Athletics DC 10: a failure hits it and stays, the movement spent", () => {
  let wall = fighting("clear", RUN_TO_WALL);
  wall = walk(wall, wall, "run-to-wall", BY_WALL);
  const over = combatJumpOptions(wall.state, ACTOR).find(option => option.abilityRef === "action:long-jump" && option.featureId === WALL);
  assert.deepEqual([over.to, over.costMilliInches, over.clearCheck, over.landingCheck], [point("402", "-210"), "72000", true, false]);
  // The player rolls it as its own check, through the normal pending roll.
  const asked = wall.runtime.step(wall.profiles, wall.state, jumpInput("jump-over-wall", "action:long-jump", over.to));
  assert.equal(asked.kind, "awaitingRandomness");
  assert.deepEqual(asked.randomnessRequests.map(request => [request.purposeKey, request.diceExpression, request.frozenParameters]),
    [[`check:jump-clear:${ACTOR}`, "1d20", { sourceEntityId: ACTOR, ability: "str", skill: "athletics", dc: 10, goal: "越过障碍", modifier: 3, mode: "normal" }]]);
  const blocked = step(wall, wall, jumpInput("jump-over-wall", "action:long-jump", over.to), { [`check:jump-clear:${ACTOR}`]: [2] });
  assert.deepEqual(ofType(blocked.last.events, "CharacterJumped"), []);
  assert.deepEqual([body(blocked).position, body(blocked).movement], [BY_WALL, { spentMilliInches: "192000", runUpFromMilliInches: "192000" }]);
  const jump = ofType(blocked.last.events, "AbilityInvoked")[0].payload.mechanicalResult.jump;
  assert.deepEqual([jump.outcome, jump.to, jump.checks.map(check => [check.skill, check.roll, check.total, check.success])],
    ["blocked", BY_WALL, [["athletics", 2, 5, false]]]);
  replayed(wall, blocked);
  // A 15 clears it and lands on the far side.
  const cleared = step(wall, wall, jumpInput("jump-over-wall", "action:long-jump", over.to), { [`check:jump-clear:${ACTOR}`]: [15] });
  assert.deepEqual([body(cleared).position, spent(cleared)], [over.to, "192000"]);
  replayed(wall, cleared);
});

test("landing in rubble takes Acrobatics DC 10: a failure lands prone where the jump took it", () => {
  let fight = fighting("rubble", RUN_TO_DITCH, { rubble: true });
  fight = walk(fight, fight, "run-to-ditch", BY_DITCH);
  const across = combatJumpOptions(fight.state, ACTOR).find(option => option.featureId === DITCH);
  assert.deepEqual([across.to, across.clearCheck, across.landingCheck], [point("-450", "-210"), false, true]);
  const fallen = step(fight, fight, jumpInput("jump-into-rubble", "action:long-jump", across.to), { [`check:jump-landing:${ACTOR}`]: [3] });
  assert.deepEqual(ofType(fallen.last.events, "CharacterJumped").map(event => event.payload.to), [across.to]);
  assert.deepEqual([body(fallen).position, body(fallen).conditions.prone, spent(fallen)], [across.to, true, "240000"]);
  assert.deepEqual(ofType(fallen.last.events, "AbilityInvoked")[0].payload.mechanicalResult.jump.outcome, "landedProne");
  replayed(fight, fallen);
  // Prone, it stands before it jumps again.
  assert.deepEqual(planJump(fallen.state, ACTOR, RUBBLE), { kind: "rejected", code: "missingPrerequisite", reason: "jump:prone" });
  const steady = step(fight, fight, jumpInput("jump-into-rubble", "action:long-jump", across.to), { [`check:jump-landing:${ACTOR}`]: [12] });
  assert.equal(body(steady).conditions.prone, undefined);
});

// The KP's side: a sentence from the map's climb control becomes a world
// interaction whose outcome carries the climb or the fall.
const outcome = (code, summary) => ({ outcomeCode: `outcome:${code}`, summary, effects: [], sensoryEvidence: [], pressures: [], opportunities: [] });
// Inside an encounter the act takes the turn, not a duration.
const DIRECT = { kind: "directSuccess", durationMicros: "none", risk: "没有风险。", successOutcome: "过去了。" };
const athletics = dc => ({ kind: "check", durationMicros: "none", checkKind: "abilityCheck", ability: "str", skill: "athletics", dc,
  mode: "normal", risk: "可能摔下去。", successOutcome: "过去了。", failureOutcome: "没抓稳。" });
const climb = (featureRef, direction) => ({ kind: "climbFeature", featureRef, way: "climb", direction });

function bundle(adjudication) {
  return { mode: "adjudication", basisRefs: [SOURCE], terminal: { kind: "none" }, adjudication,
    proposals: [{ basisRefs: [SOURCE], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "翻越地形。", method: "手脚并用。", targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: outcome("moved", "过去了。"),
        failure: adjudication.kind === "check" ? outcome("slipped", "没抓稳。") : { kind: "none" } } }] };
}

/** The KP's step on the terrain, lowered in the fight, with these effects
 * bound to its outcomes. */
function kpAct(f, scenario, suffix, { adjudication = DIRECT, featureRef, success = [], failure = [] }) {
  const rootActionId = `${f.rootActionId}:${suffix}`;
  const requiredContext = freezeAuthoredProbeContext(f, scenario.state, { rootActionId, focusRefs: [SOURCE] }).context;
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle(adjudication))));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  const lowered = lowerVNext2ProposalBundle({ ...f, state: scenario.state, rootActionId, requiredContext, value: parsed.bundle });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const input = structuredClone(atomicCompletionInput(lowered.command.rulesInput));
  const plan = input.steps[0].rulesInput.plan;
  plan.targetRefs = [SOURCE, featureRef]; plan.directTargetRefs = [SOURCE, featureRef];
  plan.branches.success.effects = success;
  plan.branches.failure.effects = failure;
  return input;
}

function kpStep(f, scenario, input, rolls) {
  let result = f.runtime.step(f.profiles, scenario.state, input);
  const events = [...(result.events ?? [])];
  if (rolls !== undefined) {
    assert.equal(result.kind, "awaitingRandomness", JSON.stringify(result.rejection ?? result.kind));
    result = f.runtime.step(f.profiles, result.state, { kind: "fulfillAuthoritativeRandomness",
      continuation: JSON.parse(JSON.stringify(result.continuation)), rolls });
    events.push(...(result.events ?? []));
  }
  return { result, scenario: result.kind === "committed" ? { ...scenario, state: result.state, events: [...scenario.events, ...events], last: { events } } : scenario };
}

test("in an encounter the KP's climb spends double movement on the actor's turn, and is refused when too little is left", () => {
  let fight = fighting("climb", BY_DITCH);
  const f = fight;
  // Down 3 feet and 5 across: 8 feet, 16 of movement without a climbing speed.
  const down = kpStep(f, fight, kpAct(f, fight, "down", { featureRef: DITCH, success: [climb(DITCH, "down")] }));
  assert.equal(down.result.kind, "committed", JSON.stringify(down.result.rejection));
  fight = down.scenario;
  assert.deepEqual(ofType(fight.last.events, "CharacterClimbed").map(event => [event.payload.to, event.payload.movementCostMilliInches]),
    [[point("-390", "-210", "-36"), "192000"]]);
  assert.deepEqual(body(fight).movement, { spentMilliInches: "192000", runUpFromMilliInches: "192000" });
  replayed(f, fight);
  // Up again needs 16 more; 14 are left. The plan the KP reads says so, and
  // the act is refused before anything moves.
  assert.deepEqual(planTerrainTraversal(fight.state, ACTOR, DITCH, { kind: "climb", direction: "up" }),
    { kind: "rejected", code: "worldLawViolation", reason: "terrain:movement-exhausted" });
  const up = kpStep(f, fight, kpAct(f, fight, "up", { featureRef: DITCH, success: [climb(DITCH, "up")] }));
  assert.equal(up.result.kind, "rejected");
  assert.match(JSON.stringify(up.result.rejection), /terrain:movement-exhausted/u);
  // After a Dash it has the movement.
  fight = step(f, fight, { kind: "invokeAbility", rootActionId: "root:dash", sourceEntityId: ACTOR, abilityRef: "action:dash", parameters: {} });
  const out = kpStep(f, fight, kpAct(f, fight, "up-after-dash", { featureRef: DITCH, success: [climb(DITCH, "up")] }));
  assert.equal(out.result.kind, "committed", JSON.stringify(out.result.rejection));
  assert.deepEqual([body(out.scenario).position, spent(out.scenario)], [BY_DITCH, "384000"]);
  replayed(f, out.scenario);
  // Nobody walks to the start of a climb inside an encounter: from the far
  // side of the yard the climb is refused where the actor stands.
  const far = fighting("climb-far", point("-120", "300"));
  assert.deepEqual(planTerrainTraversal(far.state, ACTOR, DITCH, { kind: "climb", direction: "down" }),
    { kind: "rejected", code: "missingPrerequisite", reason: "terrain:not-beside" });
  // Off its turn the actor does not climb.
  const waiting = step(f, fight, { kind: "endTurn", rootActionId: "root:climber-ends", encounterId: ENCOUNTER, sourceEntityId: ACTOR });
  assert.deepEqual(planTerrainMove(waiting.state, ACTOR, DITCH, { kind: "climb", direction: "up" }),
    { kind: "rejected", code: "missingPrerequisite", reason: "terrain:not-own-turn" });
});

test("the KP's climb script works inside an encounter: it starts where the actor stands and walks nowhere", () => {
  const fight = fighting("climb-script", BY_DITCH);
  const scripted = { mode: "adjudication", basisRefs: [SOURCE], terminal: { kind: "none" }, adjudication: DIRECT,
    proposals: [{ basisRefs: [SOURCE], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "爬下排水沟。", method: "手脚并用。", targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: { kind: "none" },
      commonAction: { kind: "climb", targetRef: DITCH, destinationRef: null, option: "down" },
      branches: { success: outcome("down", "下去了。"), failure: null } }] };
  const rootActionId = `${fight.rootActionId}:climb-script`;
  const requiredContext = freezeAuthoredProbeContext(fight, fight.state, { rootActionId, focusRefs: [SOURCE] }).context;
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(scripted)));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  const lowered = lowerVNext2ProposalBundle({ ...fight, state: fight.state, rootActionId, requiredContext, value: parsed.bundle });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const input = atomicCompletionInput(lowered.command.rulesInput);
  assert.deepEqual(input.steps[0].rulesInput.plan.approach, { kind: "point", position: BY_DITCH }, "the script names where the climb starts");
  const climbed = kpStep(fight, fight, input);
  assert.equal(climbed.result.kind, "committed", JSON.stringify(climbed.result.rejection));
  assert.deepEqual(ofType(climbed.scenario.last.events, "CharacterRepositioned"), []);
  assert.deepEqual([body(climbed.scenario).position, spent(climbed.scenario)], [point("-390", "-210", "-36"), "192000"]);
  replayed(fight, climbed.scenario);
  // A walk anywhere else is still refused inside the encounter.
  const elsewhere = structuredClone(input);
  elsewhere.steps[0].rulesInput.plan.approach = { kind: "point", position: point("-330", "-150") };
  const refusedWalk = fight.runtime.step(fight.profiles, fight.state, elsewhere);
  assert.equal(refusedWalk.kind, "rejected");
  assert.match(JSON.stringify(refusedWalk.rejection), /approach:in-encounter/u);
});

test("in an encounter a failed climb's fall drops the actor into the ditch prone, spending no movement", () => {
  let fight = fighting("fall", RUN_TO_DITCH);
  const f = fight;
  fight = walk(f, fight, "walk-to-ditch", BY_DITCH);
  const input = kpAct(f, fight, "fall", { adjudication: athletics(12), featureRef: DITCH,
    success: [climb(DITCH, "down")], failure: [{ kind: "fallFrom", featureRef: DITCH }] });
  const fell = kpStep(f, fight, input, [3]);
  assert.equal(fell.result.kind, "committed", JSON.stringify(fell.result.rejection));
  fight = fell.scenario;
  assert.deepEqual(ofType(fight.last.events, "CharacterFell").map(event => [event.payload.to, event.payload.dropInches, event.payload.landedProne]),
    [[point("-390", "-210", "-36"), "36", true]]);
  assert.deepEqual([body(fight).conditions.prone, body(fight).movement], [true, { spentMilliInches: "120000", runUpFromMilliInches: "120000" }]);
  assert.deepEqual(planTerrainFall(fight.state, ACTOR, DITCH).dropInches, "18");
  replayed(f, fight);
});
