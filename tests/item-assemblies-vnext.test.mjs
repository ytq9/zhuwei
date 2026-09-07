import { itemAssemblyReadRefs } from "../app/_runtime/lib/rules/v2/item-assemblies.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_TARGET as OTHER, PROBE_SCENE as SCENE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import { itemById } from "../app/_runtime/lib/dnd/gear.ts";
import { itemDefinitionFromStandardGear, healingPotionItemDefinition, isItemSystemStateV1 } from "../app/_runtime/lib/rules/v2/items.ts";
import { authorityRevisionOrHash, authoritySpatialRefVisibleTo } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { acquireItemQuantity, releaseItemQuantity, consumeItemQuantity } from "../app/_runtime/lib/rules/v2/item-transitions.ts";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { parseSubmitKpProposalBundleArguments, invokeSubmitKpProposalBundleWithOneCorrection } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle, VNEXT2_PROPOSAL_BUNDLE_SCHEMA, createVNextProposalBundleSchema, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { projectAuthoritativeTableObservation, buildAuthoritativeTableState } from "../app/_runtime/lib/table/authoritative.ts";

function scenario(id, entries = [["rope-50ft", 1], ["mess-kit", 1]], remoteObserver = false) {
  let f = createAuthoredProbeFixture(`assembly:${id}`);
  if (remoteObserver) {
    const state = structuredClone(f.genesis.initialState), sceneRef = "scene:assembly-remote";
    state.scenes[sceneRef] = { id: sceneRef, name: "另一个地点" };
    state.combatRuntime.scenes[sceneRef] = { ...structuredClone(state.combatRuntime.scenes[SCENE]), sceneId: sceneRef };
    state.combatRuntime.scenes[sceneRef].geometry.obstacles[0].featureId = "feature:remote-wall";
    state.entities[OTHER].sceneId = sceneRef; state.combatRuntime.entities[OTHER].sceneId = sceneRef;
    const domain = { ...state }; delete domain.eventHeadHash; delete domain.lastEventId;
    const initialStateHash = canonicalSha256(domain); state.eventHeadHash = initialStateHash;
    const unsigned = { ...f.genesis, initialState: state, initialStateHash }; delete unsigned.genesisHash;
    const genesis = { ...unsigned, genesisHash: canonicalSha256(unsigned) };
    const replayed = f.runtime.replay(genesis, []); assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
    f = { ...f, genesis, state: replayed.state };
  }
  let state = f.state; const events = [], refs = [];
  for (const [gear, quantity] of entries) {
    const definition = gear === "potion" ? healingPotionItemDefinition() : itemDefinitionFromStandardGear(itemById(gear));
    const entryId = `item-entry:assembly-test:${gear}`;
    const result = f.runtime.step(f.profiles, state, { kind: "materializeItem", proposalId: `root:assembly-test:seed:${gear}`,
      actorCharacterId: ACTOR, definition, entryId, quantity, sceneId: SCENE });
    assert.equal(result.kind, "committed", JSON.stringify(result)); state = result.state; events.push(...result.events); refs.push(entryId);
  }
  return { ...f, state, events, refs };
}
function operation(f, overrides = {}) {
  return { kind: "assemble", label: "临时响铃", description: "原有部件用绳结固定，手动拨动会相互碰撞。",
    components: f.refs.map(entryRef => ({ entryRef, quantity: 1, recoverable: true })), ...overrides };
}
function input(state, rootActionId, operation, actorCharacterId = ACTOR) {
  const assembly = operation.kind === "disassemble" ? state.campaignRuntime.itemSystem.assemblies?.[operation.assemblyRef] : undefined;
  const refs = [...new Set([...(operation.kind === "assemble" || operation.kind === "disassemble" ? itemAssemblyReadRefs(state, actorCharacterId, operation) : []), actorCharacterId, SCENE, ...(operation.components?.map(c => c.entryRef) ?? [operation.assemblyRef]),
    ...(assembly?.components.map(c => c.entryRef) ?? [])])].filter(Boolean);
  return { kind: "inventoryOperation", rootActionId, actorCharacterId, plan: {
    schema: "zhuwei.inventory-operation-plan/vnext-1", contextHash: canonicalSha256({ rootActionId }),
    readSet: refs.map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(state, ref) })), basisRefs: [],
    summary: "依裁决处理现有组件。", operation } };
}
function apply(f, state, suffix, op) {
  const result = f.runtime.step(f.profiles, state, input(state, `root:assembly-test:${suffix}`, op));
  assert.equal(result.kind, "committed", JSON.stringify(result)); return result;
}
function assemblyOf(result) { return Object.values(result.state.campaignRuntime.itemSystem.assemblies)[0]; }
function verifyReplay(f, events, state) {
  const result = f.runtime.replay(f.genesis, [...f.events, ...events]);
  assert.equal(result.kind, "replayed", JSON.stringify(result)); assert.deepEqual(result.state, state); return result;
}
function projected(f, before, result, viewer = f.viewer) {
  const value = f.runtime.project(f.profiles, result.state, viewer, { channel: "realtime", committedRange: {
    receiptId: result.receipt.receiptId, actorCharacterId: ACTOR, priorState: before, events: result.events } });
  assert.equal(value.kind, "projected", JSON.stringify(value)); return value;
}

