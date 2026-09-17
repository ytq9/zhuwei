import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAuthoritativeTableObservation } from '../../../app/_runtime/lib/table/authoritative.ts';

const actor = 'character:reader';
const note = (id, content, objectKind = 'sensoryEvidence', extra = {}) => ({
  characterId: actor, knowledgeRef: id, content, objectKind, layer: 'full', ...extra,
});
const fact = (id, subjectRef) => ({ id, value: { subjectRef } });
function project(knowledge, visibleFacts = [], withheld = []) {
  return projectAuthoritativeTableObservation({ userId: 'reader', members: ['reader'], locationLabels: {}, observation: {
    readModel: { kind: 'projected', viewer: { kind: 'player', principalId: 'reader', characterId: actor },
      controlledCharacter: { characterId: actor, name: '读者', sceneId: 'hall' }, knowledge, visibleFacts,
      visibleItems: [{ itemEntryId: 'item:leaf', name: '黑橡叶' }, { itemEntryId: 'item:seal', name: '封印' }] },
    presentationHold: { knowledgeRefs: withheld },
  } }).clues;
}

// SPEC 0005 §§6、7，SPEC 0010 §7：同一对象的取得记录可整理，不能改变知识性质或读取资格。
test('one object has one card for sight, touch and a supported inference; background is folded away', () => {
  const knowledge = [note('opening', { schema: 'zhuwei.module-opening-knowledge/v1', description: '你来到大厅。' }),
    note('arrival', '你是来客。'), note('sight', '叶背有细纹。'), note('touch', '细纹摸起来很粗糙。'),
    note('inference', { schema: 'zhuwei.character-inference/v1', conclusion: '像是刻上去的。', confidence: '刻纹的含义还看不出。' }, 'characterInference', { provenanceChain: ['sight', 'touch', 'event:formed'] })];
  const before = JSON.stringify(knowledge);
  const cards = project(knowledge, [fact('sight', 'item:leaf'), fact('touch', 'item:leaf')]);
  assert.equal(cards.filter(card => !card.background).length, 1);
  const leaf = cards.find(card => !card.background);
  assert.equal(leaf.name, '黑橡叶');
  assert.deepEqual(leaf.notes.map(note => note.id), ['sight', 'touch', 'inference']);
  assert.equal(leaf.notes[2].hint, '角色推断');
  assert.match(leaf.notes[2].text, /含义还看不出/);
  assert.equal(cards.find(card => card.background).notes.length, 2);
  assert.equal(JSON.stringify(knowledge), before);
});

test('different objects, incomplete evidence and held publication stay distinct', () => {
  const inference = note('guess', { schema: 'zhuwei.character-inference/v1', conclusion: '二者或许有关。', confidence: '没有确定。' }, 'characterInference', { provenanceChain: ['leaf', 'seal', 'event:formed'] });
  const knowledge = [note('leaf', '有一道细纹。'), note('seal', '有一道细纹。'), inference,
    note('rumour', { title: '守夜人的说法', text: '他说门开着。' }, 'sourceClaim', { layer: 'partial' })];
  const facts = [fact('leaf', 'item:leaf'), fact('seal', 'item:seal')];
  const cards = project(knowledge, facts);
  assert.equal(cards.filter(card => !card.background).length, 3);
  assert.equal(cards.find(card => card.background).notes[0].id, 'guess');
  assert.equal(cards.find(card => card.id === 'rumour').hint, '来源主张');
  assert.equal(cards.find(card => card.id === 'rumour').layer, 'talk');
  const withheld = project(knowledge, facts, ['leaf', 'guess']);
  assert.doesNotMatch(JSON.stringify(withheld), /黑橡叶|二者或许有关/);
});

test('identical wording from distinct sources remains attributed; withholding a basis cannot regroup an inference', () => {
  const cards = project([note('a', '纸边有墨迹。', 'sensoryEvidence', { sourceCharacterId: 'npc:a' }),
    note('b', '纸边有墨迹。', 'sensoryEvidence', { sourceCharacterId: 'npc:b' })], [fact('a', 'item:leaf'), fact('b', 'item:leaf')]);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].notes.map(note => note.id), ['a', 'b']);
  assert.ok(cards[0].notes.every(note => note.source === '由他人转述'));
  const inference = note('guess', { schema: 'zhuwei.character-inference/v1', conclusion: '可能有关。', confidence: '尚不能确定。' }, 'characterInference', { provenanceChain: ['a', 'b', 'event:formed'] });
  const filtered = project([note('a', '纸边有墨迹。'), note('b', '叶背有纹。'), inference], [fact('a', 'item:leaf'), fact('b', 'item:seal')], ['b']);
  assert.equal(filtered.find(card => card.background).notes[0].id, 'guess');
});
