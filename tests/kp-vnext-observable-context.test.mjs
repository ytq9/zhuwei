import { committedActionRange } from './fixtures/vnext-action-lifecycle.mjs';
import { stepActionToDecision } from './fixtures/vnext-action-lifecycle.mjs';
import { soleStep, rebundle, soleInput } from './fixtures/vnext-action-duration.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_TARGET as OTHER, PROBE_SCENE as SCENE, PROBE_SOURCE as SOURCE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import * as proposalContext from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { authorityRevisionOrHash } from '../app/_runtime/lib/rules/v2/authority-bindings.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { freezeAdjudicationContext } from '../app/_runtime/lib/kp/vnext/context/index.ts';
import { requiredContextReadBindings } from '../app/_runtime/lib/kp/vnext/required-context-runtime.ts';
import { npcDecisionEntryRef, npcDecisionContext } from '../app/_runtime/lib/kp/vnext/context/npc-decision.ts';
import { encodeVNextStrictToolBundle } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { VNEXT_SEMANTIC_TEMPLATES } from '../app/_runtime/lib/rules/profiles/semantic-templates.ts';
import { dynamicLocationSceneRef } from '../app/_runtime/lib/rules/v2/dynamic-locations.ts';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';

const NPC = 'npc:unaddressed-witness', HIDDEN = 'npc:concealed', REMOTE = 'npc:different-scope';
const held = (characterId, content) => ({ characterId, knowledgeRef: 'knowledge:same',
  kind: 'sourceClaim', layer: 'partial', content, visibility: 'private', provenanceChain: ['genesis:private'] });
function fixture(label, focusRefs = []) {
  const f = createAuthoredProbeFixture(`observable:${label}`, {
    npcCharacters: [{ id: NPC, name: '斑尾信使' }, { id: HIDDEN, name: '静默访客' }, { id: REMOTE, name: '远方住客' }],
    initialKnowledge: [held(ACTOR, 'ACTOR_KNOWN'), held(OTHER, 'OTHER_PLAYER_PRIVATE'),
      held(NPC, 'NPC_PRIVATE 这件事情他昨夜亲眼看见了。'), held(HIDDEN, 'HIDDEN_PRIVATE'), held(REMOTE, 'REMOTE_PRIVATE')],
  });
  const state = structuredClone(f.state);
  state.combatRuntime.entities[HIDDEN].visibilityPolicyId = 'visibility:hidden-until-evidence';
  state.entities[REMOTE].sceneId = 'scene:elsewhere';
  state.combatRuntime.entities[REMOTE].sceneId = 'scene:elsewhere';
  const frozen = freezeAuthoredProbeContext(f, state, { rootActionId: f.rootActionId, focusRefs, intentText: '我观察周围在场的人现在各自在做什么。' });
  return { ...f, state, requiredContext: frozen.context, coverage: frozen.coverage };
}
function observe(subjectRef) {
  return { mode: 'adjudication', basisRefs: [subjectRef],
    adjudication: { kind: 'directSuccess', durationMicros: '300000000', risk: '只观察眼前情况。', successOutcome: '看见当前站位。' },
    terminal: { kind: 'none' }, proposals: [{ kind: 'observe', basisRefs: [subjectRef], consumes: [], produces: [],
      outcomeBinding: 'always', sceneRef: SCENE, inquiry: '对方现在在哪里？', method: '观察在场人物。',
      focusRefs: [subjectRef], existingFactRefs: [], branches: { success: {
        outcomeCode: 'outcome:position', summary: '看到对方站在当前场地。',
        sensoryEvidence: [{ observerRef: ACTOR, subjectRef, sense: 'sight',
          evidence: '对方站在当前场地内。', basisRefs: [subjectRef] }], characterInferences: [],
      }, failure: { kind: 'none' } } }],
  };
}
function lower(f, subjectRef) {
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(observe(subjectRef))));
  assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
  return lowerVNext2ProposalBundle({ ...f, value: parsed.bundle });
}

