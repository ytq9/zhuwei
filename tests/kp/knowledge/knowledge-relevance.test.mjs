import assert from 'node:assert/strict';
import test from 'node:test';
import { stepActionToDecision } from '../../support/fixtures/vnext-action-lifecycle.mjs';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { proposalNpcSourceChoices, proposalModelContext, proposalContextView, recallKnowledge, withRecalledKnowledge } from '../../../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { authorityRevisionOrHash } from '../../../app/_runtime/lib/rules/v2/authority-bindings.ts';
import { npcDecisionContext, npcDecisionEntryRef, freezeNpcDecisionEntry, NPC_DECISION_CONTEXT_SCHEMA, NPC_DECISION_CONTEXT_RECENT_SCHEMA,
  NPC_DECISION_CONTEXT_FULL_SCHEMA } from '../../../app/_runtime/lib/rules/v2/npc-decision-context.ts';
import { buildRequiredContext } from '../../../app/_runtime/lib/kp/vnext/required-context.ts';
import { canonicalHash } from '../../../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { encodeVNextStrictToolBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { lowerVNext2ProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { createKnowledgeSelector, recentInterlocutor, VNEXT_KNOWLEDGE_RELEVANCE_PROFILE, KNOWLEDGE_DIRECTORY_SCHEMA, knowledgeDirectoryEntryRef, knowledgeGist } from '../../../app/_runtime/lib/kp/vnext/context/knowledge-relevance.ts';
import { buildReferenceIndex } from '../../../app/_runtime/lib/kp/vnext/context/reference-index.ts';
import { createContextWorkBudget } from '../../../app/_runtime/lib/kp/vnext/context/work-budget.ts';
import { parseWithNpcReplies } from '../../support/fixtures/vnext-npc-replies.mjs';
import { geometry } from '../../support/fixtures/historical-world.mjs';
import { proposalKnowledgeRecall, npcOwnModelView, vnextProposalContextBody, proposalItemEntryRefs, proposalObservationSubjectRefs,
  proposalCreatureTargetRefs, proposalItemDefinitionRefs, proposalUnofferedCapabilities } from '../../../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { createVNextProposalOfferModelInput, createSubmitKpProposalBundleModelInput, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  VNEXT_ALWAYS_OFFERED_TERMINAL_KINDS } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseVNextProposalOfferResponse, vnextProposalAmendmentRequest } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { assertVNextInvocationTransition } from '../../../app/_runtime/lib/room/vnext-proposal-invocation.ts';
import { requiredContextBasisReferences } from '../../../app/_runtime/lib/kp/vnext/required-context-runtime.ts';
import { conservativeInputTokens } from '../../../app/_runtime/lib/kp/vnext/invocation/budget.ts';
import { DEFAULT_KP_MODEL } from '../../../app/_runtime/lib/kp/models.ts';
import { kpRequestBody } from '../../../app/_runtime/lib/kp/model-request.ts';

// SPEC 0016 §7.3, SPEC 0006 §7 (ADR 0073): the ruling's form holds no reply; each
// NPC answers in its own call. The complete plan is the ruling with the
// replies the domain bundle states.
const parseComplete = value => parseWithNpcReplies(encodeVNextStrictToolBundle(value), value);

// SPEC 0016 §4.2: held knowledge grows with play, and a request must not grow
// with it. A holder's directory is always frozen whole. Each holder's latest
// six rounds of play travel in full (the user's limit, ADR 0048), background
// the module gave before play travels when the words reach it, and a
// scheduled plan's premises always travel. Older play memories wait behind a
// directory of gists with handles the selection can name, and what they
// perceived or said leaves the NPC's view with them.
const NPC = 'npc:relevance:keeper', OTHER = 'npc:relevance:ferryman';
const ROUND = 300_000_000n;
const BACKGROUND = 'knowledge:background', LORE = 'knowledge:lore-copper-key';
const held = (characterId, knowledgeRef, content) => ({ characterId, knowledgeRef, content, kind: 'sourceClaim', layer: 'partial',
  visibility: 'private', provenanceChain: ['genesis:probe'] });
const entryRef = (holder, ref) => `knowledge:${holder}:${ref}`;
/** ADR 0051: what a stage names by handle is read from authority at the
 * version the frozen directory recorded, as Room does; a group named is
 * listed first (ADR 0115). */
const recall = (context, state, refs) => withRecalledKnowledge(context, recallKnowledge(context, refs, state));

/** Memories acquired in play at distinct rounds: the NPC's first round mentions
 * the copper key, as does the actor's; the NPC's last round holds two. */
function fixture(label, { npcRounds = 8, actorRounds = 7 } = {}) {
  const f = createAuthoredProbeFixture(`knowledge-relevance:${label}`, {
    npcCharacters: [{ id: NPC, name: '守夜人' }, { id: OTHER, name: '摆渡人' }],
    initialKnowledge: [held(NPC, BACKGROUND, 'BACKGROUND_从小在镇上长大，认得每一户人家。'), held(NPC, LORE, 'LORE_赫斯把铜钥交给了女儿保管。')],
  });
  const state = structuredClone(f.state);
  let seq = 0;
  const play = (holder, round, knowledgeRef, content, extra = {}) => {
    state.knowledge[holder][knowledgeRef] = { characterId: holder, knowledgeRef, objectKind: 'sourceClaim', layer: 'full', content,
      visibility: 'private', acquiredByEventId: `event:epoch:${++seq}`, acquiredAtFictionMicros: String(BigInt(round) * ROUND),
      sourceCharacterId: null, provenanceChain: [knowledgeRef, `event:epoch:${seq}`], ...extra };
    return knowledgeRef;
  };
  const npc = [], actor = [];
  for (let round = 1; round <= npcRounds; round++) {
    npc.push(play(NPC, round, `knowledge:npc-round-${round}`, `NPC_ROUND_${round}_${round === 1 ? '外乡人进门后先绕着大厅走了一圈，才问过铜钥在哪里。' : '寻常的闲谈。'}`));
  }
  const second = play(NPC, npcRounds, `knowledge:npc-round-${npcRounds}-second`, `NPC_ROUND_${npcRounds}_SECOND_同一轮里他还点了灯。`);
  for (let round = 1; round <= actorRounds; round++) {
    actor.push(play(ACTOR, round, `knowledge:actor-round-${round}`, `ACTOR_ROUND_${round}_${round === 1 ? '很久以前听过铜钥的传闻。' : '随口一问。'}`));
  }
  const now = String(BigInt(Math.max(npcRounds, actorRounds)) * ROUND);
  for (const id of Object.keys(state.fictionTimelines)) state.fictionTimelines[id].nowMicros = now;
  return { ...f, state, npc, actor, second, play };
}
function freeze(f, intentText, focusRefs = [], state = f.state) {
  return freezeAuthoredProbeContext(f, state, { rootActionId: `${f.rootActionId}:${intentText.length}:${state.version}`, focusRefs, intentText }).context;
}
function selector(f, intentText, extra = {}) {
  const indexed = buildReferenceIndex(f.state, createContextWorkBudget());
  assert.equal(indexed.kind, 'indexed');
  return createKnowledgeSelector({ state: f.state, index: indexed.index, actorCharacterId: ACTOR, intentText, candidates: [], ...extra });
}

