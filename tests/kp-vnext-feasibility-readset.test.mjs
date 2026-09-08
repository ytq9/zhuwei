import { stepActionToDecision } from './fixtures/vnext-action-lifecycle.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_SOURCE as SOURCE, PROBE_SCENE as SCENE, PROBE_ZONE as ZONE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { parseSubmitKpProposalBundleCandidateArguments } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { vnext2CommandToRoomLowering, VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE as bridge } from "../app/_runtime/lib/kp/vnext/room-bridge.ts";
import { authorityRevisionOrHash } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { createDefinitionSnapshot, storedSemanticDefinition } from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";
import { itemBundle } from "./fixtures/vnext-authored-bundles.mjs";

const TIMELINE = `character-timeline:${ACTOR}`;
const held = (knowledgeRef) => ({ characterId: ACTOR, knowledgeRef, kind: "sourceClaim", layer: "partial",
  content: "现有记录提到阀门缺少操作条件。", visibility: "private", provenanceChain: ["genesis:valve-note"] });

function refusal(costs = [], basisRefs = [SOURCE], prerequisites = []) {
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify({
    decision: { kind: "inWorldRefusal", basisRefs, intent: "尝试推动阀门。", method: "按实际可行的方式用力尝试。",
      ruling: { kind: "missingPrerequisite", publicBasis: "阀门缺少必要的操作条件。", prerequisites,
        nextActions: [{ description: "检查已有阀门的状况。", basisRefs: [SCENE] }], attemptCosts: costs },
    },
  }));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  return parsed.bundle;
}
function lowered(fixture, value, context = fixture.requiredContext) {
  const result = lowerVNext2ProposalBundle({ ...fixture, value, requiredContext: context });
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  const room = vnext2CommandToRoomLowering(result.command);
  assert.equal(room.kind, "accepted", JSON.stringify(room));
  return room.input;
}
function validate(fixture, input, state = fixture.state) {
  return bridge.validateReadSet({ state, profiles: fixture.profiles, requiredContext: fixture.requiredContext, rulesInput: input });
}
function refreeze(fixture, state, focusRefs = [SOURCE, ZONE]) {
  const requiredContext = freezeAuthoredProbeContext(fixture, state, {
    rootActionId: fixture.rootActionId, focusRefs,
  }).context;
  return { ...fixture, state, requiredContext };
}
function replay(fixture, result, precedingEvents = []) {
  const rebuilt = fixture.runtime.replay(fixture.genesis, [...precedingEvents, ...result.events]);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.deepEqual(rebuilt.state, result.state);
}
function assertConflict(fixture, input, state) {
  assert.equal(validate(fixture, input, state).kind, "conflict");
  const before = structuredClone(state);
  const result = stepActionToDecision(fixture.runtime, fixture.profiles, state, input);
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.rejection.code, "causalFrontierConflict");
  assert.deepEqual(result.events, []);
  assert.deepEqual(state, before, "conflict never applies an attempt cost");
}
function reviseDefinition(state, ref) {
  const current = state.campaignRuntime.definitions[ref];
  state.campaignRuntime.definitions[ref] = storedSemanticDefinition(current.semanticKind, current.visibilityPolicyRef,
    createDefinitionSnapshot(ref, "2", { ...current.content, observableState: "changed" }),
    { templateRef: current.templateRef, templateHash: current.templateHash });
}

test("a timed in-world refusal carries its frozen dependencies through the actual Room validation gate", () => {
  const fixture = createAuthoredProbeFixture("refusal-readset");
  const input = lowered(fixture, refusal([{ kind: "fictionTime", durationMicros: "28800000000" }]));
  assert.equal(validate(fixture, input).kind, "valid");
  assert.equal(input.plan.contextHash, fixture.requiredContext.binding.contextHash);
  assert.deepEqual(input.plan.basisRefs, [SOURCE, SCENE].sort());
  assert.ok(input.plan.readSet.some(binding => binding.ref === ACTOR));
  assert.ok(input.plan.readSet.some(binding => binding.ref === `character-timeline:${ACTOR}`));
  const result = stepActionToDecision(fixture.runtime, fixture.profiles, fixture.state, input);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  assert.equal(result.state.fictionTimelines[fixture.state.activeBranchId].nowMicros, "28800000000");
  replay(fixture, result);
});