test('model context separates established world descriptions from technical states without losing frozen data', () => {
  const f = fixture('presentation', [SOURCE]), before = structuredClone(f.requiredContext);
  // The unaddressed witness travels once the selection asks for it; this
  // presentation check reads the complete view.
  const presented = proposalContext.proposalModelContext(f.requiredContext, [NPC],
    (f.requiredContext.references.knowledgeRecall ?? []).flatMap(entry => entry.records.map(record => record.entryRef)));
  const valve = presented.entries.find(entry => entry.entryRef === SOURCE).value;
  assert.deepEqual(valve.worldDescription, { content: { label: '阀门', description: '生锈阀门发出细微嘶鸣。' } });
  assert.equal(valve.adjudication.content.observableState, 'ready');
  assert.deepEqual(valve.adjudication.content.mechanicDefinitionRefs, ['feature:probe-valve']);
  const feature = presented.entries.find(entry => entry.entryRef === 'feature:probe-valve').value;
  assert.deepEqual(feature.worldDescription, { feature: { label: '供汽阀门' } });
  assert.equal(feature.adjudication.feature.kind, 'barrier');
  assert.deepEqual(feature.adjudication.feature.polygon, f.state.combatRuntime.scenes[SCENE].geometry.obstacles[0].polygon);
  const npc = presented.entries.find(entry => entry.entryRef === NPC).value;
  assert.deepEqual(npc.worldDescription, { entity: { name: '斑尾信使' } });
  assert.ok(npc.adjudication.combat.position);
  const scene = presented.entries.find(entry => entry.entryRef === SCENE).value;
  assert.deepEqual(scene.worldDescription, { scene: { name: '蒸汽廊道' } });
  assert.ok(scene.adjudication.combatScene.geometry);
  // Description fields move once; recombining the presentation must recover
  // every exact original value, including mechanics, metadata and unknowns.
  // The presentation keeps every entry in order and carries no server-owned
  // version hash; Room and lowering read those from the frozen context.
  // Knowledge catalogs bind versions for Rules and are not sent to the model.
  const beforeSent = before.entries.filter(entry => !String(entry.entryRef).startsWith('knowledge-catalog:'));
  assert.deepEqual(presented.entries.map(entry => entry.entryRef), beforeSent.map(entry => entry.entryRef));
  for (const [index, entry] of beforeSent.entries()) {
    const shown = presented.entries[index];
    if (entry.kind !== 'known') { assert.deepEqual(shown, entry); continue; }
    assert.equal(shown.revisionOrHash, undefined, entry.entryRef);
    assert.equal(shown.kind, 'known');
    if (!shown.value?.worldDescription) continue;
    const value = structuredClone(shown.value.adjudication);
    for (const [key, part] of Object.entries(shown.value.worldDescription)) {
      value[key] = part && typeof part === 'object' ? { ...value[key], ...part } : part;
    }
    assert.ok(Object.isFrozen(shown.value.worldDescription));
    assert.deepEqual(value, entry.value, entry.entryRef);
  }
  assert.deepEqual(f.requiredContext, before);
  assert.equal(presented.contextHash, before.binding.contextHash);
  for (const ref of [HIDDEN, REMOTE, `knowledge:${NPC}:knowledge:same`, npcDecisionEntryRef(NPC)]) {
    assert.equal(presented.entries.find(entry => entry.entryRef === ref)?.value?.worldDescription, undefined);
  }
  assert.doesNotMatch(JSON.stringify(presented), /OTHER_PLAYER_PRIVATE|HIDDEN_PRIVATE|REMOTE_PRIVATE/);
});

test('unknown state codes never gain an invented appearance or sound in the model presentation', () => {
  const f = fixture('opaque-state', [SOURCE]), context = structuredClone(f.requiredContext);
  const source = context.entries.find(entry => entry.entryRef === SOURCE);
  source.value.content.label = '木板';
  source.value.content.description = '眼前是一块木板，表面留有三道划痕。';
  source.value.content.observableState = 'phase:qx_73';
  source.value.content.affordances = ['mechanic:can_trigger'];
  const value = proposalContext.proposalModelContext(context).entries.find(entry => entry.entryRef === SOURCE).value;
  assert.deepEqual(value.worldDescription, { content: { label: '木板', description: source.value.content.description } });
  assert.equal(value.adjudication.content.observableState, 'phase:qx_73');
  assert.deepEqual(value.adjudication.content.affordances, ['mechanic:can_trigger']);
});