test("each holder's latest six rounds travel in full, background by the words, and older play memories stay behind handles", () => {
  const f = fixture('rounds'), select = selector(f, '我问守夜人铜钥的下落。');
  const npc = select(NPC);
  // Rounds 3–8 are the NPC's latest six; round 8 holds two memories.
  assert.deepEqual([...npc.loaded].sort(), [...f.npc.slice(2), f.second, LORE].sort());
  // The first round names the copper key, yet it is older than six rounds:
  // words no longer reach an old play memory, only its handle does.
  assert.deepEqual(npc.unloaded, [BACKGROUND, f.npc[0], f.npc[1]].sort());
  assert.deepEqual(select(NPC), npc, 'deterministic');
  // The actor's own memories follow the same rule.
  const actor = select(ACTOR);
  assert.deepEqual([...actor.loaded].sort(), f.actor.slice(1).sort());
  assert.deepEqual(actor.unloaded, [f.actor[0]]);
  // Background the words do not reach stays behind its handle too.
  assert.ok(!selector(f, '我问守夜人今晚的天气。')(NPC).loaded.includes(LORE));
  assert.ok(selector(f, '我问守夜人镇上的人家。')(NPC).loaded.includes(BACKGROUND));
});

test("a scheduled plan's premise travels however old, and the caps only stop overflow", () => {
  const f = fixture('premise');
  f.state.campaignRuntime.npcPlans['plan:relevance:watch'] = { planId: 'plan:relevance:watch', npcId: NPC, status: 'scheduled', premiseRefs: [f.npc[0]] };
  assert.ok(selector(f, '你好。')(NPC).loaded.includes(f.npc[0]));
  const capped = selector(f, '你好。', { profile: { ...VNEXT_KNOWLEDGE_RELEVANCE_PROFILE, maxLoadedRecords: 3 } })(NPC);
  assert.equal(capped.loaded.length, 3);
  assert.equal(capped.loaded.length + capped.unloaded.length, Object.keys(f.state.knowledge[NPC]).length);
  assert.equal(knowledgeGist({ content: '一二三四五六七八九十一二三四五六七八九十一二三四五六' }).length, VNEXT_KNOWLEDGE_RELEVANCE_PROFILE.gistCharacters + 1);
  assert.equal(knowledgeGist({ content: '  短  文 ' }), '短 文');
});

test('an addressed NPC freezes its whole memory; the model reads its six rounds and a gist directory, and a handle brings back the rest', () => {
  const f = fixture('addressed'), context = freeze(f, '我问守夜人铜钥的下落。');
  const decision = npcDecisionContext(context.entries, NPC);
  assert.ok(decision, 'the addressed NPC keeps a complete, readable snapshot');
  const old = [BACKGROUND, f.npc[0], f.npc[1]].map(ref => entryRef(NPC, ref)).sort();
  // ADR 0051: the unread memories are not frozen. ADR 0115: the view lists the
  // memories it read; its catalog record counts them all, and that record's
  // version, the complete catalog's hash, binds every one.
  assert.deepEqual(decision.knowledge.map(record => record.entryRef), [...f.npc.slice(2), f.second, LORE].map(ref => entryRef(NPC, ref)).sort());
  assert.equal(decision.unloadedKnowledgeRefs, undefined);
  const catalog = decision.records.find(record => record.kind === 'knowledgeCatalog');
  assert.deepEqual(catalog.value, { schema: 'zhuwei.held-knowledge-catalog/vnext-2', characterId: NPC, count: Object.keys(f.state.knowledge[NPC]).length });
  assert.equal(catalog.revisionOrHash, authorityRevisionOrHash(f.state, `knowledge-catalog:${NPC}`));
  for (const ref of old) assert.ok(!context.entries.some(entry => entry.entryRef === ref), ref);
  const directory = context.entries.find(entry => entry.entryRef === knowledgeDirectoryEntryRef(NPC));
  assert.equal(directory?.value.schema, KNOWLEDGE_DIRECTORY_SCHEMA);
  const recallRecords = context.references.knowledgeRecall.find(entry => entry.holderRef === NPC).records;
  assert.deepEqual(recallRecords.map(record => record.entryRef), old);
  assert.ok(recallRecords.every(record => /^sha256:[0-9a-f]{64}$/.test(record.revisionOrHash)), 'each unread memory carries its version');
  assert.deepEqual(directory.value.unloaded.map(line => line.handle), recallRecords.map(record => record.handle), 'a line is a gist and a handle');
  assert.ok(directory.value.unloaded.every(line => Object.keys(line).sort().join() === 'gist,handle'));
  assert.ok(context.references.citations.nonCitableRefs.includes(knowledgeDirectoryEntryRef(NPC)));

  const sent = proposalModelContext(context);
  const view = sent.entries.find(entry => entry.entryRef === npcDecisionEntryRef(NPC)).value;
  assert.deepEqual([...view.knowledge].sort(), [...f.npc.slice(2), f.second, LORE].map(ref => entryRef(NPC, ref)).sort());
  assert.equal(view.unloadedKnowledgeCount, 3);
  // A directory line is its gist and its handle; the refs of an unread body
  // cannot be cited, so they are not sent.
  const lines = sent.entries.find(entry => entry.entryRef === knowledgeDirectoryEntryRef(NPC)).value.unloaded;
  assert.ok(lines.every(line => Object.keys(line).sort().join() === 'gist,handle' && /^m[1-9][0-9]*$/.test(line.handle)), JSON.stringify(lines));
  assert.ok(lines.some(line => line.gist.startsWith('NPC_ROUND_1_外乡人进门')));
  assert.doesNotMatch(JSON.stringify(sent), /问过铜钥在哪里/);
  // A sent memory keeps what it says and drops the ids its entry names.
  const memory = sent.entries.find(entry => entry.entryRef === entryRef(NPC, f.npc[7])).value;
  assert.deepEqual(Object.keys(memory).sort(), ['acquiredAtFictionMicros', 'content', 'layer', 'objectKind', 'sourceCharacterId', 'visibility']);
  assert.ok(!sent.entries.some(entry => entry.entryRef.startsWith('knowledge-catalog:')), 'catalogs bind versions for Rules, not for the model');

  // Naming a handle sends that body and lets the forms cite it.
  const handle = recallRecords.find(record => record.entryRef === entryRef(NPC, f.npc[0])).handle;
  assert.ok(sent.references.knowledgeRecall.requestable.includes(handle));
  assert.ok(!proposalNpcSourceChoices(proposalContextView(context)).find(choice => choice.npcRef === NPC).refs.includes(entryRef(NPC, f.npc[0])));
  const recalled = recall(context, f.state, [entryRef(NPC, f.npc[0])]);
  assert.equal(recalled.binding.contextHash, context.binding.contextHash, 'the frozen binding stands');
  const read = proposalModelContext(recalled, [], [entryRef(NPC, f.npc[0])]);
  assert.match(JSON.stringify(read), /问过铜钥在哪里/);
  assert.ok(read.entries.find(entry => entry.entryRef === npcDecisionEntryRef(NPC)).value.knowledge.includes(entryRef(NPC, f.npc[0])));
  assert.deepEqual(read.references.knowledgeRecall.shown, [entryRef(NPC, f.npc[0])]);
  assert.ok(proposalNpcSourceChoices(proposalContextView(recalled, [], [entryRef(NPC, f.npc[0])])).find(choice => choice.npcRef === NPC).refs.includes(entryRef(NPC, f.npc[0])));
  // Lowering reads the frozen context with what was brought back; a body
  // that was not brought back is never citable.
  assert.equal(lower(f, recalled, social(NPC, 1, [{ kind: 'npcContext', ref: entryRef(NPC, f.npc[0]) }])).kind, 'accepted');
  assert.equal(lower(f, context, social(NPC, 1, [{ kind: 'npcContext', ref: entryRef(NPC, f.npc[0]) }])).kind, 'rejected');
  // A body at another version than the directory recorded is refused.
  const changed = structuredClone(f.state);
  changed.knowledge[NPC][f.npc[0]].content = '改过的内容。';
  assert.throws(() => recall(context, changed, [entryRef(NPC, f.npc[0])]), /knowledge-recall:body-changed/);
  // The actor's own directory: its first round only.
  assert.deepEqual(context.references.knowledgeRecall.find(entry => entry.holderRef === ACTOR).records.map(record => record.entryRef), [entryRef(ACTOR, f.actor[0])]);
  // The actor may cite its memory by entry ref or by bare ref; an unread one
  // by neither, until its handle is named.
  const actorCites = view => new Set(view.references.citations.viewerEvidenceRefs);
  const unread = actorCites(proposalContextView(context));
  const readBack = actorCites(proposalContextView(recall(context, f.state, [entryRef(ACTOR, f.actor[0])]), [], [entryRef(ACTOR, f.actor[0])]));
  for (const ref of [entryRef(ACTOR, f.actor[0]), f.actor[0]]) {
    assert.equal(unread.has(ref), false, ref);
    assert.equal(readBack.has(ref), true, ref);
  }
  assert.ok(unread.has(f.actor[1]) && unread.has(entryRef(ACTOR, f.actor[1])), 'a read memory stays citable both ways');
});

