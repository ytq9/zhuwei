import { committedActionRange } from './fixtures/vnext-action-lifecycle.mjs';
import { atomicCompletionInput } from './fixtures/vnext-action-duration.mjs';
import { stepActionToDecision } from './fixtures/vnext-action-lifecycle.mjs';
import { soleStep, soleInput } from './fixtures/vnext-action-duration.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_TARGET as OTHER, PROBE_SOURCE as SOURCE, PROBE_SCENE as SCENE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { encodeVNextStrictToolBundle, SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { deepSeekStrictToolSchemaIssues } from "../app/_runtime/lib/kp/deepseek-strict-tool.ts";
import { heldKnowledgeDisplayRefs, heldKnowledgeNarrationFacts } from "../app/_runtime/lib/rules/v2/knowledge-expression.ts";
import { createEventTransition } from "../app/_runtime/lib/rules/v2/events.ts";
import { isCanonicalAtomicWorldInteractionStepsInput } from "../app/_runtime/lib/rules/v2/world-interactions.ts";
import { itemBundle } from "./fixtures/vnext-authored-bundles.mjs";
import { VNEXT_SEMANTIC_TEMPLATES } from "../app/_runtime/lib/rules/profiles/semantic-templates.ts";

const PRIOR = "knowledge:prior";
const held = (characterId = ACTOR, knowledgeRef = PRIOR, content = "附近的蒸汽管道尚未停用。") => ({
  characterId, knowledgeRef, kind: "sourceClaim", layer: "partial", content,
  visibility: "private", provenanceChain: ["genesis:held-knowledge"],
});
const inference = (evidence, conclusion = "管道可能仍带有压力。") => ({
  conclusion, confidence: "仅是目前证据支持的可能解释，不能确认压力大小。", evidence,
});
const sensory = () => ({ observerRef: ACTOR, subjectRef: SOURCE, sense: "hearing",
  evidence: "阀门发出细微的嘶鸣声。", basisRefs: [SOURCE] });
