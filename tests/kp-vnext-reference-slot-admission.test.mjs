import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_TARGET as TARGET, PROBE_SCENE as SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { proposalCreatureTargetRefs, proposalObservationSubjectRefs,
  proposalSubjectRefs } from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { createVNextProposalBundleSchema } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { matchesAuthoredSourceSchema } from '../app/_runtime/lib/rules/v2/authored-materialization.ts';
import { deepSeekStrictToolSchemaIssues } from '../app/_runtime/lib/kp/deepseek-strict-tool.ts';
import { expandDeepSeekSchema } from './fixtures/expand-deepseek-schema.mjs';

// Round 73 filled a creature target slot with the actor's own opening knowledge
// record. That ref is authorized, read-bound and Viewer-citable, so no basis
// rule excluded it; only the slot's object class does. These cases hold every
// world-object slot to the class its accepting validator enforces.
const KNOWLEDGE = 'wake';
function fixture(label) {
  const f = createAuthoredProbeFixture(`slot-admission-${label}`, { initialKnowledge: [{
    characterId: ACTOR, knowledgeRef: KNOWLEDGE, kind: 'sensoryEvidence', layer: 'full',
    content: '醒来时记得这个地方。', visibility: 'private', provenanceChain: ['genesis:prior'],
  }] });
  f.requiredContext = freezeAuthoredProbeContext(f, f.state,
    { rootActionId: f.rootActionId, focusRefs: [TARGET], intentText: '我对同伴施放治疗。' }).context;
  return { ...f, knowledgeRef: `knowledge:${ACTOR}:${KNOWLEDGE}` };
}

/** Every declared reference position of one slot family in the built schema. */
function slotFields(schema, pick) {
  const fields = [];
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    const found = pick(value);
    if (found) fields.push(found);
    for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child);
  };
  walk(expandDeepSeekSchema(schema));
  return fields;
}
const creatureTargetFields = schema => slotFields(schema, value =>
  value.properties?.kind?.enum?.includes('creatures') && value.properties?.refs
    ? value.properties.refs.items : undefined);
const worldTargetFields = schema => slotFields(schema, value =>
  value.properties?.directTargetRefs && value.properties?.instrumentRefs
    ? value.properties.directTargetRefs.items : undefined);

test('a citable knowledge record is not a creature and cannot reach a creature target slot', () => {
  const f = fixture('creature');
  const citable = new Set(f.requiredContext.references.citations.viewerEvidenceRefs);
  // The premise of the round: this ref really is offered to the model elsewhere.
  assert.ok(citable.has(f.knowledgeRef), 'the knowledge record is Viewer-citable in this frozen context');

  const creatures = proposalCreatureTargetRefs(f.requiredContext);
  assert.ok(creatures.includes(TARGET) && creatures.includes(ACTOR));
  assert.ok(!creatures.includes(f.knowledgeRef));
  assert.ok(!creatures.includes(SCENE), 'a scene is a physical object but never a creature');

  const schema = createVNextProposalBundleSchema(['abilityOperation'], undefined, undefined,
    undefined, undefined, undefined, creatures);
  const fields = creatureTargetFields(schema);
  assert.ok(fields.length > 0, 'the ability terminal keeps a creature target slot');
  for (const field of fields) {
    assert.equal(matchesAuthoredSourceSchema(TARGET, field), true);
    assert.equal(matchesAuthoredSourceSchema(f.knowledgeRef, field), false);
    assert.equal(matchesAuthoredSourceSchema(SCENE, field), false);
    assert.equal(matchesAuthoredSourceSchema('character:not-in-context', field), false);
  }
  assert.equal(JSON.stringify(schema).includes(f.knowledgeRef), false);
  assert.deepEqual(deepSeekStrictToolSchemaIssues(schema), []);
});

test('the same rule holds for a different proposal family: world interaction targets take physical objects', () => {
  const f = fixture('world');
  const subjects = proposalObservationSubjectRefs(f.requiredContext);
  const schema = createVNextProposalBundleSchema(['worldInteraction'], undefined, subjects);
  const fields = worldTargetFields(schema);
  assert.ok(fields.length > 0, 'world interaction keeps a direct target slot');
  for (const field of fields) {
    assert.equal(matchesAuthoredSourceSchema(TARGET, field), true);
    assert.equal(matchesAuthoredSourceSchema(SCENE, field), true, 'a scene is a legal interaction target');
    assert.equal(matchesAuthoredSourceSchema('prospective:new-object', field), true,
      'a same-bundle object stays reachable; the surface narrows classes, not creation');
    assert.equal(matchesAuthoredSourceSchema(f.knowledgeRef, field), false);
  }
  assert.deepEqual(deepSeekStrictToolSchemaIssues(schema), []);
});

test('an unbound request keeps the domain vocabulary, and an empty class admits no member', () => {
  const f = fixture('bounds');
  for (const field of creatureTargetFields(createVNextProposalBundleSchema(['abilityOperation']))) {
    assert.equal(matchesAuthoredSourceSchema(f.knowledgeRef, field), true,
      'without a request surface the slot keeps its unbound domain vocabulary');
  }
  for (const field of creatureTargetFields(createVNextProposalBundleSchema(['abilityOperation'],
    undefined, undefined, undefined, undefined, undefined, []))) {
    assert.equal(matchesAuthoredSourceSchema(TARGET, field), false);
    assert.equal(matchesAuthoredSourceSchema('', field), false,
      'no visible creature admits no member, and never an empty string');
  }
});

test('classes are one projection of the same frozen visibility, not parallel vocabularies', () => {
  const f = fixture('classes');
  const creatures = proposalSubjectRefs(f.requiredContext, 'creature');
  const physical = proposalSubjectRefs(f.requiredContext, 'physical');
  assert.deepEqual(creatures, proposalCreatureTargetRefs(f.requiredContext));
  assert.deepEqual(physical, proposalObservationSubjectRefs(f.requiredContext));
  assert.ok(creatures.every(ref => physical.includes(ref)), 'every creature is a physical object');
  assert.ok(physical.length > creatures.length, 'the physical class is strictly wider here');
  const visible = new Set(f.requiredContext.references.citations.viewerEvidenceRefs);
  assert.ok(physical.every(ref => visible.has(ref)), 'no class reaches past frozen Viewer visibility');
  assert.ok(Object.isFrozen(creatures) && Object.isFrozen(physical));
});
