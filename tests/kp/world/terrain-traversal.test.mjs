import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR }
  from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { authoritativeModuleProfile } from "../../../app/_runtime/lib/module/authoritative.ts";
import { createDefinitionSnapshot, storedSemanticDefinition } from "../../../app/_runtime/lib/rules/v2/semantic-definitions.ts";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { analyzeCombatMovement } from "../../../app/_runtime/lib/rules/profiles/combat-geometry.ts";
import { planJump } from "../../../app/_runtime/lib/rules/v2/character-jump.ts";
import { planSceneApproach } from "../../../app/_runtime/lib/rules/v2/scene-approach.ts";
import { planTerrainFall, planTerrainMove } from "../../../app/_runtime/lib/rules/v2/terrain-traversal.ts";
import { planTerrainTraversal } from "../../../app/_runtime/lib/rules/authority-read.ts";
import { committedActionRange, stepActionToDecision } from "../../support/fixtures/vnext-action-lifecycle.mjs";
import { atomicCompletionInput } from "../../support/fixtures/vnext-action-duration.mjs";

// SPEC 0014 §4 (ADR 0098), step 2 of 3: outside encounters a creature climbs
// down into the yard's ditch and back out, across it, onto and over the low
// wall, swims, makes a high jump and falls. Rules plans where each move
// starts and ends and replays it; the KP decides whether it takes a roll and
// may put a fall on the failure. Inside a hollow a creature walks only within
// it; on top of a raised feature only along its top.

const SCENE = "yard";
const DITCH = "feature:yard:drainage-ditch";
const WALL = "feature:yard:low-stone-wall";
const POND = "feature:test:pond";
const CLIFF = "feature:test:cliff";
const SOURCE = "definition:test:yard-terrain";
const rectangle = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const point = (x, y, elevation = "0") => ({ x, y, elevation });

const yard = (await authoritativeModuleProfile("black-oak-will")).storyBible.storyAnchors.locations
  .find(location => location.sceneId === SCENE).tacticalGeometry;
/** Still water 4 feet deep, 10 by 10 feet, west of the cliff. */
const POND_FEATURE = { featureId: POND, kind: "terrain", label: "水塘", state: "still", polygon: rectangle("-240", "-360", "-120", "-240"),
  elevation: "0", height: "1", opaque: false, impassable: true, cover: "none", propagation: "passes",
  landform: "water", depth: "48", current: "still", material: "stone", visibilityPolicyId: "visibility:public" };
/** A 25-foot stone cliff, its top 10 by 10 feet. */
const CLIFF_FEATURE = { featureId: CLIFF, kind: "barrier", label: "崖壁", state: "intact", polygon: rectangle("0", "-360", "120", "-240"),
  elevation: "0", height: "300", opaque: true, impassable: true, cover: "full", propagation: "blocks",
  landform: "cliff", material: "stone", visibilityPolicyId: "visibility:public" };

/** Flush against the ditch's east side, the wall's west side, the pond's east side and the cliff's south side. */
const BY_DITCH = point("-330", "-210"), BY_WALL = point("330", "-210"), BY_POND = point("-90", "-300"), BY_CLIFF = point("60", "-210");
const STRONG = { abilityScores: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } };
const WEAK = { abilityScores: { str: 6, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } };

/** The V3 yard with a pond and a cliff added, the actor arriving at `spawn`. */
function fixture(name, spawn, actor = {}) {
  const geometry = { ...yard, spawnPoints: [spawn, point("-300", "180")],
    obstacles: [...yard.obstacles, POND_FEATURE, CLIFF_FEATURE].sort((left, right) => left.featureId.localeCompare(right.featureId)) };
  const source = storedSemanticDefinition("sceneFeature", "visibility:scene-observers", createDefinitionSnapshot(SOURCE, "1", {
    sceneRef: SCENE, label: "后院地形", description: "排水沟、矮石墙、水塘和崖壁。", mechanicDefinitionRefs: [CLIFF, DITCH, WALL, POND],
    observableState: "ready", affordances: ["interact"] }));
  return createAuthoredProbeFixture(`terrain-traversal:${name}`, { additionalScenes: [{ id: SCENE, name: "后院", geometry }],
    characterScenes: { [ACTOR]: SCENE }, semanticDefinitions: [source], characterOverrides: { [ACTOR]: actor } });
}

