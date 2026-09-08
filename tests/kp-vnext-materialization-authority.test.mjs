import { soleStep, rebundle } from './fixtures/vnext-action-duration.mjs';
import { VNEXT_SEMANTIC_TEMPLATES, VNEXT_SEMANTIC_TEMPLATE_CATALOG,
  composeSemanticTemplate } from "../app/_runtime/lib/rules/profiles/semantic-templates.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash } from "../app/_runtime/lib/kp/vnext/canonical-json.ts";
import { materializationAuthorityBasis } from "../app/_runtime/lib/kp/vnext/materialization-authority.ts";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { lowerVNextProposalBundle, VNEXT1_PROPOSAL_BUNDLE_SCHEMA } from "../app/_runtime/lib/kp/vnext/proposal-bundle.ts";
import { parseSubmitKpProposalBundleCandidateArguments } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { decodeVNextStrictToolBundle, encodeVNextStrictToolBundle } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR, PROBE_SCENE, PROBE_SOURCE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { itemBundle, hazardBundle } from "./fixtures/vnext-authored-bundles.mjs";

const PROFILE_REF = "profile-context:module:authored-probe";
function lower(fixture, value, context = fixture.requiredContext) {
  return lowerVNext2ProposalBundle({ value, requiredContext: context, state: fixture.state,
    rootActionId: fixture.rootActionId, actorCharacterId: PROBE_ACTOR });
}
function objectEntry() {
  return { kind: "materializeObject", basisRefs: [PROBE_SOURCE], consumes: [],
    produces: [{ handle: "prospective:unfamiliar-object", kind: "semanticDefinition", outcomeBinding: "always" }],
    outcomeBinding: "always", semanticKind: "sceneFeature", templateRef: VNEXT_SEMANTIC_TEMPLATES.sceneFeature.templateRef,
    templateHash: VNEXT_SEMANTIC_TEMPLATES.sceneFeature.templateHash, visibilityPolicyRef: "visibility:public",
    definition: { sceneRef: PROBE_SCENE, visibilityFactId: null, label: "封声玻璃罩", description: "一个玻璃罩。",
      observableState: "完整", affordances: ["携带"], mechanicDefinitionRefs: [] }, summary: "玻璃罩被固化。" };
}

test("every authored definition and Item instance receives server-selected permission dependencies before Rules commits", () => {
  for (const [name, original, count] of [["item", itemBundle(), 3], ["hazard", hazardBundle(), 2]]) {
    const f = createAuthoredProbeFixture(`grants-${name}`);
    // Only definitions and instances remain: the character does nothing here, so the act takes no time.
    const value = { ...original, adjudication: { ...original.adjudication, durationMicros: "0" }, proposals: original.proposals.slice(0, count) };
    const before = structuredClone(value);
    const result = lower(f, value);
    assert.equal(result.kind, "accepted", JSON.stringify(result));
    const steps = result.command.rulesInput.steps;
    for (const step of steps) {
      assert.ok(step.rulesInput.plan.basisRefs.includes(PROFILE_REF));
      assert.ok(step.rulesInput.plan.basisRefs.includes(PROBE_SCENE));
      assert.ok(step.rulesInput.plan.readSet.some(({ ref }) => ref === PROFILE_REF));
      assert.ok(step.rulesInput.plan.readSet.some(({ ref }) => ref === PROBE_SCENE));
    }
    assert.deepEqual(value, before, "server authorization does not rewrite the model proposal");
    const committed = f.runtime.step(f.profiles, f.state, result.command.rulesInput);
    assert.equal(committed.kind, "committed", JSON.stringify(committed));
    const replay = f.runtime.replay(f.genesis, committed.events);
    assert.equal(replay.kind, "replayed");
    assert.deepEqual(replay.state, committed.state);
  }
});

