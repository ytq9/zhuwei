import assert from "node:assert/strict";
import test from "node:test";

import { freezeAdjudicationContext } from "../app/_runtime/lib/kp/vnext/context/index.ts";
import {
  contextWorkBudgetProfile,
  VNEXT_CONTEXT_WORK_BUDGET,
} from "../app/_runtime/lib/kp/vnext/index.ts";
import {
  createDefinitionSnapshot,
  storedSemanticDefinition,
} from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";

const SCENE = "scene:hall";
const ALICE = "character:alice";
const CHANDELIER = "feature:chandelier";
const CHAIN = "feature:chain";
const BEAM = "feature:beam";
const INTENT = "我用枪打吊灯";

function sceneFeature(definitionRef, content) {
  const snapshot = createDefinitionSnapshot(definitionRef, "1", content);
  return storedSemanticDefinition("sceneFeature", "visibility:scene-observers", snapshot, {
    templateRef: "template:sceneFeature",
    templateHash: snapshot.definitionHash,
  });
}

function relation(definitionRef, kind, subjectRef, objectRef) {
  const content = { relationRef: definitionRef, kind, subjectRef, objectRef, state: "active" };
  const snapshot = createDefinitionSnapshot(definitionRef, "1", content);
  return storedSemanticDefinition("worldRelation", "visibility:scene-observers", snapshot, {
    templateRef: "template:worldRelation",
    templateHash: snapshot.definitionHash,
  });
}

function worldState({ noise = 0, tenureStatus = "active" } = {}) {
  const definitions = {
    [CHANDELIER]: sceneFeature(CHANDELIER, {
      sceneRef: SCENE,
      label: "悬挂吊灯",
      description: "沉重吊灯悬在房间中央。",
      observableState: "悬挂在半空",
      affordances: [],
    }),
    [CHAIN]: sceneFeature(CHAIN, {
      sceneRef: SCENE,
      label: "吊灯铁链",
      description: "一条把吊灯固定在横梁上的旧铁链。",
      observableState: "仍在承重",
      affordances: [],
    }),
    [BEAM]: sceneFeature(BEAM, {
      sceneRef: SCENE,
      label: "横梁",
      description: "承住铁链的橡木横梁。",
      observableState: "完好",
      affordances: [],
    }),
    "relation:beam-supports-chain": relation(
      "relation:beam-supports-chain", "supports", BEAM, CHAIN,
    ),
    "relation:chain-supports-chandelier": relation(
      "relation:chain-supports-chandelier", "supports", CHAIN, CHANDELIER,
    ),
  };
  for (let index = 0; index < noise; index += 1) {
    const ref = `feature:noise-${index}`;
    definitions[ref] = sceneFeature(ref, {
      sceneRef: SCENE,
      label: `摆设${index}`,
      description: "与本次行动无关的陈设。",
      observableState: "静置",
      affordances: [],
    });
  }
  return {
    schema: "zhuwei.authoritative-world-state/v2",
    version: "v:1",
    runtimeEpochId: "epoch:1",
    activeBranchId: "branch:main",
    scenes: { [SCENE]: { id: SCENE } },
    entities: {
      [ALICE]: { id: ALICE, kind: "player", name: "艾丽丝", sceneId: SCENE, tenureStatus },
    },
    canonicalFacts: {},
    knowledge: {},
    campaignRuntime: {
      campaign: null,
      definitions,
      itemSystem: { entries: {}, definitions: {} },
      adjudicationPrecedents: {},
      chapters: { "chapter:one": { chapterId: "chapter:one", summary: "第一章" } },
      stories: { "story:main": { storyId: "story:main" } },
    },
    combatRuntime: { entities: {}, scenes: {}, definitions: {} },
  };
}

function kpProjection(state, overrides = {}) {
  return {
    kind: "projected",
    viewer: { kind: "kp", capability: "internal:kp-spatial-evidence" },
    stateVersion: state.version,
    activeBranchId: state.activeBranchId,
    projectionHash: `sha256:${"a".repeat(64)}`,
    spatialEvidence: {},
    ...overrides,
  };
}

const PROFILES = {
  manifest: { profileId: "profile:manifest", profileHash: `sha256:${"1".repeat(64)}` },
  ruleset: { profileId: "profile:rules", profileHash: `sha256:${"2".repeat(64)}` },
  eventSchema: { profileId: "profile:event", profileHash: `sha256:${"3".repeat(64)}` },
  abilityCompiler: { profileId: "profile:ability", profileHash: `sha256:${"4".repeat(64)}` },
  geometry: { profileId: "profile:geometry", profileHash: `sha256:${"5".repeat(64)}` },
  triggerOrdering: { profileId: "profile:trigger", profileHash: `sha256:${"6".repeat(64)}` },
  fictionCombatTime: { profileId: "profile:time", profileHash: `sha256:${"7".repeat(64)}` },
  extensions: [],
};

