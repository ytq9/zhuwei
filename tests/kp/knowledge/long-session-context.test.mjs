import assert from 'node:assert/strict';
import test from 'node:test';
import { stepActionToDecision } from '../../support/fixtures/vnext-action-lifecycle.mjs';
import { soleStep } from '../../support/fixtures/vnext-action-duration.mjs';
import { parseWithNpcReplies } from '../../support/fixtures/vnext-npc-replies.mjs';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { canonicalSha256 } from '../../../app/_runtime/lib/rules/profiles/canonical.ts';
import { authorityReadSetConflicts, authorityRevisionOrHash } from '../../../app/_runtime/lib/rules/v2/authority-bindings.ts';
import { canonicalUnits } from '../../../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { VNEXT_CONTEXT_WORK_BUDGET } from '../../../app/_runtime/lib/kp/vnext/context/work-budget.ts';
import { knowledgeDirectoryEntryRef, VNEXT_KNOWLEDGE_RELEVANCE_PROFILE } from '../../../app/_runtime/lib/kp/vnext/context/knowledge-relevance.ts';
import { npcDecisionContext, npcDecisionEntryRef } from '../../../app/_runtime/lib/rules/v2/npc-decision-context.ts';
import { proposalModelContext, recallKnowledge, vnextProposalContextBody, withRecalledKnowledge } from '../../../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { encodeVNextStrictToolBundle, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseVNextProposalOfferResponse } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { lowerVNext2ProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { npcOwnRequiredContext } from '../../../app/_runtime/lib/kp/vnext/npc-work.ts';
import { conservativeInputTokens } from '../../../app/_runtime/lib/kp/vnext/invocation/budget.ts';

// SPEC 0016 §4.2–4.3, SPEC 0006 §7 (ADR 0115): a long campaign gives the actor
// and the NPCs it talks to a memory per line heard and per thing seen. Before
// this, a 1,000-memory actor could not freeze an action (its catalog entry
// outgrew the 64,000-byte record cap at about 225 memories), a 1,000-memory
// NPC's decision view left the context (past its 256,000-byte cap at about
// 380), the recall references outgrew the 160,000-unit context, and an NPC's
// own decision sent every memory body (about 85,500 tokens at 400 memories).
const NPC = 'npc:long-session:keeper', ROUND = 300_000_000n;
/** Three memories a round, with the refs real play writes: what the holder
 * saw (a perception fact naming the scene) and two lines it heard then. */
function longSession(label, count) {
  const f = createAuthoredProbeFixture(`long-session:${label}`, { npcCharacters: [{ id: NPC, name: '守夜人' }] });
  const state = structuredClone(f.state);
  for (const holder of [ACTOR, NPC]) {
    for (let i = 0; i < count; i++) {
      const seen = i % 3 === 0, hash = canonicalSha256({ holder, i }).slice('sha256:'.length);
      const ref = seen ? `fact:world-interaction:${hash.slice(0, 32)}` : `claim:social:${hash.slice(0, 56)}`;
      if (seen) state.canonicalFacts[ref] = { id: ref, kind: 'worldInteractionSensoryEvidence', subjectRefs: [holder, SCENE].sort(),
        value: { schema: 'zhuwei.world-interaction-sensory-fact/v1', observerRef: holder, subjectRef: null, sense: 'sight', evidence: `第${i}件事：灯还亮着，有人从门口经过。` },
        visibilityPolicyId: 'visibility:hidden-until-evidence', source: 'observedEvent', branchId: state.activeBranchId, validFromEventSeq: '1', causalParentIds: [] };
      state.knowledge[holder] ??= {};
      state.knowledge[holder][ref] = { characterId: holder, knowledgeRef: ref, objectKind: seen ? 'sensoryEvidence' : 'sourceClaim', layer: 'full',
        content: seen ? `第${i}件事：灯还亮着，有人从门口经过。` : `第${i}句：寻常的闲谈，说到天气、灯油和码头上的船。`, visibility: 'private',
        acquiredByEventId: `event:epoch:${i + 1}`, acquiredAtFictionMicros: String((BigInt(Math.floor(i / 3)) + 1n) * ROUND),
        sourceCharacterId: null, provenanceChain: [ref, `event:epoch:${i + 1}`] };
    }
  }
  for (const id of Object.keys(state.fictionTimelines)) state.fictionTimelines[id].nowMicros = String(BigInt(count + 10) * ROUND);
  // The memories name events 1..count; the room's history has reached them.
  state.version = String(count);
  return { ...f, state };
}
const ASK = '我问守夜人今晚的天气。';
const freeze = (f, intentText = ASK) => freezeAuthoredProbeContext(f, f.state, { rootActionId: `${f.rootActionId}:long`, focusRefs: [], intentText }).context;
const bytes = value => canonicalUnits(value) * 4;
const entry = (context, ref) => context.entries.find(candidate => candidate.entryRef === ref);
const memoryRef = (holder, i) => {
  const hash = canonicalSha256({ holder, i }).slice('sha256:'.length);
  return i % 3 === 0 ? `fact:world-interaction:${hash.slice(0, 32)}` : `claim:social:${hash.slice(0, 56)}`;
};