test('an NPC the words do not reach, and whom the actor has not heard lately, waits for the selection to name it', () => {
  const f = fixture('bystander'), context = freeze(f, '我打听铜钥的下落。');
  assert.deepEqual(context.references.npcRecall.map(entry => [entry.npcRef, entry.role]), [[OTHER, 'requestable'], [NPC, 'requestable']]);
  const sent = proposalModelContext(context);
  assert.ok(!sent.entries.some(entry => entry.entryRef === npcDecisionEntryRef(NPC) || entry.entryRef.startsWith(`knowledge:${NPC}:`) || entry.entryRef === knowledgeDirectoryEntryRef(NPC)));
  const requested = proposalModelContext(context, [NPC]);
  assert.equal(requested.entries.find(entry => entry.entryRef === npcDecisionEntryRef(NPC)).value.knowledge.length, 8);
});

// The words name nobody, yet "you" speaks to someone: the NPC the actor last
// heard or watched in its recent rounds, if that NPC is still here.
test('an unnamed "you" goes to the NPC the actor last heard within its recent rounds', () => {
  const f = fixture('interlocutor', { actorRounds: 7 });
  const present = new Set([NPC, OTHER]);
  assert.equal(recentInterlocutor(f.state, ACTOR, present), undefined, 'the actor has heard nobody');
  f.play(ACTOR, 1, 'knowledge:heard-ferryman-long-ago', '摆渡人说过河要付钱。', { sourceCharacterId: OTHER });
  assert.equal(recentInterlocutor(f.state, ACTOR, present), undefined, 'a line older than six rounds does not count');
  f.play(ACTOR, 6, 'knowledge:heard-ferryman', '摆渡人说船在下游。', { sourceCharacterId: OTHER });
  f.play(ACTOR, 7, 'knowledge:heard-keeper', '守夜人说灯油快没了。', { sourceCharacterId: NPC });
  assert.equal(recentInterlocutor(f.state, ACTOR, present), NPC, 'the latest line wins');
  f.play(ACTOR, 7, 'knowledge:heard-ferryman-after', '摆渡人插了一句话。', { sourceCharacterId: OTHER });
  assert.equal(recentInterlocutor(f.state, ACTOR, present), OTHER, 'the same moment goes to the later event');
  assert.equal(recentInterlocutor(f.state, ACTOR, new Set([NPC])), NPC, 'only an NPC still here');

  const unnamed = freeze(f, '那你说说看，船什么时候回来？');
  assert.deepEqual(unnamed.references.npcRecall.map(entry => [entry.npcRef, entry.role]), [[OTHER, 'default'], [NPC, 'requestable']]);
  const named = freeze(f, '守夜人，你说说看，灯油还够用吗？');
  assert.deepEqual(named.references.npcRecall.map(entry => [entry.npcRef, entry.role]), [[OTHER, 'requestable'], [NPC, 'default']],
    'a named NPC is the addressee; the last speaker is not added');
});

test('a hidden truth only a bystander knows stays in the KP context; only a perception leaves with its memory', () => {
  const TRUTH = 'fact:relevance:key-in-drawer';
  const f = createAuthoredProbeFixture('knowledge-relevance:truth', { npcCharacters: [{ id: NPC, name: '守夜人' }] });
  const declared = stepActionToDecision(f.runtime, f.profiles, f.state, { kind: 'declareCanonicalFact', proposalId: `${f.rootActionId}:truth`,
    fact: { factId: TRUTH, factKind: 'physicalMark', source: 'characterAction', subjectRefs: [SCENE, NPC],
      value: { description: 'TRUTH_铜钥藏在柜台抽屉里。', condition: 'present' }, causalParentIds: [], visibilityPolicy: 'hiddenUntilEvidence' } });
  assert.equal(declared.kind, 'committed', JSON.stringify(declared));
  const state = structuredClone(declared.state);
  state.knowledge[NPC][TRUTH] = { characterId: NPC, knowledgeRef: TRUTH, objectKind: 'canonicalFact', layer: 'full', content: 'TRUTH_铜钥藏在柜台抽屉里。',
    visibility: 'private', acquiredByEventId: 'genesis:probe', acquiredAtFictionMicros: '0', sourceCharacterId: null, provenanceChain: ['genesis:probe'] };
  const context = freeze(f, '我翻找柜台。', [], state);
  assert.ok(context.entries.some(entry => entry.entryRef === TRUTH));
  assert.ok(context.entries.some(entry => entry.entryRef === entryRef(NPC, TRUTH)));
  assert.deepEqual(context.references.npcRecall.map(entry => [entry.npcRef, entry.role]), [[NPC, 'requestable']]);
  const sent = proposalModelContext(context);
  assert.ok(sent.entries.some(entry => entry.entryRef === TRUTH), 'the truth is not a perception of the unrequested NPC');
  assert.ok(!sent.entries.some(entry => entry.entryRef === entryRef(NPC, TRUTH)), "the NPC's memory still follows its view");
});

