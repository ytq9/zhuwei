import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { storyReuseSelectionId } from '../app/_runtime/lib/kp/vnext/story-selection.ts';
import { storyLibraryFixture, freezeStoryReuse } from './fixtures/story-library.mjs';
import { pinnedStoryFixture, libraryStores, roomOf, recordSourceStory, recordLibraryAction,
  captureLibraryArchive, creationOfferIds, clone } from './fixtures/story-archive-library-host.mjs';
import { validateStoryArchiveHostBinding, exportStoryArchiveHostBindings,
  restoreStoryArchiveHostBindings } from '../app/_runtime/lib/room/story-archive-host.ts';
import { pendingSnapshot, sourceOf } from './fixtures/story-npc-pending.mjs';
import { prepareHistoricalBranch } from '../app/_runtime/lib/room/story-history/index.ts';
import { extractHistoricalHostingArtifacts } from '../app/_runtime/lib/room/story-library.ts';
import { ACTOR, SCENE } from './fixtures/kp-vnext-story-materialization.mjs';

const rehash = binding => ({ ...binding, payloadHash: canonicalHash(binding.payload) });
async function fixture(name, { create = false } = {}) {
  const f = await pinnedStoryFixture(name), library = storyLibraryFixture(f), s = libraryStores(roomOf(f.state));
  await recordSourceStory(s, f, library.entry);
  const frozen = freezeStoryReuse(f, library, create ? { intentText: f.selectionContext.intent.text } : {});
  const current = recordLibraryAction(s, f, { context: frozen.context, binding: frozen.binding,
    offerIds: create ? creationOfferIds : ['worldInteraction', storyReuseSelectionId(library.entry.libraryRef)] });
  return { f, s, library, frozen, current, ...await captureLibraryArchive(s, f) };
}

test('ready source and later library action keep separate ownership and restore from their actual world prefixes', async () => {
  const v = await fixture('same-room'), { f, s, library, frozen, context, bindings } = v;
  const original = bindings.find(value => value.bindingId === f.storyBinding.selectionContext.binding.preparedActionId);
  const current = bindings.find(value => value.bindingId === frozen.context.binding.preparedActionId);
  assert.ok(original && current); assert.deepEqual(original.jobIds, [f.request.jobId]); assert.deepEqual(current.jobIds, []);
  assert.notEqual(current.source.sourceId, original.source.sourceId);
  assert.deepEqual(frozen.binding.library.entry.artifact.preparation, f.preparation);
  assert.deepEqual(frozen.binding.library.mappings.definitions, f.admission.definitions);
  assert.notEqual(frozen.binding.library.currentContext.contextHash, library.entry.artifact.context.contextHash);
  assert.equal(bindings.every(value => validateStoryArchiveHostBinding(value, context)), true);
  const checked = await v.envelope(), restored = libraryStores(roomOf(f.state));
  restored.storage.transactionSync(() => {
    restored.library.restore(s.library.snapshot());
    assert.equal(restored.story.restoreArchiveSnapshot({ source: sourceOf(f.state), snapshot: context.storySnapshot, quarantine: checked.quarantine }).kind, 'restored');
    restoreStoryArchiveHostBindings(restored.authority, bindings, context);
  });
  const before = pendingSnapshot(restored, f.state);
  assert.deepEqual(exportStoryArchiveHostBindings(restored.authority, before), bindings);
  const resumed = JSON.parse(restored.authority.submissionByPrepared(current.bindingId).prepared_json);
  assert.deepEqual(resumed.storyPreparation.library, frozen.binding.library);
  assert.equal(restored.journal.begin(v.current.calls[0].external).kind, 'completed');
  assert.notEqual(restored.journal.begin(v.current.calls[1].external).kind, 'ready');
  assert.equal(pendingSnapshot(restored, f.state).snapshotHash, before.snapshotHash);
});

test('an initial create offer may resolve its stable opportunity to an existing ready job without reowning that job', async () => {
  const v = await fixture('same-opportunity', { create: true });
  const current = v.bindings.find(value => value.bindingId === v.frozen.context.binding.preparedActionId);
  assert.deepEqual(current.jobIds, []);
  assert.equal(current.payload.submission.prepared.storyPreparation.jobId, v.f.request.jobId);
  assert.equal(validateStoryArchiveHostBinding(current, v.context), true);
  await v.envelope();
});

