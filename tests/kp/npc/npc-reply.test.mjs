import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE, PROBE_SOURCE as VALVE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { encodeVNextStrictToolBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { lowerVNext2ProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { npcOwnModelView } from '../../../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { isNpcReplyTicket, mergeNpcReplies, npcRepliesAreSaved, npcReplyModelInput, npcReplyRequestBody, npcReplySteps, npcReplyTicket, readNpcReply,
  settleNpcReplies, withoutNpcReplies, NPC_REPLY_BINDING_HASH, NPC_REPLY_FIRST_ORDINAL, NPC_REPLY_POLICY, NPC_REPLY_TOOL_NAME } from '../../../app/_runtime/lib/kp/vnext/npc-reply.ts';
import { assertVNextNpcReplyTransition } from '../../../app/_runtime/lib/room/vnext-proposal-invocation.ts';
import { VNEXT_KP_WORKFLOW } from '../../../app/_runtime/lib/kp/vnext/runtime-policy.ts';
import { kpRequestBody } from '../../../app/_runtime/lib/kp/model-request.ts';
import { assertDeepSeekStrictToolModelInput } from '../../../app/_runtime/lib/kp/deepseek.ts';
import { assertOpenAIStrictToolModelInput } from '../../../app/_runtime/lib/kp/openai.ts';
import { DEFAULT_KP_MODEL, GPT_6_LUNA_MODEL } from '../../../app/_runtime/lib/kp/models.ts';
import { canonicalHash } from '../../../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { npcReplyArguments, settleWithDomainReplies, toolCallResponse } from '../../support/fixtures/vnext-npc-replies.mjs';
import { stepActionToDecision } from '../../support/fixtures/vnext-action-lifecycle.mjs';

// SPEC 0001 §14, SPEC 0006 §7, SPEC 0016 §§7.2, 7.3 (ADR 0073): what an NPC
// says in a conversation is written by a call that reads only that NPC's own
// view. Round 152 had Lian point to a shrine that only the host's material
// knew, because the ruling, which reads that material, also wrote her line.
const LIAN = 'npc:reply:lian', VARO = 'npc:reply:varo';
const OWN = 'LIAN_OWN_MEMORY_父亲说过遗嘱的事只告诉我一个人', OTHER = 'VARO_PRIVATE_MEMORY_遗嘱的副本在镇公所', PLAYER = 'PLAYER_PRIVATE_MEMORY_我其实是来讨债的';
const HOST = 'HOST_ONLY_TRUTH_第三份遗嘱藏在神龛里';
const GOAL = 'RULING_GOAL_套出第三份遗嘱的下落', METHOD = 'RULING_METHOD_装作只是闲聊', SUMMARY = 'RULING_SUMMARY_莉安松了口', RISK = 'RULING_RISK_她可能起疑';
const INTENT = 'PLAYER_THOUGHT_我想骗她说出来：“第三份遗嘱在哪里？”', SPEECH = '第三份遗嘱在哪里？';
const held = (characterId, knowledgeRef, content) => ({ characterId, knowledgeRef, content, kind: 'sourceClaim', layer: 'full', visibility: 'private', provenanceChain: ['genesis:reply'] });
function fixture(label) {
  const f = createAuthoredProbeFixture(`npc-reply:${label}`, { npcCharacters: [{ id: LIAN, name: '莉安' }, { id: VARO, name: '瓦罗' }],
    canonicalFacts: [{ id: 'fact:third-will', kind: 'worldFact', source: 'moduleAnchor', subjectRefs: [SCENE], value: HOST, visibilityPolicyId: 'visibility:room-authority-only' }],
    initialKnowledge: [held(LIAN, 'knowledge:key', OWN), held(VARO, 'knowledge:copy', OTHER), held(ACTOR, 'knowledge:debt', PLAYER)] });
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [LIAN, VARO, VALVE], intentText: INTENT }).context;
  return f;
}
const reply = (text, extra = {}) => ({ kind: 'speech', text, motive: '按自己知道的回答。', basis: [{ kind: 'npcContext', ref: LIAN }], ...extra });
function plan({ check = false, npcRef = LIAN, perceives = null, failurePerceives = null, consequences = [], speech = SPEECH } = {}) {
  const branch = (failure) => ({ outcomeCode: failure ? 'outcome:unmoved' : 'outcome:answered', summary: SUMMARY,
    npcPerceives: failure ? failurePerceives : perceives,
    response: { ...reply(failure ? '这事我不想谈。' : '我不知道还有第三份遗嘱。'), basis: [{ kind: 'npcContext', ref: npcRef }] }, consequences: failure ? [] : consequences });
  return { mode: 'adjudication', basisRefs: [npcRef], terminal: null,
    adjudication: check ? { kind: 'check', durationMicros: '300000000', checkKind: 'abilityCheck', ability: 'cha', skill: 'intimidation', dc: 13, mode: 'normal',
      risk: RISK, successOutcome: '这番话起了作用。', failureOutcome: '这番话没有起作用。' }
      : { kind: 'directSuccess', durationMicros: '300000000', risk: RISK, successOutcome: '交谈进行。' },
    proposals: [{ kind: 'social', basisRefs: [npcRef], consumes: [], produces: [], outcomeBinding: 'always', sceneRef: SCENE, npcRef,
      addressedThreadRef: null, actorSpeech: speech, goal: GOAL, method: METHOD, communication: 'spokenConversation', audience: 'participants', retryChange: null,
      branches: { success: branch(false), failure: check ? branch(true) : null } }] };
}
function ruling(domain) {
  const candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(domain)));
  assert.equal(candidate.kind, 'accepted', JSON.stringify(candidate));
  return candidate.bundle;
}

