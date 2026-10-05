import { itemDefinitionFromStandardGear } from "../../../app/_runtime/lib/rules/v2/items.ts";
import { itemById } from "../../../app/_runtime/lib/dnd/gear.ts";
import { authorityRevisionOrHash } from "../../../app/_runtime/lib/rules/v2/authority-bindings.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canonicalHash } from "../../../app/_runtime/lib/kp/vnext/canonical-json.ts";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { concealmentDc, defaultConcealmentAttention, frozenConcealmentObservers } from "../../../app/_runtime/lib/rules/v2/concealment.ts";
import { committedActionRange, stepActionToDecision } from "../../support/fixtures/vnext-action-lifecycle.mjs";
import { vnextRulesRevisionDiagnostics } from "../../../app/_runtime/lib/room/vnext-proposal-invocation.ts";
import { proposalFillingDiagnostics } from "../../../app/_runtime/lib/kp/vnext/proposal-filling-interface.ts";
import { atomicCompletionInput } from "../../support/fixtures/vnext-action-duration.mjs";
import { parseWithNpcReplies } from "../../support/fixtures/vnext-npc-replies.mjs";

// SPEC 0016 §7.3, SPEC 0006 §7 (ADR 0073): the ruling's form holds no reply; each
// NPC answers in its own call. The complete plan is the ruling with the
// replies the domain bundle states.
const parseComplete = value => parseWithNpcReplies(encodeVNextStrictToolBundle(value), value);

const LIAN = "npc:concealment-lian", MIRA = "npc:concealment-mira", VARO = "npc:concealment-varo", SOURCE = "definition:probe-valve";

function fixture(name) {
  return createAuthoredProbeFixture(`concealed-check:${name}`,
    { npcCharacters: [{ id: LIAN, name: "莉安" }, { id: MIRA, name: "米拉" }, { id: VARO, name: "瓦罗" }] });
}

/** A covert act hidden mainly from Lian, who is distracted; Varo cannot see
 * it; Mira is left out and so takes Rules' default. The other player is in
 * the scene too but is never compared (SPEC 0005 §6.2). */
function bundle({ primary = LIAN, observers = [
  { observerRef: LIAN, attention: "distracted", basisRefs: [SOURCE] },
  { observerRef: VARO, attention: "unseen", basisRefs: [SOURCE] },
] } = {}) {
  const heard = (evidence) => ({ observerRef: ACTOR, subjectRef: SOURCE, sense: "hearing", evidence, basisRefs: [SOURCE] });
  const branch = (suffix, summary) => ({ outcomeCode: `outcome:${suffix}`, summary, effects: [], sensoryEvidence: [heard(summary)], pressures: [], opportunities: [] });
  return { mode: "adjudication", basisRefs: [SOURCE], terminal: { kind: "none" },
    adjudication: { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "dex", skill: "sleight", dc: null, mode: "normal",
      risk: "动作被看见，莉安会追问。", successOutcome: "阀门被悄悄拧松。", failureOutcome: "莉安看见了你的手。",
      concealment: { primaryObserverRef: primary, sense: "sight", evidence: "看见有人在阀门旁偷偷动手。", observers } },
    proposals: [{ basisRefs: [SOURCE], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "趁人不注意拧松阀门。", method: "借身体挡住，悄悄转动阀门。",
      targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: branch("unnoticed", "阀门松开了，没有人出声。"), failure: branch("noticed", "阀门松开了，莉安看向你的手。") } }] };
}

function lower(f, internal) {
  const parsed = parseComplete(internal);
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  return lowerVNext2ProposalBundle({ ...f, value: parsed.bundle });
}

function checkOf(input) {
  return atomicCompletionInput(input).steps.find(step => step.rulesInput.plan?.ruling?.kind === "check").rulesInput.plan.ruling.check;
}

function addPrimaryWitness(value, outcomeBinding = "onFailure") {
  const c = value.adjudication.concealment;
  value.proposals.push({ kind: "observe", basisRefs: [SOURCE, LIAN, ACTOR], consumes: [], produces: [], outcomeBinding,
    sceneRef: SCENE, inquiry: "记录莉安看见的动作。", method: "莉安观察当场举动。", focusRefs: [SOURCE], existingFactRefs: [],
    branches: { success: { outcomeCode: "outcome:lian-witness", summary: "莉安看见了动作。",
      sensoryEvidence: [{ observerRef: LIAN, subjectRef: ACTOR, sense: c.sense, evidence: c.evidence, basisRefs: [SOURCE] }],
      characterInferences: [] }, failure: { kind: "none" } } });
}

function contextWithObservers(f) {
  return { ...f, requiredContext: freezeAuthoredProbeContext(f, f.state,
    { rootActionId: f.rootActionId, focusRefs: [SOURCE, LIAN, MIRA, ACTOR] }).context };
}

