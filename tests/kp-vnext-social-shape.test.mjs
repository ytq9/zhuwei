import assert from 'node:assert/strict';
import test from 'node:test';
import { createVNextProposalBundleSchema } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { expandDeepSeekSchema, schemaVariants } from './fixtures/expand-deepseek-schema.mjs';
import { matchesAuthoredSourceSchema } from '../app/_runtime/lib/rules/v2/authored-materialization.ts';
import {
  socialBranchConform,
  socialConsequenceConform,
  socialEvidenceConform,
  socialRetryChangeConform,
} from '../app/_runtime/lib/rules/v2/social-interaction.ts';

function branch() {
  return { outcomeCode: 'answered', summary: '守卫作出了回答。',
    response: { kind: 'speech', text: '我听说城门昨晚关闭了。', motive: '转述自己听到的传闻。',
      basis: [{ kind: 'npcContext', ref: 'knowledge:guard:rumor' }] }, consequences: [] };
}

test('bound social choices exclude timeline authority and an invented initial retry while retaining existing conversation references', () => {
  const make = refs => expandDeepSeekSchema(createVNextProposalBundleSchema(['social'], [], [], [],
    [{ npcRef: 'npc:guard', refs: ['npc:guard', 'character-timeline:npc:guard'] }],
    { existingRefs: refs, viewerRefs: refs }, ['character:player', 'npc:guard']));
  const initial = make([]), step = schemaVariants(initial.properties.steps.items).find(v => v.properties.kind.enum.includes('social'));
  assert.equal(initial.properties.steps.items.type, 'object');
  assert.equal(initial.properties.results.items.type, 'object');
  assert.equal(matchesAuthoredSourceSchema({ kind: 'none' }, step.properties.retryChange), true);
  assert.equal(matchesAuthoredSourceSchema({ kind: 'method', priorThreadRef: 'current-submission', basisRefs: [], explanation: '初次请求。' }, step.properties.retryChange), false);
  const result = schemaVariants(initial.properties.results.items).find(v => v.properties.kind.enum.includes('social'));
  const promise = result.properties.newPromises.items;
  assert.equal(matchesAuthoredSourceSchema(['npc:guard'], promise.properties.authorityRefs), true);
  assert.equal(matchesAuthoredSourceSchema(['npc:guard', 'character-timeline:npc:guard'], promise.properties.authorityRefs), false);
  const existing = make(['continuity:conversationThreads:conversation:prior']);
  const next = schemaVariants(existing.properties.steps.items).find(v => v.properties.kind.enum.includes('social'));
  assert.equal(matchesAuthoredSourceSchema({ kind: 'method', priorThreadRef: 'conversation:prior', basisRefs: [], explanation: '采用了不同的方法。' }, next.properties.retryChange), true);
  assert.equal(matchesAuthoredSourceSchema('conversation:prior', next.properties.addressedThreadRef), true);
});
const retry = () => ({ priorThreadRef: 'conversation:earlier', kind: 'conditions', basisRefs: ['fact:new-condition'], explanation: '条件发生变化。' });
const promiseWith = terms => ({ kind: 'promise', content: '抄一份副本。', condition: '一个时辰内。', authorityRefs: ['npc:guard'], due: 'none', terms, nextStep: null });
const filledDelivery = () => ({ sourceRef: 'item-entry:deed', itemRef: null, quantity: 1, destinationKind: 'scene', destinationRef: 'scene:hall' });

