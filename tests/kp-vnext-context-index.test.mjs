import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReferenceIndex,
  contextWorkBudgetProfile,
  createContextWorkBudget,
  CONTEXT_WORK_DIMENSIONS,
  VNEXT_CONTEXT_WORK_BUDGET,
} from "../app/_runtime/lib/kp/vnext/index.ts";
import {
  createDefinitionSnapshot,
  storedSemanticDefinition,
} from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";

const SCENE = "scene:hall";
const OTHER_SCENE = "scene:cellar";
const ALICE = "character:alice";
const WARDEN = "npc:warden";

function semanticDefinition(semanticKind, definitionRef, content, visibilityPolicyRef) {
  const snapshot = createDefinitionSnapshot(definitionRef, "1", content);
  return storedSemanticDefinition(
    semanticKind,
    visibilityPolicyRef ?? "visibility:scene-observers",
    snapshot,
    { templateRef: `template:${semanticKind}`, templateHash: snapshot.definitionHash },
  );
}

function relation(definitionRef, kind, subjectRef, objectRef, state = "active") {
  return semanticDefinition("worldRelation", definitionRef, {
    relationRef: definitionRef,
    kind,
    subjectRef,
    objectRef,
    state,
  });
}

/** Only the authority collections the reference index addresses. */
function worldState(overrides = {}) {
  const definitions = {
    "feature:chandelier": semanticDefinition("sceneFeature", "feature:chandelier", {
      sceneRef: SCENE,
      material: "brass",
    }),
    "feature:beam": semanticDefinition("sceneFeature", "feature:beam", {
      sceneRef: SCENE,
      material: "oak",
    }),
    "relation:beam-supports-chandelier": relation(
      "relation:beam-supports-chandelier",
      "supports",
      "feature:beam",
      "feature:chandelier",
    ),
    // A non-semantic campaign definition is still addressable authority state.
    "npc-template:warden": { definitionKind: "npcMechanical", revision: "1" },
    ...(overrides.definitions ?? {}),
  };
  return {
    scenes: { [SCENE]: { id: SCENE }, [OTHER_SCENE]: { id: OTHER_SCENE } },
    entities: {
      [ALICE]: { id: ALICE, kind: "player", sceneId: SCENE },
      [WARDEN]: { id: WARDEN, kind: "npc", sceneId: OTHER_SCENE },
    },
    canonicalFacts: {
      "fact:hall-dark": {
        id: "fact:hall-dark",
        kind: "environment",
        subjectRefs: [SCENE, "feature:chandelier"],
      },
    },
    knowledge: {
      [WARDEN]: { "alarm-wired": { characterId: WARDEN, knowledgeRef: "alarm-wired" } },
    },
    campaignRuntime: {
      campaign: { moduleRef: { profileId: "module:black-oak", profileHash: "sha256:x" } },
      definitions,
      itemSystem: {
        entries: {
          "item-entry:pistol": {
            entryId: "item-entry:pistol",
            definitionRef: "item-definition:pistol",
            holderRef: ALICE,
            sceneRef: null,
            disposition: "held",
            visibilityPolicyRef: `visibility:character-controller:${ALICE}`,
          },
        },
        definitions: { "item-definition:pistol": { definitionId: "item-definition:pistol" } },
      },
      sourceClaims: { "claim:rumor": { claimId: "claim:rumor" } },
      unresolvedThreats: ["threat:collapse"],
      ...(overrides.campaignRuntime ?? {}),
    },
    combatRuntime: {
      definitions: { "ability:pistol-shot": { abilityId: "ability:pistol-shot" } },
    },
  };
}

function indexed(state, budget = createContextWorkBudget()) {
  const result = buildReferenceIndex(state, budget);
  assert.equal(result.kind, "indexed");
  return result.index;
}

test("reference index addresses every authority ref kind without loading bodies", () => {
  const index = indexed(worldState());

  const kinds = new Map([...index.nodes].map(([ref, node]) => [ref, node.kind]));
  assert.equal(kinds.get(SCENE), "scene");
  assert.equal(kinds.get(ALICE), "entity");
  assert.equal(kinds.get("item-entry:pistol"), "itemEntry");
  assert.equal(kinds.get("item-definition:pistol"), "itemDefinition");
  assert.equal(kinds.get("feature:chandelier"), "semanticDefinition");
  assert.equal(kinds.get("npc-template:warden"), "campaignDefinition");
  assert.equal(kinds.get("ability:pistol-shot"), "abilityDefinition");
  assert.equal(kinds.get("fact:hall-dark"), "canonicalFact");
  assert.equal(kinds.get(`knowledge:${WARDEN}:alarm-wired`), "knowledge");
  assert.equal(kinds.get("continuity:sourceClaims"), "continuityCollection");
  assert.equal(kinds.get("continuity:sourceClaims:claim:rumor"), "continuityEntry");
  assert.equal(kinds.get("profile-context:module:black-oak"), "profileContext");

  // Array-shaped continuity collections are addressable only at collection level.
  assert.equal(kinds.get("continuity:unresolvedThreats"), "continuityCollection");
  assert.equal(kinds.has("continuity:unresolvedThreats:threat:collapse"), false);

  // Addressing only: no record body is copied into the directory.
  for (const node of index.nodes.values()) {
    assert.equal("value" in node, false);
    assert.equal("content" in node, false);
    assert.equal("revisionOrHash" in node, false);
  }
});

test("typed relations are indexed from declared fields in both directions", () => {
  const index = indexed(worldState());

  assert.deepEqual(index.relationsBySubject.get("feature:beam"), [{
    relationRef: "relation:beam-supports-chandelier",
    relationKind: "supports",
    subjectRef: "feature:beam",
    objectRef: "feature:chandelier",
    state: "active",
  }]);
  // The object end must be reachable too: `blocks`/`triggers` causes are only
  // discoverable from the thing they act on.
  assert.equal(index.relationsByObject.get("feature:chandelier")?.length, 1);
  assert.equal(index.relationsBySubject.has("feature:chandelier"), false);
});

