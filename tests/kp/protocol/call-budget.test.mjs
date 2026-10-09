import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createSubmitKpProposalBundleModelInput, createVNextProposalOfferModelInput, encodeVNextStrictToolBundle,
  SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments, assertVNextProposalCandidateCapabilities, vnextProposalRevisionCandidate,
  createRepairTicket, assertRepairTicket, createVNextProposalRevisionModelInput, vnextProposalCorrectionPrompt,
  evaluateVNextProposalRevisionResponse } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { proposalDialectModelInput, proposalWireReferences, bindProposalWire } from '../../../app/_runtime/lib/kp/vnext/proposal-reference-dialect.ts';
import { proposalContextView, proposalModelContext, proposalInventoryEntryRefs, proposalItemEntryRefs, proposalObservationSubjectRefs, proposalNpcSourceChoices, proposalCreatureTargetRefs, proposalItemDefinitionRefs, proposalUnofferedCapabilities, vnextProposalContextBody } from '../../../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { assertDeepSeekStrictToolModelInput } from '../../../app/_runtime/lib/kp/deepseek.ts';
import { canonicalHash } from '../../../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { requiredContextBasisReferences } from '../../../app/_runtime/lib/kp/vnext/required-context-runtime.ts';
import { matchesAuthoredSourceSchema } from '../../../app/_runtime/lib/rules/v2/authored-materialization.ts';
import { ITEM_ENTRY_SCHEMA } from '../../../app/_runtime/lib/rules/v2/items.ts';
import { expandDeepSeekSchema } from '../../support/fixtures/expand-deepseek-schema.mjs';
import { sentContext } from '../../support/fixtures/vnext-request-layout.mjs';

const ACTOR = 'character:call-budget:actor', SCENE = 'scene:call-budget:room';
const BOX = 'item-entry:call-budget:box', ITEM = 'item-entry:call-budget:contents';
const known = (entryRef, value) => ({ kind: 'known', entryRef, value, revisionOrHash: canonicalHash(value) });
const short = ref => `r${createHash('sha256').update(JSON.stringify(ref)).digest('hex').slice(0, 12)}`;
function fixture() {
  return { intent: { actorRef: ACTOR, submissionRef: 'submission:call-budget:1', text: '打开、取出一块、合盖。' },
    binding: { contextHash: 'sha256:call-budget', rootActionId: 'root:call-budget', preparedActionId: 'prepared:call-budget' },
    entries: [known('profile-context:module:budget', { scopeRef: SCENE, coreTruth: '不可删的原有设定。' }),
      known(ACTOR, { entity: { id: ACTOR, kind: 'player', sceneId: SCENE } }),
      known(BOX, { schema: ITEM_ENTRY_SCHEMA, entryId: BOX, disposition: 'held', holderRef: ACTOR,
        stateMachine: { schema: 'zhuwei.lockable-object-state/v1', state: 'closed' },
        containerMemories: [{ entries: [{ entryId: ITEM, quantity: 3, name: '布条' }] }] }),
      known(ITEM, { schema: ITEM_ENTRY_SCHEMA, entryId: ITEM, containerRef: BOX, disposition: 'held', holderRef: ACTOR,
        quantity: 2, condition: 'intact', visibilityPolicyRef: `visibility:character-controller:${ACTOR}` })],
    references: { citations: { viewerEvidenceRefs: [ACTOR, BOX], authorityBasisRefs: [SCENE, ITEM], npcKnowledge: [] } } };
}
function wire(context, operation = {}) {
  const document = encodeVNextStrictToolBundle({ mode: 'adjudication', basisRefs: [BOX], terminal: null,
    adjudication: { kind: 'directSuccess', durationMicros: '300000000', risk: '正常取放。', successOutcome: '取出一块并合盖。' },
    proposals: [{ kind: 'inventoryOperation', basisRefs: [BOX], consumes: [], produces: [], outcomeBinding: 'always',
      operation: { kind: 'acquire', entryRef: ITEM, quantity: 1 }, summary: '取出原布条。' }] });
  document.steps.inventoryOperation[0].operation = { kind: 'containerTransfer', direction: 'takeOut', containerRef: BOX,
    entryRef: ITEM, quantity: 1, access: 'openNormally', after: 'close', ...operation };
  return proposalWireReferences(document, context);
}
const reply = (value, name = SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) => ({ choices: [{ message: { tool_calls: [{ type: 'function',
  function: { name, arguments: typeof value === 'string' ? value : JSON.stringify(value) } }] } }] });
