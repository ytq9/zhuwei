import { soleStep } from './fixtures/vnext-action-duration.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE } from '../app/_runtime/lib/kp/vnext/room-bridge.ts';
import { VNEXT2_PROPOSAL_BUNDLE_SCHEMA } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { proposalDiagnostic } from '../app/_runtime/lib/kp/vnext/proposal-diagnostics.ts';
import { npcDecisionContext, npcDecisionEvidenceRef } from '../app/_runtime/lib/kp/vnext/context/npc-decision.ts';
import { handleRoomAction } from '../app/_runtime/lib/room/action.ts';

const NPC = 'npc:diagnostic-guard', OTHER = 'npc:diagnostic-messenger', KNOWLEDGE = 'knowledge:route';
const ownRef = `knowledge:${NPC}:${KNOWLEDGE}`, otherRef = `knowledge:${OTHER}:${KNOWLEDGE}`;
function fixture(label) {
  const f = createAuthoredProbeFixture(`private-lowering:${label}`, {
    npcCharacters: [{ id: NPC, name: '守门人' }, { id: OTHER, name: '信使' }],
    initialKnowledge: [NPC, OTHER].map(characterId => ({ characterId, knowledgeRef: KNOWLEDGE, kind: 'sourceClaim', layer: 'full',
      content: characterId === NPC ? 'OWN-NPC-KNOWLEDGE-CONTENT' : 'OTHER-NPC-KNOWLEDGE-SECRET', visibility: 'private', provenanceChain: ['genesis:route'] })),
  });
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [NPC, OTHER], intentText: '请告诉我信使的路线。' }).context;
  return f;
}
function social(npcRef = NPC, ref = ownRef) {
  const branch = outcomeCode => ({ outcomeCode, summary: '守门人作出了回应。',
    response: { kind: 'speech', text: '我听说信使经过了北门。', motive: 'PRIVATE-MOTIVE', basis: [{ kind: 'npcContext', ref }] }, consequences: [] });
  return { kind: 'social', basisRefs: [npcRef], consumes: [], produces: [], outcomeBinding: 'always', sceneRef: SCENE,
    npcRef, addressedThreadRef: null, goal: '询问信使路线。', method: '平静询问。', communication: 'spokenConversation', audience: 'participants', retryChange: null,
    branches: { success: branch('outcome:answered'), failure: branch('outcome:declined') } };
}
function bundle(check = true) {
  return { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: 'proposalBundle', mode: 'adjudication', basisRefs: [NPC], terminal: null,
    adjudication: check ? { kind: 'check', durationMicros: '6000000', checkKind: 'abilityCheck', ability: 'cha', skill: 'persuasion', dc: 12, mode: 'normal',
      risk: '守门人可能拒绝。', successOutcome: '守门人回答。', failureOutcome: '守门人拒绝。' }
      : { kind: 'directSuccess', durationMicros: '6000000', risk: '普通交谈。', successOutcome: '对话得到回应。' },
    proposals: [social()],
  };
}
function bridge(f, value) {
  return VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE.lowerProposal({ proposal: value, preparedActionId: `prepared:${f.rootActionId}`,
    rootActionId: f.rootActionId, actorCharacterId: ACTOR, principalId: 'principal:probe-actor',
    requiredContext: f.requiredContext, profiles: f.profiles, state: f.state });
}

test('foreign NPC basis reports each exact branch and index using only this NPC loaded evidence', () => {
  const f = fixture('precise-paths'), value = bundle();
  value.proposals[0].branches.success.response.basis.push({ kind: 'npcContext', ref: otherRef });
  value.proposals[0].branches.failure.response.basis = [{ kind: 'npcContext', ref: 'knowledge:unloaded-holder:unloaded-record' }];
  const before = structuredClone(f.state), rejected = lowerVNext2ProposalBundle({ ...f, value });
  assert.equal(rejected.kind, 'rejected');
  assert.equal(rejected.code, 'PROPOSAL_REFERENCE_INVALID');
  assert.deepEqual(rejected.issues, ['social:foreign-npc-basis']);
  assert.deepEqual(rejected.diagnostics.map(d => d.path), [
    ['decision', 'steps', 0, 'success', 'response', 'basis', 1],
    ['decision', 'steps', 0, 'failure', 'response', 'basis', 0],
  ]);
  const context = npcDecisionContext(f.requiredContext.entries, NPC);
  assert.ok(context && npcDecisionContext(f.requiredContext.entries, OTHER), 'both NPC snapshots are loaded');
  for (const diagnostic of rejected.diagnostics) {
    assert.equal(diagnostic.code, 'REFERENCE_UNAVAILABLE');
    assert.equal(diagnostic.repair.allowed, false);
    assert.equal(diagnostic.expected.npcRef, NPC);
    assert.ok(diagnostic.expected.refs.includes(ownRef));
    assert.ok(!diagnostic.expected.refs.includes(otherRef));
    assert.ok(diagnostic.expected.refs.every(ref => npcDecisionEvidenceRef(context, ref) === ref));
  }
  assert.deepEqual(rejected.diagnostics[0].actual, { type: 'string', value: otherRef });
  assert.doesNotMatch(JSON.stringify(rejected), /OTHER-NPC-KNOWLEDGE-SECRET|OWN-NPC-KNOWLEDGE-CONTENT|PRIVATE-MOTIVE/);
  assert.deepEqual(f.state, before);
  const bridged = bridge(f, value);
  assert.deepEqual(bridged.issues, rejected.issues);
  assert.deepEqual(bridged.diagnostics, rejected.diagnostics);
});

