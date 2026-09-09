import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDeepSeekStrictToolSchema } from '../app/_runtime/lib/kp/deepseek-strict-tool.ts';
import { matchesAuthoredSourceSchema } from '../app/_runtime/lib/rules/v2/authored-materialization.ts';
import { isNpcMaterializationSource } from '../app/_runtime/lib/rules/v2/npc-materialization.ts';
import { NPC_MATERIALIZATION_WIRE_SCHEMA, encodeNpcMaterializationWire, decodeNpcMaterializationWire,
  NpcMaterializationWireError } from '../app/_runtime/lib/kp/vnext/npc-materialization-wire.ts';
import { SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA, createVNextProposalBundleSchema, encodeVNextStrictToolBundle,
  decodeVNextStrictToolBundle } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments, VNextProposalBundleOutputError } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';

function source(scholar = false) {
  const scores = scholar ? { str: 8, dex: 14, con: 10, int: 18, wis: 16, cha: 14 }
    : { str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 11 };
  return {
    name: scholar ? '档案学者' : '河堤巡守', description: '带着旧卷宗盒。', background: '洪灾之后转调本地。',
    goals: ['寻找卷宗'], behavioralConstraints: ['先核实线索'], voice: '措辞简洁。', initialUnknowns: ['不知道卷宗去向'],
    rulesBasis: 'srd5.1-2014',
    mechanicalTemplate: {
      schema: 'zhuwei.npc-mechanical-template/v1', label: '完整人物机制',
      stats: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, String(value)])),
      proficiencyBonus: '2', armorClass: '12', armorClassModel: { kind: 'higherOfBaseAndEquipment', baseArmorClass: '12', shieldBonus: '0' },
      hitPointsMaximum: '26', footprint: { width: '60', depth: '60', height: '70' },
      speedInches: scholar ? { walk: '300', fly: '120' } : { walk: '360', swim: '0' },
      resourceMaximums: scholar ? { 'resource:focus': '3', 'resource:spent': '0' } : {},
      deathPolicy: scholar ? 'deathSaves' : 'defeatedAtZero', intrinsicAbilityRefs: [], itemDefinitionRefs: [],
      initialLoadout: { entries: [{ entryId: 'spear', quantity: 1, equippedSlot: null, source: { kind: 'standardGear', ref: 'spear' } }] },
      ...(scholar ? { attacksPerAttackAction: '2', damageDefenses: { resistant: ['cold'] }, sizeCategory: 'medium',
        spellcasting: { ability: 'int', spellAttackBonus: '6', spellSaveDc: '14' } } : {}),
    },
    socialMechanics: { abilityScores: scores, proficiencyBonus: 2, skillModifiers: scholar ? { history: 8, insight: 0 } : { insight: 0 },
      initialTrust: 0, authorityModifier: 0, stakesSensitivity: 0, maximumInfluenceDegree: 'limitedSuccess' },
    position: { x: '400', y: '400', elevation: '0' },
  };
}
const bundle = src => ({ mode: 'adjudication', basisRefs: ['scene:harbor'], terminal: null,
  adjudication: { kind: 'directSuccess', durationMicros: '300000000', risk: '沿既定设定展开场景。', successOutcome: '人物出场。' },
  proposals: [{ kind: 'materializeNpc', basisRefs: ['scene:harbor'], consumes: [{ kind: 'existing', ref: 'scene:harbor' }],
    produces: [{ kind: 'entity', handle: 'prospective:archivist', outcomeBinding: 'always' }], outcomeBinding: 'always',
    sceneRef: 'scene:harbor', source: src, visibilityPolicyRef: 'visibility:scene-observers', summary: '档案员带着卷宗盒出场。' }] });
const parse = value => parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(value));
function outputError(value) {
  let captured;
  assert.throws(() => parse(value), error => {
    assert.ok(error instanceof VNextProposalBundleOutputError);
    captured = error; return true;
  });
  return captured;
}

test('NPC and complete proposal schemas load and satisfy the unchanged DeepSeek strict subset', () => {
  assert.doesNotThrow(() => assertDeepSeekStrictToolSchema(NPC_MATERIALIZATION_WIRE_SCHEMA));
  assert.doesNotThrow(() => assertDeepSeekStrictToolSchema(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA));
  assert.doesNotThrow(() => assertDeepSeekStrictToolSchema(createVNextProposalBundleSchema(['materializeNpc'])));
});

test('guard and spellcaster sources roundtrip through the same strict wire and public proposal parser', () => {
  for (const scholar of [false, true]) {
    const original = source(scholar), before = structuredClone(original);
    assert.equal(isNpcMaterializationSource(original), true);
    const wire = encodeNpcMaterializationWire(original), diagnostics = [];
    assert.equal(matchesAuthoredSourceSchema(wire, NPC_MATERIALIZATION_WIRE_SCHEMA, diagnostics), true, JSON.stringify(diagnostics));
    assert.deepEqual(wire.mechanicalTemplate.initialLoadout.entries[0].equippedSlot, { kind: 'none' });
    assert.ok(Array.isArray(wire.mechanicalTemplate.resourceMaximums));
    assert.ok(Array.isArray(wire.socialMechanics.skillModifiers));
    if (!scholar) {
      assert.deepEqual(wire.mechanicalTemplate.spellcasting, { kind: 'none' });
      assert.deepEqual(wire.mechanicalTemplate.speedInches.fly, { kind: 'none' });
      assert.equal(wire.mechanicalTemplate.speedInches.swim, '0');
    }
    assert.deepEqual(decodeNpcMaterializationWire(wire), original);
    const proposal = encodeVNextStrictToolBundle(bundle(original));
    assert.deepEqual(decodeVNextStrictToolBundle(proposal).proposals[0].source, original);
    const parsed = parse(proposal);
    assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
    assert.deepEqual(parsed.bundle.proposals[0].source, original);
    assert.deepEqual(original, before);
  }
});

