import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_TARGET as PEER, PROBE_SCENE as SCENE,
  PROBE_SOURCE as SOURCE } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { offsetAlong, planJump, planJumpTakeoff } from "../../../app/_runtime/lib/rules/v2/character-jump.ts";
import { pushOffset } from "../../../app/_runtime/lib/rules/v2/creature-push.ts";
import { stepActionToDecision, committedActionRange } from "../../support/fixtures/vnext-action-lifecycle.mjs";
import { atomicCompletionInput } from "../../support/fixtures/vnext-action-duration.mjs";

// SPEC 0014 §4 (ADR 0092): the jump the common action script expands into.
// Rules fixes the reach (Strength in feet after a 10-foot run-up, half from a
// standing start), the height (a quarter of the reach) and which roll may
// apply, moves the actor, replays, projects and refuses. Each plan is lowered
// as a plain world step that first walks next to the mapped feature, and its
// effects and targets are then replaced, as common-action-effects.test.mjs
// does for the other effects.

const FEATURE = "feature:probe-valve";
const rectangle = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
/** A 36-inch-deep, 30-inch-high table 180 inches south of the actor at (100, 100). */
const TABLE = { kind: "barrier", label: "长桌", state: "present", polygon: rectangle("40", "280", "160", "316"), elevation: "0", height: "30",
  opaque: false, impassable: true, cover: "half", propagation: "passes", terrain: "normal" };
/** The same table right beside the actor, with the north wall of the room at its back. */
const NEAR_TABLE = { ...TABLE, polygon: rectangle("40", "130", "160", "166"), height: "24" };
/** Loose stone across the floor beyond TABLE. */
const RUBBLE = { featureId: "feature:probe-rubble", kind: "terrain", label: "碎石", state: "present", polygon: rectangle("0", "330", "200", "420"),
  elevation: "0", height: "6", opaque: false, impassable: false, cover: "none", propagation: "passes", terrain: "rubble",
  visibilityPolicyId: "visibility:scene-observers" };
/** Strength 18: 18 feet with a run-up, 9 standing. */
const STRONG = { [ACTOR]: { abilityScores: { str: 18, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } } };

const fixture = (name, options = {}) => createAuthoredProbeFixture(`jump:${name}`, options);
const point = (x, y) => ({ x, y, elevation: "0" });

const outcome = (code, summary) => ({ outcomeCode: `outcome:${code}`, summary, effects: [], sensoryEvidence: [], pressures: [], opportunities: [] });
const DIRECT = { kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。", successOutcome: "跳了过去。" };
const check = (ability, skill, dc = 10) => ({ kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability, skill, dc,
  mode: "normal", risk: "可能绊倒。", successOutcome: "跳了过去。", failureOutcome: "没跳好。" });

/** A plain act on the table, walking next to it first unless `approach` is false. */
function jumpBundle(adjudication, { approach = true } = {}) {
  return { mode: "adjudication", basisRefs: [SOURCE], terminal: { kind: "none" }, adjudication,
    proposals: [{ basisRefs: [SOURCE], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "跳过长桌。", method: "跑两步跳过去。", targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: { kind: "none" },
      ...(approach ? { approach: { kind: "nextTo", ref: SOURCE } } : {}),
      branches: { success: outcome("jumped", "跳了过去。"),
        failure: adjudication.kind === "check" ? outcome("missed", "没跳好。") : { kind: "none" } } }] };
}

const jumpOver = (landProne = false, featureRef = FEATURE) => ({ kind: "jumpOver", featureRef, landProne });
/** The table becomes a direct target and the branches carry these effects. */
const jumping = (success, failure = []) => plan => {
  plan.targetRefs = [SOURCE, FEATURE]; plan.directTargetRefs = [SOURCE, FEATURE];
  plan.branches.success.effects = success; plan.branches.failure.effects = failure;
};

function parse(bundle) {
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle)));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  return parsed.bundle;
}

