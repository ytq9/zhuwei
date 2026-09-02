import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReferenceIndex,
  contextWorkBudgetProfile,
  createContextWorkBudget,
  discoverCandidates,
  retrievalProfile,
  tokenize,
  VNEXT_CONTEXT_WORK_BUDGET,
  VNEXT_RETRIEVAL_PROFILE,
} from "../app/_runtime/lib/kp/vnext/index.ts";
import {
  createDefinitionSnapshot,
  storedSemanticDefinition,
} from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";

const SCENE = "scene:hall";
const OTHER_SCENE = "scene:cellar";
const ALICE = "character:alice";
const CHAIN = "feature:chain";
const CHANDELIER = "feature:chandelier";
const IMPACT_ZONE = "feature:impact-zone";
const CELLAR_LAMP = "feature:cellar-lamp";
const INTENT = "我用枪打吊灯";

function sceneFeature(definitionRef, content, visibilityPolicyRef = "visibility:scene-observers") {
  const snapshot = createDefinitionSnapshot(definitionRef, "1", content);
  return storedSemanticDefinition("sceneFeature", visibilityPolicyRef, snapshot, {
    templateRef: "template:sceneFeature",
    templateHash: snapshot.definitionHash,
  });
}

function worldState(overrides = {}) {
  return {
    scenes: { [SCENE]: { id: SCENE }, [OTHER_SCENE]: { id: OTHER_SCENE } },
    entities: {
      [ALICE]: { id: ALICE, kind: "player", name: "艾丽丝", sceneId: SCENE },
    },
    canonicalFacts: {},
    knowledge: {},
    campaignRuntime: {
      campaign: null,
      definitions: {
        [CHAIN]: sceneFeature(CHAIN, {
          sceneRef: SCENE,
          label: "吊灯铁链",
          description: "一条把吊灯固定在横梁上的旧铁链。",
          materialDescription: "普通锻铁，链环已有锈迹。",
          observableState: "仍在承重",
          affordances: ["可以瞄准链环"],
        }),
        [CHANDELIER]: sceneFeature(CHANDELIER, {
          sceneRef: SCENE,
          label: "悬挂吊灯",
          description: "沉重吊灯悬在房间中央。",
          materialDescription: "木制灯架包有普通铁件。",
          observableState: "悬挂在半空",
          affordances: ["可以观察下方区域"],
        }),
        [IMPACT_ZONE]: sceneFeature(IMPACT_ZONE, {
          sceneRef: SCENE,
          label: "吊物下方区域",
          description: "吊灯或重物一旦坠落就会覆盖的地面区域。",
          observableState: "有人站在下方",
          affordances: ["可以离开坠落区域"],
        }),
        [CELLAR_LAMP]: sceneFeature(CELLAR_LAMP, {
          sceneRef: OTHER_SCENE,
          label: "地窖吊灯",
          description: "地窖里另有一盏吊灯。",
          observableState: "熄灭",
          affordances: [],
        }),
        // Not a stored semantic definition: an unregistered schema.
        "npc-template:warden": {
          definitionKind: "npcMechanical",
          revision: "1",
          notes: "守卫会在吊灯坠落时敲响警钟。",
        },
        ...(overrides.definitions ?? {}),
      },
      itemSystem: { entries: {}, definitions: {} },
      adjudicationPrecedents: {
        "precedent:earlier-shot": {
          precedentId: "precedent:earlier-shot",
          publicExplanation: "上次射击吊灯铁链时按 DC 15 处理。",
          status: "active",
        },
      },
    },
    combatRuntime: { definitions: {} },
  };
}

function discover(state, options = {}) {
  const budget = options.budget ?? createContextWorkBudget();
  const built = buildReferenceIndex(state, budget);
  assert.equal(built.kind, "indexed");
  return {
    budget,
    result: discoverCandidates({
      state,
      index: built.index,
      subject: options.subject ?? { kind: "kp", sceneRef: SCENE },
      focusRefs: options.focusRefs ?? [],
      intentText: options.intentText ?? INTENT,
      profile: options.profile ?? VNEXT_RETRIEVAL_PROFILE,
      budget,
    }),
  };
}

function candidates(result) {
  assert.equal(result.kind, "discovered");
  return result.candidates;
}

test("chinese n-grams find every plausible target and refuse to pick one", () => {
  const { result } = discover(worldState());
  const found = candidates(result);
  const byRef = new Map(found.map((candidate) => [candidate.ref, candidate]));

  // Both things whose own name contains 吊灯 are surfaced, tied, in ref order.
  assert.deepEqual(found.slice(0, 2).map(({ ref }) => ref), [CHAIN, CHANDELIER]);
  assert.equal(byRef.get(CHAIN).score, byRef.get(CHANDELIER).score);
  assert.equal(byRef.get(CHAIN).matchKind, "alias");
  assert.equal(byRef.get(CHANDELIER).matchKind, "alias");
  assert.deepEqual(byRef.get(CHANDELIER).matchedTerms, ["吊灯"]);

  // The impact zone only mentions 吊灯 in prose, so it is weaker evidence --
  // still a candidate, never silently dropped.
  assert.equal(byRef.get(IMPACT_ZONE).matchKind, "lexical");
  assert.ok(byRef.get(IMPACT_ZONE).score < byRef.get(CHAIN).score);
});

