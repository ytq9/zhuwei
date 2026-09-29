import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE, PROBE_SOURCE as VALVE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { proposalNpcSourceChoices, proposalItemEntryRefs, proposalObservationSubjectRefs, proposalCreatureTargetRefs } from '../../../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { requiredContextBasisReferences } from '../../../app/_runtime/lib/kp/vnext/required-context-runtime.ts';
import { encodeVNextStrictToolBundle, createVNextProposalBundleSchema } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { vnextProposalModelRepairDiagnostics } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { lowerVNext2ProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { socialPromiseSubjectAdmissible } from '../../../app/_runtime/lib/rules/v2/social-interaction.ts';
import { deepSeekStrictToolSchemaIssues } from '../../../app/_runtime/lib/kp/deepseek-strict-tool.ts';
import { expandDeepSeekSchema, schemaVariants } from '../../support/fixtures/expand-deepseek-schema.mjs';
import { stepActionToDecision } from '../../support/fixtures/vnext-action-lifecycle.mjs';
import { PROBE_TARGET as OTHER } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { npcReplyModelInput, npcReplySteps } from '../../../app/_runtime/lib/kp/vnext/npc-reply.ts';
import { parseWithNpcReplies, settleWithDomainReplies } from '../../support/fixtures/vnext-npc-replies.mjs';

// A promise is about people, things the NPC can see, its own records, or the
// scene. Round94 wrote an item definition into terms.subjectRefs; Rules
// refused it with a bare code and the model kept it through its one
// revision. The schema now offers only admissible subjects, and lowering
// names the exact slot with the admissible set before Rules ever runs.
const NPC = 'npc:promise:keeper', DUTY = 'knowledge:duty';
const PROFILE = 'profile-context:module:authored-probe';
function fixture(label) {
  const f = createAuthoredProbeFixture(`promise-subjects:${label}`, { npcCharacters: [{ id: NPC, name: '守门人' }],
    initialKnowledge: [{ characterId: NPC, knowledgeRef: DUTY, content: '今晚要守好阀门。', kind: 'sourceClaim', layer: 'partial', visibility: 'private', provenanceChain: ['genesis:duty'] }] });
  const context = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [NPC, VALVE], intentText: '我请守门人今晚替我看好阀门。' }).context;
  return { ...f, requiredContext: context };
}
function promise(terms) {
  return { kind: 'promise', content: '今晚我替你看着阀门。', condition: '天亮前。', promisor: 'npc', promiseeRef: ACTOR, authorityRefs: [NPC], due: 'nextDawn', terms, nextStep: null };
}
function bundle(consequences) {
  return { mode: 'adjudication', basisRefs: [NPC], terminal: null,
    adjudication: { kind: 'directSuccess', durationMicros: '300000000', risk: '普通请求。', successOutcome: '守门人答应。' },
    proposals: [{ kind: 'social', basisRefs: [NPC], consumes: [{ kind: 'existing', ref: NPC }], produces: [], outcomeBinding: 'always', sceneRef: SCENE,
      npcRef: NPC, addressedThreadRef: null, actorSpeech: '请帮我看好阀门。', goal: '请守门人看好阀门。', method: '当面请求。', communication: 'spokenConversation', audience: 'participants', retryChange: null,
      branches: { success: { outcomeCode: 'outcome:agreed', summary: '守门人答应。', npcPerceives: null, response: { kind: 'speech', text: '好，我看着。', motive: '本分。', basis: [{ kind: 'npcContext', ref: NPC }] }, consequences }, failure: null } }] };
}
// SPEC 0016 §7.3, SPEC 0006 §7 (ADR 0073): what the NPC undertakes is written
// by its own reply. `routed` is where a rejection of the merged plan goes: a
// second request to the NPC whose reply it faults, at the reply's own path.
function lower(f, domain, change) {
  const wire = encodeVNextStrictToolBundle(domain);
  const candidate = parseWithNpcReplies(wire, domain, f.requiredContext, { change });
  assert.equal(candidate.kind, 'accepted', JSON.stringify(candidate));
  const lowered = lowerVNext2ProposalBundle({ ...f, value: candidate.bundle });
  const routed = lowered.kind !== 'rejected' ? undefined
    : settleWithDomainReplies(candidate.ruling, domain, f.requiredContext, { change, rejected: () => lowered.diagnostics ?? [] });
  return { wire, candidate, lowered, routed };
}
const SLOT = ['proposals', 0, 'branches', 'success', 'consequences', 0];
/** The reply form of the one NPC this fixture addresses. */
function replyForm(f) {
  const [step] = npcReplySteps(bundle([]), f.requiredContext);
  const schema = npcReplyModelInput(f.requiredContext, step.hearing).tools[0].function.parameters;
  assert.deepEqual(deepSeekStrictToolSchemaIssues(schema), []);
  return expandDeepSeekSchema(schema).properties.result;
}
const ongoing = subjectRefs => ({ kind: 'ongoing', subjectRefs, delivery: null, parts: [], activation: null });