test('valid NPC basis preserves its normal Rules lowering and a later proposal reports its own ordinal', () => {
  const f = fixture('normal-and-ordinal'), valid = bundle();
  const accepted = lowerVNext2ProposalBundle({ ...f, value: valid });
  assert.equal(accepted.kind, 'accepted', JSON.stringify(accepted));
  assert.equal(soleStep(accepted.command).plan.social.npcContext.npcRef, NPC);
  assert.equal(bridge(f, valid).kind, 'accepted');
  const multiple = bundle(false);
  multiple.proposals = [social(OTHER, otherRef), social(NPC, otherRef)];
  multiple.proposals.forEach(entry => { entry.branches.failure = null; });
  const rejected = lowerVNext2ProposalBundle({ ...f, value: multiple });
  assert.equal(rejected.kind, 'rejected');
  assert.deepEqual(rejected.diagnostics[0].path, ['decision', 'steps', 1, 'result', 'response', 'basis', 0]);
});

test('unselected clarification lowering preserves every private diagnostic with its exact branch prefix', () => {
  const f = fixture('clarification-paths'), inner = bundle(), invalid = structuredClone(inner);
  invalid.proposals[0].branches.success.response.basis.push({ kind: 'npcContext', ref: otherRef });
  invalid.proposals[0].branches.failure.response.basis = [{ kind: 'npcContext', ref: 'knowledge:unknown:record' }];
  const original = lowerVNext2ProposalBundle({ ...f, value: invalid });
  assert.equal(original.kind, 'rejected');
  const value = { schema: inner.schema, kind: 'proposalBundle', mode: 'terminal', basisRefs: [], adjudication: null, proposals: [],
    terminal: { kind: 'clarification', intent: '确认交谈方案。', method: '先问再行动。', question: '采用哪个方案？',
      choices: [inner, invalid].map((entry, index) => ({ choiceId: `choice-${index}`, label: `方案 ${index}`,
        publicRisk: '对方可能拒绝回答。', basisRefs: [], continuation: { kind: 'adjudication', basisRefs: entry.basisRefs,
          adjudication: entry.adjudication, proposals: entry.proposals } })) } };
  const before = structuredClone(f.state), rejected = lowerVNext2ProposalBundle({ ...f, value });
  assert.equal(rejected.kind, 'rejected');
  assert.deepEqual(rejected.diagnostics, original.diagnostics.map(detail => ({ ...detail,
    path: ['decision', 'choices', 1, 'continuation', ...detail.path.slice(1)] })));
  assert.deepEqual(bridge(f, value).diagnostics, rejected.diagnostics);
  assert.deepEqual(f.state, before);
  assert.doesNotMatch(JSON.stringify(rejected), /OTHER-NPC-KNOWLEDGE-SECRET|OWN-NPC-KNOWLEDGE-CONTENT|PRIVATE-MOTIVE/);
});

test('existing validator diagnostics and structured nested failures survive lowering and the private bridge', () => {
  const f = fixture('nested'), invalid = bundle();
  invalid.adjudication.dc = '12';
  const lowered = lowerVNext2ProposalBundle({ ...f, value: invalid });
  assert.equal(lowered.kind, 'rejected');
  assert.ok(lowered.diagnostics.length > 0);
  assert.deepEqual(bridge(f, invalid).diagnostics, lowered.diagnostics);
  const diagnostic = proposalDiagnostic('CONSTRAINT_CONFLICT', 'test:structured-private-failure', { path: ['proposals', 0, 'method'] });
  const fault = new Error('DO-NOT-DISCLOSE-EXCEPTION-MESSAGE', { cause: {
    code: 'PROPOSAL_REFERENCE_INVALID', issues: ['test:structured-private-failure'], diagnostics: [diagnostic],
  } });
  const input = { ...f, value: bundle() };
  Object.defineProperty(input, 'requiredContext', { get() { throw fault; } });
  const failure = lowerVNext2ProposalBundle(input);
  assert.deepEqual(failure, { kind: 'rejected', code: 'PROPOSAL_REFERENCE_INVALID', issues: ['test:structured-private-failure'], diagnostics: [diagnostic] });
  assert.doesNotMatch(JSON.stringify(failure), /DO-NOT-DISCLOSE/);
});