function resolve(f, input, roll) {
  const pending = stepActionToDecision(f.runtime, f.profiles, f.state, input);
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  const result = f.runtime.step(f.profiles, JSON.parse(JSON.stringify(pending.state)), { kind: "fulfillAuthoritativeRandomness",
    continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls: [roll] });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  const events = [...pending.events, ...result.events];
  const replayed = f.runtime.replay(f.genesis, events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  assert.deepEqual(replayed.state, result.state);
  const resolved = result.events.filter(event => event.eventType === "WorldInteractionResolved" && event.payload.rulingKind === "check");
  assert.equal(resolved.length, 1);
  const noticed = result.events.filter(event => event.eventType === "SensoryEvidenceAcquired" && event.payload.characterId !== ACTOR);
  return { check: resolved[0].payload.check, branch: resolved[0].payload.branch, noticed, state: result.state,
    receiptId: result.receipt.receiptId, events };
}

// SPEC 0016 §7.3: the model gives no DC for a covert act; the frozen check
// names the primary observer's threshold and every present candidate.
test("a covert check freezes the Rules DC and every present candidate, the undeclared ones unfocused", () => {
  const f = fixture("frozen");
  const lowered = lower(f, bundle()); assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const check = checkOf(lowered.command.rulesInput);
  assert.deepEqual(check.concealment.observers.map(({ observerRef, attention }) => [observerRef, attention]),
    [[LIAN, "distracted"], [MIRA, "unfocused"], [VARO, "unseen"]]);
  assert.deepEqual(check.concealment.observers, frozenConcealmentObservers(f.profiles, f.state, ACTOR, "sight", bundle().adjudication.concealment.observers));
  assert.equal(check.dc, String(concealmentDc(check.concealment)));
  assert.equal(check.dc, "5", "Lian: passive 10, distracted -5");
});

// SPEC 0005 §6.2: one roll; the primary's noticing is the chosen branch, the
// others are compared with their own thresholds.
test("a high roll passes everyone and a low roll is noticed by every bystander who can see", () => {
  const f = fixture("rolls");
  const lowered = lower(f, bundle()); assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const high = resolve(f, lowered.command.rulesInput, 20);
  assert.equal(high.branch, "success");
  assert.equal(Object.hasOwn(high.check, "noticerRefs"), false);
  assert.deepEqual(high.noticed, []);
  const low = resolve(f, lowered.command.rulesInput, 1);
  assert.equal(low.branch, "failure", "1 misses Lian's 5");
  assert.deepEqual(low.check.noticerRefs, [LIAN, MIRA], "both thresholds are missed; Varo cannot see; the other player is not compared");
  assert.deepEqual(low.noticed.map(event => [event.payload.characterId, event.payload.publicEvidence]),
    [LIAN, MIRA].map(ref => [ref, "看见有人在阀门旁偷偷动手。"]));
  for (const event of low.noticed) assert.equal(event.visibilityPolicyId, `visibility:knowledge-holder:${event.payload.characterId}`);
  assert.deepEqual(low.events.filter(event => event.eventType === "NpcReactionOpened").map(event => event.payload.characterId), [MIRA],
    "the primary's reaction stays in the frozen branch, without another NPC call");
  const actorView = f.runtime.project(f.profiles, low.state, f.viewer);
  assert.equal(actorView.kind, "projected");
  assert.doesNotMatch(JSON.stringify(actorView), /看见有人在阀门旁偷偷动手/, "the actor learns who noticed only from visible reactions");
});

// SPEC 0005 §6.2: only the same perception in the frozen failure path
// already fulfills the primary's grant. Unrelated knowledge is not a grant.
test("the primary receives the noticed act exactly once despite an existing exact or unrelated branch perception", () => {
  for (const prior of ["none", "exact", "different-content", "different-sense"]) {
    const f = fixture(`primary-${prior}`), value = bundle();
    const declaration = value.adjudication.concealment;
    if (prior !== "none") value.proposals[0].branches.failure.sensoryEvidence.push({
      observerRef: LIAN, subjectRef: ACTOR, sense: prior === "different-sense" ? "hearing" : declaration.sense,
      evidence: prior === "different-content" ? "来客抬头问了一个问题。" : declaration.evidence, basisRefs: [SOURCE],
    });
    const lowered = lower(f, value); assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    const result = resolve(f, lowered.command.rulesInput, 1);
    assert.ok(result.check.noticerRefs.includes(LIAN), "the event records noticing even when evidence was authored");
    const primary = result.noticed.filter(event => event.payload.characterId === LIAN);
    assert.equal(primary.filter(event => event.payload.sense === declaration.sense && event.payload.publicEvidence === declaration.evidence).length, 1, prior);
    assert.equal(primary.length, prior === "different-content" || prior === "different-sense" ? 2 : 1, prior);
    assert.ok(!result.events.some(event => event.eventType === "NpcReactionOpened" && event.payload.characterId === LIAN));
  }
});

test("legacy failed-concealment events replay without retroactively granting the primary new knowledge", () => {
  // Captured offline from 67c29ce68b8b74e6d0372187288ddddd983ffe64:
  // fixture("legacy-primary-talk"), bundle() + always talk(LIAN), focusRefs
  // [SOURCE, LIAN], stepActionToDecision then rolls:[1]. events are the
  // pending + completion suffix; expectedStateHash hashes replayed.state.
  // This is deterministic Rules evidence, not a Provider capture.
  const legacy = JSON.parse(readFileSync(new URL("../../support/fixtures/concealed-primary-legacy-events.json", import.meta.url), "utf8"));
  const f = fixture(legacy.fixtureName);
  const oldCheck = legacy.events.find(event => event.eventType === "WorldInteractionResolved" && event.payload.rulingKind === "check");
  assert.equal(oldCheck.payload.branch, "failure");
  assert.deepEqual(oldCheck.payload.check.noticerRefs, [MIRA]);
  const replayed = f.runtime.replay(f.genesis, legacy.events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed).slice(0, 400));
  assert.equal(canonicalHash(replayed.state), legacy.expectedStateHash);
});

