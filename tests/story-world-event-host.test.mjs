import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { freezeWorldStoryHostContext, worldStoryHostInvocationBinding, worldStoryHostPreparationInput,
  verifyFrozenWorldStoryHostContext, exportWorldStoryHostBinding, validateWorldStoryHostPayload,
} from '../app/_runtime/lib/room/story-world-event-host.ts';
import { WORLD_STORY_SELECTION_BINDING_HASH, WORLD_STORY_SELECTION_TOOL_NAME } from '../app/_runtime/lib/room/story-world-event.ts';
import { StoryCreationStore } from '../app/_runtime/lib/room/story-creation-store.ts';
import { createStoryExternalInvocationJournal } from '../app/_runtime/lib/room/story-external-invocation-journal.ts';
import { ROOM_STORY_TRANSPORT } from '../app/_runtime/lib/room/story-runtime-policy.ts';
import { storyTransportRef } from '../app/_runtime/lib/room/story-preparation-host.ts';
import { buildAuthoritativeArchive } from '../app/_runtime/lib/room/archive.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { validateRoomStoryContext } from '../app/_runtime/lib/room/story-context.ts';
import { worldStoryFixture, WORLD_TRACE } from './fixtures/story-world-event.mjs';
import { ARCHIVIST, ARCHIVE, OTHER } from './fixtures/story-context.mjs';

const selection = { kind: 'prepareStory', reason: '已核对的登记出现了可继续调查的现实矛盾。',
  selection: { method: 'story.method.archive-investigation', scale: 'short', connection: 'local' } };
const response = decision => ({ choices: [{ message: { tool_calls: [{ type: 'function',
  function: { name: WORLD_STORY_SELECTION_TOOL_NAME, arguments: JSON.stringify({ decision }) } }] } }] });
