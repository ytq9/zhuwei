// Behavior assertions grouped by function; see README.md in this directory.
import assert from "node:assert/strict";
import test from "node:test";
import { prepareStory } from "../../../app/_runtime/lib/room/story-creation/index.ts";
import { hashStory, storyFixture, storyResponse } from "../../support/fixtures/story-creation.mjs";
import { harness } from '../../support/fixtures/story-preparation-harness.mjs';


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
