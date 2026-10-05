import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE, PROBE_SOURCE as SOURCE } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { dueActivityDescriptors } from "../../../app/_runtime/lib/rules/v2/due-activities.ts";
import { stepActionToDecision } from "../../support/fixtures/vnext-action-lifecycle.mjs";
import { atomicCompletionInput } from "../../support/fixtures/vnext-action-duration.mjs";
import { nextTo } from "../../../app/_runtime/lib/rules/v2/scene-approach.ts";

// SPEC 0016 §3.1, SPEC 0004 §4, SPEC 0014 §4 (ADR 0092): a world step may name
// a registered common action; its walk, effect and step order are fixed, the
// KP's ruling stands. Round 161 left "扛到炉边" in the summary only.

const NAES = "npc:common-naes", VARO = "npc:common-varo";
const GRAPPLE = [{ ability: "str", skill: "athletics" }, { ability: "dex", skill: "acrobatics" }];
// The valve stands across the room from the actor and Naes.
const FAR_VALVE = { polygon: [{ x: "420", y: "380" }, { x: "460", y: "380" }, { x: "460", y: "420" }, { x: "420", y: "420" }] };

function fixture(name, featureOverrides = FAR_VALVE) {
  return createAuthoredProbeFixture(`common:${name}`, { npcCharacters: [{ id: NAES, name: "奈斯", abilityScores: { str: 10, dex: 12, con: 14, int: 12, wis: 16, cha: 14 } },
    { id: VARO, name: "瓦罗" }], featureOverrides });
}

/** A closed, unlocked door across the room; the fixture's mapped feature becomes it. */
const DOOR = "feature:probe-valve";
const FAR_DOOR = (() => {
  const closed = { state: "closed", opaque: true, impassable: true, cover: "full", propagation: "blocks", terrain: "normal" };
  return { kind: "portal", label: "木门", state: "closed", polygon: FAR_VALVE.polygon, elevation: "0", height: "96", opaque: true, impassable: true,
    cover: "full", propagation: "blocks", terrain: "normal", stateGraph: { definitionId: "environment-definition:probe-door:open-closed-v1",
      states: [closed, { state: "open", opaque: false, impassable: false, cover: "none", propagation: "passes", terrain: "normal" }],
      transitions: [{ fromState: "closed", intent: "open", toState: "open" }, { fromState: "open", intent: "close", toState: "closed" }] } };
})();

const outcome = (code, summary, extra = {}) => ({ outcomeCode: `outcome:${code}`, summary, effects: [], sensoryEvidence: [],
  pressures: [], opportunities: [], ...extra });
const contestRuling = (overrides = {}) => ({ kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "str", skill: "athletics",
  dc: null, mode: "normal", risk: "奈斯会挣扎。", successOutcome: "奈斯被抱起来。", failureOutcome: "奈斯挣开了手。",
  opposition: { opponentRef: NAES, checks: GRAPPLE }, ...overrides });

/** One world step that names a common action, with no targets of its own written. */
function scripted(commonAction, adjudication, { intent = "把奈斯拦腰抱起，扛到阀门旁。", failure = outcome("slipped", "奈斯扭身挣开了。"),
  felt = [{ observerRef: NAES, subjectRef: ACTOR, sense: "touch", evidence: "被人拦腰抱起，双脚离了地。", basisRefs: [ACTOR] }] } = {}) {
  return { mode: "adjudication", basisRefs: [NAES], terminal: { kind: "none" }, adjudication,
    proposals: [{ basisRefs: [NAES], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent, method: "冲上去拦腰抱住他往上提。", targetRefs: [], directTargetRefs: [], instrumentRefs: [], abilityRef: { kind: "none" }, commonAction,
      branches: { success: outcome("done", "奈斯被拦腰抱起。", { sensoryEvidence: felt }), failure: adjudication.kind === "check" ? failure : null } }] };
}
const carry = { kind: "carry", targetRef: NAES, destinationRef: SOURCE, option: "none" };

function lower(f, bundle) {
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle)));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  return lowerVNext2ProposalBundle({ ...f, value: parsed.bundle });
}

