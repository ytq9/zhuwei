import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE,
  PROBE_TARGET as ALLY } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { committedActionRange, stepActionToDecision } from "../../support/fixtures/vnext-action-lifecycle.mjs";
import { atomicCompletionInput } from "../../support/fixtures/vnext-action-duration.mjs";

// SPEC 0004 §4 (ADR 0099): outside an encounter, help is a common action.
// The KP judges whether the actor can help; when it can, the ally's next act
// rolls its ability checks with advantage, and the help is gone after it.

const VALVE = "feature:probe-valve";
const outcome = (code, summary) => ({ outcomeCode: `outcome:${code}`, summary, effects: [], sensoryEvidence: [], pressures: [], opportunities: [] });
const direct = { kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。", successOutcome: "搭了把手。" };
const athletics = { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "str", skill: "athletics", dc: 15,
  mode: "normal", risk: "阀门锈死了。", successOutcome: "阀门转开了。", failureOutcome: "阀门纹丝不动。" };

function step(adjudication, fields) {
  return { mode: "adjudication", basisRefs: [VALVE], terminal: { kind: "none" }, adjudication,
    proposals: [{ basisRefs: [VALVE], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "动手。", method: "用力。", targetRefs: [], directTargetRefs: [], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: outcome("done", "成了。"), failure: adjudication.kind === "check" ? outcome("failed", "没成。") : null }, ...fields }] };
}
const help = step(direct, { intent: "帮队友一起拧阀门。", commonAction: { kind: "help", targetRef: ALLY, destinationRef: null, option: "none" } });
const turnValve = adjudication => step(adjudication, { intent: "拧开阀门。", targetRefs: [VALVE], directTargetRefs: [VALVE] });

/** `who`'s act from `state`, with its own frozen context. */
function as(f, who, state, suffix) {
  const next = { ...f, state, actorCharacterId: who, rootActionId: `${f.rootActionId}:${suffix}` };
  return { ...next, requiredContext: freezeAuthoredProbeContext(next, state, { rootActionId: next.rootActionId, focusRefs: [VALVE, ALLY] }).context };
}

function lower(f, bundle) {
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle)));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  return lowerVNext2ProposalBundle({ ...f, value: parsed.bundle });
}

function act(f, bundle, rolls) {
  const lowered = lower(f, bundle);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const pending = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  if (pending.kind === "committed") return pending;
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
    continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return { ...result, events: [...pending.events, ...result.events] };
}

const helped = (state, id = ALLY) => state.combatRuntime.entities[id].conditions?.helped;
const checkOf = events => events.filter(event => event.eventType === "WorldInteractionResolved").at(-1).payload.check;

test("help by script: the walk to the ally and the help are filled in; helping takes no roll", () => {
  const f = as(createAuthoredProbeFixture("help-lowering"), ACTOR, createAuthoredProbeFixture("help-lowering").state, "help");
  const lowered = lower(f, help);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const plan = atomicCompletionInput(lowered.command.rulesInput).steps[0].rulesInput.plan;
  assert.deepEqual(plan.approach, { kind: "nextTo", ref: ALLY });
  assert.deepEqual(plan.branches.success.effects, [{ kind: "grantHelp", allyRef: ALLY }]);
  const rolled = lower(f, step(athletics, { commonAction: { kind: "help", targetRef: ALLY, destinationRef: null, option: "none" } }));
  assert.equal(rolled.kind, "rejected");
  assert.deepEqual(rolled.diagnostics.map(entry => entry.constraint), ["commonAction:no-roll"]);
});

test("the ally's next act rolls its check with advantage and spends the help; an act without a check lets it lapse", () => {
  const base = createAuthoredProbeFixture("help-flow");
  const given = act(as(base, ACTOR, base.state, "help"), help, []);
  assert.deepEqual(helped(given.state), [{ helperRef: ACTOR, kind: "check" }]);
  const view = base.runtime.project(base.profiles, given.state, base.viewer, { channel: "realtime", committedRange: committedActionRange(given.state, {
    receiptId: given.receipt.receiptId, actorCharacterId: ACTOR, priorState: base.state, events: given.events }) });
  assert.ok(view.kind === "projected" && view.renderableClaims.claims.some(claim => claim.outcomeCode === "helpGiven"),
    JSON.stringify(view.kind === "projected" ? view.renderableClaims.claims.map(claim => claim.outcomeCode) : view));
  assert.equal(base.runtime.replay(base.genesis, given.events).kind, "replayed");

  // Two d20, the higher kept: 4 and 17 make 17 + the ally's modifier.
  const turned = act(as(base, ALLY, given.state, "turn"), turnValve(athletics), [4, 17]);
  const check = checkOf(turned.events);
  assert.deepEqual([check.rolls, check.selectedRoll], [[4, 17], 17]);
  assert.equal(helped(turned.state), undefined);
  assert.equal(base.runtime.replay(base.genesis, [...given.events, ...turned.events]).kind, "replayed");

  // Without a check the help is gone after the ally's next act all the same.
  const lapsed = act(as(base, ALLY, given.state, "look"), turnValve(direct), []);
  assert.equal(helped(lapsed.state), undefined);
  // Nobody helps themself.
  const self = lower(as(base, ACTOR, base.state, "self"), step(direct, { commonAction: { kind: "help", targetRef: ACTOR, destinationRef: null, option: "none" } }));
  assert.equal(self.kind, "rejected", JSON.stringify(self));
});
