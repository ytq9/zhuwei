import assert from "node:assert/strict";
import test from "node:test";
import { buildStoryArchive, validateStoryArchive } from "../app/_runtime/lib/room/story-archive.ts";
import { archiveSha256, buildAuthoritativeArchive } from "../app/_runtime/lib/room/archive.ts";
import { createStoryAdmissionFixture, ACTOR } from "./fixtures/kp-vnext-story-materialization.mjs";
import { prepareStoryAdmissionBinding } from "../app/_runtime/lib/room/story-admission.ts";
import { storyResponse } from "./fixtures/story-creation.mjs";

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
async function rehashEnvelope(envelope) {
  await rehashSnapshot(envelope.storySnapshot);
  const { archiveHash: _oldWorld, ...world } = envelope.archive;
  envelope.archive.archiveHash = await archiveSha256(world);
  envelope.source = { roomId: envelope.archive.roomId, runtimeEpochId: envelope.archive.signedGenesis.runtimeEpochId,
    archiveHash: envelope.archive.archiveHash, head: structuredClone(envelope.archive.head) };
  const { contentHash: _old, ...body } = envelope;
  envelope.contentHash = await archiveSha256(body);
}

async function fixture(variant = "boat", withDefinitions = false) {
  const world = await createStoryAdmissionFixture(`archive:${variant}`, { newNpc: withDefinitions || variant === "archive" });
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
    accounts, jobs, invocations, admissionBindings, admissions, materialManifest: [{ preparationHash: world.preparationHash, jobId }] };
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

for (const variant of ["boat", "archive"]) test(`${variant}: private story archive binds real Rules receipts, events and atomic NPC knowledge admission`, async () => {
  const value = await fixture(variant), before = structuredClone(value.input);
  const result = await buildStoryArchive(value.input, value.ports);
  assert.equal(result.kind, "prepared", JSON.stringify(result));
  assert.deepEqual(result.envelope.archive, value.input.archive);
  assert.deepEqual(result.envelope.storySnapshot, value.input.storySnapshot);
  assert.equal(result.historyMaterials.preparations.length, 1);
  assert.equal(result.historyMaterials.preparations[0].facts[0].knowledge.length, 1);
  assert.equal(result.historyMaterials.preparations[0].recordedAtEventSeq, value.input.storySnapshot.admissions[0].recordedAtEventSeq);
  assert.deepEqual(result.quarantine, { enforcement: "hostRequiredBeforeRestoreExposure", invocationIds: [], sourceBudgetAccountIds: [value.world.request.source.budgetAccountId] });
  const validated = await validateStoryArchive(result.envelope, value.ports);
  assert.deepEqual(validated, { ...result, kind: "validated" });
  assert.deepEqual(value.input, before);
  assert.match(JSON.stringify(result.envelope.storySnapshot), /PRIVATE-RAW-MODEL-PROMPT|PRIVATE-DISPATCH-PERMIT/);
  assert.doesNotMatch(JSON.stringify(result.historyMaterials), /PRIVATE-RAW-MODEL-PROMPT|PRIVATE-DISPATCH-PERMIT/);
  assert.equal(result.envelope.archive.format, "zhuwei.authoritative-room-archive/v2");
  assert.deepEqual(Object.keys(result.envelope.archive).sort(), Object.keys(value.input.archive).sort());
});

test("all archived pending dispatch states are quarantined without mutating saved state or granting a permit", async () => {
  const value = await fixture();
  const snapshot = value.input.storySnapshot, host = value.input.hostBindings[0];
  for (const status of ["reserved", "started", "unknown", "notSent"]) {
    const providerRequest = { status, prompt: "PRIVATE-PENDING-PROMPT" };
    const externalBinding = { source: host.source, roomAccountId: "budget:room", invocationKey: `external:${status}`, purpose: "proposal",
      modelRef: await ref("model"), providerRequest, reservation };
    const invocationId = `invocation:${status}`, requestHash = await archiveSha256(externalBinding);
    snapshot.invocations.push({ invocation: { invocationId, jobId: null, stage: null, attemptId: `attempt:${status}`, purpose: "proposal", status,
      requestHash, providerRequest, modelRef: externalBinding.modelRef, eligible: true, reservation,
      startedAt: status === "reserved" ? null : 1_000, completedAt: ["unknown", "notSent"].includes(status) ? 1_000 : null },
    invocationKey: await archiveSha256({ source: snapshot.accounts[1].scopeKey, key: externalBinding.invocationKey }), externalBinding,
    accountIds: [host.source.budgetAccountId, "budget:room"], spent: status === "started" || status === "unknown" ? { ...zero(), calls: 1 } : zero(),
    held: status === "notSent" ? zero() : { ...reservation, calls: status === "reserved" ? 1 : 0, elapsedMs: status === "unknown" ? 0 : reservation.elapsedMs },
    capability: `PRIVATE-PERMIT:${status}`, leaseUntil: status === "started" ? 2_000 : null, completionHash: null });
    const row = snapshot.invocations.at(-1);
    for (const account of snapshot.accounts.filter(account => row.accountIds.includes(account.accountId))) {
      for (const field of Object.keys(zero())) {
        account.spent[field] += row.spent[field]; account.held[field] += row.held[field];
      }
    }
    host.invocationIds.push(invocationId); host.payload.stages.push({ invocationId, requestHash });
  }
  host.payloadHash = await archiveSha256(host.payload);
  await rehashSnapshot(snapshot);
  const before = structuredClone(snapshot), result = await buildStoryArchive(value.input, value.ports);
  assert.equal(result.kind, "prepared", JSON.stringify(result));
  assert.deepEqual(result.quarantine.invocationIds, ["invocation:notSent", "invocation:reserved", "invocation:started", "invocation:unknown"]);
  assert.deepEqual(result.envelope.storySnapshot, before);
  assert.equal(result.quarantine.enforcement, "hostRequiredBeforeRestoreExposure");
  assert.equal(Object.hasOwn(result, "capability"), false);
});

