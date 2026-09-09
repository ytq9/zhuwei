import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { AUTHORITATIVE_KP_PROFILE } from '../app/_runtime/lib/kp/authoritative-policy.ts';
import { createJournaledNarrationAdapter } from '../app/_runtime/lib/room/story-narration.ts';
import { storyNpcPendingRequest, storyNpcPendingCanonicalProven, freezeStoryNpcPendingContext } from '../app/_runtime/lib/room/story-npc-pending.ts';
import { exportStoryArchiveHostBindings, validateStoryArchiveHostBinding, restoreStoryArchiveHostBindings } from '../app/_runtime/lib/room/story-archive-host.ts';
import { buildStoryArchive, validateStoryArchive } from '../app/_runtime/lib/room/story-archive.ts';
import { pendingFixture, pendingStores, pendingArchive, pendingSnapshot, sourceOf, beginPending,
  completePending, freezePending, pendingResponse, ACTOR, TARGET } from './fixtures/story-npc-pending.mjs';

const clone = value => structuredClone(value);
const rehash = value => ({ ...value, payloadHash: canonicalHash(value.payload) });
function adapter(f, saved, { outcome = 'completed', answer = { kind: 'decline' } } = {}) {
  let calls = 0, ordinaryCalls = 0;
  const value = createJournaledNarrationAdapter({ profile: AUTHORITATIVE_KP_PROFILE, ai: { async run() { ordinaryCalls++; throw new Error('ordinary bypass'); } } },
    async () => { throw new Error('unexpected narration'); }, async (authority, body) => {
      assert.deepEqual(authority, { preparedActionId: saved.row.prepared_action_id, rootActionId: saved.frozen.request.rootActionId,
        pendingInputId: saved.row.pending_input_id, capability: saved.row.capability });
      assert.deepEqual(body, saved.external.providerRequest);
      assert.equal(JSON.stringify(body).includes(saved.row.capability), false);
      assert.equal(/candidateState|nativePendingInputId|frozenDamageFaces/.test(JSON.stringify(body)), false);
      const begun = beginPending(f, saved);
      if (begun.kind === 'completed') return begun.response;
      if (begun.kind !== 'ready') throw new TypeError('STORY_CALL_UNAVAILABLE');
      calls++;
      const result = outcome === 'completed' ? { kind: 'completed', response: pendingResponse(answer),
        usage: { inputTokens: 10, outputTokens: 10, costMicros: 1 } } : { kind: outcome };
      assert.equal(f.s.journal.complete(saved.external, { ...begun, result }).kind, 'saved');
      if (outcome !== 'completed') throw new TypeError('STORY_CALL_UNAVAILABLE');
      return result.response;
    });
  return { value, counts: () => ({ calls, ordinaryCalls }) };
}
function restore(f, bindings, context) {
  const s = pendingStores();
  const unknown = context.storySnapshot.invocations.filter(call => ['reserved', 'started', 'unknown', 'notSent'].includes(call.invocation.status));
  s.storage.transactionSync(() => {
    assert.equal(s.story.restoreArchiveSnapshot({ source: sourceOf(f.state), snapshot: context.storySnapshot, quarantine: {
      invocationIds: unknown.map(call => call.invocation.invocationId),
      sourceBudgetAccountIds: [...new Set(bindings.map(binding => binding.source.budgetAccountId))],
    } }).kind, 'restored');
    restoreStoryArchiveHostBindings(s.authority, bindings, context);
  });
  return { ...f, s };
}
function answer(f, pending, answerValue) {
  return f.runtime.step(f.profiles, pending.state, { kind: 'answerPendingInput', pendingInputId: pending.pending.pendingInputId,
    responseId: `test-response:${pending.pending.pendingInputId}`, answer: answerValue });
}

test('actual Rules prefix freezes NPC choice, candidate knowledge and the exact executable activity', () => {
  const f = pendingFixture('actual-context');
  assert.equal(storyNpcPendingCanonicalProven(f.saved.frozen, f.pending.state), true);
  assert.equal(f.saved.frozen.request.projection.viewer.subjectId, TARGET);
  const forged = clone(f.saved.row); forged.request_json = JSON.stringify({ pending: f.saved.frozen.request.pending,
    projection: { ...f.saved.frozen.request.projection, controlledCharacter: { hitPoints: { current: 999 } } } });
  assert.throws(() => freezeStoryNpcPendingContext({ state: f.pending.state, profiles: f.profiles,
    baseEventSeq: f.pending.state.version, rootActionId: f.pending.pending.rootActionId, decision: forged }, f.runtime), /CONTEXT_INVALID/);
  assert.throws(() => storyNpcPendingRequest({ state: f.pending.state, profiles: f.profiles,
    preparedActionId: f.saved.row.prepared_action_id, rootActionId: 'root:another',
    pendingInputId: f.saved.row.pending_input_id, capability: f.saved.row.capability }, f.runtime), /CONTEXT_INVALID/);
});

