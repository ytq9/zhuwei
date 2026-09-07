import assert from "node:assert/strict";
import test from "node:test";
import { freezeAdjudicationContext } from "../app/_runtime/lib/kp/vnext/context/index.ts";
import { buildReferenceIndex } from "../app/_runtime/lib/kp/vnext/context/reference-index.ts";
import { discoverCandidates } from "../app/_runtime/lib/kp/vnext/context/candidate-discovery.ts";
import { retrievalProfile, VNEXT_RETRIEVAL_PROFILE } from "../app/_runtime/lib/kp/vnext/context/extractors.ts";
import { createContextWorkBudget, contextWorkBudgetProfile, VNEXT_CONTEXT_WORK_BUDGET } from "../app/_runtime/lib/kp/vnext/context/work-budget.ts";
import { authorityRevisionOrHash } from "../app/_runtime/lib/rules/authority-read.ts";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST as PROFILES } from "../app/_runtime/lib/rules/profiles/vnext-world-interaction.ts";
import { createDefinitionSnapshot, storedSemanticDefinition } from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";
import { NARRATIVE_DETAIL_SCHEMA, committedNarrativeFact, narrativeBindingRef } from "../app/_runtime/lib/rules/v2/narrative-commitments.ts";
import { createInitialItemEntry, healingPotionItemDefinition } from "../app/_runtime/lib/rules/v2/items.ts";

const ACTOR = "character:narrative-reader", OTHER = "character:other-reader", SCENE = "scene:gallery", AWAY = "scene:hall";
const CUP = "narrative-detail:cup", PATTERN = "narrative-detail:pattern";
function world() {
  return {
    schema: "zhuwei.authoritative-world-state/v2", version: "1", roomId: "room:narrative-context",
    runtimeEpochId: "epoch:narrative", activeBranchId: "branch:main",
    fictionTimelines: { "branch:main": { branchId: "branch:main", nowMicros: "0" } },
    multiplayerRuntime: { characterTimelineIds: {} },
    scenes: { [SCENE]: { id: SCENE }, [AWAY]: { id: AWAY } },
    entities: { [ACTOR]: { id: ACTOR, kind: "player", name: "旅人", sceneId: SCENE, tenureStatus: "active" } },
    canonicalFacts: {}, knowledge: {},
    campaignRuntime: { campaign: null, definitions: {}, itemSystem: { entries: {}, definitions: {} }, adjudicationPrecedents: {} },
    combatRuntime: { entities: {}, scenes: {}, definitions: {}, effects: {} },
  };
}
function detail(state, ref = CUP, options = {}) {
  const value = { schema: NARRATIVE_DETAIL_SCHEMA, sceneRef: SCENE, label: "银耳酒杯", description: "柜顶摆着一只细柄银杯。",
    audience: "sceneObservers", audienceCharacterIds: [ACTOR], basisRefs: [SCENE], ...options };
  state.canonicalFacts[ref] = committedNarrativeFact({ actorCharacterId: ACTOR, commitmentRef: ref,
    proposalRef: `proposal:${ref}`, contextHash: `sha256:${"a".repeat(64)}`, detail: value },
  { branchId: state.activeBranchId, eventSeq: "1", eventId: `event:${ref}` });
  return value;
}
function freeze(state, overrides = {}) {
  return freezeAdjudicationContext({ state, profiles: PROFILES,
    kpProjection: { viewer: { kind: "kp" }, stateVersion: state.version, activeBranchId: state.activeBranchId,
      projectionHash: `sha256:${"a".repeat(64)}` },
    replayHead: { eventSeq: state.version, stateHash: `sha256:${"b".repeat(64)}` },
    preparedActionId: "prepared:narrative", rootActionId: "root:narrative", submissionRef: "submission:narrative",
    actorCharacterId: ACTOR, intentText: "我安静地等候。", maxUnits: 80_000, ...overrides });
}
function ready(state, overrides) {
  const result = freeze(state, overrides);
  assert.equal(result.kind, "ready", JSON.stringify(result));
  return result;
}
function entry(frozen, ref) { return frozen.context.entries.find((item) => item.kind === "known" && item.entryRef === ref); }
function index(state) {
  const result = buildReferenceIndex(state, createContextWorkBudget());
  assert.equal(result.kind, "indexed"); return result.index;
}

