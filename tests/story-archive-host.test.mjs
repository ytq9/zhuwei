import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { AuthoritativeRoomStore } from '../app/_runtime/lib/room/authority-store.ts';
import { StoryCreationStore } from '../app/_runtime/lib/room/story-creation-store.ts';
import { createStoryExternalInvocationJournal } from '../app/_runtime/lib/room/story-external-invocation-journal.ts';
import { exportStoryArchiveHostBindings, validateStoryArchiveHostBinding, restoreStoryArchiveHostBindings } from '../app/_runtime/lib/room/story-archive-host.ts';
import { isCanonicalAuthorityRecoveryInput, verifiedAuthorityCommitRecovery } from '../app/_runtime/lib/room/authority-commit-recovery.ts';
import { roomModelInvocationBinding } from '../app/_runtime/lib/room/story-runtime-policy.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { createVNextProposalOfferModelInput } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { proposalModelContext } from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { VNEXT_KP_PROFILE, VNEXT_KP_WORKFLOW_HASH, VNEXT_PROVIDER_BUDGET } from '../app/_runtime/lib/kp/vnext/runtime-policy.ts';
import { naturalNarrationModelInput, narrationReviewModelInput } from '../app/_runtime/lib/kp/narration-vnext.ts';
import { freezeNarrationContext } from '../app/_runtime/lib/kp/narration-context.ts';
import { deepSeekRequestBody } from '../app/_runtime/lib/kp/deepseek.ts';
import { promiseReviewModelInput, PROMISE_REVIEW_BINDING_HASH } from '../app/_runtime/lib/kp/vnext/promise-review.ts';
import { assembleProviderInvocation, INITIAL_REPAIR_LEDGER } from '../app/_runtime/lib/kp/vnext/invocation/assemble.ts';
import { buildAuthoritativeArchive } from '../app/_runtime/lib/room/archive.ts';
import { dueActivityDescriptors } from '../app/_runtime/lib/rules/v2/due-activities.ts';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { promiseFixture, makePromiseInput, NPC, SCENE } from './fixtures/vnext-promise-lifecycle.mjs';