function observe({ reflection = false, check = false } = {}) {
  const branch = { outcomeCode: "outcome:heard", summary: "分辨可感知信息与可能的解释。",
    sensoryEvidence: reflection ? [] : [sensory()],
    characterInferences: [inference([...(reflection ? [] : [{ kind: "sensoryEvidence", index: 0 }]),
      { kind: "heldKnowledge", ref: PRIOR }])],
  };
  return { mode: "adjudication", basisRefs: reflection ? [] : [SOURCE],
    adjudication: check ? { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "wis", skill: "perception",
      dc: 12, mode: "normal", risk: "声音很轻，未必能分辨。", successOutcome: "听清嘶鸣。", failureOutcome: "无法分辨细节。" }
      : { kind: "directSuccess", durationMicros: "300000000", risk: "现有信息足以作出有限推断。", successOutcome: "整理信息。" },
    terminal: { kind: "none" }, proposals: [{ kind: "observe", basisRefs: reflection ? [] : [SOURCE],
      consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE,
      inquiry: "这些信息意味着什么？", method: reflection ? "回想本人已有记录。" : "靠近阀门倾听，不触碰它。",
      focusRefs: reflection ? [] : [SOURCE], existingFactRefs: [],
      branches: { success: branch, failure: check ? { ...structuredClone(branch), outcomeCode: "outcome:unclear",
        sensoryEvidence: [{ ...sensory(), evidence: "能听见嘶鸣，但无法分辨其变化。" }],
        characterInferences: [inference([{ kind: "sensoryEvidence", index: 0 }], "目前无法判断声音是否有变化。")],
      } : { kind: "none" } } }],
  };
}
function lower(f, args = observe(), context = f.requiredContext) {
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(args)));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  return lowerVNext2ProposalBundle({ ...f, requiredContext: context, value: parsed.bundle });
}
function project(f, result, events = result.events, viewer = f.viewer) {
  const view = f.runtime.project(f.profiles, result.state, viewer, { channel: "realtime", committedRange: committedActionRange(result.state, {
    receiptId: result.receipt.receiptId, actorCharacterId: ACTOR, priorState: f.state, events,
  }) });
  assert.equal(view.kind, "projected", JSON.stringify(view));
  return view;
}
function worldUnchanged(before, after) {
  for (const field of ["entities", "combatRuntime", "fictionTime"]) {
    assert.deepEqual(after[field], before[field], field);
  }
  const { activities: beforeActivities, ...beforeCampaign } = before.campaignRuntime;
  const { activities: afterActivities, ...afterCampaign } = after.campaignRuntime;
  assert.deepEqual(afterCampaign, beforeCampaign);
  assert.ok(Object.values(afterActivities).every(activity => activity.status === "completed"));
  // Observing is an act: the only change to the clock is the declared duration on the actor timeline.
  const timelineId = before.multiplayerRuntime.characterTimelineIds[ACTOR] ?? before.activeBranchId;
  for (const [id, timeline] of Object.entries(after.fictionTimelines)) {
    const expected = id === timelineId ? String(BigInt(before.fictionTimelines[id].nowMicros) + 300000000n) : before.fictionTimelines[id].nowMicros;
    assert.equal(timeline.nowMicros, expected, `fictionTimelines.${id}`);
  }
}
function replay(f, events, state) {
  const rebuilt = f.runtime.replay(f.genesis, events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.deepEqual(rebuilt.state, state);
}

test("observe connects same-root perception and held evidence to a private inference, Claims, review and replay", () => {
  assert.deepEqual(deepSeekStrictToolSchemaIssues(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA), []);
  const f = createAuthoredProbeFixture("observe-mixed", { initialKnowledge: [held(), held(OTHER, "knowledge:foreign", "OTHER_PRIVATE_CANARY")] });
  const lowered = lower(f);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  const seen = result.events.find(e => e.eventType === "SensoryEvidenceAcquired");
  const formed = result.events.find(e => e.eventType === "CharacterInferenceFormed");
  assert.ok(BigInt(seen.eventSeq) < BigInt(formed.eventSeq));
  assert.deepEqual(formed.payload.evidenceRefs, [PRIOR, seen.payload.factId].sort());
  const record = result.state.knowledge[ACTOR][formed.payload.inferenceId];
  assert.equal(record.objectKind, "characterInference");
  assert.deepEqual(record.content, { schema: "zhuwei.character-inference/v1", conclusion: formed.payload.conclusion, confidence: formed.payload.confidence });
  assert.equal(result.state.canonicalFacts[formed.payload.inferenceId], undefined);
  worldUnchanged(f.state, result.state);
  const view = project(f, result);
  const claim = view.renderableClaims.claims.find(c => c.kind === "characterInference");
  assert.equal(claim.confidence, record.content.confidence);
  assert.match(claim.narrationFacts.join("\n"), /并非已证实的客观事实/);
  assert.ok(claim.narrationFacts.some(fact => fact.includes(record.content.confidence.slice(0, -1))));
  assert.ok(view.renderableClaims.claims.some(c => c.outcomeKind === "observe"));
  assert.doesNotMatch(JSON.stringify(view), /OTHER_PRIVATE_CANARY|环境互动/);
  assert.deepEqual(heldKnowledgeDisplayRefs([record]), []);
  assert.match(heldKnowledgeNarrationFacts("allKnown", [record], new Map()).join("\n"), /置信说明/);
  const other = project(f, result, result.events, { kind: "player", principalId: "principal:probe-target",
    seatId: "seat:probe-target", sessionVersion: 1, characterId: OTHER });
  assert.equal(other.renderableClaims.claims.some(c => c.kind === "characterInference"), false);
  assert.doesNotMatch(JSON.stringify(other), /管道可能仍带有压力/);
  replay(f, result.events, result.state);
});

test("pure reflection uses the same observe path without fabricating perception, time or world changes", () => {
  const f = createAuthoredProbeFixture("observe-reflection", { initialKnowledge: [held()] });
  const lowered = lower(f, observe({ reflection: true }));
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  assert.deepEqual(result.events.map(e => e.eventType), ["ActivityStarted", "FictionTimeAdvanced", "ActivityCompleted", "CharacterInferenceFormed", "WorldInteractionResolved"]);
  worldUnchanged(f.state, result.state);
  assert.deepEqual(result.state.canonicalFacts, f.state.canonicalFacts);
  assert.doesNotMatch(JSON.stringify(project(f, result).renderableClaims), /环境互动/);
  replay(f, result.events, result.state);
  assert.equal(stepActionToDecision(f.runtime, f.profiles, result.state, lowered.command.rulesInput).rejection.code, "duplicateRootAction");
});

test("scene observation keeps held evidence aliases bound to the same holder-qualified read set", () => {
  for (const knowledgeRef of ["knowledge:prior", "memory:opening-scene"]) {
    const f = createAuthoredProbeFixture(`held-basis-${knowledgeRef}`, {
      initialKnowledge: [held(ACTOR, knowledgeRef), held(OTHER, knowledgeRef, "FOREIGN_SAME_ALIAS_CANARY")],
    });
    const value = observe();
    value.basisRefs = [SCENE, knowledgeRef];
    const entry = value.proposals[0];
    entry.basisRefs = [SCENE, knowledgeRef]; entry.focusRefs = []; entry.existingFactRefs = [knowledgeRef];
    entry.branches.success.characterInferences = [];
    entry.branches.success.sensoryEvidence = [{ ...sensory(), subjectRef: SCENE, basisRefs: [knowledgeRef, SCENE] }];
    const original = structuredClone(value), lowered = lower(f, value);
    assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    const plan = soleStep(lowered.command).plan, expected = `knowledge:${ACTOR}:${knowledgeRef}`;
    assert.ok(plan.basisRefs.includes(expected)); assert.ok(!plan.basisRefs.includes(knowledgeRef));
    assert.deepEqual(plan.branches.success.sensoryEvidence[0].basisRefs, [SCENE, expected].sort());
    assert.ok(plan.readSet.some(binding => binding.ref === expected));
    assert.equal(plan.readSet.some(binding => binding.ref === `knowledge:${OTHER}:${knowledgeRef}`), false);
    assert.deepEqual(value, original, "normalizing evidence cannot alter the frozen model draft");
    const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
    assert.equal(result.kind, "committed", JSON.stringify(result));
    assert.equal(result.events.find(event => event.eventType === "SensoryEvidenceAcquired").payload.publicEvidence,
      entry.branches.success.sensoryEvidence[0].evidence);
    assert.doesNotMatch(JSON.stringify(project(f, result)), /FOREIGN_SAME_ALIAS_CANARY/);
    worldUnchanged(f.state, result.state); replay(f, result.events, result.state);
    for (const mutate of [
      input => { soleInput(input).plan.readSet = soleInput(input).plan.readSet.filter(binding => binding.ref !== expected); },
      input => { soleInput(input).plan.readSet.find(binding => binding.ref === expected).revisionOrHash = `sha256:${"0".repeat(64)}`; },
      input => { soleInput(input).plan.branches.success.sensoryEvidence[0].basisRefs = [`knowledge:${OTHER}:${knowledgeRef}`]; },
    ]) {
      const input = structuredClone(lowered.command.rulesInput); mutate(input);
      const rejected = stepActionToDecision(f.runtime, f.profiles, f.state, input);
      assert.equal(rejected.kind, "rejected"); assert.deepEqual(rejected.events, []);
    }
  }
});

test("observation check resumes either frozen branch and binds only that branch's new evidence", () => {
  for (const roll of [1, 20]) {
    const f = createAuthoredProbeFixture(`observe-check-${roll}`, { initialKnowledge: [held()] });
    const lowered = lower(f, observe({ check: true }));
    assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    const pending = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
    assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
    assert.deepEqual(pending.state.knowledge, f.state.knowledge);
    const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
      continuation: pending.continuation, rolls: [roll] });
    assert.equal(result.kind, "committed", JSON.stringify(result));
    const formed = result.events.find(e => e.eventType === "CharacterInferenceFormed");
    const seen = result.events.find(e => e.eventType === "SensoryEvidenceAcquired");
    assert.ok(formed.payload.evidenceRefs.includes(seen.payload.factId));
    assert.equal(formed.payload.conclusion, roll === 20 ? "管道可能仍带有压力。" : "目前无法判断声音是否有变化。");
    const events = [...pending.events, ...result.events];
    project(f, result, events);
    replay(f, events, result.state);
  }
});