test("ordinary assembly and disassembly preserve existing entries, public identity, Claims and replay", () => {
  const f = scenario("ordinary");
  const before = canonicalSha256(f.state);
  const assembled = apply(f, f.state, "assemble", operation(f));
  const assembly = assemblyOf(assembled);
  assert.equal(assembly.state, "active"); assert.match(assembly.assemblyRef, /^assembly:/);
  assert.equal(Object.keys(assembled.state.campaignRuntime.itemSystem.definitions).length, 2);
  assert.equal(assembled.events.some(e => ["AuthoredMaterializationResolved", "RandomnessRequested", "ResourceSpent"].includes(e.eventType)), false);
  assert.equal(canonicalSha256(f.state), before);
  for (const ref of f.refs) {
    const e = assembled.state.campaignRuntime.itemSystem.entries[ref];
    assert.equal(e.disposition, "scene"); assert.equal(e.assemblyRef, assembly.assemblyRef); assert.equal(e.quantity, 1);
  }
  const projection = projected(f, f.state, assembled);
  assert.equal(projection.visibleAssemblies[0].assemblyRef, assembly.assemblyRef);
  assert.ok(projection.renderableClaims?.claims.some(c => c.kind === "inventoryOutcome" && c.operation?.kind === "assemble"), JSON.stringify(projection));
  const table = projectAuthoritativeTableObservation({ userId: f.viewer.principalId, members: [f.viewer.principalId], locationLabels: { [SCENE]: "测试地点" }, observation: { readModel: projection } });
  const dto = buildAuthoritativeTableState({ rulesetVersion: "dnd5e-2014-srd5.1-authoritative-v2", projected: table });
  assert.ok(dto, "public table DTO must accept the active authoritative ruleset");
  assert.equal(dto.visibleAssemblies[0].assemblyRef, assembly.assemblyRef);
  assert.deepEqual(Object.keys(dto.visibleAssemblies[0]).sort(), ["assemblyRef", "description", "label", "sceneRef", "state"]);
  const frozen = freezeAuthoredProbeContext(f, assembled.state, { focusRefs: [assembly.assemblyRef], intentText: "拆解临时响铃并回收原件。" });
  assert.ok(JSON.stringify(frozen.context).includes(assembly.assemblyRef));
  assert.ok(f.refs.every(ref => JSON.stringify(frozen.context).includes(ref)));
  const dismantled = apply(f, assembled.state, "disassemble", { kind: "disassemble", assemblyRef: assembly.assemblyRef });
  assert.equal(assemblyOf(dismantled).state, "disassembled");
  for (const ref of f.refs) assert.equal(dismantled.state.campaignRuntime.itemSystem.entries[ref].holderRef, ACTOR);
  assert.equal(projected(f, assembled.state, dismantled).visibleAssemblies.length, 0);
  verifyReplay(f, [...assembled.events, ...dismantled.events], dismantled.state);
  for (const state of [assembled.state, dismantled.state]) assert.equal(isItemSystemStateV1(state.campaignRuntime.itemSystem), true);
});