function surface(context, capabilities = ['inventoryOperation'], amendable = false) {
  const view = proposalContextView(context);
  return createSubmitKpProposalBundleModelInput(vnextProposalContextBody(context), capabilities, proposalItemEntryRefs(view), proposalObservationSubjectRefs(view), [], proposalNpcSourceChoices(view), requiredContextBasisReferences(view), proposalCreatureTargetRefs(view), amendable,
    proposalItemDefinitionRefs(view), [], [], undefined, proposalUnofferedCapabilities(context), proposalInventoryEntryRefs(view), view);
}

// SPEC 0001 §16, SPEC 0016 §7.3: the declaration must read the same frozen
// semantic state that Rules uses for a scene container, without inventing a lid.
for (const nested of [false, true]) test(`semantic container ${nested ? 'semantics' : 'content'} open state permits taking from the existing instance`, () => {
  const context = fixture();
  const container = context.entries.find(row => row.entryRef === BOX);
  container.value = { definitionId: BOX, semanticKind: 'sceneFeature', content: { sceneRef: SCENE, label: '敞口木桶',
    ...(nested ? { semantics: { observableState: 'open' } } : { observableState: 'open' }) } };
  const document = wire(context, { access: 'alreadyOpen', after: 'leaveAsIs' });
  const candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(document), context);
  assert.equal(candidate.kind, 'accepted', JSON.stringify(candidate.diagnostics));
  assert.doesNotThrow(() => assertVNextProposalCandidateCapabilities(candidate, ['inventoryOperation'], []));
  assert.deepEqual(candidate.bundle.proposals.map(row => row.kind), ['inventoryOperation']);
  assert.deepEqual(candidate.bundle.proposals[0].operation, { kind: 'acquire', entryRef: ITEM, quantity: 1 });
});

test('semantic container open prose cannot override a locked map state', () => {
  const context = fixture();
  context.entries.find(row => row.entryRef === BOX).value = { feature: { state: 'locked' }, content: { observableState: 'open' } };
  assert.throws(() => parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wire(context, { access: 'alreadyOpen', after: 'leaveAsIs' })), context),
    error => error.diagnostics?.some(row => row.constraint === 'container-transfer:locked-container'));
});

test('no-source inventory requests omit transfer wording and grammar while eligible forms retain the bounded declaration', () => {
  const empty = fixture();
  empty.entries = empty.entries.filter(row => row.entryRef === ACTOR);
  empty.references.citations.viewerEvidenceRefs = [ACTOR];
  empty.references.citations.authorityBasisRefs = [SCENE];
  const absent = surface(empty);
  assert.ok(!JSON.stringify(absent).includes('containerTransfer'));
  const applicable = surface(fixture());
  const operation = expandDeepSeekSchema(applicable.tools[0].function.parameters).properties.steps.properties.inventoryOperation.items.properties.operation;
  const declaration = operation.anyOf.find(row => row.properties.kind.enum.includes('containerTransfer'));
  assert.ok(declaration);
  assert.match(declaration.description, /no implicit unlock/);
  assert.deepEqual(declaration.properties.access.enum, ['alreadyOpen', 'openNormally']);
  assert.deepEqual(declaration.properties.after.enum, ['leaveAsIs', 'close']);
});

// SPEC 0016 §§4.3、7.1: transport handles change no identities or authority.
test('frozen short references are stable across added records; schemas and actual stock agree', () => {
  const context = fixture(), before = structuredClone(context), request = surface(context);
  assertDeepSeekStrictToolModelInput(request);
  const schema = expandDeepSeekSchema(request.tools[0].function.parameters);
  const operations = schema.properties.steps.properties.inventoryOperation.items.properties.operation.anyOf;
  const script = operations.find(row => row.properties.kind.enum.includes('containerTransfer'));
  assert.ok(matchesAuthoredSourceSchema(short(ITEM), script.properties.entryRef));
  assert.ok(!matchesAuthoredSourceSchema(ITEM, script.properties.entryRef));
  const stock = sentContext(request).requiredContext.entries.find(row => row.entryRef === short(ITEM));
  assert.equal(stock.value.quantity, 2);
  const extended = { ...context, entries: [known('fact:call-budget:added', { text: '新读取的记录。' }), ...context.entries] };
  assert.equal(proposalWireReferences({ entryRef: ITEM }, extended).entryRef, short(ITEM));
  assert.equal(proposalWireReferences({ label: ITEM, description: ITEM }, context).label, ITEM, 'prose is not a reference slot');
  assert.deepEqual(bindProposalWire(proposalWireReferences({ entryRef: ITEM }, context), context), { entryRef: ITEM });
  assert.deepEqual(context, before);
});

