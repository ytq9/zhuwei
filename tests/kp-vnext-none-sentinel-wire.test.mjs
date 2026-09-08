import { row, rowIndex, dropRow, nestedDecision } from './fixtures/vnext-wire-tables.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_SCENE as SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { encodeVNextStrictToolBundle } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { sharedCheckBundle } from './fixtures/vnext-shared-check.mjs';
import { parseSubmitKpProposalBundleCandidateArguments, invokeSubmitKpProposalBundleFirstPass } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { assertDeepSeekStrictToolModelInput } from '../app/_runtime/lib/kp/deepseek.ts';

// Round 79 lost its whole batch because the model wrote addressedThreadRef as
// a bare "none" instead of {kind:"none"}. The strict-tool codec already turned
// that spelling into the domain null on most nullable reference fields; two
// were missing from its list. The reference grammar reserves the word, so on
// a nullable field the string can only mean the sentinel, and every such field
// must decode it the same way. Anywhere else "none" stays a reference error.
const NPC = 'npc:none-sentinel:archivist';
function socialWire(addressedThreadRef, relationshipRef) {
  return { decision: { kind: 'directSuccess', duration: '5min', risk: '普通交谈。', successOutcome: '作出回应。' },
    steps: [{ kind: 'social', basisRefs: [NPC], sceneRef: SCENE, npcRef: NPC, addressedThreadRef, goal: '说明来意。', method: '当面交谈。',
      audience: 'participants', retryChange: { kind: 'none' }, outcomeBinding: 'always' }],
    results: [{ kind: 'social', step: 0, branch: 'result', outcomeCode: 'answered', summary: '对方作出回应。',
      responseKind: 'speech', responseText: '我听到了。', responseMotive: '回应本人刚听到的话。', responseBasis: [{ kind: 'playerExpression' }],
      consequences: relationshipRef === undefined ? [] : [{ kind: 'relationship', relationshipRef, change: '略有好感。', basisFactRefs: [] }] }] };
}
function planWire(factionRef) {
  return { decision: { kind: 'directSuccess', duration: 'none', risk: '只形成私有计划。', successOutcome: '记录计划。' },
    steps: [{ kind: 'formActorPlan', npcRef: NPC, factionRef, goal: '整理档案。', nextStep: '取出账册。', premiseRefs: [NPC], resourceRefs: [],
      durationMicros: '2000000', traceDescription: '账台上多了一本翻开的账册。', alternateTargetRef: SCENE, alternateReason: '若账册不在，改为询问。', outcomeBinding: 'always' }],
    results: [] };
}
function checkWire(skill, abilityRef) {
  const wire = encodeVNextStrictToolBundle(sharedCheckBundle('worldInteraction'));
  wire.decision.skill = skill;
  for (const step of wire.steps) if (step.kind === 'worldInteraction') step.abilityRef = abilityRef;
  return wire;
}
const parse = wire => parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wire));

test('a bare "none" and {kind:"none"} parse to byte-identical bundles on every nullable reference field', () => {
  // The exact shape the model produced in round 79, plus every other field the wire offers as ref-or-none.
  for (const [label, bare, sentinel] of [
    ['social addressedThreadRef + relationshipRef', socialWire('none', 'none'), socialWire({ kind: 'none' }, { kind: 'none' })],
    ['formActorPlan factionRef', planWire('none'), planWire({ kind: 'none' })],
    ['check skill + worldInteraction abilityRef', checkWire('none', 'none'), checkWire({ kind: 'none' }, { kind: 'none' })],
  ]) {
    const a = parse(bare), b = parse(sentinel);
    assert.equal(a.kind, 'accepted', `${label}: ${JSON.stringify(a)}`);
    assert.equal(b.kind, 'accepted', `${label}: ${JSON.stringify(b)}`);
    assert.equal(a.bundleHash, b.bundleHash, label);
    assert.equal(canonicalHash(a.bundle), canonicalHash(b.bundle), label);
  }
  const parsed = parse(socialWire('none', 'none'));
  assert.equal(parsed.bundle.proposals[0].addressedThreadRef, null);
  assert.equal(parsed.bundle.proposals[0].branches.success.consequences[0].relationshipRef, null);
  // An actual reference on the same field is left alone; the domain-to-wire encoder keeps the domain null as is.
  assert.equal(parse(socialWire('thread:one')).bundle.proposals[0].addressedThreadRef, 'thread:one');
  assert.equal(encodeVNextStrictToolBundle(parsed.bundle).steps[0].addressedThreadRef, null);
});

test('"none" on a field that is not nullable stays a reference error, not a sentinel', () => {
  for (const mutate of [
    wire => { wire.steps[0].npcRef = 'none'; },
    wire => { wire.steps[0].basisRefs = ['none']; },
    wire => { wire.steps[0].sceneRef = 'none'; },
  ]) {
    const wire = socialWire({ kind: 'none' }); mutate(wire);
    const parsed = parse(wire);
    assert.equal(parsed.kind, 'locallyRejected');
    assert.ok(parsed.diagnostics.every(d => d.repair.allowed === false), JSON.stringify(parsed.diagnostics));
  }
});

test('the round 79 shape now reaches local acceptance in one call, with no correction spent', async () => {
  const f = createAuthoredProbeFixture('none-sentinel:accepted', { npcCharacters: [{ id: NPC, name: '档案员' }] });
  f.requiredContext = freezeAuthoredProbeContext(f, f.state,
    { rootActionId: f.rootActionId, focusRefs: [NPC], intentText: '我向对方说明来意。' }).context;
  let calls = 0;
  const result = await invokeSubmitKpProposalBundleFirstPass({
    modelId: 'test', message: '冻结上下文', requiredContext: f.requiredContext, capabilities: ['social'], terminalKinds: [],
    binding: { async run(_model, request) {
      assertDeepSeekStrictToolModelInput(request); calls += 1;
      return { choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function',
        function: { name: 'submit_kp_proposal_bundle', arguments: JSON.stringify(socialWire('none')) } }] } }] };
    } },
  });
  assert.equal(calls, 1);
  assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result));
  assert.equal(result.bundle.proposals[0].addressedThreadRef, null);
});

test('a promise on the wire carries its due tier and trace; due none takes the none sentinel as its trace', () => {
  const promise = (due, trace) => {
    const wire = socialWire({ kind: 'none' });
    row(wire, 0, 'result').consequences = [{ kind: 'promise', content: '明早卯时把备案文书送到账台。', condition: '天亮以后。', authorityRefs: [NPC], due, trace }];
    return wire;
  };
  const timed = parse(promise('nextDawn', '账台上多了一份盖印的备案文书。'));
  assert.equal(timed.kind, 'accepted', JSON.stringify(timed));
  assert.deepEqual(timed.bundle.proposals[0].branches.success.consequences[0], { kind: 'promise', content: '明早卯时把备案文书送到账台。',
    condition: '天亮以后。', authorityRefs: [NPC], due: 'nextDawn', trace: '账台上多了一份盖印的备案文书。' });
  const context = parse(promise('none', { kind: 'none' }));
  assert.equal(context.kind, 'accepted', JSON.stringify(context));
  assert.equal(context.bundle.proposals[0].branches.success.consequences[0].trace, null);
  // A trace without a due, or a due without a trace, is refused.
  assert.equal(parse(promise('none', '有痕迹。')).kind, 'locallyRejected');
  assert.equal(parse(promise('1h', { kind: 'none' })).kind, 'locallyRejected');
  assert.equal(parse(promise('tomorrow', '有痕迹。')).kind, 'locallyRejected');
});