test("zero-cost and resource-cost refusals use the same frozen path without inventing raw resource authority refs", () => {
  for (const costs of [[], [{ kind: "resource", resourceId: "spellSlot:1", amount: 1 }]]) {
    let fixture = createAuthoredProbeFixture(`refusal-cost-${costs.length}`);
    const state = structuredClone(fixture.state);
    state.entities[ACTOR].resources["spellSlot:1"] = 2;
    state.entities[ACTOR].resourceMaximums["spellSlot:1"] = 2;
    fixture = refreeze(fixture, state);
    const input = lowered(fixture, refusal(costs));
    assert.equal(validate(fixture, input).kind, "valid");
    assert.deepEqual(input.plan.readSet.map(binding => binding.ref), [ACTOR, SOURCE, SCENE].sort());
    const result = stepActionToDecision(fixture.runtime, fixture.profiles, state, input);
    assert.equal(result.kind, "committed", JSON.stringify(result));
    assert.equal(result.state.entities[ACTOR].resources["spellSlot:1"], 2 - costs.length);
    assert.deepEqual(result.state.fictionTimelines, state.fictionTimelines);
    const changed = structuredClone(state);
    changed.entities[ACTOR].resources["spellSlot:1"] = 1;
    assertConflict(fixture, input, changed);
  }
});

test("actor, top-level basis, next-action basis, prerequisite, clock and timeline membership all invalidate a stale timed refusal", () => {
  const fixture = createAuthoredProbeFixture("refusal-stale-dependencies");
  const input = lowered(fixture, refusal([{ kind: "fictionTime", durationMicros: "1000000" }], [SOURCE],
    [{ kind: "condition", ref: ZONE, description: "需要先排除喷流区域的阻碍。" }]));
  assert.deepEqual(input.plan.readSet.map(binding => binding.ref), [ACTOR, SOURCE, SCENE, ZONE, TIMELINE].sort());
  const changes = [
    state => { state.entities[ACTOR].hitPoints.current -= 1; },
    state => { reviseDefinition(state, SOURCE); },
    state => { state.scenes[SCENE].name = "场景已改变"; },
    state => { reviseDefinition(state, ZONE); },
    state => { state.fictionTimelines[state.activeBranchId].nowMicros = "1"; },
    state => { state.fictionTimelines["branch:other"] = { branchId: "branch:other", nowMicros: "0" };
      state.multiplayerRuntime.characterTimelineIds[ACTOR] = "branch:other"; },
  ];
  for (const change of changes) {
    const state = structuredClone(fixture.state);
    change(state);
    assertConflict(fixture, input, state);
  }
  for (const binding of input.plan.readSet) {
    const missing = structuredClone(input);
    missing.plan.readSet = missing.plan.readSet.filter(entry => entry.ref !== binding.ref);
    const result = fixture.runtime.step(fixture.profiles, fixture.state, missing);
    assert.equal(result.kind, "rejected", binding.ref);
    assert.equal(result.rejection.code, "causalFrontierConflict");
    assert.deepEqual(result.events, []);
  }
});