const outcome = (code, summary) => ({ outcomeCode: `outcome:${code}`, summary, effects: [], sensoryEvidence: [], pressures: [], opportunities: [] });
const DIRECT = { kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。", successOutcome: "过去了。" };
const athletics = dc => ({ kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "str", skill: "athletics", dc,
  mode: "normal", risk: "可能摔下来。", successOutcome: "过去了。", failureOutcome: "没抓稳。" });
const climb = (featureRef, direction, way = "climb") => ({ kind: "climbFeature", featureRef, way, direction });

function bundle(adjudication) {
  return { mode: "adjudication", basisRefs: [SOURCE], terminal: { kind: "none" }, adjudication,
    proposals: [{ basisRefs: [SOURCE], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "翻越地形。", method: "手脚并用。", targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: outcome("moved", "过去了。"),
        failure: adjudication.kind === "check" ? outcome("slipped", "没抓稳。") : { kind: "none" } } }] };
}

/** Lowers a plain step on the terrain from `state`, walks first to
 * `approach` when given, and binds these effects to its outcomes. */
function frozen(f, state, suffix, { adjudication = DIRECT, featureRef, success = [], failure = [], approach }) {
  const rootActionId = `${f.rootActionId}:${suffix}`;
  const requiredContext = freezeAuthoredProbeContext(f, state, { rootActionId, focusRefs: [SOURCE] }).context;
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle(adjudication))));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  const lowered = lowerVNext2ProposalBundle({ ...f, state, rootActionId, requiredContext, value: parsed.bundle });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const input = structuredClone(lowered.command.rulesInput);
  const plan = atomicCompletionInput(input).steps[0].rulesInput.plan;
  plan.targetRefs = [SOURCE, featureRef]; plan.directTargetRefs = [SOURCE, featureRef];
  if (approach !== undefined) plan.approach = { kind: "point", position: approach };
  plan.branches.success.effects = success;
  plan.branches.failure.effects = failure;
  return input;
}

function act(f, state, input, rolls) {
  const pending = stepActionToDecision(f.runtime, f.profiles, state, input);
  if (rolls === undefined) {
    assert.equal(pending.kind, "committed", JSON.stringify(pending.kind === "rejected" ? pending.rejection : pending.kind));
    return pending;
  }
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending.kind === "rejected" ? pending.rejection : pending.kind));
  const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
    continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return { ...result, events: [...pending.events, ...result.events] };
}

function refused(f, state, input, reason) {
  const result = stepActionToDecision(f.runtime, f.profiles, state, input);
  assert.equal(result.kind, "rejected", reason);
  assert.ok(JSON.stringify(result.rejection).includes(reason), JSON.stringify(result.rejection));
}

function replayed(f, events) {
  const replay = f.runtime.replay(f.genesis, events);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  return replay.state;
}

const ofType = (events, type) => events.filter(event => event.eventType === type);
const resolved = events => ofType(events, "WorldInteractionResolved").at(-1).payload;
const positionOf = (state, id = ACTOR) => state.combatRuntime.entities[id].position;
const bodyAt = (state, position) => ({ ...state.combatRuntime.entities[ACTOR], position });
const walks = (state, from, to) => analyzeCombatMovement(bodyAt(state, from), [], state.combatRuntime.scenes[SCENE], [from, to], new Set()).ok;