test('social shape diagnostics locate response, evidence, consequence and retry failures without changing input', () => {
  const cases = [
    [socialBranchConform, () => { const v = branch(); v.response.text = 7; return v; }, 'TYPE_MISMATCH', ['response', 'text']],
    [socialBranchConform, () => { const v = branch(); v.response.kind = 'silence'; return v; }, 'CONSTRAINT_CONFLICT', ['response', 'text']],
    [socialBranchConform, () => { const v = branch(); delete v.response.motive; return v; }, 'FIELD_MISSING', ['response', 'motive']],
    [socialBranchConform, () => { const v = branch(); delete v.response.basis; return v; }, 'FIELD_MISSING', ['response', 'basis']],
    [socialBranchConform, () => { const v = branch(); v.response.basis = {}; return v; }, 'TYPE_MISMATCH', ['response', 'basis']],
    [socialBranchConform, () => { const v = branch(); v.response.basis = []; return v; }, 'VALUE_INVALID', ['response', 'basis']],
    [socialBranchConform, () => { const v = branch(); v.response.basis.push({ ...v.response.basis[0] }); return v; }, 'VALUE_INVALID', ['response', 'basis', 1]],
    [socialBranchConform, () => { const v = branch(); v.response.basis[0].ref = 7; return v; }, 'TYPE_MISMATCH', ['response', 'basis', 0, 'ref']],
    [socialEvidenceConform, () => ({ kind: 'npcContext', ref: '' }), 'VALUE_INVALID', ['ref']],
    [socialEvidenceConform, () => ({ kind: 'materializedKnowledge', definitionRef: 'definition:history', holderRef: 7 }), 'TYPE_MISMATCH', ['holderRef']],
    [socialEvidenceConform, () => ({ kind: 'materializedKnowledge', holderRef: 'npc:guard' }), 'FIELD_MISSING', ['definitionRef']],
    [socialEvidenceConform, () => ({ kind: 'omniscient' }), 'VALUE_INVALID', ['kind']],
    [socialConsequenceConform, () => ({ kind: 'relationship', relationshipRef: null, change: 7, basisFactRefs: [] }), 'TYPE_MISMATCH', ['change']],
    [socialConsequenceConform, () => ({ kind: 'promise', content: '帮助修缮城门。', condition: '明日。', authorityRefs: [], due: 'none', terms: { kind: 'result', subjectRefs: ['npc:guard'], delivery: null }, nextStep: null }), 'VALUE_INVALID', ['authorityRefs']],
    [socialConsequenceConform, () => ({ kind: 'debt', obligation: '归还工具。', basisFactRefs: ['fact:loan'] }), 'FIELD_MISSING', ['condition']],
    [socialBranchConform, () => { const v = branch(); v.consequences = [{ kind: 'debt', obligation: '归还工具。', condition: '明日。', basisFactRefs: [7] }]; return v; }, 'TYPE_MISMATCH', ['consequences', 0, 'basisFactRefs', 0]],
    [socialRetryChangeConform, () => ({ ...retry(), kind: 'unknown' }), 'VALUE_INVALID', ['kind']],
    [socialRetryChangeConform, () => ({ ...retry(), explanation: 7 }), 'TYPE_MISMATCH', ['explanation']],
    [socialRetryChangeConform, () => ({ ...retry(), basisRefs: ['fact:new-condition', 'fact:new-condition'] }), 'VALUE_INVALID', ['basisRefs', 1]],
    // Round99: a filled delivery carrying a kind field, and every other terms slot, is located below terms rather than reported as "terms is invalid".
    [socialConsequenceConform, () => promiseWith({ kind: 'result', subjectRefs: ['npc:guard'], delivery: { kind: 'scene', ...filledDelivery() } }), 'VALUE_INVALID', ['terms', 'delivery', 'kind']],
    [socialConsequenceConform, () => promiseWith({ kind: 'result', subjectRefs: ['npc:guard'], delivery: { ...filledDelivery(), quantity: 0 } }), 'VALUE_INVALID', ['terms', 'delivery', 'quantity']],
    [socialConsequenceConform, () => promiseWith({ kind: 'result', subjectRefs: ['npc:guard'], delivery: { ...filledDelivery(), destinationRef: 7 } }), 'TYPE_MISMATCH', ['terms', 'delivery', 'destinationRef']],
    [socialConsequenceConform, () => promiseWith({ kind: 'forever', subjectRefs: ['npc:guard'], delivery: null }), 'VALUE_INVALID', ['terms', 'kind']],
    [socialConsequenceConform, () => promiseWith({ kind: 'result', subjectRefs: [], delivery: null }), 'VALUE_INVALID', ['terms', 'subjectRefs']],
    [socialConsequenceConform, () => promiseWith({ kind: 'result', subjectRefs: ['npc:guard'], delivery: null, activation: { content: '若我先到。', subjectRefs: ['npc:guard'], requiresKnowledge: 'yes', windowEndFictionMicros: null } }), 'TYPE_MISMATCH', ['terms', 'activation', 'requiresKnowledge']],
    [socialConsequenceConform, () => promiseWith({ kind: 'result', subjectRefs: ['npc:guard'], delivery: null, activation: { content: '若我先到。', subjectRefs: ['npc:guard'], requiresKnowledge: false } }), 'FIELD_MISSING', ['terms', 'activation', 'windowEndFictionMicros']],
    [socialConsequenceConform, () => promiseWith({ kind: 'result', subjectRefs: ['npc:guard'], delivery: null, parts: [{ partId: 'a', content: '先看门。', kind: 'attempt', subjectRefs: ['npc:guard'], delivery: null }, { partId: 'a', content: '再报信。', kind: 'attempt', subjectRefs: ['npc:guard'], delivery: null }] }), 'VALUE_INVALID', ['terms', 'parts', 1]],
    [socialConsequenceConform, () => promiseWith({ kind: 'result', subjectRefs: ['npc:guard'], delivery: null, parts: [{ partId: 'a', content: '先看门。', kind: 'attempt', subjectRefs: ['npc:guard'], delivery: { ...filledDelivery(), destinationKind: 'pocket' } }] }), 'VALUE_INVALID', ['terms', 'parts', 0, 'delivery', 'destinationKind']],
  ];
  for (const [conform, make, code, path] of cases) {
    const value = make(), before = structuredClone(value), diagnostics = [];
    assert.equal(conform(value), false);
    assert.equal(conform(value, diagnostics), false);
    const diagnostic = diagnostics.find(d => d.code === code && JSON.stringify(d.path) === JSON.stringify(path));
    assert.ok(diagnostic, JSON.stringify({ path, diagnostics }));
    assert.ok(diagnostic.expected !== undefined && typeof diagnostic.constraint === 'string' && diagnostic.constraint.length > 0);
    assert.equal(Object.hasOwn(diagnostic, 'actual'), false);
    assert.deepEqual(value, before);
  }
});

