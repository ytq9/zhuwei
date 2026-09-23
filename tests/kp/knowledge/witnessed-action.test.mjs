import { stepActionToDecision } from '../../support/fixtures/vnext-action-lifecycle.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { lowerVNext2ProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { VNEXT2_PROPOSAL_BUNDLE_SCHEMA, encodeVNextStrictToolBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { proposalModelContext } from '../../../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { npcDecisionEntryRef } from '../../../app/_runtime/lib/rules/v2/npc-decision-context.ts';

// SPEC 0006 §4, SPEC 0005 §6.2, SPEC 0010 O02: an NPC present in the scene
// who plainly sees the actor act gets its own sensory evidence of the act, and
// that memory reaches its next reply to the actor even when the player's next
// words do not mention it. Only the act travels, not the actor's intent or
// what only the actor found.
const NPC = 'npc:witness:keeper', AWAY = 'npc:witness:away', OTHER_SCENE = 'scene:witness-elsewhere';
const FEATURE = 'feature:probe-valve';
const SAW = 'WITNESS_外乡人伸手转动了阀门。';

function fixture(label) {
  return createAuthoredProbeFixture(`witnessed:${label}`, {
    npcCharacters: [{ id: NPC, name: '守夜人' }, { id: AWAY, name: '门外人' }],
    additionalScenes: [{ id: OTHER_SCENE, name: '门外' }], characterScenes: { [AWAY]: OTHER_SCENE },
  });
}
function turnValve(witness) {
  return { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: 'proposalBundle', mode: 'adjudication', basisRefs: [FEATURE],
    adjudication: { kind: 'directSuccess', durationMicros: '300000000', risk: '转动阀门。', successOutcome: '阀门被转动。' }, terminal: null,
    proposals: [{ kind: 'worldInteraction', basisRefs: [FEATURE], consumes: [], produces: [], outcomeBinding: 'always',
      sceneRef: SCENE, targetRefs: [FEATURE], directTargetRefs: [FEATURE], instrumentRefs: [], abilityRef: null,
      intent: 'ACTOR_INTENT_悄悄试探守夜人的反应。', method: '伸手转动阀门。', branches: { success: {
        outcomeCode: 'outcome:turned', summary: '转动了阀门。', effects: [],
        sensoryEvidence: [
          { observerRef: ACTOR, subjectRef: FEATURE, sense: 'sight', evidence: 'ACTOR_ONLY_阀门内侧刻着一个小记号。', basisRefs: [FEATURE] },
          { observerRef: witness, subjectRef: ACTOR, sense: 'sight', evidence: SAW, basisRefs: [FEATURE] },
        ],
        pressures: [], opportunities: [] }, failure: null } }] };
}
function act(f, witness) {
  const frozen = freezeAuthoredProbeContext(f, f.state, { rootActionId: `${f.rootActionId}:turn`, intentText: '我转动阀门。', focusRefs: [FEATURE, NPC] });
  const lowered = lowerVNext2ProposalBundle({ ...f, rootActionId: `${f.rootActionId}:turn`, requiredContext: frozen.context, value: turnValve(witness) });
  if (lowered.kind !== 'accepted') return { lowered };
  return { lowered, result: stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput) };
}

test('a present NPC who sees the act holds it, and it reaches its reply to a plain greeting without the intent', () => {
  const f = fixture('present');
  const { lowered, result } = act(f, NPC);
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  assert.equal(result.kind, 'committed', JSON.stringify(result));
  const memory = Object.values(result.state.knowledge[NPC] ?? {}).find(record => JSON.stringify(record.content).includes(SAW));
  assert.ok(memory, 'the NPC holds its own evidence of the act');
  assert.equal(memory.objectKind, 'sensoryEvidence');
  const held = JSON.stringify(result.state.knowledge[NPC]);
  assert.ok(!held.includes('ACTOR_INTENT') && !held.includes('ACTOR_ONLY'), 'neither the intent nor the actor-only finding reaches the NPC');

  const next = freezeAuthoredProbeContext(f, result.state, { rootActionId: `${f.rootActionId}:greet`, intentText: '我对守夜人说你好。' }).context;
  const view = proposalModelContext(next).entries.find(entry => entry.entryRef === npcDecisionEntryRef(NPC))?.value;
  assert.ok(view, 'the addressed NPC has a decision view');
  const sent = view.knowledge.map(record => record.entryRef);
  assert.ok(sent.includes(`knowledge:${NPC}:${memory.knowledgeRef}`), 'the witnessed act travels with a greeting that does not name it');
});