test("the actor climbs down into the yard ditch, walks along its bottom but not out over the rim, and climbs back out", () => {
  const f = fixture("ditch", BY_DITCH);
  // Beside the ditch it starts where it stands, and lands on the bottom 3 feet
  // down, the first spot west where its 5-foot footprint fits the 5-foot ditch.
  const down = planTerrainTraversal(f.state, ACTOR, DITCH, { kind: "climb", direction: "down" });
  assert.deepEqual([down.kind, down.start, down.to, down.distanceMilliInches, down.movementCostMilliInches],
    ["accepted", BY_DITCH, point("-390", "-210", "-36"), "96000", "192000"]);
  const first = act(f, f.state, frozen(f, f.state, "down", { featureRef: DITCH, success: [climb(DITCH, "down")], approach: BY_DITCH }));
  assert.deepEqual(ofType(first.events, "CharacterRepositioned"), [], "already beside the ditch");
  assert.deepEqual(ofType(first.events, "CharacterClimbed").map(event => event.payload), [{ characterId: ACTOR, sceneId: SCENE, featureId: DITCH,
    way: "climb", direction: "down", from: BY_DITCH, to: down.to, distanceMilliInches: "96000", movementCostMilliInches: "192000" }]);
  assert.deepEqual(resolved(first.events).appliedEffects, [{ kind: "climbed", characterRef: ACTOR, featureRef: DITCH, way: "climb",
    direction: "down", from: BY_DITCH, to: down.to, distanceMilliInches: "96000", movementCostMilliInches: "192000" }]);
  const inDitch = first.state;
  assert.deepEqual(positionOf(inDitch), down.to);

  // On the bottom it walks the ditch's length; it never walks out over the
  // rim, sideways or past the ditch's end, nor back up to the floor.
  assert.equal(walks(inDitch, down.to, point("-390", "-330", "-36")), true);
  assert.equal(walks(inDitch, down.to, point("-330", "-210", "-36")), false);
  assert.equal(walks(inDitch, down.to, point("-390", "-30", "-36")), false);
  assert.equal(walks(inDitch, down.to, point("-390", "-210", "0")), false);
  assert.equal(planSceneApproach(inDitch, ACTOR, SCENE, { kind: "point", position: point("-390", "-120", "-36") }).kind, "move");
  assert.deepEqual(planSceneApproach(inDitch, ACTOR, SCENE, { kind: "point", position: point("-300", "-210", "-36") }),
    { kind: "rejected", reason: "approach:no-route" });
  // Others on the floor still cannot walk in, and no long jump starts down here.
  assert.equal(walks(f.state, BY_DITCH, point("-390", "-210")), false);
  assert.deepEqual(planJump(inDitch, ACTOR, WALL), { kind: "rejected", code: "missingPrerequisite", reason: "jump:not-on-floor" });
  // Down again, or across, from inside is not a move; up from the floor is not either.
  assert.deepEqual(planTerrainTraversal(inDitch, ACTOR, DITCH, { kind: "climb", direction: "down" }),
    { kind: "rejected", code: "missingPrerequisite", reason: "terrain:already-inside" });
  assert.deepEqual(planTerrainTraversal(f.state, ACTOR, DITCH, { kind: "climb", direction: "up" }),
    { kind: "rejected", code: "missingPrerequisite", reason: "terrain:not-inside" });
  // A fall from beside it lands where the climb would, from the whole depth;
  // a failed climb out falls back from half the depth where it stands.
  assert.deepEqual(planTerrainFall(f.state, ACTOR, DITCH),
    { kind: "accepted", featureId: DITCH, from: BY_DITCH, to: down.to, dropInches: "36", damageDice: 0 });
  assert.deepEqual(planTerrainFall(inDitch, ACTOR, DITCH),
    { kind: "accepted", featureId: DITCH, from: down.to, to: down.to, dropInches: "18", damageDice: 0 });

  // Up it climbs where it stands, to the nearest side: east, back where it came from.
  const up = planTerrainTraversal(inDitch, ACTOR, DITCH, { kind: "climb", direction: "up" });
  assert.deepEqual([up.kind, up.start, up.to], ["accepted", down.to, BY_DITCH]);
  const second = act(f, inDitch, frozen(f, inDitch, "up", { featureRef: DITCH, success: [climb(DITCH, "up")], approach: down.to }));
  assert.deepEqual(ofType(second.events, "CharacterClimbed").map(event => [event.payload.direction, event.payload.from, event.payload.to]),
    [["up", down.to, BY_DITCH]]);
  assert.deepEqual(replayed(f, [...first.events, ...second.events]), second.state);
});

