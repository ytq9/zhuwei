import assert from "node:assert/strict";
import test from "node:test";
import { worldFactSocialBundle } from "./fixtures/vnext-world-facts.mjs";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { authoritativeNpcDecisionContext } from "../app/_runtime/lib/rules/v2/npc-decision-context.ts";
import { worldFactConstraints, worldFactConstraintsRef } from "../app/_runtime/lib/rules/v2/world-facts.ts";
import { authorityRevisionOrHash } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { createEventTransition } from "../app/_runtime/lib/rules/v2/events.ts";
import { createDefinitionSnapshot } from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";
const NPC = "npc:new-history", SECOND = "npc:second-witness", UNINVOLVED = "npc:uninvolved";
const diagnostic = r => JSON.stringify({ kind: r.kind, code: r.code, issues: r.issues, rejection: r.rejection });
function fixture(label, options = {}) {
  const f = createAuthoredProbeFixture(`world-fact:${label}`, { npcCharacters: [NPC, SECOND, UNINVOLVED].map(id => ({ id, name: id })), ...options });
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [NPC, SECOND], intentText: "请谈谈你的过往。" }).context;
  return f;
}
function lower(f, wire, state = f.state) {
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(wire)));
  if (parsed.kind !== "accepted") return parsed;
  return lowerVNext2ProposalBundle({ ...f, state, value: parsed.bundle });
}
function project(f, r, viewer, events = r.events) {
  const projected = f.runtime.project(f.profiles, r.state, viewer, { channel: "realtime", committedRange: {
    receiptId: r.receipt.receiptId, actorCharacterId: ACTOR, priorState: f.state, events } });
  assert.equal(projected.kind, "projected", diagnostic(projected)); return projected;
}
const npcViewer = npcId => ({ kind: "npc", npcId, purpose: "kpDecision", capability: "internal:npc-limited-knowledge" });

