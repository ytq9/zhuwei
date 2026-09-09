import { committedActionRange } from './fixtures/vnext-action-lifecycle.mjs';
import { atomicCompletionInput } from './fixtures/vnext-action-duration.mjs';
import { stepActionToDecision } from './fixtures/vnext-action-lifecycle.mjs';
import { soleStep, soleFormId } from './fixtures/vnext-action-duration.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_TARGET as OTHER, PROBE_SCENE as SCENE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import { authoritativeNpcDecisionContext } from "../app/_runtime/lib/rules/v2/npc-decision-context.ts";
import { authorityRevisionOrHash } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { socialThreadRef, socialListeners } from "../app/_runtime/lib/rules/v2/social-interaction.ts";
import { eventHash, validateEventEnvelope, createEventTransition } from "../app/_runtime/lib/rules/v2/events.ts";
import { parseSubmitKpProposalBundleCandidateArguments } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { encodeVNextStrictToolBundle, SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { deepSeekStrictToolSchemaIssues } from "../app/_runtime/lib/kp/deepseek-strict-tool.ts";
import { sharedCheckBundle } from "./fixtures/vnext-shared-check.mjs";
import { itemBundle } from "./fixtures/vnext-authored-bundles.mjs";

const diagnostic = value => JSON.stringify({ kind: value.kind, rejection: value.rejection, code: value.code, issues: value.issues });
const NPC = "npc:social-guard", KNOWLEDGE = "knowledge:message";
const RESPONSE = "我亲眼见到信使从北门离开。";
const SECRET = "PLAYER-HIDDEN-GOAL-CANARY";
const npcViewer = { kind: "npc", npcId: NPC, purpose: "kpDecision", capability: "internal:npc-limited-knowledge" };
const otherViewer = { kind: "player", principalId: "principal:probe-target", seatId: "seat:probe-target", sessionVersion: 1, characterId: OTHER };
function fixture(label) {
  return createAuthoredProbeFixture(`social-plan:${label}`, { npcCharacters: [{ id: NPC, name: "守门人" }],
    initialKnowledge: [NPC, ACTOR].map(characterId => ({ characterId, knowledgeRef: KNOWLEDGE, kind: "sourceClaim", layer: "full",
      content: characterId === NPC ? RESPONSE : "PLAYER-KNOWLEDGE-CANARY", visibility: "private", provenanceChain: ["genesis:message"] })) });
}
function input(f, { check = false, promise = false, silence = false, audience = "participants", state = f.state, root = f.rootActionId, due = "none", nextStep = null } = {}) {
  const context = authoritativeNpcDecisionContext(state, f.profiles, NPC);
  assert.ok(context);
  const resolutionId = `resolution:${root}`, expression = "你看到信使往哪里走了吗？", method = "平静询问亲眼见到的行踪。";
  const branch = (failure) => ({ outcomeCode: failure ? "outcome:declined" : "outcome:answered", summary: failure ? "守门人没有接受请求。" : "守门人作出了回应。",
    response: { kind: silence ? "silence" : "speech", text: silence ? "" : failure ? "我现在不想谈论这件事。" : RESPONSE,
      motive: "PRIVATE-NPC-MOTIVE-CANARY", basis: [{ kind: "npcContext", ref: `knowledge:${NPC}:${KNOWLEDGE}` }] },
    consequences: promise && !failure ? [{ kind: "promise", content: "为来访者打开侧门。", condition: "核实介绍信以后。", authorityRefs: [NPC], due,
      terms: { kind: "result", subjectRefs: [NPC], delivery: null }, nextStep }] : [] });
  const social = { schema: "zhuwei.social-interaction/vnext-1", npcRef: NPC, threadRef: socialThreadRef(root, resolutionId), addressedThreadRef: null,
    playerExpression: expression, goal: SECRET, communication: "spokenConversation", audience,
    listeners: socialListeners(state, ACTOR, NPC, audience), npcContext: context, retryChange: null,
    branches: { success: branch(false), failure: branch(true) } };
  const readRefs = [...new Set([ACTOR, `character-timeline:${ACTOR}`, ...context.records.map(r => r.ref), ...context.knowledge.map(r => r.entryRef)])].sort();
  const ruling = check ? { kind: "check", resolutionKind: "abilityCheck", randomnessId: `randomness:${resolutionId}`,
    check: { kind: "skill", ability: "charisma", skill: "persuasion", dc: "12", modifier: "0", mode: "normal", goal: SECRET, method,
      risk: "守门人可能拒绝。", successOutcome: "守门人回应。", failureOutcome: "守门人拒绝。", costs: [] } } : { kind: "directSuccess" };
  return { kind: "resolveWorldInteraction", rootActionId: root, actorCharacterId: ACTOR,
    plan: { schema: "zhuwei.world-interaction-resolution-plan/v1", resolutionId, interactionRef: `interaction:${root}`, actorCharacterId: ACTOR,
      sceneRef: SCENE, abilityRef: null, contextHash: canonicalSha256({ root }), readSet: readRefs.map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(state, ref) })),
      targetRefs: [NPC], directTargetRefs: [NPC], instrumentRefs: [], basisRefs: [NPC], intent: expression, method, ruling, costs: [], social,
      branches: Object.fromEntries(Object.entries(social.branches).map(([key, value]) => [key, { outcomeCode: value.outcomeCode, summary: value.summary,
        effects: [], sensoryEvidence: [], pressures: [], opportunities: [] }])) } };
}
function project(f, result, viewer = f.viewer, events = result.events) {
  const view = f.runtime.project(f.profiles, result.state, viewer, { channel: "realtime", committedRange: committedActionRange(result.state, {
    receiptId: result.receipt.receiptId, actorCharacterId: ACTOR, priorState: f.state, events }) });
  assert.equal(view.kind, "projected", JSON.stringify(view)); return view;
}
function replay(f, events, expected) {
  const result = f.runtime.replay(f.genesis, events);
  assert.equal(result.kind, "replayed", diagnostic(result)); assert.deepEqual(result.state, expected); return result;
}

