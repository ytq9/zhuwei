import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { AuthoritativeRoomStore } from '../../app/_runtime/lib/room/authority-store.ts';
import { StoryCreationStore } from '../../app/_runtime/lib/room/story-creation-store.ts';
import { createStoryExternalInvocationJournal } from '../../app/_runtime/lib/room/story-external-invocation-journal.ts';
import { storyNpcPendingRequest, storyNpcPendingProviderRequest, freezeStoryNpcPendingContext,
  STORY_NPC_PENDING_BINDING_HASH } from '../../app/_runtime/lib/room/story-npc-pending.ts';
import { roomModelInvocationBinding } from '../../app/_runtime/lib/room/story-runtime-policy.ts';
import { canonicalHash } from '../../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { VNEXT_KP_PROFILE } from '../../app/_runtime/lib/kp/vnext/runtime-policy.ts';
import { NPC_PENDING_DECISION_TOOL_NAME } from '../../app/_runtime/lib/kp/pending-decision-policy.ts';
import { buildAuthoritativeArchive } from '../../app/_runtime/lib/room/archive.ts';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext,
  PROBE_ACTOR as ACTOR, PROBE_TARGET as TARGET } from '../../tools/lib/vnext-authored-probe-fixture.mjs';
import { lowerVNext2ProposalBundle } from '../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { dueActivityDescriptors } from '../../app/_runtime/lib/rules/v2/due-activities.ts';
import { hazardBundle } from './vnext-authored-bundles.mjs';
import { stepActionToDecision } from './vnext-action-lifecycle.mjs';

export { ACTOR, TARGET };
export const sourceOf = state => ({ roomId: state.roomId, runtimeEpochId: state.runtimeEpochId });
export function pendingStores() {
  const db = new DatabaseSync(':memory:'); let tx = 0, id = 0;
  const storage = { sql: { exec(query, ...args) {
    let rows;
    if (args.length === 0 && /^(CREATE|ALTER|DELETE)\b/u.test(query.trim())) { db.exec(query); rows = []; }
    else rows = db.prepare(query).all(...args).map(row => ({ ...row }));
    return { toArray: () => rows, one: () => { assert.equal(rows.length, 1); return rows[0]; },
      [Symbol.iterator]: function* () { yield* rows; } };
  } }, transactionSync(callback) {
    const name = `pending_test_${++tx}`; db.exec(`SAVEPOINT ${name}`);
    try { const result = callback(); db.exec(`RELEASE ${name}`); return result; }
    catch (error) { db.exec(`ROLLBACK TO ${name}`); db.exec(`RELEASE ${name}`); throw error; }
  } };
  const authority = new AuthoritativeRoomStore(storage), story = new StoryCreationStore(storage, {
    hash: canonicalHash, now: () => 1000, newId: () => `invocation:${++id}`,
  });
  authority.ensureSchema(); story.ensureSchema();
  return { db, storage, authority, story, journal: createStoryExternalInvocationJournal(story) };
}
export function pendingSnapshot(s, state) {
  const captured = s.story.archiveSnapshot(sourceOf(state));
  assert.equal(captured.kind, 'available', JSON.stringify(captured)); return captured.snapshot;
}
export const pendingResponse = answer => ({ choices: [{ message: { role: 'assistant', content: null,
  tool_calls: [{ id: 'npc-answer:1', type: 'function', function: { name: NPC_PENDING_DECISION_TOOL_NAME,
    arguments: JSON.stringify({ answer }) } }] }, finish_reason: 'tool_calls' }] });

