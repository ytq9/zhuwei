import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { proposalProspectiveHandleKinds, proposalProspectiveHandles } from "../../../app/_runtime/lib/kp/vnext/proposal-reference-slots.ts";
import { vnextProposalDanglingHandles, vnextProposalProducerCompletion } from "../../../app/_runtime/lib/kp/vnext/proposal-producer-completion.ts";
import { invokeSubmitKpProposalBundleFirstPass, assertRepairTicket, createVNextProposalRevisionModelInput,
  createRepairTicket, vnextProposalRevisionCandidate } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  decodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { assertVNextInvocationTransition } from "../../../app/_runtime/lib/room/vnext-proposal-invocation.ts";
import { assertDeepSeekStrictToolModelInput } from "../../../app/_runtime/lib/kp/deepseek.ts";
import { sentRevision } from "../../support/fixtures/vnext-request-layout.mjs";
import { itemBundle } from "../../support/fixtures/vnext-authored-bundles.mjs";
import { closeVNextProposalCapabilities } from "../../../app/_runtime/lib/kp/vnext/proposal-capabilities.ts";
import { canonicalHash } from "../../../app/_runtime/lib/kp/vnext/canonical-json.ts";
import { DEFAULT_KP_MODEL } from "../../../app/_runtime/lib/kp/models.ts";
import { kpRequestBody } from "../../../app/_runtime/lib/kp/model-request.ts";

// 2026-09-12: a player took a candle in a room with no candle definition and
// no authorItem selected. The model wrote definitionRef
// "prospective:candle-definition", which the wire admits and nothing in the
// Bundle produced; the one correction was spent on a reference the selection
// could not satisfy. The producer type of a dangling handle is now loaded for
// that correction, derived from the draft alone.

const toolCall = (name, args) => ({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{
  type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] });

/** The item fixture without its definition steps: an item materialized from a
 * definition no step declares, then acquired. */
function danglingDefinitionDraft() {
  const bundle = itemBundle();
  const materialize = bundle.proposals.find(entry => entry.kind === "materializeItem");
  const acquire = bundle.proposals.find(entry => entry.kind === "inventoryOperation" && entry.operation.kind === "acquire");
  materialize.definitionRef = "prospective:candle-definition";
  materialize.consumes = [{ kind: "prospective", handle: "prospective:candle-definition" }];
  bundle.proposals = [materialize, acquire];
  return bundle;
}

test("slot kinds name the producer a handle would need, and the untyped traversal is unchanged", () => {
  const kinds = entry => Object.fromEntries(proposalProspectiveHandleKinds(entry));
  assert.deepEqual(kinds({ kind: "materializeItem", definitionRef: "prospective:def", sceneRef: "prospective:room",
    ownership: { kind: "character", ownerRef: "prospective:who" }, basisRefs: ["prospective:basis"] }),
    { "prospective:def": "itemDefinition", "prospective:room": "semanticDefinition", "prospective:who": "entity", "prospective:basis": null });
  assert.deepEqual(kinds({ kind: "inventoryOperation", operation: { kind: "acquire", entryRef: "prospective:unit" } }),
    { "prospective:unit": "itemEntry" });
  assert.deepEqual(kinds({ kind: "materializeNpc", source: { mechanicalTemplate: { intrinsicAbilityRefs: ["prospective:ab"], itemDefinitionRefs: ["prospective:gear"] } } }),
    { "prospective:ab": "abilityDefinition", "prospective:gear": "itemDefinition" });
  assert.deepEqual(kinds({ kind: "worldInteraction", directTargetRefs: ["prospective:lever"], abilityRef: "prospective:ab",
    branches: { success: { effects: [{ kind: "registeredHazard", sourceDefinitionRef: "prospective:lever", zoneRef: "prospective:zone",
      damage: { kind: "authored", hazardDefinitionRef: "prospective:trap" } }] } } }),
    { "prospective:lever": "semanticDefinition", "prospective:ab": "abilityDefinition", "prospective:zone": "semanticDefinition", "prospective:trap": "hazardDefinition" });
  assert.deepEqual(kinds({ kind: "social", npcRef: "prospective:someone" }), { "prospective:someone": "entity" });
  // One handle in slots of two kinds implies no single producer.
  assert.deepEqual(kinds({ kind: "worldInteraction", directTargetRefs: ["prospective:x"], abilityRef: "prospective:x" }), { "prospective:x": null });
  // The dependency extraction reads the same slots as before.
  const entry = { kind: "materializeItem", definitionRef: "prospective:def", sceneRef: "scene", basisRefs: ["prospective:basis"] };
  assert.deepEqual(proposalProspectiveHandles(entry), ["prospective:basis", "prospective:def"]);
  assert.deepEqual(proposalProspectiveHandles({ kind: "unknownFamily", definitionRef: "prospective:x" }), []);
});