// SPEC 0005 §6.2, SPEC 0016 §9.2: freeze the source across the whole
// failure path; restoring JSON must neither add a duplicate nor lose evidence.
test("primary evidence in another executed step prevents only the matching automatic grant", () => {
  for (const binding of ["onFailure", "always", "onSuccess", "social-onFailure"]) {
    const f = contextWithObservers(fixture(`whole-path-${binding}`)), value = bundle();
    if (binding === "social-onFailure") {
      const social = talk(LIAN);
      social.outcomeBinding = "onFailure";
      social.branches.success.npcPerceives = value.adjudication.concealment.evidence;
      value.proposals.push(social);
    } else addPrimaryWitness(value, binding);
    const lowered = lower(f, value); assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    const policy = checkOf(lowered.command.rulesInput).concealment.evidencePolicy;
    assert.equal(policy.version, "primary-failure-v1");
    assert.equal(policy.primaryFailureSource === null, binding === "onSuccess");
    const result = resolve(f, lowered.command.rulesInput, 1);
    assert.ok(result.check.noticerRefs.includes(LIAN));
    const primary = result.noticed.filter(event => event.payload.characterId === LIAN);
    assert.equal(primary.length, 1, binding);
    if (binding !== "onSuccess") {
      assert.equal(primary[0].resolutionId, policy.primaryFailureSource.resolutionId);
      assert.ok(primary[0].payload.factId.startsWith("fact:world-interaction:"), "preserve the authored source identity");
    }
    const invalid = structuredClone(lowered.command.rulesInput);
    checkOf(invalid).concealment.evidencePolicy.primaryFailureSource = {
      resolutionId: "resolution:outside-this-path", branch: "success", evidenceIndex: 0,
    };
    assert.equal(stepActionToDecision(f.runtime, f.profiles, f.state, invalid).kind, "rejected", "unproven source rejected before dice");
  }
});

test("legacy frozen checks resume their authored primary evidence policy without an automatic upgrade", () => {
  for (const authored of [false, true]) {
    const f = contextWithObservers(fixture(`legacy-frozen-${authored}`)), value = bundle();
    if (authored) {
      addPrimaryWitness(value);
      value.proposals[1].branches.success.sensoryEvidence[0].evidence = "莉安看见来客在阀门旁伸手。";
    }
    const lowered = lower(f, value); assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    const legacy = structuredClone(lowered.command.rulesInput);
    delete checkOf(legacy).concealment.evidencePolicy;
    const result = resolve(f, legacy, 1);
    assert.deepEqual(result.check.noticerRefs, [MIRA], "legacy list stays bystander-only");
    const primary = result.noticed.filter(event => event.payload.characterId === LIAN);
    assert.equal(primary.length, authored ? 1 : 0);
    if (authored) assert.equal(primary[0].payload.publicEvidence, "莉安看见来客在阀门旁伸手。");
  }
});

// SPEC 0006 §7 and SPEC 0016 §7.3: a third party's reaction can be frozen
// as its own failure-bound conversation, without an additional model call.
test("concealed speech and physical acts can freeze a separate primary reply without duplicating noticed evidence", () => {
  for (const [host, withReply, extraSight] of [['whisper', false, false], ['whisper', true, false], ['whisper', true, true], ['physical', true, false]]) {
    const f = contextWithObservers(fixture(`primary-reply-${host}-${withReply}-${extraSight}`)), value = bundle();
    if (host === 'whisper') {
      value.adjudication.concealment.sense = "hearing";
      value.adjudication.concealment.evidence = "听见外乡人对米拉低声问阀门是否该换。";
      value.proposals = [talk(MIRA, { withFailure: true })];
    }
    value.basisRefs = [SOURCE, MIRA, LIAN];
    const text = "我听到了，有话可以直接说。";
    if (withReply) {
      const reply = talk(LIAN);
      reply.outcomeBinding = "onFailure";
      reply.branches.success.response.text = text;
      reply.branches.success.summary = "莉安出声回应察觉到的举动。";
      reply.branches.success.npcPerceives = extraSight ? "外乡人抬眼看向莉安。" : null;
      value.proposals.push(reply);
    }
    const lowered = lower(f, value); assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    for (const roll of [1, 20]) {
      const result = resolve(f, lowered.command.rulesInput, roll);
      assert.equal(result.events.some(event => event.eventType === "SourceClaimCreated"
        && event.payload.speakerId === LIAN && event.payload.semanticContent === text), withReply && roll === 1);
      const primary = result.noticed.filter(event => event.payload.characterId === LIAN);
      assert.equal(primary.filter(event => event.payload.publicEvidence === value.adjudication.concealment.evidence).length, roll === 1 ? 1 : 0);
      assert.equal(primary.length, roll === 1 ? (extraSight ? 2 : 1) : 0, 'no copy of noticedEvidence in npcPerceives');
      if (extraSight && roll === 1) assert.deepEqual(primary.map(event => event.payload.sense).sort(), ['hearing', 'sight']);
      assert.equal(result.events.some(event => event.eventType === "NpcReactionOpened" && event.payload.characterId === LIAN), false);
    }
  }
});

