import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { proposalNpcSourceChoices, proposalModelContext } from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { npcDecisionContext, npcDecisionEntryRef, npcDecisionEvidenceRef } from '../app/_runtime/lib/rules/v2/npc-decision-context.ts';
import { characterTimelineId } from '../app/_runtime/lib/rules/v2/timeline.ts';
import { encodeVNextStrictToolBundle } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { createKnowledgeSelector, VNEXT_KNOWLEDGE_RELEVANCE_PROFILE } from '../app/_runtime/lib/kp/vnext/context/knowledge-relevance.ts';
import { buildReferenceIndex } from '../app/_runtime/lib/kp/vnext/context/reference-index.ts';
import { createContextWorkBudget } from '../app/_runtime/lib/kp/vnext/context/work-budget.ts';

// Held knowledge grows with play. The holder's directory is always frozen
// whole; bodies travel by relevance: module background, anything from or about
// the actor, plan premises and the recent window always; older records only
// when the words reach them. Unloaded bodies stay uncitable directory lines.
const NPC = 'npc:relevance:keeper';
const HOUR = 3_600_000_000n, DAY = 24n * HOUR;
const REFS = { background: 'knowledge:background', oldUnrelated: 'knowledge:old-unrelated', oldTopic: 'knowledge:old-copper-key',
  fromActor: 'knowledge:from-actor', recent: 'knowledge:recent', actorOld: 'knowledge:actor-old', actorRecent: 'knowledge:actor-recent' };
const held = (characterId, knowledgeRef, content) => ({ characterId, knowledgeRef, content, kind: 'sourceClaim', layer: 'partial',
  visibility: 'private', provenanceChain: ['genesis:probe'] });

function fixture(label) {
  const f = createAuthoredProbeFixture(`knowledge-relevance:${label}`, { npcCharacters: [{ id: NPC, name: '守夜人' }],
    initialKnowledge: [
      held(NPC, REFS.background, 'BACKGROUND_守夜人自小在镇上长大。'),
      held(NPC, REFS.oldUnrelated, 'OLD_UNRELATED_三年前的一场大雨冲垮了桥。'),
      held(NPC, REFS.oldTopic, 'OLD_TOPIC_赫斯把铜钥交给了女儿保管。'),
      held(NPC, REFS.fromActor, 'FROM_ACTOR_外乡人说自己来自剑湾。'),
      held(NPC, REFS.recent, 'RECENT_今晚酒馆里没有陌生面孔。'),
      held(ACTOR, REFS.actorOld, 'ACTOR_OLD_很久以前听过的传闻。'),
      held(ACTOR, REFS.actorRecent, 'ACTOR_RECENT_刚才守夜人说桥修好了。'),
    ] });
  const state = structuredClone(f.state);
  const npcTimeline = characterTimelineId(state, NPC), actorTimeline = characterTimelineId(state, ACTOR);
  const now = 3n * DAY;
  for (const id of new Set([npcTimeline, actorTimeline])) state.fictionTimelines[id].nowMicros = now.toString();
  const age = (holder, ref, acquiredAt, extra = {}) => Object.assign(state.knowledge[holder][ref],
    { acquiredByEventId: `event:${ref}`, provenanceChain: [`event:${ref}`], acquiredAtFictionMicros: acquiredAt.toString(), ...extra });
  age(NPC, REFS.oldUnrelated, 0n);
  age(NPC, REFS.oldTopic, 0n);
  age(NPC, REFS.fromActor, 0n, { sourceCharacterId: ACTOR });
  age(NPC, REFS.recent, now - HOUR);
  age(ACTOR, REFS.actorOld, 0n);
  age(ACTOR, REFS.actorRecent, now - HOUR);
  return { ...f, state };
}
const entryRef = (holder, ref) => `knowledge:${holder}:${ref}`;
function freeze(f, intentText, focusRefs = []) {
  return freezeAuthoredProbeContext(f, f.state, { rootActionId: `${f.rootActionId}:${intentText.length}`, focusRefs, intentText }).context;
}
function social(npcRef, basis) {
  return { mode: 'adjudication', basisRefs: [npcRef], terminal: null,
    adjudication: { kind: 'directSuccess', durationMicros: '300000000', risk: '普通交谈。', successOutcome: '对方作答。' },
    proposals: [{ kind: 'social', basisRefs: [npcRef], consumes: [{ kind: 'existing', ref: npcRef }], produces: [], outcomeBinding: 'always', sceneRef: SCENE,
      npcRef, addressedThreadRef: null, goal: '打听铜钥。', method: '当面询问。', communication: 'spokenConversation', audience: 'participants', retryChange: null,
      branches: { success: { outcomeCode: 'outcome:answered', summary: '对方作答。', response: { kind: 'speech', text: '铜钥的事我略知一二。',
        motive: '依据本人记忆作答。', basis }, consequences: [] }, failure: null } }] };
}
function lower(f, context, bundle) {
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle)));
  assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
  return lowerVNext2ProposalBundle({ ...f, rootActionId: context.binding.rootActionId, requiredContext: context, value: parsed.bundle });
}

