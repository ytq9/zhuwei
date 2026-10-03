import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE, PROBE_SOURCE as SOURCE } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { prepareNpcReactionRequest, npcReactionModelInput, npcReactionRulesInput } from "../../../app/_runtime/lib/kp/vnext/npc-reaction.ts";
import { dueActivityDescriptors } from "../../../app/_runtime/lib/rules/v2/due-activities.ts";
import { conditionMechanics } from "../../../app/_runtime/lib/rules/v2/condition-mechanics.ts";
import { conditionFollowupDrafts } from "../../../app/_runtime/lib/rules/v2/condition-consequences.ts";
import { stepActionToDecision, committedActionRange } from "../../support/fixtures/vnext-action-lifecycle.mjs";
import { atomicCompletionInput } from "../../support/fixtures/vnext-action-duration.mjs";
import { geometry } from "../../support/fixtures/historical-world.mjs";

// SPEC 0004 §4: a contested check outside combat, and the grapple, shove and
// escape it decides. SPEC 0006 §7: the held NPC reacts from its own view.

const NAES = "npc:contest-naes", VARO = "npc:contest-varo", PEER = "character:probe-target", YARD = "scene:contest-yard";
const GRAPPLE = [{ ability: "str", skill: "athletics" }, { ability: "dex", skill: "acrobatics" }];
const NAES_SCORES = { str: 10, dex: 12, con: 14, int: 12, wis: 16, cha: 14 };

function fixture(name, { npc = {}, ...options } = {}) {
  return createAuthoredProbeFixture(`contest:${name}`, { npcCharacters: [{ id: NAES, name: "奈斯", abilityScores: NAES_SCORES, ...npc },
    { id: VARO, name: "瓦罗" }], additionalScenes: [{ id: YARD, name: "后院", geometry: geometry() }], ...options });
}

const outcome = (code, summary, extra = {}) => ({ outcomeCode: `outcome:${code}`, summary, effects: [], sensoryEvidence: [],
  pressures: [], opportunities: [], ...extra });
const felt = (observerRef, evidence, basis = ACTOR) => ({ observerRef, subjectRef: ACTOR, sense: "touch", evidence, basisRefs: [basis] });

/** The user's sample: "把奈斯拦腰抱起，扛到炉边". */
function carryBundle({ effects = [{ kind: "grapple", targetRef: NAES }], evidence = [felt(NAES, "被人拦腰抱起，双脚离了地。")],
  checks = GRAPPLE, opponentRef = NAES, target = NAES, skill = "athletics", ability = "str" } = {}) {
  return { mode: "adjudication", basisRefs: [target], terminal: { kind: "none" },
    adjudication: { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability, skill, dc: null, mode: "normal",
      risk: "奈斯会挣扎。", successOutcome: "奈斯被抱起来。", failureOutcome: "奈斯挣开了手。", opposition: { opponentRef, checks } },
    proposals: [{ basisRefs: [target], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "把奈斯拦腰抱起，扛到炉边。", method: "冲上去拦腰抱住他往上提。",
      targetRefs: [target], directTargetRefs: [target], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: outcome("held", "奈斯被拦腰抱起。", { effects, sensoryEvidence: evidence }),
        failure: outcome("slipped", "奈斯扭身挣开了。") } }] };
}

/** The next action of the same actor, from `state`, with its own frozen context. */
function nextAction(f, state, suffix) {
  const rootActionId = `${f.rootActionId}:${suffix}`;
  return { ...f, state, rootActionId, requiredContext: freezeAuthoredProbeContext(f, state, { rootActionId, focusRefs: [SOURCE, NAES, VARO] }).context };
}

function parse(bundle) {
  return parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle)));
}

function lower(f, bundle) {
  const parsed = parse(bundle);
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  return lowerVNext2ProposalBundle({ ...f, value: parsed.bundle });
}

/** Freezes the contest, then rolls `rolls`: the actor's faces, then the opponent's. */
function contest(f, bundle, rolls, state = f.state) {
  const lowered = lower(f, bundle);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const pending = stepActionToDecision(f.runtime, f.profiles, state, lowered.command.rulesInput);
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
    continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return { pending, result, events: [...pending.events, ...result.events], input: lowered.command.rulesInput };
}

