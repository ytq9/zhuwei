import assert from "node:assert/strict";
import test from "node:test";
import { buildStoryArchive, validateStoryArchive } from "../app/_runtime/lib/room/story-archive.ts";
import { archiveSha256, buildAuthoritativeArchive } from "../app/_runtime/lib/room/archive.ts";
import { createHistoryFixture } from "./fixtures/story-history.mjs";

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
  const world = await createHistoryFixture(variant);
  if (withDefinitions) {
    const material = world.preparations[0], candidate = material.preparation.facts[0];
    const definitionRefs = ["definition:archive:river-guild", "definition:archive:unrelated-guild"];
    for (const definitionId of definitionRefs) world.run({ kind: "registerDynamicDefinition", proposalId: `root:${definitionId}`,
      definition: { definitionId, definitionKind: "faction", revision: "1", rulesBasis: "zhuwei-product-ruling",
        visibilityPolicyRef: "visibility:scene-observers", content: { factionId: `faction:${definitionId}`, name: "地方行会",
          goal: "处理行会事务", memberRefs: candidate.subjectRefs, resourceRefs: [] } } });
    const factRef = "fact:archive:guild-involvement";
    world.run({ kind: "declareCanonicalFact", proposalId: "root:archive:guild-involvement", fact: { factId: factRef,
      factKind: "hiddenReality", subjectRefs: candidate.subjectRefs, value: { definitionRef: definitionRefs[0], description: candidate.content },
      source: "dynamicMaterialization", causalParentIds: ["fact:history:origin"], visibilityPolicy: "hiddenUntilEvidence" } });
    for (const item of candidate.knowledge) {
      item.sourceRef = factRef;
      world.run({ kind: "acquireSensoryEvidence", proposalId: `root:archive:guild-knowledge:${item.holderRef}`,
        characterId: item.holderRef, factId: factRef, sense: "hearing", clarity: "obvious", publicEvidence: item.content });
    }
    const record = world.state.canonicalFacts[factRef];
    material.facts = [{ candidateRef: candidate.ref, factRef,
      recordedByEventId: world.events.find(event => event.eventSeq === record.validFromEventSeq).eventId,
      definitionRefs: [definitionRefs[0]], knowledge: candidate.knowledge.map(item => {
        const knowledge = Object.values(world.state.knowledge[item.holderRef]).find(value => value.provenanceChain.includes(factRef));
        return { candidateRef: item.ref, holderRef: item.holderRef, knowledgeRef: knowledge.knowledgeRef, recordedByEventId: knowledge.acquiredByEventId };
      }) }];
  }
  const policyRef = await ref("budget"), modelRef = await ref("model"), jobId = `job:archive:${variant}`;
  const source = { roomId: world.state.roomId, runtimeEpochId: world.state.runtimeEpochId, branchId: world.state.activeBranchId,
    kind: variant === "boat" ? "playerAction" : "worldEvent", sourceId: "source:creative-opportunity", budgetAccountId: "budget:source" };
  const contextBody = { format: "zhuwei.story-context/v1", runtimeRef: await ref("runtime"), moduleRef: await ref("module"),
    materials: [{ ref: "fact:history:origin", kind: "fact", availability: "known", content: "Private original context",
      subjectRefs: [], basisRefs: [] }], readSet: [], timelines: [], supportedCapabilities: [], missingRequiredRefs: [] };
  const context = { ...contextBody, contextHash: await archiveSha256(contextBody) };
  const request = { format: "zhuwei.story-request/v1", jobId, opportunityId: "opportunity:archive", source,
    trigger: { kind: "developGoal", goal: "追查当地事件", basisRefs: ["fact:history:origin"] }, scale: "short", connection: "local",
    methods: ["investigation"], scope: { sceneIds: [], entityIds: [] }, recipeRefs: [], workflowRef: await ref("workflow"), budgetPolicyRef: policyRef };
  const requestHash = await archiveSha256(request);
  const preparation = { ...world.preparations[0].preparation, jobId, requestHash, contextHash: context.contextHash };
  const preparationHash = await archiveSha256(preparation);
  const review = { format: "zhuwei.story-review/v1", preparationHash, contextHash: context.contextHash,
    findings: [{ category: "worldConsistency", verdict: "pass", candidatePaths: ["facts"], constraintRefs: ["fact:history:origin"],
      explanation: "Follows existing facts", repairable: false }], recipeCriteria: [] };
  const budget = { policyRef, roomAccountId: "budget:room", job: limits, source: limits, room: limits };
  const input = { request, context, modelRef, budget, stageReservation: reservation };
  const { jobId: _job, ...requestIdentity } = request;
  const identityHash = await archiveSha256({ request: requestIdentity, context, modelRef, budget, stageReservation: reservation });
  const accounts = [
    { accountId: "budget:room", scopeKey: await archiveSha256({ roomId: source.roomId, epoch: source.runtimeEpochId }), kind: "room",
      binding: { roomId: source.roomId, runtimeEpochId: source.runtimeEpochId, policyRef } },
    { accountId: "budget:source", scopeKey: await archiveSha256({ roomId: source.roomId, epoch: source.runtimeEpochId,
      branch: source.branchId, kind: source.kind, sourceId: source.sourceId }), kind: "source", binding: { source, policyRef, roomAccountId: "budget:room" } },
    { accountId: `story-job:${jobId}`, scopeKey: `job:${jobId}`, kind: "job", binding: { identityHash, policyRef } },
  ].map(value => ({ ...value, limits, spent: { ...zero(), calls: 2 }, held: zero() }));
  const invocations = [];
  for (const stage of ["draft", "review"]) {
    const response = stage === "draft" ? { preparation } : { review };
    const usage = { inputTokens: 0, outputTokens: 0, costMicros: 0 };
    const providerRequest = { messages: [{ role: "system", content: "PRIVATE-RAW-MODEL-PROMPT" }], stage };
    invocations.push({ invocation: { invocationId: `invocation:${stage}`, jobId, stage, attemptId: `attempt:${stage}`, purpose: stage,
      status: "completed", requestHash: await archiveSha256({ stage, providerRequest }), providerRequest, modelRef, eligible: true,
      reservation, startedAt: 1_000, completedAt: 1_000, response, usage }, invocationKey: await archiveSha256({ job: jobId, stage }),
    externalBinding: null, accountIds: [`story-job:${jobId}`, "budget:source", "budget:room"], spent: { ...zero(), calls: 1 }, held: zero(),
    capability: `PRIVATE-DISPATCH-PERMIT:${stage}`, leaseUntil: null, completionHash: await archiveSha256({ kind: "completed", response, usage }) });
  }
  const jobs = [{ input, opportunityKey: await archiveSha256({ roomId: source.roomId, epoch: source.runtimeEpochId,
    branch: source.branchId, opportunity: request.opportunityId }), identityHash, requestHash,
  checkpoint: { format: "zhuwei.story-checkpoint/v1", jobId, revision: 2, requestHash, contextHash: context.contextHash,
    status: "ready", draft: preparation, review }, unallocated: zero() }];
  const fact = world.preparations[0].facts[0], mappedEvents = [fact.recordedByEventId, ...fact.knowledge.map(value => value.recordedByEventId)];
  const admissionBindings = [], admissions = [], hostBindings = [];
  for (const [index, eventId] of mappedEvents.entries()) {
    const event = world.events.find(value => value.eventId === eventId), actual = world.state.receipts[event.rootActionId];
    const preparedActionId = `prepared:${event.rootActionId}`, selectedMaterialRefs = [fact.candidateRef,
      ...(index === 0 ? [] : [fact.knowledge[index - 1].candidateRef])];
    const body = { jobId, preparationHash, materialScopeHash: await archiveSha256(selectedMaterialRefs), preparedActionId,
      contextHash: context.contextHash, selectedMaterialRefs, readSet: [], rulesInputHash: await archiveSha256({ fixtureRulesRoot: event.rootActionId }) };
    const binding = { ...body, bindingHash: await archiveSha256(body) };
    admissionBindings.push(binding);
    admissions.push({ jobId, preparationHash, materialScopeHash: binding.materialScopeHash, preparedActionId,
      receiptId: actual.receiptId, bindingHash: binding.bindingHash, recordedAtEventSeq: actual.eventRange.toEventSeq,
      facts: [{ ...fact, knowledge: index === 0 ? [] : [fact.knowledge[index - 1]] }] });
    const invocationIds = index === 0 ? invocations.map(value => value.invocation.invocationId) : [];
    const payload = { format: "story-archive-test/prepared/v1", preparedActionId, rootActionId: event.rootActionId,
      admissionBindingHash: binding.bindingHash, stages: await Promise.all(invocationIds.map(async id => ({ invocationId: id,
        requestHash: invocations.find(value => value.invocation.invocationId === id).invocation.requestHash }))) };
    hostBindings.push({ bindingId: preparedActionId, kind: "preparedAction", source, jobIds: [jobId], invocationIds,
      payload, payloadHash: await archiveSha256(payload) });
  }
  const snapshot = { format: "zhuwei.story-store-archive/v1", source: { roomId: source.roomId, runtimeEpochId: source.runtimeEpochId },
    accounts, jobs, invocations, admissionBindings, admissions, materialManifest: [{ preparationHash, jobId }] };
  await rehashSnapshot(snapshot);
  const receiptRefs = await Promise.all(Object.values(world.state.receipts).map(async value => ({ receiptId: value.receiptId,
    rootActionId: value.rootActionId, status: value.status, activeBranchId: value.branchId,
    eventRange: { first: value.eventRange.fromEventSeq, last: value.eventRange.toEventSeq }, scopeVersions: {},
    randomnessCommitmentHash: await archiveSha256({ receiptId: value.receiptId }) })));
  const archive = await buildAuthoritativeArchive({ roomId: source.roomId, signedGenesis: world.genesis, events: world.events,
    receiptRefs, projectionAudits: [] }, world.runtime.replay);
  const ports = { replay: world.runtime.replay, validateHostBinding(host, context) {
    const value = host.payload;
    if (!keys(value, ["format", "preparedActionId", "rootActionId", "admissionBindingHash", "stages"])
      || value.format !== "story-archive-test/prepared/v1" || value.preparedActionId !== host.bindingId
      || !Array.isArray(value.stages) || value.stages.length !== host.invocationIds.length) return false;
    const bound = context.storySnapshot.admissionBindings.find(binding => binding.preparedActionId === host.bindingId);
    const admission = context.storySnapshot.admissions.find(receipt => receipt.preparedActionId === host.bindingId);
    const receipt = context.archive.receiptRefs.find(receipt => receipt.receiptId === admission?.receiptId);
    return bound?.bindingHash === value.admissionBindingHash && receipt?.rootActionId === value.rootActionId
      && value.stages.every(stage => keys(stage, ["invocationId", "requestHash"]) && host.invocationIds.includes(stage.invocationId)
        && context.storySnapshot.invocations.some(row => row.invocation.invocationId === stage.invocationId && row.invocation.requestHash === stage.requestHash));
  } };
  return { world, input: { archive, storySnapshot: snapshot, hostBindings, generation: "7" }, ports };
}