test("partial mixed-recovery components share the same transition and ordinary release/acquire merge", () => {
  const f = scenario("mixed", [["piton", 5], ["oil", 3]]);
  const assembled = apply(f, f.state, "mixed-assemble", operation(f, { label: "支撑固定件", description: "固定件由原库存部件组成。",
    components: [{ entryRef: f.refs[0], quantity: 2, recoverable: true }, { entryRef: f.refs[1], quantity: 1, recoverable: false }] }));
  const assembly = assemblyOf(assembled);
  assert.equal(assembled.state.campaignRuntime.itemSystem.entries[f.refs[0]].quantity, 3);
  assert.equal(assembled.state.campaignRuntime.itemSystem.entries[f.refs[1]].quantity, 2);
  const dismantled = apply(f, assembled.state, "mixed-disassemble", { kind: "disassemble", assemblyRef: assembly.assemblyRef });
  assert.equal(dismantled.state.campaignRuntime.itemSystem.entries[f.refs[0]].quantity, 5);
  assert.equal(dismantled.state.campaignRuntime.itemSystem.entries[f.refs[1]].quantity, 2);
  assert.equal(dismantled.state.campaignRuntime.itemSystem.entries[assembly.components[1].entryRef].disposition, "consumed");
  const projection = projected(f, assembled.state, dismantled);
  const recoveryClaims = projection.renderableClaims?.claims.filter(c => c.kind === "inventoryOutcome" && c.operation?.kind === "disassemble") ?? [];
  assert.equal(recoveryClaims.length, 2, JSON.stringify(projection));
  assert.ok(recoveryClaims.some(c => c.operation.quantity === 1 && !c.operation.recoverable));
  const dropped = apply(f, dismantled.state, "after-release", { kind: "release", entryRef: f.refs[0], quantity: 2, sceneRef: SCENE, releaseKind: "placement" });
  const droppedRef = dropped.events.find(e => e.eventType === "InventoryOperationApplied").payload.targetEntryId;
  const acquired = apply(f, dropped.state, "after-acquire", { kind: "acquire", entryRef: droppedRef, quantity: 2 });
  assert.equal(acquired.state.campaignRuntime.itemSystem.entries[f.refs[0]].quantity, 5);
  const reassembled = apply(f, acquired.state, "again-assemble", operation(f));
  const secondRef = Object.values(reassembled.state.campaignRuntime.itemSystem.assemblies).find(a => a.state === "active").assemblyRef;
  const twice = apply(f, reassembled.state, "again-disassemble", { kind: "disassemble", assemblyRef: secondRef });
  assert.equal(twice.state.campaignRuntime.itemSystem.entries[f.refs[0]].quantity, 5);
  assert.equal(twice.state.campaignRuntime.itemSystem.entries[f.refs[1]].quantity, 2);
  verifyReplay(f, [...assembled.events, ...dismantled.events, ...dropped.events, ...acquired.events, ...reassembled.events, ...twice.events], twice.state);
});

