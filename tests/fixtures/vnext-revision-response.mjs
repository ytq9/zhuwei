/** Scripted Providers return an explicit full replacement bound to the real request. */
export function replacementArguments(request, draft) {
  return { sourceDraftVersion: JSON.parse(request.messages[1].content).sourceDraftVersion,
    revisionJson: JSON.stringify({ mode: 'replaceDraft', draft }) };
}
export function wrapScriptedRevision(response, request) {
  const result = structuredClone(response), call = result?.choices?.[0]?.message?.tool_calls?.[0]?.function;
  if (request.tools[0].function.name !== 'correct_kp_proposal_bundle' || !call) return result;
  let draft;
  try { draft = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments; } catch { return result; }
  if (draft?.revisionJson !== undefined || !draft?.decision) return result;
  call.name = 'correct_kp_proposal_bundle';
  call.arguments = JSON.stringify(replacementArguments(request, draft));
  return result;
}
