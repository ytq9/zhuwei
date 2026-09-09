import assert from "node:assert/strict";
import test from "node:test";
import { prepareStory, createStoryRecipes, STORY_CREATION_WORKFLOW, STORY_CREATION_WORKFLOW_REF,
  storyReviewAllowsRevision, storyReviewPassed } from "../app/_runtime/lib/room/story-creation/index.ts";
import { hashStory, storyFixture, storyResponse } from "./fixtures/story-creation.mjs";

function harness(fixture, options = {}) {
  let checkpoint = null;
  const calls = [], requests = [], ledger = new Map(), saves = [];
  const ports = {
    recipes: fixture.recipes, hash: hashStory,
    async invoke(request) {
      requests.push(structuredClone(request));
      const key = `${request.jobId}:${request.stage}`;
      if (ledger.has(key)) {
        const row = ledger.get(key);
        assert.equal(row.requestHash, hashStory(request), "saved stage cannot change exact request");
        return structuredClone(row.outcome);
      }
      calls.push(request.stage);
      assert.ok(calls.length <= 4, "one job never receives a fifth provider call");
      const response = options.response?.(request) ?? storyResponse(request.stage.endsWith("Review") || request.stage === "review"
        ? fixture.review : fixture.body, request.stage);
      const outcome = options.outcome?.(request) ?? { kind: "completed", response };
      ledger.set(key, { requestHash: hashStory(request), outcome: structuredClone(outcome) });
      return outcome;
    },
    async saveCheckpoint(expected, next) {
      if (expected !== (checkpoint?.revision ?? 0) || options.failSave?.(next, saves)) return { ok: false, code: "STORY_CHECKPOINT_CONFLICT" };
      assert.equal(next.revision, expected + 1);
      checkpoint = structuredClone(next); saves.push(structuredClone(next));
      return { ok: true, checkpoint: structuredClone(checkpoint) };
    },
  };
  return { ports, calls, requests, saves, ledger, get checkpoint() { return structuredClone(checkpoint); },
    run: () => prepareStory(fixture.request, fixture.context, structuredClone(checkpoint), ports) };
}
function rehash(context) {
  const { contextHash: _, ...body } = context;
  context.contextHash = hashStory(body);
}

for (const kind of ["conflict", "investigation", "long"]) test(`${kind}: complete preparation and independent review use the same Interface`, async () => {
  const fixture = storyFixture(kind), original = structuredClone(fixture), h = harness(fixture);
  const result = await h.run();
  assert.equal(result.kind, "ready", JSON.stringify(result));
  assert.deepEqual(h.calls, ["draft", "review"]);
  assert.equal(result.preparation.requestHash, hashStory(fixture.request));
  assert.equal(result.review.preparationHash, hashStory(result.preparation));
  assert.equal(result.review.contextHash, fixture.context.contextHash);
  assert.equal(result.preparation.version, "1");
  assert.deepEqual(result.preparation.facts, fixture.body.facts);
  assert.ok(result.preparation.scenes[0].exitConditions.length > 0);
  assert.ok(result.preparation.resolutions.some(resolution => resolution.ref === "resolution:lost-window"));
  assert.ok(result.preparation.evidence[0].sources.length >= 2);
  assert.equal(result.preparation.developments[0].execution, "pendingWorldAdjudication");
  assert.deepEqual(fixture, original, "preparation must not mutate world materials, request, or recipes");
  assert.ok(Object.isFrozen(result.preparation.facts[0].knowledge[0]));
  assert.ok(storyReviewPassed(result.review));
  assert.equal(storyReviewAllowsRevision(result.review), false);
  assert.equal(h.saves[0].revision, 1);
  assert.ok(h.saves[1].draft && !h.saves[1].review, "draft is saved before a review call");
  const prompt = JSON.parse(h.requests[1].messages[1].content);
  assert.deepEqual(prompt.preparation, result.preparation, "independent reviewer sees the exact saved draft");
  assert.equal(h.requests[0].requestHash, hashStory(fixture.request));
  assert.ok(!Object.hasOwn(h.requests[0].schema.properties, "jobId"));
  assert.ok(!Object.hasOwn(h.requests[1].schema.properties, "preparationHash"));
  if (kind === "investigation") {
    const npc = result.preparation.participants.find(participant => participant.identity === "new");
    assert.ok(result.preparation.definitions.some(definition => definition.ref === npc.ref && definition.kind === "npc"));
    assert.equal(typeof result.preparation.definitions[0].payload, "object", "wire JSON is decoded without changing payload semantics");
  }
  if (kind === "long") assert.equal(new Set(result.preparation.stages.map(stage => stage.question)).size, 2);
});