test('faithful visual and auditory paraphrases remain valid through parsing, Rules and viewer knowledge', () => {
  const f = fixture('paraphrase', [SOURCE]), proposal = observe(SOURCE);
  const branch = proposal.proposals[0].branches.success;
  const visual = '阀门表面有锈迹。', auditory = '能听见阀门发出轻微的嘶嘶声。';
  branch.sensoryEvidence = [
    { observerRef: ACTOR, subjectRef: SOURCE, sense: 'sight', evidence: visual, basisRefs: [SOURCE] },
    { observerRef: ACTOR, subjectRef: SOURCE, sense: 'hearing', evidence: auditory, basisRefs: [SOURCE] },
  ];
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(proposal)));
  assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
  const lowered = lowerVNext2ProposalBundle({ ...f, value: parsed.bundle });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(result.kind, 'committed', JSON.stringify(result));
  const view = f.runtime.project(f.profiles, result.state, f.viewer);
  assert.equal(view.kind, 'projected');
  for (const text of [visual, auditory]) assert.ok(view.knowledge.some(entry => entry.content === text));
});

test('visible conversational candidates retain their own decision context without expanding hidden or remote subjects', () => {
  const f = fixture('generic');
  for (const ref of [NPC, OTHER]) {
    const entry = f.requiredContext.entries.find(entry => entry.kind === 'known' && entry.entryRef === ref);
    assert.ok(entry, `current visible subject ${ref} must have an exact frozen record`);
    assert.ok(f.requiredContext.references.citations.viewerEvidenceRefs.includes(ref));
    assert.equal(entry.revisionOrHash, authorityRevisionOrHash(f.state, ref));
    assert.equal(entry.revisionOrHash, canonicalHash(entry.value));
    assert.deepEqual(requiredContextReadBindings(f.requiredContext).get(ref), { ref, revisionOrHash: entry.revisionOrHash });
  }
  const refs = proposalContext.proposalObservationSubjectRefs(f.requiredContext);
  for (const ref of [ACTOR, NPC, OTHER, SCENE]) assert.ok(refs.includes(ref), ref);
  for (const ref of [HIDDEN, REMOTE, 'knowledge:same', `knowledge:${ACTOR}:knowledge:same`]) assert.ok(!refs.includes(ref), ref);
  const decision = npcDecisionContext(f.requiredContext.entries, NPC);
  assert.ok(decision, 'a natural-language reference need not match the exact display name');
  assert.deepEqual(decision.knowledge.map(entry => entry.entryRef), [`knowledge:${NPC}:knowledge:same`]);
  assert.doesNotMatch(JSON.stringify(f.requiredContext.entries), /OTHER_PLAYER_PRIVATE|HIDDEN_PRIVATE|REMOTE_PRIVATE/);
  for (const ref of [HIDDEN, REMOTE]) assert.equal(npcDecisionContext(f.requiredContext.entries, ref), undefined);
  assert.ok(f.coverage.obligations.some(item => item.obligation === 'observableSubject' && item.resolved));
  assert.deepEqual(proposalContext.proposalModelContext(f.requiredContext).references.observationSubjectRefs, refs);
  assert.ok(Object.isFrozen(refs));
});

test('unnamed and differently written NPC references have the same finite source choices as a named conversation', () => {
  const f = fixture('natural-conversation');
  for (const text of ['我问他知道这件事吗。', '我问unaddressed-witness知道这件事吗。', '我问斑尾信使知道这件事吗。']) {
    const frozen = freezeAuthoredProbeContext(f, f.state, { focusRefs: [], intentText: text });
    const decision = npcDecisionContext(frozen.context.entries, NPC);
    assert.ok(decision, text);
    const bodies = decision.knowledge.map(ref => frozen.context.entries.find(entry => entry.entryRef === ref.entryRef));
    assert.match(JSON.stringify(bodies), /NPC_PRIVATE/);
    assert.doesNotMatch(JSON.stringify({ decision, bodies }), /OTHER_PLAYER_PRIVATE|HIDDEN_PRIVATE|REMOTE_PRIVATE|ACTOR_KNOWN/);
  }
});

test('an oversized relevant NPC knowledge body blocks freezing instead of masquerading as an optional directory line', () => {
  const f = fixture('large-npc-history'), state = structuredClone(f.state);
  state.knowledge[NPC]['knowledge:same'].content = 'x'.repeat(70_000);
  assert.throws(() => freezeAuthoredProbeContext(f, state, { rootActionId: f.rootActionId,
    focusRefs: [], intentText: '我看看眼前的人。' }), error => {
    assert.equal(error.code, 'PROBE_CONTEXT_BINDING_FAILED');
    assert.equal(error.diagnostics.reason, 'contextBudgetExceeded');
    return true;
  });
});