test('adapter routes one physical NPC call through shared journal and reuses completion without ordinary provider calls', async () => {
  const f = pendingFixture('adapter-completed'), run = adapter(f, f.saved);
  const one = await run.value.decidePendingInput(f.saved.frozen.request), after = pendingSnapshot(f.s, f.state);
  assert.deepEqual(await run.value.decidePendingInput(f.saved.frozen.request), one);
  assert.deepEqual(run.counts(), { calls: 1, ordinaryCalls: 0 });
  assert.equal(pendingSnapshot(f.s, f.state).snapshotHash, after.snapshotHash);
  assert.equal(after.invocations.length, 1); assert.equal(after.invocations[0].invocation.purpose, 'npc');
  assert.equal(after.invocations[0].externalBinding.source.sourceId, f.rootActionId);
  const missing = createJournaledNarrationAdapter({ profile: AUTHORITATIVE_KP_PROFILE, ai: { run() { assert.fail('bypass'); } } }, async () => undefined);
  await assert.rejects(missing.decidePendingInput(f.saved.frozen.request), /CONTEXT_INVALID/);
});

test('zero-call pending host restores minimal owner and obeys the archive source quarantine', async () => {
  const f = pendingFixture('zero-call'), context = await pendingArchive(f);
  const bindings = exportStoryArchiveHostBindings(f.s.authority, context.storySnapshot);
  assert.equal(bindings.length, 1); assert.equal(validateStoryArchiveHostBinding(bindings[0], context), true);
  assert.deepEqual(bindings[0].jobIds, []); assert.deepEqual(bindings[0].invocationIds, []);
  const recovered = restore(f, bindings, context), owner = recovered.s.authority.submissionByPrepared(f.saved.row.prepared_action_id);
  assert.equal(owner.status, 'prepared'); assert.equal(bindings[0].payload.owner.status, 'awaitingRandomness');
  assert.equal(recovered.s.authority.randomnessBatch(owner.prepared_action_id), undefined);
  assert.deepEqual(JSON.parse(owner.prepared_json), { kind: 'prepared', preparedActionId: owner.prepared_action_id,
    rootActionId: owner.root_action_id, kpProjection: {}, resolutionMode: 'authorityDirect' });
  assert.equal(JSON.parse(owner.continuation_json).dueActivity.childRootActionId, owner.root_action_id);
  assert.deepEqual(exportStoryArchiveHostBindings(recovered.s.authority, pendingSnapshot(recovered.s, f.state)), bindings);
  const before = pendingSnapshot(recovered.s, f.state), run = adapter(recovered, f.saved);
  await assert.rejects(run.value.decidePendingInput(f.saved.frozen.request));
  assert.deepEqual(run.counts(), { calls: 0, ordinaryCalls: 0 });
  assert.equal(pendingSnapshot(recovered.s, f.state).snapshotHash, before.snapshotHash);
});

for (const saveAnswer of [false, true]) test(`completed pending call restores ${saveAnswer ? 'accepted answer' : 'unconsumed result'} and resumes actual Rules without new dice or calls`, async () => {
  const f = pendingFixture(`complete-${saveAnswer}`), choice = { kind: 'useReaction', abilityRef: 'spell:shield', slotLevel: '1' };
  completePending(f, f.saved, choice, { saveAnswer });
  const context = await pendingArchive(f), bindings = exportStoryArchiveHostBindings(f.s.authority, context.storySnapshot);
  assert.equal(validateStoryArchiveHostBinding(bindings[0], context), true);
  const recovered = restore(f, bindings, context), before = pendingSnapshot(recovered.s, f.state);
  const run = adapter(recovered, f.saved, { answer: choice }), decision = await run.value.decidePendingInput(f.saved.frozen.request);
  assert.deepEqual(run.counts(), { calls: 0, ordinaryCalls: 0 });
  assert.equal(pendingSnapshot(recovered.s, f.state).snapshotHash, before.snapshotHash);
  const row = recovered.s.authority.npcDecision(f.saved.row.prepared_action_id);
  assert.equal(row.answer_json === null, !saveAnswer);
  const actual = answer(f, f.pending, decision.answer), uninterrupted = answer(f, f.pending, choice);
  assert.equal(actual.kind, 'committed', JSON.stringify(actual.rejection)); assert.deepEqual(actual, uninterrupted);
  assert.equal(actual.state.entities[TARGET].hitPoints.current, 20);
  assert.equal(actual.state.combatRuntime.entities[TARGET].resources['spellSlot:1'].current, '1');
  assert.equal(actual.events.some(event => event.eventType === 'RandomnessRequested'), false);
  assert.deepEqual(exportStoryArchiveHostBindings(recovered.s.authority, before), bindings);
});

