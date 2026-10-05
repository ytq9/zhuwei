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
import { canonicalSha256 } from "../../../app/_runtime/lib/rules/profiles/canonical.ts";
import { authoritativeNpcDecisionContext } from "../../../app/_runtime/lib/rules/v2/npc-decision-context.ts";
import { authorityRevisionOrHash } from "../../../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { socialThreadRef, socialListeners, socialClaimRef, heardConversationCandidates } from "../../../app/_runtime/lib/rules/v2/social-interaction.ts";

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
// reaction; player characters are never compared (SPEC 0005 §6.2).
test("a noticing bystander NPC gets one open reaction; the primary does not, and players are not compared", () => {
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
  const refs = request.context.entries.map(entry => entry.entryRef);
  assert.ok(refs.some(ref => ref.startsWith(`knowledge:${VARO}:fact:concealment:`)), "Varo's own evidence is in his view");
  assert.deepEqual(refs.filter(ref => ref.startsWith("knowledge:") && !ref.startsWith(`knowledge:${VARO}:`)), [], "no one else's knowledge is");
  assert.equal(Object.keys(act.state.knowledge[PEER] ?? {}).some(ref => ref.startsWith("fact:concealment:")), false,
    "the other player is not compared and gets no evidence (SPEC 0005 §6.2)");
  assert.equal(prepareNpcReactionRequest(act.state, f.profiles, f.moduleProfile, "npc-reaction-decision:other", due.npcReaction), undefined);
  const declined = npcReactionRulesInput(toolResponse("decline_npc_reaction", { reason: "与我无关。" }), request, act.state, f.profiles);
  assert.deepEqual(declined.decision, { kind: "decline", reason: "与我无关。" });
  assert.throws(() => npcReactionRulesInput(toolResponse("decline_npc_reaction", { reason: " " }), request, act.state, f.profiles), /NPC_REACTION_INVALID/);
});

test("a reacting NPC acts through its own world interaction, and what others notice of it opens no new reaction", () => {
  // A covert follow-up hidden from Lian (a player cannot be the primary
  // observer: players are not compared): whoever notices it gets evidence,
  // but no reaction opens inside a reaction.
  const covert = { kind: "check", durationMicros: "0", checkKind: "abilityCheck", ability: "dex", skill: "stealth", dc: null, mode: "normal",
    risk: "被发现。", successOutcome: "没人注意到瓦罗。", failureOutcome: "有人注意到瓦罗。",
    concealment: { primaryObserverRef: LIAN, sense: "hearing", evidence: "听见瓦罗压低声音说话。", observers: [] } };
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

// SPEC 0006 §7 (ADR 0110): NPC bystanders who hear a conversation may
// interject, at most two per conversation step. Ailin asks the guard; Arlo,
// Bea and Cato only listen.
const GUARD = "npc:heard-guard", ARLO = "npc:heard-arlo", BEA = "npc:heard-bea", CATO = "npc:heard-cato";
function heardFixture(name) {
  return createAuthoredProbeFixture(`npc-reaction:heard:${name}`, { characterOverrides: { [ACTOR]: { name: "艾琳" } },
    npcCharacters: [{ id: GUARD, name: "守门人" }, { id: ARLO, name: "阿洛" }, { id: BEA, name: "贝雅" }, { id: CATO, name: "卡托 / 老卡" }] });
}

/** Ailin asks the guard aloud; a null `reply` is the guard staying silent. */
function conversationInput(f, state, root, { audience = "sceneListeners", expression = "门今晚什么时候关？", reply = "天黑就关。" } = {}) {
  const context = authoritativeNpcDecisionContext(state, f.profiles, GUARD);
  assert.ok(context);
  const resolutionId = `resolution:${root}`, basis = [{ kind: "npcContext", ref: GUARD }];
  const response = reply === null ? { kind: "silence", text: "", motive: "不想回答。", basis } : { kind: "speech", text: reply, motive: "照实回答。", basis };
  const branch = { outcomeCode: "outcome:answered", summary: "守门人作了回应。", response, consequences: [] };
  const social = { schema: "zhuwei.social-interaction/vnext-1", npcRef: GUARD, threadRef: socialThreadRef(root, resolutionId), addressedThreadRef: null,
    playerExpression: expression, goal: "问清关门时间。", communication: "spokenConversation", audience,
    listeners: socialListeners(state, ACTOR, GUARD, audience), npcContext: context, retryChange: null,
    branches: { success: branch, failure: structuredClone(branch) } };
  const readRefs = [...new Set([ACTOR, `character-timeline:${ACTOR}`, ...context.records.map(record => record.ref),
    ...context.knowledge.map(record => record.entryRef)])].sort();
  const outcome = { outcomeCode: branch.outcomeCode, summary: branch.summary, effects: [], sensoryEvidence: [], pressures: [], opportunities: [] };
  return { kind: "resolveWorldInteraction", rootActionId: root, actorCharacterId: ACTOR,
    plan: { schema: "zhuwei.world-interaction-resolution-plan/v1", resolutionId, interactionRef: `interaction:${root}`, actorCharacterId: ACTOR,
      sceneRef: SCENE, abilityRef: null, contextHash: canonicalSha256({ root }),
      readSet: readRefs.map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(state, ref) })),
      targetRefs: [GUARD], directTargetRefs: [GUARD], instrumentRefs: [], basisRefs: [GUARD], intent: expression, method: "当众发问。",
      ruling: { kind: "directSuccess" }, costs: [], social, branches: { success: outcome, failure: structuredClone(outcome) } } };
}

