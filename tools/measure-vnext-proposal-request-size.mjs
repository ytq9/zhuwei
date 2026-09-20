/**
 * Reports how much of the proposal input budget one capability selection
 * spends before any world context is added.
 *
 * This is a report, not a gate: it prints numbers and asserts nothing, because
 * whether vNext gets an offline size gate — and on what measure — is an open
 * ruling (docs/agent/task-vnext-request-size.md). The V5 gates that used to
 * watch request size went with ADR 0034 and measured a retired request.
 *
 *   npx tsx tools/measure-vnext-proposal-request-size.mjs
 */
import { createSubmitKpProposalBundleModelInput,
  SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA, OFFER_KP_PROPOSAL_BUNDLE_SCHEMA }
  from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { VNEXT_PROPOSAL_CAPABILITY_IDS }
  from "../app/_runtime/lib/kp/vnext/proposal-capabilities.ts";
import { conservativeInputTokens, allowedInputTokens, VNEXT_PROPOSAL_BUDGET }
  from "../app/_runtime/lib/kp/vnext/invocation/budget.ts";

const allowed = allowedInputTokens(VNEXT_PROPOSAL_BUDGET);
const bytes = value => Buffer.byteLength(JSON.stringify(value));

/** System prompt plus the tool schemas this selection loads. The frozen
 *  RequiredContext is world-dependent and is what the remainder has to hold. */
function fixedTokens(capabilities) {
  const request = createSubmitKpProposalBundleModelInput(
    "x", capabilities, [], [], [], undefined,
    { existingRefs: [], viewerRefs: [] }, [], false);
  return conservativeInputTokens(JSON.stringify({
    systemPrompt: request.messages.map(message => message.content ?? "").join(""),
    formSchemas: request.tools,
  }));
}

const share = tokens => `${(100 * tokens / allowed).toFixed(1)}%`;
const row = (label, tokens) => console.log(
  `  ${label.padEnd(46)}${String(tokens).padStart(7)}${share(tokens).padStart(8)}`
  + `${tokens > allowed ? "   over budget" : String(allowed - tokens).padStart(9)}`);

console.log(`budget profile ${VNEXT_PROPOSAL_BUDGET.profileRef}`);
console.log(`  context window ${VNEXT_PROPOSAL_BUDGET.contextWindowTokens.toLocaleString()}`
  + ` - reserve ${VNEXT_PROPOSAL_BUDGET.completionReserveTokens.toLocaleString()}`
  + ` - margin ${VNEXT_PROPOSAL_BUDGET.safetyMarginTokens.toLocaleString()}`
  + ` = ${allowed.toLocaleString()} input tokens`);
console.log(`  counter ${VNEXT_PROPOSAL_BUDGET.counterRef}, never calibrated against a real provider`);
console.log();
console.log(`SUBMIT schema ${bytes(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA).toLocaleString()} bytes`
  + `, OFFER schema ${bytes(OFFER_KP_PROPOSAL_BUNDLE_SCHEMA).toLocaleString()} bytes`);
console.log();

console.log(`one capability${"".padEnd(32)} tokens   share  left for context`);
for (const [id, tokens] of VNEXT_PROPOSAL_CAPABILITY_IDS
  .map(id => [id, fixedTokens([id])]).sort((a, b) => b[1] - a[1])) row(id, tokens);

// An amendment unions capabilities (SPEC 0016 §7.2), so combinations are the
// real cost, and they do not simply add.
console.log();
console.log(`amended selections${"".padEnd(28)} tokens   share  left for context`);
for (const combination of [
  ["social", "formActorPlan"],
  ["social", "formActorPlan", "commitNarrativeDetail"],
  ["worldInteraction", "materializeObject"],
  ["authorItem", "materializeItem", "inventoryOperation"],
  ["social", "worldInteraction", "materializeNpc"],
  [...VNEXT_PROPOSAL_CAPABILITY_IDS],
]) {
  row(combination.length === VNEXT_PROPOSAL_CAPABILITY_IDS.length
    ? `all ${combination.length} capabilities` : combination.join(" + "),
    fixedTokens(combination));
}