test("valid hashes cannot replace missing real receipt references or an unrelated receipt", async () => {
  for (const mode of ["missing", "unrelated", "range"]) {
    const value = await fixture(), prepared = await buildStoryArchive(value.input, value.ports);
    assert.equal(prepared.kind, "prepared");
    const envelope = prepared.envelope;
    if (mode === "missing") envelope.archive.receiptRefs = [];
    if (mode === "unrelated") envelope.storySnapshot.admissions[0].receiptId = value.world.unrelatedReceipt.receiptId;
    if (mode === "range") envelope.archive.receiptRefs.find(receipt => receipt.receiptId === envelope.storySnapshot.admissions[0].receiptId).eventRange.first = "1";
    await rehashEnvelope(envelope);
    // A host may accept its DTO, but cannot attest an absent Rules receipt.
    const result = await validateStoryArchive(envelope, { ...value.ports, validateHostBinding: () => true });
    assert.deepEqual(result, { kind: "rejected", code: "STORY_ARCHIVE_BINDING_INVALID" });
  }
});

test("admission event and knowledge holder substitutions fail even when all surrounding hashes are recomputed", async () => {
  for (const mode of ["factEvent", "knowledgeEvent", "knowledgeHolder", "extraKnowledge"]) {
    const value = await fixture(), prepared = await buildStoryArchive(value.input, value.ports), envelope = prepared.envelope;
    const admissions = envelope.storySnapshot.admissions;
    if (mode === "factEvent") admissions[0].facts[0].recordedByEventId = value.world.events.at(-1).eventId;
    if (mode === "knowledgeEvent") admissions[0].facts[0].knowledge[0].recordedByEventId = value.world.events.at(-1).eventId;
    if (mode === "knowledgeHolder") admissions[0].facts[0].knowledge[0].holderRef = "character:unrelated";
    if (mode === "extraKnowledge") admissions[0].facts[0].knowledge.push(admissions[0].facts[0].knowledge[0]);
    await rehashEnvelope(envelope);
    assert.deepEqual(await validateStoryArchive(envelope, value.ports), { kind: "rejected", code: "STORY_ARCHIVE_BINDING_INVALID" });
  }
});

test("admitted facts must retain their actual definition pointer in the archived material closure", async () => {
  const value = await fixture("boat", true), prepared = await buildStoryArchive(value.input, value.ports);
  assert.equal(prepared.kind, "prepared", JSON.stringify(prepared));
  assert.deepEqual(prepared.historyMaterials.preparations[0].facts[0].definitionRefs, value.world.admission.definitions[0].definitionRefs);
  for (const definitionRefs of [[], ["definition:archive:unrelated-guild"]]) {
    const envelope = structuredClone(prepared.envelope);
    for (const admission of envelope.storySnapshot.admissions) admission.facts[0].definitionRefs = definitionRefs;
    await rehashEnvelope(envelope);
    assert.deepEqual(await validateStoryArchive(envelope, value.ports), { kind: "rejected", code: "STORY_ARCHIVE_BINDING_INVALID" });
  }
});

test("missing, rebound and incomplete admitted definition mappings reject after every envelope hash is renewed", async () => {
  const value = await fixture("archive"), prepared = await buildStoryArchive(value.input, value.ports);
  assert.equal(prepared.kind, "prepared", JSON.stringify(prepared));
  for (const mode of ["missingField", "empty", "rebound", "event", "closure", "duplicate"]) {
    const envelope = structuredClone(prepared.envelope), admission = envelope.storySnapshot.admissions[0];
    if (mode === "missingField") delete admission.definitions;
    if (mode === "empty") admission.definitions = [];
    if (mode === "rebound") admission.definitions[0].authorityRef = ACTOR;
    if (mode === "event") admission.definitions[0].recordedByEventId = value.world.events.at(-1).eventId;
    if (mode === "closure") admission.definitions[0].definitionRefs.pop();
    if (mode === "duplicate") admission.definitions.push(admission.definitions[0]);
    await rehashEnvelope(envelope);
    const result = await validateStoryArchive(envelope, value.ports);
    assert.equal(result.kind, "rejected", mode);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|candidate:/);
  }
});