test('shared schema definitions keep non-reference vocabulary intact', () => {
  const context = fixture();
  const request = proposalDialectModelInput({ messages: [{ role: 'system', content: vnextProposalContextBody(context) }], tools: [{
    type: 'function', function: { name: 'fixture', parameters: { type: 'object', properties: {
      entryRef: { $ref: '#/$def/shared' }, kind: { $ref: '#/$def/shared' } }, $def: { shared: { type: 'string', enum: [ITEM] } } } } }] }, context);
  const schema = expandDeepSeekSchema(request.tools[0].function.parameters);
  assert.deepEqual(schema.properties.entryRef.enum, [short(ITEM)]);
  assert.deepEqual(schema.properties.kind.enum, [ITEM]);
});

test('long dynamic places and spatial end declarations round-trip without rewriting prose', () => {
  const context = fixture(), FEATURE = 'feature:call-budget:ditch';
  context.entries.push(known(FEATURE, { sceneRef: SCENE, feature: { featureId: FEATURE, state: 'present' } }));
  for (const [full, encoded] of [[SCENE, short(SCENE)], [`${SCENE} inside ${FEATURE}`, `${short(SCENE)} inside ${short(FEATURE)}`],
    [`${SCENE} onTop ${FEATURE}`, `${short(SCENE)} onTop ${short(FEATURE)}`]]) {
    const input = { successEndsAt: full, failureEndsAt: full, intent: full };
    const sent = proposalWireReferences(input, context);
    assert.equal(sent.successEndsAt, encoded);
    assert.equal(sent.intent, full);
    assert.deepEqual(bindProposalWire(sent, context), input);
  }
  const input = wire(context); input.decision.successEndsAt = short(SCENE);
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(input), context);
  assert.equal(parsed.kind, 'accepted');
  assert.deepEqual(parsed.bundle.adjudication.successEndsAt, { placeRef: SCENE, footing: 'ground', featureRef: null });
});

// Real failure: after partial withdrawal the old stack is still in the box.
// A put-back names the new loose stack, never the old contained or peer stack.
test('put-in schema and repair bind the loose actor-held instance after a split', () => {
  const context = fixture(), LOOSE = 'item-entry:call-budget:loose', PEER = 'item-entry:call-budget:peer';
  context.entries.push(known(LOOSE, { schema: ITEM_ENTRY_SCHEMA, entryId: LOOSE, disposition: 'held', holderRef: ACTOR, quantity: 1 }),
    known(PEER, { schema: ITEM_ENTRY_SCHEMA, entryId: PEER, disposition: 'held', holderRef: 'character:other', quantity: 1 }));
  context.references.citations.viewerEvidenceRefs.push(LOOSE, PEER);
  const form = expandDeepSeekSchema(surface(context).tools[0].function.parameters);
  const variants = form.properties.steps.properties.inventoryOperation.items.properties.operation.anyOf.filter(row => row.properties.kind.enum.includes('containerTransfer'));
  const put = variants.find(row => row.properties.direction.enum.includes('putIn'));
  assert.ok(put.properties.entryRef.enum.includes(short(LOOSE)));
  assert.ok(!put.properties.entryRef.enum.includes(short(ITEM)));
  assert.ok(!put.properties.entryRef.enum.includes(short(PEER)));
  const candidate = vnextProposalRevisionCandidate(reply(wire(context, { direction: 'putIn' })), ['inventoryOperation'], [], context);
  assert.equal(candidate.kind, 'locallyRejected');
  const ticket = createRepairTicket(candidate, context, ['inventoryOperation'], []);
  assertRepairTicket(ticket, context.binding.contextHash, context);
  const diagnostic = JSON.parse(vnextProposalCorrectionPrompt(ticket, context)).diagnostics.find(row => row.constraint === 'container-transfer:put-in-needs-loose-held-source');
  assert.deepEqual(diagnostic.path, ['steps', 'inventoryOperation', 0, 'operation', 'entryRef']);
  assert.ok(diagnostic.expected.enum.includes(short(LOOSE)));
  assert.ok(!diagnostic.expected.enum.includes(short(ITEM)));
  const fixed = evaluateVNextProposalRevisionResponse(reply(wire(context, { direction: 'putIn', entryRef: LOOSE })), ticket, context);
  assert.equal(fixed.result.kind, 'locallyAccepted');
});

// SPEC 0001 §16, SPEC 0016 §7.3: finite scripts declare, never guess, access.
test('normal transfer expands without world selection; arbitrary world rows cannot claim the exemption', () => {
  const context = fixture(), candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wire(context)), context);
  assert.equal(candidate.kind, 'accepted');
  assert.doesNotThrow(() => assertVNextProposalCandidateCapabilities(candidate, ['inventoryOperation'], []));
  assert.deepEqual(candidate.bundle.proposals.filter(row => row.kind === 'worldInteraction').map(row => row.commonAction.option), ['open', 'close']);
  assert.ok(candidate.bundle.proposals.filter(row => row.kind === 'worldInteraction').every(row => row.sceneRef === SCENE));
  assert.deepEqual(candidate.bundle.proposals.find(row => row.kind === 'inventoryOperation').operation, { kind: 'acquire', entryRef: ITEM, quantity: 1 });
  const manual = encodeVNextStrictToolBundle(candidate.bundle);
  const manualCandidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(proposalWireReferences(manual, context)), context);
  assert.equal(manualCandidate.kind, 'accepted');
  assert.throws(() => assertVNextProposalCandidateCapabilities(manualCandidate, ['inventoryOperation'], []), error => error.diagnostics?.some(row => row.constraint === 'proposal:capability-not-loaded'));
});