test('unknown pending call remains quarantined through restore and repeated adapter requests consume nothing', async () => {
  const f = pendingFixture('unknown'), run = adapter(f, f.saved, { outcome: 'unknown' });
  await assert.rejects(run.value.decidePendingInput(f.saved.frozen.request));
  assert.deepEqual(run.counts(), { calls: 1, ordinaryCalls: 0 });
  const context = await pendingArchive(f), bindings = exportStoryArchiveHostBindings(f.s.authority, context.storySnapshot);
  assert.equal(validateStoryArchiveHostBinding(bindings[0], context), true);
  const recovered = restore(f, bindings, context), before = pendingSnapshot(recovered.s, f.state), retried = adapter(recovered, f.saved);
  await assert.rejects(retried.value.decidePendingInput(f.saved.frozen.request));
  await assert.rejects(retried.value.decidePendingInput(f.saved.frozen.request));
  assert.deepEqual(retried.counts(), { calls: 0, ordinaryCalls: 0 });
  assert.equal(pendingSnapshot(recovered.s, f.state).snapshotHash, before.snapshotHash);
});

test('successive pending windows retain earlier answers but restore only current NPC decision with updated private knowledge', async () => {
  const f = pendingFixture('successive', { repeated: true });
  completePending(f, f.saved, { kind: 'decline' });
  const second = answer(f, f.pending, { kind: 'decline' }); assert.equal(second.kind, 'awaitingInput');
  const savedSecond = freezePending(f, second);
  assert.notEqual(savedSecond.row.pending_input_id, f.saved.row.pending_input_id);
  assert.equal(f.saved.frozen.request.projection.controlledCharacter.hitPoints.current, 20);
  assert.equal(savedSecond.frozen.request.projection.controlledCharacter.hitPoints.current, 18);
  completePending(f, savedSecond, { kind: 'useReaction', abilityRef: 'spell:shield', slotLevel: '1' });
  const context = await pendingArchive(f, second.state, [...f.events, ...second.events]);
  const bindings = exportStoryArchiveHostBindings(f.s.authority, context.storySnapshot);
  assert.equal(bindings.length, 2); assert.ok(bindings.every(binding => validateStoryArchiveHostBinding(binding, context)));
  const recovered = restore(f, bindings, context);
  assert.equal(recovered.s.authority.npcDecision(f.saved.row.prepared_action_id).pending_input_id, savedSecond.row.pending_input_id);
  assert.deepEqual(exportStoryArchiveHostBindings(recovered.s.authority, pendingSnapshot(recovered.s, f.state)), bindings);
});

test('native ability selection and filling preserve original model host as audit while restoring a pending-only owner', async () => {
  const f = pendingFixture('original-proposal-owner', { nativeAbility: true });
  assert.equal(f.input.kind, 'applyAtomicWorldInteractionSteps'); assert.equal(f.pending.pending.rootActionId, f.rootActionId);
  assert.equal(storyNpcPendingCanonicalProven(f.saved.frozen, f.pending.state), true);
  const choice = { kind: 'useReaction', abilityRef: 'spell:shield', slotLevel: '1' };
  completePending(f, f.saved, choice);
  const context = await pendingArchive(f), bindings = exportStoryArchiveHostBindings(f.s.authority, context.storySnapshot);
  assert.equal(bindings.length, 2); assert.ok(bindings.every(binding => validateStoryArchiveHostBinding(binding, context)));
  const original = bindings.find(binding => binding.kind === 'preparedAction');
  assert.equal(original.payload.submission.prepared.requiredContext.binding.contextHash, f.requiredContext.binding.contextHash);
  assert.equal(original.invocationIds.length, 2);
  const recovered = restore(f, bindings, context), owner = recovered.s.authority.submissionByPrepared(f.ownerPreparedId);
  assert.equal(owner.status, 'prepared'); assert.equal(owner.continuation_json, null);
  assert.equal(JSON.parse(owner.prepared_json).requiredContext, undefined);
  assert.equal(recovered.s.authority.proposalRecovery(f.ownerPreparedId), undefined);
  assert.deepEqual(exportStoryArchiveHostBindings(recovered.s.authority, pendingSnapshot(recovered.s, f.state)), bindings);
  const before = pendingSnapshot(recovered.s, f.state), run = adapter(recovered, f.saved);
  const decision = await run.value.decidePendingInput(f.saved.frozen.request);
  const done = answer(f, f.pending, decision.answer); assert.equal(done.kind, 'committed', JSON.stringify(done.rejection));
  assert.equal(done.state.combatRuntime.entities[ACTOR].resources['spellSlot:1'].current, '1');
  assert.equal(done.state.combatRuntime.entities[TARGET].resources['spellSlot:1'].current, '1');
  assert.equal(done.state.entities[TARGET].hitPoints.current, 20);
  assert.deepEqual(run.counts(), { calls: 0, ordinaryCalls: 0 });
  assert.equal(pendingSnapshot(recovered.s, f.state).snapshotHash, before.snapshotHash);
  recovered.s.authority.finishSubmission(f.ownerPreparedId, 'committed', f.saved.row.proposal_hash, { kind: 'committed' });
  const after = await pendingArchive(recovered, done.state, [...f.events, ...done.events]);
  const terminal = exportStoryArchiveHostBindings(recovered.s.authority, after.storySnapshot);
  assert.ok(terminal.every(binding => validateStoryArchiveHostBinding(binding, after)));
  const terminalOriginal = terminal.find(binding => binding.kind === 'preparedAction');
  assert.equal(terminalOriginal.payload.submission.status, 'committed'); assert.equal(terminalOriginal.payload.submission.originalInput, null);
});

