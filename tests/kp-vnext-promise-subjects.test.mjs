import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE, PROBE_SOURCE as VALVE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { proposalNpcSourceChoices, proposalItemEntryRefs, proposalObservationSubjectRefs, proposalCreatureTargetRefs } from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { requiredContextBasisReferences } from '../app/_runtime/lib/kp/vnext/required-context-runtime.ts';
import { encodeVNextStrictToolBundle, createVNextProposalBundleSchema } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments, vnextProposalModelRepairDiagnostics } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { socialPromiseSubjectAdmissible } from '../app/_runtime/lib/rules/v2/social-interaction.ts';
import { deepSeekStrictToolSchemaIssues } from '../app/_runtime/lib/kp/deepseek-strict-tool.ts';
import { expandDeepSeekSchema, schemaVariants } from './fixtures/expand-deepseek-schema.mjs';
import { stepActionToDecision } from './fixtures/vnext-action-lifecycle.mjs';
import { PROBE_TARGET as OTHER } from '../tools/lib/vnext-authored-probe-fixture.mjs';

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
      npcRef: NPC, addressedThreadRef: null, goal: '请守门人看好阀门。', method: '当面请求。', communication: 'spokenConversation', audience: 'participants', retryChange: null,
      branches: { success: { outcomeCode: 'outcome:agreed', summary: '守门人答应。', response: { kind: 'speech', text: '好，我看着。', motive: '本分。', basis: [{ kind: 'npcContext', ref: NPC }] }, consequences }, failure: null } }] };
}
function lower(f, domain) {
  const wire = encodeVNextStrictToolBundle(domain);
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wire));
  assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
  return { wire, candidate: parsed, lowered: lowerVNext2ProposalBundle({ ...f, value: parsed.bundle }) };
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
  assert.deepEqual(diagnostic.path, ['proposals', 0, 'branches', 'success', 'consequences', 0, 'terms', 'subjectRefs', 1]);
  assert.deepEqual(diagnostic.actual, { type: 'string', value: PROFILE });
  assert.equal(diagnostic.repair.allowed, true);
  for (const ref of [NPC, `knowledge:${NPC}:${DUTY}`, SCENE, VALVE]) assert.ok(diagnostic.expected.refs.includes(ref), ref);
  assert.ok(!diagnostic.expected.refs.includes(PROFILE));
  // A nested part and a delivery ref are located the same way.
  const nested = lower(f, bundle([promise({ kind: 'result', subjectRefs: [NPC], delivery: { sourceRef: PROFILE, itemRef: null, quantity: 1, destinationKind: 'scene', destinationRef: SCENE },
    parts: [{ partId: 'watch', content: '看住阀门。', kind: 'attempt', subjectRefs: [VALVE, PROFILE], delivery: null }], activation: null })]));
  assert.equal(nested.lowered.kind, 'rejected');
  assert.deepEqual(nested.lowered.diagnostics.map(d => d.path), [
    ['proposals', 0, 'branches', 'success', 'consequences', 0, 'terms', 'parts', 0, 'subjectRefs', 1],
    ['proposals', 0, 'branches', 'success', 'consequences', 0, 'terms', 'delivery', 'sourceRef'],
  ]);
  // The revision ticket maps the slot onto the flat results table the model filled.
  const mapped = vnextProposalModelRepairDiagnostics(rejected.candidate.bundle, rejected.lowered.diagnostics, JSON.stringify(rejected.wire));
  assert.equal(mapped[0].pathBase, 'arguments');
  assert.deepEqual(mapped[0].path, ['results', 0, 'newPromises', 0, 'terms', 'subjectRefs', 1]);
});

