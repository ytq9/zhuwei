// SPEC 0011 §6: the envelope is read for its structure and materials, without replaying the world.
import assert from "node:assert/strict";
import test from "node:test";
import { buildStoryArchive, validateStoryArchive } from "../../../app/_runtime/lib/room/story-archive.ts";
import { archiveSha256 } from "../../../app/_runtime/lib/room/archive.ts";
import { storyArchiveFixture as fixture } from "../../support/fixtures/story-archive.mjs";

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
  const envelope = await buildStoryArchive(value.input);
  assert.deepEqual(envelope.archive, value.input.archive);
  assert.deepEqual(envelope.storySnapshot, value.input.storySnapshot);
  const result = await validateStoryArchive(envelope);
  assert.equal(result.kind, "validated", JSON.stringify(result));
  assert.deepEqual(result.envelope, envelope);
  assert.equal(result.historyMaterials.preparations.length, 1);
  assert.equal(result.historyMaterials.preparations[0].facts[0].knowledge.length, 1);
  assert.equal(result.historyMaterials.preparations[0].recordedAtEventSeq, value.input.storySnapshot.admissions[0].recordedAtEventSeq);
  assert.deepEqual(result.quarantine, { enforcement: "hostRequiredBeforeRestoreExposure", invocationIds: [], sourceBudgetAccountIds: [value.world.request.source.budgetAccountId] });
  assert.deepEqual(value.input, before);
  assert.match(JSON.stringify(envelope.storySnapshot), /PRIVATE-RAW-MODEL-PROMPT|PRIVATE-DISPATCH-PERMIT/);
  assert.doesNotMatch(JSON.stringify(result.historyMaterials), /PRIVATE-RAW-MODEL-PROMPT|PRIVATE-DISPATCH-PERMIT/);
  assert.equal(envelope.archive.format, "zhuwei.authoritative-room-archive/v2");
  assert.deepEqual(Object.keys(envelope.archive).sort(), Object.keys(value.input.archive).sort());
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
  const before = structuredClone(snapshot), result = await validateStoryArchive(await buildStoryArchive(value.input));
  assert.equal(result.kind, "validated", JSON.stringify(result));
  assert.deepEqual(result.quarantine.invocationIds, ["invocation:notSent", "invocation:reserved", "invocation:started", "invocation:unknown"]);
  assert.deepEqual(result.envelope.storySnapshot, before);
  assert.equal(result.quarantine.enforcement, "hostRequiredBeforeRestoreExposure");
  assert.equal(Object.hasOwn(result, "capability"), false);
});

test("admitted facts keep their definition pointer in the archived material closure", async () => {
  const value = await fixture("boat", true);
  const prepared = await validateStoryArchive(await buildStoryArchive(value.input));
  assert.equal(prepared.kind, "validated", JSON.stringify(prepared));
  assert.deepEqual(prepared.historyMaterials.preparations[0].facts[0].definitionRefs, value.world.admission.definitions[0].definitionRefs);
});

test("missing manifests, preparation, admission or host closure cannot become an empty archive", async () => {
  for (const mode of ["manifest", "job", "admission", "host", "invocationMapping"]) {
    const value = await fixture(), envelope = await buildStoryArchive(value.input);
    if (mode === "manifest") envelope.storySnapshot.materialManifest = [];
    if (mode === "job") envelope.storySnapshot.jobs = [];
    if (mode === "admission") envelope.storySnapshot.admissions = [];
    if (mode === "host") envelope.hostBindings = [];
    if (mode === "invocationMapping") {
      envelope.hostBindings[0].invocationIds.pop(); envelope.hostBindings[0].payload.stages.pop();
      envelope.hostBindings[0].payloadHash = await archiveSha256(envelope.hostBindings[0].payload);
    }
    await rehashEnvelope(envelope);
    const result = await validateStoryArchive(envelope);
    assert.equal(result.kind, "rejected", mode);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|candidate:history|药船/);
  }
});

test("world, source, story and envelope integrity are all required independently", async () => {
  const value = await fixture(), built = await buildStoryArchive(value.input);
  for (const change of [
    envelope => { envelope.source.runtimeEpochId = "another-epoch"; },
    envelope => { envelope.archive.events.splice(0, 1); },
    envelope => { envelope.storySnapshot.source.roomId = "another-room"; },
    envelope => { envelope.storySnapshot.invocations[0].invocation.response = { changed: true }; },
    envelope => { envelope.generation = "-1"; },
    envelope => { envelope.audience = "viewer"; },
  ]) {
    const envelope = structuredClone(built); change(envelope);
    // Rehash only the outer envelope: a valid envelope hash cannot disguise a
    // mismatched world/head, snapshot hash, source, generation or audience.
    const { contentHash: _old, ...body } = envelope; envelope.contentHash = await archiveSha256(body);
    assert.equal((await validateStoryArchive(envelope)).kind, "rejected");
  }
});