test('different observed entity kinds follow the same parser, lowering, Rules and player projection path', () => {
  for (const subjectRef of [NPC, OTHER]) {
    const f = fixture(`submit:${subjectRef}`), lowered = lower(f, subjectRef);
    assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
    assert.ok(soleStep(lowered.command).plan.readSet.some(binding => binding.ref === subjectRef
      && binding.revisionOrHash === authorityRevisionOrHash(f.state, subjectRef)));
    const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
    assert.equal(result.kind, 'committed', JSON.stringify(result));
    const factId = result.events.find(event => event.eventType === 'SensoryEvidenceAcquired').payload.factId;
    assert.equal(result.state.canonicalFacts[factId].value.subjectRef, subjectRef);
    const view = f.runtime.project(f.profiles, result.state, f.viewer, { channel: 'realtime', committedRange: committedActionRange(result.state, {
      receiptId: result.receipt.receiptId, actorCharacterId: ACTOR, priorState: f.state, events: result.events,
    }) });
    assert.equal(view.kind, 'projected');
    assert.doesNotMatch(JSON.stringify(view), /OTHER_PLAYER_PRIVATE|NPC_PRIVATE|HIDDEN_PRIVATE|REMOTE_PRIVATE/);
    const { activities: _activities, ...campaign } = result.state.campaignRuntime;
    const { activities: _initialActivities, ...initialCampaign } = f.state.campaignRuntime;
    assert.deepEqual(campaign, initialCampaign);
    assert.ok(Object.values(result.state.campaignRuntime.activities).every(activity => activity.status === 'completed'));
    for (const field of ['entities', 'combatRuntime', 'fictionTime']) assert.deepEqual(result.state[field], f.state[field]);
  }
});

test('missing, forged and stale subject bindings fail before events, as do hidden and off-scene targets', () => {
  const f = fixture('binding'), lowered = lower(f, NPC);
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  for (const mutate of [
    input => { soleInput(input).plan.readSet = soleInput(input).plan.readSet.filter(binding => binding.ref !== NPC); },
    input => { soleInput(input).plan.readSet.find(binding => binding.ref === NPC).revisionOrHash = `sha256:${'0'.repeat(64)}`; },
  ]) {
    const input = structuredClone(lowered.command.rulesInput); mutate(input);
    const result = stepActionToDecision(f.runtime, f.profiles, f.state, input);
    assert.equal(result.kind, 'rejected', 'every selected observation subject must retain its frozen read binding'); assert.deepEqual(result.events, []);
  }
  const moved = structuredClone(f.state);
  moved.combatRuntime.entities[NPC].position.x = '500';
  const stale = stepActionToDecision(f.runtime, f.profiles, moved, lowered.command.rulesInput);
  assert.equal(stale.kind, 'rejected'); assert.deepEqual(stale.events, []);
  for (const ref of [HIDDEN, REMOTE, 'knowledge:same']) assert.equal(lower(f, ref).kind, 'rejected');
});

test('explicit NPC targets retain the existing decision path and physical feature subjects remain typed', () => {
  const f = fixture('targeted');
  const context = freezeAuthoredProbeContext(f, f.state, { focusRefs: [NPC, SOURCE], intentText: '我向斑尾信使询问他知道的事情。' }).context;
  assert.ok(context.entries.some(entry => entry.entryRef === npcDecisionEntryRef(NPC)));
  assert.ok(context.entries.some(entry => entry.entryRef === `knowledge:${NPC}:knowledge:same`));
  const refs = proposalContext.proposalObservationSubjectRefs(context);
  assert.ok(refs.includes(SOURCE));
  assert.ok(refs.includes('feature:probe-valve'));
  assert.ok(!refs.includes('relation:probe-occupant'));
  assert.ok(!refs.includes(`knowledge:${NPC}:knowledge:same`));
});


test('subject directory remains frozen, missing subject context is rejected, and oversized visible subjects fail closed', () => {
  const f = fixture('completeness'), original = structuredClone(f.requiredContext);
  proposalContext.proposalObservationSubjectRefs(f.requiredContext);
  assert.deepEqual(f.requiredContext, original);
  const context = structuredClone(f.requiredContext);
  context.entries = context.entries.filter(entry => entry.entryRef !== NPC);
  assert.equal(lower({ ...f, requiredContext: context }, NPC).kind, 'rejected');
  const state = structuredClone(f.state);
  state.entities[NPC].name = 'x'.repeat(70_000);
  const kpProjection = f.runtime.project(f.profiles, state, { kind: 'kp', capability: 'internal:kp-spatial-evidence' });
  const blocked = freezeAdjudicationContext({ state, profiles: f.profiles, kpProjection,
    replayHead: { eventSeq: state.version, stateHash: canonicalHash(state) },
    preparedActionId: 'prepared:oversized', rootActionId: f.rootActionId, submissionRef: 'submission:oversized',
    actorCharacterId: ACTOR, intentText: '我看看周围。', focusRefs: [], maxUnits: 160_000 });
  assert.equal(blocked.kind, 'blocked');
  assert.equal(blocked.reason, 'criticalUnavailable');
  assert.ok(blocked.issues.includes(`entry:${NPC}:truncated`));
  assert.deepEqual(f.requiredContext, original, 'later authority changes cannot mutate the original frozen context');
});