test('the NPC\'s own call reads its own view and what it heard, and nothing of the host, the ruling, the actor or another holder', () => {
  const f = fixture('view'), bundle = ruling(plan({ check: true, failurePerceives: '看见对方一直盯着账台。' }));
  // The host's own context does hold what the NPC's must not.
  const whole = JSON.stringify(f.requiredContext);
  for (const present of [HOST, OTHER, PLAYER, OWN, 'PLAYER_THOUGHT']) assert.ok(whole.includes(present), present);
  const [step] = npcReplySteps(bundle, f.requiredContext);
  assert.deepEqual(step.hearing, { schema: 'zhuwei.npc-reply-hearing/vnext-1', contextHash: f.requiredContext.binding.contextHash, npcRef: LIAN,
    speakerRef: ACTOR, speech: SPEECH, audience: 'participants', newKnowledge: [],
    outcomes: { success: { swayed: 'yes', perceived: [] }, failure: { swayed: 'no', perceived: ['看见对方一直盯着账台。'] } } });
  assert.equal(step.hearingHash, canonicalHash(step.hearing));
  const input = npcReplyModelInput(f.requiredContext, step.hearing), sent = JSON.stringify(input);
  assert.ok(sent.includes(OWN), 'her own memory is hers to read');
  for (const hidden of [HOST, OTHER, PLAYER, 'PLAYER_THOUGHT', GOAL, METHOD, SUMMARY, RISK, 'intimidation', '"dc"', 'outcome:answered', 'fact:third-will'])
    assert.ok(!sent.includes(hidden), `the NPC's own call must not carry ${hidden}`);
  const body = npcReplyRequestBody(input);
  assert.equal(body.npcRef, LIAN);
  assert.deepEqual(Object.keys(body.view), ['entries', 'present']);
  assert.deepEqual(body.hearing.speaker, { ref: ACTOR, name: body.view.present.find(subject => subject.ref === ACTOR).name });
  assert.deepEqual(Object.keys(body.hearing.outcomes), ['success', 'failure']);
  // Every entry of the view is this holder's own.
  const view = npcOwnModelView(f.requiredContext, LIAN);
  for (const entry of view.entries) assert.ok([`npc-decision:${LIAN}`, `knowledge-directory:${LIAN}`].includes(entry.entryRef)
    || entry.entryRef.startsWith(`knowledge:${LIAN}:`), entry.entryRef);
  assert.ok(view.sources.refs.includes(`knowledge:${LIAN}:knowledge:key`));
  assert.ok(!view.sources.refs.some(ref => ref.includes(VARO) || ref.includes(ACTOR)));
  assert.equal(npcOwnModelView(f.requiredContext, 'npc:reply:nobody'), undefined);
  // The request is one both providers accept, with the form derived from the domain's own.
  assertDeepSeekStrictToolModelInput(input);
  assert.doesNotThrow(() => assertOpenAIStrictToolModelInput(kpRequestBody(GPT_6_LUNA_MODEL, input)));
  assert.deepEqual(kpRequestBody(DEFAULT_KP_MODEL, input).tools, input.tools);
  assert.equal(input.tools[0].function.name, NPC_REPLY_TOOL_NAME);
  assert.deepEqual(Object.keys(input.tools[0].function.parameters.properties), ['success', 'failure']);
  assert.equal(input.messages[0].content.startsWith(NPC_REPLY_POLICY.instruction), true);
});