test("both observation branches reject foreign observers, invalid indices and non-held evidence before any roll", () => {
  const f = createAuthoredProbeFixture("observe-invalid", { initialKnowledge: [held(), held(OTHER, "knowledge:foreign", "FOREIGN_CANARY")] });
  for (const mutate of [
    value => { value.branches.failure.sensoryEvidence[0].observerRef = OTHER; },
    value => { value.branches.failure.characterInferences[0].evidence = [{ kind: "sensoryEvidence", index: 1 }]; },
    value => { value.branches.failure.characterInferences[0].evidence = [{ kind: "heldKnowledge", ref: "knowledge:foreign" }]; },
    value => { value.branches.failure.characterInferences[0].evidence = [{ kind: "heldKnowledge", ref: "knowledge:missing" }]; },
  ]) {
    const value = observe({ check: true }); mutate(value.proposals[0]);
    assert.equal(lower(f, value).kind, "rejected");
  }
  const lowered = lower(f, observe({ check: true }));
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  for (const mutate of [
    plan => { plan.branches.failure.sensoryEvidence[0].observerRef = OTHER; },
    plan => { plan.observation.inferences.failure[0].evidence = [{ kind: "sensoryEvidence", index: 1 }]; },
    plan => { plan.readSet = plan.readSet.filter(r => r.ref !== `knowledge:${ACTOR}:${PRIOR}`); },
    plan => { plan.readSet.find(r => r.ref === `knowledge:${ACTOR}:${PRIOR}`).revisionOrHash = `sha256:${"0".repeat(64)}`; },
  ]) {
    const input = structuredClone(lowered.command.rulesInput); mutate(soleInput(input).plan);
    const result = stepActionToDecision(f.runtime, f.profiles, f.state, input);
    assert.equal(result.kind, "rejected", JSON.stringify(result));
    assert.equal(result.randomnessRequest, undefined);
  }
});