function converse(f, state, root, options) {
  const result = stepActionToDecision(f.runtime, f.profiles, state, conversationInput(f, state, root, options));
  assert.equal(result.kind, "committed", JSON.stringify({ kind: result.kind, rejection: result.rejection, code: result.code, issues: result.issues }));
  return result;
}
const openedFor = (events) => events.filter(event => event.eventType === "NpcReactionOpened").map(event => event.payload.characterId);

test("of three bystanders who hear a conversation two react: one named in the words, then one whose own record names a speaker", () => {
  const f = heardFixture("chosen");
  // Bea's own relationship names Ailin; no record ties Arlo or Cato to either speaker.
  const tie = f.runtime.step(f.profiles, f.state, { kind: "changeRelationship", proposalId: "root:heard-tie",
    relationshipId: "relationship:bea-and-ailin", subjectIds: [ACTOR, BEA], change: "贝雅认得艾琳。", basisFactIds: [] });
  assert.equal(tie.kind, "committed", JSON.stringify(tie.rejection));
  const root = "root:heard-chosen";
  // Cato is named only by the part of his name after " / ".
  const result = converse(f, tie.state, root, { expression: "老卡说门天黑就关，是这样吗？" });
  const opened = result.events.filter(event => event.eventType === "NpcReactionOpened");
  assert.deepEqual(opened.map(event => event.payload.characterId), [CATO, BEA], "Arlo, first by ordinal, is left out; the guard and Ailin get none");
  for (const event of opened) {
    assert.equal(event.payload.trigger, "heardConversation");
    assert.equal(event.payload.factId, socialClaimRef(root, `resolution:${root}`, "success", "actor"), "each reacts to the words it heard");
    assert.equal(event.visibilityPolicyId, `visibility:knowledge-holder:${event.payload.characterId}`);
    assert.equal(event.secrecy, "private");
    assert.equal(result.state.campaignRuntime.npcReactions[event.payload.reactionId].trigger, "heardConversation");
  }
  assert.deepEqual(result.events.slice(-3).map(event => event.eventType), ["NpcReactionOpened", "NpcReactionOpened", "WorldInteractionResolved"]);
  assert.deepEqual(reactionWork(result.state).map(work => work.ownerEntityId).sort(), [BEA, CATO].sort());
  // Replay runs the conversation's settlement fold, which rebuilds the openings.
  assert.deepEqual(replayed(f, [...tie.events, ...result.events]), result.state);
  const forged = structuredClone(result.events);
  forged.find(event => event.eventType === "NpcReactionOpened").payload.trigger = "noticedAct";
  assert.equal(f.runtime.replay(f.genesis, [...tie.events, ...forged]).kind, "rejected", "an unknown trigger does not replay");
});

test("names in the addressee's reply count too, and without names or ties the first by ordinal react", () => {
  for (const [name, reply, expected] of [["reply-names", "卡托知道得更清楚。", [CATO, ARLO]], ["no-names", "天黑就关。", [ARLO, BEA]],
    ["silence", null, [ARLO, BEA]]]) {
    const f = heardFixture(name), result = converse(f, f.state, `root:heard-${name}`, { reply });
    assert.deepEqual(openedFor(result.events), expected, name);
    assert.deepEqual(replayed(f, result.events), result.state, name);
  }
});

test("a conversation only its participants hear opens none; a bystander in an encounter or an Activity, or a reaction's own root, opens none", () => {
  const f = heardFixture("private");
  assert.deepEqual(openedFor(converse(f, f.state, "root:heard-private", { audience: "participants", expression: "卡托和阿洛都在吗？" }).events), []);
  const plan = conversationInput(f, f.state, "root:heard-busy").plan;
  assert.deepEqual(heardConversationCandidates(f.state, "root:heard-busy", plan, "success"), [ARLO, BEA, CATO]);
  // Arlo fights and Bea carries out an Activity: neither can act now (npcMayReact).
  const busy = structuredClone(f.state);
  busy.combatRuntime.encounters["encounter:heard-busy"] = { status: "active", participantEntityIds: [ARLO] };
  busy.campaignRuntime.activities["activity:heard-busy"] = { characterId: BEA, status: "active" };
  assert.deepEqual(heardConversationCandidates(busy, "root:heard-busy", plan, "success"), [CATO]);
  // An NPC whose reaction this action opened is not offered a second one, and
  // within a reaction's own root no conversation opens any.
  const g = fixture("heard-in-reaction"), act = covertAct(g, 1), [due] = reactionWork(act.state);
  const inner = { ...plan, social: { ...plan.social, listeners: [ACTOR, LIAN, VARO, PEER].sort(), npcRef: LIAN } };
  const sourceRoot = act.state.campaignRuntime.npcReactions[due.npcReaction.reactionId].sourceRootActionId;
  assert.deepEqual(heardConversationCandidates(act.state, sourceRoot, inner, "success"), [], "Varo's reaction from this action is still open");
  assert.deepEqual(heardConversationCandidates(act.state, "root:heard-later", inner, "success"), [VARO], "a later action may open one");
  assert.deepEqual(heardConversationCandidates(act.state, due.childRootActionId, inner, "success"), [], "a reaction root opens none");
});

