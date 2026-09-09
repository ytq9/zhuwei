import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { authoritativeModuleProfile } from '../app/_runtime/lib/module/authoritative.ts';
import { hashWorldState } from '../app/_runtime/lib/rules/v2/validation.ts';
import { dueActivityDescriptors } from '../app/_runtime/lib/rules/v2/due-activities.ts';
import { freezeWorldStoryHostContext, worldStoryHostInvocationBinding, worldStoryHostPreparationInput } from '../app/_runtime/lib/room/story-world-event-host.ts';
import { WORLD_STORY_SELECTION_BINDING_HASH, WORLD_STORY_SELECTION_TOOL_NAME } from '../app/_runtime/lib/room/story-world-event.ts';
import { ROOM_STORY_TRANSPORT } from '../app/_runtime/lib/room/story-runtime-policy.ts';
import { storyTransportRef } from '../app/_runtime/lib/room/story-preparation-host.ts';
import { buildAuthoritativeArchive } from '../app/_runtime/lib/room/archive.ts';
import { buildStoryArchive, validateStoryArchive } from '../app/_runtime/lib/room/story-archive.ts';
import { exportStoryArchiveHostBindings, validateStoryArchiveHostBinding, restoreStoryArchiveHostBindings,
  readStoryArchiveAdmissionRulesInput } from '../app/_runtime/lib/room/story-archive-host.ts';
import { pendingStores, pendingSnapshot, sourceOf } from './fixtures/story-npc-pending.mjs';
import { worldStoryFixture, WORLD_PLAN, WORLD_TRACE } from './fixtures/story-world-event.mjs';
import { ACTOR, ARCHIVIST } from './fixtures/story-context.mjs';

const clone = structuredClone;
const selection = { kind: 'prepareStory', reason: '已执行的异地核对留下了可追查的矛盾。',
  selection: { method: 'story.method.archive-investigation', scale: 'short', connection: 'local' } };
const response = decision => ({ choices: [{ message: { tool_calls: [{ type: 'function',
  function: { name: WORLD_STORY_SELECTION_TOOL_NAME, arguments: JSON.stringify({ decision }) } }] } }] });

/** The baseline has an explicitly seeded NPC plan; its cause, due commit,
 * trace and archive prefixes are produced by actual public Rules commands. */
