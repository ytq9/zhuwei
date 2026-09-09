import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { proposalModelContext, proposalContextView, proposalNpcRecall, proposalNpcSourceChoices, proposalItemEntryRefs,
  proposalObservationSubjectRefs, proposalCreatureTargetRefs, proposalItemDefinitionRefs } from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { requiredContextBasisReferences } from '../app/_runtime/lib/kp/vnext/required-context-runtime.ts';
import { createVNextProposalOfferModelInput, createSubmitKpProposalBundleModelInput, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseVNextProposalOfferResponse, vnextProposalAmendmentRequest, createVNextUnparsedRevisionTicket, assertRepairTicket,
  vnextProposalUnparsedArguments, createVNextProposalRevisionModelInput } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { assertVNextInvocationTransition } from '../app/_runtime/lib/room/vnext-proposal-invocation.ts';
import { npcDecisionEntryRef } from '../app/_runtime/lib/kp/vnext/context/npc-decision.ts';
import { deepSeekStrictToolSchemaIssues } from '../app/_runtime/lib/kp/deepseek-strict-tool.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';

// A sentence that names nobody used to freeze and send every visible NPC's
// decision view and memory (round100's desk sentence reached 53.7k tokens that
// way). The freeze still verifies every visible view, but the model is sent
// only the addressed ones; the rest are roster lines the selection stage can
// ask for by ref, and Room proves every later request over the same choice.
const A = 'npc:recall:archivist', B = 'npc:recall:guard';
const held = (characterId, knowledgeRef, content) => ({ characterId, knowledgeRef, content, kind: 'sourceClaim', layer: 'partial', visibility: 'private', provenanceChain: ['genesis:probe'] });
function fixture(label, focusRefs = []) {
  const f = createAuthoredProbeFixture(`npc-recall:${label}`, { npcCharacters: [{ id: A, name: '档案员' }, { id: B, name: '守卫' }],
    initialKnowledge: [held(A, 'knowledge:ledger', '账本锁在柜里。'), held(A, 'knowledge:tea', '茶叶放在楼上的木盒里。')] });
  const context = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs, intentText: '我环顾四周，看看柜子和账本。' }).context;
  return { ...f, requiredContext: context };
}
const toolCall = (name, args) => ({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
const offer = args => toolCall(OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, args);
const decisionRefs = context => context.entries.map(entry => entry.entryRef).filter(ref => ref.startsWith('npc-decision:'));

test('a sentence naming nobody freezes every visible view but sends none until the selection asks', () => {
  const f = fixture('unaddressed'), context = f.requiredContext;
  assert.deepEqual(decisionRefs(context).sort(), [npcDecisionEntryRef(A), npcDecisionEntryRef(B)]);
  assert.deepEqual(context.references.npcRecall.map(entry => [entry.npcRef, entry.role]), [[A, 'requestable'], [B, 'requestable']]);
  for (const entry of context.references.npcRecall) assert.ok(entry.entryRefs.includes(npcDecisionEntryRef(entry.npcRef)));
  assert.deepEqual(proposalNpcRecall(context), { defaultRefs: [], requestableRefs: [A, B] });
  // The selection view: roster lines only, nothing to cite.
  const selection = proposalModelContext(context);
  assert.deepEqual(decisionRefs(selection), []);
  assert.ok(!JSON.stringify(selection).includes('账本锁在柜里'));
  assert.deepEqual(selection.references.npcRecall, { shown: [], requestable: [A, B] });
  assert.deepEqual(selection.references.npcSourceChoices, []);
  // Presence records stay complete: what can be seen of a bystander is not
  // what the bystander privately knows or intends.
  for (const npc of [A, B]) {
    const presence = selection.entries.find(entry => entry.entryRef === npc).value;
    assert.deepEqual(presence.worldDescription, { entity: { name: npc === A ? '档案员' : '守卫' } });
    assert.equal(presence.adjudication.entity.id, npc);
  }
  // The filling view after the selection named the archivist: her view and
  // memory travel, the guard stays a roster line, and the forms follow.
  const filling = proposalModelContext(context, [A]);
  assert.deepEqual(decisionRefs(filling), [npcDecisionEntryRef(A)]);
  assert.ok(JSON.stringify(filling).includes('账本锁在柜里'));
  assert.deepEqual(filling.references.npcRecall, { shown: [A], requestable: [B] });
  assert.deepEqual(filling.references.npcSourceChoices.map(choice => choice.npcRef), [A]);
  assert.ok(filling.entries.some(entry => entry.entryRef === B), 'the guard stays visible');
  const view = proposalContextView(context, [A]);
  assert.ok(view.entries.every(entry => !entry.entryRef.startsWith(`knowledge:${B}:`) && entry.entryRef !== npcDecisionEntryRef(B)));
  assert.ok(view.references.citations.npcKnowledge.every(entry => entry.npcRef !== B));
  assert.equal(proposalContextView(context, [A, B]).entries.length, context.entries.length);
  // The binding never changes: the same frozen context is sent in slices.
  assert.equal(filling.contextHash, context.binding.contextHash);
});

test('an addressed NPC is shown by default and the selection tool offers only the others', () => {
  const f = fixture('addressed', [A]), context = f.requiredContext;
  assert.deepEqual(proposalNpcRecall(context).defaultRefs, [A]);
  const selection = proposalModelContext(context);
  assert.deepEqual(decisionRefs(selection), [npcDecisionEntryRef(A)]);
  const tool = createVNextProposalOfferModelInput('bound', context).tools[0].function;
  assert.deepEqual(tool.parameters.properties.requestedNpcRefs?.items?.enum, proposalNpcRecall(context).requestableRefs);
  const alone = fixture('alone-addressed', [A, B]).requiredContext;
  assert.deepEqual(proposalNpcRecall(alone).requestableRefs, []);
  assert.equal(createVNextProposalOfferModelInput('bound', alone).tools[0].function.parameters.properties.requestedNpcRefs, undefined);
});

test('the selection tool enumerates the requestable views, and the reply is read strictly', () => {
  const f = fixture('tool'), context = f.requiredContext;
  const input = createVNextProposalOfferModelInput('bound', context);
  const parameters = input.tools[0].function.parameters;
  assert.deepEqual(deepSeekStrictToolSchemaIssues(parameters), []);
  assert.deepEqual(parameters.properties.requestedNpcRefs.items.enum, [A, B]);
  assert.deepEqual(parameters.required.sort(), ['requestedCapabilities', 'requestedNpcRefs']);
  assert.match(input.messages[0].content, /requestedNpcRefs/);
  assert.deepEqual(parseVNextProposalOfferResponse(offer({ requestedCapabilities: ['observe'], requestedNpcRefs: [B] }), context).npcRefs, [B]);
  assert.deepEqual(parseVNextProposalOfferResponse(offer({ requestedCapabilities: ['observe'], requestedNpcRefs: [B, A] }), context).npcRefs, [A, B]);
  assert.deepEqual(parseVNextProposalOfferResponse(offer({ requestedCapabilities: ['observe'] }), context).npcRefs, []);
  assert.throws(() => parseVNextProposalOfferResponse(offer({ requestedCapabilities: ['observe'], requestedNpcRefs: ['npc:recall:nobody'] }), context));
  assert.throws(() => parseVNextProposalOfferResponse(offer({ requestedCapabilities: ['observe'], requestedNpcRefs: [A, A] }), context));
  // Without a requestable view the field is an unknown field.
  const alone = fixture('tool-alone', [A, B]).requiredContext;
  assert.throws(() => parseVNextProposalOfferResponse(offer({ requestedCapabilities: ['observe'], requestedNpcRefs: [] }), alone));
});

test('an amendment adds views by union, tickets carry the loaded views, and Room proves the filling surface over them', () => {
  const f = fixture('room'), context = f.requiredContext;
  const amended = vnextProposalAmendmentRequest(offer({ requestedCapabilities: ['observe'], requestedNpcRefs: [B] }), ['observe'], [], [A], context);
  assert.deepEqual(amended.amendedNpcRefs, [A, B]);
  assert.deepEqual(amended.requestedNpcRefs, [B]);
  assert.equal(vnextProposalAmendmentRequest(offer({ requestedCapabilities: ['observe'], requestedNpcRefs: [A] }), ['observe'], [], [A], context), undefined);
  // A ticket records the views the model was sent; a forged list is refused.
  const broken = toolCall(SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, {});
  broken.choices[0].message.tool_calls[0].function.arguments = '{"decision":';
  const ticket = createVNextUnparsedRevisionTicket(vnextProposalUnparsedArguments(broken), context, ['observe'], [], [A]);
  assert.deepEqual(ticket.npcRefs, [A]);
  assert.doesNotThrow(() => assertRepairTicket(ticket, context.binding.contextHash, context));
  const forged = { ...ticket, npcRefs: [B] }; const { ticketHash: _hash, ...body } = forged; forged.ticketHash = canonicalHash(body);
  assert.throws(() => assertRepairTicket(forged, context.binding.contextHash, context));
  assert.deepEqual(JSON.parse(createVNextProposalRevisionModelInput(ticket, context).messages[1].content).requiredContext, proposalModelContext(context, [A]));
  // Room rebuilds ordinal 2 over the selection's views: the guard's view is
  // absent and still requestable through the amendment tool.
  const view = proposalContextView(context, [A]);
  const surface = (npcRefs, requestable, amendable = true) => createSubmitKpProposalBundleModelInput(
    JSON.stringify({ requiredContext: proposalModelContext(context, npcRefs) }), ['observe'],
    proposalItemEntryRefs(view), proposalObservationSubjectRefs(view), [], proposalNpcSourceChoices(view), requiredContextBasisReferences(view),
    proposalCreatureTargetRefs(view), amendable, proposalItemDefinitionRefs(view), requestable);
  const saved = response => ({ status: 'completed', context_hash: context.binding.contextHash, binding_hash: 'sha256:fixture', response_json: JSON.stringify(response) });
  const prior = ordinal => ordinal === 1 ? saved(offer({ requestedCapabilities: ['observe'], requestedNpcRefs: [A] })) : undefined;
  const request = surface([A], [B]);
  assert.deepEqual(request.tools[1].function.parameters.properties.requestedNpcRefs.items.enum, [B]);
  assert.doesNotThrow(() => assertVNextInvocationTransition({ ordinal: 2, contextHash: context.binding.contextHash, bindingHash: 'sha256:fixture', requestHash: 'sha256:fixture', request }, prior, context));
  for (const wrong of [surface([], [A, B]), surface([A, B], []), surface([A], [])]) {
    assert.throws(() => assertVNextInvocationTransition({ ordinal: 2, contextHash: context.binding.contextHash, bindingHash: 'sha256:fixture', requestHash: 'sha256:fixture', request: wrong }, prior, context), /PROPOSAL_REPAIR_EXHAUSTED/);
  }
});

test('an addressed NPC freezes its whole memory; the topic sends part of it and a handle fetches the rest', () => {
  const f = fixture('handles', [A]), context = f.requiredContext;
  const tea = `knowledge:${A}:knowledge:tea`, ledger = `knowledge:${A}:knowledge:ledger`;
  assert.ok(context.entries.some(entry => entry.entryRef === tea), 'the unread body is frozen with the addressed view');
  const recall = context.references.knowledgeRecall.find(entry => entry.holderRef === A);
  assert.deepEqual(recall.records.map(record => record.entryRef), [tea]);
  const handle = recall.records[0].handle;
  const directory = context.entries.find(entry => entry.entryRef === `knowledge-directory:${A}`).value;
  assert.deepEqual(directory.unloaded.map(record => [record.entryRef, record.handle]), [[tea, handle]]);
  // Sent by topic: the ledger body travels, the tea body waits behind its handle.
  const selection = proposalModelContext(context);
  assert.ok(JSON.stringify(selection).includes('账本锁在柜里'));
  assert.ok(!JSON.stringify(selection).includes('木盒里'));
  assert.deepEqual(selection.references.knowledgeRecall, { shown: [], requestable: [handle] });
  const view = selection.entries.find(entry => entry.entryRef === npcDecisionEntryRef(A)).value;
  assert.deepEqual(view.knowledge.map(record => record.entryRef), [ledger]);
  assert.equal(view.unloadedKnowledgeCount, 1);
  assert.ok(!proposalNpcSourceChoices(proposalContextView(context)).find(choice => choice.npcRef === A).refs.includes(tea));
  // The selection tool offers the handle; the reply names it; the filling view then carries the body and its citation.
  const tool = createVNextProposalOfferModelInput('bound', context).tools[0].function.parameters;
  assert.deepEqual(deepSeekStrictToolSchemaIssues(tool), []);
  assert.deepEqual(tool.properties.requestedKnowledgeRefs.items.enum, [handle]);
  const parsed = parseVNextProposalOfferResponse(offer({ requestedCapabilities: ['social'], requestedNpcRefs: [], requestedKnowledgeRefs: [handle] }), context);
  assert.deepEqual(parsed.knowledgeRefs, [tea]);
  assert.throws(() => parseVNextProposalOfferResponse(offer({ requestedCapabilities: ['social'], requestedNpcRefs: [], requestedKnowledgeRefs: ['m99'] }), context));
  const filling = proposalModelContext(context, [], [tea]);
  assert.ok(JSON.stringify(filling).includes('木盒里'));
  assert.deepEqual(filling.references.knowledgeRecall, { shown: [tea], requestable: [] });
  assert.ok(proposalNpcSourceChoices(proposalContextView(context, [], [tea])).find(choice => choice.npcRef === A).refs.includes(tea));
  // The amendment adds bodies by union; a ticket records what was read; Room proves the surface over it.
  const amended = vnextProposalAmendmentRequest(offer({ requestedCapabilities: ['social'], requestedNpcRefs: [], requestedKnowledgeRefs: [handle] }), ['social'], [], [], context, []);
  assert.deepEqual(amended.amendedKnowledgeRefs, [tea]);
  assert.equal(vnextProposalAmendmentRequest(offer({ requestedCapabilities: ['social'], requestedNpcRefs: [], requestedKnowledgeRefs: [handle] }), ['social'], [], [], context, [tea]), undefined);
  const broken = toolCall(SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, {});
  broken.choices[0].message.tool_calls[0].function.arguments = '{"decision":';
  const ticket = createVNextUnparsedRevisionTicket(vnextProposalUnparsedArguments(broken), context, ['social'], [], [], [tea]);
  assert.deepEqual(ticket.knowledgeRefs, [tea]);
  assert.doesNotThrow(() => assertRepairTicket(ticket, context.binding.contextHash, context));
  assert.deepEqual(JSON.parse(createVNextProposalRevisionModelInput(ticket, context).messages[1].content).requiredContext, filling);
  const view2 = proposalContextView(context, [], [tea]);
  const surface = (knowledgeRefs, handles) => createSubmitKpProposalBundleModelInput(
    JSON.stringify({ requiredContext: proposalModelContext(context, [], knowledgeRefs) }), ['social'],
    proposalItemEntryRefs(view2), proposalObservationSubjectRefs(view2), [], proposalNpcSourceChoices(view2), requiredContextBasisReferences(view2),
    proposalCreatureTargetRefs(view2), true, proposalItemDefinitionRefs(view2), [B], handles);
  const saved = response => ({ status: 'completed', context_hash: context.binding.contextHash, binding_hash: 'sha256:fixture', response_json: JSON.stringify(response) });
  const prior = ordinal => ordinal === 1 ? saved(offer({ requestedCapabilities: ['social'], requestedNpcRefs: [], requestedKnowledgeRefs: [handle] })) : undefined;
  const input = request => ({ ordinal: 2, contextHash: context.binding.contextHash, bindingHash: 'sha256:fixture', requestHash: 'sha256:fixture', request });
  assert.doesNotThrow(() => assertVNextInvocationTransition(input(surface([tea], [])), prior, context));
  assert.throws(() => assertVNextInvocationTransition(input(surface([], [handle])), prior, context), /PROPOSAL_REPAIR_EXHAUSTED/);
});