test('a hearing tells the primary observer of a failed hidden act what it noticed, and a bystander nothing of it', () => {
  const f = fixture('hidden');
  const act = (primary) => ({ mode: 'adjudication', basisRefs: [VALVE, LIAN], terminal: null,
    adjudication: { kind: 'check', durationMicros: '300000000', checkKind: 'abilityCheck', dc: null, ability: 'dex', skill: 'sleightOfHand', mode: 'normal',
      risk: RISK, successOutcome: '阀门被悄悄拧松。', failureOutcome: '有人看见了你的手。',
      concealment: { primaryObserverRef: primary, sense: 'sight', evidence: '看见有人在阀门旁偷偷动手。', observers: [] } },
    proposals: [{ kind: 'worldInteraction', basisRefs: [VALVE], consumes: [], produces: [], sceneRef: SCENE, outcomeBinding: 'always',
      intent: '趁人不注意拧松阀门。', method: '借身体挡住。', targetRefs: [VALVE], directTargetRefs: [VALVE], instrumentRefs: [], abilityRef: null,
      branches: Object.fromEntries(['success', 'failure'].map(name => [name, { outcomeCode: name, summary: '阀门松开了。', effects: [], sensoryEvidence: [], pressures: [], opportunities: [] }])) },
    { ...plan().proposals[0], outcomeBinding: 'onFailure' }] });
  const noticed = npcReplySteps(ruling(act(LIAN)), f.requiredContext);
  assert.deepEqual(noticed.map(step => [step.proposal, step.hearing.outcomes]), [[1, { result: { swayed: 'notAsked', perceived: ['看见有人在阀门旁偷偷动手。'] } }]]);
  // Hidden from Varo, not from her: what she is told is only what she herself perceives.
  assert.deepEqual(npcReplySteps(ruling(act(VARO)), f.requiredContext)[0].hearing.outcomes, { result: { swayed: 'notAsked', perceived: [] } });
  assert.notEqual(noticed[0].hearingHash, npcReplySteps(ruling(act(VARO)), f.requiredContext)[0].hearingHash);
});

test('settlement asks each NPC once, merges what it answered, and lowers and commits the merged plan', () => {
  const f = fixture('settle'), domain = plan(), bundle = ruling(domain);
  // A ruling alone never commits a conversation.
  assert.deepEqual(lowerVNext2ProposalBundle({ ...f, value: bundle }).issues, ['social:npc-reply-missing']);
  const first = settleNpcReplies({ bundle, context: f.requiredContext, saved: [], rejected: () => [] });
  assert.equal(first.kind, 'ask'); assert.deepEqual(first.ticket, npcReplyTicket(npcReplySteps(bundle, f.requiredContext)[0].hearing));
  assert.equal(first.ticket.attempt, 1); assert.equal(first.ticket.retry, null); assert.ok(isNpcReplyTicket(first.ticket));
  const [answer] = npcReplyArguments(domain, f.requiredContext);
  const saved = [{ ticket: first.ticket, response: toolCallResponse(NPC_REPLY_TOOL_NAME, answer.arguments) }];
  const merged = settleNpcReplies({ bundle, context: f.requiredContext, saved, rejected: () => [] });
  assert.equal(merged.kind, 'merged'); assert.deepEqual(merged.ruling, []);
  assert.equal(merged.bundleHash, canonicalHash(merged.bundle));
  assert.deepEqual(merged.bundle.proposals[0].branches.success.response, domain.proposals[0].branches.success.response);
  assert.deepEqual(withoutNpcReplies(merged.bundle), bundle);
  assert.deepEqual(npcReplySteps(merged.bundle, f.requiredContext), npcReplySteps(bundle, f.requiredContext), 'what was heard does not change with the reply');
  const lowered = lowerVNext2ProposalBundle({ ...f, value: merged.bundle });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  assert.equal(stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput).kind, 'committed');
  // Room commits a conversation only with the reply it saved for what that plan lets the NPC hear.
  assert.equal(npcRepliesAreSaved(merged.bundle, f.requiredContext, saved), true);
  assert.equal(npcRepliesAreSaved(bundle, f.requiredContext, saved), false, 'a reply still awaited');
  assert.equal(npcRepliesAreSaved(merged.bundle, f.requiredContext, []), false, 'no saved reply');
  const forged = structuredClone(merged.bundle); forged.proposals[0].branches.success.response.text = `${HOST}`;
  assert.equal(npcRepliesAreSaved(forged, f.requiredContext, saved), false, 'words the NPC did not say');
  const added = structuredClone(merged.bundle); added.proposals[0].branches.success.consequences.push({ kind: 'debt', obligation: '欠一顿酒。', condition: '无。', basisFactRefs: [] });
  assert.equal(npcRepliesAreSaved(added, f.requiredContext, saved), false, 'an undertaking the NPC did not make');
  const reworded = structuredClone(merged.bundle); reworded.proposals[0].actorSpeech = '你父亲把遗嘱藏哪了？';
  assert.equal(npcRepliesAreSaved(reworded, f.requiredContext, saved), false, 'a reply to something else that was said');
  assert.equal(npcRepliesAreSaved({ mode: 'terminal', terminal: { kind: 'passTime' }, adjudication: null, proposals: [] }, f.requiredContext, []), true, 'a plan without a conversation');
});

