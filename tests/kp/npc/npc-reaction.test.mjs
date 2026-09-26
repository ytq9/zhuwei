import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { dueActivityDescriptors } from "../../../app/_runtime/lib/rules/v2/due-activities.ts";
import { stepActionToDecision } from "../../support/fixtures/vnext-action-lifecycle.mjs";
import { prepareNpcReactionRequest, npcReactionModelInput, npcReactionRulesInput } from "../../../app/_runtime/lib/kp/vnext/npc-reaction.ts";
import { geometry } from "../../support/fixtures/historical-world.mjs";

const PEER = "character:probe-target", LIAN = "npc:reaction-lian", VARO = "npc:reaction-varo", SOURCE = "definition:probe-valve";

function fixture(name) {
  return createAuthoredProbeFixture(`npc-reaction:${name}`, { npcCharacters: [{ id: LIAN, name: "莉安" }, { id: VARO, name: "瓦罗" }] });
}

/** The actor works the valve behind Lian's back while Varo watches. */
function covertBundle() {
  const heard = (evidence) => ({ observerRef: ACTOR, subjectRef: SOURCE, sense: "hearing", evidence, basisRefs: [SOURCE] });
  const branch = (suffix, summary) => ({ outcomeCode: `outcome:${suffix}`, summary, effects: [], sensoryEvidence: [heard(summary)], pressures: [], opportunities: [] });
  return { mode: "adjudication", basisRefs: [SOURCE], terminal: { kind: "none" },
    adjudication: { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "dex", skill: "sleight", dc: null, mode: "normal",
      risk: "莉安会追问。", successOutcome: "阀门被悄悄拧松。", failureOutcome: "莉安看见了你的手。",
      concealment: { primaryObserverRef: LIAN, sense: "sight", evidence: "看见有人在阀门旁偷偷动手。", observers: [
        { observerRef: LIAN, attention: "distracted", basisRefs: [SOURCE] }, { observerRef: VARO, attention: "watching", basisRefs: [SOURCE] }] } },
    proposals: [{ basisRefs: [SOURCE], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "趁人不注意拧松阀门。", method: "借身体挡住，悄悄转动阀门。",
      targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: branch("unnoticed", "阀门松开了，没有人出声。"), failure: branch("noticed", "阀门松开了，莉安看向你的手。") } }] };
}

/** Commits the covert act with a d20 of `roll` and returns the new state. */
function covertAct(f, roll) {
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(covertBundle())));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  const lowered = lowerVNext2ProposalBundle({ ...f, value: parsed.bundle });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const pending = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
    continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls: [roll] });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return { state: result.state, events: [...pending.events, ...result.events] };
}

function replayed(f, events) {
  const replay = f.runtime.replay(f.genesis, events);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  return replay.state;
}

// SPEC 0006 §7: only a noticing NPC other than the primary observer gets a
// reaction; a noticing player character only gets the evidence.
test("a noticing bystander NPC gets one open reaction; the primary and a noticing player do not", () => {
  const f = fixture("opened");
  const { state, events } = covertAct(f, 1);
  const opened = events.filter(event => event.eventType === "NpcReactionOpened");
  assert.deepEqual(opened.map(event => event.payload.characterId), [VARO]);
  assert.equal(opened[0].visibilityPolicyId, `visibility:knowledge-holder:${VARO}`);
  assert.equal(opened[0].secrecy, "private");
  const record = state.campaignRuntime.npcReactions[opened[0].payload.reactionId];
  assert.equal(record.status, "open");
  assert.match(JSON.stringify(state.knowledge[VARO][record.factId]), /看见有人在阀门旁偷偷动手/, "the reaction is about what Varo saw");
  const due = dueActivityDescriptors(state).filter(work => work.npcReaction !== undefined);
  assert.deepEqual(due.map(work => [work.ownerEntityId, work.childRootActionId]), [[VARO, record.childRootActionId]]);
  assert.deepEqual(replayed(f, events), state);
  assert.deepEqual(Object.keys(covertAct(fixture("unnoticed"), 20).state.campaignRuntime.npcReactions ?? {}), [], "no one noticed");
});