test("missing, altered, differently scoped, and stale creation grants reject while existing inventory does not need a creation grant", () => {
  const f = createAuthoredProbeFixture("grants-denied");
  const value = itemBundle();
  for (const mutate of [
    (context) => { context.entries = context.entries.filter(({ kind }) => kind !== "openBlank"); },
    (context) => { context.entries.find(({ kind }) => kind === "openBlank").authorizationHash = `sha256:${"0".repeat(64)}`; },
    (context) => { context.entries.find(({ kind }) => kind === "openBlank").scopeRef = "scene:foreign"; },
  ]) {
    const context = structuredClone(f.requiredContext);
    mutate(context);
    assert.equal(lower(f, value, context).code, "CONTEXT_INSUFFICIENT");
  }
  const staleState = structuredClone(f.state);
  staleState.scenes[PROBE_SCENE].name = "A changed scope";
  assert.equal(materializationAuthorityBasis({ context: f.requiredContext, state: staleState,
    scopeRef: PROBE_SCENE, kind: "item" }).code, "CONTEXT_INSUFFICIENT");
  const deniedKind = materializationAuthorityBasis({ context: f.requiredContext, state: f.state,
    scopeRef: PROBE_SCENE, kind: "unregistered-authoring-kind" });
  assert.equal(deniedKind.code, "CONTEXT_INSUFFICIENT");
  const creation = lower(f, { ...value, adjudication: { ...value.adjudication, durationMicros: "0" }, proposals: value.proposals.slice(0, 3) });
  const committed = f.runtime.step(f.profiles, f.state, creation.command.rulesInput);
  const entryRef = Object.keys(committed.state.campaignRuntime.itemSystem.entries)[0];
  const next = { ...f, state: committed.state, rootActionId: `${f.rootActionId}:pickup` };
  const context = structuredClone(freezeAuthoredProbeContext(next, next.state,
    { rootActionId: next.rootActionId, focusRefs: [entryRef, PROBE_SOURCE] }).context);
  context.entries = context.entries.filter(({ kind }) => kind !== "openBlank");
  const pickup = lower(next, rebundle(value, [{ kind: "inventoryOperation", basisRefs: [PROBE_SOURCE],
    consumes: [{ kind: "existing", ref: entryRef }], produces: [], outcomeBinding: "always",
    operation: { kind: "acquire", entryRef, quantity: 1 }, summary: "拿起已有物品。" }]), context);
  assert.equal(pickup.kind, "accepted", JSON.stringify(pickup));
  assert.equal(next.runtime.step(next.profiles, next.state, pickup.command.rulesInput).kind, "committed");
});

test("vNext2 scene objects and world facts use the same grant, including facts whose definition has no scene field", () => {
  for (const semanticKind of ["sceneFeature", "worldFact"]) {
    const f = createAuthoredProbeFixture(`grant-${semanticKind}`);
    const entry = objectEntry();
    entry.semanticKind = semanticKind;
    entry.templateRef = VNEXT_SEMANTIC_TEMPLATES[semanticKind].templateRef;
    entry.templateHash = VNEXT_SEMANTIC_TEMPLATES[semanticKind].templateHash;
    if (semanticKind === "worldFact") {
      entry.definition.sceneRef = null;
      entry.definition.worldFact = { subjectRefs: [PROBE_SCENE], occurrence: "此刻之前。", initialKnowledge: [],
        consistency: { judgment: "compatible", explanation: "与已固定的场景相容。" } };
    }
    const value = rebundle(itemBundle(), [entry]);
    const result = lower(f, value);
    assert.equal(result.kind, "accepted", JSON.stringify(result));
    assert.ok(soleStep(result.command).plan.basisRefs.includes(PROFILE_REF));
    const committed = f.runtime.step(f.profiles, f.state, result.command.rulesInput);
    assert.equal(committed.kind, "committed", JSON.stringify(committed));
    assert.equal(f.runtime.replay(f.genesis, committed.events).kind, "replayed");
    const missing = structuredClone(f.requiredContext);
    missing.entries = missing.entries.filter(({ kind }) => kind !== "openBlank");
    assert.equal(lower(f, value, missing).code, "CONTEXT_INSUFFICIENT");
  }
});