test("atomic prefix cannot request a roll before a later observation's frozen knowledge is validated", () => {
  const f = createAuthoredProbeFixture("observe-atomic-preflight", { initialKnowledge: [held()] });
  const value = itemBundle();
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(observe({ reflection: true }))));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  value.proposals.push(parsed.bundle.proposals[0]);
  const lowered = lowerVNext2ProposalBundle({ ...f, value });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  assert.equal(lowered.command.rulesInput.kind, "startActionActivity");
  assert.equal(isCanonicalAtomicWorldInteractionStepsInput(atomicCompletionInput(lowered.command.rulesInput)), true);
  const valid = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(valid.kind, "awaitingRandomness", JSON.stringify(valid));
  assert.deepEqual(valid.state.knowledge, f.state.knowledge);
  const done = f.runtime.step(f.profiles, valid.state, { kind: "fulfillAuthoritativeRandomness", continuation: valid.continuation,
    rolls: valid.randomnessRequest.dice.flatMap(die => Array(Number(die.count)).fill(2)) });
  assert.equal(done.kind, "committed", JSON.stringify(done));
  assert.equal(done.events.filter(event => event.eventType === "CharacterInferenceFormed").length, 1);
  assert.equal(done.state.entities[ACTOR].hitPoints.current, 16);
  replay(f, [...valid.events, ...done.events], done.state);
  for (const mutate of [
    plan => { plan.observation.inferences.success[0].evidence = [{ kind: "heldKnowledge", ref: "knowledge:missing" }]; },
    plan => { plan.readSet = plan.readSet.filter(r => r.ref !== `knowledge:${ACTOR}:${PRIOR}`); },
    plan => { plan.readSet.find(r => r.ref === `knowledge:${ACTOR}:${PRIOR}`).revisionOrHash = `sha256:${"0".repeat(64)}`; },
  ]) {
    const input = structuredClone(lowered.command.rulesInput); mutate(atomicCompletionInput(input).steps.at(-1).rulesInput.plan);
    const result = stepActionToDecision(f.runtime, f.profiles, f.state, input);
    assert.equal(result.kind, "rejected", JSON.stringify(result));
    assert.equal(result.randomnessRequest, undefined);
  }
});