test("the actor climbs across the ditch to its far side, and onto, along and over the low wall", () => {
  const ditch = fixture("ditch-across", BY_DITCH);
  const across = act(ditch, ditch.state, frozen(ditch, ditch.state, "across", { featureRef: DITCH, success: [climb(DITCH, "across")] }));
  // Down 3 feet and up 3 feet besides the 10 feet across.
  assert.deepEqual(ofType(across.events, "CharacterClimbed").map(event => [event.payload.to, event.payload.distanceMilliInches]),
    [[point("-450", "-210"), "192000"]]);
  assert.deepEqual(replayed(ditch, across.events), across.state);

  const wall = fixture("wall", BY_WALL);
  // Up: its centre over the 1-foot-thick wall, 3 feet up.
  const onTop = act(wall, wall.state, frozen(wall, wall.state, "up", { featureRef: WALL, success: [climb(WALL, "up")] }));
  const top = point("361", "-210", "36");
  assert.deepEqual(positionOf(onTop.state), top);
  // Along the top, not off its edge; down again steps off the nearer side.
  assert.equal(walks(onTop.state, top, point("361", "-300", "36")), true);
  assert.equal(walks(onTop.state, top, point("330", "-210", "36")), false);
  assert.equal(walks(onTop.state, top, point("400", "-210", "36")), false);
  assert.deepEqual(planJump(onTop.state, ACTOR, DITCH), { kind: "rejected", code: "missingPrerequisite", reason: "jump:not-on-floor" });
  const off = act(wall, onTop.state, frozen(wall, onTop.state, "off", { featureRef: WALL, success: [climb(WALL, "down")] }));
  assert.deepEqual(positionOf(off.state), BY_WALL);
  assert.deepEqual(replayed(wall, [...onTop.events, ...off.events]), off.state);
  // Across: clear of the wall on its east side.
  const over = act(wall, wall.state, frozen(wall, wall.state, "over", { featureRef: WALL, success: [climb(WALL, "across")] }));
  assert.deepEqual(positionOf(over.state), point("402", "-210"));
  // Climbing down a wall it is not on, or swimming it, is refused.
  assert.deepEqual(planTerrainTraversal(wall.state, ACTOR, WALL, { kind: "climb", direction: "down" }),
    { kind: "rejected", code: "missingPrerequisite", reason: "terrain:not-on-top" });
  assert.deepEqual(planTerrainTraversal(wall.state, ACTOR, WALL, { kind: "swim", direction: "across" }),
    { kind: "rejected", code: "worldLawViolation", reason: "terrain:wrong-landform" });
});