test("occupied components cannot move, be consumed, grant use or be assembled twice; invalid quantities and foreign actors reject atomically", () => {
  const f = scenario("denials", [["potion", 2], ["piton", 3]]);
  const assembled = apply(f, f.state, "deny-assemble", operation(f)); const a = assemblyOf(assembled);
  const system = assembled.state.campaignRuntime.itemSystem; const ref = a.components[0].entryRef;
  const before = canonicalSha256(assembled.state);
  for (const op of [{ kind: "acquire", entryRef: ref, quantity: 1 }, { kind: "use", entryRef: ref, targetRefs: [ACTOR] },
    { kind: "lifecycle", entryRef: ref, action: "repair" }, operation(f, { components: a.components.map(c => ({ ...c, quantity: 1 })) })]) {
    const result = f.runtime.step(f.profiles, assembled.state, input(assembled.state, `root:deny:${op.kind}`, op));
    assert.equal(result.kind, "rejected", JSON.stringify(result)); assert.deepEqual(result.events, []);
  }
  assert.equal(acquireItemQuantity(system, { entryId: ref, holderRef: ACTOR, quantity: 1 }).error, "itemComponentOccupied");
  assert.equal(releaseItemQuantity(system, { entryId: ref, holderRef: ACTOR, sceneRef: SCENE, quantity: 1 }).error, "itemComponentOccupied");
  assert.equal(consumeItemQuantity(system, { entryId: ref, holderRef: ACTOR, quantity: 1 }).error, "itemComponentOccupied");
  for (const quantity of [0, -1, 1.5, 1_000_001, 100]) {
    const result = f.runtime.step(f.profiles, f.state, input(f.state, `root:quantity:${quantity}`, operation(f, { components: [{ entryRef: f.refs[0], quantity, recoverable: true }, { entryRef: f.refs[1], quantity: 1, recoverable: true }] })));
    assert.equal(result.kind, "rejected"); assert.deepEqual(result.events, []);
  }
  const theft = f.runtime.step(f.profiles, assembled.state, input(assembled.state, "root:other-dismantle", { kind: "disassemble", assemblyRef: a.assemblyRef }, OTHER));
  assert.equal(theft.kind, "rejected");
  const done = apply(f, assembled.state, "once-only", { kind: "disassemble", assemblyRef: a.assemblyRef });
  const again = f.runtime.step(f.profiles, done.state, input(done.state, "root:twice", { kind: "disassemble", assemblyRef: a.assemblyRef }));
  assert.equal(again.kind, "rejected"); assert.deepEqual(again.events, []);
  assert.equal(canonicalSha256(assembled.state), before);
});

