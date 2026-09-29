import { stepActionToDecision } from '../../support/fixtures/vnext-action-lifecycle.mjs';
import { soleStep } from '../../support/fixtures/vnext-action-duration.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_SCENE as SCENE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { proposalNpcSourceChoices, proposalModelContext, npcOwnModelView } from '../../../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { npcReplyModelInput, npcReplySteps, readNpcReply, NPC_REPLY_TOOL_NAME } from '../../../app/_runtime/lib/kp/vnext/npc-reply.ts';
import { npcReplyArguments, parseWithNpcReplies, toolCallResponse } from '../../support/fixtures/vnext-npc-replies.mjs';
import { npcDecisionContext, npcDecisionEvidenceRef, npcDecisionEntryRef } from '../../../app/_runtime/lib/rules/v2/npc-decision-context.ts';
import { encodeVNextStrictToolBundle, decodeVNextStrictToolBundle, createVNextProposalBundleSchema, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { lowerVNext2ProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { expandDeepSeekSchema } from '../../support/fixtures/expand-deepseek-schema.mjs';
import { worldFactSocialBundle } from '../../support/fixtures/vnext-world-facts.mjs';
import { deepSeekStrictToolSchemaIssues } from '../../../app/_runtime/lib/kp/deepseek-strict-tool.ts';

const A = 'npc:source:archivist', B = 'npc:source:herbalist', KNOWLEDGE = 'knowledge:shared-local-name';
const held = npc => `knowledge:${npc}:${KNOWLEDGE}`;
function fixture(name) {
  const f = createAuthoredProbeFixture(`source-choice:${name}`, { npcCharacters: [A, B].map(id => ({ id, name: id })),
    initialKnowledge: [A, B].map(characterId => ({ characterId, knowledgeRef: KNOWLEDGE, kind: 'sourceClaim', layer: 'full',
      content: characterId === A ? 'PRIVATE_SOURCE_A_CONTENT' : 'PRIVATE_SOURCE_B_CONTENT', visibility: 'private', provenanceChain: ['genesis:source'] })) });
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [A, B], intentText: '我向两人介绍了今天的来意。' }).context;
  return f;
}
function bundle(npcRef, basis, check = false) {
  const branch = outcomeCode => ({ outcomeCode, summary: '对方作出回应。', npcPerceives: null, response: { kind: 'speech', text: '我听到了你的来意。', motive: '依据本人背景和当前听到的话作答。', basis }, consequences: [] });
  return { mode: 'adjudication', basisRefs: [npcRef], terminal: null,
    adjudication: check ? { kind: 'check', durationMicros: '300000000', checkKind: 'abilityCheck', ability: 'cha', skill: 'persuasion', dc: 12, mode: 'normal', risk: '对方可能拒绝。', successOutcome: '作出回应。', failureOutcome: '拒绝回答。' }
      : { kind: 'directSuccess', durationMicros: '300000000', risk: '普通交谈。', successOutcome: '作出回应。' },
    proposals: [{ kind: 'social', basisRefs: [npcRef], consumes: [{ kind: 'existing', ref: npcRef }], produces: [], outcomeBinding: 'always', sceneRef: SCENE,
      npcRef, addressedThreadRef: null, actorSpeech: '我来是想问问情况。', goal: '说明来意。', method: '当面交谈。', communication: 'spokenConversation', audience: 'participants', retryChange: null,
      branches: { success: branch('outcome:answered'), failure: check ? branch('outcome:declined') : null } }] };
}
// SPEC 0016 §7.3, SPEC 0006 §7 (ADR 0073): the ruling's form holds no reply.
// `domain` is the complete plan; its replies are what the NPC's own call returns.
const parse = wire => parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wire));
function lower(f, domain, options) {
  const result = parseWithNpcReplies(encodeVNextStrictToolBundle(domain), domain, f.requiredContext, options);
  return result.kind === 'accepted' ? lowerVNext2ProposalBundle({ ...f, value: result.bundle }) : result;
}
/** The reply an NPC's own call returned, read by the form it was asked with. */
function reading(f, domain, change = args => args) {
  const [answer] = npcReplyArguments(domain, f.requiredContext);
  return readNpcReply(toolCallResponse(NPC_REPLY_TOOL_NAME, change(structuredClone(answer.arguments))), answer.step.hearing);
}