test("social direct speech uses the NPC holder, persists a conditional promise, private Claims and exact replay", () => {
  const f = fixture("direct"), command = input(f, { promise: true });
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, command);
  assert.equal(result.kind, "committed", diagnostic(result));
  assert.deepEqual(result.events.map(e => e.eventType), ["SourceClaimCreated", "KnowledgeAcquired", "SourceClaimCreated", "KnowledgeAcquired", "PromiseMade", "PromiseTermsEstablished", "NpcWorkProposed", "WorldInteractionResolved"]);
  assert.deepEqual(result.state.entities, f.state.entities);
  assert.deepEqual(result.state.campaignRuntime.itemSystem, f.state.campaignRuntime.itemSystem);
  assert.deepEqual(result.state.scenes, f.state.scenes);
  assert.deepEqual(result.state.canonicalFacts, f.state.canonicalFacts);
  assert.equal(Object.values(result.state.campaignRuntime.promises)[0].condition, "核实介绍信以后。");
  const player = project(f, result), npc = project(f, result, npcViewer), other = project(f, result, otherViewer);
  assert.match(JSON.stringify(player.renderableClaims), /我亲眼见到信使从北门离开/);
  assert.ok(player.renderableClaims.claims.some(c => c.outcomeKind === "social"));
  assert.ok(player.renderableClaims.claims.some(c => c.kind === "socialCommitment"));
  assert.doesNotMatch(JSON.stringify(npc), /PLAYER-HIDDEN-GOAL-CANARY|PLAYER-KNOWLEDGE-CANARY/);
  assert.match(JSON.stringify(npc.sourceClaims), /PRIVATE-NPC-MOTIVE-CANARY/);
  assert.doesNotMatch(JSON.stringify(npc.renderableClaims), /PRIVATE-NPC-MOTIVE-CANARY/);
  assert.doesNotMatch(JSON.stringify(player), /PRIVATE-NPC-MOTIVE-CANARY/);
  assert.doesNotMatch(JSON.stringify(other), /我亲眼见到信使从北门离开|核实介绍信以后/);
  replay(f, result.events, result.state);
});