for (const variant of ["childhood", "heard-rumor"]) test(`new ${variant} freezes truth, holder memory, attributed speech and replay through one bundle`, () => {
  const f = fixture(variant);
  const options = variant === "heard-rumor" ? { description: "两位守门人昨日在酒馆听见一个搬运工说信使走了南门。",
    occurrence: "昨日傍晚。", response: "我在酒馆听搬运工说，他走了南门。", holders: [NPC, SECOND] } : {};
  const wire = worldFactSocialBundle({ sceneRef: SCENE, npcRef: NPC, ...options });
  const lowered = lower(f, wire);
  assert.equal(lowered.kind, "accepted", diagnostic(lowered));
  const r = f.runtime.step(f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(r.kind, "committed", diagnostic(r));
  const facts = Object.values(r.state.canonicalFacts).filter(fact => fact.source === "dynamicMaterialization");
  assert.equal(facts.length, 1); const fact = facts[0];
  assert.deepEqual(Object.keys(fact.value).sort(), ["definitionHash", "definitionRef", "definitionRevision", "schema"]);
  const definition = r.state.campaignRuntime.definitions[fact.value.definitionRef];
  assert.equal(definition.content.description, wire.proposals[0].definition.description);
  assert.deepEqual(r.state.knowledge[NPC][fact.id].content, fact.value);
  assert.equal(r.state.knowledge[ACTOR]?.[fact.id], undefined, "hearing speech does not grant hidden truth");
  const player = project(f, r, f.viewer);
  assert.doesNotMatch(JSON.stringify(player), /PRIVATE-FACT-MOTIVE|PRIVATE-ACQUISITION/);
  assert.ok(Object.values(r.state.knowledge[ACTOR]).every(k => k.objectKind === "sourceClaim"));
  assert.ok(player.sourceClaims.some(claim => claim.speakerId === NPC));
  assert.doesNotMatch(JSON.stringify(project(f, r, npcViewer(UNINVOLVED))), /一段旧经历|祖父|搬运工/);
  const memory = authoritativeNpcDecisionContext(r.state, f.profiles, NPC);
  assert.ok(memory.records.some(record => record.kind === "fact" && record.value.value.description === definition.content.description));
  const replay = f.runtime.replay(f.genesis, r.events);
  assert.equal(replay.kind, "replayed", diagnostic(replay)); assert.deepEqual(replay.state, r.state);
  const next = freezeAuthoredProbeContext(f, r.state, { focusRefs: [NPC], intentText: "你刚才讲到的那段经历呢？" });
  assert.ok(JSON.stringify(next.context).includes(definition.content.description));
});

test("both roll branches freeze the same history and pending randomness publishes none of it", () => {
  const f = fixture("branches"), wire = worldFactSocialBundle({ sceneRef: SCENE, npcRef: NPC, check: true });
  const lowered = lower(f, wire); assert.equal(lowered.kind, "accepted", diagnostic(lowered));
  const pending = f.runtime.step(f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(pending.kind, "awaitingRandomness", diagnostic(pending));
  assert.deepEqual(pending.state.canonicalFacts, f.state.canonicalFacts);
  assert.deepEqual(pending.state.knowledge, f.state.knowledge);
  const results = [1, 20].map(roll => {
    const r = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness", continuation: pending.continuation, rolls: [roll] });
    assert.equal(r.kind, "committed", diagnostic(r));
    const replay = f.runtime.replay(f.genesis, [...pending.events, ...r.events]);
    assert.equal(replay.kind, "replayed", diagnostic(replay)); assert.deepEqual(replay.state, r.state);
    project(f, r, f.viewer, [...pending.events, ...r.events]); return r;
  });
  assert.deepEqual(results[0].state.canonicalFacts, results[1].state.canonicalFacts);
  const factId = Object.keys(results[0].state.canonicalFacts).find(ref => ref.startsWith("fact:definition:materialized:"));
  assert.deepEqual(results[0].state.knowledge[NPC][factId], results[1].state.knowledge[NPC][factId]);
});

test("conflict, unapproved holder and conditional or undeclared knowledge producers reject before any roll", () => {
  for (const mutate of [
    wire => { wire.proposals[0].definition.worldFact.consistency.judgment = "conflict"; },
    wire => { wire.proposals[0].definition.worldFact.initialKnowledge[0].acquisitionBasisRefs = [ACTOR]; },
    wire => { wire.proposals[0].outcomeBinding = "onSuccess"; wire.proposals[0].produces[0].outcomeBinding = "onSuccess"; },
    wire => { wire.proposals[0].definition.worldFact.initialKnowledge[0].holderRef = SECOND; },
    wire => { wire.proposals[0].definition.worldFact.initialKnowledge = []; },
  ]) {
    const f = fixture("reject"), wire = worldFactSocialBundle({ sceneRef: SCENE, npcRef: NPC, check: true }); mutate(wire);
    const lowered = lower(f, wire);
    const result = lowered.kind === "accepted" ? f.runtime.step(f.profiles, f.state, lowered.command.rulesInput) : lowered;
    assert.ok(["rejected", "locallyRejected"].includes(result.kind), diagnostic(result)); assert.equal(result.randomnessRequest, undefined);
  }
});

test("a new related fact after prepare changes the constraint membership and invalidates old creation", () => {
  const f = fixture("membership"), wire = worldFactSocialBundle({ sceneRef: SCENE, npcRef: NPC });
  const before = authorityRevisionOrHash(f.state, worldFactConstraintsRef(SCENE));
  const state = structuredClone(f.state);
  state.canonicalFacts["fact:new-anchor"] = { id: "fact:new-anchor", kind: "worldFact", subjectRefs: [NPC], value: "她从未见过祖父。",
    visibilityPolicyId: "visibility:room-authority-only", source: "moduleAnchor", branchId: state.activeBranchId, validFromEventSeq: "1", causalParentIds: [] };
  assert.notEqual(authorityRevisionOrHash(state, worldFactConstraintsRef(SCENE)), before);
  assert.equal(lower(f, wire, state).kind, "rejected");
  const lowered = lower(f, wire); assert.equal(lowered.kind, "accepted", diagnostic(lowered));
  assert.equal(f.runtime.step(f.profiles, state, lowered.command.rulesInput).kind, "rejected");
});

test("creation constraints retain ancestor facts and reject missing parents or changed continuity membership", () => {
  const fact = (id, subjectRefs, value) => ({ id, kind: "worldFact", subjectRefs, value,
    source: "moduleAnchor", visibilityPolicyId: "visibility:room-authority-only" });
  const f = fixture("parent-continuity", { canonicalFacts: [
    fact("fact:local-history", [NPC], "她幼年在港口生活。"),
    fact("fact:parent-history", ["place:old-harbor"], "旧港在洪灾后重建。"),
    fact("fact:ancestor-history", ["region:remote"], "洪灾发生在二十年前。"),
  ] });
  f.state.canonicalFacts["fact:local-history"].causalParentIds = ["fact:parent-history"];
  f.state.canonicalFacts["fact:parent-history"].causalParentIds = ["fact:ancestor-history"];
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [NPC], intentText: "请谈谈你的过往。" }).context;
  const frame = worldFactConstraints(f.state, SCENE);
  assert.ok(frame.facts.some(record => record.id === "fact:ancestor-history"));
  const wire = worldFactSocialBundle({ sceneRef: SCENE, npcRef: NPC });
  assert.equal(lower(f, wire).kind, "accepted");
  const changed = structuredClone(f.state);
  changed.canonicalFacts["fact:ancestor-history"].value = "洪灾发生在一百年前。";
  assert.equal(lower(f, wire, changed).kind, "rejected", "distant ancestor changes invalidate creation");
  const missing = structuredClone(f.state);
  delete missing.canonicalFacts["fact:ancestor-history"];
  assert.deepEqual(worldFactConstraints(missing, SCENE).missingParentRefs, ["fact:ancestor-history"]);
  assert.equal(lower(f, wire, missing).kind, "rejected");
  const continuity = structuredClone(f.state);
  continuity.campaignRuntime.promises["promise:new-history-constraint"] = { id: "promise:new-history-constraint",
    promisorId: NPC, promiseeId: SECOND, description: "答应陪伴对方寻找亲人。", status: "open" };
  assert.ok(worldFactConstraints(continuity, SCENE).continuity.some(record => record.ref === "continuity:promises:promise:new-history-constraint"));
  assert.equal(lower(f, wire, continuity).kind, "rejected", "new relevant continuity invalidates the frozen review");
});