test('a thousand memories each: the actor freezes, the NPC view stays in the context, and neither grows with memory', () => {
  const sizes = {};
  for (const count of [200, 1000]) {
    const f = longSession(String(count), count), context = freeze(f);
    // The actor's catalog: its version binds every memory, its value counts them.
    const catalog = entry(context, `knowledge-catalog:${ACTOR}`);
    assert.equal(catalog.kind, 'known');
    assert.deepEqual(catalog.value, { schema: 'zhuwei.held-knowledge-catalog/vnext-2', characterId: ACTOR, count });
    assert.equal(catalog.revisionOrHash, authorityRevisionOrHash(f.state, `knowledge-catalog:${ACTOR}`));
    // The NPC's view is present, verified and small; its catalog record
    // counts what the NPC holds.
    const view = entry(context, npcDecisionEntryRef(NPC));
    assert.equal(view.kind, 'known');
    const decision = npcDecisionContext(context.entries, NPC);
    assert.ok(decision);
    assert.equal(decision.records.find(record => record.kind === 'knowledgeCatalog').value.count, count);
    assert.ok(decision.knowledge.length <= VNEXT_KNOWLEDGE_RELEVANCE_PROFILE.maxLoadedRecords);
    // Both holders keep their directory; past forty unread memories a group
    // is frozen as a count and a hash, not as its members.
    for (const holder of [ACTOR, NPC]) {
      const recall = context.references.knowledgeRecall.find(candidate => candidate.holderRef === holder);
      assert.equal(recall.records.length, 40);
      assert.ok(recall.groups.length > 0 && recall.groups.every(group => group.members === undefined));
      assert.equal(recall.records.length + recall.groups.reduce((sum, group) => sum + group.count, 0)
        + context.entries.filter(candidate => candidate.entryRef.startsWith(`knowledge:${holder}:`)).length, count);
    }
    sizes[count] = { catalog: bytes(catalog), view: bytes(view), recall: bytes(context.references.knowledgeRecall), context: bytes(context),
      request: conservativeInputTokens(vnextProposalContextBody(context)) };
  }
  // Measured 2026-10-05: catalog entry 272 B; view about 11,500 B; recall
  // references about 18,600 B; whole context about 101,000 B; selection
  // context body about 16,100 tokens. Before ADR 0115 the 1,000-memory freeze
  // failed (catalog 283,000 B, view 655,000 B, references 642,000 B).
  const { maxEntryRereadBytes, maxDecisionViewBytes } = VNEXT_CONTEXT_WORK_BUDGET.caps;
  const large = sizes[1000], small = sizes[200];
  assert.ok(large.catalog <= 400, JSON.stringify(sizes));
  assert.ok(large.view <= 16_000 && large.view < maxEntryRereadBytes && large.view < maxDecisionViewBytes, JSON.stringify(sizes));
  assert.ok(large.recall <= 24_000, JSON.stringify(sizes));
  assert.ok(large.context <= 120_000, JSON.stringify(sizes));
  for (const key of ['catalog', 'view', 'recall', 'context']) assert.ok(Math.abs(large[key] - small[key]) <= 2_000, `${key}: ${JSON.stringify(sizes)}`);
  assert.ok(Math.abs(large.request - small.request) <= 500, JSON.stringify(sizes));
});