function dynamicFixture() {
  const f = createAuthoredProbeFixture('observable:dynamic');
  const producers = ['location', 'passage'].map(kind => {
    const template = VNEXT_SEMANTIC_TEMPLATES[kind];
    return { kind: 'materializeObject', basisRefs: [SOURCE],
      consumes: kind === 'passage' ? [{ kind: 'existing', ref: SCENE }, { kind: 'prospective', handle: 'prospective:room' }] : [],
      produces: [{ handle: kind === 'location' ? 'prospective:room' : 'prospective:route', kind: 'semanticDefinition', outcomeBinding: 'always' }],
      outcomeBinding: 'always', semanticKind: kind, templateRef: template.templateRef, templateHash: template.templateHash,
      visibilityPolicyRef: 'visibility:scene-observers', summary: '固化当前发现的空间。',
      definition: { sceneRef: SCENE, visibilityFactId: null, label: kind === 'location' ? '下层小室' : '向下石阶',
        description: '该空间的既有描述。', observableState: kind === 'passage' ? 'open' : null,
        affordances: null, mechanicDefinitionRefs: [], ...(kind === 'location'
          ? { geometry: structuredClone(f.state.combatRuntime.scenes[SCENE].geometry) }
          : { passage: { fromLocationRef: SCENE, toLocationRef: 'prospective:room', bidirectional: true,
            traversal: '沿石阶步行', travelDurationMicros: '60000000' } }) },
    };
  });
  const value = rebundle(observe(SOURCE), producers);
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(value)));
  assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
  const lowered = lowerVNext2ProposalBundle({ ...f, value: parsed.bundle });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(result.kind, 'committed', JSON.stringify(result));
  const [locationRef, passageRef] = result.events.filter(event => event.eventType === 'SemanticDefinitionMaterialized')
    .map(event => event.payload.definitionRef);
  return { ...f, state: result.state, locationRef, passageRef };
}

test('closed dynamic locations and passages use the same spatial permission at either endpoint and exclude other scenes', () => {
  const f = dynamicFixture(), destination = dynamicLocationSceneRef(f.locationRef);
  for (const scene of [SCENE, destination, 'scene:unrelated']) {
    const state = structuredClone(f.state);
    if (scene === 'scene:unrelated') {
      state.scenes[scene] = { id: scene, name: '另一场地' };
      state.combatRuntime.scenes[scene] = { ...structuredClone(state.combatRuntime.scenes[SCENE]), sceneId: scene };
    }
    state.entities[ACTOR].sceneId = scene; state.combatRuntime.entities[ACTOR].sceneId = scene;
    const rootActionId = `${f.rootActionId}:${scene}`;
    const context = freezeAuthoredProbeContext(f, state, { rootActionId, focusRefs: [f.locationRef, f.passageRef],
      intentText: '我观察这些已经发现的空间。' }).context;
    const refs = proposalContext.proposalObservationSubjectRefs(context);
    assert.equal(refs.includes(f.locationRef), scene === destination, `location:${scene}`);
    assert.equal(refs.includes(f.passageRef), scene !== 'scene:unrelated', `passage:${scene}`);
    if (scene === SCENE) {
      const lowered = lower({ ...f, state, rootActionId, requiredContext: context }, f.passageRef);
      assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
      assert.equal(stepActionToDecision(f.runtime, f.profiles, state, lowered.command.rulesInput).kind, 'committed');
    }
  }
  const hidden = structuredClone(f.state);
  hidden.campaignRuntime.definitions[f.passageRef].visibilityPolicyRef = 'visibility:room-authority-only';
  const context = freezeAuthoredProbeContext(f, hidden, { focusRefs: [f.passageRef], intentText: '看看这里。' }).context;
  assert.ok(!proposalContext.proposalObservationSubjectRefs(context).includes(f.passageRef));
});
