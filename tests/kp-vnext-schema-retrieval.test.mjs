import { row, rowIndex, dropRow, nestedDecision } from './fixtures/vnext-wire-tables.mjs';
import { encodeVNextStrictToolBundle } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import { closeVNextProposalCapabilities, VNEXT_INITIAL_PROPOSAL_CAPABILITIES, VNEXT_PROPOSAL_CAPABILITY_IDS, VNEXT_PROPOSAL_CAPABILITIES,
  vnextProposalCapabilityForEntry } from "../app/_runtime/lib/kp/vnext/proposal-capabilities.ts";
import { createVNextProposalBundleSchema, createVNextProposalOfferModelInput, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  OFFER_KP_PROPOSAL_BUNDLE_SCHEMA, SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  VNEXT_INITIAL_PROPOSAL_DECISION_KINDS, VNEXT_PROPOSAL_SCHEMA_REQUEST_IDS } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { assertVNextProposalCandidateCapabilities, parseSubmitKpProposalBundleCandidateArguments, parseSubmitKpProposalBundleCandidateResponse,
  parseVNextProposalOfferResponse, invokeVNextProposalOffer, invokeSubmitKpProposalBundleFirstPass, VNextProposalBundleOutputError } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { assertDeepSeekStrictToolModelInput } from "../app/_runtime/lib/kp/deepseek.ts";
import { deepSeekStrictToolSchemaIssues } from "../app/_runtime/lib/kp/deepseek-strict-tool.ts";
import { expandDeepSeekSchema, schemaVariants } from "./fixtures/expand-deepseek-schema.mjs";
import { itemBundle, hazardBundle } from "./fixtures/vnext-authored-bundles.mjs";
import { VNEXT_PROPOSAL_GUIDANCE_POLICY, vnextProposalSystemPrompt } from "../app/_runtime/lib/kp/vnext/proposal-guidance.ts";
import { VNEXT_SEMANTIC_TEMPLATE_CATALOG } from "../app/_runtime/lib/rules/profiles/semantic-templates.ts";

function query(capabilities, extra = {}) { return { requestedCapabilities: capabilities, ...extra }; }
function response(request, name = OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME) {
  return { choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(request) } }] } }] };
}
function wire(value) {
  if (value === null) return { kind: "none" };
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wire(v)]));
  return value;
}
function argumentsFor(bundle) { const { kind: _kind, schema: _schema, ...args } = bundle; return encodeVNextStrictToolBundle(wire(args)); }
function decisionSchema(expanded, kind) {
  const variant = expanded.properties.decision.anyOf.find(entry => entry.properties.kind.enum.includes(kind));
  assert.ok(variant, `missing decision variant ${kind}`);
  return variant;
}
function withoutProducerAvailabilityGuidance(schema) {
  const value = structuredClone(schema);
  function visit(node) {
    if (!node || typeof node !== "object") return;
    const basis = node.properties?.basisRefs;
    if (typeof basis?.description === "string") basis.description = basis.description
      .replace(" A proposal may also cite an exact handle declared by a supported same-bundle producer through its typed reference slots; the server derives and validates the matching dependency.", "")
      .replace(" No same-bundle producer type was selected; use existing choices only.", "");
    for (const child of Object.values(node)) visit(child);
  }
  visit(value);
  return value;
}

