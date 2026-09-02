import assert from "node:assert/strict";
import test from "node:test";

import { freezeAdjudicationContext } from "../app/_runtime/lib/kp/vnext/context/index.ts";
import {
  createDefinitionSnapshot,
  storedSemanticDefinition,
} from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";

const SCENE = "scene:hall";
const ALICE = "character:alice";
const INTENT = "我抓起木椅";

function feature(definitionRef, content, visibilityPolicyRef = "visibility:scene-observers") {
  const snapshot = createDefinitionSnapshot(definitionRef, "1", content);
  return storedSemanticDefinition("sceneFeature", visibilityPolicyRef, snapshot, {
    templateRef: "template:sceneFeature",
    templateHash: "sha256:" + "e".repeat(64),
  });
}

/** Four indistinguishable chairs: identical content, identical policy. */
function identicalChairs(count) {
  const content = {
    sceneRef: SCENE,
    label: "木椅",
    description: "一把普通木椅。",
    observableState: "完好",
    affordances: ["可以抓起"],
  };
  return Object.fromEntries(Array.from({ length: count }, (unused, index) => [
    `feature:chair-${index}`,
    feature(`feature:chair-${index}`, content),
  ]));
}

function relation(definitionRef, kind, subjectRef, objectRef) {
  const content = { relationRef: definitionRef, kind, subjectRef, objectRef, state: "active" };
  const snapshot = createDefinitionSnapshot(definitionRef, "1", content);
  return storedSemanticDefinition("worldRelation", "visibility:scene-observers", snapshot, {
    templateRef: "template:worldRelation",
    templateHash: snapshot.definitionHash,
  });
}