test("an item refusal binds the exact held entry and rejects changed stock before consuming it", () => {
  let fixture = createAuthoredProbeFixture("refusal-item-setup");
  const bundle = itemBundle();
  bundle.proposals.pop(); // Acquire the item through Rules; do not activate its Ability.
  const created = stepActionToDecision(fixture.runtime, fixture.profiles, fixture.state, lowered(fixture, bundle));
  assert.equal(created.kind, "committed", JSON.stringify(created));
  const entryRef = Object.values(created.state.campaignRuntime.itemSystem.entries)
    .find(entry => entry.holderRef === ACTOR && entry.disposition === "held").entryId;
  fixture = refreeze({ ...fixture, rootActionId: "root:refusal-item-cost" }, created.state, [SOURCE, ZONE, entryRef]);
  const input = lowered(fixture, refusal([{ kind: "item", entryRef, quantity: 1, charges: 0, durability: 0 }]));
  assert.ok(input.plan.readSet.some(binding => binding.ref === entryRef));
  assert.equal(validate(fixture, input).kind, "valid");
  const result = fixture.runtime.step(fixture.profiles, fixture.state, { ...input, rootActionId: "root:concurrent-item-cost" });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  assert.equal(result.state.campaignRuntime.itemSystem.entries[entryRef].quantity, 1);
  replay(fixture, result, created.events);
  assertConflict(fixture, input, result.state);
});

test("held-knowledge aliases ground refusal basis and prerequisites without substituting for mechanical reads", () => {
  const KNOWLEDGE = "knowledge:valve-note";
  const fixture = createAuthoredProbeFixture("refusal-held-knowledge", { initialKnowledge: [held(KNOWLEDGE), held(ACTOR), held(TIMELINE)] });
  const input = lowered(fixture, refusal([], [KNOWLEDGE],
    [{ kind: "knowledge", ref: KNOWLEDGE, description: "先核实已有记录中的操作条件。" }]));
  assert.ok(input.plan.readSet.some(binding => binding.ref === `knowledge:${ACTOR}:${KNOWLEDGE}`));
  assert.equal(stepActionToDecision(fixture.runtime, fixture.profiles, fixture.state, input).kind, "committed");
  const changed = structuredClone(fixture.state);
  changed.knowledge[ACTOR][KNOWLEDGE].content = "记录已经改变。";
  assertConflict(fixture, input, changed);

  const timed = lowered(fixture, refusal([{ kind: "fictionTime", durationMicros: "1" }]));
  for (const ref of [ACTOR, TIMELINE]) {
    const context = structuredClone(fixture.requiredContext);
    context.entries = context.entries.filter(entry => entry.entryRef !== ref);
    const rejected = lowerVNext2ProposalBundle({ ...fixture, requiredContext: context,
      value: refusal([{ kind: "fictionTime", durationMicros: "1" }]) });
    assert.equal(rejected.kind, "rejected");
    assert.equal(rejected.code, "CONTEXT_INSUFFICIENT");
    const forged = structuredClone(timed);
    const alias = `knowledge:${ACTOR}:${ref}`;
    forged.plan.readSet = forged.plan.readSet.filter(binding => binding.ref !== ref);
    forged.plan.readSet.push({ ref: alias, revisionOrHash: authorityRevisionOrHash(fixture.state, alias) });
    forged.plan.readSet.sort((left, right) => left.ref < right.ref ? -1 : left.ref === right.ref ? 0 : 1);
    const result = fixture.runtime.step(fixture.profiles, fixture.state, forged);
    assert.equal(result.kind, "rejected");
    assert.equal(result.rejection.code, "causalFrontierConflict");
    assert.deepEqual(result.events, []);
  }
});

test("knowledgeReview ignores the timeline binding and remains valid after unrelated time advances", () => {
  const fixture = createAuthoredProbeFixture("review-time-independent");
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify({ decision: { kind: "knowledgeReview", inquiry: "我目前知道什么？", scope: "allKnown", knowledgeRefs: [] } }));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  const input = lowered(fixture, parsed.bundle);
  assert.ok(fixture.requiredContext.entries.some(entry => entry.entryRef === TIMELINE));
  assert.ok(input.plan.readSet.every(binding => binding.ref !== TIMELINE));
  const state = structuredClone(fixture.state);
  state.fictionTimelines[state.activeBranchId].nowMicros = "1000000";
  assert.equal(validate(fixture, input, state).kind, "valid");
  const result = stepActionToDecision(fixture.runtime, fixture.profiles, state, input);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  assert.deepEqual(result.state.fictionTimelines, state.fictionTimelines);
});