test('topical overflow past the caps stays requestable by handle, while a single oversized body blocks freezing', () => {
  for (const holder of [NPC, ACTOR]) for (const limit of ['count', 'characters', 'bytes']) {
    const f = createAuthoredProbeFixture(`knowledge-overflow:${holder}:${limit}`, {
      npcCharacters: [{ id: NPC, name: '守夜人' }],
      initialKnowledge: [held(holder, 'knowledge:overflow:0', '前提')],
    });
    const original = f.state.knowledge[holder]['knowledge:overflow:0'];
    for (let i = 0; i < (limit === 'count' ? 41 : 1); i++) {
      const knowledgeRef = `knowledge:overflow:${i}`;
      f.state.knowledge[holder][knowledgeRef] = { ...original, knowledgeRef,
        content: limit === 'characters' ? `前提${'密'.repeat(64_001)}` : limit === 'bytes' ? `前提${'密'.repeat(22_000)}` : `前提 ${i}` };
    }
    // A single body the words reach past the per-entry byte cap cannot be
    // frozen whole, so it blocks (a 64,001-character Han body is three times
    // that cap in UTF-8, and larger than the whole character allowance); many
    // small bodies past the count cap stay requestable by handle.
    if (limit !== 'count') {
      assert.throws(() => freeze(f, '我问守夜人这些前提。'), error => {
        assert.equal(error.code, 'PROBE_CONTEXT_BINDING_FAILED');
        assert.equal(error.diagnostics.reason, 'contextBudgetExceeded');
        assert.ok(error.diagnostics.issues.includes(`knowledge:${holder}:knowledge:overflow:0:body-budget-exceeded`), JSON.stringify(error.diagnostics));
        return true;
      });
      continue;
    }
    let context;
    try { context = freeze(f, '我问守夜人这些前提。'); } catch (error) { assert.fail(`${holder}:${limit}: ${JSON.stringify(error.diagnostics)}`); }
    const frozen = context.entries.filter(entry => entry.entryRef.startsWith(`knowledge:${holder}:`)).length;
    assert.equal(frozen, VNEXT_KNOWLEDGE_RELEVANCE_PROFILE.maxLoadedRecords, 'the read bodies are frozen');
    const handles = context.references.knowledgeRecall.find(entry => entry.holderRef === holder)?.records ?? [];
    const sent = proposalModelContext(context).entries.filter(entry => entry.entryRef.startsWith(`knowledge:${holder}:`)).length;
    assert.equal(sent + handles.length, 41, 'what is not sent is requestable');
    assert.equal(sent, VNEXT_KNOWLEDGE_RELEVANCE_PROFILE.maxLoadedRecords, `${limit}: sent ${sent}`);
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
  assert.deepEqual(context.references.npcRecall.map(entry => [entry.npcRef, entry.role]), [[respondent, 'requestable'], [topic, 'default']]);
  const bundle = social(respondent, 1, [{ kind: 'npcContext', ref: entryRef(respondent, knowledgeRef) }]);
  Object.assign(bundle.proposals[0].branches.success.response, { text: '昨晚瓦罗去了河岸。' });
  const result = lower(f, context, bundle);
  assert.equal(result.kind, 'accepted', JSON.stringify(result));
  assert.ok(proposalModelContext(context).references.npcRecall.requestable.includes(respondent));
  assert.ok(JSON.stringify(proposalModelContext(context, [respondent])).includes('昨晚瓦罗去了河岸'));
});

// The user's case: a conversation longer than six rounds. Each real round is
// the actor's line, the NPC's reply and what the NPC saw the actor do.
test('after eight real rounds the NPC view carries six, and a handle brings back a round\'s words and perception', () => {
  const f = createAuthoredProbeFixture('knowledge-relevance:conversation', { npcCharacters: [{ id: NPC, name: '守夜人' }, { id: OTHER, name: '摆渡人' }] });
  let state = f.state, resolved;
  for (let round = 1; round <= 8; round++) {
    const context = freeze(f, `我对守夜人说第${round}句话。`, [NPC], state);
    const lowered = lower({ ...f, state }, context, social(NPC, round, [{ kind: 'playerExpression' }],
      `ROUND_${round}_SAW_外乡人第${round}次抬手指向那盏灯，TAIL_${round}_SAW。`));
    assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
    const result = stepActionToDecision(f.runtime, f.profiles, state, lowered.command.rulesInput);
    assert.equal(result.kind, 'committed', JSON.stringify(result).slice(0, 500));
    state = result.state;
    resolved = result.events.find(event => event.eventType === 'WorldInteractionResolved');
  }
  // ADR 0050: the view Rules checks, and the round's event stores, holds the
  // claims and exchanges of the NPC's latest six rounds, not all of them. At
  // round 8 those are rounds 2–7. ADR 0115: it lists the memories it read
  // (rounds 2-7 here); its catalog record counts every memory held then.
  const frozenView = resolved.payload.social.plan.social.npcContext;
  assert.equal(frozenView.schema, 'zhuwei.npc-decision-context/vnext-3');
  assert.equal(frozenView.records.filter(record => record.kind === 'sourceClaim').length, 12);
  assert.equal(frozenView.records.filter(record => record.kind === 'conversation').length, 6);
  assert.equal(frozenView.knowledge.length, 18, 'the six rounds it read');
  assert.equal(frozenView.records.find(record => record.kind === 'knowledgeCatalog').value.count, Object.keys(state.knowledge[NPC]).length - 3,
    'the catalog counts every memory held then');
  const context = freeze(f, '那你还记得我最早问你的事吗？', [], state);
  assert.ok(!context.entries.some(entry => entry.entryRef === 'continuity:sourceClaims'), "the campaign's claims collection is not frozen");
  const snapshot = context.entries.find(entry => entry.entryRef === npcDecisionEntryRef(NPC)).value;
  assert.equal(snapshot.records.filter(record => record.kind === 'sourceClaim').length, 12);
  assert.equal(snapshot.records.filter(record => record.kind === 'conversation').length, 6);
  assert.equal(snapshot.records.filter(record => record.kind === 'fact').length, 6);
  assert.deepEqual(context.references.npcRecall.map(entry => [entry.npcRef, entry.role]), [[OTHER, 'requestable'], [NPC, 'default']],
    'the unnamed "you" goes to the NPC who just answered');

  const text = value => JSON.stringify(value);
  const sent = proposalModelContext(context);
  const view = sent.entries.find(entry => entry.entryRef === npcDecisionEntryRef(NPC)).value;
  // The gist opens a line; its tail travels only with the body.
  for (const round of [1, 2]) {
    assert.doesNotMatch(text(sent), new RegExp(`TAIL_${round}_(ACTOR|NPC|SAW)`), `round ${round} is read by handle only`);
  }
  for (const round of [3, 8]) {
    for (const part of ['ACTOR', 'NPC', 'SAW']) assert.match(text(sent), new RegExp(`TAIL_${round}_${part}`), `round ${round} ${part}`);
  }
  assert.equal(view.records.filter(record => record.kind === 'conversation').length, 6);
  assert.equal(view.records.filter(record => record.kind === 'sourceClaim').length, 12);
  // Each line travels once: a claim record points at the NPC's memory of it,
  // a memory of a perception points at the fact, and the exchange names its
  // claims without repeating the player's words.
  for (const record of view.records.filter(record => record.kind === 'sourceClaim')) {
    assert.equal(record.value.sameAsEntryRef, entryRef(NPC, record.ref.slice('continuity:sourceClaims:'.length)));
    assert.equal(Object.hasOwn(record.value, 'semanticContent'), false);
  }
  assert.ok(view.records.filter(record => record.kind === 'conversation').every(record => !Object.hasOwn(record.value, 'playerExpression')
    && !Object.hasOwn(record.value, 'rootActionId') && typeof record.value.claimRef === 'string'));
  const perceptions = sent.entries.filter(entry => entry.value?.kind === 'worldInteractionSensoryEvidence');
  assert.equal(perceptions.length, 6);
  for (const fact of perceptions) {
    const memory = sent.entries.find(entry => entry.entryRef === entryRef(NPC, fact.entryRef)).value;
    assert.equal(memory.sameAsEntryRef, fact.entryRef);
    assert.equal(Object.hasOwn(memory, 'content'), false);
  }

  // Recalling round 1: both lines and the perception come back and the NPC
  // may cite them again; the claims and exchange of that round are no longer
  // in its view, since the memories carry the words.
  const firstRound = context.references.knowledgeRecall.find(entry => entry.holderRef === NPC).records
    .filter(record => /TAIL_1_/.test(text(state.knowledge[NPC][record.entryRef.slice(`knowledge:${NPC}:`.length)])));
  assert.equal(firstRound.length, 3);
  const requested = firstRound.map(record => record.entryRef);
  const recalled = recall(context, state, requested);
  const read = proposalModelContext(recalled, [], requested);
  for (const part of ['ACTOR', 'NPC', 'SAW']) assert.match(text(read), new RegExp(`TAIL_1_${part}`));
  const readView = read.entries.find(entry => entry.entryRef === npcDecisionEntryRef(NPC)).value;
  assert.equal(readView.records.filter(record => record.kind === 'conversation').length, 6);
  assert.equal(readView.records.filter(record => record.kind === 'sourceClaim').length, 12);
  assert.ok(requested.every(ref => readView.knowledge.includes(ref)));
  const choices = view => proposalNpcSourceChoices(view).find(choice => choice.npcRef === NPC).refs;
  const recalledRef = requested.find(ref => /claim:/.test(ref));
  assert.ok(!choices(proposalContextView(context)).includes(recalledRef));
  assert.ok(choices(proposalContextView(recalled, [], requested)).includes(recalledRef));
  // ADR 0044: what the handles brought back follows every entry the selection
  // saw, so the filling's body repeats the selection's up to it -- the fact
  // frame included, which lists no perception.
  const same = read.entries.filter(entry => sent.entries.some(other => text(other) === text(entry)));
  assert.deepEqual(sent.entries.slice(0, same.length), same);
  assert.deepEqual(read.entries.slice(0, same.length), same);
  const perceived = requested.map(ref => ref.slice(`knowledge:${NPC}:`.length)).filter(ref => ref.startsWith('fact:'));
  assert.equal(perceived.length, 1);
  // ADR 0053: the round's perception was not frozen with the unread memory;
  // the memory brought back carries what the NPC saw.
  assert.ok(!context.entries.some(entry => entry.entryRef === perceived[0]));
  assert.match(text(read.entries.find(entry => entry.entryRef === entryRef(NPC, perceived[0])).value.content), /TAIL_1_SAW/);
  assert.deepEqual(read.entries.slice(same.length).map(entry => entry.entryRef).sort(),
    [...requested, npcDecisionEntryRef(NPC)].sort());
  // The actor's own first two rounds wait behind its handles too.
  const actorLines = context.entries.find(entry => entry.entryRef === knowledgeDirectoryEntryRef(ACTOR)).value.unloaded;
  assert.equal(actorLines.length, 4);
});

function social(npcRef, round, basis, npcPerceives = null) {
  return { mode: 'adjudication', basisRefs: [npcRef], terminal: null,
    adjudication: { kind: 'directSuccess', durationMicros: '300000000', risk: '普通交谈。', successOutcome: '对方作答。' },
    proposals: [{ kind: 'social', basisRefs: [npcRef], consumes: [{ kind: 'existing', ref: npcRef }], produces: [], outcomeBinding: 'always', sceneRef: SCENE,
      npcRef, actorSpeech: `ROUND_${round}_ACTOR_第${round}个问题，关于守夜人昨晚看见的那盏灯，TAIL_${round}_ACTOR。`,
      goal: `打听第${round}件事。`, method: `第${round}次当面询问。`,
      communication: 'spokenConversation', audience: 'participants',
      branches: { success: { outcomeCode: 'outcome:answered', summary: '对方作答。', npcPerceives, response: { kind: 'speech', text: `ROUND_${round}_NPC_第${round}个回答：那盏灯昨晚一直亮到天明，TAIL_${round}_NPC。`,
        motive: '依据本人记忆作答。', basis }, consequences: [] }, failure: null } }] };
}
function lower(f, context, bundle) {
  const parsed = parseComplete(bundle);
  assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
  return lowerVNext2ProposalBundle({ ...f, rootActionId: context.binding.rootActionId, requiredContext: context, value: parsed.bundle });
}

// ADR 0050: every replay checks each committed conversation against the view
// Rules rebuilds. A view frozen under the full vnext-1 schema before this
// change is rebuilt in full, so old rooms still load; the schema a view
// carries decides how it is rebuilt, and a view that does not match is
// refused.
test('a conversation frozen under the full view still replays, and a mislabelled view is refused', () => {
  const f = createAuthoredProbeFixture('knowledge-relevance:full-view', { npcCharacters: [{ id: NPC, name: '守夜人' }] });
  let state = f.state;
  const events = [];
  const relabel = (context, schema, full, bounded = NPC_DECISION_CONTEXT_SCHEMA) => {
    const projection = f.runtime.project(f.profiles, state, { kind: 'npc', npcId: NPC, purpose: 'kpDecision', capability: 'internal:npc-limited-knowledge' });
    const built = freezeNpcDecisionEntry(state, f.profiles, NPC, projection, context.entries, full ? NPC_DECISION_CONTEXT_FULL_SCHEMA : bounded);
    const value = { ...built.value, schema };
    const entry = { ...built, value, revisionOrHash: canonicalHash(value) };
    const { contextHash: _hash, ...binding } = context.binding;
    const rebuilt = buildRequiredContext({ ...context, binding, maxUnits: 160_000,
      entries: context.entries.map(candidate => candidate.entryRef === entry.entryRef ? entry : candidate) });
    assert.equal(rebuilt.kind, 'accepted', JSON.stringify(rebuilt).slice(0, 300));
    return rebuilt.context;
  };
  const talk = (round, prepare = context => context) => {
    const context = prepare(freeze(f, `我对守夜人说第${round}句话。`, [NPC], state));
    const lowered = lower({ ...f, state }, context, social(NPC, round, [{ kind: 'playerExpression' }]));
    assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered).slice(0, 300));
    return stepActionToDecision(f.runtime, f.profiles, state, lowered.command.rulesInput);
  };
  for (let round = 1; round <= 7; round++) {
    const result = talk(round);
    assert.equal(result.kind, 'committed');
    state = result.state;
    events.push(...result.events);
  }
  // Round 8 under the full view: it lists the claims of all seven rounds.
  const full = talk(8, context => relabel(context, NPC_DECISION_CONTEXT_FULL_SCHEMA, true));
  assert.equal(full.kind, 'committed', JSON.stringify(full).slice(0, 300));
  const view = full.events.find(event => event.eventType === 'WorldInteractionResolved').payload.social.plan.social.npcContext;
  assert.equal(view.schema, NPC_DECISION_CONTEXT_FULL_SCHEMA);
  assert.equal(view.records.filter(record => record.kind === 'sourceClaim').length, 14);
  events.push(...full.events);
  // Round 9 under vnext-2, which lists every memory (ADR 0115 keeps it).
  state = full.state;
  const recent = talk(9, context => relabel(context, NPC_DECISION_CONTEXT_RECENT_SCHEMA, false, NPC_DECISION_CONTEXT_RECENT_SCHEMA));
  assert.equal(recent.kind, 'committed', JSON.stringify(recent).slice(0, 300));
  const recentView = recent.events.find(event => event.eventType === 'WorldInteractionResolved').payload.social.plan.social.npcContext;
  assert.equal(recentView.schema, NPC_DECISION_CONTEXT_RECENT_SCHEMA);
  assert.equal(recentView.knowledge.length, Object.keys(state.knowledge[NPC]).length);
  events.push(...recent.events);
  const replay = f.runtime.replay(f.genesis, events);
  assert.equal(replay.kind, 'replayed', JSON.stringify(replay).slice(0, 300));
  assert.deepEqual(replay.state, recent.state);
  // The bounded view labelled as the full one is refused before it commits.
  state = recent.state;
  const mislabelled = talk(10, context => relabel(context, NPC_DECISION_CONTEXT_FULL_SCHEMA, false, NPC_DECISION_CONTEXT_RECENT_SCHEMA));
  assert.equal(mislabelled.kind, 'rejected');
  assert.match(JSON.stringify(mislabelled), /social:npc-context-changed-or-forged/);
});

