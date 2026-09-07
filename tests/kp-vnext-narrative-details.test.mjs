import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_SCENE as SCENE, PROBE_SOURCE as SOURCE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { encodeVNextStrictToolBundle, VNEXT2_PROPOSAL_BUNDLE_SCHEMA, SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { deepSeekStrictToolSchemaIssues } from "../app/_runtime/lib/kp/deepseek-strict-tool.ts";
import { narrativeDetail, narrativeMaterializedRef } from "../app/_runtime/lib/rules/v2/narrative-commitments.ts";
import { authoritySpatialBinding, authorityRevisionOrHash } from "../app/_runtime/lib/rules/authority-read.ts";
import { VNEXT_SEMANTIC_TEMPLATES } from "../app/_runtime/lib/rules/profiles/semantic-templates.ts";
import { VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE } from "../app/_runtime/lib/kp/vnext/room-bridge.ts";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";

function detailEntry(overrides = {}) {
  return { kind: "commitNarrativeDetail", basisRefs: [SCENE], consumes: [], produces: [], outcomeBinding: "always",
    sceneRef: SCENE, label: "青铜台座", description: "墙角有一座表面布满细纹的青铜台座。", audience: "sceneObservers", ...overrides };
}
function bundle(proposals) {
  return { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: "proposalBundle", mode: "adjudication", basisRefs: [SCENE],
    adjudication: { kind: "directSuccess", risk: "描述当前不参与裁决的环境细节。", successOutcome: "环境细节得到持续记录。" },
    terminal: null, proposals };
}
function lower(fixture, state, value, options = {}) {
  const rootActionId = options.rootActionId ?? fixture.rootActionId;
  const frozen = freezeAuthoredProbeContext(fixture, state, { rootActionId,
    focusRefs: options.focusRefs ?? [SOURCE], intentText: options.intentText ?? "继续查看当前环境。" });
  return lowerVNext2ProposalBundle({ ...fixture, state, rootActionId, requiredContext: frozen.context, value });
}
function commit(fixture, entry = detailEntry()) {
  const value = bundle([entry]);
  const { schema, kind, ...wire } = value;
  wire.terminal = { kind: "none" };
  const candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(wire)));
  assert.equal(candidate.kind, "accepted", JSON.stringify(candidate));
  const lowered = lower(fixture, fixture.state, candidate.bundle);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const result = fixture.runtime.step(fixture.profiles, fixture.state, lowered.command.rulesInput);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  const event = result.events.find(event => event.eventType === "NarrativeDetailCommitted");
  assert.ok(event);
  return { result, ref: event.payload.commitmentRef, lowered };
}
function projected(fixture, result, viewer = fixture.viewer) {
  return fixture.runtime.project(fixture.profiles, result.state, viewer, { channel: "realtime", committedRange: {
    receiptId: result.receipt.receiptId, actorCharacterId: ACTOR, priorState: fixture.state, events: result.events,
  } });
}

test("environment commitments pass the real tool, Rules, viewer Claims and replay without mechanical objects", () => {
  assert.deepEqual(deepSeekStrictToolSchemaIssues(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA), []);
  for (const detail of [detailEntry(), detailEntry({ label: "弧形纹路", description: "天花板的浅色纹路沿拱顶排列成弧形。" })]) {
    const fixture = createAuthoredProbeFixture(`narrative-${detail.label}`);
    const { result, ref, lowered } = commit(fixture, detail);
    assert.deepEqual(narrativeDetail(result.state, ref).description, detail.description);
    assert.equal(authoritySpatialBinding(result.state, ref, SCENE), undefined);
    assert.equal(result.state.campaignRuntime.definitions[ref], undefined);
    assert.deepEqual(result.state.campaignRuntime.itemSystem, fixture.state.campaignRuntime.itemSystem);
    assert.deepEqual(result.state.combatRuntime.scenes, fixture.state.combatRuntime.scenes);
    const view = projected(fixture, result);
    assert.equal(view.kind, "projected", JSON.stringify(view));
    const claim = view.renderableClaims.claims.find(claim => claim.kind === "narrativeDetail");
    assert.equal(claim.commitmentRef, ref);
    assert.equal(claim.description, detail.description);
    assert.deepEqual(claim.narrationFacts, [detail.description.slice(0, -1)]);
    assert.equal(JSON.stringify(view.visibleFacts).includes("audienceCharacterIds"), false);
    const replay = fixture.runtime.replay(fixture.genesis, result.events);
    assert.equal(replay.kind, "replayed", JSON.stringify(replay));
    assert.deepEqual(replay.state, result.state);
    assert.equal(fixture.runtime.step(fixture.profiles, result.state, lowered.command.rulesInput).rejection.code, "duplicateRootAction");
  }
});