test("a nested lookalike field never fabricates a relation edge", () => {
  // The replaced collector searched recursively for the first nested
  // `subjectRef`, so an incidental nested field could bind the edge.
  const decoy = semanticDefinition("worldRelation", "relation:decoy", {
    relationRef: "relation:decoy",
    kind: "supports",
    provenance: { subjectRef: "feature:beam", objectRef: "feature:chandelier" },
  });
  const index = indexed(worldState({ definitions: { "relation:decoy": decoy } }));

  assert.equal(index.nodes.get("relation:decoy")?.kind, "semanticDefinition");
  assert.equal(index.relationsBySubject.get("feature:beam")?.length, 1);
  assert.equal(
    index.relationsBySubject.get("feature:beam")?.[0].relationRef,
    "relation:beam-supports-chandelier",
  );
});

test("scope, holder and subject adjacency come from authority state", () => {
  const index = indexed(worldState());

  // A held entry is bound to its holder's scene, not left unscoped.
  assert.equal(index.nodes.get("item-entry:pistol")?.sceneRef, SCENE);
  assert.equal(index.nodes.get("item-entry:pistol")?.holderRef, ALICE);
  assert.equal(index.nodes.get("feature:chandelier")?.sceneRef, SCENE);
  assert.equal(index.nodes.get(WARDEN)?.sceneRef, OTHER_SCENE);

  assert.deepEqual(index.factsBySubject.get("feature:chandelier"), ["fact:hall-dark"]);
  assert.deepEqual(index.knowledgeByHolder.get(WARDEN), [`knowledge:${WARDEN}:alarm-wired`]);
  assert.equal(index.refsByScene.get(SCENE)?.includes("item-entry:pistol"), true);
  assert.equal(index.refsByScene.get(SCENE)?.includes(WARDEN), false);
});

test("the same snapshot always produces the same index and work receipt", () => {
  const state = worldState();
  const first = createContextWorkBudget();
  const second = createContextWorkBudget();

  const left = indexed(state, first);
  const right = indexed(state, second);

  assert.deepEqual([...left.nodes.keys()], [...right.nodes.keys()]);
  assert.deepEqual(first.receipt(), second.receipt());
  assert.equal(first.receipt().exhaustedDimension, null);
  assert.equal(first.receipt().profileHash, VNEXT_CONTEXT_WORK_BUDGET.profileHash);
});

test("an exhausted scan budget blocks with preparationLimit, never a smaller index", () => {
  const tiny = contextWorkBudgetProfile("test:tiny", {
    ...VNEXT_CONTEXT_WORK_BUDGET.limits,
    scannedRecords: 3,
  },
    VNEXT_CONTEXT_WORK_BUDGET.caps,);
  const budget = createContextWorkBudget(tiny);
  const result = buildReferenceIndex(worldState(), budget);

  assert.equal(result.kind, "preparationLimit");
  assert.equal(result.receipt.exhaustedDimension, "scannedRecords");
  assert.equal(result.receipt.spent.scannedRecords, 3);
  assert.equal("index" in result, false);
});

test("work is charged before it runs and the first exhausted dimension latches", () => {
  const profile = contextWorkBudgetProfile("test:latch", {
    ...VNEXT_CONTEXT_WORK_BUDGET.limits,
    closureVisits: 2,
  },
    VNEXT_CONTEXT_WORK_BUDGET.caps,);
  const budget = createContextWorkBudget(profile);

  assert.equal(budget.charge("closureVisits", 2), true);
  // The over-limit charge is refused rather than partially applied.
  assert.equal(budget.charge("closureVisits", 1), false);
  assert.equal(budget.receipt().spent.closureVisits, 2);
  // Once latched, unrelated dimensions stop accepting work so the outcome
  // cannot depend on the order charges happened to arrive in.
  assert.equal(budget.charge("scannedRecords", 1), false);
  assert.equal(budget.receipt().spent.scannedRecords, 0);
  assert.equal(budget.exhausted(), true);
  assert.equal(budget.receipt().exhaustedDimension, "closureVisits");
});

test("budget profiles are pinned by hash and reject invalid limits", () => {
  assert.equal(
    contextWorkBudgetProfile("zhuwei.adjudication-context-work/vnext-1", {
      ...VNEXT_CONTEXT_WORK_BUDGET.limits,
    },
    VNEXT_CONTEXT_WORK_BUDGET.caps,).profileHash,
    VNEXT_CONTEXT_WORK_BUDGET.profileHash,
  );
  assert.notEqual(
    contextWorkBudgetProfile("zhuwei.adjudication-context-work/vnext-1", {
      ...VNEXT_CONTEXT_WORK_BUDGET.limits,
      candidateScores: 1,
    },
    VNEXT_CONTEXT_WORK_BUDGET.caps,).profileHash,
    VNEXT_CONTEXT_WORK_BUDGET.profileHash,
  );
  assert.equal(CONTEXT_WORK_DIMENSIONS.includes("authorityRereadBytes"), true);
  assert.throws(
    () => contextWorkBudgetProfile("test:invalid", {
      ...VNEXT_CONTEXT_WORK_BUDGET.limits,
      scannedRecords: 0,
    },
    VNEXT_CONTEXT_WORK_BUDGET.caps,),
    /scannedRecords:positive-safe-integer-required/u,
  );
  assert.throws(
    () => createContextWorkBudget().charge("scannedRecords", -1),
    /non-negative-safe-integer-required/u,
  );
});