const emptyLibrary = () => ({ jobs: [], entries: [], admissions: [] });
const sourceOf = state => ({ roomId: state.roomId, runtimeEpochId: state.runtimeEpochId });
function stores() {
  const db = new DatabaseSync(':memory:'); let tx = 0, id = 0;
  const storage = { sql: { exec(query, ...args) {
    const rows = args.length === 0 && /^(CREATE|ALTER|DELETE)\b/u.test(query.trim()) ? (db.exec(query), [])
      : db.prepare(query).all(...args).map(row => ({ ...row }));
    return { toArray: () => rows, one: () => { assert.equal(rows.length, 1); return rows[0]; },
      [Symbol.iterator]: function* () { yield* rows; } };
  } }, transactionSync(callback) {
    const name = `world_host_${++tx}`; db.exec(`SAVEPOINT ${name}`);
    try { const value = callback(); db.exec(`RELEASE ${name}`); return value; }
    catch (error) { db.exec(`ROLLBACK TO ${name}`); db.exec(`RELEASE ${name}`); throw error; }
  } };
  const story = new StoryCreationStore(storage, { hash: canonicalHash, now: () => 10, newId: () => `world-host-call:${++id}` });
  story.ensureSchema(); return { db, story, journal: createStoryExternalInvocationJournal(story) };
}
function snapshot(s, state) {
  const captured = s.story.archiveSnapshot(sourceOf(state));
  assert.equal(captured.kind, 'available', JSON.stringify(captured)); return captured.snapshot;
}
async function fixture(options) {
  const f = worldStoryFixture(options), state = structuredClone(f.state);
  // Authoritative snapshot fixtures become a sealed test genesis before the
  // real due input. Every subsequent event is produced and replayed by Rules.
  const { eventHeadHash: _head, lastEventId: _event, ...domain } = state, initialStateHash = canonicalHash(domain);
  state.eventHeadHash = initialStateHash;
  const { genesisHash: _genesis, ...unsigned } = { ...f.genesis, moduleRef: f.moduleProfile.moduleRef, initialState: state, initialStateHash };
  const genesis = { ...unsigned, genesisHash: canonicalHash(unsigned) };
  const before = f.runtime.replay(genesis, []); assert.equal(before.kind, 'replayed', JSON.stringify(before));
  const result = f.resolve(before.state), commit = f.commitInput(result, before.state);
  const replayed = f.runtime.replay(genesis, result.events); assert.equal(replayed.kind, 'replayed', JSON.stringify(replayed));
  assert.deepEqual(replayed.state, result.state);
  const receiptRefs = Object.values(result.state.receipts).map(receipt => ({ receiptId: receipt.receiptId,
    rootActionId: receipt.rootActionId, actorCharacterId: ARCHIVIST, status: receipt.status, activeBranchId: receipt.branchId,
    eventRange: { first: receipt.eventRange.fromEventSeq, last: receipt.eventRange.toEventSeq },
    scopeVersions: {}, randomnessCommitmentHash: canonicalHash([]) }));
  const archive = await buildAuthoritativeArchive({ roomId: state.roomId, signedGenesis: genesis,
    events: result.events, receiptRefs, projectionAudits: [] }, f.runtime.replay);
  const frozen = freezeWorldStoryHostContext({ commit, moduleProfile: f.moduleProfile, library: emptyLibrary(), maxContextUnits: f.maxUnits }, f.runtime);
  assert.equal(frozen.kind, 'frozen', JSON.stringify(frozen));
  return { ...f, state: result.state, genesis, commit, archive, frozen: frozen.context };
}
function begin(s, f) {
  const external = worldStoryHostInvocationBinding(f.frozen, f.state, f.profiles), begun = s.journal.begin(external);
  assert.equal(begun.kind, 'ready', JSON.stringify(begun));
  const stage = { ordinal: 1, contextHash: f.frozen.contextHash, bindingHash: WORLD_STORY_SELECTION_BINDING_HASH,
    requestHash: canonicalHash(external.providerRequest), repairTicket: null, invocationId: begun.invocationId };
  return { external, begun, stage };
}
function complete(s, call, decision = selection) {
  assert.equal(s.journal.complete(call.external, { ...call.begun, result: { kind: 'completed', response: response(decision),
    usage: { inputTokens: 20, outputTokens: 20, costMicros: 1 } } }).kind, 'saved');
}
function openPreparation(s, input) {
  const opened = s.story.openJob({ request: input.request, context: input.context, budget: input.budget,
    modelRef: storyTransportRef(ROOM_STORY_TRANSPORT), stageReservation: {
      inputTokens: 48_000, outputTokens: 12_000, estimatedCostMicros: 576_000, elapsedMs: 45_000 } });
  assert.equal(opened.kind, 'opened', JSON.stringify(opened)); return opened.job;
}
function context(s, f) { return { archive: f.archive, storySnapshot: snapshot(s, f.state) }; }
const rehashFrozen = value => {
  const { contextHash: _old, ...body } = value; value.contextHash = canonicalHash(body); return value;
};

test('real NPC and faction terminal commits survive JSON serialization and exact archive prefix replay', async () => {
  for (const faction of [false, true]) {
    const f = await fixture({ faction }), s = stores();
    try {
      const frozen = JSON.parse(JSON.stringify(f.frozen)), verified = verifyFrozenWorldStoryHostContext(frozen, context(s, f), f.runtime);
      assert.equal(verified.kind, 'verified', JSON.stringify(verified));
      assert.deepEqual(verified.state, f.state);
      assert.deepEqual(verified.binding.source, f.commit.budgetSource);
      const sent = JSON.parse(verified.binding.providerRequest.messages[1].content);
      assert.deepEqual(sent.existingPreparations, frozen.library.catalog);
      const body = worldStoryHostPreparationInput(frozen, selection, verified.state, verified.profiles);
      assert.equal(body.kind, 'ready', JSON.stringify(body));
      assert.ok(body.context.materials.find(value => value.ref === WORLD_TRACE));
      assert.ok(body.context.materials.find(value => value.ref === `story-context:scene-frontiers:${ARCHIVE}`));
      assert.deepEqual(body.context.materials.find(value => value.ref === 'story-library:catalog').content, frozen.library.catalog);
      assert.deepEqual(validateRoomStoryContext({ ...f, request: body.request, context: body.context }), { kind: 'valid' });
      assert.doesNotMatch(JSON.stringify(body.context), /OTHER_PLAYER_PRIVATE_CANARY/);
      assert.equal(body.context.materials.some(value => value.ref === `knowledge:${OTHER}:knowledge:private-player`), false);
    } finally { s.db.close(); }
  }
});