async function fixture(outcome, { faction = false } = {}) {
  const f = worldStoryFixture({ faction }), s = pendingStores();
  const moduleProfile = await authoritativeModuleProfile('black-oak-will');
  const initialState = clone(f.state);
  initialState.campaignRuntime.campaign.moduleRef = clone(moduleProfile.moduleRef);
  for (const chapter of Object.values(initialState.campaignRuntime.chapters)) chapter.moduleRef = clone(moduleProfile.moduleRef);
  const initialStateHash = hashWorldState(initialState); initialState.eventHeadHash = initialStateHash;
  const { genesisHash: _old, ...unsigned } = { ...f.genesis, moduleRef: clone(moduleProfile.moduleRef), initialState, initialStateHash };
  const genesis = { ...unsigned, genesisHash: canonicalHash(unsigned) };
  const before = f.runtime.replay(genesis, []); assert.equal(before.kind, 'replayed', JSON.stringify(before));
  const cause = f.runtime.step(f.profiles, before.state, { kind: 'resolveFreeAction', proposalId: 'root:story:world-cause', characterId: ACTOR,
    goal: '整理手边登记', method: '按原有记录整理', feasibility: { kind: 'directSuccess', publicBasis: '纸笔和记录就在手边。' },
    outcome: { fictionTimeCostMicros: '0' } });
  assert.equal(cause.kind, 'committed', JSON.stringify(cause));
  const due = dueActivityDescriptors(cause.state).find(value => value.actorPlan?.planId === WORLD_PLAN); assert.ok(due);
  s.authority.enqueueDueWork({ causeRootActionId: cause.receipt.rootActionId, causeEventId: cause.events.at(-1).eventId, activity: due });
  const result = f.resolve(cause.state); s.authority.finishDueWork(due.childRootActionId, 'committed');
  const events = [...cause.events, ...result.events], replayed = f.runtime.replay(genesis, events);
  assert.equal(replayed.kind, 'replayed', JSON.stringify(replayed)); assert.deepEqual(replayed.state, result.state);
  const frozen = freezeWorldStoryHostContext({ commit: { ...f.commitInput(result, cause.state), due }, moduleProfile,
    library: { entries: [], jobs: [], admissions: [] }, maxContextUnits: 48_000 }, f.runtime);
  assert.equal(frozen.kind, 'frozen', JSON.stringify(frozen));
  const world = frozen.context, state = result.state, external = worldStoryHostInvocationBinding(world, state, f.profiles);
  s.authority.saveStoryWorldContext(world);
  assert.notEqual(s.story.openBudget({ source: external.source, budget: external.budget }).kind, 'rejected');
  let begun;
  if (outcome !== 'zero') {
    begun = s.storage.transactionSync(() => {
      const value = s.journal.begin(external); assert.equal(value.kind, 'ready', JSON.stringify(value));
      s.authority.saveVnextInvocationProof({ prepared_action_id: world.preparedActionId, ordinal: 1,
        context_hash: world.contextHash, binding_hash: WORLD_STORY_SELECTION_BINDING_HASH,
        request_hash: canonicalHash(external.providerRequest), repair_ticket_json: null,
        invocation_id: value.invocationId, external_binding_json: JSON.stringify(external) }); return value;
    });
    const decision = outcome === 'job' ? selection : { kind: 'noStory', reason: '这次异地事务已完成，暂时无需扩展。' };
    assert.equal(s.journal.complete(external, { ...begun, result: outcome === 'unknown' ? { kind: 'unknown' }
      : { kind: 'completed', response: response(decision), usage: { inputTokens: 20, outputTokens: 20, costMicros: 1 } } }).kind, 'saved');
    if (outcome === 'job') {
      const input = worldStoryHostPreparationInput(world, selection, state, f.profiles); assert.equal(input.kind, 'ready', JSON.stringify(input));
      assert.equal(s.story.openJob({ request: input.request, context: input.context, budget: input.budget,
        modelRef: storyTransportRef(ROOM_STORY_TRANSPORT), stageReservation: { inputTokens: ROOM_STORY_TRANSPORT.maxInputTokens,
          outputTokens: ROOM_STORY_TRANSPORT.maxOutputTokens, elapsedMs: ROOM_STORY_TRANSPORT.timeoutMs,
          estimatedCostMicros: ROOM_STORY_TRANSPORT.maxInputTokens * 8 + ROOM_STORY_TRANSPORT.maxOutputTokens * 16 } }).kind, 'opened');
    }
    if (outcome === 'completed') s.authority.saveStoryWorldOutcome(world.preparedActionId, { kind: 'noStory', cache: 'WORLD_OUTCOME_CACHE_CANARY' });
  }
  const receiptRefs = [cause, result].map(value => ({ receiptId: value.receipt.receiptId, rootActionId: value.receipt.rootActionId,
    actorCharacterId: value === cause ? ACTOR : ARCHIVIST, status: value.receipt.status, activeBranchId: value.receipt.branchId,
    eventRange: { first: value.receipt.eventRange.fromEventSeq, last: value.receipt.eventRange.toEventSeq },
    scopeVersions: {}, randomnessCommitmentHash: canonicalHash([]) }));
  const archive = await buildAuthoritativeArchive({ roomId: state.roomId, signedGenesis: genesis, events, receiptRefs, projectionAudits: [] }, f.runtime.replay);
  const context = { archive, storySnapshot: pendingSnapshot(s, state) }, bindings = exportStoryArchiveHostBindings(s.authority, context.storySnapshot);
  return { ...f, s, state, world, result, cause, external, begun, context, bindings,
    ports: { replay: f.runtime.replay, validateHostBinding: validateStoryArchiveHostBinding, readAdmissionRulesInput: readStoryArchiveAdmissionRulesInput } };
}

