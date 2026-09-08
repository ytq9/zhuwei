import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_TARGET as OTHER, PROBE_SOURCE as SOURCE, PROBE_SCENE as SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { VNEXT2_PROPOSAL_BUNDLE_SCHEMA } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { dueActivityDescriptors } from '../app/_runtime/lib/rules/v2/due-activities.ts';
import { characterTimelineId } from '../app/_runtime/lib/rules/v2/timeline.ts';
import { continueCompoundRoot } from '../app/_runtime/lib/rules/v2/internal-compound.ts';
import { dueActorPlanChildRoot } from '../app/_runtime/lib/rules/v2/actor-plans.ts';
import { itemBundle, hazardBundle } from './fixtures/vnext-authored-bundles.mjs';

const HOUR = 3_600_000_000n, NPC = 'npc:messenger', MESSAGE = 'knowledge:delivered-message', PLAN = 'plan:messenger';
const clock = state => state.fictionTimelines[characterTimelineId(state, ACTOR)].nowMicros;
function fixture(name) {
  return createAuthoredProbeFixture(name, { npcCharacters: [{ id: NPC, name: '信使' }], initialKnowledge: [
    { characterId: NPC, knowledgeRef: MESSAGE, content: { text: '你托办的事已有消息，请来确认。' }, kind: 'sourceClaim', layer: 'full', visibility: 'private', provenanceChain: ['genesis:message'] },
  ] });
}
function call(f, state, input, kind = 'committed') {
  const result = f.runtime.step(f.profiles, state, input);
  assert.equal(result.kind, kind, JSON.stringify(result)); return result;
}
function formPlan(f) {
  const root = 'root:form-messenger';
  return call(f, f.state, continueCompoundRoot({ kind: 'formNpcActorPlan', proposalId: root, npcId: NPC,
    factionRef: null, planId: PLAN, goal: '在约定时间处理消息', premiseRefs: [MESSAGE], nextStep: '准备交付消息', resourceRefs: [],
    activity: { activityId: 'activity:messenger', activityKind: 'delivery', intendedDurationMicros: HOUR.toString() },
    due: { kind: 'fictionTime', atFictionMicros: HOUR.toString() }, trigger: null,
    trace: { factRef: 'fact:delivery-trace', description: '信使整理好了信件。', visibilityPolicyRef: 'visibility:scene-observers' },
    alternateTarget: { targetRef: SCENE, reason: '仍在此处' },
  }, root));
}
function start(f, state, family) {
  if (family === 'rest') return call(f, state, { kind: 'startRest', proposalId: 'root:rest', characterId: ACTOR, restKind: 'long' });
  const root = 'root:investigation', context = freezeAuthoredProbeContext(f, state, { rootActionId: root, focusRefs: [SOURCE] }).context;
  const lowered = lowerVNext2ProposalBundle({ ...f, state, rootActionId: root, requiredContext: context, value: {
    schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: 'proposalBundle', mode: 'adjudication', basisRefs: [SOURCE], terminal: null,
    adjudication: { kind: 'directSuccess', durationMicros: (12n * HOUR).toString(), risk: '需要花时间逐项查验。', successOutcome: '完成调查。' },
    proposals: [{ kind: 'worldInteraction', basisRefs: [SOURCE], consumes: [], produces: [], outcomeBinding: 'always',
      sceneRef: SCENE, targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: null,
      intent: '调查阀门', method: '逐项检查表面', branches: { success: { outcomeCode: 'outcome:investigated', summary: '完整调查已完成。',
        effects: [], sensoryEvidence: [], pressures: [], opportunities: [] }, failure: null } }],
  } });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  assert.equal(lowered.command.rulesInput.kind, 'startActionActivity');
  return call(f, state, lowered.command.rulesInput);
}
function stage(f, state, id, expected = 'committed') {
  const due = dueActivityDescriptors(state).find(due => due.activityId === id);
  assert.ok(due, `no next stage for ${id}`);
  const kind = due.activityProgress?.phase === 'complete'
    ? due.activityProgress.completion === 'action' ? 'completeActionActivity' : 'completeActivity'
    : 'advanceActivity';
  return call(f, state, { kind, proposalId: due.childRootActionId, activityId: id }, expected);
}
function message(f, state, root = 'root:deliver') {
  return call(f, state, { kind: 'shareKnowledge', proposalId: root, senderCharacterId: NPC, recipientEntityIds: [ACTOR],
    knowledgeRefs: [MESSAGE], medium: '当面告知', contentLayer: 'full' });
}
function control(f, state, id, decision = 'continue', actor = ACTOR, kind = 'committed') {
  return call(f, state, { kind: 'controlActivity', proposalId: `root:${decision}:${actor}`, actorCharacterId: actor,
    activityId: id, attentionRootActionId: state.campaignRuntime.activities[id].attention.rootActionId, decision }, kind);
}
function paused(f, family) {
  const formed = formPlan(f), started = start(f, formed.state, family);
  const id = started.events.find(e => ['ActivityStarted', 'RestStarted'].includes(e.eventType)).payload.activityId;
  const advance = stage(f, started.state, id);
  assert.equal(clock(advance.state), HOUR.toString());
  assert.equal(advance.state.campaignRuntime.activities[id].status, 'active');
  assert.ok(!advance.events.some(e => ['RestCompleted', 'WorldInteractionResolved'].includes(e.eventType)));
  const acted = call(f, advance.state, { kind: 'resolveDueActorPlan', proposalId: dueActorPlanChildRoot(advance.state.campaignRuntime.npcPlans[PLAN]),
    affectedCharacterId: NPC, causedByRootActionId: advance.receipt.rootActionId, planId: PLAN, decision: 'execute', mechanicalProposal: null });
  // A private/background plan's completion alone never notifies the player.
  assert.equal(acted.state.knowledge[ACTOR][MESSAGE], undefined);
  assert.notEqual(dueActivityDescriptors(acted.state).find(d => d.activityId === id)?.activityProgress?.phase, 'attention');
  const delivered = message(f, acted.state), notice = stage(f, delivered.state, id);
  return { id, state: notice.state, events: [formed, started, advance, acted, delivered, notice].flatMap(r => r.events) };
}

