import { VNEXT_PROPOSAL_CONTEXT_GUIDE } from '../../../app/_runtime/lib/kp/vnext/proposal-guidance.ts';
import { VNEXT_PROPOSAL_REVISION_TICKET_LABEL } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';

const GUIDE_TAIL = `\n${VNEXT_PROPOSAL_CONTEXT_GUIDE}`;

/** Every proposal request leads with the rules that do not depend on the
 * action, ending with the guidance for reading a frozen context, so a provider
 * prefix cache covers all of it across actions and not only across the calls
 * of one action. This action's frozen context follows in its own message, and
 * what the call must do comes last; a repair round's ticket follows as
 * replayed turns. These read a built or saved request by that layout. */
const leadsWithRules = request => String(request.messages[0].content).endsWith(GUIDE_TAIL);

export function sentContextBody(request) {
  if (!leadsWithRules(request)) throw new Error('request:frozen-context-guide-must-lead');
  return String(request.messages[1].content);
}

export const sentContext = request => JSON.parse(sentContextBody(request));

/** Put this body where a proposal request carries its frozen context. */
export function withContextBody(request, body) {
  if (!leadsWithRules(request)) throw new Error('request:frozen-context-guide-must-lead');
  request.messages[1].content = body;
  return request;
}

/** Everything the call is told, in the order the two instruction messages were
 * split: the action-independent rules, then the task. Equal to the stage
 * instructions the guidance module builds. */
export function sentInstructions(request) {
  if (!leadsWithRules(request)) throw new Error('request:frozen-context-guide-must-lead');
  const head = String(request.messages[0].content);
  return `${head.slice(0, -GUIDE_TAIL.length)}\n${String(request.messages[2].content)}`;
}

/** The JSON body a scripted provider double should read: this action's frozen
 * context when the request carries one, and otherwise the user message — the
 * narration, actor-plan, promise-review and story paths keep their own layout. */
export function sentBody(request) {
  if (leadsWithRules(request)) return JSON.parse(String(request.messages[1].content));
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
