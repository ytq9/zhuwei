import { stepActionToDecision } from '../../support/fixtures/vnext-action-lifecycle.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { lowerVNext2ProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { VNEXT2_PROPOSAL_BUNDLE_SCHEMA } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
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