/** The same actor's next action from `state`, with its own frozen context. */
function next(f, state, suffix) {
  const rootActionId = `${f.rootActionId}:${suffix}`;
  return { ...f, state, rootActionId, requiredContext: freezeAuthoredProbeContext(f, state, { rootActionId, focusRefs: [SOURCE, NAES, VARO] }).context };
}

function acted(f, bundle) {
  const lowered = lower(f, bundle);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(result.kind, "committed", JSON.stringify(result.kind === "rejected" ? result.rejection : result.kind));
  return result;
}

function rolled(f, bundle, rolls) {
  const lowered = lower(f, bundle);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const pending = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
    continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return { result, events: [...pending.events, ...result.events] };
}

const heldBy = (state, id) => state.combatRuntime.entities[id].conditions.grappledBy;
const walks = events => events.filter(event => event.eventType === "CharacterRepositioned");

test("carry by script: a won contest grabs Naes and then walks him to the valve; a lost one leaves both where they were", () => {
  const f = fixture("carry");
  const won = rolled(f, scripted(carry, contestRuling()), [16, 14]);
  const entities = won.result.state.combatRuntime.entities;
  assert.equal(heldBy(won.result.state, NAES), ACTOR);
  const [walk] = walks(won.events);
  assert.deepEqual(walk?.payload.toward, { kind: "nextTo", ref: SOURCE }, won.events.map(event => event.eventType).join());
  assert.deepEqual(walk.payload.carried.map(entry => entry.characterId), [NAES]);
  assert.deepEqual(entities[ACTOR].position, walk.payload.path.at(-1), "the actor ends the walk to the valve");
  assert.notDeepEqual(entities[ACTOR].position, f.state.combatRuntime.entities[ACTOR].position, "the actor walked");
  assert.ok(nextTo(entities[NAES], entities[ACTOR]), "Naes stops beside the actor");
  assert.deepEqual(entities[NAES].position, walk.payload.carried[0].position);
  const replay = f.runtime.replay(f.genesis, won.events);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  assert.deepEqual(replay.state, won.result.state);

  const g = fixture("carry-lost");
  const lost = rolled(g, scripted(carry, contestRuling()), [10, 14]);
  assert.equal(heldBy(lost.result.state, NAES), undefined);
  assert.deepEqual(walks(lost.events).map(event => event.payload.toward), [], "no walk to the valve after a lost grab");
  assert.deepEqual(lost.result.state.combatRuntime.entities[ACTOR].position, g.state.combatRuntime.entities[ACTOR].position);
});

// Round 162: the KP's success text put Naes down at the hearth, which the
// carry alone does not do; a release step after it, on success only, does.
test("carry then put down in one act: on a win Naes ends beside the actor at the valve and free; on a loss nothing moves", () => {
  const putDown = bundle => {
    bundle.proposals.push({ basisRefs: [NAES], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "onSuccess",
      intent: "到了阀门旁把奈斯放下。", method: "松手让他落地。", targetRefs: [], directTargetRefs: [], instrumentRefs: [], abilityRef: { kind: "none" },
      commonAction: { kind: "release", targetRef: NAES, destinationRef: null, option: "none" },
      branches: { success: outcome("put-down", "奈斯被放下。"), failure: null } });
    return bundle;
  };
  const f = fixture("carry-put-down");
  const won = rolled(f, putDown(scripted(carry, contestRuling())), [16, 14]);
  const entities = won.result.state.combatRuntime.entities;
  const [walk] = walks(won.events);
  assert.deepEqual(walk?.payload.toward, { kind: "nextTo", ref: SOURCE }, won.events.map(event => event.eventType).join());
  assert.deepEqual(entities[NAES].position, walk.payload.carried[0].position, "carried to the valve first");
  assert.equal(heldBy(won.result.state, NAES), undefined, "then let go");
  assert.ok(nextTo(entities[NAES], entities[ACTOR]));

  const g = fixture("carry-put-down-lost");
  const lost = rolled(g, putDown(scripted(carry, contestRuling())), [10, 14]);
  assert.deepEqual(walks(lost.events).map(event => event.payload.toward), []);
  assert.deepEqual(lost.result.state.combatRuntime.entities[NAES].position, g.state.combatRuntime.entities[NAES].position);
});