test('the shared predicate admits snapshot records, visible objects and the scene, and refuses definitions and profiles', () => {
  const f = fixture('predicate'), npc = f.state.entities[NPC];
  const snapshot = new Set([NPC, `knowledge:${NPC}:${DUTY}`]);
  for (const ref of [NPC, `knowledge:${NPC}:${DUTY}`, SCENE, VALVE, ACTOR]) assert.equal(socialPromiseSubjectAdmissible(f.state, npc, snapshot, ref), true, ref);
  for (const ref of [PROFILE, `knowledge:${ACTOR}:${DUTY}`, 'item-definition:module:authored-probe:anything', 'continuity:adjudicationPrecedents'])
    assert.equal(socialPromiseSubjectAdmissible(f.state, npc, snapshot, ref), false, ref);
});

test('lowering accepts admissible subjects and names the exact slot of an inadmissible one with the admissible set', () => {
  const f = fixture('lowering');
  assert.equal(lower(f, bundle([promise(ongoing([NPC, VALVE]))])).lowered.kind, 'accepted');
  const rejected = lower(f, bundle([promise(ongoing([NPC, PROFILE]))]));
  assert.equal(rejected.lowered.kind, 'rejected');
  assert.equal(rejected.lowered.code, 'PROPOSAL_REFERENCE_INVALID');
  assert.deepEqual(rejected.lowered.issues, ['social:promise-terms-context-unavailable']);
  const [diagnostic] = rejected.lowered.diagnostics;
  assert.equal(diagnostic.code, 'REFERENCE_UNAVAILABLE');
  assert.deepEqual(diagnostic.path, [...SLOT, 'terms', 'subjectRefs', 1]);
  assert.deepEqual(diagnostic.actual, { type: 'string', value: PROFILE });
  assert.equal(diagnostic.repair.allowed, true);
  for (const ref of [NPC, `knowledge:${NPC}:${DUTY}`, SCENE, VALVE]) assert.ok(diagnostic.expected.refs.includes(ref), ref);
  assert.ok(!diagnostic.expected.refs.includes(PROFILE));
  // A nested part and a delivery ref are located the same way.
  const nested = lower(f, bundle([promise({ kind: 'result', subjectRefs: [NPC], delivery: { sourceRef: PROFILE, itemRef: null, quantity: 1, destinationKind: 'scene', destinationRef: SCENE },
    parts: [{ partId: 'watch', content: '看住阀门。', kind: 'attempt', subjectRefs: [VALVE, PROFILE], delivery: null }], activation: null })]));
  assert.equal(nested.lowered.kind, 'rejected');
  assert.deepEqual(nested.lowered.diagnostics.map(d => d.path), [
    [...SLOT, 'terms', 'parts', 0, 'subjectRefs', 1],
    [...SLOT, 'terms', 'delivery', 'sourceRef'],
  ]);
  // The NPC wrote the promise, so the NPC is asked once more, with the slot
  // where its own reply filled it. The ruling is sent nothing of it.
  assert.equal(rejected.routed.kind, 'ask'); assert.equal(rejected.routed.ticket.attempt, 2);
  assert.deepEqual(rejected.routed.ticket.retry.diagnostics.map(d => [d.pathBase, d.path]),
    [['arguments', ['result', 'newPromises', 0, 'terms', 'subjectRefs', 1]]]);
  assert.deepEqual(nested.routed.ticket.retry.diagnostics.map(d => d.path), [
    ['result', 'newPromises', 0, 'terms', 'parts', 0, 'subjectRefs', 1],
    ['result', 'newPromises', 0, 'terms', 'delivery', 'sourceRef'],
  ]);
  assert.deepEqual(vnextProposalModelRepairDiagnostics(rejected.candidate.ruling, [], JSON.stringify(rejected.wire)), []);
});

