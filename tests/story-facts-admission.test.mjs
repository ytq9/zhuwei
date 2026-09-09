import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE, PROBE_SOURCE as BASIS } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { canonicalSha256 } from '../app/_runtime/lib/rules/profiles/canonical.ts';
import { authorityRevisionOrHash } from '../app/_runtime/lib/rules/v2/authority-bindings.ts';
import { characterTimelineId } from '../app/_runtime/lib/rules/v2/timeline.ts';
import { createEventTransition, createScopeProof } from '../app/_runtime/lib/rules/v2/events.ts';
import { STORY_FACTS_ADMISSION_PLAN_SCHEMA, isStoryFactsAdmissionPlan, isStoryFactBody, isStoryKnowledgeBody,
  isStoryKnowledgeAdmissionMetadata, storyFactAdmissionRef, storyKnowledgeAdmissionRef, prepareStoryFactsAdmission,
  storyFactAdmissionIssue, storyKnowledgeAdmissionIssue, storyAdmissionEvidenceIssue,
  stepAdmitStoryFacts, remapStoryTemporalContent } from '../app/_runtime/lib/rules/v2/story-facts-admission.ts';
import { NPC_MATERIALIZATION_PLAN_SCHEMA, applyNpcMaterializedEvent } from '../app/_runtime/lib/rules/v2/npc-materialization.ts';

const NPC = 'npc:boatman', LOCAL_FACT = 'candidate:broken-seal', LOCAL_KNOWLEDGE = 'candidate:boatman-knows';
const clone = structuredClone;
function at(timelineId, micros, basisRefs = [SCENE]) { return { kind: 'at', start: { timelineId, micros }, end: null, basisRefs }; }
function fixture(name, { npc = true } = {}) {
  const f = createAuthoredProbeFixture(`story-facts:${name}`, { npcCharacters: npc ? [{ id: NPC, name: '老船工' }] : [] });
  for (const timeline of Object.values(f.state.fictionTimelines)) timeline.nowMicros = '100';
  const timelineId = characterTimelineId(f.state, ACTOR), pin = `profile-context:${f.state.campaignRuntime.campaign.moduleRef.profileId}`;
  const candidate = { ref: LOCAL_FACT, layer: 'worldTruth', content: '上游闸门的铅封在昨夜被打开。', subjectRefs: [NPC, SCENE],
    occurrence: at(timelineId, '20'), basisRefs: [BASIS, SCENE], creationBasis: 'authorizedOpenSpace', knowledge: [{
      ref: LOCAL_KNOWLEDGE, holderRef: NPC, factRef: LOCAL_FACT, layer: 'truth', content: 'PRIVATE_KNOWLEDGE：昨夜闸门铅封被打开。',
      sourceRef: LOCAL_FACT, acquisition: at(timelineId, '80', [LOCAL_FACT, NPC]), explanation: '清晨检查时亲眼看见断开的铅封。',
    }] };
  f.input = { kind: 'admitStoryFacts', rootActionId: `${f.rootActionId}:admission`, actorCharacterId: ACTOR,
    plan: { schema: STORY_FACTS_ADMISSION_PLAN_SCHEMA, proposalRef: 'proposal:story-fact', contextHash: canonicalSha256({ name }),
      preparationHash: canonicalSha256({ preparation: name }), facts: [candidate], bindings: [], readSet: [], authorizationRefs: [pin], knowledgeBoundaries: [] } };
  return refresh(f);
}
function refresh(f, extraRefs = []) {
  const { plan } = f.input;
  plan.bindings = plan.facts.flatMap(candidate => [
    { ref: candidate.ref, authorityRef: storyFactAdmissionRef(plan.preparationHash, candidate.ref), kind: 'fact' },
    ...candidate.knowledge.map(knowledge => ({ ref: knowledge.ref,
      authorityRef: storyKnowledgeAdmissionRef(plan.preparationHash, knowledge.ref, knowledge.holderRef), kind: 'knowledge' })),
  ]);
  const local = new Set(plan.bindings.map(binding => binding.ref));
  const refs = [...new Set([ACTOR, `character-timeline:${ACTOR}`, ...plan.authorizationRefs, ...extraRefs,
    ...plan.facts.flatMap(candidate => [...candidate.subjectRefs, ...candidate.basisRefs, ...candidate.occurrence.basisRefs,
      ...candidate.knowledge.flatMap(k => [k.holderRef, k.sourceRef, `knowledge-catalog:${k.holderRef}`,
        `character-timeline:${k.holderRef}`, ...k.acquisition.basisRefs,
        ...(f.state.entities[k.holderRef]?.semanticDefinitionRef ? [f.state.entities[k.holderRef].semanticDefinitionRef] : [])])]),
    ...plan.knowledgeBoundaries.map(entry => entry.basisRef),
  ])].filter(ref => !local.has(ref) && authorityRevisionOrHash(f.state, ref) !== null).sort();
  plan.readSet = refs.map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(f.state, ref) }));
  return f;
}
function prepared(f, input = f.input) {
  const result = prepareStoryFactsAdmission(f.state, input);
  assert.equal(result.kind, 'prepared', JSON.stringify(result));
  return result;
}
function rejected(f, input, pattern) {
  const before = clone(f.state), result = prepareStoryFactsAdmission(f.state, input);
  assert.equal(result.kind, 'rejected', JSON.stringify(result));
  assert.match(result.rejection.message, pattern);
  assert.deepEqual(result.events, []); assert.deepEqual(f.state, before);
}
/** Validator fixtures deliberately do not emulate EventEnvelope/Receipt
 * success. The integration owner wires metadata into the normal writer and
 * runs the public Rules entry/replay test there. */
