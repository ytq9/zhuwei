import assert from "node:assert/strict";
import { prepareStory } from "../../app/_runtime/lib/room/story-creation/index.ts";
import { hashStory, storyFixture, storyResponse } from "./story-creation.mjs";

/** Run the actual authoring workflow with deterministic protocol responses.
 * The failed NPC knowledge reference is decoded successfully, then rejected
 * by structural inspection; it never becomes a saved draft or world fact. */
export async function storyInspectionFailureFixture(stage = "draft", fixture = storyFixture()) {
  const { request, context, recipes } = fixture;
  const invalidBody = structuredClone(fixture.body), review = structuredClone(fixture.review);
  const participant = invalidBody.participants[0];
  const foreign = context.materials.find(material => material.kind === "knowledge"
    && material.availability === "known" && !material.subjectRefs.includes(participant.ref));
  assert.ok(foreign);
  participant.knowledgeRefs.push(foreign.ref);
  Object.assign(review.findings[0], { verdict: "conflict", repairable: true, explanation: "需要补充场景中的证据取得过程。" });
  const invocations = [], requests = [];
  let checkpoint = null;
  const ports = {
    recipes, hash: hashStory,
    async invoke(call) {
      assert.ok(!invocations.some(saved => saved.stage === call.stage), "a saved failure must not re-enter its invocation");
      requests.push(structuredClone(call));
      const response = storyResponse(call.stage === stage ? invalidBody : call.stage === "review" ? review : fixture.body, call.stage);
      invocations.push({ jobId: call.jobId, stage: call.stage, status: "completed", eligible: true, response });
      return { kind: "completed", response };
    },
    async saveCheckpoint(expectedRevision, next) {
      assert.equal(expectedRevision, checkpoint?.revision ?? 0);
      checkpoint = structuredClone(next);
      return { ok: true, checkpoint: structuredClone(checkpoint) };
    },
  };
  const result = await prepareStory(request, context, null, ports);
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.code, "STORY_OUTPUT_INVALID");
  assert.equal(result.checkpoint.inspectionFailure.stage, stage);
  assert.deepEqual(result.checkpoint.inspectionFailure.findings.map(finding => finding.candidatePaths), [["/participants/0/knowledgeRefs"]]);
  return { fixture, request, context, checkpoint, result, ports, invocations, requests,
    evidence: { request, context, hash: hashStory, invocations } };
}