test("a high jump onto the low wall: Strength 16 reaches 6 feet with a run-up; Strength 6 reaches 1 foot and is refused", () => {
  const f = fixture("high-jump", BY_WALL, STRONG);
  const planned = planTerrainTraversal(f.state, ACTOR, WALL, { kind: "jumpOnto" });
  assert.deepEqual([planned.kind, planned.start, planned.to, planned.running, planned.maxHeightInches],
    ["accepted", BY_WALL, point("361", "-210", "36"), true, "72"]);
  const jumped = act(f, f.state, frozen(f, f.state, "jump", { featureRef: WALL, success: [{ kind: "jumpOnto", featureRef: WALL }] }));
  assert.deepEqual(ofType(jumped.events, "CharacterJumpedOnto").map(event => event.payload),
    [{ characterId: ACTOR, sceneId: SCENE, featureId: WALL, from: BY_WALL, to: planned.to, running: true }]);
  assert.deepEqual(resolved(jumped.events).appliedEffects,
    [{ kind: "jumpedOnto", characterRef: ACTOR, featureRef: WALL, from: BY_WALL, to: planned.to, running: true }]);
  assert.deepEqual(replayed(f, jumped.events), jumped.state);

  const weak = fixture("high-jump-weak", BY_WALL, WEAK);
  assert.deepEqual(planTerrainTraversal(weak.state, ACTOR, WALL, { kind: "jumpOnto" }),
    { kind: "rejected", code: "worldLawViolation", reason: "terrain:too-high" });
  refused(weak, weak.state, frozen(weak, weak.state, "jump", { featureRef: WALL, success: [{ kind: "jumpOnto", featureRef: WALL }] }),
    "terrain:too-high");
  // Nobody jumps onto a ditch.
  assert.deepEqual(planTerrainTraversal(f.state, ACTOR, DITCH, { kind: "jumpOnto" }),
    { kind: "rejected", code: "worldLawViolation", reason: "terrain:wrong-landform" });
});

test("the actor swims across the pond, and into and out of it, at the surface; nobody climbs it", () => {
  const f = fixture("pond", BY_POND);
  const across = act(f, f.state, frozen(f, f.state, "swim", { featureRef: POND, success: [climb(POND, "across", "swim")] }));
  assert.deepEqual(ofType(across.events, "CharacterClimbed").map(event => [event.payload.way, event.payload.direction, event.payload.to]),
    [["swim", "across", point("-270", "-300")]]);
  assert.deepEqual(replayed(f, across.events), across.state);
  // In the water it floats with half its 5-foot height under the surface.
  const into = planTerrainMove(f.state, ACTOR, POND, { kind: "swim", direction: "down" });
  assert.deepEqual([into.kind, into.to], ["accepted", point("-150", "-300", "-30")]);
  const swimming = act(f, f.state, frozen(f, f.state, "in", { featureRef: POND, success: [climb(POND, "down", "swim")] }));
  assert.equal(walks(swimming.state, into.to, point("-210", "-300", "-30")), true);
  assert.equal(walks(swimming.state, into.to, point("-90", "-300", "-30")), false);
  assert.deepEqual(planTerrainMove(swimming.state, ACTOR, POND, { kind: "swim", direction: "up" }).to, BY_POND);
  assert.deepEqual(planTerrainTraversal(f.state, ACTOR, POND, { kind: "climb", direction: "down" }),
    { kind: "rejected", code: "worldLawViolation", reason: "terrain:wrong-landform" });
  assert.deepEqual(planTerrainFall(f.state, ACTOR, POND), { kind: "rejected", code: "worldLawViolation", reason: "terrain:wrong-landform" });
});

