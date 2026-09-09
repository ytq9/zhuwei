import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyWorldStoryTrigger } from '../app/_runtime/lib/room/story-world-event.ts';
import { freezeWorldStoryHostContext, verifyFrozenWorldStoryHostContext } from '../app/_runtime/lib/room/story-world-event-host.ts';
import { dueActivityDescriptors } from '../app/_runtime/lib/rules/v2/due-activities.ts';
import { authorityRevisionOrHash } from '../app/_runtime/lib/rules/v2/authority-bindings.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { buildAuthoritativeArchive } from '../app/_runtime/lib/room/archive.ts';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as PLAYER,
  PROBE_TARGET as TARGET, PROBE_SOURCE as SOURCE, PROBE_ZONE as ZONE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { pendingStores, pendingSnapshot } from './fixtures/story-npc-pending.mjs';
import { hazardBundle } from './fixtures/vnext-authored-bundles.mjs';

const NPC = 'npc:world-activity-worker';
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
function preauthoredNpcInput(f, body) {
  // This fixture tests Rules Activity/reaction settlement, not NPC model
  // authoring. Use lowering only as a structural recipe for the initial Rules
  // command, then bind its typed actor and reads to the actual NPC before the
  // first step. No player context is sent to an NPC or an external provider.
  const context = freezeAuthoredProbeContext({ ...f, actorCharacterId: PLAYER }, f.state,
    { focusRefs: [SOURCE, ZONE, TARGET], rootActionId: f.rootActionId }).context;
  const lowered = lowerVNext2ProposalBundle({ state: f.state, profiles: f.profiles, actorCharacterId: PLAYER,
    rootActionId: f.rootActionId, requiredContext: context, value: body });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  const contextHash = canonicalHash({ fixture: 'preauthored-npc-world-activity', rootActionId: f.rootActionId,
    actorCharacterId: NPC, state: f.state });
  const actorRef = ref => ref === PLAYER ? NPC : ref === `character-timeline:${PLAYER}` ? `character-timeline:${NPC}` : ref;
  const bind = value => {
    if (Array.isArray(value)) return value.map(bind);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
      key === 'actorCharacterId' ? NPC : key === 'contextHash' ? contextHash : key === 'readSet'
        ? child.map(entry => {
          const ref = actorRef(entry.ref), revisionOrHash = authorityRevisionOrHash(f.state, ref);
          assert.ok(revisionOrHash, ref); return { ref, revisionOrHash };
        }).sort((a, b) => a.ref.localeCompare(b.ref)) : bind(child)]));
  };
  return bind(lowered.command.rulesInput);
}
function npcActivity({ hazard = false } = {}) {
  let f = createAuthoredProbeFixture(`world-npc-activity:${hazard}`, { npcCharacters: [{ id: NPC, name: '检修员' }] });
  const state = structuredClone(f.state);
  // TARGET is a Rules NPC from the test genesis onward. The worker itself was
  // initialized as an NPC; no completed or pending Activity is relabelled.
  state.entities[TARGET].kind = 'npc'; delete state.entities[TARGET].experiencePoints; delete state.characterControls[TARGET];
  state.combatRuntime.entities[TARGET].kind = 'npc';
  const registered = f.runtime.step(f.profiles, state, { kind: 'registerDynamicDefinition', proposalId: 'root:world-shield-definition', definition: {
    definitionId: 'spell:shield', definitionKind: 'ability', revision: '1', rulesBasis: 'srd5.1-2014', mechanicalKey: 'shield',
    activation: { kind: 'reactionSpell', spellLevel: '1' }, costs: [{ kind: 'spellSlot', level: '1', amount: '1' }],
    effect: { kind: 'shield', duration: 'untilOwnNextTurnStart', armorClassBonus: '5', magicMissileImmunity: true },
  } });
  assert.equal(registered.kind, 'committed');
  state.combatRuntime.definitions['spell:shield'] = registered.state.combatRuntime.definitions['spell:shield'];
  state.campaignRuntime.definitions['spell:shield'] = registered.state.campaignRuntime.definitions['spell:shield'];
  state.combatRuntime.entities[TARGET].abilityRefs.push('spell:shield');
  state.combatRuntime.entities[TARGET].resources['spellSlot:1'] = { current: '2', maximum: '2' };
  state.entities[TARGET].resources.slot1 = 2; state.entities[TARGET].resourceMaximums.slot1 = 2;
  f = seal({ ...f, actorCharacterId: NPC }, state);
  const body = hazardBundle();
  if (hazard) Object.assign(body.proposals[0].source.content, { save: null, attack: { kind: 'fixed', bonus: '2' },
    damage: [{ type: 'force', formula: '1d4', sharedAcrossTargets: false }], effects: [] });
  else {
    body.proposals = [body.proposals[2]];
    body.proposals[0].consumes = []; body.proposals[0].branches.success.effects = [];
  }
  const started = f.runtime.step(f.profiles, f.state, preauthoredNpcInput(f, body));
  assert.equal(started.kind, 'committed', JSON.stringify(started));
  assert.equal(started.events[0].eventType, 'ActivityStarted');
  assert.equal(dueActivityDescriptors(started.state).some(due => due.ownerEntityId === NPC), false, 'NPC work does not advance its own time');
  const rest = f.runtime.step(f.profiles, started.state, { kind: 'startRest', proposalId: 'root:world-player-waits', characterId: PLAYER, restKind: 'long' });
  assert.equal(rest.kind, 'committed', JSON.stringify(rest));
  const advance = dueActivityDescriptors(rest.state).find(due => due.ownerEntityId === PLAYER && due.activityProgress?.phase === 'advance');
  assert.ok(advance);
  const elapsed = f.runtime.step(f.profiles, rest.state, { kind: 'advanceActivity', proposalId: advance.childRootActionId, activityId: advance.activityId });
  assert.equal(elapsed.kind, 'committed', JSON.stringify(elapsed));
  const due = dueActivityDescriptors(elapsed.state).find(due => due.ownerEntityId === NPC && due.activityProgress?.phase === 'complete');
  assert.ok(due);
  const input = { kind: 'completeActionActivity', proposalId: due.childRootActionId, activityId: due.activityId };
  const first = f.runtime.step(f.profiles, elapsed.state, input);
  return { f, due, input, first, before: elapsed.state, events: [...started.events, ...rest.events, ...elapsed.events, ...first.events] };
}