test("selected schemas preserve exact full-contract variants and resolve all strict references", () => {
  const full = expandDeepSeekSchema(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA);
  assertDeepSeekStrictToolModelInput(createVNextProposalOfferModelInput("玩家的冻结意图"));
  assert.deepEqual(deepSeekStrictToolSchemaIssues(OFFER_KP_PROPOSAL_BUNDLE_SCHEMA), []);
  for (const id of VNEXT_PROPOSAL_CAPABILITY_IDS) {
    const schema = createVNextProposalBundleSchema([id]);
    assert.deepEqual(deepSeekStrictToolSchemaIssues(schema), []);
    const expanded = expandDeepSeekSchema(schema);
    const capability = VNEXT_PROPOSAL_CAPABILITIES.find(entry => entry.id === id);
    if (capability.surface === "native") {
      const selected = decisionSchema(expanded, capability.proposalKind);
      assert.deepEqual(selected, decisionSchema(full, capability.proposalKind));
      const continuations = decisionSchema(expanded, "clarification").properties.choices.items.properties.continuation.anyOf;
      assert.deepEqual(continuations.find(entry => entry.properties.kind.enum.includes(capability.proposalKind)), selected);
      assert.ok(!expanded.properties.decision.anyOf.some(entry => entry.properties.kind.enum.includes("directSuccess")));
      continue;
    }
    // Steps and results are root tables shared by both rulings; the ruling
    // variants themselves carry no steps. Every selected row must be one of
    // the full contract's rows. Producer availability guidance and the social
    // response-basis choices reflect the selected producer types.
    for (const variant of schemaVariants(expanded.properties.steps.items)) {
      assert.ok(schemaVariants(full.properties.steps.items).some(original => isDeepStrictEqual(
        withoutProducerAvailabilityGuidance(original), withoutProducerAvailabilityGuidance(variant))), `${id}:step`);
    }
    for (const variant of schemaVariants(expanded.properties.results.items)) {
      const original = schemaVariants(full.properties.results.items).find(original => variant.properties.kind.enum.includes("social")
        ? original.properties.kind.enum.includes("social") : isDeepStrictEqual(
          withoutProducerAvailabilityGuidance(original), withoutProducerAvailabilityGuidance(variant)));
      if (variant.properties.kind.enum.includes("none")) continue;
      assert.ok(original, `${id}:result`);
      const expected = structuredClone(original);
      if (variant.properties.kind.enum.includes("social")) {
        // The response-basis item is one closed enum string; the full contract wraps it in an anyOf only to admit a producer's handle.
        const selectedItems = variant.properties.responseBasis.items, completeItems = expected.properties.responseBasis.items;
        const completeSource = completeItems.anyOf ? completeItems.anyOf.find(value => !value.properties?.worldFactRef) : completeItems;
        if (selectedItems.anyOf) assert.deepEqual(selectedItems, completeItems);
        else assert.deepEqual(selectedItems, completeSource, "social-only selection cannot reference an unselected world-fact producer");
        expected.properties.responseBasis.items = selectedItems;
      }
      assert.deepEqual(withoutProducerAvailabilityGuidance(variant), withoutProducerAvailabilityGuidance(expected), `${id}:result`);
    }
    for (const kind of ["directSuccess", "check"]) {
      assert.deepEqual(decisionSchema(expanded, kind), decisionSchema(full, kind), `${id}:${kind}`);
      const continuations = decisionSchema(expanded, "clarification").properties.choices.items.properties.continuation.anyOf;
      const continuation = continuations.find(entry => entry.properties.kind.enum.includes(kind));
      assert.ok(continuation, `${id}:${kind} clarification must retain a nested continuation`);
      for (const variant of schemaVariants(continuation.properties.steps.items)) {
        assert.ok(schemaVariants(expanded.properties.steps.items).some(step => step.properties.kind.enum[0] === variant.properties.kind.enum[0]),
          `${id}:${kind} continuation step kinds match the selected steps`);
      }
    }
  }
  assert.deepEqual(createVNextProposalBundleSchema(VNEXT_PROPOSAL_CAPABILITY_IDS), SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA);
  const bytes = schema => Buffer.byteLength(JSON.stringify(schema));
  assert.ok(bytes(OFFER_KP_PROPOSAL_BUNDLE_SCHEMA) < bytes(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA) * 0.6);
});