function at(f, state, suffix) {
  if (state === f.state && suffix === undefined) return f;
  const rootActionId = `${f.rootActionId}:${suffix}`;
  return { ...f, state, rootActionId, requiredContext: freezeAuthoredProbeContext(f, state, { rootActionId, focusRefs: [SOURCE] }).context };
}

/** Lowers `bundle` from `state` and lets `edit` change the frozen plan. */
function frozen(f, bundle, edit, state = f.state, suffix) {
  const lowered = lowerVNext2ProposalBundle({ ...at(f, state, suffix), value: parse(bundle) });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const input = structuredClone(lowered.command.rulesInput);
  edit(atomicCompletionInput(input).steps[0].rulesInput.plan);
  return input;
}

function act(f, input, state = f.state) {
  const result = stepActionToDecision(f.runtime, f.profiles, state, input);
  assert.equal(result.kind, "committed", JSON.stringify(result.kind === "rejected" ? result.rejection : result.kind));
  return result;
}

function rolled(f, input, rolls, state = f.state) {
  const pending = stepActionToDecision(f.runtime, f.profiles, state, input);
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending.kind === "rejected" ? pending.rejection : pending.kind));
  const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
    continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return { ...result, events: [...pending.events, ...result.events] };
}

function refused(f, input, reason, state = f.state) {
  const result = stepActionToDecision(f.runtime, f.profiles, state, input);
  assert.equal(result.kind, "rejected", reason);
  assert.ok(JSON.stringify(result.rejection).includes(reason), JSON.stringify(result.rejection));
}

function replayed(f, events) {
  const replay = f.runtime.replay(f.genesis, events);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  return replay.state;
}

function claims(f, result, priorState) {
  const view = f.runtime.project(f.profiles, result.state, f.viewer, { channel: "realtime", committedRange: committedActionRange(result.state, {
    receiptId: result.receipt.receiptId, actorCharacterId: ACTOR, priorState, events: result.events }) });
  assert.equal(view.kind, "projected", JSON.stringify(view));
  return view;
}

const resolved = events => events.filter(event => event.eventType === "WorldInteractionResolved").at(-1).payload;
const applied = (events, kind) => resolved(events).appliedEffects.filter(effect => effect.kind === kind);
const positionOf = (state, id) => state.combatRuntime.entities[id].position;
const conditionsOf = (state, id) => state.combatRuntime.entities[id].conditions;
const ofType = (events, type) => events.filter(event => event.eventType === type);
const walkEnd = events => ofType(events, "CharacterRepositioned").at(-1).payload.path.at(-1);

test("the jump offset rounds each axis as a push does", () => {
  for (const [x, y] of [[60n, 60n], [0n, 60n], [-17n, 5n], [3n, -11n]]) {
    assert.deepEqual(offsetAlong({ x, y }, 60n), pushOffset(point("0", "0"), point(String(x), String(y))));
  }
  assert.deepEqual(offsetAlong({ x: 1n, y: 1n }, 120n), { x: 85n, y: 85n });
});

test("a running jump carries the actor across a 36-inch table to its far side; replay, claims and the map agree", () => {
  const f = fixture("table", { featureOverrides: TABLE });
  const run = act(f, frozen(f, jumpBundle(DIRECT), jumping([jumpOver()])));
  // The walk stops beside the table, 10 inches short of it; ten feet of free
  // floor lie behind, so it runs: 120 inches of reach, the table 30 high.
  // The footprint clears the far edge at y 316 after 106 inches.
  const from = walkEnd(run.events), to = point("90", "346");
  assert.deepEqual(from, point("90", "240"));
  const jumped = ofType(run.events, "CharacterJumped");
  assert.deepEqual(jumped.map(event => event.payload), [{ characterId: ACTOR, sceneId: SCENE, featureId: FEATURE, from, to, running: true }]);
  assert.deepEqual(jumped.map(event => [event.visibilityPolicyId, event.secrecy]), [["visibility:scene-observers", "public"]]);
  assert.deepEqual(positionOf(run.state, ACTOR), to);
  assert.equal(conditionsOf(run.state, ACTOR).prone, undefined);
  assert.deepEqual(applied(run.events, "jumped"), [{ kind: "jumped", characterRef: ACTOR, featureRef: FEATURE, from, to, running: true, landedProne: false }]);
  assert.deepEqual(replayed(f, run.events), run.state);
  const view = claims(f, run, f.state);
  const claim = view.renderableClaims.claims.find(entry => entry.outcomeCode === "jumped");
  assert.deepEqual([claim?.actorRef, claim?.targetRefs, claim?.summary], [ACTOR, [FEATURE], "该角色助跑跳过了这一障碍。"]);
  assert.deepEqual(view.tacticalProjection.self.position, to);
});

