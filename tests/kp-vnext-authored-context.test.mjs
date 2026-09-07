import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_TARGET as TARGET,
  PROBE_SOURCE as SOURCE, PROBE_ZONE as ZONE, PROBE_SCENE as SCENE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { AUTHORED_PROBE_CASES, runAuthoredProviderProbe } from "../tools/run-deepseek-vnext2-authored-probe.mjs";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { selectPlanReadSet } from "../app/_runtime/lib/kp/vnext/proposals.ts";
import { CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  encodeVNextStrictToolBundle, VNEXT2_PROPOSAL_BUNDLE_SCHEMA } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { authorityReadSetConflicts, authorityRevisionOrHash } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import { itemEntryUseAbilityId } from "../app/_runtime/lib/rules/v2/items.ts";

const A = "prospective:mechanics", H = "prospective:hazard", I = "prospective:definition", E = "prospective:entry";
function ability(overrides = {}) {
  return { label: "冻结能力", description: "独立冻结的机械效果。", aliases: [], tags: [], activation: { kind: "nonCombatHazard" },
    target: { kind: "creature", count: "1", rangeInches: "120", requiresSight: false }, attack: null, save: null,
    damage: [], healing: null, temporaryHitPoints: null, effect: null, effects: [], costs: [], grants: [], ...overrides };
}
function source(kind, content, handle, dependencies = [], visibilityPolicyRef = "visibility:public") {
  return { kind: "materializeDefinition", basisRefs: [SOURCE], consumes: dependencies.map((handle) => ({ kind: "prospective", handle })),
    produces: [{ handle, kind: `${kind}Definition`, outcomeBinding: "always" }], outcomeBinding: "always", source: { kind, content },
    visibilityPolicyRef, summary: "定义已固化。" };
}
function bundle(proposals) {
  return { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: "proposalBundle", mode: "adjudication", basisRefs: [SOURCE],
    adjudication: { kind: "directSuccess", risk: "依据冻结能力结算。", successOutcome: "动作能够实施。" }, terminal: null, proposals };
}
function hazardBundle(triggerKind = "disturbFeature", execute = false) {
  const proposals = [
    source("ability", ability({ damage: [{ formula: "2d6", type: "fire", sharedAcrossTargets: true }],
      effects: [{ kind: "grantEffect", condition: "blinded", duration: { kind: "timed", durationMicros: "10000000" } }] }), A),
    source("hazard", { schema: "zhuwei.environment-hazard-definition/v1", label: "冷凝喷流", trigger: { kind: triggerKind, ref: SOURCE },
      perceptibleSigns: ["阀门附近有水汽。"], disableMethods: ["旋紧阀门。"], environmentalConsequences: ["地面留下冷凝水。"], mechanicsRef: A }, H, [A], "visibility:hidden-until-evidence"),
  ];
  if (execute) proposals.push({ kind: "worldInteraction", basisRefs: [SOURCE], consumes: [{ kind: "prospective", handle: H }], produces: [],
    outcomeBinding: "always", sceneRef: SCENE, targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: null,
    intent: "转动阀门。", method: "旋转控制杆。", branches: { success: { outcomeCode: "outcome:triggered", summary: "喷流触发。",
      effects: [{ kind: "registeredHazard", sourceDefinitionRef: SOURCE, zoneRef: ZONE, damage: { kind: "authored", hazardDefinitionRef: H } }],
      sensoryEvidence: [], pressures: [], opportunities: [] }, failure: null } });
  return bundle(proposals);
}
function itemBundle({ equipped = false, acquire = false, use = false } = {}) {
  const proposals = [
    source("ability", ability({ activation: { kind: "useObject", actionGrant: "normalAction" },
      target: { kind: "creature", count: "1", rangeInches: "0", requiresSight: false }, healing: { formula: "2d4+2" } }), A),
    source("item", { schema: "zhuwei.item-definition-content/v1", label: equipped ? "回春护符" : "恢复药剂", description: "以冻结能力恢复生命。",
      category: equipped ? "equipment" : "consumable", aliases: [], tags: [], stackable: !equipped,
      equipment: equipped ? { allowedSlots: ["neck"], armor: null, twoHanded: false, weapon: null } : null,
      equippedAbilityRefs: equipped ? [A] : [], use: equipped ? null : { kind: "useObject", abilityRef: A, quantityCost: 1, chargeCost: 0, durabilityCost: 0 },
      chargesMaximum: null, durabilityMaximum: null }, I, [A]),
    { kind: "materializeItem", basisRefs: [SOURCE], consumes: [{ kind: "prospective", handle: I }], produces: [{ handle: E, kind: "itemEntry", outcomeBinding: "always" }],
      outcomeBinding: "always", definitionRef: I, sceneRef: SCENE, quantity: equipped ? 1 : 2, ownership: { kind: "unowned", ownerRef: null },
      visibilityPolicyRef: "visibility:public", summary: "独立物品出现在场景中。" },
  ];
  for (const operation of [
    ...(acquire ? [{ kind: "acquire", entryRef: E, quantity: equipped ? 1 : 2 }] : []),
    ...(use ? [{ kind: "use", entryRef: E, targetRefs: [ACTOR] }] : []),
  ]) proposals.push({ kind: "inventoryOperation", basisRefs: [SOURCE], consumes: [{ kind: "prospective", handle: E }],
    produces: [], outcomeBinding: "always", operation, summary: "物品操作完成。" });
  return bundle(proposals);
}
function execute(name, value) {
  const fixture = createAuthoredProbeFixture(name);
  const lowered = lowerVNext2ProposalBundle({ value, ...fixture });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  let result = fixture.runtime.step(fixture.profiles, fixture.state, lowered.command.rulesInput);
  const events = [...result.events];
  while (result.kind === "awaitingRandomness") {
    result = fixture.runtime.step(fixture.profiles, result.state, { kind: "fulfillAuthoritativeRandomness", continuation: result.continuation,
      rolls: result.randomnessRequest.dice.flatMap(({ count }) => Array(Number(count)).fill(2)) });
    events.push(...result.events);
  }
  assert.equal(result.kind, "committed", JSON.stringify(result));
  const replay = fixture.runtime.replay(fixture.genesis, events);
  assert.equal(replay.kind, "replayed");
  assert.deepEqual(replay.state, result.state);
  return { fixture, state: result.state };
}
function knownContext(fixture, state, focusRefs) {
  const frozen = freezeAuthoredProbeContext(fixture, state, { focusRefs });
  return { frozen, known: new Map(frozen.context.entries.filter(({ kind }) => kind === "known").map((entry) => [entry.entryRef, entry])) };
}
function readBound(frozen, known, state, ref) {
  assert.ok(known.has(ref), `missing ${ref}`);
  assert.equal(known.get(ref).revisionOrHash, canonicalSha256(known.get(ref).value));
  assert.equal(known.get(ref).revisionOrHash, authorityRevisionOrHash(state, ref));
  const selected = selectPlanReadSet(frozen.context, [ref]);
  assert.equal(selected.kind, "accepted");
  assert.ok(selected.readSet.some((binding) => binding.ref === ref && binding.revisionOrHash === known.get(ref).revisionOrHash));
}
test("authored trigger references close hazard metadata and Ability on the next real context without Viewer disclosure", () => {
  for (const triggerKind of ["disturbFeature", "contactFeature", "enterZone"]) {
    const { fixture, state } = execute(`context-${triggerKind}`, hazardBundle(triggerKind));
    const [hazardRef, hazard] = Object.entries(state.campaignRuntime.definitions).find(([, definition]) => definition.definitionKind === "environmentHazard");
    const { frozen, known } = knownContext(fixture, state, [SOURCE]);
    readBound(frozen, known, state, hazardRef);
    readBound(frozen, known, state, hazard.content.mechanicsRef);
    assert.deepEqual(known.get(hazardRef).value.content, hazard.content);
    assert.equal(frozen.context.references.citations.viewerEvidenceRefs.includes(hazardRef), false);
    assert.equal(frozen.context.references.citations.authorityBasisRefs.includes(hazardRef), true);
    assert.equal(frozen.coverage.frontierExhausted, true);
    const direct = knownContext(fixture, state, [hazardRef]);
    assert.ok(direct.known.has(SOURCE), "direct hazard reads also close its trigger");
    assert.ok(direct.known.has(hazard.content.mechanicsRef));
    const missing = structuredClone(state);
    delete missing.campaignRuntime.definitions[hazard.content.mechanicsRef];
    delete missing.combatRuntime.definitions[hazard.content.mechanicsRef];
    assert.throws(() => freezeAuthoredProbeContext(fixture, missing, { focusRefs: [SOURCE] }), (error) =>
      error.code === "PROBE_CONTEXT_BINDING_FAILED" && error.diagnostics.reason === "criticalUnavailable");
  }
});
test("scene consumables and equipment both close their distinct Ability links before anyone acquires them", () => {
  for (const equipped of [false, true]) {
    const { fixture, state } = execute(`context-item-${equipped}`, itemBundle({ equipped }));
    const entry = Object.values(state.campaignRuntime.itemSystem.entries)[0];
    const definition = state.campaignRuntime.itemSystem.definitions[entry.definitionRef];
    const abilityRef = equipped ? definition.content.equippedAbilityRefs[0] : definition.content.use.abilityRef;
    const { frozen, known } = knownContext(fixture, state, [entry.entryId]);
    readBound(frozen, known, state, entry.entryId);
    readBound(frozen, known, state, entry.definitionRef);
    readBound(frozen, known, state, abilityRef);
    assert.equal(state.combatRuntime.entities[ACTOR].abilityRefs.includes(abilityRef), false, "not accidentally reached through the actor's abilities");
  }
});
test("held item contexts include the exact per-entry executable and its resource binding", () => {
  const { fixture, state } = execute("context-held", itemBundle({ acquire: true }));
  const entry = Object.values(state.campaignRuntime.itemSystem.entries).find(({ holderRef }) => holderRef === ACTOR);
  const definition = state.campaignRuntime.itemSystem.definitions[entry.definitionRef];
  const { frozen, known } = knownContext(fixture, state, [entry.entryId]);
  readBound(frozen, known, state, definition.content.use.abilityRef);
  readBound(frozen, known, state, itemEntryUseAbilityId(definition.content.use.abilityRef, entry.entryId));
});
test("next context includes a hazard target's sourced effect and detects its expiry through the same entity read binding", () => {
  const { fixture, state } = execute("context-effects", hazardBundle("disturbFeature", true));
  const { frozen, known } = knownContext(fixture, state, [ZONE]);
  readBound(frozen, known, state, TARGET);
  assert.ok(known.get(TARGET).value.effects.some(({ condition }) => condition === "blinded"));
  const expired = structuredClone(state);
  for (const [ref, effect] of Object.entries(expired.combatRuntime.effects)) if (effect.targetEntityId === TARGET) delete expired.combatRuntime.effects[ref];
  const selected = selectPlanReadSet(frozen.context, [TARGET]);
  assert.equal(selected.kind, "accepted");
  const conflicts = authorityReadSetConflicts(expired, selected.readSet);
  assert.ok(conflicts.some(({ ref }) => ref === TARGET));
});