test('ordinary NPC Activity completion uses its exact due descriptor and ignores an unused continuation hint', async () => {
  const { f, due, input, first, before, events } = npcActivity(), s = pendingStores();
  try {
    assert.equal(first.kind, 'committed', JSON.stringify(first));
    const commit = { beforeState: before, due, rulesInput: input, committedEvents: first.events,
      afterState: first.state, profiles: f.profiles, budgetSource: source(f), continuationProof: { origin: {} } };
    const result = verifyWorldStoryTrigger(commit, f.runtime);
    assert.equal(result.kind, 'verified', JSON.stringify(result)); assert.equal(result.dueOrigin, null);
    assert.equal(result.trigger.actorRef, NPC); assert.deepEqual(result.trigger.source, commit.budgetSource);
    const frozen = freeze(f, commit); assert.equal(frozen.dueOrigin, null);
    const context = { archive: await archive(f, events, first.state), storySnapshot: pendingSnapshot(s, first.state) };
    assert.equal(verifyFrozenWorldStoryHostContext(frozen, context, f.runtime).kind, 'verified');
  } finally { s.db.close(); }
});

test('real NPC Activity dice and Shield windows keep their source and trigger only after the final reaction settles', async () => {
  const { f, due, input, first, before, events } = npcActivity({ hazard: true }), s = pendingStores();
  try {
    assert.equal(first.kind, 'awaitingRandomness', JSON.stringify(first));
    const rootSource = source(f), base = { due, profiles: f.profiles, budgetSource: rootSource };
    assert.equal(verifyWorldStoryTrigger({ ...base, beforeState: before, rulesInput: input,
      committedEvents: first.events, afterState: first.state }, f.runtime).kind, 'notApplicable');
    const rolls = first.randomnessRequest.hazardRolls.flatMap(spec => spec.dice.flatMap(die =>
      Array(Number(die.count)).fill(spec.purposeKey.includes(':attack:') ? 10 : 2)));
    const rolledInput = { kind: 'fulfillAuthoritativeRandomness', continuation: first.continuation, rolls };
    const pending = f.runtime.step(f.profiles, first.state, rolledInput);
    assert.equal(pending.kind, 'awaitingInput', JSON.stringify(pending)); assert.equal(pending.pending.kind, 'kpDecision');
    assert.equal(verifyWorldStoryTrigger({ ...base, beforeState: first.state, rulesInput: rolledInput,
      committedEvents: pending.events, afterState: pending.state }, f.runtime).kind, 'notApplicable');
    assert.ok(dueActivityDescriptors(pending.state).some(candidate => canonicalHash(candidate) === canonicalHash(due)));
    const finalInput = { kind: 'answerPendingInput', pendingInputId: pending.pending.pendingInputId,
      responseId: 'response:world-shield', answer: { kind: 'useReaction', abilityRef: 'spell:shield', slotLevel: '1' } };
    const done = f.runtime.step(f.profiles, pending.state, finalInput);
    assert.equal(done.kind, 'committed', JSON.stringify(done));
    const commit = { ...base, beforeState: pending.state, rulesInput: finalInput, committedEvents: done.events, afterState: done.state };
    const verified = verifyWorldStoryTrigger(commit, f.runtime);
    assert.equal(verified.kind, 'verified', JSON.stringify(verified)); assert.equal(verified.dueOrigin, null);
    assert.equal(verified.trigger.actorRef, NPC); assert.deepEqual(verified.trigger.source, rootSource);
    assert.equal(done.state.combatRuntime.entities[TARGET].resources['spellSlot:1'].current, '1');
    const frozen = freeze(f, commit), context = { archive: await archive(f, [...events, ...pending.events, ...done.events], done.state),
      storySnapshot: pendingSnapshot(s, done.state) };
    assert.equal(verifyFrozenWorldStoryHostContext(frozen, context, f.runtime).kind, 'verified');
    const unrelated = { ...commit, due: { ...due, childRootActionId: 'root:unrelated-due' } };
    assert.equal(verifyWorldStoryTrigger(unrelated, f.runtime).kind, 'blocked');
  } finally { s.db.close(); }
});