test("all current-scene published commitments survive zero lexical hits and age without acquiring mechanical identities", () => {
  const state = world();
  for (let i = 0; i < 70; i += 1) detail(state, `narrative-detail:old-${i}`, { label: `陈设编号${i}`, description: `编号${i}的陈设拥有独立外观。` });
  const frozen = ready(state);
  for (let i = 0; i < 70; i += 1) {
    const ref = `narrative-detail:old-${i}`;
    assert.deepEqual(entry(frozen, ref).value, state.canonicalFacts[ref]);
    assert.equal(entry(frozen, ref).revisionOrHash, authorityRevisionOrHash(state, ref));
    assert.ok(frozen.context.references.citations.viewerEvidenceRefs.includes(ref));
    assert.equal(frozen.context.references.domains.semanticRefs.includes(ref), false);
  }
  assert.equal(frozen.context.intent.narrativeMaterializationRefs, undefined);
  assert.deepEqual(frozen.context.binding.readSet, []);
  assert.ok(frozen.coverage.obligations.some(({ obligation, refCount, resolved }) => obligation === "narrativeContinuity" && refCount === 70 && resolved));
  state.canonicalFacts["narrative-detail:old-0"].value.description = "后续状态不能改写先前冻结正文。";
  assert.equal(entry(frozen, "narrative-detail:old-0").value.value.description, "编号0的陈设拥有独立外观。");
});

test("object and spatial descriptions share exact-label, lexical and focus materialization obligations", () => {
  const state = world(); detail(state);
  detail(state, PATTERN, { label: "曲线壁纹", description: "墙面图案呈现两条交错鱼尾。" });
  const directory = index(state);
  assert.equal(directory.nodes.get(CUP).kind, "narrativeCommitment");
  assert.equal(directory.nodes.get(PATTERN).kind, "narrativeCommitment");
  for (const [text, refs] of [["我调查银耳酒杯。", [CUP]], ["我沿着曲线壁纹观察。", [PATTERN]],
    ["我对比银耳酒杯和曲线壁纹。", [CUP, PATTERN]], ["我查看交错鱼尾。", [PATTERN]]]) {
    const frozen = ready(state, { intentText: text });
    assert.deepEqual(frozen.context.intent.narrativeMaterializationRefs, [...refs].sort());
  }
  assert.deepEqual(ready(state, { focusRefs: [CUP] }).context.intent.narrativeMaterializationRefs, [CUP]);
});

test("remembered details are retrieved across scenes while unrelated history stays outside the frozen context", () => {
  const state = world(); detail(state);
  detail(state, PATTERN, { label: "远处壁纹", description: "竖直线纹在旧房间墙上。", sceneRef: AWAY });
  assert.equal(entry(ready(state), PATTERN), undefined);
  const remembered = ready(state, { intentText: "我回想远处壁纹。" });
  assert.ok(entry(remembered, PATTERN));
  state.entities[ACTOR].sceneId = AWAY;
  assert.equal(entry(ready(state), CUP), undefined);
  const recalled = ready(state, { intentText: "先前银耳酒杯的外观是什么？" });
  assert.deepEqual(entry(recalled, CUP).value, state.canonicalFacts[CUP]);
  state.entities[ACTOR].sceneId = SCENE;
  assert.deepEqual(entry(ready(state), CUP).value, state.canonicalFacts[CUP]);
});

test("another player's private publication is excluded from search and context, including guessed focus", () => {
  const state = world(); detail(state, CUP, { audience: "actorOnly", audienceCharacterIds: [OTHER], description: "不得泄漏的私人倒影。" });
  const frozen = ready(state, { intentText: "我看银耳酒杯里的私人倒影。" });
  assert.equal(entry(frozen, CUP), undefined);
  assert.equal(JSON.stringify(frozen).includes("私人倒影"), true, "only the player's own submitted words can remain");
  assert.equal(JSON.stringify(frozen).includes("不得泄漏"), false);
  const discovered = discoverCandidates({ state, index: index(state), subject: { kind: "character", characterRef: ACTOR, sceneRef: SCENE },
    focusRefs: [CUP], intentText: "银耳酒杯", profile: VNEXT_RETRIEVAL_PROFILE, budget: createContextWorkBudget() });
  assert.equal(discovered.kind, "discovered"); assert.deepEqual(discovered.candidates, []);
  const rejected = freeze(state, { focusRefs: [CUP] });
  assert.equal(rejected.kind, "blocked"); assert.equal(rejected.reason, "criticalUnavailable");
  assert.equal(JSON.stringify(rejected).includes(CUP), false);
  assert.equal(JSON.stringify(rejected).includes("不得泄漏"), false);
});

test("materialized commitments keep immutable text while closing over the separate binding and current authority object", () => {
  const state = world(); const source = detail(state);
  const actual = "feature:materialized-cup", binding = narrativeBindingRef(CUP);
  const snapshot = createDefinitionSnapshot(actual, "1", { sceneRef: SCENE, label: source.label, description: source.description, observableState: "杯柄已弯曲。" });
  state.campaignRuntime.definitions[actual] = storedSemanticDefinition("sceneFeature", "visibility:scene-observers", snapshot,
    { templateRef: "template:sceneFeature", templateHash: snapshot.definitionHash });
  state.canonicalFacts[binding] = { id: binding, kind: "narrativeMaterialization", subjectRefs: [CUP, actual],
    value: { commitmentRef: CUP, materializedRef: actual }, visibilityPolicyId: `visibility:narrative:${CUP}`, branchId: state.activeBranchId };
  const frozen = ready(state, { focusRefs: [CUP] });
  assert.deepEqual(entry(frozen, CUP).value, state.canonicalFacts[CUP]);
  assert.deepEqual(entry(frozen, binding).value, state.canonicalFacts[binding]);
  assert.equal(entry(frozen, actual).value.content.observableState, "杯柄已弯曲。");
  assert.equal(frozen.context.intent.narrativeMaterializationRefs, undefined);
  assert.deepEqual(frozen.context.binding.readSet, []);
  delete state.campaignRuntime.definitions[actual];
  assert.equal(freeze(state).reason, "criticalUnavailable");
});