test("private commitments preserve their audience across publication and replay", () => {
  const fixture = createAuthoredProbeFixture("narrative-private");
  const detail = detailEntry({ audience: "actorOnly", description: "只有你留意到侧墙上几道浅蓝色的细线。" });
  const { result, ref } = commit(fixture, detail);
  const other = { kind: "player", principalId: "principal:probe-target", seatId: "seat:probe-target", sessionVersion: 1, characterId: "character:probe-target" };
  const view = projected(fixture, result, other);
  assert.equal(view.kind, "projected", JSON.stringify(view));
  assert.equal(JSON.stringify(view).includes(detail.description), false);
  assert.equal(JSON.stringify(view.renderableClaims).includes(ref), false);
  assert.ok(projected(fixture, result).renderableClaims.claims.some(claim => claim.kind === "narrativeDetail"));
});

const HANDLE = "prospective:narrative-object";
function materialize(ref, detail = detailEntry()) {
  const template = VNEXT_SEMANTIC_TEMPLATES.sceneFeature;
  return { kind: "materializeObject", basisRefs: [ref], consumes: [{ kind: "existing", ref }],
    produces: [{ handle: HANDLE, kind: "semanticDefinition", outcomeBinding: "always" }], outcomeBinding: "always",
    semanticKind: "sceneFeature", templateRef: template.templateRef, templateHash: template.templateHash,
    visibilityPolicyRef: "visibility:narrative-audience", definition: { sceneRef: detail.sceneRef,
      visibilityFactId: null, label: detail.label, description: detail.description, observableState: null,
      affordances: null, mechanicDefinitionRefs: [] }, summary: "按已发布原文固化同一场景细节。" };
}
function observe(target = HANDLE) {
  return { kind: "worldInteraction", basisRefs: [SCENE],
    consumes: target === HANDLE ? [{ kind: "prospective", handle: HANDLE }] : [], produces: [], outcomeBinding: "always",
    sceneRef: SCENE, targetRefs: [target], directTargetRefs: [target], instrumentRefs: [], abilityRef: null,
    intent: "观察这个已描述对象。", method: "留在原地仔细看它。", branches: { success: {
      outcomeCode: "outcome:observed", summary: "已承诺的对象仍然在原处。", effects: [],
      sensoryEvidence: [{ observerRef: ACTOR, subjectRef: target, sense: "sight", evidence: "对象保留已描述的外观。", basisRefs: [target] }],
      pressures: [], opportunities: [] }, failure: null } };
}
function later(fixture, state, value, ref, suffix = "materialize") {
  return lower(fixture, state, value, { rootActionId: `${fixture.rootActionId}:${suffix}`, focusRefs: [SOURCE, ref] });
}

test("later explicit reference materializes furnishings and spatial appearance before observation, with replayed identity", () => {
  for (const detail of [detailEntry(), detailEntry({ label: "弧形纹路", description: "天花板的浅色纹路沿拱顶排列成弧形。" })]) {
    const fixture = createAuthoredProbeFixture(`narrative-causal-${detail.label}`);
    const first = commit(fixture, detail);
    const originalHash = authorityRevisionOrHash(first.result.state, first.ref);
    const lowered = later(fixture, first.result.state, bundle([observe(), materialize(first.ref, detail)]), first.ref);
    assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    assert.deepEqual(lowered.command.rulesInput.narrativeMaterializationRefs, [first.ref]);
    assert.equal(lowered.command.rulesInput.steps[0].rulesInput.kind, "materializeSemanticDefinition");
    const result = fixture.runtime.step(fixture.profiles, first.result.state, lowered.command.rulesInput);
    assert.equal(result.kind, "committed", JSON.stringify(result));
    const objectRef = narrativeMaterializedRef(result.state, first.ref);
    assert.ok(objectRef);
    assert.equal(result.state.campaignRuntime.definitions[objectRef].content.description, detail.description);
    assert.equal(authorityRevisionOrHash(result.state, first.ref), originalHash);
    const bindingIndex = result.events.findIndex(event => event.eventType === "NarrativeDetailMaterialized");
    const observationIndex = result.events.findIndex(event => event.eventType === "WorldInteractionResolved");
    assert.ok(bindingIndex >= 0 && observationIndex > bindingIndex);
    const restored = fixture.runtime.replay(fixture.genesis, [...first.result.events, ...result.events]);
    assert.equal(restored.kind, "replayed", JSON.stringify(restored));
    assert.deepEqual(restored.state, result.state);
    const context = freezeAuthoredProbeContext(fixture, restored.state, { focusRefs: [first.ref] }).context;
    assert.equal(context.intent.narrativeMaterializationRefs, undefined);
    assert.ok(context.entries.some(entry => entry.kind === "known" && entry.entryRef === objectRef));
  }
});