test("the legacy vNext1 object creation entry cannot bypass the shared authorization boundary", () => {
  const f = createAuthoredProbeFixture("grant-legacy");
  const entry = objectEntry();
  const value = { schema: VNEXT1_PROPOSAL_BUNDLE_SCHEMA, kind: "proposalBundle", proposals: [{
    proposalRef: "proposal:legacy-create", formId: "materialization.vnext-1", basisRefs: entry.basisRefs,
    consumes: [], produces: entry.produces, outcomeBinding: "always",
    ruling: { kind: "directSuccess", risk: "无需检定", successOutcome: "固化", failureOutcome: "无失败分支" },
    proposal: { kind: "materializeObject", semanticKind: entry.semanticKind, templateRef: entry.templateRef,
      templateHash: entry.templateHash, visibilityPolicyRef: entry.visibilityPolicyRef,
      definition: entry.definition, summary: entry.summary },
  }] };
  const args = { value, requiredContext: f.requiredContext, state: f.state,
    rootActionId: f.rootActionId, actorCharacterId: PROBE_ACTOR };
  const result = lowerVNextProposalBundle(args);
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  assert.ok(soleStep(result.command).plan.basisRefs.includes(PROFILE_REF));
  const wrongTemplate = structuredClone(value);
  wrongTemplate.proposals[0].proposal.templateHash = `sha256:${"0".repeat(64)}`;
  assert.equal(lowerVNextProposalBundle({ ...args, value: wrongTemplate }).code, "PROPOSAL_REFERENCE_INVALID");
  const defaults = structuredClone(value);
  defaults.proposals[0].proposal.definition.observableState = null;
  defaults.proposals[0].proposal.definition.affordances = null;
  const inherited = lowerVNextProposalBundle({ ...args, value: defaults });
  assert.equal(inherited.kind, "accepted", JSON.stringify(inherited));
  assert.equal(soleStep(inherited.command).plan.content.observableState, "present");
  assert.deepEqual(soleStep(inherited.command).plan.content.affordances, []);
  const missing = structuredClone(f.requiredContext);
  missing.entries = missing.entries.filter(({ kind }) => kind !== "openBlank");
  assert.equal(lowerVNextProposalBundle({ ...args, requiredContext: missing }).code, "CONTEXT_INSUFFICIENT");
});

test("a scope permission cannot override structurally matching active denial, and defining a template proves no instance exists", () => {
  const f = createAuthoredProbeFixture("grant-denial");
  for (const selector of [
    { kind: "semanticKind", semanticKind: "sceneFeature" },
    { kind: "templateRef", templateRef: VNEXT_SEMANTIC_TEMPLATES.sceneFeature.templateRef },
    { kind: "templateFamily", templateFamily: "template" },
  ]) {
    const context = structuredClone(f.requiredContext);
    context.entries.push({ kind: "knownAbsent", entryRef: "availability:denied", scopeRef: PROBE_SCENE,
      selector, basisRefs: [PROBE_SCENE] });
    assert.equal(lower(f, rebundle(itemBundle(), [objectEntry()]), context).code, "CONTEXT_INSUFFICIENT");
  }
  const context = structuredClone(f.requiredContext);
  context.entries.push({ kind: "knownAbsent", entryRef: "availability:no-item", scopeRef: PROBE_SCENE,
    selector: { kind: "semanticKind", semanticKind: "item" }, basisRefs: [PROBE_SCENE] });
  assert.equal(lower(f, rebundle(itemBundle(), itemBundle().proposals.slice(0, 2)), context).kind, "accepted");
  assert.equal(lower(f, itemBundle(), context).code, "CONTEXT_INSUFFICIENT");
});

test("versioned default templates compose different sparse objects without acting as world instances", () => {
  const template = VNEXT_SEMANTIC_TEMPLATES.sceneFeature;
  assert.ok(Object.isFrozen(VNEXT_SEMANTIC_TEMPLATE_CATALOG.templates));
  for (const [label, description] of [["悬挂的布帘", "用于遮挡视线的布帘。"], ["石制支座", "支撑陈列架的底座。"]]) {
    const composed = composeSemanticTemplate({ semanticKind: "sceneFeature", ...template,
      overrides: { sceneRef: PROBE_SCENE, label, description } });
    assert.equal(composed.kind, "accepted", JSON.stringify(composed));
    assert.deepEqual(composed.content, { sceneRef: PROBE_SCENE, label, description,
      observableState: "present", affordances: [] });
    assert.ok(Object.isFrozen(composed.content));
    assert.ok(Object.isFrozen(composed.content.affordances));
  }
  assert.deepEqual(template.defaults, { observableState: "present", affordances: [] });
  const f = createAuthoredProbeFixture("template-no-instance");
  assert.equal(f.state.campaignRuntime.definitions[template.templateRef], undefined);
});