test("inference event folding rejects public disclosure, missing evidence and overwriting a held record", () => {
  const f = createAuthoredProbeFixture("observe-fold", { initialKnowledge: [held()] });
  const lowered = lower(f, observe({ reflection: true }));
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  const event = result.events.find(entry => entry.eventType === "CharacterInferenceFormed");
  const draft = { rootActionId: f.rootActionId, eventType: event.eventType, payload: event.payload,
    scopeProof: result.scopeProof, secrecy: event.secrecy, visibilityPolicyId: event.visibilityPolicyId };
  for (const change of [
    { secrecy: "public", visibilityPolicyId: "visibility:public" },
    { payload: { ...event.payload, evidenceRefs: ["knowledge:unknown"] } },
    { payload: { ...event.payload, evidenceRefs: ["__proto__"] } },
    { payload: { ...event.payload, inferenceId: PRIOR } },
  ]) assert.throws(() => createEventTransition(f.state, f.profiles, { ...draft, ...change }));
  assert.equal(f.runtime.step(f.profiles, f.state, { kind: "formCharacterInference", proposalId: `${f.rootActionId}:forged`,
    characterId: ACTOR, inferenceId: "inference:forged", evidenceRefs: ["__proto__"],
    conclusion: "伪造解释", confidence: "确定" }).kind, "rejected");
});

test("newly materialized observation subjects retain canonical references in direct and checked atomic branches", () => {
  for (const check of [false, true]) {
    const f = createAuthoredProbeFixture(`observe-prospective-${check}`);
    const handle = "prospective:alcove", template = VNEXT_SEMANTIC_TEMPLATES.sceneFeature;
    const args = observe({ check });
    const entry = args.proposals[0];
    entry.focusRefs = [handle]; entry.consumes = [{ kind: "prospective", handle }];
    for (const branch of [entry.branches.success, ...(check ? [entry.branches.failure] : [])]) {
      branch.sensoryEvidence = [{ ...sensory(), subjectRef: handle, sense: "sight", evidence: "浅凹内有一条水痕。", basisRefs: [handle, SOURCE] }];
      branch.characterInferences = [inference([{ kind: "sensoryEvidence", index: 0 }], "这里可能曾经积过水。")];
    }
    args.proposals.unshift({ kind: "materializeObject", basisRefs: [SOURCE], consumes: [],
      produces: [{ handle, kind: "semanticDefinition", outcomeBinding: "always" }], outcomeBinding: "always",
      semanticKind: "sceneFeature", templateRef: template.templateRef, templateHash: template.templateHash,
      visibilityPolicyRef: "visibility:scene-observers", definition: { sceneRef: SCENE, visibilityFactId: { kind: "none" },
        label: "浅凹", description: "墙上浅凹中留着一条水痕。", observableState: { kind: "none" }, affordances: { kind: "none" },
        mechanicDefinitionRefs: [] }, summary: "在场景开放范围内确定浅凹和水痕。" });
    const lowered = lower(f, args);
    assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    const pending = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
    assert.equal(pending.kind, check ? "awaitingRandomness" : "committed", JSON.stringify(pending));
    const result = check ? f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
      continuation: pending.continuation, rolls: [20] }) : pending;
    assert.equal(result.kind, "committed", JSON.stringify(result));
    const events = check ? [...pending.events, ...result.events] : result.events;
    const resolved = events.find(event => event.eventType === "WorldInteractionResolved");
    assert.equal(resolved.payload.observation, true);
    assert.ok(resolved.payload.directTargetRefs.every(ref => ref.startsWith("definition:materialized:")));
    assert.equal(events.filter(event => event.eventType === "CharacterInferenceFormed").length, 1);
    replay(f, events, result.state);
    project(f, result, events);
    const malformed = structuredClone(lowered.command.rulesInput);
    atomicCompletionInput(malformed).steps.at(-1).rulesInput.plan.basisRefs.reverse();
    assert.equal(f.runtime.step(f.profiles, f.state, malformed).kind, "rejected", "invalid raw ordering is not silently cleaned");
  }
});