test('one persisted routing call opens the shared complete author input and owns its exact job archive association', async () => {
  const f = await fixture(), s = stores();
  try {
    const call = begin(s, f); complete(s, call);
    const preparation = worldStoryHostPreparationInput(f.frozen, selection, f.state, f.profiles);
    assert.equal(preparation.kind, 'ready', JSON.stringify(preparation));
    const job = openPreparation(s, preparation), ctx = context(s, f);
    const binding = exportWorldStoryHostBinding(f.frozen, { sourceChain: [], stages: [call.stage], storySnapshot: ctx.storySnapshot });
    assert.deepEqual(binding.jobIds, [job.request.jobId]);
    assert.deepEqual(binding.invocationIds, [call.begun.invocationId]);
    assert.equal(validateWorldStoryHostPayload(JSON.parse(JSON.stringify(binding)), ctx, f.runtime), true);
    assert.deepEqual(s.journal.begin(call.external).kind, 'completed');
    assert.deepEqual(snapshot(s, f.state), ctx.storySnapshot, 're-reading known selection neither charges nor dispatches');
    const changed = structuredClone(ctx);
    changed.storySnapshot.jobs[0].input.context.materials[0].content = { secretlyRefreshed: true };
    assert.equal(validateWorldStoryHostPayload(binding, changed, f.runtime), false);
  } finally { s.db.close(); }
});

test('noStory, failed, unknown and invalid selections remain journaled with no author job and no new send permit', async () => {
  for (const outcome of ['noStory', 'failed', 'unknown', 'invalid']) {
    const f = await fixture(), s = stores(), restored = stores();
    try {
      const call = begin(s, f);
      if (outcome === 'noStory') complete(s, call, { kind: 'noStory', reason: '普通事务已经结束。' });
      else if (outcome === 'invalid') complete(s, call, { kind: 'noStory', reason: '额外写入', knowledge: ['PRIVATE_CANARY'] });
      else assert.equal(s.journal.complete(call.external, { ...call.begun, result: { kind: outcome } }).kind, 'saved');
      const ctx = context(s, f), binding = exportWorldStoryHostBinding(f.frozen,
        { sourceChain: [], stages: [call.stage], storySnapshot: ctx.storySnapshot });
      assert.equal(validateWorldStoryHostPayload(binding, ctx, f.runtime), true, outcome);
      assert.deepEqual(binding.jobIds, []);
      assert.notEqual(s.journal.begin(call.external).kind, 'ready');
      assert.deepEqual(snapshot(s, f.state), ctx.storySnapshot);
      assert.equal(restored.story.restoreArchiveSnapshot({ source: sourceOf(f.state), snapshot: ctx.storySnapshot,
        quarantine: { invocationIds: outcome === 'unknown' ? [call.begun.invocationId] : [],
          sourceBudgetAccountIds: [call.external.source.budgetAccountId] } }).kind, 'restored');
      assert.notEqual(restored.journal.begin(call.external).kind, 'ready');
      assert.equal(snapshot(restored, f.state).snapshotHash, ctx.storySnapshot.snapshotHash);
      if (outcome === 'unknown') assert.ok(s.story.readBudget(call.external.source.budgetAccountId).held.inputTokens > 0);
    } finally { s.db.close(); restored.db.close(); }
  }
});

test('rehashing the original Rules input, snapshot sequence, module, trigger or catalogue cannot forge a world source', async () => {
  const f = await fixture(), s = stores();
  try {
    const ctx = context(s, f);
    for (const change of [
      value => { value.rulesInput.decision = 'cancel'; value.rulesInput.reason = '伪造的取消决定'; },
      value => { value.baseEventSeq = value.trigger.after.eventSeq; value.trigger.before.eventSeq = value.baseEventSeq;
        const { triggerHash: _old, ...body } = value.trigger; value.trigger.triggerHash = canonicalHash(body); },
      value => { value.moduleProfile.storyBible.coreTruth = '伪造正史'; },
      value => { value.trigger.events[0].payload.forged = '已完成';
        const { triggerHash: _old, ...body } = value.trigger; value.trigger.triggerHash = canonicalHash(body); },
      value => { value.library.jobs.push({ jobId: 'fabricated-world-story', checkpoint: null }); },
      value => { value.library.catalog.offers.push({ libraryRef: canonicalHash('forged'), status: 'ready' });
        const { catalogHash: _old, ...body } = value.library.catalog; value.library.catalog.catalogHash = canonicalHash(body); },
    ]) {
      const forged = structuredClone(f.frozen); change(forged); rehashFrozen(forged);
      assert.equal(verifyFrozenWorldStoryHostContext(forged, ctx, f.runtime).kind, 'blocked');
    }
  } finally { s.db.close(); }
});