test('long rest and a lowered investigation share the causal pause, continuation and replay path', () => {
  for (const family of ['rest', 'investigation']) {
    const f = fixture(`attention-${family}`), p = paused(f, family);
    assert.equal(clock(p.state), HOUR.toString());
    assert.deepEqual(dueActivityDescriptors(p.state), []);
    assert.equal(p.state.entities[ACTOR].hitPoints.current, f.state.entities[ACTOR].hitPoints.current);
    const view = f.runtime.project(f.profiles, p.state, f.viewer);
    assert.equal(view.kind, 'projected');
    assert.deepEqual(view.activities.find(a => a.activityId === p.id).attention.messages, ['你托办的事已有消息，请来确认。']);
    assert.doesNotMatch(JSON.stringify(view.activities), /completionInput|readSet|outcome:investigated|timelineAtStart/);
    const other = f.runtime.project(f.profiles, p.state, { ...f.viewer, characterId: OTHER, principalId: 'principal:probe-target', seatId: 'seat:probe-target' });
    assert.ok(!JSON.stringify(other).includes('你托办的事已有消息'));
    control(f, p.state, p.id, 'continue', OTHER, 'rejected');
    const resumed = control(f, p.state, p.id), advanced = stage(f, resumed.state, p.id), done = stage(f, advanced.state, p.id);
    assert.equal(done.state.campaignRuntime.activities[p.id].status, 'completed');
    assert.equal(clock(done.state), ((family === 'rest' ? 8n : 12n) * HOUR).toString());
    const all = [...p.events, ...resumed.events, ...advanced.events, ...done.events];
    assert.equal(all.filter(e => e.eventType === 'ActivityCompleted' && e.payload.activityId === p.id).length, 1);
    assert.equal(all.filter(e => e.eventType === (family === 'rest' ? 'RestCompleted' : 'WorldInteractionResolved')).length, 1);
    const replay = f.runtime.replay(f.genesis, all);
    assert.equal(replay.kind, 'replayed', JSON.stringify(replay)); assert.deepEqual(replay.state, done.state);
  }
});

test('without a notification both activity families finish without an explicit wait', () => {
  for (const family of ['rest', 'investigation']) {
    const f = fixture(`normal-${family}`), started = start(f, f.state, family);
    const id = started.events.find(e => ['ActivityStarted', 'RestStarted'].includes(e.eventType)).payload.activityId;
    const advanced = stage(f, started.state, id), done = stage(f, advanced.state, id);
    assert.equal(done.state.campaignRuntime.activities[id].status, 'completed');
    assert.ok(![...started.events, ...advanced.events, ...done.events].some(e => e.eventType === 'ActivityAttentionRequested'));
  }
});