test("a saved complete package survives recipe removal and resumes without invoking the provider", async () => {
  const f = storyFixture(), h = harness(f), first = await h.run();
  assert.equal(first.kind, "ready");
  h.ports.recipes = [];
  const resumed = await h.run();
  assert.deepEqual(resumed, first);
  assert.deepEqual(h.calls, ["draft", "review"]);
  assert.equal(h.requests.length, 2, "ready recovery does not even enter invoke");
});

test("one located, repairable semantic conflict permits exactly one full revision and independent re-review", async () => {
  const f = storyFixture(), wrong = structuredClone(f.body), review = structuredClone(f.review);
  wrong.facts[0].content = "三十八岁的林舟亲历了七十年前的登记制度建立。";
  review.findings.find(finding => finding.category === "worldConsistency").verdict = "conflict";
  review.findings.find(finding => finding.category === "worldConsistency").repairable = true;
  review.findings.find(finding => finding.category === "worldConsistency").explanation = "候选写亲历七十年前事件，但NPC材料年龄三十八；必须修订候选经历。";
  review.findings.find(finding => finding.category === "worldConsistency").constraintRefs = ["npc:boatman"];
  const h = harness(f, { response: request => storyResponse(request.stage === "draft" ? wrong : request.stage === "review" ? review
    : request.stage === "revision" ? f.body : f.review, request.stage) });
  const result = await h.run();
  assert.equal(result.kind, "ready", JSON.stringify(result));
  assert.deepEqual(h.calls, ["draft", "review", "revision", "revisionReview"]);
  assert.equal(result.preparation.version, "2");
  assert.equal(result.checkpoint.draft.facts[0].content, wrong.facts[0].content, "failed material remains saved");
  assert.equal(result.preparation.facts[0].content, f.body.facts[0].content);
  assert.equal(h.requests[2].requestHash, h.requests[0].requestHash);
  assert.deepEqual(JSON.parse(h.requests[2].messages[1].content).review, result.checkpoint.review);
});

test("an NPC contradiction or material uncertainty that cannot be repaired stops before world admission", async () => {
  for (const verdict of ["conflict", "uncertain"]) {
    const f = storyFixture(), review = structuredClone(f.review);
    const finding = review.findings.find(finding => finding.category === "knowledge");
    Object.assign(finding, { verdict, explanation: "林舟原先明确不知道篡改者，候选却称他从前就知道；没有后来知情依据。", repairable: false });
    const h = harness(f, { response: request => storyResponse(request.stage === "review" ? review : f.body, request.stage) });
    const result = await h.run();
    assert.equal(result.kind, "rejected"); assert.equal(result.code, "STORY_REVIEW_REJECTED");
    assert.deepEqual(h.calls, ["draft", "review"]);
    assert.equal(result.checkpoint.review.findings[2].verdict, verdict);
    assert.deepEqual(await h.run(), result, "rejected job does not buy a new sample on resume");
    assert.equal(h.requests.length, 2);
  }
});