// Real SQLite behind the DO's tiny storage API; no Worker/Vitest pool needed.
function stores() {
  const db = new DatabaseSync(':memory:'); let tx = 0, id = 0;
  const storage = { sql: { exec(query, ...args) {
    let rows;
    if (args.length === 0 && /^(CREATE|ALTER|DELETE)\b/u.test(query.trim())) { db.exec(query); rows = []; }
    else rows = db.prepare(query).all(...args).map(row => ({ ...row }));
    return { toArray: () => rows, one: () => { assert.equal(rows.length, 1); return rows[0]; },
      [Symbol.iterator]: function* () { yield* rows; } };
  } }, transactionSync(callback) {
    const name = `host_test_${++tx}`; db.exec(`SAVEPOINT ${name}`);
    try { const result = callback(); db.exec(`RELEASE ${name}`); return result; }
    catch (error) { db.exec(`ROLLBACK TO ${name}`); db.exec(`RELEASE ${name}`); throw error; }
  } };
  const authority = new AuthoritativeRoomStore(storage), story = new StoryCreationStore(storage, {
    hash: canonicalHash, now: () => 1000, newId: () => `invocation:${++id}`,
  });
  authority.ensureSchema(); story.ensureSchema();
  return { db, storage, authority, story, journal: createStoryExternalInvocationJournal(story) };
}
const sourceOf = state => ({ roomId: state.roomId, runtimeEpochId: state.runtimeEpochId });
function storySnapshot(s, state) {
  const captured = s.story.archiveSnapshot(sourceOf(state)); assert.equal(captured.kind, 'available', JSON.stringify(captured));
  return captured.snapshot;
}
function stage(s, { state, sourceRoot, preparedId, ordinal = 1, purpose = 'proposal', contextHash, bindingHash = VNEXT_KP_WORKFLOW_HASH,
  request, response, repairTicket = null }) {
  const key = purpose === 'proposal' ? `proposal:${preparedId}:${ordinal}` : purpose === 'npc' ? `npc:${preparedId}:${ordinal}` : `${preparedId}:${ordinal}`;
  const external = roomModelInvocationBinding(state, sourceRoot, key, purpose, request);
  const begun = s.storage.transactionSync(() => {
    const begun = s.journal.begin(external); assert.equal(begun.kind, 'ready', JSON.stringify(begun));
    s.authority.saveVnextInvocationProof({ prepared_action_id: preparedId, ordinal, context_hash: contextHash,
      binding_hash: bindingHash, request_hash: canonicalHash(request), repair_ticket_json: repairTicket === null ? null : JSON.stringify(repairTicket),
      invocation_id: begun.invocationId, external_binding_json: JSON.stringify(external) });
    return begun;
  });
  if (response !== undefined) assert.equal(s.journal.complete(external, { ...begun,
    result: { kind: 'completed', response, usage: { inputTokens: 10, outputTokens: 10, costMicros: 1 } } }).kind, 'saved');
  return { external, begun };
}
function receiptReference(receipt, actorCharacterId) {
  return { receiptId: receipt.receiptId, rootActionId: receipt.rootActionId, actorCharacterId, status: receipt.status,
    activeBranchId: receipt.branchId, eventRange: { first: receipt.eventRange.fromEventSeq, last: receipt.eventRange.toEventSeq },
    scopeVersions: {}, randomnessCommitmentHash: canonicalHash([]) };
}
function publicReceipt(receipt, state, actorCharacterId) {
  return { ...receiptReference(receipt, actorCharacterId), runtimeEpochId: state.runtimeEpochId, randomnessCommitments: [] };
}
async function preparedFixture() {
  const f = createAuthoredProbeFixture('story-host-player'), s = stores(), required = f.requiredContext;
  const originalInput = { kind: 'intent', submissionId: required.intent.submissionRef, text: required.intent.text };
  const prepared = { kind: 'prepared', preparedActionId: required.binding.preparedActionId, rootActionId: f.rootActionId,
    requiredContext: required, resolutionMode: 'kpProposal', phase: 'playerIntent',
    kpProjection: f.runtime.project(f.profiles, f.state, { kind: 'kp', capability: 'internal:kp-spatial-evidence' }) };
  s.authority.insertSubmission({ submissionId: required.intent.submissionRef, principalId: f.viewer.principalId,
    payloadHash: canonicalHash(originalInput), inputKind: 'intent', rootActionId: f.rootActionId,
    preparedActionId: prepared.preparedActionId, characterId: ACTOR, sceneScope: `scene:${SCENE}`, preparedScopeVersion: 0,
    prepared, continuation: { originalInput } });
  const request = deepSeekRequestBody(VNEXT_KP_PROFILE.modelId,
    createVNextProposalOfferModelInput(JSON.stringify({ requiredContext: proposalModelContext(required) })));
  const call = stage(s, { state: f.state, sourceRoot: f.rootActionId, preparedId: prepared.preparedActionId,
    contextHash: required.binding.contextHash, request });
  const archive = await buildAuthoritativeArchive({ roomId: f.state.roomId, signedGenesis: f.genesis, events: [], receiptRefs: [], projectionAudits: [] }, f.runtime.replay);
  return { f, s, prepared, call, context: { archive, storySnapshot: storySnapshot(s, f.state) } };
}
function rehash(binding) { binding.payloadHash = canonicalHash(binding.payload); return binding; }

test('real prepared-action context, semantic proof and SQLite operational rows survive private restore', async () => {
  const { s, f, prepared, call, context } = await preparedFixture();
  const bindings = exportStoryArchiveHostBindings(s.authority, context.storySnapshot);
  assert.equal(bindings.length, 1); assert.equal(validateStoryArchiveHostBinding(bindings[0], context), true);
  const encoded = JSON.stringify(bindings);
  for (const key of ['result_json', 'external_binding_json', 'capability', 'providerRequest', 'leaseUntil', 'publication_result_json']) {
    assert.equal(encoded.includes(`"${key}"`), false, key);
  }
  const restored = stores();
  restored.storage.transactionSync(() => {
    assert.equal(restored.story.restoreArchiveSnapshot({ source: sourceOf(f.state), snapshot: context.storySnapshot,
      quarantine: { invocationIds: [call.begun.invocationId], sourceBudgetAccountIds: [call.external.source.budgetAccountId] } }).kind, 'restored');
    restoreStoryArchiveHostBindings(restored.authority, bindings, context);
  });
  assert.deepEqual(exportStoryArchiveHostBindings(restored.authority, storySnapshot(restored, f.state)), bindings);
  assert.equal(restored.authority.submissionByPrepared(prepared.preparedActionId).result_json, null);
  assert.notEqual(restored.journal.begin(call.external).kind, 'ready', 'restored physical call cannot dispatch');
  assert.equal(storySnapshot(restored, f.state).snapshotHash, context.storySnapshot.snapshotHash, 'quarantined retry adds no call or charge');
  assert.equal(restored.authority.isAuthorityEmpty(), false);
  restored.authority.clearAllRowsForDeletion(); assert.equal(restored.authority.isAuthorityEmpty(), true);
});