test('stopping retains elapsed time, changed investigation dependencies cannot receive a stale result, and combat blocks continuation', () => {
  for (const family of ['rest', 'investigation']) {
    const f = fixture(`boundary-${family}`), p = paused(f, family);
    const stopped = control(f, p.state, p.id, 'stop');
    assert.equal(stopped.state.campaignRuntime.activities[p.id].status, 'interrupted');
    assert.equal(clock(stopped.state), HOUR.toString());
    assert.equal(stopped.state.entities[ACTOR].hitPoints.current, p.state.entities[ACTOR].hitPoints.current);
    const later = structuredClone(stopped.state);
    later.fictionTimelines[characterTimelineId(later, ACTOR)].nowMicros = (2n * HOUR).toString();
    const stoppedView = f.runtime.project(f.profiles, later, f.viewer);
    assert.equal(stoppedView.kind, 'projected', JSON.stringify(stoppedView));
    assert.equal(stoppedView.activities.find(a => a.activityId === p.id).progressFictionMicros, HOUR.toString());
    const combat = structuredClone(p.state);
    combat.combatRuntime.encounters['encounter:test'] = { encounterId: 'encounter:test', status: 'starting', participantEntityIds: [ACTOR], sceneId: SCENE, round: 0, activeEntityId: null };
    assert.deepEqual(dueActivityDescriptors(combat), []);
    control(f, combat, p.id, 'continue', ACTOR, 'rejected');
    assert.equal(clock(combat), HOUR.toString());
    if (family === 'investigation') {
      for (const mutate of [state => { state.scenes[SCENE].name = '已经改变的现场'; }, state => { delete state.campaignRuntime.definitions[SOURCE]; }]) {
        const changed = structuredClone(p.state); mutate(changed);
        const result = control(f, changed, p.id);
        assert.equal(result.state.campaignRuntime.activities[p.id].status, 'interrupted');
        assert.equal(clock(result.state), HOUR.toString(), 'illegal continuation cannot consume the remaining duration');
        assert.ok(!result.events.some(e => e.eventType === 'WorldInteractionResolved'));
      }
    }
  }
});

test('staged authored items and hazards retain prospective identities, native dice and single final effects', () => {
  for (const [family, value] of [['item', itemBundle()], ['hazard', hazardBundle()]]) {
    const f = fixture(`activity-prospective-${family}`), lowered = lowerVNext2ProposalBundle({ ...f, value });
    assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
    const input = lowered.command.rulesInput;
    assert.equal(input.kind, 'startActionActivity');
    call(f, f.state, input.completionInput, 'rejected');
    const started = call(f, f.state, input), id = started.mechanicalResult.activityId;
    const advanced = stage(f, started.state, id), pending = stage(f, advanced.state, id, 'awaitingRandomness');
    assert.deepEqual(pending.state.campaignRuntime.itemSystem, f.state.campaignRuntime.itemSystem);
    assert.equal(pending.state.campaignRuntime.activities[id].status, 'active');
    const rolls = pending.randomnessRequest.dice.flatMap(die => Array(Number(die.count)).fill(2));
    for (const mutate of [state => { delete state.campaignRuntime.definitions[SOURCE]; }, state => {
      state.combatRuntime.encounters['encounter:pending'] = { encounterId: 'encounter:pending', status: 'starting', participantEntityIds: [ACTOR], sceneId: SCENE, round: 0, activeEntityId: null };
    }]) {
      const changed = structuredClone(pending.state); mutate(changed);
      const rejected = call(f, changed, { kind: 'fulfillAuthoritativeRandomness', continuation: pending.continuation, rolls }, 'rejected');
      assert.deepEqual(rejected.events, []);
    }
    const done = call(f, pending.state, { kind: 'fulfillAuthoritativeRandomness', continuation: pending.continuation, rolls });
    assert.equal(done.state.campaignRuntime.activities[id].status, 'completed');
    assert.equal(done.events.filter(e => e.eventType === 'ActivityCompleted' && e.payload.activityId === id).length, 1,
      JSON.stringify({ family, events: done.events.map(e => ({ kind: e.eventType, id: e.eventId, activityId: e.payload.activityId })) }));
    assert.ok(done.events.some(e => e.eventType === (family === 'item' ? 'ItemUsed' : 'WorldInteractionResolved')));
    const replayed = f.runtime.replay(f.genesis, [...started.events, ...advanced.events, ...pending.events, ...done.events]);
    assert.equal(replayed.kind, 'replayed', JSON.stringify(replayed)); assert.deepEqual(replayed.state, done.state);
    call(f, done.state, input, 'rejected');
  }
});