export function freezePending(f, pending) {
  const root = pending.pending.rootActionId;
  const request = storyNpcPendingRequest({ state: pending.state, profiles: f.profiles, preparedActionId: root,
    rootActionId: root, pendingInputId: pending.pending.pendingInputId, capability: `capability:${pending.pending.pendingInputId}` }, f.runtime);
  const row = { prepared_action_id: root, capability: request.capability, pending_input_id: request.pending.pendingInputId,
    proposal_hash: canonicalHash(f.input), wave_index: 0, input_json: JSON.stringify({ input: f.input }),
    request_json: JSON.stringify({ pending: request.pending, projection: request.projection }), answer_json: null };
  const frozen = freezeStoryNpcPendingContext({ state: pending.state, profiles: f.profiles,
    baseEventSeq: pending.state.version, rootActionId: root, decision: row }, f.runtime);
  f.s.authority.saveNpcDecision(row); f.s.authority.saveStoryNpcPendingContext(frozen);
  const external = roomModelInvocationBinding(pending.state, f.rootActionId, `npc:${frozen.preparedActionId}:1`, 'npc',
    storyNpcPendingProviderRequest(request, VNEXT_KP_PROFILE.modelId));
  assert.notEqual(f.s.story.openBudget({ source: external.source, budget: external.budget }).kind, 'rejected');
  return { frozen, external, row };
}
export function beginPending(f, saved) {
  return f.s.storage.transactionSync(() => {
    const begun = f.s.journal.begin(saved.external);
    if (begun.kind === 'ready') f.s.authority.saveVnextInvocationProof({ prepared_action_id: saved.frozen.preparedActionId,
      ordinal: 1, context_hash: canonicalHash(saved.frozen.request), binding_hash: STORY_NPC_PENDING_BINDING_HASH,
      request_hash: canonicalHash(saved.external.providerRequest), repair_ticket_json: null,
      invocation_id: begun.invocationId, external_binding_json: JSON.stringify(saved.external) });
    return begun;
  });
}
export function completePending(f, saved, answer, { saveAnswer = true, outcome = 'completed' } = {}) {
  const begun = beginPending(f, saved); assert.equal(begun.kind, 'ready', JSON.stringify(begun));
  const result = outcome === 'completed' ? { kind: 'completed', response: pendingResponse(answer),
    usage: { inputTokens: 10, outputTokens: 10, costMicros: 1 } } : { kind: outcome };
  assert.equal(f.s.journal.complete(saved.external, { ...begun, result }).kind, 'saved');
  if (saveAnswer && outcome === 'completed') f.s.authority.answerNpcDecision(saved.row.prepared_action_id, saved.row.capability, answer);
  return begun;
}
export async function pendingArchive(f, state = f.pending.state, events = f.events) {
  const receiptRefs = Object.values(state.receipts).map(receipt => ({ receiptId: receipt.receiptId,
    rootActionId: receipt.rootActionId, actorCharacterId: ACTOR, status: receipt.status, activeBranchId: receipt.branchId,
    eventRange: receipt.eventRange === null ? null : { first: receipt.eventRange.fromEventSeq, last: receipt.eventRange.toEventSeq },
    scopeVersions: {}, randomnessCommitmentHash: canonicalHash([]) }));
  const archive = await buildAuthoritativeArchive({ roomId: state.roomId, signedGenesis: f.genesis,
    events, receiptRefs, projectionAudits: [] }, f.runtime.replay);
  return { archive, storySnapshot: pendingSnapshot(f.s, state) };
}

/** Real public Rules chain: authored bundle -> duration Activity -> completion
 * -> recorded random faces -> NPC Shield. No fabricated pending state. */