test('a frozen preparing offer remains valid after its source job becomes ready', async () => {
  const f = await pinnedStoryFixture('preparing-offer'), library = storyLibraryFixture(f), s = libraryStores(roomOf(f.state));
  const earlier = { ...f, state: f.beforeAdmission };
  const selectionLibrary = { ...library, entries: [], jobs: [{ ...library.job, checkpoint: null }], admissions: [],
    journal: { ...library.journal, readAdmissions: () => [] } };
  const frozen = freezeStoryReuse(earlier, selectionLibrary);
  assert.equal(frozen.catalog.offers[0].status, 'preparing');
  assert.equal(frozen.catalog.offers[0].preparationHash, null);
  await recordSourceStory(s, f, library.entry);
  recordLibraryAction(s, earlier, { context: frozen.context, binding: frozen.binding,
    offerIds: ['worldInteraction', storyReuseSelectionId(library.entry.libraryRef)] });
  const captured = await captureLibraryArchive(s, f);
  assert.equal(captured.bindings.every(value => validateStoryArchiveHostBinding(value, captured.context)), true);
  await captured.envelope();
});

test('a coherently rebound context and actual model-stage ledger cannot erase earlier admission mappings', async () => {
  const f = await pinnedStoryFixture('missing-prior-map'), library = storyLibraryFixture(f), s = libraryStores(roomOf(f.state));
  await recordSourceStory(s, f, library.entry);
  const frozen = freezeStoryReuse(f, { ...library, journal: { ...library.journal, readAdmissions: () => [] } });
  assert.deepEqual(frozen.binding.library.mappings.definitions, []);
  recordLibraryAction(s, f, { context: frozen.context, binding: frozen.binding,
    offerIds: ['worldInteraction', storyReuseSelectionId(library.entry.libraryRef)] });
  const captured = await captureLibraryArchive(s, f), current = captured.bindings.find(value => value.bindingId === frozen.context.binding.preparedActionId);
  assert.equal(captured.context.storySnapshot.admissions[0].definitions.length, 1);
  assert.equal(validateStoryArchiveHostBinding(current, captured.context), false);
});

test('rehashing current reuse maps, world context, immutable source or the frozen selection cannot authorize a forged host', async () => {
  const v = await fixture('forgery'), current = v.bindings.find(value => value.bindingId === v.frozen.context.binding.preparedActionId);
  const mutations = [
    b => { b.payload.submission.prepared.storyPreparation.library.mappings.definitions = []; },
    b => { b.payload.submission.prepared.storyPreparation.library.currentRequest.source.sourceId = v.f.rootActionId; },
    b => { b.payload.submission.prepared.storyPreparation.library.currentContext.materials[0].content = { invented: 'new premise' }; },
    b => { b.payload.submission.prepared.storyPreparation.library.entry.artifact.preparation.title = '另一个故事'; },
    b => { b.payload.submission.prepared.storyPreparation.admissionOwner = { kind: 'hostingArtifact', libraryRef: v.library.entry.libraryRef }; },
    b => { b.payload.submission.prepared.storyPreparation.selectionContext.binding.rootActionId = v.f.rootActionId; },
    b => { b.jobIds = [v.f.request.jobId]; },
  ];
  for (const mutate of mutations) {
    const forged = clone(current); mutate(forged);
    const library = forged.payload.submission.prepared.storyPreparation.library;
    const { validationHash: _validation, ...value } = library; library.validationHash = canonicalHash(value);
    assert.equal(validateStoryArchiveHostBinding(rehash(forged), v.context), false);
  }
  const missing = clone(v.context); missing.storySnapshot.hostingArtifacts = [];
  assert.equal(validateStoryArchiveHostBinding(current, missing), false);
});