test("a fall off the 3-foot wall rolls no dice and lays the actor prone; one off the 25-foot cliff on a failed climb rolls 2d6", () => {
  const wall = fixture("fall-wall", BY_WALL);
  const onTop = act(wall, wall.state, frozen(wall, wall.state, "up", { featureRef: WALL, success: [climb(WALL, "up")] }));
  const fell = act(wall, onTop.state, frozen(wall, onTop.state, "fall", { featureRef: WALL, success: [{ kind: "fallFrom", featureRef: WALL }] }));
  assert.deepEqual(ofType(fell.events, "CharacterFell").map(event => event.payload), [{ characterId: ACTOR, sceneId: SCENE, featureId: WALL,
    from: point("361", "-210", "36"), to: BY_WALL, dropInches: "36", damageRolls: [] }]);
  assert.deepEqual(ofType(fell.events, "DamagePacketResolved"), []);
  assert.equal(fell.state.combatRuntime.entities[ACTOR].conditions.prone, true);
  assert.deepEqual(resolved(fell.events).appliedEffects, [{ kind: "fell", characterRef: ACTOR, featureRef: WALL,
    from: point("361", "-210", "36"), to: BY_WALL, dropInches: "36", damageRolls: [] }]);
  const view = wall.runtime.project(wall.profiles, fell.state, wall.viewer, { channel: "realtime", committedRange: committedActionRange(fell.state, {
    receiptId: fell.receipt.receiptId, actorCharacterId: ACTOR, priorState: onTop.state, events: fell.events }) });
  assert.equal(view.kind, "projected", JSON.stringify(view));
  assert.ok(view.renderableClaims.claims.some(claim => claim.outcomeCode === "fell" && claim.summary === "该角色坠落了 36 英寸，倒在地上。"),
    JSON.stringify(view.renderableClaims.claims.map(claim => [claim.outcomeCode, claim.summary])));
  assert.deepEqual(replayed(wall, [...onTop.events, ...fell.events]), fell.state);
  // At the foot of the wall a failed climb falls from half its height, where it stands.
  assert.deepEqual(planTerrainFall(wall.state, ACTOR, WALL),
    { kind: "accepted", featureId: WALL, from: BY_WALL, to: BY_WALL, dropInches: "18", damageDice: 0 });

  // The KP binds the climb down to an Athletics success and the fall to its
  // failure. A 2 fails: 25 feet down, 2d6 bludgeoning, and prone. The faces
  // after the d20 are the two d6 and the concentration save it keeps.
  const cliff = fixture("fall-cliff", BY_CLIFF);
  const climbed = act(cliff, cliff.state, frozen(cliff, cliff.state, "up", { featureRef: CLIFF, success: [climb(CLIFF, "up")] }));
  const summit = point("60", "-241", "300");
  assert.deepEqual(positionOf(climbed.state), summit);
  const input = frozen(cliff, climbed.state, "down", { adjudication: athletics(15), featureRef: CLIFF,
    success: [climb(CLIFF, "down")], failure: [{ kind: "fallFrom", featureRef: CLIFF }] });
  const fall = act(cliff, climbed.state, input, [2, 3, 4, 10, 10]);
  assert.deepEqual(ofType(fall.events, "CharacterFell").map(event => [event.payload.from, event.payload.to, event.payload.dropInches,
    event.payload.damageRolls]), [[summit, BY_CLIFF, "300", [3, 4]]]);
  const body = fall.state.combatRuntime.entities[ACTOR];
  assert.deepEqual([body.position, body.conditions.prone, body.hitPoints.current, fall.state.entities[ACTOR].hitPoints.current],
    [BY_CLIFF, true, "3", 3]);
  const damage = resolved(fall.events).appliedEffects.find(effect => effect.kind === "damage");
  assert.deepEqual([damage.sourceDefinitionRef, damage.amount, damage.damageType, damage.hpBefore, damage.hpAfter],
    [CLIFF, 7, "bludgeoning", 10, 3]);
  assert.deepEqual(ofType(fall.events, "CharacterFell").length + ofType(fall.events, "CharacterClimbed").length, 1);
  assert.deepEqual(replayed(cliff, [...climbed.events, ...fall.events]), fall.state);
  // A success climbs down instead, with no dice spent on the fall.
  const safe = act(cliff, climbed.state, input, [18, 3, 4, 10, 10]);
  assert.deepEqual([positionOf(safe.state), ofType(safe.events, "CharacterFell").length], [BY_CLIFF, 0]);
});