// SPEC 0016 §4.3 (ADR 0111): a long-lived holder's directory stops growing.
// Twenty unread memories the action's words reach and twenty recent ones are
// listed; the rest are counted by the scene and fiction day they were acquired
// in. A group's handle reads its newest bodies and lists the rest by handle.
const DOCK = 'scene:relevance:dock', DAY = 86_400_000_000n;
/** Fifty rounds a fiction day, four memories a round: a perception, which
 * names the scene it happened in, and three lines heard at the same instant.
 * The first half of each day is spent in the gallery (蒸汽廊道), the second at
 * the dock (旧码头). Every seventeenth memory is about the copper key. */
function longFixture(label, count, { characters = 0 } = {}) {
  const f = createAuthoredProbeFixture(`knowledge-relevance:long:${label}`, { npcCharacters: [{ id: NPC, name: '守夜人' }],
    additionalScenes: [{ id: DOCK, name: '旧码头', geometry: geometry() }] });
  const state = structuredClone(f.state), refs = [];
  for (let i = 0; i < count; i++) {
    const round = BigInt(Math.floor(i / 4)), scene = round % 50n < 25n ? SCENE : DOCK;
    const ref = i % 4 === 0 ? `fact:relevance:seen-${i}` : `knowledge:relevance:line-${i}`;
    if (i % 4 === 0) state.canonicalFacts[ref] = { id: ref, kind: 'worldInteractionSensoryEvidence', subjectRefs: [NPC, scene].sort(),
      value: { schema: 'zhuwei.world-interaction-sensory-fact/v1', observerRef: NPC, subjectRef: null, sense: 'sight', evidence: `LINE_${i}_看见灯亮着。` },
      visibilityPolicyId: 'visibility:hidden-until-evidence', source: 'observedEvent', branchId: state.activeBranchId, validFromEventSeq: '1', causalParentIds: [] };
    state.knowledge[NPC][ref] = { characterId: NPC, knowledgeRef: ref, objectKind: i % 4 === 0 ? 'sensoryEvidence' : 'sourceClaim', layer: 'full',
      content: `LINE_${i}_${i % 17 === 0 ? '有人提到铜钥藏在码头的箱子里。' : '寻常的闲谈，说到天气和灯油。'}${'长'.repeat(characters)}`,
      visibility: 'private', acquiredByEventId: `event:epoch:${i + 1}`, acquiredAtFictionMicros: String(round / 50n * DAY + (round % 50n + 1n) * ROUND),
      sourceCharacterId: null, provenanceChain: [ref, `event:epoch:${i + 1}`] };
    refs.push(ref);
  }
  for (const id of Object.keys(state.fictionTimelines)) state.fictionTimelines[id].nowMicros = String(BigInt(count) * ROUND + 3n * DAY);
  // The memories name events 1..count; the room's history has reached them
  // (ADR 0115: Room groups what the holder held at the freeze's event).
  state.version = String(count);
  return { ...f, state, refs };
}
const ASK_KEY = '我问守夜人铜钥的下落。';
const offerReply = args => ({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function',
  function: { name: OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: JSON.stringify({ requestedCapabilities: ['social'], ...args }) } }] } }] });
