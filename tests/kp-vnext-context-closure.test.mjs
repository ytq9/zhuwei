import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReferenceIndex,
  closeObligations,
  contextWorkBudgetProfile,
  createContextWorkBudget,
  VNEXT_CONTEXT_WORK_BUDGET,
} from "../app/_runtime/lib/kp/vnext/index.ts";
import {
  createDefinitionSnapshot,
  storedSemanticDefinition,
} from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";

const SCENE = "scene:hall";
const ALICE = "character:alice";
const CHANDELIER = "feature:chandelier";
const BEAM = "feature:beam";
const CHAIN = "feature:chain";
const ENEMY = "npc:brigand";
const PRESSURE_PLATE = "feature:pressure-plate";
const PORTCULLIS = "feature:portcullis";

function semanticDefinition(semanticKind, definitionRef, content) {
  const snapshot = createDefinitionSnapshot(definitionRef, "1", content);
  return storedSemanticDefinition(
    semanticKind,
    "visibility:scene-observers",
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

function feature(definitionRef) {
  return semanticDefinition("sceneFeature", definitionRef, { sceneRef: SCENE });
}

/**
 * The decisive chain (beam supports chain supports chandelier, brigand stands
 * under it) buried in a scene carrying `noise` unrelated relations and
 * features, all bound to the same scene.
 */
function worldState({ noise = 0, chainState = "active", facts = {} } = {}) {
  const definitions = {
    [CHANDELIER]: feature(CHANDELIER),
    [BEAM]: feature(BEAM),
    [CHAIN]: feature(CHAIN),
    [PRESSURE_PLATE]: feature(PRESSURE_PLATE),
    [PORTCULLIS]: feature(PORTCULLIS),
    "relation:beam-supports-chain": relation(
      "relation:beam-supports-chain", "supports", BEAM, CHAIN,
    ),
    "relation:chain-supports-chandelier": relation(
      "relation:chain-supports-chandelier", "supports", CHAIN, CHANDELIER, chainState,
    ),
    "relation:chandelier-blocks-brigand": relation(
      "relation:chandelier-blocks-brigand", "blocks", CHANDELIER, ENEMY,
    ),
  };
  for (let index = 0; index < noise; index += 1) {
    const left = `feature:noise-${index}-a`;
    const right = `feature:noise-${index}-b`;
    definitions[left] = feature(left);
    definitions[right] = feature(right);
    definitions[`relation:noise-${index}`] = relation(
      `relation:noise-${index}`, "attachedTo", left, right,
    );
  }
  return {
    scenes: { [SCENE]: { id: SCENE } },
    entities: {
      [ALICE]: { id: ALICE, kind: "player", sceneId: SCENE },
      [ENEMY]: { id: ENEMY, kind: "npc", sceneId: SCENE },
    },
    canonicalFacts: facts,
    knowledge: {},
    campaignRuntime: {
      campaign: null,
      definitions,
      itemSystem: {
        entries: {
          "item-entry:pistol": {
            entryId: "item-entry:pistol",
            definitionRef: "item-definition:pistol",
            holderRef: ALICE,
            sceneRef: null,
            disposition: "held",
          },
        },
        definitions: { "item-definition:pistol": { definitionId: "item-definition:pistol" } },
      },
    },
    combatRuntime: { definitions: {} },
  };
}

function closure(state, seeds, options = {}) {
  const budget = options.budget ?? createContextWorkBudget();
  const built = buildReferenceIndex(state, budget);
  assert.equal(built.kind, "indexed");
  // One budget spans the whole preparation, so isolating what traversal cost
  // means diffing the receipt around it rather than reading a total.
  const beforeClosure = budget.receipt().spent;
  const result = closeObligations({
    index: built.index,
    seeds,
    budget,
    ...(options.dependencies === undefined ? {} : { dependencies: options.dependencies }),
  });
  const afterClosure = budget.receipt().spent;
  const closureWork = Object.fromEntries(
    Object.keys(afterClosure).map((key) => [key, afterClosure[key] - beforeClosure[key]]),
  );
  return { result, budget, closureWork };
}

function refs(result) {
  assert.equal(result.kind, "closed");
  return result.refs.map(({ ref }) => ref);
}

test("a decisive chain closes through relations no matter how large the scene is", () => {
  const { result, closureWork } = closure(worldState({ noise: 1_500 }), [
    { ref: ALICE, obligation: "actor" },
    { ref: CHANDELIER, obligation: "target" },
    { ref: "item-entry:pistol", obligation: "instrument" },
  ]);
  const closed = refs(result);

  // The whole causal chain, including the enemy standing under the target.
  for (const ref of [
    BEAM, CHAIN, CHANDELIER, ENEMY,
    "relation:beam-supports-chain",
    "relation:chain-supports-chandelier",
    "relation:chandelier-blocks-brigand",
    "item-definition:pistol",
    SCENE,
  ]) assert.equal(closed.includes(ref), true, `missing decisive ref ${ref}`);

  // None of the 1,500 unrelated relations or their 3,000 endpoints.
  assert.equal(closed.some((ref) => ref.includes("noise")), false);

  // Traversal is adjacency-driven: the closure never walks the catalog, so the
  // work it spends is a function of the chain, not of scene size. The replaced
  // fixed point rescanned all 1,503 relations on every round instead.
  assert.ok(closureWork.closureVisits < 40, `closureVisits=${closureWork.closureVisits}`);
  assert.ok(
    closureWork.relationEdgeVisits < 20,
    `relationEdgeVisits=${closureWork.relationEdgeVisits}`,
  );
});

test("closure work is independent of how much unrelated content the scene holds", () => {
  const seeds = [{ ref: CHANDELIER, obligation: "target" }];
  const small = closure(worldState({ noise: 0 }), seeds);
  const large = closure(worldState({ noise: 2_000 }), seeds);

  assert.deepEqual(refs(small.result), refs(large.result));
  assert.deepEqual(small.closureWork, large.closureWork);
});

test("scene scope is read as a container, never expanded into its membership", () => {
  const { result } = closure(worldState({ noise: 3 }), [
    { ref: CHANDELIER, obligation: "target" },
  ]);
  const closed = refs(result);

  assert.equal(closed.includes(SCENE), true);
  // The plate and portcullis stand in the same scene but bear no relation to
  // the target; pulling them back in would restore the wide collection.
  assert.equal(closed.includes(PRESSURE_PLATE), false);
  assert.equal(closed.includes(PORTCULLIS), false);
  assert.equal(closed.includes(ALICE), false);
});

test("an ended relation does not drag its far end into the decisive set", () => {
  const { result } = closure(worldState({ chainState: "ended" }), [
    { ref: CHANDELIER, obligation: "target" },
  ]);
  const closed = refs(result);

  assert.equal(closed.includes(ENEMY), true);
  assert.equal(closed.includes(CHAIN), false);
  assert.equal(closed.includes(BEAM), false);
});

test("co-subjects of a shared canonical fact enter as bound causes", () => {
  const state = worldState({
    facts: {
      "fact:plate-wired-to-portcullis": {
        id: "fact:plate-wired-to-portcullis",
        kind: "hiddenMechanism",
        subjectRefs: [PRESSURE_PLATE, PORTCULLIS],
      },
    },
  });
  const { result } = closure(state, [{ ref: PRESSURE_PLATE, obligation: "target" }]);
  const closed = refs(result);

  // Throwing a stone at the plate must let the KP see what the plate fires,
  // even though no typed relation connects them.
  assert.equal(closed.includes("fact:plate-wired-to-portcullis"), true);
  assert.equal(closed.includes(PORTCULLIS), true);
});

test("the work key is (ref, obligation), so one ref can close for several reasons", () => {
  const { result } = closure(worldState(), [
    { ref: CHANDELIER, obligation: "target" },
    { ref: CHANDELIER, obligation: "instrument" },
  ]);
  assert.equal(result.kind, "closed");

  // Seeded twice and additionally reached as the far end of the chain that
  // holds it up: obligations accumulate, and the basis records what bound it.
  const chandelier = result.refs.find(({ ref }) => ref === CHANDELIER);
  assert.deepEqual(chandelier.obligations, ["instrument", "relation", "target"]);
  assert.deepEqual(chandelier.basisRefs, [
    "relation:chain-supports-chandelier",
    "relation:chandelier-blocks-brigand",
  ]);

  // Everything admitted by traversal records what admitted it.
  const beam = result.refs.find(({ ref }) => ref === BEAM);
  assert.deepEqual(beam.obligations, ["relation"]);
  assert.deepEqual(beam.basisRefs, ["relation:beam-supports-chain"]);
});

test("declared dependencies enter through the resolver, not through enumeration", () => {
  const { result } = closure(
    worldState(),
    [{ ref: "ability:pistol-shot", obligation: "ability" }],
    {
      dependencies: (ref, obligation) => ref === "ability:pistol-shot" && obligation === "ability"
        ? [{ ref: "item-entry:ammo", obligation: "instrument" }]
        : [],
    },
  );
  const closed = refs(result);

  assert.equal(closed.includes("item-entry:ammo"), true);
  // The actor's other holdings are never enumerated into the context.
  assert.equal(closed.includes("item-entry:pistol"), false);
});

test("an exhausted closure budget blocks instead of returning a partial set", () => {
  const profile = contextWorkBudgetProfile("test:tiny-closure", {
    ...VNEXT_CONTEXT_WORK_BUDGET.limits,
    closureVisits: 4,
  },
    VNEXT_CONTEXT_WORK_BUDGET.caps,);
  const { result } = closure(
    worldState(),
    [{ ref: CHANDELIER, obligation: "target" }],
    { budget: createContextWorkBudget(profile) },
  );

  assert.equal(result.kind, "preparationLimit");
  assert.equal(result.receipt.exhaustedDimension, "closureVisits");
  assert.equal("refs" in result, false);
});

test("the same snapshot and seeds always close to the same refs and receipt", () => {
  const state = worldState({ noise: 50 });
  const seeds = [
    { ref: CHANDELIER, obligation: "target" },
    { ref: ALICE, obligation: "actor" },
  ];
  const left = closure(state, seeds);
  const right = closure(state, [...seeds].reverse());

  assert.deepEqual(refs(left.result), refs(right.result));
  assert.deepEqual(left.budget.receipt(), right.budget.receipt());
});
