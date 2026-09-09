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
  stepAdmitStoryFacts, remapStoryTemporalContent, resolveStoryAdmissionTime } from '../app/_runtime/lib/rules/v2/story-facts-admission.ts';
import { NPC_MATERIALIZATION_PLAN_SCHEMA, applyNpcMaterializedEvent, npcMaterializationEntityRef } from '../app/_runtime/lib/rules/v2/npc-materialization.ts';
import { normalizedProspectiveRef } from '../app/_runtime/lib/rules/v2/semantic-definitions.ts';
import { buildAuthoritativeArchive } from '../app/_runtime/lib/room/archive.ts';
import { isAtomicWorldInteractionStepsPlan } from '../app/_runtime/lib/rules/v2/world-interaction-model.ts';

const NPC = 'npc:boatman', LOCAL_FACT = 'candidate:broken-seal', LOCAL_KNOWLEDGE = 'candidate:boatman-knows';
const ORIGIN_SCENE = 'scene:story-origin';
const clone = structuredClone;
function at(timelineId, micros, basisRefs = [SCENE]) { return { kind: 'at', start: { timelineId, micros }, end: null, basisRefs }; }
function fixture(name, { npc = true, historyOrigin = false } = {}) {
  const f = createAuthoredProbeFixture(`story-facts:${name}`, { npcCharacters: [
    ...(npc ? [{ id: NPC, name: '老船工' }] : []), ...(historyOrigin ? [{ id: 'npc:origin-resident', name: '当地居民' }] : [])],
    ...(historyOrigin ? { characterScenes: { 'npc:origin-resident': ORIGIN_SCENE }, additionalScenes: [{ id: ORIGIN_SCENE, name: '邻近街区',
      geometry: { schema: 'zhuwei.tactical-geometry/v1', unit: 'inch', boundary: { kind: 'polygon',
        points: [{ x: '0', y: '0' }, { x: '600', y: '0' }, { x: '600', y: '600' }, { x: '0', y: '600' }] },
        spawnPoints: [{ x: '100', y: '100', elevation: '0' }, { x: '250', y: '100', elevation: '0' }],
        obstacles: [{ featureId: 'feature:origin-bench', kind: 'interactable', label: '街角长凳', state: 'present',
          polygon: [{ x: '450', y: '450' }, { x: '480', y: '450' }, { x: '480', y: '480' }, { x: '450', y: '480' }],
          elevation: '0', height: '20', opaque: false, impassable: false, cover: 'none', propagation: 'passes',
          visibilityPolicyId: 'visibility:scene-observers' }], clearanceZones: [] } }] } : {}) });
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
function npcCreationInput(f) {
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
  return { kind: 'materializeNpc', rootActionId: f.input.rootActionId, actorCharacterId: ACTOR, plan };
}
function createNpcPrefix(f) {
  const input = npcCreationInput(f);
  applyNpcMaterializedEvent(f.state, { eventType: 'NpcMaterialized', rootActionId: f.input.rootActionId, profiles: f.profiles,
    roomId: f.state.roomId, runtimeEpochId: f.state.runtimeEpochId, branchId: f.state.activeBranchId,
    fictionTimelineId: characterTimelineId(f.state, ACTOR), fictionInstantMicros: '100', visibilityPolicyId: 'visibility:room-authority-only',
    secrecy: 'internal', payload: { actorCharacterId: ACTOR, plan: input.plan } });
  return refresh(f);
}

function publicFixture(name, options) {
  const f = fixture(name, options);
  f.state = f.runtime.replay(f.genesis, []).state;
  f.events = [];
  f.run = input => {
    const result = f.runtime.step(f.profiles, f.state, input);
    assert.equal(result.kind, 'committed', JSON.stringify(result));
    f.events.push(...result.events);
    const replayed = f.runtime.replay(f.genesis, f.events);
    assert.equal(replayed.kind, 'replayed', JSON.stringify(replayed));
    assert.deepEqual(replayed.state, result.state);
    f.state = replayed.state;
    return result;
  };
  f.advance = (micros, suffix) => f.run({ kind: 'resolveFreeAction', proposalId: `${f.rootActionId}:${suffix}`,
    characterId: ACTOR, goal: '整理已有档案', method: '依次核对文书',
    feasibility: { kind: 'directSuccess', publicBasis: '可以直接完成整理。' }, outcome: { fictionTimeCostMicros: micros } });
  f.advance('100', 'elapsed');
  return refresh(f);
}
function atomicInput(f, { createNpc = false } = {}) {
  const bundleHash = canonicalSha256(f.input.plan);
  const child = { formId: 'materialization.vnext-1', proposalRef: f.input.plan.proposalRef, ruling: 'directSuccess',
    rulesInput: clone(f.input), dependsOn: [], consumes: [], produces: [], outcomeBinding: 'always' };
  const steps = [child];
  if (createNpc) {
    const npcRef = npcMaterializationEntityRef(normalizedProspectiveRef(f.input.rootActionId, bundleHash, 'prospective:boatman'));
    child.rulesInput.plan.bindings.push({ ref: NPC, authorityRef: npcRef, kind: 'entity' });
    const knowledge = child.rulesInput.plan.bindings.find(binding => binding.ref === LOCAL_KNOWLEDGE);
    knowledge.authorityRef = storyKnowledgeAdmissionRef(f.input.plan.preparationHash, LOCAL_KNOWLEDGE, npcRef);
    child.dependsOn = ['proposal:create-boatman']; child.consumes = [{ kind: 'prospective', handle: 'prospective:boatman' }];
    const producer = npcCreationInput(f);
    producer.plan.prospectiveRef = npcRef;
    steps.unshift({ formId: 'materialization.vnext-1', proposalRef: 'proposal:create-boatman', ruling: 'directSuccess',
      rulesInput: producer, dependsOn: [], consumes: [],
      produces: [{ handle: 'prospective:boatman', kind: 'entity', outcomeBinding: 'always' }], outcomeBinding: 'always' });
  }
  return { kind: 'applyAtomicWorldInteractionSteps', rootActionId: f.input.rootActionId, actorCharacterId: ACTOR,
    bundleHash, contextHash: f.input.plan.contextHash, sharedRuling: 'directSuccess', steps };
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
  candidate.sourceRef = `continuity:sourceClaims:${claimRef}`;
  candidate.acquisition.basisRefs = [candidate.sourceRef, NPC];
  refresh(f);
  const qualified = stagedFixture(f);
  assert.equal(storyAdmissionEvidenceIssue(qualified.state, qualified.evidence[0], f.input.rootActionId), undefined);
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
    assert.equal(resolveStoryAdmissionTime(temporal, remapped.value.bindings).start.timelineId, nextTimeline);
    assert.deepEqual(remapped.value.candidate, body.candidate);
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

test('public Rules admission writes normal private knowledge, exact replay and a single duplicate-protected Receipt', () => {
  const f = publicFixture('public'), before = clone(f.state), result = f.run(f.input);
  assert.deepEqual(result.events.map(event => event.eventType), ['CanonicalFactDeclared', 'KnowledgeAcquired', 'CanonicalFactDeclared']);
  const event = result.events[1], payload = event.payload, held = f.state.knowledge[NPC][payload.knowledgeRef];
  assert.equal(held.acquiredByEventId, event.eventId);
  assert.equal(held.acquiredAtFictionMicros, '100');
  assert.equal(held.content.candidate.acquisition.start.micros, '80');
  assert.ok(held.provenanceChain.includes(payload.storyAdmission.sourceRef));
  assert.ok(held.provenanceChain.includes(payload.causeFactId));
  assert.equal(result.receipt.rootActionId, f.input.rootActionId);
  assert.deepEqual(before.knowledge[NPC], {});
  const other = f.runtime.project(f.profiles, f.state, f.viewer);
  assert.equal(other.kind, 'projected'); assert.doesNotMatch(JSON.stringify(other), /PRIVATE_KNOWLEDGE/);
  const npc = f.runtime.project(f.profiles, f.state, { kind: 'npc', npcId: NPC, purpose: 'kpDecision', capability: 'internal:npc-limited-knowledge' });
  assert.equal(npc.kind, 'projected'); assert.match(JSON.stringify(npc), /PRIVATE_KNOWLEDGE/);
  const duplicate = f.runtime.step(f.profiles, f.state, f.input);
  assert.equal(duplicate.kind, 'rejected'); assert.equal(duplicate.rejection.code, 'duplicateRootAction');
  assert.deepEqual(duplicate.events, []);
});

test('public atomic admission binds a real new NPC producer without fictional initial revisions', () => {
  const f = publicFixture('public-new-npc', { npc: false }), input = atomicInput(f, { createNpc: true });
  const originalCandidates = clone(input.steps[1].rulesInput.plan.facts);
  const { kind: _kind, ...plan } = input;
  assert.equal(isAtomicWorldInteractionStepsPlan({ ...plan, schema: 'zhuwei.atomic-world-interaction-steps-plan/v1' }), true);
  assert.equal(input.steps[1].rulesInput.plan.readSet.some(binding => binding.ref === NPC), false);
  const result = f.run(input);
  const npcRef = input.steps[0].rulesInput.plan.prospectiveRef;
  assert.equal(result.events[0].eventType, 'NpcMaterialized');
  assert.ok(result.events.some(event => event.eventType === 'KnowledgeAcquired'));
  assert.equal(result.events.at(-1).eventType, 'AtomicWorldInteractionStepsResolved');
  assert.equal(f.state.entities[npcRef].name, '新入场的老船工');
  assert.equal(f.state.characterControls[npcRef], undefined);
  const knowledgeRef = storyKnowledgeAdmissionRef(f.input.plan.preparationHash, LOCAL_KNOWLEDGE, npcRef);
  assert.equal(f.state.knowledge[npcRef][knowledgeRef].content.candidate.ref, LOCAL_KNOWLEDGE);
  assert.deepEqual(input.steps[1].rulesInput.plan.facts, originalCandidates);
});

test('atomic failure after the NPC prefix publishes no NPC, fact, knowledge or Receipt', () => {
  const f = publicFixture('public-rollback', { npc: false }), input = atomicInput(f, { createNpc: true }), before = clone(f.state);
  input.steps[1].rulesInput.plan.facts[0].knowledge[0].sourceRef = 'fact:missing-source';
  const result = f.runtime.step(f.profiles, f.state, input);
  assert.equal(result.kind, 'rejected'); assert.match(result.rejection.message, /knowledge-source-time-unproven/);
  assert.deepEqual(result.events, []); assert.deepEqual(f.state, before);
  assert.equal(f.state.entities[input.steps[0].rulesInput.plan.prospectiveRef], undefined); assert.equal(f.state.receipts[input.rootActionId], undefined);
  const forged = atomicInput(f, { createNpc: true });
  forged.steps[1].rulesInput.plan.readSet.push({ ref: forged.steps[0].rulesInput.plan.prospectiveRef, revisionOrHash: canonicalSha256('fictional revision') });
  forged.steps[1].rulesInput.plan.readSet.sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
  const rejected = f.runtime.step(f.profiles, f.state, forged);
  assert.equal(rejected.kind, 'rejected'); assert.match(rejected.rejection.message, /initial read-set member/);
  const missing = atomicInput(f, { createNpc: true }); missing.steps[1].consumes = []; missing.steps[1].dependsOn = [];
  assert.match(f.runtime.step(f.profiles, f.state, missing).rejection.message, /consume-their-real-producers/);
});

test('normal event reducers reject altered story knowledge, public visibility and incomplete temporal evidence', () => {
  const f = publicFixture('event-gates'), result = prepared(f);
  const first = result.drafts[0], fact = createEventTransition(f.state, f.profiles, { rootActionId: f.input.rootActionId,
    eventType: first.eventType, payload: first.payload, scopeProof: createScopeProof(f.state, first.reads, first.writes, first.creates),
    secrecy: first.secrecy, visibilityPolicyId: first.visibilityPolicyId });
  const knowledge = result.drafts[1];
  for (const mutate of [p => { delete p.storyAdmission; }, p => { p.storyAdmission.sourceRef = ACTOR; },
    p => { p.content.candidate.holderRef = ACTOR; }]) {
    const payload = clone(knowledge.payload); mutate(payload);
    assert.throws(() => createEventTransition(fact.state, f.profiles, { rootActionId: f.input.rootActionId,
      eventType: 'KnowledgeAcquired', payload, scopeProof: createScopeProof(fact.state, knowledge.reads, knowledge.writes, knowledge.creates),
      secrecy: 'private', visibilityPolicyId: knowledge.visibilityPolicyId }), /story-admission:/);
  }
  assert.throws(() => createEventTransition(fact.state, f.profiles, { rootActionId: f.input.rootActionId,
    eventType: 'KnowledgeAcquired', payload: knowledge.payload,
    scopeProof: createScopeProof(fact.state, knowledge.reads, knowledge.writes, knowledge.creates),
    secrecy: 'public', visibilityPolicyId: 'visibility:public' }), /story-admission:/);
  const evidence = clone(result.drafts[2]); evidence.payload.fact.value.knowledge = [];
  assert.throws(() => createEventTransition(fact.state, f.profiles, { rootActionId: f.input.rootActionId,
    eventType: evidence.eventType, payload: evidence.payload,
    scopeProof: createScopeProof(fact.state, evidence.reads, evidence.writes, evidence.creates),
    secrecy: evidence.secrecy, visibilityPolicyId: evidence.visibilityPolicyId }), /incomplete-reviewed-knowledge/);
});

test('historical public initializer remaps all typed retained bodies and excludes a future knower', async () => {
  for (const mode of ['late-supplement', 'already-at-cut']) {
    const f = publicFixture(`historical-${mode}`, { historyOrigin: true });
    let cut = f.state.version;
    if (mode === 'late-supplement') {
      f.advance('100', 'future');
      f.input.plan.facts[0].knowledge.push({ ref: 'candidate:future-player', holderRef: ACTOR, factRef: LOCAL_FACT,
        layer: 'sensoryEvidence', content: 'FUTURE_PLAYER_CANARY', sourceRef: LOCAL_FACT,
        acquisition: at(characterTimelineId(f.state, ACTOR), '200', [ACTOR, LOCAL_FACT]), explanation: '当天下午看到现场。' });
      refresh(f);
    }
    f.run(f.input);
    if (mode === 'already-at-cut') cut = f.state.version;
    const source = clone(f.state);
    const archive = await buildAuthoritativeArchive({ roomId: f.state.roomId, signedGenesis: f.genesis,
      events: f.events, receiptRefs: [], projectionAudits: [] }, f.runtime.replay);
    const targetId = `character:fresh:${mode}`;
    const result = f.runtime.step(undefined, undefined, { kind: 'initializeHistoricalWorld', schema: 'zhuwei.historical-world-initialization/v1',
      roomId: `room:new:${mode}`, runtimeEpochId: `epoch:new:${mode}`, activeBranchId: `branch:new:${mode}`, sourceArchive: archive,
      cut: { eventSeq: cut, focusSceneId: ORIGIN_SCENE }, identity: { principal: { id: 'principal:fresh', sessionVersion: 1 },
        seatId: 'seat:fresh', character: { id: targetId, kind: 'player', name: '当地医师', sceneId: ORIGIN_SCENE, tenureStatus: 'active' }, originBasisRefs: [BASIS] } });
    assert.equal(result.kind, 'initialized', JSON.stringify(result));
    const target = result.genesis.initialState, targetTimeline = characterTimelineId(target, NPC);
    const factRef = storyFactAdmissionRef(f.input.plan.preparationHash, LOCAL_FACT), knowledgeRef = storyKnowledgeAdmissionRef(f.input.plan.preparationHash, LOCAL_KNOWLEDGE, NPC);
    const factBody = target.canonicalFacts[factRef].value, knowledgeBody = target.knowledge[NPC][knowledgeRef].content;
    assert.equal(resolveStoryAdmissionTime(factBody.candidate.occurrence, factBody.bindings).start.timelineId, targetTimeline);
    assert.equal(resolveStoryAdmissionTime(knowledgeBody.candidate.acquisition, knowledgeBody.bindings).start.timelineId, targetTimeline);
    assert.deepEqual(factBody.candidate, source.canonicalFacts[factRef].value.candidate);
    assert.deepEqual(knowledgeBody.candidate, source.knowledge[NPC][knowledgeRef].content.candidate);
    assert.equal(target.canonicalFacts[factRef].value.preparationHash, f.input.plan.preparationHash);
    assert.equal(Object.hasOwn(target.canonicalFacts[factRef].value.candidate, 'knowledge'), false);
    assert.deepEqual(target.knowledge[targetId], {});
    assert.doesNotMatch(JSON.stringify(target), /FUTURE_PLAYER_CANARY/);
    assert.equal(result.genesis.historicalOrigin.supplements.length, mode === 'late-supplement' ? 1 : 0);
    assert.equal(f.runtime.replay(result.genesis, []).kind, 'replayed');
    assert.deepEqual(f.state, source);
  }
});