for (const mode of ["deliberate-lie", "heard-false-rumor"]) test(`social ${mode} preserves attributed speech without rewriting canon or forcing belief`, () => {
  const truth = "信使从北门离开。", rumor = "南边酒馆的搬运工告诉我，信使从南门离开。";
  const f = createAuthoredProbeFixture(`social-false-claim:${mode}`, {
    npcCharacters: [{ id: NPC, name: "守门人" }],
    canonicalFacts: [{ id: "fact:courier-route", kind: "worldFact", source: "moduleAnchor", subjectRefs: [SCENE],
      value: truth, visibilityPolicyId: "visibility:room-authority-only" }],
    initialKnowledge: [{ characterId: NPC, knowledgeRef: KNOWLEDGE,
      kind: mode === "deliberate-lie" ? "sensoryEvidence" : "sourceClaim", layer: "full",
      content: mode === "deliberate-lie" ? truth : rumor, visibility: "private", provenanceChain: ["genesis:npc-information"] }],
  });
  const command = input(f), response = command.plan.social.branches.success.response;
  response.text = mode === "deliberate-lie" ? "信使往南门走了。" : "酒馆的搬运工说，信使往南门走了。";
  response.motive = mode === "deliberate-lie" ? "PRIVATE-LIE-MOTIVE：保护信使，故意把追问者引向反方向。"
    : "PRIVATE-RUMOR-MOTIVE：相信自己听到的消息，想帮助来访者。";
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, command);
  assert.equal(result.kind, "committed", diagnostic(result));
  assert.deepEqual(result.state.canonicalFacts, f.state.canonicalFacts, "false speech does not rewrite the actual route");
  assert.deepEqual(result.state.knowledge[NPC][KNOWLEDGE], f.state.knowledge[NPC][KNOWLEDGE], "speaking does not rewrite what the NPC previously knew");
  const claimEvent = result.events.find(event => event.eventType === "SourceClaimCreated" && event.payload.speakerId === NPC);
  assert.ok(claimEvent);
  assert.equal(claimEvent.payload.semanticContent, response.text);
  assert.equal(claimEvent.payload.motive, response.motive);
  assert.equal(claimEvent.payload.sourceBasis, JSON.stringify(response.basis));
  assert.equal(claimEvent.payload.formedAtFictionMicros, "0");
  const held = result.state.knowledge[ACTOR][claimEvent.payload.claimId];
  assert.equal(held.objectKind, "sourceClaim"); assert.equal(held.content, response.text);
  assert.ok(held.provenanceChain.includes(claimEvent.eventId));
  const player = project(f, result), claim = player.renderableClaims.claims.find(entry => entry.kind === "sourceClaim" && entry.speakerRef === NPC);
  assert.equal(claim.speakerRef, NPC); assert.ok(claim.statement.includes(response.text));
  assert.match(claim.narrationFacts.join("\n"), /主张.*尚未由这条记录证实/);
  assert.doesNotMatch(JSON.stringify(player), /PRIVATE-LIE-MOTIVE|PRIVATE-RUMOR-MOTIVE/);
  assert.doesNotMatch(JSON.stringify(project(f, result, otherViewer)), /信使往南门走了/);
  const next = authoritativeNpcDecisionContext(result.state, f.profiles, NPC);
  assert.ok(next);
  const remembered = next.records.find(record => record.kind === "sourceClaim" && record.value.claimId === claimEvent.payload.claimId);
  assert.deepEqual(remembered?.value.ownOrigin, { sourceBasis: JSON.stringify(response.basis),
    motive: response.motive, formedAtFictionMicros: "0" }, "the speaking NPC can retrieve its own frozen reason on the next turn");
  assert.ok(next.records.filter(record => record.kind === "sourceClaim" && record.value.speakerId !== NPC)
    .every(record => !Object.hasOwn(record.value, "ownOrigin")), "hearing someone else's claim does not reveal their private reason");
  replay(f, result.events, result.state);
});

test("social check freezes either response before randomness and binds formal source event IDs after suspension", () => {
  for (const roll of [1, 20]) {
    const f = fixture(`roll-${roll}`), command = input(f, { check: true, promise: true });
    const pending = stepActionToDecision(f.runtime, f.profiles, f.state, command);
    assert.equal(pending.kind, "awaitingRandomness", diagnostic(pending));
    assert.deepEqual(pending.state.knowledge, f.state.knowledge);
    const restored = replay(f, pending.events, pending.state);
    const result = f.runtime.step(f.profiles, restored.state, { kind: "fulfillAuthoritativeRandomness", continuation: pending.continuation, rolls: [roll] });
    assert.equal(result.kind, "committed", diagnostic(result));
    const events = [...pending.events, ...result.events];
    for (const acquisition of result.events.filter(e => e.eventType === "KnowledgeAcquired")) {
      const claim = result.events.find(e => e.eventType === "SourceClaimCreated" && e.payload.claimId === acquisition.payload.items[0].knowledgeRef);
      assert.ok(acquisition.payload.items[0].provenanceChain.includes(claim.eventId));
    }
    assert.equal(Object.keys(result.state.campaignRuntime.promises).length, roll === 20 ? 1 : 0);
    project(f, result, f.viewer, events); replay(f, events, result.state);
  }
});

test("malformed social snapshot and foreign failure-branch evidence reject before randomness", () => {
  const f = fixture("invalid");
  for (const mutate of [
    p => { p.social.npcContext = { npcRef: NPC }; },
    p => { p.social.npcContext.schema = "e\u0301"; },
    p => { p.social.audience = { toString: null }; },
    p => { p.social.branches.failure.response.basis = [{ kind: "npcContext", ref: `knowledge:${ACTOR}:${KNOWLEDGE}` }]; },
    p => { p.social.branches.failure.consequences = [{ kind: "promise", content: "交付物品。", condition: "立即。", authorityRefs: [ACTOR], due: "none",
      terms: { kind: "result", subjectRefs: [NPC], delivery: null }, nextStep: null }]; },
  ]) {
    const command = structuredClone(input(f, { check: true })); mutate(command.plan);
    const result = stepActionToDecision(f.runtime, f.profiles, f.state, command);
    assert.equal(result.kind, "rejected", diagnostic(result)); assert.equal(result.randomnessRequest, undefined);
  }
});

test("silence makes no NPC statement and scene listeners hear only actual speech", () => {
  const f = fixture("silence"), command = input(f, { silence: true, audience: "sceneListeners" });
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, command);
  assert.equal(result.kind, "committed", diagnostic(result));
  assert.equal(result.events.filter(e => e.eventType === "SourceClaimCreated").length, 1);
  assert.ok(result.state.knowledge[OTHER][result.events[0].payload.claimId]);
  assert.equal(Object.values(result.state.campaignRuntime.conversationThreads)[0].responseClaimRef, null);
  assert.match(JSON.stringify(project(f, result).renderableClaims), /对方保持沉默/);
  replay(f, result.events, result.state);
});