test("both lowering and Rules reject unknown, changed, wrong-kind templates and forbidden direct-command fields", () => {
  const f = createAuthoredProbeFixture("template-boundary");
  const value = rebundle(itemBundle(), [objectEntry()]);
  const lowered = lower(f, value);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  for (const mutate of [
    entry => { entry.templateRef = "template:unregistered"; },
    entry => { entry.templateHash = `sha256:${"0".repeat(64)}`; },
    entry => { entry.templateRef = VNEXT_SEMANTIC_TEMPLATES.worldFact.templateRef;
      entry.templateHash = VNEXT_SEMANTIC_TEMPLATES.worldFact.templateHash; },
  ]) {
    const changed = structuredClone(value);
    mutate(changed.proposals[0]);
    assert.equal(lower(f, changed).code, "PROPOSAL_REFERENCE_INVALID");
    const direct = structuredClone(lowered.command.rulesInput);
    mutate(direct.plan);
    assert.equal(f.runtime.step(f.profiles, f.state, direct).rejection.code, "invalidRulesInput");
  }
  for (const forbidden of [{ quantity: 9 }, { hp: 30 }, { arbitrarySemanticPermission: true }]) {
    const direct = structuredClone(lowered.command.rulesInput);
    Object.assign(direct.plan.content, forbidden);
    assert.equal(f.runtime.step(f.profiles, f.state, direct).rejection.code, "invalidRulesInput");
  }
  const worldFact = composeSemanticTemplate({ semanticKind: "worldFact", ...VNEXT_SEMANTIC_TEMPLATES.worldFact,
    overrides: { label: "断言", description: "一项待创建的事实。", sceneRef: PROBE_SCENE } });
  assert.equal(worldFact.code, "PROPOSAL_FORM_INVALID");
  assert.deepEqual(f.state.receipts, {});
});

test("strict tool default sentinels reach the frozen template through decoding, lowering, Rules and replay", () => {
  for (const [name, observableState, affordances] of [
    ["inherited", "none", "none"], ["explicit", "folded", ["unfold"]],
  ]) {
    const f = createAuthoredProbeFixture(`template-wire-${name}`);
    const wire = structuredClone(rebundle(itemBundle(), [objectEntry()]));
    delete wire.kind;
    delete wire.schema;
    wire.terminal = { kind: "none" };
    Object.assign(wire.proposals[0].definition, { observableState, affordances, visibilityFactId: "none" });
    const parsed = parseSubmitKpProposalBundleCandidateArguments(encodeVNextStrictToolBundle(wire));
    assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
    assert.equal(parsed.bundle.proposals[0].definition.observableState, name === "inherited" ? null : "folded");
    const lowered = lower(f, parsed.bundle);
    assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    const content = soleStep(lowered.command).plan.content;
    assert.equal(content.observableState, name === "inherited" ? "present" : "folded");
    assert.deepEqual(content.affordances, name === "inherited" ? [] : ["unfold"]);
    const committed = f.runtime.step(f.profiles, f.state, lowered.command.rulesInput);
    assert.equal(committed.kind, "committed", JSON.stringify(committed));
    const definition = committed.events.find(event => event.eventType === "SemanticDefinitionMaterialized").payload.definition;
    assert.deepEqual(definition.content, content);
    assert.equal(definition.templateHash, VNEXT_SEMANTIC_TEMPLATES.sceneFeature.templateHash);
    const replay = f.runtime.replay(f.genesis, committed.events);
    assert.equal(replay.kind, "replayed");
    assert.deepEqual(replay.state, committed.state);
  }
  const authored = decodeVNextStrictToolBundle({ decision: { kind: "directSuccess" }, steps: [{ kind: "materializeDefinition",
    source: { kind: "ability", observableState: "none", affordances: "none" }, outcomeBinding: "always" }], results: [] });
  const { kind: _kind, ...authoredSource } = authored.proposals[0].source;
  assert.deepEqual({ ...authoredSource },
  { observableState: "none", affordances: "none" }, "template sentinels cannot rewrite authored source fields");
});

test("a local grant cannot materialize a hazard on an existing trigger in another scene", () => {
  const f = createAuthoredProbeFixture("grant-foreign-trigger");
  f.state.campaignRuntime.definitions[PROBE_SOURCE].content.sceneRef = "scene:foreign";
  const result = lower(f, rebundle(hazardBundle(), hazardBundle().proposals.slice(0, 2)));
  assert.equal(result.code, "CONTEXT_INSUFFICIENT", JSON.stringify(result));
  assert.deepEqual(result.issues, ["materialization:trigger-outside-granted-scope"]);
});