test("a reaction closes once, by declining or lapsing, and replays to the same state", () => {
  for (const decision of [{ kind: "decline", reason: "瓦罗认为这事与自己无关。" }, { kind: "lapse", code: "ACTOR_PLAN_DECISION_OUTCOME_UNKNOWN" }]) {
    const f = fixture(`closed:${decision.kind}`);
    const act = covertAct(f, 1);
    const [due] = dueActivityDescriptors(act.state).filter(work => work.npcReaction !== undefined);
    const input = { kind: "resolveNpcReaction", proposalId: due.childRootActionId, reactionId: due.npcReaction.reactionId,
      reactionHash: due.npcReaction.reactionHash, decision };
    const closed = f.runtime.step(f.profiles, act.state, input);
    assert.equal(closed.kind, "committed", JSON.stringify(closed));
    assert.deepEqual(closed.events.map(event => [event.eventType, event.payload.outcome, event.secrecy]),
      [["NpcReactionSettled", decision.kind === "decline" ? "declined" : "lapsed", "private"]]);
    assert.equal(closed.state.campaignRuntime.npcReactions[due.npcReaction.reactionId].status, decision.kind === "decline" ? "declined" : "lapsed");
    assert.deepEqual(dueActivityDescriptors(closed.state).filter(work => work.npcReaction !== undefined), []);
    assert.deepEqual(replayed(f, [...act.events, ...closed.events]), closed.state);
    assert.equal(f.runtime.step(f.profiles, closed.state, input).kind, "rejected", "a closed reaction cannot settle again");
  }
});

test("a reaction input must name the open reaction exactly", () => {
  const f = fixture("exact");
  const act = covertAct(f, 1);
  const [due] = dueActivityDescriptors(act.state).filter(work => work.npcReaction !== undefined);
  const base = { kind: "resolveNpcReaction", proposalId: due.childRootActionId, reactionId: due.npcReaction.reactionId,
    reactionHash: due.npcReaction.reactionHash, decision: { kind: "decline", reason: "无关。" } };
  for (const input of [{ ...base, reactionHash: `sha256:${"0".repeat(64)}` }, { ...base, proposalId: "npc-reaction-decision:other" },
    { ...base, decision: { kind: "decline", reason: "" } }, { ...base, decision: { kind: "shrug" } }]) {
    assert.equal(f.runtime.step(f.profiles, act.state, input).kind, "rejected", JSON.stringify(input));
  }
});

const toolResponse = (name, args) => ({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] });
const reactionWork = (state) => dueActivityDescriptors(state).filter(work => work.npcReaction !== undefined);

/** Varo calls out, heard by everyone present; a covert follow-up by Varo
 * would still open nothing further. */
function reactionBundle(basis, adjudication = { kind: "directSuccess", durationMicros: "0", risk: "对方可能恼火。", successOutcome: "瓦罗当众发问。" }) {
  const heard = (observerRef) => ({ observerRef, subjectRef: VARO, sense: "hearing", evidence: "瓦罗大声问：“你在阀门那儿干什么？”", basisRefs: [basis] });
  const branch = { outcomeCode: "outcome:called-out", summary: "瓦罗当众质问。", effects: [], sensoryEvidence: [heard(ACTOR), heard(LIAN)], pressures: [], opportunities: [] };
  return { mode: "adjudication", basisRefs: [basis], terminal: { kind: "none" }, adjudication,
    proposals: [{ basisRefs: [basis], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "当场质问。", method: "大声发问。", targetRefs: [ACTOR], directTargetRefs: [ACTOR], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: branch, failure: adjudication.kind === "directSuccess" ? { kind: "none" } : { ...branch, outcomeCode: "outcome:unheard" } } }] };
}