test("model filling interface lowers a single ordinary assembly through the existing atomic Rules command", () => {
  const f = scenario("wire"); const op = operation(f);
  const rootActionId = "root:assembly-test:wire";
  const frozen = freezeAuthoredProbeContext(f, f.state, { rootActionId, focusRefs: f.refs, intentText: "用现有麻绳和餐具系成临时响铃。" });
  const value = { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: "proposalBundle", mode: "adjudication", basisRefs: [],
    adjudication: { kind: "directSuccess", durationMicros: "6000000", risk: "普通摆放和连接组件。", successOutcome: "原组件已经连接。" }, terminal: null,
    proposals: [{ kind: "inventoryOperation", basisRefs: [], consumes: f.refs.map(ref => ({ kind: "existing", ref })), produces: [], outcomeBinding: "always", operation: op, summary: "用原组件组装。" }] };
  const decoded = parseSubmitKpProposalBundleArguments(encodeVNextStrictToolBundle(value));
  const lowered = lowerVNext2ProposalBundle({ value: decoded, rootActionId, actorCharacterId: ACTOR, requiredContext: frozen.context, state: f.state });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const result = f.runtime.step(f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  assert.equal(Object.keys(result.state.campaignRuntime.itemSystem.assemblies).length, 1);
  assert.equal(result.events.filter(e => e.eventType === "ItemAssemblyChanged").length, 1);
  const schema = createVNextProposalBundleSchema(undefined, f.refs);
  assert.ok(JSON.stringify(schema).includes('assemble'));
  verifyReplay(f, result.events, result.state);
});

test("service correction restores assembly occupancy and inventory together", () => {
  const f = scenario("correction"); const assembled = apply(f, f.state, "correction-assemble", operation(f));
  const replayed = verifyReplay(f, assembled.events, assembled.state);
  const corrected = f.runtime.step(f.profiles, assembled.state, { kind: "applyServiceCorrection", correctionAuthority: {
    kind: "roomCorrectionAuthority", capability: assembled.state.correctionRuntime.authorityCapability },
    correctionId: "correction:assembly", targetReceiptId: assembled.receipt.receiptId, actorCharacterId: ACTOR,
    errorKind: "rulesMisapplication", publicExplanation: "恢复这次组装之前的组件库存。", basis: { stateHash: replayed.head.stateHash, eventHash: replayed.head.eventHash } });
  assert.equal(corrected.kind, "committed", JSON.stringify(corrected));
  assert.deepEqual(corrected.state.campaignRuntime.itemSystem, f.state.campaignRuntime.itemSystem);
  verifyReplay(f, [...assembled.events, ...corrected.events], corrected.state);
});


test("assembly identity, component counts and Claims are absent from another scene's Viewer", () => {
  const f = scenario("remote", undefined, true);
  const assembled = apply(f, f.state, "remote-assembly", operation(f)); const a = assemblyOf(assembled);
  const viewer = { kind: "player", principalId: "principal:probe-target", seatId: "seat:probe-target", sessionVersion: 1, characterId: OTHER };
  const projection = projected(f, f.state, assembled, viewer);
  assert.equal(projection.visibleAssemblies.length, 0);
  assert.equal(JSON.stringify(projection).includes(a.assemblyRef), false);
  assert.equal(authoritySpatialRefVisibleTo(assembled.state, a.assemblyRef, SCENE, OTHER), false);
});

test("component cardinality and duplication reach Provider diagnostics without unsafe repair", async () => {
  const f = scenario("diagnostics");
  for (const components of [[{ entryRef: f.refs[0], quantity: 1, recoverable: true }],
    [{ entryRef: f.refs[0], quantity: 1, recoverable: true }, { entryRef: f.refs[0], quantity: 1, recoverable: true }]]) {
    const raw = { decision: { kind: "directSuccess", durationMicros: "6000000", risk: "现有组件的连接。", successOutcome: "组件连接完成。", steps: [
      { kind: "inventoryOperation", basisRefs: [], operation: operation(f, { components }), summary: "连接组件。" }] } };
    let calls = 0;
    const result = await invokeSubmitKpProposalBundleWithOneCorrection({ modelId: "scripted-test", message: "固定玩家意图", requiredContext: f.requiredContext, persistRepairTicket() { assert.fail("unsafe component choices must not enter repair"); },
      binding: { async run() { calls++; return { choices: [{ message: { tool_calls: [{ type: "function", function: { name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: JSON.stringify(raw) } }] } }] }; } } });
    assert.equal(result.kind, "rejected", JSON.stringify(result)); assert.equal(calls, 1); assert.equal(result.repairUsed, false);
    const detail = result.diagnostics.find(d => d.expected?.uniqueBy === "entryRef" || d.expected?.minItems === 2);
    assert.ok(detail, JSON.stringify(result));
    assert.deepEqual(detail.path, components.length === 1 ? ["proposals", 0, "operation", "components"] : ["proposals", 0, "operation", "components", 1, "entryRef"]);
    assert.equal(detail.repair.allowed, false); assert.ok(detail.constraint);
  }
});

test("instant assembly cannot bypass active combat action costs or missing frozen component reads", () => {
  const f = scenario("combat");
  const incomplete = input(f.state, "root:missing-read", operation(f)); incomplete.plan.readSet = incomplete.plan.readSet.filter(r => r.ref !== f.refs[0]);
  assert.equal(f.runtime.step(f.profiles, f.state, incomplete).kind, "rejected");
  const begun = f.runtime.step(f.profiles, f.state, { kind: "startEncounter", rootActionId: "root:assembly-combat", proposalAttemptId: "proposal:assembly-combat",
    encounterId: "encounter:assembly", sceneId: SCENE, participantEntityIds: [ACTOR, OTHER], dynamicEntities: [], battlefieldFactIds: [],
    initiativeGroups: [ACTOR, OTHER].map(id => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [OTHER] }, { fromEntityIds: [OTHER], toEntityIds: [ACTOR] }] });
  assert.notEqual(begun.kind, "rejected", JSON.stringify(begun));
  const denied = f.runtime.step(f.profiles, begun.state, input(begun.state, "root:free-combat-assembly", operation(f)));
  assert.equal(denied.kind, "rejected"); assert.deepEqual(denied.events, []);
  assert.equal(denied.rejection.message, "assemblyRequiresCombatAdjudication");
});