test('an unreadable reply is asked once more with the reply as saved, and a second one ends the action', () => {
  const f = fixture('unreadable'), domain = plan({ check: true }), bundle = ruling(domain);
  const broken = settleWithDomainReplies(bundle, domain, f.requiredContext, { change: args => { delete args.failure; args.success.text = 7; return args; } });
  assert.equal(broken.kind, 'ask'); assert.equal(broken.ticket.attempt, 2); assert.ok(isNpcReplyTicket(broken.ticket));
  assert.equal(broken.ticket.hearingHash, broken.saved[0].ticket.hearingHash);
  assert.equal(broken.ticket.retry.reply, broken.saved[0].response.choices[0].message.tool_calls[0].function.arguments);
  assert.deepEqual(broken.ticket.retry.diagnostics.map(detail => [detail.code, detail.path, detail.pathBase, detail.repair.allowed]),
    [['FIELD_MISSING', ['failure'], 'arguments', true]]);
  // The second request repeats the first byte for byte and adds its turn.
  const first = npcReplyModelInput(f.requiredContext, broken.ticket.hearing), second = npcReplyModelInput(f.requiredContext, broken.ticket.hearing, broken.ticket.retry);
  assert.deepEqual(second.messages.slice(0, 2), first.messages); assert.deepEqual(second.tools, first.tools);
  assert.deepEqual(second.messages[2], { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function',
    function: { name: NPC_REPLY_TOOL_NAME, arguments: broken.ticket.retry.reply } }] });
  assert.equal(second.messages[3].role, 'tool'); assert.ok(second.messages[3].content.startsWith(NPC_REPLY_POLICY.reask));
  assert.ok(!second.messages[3].content.includes('"repair"'), 'the server\'s own bookkeeping is not the NPC\'s to read');
  assertDeepSeekStrictToolModelInput(second);
  const [answer] = npcReplyArguments(domain, f.requiredContext);
  const good = [...broken.saved, { ticket: broken.ticket, response: toolCallResponse(NPC_REPLY_TOOL_NAME, answer.arguments) }];
  assert.equal(settleNpcReplies({ bundle, context: f.requiredContext, saved: good, rejected: () => [] }).kind, 'merged');
  const again = [...broken.saved, { ticket: broken.ticket, response: toolCallResponse(NPC_REPLY_TOOL_NAME, '{"success":') }];
  const ended = settleNpcReplies({ bundle, context: f.requiredContext, saved: again, rejected: () => [] });
  assert.equal(ended.kind, 'failed'); assert.equal(ended.code, 'NPC_REPLY_INVALID');
  assert.deepEqual(ended.diagnostics.map(detail => detail.constraint), ['npc-reply:arguments-unreadable']);
  // Another tool, several calls or plain text are no reply either.
  for (const response of [toolCallResponse('submit_kp_proposal_bundle', answer.arguments), { choices: [{ message: { content: '我不知道。' } }] }])
    assert.equal(readNpcReply(response, broken.ticket.hearing).kind, 'unreadable');
  // An NPC whose view the context did not freeze cannot be asked at all.
  const stranger = settleNpcReplies({ bundle: ruling(plan({ npcRef: 'npc:reply:stranger' })), context: f.requiredContext, saved: [], rejected: () => [] });
  assert.equal(stranger.kind, 'failed'); assert.equal(stranger.code, 'CONTEXT_INSUFFICIENT');
});

