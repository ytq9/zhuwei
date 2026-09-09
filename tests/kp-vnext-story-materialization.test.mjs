import assert from 'node:assert/strict';
import test from 'node:test';
import { createStoryMaterializationFixture, bundle, factSelector, npcSelector, npcStorySource, BOATMAN, CLERK, NEW_NPC, FACT, KNOWLEDGE } from './fixtures/kp-vnext-story-materialization.mjs';
import { encodeVNextStrictToolBundle, decodeVNextStoryDefinitionSteps } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { roomStoryCapabilityDescriptions } from '../app/_runtime/lib/room/story-action-request.ts';
import { matchesAuthoredSourceSchema } from '../app/_runtime/lib/rules/v2/authored-materialization.ts';
import { storyFactAdmissionRef, storyKnowledgeAdmissionRef } from '../app/_runtime/lib/rules/v2/story-facts-admission.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';

function lower(f, value) {
  const wire = encodeVNextStrictToolBundle(value);
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wire));
  assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
  return lowerVNext2ProposalBundle({ ...f, value: parsed.bundle });
}
function refPaths(value, path = []) {
  if (Array.isArray(value)) return value.flatMap((entry, i) => refPaths(entry, [...path, i]));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, entry]) => key === '$ref' ? [[...path, key]] : refPaths(entry, [...path, key]));
}

test('production capability payload contracts are self-contained', () => {
  const descriptions = roomStoryCapabilityDescriptions();
  assert.ok(descriptions.some(value => value.capability === 'materializeNpc'));
  for (const description of descriptions) {
    assert.deepEqual(refPaths(description.schema), [], description.capability);
    assert.equal(description.schema.additionalProperties, false);
    assert.deepEqual(description.schema.required, ['steps']);
    assert.equal(description.schema.properties.steps.minItems, 1);
    assert.equal(description.schema.properties.steps.maxItems, 1);
  }
});

test('existing NPC facts and knowledge cross real preparation, wire parser, lowering, Rules and replay', async () => {
  const f = await createStoryMaterializationFixture('existing');
  assert.deepEqual(f.invocations.map(request => request.stage), ['draft', 'review']);
  const before = structuredClone(f.state), lowered = lower(f, bundle([factSelector(f)]));
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  const result = f.run(lowered.command.rulesInput);
  const factRef = storyFactAdmissionRef(f.preparationHash, FACT), knowledgeRef = storyKnowledgeAdmissionRef(f.preparationHash, KNOWLEDGE, BOATMAN);
  assert.equal(f.state.entities[BOATMAN].id, before.entities[BOATMAN].id);
  assert.equal(f.state.entities[BOATMAN].name, before.entities[BOATMAN].name);
  assert.equal(f.state.canonicalFacts[factRef].value.candidate.content, f.preparation.facts[0].content);
  assert.equal(f.state.knowledge[BOATMAN][knowledgeRef].content.candidate.content, f.preparation.facts[0].knowledge[0].content);
  assert.equal(f.state.knowledge[CLERK][knowledgeRef], undefined);
  assert.ok(result.events.some(event => event.eventType === 'KnowledgeAcquired'));
  const publicView = f.runtime.project(f.profiles, f.state, f.viewer);
  assert.equal(publicView.kind, 'projected'); assert.doesNotMatch(JSON.stringify(publicView), /NPC_PRIVATE_STORY_KNOWLEDGE/);
  const npcView = f.runtime.project(f.profiles, f.state,
    { kind: 'npc', npcId: BOATMAN, purpose: 'kpDecision', capability: 'internal:npc-limited-knowledge' });
  assert.equal(npcView.kind, 'projected'); assert.match(JSON.stringify(npcView), /NPC_PRIVATE_STORY_KNOWLEDGE/);
});

