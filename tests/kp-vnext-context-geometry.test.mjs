import { stepActionToDecision } from './fixtures/vnext-action-lifecycle.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_SOURCE as SOURCE, PROBE_SCENE as SCENE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { VNEXT2_PROPOSAL_BUNDLE_SCHEMA } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { selectPlanReadSet } from "../app/_runtime/lib/kp/vnext/proposals.ts";
import { buildReferenceIndex } from "../app/_runtime/lib/kp/vnext/context/reference-index.ts";
import { discoverCandidates } from "../app/_runtime/lib/kp/vnext/context/candidate-discovery.ts";
import { VNEXT_RETRIEVAL_PROFILE } from "../app/_runtime/lib/kp/vnext/context/extractors.ts";
import { createContextWorkBudget, contextWorkBudgetProfile, VNEXT_CONTEXT_WORK_BUDGET } from "../app/_runtime/lib/kp/vnext/context/work-budget.ts";
import { authorityGeometryFeatureComposite, authorityRevisionOrHash, authorityReadSetConflicts,
  authoritySpatialBinding, authoritySpatialRefVisibleTo } from "../app/_runtime/lib/rules/authority-read.ts";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";

const FEATURE = "feature:probe-valve";
const OTHER_SCENE = "scene:other-gallery";
function geometry(state) { return state.combatRuntime.scenes[SCENE].geometry; }
function index(state) {
  const result = buildReferenceIndex(state, createContextWorkBudget());
  assert.equal(result.kind, "indexed");
  return result.index;
}
function freeze(fixture, state = fixture.state, options = {}) {
  return freezeAuthoredProbeContext(fixture, state, { rootActionId: fixture.rootActionId, ...options });
}
function known(frozen, ref = FEATURE) {
  return frozen.context.entries.find((entry) => entry.kind === "known" && entry.entryRef === ref);
}
function observation(ref = FEATURE, basisRefs = [ref]) {
  return { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: "proposalBundle", mode: "adjudication", basisRefs,
    adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "观察已存在对象的表面。", successOutcome: "看清对象的当前状态。" }, terminal: null,
    proposals: [{ kind: "worldInteraction", basisRefs, consumes: [], produces: [], outcomeBinding: "always",
      sceneRef: SCENE, targetRefs: [ref], directTargetRefs: [ref], instrumentRefs: [], abilityRef: null,
      intent: "观察对象。", method: "查看当前可见表面。", branches: { success: {
        outcomeCode: "outcome:observed", summary: "看到了对象的表面。", effects: [],
        sensoryEvidence: [{ observerRef: ACTOR, subjectRef: ref, sense: "sight", evidence: "对象的表面轮廓清晰可见。", basisRefs }],
        pressures: [], opportunities: [] }, failure: null } }] };
}
function lower(fixture, frozen, value = observation(), state = fixture.state) {
  return lowerVNext2ProposalBundle({ ...fixture, state, requiredContext: frozen.context, value });
}