// SPEC 0006 §7 (ADR 0110): a conversation the whole scene hears may draw
// bystanders in, but one that already noticed the conversation's own covert
// act has its reaction in this resolution and is not opened a second one.
test("a bystander that noticed a conversation's covert act is not opened a second reaction for hearing it", () => {
  for (const roll of [1, 20]) {
    const f = contextWithObservers(fixture(`heard-and-noticed-${roll}`)), value = bundle({ observers: [
      { observerRef: LIAN, attention: "distracted", basisRefs: [SOURCE] }, { observerRef: VARO, attention: "watching", basisRefs: [SOURCE] }] });
    value.adjudication.concealment.sense = "hearing";
    value.adjudication.concealment.evidence = "听见外乡人对米拉压低声音说话。";
    const word = talk(MIRA, { withFailure: true });
    word.audience = "sceneListeners";
    value.proposals = [word];
    value.basisRefs = [SOURCE, MIRA, LIAN];
    const lowered = lower(f, value); assert.equal(lowered.kind, "accepted", JSON.stringify(lowered).slice(0, 600));
    const result = resolve(f, lowered.command.rulesInput, roll);
    const opened = result.events.filter(event => event.eventType === "NpcReactionOpened");
    const by = Object.fromEntries(opened.map(event => [event.payload.characterId, event.payload.trigger ?? "noticedAct"]));
    assert.equal(Object.keys(by).length, opened.length, `roll ${roll}: no NPC is opened twice`);
    assert.equal(by[LIAN], "heardConversation", `roll ${roll}: Lian, a listener here, may interject`);
    assert.equal(by[VARO], roll === 1 ? "noticedAct" : "heardConversation", `roll ${roll}`);
    assert.equal(opened.filter(event => event.payload.trigger === "heardConversation").length, roll === 1 ? 1 : 2);
  }
});

test("the primary keeps hearing an always-bound question on either roll and gains the concealed act only on failure", () => {
  const f = fixture("primary-talk");
  const frozen = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [SOURCE, LIAN] });
  const value = bundle(); value.basisRefs.push(LIAN); value.proposals.push(talk(LIAN));
  const parsed = parseComplete(value);
  assert.equal(parsed.kind, "accepted");
  const lowered = lowerVNext2ProposalBundle({ ...f, requiredContext: frozen.context, value: parsed.bundle });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  for (const roll of [1, 20]) {
    const result = resolve(f, lowered.command.rulesInput, roll);
    const held = JSON.stringify(result.state.knowledge[LIAN]);
    assert.ok(held.includes(value.proposals[1].actorSpeech), "hearing the question is legitimate on either branch");
    assert.equal(held.includes(value.adjudication.concealment.evidence), roll === 1);
    assert.ok(!result.events.some(event => event.eventType === "NpcReactionOpened" && event.payload.characterId === LIAN));
  }
});

test("a bystander can notice a covert act the primary observer missed", () => {
  const f = fixture("middle");
  const lowered = lower(f, bundle()); assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const middle = resolve(f, lowered.command.rulesInput, 8);
  assert.equal(middle.branch, "success", "8 meets Lian's 5");
  assert.deepEqual(middle.check.noticerRefs, [MIRA], "8 misses Mira's 10");
});

test("the primary observer must be present and able to see, and a declared absentee adds no one", () => {
  const f = fixture("primary");
  const absent = lower(f, bundle({ primary: "npc:nobody-here" }));
  assert.equal(absent.kind, "rejected");
  assert.ok(JSON.stringify(absent).includes("concealment:primary-observer-not-present"), JSON.stringify(absent));
  const unseen = lower(f, bundle({ observers: [{ observerRef: LIAN, attention: "unseen", basisRefs: [SOURCE] }] }));
  assert.equal(unseen.kind, "rejected");
  assert.ok(JSON.stringify(unseen).includes("concealment:primary-observer-cannot-see"), JSON.stringify(unseen));
  const extra = lower(f, bundle({ observers: [{ observerRef: LIAN, attention: "watching", basisRefs: [SOURCE] },
    { observerRef: "npc:somewhere-else", attention: "watching", basisRefs: [SOURCE] }] }));
  assert.equal(extra.kind, "accepted", JSON.stringify(extra));
  assert.deepEqual(checkOf(extra.command.rulesInput).concealment.observers.map(observer => observer.observerRef), [LIAN, MIRA, VARO]);
  assert.equal(checkOf(extra.command.rulesInput).dc, "15", "Lian watching: 10 + 5");
});