test('materializeStory selects the exact prepared NPC producer and admits its facts and knowledge in the same Rules action', async () => {
  const f = await createStoryMaterializationFixture('new-npc', { newNpc: true });
  const candidate = f.preparation.definitions.find(value => value.ref === NEW_NPC);
  const capability = f.capabilityDescriptions.find(value => value.capability === candidate.capability), diagnostics = [];
  assert.equal(matchesAuthoredSourceSchema(candidate.payload, capability.schema, diagnostics), true, JSON.stringify(diagnostics));
  const [decoded] = decodeVNextStoryDefinitionSteps(candidate.payload.steps);
  assert.equal(decoded.kind, 'materializeNpc'); assert.deepEqual(decoded.source, npcStorySource());
  const before = structuredClone(f.state), original = structuredClone(f.preparation);
  const lowered = lower(f, bundle([npcSelector(f), factSelector(f)]));
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  // A malformed downstream admission must not publish its valid NPC prefix.
  const invalid = structuredClone(lowered.command.rulesInput);
  invalid.steps.find(step => step.rulesInput.kind === 'admitStoryFacts').rulesInput.plan.facts[0].knowledge[0].sourceRef = 'fact:missing-source';
  const refused = f.runtime.step(f.profiles, f.state, invalid);
  assert.equal(refused.kind, 'rejected', JSON.stringify(refused));
  assert.match(refused.rejection.message, /knowledge-source-time-unproven/);
  assert.deepEqual(refused.events, []); assert.deepEqual(f.state, before);
  const result = f.run(lowered.command.rulesInput);
  const created = result.events.find(event => event.eventType === 'NpcMaterialized');
  assert.ok(created); assert.deepEqual(created.payload.plan.source, decoded.source);
  const npcRef = created.payload.plan.prospectiveRef;
  assert.equal(before.entities[npcRef], undefined); assert.equal(f.state.entities[npcRef].name, '许录');
  assert.equal(f.state.characterControls[npcRef], undefined);
  const factRef = storyFactAdmissionRef(f.preparationHash, FACT), knowledgeRef = storyKnowledgeAdmissionRef(f.preparationHash, KNOWLEDGE, npcRef);
  assert.ok(f.state.canonicalFacts[factRef].subjectRefs.includes(npcRef));
  assert.equal(f.state.knowledge[npcRef][knowledgeRef].content.candidate.holderRef, NEW_NPC);
  assert.deepEqual(f.preparation, original);
  assert.equal(new Set(result.events.map(event => event.rootActionId)).size, 1);
  assert.equal(result.events.at(-1).eventType, 'AtomicWorldInteractionStepsResolved');
  const publicView = f.runtime.project(f.profiles, f.state, f.viewer);
  assert.equal(publicView.kind, 'projected'); assert.doesNotMatch(JSON.stringify(publicView), /NPC_PRIVATE_STORY_KNOWLEDGE/);
  const npcView = f.runtime.project(f.profiles, f.state,
    { kind: 'npc', npcId: npcRef, purpose: 'kpDecision', capability: 'internal:npc-limited-knowledge' });
  assert.equal(npcView.kind, 'projected'); assert.match(JSON.stringify(npcView), /NPC_PRIVATE_STORY_KNOWLEDGE/);
  const committed = structuredClone(f.state), committedEvents = structuredClone(f.events), invocationCount = f.invocations.length;
  const duplicate = f.runtime.step(f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(duplicate.kind, 'rejected'); assert.equal(duplicate.rejection.code, 'duplicateRootAction');
  assert.deepEqual(duplicate.events, []); assert.deepEqual(f.state, committed); assert.deepEqual(f.events, committedEvents);
  assert.equal(f.invocations.length, invocationCount);
});

test('candidate selectors reject unknown preparations, altered candidates or handles, missing material and caller-owned dependencies', async () => {
  const f = await createStoryMaterializationFixture('selectors-rejected', { newNpc: true });
  const before = structuredClone(f.state), beforeEvents = structuredClone(f.events), beforeInvocations = f.invocations.length;
  const cases = [
    ['unknown preparation', () => {
      const value = npcSelector(f); value.source.preparationHash = `sha256:${'0'.repeat(64)}`; return [value];
    }, 'story:reviewed-preparation-unavailable'],
    ['unknown definition candidate', () => {
      const value = npcSelector(f); value.source.candidateRef = 'candidate:unreviewed-npc'; return [value];
    }, 'story:definition-candidate-unavailable'],
    ['altered original handle', () => {
      const value = npcSelector(f); value.produces[0].handle = 'prospective:altered-npc'; return [value];
    }, 'story:exact-candidate-producer-required'],
    ['unknown fact candidate', () => {
      const value = factSelector(f); value.candidateRefs = ['candidate:unreviewed-fact']; return [value];
    }, 'story:fact-candidate-unavailable'],
    ['required new NPC is not selected', () => [factSelector(f)], 'story:unfrozen-candidate-reference'],
    ['caller supplies candidate dependencies', () => {
      const value = npcSelector(f); value.basisRefs = ['anchor:requisition'];
      value.consumes = [{ kind: 'existing', ref: 'anchor:requisition' }]; return [value];
    }, 'story:selector-dependencies-are-host-owned'],
    ['same candidate requested with a second handle', () => {
      const duplicate = npcSelector(f); duplicate.produces[0].handle = 'prospective:second-archivist';
      return [npcSelector(f), duplicate];
    }, 'story:exact-candidate-producer-required'],
    ['fact selection repeated in one action', () => [npcSelector(f), factSelector(f), factSelector(f)],
      'story:one-atomic-fact-selection-required'],
  ];
  for (const [label, make, issue] of cases) {
    const lowered = lower(f, bundle(make()));
    assert.equal(lowered.kind, 'rejected', `${label}: ${JSON.stringify(lowered)}`);
    assert.equal(lowered.code, 'PROPOSAL_REFERENCE_INVALID', label);
    assert.ok(lowered.issues.includes(issue), `${label}: ${JSON.stringify(lowered)}`);
    assert.deepEqual(f.state, before, label); assert.deepEqual(f.events, beforeEvents, label);
    assert.equal(f.invocations.length, beforeInvocations, label);
  }
});

test('public selector wire rejects rewriting the reviewed payload and duplicate NPC admission', async () => {
  const f = await createStoryMaterializationFixture('wire-rejected', { newNpc: true });
  const before = structuredClone(f.state), beforeEvents = structuredClone(f.events);
  const alteredNpc = encodeVNextStrictToolBundle(bundle([npcSelector(f)]));
  alteredNpc.steps[0].source.payload = { name: '未经审阅的替代人物' };
  const alteredFact = encodeVNextStrictToolBundle(bundle([factSelector(f)]));
  alteredFact.steps[0].facts = [{ ref: FACT, content: '未经审阅的替代事实' }];
  const duplicate = encodeVNextStrictToolBundle(bundle([npcSelector(f), npcSelector(f), factSelector(f)]));
  for (const [label, wire] of [['NPC payload rewrite', alteredNpc], ['fact content rewrite', alteredFact], ['duplicate NPC', duplicate]]) {
    const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wire));
    assert.notEqual(parsed.kind, 'accepted', `${label}: ${JSON.stringify(parsed)}`);
    assert.deepEqual(f.state, before, label); assert.deepEqual(f.events, beforeEvents, label);
  }
});