test('duplicate dictionary keys reject before construction, including identical values and both dictionary families', () => {
  for (const [owner, field] of [['mechanicalTemplate', 'resourceMaximums'], ['socialMechanics', 'skillModifiers']]) {
    for (const identical of [false, true]) {
      const wire = encodeVNextStrictToolBundle(bundle(source(true)));
      const entries = wire.steps[0].source[owner][field];
      entries.push({ key: entries[0].key, value: identical ? entries[0].value : owner === 'mechanicalTemplate' ? '9' : 9 });
      const before = structuredClone(wire), parsed = outputError(wire);
      assert.ok(parsed.diagnostics.some(d => d.constraint === 'npc-wire:duplicate-key'
        && JSON.stringify(d.path) === JSON.stringify(['steps', 0, 'source', owner, field, entries.length - 1, 'key'])), JSON.stringify(parsed));
      assert.ok(parsed.diagnostics.every(d => d.repair.allowed === false));
      assert.deepEqual(wire, before);
    }
  }
  const wire = encodeVNextStrictToolBundle(bundle(source(true)));
  const raw = JSON.stringify(wire).replace('"key":"resource:focus"', '"key":"resource:focus","key":"resource:focus"');
  assert.throws(() => parseSubmitKpProposalBundleCandidateArguments(raw), VNextProposalBundleOutputError);
});

test('missing optional declarations, padded sentinels, raw maps and extra entry fields are never cleaned into valid input', () => {
  for (const mutate of [
    s => { delete s.mechanicalTemplate.spellcasting; },
    s => { s.mechanicalTemplate.spellcasting = { kind: 'none', ability: '' }; },
    s => { s.mechanicalTemplate.initialLoadout.entries[0].equippedSlot = null; },
    s => { s.mechanicalTemplate.resourceMaximums = { 'resource:focus': '3' }; },
    s => { s.socialMechanics.skillModifiers[0].extra = true; },
    s => { s.socialMechanics.skillModifiers[0].key = { kind: 'none' }; },
  ]) {
    const wire = encodeNpcMaterializationWire(source(true)); mutate(wire);
    const before = structuredClone(wire);
    assert.throws(() => decodeNpcMaterializationWire(wire), NpcMaterializationWireError);
    assert.deepEqual(wire, before);
  }
});

test('decoding preserves semantic failures for the same Rules source validator instead of repairing values', () => {
  for (const mutate of [
    s => { s.mechanicalTemplate.stats.str = '31'; },
    s => { s.socialMechanics.abilityScores.int = 10; },
    s => { s.mechanicalTemplate.resourceMaximums[0].key = 'item:stock'; },
  ]) {
    const wire = encodeVNextStrictToolBundle(bundle(source(true))); mutate(wire.steps[0].source);
    const decoded = decodeNpcMaterializationWire(wire.steps[0].source);
    assert.equal(isNpcMaterializationSource(decoded), false);
    assert.equal(parse(wire).kind, 'locallyRejected');
  }
  const wire = encodeVNextStrictToolBundle(bundle(source(true))); wire.steps[0].source.name = 'Cafe\u0301';
  assert.equal(decodeNpcMaterializationWire(wire.steps[0].source).name, 'Cafe\u0301');
  assert.ok(outputError(wire).diagnostics.some(d => d.constraint === 'canonical JSON strings must already use Unicode NFC'));
});

test('clarification continuations use the same NPC decoder and preserve the exact rejected entry path', () => {
  const initial = bundle(source(true));
  const choice = { mode: 'terminal', basisRefs: ['scene:harbor'], adjudication: null, proposals: [],
    terminal: { kind: 'clarification', question: '是否请档案员出场？', choices: [{ choiceId: 'introduce', label: '请出场',
      continuation: { kind: 'adjudication', basisRefs: initial.basisRefs, adjudication: initial.adjudication, proposals: initial.proposals } }] } };
  const wire = encodeVNextStrictToolBundle(choice);
  assert.deepEqual(decodeVNextStrictToolBundle(wire).terminal.choices[0].continuation.proposals[0].source, initial.proposals[0].source);
  const entries = wire.decision.choices[0].continuation.steps[0].source.mechanicalTemplate.resourceMaximums;
  entries.push(structuredClone(entries[0]));
  const parsed = outputError(wire);
  assert.ok(parsed.diagnostics.some(d => d.constraint === 'npc-wire:duplicate-key' && JSON.stringify(d.path)
    === JSON.stringify(['decision', 'choices', 0, 'continuation', 'steps', 0, 'source', 'mechanicalTemplate', 'resourceMaximums', 2, 'key'])));
});