const refusedAs = constraint => error => error.diagnostics?.some(diagnostic => diagnostic.constraint === constraint);
const holderRecall = context => context.references.knowledgeRecall.find(entry => entry.holderRef === NPC);
const sentDirectory = view => view.entries.find(entry => entry.entryRef === knowledgeDirectoryEntryRef(NPC));

test('past forty unread memories the directory lists twenty by the words and twenty by recency, and counts the rest by scene and day', () => {
  const f = longFixture('500', 500), context = freeze(f, ASK_KEY);
  const directory = context.entries.find(entry => entry.entryRef === knowledgeDirectoryEntryRef(NPC)).value;
  const holder = holderRecall(context);
  const refOf = handle => holder.records.find(record => record.handle === handle).entryRef.slice(`knowledge:${NPC}:`.length);
  const index = ref => f.refs.indexOf(ref);
  // Rounds 119–124 travel in full; memories 0–475 are unread. Newest first is
  // the later memory first here.
  const unread = f.refs.slice(0, 476), newest = [...unread].reverse();
  const relevant = newest.filter(ref => index(ref) % 17 === 0).slice(0, 20);
  const recent = newest.filter(ref => !relevant.includes(ref)).slice(0, 20);
  assert.equal(directory.schema, KNOWLEDGE_DIRECTORY_SCHEMA);
  assert.equal(directory.unloaded.length, 40);
  assert.deepEqual(directory.unloaded.map(line => refOf(line.handle)).sort(), [...relevant, ...recent].sort());
  // Every other unread memory is counted once, in the group of where and on
  // which day it was acquired; a line heard takes the scene of what the
  // holder perceived at the same instant. Groups go by day, then by when.
  const expected = new Map();
  for (const ref of unread.filter(ref => !relevant.includes(ref) && !recent.includes(ref))) {
    const round = Math.floor(index(ref) / 4), label = `${round % 50 < 25 ? '蒸汽廊道' : '旧码头'} 第${Math.floor(round / 50) + 1}天`;
    expected.set(label, (expected.get(label) ?? 0) + 1);
  }
  assert.deepEqual(directory.groups.map(line => [line.label, line.count]), [...expected]);
  assert.ok(directory.groups.every(line => Object.keys(line).sort().join() === 'count,handle,label' && /^g[1-9][0-9]*$/.test(line.handle)));
  // ADR 0115: the freeze keeps a group as its count, the handles its members
  // take and the hash of their versions; the listed lines carry theirs.
  assert.equal(holder.records.length, 40);
  assert.ok(holder.records.every(record => /^sha256:[0-9a-f]{64}$/.test(record.revisionOrHash)));
  assert.ok(holder.groups.every(group => Object.keys(group).sort().join() === 'count,firstMember,groupRef,handle,membersHash'));
  assert.ok(JSON.stringify(holder).length < 12_000, String(JSON.stringify(holder).length));
  // Nothing is dropped: Room lists every group's members newest first, under
  // the handles the freeze reserved, each with its version.
  const listed = holderRecall(recall(context, f.state, holder.groups.map(group => group.groupRef)));
  assert.equal(listed.records.length, 476);
  assert.ok(listed.records.every(record => /^sha256:[0-9a-f]{64}$/.test(record.revisionOrHash)));
  for (const [n, group] of listed.groups.entries()) {
    assert.equal(group.handle, directory.groups[n].handle);
    assert.equal(group.members.length, directory.groups[n].count);
    assert.deepEqual(group.members.map(member => member.handle), group.members.map((_, i) => `m${group.firstMember + i}`));
    const order = group.members.map(member => index(listed.records.find(record => record.handle === member.handle).entryRef.slice(`knowledge:${NPC}:`.length)));
    assert.deepEqual(order, [...order].sort((a, b) => b - a));
  }
  // What the model reads stays bounded: forty lines, a line per group, and
  // the same handles in the selection tool.
  const sent = proposalModelContext(context), line = sentDirectory(sent);
  assert.deepEqual(Object.keys(line.value).sort(), ['groups', 'holderRef', 'schema', 'unloaded']);
  assert.ok(conservativeInputTokens(JSON.stringify(line)) < 1_400, String(conservativeInputTokens(JSON.stringify(line))));
  assert.equal(sent.references.knowledgeRecall.requestable.length, 40 + directory.groups.length);
  assert.deepEqual(createVNextProposalOfferModelInput('bound', context).tools[0].function.parameters.properties.requestedKnowledgeRefs.items.enum,
    sent.references.knowledgeRecall.requestable);
  const shorter = freeze(longFixture('300', 300), ASK_KEY);
  const tokens = conservativeInputTokens(vnextProposalContextBody(context)), fewer = conservativeInputTokens(vnextProposalContextBody(shorter));
  assert.ok(Math.abs(tokens - fewer) < 300, `${fewer} → ${tokens}`);
  // The NPC's own reply call reads the same directory.
  const own = npcOwnModelView(context, NPC).entries.find(entry => entry.entryRef === knowledgeDirectoryEntryRef(NPC)).value;
  assert.equal(own.unloaded.length, 40);
  assert.deepEqual(own.groups, line.value.groups);
});