for (const outcome of ['zero', 'completed', 'unknown', 'job']) test(`world ${outcome}: full private envelope restores its source chain and journal without publishing or redispatching`, async () => {
  const f = await fixture(outcome, { faction: outcome === 'completed' });
  assert.equal(f.bindings.length, 1); assert.equal(f.bindings[0].payload.format, 'zhuwei.story-world-event-host/v1');
  assert.equal(f.bindings[0].payload.sourceChain.length, 1);
  assert.equal(f.bindings[0].payload.sourceChain[0].cause_event_id, f.cause.events.at(-1).eventId);
  assert.equal(f.bindings[0].jobIds.length, outcome === 'job' ? 1 : 0);
  assert.equal(f.s.authority.storyArchiveHostSnapshot().submissions.length, 0, 'world creation does not invent an intent submission');
  assert.ok(f.state.canonicalFacts[WORLD_TRACE]);
  assert.equal(validateStoryArchiveHostBinding(f.bindings[0], f.context), true);
  const built = await buildStoryArchive({ ...f.context, hostBindings: f.bindings, generation: '1' }, f.ports);
  assert.equal(built.kind, 'prepared', JSON.stringify(built));
  const checked = await validateStoryArchive(built.envelope, f.ports); assert.equal(checked.kind, 'validated', JSON.stringify(checked));
  assert.doesNotMatch(JSON.stringify(checked.envelope), /WORLD_OUTCOME_CACHE_CANARY/);
  const restored = pendingStores();
  restored.storage.transactionSync(() => {
    assert.equal(restored.story.restoreArchiveSnapshot({ source: sourceOf(f.state), snapshot: f.context.storySnapshot, quarantine: checked.quarantine }).kind, 'restored');
    restoreStoryArchiveHostBindings(restored.authority, f.bindings, f.context);
  });
  assert.equal(canonicalHash(restored.authority.storyWorldContext(f.world.preparedActionId)), canonicalHash(f.world));
  assert.equal(canonicalHash(restored.authority.pendingStoryWorldContexts()), canonicalHash([f.world]));
  assert.deepEqual(exportStoryArchiveHostBindings(restored.authority, pendingSnapshot(restored, f.state)), f.bindings);
  const snapshot = pendingSnapshot(restored, f.state), retry = restored.journal.begin(f.external);
  assert.equal(retry.kind, ['completed', 'job'].includes(outcome)
    ? 'completed' : outcome === 'unknown' ? 'waiting' : 'rejected');
  assert.equal(pendingSnapshot(restored, f.state).snapshotHash, snapshot.snapshotHash);
  assert.equal(restored.authority.npcDecision(f.world.preparedActionId), undefined);
  for (const table of ['authority_delivery_plans', 'authority_delivery_slots', 'authority_experienced_messages', 'authority_submissions']) {
    assert.equal(restored.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  }
});

test('rehashed world context cannot erase due-work causality, take another source budget or alter the completed Rules decision', async () => {
  const f = await fixture('job');
  for (const mutate of [
    value => { value.payload.sourceChain = []; },
    value => { value.payload.sourceChain[0].cause_event_id = f.result.events.at(-1).eventId; },
    value => { value.source.sourceId = 'root:unrelated'; },
    value => { value.payload.world.rulesInput.decision = 'cancel'; value.payload.world.rulesInput.reason = '伪造取消'; },
    value => { value.jobIds = []; },
    value => { value.payload.stages[0].contextHash = canonicalHash('ordinary NPC projection'); },
  ]) {
    const forged = clone(f.bindings[0]); mutate(forged);
    const { contextHash: _context, ...world } = forged.payload.world;
    forged.payload.world.contextHash = canonicalHash(world); forged.payloadHash = canonicalHash(forged.payload);
    assert.equal(validateStoryArchiveHostBinding(forged, f.context), false);
  }
});
