import assert from "node:assert/strict";
import test from "node:test";

import { authoritativeModuleProfile } from "../../../app/_runtime/lib/module/authoritative.ts";
import { freezeAdjudicationContext } from "../../../app/_runtime/lib/kp/vnext/context/index.ts";
import { resolveAvailability } from "../../../app/_runtime/lib/kp/vnext/context/availability.ts";
import { buildReferenceIndex } from "../../../app/_runtime/lib/kp/vnext/context/reference-index.ts";
import { createContextWorkBudget } from "../../../app/_runtime/lib/kp/vnext/context/work-budget.ts";
import { VNEXT_PRECEDENT_CONDITION_SCHEMA } from "../../../app/_runtime/lib/kp/vnext/context/precedent-applicability.ts";
import { selectPlanReadSet } from "../../../app/_runtime/lib/kp/vnext/proposals.ts";
import { validateVNextTransactionReadSet } from "../../../app/_runtime/lib/kp/vnext/required-context-runtime.ts";
import { authorityRevisionOrHash } from "../../../app/_runtime/lib/rules/authority-read.ts";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST as PROFILES } from "../../../app/_runtime/lib/rules/profiles/vnext-world-interaction.ts";
import { createDefinitionSnapshot, storedSemanticDefinition } from "../../../app/_runtime/lib/rules/v2/semantic-definitions.ts";

const moduleProfile = await authoritativeModuleProfile("black-oak-will");
const SCENE = moduleProfile.storyBible.storyAnchors.locations[0].sceneId;
const ACTOR = "character:context-runtime";
const TARGET = "feature:weather-vane";
const PROFILE_REF = `profile-context:${moduleProfile.moduleRef.profileId}`;

function feature(ref, content) {
  const snapshot = createDefinitionSnapshot(ref, "1", { sceneRef: SCENE, ...content });
  return storedSemanticDefinition("sceneFeature", "visibility:scene-observers", snapshot, {
    templateRef: "template:sceneFeature", templateHash: snapshot.definitionHash,
  });
}

function world() {
  return {
    schema: "zhuwei.authoritative-world-state/v2", version: "1", roomId: "room:context-runtime",
    runtimeEpochId: "epoch:context-runtime", activeBranchId: "branch:main",
    fictionTimelines: { "branch:main": { branchId: "branch:main", nowMicros: "0" } },
    multiplayerRuntime: { characterTimelineIds: {} },
    scenes: { [SCENE]: { id: SCENE } },
    entities: { [ACTOR]: { id: ACTOR, kind: "player", name: "旅人", sceneId: SCENE, tenureStatus: "active" } },
    canonicalFacts: {}, knowledge: {},
    campaignRuntime: {
      campaign: { campaignId: "campaign:runtime", moduleRef: moduleProfile.moduleRef },
      definitions: { [TARGET]: feature(TARGET, { label: "铜制风向标", description: "随风缓缓旋转。" }) },
      itemSystem: { entries: {}, definitions: {} }, adjudicationPrecedents: {},
    },
    combatRuntime: { entities: {}, scenes: {}, definitions: {}, effects: {} },
  };
}

function freeze(state, overrides = {}) {
  return freezeAdjudicationContext({
    state, profiles: PROFILES, moduleProfile,
    kpProjection: { kind: "projected", viewer: { kind: "kp" }, stateVersion: state.version,
      activeBranchId: state.activeBranchId, projectionHash: `sha256:${"a".repeat(64)}`, spatialEvidence: {} },
    replayHead: { eventSeq: "4", stateHash: `sha256:${"b".repeat(64)}` },
    preparedActionId: "prepared:runtime", rootActionId: "root:runtime", submissionRef: "submission:runtime",
    actorCharacterId: ACTOR, intentText: "我转动铜制风向标", maxUnits: 16_000, ...overrides,
  });
}

function ready(state, overrides) {
  const result = freeze(state, overrides);
  assert.equal(result.kind, "ready", JSON.stringify(result));
  return result.context;
}

function absence(state, ref = "feature:second-exit", basisRefs = [SCENE]) {
  return {
    id: "fact:survey-result", kind: "localAbsence", branchId: state.activeBranchId,
    subjectRefs: [SCENE], causalParentIds: [], visibilityPolicyId: "visibility:scene-observers",
    value: { scopeRef: SCENE, status: "active", scopeRevisionOrHash: authorityRevisionOrHash(state, SCENE),
      selector: { kind: "exactRef", ref }, basisRefs },
  };
}