test("every advertised capability loads its complete filling guidance and only applicable template defaults", () => {
  for (const requested of [VNEXT_INITIAL_PROPOSAL_CAPABILITIES, ["authorItem"], ["authorHazard"], ...VNEXT_PROPOSAL_CAPABILITY_IDS.map(id => [id])]) {
    const loaded = closeVNextProposalCapabilities([...VNEXT_INITIAL_PROPOSAL_CAPABILITIES, ...requested]);
    const prompt = vnextProposalSystemPrompt("expandedProposal", loaded);
    assert.equal(prompt.includes(JSON.stringify(VNEXT_PROPOSAL_GUIDANCE_POLICY.catalog)), false);
    assert.ok(prompt.includes(VNEXT_PROPOSAL_GUIDANCE_POLICY.authority));
    const hasSteps = loaded.some(id => VNEXT_PROPOSAL_CAPABILITIES.find(entry => entry.id === id).surface !== "native");
    assert.equal(prompt.includes(VNEXT_PROPOSAL_GUIDANCE_POLICY.planRuling), hasSteps);
    for (const id of VNEXT_PROPOSAL_CAPABILITY_IDS) {
      assert.equal(prompt.includes(VNEXT_PROPOSAL_GUIDANCE_POLICY.filling[id]), loaded.includes(id), id);
    }
    const defaults = { templates: VNEXT_SEMANTIC_TEMPLATE_CATALOG.templates.map(({ templateRef, semanticKind, defaults }) =>
      ({ templateRef, semanticKind, defaults })) };
    assert.equal(prompt.includes(JSON.stringify(defaults)), loaded.includes("materializeObject"));
    assert.equal(vnextProposalSystemPrompt("expandedProposal", [...loaded].reverse()), prompt);
  }
  assert.equal(vnextProposalSystemPrompt("offer", ["authorHazard"]), vnextProposalSystemPrompt("offer"));
  assert.equal(vnextProposalSystemPrompt("correction", ["authorItem"]), vnextProposalSystemPrompt("correction", ["authorHazard"]));
});

test("model-visible shared ruling and area instructions agree with accepted and rejected field combinations", () => {
  const candidate = value => parseSubmitKpProposalBundleCandidateArguments(argumentsFor(value));
  const value = hazardBundle();
  assert.equal(candidate(value).kind, "accepted");
  const interaction = value.proposals.find(entry => entry.kind === "worldInteraction");
  interaction.branches.failure = structuredClone(interaction.branches.success);
  assert.throws(() => candidate(value), error => error instanceof VNextProposalBundleOutputError
    && error.diagnostics.some(detail => detail.constraint === "filling:direct-result-required"));
  value.adjudication = { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "dex", skill: null, dc: 12,
    mode: "normal", risk: "操作可能失败。", successOutcome: "操作成功。", failureOutcome: "操作失败。" };
  assert.equal(candidate(value).kind, "accepted");
  value.proposals.push(structuredClone(interaction));
  assert.equal(candidate(value).kind, "locallyRejected");
  const area = itemBundle();
  const use = area.proposals.at(-1).operation;
  use.area = { origin: { x: "0", y: "0", elevation: "0" }, direction: { x: "1", y: "0", elevation: "0" } };
  assert.equal(candidate(area).kind, "locallyRejected");
  use.targetRefs = [];
  assert.equal(candidate(area).kind, "accepted");
  use.area.direction.x = "0";
  assert.equal(candidate(area).kind, "locallyRejected");
});

test("Item and Hazard queries close distinct typed dependencies without changing instance names", () => {
  for (const [id, makeBundle] of [["authorItem", itemBundle], ["authorHazard", hazardBundle]]) {
    const queried = parseVNextProposalOfferResponse(response(query([id])));
    assert.equal(queried.kind, "schemaRequested");
    assert.ok(queried.capabilities.includes("authorAbility"));
    const bundle = makeBundle();
    for (const entry of bundle.proposals) {
      if (entry.source?.content.label) entry.source.content.label = "任意更名的实例";
      assert.ok(queried.capabilities.includes(vnextProposalCapabilityForEntry(entry)));
    }
    const candidate = parseSubmitKpProposalBundleCandidateArguments(argumentsFor(bundle));
    assert.equal(candidate.kind, "accepted", JSON.stringify(candidate));
    assert.doesNotThrow(() => assertVNextProposalCandidateCapabilities(candidate, queried.capabilities));
    assert.throws(() => assertVNextProposalCandidateCapabilities(candidate, VNEXT_INITIAL_PROPOSAL_CAPABILITIES), VNextProposalBundleOutputError);
  }
  assert.deepEqual(closeVNextProposalCapabilities(["authorItem", "authorItem"]), closeVNextProposalCapabilities(["authorItem"]));
  assert.deepEqual(closeVNextProposalCapabilities([]), []);
  assert.throws(() => closeVNextProposalCapabilities(["invented-schema"]), /CAPABILITY_UNKNOWN/);
});