test("with the wall at its back the actor jumps from a standing start, half as far", () => {
  const strong = fixture("standing", { featureOverrides: NEAR_TABLE, characterOverrides: STRONG });
  // The run-up would start at y -20, outside the room: 108 inches standing,
  // which clears a 24-inch-high table (a quarter of 108 is 27).
  assert.deepEqual(planJump(strong.state, ACTOR, FEATURE), { kind: "accepted", from: point("100", "100"), to: point("100", "196"),
    running: false, impassable: true, difficultLanding: false, maxInches: "108", distanceMilliInches: "96000" });
  const run = act(strong, frozen(strong, jumpBundle(DIRECT), jumping([jumpOver()])));
  assert.deepEqual(ofType(run.events, "CharacterRepositioned"), [], "already beside the table");
  assert.deepEqual(ofType(run.events, "CharacterJumped").map(event => event.payload),
    [{ characterId: ACTOR, sceneId: SCENE, featureId: FEATURE, from: point("100", "100"), to: point("100", "196"), running: false }]);
  assert.deepEqual(replayed(strong, run.events), run.state);
  assert.equal(claims(strong, run, strong.state).renderableClaims.claims.find(entry => entry.outcomeCode === "jumped")?.summary,
    "该角色原地跳过了这一障碍。");

  // Strength 10 reaches 60 inches standing, so 24 inches is too high to clear.
  const weak = fixture("standing-weak", { featureOverrides: NEAR_TABLE });
  refused(weak, frozen(weak, jumpBundle(DIRECT), jumping([jumpOver()])), "jump:obstacle-too-high");
});

test("Rules refuses an obstacle taller than a quarter of the reach and a far side beyond it", () => {
  const tall = fixture("tall", { featureOverrides: { ...TABLE, height: "48" } });
  refused(tall, frozen(tall, jumpBundle(DIRECT), jumping([jumpOver()])), "jump:obstacle-too-high");
  // 72 inches deep: the footprint would clear it only after 132 inches.
  const deep = fixture("deep", { featureOverrides: { ...TABLE, polygon: rectangle("40", "280", "160", "352") } });
  refused(deep, frozen(deep, jumpBundle(DIRECT), jumping([jumpOver()])), "jump:beyond-reach");
  // Ground that can be walked on has no height limit, only the reach.
  const puddle = fixture("puddle", { featureOverrides: { ...TABLE, impassable: false, cover: "none", height: "48" } });
  const run = act(puddle, frozen(puddle, jumpBundle(DIRECT), jumping([jumpOver()])));
  assert.deepEqual(positionOf(run.state, ACTOR), point("90", "346"));
});