/** The held NPC declines its reaction, which must settle before the next action. */
function declineReaction(f, state) {
  const [due] = dueActivityDescriptors(state).filter(work => work.npcReaction !== undefined);
  const declined = f.runtime.step(f.profiles, state, { kind: "resolveNpcReaction", proposalId: due.childRootActionId,
    reactionId: due.npcReaction.reactionId, reactionHash: due.npcReaction.reactionHash, decision: { kind: "decline", reason: "先看看他要做什么。" } });
  assert.equal(declined.kind, "committed", JSON.stringify(declined));
  return declined;
}

function replayed(f, events) {
  const replay = f.runtime.replay(f.genesis, events);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  return replay.state;
}

const heldBy = (state, id) => state.combatRuntime.entities[id].conditions.grappledBy;
const resolved = (events) => events.filter(event => event.eventType === "WorldInteractionResolved").at(-1).payload;
const toolResponse = (name, args) => ({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] });

test("a player carries a resisting NPC by a contest: it resists with its higher check, a tie keeps it free, a win holds it", () => {
  // Naes resists with Acrobatics (+1, Dexterity 12) rather than Athletics (+0).
  const tie = contest(fixture("tie"), carryBundle(), [15, 14]);
  const frozen = tie.pending.randomnessRequest;
  assert.equal(frozen.diceExpression, "1d20+1d20");
  assert.deepEqual(frozen.frozenCheck.opposition, { opponentRef: NAES, options: [{ ability: "strength", skill: "athletics" },
    { ability: "dexterity", skill: "acrobatics" }], ability: "dexterity", skill: "acrobatics", modifier: "1", mode: "normal" });
  assert.equal(frozen.frozenCheck.dc, undefined, "a contest has no DC");
  const tied = resolved(tie.events);
  assert.equal(tied.branch, "failure", "15 against 15 keeps things as they were");
  assert.deepEqual(tied.check.opposition, { opponentRef: NAES, ability: "dexterity", skill: "acrobatics", rolls: [14], selectedRoll: 14, total: 15 });
  assert.equal(tie.result.state.combatRuntime.entities[NAES].conditions.grappledBy, undefined);

  const f = fixture("win");
  const win = contest(f, carryBundle(), [16, 14]);
  const won = resolved(win.events);
  assert.equal(won.branch, "success");
  assert.deepEqual(won.appliedEffects.filter(effect => effect.kind === "grappleStarted"), [{ kind: "grappleStarted", targetRef: NAES, grapplerRef: ACTOR }]);
  assert.equal(heldBy(win.result.state, NAES), ACTOR);
  assert.equal(conditionMechanics(win.result.state, NAES).canMove, false, "a held NPC cannot walk away");
  // SPEC 0006 §7: Naes decides from his own view what to do about it.
  const opened = win.events.filter(event => event.eventType === "NpcReactionOpened");
  assert.deepEqual(opened.map(event => event.payload.characterId), [NAES]);
  assert.match(JSON.stringify(win.result.state.knowledge[NAES][opened[0].payload.factId]), /被人拦腰抱起/);
  // SPEC 0004 §11 (ADR 0083): the contest is recorded with its opponent.
  const precedent = Object.values(win.result.state.campaignRuntime.adjudicationPrecedents)[0];
  assert.equal(precedent.ruling.dc, null);
  assert.deepEqual(precedent.ruling.opposition, { opponentRef: NAES, ability: "dexterity", skill: "acrobatics" });
  assert.deepEqual(replayed(f, win.events), win.result.state);
  const projected = f.runtime.project(f.profiles, win.result.state, f.viewer, { channel: "realtime", committedRange: committedActionRange(win.result.state, {
    receiptId: win.result.receipt.receiptId, actorCharacterId: ACTOR, priorState: f.state, events: win.events }) });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  const facts = JSON.stringify(projected.renderableClaims.claims.map(claim => claim.narrationFacts));
  assert.match(facts, /对抗检定，对方总值为 15/);
  assert.match(facts, /擒抱已生效/);
});