test("omitting narrative bases cannot bypass server obligations, including Rules reordering and conditional creation", () => {
  const fixture = createAuthoredProbeFixture("narrative-omission");
  const first = commit(fixture);
  const omitted = later(fixture, first.result.state, bundle([observe(SOURCE)]), first.ref);
  assert.equal(omitted.kind, "rejected");
  assert.ok(omitted.issues.includes("narrative:every-required-commitment-needs-one-unconditional-materializer"));
  const lowered = later(fixture, first.result.state, bundle([observe(SOURCE), materialize(first.ref)]), first.ref);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const wrongOrder = structuredClone(lowered.command.rulesInput);
  wrongOrder.steps.reverse();
  for (const step of wrongOrder.steps) step.dependsOn = [];
  const rejected = fixture.runtime.step(fixture.profiles, first.result.state, wrongOrder);
  assert.equal(rejected.kind, "rejected", JSON.stringify(rejected));
  assert.equal(rejected.rejection.code, "invalidRulesInput");
  assert.deepEqual(rejected.events, []);
  const conditional = materialize(first.ref);
  conditional.outcomeBinding = conditional.produces[0].outcomeBinding = "onSuccess";
  assert.equal(later(fixture, first.result.state, bundle([conditional, observe()]), first.ref).kind, "rejected");
  const single = later(fixture, first.result.state, bundle([materialize(first.ref)]), first.ref, "single");
  assert.equal(single.kind, "accepted", JSON.stringify(single));
  assert.equal(single.command.rulesInput.kind, "applyAtomicWorldInteractionSteps");
  const frozen = freezeAuthoredProbeContext(fixture, first.result.state, {
    rootActionId: `${fixture.rootActionId}:single`, focusRefs: [SOURCE, first.ref] });
  assert.deepEqual(VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE.validateReadSet({ phase: "beforeFirstRulesStep",
    requiredContext: frozen.context, rulesInput: single.command.rulesInput, profiles: fixture.profiles, state: first.result.state,
    replayHead: { eventSeq: first.result.state.version, stateHash: canonicalSha256(first.result.state) } }), { kind: "valid" });
  assert.equal(fixture.runtime.step(fixture.profiles, first.result.state, single.command.rulesInput).kind, "committed");
});

test("immutable commitment content, audience, source binding and stale authority are enforced before any commit", () => {
  const fixture = createAuthoredProbeFixture("narrative-conflicts");
  const first = commit(fixture);
  for (const field of ["label", "description", "sceneRef"]) {
    const changed = materialize(first.ref);
    changed.definition[field] = `${changed.definition[field]}-changed`;
    assert.equal(later(fixture, first.result.state, bundle([changed]), first.ref, field).kind, "rejected");
  }
  const badAudience = materialize(first.ref);
  badAudience.visibilityPolicyRef = "visibility:public";
  assert.equal(later(fixture, first.result.state, bundle([badAudience]), first.ref).kind, "rejected");
  const lowered = later(fixture, first.result.state, bundle([materialize(first.ref)]), first.ref);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const stale = structuredClone(lowered.command.rulesInput);
  stale.steps[0].rulesInput.plan.readSet.find(binding => binding.ref === first.ref).revisionOrHash = `sha256:${"0".repeat(64)}`;
  assert.equal(fixture.runtime.step(fixture.profiles, first.result.state, stale).rejection.code, "causalFrontierConflict");
  const missing = structuredClone(lowered.command.rulesInput);
  missing.steps[0].rulesInput.plan.sourceRefs = [];
  assert.equal(fixture.runtime.step(fixture.profiles, first.result.state, missing).kind, "rejected");
  const created = fixture.runtime.step(fixture.profiles, first.result.state, lowered.command.rulesInput);
  assert.equal(created.kind, "committed", JSON.stringify(created));
  const duplicate = later(fixture, created.state, bundle([materialize(first.ref)]), first.ref, "duplicate");
  assert.equal(duplicate.kind, "rejected");
  assert.ok(duplicate.issues.includes("narrative:already-materialized"));
});