function stagedFixture(f, result = prepared(f)) {
  const state = clone(f.state), knowledgePayloads = [];
  for (const [index, draft] of result.drafts.entries()) {
    if (draft.eventType === 'CanonicalFactDeclared') {
      if (draft.payload.fact.kind === 'storyTemporalEvidence') continue;
      assert.equal(storyFactAdmissionIssue(state, draft.payload, f.input.rootActionId), undefined);
      state.canonicalFacts[draft.payload.fact.id] = { ...clone(draft.payload.fact), branchId: state.activeBranchId, validFromEventSeq: String(index + 1) };
    } else {
      assert.equal(storyKnowledgeAdmissionIssue(state, draft.payload, f.input.rootActionId), undefined);
      const p = draft.payload;
      state.knowledge[p.characterId] ??= {};
      state.knowledge[p.characterId][p.knowledgeRef] = { characterId: p.characterId, knowledgeRef: p.knowledgeRef,
        objectKind: p.objectKind, layer: p.layer, content: clone(p.content), visibility: p.visibility,
        acquiredByEventId: `event:fixture:${index + 1}`, acquiredAtFictionMicros: '100', sourceCharacterId: null,
        provenanceChain: [p.causeFactId, p.storyAdmission.sourceRef, `event:fixture:${index + 1}`] };
      knowledgePayloads.push(p);
    }
  }
  return { state, knowledgePayloads, evidence: result.drafts.filter(d => d.eventType === 'CanonicalFactDeclared'
    && d.payload.fact.kind === 'storyTemporalEvidence').map(d => d.payload.fact.value) };
}
function createNpcPrefix(f) {
  const stats = { str: 10, dex: 12, con: 10, int: 12, wis: 14, cha: 10 };
  const source = { name: '新入场的老船工', description: '衣袖留着河泥。', background: '多年沿河运送档案。', goals: ['查明铅封破坏者'],
    behavioralConstraints: ['不会假装知道未接触过的秘密'], voice: '缓慢直接', initialUnknowns: ['不知道破坏者身份'], rulesBasis: 'srd5.1-2014',
    position: { x: '450', y: '450', elevation: '0' }, socialMechanics: { abilityScores: stats, proficiencyBonus: 2, skillModifiers: { insight: 4 },
      initialTrust: 0, authorityModifier: 0, stakesSensitivity: 1, maximumInfluenceDegree: 'fullSuccess' },
    mechanicalTemplate: { schema: 'zhuwei.npc-mechanical-template/v1', label: '老船工机制',
      stats: Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, String(value)])), proficiencyBonus: '2', armorClass: '11',
      armorClassModel: { kind: 'higherOfBaseAndEquipment', baseArmorClass: '11', shieldBonus: '0' }, hitPointsMaximum: '12',
      footprint: { width: '60', depth: '60', height: '60' }, speedInches: { walk: '300', swim: '360' }, resourceMaximums: {},
      deathPolicy: 'defeatedAtZero', intrinsicAbilityRefs: [], itemDefinitionRefs: [], initialLoadout: { entries: [] } } };
  const refs = [ACTOR, SCENE, BASIS, `character-timeline:${ACTOR}`, ...f.input.plan.authorizationRefs].sort();
  const plan = { schema: NPC_MATERIALIZATION_PLAN_SCHEMA, contextHash: f.input.plan.contextHash, prospectiveRef: NPC, sceneRef: SCENE,
    source, basisRefs: [BASIS, SCENE], authorizationRefs: f.input.plan.authorizationRefs,
    readSet: refs.map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(f.state, ref) })), visibilityPolicyRef: 'visibility:scene-observers' };
  applyNpcMaterializedEvent(f.state, { eventType: 'NpcMaterialized', rootActionId: f.input.rootActionId, profiles: f.profiles,
    roomId: f.state.roomId, runtimeEpochId: f.state.runtimeEpochId, branchId: f.state.activeBranchId,
    fictionTimelineId: characterTimelineId(f.state, ACTOR), fictionInstantMicros: '100', visibilityPolicyId: 'visibility:room-authority-only',
    secrecy: 'internal', payload: { actorCharacterId: ACTOR, plan } });
  return refresh(f);
}