test('a rejection of the merged plan goes to the NPC whose reply it faults, or else to the ruling at the ruling\'s own draft', () => {
  const f = fixture('rejection');
  const terms = { kind: 'ongoing', subjectRefs: [ACTOR, LIAN], delivery: null, parts: [], activation: null };
  const actorPromise = { kind: 'promise', content: SPEECH, condition: '立即生效。', promisor: 'actor', promiseeRef: LIAN, authorityRefs: [ACTOR], due: 'none', terms, nextStep: null };
  const npcPromise = { kind: 'promise', content: '我替你留意。', condition: '立即生效。', promisor: 'npc', promiseeRef: ACTOR, authorityRefs: [LIAN], due: 'none',
    terms: { ...terms, subjectRefs: [LIAN] }, nextStep: null };
  const relationship = { kind: 'relationship', relationshipRef: null, change: '多了几分信任。', basisFactRefs: [] };
  const domain = plan({ consequences: [npcPromise, relationship, actorPromise] }), bundle = ruling(domain);
  assert.deepEqual(bundle.proposals[0].branches.success.consequences.map(row => [row.kind, row.promisor]), [['promise', 'actor']]);
  const settled = settleWithDomainReplies(bundle, domain, f.requiredContext);
  assert.equal(settled.kind, 'merged', JSON.stringify(settled));
  // Table order, and within a table the actor's rows before the NPC's.
  assert.deepEqual(settled.bundle.proposals[0].branches.success.consequences.map(row => [row.kind, row.promisor]),
    [['relationship', undefined], ['promise', 'actor'], ['promise', 'npc']]);
  const at = (...path) => ({ code: 'REFERENCE_UNAVAILABLE', constraint: 'test:refused', path: ['proposals', 0, ...path], repair: { allowed: false, reason: 'revision-requires-room-admission' } });
  const route = diagnostics => settleWithDomainReplies(bundle, domain, f.requiredContext, { rejected: () => diagnostics });
  // The NPC's own promise, its relationship and its words: asked once more, at the reply's own path.
  const own = route([at('branches', 'success', 'consequences', 2, 'terms', 'subjectRefs', 0), at('branches', 'success', 'consequences', 0, 'change'),
    at('branches', 'success', 'response', 'text')]);
  assert.equal(own.kind, 'ask'); assert.equal(own.ticket.attempt, 2);
  assert.deepEqual(own.ticket.retry.diagnostics.map(detail => [detail.pathBase, detail.path]), [
    ['arguments', ['result', 'newPromises', 0, 'terms', 'subjectRefs', 0]], ['arguments', ['result', 'relationshipChanges', 0, 'change']],
    ['arguments', ['result', 'text']]]);
  // The actor's promise, the speech and the ruling itself: the ruling's, with the actor's row counted among the actor's.
  const theirs = route([at('branches', 'success', 'consequences', 1, 'content'), at('actorSpeech'), { ...at(), path: ['adjudication', 'dc'] }]);
  assert.equal(theirs.kind, 'merged');
  assert.deepEqual(theirs.ruling.map(detail => detail.path), [['proposals', 0, 'branches', 'success', 'consequences', 0, 'content'], ['proposals', 0, 'actorSpeech'], ['adjudication', 'dc']]);
  // Both at once: the ruling is corrected first, because its correction may change what the NPC hears.
  const both = route([at('branches', 'success', 'response', 'text'), at('goal')]);
  assert.equal(both.kind, 'merged'); assert.deepEqual(both.ruling.map(detail => detail.path), [['proposals', 0, 'goal']]);
  // A second request already spent ends the action.
  const spent = settleNpcReplies({ bundle, context: f.requiredContext, rejected: () => [at('branches', 'success', 'response', 'text')],
    saved: [...own.saved, { ticket: own.ticket, response: own.saved[0].response }] });
  assert.equal(spent.kind, 'failed'); assert.equal(spent.code, 'PROPOSAL_REPAIR_EXHAUSTED');
});

