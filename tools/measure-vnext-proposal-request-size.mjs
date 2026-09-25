#!/usr/bin/env node
/**
 * How much of the proposal input budget a capability selection spends before
 * any world context is added: the system prompt plus the tool schemas that
 * selection loads. The frozen RequiredContext is world-dependent, and what
 * this leaves is what has to hold it.
 *
 * ADR 0034 removed the four V5 size gates along with the request they
 * measured. A runtime guard remains -- `kp/vnext/invocation/assemble.ts` blocks
 * an over-budget request with PROPOSAL_INPUT_BUDGET_EXCEEDED -- but nothing
 * reported growth until a real player crossed the ceiling. The user ruled on
 * 2026-09-20 that this goes in the ratchet, per capability, so a shift of cost
 * between capabilities cannot hide inside a total (ADR 0035). Growth fails the
 * gate; since 2026-09-26 a prompt addition for a feature the user was told
 * about is adopted with `node tools/gate.mjs --accept-request-size`, and it
 * must not repeat what the prompt already says (ADR 0057).
 *
 *   node --import tsx tools/measure-vnext-proposal-request-size.mjs
 *   node --import tsx tools/measure-vnext-proposal-request-size.mjs --json
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { createSubmitKpProposalBundleModelInput,
  SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA, OFFER_KP_PROPOSAL_BUNDLE_SCHEMA }
  from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { VNEXT_PROPOSAL_CAPABILITY_IDS }
  from "../app/_runtime/lib/kp/vnext/proposal-capabilities.ts";
import { conservativeInputTokens, allowedInputTokens, VNEXT_PROPOSAL_BUDGET }
  from "../app/_runtime/lib/kp/vnext/invocation/budget.ts";

/** Amendments union capabilities (SPEC 0016 §7.2), so combinations are the
 *  real cost and they do not simply add. These are the shapes one intent
 *  plausibly reaches, kept in the ratchet alongside the singles. */
const AMENDED_SELECTIONS = Object.freeze([
  ["social", "formActorPlan"],
  ["social", "formActorPlan", "commitNarrativeDetail"],
  ["worldInteraction", "materializeObject"],
  ["authorItem", "materializeItem", "inventoryOperation"],
  ["social", "worldInteraction", "materializeNpc"],
]);

export function fixedTokens(capabilities) {
  const request = createSubmitKpProposalBundleModelInput(
    "x", capabilities, [], [], [], undefined,
    { existingRefs: [], viewerRefs: [] }, [], false);
  return conservativeInputTokens(JSON.stringify({
    systemPrompt: request.messages.map(message => message.content ?? "").join(""),
    formSchemas: request.tools,
  }));
}

/** One numeric entry per selection, which is what the ratchet compares. */
export function measureVNextProposalRequestSize() {
  const entries = VNEXT_PROPOSAL_CAPABILITY_IDS.map(id => [id, fixedTokens([id])]);
  for (const selection of AMENDED_SELECTIONS) {
    entries.push([selection.join("+"), fixedTokens(selection)]);
  }
  entries.push(["*all", fixedTokens([...VNEXT_PROPOSAL_CAPABILITY_IDS])]);
  return Object.fromEntries(entries);
}

export const allowedTokens = () => allowedInputTokens(VNEXT_PROPOSAL_BUDGET);

function report() {
  const allowed = allowedTokens();
  const bytes = value => Buffer.byteLength(JSON.stringify(value));
  const measured = measureVNextProposalRequestSize();

  console.log(`budget profile ${VNEXT_PROPOSAL_BUDGET.profileRef}`);
  console.log(`  context window ${VNEXT_PROPOSAL_BUDGET.contextWindowTokens.toLocaleString()}`
    + ` - reserve ${VNEXT_PROPOSAL_BUDGET.completionReserveTokens.toLocaleString()}`
    + ` - margin ${VNEXT_PROPOSAL_BUDGET.safetyMarginTokens.toLocaleString()}`
    + ` = ${allowed.toLocaleString()} input tokens`);
  console.log(`  counter ${VNEXT_PROPOSAL_BUDGET.counterRef}, never calibrated against a real provider`);
  console.log(`\nSUBMIT schema ${bytes(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA).toLocaleString()} bytes`
    + `, OFFER schema ${bytes(OFFER_KP_PROPOSAL_BUNDLE_SCHEMA).toLocaleString()} bytes\n`);

  const row = (label, tokens) => console.log(
    `  ${label.padEnd(50)}${String(tokens).padStart(7)}`
    + `${`${(100 * tokens / allowed).toFixed(1)}%`.padStart(8)}`
    + `${tokens > allowed ? "   over budget" : String(allowed - tokens).padStart(9)}`);

  console.log(`one capability${"".padEnd(36)} tokens   share  left for context`);
  for (const id of VNEXT_PROPOSAL_CAPABILITY_IDS
    .slice().sort((a, b) => measured[b] - measured[a])) row(id, measured[id]);
  console.log(`\namended selections${"".padEnd(32)} tokens   share  left for context`);
  for (const selection of AMENDED_SELECTIONS) {
    row(selection.join(" + "), measured[selection.join("+")]);
  }
  row(`all ${VNEXT_PROPOSAL_CAPABILITY_IDS.length} capabilities`, measured["*all"]);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(measureVNextProposalRequestSize()));
  } else report();
}
