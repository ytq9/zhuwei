import assert from 'node:assert/strict';
import test from 'node:test';
import { stepActionToDecision } from '../../support/fixtures/vnext-action-lifecycle.mjs';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { proposalNpcSourceChoices, proposalModelContext, proposalContextView } from '../../../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { npcDecisionContext, npcDecisionEntryRef, freezeNpcDecisionEntry, NPC_DECISION_CONTEXT_SCHEMA, NPC_DECISION_CONTEXT_FULL_SCHEMA } from '../../../app/_runtime/lib/rules/v2/npc-decision-context.ts';
import { buildRequiredContext } from '../../../app/_runtime/lib/kp/vnext/required-context.ts';
import { canonicalHash } from '../../../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { encodeVNextStrictToolBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { lowerVNext2ProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { createKnowledgeSelector, recentInterlocutor, VNEXT_KNOWLEDGE_RELEVANCE_PROFILE, KNOWLEDGE_DIRECTORY_SCHEMA, knowledgeDirectoryEntryRef, knowledgeGist } from '../../../app/_runtime/lib/kp/vnext/context/knowledge-relevance.ts';
import { buildReferenceIndex } from '../../../app/_runtime/lib/kp/vnext/context/reference-index.ts';
import { createContextWorkBudget } from '../../../app/_runtime/lib/kp/vnext/context/work-budget.ts';

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
  assert.equal(decision.unloadedKnowledgeRefs, undefined, 'every body is frozen with the view');
  const old = [BACKGROUND, f.npc[0], f.npc[1]].map(ref => entryRef(NPC, ref)).sort();
  const directory = context.entries.find(entry => entry.entryRef === knowledgeDirectoryEntryRef(NPC));
  assert.equal(directory?.value.schema, KNOWLEDGE_DIRECTORY_SCHEMA);
  assert.deepEqual(directory.value.unloaded.map(record => record.entryRef), old);
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
  const handle = directory.value.unloaded.find(record => record.entryRef === entryRef(NPC, f.npc[0])).handle;
  assert.ok(sent.references.knowledgeRecall.requestable.includes(handle));
  assert.ok(!proposalNpcSourceChoices(proposalContextView(context)).find(choice => choice.npcRef === NPC).refs.includes(entryRef(NPC, f.npc[0])));
  const read = proposalModelContext(context, [], [entryRef(NPC, f.npc[0])]);
  assert.match(JSON.stringify(read), /问过铜钥在哪里/);
  assert.ok(read.entries.find(entry => entry.entryRef === npcDecisionEntryRef(NPC)).value.knowledge.includes(entryRef(NPC, f.npc[0])));
  assert.deepEqual(read.references.knowledgeRecall.shown, [entryRef(NPC, f.npc[0])]);
  assert.ok(proposalNpcSourceChoices(proposalContextView(context, [], [entryRef(NPC, f.npc[0])])).find(choice => choice.npcRef === NPC).refs.includes(entryRef(NPC, f.npc[0])));
  // Lowering reads the complete frozen memory; a body missing from it is never citable.
  assert.equal(lower(f, context, social(NPC, 1, [{ kind: 'npcContext', ref: entryRef(NPC, f.npc[0]) }])).kind, 'accepted');
  const absent = lower(f, { ...context, entries: context.entries.filter(entry => entry.entryRef !== entryRef(NPC, f.npc[0])) },
    social(NPC, 1, [{ kind: 'npcContext', ref: entryRef(NPC, f.npc[0]) }]));
  assert.equal(absent.kind, 'rejected');
  // The actor's own directory: its first round only.
  assert.deepEqual(context.entries.find(entry => entry.entryRef === knowledgeDirectoryEntryRef(ACTOR)).value.unloaded.map(record => record.entryRef), [entryRef(ACTOR, f.actor[0])]);
  // The actor may cite its memory by entry ref or by bare ref; an unread one
  // by neither, until its handle is named.
  const actorCites = view => new Set(view.references.citations.viewerEvidenceRefs);
  const unread = actorCites(proposalContextView(context)), recalled = actorCites(proposalContextView(context, [], [entryRef(ACTOR, f.actor[0])]));
  for (const ref of [entryRef(ACTOR, f.actor[0]), f.actor[0]]) {
    assert.equal(unread.has(ref), false, ref);
    assert.equal(recalled.has(ref), true, ref);
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
        content: limit === 'characters' ? '密'.repeat(64_001) : limit === 'bytes' ? '密'.repeat(22_000) : `前提 ${i}` };
    }
    // A single body past the per-entry byte cap cannot be frozen whole, so it
    // blocks (a 64,001-character Han body is three times that cap in UTF-8);
    // many small bodies past the count cap all freeze and the overflow keeps
    // its handles.
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
    assert.equal(frozen, 41, 'every body is frozen');
    const handles = context.references.knowledgeRecall.find(entry => entry.holderRef === holder)?.records ?? [];
    const sent = proposalModelContext(context).entries.filter(entry => entry.entryRef.startsWith(`knowledge:${holder}:`)).length;
    assert.equal(sent + handles.length, frozen, 'what is not sent is requestable');
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
  // round 8 those are rounds 2–7.
  const frozenView = resolved.payload.social.plan.social.npcContext;
  assert.equal(frozenView.schema, 'zhuwei.npc-decision-context/vnext-2');
  assert.equal(frozenView.records.filter(record => record.kind === 'sourceClaim').length, 12);
  assert.equal(frozenView.records.filter(record => record.kind === 'conversation').length, 6);
  assert.equal(frozenView.knowledge.length, Object.keys(state.knowledge[NPC]).length - 3, 'the directory still lists every memory held then');
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
    .filter(record => /TAIL_1_/.test(text(context.entries.find(entry => entry.entryRef === record.entryRef).value)));
  assert.equal(firstRound.length, 3);
  const requested = firstRound.map(record => record.entryRef);
  const read = proposalModelContext(context, [], requested);
  for (const part of ['ACTOR', 'NPC', 'SAW']) assert.match(text(read), new RegExp(`TAIL_1_${part}`));
  const readView = read.entries.find(entry => entry.entryRef === npcDecisionEntryRef(NPC)).value;
  assert.equal(readView.records.filter(record => record.kind === 'conversation').length, 6);
  assert.equal(readView.records.filter(record => record.kind === 'sourceClaim').length, 12);
  assert.ok(requested.every(ref => readView.knowledge.includes(ref)));
  const choices = view => proposalNpcSourceChoices(view).find(choice => choice.npcRef === NPC).refs;
  const recalled = requested.find(ref => /claim:/.test(ref));
  assert.ok(!choices(proposalContextView(context)).includes(recalled));
  assert.ok(choices(proposalContextView(context, [], requested)).includes(recalled));
  // ADR 0044: what the handles brought back follows every entry the selection
  // saw, so the filling's body repeats the selection's up to it -- the fact
  // frame included, which lists no perception.
  const same = read.entries.filter(entry => sent.entries.some(other => text(other) === text(entry)));
  assert.deepEqual(sent.entries.slice(0, same.length), same);
  assert.deepEqual(read.entries.slice(0, same.length), same);
  const perceived = requested.map(ref => ref.slice(`knowledge:${NPC}:`.length)).filter(ref => ref.startsWith('fact:'));
  assert.equal(perceived.length, 1);
  assert.deepEqual(read.entries.slice(same.length).map(entry => entry.entryRef).sort(),
    [...requested, ...perceived, npcDecisionEntryRef(NPC)].sort());
  // The actor's own first two rounds wait behind its handles too.
  const actorLines = context.entries.find(entry => entry.entryRef === knowledgeDirectoryEntryRef(ACTOR)).value.unloaded;
  assert.equal(actorLines.length, 4);
});