test("partial sensory evidence of a new hidden fact reveals only the actual evidence", () => {
  const f = fixture("partial-evidence"), wire = worldFactSocialBundle({ sceneRef: SCENE, npcRef: NPC, description: "HIDDEN-TRUTH-CANARY" });
  wire.proposals = wire.proposals.slice(0, 1);
  const l = lower(f, wire); assert.equal(l.kind, "accepted", diagnostic(l));
  const r = f.runtime.step(f.profiles, f.state, l.command.rulesInput); assert.equal(r.kind, "committed", diagnostic(r));
  const factId = Object.keys(r.state.canonicalFacts).find(ref => ref.startsWith("fact:definition:materialized:"));
  const observed = f.runtime.step(f.profiles, r.state, { kind: "acquireSensoryEvidence", proposalId: `${f.rootActionId}:observe`,
    characterId: ACTOR, factId, sense: "sight", clarity: "partial", publicEvidence: "只看到模糊的痕迹。" });
  assert.equal(observed.kind, "committed", diagnostic(observed));
  const player = f.runtime.project(f.profiles, observed.state, f.viewer);
  assert.equal(player.kind, "projected", diagnostic(player));
  assert.match(JSON.stringify(player), /只看到模糊的痕迹/);
  assert.doesNotMatch(JSON.stringify(player), /HIDDEN-TRUTH-CANARY/);
});