test('social shape validation preserves lies, silence and already legal whitespace', () => {
  const lie = branch();
  lie.response.text = '  城门昨晚从未关闭。  ';
  lie.response.motive = '  故意隐瞒自己知道的封门消息。  ';
  lie.summary = '  守卫给出了回答。  ';
  const silence = branch(); silence.response.kind = 'silence'; silence.response.text = '';
  const values = [
    [socialBranchConform, lie], [socialBranchConform, silence],
    [socialEvidenceConform, { kind: 'playerExpression' }],
    [socialEvidenceConform, { kind: 'materializedKnowledge', definitionRef: 'prospective:history', holderRef: 'npc:guard' }],
    [socialConsequenceConform, { kind: 'relationship', relationshipRef: null, change: '  更信任对方。  ', basisFactRefs: [] }],
    [socialConsequenceConform, { kind: 'promise', content: '帮助修缮城门。', condition: '明日。', authorityRefs: ['npc:guard'], due: 'none', terms: { kind: 'result', subjectRefs: ['npc:guard'], delivery: null }, nextStep: null }],
    [socialConsequenceConform, promiseWith({ kind: 'result', subjectRefs: ['npc:guard', 'item-entry:deed'], delivery: filledDelivery(), parts: [{ partId: 'copy', content: '誊抄。', kind: 'attempt', subjectRefs: ['item-entry:deed'], delivery: null }], activation: { content: '若你在厅里等。', subjectRefs: ['npc:guard'], requiresKnowledge: false, windowEndFictionMicros: '3600000000' } })],
    [socialConsequenceConform, { kind: 'debt', obligation: '归还工具。', condition: '明日。', basisFactRefs: ['fact:loan'] }],
    [socialRetryChangeConform, { ...retry(), kind: 'cost', explanation: '  原 Rules 形状仍允许此类型。  ' }],
  ];
  for (const [conform, value] of values) {
    const before = structuredClone(value), diagnostics = [];
    assert.equal(conform(value), true);
    assert.equal(conform(value, diagnostics), true);
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(value, before);
  }
});