test('existing NPC acquires later knowledge of an older fact with distinct occurrence and acquisition', () => {
  const f = fixture('existing'), result = prepared(f), staged = stagedFixture(f, result);
  assert.equal(isStoryFactsAdmissionPlan(f.input.plan), true);
  assert.equal(result.drafts.length, 3);
  const fact = result.drafts[0].payload.fact;
  assert.equal(isStoryFactBody(fact.value), true);
  assert.equal(fact.value.candidate.occurrence.start.micros, '20');
  assert.equal(Object.hasOwn(fact.value.candidate, 'knowledge'), false);
  assert.doesNotMatch(JSON.stringify(fact.value), /PRIVATE_KNOWLEDGE/);
  const knowledge = staged.knowledgePayloads[0];
  assert.equal(isStoryKnowledgeBody(knowledge.content), true);
  assert.equal(isStoryKnowledgeAdmissionMetadata(knowledge.storyAdmission), true);
  assert.equal(knowledge.storyAdmission.acquisition.start.micros, '80');
  assert.equal(staged.state.knowledge[NPC][knowledge.knowledgeRef].acquiredAtFictionMicros, '100');
  assert.equal(storyAdmissionEvidenceIssue(staged.state, staged.evidence[0], f.input.rootActionId), undefined);
});

test('NPC created by the ordinary prior materialization helper enters historical facts through the same plan', () => {
  const f = createNpcPrefix(fixture('new-npc', { npc: false }));
  assert.deepEqual(f.state.knowledge[NPC], {});
  assert.equal(f.state.characterControls[NPC], undefined);
  const result = prepared(f), staged = stagedFixture(f, result);
  assert.equal(result.drafts[1].payload.characterId, NPC);
  assert.equal(storyAdmissionEvidenceIssue(staged.state, staged.evidence[0], f.input.rootActionId), undefined);
  assert.deepEqual(f.state.knowledge[NPC], {}, 'preparation itself grants nothing');
});

test('statement and misbelief stay source claims and cannot become canonical truth', () => {
  const f = fixture('misbelief'), fact = f.input.plan.facts[0];
  fact.layer = 'statement'; fact.content = '船工听说铅封是城卫所打开的。';
  fact.knowledge[0].layer = 'sourceClaim'; fact.knowledge[0].content = '误以为城卫打开了铅封。';
  const before = clone(f.state.canonicalFacts), result = prepared(f), staged = stagedFixture(f, result);
  assert.equal(result.drafts[0].payload.fact.value.candidate.layer, 'statement');
  assert.equal(result.drafts[1].payload.objectKind, 'sourceClaim');
  assert.deepEqual(f.state.canonicalFacts, before);
  assert.equal(storyAdmissionEvidenceIssue(staged.state, staged.evidence[0], f.input.rootActionId), undefined);
  fact.knowledge[0].layer = 'truth';
  rejected(f, f.input, /cannot-be-promoted-to-truth/);
});