test('two NPCs and existing/player-expression sources share one frozen selector, codec and Rules path', () => {
  const f = fixture('holders'), before = structuredClone(f.requiredContext), choices = proposalNpcSourceChoices(f.requiredContext);
  assert.deepEqual(proposalModelContext(f.requiredContext).references.npcSourceChoices, choices);
  for (const npc of [A, B]) {
    const refs = choices.find(choice => choice.npcRef === npc).refs, context = npcDecisionContext(f.requiredContext.entries, npc);
    assert.ok(refs.includes(held(npc))); assert.ok(!refs.includes(npcDecisionEntryRef(npc)));
    assert.ok(refs.every(ref => npcDecisionEvidenceRef(context, ref) === ref));
  }
  for (const [npc, basis] of [[A, [{ kind: 'npcContext', ref: A }]], [B, [{ kind: 'npcContext', ref: held(B) }]], [A, [{ kind: 'playerExpression' }]]]) {
    const domain = bundle(npc, basis), wire = encodeVNextStrictToolBundle(domain), original = structuredClone(wire);
    // The ruling writes no reply; the NPC's own reply names its sources.
    assert.ok(!Object.hasOwn(wire.steps.social[0].result, 'response'));
    assert.deepEqual(npcReplyArguments(domain, f.requiredContext)[0].arguments.result.basis,
      basis.map(source => source.kind === 'npcContext' ? source.ref : source.kind === 'playerExpression' ? 'playerExpression' : source));
    const candidate = parseWithNpcReplies(wire, domain, f.requiredContext); assert.equal(candidate.kind, 'accepted', JSON.stringify(candidate)); assert.deepEqual(wire, original);
    // A ruling alone never commits a conversation.
    assert.deepEqual(lowerVNext2ProposalBundle({ ...f, value: candidate.ruling }).issues, ['social:npc-reply-missing']);
    assert.deepEqual(candidate.bundle.proposals[0].branches.success.response.basis, basis);
    const lowered = lowerVNext2ProposalBundle({ ...f, value: candidate.bundle }); assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
    const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput); assert.equal(result.kind, 'committed', JSON.stringify(result));
    const replayed = f.runtime.replay(f.genesis, result.events); assert.equal(replayed.kind, 'replayed'); assert.deepEqual(replayed.state, result.state);
    // SPEC 0001 §14: the listeners' record is what was said, not the raw input.
    assert.equal(soleStep(lowered.command).plan.social.playerExpression, domain.proposals[0].actorSpeech);
  }
  assert.deepEqual(f.requiredContext, before);
});

test('the reply form offers only its own NPC\'s frozen refs, and a new fact form only for a fact this plan gives that NPC', () => {
  const f = fixture('schema'), choices = proposalNpcSourceChoices(f.requiredContext);
  // The ruling's form asks for no reply at all.
  const ruling = expandDeepSeekSchema(createVNextProposalBundleSchema(['social', 'materializeObject'], [], [], [], choices));
  assert.deepEqual(Object.keys(ruling.properties.steps.properties.social.items.properties.result.properties).sort(),
    ['newPromises', 'npcPerceives', 'outcomeCode', 'promiseChanges', 'summary']);
  for (const materialize of [false, true]) {
    const domain = materialize ? worldFactSocialBundle({ sceneRef: SCENE, npcRef: A }) : bundle(A, [{ kind: 'playerExpression' }]);
    const [step] = npcReplySteps(domain, f.requiredContext), input = npcReplyModelInput(f.requiredContext, step.hearing);
    const schema = input.tools[0].function.parameters;
    assert.deepEqual(deepSeekStrictToolSchemaIssues(schema), []);
    // Round 86: the closed set sits on the array item itself, playerExpression a member of it; an anyOf appears only to admit a producer's handle.
    const items = expandDeepSeekSchema(schema).properties.result.properties.basis.items;
    const source = { type: 'string', enum: [...choices.find(value => value.npcRef === A).refs, 'playerExpression'] };
    if (materialize) {
      assert.deepEqual(items.anyOf[0], source);
      assert.equal(items.anyOf.length, 2);
      assert.deepEqual(items.anyOf[1].properties.worldFactRef.enum, step.hearing.newKnowledge.map(fact => fact.handle));
    } else assert.deepEqual(items, source);
    assert.ok(!JSON.stringify(items).includes('holderRef')); assert.ok(!JSON.stringify(items).includes(held(B)));
    // The other NPC's memory is no part of what this NPC reads.
    assert.ok(JSON.stringify(npcOwnModelView(f.requiredContext, A)).includes('PRIVATE_SOURCE_A_CONTENT'));
    assert.ok(!JSON.stringify(input).includes('PRIVATE_SOURCE_B_CONTENT'));
  }
});

test('other holder, wrapper and unknown refs reject at the exact original wire index with own candidates only', () => {
  const f = fixture('refusal');
  for (const ref of [held(B), npcDecisionEntryRef(A), 'knowledge:invented']) {
    const domain = bundle(A, [{ kind: 'npcContext', ref }], true);
    const result = lower(f, domain); assert.equal(result.kind, 'rejected', JSON.stringify(result));
    assert.equal(result.diagnostics.length, 2);
    for (const diagnostic of result.diagnostics) {
      // The reply of a conversation a check decides has both results; the
      // diagnostic names the place in the merged plan that the reply filled.
      assert.deepEqual(diagnostic.path.slice(0, 3), ['proposals', 0, 'branches']);
      assert.ok(['success', 'failure'].includes(diagnostic.path[3]));
      assert.deepEqual(diagnostic.path.slice(4), ['response', 'basis', 0, 'ref']);
      assert.equal(diagnostic.repair.allowed, false); assert.ok(!diagnostic.expected.refs.includes(held(B)));
    }
    assert.doesNotMatch(JSON.stringify(result.diagnostics), /PRIVATE_SOURCE_[AB]_CONTENT/);
  }
});