test("a contest without a grapple: Athletics against Athletics alone, actor advantage, the opponent's proficiency counted", () => {
  // Varo is proficient in Athletics (Strength 14): +2 and +2. The actor holds
  // the valve open against him with advantage; the win applies the ordinary result.
  const f = fixture("wrest", { npcCharacters: [{ id: NAES, name: "奈斯" }, { id: VARO, name: "瓦罗",
    abilityScores: { str: 14, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, proficientSkills: ["athletics"] }] });
  const bundle = carryBundle({ target: VARO, opponentRef: VARO, checks: [{ ability: "str", skill: "athletics" }], evidence: [],
    effects: [{ kind: "definitionRevision", definitionRef: SOURCE, operations: [{ kind: "set", path: ["observableState"], value: "opened" }],
      summary: "阀门被扳开。" }] });
  bundle.adjudication.mode = "advantage";
  bundle.proposals[0].targetRefs = [SOURCE, VARO];
  bundle.proposals[0].intent = "不顾瓦罗按住阀门，把它扳开。";
  const run = contest(f, bundle, [3, 18, 15]);
  assert.equal(run.pending.randomnessRequest.diceExpression, "2d20kh1+1d20");
  assert.equal(run.pending.randomnessRequest.frozenCheck.opposition.modifier, "4");
  const done = resolved(run.events);
  assert.deepEqual([done.check.selectedRoll, done.check.total, done.check.opposition.total, done.branch], [18, 18, 19, "failure"]);
  assert.equal(run.result.state.campaignRuntime.definitions[SOURCE].content.observableState, "ready");
  const again = contest(fixture("wrest-win", { npcCharacters: [{ id: NAES, name: "奈斯" }, { id: VARO, name: "瓦罗",
    abilityScores: { str: 14, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, proficientSkills: ["athletics"] }] }), bundle, [20, 3, 15]);
  assert.equal(resolved(again.events).branch, "success");
  assert.equal(again.result.state.campaignRuntime.definitions[SOURCE].content.observableState, "opened");
  assert.deepEqual(again.events.filter(event => event.eventType === "NpcReactionOpened"), [], "only a grapple opens the held creature's reaction");
});

test("Rules refuses a grapple that is not a won contest against that NPC under SRD 5.1", () => {
  const rejectedAtLowering = (bundle, constraint) => {
    const lowered = lower(fixture(constraint), bundle);
    assert.equal(lowered.kind, "rejected", constraint);
    assert.ok(JSON.stringify(lowered).includes(constraint), JSON.stringify(lowered));
  };
  const plain = carryBundle();
  delete plain.adjudication.opposition;
  plain.adjudication.dc = 13;
  rejectedAtLowering(plain, "grapple:contest-success-against-this-creature-required");
  const onFailure = carryBundle({ effects: [] });
  onFailure.proposals[0].branches.failure.effects = [{ kind: "grapple", targetRef: NAES }];
  rejectedAtLowering(onFailure, "grapple:contest-success-against-this-creature-required");

  const rejectedByRules = (bundle, reason, mutate = () => {}) => {
    const f = fixture(reason);
    const state = structuredClone(f.state);
    mutate(state);
    const lowered = lower(nextAction(f, state, "mutated"), bundle);
    assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    const result = stepActionToDecision(f.runtime, f.profiles, state, lowered.command.rulesInput);
    assert.equal(result.kind, "rejected", reason);
    assert.ok(JSON.stringify(result.rejection).includes(reason), JSON.stringify(result.rejection));
  };
  rejectedByRules(carryBundle({ checks: [{ ability: "str", skill: "athletics" }] }), "grapple:athletics-against-athletics-or-acrobatics");
  rejectedByRules(carryBundle({ ability: "dex", skill: "acrobatics" }), "grapple:athletics-against-athletics-or-acrobatics");
  rejectedByRules(carryBundle({ evidence: [] }), "grapple:held-creature-perception-required");
  rejectedByRules(carryBundle({ target: PEER, opponentRef: PEER, effects: [{ kind: "grapple", targetRef: PEER }], evidence: [felt(PEER, "被抱住。")] }),
    "grapple:player-against-npc-only");
  rejectedByRules(carryBundle(), "grapple:target-too-large", state => {
    state.combatRuntime.entities[NAES].footprint = { width: "180", depth: "180", height: "180" };
  });

  // The opponent's choice is Rules': a frozen choice that is not the higher
  // check, or a different modifier, is refused before any die is rolled.
  const f = fixture("tampered");
  const lowered = lower(f, carryBundle());
  const input = structuredClone(lowered.command.rulesInput);
  const plan = atomicCompletionInput(input).steps[0].rulesInput.plan;
  plan.ruling.check.opposition.modifier = "5";
  const tampered = stepActionToDecision(f.runtime, f.profiles, f.state, input);
  assert.equal(tampered.kind, "rejected");
  assert.ok(JSON.stringify(tampered.rejection).includes("contest:opponent-choice-differs-from-authority"), JSON.stringify(tampered.rejection));

  // The opponent is a direct target of the step the contest decides.
  const elsewhere = parse(carryBundle({ opponentRef: VARO }));
  assert.equal(elsewhere.kind, "locallyRejected");
  assert.match(JSON.stringify(elsewhere), /contest:opponent-is-a-direct-target/);
});

test("the held NPC reacts from its own view: it may break free by its own contest, and cannot simply walk off", () => {
  const f = fixture("escape");
  const win = contest(f, carryBundle(), [16, 14]);
  const [due] = dueActivityDescriptors(win.result.state).filter(work => work.npcReaction !== undefined);
  assert.equal(due.ownerEntityId, NAES);
  const request = prepareNpcReactionRequest(win.result.state, f.profiles, f.moduleProfile, due.childRootActionId, due.npcReaction);
  assert.equal(request.context.intent.text, "被人拦腰抱起，双脚离了地。");
  const offered = JSON.stringify(npcReactionModelInput(request).tools[1]);
  assert.ok(offered.includes("\"contest\"") && offered.includes("escapeGrapple"), "the reaction can contest and break free");
  const basis = `knowledge:${NAES}:${win.result.state.campaignRuntime.npcReactions[due.npcReaction.reactionId].factId}`;
  const escape = { mode: "adjudication", basisRefs: [basis], terminal: { kind: "none" },
    adjudication: { kind: "check", durationMicros: "0", checkKind: "abilityCheck", ability: "dex", skill: "acrobatics", dc: null, mode: "normal",
      risk: "挣不开会被抱得更紧。", successOutcome: "奈斯挣脱。", failureOutcome: "奈斯仍被抱着。",
      opposition: { opponentRef: ACTOR, checks: [{ ability: "str", skill: "athletics" }] } },
    proposals: [{ basisRefs: [basis], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "从对方手里挣脱。", method: "扭腰滑出对方的手臂。", targetRefs: [ACTOR], directTargetRefs: [ACTOR], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: outcome("free", "奈斯挣脱了。", { effects: [{ kind: "escapeGrapple", grapplerRef: ACTOR }],
        sensoryEvidence: [{ observerRef: ACTOR, subjectRef: NAES, sense: "touch", evidence: "奈斯从你臂弯里滑了出去。", basisRefs: [basis] }] }),
        failure: outcome("still-held", "奈斯没能挣开。") } }] };
  const rulesInput = npcReactionRulesInput(toolResponse("submit_kp_proposal_bundle", encodeVNextStrictToolBundle(escape)), request, win.result.state, f.profiles);
  const pending = stepActionToDecision(f.runtime, f.profiles, win.result.state, rulesInput);
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  // Naes's Acrobatics +1 against the actor's Athletics +0.
  assert.deepEqual([pending.randomnessRequest.frozenCheck.modifier, pending.randomnessRequest.frozenCheck.opposition.modifier], ["1", "0"]);
  const freed = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
    continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls: [12, 9] });
  assert.equal(freed.kind, "committed", JSON.stringify(freed));
  assert.equal(heldBy(freed.state, NAES), undefined);
  assert.deepEqual(resolved(freed.events).appliedEffects.filter(effect => effect.kind === "grappleEnded"),
    [{ kind: "grappleEnded", targetRef: NAES, grapplerRef: ACTOR, reason: "escaped" }]);
  assert.equal(freed.state.campaignRuntime.npcReactions[due.npcReaction.reactionId].status, "reacted");
  assert.deepEqual(replayed(f, [...win.events, ...pending.events, ...freed.events]), freed.state);

  // Walking off while held is refused (SPEC 0006 §7: a grappled NPC cannot move).
  const leave = structuredClone(escape);
  leave.adjudication = { kind: "directSuccess", durationMicros: "0", risk: "没有风险。", successOutcome: "奈斯去后院。" };
  leave.proposals[0] = { ...leave.proposals[0], intent: "去后院。", method: "转身就走。", targetRefs: [YARD], directTargetRefs: [YARD],
    branches: { success: outcome("left", "奈斯走了。", { effects: [{ kind: "moveNpc", destination: { kind: "scene", sceneRef: YARD, travel: "none" } }] }),
      failure: { kind: "none" } } };
  const leaving = npcReactionRulesInput(toolResponse("submit_kp_proposal_bundle", encodeVNextStrictToolBundle(leave)), request, win.result.state, f.profiles);
  const refused = f.runtime.step(f.profiles, win.result.state, leaving);
  assert.equal(refused.kind, "rejected");
  assert.ok(JSON.stringify(refused.rejection).includes("movement:npc-cannot-move"), JSON.stringify(refused.rejection));
});