test("Rules refuses a covert check whose frozen DC or observers differ from authority", () => {
  const f = fixture("tampered");
  const lowered = lower(f, bundle()); assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const tamper = (edit) => {
    const input = structuredClone(lowered.command.rulesInput);
    edit(checkOf(input));
    return stepActionToDecision(f.runtime, f.profiles, f.state, input);
  };
  const lowerDc = tamper(check => { check.dc = "4"; });
  assert.equal(lowerDc.kind, "rejected", JSON.stringify(lowerDc));
  const dropped = tamper(check => { check.concealment.observers = check.concealment.observers.filter(o => o.observerRef !== MIRA); });
  assert.equal(dropped.kind, "rejected", JSON.stringify(dropped));
});

// SPEC 0005 §6.2: the actor is told neither that the covert act was noticed
// nor that it was not; a failed covert check is not a failed act. What the
// actor learns is the branch's own evidence, where the primary reacts.
test("the actor's claims tell no check result for a covert act, only what the branch lets the actor perceive", () => {
  const f = fixture("claims");
  const lowered = lower(f, bundle()); assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  for (const [roll, perceived] of [[1, "阀门松开了，莉安看向你的手"], [20, "阀门松开了，没有人出声"]]) {
    const low = resolve(f, lowered.command.rulesInput, roll);
    const view = f.runtime.project(f.profiles, low.state, f.viewer, { committedRange: committedActionRange(low.state,
      { receiptId: low.receiptId, actorCharacterId: ACTOR, priorState: f.state, events: low.events }) });
    assert.equal(view.kind, "projected", JSON.stringify(view));
    const claims = view.renderableClaims.claims;
    const interaction = claims.find(claim => claim.kind === "mechanicalOutcome" && claim.outcomeKind === "worldInteraction");
    assert.equal(interaction.outcomeCode, "applied");
    assert.equal(Object.hasOwn(interaction, "check"), false);
    const facts = claims.flatMap(claim => claim.narrationFacts);
    assert.deepEqual(facts.filter(fact => /检定|难度|察觉|总值/.test(fact)), [], `roll ${roll}`);
    assert.ok(facts.includes(perceived), JSON.stringify(facts));
  }
});

// SPEC 0005 §6.2 (ADR 0062): the default tier comes from state; a declared
// tier cites a record, or the filling is corrected and Rules refuses it.
test("a busy candidate is distracted by default, and a declared tier without a cited record is refused", () => {
  const f = fixture("defaults");
  const bare = parseComplete(
    bundle({ observers: [{ observerRef: LIAN, attention: "distracted", basisRefs: [] }] }));
  assert.equal(bare.kind, "locallyRejected", "the filling is sent back for correction");
  assert.deepEqual(bare.diagnostics.map(diagnostic => diagnostic.path), [["adjudication", "concealment", "observers", 0, "basisRefs"]]);
  const lowered = lower(f, bundle()); assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const tampered = structuredClone(lowered.command.rulesInput);
  checkOf(tampered).concealment.observers.find(observer => observer.observerRef === LIAN).basisRefs = [];
  const refused = stepActionToDecision(f.runtime, f.profiles, f.state, tampered);
  assert.equal(refused.kind, "rejected", "distracted without a record");
  // Mira starts a long rest: Rules now assumes distracted for her with no
  // declaration, and the KP lowering freezes the same.
  const resting = f.runtime.step(f.profiles, f.state, { kind: "startRest", proposalId: `${f.rootActionId}:mira-rest`, characterId: MIRA, restKind: "long" });
  assert.equal(resting.kind, "committed", JSON.stringify(resting));
  assert.equal(defaultConcealmentAttention(resting.state, MIRA), "distracted");
  const root = `${f.rootActionId}:after-rest`;
  const frozen = freezeAuthoredProbeContext(f, resting.state, { rootActionId: root, focusRefs: [SOURCE, MIRA] });
  const parsed = parseComplete(bundle());
  const busy = lowerVNext2ProposalBundle({ ...f, state: resting.state, requiredContext: frozen.context, rootActionId: root, value: parsed.bundle });
  assert.equal(busy.kind, "accepted", JSON.stringify(busy));
  const observers = checkOf(busy.command.rulesInput).concealment.observers;
  assert.deepEqual(observers.map(({ observerRef, attention }) => [observerRef, attention]), [[LIAN, "distracted"], [MIRA, "distracted"], [VARO, "unseen"]]);
  assert.deepEqual(observers, frozenConcealmentObservers(f.profiles, resting.state, ACTOR, "sight", bundle().adjudication.concealment.observers));
});