test("runtime freezes only scoped module constraints and real candidates, with a versioned creation permission", () => {
  const state = world();
  for (let index = 0; index < 40; index += 1) {
    state.campaignRuntime.definitions[`feature:unrelated-${index}`] = feature(`feature:unrelated-${index}`,
      { label: `无关摆设${index}`, description: "普通装饰。" });
  }
  const context = ready(state);
  const profile = context.entries.find(({ entryRef }) => entryRef === PROFILE_REF);
  assert.equal(profile.kind, "known");
  assert.equal(profile.value.coreTruth, moduleProfile.storyBible.coreTruth);
  assert.equal(profile.value.currentLocationAnchor.sceneId, SCENE);
  assert.equal(profile.value.currentLocationAnchor.sceneIds, undefined);
  assert.ok(context.entries.some(({ kind, entryRef }) => kind === "known" && entryRef === TARGET));
  assert.ok(!context.entries.some(({ entryRef }) => entryRef.includes("feature:unrelated-")));
  const permission = context.entries.find(({ kind }) => kind === "openBlank");
  assert.equal(permission.scopeRef, SCENE);
  assert.equal(permission.authorizationRef, PROFILE_REF);
  assert.deepEqual(new Set(permission.basisRefs), new Set([SCENE, PROFILE_REF]));
  assert.ok(permission.allowedKinds.includes("item"));
  assert.ok(!context.references.citations.viewerEvidenceRefs.includes(PROFILE_REF));

  const read = selectPlanReadSet(context, permission.basisRefs);
  assert.equal(read.kind, "accepted");
  assert.equal(validateVNextTransactionReadSet(read.readSet, state).kind, "valid");
  state.campaignRuntime.campaign.moduleRef = { ...moduleProfile.moduleRef, profileHash: `sha256:${"c".repeat(64)}` };
  assert.equal(validateVNextTransactionReadSet(read.readSet, state).kind, "conflict");
});

test("an unmatched natural-language target remains unknown; scope permission never asserts it exists or is absent", () => {
  const context = ready(world(), { intentText: "我寻找一支可以封存声音的羽毛" });
  assert.ok(context.entries.some(({ kind }) => kind === "openBlank"));
  assert.ok(context.entries.filter(({ kind }) => kind === "knownAbsent")
    .every(({ entryRef }) => entryRef.startsWith("availability:precedent:")));
  assert.ok(!context.entries.some(({ kind, entryRef }) => kind === "known" && entryRef === TARGET));
});

test("runtime preserves materially different matching candidates and withholds permission on a truncated search", () => {
  const state = world();
  const other = "feature:second-weather-vane";
  state.campaignRuntime.definitions[other] = feature(other,
    { label: "铜制风向标", description: "底部开裂，转动时晃动。" });
  const context = ready(state, { intentText: "铜制风向标" });
  const ambiguity = context.entries.find(({ kind }) => kind === "ambiguous");
  assert.ok(ambiguity);
  assert.deepEqual(new Set(ambiguity.candidates.map(({ ref }) => ref)), new Set([TARGET, other]));

  state.campaignRuntime.definitions[other] = feature(other,
    { label: "铜制风向标", description: "不能截断的相关内容。".repeat(400) });
  const limited = ready(state);
  assert.ok(!limited.entries.some(({ kind }) => kind === "openBlank"));
  assert.ok(limited.entries.some(({ kind, reason, critical }) => kind === "unavailable"
    && reason === "truncated" && critical === false));
});

test("active scoped denials derive their own selectors and freeze their authority basis", () => {
  const state = world();
  const fact = absence(state);
  fact.subjectRefs = [];
  state.canonicalFacts[fact.id] = fact;
  const context = ready(state);
  const denial = context.entries.find(({ entryRef }) => entryRef === `availability:${fact.id}`);
  assert.equal(denial.kind, "knownAbsent");
  assert.deepEqual(denial.selector, fact.value.selector);
  assert.ok(denial.basisRefs.includes(fact.id));
  assert.equal(selectPlanReadSet(context, denial.basisRefs).kind, "accepted");
});

test("a positive object contradicting an active denial blocks instead of offering an ambiguous choice", () => {
  const state = world();
  const fact = absence(state, TARGET);
  state.canonicalFacts[fact.id] = fact;
  const result = freeze(state);
  assert.equal(result.kind, "blocked");
  assert.equal(result.reason, "integrityConflict");
});