test("a relevant record with no literal ref in its body is still discoverable", () => {
  // The replaced collector required the scene or an entity ref to appear
  // verbatim in the serialized definition. Nothing here contains one.
  const state = worldState();
  const serialized = JSON.stringify(state.campaignRuntime.definitions[CHANDELIER]);
  assert.equal(serialized.includes(JSON.stringify(SCENE)), true);

  const orphan = sceneFeature("feature:orphan-lamp", {
    sceneRef: SCENE,
    label: "另一盏吊灯",
    description: "没有任何引用写在正文里。",
    observableState: "悬挂",
    affordances: [],
  });
  const { result } = discover(worldState({ definitions: { "feature:orphan-lamp": orphan } }));

  assert.equal(candidates(result).some(({ ref }) => ref === "feature:orphan-lamp"), true);
});

test("unregistered schemas and precedent prose are never opened for free text", () => {
  const { result } = discover(worldState());
  const refs = candidates(result).map(({ ref }) => ref);

  // The warden template mentions 吊灯 but its schema registers no extractor.
  assert.equal(refs.includes("npc-template:warden"), false);
  // A precedent's public explanation mentions 吊灯铁链. Prose written to
  // explain a past ruling must not decide whether that ruling applies again.
  assert.equal(refs.includes("continuity:adjudicationPrecedents:precedent:earlier-shot"), false);
});

test("focus refs are addressing, not selection", () => {
  const { result } = discover(worldState(), { focusRefs: [CHANDELIER, "feature:missing"] });
  const found = candidates(result);

  const focused = found.find(({ ref }) => ref === CHANDELIER);
  assert.equal(focused.matchKind, "exactRef");
  // Naming one does not remove the others from consideration.
  assert.equal(found.some(({ ref }) => ref === CHAIN), true);
  // A ref authority cannot address is not fabricated into a candidate.
  assert.equal(found.some(({ ref }) => ref === "feature:missing"), false);
});

test("a same-named object in another scene is not a rival reading", () => {
  const inHall = candidates(discover(worldState()).result).map(({ ref }) => ref);
  const inCellar = candidates(discover(worldState(), {
    subject: { kind: "kp", sceneRef: OTHER_SCENE },
  }).result).map(({ ref }) => ref);

  // 地窖吊灯 carries 吊灯 in its own label, so only scope keeps it out.
  assert.equal(inHall.includes(CELLAR_LAMP), false);
  assert.equal(inCellar.includes(CELLAR_LAMP), true);
  assert.equal(inCellar.includes(CHANDELIER), false);
});

test("a character surface is no wider than the KP surface in the same scene", () => {
  const state = worldState();
  const asKp = candidates(discover(state).result).map(({ ref }) => ref);
  const asCharacter = candidates(discover(state, {
    subject: { kind: "character", characterRef: ALICE, sceneRef: SCENE },
  }).result).map(({ ref }) => ref);

  assert.ok(asKp.length > 0);
  assert.equal(asCharacter.every((ref) => asKp.includes(ref)), true);
});

test("bounded search reports what it dropped instead of looking exhaustive", () => {
  const narrow = retrievalProfile(
    "test:narrow",
    { ...VNEXT_RETRIEVAL_PROFILE.tokenizer, maxPostingsPerTerm: 1, maxCandidates: 1 },
    VNEXT_RETRIEVAL_PROFILE.extractors,
  );
  const { result } = discover(worldState(), { profile: narrow });

  assert.equal(result.kind, "discovered");
  // 吊灯 matches several refs, so under a fan-out of 1 it discriminates
  // nothing and is dropped -- visibly.
  assert.equal(result.droppedGenericTerms.includes("吊灯"), true);

  const wide = retrievalProfile(
    "test:one-candidate",
    { ...VNEXT_RETRIEVAL_PROFILE.tokenizer, maxCandidates: 1 },
    VNEXT_RETRIEVAL_PROFILE.extractors,
  );
  const capped = discover(worldState(), { profile: wide }).result;
  assert.equal(capped.candidates.length, 1);
  assert.ok(capped.droppedCandidateCount > 0);
});

test("the tokenizer is deterministic and pinned by the retrieval profile hash", () => {
  const tokens = tokenize("用枪打吊灯", VNEXT_RETRIEVAL_PROFILE.tokenizer);
  assert.deepEqual(tokens, [...tokens].sort());
  assert.equal(tokens.includes("吊灯"), true);
  assert.equal(tokens.includes("用枪打"), true);
  // Latin and digit runs tokenize whole rather than by n-gram.
  assert.deepEqual(tokenize("DC15 check", VNEXT_RETRIEVAL_PROFILE.tokenizer), ["check", "dc15"]);

  assert.notEqual(
    retrievalProfile(
      VNEXT_RETRIEVAL_PROFILE.profileRef,
      { ...VNEXT_RETRIEVAL_PROFILE.tokenizer, ngramSizes: [2] },
      VNEXT_RETRIEVAL_PROFILE.extractors,
    ).profileHash,
    VNEXT_RETRIEVAL_PROFILE.profileHash,
  );
});

test("the same snapshot and intent always discover the same candidates", () => {
  const state = worldState();
  const left = discover(state);
  const right = discover(state);

  assert.deepEqual(candidates(left.result), candidates(right.result));
  assert.deepEqual(left.budget.receipt(), right.budget.receipt());
});

test("an exhausted discovery budget blocks instead of returning fewer candidates", () => {
  const profile = contextWorkBudgetProfile("test:tiny-discovery", {
    ...VNEXT_CONTEXT_WORK_BUDGET.limits,
    searchableCharacters: 20,
  },
    VNEXT_CONTEXT_WORK_BUDGET.caps,);
  const { result } = discover(worldState(), { budget: createContextWorkBudget(profile) });

  assert.equal(result.kind, "preparationLimit");
  assert.equal(result.receipt.exhaustedDimension, "searchableCharacters");
  assert.equal("candidates" in result, false);
});