export function pendingFixture(name, { repeated = false } = {}) {
  const f = createAuthoredProbeFixture(`story-pending:${name}`), state = structuredClone(f.state);
  state.entities[TARGET].kind = 'npc'; delete state.entities[TARGET].experiencePoints;
  state.combatRuntime.entities[TARGET].kind = 'npc'; delete state.characterControls[TARGET];
  const registered = f.runtime.step(f.profiles, state, { kind: 'registerDynamicDefinition', proposalId: 'root:shield-definition', definition: {
    definitionId: 'spell:shield', definitionKind: 'ability', revision: '1', rulesBasis: 'srd5.1-2014', mechanicalKey: 'shield',
    activation: { kind: 'reactionSpell', spellLevel: '1' }, costs: [{ kind: 'spellSlot', level: '1', amount: '1' }],
    effect: { kind: 'shield', duration: 'untilOwnNextTurnStart', armorClassBonus: '5', magicMissileImmunity: true },
  } });
  assert.equal(registered.kind, 'committed');
  state.combatRuntime.definitions['spell:shield'] = registered.state.combatRuntime.definitions['spell:shield'];
  state.campaignRuntime.definitions['spell:shield'] = registered.state.campaignRuntime.definitions['spell:shield'];
  state.combatRuntime.entities[TARGET].abilityRefs.push('spell:shield');
  state.combatRuntime.entities[TARGET].resources['spellSlot:1'] = { current: '2', maximum: '2' };
  state.entities[TARGET].resources['spellSlot:1'] = 2; state.entities[TARGET].resourceMaximums['spellSlot:1'] = 2;
  const { eventHeadHash: _head, lastEventId: _event, ...domain } = state, initialStateHash = canonicalHash(domain);
  state.eventHeadHash = initialStateHash;
  const { genesisHash: _genesis, ...unsigned } = { ...f.genesis, initialState: state, initialStateHash };
  f.genesis = { ...unsigned, genesisHash: canonicalHash(unsigned) };
  const rebuilt = f.runtime.replay(f.genesis, []); assert.equal(rebuilt.kind, 'replayed'); f.state = rebuilt.state;
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, {
    rootActionId: f.rootActionId, focusRefs: [TARGET, 'definition:probe-valve', 'definition:probe-steam-zone'],
  }).context;
  const value = hazardBundle();
  Object.assign(value.proposals[0].source.content, { save: null, attack: { kind: 'fixed', bonus: '2' },
    damage: [{ type: 'force', formula: '1d4', sharedAcrossTargets: false }], effects: [] });
  if (repeated) value.proposals[2].branches.success.effects.push(structuredClone(value.proposals[2].branches.success.effects[0]));
  const lower = lowerVNext2ProposalBundle({ value, rootActionId: f.rootActionId,
    actorCharacterId: ACTOR, requiredContext: f.requiredContext, state: f.state });
  assert.equal(lower.kind, 'accepted', JSON.stringify(lower));
  const waiting = stepActionToDecision(f.runtime, f.profiles, f.state, lower.command.rulesInput);
  assert.equal(waiting.kind, 'awaitingRandomness', JSON.stringify(waiting));
  const rolls = waiting.randomnessRequest.hazardRolls.flatMap(spec => spec.dice.flatMap(die =>
    Array(Number(die.count)).fill(spec.purposeKey.includes(':attack:') ? 10 : 2)));
  const pending = f.runtime.step(f.profiles, waiting.state, { kind: 'fulfillAuthoritativeRandomness', continuation: waiting.continuation, rolls });
  assert.equal(pending.kind, 'awaitingInput', JSON.stringify(pending)); assert.equal(pending.pending.kind, 'kpDecision');
  f.s = pendingStores(); f.input = waiting.activityStages.at(-1).input;
  for (const { priorState, result } of waiting.activityStages) {
    const prior = new Set(dueActivityDescriptors(priorState).map(due => due.childRootActionId)), cause = result.events.at(-1);
    for (const activity of dueActivityDescriptors(result.state).filter(due => !prior.has(due.childRootActionId))) {
      f.s.authority.enqueueDueWork({ causeRootActionId: cause.rootActionId, causeEventId: cause.eventId, activity });
    }
    if (result.kind === 'committed') f.s.authority.finishDueWork(result.receipt.rootActionId, 'committed');
  }
  const root = pending.pending.rootActionId, work = f.s.authority.dueWorkByRoot(root);
  assert.ok(work); assert.equal(f.input.proposalId, root);
  f.s.authority.insertSubmission({ submissionId: `due-submission:${root}`, principalId: f.viewer.principalId,
    payloadHash: canonicalHash(f.input), inputKind: 'dueActivity', rootActionId: root, preparedActionId: root,
    characterId: ACTOR, sceneScope: `scene:${f.state.entities[ACTOR].sceneId}`, preparedScopeVersion: 0,
    prepared: { kind: 'prepared', preparedActionId: root, rootActionId: root, kpProjection: {}, resolutionMode: 'authorityDirect' },
    continuation: { dueActivity: JSON.parse(work.descriptor_json), causeRootActionId: work.cause_root_action_id, causeEventId: work.cause_event_id } });
  f.s.authority.markAwaitingRandomness(root, canonicalHash(f.input));
  f.waiting = waiting; f.pending = pending; f.events = [...waiting.events, ...pending.events];
  f.saved = freezePending(f, pending); return f;
}