// Round 165: the KP wrote the carry and left the put-down out; option
// putDown sets Naes down on arrival, in the carry's own walk step.
test("carry with option putDown: on a win Naes ends free beside the actor at the valve", () => {
  const f = fixture("carry-option-put-down");
  const won = rolled(f, scripted({ ...carry, option: "putDown" }, contestRuling()), [16, 14]);
  const entities = won.result.state.combatRuntime.entities;
  const [walk] = walks(won.events);
  assert.deepEqual(walk?.payload.toward, { kind: "nextTo", ref: SOURCE }, won.events.map(event => event.eventType).join());
  assert.deepEqual(entities[NAES].position, walk.payload.carried[0].position, "carried to the valve first");
  assert.equal(heldBy(won.result.state, NAES), undefined, "then set down");
  assert.ok(nextTo(entities[NAES], entities[ACTOR]));
  const replay = f.runtime.replay(f.genesis, won.events);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
});

test("walking somewhere and letting go are scripts too: no target written, no roll, the same lowering path", () => {
  const f = fixture("walk");
  const direct = { kind: "directSuccess", durationMicros: "0", risk: "没有风险。", successOutcome: "走到瓦罗身边。" };
  const walk = scripted({ kind: "walkTo", targetRef: null, destinationRef: VARO, option: "none" }, direct, { intent: "走到瓦罗身边。" });
  const lowered = lower(f, walk);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const walked = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(walked.kind, "committed", JSON.stringify(walked));
  const entities = walked.state.combatRuntime.entities;
  assert.ok(nextTo(entities[ACTOR], entities[VARO]), "the actor reached Varo");

  // Hold Naes, let him settle his reaction, then put him down by script.
  const g = fixture("release");
  const held = rolled(g, scripted(carry, contestRuling()), [16, 14]);
  const [due] = dueActivityDescriptors(held.result.state).filter(work => work.npcReaction !== undefined);
  const waited = g.runtime.step(g.profiles, held.result.state, { kind: "resolveNpcReaction", proposalId: due.childRootActionId,
    reactionId: due.npcReaction.reactionId, reactionHash: due.npcReaction.reactionHash, decision: { kind: "decline", reason: "等落地再说。" } });
  assert.equal(waited.kind, "committed", JSON.stringify(waited));
  const rootActionId = `${g.rootActionId}:release`;
  const next = { ...g, state: waited.state, rootActionId,
    requiredContext: freezeAuthoredProbeContext(g, waited.state, { rootActionId, focusRefs: [SOURCE, NAES, VARO] }).context };
  const release = scripted({ kind: "release", targetRef: NAES, destinationRef: null, option: "none" },
    { kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。", successOutcome: "奈斯被放下。" }, { intent: "把奈斯放下。", felt: [] });
  const put = lower(next, release);
  assert.equal(put.kind, "accepted", JSON.stringify(put));
  const released = stepActionToDecision(g.runtime, g.profiles, waited.state, put.command.rulesInput);
  assert.equal(released.kind, "committed", JSON.stringify(released));
  assert.equal(heldBy(released.state, NAES), undefined);
});

test("shove, door and posture scripts: push 5 feet on a won contest, walk to a far door and open it, lie down and stand", () => {
  const f = fixture("shove");
  const before = structuredClone(f.state.combatRuntime.entities[NAES].position);
  const shoved = rolled(f, scripted({ kind: "shove", targetRef: NAES, destinationRef: null, option: "push" }, contestRuling(),
    { intent: "把奈斯推开。", felt: [] }), [16, 14]);
  const [pushed] = shoved.events.filter(event => event.eventType === "CreaturePushed");
  assert.deepEqual(pushed?.payload.from, before, shoved.events.map(event => event.eventType).join());
  assert.deepEqual(shoved.result.state.combatRuntime.entities[NAES].position, pushed.payload.to);
  assert.equal(heldBy(shoved.result.state, NAES), undefined);

  const g = fixture("door", FAR_DOOR);
  const direct = intent => ({ kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。", successOutcome: intent });
  const opened = acted(g, scripted({ kind: "door", targetRef: DOOR, destinationRef: null, option: "open" }, direct("门开了。"),
    { intent: "走过去把门打开。", felt: [] }));
  assert.deepEqual(walks(opened.events).map(event => event.payload.toward), [{ kind: "nextTo", ref: DOOR }]);
  const changed = opened.events.find(event => event.eventType === "EnvironmentFeatureStateChanged");
  assert.deepEqual([changed?.payload.featureId, changed?.payload.fromState, changed?.payload.toState], [DOOR, "closed", "open"]);

  // SPEC 0014 §4 (ADR 0092): round 167 opened the already open yard door to
  // go out; Rules refused that at commit as a world ruling. The KP is now
  // told the door's state and what it can do from there, and can revise.
  const ajar = fixture("door-open", { ...FAR_DOOR, state: "open", opaque: false, impassable: false, cover: "none", propagation: "passes" });
  const reopened = lower(ajar, scripted({ kind: "door", targetRef: DOOR, destinationRef: null, option: "open" }, direct("门开了。"),
    { intent: "穿过开着的门。", felt: [] }));
  assert.equal(reopened.kind, "rejected");
  assert.deepEqual(reopened.diagnostics.map(entry => [entry.constraint, entry.expected?.doorState, entry.expected?.options]),
    [["commonAction:door-state", "open", ["close"]]]);
  const shut = acted(ajar, scripted({ kind: "door", targetRef: DOOR, destinationRef: null, option: "close" }, direct("门关上了。"),
    { intent: "走过去把门关上。", felt: [] }));
  const closing = shut.events.find(event => event.eventType === "EnvironmentFeatureStateChanged");
  assert.deepEqual([closing?.payload.fromState, closing?.payload.toState], ["open", "closed"]);

  const h = fixture("posture");
  const lying = acted(h, scripted({ kind: "dropProne", targetRef: null, destinationRef: null, option: "none" }, direct("趴下了。"),
    { intent: "趴到地上。", felt: [] }));
  assert.equal(h.state.combatRuntime.entities[ACTOR].conditions.prone, undefined);
  assert.equal(lying.state.combatRuntime.entities[ACTOR].conditions.prone, true);
  const up = next(h, lying.state, "stand");
  const stood = lower(up, scripted({ kind: "standUp", targetRef: null, destinationRef: null, option: "none" }, direct("站起来了。"),
    { intent: "站起来。", felt: [] }));
  assert.equal(stood.kind, "accepted", JSON.stringify(stood));
  const standing = stepActionToDecision(h.runtime, h.profiles, lying.state, stood.command.rulesInput);
  assert.equal(standing.kind, "committed", JSON.stringify(standing.kind === "rejected" ? standing.rejection : standing.kind));
  assert.equal(standing.state.combatRuntime.entities[ACTOR].conditions.prone, undefined);
});

// SPEC 0014 §4: the jump script walks to the feature and jumps it; a roll is
// only Athletics DC 10 to clear it or Acrobatics DC 10 to land, and a failed
// landing still lands, prone.
test("jump by script: the walk and the jump are filled in, and only the SRD jump checks are accepted", () => {
  const f = fixture("jump-lowering");
  const jump = { kind: "jump", targetRef: DOOR, destinationRef: null, option: "none" };
  const plan = (ruling, options) => {
    const lowered = lower(f, scripted(jump, ruling, { intent: "跳过阀门。", felt: [], ...options }));
    assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    return atomicCompletionInput(lowered.command.rulesInput).steps[0].rulesInput.plan;
  };
  const effects = (branch) => branch.effects.filter(effect => effect.kind === "jumpOver");
  const free = plan({ kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。", successOutcome: "跳过去了。" });
  // The walk ends on a takeoff spot the jump can be made from (round 163).
  assert.equal(free.approach.kind, "point", JSON.stringify(free.approach));
  assert.deepEqual(free.directTargetRefs, [DOOR]);
  assert.deepEqual(effects(free.branches.success), [{ kind: "jumpOver", featureRef: DOOR, landProne: false }]);
  const check = (ability, skill, dc) => ({ kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability, skill, dc, mode: "normal",
    risk: "可能摔倒。", successOutcome: "稳稳落地。", failureOutcome: "没跳过去。" });
  const clearing = plan(check("str", "athletics", 10));
  assert.deepEqual(effects(clearing.branches.success), [{ kind: "jumpOver", featureRef: DOOR, landProne: false }]);
  assert.deepEqual(effects(clearing.branches.failure), [], "a failed clearing roll hits the obstacle and stays");
  const landing = plan(check("dex", "acrobatics", 10));
  assert.deepEqual(effects(landing.branches.failure), [{ kind: "jumpOver", featureRef: DOOR, landProne: true }]);
  for (const ruling of [check("str", "athletics", 12), check("dex", "acrobatics", 15), check("wis", "perception", 10)]) {
    const refused = lower(f, scripted(jump, ruling, { intent: "跳过阀门。", felt: [] }));
    assert.equal(refused.kind, "rejected");
    assert.deepEqual(refused.diagnostics.map(entry => entry.constraint), ["commonAction:jump-check"]);
  }
  // Round 163-2: the same jump written again in a step bound to success goes
  // back for revision instead of running twice.
  const twice = scripted(jump, check("str", "athletics", 10), { intent: "跳过阀门。", felt: [] });
  twice.proposals.push({ ...structuredClone(twice.proposals[0]), outcomeBinding: "onSuccess",
    branches: { success: outcome("jumped-again", "跳了过去。"), failure: null } });
  const repeated = lower(f, twice);
  assert.equal(repeated.kind, "rejected");
  assert.deepEqual(repeated.diagnostics.map(entry => [entry.constraint, entry.path]), [["commonAction:repeated", ["proposals", 1, "commonAction"]]]);
  // A wall too tall to jump from anywhere goes back to the KP to rule, not to Rules.
  const wall = fixture("jump-wall", { ...FAR_VALVE, kind: "barrier", label: "高墙", height: "120", impassable: true });
  const tooTall = lower(wall, scripted(jump, { kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。", successOutcome: "跳过去了。" },
    { intent: "跳过高墙。", felt: [] }));
  assert.equal(tooTall.kind, "rejected");
  assert.deepEqual(tooTall.diagnostics.map(entry => [entry.constraint, entry.expected?.reason]), [["commonAction:jump-impossible", "jump:obstacle-too-high"]]);
});

// The script end to end: walk to a 30-inch table, jump it; a failed landing
// roll on rubble beyond it still lands, prone (Strength 18: 18 feet running).
test("jump by script over a low table: the actor lands beyond it; on rubble a failed Acrobatics roll lands prone", () => {
  const rectangle = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const table = { kind: "barrier", label: "长桌", state: "present", polygon: rectangle("40", "280", "160", "316"), elevation: "0", height: "30",
    opaque: false, impassable: true, cover: "half", propagation: "passes", terrain: "normal" };
  const rubble = { featureId: "feature:probe-rubble", kind: "terrain", label: "碎石", state: "present", polygon: rectangle("0", "330", "200", "420"),
    elevation: "0", height: "6", opaque: false, impassable: false, cover: "none", propagation: "passes", terrain: "rubble",
    visibilityPolicyId: "visibility:scene-observers" };
  const strong = { [ACTOR]: { abilityScores: { str: 18, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } } };
  const jump = { kind: "jump", targetRef: DOOR, destinationRef: null, option: "none" };
  const npcCharacters = [{ id: NAES, name: "奈斯" }, { id: VARO, name: "瓦罗" }];
  const f = createAuthoredProbeFixture("common:jump-table", { npcCharacters, featureOverrides: table, characterOverrides: strong });
  const over = acted(f, scripted(jump, { kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。", successOutcome: "跳过了长桌。" },
    { intent: "跑两步跳过长桌。", felt: [] }));
  const [jumped] = over.events.filter(event => event.eventType === "CharacterJumped");
  assert.equal(jumped?.payload.featureId, DOOR, over.events.map(event => event.eventType).join());
  assert.ok(BigInt(jumped.payload.to.y) > 316n, `lands past the table: ${JSON.stringify(jumped.payload.to)}`);
  assert.deepEqual(over.state.combatRuntime.entities[ACTOR].position, jumped.payload.to);
  const replay = f.runtime.replay(f.genesis, over.events);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));

  const g = createAuthoredProbeFixture("common:jump-rubble", { npcCharacters, featureOverrides: table, extraObstacles: [rubble], characterOverrides: strong });
  const landing = { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "dex", skill: "acrobatics", dc: 10, mode: "normal",
    risk: "碎石会让人站不稳。", successOutcome: "稳稳落地。", failureOutcome: "摔在碎石上。" };
  const fell = rolled(g, scripted(jump, landing, { intent: "跳过长桌，落到碎石上。", felt: [] }), [3]);
  assert.ok(fell.events.some(event => event.eventType === "CharacterJumped"), "a failed landing still lands");
  assert.equal(fell.result.state.combatRuntime.entities[ACTOR].conditions.prone, true);
});

// SPEC 0004 §4 (ADR 0097): hiding is a concealed Stealth check; the hide is
// written in both outcomes, since Rules keeps the Stealth total either way.
test("hide by script: a concealed Stealth check carries the hide in both outcomes; any other ruling goes back", () => {
  const f = fixture("hide-lowering");
  const hide = { kind: "hide", targetRef: null, destinationRef: null, option: "none" };
  const concealed = { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "dex", skill: "stealth", dc: null, mode: "normal",
    risk: "可能被看见。", successOutcome: "躲好了。", failureOutcome: "奈斯瞥见了你。",
    concealment: { primaryObserverRef: NAES, sense: "sight", evidence: "瞥见有人缩到阀门后面。", observers: [] } };
  const lowered = lower(f, scripted(hide, concealed, { intent: "躲到阀门后面。", felt: [] }));
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const plan = atomicCompletionInput(lowered.command.rulesInput).steps[0].rulesInput.plan;
  for (const branch of [plan.branches.success, plan.branches.failure]) {
    assert.deepEqual(branch.effects.filter(effect => effect.kind === "hide"), [{ kind: "hide" }]);
  }
  const plain = { ...concealed, dc: 12 };
  delete plain.concealment;
  for (const ruling of [plain, { kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。", successOutcome: "躲好了。" },
    { ...concealed, ability: "dex", skill: "sleight" }]) {
    const refused = lower(f, scripted(hide, ruling, { intent: "躲到阀门后面。", felt: [] }));
    assert.equal(refused.kind, "rejected", JSON.stringify(ruling));
    assert.deepEqual(refused.diagnostics.map(entry => entry.constraint), ["commonAction:hide-check"]);
  }
});

// The hide end to end, in the open (SPEC 0004 §4, ADR 0097): the act freezes
// the Stealth d20 and a Perception d20 for Naes (+3) and for Varo (+0), each
// with +5 for no cover. Stealth 20 outlasts their 1s; Stealth 2 is found by
// Naes at once, and Varo, after him, does not roll.
test("hide by script in the open: a high Stealth total outlasts Naes's and Varo's rolls, a low one is found at once", () => {
  const hide = { kind: "hide", targetRef: null, destinationRef: null, option: "none" };
  const concealed = { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "dex", skill: "stealth", dc: null, mode: "normal",
    risk: "可能被看见。", successOutcome: "躲好了。", failureOutcome: "奈斯瞥见了你。",
    concealment: { primaryObserverRef: NAES, sense: "sight", evidence: "瞥见有人往角落里缩。", observers: [] } };
  const f = fixture("hide-open");
  const hidden = rolled(f, scripted(hide, concealed, { intent: "就地蹲下躲起来。", felt: [] }), [20, 1, 1]);
  assert.deepEqual(hidden.result.state.combatRuntime.entities[ACTOR].conditions.hidden, { stealthTotal: "20" });
  assert.deepEqual(hidden.events.filter(event => event.eventType === "HiddenPerceptionRolled").map(event => event.payload.rolls.map(roll => roll.total)),
    [[9, 6]]);
  const replay = f.runtime.replay(f.genesis, hidden.events);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  assert.deepEqual(replay.state, hidden.result.state);
  const g = fixture("hide-open-low");
  const seen = rolled(g, scripted(hide, concealed, { intent: "就地蹲下躲起来。", felt: [] }), [2, 1, 1]);
  assert.deepEqual(seen.events.filter(event => event.eventType === "HiddenPerceptionRolled").map(event => event.payload.foundByRef), [NAES]);
  assert.equal(seen.result.state.combatRuntime.entities[ACTOR].conditions.hidden, undefined);
});

// ADR 0095: one revision hears of every problem. Round 164-4 spent its
// three rounds on one problem each and ran out.
test("a revision lists every problem: lowering reports all scripts and the duration; a refused draft also names its script mistakes", () => {
  const f = fixture("all-problems");
  // Lowering: a carry ruled as a plain check, with no duration, on an act that also lets go wrongly.
  const plainCheck = { ...contestRuling({ dc: 12 }), durationMicros: "0" };
  delete plainCheck.opposition;
  const bundle = scripted(carry, plainCheck);
  bundle.proposals.push({ ...structuredClone(bundle.proposals[0]), outcomeBinding: "onSuccess",
    commonAction: { kind: "dropProne", targetRef: null, destinationRef: null, option: "none" },
    branches: { success: outcome("lay", "趴下了。"), failure: null } });
  const lowered = lower(f, bundle);
  assert.equal(lowered.kind, "rejected");
  assert.deepEqual(lowered.diagnostics.map(entry => entry.constraint).sort(),
    ["bundle2:duration-required-for-in-world-act", "commonAction:contest-required"]);

  // A draft refused before lowering (a check with no step under it) still
  // names the grapple that is not a contest.
  const grapple = { kind: "grapple", targetRef: NAES, destinationRef: null, option: "none" };
  const wire = encodeVNextStrictToolBundle(scripted(grapple, { kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。",
    successOutcome: "抱住了。" }));
  wire.decision = { ...wire.decision, kind: "check", checkKind: "abilityCheck", ability: "str", skill: "athletics", dc: 12, mode: "normal",
    failureOutcome: "没抱住。", checkStep: "worldInteraction" };
  let refused;
  try { parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wire)); } catch (error) { refused = error; }
  assert.ok(refused?.diagnostics, String(refused));
  const found = refused.diagnostics.map(entry => [entry.constraint, entry.pathBase, entry.path?.join("/")]);
  assert.ok(found.some(([constraint]) => constraint === "filling:check-step-required"), JSON.stringify(found));
  // Pointed at the step as the KP wrote it, under steps.
  assert.ok(found.some(([constraint, base, path]) => constraint === "commonAction:contest-required" && base === "arguments"
    && path === "steps/worldInteraction/0/commonAction/kind"), JSON.stringify(found));
});

test("the KP's ruling must fit what SRD fixes: a contest uses Athletics against Athletics or Acrobatics, and walking takes no roll", () => {
  const f = fixture("terms");
  const wrongSkill = lower(f, scripted(carry, contestRuling({ ability: "dex", skill: "acrobatics" })));
  assert.equal(wrongSkill.kind, "rejected");
  assert.deepEqual(wrongSkill.diagnostics.map(entry => [entry.constraint, entry.expected]),
    [["commonAction:contest-terms", { ability: "str", skill: "athletics" }]], JSON.stringify(wrongSkill.diagnostics));
  const dcCheck = contestRuling({ dc: 12 });
  delete dcCheck.opposition;
  const direct = { kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。", successOutcome: "奈斯被抱起来。" };
  for (const ruling of [dcCheck, direct]) {
    const uncontested = lower(f, scripted(carry, ruling));
    assert.equal(uncontested.kind, "rejected");
    assert.deepEqual(uncontested.diagnostics.map(entry => entry.constraint), ["commonAction:contest-required"]);
  }
  const unfelt = lower(f, scripted(carry, contestRuling(), { felt: [] }));
  assert.equal(unfelt.kind, "rejected");
  assert.deepEqual(unfelt.diagnostics.map(entry => [entry.constraint, entry.path]),
    [["commonAction:grabbed-creature-perception", ["proposals", 0, "branches", "success", "sensoryEvidence"]]]);
  const toVaro = { kind: "walkTo", targetRef: null, destinationRef: VARO, option: "none" };
  const rolledWalk = lower(f, scripted(toVaro, { ...dcCheck, risk: "地上湿滑。" }, { intent: "走到瓦罗身边。" }));
  assert.equal(rolledWalk.kind, "rejected");
  // The walk's five minutes are a second problem, told in the same revision (ADR 0095).
  assert.deepEqual(rolledWalk.diagnostics.map(entry => entry.constraint).sort(), ["bundle2:duration-forbidden-for-walk", "commonAction:no-roll"]);
  // SPEC 0014 §4: a walk within the scene takes no fictional time outside an encounter.
  const timedWalk = lower(f, scripted(toVaro, { ...direct, successOutcome: "走到瓦罗身边。" }, { intent: "走到瓦罗身边。" }));
  assert.equal(timedWalk.kind, "rejected");
  assert.deepEqual(timedWalk.issues, ["bundle2:duration-forbidden-for-walk"]);
  // Round 163-4 wrote {kind:"hide"} alone; the unused fields read as none.
  const bare = encodeVNextStrictToolBundle(scripted({ kind: "walkTo", targetRef: null, destinationRef: VARO, option: "none" },
    { ...direct, durationMicros: "0", successOutcome: "走到瓦罗身边。" }, { intent: "走到瓦罗身边。", felt: [] }));
  bare.steps.worldInteraction[0].commonAction = { kind: "walkTo", destinationRef: VARO };
  const read = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(bare));
  assert.equal(read.kind, "accepted", JSON.stringify(read));
  assert.deepEqual(read.bundle.proposals[0].commonAction, { kind: "walkTo", targetRef: null, destinationRef: VARO, option: "none" });
  // A script with the wrong fields for its kind never reaches lowering.
  const missing = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(
    scripted({ ...carry, destinationRef: null }, contestRuling()))));
  assert.notEqual(missing.kind, "accepted");
  assert.deepEqual(missing.diagnostics.map(entry => [entry.constraint, entry.path]), [["commonAction:carry-fields", ["proposals", 0, "commonAction"]]]);
});

// Round 166: a freely composed step whose commonAction is {kind:"none"} with
// every other field "none" too, as the guidance says of unused fields, has
// no common action; two such steps are not one action written twice.
test("a commonAction of kind none with its fields all none is no common action", () => {
  const f = fixture("none-common-action");
  const bundle = scripted({ kind: "none" }, contestRuling({ opposition: undefined, dc: 12, skill: "athletics" }), { intent: "推开阀门。", felt: [] });
  Object.assign(bundle.proposals[0], { targetRefs: [DOOR], directTargetRefs: [DOOR] });
  bundle.proposals.push({ ...structuredClone(bundle.proposals[0]), outcomeBinding: "onSuccess", intent: "再看一眼。",
    branches: { success: outcome("looked", "看了一眼。"), failure: null } });
  const wire = encodeVNextStrictToolBundle(bundle);
  const allNone = { kind: "none", targetRef: "none", destinationRef: "none", option: "none" };
  const entries = [...Object.values(wire.check ?? {}), ...Object.values(wire.steps ?? {})].flat();
  assert.ok(entries.length >= 2, JSON.stringify(wire).slice(0, 400));
  for (const entry of entries) entry.commonAction = { ...allNone };
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wire));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  assert.ok(parsed.bundle.proposals.every(entry => !("commonAction" in entry)), JSON.stringify(parsed.bundle.proposals.map(entry => entry.commonAction)));
  const lowered = lowerVNext2ProposalBundle({ ...f, value: parsed.bundle });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
});