test('internal action failures retain lowering diagnostics inside the private proposal block', async () => {
  const f = fixture('public-boundary'), value = bundle();
  value.proposals[0].branches.success.response.basis = [{ kind: 'npcContext', ref: otherRef }];
  const privateFailure = bridge(f, value);
  assert.ok(privateFailure.diagnostics.length > 0);
  const outcome = await handleRoomAction({ principal: { principal: { id: 'principal:probe-actor', sessionVersion: 1 } },
    authority: { async prepare() { return privateFailure; } },
    kp: { async propose() { assert.fail('a rejected preparation cannot invoke KP'); } },
  }, { kind: 'intent', submissionId: 'submission:private-diagnostic', text: '询问路线。' });
  assert.equal(outcome.kind, 'rejected');
  assert.equal(outcome.code, privateFailure.code);
  assert.equal(Object.hasOwn(outcome, 'issues'), false);
  assert.equal(Object.hasOwn(outcome, 'diagnostics'), false);
  assert.deepEqual(outcome.proposal.diagnostics, privateFailure.diagnostics);
  assert.deepEqual(outcome.proposal.issues, privateFailure.issues);
  assert.notEqual(outcome.proposal.diagnostics, privateFailure.diagnostics);
});

test('knowledge mistaken for a world target reports original observe and interaction slots without permitting a target swap', () => {
  for (const kind of ['observe', 'worldInteraction']) {
    const nonSpatial = `knowledge:prior-${kind}`;
    const f = createAuthoredProbeFixture(`target-slots-${kind}`, {
      npcCharacters: [{ id: OTHER, name: '信使' }],
      initialKnowledge: [ACTOR, OTHER].map(characterId => ({ characterId, knowledgeRef: nonSpatial,
        kind: 'sensoryEvidence', layer: 'full', content: characterId === ACTOR ? '此前看见场景中的物件。' : 'OTHER-NPC-KNOWLEDGE-SECRET',
        visibility: 'private', provenanceChain: ['genesis:prior'] })),
    });
    const value = bundle(false), branch = { outcomeCode: 'seen', summary: '查看当前场景。', sensoryEvidence: [] };
    value.proposals = [kind === 'observe'
      ? { kind, basisRefs: [nonSpatial], consumes: [], produces: [], outcomeBinding: 'always', sceneRef: SCENE,
        inquiry: '查看周围。', method: '扫视。', focusRefs: [nonSpatial], existingFactRefs: [],
        branches: { success: { ...branch, characterInferences: [] }, failure: null } }
      : { kind, basisRefs: [nonSpatial], consumes: [], produces: [], outcomeBinding: 'always', sceneRef: SCENE,
        intent: '检查对象。', method: '不触碰地查看。', targetRefs: [nonSpatial], directTargetRefs: [nonSpatial],
        instrumentRefs: [], abilityRef: null, branches: { success: { ...branch, effects: [], pressures: [], opportunities: [] }, failure: null } }];
    value.basisRefs = [nonSpatial];
    const before = structuredClone(value), state = structuredClone(f.state);
    const rejected = lowerVNext2ProposalBundle({ ...f, value });
    assert.equal(rejected.kind, 'rejected');
    assert.deepEqual(rejected.issues, ['world-interaction:direct-target-not-addressable']);
    const diagnostic = rejected.diagnostics[0];
    assert.equal(diagnostic.code, 'REFERENCE_UNAVAILABLE');
    assert.deepEqual(diagnostic.path, ['proposals', 0, kind === 'observe' ? 'focusRefs' : 'directTargetRefs', 0]);
    assert.deepEqual(diagnostic.actual, { type: 'string', value: nonSpatial });
    assert.equal(diagnostic.repair.allowed, false);
    assert.match(diagnostic.repair.reason, /target-replacement/);
    assert.ok(diagnostic.expected.refs.includes(SCENE));
    assert.ok(!diagnostic.expected.refs.includes(nonSpatial));
    assert.ok(!diagnostic.expected.refs.includes(otherRef));
    assert.doesNotMatch(JSON.stringify(rejected), /OTHER-NPC-KNOWLEDGE-SECRET|OWN-NPC-KNOWLEDGE-CONTENT|PRIVATE-MOTIVE/);
    assert.deepEqual(bridge(f, value).diagnostics, rejected.diagnostics);
    assert.deepEqual(value, before); assert.deepEqual(f.state, state);
  }
});