// SPEC 0016 §7 with SPEC 0005 §6.2: a covert act and a word to a bystander
// in one Bundle. On the failure branch the bystander perceives the act before
// the talk; the reply, decided before that perception, still stands and the
// Bundle commits either way.
test("a covert act followed by a word to a bystander who may notice it still commits", () => {
  const f = fixture("talk-to-bystander");
  const root = `${f.rootActionId}:talk`;
  const frozen = freezeAuthoredProbeContext(f, f.state, { rootActionId: root, focusRefs: [SOURCE, MIRA] });
  const covert = bundle();
  const social = { kind: "social", basisRefs: [MIRA], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE, npcRef: MIRA,
    actorSpeech: "米拉，你看这阀门是不是该换了？", goal: "把米拉的注意力引到阀门上。", method: "随口一问。",
    communication: "spokenConversation", audience: "participants",
    branches: { success: { outcomeCode: "outcome:mira-answers", summary: "米拉答了一句。", npcPerceives: null,
      response: { kind: "speech", text: "早该换了。", motive: "顺口回答。", basis: [{ kind: "npcContext", ref: MIRA }] }, consequences: [] }, failure: { kind: "none" } } };
  const parsed = parseComplete({ ...covert, basisRefs: [SOURCE, MIRA], proposals: [...covert.proposals, social] });
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed).slice(0, 500));
  const lowered = lowerVNext2ProposalBundle({ ...f, requiredContext: frozen.context, rootActionId: root, value: parsed.bundle });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered).slice(0, 600));
  for (const roll of [1, 20]) {
    const pending = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
    assert.equal(pending.kind, "awaitingRandomness", `roll ${roll}: ${JSON.stringify(pending).slice(0, 400)}`);
    const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
      continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls: [roll] });
    assert.equal(result.kind, "committed", `roll ${roll}: ${JSON.stringify(result).slice(0, 400)}`);
    const events = [...pending.events, ...result.events];
    const noticed = events.some(event => event.eventType === "SensoryEvidenceAcquired" && event.payload.characterId === MIRA
      && event.payload.publicEvidence === "看见有人在阀门旁偷偷动手。");
    assert.equal(noticed, roll === 1, `roll ${roll}: Mira notices only the low roll`);
    assert.ok(events.some(event => event.eventType === "WorldInteractionResolved" && event.payload.social !== undefined), "the word to Mira resolved");
    const replayed = f.runtime.replay(f.genesis, events);
    assert.equal(replayed.kind, "replayed", `roll ${roll}: ${JSON.stringify(replayed).slice(0, 400)}`);
    assert.deepEqual(replayed.state, result.state, `roll ${roll}: replay rebuilds the same state`);
  }
});

// SPEC 0005 §6.2, SPEC 0016 §7.3 (ADR 0066): the step under a concealed check
// is the act hidden from the primary observer. Rounds 137 and 146 hung the
// covert leaf-taking's roll on the question put to Lian herself.
function talk(npcRef, { withFailure = false } = {}) {
  const reply = (suffix, text) => ({ outcomeCode: `outcome:${suffix}`, summary: `${text}。`, npcPerceives: null,
    response: { kind: "speech", text, motive: "顺口回答。", basis: [{ kind: "npcContext", ref: npcRef }] }, consequences: [] });
  return { kind: "social", basisRefs: [npcRef], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE, npcRef,
    actorSpeech: "你看这阀门是不是该换了？", goal: "把对方的注意力引到阀门上。", method: "随口一问。",
    communication: "spokenConversation", audience: "participants",
    branches: { success: reply("answers", "早该换了"), failure: withFailure ? reply("deflects", "这会儿别提阀门") : { kind: "none" } } };
}
test("a concealed check cannot ride on the conversation with its own primary observer, while a whisper to someone else may", () => {
  const f = fixture("talk-is-not-the-hidden-act");
  const covert = bundle();
  // The roll moves from the covert act to the question put to Lian: the act
  // loses its failure branch and the talk gains one, so the talk owns the check.
  const act = { ...covert.proposals[0], branches: { success: covert.proposals[0].branches.success, failure: null } };
  const onLian = { ...covert, basisRefs: [SOURCE, LIAN], proposals: [act, talk(LIAN, { withFailure: true })] };
  // SPEC 0016 §7.2: this ruling-only contradiction is known before paying
  // for an NPC reply or its review, and must enter the ordinary local repair.
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(onLian)));
  assert.equal(parsed.kind, "locallyRejected", JSON.stringify(parsed).slice(0, 400));
  assert.deepEqual(parsed.issues, ["concealment:hidden-act-is-not-the-talk-with-its-observer"]);
  const [detail] = parsed.diagnostics;
  assert.deepEqual(detail.path, ["proposals", 1], "the step under check is named");
  assert.deepEqual(detail.actual, { type: "string", value: LIAN });
  assert.equal(detail.expected.primaryObserverRef, LIAN);
  assert.match(detail.expected.requirement, /worldInteraction/);
  // The same words whispered to Mira, hidden from Lian, are not that contradiction.
  const onMira = { ...covert, basisRefs: [SOURCE, MIRA], proposals: [act, talk(MIRA, { withFailure: true })] };
  const frozenMira = freezeAuthoredProbeContext(f, f.state, { rootActionId: `${f.rootActionId}:talk-mira`, focusRefs: [SOURCE, MIRA] });
  const parsedMira = parseComplete(onMira);
  assert.equal(parsedMira.kind, "accepted", JSON.stringify(parsedMira).slice(0, 400));
  const loweredMira = lowerVNext2ProposalBundle({ ...f, requiredContext: frozenMira.context, rootActionId: `${f.rootActionId}:talk-mira`, value: parsedMira.bundle });
  assert.ok(!(loweredMira.issues ?? []).includes("concealment:hidden-act-is-not-the-talk-with-its-observer"), JSON.stringify(loweredMira).slice(0, 400));
});