test("second review failure is final, including when the reviewer asks for another repair", async () => {
  const f = storyFixture(), review = structuredClone(f.review);
  Object.assign(review.findings[0], { verdict: "conflict", repairable: true, explanation: "收束条件尚未充分回应本次问题。" });
  const h = harness(f, { response: request => storyResponse(request.stage === "review" || request.stage === "revisionReview" ? review : f.body, request.stage) });
  const result = await h.run();
  assert.equal(result.kind, "rejected"); assert.equal(result.code, "STORY_REVISION_EXHAUSTED");
  assert.deepEqual(h.calls, ["draft", "review", "revision", "revisionReview"]);
  await h.run(); assert.equal(h.requests.length, 4);
});

test("decisive missing/ambiguous context, hash tampering and missing capability contracts block before any call", async () => {
  for (const mutate of [
    f => { f.context.missingRequiredRefs = ["fact:necessary-history"]; rehash(f.context); },
    f => { f.context.materials.find(m => m.ref === "npc:boatman").availability = "ambiguous"; rehash(f.context); },
    f => { f.context.materials.find(m => m.kind === "contentBoundary").availability = "unavailable"; rehash(f.context); },
    f => { f.context.materials[0].content = "tampered without a new context hash"; },
  ]) {
    const f = storyFixture(); mutate(f); const h = harness(f), result = await h.run();
    assert.equal(result.code, "STORY_CONTEXT_INSUFFICIENT"); assert.equal(h.calls.length, 0);
  }
  const f = storyFixture("investigation");
  f.context.materials = f.context.materials.filter(m => m.ref !== "contract:materializeNpc"); rehash(f.context);
  const h = harness(f), result = await h.run();
  assert.equal(result.code, "STORY_CAPABILITY_UNSUPPORTED"); assert.equal(h.calls.length, 0);
});

test("the current workflow and recipe contents are exact immutable bindings; conflicts do not depend on load order", async () => {
  assert.equal(STORY_CREATION_WORKFLOW_REF.hash, hashStory(STORY_CREATION_WORKFLOW));
  assert.ok(Object.isFrozen(STORY_CREATION_WORKFLOW.schemas.preparation.properties.title));
  for (const mutate of [
    f => { f.request.workflowRef = { ...f.request.workflowRef, version: "999" }; },
    f => { f.request.workflowRef = { ...f.request.workflowRef, hash: hashStory("unknown-workflow") }; },
  ]) {
    const f = storyFixture(); mutate(f); const h = harness(f);
    assert.equal((await h.run()).code, "STORY_CAPABILITY_UNSUPPORTED"); assert.equal(h.calls.length, 0);
  }
  const changed = storyFixture(), h = harness(changed);
  h.ports.recipes = h.ports.recipes.map(recipe => recipe.ref.id === changed.request.recipeRefs[0].id ? { ...recipe, instructions: "silently changed" } : recipe);
  assert.equal((await h.run()).code, "STORY_RECIPE_UNAVAILABLE"); assert.equal(h.calls.length, 0);
  for (const reversed of [false, true]) {
    const f = storyFixture(); f.request.recipeRefs = f.recipes.filter(recipe => recipe.dimension === "method").map(recipe => recipe.ref);
    if (reversed) f.request.recipeRefs.reverse();
    const runner = harness(f); assert.equal((await runner.run()).code, "STORY_RECIPE_CONFLICT"); assert.equal(runner.calls.length, 0);
  }
  assert.deepEqual(createStoryRecipes(hashStory), storyFixture().recipes);
});

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