// SPEC 0006 §7: the call sees only the NPC's own projection and what it just
// perceived, and offers declining next to acting.
test("a reaction request is the NPC's own view of what it noticed, with declining offered beside acting", () => {
  const f = fixture("request");
  const act = covertAct(f, 1);
  const [due] = reactionWork(act.state);
  const request = prepareNpcReactionRequest(act.state, f.profiles, f.moduleProfile, due.childRootActionId, due.npcReaction);
  assert.ok(request);
  assert.equal(request.npcId, VARO);
  assert.equal(request.context.intent.text, "看见有人在阀门旁偷偷动手。");
  const input = npcReactionModelInput(request);
  assert.deepEqual(input.tools.map(tool => tool.function.name), ["decline_npc_reaction", "submit_kp_proposal_bundle"]);
  const defs = Object.values(input.tools[1].function.parameters.$def);
  assert.equal(defs.some(def => def.enum?.includes("5min")), false, "an on-the-spot reaction takes no time of its own");
  assert.equal(defs.filter(def => def.description?.startsWith("An on-the-spot reaction")).length, 1);
  const peerFact = Object.keys(act.state.knowledge[PEER]).find(ref => ref.startsWith("fact:concealment:"));
  assert.ok(peerFact);
  assert.doesNotMatch(JSON.stringify(input), new RegExp(peerFact), "another noticer's evidence stays out of Varo's view");
  assert.equal(prepareNpcReactionRequest(act.state, f.profiles, f.moduleProfile, "npc-reaction-decision:other", due.npcReaction), undefined);
  const declined = npcReactionRulesInput(toolResponse("decline_npc_reaction", { reason: "与我无关。" }), request, act.state, f.profiles);
  assert.deepEqual(declined.decision, { kind: "decline", reason: "与我无关。" });
  assert.throws(() => npcReactionRulesInput(toolResponse("decline_npc_reaction", { reason: " " }), request, act.state, f.profiles), /NPC_REACTION_INVALID/);
});

test("a reacting NPC acts through its own world interaction, and what others notice of it opens no new reaction", () => {
  // A covert follow-up hidden from the actor: Lian and the other player may
  // notice it, but no reaction opens inside a reaction.
  const covert = { kind: "check", durationMicros: "0", checkKind: "abilityCheck", ability: "dex", skill: "stealth", dc: null, mode: "normal",
    risk: "被发现。", successOutcome: "没人注意到瓦罗。", failureOutcome: "有人注意到瓦罗。",
    concealment: { primaryObserverRef: ACTOR, sense: "hearing", evidence: "听见瓦罗压低声音说话。", observers: [] } };
  for (const [name, adjudication] of [["open", undefined], ["covert", covert]]) {
    const f = fixture(`reacted:${name}`), act = covertAct(f, 1), [due] = reactionWork(act.state);
    const g = { f, act, request: prepareNpcReactionRequest(act.state, f.profiles, f.moduleProfile, due.childRootActionId, due.npcReaction) };
    const basis = `knowledge:${VARO}:${act.state.campaignRuntime.npcReactions[due.npcReaction.reactionId].factId}`;
    const rulesInput = npcReactionRulesInput(toolResponse("submit_kp_proposal_bundle", encodeVNextStrictToolBundle(reactionBundle(basis, adjudication))),
      g.request, g.act.state, g.f.profiles);
    assert.equal(rulesInput.command.actorCharacterId, VARO);
    let reacted = stepActionToDecision(g.f.runtime, g.f.profiles, g.act.state, rulesInput);
    if (reacted.kind === "awaitingRandomness") {
      const pendingEvents = reacted.events;
      const rolled = g.f.runtime.step(g.f.profiles, reacted.state, { kind: "fulfillAuthoritativeRandomness",
        continuation: JSON.parse(JSON.stringify(reacted.continuation)), rolls: [1] });
      reacted = { ...rolled, events: [...pendingEvents, ...rolled.events] };
    }
    assert.equal(reacted.kind, "committed", JSON.stringify(reacted));
    const settled = reacted.events.find(event => event.eventType === "NpcReactionSettled");
    assert.equal(settled.payload.outcome, "reacted");
    assert.equal(reacted.state.campaignRuntime.npcReactions[g.request.reactionId].status, "reacted");
    assert.ok(reacted.events.some(event => event.eventType === "SensoryEvidenceAcquired" && event.payload.characterId === ACTOR),
      "the actor learns of Varo's reaction by perceiving it");
    assert.deepEqual(reacted.events.filter(event => event.eventType === "NpcReactionOpened"), [], name);
    assert.deepEqual(reactionWork(reacted.state), []);
    assert.deepEqual(replayed(g.f, [...g.act.events, ...reacted.events]), reacted.state);
  }
});