function social(npcRef, round, basis, npcPerceives = null) {
  return { mode: 'adjudication', basisRefs: [npcRef], terminal: null,
    adjudication: { kind: 'directSuccess', durationMicros: '300000000', risk: '普通交谈。', successOutcome: '对方作答。' },
    proposals: [{ kind: 'social', basisRefs: [npcRef], consumes: [{ kind: 'existing', ref: npcRef }], produces: [], outcomeBinding: 'always', sceneRef: SCENE,
      npcRef, addressedThreadRef: null, actorSpeech: `ROUND_${round}_ACTOR_第${round}个问题，关于守夜人昨晚看见的那盏灯，TAIL_${round}_ACTOR。`,
      goal: `打听第${round}件事。`, method: `第${round}次当面询问。`,
      communication: 'spokenConversation', audience: 'participants', retryChange: null,
      branches: { success: { outcomeCode: 'outcome:answered', summary: '对方作答。', npcPerceives, response: { kind: 'speech', text: `ROUND_${round}_NPC_第${round}个回答：那盏灯昨晚一直亮到天明，TAIL_${round}_NPC。`,
        motive: '依据本人记忆作答。', basis }, consequences: [] }, failure: null } }] };
}
function lower(f, context, bundle) {
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle)));
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
  const relabel = (context, schema, full) => {
    const projection = f.runtime.project(f.profiles, state, { kind: 'npc', npcId: NPC, purpose: 'kpDecision', capability: 'internal:npc-limited-knowledge' });
    const built = freezeNpcDecisionEntry(state, f.profiles, NPC, projection, context.entries, full ? NPC_DECISION_CONTEXT_FULL_SCHEMA : NPC_DECISION_CONTEXT_SCHEMA);
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
  const replay = f.runtime.replay(f.genesis, events);
  assert.equal(replay.kind, 'replayed', JSON.stringify(replay).slice(0, 300));
  assert.deepEqual(replay.state, full.state);
  // The bounded view labelled as the full one is refused before it commits.
  state = full.state;
  const mislabelled = talk(9, context => relabel(context, NPC_DECISION_CONTEXT_FULL_SCHEMA, false));
  assert.equal(mislabelled.kind, 'rejected');
  assert.match(JSON.stringify(mislabelled), /social:npc-context-changed-or-forged/);
});