test("a group of a thousand-memory actor opens through Room, and only what the freeze counted is read", () => {
  const f = longSession('open', 1000), context = freeze(f);
  const recall = context.references.knowledgeRecall.find(candidate => candidate.holderRef === ACTOR);
  const group = recall.groups[0];
  const reply = { choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name: OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME,
    arguments: JSON.stringify({ requestedCapabilities: ['observe'], requestedKnowledgeRefs: [group.handle] }) } }] } }] };
  const selected = parseVNextProposalOfferResponse(reply, context);
  assert.deepEqual(selected.knowledgeRefs, [group.groupRef]);
  const filled = withRecalledKnowledge(context, recallKnowledge(context, selected.knowledgeRefs, f.state));
  const opened = filled.references.knowledgeRecall.find(candidate => candidate.holderRef === ACTOR).groups[0];
  assert.equal(opened.members.length, group.count);
  assert.equal(opened.read.length, VNEXT_KNOWLEDGE_RELEVANCE_PROFILE.maxLoadedRecords);
  for (const ref of opened.read) assert.equal(entry(filled, ref)?.kind, 'known', ref);
  const sent = proposalModelContext(filled, [], selected.knowledgeRefs);
  assert.deepEqual(sent.references.knowledgeRecall.shown, opened.read);
  // A member changed after the freeze is a stale read.
  const changed = structuredClone(f.state), member = opened.read[0].slice(`knowledge:${ACTOR}:`.length);
  changed.knowledge[ACTOR][member] = { ...changed.knowledge[ACTOR][member], content: '改过的内容。' };
  assert.throws(() => recallKnowledge(context, selected.knowledgeRefs, changed), /knowledge-recall:group-changed/);
});

test('a memory changed after the freeze is refused at commit with the same rejection as before', () => {
  const f = longSession('stale', 1000), context = freeze(f);
  // The NPC answers from a memory the context read; the plan binds its
  // snapshot, whose catalog record carries the version of every memory.
  const read = npcDecisionContext(context.entries, NPC).knowledge[0].entryRef;
  const bundle = { mode: 'adjudication', basisRefs: [NPC], terminal: null,
    adjudication: { kind: 'directSuccess', durationMicros: '300000000', risk: '普通交谈。', successOutcome: '对方作答。' },
    proposals: [{ kind: 'social', basisRefs: [NPC], consumes: [{ kind: 'existing', ref: NPC }], produces: [], outcomeBinding: 'always', sceneRef: SCENE,
      npcRef: NPC, actorSpeech: '今晚天气怎么样？', goal: '打听天气。', method: '当面询问。', communication: 'spokenConversation', audience: 'participants',
      branches: { success: { outcomeCode: 'outcome:answered', summary: '对方作答。', npcPerceives: null,
        response: { kind: 'speech', text: '灯还亮着，天也还晴。', motive: '依据本人记忆作答。', basis: [{ kind: 'npcContext', ref: read }] }, consequences: [] }, failure: null } }] };
  const parsed = parseWithNpcReplies(encodeVNextStrictToolBundle(bundle), bundle);
  assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
  const lowered = lowerVNext2ProposalBundle({ ...f, rootActionId: context.binding.rootActionId, requiredContext: context, value: parsed.bundle });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered).slice(0, 400));
  const plan = soleStep(lowered.command).plan;
  // The plan carries the bounded snapshot and a bounded read set.
  assert.ok(bytes(plan.social.npcContext) <= 16_000, String(bytes(plan.social.npcContext)));
  assert.ok(plan.readSet.length <= 200, String(plan.readSet.length));
  assert.equal(stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput).kind, 'committed');
  // A memory the context did not read changes, and one it read: both show in
  // the catalog's version, and Rules refuses the conversation as it refused a
  // changed snapshot before.
  const unread = memoryRef(NPC, 0);
  assert.ok(!context.entries.some(candidate => candidate.entryRef === `knowledge:${NPC}:${unread}`));
  for (const changedRef of [unread, read.slice(`knowledge:${NPC}:`.length)]) {
    const changed = structuredClone(f.state);
    changed.knowledge[NPC][changedRef] = { ...changed.knowledge[NPC][changedRef], content: '改过的内容。' };
    assert.deepEqual(authorityReadSetConflicts(changed, plan.readSet).map(conflict => conflict.ref).filter(ref => ref === `knowledge-catalog:${NPC}`),
      [`knowledge-catalog:${NPC}`], changedRef);
    const result = stepActionToDecision(f.runtime, f.profiles, changed, lowered.command.rulesInput);
    assert.equal(result.kind, 'rejected', changedRef);
    assert.match(JSON.stringify(result), /social:npc-context-changed-or-forged/, changedRef);
  }
});