test('inference needs the same holder own prior evidence and preserves its layer', () => {
  const f = fixture('inference'), timeline = characterTimelineId(f.state, NPC), prior = 'knowledge:heard-report';
  f.state.knowledge[NPC][prior] = { characterId: NPC, knowledgeRef: prior, objectKind: 'sourceClaim', layer: 'full',
    content: 'PRIVATE_PRIOR_REPORT', visibility: 'private', acquiredByEventId: 'event:prior', acquiredAtFictionMicros: '10',
    sourceCharacterId: null, provenanceChain: ['fact:prior'] };
  const candidate = f.input.plan.facts[0].knowledge[0];
  candidate.layer = 'inference'; candidate.sourceRef = `knowledge:${NPC}:${prior}`;
  candidate.acquisition = at(timeline, '100', [candidate.sourceRef]);
  refresh(f);
  const result = prepared(f), staged = stagedFixture(f, result);
  assert.equal(result.drafts[1].payload.objectKind, 'characterInference');
  assert.equal(storyAdmissionEvidenceIssue(staged.state, staged.evidence[0], f.input.rootActionId), undefined);
  candidate.layer = 'truth'; rejected(f, f.input, /cannot-be-promoted-to-truth/);
});

test('sensory evidence and a dependent inference use ordered knowledge events without changing the reviewed order', () => {
  const f = fixture('ordered-knowledge'), first = f.input.plan.facts[0], second = clone(first);
  first.knowledge[0].layer = 'sensoryEvidence';
  second.ref = 'candidate:second-observation'; second.content = '巡检簿留下了新的空页。';
  second.knowledge[0] = { ...second.knowledge[0], ref: 'candidate:boatman-inference', factRef: second.ref,
    sourceRef: first.knowledge[0].ref, layer: 'inference', content: '船工推测有人故意隐去巡检记录。',
    acquisition: at(first.occurrence.start.timelineId, '90', [first.knowledge[0].ref]) };
  f.input.plan.facts = [second, first]; refresh(f);
  const result = prepared(f), staged = stagedFixture(f, result);
  const ordered = result.drafts.filter(draft => draft.eventType === 'KnowledgeAcquired');
  assert.deepEqual(ordered.map(draft => draft.payload.objectKind), ['sensoryEvidence', 'characterInference']);
  for (const evidence of staged.evidence) assert.equal(storyAdmissionEvidenceIssue(staged.state, evidence, f.input.rootActionId), undefined);
});

test('future, unresolved, wrong-timeline and unavailable sources reject before generating events', () => {
  for (const [label, mutate, expected] of [
    ['future-fact', f => { f.input.plan.facts[0].occurrence.start.micros = '101'; }, /future-or-unresolved-occurrence/],
    ['future-knowing', f => { f.input.plan.facts[0].knowledge[0].acquisition.start.micros = '101'; }, /future-or-unresolved-acquisition/],
    ['before-fact', f => { f.input.plan.facts[0].knowledge[0].acquisition.start.micros = '10'; }, /future-or-unresolved-acquisition/],
    ['unknown-source', f => { f.input.plan.facts[0].knowledge[0].sourceRef = 'fact:not-authoritative'; }, /knowledge-source-time-unproven/],
    ['other-timeline', f => { f.input.plan.facts[0].knowledge[0].acquisition.start.timelineId = 'timeline:unavailable'; }, /future-or-unresolved-acquisition/],
    ['absent-player', f => { f.input.plan.facts[0].knowledge[0].holderRef = 'character:future-player'; }, /new-knowledge-or-holder-required/],
  ]) { const f = fixture(label); mutate(f); refresh(f); rejected(f, f.input, expected); }
});

test('true typed explicit unknown boundaries reject past knowledge while later acquisition remains legal', () => {
  const f = fixture('unknown-boundary'), boundaryRef = 'fact:typed-unknown', factRef = storyFactAdmissionRef(f.input.plan.preparationHash, LOCAL_FACT);
  const unknownThrough = { timelineId: characterTimelineId(f.state, NPC), micros: '85' };
  f.state.canonicalFacts[boundaryRef] = { id: boundaryRef, kind: 'knowledgeBoundary', subjectRefs: [NPC], source: 'moduleAnchor',
    branchId: f.state.activeBranchId, validFromEventSeq: '0', causalParentIds: [], visibilityPolicyId: 'visibility:kp-internal',
    value: { schema: 'zhuwei.knowledge-boundary/v1', holderRef: NPC, factRef, unknownThrough } };
  f.input.plan.knowledgeBoundaries = [{ holderRef: NPC, knowledgeCandidateRef: LOCAL_KNOWLEDGE, basisRef: boundaryRef, unknownThrough }];
  refresh(f); rejected(f, f.input, /explicit-unknown-boundary-conflict/);
  f.input.plan.facts[0].knowledge[0].acquisition.start.micros = '90';
  const result = prepared(f), staged = stagedFixture(f, result);
  assert.equal(storyAdmissionEvidenceIssue(staged.state, staged.evidence[0], f.input.rootActionId), undefined);
  f.input.plan.knowledgeBoundaries = []; rejected(f, f.input, /typed-unknown-boundary-omitted/);
});