test("the planner walks the actor to the nearest spot the move works from, and Rules refuses what does not fit", () => {
  // From the cellar door, across the yard, the nearest spot beside the ditch
  // is its south-east corner; the line from there runs to the ditch's corner.
  const far = fixture("planner", point("-120", "360"));
  const down = planTerrainTraversal(far.state, ACTOR, DITCH, { kind: "climb", direction: "down" });
  assert.deepEqual([down.kind, down.start, down.to], ["accepted", point("-330", "-30"), point("-390", "-90", "-36")]);
  // The KP walks it there and commits the climb, judged again from there.
  const run = act(far, far.state, frozen(far, far.state, "walk", { featureRef: DITCH, success: [climb(DITCH, "down")], approach: down.start }));
  assert.deepEqual(ofType(run.events, "CharacterRepositioned").at(-1).payload.path.at(-1), down.start);
  assert.deepEqual(positionOf(run.state), down.to);
  // Without the walk the actor is not beside the ditch.
  refused(far, far.state, frozen(far, far.state, "no-walk", { featureRef: DITCH, success: [climb(DITCH, "down")] }), "terrain:not-beside");
  // One move per outcome, the feature as the step's target, and no climbing a pond.
  refused(far, far.state, frozen(far, far.state, "two", { featureRef: DITCH, approach: down.start,
    success: [climb(DITCH, "down"), { kind: "dropProne" }] }), "terrain:one-per-outcome");
  const untargeted = frozen(far, far.state, "untargeted", { featureRef: WALL, success: [climb(DITCH, "down")], approach: down.start });
  refused(far, far.state, untargeted, "terrain:not-a-direct-target");
  // Inside an encounter the combat map climbs; a bare encounter record is
  // enough for the planner.
  const fighting = structuredClone(far.state);
  fighting.combatRuntime.encounters["encounter:terrain-test"] = { status: "active", participantEntityIds: [ACTOR] };
  assert.deepEqual(planTerrainTraversal(fighting, ACTOR, DITCH, { kind: "climb", direction: "down" }),
    { kind: "rejected", code: "missingPrerequisite", reason: "terrain:inside-encounter" });
});

test("replay re-plans each move from where it started and refuses a tampered end, drop or cost", () => {
  const f = fixture("replay", BY_DITCH);
  const down = act(f, f.state, frozen(f, f.state, "down", { featureRef: DITCH, success: [climb(DITCH, "down")] }));
  const index = down.events.findIndex(event => event.eventType === "CharacterClimbed");
  const event = down.events[index];
  assert.deepEqual(positionOf(replayed(f, down.events.slice(0, index + 1))), event.payload.to);
  for (const payload of [{ ...event.payload, to: point("-391", "-210", "-36") }, { ...event.payload, to: point("-390", "-210", "-30") },
    { ...event.payload, distanceMilliInches: "95000" }, { ...event.payload, movementCostMilliInches: "96000" },
    { ...event.payload, from: point("-330", "-180") }, { ...event.payload, direction: "across" }]) {
    const replay = f.runtime.replay(f.genesis, [...down.events.slice(0, index), { ...event, payload }]);
    assert.equal(replay.kind, "rejected", JSON.stringify(payload));
    assert.match(replay.rejection.message, /cannot be legally folded/u, JSON.stringify(replay.rejection));
  }

  const wall = fixture("replay-fall", BY_WALL);
  const onTop = act(wall, wall.state, frozen(wall, wall.state, "up", { featureRef: WALL, success: [climb(WALL, "up")] }));
  const fell = act(wall, onTop.state, frozen(wall, onTop.state, "fall", { featureRef: WALL, success: [{ kind: "fallFrom", featureRef: WALL }] }));
  const events = [...onTop.events, ...fell.events];
  const at = events.findIndex(entry => entry.eventType === "CharacterFell");
  for (const payload of [{ ...events[at].payload, dropInches: "18" }, { ...events[at].payload, to: point("320", "-210") },
    { ...events[at].payload, dropInches: "120", damageRolls: [6] }]) {
    const replay = wall.runtime.replay(wall.genesis, [...events.slice(0, at), { ...events[at], payload }]);
    assert.equal(replay.kind, "rejected", JSON.stringify(payload));
  }
});
