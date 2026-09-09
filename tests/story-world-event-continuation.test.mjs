import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyWorldStoryTrigger } from '../app/_runtime/lib/room/story-world-event.ts';
import { freezeWorldStoryHostContext, verifyFrozenWorldStoryHostContext,
  worldStoryHostPreparationInput } from '../app/_runtime/lib/room/story-world-event-host.ts';
import { dueActivityDescriptors } from '../app/_runtime/lib/rules/v2/due-activities.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { buildAuthoritativeArchive } from '../app/_runtime/lib/room/archive.ts';
import { worldStoryFixture } from './fixtures/story-world-event.mjs';
import { pendingStores, pendingSnapshot } from './fixtures/story-npc-pending.mjs';
function seal(f, state = f.state) {
  const copy = structuredClone(state), { eventHeadHash: _head, lastEventId: _event, ...domain } = copy;
  const initialStateHash = canonicalHash(domain); copy.eventHeadHash = initialStateHash;
  const { genesisHash: _genesis, ...body } = { ...f.genesis, moduleRef: f.moduleProfile.moduleRef, initialState: copy, initialStateHash };
  const genesis = { ...body, genesisHash: canonicalHash(body) }, replayed = f.runtime.replay(genesis, []);
  assert.equal(replayed.kind, 'replayed', JSON.stringify(replayed)); return { ...f, genesis, state: replayed.state };
}
const source = f => ({ roomId: f.state.roomId, runtimeEpochId: f.state.runtimeEpochId, branchId: f.state.activeBranchId,
  kind: 'worldEvent', sourceId: 'world-root:original-due', budgetAccountId: `source-budget:${f.state.runtimeEpochId}:world-root:original-due` });
const library = () => ({ jobs: [], entries: [], admissions: [] });
function freeze(f, commit) {
  const result = freezeWorldStoryHostContext({ commit, moduleProfile: f.moduleProfile, library: library(), maxContextUnits: 300_000 }, f.runtime);
  assert.equal(result.kind, 'frozen', JSON.stringify(result)); return result.context;
}
async function archive(f, events, state) {
  const receiptRefs = Object.values(state.receipts).map(receipt => ({ receiptId: receipt.receiptId,
    rootActionId: receipt.rootActionId, actorCharacterId: receipt.subjectCharacterIds[0], status: receipt.status,
    activeBranchId: receipt.branchId, eventRange: { first: receipt.eventRange.fromEventSeq, last: receipt.eventRange.toEventSeq },
    scopeVersions: {}, randomnessCommitmentHash: canonicalHash([]) }));
  return buildAuthoritativeArchive({ roomId: state.roomId, signedGenesis: f.genesis, events, receiptRefs, projectionAudits: [] }, f.runtime.replay);
}
function actorPlanContinuation(kind = 'check') {
  const f = seal(worldStoryFixture()), mechanicalProposal = { ...(kind === 'save'
    ? { operation: 'resolveNoncombatSave', saveAbility: 'wis' }
    : { operation: 'resolveNoncombatCheck', ability: 'wis', skill: 'perception' }),
    dc: 12, mode: 'normal', duration: { unit: 'second', value: 1 }, frozenCosts: [], success: [], failure: [] };
  const input = { ...f.rulesInput, mechanicalProposal }, first = f.runtime.step(f.profiles, f.state, input);
  assert.equal(first.kind, 'awaitingRandomness', JSON.stringify(first));
  const finalInput = { kind: 'fulfillAuthoritativeRandomness', continuation: first.continuation, rolls: [17] };
  const final = f.runtime.step(f.profiles, first.state, finalInput);
  assert.equal(final.kind, 'committed', JSON.stringify(final));
  const origin = { baseEventSeq: f.state.version, throughEventSeq: first.state.version, rulesInput: input };
  const commit = { beforeState: first.state, due: f.due, rulesInput: finalInput, committedEvents: final.events,
    afterState: final.state, profiles: f.profiles, budgetSource: source(f) };
  const continuationProof = { origin, signedGenesis: f.genesis, events: first.events };
  return { f, first, final, commit, continuationProof, events: [...first.events, ...final.events] };
}

test('a real NPC check/save which completed its Activity before randomness retains its proven original due source', async () => {
  for (const kind of ['check', 'save']) {
    const { f, first, final, commit, continuationProof, events } = actorPlanContinuation(kind), s = pendingStores();
    try {
      assert.equal(dueActivityDescriptors(first.state).length, 0, 'ActorPlan lifecycle committed before dice were requested');
      assert.equal(verifyWorldStoryTrigger(commit, f.runtime).kind, 'blocked');
      assert.equal(verifyWorldStoryTrigger({ ...commit, continuationProof }, { step: f.runtime.step }).kind, 'blocked', 'a rehash is not replay evidence');
      const result = verifyWorldStoryTrigger({ ...commit, continuationProof }, f.runtime);
      assert.equal(result.kind, 'verified', JSON.stringify(result));
      assert.deepEqual(result.dueOrigin, continuationProof.origin);
      assert.deepEqual(result.trigger.events, events, 'selection receives the real initial trace and settled dice together');
      const frozen = freeze(f, { ...commit, continuationProof });
      assert.deepEqual(frozen.dueOrigin, continuationProof.origin);
      const context = { archive: await archive(f, events, final.state), storySnapshot: pendingSnapshot(s, final.state) };
      assert.equal(verifyFrozenWorldStoryHostContext(JSON.parse(JSON.stringify(frozen)), context, f.runtime).kind, 'verified');
      const prepared = worldStoryHostPreparationInput(frozen, { kind: 'prepareStory', reason: '真实核查完成，可以发展局势。',
        selection: { method: 'story.method.archive-investigation', scale: 'short', connection: 'local' } }, final.state, f.profiles);
      assert.equal(prepared.kind, 'ready', JSON.stringify(prepared));
      for (const edit of [
        proof => { proof.origin.baseEventSeq = proof.origin.throughEventSeq; },
        proof => { proof.origin.rulesInput.mechanicalProposal.dc = 13; },
        proof => { proof.origin.rulesInput.planId = 'plan:forged'; },
        proof => { proof.events.splice(1, 1); },
        proof => { proof.events[0].payload.forged = '假的起因'; },
      ]) {
        const forged = structuredClone(continuationProof); edit(forged);
        assert.equal(verifyWorldStoryTrigger({ ...commit, continuationProof: forged }, f.runtime).kind, 'blocked');
      }
      const forged = structuredClone(frozen); forged.dueOrigin.rulesInput.mechanicalProposal.mode = 'advantage';
      const { contextHash: _hash, ...body } = forged; forged.contextHash = canonicalHash(body);
      assert.equal(verifyFrozenWorldStoryHostContext(forged, context, f.runtime).kind, 'blocked');
    } finally { s.db.close(); }
  }
});