function signedPayload(event, mutate) {
  const changed = structuredClone(event); mutate(changed.payload);
  changed.payloadHash = canonicalSha256(changed.payload); changed.eventHash = eventHash(changed); return changed;
}
test("social replay rejects forged result fields, missing marker, altered dice and incomplete child ledgers", () => {
  const f = fixture("replay-forgery"), command = input(f, { check: true, promise: true });
  const pending = stepActionToDecision(f.runtime, f.profiles, f.state, command);
  assert.equal(pending.kind, "awaitingRandomness", diagnostic(pending));
  const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness", continuation: pending.continuation, rolls: [15] });
  assert.equal(result.kind, "committed", diagnostic(result));
  const all = [...pending.events, ...result.events], last = all.at(-1), prefix = all.slice(0, -1);
  for (const mutate of [
    p => { p.targetRefs = [OTHER]; p.directTargetRefs = [OTHER]; },
    p => { p.instrumentRefs = [OTHER]; }, p => { p.basisRefs = [OTHER]; },
    p => { p.check.total++; },
    p => { p.check.rolls = [16]; p.check.selectedRoll = 16; p.check.total = 16; },
    p => { delete p.social; },
    p => { delete p.social; p.rulingKind = "directSuccess"; p.check = null; p.branch = "success"; p.resolutionId = "resolution:forged"; },
  ]) {
    const changed = signedPayload(last, mutate);
    const replayed = f.runtime.replay(f.genesis, [...prefix, changed]);
    assert.equal(replayed.kind, "rejected", diagnostic(replayed));
    assert.equal(replayed.rejection.code, "invalidEventEnvelope");
    const prior = f.runtime.replay(f.genesis, prefix);
    assert.equal(prior.kind, "replayed");
    if (validateEventEnvelope(changed).ok) assert.throws(() => createEventTransition(prior.state, f.profiles, { rootActionId: last.rootActionId,
      resolutionId: last.resolutionId, eventType: last.eventType, payload: changed.payload, scopeProof: result.scopeProof,
      visibilityPolicyId: last.visibilityPolicyId, secrecy: last.secrecy }));
  }
  for (const mutate of [p => { p.social.plan.social.npcContext = { npcRef: NPC }; },
    p => { p.social.plan.social.npcContext.schema = "e\u0301"; },
    p => { p.social.plan.social.audience = { toString: null }; }]) {
    const changed = structuredClone(last); mutate(changed.payload);
    assert.doesNotThrow(() => { assert.equal(f.runtime.replay(f.genesis, [...prefix, changed]).kind, "rejected"); });
  }
  const removed = prefix.filter(e => !["PromiseMade", "PromiseTermsEstablished", "NpcWorkProposed"].includes(e.eventType));
  const before = f.runtime.replay(f.genesis, removed);
  assert.equal(before.kind, "replayed", diagnostic(before));
  assert.throws(() => createEventTransition(before.state, f.profiles, { rootActionId: last.rootActionId,
    eventType: last.eventType, payload: last.payload, scopeProof: result.scopeProof,
    visibilityPolicyId: last.visibilityPolicyId, secrecy: last.secrecy }), /social:domain-events-do-not-match/);
});

test("correction restores conversation, knowledge and promises; unchanged failed requests cannot reroll", () => {
  const f = fixture("correction"), command = input(f, { promise: true });
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, command);
  assert.equal(result.kind, "committed", diagnostic(result));
  const rebuilt = replay(f, result.events, result.state);
  const corrected = f.runtime.step(f.profiles, rebuilt.state, { kind: "applyServiceCorrection",
    correctionAuthority: { kind: "roomCorrectionAuthority", capability: rebuilt.state.correctionRuntime.authorityCapability },
    correctionId: "correction:social", targetReceiptId: result.receipt.receiptId, actorCharacterId: ACTOR,
    errorKind: "rulesMisapplication", publicExplanation: "撤销错误记录的交谈。", basis: { stateHash: rebuilt.head.stateHash, eventHash: rebuilt.head.eventHash } });
  assert.equal(corrected.kind, "committed", diagnostic(corrected));
  assert.deepEqual(corrected.state.knowledge, f.state.knowledge);
  assert.deepEqual(corrected.state.campaignRuntime.conversationThreads, f.state.campaignRuntime.conversationThreads);
  assert.deepEqual(corrected.state.campaignRuntime.promises, f.state.campaignRuntime.promises);
  replay(f, [...result.events, ...corrected.events], corrected.state);
  const g = fixture("retry"), checked = input(g, { check: true });
  const pending = g.runtime.step(g.profiles, g.state, checked);
  const failed = g.runtime.step(g.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness", continuation: pending.continuation, rolls: [1] });
  assert.equal(failed.kind, "committed", diagnostic(failed));
  const again = input(g, { check: true, state: failed.state, root: `${g.rootActionId}:again` });
  const rejected = g.runtime.step(g.profiles, failed.state, again);
  assert.equal(rejected.kind, "rejected", JSON.stringify(rejected)); assert.equal(rejected.rejection.code, "unchangedRetry");
});

