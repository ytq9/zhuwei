import { VNEXT_PROPOSAL_REVISION_TICKET_LABEL, vnextProposalSystemContent, vnextProposalSystemParts } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';

/** Every proposal request opens with one system message: the guidance for
 * reading a frozen context, this action's frozen context on one line, then
 * the rules of this stage. The tools follow it, and what the call must do is
 * the last message; a repair round's ticket follows as replayed turns. The
 * selection and filling of one action share the guide and the context as a
 * provider cache prefix (ADR 0043). These read a built or saved request by
 * that layout. */
const systemParts = request => request.messages[0]?.role === 'system'
  ? vnextProposalSystemParts(String(request.messages[0].content)) : undefined;
function partsOf(request) {
  const parts = systemParts(request);
  if (parts === undefined) throw new Error('request:frozen-context-guide-must-lead');
  return parts;
}

export const sentContextBody = request => partsOf(request).contextBody;

export const sentContext = request => JSON.parse(sentContextBody(request));

/** Put this body where a proposal request carries its frozen context. */
export function withContextBody(request, body) {
  request.messages[0].content = vnextProposalSystemContent(body, partsOf(request).referenceRules);
  return request;
}

/** Everything the call is told, in the order the rules and the task were
 * split: the stage's rules, then the task. Equal to the stage instructions
 * the guidance module builds. */
export const sentInstructions = request => `${partsOf(request).referenceRules}\n${String(request.messages[1].content)}`;

/** The JSON body a scripted provider double should read: this action's frozen
 * context when the request carries one, and otherwise the user message — the
 * narration, actor-plan, promise-review and story paths keep their own layout. */
export function sentBody(request) {
  const parts = systemParts(request);
  if (parts !== undefined) return JSON.parse(parts.contextBody);
  return JSON.parse(String(request.messages.find(message => message.role === 'user').content));
}

/** The ticket a correction request carries: the newest tool result of its
 * conversation, after the filling instructions and the replayed turns. */
export function sentRevision(request) {
  const message = [...request.messages].reverse().find(entry => typeof entry.content === 'string' && entry.content.includes(VNEXT_PROPOSAL_REVISION_TICKET_LABEL));
  if (!message) throw new Error('request:no-repair-ticket');
  const text = String(message.content);
  return JSON.parse(text.slice(text.indexOf(VNEXT_PROPOSAL_REVISION_TICKET_LABEL) + VNEXT_PROPOSAL_REVISION_TICKET_LABEL.length));
}

/** The replayed turns of a correction request: each assistant tool call and
 * the ticket that answered it, oldest first. */
export function sentTurns(request) {
  const turns = [];
  for (const message of request.messages) {
    if (message.role === 'assistant') turns.push({ call: message.tool_calls[0], content: message.content });
    else if (message.role === 'tool') turns[turns.length - 1].result = message.content;
  }
  return turns;
}

/** The tool a request expects to be answered with. A correction request
 * carries the filling form first (for the provider's cached prefix) and the
 * correction tool after it, so the round is told by the tool set, not by
 * position. */
export function sentTool(request) {
  const names = request.tools.map(tool => tool.function.name);
  return names.includes('correct_kp_proposal_bundle') ? 'correct_kp_proposal_bundle' : names[0];
}