function worldState(definitions) {
  return {
    schema: "zhuwei.authoritative-world-state/v2",
    version: "v:1",
    runtimeEpochId: "epoch:1",
    activeBranchId: "branch:main",
    scenes: { [SCENE]: { id: SCENE } },
    entities: {
      [ALICE]: { id: ALICE, kind: "player", name: "艾丽丝", sceneId: SCENE, tenureStatus: "active" },
    },
    canonicalFacts: {},
    knowledge: {},
    campaignRuntime: {
      campaign: null,
      definitions,
      itemSystem: { entries: {}, definitions: {} },
      adjudicationPrecedents: {},
    },
    combatRuntime: { entities: {}, scenes: {}, definitions: {} },
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

function freeze(definitions, intentText = INTENT) {
  const state = worldState(definitions);
  const result = freezeAdjudicationContext({
    state,
    profiles: PROFILES,
    kpProjection: {
      kind: "projected",
      viewer: { kind: "kp", capability: "internal:kp-spatial-evidence" },
      stateVersion: state.version,
      activeBranchId: state.activeBranchId,
      projectionHash: `sha256:${"a".repeat(64)}`,
      spatialEvidence: {},
    },
    replayHead: { eventSeq: "7", stateHash: `sha256:${"b".repeat(64)}` },
    preparedActionId: "prepared-action:s1",
    rootActionId: "root:s1",
    submissionRef: "submission:s1",
    actorCharacterId: ALICE,
    intentText,
    maxUnits: 160_000,
  });
  assert.equal(result.kind, "ready", JSON.stringify(result));
  return result;
}

function ambiguity(result) {
  return result.context.entries.find(({ kind }) => kind === "ambiguous");
}

test("indistinguishable readings are folded by the server, not put to the KP", () => {
  const result = freeze(identicalChairs(4));

  // Four identical chairs are one choice, not a question.
  assert.equal(ambiguity(result), undefined);
  assert.equal(result.coverage.entryStates.ambiguous, 0);

  const [selection] = result.coverage.equivalentSelections;
  assert.equal(selection.obligation, "target");
  assert.equal(selection.selectedRef, "feature:chair-0");
  assert.deepEqual(selection.foldedRefs, ["feature:chair-1", "feature:chair-2", "feature:chair-3"]);
  assert.match(selection.equivalenceKey, /^sha256:[0-9a-f]{64}$/u);

  // Every chair is still readable material; folding decides which one the
  // action addresses, it does not hide the others from the KP.
  const refs = result.context.entries.map(({ entryRef }) => entryRef);
  for (let index = 0; index < 4; index += 1) {
    assert.equal(refs.includes(`feature:chair-${index}`), true);
  }
});

test("a difference that changes nothing the player would care about is the KP's to settle", () => {
  const chairs = {
    "feature:chair-a": feature("feature:chair-a", {
      sceneRef: SCENE,
      label: "木椅甲",
      description: "靠墙的木椅。",
      observableState: "完好",
      affordances: ["可以抓起"],
    }),
    "feature:chair-b": feature("feature:chair-b", {
      sceneRef: SCENE,
      label: "木椅乙",
      description: "靠窗的木椅。",
      observableState: "完好",
      affordances: ["可以抓起"],
    }),
  };
  const entry = ambiguity(freeze(chairs));

  assert.notEqual(entry, undefined);
  assert.equal(entry.resolution, "kpMaySelect");
  assert.equal(entry.viewerSafe, true);
  assert.deepEqual(entry.candidates.map(({ ref }) => ref), ["feature:chair-a", "feature:chair-b"]);
});

test("a difference in danger is the player's to settle", () => {
  const chairs = {
    "feature:chair-a": feature("feature:chair-a", {
      sceneRef: SCENE,
      label: "木椅甲",
      description: "靠墙的木椅。",
      observableState: "完好",
      affordances: ["可以抓起"],
    }),
    "feature:chair-b": feature("feature:chair-b", {
      sceneRef: SCENE,
      label: "木椅乙",
      description: "靠窗的木椅。",
      observableState: "完好",
      affordances: ["可以抓起"],
    }),
    "feature:plate": feature("feature:plate", {
      sceneRef: SCENE,
      label: "压力板",
      description: "地面下陷的一块石板。",
      observableState: "受压",
      affordances: [],
    }),
    // Only one chair is standing on something that fires.
    "relation:chair-b-triggers-plate": relation(
      "relation:chair-b-triggers-plate", "triggers", "feature:chair-b", "feature:plate",
    ),
  };
  const entry = ambiguity(freeze(chairs));

  assert.equal(entry.resolution, "clarificationRequired");
  assert.equal(entry.viewerSafe, true);
});

test("a secret difference never becomes an option the player is shown", () => {
  const chairs = {
    "feature:chair-a": feature("feature:chair-a", {
      sceneRef: SCENE,
      label: "木椅甲",
      description: "靠墙的木椅。",
      observableState: "完好",
      affordances: ["可以抓起"],
    }),
    // Same words, but this one is not something the actor can perceive.
    "feature:chair-b": feature("feature:chair-b", {
      sceneRef: SCENE,
      label: "木椅乙",
      description: "阴影里的木椅。",
      observableState: "完好",
      affordances: ["可以抓起"],
    }, "visibility:room-authority-only"),
  };
  const entry = ambiguity(freeze(chairs));

  // Reachability differs, which is material -- but asking about it would leak
  // the hidden chair, so the KP decides instead.
  assert.equal(entry.viewerSafe, false);
  assert.equal(entry.resolution, "kpMaySelect");
});

test("the frozen artifact refuses a clarification the player could not answer", async () => {
  const { buildRequiredContext } = await import("../app/_runtime/lib/kp/vnext/index.ts");
  const rejected = buildRequiredContext({
    intent: { submissionRef: "submission:s1", actorRef: ALICE, text: INTENT },
    entries: [{
      kind: "ambiguous",
      entryRef: "ambiguity:target",
      obligation: "target",
      resolution: "clarificationRequired",
      candidates: [
        { ref: "feature:chair-a", matchKind: "alias", score: 2, basisRefs: [] },
        { ref: "feature:chair-b", matchKind: "alias", score: 2, basisRefs: [] },
      ],
      frontierExhausted: true,
      viewerSafe: false,
    }],
    references: {
      citations: {
        viewerEvidenceRefs: [],
        authorityBasisRefs: [],
        npcKnowledge: [],
        nonCitableRefs: [],
      },
      domains: { abilityRefs: [], itemRefs: [], semanticRefs: [] },
    },
    binding: {
      roomEpochRef: "epoch:1",
      rootActionId: "root:s1",
      preparedActionId: "prepared-action:s1",
      baseEventSeq: "7",
      stateHash: `sha256:${"b".repeat(64)}`,
      projectionHash: `sha256:${"c".repeat(64)}`,
      profiles: [{ profileRef: "profile:rules", profileHash: `sha256:${"d".repeat(64)}` }],
      readSet: [],
    },
    maxUnits: 160_000,
  });

  assert.equal(rejected.kind, "rejected");
  assert.deepEqual(rejected.issues, [
    "ambiguity:target.resolution:clarification-requires-viewer-safe",
  ]);
});

test("folding is stable across preparations of the same snapshot", () => {
  const left = freeze(identicalChairs(4));
  const right = freeze(identicalChairs(4));

  assert.deepEqual(left.coverage.equivalentSelections, right.coverage.equivalentSelections);
  assert.equal(left.context.binding.contextHash, right.context.binding.contextHash);
});