test('an addressed NPC freezes background, actor-sourced, recent and topical bodies, and leaves the rest as directory lines', () => {
  const f = fixture('tiers'), context = freeze(f, '我问守夜人铜钥的下落。');
  const decision = npcDecisionContext(context.entries, NPC);
  assert.ok(decision, 'the addressed NPC keeps a complete, readable snapshot');
  assert.deepEqual(decision.knowledge.map(record => record.knowledgeRef).sort(), Object.values(REFS).filter(ref => !ref.startsWith('knowledge:actor')).sort(),
    'the directory lists every held record');
  assert.deepEqual(decision.unloadedKnowledgeRefs, [entryRef(NPC, REFS.oldUnrelated)]);
  for (const ref of [REFS.background, REFS.oldTopic, REFS.fromActor, REFS.recent]) {
    assert.ok(context.entries.some(entry => entry.kind === 'known' && entry.entryRef === entryRef(NPC, ref)), ref);
    assert.equal(npcDecisionEvidenceRef(decision, entryRef(NPC, ref)), entryRef(NPC, ref));
  }
  assert.ok(!context.entries.some(entry => entry.entryRef === entryRef(NPC, REFS.oldUnrelated)), 'an unloaded body has no entry at all');
  assert.equal(npcDecisionEvidenceRef(decision, entryRef(NPC, REFS.oldUnrelated)), undefined);
  assert.doesNotMatch(JSON.stringify(context), /OLD_UNRELATED/);
  const choices = proposalNpcSourceChoices(context).find(choice => choice.npcRef === NPC).refs;
  assert.ok(choices.includes(entryRef(NPC, REFS.oldTopic)));
  assert.ok(!choices.includes(entryRef(NPC, REFS.oldUnrelated)));
  const presented = proposalModelContext(context).entries.find(entry => entry.entryRef === npcDecisionEntryRef(NPC)).value;
  assert.deepEqual(presented.knowledge.filter(record => !record.loaded).map(record => record.entryRef), [entryRef(NPC, REFS.oldUnrelated)]);
  assert.equal(Object.hasOwn(presented, 'unloadedKnowledgeRefs'), false);
  // The actor's own memory follows the same tiers; its catalog stays complete.
  assert.ok(context.entries.some(entry => entry.entryRef === entryRef(ACTOR, REFS.actorRecent)));
  assert.ok(!context.entries.some(entry => entry.entryRef === entryRef(ACTOR, REFS.actorOld)));
  const catalog = context.entries.find(entry => entry.entryRef === `knowledge-catalog:${ACTOR}`).value;
  assert.deepEqual(catalog.records.map(record => record.knowledgeRef).sort(), [REFS.actorOld, REFS.actorRecent].sort());
});

test('a body the words did not reach cannot be cited as a social basis, and a loaded one can', () => {
  const f = fixture('citation'), context = freeze(f, '我问守夜人铜钥的下落。');
  const accepted = lower(f, context, social(NPC, [{ kind: 'npcContext', ref: entryRef(NPC, REFS.oldTopic) }]));
  assert.equal(accepted.kind, 'accepted', JSON.stringify(accepted));
  const rejected = lower(f, context, social(NPC, [{ kind: 'npcContext', ref: entryRef(NPC, REFS.oldUnrelated) }]));
  assert.equal(rejected.kind, 'rejected', JSON.stringify(rejected));
  assert.equal(rejected.code, 'PROPOSAL_REFERENCE_INVALID');
});