test("pure query rejects unknown, repeated, empty, mixed draft, or duplicate JSON members", () => {
  for (const request of [
    query(["made-up"]), query([]), query(["authorItem", "authorItem"]),
    query(["authorItem"], { steps: [{ kind: "inventoryOperation" }] }),
    query(["authorItem"], { intent: "mixed draft" }),
  ]) assert.throws(() => parseVNextProposalOfferResponse(response(request)), VNextProposalBundleOutputError);
  const duplicate = response({});
  duplicate.choices[0].message.tool_calls[0].function.arguments = JSON.stringify(query(["authorItem"]))
    .replace('"requestedCapabilities":["authorItem"]', '"requestedCapabilities":["authorItem"],"requestedCapabilities":["authorHazard"]');
  assert.throws(() => parseVNextProposalOfferResponse(duplicate), VNextProposalBundleOutputError);
  const repeatedKind = response(argumentsFor(itemBundle()), SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  repeatedKind.choices[0].message.tool_calls[0].function.arguments = repeatedKind.choices[0].message.tool_calls[0].function.arguments
    .replace('"kind":"inventoryOperation"', '"kind":"inventoryOperation","kind":"inventoryOperation"');
  assert.throws(() => parseSubmitKpProposalBundleCandidateResponse(repeatedKind), VNextProposalBundleOutputError);
  const mixedProposal = argumentsFor(itemBundle());
  mixedProposal.decision.requestedCapabilities = ["authorItem"];
  assert.throws(() => parseVNextProposalOfferResponse(response(mixedProposal)), VNextProposalBundleOutputError);
});

test("offer admission preserves exact schema-request diagnostics without allocating a repair", async () => {
  const cases = [
    [query(["notRegistered"]), "VALUE_INVALID", ["requestedCapabilities", 0], "PROPOSAL_SCHEMA_CAPABILITY_UNKNOWN"],
    [query(["authorItem", "authorItem"]), "VALUE_INVALID", ["requestedCapabilities", 1], "offer:requested-capabilities-unique"],
    [query(["authorHazard", 17]), "TYPE_MISMATCH", ["requestedCapabilities", 1], "offer:capability-id-string-required"],
    [query("authorItem"), "TYPE_MISMATCH", ["requestedCapabilities"], "offer:requested-capabilities-array-required"],
    [query([]), "VALUE_INVALID", ["requestedCapabilities"], "offer:requested-capabilities-size"],
    [query(["authorItem"], { steps: [{ kind: "materializeItem" }] }), "VALUE_INVALID", ["steps"], "offer:schema-request-additional-field"],
    [query(["authorHazard"], { basisRefs: ["fact:any"] }), "VALUE_INVALID", ["basisRefs"], "offer:schema-request-additional-field"],
    [query(["authorItem"], { risk: "the frozen ruling" }), "VALUE_INVALID", ["risk"], "offer:schema-request-additional-field"],
    [query(["authorItem"], { extra: "unaccepted" }), "VALUE_INVALID", ["extra"], "offer:schema-request-additional-field"],
    [{ decision: { kind: "knowledgeReview", inquiry: "我知道什么？", scope: "allKnown", knowledgeRefs: [],
      requestedCapabilities: ["authorItem"] } }, "VALUE_INVALID", ["decision"], "offer:schema-request-additional-field"],
  ];
  const missing = query(["authorHazard"]); delete missing.requestedCapabilities;
  cases.push([missing, "FIELD_MISSING", ["requestedCapabilities"], "offer:schema-request-field-required"]);
  for (const [request, code, path, constraint] of cases) {
    let calls = 0;
    const result = await invokeVNextProposalOffer({ modelId: "test", message: "冻结意图",
      requiredContext: { entries: [], references: { citations: { authorityBasisRefs: [], viewerEvidenceRefs: [], npcKnowledge: [] } }, binding: { contextHash: "sha256:test-context" } },
      binding: { async run() { calls++; return response(request); } } });
    assert.equal(result.kind, "rejected");
    assert.equal(result.repairUsed, false);
    assert.equal(calls, 1);
    const diagnostic = result.diagnostics.find(d => d.code === code && JSON.stringify(d.path) === JSON.stringify(path));
    assert.ok(diagnostic, JSON.stringify(result));
    assert.equal(diagnostic.constraint, constraint);
    assert.equal(diagnostic.repair.allowed, false);
    assert.ok(diagnostic.expected !== undefined);
    if (constraint === "PROPOSAL_SCHEMA_CAPABILITY_UNKNOWN") {
      assert.deepEqual(diagnostic.actual, { type: "string", value: "notRegistered" });
      assert.deepEqual(diagnostic.expected.enum, VNEXT_PROPOSAL_SCHEMA_REQUEST_IDS);
      assert.equal(diagnostic.pathBase, "arguments");
    }
  }
});

test("a malformed schema request retains JSON location while refusing proposal repair", async () => {
  const output = response(query(["authorItem"]));
  const call = output.choices[0].message.tool_calls[0].function;
  call.arguments = call.arguments.slice(0, -1);
  const result = await invokeVNextProposalOffer({ modelId: "test", message: "冻结意图",
    requiredContext: { entries: [], references: { citations: { authorityBasisRefs: [], viewerEvidenceRefs: [], npcKnowledge: [] } }, binding: { contextHash: "sha256:test-context" } },
    binding: { async run() { return output; } } });
  assert.equal(result.kind, "rejected");
  assert.equal(result.repairUsed, false);
  assert.equal(result.diagnostics[0].code, "JSON_SYNTAX");
  assert.equal(result.diagnostics[0].location.offset, call.arguments.length);
  assert.equal(result.diagnostics[0].repair.allowed, false);
});

test("final proposal rejects unloaded authoring or a second query without spending correction", async () => {
  let offerCalls = 0;
  for (const invalid of [{ modelId: "" }, { message: "" }, { requiredContext: {} }]) {
    await assert.rejects(invokeVNextProposalOffer({ modelId: "test", message: "冻结意图",
      requiredContext: { entries: [], references: { citations: { authorityBasisRefs: [], viewerEvidenceRefs: [], npcKnowledge: [] } }, binding: { contextHash: "sha256:test-context" } },
      binding: { async run() { offerCalls++; } }, ...invalid }), TypeError);
  }
  assert.equal(offerCalls, 0);
  const selection = closeVNextProposalCapabilities([...VNEXT_INITIAL_PROPOSAL_CAPABILITIES, "authorHazard"]);
  for (const output of [response(argumentsFor(itemBundle()), SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME),
    response(query(["authorItem"]), SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME)]) {
    let calls = 0;
    const result = await invokeSubmitKpProposalBundleFirstPass({ modelId: "test", message: "冻结意图", capabilities: selection,
      requiredContext: { entries: [], references: { citations: { authorityBasisRefs: [], viewerEvidenceRefs: [], npcKnowledge: [] } }, binding: { contextHash: "sha256:test-context" } },
      binding: { async run(_model, request) { calls++; assertDeepSeekStrictToolModelInput(request); return output; } } });
    assert.equal(result.kind, "rejected");
    assert.equal(result.repairUsed, false);
    assert.equal(calls, 1);
  }
});


test("the first stage has one flat selection field and full type boundaries without an executable union", () => {
  assert.deepEqual(VNEXT_INITIAL_PROPOSAL_CAPABILITIES, []);
  assert.deepEqual(Object.keys(OFFER_KP_PROPOSAL_BUNDLE_SCHEMA.properties), ["requestedCapabilities"]);
  assert.deepEqual(OFFER_KP_PROPOSAL_BUNDLE_SCHEMA.required, ["requestedCapabilities"]);
  assert.deepEqual(OFFER_KP_PROPOSAL_BUNDLE_SCHEMA.properties.requestedCapabilities.items.enum, VNEXT_PROPOSAL_SCHEMA_REQUEST_IDS);
  assert.equal(JSON.stringify(OFFER_KP_PROPOSAL_BUNDLE_SCHEMA).includes('"anyOf"'), false);
  assert.deepEqual(deepSeekStrictToolSchemaIssues(OFFER_KP_PROPOSAL_BUNDLE_SCHEMA), []);
  const prompt = createVNextProposalOfferModelInput("冻结原意图").messages[0].content;
  assert.ok(prompt.includes(VNEXT_PROPOSAL_GUIDANCE_POLICY.selectionAuthority));
  // Selection must never be able to become a ruling: the adjudication
  // authority and the decision-filling rules stay out of this stage.
  for (const text of [VNEXT_PROPOSAL_GUIDANCE_POLICY.authority, VNEXT_PROPOSAL_GUIDANCE_POLICY.terminalRuling,
    VNEXT_PROPOSAL_GUIDANCE_POLICY.planRuling]) assert.equal(prompt.includes(text), false);
  // It carries every type's filling boundary before the initial selection.
  // An amendment can add missing types once; a one-line summary cannot show that
  // a promised future act needs its own plan and its own time passage.
  for (const text of Object.values(VNEXT_PROPOSAL_GUIDANCE_POLICY.filling)) assert.ok(prompt.includes(text));
  for (const id of VNEXT_PROPOSAL_SCHEMA_REQUEST_IDS) assert.ok(prompt.includes(`"id":"${id}"`));
  for (const ids of [["observe"], ["social"], ["formActorPlan", "social"]])
    assert.deepEqual(parseVNextProposalOfferResponse(response(query(ids))).capabilities, ids);
});

test("all step decisions and clarification require prior schema selection, including repairable or empty drafts", async () => {
  const complete = argumentsFor(hazardBundle());
  const choice = { decision: { kind: "clarification", intent: "选择方案", method: "确认后操作", basisRefs: [], question: "继续吗？", choices: [
    { choiceId: "continue", label: "继续", publicRisk: "采用已说明风险", basisRefs: [], continuation: nestedDecision(complete) },
    { choiceId: "cancel", label: "取消", publicRisk: "不执行", basisRefs: [], continuation: { kind: "cancel" } },
  ] } };
  const empty = { decision: { kind: "directSuccess", duration: "none", risk: "没有风险", successOutcome: "原结果" }, steps: [], results: [] };
  const noExecutableChoice = structuredClone(choice);
  noExecutableChoice.decision.choices[0].continuation = { kind: "cancel" };
  const emptyCheck = { decision: { kind: "check", duration: "none", risk: "风险已说明", successOutcome: "原成功", failureOutcome: "原失败",
    checkKind: "abilityCheck", ability: "dex", skill: { kind: "none" }, dc: 12, mode: "normal" }, steps: [], results: [] };
  for (const wire of [complete, choice, noExecutableChoice, empty, emptyCheck]) {
    let calls = 0;
    const result = await invokeVNextProposalOffer({ modelId: "test", message: "冻结原意图", requiredContext: {
      entries: [], references: { citations: { authorityBasisRefs: [], viewerEvidenceRefs: [], npcKnowledge: [] } }, binding: { contextHash: "sha256:unloaded-step" },
    }, binding: { async run() { calls++; return response(wire); } } });
    assert.equal(result.kind, "rejected"); assert.equal(result.repairUsed, false); assert.equal(calls, 1);
    assert.ok(result.diagnostics.some(d => d.constraint === "offer:schema-request-additional-field" && d.repair.allowed === false), JSON.stringify(result));
  }
  const loaded = parseVNextProposalOfferResponse(response(query(["authorHazard"])));
  const candidate = parseSubmitKpProposalBundleCandidateArguments(choice);
  assert.equal(candidate.kind, "accepted");
  assert.doesNotThrow(() => assertVNextProposalCandidateCapabilities(candidate, loaded.capabilities));
});


test("schema selection retains terminals and closes only selected step families, across distinct composites", () => {
  assert.deepEqual(VNEXT_PROPOSAL_SCHEMA_REQUEST_IDS, [...VNEXT_INITIAL_PROPOSAL_DECISION_KINDS, ...VNEXT_PROPOSAL_CAPABILITY_IDS]);
  for (const [requested, loaded] of [
    [["passTime", "social"], ["social"]],
    [["knowledgeReview", "authorItem", "observe"], ["authorItem", "observe"]],
    [["inWorldRefusal", "formActorPlan", "social"], ["formActorPlan", "social"]],
    [VNEXT_PROPOSAL_SCHEMA_REQUEST_IDS, VNEXT_PROPOSAL_CAPABILITY_IDS],
  ]) {
    const original = structuredClone(requested), result = parseVNextProposalOfferResponse(response(query(requested)));
    const terminalKinds = VNEXT_INITIAL_PROPOSAL_DECISION_KINDS.filter(id => requested.includes(id));
    assert.deepEqual(result, { kind: "schemaRequested", capabilities: closeVNextProposalCapabilities(loaded), terminalKinds });
    assert.deepEqual(requested, original);
    const expanded = expandDeepSeekSchema(createVNextProposalBundleSchema(result.capabilities, undefined, undefined, result.terminalKinds));
    const actualKinds = expanded.properties.decision.anyOf.flatMap(variant => variant.properties.kind.enum);
    assert.deepEqual(actualKinds.filter(id => VNEXT_INITIAL_PROPOSAL_DECISION_KINDS.includes(id)), terminalKinds);
  }
});

test("each terminal-only selection exposes exactly its form and rejects other terminals or another query", async () => {
  const context = { entries: [], references: { citations: { authorityBasisRefs: [], viewerEvidenceRefs: [], npcKnowledge: [] } }, binding: { contextHash: "sha256:terminal-selection" } };
  for (const terminal of VNEXT_INITIAL_PROPOSAL_DECISION_KINDS) {
    const selection = parseVNextProposalOfferResponse(response(query([terminal])));
    assert.deepEqual(selection, { kind: "schemaRequested", capabilities: [], terminalKinds: [terminal] });
    const schema = createVNextProposalBundleSchema([], undefined, undefined, selection.terminalKinds);
    assert.deepEqual(deepSeekStrictToolSchemaIssues(schema), []);
    assert.deepEqual(expandDeepSeekSchema(schema).properties.decision.anyOf.flatMap(variant => variant.properties.kind.enum), [terminal]);
    const prompt = vnextProposalSystemPrompt("expandedProposal", [], [terminal]);
    for (const [kind, filling] of Object.entries(VNEXT_PROPOSAL_GUIDANCE_POLICY.terminalFilling))
      assert.equal(prompt.includes(filling), terminal === kind);
    const other = terminal === "passTime" ? { kind: "knowledgeReview", inquiry: "已有知识", scope: "allKnown", knowledgeRefs: [] }
      : { kind: "passTime", durationMicros: "1" };
    for (const value of [{ decision: other }, query([terminal])]) {
      const result = await invokeSubmitKpProposalBundleFirstPass({ modelId: "test", message: "冻结意图", ...selection, requiredContext: context,
        binding: { async run() { return response(value, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME); } } });
      assert.equal(result.kind, "rejected"); assert.equal(result.repairUsed, false);
    }
  }
});

test("unknown IDs and duplicate terminal members remain precise argument errors without a format repair", () => {
  for (const [requested, index, constraint] of [
    [["passTime", "notRegistered"], 1, "PROPOSAL_SCHEMA_CAPABILITY_UNKNOWN"],
    [["knowledgeReview", "schemaRequest"], 1, "PROPOSAL_SCHEMA_CAPABILITY_UNKNOWN"],
    [["inWorldRefusal", "clarification"], 1, "PROPOSAL_SCHEMA_CAPABILITY_UNKNOWN"],
    [["passTime", "passTime", "social"], 1, "offer:requested-capabilities-unique"],
  ]) {
    assert.throws(() => parseVNextProposalOfferResponse(response(query(requested))), error => {
      assert.ok(error instanceof VNextProposalBundleOutputError);
      const detail = error.diagnostics[0];
      assert.equal(detail.code, "VALUE_INVALID"); assert.equal(detail.constraint, constraint);
      assert.deepEqual(detail.path, ["requestedCapabilities", index]); assert.equal(detail.pathBase, "arguments");
      assert.deepEqual(detail.actual, { type: "string", value: requested[index] }); assert.equal(detail.repair.allowed, false);
      return true;
    });
  }
});