function wire(value) {
  if (value === null) return { kind: "none" };
  if (Array.isArray(value)) return value.map(wire);
  return typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, wire(child)])) : value;
}
function response(value, toolName = SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) {
  return { choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "call:test", type: "function", function: { name: toolName, arguments: JSON.stringify(value) } }] }, finish_reason: "tool_calls" }] };
}
function argumentsFor(value) { const { schema: _schema, kind: _kind, ...argumentsValue } = value; return encodeVNextStrictToolBundle(wire(argumentsValue)); }
test("injected probe responses traverse real parsing, Rules, replay and next-context checks for hazard and item", async () => {
  const requests = [];
  const report = await runAuthoredProviderProbe({ live: true, async invoke(_model, input) {
    const message = JSON.parse(input.messages.find(message => message.role === "user").content);
    requests.push(message);
    const item = message.requiredContext.binding.rootActionId.endsWith(":item");
    return response(argumentsFor(item ? itemBundle({ acquire: true, use: true }) : hazardBundle("disturbFeature", true)));
  } });
  assert.equal(report.status, "passed", JSON.stringify(report));
  assert.equal(report.liveProviderCalls, 2);
  assert.ok(report.cases.every(({ stages }) => stages.nextContext && stages.replay && stages.rules));
  assert.ok(requests.every(({ requiredContext }) => requiredContext.entries.length > 6));
});
test("probe persists the existing repair ticket before one summary correction and never calls a third time", async () => {
  const invalid = argumentsFor(itemBundle({ acquire: true, use: true }));
  invalid.decision.steps[1].summary = "";
  const path = ["proposals", 1, "summary"];
  let ticket, calls = 0;
  const report = await runAuthoredProviderProbe({ live: true, cases: [AUTHORED_PROBE_CASES[1]],
    async persistRepairTicket(_caseId, value) { assert.equal(calls, 1); ticket = structuredClone(value); },
    async invoke(_model, input) {
      calls += 1;
      if (calls === 1) return response(invalid);
      assert.equal(calls, 2);
      assert.ok(ticket);
      assert.equal(input.tools[0].function.name, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
      return response({ confirm: "server-plan", summaries: [{ path, value: "定义完成。" }] }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
    },
  });
  assert.equal(report.status, "passed", JSON.stringify(report));
  assert.equal(report.cases[0].repairUsed, true);
  assert.equal(report.cases[0].repairTicketHash, ticket.ticketHash);
  assert.equal(report.liveProviderCalls, 2);
  assert.equal(calls, 2);

  invalid.decision.steps[2].summary = "";
  let exhaustedCalls = 0;
  const exhausted = await runAuthoredProviderProbe({ live: true, cases: [AUTHORED_PROBE_CASES[1]], persistRepairTicket() {},
    async invoke() {
      exhaustedCalls += 1;
      return exhaustedCalls === 1 ? response(invalid)
        : response({ confirm: "server-plan", summaries: [{ path, value: "只修复一处。" }] }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
    },
  });
  assert.equal(exhaustedCalls, 2);
  assert.equal(exhausted.status, "failed");
  assert.equal(exhausted.cases[0].diagnostics.code, "PROPOSAL_REPAIR_EXHAUSTED");
});
test("probe honors the global call cap and exposes precise Rules rejection without a retry", async () => {
  let calls = 0;
  const invalid = argumentsFor(itemBundle({ acquire: true, use: true }));
  invalid.decision.steps[3].operation.quantity = 3;
  const report = await runAuthoredProviderProbe({ live: true, cases: [AUTHORED_PROBE_CASES[1]], maxCalls: 1,
    async invoke() { calls += 1; return response(invalid); },
  });
  assert.equal(calls, 1);
  assert.equal(report.status, "failed");
  assert.match(report.cases[0].failureCode, /^RULES_/);
  assert.equal(typeof report.cases[0].diagnostics.message, "string");
  assert.equal(report.cases[0].stages.lowering, true);

  const repairable = argumentsFor(itemBundle({ acquire: true, use: true }));
  repairable.decision.steps[0].summary = "";
  const capped = await runAuthoredProviderProbe({ live: true, cases: [AUTHORED_PROBE_CASES[1]], maxCalls: 1, persistRepairTicket() {},
    async invoke() { calls += 1; return response(repairable); },
  });
  assert.equal(calls, 2, "the capped probe made exactly one additional invocation");
  assert.equal(capped.liveProviderCalls, 1);
  assert.equal(capped.cases[0].failureCode, "PROBE_PROVIDER_CALL_BUDGET_EXCEEDED");
});