test("a structurally failed revision preserves the original draft/review and rejects malformed diagnostic recovery", async () => {
  const f = storyFixture(), review = structuredClone(f.review), invalidRevision = structuredClone(f.body);
  Object.assign(review.findings[0], { verdict: "conflict", repairable: true, explanation: "需要补充取得信息的具体场景依据。" });
  invalidRevision.participants[0].knowledgeRefs.push("knowledge:clerk-register");
  const h = harness(f, { response: request => storyResponse(request.stage === "review" ? review
    : request.stage === "revision" ? invalidRevision : f.body, request.stage) });
  const result = await h.run(), checkpoint = result.checkpoint;
  assert.equal(result.code, "STORY_OUTPUT_INVALID"); assert.equal(checkpoint.status, "rejected");
  assert.deepEqual(h.calls, ["draft", "review", "revision"]);
  assert.deepEqual(checkpoint.draft.facts, f.body.facts); assert.deepEqual(checkpoint.review.findings, review.findings);
  assert.equal(checkpoint.revisedDraft, undefined); assert.equal(checkpoint.revisedReview, undefined);
  assert.equal(checkpoint.inspectionFailure.stage, "revision");
  assert.equal(checkpoint.inspectionFailure.candidateHash, hashStory({ ...invalidRevision,
    format: "zhuwei.story-preparation/v1", jobId: f.request.jobId, version: "2", requestHash: hashStory(f.request),
    contextHash: f.context.contextHash, recipeRefs: f.request.recipeRefs }));
  assert.deepEqual(checkpoint.inspectionFailure.findings.map(finding => ({ category: finding.category,
    paths: finding.candidatePaths, refs: finding.constraintRefs })), [{ category: "knowledge",
      paths: ["/participants/0/knowledgeRefs"], refs: ["knowledge:clerk-register"] }]);
  assert.deepEqual(await h.run(), result);
  for (const mutate of [
    saved => { saved.inspectionFailure.stage = "draft"; },
    saved => { saved.inspectionFailure.stage = "review"; },
    saved => { saved.inspectionFailure.candidateHash = "not-a-hash"; },
    saved => { saved.inspectionFailure.findings = []; },
    saved => { saved.inspectionFailure.findings[0].candidatePaths = ["/bad~9path"]; },
    saved => { saved.inspectionFailure.findings[0].constraintRefs = [42]; },
    saved => { saved.inspectionFailure.findings[0].verdict = "pass"; },
    saved => { saved.inspectionFailure.findings[0].repairable = true; },
    saved => { saved.inspectionFailure.authorityWrite = true; },
    saved => { saved.inspectionFailure = null; },
    saved => { saved.status = "preparing"; delete saved.failureCode; },
    saved => { saved.failureCode = "STORY_PROVIDER_FAILED"; },
  ]) {
    const changed = structuredClone(checkpoint); mutate(changed);
    const restored = await prepareStory(f.request, f.context, changed, h.ports);
    assert.equal(restored.kind, "rejected"); assert.equal(restored.code, "STORY_CHECKPOINT_CONFLICT");
  }
  assert.equal(h.requests.length, 3, "invalid diagnostics cannot restart a stage or buy another review");
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

test("a review must cover every base category and exact recipe criterion with real candidate/constraint locations", async () => {
  for (const mutate of [
    review => { review.findings = []; },
    review => { review.findings[2].category = "completeness"; },
    review => { review.findings[1].constraintRefs = []; },
    review => { review.findings[0].candidatePaths = ["/made-up-field"]; },
    review => { review.findings[0].constraintRefs = ["secret:unloaded"]; },
    review => { review.recipeCriteria.pop(); },
    review => { review.recipeCriteria.push(structuredClone(review.recipeCriteria[0])); },
    review => { review.recipeCriteria[0].criterion = "a different criterion"; },
    review => { review.recipeCriteria[0].verdict = "conflict"; },
  ]) {
    const f = storyFixture(); mutate(f.review); const h = harness(f), result = await h.run();
    assert.equal(result.kind, "rejected"); assert.equal(result.code, "STORY_OUTPUT_INVALID"); assert.equal(h.calls.length, 2);
  }
});

test("strict transport rejects duplicate JSON, extra authority fields, wrong/multiple tools and truncated output without repair", async () => {
  for (const mutate of [
    response => { const fn = response.choices[0].message.tool_calls[0].function; fn.arguments = fn.arguments.replace('"title":', '"title":"first","title":'); },
    response => { const fn = response.choices[0].message.tool_calls[0].function; const body = JSON.parse(fn.arguments); body.jobId = "forged"; fn.arguments = JSON.stringify(body); },
    response => { response.choices[0].message.tool_calls[0].function.name = "another_tool"; },
    response => { response.choices[0].message.tool_calls.push(response.choices[0].message.tool_calls[0]); },
    response => { response.choices[0].finish_reason = "length"; },
    response => { response.choices[0].message.content = "pretend this was accepted"; },
    response => { response.choices[0].message.tool_calls[0].function.arguments = { title: "object shortcut" }; },
  ]) {
    const f = storyFixture(), h = harness(f, { response: request => { const response = storyResponse(f.body, request.stage); mutate(response); return response; } });
    const result = await h.run(); assert.equal(result.code, "STORY_OUTPUT_INVALID"); assert.equal(h.calls.length, 1);
  }
});

test("lost checkpoint save recovers the exact persisted model response rather than regenerating the draft", async () => {
  const f = storyFixture(); let loseOnce = true;
  const h = harness(f, { failSave: next => { if (next.draft && loseOnce) { loseOnce = false; return true; } return false; } });
  const first = await h.run(); assert.equal(first.kind, "waiting"); assert.equal(first.code, "STORY_CHECKPOINT_CONFLICT");
  assert.deepEqual(h.calls, ["draft"]);
  const second = await h.run(); assert.equal(second.kind, "ready", JSON.stringify(second));
  assert.deepEqual(h.calls, ["draft", "review"]);
  assert.deepEqual(h.requests.map(request => request.stage), ["draft", "draft", "review"]);
});

test("waiting, unknown calls and budget failures never become an empty world or obtain another provider sample", async () => {
  for (const code of ["STORY_INVOCATION_PENDING", "STORY_INVOCATION_UNKNOWN", "STORY_BUDGET_EXHAUSTED"]) {
    const f = storyFixture(), h = harness(f, { outcome: () => ({ kind: "waiting", code }) });
    const first = await h.run(); assert.equal(first.kind, "waiting"); assert.equal(first.code, code);
    assert.equal(first.checkpoint.status, "preparing");
    const second = await h.run(); assert.deepEqual(second, first); assert.deepEqual(h.calls, ["draft"]);
  }
  const f = storyFixture(), h = harness(f, { outcome: () => ({ kind: "rejected", code: "STORY_PROVIDER_FAILED" }) });
  assert.equal((await h.run()).code, "STORY_PROVIDER_FAILED"); assert.equal((await h.run()).kind, "rejected"); assert.equal(h.calls.length, 1);
});

test("relevant changed context cannot reuse the old review, while an ordinary question requests no story", async () => {
  const f = storyFixture(), h = harness(f); assert.equal((await h.run()).kind, "ready");
  f.context.materials.find(material => material.ref === "npc:boatman").content = { name: "林舟", dead: true };
  rehash(f.context);
  const stale = await h.run(); assert.equal(stale.kind, "waiting"); assert.equal(stale.code, "STORY_CONTEXT_STALE"); assert.equal(h.calls.length, 2);
  const ordinary = storyFixture(); ordinary.request.trigger.kind = "ordinaryResponse";
  const plain = harness(ordinary), result = await plain.run();
  assert.equal(result.kind, "noStory"); assert.equal(plain.calls.length, 0); assert.deepEqual(await plain.run(), result);
});

test("checkpoint forgery cannot skip the review or cross job identities", async () => {
  const f = storyFixture(), h = harness(f); const ready = await h.run();
  for (const mutate of [
    checkpoint => { checkpoint.jobId = "some-other-job"; },
    checkpoint => { delete checkpoint.review; },
    checkpoint => { checkpoint.draft.cause = "replaced after review"; },
    checkpoint => { checkpoint.draft.version = "2"; },
  ]) {
    const checkpoint = structuredClone(ready.checkpoint); mutate(checkpoint);
    const result = await prepareStory(f.request, f.context, checkpoint, h.ports);
    assert.equal(result.kind, "rejected"); assert.equal(result.code, "STORY_CHECKPOINT_CONFLICT");
  }
  assert.equal(h.calls.length, 2);
});