test("a heard reaction's request holds both lines with their speakers and its own instruction; a noticed act's request is as before", () => {
  for (const [name, reply, second] of [["reply", "天黑就关。", "守门人回答：“天黑就关。”"], ["silence", null, "守门人没有回答。"]]) {
    const f = heardFixture(`request-${name}`), result = converse(f, f.state, `root:heard-request-${name}`, { reply });
    const due = reactionWork(result.state).find(work => work.ownerEntityId === ARLO);
    const request = prepareNpcReactionRequest(result.state, f.profiles, f.moduleProfile, due.childRootActionId, due.npcReaction);
    assert.ok(request, name);
    assert.equal(request.trigger, "heardConversation");
    assert.equal(request.context.intent.text, `本人在场听到艾琳对守门人说：“门今晚什么时候关？”\n${second}`);
    const refs = request.context.entries.map(entry => entry.entryRef);
    assert.deepEqual(refs.filter(ref => ref.startsWith("knowledge:") && !ref.startsWith(`knowledge:${ARLO}:`)), [], "no one else's knowledge");
    const sent = JSON.stringify(npcReactionModelInput(request).messages);
    assert.match(sent, /本人在场听到的一段交谈，说话的两人知道本人在场/);
    assert.doesNotMatch(sent, /做这件事的人不知道本人察觉了/);
  }
  const g = fixture("request-noticed"), act = covertAct(g, 1), [due] = reactionWork(act.state);
  const request = prepareNpcReactionRequest(act.state, g.profiles, g.moduleProfile, due.childRootActionId, due.npcReaction);
  assert.equal(Object.hasOwn(request, "trigger"), false);
  assert.equal(request.context.intent.text, "看见有人在阀门旁偷偷动手。");
  const sent = JSON.stringify(npcReactionModelInput(request).messages);
  assert.match(sent, /requiredContext.intent是本人刚察觉的情况，做这件事的人不知道本人察觉了/);
  assert.doesNotMatch(sent, /本人在场听到的一段交谈/);
});

test("a bystander interjects through its own world interaction: its words are heard by those present and close its reaction", () => {
  const f = heardFixture("interjects"), root = "root:heard-interjects", heard = converse(f, f.state, root);
  const due = reactionWork(heard.state).find(work => work.ownerEntityId === ARLO);
  const request = prepareNpcReactionRequest(heard.state, f.profiles, f.moduleProfile, due.childRootActionId, due.npcReaction);
  const basis = `knowledge:${ARLO}:${socialClaimRef(root, `resolution:${root}`, "success", "actor")}`;
  const words = "阿洛插话：“昨晚天没黑就关了。”";
  const hears = (observerRef) => ({ observerRef, subjectRef: ARLO, sense: "hearing", evidence: words, basisRefs: [basis] });
  const bundle = { mode: "adjudication", basisRefs: [basis], terminal: { kind: "none" },
    adjudication: { kind: "directSuccess", durationMicros: "0", risk: "守门人可能不高兴。", successOutcome: "阿洛插了一句。" },
    proposals: [{ basisRefs: [basis], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "补一句实情。", method: "插话。", targetRefs: [ACTOR], directTargetRefs: [ACTOR], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: { outcomeCode: "outcome:interjected", summary: "阿洛插话。", effects: [],
        sensoryEvidence: [hears(ACTOR), hears(GUARD)], pressures: [], opportunities: [] }, failure: { kind: "none" } } }] };
  const rulesInput = npcReactionRulesInput(toolResponse("submit_kp_proposal_bundle", encodeVNextStrictToolBundle(bundle)), request, heard.state, f.profiles);
  const reacted = f.runtime.step(f.profiles, heard.state, rulesInput);
  assert.equal(reacted.kind, "committed", JSON.stringify(reacted.rejection ?? reacted.kind));
  assert.equal(reacted.events.find(event => event.eventType === "NpcReactionSettled").payload.outcome, "reacted");
  for (const listener of [ACTOR, GUARD]) assert.ok(reacted.events.some(event => event.eventType === "SensoryEvidenceAcquired"
    && event.payload.characterId === listener && event.payload.publicEvidence === words), listener);
  assert.deepEqual(openedFor(reacted.events), [], "an interjection opens no reaction");
  assert.deepEqual(reactionWork(reacted.state).map(work => work.ownerEntityId), [BEA], "Bea still decides for herself");
  assert.deepEqual(replayed(f, [...heard.events, ...reacted.events]), reacted.state);
});
