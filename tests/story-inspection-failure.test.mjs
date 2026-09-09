import assert from "node:assert/strict";
import test from "node:test";
import { prepareStory, validateStoryInspectionFailure } from "../app/_runtime/lib/room/story-creation/index.ts";
import { archiveSha256, buildAuthoritativeArchive } from "../app/_runtime/lib/room/archive.ts";
import { buildStoryArchive, validateStoryArchive } from "../app/_runtime/lib/room/story-archive.ts";
import { createStoryMaterializationFixture } from "./fixtures/kp-vnext-story-materialization.mjs";
import { hashStory, storyResponse } from "./fixtures/story-creation.mjs";
import { storyInspectionFailureFixture } from "./fixtures/story-inspection-failure.mjs";

for (const stage of ["draft", "revision"]) test(`${stage}: saved invocation proves the exact private inspection failure and resumes without calls`, async () => {
  const value = await storyInspectionFailureFixture(stage), before = structuredClone({ checkpoint: value.checkpoint, invocations: value.invocations });
  assert.doesNotThrow(() => validateStoryInspectionFailure(value.checkpoint, value.evidence));
  assert.deepEqual(await prepareStory(value.request, value.context, value.checkpoint, value.ports), value.result);
  assert.equal(value.requests.length, stage === "draft" ? 1 : 3);
  assert.deepEqual({ checkpoint: value.checkpoint, invocations: value.invocations }, before);
  assert.equal(value.checkpoint.revisedDraft, undefined);
  assert.equal(Object.hasOwn(value.result, "preparation"), false);
});

test("diagnostic substitution and missing, foreign, duplicate or ineligible invocation evidence reject", async () => {
  for (const stage of ["draft", "revision"]) {
    const value = await storyInspectionFailureFixture(stage);
    for (const mutate of [
      next => { next.checkpoint.inspectionFailure.candidateHash = hashStory("different-candidate"); },
      next => { next.checkpoint.inspectionFailure.findings[0].candidatePaths = ["/cause"]; },
      next => { next.checkpoint.inspectionFailure.findings[0].explanation = "different private diagnosis"; },
      next => { next.checkpoint.failureCode = "STORY_CONTEXT_INSUFFICIENT"; },
      next => { next.checkpoint.status = "ready"; },
      next => { next.checkpoint.inspectionFailure.stage = stage === "draft" ? "revision" : "draft"; },
      next => { next.checkpoint.contextHash = hashStory("different-context"); },
      next => { next.invocations.pop(); },
      next => { next.invocations.at(-1).jobId = "different-job"; },
      next => { next.invocations.at(-1).stage = "revisionReview"; },
      next => { next.invocations.push(structuredClone(next.invocations.at(-1))); },
      next => { next.invocations.at(-1).status = "unknown"; },
      next => { next.invocations.at(-1).eligible = false; },
      next => { delete next.invocations.at(-1).response; },
      next => { next.invocations.at(-1).response = storyResponse(value.fixture.body, stage); },
    ]) {
      const next = structuredClone({ checkpoint: value.checkpoint, invocations: value.invocations });
      mutate(next);
      assert.throws(() => validateStoryInspectionFailure(next.checkpoint, { ...value.evidence, invocations: next.invocations }),
        /STORY_CHECKPOINT_CONFLICT/);
    }
  }
  const value = await storyInspectionFailureFixture("revision"), changed = structuredClone(value.checkpoint);
  changed.review.findings[0].repairable = false;
  assert.throws(() => validateStoryInspectionFailure(changed, value.evidence), /STORY_CHECKPOINT_CONFLICT/);
});

test("checkpoints without diagnostics preserve existing behavior without reading invocation evidence", () => {
  const evidence = { get invocations() { assert.fail("legacy checkpoint must not read invocation evidence"); } };
  assert.doesNotThrow(() => validateStoryInspectionFailure(null, evidence));
  assert.doesNotThrow(() => validateStoryInspectionFailure({ status: "rejected", failureCode: "STORY_OUTPUT_INVALID" }, evidence));
});

const zero = () => ({ calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0, elapsedMs: 0 });
const limits = { calls: 4, inputTokens: 10_000, outputTokens: 10_000, estimatedCostMicros: 10_000, elapsedMs: 10_000 };
const reservation = { inputTokens: 100, outputTokens: 200, estimatedCostMicros: 300, elapsedMs: 1_000 };
async function rehashSnapshot(snapshot) {
  const { snapshotHash: _old, ...body } = snapshot;
  snapshot.snapshotHash = await archiveSha256(body);
}
async function rehashEnvelope(envelope) {
  await rehashSnapshot(envelope.storySnapshot);
  const { contentHash: _old, ...body } = envelope;
  envelope.contentHash = await archiveSha256(body);
}