test("same labels retain separate server identities and unresolved narrative facts cannot become mechanical evidence", () => {
  const fixture = createAuthoredProbeFixture("narrative-identities");
  const first = commit(fixture);
  const second = lower(fixture, first.result.state, bundle([detailEntry()]), { rootActionId: `${fixture.rootActionId}:other` });
  assert.equal(second.kind, "accepted", JSON.stringify(second));
  const result = fixture.runtime.step(fixture.profiles, first.result.state, second.command.rulesInput);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  const otherRef = result.events.find(event => event.eventType === "NarrativeDetailCommitted").payload.commitmentRef;
  assert.notEqual(otherRef, first.ref);
  const action = observe(SOURCE);
  const lowered = lower(fixture, first.result.state, bundle([action]), { rootActionId: `${fixture.rootActionId}:bypass` });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const injected = structuredClone(lowered.command.rulesInput);
  injected.plan.basisRefs.push(first.ref);
  injected.plan.basisRefs.sort();
  injected.plan.readSet.push({ ref: first.ref, revisionOrHash: authorityRevisionOrHash(first.result.state, first.ref) });
  injected.plan.readSet.sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
  const rejected = fixture.runtime.step(fixture.profiles, first.result.state, injected);
  assert.equal(rejected.kind, "rejected", JSON.stringify(rejected));
  assert.match(rejected.rejection.message, /narrative:materialization-required-before-causal-use/u);
});

test("frozen materialization obligations survive shared randomness and restore on either outcome", () => {
  for (const roll of [1, 20]) {
    const fixture = createAuthoredProbeFixture(`narrative-random-${roll}`);
    const first = commit(fixture);
    const interaction = observe();
    interaction.branches.failure = { ...structuredClone(interaction.branches.success), outcomeCode: "outcome:uncertain",
      summary: "细节保留，但无法辨认更多。", sensoryEvidence: [] };
    const value = bundle([interaction, materialize(first.ref)]);
    value.adjudication = { kind: "check", checkKind: "abilityCheck", ability: "wis", skill: null, dc: 10, mode: "normal",
      risk: "短暂照明可能不足以看清细微结构。", successOutcome: "看清原有细节。", failureOutcome: "无法辨认更多。" };
    const lowered = later(fixture, first.result.state, value, first.ref);
    assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    const pending = fixture.runtime.step(fixture.profiles, first.result.state, lowered.command.rulesInput);
    assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
    assert.equal(narrativeMaterializedRef(pending.state, first.ref), undefined);
    const frozenPlan = pending.events.find(event => event.eventType === "RandomnessRequested").payload.resolutionPlan;
    assert.deepEqual(frozenPlan.narrativeMaterializationRefs, [first.ref]);
    const restored = fixture.runtime.replay(fixture.genesis, [...first.result.events, ...pending.events]);
    assert.equal(restored.kind, "replayed", JSON.stringify(restored));
    const result = fixture.runtime.step(fixture.profiles, restored.state, { kind: "fulfillAuthoritativeRandomness",
      continuation: pending.continuation, rolls: pending.randomnessRequest.dice.flatMap(die => Array(Number(die.count)).fill(roll)) });
    assert.equal(result.kind, "committed", JSON.stringify(result));
    assert.ok(narrativeMaterializedRef(result.state, first.ref));
    const replay = fixture.runtime.replay(fixture.genesis, [...first.result.events, ...pending.events, ...result.events]);
    assert.equal(replay.kind, "replayed", JSON.stringify(replay));
    assert.deepEqual(replay.state, result.state);
  }
});

test('server narrative obligations survive compilation and replay without a fabricated prospective consume', () => {
  const fixture = createAuthoredProbeFixture('narrative-scope-dependency');
  const first = commit(fixture);
  const lowered = later(fixture, first.result.state, bundle([observe(SCENE), materialize(first.ref)]), first.ref);
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  const command = lowered.command.rulesInput;
  const [materializer, observation] = command.steps;
  assert.equal(materializer.rulesInput.kind, 'materializeSemanticDefinition');
  assert.equal(observation.rulesInput.kind, 'resolveWorldInteraction');
  assert.deepEqual(observation.consumes, []);
  assert.ok(observation.dependsOn.includes(materializer.proposalRef));
  const result = fixture.runtime.step(fixture.profiles, first.result.state, command);
  assert.equal(result.kind, 'committed', JSON.stringify(result));
  assert.ok(narrativeMaterializedRef(result.state, first.ref));
  const replayed = fixture.runtime.replay(fixture.genesis, [...first.result.events, ...result.events]);
  assert.equal(replayed.kind, 'replayed', JSON.stringify(replayed));
  assert.deepEqual(replayed.state, result.state);
  for (const mutate of [
    input => { input.steps[1].dependsOn = []; },
    input => { input.steps[0].outcomeBinding = input.steps[0].produces[0].outcomeBinding = 'onSuccess'; },
    input => { input.steps.reverse(); },
  ]) {
    const invalid = structuredClone(command); mutate(invalid);
    const rejected = fixture.runtime.step(fixture.profiles, first.result.state, invalid);
    assert.equal(rejected.kind, 'rejected', JSON.stringify(rejected));
    assert.deepEqual(rejected.events, []);
  }
});