test('an NPC in another scene cannot be recorded as a witness', () => {
  const f = fixture('away');
  const { lowered, result } = act(f, AWAY);
  const refused = lowered.kind !== 'accepted' || result.kind !== 'committed';
  assert.ok(refused, `a witness outside the scene must be refused: ${JSON.stringify(result ?? lowered).slice(0, 300)}`);
  assert.equal(Object.keys(f.state.knowledge[AWAY] ?? {}).length, 0);
});

function lookAtValve(witness, inferFrom) {
  return { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: 'proposalBundle', mode: 'adjudication', basisRefs: [FEATURE],
    adjudication: { kind: 'directSuccess', durationMicros: '300000000', risk: '凑近看阀门。', successOutcome: '看清阀门。' }, terminal: null,
    proposals: [{ kind: 'observe', basisRefs: [FEATURE], consumes: [], produces: [], outcomeBinding: 'always', sceneRef: SCENE,
      inquiry: '阀门现在什么样？', method: '凑到阀门前细看。', focusRefs: [FEATURE], existingFactRefs: [], branches: { success: {
        outcomeCode: 'outcome:seen', summary: '看清了阀门。', sensoryEvidence: [
          { observerRef: ACTOR, subjectRef: FEATURE, sense: 'sight', evidence: 'ACTOR_ONLY_阀门内侧刻着一个小记号。', basisRefs: [FEATURE] },
          { observerRef: witness, subjectRef: ACTOR, sense: 'sight', evidence: SAW, basisRefs: [FEATURE] }],
        characterInferences: inferFrom === undefined ? [] : [{ conclusion: '阀门被人动过。', confidence: '只看到一处记号。',
          evidence: [{ kind: 'sensoryEvidence', index: inferFrom }] }] }, failure: null } }] };
}

test('an observation can record what a present NPC sees the actor doing, while the actor infers only from its own evidence', () => {
  const f = fixture('observe');
  const frozen = freezeAuthoredProbeContext(f, f.state, { rootActionId: `${f.rootActionId}:look`, intentText: '我凑近看阀门。', focusRefs: [FEATURE, NPC] });
  const lower = value => lowerVNext2ProposalBundle({ ...f, rootActionId: `${f.rootActionId}:look`, requiredContext: frozen.context, value });
  const lowered = lower(lookAtValve(NPC, 0));
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(result.kind, 'committed', JSON.stringify(result));
  const held = JSON.stringify(result.state.knowledge[NPC]);
  assert.ok(held.includes(SAW), 'the NPC holds what it saw the actor do');
  assert.ok(!held.includes('ACTOR_ONLY'), "the actor's private finding stays with the actor");
  const borrowed = lower(lookAtValve(NPC, 1));
  const refused = borrowed.kind !== 'accepted'
    || stepActionToDecision(f.runtime, f.profiles, f.state, borrowed.command.rulesInput).kind !== 'committed';
  assert.ok(refused, "the actor cannot infer from the NPC's evidence");
});