function freeze(state, overrides = {}) {
  return freezeAdjudicationContext({
    state,
    profiles: PROFILES,
    kpProjection: overrides.kpProjection ?? kpProjection(state),
    replayHead: { eventSeq: "7", stateHash: `sha256:${"b".repeat(64)}` },
    preparedActionId: "prepared-action:s1",
    rootActionId: "root:s1",
    submissionRef: "submission:s1",
    actorCharacterId: ALICE,
    intentText: overrides.intentText ?? INTENT,
    maxUnits: overrides.maxUnits ?? 160_000,
    ...(overrides.workProfile === undefined ? {} : { workProfile: overrides.workProfile }),
    ...(overrides.focusRefs === undefined ? {} : { focusRefs: overrides.focusRefs }),
  });
}

function entryRefs(result) {
  assert.equal(result.kind, "ready", JSON.stringify(result));
  return result.context.entries.map(({ entryRef }) => entryRef);
}

test("the frozen slice carries the decisive chain and leaves the rest of the scene out", () => {
  const result = freeze(worldState({ noise: 40 }));
  const refs = entryRefs(result);

  for (const ref of [
    ALICE, SCENE, CHANDELIER, CHAIN, BEAM,
    "relation:beam-supports-chain", "relation:chain-supports-chandelier",
  ]) assert.equal(refs.includes(ref), true, `missing decisive ref ${ref}`);

  // 40 unrelated features stand in the same scene. The replaced collector took
  // every one of them; this one takes none.
  assert.equal(refs.some((ref) => ref.startsWith("feature:noise-")), false);
  assert.equal(result.coverage.frontierExhausted, true);
  assert.equal(result.privateReceipt.exhaustedDimension, null);
});

test("narrative continuity domains are not loaded to adjudicate a physical action", () => {
  const refs = entryRefs(freeze(worldState()));

  // Precedent is authoritatively empty rather than absent from the slice, so
  // the KP can tell "no applicable ruling" from "nobody looked".
  assert.equal(refs.includes("continuity:adjudicationPrecedents"), true);
  // Chapters and stories cannot bear on shooting a chandelier.
  assert.equal(refs.includes("continuity:chapters"), false);
  assert.equal(refs.includes("continuity:stories"), false);
});

test("an unresolved reading is frozen with its evidence, not decided", () => {
  const result = freeze(worldState());
  assert.equal(result.kind, "ready");

  const ambiguity = result.context.entries.find(({ kind }) => kind === "ambiguous");
  assert.notEqual(ambiguity, undefined, "吊灯 matches two named objects");
  assert.equal(ambiguity.obligation, "target");
  assert.deepEqual(ambiguity.candidates.map(({ ref }) => ref), [CHAIN, CHANDELIER]);
  assert.equal(ambiguity.candidates[0].score, ambiguity.candidates[1].score);
  assert.equal(ambiguity.frontierExhausted, true);

  // Both readings are still present as read material: reporting ambiguity is
  // not withholding the things it is ambiguous between.
  const refs = entryRefs(result);
  assert.equal(refs.includes(CHAIN) && refs.includes(CHANDELIER), true);
});

test("preparation failures are reported by cause", () => {
  const state = worldState();

  const staleProjection = freeze(state, {
    kpProjection: kpProjection(state, { stateVersion: "v:0" }),
  });
  assert.equal(staleProjection.kind, "blocked");
  assert.equal(staleProjection.reason, "integrityConflict");

  const retired = freeze(worldState({ tenureStatus: "retired" }));
  assert.equal(retired.reason, "invalid");

  const starved = freeze(state, {
    workProfile: contextWorkBudgetProfile(
      "test:starved",
      { ...VNEXT_CONTEXT_WORK_BUDGET.limits, scannedRecords: 2 },
      VNEXT_CONTEXT_WORK_BUDGET.caps,
    ),
  });
  assert.equal(starved.reason, "preparationLimit");
  assert.equal(starved.privateReceipt.exhaustedDimension, "scannedRecords");
  // A blocked preparation never yields a partial context to rule on.
  assert.equal("context" in starved, false);
});

test("the same snapshot and intent always freeze to the same context hash", () => {
  const state = worldState({ noise: 10 });
  const left = freeze(state);
  const right = freeze(state);

  assert.equal(left.context.binding.contextHash, right.context.binding.contextHash);
  assert.deepEqual(left.coverage, right.coverage);
  assert.deepEqual(left.privateReceipt, right.privateReceipt);
});

test("coverage reports every obligation the closure resolved", () => {
  const result = freeze(worldState());
  assert.equal(result.kind, "ready");

  const byObligation = new Map(result.coverage.obligations.map((entry) => [
    entry.obligation,
    entry,
  ]));
  assert.equal(byObligation.get("actor").resolved, true);
  assert.equal(byObligation.get("target").resolved, true);
  assert.equal(byObligation.get("relation").resolved, true);
  assert.equal(byObligation.get("geometry").resolved, true);
  assert.equal(result.coverage.entryStates.known > 0, true);
  assert.equal(result.coverage.entryStates.ambiguous, 1);
});
