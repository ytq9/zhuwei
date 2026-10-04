import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE, PROBE_SOURCE as SOURCE } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { dueActivityDescriptors } from "../../../app/_runtime/lib/rules/v2/due-activities.ts";
import { stepActionToDecision } from "../../support/fixtures/vnext-action-lifecycle.mjs";
import { nextTo } from "../../../app/_runtime/lib/rules/v2/scene-approach.ts";

// SPEC 0016 §3.1, SPEC 0004 §4, SPEC 0014 §4 (ADR 0092): a world step may name
// a registered common action; its walk, effect and step order are fixed, the
// KP's ruling stands. Round 161 left "扛到炉边" in the summary only.

const NAES = "npc:common-naes", VARO = "npc:common-varo";
const GRAPPLE = [{ ability: "str", skill: "athletics" }, { ability: "dex", skill: "acrobatics" }];
// The valve stands across the room from the actor and Naes.
const FAR_VALVE = { polygon: [{ x: "420", y: "380" }, { x: "460", y: "380" }, { x: "460", y: "420" }, { x: "420", y: "420" }] };

function fixture(name) {
  return createAuthoredProbeFixture(`common:${name}`, { npcCharacters: [{ id: NAES, name: "奈斯", abilityScores: { str: 10, dex: 12, con: 14, int: 12, wis: 16, cha: 14 } },
    { id: VARO, name: "瓦罗" }], featureOverrides: FAR_VALVE });
}

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
  assert.deepEqual(rolledWalk.diagnostics.map(entry => entry.constraint), ["commonAction:no-roll"]);
  // SPEC 0014 §4: a walk within the scene takes no fictional time outside an encounter.
  const timedWalk = lower(f, scripted(toVaro, { ...direct, successOutcome: "走到瓦罗身边。" }, { intent: "走到瓦罗身边。" }));
  assert.equal(timedWalk.kind, "rejected");
  assert.deepEqual(timedWalk.issues, ["bundle2:duration-forbidden-for-walk"]);
  // A script with the wrong fields for its kind never reaches lowering.
  const missing = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(
    scripted({ ...carry, destinationRef: null }, contestRuling()))));
  assert.notEqual(missing.kind, "accepted");
  assert.deepEqual(missing.diagnostics.map(entry => [entry.constraint, entry.path]), [["commonAction:carry-fields", ["proposals", 0, "commonAction"]]]);
});