// SPEC 0016 §7.2, SPEC 0009 §2: a hidden act is checked, and both sides are
// written before the roll. The side where it is noticed records what the NPC
// saw and what the actor perceived; the side where it is not records neither.
const NOTICED = 'WITNESS_外乡人的手伸向了阀门。';
function hiddenAct(failure) {
  const answer = (text, motive, npcPerceives = null) => ({ outcomeCode: npcPerceives ? 'outcome:noticed' : 'outcome:unnoticed', summary: text, npcPerceives,
    response: { kind: 'speech', text, motive, basis: [{ kind: 'npcContext', ref: NPC }] }, consequences: [] });
  return { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: 'proposalBundle', mode: 'adjudication', basisRefs: [FEATURE, NPC], terminal: null,
    adjudication: { kind: 'check', durationMicros: '300000000', checkKind: 'abilityCheck', ability: 'dex', skill: 'sleight', dc: 14, mode: 'normal',
      risk: '守夜人就在旁边，可能看见。', successOutcome: '没人察觉。', failureOutcome: '守夜人看见了手的动作并质问。' },
    proposals: [
      { kind: 'social', basisRefs: [NPC], consumes: [], produces: [], outcomeBinding: 'always', sceneRef: SCENE, npcRef: NPC,
        addressedThreadRef: null, actorSpeech: '这阀门平时谁管？', goal: '借问话掩护手上的动作。', method: '边问边伸手。',
        communication: 'spokenConversation', audience: 'participants', retryChange: null,
        branches: { success: answer('平时我管。', '照实回答来客。'), failure: failure ?? answer('你的手在碰什么？', '看见了来客的手。', NOTICED) } },
      { kind: 'observe', basisRefs: [FEATURE], consumes: [], produces: [], outcomeBinding: 'onFailure', sceneRef: SCENE,
        inquiry: '有没有被发现？', method: '留意守夜人的目光。', focusRefs: [FEATURE], existingFactRefs: [], branches: { success: {
          outcomeCode: 'outcome:seen', summary: '守夜人看见了。', sensoryEvidence: [
            { observerRef: ACTOR, subjectRef: NPC, sense: 'sight', evidence: 'ACTOR_SLIP_守夜人的目光正落在你的手上。', basisRefs: [FEATURE] }],
          characterInferences: [] }, failure: null } },
    ] };
}

test('a hidden act noticed on a failed check leaves the NPC its witness record and reaction; an unnoticed one leaves only the speech', () => {
  for (const roll of [1, 20]) {
    const f = fixture(`hidden-${roll}`);
    const frozen = freezeAuthoredProbeContext(f, f.state, { rootActionId: `${f.rootActionId}:hidden`, intentText: '我边问守夜人这阀门平时谁管，边偷偷去拧它。', focusRefs: [FEATURE, NPC] });
    const lowered = lowerVNext2ProposalBundle({ ...f, rootActionId: `${f.rootActionId}:hidden`, requiredContext: frozen.context, value: hiddenAct() });
    assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
    const pending = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
    assert.equal(pending.kind, 'awaitingRandomness', JSON.stringify(pending).slice(0, 300));
    const result = f.runtime.step(f.profiles, pending.state, { kind: 'fulfillAuthoritativeRandomness', continuation: pending.continuation, rolls: [roll] });
    assert.equal(result.kind, 'committed', JSON.stringify(result).slice(0, 300));
    const npc = JSON.stringify(result.state.knowledge[NPC]), actor = JSON.stringify(result.state.knowledge[ACTOR]);
    assert.ok(npc.includes('这阀门平时谁管？'), `${roll}: the NPC heard the question`);
    assert.ok(!npc.includes('偷偷'), `${roll}: the input's framing never reaches the NPC`);
    if (roll === 1) {
      // The conversation partner's perception comes from its own branch.
      assert.ok(npc.includes(NOTICED), 'noticed: the NPC holds what it saw');
      assert.ok(!actor.includes(NOTICED), "noticed: what the NPC saw stays the NPC's own record");
      assert.ok(npc.includes('你的手在碰什么？'), 'noticed: the NPC reacted');
      assert.ok(actor.includes('ACTOR_SLIP'), 'noticed: the actor perceives being seen');
    } else {
      assert.ok(!npc.includes(NOTICED) && !actor.includes('ACTOR_SLIP'), 'unnoticed: no witness and no slip');
      assert.ok(npc.includes('平时我管。'));
    }
  }
});