test('an actual existing opportunity is frozen for selector and author and never opens another job', async () => {
  const f = await fixture(), s = stores();
  try {
    const preparation = worldStoryHostPreparationInput(f.frozen, selection, f.state, f.profiles);
    assert.equal(preparation.kind, 'ready');
    const job = openPreparation(s, preparation);
    const frozen = freezeWorldStoryHostContext({ commit: f.commit, moduleProfile: f.moduleProfile,
      library: { ...emptyLibrary(), jobs: [job] }, maxContextUnits: f.maxUnits }, f.runtime);
    assert.equal(frozen.kind, 'frozen', JSON.stringify(frozen));
    assert.equal(frozen.context.library.catalog.offers[0].status, 'preparing');
    assert.equal(verifyFrozenWorldStoryHostContext(frozen.context, context(s, f), f.runtime).kind, 'verified');
    assert.equal(worldStoryHostPreparationInput(frozen.context, selection, f.state, f.profiles).kind, 'existing');
    const binding = exportWorldStoryHostBinding(frozen.context, { sourceChain: [], stages: [], storySnapshot: snapshot(s, f.state) });
    assert.deepEqual(binding.jobIds, [], 'pre-existing catalogue jobs retain their original Host ownership');
    const forged = structuredClone(frozen.context);
    forged.library.jobs[0].checkpoint = { format: 'zhuwei.story-checkpoint/v1', jobId: job.request.jobId,
      revision: 1, requestHash: job.requestHash, contextHash: job.context.contextHash, status: 'ready' };
    rehashFrozen(forged);
    assert.equal(verifyFrozenWorldStoryHostContext(forged, context(s, f), f.runtime).kind, 'blocked');
  } finally { s.db.close(); }
});

test('a frozen preparing checkpoint remains a complete typed prefix when the actual job later terminates', async () => {
  const f = await fixture(), s = stores();
  try {
    const preparation = worldStoryHostPreparationInput(f.frozen, selection, f.state, f.profiles);
    assert.equal(preparation.kind, 'ready');
    const job = openPreparation(s, preparation), first = { format: 'zhuwei.story-checkpoint/v1', jobId: job.request.jobId,
      revision: 1, requestHash: job.requestHash, contextHash: job.context.contextHash, status: 'preparing' };
    assert.equal(s.story.checkpoint({ expectedRevision: 0, next: first }).ok, true);
    const frozen = freezeWorldStoryHostContext({ commit: f.commit, moduleProfile: f.moduleProfile,
      library: { ...emptyLibrary(), jobs: [s.story.readJob(job.request.jobId)] }, maxContextUnits: f.maxUnits }, f.runtime);
    assert.equal(frozen.kind, 'frozen');
    assert.equal(verifyFrozenWorldStoryHostContext(frozen.context, context(s, f), f.runtime).kind, 'verified');
    assert.equal(s.story.checkpoint({ expectedRevision: 1, next: { ...first, revision: 2,
      status: 'rejected', failureCode: 'STORY_OUTPUT_INVALID' } }).ok, true);
    const saved = context(s, f);
    assert.equal(verifyFrozenWorldStoryHostContext(frozen.context, saved, f.runtime).kind, 'verified');
    for (const change of [
      checkpoint => { delete checkpoint.contextHash; },
      checkpoint => { checkpoint.format = 'forged-checkpoint'; },
      checkpoint => { checkpoint.revision = 0; },
      checkpoint => { checkpoint.extra = 'undeclared'; },
      checkpoint => { checkpoint.review = {}; },
      checkpoint => { checkpoint.failureCode = 'STORY_OUTPUT_INVALID'; },
    ]) {
      const forged = structuredClone(frozen.context); change(forged.library.jobs[0].checkpoint); rehashFrozen(forged);
      assert.equal(verifyFrozenWorldStoryHostContext(forged, saved, f.runtime).kind, 'blocked');
    }
  } finally { s.db.close(); }
});
