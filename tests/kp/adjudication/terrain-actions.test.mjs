import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { draftCommonActionDiagnostics } from "../../../app/_runtime/lib/kp/vnext/common-actions.ts";
import { atomicCompletionInput } from "../../support/fixtures/vnext-action-duration.mjs";
import { stepActionToDecision } from "../../support/fixtures/vnext-action-lifecycle.mjs";
import { planTerrainTraversal } from "../../../app/_runtime/lib/rules/authority-read.ts";
import { PROBE_TARGET as TARGET } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";

// SPEC 0014 §4 (ADR 0098): climbing, swimming, the high jump and falling are
// common actions. The KP rules whether a roll is due and at what DC; the
// script walks the actor to where the move starts and writes the move.

/** The fixture's mapped feature, recast as terrain across the scene east of the actor. */
const FEATURE = "feature:probe-valve";
const rectangle = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const DITCH = { kind: "terrain", label: "排水沟", state: "muddy", polygon: rectangle("300", "0", "360", "600"), elevation: "0", height: "1",
  opaque: false, impassable: true, cover: "none", propagation: "passes", terrain: "normal", landform: "ditch", depth: "36", material: "mud" };
const WALL = { kind: "barrier", label: "矮石墙", state: "intact", polygon: rectangle("300", "0", "312", "600"), elevation: "0", height: "36",
  opaque: true, impassable: true, cover: "half", propagation: "blocks", terrain: "normal", landform: "lowWall", material: "stone" };
const POND = { kind: "terrain", label: "水塘", state: "still", polygon: rectangle("300", "0", "420", "600"), elevation: "0", height: "1",
  opaque: false, impassable: true, cover: "none", propagation: "passes", terrain: "normal", landform: "water", depth: "60", current: "still", material: "earth" };
const STRONG = { [ACTOR]: { abilityScores: { str: 16, dex: 12, con: 12, int: 10, wis: 10, cha: 10 } } };

const fixture = (name, feature) => createAuthoredProbeFixture(`terrain:${name}`, { featureOverrides: feature, characterOverrides: STRONG });
const outcome = (code, summary) => ({ outcomeCode: `outcome:${code}`, summary, effects: [], sensoryEvidence: [], pressures: [], opportunities: [] });
const direct = { kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。", successOutcome: "过去了。" };
const check = (ability, skill, dc) => ({ kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability, skill, dc, mode: "normal",
  risk: "泥壁湿滑。", successOutcome: "爬过去了。", failureOutcome: "手一滑。" });
const action = (kind, option, targetRef = FEATURE) => ({ kind, targetRef, destinationRef: null, option });

/** One world step naming the common action, with no targets of its own written. */
function scripted(commonAction, adjudication, intent) {
  return { mode: "adjudication", basisRefs: [FEATURE], terminal: { kind: "none" }, adjudication,
    proposals: [{ basisRefs: [FEATURE], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent, method: "手脚并用。", targetRefs: [], directTargetRefs: [], instrumentRefs: [], abilityRef: { kind: "none" }, commonAction,
      branches: { success: outcome("done", "过去了。"), failure: adjudication.kind === "check" ? outcome("slipped", "没过去。") : null } }] };
}

/** The same act with a fall written on the step a failed roll takes. */
function withFall(bundle, fall = action("fall", "none")) {
  bundle.proposals.push({ ...structuredClone(bundle.proposals[0]), outcomeBinding: "onFailure", intent: "摔下去。", commonAction: fall,
    branches: { success: outcome("fell", "摔了下去。"), failure: null } });
  return bundle;
}

function lower(f, bundle) {
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle)));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  return lowerVNext2ProposalBundle({ ...f, value: parsed.bundle });
}

function plans(f, bundle) {
  const lowered = lower(f, bundle);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  return atomicCompletionInput(lowered.command.rulesInput).steps.map(step => step.rulesInput.plan);
}