test('locked, foreign, unknown and undeclared access fail before effects; multiple identical accesses share one interval', () => {
  for (const [label, adjust, operation] of [
    ['locked', c => c.entries.find(e => e.entryRef === BOX).value.stateMachine.state = 'locked', {}],
    ['foreign', c => c.entries.find(e => e.entryRef === BOX).value.holderRef = 'character:other', {}],
    ['unknown', () => {}, { entryRef: 'r000000000000' }],
    ['undeclared', () => {}, { access: 'alreadyOpen' }],
  ]) {
    const context = fixture(); adjust(context); const before = structuredClone(context);
    const candidate = vnextProposalRevisionCandidate(reply(wire(context, operation)), ['inventoryOperation'], [], context);
    assert.equal(candidate.kind, 'locallyRejected', label);
    assert.ok(candidate.diagnostics.some(row => row.constraint.startsWith('container-transfer:')), label);
    assert.deepEqual(context, before, label);
  }
  const context = fixture(), document = wire(context);
  document.steps.inventoryOperation.push(structuredClone(document.steps.inventoryOperation[0]));
  const candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(document), context);
  assert.equal(candidate.kind, 'accepted');
  assert.equal(candidate.bundle.proposals.filter(row => row.kind === 'worldInteraction').length, 2);
});

test('stable context precedes changing intent without omitting changed current quantities', () => {
  const a = fixture(), b = fixture(); b.intent.text = '换句话再取一次。'; b.intent.submissionRef += ':next'; b.binding.contextHash += ':next';
  const selection = createVNextProposalOfferModelInput(vnextProposalContextBody(a), a), filling = surface(a);
  const next = createVNextProposalOfferModelInput(vnextProposalContextBody(b), b);
  const end = selection.messages[0].content.indexOf(',"intent":');
  assert.ok(end > 200);
  assert.equal(selection.messages[0].content.slice(0, end), next.messages[0].content.slice(0, end));
  assert.equal(sentContext(selection).requiredContext.schema, 'zhuwei.proposal-context/vnext-17');
  assert.deepEqual(sentContext(selection), sentContext(filling), 'selection and filling keep the same frozen reading body');
  b.entries.find(row => row.entryRef === ITEM).value.quantity = 1;
  const stock = proposalModelContext(b).entries.find(row => row.entryRef === ITEM);
  assert.equal(stock.value.quantity, 1, 'caching never replaces current state');
});

test('typed repair retains the filling prefix and raw draft; errors point to the actual short-reference declaration', () => {
  const context = fixture(), original = JSON.stringify(wire(context, { access: 'alreadyOpen' }));
  const candidate = vnextProposalRevisionCandidate(reply(original), ['inventoryOperation'], [], context);
  const ticket = createRepairTicket(candidate, context, ['inventoryOperation'], []);
  assertRepairTicket(ticket, context.binding.contextHash, context);
  assert.equal(ticket.originalArguments, original);
  const filling = surface(context), correction = createVNextProposalRevisionModelInput(ticket, context);
  assert.equal(correction.tools.length, 1);
  assert.deepEqual(correction.tools[0], filling.tools[0]);
  assert.deepEqual(correction.messages.slice(0, 2), filling.messages);
  assert.equal(correction.messages[2].tool_calls[0].function.arguments, original);
  const prompt = JSON.parse(vnextProposalCorrectionPrompt(ticket, context));
  assert.deepEqual(prompt.allowedModes, ['replaceDraft']);
  assert.deepEqual(prompt.diagnostics[0].path, ['steps', 'inventoryOperation', 0, 'operation']);
  assert.equal(prompt.diagnostics[0].actual.value.containerRef, short(BOX));
  const result = evaluateVNextProposalRevisionResponse(reply(wire(context)), ticket, context);
  assert.equal(result.result.kind, 'locallyAccepted');
  const patch = evaluateVNextProposalRevisionResponse(reply({ sourceDraftVersion: ticket.sourceDraftVersion,
    revisionJson: JSON.stringify({ mode: 'patch', operations: [] }) }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME), ticket, context);
  assert.notEqual(patch.result.kind, 'locallyAccepted', 'a reply through a tool absent from this request cannot pass');
});
