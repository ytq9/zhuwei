import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { proposalNpcSourceChoices, proposalModelContext, proposalContextView } from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { npcDecisionContext, npcDecisionEntryRef, npcDecisionEvidenceRef } from '../app/_runtime/lib/rules/v2/npc-decision-context.ts';
import { characterTimelineId } from '../app/_runtime/lib/rules/v2/timeline.ts';
import { encodeVNextStrictToolBundle } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { createKnowledgeSelector, VNEXT_KNOWLEDGE_RELEVANCE_PROFILE, KNOWLEDGE_DIRECTORY_SCHEMA, knowledgeDirectoryEntryRef, knowledgeGist } from '../app/_runtime/lib/kp/vnext/context/knowledge-relevance.ts';
import { buildReferenceIndex } from '../app/_runtime/lib/kp/vnext/context/reference-index.ts';
import { createContextWorkBudget } from '../app/_runtime/lib/kp/vnext/context/work-budget.ts';

// Held knowledge grows with play. The holder's directory is always frozen
// whole; bodies travel by the current topic: the words of the action and the
// names they reached decide which memories are read, a scheduled plan's
// premises are the one exception, and everything else stays on the server
// behind a short directory of gists that cannot be cited or paraphrased. Who
// the holder is, what it wants and how it stands with the actor are records of
// its decision view and always travel with it.
const NPC = 'npc:relevance:keeper';
const HOUR = 3_600_000_000n, DAY = 24n * HOUR;
const REFS = { background: 'knowledge:background', oldUnrelated: 'knowledge:old-unrelated', oldTopic: 'knowledge:old-copper-key',
  fromActor: 'knowledge:from-actor', recent: 'knowledge:recent', actorOld: 'knowledge:actor-old', actorRecent: 'knowledge:actor-recent' };
const held = (characterId, knowledgeRef, content) => ({ characterId, knowledgeRef, content, kind: 'sourceClaim', layer: 'partial',
  visibility: 'private', provenanceChain: ['genesis:probe'] });