const constraints = lowered => (assert.equal(lowered.kind, "rejected", JSON.stringify(lowered)), lowered.diagnostics.map(entry => entry.constraint));
const moves = branch => branch.effects.filter(effect => ["climbFeature", "jumpOnto", "fallFrom", "jumpOver"].includes(effect.kind));

test("climb by script: the walk to the start and the climb are filled in; only Athletics is a climb's roll; a fall takes none", () => {
  const f = fixture("climb-lowering", DITCH);
  const [free] = plans(f, scripted(action("climb", "across"), direct, "爬下排水沟，再从对面爬上去。"));
  assert.equal(free.approach.kind, "point", JSON.stringify(free.approach));
  assert.deepEqual(free.directTargetRefs, [FEATURE]);
  assert.deepEqual(moves(free.branches.success), [{ kind: "climbFeature", featureRef: FEATURE, way: "climb", direction: "across" }]);
  // The KP sets the DC from the mud; a failed roll stays where it was.
  const [hard] = plans(f, scripted(action("climb", "down"), check("str", "athletics", 15), "爬下排水沟。"));
  assert.deepEqual(moves(hard.branches.success), [{ kind: "climbFeature", featureRef: FEATURE, way: "climb", direction: "down" }]);
  assert.deepEqual(moves(hard.branches.failure), []);
  // A fall written on the failed roll's step falls where the actor stands.
  const [, fallen] = plans(f, withFall(scripted(action("climb", "across"), check("str", "athletics", 15), "爬过排水沟。")));
  assert.deepEqual(moves(fallen.branches.success), [{ kind: "fallFrom", featureRef: FEATURE }]);
  assert.equal(fallen.approach, undefined, JSON.stringify(fallen.approach));
  assert.deepEqual(constraints(lower(f, scripted(action("climb", "across"), check("dex", "acrobatics", 10), "爬过排水沟。"))),
    ["commonAction:climb-check"]);
  const rolledFall = scripted(action("fall", "none"), check("dex", "acrobatics", 10), "跳进沟里。");
  assert.deepEqual(constraints(lower(f, rolledFall)), ["commonAction:no-roll"]);
  // Read before Room lowers it, a draft still names the wrong roll.
  assert.deepEqual(draftCommonActionDiagnostics(scripted(action("swim", "across"), check("wis", "perception", 10), "游过去。"))
    .map(entry => entry.constraint), ["commonAction:swim-check"]);
});

test("swim and the high jump by script: across the pond, onto the low wall; a wall out of reach goes back to the KP", () => {
  const pond = fixture("swim-lowering", POND);
  const [swim] = plans(pond, scripted(action("swim", "across"), check("str", "athletics", 10), "游过水塘。"));
  assert.equal(swim.approach.kind, "point", JSON.stringify(swim.approach));
  assert.deepEqual(moves(swim.branches.success), [{ kind: "climbFeature", featureRef: FEATURE, way: "swim", direction: "across" }]);
  const wall = fixture("jump-onto", WALL);
  const [onto] = plans(wall, scripted(action("jump", "up"), direct, "助跑几步跳上矮墙。"));
  assert.deepEqual(moves(onto.branches.success), [{ kind: "jumpOnto", featureRef: FEATURE }]);
  // SRD 5.1 asks no roll of a high jump; a KP's Athletics call is kept, anything else goes back.
  const [called] = plans(wall, scripted(action("jump", "up"), check("str", "athletics", 12), "跳上矮墙。"));
  assert.deepEqual(moves(called.branches.success), [{ kind: "jumpOnto", featureRef: FEATURE }]);
  assert.deepEqual(moves(called.branches.failure), []);
  assert.deepEqual(constraints(lower(wall, scripted(action("jump", "up"), check("dex", "acrobatics", 10), "跳上矮墙。"))), ["commonAction:jump-check"]);
  // Strength 16 reaches 6 feet with a run-up; a 9-foot wall is out of reach from anywhere.
  const tall = fixture("jump-onto-tall", { ...WALL, height: "108" });
  const refused = lower(tall, scripted(action("jump", "up"), direct, "跳上高墙。"));
  assert.deepEqual(constraints(refused), ["commonAction:terrain-impossible"]);
  // Swimming a wall is not a swim.
  assert.deepEqual(constraints(lower(wall, scripted(action("swim", "across"), direct, "游过矮墙。"))), ["commonAction:terrain-impossible"]);
});

