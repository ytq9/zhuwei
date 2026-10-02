import assert from "node:assert/strict";
import test from "node:test";
import { committedActionRange, stepActionToDecision } from "../../support/fixtures/vnext-action-lifecycle.mjs";
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { isVNextRulingPrecedent } from "../../../app/_runtime/lib/rules/shapes.ts";
import { sharedCheckBundle as bundle } from "../../support/fixtures/vnext-shared-check.mjs";

// SPEC 0004 §11 (ADR 0083): a check outside a conversation is recorded once,
// by its own resolution, as a precedent of its scene; the KP reads it, a
// player does not, and correcting the action takes it back.
function lower(f, wire) {
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(wire)));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  const lowered = lowerVNext2ProposalBundle({ ...f, value: parsed.bundle });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  return lowered.command.rulesInput;
}
const precedents = state => Object.values(state.campaignRuntime.adjudicationPrecedents).filter(isVNextRulingPrecedent);
function correct(f, events, targetReceiptId) {
  const prior = f.runtime.replay(f.genesis, events, { retainCorrectionAudit: true });
  assert.equal(prior.kind, "replayed", JSON.stringify(prior));
  return stepActionToDecision(f.runtime, f.profiles, prior.state, { kind: "applyServiceCorrection", correctionAuthority: {
    kind: "roomCorrectionAuthority", capability: prior.state.correctionRuntime.authorityCapability },
    correctionId: "correction:precedent", targetReceiptId, actorCharacterId: ACTOR, errorKind: "rulesMisapplication",
    publicExplanation: "该次裁决有误，恢复裁决前状态。", basis: { eventSeq: prior.head.eventSeq, lastEventId: prior.head.lastEventId } });
}

test("a freshly admitted check records its ruling once as a precedent of its scene", () => {
  for (const [ownerKind, roll] of [["worldInteraction", 1], ["observe", 20]]) {
    const f = createAuthoredProbeFixture(`precedent-${ownerKind}-${roll}`);
    const pending = stepActionToDecision(f.runtime, f.profiles, f.state, lower(f, bundle(ownerKind)));
    assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
    assert.deepEqual(precedents(pending.state), [], "nothing is recorded before the roll");
    const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
      continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls: [roll] });
    assert.equal(result.kind, "committed", JSON.stringify(result));
    const resolved = result.events.find(event => event.eventType === "WorldInteractionResolved" && event.payload.rulingKind === "check");
    // One precedent, right after the check it records; the direct sibling records nothing.
    const recorded = result.events.filter(event => event.eventType === "AdjudicationPrecedentRecorded");
    assert.equal(recorded.length, 1);
    assert.equal(result.events[result.events.indexOf(resolved) + 1], recorded[0]);
    assert.equal(recorded[0].secrecy, "internal");
    assert.equal(recorded[0].visibilityPolicyId, "visibility:room-authority-only");
    const [record] = precedents(result.state);
    assert.equal(precedents(result.state).length, 1);
    assert.deepEqual(record, { ...recorded[0].payload, status: "active", rootActionId: resolved.rootActionId, recordedEventSeq: recorded[0].eventSeq });
    assert.equal(record.rulingEventId, resolved.eventId);
    assert.deepEqual(record.conditionSignature, { schema: "zhuwei.precedent-condition-signature/vnext-1", scope: { kind: "scene", ref: SCENE },
      formId: ownerKind === "observe" ? "observe.vnext-1" : "world-interaction.vnext-1",
      targetRefs: resolved.payload.targetRefs, instrumentRefs: resolved.payload.instrumentRefs });
    assert.equal(record.actorCharacterId, ACTOR);
    assert.equal(record.canonicalContextFingerprint, resolved.payload.contextHash);
    assert.equal(record.publicExplanation, resolved.payload.summary);
    assert.deepEqual(record.privateBasisRefs, resolved.payload.basisRefs);
    assert.deepEqual(record.rulesetProfile, f.profiles.ruleset);
    assert.equal(record.ruling.kind, "check");
    assert.equal(record.ruling.resolutionId, resolved.payload.resolutionId);
    assert.equal(record.ruling.dc, resolved.payload.check.dc);
    assert.equal(record.ruling.outcome, roll === 20 ? "success" : "failure");
    assert.match(record.ruling.durationMicros, /^[1-9][0-9]*$/u, "the act froze its duration");
    assert.deepEqual(Object.keys(record.ruling.outcomeRange), ["success", "failure"]);
    const events = [...pending.events, ...result.events];
    const replayed = f.runtime.replay(f.genesis, events);
    assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
    assert.deepEqual(replayed.state, result.state);
    // The player sees no precedent.
    const projected = f.runtime.project(f.profiles, result.state, f.viewer, { channel: "realtime", committedRange: committedActionRange(result.state, {
      receiptId: result.receipt.receiptId, actorCharacterId: ACTOR, priorState: f.state, events }) });
    assert.equal(projected.kind, "projected", JSON.stringify(projected));
    assert.ok(!JSON.stringify(projected).includes(record.precedentId));
    // Correcting the action takes its precedent back with it.
    const corrected = correct(f, events, result.receipt.receiptId);
    assert.equal(corrected.kind, "committed", JSON.stringify(corrected));
    assert.deepEqual(precedents(corrected.state), []);
  }
});

test("a precedent must say what the check it follows said", () => {
  const f = createAuthoredProbeFixture("precedent-forged");
  const pending = stepActionToDecision(f.runtime, f.profiles, f.state, lower(f, bundle("worldInteraction")));
  const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
    continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls: [1] });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  for (const forge of [payload => { payload.ruling.dc += 1; }, payload => { payload.ruling.outcome = "success"; },
    payload => { payload.publicExplanation = "换了一种说法。"; }, payload => { payload.privateBasisRefs = []; }]) {
    const events = structuredClone([...pending.events, ...result.events]);
    forge(events.find(event => event.eventType === "AdjudicationPrecedentRecorded").payload);
    assert.equal(f.runtime.replay(f.genesis, events).kind, "rejected");
  }
});