test("a dangling handle names the producer type its slot needs, and only an unloaded type is added", () => {
  const draft = danglingDefinitionDraft();
  assert.deepEqual(vnextProposalDanglingHandles(draft),
    [{ handle: "prospective:candle-definition", kind: "itemDefinition", capability: "authorItem" }]);
  const completion = vnextProposalProducerCompletion(draft, ["materializeItem", "inventoryOperation"]);
  assert.deepEqual(completion.completions.map(entry => entry.capability), ["authorItem"]);
  assert.ok(completion.loaded.includes("authorItem"), completion.loaded.join(","));
  // Already loaded: the model omitted the step, nothing to add.
  const loaded = vnextProposalProducerCompletion(draft, ["authorItem"]);
  assert.deepEqual(loaded.completions, []);
  assert.deepEqual(loaded.loaded, vnextProposalProducerCompletion(draft, ["authorItem", "materializeItem", "inventoryOperation"]).loaded);
  // A produced handle is not dangling; an intact fixture adds nothing.
  assert.deepEqual(vnextProposalDanglingHandles(itemBundle()), []);
});

test("the correction is sent with the producer's form, explained, and Room proves the same ticket", async () => {
  const f = createAuthoredProbeFixture("producer-completion:candle");
  const ctx = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [], intentText: "我把桌上的蜡烛拿起来。" }).context;
  const wire = encodeVNextStrictToolBundle(danglingDefinitionDraft());
  const selection = ["materializeItem", "inventoryOperation"];
  const requests = [];
  const first = await invokeSubmitKpProposalBundleFirstPass({
    modelId: "test", message: "冻结上下文", requiredContext: ctx, capabilities: selection, terminalKinds: [],
    binding: { async run(_model, request) { assertDeepSeekStrictToolModelInput(request); requests.push(request);
      return toolCall(SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, wire); } },
  });
  assert.equal(first.kind, "repairRequired", JSON.stringify(first));
  const ticket = first.repairTicket;
  assert.equal(ticket.validationCode, "BUNDLE_DEPENDENCY_INVALID", JSON.stringify(ticket.issues));
  assert.ok(ticket.issues.some(issue => issue.includes("prospective-consumer-unbound")), ticket.issues.join(","));
  // The ticket loads the producer type the selection lacked, closed over its
  // dependencies, and still proves from its own bytes.
  assert.ok(ticket.capabilities.includes("authorItem"), ticket.capabilities.join(","));
  assert.doesNotThrow(() => assertRepairTicket(ticket, ctx.binding.contextHash, ctx));
  // The filling round itself did not offer the definition form.
  assert.equal(JSON.stringify(requests[0].tools).includes('"authorItem"'), false);

  const correction = createVNextProposalRevisionModelInput(ticket, ctx);
  assertDeepSeekStrictToolModelInput(correction);
  // The producer's form travels in the first tool (the filling form), not as
  // text: the filling round's tool lacked the definition variant, this one has it.
  assert.equal(JSON.stringify(correction.tools[0]).includes('"authorItem"'), true);
  assert.deepEqual(correction.tools.map(tool => tool.function.name), [SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, "correct_kp_proposal_bundle"]);
  const body = sentRevision(correction);
  assert.deepEqual(body.producerCompletion,
    [{ handle: "prospective:candle-definition", producerKind: "itemDefinition", loadedType: "authorItem" }]);

  // Room derives the identical ticket from the saved bytes with the original
  // selection, and accepts the correction surface built from it.
  const saved = response => ({ status: "completed", context_hash: ctx.binding.contextHash,
    binding_hash: "sha256:fixture", response_json: JSON.stringify(response) });
  const prior = ordinal => ordinal === 1 ? saved(toolCall(OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, { requestedCapabilities: selection }))
    : ordinal === 2 ? saved(toolCall(SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, wire)) : undefined;
  const candidate = vnextProposalRevisionCandidate(toolCall(SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, wire), selection, []);
  assert.equal(candidate.kind, "locallyRejected");
  const rebuilt = createRepairTicket(candidate, ctx, selection, []);
  assert.equal(rebuilt.ticketHash, ticket.ticketHash);
  assert.doesNotThrow(() => assertVNextInvocationTransition({ ordinal: 3, contextHash: ctx.binding.contextHash,
    bindingHash: "sha256:fixture", requestHash: "sha256:fixture", request: kpRequestBody(DEFAULT_KP_MODEL, correction), repairTicket: ticket }, prior, ctx));
  // A self-consistent ticket that loads a type the draft never needed passes
  // its own checks and is still not the ticket Room derives from the bytes.
  const inflated = structuredClone(ticket);
  inflated.capabilities = closeVNextProposalCapabilities([...inflated.capabilities, "authorAbility"]);
  { const body = { ...inflated }; delete body.ticketHash; inflated.ticketHash = canonicalHash(body); }
  assert.doesNotThrow(() => assertRepairTicket(inflated, ctx.binding.contextHash, ctx));
  assert.throws(() => assertVNextInvocationTransition({ ordinal: 3, contextHash: ctx.binding.contextHash,
    bindingHash: "sha256:fixture", requestHash: "sha256:fixture", request: kpRequestBody(DEFAULT_KP_MODEL, createVNextProposalRevisionModelInput(inflated, ctx)),
    repairTicket: inflated }, prior, ctx), /PROPOSAL_REPAIR_EXHAUSTED/u);
  // The decoded draft is what the completion read.
  assert.equal(decodeVNextStrictToolBundle(wire).proposals[0].definitionRef, "prospective:candle-definition");
});