function rolled(f, bundle, rolls) {
  const lowered = lower(f, bundle);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const pending = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  if (pending.kind === "committed") return { state: pending.state, events: pending.events };
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
    continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return { state: result.state, events: [...pending.events, ...result.events] };
}

// End to end: the script walks the actor to the rim and climbs the ditch; a
// failed Athletics roll with a fall written on it drops the actor in, prone.
test("climb across the ditch by script: the actor ends on the far side; a failed roll with a fall lands in the ditch, prone", () => {
  const f = fixture("climb-across", DITCH);
  const across = rolled(f, scripted(action("climb", "across"), direct, "爬下排水沟，再从对面爬上去。"), []);
  const [climbed] = across.events.filter(event => event.eventType === "CharacterClimbed");
  assert.equal(climbed?.payload.featureId, FEATURE, across.events.map(event => event.eventType).join());
  const end = across.state.combatRuntime.entities[ACTOR].position;
  assert.ok(BigInt(end.x) > 360n && end.elevation === "0", JSON.stringify(end));
  assert.equal(f.runtime.replay(f.genesis, across.events).kind, "replayed");

  const g = fixture("climb-fall", DITCH);
  // Athletics 3 + 3 misses DC 15; the 3-foot drop deals no damage.
  const slipped = rolled(g, withFall(scripted(action("climb", "across"), check("str", "athletics", 15), "爬过排水沟。")), [3]);
  assert.deepEqual(slipped.events.filter(event => ["CharacterClimbed", "CharacterFell"].includes(event.eventType)).map(event => event.eventType),
    ["CharacterFell"]);
  const actor = slipped.state.combatRuntime.entities[ACTOR];
  assert.equal(actor.position.elevation, "-36", JSON.stringify(actor.position));
  assert.equal(actor.conditions.prone, true);
  assert.equal(g.runtime.replay(g.genesis, slipped.events).kind, "replayed");
});

// A slanted ditch is no axis-aligned rectangle: the start is found along its
// edges. Someone standing on the first spot past the ditch does not stop the
// climb; it lands just past them.
test("climbing a slanted ditch starts beside its edge; a landing someone stands on moves past them", () => {
  const slanted = { ...DITCH, polygon: [{ x: "300", y: "0" }, { x: "360", y: "0" }, { x: "420", y: "600" }, { x: "360", y: "600" }] };
  const f = fixture("climb-slanted", slanted);
  const planned = planTerrainTraversal(f.state, ACTOR, FEATURE, { kind: "climb", direction: "across" });
  assert.equal(planned.kind, "accepted", JSON.stringify(planned));
  assert.notDeepEqual(planned.start, f.state.combatRuntime.entities[ACTOR].position);
  const across = rolled(f, scripted(action("climb", "across"), direct, "爬过斜沟。"), []);
  assert.deepEqual(across.state.combatRuntime.entities[ACTOR].position, planned.to);

  // The actor stands at the ditch's west rim; the target stands where it would land.
  const blocked = createAuthoredProbeFixture("terrain:climb-blocked", { featureOverrides: DITCH, characterOverrides: STRONG,
    spawnPoints: [{ x: "270", y: "100", elevation: "0" }, { x: "391", y: "100", elevation: "0" }] });
  assert.deepEqual(blocked.state.combatRuntime.entities[TARGET].position, { x: "391", y: "100", elevation: "0" });
  const past = planTerrainTraversal(blocked.state, ACTOR, FEATURE, { kind: "climb", direction: "across" });
  assert.equal(past.kind, "accepted", JSON.stringify(past));
  assert.deepEqual(past.start, { x: "270", y: "100", elevation: "0" });
  assert.ok(BigInt(past.to.x) >= 451n && past.to.y === "100", JSON.stringify(past.to));
});