test("persisted interactable and terrain features use one discovery, exact read, Rules and replay path", () => {
  for (const featureOverrides of [
    { kind: "interactable", label: "青铜控制台" },
    { kind: "terrain", label: "碎石浅洼", terrain: "rubble" },
  ]) {
    const fixture = createAuthoredProbeFixture(`geometry-${featureOverrides.kind}`, { featureOverrides });
    const frozen = freeze(fixture, fixture.state, { intentText: `观察${featureOverrides.label}。` });
    const entry = known(frozen);
    assert.ok(entry, "registered label resolves a real feature without explicit focus or semantic wrapper");
    assert.deepEqual(entry.value, { sceneRef: SCENE, feature: geometry(fixture.state).obstacles[0] });
    assert.equal(entry.revisionOrHash, canonicalSha256(entry.value));
    assert.equal(entry.revisionOrHash, authorityRevisionOrHash(fixture.state, FEATURE));
    const selected = selectPlanReadSet(frozen.context, [FEATURE]);
    assert.equal(selected.kind, "accepted");
    assert.ok(selected.readSet.some(({ ref, revisionOrHash }) => ref === FEATURE && revisionOrHash === entry.revisionOrHash));
    assert.ok(frozen.context.references.citations.viewerEvidenceRefs.includes(FEATURE));
    assert.equal(index(fixture.state).nodes.get(FEATURE).semanticKind, undefined);
    assert.deepEqual(authoritySpatialBinding(fixture.state, FEATURE, SCENE), { kind: "geometryFeature", ref: FEATURE, sceneRef: SCENE });
    const lowered = lower(fixture, frozen);
    assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    const result = stepActionToDecision(fixture.runtime, fixture.profiles, fixture.state, lowered.command.rulesInput);
    assert.equal(result.kind, "committed", JSON.stringify(result));
    assert.deepEqual(geometry(result.state), geometry(fixture.state), "observation never invents a Geometry write");
    const replayed = fixture.runtime.replay(fixture.genesis, result.events);
    assert.equal(replayed.kind, "replayed");
    assert.deepEqual(replayed.state, result.state);
    const projected = fixture.runtime.project(fixture.profiles, result.state, fixture.viewer);
    assert.equal(projected.kind, "projected");
    assert.ok(JSON.stringify(projected).includes("对象的表面轮廓清晰可见。"), "committed evidence reaches the authorized Viewer");
  }
});

test("semantic mechanic dependencies load the same Geometry record; hidden barriers remain KP-only targets", () => {
  const fixture = createAuthoredProbeFixture("geometry-hidden", { featureOverrides: {
    label: "暗门背板", visibilityPolicyId: "visibility:hidden-until-evidence",
  } });
  const frozen = freeze(fixture, fixture.state, { focusRefs: [SOURCE] });
  assert.ok(known(frozen), "semantic mechanicDefinitionRefs closes the real feature body");
  assert.ok(frozen.context.references.citations.authorityBasisRefs.includes(FEATURE));
  assert.equal(frozen.context.references.citations.viewerEvidenceRefs.includes(FEATURE), false);
  assert.equal(authoritySpatialRefVisibleTo(fixture.state, FEATURE, SCENE, ACTOR), false);
  const direct = lower(fixture, frozen);
  assert.equal(direct.kind, "rejected");
  assert.match(JSON.stringify(direct), /reference|target|viewer/i);
  const basis = lower(fixture, frozen, observation(SOURCE, [SOURCE, FEATURE]));
  assert.equal(basis.kind, "accepted", JSON.stringify(basis));
  const result = stepActionToDecision(fixture.runtime, fixture.profiles, fixture.state, basis.command.rulesInput);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  const discovery = discoverCandidates({ state: fixture.state, index: index(fixture.state),
    subject: { kind: "character", characterRef: ACTOR, sceneRef: SCENE }, focusRefs: [], intentText: "观察暗门背板。",
    profile: VNEXT_RETRIEVAL_PROFILE, budget: createContextWorkBudget() });
  assert.equal(discovery.kind, "discovered");
  assert.equal(discovery.candidates.some(({ ref }) => ref === FEATURE), false, "hidden labels never become character search candidates");
  const projected = fixture.runtime.project(fixture.profiles, result.state, fixture.viewer);
  assert.equal(JSON.stringify(projected).includes("暗门背板"), false);
});

test("absent or deleted objects never acquire addresses from proposal text", () => {
  const fixture = createAuthoredProbeFixture("geometry-absent");
  const frozen = freeze(fixture, fixture.state, { focusRefs: [FEATURE] });
  const missing = "feature:wake:candles";
  assert.equal(authorityGeometryFeatureComposite(fixture.state, missing), undefined);
  assert.equal(authorityRevisionOrHash(fixture.state, missing), null);
  assert.equal(index(fixture.state).nodes.has(missing), false);
  const rejected = lower(fixture, frozen, observation(missing));
  assert.equal(rejected.kind, "rejected");
  const deleted = structuredClone(fixture.state);
  geometry(deleted).obstacles = [];
  assert.equal(authorityRevisionOrHash(deleted, FEATURE), null);
  assert.equal(index(deleted).nodes.has(FEATURE), false);
  assert.equal(lower(fixture, frozen, observation(), deleted).kind, "rejected");
});

