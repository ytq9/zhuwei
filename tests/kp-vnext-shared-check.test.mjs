import { committedActionRange } from './fixtures/vnext-action-lifecycle.mjs';
import { atomicCompletionInput } from './fixtures/vnext-action-duration.mjs';
import { stepActionToDecision } from './fixtures/vnext-action-lifecycle.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, PROBE_SOURCE as SOURCE, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { deriveVNextProposalBundlePlan } from "../app/_runtime/lib/kp/vnext/proposal-graph.ts";

import { sharedCheckBundle as bundle } from "./fixtures/vnext-shared-check.mjs";

function parse(wire) { return parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(wire))); }
function lower(f, wire) {
  const parsed = parse(wire); assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  return lowerVNext2ProposalBundle({ ...f, value: parsed.bundle });
}

test("a single observation or interaction check governs direct physical siblings through graph, Rules and replay", () => {
  for (const ownerKind of ["observe", "worldInteraction"]) for (const roll of [1, 20]) {
    const f = createAuthoredProbeFixture(`shared-${ownerKind}-${roll}`), wire = bundle(ownerKind);
    const parsed = parse(wire); assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
    const graph = deriveVNextProposalBundlePlan({ bundle: parsed.bundle, rootActionId: f.rootActionId,
      actorCharacterId: ACTOR, contextHash: f.requiredContext.binding.contextHash, readSet: [] });
    assert.equal(graph.kind, "accepted", JSON.stringify(graph));
    assert.equal(graph.plan.sharedCheckEntryRef, graph.plan.entries[1].entryRef);
    assert.equal(graph.plan.executionOrder[0], graph.plan.sharedCheckEntryRef);
    const lowered = lower(f, wire); assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    const input = lowered.command.rulesInput;
    assert.equal(atomicCompletionInput(input).steps.filter(step => step.rulesInput.plan.ruling.kind === "check").length, 1);
    assert.equal(atomicCompletionInput(input).steps[0].formId, ownerKind === "observe" ? "observe.vnext-1" : "world-interaction.vnext-1");
    const pending = stepActionToDecision(f.runtime, f.profiles, f.state, input);
    assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
    assert.equal(pending.state.campaignRuntime.definitions[SOURCE].content.observableState, "ready");
    assert.equal(pending.randomnessRequest.dice.length, 1);
    const saved = f.runtime.replay(f.genesis, pending.events);
    assert.equal(saved.kind, "replayed"); assert.deepEqual(saved.state, pending.state);
    const result = f.runtime.step(f.profiles, saved.state, { kind: "fulfillAuthoritativeRandomness",
      continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls: [roll] });
    assert.equal(result.kind, "committed", JSON.stringify(result));
    assert.equal(result.state.campaignRuntime.definitions[SOURCE].content.observableState, roll === 20 ? "opened" : "jammed");
    const endings = result.events.filter(event => event.eventType === "WorldInteractionResolved");
    assert.equal(endings.length, 2); assert.equal(endings.filter(event => event.payload.rulingKind === "check").length, 1);
    const events = [...pending.events, ...result.events];
    const replayed = f.runtime.replay(f.genesis, events);
    assert.equal(replayed.kind, "replayed", JSON.stringify(replayed)); assert.deepEqual(replayed.state, result.state);
    const projected = f.runtime.project(f.profiles, result.state, f.viewer, { channel: "realtime", committedRange: committedActionRange(result.state, {
      receiptId: result.receipt.receiptId, actorCharacterId: ACTOR, priorState: f.state, events }) });
    assert.equal(projected.kind, "projected", JSON.stringify(projected));
    assert.ok(projected.renderableClaims.claims.some(claim => claim.outcomeKind === ownerKind));
    const outcomes = projected.renderableClaims.claims.filter(claim => claim.kind === "mechanicalOutcome");
    assert.equal(outcomes.filter(claim => claim.outcomeCode === "applied").length, 1);
    assert.equal(outcomes.filter(claim => claim.outcomeCode === (roll === 20 ? "success" : "failure")).length, 1);
    assert.equal(outcomes.some(claim => JSON.stringify(claim.narrationFacts).includes("直接成功")), false);
    assert.equal(stepActionToDecision(f.runtime, f.profiles, result.state, input).rejection.code, "duplicateRootAction");
  }
});

test("zero or multiple true failure owners and a conditional owner are rejected before lowering", () => {
  for (const mutate of [
    wire => { wire.proposals[1].branches.failure = { kind: "none" }; },
    wire => { wire.proposals[0].branches.failure = structuredClone(wire.proposals[0].branches.success); },
    wire => { wire.proposals[1].outcomeBinding = "onSuccess"; },
  ]) { const wire = bundle(); mutate(wire); assert.notEqual(parse(wire).kind, "accepted"); }
});

test("the unselected direct sibling is still fully preflighted before the shared random request", () => {
  const f = createAuthoredProbeFixture("shared-invalid-failure");
  const wire = bundle(); wire.proposals[2].branches.success.effects[0].definitionRef = "definition:unavailable";
  assert.equal(lower(f, wire).kind, "rejected");
  const lowered = lower(f, bundle()); assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const input = structuredClone(lowered.command.rulesInput);
  const failure = atomicCompletionInput(input).steps.find(step => step.outcomeBinding === "onFailure");
  failure.rulesInput.plan.readSet[0].revisionOrHash = `sha256:${"0".repeat(64)}`;
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, input);
  assert.equal(result.kind, "rejected"); assert.equal(result.randomnessRequest, undefined);
});
