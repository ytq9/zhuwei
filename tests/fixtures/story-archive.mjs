import { archiveSha256, buildAuthoritativeArchive } from "../../app/_runtime/lib/room/archive.ts";
import { createStoryAdmissionFixture, ACTOR } from "./kp-vnext-story-materialization.mjs";
import { prepareStoryAdmissionBinding } from "../../app/_runtime/lib/room/story-admission.ts";
import { storyResponse } from "./story-creation.mjs";
const keys = (value, names) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const ref = async id => ({ id, version: "1", hash: await archiveSha256(id) });
const zero = () => ({ calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0, elapsedMs: 0 });
const reservation = { inputTokens: 100, outputTokens: 200, estimatedCostMicros: 300, elapsedMs: 1_000 };
const limits = { calls: 30, inputTokens: 30_000, outputTokens: 30_000, estimatedCostMicros: 30_000, elapsedMs: 30_000 };
async function rehashSnapshot(snapshot) {
  const { snapshotHash: _old, ...body } = snapshot;
  snapshot.snapshotHash = await archiveSha256(body);
}

export async function storyArchiveFixture(variant = "boat", withDefinitions = false, suppliedWorld) {
  const world = suppliedWorld ?? await createStoryAdmissionFixture(`archive:${variant}`, { newNpc: withDefinitions || variant === "archive" });
  const request = world.request, context = world.storyContext, source = request.source, jobId = request.jobId;
  const sourceAccount = source.budgetAccountId, policyRef = request.budgetPolicyRef, modelRef = await ref("model");
  const budget = { policyRef, roomAccountId: "budget:room", job: limits, source: limits, room: limits };
  const input = { request, context, modelRef, budget, stageReservation: reservation };
  const { jobId: _job, ...requestIdentity } = request;
  const identityHash = await archiveSha256({ request: requestIdentity, context, modelRef, budget, stageReservation: reservation });
  const accounts = [
    { accountId: "budget:room", scopeKey: await archiveSha256({ roomId: source.roomId, epoch: source.runtimeEpochId }), kind: "room",
      binding: { roomId: source.roomId, runtimeEpochId: source.runtimeEpochId, policyRef } },
    { accountId: sourceAccount, scopeKey: await archiveSha256({ roomId: source.roomId, epoch: source.runtimeEpochId,
      branch: source.branchId, kind: source.kind, sourceId: source.sourceId }), kind: "source", binding: { source, policyRef, roomAccountId: "budget:room" } },
    { accountId: `story-job:${jobId}`, scopeKey: `job:${jobId}`, kind: "job", binding: { identityHash, policyRef } },
  ].map(value => ({ ...value, limits, spent: { ...zero(), calls: 2 }, held: zero() }));
  const invocations = [];
  for (const stage of ["draft", "review"]) {
    const response = storyResponse(stage === "draft" ? world.body : world.reviewBody, stage);
    const usage = { inputTokens: 100, outputTokens: 200, costMicros: 0 };
    const providerRequest = world.invocations.find(value => value.stage === stage);
    invocations.push({ invocation: { invocationId: `invocation:${stage}`, jobId, stage, attemptId: `attempt:${stage}`, purpose: stage,
      status: "completed", requestHash: await archiveSha256({ stage, providerRequest }), providerRequest, modelRef, eligible: true,
      reservation, startedAt: 1_000, completedAt: 1_000, response, usage }, invocationKey: await archiveSha256({ job: jobId, stage }),
    externalBinding: null, accountIds: [`story-job:${jobId}`, sourceAccount, "budget:room"], spent: { ...zero(), calls: 1 }, held: zero(),
    capability: `PRIVATE-DISPATCH-PERMIT:${stage}`, leaseUntil: null, completionHash: await archiveSha256({ kind: "completed", response, usage }) });
  }
  const jobs = [{ input, opportunityKey: await archiveSha256({ roomId: source.roomId, epoch: source.runtimeEpochId,
    branch: source.branchId, opportunity: request.opportunityId }), identityHash, requestHash: await archiveSha256(request),
    checkpoint: world.checkpoint, unallocated: zero() }];
  const admissionBindings = [world.binding], admissions = [world.admission];
  const invocationIds = invocations.map(value => value.invocation.invocationId), preparedActionId = world.binding.preparedActionId;
  const payload = { format: "story-archive-test/prepared/v2", preparedActionId, rootActionId: world.rootActionId,
    admissionBindingHash: world.binding.bindingHash, rulesInput: world.rulesInput,
    stages: await Promise.all(invocationIds.map(async id => ({ invocationId: id,
      requestHash: invocations.find(value => value.invocation.invocationId === id).invocation.requestHash }))) };
  const hostBindings = [{ bindingId: preparedActionId, kind: "preparedAction", source, jobIds: [jobId], invocationIds,
    payload, payloadHash: await archiveSha256(payload) }];
  const snapshot = { format: "zhuwei.story-store-archive/v1", source: { roomId: source.roomId, runtimeEpochId: source.runtimeEpochId },
    accounts, jobs, invocations, admissionBindings, admissions, hostingArtifacts: [], materialManifest: [{ preparationHash: world.preparationHash, jobId, owner: world.binding.owner }] };
  await rehashSnapshot(snapshot);
  const unrelated = world.run({ kind: "resolveFreeAction", proposalId: "root:story:future", characterId: ACTOR,
    goal: "整理材料", method: "逐项归档", feasibility: { kind: "directSuccess", publicBasis: "材料已经齐全。" }, outcome: { fictionTimeCostMicros: "10" } });
  world.unrelatedReceipt = unrelated.receipt;
  const receiptRefs = await Promise.all(Object.values(world.state.receipts).map(async value => ({ receiptId: value.receiptId,
    rootActionId: value.rootActionId, status: value.status, activeBranchId: value.branchId,
    eventRange: { first: value.eventRange.fromEventSeq, last: value.eventRange.toEventSeq }, scopeVersions: {},
    randomnessCommitmentHash: await archiveSha256({ receiptId: value.receiptId }) })));
  const archive = await buildAuthoritativeArchive({ roomId: source.roomId, signedGenesis: world.genesis, events: world.events,
    receiptRefs, projectionAudits: [] }, world.runtime.replay);
  const ports = { replay: world.runtime.replay, validateHostBinding(host, context) {
    const value = host.payload;
    if (!keys(value, ["format", "preparedActionId", "rootActionId", "admissionBindingHash", "rulesInput", "stages"])
      || value.format !== "story-archive-test/prepared/v2" || value.preparedActionId !== host.bindingId
      || !Array.isArray(value.stages) || value.stages.length !== host.invocationIds.length) return false;
    const bound = context.storySnapshot.admissionBindings.find(binding => binding.preparedActionId === host.bindingId);
    const admission = context.storySnapshot.admissions.find(receipt => receipt.preparedActionId === host.bindingId);
    const receipt = context.archive.receiptRefs.find(receipt => receipt.receiptId === admission?.receiptId);
    try { prepareStoryAdmissionBinding({ ...world.bindingInput, rulesInput: value.rulesInput }); } catch { return false; }
    return bound?.bindingHash === value.admissionBindingHash && receipt?.rootActionId === value.rootActionId
      && value.stages.every(stage => keys(stage, ["invocationId", "requestHash"]) && host.invocationIds.includes(stage.invocationId)
        && context.storySnapshot.invocations.some(row => row.invocation.invocationId === stage.invocationId && row.invocation.requestHash === stage.requestHash));
  }, readAdmissionRulesInput(host) { return structuredClone(host.payload.rulesInput); } };
  return { world, input: { archive, storySnapshot: snapshot, hostBindings, generation: "7" }, ports };
}