async function failedArchiveFixture(stage) {
  const world = await createStoryMaterializationFixture(`inspection-archive:${stage}`);
  const value = await storyInspectionFailureFixture(stage, { request: world.request, context: world.storyContext,
    recipes: world.recipes, body: world.body, review: world.reviewBody });
  const { request, context, checkpoint } = value, { source } = request;
  const modelRef = { id: "model:inspection-fixture", version: "1", hash: hashStory("model:inspection-fixture") };
  const budget = { policyRef: request.budgetPolicyRef, roomAccountId: "budget:room", job: limits, source: limits, room: limits };
  const input = { request, context, modelRef, budget, stageReservation: reservation }, { jobId: _, ...requestIdentity } = request;
  const identityHash = hashStory({ request: requestIdentity, context, modelRef, budget, stageReservation: reservation });
  const accounts = [
    { accountId: "budget:room", scopeKey: hashStory({ roomId: source.roomId, epoch: source.runtimeEpochId }), kind: "room",
      binding: { roomId: source.roomId, runtimeEpochId: source.runtimeEpochId, policyRef: budget.policyRef } },
    { accountId: source.budgetAccountId, scopeKey: hashStory({ roomId: source.roomId, epoch: source.runtimeEpochId,
      branch: source.branchId, kind: source.kind, sourceId: source.sourceId }), kind: "source",
      binding: { source, policyRef: budget.policyRef, roomAccountId: "budget:room" } },
    { accountId: `story-job:${request.jobId}`, scopeKey: `job:${request.jobId}`, kind: "job", binding: { identityHash, policyRef: budget.policyRef } },
  ].map(account => ({ ...account, limits, spent: { ...zero(), calls: value.invocations.length }, held: zero() }));
  const invocations = value.invocations.map((call, index) => {
    const invocationId = `invocation:${call.stage}`, providerRequest = value.requests[index], usage = { inputTokens: 100, outputTokens: 200, costMicros: 0 };
    return { invocation: { ...call, invocationId, attemptId: `attempt:${call.stage}`, purpose: call.stage,
      requestHash: hashStory({ stage: call.stage, providerRequest }), providerRequest, modelRef, reservation,
      startedAt: 1_000, completedAt: 1_000, usage }, invocationKey: hashStory({ job: request.jobId, stage: call.stage }),
    externalBinding: null, accountIds: [`story-job:${request.jobId}`, source.budgetAccountId, "budget:room"],
    spent: { ...zero(), calls: 1 }, held: zero(), capability: `PRIVATE-DISPATCH:${call.stage}`, leaseUntil: null,
    completionHash: hashStory({ kind: "completed", response: call.response, usage }) };
  });
  const snapshot = { format: "zhuwei.story-store-archive/v1", source: { roomId: source.roomId, runtimeEpochId: source.runtimeEpochId },
    accounts, jobs: [{ input, opportunityKey: hashStory({ roomId: source.roomId, epoch: source.runtimeEpochId,
      branch: source.branchId, opportunity: request.opportunityId }), identityHash, requestHash: hashStory(request), checkpoint, unallocated: zero() }],
    invocations, admissionBindings: [], admissions: [], hostingArtifacts: [], materialManifest: [] };
  await rehashSnapshot(snapshot);
  const payload = { format: "story-inspection-test/failed-prepared/v1", preparedActionId: `prepared:${source.sourceId}`,
    stages: invocations.map(row => ({ invocationId: row.invocation.invocationId, requestHash: row.invocation.requestHash })) };
  const hostBindings = [{ bindingId: payload.preparedActionId, kind: "preparedAction", source, jobIds: [request.jobId],
    invocationIds: payload.stages.map(call => call.invocationId), payload, payloadHash: hashStory(payload) }];
  const receiptRefs = Object.values(world.state.receipts).map(receipt => ({ receiptId: receipt.receiptId, rootActionId: receipt.rootActionId,
    status: receipt.status, activeBranchId: receipt.branchId, eventRange: { first: receipt.eventRange.fromEventSeq, last: receipt.eventRange.toEventSeq },
    scopeVersions: {}, randomnessCommitmentHash: hashStory({ receiptId: receipt.receiptId }) }));
  const archive = await buildAuthoritativeArchive({ roomId: source.roomId, signedGenesis: world.genesis,
    events: world.events, receiptRefs, projectionAudits: [] }, world.runtime.replay);
  const ports = { replay: world.runtime.replay,
    validateHostBinding(host, frozen) { return hashStory(host.payload) === hashStory(payload)
      && host.payload.preparedActionId === host.bindingId && payload.stages.every(call => host.invocationIds.includes(call.invocationId)
        && frozen.storySnapshot.invocations.some(row => row.invocation.invocationId === call.invocationId
          && row.invocation.requestHash === call.requestHash)); },
    readAdmissionRulesInput() { assert.fail("an unadmitted diagnostic has no Rules input"); },
  };
  return { value, input: { archive, storySnapshot: snapshot, hostBindings, generation: "1" }, ports };
}

for (const stage of ["draft", "revision"]) test(`${stage}: actual archive round trip preserves private failure evidence without granting history material`, async () => {
  const value = await failedArchiveFixture(stage), before = structuredClone(value.input);
  const built = await buildStoryArchive(value.input, value.ports);
  assert.equal(built.kind, "prepared", JSON.stringify(built));
  assert.deepEqual(built.envelope.storySnapshot, before.storySnapshot);
  assert.deepEqual(built.envelope.archive, before.archive);
  assert.deepEqual(built.historyMaterials, { preparations: [], requiredPreparationHashes: [] });
  assert.deepEqual(await validateStoryArchive(built.envelope, value.ports), { ...built, kind: "validated" });
  for (const mutate of [
    envelope => { envelope.storySnapshot.jobs[0].checkpoint.inspectionFailure.candidateHash = hashStory("another-invalid-candidate"); },
    envelope => { envelope.storySnapshot.jobs[0].checkpoint.inspectionFailure.findings[0].candidatePaths = ["/cause"]; },
    envelope => { envelope.storySnapshot.jobs[0].checkpoint.failureCode = "STORY_CONTEXT_INSUFFICIENT"; },
    envelope => {
      const row = envelope.storySnapshot.invocations.at(-1);
      row.invocation.response = storyResponse(value.value.fixture.body, stage);
      row.completionHash = hashStory({ kind: "completed", response: row.invocation.response, usage: row.invocation.usage });
    },
  ]) {
    const changed = structuredClone(built.envelope); mutate(changed); await rehashEnvelope(changed);
    assert.deepEqual(await validateStoryArchive(changed, value.ports), { kind: "rejected", code: "STORY_ARCHIVE_BINDING_INVALID" });
  }
  assert.deepEqual(value.input, before);
});
