// Behavior assertions grouped by function; see README.md in this directory.
/**
 * Gate for SPEC 0015 §7、SPEC 0016 §8.3: the frozen material decides which
 * rules the narrator and the reviewer are given.
 *
 * A paragraph about spell slots, social records, check settlement or perceived
 * inference governs a field that is either in this receipt's material or not.
 * When it is not, sending it spends input and competes for attention with the
 * rules that do apply. Nothing may be dropped when the subject IS present, so
 * these prove both directions on the same fixtures.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { naturalNarrationModelInput, narrationReviewModelInput, narrationMaterialShape }
  from '../../../app/_runtime/lib/kp/narration-vnext.ts';
import { actor, viewer, requestFor, transfer } from '../../support/fixtures/narration.mjs';

/** The opening clause of each paragraph whose subject can be absent. The last
 * two describe fields only the narrator is given, so only its prompt has
 * them; the rest constrain both writing and reviewing. */
const GATED_BOTH = {
  mechanical: '机械表达精确度：',
  social: 'socialRecords按本次回执',
  check: '交谈与观察已有具体回应或感官结果时，',
  perception: '感知与推断的表达：',
};
const GATED_GENERATION_ONLY = {
  knowledgeReview: 'knowledgeReview是玩家回顾角色已持有记录',
  knowledgeAcquisition: 'knowledgeAcquisition是本次经交流取得record中的信息',
};
const GATED = { ...GATED_BOTH, ...GATED_GENERATION_ONLY };
/** Rules about the telling itself, which every receipt is given. */
const ALWAYS_BOTH = ['中文表达：', 'currentResult限定本次回执'];
const ALWAYS_GENERATION = [...ALWAYS_BOTH, '事实边界：', '只调用一次submit_frozen_narration'];
const ALWAYS_REVIEW = [...ALWAYS_BOTH, '检查五个维度', 'issues的quote须逐字摘取原文'];

const generationPrompt = request => naturalNarrationModelInput(request).messages[0].content;
const reviewPrompt = request => narrationReviewModelInput(request, '正文。').messages[0].content;

const settledCheck = { kind: 'mechanicalOutcome', outcomeKind: 'worldInteraction', actorRef: actor,
  targetRefs: ['feature:door'], outcomeCode: 'success', summary: '这次环境互动已直接成功并提交。' };
const spoken = { kind: 'sourceClaim', speakerRef: 'npc:a', statement: '北桥已经封闭了。' };
const inventory = { kind: 'inventoryOutcome', itemRef: 'item:mirror', change: 'transferred',
  characterRefs: [viewer, actor], operation: { kind: 'transfer', actorRef: actor, recipientRef: viewer, quantity: 2 },
  summary: '完成转交。' };

test('a plain item transfer is told without the rules for subjects its material does not contain', () => {
  const request = transfer();
  assert.deepEqual(narrationMaterialShape(request.renderableClaims.claims), { mechanical: false, social: false,
    check: false, perception: false, knowledgeReview: false, knowledgeAcquisition: false });
  for (const [prompt, always] of [[generationPrompt(request), ALWAYS_GENERATION], [reviewPrompt(request), ALWAYS_REVIEW]]) {
    for (const [subject, opening] of Object.entries(GATED)) {
      assert.equal(prompt.includes(opening), false, `${subject} constrains nothing in this material`);
    }
    for (const opening of always) {
      assert.ok(prompt.includes(opening), `the rules about the telling itself always apply: ${opening}`);
    }
  }
});

test('each subject present in the material brings back exactly its own rules', () => {
  for (const [subject, materials] of [
    ['mechanical', [settledCheck]],
    ['social', [spoken]],
    ['perception', [spoken]],
    ['knowledgeAcquisition', [spoken]],
  ]) {
    const shape = narrationMaterialShape(requestFor(materials).renderableClaims.claims);
    assert.equal(shape[subject], true, `${subject} must be recognized in its own material`);
    assert.ok(generationPrompt(requestFor(materials)).includes(GATED[subject]),
      `${subject} is present, so its rule must be sent`);
  }
  // A settlement-only outcome is exactly what the check-presentation rule is
  // about: the record exists for the branch, and must not be read out.
  assert.equal(narrationMaterialShape(requestFor([settledCheck, inventory]).renderableClaims.claims).check, true);
});

test('material that contains every subject is told the complete prompt', () => {
  const full = requestFor([settledCheck, spoken, inventory,
    { kind: 'knowledgeReview', characterId: actor, inquiry: '北桥现在怎么样？', scope: 'allKnown', records: [] }]);
  const shape = narrationMaterialShape(full.renderableClaims.claims);
  assert.deepEqual(shape, { mechanical: true, social: true, check: true, perception: true,
    knowledgeReview: true, knowledgeAcquisition: true });
  const generation = generationPrompt(full), review = reviewPrompt(full);
  for (const opening of [...Object.values(GATED), ...ALWAYS_GENERATION]) {
    assert.ok(generation.includes(opening), `complete material keeps ${opening} in generation`);
  }
  for (const opening of Object.values(GATED_BOTH)) {
    assert.ok(review.includes(opening), `complete material keeps ${opening} in review`);
  }
  for (const opening of Object.values(GATED_GENERATION_ONLY)) {
    assert.equal(review.includes(opening), false, `${opening} describes a field only the narrator is given`);
  }
  // Every rule a narrower material is given is also in the complete prompt: the
  // shape may only remove paragraphs, never rewrite or reorder them.
  const plain = generationPrompt(transfer()).split('\n');
  const complete = generation.split('\n');
  let cursor = 0;
  for (const paragraph of plain) {
    const found = complete.indexOf(paragraph, cursor);
    assert.notEqual(found, -1, `the complete prompt must still carry: ${paragraph.slice(0, 40)}`);
    cursor = found + 1;
  }
});