// Round 147 wrote a bystander's perception under recordKind effects and, told
// only the effect shapes, deleted it. A record with an observer and evidence is
// named as the perception it is, at its place.
test("a perception written as an effect is refused as a perception, naming the record kind it belongs to", () => {
  const internal = bundle();
  internal.proposals[0].branches.success.effects = [{ observerRef: LIAN, subjectRef: SOURCE, sense: "sight", evidence: "莉安看见有人在阀门旁动手。", basisRefs: [SOURCE] }];
  const parsed = parseComplete(internal);
  assert.equal(parsed.kind, "locallyRejected", JSON.stringify(parsed).slice(0, 300));
  const detail = parsed.diagnostics.find(entry => entry.constraint === "world-effect-is-a-perception");
  assert.ok(detail, JSON.stringify(parsed.diagnostics).slice(0, 400));
  assert.deepEqual(detail.path.slice(-4), ["branches", "success", "effects", 0]);
  assert.equal(detail.expected.recordKind, "sensoryEvidence");
  assert.ok(!parsed.diagnostics.some(entry => entry.constraint === "world-effect-contract"), "the generic effect shapes are not offered for a perception");
});

function concealedInventoryFixture(label, { held = false } = {}) {
  const f = fixture(`inventory-${label}`), entryRef = `item-entry:concealed-test:${label}`;
  const created = f.runtime.step(f.profiles, f.state, { kind: "materializeItem", proposalId: `${f.rootActionId}:seed`,
    actorCharacterId: ACTOR, definition: itemDefinitionFromStandardGear(itemById("bolt")), entryId: entryRef,
    quantity: 5, sceneId: SCENE });
  assert.equal(created.kind, "committed", JSON.stringify(created).slice(0, 1500));
  let state = created.state;
  const setupEvents = [...created.events];
  if (!held) {
    const refs = [ACTOR, entryRef, SCENE, SOURCE];
    const released = f.runtime.step(f.profiles, state, { kind: "inventoryOperation", rootActionId: `${f.rootActionId}:place`,
      actorCharacterId: ACTOR, plan: { schema: "zhuwei.inventory-operation-plan/vnext-1",
        contextHash: `sha256:${"c".repeat(64)}`, readSet: refs.map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(state, ref) })),
        basisRefs: [SOURCE], summary: "把弩矢放在阀门旁。",
        operation: { kind: "release", entryRef, quantity: 5, sceneRef: SCENE, releaseKind: "placement" } } });
    assert.equal(released.kind, "committed", JSON.stringify(released).slice(0, 1500));
    setupEvents.push(...released.events); state = released.state;
  }
  const frozen = freezeAuthoredProbeContext(f, state, { rootActionId: f.rootActionId, focusRefs: [SOURCE, LIAN, entryRef],
    intentText: held ? "借转阀门掩饰手部动作，失败时弩矢会损坏或掉落。" : "趁莉安不注意取走阀门旁的弩矢。" });
  return { ...f, state, requiredContext: frozen.context, entryRef, setupEvents };
}

function concealedInventoryBundle(f, outcomeBinding, operation) {
  const value = bundle();
  value.basisRefs.push(f.entryRef);
  Object.assign(value.proposals[0], { basisRefs: [SOURCE, f.entryRef], targetRefs: [SOURCE, f.entryRef],
    directTargetRefs: [SOURCE, f.entryRef] });
  value.proposals.push({ kind: "inventoryOperation", basisRefs: [f.entryRef], consumes: [], produces: [], outcomeBinding,
    operation, summary: "按该分支结算实际物品变化。" });
  return value;
}

function resolveConcealedInventory(f, input, roll) {
  const pending = stepActionToDecision(f.runtime, f.profiles, f.state, input);
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending).slice(0, 2000));
  const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
    continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls: [roll] });
  assert.equal(result.kind, "committed", JSON.stringify(result).slice(0, 2000));
  const replayed = f.runtime.replay(f.genesis, [...f.setupEvents, ...pending.events, ...result.events]);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed).slice(0, 2000));
  assert.deepEqual(replayed.state, result.state);
  return result;
}