test("budget exhaustion and invalid published content block instead of truncating decisive continuity", () => {
  const state = world(); detail(state, CUP, { description: "这段已经公开的描述必须完整保存。".repeat(50) });
  const full = ready(state);
  assert.equal(freeze(state, { maxUnits: full.coverage.unitsUsed - 1 }).reason, "contextBudgetExceeded");
  const capped = contextWorkBudgetProfile("test:narrative-cap", VNEXT_CONTEXT_WORK_BUDGET.limits, { maxEntryRereadBytes: 512 });
  assert.equal(freeze(state, { workProfile: capped }).reason, "criticalUnavailable");
  const exhausted = contextWorkBudgetProfile("test:narrative-work", { ...VNEXT_CONTEXT_WORK_BUDGET.limits, postingVisits: 1 }, VNEXT_CONTEXT_WORK_BUDGET.caps);
  assert.equal(freeze(state, { workProfile: exhausted }).reason, "preparationLimit");
  state.canonicalFacts[CUP].value.description = "";
  assert.equal(freeze(state).reason, "criticalUnavailable");
});

test("consumed, destroyed, relocated and privately transferred items retain continuity without renewing viewer grants", () => {
  const state = world(); const source = detail(state);
  state.entities[OTHER] = { ...state.entities[ACTOR], id: OTHER, sceneId: AWAY };
  const definition = healingPotionItemDefinition();
  definition.content = { ...definition.content, label: source.label, description: source.description, use: null };
  state.campaignRuntime.itemSystem.definitions[definition.definitionId] = definition;
  const actual = "item-entry:narrative-cup", binding = narrativeBindingRef(CUP);
  const initial = createInitialItemEntry(definition, { entryId: actual, placement: { kind: "scene", sceneRef: SCENE },
    quantity: 1, ownership: { kind: "unowned", ownerRef: null } });
  state.canonicalFacts[binding] = { id: binding, kind: "narrativeMaterialization", subjectRefs: [CUP, actual],
    value: { commitmentRef: CUP, materializedRef: actual }, visibilityPolicyId: `visibility:narrative:${CUP}`, branchId: state.activeBranchId };
  for (const change of [
    { disposition: "consumed", holderRef: null, sceneRef: null, quantity: 0 },
    { disposition: "destroyed", holderRef: null, sceneRef: null, quantity: 0, condition: "broken" },
    { disposition: "scene", holderRef: null, sceneRef: AWAY },
    { disposition: "held", holderRef: OTHER, sceneRef: null, visibilityPolicyRef: `visibility:character-controller:${OTHER}` },
  ]) {
    state.campaignRuntime.itemSystem.entries[actual] = { ...initial, ...change };
    const frozen = ready(state);
    assert.deepEqual(entry(frozen, CUP).value.value, source);
    assert.equal(entry(frozen, actual).value.disposition, change.disposition);
    assert.equal(entry(frozen, actual).value.sceneRef, change.sceneRef);
    assert.equal(frozen.context.intent.narrativeMaterializationRefs, undefined);
    assert.equal(frozen.context.references.citations.viewerEvidenceRefs.includes(actual), false);
    assert.ok(frozen.context.references.citations.authorityBasisRefs.includes(actual));
  }
});

test("ambiguous and truncated discovery never silently chooses a materialization identity", () => {
  const state = world(); detail(state);
  detail(state, "narrative-detail:another-cup");
  const ambiguous = ready(state, { intentText: "我拿起银耳酒杯。" });
  assert.equal(ambiguous.context.intent.narrativeMaterializationRefs, undefined);
  const choices = ambiguous.context.entries.find(({ kind }) => kind === "ambiguous");
  assert.ok(choices);
  assert.equal(choices.viewerSafe, true, "published descriptions can be discussed without acquiring mechanical reach");
  const tiny = retrievalProfile("test:narrative-candidates", { ...VNEXT_RETRIEVAL_PROFILE.tokenizer, maxCandidates: 1 }, VNEXT_RETRIEVAL_PROFILE.extractors);
  const truncated = ready(state, { intentText: "我拿起银耳酒杯。", retrievalProfile: tiny });
  assert.ok(entry(truncated, CUP)); assert.ok(entry(truncated, "narrative-detail:another-cup"));
  assert.equal(truncated.context.intent.narrativeMaterializationRefs, undefined);
  assert.ok(truncated.coverage.droppedCandidateCount > 0);
});