test("a group's handle reads its newest bodies within the loading limits, lists the rest by handle, and Room rebuilds the same request", () => {
  const f = longFixture('open', 500), context = freeze(f, ASK_KEY);
  const holder = holderRecall(context);
  const [first, second, third] = holder.groups;
  const limit = VNEXT_KNOWLEDGE_RELEVANCE_PROFILE.maxLoadedRecords;
  assert.ok(first.count > limit);
  // ADR 0115: the selection asks for the group; Room lists its members and
  // reads the newest within the limits.
  const selected = parseVNextProposalOfferResponse(offerReply({ requestedKnowledgeRefs: [first.handle] }), context);
  assert.deepEqual(selected.knowledgeRefs, [first.groupRef]);
  // A grouped memory the directory does not show yet, or a handle it never
  // showed, is refused like any unknown handle.
  for (const handle of [`m${first.firstMember}`, 'g99']) {
    assert.throws(() => parseVNextProposalOfferResponse(offerReply({ requestedKnowledgeRefs: [handle] }), context),
      refusedAs('offer:requested-knowledge-handle-unknown'), handle);
  }
  // The filling reads those bodies; the group's line gives way to its members
  // not read, each a line with its handle, newest first.
  const filled = recall(context, f.state, selected.knowledgeRefs);
  const opened = holderRecall(filled).groups[0], entryOf = handle => holderRecall(filled).records.find(record => record.handle === handle).entryRef;
  const newest = opened.members.slice(0, limit).map(member => entryOf(member.handle));
  assert.deepEqual(opened.read, newest);
  const sent = proposalModelContext(filled, [], selected.knowledgeRefs), directory = sentDirectory(sent).value;
  const rest = opened.members.slice(limit).map(member => member.handle);
  assert.deepEqual(directory.groups.map(line => line.handle), holder.groups.slice(1).map(group => group.handle));
  assert.equal(directory.unloaded.length, 40 + rest.length);
  assert.deepEqual(directory.unloaded.slice(40).map(line => line.handle), rest);
  for (const ref of newest) assert.ok(sent.entries.some(entry => entry.entryRef === ref), ref);
  assert.deepEqual(sent.references.knowledgeRecall.shown, newest);
  assert.ok(!sent.references.knowledgeRecall.requestable.includes(first.handle));
  assert.ok(rest.every(handle => sent.references.knowledgeRecall.requestable.includes(handle)));
  // ADR 0044: a directory with groups changes once a group is opened, so it
  // follows every entry the selection printed the same way.
  const selection = proposalModelContext(context), text = JSON.stringify;
  const same = sent.entries.filter(entry => selection.entries.some(other => text(other) === text(entry)));
  assert.deepEqual(selection.entries.slice(0, same.length), same);
  assert.deepEqual(sent.entries.slice(0, same.length), same);
  assert.ok(selection.entries.slice(same.length).some(entry => entry.entryRef === knowledgeDirectoryEntryRef(NPC)));
  // The amendment may name a member now listed or open another group, with
  // the limits counted afresh; a member of a group still closed stays unknown.
  const amended = vnextProposalAmendmentRequest(offerReply({ requestedKnowledgeRefs: [rest[0], second.handle] }), ['social'], [], [], filled, selected.knowledgeRefs);
  assert.deepEqual(amended.requestedKnowledgeRefs, [entryOf(rest[0]), second.groupRef].sort());
  const refilled = recall(filled, f.state, amended.amendedKnowledgeRefs);
  const secondOpened = holderRecall(refilled).groups[1];
  assert.equal(secondOpened.read.length, Math.min(limit, second.count));
  const amendedView = proposalModelContext(refilled, [], amended.amendedKnowledgeRefs);
  for (const ref of [entryOf(rest[0]), ...secondOpened.read]) assert.ok(amendedView.entries.some(entry => entry.entryRef === ref), ref);
  assert.throws(() => vnextProposalAmendmentRequest(offerReply({ requestedKnowledgeRefs: [`m${third.firstMember}`] }), ['social'], [], [], filled, selected.knowledgeRefs),
    refusedAs('offer:requested-knowledge-handle-unknown'));
  // The group is read as the freeze counted it: a member changed since is a
  // stale read, while a memory the holder gained after the freeze is not one
  // of its members.
  const changed = structuredClone(f.state), member = entryOf(opened.members[0].handle).slice(`knowledge:${NPC}:`.length);
  changed.knowledge[NPC][member] = { ...changed.knowledge[NPC][member], content: '改过的内容。' };
  assert.throws(() => recall(context, changed, selected.knowledgeRefs), /knowledge-recall:group-changed/);
  const later = structuredClone(f.state), gained = structuredClone(later.knowledge[NPC][member]);
  later.knowledge[NPC]['knowledge:relevance:later'] = { ...gained, knowledgeRef: 'knowledge:relevance:later', acquiredByEventId: 'event:epoch:9999',
    provenanceChain: ['knowledge:relevance:later', 'event:epoch:9999'] };
  later.version = '9999';
  assert.deepEqual(holderRecall(recall(context, later, selected.knowledgeRefs)).groups[0].members, opened.members);
  // Room proves the filling request from the saved selection alone: it opens
  // the same group and offers the same handles; a request that did not is refused.
  const view = proposalContextView(filled, [], selected.knowledgeRefs);
  const surface = handles => createSubmitKpProposalBundleModelInput(vnextProposalContextBody(filled, [], selected.knowledgeRefs), ['social'],
    proposalItemEntryRefs(view), proposalObservationSubjectRefs(view), VNEXT_ALWAYS_OFFERED_TERMINAL_KINDS, proposalNpcSourceChoices(view),
    requiredContextBasisReferences(view), proposalCreatureTargetRefs(view), true, proposalItemDefinitionRefs(view), [], handles,
    undefined, proposalUnofferedCapabilities(filled));
  const saved = { status: 'completed', context_hash: context.binding.contextHash, binding_hash: 'sha256:fixture',
    response_json: JSON.stringify(offerReply({ requestedKnowledgeRefs: [first.handle] })) };
  const prior = ordinal => ordinal === 1 ? saved : undefined;
  const input = request => ({ ordinal: 2, contextHash: context.binding.contextHash, bindingHash: 'sha256:fixture', requestHash: 'sha256:fixture',
    request: kpRequestBody(DEFAULT_KP_MODEL, request) });
  const offered = proposalKnowledgeRecall(filled, [], selected.knowledgeRefs).filter(record => !selected.knowledgeRefs.includes(record.entryRef)
    && !opened.read.includes(record.entryRef)).map(record => record.handle);
  assert.deepEqual(offered, sent.references.knowledgeRecall.requestable);
  assert.doesNotThrow(() => assertVNextInvocationTransition(input(surface(offered)), prior, filled));
  const closed = proposalKnowledgeRecall(filled, [], []).map(record => record.handle);
  assert.throws(() => assertVNextInvocationTransition(input(surface(closed)), prior, filled), /PROPOSAL_REPAIR_EXHAUSTED/);
});