test('complete story archive envelope validates zero, completed and unknown pending hosts against real ledger snapshots', async () => {
  for (const outcome of ['zero', 'completed', 'unknown']) {
    const f = pendingFixture(`envelope-${outcome}`);
    if (outcome !== 'zero') completePending(f, f.saved, { kind: 'decline' }, { outcome });
    const context = await pendingArchive(f), hostBindings = exportStoryArchiveHostBindings(f.s.authority, context.storySnapshot);
    const ports = { replay: f.runtime.replay, validateHostBinding: validateStoryArchiveHostBinding };
    const built = await buildStoryArchive({ ...context, hostBindings, generation: '1' }, ports);
    assert.equal(built.kind, 'prepared', JSON.stringify(built));
    const verified = await validateStoryArchive(built.envelope, ports);
    assert.equal(verified.kind, 'validated', JSON.stringify(verified));
    assert.deepEqual(verified.quarantine.sourceBudgetAccountIds, [f.saved.external.source.budgetAccountId]);
    assert.equal(verified.quarantine.invocationIds.length, outcome === 'unknown' ? 1 : 0);
    assert.deepEqual(verified.historyMaterials.preparations, []);
  }
});

test('rehashing cannot forge pending knowledge, canonical execution, accepted answer, controller or call ownership', async () => {
  const f = pendingFixture('forgery'); completePending(f, f.saved, { kind: 'decline' });
  const context = await pendingArchive(f), [binding] = exportStoryArchiveHostBindings(f.s.authority, context.storySnapshot);
  assert.equal(validateStoryArchiveHostBinding(binding, context), true);
  for (const mutate of [
    b => { b.payload.pending.request.projection.controlledCharacter.hitPoints.current = 999; },
    b => { b.payload.pending.decision.input_json = JSON.stringify({ input: { ...f.input, activityId: 'activity:forged' } }); },
    b => { b.payload.pending.decision.input_json = JSON.stringify({ input: f.input, forceConcluded: true }); },
    b => { b.payload.pending.decision.input_json = JSON.stringify({ input: f.input, receiptExtras: { secret: 'injected fact' } }); },
    b => { b.payload.pending.decision.input_json = JSON.stringify({ input: { kind: 'endTurn', rootActionId: b.payload.pending.request.rootActionId,
      encounterId: 'encounter:forged', sourceEntityId: ACTOR } }); },
    b => { b.payload.answer = { kind: 'useReaction', abilityRef: 'spell:shield', slotLevel: '1' }; },
    b => { b.payload.owner.principal_id = 'principal:probe-target'; },
    b => { b.payload.owner.character_id = TARGET; },
    b => { b.payload.owner.input_kind = 'intent'; },
    b => { b.payload.owner.prepared = { requiredContext: 'new proposal authority' }; },
    b => { b.source.sourceId = b.payload.pending.request.rootActionId; },
    b => { b.payload.stages[0].ordinal = 2; },
    b => { b.invocationIds = []; },
  ]) {
    const forged = clone(binding); mutate(forged);
    assert.equal(validateStoryArchiveHostBinding(rehash(forged), context), false);
  }
  const badContext = clone(context), badBinding = clone(binding);
  badContext.storySnapshot.invocations[0].invocation.providerRequest.messages[1].content = 'Injected NPC omniscience';
  badBinding.payload.stages[0].requestHash = canonicalHash(badContext.storySnapshot.invocations[0].invocation.providerRequest);
  assert.equal(validateStoryArchiveHostBinding(rehash(badBinding), badContext), false);
});