test("a failed Athletics DC 10 leaves the actor where it took off; a success clears the table", () => {
  const f = fixture("athletics", { featureOverrides: TABLE });
  const input = frozen(f, jumpBundle(check("str", "athletics")), jumping([jumpOver()]));
  const missed = rolled(f, input, [2]);
  assert.deepEqual(positionOf(missed.state, ACTOR), point("90", "240"));
  assert.deepEqual(ofType(missed.events, "CharacterJumped"), []);
  assert.deepEqual(applied(missed.events, "jumped"), []);
  assert.deepEqual(replayed(f, missed.events), missed.state);
  const cleared = rolled(f, input, [15]);
  assert.deepEqual(positionOf(cleared.state, ACTOR), point("90", "346"));
  assert.deepEqual(replayed(f, cleared.events), cleared.state);

  // Which roll applies is fixed: Athletics DC 10 and nothing else over a low
  // obstacle; its failure carries no jump, and nobody lands prone on it.
  refused(f, frozen(f, jumpBundle(check("str", "athletics", 12)), jumping([jumpOver()])), "jump:check-is-athletics-dc10");
  refused(f, frozen(f, jumpBundle(check("dex", "acrobatics")), jumping([jumpOver()])), "jump:check-is-athletics-dc10");
  refused(f, frozen(f, jumpBundle(check("str", "athletics")), jumping([jumpOver()], [jumpOver()])), "jump:outcomes-do-not-match-check");
  refused(f, frozen(f, jumpBundle(check("str", "athletics")), jumping([jumpOver()], [jumpOver(true)])),
    "jump:land-prone-only-on-failed-landing");
  refused(f, frozen(f, jumpBundle(DIRECT), jumping([jumpOver(true)])), "jump:land-prone-only-on-failed-landing");
});

test("landing on rubble takes Acrobatics DC 10; on a failure the actor lands prone, and replay agrees", () => {
  const f = fixture("rubble", { featureOverrides: TABLE, extraObstacles: [RUBBLE] });
  const input = frozen(f, jumpBundle(check("dex", "acrobatics")), jumping([jumpOver(false)], [jumpOver(true)]));
  const fell = rolled(f, input, [2]);
  const to = point("90", "346");
  assert.deepEqual(positionOf(fell.state, ACTOR), to);
  assert.equal(conditionsOf(fell.state, ACTOR).prone, true);
  assert.deepEqual(applied(fell.events, "jumped"), [{ kind: "jumped", characterRef: ACTOR, featureRef: FEATURE, from: point("90", "240"), to,
    running: true, landedProne: true }]);
  const jumpedAt = fell.events.findIndex(event => event.eventType === "CharacterJumped");
  const proneAt = fell.events.findIndex(event => event.eventType === "ConditionChanged" && event.payload.entityId === ACTOR
    && event.payload.conditions.prone === true);
  assert.ok(jumpedAt >= 0 && proneAt > jumpedAt, fell.events.map(event => event.eventType).join());
  assert.deepEqual(replayed(f, fell.events), fell.state);
  const view = claims(f, fell, f.state);
  assert.ok(view.renderableClaims.claims.some(claim => claim.outcomeCode === "jumped"));
  assert.ok(view.renderableClaims.claims.some(claim => claim.outcomeCode === "conditionsChanged" && /倒地已生效/.test(claim.summary)),
    JSON.stringify(view.renderableClaims.claims.map(claim => [claim.outcomeCode, claim.summary])));

  const landed = rolled(f, input, [15]);
  assert.deepEqual([positionOf(landed.state, ACTOR), conditionsOf(landed.state, ACTOR).prone], [to, undefined]);

  // The landing roll is the one that applies, and its failure lands prone.
  refused(f, frozen(f, jumpBundle(check("str", "athletics")), jumping([jumpOver()])), "jump:landing-check-is-acrobatics-dc10");
  refused(f, frozen(f, jumpBundle(check("dex", "acrobatics")), jumping([jumpOver()], [jumpOver()])), "jump:outcomes-do-not-match-check");
  refused(f, frozen(f, jumpBundle(check("dex", "acrobatics")), jumping([jumpOver(true)], [jumpOver(true)])),
    "jump:land-prone-only-on-failed-landing");
});