test('round99: a kind inside a filled delivery and a bare "none" reference are located below terms on the results table', () => {
  const f = fixture('round99');
  const delivery = { sourceRef: VALVE, itemRef: null, quantity: 1, destinationKind: 'scene', destinationRef: SCENE };
  const domain = bundle([promise({ kind: 'result', subjectRefs: [NPC, VALVE], delivery, parts: [], activation: null })]);
  assert.equal(lower(f, domain).lowered.kind, 'accepted');
  // The model padded the filled delivery with a kind field. The validator now
  // names that field instead of the whole terms object.
  const padded = structuredClone(encodeVNextStrictToolBundle(domain));
  const slot = padded.results[0].newPromises[0].terms.delivery;
  assert.equal(slot.sourceRef, VALVE);
  padded.results[0].newPromises[0].terms.delivery = { kind: 'scene', ...slot };
  const rejected = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(padded));
  assert.equal(rejected.kind, 'locallyRejected', JSON.stringify(rejected).slice(0, 800));
  assert.deepEqual(rejected.diagnostics.map(d => [d.code, d.constraint, d.path]),
    [['VALUE_INVALID', 'social:additional-field', ['results', 0, 'newPromises', 0, 'terms', 'delivery', 'kind']]]);
  assert.deepEqual(rejected.diagnostics[0].expected, { allowedFields: ['sourceRef', 'itemRef', 'quantity', 'destinationKind', 'destinationRef'] });
  // The bare word "none" is read as the {kind:'none'} sentinel by the wire
  // decoder, so the rest of round99's draft lowers once the kind field goes.
  const bare = structuredClone(encodeVNextStrictToolBundle(domain));
  bare.results[0].newPromises[0].terms.delivery.itemRef = 'none';
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(bare));
  assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed).slice(0, 800));
  assert.equal(parsed.bundle.proposals[0].branches.success.consequences[0].terms.delivery.itemRef, null);
  assert.equal(lowerVNext2ProposalBundle({ ...f, value: parsed.bundle }).kind, 'accepted');
});

test('the filling schema offers only admissible promise subjects, in terms, parts and activation alike', () => {
  const f = fixture('schema'), context = f.requiredContext;
  const schema = createVNextProposalBundleSchema(['social'], proposalItemEntryRefs(context), proposalObservationSubjectRefs(context), [],
    proposalNpcSourceChoices(context), requiredContextBasisReferences(context), proposalCreatureTargetRefs(context));
  assert.deepEqual(deepSeekStrictToolSchemaIssues(schema), []);
  const full = expandDeepSeekSchema(schema);
  const social = schemaVariants(full.properties.results.items).find(value => value.properties.kind.enum.includes('social'));
  const terms = social.properties.newPromises.items.properties.terms;
  const subjects = terms.properties.subjectRefs.items.enum;
  for (const ref of [NPC, `knowledge:${NPC}:${DUTY}`, SCENE, VALVE, ACTOR]) assert.ok(subjects.includes(ref), ref);
  assert.ok(!subjects.includes(PROFILE));
  assert.ok(!subjects.some(ref => ref.startsWith('item-definition:')));
  assert.deepEqual(terms.properties.parts.items.properties.subjectRefs.items.enum, subjects);
  const activation = schemaVariants(terms.properties.activation).find(value => value.properties.subjectRefs);
  assert.deepEqual(activation.properties.subjectRefs.items.enum, subjects);
  assert.match(terms.properties.subjectRefs.description, /never an item definition/);
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
  assert.deepEqual(rejected.lowered.diagnostics[0].path, ['proposals', 0, 'branches', 'success', 'consequences', 0, 'basisFactRefs', 1]);
  assert.deepEqual(rejected.lowered.diagnostics[0].expected.refs, ['fact:public-mark']);
  const mapped = vnextProposalModelRepairDiagnostics(rejected.candidate.bundle, rejected.lowered.diagnostics, JSON.stringify(rejected.wire));
  assert.deepEqual(mapped[0].path, ['results', 0, 'relationshipChanges', 0, 'basisFactRefs', 1]);
  // A promise to someone who is not listening, and a promise binding someone else, are located too.
  const stranger = lower(f, bundle([{ ...promise(ongoing([NPC])), promiseeRef: OTHER, authorityRefs: [OTHER] }]));
  assert.equal(stranger.lowered.kind, 'rejected');
  assert.deepEqual(stranger.lowered.diagnostics.map(d => [d.constraint, d.path.slice(-2)]), [
    ['social:promise-recipient-unavailable', ['consequences', 0].concat(['promiseeRef']).slice(-2)],
    ['social:promise-authority-unavailable', ['authorityRefs', 0]],
  ]);
  const schema = createVNextProposalBundleSchema(['social'], proposalItemEntryRefs(f.requiredContext), proposalObservationSubjectRefs(f.requiredContext), [],
    proposalNpcSourceChoices(f.requiredContext), requiredContextBasisReferences(f.requiredContext), proposalCreatureTargetRefs(f.requiredContext));
  const social = schemaVariants(expandDeepSeekSchema(schema).properties.results.items).find(value => value.properties.kind.enum.includes('social'));
  assert.deepEqual(social.properties.relationshipChanges.items.properties.basisFactRefs.items.enum, ['fact:public-mark']);
  assert.deepEqual(social.properties.newDebts.items.properties.basisFactRefs.items.enum, ['fact:public-mark']);
});
