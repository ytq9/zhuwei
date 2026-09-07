import assert from "node:assert/strict";
import test from "node:test";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import { authorityRevisionOrHash } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as OTHER,
  PROBE_SCENE as SCENE, PROBE_SOURCE as SOURCE, PROBE_ZONE as ZONE } from "../tools/lib/vnext-authored-probe-fixture.mjs";

const NPC = "npc:observation-subject";
const dependencies = [ACTOR, SCENE, NPC, OTHER, SOURCE, ZONE].sort();

function fixture(suffix) {
  return createAuthoredProbeFixture(`observation-readset-${suffix}`, {
    npcCharacters: [{ id: NPC, name: "在场人物" }],
  });
}

function bind(state, refs = dependencies) {
  return [...new Set(refs)].sort().map(ref => {
    const revisionOrHash = authorityRevisionOrHash(state, ref);
    assert.notEqual(revisionOrHash, null, `missing fixture authority for ${ref}`);
    return { ref, revisionOrHash };
  });
}

function observationInput(f, targetRef = NPC, check = false) {
  const branch = (name, subjectRef, basisRef) => ({
    outcomeCode: `outcome:observe:${name}`, summary: `观察${name}分支。`, effects: [],
    sensoryEvidence: [{ observerRef: ACTOR, subjectRef, sense: "sight",
      evidence: "能看到对方在场地内的轮廓。", basisRefs: [basisRef], visibilityPolicyRef: "visibility:scene-observers" }],
    pressures: [], opportunities: [],
  });
  return {
    kind: "resolveWorldInteraction", rootActionId: f.rootActionId, actorCharacterId: ACTOR,
    plan: {
      schema: "zhuwei.world-interaction-resolution-plan/v1",
      resolutionId: `resolution:${f.rootActionId}`, interactionRef: `interaction:${f.rootActionId}`,
      actorCharacterId: ACTOR, sceneRef: SCENE, abilityRef: null,
      contextHash: canonicalSha256({ fixture: f.rootActionId }), readSet: bind(f.state),
      targetRefs: [targetRef], directTargetRefs: [targetRef], instrumentRefs: [], basisRefs: [NPC],
      intent: "观察当前人物和场地。", method: "留在原地观察。", costs: [],
      ruling: check ? {
        kind: "check", resolutionKind: "abilityCheck", randomnessId: `randomness:${f.rootActionId}`,
        check: { kind: "skill", ability: "wisdom", skill: "perception", dc: "12", modifier: "0",
          mode: "normal", costs: [], goal: "辨认在场人物。", method: "留在原地观察。",
          risk: "距离可能妨碍观察。", successOutcome: "辨认轮廓。", failureOutcome: "只能看见模糊轮廓。" },
      } : { kind: "directSuccess" },
      observation: { inquiry: "眼前有哪些可感知信息？", inferences: { success: [], failure: [] } },
      branches: { success: branch("success", NPC, SOURCE), failure: branch("failure", OTHER, ZONE) },
    },
  };
}

function assertRejected(f, state, input, code) {
  const before = structuredClone(state);
  const result = f.runtime.step(f.profiles, state, input);
  assert.equal(result.kind, "rejected", JSON.stringify({ kind: result.kind, rejection: result.rejection,
    eventTypes: result.events.map(event => event.eventType), reads: input.plan.readSet.map(binding => binding.ref) }));
  assert.equal(result.rejection.code, code, JSON.stringify(result));
  assert.deepEqual(result.events, []);
  assert.equal(result.randomnessRequest, undefined);
  assert.deepEqual(state, before, "rejection cannot alter frozen authority");
}