// SPEC 0016 §7.3: scene placement does not waive the concealed target's success binding.
test("concealed scene-item acquisition rejects always and failure bindings before activity or randomness", () => {
  for (const outcomeBinding of ["always", "onFailure"]) {
    const f = concealedInventoryFixture(`refuse-${outcomeBinding}`), before = structuredClone(f.state);
    const lowered = lower(f, concealedInventoryBundle(f, outcomeBinding, { kind: "acquire", entryRef: f.entryRef, quantity: 2 }));
    assert.equal(lowered.kind, "accepted", JSON.stringify(lowered).slice(0, 2000));
    const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
    assert.equal(result.kind, "rejected", JSON.stringify(result).slice(0, 2000));
    assert.equal(result.rejection.message, "concealment:target-acquisition-requires-on-success");
    const value = concealedInventoryBundle(f, outcomeBinding, { kind: "acquire", entryRef: f.entryRef, quantity: 2 });
    const wire = encodeVNextStrictToolBundle(value);
    const candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wire));
    assert.equal(candidate.kind, "accepted");
    const diagnostics = vnextRulesRevisionDiagnostics(result, { bundle: candidate.bundle, rulesInput: lowered.command.rulesInput });
    assert.deepEqual(proposalFillingDiagnostics(candidate.bundle, diagnostics, wire).map(d => d.path),
      [["steps", "inventoryOperation", 0, "outcomeBinding"]], "diagnostic maps execution order back to the original filling");
    const unknownShell = structuredClone(result);
    unknownShell.rejection.diagnostics[0].path = result.rejection.diagnostics[0].path.replace('/outcomeBinding', '/basisRefs/0');
    const unknown = vnextRulesRevisionDiagnostics(unknownShell, { bundle: candidate.bundle, rulesInput: lowered.command.rulesInput });
    assert.deepEqual(proposalFillingDiagnostics(candidate.bundle, unknown, wire).map(d => d.path),
      [["steps", "inventoryOperation", 0]], "an unknown shell field cannot impersonate the same-named body field");
    assert.equal(result.randomnessRequest, undefined);
    assert.deepEqual(result.events, []);
    assert.deepEqual(f.state, before);
  }
});

test("concealed onSuccess acquisition preserves both roll branches and partial stack quantities", () => {
  const f = concealedInventoryFixture("partial-success");
  const lowered = lower(f, concealedInventoryBundle(f, "onSuccess", { kind: "acquire", entryRef: f.entryRef, quantity: 2 }));
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered).slice(0, 2000));
  for (const roll of [1, 20]) {
    const result = resolveConcealedInventory(f, lowered.command.rulesInput, roll);
    const entries = Object.values(result.state.campaignRuntime.itemSystem.entries)
      .filter(entry => entry.definitionRef === f.state.campaignRuntime.itemSystem.entries[f.entryRef].definitionRef);
    assert.equal(entries.reduce((total, entry) => total + entry.quantity, 0), 5);
    assert.equal(entries.filter(entry => entry.holderRef === ACTOR).reduce((total, entry) => total + entry.quantity, 0), roll === 20 ? 2 : 0);
    assert.equal(entries.filter(entry => entry.disposition === "scene").reduce((total, entry) => total + entry.quantity, 0), roll === 20 ? 3 : 5);
    const applied = result.events.filter(event => event.eventType === "InventoryOperationApplied");
    assert.equal(applied.length, roll === 20 ? 1 : 0);
  }
});

test("concealed failure may still damage or drop the actor's directly targeted item", () => {
  for (const mode of ["lifecycle", "release"]) {
    const f = concealedInventoryFixture(`failure-${mode}`, { held: true });
    const operation = mode === "lifecycle" ? { kind: "lifecycle", entryRef: f.entryRef, action: "break" }
      : { kind: "release", entryRef: f.entryRef, quantity: 2, sceneRef: SCENE, releaseKind: "loss" };
    const lowered = lower(f, concealedInventoryBundle(f, "onFailure", operation));
    assert.equal(lowered.kind, "accepted", JSON.stringify(lowered).slice(0, 2000));
    const result = resolveConcealedInventory(f, lowered.command.rulesInput, 1);
    const applied = result.events.filter(event => event.eventType === "InventoryOperationApplied");
    assert.equal(applied.length, 1);
    assert.deepEqual(applied[0].payload.operation, operation);
    if (mode === "lifecycle") assert.equal(result.state.campaignRuntime.itemSystem.entries[f.entryRef].condition, "broken");
    else {
      const entries = Object.values(result.state.campaignRuntime.itemSystem.entries);
      assert.equal(entries.filter(entry => entry.holderRef === ACTOR).reduce((total, entry) => total + entry.quantity, 0), 3);
      assert.equal(entries.filter(entry => entry.disposition === "scene").reduce((total, entry) => total + entry.quantity, 0), 2);
    }
  }
});