test('explicit prospective source keeps holder derivation and rejects missing producer and retired object wires', () => {
  const f = fixture('prospective'), domain = worldFactSocialBundle({ sceneRef: SCENE, npcRef: A });
  const handle = domain.proposals[1].branches.success.response.basis[0].definitionRef;
  const [answer] = npcReplyArguments(domain, f.requiredContext);
  // The plan gives the NPC the new fact to know; its reply cites it by handle.
  assert.deepEqual(answer.step.hearing.newKnowledge.map(fact => fact.handle), [handle]);
  assert.deepEqual(answer.arguments.result.basis[0], { worldFactRef: handle });
  const read = reading(f, domain); assert.equal(read.kind, 'read', JSON.stringify(read));
  assert.deepEqual(read.reply.result.response.basis[0], { kind: 'materializedKnowledge', definitionRef: handle, holderRef: A });
  const lowered = lower(f, domain); assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  assert.equal(stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput).kind, 'committed');
  // A reply that cites a fact no step of the plan produces fails with the merged plan.
  const missing = structuredClone(domain); missing.proposals.splice(0, 1);
  const wire = encodeVNextStrictToolBundle(missing);
  const candidate = parse(wire); assert.equal(candidate.kind, 'accepted', JSON.stringify(candidate));
  assert.deepEqual(npcReplySteps(candidate.bundle, f.requiredContext)[0].hearing.newKnowledge, []);
  for (const old of [{ kind: 'npcContext', ref: held(A) }, { kind: 'materializedKnowledge', definitionRef: 'prospective:x', holderRef: A }]) {
    const rejected = reading(f, domain, args => { args.result.basis = [old]; return args; });
    assert.equal(rejected.kind, 'unreadable');
    assert.ok(rejected.diagnostics.some(d => d.pathBase === 'arguments' && JSON.stringify(d.path) === JSON.stringify(['result', 'basis', 0])));
  }
  // An existing memory is cited by its ref; as a new fact it is not one the plan gave.
  const invalid = lower(f, domain, { change: args => { args.result.basis = [{ worldFactRef: held(A) }]; return args; } });
  assert.equal(invalid.kind, 'ask', JSON.stringify(invalid)); assert.equal(invalid.ticket.attempt, 2);
  assert.deepEqual(invalid.ticket.retry.diagnostics.map(d => [d.constraint, d.path, d.expected]),
    [['npc-reply:new-fact-not-given', ['result', 'basis', 0, 'worldFactRef'], { handles: [handle] }]]);
  // The ruling's form has no place for a reply.
  for (const field of ['response', 'relationshipChanges', 'newDebts']) {
    const mixed = structuredClone(encodeVNextStrictToolBundle(domain)); mixed.steps.social[0].result[field] = field === 'response' ? answer.arguments.result : [];
    assert.throws(() => parse(mixed), error => error.diagnostics?.some(d => d.constraint === 'social:reply-belongs-to-the-npc'
      && d.pathBase === 'arguments' && JSON.stringify(d.path) === JSON.stringify(['steps', 'social', 0, 'result', field])));
  }
});

test('missing, malformed and repeated sources are reported at their place in the reply and may be asked once more', () => {
  const f = fixture('malformed'), domain = bundle(A, [{ kind: 'npcContext', ref: A }]);
  for (const value of [undefined, {}, [], [A, A], [{ worldFactRef: 3 }]]) {
    const settled = parseWithNpcReplies(encodeVNextStrictToolBundle(domain), domain, f.requiredContext, { change: args => {
      if (value === undefined) delete args.result.basis; else args.result.basis = value;
      return args;
    } });
    // The one second request carries the reply as it was saved and what was wrong with it.
    assert.equal(settled.kind, 'ask', JSON.stringify(settled));
    assert.equal(settled.ticket.attempt, 2);
    assert.equal(settled.ticket.retry.reply, JSON.stringify(JSON.parse(settled.saved[0].response.choices[0].message.tool_calls[0].function.arguments)));
    assert.ok(settled.ticket.retry.diagnostics.length > 0);
    for (const detail of settled.ticket.retry.diagnostics) {
      assert.equal(detail.pathBase, 'arguments');
      assert.deepEqual(detail.path.slice(0, 2), ['result', 'basis']);
      assert.equal(detail.repair.allowed, true);
    }
  }
});