function bundle(f, check = false) {
  const plan = input(f, { check, promise: true }).plan;
  const { npcRef, addressedThreadRef, goal, communication, audience, branches } = plan.social;
  return { mode: "adjudication", basisRefs: [NPC], terminal: { kind: "none" },
    adjudication: check ? { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "cha", skill: "persuasion", dc: 12, mode: "normal",
      risk: "守门人可能拒绝。", successOutcome: "守门人回答。", failureOutcome: "守门人拒绝。" }
      : { kind: "directSuccess", durationMicros: "300000000", risk: "普通交谈。", successOutcome: "守门人回答。" },
    proposals: [{ kind: "social", basisRefs: [NPC], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE,
      npcRef, addressedThreadRef: addressedThreadRef ?? { kind: "none" }, goal, method: plan.method, communication, audience,
      retryChange: { kind: "none" }, branches: { success: branches.success, failure: check ? branches.failure : { kind: "none" } } }] };
}
function lower(f, value, state = f.state) {
  const context = freezeAuthoredProbeContext(f, state, { rootActionId: f.rootActionId, focusRefs: [NPC, "definition:probe-valve"],
    intentText: "请告诉我：你看到信使往哪里走了吗？" }).context;
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(value)));
  assert.equal(parsed.kind, "accepted", diagnostic(parsed));
  return lowerVNext2ProposalBundle({ ...f, state, requiredContext: context, value: parsed.bundle });
}

test("social actor knowledge basis resolves raw and holder refs to the same loaded record without borrowing NPC knowledge", () => {
  const f = fixture("actor-knowledge-alias");
  const context = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [NPC], intentText: "结合我知道的消息向守门人问路。" }).context;
  const heldRef = `knowledge:${ACTOR}:${KNOWLEDGE}`, otherRef = `knowledge:${NPC}:${KNOWLEDGE}`;
  const lowerWith = (ref, entries = context.entries) => {
    const wire = bundle(f); wire.basisRefs = [NPC, ref]; wire.proposals[0].basisRefs = [NPC, ref];
    const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(wire)));
    assert.equal(parsed.kind, "accepted", diagnostic(parsed));
    return lowerVNext2ProposalBundle({ ...f, state: f.state, requiredContext: { ...context, entries }, value: parsed.bundle });
  };
  const raw = lowerWith(KNOWLEDGE), canonical = lowerWith(heldRef);
  assert.equal(raw.kind, "accepted", diagnostic(raw)); assert.equal(canonical.kind, "accepted", diagnostic(canonical));
  assert.deepEqual(soleStep(raw.command).plan.readSet, soleStep(canonical.command).plan.readSet,
    "both spellings bind the identical authority records without rewriting the model's proposal");
  for (const lowered of [raw, canonical]) {
    const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
    assert.equal(result.kind, "committed", diagnostic(result));
    project(f, result); replay(f, result.events, result.state);
  }
  const missing = lowerWith(KNOWLEDGE, context.entries.filter(entry => entry.entryRef !== heldRef));
  assert.equal(missing.kind, "rejected");
  assert.equal(missing.code, "PROPOSAL_REFERENCE_INVALID");
  assert.ok(missing.issues.includes("proposal:basis-ref-not-read-bound"));
  assert.ok(context.entries.some(entry => entry.entryRef === otherRef), "same raw ID still exists for the NPC and cannot satisfy the actor alias");
});

test("independent social Form preserves the player's original expression through parse, lowering, Rules and Claims", () => {
  assert.deepEqual(deepSeekStrictToolSchemaIssues(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA), []);
  const f = fixture("form"), lowered = lower(f, bundle(f));
  assert.equal(lowered.kind, "accepted", diagnostic(lowered));
  assert.equal(soleFormId(lowered.command), "social.vnext-1");
  assert.equal(soleStep(lowered.command).plan.social.playerExpression, "请告诉我：你看到信使往哪里走了吗？");
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(result.kind, "committed", diagnostic(result)); project(f, result); replay(f, result.events, result.state);
  const bad = bundle(f, true);
  bad.proposals[0].branches.failure.response.basis = [{ kind: "npcContext", ref: `knowledge:${ACTOR}:${KNOWLEDGE}` }];
  assert.equal(lower(f, bad).kind, "rejected");
});