test('round99: a kind inside a filled delivery and a bare "none" reference are located below terms on the results table', () => {
  const f = fixture('round99');
  const delivery = { sourceRef: VALVE, itemRef: null, quantity: 1, destinationKind: 'scene', destinationRef: SCENE };
  const domain = bundle([promise({ kind: 'result', subjectRefs: [NPC, VALVE], delivery, parts: [], activation: null })]);
  assert.equal(lower(f, domain).lowered.kind, 'accepted');
  // The model padded the filled delivery with a kind field. The validator now
  // names that field instead of the whole terms object.
  const wire = encodeVNextStrictToolBundle(domain);
  const padded = parseWithNpcReplies(wire, domain, f.requiredContext, { change: args => {
    const slot = args.result.newPromises[0].terms.delivery;
    assert.equal(slot.sourceRef, VALVE);
    args.result.newPromises[0].terms.delivery = { kind: 'scene', ...slot };
    return args;
  } });
  assert.equal(padded.kind, 'ask', JSON.stringify(padded).slice(0, 800));
  assert.deepEqual(padded.ticket.retry.diagnostics.map(d => [d.code, d.constraint, d.pathBase, d.path]),
    [['VALUE_INVALID', 'social:additional-field', 'arguments', ['result', 'newPromises', 0, 'terms', 'delivery', 'kind']]]);
  assert.deepEqual(padded.ticket.retry.diagnostics[0].expected, { allowedFields: ['sourceRef', 'itemRef', 'quantity', 'destinationKind', 'destinationRef'] });
  // The bare word "none" is read as the {kind:'none'} sentinel by the wire
  // decoder, so the rest of round99's draft lowers once the kind field goes.
  const parsed = parseWithNpcReplies(wire, domain, f.requiredContext, { change: args => {
    args.result.newPromises[0].terms.delivery.itemRef = 'none';
    return args;
  } });
  assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed).slice(0, 800));
  assert.equal(parsed.bundle.proposals[0].branches.success.consequences[0].terms.delivery.itemRef, null);
  assert.equal(lowerVNext2ProposalBundle({ ...f, value: parsed.bundle }).kind, 'accepted');
});

test('both forms offer only admissible promise subjects, in terms, parts and activation alike', () => {
  const f = fixture('schema'), context = f.requiredContext;
  const schema = createVNextProposalBundleSchema(['social'], proposalItemEntryRefs(context), proposalObservationSubjectRefs(context), [],
    proposalNpcSourceChoices(context), requiredContextBasisReferences(context), proposalCreatureTargetRefs(context));
  assert.deepEqual(deepSeekStrictToolSchemaIssues(schema), []);
  // The ruling's form holds what the actor undertakes, the reply's what the NPC does.
  const ruling = expandDeepSeekSchema(schema).properties.steps.properties.social.items.properties.result, reply = replyForm(f);
  assert.ok(!Object.hasOwn(ruling.properties.newPromises.items.properties, 'promisor'));
  assert.ok(!Object.hasOwn(reply.properties.newPromises.items.properties, 'promisor'));
  assert.deepEqual(reply.properties.newPromises.items.properties.authorityRefs.items.enum, [NPC]);
  for (const social of [ruling, reply]) {
    const terms = social.properties.newPromises.items.properties.terms;
    const subjects = terms.properties.subjectRefs.items.enum;
    for (const ref of [NPC, `knowledge:${NPC}:${DUTY}`, SCENE, VALVE, ACTOR]) assert.ok(subjects.includes(ref), ref);
    assert.ok(!subjects.includes(PROFILE));
    assert.ok(!subjects.some(ref => ref.startsWith('item-definition:')));
    assert.deepEqual(terms.properties.parts.items.properties.subjectRefs.items.enum, subjects);
    const activation = schemaVariants(terms.properties.activation).find(value => value.properties.subjectRefs);
    assert.deepEqual(activation.properties.subjectRefs.items.enum, subjects);
    assert.match(terms.properties.subjectRefs.description, /never an item definition/);
  }
});