test("an NPC's own decision reads what it rests on, its recent rounds and a directory, and stays the same size", () => {
  const sizes = {};
  for (const count of [200, 1000]) {
    const f = longSession(`own:${count}`, count);
    // The oldest memory is what this decision answers: it travels however old.
    const premise = memoryRef(NPC, 0);
    const context = npcOwnRequiredContext(f.state, f.profiles, f.moduleProfile, NPC, `root:own:${count}`,
      { submissionRef: `npc-reaction:own:${count}`, actorRef: NPC, text: '本人看见有人从门口经过。' }, [premise]);
    assert.ok(context, String(count));
    const bodies = context.entries.filter(candidate => candidate.entryRef.startsWith(`knowledge:${NPC}:`)).map(candidate => candidate.entryRef);
    assert.ok(bodies.includes(`knowledge:${NPC}:${premise}`));
    assert.ok(bodies.includes(`knowledge:${NPC}:${memoryRef(NPC, count - 1)}`), 'its latest round');
    assert.ok(bodies.length <= VNEXT_KNOWLEDGE_RELEVANCE_PROFILE.maxLoadedRecords, String(bodies.length));
    assert.deepEqual(entry(context, `knowledge-catalog:${NPC}`).value, { schema: 'zhuwei.held-knowledge-catalog/vnext-2', characterId: NPC, count });
    // The rest is a directory it cannot ask from: no line has a handle.
    const directory = entry(context, knowledgeDirectoryEntryRef(NPC)).value;
    assert.equal(directory.unloaded.length, 40);
    assert.ok(directory.unloaded.every(line => Object.keys(line).join() === 'gist'));
    assert.ok(directory.groups.every(line => Object.keys(line).sort().join() === 'count,label'));
    assert.equal(bodies.length + directory.unloaded.length + directory.groups.reduce((sum, line) => sum + line.count, 0), count);
    assert.ok(context.references.citations.nonCitableRefs.includes(knowledgeDirectoryEntryRef(NPC)));
    // Room rebuilds the same request from the same state.
    const again = npcOwnRequiredContext(f.state, f.profiles, f.moduleProfile, NPC, `root:own:${count}`,
      { submissionRef: `npc-reaction:own:${count}`, actorRef: NPC, text: '本人看见有人从门口经过。' }, [premise]);
    assert.equal(again.binding.contextHash, context.binding.contextHash);
    sizes[count] = { context: bytes(context), request: conservativeInputTokens(JSON.stringify(proposalModelContext(context))) };
  }
  // Measured 2026-10-05: about 27,000 B and 7,000 tokens at either count;
  // before ADR 0115, 400 memories sent about 85,500 tokens and 600 did not fit.
  assert.ok(sizes[1000].context <= 40_000 && sizes[1000].request <= 10_000, JSON.stringify(sizes));
  assert.ok(Math.abs(sizes[1000].context - sizes[200].context) <= 2_000, JSON.stringify(sizes));
});