test("feature state, polygon, visibility, deletion and scene relocation all invalidate the frozen Rules read", () => {
  const fixture = createAuthoredProbeFixture("geometry-version");
  const frozen = freeze(fixture, fixture.state, { focusRefs: [FEATURE] });
  const lowered = lower(fixture, frozen);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const selected = selectPlanReadSet(frozen.context, [FEATURE]);
  assert.equal(selected.kind, "accepted");
  for (const mutate of [
    (state) => { geometry(state).obstacles[0].state = "altered"; },
    (state) => { geometry(state).obstacles[0].polygon[0].x = "146"; },
    (state) => { geometry(state).obstacles[0].visibilityPolicyId = "visibility:hidden-until-evidence"; },
    (state) => { geometry(state).obstacles = []; },
    (state) => {
      state.scenes[OTHER_SCENE] = { ...state.scenes[SCENE], id: OTHER_SCENE };
      state.combatRuntime.scenes[OTHER_SCENE] = structuredClone(state.combatRuntime.scenes[SCENE]);
      geometry(state).obstacles = [];
    },
  ]) {
    const changed = structuredClone(fixture.state);
    mutate(changed);
    assert.ok(authorityReadSetConflicts(changed, selected.readSet).some(({ ref }) => ref === FEATURE));
    const result = stepActionToDecision(fixture.runtime, fixture.profiles, changed, lowered.command.rulesInput);
    assert.equal(result.kind, "rejected", JSON.stringify(result));
    assert.equal(result.rejection.code, "causalFrontierConflict", JSON.stringify(result));
  }
  assert.equal(authoritySpatialBinding(fixture.state, FEATURE, OTHER_SCENE), undefined);
});

test("duplicate feature IDs fail closed and Geometry never shadows another authority identity", () => {
  const fixture = createAuthoredProbeFixture("geometry-collision");
  for (const crossScene of [false, true]) {
    const duplicated = structuredClone(fixture.state);
    if (crossScene) {
      duplicated.scenes[OTHER_SCENE] = { ...duplicated.scenes[SCENE], id: OTHER_SCENE };
      duplicated.combatRuntime.scenes[OTHER_SCENE] = structuredClone(duplicated.combatRuntime.scenes[SCENE]);
    } else geometry(duplicated).obstacles.push(structuredClone(geometry(duplicated).obstacles[0]));
    assert.equal(authorityGeometryFeatureComposite(duplicated, FEATURE), undefined);
    assert.equal(authorityRevisionOrHash(duplicated, FEATURE), null);
    const directory = index(duplicated);
    assert.equal(directory.nodes.has(FEATURE), false);
    assert.equal([...(directory.refsByScene.get(SCENE) ?? [])].includes(FEATURE), false);
  }
  const collision = structuredClone(fixture.state);
  geometry(collision).obstacles[0].featureId = ACTOR;
  assert.equal(authorityGeometryFeatureComposite(collision, ACTOR), undefined);
  assert.equal(index(collision).nodes.get(ACTOR).kind, "entity");
  assert.equal(authorityRevisionOrHash(collision, ACTOR), authorityRevisionOrHash(fixture.state, ACTOR));
});

test("filtered Geometry records still consume the scan budget and exhaustion returns no partial directory", () => {
  const fixture = createAuthoredProbeFixture("geometry-budget");
  const state = structuredClone(fixture.state);
  geometry(state).obstacles = Array.from({ length: 100 }, () => ({ ...geometry(fixture.state).obstacles[0], featureId: ACTOR }));
  const profile = contextWorkBudgetProfile("test:geometry-budget", {
    ...VNEXT_CONTEXT_WORK_BUDGET.limits, scannedRecords: 40,
  }, VNEXT_CONTEXT_WORK_BUDGET.caps);
  const result = buildReferenceIndex(state, createContextWorkBudget(profile));
  assert.equal(result.kind, "preparationLimit");
  assert.equal(result.receipt.exhaustedDimension, "scannedRecords");
  assert.equal("index" in result, false);
});
