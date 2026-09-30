// SPEC 0016 §7.3, SPEC 0006 §7 (ADR 0073): a conversation is written by two
// calls. The ruling's form holds no reply; each addressed NPC answers in its
// own call. These helpers give a test the replies a complete domain plan
// already states, in the form the NPC's own call returns them.
import { mergeNpcReplies, npcReplyOutcomeNames, npcReplyRequestBody, npcReplySteps, readNpcReply, settleNpcReplies, NPC_REPLY_TOOL_NAME } from '../../../app/_runtime/lib/kp/vnext/npc-reply.ts';
import { validateVNextProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-validator.ts';
import { canonicalHash } from '../../../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { encodeNpcReplyResult } from '../../../app/_runtime/lib/kp/vnext/proposal-filling-interface.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { decodeVNextStrictToolBundle, encodeVNextStrictToolBundle, VNEXT2_PROPOSAL_BUNDLE_SCHEMA } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';

/** A provider response that calls one tool. */
export function toolCallResponse(name, args) {
  return { choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [{ type: 'function',
    function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }] } }] };
}

/** What each NPC of a complete domain plan answers: one entry per
 * conversation step, in plan order, keyed by what that NPC hears. */
export function npcReplyArguments(domain, context) {
  return npcReplySteps(domain, context).map(step => {
    const owner = step.frame.reduce((value, key) => value[key], domain), entry = owner.proposals[step.proposal];
    return { step, arguments: Object.fromEntries(npcReplyOutcomeNames(step.hearing).map(name =>
      [name, encodeNpcReplyResult(entry.branches[name === 'result' ? 'success' : name], entry.npcRef)])) };
  });
}

/** Answers every first request with what `domain` says and returns where the
 * settlement stops: the merged plan, a failure, or a second request. `change`
 * may rewrite the arguments of one reply before it is saved. */
export function settleWithDomainReplies(ruling, domain, context, { rejected = () => [], change = args => args } = {}) {
  const answers = npcReplyArguments(domain, context), saved = [];
  for (;;) {
    const settled = settleNpcReplies({ bundle: ruling, context, saved, rejected });
    if (settled.kind !== 'ask' || settled.ticket.attempt !== 1) return { ...settled, saved };
    const answer = answers.find(entry => entry.step.hearingHash === settled.ticket.hearingHash);
    if (answer === undefined) throw new TypeError(`no reply in the domain plan for ${settled.ticket.hearing.npcRef}`);
    saved.push({ ticket: settled.ticket, response: toolCallResponse(NPC_REPLY_TOOL_NAME, change(structuredClone(answer.arguments), answer.step)) });
  }
}

/** What is heard does not depend on which context froze it, except for the
 * binding a call is saved under. A test that only needs the complete plan
 * merges the replies under this placeholder binding and makes no call. */
export const UNBOUND = Object.freeze({ binding: Object.freeze({ contextHash: 'sha256:unbound-test-context' }), intent: Object.freeze({ actorRef: 'actor:unbound-test' }) });

/** The candidate of a ruling's wire with each NPC's reply merged in: what
 * lowering and Rules receive. A ruling that is not accepted is returned as
 * it was read. With a frozen `context` the replies go through the same
 * settlement the adapter and Room use; without one they are only merged. */
export function parseWithNpcReplies(wire, domain, context, options) {
  const candidate = parseSubmitKpProposalBundleCandidateArguments(typeof wire === 'string' ? wire : JSON.stringify(wire));
  if (candidate.kind !== 'accepted') return candidate;
  if (context !== undefined) {
    const settled = settleWithDomainReplies(candidate.bundle, domain, context, options);
    return settled.kind === 'merged' ? { kind: 'accepted', bundle: settled.bundle, bundleHash: settled.bundleHash, ruling: candidate.bundle } : settled;
  }
  // The form groups steps by type, so a step is found by what its NPC hears,
  // not by its position in the domain bundle.
  const answers = npcReplyArguments(domain, UNBOUND);
  const replies = npcReplySteps(candidate.bundle, UNBOUND).map(step => {
    const answer = answers.find(entry => entry.step.hearingHash === step.hearingHash);
    if (answer === undefined) throw new TypeError(`no reply in the domain plan for ${step.hearing.npcRef}`);
    const reading = readNpcReply(toolCallResponse(NPC_REPLY_TOOL_NAME, (options?.change ?? (value => value))(structuredClone(answer.arguments), step)), step.hearing);
    return { step, reading };
  });
  const unreadable = replies.filter(entry => entry.reading.kind !== 'read');
  if (unreadable.length > 0) return { kind: 'unreadable', ruling: candidate.bundle, diagnostics: unreadable.flatMap(entry => entry.reading.diagnostics) };
  for (const entry of replies) entry.reply = entry.reading.reply;
  const validated = validateVNextProposalBundle(mergeNpcReplies(candidate.bundle, replies));
  return validated.kind === 'accepted'
    ? { kind: 'accepted', bundle: validated.bundle, bundleHash: canonicalHash(validated.bundle), ruling: candidate.bundle }
    : { kind: 'locallyRejected', validationCode: validated.code, issues: validated.issues, diagnostics: validated.diagnostics ?? [], ruling: candidate.bundle };
}