test("a draft rejected while its filling is read still names its dangling producer type", async () => {
  // 2026-09-12 second run: the filling was refused at a result entry before
  // any dependency analysis, so the ticket held the filling layout (decision
  // and the steps groups), not the decoded Bundle. The dangling definitionRef
  // was still there and the correction had to load authorItem.
  const filling = { decision: { kind: "directSuccess", duration: "5min" },
    steps: {
      materializeItem: [{ handle: "prospective:item-entry.wake.table-candle", definitionRef: "prospective:item-definition.wake.table-candle", sceneRef: "wake" }],
      inventoryOperation: [{ operation: { kind: "acquire", entryRef: "prospective:item-entry.wake.table-candle", quantity: 1 } }],
    } };
  assert.deepEqual(vnextProposalDanglingHandles(filling),
    [{ handle: "prospective:item-definition.wake.table-candle", kind: "itemDefinition", capability: "authorItem" }]);

  // End to end: a filling-stage rejection of the encoded dangling draft.
  const f = createAuthoredProbeFixture("producer-completion:filling-stage");
  const ctx = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [], intentText: "我把桌上的蜡烛拿起来。" }).context;
  const wire = encodeVNextStrictToolBundle(danglingDefinitionDraft());
  wire.decision.duration = "2h"; // not a duration tier: refused while the filling is read
  const first = await invokeSubmitKpProposalBundleFirstPass({
    modelId: "test", message: "冻结上下文", requiredContext: ctx, capabilities: ["materializeItem", "inventoryOperation"], terminalKinds: [],
    binding: { async run() { return toolCall(SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, wire); } },
  });
  assert.equal(first.kind, "repairRequired", JSON.stringify(first));
  assert.notEqual(first.repairTicket.validationCode, "BUNDLE_DEPENDENCY_INVALID", first.repairTicket.validationCode);
  // Refused for its shape before any dependency analysis ran.
  assert.ok(first.repairTicket.issues.some(issue => !issue.includes("prospective")), JSON.stringify(first.repairTicket.issues));
  assert.ok(first.repairTicket.capabilities.includes("authorItem"), first.repairTicket.capabilities.join(","));
  assert.doesNotThrow(() => assertRepairTicket(first.repairTicket, ctx.binding.contextHash, ctx));
  const body = sentRevision(createVNextProposalRevisionModelInput(first.repairTicket, ctx));
  assert.deepEqual(body.producerCompletion.map(entry => entry.loadedType), ["authorItem"]);
});