test("a grapple ends when the grappler lets go, leaves the scene or is incapacitated", () => {
  // Letting go is the grappler's own act.
  const f = fixture("release");
  const win = contest(f, carryBundle(), [16, 14]);
  const release = carryBundle({ effects: [{ kind: "releaseGrapple", targetRef: NAES }], evidence: [] });
  release.adjudication = { kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。", successOutcome: "奈斯被放下。" };
  release.proposals[0].intent = "把奈斯放下。";
  release.proposals[0].branches = { success: outcome("put-down", "奈斯被放回地上。", { effects: [{ kind: "releaseGrapple", targetRef: NAES }] }),
    failure: { kind: "none" } };
  const waited = declineReaction(f, win.result.state);
  const lowered = lowerVNext2ProposalBundle({ ...nextAction(f, waited.state, "release"), value: parse(release).bundle });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const released = stepActionToDecision(f.runtime, f.profiles, waited.state, lowered.command.rulesInput);
  assert.equal(released.kind, "committed", JSON.stringify(released));
  assert.equal(heldBy(released.state, NAES), undefined);
  assert.deepEqual(resolved(released.events).appliedEffects.filter(effect => effect.kind === "grappleEnded"),
    [{ kind: "grappleEnded", targetRef: NAES, grapplerRef: ACTOR, reason: "released" }]);

  // Leaving the scene ends it with the movement itself, once Naes has
  // settled his reaction (here he declines).
  const g = fixture("leave");
  const held = contest(g, carryBundle(), [16, 14]);
  const declined = declineReaction(g, held.result.state);
  const moved = g.runtime.step(g.profiles, declined.state, { kind: "moveIndividually", rootActionId: "root:contest-leave",
    characterId: ACTOR, destinationSceneId: YARD, fictionTimeCostMicros: "60000000" });
  assert.equal(moved.kind, "committed", JSON.stringify(moved));
  assert.equal(heldBy(moved.state, NAES), undefined);
  assert.equal(conditionMechanics(moved.state, NAES).canMove, true);
  assert.deepEqual(replayed(g, [...held.events, ...declined.events, ...moved.events]), moved.state);

  // An incapacitated grappler lets go: the condition follow-up says so.
  const unconscious = structuredClone(held.result.state);
  unconscious.combatRuntime.entities[ACTOR].conditions = { unconscious: true };
  const drafts = conditionFollowupDrafts(unconscious, { eventType: "ConditionChanged", rootActionId: "root:contest-knocked-out",
    payload: { entityId: ACTOR, conditions: { unconscious: true } } });
  assert.deepEqual(drafts.filter(draft => draft.eventType === "ConditionChanged").map(draft => draft.payload), [{ entityId: NAES, conditions: {} }]);
  const awake = conditionFollowupDrafts(held.result.state, { eventType: "ConditionChanged", rootActionId: "root:contest-awake",
    payload: { entityId: ACTOR, conditions: {} } });
  assert.deepEqual(awake.filter(draft => draft.eventType === "ConditionChanged"), []);
});

test("a shoved NPC lies prone until it acts on its own, and standing up comes first in that act", () => {
  const f = fixture("shove");
  const shove = contest(f, carryBundle({ effects: [{ kind: "knockProne", targetRef: VARO }], evidence: [], target: VARO, opponentRef: VARO }), [18, 2]);
  assert.equal(shove.result.state.combatRuntime.entities[VARO].conditions.prone, true);
  assert.deepEqual(resolved(shove.events).appliedEffects.filter(effect => effect.kind === "knockedProne"), [{ kind: "knockedProne", targetRef: VARO }]);
  assert.deepEqual(shove.events.filter(event => event.eventType === "NpcReactionOpened"), [], "a shove opens no reaction");
  // Varo then notices a covert act and reacts by calling out: he stands first.
  const covert = { mode: "adjudication", basisRefs: [SOURCE], terminal: { kind: "none" },
    adjudication: { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "dex", skill: "sleight", dc: null, mode: "normal",
      risk: "会被看见。", successOutcome: "阀门被悄悄拧松。", failureOutcome: "有人看见了你的手。",
      concealment: { primaryObserverRef: NAES, sense: "sight", evidence: "看见有人在阀门旁偷偷动手。", observers: [
        { observerRef: NAES, attention: "distracted", basisRefs: [SOURCE] }, { observerRef: VARO, attention: "watching", basisRefs: [SOURCE] }] } },
    proposals: [{ basisRefs: [SOURCE], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "趁乱拧松阀门。", method: "借身体挡住转动阀门。", targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: outcome("unnoticed", "阀门松了。"), failure: outcome("noticed", "阀门松了，有人看了过来。") } }] };
  const covertLowered = lowerVNext2ProposalBundle({ ...nextAction(f, shove.result.state, "covert"), value: parse(covert).bundle });
  assert.equal(covertLowered.kind, "accepted", JSON.stringify(covertLowered));
  const pending = stepActionToDecision(f.runtime, f.profiles, shove.result.state, covertLowered.command.rulesInput);
  const noticed = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
    continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls: [1] });
  assert.equal(noticed.kind, "committed", JSON.stringify(noticed));
  const [due] = dueActivityDescriptors(noticed.state).filter(work => work.npcReaction !== undefined);
  assert.equal(due.ownerEntityId, VARO);
  const request = prepareNpcReactionRequest(noticed.state, f.profiles, f.moduleProfile, due.childRootActionId, due.npcReaction);
  const basis = `knowledge:${VARO}:${noticed.state.campaignRuntime.npcReactions[due.npcReaction.reactionId].factId}`;
  const callOut = { mode: "adjudication", basisRefs: [basis], terminal: { kind: "none" },
    adjudication: { kind: "directSuccess", durationMicros: "0", risk: "对方可能恼火。", successOutcome: "瓦罗当众发问。" },
    proposals: [{ basisRefs: [basis], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "爬起来质问。", method: "撑地站起，大声发问。", targetRefs: [ACTOR], directTargetRefs: [ACTOR], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: outcome("called-out", "瓦罗站起来质问。", { sensoryEvidence: [{ observerRef: ACTOR, subjectRef: VARO, sense: "hearing",
        evidence: "瓦罗大声问你在阀门那儿干什么。", basisRefs: [basis] }] }), failure: { kind: "none" } } }] };
  const rulesInput = npcReactionRulesInput(toolResponse("submit_kp_proposal_bundle", encodeVNextStrictToolBundle(callOut)), request, noticed.state, f.profiles);
  const reacted = f.runtime.step(f.profiles, noticed.state, rulesInput);
  assert.equal(reacted.kind, "committed", JSON.stringify(reacted));
  const stood = reacted.events.findIndex(event => event.eventType === "ConditionChanged" && event.payload.entityId === VARO);
  assert.ok(stood >= 0 && reacted.events[stood].payload.conditions.prone === undefined, "Varo stands up");
  assert.ok(stood < reacted.events.findIndex(event => event.eventType === "WorldInteractionResolved"), "before his act resolves");
  assert.equal(reacted.state.combatRuntime.entities[VARO].conditions.prone, undefined);
  assert.deepEqual(replayed(f, [...shove.events, ...pending.events, ...noticed.events, ...reacted.events]), reacted.state);
});