test("multiple unconditional histories extend one NPC snapshot only with their declared memories", () => {
  const f = fixture("multiple"), wire = worldFactSocialBundle({ sceneRef: SCENE, npcRef: NPC, check: true });
  const second = structuredClone(wire.proposals[0]); second.produces[0].handle = "prospective:second-experience";
  second.definition.description = "她少年时学习辨认天气。";
  const social = wire.proposals[1]; social.consumes.push({ kind: "prospective", handle: second.produces[0].handle });
  for (const branch of Object.values(social.branches)) branch.response.basis.push({ kind: "materializedKnowledge", definitionRef: second.produces[0].handle, holderRef: NPC });
  wire.proposals.splice(1, 0, second);
  const l = lower(f, wire); assert.equal(l.kind, "accepted", diagnostic(l));
  const pending = f.runtime.step(f.profiles, f.state, l.command.rulesInput);
  assert.equal(pending.kind, "awaitingRandomness", diagnostic(pending));
  const r = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness", continuation: pending.continuation, rolls: [20] });
  assert.equal(r.kind, "committed", diagnostic(r));
  assert.equal(Object.values(r.state.knowledge[NPC]).filter(k => k.objectKind === "canonicalFact").length, 2);
  const replay = f.runtime.replay(f.genesis, [...pending.events, ...r.events]);
  assert.equal(replay.kind, "replayed", diagnostic(replay)); assert.deepEqual(replay.state, r.state);
});

test("all explicit content dependencies obey holder permissions and KP cannot author a player's past choices", () => {
  const secretRef = "fact:foreign-secret";
  const f = fixture("foreign-source", {
    canonicalFacts: [{ id: secretRef, kind: "worldFact", subjectRefs: [SECOND], value: "外来秘密。", source: "moduleAnchor", visibilityPolicyId: "visibility:room-authority-only" }],
    initialKnowledge: [{ characterId: SECOND, knowledgeRef: secretRef, kind: "canonicalFact", layer: "full", content: "外来秘密。", visibility: "private", provenanceChain: [secretRef] }],
  });
  for (const field of ["basisRefs", "consumes", "playerSubject"]) {
    const wire = worldFactSocialBundle({ sceneRef: SCENE, npcRef: NPC });
    if (field === "basisRefs") wire.proposals[0].basisRefs = [`knowledge:${SECOND}:${secretRef}`];
    if (field === "consumes") wire.proposals[0].consumes = [{ kind: "existing", ref: `knowledge:${SECOND}:${secretRef}` }];
    if (field === "playerSubject") { wire.proposals[0].definition.worldFact.subjectRefs.push(ACTOR); wire.proposals[0].definition.description = "玩家过去自愿宣誓效忠。"; }
    assert.equal(lower(f, wire).kind, "rejected", field);
  }
});

test("a newly signed result suffix cannot replace the producer history frozen before the dice", () => {
  const f = fixture("forged-history"), l = lower(f, worldFactSocialBundle({ sceneRef: SCENE, npcRef: NPC, check: true }));
  assert.equal(l.kind, "accepted", diagnostic(l));
  const pending = f.runtime.step(f.profiles, f.state, l.command.rulesInput);
  assert.equal(pending.kind, "awaitingRandomness", diagnostic(pending));
  const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness", continuation: pending.continuation, rolls: [20] });
  assert.equal(result.kind, "committed", diagnostic(result));
  const index = result.events.findIndex(event => event.eventType === "SemanticDefinitionMaterialized");
  const event = result.events[index], payload = structuredClone(event.payload);
  payload.definition.content.description = "祖父从未教过她补渔网。";
  payload.definition.definitionHash = createDefinitionSnapshot(payload.definitionRef, "1", payload.definition.content).definitionHash;
  const before = f.runtime.replay(f.genesis, [...pending.events, ...result.events.slice(0, index)]);
  assert.equal(before.kind, "replayed", diagnostic(before));
  assert.throws(() => createEventTransition(before.state, f.profiles, { rootActionId: event.rootActionId,
    resolutionId: event.resolutionId, eventType: event.eventType, payload, scopeProof: result.scopeProof,
    visibilityPolicyId: event.visibilityPolicyId, secrecy: event.secrecy }), /world-fact:frozen-producer-changed/);
});