test('tampering with a real prepared wrapper cannot bypass exact content and independent review binding', async () => {
  const f = await createStoryMaterializationFixture('wrapper-rejected');
  const before = structuredClone(f.state), beforeEvents = structuredClone(f.events);
  const cases = [
    ['changed content under original hash', entry => { entry.value.preparation.facts[0].content += ' 未经评审改写。'; },
      'story:reviewed-preparation-unavailable'],
    ['changed content with outer wrapper rehashed', entry => {
      entry.value.preparation.facts[0].content += ' 未经评审改写。'; entry.revisionOrHash = canonicalHash(entry.value);
    }, 'story:reviewed-preparation-unavailable'],
    ['review marks a finding as failed', entry => {
      entry.value.review.findings[0].verdict = 'fail'; entry.revisionOrHash = canonicalHash(entry.value);
    }, 'story:independent-review-required'],
    ['review for another candidate', entry => {
      entry.value.review.preparationHash = `sha256:${'0'.repeat(64)}`; entry.revisionOrHash = canonicalHash(entry.value);
    }, 'story:independent-review-required'],
  ];
  for (const [label, tamper, issue] of cases) {
    const requiredContext = structuredClone(f.requiredContext);
    tamper(requiredContext.entries.find(entry => entry.entryRef === `story-preparation:${f.preparationHash}`));
    const lowered = lower({ ...f, requiredContext }, bundle([factSelector(f)]));
    assert.equal(lowered.kind, 'rejected', `${label}: ${JSON.stringify(lowered)}`);
    assert.ok(lowered.issues.includes(issue), `${label}: ${JSON.stringify(lowered)}`);
    assert.deepEqual(f.state, before, label); assert.deepEqual(f.events, beforeEvents, label);
  }
});
