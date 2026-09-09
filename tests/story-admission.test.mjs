import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareStoryAdmissionBinding, storyAdmissionReceipt, storyFactPlans, validStoryMaterialBindings } from '../app/_runtime/lib/room/story-admission.ts';
import { createStoryAdmissionFixture as fixture, BOATMAN, NEW_NPC, FACT, KNOWLEDGE } from './fixtures/kp-vnext-story-materialization.mjs';
import { itemBundle } from './fixtures/vnext-authored-bundles.mjs';
import { PROBE_SOURCE, PROBE_SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { VNEXT_SEMANTIC_TEMPLATES } from '../app/_runtime/lib/rules/profiles/semantic-templates.ts';
import { selectHistoricalSupplements } from '../app/_runtime/lib/room/story-history/historical-cut.ts';

test('actual NPC selection, Rules state and events produce stable candidate, fact and knowledge mappings', async () => {
  for (const newNpc of [false, true]) {
    const f = await fixture(`admission:${newNpc}`, { newNpc });
    assert.equal(storyFactPlans(f.rulesInput).length, 1);
    const mapped = f.admission.definitions[0];
    assert.equal(f.admission.definitions.length, Number(newNpc));
    if (newNpc) {
      assert.equal(mapped.candidateRef, NEW_NPC); assert.match(mapped.authorityRef, /^npc:/);
      assert.ok(mapped.definitionRefs.length >= 2);
      assert.equal(f.events.find(event => event.eventId === mapped.recordedByEventId).eventType, 'NpcMaterialized');
    }
    assert.equal(f.admission.facts[0].candidateRef, FACT);
    assert.equal(f.admission.facts[0].knowledge[0].candidateRef, KNOWLEDGE);
    assert.equal(f.admission.facts[0].knowledge[0].holderRef, newNpc ? mapped.authorityRef : BOATMAN);
    assert.equal(validStoryMaterialBindings(f.preparation, f.admission.definitions, f.admission.facts, f.binding.selectedMaterialRefs), true);
  }
});

test('a selected definition has an admission receipt even without fact or knowledge effects', async () => {
  const f = await fixture('definition-only', { newNpc: true, definitionOnly: true });
  assert.deepEqual(f.binding.selectedMaterialRefs, [NEW_NPC]);
  assert.equal(f.admission.definitions.length, 1); assert.deepEqual(f.admission.facts, []);
  assert.equal(storyFactPlans(f.rulesInput).length, 0);
});

test('semantic objects, authored abilities and item instances retain their real producer identity and definition closure', async () => {
  const producers = itemBundle().proposals.slice(0, 3);
  const candidateRefs = ['candidate:restorative-ability', 'candidate:restorative-definition', 'candidate:restorative-dose'];
  const definitions = producers.map((producer, index) => ({ ref: candidateRefs[index], kind: index === 0 ? 'ability' : 'item',
    producer, dependsOn: [PROBE_SOURCE, ...(index > 0 ? [candidateRefs[index - 1]] : [])] }));
  const template = VNEXT_SEMANTIC_TEMPLATES.sceneFeature;
  definitions.push({ ref: 'candidate:glass-cover', kind: 'sceneFeature', dependsOn: [PROBE_SOURCE], producer: {
    kind: 'materializeObject', basisRefs: [PROBE_SOURCE], consumes: [],
    produces: [{ handle: 'prospective:glass-cover', kind: 'semanticDefinition', outcomeBinding: 'always' }],
    outcomeBinding: 'always', semanticKind: 'sceneFeature', templateRef: template.templateRef, templateHash: template.templateHash,
    visibilityPolicyRef: 'visibility:public', definition: { sceneRef: PROBE_SCENE, visibilityFactId: null,
      label: '药品玻璃罩', description: '防止散落药品被雨打湿的玻璃罩。', observableState: '完整', affordances: ['携带'], mechanicDefinitionRefs: [] },
    summary: '玻璃罩被固化。' } });
  const f = await fixture('generic-definition-only', { definitions, definitionOnly: true });
  const [ability, itemDefinition, item, object] = f.admission.definitions;
  assert.deepEqual(f.admission.facts, []);
  assert.deepEqual(f.admission.definitions.map(value => value.candidateRef), definitions.map(value => value.ref));
  assert.equal(f.state.campaignRuntime.definitions[ability.authorityRef].definitionKind, 'ability');
  assert.equal(f.state.campaignRuntime.itemSystem.definitions[itemDefinition.authorityRef].content.use.abilityRef, ability.authorityRef);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[item.authorityRef].definitionRef, itemDefinition.authorityRef);
  assert.deepEqual(item.definitionRefs, [itemDefinition.authorityRef]);
  assert.ok(f.state.campaignRuntime.definitions[object.authorityRef]);
  assert.deepEqual(f.admission.definitions.map(value => f.events.find(event => event.eventId === value.recordedByEventId).eventType),
    ['DefinitionRegistered', 'ItemDefinitionRegistered', 'ItemMaterialized', 'SemanticDefinitionMaterialized']);
  const material = { preparation: f.preparation, preparationHash: f.preparationHash, recordedAtEventSeq: f.admission.recordedAtEventSeq,
    definitions: f.admission.definitions, facts: f.admission.facts };
  const selected = selectHistoricalSupplements({ preparations: [material], events: f.events, sourceState: f.state,
    cutState: f.state, cutEventSeq: f.state.version });
  assert.deepEqual(selected, { kind: 'selected', preparations: [material], lateFacts: [] });
});

test('altered raw command, missing creation evidence and rebound or duplicated mappings fail closed', async () => {
  const f = await fixture('rejected-mapping', { newNpc: true });
  const before = structuredClone(f.state);
  const changed = structuredClone(f.rulesInput); changed.steps[0].rulesInput.plan.source.name = '替代身份';
  assert.throws(() => prepareStoryAdmissionBinding({ ...f.bindingInput, state: f.bindingInput.state, rulesInput: changed }), /STORY_ADMISSION_BINDING_INVALID/);
  assert.throws(() => storyAdmissionReceipt({ ...f.receiptInput,
    events: f.events.filter(event => event.eventType !== 'NpcMaterialized') }), /STORY_ADMISSION_BINDING_INVALID/);
  const changedState = structuredClone(f.state); delete changedState.entities[f.admission.definitions[0].authorityRef];
  assert.throws(() => storyAdmissionReceipt({ ...f.receiptInput, state: changedState }), /STORY_ADMISSION_BINDING_INVALID/);
  for (const alter of [
    value => { value.definitions = []; },
    value => { value.definitions.push(value.definitions[0]); },
    value => { value.definitions[0].authorityRef = BOATMAN; },
    value => { value.facts[0].knowledge[0].holderRef = NEW_NPC; },
  ]) {
    const admission = structuredClone(f.admission); alter(admission);
    assert.equal(validStoryMaterialBindings(f.preparation, admission.definitions, admission.facts, f.binding.selectedMaterialRefs), false);
  }
  assert.deepEqual(f.state, before);
});