test("social can cite the advertised NPC knowledge directory without aliasing another holder", () => {
  const f = fixture("advertised-citation");
  const context = freezeAuthoredProbeContext(f, f.state, { focusRefs: [NPC], intentText: "你看见了什么？" }).context;
  const refs = context.references.citations.npcKnowledge.find(entry => entry.npcRef === NPC).refs;
  assert.equal(refs.length, 1);
  const wire = bundle(f);
  wire.proposals[0].branches.success.response.basis = refs.map(ref => ({ kind: "npcContext", ref }));
  const lowered = lower(f, wire);
  assert.equal(lowered.kind, "accepted", diagnostic(lowered));
  assert.deepEqual(refs, [`knowledge:${NPC}:${KNOWLEDGE}`]);
  assert.ok(refs.every(ref => !context.references.citations.nonCitableRefs.includes(ref)));
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(result.kind, "committed", diagnostic(result));
  project(f, result); replay(f, result.events, result.state);
  const rawWire = bundle(f);
  rawWire.proposals[0].branches.success.response.basis = [{ kind: "npcContext", ref: KNOWLEDGE }];
  const raw = lower(f, rawWire);
  assert.equal(raw.kind, "accepted", diagnostic(raw));
  assert.deepEqual(soleStep(raw.command).plan.social.branches.success.response.basis,
    soleStep(lowered.command).plan.social.branches.success.response.basis);
  assert.deepEqual(soleStep(raw.command).plan.readSet, soleStep(lowered.command).plan.readSet);
  const rawResult = stepActionToDecision(f.runtime, f.profiles, f.state, raw.command.rulesInput);
  assert.equal(rawResult.kind, "committed", diagnostic(rawResult));
  project(f, rawResult); replay(f, rawResult.events, rawResult.state);
  const frozen = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [NPC], intentText: "你看见了什么？" }).context;
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(rawWire)));
  assert.equal(parsed.kind, "accepted", diagnostic(parsed));
  const missing = lowerVNext2ProposalBundle({ ...f, value: parsed.bundle, requiredContext: { ...frozen,
    entries: frozen.entries.filter(entry => entry.entryRef !== `knowledge:${NPC}:${KNOWLEDGE}`) } });
  assert.equal(missing.kind, "rejected");
  assert.ok(frozen.entries.some(entry => entry.entryRef === `knowledge:${ACTOR}:${KNOWLEDGE}`),
    "the other holder's same knowledge ID cannot replace the missing NPC body");
  for (const ref of [`knowledge:${ACTOR}:${KNOWLEDGE}`, "knowledge:unknown-holder:unknown-id", "unknown-knowledge"]) {
    const bad = bundle(f);
    bad.proposals[0].branches.success.response.basis = [{ kind: "npcContext", ref }];
    const rejected = lower(f, bad);
    assert.equal(rejected.kind, "rejected");
    assert.equal(rejected.code, "PROPOSAL_REFERENCE_INVALID");
    assert.deepEqual(rejected.issues, ["social:foreign-npc-basis"]);
    assert.deepEqual(rejected.diagnostics[0].path, ["results", 0, "responseBasis", 0]);
  }
});

test("social is the one shared check owner with independent conditional physical consequences", () => {
  for (const roll of [1, 20]) {
    const f = fixture(`social-owner-${roll}`), value = bundle(f, true), mixed = sharedCheckBundle();
    mixed.adjudication = value.adjudication; mixed.proposals[1] = value.proposals[0];
    const lowered = lower(f, mixed);
    assert.equal(lowered.kind, "accepted", diagnostic(lowered));
    assert.equal(atomicCompletionInput(lowered.command.rulesInput).steps.filter(s => s.rulesInput.plan.ruling?.kind === "check").length, 1);
    const pending = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
    assert.equal(pending.kind, "awaitingRandomness", diagnostic(pending));
    const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness", continuation: pending.continuation, rolls: [roll] });
    assert.equal(result.kind, "committed", diagnostic(result));
    assert.equal(result.state.campaignRuntime.definitions["definition:probe-valve"].content.observableState, roll === 20 ? "opened" : "jammed");
    const events = [...pending.events, ...result.events];
    project(f, result, f.viewer, events); replay(f, events, result.state);
  }
});