test("a late history must finish before the atomic marker releases the frozen plan", () => {
  const f = fixture("late-history"), wire = worldFactSocialBundle({ sceneRef: SCENE, npcRef: NPC, check: true });
  const [history, social] = wire.proposals;
  social.consumes = [];
  for (const branch of Object.values(social.branches)) {
    branch.response.text = "我今天在这里值守。";
    branch.response.basis = [{ kind: "npcContext", ref: NPC }];
  }
  wire.proposals = [social, history];
  const l = lower(f, wire); assert.equal(l.kind, "accepted", diagnostic(l));
  const pending = f.runtime.step(f.profiles, f.state, l.command.rulesInput);
  assert.equal(pending.kind, "awaitingRandomness", diagnostic(pending));
  const r = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness", continuation: pending.continuation, rolls: [20] });
  assert.equal(r.kind, "committed", diagnostic(r));
  const index = r.events.findIndex(event => event.eventType === "SemanticDefinitionMaterialized");
  assert.ok(index > r.events.findIndex(event => event.eventType === "WorldInteractionResolved"));
  const marker = r.events.find(event => event.eventType === "AtomicWorldInteractionStepsResolved");
  const transition = state => createEventTransition(state, f.profiles, { rootActionId: marker.rootActionId,
    resolutionId: marker.resolutionId, eventType: marker.eventType, payload: marker.payload,
    scopeProof: r.scopeProof, visibilityPolicyId: marker.visibilityPolicyId, secrecy: marker.secrecy });
  for (let count = 0; count < 3; count++) {
    const before = f.runtime.replay(f.genesis, [...pending.events, ...r.events.slice(0, index + count)]);
    assert.equal(before.kind, "replayed", diagnostic(before));
    assert.throws(() => transition(before.state), /world-fact:frozen-producer-incomplete/,
      "definition, fact and initial knowledge must all be committed before completion");
  }
  const replay = f.runtime.replay(f.genesis, [...pending.events, ...r.events]);
  assert.equal(replay.kind, "replayed", diagnostic(replay)); assert.deepEqual(replay.state, r.state);
  assert.throws(() => transition(r.state), /bundle is already settled/);
});

test("same definition under a different producer context cannot prove a frozen social prefix", () => {
  const f = fixture("producer-context"), wire = worldFactSocialBundle({ sceneRef: SCENE, npcRef: NPC, check: true });
  const lowered = lower(f, wire); assert.equal(lowered.kind, "accepted", diagnostic(lowered));
  const pending = f.runtime.step(f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(pending.kind, "awaitingRandomness", diagnostic(pending));
  const done = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness", continuation: pending.continuation, rolls: [20] });
  assert.equal(done.kind, "committed", diagnostic(done));
  let state = pending.state, reachedSettlement = false, changedProducer = false;
  const ids = new Map();
  const remap = value => typeof value === 'string' ? ids.get(value) ?? value
    : Array.isArray(value) ? value.map(remap) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remap(child)])) : value;
  for (const event of done.events) {
    const payload = remap(event.payload);
    if (event.eventType === 'SemanticDefinitionMaterialized') {
      payload.contextHash = 'sha256:' + 'f'.repeat(64); changedProducer = true;
    }
    const input = { rootActionId: event.rootActionId, resolutionId: event.resolutionId, eventType: event.eventType,
      payload, scopeProof: done.scopeProof, visibilityPolicyId: event.visibilityPolicyId, secrecy: event.secrecy };
    if (event.eventType === 'WorldInteractionResolved' && payload.social) {
      reachedSettlement = true;
      assert.throws(() => createEventTransition(state, f.profiles, input), /social:accepted-cost-prefix-not-proven/);
      break;
    }
    const next = createEventTransition(state, f.profiles, input);
    ids.set(event.eventId, next.event.eventId); state = next.state;
  }
  assert.equal(changedProducer, true); assert.equal(reachedSettlement, true);
});
