import assert from "node:assert/strict";
import test from "node:test";
import { buildStoryArchive, validateStoryArchive } from "../app/_runtime/lib/room/story-archive.ts";
import { archiveSha256 } from "../app/_runtime/lib/room/archive.ts";
import { ACTOR } from "./fixtures/kp-vnext-story-materialization.mjs";
import { storyArchiveFixture as fixture } from "./fixtures/story-archive.mjs";

const ref = async id => ({ id, version: "1", hash: await archiveSha256(id) });
const zero = () => ({ calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0, elapsedMs: 0 });
const reservation = { inputTokens: 100, outputTokens: 200, estimatedCostMicros: 300, elapsedMs: 1_000 };
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