test("a forged landing or takeoff fails replay", () => {
  const f = fixture("forged", { featureOverrides: TABLE });
  const run = act(f, frozen(f, jumpBundle(DIRECT), jumping([jumpOver()])));
  const index = run.events.findIndex(event => event.eventType === "CharacterJumped");
  const event = run.events[index];
  assert.deepEqual(replayed(f, run.events.slice(0, index + 1)).combatRuntime.entities[ACTOR].position, event.payload.to);
  // Only up to the jump itself, so its own fold is what refuses.
  for (const payload of [{ ...event.payload, to: point("90", "400") }, { ...event.payload, to: point("90", "347") },
    { ...event.payload, from: point("90", "250") }, { ...event.payload, running: false }]) {
    const replay = f.runtime.replay(f.genesis, [...run.events.slice(0, index), { ...event, payload }]);
    assert.equal(replay.kind, "rejected", JSON.stringify(payload));
    assert.match(replay.rejection.message, /cannot be legally folded/u, JSON.stringify(replay.rejection));
  }
});

test("Rules refuses a jump that is not the step's target, unseen, inside an encounter, while held, holding, or twice", () => {
  const f = fixture("refusals", { featureOverrides: NEAR_TABLE, characterOverrides: STRONG });
  const plain = jumpBundle(DIRECT, { approach: false });
  refused(f, frozen(f, plain, plan => { plan.branches.success.effects = [jumpOver()]; }), "jump:not-a-direct-target");
  refused(f, frozen(f, plain, jumping([jumpOver(), jumpOver()])), "jump:one-per-outcome");
  refused(f, frozen(f, plain, jumping([jumpOver(), { kind: "dropProne" }])), "jump:one-per-outcome");
  // Walkable ground takes no roll at all.
  const puddle = fixture("refusals-puddle", { featureOverrides: { ...NEAR_TABLE, impassable: false, cover: "none" }, characterOverrides: STRONG });
  refused(puddle, frozen(puddle, jumpBundle(check("str", "athletics"), { approach: false }), jumping([jumpOver()])), "jump:no-roll");

  // An unseen feature is refused as unknown before the jump is weighed, so
  // nothing about it is told; planJump says the same on its own.
  const hidden = fixture("refusals-hidden", { featureOverrides: { ...NEAR_TABLE, visibilityPolicyId: "visibility:hidden-until-evidence" },
    characterOverrides: STRONG });
  refused(hidden, frozen(hidden, plain, jumping([jumpOver()])), "privateOrUnknownReference");
  assert.deepEqual(planJump(hidden.state, ACTOR, FEATURE), { kind: "rejected", code: "privateOrUnknownReference", reason: "jump:feature-unavailable" });

  const grabbed = structuredClone(f.state);
  grabbed.combatRuntime.entities[ACTOR].conditions = { grappledBy: PEER };
  refused(f, frozen(f, plain, jumping([jumpOver()]), grabbed, "grabbed"), "jump:cannot-move", grabbed);
  const holding = structuredClone(f.state);
  holding.combatRuntime.entities[PEER].conditions = { grappledBy: ACTOR };
  refused(f, frozen(f, plain, jumping([jumpOver()]), holding, "holding"), "jump:while-holding", holding);
  // Inside an encounter the map bar jumps (ADR 0091, 0098), on the jumper's
  // own turn; the KP's takeoff planner refuses it there. A bare encounter
  // record is enough for the planners, not for freezing a KP context.
  const fighting = structuredClone(f.state);
  fighting.combatRuntime.encounters["encounter:jump-test"] = { status: "active", participantEntityIds: [ACTOR, PEER], activeEntityId: PEER };
  assert.deepEqual(planJump(fighting, ACTOR, FEATURE), { kind: "rejected", code: "missingPrerequisite", reason: "jump:not-own-turn" });
  assert.deepEqual(planJumpTakeoff(fighting, ACTOR, FEATURE), { kind: "rejected", code: "missingPrerequisite", reason: "jump:inside-encounter" });
});