test("entity and scene observation share frozen dependencies through Rules step, project and replay", () => {
  for (const targetRef of [NPC, SCENE]) {
    const f = fixture(`valid-${targetRef}`), input = observationInput(f, targetRef);
    const result = f.runtime.step(f.profiles, f.state, input);
    assert.equal(result.kind, "committed", JSON.stringify(result));
    const sensory = result.events.find(event => event.eventType === "SensoryEvidenceAcquired");
    assert.ok(sensory);
    assert.equal(result.state.canonicalFacts[sensory.payload.factId].value.subjectRef, NPC);
    const view = f.runtime.project(f.profiles, result.state, f.viewer, { channel: "realtime", committedRange: {
      receiptId: result.receipt.receiptId, actorCharacterId: ACTOR, priorState: f.state, events: result.events,
    } });
    assert.equal(view.kind, "projected", JSON.stringify(view));
    assert.ok(view.renderableClaims.claims.some(claim => claim.outcomeKind === "observe"));
    const replayed = f.runtime.replay(f.genesis, result.events);
    assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
    assert.deepEqual(replayed.state, result.state);
    assert.deepEqual(result.state.entities, f.state.entities);
    assert.deepEqual(result.state.fictionTime, f.state.fictionTime);
  }
});

test("every observation freezes actor, scene, target and both branches' evidence dependencies before committing or rolling", () => {
  for (const targetRef of [NPC, SCENE]) for (const check of [false, true]) {
    const f = fixture(`missing-${targetRef}-${check}`), input = observationInput(f, targetRef, check);
    const valid = f.runtime.step(f.profiles, f.state, input);
    assert.equal(valid.kind, check ? "awaitingRandomness" : "committed", JSON.stringify(valid));
    for (const missingRef of dependencies) {
      const broken = structuredClone(input);
      broken.plan.readSet = broken.plan.readSet.filter(binding => binding.ref !== missingRef);
      assertRejected(f, f.state, broken, "causalFrontierConflict");
    }
  }
});

test("observation rejects forged hashes and stale entity tactical evidence using the shared authority binding", () => {
  for (const targetRef of [NPC, SCENE]) {
    const f = fixture(`stale-${targetRef}`), input = observationInput(f, targetRef, true);
    for (const ref of [NPC, SCENE, SOURCE]) {
      const broken = structuredClone(input);
      broken.plan.readSet.find(binding => binding.ref === ref).revisionOrHash = `sha256:${"0".repeat(64)}`;
      assertRejected(f, f.state, broken, "causalFrontierConflict");
    }
    const moved = structuredClone(f.state);
    moved.combatRuntime.entities[NPC].position.x = "500";
    assertRejected(f, moved, input, "causalFrontierConflict");
  }
});

test("fresh read bindings cannot authorize hidden or off-scene observation subjects in either branch", () => {
  for (const targetRef of [NPC, SCENE]) for (const subjectRef of [NPC, OTHER]) {
    for (const scope of ["hidden", "off-scene"]) {
      const f = fixture(`scope-${targetRef}-${subjectRef}-${scope}`), input = observationInput(f, targetRef, true);
      const state = structuredClone(f.state);
      if (scope === "hidden") {
        state.combatRuntime.entities[subjectRef].visibilityPolicyId = "visibility:hidden-until-evidence";
      } else {
        state.entities[subjectRef].sceneId = "scene:elsewhere";
        state.combatRuntime.entities[subjectRef].sceneId = "scene:elsewhere";
      }
      input.plan.readSet = bind(state);
      assertRejected(f, state, input, "privateOrUnknownReference");
    }
  }
});

test("existing scene interactions retain their read-set and evidence subject gates without an observation discriminator", () => {
  const f = fixture("legacy-scene"), input = observationInput(f, SCENE);
  delete input.plan.observation;
  const valid = f.runtime.step(f.profiles, f.state, input);
  assert.equal(valid.kind, "committed", JSON.stringify(valid));
  const missing = structuredClone(input);
  missing.plan.readSet = missing.plan.readSet.filter(binding => binding.ref !== NPC);
  assertRejected(f, f.state, missing, "causalFrontierConflict");
  const state = structuredClone(f.state);
  state.entities[NPC].sceneId = "scene:elsewhere";
  state.combatRuntime.entities[NPC].sceneId = "scene:elsewhere";
  input.plan.readSet = bind(state);
  assertRejected(f, state, input, "privateOrUnknownReference");
});
