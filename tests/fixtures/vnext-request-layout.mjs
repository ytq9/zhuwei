import { VNEXT_PROPOSAL_CONTEXT_GUIDE } from '../../app/_runtime/lib/kp/vnext/proposal-guidance.ts';
import { VNEXT_PROPOSAL_REVISION_TICKET_LABEL } from '../../app/_runtime/lib/kp/vnext/proposal-schema.ts';

const HEAD = `${VNEXT_PROPOSAL_CONTEXT_GUIDE}\n`;

/** Every proposal request leads with the guidance for reading a frozen context
 * and the context itself, so the later calls of one action reuse that block;
 * what a call must do, and a repair round's ticket, follow in the user message.
 * These read a built or saved request by that layout. */
export function sentContextBody(request) {
  const content = String(request.messages[0].content);
  if (!content.startsWith(HEAD)) throw new Error('request:frozen-context-block-must-lead');
  return content.slice(HEAD.length);
}

export const sentContext = request => JSON.parse(sentContextBody(request));

/** The leading block a request would carry for this context body. */
export const contextBlock = body => `${HEAD}${body}`;

export const sentInstructions = request => String(request.messages[1].content);

/** The JSON body a scripted provider double should read: the leading context
 * block when the request carries one, and otherwise the user message — the
 * narration, actor-plan, promise-review and story paths keep their own layout. */
export function sentBody(request) {
  const content = String(request.messages[0].content);
  if (content.startsWith(HEAD)) return JSON.parse(content.slice(HEAD.length));
  return JSON.parse(String(request.messages.find(message => message.role === 'user').content));
}

export function sentRevision(request) {
  const text = sentInstructions(request);
  const at = text.indexOf(VNEXT_PROPOSAL_REVISION_TICKET_LABEL);
  if (at < 0) throw new Error('request:no-repair-ticket');
  return JSON.parse(text.slice(at + VNEXT_PROPOSAL_REVISION_TICKET_LABEL.length));
}