test("a social prefix resumes with formal SourceClaim provenance after a later atomic player-choice suspension", () => {
  const f = fixture("social-prefix-suspend"), state = structuredClone(f.state);
  state.entities[OTHER].hitPoints.current = 1;
  state.combatRuntime.entities[OTHER].hitPoints.current = "1";
  const { eventHeadHash: _, lastEventId: __, ...domain } = state;
  const initialStateHash = canonicalSha256(domain); state.eventHeadHash = initialStateHash;
  const { genesisHash: ___, ...unsigned } = { ...f.genesis, initialState: state, initialStateHash };
  f.genesis = { ...unsigned, genesisHash: canonicalSha256(unsigned) };
  f.state = f.runtime.replay(f.genesis, []).state;
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle(f))));
  assert.equal(parsed.kind, "accepted", diagnostic(parsed));
  const value = structuredClone(parsed.bundle);
  const item = itemBundle();
  Object.assign(item.proposals[0].source.content, { healing: null,
    target: { kind: "creature", count: "1", reachInches: "900", requiresSight: false },
    attack: { ability: "str", proficiency: true }, damage: [{ type: "force", formula: "1d4", sharedAcrossTargets: false }] });
  item.proposals[4].operation.targetRefs = [OTHER];
  value.proposals.push(...item.proposals);
  const context = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId,
    focusRefs: [NPC, OTHER, "definition:probe-valve"], intentText: "先询问守门人，再使用自己取得的武器攻击旁人。" }).context;
  const lowered = lowerVNext2ProposalBundle({ ...f, requiredContext: context, value });
  assert.equal(lowered.kind, "accepted", diagnostic(lowered));
  let result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  const events = [];
  let stages = 0;
  while (result.kind === "awaitingRandomness" && stages++ < 3) {
    events.push(...result.events);
    assert.deepEqual(result.state.knowledge, f.state.knowledge, "all speech remains uncommitted while the sibling is pending");
    const restored = replay(f, events, result.state);
    result = f.runtime.step(f.profiles, restored.state, { kind: "fulfillAuthoritativeRandomness", continuation: result.continuation,
      rolls: result.randomnessRequest.dice.flatMap(die => Array(Number(die.count)).fill(Number(die.sides) === 20 ? 15 : 2)) });
  }
  assert.equal(result.kind, "awaitingInput", diagnostic(result)); events.push(...result.events);
  assert.ok(events.some(e => e.eventType === "AtomicWorldInteractionSuspended"));
  assert.deepEqual(result.state.knowledge, f.state.knowledge);
  assert.equal(events.filter(e => e.eventType === "SourceClaimCreated").length, 0);
  const restored = replay(f, events, result.state);
  result = f.runtime.step(f.profiles, restored.state, { kind: "answerPendingInput", pendingInputId: result.pending.pendingInputId,
    responseId: "response:social-sibling", answer: { kind: "knockOut" } });
  if (result.kind === "awaitingRandomness") {
    events.push(...result.events);
    assert.deepEqual(result.state.knowledge, f.state.knowledge);
    const ready = replay(f, events, result.state);
    result = f.runtime.step(f.profiles, ready.state, { kind: "fulfillAuthoritativeRandomness", continuation: result.continuation,
      rolls: result.randomnessRequest.dice.flatMap(die => Array(Number(die.count)).fill(2)) });
  }
  assert.equal(result.kind, "committed", diagnostic(result)); events.push(...result.events);
  assert.equal(events.filter(e => e.eventType === "SourceClaimCreated").length, 2);
  for (const acquisition of events.filter(e => e.eventType === "KnowledgeAcquired")) {
    const source = events.find(e => e.eventType === "SourceClaimCreated" && e.payload.claimId === acquisition.payload.items[0].knowledgeRef);
    assert.ok(acquisition.payload.items[0].provenanceChain.includes(source.eventId));
  }
  assert.equal(result.state.entities[OTHER].hitPoints.current, 0);
  replay(f, events, result.state); project(f, result, f.viewer, events);
});

test("spoken conversation enforces hearing and speech while preserving the charmer's social advantage", () => {
  for (const [entity, condition] of [[ACTOR, "unconscious"], [NPC, "deafened"], [NPC, "unconscious"]]) {
    const f = fixture(`condition-${entity}-${condition}`), state = structuredClone(f.state);
    state.combatRuntime.entities[entity].conditions = { [condition]: true };
    const command = input(f, { state, check: true });
    const result = stepActionToDecision(f.runtime, f.profiles, state, command);
    assert.equal(result.kind, "rejected", diagnostic(result)); assert.deepEqual(result.events, []);
  }
  const f = fixture("charmer"), state = structuredClone(f.state);
  state.combatRuntime.entities[NPC].conditions = { charmed: true, charmedBy: ACTOR };
  const pending = f.runtime.step(f.profiles, state, input(f, { state, check: true }));
  assert.equal(pending.kind, "awaitingRandomness", diagnostic(pending));
  assert.equal(pending.randomnessRequest.frozenCheck.mode, "advantage");
  const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness", continuation: pending.continuation, rolls: [1, 20] });
  assert.equal(result.kind, "committed", diagnostic(result));
  assert.equal(result.events.find(e => e.eventType === "WorldInteractionResolved").payload.check.selectedRoll, 20);
});