test('a group stops loading at the character limit, and a holder with forty unread memories or fewer keeps a plain directory', () => {
  // Bodies of about 6,000 characters: the character limit binds before forty.
  const big = longFixture('characters', 100, { characters: 6_000 }), context = freeze(big, ASK_KEY);
  const group = holderRecall(context).groups[0];
  const selected = parseVNextProposalOfferResponse(offerReply({ requestedKnowledgeRefs: [group.handle] }), context);
  const filled = recall(context, big.state, selected.knowledgeRefs), holder = holderRecall(filled), opened = holder.groups[0];
  let characters = 0;
  const fits = opened.members.filter(member => (characters += member.characters) <= VNEXT_KNOWLEDGE_RELEVANCE_PROFILE.maxLoadedCharacters);
  assert.ok(fits.length > 0 && fits.length < VNEXT_KNOWLEDGE_RELEVANCE_PROFILE.maxLoadedRecords, String(fits.length));
  assert.deepEqual(opened.read, fits.map(member => holder.records.find(record => record.handle === member.handle).entryRef));
  // Forty unread memories are forty lines, as before; the forty-first starts groups.
  for (const [count, grouped] of [[64, false], [68, true]]) {
    const plain = freeze(longFixture(`plain:${count}`, count), '我向守夜人点头致意。');
    const value = plain.entries.find(entry => entry.entryRef === knowledgeDirectoryEntryRef(NPC)).value;
    assert.equal(Object.hasOwn(value, 'groups'), grouped, String(count));
    assert.equal(Object.hasOwn(holderRecall(plain), 'groups'), grouped, String(count));
    if (!grouped) {
      assert.deepEqual(Object.keys(value).sort(), ['holderRef', 'schema', 'unloaded']);
      assert.equal(value.unloaded.length, 40);
      assert.ok(value.unloaded.every(line => Object.keys(line).sort().join() === 'gist,handle'));
    } else assert.equal(value.unloaded.length, 20, 'no line reached by the words, twenty recent');
  }
});