test("a decisive denial with unreadable evidence fails closed, while stale or foreign-branch denial proves nothing", () => {
  const state = world();
  const fact = absence(state, "feature:second-exit", ["fact:missing-survey"]);
  state.canonicalFacts[fact.id] = fact;
  assert.equal(freeze(state).reason, "criticalUnavailable");
  fact.value.basisRefs = [SCENE];
  fact.value.scopeRevisionOrHash = "stale";
  assert.ok(!ready(state).entries.some(({ entryRef }) => entryRef === `availability:${fact.id}`));
  fact.value.scopeRevisionOrHash = authorityRevisionOrHash(state, SCENE);
  fact.branchId = "branch:historical";
  assert.ok(!ready(state).entries.some(({ entryRef }) => entryRef === `availability:${fact.id}`));
});

test("module ID/hash binding and the complete registered body are both required", () => {
  const state = world();
  const mutated = structuredClone(moduleProfile);
  mutated.storyBible.openBlanks.push("假冒新授权");
  const result = freeze(state, { moduleProfile: mutated });
  assert.equal(result.kind, "blocked");
  assert.equal(result.reason, "integrityConflict");
  assert.deepEqual(result.issues, ["moduleProfile:content-hash-mismatch"]);
  state.campaignRuntime.campaign.moduleRef = { ...moduleProfile.moduleRef, profileHash: `sha256:${"c".repeat(64)}` };
  assert.equal(freeze(state).reason, "integrityConflict");
});

test("runtime resolves structural precedents and lineage without reading unrelated-scope bodies", () => {
  const state = world();
  const conditionSignature = { schema: VNEXT_PRECEDENT_CONDITION_SCHEMA,
    scope: { kind: "scene", ref: SCENE }, formId: "world-interaction.vnext-1",
    targetRefs: [TARGET], instrumentRefs: [], relationRefs: [] };
  state.campaignRuntime.adjudicationPrecedents = {
    current: { precedentId: "current", status: "active", conditionSignature,
      mechanics: { operation: "resolveNoncombatCheck", dc: 11 }, supersededPrecedentId: "old" },
    old: { precedentId: "old", status: "superseded", conditionSignature,
      mechanics: { operation: "resolveNoncombatCheck", dc: 14 }, supersededByPrecedentId: "current" },
    elsewhere: { precedentId: "elsewhere", status: "active", conditionSignature: { ...conditionSignature,
      scope: { kind: "scene", ref: "scene:unrelated" } }, mechanics: { description: "irrelevant".repeat(8_000) } },
  };
  const context = ready(state);
  assert.ok(context.entries.some(({ entryRef }) => entryRef === "continuity:adjudicationPrecedents:current"));
  assert.ok(context.entries.some(({ entryRef }) => entryRef === "continuity:adjudicationPrecedents:old"));
  assert.ok(!context.entries.some(({ entryRef }) => entryRef === "continuity:adjudicationPrecedents:elsewhere"));
  assert.ok(JSON.stringify(context).length < 20_000);
  assert.ok(!JSON.stringify(context).includes("irrelevant"));
});

// SPEC 0004 §11 (ADR 0083): a ruling record travels when it ruled on what
// the words name, or when it is the actor's latest ruling here; at most six,
// newest first. The question history is frozen for the server alone.
function ruling(id, actor, seq, targetRefs, scene = SCENE) {
  return { schema: "zhuwei.ruling-precedent/vnext-1", precedentId: id, rulingEventId: `event:${id}`, actorCharacterId: actor,
    conditionSignature: { schema: VNEXT_PRECEDENT_CONDITION_SCHEMA, scope: { kind: "scene", ref: scene },
      formId: "world-interaction.vnext-1", targetRefs, instrumentRefs: [] },
    canonicalContextFingerprint: `sha256:${"e".repeat(64)}`, intent: "转动风向标", method: "用手推", publicExplanation: "风向标卡住了。",
    privateBasisRefs: [], rulesetProfile: { profileId: "ruleset:test", profileHash: `sha256:${"f".repeat(64)}` },
    ruling: { kind: "check", resolutionId: `resolution:${id}`, abilityRef: null, checkKind: "ability", ability: "strength", skill: null, dc: 12,
      durationMicros: null, outcomeRange: { success: "转动了。", failure: "没转动。" }, outcome: "failure" },
    status: "active", rootActionId: `root:${id}`, recordedEventSeq: String(seq) };
}

