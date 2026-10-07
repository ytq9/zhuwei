import { sentRevision } from './vnext-request-layout.mjs';

/** Scripted Providers return an explicit full replacement bound to the real request. */
export function replacementArguments(request, draft) {
  return { sourceDraftVersion: sentRevision(request).sourceDraftVersion,
    revisionJson: JSON.stringify({ mode: 'replaceDraft', draft }) };
}
export function wrapScriptedRevision(response, request) {
  const result = structuredClone(response), call = result?.choices?.[0]?.message?.tool_calls?.[0]?.function;
  if (!call) return result;
  let draft;
  try { draft = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments; } catch { return result; }
  if (draft?.revisionJson !== undefined || !draft?.decision) return result;
  // ADR 0131: simple corrections use the original typed form. Scripted full
  // replacements follow the offered protocol; explicit patches/wrong bytes
  // remain untouched so negative tests still exercise their real boundary.
  if (!request.tools.some(tool => tool.function.name === 'correct_kp_proposal_bundle')) {
    if (request.messages.some(message => message.role === 'tool') && call.name === 'correct_kp_proposal_bundle')
      call.name = 'submit_kp_proposal_bundle';
    return result;
  }
  call.name = 'correct_kp_proposal_bundle';
  call.arguments = JSON.stringify(replacementArguments(request, draft));
  return result;
}
