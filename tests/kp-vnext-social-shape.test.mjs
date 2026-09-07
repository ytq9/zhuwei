import assert from 'node:assert/strict';
import test from 'node:test';
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
const retry = () => ({ priorThreadRef: 'conversation:earlier', kind: 'conditions', basisRefs: ['fact:new-condition'], explanation: '条件发生变化。' });

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
    [socialConsequenceConform, () => ({ kind: 'promise', content: '帮助修缮城门。', condition: '明日。', authorityRefs: [] }), 'VALUE_INVALID', ['authorityRefs']],
    [socialConsequenceConform, () => ({ kind: 'debt', obligation: '归还工具。', basisFactRefs: ['fact:loan'] }), 'FIELD_MISSING', ['condition']],
    [socialBranchConform, () => { const v = branch(); v.consequences = [{ kind: 'debt', obligation: '归还工具。', condition: '明日。', basisFactRefs: [7] }]; return v; }, 'TYPE_MISMATCH', ['consequences', 0, 'basisFactRefs', 0]],
    [socialRetryChangeConform, () => ({ ...retry(), kind: 'unknown' }), 'VALUE_INVALID', ['kind']],
    [socialRetryChangeConform, () => ({ ...retry(), explanation: 7 }), 'TYPE_MISMATCH', ['explanation']],
    [socialRetryChangeConform, () => ({ ...retry(), basisRefs: ['fact:new-condition', 'fact:new-condition'] }), 'VALUE_INVALID', ['basisRefs', 1]],
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
    [socialConsequenceConform, { kind: 'promise', content: '帮助修缮城门。', condition: '明日。', authorityRefs: ['npc:guard'] }],
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