test('new player identity cannot backdate knowledge or copy another holder private record without transfer', () => {
  const f = fixture('no-inheritance'), candidate = f.input.plan.facts[0].knowledge[0];
  candidate.holderRef = ACTOR; refresh(f); rejected(f, f.input, /cannot-inherit-past-knowledge/);
  candidate.holderRef = NPC;
  f.state.knowledge[ACTOR]['knowledge:private'] = { characterId: ACTOR, knowledgeRef: 'knowledge:private', objectKind: 'canonicalFact', layer: 'full',
    content: 'OTHER_PLAYER_PRIVATE_CANARY', visibility: 'private', acquiredByEventId: 'event:prior', acquiredAtFictionMicros: '0', sourceCharacterId: null, provenanceChain: [] };
  candidate.sourceRef = `knowledge:${ACTOR}:knowledge:private`;
  candidate.acquisition = at(characterTimelineId(f.state, NPC), '100', [candidate.sourceRef]);
  refresh(f); rejected(f, f.input, /foreign-knowledge-needs-an-established-transfer/);
  const channelRef = 'fact:boatman-channel';
  f.state.canonicalFacts[channelRef] = { id: channelRef, kind: 'sharedParticipation', value: {}, subjectRefs: [ACTOR, NPC],
    branchId: f.state.activeBranchId, validFromEventSeq: '0', source: 'moduleAnchor', causalParentIds: [], visibilityPolicyId: 'visibility:kp-internal' };
  candidate.acquisition.basisRefs.push(channelRef);
  refresh(f); rejected(f, f.input, /foreign-knowledge-needs-an-established-transfer/);
  f.state.canonicalFacts[channelRef].kind = 'establishedCommunicationChannel';
  refresh(f);
  const staged = stagedFixture(f);
  assert.equal(storyAdmissionEvidenceIssue(staged.state, staged.evidence[0], f.input.rootActionId), undefined);
});

test('an existing source claim retains its claim layer and uses the normal continuity read binding', () => {
  const f = fixture('held-claim'), claimRef = 'claim:boatman-heard';
  f.state.campaignRuntime.sourceClaims[claimRef] = { speakerId: NPC, content: '城卫可能动过铅封。' };
  const candidate = f.input.plan.facts[0].knowledge[0];
  candidate.layer = 'sourceClaim'; candidate.sourceRef = claimRef;
  candidate.acquisition = at(characterTimelineId(f.state, NPC), '100', [claimRef, NPC]);
  refresh(f, [`continuity:sourceClaims:${claimRef}`]);
  const staged = stagedFixture(f);
  assert.equal(staged.knowledgePayloads[0].objectKind, 'sourceClaim');
  assert.equal(storyAdmissionEvidenceIssue(staged.state, staged.evidence[0], f.input.rootActionId), undefined);
  candidate.layer = 'truth'; rejected(f, f.input, /cannot-be-promoted-to-truth/);
});