/** The complete plan a domain bundle states, as a ruling and its replies
 * make it: the form the tests' fixtures are lowered in. */
export function parseCompletePlan(domain, encode, context, options) {
  return parseWithNpcReplies(encode(domain), domain, context, options);
}

/** The complete plan of a ruling's wire and hand-written reply wires: `replyFor`
 * returns the arguments the NPC of a step wrote. Nothing is asked twice here;
 * a reply that cannot be read is returned as it was read. */
export function parseWithReplyWires(wire, replyFor) {
  const candidate = parseSubmitKpProposalBundleCandidateArguments(typeof wire === 'string' ? wire : JSON.stringify(wire));
  if (candidate.kind !== 'accepted') return candidate;
  const replies = [];
  for (const [index, step] of npcReplySteps(candidate.bundle, UNBOUND).entries()) {
    const reading = readNpcReply(toolCallResponse(NPC_REPLY_TOOL_NAME, replyFor(step, index)), step.hearing);
    if (reading.kind !== 'read') return { ...reading, ruling: candidate.bundle };
    replies.push({ step, reply: reading.reply });
  }
  const validated = validateVNextProposalBundle(mergeNpcReplies(candidate.bundle, replies));
  return validated.kind === 'accepted'
    ? { kind: 'accepted', bundle: validated.bundle, bundleHash: canonicalHash(validated.bundle), ruling: candidate.bundle }
    : { kind: 'locallyRejected', validationCode: validated.code, issues: validated.issues, diagnostics: validated.diagnostics ?? [], ruling: candidate.bundle };
}

/** The complete draft a domain fixture states, before validation: the ruling's
 * wire decoded, with each NPC's reply merged in. For tests that damage a
 * draft and read what the validator says of it. */
export function completeDraft(domain) {
  const ruling = { ...decodeVNextStrictToolBundle(encodeVNextStrictToolBundle(domain)), schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: 'proposalBundle' };
  const answers = npcReplyArguments(domain, UNBOUND);
  return mergeNpcReplies(ruling, npcReplySteps(ruling, UNBOUND).map(step => {
    const answer = answers.find(entry => entry.step.hearingHash === step.hearingHash);
    if (answer === undefined) throw new TypeError(`no reply in the domain plan for ${step.hearing.npcRef}`);
    const reading = readNpcReply(toolCallResponse(NPC_REPLY_TOOL_NAME, answer.arguments), step.hearing);
    if (reading.kind !== 'read') throw Object.assign(new TypeError('NPC_REPLY_UNREADABLE'), { diagnostics: reading.diagnostics });
    return { step, reply: reading.reply };
  }));
}

/** What a scripted model answers to a request for an NPC's own reply: what the
 * complete domain plan states for the conversation that NPC is in. Undefined
 * for any other request, so a scripted binding can try this first. */
export function scriptedNpcReply(request, domain, change = args => args) {
  const body = npcReplyRequestBody(request);
  if (body === undefined) return undefined;
  const plans = [domain, ...(domain?.terminal?.kind === 'clarification' ? domain.terminal.choices.map(choice => choice.continuation) : [])];
  const entry = plans.flatMap(plan => Array.isArray(plan?.proposals) ? plan.proposals : [])
    .find(step => step?.kind === 'social' && step.npcRef === body.npcRef && step.actorSpeech === body.hearing.speech);
  if (entry === undefined) throw new TypeError(`the scripted plan has no conversation with ${body.npcRef} that says what it heard`);
  const outcomes = Object.keys(request.tools[0].function.parameters.properties);
  return toolCallResponse(NPC_REPLY_TOOL_NAME, change(Object.fromEntries(outcomes.map(name =>
    [name, encodeNpcReplyResult(entry.branches[name === 'result' ? 'success' : name], entry.npcRef)])), body));
}

/** Explicit review stage for existing fixtures, whose replies introduce no
 * new content. Semantic findings and authored facts need their own scripts. */
export function scriptedNpcReview(request) {
  const tool = request?.tools?.[0]?.function?.name;
  if (tool !== 'review_npc_replies') return undefined;
  const body = JSON.parse(request.messages[1].content);
  if (body.candidates.length) throw new TypeError('new content requires an explicit review fixture');
  return toolCallResponse(tool, { status: 'pass', privateReason: '已核对本用例的固定回应与本人材料。', findings: [], verdicts: [] });
}
