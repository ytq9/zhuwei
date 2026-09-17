// Behavior assertions grouped by function; see README.md in this directory.
import assert from "node:assert/strict";
import test from "node:test";
import { hashStory, storyFixture } from "../../support/fixtures/story-creation.mjs";
import { harness } from '../../support/fixtures/story-preparation-harness.mjs';


test("structural preparation checks reject incomplete stories, dangling references and foreign knowledge", async () => {
  for (const mutate of [
    f => { f.body.resolutions = []; },
    f => { f.body.cause = ""; },
    f => { f.body.evidence[0].sources.pop(); },
    f => { f.body.evidence[0].sources[1].ref = f.body.evidence[0].sources[0].ref; },
    f => { f.body.scenes[0].locationRef = "place:invented-without-definition"; },
    f => { f.body.participants[0].knowledgeRefs.push("knowledge:clerk-register"); },
    f => { f.body.definitions = []; f.body.notApplicable = f.body.notApplicable.filter(item => item.path !== "/definitions"); },
    f => { f.body.facts[0].knowledge[0].factRef = "other-fact"; },
    f => { f.body.facts[0].occurrence.start.micros = "2000"; },
    f => { f.body.facts[0].knowledge[0].acquisition.start.micros = "500"; },
    f => { f.body.facts[0].layer = "statement"; f.body.facts[0].knowledge[0].layer = "truth"; },
  ]) {
    const f = storyFixture(); mutate(f); const h = harness(f), result = await h.run();
    assert.equal(result.kind, "rejected", JSON.stringify(result)); assert.equal(h.calls.length, 1, "invalid preparation never reaches reviewer or becomes ready");
  }
  const f = storyFixture("long"); f.body.stages.pop(); const h = harness(f);
  const result = await h.run();
  assert.equal(result.code, "STORY_OUTPUT_INVALID"); assert.equal(h.calls.length, 1);
  assert.equal(result.checkpoint.draft, undefined); assert.equal(result.checkpoint.review, undefined);
  assert.equal(result.checkpoint.inspectionFailure.stage, "draft");
  assert.equal(result.checkpoint.inspectionFailure.candidateHash, hashStory({ ...f.body,
    format: "zhuwei.story-preparation/v1", jobId: f.request.jobId, version: "1", requestHash: hashStory(f.request),
    contextHash: f.context.contextHash, recipeRefs: f.request.recipeRefs }));
  assert.deepEqual(result.checkpoint.inspectionFailure.findings.map(finding => finding.candidatePaths), [["/stages"]]);
  assert.match(result.checkpoint.inspectionFailure.findings[0].explanation, /长篇/);
  assert.deepEqual(await h.run(), result, "the private failure and its exact location survive recovery");
  assert.equal(h.requests.length, 1, "recovery does not even re-enter the invocation port");
});


test("new NPCs require actual definitions and cannot become same-name substitutes for existing NPCs", async () => {
  for (const mutate of [
    f => { f.body.definitions[0].ref = "candidate:unrelated-definition"; },
    f => { f.body.participants[0].label = "林舟"; },
    f => { delete f.body.definitions[0].payload.resources; },
    f => { f.body.definitions[0].dependsOn.push(f.body.definitions[0].ref); },
  ]) {
    const f = storyFixture("investigation"); mutate(f); const h = harness(f), result = await h.run();
    assert.equal(result.kind, "rejected"); assert.equal(h.calls.length, 1);
  }
});


test("knowledge provenance rejects self-reference, cycles, non-world sources and later local sources before independent review", async () => {
  for (const mode of ["self", "cycle", "laterKnowledge", "laterFact", "hostingOutcome", "explicitUnknown", "capabilityContract"]) {
    const f = storyFixture(), fact = f.body.facts[0], first = fact.knowledge[0];
    const second = { ...structuredClone(first), ref: "candidate:clerk-memory", holderRef: "npc:clerk",
      sourceRef: fact.ref, acquisition: { ...structuredClone(first.acquisition), start: { ...first.acquisition.start, micros: "700" } } };
    if (mode === "self") first.sourceRef = first.ref;
    if (mode === "cycle" || mode === "laterKnowledge") {
      fact.knowledge.push(second); first.sourceRef = second.ref;
      if (mode === "cycle") second.sourceRef = first.ref;
      else second.acquisition.start.micros = "900";
    }
    if (mode === "laterFact") {
      const later = { ...structuredClone(fact), ref: "candidate:later-evidence", knowledge: [],
        occurrence: { ...structuredClone(fact.occurrence), start: { ...fact.occurrence.start, micros: "900" } } };
      f.body.facts.push(later); first.sourceRef = later.ref;
    }
    if (mode === "hostingOutcome") first.sourceRef = "resolution:agreement";
    if (mode === "explicitUnknown") first.sourceRef = "unknown:boatman-culprit";
    if (mode === "capabilityContract") first.sourceRef = "contract:materializeNpc";
    const h = harness(f), result = await h.run();
    assert.equal(result.kind, "rejected", `${mode}: ${JSON.stringify(result)}`);
    assert.equal(result.code, "STORY_OUTPUT_INVALID", mode);
    assert.deepEqual(h.calls, ["draft"], `${mode}: unsupported provenance must not reach paid review`);
    assert.equal(result.checkpoint.draft, undefined, "invalid provenance never becomes a usable saved preparation");
  }
});


test("direct observation of a local fact and a chronologically grounded knowledge chain remain legal", async () => {
  for (const chain of [false, true]) {
    const f = storyFixture(), fact = f.body.facts[0], witness = fact.knowledge[0];
    witness.sourceRef = fact.ref;
    if (chain) {
      fact.knowledge.push({ ...structuredClone(witness), ref: "candidate:clerk-hears-witness", holderRef: "npc:clerk",
        layer: "sourceClaim", sourceRef: witness.ref, content: "听林舟说他看到原卷与副本的药品栏不一致。",
        explanation: "林舟先在700取得观察，然后在800向吏员说明；听到主张没有直接证明主张为真。",
        acquisition: { ...structuredClone(witness.acquisition), start: { ...witness.acquisition.start, micros: "800" } } });
      f.body.participants.find(participant => participant.ref === "npc:clerk").knowledgeRefs.push("candidate:clerk-hears-witness");
    }
    const h = harness(f), result = await h.run();
    assert.equal(result.kind, "ready", JSON.stringify(result));
    assert.deepEqual(h.calls, ["draft", "review"]);
    assert.equal(result.preparation.facts[0].knowledge[0].sourceRef, fact.ref);
    if (chain) assert.equal(result.preparation.facts[0].knowledge[1].sourceRef, witness.ref);
  }
});