test('an unwritten failure branch is sent back for correction instead of reaching the roll', () => {
  const f = fixture('hollow');
  const frozen = freezeAuthoredProbeContext(f, f.state, { rootActionId: `${f.rootActionId}:hollow`, intentText: '我边问守夜人这阀门平时谁管，边偷偷去拧它。', focusRefs: [FEATURE, NPC] });
  // The shape round 112 produced: placeholders where the failure side belongs.
  const hollow = hiddenAct({ outcomeCode: 'none', summary: 'none', npcPerceives: null, response: { kind: 'silence', text: '', motive: 'none', basis: [{ kind: 'npcContext', ref: NPC }] }, consequences: [] });
  let outcome;
  try { outcome = lowerVNext2ProposalBundle({ ...f, rootActionId: `${f.rootActionId}:hollow`, requiredContext: frozen.context, value: hollow }); }
  catch (error) { outcome = { kind: 'rejected', issues: [String(error.message)] }; }
  assert.notEqual(outcome.kind, 'accepted', 'a hollow failure side must not be accepted');
  assert.ok(JSON.stringify(outcome).includes('bundle:branch-unwritten'), JSON.stringify(outcome).slice(0, 400));
});

test('a second conversation step with the same NPC is sent back for correction', () => {
  const f = fixture('repeated');
  const frozen = freezeAuthoredProbeContext(f, f.state, { rootActionId: `${f.rootActionId}:repeated`, intentText: '我边问守夜人这阀门平时谁管，边偷偷去拧它。', focusRefs: [FEATURE, NPC] });
  // Round 113's shape: a silent second step for the same NPC, bound onSuccess, used as a place to say "you got it".
  const value = hiddenAct();
  value.proposals[1] = { ...structuredClone(value.proposals[0]), outcomeBinding: 'onSuccess', branches: { success: { outcomeCode: 'outcome:taken',
    summary: '得手了。', npcPerceives: null, response: { kind: 'silence', text: '', motive: '没看出来。', basis: [{ kind: 'npcContext', ref: NPC }] }, consequences: [] }, failure: null } };
  let outcome;
  try { outcome = lowerVNext2ProposalBundle({ ...f, rootActionId: `${f.rootActionId}:repeated`, requiredContext: frozen.context, value }); }
  catch (error) { outcome = { kind: 'rejected', issues: [String(error.message)] }; }
  assert.notEqual(outcome.kind, 'accepted');
  assert.ok(JSON.stringify(outcome).includes('bundle:social-npc-repeated'), JSON.stringify(outcome).slice(0, 400));
});

// Round 114: with no step carrying both outcomes, the correction round only
// saw "successFailurePairs: 1" and made things worse. The diagnostic now lists
// the current steps and says where a noticed hidden act belongs.
test('a check with no step carrying both outcomes tells the correction which steps exist and where the failure goes', () => {
  const value = hiddenAct();
  value.proposals[0].branches.failure = null;
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(value)));
  assert.equal(parsed.kind, 'locallyRejected');
  const shape = parsed.diagnostics.find(entry => entry.constraint === 'bundle:shared-check-shape-invalid');
  assert.ok(shape, JSON.stringify(parsed.diagnostics).slice(0, 300));
  // Ordinals follow the decoded draft, which groups steps by type.
  assert.deepEqual(shape.expected.currentSteps, [
    { ordinal: 0, kind: 'observe', outcomeBinding: 'onFailure', failureWritten: false },
    { ordinal: 1, kind: 'social', outcomeBinding: 'always', failureWritten: false }]);
  assert.match(shape.expected.hiddenAct, /onFailure observe step/);
});