// SPEC 0006 §7: leaving is one of the reactions an NPC may choose; its own
// move commits with the reaction and takes it out of the scene at once.
test("a noticing bystander may leave the scene as its on-the-spot reaction", () => {
  const YARD = "scene:reaction-yard";
  const f = createAuthoredProbeFixture("npc-reaction:leaves", { npcCharacters: [{ id: LIAN, name: "莉安" }, { id: VARO, name: "瓦罗" }],
    additionalScenes: [{ id: YARD, name: "后院", geometry: geometry() }] });
  const act = covertAct(f, 1);
  const [due] = reactionWork(act.state);
  assert.equal(due.ownerEntityId, VARO);
  const request = prepareNpcReactionRequest(act.state, f.profiles, f.moduleProfile, due.childRootActionId, due.npcReaction);
  assert.ok(JSON.stringify(npcReactionModelInput(request).tools[1]).includes("moveNpc"), "the reaction offers the move");
  const basis = `knowledge:${VARO}:${act.state.campaignRuntime.npcReactions[due.npcReaction.reactionId].factId}`;
  const leave = { mode: "adjudication", basisRefs: [basis], terminal: { kind: "none" },
    adjudication: { kind: "directSuccess", durationMicros: "0", risk: "没有风险。", successOutcome: "瓦罗出去了。" },
    proposals: [{ basisRefs: [basis], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "不想搅进去，去后院。", method: "起身从后门出去。", targetRefs: [YARD], directTargetRefs: [YARD], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: { outcomeCode: "outcome:left", summary: "瓦罗出去了。",
        effects: [{ kind: "moveNpc", destination: { kind: "scene", sceneRef: YARD, travel: "none" } }],
        sensoryEvidence: [{ observerRef: ACTOR, subjectRef: VARO, sense: "sight", evidence: "瓦罗起身从后门出去了。", basisRefs: [basis] }],
        pressures: [], opportunities: [] }, failure: { kind: "none" } } }] };
  const rulesInput = npcReactionRulesInput(toolResponse("submit_kp_proposal_bundle", encodeVNextStrictToolBundle(leave)), request, act.state, f.profiles);
  const reacted = f.runtime.step(f.profiles, act.state, rulesInput);
  assert.equal(reacted.kind, "committed", JSON.stringify(reacted));
  const types = reacted.events.map(event => event.eventType);
  assert.ok(types.includes("CharacterMoved") && types.includes("NpcReactionSettled"), types.join(" "));
  assert.equal(reacted.state.entities[VARO].sceneId, YARD);
  assert.equal(reacted.state.campaignRuntime.npcReactions[due.npcReaction.reactionId].status, "reacted");
  assert.deepEqual(reactionWork(reacted.state), []);
  assert.ok(reacted.events.some(event => event.eventType === "SensoryEvidenceAcquired" && event.payload.characterId === ACTOR), "the actor sees him go");
  assert.deepEqual(replayed(f, [...act.events, ...reacted.events]), reacted.state);
});