function evidenceBundle(kind, ref) {
  const value = bundle(false);
  const sensoryEvidence = [{ observerRef: ACTOR, subjectRef: SCENE, sense: 'hearing', evidence: '周围传来脚步声。', basisRefs: [ref] }];
  const base = { kind, basisRefs: [ref], consumes: [], produces: [], outcomeBinding: 'always', sceneRef: SCENE, method: '原地倾听。' };
  const result = { outcomeCode: 'heard', summary: '听见周围的声音。', sensoryEvidence };
  value.basisRefs = [ref];
  value.proposals = [kind === 'observe'
    ? { ...base, inquiry: '现在有什么声音？', focusRefs: [SCENE], existingFactRefs: [ref],
      branches: { success: { ...result, characterInferences: [] }, failure: null } }
    : { ...base, intent: '听周围的动静。', targetRefs: [SCENE], directTargetRefs: [SCENE], instrumentRefs: [], abilityRef: null,
      branches: { success: { ...result, effects: [], pressures: [], opportunities: [] }, failure: null } }];
  return value;
}

test('missing basis authorization and read binding preserve every original slot across proposal families', () => {
  for (const kind of ['observe', 'worldInteraction']) for (const failure of ['not-authorized', 'not-read-bound']) {
    const ref = `fact:unfrozen-${kind}-${failure}`, f = fixture(`basis-${kind}-${failure}`);
    if (failure === 'not-read-bound') {
      f.requiredContext = structuredClone(f.requiredContext);
      f.requiredContext.references.citations.authorityBasisRefs.push(ref);
    }
    const value = evidenceBundle(kind, ref), draft = structuredClone(value), state = structuredClone(f.state);
    const rejected = lowerVNext2ProposalBundle({ ...f, value });
    assert.equal(rejected.kind, 'rejected');
    assert.deepEqual(rejected.issues, [`proposal:basis-ref-${failure}`]);
    assert.deepEqual(rejected.diagnostics.map(detail => detail.path), [
      ['proposals', 0, 'basisRefs', 0],
      ...(kind === 'observe' ? [['proposals', 0, 'existingFactRefs', 0]] : []),
      ['proposals', 0, 'branches', 'success', 'sensoryEvidence', 0, 'basisRefs', 0],
    ]);
    for (const detail of rejected.diagnostics) {
      assert.equal(detail.code, 'REFERENCE_UNAVAILABLE');
      assert.deepEqual(detail.actual, { type: 'string', value: ref });
      assert.equal(detail.expected.source, 'frozenRequiredContext');
      assert.equal(detail.repair.allowed, false);
      assert.match(detail.repair.reason, /binding-creation/);
    }
    assert.doesNotMatch(JSON.stringify(rejected), /OTHER-NPC-KNOWLEDGE-SECRET|OWN-NPC-KNOWLEDGE-CONTENT|PRIVATE-MOTIVE/);
    assert.deepEqual(bridge(f, value).diagnostics, rejected.diagnostics);
    assert.deepEqual(value, draft); assert.deepEqual(f.state, state);
  }
});

test('valid frozen bases still lower and a missing synthesized basis has no invented draft path', () => {
  for (const kind of ['observe', 'worldInteraction']) {
    const f = fixture(`valid-basis-${kind}`), value = evidenceBundle(kind, SCENE);
    assert.equal(lowerVNext2ProposalBundle({ ...f, value }).kind, 'accepted');
  }
  const f = fixture('derived-basis'), value = evidenceBundle('observe', SCENE);
  value.proposals[0].sceneRef = 'scene:unfrozen-derived';
  const rejected = lowerVNext2ProposalBundle({ ...f, value });
  assert.equal(rejected.kind, 'rejected');
  assert.deepEqual(rejected.issues, ['proposal:basis-ref-not-authorized']);
  assert.equal(rejected.diagnostics.length, 1);
  assert.equal(Object.hasOwn(rejected.diagnostics[0], 'path'), false);
  assert.deepEqual(rejected.diagnostics[0].actual, { type: 'string', value: 'scene:unfrozen-derived' });
});