function declare(f, factId, visibilityPolicy) {
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, { kind: 'declareCanonicalFact', proposalId: `${f.rootActionId}:${factId}`,
    fact: { factId, factKind: 'physicalMark', source: 'characterAction', subjectRefs: [SCENE], value: { description: '阀门旁刻着一道记号。', condition: 'present' },
      causalParentIds: [], visibilityPolicy } });
  assert.equal(result.kind, 'committed', JSON.stringify(result));
  return result.state;
}
function factFixture() {
  const f = fixture('facts');
  let state = declare(f, 'fact:public-mark', 'public');
  state = declare({ ...f, state }, 'fact:hidden-mark', 'hiddenUntilEvidence');
  const context = freezeAuthoredProbeContext(f, state, { rootActionId: f.rootActionId, focusRefs: [NPC, VALVE], intentText: '我请守门人今晚替我看好阀门。' }).context;
  return { ...f, state, requiredContext: context };
}
const relationship = basisFactRefs => ({ kind: 'relationship', relationshipRef: null, change: '守门人对我多了几分好感。', basisFactRefs });

test('a relationship or debt cites only facts the NPC can see, and the slot is named when it does not', () => {
  const f = factFixture();
  const visible = proposalNpcSourceChoices(f.requiredContext).find(choice => choice.npcRef === NPC).factRefs;
  assert.ok(visible.includes('fact:public-mark'), JSON.stringify(visible));
  assert.ok(!visible.includes('fact:hidden-mark'));
  const acceptedFact = lower(f, bundle([relationship(['fact:public-mark'])])).lowered;
  assert.equal(acceptedFact.kind, 'accepted', JSON.stringify(acceptedFact).slice(0, 1200));
  const rejected = lower(f, bundle([relationship(['fact:public-mark', 'fact:hidden-mark'])]));
  assert.equal(rejected.lowered.kind, 'rejected');
  assert.deepEqual(rejected.lowered.issues, ['social:consequence-basis-unavailable']);
  assert.deepEqual(rejected.lowered.diagnostics[0].path, [...SLOT, 'basisFactRefs', 1]);
  assert.deepEqual(rejected.lowered.diagnostics[0].expected.refs, ['fact:public-mark']);
  assert.deepEqual(rejected.routed.ticket.retry.diagnostics.map(d => d.path), [['result', 'relationshipChanges', 0, 'basisFactRefs', 1]]);
  // A promise to someone who is not listening, and a promise binding someone else, are located too.
  const stranger = lower(f, bundle([{ ...promise(ongoing([NPC])), promiseeRef: OTHER, authorityRefs: [OTHER] }]));
  assert.equal(stranger.lowered.kind, 'rejected');
  assert.deepEqual(stranger.lowered.diagnostics.map(d => [d.constraint, d.path.slice(-2)]), [
    ['social:promise-recipient-unavailable', ['consequences', 0].concat(['promiseeRef']).slice(-2)],
    ['social:promise-authority-unavailable', ['authorityRefs', 0]],
  ]);
  assert.deepEqual(stranger.routed.ticket.retry.diagnostics.map(d => d.path),
    [['result', 'newPromises', 0, 'promiseeRef'], ['result', 'newPromises', 0, 'authorityRefs', 0]]);
  const schema = createVNextProposalBundleSchema(['social'], proposalItemEntryRefs(f.requiredContext), proposalObservationSubjectRefs(f.requiredContext), [],
    proposalNpcSourceChoices(f.requiredContext), requiredContextBasisReferences(f.requiredContext), proposalCreatureTargetRefs(f.requiredContext));
  // A relationship or a debt is the NPC's to state; the ruling's form has no table for either.
  const ruling = expandDeepSeekSchema(schema).properties.steps.properties.social.items.properties.result, reply = replyForm(f);
  assert.deepEqual(Object.keys(ruling.properties).sort(), ['newPromises', 'npcPerceives', 'outcomeCode', 'promiseChanges', 'summary']);
  assert.deepEqual(reply.properties.relationshipChanges.items.properties.basisFactRefs.items.enum, ['fact:public-mark']);
  assert.deepEqual(reply.properties.newDebts.items.properties.basisFactRefs.items.enum, ['fact:public-mark']);
});