for (const variant of ["boat", "archive"]) test(`${variant}: private story archive binds real Rules receipts, events and incremental NPC knowledge admission`, async () => {
  const value = await fixture(variant), before = structuredClone(value.input);
  const result = await buildStoryArchive(value.input, value.ports);
  assert.equal(result.kind, "prepared", JSON.stringify(result));
  assert.deepEqual(result.envelope.archive, value.input.archive);
  assert.deepEqual(result.envelope.storySnapshot, value.input.storySnapshot);
  assert.equal(result.historyMaterials.preparations.length, 1);
  assert.equal(result.historyMaterials.preparations[0].facts[0].knowledge.length, 2);
  assert.equal(result.historyMaterials.preparations[0].recordedAtEventSeq, value.input.storySnapshot.admissions[0].recordedAtEventSeq);
  assert.deepEqual(result.quarantine, { enforcement: "hostRequiredBeforeRestoreExposure", invocationIds: [], sourceBudgetAccountIds: ["budget:source"] });
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
    accountIds: ["budget:source", "budget:room"], spent: status === "started" || status === "unknown" ? { ...zero(), calls: 1 } : zero(),
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
    if (mode === "unrelated") envelope.storySnapshot.admissions[0].receiptId = value.world.state.receipts["root:history:future"].receiptId;
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
    if (mode === "knowledgeEvent") admissions[1].facts[0].knowledge[0].recordedByEventId = value.world.events.at(-1).eventId;
    if (mode === "knowledgeHolder") admissions[1].facts[0].knowledge[0].holderRef = "character:unrelated";
    if (mode === "extraKnowledge") admissions[0].facts[0].knowledge = admissions[1].facts[0].knowledge;
    await rehashEnvelope(envelope);
    assert.deepEqual(await validateStoryArchive(envelope, value.ports), { kind: "rejected", code: "STORY_ARCHIVE_BINDING_INVALID" });
  }
});

test("admitted facts must retain their actual definition pointer in the archived material closure", async () => {
  const value = await fixture("boat", true), prepared = await buildStoryArchive(value.input, value.ports);
  assert.equal(prepared.kind, "prepared", JSON.stringify(prepared));
  assert.deepEqual(prepared.historyMaterials.preparations[0].facts[0].definitionRefs, ["definition:archive:river-guild"]);
  for (const definitionRefs of [[], ["definition:archive:unrelated-guild"]]) {
    const envelope = structuredClone(prepared.envelope);
    for (const admission of envelope.storySnapshot.admissions) admission.facts[0].definitionRefs = definitionRefs;
    await rehashEnvelope(envelope);
    assert.deepEqual(await validateStoryArchive(envelope, value.ports), { kind: "rejected", code: "STORY_ARCHIVE_MATERIALS_MISSING" });
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