test('the same words reach an old record through the topic they name, and different words leave it unloaded', () => {
  const f = fixture('topic');
  const bridge = freeze(f, '我问守夜人当年那座桥的事。');
  const decision = npcDecisionContext(bridge.entries, NPC);
  assert.ok(decision);
  assert.deepEqual(decision.unloadedKnowledgeRefs, [entryRef(NPC, REFS.oldTopic)]);
  assert.ok(bridge.entries.some(entry => entry.entryRef === entryRef(NPC, REFS.oldUnrelated)), 'the bridge memory is reached by its words');
});

test('the selector is deterministic and reports overflow without returning a partial selection', () => {
  const f = fixture('selector'), budget = createContextWorkBudget();
  const indexed = buildReferenceIndex(f.state, budget);
  assert.equal(indexed.kind, 'indexed');
  const select = createKnowledgeSelector({ state: f.state, index: indexed.index, actorCharacterId: ACTOR, intentText: '我问守夜人铜钥的下落。', candidates: [{ ref: NPC, purpose: 'objectIdentification', matchKind: 'alias', matchedTerms: ['守夜人'], score: 1 }] });
  const first = select(NPC), again = select(NPC);
  assert.deepEqual(first, again);
  assert.deepEqual(first.unloaded, [REFS.oldUnrelated]);
  assert.deepEqual(first.loaded.slice(0, 4).sort(), [REFS.background, REFS.fromActor, REFS.recent, REFS.oldTopic].sort());
  const capped = createKnowledgeSelector({ state: f.state, index: indexed.index, actorCharacterId: ACTOR, intentText: '我问守夜人铜钥的下落。', candidates: [],
    profile: { ...VNEXT_KNOWLEDGE_RELEVANCE_PROFILE, maxLoadedRecords: 2 } })(NPC);
  assert.deepEqual(capped, { kind: 'budgetExceeded', holderRef: NPC });
});

test('relevant knowledge count, characters and UTF-8 body overflow block freezing for NPCs and the actor', () => {
  for (const holder of [NPC, ACTOR]) for (const limit of ['count', 'characters', 'bytes']) {
    const f = createAuthoredProbeFixture(`knowledge-overflow:${holder}:${limit}`, {
      npcCharacters: [{ id: NPC, name: '守夜人' }],
      initialKnowledge: [held(holder, 'knowledge:overflow:0', '前提')],
    });
    const original = f.state.knowledge[holder]['knowledge:overflow:0'];
    for (let i = 0; i < (limit === 'count' ? 41 : 1); i++) {
      const knowledgeRef = `knowledge:overflow:${i}`;
      f.state.knowledge[holder][knowledgeRef] = { ...original, knowledgeRef,
        content: limit === 'characters' ? '密'.repeat(64_001) : limit === 'bytes' ? '密'.repeat(22_000) : `前提 ${i}` };
    }
    assert.throws(() => freeze(f, '我问守夜人这些前提。'), error => {
      assert.equal(error.code, 'PROBE_CONTEXT_BINDING_FAILED');
      assert.equal(error.diagnostics.reason, 'contextBudgetExceeded');
      assert.ok(error.diagnostics.issues.includes(limit === 'bytes'
        ? `knowledge:${holder}:knowledge:overflow:0:body-budget-exceeded`
        : `knowledge:${holder}:relevance-budget-exceeded`));
      return true;
    });
  }
});

test('mentioning an NPC as the topic retains the other visible respondent and their usable knowledge', () => {
  const topic = 'npc:review:varo', respondent = 'npc:review:lian', knowledgeRef = 'knowledge:witness';
  const f = createAuthoredProbeFixture('knowledge-topic-addressee', {
    npcCharacters: [{ id: topic, name: '瓦罗' }, { id: respondent, name: '莉安' }],
    initialKnowledge: [held(respondent, knowledgeRef, '昨晚瓦罗去了河岸。')],
  });
  const context = freeze(f, '我问其他人，瓦罗昨晚去了哪里？');
  assert.ok(npcDecisionContext(context.entries, respondent));
  const bundle = social(respondent, [{ kind: 'npcContext', ref: entryRef(respondent, knowledgeRef) }]);
  Object.assign(bundle.proposals[0], { goal: '打听瓦罗的去向。', method: '向其他人当面询问。' });
  Object.assign(bundle.proposals[0].branches.success.response, { text: '昨晚瓦罗去了河岸。' });
  const result = lower(f, context, bundle);
  assert.equal(result.kind, 'accepted', JSON.stringify(result));
});