test("direct or failed social settlement cannot remove or downgrade its type and outcome", () => {
  for (const check of [false, true]) {
    const f = fixture(`marker-${check}`), start = f.runtime.step(f.profiles, f.state, input(f, { check }));
    const result = check ? f.runtime.step(f.profiles, start.state, { kind: "fulfillAuthoritativeRandomness", continuation: start.continuation, rolls: [1] }) : start;
    assert.equal(result.kind, "committed", diagnostic(result));
    const events = check ? [...start.events, ...result.events] : result.events;
    const prefix = events.slice(0, -1), event = events.at(-1), prior = f.runtime.replay(f.genesis, prefix);
    assert.equal(prior.kind, "replayed");
    for (const changeResolution of [false, true]) {
      const forged = signedPayload(event, payload => {
        delete payload.social; payload.rulingKind = "directSuccess"; payload.branch = "success"; payload.check = null;
        if (changeResolution) payload.resolutionId = "resolution:changed";
      });
      assert.throws(() => createEventTransition(prior.state, f.profiles, { rootActionId: event.rootActionId, resolutionId: event.resolutionId,
        eventType: event.eventType, payload: forged.payload, scopeProof: result.scopeProof, visibilityPolicyId: event.visibilityPolicyId,
        secrecy: event.secrecy }), /social:settlement-marker-missing/);
      const replayed = f.runtime.replay(f.genesis, [...prefix, forged]);
      assert.equal(replayed.kind, "rejected"); assert.equal(replayed.rejection.code, "invalidEventEnvelope");
    }
  }
});

test("social relationship updates preserve identity and correction restores the existing record", () => {
  const f = fixture("relationship-update"), relation = "relationship:guard-and-actor";
  const created = f.runtime.step(f.profiles, f.state, { kind: "changeRelationship", proposalId: "root:existing-relationship",
    relationshipId: relation, subjectIds: [ACTOR, NPC], change: "谨慎观望。", basisFactIds: [] });
  assert.equal(created.kind, "committed", diagnostic(created));
  const command = input(f, { state: created.state });
  command.plan.social.branches.success.consequences = [{ kind: "relationship", relationshipRef: relation, change: "愿意继续听取解释。", basisFactRefs: [] }];
  const result = stepActionToDecision(f.runtime, f.profiles, created.state, command);
  assert.equal(result.kind, "committed", diagnostic(result));
  assert.equal(result.state.campaignRuntime.relationships[relation].value, "愿意继续听取解释。");
  assert.equal(result.scopeProof.creates.includes(`relationship:${relation}`), false);
  const events = [...created.events, ...result.events], rebuilt = replay(f, events, result.state);
  const corrected = f.runtime.step(f.profiles, result.state, { kind: "applyServiceCorrection",
    correctionAuthority: { kind: "roomCorrectionAuthority", capability: result.state.correctionRuntime.authorityCapability },
    correctionId: "correction:relationship-in-social", targetReceiptId: result.receipt.receiptId, actorCharacterId: ACTOR,
    errorKind: "rulesMisapplication", publicExplanation: "恢复此前关系。", basis: { stateHash: rebuilt.head.stateHash, eventHash: rebuilt.head.eventHash } });
  assert.equal(corrected.kind, "committed", diagnostic(corrected));
  assert.deepEqual(corrected.state.campaignRuntime.relationships[relation], created.state.campaignRuntime.relationships[relation]);
  replay(f, [...events, ...corrected.events], corrected.state);
});

test("promise deadlines and NPC next steps are independent; formation creates no future action or trace", () => {
  const f = fixture("promise-due"), command = input(f, { promise: true, due: "1h", nextStep: "检查介绍信。" });
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, command);
  assert.equal(result.kind, "committed", diagnostic(result));
  const promise = Object.values(result.state.campaignRuntime.promises)[0];
  assert.equal(promise.status, "active");
  const plans = Object.values(result.state.campaignRuntime.npcPlans);
  assert.equal(plans.length, 1);
  const plan = plans[0];
  assert.equal(plan.npcId, NPC); assert.equal(plan.status, "planned");
  assert.deepEqual(plan.premiseRefs, [promise.lifecycle.originalExpressionRef]);
  assert.equal(plan.goal, "为来访者打开侧门。"); assert.equal(plan.nextStep, "检查介绍信。");
  assert.equal(plan.activity, undefined); assert.equal(plan.trace, undefined);
  const timelineId = f.state.multiplayerRuntime.characterTimelineIds[NPC] ?? f.state.activeBranchId;
  assert.equal(promise.lifecycle.deadlineFictionMicros, (BigInt(result.state.fictionTimelines[timelineId].nowMicros) + 3600000000n).toString());
  const types = result.events.map(event => event.eventType);
  assert.ok(types.indexOf("PromiseMade") < types.indexOf("NpcWorkProposed"), types.join(","));
  assert.ok(!types.includes("ActivityStarted"));
  assert.deepEqual(result.state.campaignRuntime.activities, f.state.campaignRuntime.activities);
  assert.deepEqual(result.state.canonicalFacts, f.state.canonicalFacts);
  replay(f, result.events, result.state);
  // No fixed deadline or selected method still requires an NPC decision, not
  // an automatic side-door effect or invented work duration.
  const plain = f.runtime.step(f.profiles, f.state, input(f, { promise: true }));
  assert.equal(plain.kind, "committed", diagnostic(plain));
  assert.equal(Object.keys(plain.state.campaignRuntime.promises).length, 1);
  assert.equal(Object.values(plain.state.campaignRuntime.npcPlans)[0].status, "planned");
  assert.deepEqual(plain.state.campaignRuntime.activities, f.state.campaignRuntime.activities);
});
