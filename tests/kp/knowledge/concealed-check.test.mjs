import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { concealmentDc, frozenConcealmentObservers } from "../../../app/_runtime/lib/rules/v2/concealment.ts";
import { committedActionRange, stepActionToDecision } from "../../support/fixtures/vnext-action-lifecycle.mjs";
import { atomicCompletionInput } from "../../support/fixtures/vnext-action-duration.mjs";

const PEER = "character:probe-target", LIAN = "npc:concealment-lian", VARO = "npc:concealment-varo", SOURCE = "definition:probe-valve";

function fixture(name) {
  return createAuthoredProbeFixture(`concealed-check:${name}`, { npcCharacters: [{ id: LIAN, name: "莉安" }, { id: VARO, name: "瓦罗" }] });
}

/** A covert act hidden mainly from Lian, who is distracted; Varo cannot see
 * it; the other player is left out and so counts as unfocused. */
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
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(internal)));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  return lowerVNext2ProposalBundle({ ...f, value: parsed.bundle });
}

function checkOf(input) {
  return atomicCompletionInput(input).steps.find(step => step.rulesInput.plan?.ruling?.kind === "check").rulesInput.plan.ruling.check;
}

function resolve(f, input, roll) {
  const pending = stepActionToDecision(f.runtime, f.profiles, f.state, input);
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
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
    [[PEER, "unfocused"], [LIAN, "distracted"], [VARO, "unseen"]]);
  assert.deepEqual(check.concealment.observers, frozenConcealmentObservers(f.profiles, f.state, ACTOR, bundle().adjudication.concealment.observers));
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
  assert.deepEqual(low.check.noticerRefs, [PEER], "the other player's 10 is missed; Varo cannot see");
  assert.deepEqual(low.noticed.map(event => [event.payload.characterId, event.payload.publicEvidence]), [[PEER, "看见有人在阀门旁偷偷动手。"]]);
  assert.equal(low.noticed[0].visibilityPolicyId, `visibility:knowledge-holder:${PEER}`, "only the noticer holds what it saw");
  const actorView = f.runtime.project(f.profiles, low.state, f.viewer);
  assert.equal(actorView.kind, "projected");
  assert.doesNotMatch(JSON.stringify(actorView), /看见有人在阀门旁偷偷动手/, "the actor learns who noticed only from visible reactions");
});

test("a bystander can notice a covert act the primary observer missed", () => {
  const f = fixture("middle");
  const lowered = lower(f, bundle()); assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const middle = resolve(f, lowered.command.rulesInput, 8);
  assert.equal(middle.branch, "success", "8 meets Lian's 5");
  assert.deepEqual(middle.check.noticerRefs, [PEER], "8 misses the other player's 10");
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
  assert.deepEqual(checkOf(extra.command.rulesInput).concealment.observers.map(observer => observer.observerRef), [PEER, LIAN, VARO]);
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
  const dropped = tamper(check => { check.concealment.observers = check.concealment.observers.filter(o => o.observerRef !== PEER); });
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