test("a ruling travels when it names what the words name or is the actor's latest here, newest six", () => {
  const state = world(), OTHER = "character:someone-else";
  const records = [ruling("named-old", ACTOR, 5, [TARGET]), ruling("own-latest", ACTOR, 9, ["feature:elsewhere-in-scene"]),
    ruling("unnamed-other", OTHER, 7, ["feature:elsewhere-in-scene"]), ruling("other-scene", OTHER, 30, [TARGET], "scene:unrelated"),
    ...[10, 11, 12, 13, 14, 15, 16].map(seq => ruling(`named-${seq}`, OTHER, seq, [TARGET]))];
  state.campaignRuntime.adjudicationPrecedents = Object.fromEntries(records.map(record => [record.precedentId, record]));
  const context = ready(state);
  const sent = context.entries.flatMap(({ entryRef }) => entryRef.startsWith("continuity:adjudicationPrecedents:")
    ? [entryRef.slice("continuity:adjudicationPrecedents:".length)] : []).sort();
  assert.deepEqual(sent, ["named-12", "named-13", "named-14", "named-15", "named-16", "own-latest"]);
  assert.ok(!context.entries.some(({ entryRef }) => entryRef.startsWith("retry-history:")));
  assert.ok(!context.entries.some(({ entryRef }) => entryRef === `availability:precedent:${SCENE}`));
  const asked = ready(world(), { retryHistory: { askedRefs: ["named-old"], answeredRootActionIds: ["root:answered"] } });
  assert.deepEqual(asked.entries.find(({ entryRef }) => entryRef === `retry-history:${ACTOR}`).value,
    { schema: "zhuwei.retry-question-history/v1", actorRef: ACTOR, askedRefs: ["named-old"], answeredRootActionIds: ["root:answered"] });
});

test("a relevant legacy fingerprint without structural conditions cannot silently supply applicability", () => {
  const state = world();
  state.campaignRuntime.adjudicationPrecedents.legacy = { precedentId: "legacy", status: "active",
    applicabilityScope: { kind: "scene", ref: SCENE }, canonicalContextFingerprint: `sha256:${"d".repeat(64)}` };
  const result = freeze(state);
  assert.equal(result.kind, "blocked");
  assert.equal(result.reason, "criticalUnavailable");
});

test("item, NPC and hazard instances participate in typed presence conflicts, while a template alone does not", () => {
  for (const semanticKind of ["item", "npc", "hazard"]) {
    const state = world();
    const ref = `instance:${semanticKind}`;
    if (semanticKind === "item") {
      state.campaignRuntime.itemSystem.entries[ref] = { entryId: ref, definitionRef: "definition:ordinary-item",
        definitionRevision: "1", sceneRef: SCENE, holderRef: null, quantity: 1, disposition: "scene" };
    } else if (semanticKind === "npc") {
      state.entities[ref] = { id: ref, kind: "npc", sceneId: SCENE, tenureStatus: "active" };
    } else {
      state.campaignRuntime.definitions[ref] = {
        definitionId: ref, definitionKind: "environmentHazard", revision: "1", rulesBasis: "srd5.1-2014",
        visibilityPolicyRef: "visibility:public", causalBasisRefs: [], content: {
          schema: "zhuwei.environment-hazard-definition/v1", label: "定向热流",
          trigger: { kind: "contactFeature", ref: TARGET }, mechanicsRef: "ability:hot-air",
          perceptibleSigns: ["热气拂面"], disableMethods: ["封闭管路"], environmentalConsequences: [],
        },
      };
    }
    const fact = absence(state);
    fact.value.selector = { kind: "semanticKind", semanticKind };
    state.canonicalFacts[fact.id] = fact;
    const index = buildReferenceIndex(state, createContextWorkBudget()).index;
    const outcome = resolveAvailability({ state, index, authorizations: [], loadedRefs: new Set([SCENE]),
      frontierExhausted: true, requirement: { entryRef: `availability:${semanticKind}`, obligation: "target",
        scopeRef: SCENE, selector: fact.value.selector, allowedKinds: [] } });
    assert.equal(outcome.kind, "integrityConflict", `${semanticKind}: ${JSON.stringify(outcome)}`);
  }
  const state = world();
  state.campaignRuntime.itemSystem.definitions["definition:only-a-template"] = {
    definitionId: "definition:only-a-template", content: { label: "尚未生成的物品" },
  };
  const fact = absence(state);
  fact.value.selector = { kind: "semanticKind", semanticKind: "item" };
  state.canonicalFacts[fact.id] = fact;
  const index = buildReferenceIndex(state, createContextWorkBudget()).index;
  const outcome = resolveAvailability({ state, index, authorizations: [], loadedRefs: new Set([SCENE]),
    frontierExhausted: true, requirement: { entryRef: "availability:item", obligation: "target", scopeRef: SCENE,
      selector: fact.value.selector, allowedKinds: [] } });
  assert.equal(outcome.kind, "entry");
  assert.equal(outcome.entry.kind, "knownAbsent");
});