test('frozen reads, chosen identity and complete knower commitment are checked again for replay', () => {
  const f = fixture('bindings'), result = prepared(f), staged = stagedFixture(f, result);
  const source = clone(f.input); source.plan.readSet[0].revisionOrHash = canonicalSha256('changed');
  rejected(f, source, /frozen-reads-changed/);
  const overwritten = clone(f.input); overwritten.plan.bindings[0].authorityRef = BASIS;
  rejected(f, overwritten, /new-fact-identity-required/);
  const wrongRole = clone(f.input); wrongRole.plan.bindings[0].kind = 'source';
  rejected(f, wrongRole, /new-fact-identity-required/);
  const lost = clone(staged.evidence[0]); lost.knowledge = [];
  assert.match(storyAdmissionEvidenceIssue(staged.state, lost, f.input.rootActionId), /incomplete-reviewed-knowledge/);
  assert.match(storyAdmissionEvidenceIssue(staged.state, staged.evidence[0], 'root:other'), /evidence-fact-binding-invalid/);
  const wrongHolder = clone(result.drafts[1].payload); wrongHolder.characterId = ACTOR;
  assert.match(storyKnowledgeAdmissionIssue(staged.state, wrongHolder, f.input.rootActionId), /knowledge-binding-invalid/);
  const wrongSource = clone(result.drafts[1].payload); wrongSource.storyAdmission.sourceRef = ACTOR;
  assert.match(storyKnowledgeAdmissionIssue(staged.state, wrongSource, f.input.rootActionId), /knowledge-binding-invalid/);
  assert.deepEqual(prepareStoryFactsAdmission(JSON.parse(JSON.stringify(f.state)), JSON.parse(JSON.stringify(f.input))), result);
  assert.match(prepareStoryFactsAdmission(staged.state, f.input).rejection.message, /new-fact-identity-required|frozen-reads-changed/);
});

test('timeline remapping touches only typed retained fact and holder knowledge, with no future knower list', () => {
  const f = fixture('remap'), result = prepared(f), oldTimeline = characterTimelineId(f.state, ACTOR), nextTimeline = 'timeline:new-branch';
  for (const body of [result.drafts[0].payload.fact.value, result.drafts[1].payload.content]) {
    const remapped = remapStoryTemporalContent(body, new Map([[oldTimeline, nextTimeline]]));
    assert.equal(remapped.kind, 'remapped');
    const temporal = remapped.value.candidate.occurrence ?? remapped.value.candidate.acquisition;
    assert.equal(temporal.start.timelineId, nextTimeline);
    assert.equal(remapped.value.candidate.content, body.candidate.content);
    assert.equal(remapped.value.preparationHash, body.preparationHash);
    assert.equal(remapStoryTemporalContent(body, new Map()).kind, 'rejected');
  }
  const unknown = { occurrence: { start: { timelineId: oldTimeline } }, prose: oldTimeline };
  assert.deepEqual(remapStoryTemporalContent(unknown, new Map([[oldTimeline, nextTimeline]])), { kind: 'unchanged', value: unknown });
  const boundary = { schema: 'zhuwei.knowledge-boundary/v1', holderRef: NPC, factRef: LOCAL_FACT,
    unknownThrough: { timelineId: oldTimeline, micros: '60' } };
  assert.equal(remapStoryTemporalContent(boundary, new Map([[oldTimeline, nextTimeline]])).value.unknownThrough.timelineId, nextTimeline);
  assert.equal(Object.hasOwn(result.drafts[0].payload.fact.value.candidate, 'knowledge'), false);
});

test('authority port failure after a real first fact event cannot partially publish the admission', () => {
  const f = fixture('atomic-failure'), accumulator = { state: f.state, events: [], transactionReads: new Set(),
    transactionWrites: new Set(), transactionCreates: new Set(), transactionCreatedAuthorityRefs: new Set() };
  let calls = 0;
  const result = stepAdmitStoryFacts(f.profiles, f.state, f.input, { accumulator,
    appendTransition(current, profiles, rootActionId, draft) {
      calls += 1;
      if (draft.eventType === 'KnowledgeAcquired') throw new Error('injected authority writer failure');
      const scopeProof = createScopeProof(current.state, draft.reads, draft.writes, draft.creates);
      const next = createEventTransition(current.state, profiles, { rootActionId, eventType: draft.eventType,
        payload: draft.payload, scopeProof, visibilityPolicyId: draft.visibilityPolicyId, secrecy: draft.secrecy });
      current.state = next.state; current.events.push(next.event); current.scopeProof = scopeProof;
    } });
  assert.equal(calls, 2);
  assert.equal(result.kind, 'rejected');
  assert.deepEqual(accumulator.events, []);
  assert.equal(accumulator.state, f.state);
  assert.deepEqual([...accumulator.transactionCreatedAuthorityRefs], []);
  const duplicate = clone(f.state); duplicate.receipts[f.input.rootActionId] = {};
  assert.equal(stepAdmitStoryFacts(f.profiles, duplicate, f.input).rejection.code, 'duplicateRootAction');
});