function fixture(label) {
  const f = createAuthoredProbeFixture(`knowledge-relevance:${label}`, { npcCharacters: [{ id: NPC, name: '守夜人' }],
    initialKnowledge: [
      held(NPC, REFS.background, 'BACKGROUND_从小在镇上长大，认得每一户人家。'),
      held(NPC, REFS.oldUnrelated, 'OLD_UNRELATED_三年前的一场大雨冲垮了桥。'),
      held(NPC, REFS.oldTopic, 'OLD_TOPIC_赫斯把铜钥交给了女儿保管。'),
      held(NPC, REFS.fromActor, 'FROM_ACTOR_外乡人说自己来自剑湾。'),
      held(NPC, REFS.recent, 'RECENT_今晚酒馆里没有陌生面孔。'),
      held(ACTOR, REFS.actorOld, 'ACTOR_OLD_很久以前听过的传闻。'),
      held(ACTOR, REFS.actorRecent, 'ACTOR_RECENT_刚才有人说铜钥在女儿手里。'),
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

test('an addressed NPC freezes its complete memory, and the model is sent the bodies the topic reaches plus a handle directory', () => {
  const f = fixture('topic'), context = freeze(f, '我问守夜人铜钥的下落。');
  const decision = npcDecisionContext(context.entries, NPC);
  assert.ok(decision, 'the addressed NPC keeps a complete, readable snapshot');
  assert.deepEqual(decision.knowledge.map(record => record.knowledgeRef).sort(), Object.values(REFS).filter(ref => !ref.startsWith('knowledge:actor')).sort(),
    'the directory lists every held record');
  // Every body of an addressed NPC is frozen and verified once.
  assert.equal(decision.unloadedKnowledgeRefs, undefined);
  for (const ref of Object.values(REFS).filter(ref => !ref.startsWith('knowledge:actor'))) {
    assert.ok(context.entries.some(entry => entry.kind === 'known' && entry.entryRef === entryRef(NPC, ref)), ref);
  }
  // Only the copper-key memory is about this topic; the other four wait
  // behind the directory with handles the selection can name.
  const hidden = [REFS.background, REFS.fromActor, REFS.oldUnrelated, REFS.recent].map(ref => entryRef(NPC, ref)).sort();
  const directory = context.entries.find(entry => entry.entryRef === knowledgeDirectoryEntryRef(NPC));
  assert.ok(directory && directory.kind === 'known');
  assert.equal(directory.value.schema, KNOWLEDGE_DIRECTORY_SCHEMA);
  assert.deepEqual(directory.value.unloaded.map(record => record.entryRef), hidden);
  for (const record of directory.value.unloaded) {
    assert.ok([...record.gist].length <= VNEXT_KNOWLEDGE_RELEVANCE_PROFILE.gistCharacters + 1, record.gist);
    assert.match(record.handle, /^m[1-9][0-9]*$/);
  }
  assert.deepEqual(context.references.knowledgeRecall.find(entry => entry.holderRef === NPC).records.map(record => record.entryRef), hidden);
  assert.ok(context.references.citations.nonCitableRefs.includes(knowledgeDirectoryEntryRef(NPC)));
  // The gist opens the memory; the rest of its body is not sent.
  const sent = proposalModelContext(context);
  assert.match(JSON.stringify(sent), /OLD_UNRELATED_三年前/);
  assert.doesNotMatch(JSON.stringify(sent), /冲垮了桥/);
  const view = sent.entries.find(entry => entry.entryRef === npcDecisionEntryRef(NPC)).value;
  assert.deepEqual(view.knowledge.map(record => record.entryRef), [entryRef(NPC, REFS.oldTopic)]);
  assert.equal(view.unloadedKnowledgeCount, 4);
  assert.equal(Object.hasOwn(view, 'unloadedKnowledgeRefs'), false);
  assert.ok(!sent.entries.some(entry => entry.entryRef === entryRef(NPC, REFS.oldUnrelated)));
  assert.ok(!sent.entries.some(entry => entry.entryRef.startsWith('knowledge-catalog:')), 'catalogs bind versions for Rules, not for the model');
  const choices = proposalNpcSourceChoices(proposalContextView(context)).find(choice => choice.npcRef === NPC).refs;
  assert.ok(choices.includes(entryRef(NPC, REFS.oldTopic)));
  assert.ok(!choices.includes(entryRef(NPC, REFS.oldUnrelated)));
  // Naming a handle sends that body and lets the forms cite it.
  const handle = directory.value.unloaded.find(record => record.entryRef === entryRef(NPC, REFS.oldUnrelated)).handle;
  assert.ok(sent.references.knowledgeRecall.requestable.includes(handle));
  const read = proposalModelContext(context, [], [entryRef(NPC, REFS.oldUnrelated)]);
  assert.match(JSON.stringify(read), /冲垮了桥/);
  assert.deepEqual(read.entries.find(entry => entry.entryRef === npcDecisionEntryRef(NPC)).value.knowledge.map(record => record.entryRef).sort(),
    [entryRef(NPC, REFS.oldTopic), entryRef(NPC, REFS.oldUnrelated)].sort());
  assert.ok(!read.references.knowledgeRecall.requestable.includes(handle));
  assert.deepEqual(read.references.knowledgeRecall.shown, [entryRef(NPC, REFS.oldUnrelated)]);
  assert.ok(proposalNpcSourceChoices(proposalContextView(context, [], [entryRef(NPC, REFS.oldUnrelated)])).find(choice => choice.npcRef === NPC).refs.includes(entryRef(NPC, REFS.oldUnrelated)));
  // The actor's own memory is frozen whole too and sent by topic.
  assert.ok(context.entries.some(entry => entry.entryRef === entryRef(ACTOR, REFS.actorOld)));
  assert.ok(sent.entries.some(entry => entry.entryRef === entryRef(ACTOR, REFS.actorRecent)), 'the topical actor memory is sent');
  assert.ok(!sent.entries.some(entry => entry.entryRef === entryRef(ACTOR, REFS.actorOld)));
  const catalog = context.entries.find(entry => entry.entryRef === `knowledge-catalog:${ACTOR}`).value;
  assert.deepEqual(catalog.records.map(record => record.knowledgeRef).sort(), [REFS.actorOld, REFS.actorRecent].sort());
  assert.deepEqual(context.entries.find(entry => entry.entryRef === knowledgeDirectoryEntryRef(ACTOR)).value.unloaded.map(record => record.entryRef), [entryRef(ACTOR, REFS.actorOld)]);
});

test('an NPC the words do not address freezes only the bodies the topic reaches, and the rest stay bare directory lines', () => {
  const f = fixture('bystander'), context = freeze(f, '我打听铜钥的下落。');
  const decision = npcDecisionContext(context.entries, NPC);
  assert.ok(decision);
  assert.deepEqual(decision.unloadedKnowledgeRefs, [REFS.background, REFS.fromActor, REFS.oldUnrelated, REFS.recent].map(ref => entryRef(NPC, ref)).sort());
  assert.ok(context.entries.some(entry => entry.entryRef === entryRef(NPC, REFS.oldTopic)));
  assert.ok(!context.entries.some(entry => entry.entryRef === entryRef(NPC, REFS.oldUnrelated)), 'an unreached body has no entry at all');
  assert.doesNotMatch(JSON.stringify(context), /冲垮了桥/);
  const directory = context.entries.find(entry => entry.entryRef === knowledgeDirectoryEntryRef(NPC)).value;
  assert.equal(directory.unloaded.length, 4);
  assert.ok(directory.unloaded.every(record => record.handle === undefined), 'nothing to request: the bodies were never frozen');
  assert.equal(context.references.knowledgeRecall.some(entry => entry.holderRef === NPC), false);
  assert.deepEqual(context.references.npcRecall.map(entry => [entry.npcRef, entry.role]), [[NPC, 'requestable']]);
});

test('a body that was never frozen cannot be cited as a social basis, and a frozen one can', () => {
  const f = fixture('citation'), context = freeze(f, '我打听铜钥的下落。');
  const accepted = lower(f, context, social(NPC, [{ kind: 'npcContext', ref: entryRef(NPC, REFS.oldTopic) }]));
  assert.equal(accepted.kind, 'accepted', JSON.stringify(accepted));
  const rejected = lower(f, context, social(NPC, [{ kind: 'npcContext', ref: entryRef(NPC, REFS.oldUnrelated) }]));
  assert.equal(rejected.kind, 'rejected', JSON.stringify(rejected));
  assert.equal(rejected.code, 'PROPOSAL_REFERENCE_INVALID');
});

test('different words reach a different memory, and a name in the words reaches memories that mention it', () => {
  const f = fixture('bridge');
  const bridge = freeze(f, '我问守夜人当年那座桥的事。');
  const decision = npcDecisionContext(bridge.entries, NPC);
  assert.ok(decision);
  assert.ok(bridge.entries.some(entry => entry.entryRef === entryRef(NPC, REFS.oldUnrelated)), 'the bridge memory is reached by its words');
  assert.ok(decision.unloadedKnowledgeRefs.includes(entryRef(NPC, REFS.oldTopic)), 'the key memory stays on the server');
  const named = freeze(f, '我问守夜人镇上的人家。');
  assert.ok(named.entries.some(entry => entry.entryRef === entryRef(NPC, REFS.background)), 'background is read when the words reach it');
});

test('the selector is deterministic, orders by topic score, and caps overflow only', () => {
  const f = fixture('selector'), budget = createContextWorkBudget();
  const indexed = buildReferenceIndex(f.state, budget);
  assert.equal(indexed.kind, 'indexed');
  const select = createKnowledgeSelector({ state: f.state, index: indexed.index, actorCharacterId: ACTOR, intentText: '我问守夜人铜钥的下落。', candidates: [{ ref: NPC, purpose: 'objectIdentification', matchKind: 'alias', matchedTerms: ['守夜人'], score: 1 }] });
  const first = select(NPC), again = select(NPC);
  assert.deepEqual(first, again);
  assert.deepEqual(first.loaded, [REFS.oldTopic]);
  assert.deepEqual(first.unloaded, [REFS.background, REFS.fromActor, REFS.oldUnrelated, REFS.recent].sort());
  const capped = createKnowledgeSelector({ state: f.state, index: indexed.index, actorCharacterId: ACTOR, intentText: '我问守夜人铜钥、桥和剑湾的事。', candidates: [],
    profile: { ...VNEXT_KNOWLEDGE_RELEVANCE_PROFILE, maxLoadedRecords: 2 } })(NPC);
  assert.equal(capped.loaded.length, 2);
  assert.equal(capped.unloaded.length, 3);
  assert.equal(knowledgeGist({ content: '一二三四五六七八九十一二三四五六七八九十一二三四五六' }).length, VNEXT_KNOWLEDGE_RELEVANCE_PROFILE.gistCharacters + 1);
  assert.equal(knowledgeGist({ content: '  短  文 ' }), '短 文');
});