test('rehashed forged context, protocol, extra command, association and ordinal fail semantic host validation', async () => {
  const { s, context } = await preparedFixture(), [binding] = exportStoryArchiveHostBindings(s.authority, context.storySnapshot);
  for (const change of [
    b => { b.payload.submission.prepared.requiredContext.intent.text = '篡改原始意图'; },
    b => { b.payload.submission.prepared.requiredContext.binding.stateHash = canonicalHash('other state'); },
    b => { b.payload.stages[0].bindingHash = canonicalHash('different protocol'); },
    b => { b.payload.stages[0].ordinal = 2; },
    b => { b.payload.stages[0].status = 'completed'; },
    b => { b.payload.submission.prepared.commands = [{ sql: 'DELETE FROM authority_events' }]; },
    b => { b.payload.admissionInput = { kind: 'declareCanonicalFact', fact: { value: 'invented' } }; },
    b => { b.invocationIds = []; },
    b => { b.source.sourceId = 'a different origin'; },
  ]) {
    const forged = structuredClone(binding); change(forged); rehash(forged);
    assert.equal(validateStoryArchiveHostBinding(forged, context), false);
  }
});

async function narrationFixture() {
  const f = promiseFixture('story-host-narration'), s = stores(), input = makePromiseInput(f, f.state, { nextStep: null });
  const committed = f.runtime.step(f.profiles, f.state, input); assert.equal(committed.kind, 'committed', JSON.stringify(committed));
  const receipt = publicReceipt(committed.receipt, committed.state, ACTOR); delete receipt.randomnessCommitmentHash;
  const projected = f.runtime.project(f.profiles, committed.state, f.viewer, {
    committedRange: { receiptId: receipt.receiptId, actorCharacterId: ACTOR, priorState: f.state, events: committed.events },
  });
  assert.ok(projected.renderableClaims?.claims.length > 0);
  const claims = projected.renderableClaims;
  const request = { rootActionId: receipt.rootActionId, receipt, narrationInputMode: 'frozenRenderableClaims-vnext-1',
    viewerKey: claims.viewerKey, renderableClaims: claims, narrationContext: freezeNarrationContext(claims, {
      viewer: { characterRef: ACTOR, name: '主角' }, actor: { characterRef: ACTOR, name: '主角' }, actorIntent: '当面商定。',
      scene: { name: '蒸汽廊道', tone: '克制' }, characters: [], establishedDetails: [], recentDialogue: [],
    }) };
  const preparedId = `narration:${receipt.rootActionId}:audience:1:1`;
  s.authority.saveStoryNarrationContext({ preparedActionId: preparedId, audienceId: 'audience:1', generation: 1, request });
  const body = '抄写员答应会在一小时内把副本交给你。';
  const first = stage(s, { state: committed.state, sourceRoot: receipt.rootActionId, preparedId, purpose: 'narration',
    contextHash: claims.projectionHash, request: deepSeekRequestBody(VNEXT_KP_PROFILE.modelId, naturalNarrationModelInput(request, VNEXT_KP_PROFILE.modelId)),
    response: { choices: [{ message: { content: JSON.stringify({ body }) }, finish_reason: 'stop' }] } });
  const second = stage(s, { state: committed.state, sourceRoot: receipt.rootActionId, preparedId, ordinal: 2, purpose: 'narration',
    contextHash: claims.projectionHash, request: deepSeekRequestBody(VNEXT_KP_PROFILE.modelId, narrationReviewModelInput(request, body, VNEXT_KP_PROFILE.modelId)) });
  const archive = await buildAuthoritativeArchive({ roomId: f.state.roomId, signedGenesis: f.genesis, events: committed.events,
    receiptRefs: [receiptReference(committed.receipt, ACTOR)], projectionAudits: [] }, f.runtime.replay);
  return { f, s, committed, first, second, preparedId, context: { archive, storySnapshot: storySnapshot(s, f.state) } };
}