test('a new historical identity restores its selected hosting artifact without the original job, source account or NPC control', async () => {
  const f = await pinnedStoryFixture('historical'), sourceLibrary = storyLibraryFixture(f), sourceStore = libraryStores(roomOf(f.state));
  await recordSourceStory(sourceStore, f, sourceLibrary.entry);
  const original = await captureLibraryArchive(sourceStore, f), validated = await original.envelope();
  const archive = original.context.archive, source = { ...roomOf(f.state), archiveHash: archive.archiveHash };
  const character = { id: 'character:library-history:new', kind: 'player', name: '新来的查档人', sceneId: SCENE, tenureStatus: 'active' };
  const cut = { eventSeq: archive.head.eventSeq, focusSceneId: SCENE };
  const initialized = f.runtime.step(undefined, undefined, { kind: 'initializeHistoricalWorld', schema: 'zhuwei.historical-world-initialization/v1',
    roomId: `${f.state.roomId}:new`, runtimeEpochId: `${f.state.runtimeEpochId}:new`, activeBranchId: 'branch:library-history:new',
    sourceArchive: archive, cut, identity: { character, principal: { id: 'principal:library-history:new', sessionVersion: 1 },
      seatId: 'seat:library-history:new', originBasisRefs: ['anchor:requisition'] } });
  assert.equal(initialized.kind, 'initialized', JSON.stringify(initialized));
  const prepared = await prepareHistoricalBranch({ access: { principalId: f.viewer.principalId, authorizationVersion: '1' }, source, cut,
    identity: { kind: 'newCharacter', characterId: character.id, sceneId: SCENE, originBasisRefs: ['anchor:requisition'],
      character: { name: character.name, background: '新来到当地查阅登记材料。' } } }, {
    replay: f.runtime.replay,
    async readSource({ authorizationBindingHash }) { return { kind: 'available', authorizationBindingHash,
      value: { archive, ...validated.historyMaterials } }; },
    async validateHistoricalCut({ authorizationBindingHash, verificationHash }) { return { kind: 'verified', authorizationBindingHash, verificationHash }; },
    async validateNewIdentity({ authorizationBindingHash, verificationHash }) { return { kind: 'verified', authorizationBindingHash, verificationHash }; },
  });
  assert.equal(prepared.kind, 'branchPrepared', JSON.stringify(prepared));
  const target = { ...f, state: initialized.genesis.initialState, genesis: initialized.genesis, profiles: initialized.profiles,
    rootActionId: 'root:library-history:new', actorCharacterId: character.id, events: [] };
  const entries = extractHistoricalHostingArtifacts({ room: roomOf(target.state), seed: prepared.seed, validated, targetGenesis: target.genesis });
  assert.equal(entries.length, 1); assert.deepEqual(entries[0].artifact, sourceLibrary.entry.artifact);
  const library = storyLibraryFixture(target, entries), frozen = freezeStoryReuse(target, library), s = libraryStores(roomOf(target.state));
  s.library.save(entries[0]);
  recordLibraryAction(s, target, { context: frozen.context, binding: frozen.binding,
    offerIds: ['worldInteraction', storyReuseSelectionId(entries[0].libraryRef)] });
  const captured = await captureLibraryArchive(s, target), checked = await captured.envelope();
  assert.equal(captured.context.storySnapshot.jobs.length, 0);
  assert.equal(captured.context.storySnapshot.admissions.length, 0);
  assert.deepEqual(captured.bindings[0].jobIds, []);
  assert.ok(captured.context.storySnapshot.invocations.every(call => call.invocation.jobId === null));
  assert.equal(captured.context.storySnapshot.accounts.some(value => value.accountId === f.request.source.budgetAccountId), false);
  assert.equal(target.state.characterControls[ACTOR], undefined);
  assert.deepEqual(target.state.knowledge[character.id], {});
  const restored = libraryStores(roomOf(target.state));
  restored.storage.transactionSync(() => {
    restored.library.restore(s.library.snapshot());
    assert.equal(restored.story.restoreArchiveSnapshot({ source: sourceOf(target.state), snapshot: captured.context.storySnapshot,
      quarantine: checked.quarantine }).kind, 'restored');
    restoreStoryArchiveHostBindings(restored.authority, captured.bindings, captured.context);
  });
  assert.deepEqual(exportStoryArchiveHostBindings(restored.authority, pendingSnapshot(restored, target.state)), captured.bindings);
  assert.deepEqual(sourceStore.story.readJob(f.request.jobId).checkpoint, f.checkpoint);
  const forged = clone(captured.bindings[0]); forged.payload.submission.prepared.storyPreparation.library.entry.origin.cutEventSeq = '0';
  assert.equal(validateStoryArchiveHostBinding(rehash(forged), captured.context), false);
});