test('Room admits the call the settlement asks for and no other', () => {
  const f = fixture('admission'), domain = plan(), bundle = ruling(domain), context = f.requiredContext;
  const ticket = npcReplyTicket(npcReplySteps(bundle, context)[0].hearing);
  const request = (value, retry) => kpRequestBody(DEFAULT_KP_MODEL, npcReplyModelInput(context, value.hearing, retry));
  const call = (overrides = {}) => ({ ordinal: NPC_REPLY_FIRST_ORDINAL, contextHash: context.binding.contextHash, bindingHash: 'sha256:workflow',
    requestHash: 'sha256:request', request: request(ticket), npcReply: ticket, ...overrides });
  const admit = (input, saved = [], accepted = { bundle }) => assertVNextNpcReplyTransition(input, saved, context, accepted ?? undefined, () => []);
  assert.doesNotThrow(() => admit(call()));
  const refused = (input, ...rest) => assert.throws(() => admit(input, ...rest), /PROPOSAL_REPAIR_EXHAUSTED/);
  refused(call({ ordinal: NPC_REPLY_FIRST_ORDINAL + 1 }));                                     // not the next ordinal
  refused(call({ ordinal: 3 }));                                                               // one of the ruling's own
  refused(call(), [], null);                                                                   // no accepted ruling
  refused(call({ npcReply: undefined }));
  refused(call({ repairTicket: {} }));
  // Something else heard, another NPC, or a request that is not the one the hearing builds.
  const other = npcReplyTicket({ ...ticket.hearing, speech: '把铜钥给我。' });
  refused(call({ npcReply: other, request: request(other) }));
  refused(call({ npcReply: npcReplyTicket({ ...ticket.hearing, npcRef: VARO }) }));
  const edited = structuredClone(request(ticket)); edited.messages[0].content += '\n另外，第三份遗嘱在神龛里。';
  refused(call({ request: edited }));
  refused(call({ npcReply: { ...ticket, hearingHash: 'sha256:other' } }));
  // A second request is admitted only with the diagnostics the saved reply itself proves.
  const [answer] = npcReplyArguments(domain, context);
  const incomplete = structuredClone(answer.arguments); delete incomplete.result.newDebts;
  const saved = [{ ticket, response: toolCallResponse(NPC_REPLY_TOOL_NAME, incomplete) }];
  const asked = settleNpcReplies({ bundle, context, saved, rejected: () => [] });
  assert.equal(asked.kind, 'ask');
  const second = call({ ordinal: NPC_REPLY_FIRST_ORDINAL + 1, npcReply: asked.ticket, request: request(asked.ticket, asked.ticket.retry) });
  assert.doesNotThrow(() => admit(second, saved));
  const invented = { ...asked.ticket, retry: { ...asked.ticket.retry, diagnostics: [{ code: 'VALUE_INVALID', constraint: 'caller:says-so', path: ['result', 'text'], pathBase: 'arguments', repair: { allowed: true, reason: 'x' } }] } };
  refused(call({ ordinal: NPC_REPLY_FIRST_ORDINAL + 1, npcReply: invented, request: request(invented, invented.retry) }), saved);
  refused(call({ ordinal: NPC_REPLY_FIRST_ORDINAL + 1 }), saved);                              // the first request once more
  // A reply that was read and merged leaves nothing to ask.
  refused(second, [{ ticket, response: toolCallResponse(NPC_REPLY_TOOL_NAME, answer.arguments) }]);
});

test('the reply\'s policy is part of the workflow, so a change of it asks unfinished proposals again', () => {
  assert.deepEqual(VNEXT_KP_WORKFLOW.npcReply, { bindingHash: NPC_REPLY_BINDING_HASH, replies: 1, secondRequests: 1 });
  assert.equal(NPC_REPLY_BINDING_HASH, canonicalHash(NPC_REPLY_POLICY));
  for (const ticket of [null, {}, { schema: 'zhuwei.npc-reply-ticket/vnext-1' }]) assert.equal(isNpcReplyTicket(ticket), false);
  const f = fixture('ticket'), ticket = npcReplyTicket(npcReplySteps(ruling(plan()), f.requiredContext)[0].hearing);
  for (const changed of [{ ...ticket, attempt: 2 }, { ...ticket, attempt: 3 }, { ...ticket, retry: { reply: '{}', diagnostics: [] } }, { ...ticket, extra: 1 },
    { ...ticket, attempt: 2, retry: { reply: '{}', diagnostics: [] } }]) assert.equal(isNpcReplyTicket(changed), false, JSON.stringify(changed).slice(0, 120));
  assert.ok(isNpcReplyTicket(JSON.parse(JSON.stringify(ticket))), 'a ticket read back from the store');
  assert.deepEqual(mergeNpcReplies(ruling(plan()), []), ruling(plan()));
});