test('narration restores frozen request and generation/review proofs, with zero Delivery rows or published UI output', async () => {
  const { s, f, first, second, context } = await narrationFixture(), bindings = exportStoryArchiveHostBindings(s.authority, context.storySnapshot);
  assert.equal(bindings[0].kind, 'viewerNarration'); assert.equal(validateStoryArchiveHostBinding(bindings[0], context), true);
  const restored = stores();
  restored.storage.transactionSync(() => {
    assert.equal(restored.story.restoreArchiveSnapshot({ source: sourceOf(f.state), snapshot: context.storySnapshot,
      quarantine: { invocationIds: [second.begun.invocationId], sourceBudgetAccountIds: [first.external.source.budgetAccountId] } }).kind, 'restored');
    restoreStoryArchiveHostBindings(restored.authority, bindings, context);
  });
  assert.deepEqual(exportStoryArchiveHostBindings(restored.authority, storySnapshot(restored, f.state)), bindings);
  for (const table of ['authority_delivery_plans', 'authority_delivery_audiences', 'authority_delivery_slots',
    'authority_delivery_acknowledgements', 'authority_experienced_messages', 'authority_submissions']) {
    assert.equal(restored.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  }
  const forged = structuredClone(bindings[0]); forged.payload.narration.request.renderableClaims.claims[0].summary = '凭空篡改结果';
  const { claimsHash: _old, ...core } = forged.payload.narration.request.renderableClaims;
  forged.payload.narration.request.renderableClaims.claimsHash = canonicalHash(core);
  forged.payload.narration.request.narrationContext = freezeNarrationContext(forged.payload.narration.request.renderableClaims,
    forged.payload.narration.request.narrationContext.expression);
  assert.equal(validateStoryArchiveHostBinding(rehash(forged), context), false);
});

test('NPC promise review uses its exact historical evidence frame and verified causal source chain', async () => {
  const f = promiseFixture('story-host-npc'), s = stores();
  const formed = f.runtime.step(f.profiles, f.state, makePromiseInput(f, f.state, { nextStep: null })); assert.equal(formed.kind, 'committed');
  const root = `${f.rootActionId}:statement`, stated = f.runtime.step(f.profiles, formed.state, { kind: 'createSourceClaim', proposalId: root,
    speakerId: NPC, claimId: 'claim:host-completion', semanticContent: '副本已交付完毕。', sourceBasis: '自己的说法。', motive: '希望对方相信。', formedAtFictionMicros: '0' });
  assert.equal(stated.kind, 'committed');
  const due = dueActivityDescriptors(stated.state).find(due => due.promiseReview); assert.ok(due);
  const frame = f.runtime.project(f.profiles, stated.state, { kind: 'kp', capability: 'internal:kp-spatial-evidence' },
    { promiseReviewFor: due.promiseReview.promiseId }).promiseReview;
  const frozen = { preparedActionId: due.childRootActionId, request: frame, dueActivity: due, causeRootActionId: root,
    causeEventId: stated.events.at(-1).eventId, baseEventSeq: stated.state.version };
  s.authority.enqueueDueWork({ causeRootActionId: root, causeEventId: frozen.causeEventId, activity: due });
  s.authority.insertSubmission({ submissionId: `due-submission:${due.childRootActionId}`, principalId: null,
    payloadHash: canonicalHash(due), inputKind: 'dueActivity', rootActionId: due.childRootActionId, preparedActionId: due.childRootActionId,
    characterId: due.ownerEntityId, sceneScope: `scene:${SCENE}`, preparedScopeVersion: 0,
    prepared: { kind: 'prepared', preparedActionId: due.childRootActionId, rootActionId: due.childRootActionId, kpProjection: {}, resolutionMode: 'authorityDirect' },
    continuation: { dueActivity: due, causeRootActionId: root, causeEventId: frozen.causeEventId, actorPlanRequest: frame } });
  s.authority.saveStoryNpcContext(frozen);
  const assembled = assembleProviderInvocation({ providerBody: deepSeekRequestBody(VNEXT_KP_PROFILE.modelId, promiseReviewModelInput(frame)),
    invocationKind: 'initial', ledger: INITIAL_REPAIR_LEDGER, budgetProfile: VNEXT_PROVIDER_BUDGET });
  assert.equal(assembled.kind, 'ready');
  stage(s, { state: stated.state, sourceRoot: root, preparedId: due.childRootActionId, purpose: 'npc', contextHash: canonicalHash(frame),
    bindingHash: PROMISE_REVIEW_BINDING_HASH, request: assembled.providerBody });
  const archive = await buildAuthoritativeArchive({ roomId: f.state.roomId, signedGenesis: f.genesis, events: [...formed.events, ...stated.events],
    receiptRefs: [receiptReference(formed.receipt, ACTOR), receiptReference(stated.receipt, NPC)], projectionAudits: [] }, f.runtime.replay);
  const context = { archive, storySnapshot: storySnapshot(s, f.state) }, bindings = exportStoryArchiveHostBindings(s.authority, context.storySnapshot);
  assert.equal(bindings[0].kind, 'npcDecision'); assert.equal(validateStoryArchiveHostBinding(bindings[0], context), true);
  const restored = stores(); restoreStoryArchiveHostBindings(restored.authority, bindings, context);
  assert.equal(restored.authority.submissionByRoot(due.childRootActionId).result_json, null);
  assert.equal(JSON.parse(restored.authority.submissionByRoot(due.childRootActionId).continuation_json).actorPlanRequest.schema, frame.schema);
  for (const change of [b => { b.payload.npcContext.causeEventId = formed.events.at(-1).eventId; },
    b => { b.payload.npcContext.request.condition = '伪造的新条件'; },
    b => { b.payload.sourceChain[0].descriptor.ownerEntityId = ACTOR; }]) {
    const forged = structuredClone(bindings[0]); change(forged); assert.equal(validateStoryArchiveHostBinding(rehash(forged), context), false);
  }
});

test('frozen context conflicts and a failed outer restore roll back together', async () => {
  const { context } = await narrationFixture(), s = stores();
  const input = { preparedActionId: 'narration:test', audienceId: 'audience:test', generation: 1, request: { text: 'fixture' } };
  s.authority.saveStoryNarrationContext(input); s.authority.saveStoryNarrationContext(structuredClone(input));
  assert.throws(() => s.authority.saveStoryNarrationContext({ ...input, generation: 2 }), /IDENTITY_CONFLICT/);
  assert.throws(() => s.storage.transactionSync(() => {
    s.authority.saveStoryAdmissionInput('prepared:rolled-back', { kind: 'completeActivity', activityId: 'activity:one', proposalId: 'root:one' });
    restoreStoryArchiveHostBindings(s.authority, [{ bindingId: 'forged' }], context);
  }), /HOST_BINDING_INVALID/);
  assert.equal(s.authority.storyAdmissionInput('prepared:rolled-back'), undefined);
});

test('canonical recovery uses real Rules guards and rejects duplicate JSON members', () => {
  const input = { kind: 'completeActivity', activityId: 'activity:one', proposalId: 'root:one' };
  assert.equal(isCanonicalAuthorityRecoveryInput(input), true);
  assert.equal(isCanonicalAuthorityRecoveryInput({ kind: 'resolveWorldInteraction', actorCharacterId: ACTOR, rootActionId: 'root:one', plan: { arbitrary: true } }), false);
  assert.equal(isCanonicalAuthorityRecoveryInput({ kind: 'genericRulesCommand', command: 'declareCanonicalFact' }), false);
  const recovery = { rulesInput: input, answeredPendingInputId: null, receiptExtras: null, forceConcluded: false };
  const row = { prepared_action_id: 'prepared:one', proposal_hash: canonicalHash(input),
    recovery_hash: canonicalHash({ proposalHash: canonicalHash(input), recovery }), recovery_json: JSON.stringify(recovery) };
  assert.equal(canonicalHash(verifiedAuthorityCommitRecovery(row)), canonicalHash(recovery));
  assert.equal(verifiedAuthorityCommitRecovery({ ...row, recovery_json: row.recovery_json.replace('"forceConcluded":false', '"forceConcluded":true,"forceConcluded":false') }), undefined);
});

test('unfinished StoryJob is owned by the actual offer, pinned module and rebuilt world context', async () => {
  const { createHistoryFixture, ACTOR: actor } = await import('./fixtures/story-history.mjs');
  const { authoritativeModuleProfile } = await import('../app/_runtime/lib/module/authoritative.ts');
  const { freezeAdjudicationContext } = await import('../app/_runtime/lib/kp/vnext/context/index.ts');
  const { roomStoryRequest, roomStoryCapabilityDescriptions } = await import('../app/_runtime/lib/room/story-action-request.ts');
  const { buildRoomStoryContext } = await import('../app/_runtime/lib/room/story-context.ts');
  const { roomStoryBudget, ROOM_STORY_TRANSPORT } = await import('../app/_runtime/lib/room/story-runtime-policy.ts');
  const { storyTransportRef } = await import('../app/_runtime/lib/room/story-preparation-host.ts');
  const { OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME } = await import('../app/_runtime/lib/kp/vnext/proposal-schema.ts');
  const f = await createHistoryFixture(), s = stores(), moduleProfile = await authoritativeModuleProfile('black-oak-will');
  const kpProjection = f.runtime.project(f.profiles, f.state, { kind: 'kp', capability: 'internal:kp-spatial-evidence' });
  const npcProjections = Object.fromEntries(Object.values(f.state.entities).filter(e => e.kind === 'npc').map(e => [e.id,
    f.runtime.project(f.profiles, f.state, { kind: 'npc', npcId: e.id, purpose: 'kpDecision', capability: 'internal:npc-limited-knowledge' })]));
  const preparedId = 'prepared:story-host', root = 'root:story-host', submissionId = 'submission:story-host';
  const originalInput = { kind: 'intent', submissionId, text: '追查船夫提到的地方争端。' };
  const frozen = freezeAdjudicationContext({ state: f.state, profiles: f.profiles, kpProjection, npcProjections, moduleProfile,
    replayHead: f.runtime.replay(f.genesis, f.events).head, preparedActionId: preparedId, rootActionId: root, submissionRef: submissionId,
    actorCharacterId: actor, intentText: originalInput.text, focusRefs: [], maxUnits: 48_000 });
  assert.equal(frozen.kind, 'ready');
  s.authority.insertSubmission({ submissionId, principalId: 'principal:history:original', payloadHash: canonicalHash(originalInput), inputKind: 'intent',
    rootActionId: root, preparedActionId: preparedId, characterId: actor, sceneScope: `scene:${f.state.entities[actor].sceneId}`, preparedScopeVersion: 0,
    prepared: { kind: 'prepared', preparedActionId: preparedId, rootActionId: root, requiredContext: frozen.context, kpProjection,
      resolutionMode: 'kpProposal', phase: 'playerIntent' }, continuation: { originalInput } });
  s.authority.saveStoryPreparationModule(preparedId, moduleProfile);
  const request = roomStoryRequest(frozen.context, f.state, { method: 'story.method.local-conflict', scale: 'short', connection: 'local' });
  const built = buildRoomStoryContext({ request, requiredContext: frozen.context, state: f.state, profiles: f.profiles,
    moduleProfile, capabilityDescriptions: roomStoryCapabilityDescriptions(), maxUnits: 32_000 });
  assert.equal(built.kind, 'ready');
  stage(s, { state: f.state, sourceRoot: root, preparedId, contextHash: frozen.context.binding.contextHash,
    request: deepSeekRequestBody(VNEXT_KP_PROFILE.modelId, createVNextProposalOfferModelInput(JSON.stringify({ requiredContext: proposalModelContext(frozen.context) }))),
    response: { choices: [{ message: { tool_calls: [{ type: 'function', function: { name: OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME,
      arguments: JSON.stringify({ requestedCapabilities: ['worldInteraction', 'storyPreparation', 'storyMethodConflict', 'storyShort', 'storyLocal'] }) } }] } }] } });
  const opened = s.story.openJob({ request, context: built.context, modelRef: storyTransportRef(ROOM_STORY_TRANSPORT), budget: roomStoryBudget(request.source),
    stageReservation: { inputTokens: 48_000, outputTokens: 12_000, estimatedCostMicros: 576_000, elapsedMs: 45_000 } });
  assert.equal(opened.kind, 'opened', JSON.stringify(opened));
  const context = { archive: f.archive, storySnapshot: storySnapshot(s, f.state) }, bindings = exportStoryArchiveHostBindings(s.authority, context.storySnapshot);
  assert.equal(bindings.length, 1); assert.deepEqual(bindings[0].jobIds, [request.jobId]);
  assert.equal(validateStoryArchiveHostBinding(bindings[0], context), true);
  const restored = stores(); restoreStoryArchiveHostBindings(restored.authority, bindings, context);
  assert.equal(restored.authority.storyArchiveHostSnapshot().contexts.find(row => row.context_kind === 'preparationModule').prepared_action_id, preparedId);
  const altered = structuredClone(bindings[0]); altered.payload.moduleProfile.storyBible.coreTruth = '换成了另一个世界。';
  assert.equal(validateStoryArchiveHostBinding(rehash(altered), context), false);
  const missing = structuredClone(bindings[0]); missing.jobIds = [];
  assert.throws(() => restoreStoryArchiveHostBindings(stores().authority, [rehash(missing)], context), /HOST_BINDING_INVALID/);
});