test("an admitted archive requires its original Rules command even when a host accepts its DTO and hashes", async () => {
  const value = await fixture("archive"), prepared = await buildStoryArchive(value.input, value.ports);
  assert.equal(prepared.kind, "prepared", JSON.stringify(prepared));
  const trustingHost = { ...value.ports, validateHostBinding: () => true };
  assert.deepEqual(await validateStoryArchive(prepared.envelope, { ...trustingHost, readAdmissionRulesInput: undefined }),
    { kind: "rejected", code: "STORY_ARCHIVE_INVALID" });
  assert.deepEqual(await validateStoryArchive(prepared.envelope, { ...trustingHost, readAdmissionRulesInput: () => undefined }),
    { kind: "rejected", code: "STORY_ARCHIVE_HOST_BINDING_INVALID" });
  for (const mode of ["missing", "changed"]) {
    const envelope = structuredClone(prepared.envelope), host = envelope.hostBindings[0];
    if (mode === "missing") delete host.payload.rulesInput;
    if (mode === "changed") host.payload.rulesInput.steps[0].rulesInput.plan.source.name = "ANOTHER-IDENTITY";
    host.payloadHash = await archiveSha256(host.payload);
    await rehashEnvelope(envelope);
    assert.deepEqual(await validateStoryArchive(envelope, trustingHost), { kind: "rejected",
      code: mode === "missing" ? "STORY_ARCHIVE_HOST_BINDING_INVALID" : "STORY_ARCHIVE_BINDING_INVALID" });
  }
});

test("missing manifests, preparation, admission or host closure cannot become an empty archive", async () => {
  for (const mode of ["manifest", "job", "admission", "host", "invocationMapping"]) {
    const value = await fixture(), prepared = await buildStoryArchive(value.input, value.ports), envelope = prepared.envelope;
    if (mode === "manifest") envelope.storySnapshot.materialManifest = [];
    if (mode === "job") envelope.storySnapshot.jobs = [];
    if (mode === "admission") envelope.storySnapshot.admissions = [];
    if (mode === "host") envelope.hostBindings = [];
    if (mode === "invocationMapping") {
      envelope.hostBindings[0].invocationIds.pop(); envelope.hostBindings[0].payload.stages.pop();
      envelope.hostBindings[0].payloadHash = await archiveSha256(envelope.hostBindings[0].payload);
    }
    await rehashEnvelope(envelope);
    const result = await validateStoryArchive(envelope, value.ports);
    assert.equal(result.kind, "rejected", mode);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|candidate:history|药船/);
  }
});

test("closed host DTO validation is required and sees only immutable input copies", async () => {
  const value = await fixture(), prepared = await buildStoryArchive(value.input, value.ports);
  for (const validateHostBinding of [undefined, () => false, () => Promise.resolve(true)]) {
    const result = await validateStoryArchive(prepared.envelope, { ...value.ports, validateHostBinding });
    assert.equal(result.kind, "rejected");
  }
  const result = await validateStoryArchive(prepared.envelope, { ...value.ports, validateHostBinding(binding, context) {
    const accepted = value.ports.validateHostBinding(binding, context);
    binding.payload.format = "HOST-MUTATION"; context.archive.events.length = 0; context.storySnapshot.jobs.length = 0;
    return accepted;
  } });
  assert.deepEqual(result, { ...prepared, kind: "validated" });
  const changed = structuredClone(prepared.envelope);
  changed.hostBindings[0].payload.sql = "SELECT arbitrary_secret";
  changed.hostBindings[0].payloadHash = await archiveSha256(changed.hostBindings[0].payload);
  await rehashEnvelope(changed);
  assert.deepEqual(await validateStoryArchive(changed, value.ports), { kind: "rejected", code: "STORY_ARCHIVE_HOST_BINDING_INVALID" });
});

test("world, source, story and envelope integrity are all required independently", async () => {
  const value = await fixture(), prepared = await buildStoryArchive(value.input, value.ports);
  for (const change of [
    envelope => { envelope.source.runtimeEpochId = "another-epoch"; },
    envelope => { envelope.archive.events.splice(0, 1); },
    envelope => { envelope.storySnapshot.source.roomId = "another-room"; },
    envelope => { envelope.storySnapshot.invocations[0].invocation.response = { changed: true }; },
    envelope => { envelope.generation = "-1"; },
    envelope => { envelope.audience = "viewer"; },
  ]) {
    const envelope = structuredClone(prepared.envelope); change(envelope);
    // Rehash only the outer envelope: a valid envelope hash cannot disguise a
    // mismatched world/head, snapshot hash, source, generation or audience.
    const { contentHash: _old, ...body } = envelope; envelope.contentHash = await archiveSha256(body);
    assert.equal((await validateStoryArchive(envelope, value.ports)).kind, "rejected");
  }
});
